import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDec01AttendanceMinutes,
  calculateHaversineDistanceMeters,
  countEmployeesExcludingAdmin,
  excludeAdminFromEmployees,
  formatInr,
  formatMinutesAsDuration,
  getPostAuthDestination,
  HRMS_POLICY,
  normalizeIndianMobile,
  UNPAID_LEAVE_LABELS,
} from '../lib/domainRules.ts';
import {
  APPLICATION_ROLES,
  formatJobCategoryLabel,
  isFieldExceptionEligible,
  isFieldOperationalCategory,
} from '../types/role.ts';
import { getNavigationForUser, ADMIN_NAVIGATION, EMPLOYEE_NAVIGATION } from '../config/menus.ts';

describe('HRMS Account Structure, Role Isolation & Approved Policy Rules', () => {
  it('enforces strictly two application roles (ADMIN and EMPLOYEE, zero SUPER_ADMIN)', () => {
    assert.deepEqual(APPLICATION_ROLES, ['ADMIN', 'EMPLOYEE']);
    assert.equal(APPLICATION_ROLES.includes('SUPER_ADMIN' as never), false);
    assert.equal(HRMS_POLICY.SEPARATE_ADMIN_ACCOUNTS, 1);
    assert.equal(HRMS_POLICY.INITIAL_DEPLOYMENT_EMPLOYEES, 15);
  });

  it('excludes ADMIN accounts from employee counts and lists', () => {
    const sampleSet = [
      { id: 'adm-1', role: 'ADMIN' },
      { id: 'emp-1', role: 'EMPLOYEE' },
      { id: 'emp-2', role: 'EMPLOYEE' },
    ];

    const filtered = excludeAdminFromEmployees(sampleSet);
    assert.equal(filtered.length, 2);
    assert.equal(
      filtered.some((account) => account.role === 'ADMIN'),
      false
    );
    assert.equal(countEmployeesExcludingAdmin(sampleSet), 2);
  });

  it('maps backend-verified role to separate Admin and Employee destinations', () => {
    assert.equal(getPostAuthDestination('ADMIN'), '/admin');
    assert.equal(getPostAuthDestination('EMPLOYEE'), '/employee');
  });

  it('strictly separates Admin navigation from Employee navigation and gates Field Duty', () => {
    const adminNav = getNavigationForUser('ADMIN');
    assert.ok(adminNav.every((item) => item.href.startsWith('/admin')));
    assert.equal(
      adminNav.some((item) => item.href.startsWith('/employee')),
      false
    );
    assert.equal(adminNav.length, ADMIN_NAVIGATION.length);

    const officeNav = getNavigationForUser('EMPLOYEE', 'OFFICE');
    assert.ok(officeNav.every((item) => item.href.startsWith('/employee')));
    assert.equal(
      officeNav.some((item) => item.href === '/employee/field-duty'),
      false
    );

    const salesNav = getNavigationForUser('EMPLOYEE', 'SALES');
    assert.equal(
      salesNav.some((item) => item.href === '/employee/field-duty'),
      true
    );

    const recoveryNav = getNavigationForUser('EMPLOYEE', 'RECOVERY');
    assert.equal(
      recoveryNav.some((item) => item.href === '/employee/field-duty'),
      true
    );

    assert.ok(EMPLOYEE_NAVIGATION.every((item) => item.href.startsWith('/employee')));
  });

  it('keeps job categories as classifications rather than separate roles', () => {
    assert.equal(isFieldExceptionEligible('SALES'), true);
    assert.equal(isFieldExceptionEligible('RECOVERY'), true);
    assert.equal(isFieldExceptionEligible('OFFICE'), false);
    assert.equal(isFieldExceptionEligible('HR'), false);
    assert.equal(isFieldExceptionEligible('FINANCE'), false);

    assert.equal(isFieldOperationalCategory('SALES'), true);
    assert.equal(isFieldOperationalCategory('RECOVERY'), true);
    assert.equal(isFieldOperationalCategory('OFFICE'), false);
    assert.equal(formatJobCategoryLabel('RECOVERY'), 'Recovery Agent');
  });

  it('validates 50m office geofence & <=30m GPS thresholds using Haversine distance', () => {
    assert.equal(HRMS_POLICY.OFFICE_GEOFENCE_RADIUS_METERS, 50);
    assert.equal(HRMS_POLICY.MAX_GPS_ACCURACY_METERS, 30);
    assert.equal(HRMS_POLICY.MAX_FACE_ATTEMPTS, 3);

    const sameSpot = calculateHaversineDistanceMeters(28.6139, 77.209, 28.6139, 77.209);
    assert.equal(sameSpot, 0);

    const farAway = calculateHaversineDistanceMeters(28.6139, 77.209, 28.616, 77.211);
    assert.ok(farAway > HRMS_POLICY.OFFICE_GEOFENCE_RADIUS_METERS);
  });

  it('implements DEC-01 lunch clipping (13:00-14:00) and post-18:00 approval accurately', () => {
    // Full shift 10:00 - 18:00 -> 420m (7h 0m) payable, 60m unpaid lunch clipped
    const fullShift = calculateDec01AttendanceMinutes('10:00', '18:00', false);
    assert.equal(fullShift.grossMinutes, 480);
    assert.equal(fullShift.lunchDeductionMinutes, 60);
    assert.equal(fullShift.postShiftMinutes, 0);
    assert.equal(fullShift.payableMinutes, 420);
    assert.equal(formatMinutesAsDuration(fullShift.payableMinutes), '7h 0m');

    // Morning session ending inside lunch 10:00 - 13:30 -> 180m (3h) payable, 30m clipped
    const morningLunch = calculateDec01AttendanceMinutes('10:00', '13:30', false);
    assert.equal(morningLunch.payableMinutes, 180);
    assert.equal(morningLunch.lunchDeductionMinutes, 30);

    // Afternoon session starting inside lunch 13:20 - 18:00 -> 240m (4h) payable, 40m clipped
    const afternoonLunch = calculateDec01AttendanceMinutes('13:20', '18:00', false);
    assert.equal(afternoonLunch.payableMinutes, 240);
    assert.equal(afternoonLunch.lunchDeductionMinutes, 40);

    // Stay-back until 19:00 WITHOUT Admin approval -> capped at 18:00 (420m)
    const unapprovedOvertime = calculateDec01AttendanceMinutes('10:00', '19:00', false);
    assert.equal(unapprovedOvertime.postShiftMinutes, 60);
    assert.equal(unapprovedOvertime.payableMinutes, 420);

    // Stay-back until 19:00 WITH Admin approval -> 420m + 60m = 480m (1.0x)
    const approvedOvertime = calculateDec01AttendanceMinutes('10:00', '19:00', true);
    assert.equal(approvedOvertime.postShiftMinutes, 60);
    assert.equal(approvedOvertime.payableMinutes, 480);
  });

  it('normalizes PO-02 Indian +91 mobile numbers and keeps all four leave categories unpaid', () => {
    const bare = normalizeIndianMobile('9876543210');
    assert.equal(bare.isValid, true);
    assert.equal(bare.data?.canonicalE164, '+919876543210');

    const withCountryPrefix = normalizeIndianMobile('919876543210');
    assert.equal(withCountryPrefix.isValid, true);
    assert.equal(withCountryPrefix.data?.canonicalE164, '+919876543210');

    const leadingZero = normalizeIndianMobile('09876543210');
    assert.equal(leadingZero.isValid, false);

    const formatted = normalizeIndianMobile('+91 98765 43210');
    assert.equal(formatted.isValid, true);
    assert.equal(formatted.data?.canonicalE164, '+919876543210');

    const invalid = normalizeIndianMobile('12345');
    assert.equal(invalid.isValid, false);

    assert.deepEqual(Object.keys(UNPAID_LEAVE_LABELS), ['CL', 'SL', 'PL', 'LWP']);
    assert.ok(formatInr(1000).includes('1,000'));
  });
});
