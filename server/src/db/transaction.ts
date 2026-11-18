import pg from 'pg';
import { logger } from '../utils/logger.js';
import { getPool } from './pool.js';
import { mapDatabaseError, TenantContextError } from './errors.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Standard RFC 4122 UUID validation regular expression.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates whether a given string is a syntactically valid UUID.
 */
export function isValidUuid(id: string): boolean {
  if (typeof id !== 'string') {
    return false;
  }
  return UUID_REGEX.test(id.trim());
}

/**
 * Executes an arbitrary callback within a generic database transaction.
 * Automatically executes BEGIN, COMMIT on success, ROLLBACK on error,
 * and guarantees connection release back to the pool.
 */
export async function withTransaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>,
  pool: pg.Pool = getPool()
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.warn('Failed to execute ROLLBACK on client connection', {
        error: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
      });
    }
    if (err instanceof AppError) {
      throw err;
    }
    throw mapDatabaseError(err);
  } finally {
    client.release();
  }
}

/**
 * Executes a callback within a strict tenant-isolated transaction.
 * 
 * Sets transaction-local context strictly using PostgreSQL's set_config with is_local=true
 * (equivalent to SET LOCAL app.current_org_id = $1).
 * 
 * Guarantees:
 * 1. Validates orgId and optional userId as RFC 4122 UUIDs before query execution.
 * 2. Scoped strictly to the current transaction (automatically discarded upon COMMIT/ROLLBACK).
 * 3. Never uses session-level SET (preventing cross-connection context leakage in the pool).
 * 4. Automatic ROLLBACK on callback exception.
 * 5. Guaranteed client.release() in finally block.
 */
export async function withTenantTransaction<T>(
  orgId: string,
  callback: (client: pg.PoolClient) => Promise<T>,
  userId?: string,
  pool: pg.Pool = getPool()
): Promise<T> {
  if (!orgId || !isValidUuid(orgId)) {
    throw new TenantContextError(
      `Invalid tenant organization ID: expected RFC 4122 UUID format, received '${orgId}'`
    );
  }

  if (userId !== undefined && (!userId || !isValidUuid(userId))) {
    throw new TenantContextError(
      `Invalid user ID: expected RFC 4122 UUID format, received '${userId}'`
    );
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Establish transaction-local tenant context (SET LOCAL via parameterized set_config)
    await client.query('SELECT set_config($1, $2, true);', ['app.current_org_id', orgId.trim()]);

    if (userId) {
      await client.query('SELECT set_config($1, $2, true);', ['app.current_user_id', userId.trim()]);
    }

    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.warn('Failed to execute ROLLBACK on tenant client connection', {
        error: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
      });
    }
    if (err instanceof AppError) {
      throw err;
    }
    throw mapDatabaseError(err);
  } finally {
    client.release();
  }
}
