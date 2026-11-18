import { env, type ServerEnvConfig } from '../config/env.js';
import { logger } from '../utils/logger.js';

export type FaceMatchStatus =
  | 'VERIFIED'
  | 'MISMATCH'
  | 'SPOOFING_SUSPECTED'
  | 'PROVIDER_UNCONFIGURED'
  | 'FAILED'
  | 'FACE_NOT_DETECTED'
  | 'MULTIPLE_FACES_DETECTED'
  | 'POOR_IMAGE_QUALITY';

export type LivenessStatus = 'LIVE' | 'FAILED' | 'UNAVAILABLE' | 'PENDING';

export interface FaceVerificationRequest {
  employeeId: string;
  organizationId: string;
  probeImageDataUrl: string;
  enrolledTemplateReference?: string | null;
  enrolledReferenceSignedUrl?: string | null;
  expectedSubject?: string | null;
  employeeCode?: string | null;
  attemptNumber: number;
}

export interface FaceVerificationResponse {
  providerName: string;
  matchStatus: FaceMatchStatus;
  livenessStatus: LivenessStatus;
  confidenceScore: number | null;
  failureReason?: string;
}

export interface FaceVerificationAdapter {
  readonly providerName: string;
  verify(input: FaceVerificationRequest): Promise<FaceVerificationResponse>;
}

export type FaceProviderConfig = Pick<
  ServerEnvConfig,
  | 'FACE_PROVIDER'
  | 'FACE_PROVIDER_URL'
  | 'FACE_PROVIDER_API_KEY'
  | 'COMPREFACE_BASE_URL'
  | 'COMPREFACE_API_KEY'
  | 'COMPREFACE_SIMILARITY_THRESHOLD'
  | 'COMPREFACE_DET_PROB_THRESHOLD'
  | 'COMPREFACE_TIMEOUT_MS'
  | 'COMPREFACE_MAX_RETRIES'
>;

export interface ParsedProbeImage {
  buffer: Buffer;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  extension: 'jpg' | 'png' | 'webp';
}

interface CompreFaceRecognitionSubject {
  subject?: unknown;
  similarity?: unknown;
}

interface CompreFaceRecognitionResultItem {
  box?: {
    probability?: unknown;
  };
  subjects?: CompreFaceRecognitionSubject[];
}

interface CompreFaceRecognizeResponse {
  result?: CompreFaceRecognitionResultItem[];
  code?: unknown;
  message?: unknown;
}

const MAX_PROBE_IMAGE_BYTES = 5 * 1024 * 1024;
const TRANSIENT_HTTP_STATUSES = new Set([429, 502, 503, 504]);
const TRANSIENT_RETRY_DELAY_MS = 250;

/**
 * Validates a base64 image data URL and verifies container magic bytes before transmitting toCompreFace.
 */
export function parseProbeImageDataUrl(
  dataUrl: string
): { ok: true; image: ParsedProbeImage } | { ok: false; reason: string } {
  const trimmed = dataUrl.trim();
  const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(trimmed);
  if (!match) {
    return {
      ok: false,
      reason: 'Selfie image must be a valid base64-encoded JPEG, PNG, or WebP data URL.',
    };
  }

  const rawMime = match[1]!.toLowerCase();
  const cleanBase64 = match[2]!.replace(/\s+/g, '');
  if (!cleanBase64 || cleanBase64.length % 4 !== 0) {
    return { ok: false, reason: 'Selfie image payload has malformed base64 encoding.' };
  }

  const buffer = Buffer.from(cleanBase64, 'base64');
  if (buffer.length < 16) {
    return { ok: false, reason: 'Selfie image payload is empty or truncated.' };
  }
  if (buffer.length > MAX_PROBE_IMAGE_BYTES) {
    return { ok: false, reason: 'Selfie image exceeds the 5 MB biometric upload limit.' };
  }

  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
  const isWebp =
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';

  if (rawMime === 'image/jpeg' || rawMime === 'image/jpg') {
    if (!isJpeg) {
      return { ok: false, reason: 'Selfie header declares JPEG but binary signature is invalid.' };
    }
    return { ok: true, image: { buffer, mimeType: 'image/jpeg', extension: 'jpg' } };
  }

  if (rawMime === 'image/png') {
    if (!isPng) {
      return { ok: false, reason: 'Selfie header declares PNG but binary signature is invalid.' };
    }
    return { ok: true, image: { buffer, mimeType: 'image/png', extension: 'png' } };
  }

  if (!isWebp) {
    return { ok: false, reason: 'Selfie header declares WebP but binary signature is invalid.' };
  }
  return { ok: true, image: { buffer, mimeType: 'image/webp', extension: 'webp' } };
}

/**
 * Resolves the expected CompreFace subject from explicit subject override or enrolled template reference.
 */
export function resolveExpectedCompreFaceSubject(input: FaceVerificationRequest): string | null {
  const explicit = input.expectedSubject?.trim();
  if (explicit) {
    return explicit;
  }

  const ref = input.enrolledTemplateReference?.trim();
  if (!ref) {
    return null;
  }

  if (ref.toLowerCase().startsWith('compreface:')) {
    const stripped = ref.slice('compreface:'.length).trim();
    return stripped || null;
  }

  return ref;
}

function sanitizeProviderMessage(message: string, apiKey?: string): string {
  let clean = message;
  if (apiKey) {
    clean = clean.split(apiKey).join('[REDACTED]');
  }
  clean = clean.replace(/API Key\s+[A-Za-z0-9-]+/gi, 'API Key [REDACTED]');
  clean = clean.replace(/x-api-key[:\s]+[A-Za-z0-9-]+/gi, 'x-api-key [REDACTED]');
  return clean.slice(0, 240);
}

function normalizeSimilarityScore(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return null;
  }
  const clamped = Math.min(1, Math.max(0, raw));
  return Number(clamped.toFixed(4));
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || /abort|timeout/i.test(err.message));
}

async function sleepMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Provider-independent biometric verification adapter.
 * Supports:
 * - 'unconfigured': returns PROVIDER_UNCONFIGURED / UNAVAILABLE without faking passes.
 * - 'compreface': integrates CompreFace 1.2.0 Recognition API (`POST /api/v1/recognition/recognize`)
 *   using server-side API key auth (`x-api-key`) while preserving liveness as a separate boundary.
 * - 'http': generic external biometric webhook integration.
 */
export class ConfiguredFaceVerificationAdapter implements FaceVerificationAdapter {
  public readonly providerName: string;
  private readonly getConfig: () => FaceProviderConfig;

  constructor(config?: FaceProviderConfig) {
    this.getConfig = config ? () => config : () => env;
    const initial = this.getConfig();
    if (initial.FACE_PROVIDER === 'compreface') {
      this.providerName = 'compreface';
    } else if (initial.FACE_PROVIDER === 'http' && initial.FACE_PROVIDER_URL) {
      this.providerName = 'external-http-biometric-provider';
    } else {
      this.providerName = 'unconfigured';
    }
  }

  async verify(input: FaceVerificationRequest): Promise<FaceVerificationResponse> {
    const config = this.getConfig();

    if (config.FACE_PROVIDER === 'compreface') {
      return this.verifyWithCompreFace(input, config);
    }

    if (config.FACE_PROVIDER === 'http') {
      return this.verifyWithHttpProvider(input, config);
    }

    return {
      providerName: 'unconfigured',
      matchStatus: 'PROVIDER_UNCONFIGURED',
      livenessStatus: 'UNAVAILABLE',
      confidenceScore: null,
      failureReason:
        'No external live face verification provider is configured (FACE_PROVIDER=unconfigured). Marked for Admin/manual verification.',
    };
  }

  private async verifyWithCompreFace(
    input: FaceVerificationRequest,
    config: FaceProviderConfig
  ): Promise<FaceVerificationResponse> {
    const baseUrl = config.COMPREFACE_BASE_URL.trim().replace(/\/+$/, '');
    const apiKey = config.COMPREFACE_API_KEY.trim();

    if (!baseUrl || !apiKey) {
      return {
        providerName: 'unconfigured',
        matchStatus: 'PROVIDER_UNCONFIGURED',
        livenessStatus: 'UNAVAILABLE',
        confidenceScore: null,
        failureReason:
          'CompreFace provider credentials are incomplete. Marked for Admin/manual verification.',
      };
    }

    const expectedSubject = resolveExpectedCompreFaceSubject(input);
    if (!expectedSubject) {
      return {
        providerName: 'compreface',
        matchStatus: 'FAILED',
        livenessStatus: 'PENDING',
        confidenceScore: null,
        failureReason: 'Employee has no approved enrolled CompreFace subject reference.',
      };
    }

    const parsed = parseProbeImageDataUrl(input.probeImageDataUrl);
    if (!parsed.ok) {
      return {
        providerName: 'compreface',
        matchStatus: 'POOR_IMAGE_QUALITY',
        livenessStatus: 'UNAVAILABLE',
        confidenceScore: null,
        failureReason: parsed.reason,
      };
    }

    const recognizeUrl = new URL(`${baseUrl}/api/v1/recognition/recognize`);
    recognizeUrl.searchParams.set('limit', '0');
    recognizeUrl.searchParams.set('prediction_count', '5');
    recognizeUrl.searchParams.set(
      'det_prob_threshold',
      String(config.COMPREFACE_DET_PROB_THRESHOLD)
    );

    let lastResponse: Response | null = null;
    let lastError: unknown = null;
    const maxAttempts = Math.max(1, config.COMPREFACE_MAX_RETRIES + 1);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), config.COMPREFACE_TIMEOUT_MS);

      try {
        const formData = new FormData();
        const blob = new Blob([new Uint8Array(parsed.image.buffer)], {
          type: parsed.image.mimeType,
        });
        formData.append('file', blob, `probe.${parsed.image.extension}`);

        const response = await fetch(recognizeUrl.toString(), {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
          },
          body: formData,
          signal: controller.signal,
        });

        clearTimeout(timeoutHandle);
        lastResponse = response;
        lastError = null;

        if (response.ok) {
          break;
        }

        if (!TRANSIENT_HTTP_STATUSES.has(response.status) || attempt === maxAttempts) {
          break;
        }
      } catch (err) {
        clearTimeout(timeoutHandle);
        lastError = err;
        lastResponse = null;

        if (attempt === maxAttempts) {
          break;
        }
      }

      await sleepMs(TRANSIENT_RETRY_DELAY_MS * attempt);
    }

    if (lastError !== null || !lastResponse) {
      const timedOut = isAbortError(lastError);
      const rawMsg =
        lastError instanceof Error ? lastError.message : 'CompreFace request failed';
      const sanitized = sanitizeProviderMessage(rawMsg, apiKey);

      logger.warn('CompreFace recognition transport failure', {
        providerName: 'compreface',
        timedOut,
        error: sanitized,
      });

      return {
        providerName: 'compreface',
        matchStatus: 'FAILED',
        livenessStatus: 'UNAVAILABLE',
        confidenceScore: null,
        failureReason: timedOut
          ? 'CompreFace face verification timed out; queued for Admin verification.'
          : 'CompreFace face verification service is unavailable; queued for Admin verification.',
      };
    }

    let payload: CompreFaceRecognizeResponse | null = null;
    try {
      payload = (await lastResponse.json()) as CompreFaceRecognizeResponse;
    } catch {
      payload = null;
    }

    if (!lastResponse.ok) {
      const providerCode = typeof payload?.code === 'number' ? payload.code : undefined;
      const rawMessage = typeof payload?.message === 'string' ? payload.message : '';
      const sanitizedMsg = sanitizeProviderMessage(rawMessage, apiKey);

      if (
        lastResponse.status === 400 &&
        (providerCode === 28 || /no face/i.test(sanitizedMsg))
      ) {
        return {
          providerName: 'compreface',
          matchStatus: 'FACE_NOT_DETECTED',
          livenessStatus: 'UNAVAILABLE',
          confidenceScore: null,
          failureReason: 'No face was detected in the submitted selfie.',
        };
      }

      logger.warn('CompreFace recognition returned error status', {
        providerName: 'compreface',
        httpStatus: lastResponse.status,
        providerCode,
        message: sanitizedMsg,
      });

      const isAuthOrConfigErr =
        lastResponse.status === 401 ||
        lastResponse.status === 403 ||
        (lastResponse.status === 404 && (providerCode === 10 || /api key/i.test(rawMessage))) ||
        (lastResponse.status === 400 && providerCode === 20);

      return {
        providerName: 'compreface',
        matchStatus: 'FAILED',
        livenessStatus: 'UNAVAILABLE',
        confidenceScore: null,
        failureReason: isAuthOrConfigErr
          ? 'CompreFace service authentication or endpoint configuration error; queued for Admin verification.'
          : `CompreFace verification service returned HTTP ${lastResponse.status}.`,
      };
    }

    const faces = Array.isArray(payload?.result) ? payload.result : [];
    if (faces.length === 0) {
      return {
        providerName: 'compreface',
        matchStatus: 'FACE_NOT_DETECTED',
        livenessStatus: 'UNAVAILABLE',
        confidenceScore: null,
        failureReason: 'No face was detected in the submitted selfie.',
      };
    }

    if (faces.length > 1) {
      return {
        providerName: 'compreface',
        matchStatus: 'MULTIPLE_FACES_DETECTED',
        livenessStatus: 'UNAVAILABLE',
        confidenceScore: null,
        failureReason:
          'Multiple faces detected in the selfie. Ensure only the employee is visible in frame.',
      };
    }

    const detected = faces[0]!;
    const boxProb =
      typeof detected.box?.probability === 'number' && Number.isFinite(detected.box.probability)
        ? detected.box.probability
        : null;
    if (boxProb !== null && boxProb < config.COMPREFACE_DET_PROB_THRESHOLD) {
      return {
        providerName: 'compreface',
        matchStatus: 'POOR_IMAGE_QUALITY',
        livenessStatus: 'UNAVAILABLE',
        confidenceScore: null,
        failureReason: 'Face detection confidence is too low; retake selfie in clear lighting.',
      };
    }

    const candidates = Array.isArray(detected.subjects) ? detected.subjects : [];
    if (candidates.length === 0) {
      return {
        providerName: 'compreface',
        matchStatus: 'MISMATCH',
        livenessStatus: 'UNAVAILABLE',
        confidenceScore: 0,
        failureReason: 'Unknown face: no matching subject found in CompreFace.',
      };
    }

    const topCandidate = candidates[0]!;
    const matchedSubject =
      typeof topCandidate.subject === 'string' ? topCandidate.subject.trim() : '';
    const confidenceScore = normalizeSimilarityScore(topCandidate.similarity);

    // Identity check: top recognized subject MUST match the authenticated employee's mapped subject.
    if (!matchedSubject || matchedSubject !== expectedSubject) {
      return {
        providerName: 'compreface',
        matchStatus: 'MISMATCH',
        livenessStatus: 'UNAVAILABLE',
        confidenceScore,
        failureReason:
          confidenceScore !== null && confidenceScore >= config.COMPREFACE_SIMILARITY_THRESHOLD
            ? 'Recognized face belongs to a different subject than the authenticated employee.'
            : 'Unknown face or subject mismatch for the authenticated employee.',
      };
    }

    if (confidenceScore === null || confidenceScore < config.COMPREFACE_SIMILARITY_THRESHOLD) {
      return {
        providerName: 'compreface',
        matchStatus: 'MISMATCH',
        livenessStatus: 'UNAVAILABLE',
        confidenceScore,
        failureReason: 'Face similarity score is below the configured verification threshold.',
      };
    }

    // CompreFace 1.2.0 performs 2D face recognition only and does not prove live anti-spoofing.
    // Liveness stays UNAVAILABLE unless an independent liveness check confirms LIVE.
    return {
      providerName: 'compreface',
      matchStatus: 'VERIFIED',
      livenessStatus: 'UNAVAILABLE',
      confidenceScore,
    };
  }

  private async verifyWithHttpProvider(
    input: FaceVerificationRequest,
    config: FaceProviderConfig
  ): Promise<FaceVerificationResponse> {
    if (!config.FACE_PROVIDER_URL.trim()) {
      return {
        providerName: 'unconfigured',
        matchStatus: 'PROVIDER_UNCONFIGURED',
        livenessStatus: 'UNAVAILABLE',
        confidenceScore: null,
        failureReason:
          'FACE_PROVIDER=http selected without FACE_PROVIDER_URL. Marked for Admin/manual verification.',
      };
    }

    if (!input.enrolledTemplateReference && !input.enrolledReferenceSignedUrl) {
      return {
        providerName: 'external-http-biometric-provider',
        matchStatus: 'FAILED',
        livenessStatus: 'PENDING',
        confidenceScore: null,
        failureReason: 'Employee has no approved enrolled reference template.',
      };
    }

    try {
      const response = await fetch(config.FACE_PROVIDER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.FACE_PROVIDER_API_KEY
            ? { Authorization: `Bearer ${config.FACE_PROVIDER_API_KEY}` }
            : {}),
        },
        body: JSON.stringify({
          employeeId: input.employeeId,
          organizationId: input.organizationId,
          probeImageDataUrl: input.probeImageDataUrl,
          enrolledTemplateReference: input.enrolledTemplateReference,
          enrolledReferenceSignedUrl: input.enrolledReferenceSignedUrl,
          livenessRequired: true,
        }),
      });

      if (!response.ok) {
        return {
          providerName: 'external-http-biometric-provider',
          matchStatus: 'FAILED',
          livenessStatus: 'UNAVAILABLE',
          confidenceScore: null,
          failureReason: `Biometric verification service returned HTTP ${response.status}`,
        };
      }

      const data = (await response.json()) as {
        matchStatus?: FaceMatchStatus;
        livenessStatus?: LivenessStatus;
        confidenceScore?: number;
        reason?: string;
      };

      const score =
        typeof data.confidenceScore === 'number' && Number.isFinite(data.confidenceScore)
          ? data.confidenceScore
          : null;

      return {
        providerName: 'external-http-biometric-provider',
        matchStatus: data.matchStatus ?? (score !== null && score >= 85 ? 'VERIFIED' : 'MISMATCH'),
        livenessStatus: data.livenessStatus ?? 'UNAVAILABLE',
        confidenceScore: score,
        failureReason: data.reason,
      };
    } catch (err) {
      return {
        providerName: 'external-http-biometric-provider',
        matchStatus: 'FAILED',
        livenessStatus: 'UNAVAILABLE',
        confidenceScore: null,
        failureReason:
          err instanceof Error
            ? `Biometric provider error: ${sanitizeProviderMessage(err.message, config.FACE_PROVIDER_API_KEY)}`
            : 'Biometric provider request failed',
      };
    }
  }
}

export const defaultFaceVerificationAdapter: FaceVerificationAdapter =
  new ConfiguredFaceVerificationAdapter();
