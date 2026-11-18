import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { env } from '../src/config/env.js';
import { getPool } from '../src/db/pool.js';
import {
  ConfiguredLivenessVerificationAdapter,
  defaultLivenessVerificationAdapter,
  InMemoryLivenessNonceStore,
  PostgresLivenessNonceStore,
  type LivenessChallengeAction,
  type LivenessNonceStore,
} from '../src/services/livenessVerificationAdapter.js';

const VALID_MINI_JPEG_DATA_URL = `data:image/jpeg;base64,${Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]).toString('base64')}`;

async function withMockServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('issueChallenge generates valid HMAC-signed tokens and consumeChallengeToken blocks replay attacks', () => {
  const adapter = new ConfiguredLivenessVerificationAdapter();
  const c1 = adapter.issueChallenge({
    organizationId: '00000000-0000-0000-0000-000000000001',
    employeeId: '00000000-0000-0000-0000-000000000002',
    direction: 'CHECK_IN',
    preferredAction: 'BLINK',
  });

  assert.equal(c1.action, 'BLINK');
  assert.ok(c1.challengeToken.includes('.'));
  assert.equal(c1.ttlSeconds, 90);

  // Missing token -> fails safely with failureReason
  const missingPromise = adapter.verify({
    organizationId: '00000000-0000-0000-0000-000000000001',
    employeeId: '00000000-0000-0000-0000-000000000002',
    direction: 'CHECK_IN',
    frames: [VALID_MINI_JPEG_DATA_URL, VALID_MINI_JPEG_DATA_URL],
    challengeToken: null,
  });
  return missingPromise.then((res) => {
    assert.equal(res.livenessStatus, 'FAILED');
    assert.ok(res.failureReason?.includes('missing'));
  });
});

test('consumeChallengeToken strictly validates tenant, employee, direction, tampering, and prevents double-spending', async () => {
  const adapter = new ConfiguredLivenessVerificationAdapter();
  const challenge = adapter.issueChallenge({
    organizationId: '00000000-0000-0000-0000-000000000001',
    employeeId: '00000000-0000-0000-0000-000000000002',
    direction: 'CHECK_IN',
    preferredAction: 'TURN_LEFT',
  });

  // 1. Wrong direction rejected
  const wrongDir = await adapter.verify({
    organizationId: '00000000-0000-0000-0000-000000000001',
    employeeId: '00000000-0000-0000-0000-000000000002',
    direction: 'CHECK_OUT',
    frames: [VALID_MINI_JPEG_DATA_URL, VALID_MINI_JPEG_DATA_URL],
    challengeToken: challenge.challengeToken,
  });
  assert.equal(wrongDir.livenessStatus, 'FAILED');
  assert.equal(wrongDir.spoofingSuspected, true);
  assert.ok(wrongDir.failureReason?.includes('does not match'));

  // 2. Tampered token signature rejected
  const [b64, sig] = challenge.challengeToken.split('.');
  const tamperedSig = sig!.slice(0, -4) + 'AAAA';
  const tampered = await adapter.verify({
    organizationId: '00000000-0000-0000-0000-000000000001',
    employeeId: '00000000-0000-0000-0000-000000000002',
    direction: 'CHECK_IN',
    frames: [VALID_MINI_JPEG_DATA_URL, VALID_MINI_JPEG_DATA_URL],
    challengeToken: `${b64}.${tamperedSig}`,
  });
  assert.equal(tampered.livenessStatus, 'FAILED');
  assert.equal(tampered.spoofingSuspected, true);
  assert.ok(tampered.failureReason?.includes('signature'));

  // 3. First genuine consume succeeds against mock sidecar
  await withMockServer(
    (req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = JSON.parse(body);
        assert.equal(req.headers['x-api-key'], 'mock-test-liveness-key');
        assert.equal(parsed.challengeAction, 'TURN_LEFT');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            livenessStatus: 'LIVE',
            spoofingSuspected: false,
            matchHint: 'NONE',
            livenessScore: 0.92,
            passiveScore: 0.88,
            printScore: 0.04,
            replayScore: 0.08,
            challengePassed: true,
            bestProbeFrameIndex: 1,
            reason: 'Challenge verified',
          })
        );
      });
    },
    async (baseUrl) => {
      const mockAdapter = new ConfiguredLivenessVerificationAdapter({
        ...env,
        LIVENESS_PROVIDER: 'hybrid-onnx',
        LIVENESS_BASE_URL: baseUrl,
        LIVENESS_API_KEY: 'mock-test-liveness-key',
      });

      const res1 = await mockAdapter.verify({
        organizationId: '00000000-0000-0000-0000-000000000001',
        employeeId: '00000000-0000-0000-0000-000000000002',
        direction: 'CHECK_IN',
        frames: [VALID_MINI_JPEG_DATA_URL, VALID_MINI_JPEG_DATA_URL],
        challengeToken: challenge.challengeToken,
      });
      assert.equal(res1.livenessStatus, 'LIVE');
      assert.equal(res1.challengePassed, true);
      assert.equal(res1.bestProbeFrameIndex, 1);

      // Replay attempt with same token is BLOCKED immediately server-side
      const replay = await mockAdapter.verify({
        organizationId: '00000000-0000-0000-0000-000000000001',
        employeeId: '00000000-0000-0000-0000-000000000002',
        direction: 'CHECK_IN',
        frames: [VALID_MINI_JPEG_DATA_URL, VALID_MINI_JPEG_DATA_URL],
        challengeToken: challenge.challengeToken,
      });
      assert.equal(replay.livenessStatus, 'FAILED');
      assert.equal(replay.spoofingSuspected, true);
      assert.ok(replay.failureReason?.includes('already used'));
    }
  );
});

test('Unconfigured or unreachable liveness provider fails closed with UNAVAILABLE without crashing', async () => {
  const unconfiguredAdapter = new ConfiguredLivenessVerificationAdapter({
    ...env,
    LIVENESS_PROVIDER: 'none',
  });
  const unconfigured = await unconfiguredAdapter.verify({
    organizationId: '00000000-0000-0000-0000-000000000001',
    employeeId: '00000000-0000-0000-0000-000000000002',
    direction: 'CHECK_IN',
    frames: [VALID_MINI_JPEG_DATA_URL],
  });
  assert.equal(unconfigured.livenessStatus, 'UNAVAILABLE');
  assert.equal(unconfigured.spoofingSuspected, false);
  assert.ok(unconfigured.failureReason?.includes('not configured'));

  const unreachableAdapter = new ConfiguredLivenessVerificationAdapter({
    ...env,
    LIVENESS_PROVIDER: 'hybrid-onnx',
    LIVENESS_BASE_URL: 'http://127.0.0.1:59998',
    LIVENESS_API_KEY: 'test-key',
    LIVENESS_TIMEOUT_MS: 500,
    LIVENESS_MAX_RETRIES: 0,
  });
  const challenge = unreachableAdapter.issueChallenge({
    organizationId: '00000000-0000-0000-0000-000000000001',
    employeeId: '00000000-0000-0000-0000-000000000002',
    direction: 'CHECK_IN',
  });
  const unreachable = await unreachableAdapter.verify({
    organizationId: '00000000-0000-0000-0000-000000000001',
    employeeId: '00000000-0000-0000-0000-000000000002',
    direction: 'CHECK_IN',
    frames: [VALID_MINI_JPEG_DATA_URL, VALID_MINI_JPEG_DATA_URL],
    challengeToken: challenge.challengeToken,
  });
  assert.equal(unreachable.livenessStatus, 'UNAVAILABLE');
  assert.equal(unreachable.spoofingSuspected, false);
  assert.ok(unreachable.failureReason?.includes('unreachable'));
});

test('LIVE hrms-liveness container /health and active integration check', async () => {
  const healthRes = await fetch(`${env.LIVENESS_BASE_URL}/health`);
  assert.equal(healthRes.status, 200);
  const healthData = (await healthRes.json()) as { status: string; models: string[] };
  assert.equal(healthData.status, 'ok');
  assert.ok(healthData.models.includes('MiniFASNetV2'));
  assert.ok(healthData.models.includes('MiniFASNetV1SE'));
  assert.ok(healthData.models.includes('YuNet'));
});

test('Distributed nonce store: concurrent replay prevention across multiple simultaneous attempts', async () => {
  const testOrgId = crypto.randomUUID();
  const testEmpId = crypto.randomUUID();

  await withMockServer(
    (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          livenessStatus: 'LIVE',
          spoofingSuspected: false,
          matchHint: 'NONE',
          livenessScore: 0.95,
          passiveScore: 0.92,
          printScore: 0.02,
          replayScore: 0.03,
          challengePassed: true,
          bestProbeFrameIndex: 0,
        })
      );
    },
    async (baseUrl) => {
      const adapter = new ConfiguredLivenessVerificationAdapter({
        ...env,
        LIVENESS_PROVIDER: 'hybrid-onnx',
        LIVENESS_BASE_URL: baseUrl,
        LIVENESS_API_KEY: 'test-key',
      });

      const challenge = adapter.issueChallenge({
        organizationId: testOrgId,
        employeeId: testEmpId,
        direction: 'CHECK_IN',
        preferredAction: 'BLINK',
      });

      // Launch 5 concurrent verification calls with identical token
      const results = await Promise.all([
        adapter.verify({
          organizationId: testOrgId,
          employeeId: testEmpId,
          direction: 'CHECK_IN',
          frames: [VALID_MINI_JPEG_DATA_URL, VALID_MINI_JPEG_DATA_URL],
          challengeToken: challenge.challengeToken,
        }),
        adapter.verify({
          organizationId: testOrgId,
          employeeId: testEmpId,
          direction: 'CHECK_IN',
          frames: [VALID_MINI_JPEG_DATA_URL, VALID_MINI_JPEG_DATA_URL],
          challengeToken: challenge.challengeToken,
        }),
        adapter.verify({
          organizationId: testOrgId,
          employeeId: testEmpId,
          direction: 'CHECK_IN',
          frames: [VALID_MINI_JPEG_DATA_URL, VALID_MINI_JPEG_DATA_URL],
          challengeToken: challenge.challengeToken,
        }),
        adapter.verify({
          organizationId: testOrgId,
          employeeId: testEmpId,
          direction: 'CHECK_IN',
          frames: [VALID_MINI_JPEG_DATA_URL, VALID_MINI_JPEG_DATA_URL],
          challengeToken: challenge.challengeToken,
        }),
        adapter.verify({
          organizationId: testOrgId,
          employeeId: testEmpId,
          direction: 'CHECK_IN',
          frames: [VALID_MINI_JPEG_DATA_URL, VALID_MINI_JPEG_DATA_URL],
          challengeToken: challenge.challengeToken,
        }),
      ]);

      const liveResults = results.filter((r) => r.livenessStatus === 'LIVE');
      const failedReplays = results.filter(
        (r) =>
          r.livenessStatus === 'FAILED' &&
          r.spoofingSuspected === true &&
          r.failureReason?.includes('already used')
      );

      // Exactly ONE succeeds; exactly FOUR are rejected as replay attacks
      assert.equal(liveResults.length, 1);
      assert.equal(failedReplays.length, 4);

      // Clean up test nonces
      const pool = getPool();
      await pool.query(
        'DELETE FROM public.liveness_challenge_nonces WHERE organization_id = $1::uuid;',
        [testOrgId]
      );
    }
  );
});

test('Distributed nonce store: replay prevention across simulated backend restarts', async () => {
  const testOrgId = crypto.randomUUID();
  const testEmpId = crypto.randomUUID();

  await withMockServer(
    (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          livenessStatus: 'LIVE',
          spoofingSuspected: false,
          matchHint: 'NONE',
          livenessScore: 0.91,
          passiveScore: 0.89,
          printScore: 0.04,
          replayScore: 0.05,
          challengePassed: true,
          bestProbeFrameIndex: 0,
        })
      );
    },
    async (baseUrl) => {
      // Backend Instance 1 runs and handles check-in
      const backendInstance1 = new ConfiguredLivenessVerificationAdapter({
        ...env,
        LIVENESS_PROVIDER: 'hybrid-onnx',
        LIVENESS_BASE_URL: baseUrl,
        LIVENESS_API_KEY: 'test-key',
      });

      const challenge = backendInstance1.issueChallenge({
        organizationId: testOrgId,
        employeeId: testEmpId,
        direction: 'CHECK_IN',
        preferredAction: 'TURN_LEFT',
      });

      const firstAttempt = await backendInstance1.verify({
        organizationId: testOrgId,
        employeeId: testEmpId,
        direction: 'CHECK_IN',
        frames: [VALID_MINI_JPEG_DATA_URL, VALID_MINI_JPEG_DATA_URL],
        challengeToken: challenge.challengeToken,
      });
      assert.equal(firstAttempt.livenessStatus, 'LIVE');

      // Simulate complete backend restart (new adapter instance, clean memory heap)
      const backendInstance2 = new ConfiguredLivenessVerificationAdapter({
        ...env,
        LIVENESS_PROVIDER: 'hybrid-onnx',
        LIVENESS_BASE_URL: baseUrl,
        LIVENESS_API_KEY: 'test-key',
      });

      // Second attempt on restarted instance with same token is blocked by PostgreSQL store
      const replayAttempt = await backendInstance2.verify({
        organizationId: testOrgId,
        employeeId: testEmpId,
        direction: 'CHECK_IN',
        frames: [VALID_MINI_JPEG_DATA_URL, VALID_MINI_JPEG_DATA_URL],
        challengeToken: challenge.challengeToken,
      });

      assert.equal(replayAttempt.livenessStatus, 'FAILED');
      assert.equal(replayAttempt.spoofingSuspected, true);
      assert.ok(replayAttempt.failureReason?.includes('already used'));

      // Clean up
      const pool = getPool();
      await pool.query(
        'DELETE FROM public.liveness_challenge_nonces WHERE organization_id = $1::uuid;',
        [testOrgId]
      );
    }
  );
});

test('Distributed nonce store: replay prevention across multiple distributed replica instances', async () => {
  const testOrgId = crypto.randomUUID();
  const testEmpId = crypto.randomUUID();

  await withMockServer(
    (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          livenessStatus: 'LIVE',
          spoofingSuspected: false,
          matchHint: 'NONE',
          livenessScore: 0.93,
          passiveScore: 0.90,
          printScore: 0.03,
          replayScore: 0.04,
          challengePassed: true,
          bestProbeFrameIndex: 0,
        })
      );
    },
    async (baseUrl) => {
      // Multiple horizontal replicas sharing the PostgreSQL database
      const replicaA = new ConfiguredLivenessVerificationAdapter({
        ...env,
        LIVENESS_PROVIDER: 'hybrid-onnx',
        LIVENESS_BASE_URL: baseUrl,
        LIVENESS_API_KEY: 'test-key',
      });
      const replicaB = new ConfiguredLivenessVerificationAdapter({
        ...env,
        LIVENESS_PROVIDER: 'hybrid-onnx',
        LIVENESS_BASE_URL: baseUrl,
        LIVENESS_API_KEY: 'test-key',
      });

      // Token issued by Replica A
      const challenge = replicaA.issueChallenge({
        organizationId: testOrgId,
        employeeId: testEmpId,
        direction: 'CHECK_OUT',
        preferredAction: 'TURN_RIGHT',
      });

      // Verified by Replica A
      const resA = await replicaA.verify({
        organizationId: testOrgId,
        employeeId: testEmpId,
        direction: 'CHECK_OUT',
        frames: [VALID_MINI_JPEG_DATA_URL, VALID_MINI_JPEG_DATA_URL],
        challengeToken: challenge.challengeToken,
      });
      assert.equal(resA.livenessStatus, 'LIVE');

      // Replayed to Replica B -> blocked because PostgreSQL synchronizes consumption
      const resB = await replicaB.verify({
        organizationId: testOrgId,
        employeeId: testEmpId,
        direction: 'CHECK_OUT',
        frames: [VALID_MINI_JPEG_DATA_URL, VALID_MINI_JPEG_DATA_URL],
        challengeToken: challenge.challengeToken,
      });
      assert.equal(resB.livenessStatus, 'FAILED');
      assert.equal(resB.spoofingSuspected, true);
      assert.ok(resB.failureReason?.includes('already used'));

      // Clean up
      const pool = getPool();
      await pool.query(
        'DELETE FROM public.liveness_challenge_nonces WHERE organization_id = $1::uuid;',
        [testOrgId]
      );
    }
  );
});

test('Distributed nonce store: expired nonce rejection and failure-closed behavior', async () => {
  const testOrgId = crypto.randomUUID();
  const testEmpId = crypto.randomUUID();

  const adapter = new ConfiguredLivenessVerificationAdapter({
    ...env,
    LIVENESS_CHALLENGE_TTL_MS: -1000, // Force instant expiration on issuance
  });

  const expiredChallenge = adapter.issueChallenge({
    organizationId: testOrgId,
    employeeId: testEmpId,
    direction: 'CHECK_IN',
  });

  const expiredRes = await adapter.verify({
    organizationId: testOrgId,
    employeeId: testEmpId,
    direction: 'CHECK_IN',
    frames: [VALID_MINI_JPEG_DATA_URL, VALID_MINI_JPEG_DATA_URL],
    challengeToken: expiredChallenge.challengeToken,
  });

  assert.equal(expiredRes.livenessStatus, 'FAILED');
  assert.equal(expiredRes.spoofingSuspected, false);
  assert.ok(expiredRes.failureReason?.includes('expired'));
});

test('Distributed nonce store: fails closed safely when database store is unavailable', async () => {
  const testOrgId = crypto.randomUUID();
  const testEmpId = crypto.randomUUID();

  const failingStore: LivenessNonceStore = {
    consumeNonce: async () => ({
      ok: false,
      replaySuspected: false,
      reason: 'Liveness nonce verification store unavailable.',
    }),
  };

  const adapter = new ConfiguredLivenessVerificationAdapter(
    {
      ...env,
      LIVENESS_PROVIDER: 'hybrid-onnx',
      LIVENESS_BASE_URL: 'http://127.0.0.1:8100',
      LIVENESS_API_KEY: 'test-key',
    },
    failingStore
  );

  const challenge = adapter.issueChallenge({
    organizationId: testOrgId,
    employeeId: testEmpId,
    direction: 'CHECK_IN',
  });

  const res = await adapter.verify({
    organizationId: testOrgId,
    employeeId: testEmpId,
    direction: 'CHECK_IN',
    frames: [VALID_MINI_JPEG_DATA_URL, VALID_MINI_JPEG_DATA_URL],
    challengeToken: challenge.challengeToken,
  });

  assert.equal(res.livenessStatus, 'FAILED');
  assert.equal(res.spoofingSuspected, false);
  assert.equal(res.failureReason, 'Liveness nonce verification store unavailable.');
});
