"""FastAPI HTTP server for HRMS self-hosted liveness & anti-spoofing verification."""

from __future__ import annotations

import hmac
import logging
import os
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field

from app.engine import LivenessEngine

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("hrms-liveness")

MODEL_DIR = os.environ.get("LIVENESS_MODEL_DIR", "/app/models")
PASSIVE_THRESHOLD = float(os.environ.get("LIVENESS_PASSIVE_THRESHOLD", "0.62"))
SERVICE_API_KEY = os.environ.get("LIVENESS_API_KEY", "").strip()

app = FastAPI(
    title="HRMS Self-Hosted Liveness Verification Service",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
)

engine: LivenessEngine | None = None


@app.on_event("startup")
def _startup() -> None:
    global engine
    engine = LivenessEngine(model_dir=MODEL_DIR, passive_threshold=PASSIVE_THRESHOLD)
    logger.info(
        "LivenessEngine initialized (model_dir=%s, passive_threshold=%.2f, api_key_configured=%s)",
        MODEL_DIR,
        PASSIVE_THRESHOLD,
        bool(SERVICE_API_KEY),
    )


def _require_api_key(x_api_key: str | None = Header(default=None, alias="x-api-key")) -> None:
    if not SERVICE_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Liveness service API key is not configured.",
        )
    if not x_api_key or not hmac.compare_digest(x_api_key.encode("utf-8"), SERVICE_API_KEY.encode("utf-8")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized liveness verification request.",
        )


class VerifyLivenessRequest(BaseModel):
    challengeAction: Literal["BLINK", "TURN_LEFT", "TURN_RIGHT", "PASSIVE_BURST"] = "BLINK"
    frames: list[str] = Field(..., min_length=2, max_length=12)
    passiveThreshold: float | None = Field(default=None, ge=0.1, le=0.99)


@app.get("/health")
def health() -> dict[str, object]:
    if engine is None:
        raise HTTPException(status_code=503, detail="Liveness engine not ready.")
    return {
        "status": "ok",
        "models": ["MiniFASNetV2", "MiniFASNetV1SE", "YuNet", "MediaPipeFaceLandmarker"],
        "passiveThreshold": PASSIVE_THRESHOLD,
        "apiKeyConfigured": bool(SERVICE_API_KEY),
    }


@app.post("/api/v1/liveness/verify", dependencies=[Depends(_require_api_key)])
def verify_liveness(payload: VerifyLivenessRequest) -> dict[str, object]:
    if engine is None:
        raise HTTPException(status_code=503, detail="Liveness engine not initialized.")
    try:
        return engine.verify(
            frame_data_urls=payload.frames,
            challenge_action=payload.challengeAction,
            passive_threshold_override=payload.passiveThreshold,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
