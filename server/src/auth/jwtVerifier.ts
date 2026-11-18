import * as jose from 'jose';
import { ApiErrorCode } from '@hrms/shared';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

/**
 * Standard RFC 4122 UUID regex for validating user subject IDs.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Cryptographic algorithms permitted for Supabase Auth JWT verification.
 * 'none' or unapproved algorithms are strictly rejected.
 */
export const ALLOWED_JWT_ALGORITHMS = ['ES256', 'RS256', 'HS256'] as const;
export type AllowedJwtAlgorithm = typeof ALLOWED_JWT_ALGORITHMS[number];

/**
 * Strongly typed authenticated request context.
 * Bounded strictly to verified JWT claims.
 */
export interface AuthenticatedUser {
  authUserId: string; // auth.users.id (sub claim: RFC 4122 UUID)
  email?: string;
  phone?: string;
  role: string; // Supabase Auth role claim (e.g., 'authenticated')
  appMetadata: Record<string, unknown>;
  userMetadata: Record<string, unknown>;
  sessionExpiresAt: number; // exp in seconds
  tokenIssuedAt: number; // iat in seconds
  rawTokenClaims: Record<string, unknown>;
}

/**
 * Options for token verification (supports mock keys and offline testing).
 */
export interface VerifyTokenOptions {
  issuer?: string;
  audience?: string;
  jwksUrl?: string;
  jwtSecret?: string;
  clockTolerance?: number; // In seconds
  jwksResolver?: jose.JWTVerifyGetKey;
  secretKey?: Uint8Array;
}

// In-memory cache for remote JWKS sets
const jwksCache = new Map<string, jose.JWTVerifyGetKey>();

export function getRemoteJWKSetInstance(url: string): jose.JWTVerifyGetKey {
  let jwks = jwksCache.get(url);
  if (!jwks) {
    jwks = jose.createRemoteJWKSet(new URL(url));
    jwksCache.set(url, jwks);
  }
  return jwks;
}

export function _resetJwksCacheForTesting(): void {
  jwksCache.clear();
}

/**
 * Safely extracts the bearer token from an Authorization header.
 * Rejects missing, malformed, or empty bearer headers with uniform 401 UNAUTHORIZED.
 */
export function extractBearerToken(authHeader?: string): string {
  if (!authHeader || typeof authHeader !== 'string') {
    throw new AppError(401, ApiErrorCode.UNAUTHORIZED, 'Authorization header missing or required');
  }

  const trimmed = authHeader.trim();
  const match = /^bearer\s+(\S+)$/i.exec(trimmed);

  if (!match || !match[1]) {
    throw new AppError(401, ApiErrorCode.UNAUTHORIZED, 'Malformed Authorization header format: expected Bearer <token>');
  }

  return match[1];
}

/**
 * Cryptographically verifies a Supabase Auth JWT and returns typed AuthenticatedUser context.
 * 
 * Guarantees:
 * 1. Cryptographic signature verification (ES256/RS256 via JWKS, HS256 via secret).
 * 2. Strict algorithm allowlisting (rejects 'none' and unapproved algorithms).
 * 3. Issuer and audience validation.
 * 4. Expiration (exp) and not-before (nbf) enforcement.
 * 5. Strict UUID format validation on subject (sub) claim.
 * 6. Never trusts decoded claims without successful signature verification.
 */
export async function verifySupabaseToken(
  token: string,
  options?: VerifyTokenOptions
): Promise<AuthenticatedUser> {
  if (!token || typeof token !== 'string') {
    throw new AppError(401, ApiErrorCode.INVALID_TOKEN, 'Authentication token missing or invalid');
  }

  // 1. Inspect protected header without trusting claims
  let header: jose.ProtectedHeaderParameters;
  try {
    header = jose.decodeProtectedHeader(token);
  } catch (err) {
    logger.warn('Failed to parse JWT protected header', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw new AppError(401, ApiErrorCode.INVALID_TOKEN, 'Malformed authentication token header');
  }

  // 2. Enforce algorithm allowlist (never permit 'none')
  if (!header.alg || !ALLOWED_JWT_ALGORITHMS.includes(header.alg as AllowedJwtAlgorithm)) {
    logger.warn(`Disallowed or missing JWT algorithm rejected: ${header.alg}`);
    throw new AppError(401, ApiErrorCode.INVALID_TOKEN, 'Unsupported or disallowed JWT signing algorithm');
  }

  // 3. Resolve verification key based on algorithm
  const issuer = options?.issuer ?? env.SUPABASE_JWT_ISSUER;
  const audience = options?.audience ?? env.SUPABASE_JWT_AUDIENCE;
  const clockTolerance = options?.clockTolerance ?? 5; // 5-second clock skew tolerance

  let verifyResult: jose.JWTVerifyResult;

  try {
    if (header.alg === 'HS256') {
      // Symmetric HMAC verification
      const secret = options?.secretKey ?? new TextEncoder().encode(options?.jwtSecret ?? env.SUPABASE_JWT_SECRET);
      verifyResult = await jose.jwtVerify(token, secret, {
        issuer,
        audience,
        clockTolerance,
      });
    } else {
      // Asymmetric ECDSA / RSA verification via JWKS
      const jwks = options?.jwksResolver ?? getRemoteJWKSetInstance(options?.jwksUrl ?? env.SUPABASE_JWKS_URL);
      verifyResult = await jose.jwtVerify(token, jwks, {
        issuer,
        audience,
        clockTolerance,
      });
    }
  } catch (err: unknown) {
    if (err instanceof jose.errors.JWTExpired) {
      throw new AppError(401, ApiErrorCode.TOKEN_EXPIRED, 'Authentication token has expired');
    }
    if (err instanceof jose.errors.JWSSignatureVerificationFailed) {
      throw new AppError(401, ApiErrorCode.INVALID_TOKEN, 'Invalid token cryptographic signature');
    }
    if (err instanceof jose.errors.JWTClaimValidationFailed) {
      throw new AppError(
        401,
        ApiErrorCode.INVALID_TOKEN,
        `Token claim validation failed for: ${err.claim}`
      );
    }
    if (err instanceof jose.errors.JWSInvalid || err instanceof jose.errors.JWTInvalid) {
      throw new AppError(401, ApiErrorCode.INVALID_TOKEN, 'Invalid or corrupted authentication token');
    }

    logger.warn('Unexpected error during JWT verification', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw new AppError(401, ApiErrorCode.INVALID_TOKEN, 'Authentication token verification failed');
  }

  const { payload } = verifyResult;

  // 4. Validate subject claim (sub must be RFC 4122 UUID corresponding to auth.users.id)
  if (!payload.sub || typeof payload.sub !== 'string' || !UUID_REGEX.test(payload.sub)) {
    throw new AppError(401, ApiErrorCode.INVALID_TOKEN, 'Invalid subject claim: expected valid UUID format');
  }

  // 5. Construct typed authenticated user context
  const authenticatedUser: AuthenticatedUser = {
    authUserId: payload.sub,
    email: typeof payload['email'] === 'string' ? payload['email'] : undefined,
    phone: typeof payload['phone'] === 'string' ? payload['phone'] : undefined,
    role: typeof payload['role'] === 'string' ? payload['role'] : 'authenticated',
    appMetadata: (typeof payload['app_metadata'] === 'object' && payload['app_metadata'] !== null)
      ? (payload['app_metadata'] as Record<string, unknown>)
      : {},
    userMetadata: (typeof payload['user_metadata'] === 'object' && payload['user_metadata'] !== null)
      ? (payload['user_metadata'] as Record<string, unknown>)
      : {},
    sessionExpiresAt: typeof payload.exp === 'number' ? payload.exp : 0,
    tokenIssuedAt: typeof payload.iat === 'number' ? payload.iat : 0,
    rawTokenClaims: payload as Record<string, unknown>,
  };

  return authenticatedUser;
}
