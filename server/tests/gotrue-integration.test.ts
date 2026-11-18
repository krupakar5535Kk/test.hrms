/**
 * GoTrue Integration Tests (Task 2.2C — Step 1)
 *
 * Verifies all 9 GoTrue behaviors required by PO-06 against the live local
 * Supabase Auth instance. These tests call the GoTrue HTTP API directly using
 * fetch(); the Supabase JS SDK is intentionally NOT used here so that exact
 * HTTP status codes and payloads are observable.
 *
 * Requirements:
 *   - Local Supabase must be running (supabase start)
 *   - server/.env must contain real (non-placeholder) SUPABASE_SERVICE_ROLE_KEY
 *   - GoTrue config must have: enable_signup=false, jwt_expiry=900,
 *     minimum_password_length=8
 *
 * Run: npx tsx --test server/tests/gotrue-integration.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// ── Load environment ─────────────────────────────────────────────────────────
// Support execution from both monorepo root and server workspace
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envCandidates = [
  path.resolve(__dirname, '../.env'),
  path.resolve(process.cwd(), 'server/.env'),
  path.resolve(process.cwd(), '.env'),
];
for (const candidate of envCandidates) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321';
const GOTRUE_URL = `${SUPABASE_URL}/auth/v1`;

// SERVICE_ROLE_KEY is read lazily inside functions so it reflects the
// value AFTER dotenv.config() runs (avoids module-initialization order issues).
function getServiceRoleKey(): string {
  return process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';
}

function getAnonKey(): string {
  return process.env['SUPABASE_ANON_KEY'] ?? '';
}

// ── Guard: fail fast if service role key is a known placeholder ───────────────
function assertRealServiceRoleKey(): void {
  const key = getServiceRoleKey();
  const placeholders = ['service-role-placeholder', 'placeholder_service_role'];
  const isPlaceholder =
    !key ||
    key.length < 100 ||
    placeholders.some((p) => key.includes(p));
  if (isPlaceholder) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is missing or is a placeholder. ' +
        'Run `supabase status` and populate server/.env with the real service_role key.'
    );
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
const adminHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${getServiceRoleKey()}`,
  apikey: getServiceRoleKey(),
});

async function gotruePost(path: string, body: unknown, token?: string): Promise<Response> {
  // For client-facing endpoints (token exchange, signup, logout) use the anon
  // key as apikey. If a bearer token is provided, attach it as Authorization.
  const apikey = getAnonKey();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey,
    Authorization: `Bearer ${token ?? apikey}`,
  };
  return fetch(`${GOTRUE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function adminCreateUser(
  email: string,
  password: string,
  extraBody: Record<string, unknown> = {}
): Promise<Response> {
  return fetch(`${GOTRUE_URL}/admin/users`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ email, password, email_confirm: true, ...extraBody }),
  });
}

async function adminDeleteUser(userId: string): Promise<void> {
  const res = await fetch(`${GOTRUE_URL}/admin/users/${userId}`, {
    method: 'DELETE',
    headers: adminHeaders(),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete test user ${userId}: HTTP ${res.status}`);
  }
}

async function signInWithPassword(email: string, password: string): Promise<Response> {
  return fetch(`${GOTRUE_URL}/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: getAnonKey(),
      Authorization: `Bearer ${getAnonKey()}`,
    },
    body: JSON.stringify({ email, password }),
  });
}

// ── Shared test state for cleanup ────────────────────────────────────────────
const testUserIds: string[] = [];
let emailSequence = 0;

function uniqueTestEmail(tag: string): string {
  emailSequence += 1;
  return `hrms-gotrue-test-${tag}-${Date.now()}-${emailSequence}@test.invalid`;
}

// ── Test Suite ────────────────────────────────────────────────────────────────
describe('GoTrue Integration — Task 2.2C Step 1', () => {
  before(() => {
    assertRealServiceRoleKey();
  });

  after(async () => {
    // Clean up all test users created during this run
    const cleanupResults = await Promise.allSettled(
      testUserIds.map((id) => adminDeleteUser(id))
    );
    const failed = cleanupResults.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      console.warn(`[cleanup] ${failed.length} test user(s) could not be deleted — manual cleanup may be needed`);
    } else {
      console.log(`[cleanup] ${testUserIds.length} test user(s) deleted`);
    }
  });

  // ── Test 1: Public signup is disabled ───────────────────────────────────────
  it('T1: POST /signup returns 422 — public signup is disabled', async () => {
    const email = uniqueTestEmail('t1-signup');
    const res = await gotruePost('/signup', {
      email,
      password: 'ValidPass1!',
    });

    // GoTrue returns 422 Unprocessable Entity when signup is disabled
    assert.equal(
      res.status,
      422,
      `Expected 422 (signup disabled) but got ${res.status}. ` +
        `Ensure enable_signup=false in config.toml and GoTrue was restarted.`
    );
    const body = await res.json() as Record<string, unknown>;
    // Error message should indicate signup is disabled
    const msg = String(body['msg'] ?? body['message'] ?? '').toLowerCase();
    assert.ok(
      msg.includes('signup') || msg.includes('disabled') || body['code'] === 'signup_disabled',
      `Expected signup-disabled error message, got: ${JSON.stringify(body)}`
    );
    console.log('T1 PASS: Public signup correctly rejected (disable_signup=true)');
  });

  // ── Test 2: Admin can create a user (bypasses disable_signup) ────────────────
  it('T2: POST /admin/users creates user — Admin API bypasses disable_signup', async () => {
    const email = uniqueTestEmail('t2-admin-create');
    const res = await adminCreateUser(email, 'ValidPass8!');
    assert.equal(res.status, 200, `Expected 200 from admin user creation, got ${res.status}`);
    const body = await res.json() as Record<string, unknown>;
    assert.ok(body['id'], `Expected user id in response, got: ${JSON.stringify(body)}`);
    testUserIds.push(body['id'] as string);
    console.log('T2 PASS: Admin-created user, id:', body['id']);
  });

  // ── Test 3: Access token exp - iat === 900 (15 minutes) ──────────────────────
  it('T3: Access token lifetime is 900 seconds (jwt_expiry=900)', async () => {
    const email = uniqueTestEmail('t3-jwt-expiry');
    const createRes = await adminCreateUser(email, 'ValidPass8!');
    assert.equal(createRes.status, 200);
    const createBody = await createRes.json() as Record<string, unknown>;
    testUserIds.push(createBody['id'] as string);

    const signInRes = await signInWithPassword(email, 'ValidPass8!');
    assert.equal(signInRes.status, 200, `Sign-in failed: ${signInRes.status}`);
    const tokenBody = await signInRes.json() as Record<string, unknown>;
    const accessToken = tokenBody['access_token'] as string;
    assert.ok(accessToken, 'Expected access_token in response');

    // Decode JWT payload (no signature verification needed here — we just check claims)
    const [, payloadB64] = accessToken.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      exp: number;
      iat: number;
    };

    const lifetime = payload.exp - payload.iat;
    assert.equal(
      lifetime,
      900,
      `Expected token lifetime of 900s, got ${lifetime}s. ` +
        `Check jwt_expiry=900 in config.toml and that GoTrue was restarted.`
    );
    console.log(`T3 PASS: Access token lifetime = ${lifetime}s (jwt_expiry=900)`);
  });

  // ── Test 4: 7-character password is rejected ─────────────────────────────────
  it('T4: Admin user creation with 7-char password returns 422 — minimum_password_length=8', async () => {
    const email = uniqueTestEmail('t4-weak-pw');
    const res = await adminCreateUser(email, 'Short7!'); // exactly 7 chars
    // GoTrue returns 422 for weak password
    assert.equal(
      res.status,
      422,
      `Expected 422 (weak password) for 7-char password, got ${res.status}`
    );
    const body = await res.json() as Record<string, unknown>;
    const msg = String(body['msg'] ?? body['message'] ?? body['error_description'] ?? '').toLowerCase();
    assert.ok(
      msg.includes('password') || msg.includes('weak') || body['error_code'] === 'weak_password',
      `Expected weak_password error, got: ${JSON.stringify(body)}`
    );
    console.log('T4 PASS: 7-char password correctly rejected (minimum_password_length=8)');
  });

  // ── Test 5: 8-character password is accepted ─────────────────────────────────
  it('T5: Admin user creation with 8-char password succeeds — minimum_password_length=8', async () => {
    const email = uniqueTestEmail('t5-min-pw');
    const res = await adminCreateUser(email, 'Exactly8'); // exactly 8 chars
    assert.equal(
      res.status,
      200,
      `Expected 200 for 8-char password, got ${res.status}: ${await res.clone().text()}`
    );
    const body = await res.json() as Record<string, unknown>;
    assert.ok(body['id'], 'Expected user id');
    testUserIds.push(body['id'] as string);
    console.log('T5 PASS: 8-char password accepted (minimum_password_length=8)');
  });

  // ── Test 6: Admin updateUser with password + app_metadata atomically ─────────
  it('T6: PUT /admin/users/{id} with password + app_metadata succeeds atomically', async () => {
    const email = uniqueTestEmail('t6-update');
    const createRes = await adminCreateUser(email, 'InitPass8!');
    assert.equal(createRes.status, 200);
    const createBody = await createRes.json() as Record<string, unknown>;
    const userId = createBody['id'] as string;
    testUserIds.push(userId);

    const opId = `op-${Date.now()}`;
    const updateRes = await fetch(`${GOTRUE_URL}/admin/users/${userId}`, {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({
        password: 'NewPass8!',
        app_metadata: { hrms_activation_op_id: opId, hrms_role: 'EMPLOYEE' },
      }),
    });
    assert.equal(updateRes.status, 200, `Admin user update failed: ${updateRes.status}`);
    const updateBody = await updateRes.json() as Record<string, unknown>;
    const appMeta = updateBody['app_metadata'] as Record<string, unknown>;
    assert.ok(appMeta, 'Expected app_metadata in response');
    assert.equal(
      appMeta['hrms_activation_op_id'],
      opId,
      `Expected hrms_activation_op_id="${opId}" in app_metadata`
    );
    assert.equal(appMeta['hrms_role'], 'EMPLOYEE', 'Expected hrms_role="EMPLOYEE" in app_metadata');

    // Verify new password works and old password no longer works
    const newSignInRes = await signInWithPassword(email, 'NewPass8!');
    assert.equal(newSignInRes.status, 200, 'Sign-in with updated password must succeed');
    const oldSignInRes = await signInWithPassword(email, 'InitPass8!');
    assert.equal(oldSignInRes.status, 400, 'Sign-in with old password must fail');

    // Also verify @supabase/supabase-js admin.updateUserById works cleanly
    const supabaseAdmin = createClient(SUPABASE_URL, getServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const sdkOpId = `op-sdk-${Date.now()}`;
    const { data: sdkData, error: sdkErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: 'SdkPass8!',
      app_metadata: { hrms_activation_op_id: sdkOpId, hrms_role: 'EMPLOYEE' },
    });
    assert.equal(sdkErr, null, `SDK updateUserById failed: ${sdkErr?.message}`);
    assert.equal(sdkData.user?.app_metadata?.['hrms_activation_op_id'], sdkOpId);
    const sdkSignInRes = await signInWithPassword(email, 'SdkPass8!');
    assert.equal(sdkSignInRes.status, 200, 'Sign-in with SDK-updated password must succeed');
    console.log('T6 PASS: Admin updateUser (HTTP + @supabase/supabase-js updateUserById) with password + app_metadata reflected correctly');
  });

  // ── Test 7: Refresh token rotation — new token issued on refresh ─────────────
  it('T7: POST /token?grant_type=refresh_token returns new refresh token (rotation)', async () => {
    const email = uniqueTestEmail('t7-rotation');
    const createRes = await adminCreateUser(email, 'RotPass8!');
    assert.equal(createRes.status, 200);
    const createBody = await createRes.json() as Record<string, unknown>;
    testUserIds.push(createBody['id'] as string);

    const signInRes = await signInWithPassword(email, 'RotPass8!');
    assert.equal(signInRes.status, 200);
    const signInBody = await signInRes.json() as Record<string, unknown>;
    const originalRefreshToken = signInBody['refresh_token'] as string;
    assert.ok(originalRefreshToken, 'Expected refresh_token from sign-in');

    // Use the refresh token
    const refreshRes = await gotruePost('/token?grant_type=refresh_token', {
      refresh_token: originalRefreshToken,
    });
    assert.equal(refreshRes.status, 200, `Refresh token exchange failed: ${refreshRes.status}`);
    const refreshBody = await refreshRes.json() as Record<string, unknown>;
    const newRefreshToken = refreshBody['refresh_token'] as string;
    assert.ok(newRefreshToken, 'Expected new refresh_token from rotation');
    // Rotation: new token must be different from old
    assert.notEqual(
      newRefreshToken,
      originalRefreshToken,
      'Expected new refresh_token to differ from original (rotation enabled)'
    );
    console.log('T7 PASS: Refresh token rotation working — new token issued');
  });

  // ── Test 8: Reused refresh token rejected outside configured grace period ────
  //
  // GoTrue v2.197.0 reuse-detection behaviour (confirmed empirically under
  // GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL=10):
  //   - Within the 10-second grace period, reusing a rotated token is tolerated.
  //   - Outside the 10-second grace period, reusing rToken1 after its direct child
  //     (rToken2) has itself been rotated (rToken2 → rToken3) is rejected with HTTP 400
  //     and error_code="refresh_token_already_used".
  //   - Note: Because GoTrue may still leave the active leaf valid depending on state,
  //     the Express broker (PO-05 / PO-07, Migration 00004+) additionally enforces
  //     server-side user_sessions / revoked_sessions family revocation.
  it('T8: Reused refresh token rejected with 400 outside grace period (refresh_token_already_used)', async () => {
    const email = uniqueTestEmail('t8-reuse');
    const createRes = await adminCreateUser(email, 'ReuPass8!');
    assert.equal(createRes.status, 200);
    const createBody = await createRes.json() as Record<string, unknown>;
    testUserIds.push(createBody['id'] as string);

    const signInRes = await signInWithPassword(email, 'ReuPass8!');
    assert.equal(signInRes.status, 200);
    const signInBody = await signInRes.json() as Record<string, unknown>;
    const rToken1 = signInBody['refresh_token'] as string;
    assert.ok(rToken1, 'Expected refresh_token from sign-in');

    // First rotation: rToken1 → rToken2 (rToken1 revoked at T0)
    const rot1Res = await gotruePost('/token?grant_type=refresh_token', {
      refresh_token: rToken1,
    });
    assert.equal(rot1Res.status, 200, 'First rotation must succeed');
    const rot1Body = await rot1Res.json() as Record<string, unknown>;
    const rToken2 = rot1Body['refresh_token'] as string;
    assert.ok(rToken2, 'Expected rToken2 from first rotation');
    assert.notEqual(rToken2, rToken1, 'rToken2 must differ from rToken1');

    // Wait strictly outside the configured 10-second refresh_token_reuse_interval grace window
    await new Promise((resolve) => setTimeout(resolve, 11_500));

    // Second rotation: rToken2 → rToken3 (rToken2 revoked; rToken1 superseded outside grace interval)
    const rot2Res = await gotruePost('/token?grant_type=refresh_token', {
      refresh_token: rToken2,
    });
    assert.equal(rot2Res.status, 200, 'Second rotation must succeed');
    const rot2Body = await rot2Res.json() as Record<string, unknown>;
    const rToken3 = rot2Body['refresh_token'] as string;
    assert.ok(rToken3, 'Expected rToken3 from second rotation');
    assert.notEqual(rToken3, rToken2, 'rToken3 must differ from rToken2');

    // Replay attack outside the grace period: reuse superseded rToken1.
    // GoTrue must reject this with HTTP 400 error_code="refresh_token_already_used".
    const reuseRes = await gotruePost('/token?grant_type=refresh_token', {
      refresh_token: rToken1,
    });
    assert.equal(
      reuseRes.status,
      400,
      `Expected 400 for reused refresh token outside grace period, got ${reuseRes.status}`
    );
    const reuseBody = await reuseRes.json() as Record<string, unknown>;
    assert.equal(
      reuseBody['error_code'],
      'refresh_token_already_used',
      `Expected error_code=refresh_token_already_used, got: ${JSON.stringify(reuseBody)}`
    );
    console.log('T8 PASS: Reused refresh token rejected with 400 (refresh_token_already_used) outside 10s grace period');
  });

  // ── Test 9a: scope=local logout revokes current session only ─────────────────
  it('T9a: POST /logout?scope=local revokes current session only', async () => {
    const email = uniqueTestEmail('t9a-local-logout');
    const createRes = await adminCreateUser(email, 'LogPass8!');
    assert.equal(createRes.status, 200);
    const createBody = await createRes.json() as Record<string, unknown>;
    testUserIds.push(createBody['id'] as string);

    // Sign in twice to create two independent sessions
    const session1Res = await signInWithPassword(email, 'LogPass8!');
    assert.equal(session1Res.status, 200);
    const session1 = await session1Res.json() as Record<string, unknown>;
    const token1 = session1['access_token'] as string;
    const refresh1 = session1['refresh_token'] as string;

    const session2Res = await signInWithPassword(email, 'LogPass8!');
    assert.equal(session2Res.status, 200);
    const session2 = await session2Res.json() as Record<string, unknown>;
    const refresh2 = session2['refresh_token'] as string;

    // Logout session 1 locally via POST /logout?scope=local
    const logoutRes = await fetch(`${GOTRUE_URL}/logout?scope=local`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: getAnonKey(),
        Authorization: `Bearer ${token1}`,
      },
    });
    assert.ok(
      logoutRes.status === 200 || logoutRes.status === 204,
      `Expected 200/204 from local logout, got ${logoutRes.status}`
    );

    // Session 1 refresh token must be invalidated
    const reuseSession1 = await gotruePost('/token?grant_type=refresh_token', {
      refresh_token: refresh1,
    });
    assert.ok(
      reuseSession1.status >= 400,
      `Expected session 1 refresh token to be revoked after local logout, got ${reuseSession1.status}`
    );

    // Session 2 refresh token must still be valid
    const reuseSession2 = await gotruePost('/token?grant_type=refresh_token', {
      refresh_token: refresh2,
    });
    assert.equal(
      reuseSession2.status,
      200,
      `Expected session 2 to remain active after session 1 local logout, got ${reuseSession2.status}`
    );
    console.log('T9a PASS: scope=local logout revoked session 1 only; session 2 still active');
  });

  // ── Test 9b: scope=global logout revokes all sessions ────────────────────────
  it('T9b: POST /logout?scope=global revokes all sessions', async () => {
    const email = uniqueTestEmail('t9b-global-logout');
    const createRes = await adminCreateUser(email, 'GloPass8!');
    assert.equal(createRes.status, 200);
    const createBody = await createRes.json() as Record<string, unknown>;
    testUserIds.push(createBody['id'] as string);

    // Sign in twice to create two sessions
    const session1Res = await signInWithPassword(email, 'GloPass8!');
    assert.equal(session1Res.status, 200);
    const session1 = await session1Res.json() as Record<string, unknown>;
    const token1 = session1['access_token'] as string;
    const refresh1 = session1['refresh_token'] as string;

    const session2Res = await signInWithPassword(email, 'GloPass8!');
    assert.equal(session2Res.status, 200);
    const session2 = await session2Res.json() as Record<string, unknown>;
    const refresh2 = session2['refresh_token'] as string;

    // Global logout using session 1's token via POST /logout?scope=global
    const logoutRes = await fetch(`${GOTRUE_URL}/logout?scope=global`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: getAnonKey(),
        Authorization: `Bearer ${token1}`,
      },
    });
    assert.ok(
      logoutRes.status === 200 || logoutRes.status === 204,
      `Expected 200/204 from global logout, got ${logoutRes.status}`
    );

    // Both refresh tokens must now be invalid
    const reuseSession1 = await gotruePost('/token?grant_type=refresh_token', {
      refresh_token: refresh1,
    });
    assert.ok(
      reuseSession1.status >= 400,
      `Expected session 1 refresh to be revoked after global logout, got ${reuseSession1.status}`
    );

    const reuseSession2 = await gotruePost('/token?grant_type=refresh_token', {
      refresh_token: refresh2,
    });
    assert.ok(
      reuseSession2.status >= 400,
      `Expected session 2 refresh to be revoked after global logout, got ${reuseSession2.status}`
    );
    console.log('T9b PASS: scope=global logout revoked all sessions');
  });
});
