import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLoginPayload } from '@hrms/shared';

test('client validates DEC-13 login payload via shared contract', () => {
  const testResult = validateLoginPayload({
    organizationCode: 'acme',
    phoneNumber: '9876543210',
    password: 'Password123!',
  });

  assert.equal(testResult.isValid, true);
  assert.equal(testResult.data?.organizationCode, 'ACME');
  assert.equal(testResult.data?.phoneNumber, '9876543210');
});

test('client validates mobile-only login payload without organization code', () => {
  const testResult = validateLoginPayload({
    phoneNumber: '+91 9876543210',
    password: 'Password123!',
  });

  assert.equal(testResult.isValid, true);
  assert.equal(testResult.data?.organizationCode, undefined);
  assert.equal(testResult.data?.phoneNumber, '+919876543210');
});

test('client rejects invalid phone number via shared contract', () => {
  const testResult = validateLoginPayload({
    organizationCode: 'ACME',
    phoneNumber: '12345',
    password: 'Password123!',
  });

  assert.equal(testResult.isValid, false);
  assert.equal(testResult.errors[0]?.field, 'phoneNumber');
});
