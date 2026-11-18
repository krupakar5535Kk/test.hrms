import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCreateOrganizationPayload,
  validateCreateUserPayload,
} from '../src/index.js';

test('validateCreateOrganizationPayload succeeds with valid camelCase payload', () => {
  const result = validateCreateOrganizationPayload({
    name: 'Acme Corporation',
    legalName: 'Acme Technologies Private Limited',
    organizationCode: 'acme-corp',
    registrationNumber: 'U72200TG2026PTC123456',
    contactPhone: '+91 98765 43210',
    contactEmail: 'contact@acmecorp.com',
    address: 'Plot 42, Hitec City, Hyderabad, Telangana 500081',
    logoUrl: 'https://cdn.example.com/logos/acme.png',
    selfieRetentionDays: 25,
    isActive: true,
  });

  assert.equal(result.isValid, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.data?.name, 'Acme Corporation');
  assert.equal(result.data?.legalName, 'Acme Technologies Private Limited');
  assert.equal(result.data?.organizationCode, 'ACME-CORP'); // normalized to uppercase
  assert.equal(result.data?.contactPhone, '+919876543210');
  assert.equal(result.data?.contactEmail, 'contact@acmecorp.com');
  assert.equal(result.data?.selfieRetentionDays, 25);
  assert.equal(result.data?.isActive, true);
});

test('validateCreateOrganizationPayload supports snake_case input fields', () => {
  const result = validateCreateOrganizationPayload({
    name: 'Beta Global',
    legal_name: 'Beta Global Solutions LLP',
    organization_code: 'beta_glob',
    contact_phone: '9876543210',
    contact_email: 'ADMIN@BETAGLOBAL.COM',
    address: 'Financial District, Nanakramguda, Hyderabad',
    selfie_retention_days: 14,
  });

  assert.equal(result.isValid, true);
  assert.equal(result.data?.organizationCode, 'BETA_GLOB');
  assert.equal(result.data?.contactEmail, 'admin@betaglobal.com');
  assert.equal(result.data?.selfieRetentionDays, 14);
  assert.equal(result.data?.isActive, true); // default true
});

test('validateCreateOrganizationPayload requires explicit selfieRetentionDays (DEC-14, zero unapproved default)', () => {
  const result = validateCreateOrganizationPayload({
    name: 'No Default Co',
    legalName: 'No Default Co Pvt Ltd',
    organizationCode: 'NO-DEF',
    contactPhone: '9876543210',
    contactEmail: 'info@nodef.com',
    address: 'Madhapur, Hyderabad',
    // selfieRetentionDays omitted
  });

  assert.equal(result.isValid, false);
  assert(result.errors.some((e) => e.field === 'selfieRetentionDays'));
});

test('validateCreateOrganizationPayload rejects selfieRetentionDays outside 1-30 boundary (DEC-14)', () => {
  // Below minimum (< 1)
  const resultLow = validateCreateOrganizationPayload({
    name: 'Test Co',
    legalName: 'Test Co Pvt Ltd',
    organizationCode: 'TESTCO',
    contactPhone: '9876543210',
    contactEmail: 'info@test.com',
    address: 'Hyderabad',
    selfieRetentionDays: 0,
  });
  assert.equal(resultLow.isValid, false);
  assert(resultLow.errors.some((e) => e.field === 'selfieRetentionDays'));

  // Above ceiling (> 30)
  const resultHigh = validateCreateOrganizationPayload({
    name: 'Test Co',
    legalName: 'Test Co Pvt Ltd',
    organizationCode: 'TESTCO',
    contactPhone: '9876543210',
    contactEmail: 'info@test.com',
    address: 'Hyderabad',
    selfieRetentionDays: 31,
  });
  assert.equal(resultHigh.isValid, false);
  assert(resultHigh.errors.some((e) => e.field === 'selfieRetentionDays'));

  // Non-integer
  const resultFloat = validateCreateOrganizationPayload({
    name: 'Test Co',
    legalName: 'Test Co Pvt Ltd',
    organizationCode: 'TESTCO',
    contactPhone: '9876543210',
    contactEmail: 'info@test.com',
    address: 'Hyderabad',
    selfieRetentionDays: 15.5,
  });
  assert.equal(resultFloat.isValid, false);
  assert(resultFloat.errors.some((e) => e.field === 'selfieRetentionDays'));
});

test('validateCreateOrganizationPayload rejects invalid organization codes', () => {
  // Too short (< 2)
  const resultShort = validateCreateOrganizationPayload({
    name: 'Test',
    legalName: 'Test Legal',
    organizationCode: 'A',
    contactPhone: '9876543210',
    contactEmail: 'info@test.com',
    address: 'Hyderabad',
    selfieRetentionDays: 10,
  });
  assert.equal(resultShort.isValid, false);
  assert(resultShort.errors.some((e) => e.field === 'organizationCode'));

  // Invalid characters (spaces, symbols)
  const resultInvalidChars = validateCreateOrganizationPayload({
    name: 'Test',
    legalName: 'Test Legal',
    organizationCode: 'ACME CORP!',
    contactPhone: '9876543210',
    contactEmail: 'info@test.com',
    address: 'Hyderabad',
    selfieRetentionDays: 10,
  });
  assert.equal(resultInvalidChars.isValid, false);
  assert(resultInvalidChars.errors.some((e) => e.field === 'organizationCode'));
});

test('validateCreateOrganizationPayload rejects missing mandatory fields', () => {
  const result = validateCreateOrganizationPayload({});
  assert.equal(result.isValid, false);
  const fields = result.errors.map((e) => e.field);
  assert(fields.includes('name'));
  assert(fields.includes('legalName'));
  assert(fields.includes('organizationCode'));
  assert(fields.includes('contactPhone'));
  assert(fields.includes('contactEmail'));
  assert(fields.includes('address'));
  assert(fields.includes('selfieRetentionDays'));
});

test('validateCreateUserPayload succeeds with valid input including auth user ID', () => {
  const result = validateCreateUserPayload({
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    organizationId: '11111111-2222-3333-4444-555555555555',
    phoneNumber: '+91 98765 12345',
  });

  assert.equal(result.isValid, true);
  assert.equal(result.data?.id, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal(result.data?.organizationId, '11111111-2222-3333-4444-555555555555');
  assert.equal(result.data?.phoneNumber, '+919876512345');
  assert.equal(result.data?.isActive, true);
  assert.equal(result.data?.mustChangePassword, true);
});

test('validateCreateUserPayload rejects missing auth user ID (DEC-09 1:1 mapping invariant)', () => {
  const result = validateCreateUserPayload({
    organizationId: '11111111-2222-3333-4444-555555555555',
    phoneNumber: '+919876512345',
    // id omitted
  });

  assert.equal(result.isValid, false);
  assert(result.errors.some((e) => e.field === 'id'));
});

test('validateCreateUserPayload rejects invalid organization UUID', () => {
  const result = validateCreateUserPayload({
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    organizationId: 'invalid-uuid',
    phoneNumber: '9876543210',
  });

  assert.equal(result.isValid, false);
  assert(result.errors.some((e) => e.field === 'organizationId'));
});

test('validateCreateUserPayload rejects invalid phone number', () => {
  const result = validateCreateUserPayload({
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    organizationId: '11111111-2222-3333-4444-555555555555',
    phoneNumber: '12345', // too short (< 10)
  });

  assert.equal(result.isValid, false);
  assert(result.errors.some((e) => e.field === 'phoneNumber'));
});
