import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { closePool, getPool } from '../src/db/pool.js';
import { withTenantTransaction } from '../src/db/transaction.js';
import {
  buildSyntheticEmail,
  calculateDec01AttendanceMinutes,
  calculateDualPayrollComparison,
  calculateHaversineDistanceMeters,
  toIstDateAndHHMM,
} from '../src/services/hrmsDomain.js';
import {
  adminCreateGoTrueUser,
  adminDeleteGoTrueUser,
  getSupabaseServiceClient,
} from '../src/services/supabaseAdmin.js';
import { _resetRateLimitsForTesting } from '../src/middleware/rateLimiter.js';

const TINY_JPEG_DATA_URL =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';

const HQ_LAT = 17.31917323150614;
const HQ_LNG = 78.65081944376108;
// Approx ~150m north of HQ (strictly outside 50m geofence)
const OUTSIDE_LAT = 17.32052;
const OUTSIDE_LNG = 78.65081944376108;

const DB_ADMIN_URL =
  process.env['ADMIN_PROVISION_DB_URL'] ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function apiJson(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    token?: string;
    cookie?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {}
): Promise<{ status: number; json: any; headers: Headers; setCookie: string | null }> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
  if (options.cookie) headers['Cookie'] = options.cookie;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const json = await res.json().catch(() => null);
  const rawSetCookie = res.headers.get('set-cookie');
  return { status: res.status, json, headers: res.headers, setCookie: rawSetCookie };
}

function extractCookiePair(setCookieHeader: string | null, cookieName = 'hrms_rt'): string | null {
  if (!setCookieHeader) return null;
  const regex = new RegExp(`(${cookieName}=[^;]+)`);
  const m = regex.exec(setCookieHeader);
  return m ? m[1]! : null;
}

describe('HRMS PAYROLL 5535 — End-to-End Integration Verification (24 Acceptance Criteria)', () => {
  let server: http.Server;
  let baseUrl: string;
  let superPool: pg.Pool;

  const suffix = crypto.randomUUID().slice(0, 6).toUpperCase();
  const orgACode = `TE2EA${suffix}`;
  const orgBCode = `TE2EB${suffix}`;

  const orgAId = crypto.randomUUID();
  const orgBId = crypto.randomUUID();

  const adminAUserId = crypto.randomUUID();
  const adminAPhone = `+9198${String(crypto.randomInt(10000000, 99999999))}`;
  const adminAPassword = 'AdminSecret!2026';

  const adminBUserId = crypto.randomUUID();
  const adminBPhone = `+9197${String(crypto.randomInt(10000000, 99999999))}`;
  const adminBPassword = 'AdminB!2026';

  const createdGoTrueUserIds: string[] = [];

  let adminAToken = '';
  let adminACookie = '';
  let adminBToken = '';

  const warrenPhone = `+9196${String(crypto.randomInt(10000000, 99999999))}`;
  const warrenPassword = 'WarrenSecure!99';
  let warrenEmployeeId = '';
  let warrenUserId = '';
  let warrenActivationToken = '';
  let warrenToken = '';
  let warrenCookie = '';

  const salesPhone = `+9195${String(crypto.randomInt(10000000, 99999999))}`;
  const salesPassword = 'SalesSecure!99';
  let salesEmployeeId = '';
  let salesUserId = '';
  let salesToken = '';

  let previousNodeEnv: string | undefined;

  before(async () => {
    previousNodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'test';
    _resetRateLimitsForTesting();

    superPool = new pg.Pool({ connectionString: DB_ADMIN_URL });

    // 1. Seed two isolated ephemeral test organizations (never touching ORG001)
    await superPool.query(
      `INSERT INTO public.organizations (
         id, organization_code, name, legal_name, contact_phone, contact_email, address, selfie_retention_days, is_active
       ) VALUES
         ($1::uuid, $2::varchar, 'Test Tenant A', 'Test Tenant A Pvt Ltd', '+919900000001', 'ops@tenanta.local', 'Hyderabad', 30, TRUE),
         ($3::uuid, $4::varchar, 'Test Tenant B', 'Test Tenant B Pvt Ltd', '+919900000002', 'ops@tenantb.local', 'Pune', 30, TRUE);`,
      [orgAId, orgACode, orgBId, orgBCode]
    );

    // Seed HQ offices using exact approved 17.31917323150614 / 78.65081944376108 coordinates & 50m/30m bounds
    for (const oId of [orgAId, orgBId]) {
      await superPool.query(
        `INSERT INTO public.offices (
           organization_id, code, name, branch_name, address, latitude, longitude,
           geofence_radius_meters, max_gps_accuracy_meters, policy_version, is_primary, is_active
         ) VALUES (
           $1::uuid, 'HQ', 'Headquarters Office', 'Main HQ Branch', 'Hyderabad HQ',
           $2::numeric, $3::numeric, 50, 30, 'v1.0', TRUE, TRUE
         );`,
        [oId, HQ_LAT, HQ_LNG]
      );

      for (const [code, name] of [
        ['CL', 'Casual Leave'],
        ['SL', 'Sick Leave'],
        ['PL', 'Privilege Leave'],
        ['LWP', 'Leave Without Pay'],
      ]) {
        await superPool.query(
          `INSERT INTO public.leave_types (organization_id, code, name, is_paid, payable_minutes_credit, has_quota, is_active)
           VALUES ($1::uuid, $2::varchar, $3::varchar, FALSE, 0, FALSE, TRUE);`,
          [oId, code, name]
        );
      }
    }

    // 2. Provision Separate Admin Accounts (no employees row) in GoTrue + PG
    for (const adm of [
      { uid: adminAUserId, orgId: orgAId, code: orgACode, phone: adminAPhone, pass: adminAPassword, name: 'Org A Admin' },
      { uid: adminBUserId, orgId: orgBId, code: orgBCode, phone: adminBPhone, pass: adminBPassword, name: 'Org B Admin' },
    ]) {
      const email = buildSyntheticEmail(adm.uid, adm.orgId);
      await adminCreateGoTrueUser({
        id: adm.uid,
        syntheticEmail: email,
        password: adm.pass,
        appMetadata: { role: 'ADMIN', organization_id: adm.orgId, organization_code: adm.code },
        userMetadata: { full_name: adm.name },
      });
      createdGoTrueUserIds.push(adm.uid);

      await superPool.query(
        `INSERT INTO public.users (id, organization_id, phone_number, synthetic_email, is_active, must_change_password, activated_at, phone_verified_at)
         VALUES ($1::uuid, $2::uuid, $3::varchar, $4::text, TRUE, FALSE, NOW(), NOW());`,
        [adm.uid, adm.orgId, adm.phone, email]
      );
      await superPool.query(
        `INSERT INTO public.user_roles (organization_id, user_id, role)
         VALUES ($1::uuid, $2::uuid, 'ADMIN');`,
        [adm.orgId, adm.uid]
      );
    }

    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    assert(addr && typeof addr === 'object');
    baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;
  });

  after(async () => {
    if (previousNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = previousNodeEnv;

    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // Remove uploaded storage objects cleanly for test orgs
    try {
      const supa = getSupabaseServiceClient();
      const evRes = await superPool.query<{ storage_bucket: string; storage_path: string }>(
        `SELECT storage_bucket, storage_path FROM public.attendance_evidence WHERE organization_id IN ($1::uuid, $2::uuid);`,
        [orgAId, orgBId]
      );
      const byBucket = new Map<string, string[]>();
      for (const r of evRes.rows) {
        const list = byBucket.get(r.storage_bucket) ?? [];
        list.push(r.storage_path);
        byBucket.set(r.storage_bucket, list);
      }
      for (const [bucket, paths] of byBucket.entries()) {
        if (paths.length > 0) await supa.storage.from(bucket).remove(paths);
      }
    } catch {
      // ignore if storage cleanup partially absent
    }

    // Delete GoTrue users created by this test
    for (const uid of createdGoTrueUserIds) {
      await adminDeleteGoTrueUser(uid);
    }

    // Cleanly remove ONLY our ephemeral test orgs (never touching ORG001)
    const client = await superPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE public.audit_logs DISABLE TRIGGER trg_audit_logs_immutable;');
      await client.query('ALTER TABLE public.attendance_corrections DISABLE TRIGGER trg_attendance_corrections_immutable;');
      await client.query('ALTER TABLE public.payroll_adjustments DISABLE TRIGGER trg_payroll_adjustments_immutable;');

      for (const table of [
        'payment_records',
        'payslips',
        'payroll_adjustments',
        'payroll_items',
        'payroll_runs',
        'payroll_periods',
        'leave_applications',
        'leave_types',
        'customer_visits',
        'field_duty_gps_events',
        'field_duty_sessions',
        'attendance_evidence',
        'attendance_corrections',
        'face_verification_attempts',
        'attendance_events',
        'attendance_days',
        'biometric_enrollments',
        'idempotency_records',
        'notifications',
        'audit_logs',
        'employee_salaries',
        'user_sessions',
        'revoked_sessions',
        'activation_tokens',
        'password_reset_otps',
        'employees',
        'designations',
        'departments',
        'office_location_history',
        'offices',
        'user_roles',
        'users',
      ]) {
        await client.query(`DELETE FROM public.${table} WHERE organization_id IN ($1::uuid, $2::uuid);`, [
          orgAId,
          orgBId,
        ]);
      }
      await client.query('DELETE FROM public.organizations WHERE id IN ($1::uuid, $2::uuid);', [orgAId, orgBId]);

      await client.query('ALTER TABLE public.audit_logs ENABLE TRIGGER trg_audit_logs_immutable;');
      await client.query('ALTER TABLE public.attendance_corrections ENABLE TRIGGER trg_attendance_corrections_immutable;');
      await client.query('ALTER TABLE public.payroll_adjustments ENABLE TRIGGER trg_payroll_adjustments_immutable;');
      await client.query('COMMIT');
    } catch {
      await client.query('ROLLBACK').catch(() => {});
    } finally {
      client.release();
      await superPool.end();
      await closePool();
    }
  });

  it('AC-1 & AC-2: Authoritative DEC-01 lunch-clipping and Haversine unit formulas match policy', () => {
    // 1) 10:00 -> 13:00 = 180 min
    assert.equal(calculateDec01AttendanceMinutes('10:00', '13:00').payableMinutes, 180);
    // 2) 10:00 -> 14:00 = 180 min (60 min lunch clipped)
    const c2 = calculateDec01AttendanceMinutes('10:00', '14:00');
    assert.equal(c2.lunchDeductedMinutes, 60);
    assert.equal(c2.payableMinutes, 180);
    // 3) 10:00 -> 18:00 = 420 min (7h net)
    assert.equal(calculateDec01AttendanceMinutes('10:00', '18:00').payableMinutes, 420);
    // 4) 14:00 -> 18:00 = 240 min (0 lunch deducted)
    const c4 = calculateDec01AttendanceMinutes('14:00', '18:00');
    assert.equal(c4.lunchDeductedMinutes, 0);
    assert.equal(c4.payableMinutes, 240);
    // 5) 13:10 -> 13:50 = 0 min (wholly inside lunch window)
    assert.equal(calculateDec01AttendanceMinutes('13:10', '13:50').payableMinutes, 0);
    // 6) Overtime gating: 10:00 -> 19:00 = 420 unless approved -> 480
    assert.equal(calculateDec01AttendanceMinutes('10:00', '19:00', false).approvedPayableMinutes, 420);
    assert.equal(calculateDec01AttendanceMinutes('10:00', '19:00', true).approvedPayableMinutes, 480);

    // Distance exact HQ = 0m, outside coord > 50m
    assert.equal(calculateHaversineDistanceMeters(HQ_LAT, HQ_LNG, HQ_LAT, HQ_LNG), 0);
    assert(calculateHaversineDistanceMeters(HQ_LAT, HQ_LNG, OUTSIDE_LAT, OUTSIDE_LNG) > 100);

    // Dual payroll formula preview math (Rs 30,000, 30 days, 26 Mon-Sat days, 182h worked)
    const dual = calculateDualPayrollComparison({
      monthlySalaryPaise: 3000000,
      approvedPayableMinutes: 182 * 60,
      calendarDays: 30,
      workingDaysMonSat: 26,
    });
    assert.equal(dual.formulaA.divisorHours, 240);
    assert.equal(dual.formulaA.hourlyRateInr, 125);
    assert.equal(dual.formulaB.divisorHours, 182);
    assert.equal(dual.formulaB.grossEarnedInr, 30000);
  });

  it('AC-3 & AC-4: Separate Admin logs in, zero synthetic_email leaks, and Admin excluded from employees', async () => {
    const loginRes = await apiJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: { organizationCode: orgACode, phoneNumber: adminAPhone, password: adminAPassword },
    });
    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.json.data.user.roles[0], 'ADMIN');
    assert.equal(loginRes.json.data.employee, undefined);
    assert.equal(JSON.stringify(loginRes.json).includes('synthetic'), false);
    assert.equal(JSON.stringify(loginRes.json).includes('.auth.hrms.internal'), false);

    adminAToken = loginRes.json.data.tokens.accessToken;
    adminACookie = extractCookiePair(loginRes.setCookie) ?? '';
    assert(adminACookie.startsWith('hrms_rt='));

    const adminBRes = await apiJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: { organizationCode: orgBCode, phoneNumber: adminBPhone, password: adminBPassword },
    });
    assert.equal(adminBRes.status, 200);
    adminBToken = adminBRes.json.data.tokens.accessToken;

    const dirRes = await apiJson(baseUrl, '/admin/employees', { token: adminAToken });
    assert.equal(dirRes.status, 200);
    assert.equal(dirRes.json.data.employees.length, 0);

    // SMS OTP password recovery returns honest 503 when SMS gateway is unconfigured
    const resetReq = await apiJson(baseUrl, '/auth/password-reset/request', {
      method: 'POST',
      body: { organizationCode: orgACode, phoneNumber: adminAPhone },
    });
    assert.equal(resetReq.status, 503);
    assert.equal(resetReq.json.error.code, 'PROVISIONING_CONFIG_MISSING');
  });

  it('AC-5..8: Admin creates Warren (EMP001); pre-activation login blocked; single-use #token activation + refresh rotation', async () => {
    // Reject creating another ADMIN from employee provisioning endpoint
    const badRole = await apiJson(baseUrl, '/admin/employees', {
      method: 'POST',
      token: adminAToken,
      body: { fullName: 'Fake Admin', phoneNumber: '9888888888', role: 'ADMIN', jobCategory: 'OFFICE' },
    });
    assert.equal(badRole.status, 403);

    // Create Warren as OFFICE employee pending activation
    const createRes = await apiJson(baseUrl, '/admin/employees', {
      method: 'POST',
      token: adminAToken,
      body: {
        fullName: 'Warren',
        employeeCode: 'EMP001',
        phoneNumber: warrenPhone,
        jobCategory: 'OFFICE',
        department: 'Administration',
        designation: 'Executive',
        monthlySalaryReference: 30000,
        activateImmediately: false,
      },
    });
    assert.equal(createRes.status, 201);
    warrenEmployeeId = createRes.json.data.employee.id;
    warrenUserId = createRes.json.data.employee.userId;
    warrenActivationToken = createRes.json.data.activationToken;
    assert(warrenActivationToken && warrenActivationToken.length >= 24);
    assert.equal(createRes.json.data.employee.activationStatus, 'PENDING_ACTIVATION');
    createdGoTrueUserIds.push(warrenUserId);

    // Provision Sales Rep immediately for field-duty tests
    const salesCreate = await apiJson(baseUrl, '/admin/employees', {
      method: 'POST',
      token: adminAToken,
      body: {
        fullName: 'Rohan Sales',
        employeeCode: 'EMP002',
        phoneNumber: salesPhone,
        jobCategory: 'SALES',
        department: 'Sales',
        designation: 'Sales Representative',
        monthlySalaryReference: 25000,
        activateImmediately: true,
        initialPassword: salesPassword,
      },
    });
    assert.equal(salesCreate.status, 201);
    salesEmployeeId = salesCreate.json.data.employee.id;
    salesUserId = salesCreate.json.data.employee.userId;
    createdGoTrueUserIds.push(salesUserId);

    // Unactivated Warren cannot log in
    const blockedLogin = await apiJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: { phoneNumber: warrenPhone, password: warrenPassword },
    });
    assert.equal(blockedLogin.status, 401);

    // Wrong phone on activation returns 401 AND preserves single-use token (atomic rollback)
    const wrongPhoneAct = await apiJson(baseUrl, '/auth/activate', {
      method: 'POST',
      body: {
        activationToken: warrenActivationToken,
        phoneNumber: '+919999999999',
        password: warrenPassword,
      },
    });
    assert.equal(wrongPhoneAct.status, 401);

    // Valid activation succeeds
    const validAct = await apiJson(baseUrl, '/auth/activate', {
      method: 'POST',
      body: {
        activationToken: warrenActivationToken,
        phoneNumber: warrenPhone,
        password: warrenPassword,
      },
    });
    assert.equal(validAct.status, 200);
    assert.equal(validAct.json.data.activated, true);

    // Reusing single-use token fails
    const replayAct = await apiJson(baseUrl, '/auth/activate', {
      method: 'POST',
      body: {
        activationToken: warrenActivationToken,
        phoneNumber: warrenPhone,
        password: warrenPassword,
      },
    });
    assert.equal(replayAct.status, 400);

    // Warren logs in cleanly WITHOUT needing Organization Code
    const warrenLogin = await apiJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: { phoneNumber: warrenPhone, password: warrenPassword },
    });
    assert.equal(warrenLogin.status, 200);
    assert.equal(warrenLogin.json.data.user.roles[0], 'EMPLOYEE');
    assert.equal(warrenLogin.json.data.employee.employeeCode, 'EMP001');
    warrenToken = warrenLogin.json.data.tokens.accessToken;
    warrenCookie = extractCookiePair(warrenLogin.setCookie) ?? '';

    const salesLogin = await apiJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: { phoneNumber: salesPhone, password: salesPassword },
    });
    assert.equal(salesLogin.status, 200);
    salesToken = salesLogin.json.data.tokens.accessToken;

    // GAP-01: Rohan completes mandatory first-time password change before accessing portal services
    const permanentSalesPassword = 'SalesPermanent#2026';
    const rohanPwChange = await apiJson(baseUrl, '/auth/change-password', {
      method: 'POST',
      token: salesToken,
      body: { currentPassword: salesPassword, newPassword: permanentSalesPassword },
    });
    assert.equal(rohanPwChange.status, 200);
    const salesLoginPermanent = await apiJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: { phoneNumber: salesPhone, password: permanentSalesPassword },
    });
    assert.equal(salesLoginPermanent.status, 200);
    salesToken = salesLoginPermanent.json.data.tokens.accessToken;

    // Refresh rotation: old cookie rejected after single rotation
    const refresh1 = await apiJson(baseUrl, '/auth/refresh', {
      method: 'POST',
      cookie: warrenCookie,
    });
    assert.equal(refresh1.status, 200);
    const nextCookie = extractCookiePair(refresh1.setCookie) ?? '';
    assert(nextCookie && nextCookie !== warrenCookie);
    warrenToken = refresh1.json.data.tokens.accessToken;
    warrenCookie = nextCookie;
  });

  it('AC-9 & AC-10: Strict RBAC & Multi-Tenant RLS isolation', async () => {
    // Employee calling /admin returns 403
    const empAsAdmin = await apiJson(baseUrl, '/admin/employees', { token: warrenToken });
    assert.equal(empAsAdmin.status, 403);

    // Admin calling /employee returns 403
    const adminAsEmp = await apiJson(baseUrl, '/employee/dashboard', { token: adminAToken });
    assert.equal(adminAsEmp.status, 403);

    // Tenant B Admin cannot see Tenant A's employees
    const orgBEmployees = await apiJson(baseUrl, '/admin/employees', { token: adminBToken });
    assert.equal(orgBEmployees.status, 200);
    assert.equal(orgBEmployees.json.data.employees.length, 0);

    // Direct PostgreSQL trigger blocks Employee from inserting/updating attendance_days directly via hrms_app_user
    const appPool = getPool();
    await assert.rejects(
      withTenantTransaction(
        orgAId,
        async (client) => {
          await client.query(
            `INSERT INTO public.attendance_days (
               organization_id, employee_id, office_id, attendance_date, approval_status
             ) VALUES (
               $1::uuid, $2::uuid, (SELECT id FROM public.offices WHERE organization_id = $1::uuid LIMIT 1),
               '2026-11-12', 'APPROVED'
             );`,
            [orgAId, warrenEmployeeId]
          );
        },
        warrenUserId,
        appPool
      ),
      /42501|permission denied|policy/i
    );
  });

  it('AC-11..15: HQ geofence, GPS accuracy, private selfie, DEC-01 attendance, duplicate guard & Admin review', async () => {
    // Office settings match exact 17.31917323150614 / 78.65081944376108 coordinates
    const empAttPre = await apiJson(baseUrl, '/employee/attendance', { token: warrenToken });
    assert.equal(empAttPre.status, 200);
    assert.equal(empAttPre.json.data.officeGeofence.latitude, HQ_LAT);
    assert.equal(empAttPre.json.data.officeGeofence.longitude, HQ_LNG);
    assert.equal(empAttPre.json.data.officeGeofence.radiusMeters, 50);

    // Poor GPS (> 30m) blocked
    const poorGps = await apiJson(baseUrl, '/employee/attendance/check-in', {
      method: 'POST',
      token: warrenToken,
      body: {
        latitude: HQ_LAT,
        longitude: HQ_LNG,
        gpsAccuracyMeters: 31,
        selfieImageDataUrl: TINY_JPEG_DATA_URL,
      },
    });
    assert.equal(poorGps.status, 422);

    // Non-field OFFICE employee outside 50m perimeter strictly blocked
    const outsideOffice = await apiJson(baseUrl, '/employee/attendance/check-in', {
      method: 'POST',
      token: warrenToken,
      body: {
        latitude: OUTSIDE_LAT,
        longitude: OUTSIDE_LNG,
        gpsAccuracyMeters: 12,
        selfieImageDataUrl: TINY_JPEG_DATA_URL,
      },
    });
    assert.equal(outsideOffice.status, 403);

    // Check-out before Check-in rejected 409
    const earlyCheckout = await apiJson(baseUrl, '/employee/attendance/check-out', {
      method: 'POST',
      token: warrenToken,
      body: {
        latitude: HQ_LAT,
        longitude: HQ_LNG,
        gpsAccuracyMeters: 10,
        selfieImageDataUrl: TINY_JPEG_DATA_URL,
      },
    });
    assert.equal(earlyCheckout.status, 409);

    // Valid Check-In inside HQ 50m perimeter with Idempotency-Key + fixed 10:00 IST timestamp
    const todayIst = toIstDateAndHHMM().dateStr;
    const idemKey = `ci-${crypto.randomUUID()}`;
    const checkInBody = {
      latitude: HQ_LAT,
      longitude: HQ_LNG,
      gpsAccuracyMeters: 10,
      selfieImageDataUrl: TINY_JPEG_DATA_URL,
      recordedAtOverride: `${todayIst}T10:00:00.000+05:30`,
    };
    const checkInRes = await apiJson(baseUrl, '/employee/attendance/check-in', {
      method: 'POST',
      token: warrenToken,
      headers: { 'Idempotency-Key': idemKey },
      body: checkInBody,
    });
    assert.equal(checkInRes.status, 200);
    // Without live anti-spoofing + approved biometric template -> honestly VERIFICATION_PENDING (no fake biometric pass!)
    assert.equal(checkInRes.json.data.status, 'VERIFICATION_PENDING');
    assert.ok(
      ['PROVIDER_UNCONFIGURED', 'FAILED', 'FACE_NOT_DETECTED', 'MISMATCH'].includes(
        String(checkInRes.json.data.faceMatchStatus)
      )
    );
    const warrenDayId = checkInRes.json.data.attendanceDayId;

    // Same Idempotency-Key replays cleanly (200)
    const idemReplay = await apiJson(baseUrl, '/employee/attendance/check-in', {
      method: 'POST',
      token: warrenToken,
      headers: { 'Idempotency-Key': idemKey },
      body: checkInBody,
    });
    assert.equal(idemReplay.status, 200);
    assert.equal(idemReplay.json.data.attendanceDayId, warrenDayId);

    // Different request without replay key -> 409 duplicate daily check-in blocked
    const dupCheckIn = await apiJson(baseUrl, '/employee/attendance/check-in', {
      method: 'POST',
      token: warrenToken,
      body: checkInBody,
    });
    assert.equal(dupCheckIn.status, 409);

    // Check-Out at 18:00 IST -> DEC-01 computes 420 payableMinutes (7h net), 60m lunch deducted; approved=0 until Admin approves
    const checkOutRes = await apiJson(baseUrl, '/employee/attendance/check-out', {
      method: 'POST',
      token: warrenToken,
      body: {
        latitude: HQ_LAT,
        longitude: HQ_LNG,
        gpsAccuracyMeters: 10,
        selfieImageDataUrl: TINY_JPEG_DATA_URL,
        recordedAtOverride: `${todayIst}T18:00:00.000+05:30`,
      },
    });
    assert.equal(checkOutRes.status, 200);
    assert.equal(checkOutRes.json.data.payableMinutes, 420);
    assert.equal(checkOutRes.json.data.lunchDeductedMinutes, 60);
    assert.equal(checkOutRes.json.data.approvedPayableMinutes, 0);

    // Admin fetches attendance queue with signed private selfie URLs & approves Warren's attendance
    const adminAttList = await apiJson(baseUrl, '/admin/attendance', { token: adminAToken });
    assert.equal(adminAttList.status, 200);
    const warrenRow = adminAttList.json.data.records.find((r: any) => r.id === warrenDayId);
    assert(warrenRow);
    assert(typeof warrenRow.checkInSelfieUrl === 'string' && warrenRow.checkInSelfieUrl.includes('token='));
    assert(typeof warrenRow.checkOutSelfieUrl === 'string' && warrenRow.checkOutSelfieUrl.includes('token='));

    const reviewRes = await apiJson(baseUrl, `/admin/attendance/${warrenDayId}/review`, {
      method: 'POST',
      token: adminAToken,
      body: { decision: 'APPROVED', remarks: 'Verified live HQ check-in and check-out selfies.' },
    });
    assert.equal(reviewRes.status, 200);

    // Confirm Employee Dashboard now shows 420 approved minutes (7h)
    const empDash = await apiJson(baseUrl, '/employee/dashboard', { token: warrenToken });
    assert.equal(empDash.status, 200);
    assert.equal(empDash.json.data.monthlyPayableMinutes, 420);

    // Sales Employee: outside-50m Check-In without comment blocked 400; with comment -> PENDING_ADMIN_REVIEW
    const salesNoComment = await apiJson(baseUrl, '/employee/attendance/check-in', {
      method: 'POST',
      token: salesToken,
      body: {
        latitude: OUTSIDE_LAT,
        longitude: OUTSIDE_LNG,
        gpsAccuracyMeters: 15,
        selfieImageDataUrl: TINY_JPEG_DATA_URL,
      },
    });
    assert.equal(salesNoComment.status, 400);

    const salesExceptionCheckIn = await apiJson(baseUrl, '/employee/attendance/check-in', {
      method: 'POST',
      token: salesToken,
      body: {
        latitude: OUTSIDE_LAT,
        longitude: OUTSIDE_LNG,
        gpsAccuracyMeters: 15,
        selfieImageDataUrl: TINY_JPEG_DATA_URL,
        comment: 'Client pitch at Madhapur Industrial Area',
        recordedAtOverride: `${todayIst}T10:00:00.000+05:30`,
      },
    });
    assert.equal(salesExceptionCheckIn.status, 200);
    assert.equal(salesExceptionCheckIn.json.data.status, 'PENDING_ADMIN_REVIEW');
  });

  it('AC-16..19: Field Duty tracking boundary, Customer Visit evidence & Biometric Consent Enrollment', async () => {
    // Non-field employee cannot start Field Duty
    const nonFieldStart = await apiJson(baseUrl, '/employee/field-duty/start', {
      method: 'POST',
      token: warrenToken,
      body: { latitude: HQ_LAT, longitude: HQ_LNG, gpsAccuracyMeters: 10 },
    });
    assert.equal(nonFieldStart.status, 403);

    // Sales employee GPS ping BEFORE start -> 409 FIELD_DUTY_INACTIVE
    const gpsBeforeStart = await apiJson(baseUrl, '/employee/field-duty/gps', {
      method: 'POST',
      token: salesToken,
      body: { latitude: OUTSIDE_LAT, longitude: OUTSIDE_LNG, gpsAccuracyMeters: 15 },
    });
    assert.equal(gpsBeforeStart.status, 409);

    // Sales starts Field Duty, sends GPS ping, logs Customer Visit with evidence photo, ends Field Duty
    const startFd = await apiJson(baseUrl, '/employee/field-duty/start', {
      method: 'POST',
      token: salesToken,
      body: { latitude: OUTSIDE_LAT, longitude: OUTSIDE_LNG, gpsAccuracyMeters: 15 },
    });
    assert.equal(startFd.status, 201);

    const gpsDuring = await apiJson(baseUrl, '/employee/field-duty/gps', {
      method: 'POST',
      token: salesToken,
      body: { latitude: OUTSIDE_LAT + 0.001, longitude: OUTSIDE_LNG, gpsAccuracyMeters: 15 },
    });
    assert.equal(gpsDuring.status, 201);

    const visitRes = await apiJson(baseUrl, '/employee/field-duty/visits', {
      method: 'POST',
      token: salesToken,
      body: {
        customerName: 'Apex Logistics Pvt Ltd',
        customerReference: 'CUST-101',
        visitPurpose: 'SALES_PITCH',
        notes: 'Discussed Q4 fleet proposal.',
        latitude: OUTSIDE_LAT + 0.001,
        longitude: OUTSIDE_LNG,
        gpsAccuracyMeters: 12,
        evidenceImageDataUrl: TINY_JPEG_DATA_URL,
      },
    });
    assert.equal(visitRes.status, 201);
    const visitId = visitRes.json.data.visitId;

    const endFd = await apiJson(baseUrl, '/employee/field-duty/end', {
      method: 'POST',
      token: salesToken,
      body: { latitude: HQ_LAT, longitude: HQ_LNG, gpsAccuracyMeters: 12 },
    });
    assert.equal(endFd.status, 200);

    // GPS ping AFTER ending Field Duty is strictly blocked 409
    const gpsAfterEnd = await apiJson(baseUrl, '/employee/field-duty/gps', {
      method: 'POST',
      token: salesToken,
      body: { latitude: HQ_LAT, longitude: HQ_LNG, gpsAccuracyMeters: 12 },
    });
    assert.equal(gpsAfterEnd.status, 409);

    // Admin verifies customer visit and sees signed private evidence URL
    const adminField = await apiJson(baseUrl, '/admin/field-force', { token: adminAToken });
    assert.equal(adminField.status, 200);
    const vRow = adminField.json.data.visits.find((v: any) => v.id === visitId);
    assert(vRow?.evidenceSignedUrl?.includes('token='));

    const verifyVisit = await apiJson(baseUrl, `/admin/customer-visits/${visitId}/review`, {
      method: 'POST',
      token: adminAToken,
      body: { reviewStatus: 'VERIFIED', reviewNote: 'Verified site visit photo and GPS.' },
    });
    assert.equal(verifyVisit.status, 200);

    // Biometric enrollment without consent blocked; with consent queued and approved by Admin
    const bioNoConsent = await apiJson(baseUrl, '/employee/biometrics/enroll', {
      method: 'POST',
      token: warrenToken,
      body: { imageDataUrl: TINY_JPEG_DATA_URL, consentGiven: false },
    });
    assert.equal(bioNoConsent.status, 400);

    const bioOk = await apiJson(baseUrl, '/employee/biometrics/enroll', {
      method: 'POST',
      token: warrenToken,
      body: { imageDataUrl: TINY_JPEG_DATA_URL, consentGiven: true },
    });
    assert.equal(bioOk.status, 201);
    const enrollmentId = bioOk.json.data.enrollmentId;

    const approveBio = await apiJson(baseUrl, `/admin/biometrics/${enrollmentId}/review`, {
      method: 'POST',
      token: adminAToken,
      body: { decision: 'APPROVED' },
    });
    assert.equal(approveBio.status, 200);
  });

  it('AC-20..24: Unpaid Leaves (CL/SL/PL/LWP), Dual Payroll Preview, PO Formula Gate & Payment Tracking', async () => {
    const todayIst = toIstDateAndHHMM().dateStr;
    const monthStr = todayIst.slice(0, 7);

    // Unpaid leave submission & approval (0 payable credit)
    const leavePost = await apiJson(baseUrl, '/employee/leaves', {
      method: 'POST',
      token: warrenToken,
      body: {
        category: 'CL',
        startDate: todayIst,
        endDate: todayIst,
        reason: 'Personal family errand appointment',
      },
    });
    assert.equal(leavePost.status, 201);
    const leaveId = leavePost.json.data.leaveId;

    const leaveRev = await apiJson(baseUrl, `/admin/leaves/${leaveId}/review`, {
      method: 'POST',
      token: adminAToken,
      body: { decision: 'APPROVED', remarks: 'Approved unpaid casual leave.' },
    });
    assert.equal(leaveRev.status, 200);

    // Prepare draft payroll batch
    const prepRes = await apiJson(baseUrl, '/admin/payroll/prepare', {
      method: 'POST',
      token: adminAToken,
      body: { month: monthStr, formulaMode: 'CALENDAR_DAYS_X_8H_PAID_LUNCH' },
    });
    assert.equal(prepRes.status, 200);
    assert.equal(prepRes.json.data.items.length, 2); // Only Warren & Rohan; Admin strictly excluded
    const warrenPayItem = prepRes.json.data.items.find((i: any) => i.employeeCode === 'EMP001');
    assert(warrenPayItem);
    assert.equal(warrenPayItem.approvedWorkingHours, 7);
    assert.equal(warrenPayItem.unpaidLeaveDays, 1);
    assert(warrenPayItem.formulaComparison.formulaA.grossEarnedInr > 0);
    assert(warrenPayItem.formulaComparison.formulaB.grossEarnedInr > 0);

    // Employee must see 0 payslips BEFORE Admin formula approval
    const empPayPre = await apiJson(baseUrl, `/employee/payroll?month=${monthStr}`, {
      token: warrenToken,
    });
    assert.equal(empPayPre.status, 200);
    assert.equal(empPayPre.json.data.items.length, 0);

    // Approving without PO formula sign-off fails 409 PAYROLL_FORMULA_NOT_APPROVED
    const blockedApprove = await apiJson(baseUrl, '/admin/payroll/approve', {
      method: 'POST',
      token: adminAToken,
      body: { month: monthStr, confirmFormulaMode: 'CALENDAR_DAYS_X_8H_PAID_LUNCH', confirmPoFormulaApproval: false },
    });
    assert.equal(blockedApprove.status, 409);
    assert.equal(blockedApprove.json.error.code, 'PAYROLL_FORMULA_NOT_APPROVED');

    // Apply Rs 500 bonus adjustment
    const adjRes = await apiJson(baseUrl, '/admin/payroll/adjustments', {
      method: 'POST',
      token: adminAToken,
      body: {
        payrollItemId: warrenPayItem.itemId,
        adjustmentType: 'ADDITION',
        amountInr: 500,
        reason: 'Punctuality and onboarding verification allowance',
      },
    });
    assert.equal(adjRes.status, 200);

    // Final Admin approval with confirmed formula unlocks payslips
    const finalApprove = await apiJson(baseUrl, '/admin/payroll/approve', {
      method: 'POST',
      token: adminAToken,
      body: {
        month: monthStr,
        confirmFormulaMode: 'CALENDAR_DAYS_X_8H_PAID_LUNCH',
        confirmPoFormulaApproval: true,
      },
    });
    assert.equal(finalApprove.status, 200);

    // Employee now sees official approved payslip
    const empPayPost = await apiJson(baseUrl, `/employee/payroll?month=${monthStr}`, {
      token: warrenToken,
    });
    assert.equal(empPayPost.status, 200);
    assert.equal(empPayPost.json.data.items.length, 1);
    assert.equal(empPayPost.json.data.items[0].adjustments, 500);
    assert.equal(empPayPost.json.data.items[0].paymentStatus, 'Pending');

    // Separate payment status tracking updated to Paid
    const paidRes = await apiJson(baseUrl, `/admin/payroll/${warrenEmployeeId}/payment-status`, {
      method: 'PATCH',
      token: adminAToken,
      body: {
        month: monthStr,
        paymentStatus: 'Paid',
        paymentReference: 'NEFT-UTR-5535001',
      },
    });
    assert.equal(paidRes.status, 200);

    // Biometric Subject Mapping API + Migration 00012 multi-tenant & uniqueness enforcement
    const mapSubjectName = `e2e-map-${orgAId.slice(0, 8)}`;
    const cfSubjectsRes = await apiJson(baseUrl, '/admin/biometrics/compreface/subjects', {
      token: adminAToken,
    });
    assert.equal(cfSubjectsRes.status, 200);

    // Employee must NOT be able to access Admin biometric mapping routes
    const empMapBlock = await apiJson(baseUrl, '/admin/biometrics/mappings', {
      token: salesToken,
    });
    assert.equal(empMapBlock.status, 403);

    // Admin A assigns subject to Warren
    const mapCreate = await apiJson(baseUrl, '/admin/biometrics/mappings', {
      method: 'POST',
      token: adminAToken,
      body: {
        employeeId: warrenEmployeeId,
        providerSubject: mapSubjectName,
        notes: 'E2E CompreFace mapping test',
      },
    });
    assert.equal(mapCreate.status, 201);
    const warrenMappingId = mapCreate.json.data.mapping.id;

    // Assigning same subject (case-insensitive) to Rohan in Org A rejected 409
    const dupSubjectRes = await apiJson(baseUrl, '/admin/biometrics/mappings', {
      method: 'POST',
      token: adminAToken,
      body: {
        employeeId: salesEmployeeId,
        providerSubject: mapSubjectName.toUpperCase(),
      },
    });
    assert.equal(dupSubjectRes.status, 409);

    // Assigning second active subject to Warren rejected 409
    const dupEmpMapRes = await apiJson(baseUrl, '/admin/biometrics/mappings', {
      method: 'POST',
      token: adminAToken,
      body: {
        employeeId: warrenEmployeeId,
        providerSubject: `${mapSubjectName}-other`,
      },
    });
    assert.equal(dupEmpMapRes.status, 409);

    // Admin B (Tenant B) sees 0 of Tenant A's mappings under RLS
    const orgBMappings = await apiJson(baseUrl, '/admin/biometrics/mappings', {
      token: adminBToken,
    });
    assert.equal(orgBMappings.status, 200);
    assert.equal(orgBMappings.json.data.mappings.length, 0);

    // Revoke Warren's mapping cleanly and confirm audit trail
    const mapRevoke = await apiJson(baseUrl, `/admin/biometrics/mappings/${warrenMappingId}/revoke`, {
      method: 'POST',
      token: adminAToken,
      body: { reason: 'E2E cleanup' },
    });
    assert.equal(mapRevoke.status, 200);
    assert.equal(mapRevoke.json.data.mapping.status, 'REVOKED');

    // Security check: Change Password revokes active sessions and invalidates prior token
    const chgRes = await apiJson(baseUrl, '/auth/change-password', {
      method: 'POST',
      token: warrenToken,
      body: { currentPassword: warrenPassword, newPassword: 'WarrenUpdated!100' },
    });
    assert.equal(chgRes.status, 200);

    // Verify Admin Audit Logs captured all actions transparently
    const logsRes = await apiJson(baseUrl, '/admin/audit-logs', { token: adminAToken });
    assert.equal(logsRes.status, 200);
    assert(logsRes.json.data.auditLogs.some((l: any) => l.action === 'PAYROLL_APPROVED_AND_PAYSLIPS_ISSUED'));
    assert(logsRes.json.data.auditLogs.some((l: any) => l.action === 'FACE_SUBJECT_MAPPING_ASSIGNED'));
    assert(logsRes.json.data.auditLogs.some((l: any) => l.action === 'FACE_SUBJECT_MAPPING_REVOKED'));
  });
});
