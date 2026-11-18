import { Request, Response, NextFunction } from 'express';
import { ApiErrorResponse, ApiErrorCode, ValidationResult } from '@hrms/shared';

export function validateBody<T>(validator: (body: unknown) => ValidationResult<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = validator(req.body);

    if (!result.isValid) {
      const response: ApiErrorResponse = {
        success: false,
        error: {
          code: ApiErrorCode.VALIDATION_ERROR,
          message: 'Request payload validation failed',
          details: result.errors,
          timestamp: new Date().toISOString(),
        },
      };

      res.status(400).json(response);
      return;
    }

    // Assign normalized data to request body
    if (result.data) {
      req.body = result.data;
    }

    next();
  };
}
