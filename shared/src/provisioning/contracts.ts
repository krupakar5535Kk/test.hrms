/**
 * Account Provisioning and Role Assignment Contracts
 * Task 1.3: Roles & Account Provisioning Foundation
 */

import { UserRole, ProvisioningStatus } from '../types/index.js';

export interface CreateProvisioningRequestInput {
  organizationId: string;
  idempotencyKey: string;
  phoneNumber: string;
  requestedRoles: UserRole[];
  requestedBy: string; // Maker
  requestNotes?: string;
}

export interface ReviewProvisioningRequestInput {
  organizationId: string;
  requestId: string;
  reviewedBy: string; // Checker
  decision: 'APPROVED' | 'REJECTED';
  rejectionReason?: string;
  reviewNotes?: string;
}

export interface AssignRoleInput {
  organizationId: string;
  userId: string;
  role: UserRole;
  assignedBy?: string;
}

export interface ProvisioningEventRecord {
  organizationId: string;
  requestId: string;
  actorUserId: string;
  fromStatus?: ProvisioningStatus;
  toStatus: ProvisioningStatus;
  action: string;
  reason?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}
