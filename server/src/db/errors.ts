/**
 * Centralized Database Error Hierarchy & Error Mapping
 * 
 * Maps PostgreSQL SQLSTATE error codes to typed application errors,
 * preventing SQL/credential details from leaking into client responses.
 */

export const PG_ERROR_CODES = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  NOT_NULL_VIOLATION: '23502',
  INSUFFICIENT_PRIVILEGE: '42501',
  INVALID_PASSWORD: '28P01',
  CONNECTION_EXCEPTION: '08000',
  CANNOT_CONNECT_NOW: '08001',
  CONNECTION_DOES_NOT_EXIST: '08003',
  SQLCLIENT_UNABLE_TO_ESTABLISH: '08004',
  CONNECTION_FAILURE: '08006',
} as const;

export class DatabaseError extends Error {
  public readonly code: string;
  public readonly sqlState?: string;
  public readonly detail?: string;
  public readonly table?: string;
  public readonly constraint?: string;

  constructor(
    message: string,
    options?: {
      code?: string;
      sqlState?: string;
      detail?: string;
      table?: string;
      constraint?: string;
      cause?: unknown;
    }
  ) {
    super(message);
    this.name = 'DatabaseError';
    this.code = options?.code ?? 'DATABASE_ERROR';
    this.sqlState = options?.sqlState;
    this.detail = options?.detail;
    this.table = options?.table;
    this.constraint = options?.constraint;
    if (options?.cause) {
      this.cause = options.cause;
    }
  }
}

export class UniqueConstraintViolationError extends DatabaseError {
  constructor(message: string, options?: { sqlState?: string; detail?: string; table?: string; constraint?: string; cause?: unknown }) {
    super(message, { ...options, code: 'UNIQUE_VIOLATION' });
    this.name = 'UniqueConstraintViolationError';
  }
}

export class ForeignKeyViolationError extends DatabaseError {
  constructor(message: string, options?: { sqlState?: string; detail?: string; table?: string; constraint?: string; cause?: unknown }) {
    super(message, { ...options, code: 'FOREIGN_KEY_VIOLATION' });
    this.name = 'ForeignKeyViolationError';
  }
}

export class CheckConstraintViolationError extends DatabaseError {
  constructor(message: string, options?: { sqlState?: string; detail?: string; table?: string; constraint?: string; cause?: unknown }) {
    super(message, { ...options, code: 'CHECK_VIOLATION' });
    this.name = 'CheckConstraintViolationError';
  }
}

export class NotNullViolationError extends DatabaseError {
  constructor(message: string, options?: { sqlState?: string; detail?: string; table?: string; constraint?: string; cause?: unknown }) {
    super(message, { ...options, code: 'NOT_NULL_VIOLATION' });
    this.name = 'NotNullViolationError';
  }
}

export class InsufficientPrivilegeError extends DatabaseError {
  constructor(message: string, options?: { sqlState?: string; detail?: string; table?: string; constraint?: string; cause?: unknown }) {
    super(message, { ...options, code: 'INSUFFICIENT_PRIVILEGE' });
    this.name = 'InsufficientPrivilegeError';
  }
}

export class DatabaseConnectionError extends DatabaseError {
  constructor(message: string, options?: { sqlState?: string; detail?: string; cause?: unknown }) {
    super(message, { ...options, code: 'DATABASE_CONNECTION_ERROR' });
    this.name = 'DatabaseConnectionError';
  }
}

export class TenantContextError extends DatabaseError {
  constructor(message: string, options?: { detail?: string; cause?: unknown }) {
    super(message, { ...options, code: 'TENANT_CONTEXT_ERROR' });
    this.name = 'TenantContextError';
  }
}

export class TransactionError extends DatabaseError {
  constructor(message: string, options?: { sqlState?: string; detail?: string; cause?: unknown }) {
    super(message, { ...options, code: 'TRANSACTION_ERROR' });
    this.name = 'TransactionError';
  }
}

/**
 * Maps PostgreSQL errors and unknown errors to typed DatabaseError subclasses.
 */
export function mapDatabaseError(err: unknown): DatabaseError {
  if (err instanceof DatabaseError) {
    return err;
  }

  if (typeof err === 'object' && err !== null) {
    const pgErr = err as Record<string, unknown>;
    const sqlState = typeof pgErr['code'] === 'string' ? pgErr['code'] : undefined;
    const message = typeof pgErr['message'] === 'string' ? pgErr['message'] : 'Database operation failed';
    const detail = typeof pgErr['detail'] === 'string' ? pgErr['detail'] : undefined;
    const table = typeof pgErr['table'] === 'string' ? pgErr['table'] : undefined;
    const constraint = typeof pgErr['constraint'] === 'string' ? pgErr['constraint'] : undefined;

    if (
      sqlState === PG_ERROR_CODES.INVALID_PASSWORD ||
      sqlState === PG_ERROR_CODES.CONNECTION_EXCEPTION ||
      sqlState === PG_ERROR_CODES.CANNOT_CONNECT_NOW ||
      sqlState === PG_ERROR_CODES.CONNECTION_DOES_NOT_EXIST ||
      sqlState === PG_ERROR_CODES.SQLCLIENT_UNABLE_TO_ESTABLISH ||
      sqlState === PG_ERROR_CODES.CONNECTION_FAILURE ||
      message.includes('SASL') ||
      message.includes('password authentication failed') ||
      message.includes('connect ECONNREFUSED') ||
      message.includes('connection to server was lost')
    ) {
      return new DatabaseConnectionError(message, { sqlState, detail, cause: err });
    }

    switch (sqlState) {
      case PG_ERROR_CODES.UNIQUE_VIOLATION:
        return new UniqueConstraintViolationError(message, { sqlState, detail, table, constraint, cause: err });
      case PG_ERROR_CODES.FOREIGN_KEY_VIOLATION:
        return new ForeignKeyViolationError(message, { sqlState, detail, table, constraint, cause: err });
      case PG_ERROR_CODES.CHECK_VIOLATION:
        return new CheckConstraintViolationError(message, { sqlState, detail, table, constraint, cause: err });
      case PG_ERROR_CODES.NOT_NULL_VIOLATION:
        return new NotNullViolationError(message, { sqlState, detail, table, constraint, cause: err });
      case PG_ERROR_CODES.INSUFFICIENT_PRIVILEGE:
        return new InsufficientPrivilegeError(message, { sqlState, detail, table, constraint, cause: err });
      default:
        return new DatabaseError(message, { sqlState, detail, table, constraint, cause: err });
    }
  }

  return new DatabaseError(typeof err === 'string' ? err : 'Unknown database error', { cause: err });
}
