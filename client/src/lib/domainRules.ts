import type { ValidationResult } from '@hrms/shared';
import type { LeaveCategory } from '../types/hrms';

/**
 * Approved Business Rules & Constants from Final HRMS Master Instruction
 */
export const HRMS_POLICY = {
  SEPARATE_ADMIN_ACCOUNTS: 1,
  INITIAL_DEPLOYMENT_EMPLOYEES: 15, // Strictly 15 EMPLOYEE accounts; ADMIN is separate & excluded
  INITIAL_DEPLOYMENT_HEADCOUNT: 15, // Alias retained for pure employee roster target checks
  OFFICE_GEOFENCE_RADIUS_METERS: 50, // Part 7B & 22: Officially approved 50m radius (never 100m)
  MAX_GPS_ACCURACY_METERS: 30, // Part 7C: Max permitted reported GPS accuracy
  MAX_FACE_ATTEMPTS: 3, // Part 6F: Route to Verification Pending / Admin Review after 3 fails
  SCHEDULE_START_HHMM: '10:00',
  SCHEDULE_END_HHMM: '18:00',
  LUNCH_START_HHMM: '13:00',
  LUNCH_END_HHMM: '14:00',
  NET_SCHEDULED_HOURS: 7,
  NET_SCHEDULED_MINUTES: 420,
  GRACE_PERIOD_MINUTES: 10, // Late after 10:10 AM
  EARLY_DEPARTURE_MINUTES_CUTOFF: 17 * 60 + 50, // Before 5:50 PM (17:50)
  JWT_EXPIRY_SECONDS: 900,
  PASSWORD_MIN_LENGTH: 8,
  MAX_FAILED_LOGIN_ATTEMPTS: 5,
  THROTTLE_WINDOW_MINUTES: 15,
  REFRESH_COOKIE_NAME: '__Host-hrms_refresh_token',
} as const;

/**
 * Defense-in-depth: Admin is a separate governance account and must NEVER
 * appear in employee rosters, attendance denominators, leave totals, or payroll batches.
 */
export function excludeAdminFromEmployees<T extends { role?: string }>(records: readonly T[]): T[] {
  return records.filter((item) => item.role?.toUpperCase() !== 'ADMIN' && item.role?.toUpperCase() !== 'SUPER_ADMIN');
}

export function countEmployeesExcludingAdmin<T extends { role?: string }>(records: readonly T[]): number {
  return excludeAdminFromEmployees(records).length;
}

export function getPostAuthDestination(role: 'ADMIN' | 'EMPLOYEE'): '/admin' | '/employee' {
  return role === 'ADMIN' ? '/admin' : '/employee';
}

export const UNPAID_LEAVE_LABELS: Record<LeaveCategory, string> = {
  CL: 'Casual Leave (CL) — Unpaid (0 payable hrs)',
  SL: 'Sick Leave (SL) — Unpaid (0 payable hrs)',
  PL: 'Privilege Leave (PL) — Unpaid (0 payable hrs)',
  LWP: 'Leave Without Pay (LWP) — Unpaid (0 payable hrs)',
};

/**
 * PO-02 Indian Mobile Normalization:
 * Accepts 10 digits, 91XXXXXXXXXX, or +91XXXXXXXXXX after stripping spaces/hyphens/parentheses.
 * Enforces canonical +91[6-9][0-9]{9}.
 */
export function normalizeIndianMobile(raw: string): ValidationResult<{
  canonicalE164: string;
  tenDigit: string;
}> {
  const cleaned = raw.replace(/[\s\-()]/g, '').trim();
  if (!cleaned) {
    return {
      isValid: false,
      errors: [{ field: 'phoneNumber', message: 'Indian mobile number is required' }],
    };
  }

  let tenDigit = cleaned;
  if (cleaned.startsWith('+91')) {
    tenDigit = cleaned.slice(3);
  } else if (cleaned.startsWith('91') && cleaned.length === 12) {
    tenDigit = cleaned.slice(2);
  }

  if (/^0/.test(cleaned)) {
    return {
      isValid: false,
      errors: [
        {
          field: 'phoneNumber',
          message: 'Enter 10-digit Indian mobile without leading 0 (e.g. 9876543210 or +919876543210)',
        },
      ],
    };
  }

  if (!/^[6-9][0-9]{9}$/.test(tenDigit)) {
    return {
      isValid: false,
      errors: [
        {
          field: 'phoneNumber',
          message: 'Must be a valid Indian mobile (+91 followed by 10 digits starting 6-9)',
        },
      ],
    };
  }

  return {
    isValid: true,
    data: {
      canonicalE164: `+91${tenDigit}`,
      tenDigit,
    },
    errors: [],
  };
}

export function parseTimeToMinutes(hhmm: string): number {
  const parts = hhmm.split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

export function formatMinutesAsDuration(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  const hrs = Math.floor(safe / 60);
  const mins = safe % 60;
  return `${hrs}h ${mins}m`;
}

/**
 * Part 9 — DEC-01 Lunch Window Intersection Clipping Calculation:
 * lunchMinutes = max(0, min(checkOut, 14:00) - max(checkIn, 13:00))
 * Preserves the exact 5 specification examples:
 *   10:00-13:00 => lunch 0, payable 180
 *   10:00-13:30 => lunch 30, payable 180
 *   10:00-18:00 => lunch 60, payable 420
 *   13:30-18:00 => lunch 30, payable 240
 *   13:05-13:55 => lunch 50, payable 0
 * Post-18:00 minutes are payable only when approved by Admin (1.0x normal rate).
 */
export function calculateDec01AttendanceMinutes(
  checkInHHMM: string,
  checkOutHHMM: string,
  postShiftApproved = false
): {
  grossMinutes: number;
  lunchDeductionMinutes: number;
  payableMinutes: number;
  postShiftMinutes: number;
  isLateArrival: boolean;
  isEarlyDeparture: boolean;
} {
  const checkIn = parseTimeToMinutes(checkInHHMM);
  const checkOut = parseTimeToMinutes(checkOutHHMM);
  const scheduleStart = 10 * 60;
  const scheduleEnd = 18 * 60;
  const lunchStart = 13 * 60;
  const lunchEnd = 14 * 60;

  if (checkOut <= checkIn) {
    return {
      grossMinutes: 0,
      lunchDeductionMinutes: 0,
      payableMinutes: 0,
      postShiftMinutes: 0,
      isLateArrival: checkIn > scheduleStart + HRMS_POLICY.GRACE_PERIOD_MINUTES,
      isEarlyDeparture: checkOut < HRMS_POLICY.EARLY_DEPARTURE_MINUTES_CUTOFF,
    };
  }

  const grossMinutes = checkOut - checkIn;
  const lunchDeductionMinutes = Math.max(
    0,
    Math.min(checkOut, lunchEnd) - Math.max(checkIn, lunchStart)
  );
  const postShiftMinutes = Math.max(0, checkOut - scheduleEnd);
  const effectiveEnd = postShiftApproved ? checkOut : Math.min(checkOut, scheduleEnd);
  const effectiveLunchDeduction = Math.max(
    0,
    Math.min(effectiveEnd, lunchEnd) - Math.max(checkIn, lunchStart)
  );
  const payableMinutes = Math.max(0, effectiveEnd - checkIn - effectiveLunchDeduction);

  return {
    grossMinutes,
    lunchDeductionMinutes,
    payableMinutes,
    postShiftMinutes,
    isLateArrival: checkIn > scheduleStart + HRMS_POLICY.GRACE_PERIOD_MINUTES,
    isEarlyDeparture: checkOut < HRMS_POLICY.EARLY_DEPARTURE_MINUTES_CUTOFF,
  };
}

/**
 * Haversine geodesic distance in metres between two WGS-84 coordinates.
 * Used as frontend preview; backend always performs authoritative validation.
 */
export function calculateHaversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export function formatInr(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount);
}
