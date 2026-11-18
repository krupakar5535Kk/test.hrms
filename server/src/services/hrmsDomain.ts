import crypto from 'node:crypto';
import {
  HRMS_POLICY,
  type FormulaMode,
  type JobCategory,
  type LeaveCategory,
  type AttendanceEventType,
} from '@hrms/shared';
import { ApiErrorCode } from '@hrms/shared';
import { AppError } from '../middleware/errorHandler.js';

export const ALLOWED_APP_ROLES = ['ADMIN', 'EMPLOYEE'] as const;
export type AppRole = (typeof ALLOWED_APP_ROLES)[number];

export const ALLOWED_JOB_CATEGORIES = ['OFFICE', 'SALES', 'RECOVERY', 'HR', 'FINANCE'] as const;
export const FIELD_ELIGIBLE_CATEGORIES = new Set<string>(['SALES', 'RECOVERY']);
export const ALLOWED_LEAVE_CODES = ['CL', 'SL', 'PL', 'LWP'] as const;
export const ALLOWED_EVENT_TYPES: readonly AttendanceEventType[] = [
  'FACE_AUTO',
  'FACE_BUTTON',
  'FACE_EMPLOYEE_APP',
  'PIN_FALLBACK',
  'MANAGER_OVERRIDE',
];

const IST_OFFSET_MS = 330 * 60 * 1000;

export function normalizeIndianMobile(raw: string): { canonicalE164: string; tenDigit: string } | null {
  if (typeof raw !== 'string') return null;
  let cleaned = raw.replace(/[\s\-()]/g, '').trim();
  if (cleaned.startsWith('+91')) {
    cleaned = cleaned.slice(3);
  } else if (cleaned.startsWith('91') && cleaned.length === 12) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = cleaned.slice(1);
  }
  if (!/^[6-9][0-9]{9}$/.test(cleaned)) {
    return null;
  }
  return {
    canonicalE164: `+91${cleaned}`,
    tenDigit: cleaned,
  };
}

export function buildSyntheticEmail(authUserId: string, organizationId: string): string {
  return `uid-${authUserId}@org-${organizationId}.auth.hrms.internal`.toLowerCase();
}

export function hmacSha256Hex(keyHexOrUtf8: string, message: string): string {
  const key = /^[0-9a-f]{64,}$/i.test(keyHexOrUtf8)
    ? Buffer.from(keyHexOrUtf8, 'hex')
    : Buffer.from(keyHexOrUtf8, 'utf8');
  return crypto.createHmac('sha256', key).update(message, 'utf8').digest('hex');
}

export function sha256Hex(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function generateNumericOtp6(): string {
  return String(crypto.randomInt(100000, 1000000));
}

export function encryptAesGcmJson(payload: Record<string, unknown>, keyHex: string): string {
  const key = crypto.createHash('sha256').update(Buffer.from(keyHex, 'hex')).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

export function decryptAesGcmJson<T extends Record<string, unknown>>(
  token: string,
  keyHex: string
): T | null {
  try {
    const raw = Buffer.from(token, 'base64url');
    if (raw.length < 29) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const key = crypto.createHash('sha256').update(Buffer.from(keyHex, 'hex')).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    return JSON.parse(decrypted) as T;
  } catch {
    return null;
  }
}

export function toIstDateAndHHMM(dateInput: Date | string = new Date()): {
  dateStr: string;
  hhmm: string;
  minutesOfDay: number;
  isoString: string;
  dayOfWeek: number; // 0 = Sunday .. 6 = Saturday
} {
  const utcDate = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const istShifted = new Date(utcDate.getTime() + IST_OFFSET_MS);
  const year = istShifted.getUTCFullYear();
  const month = String(istShifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(istShifted.getUTCDate()).padStart(2, '0');
  const hours = istShifted.getUTCHours();
  const mins = istShifted.getUTCMinutes();
  const hhmm = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  return {
    dateStr: `${year}-${month}-${day}`,
    hhmm,
    minutesOfDay: hours * 60 + mins,
    isoString: utcDate.toISOString(),
    dayOfWeek: istShifted.getUTCDay(),
  };
}

export function parseTimeToMinutes(hhmm: string): number {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(hhmm.trim());
  if (!match) {
    throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, `Invalid HH:MM time format: ${hhmm}`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

export function combineIstDateAndHHMMToDate(dateStr: string, hhmm: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) {
    throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, `Invalid date format: ${dateStr}`);
  }
  const mins = parseTimeToMinutes(hhmm);
  const hours = String(Math.floor(mins / 60)).padStart(2, '0');
  const minutes = String(mins % 60).padStart(2, '0');
  return new Date(`${dateStr}T${hours}:${minutes}:00.000+05:30`);
}

/**
 * Authoritative Haversine distance in metres on WGS-84 sphere (R = 6,371,000m).
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
  return Math.round(R * c * 100) / 100;
}

/**
 * Authoritative DEC-01 Lunch Window Intersection Clipping & Working Hours Calculator.
 * Lunch window: 13:00–14:00 IST.
 * Standard schedule: 10:00–18:00 IST, Mon–Sat.
 * Grace period: 10:10 IST (> 10:10 is late). Early departure cutoff: < 17:50 IST.
 * Post-18:00 overtime counts toward approvedPayableMinutes ONLY when postShiftApproved === true.
 */
export function calculateDec01AttendanceMinutes(
  checkInHHMM: string,
  checkOutHHMM: string,
  postShiftApproved = false
): {
  rawDurationMinutes: number;
  lunchDeductedMinutes: number;
  payableMinutes: number;
  approvedPayableMinutes: number;
  post6pmMinutes: number;
  isLateArrival: boolean;
  isEarlyDeparture: boolean;
} {
  const checkIn = parseTimeToMinutes(checkInHHMM);
  const checkOut = parseTimeToMinutes(checkOutHHMM);
  const scheduleStart = 10 * 60;
  const scheduleEnd = 18 * 60;
  const lunchStart = 13 * 60;
  const lunchEnd = 14 * 60;

  const isLateArrival = checkIn > scheduleStart + HRMS_POLICY.GRACE_PERIOD_MINUTES;
  const isEarlyDeparture = checkOut < 17 * 60 + 50;

  if (checkOut <= checkIn) {
    return {
      rawDurationMinutes: 0,
      lunchDeductedMinutes: 0,
      payableMinutes: 0,
      approvedPayableMinutes: 0,
      post6pmMinutes: 0,
      isLateArrival,
      isEarlyDeparture,
    };
  }

  const rawDurationMinutes = checkOut - checkIn;
  const lunchDeductedMinutes = Math.max(
    0,
    Math.min(checkOut, lunchEnd) - Math.max(checkIn, lunchStart)
  );
  const post6pmMinutes = Math.max(0, checkOut - scheduleEnd);

  const scheduledEndClipped = Math.min(checkOut, scheduleEnd);
  const scheduledLunch = Math.max(
    0,
    Math.min(scheduledEndClipped, lunchEnd) - Math.max(checkIn, lunchStart)
  );
  const basePayable = Math.max(0, scheduledEndClipped - checkIn - scheduledLunch);
  const totalWithOt = Math.max(0, checkOut - checkIn - lunchDeductedMinutes);
  const payableMinutes = postShiftApproved ? totalWithOt : basePayable;

  return {
    rawDurationMinutes,
    lunchDeductedMinutes,
    payableMinutes,
    approvedPayableMinutes: payableMinutes,
    post6pmMinutes,
    isLateArrival,
    isEarlyDeparture,
  };
}

export function getMonthDateRange(monthYYYYMM: string): {
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  calendarDays: number;
  workingDaysMonSat: number;
} {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(monthYYYYMM.trim());
  if (!match) {
    throw new AppError(400, ApiErrorCode.VALIDATION_ERROR, 'Month must be in YYYY-MM format');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const calendarDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(calendarDays).padStart(2, '0')}`;

  let workingDaysMonSat = 0;
  for (let d = 1; d <= calendarDays; d++) {
    const dayOfWeek = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    if (dayOfWeek !== 0) {
      workingDaysMonSat += 1;
    }
  }

  return { year, month, startDate, endDate, calendarDays, workingDaysMonSat };
}

export interface DualFormulaComparison {
  referenceMonthlyInr: number;
  salaryReferencePaise: number;
  calendarDays: number;
  workingDaysMonSat: number;
  approvedHours: number;
  formulaA: {
    mode: 'CALENDAR_DAYS_X_8H_PAID_LUNCH';
    divisorHours: number;
    hourlyRatePaise: number;
    hourlyRateInr: number;
    grossEarnedPaise: number;
    grossEarnedInr: number;
  };
  formulaB: {
    mode: 'SCHEDULED_DAYS_X_7H_NET';
    divisorHours: number;
    hourlyRatePaise: number;
    hourlyRateInr: number;
    grossEarnedPaise: number;
    grossEarnedInr: number;
  };
}

export function calculateDualPayrollComparison(params: {
  monthlySalaryPaise: number;
  approvedPayableMinutes: number;
  calendarDays: number;
  workingDaysMonSat: number;
  adjustmentsPaise?: number;
}): DualFormulaComparison & {
  computeForMode: (mode: FormulaMode) => {
    hourlyRatePaise: number;
    grossEarnedPaise: number;
    netPayablePaise: number;
  };
} {
  const { monthlySalaryPaise, approvedPayableMinutes, calendarDays, workingDaysMonSat } = params;
  const adjustmentsPaise = params.adjustmentsPaise ?? 0;

  const divisorA = calendarDays * 8;
  const rateAPaise = divisorA > 0 ? monthlySalaryPaise / divisorA : 0;
  const grossAPaise = Math.round((approvedPayableMinutes / 60) * rateAPaise);

  const divisorB = workingDaysMonSat * 7;
  const rateBPaise = divisorB > 0 ? monthlySalaryPaise / divisorB : 0;
  const grossBPaise = Math.round((approvedPayableMinutes / 60) * rateBPaise);

  return {
    referenceMonthlyInr: Math.round((monthlySalaryPaise / 100) * 100) / 100,
    salaryReferencePaise: monthlySalaryPaise,
    calendarDays,
    workingDaysMonSat,
    approvedHours: Math.round((approvedPayableMinutes / 60) * 100) / 100,
    formulaA: {
      mode: 'CALENDAR_DAYS_X_8H_PAID_LUNCH',
      divisorHours: divisorA,
      hourlyRatePaise: Math.round(rateAPaise * 10000) / 10000,
      hourlyRateInr: Math.round((rateAPaise / 100) * 100) / 100,
      grossEarnedPaise: grossAPaise,
      grossEarnedInr: Math.round((grossAPaise / 100) * 100) / 100,
    },
    formulaB: {
      mode: 'SCHEDULED_DAYS_X_7H_NET',
      divisorHours: divisorB,
      hourlyRatePaise: Math.round(rateBPaise * 10000) / 10000,
      hourlyRateInr: Math.round((rateBPaise / 100) * 100) / 100,
      grossEarnedPaise: grossBPaise,
      grossEarnedInr: Math.round((grossBPaise / 100) * 100) / 100,
    },
    computeForMode(mode: FormulaMode) {
      if (mode === 'SCHEDULED_DAYS_X_7H_NET') {
        return {
          hourlyRatePaise: Math.round(rateBPaise * 10000) / 10000,
          grossEarnedPaise: grossBPaise,
          netPayablePaise: Math.max(0, grossBPaise + adjustmentsPaise),
        };
      }
      return {
        hourlyRatePaise: Math.round(rateAPaise * 10000) / 10000,
        grossEarnedPaise: grossAPaise,
        netPayablePaise: Math.max(0, grossAPaise + adjustmentsPaise),
      };
    },
  };
}

export function isValidJobCategory(value: unknown): value is JobCategory {
  return typeof value === 'string' && ALLOWED_JOB_CATEGORIES.includes(value as any);
}

export function isValidLeaveCategory(value: unknown): value is LeaveCategory {
  return typeof value === 'string' && ALLOWED_LEAVE_CODES.includes(value as any);
}

export function isValidEventType(value: unknown): value is AttendanceEventType {
  return typeof value === 'string' && (ALLOWED_EVENT_TYPES as readonly string[]).includes(value);
}

export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? 'Employee';
  const lastName = parts.slice(1).join(' ');
  return { firstName, lastName };
}
