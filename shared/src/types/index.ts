/**
 * Core Domain Enums and Interfaces
 */

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  EMPLOYEE = 'EMPLOYEE',
}

export enum PunchType {
  CHECK_IN = 'CHECK_IN',
  CHECK_OUT = 'CHECK_OUT',
}

export enum AttendanceDayStatus {
  PRESENT = 'PRESENT',
  ABSENT = 'ABSENT',
  HALF_DAY = 'HALF_DAY',
  LEAVE = 'LEAVE',
  WEEKLY_OFF = 'WEEKLY_OFF',
  HOLIDAY = 'HOLIDAY',
  INCOMPLETE = 'INCOMPLETE',
}

export enum VerificationStatus {
  VERIFIED = 'VERIFIED',
  PENDING_REVIEW = 'PENDING_REVIEW',
  REJECTED = 'REJECTED',
}

export enum ProvisioningStatus {
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export interface Organization {
  id: string;
  name: string;
  legalName: string;
  code: string; // Tenant identifier (e.g., 'ACME') per DEC-13
  organizationCode?: string; // Alias for code matching database column
  registrationNumber?: string;
  contactPhone: string;
  contactEmail: string;
  address: string;
  logoUrl?: string;
  selfieRetentionDays: number; // 1-30 days per DEC-14
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Office {
  id: string;
  organizationId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: number;
  shiftStartTime: string; // '10:00:00'
  shiftEndTime: string;   // '18:00:00'
  isActive: boolean;
}

export interface User {
  id: string;
  organizationId: string;
  phoneNumber: string;
  roles: UserRole[];
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Employee {
  id: string;
  organizationId: string;
  userId: string;
  officeId: string;
  departmentId?: string;
  designationId?: string;
  employeeCode: string; // 'EMP001', 'EMP002', ..., 'EMP1000+'
  firstName: string;
  lastName: string;
  email?: string;
  joiningDate: string;
  employmentStatus: 'ACTIVE' | 'PROBATION' | 'NOTICE_PERIOD' | 'TERMINATED' | 'RESIGNED';
  createdAt: string;
  updatedAt: string;
}

export interface UserRoleAssignment {
  id: string;
  organizationId: string;
  userId: string;
  role: UserRole;
  assignedBy?: string;
  assignedAt: string;
}

export interface AccountProvisioningRequest {
  id: string;
  organizationId: string;
  idempotencyKey: string;
  phoneNumber: string;
  requestedRoles: UserRole[];
  status: ProvisioningStatus;
  requestedBy: string;
  requestedAt: string;
  requestNotes?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewDecision?: string;
  rejectionReason?: string;
  reviewNotes?: string;
  authUserId?: string;
  userId?: string;
  retryCount: number;
  lockedUntil?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccountProvisioningEvent {
  id: string;
  organizationId: string;
  requestId: string;
  actorUserId: string;
  fromStatus?: ProvisioningStatus;
  toStatus: ProvisioningStatus;
  action: string;
  reason?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
