import crypto from 'node:crypto';
import { env, type ServerEnvConfig } from '../config/env.js';
import { getPool } from '../db/pool.js';
import { logger } from '../utils/logger.js';
import { parseProbeImageDataUrl, type LivenessStatus } from './faceVerificationAdapter.js';

export type LivenessChallengeAction = 'BLINK' | 'TURN_LEFT' | 'TURN_RIGHT';

export type LivenessMatchHint =
  | 'NONE'
  | 'FACE_NOT_DETECTED'
  | 'MULTIPLE_FACES_DETECTED'
  | 'POOR_IMAGE_QUALITY';

export interface IssuedLivenessChallenge {
  challengeToken: string;
  action: LivenessChallengeAction;
  prompt: string;
  expiresAt: string;
  ttlSeconds: number;
}

export interface LivenessVerificationRequest {
  organizationId: string;
  employeeId: string;
  direction: 'CHECK_IN' | 'CHECK_OUT';
  frames: string[];
  challengeToken?: string | null;
  challengeActionOverride?: LivenessChallengeAction | null;
}

export interface LivenessVerificationResult {
  providerName: string;
  livenessStatus: LivenessStatus;
  spoofingSuspected: boolean;
  matchHint: LivenessMatchHint;
  livenessScore: number | null;
  passiveScore: number | null;
  printScore: number | null;
  replayScore: number | null;
  challengeAction: LivenessChallengeAction | null;
  challengePassed: boolean;
  bestProbeFrameIndex: number;
  bestProbeDataUrl: string | null;
  failureReason?: string;
  telemetry?: Record<string, unknown>;
}

export interface LivenessVerificationAdapter {
  readonly providerName: string;
  issueChallenge(params: {
    organizationId: string;
    employeeId: string;
    direction: 'CHECK_IN' | 'CHECK_OUT';
    preferredAction?: LivenessChallengeAction;
  }): IssuedLivenessChallenge;
  verify(input: LivenessVerificationRequest): Promise<LivenessVerificationResult>;
}

export type LivenessProviderConfig = Pick<
  ServerEnvConfig,
  | 'LIVENESS_PROVIDER'
  | 'LIVENESS_BASE_URL'
  | 'LIVENESS_API_KEY'
  | 'LIVENESS_PASSIVE_THRESHOLD'
  | 'LIVENESS_CHALLENGE_TTL_MS'
  | 'LIVENESS_TIMEOUT_MS'
  | 'LIVENESS_MAX_RETRIES'
  | 'TX_CONTEXT_HMAC_KEY'
>;

interface ChallengePayload {
  v: 1;
  nonce: string;
  orgId: string;
  empId: string;
  dir: 'CHECK_IN' | 'CHECK_OUT';
  action: LivenessChallengeAction;
  exp: number;
}

interface SidecarLivenessResponse {
  livenessStatus?: unknown;
  spoofingSuspected?: unknown;
  matchHint?: unknown;
  livenessScore?: unknown;
  passiveScore?: unknown;
  printScore?: unknown;
  replayScore?: unknown;
  challengePassed?: unknown;
  challengeAction?: unknown;
  bestProbeFrameIndex?: unknown;
  reason?: unknown;
  telemetry?: unknown;
}

const CHALLENGE_ACTIONS: readonly LivenessChallengeAction[] = [
  'BLINK',
  'TURN_LEFT',
  'TURN_RIGHT',
];

const CHALLENGE_PROMPTS: Record<LivenessChallengeAction, string> = {
  BLINK: 'Look at the camera, then blink naturally once.',
  TURN_LEFT: 'Look straight ahead, then slowly turn your head slightly left.',
  TURN_RIGHT: 'Look straight ahead, then slowly turn your head slightly right.',
};

const TRANSIENT_HTTP_STATUSES = new Set([429, 502, 503, 504]);
const TRANSIENT_RETRY_DELAY_MS = 250;
const CHALLENGE_DOMAIN_TAG = 'HRMS_LIVENESS_CHALLENGE_V1';
const MAX_CHALLENGE_FRAMES = 12;

function toBase64Url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function fromBase64Url(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

function computeChallengeMac(encodedPayload: string, hmacKeyHex: string): string {
  return crypto
    .createHmac('sha256', hmacKeyHex)
    .update(`${CHALLENGE_DOMAIN_TAG}:${encodedPayload}`)
    .digest('base64url');
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(4)) : null;
}

function normalizeMatchHint(value: unknown): LivenessMatchHint {
  if (
    value === 'FACE_NOT_DETECTED' ||
    value === 'MULTIPLE_FACES_DETECTED' ||
    value === 'POOR_IMAGE_QUALITY'
  ) {
    return value;
  }
  return 'NONE';
}

export interface LivenessNonceRecord {
  nonce: string;
  organizationId: string;
  employeeId: string;
  direction: 'CHECK_IN' | 'CHECK_OUT';
  action: LivenessChallengeAction;
  expiresAt: Date;
}

export interface LivenessNonceStore {
  consumeNonce(
    record: LivenessNonceRecord
  ): Promise<{ ok: boolean; replaySuspected: boolean; reason?: string }>;
}

export class PostgresLivenessNonceStore implements LivenessNonceStore {
  private lastPrunedAt = 0;
  private readonly PRUNE_INTERVAL_MS = 60_000;

  async consumeNonce(
    record: LivenessNonceRecord
  ): Promise<{ ok: boolean; replaySuspected: boolean; reason?: string }> {
    try {
      const pool = getPool();
      const res = await pool.query<{ nonce: string }>(
        `INSERT INTO public.liveness_challenge_nonces (
           nonce,
           organization_id,
           employee_id,
           punch_direction,
           action,
           expires_at
         )
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::varchar, $5::varchar, $6::timestamptz)
         ON CONFLICT (nonce) DO NOTHING
         RETURNING nonce;`,
        [
          record.nonce,
          record.organizationId,
          record.employeeId,
          record.direction,
          record.action,
          record.expiresAt.toISOString(),
        ]
      );

      if ((res.rowCount ?? 0) === 0) {
        return {
          ok: false,
          replaySuspected: true,
          reason: 'Liveness challenge token was already used (replay attempt blocked).',
        };
      }

      const now = Date.now();
      if (now - this.lastPrunedAt > this.PRUNE_INTERVAL_MS) {
        this.lastPrunedAt = now;
        pool
          .query(
            `DELETE FROM public.liveness_challenge_nonces
             WHERE expires_at < NOW() - INTERVAL '5 minutes';`
          )
          .catch((pruneErr: unknown) => {
            logger.warn('Failed to prune expired liveness nonces', {
              error: pruneErr instanceof Error ? pruneErr.message : String(pruneErr),
            });
          });
      }

      return { ok: true, replaySuspected: false };
    } catch (err) {
      logger.error('Liveness nonce store query failure; failing closed', {
        nonce: record.nonce,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        ok: false,
        replaySuspected: false,
        reason: 'Liveness nonce verification store unavailable.',
      };
    }
  }
}

export class InMemoryLivenessNonceStore implements LivenessNonceStore {
  private readonly nonces = new Map<string, number>();

  async consumeNonce(
    record: LivenessNonceRecord
  ): Promise<{ ok: boolean; replaySuspected: boolean; reason?: string }> {
    const now = Date.now();
    for (const [key, exp] of this.nonces.entries()) {
      if (exp <= now) {
        this.nonces.delete(key);
      }
    }

    if (this.nonces.has(record.nonce)) {
      return {
        ok: false,
        replaySuspected: true,
        reason: 'Liveness challenge token was already used (replay attempt blocked).',
      };
    }

    this.nonces.set(record.nonce, record.expiresAt.getTime());
    return { ok: true, replaySuspected: false };
  }
}

export class ConfiguredLivenessVerificationAdapter implements LivenessVerificationAdapter {
  private readonly cfg: LivenessProviderConfig;
  private readonly nonceStore: LivenessNonceStore;

  constructor(config?: Partial<LivenessProviderConfig>, nonceStore?: LivenessNonceStore) {
    this.cfg = {
      LIVENESS_PROVIDER: config?.LIVENESS_PROVIDER ?? env.LIVENESS_PROVIDER,
      LIVENESS_BASE_URL: (config?.LIVENESS_BASE_URL ?? env.LIVENESS_BASE_URL)
        .trim()
        .replace(/\/+$/, ''),
      LIVENESS_API_KEY: (config?.LIVENESS_API_KEY ?? env.LIVENESS_API_KEY).trim(),
      LIVENESS_PASSIVE_THRESHOLD:
        config?.LIVENESS_PASSIVE_THRESHOLD ?? env.LIVENESS_PASSIVE_THRESHOLD,
      LIVENESS_CHALLENGE_TTL_MS:
        config?.LIVENESS_CHALLENGE_TTL_MS ?? env.LIVENESS_CHALLENGE_TTL_MS,
      LIVENESS_TIMEOUT_MS: config?.LIVENESS_TIMEOUT_MS ?? env.LIVENESS_TIMEOUT_MS,
      LIVENESS_MAX_RETRIES: config?.LIVENESS_MAX_RETRIES ?? env.LIVENESS_MAX_RETRIES,
      TX_CONTEXT_HMAC_KEY: config?.TX_CONTEXT_HMAC_KEY ?? env.TX_CONTEXT_HMAC_KEY,
    };
    this.nonceStore = nonceStore ?? new PostgresLivenessNonceStore();
  }

  get providerName(): string {
    if (this.cfg.LIVENESS_PROVIDER === 'hybrid-onnx') {
      return 'hrms-liveness-onnx';
    }
    if (this.cfg.LIVENESS_PROVIDER === 'http') {
      return 'http-liveness-provider';
    }
    return 'none';
  }

  issueChallenge(params: {
    organizationId: string;
    employeeId: string;
    direction: 'CHECK_IN' | 'CHECK_OUT';
    preferredAction?: LivenessChallengeAction;
  }): IssuedLivenessChallenge {
    const action =
      params.preferredAction ?? CHALLENGE_ACTIONS[crypto.randomInt(0, CHALLENGE_ACTIONS.length)]!;
    const now = Date.now();
    const exp = now + this.cfg.LIVENESS_CHALLENGE_TTL_MS;
    const payload: ChallengePayload = {
      v: 1,
      nonce: crypto.randomUUID(),
      orgId: params.organizationId,
      empId: params.employeeId,
      dir: params.direction,
      action,
      exp,
    };
    const encoded = toBase64Url(JSON.stringify(payload));
    const mac = computeChallengeMac(encoded, this.cfg.TX_CONTEXT_HMAC_KEY);

    return {
      challengeToken: `${encoded}.${mac}`,
      action,
      prompt: CHALLENGE_PROMPTS[action],
      expiresAt: new Date(exp).toISOString(),
      ttlSeconds: Math.round(this.cfg.LIVENESS_CHALLENGE_TTL_MS / 1000),
    };
  }

  private async consumeChallengeToken(
    token: string,
    expected: { organizationId: string; employeeId: string; direction: 'CHECK_IN' | 'CHECK_OUT' }
  ): Promise<{ ok: true; payload: ChallengePayload } | { ok: false; reason: string; replaySuspected: boolean }> {
    const parts = token.trim().split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return { ok: false, reason: 'Malformed liveness challenge token.', replaySuspected: true };
    }
    const [encoded, providedMac] = parts;
    const expectedMac = computeChallengeMac(encoded, this.cfg.TX_CONTEXT_HMAC_KEY);
    const providedBuf = Buffer.from(providedMac, 'utf8');
    const expectedBuf = Buffer.from(expectedMac, 'utf8');
    if (
      providedBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(providedBuf, expectedBuf)
    ) {
      return { ok: false, reason: 'Invalid liveness challenge signature.', replaySuspected: true };
    }

    let parsed: ChallengePayload;
    try {
      parsed = JSON.parse(fromBase64Url(encoded).toString('utf8')) as ChallengePayload;
    } catch {
      return { ok: false, reason: 'Unreadable liveness challenge payload.', replaySuspected: true };
    }

    const now = Date.now();

    if (
      parsed.v !== 1 ||
      typeof parsed.nonce !== 'string' ||
      !CHALLENGE_ACTIONS.includes(parsed.action)
    ) {
      return { ok: false, reason: 'Unsupported liveness challenge version.', replaySuspected: true };
    }

    if (
      parsed.orgId !== expected.organizationId ||
      parsed.empId !== expected.employeeId ||
      parsed.dir !== expected.direction
    ) {
      return {
        ok: false,
        reason: 'Liveness challenge token does not match employee or punch direction.',
        replaySuspected: true,
      };
    }

    if (typeof parsed.exp !== 'number' || parsed.exp < now) {
      return {
        ok: false,
        reason: 'Liveness challenge expired before completion. Please restart capture.',
        replaySuspected: false,
      };
    }

    const storeResult = await this.nonceStore.consumeNonce({
      nonce: parsed.nonce,
      organizationId: parsed.orgId,
      employeeId: parsed.empId,
      direction: parsed.dir,
      action: parsed.action,
      expiresAt: new Date(parsed.exp),
    });

    if (!storeResult.ok) {
      return {
        ok: false,
        reason:
          storeResult.reason ??
          'Liveness challenge token was already used (replay attempt blocked).',
        replaySuspected: storeResult.replaySuspected,
      };
    }

    return { ok: true, payload: parsed };
  }

  async verify(input: LivenessVerificationRequest): Promise<LivenessVerificationResult> {
    if (this.cfg.LIVENESS_PROVIDER === 'none') {
      return {
        providerName: this.providerName,
        livenessStatus: 'UNAVAILABLE',
        spoofingSuspected: false,
        matchHint: 'NONE',
        livenessScore: null,
        passiveScore: null,
        printScore: null,
        replayScore: null,
        challengeAction: null,
        challengePassed: false,
        bestProbeFrameIndex: 0,
        bestProbeDataUrl: input.frames[0] ?? null,
        failureReason:
          'Liveness verification provider is not configured; Admin review is required.',
      };
    }

    if (!this.cfg.LIVENESS_BASE_URL || !this.cfg.LIVENESS_API_KEY) {
      return {
        providerName: this.providerName,
        livenessStatus: 'UNAVAILABLE',
        spoofingSuspected: false,
        matchHint: 'NONE',
        livenessScore: null,
        passiveScore: null,
        printScore: null,
        replayScore: null,
        challengeAction: null,
        challengePassed: false,
        bestProbeFrameIndex: 0,
        bestProbeDataUrl: input.frames[0] ?? null,
        failureReason: 'Liveness provider URL or API key missing; failing closed for Admin review.',
      };
    }

    const challengeToken = input.challengeToken?.trim() ?? '';
    if (!challengeToken) {
      return {
        providerName: this.providerName,
        livenessStatus: 'FAILED',
        spoofingSuspected: false,
        matchHint: 'NONE',
        livenessScore: 0,
        passiveScore: 0,
        printScore: 0,
        replayScore: 0,
        challengeAction: null,
        challengePassed: false,
        bestProbeFrameIndex: 0,
        bestProbeDataUrl: input.frames[0] ?? null,
        failureReason: 'Active liveness challenge token is missing; Admin verification required.',
      };
    }

    const tokenCheck = await this.consumeChallengeToken(challengeToken, {
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      direction: input.direction,
    });
    if (!tokenCheck.ok) {
      return {
        providerName: this.providerName,
        livenessStatus: 'FAILED',
        spoofingSuspected: tokenCheck.replaySuspected,
        matchHint: 'NONE',
        livenessScore: 0,
        passiveScore: 0,
        printScore: 0,
        replayScore: 0,
        challengeAction: null,
        challengePassed: false,
        bestProbeFrameIndex: 0,
        bestProbeDataUrl: input.frames[0] ?? null,
        failureReason: tokenCheck.reason,
      };
    }

    const boundedFrames = input.frames.slice(0, MAX_CHALLENGE_FRAMES);
    if (boundedFrames.length < 2) {
      return {
        providerName: this.providerName,
        livenessStatus: 'FAILED',
        spoofingSuspected: false,
        matchHint: 'POOR_IMAGE_QUALITY',
        livenessScore: 0,
        passiveScore: 0,
        printScore: 0,
        replayScore: 0,
        challengeAction: tokenCheck.payload.action,
        challengePassed: false,
        bestProbeFrameIndex: 0,
        bestProbeDataUrl: boundedFrames[0] ?? null,
        failureReason:
          'At least 2 sequential live camera frames are required to verify anti-spoofing challenge.',
      };
    }

    for (const frame of boundedFrames) {
      const parsed = parseProbeImageDataUrl(frame);
      if (!parsed.ok) {
        return {
          providerName: this.providerName,
          livenessStatus: 'FAILED',
          spoofingSuspected: false,
          matchHint: 'POOR_IMAGE_QUALITY',
          livenessScore: 0,
          passiveScore: 0,
          printScore: 0,
          replayScore: 0,
          challengeAction: tokenCheck.payload.action,
          challengePassed: false,
          bestProbeFrameIndex: 0,
          bestProbeDataUrl: boundedFrames[0] ?? null,
          failureReason: parsed.reason,
        };
      }
    }

    const endpoint =
      this.cfg.LIVENESS_PROVIDER === 'hybrid-onnx'
        ? `${this.cfg.LIVENESS_BASE_URL}/api/v1/liveness/verify`
        : this.cfg.LIVENESS_BASE_URL;
    const totalAttempts = 1 + this.cfg.LIVENESS_MAX_RETRIES;

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), this.cfg.LIVENESS_TIMEOUT_MS);

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.cfg.LIVENESS_API_KEY,
          },
          body: JSON.stringify({
            challengeAction: tokenCheck.payload.action,
            frames: boundedFrames,
            passiveThreshold: this.cfg.LIVENESS_PASSIVE_THRESHOLD,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutHandle);

        if (TRANSIENT_HTTP_STATUSES.has(res.status) && attempt < totalAttempts) {
          logger.warn('Liveness sidecar returned transient status; retrying', {
            status: res.status,
            attempt,
          });
          await delayMs(TRANSIENT_RETRY_DELAY_MS);
          continue;
        }

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          logger.warn('Liveness provider returned non-OK status; failing closed', {
            status: res.status,
            provider: this.providerName,
            detail: text.slice(0, 180),
          });
          return {
            providerName: this.providerName,
            livenessStatus: 'UNAVAILABLE',
            spoofingSuspected: false,
            matchHint: 'NONE',
            livenessScore: null,
            passiveScore: null,
            printScore: null,
            replayScore: null,
            challengeAction: tokenCheck.payload.action,
            challengePassed: false,
            bestProbeFrameIndex: 0,
            bestProbeDataUrl: boundedFrames[0] ?? null,
            failureReason: `Liveness verification provider unavailable (HTTP ${res.status}).`,
          };
        }

        const data = (await res.json()) as SidecarLivenessResponse;
        const rawStatus = data.livenessStatus === 'LIVE' ? 'LIVE' : 'FAILED';
        const bestIdxRaw =
          typeof data.bestProbeFrameIndex === 'number' && Number.isInteger(data.bestProbeFrameIndex)
            ? data.bestProbeFrameIndex
            : 0;
        const bestIdx = Math.max(0, Math.min(boundedFrames.length - 1, bestIdxRaw));

        return {
          providerName: this.providerName,
          livenessStatus: rawStatus,
          spoofingSuspected: data.spoofingSuspected === true,
          matchHint: normalizeMatchHint(data.matchHint),
          livenessScore: sanitizeFiniteNumber(data.livenessScore),
          passiveScore: sanitizeFiniteNumber(data.passiveScore),
          printScore: sanitizeFiniteNumber(data.printScore),
          replayScore: sanitizeFiniteNumber(data.replayScore),
          challengeAction: tokenCheck.payload.action,
          challengePassed: data.challengePassed === true,
          bestProbeFrameIndex: bestIdx,
          bestProbeDataUrl: boundedFrames[bestIdx] ?? boundedFrames[0] ?? null,
          failureReason:
            typeof data.reason === 'string' && data.reason.trim() ? data.reason.trim() : undefined,
          telemetry:
            data.telemetry && typeof data.telemetry === 'object'
              ? (data.telemetry as Record<string, unknown>)
              : undefined,
        };
      } catch (err) {
        clearTimeout(timeoutHandle);
        if (attempt < totalAttempts) {
          await delayMs(TRANSIENT_RETRY_DELAY_MS);
          continue;
        }
        const message =
          err instanceof Error && err.name === 'AbortError'
            ? `Liveness provider timed out after ${this.cfg.LIVENESS_TIMEOUT_MS}ms.`
            : 'Liveness verification service unreachable; failing closed for Admin review.';
        logger.warn('Liveness provider request failed', {
          provider: this.providerName,
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          providerName: this.providerName,
          livenessStatus: 'UNAVAILABLE',
          spoofingSuspected: false,
          matchHint: 'NONE',
          livenessScore: null,
          passiveScore: null,
          printScore: null,
          replayScore: null,
          challengeAction: tokenCheck.payload.action,
          challengePassed: false,
          bestProbeFrameIndex: 0,
          bestProbeDataUrl: boundedFrames[0] ?? null,
          failureReason: message,
        };
      }
    }

    return {
      providerName: this.providerName,
      livenessStatus: 'UNAVAILABLE',
      spoofingSuspected: false,
      matchHint: 'NONE',
      livenessScore: null,
      passiveScore: null,
      printScore: null,
      replayScore: null,
      challengeAction: tokenCheck.payload.action,
      challengePassed: false,
      bestProbeFrameIndex: 0,
      bestProbeDataUrl: boundedFrames[0] ?? null,
      failureReason: 'Liveness verification exhausted retries.',
    };
  }
}

export const defaultLivenessVerificationAdapter = new ConfiguredLivenessVerificationAdapter();
