import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import pg from 'pg';
import { env, loadEnvConfig } from '../src/config/env.js';
import {
  ConfiguredFaceVerificationAdapter,
  defaultFaceVerificationAdapter,
  parseProbeImageDataUrl,
  resolveExpectedCompreFaceSubject,
  type FaceProviderConfig,
} from '../src/services/faceVerificationAdapter.js';

// Valid minimal 1x1 PNG (valid PNG magic bytes + IHDR + IDAT + IEND)
const VALID_TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// Valid minimal JPEG bytes header (SOI + APP0 + EOI, sufficient for container validation against mock server)
const VALID_MINI_JPEG_DATA_URL = `data:image/jpeg;base64,${Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]).toString('base64')}`;

function buildTestConfig(overrides: Partial<FaceProviderConfig> = {}): FaceProviderConfig {
  return {
    FACE_PROVIDER: 'compreface',
    FACE_PROVIDER_URL: '',
    FACE_PROVIDER_API_KEY: '',
    COMPREFACE_BASE_URL: 'http://127.0.0.1:8000',
    COMPREFACE_API_KEY: 'test-compreface-secret-key-1234',
    COMPREFACE_SIMILARITY_THRESHOLD: 0.85,
    COMPREFACE_DET_PROB_THRESHOLD: 0.8,
    COMPREFACE_TIMEOUT_MS: 3000,
    COMPREFACE_MAX_RETRIES: 1,
    ...overrides,
  };
}

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

test('parseProbeImageDataUrl validates JPEG/PNG magic bytes and rejects spoofed or invalid payloads', () => {
  const pngParsed = parseProbeImageDataUrl(VALID_TINY_PNG_DATA_URL);
  assert.equal(pngParsed.ok, true);
  if (pngParsed.ok) {
    assert.equal(pngParsed.image.mimeType, 'image/png');
    assert.equal(pngParsed.image.extension, 'png');
  }

  // Claims image/jpeg, actually PNG bytes
  const spoofedHeader = VALID_TINY_PNG_DATA_URL.replace('data:image/png;', 'data:image/jpeg;');
  const spoofedRes = parseProbeImageDataUrl(spoofedHeader);
  assert.equal(spoofedRes.ok, false);

  const nonDataUrl = parseProbeImageDataUrl('https://example.com/selfie.jpg');
  assert.equal(nonDataUrl.ok, false);
});

test('resolveExpectedCompreFaceSubject strips optional compreface: prefix cleanly', () => {
  assert.equal(
    resolveExpectedCompreFaceSubject({
      employeeId: 'e1',
      organizationId: 'o1',
      probeImageDataUrl: VALID_TINY_PNG_DATA_URL,
      enrolledTemplateReference: 'compreface:emp sz6094',
      attemptNumber: 1,
    }),
    'emp sz6094'
  );
  assert.equal(
    resolveExpectedCompreFaceSubject({
      employeeId: 'e1',
      organizationId: 'o1',
      probeImageDataUrl: VALID_TINY_PNG_DATA_URL,
      enrolledTemplateReference: null,
      attemptNumber: 1,
    }),
    null
  );
});

test('loadEnvConfig auto-selects compreface when COMPREFACE_BASE_URL and COMPREFACE_API_KEY are set', () => {
  const snapshot = {
    FACE_PROVIDER: process.env['FACE_PROVIDER'],
    COMPREFACE_BASE_URL: process.env['COMPREFACE_BASE_URL'],
    COMPREFACE_API_KEY: process.env['COMPREFACE_API_KEY'],
    COMPREFACE_SIMILARITY_THRESHOLD: process.env['COMPREFACE_SIMILARITY_THRESHOLD'],
  };

  try {
    delete process.env['FACE_PROVIDER'];
    process.env['COMPREFACE_BASE_URL'] = 'http://localhost:8000/';
    process.env['COMPREFACE_API_KEY'] = '11111111-2222-3333-4444-555555555555';
    process.env['COMPREFACE_SIMILARITY_THRESHOLD'] = '0.90';

    const cfg = loadEnvConfig();
    assert.equal(cfg.FACE_PROVIDER, 'compreface');
    assert.equal(cfg.COMPREFACE_BASE_URL, 'http://localhost:8000');
    assert.equal(cfg.COMPREFACE_SIMILARITY_THRESHOLD, 0.9);

    process.env['COMPREFACE_SIMILARITY_THRESHOLD'] = '1.5';
    assert.throws(() => loadEnvConfig(), /COMPREFACE_SIMILARITY_THRESHOLD/);
  } finally {
    for (const [k, v] of Object.entries(snapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('ConfiguredFaceVerificationAdapter returns PROVIDER_UNCONFIGURED when unconfigured', async () => {
  const adapter = new ConfiguredFaceVerificationAdapter(
    buildTestConfig({ FACE_PROVIDER: 'unconfigured', COMPREFACE_BASE_URL: '', COMPREFACE_API_KEY: '' })
  );
  const res = await adapter.verify({
    employeeId: 'emp-1',
    organizationId: 'org-1',
    probeImageDataUrl: VALID_MINI_JPEG_DATA_URL,
    enrolledTemplateReference: 'emp sz6094',
    attemptNumber: 1,
  });

  assert.equal(res.providerName, 'unconfigured');
  assert.equal(res.matchStatus, 'PROVIDER_UNCONFIGURED');
  assert.equal(res.livenessStatus, 'UNAVAILABLE');
  assert.equal(res.confidenceScore, null);
});

test('ConfiguredFaceVerificationAdapter validates threshold, identity mismatch, unknown face, multi-face, and retry on 503 via mock server', async () => {
  let callCount = 0;
  let scenario:
    | 'match'
    | 'below_threshold'
    | 'wrong_identity'
    | 'unknown_empty_subjects'
    | 'multiple_faces'
    | 'no_face_400'
    | 'transient_503_then_match'
    | 'bad_key_404' = 'match';

  await withMockServer(
    (req, res) => {
      callCount += 1;
      assert.equal(req.headers['x-api-key'], 'test-compreface-secret-key-1234');
      assert.ok(req.url?.startsWith('/api/v1/recognition/recognize'));

      req.resume();
      req.on('end', () => {
        if (scenario === 'transient_503_then_match' && callCount === 1) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Core temporarily unavailable' }));
          return;
        }
        if (scenario === 'no_face_400') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 28, message: 'No face is found in the given image' }));
          return;
        }
        if (scenario === 'bad_key_404') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              code: 10,
              message: 'Recognition service with API Key test-compreface-secret-key-1234 not found',
            })
          );
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (scenario === 'match' || scenario === 'transient_503_then_match') {
          res.end(
            JSON.stringify({
              result: [
                {
                  box: { probability: 0.99 },
                  subjects: [{ subject: 'emp sz6094', similarity: 0.94218 }],
                },
              ],
            })
          );
        } else if (scenario === 'below_threshold') {
          res.end(
            JSON.stringify({
              result: [
                {
                  box: { probability: 0.99 },
                  subjects: [{ subject: 'emp sz6094', similarity: 0.72 }],
                },
              ],
            })
          );
        } else if (scenario === 'wrong_identity') {
          res.end(
            JSON.stringify({
              result: [
                {
                  box: { probability: 0.99 },
                  subjects: [{ subject: 'thrishank', similarity: 0.97 }],
                },
              ],
            })
          );
        } else if (scenario === 'unknown_empty_subjects') {
          res.end(
            JSON.stringify({
              result: [{ box: { probability: 0.95 }, subjects: [] }],
            })
          );
        } else {
          res.end(
            JSON.stringify({
              result: [
                { box: { probability: 0.99 }, subjects: [{ subject: 'emp sz6094', similarity: 0.95 }] },
                { box: { probability: 0.98 }, subjects: [{ subject: 'thrishank', similarity: 0.94 }] },
              ],
            })
          );
        }
      });
    },
    async (baseUrl) => {
      const adapter = new ConfiguredFaceVerificationAdapter(
        buildTestConfig({ COMPREFACE_BASE_URL: baseUrl })
      );

      // 1. Exact match -> VERIFIED + UNAVAILABLE liveness (no fake LIVE!) + 4-decimal score
      scenario = 'match';
      const r1 = await adapter.verify({
        employeeId: 'e1',
        organizationId: 'o1',
        probeImageDataUrl: VALID_MINI_JPEG_DATA_URL,
        enrolledTemplateReference: 'compreface:emp sz6094',
        attemptNumber: 1,
      });
      assert.equal(r1.matchStatus, 'VERIFIED');
      assert.equal(r1.livenessStatus, 'UNAVAILABLE');
      assert.equal(r1.confidenceScore, 0.9422);

      // 2. Below threshold -> MISMATCH
      scenario = 'below_threshold';
      const r2 = await adapter.verify({
        employeeId: 'e1',
        organizationId: 'o1',
        probeImageDataUrl: VALID_MINI_JPEG_DATA_URL,
        enrolledTemplateReference: 'emp sz6094',
        attemptNumber: 1,
      });
      assert.equal(r2.matchStatus, 'MISMATCH');
      assert.equal(r2.confidenceScore, 0.72);

      // 3. Wrong employee identity -> MISMATCH
      scenario = 'wrong_identity';
      const r3 = await adapter.verify({
        employeeId: 'e1',
        organizationId: 'o1',
        probeImageDataUrl: VALID_MINI_JPEG_DATA_URL,
        enrolledTemplateReference: 'emp sz6094',
        attemptNumber: 1,
      });
      assert.equal(r3.matchStatus, 'MISMATCH');

      // 4. Unknown face (no candidate subjects) -> MISMATCH
      scenario = 'unknown_empty_subjects';
      const r4 = await adapter.verify({
        employeeId: 'e1',
        organizationId: 'o1',
        probeImageDataUrl: VALID_MINI_JPEG_DATA_URL,
        enrolledTemplateReference: 'emp sz6094',
        attemptNumber: 1,
      });
      assert.equal(r4.matchStatus, 'MISMATCH');
      assert.equal(r4.confidenceScore, 0);

      // 5. Multiple faces -> MULTIPLE_FACES_DETECTED
      scenario = 'multiple_faces';
      const r5 = await adapter.verify({
        employeeId: 'e1',
        organizationId: 'o1',
        probeImageDataUrl: VALID_MINI_JPEG_DATA_URL,
        enrolledTemplateReference: 'emp sz6094',
        attemptNumber: 1,
      });
      assert.equal(r5.matchStatus, 'MULTIPLE_FACES_DETECTED');

      // 6. No face (HTTP 400 code 28) -> FACE_NOT_DETECTED
      scenario = 'no_face_400';
      const r6 = await adapter.verify({
        employeeId: 'e1',
        organizationId: 'o1',
        probeImageDataUrl: VALID_MINI_JPEG_DATA_URL,
        enrolledTemplateReference: 'emp sz6094',
        attemptNumber: 1,
      });
      assert.equal(r6.matchStatus, 'FACE_NOT_DETECTED');

      // 7. Transient 503 recovers on retry
      callCount = 0;
      scenario = 'transient_503_then_match';
      const r7 = await adapter.verify({
        employeeId: 'e1',
        organizationId: 'o1',
        probeImageDataUrl: VALID_MINI_JPEG_DATA_URL,
        enrolledTemplateReference: 'emp sz6094',
        attemptNumber: 1,
      });
      assert.equal(callCount, 2);
      assert.equal(r7.matchStatus, 'VERIFIED');

      // 8. Bad API key error must NEVER leak secret key in failureReason
      scenario = 'bad_key_404';
      const r8 = await adapter.verify({
        employeeId: 'e1',
        organizationId: 'o1',
        probeImageDataUrl: VALID_MINI_JPEG_DATA_URL,
        enrolledTemplateReference: 'emp sz6094',
        attemptNumber: 1,
      });
      assert.equal(r8.matchStatus, 'FAILED');
      assert.equal(r8.livenessStatus, 'UNAVAILABLE');
      assert.ok(!r8.failureReason?.includes('test-compreface-secret-key-1234'));
    }
  );
});

test(
  'LIVE CompreFace 1.2.0 integration: verifies existing subjects without modifying them, wrong identity, no-face/unknown, and provider errors',
  { skip: env.FACE_PROVIDER !== 'compreface' },
  async () => {
    const baseUrl = env.COMPREFACE_BASE_URL;
    const apiKey = env.COMPREFACE_API_KEY;

    // Step 1: Verify existing subjects read-only ("emp sz6094" and "thrishank")
    const subjectsRes = await fetch(`${baseUrl}/api/v1/recognition/subjects`, {
      headers: { 'x-api-key': apiKey },
    });
    assert.equal(subjectsRes.status, 200, 'Expected live CompreFace subjects endpoint 200 OK');
    const subjectsBody = (await subjectsRes.json()) as { subjects: string[] };
    assert.deepEqual([...subjectsBody.subjects].sort(), ['emp sz6094', 'thrishank'].sort());

    // Fetch existing enrolled example image (read-only) for "emp sz6094"
    const facesRes = await fetch(`${baseUrl}/api/v1/recognition/faces?page=0&size=20`, {
      headers: { 'x-api-key': apiKey },
    });
    assert.equal(facesRes.status, 200);
    const facesBody = (await facesRes.json()) as {
      faces: Array<{ image_id: string; subject: string }>;
    };
    const empFace = facesBody.faces.find((f) => f.subject === 'emp sz6094');
    assert.ok(empFace, 'Expected at least one existing face example for subject "emp sz6094"');

    const imgRes = await fetch(`${baseUrl}/api/v1/recognition/faces/${empFace.image_id}/img`, {
      headers: { 'x-api-key': apiKey },
    });
    assert.equal(imgRes.status, 200);
    const imgBytes = Buffer.from(await imgRes.arrayBuffer());
    const realSelfieDataUrl = `data:image/jpeg;base64,${imgBytes.toString('base64')}`;

    // Step 2: Correct recognition against existing subject "emp sz6094"
    const correctRes = await defaultFaceVerificationAdapter.verify({
      employeeId: 'test-emp-sz6094',
      organizationId: 'test-org',
      probeImageDataUrl: realSelfieDataUrl,
      enrolledTemplateReference: 'compreface:emp sz6094',
      attemptNumber: 1,
    });
    assert.equal(correctRes.providerName, 'compreface');
    assert.equal(correctRes.matchStatus, 'VERIFIED');
    assert.equal(correctRes.livenessStatus, 'UNAVAILABLE');
    assert.ok(
      correctRes.confidenceScore !== null &&
        correctRes.confidenceScore >= env.COMPREFACE_SIMILARITY_THRESHOLD,
      `Expected similarity >= ${env.COMPREFACE_SIMILARITY_THRESHOLD}, got ${correctRes.confidenceScore}`
    );

    // Step 3: Wrong employee identity — submit "emp sz6094" face for second existing subject "thrishank"
    const wrongEmployeeRes = await defaultFaceVerificationAdapter.verify({
      employeeId: 'test-emp-thrishank',
      organizationId: 'test-org',
      probeImageDataUrl: realSelfieDataUrl,
      enrolledTemplateReference: 'compreface:thrishank',
      attemptNumber: 1,
    });
    assert.equal(wrongEmployeeRes.providerName, 'compreface');
    assert.equal(wrongEmployeeRes.matchStatus, 'MISMATCH');
    assert.equal(wrongEmployeeRes.livenessStatus, 'UNAVAILABLE');

    // Step 4: Unknown / un-enrolled target subject mismatch + No-face image (1x1 PNG)
    const unknownTargetRes = await defaultFaceVerificationAdapter.verify({
      employeeId: 'test-emp-unknown',
      organizationId: 'test-org',
      probeImageDataUrl: realSelfieDataUrl,
      enrolledTemplateReference: 'compreface:unregistered-subject',
      attemptNumber: 1,
    });
    assert.equal(unknownTargetRes.matchStatus, 'MISMATCH');

    const noFaceRes = await defaultFaceVerificationAdapter.verify({
      employeeId: 'test-emp-sz6094',
      organizationId: 'test-org',
      probeImageDataUrl: VALID_TINY_PNG_DATA_URL,
      enrolledTemplateReference: 'compreface:emp sz6094',
      attemptNumber: 1,
    });
    assert.equal(noFaceRes.matchStatus, 'FACE_NOT_DETECTED');
    assert.equal(noFaceRes.confidenceScore, null);

    // Step 5: Provider errors against live CompreFace (bad API key) & unreachable port
    const badKey = '00000000-0000-0000-0000-000000000000';
    const badKeyAdapter = new ConfiguredFaceVerificationAdapter({
      ...env,
      COMPREFACE_API_KEY: badKey,
      COMPREFACE_MAX_RETRIES: 0,
    });
    const badKeyRes = await badKeyAdapter.verify({
      employeeId: 'test-emp-sz6094',
      organizationId: 'test-org',
      probeImageDataUrl: realSelfieDataUrl,
      enrolledTemplateReference: 'compreface:emp sz6094',
      attemptNumber: 1,
    });
    assert.equal(badKeyRes.matchStatus, 'FAILED');
    assert.equal(badKeyRes.livenessStatus, 'UNAVAILABLE');
    assert.equal(badKeyRes.confidenceScore, null);
    assert.ok(!badKeyRes.failureReason?.includes(badKey));

    const unreachableAdapter = new ConfiguredFaceVerificationAdapter({
      ...env,
      COMPREFACE_BASE_URL: 'http://127.0.0.1:59999',
      COMPREFACE_TIMEOUT_MS: 800,
      COMPREFACE_MAX_RETRIES: 0,
    });
    const unreachableRes = await unreachableAdapter.verify({
      employeeId: 'test-emp-sz6094',
      organizationId: 'test-org',
      probeImageDataUrl: realSelfieDataUrl,
      enrolledTemplateReference: 'compreface:emp sz6094',
      attemptNumber: 1,
    });
    assert.equal(unreachableRes.matchStatus, 'FAILED');
    assert.equal(unreachableRes.livenessStatus, 'UNAVAILABLE');
    assert.equal(unreachableRes.confidenceScore, null);

    // Step 6: Confirm existing two test subjects were not modified
    const afterSubjectsRes = await fetch(`${baseUrl}/api/v1/recognition/subjects`, {
      headers: { 'x-api-key': apiKey },
    });
    const afterBody = (await afterSubjectsRes.json()) as { subjects: string[] };
    assert.deepEqual([...afterBody.subjects].sort(), ['emp sz6094', 'thrishank'].sort());
  }
);

test('Migration 00012 PostgreSQL constraints, RLS, active subject uniqueness, and immutable audit triggers (rolled back cleanly)', async () => {
  const pool = new pg.Pool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    connectionTimeoutMillis: 3000,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Resolve ORG001 via SECURITY DEFINER helper cleanly under hrms_app_user RLS
    const orgLookup = await client.query<{
      organization_id: string;
    }>(
      `SELECT id AS organization_id
       FROM public.resolve_organization_by_code('ORG001')
       LIMIT 1;`
    );
    const orgId = orgLookup.rows[0]?.organization_id;
    assert.ok(orgId, 'Expected ORG001 active organization in DB');

    await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId]);

    const adminRes = await client.query<{ user_id: string }>(
      `SELECT ur.user_id
       FROM public.user_roles ur
       WHERE ur.organization_id = $1::uuid
         AND ur.role = 'ADMIN'
       LIMIT 1;`,
      [orgId]
    );
    const adminUserId = adminRes.rows[0]?.user_id;
    assert.ok(adminUserId, 'Expected an active ADMIN user');

    // Set ADMIN user context so employees query satisfies RLS
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [adminUserId]);

    const empsRes = await client.query<{ id: string; user_id: string }>(
      `SELECT id, user_id
       FROM public.employees
       WHERE organization_id = $1::uuid
         AND employment_status NOT IN ('TERMINATED', 'RESIGNED')
       ORDER BY created_at ASC
       LIMIT 1;`,
      [orgId]
    );
    assert.ok(empsRes.rows.length >= 1, 'Expected at least 1 active employee in ORG001');
    const emp1 = empsRes.rows[0]!;

    const uniqueSubject = 'qa-rollback-subject-00012';

    // 1. Employee context cannot INSERT into face_provider_mappings (RLS denied)
    await client.query('SAVEPOINT sp_emp_rls');
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [emp1.user_id]);
    await assert.rejects(
      () =>
        client.query(
          `INSERT INTO public.face_provider_mappings (organization_id, employee_id, provider_subject)
           VALUES ($1::uuid, $2::uuid, $3::varchar)`,
          [orgId, emp1.id, uniqueSubject]
        ),
      /42501|row-level security/i
    );
    await client.query('ROLLBACK TO SAVEPOINT sp_emp_rls');

    // Restore ADMIN user context and clear any pre-existing active mapping in this rolled-back tx
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [adminUserId]);
    await client.query(
      `UPDATE public.face_provider_mappings
          SET status = 'REVOKED',
              revoked_at = NOW(),
              revoked_reason = 'Rolled-back test fixture isolation'
        WHERE organization_id = $1::uuid
          AND employee_id = $2::uuid
          AND status = 'ACTIVE';`,
      [orgId, emp1.id]
    );
    const ins1 = await client.query<{ id: string }>(
      `INSERT INTO public.face_provider_mappings (organization_id, employee_id, provider_subject, notes)
       VALUES ($1::uuid, $2::uuid, $3::varchar, 'Migration 00012 test')
       RETURNING id;`,
      [orgId, emp1.id, uniqueSubject]
    );
    const mappingId = ins1.rows[0]!.id;

    // 2. Audit log automatically written for FACE_SUBJECT_MAPPING_ASSIGNED
    const auditIns = await client.query<{ action: string }>(
      `SELECT action FROM public.audit_logs
       WHERE organization_id = $1::uuid AND entity_type = 'BIOMETRIC_MAPPING' AND entity_id = $2::uuid`,
      [orgId, mappingId]
    );
    assert.equal(auditIns.rows[0]?.action, 'FACE_SUBJECT_MAPPING_ASSIGNED');

    // 3. Employee self-SELECT isolation: emp1 sees own mapping
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [emp1.user_id]);
    const emp1Self = await client.query(`SELECT id FROM public.face_provider_mappings WHERE id = $1::uuid`, [
      mappingId,
    ]);
    assert.equal(emp1Self.rows.length, 1);

    // Restore ADMIN user context
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [adminUserId]);

    // 4. Same employee cannot receive a second active CompreFace subject
    await client.query('SAVEPOINT sp_dup_emp');
    await assert.rejects(
      () =>
        client.query(
          `INSERT INTO public.face_provider_mappings (organization_id, employee_id, provider_subject)
           VALUES ($1::uuid, $2::uuid, 'qa-rollback-other-subject')`,
          [orgId, emp1.id]
        ),
      (err: unknown) => (err as { code?: string }).code === '23505'
    );
    await client.query('ROLLBACK TO SAVEPOINT sp_dup_emp');

    // 5. Cross-tenant SELECT isolation under FORCE ROW LEVEL SECURITY
    await client.query(`SELECT set_config('app.current_org_id', '00000000-0000-0000-0000-000000000999', true)`);
    const crossTenant = await client.query(`SELECT id FROM public.face_provider_mappings WHERE id = $1::uuid`, [
      mappingId,
    ]);
    assert.equal(crossTenant.rows.length, 0);

    // 6. Revoke frees the subject for reassignment and appends FACE_SUBJECT_MAPPING_REVOKED audit log
    await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId]);
    await client.query(
      `UPDATE public.face_provider_mappings SET status = 'REVOKED', revoked_reason = 'Rotation test' WHERE id = $1::uuid`,
      [mappingId]
    );
    const auditRev = await client.query<{ action: string }>(
      `SELECT action FROM public.audit_logs
       WHERE organization_id = $1::uuid AND entity_type = 'BIOMETRIC_MAPPING' AND entity_id = $2::uuid`,
      [orgId, mappingId]
    );
    assert.deepEqual(
      auditRev.rows.map((r) => r.action).sort(),
      ['FACE_SUBJECT_MAPPING_ASSIGNED', 'FACE_SUBJECT_MAPPING_REVOKED']
    );

    // Reassigning freed subject to emp1 now succeeds inside transaction
    const ins2 = await client.query<{ id: string }>(
      `INSERT INTO public.face_provider_mappings (organization_id, employee_id, provider_subject)
       VALUES ($1::uuid, $2::uuid, $3::varchar)
       RETURNING id;`,
      [orgId, emp1.id, uniqueSubject]
    );
    assert.ok(ins2.rows[0]?.id);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
