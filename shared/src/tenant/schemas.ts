import { ApiErrorDetail } from '../api/response.js';
import { CreateOrganizationInput, CreateUserInput } from './contracts.js';
import { ValidationResult } from '../auth/schemas.js';

/**
 * Validates payload for creating a new tenant organization.
 * Enforces DEC-13 uppercase code format and DEC-14 mandatory explicit 1-30 retention days ceiling.
 */
export function validateCreateOrganizationPayload(input: unknown): ValidationResult<CreateOrganizationInput> {
  const errors: ApiErrorDetail[] = [];

  if (!input || typeof input !== 'object') {
    return {
      isValid: false,
      errors: [{ message: 'Request body must be a JSON object', field: 'body' }],
    };
  }

  const record = input as Record<string, unknown>;

  // Name
  const nameRaw = record['name'];
  let name = '';
  if (!nameRaw || typeof nameRaw !== 'string' || nameRaw.trim() === '') {
    errors.push({ field: 'name', message: 'Organization name is required' });
  } else {
    name = nameRaw.trim();
    if (name.length > 255) {
      errors.push({ field: 'name', message: 'Organization name must not exceed 255 characters' });
    }
  }

  // Legal Name
  const legalNameRaw = record['legalName'] ?? record['legal_name'];
  let legalName = '';
  if (!legalNameRaw || typeof legalNameRaw !== 'string' || legalNameRaw.trim() === '') {
    errors.push({ field: 'legalName', message: 'Legal name is required' });
  } else {
    legalName = legalNameRaw.trim();
    if (legalName.length > 255) {
      errors.push({ field: 'legalName', message: 'Legal name must not exceed 255 characters' });
    }
  }

  // Organization Code (DEC-13 Tri-partite anchor)
  const codeRaw = record['organizationCode'] ?? record['organization_code'] ?? record['code'];
  let organizationCode = '';
  if (!codeRaw || typeof codeRaw !== 'string' || codeRaw.trim() === '') {
    errors.push({ field: 'organizationCode', message: 'Organization code is required' });
  } else {
    organizationCode = codeRaw.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,20}$/.test(organizationCode)) {
      errors.push({
        field: 'organizationCode',
        message: 'Organization code must be 2-20 characters consisting of letters, digits, underscores, or hyphens',
      });
    }
  }

  // Contact Phone
  const phoneRaw = record['contactPhone'] ?? record['contact_phone'];
  let contactPhone = '';
  if (!phoneRaw || typeof phoneRaw !== 'string' || phoneRaw.trim() === '') {
    errors.push({ field: 'contactPhone', message: 'Contact phone is required' });
  } else {
    contactPhone = phoneRaw.replace(/[\s\-()]/g, '');
    if (!/^\+?[0-9]{10,15}$/.test(contactPhone)) {
      errors.push({
        field: 'contactPhone',
        message: 'Contact phone must be a valid 10 to 15 digit format',
      });
    }
  }

  // Contact Email
  const emailRaw = record['contactEmail'] ?? record['contact_email'];
  let contactEmail = '';
  if (!emailRaw || typeof emailRaw !== 'string' || emailRaw.trim() === '') {
    errors.push({ field: 'contactEmail', message: 'Contact email is required' });
  } else {
    contactEmail = emailRaw.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      errors.push({ field: 'contactEmail', message: 'Contact email must be a valid email address' });
    }
  }

  // Address
  const addressRaw = record['address'];
  let address = '';
  if (!addressRaw || typeof addressRaw !== 'string' || addressRaw.trim() === '') {
    errors.push({ field: 'address', message: 'Address is required' });
  } else {
    address = addressRaw.trim();
  }

  // Selfie Retention Days (DEC-14: Explicitly configured between 1 and 30 calendar days; zero unapproved default)
  const retentionRaw = record['selfieRetentionDays'] ?? record['selfie_retention_days'];
  let selfieRetentionDays = 0;
  if (retentionRaw === undefined || retentionRaw === null) {
    errors.push({
      field: 'selfieRetentionDays',
      message: 'Selfie retention days is required and must be configured between 1 and 30 calendar days per DEC-14',
    });
  } else {
    const parsed = Number(retentionRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 30) {
      errors.push({
        field: 'selfieRetentionDays',
        message: 'Selfie retention days must be an integer between 1 and 30 calendar days (DEC-14)',
      });
    } else {
      selfieRetentionDays = parsed;
    }
  }

  // Registration Number (Optional)
  const regNumberRaw = record['registrationNumber'] ?? record['registration_number'];
  const registrationNumber = typeof regNumberRaw === 'string' && regNumberRaw.trim() !== '' ? regNumberRaw.trim() : undefined;

  // Logo URL (Optional)
  const logoRaw = record['logoUrl'] ?? record['logo_url'];
  const logoUrl = typeof logoRaw === 'string' && logoRaw.trim() !== '' ? logoRaw.trim() : undefined;

  // Is Active (Optional, defaults to true)
  const isActiveRaw = record['isActive'] ?? record['is_active'];
  const isActive = isActiveRaw !== undefined ? Boolean(isActiveRaw) : true;

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    data: {
      name,
      legalName,
      organizationCode,
      registrationNumber,
      contactPhone,
      contactEmail,
      address,
      logoUrl,
      selfieRetentionDays,
      isActive,
    },
    errors: [],
  };
}

/**
 * Validates payload for creating a tenant-bound application user.
 * Enforces DEC-09 1:1 identity mapping to existing auth.users.id.
 */
export function validateCreateUserPayload(input: unknown): ValidationResult<CreateUserInput> {
  const errors: ApiErrorDetail[] = [];

  if (!input || typeof input !== 'object') {
    return {
      isValid: false,
      errors: [{ message: 'Request body must be a JSON object', field: 'body' }],
    };
  }

  const record = input as Record<string, unknown>;

  // Mandatory User ID (DEC-09 1:1 mapping from auth.users.id; zero independent UUID generation)
  const idRaw = record['id'];
  let id = '';
  if (!idRaw || typeof idRaw !== 'string' || idRaw.trim() === '') {
    errors.push({ field: 'id', message: 'User ID is required and must match the existing auth.users.id (DEC-09 1:1 mapping)' });
  } else {
    id = idRaw.trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
      errors.push({ field: 'id', message: 'User ID must be a valid UUID matching auth.users.id' });
    }
  }

  // Organization ID (Required UUID)
  const orgIdRaw = record['organizationId'] ?? record['organization_id'];
  let organizationId = '';
  if (!orgIdRaw || typeof orgIdRaw !== 'string' || orgIdRaw.trim() === '') {
    errors.push({ field: 'organizationId', message: 'Organization ID is required' });
  } else {
    organizationId = orgIdRaw.trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(organizationId)) {
      errors.push({ field: 'organizationId', message: 'Organization ID must be a valid UUID' });
    }
  }

  // Phone Number (Required 10-15 digits)
  const phoneRaw = record['phoneNumber'] ?? record['phone_number'];
  let phoneNumber = '';
  if (!phoneRaw || typeof phoneRaw !== 'string' || phoneRaw.trim() === '') {
    errors.push({ field: 'phoneNumber', message: 'Phone number is required' });
  } else {
    phoneNumber = phoneRaw.replace(/[\s\-()]/g, '');
    if (!/^\+?[0-9]{10,15}$/.test(phoneNumber)) {
      errors.push({
        field: 'phoneNumber',
        message: 'Phone number must be a valid 10 to 15 digit format',
      });
    }
  }

  // Optional is_active
  const isActiveRaw = record['isActive'] ?? record['is_active'];
  const isActive = isActiveRaw !== undefined ? Boolean(isActiveRaw) : true;

  // Optional must_change_password
  const mustChangeRaw = record['mustChangePassword'] ?? record['must_change_password'];
  const mustChangePassword = mustChangeRaw !== undefined ? Boolean(mustChangeRaw) : true;

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    data: {
      id,
      organizationId,
      phoneNumber,
      isActive,
      mustChangePassword,
    },
    errors: [],
  };
}
