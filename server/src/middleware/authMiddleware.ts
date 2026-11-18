import { Request, Response, NextFunction } from 'express';
import { ApiErrorCode, type JobCategory } from '@hrms/shared';
import type { AuthenticatedUser, VerifyTokenOptions } from '../auth/jwtVerifier.js';
import {
  extractBearerToken,
  verifySupabaseToken,
} from '../auth/jwtVerifier.js';
import { getPool } from '../db/pool.js';
import { withTenantTransaction } from '../db/transaction.js';
import { AppError } from './errorHandler.js';
import type { AppRole } from '../services/hrmsDomain.js';

export interface AuthenticatedHrmsSession {
  authUserId: string;
  organizationId: string;
  organizationCode: string;
  organizationName: string;
  appRole: AppRole;
  employeeId?: string;
  employeeCode?: string;
  jobCategory?: JobCategory;
  fullName: string;
  phoneNumber: string;
  mustChangePassword: boolean;
  gotrueSessionId?: string;
  sessionId?: string;
  tokenIssuedAt: number;
  sessionExpiresAt: number;
}

// Extend Express Request interface with typed authenticated user contexts
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      hrmsUser?: AuthenticatedHrmsSession;
    }
  }
}

export function extractGoTrueSessionId(user: AuthenticatedUser): string | null {
  const sid = user.rawTokenClaims['session_id'];
  if (typeof sid === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sid)) {
    return sid;
  }
  return null;
}

/**
 * Resolves authoritative tenant, active session, role, and employee identity from PostgreSQL.
 * Never trusts client-supplied headers or unverified claims.
 */
export async function resolveAuthenticatedSession(
  jwtUser: AuthenticatedUser
): Promise<AuthenticatedHrmsSession | null> {
  const pool = getPool();
  const tenantRes = await pool.query<{
    user_id: string;
    organization_id: string;
    org_is_active: boolean;
    user_is_active: boolean;
    is_activated: boolean;
    must_change_password: boolean;
  }>('SELECT * FROM hrms_internal.resolve_auth_user_tenant($1::uuid);', [jwtUser.authUserId]);

  const tenantRow = tenantRes.rows[0];
  if (!tenantRow) {
    return null;
  }

  const gotrueSessionId = extractGoTrueSessionId(jwtUser);

  const stateRes = await pool.query<{
    active: boolean;
    role: string | null;
    org_is_active: boolean;
    user_is_active: boolean;
    is_activated: boolean;
    must_change_password: boolean;
    revoked_reason: string | null;
    session_id: string | null;
    employee_id: string | null;
  }>('SELECT * FROM hrms_internal.check_session_state($1::uuid, $2::uuid, $3::uuid);', [
    tenantRow.organization_id,
    tenantRow.user_id,
    gotrueSessionId,
  ]);

  const stateRow = stateRes.rows[0];
  if (!stateRow || !stateRow.active || (stateRow.role !== 'ADMIN' && stateRow.role !== 'EMPLOYEE')) {
    throw new AppError(
      401,
      ApiErrorCode.UNAUTHORIZED,
      'Your session is inactive, revoked, or pending account activation.'
    );
  }

  const appRole = stateRow.role as AppRole;

  return await withTenantTransaction(
    tenantRow.organization_id,
    async (client) => {
      const metaRes = await client.query<{
        organization_code: string;
        organization_name: string;
        phone_number: string;
        full_name: string | null;
        tokens_valid_after_epoch: string | number;
      }>(
        `SELECT o.organization_code, o.name AS organization_name, u.phone_number, u.full_name, u.tokens_valid_after_epoch
         FROM public.organizations o
         JOIN public.users u ON u.organization_id = o.id
         WHERE o.id = $1::uuid AND u.id = $2::uuid
         LIMIT 1;`,
        [tenantRow.organization_id, tenantRow.user_id]
      );

      const meta = metaRes.rows[0];
      if (!meta) {
        throw new AppError(401, ApiErrorCode.UNAUTHORIZED, 'Account context no longer exists.');
      }

      const validAfter = Number(meta.tokens_valid_after_epoch ?? 0);
      if (validAfter > 0 && jwtUser.tokenIssuedAt > 0 && jwtUser.tokenIssuedAt + 1 < validAfter) {
        throw new AppError(
          401,
          ApiErrorCode.TOKEN_EXPIRED,
          'Access token invalidated by password change or session revocation.'
        );
      }

      let employeeId: string | undefined;
      let employeeCode: string | undefined;
      let jobCategory: JobCategory | undefined;
      let fullName = meta.full_name?.trim() || 'Administrator';

      if (appRole === 'EMPLOYEE') {
        const empRes = await client.query<{
          id: string;
          employee_code: string;
          job_category: JobCategory;
          full_name: string;
          employment_status: string;
        }>(
          `SELECT id, employee_code, job_category, full_name, employment_status
           FROM public.employees
           WHERE organization_id = $1::uuid AND user_id = $2::uuid
           LIMIT 1;`,
          [tenantRow.organization_id, tenantRow.user_id]
        );
        const emp = empRes.rows[0];
        if (!emp || emp.employment_status === 'TERMINATED' || emp.employment_status === 'RESIGNED') {
          throw new AppError(
            401,
            ApiErrorCode.UNAUTHORIZED,
            'Employee employment record is inactive or missing.'
          );
        }
        employeeId = emp.id;
        employeeCode = emp.employee_code;
        jobCategory = emp.job_category;
        fullName = emp.full_name?.trim() || meta.full_name?.trim() || fullName;
      } else {
        const displayName = meta.full_name?.trim() || jwtUser.userMetadata?.['full_name'];
        if (typeof displayName === 'string' && displayName.trim()) {
          fullName = displayName.trim();
        }
      }

      return {
        authUserId: jwtUser.authUserId,
        organizationId: tenantRow.organization_id,
        organizationCode: meta.organization_code,
        organizationName: meta.organization_name,
        appRole,
        employeeId,
        employeeCode,
        jobCategory,
        fullName,
        phoneNumber: meta.phone_number,
        mustChangePassword: stateRow.must_change_password,
        gotrueSessionId: gotrueSessionId ?? undefined,
        sessionId: stateRow.session_id ?? undefined,
        tokenIssuedAt: jwtUser.tokenIssuedAt,
        sessionExpiresAt: jwtUser.sessionExpiresAt,
      };
    },
    tenantRow.user_id
  );
}

/**
 * Express middleware that mandates a valid, cryptographically verified Supabase Auth JWT.
 */
export function requireAuth(
  options?: VerifyTokenOptions
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = extractBearerToken(req.headers.authorization);
      const user = await verifySupabaseToken(token, options);
      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Strict full-stack RBAC + DB session verification middleware.
 * Rejects unauthenticated, deactivated, unactivated, revoked, or wrong-role requests cleanly.
 */
export function requireActiveUser(
  ...allowedRoles: AppRole[]
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = extractBearerToken(req.headers.authorization);
      const jwtUser = await verifySupabaseToken(token);
      req.user = jwtUser;

      const session = await resolveAuthenticatedSession(jwtUser);
      if (!session) {
        throw new AppError(401, ApiErrorCode.UNAUTHORIZED, 'Account is not registered or activated.');
      }

      if (allowedRoles.length > 0 && !allowedRoles.includes(session.appRole)) {
        throw new AppError(
          403,
          ApiErrorCode.FORBIDDEN,
          `Role ${session.appRole} is not permitted to access this resource.`
        );
      }

      req.hrmsUser = session;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Express middleware that checks for an optional Supabase Auth JWT.
 */
export function optionalAuth(
  options?: VerifyTokenOptions
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.headers.authorization) {
      return next();
    }

    try {
      const token = extractBearerToken(req.headers.authorization);
      const user = await verifySupabaseToken(token, options);
      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export type { AuthenticatedUser, VerifyTokenOptions };
export { extractBearerToken, verifySupabaseToken };
