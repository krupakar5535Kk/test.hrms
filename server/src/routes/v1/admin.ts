import crypto from 'node:crypto';
import { Router, Request, Response, NextFunction } from 'express';
import {
  ApiErrorCode,
  type FormulaMode,
} from '@hrms/shared';
import { requireActiveUser } from '../../middleware/authMiddleware.js';
import { AppError } from '../../middleware/errorHandler.js';
import { env } from '../../config/env.js';
import { withTenantTransaction } from '../../db/transaction.js';
import {
  buildSyntheticEmail,
  calculateDec01AttendanceMinutes,
  calculateDualPayrollComparison,
  combineIstDateAndHHMMToDate,
  FIELD_ELIGIBLE_CATEGORIES,
  generateOpaqueToken,
  getMonthDateRange,
  isValidJobCategory,
  normalizeIndianMobile,
  sha256Hex,
  splitFullName,
  toIstDateAndHHMM,
} from '../../services/hrmsDomain.js';
import {
  adminCreateGoTrueUser,
  adminDeleteGoTrueUser,
  adminUpdateGoTrueUser,
  assertProvisioningConfigured,
  createPrivateSignedUrl,
} from '../../services/supabaseAdmin.js';
import {
  fetchMappedAttendanceRecords,
  fetchMappedCustomerVisits,
  fetchMappedEmployees,
  fetchMappedFieldSessions,
  fetchMappedLeaves,
  fetchMappedPayrollForMonth,
  getPrimaryOffice,
} from '../../services/recordMappers.js';

export const adminRouter = Router();

// Strict Admin-only boundary on every endpoint in this router
adminRouter.use(requireActiveUser('ADMIN'));

async function resolveOrCreateDepartment(
  client: import('pg').PoolClient,
  organizationId: string,
  departmentInput: string | undefined,
  jobCategory: string
): Promise<string> {
  const cleanName = departmentInput?.trim();
  const codeCandidate = cleanName
    ? cleanName.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30)
    : jobCategory;

  const byCode = await client.query<{ id: string }>(
    `SELECT id FROM public.departments
     WHERE organization_id = $1::uuid
       AND (UPPER(code) = $2 OR LOWER(name) = LOWER($3))
     LIMIT 1;`,
    [organizationId, codeCandidate, cleanName || jobCategory]
  );
  if (byCode.rows[0]) {
    return byCode.rows[0].id;
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO public.departments (organization_id, code, name, description, allow_field_attendance, is_active)
     VALUES ($1::uuid, $2::varchar, $3::varchar, $4::text, $5::boolean, TRUE)
     ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id;`,
    [
      organizationId,
      codeCandidate || jobCategory,
      cleanName || jobCategory,
      `${cleanName || jobCategory} department`,
      FIELD_ELIGIBLE_CATEGORIES.has(jobCategory),
    ]
  );
  return inserted.rows[0]!.id;
}

async function resolveOrCreateDesignation(
  client: import('pg').PoolClient,
  organizationId: string,
  departmentId: string,
  designationInput: string | undefined,
  jobCategory: string
): Promise<string> {
  const cleanTitle = designationInput?.trim();
  if (cleanTitle) {
    const codeCandidate = cleanTitle.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30);
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM public.designations
       WHERE organization_id = $1::uuid
         AND (UPPER(code) = $2 OR LOWER(title) = LOWER($3))
       LIMIT 1;`,
      [organizationId, codeCandidate, cleanTitle]
    );
    if (existing.rows[0]) return existing.rows[0].id;

    const created = await client.query<{ id: string }>(
      `INSERT INTO public.designations (
        organization_id, department_id, code, title, job_category, is_field_eligible, is_active
      ) VALUES ($1::uuid, $2::uuid, $3::varchar, $4::varchar, $5::varchar, $6::boolean, TRUE)
      ON CONFLICT (organization_id, code) DO UPDATE SET title = EXCLUDED.title
      RETURNING id;`,
      [
        organizationId,
        departmentId,
        codeCandidate || `${jobCategory}_ROLE`,
        cleanTitle,
        jobCategory,
        FIELD_ELIGIBLE_CATEGORIES.has(jobCategory),
      ]
    );
    return created.rows[0]!.id;
  }

  const byCat = await client.query<{ id: string }>(
    `SELECT id FROM public.designations
     WHERE organization_id = $1::uuid AND job_category = $2::varchar AND is_active = TRUE
     ORDER BY created_at ASC LIMIT 1;`,
    [organizationId, jobCategory]
  );
  if (byCat.rows[0]) return byCat.rows[0].id;

  return resolveOrCreateDesignation(client, organizationId, departmentId, `${jobCategory} Staff`, jobCategory);
}

/**
 * GET /api/v1/admin/dashboard
 */
adminRouter.get('/dashboard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const currentMonth = toIstDateAndHHMM().dateStr.slice(0, 7);

    const payload = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const [employees, attendanceRecords, leaveApplications, fieldSessions, visits, payroll, office] =
          await Promise.all([
            fetchMappedEmployees(client, session.organizationId),
            fetchMappedAttendanceRecords(client, session.organizationId, { limit: 100 }),
            fetchMappedLeaves(client, session.organizationId),
            fetchMappedFieldSessions(client, session.organizationId),
            fetchMappedCustomerVisits(client, session.organizationId),
            fetchMappedPayrollForMonth(client, session.organizationId, currentMonth),
            getPrimaryOffice(client, session.organizationId),
          ]);

        const payrollDraftCount =
          payroll.run && (payroll.run.status === 'DRAFT' || payroll.run.status === 'PENDING_FORMULA_APPROVAL')
            ? payroll.items.length
            : 0;

        const approvedRunsRes = await client.query<{ cnt: string }>(
          `SELECT COUNT(*)::TEXT AS cnt
           FROM public.payroll_runs
           WHERE organization_id = $1::uuid AND status IN ('APPROVED', 'PROCESSED');`,
          [session.organizationId]
        );

        const todayStr = toIstDateAndHHMM().dateStr;
        const salesVisitsToday = visits.filter(
          (v) => v.visitCategory === 'SALES' && (v.completedAt ?? '').slice(0, 10) === todayStr
        ).length;
        const recoveryVisitsToday = visits.filter(
          (v) => v.visitCategory === 'RECOVERY' && (v.completedAt ?? '').slice(0, 10) === todayStr
        ).length;

        return {
          employees,
          attendanceRecords,
          leaveApplications,
          fieldSessions,
          officeGeofence: office,
          payrollDraftCount,
          payrollProcessedMonths: Number(approvedRunsRes.rows[0]?.cnt ?? 0),
          salesVisitsToday,
          recoveryVisitsToday,
        };
      },
      session.authUserId
    );

    res.status(200).json({
      success: true,
      data: payload,
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/admin/employees
 */
adminRouter.get('/employees', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const employees = await withTenantTransaction(
      session.organizationId,
      async (client) => fetchMappedEmployees(client, session.organizationId),
      session.authUserId
    );

    res.status(200).json({
      success: true,
      data: { employees },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/admin/employees/:id/history
 */
adminRouter.get('/employees/:id/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const employeeId = String(req.params['id'] ?? '');
    const data = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const list = await fetchMappedEmployees(client, session.organizationId, { employeeId });
        const employee = list[0];
        if (!employee) {
          throw new AppError(404, ApiErrorCode.NOT_FOUND, 'Employee record not found.');
        }
        const [attendance, leaves, fieldSessions, visits, payslipsRes] = await Promise.all([
          fetchMappedAttendanceRecords(client, session.organizationId, {
            employeeId,
            includeSignedMedia: true,
            limit: 60,
          }),
          fetchMappedLeaves(client, session.organizationId, { employeeId }),
          fetchMappedFieldSessions(client, session.organizationId, { employeeId }),
          fetchMappedCustomerVisits(client, session.organizationId, {
            employeeId,
            includeSignedEvidence: true,
          }),
          client.query<{
            id: string;
            year: number;
            month: number;
            payslip_number: string;
            approved_payable_minutes: number;
            net_paise: string;
            issued_at: string;
          }>(
            `SELECT id, year, month, payslip_number, approved_payable_minutes, net_paise::TEXT, issued_at::TEXT
             FROM public.payslips
             WHERE organization_id = $1::uuid AND employee_id = $2::uuid
             ORDER BY year DESC, month DESC;`,
            [session.organizationId, employeeId]
          ),
        ]);
        return {
          employee,
          attendance,
          leaves,
          fieldSessions,
          visits,
          payslips: payslipsRes.rows.map((p) => ({
            id: p.id,
            month: `${p.year}-${String(p.month).padStart(2, '0')}`,
            payslipNumber: p.payslip_number,
            approvedWorkingHours: Math.round((p.approved_payable_minutes / 60) * 100) / 100,
            netSalaryInr: Math.round((Number(p.net_paise) / 100) * 100) / 100,
            issuedAt: p.issued_at,
          })),
        };
      },
      session.authUserId
    );

    res.status(200).json({
      success: true,
      data,
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Shared employee provisioning handler for POST /employees & POST /provisioning-requests
 */
async function handleCreateEmployee(req: Request, res: Response, next: NextFunction) {
  let createdGoTrueUserId: string | null = null;
  try {
    assertProvisioningConfigured();
    const session = req.hrmsUser!;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const fullName = String(body['fullName'] ?? '').trim();
    const phoneRaw = String(body['phoneNumber'] ?? '').trim();
    const requestedCategory = String(body['jobCategory'] ?? 'OFFICE').trim().toUpperCase();
    const requestedRole = String(body['role'] ?? 'EMPLOYEE').trim().toUpperCase();
    const departmentName = body['department'] ? String(body['department']).trim() : undefined;
    const designationTitle = body['designation'] ? String(body['designation']).trim() : undefined;
    const requestedCode = body['employeeCode'] ? String(body['employeeCode']).trim().toUpperCase() : undefined;
    const joiningDateRaw = body['joiningDate'] ? String(body['joiningDate']).trim() : undefined;
    const monthlySalaryReference = Number(body['monthlySalaryReference'] ?? 0);
    const activateImmediately = body['activateImmediately'] !== false;
    const initialPasswordRaw = body['initialPassword'] ? String(body['initialPassword']).trim() : '';
    const emergencyContactName = body['emergencyContactName']
      ? String(body['emergencyContactName']).trim()
      : null;
    const emergencyContactPhone = body['emergencyContactPhone']
      ? String(body['emergencyContactPhone']).trim()
      : null;

    if (requestedRole !== 'EMPLOYEE') {
      throw new AppError(
        403,
        ApiErrorCode.FORBIDDEN,
        'Admin provisioning only creates EMPLOYEE accounts. Separate Admin accounts cannot be provisioned from the employee directory.'
      );
    }

    if (fullName.length < 2) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'Employee full legal name is required.');
    }

    const mobile = normalizeIndianMobile(phoneRaw);
    if (!mobile) {
      throw new AppError(
        400,
        ApiErrorCode.VALIDATION_ERROR,
        'Valid +91 Indian mobile number (10 digits starting with 6-9) is required.'
      );
    }

    if (!isValidJobCategory(requestedCategory)) {
      throw new AppError(
        400,
        ApiErrorCode.VALIDATION_ERROR,
        'Job category must be one of OFFICE, SALES, RECOVERY, HR, or FINANCE.'
      );
    }

    if (activateImmediately && initialPasswordRaw && initialPasswordRaw.length < 8) {
      throw new AppError(
        400,
        ApiErrorCode.VALIDATION_ERROR,
        'Initial password must be at least 8 characters.'
      );
    }

    const { firstName, lastName } = splitFullName(fullName);
    const newUserId = crypto.randomUUID();
    const syntheticEmail = buildSyntheticEmail(newUserId, session.organizationId);
    const goTrueInitialPassword =
      initialPasswordRaw ||
      (activateImmediately
        ? `Kmaccs#${crypto.randomBytes(4).toString('hex').toUpperCase()}`
        : crypto.randomBytes(24).toString('base64url'));

    // Step 1: Create real identity in Supabase GoTrue Admin API
    const goTrueCreated = await adminCreateGoTrueUser({
      id: newUserId,
      syntheticEmail,
      password: goTrueInitialPassword,
      appMetadata: {
        role: 'EMPLOYEE',
        organization_id: session.organizationId,
        jobCategory: requestedCategory,
      },
      userMetadata: {
        full_name: fullName,
        phone_number: mobile.canonicalE164,
      },
    });
    createdGoTrueUserId = goTrueCreated.id;
    const actualUserId = goTrueCreated.id;

    // Step 2: Persist in PostgreSQL cleanly within tenant RLS transaction

    const createdResult = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const office = await getPrimaryOffice(client, session.organizationId);
        if (!office) {
          throw new AppError(
            400,
            ApiErrorCode.BAD_REQUEST,
            'Primary office headquarters must exist before adding employees.'
          );
        }

        const dupPhone = await client.query<{ id: string }>(
          `SELECT id FROM public.users
           WHERE organization_id = $1::uuid AND phone_number = $2::varchar LIMIT 1;`,
          [session.organizationId, mobile.canonicalE164]
        );
        if (dupPhone.rows[0]) {
          throw new AppError(
            409,
            ApiErrorCode.CONFLICT,
            `An account with mobile number ${mobile.canonicalE164} already exists in this organization.`
          );
        }

        const departmentId = await resolveOrCreateDepartment(
          client,
          session.organizationId,
          departmentName,
          requestedCategory
        );
        const designationId = await resolveOrCreateDesignation(
          client,
          session.organizationId,
          departmentId,
          designationTitle,
          requestedCategory
        );

        let employeeCode = requestedCode;
        if (!employeeCode) {
          const codeRes = await client.query<{ code: string }>(
            'SELECT public.generate_next_employee_code($1::uuid) AS code;',
            [session.organizationId]
          );
          employeeCode = codeRes.rows[0]!.code;
        }

        await client.query(
          `SELECT hrms_internal.admin_provision_employee_user(
            $1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, $6::boolean, $7::boolean, $8::text
          );`,
          [
            session.organizationId,
            actualUserId,
            mobile.canonicalE164,
            syntheticEmail,
            session.authUserId,
            activateImmediately,
            activateImmediately,
            fullName,
          ]
        );

        let rawToken: string | undefined;
        if (!activateImmediately) {
          rawToken = generateOpaqueToken(32);
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
          await client.query(
            `SELECT hrms_internal.admin_issue_activation_token(
              $1::uuid, $2::uuid, 'ACTIVATION', $3::char(64), $4::uuid, $5::timestamptz
            );`,
            [
              session.organizationId,
              actualUserId,
              sha256Hex(rawToken),
              session.authUserId,
              expiresAt.toISOString(),
            ]
          );
        }

        const isFieldEligible = FIELD_ELIGIBLE_CATEGORIES.has(requestedCategory);
        const empInsert = await client.query<{ id: string }>(
          `INSERT INTO public.employees (
            organization_id, user_id, employee_code, first_name, last_name,
            phone_number, job_category, department_id, designation_id, office_id,
            joining_date, employment_status, is_field_eligible,
            emergency_contact_name, emergency_contact_phone, created_by
          ) VALUES (
            $1::uuid, $2::uuid, $3::varchar, $4::varchar, $5::varchar,
            $6::varchar, $7::varchar, $8::uuid, $9::uuid, $10::uuid,
            COALESCE($11::date, CURRENT_DATE), 'ACTIVE', $12::boolean,
            $13::varchar, $14::varchar, $15::uuid
          )
          RETURNING id;`,
          [
            session.organizationId,
            actualUserId,
            employeeCode,
            firstName,
            lastName,
            mobile.canonicalE164,
            requestedCategory,
            departmentId,
            designationId,
            office.id,
            joiningDateRaw || null,
            isFieldEligible,
            emergencyContactName,
            emergencyContactPhone,
            session.authUserId,
          ]
        );
        const employeeId = empInsert.rows[0]!.id;

        await client.query(
          `UPDATE public.users SET full_name = $1 WHERE id = $2::uuid;`,
          [fullName, actualUserId]
        );

        if (Number.isFinite(monthlySalaryReference) && monthlySalaryReference > 0) {
          await client.query(
            `INSERT INTO public.employee_salaries (
              organization_id, employee_id, monthly_salary_paise, effective_from, status, created_by
            ) VALUES ($1::uuid, $2::uuid, $3::bigint, CURRENT_DATE, 'ACTIVE', $4::uuid);`,
            [
              session.organizationId,
              employeeId,
              Math.round(monthlySalaryReference * 100),
              session.authUserId,
            ]
          );
        }

        await client.query(
          `INSERT INTO public.audit_logs (
            organization_id, actor_user_id, actor_role, action, entity_type, entity_id, summary, metadata
          ) VALUES ($1::uuid, $2::uuid, 'ADMIN', 'EMPLOYEE_PROVISIONED', 'EMPLOYEE', $3::uuid, $4::text, $5::jsonb);`,
          [
            session.organizationId,
            session.authUserId,
            employeeId,
            `Provisioned employee ${fullName} (${employeeCode}, ${requestedCategory}).`,
            JSON.stringify({ activateImmediately: true, isFieldEligible }),
          ]
        );

        const mappedList = await fetchMappedEmployees(client, session.organizationId, { employeeId });
        return {
          employee: mappedList[0]!,
          employeeCode,
          activationToken: rawToken,
          activationUrl: rawToken
            ? `${env.APP_PUBLIC_URL}/auth/activate#token=${encodeURIComponent(rawToken)}`
            : undefined,
        };
      },
      session.authUserId
    );

    createdGoTrueUserId = null; // DB commit succeeded cleanly
    res.status(201).json({
      success: true,
      data: {
        ...createdResult,
        message: `${createdResult.employee.fullName} (${createdResult.employeeCode}) provisioned and active. Ready for immediate login with registered mobile number and password.`,
      },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err) {
    if (createdGoTrueUserId) {
      await adminDeleteGoTrueUser(createdGoTrueUserId);
    }
    next(err);
  }
}

adminRouter.post('/employees', handleCreateEmployee);
adminRouter.post('/provisioning-requests', handleCreateEmployee);

/**
 * PATCH /api/v1/admin/employees/:id
 */
adminRouter.patch('/employees/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const employeeId = String(req.params['id'] ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;

    const updated = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const curRes = await client.query<{
          id: string;
          user_id: string;
          job_category: string;
          department_id: string | null;
          designation_id: string | null;
        }>(
          `SELECT id, user_id, job_category, department_id, designation_id
           FROM public.employees WHERE organization_id = $1::uuid AND id = $2::uuid LIMIT 1;`,
          [session.organizationId, employeeId]
        );
        const cur = curRes.rows[0];
        if (!cur) {
          throw new AppError(404, ApiErrorCode.NOT_FOUND, 'Employee not found.');
        }

        const nextCategory = body['jobCategory']
          ? String(body['jobCategory']).trim().toUpperCase()
          : cur.job_category;
        if (!isValidJobCategory(nextCategory)) {
          throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'Invalid jobCategory value.');
        }

        const nextFullName = body['fullName'] ? String(body['fullName']).trim() : undefined;
        const split = nextFullName ? splitFullName(nextFullName) : null;

        let nextDeptId = cur.department_id;
        if (body['department']) {
          nextDeptId = await resolveOrCreateDepartment(
            client,
            session.organizationId,
            String(body['department']),
            nextCategory
          );
        }
        let nextDesigId = cur.designation_id;
        if (body['designation'] && nextDeptId) {
          nextDesigId = await resolveOrCreateDesignation(
            client,
            session.organizationId,
            nextDeptId,
            String(body['designation']),
            nextCategory
          );
        }

        let nextPhone: string | undefined;
        if (body['phoneNumber']) {
          const mob = normalizeIndianMobile(String(body['phoneNumber']));
          if (!mob) throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'Invalid Indian mobile.');
          nextPhone = mob.canonicalE164;
        }

        const nextStatus = body['employmentStatus']
          ? String(body['employmentStatus']).trim().toUpperCase()
          : undefined;
        const isFieldEligible = FIELD_ELIGIBLE_CATEGORIES.has(nextCategory);

        await client.query(
          `UPDATE public.employees
           SET first_name = COALESCE($3::varchar, first_name),
               last_name = COALESCE($4::varchar, last_name),
               phone_number = COALESCE($5::varchar, phone_number),
               job_category = $6::varchar,
               is_field_eligible = $7::boolean,
               department_id = COALESCE($8::uuid, department_id),
               designation_id = COALESCE($9::uuid, designation_id),
               employment_status = COALESCE($10::varchar, employment_status),
               emergency_contact_name = COALESCE($11::varchar, emergency_contact_name),
               emergency_contact_phone = COALESCE($12::varchar, emergency_contact_phone)
           WHERE organization_id = $1::uuid AND id = $2::uuid;`,
          [
            session.organizationId,
            employeeId,
            split?.firstName ?? null,
            split?.lastName ?? null,
            nextPhone ?? null,
            nextCategory,
            isFieldEligible,
            nextDeptId,
            nextDesigId,
            nextStatus ?? null,
            body['emergencyContactName'] ? String(body['emergencyContactName']).trim() : null,
            body['emergencyContactPhone'] ? String(body['emergencyContactPhone']).trim() : null,
          ]
        );

        if (body['monthlySalaryReference'] !== undefined) {
          const newSalary = Number(body['monthlySalaryReference']);
          if (Number.isFinite(newSalary) && newSalary > 0) {
            await client.query(
              `UPDATE public.employee_salaries
               SET status = 'SUPERSEDED', effective_to = LEAST(CURRENT_DATE, effective_from)
               WHERE organization_id = $1::uuid AND employee_id = $2::uuid AND status = 'ACTIVE';`,
              [session.organizationId, employeeId]
            );
            await client.query(
              `INSERT INTO public.employee_salaries (
                organization_id, employee_id, monthly_salary_paise, effective_from, status, created_by
              ) VALUES ($1::uuid, $2::uuid, $3::bigint, CURRENT_DATE + 1, 'ACTIVE', $4::uuid);`,
              [
                session.organizationId,
                employeeId,
                Math.round(newSalary * 100),
                session.authUserId,
              ]
            ).catch(async () => {
              // If already revised earlier today, update existing active/today record
              await client.query(
                `INSERT INTO public.employee_salaries (
                  organization_id, employee_id, monthly_salary_paise, effective_from, status, created_by
                ) VALUES ($1::uuid, $2::uuid, $3::bigint, (SELECT COALESCE(MAX(effective_to) + 1, CURRENT_DATE) FROM public.employee_salaries WHERE employee_id = $2::uuid), 'ACTIVE', $4::uuid);`,
                [session.organizationId, employeeId, Math.round(newSalary * 100), session.authUserId]
              );
            });
          }
        }

        await adminUpdateGoTrueUser(cur.user_id, {
          appMetadata: {
            role: 'EMPLOYEE',
            organization_id: session.organizationId,
            jobCategory: nextCategory,
          },
          ...(nextFullName ? { userMetadata: { full_name: nextFullName } } : {}),
        }).catch(() => {});

        await client.query(
          `INSERT INTO public.audit_logs (
            organization_id, actor_user_id, actor_role, action, entity_type, entity_id, summary
          ) VALUES ($1::uuid, $2::uuid, 'ADMIN', 'EMPLOYEE_UPDATED', 'EMPLOYEE', $3::uuid, $4::text);`,
          [session.organizationId, session.authUserId, employeeId, `Updated employee profile (${nextCategory}).`]
        );

        const list = await fetchMappedEmployees(client, session.organizationId, { employeeId });
        return list[0]!;
      },
      session.authUserId
    );

    res.status(200).json({
      success: true,
      data: { employee: updated },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/admin/employees/:id/activate
 */
adminRouter.post('/employees/:id/activate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const employeeId = String(req.params['id'] ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const issueResetLink = body['issueActivationLink'] !== false;
    const rawToken = generateOpaqueToken(32);

    const result = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const empRes = await client.query<{ user_id: string; full_name: string }>(
          'SELECT user_id, full_name FROM public.employees WHERE organization_id = $1::uuid AND id = $2::uuid LIMIT 1;',
          [session.organizationId, employeeId]
        );
        const emp = empRes.rows[0];
        if (!emp) throw new AppError(404, ApiErrorCode.NOT_FOUND, 'Employee not found.');

        await client.query(
          `SELECT hrms_internal.admin_set_user_activation(
            $1::uuid, $2::uuid, TRUE, TRUE, FALSE, $3::uuid
          );`,
          [session.organizationId, emp.user_id, session.authUserId]
        );

        let activationUrl: string | null = null;
        if (issueResetLink) {
          const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
          await client.query(
            `SELECT hrms_internal.admin_issue_activation_token(
              $1::uuid, $2::uuid, 'ACTIVATION', $3::char(64), $4::uuid, $5::timestamptz
            );`,
            [
              session.organizationId,
              emp.user_id,
              sha256Hex(rawToken),
              session.authUserId,
              expiresAt.toISOString(),
            ]
          );
          activationUrl = `${env.APP_PUBLIC_URL}/auth/activate#token=${encodeURIComponent(rawToken)}`;
        }

        await client.query(
          `INSERT INTO public.audit_logs (
            organization_id, actor_user_id, actor_role, action, entity_type, entity_id, summary
          ) VALUES ($1::uuid, $2::uuid, 'ADMIN', 'EMPLOYEE_ACTIVATED', 'EMPLOYEE', $3::uuid, $4::text);`,
          [session.organizationId, session.authUserId, employeeId, `Activated account for ${emp.full_name}.`]
        );

        return { activated: true, activationUrl, employeeId };
      },
      session.authUserId
    );

    res.status(200).json({
      success: true,
      data: result,
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/admin/employees/:id/deactivate
 */
adminRouter.post('/employees/:id/deactivate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const employeeId = String(req.params['id'] ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = String(body['reason'] ?? 'Account deactivated by Admin').trim();

    await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const empRes = await client.query<{ user_id: string; full_name: string }>(
          'SELECT user_id, full_name FROM public.employees WHERE organization_id = $1::uuid AND id = $2::uuid LIMIT 1;',
          [session.organizationId, employeeId]
        );
        const emp = empRes.rows[0];
        if (!emp) throw new AppError(404, ApiErrorCode.NOT_FOUND, 'Employee not found.');

        await client.query(
          `SELECT hrms_internal.admin_set_user_activation(
            $1::uuid, $2::uuid, FALSE, FALSE, FALSE, $3::uuid
          );`,
          [session.organizationId, emp.user_id, session.authUserId]
        );

        await client.query(
          `INSERT INTO public.audit_logs (
            organization_id, actor_user_id, actor_role, action, entity_type, entity_id, summary
          ) VALUES ($1::uuid, $2::uuid, 'ADMIN', 'EMPLOYEE_DEACTIVATED', 'EMPLOYEE', $3::uuid, $4::text);`,
          [
            session.organizationId,
            session.authUserId,
            employeeId,
            `Deactivated account for ${emp.full_name}: ${reason}`,
          ]
        );
      },
      session.authUserId
    );

    res.status(200).json({
      success: true,
      data: { deactivated: true },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/admin/employees/:id/reset-credentials
 * Admin directly assigns a temporary password, forces mandatory first-time password change,
 * revokes all active device sessions, and records an immutable audit log.
 */
adminRouter.post('/employees/:id/reset-credentials', async (req: Request, res: Response, next: NextFunction) => {
  try {
    assertProvisioningConfigured();
    const session = req.hrmsUser!;
    const employeeId = String(req.params['id'] ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    let temporaryPassword = typeof body['temporaryPassword'] === 'string' ? body['temporaryPassword'].trim() : '';

    if (!temporaryPassword) {
      temporaryPassword = `Kmaccs#${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    }

    if (temporaryPassword.length < 8) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'Temporary password must be at least 8 characters.');
    }

    const data = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const empRes = await client.query<{ user_id: string; full_name: string; employee_code: string }>(
          'SELECT user_id, full_name, employee_code FROM public.employees WHERE organization_id = $1::uuid AND id = $2::uuid LIMIT 1;',
          [session.organizationId, employeeId]
        );
        const emp = empRes.rows[0];
        if (!emp) throw new AppError(404, ApiErrorCode.NOT_FOUND, 'Employee not found.');

        // 1. Update GoTrue password directly
        await adminUpdateGoTrueUser(emp.user_id, {
          password: temporaryPassword,
        });

        // 2. Set must_change_password = TRUE in public.users
        await client.query(
          'SELECT hrms_internal.admin_set_user_activation($1::uuid, $2::uuid, TRUE, TRUE, TRUE, $3::uuid);',
          [session.organizationId, emp.user_id, session.authUserId]
        );

        // 3. Revoke all active sessions for this employee
        await client.query(
          'SELECT hrms_internal.revoke_all_user_sessions($1::uuid, $2::uuid, $3::uuid, $4::text, NULL);',
          [session.organizationId, emp.user_id, session.authUserId, 'ADMIN_PASSWORD_RESET']
        );

        // 4. Log to immutable audit_logs
        await client.query(
          `INSERT INTO public.audit_logs (
            organization_id, actor_user_id, actor_role, action, entity_type, entity_id, summary
          ) VALUES ($1::uuid, $2::uuid, 'ADMIN', 'ADMIN_PASSWORD_RESET', 'EMPLOYEE', $3::uuid, $4::text);`,
          [
            session.organizationId,
            session.authUserId,
            employeeId,
            `Admin reset temporary credentials and revoked active sessions for employee ${emp.full_name} (${emp.employee_code}). Must change password on next login.`,
          ]
        );

        return {
          employeeId,
          employeeCode: emp.employee_code,
          fullName: emp.full_name,
          temporaryPassword,
          mustChangePassword: true,
          message:
            'Temporary password assigned successfully. All active sessions have been revoked. The employee must set a new password on their next login.',
        };
      },
      session.authUserId
    );

    res.status(200).json({
      success: true,
      data,
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Department & Designation CRUD
 */
adminRouter.get('/departments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const data = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const [depts, desigs] = await Promise.all([
          client.query(
            'SELECT id, code, name, description, allow_field_attendance, is_active FROM public.departments WHERE organization_id = $1::uuid ORDER BY name ASC;',
            [session.organizationId]
          ),
          client.query(
            'SELECT id, department_id, code, title, job_category, is_field_eligible, is_active FROM public.designations WHERE organization_id = $1::uuid ORDER BY title ASC;',
            [session.organizationId]
          ),
        ]);
        return { departments: depts.rows, designations: desigs.rows };
      },
      session.authUserId
    );
    res.status(200).json({ success: true, data, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/departments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = String(body['name'] ?? '').trim();
    const code = String(body['code'] ?? name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')).slice(0, 30);
    const allowField = body['allowFieldAttendance'] === true;
    if (name.length < 2) throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'Department name required.');

    const dept = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const r = await client.query(
          `INSERT INTO public.departments (organization_id, code, name, description, allow_field_attendance, is_active)
           VALUES ($1::uuid, $2::varchar, $3::varchar, $4::text, $5::boolean, TRUE)
           RETURNING id, code, name, description, allow_field_attendance, is_active;`,
          [session.organizationId, code, name, String(body['description'] ?? ''), allowField]
        );
        return r.rows[0];
      },
      session.authUserId
    );
    res.status(201).json({ success: true, data: { department: dept }, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/designations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const title = String(body['title'] ?? '').trim();
    const departmentId = String(body['departmentId'] ?? '').trim();
    const jobCategory = String(body['jobCategory'] ?? 'OFFICE').trim().toUpperCase();
    if (title.length < 2 || !departmentId || !isValidJobCategory(jobCategory)) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'Valid title, departmentId, and jobCategory required.');
    }
    const code = String(body['code'] ?? title.toUpperCase().replace(/[^A-Z0-9]+/g, '_')).slice(0, 30);
    const desig = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const r = await client.query(
          `INSERT INTO public.designations (organization_id, department_id, code, title, job_category, is_field_eligible, is_active)
           VALUES ($1::uuid, $2::uuid, $3::varchar, $4::varchar, $5::varchar, $6::boolean, TRUE)
           RETURNING id, department_id, code, title, job_category, is_field_eligible, is_active;`,
          [session.organizationId, departmentId, code, title, jobCategory, FIELD_ELIGIBLE_CATEGORIES.has(jobCategory)]
        );
        return r.rows[0];
      },
      session.authUserId
    );
    res.status(201).json({ success: true, data: { designation: desig }, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/admin/settings & /office-location
 */
async function loadSettingsPayload(session: NonNullable<Request['hrmsUser']>) {
  return withTenantTransaction(
    session.organizationId,
    async (client) => {
      const [orgRes, office, historyRes, auditRes] = await Promise.all([
        client.query<{
          name: string;
          legal_name: string;
          organization_code: string;
          selfie_retention_days: number;
          planned_employee_count: number;
        }>(
          'SELECT name, legal_name, organization_code, selfie_retention_days, planned_employee_count FROM public.organizations WHERE id = $1::uuid LIMIT 1;',
          [session.organizationId]
        ),
        getPrimaryOffice(client, session.organizationId),
        client.query<{
          id: string;
          previous_name: string | null;
          previous_latitude: string | null;
          previous_longitude: string | null;
          previous_radius_meters: number | null;
          new_name: string;
          new_latitude: string;
          new_longitude: string;
          new_radius_meters: number;
          reason: string;
          changed_at: string;
        }>(
          `SELECT id, previous_name, previous_latitude::TEXT, previous_longitude::TEXT,
                  previous_radius_meters, new_name, new_latitude::TEXT, new_longitude::TEXT,
                  new_radius_meters, reason, changed_at::TEXT
           FROM public.office_location_history
           WHERE organization_id = $1::uuid
           ORDER BY changed_at DESC
           LIMIT 25;`,
          [session.organizationId]
        ),
        client.query<{
          id: string;
          action: string;
          entity_type: string;
          summary: string;
          actor_role: string;
          created_at: string;
        }>(
          `SELECT id, action, entity_type, summary, actor_role, created_at::TEXT
           FROM public.audit_logs
           WHERE organization_id = $1::uuid
           ORDER BY created_at DESC
           LIMIT 50;`,
          [session.organizationId]
        ),
      ]);

      const org = orgRes.rows[0];
      return {
        organization: org
          ? {
              name: org.name,
              legalName: org.legal_name,
              code: org.organization_code,
              selfieRetentionDays: org.selfie_retention_days,
              plannedEmployeeCount: org.planned_employee_count,
            }
          : null,
        officeGeofence: office
          ? {
              id: office.id,
              name: office.name,
              address: office.address,
              latitude: office.latitude,
              longitude: office.longitude,
              geofenceRadiusMeters: office.geofenceRadiusMeters,
              maxGpsAccuracyMeters: office.maxGpsAccuracyMeters,
              policyVersion: office.policyVersion,
              policyUpdatedBy: office.updatedBy ?? undefined,
            }
          : null,
        locationHistory: historyRes.rows.map((h) => ({
          id: h.id,
          previousName: h.previous_name,
          previousLatitude: h.previous_latitude ? Number(h.previous_latitude) : null,
          previousLongitude: h.previous_longitude ? Number(h.previous_longitude) : null,
          previousRadiusMeters: h.previous_radius_meters,
          newName: h.new_name,
          newLatitude: Number(h.new_latitude),
          newLongitude: Number(h.new_longitude),
          newRadiusMeters: h.new_radius_meters,
          reason: h.reason,
          changedAt: h.changed_at,
        })),
        auditLogs: auditRes.rows.map((a) => ({
          id: a.id,
          action: a.action,
          reason: a.summary,
          actorName: a.actor_role,
          createdAt: a.created_at,
        })),
      };
    },
    session.authUserId
  );
}

adminRouter.get('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await loadSettingsPayload(req.hrmsUser!);
    res.status(200).json({ success: true, data, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/office-location', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await loadSettingsPayload(req.hrmsUser!);
    res.status(200).json({ success: true, data, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

async function handleUpdateGeofence(req: Request, res: Response, next: NextFunction) {
  try {
    const session = req.hrmsUser!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = String(body['name'] ?? 'Official Head Office').trim();
    const address = String(body['address'] ?? '').trim();
    const latitude = Number(body['latitude']);
    const longitude = Number(body['longitude']);
    const radiusMeters = Number(body['geofenceRadiusMeters'] ?? 50);
    const maxAccuracy = Number(body['maxGpsAccuracyMeters'] ?? 30);
    const reason = String(body['reason'] ?? 'Admin updated office geofence configuration').trim();

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'Valid latitude and longitude are required.');
    }
    if (!Number.isFinite(radiusMeters) || radiusMeters < 10 || radiusMeters > 5000) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'Geofence radius must be between 10 and 5000m.');
    }
    if (!Number.isFinite(maxAccuracy) || maxAccuracy < 5 || maxAccuracy > 200) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'GPS accuracy threshold must be 5 to 200m.');
    }
    if (reason.length < 3) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'Change reason is required (min 3 chars).');
    }

    const updated = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const cur = await getPrimaryOffice(client, session.organizationId);
        if (!cur) throw new AppError(404, ApiErrorCode.NOT_FOUND, 'Primary office not found.');

        const nextVerNum = Number(cur.policyVersion.replace(/^v/i, '')) || 1;
        const nextPolicyVersion = `v${(nextVerNum + 0.1).toFixed(1)}`;
        const finalAddress = address || cur.address;

        await client.query(
          `UPDATE public.offices
           SET name = $3::varchar,
               address = $4::text,
               latitude = $5::numeric(18,14),
               longitude = $6::numeric(18,14),
               geofence_radius_meters = $7::integer,
               max_gps_accuracy_meters = $8::integer,
               policy_version = $9::varchar,
               updated_by = $10::uuid
           WHERE organization_id = $1::uuid AND id = $2::uuid;`,
          [
            session.organizationId,
            cur.id,
            name,
            finalAddress,
            latitude,
            longitude,
            Math.round(radiusMeters),
            Math.round(maxAccuracy),
            nextPolicyVersion,
            session.authUserId,
          ]
        );

        await client.query(
          `INSERT INTO public.office_location_history (
            organization_id, office_id,
            previous_name, previous_address, previous_latitude, previous_longitude,
            previous_radius_meters, previous_max_accuracy_meters,
            new_name, new_address, new_latitude, new_longitude,
            new_radius_meters, new_max_accuracy_meters, reason, changed_by
          ) VALUES (
            $1::uuid, $2::uuid,
            $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13, $14, $15, $16::uuid
          );`,
          [
            session.organizationId,
            cur.id,
            cur.name,
            cur.address,
            cur.latitude,
            cur.longitude,
            cur.geofenceRadiusMeters,
            cur.maxGpsAccuracyMeters,
            name,
            finalAddress,
            latitude,
            longitude,
            Math.round(radiusMeters),
            Math.round(maxAccuracy),
            reason,
            session.authUserId,
          ]
        );

        await client.query(
          `INSERT INTO public.audit_logs (
            organization_id, actor_user_id, actor_role, action, entity_type, entity_id, summary
          ) VALUES ($1::uuid, $2::uuid, 'ADMIN', 'OFFICE_GEOFENCE_UPDATED', 'OFFICE', $3::uuid, $4::text);`,
          [
            session.organizationId,
            session.authUserId,
            cur.id,
            `Updated HQ coordinates (${latitude}, ${longitude}), radius ${Math.round(radiusMeters)}m: ${reason}`,
          ]
        );

        return { updated: true, officeGeofence: await getPrimaryOffice(client, session.organizationId) };
      },
      session.authUserId
    );

    res.status(200).json({ success: true, data: updated, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
}

adminRouter.put('/settings/geofence', handleUpdateGeofence);
adminRouter.put('/office-location', handleUpdateGeofence);

adminRouter.put('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const legalName = body['legalName'] ? String(body['legalName']).trim() : undefined;
    const selfieRetentionDays =
      body['selfieRetentionDays'] !== undefined ? Number(body['selfieRetentionDays']) : undefined;

    if (
      selfieRetentionDays !== undefined &&
      (!Number.isInteger(selfieRetentionDays) || selfieRetentionDays < 1 || selfieRetentionDays > 30)
    ) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'Selfie retention must be between 1 and 30 days.');
    }

    await withTenantTransaction(
      session.organizationId,
      async (client) => {
        await client.query(
          `UPDATE public.organizations
           SET legal_name = COALESCE($2::varchar, legal_name),
               selfie_retention_days = COALESCE($3::integer, selfie_retention_days)
           WHERE id = $1::uuid;`,
          [session.organizationId, legalName ?? null, selfieRetentionDays ?? null]
        );
        await client.query(
          `INSERT INTO public.audit_logs (
            organization_id, actor_user_id, actor_role, action, entity_type, entity_id, summary
          ) VALUES ($1::uuid, $2::uuid, 'ADMIN', 'ORG_SETTINGS_UPDATED', 'ORGANIZATION', $1::uuid, 'Updated organization policy settings.');`,
          [session.organizationId, session.authUserId]
        );
      },
      session.authUserId
    );

    res.status(200).json({ success: true, data: { updated: true }, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

/**
 * Attendance Monitoring, Review & Corrections
 */
adminRouter.get('/attendance', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const dateFrom = typeof req.query['dateFrom'] === 'string' ? req.query['dateFrom'] : undefined;
    const dateTo = typeof req.query['dateTo'] === 'string' ? req.query['dateTo'] : undefined;

    const data = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const [records, fieldSessions] = await Promise.all([
          fetchMappedAttendanceRecords(client, session.organizationId, {
            dateFrom,
            dateTo,
            includeSignedMedia: true,
            limit: 150,
          }),
          fetchMappedFieldSessions(client, session.organizationId),
        ]);
        return { records, fieldSessions };
      },
      session.authUserId
    );

    res.status(200).json({ success: true, data, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/attendance/:id/review', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const dayId = String(req.params['id'] ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const decision = String(body['decision'] ?? '').trim().toUpperCase();
    const remarks = String(body['remarks'] ?? '').trim();
    const approveOvertime = body['postShiftApproved'] === true;

    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'Decision must be APPROVED or REJECTED.');
    }
    if (remarks.length < 5) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'Review remarks (min 5 chars) are mandatory.');
    }

    const result = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const curRes = await client.query<{
          id: string;
          employee_id: string;
          user_id: string;
          attendance_date: string;
          check_in_at: string | null;
          check_out_at: string | null;
          post_6pm_approved: boolean;
          payable_minutes: number;
          approval_status: string;
          check_in_distance_meters: string | null;
          check_in_accuracy_meters: string | null;
          check_out_distance_meters: string | null;
          check_out_accuracy_meters: string | null;
          is_outside_geofence: boolean;
          location_state: string;
          verification_state: string;
        }>(
          `SELECT ad.id, ad.employee_id, e.user_id, ad.attendance_date::TEXT,
                  ad.check_in_at::TEXT, ad.check_out_at::TEXT, ad.post_6pm_approved, ad.payable_minutes,
                  ad.approval_status, ad.check_in_distance_meters::TEXT, ad.check_in_accuracy_meters::TEXT,
                  ad.check_out_distance_meters::TEXT, ad.check_out_accuracy_meters::TEXT,
                  ad.is_outside_geofence, ad.location_state, ad.verification_state
           FROM public.attendance_days ad
           JOIN public.employees e ON e.id = ad.employee_id AND e.organization_id = ad.organization_id
           WHERE ad.organization_id = $1::uuid AND ad.id = $2::uuid
           LIMIT 1;`,
          [session.organizationId, dayId]
        );
        const cur = curRes.rows[0];
        if (!cur) throw new AppError(404, ApiErrorCode.NOT_FOUND, 'Attendance record not found.');

        // Idempotency: prevent duplicate approval or rejection of the same submission
        if (cur.approval_status === decision) {
          return {
            updated: false,
            alreadyReviewed: true,
            approvalStatus: cur.approval_status,
            message: `Attendance submission has already been ${decision.toLowerCase()}.`,
          };
        }

        // Strict location & verification enforcement for approvals
        if (decision === 'APPROVED') {
          const checkInDist = cur.check_in_distance_meters ? Number(cur.check_in_distance_meters) : 0;
          const checkInAcc = cur.check_in_accuracy_meters ? Number(cur.check_in_accuracy_meters) : 0;
          const checkOutDist = cur.check_out_distance_meters ? Number(cur.check_out_distance_meters) : 0;
          const checkOutAcc = cur.check_out_accuracy_meters ? Number(cur.check_out_accuracy_meters) : 0;

          if (
            cur.is_outside_geofence ||
            cur.location_state === 'OUTSIDE_GEOFENCE' ||
            checkInDist > 50 ||
            checkInAcc > 30 ||
            (cur.check_out_at && (checkOutDist > 50 || checkOutAcc > 30))
          ) {
            throw new AppError(
              400,
              ApiErrorCode.VALIDATION_ERROR,
              'Cannot approve attendance: employee location is outside the 50m office geofence or GPS accuracy exceeds the 30m maximum threshold.'
            );
          }

          if (cur.verification_state === 'SPOOFING_SUSPECTED') {
            throw new AppError(
              400,
              ApiErrorCode.VALIDATION_ERROR,
              'Cannot approve attendance: spoofing was suspected during biometric verification.'
            );
          }
        }

        const nextPostShift = approveOvertime || cur.post_6pm_approved;
        let payable = 0;
        let approvedMinutes = 0;

        if (decision === 'APPROVED') {
          if (cur.check_in_at && cur.check_out_at) {
            const dec01 = calculateDec01AttendanceMinutes(
              toIstDateAndHHMM(cur.check_in_at).hhmm,
              toIstDateAndHHMM(cur.check_out_at).hhmm,
              nextPostShift
            );
            payable = dec01.payableMinutes;
            approvedMinutes = dec01.approvedPayableMinutes;
          } else {
            payable = 0;
            approvedMinutes = 0;
          }
        } else {
          payable = 0;
          approvedMinutes = 0;
        }

        await client.query(
          `UPDATE public.attendance_days
           SET approval_status = $3::varchar,
               post_6pm_approved = $4::boolean,
               payable_minutes = $5::integer,
               approved_payable_minutes = $6::integer,
               reviewed_by = $7::uuid,
               reviewed_at = NOW(),
               review_reason = $8::text
           WHERE organization_id = $1::uuid AND id = $2::uuid;`,
          [
            session.organizationId,
            dayId,
            decision,
            nextPostShift,
            payable,
            approvedMinutes,
            session.authUserId,
            remarks,
          ]
        );

        await client.query(
          `INSERT INTO public.notifications (
            organization_id, recipient_user_id, category, title, message, entity_type, entity_id
          ) VALUES ($1::uuid, $2::uuid, $3::varchar, $4::varchar, $5::text, 'ATTENDANCE', $6::uuid);`,
          [
            session.organizationId,
            cur.user_id,
            decision === 'APPROVED' ? 'APPROVAL' : 'REJECTION',
            `Attendance ${decision === 'APPROVED' ? 'Approved' : 'Rejected'} (${cur.attendance_date})`,
            `Admin review decision: ${decision}. Remarks: ${remarks}`,
            dayId,
          ]
        );

        await client.query(
          `INSERT INTO public.audit_logs (
            organization_id, actor_user_id, actor_role, action, entity_type, entity_id, summary, metadata
          ) VALUES ($1::uuid, $2::uuid, 'ADMIN', $3::varchar, 'ATTENDANCE', $4::uuid, $5::text, $6::jsonb);`,
          [
            session.organizationId,
            session.authUserId,
            `ATTENDANCE_${decision}`,
            dayId,
            `Admin reviewed attendance for ${cur.attendance_date}: ${decision} — ${remarks}`,
            JSON.stringify({
              decision,
              remarks,
              employeeId: cur.employee_id,
              attendanceDate: cur.attendance_date,
              approvedPayableMinutes: approvedMinutes,
              locationState: cur.location_state,
              checkInDistance: cur.check_in_distance_meters,
              checkInAccuracy: cur.check_in_accuracy_meters,
            }),
          ]
        );

        return {
          updated: true,
          approvalStatus: decision,
          approvedPayableMinutes: approvedMinutes,
          reviewedBy: session.authUserId,
          reviewedAt: new Date().toISOString(),
          remarks,
        };
      },
      session.authUserId
    );

    res.status(200).json({ success: true, data: result, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/attendance/:id/correct', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const dayId = String(req.params['id'] ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const actionType = String(body['actionType'] ?? 'CHECK_OUT').trim().toUpperCase();
    const newTime = String(body['newTime'] ?? '').trim();
    const reason = String(body['reason'] ?? '').trim();
    const postShiftApproved = body['postShiftApproved'] === true;

    if (reason.length < 5) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'Correction reason (min 5 chars) is mandatory.');
    }

    await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const curRes = await client.query<{
          id: string;
          employee_id: string;
          user_id: string;
          attendance_date: string;
          check_in_at: string | null;
          check_out_at: string | null;
          approval_status: string;
          payable_minutes: number;
          approved_payable_minutes: number;
        }>(
          `SELECT ad.id, ad.employee_id, e.user_id, ad.attendance_date::TEXT,
                  ad.check_in_at::TEXT, ad.check_out_at::TEXT,
                  ad.approval_status, ad.payable_minutes, ad.approved_payable_minutes
           FROM public.attendance_days ad
           JOIN public.employees e ON e.id = ad.employee_id AND e.organization_id = ad.organization_id
           WHERE ad.organization_id = $1::uuid AND ad.id = $2::uuid
           LIMIT 1;`,
          [session.organizationId, dayId]
        );
        const cur = curRes.rows[0];
        if (!cur) throw new AppError(404, ApiErrorCode.NOT_FOUND, 'Attendance record not found.');

        const parsedNewTs = combineIstDateAndHHMMToDate(cur.attendance_date, newTime);
        const nextCheckIn = actionType === 'CHECK_IN' ? parsedNewTs : cur.check_in_at ? new Date(cur.check_in_at) : null;
        const nextCheckOut = actionType === 'CHECK_OUT' ? parsedNewTs : cur.check_out_at ? new Date(cur.check_out_at) : null;

        if (!nextCheckIn) {
          throw new AppError(400, ApiErrorCode.BAD_REQUEST, 'Cannot compute attendance without check-in time.');
        }

        let metrics = {
          rawDurationMinutes: 0,
          lunchDeductedMinutes: 0,
          payableMinutes: 0,
          approvedPayableMinutes: 0,
          post6pmMinutes: 0,
          isLateArrival: toIstDateAndHHMM(nextCheckIn).minutesOfDay > 10 * 60 + 10,
          isEarlyDeparture: false,
        };
        if (nextCheckOut) {
          metrics = calculateDec01AttendanceMinutes(
            toIstDateAndHHMM(nextCheckIn).hhmm,
            toIstDateAndHHMM(nextCheckOut).hhmm,
            postShiftApproved
          );
        }

        const nextStatus = cur.approval_status === 'REJECTED' ? 'APPROVED' : cur.approval_status;
        const nextApprovedPayable =
          nextStatus === 'APPROVED' || nextStatus === 'SUBMITTED' ? metrics.approvedPayableMinutes : 0;

        await client.query(
          `UPDATE public.attendance_days
           SET check_in_at = $3::timestamptz,
               check_out_at = $4::timestamptz,
               approval_status = $5::varchar,
               post_6pm_approved = $6::boolean,
               is_late_arrival = $7::boolean,
               is_early_departure = $8::boolean,
               raw_duration_minutes = $9::integer,
               lunch_deducted_minutes = $10::integer,
               payable_minutes = $11::integer,
               approved_payable_minutes = $12::integer,
               post_6pm_minutes = $13::integer,
               reviewed_by = $14::uuid,
               reviewed_at = NOW(),
               review_reason = $15::text
           WHERE organization_id = $1::uuid AND id = $2::uuid;`,
          [
            session.organizationId,
            dayId,
            nextCheckIn.toISOString(),
            nextCheckOut ? nextCheckOut.toISOString() : null,
            nextStatus,
            postShiftApproved,
            metrics.isLateArrival,
            metrics.isEarlyDeparture,
            metrics.rawDurationMinutes,
            metrics.lunchDeductedMinutes,
            metrics.payableMinutes,
            nextApprovedPayable,
            metrics.post6pmMinutes,
            session.authUserId,
            reason,
          ]
        );

        await client.query(
          `INSERT INTO public.attendance_corrections (
            organization_id, attendance_day_id, employee_id, corrected_by, reason,
            previous_check_in_at, new_check_in_at, previous_check_out_at, new_check_out_at,
            previous_status, new_status, previous_payable_minutes, new_payable_minutes,
            previous_approved_payable_minutes, new_approved_payable_minutes
          ) VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text,
            $6::timestamptz, $7::timestamptz, $8::timestamptz, $9::timestamptz,
            $10::varchar, $11::varchar, $12::integer, $13::integer, $14::integer, $15::integer
          );`,
          [
            session.organizationId,
            dayId,
            cur.employee_id,
            session.authUserId,
            reason,
            cur.check_in_at,
            nextCheckIn.toISOString(),
            cur.check_out_at,
            nextCheckOut ? nextCheckOut.toISOString() : null,
            cur.approval_status,
            nextStatus,
            cur.payable_minutes,
            metrics.payableMinutes,
            cur.approved_payable_minutes,
            nextApprovedPayable,
          ]
        );

        await client.query(
          `INSERT INTO public.notifications (
            organization_id, recipient_user_id, category, title, message, entity_type, entity_id
          ) VALUES ($1::uuid, $2::uuid, 'APPROVAL', $3::varchar, $4::text, 'ATTENDANCE', $5::uuid);`,
          [
            session.organizationId,
            cur.user_id,
            `Attendance Corrected (${cur.attendance_date})`,
            `Admin adjusted ${actionType} to ${newTime} (${metrics.payableMinutes}m payable). Reason: ${reason}`,
            dayId,
          ]
        );

        await client.query(
          `INSERT INTO public.audit_logs (
            organization_id, actor_user_id, actor_role, action, entity_type, entity_id, summary
          ) VALUES ($1::uuid, $2::uuid, 'ADMIN', 'ATTENDANCE_CORRECTED', 'ATTENDANCE', $3::uuid, $4::text);`,
          [
            session.organizationId,
            session.authUserId,
            dayId,
            `Corrected ${actionType} on ${cur.attendance_date} to ${newTime}: ${reason}`,
          ]
        );
      },
      session.authUserId
    );

    res.status(200).json({ success: true, data: { updated: true }, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

/**
 * Biometric Enrollments Admin Queue & Review
 */
adminRouter.get('/biometrics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const rows = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const r = await client.query<{
          id: string;
          employee_id: string;
          employee_code: string;
          employee_name: string;
          status: string;
          consent_given: boolean;
          evidence_bucket: string | null;
          evidence_path: string | null;
          submitted_at: string | null;
          reviewed_at: string | null;
          rejection_reason: string | null;
        }>(
          `SELECT b.id, b.employee_id, e.employee_code, e.full_name AS employee_name,
                  b.status, b.consent_given, b.evidence_bucket, b.evidence_path,
                  b.submitted_at::TEXT, b.reviewed_at::TEXT, b.rejection_reason
           FROM public.biometric_enrollments b
           JOIN public.employees e ON e.id = b.employee_id AND e.organization_id = b.organization_id
           WHERE b.organization_id = $1::uuid AND b.is_current = TRUE
           ORDER BY b.created_at DESC;`,
          [session.organizationId]
        );
        return r.rows;
      },
      session.authUserId
    );

    const enriched = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        evidence_signed_url: row.evidence_path
          ? await createPrivateSignedUrl(
              (row.evidence_bucket as 'face-enrollment') || 'face-enrollment',
              row.evidence_path,
              120
            )
          : null,
      }))
    );

    res.status(200).json({ success: true, data: { enrollments: enriched }, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/biometrics/:id/review', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const id = String(req.params['id'] ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const decision = String(body['decision'] ?? '').trim().toUpperCase();
    const reason = String(body['reason'] ?? '').trim();
    if (!['APPROVED', 'REJECTED', 'REVOKED'].includes(decision)) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'Decision must be APPROVED, REJECTED, or REVOKED.');
    }

    await withTenantTransaction(
      session.organizationId,
      async (client) => {
        await client.query(
          `UPDATE public.biometric_enrollments
           SET status = $3::varchar,
               reviewed_by = $4::uuid,
               reviewed_at = NOW(),
               rejection_reason = CASE WHEN $3 = 'REJECTED' THEN $5::text ELSE rejection_reason END,
               revoked_by = CASE WHEN $3 = 'REVOKED' THEN $4::uuid ELSE revoked_by END,
               revoked_at = CASE WHEN $3 = 'REVOKED' THEN NOW() ELSE revoked_at END,
               revoked_reason = CASE WHEN $3 = 'REVOKED' THEN $5::text ELSE revoked_reason END
           WHERE organization_id = $1::uuid AND id = $2::uuid;`,
          [session.organizationId, id, decision, session.authUserId, reason || 'Reviewed by Admin']
        );
      },
      session.authUserId
    );
    res.status(200).json({ success: true, data: { updated: true }, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

/**
 * CompreFace Subject Mappings (Tenant-safe assignment, listing, and revocation)
 */
adminRouter.get('/biometrics/mappings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const mappings = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const r = await client.query<{
          id: string;
          employee_id: string;
          employee_code: string;
          employee_name: string;
          employment_status: string;
          provider_name: string;
          provider_collection_key: string;
          provider_subject: string;
          biometric_enrollment_id: string | null;
          status: string;
          assigned_at: string;
          revoked_at: string | null;
          revoked_reason: string | null;
          notes: string | null;
        }>(
          `SELECT m.id, m.employee_id, e.employee_code, e.full_name AS employee_name,
                  e.employment_status, m.provider_name, m.provider_collection_key,
                  m.provider_subject, m.biometric_enrollment_id, m.status,
                  m.assigned_at::TEXT, m.revoked_at::TEXT, m.revoked_reason, m.notes
           FROM public.face_provider_mappings m
           JOIN public.employees e
             ON e.id = m.employee_id AND e.organization_id = m.organization_id
           WHERE m.organization_id = $1::uuid
           ORDER BY (m.status = 'ACTIVE') DESC, m.created_at DESC;`,
          [session.organizationId]
        );
        return r.rows;
      },
      session.authUserId
    );

    res.status(200).json({
      success: true,
      data: { mappings },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/biometrics/compreface/subjects', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    if (env.FACE_PROVIDER !== 'compreface' || !env.COMPREFACE_BASE_URL || !env.COMPREFACE_API_KEY) {
      res.status(200).json({
        success: true,
        data: { available: false, subjects: [] },
        meta: { timestamp: new Date().toISOString() },
      });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.COMPREFACE_TIMEOUT_MS);
    let subjects: string[] = [];
    try {
      const cfRes = await fetch(`${env.COMPREFACE_BASE_URL}/api/v1/recognition/subjects`, {
        headers: { 'x-api-key': env.COMPREFACE_API_KEY },
        signal: controller.signal,
      });
      if (!cfRes.ok) {
        throw new AppError(502, ApiErrorCode.VALIDATION_ERROR, `CompreFace subjects lookup returned HTTP ${cfRes.status}.`);
      }
      const cfBody = (await cfRes.json()) as { subjects?: unknown };
      subjects = Array.isArray(cfBody.subjects)
        ? cfBody.subjects.map((s) => String(s ?? '').trim()).filter(Boolean)
        : [];
    } finally {
      clearTimeout(timer);
    }

    const activeInOrg = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const r = await client.query<{
          provider_subject: string;
          employee_id: string;
          employee_code: string;
          employee_name: string;
        }>(
          `SELECT m.provider_subject, m.employee_id, e.employee_code, e.full_name AS employee_name
           FROM public.face_provider_mappings m
           JOIN public.employees e
             ON e.id = m.employee_id AND e.organization_id = m.organization_id
           WHERE m.organization_id = $1::uuid
             AND m.provider_name = 'compreface'
             AND m.status = 'ACTIVE';`,
          [session.organizationId]
        );
        return r.rows;
      },
      session.authUserId
    );

    const bySubject = new Map(activeInOrg.map((row) => [row.provider_subject.toLowerCase(), row]));

    res.status(200).json({
      success: true,
      data: {
        available: true,
        subjects: subjects.map((subject) => {
          const match = bySubject.get(subject.toLowerCase());
          return {
            subject,
            assignedEmployeeId: match?.employee_id ?? null,
            assignedEmployeeCode: match?.employee_code ?? null,
            assignedEmployeeName: match?.employee_name ?? null,
          };
        }),
      },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/biometrics/mappings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const employeeId = String(body['employeeId'] ?? '').trim();
    const providerSubject = String(body['providerSubject'] ?? '').trim();
    const providerName = String(body['providerName'] ?? 'compreface').trim().toLowerCase();
    const providerCollectionKey = String(body['providerCollectionKey'] ?? 'default').trim();
    const biometricEnrollmentId = body['biometricEnrollmentId']
      ? String(body['biometricEnrollmentId']).trim()
      : null;
    const notes = body['notes'] ? String(body['notes']).trim() : null;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(employeeId)) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'Valid employeeId UUID is required.');
    }
    if (!providerSubject || providerSubject.length > 160) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'providerSubject must be 1–160 characters.');
    }
    if (!['compreface', 'http'].includes(providerName)) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'providerName must be compreface or http.');
    }
    if (!providerCollectionKey || providerCollectionKey.length > 128) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'providerCollectionKey must be 1–128 characters.');
    }
    if (biometricEnrollmentId && !uuidRegex.test(biometricEnrollmentId)) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'biometricEnrollmentId must be a valid UUID.');
    }

    const mapping = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        try {
          const inserted = await client.query<{
            id: string;
            organization_id: string;
            employee_id: string;
            provider_name: string;
            provider_collection_key: string;
            provider_subject: string;
            biometric_enrollment_id: string | null;
            status: string;
            assigned_at: string;
          }>(
            `INSERT INTO public.face_provider_mappings (
               organization_id, employee_id, provider_name, provider_collection_key,
               provider_subject, biometric_enrollment_id, assigned_by, notes
             ) VALUES (
               $1::uuid, $2::uuid, $3::varchar, $4::varchar,
               $5::varchar, $6::uuid, $7::uuid, $8::text
             )
             RETURNING id, organization_id, employee_id, provider_name, provider_collection_key,
                       provider_subject, biometric_enrollment_id, status, assigned_at::TEXT;`,
            [
              session.organizationId,
              employeeId,
              providerName,
              providerCollectionKey,
              providerSubject,
              biometricEnrollmentId,
              session.authUserId,
              notes,
            ]
          );
          return inserted.rows[0]!;
        } catch (dbErr) {
          const pgErr = dbErr as { code?: string; message?: string };
          if (pgErr.code === '23505') {
            throw new AppError(
              409,
              ApiErrorCode.VALIDATION_ERROR,
              'Employee already has an active mapping or this CompreFace subject is already assigned to another active employee.'
            );
          }
          if (pgErr.code === '23503' || pgErr.code === '22023') {
            throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, pgErr.message || 'Invalid employee mapping.');
          }
          throw dbErr;
        }
      },
      session.authUserId
    );

    res.status(201).json({
      success: true,
      data: { mapping },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/biometrics/mappings/:id/revoke', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const id = String(req.params['id'] ?? '').trim();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = String(body['reason'] ?? 'Revoked by Admin').trim() || 'Revoked by Admin';

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'Valid mapping id UUID is required.');
    }

    const revoked = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const r = await client.query<{
          id: string;
          employee_id: string;
          provider_subject: string;
          status: string;
          revoked_at: string;
          revoked_reason: string;
        }>(
          `UPDATE public.face_provider_mappings
           SET status = 'REVOKED',
               revoked_by = $3::uuid,
               revoked_at = NOW(),
               revoked_reason = $4::text
           WHERE organization_id = $1::uuid
             AND id = $2::uuid
             AND status = 'ACTIVE'
           RETURNING id, employee_id, provider_subject, status, revoked_at::TEXT, revoked_reason;`,
          [session.organizationId, id, session.authUserId, reason]
        );
        if (r.rowCount === 0) {
          throw new AppError(404, ApiErrorCode.NOT_FOUND, 'Active biometric mapping not found.');
        }
        return r.rows[0]!;
      },
      session.authUserId
    );

    res.status(200).json({
      success: true,
      data: { mapping: revoked },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Field Force & Customer Visit Review
 */
adminRouter.get('/field-force', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const data = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const [sessions, visits] = await Promise.all([
          fetchMappedFieldSessions(client, session.organizationId),
          fetchMappedCustomerVisits(client, session.organizationId, { includeSignedEvidence: true }),
        ]);
        return { sessions, visits };
      },
      session.authUserId
    );
    res.status(200).json({ success: true, data, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/customer-visits/:id/review', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const visitId = String(req.params['id'] ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reviewStatus = String(body['reviewStatus'] ?? 'VERIFIED').trim().toUpperCase();
    const reviewNote = String(body['reviewNote'] ?? '').trim();

    if (!['VERIFIED', 'FLAGGED', 'REJECTED'].includes(reviewStatus)) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'reviewStatus must be VERIFIED, FLAGGED, or REJECTED.');
    }

    await withTenantTransaction(
      session.organizationId,
      async (client) => {
        await client.query(
          `UPDATE public.customer_visits
           SET review_status = $3::varchar, reviewed_by = $4::uuid, reviewed_at = NOW(), review_note = $5::text
           WHERE organization_id = $1::uuid AND id = $2::uuid;`,
          [session.organizationId, visitId, reviewStatus, session.authUserId, reviewNote || null]
        );
      },
      session.authUserId
    );
    res.status(200).json({ success: true, data: { updated: true }, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

/**
 * Leave Applications Queue & Review (all CL/SL/PL/LWP remain unpaid, 0 payable hours)
 */
adminRouter.get('/leaves', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const leaves = await withTenantTransaction(
      session.organizationId,
      async (client) => fetchMappedLeaves(client, session.organizationId),
      session.authUserId
    );
    res.status(200).json({ success: true, data: { leaves }, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/leaves/:id/review', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const leaveId = String(req.params['id'] ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const decision = String(body['decision'] ?? '').trim().toUpperCase();
    const remarks = String(body['remarks'] ?? '').trim();

    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'Decision must be APPROVED or REJECTED.');
    }
    if (remarks.length < 5) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'Mandatory Admin remarks (min 5 chars) required.');
    }

    await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const lRes = await client.query<{
          id: string;
          status: string;
          leave_code: string;
          total_days: number;
          user_id: string;
        }>(
          `SELECT la.id, la.status, la.leave_code, la.total_days, e.user_id
           FROM public.leave_applications la
           JOIN public.employees e ON e.id = la.employee_id AND e.organization_id = la.organization_id
           WHERE la.organization_id = $1::uuid AND la.id = $2::uuid LIMIT 1;`,
          [session.organizationId, leaveId]
        );
        const leave = lRes.rows[0];
        if (!leave) throw new AppError(404, ApiErrorCode.NOT_FOUND, 'Leave request not found.');
        if (leave.status !== 'PENDING') {
          throw new AppError(409, ApiErrorCode.CONFLICT, 'Leave application has already been processed.');
        }

        await client.query(
          `UPDATE public.leave_applications
           SET status = $3::varchar, reviewed_by = $4::uuid, reviewed_at = NOW(), decision_reason = $5::text
           WHERE organization_id = $1::uuid AND id = $2::uuid;`,
          [session.organizationId, leaveId, decision, session.authUserId, remarks]
        );

        await client.query(
          `INSERT INTO public.notifications (
            organization_id, recipient_user_id, category, title, message, entity_type, entity_id
          ) VALUES ($1::uuid, $2::uuid, $3::varchar, $4::varchar, $5::text, 'LEAVE', $6::uuid);`,
          [
            session.organizationId,
            leave.user_id,
            decision === 'APPROVED' ? 'APPROVAL' : 'REJECTION',
            `Leave Request ${decision}: ${leave.leave_code} (${leave.total_days}d)`,
            `Your ${leave.leave_code} application (unpaid policy, 0h) was ${decision.toLowerCase()}. Remarks: ${remarks}`,
            leaveId,
          ]
        );

        await client.query(
          `INSERT INTO public.audit_logs (
            organization_id, actor_user_id, actor_role, action, entity_type, entity_id, summary
          ) VALUES ($1::uuid, $2::uuid, 'ADMIN', $3::varchar, 'LEAVE', $4::uuid, $5::text);`,
          [
            session.organizationId,
            session.authUserId,
            `LEAVE_${decision}`,
            leaveId,
            `${decision} ${leave.leave_code} leave (${leave.total_days}d): ${remarks}`,
          ]
        );
      },
      session.authUserId
    );

    res.status(200).json({ success: true, data: { updated: true }, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

/**
 * Hourly Payroll Engine (with DB & API PO Formula Sign-Off Gate)
 */
adminRouter.get('/payroll', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const month = typeof req.query['month'] === 'string' && req.query['month'].trim()
      ? req.query['month'].trim()
      : toIstDateAndHHMM().dateStr.slice(0, 7);

    const data = await withTenantTransaction(
      session.organizationId,
      async (client) => fetchMappedPayrollForMonth(client, session.organizationId, month),
      session.authUserId
    );
    res.status(200).json({ success: true, data, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/payroll/prepare', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const monthStr = String(body['month'] ?? toIstDateAndHHMM().dateStr.slice(0, 7)).trim();
    const previewMode: FormulaMode =
      body['formulaMode'] === 'SCHEDULED_DAYS_X_7H_NET'
        ? 'SCHEDULED_DAYS_X_7H_NET'
        : 'CALENDAR_DAYS_X_8H_PAID_LUNCH';

    const { year, month, startDate, endDate, calendarDays, workingDaysMonSat } =
      getMonthDateRange(monthStr);

    const prepared = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        // Ensure period row
        const periodUpsert = await client.query<{ id: string }>(
          `INSERT INTO public.payroll_periods (
            organization_id, year, month, start_date, end_date, calendar_days, working_days_mon_sat, status
          ) VALUES ($1::uuid, $2::integer, $3::integer, $4::date, $5::date, $6::integer, $7::integer, 'OPEN')
          ON CONFLICT (organization_id, year, month) DO UPDATE
            SET calendar_days = EXCLUDED.calendar_days,
                working_days_mon_sat = EXCLUDED.working_days_mon_sat
          RETURNING id;`,
          [session.organizationId, year, month, startDate, endDate, calendarDays, workingDaysMonSat]
        );
        const periodId = periodUpsert.rows[0]!.id;

        const approvedExists = await client.query<{ id: string }>(
          `SELECT id FROM public.payroll_runs
           WHERE organization_id = $1::uuid AND payroll_period_id = $2::uuid
             AND status IN ('APPROVED', 'PROCESSED')
           LIMIT 1;`,
          [session.organizationId, periodId]
        );
        if (approvedExists.rows[0]) {
          throw new AppError(
            409,
            ApiErrorCode.CONFLICT,
            `Payroll for ${monthStr} is already finalized and approved.`
          );
        }

        // Supersede previous unapproved draft runs for this month cleanly
        await client.query(
          `UPDATE public.payroll_runs
           SET status = 'CANCELLED'
           WHERE organization_id = $1::uuid AND payroll_period_id = $2::uuid
             AND status IN ('PENDING_FORMULA_APPROVAL', 'DRAFT', 'REVIEWED');`,
          [session.organizationId, periodId]
        );

        const nextRunNumRes = await client.query<{ next_num: number }>(
          `SELECT COALESCE(MAX(run_number), 0) + 1 AS next_num
           FROM public.payroll_runs
           WHERE organization_id = $1::uuid AND payroll_period_id = $2::uuid;`,
          [session.organizationId, periodId]
        );
        const runNumber = nextRunNumRes.rows[0]!.next_num;

        // Strictly only EMPLOYEE accounts (Admin NEVER included)
        const empsRes = await client.query<{
          employee_id: string;
          salary_id: string | null;
          monthly_salary_paise: string | null;
        }>(
          `SELECT e.id AS employee_id, sal.id AS salary_id, sal.monthly_salary_paise::TEXT
           FROM public.employees e
           LEFT JOIN LATERAL (
             SELECT s.id, s.monthly_salary_paise
             FROM public.employee_salaries s
             WHERE s.organization_id = e.organization_id
               AND s.employee_id = e.id
               AND s.status = 'ACTIVE'
             ORDER BY s.effective_from DESC
             LIMIT 1
           ) sal ON TRUE
           WHERE e.organization_id = $1::uuid
             AND e.employment_status IN ('ACTIVE', 'PROBATION', 'NOTICE_PERIOD')
             AND NOT EXISTS (
               SELECT 1 FROM public.user_roles ur
               WHERE ur.organization_id = e.organization_id
                 AND ur.user_id = e.user_id
                 AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
             )
           ORDER BY e.employee_code ASC;`,
          [session.organizationId]
        );

        const runInsert = await client.query<{ id: string }>(
          `INSERT INTO public.payroll_runs (
            organization_id, payroll_period_id, calendar_days, run_number,
            formula_mode, formula_approved, status, created_by
          ) VALUES (
            $1::uuid, $2::uuid, $3::integer, $4::integer,
            'PENDING_PO_APPROVAL', FALSE, 'PENDING_FORMULA_APPROVAL', $5::uuid
          )
          RETURNING id;`,
          [session.organizationId, periodId, calendarDays, runNumber, session.authUserId]
        );
        const runId = runInsert.rows[0]!.id;

        let totalPayableMinutes = 0;
        let totalGrossPaise = 0;
        let totalNetPaise = 0;

        for (const emp of empsRes.rows) {
          const attStats = await client.query<{
            approved_minutes: string;
            pending_minutes: string;
            approved_days: string;
            late_count: string;
            early_count: string;
          }>(
            `SELECT
               COALESCE(SUM(CASE WHEN approval_status = 'APPROVED' THEN approved_payable_minutes ELSE 0 END), 0)::TEXT AS approved_minutes,
               COALESCE(SUM(CASE WHEN approval_status IN ('PENDING_ADMIN_REVIEW', 'VERIFICATION_PENDING') THEN payable_minutes ELSE 0 END), 0)::TEXT AS pending_minutes,
               COUNT(*) FILTER (WHERE approval_status = 'APPROVED')::TEXT AS approved_days,
               COUNT(*) FILTER (WHERE is_late_arrival = TRUE)::TEXT AS late_count,
               COUNT(*) FILTER (WHERE is_early_departure = TRUE)::TEXT AS early_count
             FROM public.attendance_days
             WHERE organization_id = $1::uuid
               AND employee_id = $2::uuid
               AND attendance_date BETWEEN $3::date AND $4::date;`,
            [session.organizationId, emp.employee_id, startDate, endDate]
          );
          const leaveStats = await client.query<{ unpaid_days: string }>(
            `SELECT COALESCE(SUM(total_days), 0)::TEXT AS unpaid_days
             FROM public.leave_applications
             WHERE organization_id = $1::uuid
               AND employee_id = $2::uuid
               AND status = 'APPROVED'
               AND start_date <= $4::date
               AND end_date >= $3::date;`,
            [session.organizationId, emp.employee_id, startDate, endDate]
          );

          const st = attStats.rows[0]!;
          const approvedMins = Number(st.approved_minutes);
          const pendingMins = Number(st.pending_minutes);
          const approvedDays = Number(st.approved_days);
          const lateCount = Number(st.late_count);
          const earlyCount = Number(st.early_count);
          const unpaidDays = Number(leaveStats.rows[0]?.unpaid_days ?? 0);
          const salaryPaise = emp.monthly_salary_paise ? Number(emp.monthly_salary_paise) : 0;

          const dual = calculateDualPayrollComparison({
            monthlySalaryPaise: salaryPaise,
            approvedPayableMinutes: approvedMins,
            calendarDays,
            workingDaysMonSat,
          });
          const previewCalc = dual.computeForMode(previewMode);

          totalPayableMinutes += approvedMins;
          totalGrossPaise += previewCalc.grossEarnedPaise;
          totalNetPaise += previewCalc.netPayablePaise;

          await client.query(
            `INSERT INTO public.payroll_items (
              organization_id, payroll_run_id, calendar_days, employee_id, employee_salary_id,
              approved_payable_minutes, pending_review_minutes, unpaid_leave_days,
              approved_days_count, late_arrivals_count, early_departures_count,
              salary_reference_paise, derived_hourly_rate_paise,
              gross_earned_paise, adjustments_paise, net_payable_paise, calculation_snapshot
            ) VALUES (
              $1::uuid, $2::uuid, $3::integer, $4::uuid, $5::uuid,
              $6::integer, $7::integer, $8::integer,
              $9::integer, $10::integer, $11::integer,
              $12::bigint, $13::numeric(14,4),
              $14::bigint, 0, $15::bigint, $16::jsonb
            );`,
            [
              session.organizationId,
              runId,
              calendarDays,
              emp.employee_id,
              emp.salary_id,
              approvedMins,
              pendingMins,
              unpaidDays,
              approvedDays,
              lateCount,
              earlyCount,
              salaryPaise,
              previewCalc.hourlyRatePaise,
              previewCalc.grossEarnedPaise,
              previewCalc.netPayablePaise,
              JSON.stringify(dual),
            ]
          );
        }

        await client.query(
          `UPDATE public.payroll_runs
           SET total_employees = $3::integer,
               total_payable_minutes = $4::bigint,
               total_gross_paise = $5::bigint,
               total_net_paise = $6::bigint
           WHERE organization_id = $1::uuid AND id = $2::uuid;`,
          [
            session.organizationId,
            runId,
            empsRes.rows.length,
            totalPayableMinutes,
            totalGrossPaise,
            totalNetPaise,
          ]
        );

        await client.query(
          `INSERT INTO public.audit_logs (
            organization_id, actor_user_id, actor_role, action, entity_type, entity_id, summary
          ) VALUES ($1::uuid, $2::uuid, 'ADMIN', 'PAYROLL_DRAFT_PREPARED', 'PAYROLL', $3::uuid, $4::text);`,
          [
            session.organizationId,
            session.authUserId,
            runId,
            `Prepared ${monthStr} payroll draft (${empsRes.rows.length} employees, awaiting PO formula confirmation before payslip generation).`,
          ]
        );

        return await fetchMappedPayrollForMonth(client, session.organizationId, monthStr);
      },
      session.authUserId
    );

    res.status(200).json({
      success: true,
      data: { ...prepared, updated: true },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/payroll/adjustments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const payrollItemId = String(body['payrollItemId'] ?? '').trim();
    const adjustmentType = String(body['adjustmentType'] ?? 'ADDITION').trim().toUpperCase();
    const amountInr = Number(body['amountInr']);
    const reason = String(body['reason'] ?? '').trim();

    if (!payrollItemId || !['ADDITION', 'DEDUCTION', 'REVERSAL'].includes(adjustmentType)) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'Valid payrollItemId and adjustmentType required.');
    }
    if (!Number.isFinite(amountInr) || amountInr <= 0) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'Adjustment amount must be greater than zero.');
    }
    if (reason.length < 5) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'Adjustment audit reason (min 5 chars) required.');
    }

    await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const itemRes = await client.query<{
          id: string;
          payroll_run_id: string;
          employee_id: string;
          gross_earned_paise: string;
          adjustments_paise: string;
          run_status: string;
        }>(
          `SELECT pi.id, pi.payroll_run_id, pi.employee_id, pi.gross_earned_paise::TEXT,
                  pi.adjustments_paise::TEXT, pr.status AS run_status
           FROM public.payroll_items pi
           JOIN public.payroll_runs pr ON pr.id = pi.payroll_run_id
           WHERE pi.organization_id = $1::uuid AND pi.id = $2::uuid LIMIT 1;`,
          [session.organizationId, payrollItemId]
        );
        const item = itemRes.rows[0];
        if (!item) throw new AppError(404, ApiErrorCode.NOT_FOUND, 'Payroll line item not found.');
        if (item.run_status === 'APPROVED' || item.run_status === 'PROCESSED') {
          throw new AppError(409, ApiErrorCode.CONFLICT, 'Cannot modify finalized payroll items.');
        }

        const amountPaise = Math.round(amountInr * 100);
        const signedDelta = adjustmentType === 'DEDUCTION' ? -amountPaise : amountPaise;
        const nextAdj = Number(item.adjustments_paise) + signedDelta;
        const nextNet = Math.max(0, Number(item.gross_earned_paise) + nextAdj);

        await client.query(
          `INSERT INTO public.payroll_adjustments (
            organization_id, payroll_run_id, payroll_item_id, employee_id,
            adjustment_type, amount_paise, reason, created_by
          ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::varchar, $6::bigint, $7::text, $8::uuid);`,
          [
            session.organizationId,
            item.payroll_run_id,
            item.id,
            item.employee_id,
            adjustmentType,
            amountPaise,
            reason,
            session.authUserId,
          ]
        );

        await client.query(
          `UPDATE public.payroll_items
           SET adjustments_paise = $3::bigint, net_payable_paise = $4::bigint
           WHERE organization_id = $1::uuid AND id = $2::uuid;`,
          [session.organizationId, item.id, nextAdj, nextNet]
        );
      },
      session.authUserId
    );
    res.status(200).json({ success: true, data: { updated: true }, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/payroll/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const monthStr = String(body['month'] ?? '').trim();
    const formulaMode = String(body['confirmFormulaMode'] ?? body['formulaMode'] ?? '').trim();
    const poConfirmed = body['confirmPoFormulaApproval'] === true;

    if (
      !poConfirmed ||
      (formulaMode !== 'CALENDAR_DAYS_X_8H_PAID_LUNCH' && formulaMode !== 'SCHEDULED_DAYS_X_7H_NET')
    ) {
      throw new AppError(
        409,
        ApiErrorCode.PAYROLL_FORMULA_NOT_APPROVED,
        'Final payroll approval requires explicit Product Owner / Admin confirmation of the hourly wage formula (CALENDAR_DAYS_X_8H_PAID_LUNCH vs SCHEDULED_DAYS_X_7H_NET). Draft previews remain inspectable without issuing payslips.'
      );
    }

    const { year, month, calendarDays, workingDaysMonSat } = getMonthDateRange(monthStr);

    await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const runRes = await client.query<{ id: string; status: string }>(
          `SELECT pr.id, pr.status
           FROM public.payroll_runs pr
           JOIN public.payroll_periods pp ON pp.id = pr.payroll_period_id
           WHERE pr.organization_id = $1::uuid AND pp.year = $2 AND pp.month = $3
             AND pr.status IN ('PENDING_FORMULA_APPROVAL', 'DRAFT', 'REVIEWED')
           ORDER BY pr.run_number DESC LIMIT 1;`,
          [session.organizationId, year, month]
        );
        const run = runRes.rows[0];
        if (!run) {
          throw new AppError(404, ApiErrorCode.NOT_FOUND, `No draft payroll run found for ${monthStr}.`);
        }

        const itemsRes = await client.query<{
          id: string;
          employee_id: string;
          employee_code: string;
          user_id: string;
          approved_payable_minutes: number;
          salary_reference_paise: string;
          adjustments_paise: string;
          calculation_snapshot: Record<string, unknown>;
        }>(
          `SELECT pi.id, pi.employee_id, e.employee_code, e.user_id,
                  pi.approved_payable_minutes, pi.salary_reference_paise::TEXT,
                  pi.adjustments_paise::TEXT, pi.calculation_snapshot
           FROM public.payroll_items pi
           JOIN public.employees e ON e.id = pi.employee_id AND e.organization_id = pi.organization_id
           WHERE pi.organization_id = $1::uuid AND pi.payroll_run_id = $2::uuid;`,
          [session.organizationId, run.id]
        );

        let totalGrossPaise = 0;
        let totalNetPaise = 0;

        for (const it of itemsRes.rows) {
          const adjPaise = Number(it.adjustments_paise);
          const dual = calculateDualPayrollComparison({
            monthlySalaryPaise: Number(it.salary_reference_paise),
            approvedPayableMinutes: it.approved_payable_minutes,
            calendarDays,
            workingDaysMonSat,
            adjustmentsPaise: adjPaise,
          });
          const finalCalc = dual.computeForMode(formulaMode as FormulaMode);
          totalGrossPaise += finalCalc.grossEarnedPaise;
          totalNetPaise += finalCalc.netPayablePaise;

          await client.query(
            `UPDATE public.payroll_items
             SET derived_hourly_rate_paise = $3::numeric(14,4),
                 gross_earned_paise = $4::bigint,
                 net_payable_paise = $5::bigint,
                 calculation_snapshot = $6::jsonb
             WHERE organization_id = $1::uuid AND id = $2::uuid;`,
            [
              session.organizationId,
              it.id,
              finalCalc.hourlyRatePaise,
              finalCalc.grossEarnedPaise,
              finalCalc.netPayablePaise,
              JSON.stringify({ ...dual, confirmedFormulaMode: formulaMode }),
            ]
          );
        }

        // Approve payroll_runs (satisfies chk_payroll_approval_requires_formula & payslip trigger!)
        await client.query(
          `UPDATE public.payroll_runs
           SET formula_mode = $3::varchar,
               formula_approved = TRUE,
               formula_approved_by = $4::uuid,
               formula_approved_at = NOW(),
               status = 'APPROVED',
               total_gross_paise = $5::bigint,
               total_net_paise = $6::bigint,
               approved_by = $4::uuid,
               approved_at = NOW()
           WHERE organization_id = $1::uuid AND id = $2::uuid;`,
          [session.organizationId, run.id, formulaMode, session.authUserId, totalGrossPaise, totalNetPaise]
        );

        // Issue immutable payslips & initialize separate payment_records (PENDING)
        const updatedItems = await client.query<{
          id: string;
          employee_id: string;
          employee_code: string;
          user_id: string;
          approved_payable_minutes: number;
          gross_earned_paise: string;
          adjustments_paise: string;
          net_payable_paise: string;
          calculation_snapshot: Record<string, unknown>;
        }>(
          `SELECT pi.id, pi.employee_id, e.employee_code, e.user_id,
                  pi.approved_payable_minutes, pi.gross_earned_paise::TEXT,
                  pi.adjustments_paise::TEXT, pi.net_payable_paise::TEXT, pi.calculation_snapshot
           FROM public.payroll_items pi
           JOIN public.employees e ON e.id = pi.employee_id AND e.organization_id = pi.organization_id
           WHERE pi.organization_id = $1::uuid AND pi.payroll_run_id = $2::uuid;`,
          [session.organizationId, run.id]
        );

        for (const it of updatedItems.rows) {
          const payslipNumber = `PS-${monthStr.replace('-', '')}-${it.employee_code}`;
          const psIns = await client.query<{ id: string }>(
            `INSERT INTO public.payslips (
              organization_id, payroll_run_id, payroll_item_id, employee_id,
              year, month, payslip_number, approved_payable_minutes,
              gross_paise, adjustments_paise, net_paise, snapshot_json, issued_by
            ) VALUES (
              $1::uuid, $2::uuid, $3::uuid, $4::uuid,
              $5::integer, $6::integer, $7::varchar, $8::integer,
              $9::bigint, $10::bigint, $11::bigint, $12::jsonb, $13::uuid
            )
            RETURNING id;`,
            [
              session.organizationId,
              run.id,
              it.id,
              it.employee_id,
              year,
              month,
              payslipNumber,
              it.approved_payable_minutes,
              Number(it.gross_earned_paise),
              Number(it.adjustments_paise),
              Number(it.net_payable_paise),
              JSON.stringify(it.calculation_snapshot),
              session.authUserId,
            ]
          );

          await client.query(
            `INSERT INTO public.payment_records (
              organization_id, payroll_run_id, payroll_item_id, payslip_id, employee_id,
              amount_paise, status, recorded_by
            ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::bigint, 'PENDING', $7::uuid);`,
            [
              session.organizationId,
              run.id,
              it.id,
              psIns.rows[0]!.id,
              it.employee_id,
              Number(it.net_payable_paise),
              session.authUserId,
            ]
          );

          await client.query(
            `INSERT INTO public.notifications (
              organization_id, recipient_user_id, category, title, message, entity_type, entity_id
            ) VALUES ($1::uuid, $2::uuid, 'PAYSLIP', $3::varchar, $4::text, 'PAYROLL', $5::uuid);`,
            [
              session.organizationId,
              it.user_id,
              `Payslip Issued (${monthStr})`,
              `Your approved payslip ${payslipNumber} for ${monthStr} is now ready to view/download.`,
              psIns.rows[0]!.id,
            ]
          );
        }

        await client.query(
          `INSERT INTO public.audit_logs (
            organization_id, actor_user_id, actor_role, action, entity_type, entity_id, summary
          ) VALUES ($1::uuid, $2::uuid, 'ADMIN', 'PAYROLL_APPROVED_AND_PAYSLIPS_ISSUED', 'PAYROLL', $3::uuid, $4::text);`,
          [
            session.organizationId,
            session.authUserId,
            run.id,
            `Approved ${monthStr} payroll with confirmed formula ${formulaMode} and issued ${updatedItems.rows.length} payslips.`,
          ]
        );
      },
      session.authUserId
    );

    res.status(200).json({ success: true, data: { updated: true }, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
});

async function handlePaymentStatusUpdate(req: Request, res: Response, next: NextFunction) {
  try {
    const session = req.hrmsUser!;
    const employeeId = String(req.params['employeeId'] ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const monthStr = String(body['month'] ?? '').trim();
    const rawStatus = String(body['paymentStatus'] ?? '').trim().toUpperCase();
    const paymentReference = body['paymentReference'] ? String(body['paymentReference']).trim() : null;

    if (!['PENDING', 'PAID', 'FAILED'].includes(rawStatus)) {
      throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'paymentStatus must be Pending, Paid, or Failed.');
    }

    const { year, month } = getMonthDateRange(monthStr);

    await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const payRes = await client.query<{ id: string }>(
          `SELECT prrec.id
           FROM public.payment_records prrec
           JOIN public.payslips ps ON ps.id = prrec.payslip_id
           WHERE prrec.organization_id = $1::uuid
             AND prrec.employee_id = $2::uuid
             AND ps.year = $3 AND ps.month = $4
           LIMIT 1;`,
          [session.organizationId, employeeId, year, month]
        );
        const rec = payRes.rows[0];
        if (!rec) {
          throw new AppError(
            409,
            ApiErrorCode.CONFLICT,
            'Payment tracking unlocks strictly after final payroll approval and payslip generation.'
          );
        }

        await client.query(
          `UPDATE public.payment_records
           SET status = $3::varchar,
               payment_reference = COALESCE($4::varchar, payment_reference),
               paid_at = CASE WHEN $3 = 'PAID' THEN NOW() ELSE NULL END,
               recorded_by = $5::uuid
           WHERE organization_id = $1::uuid AND id = $2::uuid;`,
          [session.organizationId, rec.id, rawStatus, paymentReference, session.authUserId]
        );
      },
      session.authUserId
    );
    res.status(200).json({ success: true, data: { updated: true }, meta: { timestamp: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
}

adminRouter.patch('/payroll/:employeeId/payment-status', handlePaymentStatusUpdate);
adminRouter.post('/payroll/:employeeId/payment-status', handlePaymentStatusUpdate);

/**
 * GET /api/v1/admin/reports?month=YYYY-MM
 */
adminRouter.get('/reports', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const monthStr =
      typeof req.query['month'] === 'string' && req.query['month'].trim()
        ? req.query['month'].trim()
        : toIstDateAndHHMM().dateStr.slice(0, 7);
    const { startDate, endDate } = getMonthDateRange(monthStr);

    const report = await withTenantTransaction(
      session.organizationId,
      async (client) => {
        const [employees, attendance, leaves, sessions, visits, payroll] = await Promise.all([
          fetchMappedEmployees(client, session.organizationId),
          fetchMappedAttendanceRecords(client, session.organizationId, {
            dateFrom: startDate,
            dateTo: endDate,
            limit: 500,
          }),
          fetchMappedLeaves(client, session.organizationId),
          fetchMappedFieldSessions(client, session.organizationId),
          fetchMappedCustomerVisits(client, session.organizationId),
          fetchMappedPayrollForMonth(client, session.organizationId, monthStr),
        ]);

        const approvedLeaveDays = leaves
          .filter((l) => l.status === 'APPROVED' && l.startDate <= endDate && l.endDate >= startDate)
          .reduce((acc, l) => acc + l.totalDays, 0);

        return {
          month: monthStr,
          employeeCount: employees.length,
          totalAttendanceRecords: attendance.length,
          pendingExceptionsCount: attendance.filter(
            (a) => a.approvalStatus === 'PENDING_ADMIN_REVIEW' || a.approvalStatus === 'VERIFICATION_PENDING'
          ).length,
          totalApprovedMinutes: attendance.reduce((acc, a) => acc + a.approvedPayableMinutes, 0),
          approvedLeaveDays,
          fieldSessionsCount: sessions.filter((s) => s.date >= startDate && s.date <= endDate).length,
          completedVisitsCount: visits.filter(
            (v) => (v.completedAt ?? '').slice(0, 10) >= startDate && (v.completedAt ?? '').slice(0, 10) <= endDate
          ).length,
          payrollTotalNetInr: payroll.items.reduce((acc, p) => acc + p.netSalary, 0),
        };
      },
      session.authUserId
    );

    res.status(200).json({
      success: true,
      data: { report },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/admin/audit-logs
 */
adminRouter.get('/audit-logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await loadSettingsPayload(req.hrmsUser!);
    res.status(200).json({
      success: true,
      data: { auditLogs: data.auditLogs, locationHistory: data.locationHistory },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});
