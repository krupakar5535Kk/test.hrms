import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { mapDatabaseError } from './errors.js';

const { Pool } = pg;

let poolInstance: pg.Pool | null = null;

/**
 * Creates or retrieves the singleton PostgreSQL connection pool.
 * Application connections strictly use hrms_app_user (never postgres).
 */
export function getPool(): pg.Pool {
  if (poolInstance) {
    return poolInstance;
  }

  poolInstance = new Pool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    ssl:
      env.DB_SSL === 'false'
        ? false
        : {
            rejectUnauthorized: env.DB_SSL === 'require',
          },
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: env.DB_POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
  });

  // Attach pool-level error handler to catch unexpected idle client errors
  poolInstance.on('error', (err: Error) => {
    logger.error('Unexpected error on idle database connection client', {
      error: err.message,
      name: err.name,
      code: (err as unknown as Record<string, unknown>)['code'],
    });
  });

  return poolInstance;
}

/**
 * Drains and terminates all active and idle clients in the pool.
 * Used during graceful application shutdown.
 */
export async function closePool(): Promise<void> {
  if (!poolInstance) {
    return;
  }

  const poolToClose = poolInstance;
  poolInstance = null;

  try {
    await poolToClose.end();
    logger.info('Database connection pool closed successfully');
  } catch (err) {
    logger.error('Error during database connection pool shutdown', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw mapDatabaseError(err);
  }
}

/**
 * Performs a lightweight health check query against the database.
 * Returns health status and round-trip query latency without exposing credentials.
 */
export async function checkDatabaseHealth(): Promise<{
  healthy: boolean;
  latencyMs?: number;
  currentUser?: string;
  error?: string;
}> {
  const pool = getPool();
  const startTime = Date.now();

  try {
    const result = await pool.query<{ healthy_check: number; current_user: string }>(
      'SELECT 1 AS healthy_check, CURRENT_USER AS current_user;'
    );
    const latencyMs = Date.now() - startTime;
    const currentUser = result.rows[0]?.current_user;

    return {
      healthy: true,
      latencyMs,
      currentUser,
    };
  } catch (err) {
    const dbErr = mapDatabaseError(err);
    return {
      healthy: false,
      error: dbErr.message,
    };
  }
}

/**
 * Test helper to reset the singleton pool instance.
 * Strictly intended for test suites that reconfigure environment or mock pools.
 */
export async function _resetPoolForTesting(newPool?: pg.Pool | null): Promise<void> {
  if (poolInstance && poolInstance !== newPool) {
    try {
      await poolInstance.end();
    } catch {
      // Ignore cleanup error during test teardown
    }
  }
  poolInstance = newPool ?? null;
}
