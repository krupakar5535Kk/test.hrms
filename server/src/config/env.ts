import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from cwd .env, monorepo root server/.env, or package-relative .env
const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'server/.env'),
  path.resolve(__dirname, '../../.env'),
];
for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

export interface ServerEnvConfig {
  PORT: number;
  NODE_ENV: 'development' | 'production' | 'test';
  API_PREFIX: string;
  CORS_ORIGIN: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  // Supabase JWT Verification Configuration (Task 2.2A)
  SUPABASE_JWT_ISSUER: string;
  SUPABASE_JWT_AUDIENCE: string;
  SUPABASE_JWKS_URL: string;
  SUPABASE_JWT_SECRET: string;
  // Database Pool Configuration
  DB_HOST: string;
  DB_PORT: number;
  DB_NAME: string;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_SSL: 'false' | 'true' | 'require';
  DB_POOL_MAX: number;
  DB_POOL_IDLE_TIMEOUT_MS: number;
  DB_CONNECTION_TIMEOUT_MS: number;
  // Face Verification Provider Adapter (provider-independent; unconfigured by default)
  FACE_PROVIDER: 'unconfigured' | 'http' | 'compreface';
  FACE_PROVIDER_URL: string;
  FACE_PROVIDER_API_KEY: string;
  COMPREFACE_BASE_URL: string;
  COMPREFACE_API_KEY: string;
  COMPREFACE_SIMILARITY_THRESHOLD: number;
  COMPREFACE_DET_PROB_THRESHOLD: number;
  COMPREFACE_TIMEOUT_MS: number;
  COMPREFACE_MAX_RETRIES: number;
  // Liveness & Anti-Spoofing Provider Adapter (provider-independent; none by default)
  LIVENESS_PROVIDER: 'none' | 'hybrid-onnx' | 'http';
  LIVENESS_BASE_URL: string;
  LIVENESS_API_KEY: string;
  LIVENESS_PASSIVE_THRESHOLD: number;
  LIVENESS_CHALLENGE_TTL_MS: number;
  LIVENESS_TIMEOUT_MS: number;
  LIVENESS_MAX_RETRIES: number;
  APP_PUBLIC_URL: string;
  // Authentication HMAC Keys (Task 2.2B/2.2C)
  SESSION_TOKEN_HMAC_KEY: string;
  OTP_HMAC_PEPPER: string;
  RATE_LIMIT_HMAC_KEY: string;
  TX_CONTEXT_HMAC_KEY: string;
  TX_CONTEXT_HMAC_KEY_ID: string;
  CSRF_HMAC_SECRET: string;
  // CORS and Cookie Security Configuration (Task 2.2B.7)
  CORS_ALLOWED_ORIGINS: string[];
  COOKIE_SECURE: boolean;
  COOKIE_SAMESITE: 'Lax' | 'Strict' | 'None';
  TRUST_PROXY: string;
  // Rate Limiting Backend (Task 2.2B.6)
  RATE_LIMIT_BACKEND: 'memory' | 'redis';
}

export function loadEnvConfig(): ServerEnvConfig {
  const portRaw = process.env['PORT'] ?? '5000';
  const port = parseInt(portRaw, 10);

  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT environment variable: ${portRaw}`);
  }

  const nodeEnvRaw = process.env['NODE_ENV'] ?? 'development';
  const nodeEnv: 'development' | 'production' | 'test' =
    nodeEnvRaw === 'production' || nodeEnvRaw === 'test' ? nodeEnvRaw : 'development';

  const dbPortRaw = process.env['DB_PORT'] ?? '54322';
  const dbPort = parseInt(dbPortRaw, 10);
  if (isNaN(dbPort) || dbPort < 1 || dbPort > 65535) {
    throw new Error(`Invalid DB_PORT environment variable: ${dbPortRaw}`);
  }

  const dbPoolMaxRaw = process.env['DB_POOL_MAX'] ?? '10';
  const dbPoolMax = parseInt(dbPoolMaxRaw, 10);
  if (isNaN(dbPoolMax) || dbPoolMax < 1 || dbPoolMax > 100) {
    throw new Error(`Invalid DB_POOL_MAX environment variable: ${dbPoolMaxRaw}`);
  }

  const dbIdleTimeoutRaw = process.env['DB_POOL_IDLE_TIMEOUT_MS'] ?? '10000';
  const dbPoolIdleTimeoutMs = parseInt(dbIdleTimeoutRaw, 10);
  if (isNaN(dbPoolIdleTimeoutMs) || dbPoolIdleTimeoutMs < 1000) {
    throw new Error(`Invalid DB_POOL_IDLE_TIMEOUT_MS environment variable: ${dbIdleTimeoutRaw}`);
  }

  const dbConnTimeoutRaw = process.env['DB_CONNECTION_TIMEOUT_MS'] ?? '5000';
  const dbConnectionTimeoutMs = parseInt(dbConnTimeoutRaw, 10);
  if (isNaN(dbConnectionTimeoutMs) || dbConnectionTimeoutMs < 500) {
    throw new Error(`Invalid DB_CONNECTION_TIMEOUT_MS environment variable: ${dbConnTimeoutRaw}`);
  }

  const supabaseUrl = (process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321').replace(/\/+$/, '');
  let parsedSupabaseUrl: URL;
  try {
    parsedSupabaseUrl = new URL(supabaseUrl);
  } catch {
    throw new Error(`Invalid SUPABASE_URL: ${supabaseUrl}`);
  }
  if (!['http:', 'https:'].includes(parsedSupabaseUrl.protocol)) {
    throw new Error(`SUPABASE_URL must use http or https protocol; got: ${supabaseUrl}`);
  }

  const supabaseAnonKey = process.env['SUPABASE_ANON_KEY'] ?? 'anon-key-placeholder';
  const supabaseServiceRoleKey =
    process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? 'service-role-placeholder';
  const knownPlaceholders = [
    'anon-key-placeholder',
    'service-role-placeholder',
    'your-anon-key-placeholder',
    'your-service-role-key-placeholder',
  ];
  if (!supabaseAnonKey.trim()) {
    throw new Error('SUPABASE_ANON_KEY must not be empty');
  }
  if (!supabaseServiceRoleKey.trim()) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY must not be empty');
  }
  if (
    nodeEnv === 'production' &&
    (knownPlaceholders.some((p) => supabaseAnonKey.includes(p)) ||
      knownPlaceholders.some((p) => supabaseServiceRoleKey.includes(p)))
  ) {
    throw new Error(
      'SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be real keys in production'
    );
  }

  const supabaseJwtSecret =
    process.env['SUPABASE_JWT_SECRET'] ??
    process.env['JWT_SECRET'] ??
    'super-secret-jwt-token-with-at-least-32-characters-long';

  // ── Authentication HMAC Keys (Task 2.2B/2.2C) ──────────────────────────────
  // These are required in all environments. Each must be a 64-character
  // lowercase hex string (32 bytes, 256-bit key).
  function requireHmacKey(name: string): string {
    const val = process.env[name];
    if (!val || val.length < 64 || !/^[0-9a-f]+$/i.test(val)) {
      throw new Error(
        `${name} must be a 64-character hex string (run: node -e ` +
          `"require('crypto').randomBytes(32).toString('hex')" to generate)`
      );
    }
    return val;
  }

  function requireUuid(name: string): string {
    const val = process.env[name];
    if (!val || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) {
      throw new Error(
        `${name} must be a valid UUID v4 (run: node -e "require('crypto').randomUUID()" to generate)`
      );
    }
    return val;
  }

  // CORS_ALLOWED_ORIGINS: comma-separated list of exact origin URLs (no wildcards)
  const corsAllowedOriginsRaw = process.env['CORS_ALLOWED_ORIGINS'] ?? 'http://localhost:5173';
  const corsAllowedOrigins = corsAllowedOriginsRaw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (corsAllowedOrigins.length === 0) {
    throw new Error('CORS_ALLOWED_ORIGINS must contain at least one origin URL');
  }
  for (const origin of corsAllowedOrigins) {
    if (origin === '*' || origin.includes('*') || origin.endsWith('/')) {
      throw new Error(
        `CORS_ALLOWED_ORIGINS must contain exact origins without wildcards or trailing slashes; got: ${origin}`
      );
    }
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw new Error(`Invalid origin in CORS_ALLOWED_ORIGINS: ${origin}`);
    }
    if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.origin !== origin) {
      throw new Error(
        `CORS_ALLOWED_ORIGINS entries must be exact scheme://host[:port] origins; got: ${origin}`
      );
    }
  }

  // COOKIE_SECURE: boolean string ('true' | 'false'); defaults to true in production
  const cookieSecureRaw = process.env['COOKIE_SECURE'] ?? (nodeEnv === 'production' ? 'true' : 'false');
  if (cookieSecureRaw !== 'true' && cookieSecureRaw !== 'false') {
    throw new Error(`COOKIE_SECURE must be 'true' or 'false'; got: ${cookieSecureRaw}`);
  }
  const cookieSecure = cookieSecureRaw === 'true';

  // COOKIE_SAMESITE: Lax | Strict | None
  const cookieSameSiteRaw = process.env['COOKIE_SAMESITE'] ?? 'Lax';
  if (!['Lax', 'Strict', 'None'].includes(cookieSameSiteRaw)) {
    throw new Error(`COOKIE_SAMESITE must be one of: Lax, Strict, None; got: ${cookieSameSiteRaw}`);
  }
  const cookieSameSite = cookieSameSiteRaw as 'Lax' | 'Strict' | 'None';
  if (cookieSameSite === 'None' && !cookieSecure) {
    throw new Error('COOKIE_SAMESITE=None requires COOKIE_SECURE=true');
  }

  // TRUST_PROXY: pinned proxy setting (never wildcard 'true')
  const trustProxy = (process.env['TRUST_PROXY'] ?? 'loopback').trim();
  if (!trustProxy || trustProxy.toLowerCase() === 'true') {
    throw new Error(
      'TRUST_PROXY must be configured cleanly (e.g., "loopback", hop count, or explicit proxy IPs) and never wildcard "true"'
    );
  }

  // RATE_LIMIT_BACKEND: memory | redis
  const rateLimitBackendRaw = process.env['RATE_LIMIT_BACKEND'] ?? 'memory';
  if (!['memory', 'redis'].includes(rateLimitBackendRaw)) {
    throw new Error(`RATE_LIMIT_BACKEND must be one of: memory, redis; got: ${rateLimitBackendRaw}`);
  }
  const rateLimitBackend = rateLimitBackendRaw as 'memory' | 'redis';

  const dbSslRaw = (process.env['DB_SSL'] ?? 'false').trim().toLowerCase();
  if (!['false', 'true', 'require'].includes(dbSslRaw)) {
    throw new Error(`DB_SSL must be one of: false, true, require; got: ${dbSslRaw}`);
  }
  const dbSsl = dbSslRaw as 'false' | 'true' | 'require';

  const comprefaceBaseUrl = (process.env['COMPREFACE_BASE_URL'] ?? '').trim().replace(/\/+$/, '');
  const comprefaceApiKey = (process.env['COMPREFACE_API_KEY'] ?? '').trim();

  if (comprefaceBaseUrl) {
    let parsedComprefaceUrl: URL;
    try {
      parsedComprefaceUrl = new URL(comprefaceBaseUrl);
    } catch {
      throw new Error(`Invalid COMPREFACE_BASE_URL: ${comprefaceBaseUrl}`);
    }
    if (!['http:', 'https:'].includes(parsedComprefaceUrl.protocol)) {
      throw new Error(
        `COMPREFACE_BASE_URL must use http or https protocol; got: ${comprefaceBaseUrl}`
      );
    }
  }

  const thresholdRaw = (process.env['COMPREFACE_SIMILARITY_THRESHOLD'] ?? '0.85').trim();
  const comprefaceSimilarityThreshold = Number(thresholdRaw);
  if (
    !Number.isFinite(comprefaceSimilarityThreshold) ||
    comprefaceSimilarityThreshold <= 0 ||
    comprefaceSimilarityThreshold > 1
  ) {
    throw new Error(
      `COMPREFACE_SIMILARITY_THRESHOLD must be a number in (0, 1]; got: ${thresholdRaw}`
    );
  }

  const detProbRaw = (process.env['COMPREFACE_DET_PROB_THRESHOLD'] ?? '0.8').trim();
  const comprefaceDetProbThreshold = Number(detProbRaw);
  if (
    !Number.isFinite(comprefaceDetProbThreshold) ||
    comprefaceDetProbThreshold <= 0 ||
    comprefaceDetProbThreshold > 1
  ) {
    throw new Error(
      `COMPREFACE_DET_PROB_THRESHOLD must be a number in (0, 1]; got: ${detProbRaw}`
    );
  }

  const comprefaceTimeoutRaw = (process.env['COMPREFACE_TIMEOUT_MS'] ?? '8000').trim();
  const comprefaceTimeoutMs = parseInt(comprefaceTimeoutRaw, 10);
  if (
    isNaN(comprefaceTimeoutMs) ||
    comprefaceTimeoutMs < 500 ||
    comprefaceTimeoutMs > 60000
  ) {
    throw new Error(
      `COMPREFACE_TIMEOUT_MS must be an integer between 500 and 60000; got: ${comprefaceTimeoutRaw}`
    );
  }

  const comprefaceRetriesRaw = (process.env['COMPREFACE_MAX_RETRIES'] ?? '1').trim();
  const comprefaceMaxRetries = parseInt(comprefaceRetriesRaw, 10);
  if (isNaN(comprefaceMaxRetries) || comprefaceMaxRetries < 0 || comprefaceMaxRetries > 3) {
    throw new Error(
      `COMPREFACE_MAX_RETRIES must be an integer between 0 and 3; got: ${comprefaceRetriesRaw}`
    );
  }

  const faceProviderUrl = (process.env['FACE_PROVIDER_URL'] ?? '').trim();
  const faceProviderExplicit = (process.env['FACE_PROVIDER'] ?? '').trim().toLowerCase();
  let faceProvider: 'unconfigured' | 'http' | 'compreface';

  if (faceProviderExplicit) {
    if (!['unconfigured', 'http', 'compreface'].includes(faceProviderExplicit)) {
      throw new Error(
        `FACE_PROVIDER must be one of: unconfigured, http, compreface; got: ${faceProviderExplicit}`
      );
    }
    faceProvider = faceProviderExplicit as 'unconfigured' | 'http' | 'compreface';
  } else if (comprefaceBaseUrl && comprefaceApiKey) {
    faceProvider = 'compreface';
  } else if (comprefaceBaseUrl || comprefaceApiKey) {
    throw new Error(
      'Partial CompreFace configuration detected: both COMPREFACE_BASE_URL and COMPREFACE_API_KEY must be set (or set FACE_PROVIDER=unconfigured).'
    );
  } else if (faceProviderUrl) {
    faceProvider = 'http';
  } else {
    faceProvider = 'unconfigured';
  }

  if (faceProvider === 'compreface' && (!comprefaceBaseUrl || !comprefaceApiKey)) {
    throw new Error(
      'FACE_PROVIDER=compreface requires both COMPREFACE_BASE_URL and COMPREFACE_API_KEY to be set.'
    );
  }

  const livenessBaseUrl = (process.env['LIVENESS_BASE_URL'] ?? '').trim().replace(/\/+$/, '');
  const livenessApiKey = (process.env['LIVENESS_API_KEY'] ?? '').trim();
  if (livenessBaseUrl) {
    let parsedLivenessUrl: URL;
    try {
      parsedLivenessUrl = new URL(livenessBaseUrl);
    } catch {
      throw new Error(`Invalid LIVENESS_BASE_URL: ${livenessBaseUrl}`);
    }
    if (!['http:', 'https:'].includes(parsedLivenessUrl.protocol)) {
      throw new Error(
        `LIVENESS_BASE_URL must use http or https protocol; got: ${livenessBaseUrl}`
      );
    }
  }

  const livenessProviderRaw = (process.env['LIVENESS_PROVIDER'] ?? 'none').trim().toLowerCase();
  if (!['none', 'hybrid-onnx', 'http'].includes(livenessProviderRaw)) {
    throw new Error(
      `LIVENESS_PROVIDER must be one of: none, hybrid-onnx, http; got: ${livenessProviderRaw}`
    );
  }
  const livenessProvider = livenessProviderRaw as 'none' | 'hybrid-onnx' | 'http';

  const livenessPassiveRaw = (process.env['LIVENESS_PASSIVE_THRESHOLD'] ?? '0.62').trim();
  const livenessPassiveThreshold = Number(livenessPassiveRaw);
  if (
    !Number.isFinite(livenessPassiveThreshold) ||
    livenessPassiveThreshold <= 0 ||
    livenessPassiveThreshold > 1
  ) {
    throw new Error(
      `LIVENESS_PASSIVE_THRESHOLD must be a number in (0, 1]; got: ${livenessPassiveRaw}`
    );
  }

  const livenessChallengeTtlRaw = (process.env['LIVENESS_CHALLENGE_TTL_MS'] ?? '90000').trim();
  const livenessChallengeTtlMs = parseInt(livenessChallengeTtlRaw, 10);
  if (
    isNaN(livenessChallengeTtlMs) ||
    livenessChallengeTtlMs < 15000 ||
    livenessChallengeTtlMs > 300000
  ) {
    throw new Error(
      `LIVENESS_CHALLENGE_TTL_MS must be an integer between 15000 and 300000; got: ${livenessChallengeTtlRaw}`
    );
  }

  const livenessTimeoutRaw = (process.env['LIVENESS_TIMEOUT_MS'] ?? '8000').trim();
  const livenessTimeoutMs = parseInt(livenessTimeoutRaw, 10);
  if (isNaN(livenessTimeoutMs) || livenessTimeoutMs < 500 || livenessTimeoutMs > 60000) {
    throw new Error(
      `LIVENESS_TIMEOUT_MS must be an integer between 500 and 60000; got: ${livenessTimeoutRaw}`
    );
  }

  const livenessRetriesRaw = (process.env['LIVENESS_MAX_RETRIES'] ?? '1').trim();
  const livenessMaxRetries = parseInt(livenessRetriesRaw, 10);
  if (isNaN(livenessMaxRetries) || livenessMaxRetries < 0 || livenessMaxRetries > 3) {
    throw new Error(
      `LIVENESS_MAX_RETRIES must be an integer between 0 and 3; got: ${livenessRetriesRaw}`
    );
  }

  return {
    PORT: port,
    NODE_ENV: nodeEnv,
    API_PREFIX: process.env['API_PREFIX'] ?? '/api/v1',
    CORS_ORIGIN: process.env['CORS_ORIGIN'] ?? 'http://localhost:5173',
    SUPABASE_URL: supabaseUrl,
    SUPABASE_ANON_KEY: supabaseAnonKey,
    SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey,
    JWT_SECRET: supabaseJwtSecret,
    JWT_EXPIRES_IN: process.env['JWT_EXPIRES_IN'] ?? '15m',
    // Supabase JWT Verification Configuration (Task 2.2A)
    SUPABASE_JWT_ISSUER: process.env['SUPABASE_JWT_ISSUER'] ?? `${supabaseUrl}/auth/v1`,
    SUPABASE_JWT_AUDIENCE: process.env['SUPABASE_JWT_AUDIENCE'] ?? 'authenticated',
    SUPABASE_JWKS_URL:
      process.env['SUPABASE_JWKS_URL'] ?? `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
    SUPABASE_JWT_SECRET: supabaseJwtSecret,
    // Database Pool Configuration
    DB_HOST: process.env['DB_HOST'] ?? '127.0.0.1',
    DB_PORT: dbPort,
    DB_NAME: process.env['DB_NAME'] ?? 'postgres',
    DB_USER: process.env['DB_USER'] ?? 'hrms_app_user',
    DB_PASSWORD: process.env['DB_PASSWORD'] ?? '',
    DB_SSL: dbSsl,
    DB_POOL_MAX: dbPoolMax,
    DB_POOL_IDLE_TIMEOUT_MS: dbPoolIdleTimeoutMs,
    DB_CONNECTION_TIMEOUT_MS: dbConnectionTimeoutMs,
    // Face Verification Adapter
    FACE_PROVIDER: faceProvider,
    FACE_PROVIDER_URL: faceProviderUrl,
    FACE_PROVIDER_API_KEY: process.env['FACE_PROVIDER_API_KEY'] ?? '',
    COMPREFACE_BASE_URL: comprefaceBaseUrl,
    COMPREFACE_API_KEY: comprefaceApiKey,
    COMPREFACE_SIMILARITY_THRESHOLD: comprefaceSimilarityThreshold,
    COMPREFACE_DET_PROB_THRESHOLD: comprefaceDetProbThreshold,
    COMPREFACE_TIMEOUT_MS: comprefaceTimeoutMs,
    COMPREFACE_MAX_RETRIES: comprefaceMaxRetries,
    LIVENESS_PROVIDER: livenessProvider,
    LIVENESS_BASE_URL: livenessBaseUrl,
    LIVENESS_API_KEY: livenessApiKey,
    LIVENESS_PASSIVE_THRESHOLD: livenessPassiveThreshold,
    LIVENESS_CHALLENGE_TTL_MS: livenessChallengeTtlMs,
    LIVENESS_TIMEOUT_MS: livenessTimeoutMs,
    LIVENESS_MAX_RETRIES: livenessMaxRetries,
    APP_PUBLIC_URL: (process.env['APP_PUBLIC_URL'] ?? 'http://localhost:5173').replace(/\/+$/, ''),
    // Authentication HMAC Keys (Task 2.2B/2.2C)
    SESSION_TOKEN_HMAC_KEY: requireHmacKey('SESSION_TOKEN_HMAC_KEY'),
    OTP_HMAC_PEPPER: requireHmacKey('OTP_HMAC_PEPPER'),
    RATE_LIMIT_HMAC_KEY: requireHmacKey('RATE_LIMIT_HMAC_KEY'),
    TX_CONTEXT_HMAC_KEY: requireHmacKey('TX_CONTEXT_HMAC_KEY'),
    TX_CONTEXT_HMAC_KEY_ID: requireUuid('TX_CONTEXT_HMAC_KEY_ID'),
    CSRF_HMAC_SECRET: requireHmacKey('CSRF_HMAC_SECRET'),
    // CORS and Cookie Security Configuration (Task 2.2B.7)
    CORS_ALLOWED_ORIGINS: corsAllowedOrigins,
    COOKIE_SECURE: cookieSecure,
    COOKIE_SAMESITE: cookieSameSite,
    TRUST_PROXY: trustProxy,
    // Rate Limiting Backend (Task 2.2B.6)
    RATE_LIMIT_BACKEND: rateLimitBackend,
  };
}

export const env = loadEnvConfig();
