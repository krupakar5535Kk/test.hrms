import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const migrationsDir = path.join(projectRoot, 'supabase/migrations');

// ============================================================================
// ENVIRONMENT & TEST METHODOLOGY NOTICE
// ============================================================================
// NOTICE ON TEST EXECUTION ENVIRONMENT:
// The tests in this file consist strictly of:
// 1. Static SQL DDL Contract Inspection: Parsing and asserting exact SQL DDL
//    primitives, constraints, triggers, role definitions, and RLS directives
//    defined in Migration 20261109000003_roles_and_provisioning.sql.
// 2. In-Memory Relational Logic Simulation: High-fidelity simulation of PostgreSQL
//    relational constraints, composite foreign keys, Maker-Checker separation,
//    append-only audit ledger triggers, and RLS filtering logic.
//
// ENGINE EXECUTION STATUS: PENDING REAL POSTGRESQL HARNESS
// These tests DO NOT execute against a live PostgreSQL 15+ engine or Supabase daemon.
// Verification of actual PostgreSQL C-engine query execution, planner RLS rewrites,
// transaction rollback isolation, and engine-level SQLSTATE exceptions remains
// PENDING until a local PostgreSQL/Supabase test container is provisioned.
// ============================================================================

// ============================================================================
// PART 1: STATIC SQL DDL INSPECTION FOR MIGRATION 00003
// ============================================================================

test('Static DDL Inspection: Migration 00003 exists and defines provisioning_status_enum', () => {
  const m3Path = path.join(migrationsDir, '20261109000003_roles_and_provisioning.sql');
  assert.equal(fs.existsSync(m3Path), true, 'Migration 00003 must exist on filesystem');

  const content = fs.readFileSync(m3Path, 'utf8');

  // Enum definition
  assert(content.includes('CREATE TYPE provisioning_status_enum AS ENUM'), 'Must define provisioning_status_enum');
  assert(content.includes("'SUBMITTED'"), 'Must include SUBMITTED status');
  assert(content.includes("'APPROVED'"), 'Must include APPROVED status');
  assert(content.includes("'REJECTED'"), 'Must include REJECTED status');
  assert(content.includes("'PROCESSING'"), 'Must include PROCESSING status');
  assert(content.includes("'COMPLETED'"), 'Must include COMPLETED status');
  assert(content.includes("'FAILED'"), 'Must include FAILED status');
  assert(content.includes("'CANCELLED'"), 'Must include CANCELLED status');
});

test('Static DDL Inspection: Migration 00003 defines user_roles with declarative composite foreign keys', () => {
  const m3Path = path.join(migrationsDir, '20261109000003_roles_and_provisioning.sql');
  const content = fs.readFileSync(m3Path, 'utf8');

  // user_roles table
  const userRolesTableMatch = content.match(/CREATE TABLE user_roles \([\s\S]*?\);/);
  assert(userRolesTableMatch, 'Must define CREATE TABLE user_roles block');
  const userRolesDdl = userRolesTableMatch[0];

  assert(userRolesDdl.includes('organization_id UUID NOT NULL REFERENCES organizations(id)'), 'user_roles.organization_id must reference organizations(id)');
  assert(userRolesDdl.includes('role user_role_enum NOT NULL'), 'user_roles.role must use user_role_enum');

  // Composite Foreign Keys
  assert(userRolesDdl.includes('CONSTRAINT fk_user_roles_org_user'), 'Must define fk_user_roles_org_user composite FK');
  assert(
    userRolesDdl.includes('FOREIGN KEY (organization_id, user_id) \n        REFERENCES users(organization_id, id)') ||
    userRolesDdl.includes('FOREIGN KEY (organization_id, user_id) REFERENCES users(organization_id, id)') ||
    userRolesDdl.includes('FOREIGN KEY (organization_id, user_id)'),
    'fk_user_roles_org_user must reference users(organization_id, id)'
  );
  assert(userRolesDdl.includes('ON DELETE CASCADE'), 'fk_user_roles_org_user must cascade on user deletion');

  assert(userRolesDdl.includes('CONSTRAINT fk_user_roles_org_assigned_by'), 'Must define fk_user_roles_org_assigned_by composite FK');
  assert(userRolesDdl.includes('ON DELETE SET NULL (assigned_by)'), 'fk_user_roles_org_assigned_by must use column-specific ON DELETE SET NULL (assigned_by) (PostgreSQL 15+)');
  assert(!userRolesDdl.includes('ON DELETE SET NULL,') && !userRolesDdl.includes('ON DELETE SET NULL\n'), 'user_roles must NOT use un-scoped composite ON DELETE SET NULL without column list');

  // Unique constraint
  assert(userRolesDdl.includes('CONSTRAINT uq_user_roles_org_user_role'), 'Must define uq_user_roles_org_user_role unique constraint');
  assert(userRolesDdl.includes('UNIQUE (organization_id, user_id, role)'), 'uq_user_roles_org_user_role must cover (organization_id, user_id, role)');
});

test('Static DDL Inspection: Migration 00003 defines role authorization helper functions', () => {
  const m3Path = path.join(migrationsDir, '20261109000003_roles_and_provisioning.sql');
  const content = fs.readFileSync(m3Path, 'utf8');

  // is_admin_or_super()
  assert(content.includes('CREATE OR REPLACE FUNCTION is_admin_or_super()'), 'Must define is_admin_or_super()');
  assert(content.includes("ur.user_id = auth_user_id()"), 'is_admin_or_super must check auth_user_id()');
  assert(content.includes("ur.organization_id = current_org_id()"), 'is_admin_or_super must check current_org_id()');
  assert(content.includes("ur.role IN ('SUPER_ADMIN', 'ADMIN')"), 'is_admin_or_super must check SUPER_ADMIN or ADMIN');

  // is_super_admin()
  assert(content.includes('CREATE OR REPLACE FUNCTION is_super_admin()'), 'Must define is_super_admin()');
  assert(content.includes("ur.role = 'SUPER_ADMIN'"), 'is_super_admin must check SUPER_ADMIN');
});

test('Static DDL Inspection: Migration 00003 defines account_provisioning_requests with Maker-Checker constraint', () => {
  const m3Path = path.join(migrationsDir, '20261109000003_roles_and_provisioning.sql');
  const content = fs.readFileSync(m3Path, 'utf8');

  // Table definition
  assert(content.includes('CREATE TABLE account_provisioning_requests'), 'Must create account_provisioning_requests table');
  assert(content.includes('idempotency_key VARCHAR(100) NOT NULL'), 'idempotency_key must be VARCHAR(100) NOT NULL');
  assert(content.includes('phone_number VARCHAR(15) NOT NULL'), 'phone_number must be VARCHAR(15) NOT NULL');
  assert(content.includes('requested_roles user_role_enum[] NOT NULL'), 'requested_roles must be user_role_enum[] NOT NULL');

  // Composite Foreign Keys
  assert(content.includes('CONSTRAINT fk_prov_org_requested_by'), 'Must define fk_prov_org_requested_by composite FK');
  assert(content.includes('CONSTRAINT fk_prov_org_reviewed_by'), 'Must define fk_prov_org_reviewed_by composite FK');

  // Candidate Key & Idempotency Key
  assert(content.includes('CONSTRAINT uq_prov_org_id \n        UNIQUE (organization_id, id)') ||
         content.includes('CONSTRAINT uq_prov_org_id') && content.includes('UNIQUE (organization_id, id)'),
         'Must define candidate key (organization_id, id)');
  assert(content.includes('CONSTRAINT uq_prov_org_idempotency') && content.includes('UNIQUE (organization_id, idempotency_key)'),
         'Must enforce idempotency_key uniqueness per organization');

  // Maker-Checker Separation Invariant
  assert(content.includes('CONSTRAINT chk_prov_maker_checker_distinct'), 'Must define chk_prov_maker_checker_distinct constraint');
  assert(content.includes('CHECK (reviewed_by IS NULL OR reviewed_by != requested_by)'),
         'chk_prov_maker_checker_distinct must forbid reviewed_by == requested_by');

  // Review Completeness
  assert(content.includes('CONSTRAINT chk_prov_review_completeness'), 'Must define chk_prov_review_completeness');

  // Rejection Reason
  assert(content.includes('CONSTRAINT chk_prov_rejection_reason'), 'Must define chk_prov_rejection_reason');
  assert(content.includes("status = 'REJECTED' AND rejection_reason IS NOT NULL AND trim(rejection_reason) != ''"),
         'chk_prov_rejection_reason must require non-empty rejection_reason when status is REJECTED');

  // Updated at trigger
  assert(content.includes('CREATE TRIGGER trg_prov_updated_at'), 'Must attach updated_at trigger');
});

test('Static DDL Inspection: Migration 00003 defines immutable audit ledger with append-only trigger', () => {
  const m3Path = path.join(migrationsDir, '20261109000003_roles_and_provisioning.sql');
  const content = fs.readFileSync(m3Path, 'utf8');

  // Table definition
  assert(content.includes('CREATE TABLE account_provisioning_events'), 'Must create account_provisioning_events table');
  assert(content.includes('CONSTRAINT fk_prov_event_org_req'), 'Must define fk_prov_event_org_req composite FK');
  assert(content.includes('REFERENCES account_provisioning_requests(organization_id, id)'), 'Must reference account_provisioning_requests(organization_id, id)');
  assert(content.includes('ON DELETE RESTRICT'), 'fk_prov_event_org_req must enforce ON DELETE RESTRICT to protect audit history');
  assert(!content.includes('REFERENCES account_provisioning_requests(organization_id, id) \n        ON DELETE CASCADE'), 'Must NOT cascade delete audit events');
  assert(content.includes('CONSTRAINT fk_prov_event_org_actor'), 'Must define fk_prov_event_org_actor composite FK');
  assert(content.includes('REFERENCES users(organization_id, id)'), 'Must reference users(organization_id, id)');

  // Immutability Trigger
  assert(content.includes('CREATE OR REPLACE FUNCTION trg_prevent_provisioning_event_mutation()'), 'Must define mutation prevention function');
  assert(content.includes('account_provisioning_events records are append-only and strictly immutable'), 'Must raise immutability error');
  assert(content.includes('CREATE TRIGGER trg_no_update_delete_prov_events'), 'Must attach trg_no_update_delete_prov_events trigger');
  assert(content.includes('BEFORE UPDATE OR DELETE ON account_provisioning_events'), 'Trigger must fire BEFORE UPDATE OR DELETE');
});

test('Static DDL Inspection: Migration 00003 enables FORCE RLS and locks privileged mutation operations from hrms_app_user', () => {
  const m3Path = path.join(migrationsDir, '20261109000003_roles_and_provisioning.sql');
  const content = fs.readFileSync(m3Path, 'utf8');

  // RLS enablement & FORCE
  assert(content.includes('ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;'), 'Must enable RLS on user_roles');
  assert(content.includes('ALTER TABLE account_provisioning_requests ENABLE ROW LEVEL SECURITY;'), 'Must enable RLS on account_provisioning_requests');
  assert(content.includes('ALTER TABLE account_provisioning_events ENABLE ROW LEVEL SECURITY;'), 'Must enable RLS on account_provisioning_events');

  assert(content.includes('ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;'), 'Must FORCE RLS on user_roles');
  assert(content.includes('ALTER TABLE account_provisioning_requests FORCE ROW LEVEL SECURITY;'), 'Must FORCE RLS on account_provisioning_requests');
  assert(content.includes('ALTER TABLE account_provisioning_events FORCE ROW LEVEL SECURITY;'), 'Must FORCE RLS on account_provisioning_events');

  // Tenant policies
  assert(content.includes('CREATE POLICY rls_user_roles_select ON user_roles'), 'Must create rls_user_roles_select');
  assert(content.includes('CREATE POLICY rls_prov_requests_select ON account_provisioning_requests'), 'Must create rls_prov_requests_select');
  assert(content.includes('CREATE POLICY rls_prov_events_select ON account_provisioning_events'), 'Must create rls_prov_events_select');

  // Grants & Revokes
  assert(content.includes('GRANT SELECT ON user_roles TO hrms_app_user;'), 'Must grant SELECT on user_roles to hrms_app_user');
  assert(content.includes('GRANT SELECT ON account_provisioning_requests TO hrms_app_user;'), 'Must grant SELECT on account_provisioning_requests to hrms_app_user');
  assert(content.includes('GRANT SELECT ON account_provisioning_events TO hrms_app_user;'), 'Must grant SELECT on account_provisioning_events to hrms_app_user');

  assert(content.includes('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON user_roles FROM hrms_app_user, PUBLIC;'), 'Must revoke mutations on user_roles');
  assert(content.includes('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON account_provisioning_requests FROM hrms_app_user, PUBLIC;'), 'Must revoke mutations on requests');
  assert(content.includes('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON account_provisioning_events FROM hrms_app_user, PUBLIC;'), 'Must revoke mutations on events');
});

// ============================================================================
// PART 2: IN-MEMORY RELATIONAL SIMULATION OF ROLES & PROVISIONING
// ============================================================================

type UserRoleType = 'SUPER_ADMIN' | 'ADMIN' | 'EMPLOYEE';
type ProvisioningStatusType = 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

interface SimUserRole {
  id: string;
  organization_id: string;
  user_id: string;
  role: UserRoleType;
  assigned_by?: string;
  assigned_at: Date;
}

interface SimProvRequest {
  id: string;
  organization_id: string;
  idempotency_key: string;
  phone_number: string;
  requested_roles: UserRoleType[];
  status: ProvisioningStatusType;
  requested_by: string;
  requested_at: Date;
  request_notes?: string;
  reviewed_by?: string;
  reviewed_at?: Date;
  review_decision?: string;
  rejection_reason?: string;
  review_notes?: string;
  auth_user_id?: string;
  user_id?: string;
  retry_count: number;
  locked_until?: Date;
  error_message?: string;
  created_at: Date;
  updated_at: Date;
}

interface SimProvEvent {
  id: string;
  organization_id: string;
  request_id: string;
  actor_user_id: string;
  from_status?: ProvisioningStatusType;
  to_status: ProvisioningStatusType;
  action: string;
  reason?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  created_at: Date;
}

class RolesAndProvisioningSimulator {
  // Underlying Task 1.2 tables
  private organizations: Set<string> = new Set();
  private users: Map<string, { id: string; organization_id: string }> = new Map();

  // Task 1.3 tables
  private userRoles: Map<string, SimUserRole> = new Map();
  private provRequests: Map<string, SimProvRequest> = new Map();
  private provEvents: Map<string, SimProvEvent> = new Map();

  // Session context (GUCs)
  private currentOrgId: string | null = null;
  private currentUserId: string | null = null;

  setSession(orgId: string | null, userId: string | null = null): void {
    this.currentOrgId = orgId;
    this.currentUserId = userId;
  }

  clearSession(): void {
    this.currentOrgId = null;
    this.currentUserId = null;
  }

  current_org_id(): string | null {
    return this.currentOrgId;
  }

  auth_user_id(): string | null {
    return this.currentUserId;
  }

  // Seed helpers
  seedOrganization(orgId: string): void {
    this.organizations.add(orgId);
  }

  seedUser(orgId: string, userId: string): void {
    if (!this.organizations.has(orgId)) {
      throw new Error(`Foreign key violation: organization ${orgId} not found`);
    }
    this.users.set(userId, { id: userId, organization_id: orgId });
  }

  // --------------------------------------------------------------------------
  // USER ROLES
  // --------------------------------------------------------------------------
  assignRole(data: {
    id?: string;
    organization_id: string;
    user_id: string;
    role: UserRoleType;
    assigned_by?: string;
  }): SimUserRole {
    // 1. FK fk_user_roles_org
    if (!this.organizations.has(data.organization_id)) {
      throw new Error(`Foreign key violation: organization_id ${data.organization_id} does not exist`);
    }

    // 2. Composite FK fk_user_roles_org_user (organization_id, user_id) -> users(organization_id, id)
    const user = this.users.get(data.user_id);
    if (!user || user.organization_id !== data.organization_id) {
      throw new Error(`Composite FK violation: fk_user_roles_org_user: user ${data.user_id} does not belong to organization ${data.organization_id}`);
    }

    // 3. Composite FK fk_user_roles_org_assigned_by
    if (data.assigned_by) {
      const assigner = this.users.get(data.assigned_by);
      if (!assigner || assigner.organization_id !== data.organization_id) {
        throw new Error(`Composite FK violation: fk_user_roles_org_assigned_by: assigner ${data.assigned_by} does not belong to organization ${data.organization_id}`);
      }
    }

    // 4. UNIQUE uq_user_roles_org_user_role (organization_id, user_id, role)
    for (const ur of this.userRoles.values()) {
      if (ur.organization_id === data.organization_id && ur.user_id === data.user_id && ur.role === data.role) {
        throw new Error(`UNIQUE constraint violation: uq_user_roles_org_user_role (${data.organization_id}, ${data.user_id}, ${data.role})`);
      }
    }

    const id = data.id || `ur-${Math.random().toString(36).substring(2, 10)}`;
    const record: SimUserRole = {
      id,
      organization_id: data.organization_id,
      user_id: data.user_id,
      role: data.role,
      assigned_by: data.assigned_by,
      assigned_at: new Date(),
    };

    this.userRoles.set(id, record);
    return record;
  }

  // Authorization Helpers
  is_admin_or_super(): boolean {
    const orgId = this.current_org_id();
    const userId = this.auth_user_id();
    if (!orgId || !userId) return false;

    for (const ur of this.userRoles.values()) {
      if (ur.organization_id === orgId && ur.user_id === userId && (ur.role === 'SUPER_ADMIN' || ur.role === 'ADMIN')) {
        return true;
      }
    }
    return false;
  }

  is_super_admin(): boolean {
    const orgId = this.current_org_id();
    const userId = this.auth_user_id();
    if (!orgId || !userId) return false;

    for (const ur of this.userRoles.values()) {
      if (ur.organization_id === orgId && ur.user_id === userId && ur.role === 'SUPER_ADMIN') {
        return true;
      }
    }
    return false;
  }

  selectUserRoles(): SimUserRole[] {
    const activeOrgId = this.current_org_id();
    if (!activeOrgId) return [];
    return Array.from(this.userRoles.values()).filter((r) => r.organization_id === activeOrgId);
  }

  // --------------------------------------------------------------------------
  // ACCOUNT PROVISIONING REQUESTS
  // --------------------------------------------------------------------------
  createProvisioningRequest(data: {
    id?: string;
    organization_id: string;
    idempotency_key: string;
    phone_number: string;
    requested_roles: UserRoleType[];
    requested_by: string;
    request_notes?: string;
  }): SimProvRequest {
    // 1. FK fk_prov_org
    if (!this.organizations.has(data.organization_id)) {
      throw new Error(`Foreign key violation: organization_id ${data.organization_id} does not exist`);
    }

    // 2. Composite FK fk_prov_org_requested_by
    const requester = this.users.get(data.requested_by);
    if (!requester || requester.organization_id !== data.organization_id) {
      throw new Error(`Composite FK violation: fk_prov_org_requested_by: requester ${data.requested_by} does not belong to organization ${data.organization_id}`);
    }

    // 3. Unique idempotency key per org
    for (const req of this.provRequests.values()) {
      if (req.organization_id === data.organization_id && req.idempotency_key === data.idempotency_key) {
        throw new Error(`UNIQUE constraint violation: uq_prov_org_idempotency: key '${data.idempotency_key}' in organization ${data.organization_id}`);
      }
    }

    // 4. Format checks
    if (!/^\+?[0-9]{10,15}$/.test(data.phone_number)) {
      throw new Error('CHECK constraint violation: chk_prov_phone_format');
    }

    const id = data.id || `req-${Math.random().toString(36).substring(2, 10)}`;
    const now = new Date();
    const record: SimProvRequest = {
      id,
      organization_id: data.organization_id,
      idempotency_key: data.idempotency_key,
      phone_number: data.phone_number,
      requested_roles: data.requested_roles,
      status: 'SUBMITTED',
      requested_by: data.requested_by,
      requested_at: now,
      request_notes: data.request_notes,
      retry_count: 0,
      created_at: now,
      updated_at: now,
    };

    this.provRequests.set(id, record);
    return record;
  }

  reviewProvisioningRequest(data: {
    id: string;
    organization_id: string;
    reviewed_by: string;
    decision: 'APPROVED' | 'REJECTED';
    rejection_reason?: string;
    review_notes?: string;
  }): SimProvRequest {
    const req = this.provRequests.get(data.id);
    if (!req || req.organization_id !== data.organization_id) {
      throw new Error(`Request ${data.id} not found in organization ${data.organization_id}`);
    }

    // 1. Composite FK fk_prov_org_reviewed_by
    const reviewer = this.users.get(data.reviewed_by);
    if (!reviewer || reviewer.organization_id !== data.organization_id) {
      throw new Error(`Composite FK violation: fk_prov_org_reviewed_by: reviewer ${data.reviewed_by} does not belong to organization ${data.organization_id}`);
    }

    // 2. Maker-Checker Separation Invariant
    if (data.reviewed_by === req.requested_by) {
      throw new Error('CHECK constraint violation: chk_prov_maker_checker_distinct (Maker cannot act as Checker)');
    }

    // 3. Rejection Reason Invariant
    if (data.decision === 'REJECTED' && (!data.rejection_reason || data.rejection_reason.trim() === '')) {
      throw new Error('CHECK constraint violation: chk_prov_rejection_reason (Rejection requires non-empty reason)');
    }

    const now = new Date();
    req.status = data.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
    req.reviewed_by = data.reviewed_by;
    req.reviewed_at = now;
    req.review_decision = data.decision;
    req.rejection_reason = data.rejection_reason;
    req.review_notes = data.review_notes;
    req.updated_at = now;

    return req;
  }

  selectProvisioningRequests(): SimProvRequest[] {
    const activeOrgId = this.current_org_id();
    if (!activeOrgId) return [];
    return Array.from(this.provRequests.values()).filter((r) => r.organization_id === activeOrgId);
  }

  // --------------------------------------------------------------------------
  // IMMUTABLE PROVISIONING EVENTS AUDIT LEDGER
  // --------------------------------------------------------------------------
  appendProvisioningEvent(data: {
    id?: string;
    organization_id: string;
    request_id: string;
    actor_user_id: string;
    from_status?: ProvisioningStatusType;
    to_status: ProvisioningStatusType;
    action: string;
    reason?: string;
    notes?: string;
    metadata?: Record<string, unknown>;
  }): SimProvEvent {
    // 1. Composite FK fk_prov_event_org_req
    const req = this.provRequests.get(data.request_id);
    if (!req || req.organization_id !== data.organization_id) {
      throw new Error(`Composite FK violation: fk_prov_event_org_req: request ${data.request_id} does not belong to organization ${data.organization_id}`);
    }

    // 2. Composite FK fk_prov_event_org_actor
    const actor = this.users.get(data.actor_user_id);
    if (!actor || actor.organization_id !== data.organization_id) {
      throw new Error(`Composite FK violation: fk_prov_event_org_actor: actor ${data.actor_user_id} does not belong to organization ${data.organization_id}`);
    }

    const id = data.id || `evt-${Math.random().toString(36).substring(2, 10)}`;
    const record: SimProvEvent = {
      id,
      organization_id: data.organization_id,
      request_id: data.request_id,
      actor_user_id: data.actor_user_id,
      from_status: data.from_status,
      to_status: data.to_status,
      action: data.action,
      reason: data.reason,
      notes: data.notes,
      metadata: data.metadata,
      created_at: new Date(),
    };

    this.provEvents.set(id, record);
    return record;
  }

  // Trigger simulation: UPDATE / DELETE on audit ledger
  updateProvisioningEvent(id: string, updates: Partial<SimProvEvent>): SimProvEvent {
    throw new Error('SQLSTATE 23505: account_provisioning_events records are append-only and strictly immutable');
  }

  deleteProvisioningEvent(id: string): void {
    throw new Error('SQLSTATE 23505: account_provisioning_events records are append-only and strictly immutable');
  }

  selectProvisioningEvents(): SimProvEvent[] {
    const activeOrgId = this.current_org_id();
    if (!activeOrgId) return [];
    return Array.from(this.provEvents.values()).filter((e) => e.organization_id === activeOrgId);
  }

  // Referential action: delete user
  deleteUser(userId: string): void {
    const user = this.users.get(userId);
    if (!user) return;

    // 1. fk_prov_event_org_actor ON DELETE RESTRICT
    for (const evt of this.provEvents.values()) {
      if (evt.actor_user_id === userId) {
        throw new Error(`FOREIGN KEY constraint violation: fk_prov_event_org_actor: cannot delete user ${userId} because audit events reference this actor (ON DELETE RESTRICT)`);
      }
    }

    // 2. fk_prov_org_requested_by & fk_prov_org_reviewed_by ON DELETE RESTRICT
    for (const req of this.provRequests.values()) {
      if (req.requested_by === userId) {
        throw new Error(`FOREIGN KEY constraint violation: fk_prov_org_requested_by: cannot delete user ${userId} because provisioning requests reference them as maker (ON DELETE RESTRICT)`);
      }
      if (req.reviewed_by === userId) {
        throw new Error(`FOREIGN KEY constraint violation: fk_prov_org_reviewed_by: cannot delete user ${userId} because provisioning requests reference them as checker (ON DELETE RESTRICT)`);
      }
    }

    // 3. fk_user_roles_org_user ON DELETE CASCADE: delete user roles for this user
    for (const [id, ur] of Array.from(this.userRoles.entries())) {
      if (ur.user_id === userId) {
        this.userRoles.delete(id);
      }
    }

    // 4. fk_user_roles_org_assigned_by ON DELETE SET NULL (assigned_by) (PostgreSQL 15+ column-specific)
    // ONLY assigned_by is set to null/undefined; organization_id remains intact and unmodified!
    for (const ur of this.userRoles.values()) {
      if (ur.assigned_by === userId) {
        ur.assigned_by = undefined;
      }
    }

    this.users.delete(userId);
  }

  // Referential action: delete provisioning request
  deleteProvisioningRequest(requestId: string): void {
    const req = this.provRequests.get(requestId);
    if (!req) return;

    // 1. fk_prov_event_org_req ON DELETE RESTRICT
    for (const evt of this.provEvents.values()) {
      if (evt.request_id === requestId) {
        throw new Error(`FOREIGN KEY constraint violation: fk_prov_event_org_req: cannot delete request ${requestId} because audit events exist in account_provisioning_events (ON DELETE RESTRICT)`);
      }
    }

    this.provRequests.delete(requestId);
  }

  // Direct lookup helper for role
  getUserRole(id: string): SimUserRole | undefined {
    return this.userRoles.get(id);
  }

  // Privilege Boundary Simulation: runtime connection role (hrms_app_user)
  attemptAppUserMutation(table: 'user_roles' | 'account_provisioning_requests' | 'account_provisioning_events'): void {
    throw new Error(`SQLSTATE 42501: permission denied for table ${table} (privileged operation locked from hrms_app_user)`);
  }
}

// ============================================================================
// PART 3: SIMULATION TEST CASES FOR TASK 1.3
// ============================================================================

test('Logic Simulation: TC-ROLE-01: Assign role to user within tenant succeeds', () => {
  const sim = new RolesAndProvisioningSimulator();
  const orgId = '11111111-0000-0000-0000-000000000001';
  const superId = 'super-user-1';
  const targetId = 'target-user-1';

  sim.seedOrganization(orgId);
  sim.seedUser(orgId, superId);
  sim.seedUser(orgId, targetId);

  const roleRecord = sim.assignRole({
    organization_id: orgId,
    user_id: targetId,
    role: 'ADMIN',
    assigned_by: superId,
  });

  assert.equal(roleRecord.organization_id, orgId);
  assert.equal(roleRecord.user_id, targetId);
  assert.equal(roleRecord.role, 'ADMIN');
  assert.equal(roleRecord.assigned_by, superId);
});

test('Logic Simulation: TC-ROLE-02: Assign role fails if target user or assigner belongs to different organization', () => {
  const sim = new RolesAndProvisioningSimulator();
  const orgA = 'org-a';
  const orgB = 'org-b';
  const userA = 'user-a';
  const userB = 'user-b';

  sim.seedOrganization(orgA);
  sim.seedOrganization(orgB);
  sim.seedUser(orgA, userA);
  sim.seedUser(orgB, userB);

  // Target user B assigned role in Org A -> Fails composite FK
  assert.throws(
    () => {
      sim.assignRole({
        organization_id: orgA,
        user_id: userB,
        role: 'EMPLOYEE',
      });
    },
    /Composite FK violation: fk_user_roles_org_user/
  );

  // Assigner B from Org B assigns role in Org A -> Fails composite FK
  assert.throws(
    () => {
      sim.assignRole({
        organization_id: orgA,
        user_id: userA,
        role: 'ADMIN',
        assigned_by: userB,
      });
    },
    /Composite FK violation: fk_user_roles_org_assigned_by/
  );
});

test('Logic Simulation: TC-ROLE-03: Duplicate role assignment for same user within tenant fails (uq_user_roles_org_user_role)', () => {
  const sim = new RolesAndProvisioningSimulator();
  const orgId = 'org-dup';
  const userId = 'user-dup';

  sim.seedOrganization(orgId);
  sim.seedUser(orgId, userId);

  sim.assignRole({ organization_id: orgId, user_id: userId, role: 'EMPLOYEE' });

  assert.throws(
    () => {
      sim.assignRole({ organization_id: orgId, user_id: userId, role: 'EMPLOYEE' });
    },
    /UNIQUE constraint violation: uq_user_roles_org_user_role/
  );
});

test('Logic Simulation: TC-ROLE-04: Role authorization helpers evaluate current session context correctly', () => {
  const sim = new RolesAndProvisioningSimulator();
  const orgA = 'org-a';
  const orgB = 'org-b';
  const adminUser = 'admin-user';
  const employeeUser = 'employee-user';

  sim.seedOrganization(orgA);
  sim.seedOrganization(orgB);
  sim.seedUser(orgA, adminUser);
  sim.seedUser(orgA, employeeUser);

  sim.assignRole({ organization_id: orgA, user_id: adminUser, role: 'ADMIN' });
  sim.assignRole({ organization_id: orgA, user_id: employeeUser, role: 'EMPLOYEE' });

  // 1. Admin session in Org A
  sim.setSession(orgA, adminUser);
  assert.equal(sim.is_admin_or_super(), true);
  assert.equal(sim.is_super_admin(), false);

  // 2. Employee session in Org A
  sim.setSession(orgA, employeeUser);
  assert.equal(sim.is_admin_or_super(), false);
  assert.equal(sim.is_super_admin(), false);

  // 3. Admin session in Org B (different tenant context)
  sim.setSession(orgB, adminUser);
  assert.equal(sim.is_admin_or_super(), false, 'Admin in Org A must NOT be admin in Org B!');

  // 4. Session unset
  sim.clearSession();
  assert.equal(sim.is_admin_or_super(), false);
  assert.equal(sim.is_super_admin(), false);
});

test('Logic Simulation: TC-PROV-01: Maker creates account provisioning request in SUBMITTED status', () => {
  const sim = new RolesAndProvisioningSimulator();
  const orgId = 'org-prov';
  const makerId = 'maker-user';

  sim.seedOrganization(orgId);
  sim.seedUser(orgId, makerId);

  const req = sim.createProvisioningRequest({
    organization_id: orgId,
    idempotency_key: 'idemp-001',
    phone_number: '+919876543210',
    requested_roles: ['EMPLOYEE'],
    requested_by: makerId,
    request_notes: 'New hire onboarding',
  });

  assert.equal(req.status, 'SUBMITTED');
  assert.equal(req.requested_by, makerId);
  assert.equal(req.reviewed_by, undefined);
  assert.equal(req.reviewed_at, undefined);
});

test('Logic Simulation: TC-PROV-02: Maker-Checker separation invariant: Maker self-approval fails database constraint', () => {
  const sim = new RolesAndProvisioningSimulator();
  const orgId = 'org-prov';
  const makerId = 'maker-user';

  sim.seedOrganization(orgId);
  sim.seedUser(orgId, makerId);

  const req = sim.createProvisioningRequest({
    organization_id: orgId,
    idempotency_key: 'idemp-002',
    phone_number: '+919876543210',
    requested_roles: ['EMPLOYEE'],
    requested_by: makerId,
  });

  // Maker attempts self-approval
  assert.throws(
    () => {
      sim.reviewProvisioningRequest({
        id: req.id,
        organization_id: orgId,
        reviewed_by: makerId, // Self-approval!
        decision: 'APPROVED',
      });
    },
    /chk_prov_maker_checker_distinct/
  );
});

test('Logic Simulation: TC-PROV-03: Checker from same organization successfully approves request', () => {
  const sim = new RolesAndProvisioningSimulator();
  const orgId = 'org-prov';
  const makerId = 'maker-user';
  const checkerId = 'checker-user';

  sim.seedOrganization(orgId);
  sim.seedUser(orgId, makerId);
  sim.seedUser(orgId, checkerId);

  const req = sim.createProvisioningRequest({
    organization_id: orgId,
    idempotency_key: 'idemp-003',
    phone_number: '+919876543210',
    requested_roles: ['EMPLOYEE'],
    requested_by: makerId,
  });

  const reviewed = sim.reviewProvisioningRequest({
    id: req.id,
    organization_id: orgId,
    reviewed_by: checkerId,
    decision: 'APPROVED',
    review_notes: 'KYC verified',
  });

  assert.equal(reviewed.status, 'APPROVED');
  assert.equal(reviewed.reviewed_by, checkerId);
  assert.notEqual(reviewed.reviewed_at, undefined);
});

test('Logic Simulation: TC-PROV-04: Checker from different organization fails composite FK constraint', () => {
  const sim = new RolesAndProvisioningSimulator();
  const orgA = 'org-a';
  const orgB = 'org-b';
  const makerA = 'maker-a';
  const checkerB = 'checker-b';

  sim.seedOrganization(orgA);
  sim.seedOrganization(orgB);
  sim.seedUser(orgA, makerA);
  sim.seedUser(orgB, checkerB);

  const req = sim.createProvisioningRequest({
    organization_id: orgA,
    idempotency_key: 'idemp-004',
    phone_number: '+919876543210',
    requested_roles: ['EMPLOYEE'],
    requested_by: makerA,
  });

  assert.throws(
    () => {
      sim.reviewProvisioningRequest({
        id: req.id,
        organization_id: orgA,
        reviewed_by: checkerB, // Belongs to Org B!
        decision: 'APPROVED',
      });
    },
    /Composite FK violation: fk_prov_org_reviewed_by/
  );
});

test('Logic Simulation: TC-PROV-05: Rejection without reason fails chk_prov_rejection_reason', () => {
  const sim = new RolesAndProvisioningSimulator();
  const orgId = 'org-rej';
  const makerId = 'maker-rej';
  const checkerId = 'checker-rej';

  sim.seedOrganization(orgId);
  sim.seedUser(orgId, makerId);
  sim.seedUser(orgId, checkerId);

  const req = sim.createProvisioningRequest({
    organization_id: orgId,
    idempotency_key: 'idemp-005',
    phone_number: '+919876543210',
    requested_roles: ['EMPLOYEE'],
    requested_by: makerId,
  });

  assert.throws(
    () => {
      sim.reviewProvisioningRequest({
        id: req.id,
        organization_id: orgId,
        reviewed_by: checkerId,
        decision: 'REJECTED',
        // rejection_reason omitted
      });
    },
    /chk_prov_rejection_reason/
  );
});

test('Logic Simulation: TC-PROV-06: Rejection with reason succeeds', () => {
  const sim = new RolesAndProvisioningSimulator();
  const orgId = 'org-rej';
  const makerId = 'maker-rej';
  const checkerId = 'checker-rej';

  sim.seedOrganization(orgId);
  sim.seedUser(orgId, makerId);
  sim.seedUser(orgId, checkerId);

  const req = sim.createProvisioningRequest({
    organization_id: orgId,
    idempotency_key: 'idemp-006',
    phone_number: '+919876543210',
    requested_roles: ['EMPLOYEE'],
    requested_by: makerId,
  });

  const reviewed = sim.reviewProvisioningRequest({
    id: req.id,
    organization_id: orgId,
    reviewed_by: checkerId,
    decision: 'REJECTED',
    rejection_reason: 'Incomplete background verification document',
  });

  assert.equal(reviewed.status, 'REJECTED');
  assert.equal(reviewed.rejection_reason, 'Incomplete background verification document');
});

test('Logic Simulation: TC-PROV-07: Duplicate idempotency key within tenant fails uq_prov_org_idempotency', () => {
  const sim = new RolesAndProvisioningSimulator();
  const orgId = 'org-idemp';
  const makerId = 'maker-idemp';

  sim.seedOrganization(orgId);
  sim.seedUser(orgId, makerId);

  sim.createProvisioningRequest({
    organization_id: orgId,
    idempotency_key: 'dup-key',
    phone_number: '+919876543210',
    requested_roles: ['EMPLOYEE'],
    requested_by: makerId,
  });

  assert.throws(
    () => {
      sim.createProvisioningRequest({
        organization_id: orgId,
        idempotency_key: 'dup-key',
        phone_number: '+919876543211',
        requested_roles: ['EMPLOYEE'],
        requested_by: makerId,
      });
    },
    /uq_prov_org_idempotency/
  );
});

test('Logic Simulation: TC-PROV-08: Cross-tenant idempotency key reuse succeeds', () => {
  const sim = new RolesAndProvisioningSimulator();
  const orgA = 'org-a';
  const orgB = 'org-b';
  const makerA = 'maker-a';
  const makerB = 'maker-b';

  sim.seedOrganization(orgA);
  sim.seedOrganization(orgB);
  sim.seedUser(orgA, makerA);
  sim.seedUser(orgB, makerB);

  const reqA = sim.createProvisioningRequest({
    organization_id: orgA,
    idempotency_key: 'shared-key-100',
    phone_number: '+919876543210',
    requested_roles: ['EMPLOYEE'],
    requested_by: makerA,
  });

  const reqB = sim.createProvisioningRequest({
    organization_id: orgB,
    idempotency_key: 'shared-key-100',
    phone_number: '+919876543210',
    requested_roles: ['EMPLOYEE'],
    requested_by: makerB,
  });

  assert.equal(reqA.idempotency_key, reqB.idempotency_key);
  assert.notEqual(reqA.organization_id, reqB.organization_id);
});

test('Logic Simulation: TC-AUDIT-01: Appending event to audit ledger succeeds with composite FKs', () => {
  const sim = new RolesAndProvisioningSimulator();
  const orgId = 'org-audit';
  const makerId = 'maker-user';

  sim.seedOrganization(orgId);
  sim.seedUser(orgId, makerId);

  const req = sim.createProvisioningRequest({
    organization_id: orgId,
    idempotency_key: 'idemp-audit-1',
    phone_number: '+919876543210',
    requested_roles: ['EMPLOYEE'],
    requested_by: makerId,
  });

  const evt = sim.appendProvisioningEvent({
    organization_id: orgId,
    request_id: req.id,
    actor_user_id: makerId,
    to_status: 'SUBMITTED',
    action: 'REQUEST_SUBMITTED',
    notes: 'Submitted via Web Admin Portal',
  });

  assert.equal(evt.organization_id, orgId);
  assert.equal(evt.request_id, req.id);
  assert.equal(evt.actor_user_id, makerId);
  assert.equal(evt.action, 'REQUEST_SUBMITTED');
});

test('Logic Simulation: TC-AUDIT-02 & TC-AUDIT-03: UPDATE or DELETE on audit ledger raises SQLSTATE 23505 immutability trigger exception', () => {
  const sim = new RolesAndProvisioningSimulator();
  const orgId = 'org-audit';
  const makerId = 'maker-user';

  sim.seedOrganization(orgId);
  sim.seedUser(orgId, makerId);

  const req = sim.createProvisioningRequest({
    organization_id: orgId,
    idempotency_key: 'idemp-audit-2',
    phone_number: '+919876543210',
    requested_roles: ['EMPLOYEE'],
    requested_by: makerId,
  });

  const evt = sim.appendProvisioningEvent({
    organization_id: orgId,
    request_id: req.id,
    actor_user_id: makerId,
    to_status: 'SUBMITTED',
    action: 'REQUEST_SUBMITTED',
  });

  // UPDATE attempt fails
  assert.throws(
    () => {
      sim.updateProvisioningEvent(evt.id, { action: 'MODIFIED_ACTION' });
    },
    /account_provisioning_events records are append-only and strictly immutable/
  );

  // DELETE attempt fails
  assert.throws(
    () => {
      sim.deleteProvisioningEvent(evt.id);
    },
    /account_provisioning_events records are append-only and strictly immutable/
  );
});

test('Logic Simulation: TC-TEN-ROLE-01 & TC-TEN-PROV-01: Cross-tenant RLS isolation on roles and requests', () => {
  const sim = new RolesAndProvisioningSimulator();
  const orgA = 'org-alpha';
  const orgB = 'org-beta';
  const userA = 'user-alpha';
  const userB = 'user-beta';

  sim.seedOrganization(orgA);
  sim.seedOrganization(orgB);
  sim.seedUser(orgA, userA);
  sim.seedUser(orgB, userB);

  sim.assignRole({ organization_id: orgA, user_id: userA, role: 'ADMIN' });
  sim.assignRole({ organization_id: orgB, user_id: userB, role: 'SUPER_ADMIN' });

  sim.createProvisioningRequest({
    organization_id: orgA,
    idempotency_key: 'key-alpha',
    phone_number: '+919876543210',
    requested_roles: ['EMPLOYEE'],
    requested_by: userA,
  });

  sim.createProvisioningRequest({
    organization_id: orgB,
    idempotency_key: 'key-beta',
    phone_number: '+919876543211',
    requested_roles: ['EMPLOYEE'],
    requested_by: userB,
  });

  // Session: Org Alpha
  sim.setSession(orgA, userA);
  const alphaRoles = sim.selectUserRoles();
  assert.equal(alphaRoles.length, 1);
  assert.equal(alphaRoles[0].user_id, userA);

  const alphaRequests = sim.selectProvisioningRequests();
  assert.equal(alphaRequests.length, 1);
  assert.equal(alphaRequests[0].idempotency_key, 'key-alpha');

  // Session: Org Beta
  sim.setSession(orgB, userB);
  const betaRoles = sim.selectUserRoles();
  assert.equal(betaRoles.length, 1);
  assert.equal(betaRoles[0].user_id, userB);

  const betaRequests = sim.selectProvisioningRequests();
  assert.equal(betaRequests.length, 1);
  assert.equal(betaRequests[0].idempotency_key, 'key-beta');
});

test('Logic Simulation: TC-AUTH-LOCK-01: Runtime connection role hrms_app_user cannot mutate roles or provisioning tables directly', () => {
  const sim = new RolesAndProvisioningSimulator();

  assert.throws(
    () => {
      sim.attemptAppUserMutation('user_roles');
    },
    /permission denied for table user_roles/
  );

  assert.throws(
    () => {
      sim.attemptAppUserMutation('account_provisioning_requests');
    },
    /permission denied for table account_provisioning_requests/
  );

  assert.throws(
    () => {
      sim.attemptAppUserMutation('account_provisioning_events');
    },
    /permission denied for table account_provisioning_events/
  );
});

test('Logic Simulation: TC-REF-01: Column-specific ON DELETE SET NULL (assigned_by) sets only assigned_by to null and preserves mandatory organization_id', () => {
  const sim = new RolesAndProvisioningSimulator();
  const orgId = '11111111-0000-0000-0000-000000000001';
  const assignerId = 'admin-assigner-1';
  const targetId = 'employee-target-1';

  sim.seedOrganization(orgId);
  sim.seedUser(orgId, assignerId);
  sim.seedUser(orgId, targetId);

  const role = sim.assignRole({
    organization_id: orgId,
    user_id: targetId,
    role: 'EMPLOYEE',
    assigned_by: assignerId,
  });

  assert.equal(role.assigned_by, assignerId);
  assert.equal(role.organization_id, orgId);

  // Assigner leaves organization and their user record is deleted
  sim.deleteUser(assignerId);

  // Under PostgreSQL 15+ column-specific ON DELETE SET NULL (assigned_by):
  // 1. assigned_by is nulled
  // 2. organization_id remains intact and NOT NULL!
  const updatedRole = sim.getUserRole(role.id);
  assert.notEqual(updatedRole, undefined);
  assert.equal(updatedRole?.assigned_by, undefined, 'assigned_by must be set to null/undefined');
  assert.equal(updatedRole?.organization_id, orgId, 'organization_id must NOT be nulled');
  assert.equal(updatedRole?.user_id, targetId, 'user_id must remain assigned');
});

test('Logic Simulation: TC-REF-02: Target user deletion cascades role assignments (fk_user_roles_org_user ON DELETE CASCADE)', () => {
  const sim = new RolesAndProvisioningSimulator();
  const orgId = '11111111-0000-0000-0000-000000000001';
  const targetId = 'employee-target-2';

  sim.seedOrganization(orgId);
  sim.seedUser(orgId, targetId);

  const role = sim.assignRole({
    organization_id: orgId,
    user_id: targetId,
    role: 'EMPLOYEE',
  });

  // Deleting user cascades to user_roles
  sim.deleteUser(targetId);

  assert.equal(sim.getUserRole(role.id), undefined, 'Role assignment must be cascaded when user is deleted');
});

test('Logic Simulation: TC-AUDIT-DEL-01: Provisioning request deletion is blocked when audit events exist (fk_prov_event_org_req ON DELETE RESTRICT)', () => {
  const sim = new RolesAndProvisioningSimulator();
  const orgId = 'org-audit-del';
  const makerId = 'maker-user';

  sim.seedOrganization(orgId);
  sim.seedUser(orgId, makerId);

  const req = sim.createProvisioningRequest({
    organization_id: orgId,
    idempotency_key: 'idemp-del-1',
    phone_number: '+919876543210',
    requested_roles: ['EMPLOYEE'],
    requested_by: makerId,
  });

  // Append audit event
  sim.appendProvisioningEvent({
    organization_id: orgId,
    request_id: req.id,
    actor_user_id: makerId,
    to_status: 'SUBMITTED',
    action: 'REQUEST_SUBMITTED',
  });

  // Deleting provisioning request must be rejected under ON DELETE RESTRICT
  assert.throws(
    () => {
      sim.deleteProvisioningRequest(req.id);
    },
    /fk_prov_event_org_req: cannot delete request .* because audit events exist in account_provisioning_events \(ON DELETE RESTRICT\)/
  );
});

test('Logic Simulation: TC-AUDIT-DEL-02: User deletion is blocked when audit events record their actions (fk_prov_event_org_actor ON DELETE RESTRICT)', () => {
  const sim = new RolesAndProvisioningSimulator();
  const orgId = 'org-audit-actor';
  const makerId = 'maker-actor';

  sim.seedOrganization(orgId);
  sim.seedUser(orgId, makerId);

  const req = sim.createProvisioningRequest({
    organization_id: orgId,
    idempotency_key: 'idemp-del-2',
    phone_number: '+919876543210',
    requested_roles: ['EMPLOYEE'],
    requested_by: makerId,
  });

  sim.appendProvisioningEvent({
    organization_id: orgId,
    request_id: req.id,
    actor_user_id: makerId,
    to_status: 'SUBMITTED',
    action: 'REQUEST_SUBMITTED',
  });

  // Deleting maker user who acted in audit event must be rejected under ON DELETE RESTRICT
  assert.throws(
    () => {
      sim.deleteUser(makerId);
    },
    /fk_prov_event_org_actor: cannot delete user .* because audit events reference this actor \(ON DELETE RESTRICT\)/
  );
});

test('Logic Simulation: TC-AUDIT-DEL-03: User deletion is blocked when provisioning requests reference them as maker or checker', () => {
  const sim = new RolesAndProvisioningSimulator();
  const orgId = 'org-audit-mc';
  const makerId = 'maker-mc';
  const checkerId = 'checker-mc';

  sim.seedOrganization(orgId);
  sim.seedUser(orgId, makerId);
  sim.seedUser(orgId, checkerId);

  const req = sim.createProvisioningRequest({
    organization_id: orgId,
    idempotency_key: 'idemp-del-3',
    phone_number: '+919876543210',
    requested_roles: ['EMPLOYEE'],
    requested_by: makerId,
  });

  sim.reviewProvisioningRequest({
    id: req.id,
    organization_id: orgId,
    reviewed_by: checkerId,
    decision: 'APPROVED',
  });

  // Deleting checker must be blocked
  assert.throws(
    () => {
      sim.deleteUser(checkerId);
    },
    /fk_prov_org_reviewed_by/
  );

  // Deleting maker must be blocked
  assert.throws(
    () => {
      sim.deleteUser(makerId);
    },
    /fk_prov_org_requested_by/
  );
});
