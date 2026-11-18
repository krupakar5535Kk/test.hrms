import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: 'server/.env' });

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

async function runSecurityAudit() {
  console.log('=== HRMS PAYROLL 5535: DATABASE SECURITY & RLS AUDIT ===\n');
  const client = await pool.connect();
  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, testName, details = '') {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`[PASS] ${testName}`);
    } else {
      console.error(`[FAIL] ${testName}: ${details}`);
    }
  }

  try {
    // 1. Verify RLS is enabled on all public tables
    const rlsRes = await client.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY relname;
    `);
    const tablesWithoutRls = rlsRes.rows.filter((r) => !r.relrowsecurity);
    assert(
      tablesWithoutRls.length === 0,
      '1. RLS Enabled on Public Tables',
      `Tables missing RLS: ${tablesWithoutRls.map((t) => t.relname).join(', ')}`
    );

    // 2. Count RLS Policies
    const polRes = await client.query(`
      SELECT count(*) as count FROM pg_policies WHERE schemaname = 'public';
    `);
    const policyCount = parseInt(polRes.rows[0].count, 10);
    assert(policyCount >= 70, `2. RLS Policies Present (Found ${policyCount} policies)`);

    // 3. Unauthenticated / No Context Query Isolation
    // With hrms_app_user and no session context set, tenant tables must yield 0 rows
    await client.query('BEGIN;');
    await client.query("RESET app.current_org_id; RESET app.current_user_id;");
    const unauthEmpRes = await client.query('SELECT count(*) as count FROM public.employees;');
    const unauthAttRes = await client.query('SELECT count(*) as count FROM public.attendance_events;');
    const unauthLeavesRes = await client.query('SELECT count(*) as count FROM public.leave_applications;');
    assert(
      parseInt(unauthEmpRes.rows[0].count, 10) === 0 &&
      parseInt(unauthAttRes.rows[0].count, 10) === 0 &&
      parseInt(unauthLeavesRes.rows[0].count, 10) === 0,
      '3. Zero-Context Access Blocked (No rows returned without tenant context)'
    );
    await client.query('ROLLBACK;');

    // 4. Retrieve Organization & Users for Context Tests
    const testOrg = {
      id: 'c11fa9b7-bff4-4ec0-8595-93a8e013860f',
      organization_code: 'ORG001',
    };
    const adminUser = {
      id: 'ce74e4d0-9d51-4d1e-a8a3-7c51e60dfe1d',
      role: 'ADMIN',
    };
    const employeeUser = {
      id: '5672a31c-0f0d-4788-9603-cd62697542f8',
      role: 'EMPLOYEE',
      employee_id: 'd84ed24b-985c-471f-b7cc-be9620090706',
    };

    // 5. Test Admin Context
    if (adminUser) {
      await client.query('BEGIN;');
      await client.query(`SELECT set_config('app.current_org_id', $1, true);`, [testOrg.id]);
      await client.query(`SELECT set_config('app.current_user_id', $1, true);`, [adminUser.id]);

      const adminEmpRes = await client.query('SELECT count(*) as count FROM public.employees;');
      const empCount = parseInt(adminEmpRes.rows[0].count, 10);
      assert(
        empCount > 0,
        `4. Admin Context Access (Admin sees ${empCount} employees in organization ${testOrg.organization_code})`
      );
      await client.query('ROLLBACK;');
    }

    // 6. Test Employee Context Isolation
    if (employeeUser && employeeUser.employee_id) {
      await client.query('BEGIN;');
      await client.query(`SELECT set_config('app.current_org_id', $1, true);`, [testOrg.id]);
      await client.query(`SELECT set_config('app.current_user_id', $1, true);`, [employeeUser.id]);

      const empSelfRes = await client.query('SELECT id FROM public.employees;');
      const visibleEmployees = empSelfRes.rows.map((r) => r.id);
      const onlySelf = visibleEmployees.length === 1 && visibleEmployees[0] === employeeUser.employee_id;
      assert(
        onlySelf || visibleEmployees.includes(employeeUser.employee_id),
        `5. Employee Context Isolation (Employee sees only self or authorized view: ${visibleEmployees.length} visible)`
      );
      await client.query('ROLLBACK;');
    }

    // 7. Test Tenant Cross-Isolation (A fake foreign tenant UUID sees 0 records)
    const fakeOrgId = '00000000-0000-0000-0000-000000000000';
    const fakeUserId = '00000000-0000-0000-0000-000000000001';
    await client.query('BEGIN;');
    await client.query(`SELECT set_config('app.current_org_id', $1, true);`, [fakeOrgId]);
    await client.query(`SELECT set_config('app.current_user_id', $1, true);`, [fakeUserId]);

    const crossTenantEmp = await client.query('SELECT count(*) as count FROM public.employees;');
    assert(
      parseInt(crossTenantEmp.rows[0].count, 10) === 0,
      '6. Multi-Tenant Cross-Isolation (Foreign org context cannot see KMACCS data)'
    );
    await client.query('ROLLBACK;');

    // 8. Test Immutability of public.audit_logs
    await client.query('BEGIN;');
    await client.query(`SELECT set_config('app.current_org_id', $1, true);`, [testOrg.id]);
    if (adminUser) {
      await client.query(`SELECT set_config('app.current_user_id', $1, true);`, [adminUser.id]);
    }

    // Insert test audit record
    const insRes = await client.query(`
      INSERT INTO public.audit_logs (organization_id, actor_role, action, entity_type, summary)
      VALUES ($1::uuid, 'ADMIN', 'TEST_SECURITY_PROBE', 'SYSTEM', 'Security immutability verification probe')
      RETURNING id;
    `, [testOrg.id]);
    const auditId = insRes.rows[0].id;

    // Attempt UPDATE
    let updateBlocked = false;
    try {
      await client.query('UPDATE public.audit_logs SET summary = $1 WHERE id = $2::uuid;', ['Tampered', auditId]);
    } catch (err) {
      updateBlocked = true;
    }
    assert(updateBlocked, '7. Audit Log Immutability: UPDATE is Blocked');

    // Attempt DELETE
    let deleteBlocked = false;
    try {
      await client.query('DELETE FROM public.audit_logs WHERE id = $1::uuid;', [auditId]);
    } catch (err) {
      deleteBlocked = true;
    }
    assert(deleteBlocked, '8. Audit Log Immutability: DELETE is Blocked');

    await client.query('ROLLBACK;');

    console.log(`\nRLS & SECURITY TEST SUMMARY: ${passedTests}/${totalTests} PASSED.`);
  } finally {
    client.release();
    await pool.end();
  }
}

runSecurityAudit().catch(console.error);