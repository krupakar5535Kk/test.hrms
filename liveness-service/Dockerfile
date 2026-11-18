FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LIVENESS_MODEL_DIR=/app/models

WORKDIR /app

# OpenCV & MediaPipe runtime shared libraries + curl for healthchecks & model download
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    libglib2.0-0 \
    libgl1 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download open-source Apache-2.0 / MIT ONNX & MediaPipe models inside the image
# so runtime requests never depend on external network access.
RUN mkdir -p /app/models && \
    curl -fsSL -o /app/models/MiniFASNetV2.onnx \
      "https://github.com/yakhyo/face-anti-spoofing/releases/download/weights/MiniFASNetV2.onnx" && \
    curl -fsSL -o /app/models/MiniFASNetV1SE.onnx \
      "https://github.com/yakhyo/face-anti-spoofing/releases/download/weights/MiniFASNetV1SE.onnx" && \
    curl -fsSL -o /app/models/face_detection_yunet_2023mar.onnx \
      "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx" && \
    curl -fsSL -o /app/models/face_landmarker.task \
      "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"

COPY app /app/app

# Run as non-root user for defense-in-depth
RUN useradd -m -u 10001 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8100

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8100/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100", "--workers", "1"]
