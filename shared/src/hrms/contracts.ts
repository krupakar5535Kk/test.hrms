/**
 * Canonical HRMS Domain Policies & Contracts shared across Server & Client
 */

export const HRMS_POLICY = {
  SEPARATE_ADMIN_ACCOUNTS: 1,
  INITIAL_DEPLOYMENT_EMPLOYEES: 15,
  INITIAL_DEPLOYMENT_HEADCOUNT: 15,
  OFFICE_GEOFENCE_RADIUS_METERS: 50,
  MAX_GPS_ACCURACY_METERS: 30,
  MAX_FACE_ATTEMPTS: 3,
  SCHEDULE_START_HHMM: '10:00',
  SCHEDULE_END_HHMM: '18:00',
  LUNCH_START_HHMM: '13:00',
  LUNCH_END_HHMM: '14:00',
  NET_SCHEDULED_HOURS: 7,
  NET_SCHEDULED_MINUTES: 420,
  GRACE_PERIOD_MINUTES: 10,
  EARLY_DEPARTURE_MINUTES_CUTOFF: 17 * 60 + 50,
  JWT_EXPIRY_SECONDS: 900,
  PASSWORD_MIN_LENGTH: 8,
  MAX_FAILED_LOGIN_ATTEMPTS: 5,
  THROTTLE_WINDOW_MINUTES: 15,
  REFRESH_COOKIE_NAME: 'hrms_rt',
} as const;

export type JobCategory =
  | 'OFFICE'
  | 'HR'
  | 'FINANCE'
  | 'SALES'
  | 'RECOVERY';

export type FormulaMode =
  | 'CALENDAR_DAYS_X_8H_PAID_LUNCH'
  | 'SCHEDULED_DAYS_X_7H_NET';

export type LeaveCategory = 'CL' | 'SL' | 'PL' | 'LWP';

export type AttendanceEventType =
  | 'FACE_AUTO'
  | 'FACE_BUTTON'
  | 'FACE_EMPLOYEE_APP'
  | 'PIN_FALLBACK'
  | 'MANAGER_OVERRIDE';

export type FaceEnrollmentStatus =
  | 'NOT_ENROLLED'
  | 'REQUIRED'
  | 'PENDING'
  | 'PENDING_VERIFICATION'
  | 'APPROVED'
  | 'REJECTED'
  | 'REVOKED';

export type FaceVerificationState =
  | 'ENROLLMENT_REQUIRED'
  | 'ENROLLMENT_PENDING'
  | 'ENROLLMENT_APPROVED'
  | 'ENROLLMENT_REJECTED'
  | 'CAMERA_PERMISSION_REQUIRED'
  | 'FACE_NOT_DETECTED'
  | 'MULTIPLE_FACES_DETECTED'
  | 'POOR_IMAGE_QUALITY'
  | 'LIVENESS_IN_PROGRESS'
  | 'FACE_MATCHING_IN_PROGRESS'
  | 'FACE_MATCHED'
  | 'VERIFIED'
  | 'FACE_MISMATCH'
  | 'FAILED'
  | 'SPOOFING_SUSPECTED'
  | 'VERIFICATION_FAILED'
  | 'VERIFICATION_PENDING'
  | 'MAX_ATTEMPTS_REACHED'
  | 'NETWORK_UNAVAILABLE'
  | 'ATTENDANCE_RECORDED';

export type LocationVerificationState =
  | 'PERMISSION_REQUIRED'
  | 'ACQUIRING_GPS'
  | 'GPS_UNAVAILABLE'
  | 'POOR_ACCURACY'
  | 'POOR_GPS_ACCURACY'
  | 'INSIDE_GEOFENCE'
  | 'OUTSIDE_GEOFENCE'
  | 'SUSPICIOUS_LOCATION'
  | 'MOCK_LOCATION_SUSPECTED'
  | 'VERIFICATION_PENDING'
  | 'VERIFICATION_FAILED'
  | 'VERIFICATION_SUCCESSFUL';

export type AttendanceApprovalStatus =
  | 'NOT_MARKED'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'PENDING_ADMIN_REVIEW'
  | 'VERIFICATION_PENDING'
  | 'REJECTED';

export type FieldDutyStatus = 'INACTIVE' | 'ACTIVE' | 'ENDED';

export type PaymentTrackingStatus = 'Paid' | 'Pending' | 'Failed';

export interface EmployeeProfile {
  id: string;
  userId?: string;
  employeeCode: string;
  firstName?: string;
  lastName?: string;
  fullName: string;
  phoneNumber: string;
  role: 'EMPLOYEE';
  jobCategory: JobCategory;
  departmentId?: string;
  department: string;
  designationId?: string;
  designation: string;
  officeId: string;
  joiningDate: string;
  employmentStatus: 'ACTIVE' | 'PROBATION' | 'NOTICE_PERIOD' | 'TERMINATED' | 'RESIGNED';
  isFieldEligible?: boolean;
  shiftStart?: string;
  shiftEnd?: string;
  faceEnrollmentStatus: FaceEnrollmentStatus;
  faceEnrolledAt?: string;
  monthlySalaryReference: number;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  isActive?: boolean;
  isActivated?: boolean;
  activationStatus?: string;
  mustChangePassword?: boolean;
}

export interface AttendanceAuditEntry {
  id: string;
  timestamp: string;
  actorName: string;
  actorRole: 'ADMIN' | 'EMPLOYEE';
  action: string;
  reason?: string;
  previousValue?: string;
  updatedValue?: string;
}

export interface DailyAttendanceRecord {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  jobCategory: JobCategory;
  date: string;
  eventType: AttendanceEventType;
  checkInTime?: string;
  checkOutTime?: string;
  status: 'PRESENT' | 'PENDING_REVIEW' | 'ABSENT' | 'LEAVE';
  approvalStatus: AttendanceApprovalStatus;
  faceState: FaceVerificationState;
  livenessPassed: boolean;
  faceConfidence?: number;
  faceAttemptsUsed: number;
  locationState: LocationVerificationState;
  latitude?: number;
  longitude?: number;
  gpsAccuracyMeters?: number;
  distanceFromOfficeMeters?: number;
  employeeComment?: string;
  isLateArrival: boolean;
  isEarlyDeparture: boolean;
  lunchDeductionMinutes: number;
  approvedPayableMinutes: number;
  payableMinutes: number;
  postShiftMinutes: number;
  postShiftApproved?: boolean;
  selfieCapturedLabel?: string;
  adminRemarks?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  auditTrail: AttendanceAuditEntry[];
}

export interface FieldDutySessionRecord {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  jobCategory: 'SALES' | 'RECOVERY';
  date: string;
  status: FieldDutyStatus;
  authorizedAt?: string;
  endedAt?: string;
  attendanceStatusAtStart: AttendanceApprovalStatus;
  distanceTravelledKm: number;
  gpsSamplesCount: number;
  gpsGapsCount: number;
  lastLatitude?: number;
  lastLongitude?: number;
  lastAccuracyMeters?: number;
  lastLocationLabel?: string;
  lastUpdatedAt?: string;
  offlineQueueCount: number;
  routePoints: Array<{
    time: string;
    label: string;
    lat: number;
    lng: number;
    accuracyMeters: number;
  }>;
}

export interface CustomerVisitRecord {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  visitCategory: 'SALES' | 'RECOVERY';
  customerCode: string;
  customerName: string;
  customerAddress: string;
  plannedTime: string;
  completedAt?: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  outcomeNote?: string;
  nextFollowUpDate?: string;
  gpsLat?: number;
  gpsLng?: number;
  gpsTimestamp?: string;
  selfieVerified: boolean;
}

export interface LeaveApplicationRecord {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  category: LeaveCategory;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  supportingDocName?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  appliedAt: string;
  adminRemarks?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface PayrollLineItem {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  jobCategory?: JobCategory;
  monthlySalaryReference: number;
  calendarDaysInMonth: number;
  hourlyRate: number;
  approvedWorkingHours: number;
  unpaidLeaveDays: number;
  grossEarned: number;
  adjustments: number;
  netSalary: number;
  approvalStatus: 'DRAFT' | 'APPROVED';
  paymentStatus: PaymentTrackingStatus;
  approvedBy?: string;
  approvedAt?: string;
}

export interface SystemNotification {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  severity: 'info' | 'warning' | 'success' | 'error';
  targetRole: 'ADMIN' | 'EMPLOYEE';
  read: boolean;
  linkTo: string;
}
