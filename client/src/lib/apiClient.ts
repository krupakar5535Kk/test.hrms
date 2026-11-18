import type { ApiErrorResponse, ApiResponse, LoginRequest, LoginResponseData } from '@hrms/shared';

export interface BackendHealthStatus {
  reachable: boolean;
  status: string;
  service?: string;
  version?: string;
  environment?: string;
  uptimeSeconds?: number;
  error?: string;
}

export async function fetchBackendHealth(): Promise<BackendHealthStatus> {
  try {
    const res = await fetch('/api/v1/health', {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) {
      return { reachable: false, status: 'degraded', error: `HTTP ${res.status}` };
    }
    const json = (await res.json()) as ApiResponse<{
      status: string;
      service: string;
      version: string;
      uptimeSeconds: number;
      environment: string;
    }>;
    if (json.success && json.data) {
      return {
        reachable: true,
        status: json.data.status,
        service: json.data.service,
        version: json.data.version,
        environment: json.data.environment,
        uptimeSeconds: json.data.uptimeSeconds,
      };
    }
    return { reachable: false, status: 'invalid', error: 'Unexpected health response' };
  } catch (err) {
    return {
      reachable: false,
      status: 'offline',
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

export interface LiveLoginCallResult {
  kind: 'OK' | 'AUTH_ERROR' | 'THROTTLED' | 'UNREACHABLE';
  statusCode?: number;
  data?: LoginResponseData;
  errorMessage?: string;
  retryAfterSeconds?: number;
}

export async function postLoginRequest(payload: LoginRequest): Promise<LiveLoginCallResult> {
  try {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    const json = (await res.json().catch(() => null)) as
      | ApiResponse<LoginResponseData>
      | ApiErrorResponse
      | null;

    if (res.status === 429) {
      const retryRaw = res.headers.get('Retry-After');
      const retryAfterSeconds = retryRaw ? Number.parseInt(retryRaw, 10) : 900;
      return {
        kind: 'THROTTLED',
        statusCode: 429,
        retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 900,
        errorMessage:
          json && !json.success
            ? json.error.message
            : 'Too many failed login attempts. Temporary throttling is active.',
      };
    }

    if (!res.ok || !json || !json.success) {
      const message =
        json && !json.success
          ? json.error.message
          : 'Invalid organization code, mobile number, or password.';
      return {
        kind: 'AUTH_ERROR',
        statusCode: res.status,
        errorMessage: message,
      };
    }

    return {
      kind: 'OK',
      statusCode: res.status,
      data: json.data,
    };
  } catch (err) {
    return {
      kind: 'UNREACHABLE',
      errorMessage:
        err instanceof Error ? err.message : 'Unable to reach Express authentication server.',
    };
  }
}

export async function fetchVerifiedAuthMe(accessToken: string): Promise<{
  ok: boolean;
  status: number;
  data?: Record<string, unknown>;
}> {
  try {
    const res = await fetch('/api/v1/auth/me', {
      method: 'GET',
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) {
      return { ok: false, status: res.status };
    }
    const json = (await res.json()) as ApiResponse<Record<string, unknown>>;
    return { ok: Boolean(json?.success), status: res.status, data: json?.data };
  } catch {
    return { ok: false, status: 0 };
  }
}

export type DomainApiResult<T> =
  | { status: 'OK'; data: T }
  | { status: 'UNAVAILABLE'; statusCode: number; message: string }
  | { status: 'UNAUTHORIZED' | 'FORBIDDEN'; statusCode: number; message: string }
  | { status: 'ERROR'; statusCode?: number; message: string };

type RefreshTokenHandler = (newToken: string | null, expiresIn?: number) => void;
let onTokenRefreshedCallback: RefreshTokenHandler | null = null;

export function registerTokenRefreshHandler(handler: RefreshTokenHandler | null): void {
  onTokenRefreshedCallback = handler;
}

// Global in-flight refresh promise acting as a singleton mutex to prevent concurrent refresh collisions
let inFlightRefreshPromise: Promise<string | null> | null = null;

export async function refreshAccessTokenCoordinated(): Promise<string | null> {
  if (inFlightRefreshPromise) {
    return inFlightRefreshPromise;
  }

  inFlightRefreshPromise = (async () => {
    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });

      if (!res.ok) {
        if (onTokenRefreshedCallback) onTokenRefreshedCallback(null);
        return null;
      }

      const json = (await res.json().catch(() => null)) as {
        success?: boolean;
        data?: {
          tokens?: { accessToken?: string; expiresIn?: number };
          user?: Record<string, unknown>;
        };
      } | null;

      const newToken = json?.data?.tokens?.accessToken;
      const expiresIn = Number(json?.data?.tokens?.expiresIn ?? 900);
      if (typeof newToken === 'string' && newToken.trim().length > 0) {
        if (onTokenRefreshedCallback) onTokenRefreshedCallback(newToken, expiresIn);
        return newToken;
      }

      if (onTokenRefreshedCallback) onTokenRefreshedCallback(null);
      return null;
    } catch {
      if (onTokenRefreshedCallback) onTokenRefreshedCallback(null);
      return null;
    } finally {
      inFlightRefreshPromise = null;
    }
  })();

  return inFlightRefreshPromise;
}

/**
 * Unified backend API helper for domain requests.
 * Clearly distinguishes genuine data (OK), missing/unmounted backend routes (404/501 UNAVAILABLE),
 * auth denials (401/403), and server/network failures (ERROR) — never fabricates data.
 * Automatically recovers from expired access tokens via coordinated single-flight refresh.
 */
export async function apiRequest<T>(
  path: string,
  accessToken: string | null,
  options?: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: unknown;
    idempotencyKey?: string;
    signal?: AbortSignal;
    _retryCount?: number;
  }
): Promise<DomainApiResult<T>> {
  const headers: Record<string, string> = {};
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  if (options?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options?.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  try {
    const res = await fetch(path, {
      method: options?.method ?? 'GET',
      headers,
      credentials: 'include',
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options?.signal,
    });

    const json = (await res.json().catch(() => null)) as ApiResponse<T> | ApiErrorResponse | null;

    if (
      res.status === 501 ||
      (res.status === 404 &&
        (!json ||
          (!json.success &&
            typeof json.error?.message === 'string' &&
            json.error.message.startsWith('Route '))))
    ) {
      return {
        status: 'UNAVAILABLE',
        statusCode: res.status,
        message: 'Backend endpoint for this workflow is not yet mounted.',
      };
    }

    if (res.status === 401) {
      const isAuthRoute = path.startsWith('/api/v1/auth/login') || path.startsWith('/api/v1/auth/refresh');
      const retryCount = options?._retryCount ?? 0;

      // Coordinate seamless token refresh on 401 and retry original request cleanly
      if (!isAuthRoute && retryCount < 1) {
        const refreshedToken = await refreshAccessTokenCoordinated();
        if (refreshedToken) {
          return apiRequest<T>(path, refreshedToken, {
            ...options,
            _retryCount: retryCount + 1,
          });
        }
      }

      return {
        status: 'UNAUTHORIZED',
        statusCode: 401,
        message:
          json && !json.success
            ? json.error.message
            : 'Authentication required or session expired.',
      };
    }

    if (res.status === 403) {
      return {
        status: 'FORBIDDEN',
        statusCode: 403,
        message:
          json && !json.success
            ? json.error.message
            : 'You are not permitted to access this resource.',
      };
    }

    if (!res.ok || !json || !json.success) {
      return {
        status: 'ERROR',
        statusCode: res.status,
        message:
          json && !json.success
            ? json.error.message
            : `Request failed with HTTP ${res.status}`,
      };
    }

    return {
      status: 'OK',
      data: json.data,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    return {
      status: 'ERROR',
      message: err instanceof Error ? err.message : 'Unable to connect to the HRMS server.',
    };
  }
}
