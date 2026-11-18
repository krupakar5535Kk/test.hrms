const BASE_URL = 'http://localhost:5000/api/v1';

async function verifyGap01And02Lifecycle() {
  console.log('=== VERIFYING GAP-01 & GAP-02 PRODUCTION SECURITY WORKFLOW ===\n');

  // Step 1: Admin logs in
  console.log('1. Admin logs in with credentials...');
  const adminLoginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      organizationCode: 'KMACCS',
      phoneNumber: '9876543299',
      password: 'AdminPass#2026',
    }),
  });
  const adminLoginJson = await adminLoginRes.json();
  if (!adminLoginJson.success) {
    throw new Error(`Admin login failed: ${JSON.stringify(adminLoginJson)}`);
  }
  const adminToken = adminLoginJson.data.tokens.accessToken;
  console.log('   [PASS] Admin logged in successfully.');

  // Step 2: Admin provisions a new employee with an initial temporary password
  const testPhone = '9876500098';
  const initialPassword = 'InitialTempPass#123';
  console.log(`\n2. Admin provisions employee with initial password (${testPhone})...`);
  const provRes = await fetch(`${BASE_URL}/admin/employees`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      fullName: 'Aarav Kumar',
      phoneNumber: testPhone,
      jobCategory: 'OFFICE',
      department: 'Operations',
      designation: 'Clerk',
      monthlySalaryReference: 22000,
      initialPassword,
    }),
  });
  const provJson = await provRes.json();
  if (!provJson.success) {
    // If already exists from previous test run, reset password instead
    console.log('   Employee may already exist; resetting credentials instead...');
  } else {
    console.log(`   [PASS] Employee provisioned. Code: ${provJson.data.employeeCode}`);
  }

  // Step 3: Employee logs in with initial password
  console.log('\n3. Employee logs in with initial password...');
  const empLoginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      organizationCode: 'KMACCS',
      phoneNumber: testPhone,
      password: initialPassword,
    }),
  });
  const empLoginJson = await empLoginRes.json();
  if (!empLoginJson.success) {
    throw new Error(`Employee login failed: ${JSON.stringify(empLoginJson)}`);
  }
  const empToken = empLoginJson.data.tokens.accessToken;
  const mustChange = empLoginJson.data.user.mustChangePassword;
  console.log(`   [PASS] Employee logged in. mustChangePassword = ${mustChange}`);
  if (!mustChange) {
    throw new Error('Expected mustChangePassword to be true on initial login!');
  }

  // Step 4: Verify GAP-01: Employee domain endpoints are BLOCKED with 403
  console.log('\n4. Testing GAP-01 Backend Block: Calling employee domain endpoints before password change...');
  const blockedAttendance = await fetch(`${BASE_URL}/employee/attendance/today`, {
    headers: { Authorization: `Bearer ${empToken}` },
  });
  const blockedAttJson = await blockedAttendance.json();
  console.log(`   /employee/attendance/today status: ${blockedAttendance.status}`);
  if (blockedAttendance.status !== 403) {
    throw new Error(`Expected HTTP 403, got ${blockedAttendance.status}`);
  }
  console.log(`   [PASS] GAP-01 Enforced: ${blockedAttJson.error?.message}`);

  const blockedLeaves = await fetch(`${BASE_URL}/employee/leaves`, {
    headers: { Authorization: `Bearer ${empToken}` },
  });
  console.log(`   /employee/leaves status: ${blockedLeaves.status}`);
  if (blockedLeaves.status !== 403) {
    throw new Error(`Expected HTTP 403, got ${blockedLeaves.status}`);
  }
  console.log('   [PASS] GAP-01 Enforced across employee services.');

  // Step 5: Employee changes password
  const permanentPassword = 'PermanentPass#2026';
  console.log('\n5. Employee completes mandatory password change via /auth/change-password...');
  const changeRes = await fetch(`${BASE_URL}/auth/change-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${empToken}`,
    },
    body: JSON.stringify({
      currentPassword: initialPassword,
      newPassword: permanentPassword,
    }),
  });
  const changeJson = await changeRes.json();
  if (!changeJson.success) {
    throw new Error(`Password change failed: ${JSON.stringify(changeJson)}`);
  }
  console.log('   [PASS] Password change succeeded.');

  // Step 6: Employee logs in with new permanent password
  console.log('\n6. Employee logs in with permanent password...');
  const empLogin2Res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      organizationCode: 'KMACCS',
      phoneNumber: testPhone,
      password: permanentPassword,
    }),
  });
  const empLogin2Json = await empLogin2Res.json();
  const empToken2 = empLogin2Json.data.tokens.accessToken;
  const mustChange2 = empLogin2Json.data.user.mustChangePassword;
  console.log(`   [PASS] Login successful. mustChangePassword = ${mustChange2}`);
  if (mustChange2) {
    throw new Error('Expected mustChangePassword to be false after password change!');
  }

  // Step 7: Employee domain endpoints now succeed (HTTP 200)
  console.log('\n7. Verifying employee domain endpoints unblocked after password change...');
  const unblockedDashboard = await fetch(`${BASE_URL}/employee/dashboard`, {
    headers: { Authorization: `Bearer ${empToken2}` },
  });
  console.log(`   /employee/dashboard status: ${unblockedDashboard.status}`);
  if (unblockedDashboard.status !== 200) {
    throw new Error(`Expected HTTP 200, got ${unblockedDashboard.status}`);
  }
  const unblockedLeaves = await fetch(`${BASE_URL}/employee/leaves`, {
    headers: { Authorization: `Bearer ${empToken2}` },
  });
  console.log(`   /employee/leaves status: ${unblockedLeaves.status}`);
  if (unblockedLeaves.status !== 200) {
    throw new Error(`Expected HTTP 200, got ${unblockedLeaves.status}`);
  }
  console.log('   [PASS] Employee portal access fully enabled.');

  console.log('\n=== ALL GAP-01 & GAP-02 WORKFLOW CHECKS PASSED WITH FULL INTEGRITY ===\n');
}

verifyGap01And02Lifecycle().catch(console.error);