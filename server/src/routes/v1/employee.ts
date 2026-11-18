import crypto from 'node:crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { ApiErrorCode } from '@hrms/shared';
import { requireActiveUser } from '../../middleware/authMiddleware.js';
import { AppError } from '../../middleware/errorHandler.js';
import { env } from '../../config/env.js';
import { withTenantTransaction } from '../../db/transaction.js';
import {
  calculateDec01AttendanceMinutes,
  calculateHaversineDistanceMeters,
  FIELD_ELIGIBLE_CATEGORIES,
  getMonthDateRange,
  isValidEventType,
  isValidLeaveCategory,
  sha256Hex,
  toIstDateAndHHMM,
} from '../../services/hrmsDomain.js';
import {
  createPrivateSignedUrl,
  uploadPrivateStorageDataUrl,
} from '../../services/supabaseAdmin.js';
import {
  defaultFaceVerificationAdapter,
  type FaceMatchStatus,
} from '../../services/faceVerificationAdapter.js';
import {
  defaultLivenessVerificationAdapter,
  type LivenessVerificationResult,
} from '../../services/livenessVerificationAdapter.js';
import {
  fetchMappedAttendanceRecords,
  fetchMappedCustomerVisits,
  fetchMappedEmployees,
  fetchMappedFieldSessions,
  fetchMappedLeaves,
  fetchMappedNotifications,
  getPrimaryOffice,
  type MappedOffice,
} from '../../services/recordMappers.js';

export const employeeRouter = Router();

// Strict Employee-only boundary on every endpoint in this router
employeeRouter.use(requireActiveUser('EMPLOYEE'));

// GAP-01: Block employee portal services if first-time password change is still pending
employeeRouter.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.hrmsUser?.mustChangePassword) {
    throw new AppError(
      403,
      ApiErrorCode.FORBIDDEN,
      'Password change is required before accessing employee portal services. Please change your initial password at /employee/security.'
    );
  }
  next();
});

const VISIT_PURPOSES = [
  'SALES_PITCH',
  'FOLLOW_UP',
  'COLLECTION',
  'RECOVERY',
  'SUPPORT',
  'OTHER',
] as const;

type VisitPurpose = (typeof VISIT_PURPOSES)[number];

function mapOfficeForClient(office: MappedOffice | null) {
  if (!office) return null;
  return {
    id: office.id,
    code: office.code,
    name: office.name,
    branchName: office.branchName,
    address: office.address,
    latitude: office.latitude,
    longitude: office.longitude,
    radiusMeters: office.geofenceRadiusMeters,
    geofenceRadiusMeters: office.geofenceRadiusMeters,
    maxGpsAccuracyMeters: office.maxGpsAccuracyMeters,
    policyVersion: office.policyVersion,
  };
}

function validateCoordinatesAndAccuracy(
  latitudeRaw: unknown,
  longitudeRaw: unknown,
  accuracyRaw: unknown,
  maxAccuracyMeters: number
): { latitude: number; longitude: number; gpsAccuracyMeters: number } {
  const latitude = Number(latitudeRaw);
  const longitude = Number(longitudeRaw);
  const gpsAccuracyMeters = Number(accuracyRaw);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new AppError(
      400,
      ApiErrorCode.VALIDATION_ERROR,
      'Valid WGS-84 latitude and longitude GPS coordinates are required.'
    );
  }

  if (!Number.isFinite(gpsAccuracyMeters) || gpsAccuracyMeters < 0) {
    throw new AppError(
      400,
      ApiErrorCode.VALIDATION_ERROR,
      'Valid GPS accuracy (in metres) is required.'
    );
  }

  if (gpsAccuracyMeters > maxAccuracyMeters) {
    throw new AppError(
      422,
      ApiErrorCode.VALIDATION_ERROR,
      `GPS accuracy (${Math.round(gpsAccuracyMeters)}m) exceeds the maximum allowed ${maxAccuracyMeters}m threshold.`
    );
  }

  return {
    latitude,
    longitude,
    gpsAccuracyMeters: Math.round(gpsAccuracyMeters * 100) / 100,
  };
}

async function notifyOrgAdmins(
  client: import('pg').PoolClient,
  organizationId: string,
  params: {
    category: string;
    title: string;
    message: string;
    entityType: string;
    entityId?: string | null;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO public.notifications (
       organization_id, recipient_user_id, category, title, message, entity_type, entity_id
     )
     SELECT ur.organization_id, ur.user_id, $2::varchar, $3::varchar, $4::text, $5::varchar, $6::uuid
     FROM public.user_roles ur
     JOIN public.users u ON u.id = ur.user_id AND u.organization_id = ur.organization_id
     WHERE ur.organization_id = $1::uuid
       AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
       AND u.is_active = TRUE;`,
    [
      organizationId,
      params.category,
      params.title,
      params.message,
      params.entityType,
      params.entityId ?? null,
    ]
  );
}

async function buildEmployeeActionItems(
  client: import('pg').PoolClient,
  session: NonNullable<Request['hrmsUser']>,
  todayRecord: Awaited<ReturnType<typeof fetchMappedAttendanceRecords>>[number] | null,
  profile: Awaited<ReturnType<typeof fetchMappedEmployees>>[number] | null
): Promise<
  Array<{
    id: string;
    title: string;
    description?: string;
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
    dueDate?: string;
    category: string;
  }>
> {
  const items: Array<{
    id: string;
    title: string;
    description?: string;
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
    dueDate?: string;
    category: string;
  }> = [];

  if (session.mustChangePassword) {
    items.push({
      id: 'system-password-rotation',
      title: 'Rotate Initial Account Password',
      description: 'Visit Security settings to update your initial activation password.',
      status: 'PENDING',
      category: 'SECURITY',
    });
  }

  if (profile && (profile.faceEnrollmentStatus === 'REQUIRED' || profile.faceEnrollmentStatus === 'REJECTED')) {
    items.push({
      id: 'system-face-enrollment',
      title: 'Submit Live Face Enrollment Selfie',
      description: 'Upload a live consent-backed reference selfie in My Profile for 1:1 biometric verification.',
      status: 'PENDING',
      category: 'BIOMETRIC',
    });
  }

  if (todayRecord && todayRecord.checkInTime && !todayRecord.checkOutTime) {
    items.push({
      id: `attendance-checkout-${todayRecord.id}`,
      title: 'Complete Today’s Smart Check-Out',
      description: `Checked in at ${todayRecord.checkInTime} IST. Remember to check out before leaving.`,
      status: 'IN_PROGRESS',
      dueDate: todayRecord.date,
      category: 'ATTENDANCE',
    });
  }

  const flaggedVisits = await client.query<{
    id: string;
    customer_name: string;
    review_note: string | null;
    visited_at: string;
  }>(
    `SELECT id, customer_name, review_note, visited_at::DATE::TEXT AS visited_at
     FROM public.customer_visits
     WHERE organization_id = $1::uuid
       AND employee_id = $2::uuid
       AND review_status = 'FLAGGED'
     ORDER BY visited_at DESC
     LIMIT 10;`,
    [session.organizationId, session.employeeId]
  );

  for (const fv of flaggedVisits.rows) {
    items.push({
      id: `visit-${fv.id}`,
      title: `Follow up on flagged customer visit: ${fv.customer_name}`,
      description: fv.review_note || 'Admin flagged this visit for clarification.',
      status: 'PENDING',
      dueDate: fv.visited_at,
      category: 'FIELD_VISIT',
    });
  }

  return items;
}

/**
 * GET /api/v1/employee/dashboard
 */
employeeRouter.get('/dashboard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const employeeId = session.employeeId;
    if (!employeeId) {
      throw new AppError(403, ApiErrorCode.FORBIDDEN, 'Employee employment profile is missing.');
    }

    const istNow = toIstDateAndHHMM();
    const { startDate, endDate } = getMonthDateRange(istNow.dateStr.slice(0, 7));

    const payload = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const [
          office,
          profiles,
          todayRecords,
          fieldSessions,
          leaves,
          notifications,
          monthHoursRes,
          latestPayslipRes,
        ] = await Promise.all([
          getPrimaryOffice(client, session.organizationId),
          fetchMappedEmployees(client, session.organizationId, { employeeId }),
          fetchMappedAttendanceRecords(client, session.organizationId, {
            employeeId,
            dateFrom: istNow.dateStr,
            dateTo: istNow.dateStr,
            limit: 1,
          }),
          fetchMappedFieldSessions(client, session.organizationId, { employeeId }),
          fetchMappedLeaves(client, session.organizationId, { employeeId }),
          fetchMappedNotifications(client, session.organizationId, session.authUserId, 'EMPLOYEE'),
          client.query<{ total_mins: number }>(
            `SELECT COALESCE(SUM(approved_payable_minutes), 0)::INT AS total_mins
             FROM public.attendance_days
             WHERE organization_id = $1::uuid
               AND employee_id = $2::uuid
               AND attendance_date >= $3::date
               AND attendance_date <= $4::date;`,
            [session.organizationId, employeeId, startDate, endDate]
          ),
          client.query<{ net_payable_paise: string }>(
            `SELECT pi.net_payable_paise::TEXT
             FROM public.payslips ps
             JOIN public.payroll_items pi ON pi.id = ps.payroll_item_id AND pi.organization_id = ps.organization_id
             WHERE ps.organization_id = $1::uuid
               AND ps.employee_id = $2::uuid
             ORDER BY ps.issued_at DESC
             LIMIT 1;`,
            [session.organizationId, employeeId]
          ),
        ]);

        const todayAttendance = todayRecords[0] ?? null;
        const activeFieldSession = fieldSessions.find((s) => s.status === 'ACTIVE') ?? null;
        const profile = profiles[0] ?? null;
        const tasks = await buildEmployeeActionItems(client, session, todayAttendance, profile);

        const latestNet = latestPayslipRes.rows[0]
          ? Math.round((Number(latestPayslipRes.rows[0].net_payable_paise) / 100) * 100) / 100
          : null;

        return {
          todayAttendance,
          activeFieldSession,
          monthlyPayableMinutes: Number(monthHoursRes.rows[0]?.total_mins ?? 0),
          pendingLeavesCount: leaves.filter((l) => l.status === 'PENDING').length,
          latestApprovedNetSalaryInr: latestNet,
          tasks,
          notifications: notifications.slice(0, 10),
          officeGeofence: mapOfficeForClient(office),
        };
      },
      session.authUserId
    );

    res.status(200).json({ success: true, data: payload, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/employee/profile
 */
employeeRouter.get('/profile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const employeeId = session.employeeId!;

    const data = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const profiles = await fetchMappedEmployees(client, session.organizationId, { employeeId });
        const profile = profiles[0] ?? null;
        if (!profile) {
          return { profile: null };
        }

        const bioRes = await client.query<{
          status: string;
          provider_name: string;
          evidence_bucket: string;
          evidence_path: string | null;
          consent_given: boolean;
          consent_recorded_at: string | null;
          rejection_reason: string | null;
        }>(
          `SELECT status, provider_name, evidence_bucket, evidence_path, consent_given,
                  consent_recorded_at::TEXT, rejection_reason
           FROM public.biometric_enrollments
           WHERE organization_id = $1::uuid AND employee_id = $2::uuid AND is_current = TRUE
           LIMIT 1;`,
          [session.organizationId, employeeId]
        );

        const bio = bioRes.rows[0];
        const signedPreviewUrl =
          bio?.evidence_path
            ? await createPrivateSignedUrl(
                (bio.evidence_bucket as 'face-enrollment') || 'face-enrollment',
                bio.evidence_path,
                120
              )
            : null;

        return {
          profile: {
            ...profile,
            biometricEnrollment: bio
              ? {
                  status: bio.status,
                  providerName: bio.provider_name,
                  consentGiven: bio.consent_given,
                  consentRecordedAt: bio.consent_recorded_at,
                  rejectionReason: bio.rejection_reason,
                  signedPreviewUrl,
                }
              : null,
          },
        };
      },
      session.authUserId
    );

    res.status(200).json({ success: true, data, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/employee/biometrics/enroll
 * Consent-backed live selfie biometric enrollment (stored in private face-enrollment bucket).
 */
employeeRouter.post('/biometrics/enroll', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const employeeId = session.employeeId!;
    const { imageDataUrl, consentGiven, consentVersion } = (req.body ?? {}) as {
      imageDataUrl?: string;
      consentGiven?: boolean;
      consentVersion?: string;
    };

    if (consentGiven !== true) {
      throw new AppError(
        400,
        ApiErrorCode.VALIDATION_ERROR,
        'Explicit employee biometric consent is required before uploading a reference selfie.'
      );
    }

    if (!imageDataUrl || typeof imageDataUrl !== 'string') {
      throw new AppError(
        400,
        ApiErrorCode.VALIDATION_ERROR,
        'A live camera capture data URL is required for face enrollment.'
      );
    }

    const uploaded = await uploadPrivateStorageDataUrl({
      bucket: 'face-enrollment',
      organizationId: session.organizationId,
      userId: session.authUserId,
      filename: `enrollment-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jpg`,
      dataUrl: imageDataUrl,
    });

    const result = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const orgRes = await client.query<{ selfie_retention_days: number }>(
          `SELECT selfie_retention_days FROM public.organizations WHERE id = $1::uuid LIMIT 1;`,
          [session.organizationId]
        );
        const retentionDays = Math.max(30, Number(orgRes.rows[0]?.selfie_retention_days ?? 90));

        await client.query(
          `UPDATE public.biometric_enrollments
           SET is_current = FALSE
           WHERE organization_id = $1::uuid AND employee_id = $2::uuid AND is_current = TRUE;`,
          [session.organizationId, employeeId]
        );

        const ins = await client.query<{ id: string }>(
          `INSERT INTO public.biometric_enrollments (
             organization_id, employee_id, status, provider_name,
             evidence_bucket, evidence_path, consent_given, consent_version,
             consent_recorded_at, is_current, submitted_by, submitted_at,
             retention_until
           ) VALUES (
             $1::uuid, $2::uuid, 'PENDING', 'UNCONFIGURED',
             $3::varchar, $4::text, TRUE, $5::varchar,
             NOW(), TRUE, $6::uuid, NOW(),
             (CURRENT_DATE + ($7::integer * INTERVAL '1 day'))::DATE
           )
           RETURNING id;`,
          [
            session.organizationId,
            employeeId,
            uploaded.bucket,
            uploaded.path,
            consentVersion?.trim() || 'v1.0',
            session.authUserId,
            retentionDays,
          ]
        );

        await client.query(
          `INSERT INTO public.attendance_evidence (
             organization_id, employee_id, evidence_kind, storage_bucket, storage_path,
             mime_type, file_size_bytes, sha256_digest, retained_until
           ) VALUES (
             $1::uuid, $2::uuid, 'ENROLLMENT', $3::varchar, $4::text,
             $5::varchar, $6::bigint, $7::char(64),
             (CURRENT_DATE + ($8::integer * INTERVAL '1 day'))::DATE
           );`,
          [
            session.organizationId,
            employeeId,
            uploaded.bucket,
            uploaded.path,
            uploaded.mimeType,
            uploaded.fileSizeBytes,
            uploaded.sha256Digest,
            retentionDays,
          ]
        );

        await client.query(
          `INSERT INTO public.audit_logs (
             organization_id, actor_user_id, actor_role, action, entity_type, entity_id, summary, ip_address
           ) VALUES ($1::uuid, $2::uuid, 'EMPLOYEE', 'BIOMETRIC_ENROLLMENT_SUBMITTED', 'BIOMETRIC', $3::uuid, $4::text, $5::varchar);`,
          [
            session.organizationId,
            session.authUserId,
            ins.rows[0]!.id,
            `${session.employeeCode ?? employeeId} submitted consent-backed face enrollment photo for Admin review.`,
            req.ip ?? null,
          ]
        );

        await notifyOrgAdmins(client, session.organizationId, {
          category: 'BIOMETRIC',
          title: 'Face Enrollment Pending Review',
          message: `${session.fullName} (${session.employeeCode ?? ''}) submitted a new face enrollment photo for approval.`,
          entityType: 'BIOMETRIC',
          entityId: ins.rows[0]!.id,
        });

        return { enrollmentId: ins.rows[0]!.id, status: 'PENDING' };
      },
      session.authUserId
    );

    res.status(201).json({
      success: true,
      data: {
        ...result,
        message: 'Live enrollment selfie captured and submitted for Admin approval.',
      },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/employee/attendance
 */
employeeRouter.get('/attendance', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const employeeId = session.employeeId!;
    const istToday = toIstDateAndHHMM().dateStr;

    const payload = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const [office, records] = await Promise.all([
          getPrimaryOffice(client, session.organizationId),
          fetchMappedAttendanceRecords(client, session.organizationId, {
            employeeId,
            limit: 60,
            includeSignedMedia: false,
          }),
        ]);

        const todayRecord = records.find((r) => r.date === istToday) ?? null;

        return {
          todayRecord,
          records,
          officeGeofence: mapOfficeForClient(office),
        };
      },
      session.authUserId
    );

    res.status(200).json({ success: true, data: payload, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

async function handleAttendancePunch(
  req: Request,
  res: Response,
  next: NextFunction,
  direction: 'CHECK_IN' | 'CHECK_OUT'
): Promise<void> {
  try {
    const session = req.hrmsUser!;
    const employeeId = session.employeeId!;
    const {
      latitude: latRaw,
      longitude: lonRaw,
      gpsAccuracyMeters: accRaw,
      selfieImageDataUrl,
      livenessFrames: livenessFramesRaw,
      livenessChallengeToken: livenessChallengeTokenRaw,
      comment,
      eventType: eventTypeRaw,
      recordedAtOverride,
    } = (req.body ?? {}) as {
      latitude?: number;
      longitude?: number;
      gpsAccuracyMeters?: number;
      selfieImageDataUrl?: string;
      livenessFrames?: unknown;
      livenessChallengeToken?: unknown;
      comment?: string;
      eventType?: string;
      recordedAtOverride?: string;
    };

    const livenessFrames = Array.isArray(livenessFramesRaw)
      ? livenessFramesRaw.filter((f): f is string => typeof f === 'string' && f.trim().length > 0).slice(0, 12)
      : [];
    const livenessChallengeToken =
      typeof livenessChallengeTokenRaw === 'string' ? livenessChallengeTokenRaw.trim() : null;

    const eventType = eventTypeRaw?.trim() || 'FACE_EMPLOYEE_APP';
    if (!isValidEventType(eventType) || eventType === 'MANAGER_OVERRIDE') {
      throw new AppError(
        400,
        ApiErrorCode.VALIDATION_ERROR,
        `Unsupported employee punch event type "${eventType}".`
      );
    }

    if (!selfieImageDataUrl || typeof selfieImageDataUrl !== 'string') {
      throw new AppError(
        400,
        ApiErrorCode.VALIDATION_ERROR,
        'Live camera selfie capture is required for attendance verification.'
      );
    }

    const cleanComment = comment?.trim() || null;
    const idempotencyKey = req.header('idempotency-key')?.trim() || null;
    const endpointKey = `EMPLOYEE_ATTENDANCE_${direction}`;

    // Use server clock in production; allow test-time timestamp override ONLY when NODE_ENV=test
    const recordedAt =
      process.env['NODE_ENV'] === 'test' && recordedAtOverride
        ? new Date(recordedAtOverride)
        : new Date();
    if (Number.isNaN(recordedAt.getTime())) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'Invalid recordedAt timestamp.');
    }
    const istNow = toIstDateAndHHMM(recordedAt);

    const requestHash = sha256Hex(
      JSON.stringify({
        direction,
        latRaw,
        lonRaw,
        accRaw,
        cleanComment,
        eventType,
        date: istNow.dateStr,
        selfiePrefix: selfieImageDataUrl.slice(0, 128),
      })
    );

    // Step 1: Pre-flight checks inside tenant transaction before uploading binary storage objects
    const preflight = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        if (idempotencyKey) {
          const idemRes = await client.query<{
            request_hash: string;
            response_status: number;
            response_body: Record<string, unknown>;
          }>(
            `SELECT request_hash, response_status, response_body
             FROM public.idempotency_records
             WHERE organization_id = $1::uuid
               AND actor_user_id = $2::uuid
               AND endpoint = $3::varchar
               AND idempotency_key = $4::varchar
               AND expires_at > NOW()
             LIMIT 1;`,
            [session.organizationId, session.authUserId, endpointKey, idempotencyKey]
          );

          const existingIdem = idemRes.rows[0];
          if (existingIdem) {
            if (existingIdem.request_hash !== requestHash) {
              throw new AppError(
                409,
                ApiErrorCode.CONFLICT,
                'Idempotency-Key cannot be reused with a different punch payload.'
              );
            }
            return { replay: existingIdem };
          }
        }

        const office = await getPrimaryOffice(client, session.organizationId);
        if (!office) {
          throw new AppError(
            503,
            ApiErrorCode.PROVISIONING_CONFIG_MISSING,
            'Primary office geofence coordinates are not configured by Admin.'
          );
        }

        const coords = validateCoordinatesAndAccuracy(
          latRaw,
          lonRaw,
          accRaw,
          office.maxGpsAccuracyMeters
        );

        const empRes = await client.query<{
          job_category: string;
          is_field_eligible: boolean;
          full_name: string;
          employee_code: string;
          selfie_retention_days: number;
        }>(
          `SELECT e.job_category, e.is_field_eligible, e.full_name, e.employee_code, o.selfie_retention_days
           FROM public.employees e
           JOIN public.organizations o ON o.id = e.organization_id
           WHERE e.organization_id = $1::uuid AND e.id = $2::uuid
           LIMIT 1;`,
          [session.organizationId, employeeId]
        );
        const emp = empRes.rows[0];
        if (!emp) {
          throw new AppError(404, ApiErrorCode.NOT_FOUND, 'Employee profile not found.');
        }

        const distanceMeters = calculateHaversineDistanceMeters(
          coords.latitude,
          coords.longitude,
          office.latitude,
          office.longitude
        );
        const isOutsideGeofence = distanceMeters > office.geofenceRadiusMeters;
        const fieldEligible =
          emp.is_field_eligible && FIELD_ELIGIBLE_CATEGORIES.has(emp.job_category);

        const dayRes = await client.query<{
          id: string;
          check_in_at: string | null;
          check_out_at: string | null;
          approval_status: string;
          post_6pm_approved: boolean;
        }>(
          `SELECT id, check_in_at::TEXT, check_out_at::TEXT, approval_status, post_6pm_approved
           FROM public.attendance_days
           WHERE organization_id = $1::uuid
             AND employee_id = $2::uuid
             AND attendance_date = $3::date
           LIMIT 1;`,
          [session.organizationId, employeeId, istNow.dateStr]
        );
        const existingDay = dayRes.rows[0] ?? null;

        if (direction === 'CHECK_IN') {
          if (existingDay?.check_in_at) {
            throw new AppError(
              409,
              ApiErrorCode.ATTENDANCE_ALREADY_COMPLETED,
              'Daily Check-In already recorded for today (DEC-02 single daily attendance).'
            );
          }
        } else {
          if (!existingDay || !existingDay.check_in_at) {
            throw new AppError(
              409,
              ApiErrorCode.CHECK_OUT_WITHOUT_CHECK_IN,
              'Cannot submit Check-Out before completing today’s Check-In.'
            );
          }
          if (existingDay.check_out_at) {
            throw new AppError(
              409,
              ApiErrorCode.ATTENDANCE_ALREADY_COMPLETED,
              'Daily Check-Out already completed for today.'
            );
          }
        }

        const attemptCountRes = await client.query<{ cnt: number }>(
          `SELECT COUNT(*)::INT AS cnt
           FROM public.face_verification_attempts
           WHERE organization_id = $1::uuid
             AND employee_id = $2::uuid
             AND punch_direction = $3::varchar
             AND created_at >= ($4::date::timestamp AT TIME ZONE 'Asia/Kolkata')
             AND created_at < (($4::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');`,
          [session.organizationId, employeeId, direction, istNow.dateStr]
        );
        const prevAttempts = Number(attemptCountRes.rows[0]?.cnt ?? 0);

        const enrollmentRes = await client.query<{
          status: string;
          template_reference: string | null;
          evidence_bucket: string;
          evidence_path: string | null;
        }>(
          `SELECT status, template_reference, evidence_bucket, evidence_path
           FROM public.biometric_enrollments
           WHERE organization_id = $1::uuid AND employee_id = $2::uuid AND is_current = TRUE
           LIMIT 1;`,
          [session.organizationId, employeeId]
        );

        const mappingRes = await client.query<{
          provider_name: string;
          provider_collection_key: string;
          provider_subject: string;
        }>(
          `SELECT provider_name, provider_collection_key, provider_subject
           FROM public.face_provider_mappings
           WHERE organization_id = $1::uuid
             AND employee_id = $2::uuid
             AND provider_name = $3::varchar
             AND status = 'ACTIVE'
           LIMIT 1;`,
          [
            session.organizationId,
            employeeId,
            env.FACE_PROVIDER === 'http' ? 'http' : 'compreface',
          ]
        );

        return {
          replay: null as null,
          office,
          coords,
          emp,
          distanceMeters,
          isOutsideGeofence,
          fieldEligible,
          existingDay,
          attemptNumber: prevAttempts + 1,
          enrollment: enrollmentRes.rows[0] ?? null,
          subjectMapping: mappingRes.rows[0] ?? null,
        };
      },
      session.authUserId
    );

    if (preflight.replay) {
      res.status(preflight.replay.response_status).json(preflight.replay.response_body);
      return;
    }

    // Step 2: Run provider-independent liveness & anti-spoofing first (never treats identity match as liveness)
    let livenessRes: LivenessVerificationResult;
    if (eventType === 'PIN_FALLBACK') {
      livenessRes = {
        providerName: defaultLivenessVerificationAdapter.providerName,
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
        bestProbeDataUrl: selfieImageDataUrl,
        failureReason: 'Submitted via PIN fallback; Admin biometric verification required.',
      };
    } else {
      livenessRes = await defaultLivenessVerificationAdapter.verify({
        organizationId: session.organizationId,
        employeeId,
        direction,
        frames: livenessFrames.length > 0 ? livenessFrames : [selfieImageDataUrl],
        challengeToken: livenessChallengeToken,
      });
    }

    const probeImageForUploadAndMatch = livenessRes.bestProbeDataUrl || selfieImageDataUrl;

    // Step 3: Upload clearest frontal probe selfie to private attendance-selfies bucket
    const uploaded = await uploadPrivateStorageDataUrl({
      bucket: 'attendance-selfies',
      organizationId: session.organizationId,
      userId: session.authUserId,
      filename: `${istNow.dateStr}-${direction.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}.jpg`,
      dataUrl: probeImageForUploadAndMatch,
    });

    // Step 4: Run provider-independent face identity recognition (CompreFace remains 1:1 identity matcher)
    const enrolledSignedUrl =
      preflight.enrollment?.status === 'APPROVED' && preflight.enrollment.evidence_path
        ? await createPrivateSignedUrl(
            (preflight.enrollment.evidence_bucket as 'face-enrollment') || 'face-enrollment',
            preflight.enrollment.evidence_path,
            120
          )
        : null;

    const enrollmentBlocked =
      preflight.enrollment?.status === 'REJECTED' ||
      preflight.enrollment?.status === 'REVOKED';

    const faceRes =
      eventType === 'PIN_FALLBACK'
        ? {
            providerName: defaultFaceVerificationAdapter.providerName,
            matchStatus: 'FAILED' as FaceMatchStatus,
            livenessStatus: 'UNAVAILABLE' as const,
            confidenceScore: null,
            failureReason: 'Submitted via PIN fallback; Admin verification required.',
          }
        : livenessRes.matchHint === 'MULTIPLE_FACES_DETECTED' ||
            livenessRes.matchHint === 'FACE_NOT_DETECTED' ||
            livenessRes.matchHint === 'POOR_IMAGE_QUALITY'
          ? {
              providerName: defaultFaceVerificationAdapter.providerName,
              matchStatus: livenessRes.matchHint as FaceMatchStatus,
              livenessStatus: livenessRes.livenessStatus,
              confidenceScore: null,
              failureReason: livenessRes.failureReason,
            }
          : await defaultFaceVerificationAdapter.verify({
              employeeId,
              organizationId: session.organizationId,
              probeImageDataUrl: probeImageForUploadAndMatch,
              expectedSubject: enrollmentBlocked
                ? null
                : (preflight.subjectMapping?.provider_subject ?? null),
              enrolledTemplateReference:
                !enrollmentBlocked && preflight.enrollment?.status === 'APPROVED'
                  ? preflight.enrollment.template_reference
                  : null,
              enrolledReferenceSignedUrl: enrolledSignedUrl,
              attemptNumber: preflight.attemptNumber,
            });

    const effectiveLivenessStatus =
      livenessRes.livenessStatus === 'LIVE' && faceRes.livenessStatus === 'FAILED'
        ? 'FAILED'
        : livenessRes.livenessStatus;

    const combinedFailureReason =
      eventType === 'PIN_FALLBACK'
        ? 'Submitted via PIN fallback; Admin verification required.'
        : [livenessRes.failureReason, faceRes.failureReason]
            .filter((msg): msg is string => Boolean(msg && msg.trim()))
            .filter((msg, idx, arr) => arr.indexOf(msg) === idx)
            .join(' | ') || null;

    let matchStatusForAttempt: FaceMatchStatus =
      eventType === 'PIN_FALLBACK' ? 'FAILED' : faceRes.matchStatus;
    if (
      eventType !== 'PIN_FALLBACK' &&
      livenessRes.spoofingSuspected &&
      matchStatusForAttempt !== 'FACE_NOT_DETECTED' &&
      matchStatusForAttempt !== 'MULTIPLE_FACES_DETECTED' &&
      matchStatusForAttempt !== 'POOR_IMAGE_QUALITY'
    ) {
      matchStatusForAttempt = 'SPOOFING_SUSPECTED';
    }

    const isFaceVerified =
      eventType !== 'PIN_FALLBACK' &&
      matchStatusForAttempt === 'VERIFIED' &&
      effectiveLivenessStatus === 'LIVE';

    let verificationState = 'VERIFICATION_PENDING';
    if (isFaceVerified) {
      verificationState = 'FACE_MATCHED';
    } else if (matchStatusForAttempt === 'SPOOFING_SUSPECTED') {
      verificationState = 'SPOOFING_SUSPECTED';
    } else if (matchStatusForAttempt === 'FACE_NOT_DETECTED') {
      verificationState = 'FACE_NOT_DETECTED';
    } else if (matchStatusForAttempt === 'MULTIPLE_FACES_DETECTED') {
      verificationState = 'MULTIPLE_FACES_DETECTED';
    } else if (matchStatusForAttempt === 'POOR_IMAGE_QUALITY') {
      verificationState = 'POOR_IMAGE_QUALITY';
    } else if (preflight.attemptNumber >= 3 && matchStatusForAttempt === 'MISMATCH') {
      verificationState = 'MAX_ATTEMPTS_REACHED';
    } else if (matchStatusForAttempt === 'MISMATCH') {
      verificationState = 'FACE_MISMATCH';
    } else if (
      matchStatusForAttempt === 'PROVIDER_UNCONFIGURED' ||
      matchStatusForAttempt === 'VERIFIED' ||
      effectiveLivenessStatus === 'UNAVAILABLE'
    ) {
      verificationState = 'VERIFICATION_PENDING';
    } else {
      verificationState = 'VERIFICATION_FAILED';
    }

    const locationState = preflight.isOutsideGeofence ? 'OUTSIDE_GEOFENCE' : 'INSIDE_GEOFENCE';

    let rawDurationMinutes = 0;
    let lunchDeductedMinutes = 0;
    let payableMinutes = 0;
    let approvedPayableMinutes = 0;
    let post6pmMinutes = 0;
    let isLateArrival = false;
    let isEarlyDeparture = false;
    // Strict requirement: Every selfie-based attendance submission is queued as PENDING_ADMIN_REVIEW.
    // Employees are NOT automatically marked present merely because a selfie was submitted.
    const approvalStatus: 'PENDING_ADMIN_REVIEW' = 'PENDING_ADMIN_REVIEW';

    if (direction === 'CHECK_IN') {
      isLateArrival = istNow.minutesOfDay > 10 * 60 + 10;
      approvedPayableMinutes = 0;
      payableMinutes = 0;
    } else {
      const checkInIst = toIstDateAndHHMM(preflight.existingDay!.check_in_at!);
      const dec01 = calculateDec01AttendanceMinutes(
        checkInIst.hhmm,
        istNow.hhmm,
        preflight.existingDay!.post_6pm_approved
      );
      rawDurationMinutes = dec01.rawDurationMinutes;
      lunchDeductedMinutes = dec01.lunchDeductedMinutes;
      payableMinutes = dec01.payableMinutes;
      post6pmMinutes = dec01.post6pmMinutes;
      isEarlyDeparture = dec01.isEarlyDeparture;
      approvedPayableMinutes = 0;
    }

    // Step 5: Atomic DB punch commit via hrms_internal.commit_attendance_punch
    const committed = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const retentionDays = Math.max(30, Number(preflight.emp.selfie_retention_days ?? 90));

        const punchRes = await client.query<{
          attendance_day_id: string;
          attendance_event_id: string;
        }>(
          `SELECT * FROM hrms_internal.commit_attendance_punch(
             $1::uuid, $2::uuid, $3::uuid, $4::date,
             $5::text, $6::text, $7::timestamptz,
             $8::numeric, $9::numeric, $10::numeric, $11::numeric,
             $12::text, $13::text, $14::text, $15::integer,
             $16::boolean, $17::text, $18::text, $19::text,
             $20::text, $21::text, $22::boolean, $23::boolean,
             $24::integer, $25::integer, $26::integer, $27::integer, $28::integer
           );`,
          [
            session.organizationId,
            employeeId,
            preflight.office.id,
            istNow.dateStr,
            direction,
            eventType,
            recordedAt.toISOString(),
            preflight.coords.latitude,
            preflight.coords.longitude,
            preflight.coords.gpsAccuracyMeters,
            preflight.distanceMeters,
            locationState,
            matchStatusForAttempt,
            effectiveLivenessStatus,
            preflight.attemptNumber,
            preflight.isOutsideGeofence,
            cleanComment,
            uploaded.bucket,
            uploaded.path,
            approvalStatus,
            verificationState,
            isLateArrival,
            isEarlyDeparture,
            rawDurationMinutes,
            lunchDeductedMinutes,
            payableMinutes,
            approvedPayableMinutes,
            post6pmMinutes,
          ]
        );

        const attendanceDayId = punchRes.rows[0]!.attendance_day_id;
        const attendanceEventId = punchRes.rows[0]!.attendance_event_id;

        await client.query(
          `INSERT INTO public.face_verification_attempts (
             organization_id, employee_id, attendance_day_id, punch_direction,
             attempt_number, provider_name, event_type, match_status, liveness_status,
             confidence_score, selfie_bucket, selfie_path, failure_reason
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4::varchar,
             $5::integer, $6::varchar, $7::varchar, $8::varchar, $9::varchar,
             $10::numeric, $11::varchar, $12::text, $13::text
           );`,
          [
            session.organizationId,
            employeeId,
            attendanceDayId,
            direction,
            preflight.attemptNumber,
            faceRes.providerName,
            eventType,
            matchStatusForAttempt,
            effectiveLivenessStatus,
            faceRes.confidenceScore,
            uploaded.bucket,
            uploaded.path,
            combinedFailureReason,
          ]
        );

        await client.query(
          `INSERT INTO public.attendance_evidence (
             organization_id, employee_id, attendance_day_id, attendance_event_id,
             evidence_kind, storage_bucket, storage_path, mime_type, file_size_bytes,
             sha256_digest, retained_until
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4::uuid,
             $5::varchar, $6::varchar, $7::text, $8::varchar, $9::bigint,
             $10::char(64), (CURRENT_DATE + ($11::integer * INTERVAL '1 day'))::DATE
           );`,
          [
            session.organizationId,
            employeeId,
            attendanceDayId,
            attendanceEventId,
            direction === 'CHECK_IN' ? 'CHECK_IN_SELFIE' : 'CHECK_OUT_SELFIE',
            uploaded.bucket,
            uploaded.path,
            uploaded.mimeType,
            uploaded.fileSizeBytes,
            uploaded.sha256Digest,
            retentionDays,
          ]
        );

        await client.query(
          `INSERT INTO public.audit_logs (
             organization_id, actor_user_id, actor_role, action, entity_type, entity_id, summary, metadata, ip_address
           ) VALUES (
             $1::uuid, $2::uuid, 'EMPLOYEE', $3::varchar, 'ATTENDANCE', $4::uuid, $5::text, $6::jsonb, $7::varchar
           );`,
          [
            session.organizationId,
            session.authUserId,
            direction === 'CHECK_IN' ? 'ATTENDANCE_CHECK_IN' : 'ATTENDANCE_CHECK_OUT',
            attendanceDayId,
            `${preflight.emp.employee_code} (${preflight.emp.full_name}) ${direction} recorded (${approvalStatus}, ${preflight.distanceMeters}m from HQ, biometric: ${matchStatusForAttempt}, liveness: ${effectiveLivenessStatus}).`,
            JSON.stringify({
              direction,
              eventType,
              approvalStatus,
              verificationState,
              locationState,
              distanceMeters: preflight.distanceMeters,
              payableMinutes,
              approvedPayableMinutes,
              matchStatus: matchStatusForAttempt,
              identityMatchStatus: faceRes.matchStatus,
              livenessStatus: effectiveLivenessStatus,
              livenessProvider: livenessRes.providerName,
              livenessScore: livenessRes.livenessScore,
              passiveScore: livenessRes.passiveScore,
              printScore: livenessRes.printScore,
              replayScore: livenessRes.replayScore,
              challengeAction: livenessRes.challengeAction,
              challengePassed: livenessRes.challengePassed,
              spoofingSuspected: livenessRes.spoofingSuspected,
              providerName: faceRes.providerName,
              confidenceScore: faceRes.confidenceScore,
              failureReason: combinedFailureReason,
            }),
            req.ip ?? null,
          ]
        );

        if (approvalStatus === 'PENDING_ADMIN_REVIEW' || approvalStatus === 'VERIFICATION_PENDING') {
          await notifyOrgAdmins(client, session.organizationId, {
            category: 'ALERT',
            title:
              preflight.isOutsideGeofence
                ? 'Outside-Geofence Attendance Exception'
                : 'Attendance Submission Awaiting Admin Verification',
            message: `${preflight.emp.full_name} (${preflight.emp.employee_code}) ${direction.replace('_', ' ')} at ${istNow.hhmm} IST requires Admin verification (${locationState}, ${matchStatusForAttempt}, liveness: ${effectiveLivenessStatus}).`,
            entityType: 'ATTENDANCE',
            entityId: attendanceDayId,
          });
        }

        const humanMessage =
          'Your attendance submission has been received and is awaiting Admin verification.';

        const responseBody = {
          success: true,
          data: {
            attendanceDayId,
            attendanceEventId,
            status: approvalStatus,
            verificationState,
            locationState,
            faceMatchStatus: matchStatusForAttempt,
            livenessStatus: effectiveLivenessStatus,
            livenessProvider: livenessRes.providerName,
            livenessScore: livenessRes.livenessScore,
            passiveScore: livenessRes.passiveScore,
            challengeAction: livenessRes.challengeAction,
            challengePassed: livenessRes.challengePassed,
            spoofingSuspected: livenessRes.spoofingSuspected,
            failureReason: combinedFailureReason,
            distanceMeters: preflight.distanceMeters,
            gpsAccuracyMeters: preflight.coords.gpsAccuracyMeters,
            payableMinutes,
            approvedPayableMinutes,
            lunchDeductedMinutes,
            post6pmMinutes,
            message: humanMessage,
          },
          meta: { timestamp: new Date().toISOString() },
        };

        if (idempotencyKey) {
          await client.query(
            `INSERT INTO public.idempotency_records (
               organization_id, actor_user_id, endpoint, idempotency_key,
               request_hash, response_status, response_body
             ) VALUES ($1::uuid, $2::uuid, $3::varchar, $4::varchar, $5::char(64), 200, $6::jsonb)
             ON CONFLICT (organization_id, actor_user_id, endpoint, idempotency_key) DO NOTHING;`,
            [
              session.organizationId,
              session.authUserId,
              endpointKey,
              idempotencyKey,
              requestHash,
              JSON.stringify(responseBody),
            ]
          );
        }

        return responseBody;
      },
      session.authUserId
    );

    res.status(200).json(committed);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/employee/attendance/liveness-challenge
 * Issues a single-use HMAC-signed active challenge token for anti-spoofing verification.
 */
employeeRouter.post('/attendance/liveness-challenge', (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const employeeId = session.employeeId!;
    const directionRaw =
      typeof req.body?.direction === 'string' ? req.body.direction.trim().toUpperCase() : 'CHECK_IN';
    const direction: 'CHECK_IN' | 'CHECK_OUT' =
      directionRaw === 'CHECK_OUT' ? 'CHECK_OUT' : 'CHECK_IN';

    const challenge = defaultLivenessVerificationAdapter.issueChallenge({
      organizationId: session.organizationId,
      employeeId,
      direction,
    });

    res.status(200).json({
      success: true,
      data: {
        ...challenge,
        provider: defaultLivenessVerificationAdapter.providerName,
      },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

employeeRouter.post('/attendance/check-in', (req, res, next) => {
  void handleAttendancePunch(req, res, next, 'CHECK_IN');
});

employeeRouter.post('/attendance/check-out', (req, res, next) => {
  void handleAttendancePunch(req, res, next, 'CHECK_OUT');
});

async function assertFieldEligibleEmployee(
  client: import('pg').PoolClient,
  organizationId: string,
  employeeId: string
): Promise<{ jobCategory: string; fullName: string; employeeCode: string; selfieRetentionDays: number }> {
  const res = await client.query<{
    job_category: string;
    is_field_eligible: boolean;
    full_name: string;
    employee_code: string;
    selfie_retention_days: number;
  }>(
    `SELECT e.job_category, e.is_field_eligible, e.full_name, e.employee_code, o.selfie_retention_days
     FROM public.employees e
     JOIN public.organizations o ON o.id = e.organization_id
     WHERE e.organization_id = $1::uuid AND e.id = $2::uuid
     LIMIT 1;`,
    [organizationId, employeeId]
  );
  const emp = res.rows[0];
  if (!emp || !emp.is_field_eligible || !FIELD_ELIGIBLE_CATEGORIES.has(emp.job_category)) {
    throw new AppError(
      403,
      ApiErrorCode.FORBIDDEN,
      'Field Duty tracking is restricted strictly to authorized Sales Representatives and Recovery Agents.'
    );
  }
  return {
    jobCategory: emp.job_category,
    fullName: emp.full_name,
    employeeCode: emp.employee_code,
    selfieRetentionDays: Math.max(30, Number(emp.selfie_retention_days ?? 90)),
  };
}

/**
 * GET /api/v1/employee/field-duty
 */
employeeRouter.get('/field-duty', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const employeeId = session.employeeId!;

    const data = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        await assertFieldEligibleEmployee(client, session.organizationId, employeeId);
        const [sessions, visits] = await Promise.all([
          fetchMappedFieldSessions(client, session.organizationId, { employeeId }),
          fetchMappedCustomerVisits(client, session.organizationId, {
            employeeId,
            includeSignedEvidence: true,
          }),
        ]);
        const activeSession = sessions.find((s) => s.status === 'ACTIVE') ?? null;
        return { activeSession, sessions, visits };
      },
      session.authUserId
    );

    res.status(200).json({ success: true, data, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/employee/field-duty/start
 */
employeeRouter.post('/field-duty/start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const employeeId = session.employeeId!;
    const { latitude, longitude, gpsAccuracyMeters, authorizationNote } = (req.body ?? {}) as {
      latitude?: number;
      longitude?: number;
      gpsAccuracyMeters?: number;
      authorizationNote?: string;
    };

    const result = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const emp = await assertFieldEligibleEmployee(client, session.organizationId, employeeId);
        const office = await getPrimaryOffice(client, session.organizationId);
        const coords = validateCoordinatesAndAccuracy(
          latitude,
          longitude,
          gpsAccuracyMeters,
          office?.maxGpsAccuracyMeters ?? 30
        );

        const activeRes = await client.query<{ id: string }>(
          `SELECT id FROM public.field_duty_sessions
           WHERE organization_id = $1::uuid AND employee_id = $2::uuid AND status = 'ACTIVE'
           LIMIT 1;`,
          [session.organizationId, employeeId]
        );
        if (activeRes.rows[0]) {
          throw new AppError(409, ApiErrorCode.CONFLICT, 'An active Field Duty session is already running.');
        }

        const todayDate = toIstDateAndHHMM().dateStr;
        const attRes = await client.query<{ id: string }>(
          `SELECT id FROM public.attendance_days
           WHERE organization_id = $1::uuid AND employee_id = $2::uuid AND attendance_date = $3::date
             AND check_in_at IS NOT NULL
           LIMIT 1;`,
          [session.organizationId, employeeId, todayDate]
        );
        const attendanceDayId = attRes.rows[0]?.id ?? null;

        const distanceMeters = office
          ? calculateHaversineDistanceMeters(
              coords.latitude,
              coords.longitude,
              office.latitude,
              office.longitude
            )
          : null;

        const ins = await client.query<{ id: string }>(
          `INSERT INTO public.field_duty_sessions (
             organization_id, employee_id, attendance_day_id, status,
             start_latitude, start_longitude, start_accuracy_meters,
             authorized_by, authorization_note
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, 'ACTIVE',
             $4::numeric, $5::numeric, $6::numeric,
             $7::uuid, $8::text
           )
           RETURNING id;`,
          [
            session.organizationId,
            employeeId,
            attendanceDayId,
            coords.latitude,
            coords.longitude,
            coords.gpsAccuracyMeters,
            session.authUserId,
            authorizationNote?.trim() || 'Started by authorized field employee',
          ]
        );

        const sessionId = ins.rows[0]!.id;

        await client.query(
          `INSERT INTO public.field_duty_gps_events (
             organization_id, session_id, employee_id, latitude, longitude, accuracy_meters, distance_from_office_meters
           ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::numeric, $5::numeric, $6::numeric, $7::numeric);`,
          [
            session.organizationId,
            sessionId,
            employeeId,
            coords.latitude,
            coords.longitude,
            coords.gpsAccuracyMeters,
            distanceMeters,
          ]
        );

        await client.query(
          `INSERT INTO public.audit_logs (
             organization_id, actor_user_id, actor_role, action, entity_type, entity_id, summary, ip_address
           ) VALUES ($1::uuid, $2::uuid, 'EMPLOYEE', 'FIELD_DUTY_STARTED', 'FIELD_DUTY', $3::uuid, $4::text, $5::varchar);`,
          [
            session.organizationId,
            session.authUserId,
            sessionId,
            `${emp.employeeCode} (${emp.fullName}) started Field Duty session.`,
            req.ip ?? null,
          ]
        );

        return {
          sessionId,
          message: 'Field Duty started. Continuous GPS checkpoints are active until Field Duty is ended.',
        };
      },
      session.authUserId
    );

    res.status(201).json({ success: true, data: result, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/employee/field-duty/gps
 * Records GPS ping ONLY while Field Duty session is ACTIVE (enforced both in route & PG trigger).
 */
employeeRouter.post('/field-duty/gps', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const employeeId = session.employeeId!;
    const { latitude, longitude, gpsAccuracyMeters } = (req.body ?? {}) as {
      latitude?: number;
      longitude?: number;
      gpsAccuracyMeters?: number;
    };

    const result = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        await assertFieldEligibleEmployee(client, session.organizationId, employeeId);
        const office = await getPrimaryOffice(client, session.organizationId);
        const coords = validateCoordinatesAndAccuracy(
          latitude,
          longitude,
          gpsAccuracyMeters,
          office?.maxGpsAccuracyMeters ?? 30
        );

        const activeRes = await client.query<{ id: string }>(
          `SELECT id FROM public.field_duty_sessions
           WHERE organization_id = $1::uuid AND employee_id = $2::uuid AND status = 'ACTIVE'
           LIMIT 1;`,
          [session.organizationId, employeeId]
        );

        const activeSession = activeRes.rows[0];
        if (!activeSession) {
          throw new AppError(
            409,
            ApiErrorCode.FIELD_DUTY_INACTIVE,
            'GPS tracking rejected: no active Field Duty session. Start Field Duty before sending location events.'
          );
        }

        const distanceMeters = office
          ? calculateHaversineDistanceMeters(
              coords.latitude,
              coords.longitude,
              office.latitude,
              office.longitude
            )
          : null;

        const gpsIns = await client.query<{ id: string }>(
          `INSERT INTO public.field_duty_gps_events (
             organization_id, session_id, employee_id, latitude, longitude, accuracy_meters, distance_from_office_meters
           ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::numeric, $5::numeric, $6::numeric, $7::numeric)
           RETURNING id;`,
          [
            session.organizationId,
            activeSession.id,
            employeeId,
            coords.latitude,
            coords.longitude,
            coords.gpsAccuracyMeters,
            distanceMeters,
          ]
        );

        return { gpsEventId: gpsIns.rows[0]!.id, sessionId: activeSession.id, distanceMeters };
      },
      session.authUserId
    );

    res.status(201).json({ success: true, data: result, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/employee/field-duty/end
 */
employeeRouter.post('/field-duty/end', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const employeeId = session.employeeId!;
    const { latitude, longitude, gpsAccuracyMeters, endNote } = (req.body ?? {}) as {
      latitude?: number;
      longitude?: number;
      gpsAccuracyMeters?: number;
      endNote?: string;
    };

    const result = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const emp = await assertFieldEligibleEmployee(client, session.organizationId, employeeId);
        const office = await getPrimaryOffice(client, session.organizationId);
        const coords = validateCoordinatesAndAccuracy(
          latitude,
          longitude,
          gpsAccuracyMeters,
          office?.maxGpsAccuracyMeters ?? 30
        );

        const activeRes = await client.query<{ id: string }>(
          `SELECT id FROM public.field_duty_sessions
           WHERE organization_id = $1::uuid AND employee_id = $2::uuid AND status = 'ACTIVE'
           LIMIT 1;`,
          [session.organizationId, employeeId]
        );
        const activeSession = activeRes.rows[0];
        if (!activeSession) {
          throw new AppError(409, ApiErrorCode.FIELD_DUTY_INACTIVE, 'No active Field Duty session to end.');
        }

        const distanceMeters = office
          ? calculateHaversineDistanceMeters(
              coords.latitude,
              coords.longitude,
              office.latitude,
              office.longitude
            )
          : null;

        // Log closing GPS ping BEFORE marking status ENDED (trigger enforces ACTIVE)
        await client.query(
          `INSERT INTO public.field_duty_gps_events (
             organization_id, session_id, employee_id, latitude, longitude, accuracy_meters, distance_from_office_meters
           ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::numeric, $5::numeric, $6::numeric, $7::numeric);`,
          [
            session.organizationId,
            activeSession.id,
            employeeId,
            coords.latitude,
            coords.longitude,
            coords.gpsAccuracyMeters,
            distanceMeters,
          ]
        );

        await client.query(
          `UPDATE public.field_duty_sessions
           SET status = 'ENDED',
               ended_at = NOW(),
               end_latitude = $3::numeric,
               end_longitude = $4::numeric,
               end_accuracy_meters = $5::numeric,
               end_note = $6::text
           WHERE organization_id = $1::uuid AND id = $2::uuid;`,
          [
            session.organizationId,
            activeSession.id,
            coords.latitude,
            coords.longitude,
            coords.gpsAccuracyMeters,
            endNote?.trim() || 'Ended by employee',
          ]
        );

        await client.query(
          `INSERT INTO public.audit_logs (
             organization_id, actor_user_id, actor_role, action, entity_type, entity_id, summary, ip_address
           ) VALUES ($1::uuid, $2::uuid, 'EMPLOYEE', 'FIELD_DUTY_ENDED', 'FIELD_DUTY', $3::uuid, $4::text, $5::varchar);`,
          [
            session.organizationId,
            session.authUserId,
            activeSession.id,
            `${emp.employeeCode} (${emp.fullName}) ended Field Duty session. Further GPS pings blocked until resumed.`,
            req.ip ?? null,
          ]
        );

        return {
          sessionId: activeSession.id,
          message: 'Field Duty ended. Background GPS location tracking has stopped.',
        };
      },
      session.authUserId
    );

    res.status(200).json({ success: true, data: result, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/employee/field-duty/visits
 * Logs a customer visit (requires ACTIVE field duty; optional private visit-evidence photo; NO synthetic customer geofence radius).
 */
employeeRouter.post('/field-duty/visits', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const employeeId = session.employeeId!;
    const {
      customerName,
      customerReference,
      visitPurpose,
      notes,
      latitude,
      longitude,
      gpsAccuracyMeters,
      evidenceImageDataUrl,
    } = (req.body ?? {}) as {
      customerName?: string;
      customerReference?: string;
      visitPurpose?: string;
      notes?: string;
      latitude?: number;
      longitude?: number;
      gpsAccuracyMeters?: number;
      evidenceImageDataUrl?: string;
    };

    if (!customerName || customerName.trim().length < 2) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'Customer name is required (min 2 characters).');
    }

    const purpose = (visitPurpose?.trim().toUpperCase() || 'SALES_PITCH') as VisitPurpose;
    if (!VISIT_PURPOSES.includes(purpose)) {
      throw new AppError(
        400,
        ApiErrorCode.VALIDATION_ERROR,
        `visitPurpose must be one of ${VISIT_PURPOSES.join(', ')}.`
      );
    }

    // Check active session and coords before uploading photo evidence
    const pre = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const emp = await assertFieldEligibleEmployee(client, session.organizationId, employeeId);
        const office = await getPrimaryOffice(client, session.organizationId);
        const coords = validateCoordinatesAndAccuracy(
          latitude,
          longitude,
          gpsAccuracyMeters,
          office?.maxGpsAccuracyMeters ?? 30
        );

        const activeRes = await client.query<{ id: string }>(
          `SELECT id FROM public.field_duty_sessions
           WHERE organization_id = $1::uuid AND employee_id = $2::uuid AND status = 'ACTIVE'
           LIMIT 1;`,
          [session.organizationId, employeeId]
        );
        const activeSession = activeRes.rows[0];
        if (!activeSession) {
          throw new AppError(
            409,
            ApiErrorCode.FIELD_DUTY_INACTIVE,
            'An active Field Duty session is required before recording a customer visit.'
          );
        }

        const distanceFromOfficeMeters = office
          ? calculateHaversineDistanceMeters(
              coords.latitude,
              coords.longitude,
              office.latitude,
              office.longitude
            )
          : null;

        return { emp, coords, activeSessionId: activeSession.id, distanceFromOfficeMeters };
      },
      session.authUserId
    );

    const uploadedEvidence =
      evidenceImageDataUrl && evidenceImageDataUrl.trim().length > 0
        ? await uploadPrivateStorageDataUrl({
            bucket: 'visit-evidence',
            organizationId: session.organizationId,
            userId: session.authUserId,
            filename: `visit-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jpg`,
            dataUrl: evidenceImageDataUrl,
          })
        : null;

    const created = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const visitRes = await client.query<{ id: string }>(
          `INSERT INTO public.customer_visits (
             organization_id, session_id, employee_id, customer_name, customer_reference,
             visit_purpose, notes, latitude, longitude, accuracy_meters, distance_from_office_meters,
             evidence_bucket, evidence_path, review_status
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4::varchar, $5::varchar,
             $6::varchar, $7::text, $8::numeric, $9::numeric, $10::numeric, $11::numeric,
             'visit-evidence', $12::text, 'SUBMITTED'
           )
           RETURNING id;`,
          [
            session.organizationId,
            pre.activeSessionId,
            employeeId,
            customerName.trim(),
            customerReference?.trim() || null,
            purpose,
            notes?.trim() || null,
            pre.coords.latitude,
            pre.coords.longitude,
            pre.coords.gpsAccuracyMeters,
            pre.distanceFromOfficeMeters,
            uploadedEvidence?.path ?? null,
          ]
        );

        const visitId = visitRes.rows[0]!.id;

        if (uploadedEvidence) {
          await client.query(
            `INSERT INTO public.attendance_evidence (
               organization_id, employee_id, evidence_kind, storage_bucket, storage_path,
               mime_type, file_size_bytes, sha256_digest, retained_until
             ) VALUES (
               $1::uuid, $2::uuid, 'VISIT_EVIDENCE', $3::varchar, $4::text,
               $5::varchar, $6::bigint, $7::char(64),
               (CURRENT_DATE + ($8::integer * INTERVAL '1 day'))::DATE
             );`,
            [
              session.organizationId,
              employeeId,
              uploadedEvidence.bucket,
              uploadedEvidence.path,
              uploadedEvidence.mimeType,
              uploadedEvidence.fileSizeBytes,
              uploadedEvidence.sha256Digest,
              pre.emp.selfieRetentionDays,
            ]
          );
        }

        await client.query(
          `INSERT INTO public.audit_logs (
             organization_id, actor_user_id, actor_role, action, entity_type, entity_id, summary, ip_address
           ) VALUES ($1::uuid, $2::uuid, 'EMPLOYEE', 'CUSTOMER_VISIT_LOGGED', 'CUSTOMER_VISIT', $3::uuid, $4::text, $5::varchar);`,
          [
            session.organizationId,
            session.authUserId,
            visitId,
            `${pre.emp.employeeCode} logged ${purpose} visit for ${customerName.trim()} (GPS ${pre.coords.latitude.toFixed(5)}, ${pre.coords.longitude.toFixed(5)}).`,
            req.ip ?? null,
          ]
        );

        return {
          visitId,
          message: `Customer visit for ${customerName.trim()} logged with verified GPS evidence.`,
        };
      },
      session.authUserId
    );

    res.status(201).json({ success: true, data: created, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/employee/field-duty/visits/:visitId/complete
 */
employeeRouter.post(
  '/field-duty/visits/:visitId/complete',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = req.hrmsUser!;
      const employeeId = session.employeeId!;
      const { visitId } = req.params as { visitId: string };
      const { outcomeNote, followUpDate } = (req.body ?? {}) as {
        outcomeNote?: string;
        followUpDate?: string;
      };

      await withTenantTransaction(
        session.organizationId,
        async (client) => {
          await assertFieldEligibleEmployee(client, session.organizationId, employeeId);
          const noteSuffix = [
            outcomeNote?.trim() || 'Visit follow-up completed.',
            followUpDate ? `Next follow-up: ${followUpDate}` : null,
          ]
            .filter(Boolean)
            .join(' | ');

          const upd = await client.query<{ id: string }>(
            `UPDATE public.customer_visits
             SET notes = CASE
               WHEN notes IS NULL OR btrim(notes) = '' THEN $4::text
               ELSE notes || E'\n' || $4::text
             END
             WHERE organization_id = $1::uuid
               AND id = $2::uuid
               AND employee_id = $3::uuid
             RETURNING id;`,
            [session.organizationId, visitId, employeeId, noteSuffix]
          );

          if (!upd.rows[0]) {
            throw new AppError(404, ApiErrorCode.NOT_FOUND, 'Customer visit not found for your account.');
          }
        },
        session.authUserId
      );

      res.status(200).json({
        success: true,
        data: { updated: true, message: 'Customer visit note updated.' },
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/employee/leaves
 */
employeeRouter.get('/leaves', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const employeeId = session.employeeId!;

    const leaves = await withTenantTransaction(
      session.organizationId,
      (client) => fetchMappedLeaves(client, session.organizationId, { employeeId }),
      session.authUserId
    );

    res.status(200).json({
      success: true,
      data: { leaves },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/employee/leaves
 * Strictly unpaid CL / SL / PL / LWP (0 payable hours, 0 annual quota).
 */
employeeRouter.post('/leaves', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const employeeId = session.employeeId!;
    const { category, startDate, endDate, reason } = (req.body ?? {}) as {
      category?: string;
      startDate?: string;
      endDate?: string;
      reason?: string;
    };

    const leaveCode = category?.trim().toUpperCase();
    if (!isValidLeaveCategory(leaveCode)) {
      throw new AppError(
        400,
        ApiErrorCode.VALIDATION_ERROR,
        'Leave category must strictly be one of CL, SL, PL, or LWP (all unpaid, 0h).'
      );
    }

    if (
      !startDate ||
      !endDate ||
      !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(endDate) ||
      endDate < startDate
    ) {
      throw new AppError(
        400,
        ApiErrorCode.VALIDATION_ERROR,
        'Valid YYYY-MM-DD startDate and endDate (with endDate >= startDate) are required.'
      );
    }

    const cleanReason = reason?.trim() ?? '';
    if (cleanReason.length < 3) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'Leave reason must be at least 3 characters.');
    }

    const created = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const typeRes = await client.query<{ id: string; is_paid: boolean }>(
          `SELECT id, is_paid FROM public.leave_types
           WHERE organization_id = $1::uuid AND code = $2::varchar AND is_active = TRUE
           LIMIT 1;`,
          [session.organizationId, leaveCode]
        );
        const leaveType = typeRes.rows[0];
        if (!leaveType) {
          throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, `Leave type ${leaveCode} is not configured.`);
        }

        const ins = await client.query<{ id: string; total_days: number }>(
          `INSERT INTO public.leave_applications (
             organization_id, employee_id, leave_type_id, leave_code,
             start_date, end_date, reason, status
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4::varchar,
             $5::date, $6::date, $7::text, 'PENDING'
           )
           RETURNING id, total_days;`,
          [
            session.organizationId,
            employeeId,
            leaveType.id,
            leaveCode,
            startDate,
            endDate,
            cleanReason,
          ]
        );

        await client.query(
          `INSERT INTO public.audit_logs (
             organization_id, actor_user_id, actor_role, action, entity_type, entity_id, summary, ip_address
           ) VALUES ($1::uuid, $2::uuid, 'EMPLOYEE', 'LEAVE_APPLIED', 'LEAVE', $3::uuid, $4::text, $5::varchar);`,
          [
            session.organizationId,
            session.authUserId,
            ins.rows[0]!.id,
            `${session.employeeCode ?? session.fullName} applied for unpaid ${leaveCode} (${startDate}..${endDate}, ${ins.rows[0]!.total_days}d).`,
            req.ip ?? null,
          ]
        );

        await notifyOrgAdmins(client, session.organizationId, {
          category: 'LEAVE',
          title: `New Unpaid Leave Application (${leaveCode})`,
          message: `${session.fullName} (${session.employeeCode ?? ''}) requested ${ins.rows[0]!.total_days} day(s) ${leaveCode} from ${startDate} to ${endDate}.`,
          entityType: 'LEAVE',
          entityId: ins.rows[0]!.id,
        });

        return {
          leaveId: ins.rows[0]!.id,
          totalDays: ins.rows[0]!.total_days,
          message: `Submitted ${leaveCode} leave (${ins.rows[0]!.total_days}d, unpaid 0h) for Admin review.`,
        };
      },
      session.authUserId
    );

    res.status(201).json({ success: true, data: created, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/employee/leaves/:leaveId/cancel
 */
employeeRouter.post('/leaves/:leaveId/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const employeeId = session.employeeId!;
    const { leaveId } = req.params as { leaveId: string };

    await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const upd = await client.query<{ id: string }>(
          `UPDATE public.leave_applications
           SET status = 'CANCELLED'
           WHERE organization_id = $1::uuid
             AND id = $2::uuid
             AND employee_id = $3::uuid
             AND status = 'PENDING'
           RETURNING id;`,
          [session.organizationId, leaveId, employeeId]
        );

        if (!upd.rows[0]) {
          throw new AppError(
            409,
            ApiErrorCode.CONFLICT,
            'Only your own PENDING leave applications can be cancelled.'
          );
        }
      },
      session.authUserId
    );

    res.status(200).json({
      success: true,
      data: { cancelled: true },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/employee/payroll
 * Strictly returns ONLY officially issued payslips after PO formula approval & Final Admin Approval.
 */
employeeRouter.get('/payroll', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const employeeId = session.employeeId!;
    const monthFilter = typeof req.query['month'] === 'string' ? req.query['month'].trim() : '';

    const items = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const params: unknown[] = [session.organizationId, employeeId];
        let monthSql = '';
        if (monthFilter) {
          const { year, month } = getMonthDateRange(monthFilter);
          params.push(year, month);
          monthSql = ` AND pp.year = $3 AND pp.month = $4`;
        }

        const resRows = await client.query<{
          item_id: string;
          employee_id: string;
          employee_code: string;
          employee_name: string;
          department_name: string | null;
          job_category: string;
          year: number;
          month: number;
          salary_reference_paise: string;
          calendar_days: number;
          derived_hourly_rate_paise: string;
          approved_payable_minutes: number;
          unpaid_leave_days: number;
          gross_earned_paise: string;
          adjustments_paise: string;
          net_payable_paise: string;
          payslip_id: string;
          payslip_number: string;
          issued_at: string;
          formula_mode: string;
          approved_at: string | null;
          payment_status: string | null;
          payment_reference: string | null;
          paid_at: string | null;
        }>(
          `SELECT pi.id AS item_id, pi.employee_id, e.employee_code, e.full_name AS employee_name,
                  d.name AS department_name, e.job_category, pp.year, pp.month,
                  pi.salary_reference_paise::TEXT, pi.calendar_days,
                  pi.derived_hourly_rate_paise::TEXT, pi.approved_payable_minutes,
                  pi.unpaid_leave_days, pi.gross_earned_paise::TEXT,
                  pi.adjustments_paise::TEXT, pi.net_payable_paise::TEXT,
                  ps.id::TEXT AS payslip_id, ps.payslip_number, ps.issued_at::TEXT,
                  pr.formula_mode, pr.approved_at::TEXT,
                  prrec.status AS payment_status, prrec.payment_reference, prrec.paid_at::TEXT
           FROM public.payslips ps
           JOIN public.payroll_items pi ON pi.id = ps.payroll_item_id AND pi.organization_id = ps.organization_id
           JOIN public.payroll_runs pr ON pr.id = pi.payroll_run_id AND pr.organization_id = pi.organization_id
           JOIN public.payroll_periods pp ON pp.id = pr.payroll_period_id
           JOIN public.employees e ON e.id = pi.employee_id AND e.organization_id = pi.organization_id
           LEFT JOIN public.departments d ON d.id = e.department_id
           LEFT JOIN public.payment_records prrec ON prrec.payroll_item_id = pi.id
           WHERE ps.organization_id = $1::uuid
             AND ps.employee_id = $2::uuid
             AND pr.status IN ('APPROVED', 'PROCESSED')
             AND pr.formula_approved = TRUE
             ${monthSql}
           ORDER BY pp.year DESC, pp.month DESC, ps.issued_at DESC;`,
          params
        );

        const payMap: Record<string, 'Paid' | 'Pending' | 'Failed'> = {
          PAID: 'Paid',
          PENDING: 'Pending',
          FAILED: 'Failed',
        };

        return resRows.rows.map((it) => ({
          itemId: it.item_id,
          payslipId: it.payslip_id,
          payslipNumber: it.payslip_number,
          month: `${it.year}-${String(it.month).padStart(2, '0')}`,
          formulaMode: it.formula_mode,
          issuedAt: it.issued_at,
          employeeId: it.employee_id,
          employeeCode: it.employee_code,
          employeeName: it.employee_name,
          department: it.department_name ?? it.job_category,
          monthlySalaryReference: Math.round((Number(it.salary_reference_paise) / 100) * 100) / 100,
          calendarDaysInMonth: it.calendar_days,
          hourlyRate: Math.round((Number(it.derived_hourly_rate_paise) / 100) * 100) / 100,
          approvedWorkingHours: Math.round((it.approved_payable_minutes / 60) * 100) / 100,
          unpaidLeaveDays: it.unpaid_leave_days,
          grossEarned: Math.round((Number(it.gross_earned_paise) / 100) * 100) / 100,
          adjustments: Math.round((Number(it.adjustments_paise) / 100) * 100) / 100,
          netSalary: Math.round((Number(it.net_payable_paise) / 100) * 100) / 100,
          approvalStatus: 'APPROVED' as const,
          paymentStatus: payMap[it.payment_status ?? 'PENDING'] ?? 'Pending',
          paymentReference: it.payment_reference,
          paidAt: it.paid_at,
          approvedAt: it.approved_at ?? undefined,
        }));
      },
      session.authUserId
    );

    res.status(200).json({
      success: true,
      data: { items },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/employee/tasks
 * Real operational items only (no synthetic demo tasks).
 */
employeeRouter.get('/tasks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const employeeId = session.employeeId!;
    const istToday = toIstDateAndHHMM().dateStr;

    const tasks = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const [profiles, todayRecords] = await Promise.all([
          fetchMappedEmployees(client, session.organizationId, { employeeId }),
          fetchMappedAttendanceRecords(client, session.organizationId, {
            employeeId,
            dateFrom: istToday,
            dateTo: istToday,
            limit: 1,
          }),
        ]);
        return buildEmployeeActionItems(client, session, todayRecords[0] ?? null, profiles[0] ?? null);
      },
      session.authUserId
    );

    res.status(200).json({
      success: true,
      data: { tasks },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/v1/employee/tasks/:taskId/status
 */
employeeRouter.patch('/tasks/:taskId/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const employeeId = session.employeeId!;
    const { taskId } = req.params as { taskId: string };

    if (!taskId.startsWith('visit-')) {
      throw new AppError(
        400,
        ApiErrorCode.VALIDATION_ERROR,
        'System compliance tasks resolve automatically once you complete the corresponding action (Check-Out, Face Enrollment, or Password Update).'
      );
    }

    const visitId = taskId.slice('visit-'.length);
    await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const upd = await client.query<{ id: string }>(
          `UPDATE public.customer_visits
           SET notes = COALESCE(notes, '') || E'\n[Follow-up acknowledged by employee]'
           WHERE organization_id = $1::uuid AND id = $2::uuid AND employee_id = $3::uuid
           RETURNING id;`,
          [session.organizationId, visitId, employeeId]
        );
        if (!upd.rows[0]) {
          throw new AppError(404, ApiErrorCode.NOT_FOUND, 'Task/visit item not found.');
        }
      },
      session.authUserId
    );

    res.status(200).json({
      success: true,
      data: { updated: true },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/employee/notifications
 * POST /api/v1/employee/notifications/:notificationId/read
 */
employeeRouter.get('/notifications', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const notifications = await withTenantTransaction(
      session.organizationId,
      (client) =>
        fetchMappedNotifications(client, session.organizationId, session.authUserId, 'EMPLOYEE'),
      session.authUserId
    );

    res.status(200).json({
      success: true,
      data: { notifications },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

employeeRouter.post(
  '/notifications/:notificationId/read',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = req.hrmsUser!;
      const { notificationId } = req.params as { notificationId: string };

      await withTenantTransaction(
        session.organizationId,
        async (client) => {
          await client.query(
            `UPDATE public.notifications
             SET is_read = TRUE, read_at = NOW()
             WHERE organization_id = $1::uuid
               AND id = $2::uuid
               AND recipient_user_id = $3::uuid;`,
            [session.organizationId, notificationId, session.authUserId]
          );
        },
        session.authUserId
      );

      res.status(200).json({
        success: true,
        data: { updated: true },
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }
);
