import type pg from 'pg';
import type {
  AttendanceAuditEntry,
  CustomerVisitRecord,
  DailyAttendanceRecord,
  EmployeeProfile,
  FieldDutySessionRecord,
  LeaveApplicationRecord,
  PayrollLineItem,
  SystemNotification,
  JobCategory,
  LeaveCategory,
  AttendanceEventType,
  AttendanceApprovalStatus,
  FaceVerificationState,
  LocationVerificationState,
  PaymentTrackingStatus,
} from '@hrms/shared';
import {
  calculateDualPayrollComparison,
  calculateHaversineDistanceMeters,
  getMonthDateRange,
  toIstDateAndHHMM,
} from './hrmsDomain.js';
import { createPrivateSignedUrl, type PrivateBucketName } from './supabaseAdmin.js';

export interface MappedOffice {
  id: string;
  code: string;
  name: string;
  branchName: string;
  address: string;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: number;
  radiusMeters: number;
  maxGpsAccuracyMeters: number;
  policyVersion: string;
  updatedBy?: string | null;
}

export async function getPrimaryOffice(
  client: pg.PoolClient,
  organizationId: string
): Promise<MappedOffice | null> {
  const res = await client.query<{
    id: string;
    code: string;
    name: string;
    branch_name: string | null;
    address: string;
    latitude: string;
    longitude: string;
    geofence_radius_meters: number;
    max_gps_accuracy_meters: number;
    policy_version: string;
    updated_by: string | null;
  }>(
    `SELECT id, code, name, branch_name, address, latitude, longitude,
            geofence_radius_meters, max_gps_accuracy_meters, policy_version, updated_by
     FROM public.offices
     WHERE organization_id = $1::uuid AND is_active = TRUE
     ORDER BY is_primary DESC, created_at ASC
     LIMIT 1;`,
    [organizationId]
  );

  const row = res.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    branchName: row.branch_name ?? row.name,
    address: row.address,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    geofenceRadiusMeters: Number(row.geofence_radius_meters),
    radiusMeters: Number(row.geofence_radius_meters),
    maxGpsAccuracyMeters: Number(row.max_gps_accuracy_meters),
    policyVersion: row.policy_version,
    updatedBy: row.updated_by,
  };
}

export async function fetchMappedEmployees(
  client: pg.PoolClient,
  organizationId: string,
  options?: { employeeId?: string }
): Promise<EmployeeProfile[]> {
  const params: unknown[] = [organizationId];
  let filterSql = '';
  if (options?.employeeId) {
    params.push(options.employeeId);
    filterSql = ` AND e.id = $${params.length}::uuid`;
  }

  const res = await client.query<{
    id: string;
    user_id: string;
    employee_code: string;
    first_name: string;
    last_name: string;
    full_name: string;
    phone_number: string;
    job_category: JobCategory;
    department_id: string | null;
    department_name: string | null;
    designation_id: string | null;
    designation_title: string | null;
    office_id: string;
    joining_date: string;
    employment_status: EmployeeProfile['employmentStatus'];
    is_field_eligible: boolean;
    shift_start_time: string;
    shift_end_time: string;
    emergency_contact_name: string | null;
    emergency_contact_phone: string | null;
    user_is_active: boolean;
    activated_at: string | null;
    must_change_password: boolean;
    monthly_salary_paise: string | null;
    biometric_status: string | null;
  }>(
    `SELECT e.id, e.user_id, e.employee_code, e.first_name, e.last_name, e.full_name,
            e.phone_number, e.job_category, e.department_id, d.name AS department_name,
            e.designation_id, ds.title AS designation_title, e.office_id,
            e.joining_date::TEXT, e.employment_status, e.is_field_eligible,
            e.shift_start_time::TEXT, e.shift_end_time::TEXT,
            e.emergency_contact_name, e.emergency_contact_phone,
            u.is_active AS user_is_active, u.activated_at::TEXT, u.must_change_password,
            sal.monthly_salary_paise::TEXT,
            bio.status AS biometric_status
     FROM public.employees e
     JOIN public.users u ON u.id = e.user_id AND u.organization_id = e.organization_id
     LEFT JOIN public.departments d ON d.id = e.department_id
     LEFT JOIN public.designations ds ON ds.id = e.designation_id
     LEFT JOIN LATERAL (
       SELECT s.monthly_salary_paise
       FROM public.employee_salaries s
       WHERE s.organization_id = e.organization_id
         AND s.employee_id = e.id
         AND s.status = 'ACTIVE'
       ORDER BY s.effective_from DESC
       LIMIT 1
     ) sal ON TRUE
     LEFT JOIN LATERAL (
       SELECT b.status
       FROM public.biometric_enrollments b
       WHERE b.organization_id = e.organization_id
         AND b.employee_id = e.id
         AND b.is_current = TRUE
       ORDER BY b.created_at DESC
       LIMIT 1
     ) bio ON TRUE
     WHERE e.organization_id = $1::uuid
       AND NOT EXISTS (
         SELECT 1 FROM public.user_roles ur
         WHERE ur.organization_id = e.organization_id
           AND ur.user_id = e.user_id
           AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
       )
       ${filterSql}
     ORDER BY e.employee_code ASC;`,
    params
  );

  return res.rows.map((r) => {
    const faceMap: Record<string, EmployeeProfile['faceEnrollmentStatus']> = {
      APPROVED: 'APPROVED',
      PENDING: 'PENDING_VERIFICATION',
      REJECTED: 'NOT_ENROLLED',
      REVOKED: 'NOT_ENROLLED',
      REQUIRED: 'NOT_ENROLLED',
    };
    const isActivated = Boolean(r.activated_at);
    return {
      id: r.id,
      userId: r.user_id,
      employeeCode: r.employee_code,
      firstName: r.first_name,
      lastName: r.last_name,
      fullName: r.full_name,
      phoneNumber: r.phone_number,
      role: 'EMPLOYEE',
      jobCategory: r.job_category,
      departmentId: r.department_id ?? undefined,
      department: r.department_name ?? r.job_category,
      designationId: r.designation_id ?? undefined,
      designation: r.designation_title ?? r.job_category,
      officeId: r.office_id,
      joiningDate: r.joining_date,
      employmentStatus: r.employment_status,
      isFieldEligible: r.is_field_eligible,
      shiftStart: r.shift_start_time.slice(0, 5),
      shiftEnd: r.shift_end_time.slice(0, 5),
      monthlySalaryReference: r.monthly_salary_paise
        ? Math.round((Number(r.monthly_salary_paise) / 100) * 100) / 100
        : 0,
      faceEnrollmentStatus: faceMap[r.biometric_status ?? ''] ?? 'NOT_ENROLLED',
      emergencyContactName: r.emergency_contact_name ?? undefined,
      emergencyContactPhone: r.emergency_contact_phone ?? undefined,
      isActive: r.user_is_active,
      isActivated,
      activationStatus: !r.user_is_active
        ? 'DEACTIVATED'
        : isActivated
          ? 'ACTIVATED'
          : 'PENDING_ACTIVATION',
      mustChangePassword: r.must_change_password,
    } as EmployeeProfile & {
      userId: string;
      departmentId?: string;
      designationId?: string;
      isFieldEligible: boolean;
      isActive: boolean;
      isActivated: boolean;
      activationStatus: string;
      mustChangePassword: boolean;
    };
  });
}

function mapFaceState(rawStatus: string | null | undefined): FaceVerificationState {
  if (rawStatus === 'VERIFIED') return 'VERIFIED';
  if (rawStatus === 'MISMATCH') return 'FAILED';
  if (rawStatus === 'SPOOFING_SUSPECTED' || rawStatus === 'FACE_NOT_DETECTED') return 'FAILED';
  if (rawStatus === 'PROVIDER_UNCONFIGURED') return 'VERIFICATION_PENDING';
  return 'VERIFICATION_PENDING';
}

function mapLocationState(
  isOutside: boolean,
  accuracy: number | null,
  maxAccuracy = 30
): LocationVerificationState {
  if (accuracy !== null && accuracy > maxAccuracy) return 'POOR_GPS_ACCURACY';
  return isOutside ? 'OUTSIDE_GEOFENCE' : 'INSIDE_GEOFENCE';
}

export async function fetchMappedAttendanceRecords(
  client: pg.PoolClient,
  organizationId: string,
  options?: {
    employeeId?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
    includeSignedMedia?: boolean;
  }
): Promise<Array<DailyAttendanceRecord & {
  checkInSelfieUrl?: string | null;
  checkOutSelfieUrl?: string | null;
  enrolledFaceUrl?: string | null;
  faceProviderStatus?: string | null;
}>> {
  const params: unknown[] = [organizationId];
  const conditions: string[] = [
    'ad.organization_id = $1::uuid',
    `NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.organization_id = ad.organization_id
        AND ur.user_id = e.user_id
        AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
    )`,
  ];

  if (options?.employeeId) {
    params.push(options.employeeId);
    conditions.push(`ad.employee_id = $${params.length}::uuid`);
  }
  if (options?.dateFrom) {
    params.push(options.dateFrom);
    conditions.push(`ad.attendance_date >= $${params.length}::date`);
  }
  if (options?.dateTo) {
    params.push(options.dateTo);
    conditions.push(`ad.attendance_date <= $${params.length}::date`);
  }

  const limit = Math.min(Math.max(options?.limit ?? 150, 1), 500);
  params.push(limit);

  const res = await client.query<{
    id: string;
    employee_id: string;
    employee_code: string;
    employee_name: string;
    department_name: string | null;
    job_category: JobCategory;
    attendance_date: string;
    check_in_at: string | null;
    check_out_at: string | null;
    check_in_event_type: AttendanceEventType | null;
    approval_status: AttendanceApprovalStatus;
    verification_state: string;
    location_state: string;
    check_in_latitude: string | null;
    check_in_longitude: string | null;
    check_in_accuracy_meters: string | null;
    check_in_distance_meters: string | null;
    is_outside_geofence: boolean;
    outside_geofence_comment: string | null;
    is_late_arrival: boolean;
    is_early_departure: boolean;
    lunch_deducted_minutes: number;
    payable_minutes: number;
    approved_payable_minutes: number;
    post_6pm_minutes: number;
    post_6pm_approved: boolean;
    review_reason: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    ci_selfie_bucket: string | null;
    ci_selfie_path: string | null;
    co_selfie_bucket: string | null;
    co_selfie_path: string | null;
    enrolled_bucket: string | null;
    enrolled_path: string | null;
    latest_face_status: string | null;
    latest_liveness_status: string | null;
    latest_confidence: string | null;
    attempts_count: string;
  }>(
    `SELECT ad.id, ad.employee_id, e.employee_code, e.full_name AS employee_name,
            d.name AS department_name, e.job_category, ad.attendance_date::TEXT,
            ad.check_in_at::TEXT, ad.check_out_at::TEXT, ad.check_in_event_type,
            ad.approval_status, ad.verification_state, ad.location_state,
            ad.check_in_latitude::TEXT, ad.check_in_longitude::TEXT,
            ad.check_in_accuracy_meters::TEXT, ad.check_in_distance_meters::TEXT,
            ad.is_outside_geofence, ad.outside_geofence_comment,
            ad.is_late_arrival, ad.is_early_departure,
            ad.lunch_deducted_minutes, ad.payable_minutes, ad.approved_payable_minutes,
            ad.post_6pm_minutes, ad.post_6pm_approved,
            ad.review_reason, ad.reviewed_by::TEXT, ad.reviewed_at::TEXT,
            ci.selfie_bucket AS ci_selfie_bucket, ci.selfie_path AS ci_selfie_path,
            co.selfie_bucket AS co_selfie_bucket, co.selfie_path AS co_selfie_path,
            bio.evidence_bucket AS enrolled_bucket, bio.evidence_path AS enrolled_path,
            fva.match_status AS latest_face_status,
            fva.liveness_status AS latest_liveness_status,
            fva.confidence_score::TEXT AS latest_confidence,
            COALESCE(fva.attempt_number, 1)::TEXT AS attempts_count
     FROM public.attendance_days ad
     JOIN public.employees e ON e.id = ad.employee_id AND e.organization_id = ad.organization_id
     LEFT JOIN public.departments d ON d.id = e.department_id
     LEFT JOIN public.attendance_events ci
       ON ci.attendance_day_id = ad.id AND ci.punch_direction = 'CHECK_IN'
     LEFT JOIN public.attendance_events co
       ON co.attendance_day_id = ad.id AND co.punch_direction = 'CHECK_OUT'
     LEFT JOIN LATERAL (
       SELECT b.evidence_bucket, b.evidence_path
       FROM public.biometric_enrollments b
       WHERE b.organization_id = ad.organization_id
         AND b.employee_id = ad.employee_id
         AND b.is_current = TRUE
       ORDER BY b.created_at DESC
       LIMIT 1
     ) bio ON TRUE
     LEFT JOIN LATERAL (
       SELECT f.match_status, f.liveness_status, f.confidence_score, f.attempt_number
       FROM public.face_verification_attempts f
       WHERE f.organization_id = ad.organization_id
         AND f.attendance_day_id = ad.id
       ORDER BY f.created_at DESC
       LIMIT 1
     ) fva ON TRUE
     WHERE ${conditions.join(' AND ')}
     ORDER BY ad.attendance_date DESC, ad.check_in_at DESC NULLS LAST
     LIMIT $${params.length};`,
    params
  );

  if (res.rows.length === 0) return [];

  // Load immutable attendance_corrections in single batch query
  const dayIds = res.rows.map((r) => r.id);
  const corrRes = await client.query<{
    id: string;
    attendance_day_id: string;
    reason: string;
    previous_check_in_at: string | null;
    new_check_in_at: string | null;
    previous_check_out_at: string | null;
    new_check_out_at: string | null;
    previous_approved_payable_minutes: number | null;
    new_approved_payable_minutes: number | null;
    created_at: string;
  }>(
    `SELECT id, attendance_day_id, reason, previous_check_in_at::TEXT, new_check_in_at::TEXT,
            previous_check_out_at::TEXT, new_check_out_at::TEXT,
            previous_approved_payable_minutes, new_approved_payable_minutes, created_at::TEXT
     FROM public.attendance_corrections
     WHERE organization_id = $1::uuid AND attendance_day_id = ANY($2::uuid[])
     ORDER BY created_at DESC;`,
    [organizationId, dayIds]
  );

  const trailByDay = new Map<string, AttendanceAuditEntry[]>();
  for (const c of corrRes.rows) {
    const list = trailByDay.get(c.attendance_day_id) ?? [];
    list.push({
      id: c.id,
      timestamp: c.created_at,
      actorName: 'Organization Admin',
      actorRole: 'ADMIN',
      action: 'ATTENDANCE_CORRECTED',
      reason: c.reason,
      previousValue: c.previous_approved_payable_minutes !== null
        ? `${c.previous_approved_payable_minutes}m`
        : undefined,
      updatedValue: c.new_approved_payable_minutes !== null
        ? `${c.new_approved_payable_minutes}m`
        : undefined,
    });
    trailByDay.set(c.attendance_day_id, list);
  }

  return Promise.all(
    res.rows.map(async (r) => {
      const checkInIst = r.check_in_at ? toIstDateAndHHMM(r.check_in_at) : null;
      const checkOutIst = r.check_out_at ? toIstDateAndHHMM(r.check_out_at) : null;
      const accuracyNum = r.check_in_accuracy_meters !== null ? Number(r.check_in_accuracy_meters) : undefined;
      const distNum = r.check_in_distance_meters !== null ? Number(r.check_in_distance_meters) : undefined;

      const [checkInSelfieUrl, checkOutSelfieUrl, enrolledFaceUrl] = options?.includeSignedMedia
        ? await Promise.all([
            r.ci_selfie_path
              ? createPrivateSignedUrl((r.ci_selfie_bucket as PrivateBucketName) || 'attendance-selfies', r.ci_selfie_path, 120)
              : Promise.resolve(null),
            r.co_selfie_path
              ? createPrivateSignedUrl((r.co_selfie_bucket as PrivateBucketName) || 'attendance-selfies', r.co_selfie_path, 120)
              : Promise.resolve(null),
            r.enrolled_path
              ? createPrivateSignedUrl((r.enrolled_bucket as PrivateBucketName) || 'face-enrollment', r.enrolled_path, 120)
              : Promise.resolve(null),
          ])
        : [null, null, null];

      let uiStatus: DailyAttendanceRecord['status'] = 'PRESENT';
      if (r.approval_status === 'PENDING_ADMIN_REVIEW' || r.approval_status === 'VERIFICATION_PENDING') {
        uiStatus = 'PENDING_REVIEW';
      } else if (r.approval_status === 'REJECTED') {
        uiStatus = 'ABSENT';
      }

      return {
        id: r.id,
        employeeId: r.employee_id,
        employeeCode: r.employee_code,
        employeeName: r.employee_name,
        department: r.department_name ?? r.job_category,
        jobCategory: r.job_category,
        date: r.attendance_date,
        eventType: r.check_in_event_type ?? 'FACE_EMPLOYEE_APP',
        checkInTime: checkInIst?.hhmm,
        checkOutTime: checkOutIst?.hhmm,
        status: uiStatus,
        approvalStatus: r.approval_status,
        faceState: mapFaceState(r.latest_face_status),
        livenessPassed: r.latest_liveness_status === 'LIVE',
        faceConfidence: r.latest_confidence !== null ? Number(r.latest_confidence) : undefined,
        faceAttemptsUsed: Number(r.attempts_count || 1),
        locationState: mapLocationState(r.is_outside_geofence, accuracyNum ?? null),
        latitude: r.check_in_latitude !== null ? Number(r.check_in_latitude) : undefined,
        longitude: r.check_in_longitude !== null ? Number(r.check_in_longitude) : undefined,
        gpsAccuracyMeters: accuracyNum,
        distanceFromOfficeMeters: distNum !== undefined ? Math.round(distNum) : undefined,
        employeeComment: r.outside_geofence_comment ?? undefined,
        isLateArrival: r.is_late_arrival,
        isEarlyDeparture: r.is_early_departure,
        lunchDeductionMinutes: r.lunch_deducted_minutes,
        approvedPayableMinutes: r.approved_payable_minutes,
        payableMinutes: r.payable_minutes,
        postShiftMinutes: r.post_6pm_minutes,
        postShiftApproved: r.post_6pm_approved,
        selfieCapturedLabel: r.ci_selfie_path
          ? `Stored in private storage (${r.latest_face_status ?? 'PENDING'})`
          : undefined,
        adminRemarks: r.review_reason ?? undefined,
        reviewedBy: r.reviewed_by ?? undefined,
        reviewedAt: r.reviewed_at ?? undefined,
        auditTrail: trailByDay.get(r.id) ?? [],
        checkInSelfieUrl,
        checkOutSelfieUrl,
        enrolledFaceUrl,
        faceProviderStatus: r.latest_face_status,
      };
    })
  );
}

export async function fetchMappedFieldSessions(
  client: pg.PoolClient,
  organizationId: string,
  options?: { employeeId?: string }
): Promise<FieldDutySessionRecord[]> {
  const params: unknown[] = [organizationId];
  let empFilter = '';
  if (options?.employeeId) {
    params.push(options.employeeId);
    empFilter = ` AND s.employee_id = $${params.length}::uuid`;
  }

  const sessRes = await client.query<{
    id: string;
    employee_id: string;
    employee_code: string;
    employee_name: string;
    job_category: string;
    status: 'ACTIVE' | 'ENDED' | 'CANCELLED';
    started_at: string;
    ended_at: string | null;
    start_latitude: string;
    start_longitude: string;
    start_accuracy_meters: string;
    att_approval_status: AttendanceApprovalStatus | null;
  }>(
    `SELECT s.id, s.employee_id, e.employee_code, e.full_name AS employee_name, e.job_category,
            s.status, s.started_at::TEXT, s.ended_at::TEXT,
            s.start_latitude::TEXT, s.start_longitude::TEXT, s.start_accuracy_meters::TEXT,
            ad.approval_status AS att_approval_status
     FROM public.field_duty_sessions s
     JOIN public.employees e ON e.id = s.employee_id AND e.organization_id = s.organization_id
     LEFT JOIN public.attendance_days ad ON ad.id = s.attendance_day_id
     WHERE s.organization_id = $1::uuid
       AND e.job_category IN ('SALES', 'RECOVERY')
       ${empFilter}
     ORDER BY s.started_at DESC
     LIMIT 60;`,
    params
  );

  if (sessRes.rows.length === 0) return [];

  const sessionIds = sessRes.rows.map((s) => s.id);
  const gpsRes = await client.query<{
    session_id: string;
    latitude: string;
    longitude: string;
    accuracy_meters: string;
    recorded_at: string;
  }>(
    `SELECT session_id, latitude::TEXT, longitude::TEXT, accuracy_meters::TEXT, recorded_at::TEXT
     FROM public.field_duty_gps_events
     WHERE organization_id = $1::uuid AND session_id = ANY($2::uuid[])
     ORDER BY recorded_at ASC;`,
    [organizationId, sessionIds]
  );

  const gpsBySession = new Map<string, typeof gpsRes.rows>();
  for (const pt of gpsRes.rows) {
    const arr = gpsBySession.get(pt.session_id) ?? [];
    arr.push(pt);
    gpsBySession.set(pt.session_id, arr);
  }

  return sessRes.rows.map((s) => {
    const pts = gpsBySession.get(s.id) ?? [];
    let distanceMeters = 0;
    let prevLat = Number(s.start_latitude);
    let prevLng = Number(s.start_longitude);
    const routePoints = pts.map((p, idx) => {
      const lat = Number(p.latitude);
      const lng = Number(p.longitude);
      if (idx > 0 || (lat !== prevLat || lng !== prevLng)) {
        distanceMeters += calculateHaversineDistanceMeters(prevLat, prevLng, lat, lng);
      }
      prevLat = lat;
      prevLng = lng;
      return {
        time: toIstDateAndHHMM(p.recorded_at).hhmm,
        label: `GPS Checkpoint (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
        lat,
        lng,
        accuracyMeters: Math.round(Number(p.accuracy_meters)),
      };
    });

    const lastPt = pts[pts.length - 1];
    return {
      id: s.id,
      employeeId: s.employee_id,
      employeeCode: s.employee_code,
      employeeName: s.employee_name,
      jobCategory: (s.job_category === 'RECOVERY' ? 'RECOVERY' : 'SALES') as 'SALES' | 'RECOVERY',
      date: toIstDateAndHHMM(s.started_at).dateStr,
      status: s.status === 'ACTIVE' ? 'ACTIVE' : 'ENDED',
      authorizedAt: s.started_at,
      endedAt: s.ended_at ?? undefined,
      attendanceStatusAtStart: s.att_approval_status ?? 'PENDING_ADMIN_REVIEW',
      distanceTravelledKm: Math.round((distanceMeters / 1000) * 100) / 100,
      gpsSamplesCount: Math.max(1, pts.length),
      gpsGapsCount: 0,
      lastLatitude: lastPt ? Number(lastPt.latitude) : Number(s.start_latitude),
      lastLongitude: lastPt ? Number(lastPt.longitude) : Number(s.start_longitude),
      lastAccuracyMeters: lastPt ? Number(lastPt.accuracy_meters) : Number(s.start_accuracy_meters),
      lastLocationLabel: lastPt
        ? `${Number(lastPt.latitude).toFixed(5)}, ${Number(lastPt.longitude).toFixed(5)}`
        : `${Number(s.start_latitude).toFixed(5)}, ${Number(s.start_longitude).toFixed(5)}`,
      lastUpdatedAt: lastPt ? lastPt.recorded_at : s.started_at,
      offlineQueueCount: 0,
      routePoints,
    };
  });
}

export async function fetchMappedCustomerVisits(
  client: pg.PoolClient,
  organizationId: string,
  options?: { employeeId?: string; includeSignedEvidence?: boolean }
): Promise<Array<CustomerVisitRecord & {
  evidenceSignedUrl?: string | null;
  reviewStatus: string;
  reviewNote?: string;
}>> {
  const params: unknown[] = [organizationId];
  let empFilter = '';
  if (options?.employeeId) {
    params.push(options.employeeId);
    empFilter = ` AND v.employee_id = $${params.length}::uuid`;
  }

  const res = await client.query<{
    id: string;
    employee_id: string;
    employee_code: string;
    employee_name: string;
    job_category: string;
    customer_name: string;
    customer_reference: string | null;
    visit_purpose: string;
    notes: string | null;
    latitude: string;
    longitude: string;
    evidence_bucket: string;
    evidence_path: string | null;
    visited_at: string;
    review_status: string;
    review_note: string | null;
  }>(
    `SELECT v.id, v.employee_id, e.employee_code, e.full_name AS employee_name, e.job_category,
            v.customer_name, v.customer_reference, v.visit_purpose, v.notes,
            v.latitude::TEXT, v.longitude::TEXT,
            v.evidence_bucket, v.evidence_path,
            v.visited_at::TEXT, v.review_status, v.review_note
     FROM public.customer_visits v
     JOIN public.employees e ON e.id = v.employee_id AND e.organization_id = v.organization_id
     WHERE v.organization_id = $1::uuid
       ${empFilter}
     ORDER BY v.visited_at DESC
     LIMIT 80;`,
    params
  );

  return Promise.all(
    res.rows.map(async (v) => {
      const signedUrl =
        options?.includeSignedEvidence && v.evidence_path
          ? await createPrivateSignedUrl(
              (v.evidence_bucket as PrivateBucketName) || 'visit-evidence',
              v.evidence_path,
              120
            )
          : null;
      return {
        id: v.id,
        employeeId: v.employee_id,
        employeeCode: v.employee_code,
        employeeName: v.employee_name,
        visitCategory: (v.job_category === 'RECOVERY' ? 'RECOVERY' : 'SALES') as 'SALES' | 'RECOVERY',
        customerCode: v.customer_reference || v.visit_purpose,
        customerName: v.customer_name,
        customerAddress: `${Number(v.latitude).toFixed(5)}, ${Number(v.longitude).toFixed(5)}`,
        plannedTime: toIstDateAndHHMM(v.visited_at).hhmm,
        completedAt: v.visited_at,
        status: v.review_status === 'REJECTED' ? 'FAILED' : 'COMPLETED',
        outcomeNote: v.notes ?? `${v.visit_purpose} completed`,
        gpsLat: Number(v.latitude),
        gpsLng: Number(v.longitude),
        gpsTimestamp: v.visited_at,
        selfieVerified: Boolean(v.evidence_path),
        evidenceSignedUrl: signedUrl,
        reviewStatus: v.review_status,
        reviewNote: v.review_note ?? undefined,
      };
    })
  );
}

export async function fetchMappedLeaves(
  client: pg.PoolClient,
  organizationId: string,
  options?: { employeeId?: string }
): Promise<LeaveApplicationRecord[]> {
  const params: unknown[] = [organizationId];
  let empFilter = '';
  if (options?.employeeId) {
    params.push(options.employeeId);
    empFilter = ` AND la.employee_id = $${params.length}::uuid`;
  }

  const res = await client.query<{
    id: string;
    employee_id: string;
    employee_code: string;
    employee_name: string;
    department_name: string | null;
    job_category: JobCategory;
    leave_code: LeaveCategory;
    start_date: string;
    end_date: string;
    total_days: number;
    reason: string;
    status: string;
    decision_reason: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    created_at: string;
  }>(
    `SELECT la.id, la.employee_id, e.employee_code, e.full_name AS employee_name,
            d.name AS department_name, e.job_category, la.leave_code,
            la.start_date::TEXT, la.end_date::TEXT, la.total_days, la.reason,
            la.status, la.decision_reason, la.reviewed_by::TEXT, la.reviewed_at::TEXT, la.created_at::TEXT
     FROM public.leave_applications la
     JOIN public.employees e ON e.id = la.employee_id AND e.organization_id = la.organization_id
     LEFT JOIN public.departments d ON d.id = e.department_id
     WHERE la.organization_id = $1::uuid
       AND NOT EXISTS (
         SELECT 1 FROM public.user_roles ur
         WHERE ur.organization_id = la.organization_id
           AND ur.user_id = e.user_id
           AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
       )
       ${empFilter}
     ORDER BY la.created_at DESC
     LIMIT 120;`,
    params
  );

  return res.rows.map((l) => ({
    id: l.id,
    employeeId: l.employee_id,
    employeeCode: l.employee_code,
    employeeName: l.employee_name,
    department: l.department_name ?? l.job_category,
    category: l.leave_code,
    startDate: l.start_date,
    endDate: l.end_date,
    totalDays: l.total_days,
    reason: l.reason,
    status: (l.status === 'CANCELLED' ? 'REJECTED' : l.status) as 'PENDING' | 'APPROVED' | 'REJECTED',
    appliedAt: l.created_at,
    adminRemarks: l.decision_reason ?? undefined,
    reviewedBy: l.reviewed_by ?? undefined,
    reviewedAt: l.reviewed_at ?? undefined,
  }));
}

export async function fetchMappedNotifications(
  client: pg.PoolClient,
  organizationId: string,
  recipientUserId: string,
  role: 'ADMIN' | 'EMPLOYEE'
): Promise<SystemNotification[]> {
  const res = await client.query<{
    id: string;
    title: string;
    message: string;
    category: string;
    entity_type: string | null;
    is_read: boolean;
    created_at: string;
  }>(
    `SELECT id, title, message, category, entity_type, is_read, created_at::TEXT
     FROM public.notifications
     WHERE organization_id = $1::uuid
       AND recipient_user_id = $2::uuid
     ORDER BY created_at DESC
     LIMIT 50;`,
    [organizationId, recipientUserId]
  );

  return res.rows.map((n) => {
    let severity: SystemNotification['severity'] = 'info';
    if (n.category === 'PAYSLIP' || n.category === 'APPROVAL') severity = 'success';
    if (n.category === 'REJECTION' || n.category === 'ALERT') severity = 'warning';

    let linkTo = role === 'ADMIN' ? '/admin/attendance' : '/employee/notifications';
    if (role === 'ADMIN') {
      if (n.entity_type === 'LEAVE') linkTo = '/admin/leave';
      if (n.entity_type === 'PAYROLL') linkTo = '/admin/payroll';
      if (n.entity_type === 'BIOMETRIC') linkTo = '/admin/security';
    } else {
      if (n.entity_type === 'LEAVE') linkTo = '/employee/leave';
      if (n.entity_type === 'PAYROLL' || n.category === 'PAYSLIP') linkTo = '/employee/payroll';
      if (n.entity_type === 'ATTENDANCE') linkTo = '/employee/attendance';
    }

    return {
      id: n.id,
      title: n.title,
      message: n.message,
      timestamp: n.created_at,
      severity,
      targetRole: role,
      read: n.is_read,
      linkTo,
    };
  });
}

export async function fetchMappedPayrollForMonth(
  client: pg.PoolClient,
  organizationId: string,
  monthYYYYMM: string,
  options?: { employeeOnlyId?: string }
): Promise<{
  month: string;
  run: {
    id: string;
    status: string;
    formulaMode: string;
    formulaApproved: boolean;
    formulaApprovedAt: string | null;
    approvedAt: string | null;
    calendarDays: number;
    workingDaysMonSat: number;
    payslipsIssued: number;
  } | null;
  items: Array<PayrollLineItem & {
    itemId: string;
    payslipId?: string | null;
    payslipNumber?: string | null;
    formulaComparison?: ReturnType<typeof calculateDualPayrollComparison>;
    paymentReference?: string | null;
    paidAt?: string | null;
  }>;
}> {
  const { year, month, calendarDays, workingDaysMonSat } = getMonthDateRange(monthYYYYMM);

  const runRes = await client.query<{
    id: string;
    status: string;
    formula_mode: string;
    formula_approved: boolean;
    formula_approved_at: string | null;
    approved_by: string | null;
    approved_at: string | null;
    calendar_days: number;
  }>(
    `SELECT pr.id, pr.status, pr.formula_mode, pr.formula_approved,
            pr.formula_approved_at::TEXT, pr.approved_by::TEXT, pr.approved_at::TEXT,
            pr.calendar_days
     FROM public.payroll_runs pr
     JOIN public.payroll_periods pp ON pp.id = pr.payroll_period_id
     WHERE pr.organization_id = $1::uuid
       AND pp.year = $2
       AND pp.month = $3
       AND pr.status <> 'CANCELLED'
     ORDER BY pr.run_number DESC
     LIMIT 1;`,
    [organizationId, year, month]
  );

  const run = runRes.rows[0];
  if (!run) {
    return { month: monthYYYYMM, run: null, items: [] };
  }

  const params: unknown[] = [organizationId, run.id];
  let empClause = '';
  if (options?.employeeOnlyId) {
    params.push(options.employeeOnlyId);
    empClause = ` AND pi.employee_id = $${params.length}::uuid AND ps.id IS NOT NULL`;
  }

  const itemsRes = await client.query<{
    item_id: string;
    employee_id: string;
    employee_code: string;
    employee_name: string;
    department_name: string | null;
    job_category: JobCategory;
    salary_reference_paise: string;
    calendar_days: number;
    derived_hourly_rate_paise: string;
    approved_payable_minutes: number;
    unpaid_leave_days: number;
    gross_earned_paise: string;
    adjustments_paise: string;
    net_payable_paise: string;
    payslip_id: string | null;
    payslip_number: string | null;
    payment_status: string | null;
    payment_reference: string | null;
    paid_at: string | null;
  }>(
    `SELECT pi.id AS item_id, pi.employee_id, e.employee_code, e.full_name AS employee_name,
            d.name AS department_name, e.job_category,
            pi.salary_reference_paise::TEXT, pi.calendar_days,
            pi.derived_hourly_rate_paise::TEXT, pi.approved_payable_minutes,
            pi.unpaid_leave_days, pi.gross_earned_paise::TEXT,
            pi.adjustments_paise::TEXT, pi.net_payable_paise::TEXT,
            ps.id::TEXT AS payslip_id, ps.payslip_number,
            prrec.status AS payment_status, prrec.payment_reference, prrec.paid_at::TEXT
     FROM public.payroll_items pi
     JOIN public.employees e ON e.id = pi.employee_id AND e.organization_id = pi.organization_id
     LEFT JOIN public.departments d ON d.id = e.department_id
     LEFT JOIN public.payslips ps ON ps.payroll_item_id = pi.id
     LEFT JOIN public.payment_records prrec ON prrec.payroll_item_id = pi.id
     WHERE pi.organization_id = $1::uuid
       AND pi.payroll_run_id = $2::uuid
       AND NOT EXISTS (
         SELECT 1 FROM public.user_roles ur
         WHERE ur.organization_id = pi.organization_id
           AND ur.user_id = e.user_id
           AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
       )
       ${empClause}
     ORDER BY e.employee_code ASC;`,
    params
  );

  const payMap: Record<string, PaymentTrackingStatus> = {
    PAID: 'Paid',
    PENDING: 'Pending',
    FAILED: 'Failed',
  };

  let payslipsIssued = 0;
  const items = itemsRes.rows.map((it) => {
    if (it.payslip_id) payslipsIssued += 1;
    const salPaise = Number(it.salary_reference_paise);
    const adjPaise = Number(it.adjustments_paise);
    const comparison = calculateDualPayrollComparison({
      monthlySalaryPaise: salPaise,
      approvedPayableMinutes: it.approved_payable_minutes,
      calendarDays: it.calendar_days || calendarDays,
      workingDaysMonSat,
      adjustmentsPaise: adjPaise,
    });
    const isApproved = run.status === 'APPROVED' || run.status === 'PROCESSED';

    return {
      itemId: it.item_id,
      employeeId: it.employee_id,
      employeeCode: it.employee_code,
      employeeName: it.employee_name,
      department: it.department_name ?? it.job_category,
      jobCategory: it.job_category,
      monthlySalaryReference: Math.round((salPaise / 100) * 100) / 100,
      calendarDaysInMonth: it.calendar_days,
      hourlyRate: Math.round((Number(it.derived_hourly_rate_paise) / 100) * 100) / 100,
      approvedWorkingHours: Math.round((it.approved_payable_minutes / 60) * 100) / 100,
      unpaidLeaveDays: it.unpaid_leave_days,
      grossEarned: Math.round((Number(it.gross_earned_paise) / 100) * 100) / 100,
      adjustments: Math.round((adjPaise / 100) * 100) / 100,
      netSalary: Math.round((Number(it.net_payable_paise) / 100) * 100) / 100,
      approvalStatus: (isApproved ? 'APPROVED' : 'DRAFT') as 'APPROVED' | 'DRAFT',
      paymentStatus: payMap[it.payment_status ?? 'PENDING'] ?? 'Pending',
      approvedBy: run.approved_by ?? undefined,
      approvedAt: run.approved_at ?? undefined,
      payslipId: it.payslip_id,
      payslipNumber: it.payslip_number,
      formulaComparison: comparison,
      paymentReference: it.payment_reference,
      paidAt: it.paid_at,
    };
  });

  return {
    month: monthYYYYMM,
    run: {
      id: run.id,
      status: run.status,
      formulaMode: run.formula_mode,
      formulaApproved: run.formula_approved,
      formulaApprovedAt: run.formula_approved_at,
      approvedAt: run.approved_at,
      calendarDays: run.calendar_days,
      workingDaysMonSat,
      payslipsIssued,
    },
    items,
  };
}
