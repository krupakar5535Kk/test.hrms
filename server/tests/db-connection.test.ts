import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {
  loadEnvConfig,
  env,
} from '../src/config/env.js';
import {
  DatabaseError,
  UniqueConstraintViolationError,
  ForeignKeyViolationError,
  CheckConstraintViolationError,
  NotNullViolationError,
  InsufficientPrivilegeError,
  DatabaseConnectionError,
  TenantContextError,
  mapDatabaseError,
  PG_ERROR_CODES,
} from '../src/db/errors.js';
import {
  getPool,
  closePool,
  checkDatabaseHealth,
  _resetPoolForTesting,
} from '../src/db/pool.js';
import {
  isValidUuid,
  withTransaction,
  withTenantTransaction,
} from '../src/db/transaction.js';

// ==============================================================================
// 1. CONFIGURATION & ENVIRONMENT VALIDATION TESTS
// ==============================================================================

test('DB Config: Validates default database connection configuration', () => {
  const config = loadEnvConfig();
  assert.equal(typeof config.DB_HOST, 'string');
  assert.equal(typeof config.DB_PORT, 'number');
  assert.equal(config.DB_PORT, 54322);
  assert.equal(config.DB_NAME, 'postgres');
  assert.equal(config.DB_USER, 'hrms_app_user');
  assert.equal(typeof config.DB_PASSWORD, 'string');
  assert.equal(config.DB_POOL_MAX, 10);
  assert.equal(config.DB_POOL_IDLE_TIMEOUT_MS, 10000);
  assert.equal(config.DB_CONNECTION_TIMEOUT_MS, 5000);
});

test('DB Config: Rejects invalid DB_PORT values', () => {
  const original = process.env['DB_PORT'];
  try {
    process.env['DB_PORT'] = '99999';
    assert.throws(() => loadEnvConfig(), /Invalid DB_PORT environment variable/);

    process.env['DB_PORT'] = '0';
    assert.throws(() => loadEnvConfig(), /Invalid DB_PORT environment variable/);

    process.env['DB_PORT'] = 'abc';
    assert.throws(() => loadEnvConfig(), /Invalid DB_PORT environment variable/);
  } finally {
    if (original !== undefined) {
      process.env['DB_PORT'] = original;
    } else {
      delete process.env['DB_PORT'];
    }
  }
});

test('DB Config: Rejects invalid DB_POOL_MAX values', () => {
  const original = process.env['DB_POOL_MAX'];
  try {
    process.env['DB_POOL_MAX'] = '0';
    assert.throws(() => loadEnvConfig(), /Invalid DB_POOL_MAX environment variable/);

    process.env['DB_POOL_MAX'] = '150';
    assert.throws(() => loadEnvConfig(), /Invalid DB_POOL_MAX environment variable/);
  } finally {
    if (original !== undefined) {
      process.env['DB_POOL_MAX'] = original;
    } else {
      delete process.env['DB_POOL_MAX'];
    }
  }
});

// ==============================================================================
// 2. CENTRALIZED DATABASE ERROR HANDLING TESTS
// ==============================================================================

test('DB Errors: Maps SQLSTATE 23505 to UniqueConstraintViolationError', () => {
  const rawPgError = {
    code: PG_ERROR_CODES.UNIQUE_VIOLATION,
    message: 'duplicate key value violates unique constraint "organizations_organization_code_key"',
    detail: 'Key (lower(organization_code))=(demo) already exists.',
    table: 'organizations',
    constraint: 'organizations_organization_code_key',
  };

  const mapped = mapDatabaseError(rawPgError);
  assert(mapped instanceof UniqueConstraintViolationError);
  assert.equal(mapped.code, 'UNIQUE_VIOLATION');
  assert.equal(mapped.sqlState, '23505');
  assert.equal(mapped.table, 'organizations');
  assert.equal(mapped.constraint, 'organizations_organization_code_key');
  assert.equal(mapped.detail, rawPgError.detail);
});

test('DB Errors: Maps SQLSTATE 23503 to ForeignKeyViolationError', () => {
  const rawPgError = {
    code: PG_ERROR_CODES.FOREIGN_KEY_VIOLATION,
    message: 'insert or update on table "users" violates foreign key constraint "users_organization_id_fkey"',
    detail: 'Key (organization_id)=(00000000-0000-0000-0000-000000000000) is not present in table "organizations".',
    table: 'users',
    constraint: 'users_organization_id_fkey',
  };

  const mapped = mapDatabaseError(rawPgError);
  assert(mapped instanceof ForeignKeyViolationError);
  assert.equal(mapped.code, 'FOREIGN_KEY_VIOLATION');
  assert.equal(mapped.sqlState, '23503');
  assert.equal(mapped.table, 'users');
});

test('DB Errors: Maps SQLSTATE 23514 to CheckConstraintViolationError', () => {
  const rawPgError = {
    code: PG_ERROR_CODES.CHECK_VIOLATION,
    message: 'new row for table "account_provisioning_requests" violates check constraint "chk_prov_maker_checker_distinct"',
    table: 'account_provisioning_requests',
    constraint: 'chk_prov_maker_checker_distinct',
  };

  const mapped = mapDatabaseError(rawPgError);
  assert(mapped instanceof CheckConstraintViolationError);
  assert.equal(mapped.code, 'CHECK_VIOLATION');
  assert.equal(mapped.sqlState, '23514');
  assert.equal(mapped.constraint, 'chk_prov_maker_checker_distinct');
});

test('DB Errors: Maps SQLSTATE 23502 to NotNullViolationError', () => {
  const rawPgError = {
    code: PG_ERROR_CODES.NOT_NULL_VIOLATION,
    message: 'null value in column "organization_id" of relation "users" violates not-null constraint',
    table: 'users',
  };

  const mapped = mapDatabaseError(rawPgError);
  assert(mapped instanceof NotNullViolationError);
  assert.equal(mapped.code, 'NOT_NULL_VIOLATION');
  assert.equal(mapped.sqlState, '23502');
});

test('DB Errors: Maps SQLSTATE 42501 to InsufficientPrivilegeError', () => {
  const rawPgError = {
    code: PG_ERROR_CODES.INSUFFICIENT_PRIVILEGE,
    message: 'permission denied for table organizations (runtime connection role locked)',
    table: 'organizations',
  };

  const mapped = mapDatabaseError(rawPgError);
  assert(mapped instanceof InsufficientPrivilegeError);
  assert.equal(mapped.code, 'INSUFFICIENT_PRIVILEGE');
  assert.equal(mapped.sqlState, '42501');
});

test('DB Errors: Maps connection failure SQLSTATEs (08006, 28P01) to DatabaseConnectionError', () => {
  const authErr = {
    code: PG_ERROR_CODES.INVALID_PASSWORD,
    message: 'password authentication failed for user "hrms_app_user"',
  };
  const mappedAuth = mapDatabaseError(authErr);
  assert(mappedAuth instanceof DatabaseConnectionError);
  assert.equal(mappedAuth.code, 'DATABASE_CONNECTION_ERROR');

  const connErr = {
    code: PG_ERROR_CODES.CONNECTION_FAILURE,
    message: 'connection to server was lost',
  };
  const mappedConn = mapDatabaseError(connErr);
  assert(mappedConn instanceof DatabaseConnectionError);
  assert.equal(mappedConn.code, 'DATABASE_CONNECTION_ERROR');
});

test('DB Errors: Idempotently returns existing DatabaseError instances', () => {
  const original = new TenantContextError('Context error');
  const mapped = mapDatabaseError(original);
  assert.equal(mapped, original);
});

// ==============================================================================
// 3. TENANT CONTEXT & UUID VALIDATION TESTS
// ==============================================================================

test('UUID Validation: Accepts valid RFC 4122 UUIDs', () => {
  assert.equal(isValidUuid('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'), true);
  assert.equal(isValidUuid('A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11'), true);
  assert.equal(isValidUuid('b2c3d4e5-6f7a-4b8c-9d0e-1f2a3b4c5d6e'), true);
});

test('UUID Validation: Rejects empty, malformed, or injected strings', () => {
  assert.equal(isValidUuid(''), false);
  assert.equal(isValidUuid('   '), false);
  assert.equal(isValidUuid('not-a-uuid'), false);
  assert.equal(isValidUuid('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a1'), false); // too short
  assert.equal(isValidUuid('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a111'), false); // too long
  assert.equal(isValidUuid("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'; DROP TABLE users;--"), false);
  assert.equal(isValidUuid(null as unknown as string), false);
  assert.equal(isValidUuid(undefined as unknown as string), false);
});

test('Tenant Context: withTenantTransaction throws TenantContextError on invalid orgId without connecting', async () => {
  let connectCalled = false;
  const mockPool = {
    connect: async () => {
      connectCalled = true;
      throw new Error('Should not be called');
    },
  } as unknown as pg.Pool;

  await assert.rejects(
    async () => {
      await withTenantTransaction('invalid-uuid', async () => {}, undefined, mockPool);
    },
    (err: unknown) => {
      assert(err instanceof TenantContextError);
      assert(err.message.includes('Invalid tenant organization ID'));
      return true;
    }
  );

  assert.equal(connectCalled, false, 'Database client must not be checked out for invalid orgId');
});

test('Tenant Context: withTenantTransaction throws TenantContextError on invalid userId without connecting', async () => {
  let connectCalled = false;
  const mockPool = {
    connect: async () => {
      connectCalled = true;
      throw new Error('Should not be called');
    },
  } as unknown as pg.Pool;

  await assert.rejects(
    async () => {
      await withTenantTransaction(
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        async () => {},
        'malformed-user-uuid',
        mockPool
      );
    },
    (err: unknown) => {
      assert(err instanceof TenantContextError);
      assert(err.message.includes('Invalid user ID'));
      return true;
    }
  );

  assert.equal(connectCalled, false, 'Database client must not be checked out for invalid userId');
});

// ==============================================================================
// 4. TRANSACTION LIFECYCLE & ISOLATION SIMULATION TESTS
// ==============================================================================

test('Transaction: withTransaction executes BEGIN, commit, and guarantees client release on success', async () => {
  const executedQueries: Array<{ sql: string; values?: unknown[] }> = [];
  let clientReleased = false;

  const mockClient = {
    query: async (sql: string, values?: unknown[]) => {
      executedQueries.push({ sql, values });
      return { rows: [] };
    },
    release: () => {
      clientReleased = true;
    },
  };

  const mockPool = {
    connect: async () => mockClient as unknown as pg.PoolClient,
  } as unknown as pg.Pool;

  const result = await withTransaction(async (client) => {
    await client.query('SELECT 1;');
    return 'transaction_success';
  }, mockPool);

  assert.equal(result, 'transaction_success');
  assert.equal(clientReleased, true, 'Client must be released after commit');
  assert.deepEqual(
    executedQueries.map((q) => q.sql),
    ['BEGIN', 'SELECT 1;', 'COMMIT']
  );
});

test('Transaction: withTransaction executes ROLLBACK and releases client on callback failure', async () => {
  const executedQueries: Array<{ sql: string; values?: unknown[] }> = [];
  let clientReleased = false;

  const mockClient = {
    query: async (sql: string, values?: unknown[]) => {
      executedQueries.push({ sql, values });
      return { rows: [] };
    },
    release: () => {
      clientReleased = true;
    },
  };

  const mockPool = {
    connect: async () => mockClient as unknown as pg.PoolClient,
  } as unknown as pg.Pool;

  await assert.rejects(
    async () => {
      await withTransaction(async (client) => {
        await client.query('INSERT INTO fail_table VALUES(1);');
        const err = new Error('simulated query error');
        (err as Record<string, unknown>)['code'] = PG_ERROR_CODES.UNIQUE_VIOLATION;
        throw err;
      }, mockPool);
    },
    (err: unknown) => {
      assert(err instanceof UniqueConstraintViolationError);
      return true;
    }
  );

  assert.equal(clientReleased, true, 'Client must be released on failure');
  assert.deepEqual(
    executedQueries.map((q) => q.sql),
    ['BEGIN', 'INSERT INTO fail_table VALUES(1);', 'ROLLBACK']
  );
});

test('Tenant Transaction: withTenantTransaction sets app.current_org_id using SET LOCAL and releases client', async () => {
  const executedQueries: Array<{ sql: string; values?: unknown[] }> = [];
  let clientReleased = false;

  const mockClient = {
    query: async (sql: string, values?: unknown[]) => {
      executedQueries.push({ sql, values });
      return { rows: [] };
    },
    release: () => {
      clientReleased = true;
    },
  };

  const mockPool = {
    connect: async () => mockClient as unknown as pg.PoolClient,
  } as unknown as pg.Pool;

  const testOrgId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const testUserId = 'b2c3d4e5-6f7a-4b8c-9d0e-1f2a3b4c5d6e';

  await withTenantTransaction(
    testOrgId,
    async (client) => {
      await client.query('SELECT * FROM users;');
    },
    testUserId,
    mockPool
  );

  assert.equal(clientReleased, true);
  assert.equal(executedQueries[0]?.sql, 'BEGIN');
  assert.equal(executedQueries[1]?.sql, 'SELECT set_config($1, $2, true);');
  assert.deepEqual(executedQueries[1]?.values, ['app.current_org_id', testOrgId]);
  assert.equal(executedQueries[2]?.sql, 'SELECT set_config($1, $2, true);');
  assert.deepEqual(executedQueries[2]?.values, ['app.current_user_id', testUserId]);
  assert.equal(executedQueries[3]?.sql, 'SELECT * FROM users;');
  assert.equal(executedQueries[4]?.sql, 'COMMIT');
});

test('Tenant Context Isolation: Context is transaction-local and automatically cleared after transaction', async () => {
  // Simulates pooled connection reuse where connection returns to pool and is reused
  const connectionSessionGUCs = new Map<string, string>();
  let inTransaction = false;
  let transactionLocalGUCs = new Map<string, string>();

  const createSimulatedClient = () => ({
    query: async (sql: string, values?: unknown[]) => {
      if (sql === 'BEGIN') {
        inTransaction = true;
        transactionLocalGUCs = new Map();
        return { rows: [] };
      }
      if (sql === 'COMMIT' || sql === 'ROLLBACK') {
        inTransaction = false;
        transactionLocalGUCs.clear(); // Transaction-local settings automatically discard!
        return { rows: [] };
      }
      if (sql === 'SELECT set_config($1, $2, true);') {
        assert(inTransaction, 'set_config with is_local=true requires active transaction');
        const param = values?.[0] as string;
        const val = values?.[1] as string;
        transactionLocalGUCs.set(param, val);
        return { rows: [] };
      }
      if (sql === 'SELECT current_org_id()') {
        const orgId = inTransaction
          ? transactionLocalGUCs.get('app.current_org_id') ?? null
          : connectionSessionGUCs.get('app.current_org_id') ?? null;
        return { rows: [{ current_org_id: orgId }] };
      }
      return { rows: [] };
    },
    release: () => {},
  });

  const client = createSimulatedClient();
  const mockPool = {
    connect: async () => client as unknown as pg.PoolClient,
  } as unknown as pg.Pool;

  const orgA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const orgB = 'b2c3d4e5-6f7a-4b8c-9d0e-1f2a3b4c5d6e';

  // 1. Transaction A executes with Org A
  await withTenantTransaction(
    orgA,
    async (c) => {
      const res = await c.query('SELECT current_org_id()');
      assert.equal(res.rows[0]?.current_org_id, orgA);
    },
    undefined,
    mockPool
  );

  // 2. Outside transaction on the same client, current_org_id must be null (no leakage!)
  const idleRes = await client.query('SELECT current_org_id()');
  assert.equal(idleRes.rows[0]?.current_org_id, null, 'Context must NOT leak into idle pooled connection');

  // 3. Transaction B executes with Org B
  await withTenantTransaction(
    orgB,
    async (c) => {
      const res = await c.query('SELECT current_org_id()');
      assert.equal(res.rows[0]?.current_org_id, orgB);
    },
    undefined,
    mockPool
  );

  // 4. Idle client again has null context
  const idleResAfter = await client.query('SELECT current_org_id()');
  assert.equal(idleResAfter.rows[0]?.current_org_id, null, 'Context must NOT persist after transaction B');
});

// ==============================================================================
// 5. POOL LIFECYCLE & SHUTDOWN TESTS
// ==============================================================================

test('Pool Lifecycle: getPool initializes singleton and closePool drains it', async () => {
  await _resetPoolForTesting(null);
  const pool = getPool();
  assert(pool instanceof pg.Pool);

  const poolAgain = getPool();
  assert.equal(pool, poolAgain, 'getPool must return singleton instance');

  await closePool();
  // Pool is terminated; subsequent getPool should initialize fresh
  const freshPool = getPool();
  assert(freshPool instanceof pg.Pool);
  assert.notEqual(freshPool, pool);
  await closePool();
});

// ==============================================================================
// 6. LIVE DATABASE ENGINE INSPECTION & CREDENTIAL BOUNDARY TESTS
// ==============================================================================

test('Live Engine Boundary: Application connection layer enforces hrms_app_user runtime role', async () => {
  // Verifies that env.DB_USER is configured strictly as hrms_app_user, NEVER postgres
  assert.equal(
    env.DB_USER,
    'hrms_app_user',
    'Runtime connection role must strictly be hrms_app_user'
  );
  assert.notEqual(
    env.DB_USER,
    'postgres',
    'Runtime connection role must NEVER be postgres (elevated role prohibited)'
  );
});

test('Live Engine: Connection pool authenticates as hrms_app_user and verifies health', async () => {
  const health = await checkDatabaseHealth();
  assert.equal(health.healthy, true, `Database health check failed: ${health.error}`);
  assert.equal(health.currentUser, 'hrms_app_user', 'Health check must report currentUser = hrms_app_user');
  assert(typeof health.latencyMs === 'number' && health.latencyMs >= 0, 'Must record query latency');
});

test('Live Engine: Confirms current_user is hrms_app_user and database is postgres (never postgres user)', async () => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const res = await client.query<{ current_user: string; current_database: string; session_user: string }>(
      'SELECT CURRENT_USER AS current_user, CURRENT_DATABASE() AS current_database, session_user;'
    );
    const row = res.rows[0];
    assert.equal(row?.current_user, 'hrms_app_user', 'current_user must be hrms_app_user');
    assert.equal(row?.session_user, 'hrms_app_user', 'session_user must be hrms_app_user');
    assert.equal(row?.current_database, 'postgres', 'current_database must be postgres');

    // Confirm that postgres user is NOT active
    assert.notEqual(row?.current_user, 'postgres');
    assert.notEqual(row?.session_user, 'postgres');

    // Harmless query execution
    const mathRes = await client.query('SELECT 42 AS answer, NOW() AS server_time;');
    assert.equal(mathRes.rows[0]?.answer, 42);
  } finally {
    client.release();
  }
});

test('Live Engine: withTransaction executes BEGIN, queries, and COMMITs cleanly on live engine', async () => {
  const result = await withTransaction(async (client) => {
    const txRes = await client.query<{ tx_active: boolean }>(
      'SELECT pg_is_in_recovery() AS tx_active;'
    );
    assert.equal(typeof txRes.rows[0]?.tx_active, 'boolean');
    return 'commit_success';
  });
  assert.equal(result, 'commit_success');
});

test('Live Engine: withTransaction executes ROLLBACK on error and bubbles mapped DatabaseError', async () => {
  await assert.rejects(
    async () => {
      await withTransaction(async (client) => {
        // Run a deliberate query error
        await client.query('SELECT * FROM non_existent_table_for_rollback_test;');
      });
    },
    (err: unknown) => {
      assert(err instanceof DatabaseError);
      return true;
    }
  );
});

test('Live Engine: withTenantTransaction sets app.current_org_id locally and current_org_id() reads it', async () => {
  const disposableOrgId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  await withTenantTransaction(disposableOrgId, async (client) => {
    const res = await client.query<{ guc_val: string; func_val: string }>(
      "SELECT current_setting('app.current_org_id', true) AS guc_val, current_org_id()::text AS func_val;"
    );
    assert.equal(res.rows[0]?.guc_val, disposableOrgId);
    assert.equal(res.rows[0]?.func_val, disposableOrgId);
  });
});

test('Live Engine: Tenant context is strictly transaction-local and automatically cleared after transaction', async () => {
  const disposableOrgId = 'b2c3d4e5-6f7a-4b8c-9d0e-1f2a3b4c5d6e';

  // 1. Run transaction setting tenant context
  await withTenantTransaction(disposableOrgId, async (client) => {
    const res = await client.query<{ guc_val: string }>(
      "SELECT current_setting('app.current_org_id', true) AS guc_val;"
    );
    assert.equal(res.rows[0]?.guc_val, disposableOrgId);
  });

  // 2. Query pool outside of transaction — context must be null/empty
  const pool = getPool();
  const client = await pool.connect();
  try {
    const res = await client.query<{ guc_val: string | null; func_val: string | null }>(
      "SELECT NULLIF(current_setting('app.current_org_id', true), '') AS guc_val, current_org_id()::text AS func_val;"
    );
    assert.equal(res.rows[0]?.guc_val, null, 'GUC must NOT persist after transaction commit');
    assert.equal(res.rows[0]?.func_val, null, 'current_org_id() must be NULL outside of transaction');
  } finally {
    client.release();
  }
});

test('Live Engine: Connection release guaranteed without pool leaks on success and failure', async () => {
  const pool = getPool();
  const initialWaiting = pool.waitingCount;

  // Run success
  await withTransaction(async (c) => {
    await c.query('SELECT 1;');
  });
  assert.equal(pool.waitingCount, initialWaiting);

  // Run failure
  try {
    await withTransaction(async (c) => {
      await c.query('SELECT 1;');
      throw new Error('deliberate failure');
    });
  } catch {
    // Expected
  }
  assert.equal(pool.waitingCount, initialWaiting);
});

test('Live Engine: Runtime role hrms_app_user cannot perform privileged mutations (SQLSTATE 42501)', async () => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    // 1. Attempt INSERT into organizations
    await assert.rejects(
      async () => {
        await client.query(
          "INSERT INTO organizations (id, organization_code, name, selfie_retention_days) VALUES (gen_random_uuid(), 'ILLEGAL', 'Illegal Org', 30);"
        );
      },
      (err: unknown) => {
        const mapped = mapDatabaseError(err);
        assert(mapped instanceof InsufficientPrivilegeError, `Expected InsufficientPrivilegeError, got ${mapped.name}`);
        assert.equal(mapped.sqlState, PG_ERROR_CODES.INSUFFICIENT_PRIVILEGE);
        return true;
      }
    );

    // 2. Attempt INSERT into users
    await assert.rejects(
      async () => {
        await client.query(
          "INSERT INTO users (id, organization_id, phone_number) VALUES (gen_random_uuid(), gen_random_uuid(), '+919999999999');"
        );
      },
      (err: unknown) => {
        const mapped = mapDatabaseError(err);
        assert(mapped instanceof InsufficientPrivilegeError, `Expected InsufficientPrivilegeError, got ${mapped.name}`);
        assert.equal(mapped.sqlState, PG_ERROR_CODES.INSUFFICIENT_PRIVILEGE);
        return true;
      }
    );

    // 3. Attempt INSERT into user_roles
    await assert.rejects(
      async () => {
        await client.query(
          "INSERT INTO user_roles (organization_id, user_id, role) VALUES (gen_random_uuid(), gen_random_uuid(), 'EMPLOYEE');"
        );
      },
      (err: unknown) => {
        const mapped = mapDatabaseError(err);
        assert(mapped instanceof InsufficientPrivilegeError, `Expected InsufficientPrivilegeError, got ${mapped.name}`);
        assert.equal(mapped.sqlState, PG_ERROR_CODES.INSUFFICIENT_PRIVILEGE);
        return true;
      }
    );
  } finally {
    client.release();
  }
});

test('Live Engine: hrms_app_user can execute resolve_organization_by_code function without error', async () => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const res = await client.query(
      'SELECT * FROM resolve_organization_by_code($1);',
      ['NONEXISTENT']
    );
    // Returns 0 rows for unknown organization without throwing privilege or RLS error
    assert.equal(res.rows.length, 0);
  } finally {
    client.release();
  }
});

after(async () => {
  await closePool();
});
