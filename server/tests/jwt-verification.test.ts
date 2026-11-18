import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as jose from 'jose';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import {
  extractBearerToken,
  verifySupabaseToken,
  _resetJwksCacheForTesting,
} from '../src/auth/jwtVerifier.js';
import type { AuthenticatedUser } from '../src/auth/jwtVerifier.js';
import { AppError } from '../src/middleware/errorHandler.js';
import { ApiErrorCode } from '@hrms/shared';
import { closePool } from '../src/db/pool.js';

// Constant test keys and parameters
const TEST_JWT_SECRET = new TextEncoder().encode('test-secret-at-least-32-characters-long-12345');
const TEST_ISSUER = 'http://127.0.0.1:54321/auth/v1';
const TEST_AUDIENCE = 'authenticated';
const VALID_USER_ID = '49192bfd-b36d-477a-b06e-0db807e2c5ec';

/**
 * Helper to generate a test JWT using jose.
 */
async function generateTestJwt(
  payloadOverrides: Record<string, unknown> = {},
  options?: {
    secret?: Uint8Array;
    alg?: string;
    expiresIn?: string | number;
    issuer?: string;
    audience?: string;
    customKey?: jose.KeyLike;
  }
): Promise<string> {
  const secret = options?.secret ?? TEST_JWT_SECRET;
  const alg = options?.alg ?? 'HS256';
  const issuer = options?.issuer !== undefined ? options.issuer : TEST_ISSUER;
  const audience = options?.audience !== undefined ? options.audience : TEST_AUDIENCE;

  const jwtBuilder = new jose.SignJWT({
    sub: VALID_USER_ID,
    email: 'employee@acme.test',
    phone: '+919876543210',
    role: 'authenticated',
    app_metadata: { provider: 'email' },
    user_metadata: { full_name: 'Test Employee' },
    ...payloadOverrides,
  })
    .setProtectedHeader({ alg, typ: 'JWT' });

  if (issuer) {
    jwtBuilder.setIssuer(issuer);
  }
  if (audience) {
    jwtBuilder.setAudience(audience);
  }

  if (options?.expiresIn !== undefined) {
    if (typeof options.expiresIn === 'number') {
      jwtBuilder.setExpirationTime(options.expiresIn);
    } else {
      jwtBuilder.setExpirationTime(options.expiresIn);
    }
  } else {
    jwtBuilder.setExpirationTime('1h');
  }

  jwtBuilder.setIssuedAt();

  if (options?.customKey) {
    return await jwtBuilder.sign(options.customKey);
  }
  return await jwtBuilder.sign(secret);
}

// ==============================================================================
// 1. TOKEN EXTRACTION TESTS (extractBearerToken)
// ==============================================================================

test('JWT Extraction: Successfully extracts valid Bearer token', () => {
  const token = 'header.payload.signature';
  assert.equal(extractBearerToken(`Bearer ${token}`), token);
  assert.equal(extractBearerToken(`bearer ${token}`), token);
  assert.equal(extractBearerToken(`BEARER ${token}`), token);
  assert.equal(extractBearerToken(`   Bearer ${token}   `), token);
});

test('JWT Extraction: Rejects missing, empty, or undefined Authorization header', () => {
  assert.throws(
    () => extractBearerToken(undefined),
    (err: unknown) => {
      assert(err instanceof AppError);
      assert.equal(err.statusCode, 401);
      assert.equal(err.errorCode, ApiErrorCode.UNAUTHORIZED);
      return true;
    }
  );

  assert.throws(
    () => extractBearerToken(''),
    (err: unknown) => {
      assert(err instanceof AppError);
      assert.equal(err.statusCode, 401);
      return true;
    }
  );
});

test('JWT Extraction: Rejects non-Bearer schemes or malformed header formats', () => {
  const invalidHeaders = [
    'Basic dXNlcjpwYXNz',
    'Token my-token',
    'Bearer',
    'Bearer    ',
    'Bearer token1 token2',
    'NotBearer token',
  ];

  for (const header of invalidHeaders) {
    assert.throws(
      () => extractBearerToken(header),
      (err: unknown) => {
        assert(err instanceof AppError);
        assert.equal(err.statusCode, 401);
        assert.equal(err.errorCode, ApiErrorCode.UNAUTHORIZED);
        return true;
      },
      `Header should be rejected: ${header}`
    );
  }
});

// ==============================================================================
// 2. CRYPTOGRAPHIC SIGNATURE & ALGORITHM ENFORCEMENT TESTS
// ==============================================================================

test('JWT Verification: Successfully verifies valid HS256 token and attaches typed context', async () => {
  const token = await generateTestJwt();
  const user = await verifySupabaseToken(token, {
    secretKey: TEST_JWT_SECRET,
    issuer: TEST_ISSUER,
    audience: TEST_AUDIENCE,
  });

  assert.equal(user.authUserId, VALID_USER_ID);
  assert.equal(user.email, 'employee@acme.test');
  assert.equal(user.phone, '+919876543210');
  assert.equal(user.role, 'authenticated');
  assert.deepEqual(user.appMetadata, { provider: 'email' });
  assert.deepEqual(user.userMetadata, { full_name: 'Test Employee' });
  assert(user.sessionExpiresAt > user.tokenIssuedAt);
});

test('JWT Verification: Successfully verifies valid asymmetric ES256 token', async () => {
  // Generate EC P-256 keypair in memory for test
  const { publicKey, privateKey } = await jose.generateKeyPair('ES256');
  const token = await generateTestJwt({}, {
    customKey: privateKey,
    alg: 'ES256',
  });

  // Verify using custom key resolver
  const jwksResolver: jose.JWTVerifyGetKey = async () => publicKey;

  const user = await verifySupabaseToken(token, {
    jwksResolver,
    issuer: TEST_ISSUER,
    audience: TEST_AUDIENCE,
  });

  assert.equal(user.authUserId, VALID_USER_ID);
  assert.equal(user.role, 'authenticated');
});

test('JWT Verification: Strictly rejects "none" algorithm tokens', async () => {
  // Create an unsigned token with alg: none
  const unsignedToken = `${jose.base64url.encode(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${jose.base64url.encode(JSON.stringify({ sub: VALID_USER_ID }))}.`;

  await assert.rejects(
    async () => {
      await verifySupabaseToken(unsignedToken, {
        secretKey: TEST_JWT_SECRET,
        issuer: TEST_ISSUER,
        audience: TEST_AUDIENCE,
      });
    },
    (err: unknown) => {
      assert(err instanceof AppError);
      assert.equal(err.statusCode, 401);
      assert.equal(err.errorCode, ApiErrorCode.INVALID_TOKEN);
      assert(err.message.includes('disallowed'));
      return true;
    }
  );
});

test('JWT Verification: Strictly rejects unapproved algorithm tokens (e.g. HS512)', async () => {
  const token = await generateTestJwt({}, { alg: 'HS512' });

  await assert.rejects(
    async () => {
      await verifySupabaseToken(token, {
        secretKey: TEST_JWT_SECRET,
        issuer: TEST_ISSUER,
        audience: TEST_AUDIENCE,
      });
    },
    (err: unknown) => {
      assert(err instanceof AppError);
      assert.equal(err.statusCode, 401);
      assert.equal(err.errorCode, ApiErrorCode.INVALID_TOKEN);
      return true;
    }
  );
});

test('JWT Verification: Rejects token with invalid or tampered signature', async () => {
  const validToken = await generateTestJwt();
  const parts = validToken.split('.');
  // Corrupt signature bytes
  const tamperedSignature = parts[2]!.substring(0, parts[2]!.length - 4) + 'AAAA';
  const tamperedToken = `${parts[0]}.${parts[1]}.${tamperedSignature}`;

  await assert.rejects(
    async () => {
      await verifySupabaseToken(tamperedToken, {
        secretKey: TEST_JWT_SECRET,
        issuer: TEST_ISSUER,
        audience: TEST_AUDIENCE,
      });
    },
    (err: unknown) => {
      assert(err instanceof AppError);
      assert.equal(err.statusCode, 401);
      assert.equal(err.errorCode, ApiErrorCode.INVALID_TOKEN);
      assert(err.message.includes('signature'));
      return true;
    }
  );
});

test('JWT Verification: Rejects token signed with a different secret', async () => {
  const differentSecret = new TextEncoder().encode('completely-different-signing-secret-12345');
  const token = await generateTestJwt({}, { secret: differentSecret });

  await assert.rejects(
    async () => {
      await verifySupabaseToken(token, {
        secretKey: TEST_JWT_SECRET,
        issuer: TEST_ISSUER,
        audience: TEST_AUDIENCE,
      });
    },
    (err: unknown) => {
      assert(err instanceof AppError);
      assert.equal(err.statusCode, 401);
      assert.equal(err.errorCode, ApiErrorCode.INVALID_TOKEN);
      assert(err.message.includes('signature'));
      return true;
    }
  );
});

// ==============================================================================
// 3. CLAIM VALIDATION TESTS (exp, iss, aud, sub)
// ==============================================================================

test('JWT Claims: Rejects expired token with TOKEN_EXPIRED error', async () => {
  // Expiration 10 seconds in the past
  const pastTimestamp = Math.floor(Date.now() / 1000) - 10;
  const expiredToken = await generateTestJwt({}, {
    expiresIn: pastTimestamp,
  });

  await assert.rejects(
    async () => {
      await verifySupabaseToken(expiredToken, {
        secretKey: TEST_JWT_SECRET,
        issuer: TEST_ISSUER,
        audience: TEST_AUDIENCE,
        clockTolerance: 0,
      });
    },
    (err: unknown) => {
      assert(err instanceof AppError);
      assert.equal(err.statusCode, 401);
      assert.equal(err.errorCode, ApiErrorCode.TOKEN_EXPIRED);
      assert(err.message.includes('expired'));
      return true;
    }
  );
});

test('JWT Claims: Rejects token with wrong issuer', async () => {
  const token = await generateTestJwt({}, { issuer: 'https://attacker-idp.com/auth/v1' });

  await assert.rejects(
    async () => {
      await verifySupabaseToken(token, {
        secretKey: TEST_JWT_SECRET,
        issuer: TEST_ISSUER,
        audience: TEST_AUDIENCE,
      });
    },
    (err: unknown) => {
      assert(err instanceof AppError);
      assert.equal(err.statusCode, 401);
      assert.equal(err.errorCode, ApiErrorCode.INVALID_TOKEN);
      assert(err.message.includes('claim validation failed'));
      return true;
    }
  );
});

test('JWT Claims: Rejects token with wrong audience', async () => {
  const token = await generateTestJwt({}, { audience: 'different-audience' });

  await assert.rejects(
    async () => {
      await verifySupabaseToken(token, {
        secretKey: TEST_JWT_SECRET,
        issuer: TEST_ISSUER,
        audience: TEST_AUDIENCE,
      });
    },
    (err: unknown) => {
      assert(err instanceof AppError);
      assert.equal(err.statusCode, 401);
      assert.equal(err.errorCode, ApiErrorCode.INVALID_TOKEN);
      assert(err.message.includes('claim validation failed'));
      return true;
    }
  );
});

test('JWT Claims: Rejects token with malformed non-UUID subject claim', async () => {
  const token = await generateTestJwt({ sub: 'not-a-valid-uuid' });

  await assert.rejects(
    async () => {
      await verifySupabaseToken(token, {
        secretKey: TEST_JWT_SECRET,
        issuer: TEST_ISSUER,
        audience: TEST_AUDIENCE,
      });
    },
    (err: unknown) => {
      assert(err instanceof AppError);
      assert.equal(err.statusCode, 401);
      assert.equal(err.errorCode, ApiErrorCode.INVALID_TOKEN);
      assert(err.message.includes('Invalid subject claim'));
      return true;
    }
  );
});

// ==============================================================================
// 4. LIVE SUPABASE AUTH END-TO-END VERIFICATION
// ==============================================================================

test('Live Engine: Verifies authentic ES256 token issued by local Supabase Auth GoTrue', async () => {
  const testEmail = `live-jwt-${Date.now()}@test.internal`;
  const testPassword = 'Password123!';

  // Public signup is disabled (enable_signup=false per PO-06).
  // Use the Admin API to create the test user — this bypasses disable_signup
  // and is the only sanctioned path for user creation in this HRMS system.
  const adminCreateResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    }),
  });

  if (!adminCreateResponse.ok) {
    const errorText = await adminCreateResponse.text();
    throw new Error(`Failed to create test user via Admin API: ${errorText}`);
  }

  const adminUser = (await adminCreateResponse.json()) as { id: string };
  const expectedAuthUserId = adminUser.id;
  assert(expectedAuthUserId, 'Admin API must return user id');

  try {
    // Sign in using password grant to obtain a real GoTrue-issued ES256 token
    const signInResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });

    if (!signInResponse.ok) {
      const errorText = await signInResponse.text();
      throw new Error(`Failed to sign in test user: ${errorText}`);
    }

    const signInData = (await signInResponse.json()) as { access_token: string };
    const realToken = signInData.access_token;
    assert(realToken, 'GoTrue must issue access_token');

    // Cryptographically verify real token against local Supabase JWKS endpoint
    const verifiedUser = await verifySupabaseToken(realToken);

    assert.equal(verifiedUser.authUserId, expectedAuthUserId);
    assert.equal(verifiedUser.email, testEmail);
    assert.equal(verifiedUser.role, 'authenticated');
    assert(verifiedUser.sessionExpiresAt > 0);
  } finally {
    // Clean up: delete test user via Admin API
    try {
      await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${expectedAuthUserId}`, {
        method: 'DELETE',
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      });
    } catch {
      // Ignore cleanup error if already removed
    }
  }
});

// ==============================================================================
// 5. PROTECTED ROUTE INTEGRATION TESTS (GET /api/v1/auth/me)
// ==============================================================================

test('Protected Route: GET /api/v1/auth/me rejects request without Authorization header with 401 UNAUTHORIZED', async () => {
  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };
  const port = address.port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/auth/me`);
    assert.equal(res.status, 401);

    const body = (await res.json()) as { success: boolean; error: { code: string; message: string } };
    assert.equal(body.success, false);
    assert.equal(body.error.code, ApiErrorCode.UNAUTHORIZED);
  } finally {
    server.close();
  }
});

test('Protected Route: GET /api/v1/auth/me rejects request with invalid token with 401 INVALID_TOKEN', async () => {
  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };
  const port = address.port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/auth/me`, {
      headers: {
        Authorization: 'Bearer invalid.token.payload',
      },
    });
    assert.equal(res.status, 401);

    const body = (await res.json()) as { success: boolean; error: { code: string; message: string } };
    assert.equal(body.success, false);
    assert.equal(body.error.code, ApiErrorCode.INVALID_TOKEN);
  } finally {
    server.close();
  }
});

test('Protected Route: GET /api/v1/auth/me succeeds with verified token and returns authenticated context', async () => {
  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };
  const port = address.port;

  // Sign token using development JWT secret
  const token = await generateTestJwt(
    {
      sub: VALID_USER_ID,
      email: 'verified@hrms.internal',
    },
    {
      secret: new TextEncoder().encode(env.SUPABASE_JWT_SECRET),
      issuer: env.SUPABASE_JWT_ISSUER,
      audience: env.SUPABASE_JWT_AUDIENCE,
    }
  );

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
        // Attempt to pass an untrusted organization_id header
        'x-organization-id': '00000000-0000-0000-0000-000000000999',
      },
    });

    assert.equal(res.status, 200);

    const body = (await res.json()) as {
      success: boolean;
      data: {
        authUserId: string;
        email: string;
        role: string;
      };
    };

    assert.equal(body.success, true);
    assert.equal(body.data.authUserId, VALID_USER_ID);
    assert.equal(body.data.email, 'verified@hrms.internal');
    assert.equal(body.data.role, 'authenticated');
    // Ensure browser header was ignored
    assert.equal('x-organization-id' in body.data, false);
  } finally {
    server.close();
  }
});

after(async () => {
  _resetJwksCacheForTesting();
  await closePool();
});
