import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateLoginPayload,
  UserRole,
  PunchType,
  AttendanceDayStatus,
  VerificationStatus,
  ApiErrorCode,
} from '../src/index.js';

test('validateLoginPayload validates valid credentials and normalizes org code', () => {
  const result = validateLoginPayload({
    organizationCode: 'acme',
    phoneNumber: '+91 98765-43210',
    password: 'SecurePassword123!',
  });

  assert.equal(result.isValid, true);
  assert.equal(result.data?.organizationCode, 'ACME');
  assert.equal(result.data?.phoneNumber, '+919876543210');
  assert.equal(result.data?.password, 'SecurePassword123!');
  assert.equal(result.errors.length, 0);
});

test('validateLoginPayload supports snake_case input fields', () => {
  const result = validateLoginPayload({
    organization_code: 'corp_01',
    phone_number: '9876543210',
    password: 'Password123!',
  });

  assert.equal(result.isValid, true);
  assert.equal(result.data?.organizationCode, 'CORP_01');
  assert.equal(result.data?.phoneNumber, '9876543210');
});

test('validateLoginPayload rejects invalid organization codes', () => {
  const result = validateLoginPayload({
    organizationCode: 'A', // too short (< 2)
    phoneNumber: '9876543210',
    password: 'Password123!',
  });

  assert.equal(result.isValid, false);
  assert(result.errors.some((e) => e.field === 'organizationCode'));
});

test('validateLoginPayload rejects short passwords (< 8 chars)', () => {
  const result = validateLoginPayload({
    organizationCode: 'ACME',
    phoneNumber: '9876543210',
    password: 'short',
  });

  assert.equal(result.isValid, false);
  assert(result.errors.some((e) => e.field === 'password'));
});

test('validateLoginPayload rejects malformed phone numbers', () => {
  const result = validateLoginPayload({
    organizationCode: 'ACME',
    phoneNumber: 'not-a-phone',
    password: 'Password123!',
  });

  assert.equal(result.isValid, false);
  assert(result.errors.some((e) => e.field === 'phoneNumber'));
});

test('Domain enums maintain expected string literals', () => {
  assert.equal(UserRole.SUPER_ADMIN, 'SUPER_ADMIN');
  assert.equal(UserRole.ADMIN, 'ADMIN');
  assert.equal(UserRole.EMPLOYEE, 'EMPLOYEE');

  assert.equal(PunchType.CHECK_IN, 'CHECK_IN');
  assert.equal(PunchType.CHECK_OUT, 'CHECK_OUT');

  assert.equal(AttendanceDayStatus.PRESENT, 'PRESENT');
  assert.equal(AttendanceDayStatus.ABSENT, 'ABSENT');

  assert.equal(VerificationStatus.VERIFIED, 'VERIFIED');
  assert.equal(ApiErrorCode.INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');
});
