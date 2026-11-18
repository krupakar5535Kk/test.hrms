import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UserRole,
  validateCreateProvisioningRequestPayload,
  validateReviewProvisioningRequestPayload,
  validateAssignRolePayload,
} from '../src/index.js';

test('validateCreateProvisioningRequestPayload succeeds with valid camelCase payload', () => {
  const result = validateCreateProvisioningRequestPayload({
    organizationId: '11111111-2222-3333-4444-555555555555',
    idempotencyKey: 'idemp-req-001',
    phoneNumber: '+91 98765 43210',
    requestedRoles: ['EMPLOYEE'],
    requestedBy: 'aaaaaaaa-1111-2222-3333-444444444444',
    requestNotes: 'Onboarding new software engineer',
  });

  assert.equal(result.isValid, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.data?.organizationId, '11111111-2222-3333-4444-555555555555');
  assert.equal(result.data?.idempotencyKey, 'idemp-req-001');
  assert.equal(result.data?.phoneNumber, '+919876543210');
  assert.deepEqual(result.data?.requestedRoles, [UserRole.EMPLOYEE]);
  assert.equal(result.data?.requestedBy, 'aaaaaaaa-1111-2222-3333-444444444444');
  assert.equal(result.data?.requestNotes, 'Onboarding new software engineer');
});

test('validateCreateProvisioningRequestPayload supports snake_case input fields', () => {
  const result = validateCreateProvisioningRequestPayload({
    organization_id: '11111111-2222-3333-4444-555555555555',
    idempotency_key: 'idemp-req-002',
    phone_number: '9876543210',
    requested_roles: ['ADMIN', 'EMPLOYEE'],
    requested_by: 'bbbbbbbb-1111-2222-3333-444444444444',
    request_notes: 'HR Administrator provisioning',
  });

  assert.equal(result.isValid, true);
  assert.equal(result.data?.organizationId, '11111111-2222-3333-4444-555555555555');
  assert.equal(result.data?.phoneNumber, '9876543210');
  assert.deepEqual(result.data?.requestedRoles, [UserRole.ADMIN, UserRole.EMPLOYEE]);
});

test('validateCreateProvisioningRequestPayload rejects invalid phone format', () => {
  const result = validateCreateProvisioningRequestPayload({
    organizationId: '11111111-2222-3333-4444-555555555555',
    idempotencyKey: 'idemp-003',
    phoneNumber: '12345', // too short (< 10)
    requestedRoles: ['EMPLOYEE'],
    requestedBy: 'aaaaaaaa-1111-2222-3333-444444444444',
  });

  assert.equal(result.isValid, false);
  assert(result.errors.some((e) => e.field === 'phoneNumber'));
});

test('validateCreateProvisioningRequestPayload rejects missing or empty requestedRoles', () => {
  const resultEmpty = validateCreateProvisioningRequestPayload({
    organizationId: '11111111-2222-3333-4444-555555555555',
    idempotencyKey: 'idemp-004',
    phoneNumber: '9876543210',
    requestedRoles: [],
    requestedBy: 'aaaaaaaa-1111-2222-3333-444444444444',
  });

  assert.equal(resultEmpty.isValid, false);
  assert(resultEmpty.errors.some((e) => e.field === 'requestedRoles'));

  const resultInvalid = validateCreateProvisioningRequestPayload({
    organizationId: '11111111-2222-3333-4444-555555555555',
    idempotencyKey: 'idemp-005',
    phoneNumber: '9876543210',
    requestedRoles: ['INVALID_ROLE'],
    requestedBy: 'aaaaaaaa-1111-2222-3333-444444444444',
  });

  assert.equal(resultInvalid.isValid, false);
  assert(resultInvalid.errors.some((e) => e.field === 'requestedRoles'));
});

test('validateCreateProvisioningRequestPayload rejects invalid requestedBy UUID', () => {
  const result = validateCreateProvisioningRequestPayload({
    organizationId: '11111111-2222-3333-4444-555555555555',
    idempotencyKey: 'idemp-006',
    phoneNumber: '9876543210',
    requestedRoles: ['EMPLOYEE'],
    requestedBy: 'not-a-valid-uuid',
  });

  assert.equal(result.isValid, false);
  assert(result.errors.some((e) => e.field === 'requestedBy'));
});

test('validateReviewProvisioningRequestPayload succeeds for valid approval', () => {
  const makerId = 'aaaaaaaa-1111-2222-3333-444444444444';
  const checkerId = 'cccccccc-1111-2222-3333-444444444444';

  const result = validateReviewProvisioningRequestPayload(
    {
      organizationId: '11111111-2222-3333-4444-555555555555',
      requestId: '99999999-8888-7777-6666-555555555555',
      reviewedBy: checkerId,
      decision: 'APPROVED',
      reviewNotes: 'Identity confirmed via HR documents',
    },
    makerId
  );

  assert.equal(result.isValid, true);
  assert.equal(result.data?.decision, 'APPROVED');
  assert.equal(result.data?.reviewedBy, checkerId);
});

test('validateReviewProvisioningRequestPayload enforces Maker-Checker separation (Checker != Maker)', () => {
  const makerId = 'aaaaaaaa-1111-2222-3333-444444444444';

  // Attempting self-approval
  const result = validateReviewProvisioningRequestPayload(
    {
      organizationId: '11111111-2222-3333-4444-555555555555',
      requestId: '99999999-8888-7777-6666-555555555555',
      reviewedBy: makerId, // Self-approval!
      decision: 'APPROVED',
    },
    makerId
  );

  assert.equal(result.isValid, false);
  assert(result.errors.some((e) => e.field === 'reviewedBy' && e.message.includes('Maker-Checker violation')));
});

test('validateReviewProvisioningRequestPayload requires rejection reason when decision is REJECTED', () => {
  const makerId = 'aaaaaaaa-1111-2222-3333-444444444444';
  const checkerId = 'cccccccc-1111-2222-3333-444444444444';

  // Missing rejection reason
  const resultMissingReason = validateReviewProvisioningRequestPayload(
    {
      organizationId: '11111111-2222-3333-4444-555555555555',
      requestId: '99999999-8888-7777-6666-555555555555',
      reviewedBy: checkerId,
      decision: 'REJECTED',
    },
    makerId
  );

  assert.equal(resultMissingReason.isValid, false);
  assert(resultMissingReason.errors.some((e) => e.field === 'rejectionReason'));

  // Valid rejection with reason
  const resultWithReason = validateReviewProvisioningRequestPayload(
    {
      organizationId: '11111111-2222-3333-4444-555555555555',
      requestId: '99999999-8888-7777-6666-555555555555',
      reviewedBy: checkerId,
      decision: 'REJECTED',
      rejectionReason: 'Invalid contact details and background check pending',
    },
    makerId
  );

  assert.equal(resultWithReason.isValid, true);
  assert.equal(resultWithReason.data?.decision, 'REJECTED');
  assert.equal(resultWithReason.data?.rejectionReason, 'Invalid contact details and background check pending');
});

test('validateAssignRolePayload validates input and accepts valid role assignment', () => {
  const result = validateAssignRolePayload({
    organizationId: '11111111-2222-3333-4444-555555555555',
    userId: 'aaaaaaaa-1111-2222-3333-444444444444',
    role: 'ADMIN',
    assignedBy: 'cccccccc-1111-2222-3333-444444444444',
  });

  assert.equal(result.isValid, true);
  assert.equal(result.data?.organizationId, '11111111-2222-3333-4444-555555555555');
  assert.equal(result.data?.userId, 'aaaaaaaa-1111-2222-3333-444444444444');
  assert.equal(result.data?.role, UserRole.ADMIN);
  assert.equal(result.data?.assignedBy, 'cccccccc-1111-2222-3333-444444444444');
});

test('validateAssignRolePayload rejects invalid role enum', () => {
  const result = validateAssignRolePayload({
    organizationId: '11111111-2222-3333-4444-555555555555',
    userId: 'aaaaaaaa-1111-2222-3333-444444444444',
    role: 'SUPER_USER', // Invalid role
  });

  assert.equal(result.isValid, false);
  assert(result.errors.some((e) => e.field === 'role'));
});
