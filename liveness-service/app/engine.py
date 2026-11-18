"""Self-hosted ONNX passive anti-spoofing and MediaPipe active challenge verification."""

from __future__ import annotations

import base64
import hashlib
import os
import threading
import time
from dataclasses import dataclass
from typing import Any, Literal

import cv2
import mediapipe as mp
import numpy as np
import onnxruntime as ort
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

MatchHint = Literal[
    "NONE",
    "FACE_NOT_DETECTED",
    "MULTIPLE_FACES_DETECTED",
    "POOR_IMAGE_QUALITY",
]
LivenessDecision = Literal["LIVE", "FAILED"]

# 6-point Eye Aspect Ratio indices in MediaPipe 478-point topology
LEFT_EYE_IDX = (33, 160, 158, 133, 153, 144)
RIGHT_EYE_IDX = (362, 385, 387, 263, 373, 380)
NOSE_TIP_IDX = 1
RIGHT_CHEEK_IDX = 234  # Subject's right cheek (smaller x in unmirrored front camera)
LEFT_CHEEK_IDX = 454   # Subject's left cheek (larger x in unmirrored front camera)

MAX_FRAME_BYTES = 4 * 1024 * 1024
MIN_FACE_SIZE_PX = 56


@dataclass
class FrameMetrics:
    index: int
    sha256: str
    gray_thumb: np.ndarray
    luma_mean: float
    luma_std: float
    sharpness: float
    face_count: int
    primary_box: list[int] | None  # [x, y, w, h]
    face_prob: float
    ear: float | None
    blink_score: float | None
    yaw_proxy: float | None
    landmarks_detected: bool


def _decode_base64_image(data_or_url: str) -> tuple[np.ndarray, str]:
    raw = data_or_url.strip()
    if raw.startswith("data:"):
        comma_idx = raw.find(",")
        if comma_idx < 0:
            raise ValueError("Malformed image data URL.")
        raw = raw[comma_idx + 1 :]
    binary = base64.b64decode(raw, validate=True)
    if not binary or len(binary) > MAX_FRAME_BYTES:
        raise ValueError("Image payload is empty or exceeds maximum frame size.")
    arr = np.frombuffer(binary, dtype=np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is None or image.size == 0:
        raise ValueError("Unable to decode image bytes.")
    digest = hashlib.sha256(image.tobytes()).hexdigest()
    return image, digest


def _compute_ear(landmarks: list[Any], indices: tuple[int, ...], w: int, h: int) -> float:
    pts = [np.array([landmarks[i].x * w, landmarks[i].y * h], dtype=np.float32) for i in indices]
    vert_a = np.linalg.norm(pts[1] - pts[5])
    vert_b = np.linalg.norm(pts[2] - pts[4])
    horiz = np.linalg.norm(pts[0] - pts[3])
    if horiz < 1e-4:
        return 0.0
    return float((vert_a + vert_b) / (2.0 * horiz))


def _softmax(logits: np.ndarray) -> np.ndarray:
    shifted = logits - np.max(logits, axis=1, keepdims=True)
    exp_x = np.exp(shifted)
    return exp_x / np.sum(exp_x, axis=1, keepdims=True)


class MiniFASNetOnnx:
    """MiniFASNet ONNX passive anti-spoofing classifier."""

    def __init__(self, model_path: str, scale: float) -> None:
        self.scale = scale
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = int(os.environ.get("OMP_NUM_THREADS", "2"))
        opts.inter_op_num_threads = 1
        self.session = ort.InferenceSession(
            model_path,
            sess_options=opts,
            providers=["CPUExecutionProvider"],
        )
        in_cfg = self.session.get_inputs()[0]
        self.input_name = in_cfg.name
        self.input_hw = (int(in_cfg.shape[2]), int(in_cfg.shape[3]))
        self.output_name = self.session.get_outputs()[0].name

    def _crop_face(self, image: np.ndarray, box_xywh: list[int]) -> np.ndarray:
        src_h, src_w = image.shape[:2]
        x, y, box_w, box_h = box_xywh
        box_w = max(box_w, 1)
        box_h = max(box_h, 1)
        scale = min((src_h - 1) / box_h, (src_w - 1) / box_w, self.scale)
        new_w = box_w * scale
        new_h = box_h * scale
        cx = x + box_w / 2.0
        cy = y + box_h / 2.0
        x1 = max(0, int(cx - new_w / 2.0))
        y1 = max(0, int(cy - new_h / 2.0))
        x2 = min(src_w - 1, int(cx + new_w / 2.0))
        y2 = min(src_h - 1, int(cy + new_h / 2.0))
        crop = image[y1 : y2 + 1, x1 : x2 + 1]
        if crop.size == 0:
            crop = image
        return cv2.resize(crop, (self.input_hw[1], self.input_hw[0]))

    def predict_probs(self, image: np.ndarray, box_xywh: list[int]) -> tuple[float, float, float]:
        crop = self._crop_face(image, box_xywh).astype(np.float32)
        tensor = np.expand_dims(np.transpose(crop, (2, 0, 1)), axis=0)
        logits = self.session.run([self.output_name], {self.input_name: tensor})[0]
        probs = _softmax(logits)[0]
        # Silent-Face-Anti-Spoofing 3-class convention: 0=2D/print fake, 1=live, 2=replay/3D
        fake_print = float(probs[0]) if probs.shape[0] >= 1 else 0.0
        live = float(probs[1]) if probs.shape[0] >= 2 else 0.0
        fake_replay = float(probs[2]) if probs.shape[0] >= 3 else 0.0
        return live, fake_print, fake_replay


class LivenessEngine:
    """Thread-safe passive ONNX + active challenge liveness verification engine."""

    def __init__(self, model_dir: str, passive_threshold: float = 0.62) -> None:
        self.model_dir = model_dir
        self.passive_threshold = passive_threshold
        self._lock = threading.Lock()

        v2_path = os.path.join(model_dir, "MiniFASNetV2.onnx")
        v1se_path = os.path.join(model_dir, "MiniFASNetV1SE.onnx")
        yunet_path = os.path.join(model_dir, "face_detection_yunet_2023mar.onnx")
        landmarker_path = os.path.join(model_dir, "face_landmarker.task")

        for req_path in (v2_path, v1se_path, yunet_path, landmarker_path):
            if not os.path.isfile(req_path):
                raise FileNotFoundError(f"Required liveness model file not found: {req_path}")

        self.fas_v2 = MiniFASNetOnnx(v2_path, scale=2.7)
        self.fas_v1se = MiniFASNetOnnx(v1se_path, scale=4.0)

        self.face_detector = cv2.FaceDetectorYN.create(
            model=yunet_path,
            config="",
            input_size=(320, 320),
            score_threshold=0.65,
            nms_threshold=0.3,
            top_k=10,
        )

        base_options = mp_python.BaseOptions(model_asset_path=landmarker_path)
        lm_options = mp_vision.FaceLandmarkerOptions(
            base_options=base_options,
            running_mode=mp_vision.RunningMode.IMAGE,
            num_faces=2,
            min_face_detection_confidence=0.45,
            min_face_presence_confidence=0.45,
            output_face_blendshapes=True,
        )
        self.landmarker = mp_vision.FaceLandmarker.create_from_options(lm_options)

    def _inspect_frame(self, idx: int, image: np.ndarray, digest: str) -> FrameMetrics:
        h, w = image.shape[:2]
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        gray_thumb = cv2.resize(gray, (64, 64))
        luma_mean = float(np.mean(gray))
        luma_std = float(np.std(gray))

        # Face detection via YuNet
        self.face_detector.setInputSize((w, h))
        _, faces = self.face_detector.detect(image)

        valid_boxes: list[tuple[list[int], float, float]] = []
        if faces is not None and len(faces) > 0:
            for row in faces:
                bx = max(0, int(row[0]))
                by = max(0, int(row[1]))
                bw = max(1, min(w - bx, int(row[2])))
                bh = max(1, min(h - by, int(row[3])))
                score = float(row[14])
                area = float(bw * bh)
                if score >= 0.65:
                    valid_boxes.append(([bx, by, bw, bh], score, area))

        valid_boxes.sort(key=lambda item: item[2], reverse=True)
        face_count = 0
        primary_box: list[int] | None = None
        face_prob = 0.0
        if valid_boxes:
            primary_box, face_prob, primary_area = valid_boxes[0]
            face_count = 1
            for _, sec_score, sec_area in valid_boxes[1:]:
                if sec_score >= 0.72 and sec_area >= primary_area * 0.22:
                    face_count += 1

        if primary_box is not None:
            px, py, pw, ph = primary_box
            roi = gray[py : min(h, py + ph), px : min(w, px + pw)]
            sharpness = float(cv2.Laplacian(roi, cv2.CV_64F).var()) if roi.size > 0 else 0.0
        else:
            sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())

        # MediaPipe 478-point landmark + blendshape inspection
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        lm_res = self.landmarker.detect(mp_img)

        # Fallback: if YuNet missed due to extreme angle or close crop but MediaPipe found faces
        if face_count == 0 and lm_res.face_landmarks:
            face_count = len(lm_res.face_landmarks)
            pts = lm_res.face_landmarks[0]
            xs = [p.x * w for p in pts]
            ys = [p.y * h for p in pts]
            x1 = max(0, int(min(xs)))
            y1 = max(0, int(min(ys)))
            x2 = min(w - 1, int(max(xs)))
            y2 = min(h - 1, int(max(ys)))
            if x2 > x1 and y2 > y1:
                primary_box = [x1, y1, x2 - x1, y2 - y1]
                face_prob = 0.75
                roi = gray[y1 : y2 + 1, x1 : x2 + 1]
                sharpness = float(cv2.Laplacian(roi, cv2.CV_64F).var()) if roi.size > 0 else sharpness
        elif face_count == 1 and lm_res.face_landmarks and len(lm_res.face_landmarks) > 1:
            face_count = len(lm_res.face_landmarks)

        ear: float | None = None
        blink_score: float | None = None
        yaw_proxy: float | None = None
        landmarks_detected = bool(lm_res.face_landmarks)

        if lm_res.face_landmarks:
            pts = lm_res.face_landmarks[0]
            left_ear = _compute_ear(pts, LEFT_EYE_IDX, w, h)
            right_ear = _compute_ear(pts, RIGHT_EYE_IDX, w, h)
            ear = float((left_ear + right_ear) / 2.0)

            rc_x = pts[RIGHT_CHEEK_IDX].x
            lc_x = pts[LEFT_CHEEK_IDX].x
            nose_x = pts[NOSE_TIP_IDX].x
            cheek_span = abs(lc_x - rc_x)
            if cheek_span > 1e-4:
                mid_x = (rc_x + lc_x) / 2.0
                yaw_proxy = float((nose_x - mid_x) / (cheek_span * 0.5))

            if lm_res.face_blendshapes:
                bs_map = {b.category_name: b.score for b in lm_res.face_blendshapes[0]}
                bl = bs_map.get("eyeBlinkLeft")
                br = bs_map.get("eyeBlinkRight")
                if bl is not None and br is not None:
                    blink_score = float((bl + br) / 2.0)

        return FrameMetrics(
            index=idx,
            sha256=digest,
            gray_thumb=gray_thumb,
            luma_mean=luma_mean,
            luma_std=luma_std,
            sharpness=sharpness,
            face_count=face_count,
            primary_box=primary_box,
            face_prob=face_prob,
            ear=ear,
            blink_score=blink_score,
            yaw_proxy=yaw_proxy,
            landmarks_detected=landmarks_detected,
        )

    def verify(
        self,
        frame_data_urls: list[str],
        challenge_action: str,
        passive_threshold_override: float | None = None,
    ) -> dict[str, Any]:
        started = time.perf_counter()
        threshold = (
            passive_threshold_override
            if passive_threshold_override is not None
            else self.passive_threshold
        )

        if len(frame_data_urls) < 2:
            return {
                "livenessStatus": "FAILED",
                "spoofingSuspected": True,
                "matchHint": "POOR_IMAGE_QUALITY",
                "livenessScore": 0.0,
                "passiveScore": 0.0,
                "printScore": 0.0,
                "replayScore": 0.0,
                "challengePassed": False,
                "challengeAction": challenge_action,
                "bestProbeFrameIndex": 0,
                "reason": "At least 2 sequential camera frames are required for liveness analysis.",
                "telemetry": {"frameCount": len(frame_data_urls)},
            }

        decoded: list[tuple[np.ndarray, str]] = []
        for raw in frame_data_urls[:12]:
            decoded.append(_decode_base64_image(raw))

        with self._lock:
            metrics = [
                self._inspect_frame(idx, img, digest)
                for idx, (img, digest) in enumerate(decoded)
            ]

            # 1. Check multi-face presence across frames
            if any(m.face_count > 1 for m in metrics):
                return {
                    "livenessStatus": "FAILED",
                    "spoofingSuspected": False,
                    "matchHint": "MULTIPLE_FACES_DETECTED",
                    "livenessScore": 0.0,
                    "passiveScore": 0.0,
                    "printScore": 0.0,
                    "replayScore": 0.0,
                    "challengePassed": False,
                    "challengeAction": challenge_action,
                    "bestProbeFrameIndex": 0,
                    "reason": "Multiple faces detected in camera frame. Ensure only you are in view.",
                    "telemetry": {"frameCount": len(metrics)},
                }

            single_face_frames = [
                m for m in metrics if m.face_count == 1 and m.primary_box is not None
            ]
            if not single_face_frames:
                return {
                    "livenessStatus": "FAILED",
                    "spoofingSuspected": False,
                    "matchHint": "FACE_NOT_DETECTED",
                    "livenessScore": 0.0,
                    "passiveScore": 0.0,
                    "printScore": 0.0,
                    "replayScore": 0.0,
                    "challengePassed": False,
                    "challengeAction": challenge_action,
                    "bestProbeFrameIndex": 0,
                    "reason": "No clear human face detected during liveness capture.",
                    "telemetry": {"frameCount": len(metrics)},
                }

            # Pick candidate frontal/sharpest frame index right away for reporting
            def _frontal_key(m: FrameMetrics) -> tuple[float, float]:
                yaw_penalty = abs(m.yaw_proxy) if m.yaw_proxy is not None else 0.5
                return (yaw_penalty, -m.sharpness)

            best_frame = min(single_face_frames, key=_frontal_key)

            # 2. Image quality checks (darkness, overexposure, micro-face, blur)
            dark_or_blown = [
                m for m in single_face_frames if m.luma_mean < 28.0 or m.luma_mean > 246.0
            ]
            if len(dark_or_blown) > len(single_face_frames) / 2:
                return {
                    "livenessStatus": "FAILED",
                    "spoofingSuspected": False,
                    "matchHint": "POOR_IMAGE_QUALITY",
                    "livenessScore": 0.0,
                    "passiveScore": 0.0,
                    "printScore": 0.0,
                    "replayScore": 0.0,
                    "challengePassed": False,
                    "challengeAction": challenge_action,
                    "bestProbeFrameIndex": best_frame.index,
                    "reason": "Insufficient or overly harsh lighting for liveness verification.",
                    "telemetry": {
                        "frameCount": len(metrics),
                        "avgLuma": round(sum(m.luma_mean for m in single_face_frames) / len(single_face_frames), 1),
                    },
                }

            small_face = best_frame.primary_box is not None and (
                best_frame.primary_box[2] < MIN_FACE_SIZE_PX
                or best_frame.primary_box[3] < MIN_FACE_SIZE_PX
            )
            low_contrast = best_frame.luma_std < 11.0
            too_blurry = best_frame.sharpness < 14.0 and max(m.sharpness for m in single_face_frames) < 18.0
            if small_face or low_contrast or too_blurry:
                return {
                    "livenessStatus": "FAILED",
                    "spoofingSuspected": False,
                    "matchHint": "POOR_IMAGE_QUALITY",
                    "livenessScore": 0.0,
                    "passiveScore": 0.0,
                    "printScore": 0.0,
                    "replayScore": 0.0,
                    "challengePassed": False,
                    "challengeAction": challenge_action,
                    "bestProbeFrameIndex": best_frame.index,
                    "reason": "Camera frame is too blurry, distant, or low-contrast for biometric verification.",
                    "telemetry": {
                        "frameCount": len(metrics),
                        "sharpness": round(best_frame.sharpness, 2),
                        "lumaStd": round(best_frame.luma_std, 2),
                    },
                }

            # 3. Duplicate / frozen still-frame guard (catches static prints & identical bursts)
            unique_hashes = len({m.sha256 for m in metrics})
            pair_mads = [
                float(
                    np.mean(
                        np.abs(
                            metrics[i].gray_thumb.astype(np.float32)
                            - metrics[i + 1].gray_thumb.astype(np.float32)
                        )
                    )
                )
                for i in range(len(metrics) - 1)
            ]
            max_pair_mad = max(pair_mads) if pair_mads else 0.0
            if unique_hashes < 2 or max_pair_mad < 0.85:
                return {
                    "livenessStatus": "FAILED",
                    "spoofingSuspected": True,
                    "matchHint": "NONE",
                    "livenessScore": 0.0,
                    "passiveScore": 0.0,
                    "printScore": 1.0,
                    "replayScore": 0.0,
                    "challengePassed": False,
                    "challengeAction": challenge_action,
                    "bestProbeFrameIndex": best_frame.index,
                    "reason": "Static or duplicate camera frames detected; active physical movement is required.",
                    "telemetry": {
                        "uniqueHashes": unique_hashes,
                        "maxPairMad": round(max_pair_mad, 3),
                    },
                }

            # 4. Passive ONNX MiniFASNetV2 + MiniFASNetV1SE ensemble across up to 3 keyframes
            eval_indices: list[int] = [single_face_frames[0].index]
            if len(single_face_frames) >= 3:
                eval_indices.append(single_face_frames[len(single_face_frames) // 2].index)
            if single_face_frames[-1].index not in eval_indices:
                eval_indices.append(single_face_frames[-1].index)
            if best_frame.index not in eval_indices:
                eval_indices.append(best_frame.index)

            passive_scores: list[float] = []
            print_scores: list[float] = []
            replay_scores: list[float] = []

            for fidx in eval_indices[:4]:
                m = metrics[fidx]
                assert m.primary_box is not None
                img = decoded[fidx][0]
                v2_live, v2_print, v2_replay = self.fas_v2.predict_probs(img, m.primary_box)
                v1_live, v1_print, v1_replay = self.fas_v1se.predict_probs(img, m.primary_box)
                passive_scores.append(0.5 * v2_live + 0.5 * v1_live)
                print_scores.append(0.5 * v2_print + 0.5 * v1_print)
                replay_scores.append(0.5 * v2_replay + 0.5 * v1_replay)

        avg_passive = float(sum(passive_scores) / len(passive_scores))
        min_passive = float(min(passive_scores))
        avg_print = float(sum(print_scores) / len(print_scores))
        avg_replay = float(sum(replay_scores) / len(replay_scores))

        # 5. Server-side Active Challenge Validation using extracted MediaPipe landmarks/blendshapes
        challenge_passed = False
        challenge_reason = ""
        ears = [m.ear for m in single_face_frames if m.ear is not None]
        blinks = [m.blink_score for m in single_face_frames if m.blink_score is not None]
        yaws = [m.yaw_proxy for m in single_face_frames if m.yaw_proxy is not None]

        if challenge_action == "BLINK":
            # Real human blink: relative change between eyes open and eyes closed
            ear_span = (max(ears) - min(ears)) if len(ears) >= 2 else 0.0
            has_ear_dip = ear_span >= 0.045 and min(ears) <= 0.22
            has_blendshape_blink = (
                len(blinks) >= 2
                and max(blinks) >= 0.40
                and (max(blinks) - min(blinks)) >= 0.18
            )
            challenge_passed = has_ear_dip or has_blendshape_blink
            if not challenge_passed:
                challenge_reason = "Natural blink response was not observed across the captured frames."
        elif challenge_action == "TURN_LEFT":
            # Positive yaw shift (nose shifts toward +x on unmirrored webcam, or wide signed yaw shift if mirrored sensor)
            baseline_yaw = yaws[0] if yaws else 0.0
            delta_left = (max(yaws) - baseline_yaw) if len(yaws) >= 2 else 0.0
            delta_span = (max(yaws) - min(yaws)) if len(yaws) >= 2 else 0.0
            challenge_passed = delta_left >= 0.14 or (abs(baseline_yaw) < 0.25 and delta_span >= 0.22 and max(yaws) > 0.08)
            if not challenge_passed:
                challenge_reason = "Expected head turn left was not verified across the captured frames."
        elif challenge_action == "TURN_RIGHT":
            baseline_yaw = yaws[0] if yaws else 0.0
            delta_right = (baseline_yaw - min(yaws)) if len(yaws) >= 2 else 0.0
            delta_span = (max(yaws) - min(yaws)) if len(yaws) >= 2 else 0.0
            challenge_passed = delta_right >= 0.14 or (abs(baseline_yaw) < 0.25 and delta_span >= 0.22 and min(yaws) < -0.08)
            if not challenge_passed:
                challenge_reason = "Expected head turn right was not verified across the captured frames."
        else:
            # Passive burst requires real landmark presence + natural micro-motion
            challenge_passed = len(ears) >= 2 and max_pair_mad >= 0.85
            if not challenge_passed:
                challenge_reason = "Natural micro-motion / facial landmarks missing across frames."

        passive_ok = avg_passive >= threshold and min_passive >= (threshold * 0.78)
        is_live = passive_ok and challenge_passed

        if not passive_ok:
            attack_type = "screen replay" if avg_replay > avg_print else "printed or flat photo"
            reason = (
                f"Passive anti-spoofing rejected frame sequence (score {avg_passive:.2f} < {threshold:.2f}, suspected {attack_type})."
            )
            spoofing_suspected = True
        elif not challenge_passed:
            reason = challenge_reason
            spoofing_suspected = True
        else:
            reason = "Active challenge and passive anti-spoofing passed."
            spoofing_suspected = False

        # Combined confidence weighted 70% passive texture/depth + 30% challenge pass
        combined_score = avg_passive * 0.7 + (0.3 if challenge_passed else 0.0)
        elapsed_ms = round((time.perf_counter() - started) * 1000.0, 1)

        return {
            "livenessStatus": "LIVE" if is_live else "FAILED",
            "spoofingSuspected": spoofing_suspected,
            "matchHint": "NONE",
            "livenessScore": round(combined_score, 4),
            "passiveScore": round(avg_passive, 4),
            "printScore": round(avg_print, 4),
            "replayScore": round(avg_replay, 4),
            "challengePassed": challenge_passed,
            "challengeAction": challenge_action,
            "bestProbeFrameIndex": best_frame.index,
            "reason": reason,
            "telemetry": {
                "frameCount": len(metrics),
                "singleFaceFrames": len(single_face_frames),
                "uniqueHashes": unique_hashes,
                "maxPairMad": round(max_pair_mad, 3),
                "minPassiveScore": round(min_passive, 4),
                "yawRange": [round(min(yaws), 3), round(max(yaws), 3)] if yaws else None,
                "earRange": [round(min(ears), 3), round(max(ears), 3)] if ears else None,
                "blinkRange": [round(min(blinks), 3), round(max(blinks), 3)] if blinks else None,
                "elapsedMs": elapsed_ms,
            },
        }
