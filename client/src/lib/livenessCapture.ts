import type {
  FaceLandmarker as MediaPipeFaceLandmarker,
  NormalizedLandmark,
} from '@mediapipe/tasks-vision';

export type LivenessChallengeAction = 'BLINK' | 'TURN_LEFT' | 'TURN_RIGHT';

export interface FrameLivenessObservation {
  facePresent: boolean;
  faceCount: number;
  ear: number | null;
  blinkScore: number | null;
  yawProxy: number | null;
}

const LEFT_EYE_IDX = [33, 160, 158, 133, 153, 144] as const;
const RIGHT_EYE_IDX = [362, 385, 387, 263, 373, 380] as const;

let cachedLandmarkerPromise: Promise<MediaPipeFaceLandmarker | null> | null = null;

function dist2d(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function computeEarFromLandmarks(
  landmarks: NormalizedLandmark[],
  indices: readonly number[]
): number | null {
  if (indices.some((i) => !landmarks[i])) return null;
  const p0 = landmarks[indices[0]!]!;
  const p1 = landmarks[indices[1]!]!;
  const p2 = landmarks[indices[2]!]!;
  const p3 = landmarks[indices[3]!]!;
  const p4 = landmarks[indices[4]!]!;
  const p5 = landmarks[indices[5]!]!;
  const horiz = dist2d(p0, p3);
  if (horiz < 1e-4) return null;
  return (dist2d(p1, p5) + dist2d(p2, p4)) / (2 * horiz);
}

/**
 * Pure observation extractor usable both in browser and Node unit tests.
 */
export function extractObservationFromLandmarks(
  faceLandmarks: NormalizedLandmark[][] | undefined,
  faceBlendshapes?: Array<{ categories?: Array<{ categoryName: string; score: number }> }>
): FrameLivenessObservation {
  if (!faceLandmarks || faceLandmarks.length === 0) {
    return { facePresent: false, faceCount: 0, ear: null, blinkScore: null, yawProxy: null };
  }
  const primary = faceLandmarks[0]!;
  const leftEar = computeEarFromLandmarks(primary, LEFT_EYE_IDX);
  const rightEar = computeEarFromLandmarks(primary, RIGHT_EYE_IDX);
  const ear =
    leftEar !== null && rightEar !== null
      ? (leftEar + rightEar) / 2
      : leftEar ?? rightEar;

  let yawProxy: number | null = null;
  const nose = primary[1];
  const rightCheek = primary[234];
  const leftCheek = primary[454];
  if (nose && rightCheek && leftCheek) {
    const span = Math.abs(leftCheek.x - rightCheek.x);
    if (span > 1e-4) {
      const midX = (rightCheek.x + leftCheek.x) / 2;
      yawProxy = (nose.x - midX) / (span * 0.5);
    }
  }

  let blinkScore: number | null = null;
  const categories = faceBlendshapes?.[0]?.categories;
  if (categories) {
    const bl = categories.find((c) => c.categoryName === 'eyeBlinkLeft')?.score;
    const br = categories.find((c) => c.categoryName === 'eyeBlinkRight')?.score;
    if (typeof bl === 'number' && typeof br === 'number') {
      blinkScore = (bl + br) / 2;
    }
  }

  return {
    facePresent: true,
    faceCount: faceLandmarks.length,
    ear,
    blinkScore,
    yawProxy,
  };
}

/**
 * Evaluates whether an ordered burst of client landmark observations satisfies the challenge.
 * Server-side ONNX/MediaPipe still independently verifies the raw frame bytes.
 */
export function isChallengeObserved(
  action: LivenessChallengeAction,
  observations: FrameLivenessObservation[]
): boolean {
  const singleFace = observations.filter((o) => o.facePresent && o.faceCount === 1);
  if (singleFace.length < 3) return false;

  if (action === 'BLINK') {
    const ears = singleFace.map((o) => o.ear).filter((v): v is number => v !== null);
    const blinks = singleFace.map((o) => o.blinkScore).filter((v): v is number => v !== null);
    const earDip =
      ears.length >= 2 && (Math.max(...ears) - Math.min(...ears) >= 0.045 || Math.min(...ears) <= 0.21);
    const bsDip =
      blinks.length >= 2 &&
      Math.max(...blinks) >= 0.36 &&
      Math.max(...blinks) - Math.min(...blinks) >= 0.16;
    return earDip || bsDip;
  }

  const yaws = singleFace.map((o) => o.yawProxy).filter((v): v is number => v !== null);
  if (yaws.length < 2) return false;
  const baseline = yaws[0]!;
  if (action === 'TURN_LEFT') {
    return Math.max(...yaws) - baseline >= 0.14;
  }
  return baseline - Math.min(...yaws) >= 0.14;
}

/**
 * Loads the self-hosted MediaPipe FaceLandmarker if browser WebGL/WASM is available.
 * Returns null gracefully on unsupported headless/restricted devices so server fallback burst still runs.
 */
export async function getBrowserFaceLandmarker(): Promise<MediaPipeFaceLandmarker | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }
  if (cachedLandmarkerPromise) {
    return cachedLandmarkerPromise;
  }

  cachedLandmarkerPromise = (async () => {
    try {
      const vision = await import('@mediapipe/tasks-vision');
      const resolver = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');
      const landmarker = await vision.FaceLandmarker.createFromOptions(resolver, {
        baseOptions: {
          modelAssetPath: '/mediapipe/face_landmarker.task',
        },
        runningMode: 'IMAGE',
        numFaces: 2,
        outputFaceBlendshapes: true,
        minFaceDetectionConfidence: 0.45,
        minFacePresenceConfidence: 0.45,
      });
      return landmarker;
    } catch {
      return null;
    }
  })();

  return cachedLandmarkerPromise;
}

/**
 * Captures a bandwidth-efficient scaled JPEG frame from an active <video> element.
 */
export function captureScaledVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  maxWidth = 480,
  quality = 0.78
): string | null {
  if (!video.videoWidth || !video.videoHeight || video.readyState < 2) {
    return null;
  }
  const scale = Math.min(1, maxWidth / video.videoWidth);
  canvas.width = Math.max(160, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(120, Math.round(video.videoHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}
