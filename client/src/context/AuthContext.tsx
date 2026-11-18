import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { validateLoginPayload } from '@hrms/shared';
import type { JobCategory, Role } from '../types/role';
import { normalizeFrontendRole } from '../types/role';
import {
  fetchBackendHealth,
  fetchVerifiedAuthMe,
  postLoginRequest,
  registerTokenRefreshHandler,
  refreshAccessTokenCoordinated,
  type BackendHealthStatus,
} from '../lib/apiClient';
import { normalizeIndianMobile } from '../lib/domainRules';

export interface AuthenticatedSessionUser {
  id: string;
  employeeCode?: string; // Present strictly for EMPLOYEE accounts; Admin is separate
  fullName: string;
  phoneNumber: string; // +91XXXXXXXXXX — never expose email (PO-01)
  role: Role; // Verified backend application role: 'ADMIN' | 'EMPLOYEE'
  jobCategory?: JobCategory; // Employee job classification only; not an app role
  department?: string;
  designation?: string;
  organizationId: string;
  organizationCode: string;
  organizationName: string;
  officeId?: string;
  sessionExpiresAt?: string;
  mustChangePassword?: boolean;
  isScaffoldAuth?: boolean;
}

export interface LoginAttemptOutcome {
  ok: boolean;
  role?: Role;
  fieldErrors?: Record<string, string>;
  errorMessage?: string;
  throttled?: boolean;
  retryAfterSeconds?: number;
}

interface AuthContextValue {
  user: AuthenticatedSessionUser | null;
  loading: boolean;
  error: string | null;
  health: BackendHealthStatus;
  refreshHealth: () => Promise<void>;
  getInMemoryAccessToken: () => string | null;
  loginWithCredentials: (input: {
    fullName?: string;
    organizationCode?: string;
    phoneNumber: string;
    password: string;
  }) => Promise<LoginAttemptOutcome>;
  logout: () => Promise<void>;
  markPasswordChanged: () => void;
  failedAttemptsCount: number;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function normalizeJobCategory(raw: unknown): JobCategory | undefined {
  if (typeof raw !== 'string') return undefined;
  const val = raw.trim().toUpperCase();
  if (
    val === 'OFFICE' ||
    val === 'HR' ||
    val === 'FINANCE' ||
    val === 'SALES' ||
    val === 'RECOVERY'
  ) {
    return val;
  }
  return undefined;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // PO-05: Short-lived access token lives strictly in JS memory, never localStorage/sessionStorage.
  const accessTokenRef = useRef<string | null>(null);

  const [user, setUser] = useState<AuthenticatedSessionUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [failedAttemptsCount, setFailedAttemptsCount] = useState<number>(0);
  const [health, setHealth] = useState<BackendHealthStatus>({
    reachable: false,
    status: 'checking',
  });

  const refreshHealth = useCallback(async () => {
    const status = await fetchBackendHealth();
    setHealth(status);
  }, []);

  const markPasswordChanged = useCallback(() => {
    setUser((prev) => (prev ? { ...prev, mustChangePassword: false } : null));
  }, []);

  useEffect(() => {
    registerTokenRefreshHandler((newToken, expiresIn = 900) => {
      accessTokenRef.current = newToken;
      if (!newToken) {
        setUser(null);
      } else {
        setUser((prev) =>
          prev
            ? {
                ...prev,
                sessionExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
              }
            : null
        );
      }
    });
    return () => registerTokenRefreshHandler(null);
  }, []);

  // Proactive background refresh: refresh access token 60 seconds before expiry to avoid 401s
  useEffect(() => {
    if (!user?.sessionExpiresAt || !accessTokenRef.current) return;
    const expiresMs = new Date(user.sessionExpiresAt).getTime();
    const nowMs = Date.now();
    const delayMs = Math.max(10_000, expiresMs - nowMs - 60_000);
    const timer = setTimeout(() => {
      refreshAccessTokenCoordinated().catch(() => {});
    }, delayMs);

    return () => clearTimeout(timer);
  }, [user?.sessionExpiresAt]);

  useEffect(() => {
    let active = true;
    async function bootstrap() {
      const status = await fetchBackendHealth();
      if (!active) return;
      setHealth(status);

      if (status.reachable) {
        try {
          const refRes = await fetch('/api/v1/auth/refresh', {
            method: 'POST',
            credentials: 'include',
          });
          if (refRes.ok) {
            const refJson = (await refRes.json().catch(() => null)) as {
              success?: boolean;
              data?: {
                tokens?: { accessToken?: string; expiresIn?: number };
                user?: Record<string, unknown>;
              };
            } | null;
            const token = refJson?.data?.tokens?.accessToken;
            const me = refJson?.data?.user;
            if (active && token && me) {
              accessTokenRef.current = token;
              const role = normalizeFrontendRole(me['appRole'] ?? me['role']);
              const jobCategory = normalizeJobCategory(me['jobCategory']);
              const expiresIn = Number(refJson?.data?.tokens?.expiresIn ?? 900);
              setUser({
                id: String(me['authUserId'] ?? ''),
                employeeCode: role === 'EMPLOYEE' && me['employeeCode'] ? String(me['employeeCode']) : undefined,
                fullName: String(me['fullName'] ?? (role === 'ADMIN' ? 'KMACCS Administrator' : 'KMACCS Employee')),
                phoneNumber: String(me['phoneNumber'] ?? ''),
                role,
                jobCategory: role === 'EMPLOYEE' ? jobCategory ?? 'OFFICE' : undefined,
                organizationId: String(me['organizationId'] ?? ''),
                organizationCode: String(me['organizationCode'] ?? ''),
                organizationName: String(me['organizationName'] ?? 'KMACCS'),
                mustChangePassword: Boolean(me['mustChangePassword']),
                sessionExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
                isScaffoldAuth: false,
              });
            }
          }
        } catch {
          // Silent bootstrap failure falls back to unauthenticated state cleanly
        }
      }

      if (active) setLoading(false);
    }
    bootstrap();
    return () => {
      active = false;
    };
  }, []);

  const getInMemoryAccessToken = useCallback(() => accessTokenRef.current, []);

  const loginWithCredentials = useCallback(
    async (input: {
      fullName?: string;
      organizationCode?: string;
      phoneNumber: string;
      password: string;
    }): Promise<LoginAttemptOutcome> => {
      setError(null);

      // 1. Validate Indian mobile normalization (PO-02) + DEC-13 login contract via @hrms/shared
      const mobileCheck = normalizeIndianMobile(input.phoneNumber);
      const trimmedOrg = input.organizationCode?.trim() || undefined;
      const sharedValidation = validateLoginPayload({
        fullName: input.fullName?.trim() || undefined,
        organizationCode: trimmedOrg,
        phoneNumber:
          mobileCheck.isValid && mobileCheck.data ? mobileCheck.data.tenDigit : input.phoneNumber,
        password: input.password,
      });

      const fieldErrors: Record<string, string> = {};
      if (!mobileCheck.isValid) {
        for (const err of mobileCheck.errors) {
          if (err.field) fieldErrors[err.field] = err.message;
        }
      }
      if (!sharedValidation.isValid) {
        for (const err of sharedValidation.errors) {
          if (err.field && !fieldErrors[err.field]) {
            fieldErrors[err.field] = err.message;
          }
        }
      }

      if (Object.keys(fieldErrors).length > 0 || !sharedValidation.data) {
        return { ok: false, fieldErrors };
      }

      // 2. Authenticate strictly through backend /api/v1/auth/login broker
      const liveResult = await postLoginRequest(sharedValidation.data);

      if (liveResult.kind === 'THROTTLED') {
        const msg = liveResult.errorMessage ?? 'Too many failed attempts. Try again later.';
        setError(msg);
        return {
          ok: false,
          throttled: true,
          retryAfterSeconds: liveResult.retryAfterSeconds ?? 900,
          errorMessage: msg,
        };
      }

      if (liveResult.kind === 'AUTH_ERROR') {
        setFailedAttemptsCount((c) => c + 1);
        const msg =
          liveResult.errorMessage ?? 'Invalid organization code, mobile number, or password.';
        setError(msg);
        return { ok: false, errorMessage: msg };
      }

      if (liveResult.kind === 'UNREACHABLE' || !liveResult.data) {
        const msg =
          'Authentication service is unreachable. Verify the Express server is running and try again.';
        setError(msg);
        return { ok: false, errorMessage: msg };
      }

      const { tokens, organization, user: apiUser, employee } = liveResult.data;
      accessTokenRef.current = tokens.accessToken;
      setFailedAttemptsCount(0);

      const isScaffoldToken = tokens.accessToken.startsWith('mock-access-token');
      let verifiedRole = normalizeFrontendRole(apiUser.roles?.[0]);
      let jobCategory = normalizeJobCategory(
        (employee as unknown as Record<string, unknown> | undefined)?.['jobCategory'] ??
          (apiUser as unknown as Record<string, unknown>)['jobCategory']
      );

      // Cross-check verified JWT claims on /api/v1/auth/me when a real signed token is returned
      if (!isScaffoldToken) {
        const meCheck = await fetchVerifiedAuthMe(tokens.accessToken);
        if (!meCheck.ok || !meCheck.data) {
          accessTokenRef.current = null;
          const msg = 'Session verification failed against /api/v1/auth/me.';
          setError(msg);
          return { ok: false, errorMessage: msg };
        }
        const appMeta = (meCheck.data['appMetadata'] as Record<string, unknown> | undefined) ?? {};
        const claimedRole = appMeta['role'] ?? meCheck.data['role'];
        if (claimedRole) {
          verifiedRole = normalizeFrontendRole(claimedRole);
        }
        jobCategory = normalizeJobCategory(appMeta['jobCategory']) ?? jobCategory;
      }

      const expiresAtIso = new Date(Date.now() + (tokens.expiresIn || 900) * 1000).toISOString();

      const fullName =
        apiUser.fullName?.trim() ||
        input.fullName?.trim() ||
        (employee ? `${employee.firstName} ${employee.lastName}`.trim() : undefined) ||
        (verifiedRole === 'ADMIN' ? 'KMACCS Administrator' : 'KMACCS Employee');

      setUser({
        id: apiUser.id,
        // Admin is a separate account and NEVER receives or appears with an employee code
        employeeCode: verifiedRole === 'EMPLOYEE' ? employee?.employeeCode : undefined,
        fullName,
        phoneNumber: mobileCheck.data?.canonicalE164 ?? `+91${apiUser.phoneNumber}`,
        role: verifiedRole,
        jobCategory: verifiedRole === 'EMPLOYEE' ? jobCategory ?? 'OFFICE' : undefined,
        department: (employee as unknown as Record<string, unknown> | undefined)?.['department'] as
          | string
          | undefined,
        designation: (employee as unknown as Record<string, unknown> | undefined)?.['designation'] as
          | string
          | undefined,
        organizationId: organization.id,
        organizationCode: organization.code,
        organizationName: organization.name,
        officeId: employee?.officeId,
        mustChangePassword: Boolean((apiUser as unknown as Record<string, unknown>)['mustChangePassword']),
        sessionExpiresAt: expiresAtIso,
        isScaffoldAuth: isScaffoldToken,
      });

      return { ok: true, role: verifiedRole };
    },
    []
  );

  const logout = useCallback(async () => {
    const token = accessTokenRef.current;
    accessTokenRef.current = null;
    setUser(null);
    setError(null);

    if (token && !token.startsWith('mock-')) {
      try {
        await fetch('/api/v1/auth/logout', {
          method: 'POST',
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Memory auth state already cleared even if backend logout route is pending
      }
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      error,
      health,
      refreshHealth,
      getInMemoryAccessToken,
      loginWithCredentials,
      logout,
      markPasswordChanged,
      failedAttemptsCount,
    }),
    [
      user,
      loading,
      error,
      health,
      refreshHealth,
      getInMemoryAccessToken,
      loginWithCredentials,
      logout,
      markPasswordChanged,
      failedAttemptsCount,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
