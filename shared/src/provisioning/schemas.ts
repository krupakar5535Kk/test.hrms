import { ApiErrorDetail } from '../api/response.js';
import { ValidationResult } from '../auth/schemas.js';
import { UserRole } from '../types/index.js';
import {
  CreateProvisioningRequestInput,
  ReviewProvisioningRequestInput,
  AssignRoleInput,
} from './contracts.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PHONE_REGEX = /^\+?[0-9]{10,15}$/;

/**
 * Validates payload for creating a new account provisioning request (Maker step).
 */
export function validateCreateProvisioningRequestPayload(
  input: unknown
): ValidationResult<CreateProvisioningRequestInput> {
  const errors: ApiErrorDetail[] = [];

  if (!input || typeof input !== 'object') {
    return {
      isValid: false,
      errors: [{ message: 'Request body must be a JSON object', field: 'body' }],
    };
  }

  const record = input as Record<string, unknown>;

  // Organization ID
  const orgIdRaw = record['organizationId'] ?? record['organization_id'];
  let organizationId = '';
  if (!orgIdRaw || typeof orgIdRaw !== 'string' || orgIdRaw.trim() === '') {
    errors.push({ field: 'organizationId', message: 'Organization ID is required' });
  } else {
    organizationId = orgIdRaw.trim().toLowerCase();
    if (!UUID_REGEX.test(organizationId)) {
      errors.push({ field: 'organizationId', message: 'Organization ID must be a valid UUID' });
    }
  }

  // Idempotency Key
  const keyRaw = record['idempotencyKey'] ?? record['idempotency_key'];
  let idempotencyKey = '';
  if (!keyRaw || typeof keyRaw !== 'string' || keyRaw.trim() === '') {
    errors.push({ field: 'idempotencyKey', message: 'Idempotency key is required' });
  } else {
    idempotencyKey = keyRaw.trim();
    if (idempotencyKey.length > 100) {
      errors.push({ field: 'idempotencyKey', message: 'Idempotency key must not exceed 100 characters' });
    }
  }

  // Phone Number
  const phoneRaw = record['phoneNumber'] ?? record['phone_number'];
  let phoneNumber = '';
  if (!phoneRaw || typeof phoneRaw !== 'string' || phoneRaw.trim() === '') {
    errors.push({ field: 'phoneNumber', message: 'Phone number is required' });
  } else {
    phoneNumber = phoneRaw.replace(/[\s\-()]/g, '');
    if (!PHONE_REGEX.test(phoneNumber)) {
      errors.push({
        field: 'phoneNumber',
        message: 'Phone number must be a valid 10 to 15 digit format',
      });
    }
  }

  // Requested Roles
  const rolesRaw = record['requestedRoles'] ?? record['requested_roles'];
  const requestedRoles: UserRole[] = [];
  if (!Array.isArray(rolesRaw) || rolesRaw.length === 0) {
    errors.push({ field: 'requestedRoles', message: 'At least one requested role is required' });
  } else {
    const validRoles = Object.values(UserRole);
    for (const r of rolesRaw) {
      if (typeof r !== 'string' || !validRoles.includes(r as UserRole)) {
        errors.push({
          field: 'requestedRoles',
          message: `Invalid role: ${String(r)}. Must be one of: ${validRoles.join(', ')}`,
        });
      } else if (!requestedRoles.includes(r as UserRole)) {
        requestedRoles.push(r as UserRole);
      }
    }
  }

  // Requested By (Maker)
  const reqByRaw = record['requestedBy'] ?? record['requested_by'];
  let requestedBy = '';
  if (!reqByRaw || typeof reqByRaw !== 'string' || reqByRaw.trim() === '') {
    errors.push({ field: 'requestedBy', message: 'Requested By user ID is required' });
  } else {
    requestedBy = reqByRaw.trim().toLowerCase();
    if (!UUID_REGEX.test(requestedBy)) {
      errors.push({ field: 'requestedBy', message: 'Requested By must be a valid UUID' });
    }
  }

  // Request Notes (Optional)
  const notesRaw = record['requestNotes'] ?? record['request_notes'];
  const requestNotes = typeof notesRaw === 'string' && notesRaw.trim() !== '' ? notesRaw.trim() : undefined;

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    data: {
      organizationId,
      idempotencyKey,
      phoneNumber,
      requestedRoles,
      requestedBy,
      requestNotes,
    },
    errors: [],
  };
}

/**
 * Validates payload for reviewing an account provisioning request (Checker step).
 * Enforces Maker-Checker separation: Checker cannot be the same user who requested provisioning.
 */
export function validateReviewProvisioningRequestPayload(
  input: unknown,
  existingRequestedBy?: string
): ValidationResult<ReviewProvisioningRequestInput> {
  const errors: ApiErrorDetail[] = [];

  if (!input || typeof input !== 'object') {
    return {
      isValid: false,
      errors: [{ message: 'Request body must be a JSON object', field: 'body' }],
    };
  }

  const record = input as Record<string, unknown>;

  // Organization ID
  const orgIdRaw = record['organizationId'] ?? record['organization_id'];
  let organizationId = '';
  if (!orgIdRaw || typeof orgIdRaw !== 'string' || orgIdRaw.trim() === '') {
    errors.push({ field: 'organizationId', message: 'Organization ID is required' });
  } else {
    organizationId = orgIdRaw.trim().toLowerCase();
    if (!UUID_REGEX.test(organizationId)) {
      errors.push({ field: 'organizationId', message: 'Organization ID must be a valid UUID' });
    }
  }

  // Request ID
  const reqIdRaw = record['requestId'] ?? record['request_id'];
  let requestId = '';
  if (!reqIdRaw || typeof reqIdRaw !== 'string' || reqIdRaw.trim() === '') {
    errors.push({ field: 'requestId', message: 'Request ID is required' });
  } else {
    requestId = reqIdRaw.trim().toLowerCase();
    if (!UUID_REGEX.test(requestId)) {
      errors.push({ field: 'requestId', message: 'Request ID must be a valid UUID' });
    }
  }

  // Reviewed By (Checker)
  const revByRaw = record['reviewedBy'] ?? record['reviewed_by'];
  let reviewedBy = '';
  if (!revByRaw || typeof revByRaw !== 'string' || revByRaw.trim() === '') {
    errors.push({ field: 'reviewedBy', message: 'Reviewed By user ID is required' });
  } else {
    reviewedBy = revByRaw.trim().toLowerCase();
    if (!UUID_REGEX.test(reviewedBy)) {
      errors.push({ field: 'reviewedBy', message: 'Reviewed By must be a valid UUID' });
    }
  }

  // Maker-Checker Separation Invariant
  if (existingRequestedBy && reviewedBy && reviewedBy.toLowerCase() === existingRequestedBy.toLowerCase()) {
    errors.push({
      field: 'reviewedBy',
      message: 'Maker-Checker violation: Reviewer cannot be the same user who requested provisioning',
    });
  }

  // Decision
  const decisionRaw = record['decision'] ?? record['reviewDecision'] ?? record['review_decision'];
  let decision: 'APPROVED' | 'REJECTED' = 'APPROVED';
  if (!decisionRaw || typeof decisionRaw !== 'string' || !['APPROVED', 'REJECTED'].includes(decisionRaw.trim().toUpperCase())) {
    errors.push({ field: 'decision', message: 'Decision must be either APPROVED or REJECTED' });
  } else {
    decision = decisionRaw.trim().toUpperCase() as 'APPROVED' | 'REJECTED';
  }

  // Rejection Reason Invariant: Required when decision is REJECTED
  const reasonRaw = record['rejectionReason'] ?? record['rejection_reason'];
  let rejectionReason: string | undefined;
  if (decision === 'REJECTED') {
    if (!reasonRaw || typeof reasonRaw !== 'string' || reasonRaw.trim() === '') {
      errors.push({
        field: 'rejectionReason',
        message: 'Rejection reason is required when rejecting a provisioning request',
      });
    } else {
      rejectionReason = reasonRaw.trim();
    }
  } else if (typeof reasonRaw === 'string' && reasonRaw.trim() !== '') {
    rejectionReason = reasonRaw.trim();
  }

  // Review Notes (Optional)
  const notesRaw = record['reviewNotes'] ?? record['review_notes'];
  const reviewNotes = typeof notesRaw === 'string' && notesRaw.trim() !== '' ? notesRaw.trim() : undefined;

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    data: {
      organizationId,
      requestId,
      reviewedBy,
      decision,
      rejectionReason,
      reviewNotes,
    },
    errors: [],
  };
}

/**
 * Validates payload for assigning an organization role to a user.
 */
export function validateAssignRolePayload(input: unknown): ValidationResult<AssignRoleInput> {
  const errors: ApiErrorDetail[] = [];

  if (!input || typeof input !== 'object') {
    return {
      isValid: false,
      errors: [{ message: 'Request body must be a JSON object', field: 'body' }],
    };
  }

  const record = input as Record<string, unknown>;

  // Organization ID
  const orgIdRaw = record['organizationId'] ?? record['organization_id'];
  let organizationId = '';
  if (!orgIdRaw || typeof orgIdRaw !== 'string' || orgIdRaw.trim() === '') {
    errors.push({ field: 'organizationId', message: 'Organization ID is required' });
  } else {
    organizationId = orgIdRaw.trim().toLowerCase();
    if (!UUID_REGEX.test(organizationId)) {
      errors.push({ field: 'organizationId', message: 'Organization ID must be a valid UUID' });
    }
  }

  // User ID
  const userIdRaw = record['userId'] ?? record['user_id'];
  let userId = '';
  if (!userIdRaw || typeof userIdRaw !== 'string' || userIdRaw.trim() === '') {
    errors.push({ field: 'userId', message: 'User ID is required' });
  } else {
    userId = userIdRaw.trim().toLowerCase();
    if (!UUID_REGEX.test(userId)) {
      errors.push({ field: 'userId', message: 'User ID must be a valid UUID' });
    }
  }

  // Role
  const roleRaw = record['role'];
  let role: UserRole = UserRole.EMPLOYEE;
  if (!roleRaw || typeof roleRaw !== 'string' || !Object.values(UserRole).includes(roleRaw as UserRole)) {
    errors.push({
      field: 'role',
      message: `Role must be one of: ${Object.values(UserRole).join(', ')}`,
    });
  } else {
    role = roleRaw as UserRole;
  }

  // Assigned By (Optional UUID)
  const assignedByRaw = record['assignedBy'] ?? record['assigned_by'];
  let assignedBy: string | undefined;
  if (assignedByRaw !== undefined && assignedByRaw !== null) {
    if (typeof assignedByRaw !== 'string' || !UUID_REGEX.test(assignedByRaw.trim().toLowerCase())) {
      errors.push({ field: 'assignedBy', message: 'Assigned By must be a valid UUID' });
    } else {
      assignedBy = assignedByRaw.trim().toLowerCase();
    }
  }

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    data: {
      organizationId,
      userId,
      role,
      assignedBy,
    },
    errors: [],
  };
}
