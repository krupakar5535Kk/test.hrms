import type { JobCategory, Role } from './role';

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
  | 'FACE_MISMATCH'
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

export type LeaveCategory = 'CL' | 'SL' | 'PL' | 'LWP';

export type PaymentTrackingStatus = 'Paid' | 'Pending' | 'Failed';

export interface RegisteredOffice {
  id: string;
  name: string;
  branchName: string;
  address: string;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: 50; // Officially approved 50m radius (never 100m)
  maxGpsAccuracyMeters: 30;
  policyVersion: string;
  policyUpdatedAt: string;
  policyUpdatedBy: string;
}

export interface EmployeeProfile {
  id: string;
  userId?: string;
  employeeCode: string; // Tenant-scoped employee code e.g. EMP001..EMP1000+; excludes Admin account
  fullName: string;
  phoneNumber: string; // +91XXXXXXXXXX per PO-02 (no employee email exposed per PO-01)
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
  faceEnrollmentStatus: FaceEnrollmentStatus;
  faceEnrolledAt?: string;
  monthlySalaryReference: number;
  emergencyContactName: string;
  emergencyContactPhone: string;
  isActive?: boolean;
  isActivated?: boolean;
  activationStatus?: string;
  mustChangePassword?: boolean;
}

export interface OrganizationSettings {
  id: string;
  code: string;
  name: string;
  legalName: string;
  selfieRetentionDays: number;
  plannedEmployeeCount: number; // Initially 15 employees (separate from 1 Admin account)
  separateAdminCount: number; // Strictly 1
}

export interface AdminDashboardSummary {
  totalEmployees: number;
  plannedEmployees: number;
  presentToday: number;
  currentlyWorking: number;
  absentToday: number;
  lateArrivals: number;
  earlyDepartures: number;
  pendingAttendanceReviews: number;
  activeFieldDutyCount: number;
  pendingLeaveApprovals: number;
  salesVisitsToday: number;
  recoveryVisitsToday: number;
  payrollPeriodLabel: string | null;
  payrollDraftCount: number;
  payrollApprovedCount: number;
  payrollTotalNetInr: number;
}

export interface AssignedTaskRecord {
  id: string;
  title: string;
  description: string;
  dueDate?: string;
  priority: 'HIGH' | 'NORMAL' | 'LOW';
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  assignedBy: string;
}

export interface AuditLogRecord {
  id: string;
  timestamp: string;
  actorName: string;
  actorRole: Role;
  action: string;
  entityType: string;
  reason: string;
}

export interface AttendanceAuditEntry {
  id: string;
  timestamp: string;
  actorName: string;
  actorRole: Role;
  action: string;
  reason: string;
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
  date: string; // YYYY-MM-DD
  eventType?: AttendanceEventType;
  checkInTime?: string; // HH:mm
  checkOutTime?: string; // HH:mm
  status: 'PRESENT' | 'ABSENT' | 'LEAVE' | 'WEEKLY_OFF' | 'PENDING_REVIEW';
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
  employeeComment?: string; // Mandatory free-text explanation for Sales/Recovery outside office
  isLateArrival: boolean; // > 10:10
  isEarlyDeparture: boolean; // < 17:50
  lunchDeductionMinutes: number; // DEC-01 intersection formula
  payableMinutes?: number;
  approvedPayableMinutes: number;
  postShiftMinutes: number;
  postShiftApproved: boolean;
  selfieCapturedLabel?: string;
  checkInSelfieUrl?: string | null;
  checkOutSelfieUrl?: string | null;
  enrolledFaceUrl?: string | null;
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
  authorizedAt?: string; // Timestamp when field-duty authorization started
  endedAt?: string;
  attendanceStatusAtStart: AttendanceApprovalStatus; // Separate from field-duty authorization!
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
  startedAt?: string;
  completedAt?: string;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'FOLLOW_UP' | 'FAILED';
  outcomeNote: string;
  followUpDate?: string;
  gpsLat?: number;
  gpsLng?: number;
  gpsTimestamp?: string;
  selfieVerified: boolean;
  evidencePhotoUrl?: string | null;
  evidenceSignedUrl?: string | null;
  reviewStatus?: string;
  reviewNote?: string;
  reviewNotes?: string | null;
  authorizedCollectionNote?: string;
}

export interface LeaveApplicationRecord {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  category: LeaveCategory; // CL, SL, PL, LWP — all unpaid (0 payable hours)
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

export interface PayrollFormulaBreakdown {
  divisorHours: number;
  hourlyRateInr: number;
  grossEarnedInr: number;
  netPayableInr: number;
}

export interface PayrollLineItem {
  itemId?: string;
  payslipId?: string;
  payslipNumber?: string;
  month?: string;
  formulaMode?: 'CALENDAR_DAYS_X_8H_PAID_LUNCH' | 'SCHEDULED_DAYS_X_7H_NET';
  issuedAt?: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  jobCategory: JobCategory;
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
  paymentReference?: string | null;
  paidAt?: string | null;
  approvedBy?: string;
  approvedAt?: string;
  formulaComparison?: {
    formulaA: PayrollFormulaBreakdown;
    formulaB: PayrollFormulaBreakdown;
  };
  adjustmentsList?: Array<{
    id: string;
    adjustmentType: string;
    amountInr: number;
    reason: string;
    createdAt: string;
  }>;
}

export interface DeviceSessionRecord {
  id: string;
  deviceName: string;
  platform?: string;
  ipAddressMasked?: string;
  ipSummary?: string;
  createdAt?: string;
  lastActiveAt: string;
  expiresAt?: string;
  revokedAt?: string | null;
  revokedReason?: string | null;
  isCurrent: boolean;
}

export interface SystemNotification {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  severity: 'info' | 'warning' | 'success' | 'critical';
  targetRole: Role | 'ALL';
  read: boolean;
  linkTo: string;
}
