/**
 * Standardized API Response and Error Contracts
 */

export interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: {
    timestamp: string;
    requestId?: string;
    pagination?: {
      page: number;
      limit: number;
      totalCount: number;
      totalPages: number;
    };
  };
}

export interface ApiErrorDetail {
  field?: string;
  message: string;
  code?: string;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetail[];
    requestId?: string;
    timestamp: string;
  };
}

export type ApiResult<T> = ApiResponse<T> | ApiErrorResponse;

export enum ApiErrorCode {
  // Authentication & Authorization (DEC-13)
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TENANT_NOT_FOUND = 'TENANT_NOT_FOUND',
  TENANT_INACTIVE = 'TENANT_INACTIVE',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  MUST_CHANGE_PASSWORD = 'MUST_CHANGE_PASSWORD',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  INVALID_TOKEN = 'INVALID_TOKEN',
  RATE_LIMITED = 'RATE_LIMITED',
  PROVISIONING_CONFIG_MISSING = 'PROVISIONING_CONFIG_MISSING',

  // Validation & Input
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  BAD_REQUEST = 'BAD_REQUEST',

  // Idempotency (DEC-02)
  IDEMPOTENCY_KEY_MISSING = 'IDEMPOTENCY_KEY_MISSING',
  IDEMPOTENCY_KEY_PAYLOAD_MISMATCH = 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',

  // Attendance Business States (DEC-02)
  ATTENDANCE_ALREADY_CHECKED_IN = 'ATTENDANCE_ALREADY_CHECKED_IN',
  ATTENDANCE_ALREADY_COMPLETED = 'ATTENDANCE_ALREADY_COMPLETED',
  CHECK_OUT_WITHOUT_CHECK_IN = 'CHECK_OUT_WITHOUT_CHECK_IN',

  // Payroll Policy Gate
  PAYROLL_FORMULA_NOT_APPROVED = 'PAYROLL_FORMULA_NOT_APPROVED',

  // Resource Lookup
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',

  // Verification & Geofence
  GEOFENCE_BREACH = 'GEOFENCE_BREACH',
  GEOFENCE_VIOLATION = 'GEOFENCE_VIOLATION',
  FIELD_DUTY_INACTIVE = 'FIELD_DUTY_INACTIVE',
  POOR_GPS_ACCURACY = 'POOR_GPS_ACCURACY',
  FACE_VERIFICATION_FAILED = 'FACE_VERIFICATION_FAILED',
  BIOMETRIC_PROVIDER_UNCONFIGURED = 'BIOMETRIC_PROVIDER_UNCONFIGURED',

  // Server Errors
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
}
