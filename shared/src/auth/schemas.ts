import { LoginRequest } from './contracts.js';
import { ApiErrorDetail } from '../api/response.js';

export interface ValidationResult<T> {
  isValid: boolean;
  data?: T;
  errors: ApiErrorDetail[];
}

/**
 * Validates and normalizes DEC-13 Login Request payload.
 * Supports both camelCase and snake_case inputs.
 */
export function validateLoginPayload(input: unknown): ValidationResult<LoginRequest> {
  const errors: ApiErrorDetail[] = [];

  if (!input || typeof input !== 'object') {
    return {
      isValid: false,
      errors: [{ message: 'Request body must be a JSON object', field: 'body' }],
    };
  }

  const record = input as Record<string, unknown>;

  // Extract full name (optional in legacy payload, required by 3-field personalized login UI)
  const fullNameRaw = record['fullName'] ?? record['full_name'];
  let fullName: string | undefined;
  if (fullNameRaw !== undefined && fullNameRaw !== null && String(fullNameRaw).trim() !== '') {
    if (typeof fullNameRaw !== 'string') {
      errors.push({ field: 'fullName', message: 'Full Name must be a string' });
    } else {
      const trimmed = fullNameRaw.trim();
      if (trimmed.length < 2) {
        errors.push({ field: 'fullName', message: 'Full Name must be at least 2 characters' });
      } else {
        fullName = trimmed;
      }
    }
  }

  // Extract organization code (optional: defaults to unambiguous active org / ORG001 resolution on backend)
  const orgCodeRaw = record['organizationCode'] ?? record['organization_code'];
  let organizationCode: string | undefined;
  if (orgCodeRaw !== undefined && orgCodeRaw !== null && String(orgCodeRaw).trim() !== '') {
    if (typeof orgCodeRaw !== 'string') {
      errors.push({ field: 'organizationCode', message: 'Organization code must be a string' });
    } else {
      const normalized = orgCodeRaw.trim().toUpperCase();
      if (!/^[A-Z0-9_-]{2,20}$/.test(normalized)) {
        errors.push({
          field: 'organizationCode',
          message: 'Organization code must be 2-20 alphanumeric characters',
        });
      } else {
        organizationCode = normalized;
      }
    }
  }

  // Extract phone number
  const phoneRaw = record['phoneNumber'] ?? record['phone_number'];
  let phoneNumber = '';
  if (!phoneRaw || typeof phoneRaw !== 'string' || phoneRaw.trim() === '') {
    errors.push({ field: 'phoneNumber', message: 'Phone number is required' });
  } else {
    // Strip whitespace, hyphens, and parentheses
    phoneNumber = phoneRaw.replace(/[\s\-()]/g, '');
    // Support +91... or standard 10-15 digit phone formats
    if (!/^\+?[0-9]{10,15}$/.test(phoneNumber)) {
      errors.push({
        field: 'phoneNumber',
        message: 'Phone number must be a valid 10 to 15 digit format',
      });
    }
  }

  // Extract password
  const passwordRaw = record['password'];
  let password = '';
  if (!passwordRaw || typeof passwordRaw !== 'string' || passwordRaw === '') {
    errors.push({ field: 'password', message: 'Password is required' });
  } else {
    password = passwordRaw;
    if (password.length < 8) {
      errors.push({
        field: 'password',
        message: 'Password must be at least 8 characters in length',
      });
    }
  }

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    data: {
      fullName,
      organizationCode,
      phoneNumber,
      password,
    },
    errors: [],
  };
}
