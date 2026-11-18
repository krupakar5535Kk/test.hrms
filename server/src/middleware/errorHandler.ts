import { Request, Response, NextFunction } from 'express';
import { ApiErrorResponse, ApiErrorCode } from '@hrms/shared';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly details?: unknown;

  constructor(statusCode: number, errorCode: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const timestamp = new Date().toISOString();
  const requestId = (req.headers['x-request-id'] as string) || undefined;

  if (err instanceof AppError) {
    logger.warn(`Handled application error: ${err.message}`, {
      statusCode: err.statusCode,
      errorCode: err.errorCode,
      path: req.originalUrl,
      method: req.method,
    });

    const errorPayload: ApiErrorResponse = {
      success: false,
      error: {
        code: err.errorCode,
        message: err.message,
        details: err.details as any,
        requestId,
        timestamp,
      },
    };

    res.status(err.statusCode).json(errorPayload);
    return;
  }

  // Unhandled internal server error
  logger.error(`Unhandled server error: ${err.message}`, err, {
    path: req.originalUrl,
    method: req.method,
    ip: req.ip,
  });

  const responsePayload: ApiErrorResponse = {
    success: false,
    error: {
      code: ApiErrorCode.INTERNAL_SERVER_ERROR,
      message:
        env.NODE_ENV === 'production'
          ? 'An internal server error occurred'
          : err.message || 'Internal server error',
      requestId,
      timestamp,
    },
  };

  res.status(500).json(responsePayload);
}

export function notFoundHandler(req: Request, res: Response): void {
  const response: ApiErrorResponse = {
    success: false,
    error: {
      code: ApiErrorCode.NOT_FOUND,
      message: `Cannot ${req.method} ${req.originalUrl}`,
      timestamp: new Date().toISOString(),
    },
  };

  res.status(404).json(response);
}
