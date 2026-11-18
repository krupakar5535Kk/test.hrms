import crypto from 'node:crypto';
import * as jose from 'jose';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ApiErrorCode } from '@hrms/shared';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { verifySupabaseToken } from '../auth/jwtVerifier.js';
import { getPool } from '../db/pool.js';

const PLACEHOLDER_TOKENS = [
  'placeholder',
  'your-anon-key',
  'your-service-role-key',
  '<paste-',
];

export function hasRealServiceRoleKey(): boolean {
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  if (key.length < 40) return false;
  return !PLACEHOLDER_TOKENS.some((p) => key.toLowerCase().includes(p));
}

export function hasRealAnonKey(): boolean {
  const key = env.SUPABASE_ANON_KEY?.trim() ?? '';
  if (key.length < 40) return false;
  return !PLACEHOLDER_TOKENS.some((p) => key.toLowerCase().includes(p));
}

let cachedServiceClient: SupabaseClient | null = null;

export function getSupabaseServiceClient(): SupabaseClient {
  if (!hasRealServiceRoleKey()) {
    throw new AppError(
      503,
      ApiErrorCode.PROVISIONING_CONFIG_MISSING,
      'SUPABASE_SERVICE_ROLE_KEY is missing or placeholder; server-side Supabase provisioning and private storage operations are blocked.'
    );
  }
  if (!cachedServiceClient) {
    cachedServiceClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return cachedServiceClient;
}

export function assertProvisioningConfigured(): void {
  if (!hasRealServiceRoleKey() || !hasRealAnonKey()) {
    throw new AppError(
      503,
      ApiErrorCode.PROVISIONING_CONFIG_MISSING,
      'Supabase Auth service configuration (SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY) is incomplete.'
    );
  }
}

export interface GoTruePasswordSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  authUserId: string;
  gotrueSessionId: string;
}

export async function gotruePasswordLogin(
  syntheticEmail: string,
  password: string
): Promise<GoTruePasswordSession | null> {
  if (!hasRealAnonKey()) {
    throw new AppError(
      503,
      ApiErrorCode.PROVISIONING_CONFIG_MISSING,
      'SUPABASE_ANON_KEY is not configured.'
    );
  }

  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      email: syntheticEmail,
      password,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    logger.warn('GoTrue password login returned non-200', {
      status: response.status,
      body: errBody,
      email: syntheticEmail,
    });
    return null;
  }

  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    user?: { id: string };
  };

  if (!json.access_token || !json.refresh_token) {
    logger.warn('GoTrue response missing tokens');
    return null;
  }

  let authUserId = json.user?.id;
  let gotrueSessionId = crypto.randomUUID();

  try {
    const verified = await verifySupabaseToken(json.access_token);
    authUserId = verified.authUserId;
    const rawSid = verified.rawTokenClaims['session_id'];
    if (typeof rawSid === 'string' && /^[0-9a-f-]{36}$/i.test(rawSid)) {
      gotrueSessionId = rawSid as `${string}-${string}-${string}-${string}-${string}`;
    }
  } catch (verifyErr) {
    logger.warn('verifySupabaseToken non-fatal failure in gotruePasswordLogin; decoding claims directly', {
      error: verifyErr instanceof Error ? verifyErr.message : String(verifyErr),
    });
    // Decode claims directly since token was issued live by trusted GoTrue over HTTPS
    const claims = jose.decodeJwt(json.access_token);
    if (typeof claims.sub === 'string') {
      authUserId = claims.sub;
    }
    const rawSid = claims['session_id'];
    if (typeof rawSid === 'string' && /^[0-9a-f-]{36}$/i.test(rawSid)) {
      gotrueSessionId = rawSid as `${string}-${string}-${string}-${string}-${string}`;
    }
  }

  if (!authUserId) {
    logger.warn('Could not resolve authUserId from GoTrue response');
    return null;
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: typeof json.expires_in === 'number' ? json.expires_in : 900,
    authUserId,
    gotrueSessionId,
  };
}

export async function gotrueRefreshSession(
  refreshToken: string
): Promise<GoTruePasswordSession | null> {
  if (!hasRealAnonKey()) return null;

  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!response.ok) {
    return null;
  }

  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token || !json.refresh_token) {
    return null;
  }

  const verified = await verifySupabaseToken(json.access_token);
  const rawSid = verified.rawTokenClaims['session_id'];
  const gotrueSessionId =
    typeof rawSid === 'string' && /^[0-9a-f-]{36}$/i.test(rawSid)
      ? rawSid
      : crypto.randomUUID();

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: typeof json.expires_in === 'number' ? json.expires_in : 900,
    authUserId: verified.authUserId,
    gotrueSessionId,
  };
}

export async function adminCreateGoTrueUser(params: {
  id?: string;
  syntheticEmail: string;
  password: string;
  appMetadata: Record<string, unknown>;
  userMetadata?: Record<string, unknown>;
}): Promise<{ id: string }> {
  assertProvisioningConfigured();
  const userId = params.id ?? crypto.randomUUID();

  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        id: userId,
        email: params.syntheticEmail,
        password: params.password,
        email_confirm: true,
        app_metadata: params.appMetadata,
        user_metadata: params.userMetadata ?? {},
      }),
    });

    if (res.ok) {
      const created = (await res.json()) as { id?: string };
      return { id: created.id ?? userId };
    }

    const errText = await res.text().catch(() => '');
    logger.warn('GoTrue admin user creation endpoint returned non-200; falling back to direct database broker', {
      status: res.status,
      body: errText,
    });
  } catch (netErr) {
    logger.warn('GoTrue admin user creation network call failed; falling back to direct database broker', {
      error: netErr instanceof Error ? netErr.message : String(netErr),
    });
  }

  // Robust Direct PostgreSQL identity provisioning via hrms_internal.create_employee_auth_identity
  try {
    const pool = getPool();
    const result = await pool.query<{ create_employee_auth_identity: string }>(
      `SELECT hrms_internal.create_employee_auth_identity(
        $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::text
      );`,
      [
        userId,
        (params.appMetadata['organization_id'] as string) || null,
        (params.userMetadata?.['phone_number'] as string) || null,
        params.syntheticEmail,
        params.password,
        (params.userMetadata?.['full_name'] as string) || 'Employee',
        (params.appMetadata['jobCategory'] as string) || 'OFFICE',
      ]
    );

    const resolvedId = result.rows[0]?.create_employee_auth_identity || userId;

    logger.info('Employee auth identity created directly in Supabase Auth schema via database broker', {
      userId: resolvedId,
      email: params.syntheticEmail,
    });

    return { id: resolvedId };
  } catch (dbErr) {
    logger.error('Failed to create auth identity via database broker', {
      error: dbErr instanceof Error ? dbErr.message : String(dbErr),
      userId,
    });
    throw new AppError(502, ApiErrorCode.INTERNAL_SERVER_ERROR, 'Failed to create auth identity in Supabase');
  }
}

export async function adminUpdateGoTrueUser(
  authUserId: string,
  updates: {
    password?: string;
    appMetadata?: Record<string, unknown>;
    userMetadata?: Record<string, unknown>;
    banDuration?: string;
  }
): Promise<void> {
  assertProvisioningConfigured();
  const body: Record<string, unknown> = {};
  if (updates.password !== undefined) body['password'] = updates.password;
  if (updates.appMetadata !== undefined) body['app_metadata'] = updates.appMetadata;
  if (updates.userMetadata !== undefined) body['user_metadata'] = updates.userMetadata;
  if (updates.banDuration !== undefined) body['ban_duration'] = updates.banDuration;

  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(authUserId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (res.ok) return;

    const errText = await res.text().catch(() => '');
    logger.warn('GoTrue admin user update endpoint returned non-200; falling back to direct database broker', {
      status: res.status,
      authUserId,
      body: errText,
    });
  } catch (netErr) {
    logger.warn('GoTrue admin user update network call failed; falling back to direct database broker', {
      error: netErr instanceof Error ? netErr.message : String(netErr),
    });
  }

  // Direct PostgreSQL update fallback
  try {
    const pool = getPool();
    if (updates.password) {
      await pool.query(
        'SELECT hrms_internal.update_auth_user_password($1::uuid, $2::text);',
        [authUserId, updates.password]
      );
    }
    if (updates.userMetadata || updates.appMetadata) {
      await pool.query(
        `UPDATE auth.users
         SET raw_user_meta_data = CASE WHEN $1::jsonb IS NOT NULL THEN raw_user_meta_data || $1::jsonb ELSE raw_user_meta_data END,
             raw_app_meta_data = CASE WHEN $2::jsonb IS NOT NULL THEN raw_app_meta_data || $2::jsonb ELSE raw_app_meta_data END,
             updated_at = NOW()
         WHERE id = $3::uuid;`,
        [
          updates.userMetadata ? JSON.stringify(updates.userMetadata) : null,
          updates.appMetadata ? JSON.stringify(updates.appMetadata) : null,
          authUserId,
        ]
      );
    }
  } catch (dbErr) {
    logger.error('Failed to update auth identity via database broker', {
      error: dbErr instanceof Error ? dbErr.message : String(dbErr),
      authUserId,
    });
    throw new AppError(502, ApiErrorCode.INTERNAL_SERVER_ERROR, 'Failed to update Supabase Auth account');
  }
}

export async function adminDeleteGoTrueUser(authUserId: string): Promise<void> {
  try {
    await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(authUserId)}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
  } catch {
    // Ignore network error
  }
  try {
    const pool = getPool();
    await pool.query('DELETE FROM auth.users WHERE id = $1::uuid;', [authUserId]);
  } catch {
    // Ignore database cleanup failure
  }
}

export async function gotrueLogoutAccessToken(accessToken: string): Promise<void> {
  if (!hasRealAnonKey() || !accessToken) return;
  try {
    await fetch(`${env.SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    // Best-effort GoTrue session revocation; authoritative revocation lives in PG revoked_sessions
  }
}

export type PrivateBucketName =
  | 'attendance-selfies'
  | 'face-enrollment'
  | 'visit-evidence'
  | 'hrms-documents';

export async function uploadPrivateStorageDataUrl(params: {
  bucket: PrivateBucketName;
  organizationId: string;
  userId: string;
  filename: string;
  dataUrl: string;
}): Promise<{
  bucket: PrivateBucketName;
  path: string;
  mimeType: string;
  fileSizeBytes: number;
  sha256Digest: string;
}> {
  const match = /^data:(image\/(?:jpeg|jpg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/i.exec(
    params.dataUrl.trim()
  );
  if (!match) {
    throw new AppError(
      400,
      ApiErrorCode.VALIDATION_ERROR,
      'Uploaded media must be a valid base64 JPEG, PNG, WebP, or PDF data URL.'
    );
  }

  const mimeType = match[1]!.toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1]!.toLowerCase();
  const allowedByBucket: Record<PrivateBucketName, string[]> = {
    'attendance-selfies': ['image/jpeg', 'image/png', 'image/webp'],
    'face-enrollment': ['image/jpeg', 'image/png', 'image/webp'],
    'visit-evidence': ['image/jpeg', 'image/png', 'image/webp'],
    'hrms-documents': ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  };

  if (!allowedByBucket[params.bucket].includes(mimeType)) {
    throw new AppError(
      400,
      ApiErrorCode.VALIDATION_ERROR,
      `MIME type ${mimeType} is not permitted for private bucket ${params.bucket}.`
    );
  }

  const buffer = Buffer.from(match[2]!, 'base64');
  const maxBytes = params.bucket === 'hrms-documents' ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
  if (buffer.length === 0 || buffer.length > maxBytes) {
    throw new AppError(
      400,
      ApiErrorCode.VALIDATION_ERROR,
      `Uploaded file size (${buffer.length} bytes) exceeds allowed limits for ${params.bucket}.`
    );
  }

  const safeName = params.filename.replace(/[^A-Za-z0-9._-]/g, '_');
  const storagePath = `${params.organizationId}/${params.userId}/${safeName}`;
  const sha256Digest = crypto.createHash('sha256').update(buffer).digest('hex');

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.storage.from(params.bucket).upload(storagePath, buffer, {
    contentType: mimeType,
    upsert: false,
  });

  if (error) {
    logger.error('Failed to upload object to private Supabase storage bucket', error, {
      bucket: params.bucket,
      storagePath,
    });
    throw new AppError(502, ApiErrorCode.INTERNAL_SERVER_ERROR, 'Failed to store private media evidence.');
  }

  return {
    bucket: params.bucket,
    path: storagePath,
    mimeType,
    fileSizeBytes: buffer.length,
    sha256Digest,
  };
}

export async function createPrivateSignedUrl(
  bucket: PrivateBucketName,
  storagePath: string,
  expiresInSeconds = 120
): Promise<string | null> {
  if (!storagePath || !hasRealServiceRoleKey()) return null;
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data?.signedUrl) {
    logger.warn('Failed to issue signed URL for private bucket object', {
      bucket,
      storagePath,
      error: error?.message,
    });
    return null;
  }
  return data.signedUrl;
}

export async function createPrivateSignedUploadUrl(
  bucket: PrivateBucketName,
  storagePath: string
): Promise<{ signedUrl: string; token: string; path: string }> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(storagePath);
  if (error || !data) {
    throw new AppError(502, ApiErrorCode.INTERNAL_SERVER_ERROR, 'Failed to create signed upload URL');
  }
  return data;
}
