-- ============================================================================
-- HRMS SaaS Platform — Migration 00003: Roles & Account Provisioning Foundation
-- ============================================================================
-- Version:        20261109000003
-- Task ID:        HRMS-PHASE-B-TASK-1.3
-- Scope:          User Roles Foundation, Role Authorization Helpers,
--                 Account Provisioning Request Queue (Maker-Checker Workflow),
--                 Immutable Provisioning Event Audit Ledger & Least-Privilege Grants
-- Engine:         PostgreSQL 15+ (Supabase Production Architecture)
-- Prerequisites:  Migrations 00001 (types/roles) and 00002 (orgs/users)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PROVISIONING WORKFLOW ENUM
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'provisioning_status_enum') THEN
        CREATE TYPE provisioning_status_enum AS ENUM (
            'SUBMITTED',     -- Initial provisioning request created by Maker
            'APPROVED',      -- Reviewed & approved by Checker (Maker != Checker)
            'REJECTED',      -- Reviewed & rejected by Checker with mandatory reason
            'PROCESSING',    -- Asynchronous identity creation / DB provisioning in progress
            'COMPLETED',     -- User account provisioned in auth.users and public.users
            'FAILED',        -- Execution failed during provisioning
            'CANCELLED'      -- Cancelled by Maker prior to review
        );
    END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 2. USER ROLES FOUNDATION TABLE
-- ----------------------------------------------------------------------------
-- Maps application users to organization-scoped roles (SUPER_ADMIN, ADMIN, EMPLOYEE).
-- Uses declarative composite foreign keys to guarantee user belongs to organization.
CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL,
    role user_role_enum NOT NULL,
    assigned_by UUID,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Declarative Composite Foreign Keys: Enforce Tenant Relational Boundaries
    CONSTRAINT fk_user_roles_org_user 
        FOREIGN KEY (organization_id, user_id) 
        REFERENCES users(organization_id, id) 
        ON DELETE CASCADE,

    CONSTRAINT fk_user_roles_org_assigned_by 
        FOREIGN KEY (organization_id, assigned_by) 
        REFERENCES users(organization_id, id) 
        ON DELETE SET NULL (assigned_by),

    -- Role Uniqueness per User within Tenant
    CONSTRAINT uq_user_roles_org_user_role 
        UNIQUE (organization_id, user_id, role)
);

COMMENT ON TABLE user_roles IS 'Organization-scoped user role assignments. Fundamental building block for RBAC.';
COMMENT ON CONSTRAINT fk_user_roles_org_user ON user_roles IS 'Composite foreign key guaranteeing user and role share identical organization_id.';
COMMENT ON CONSTRAINT fk_user_roles_org_assigned_by ON user_roles IS 'Composite foreign key ensuring assigned_by belongs to identical tenant. Uses PostgreSQL 15+ column-specific ON DELETE SET NULL (assigned_by) so that if assigning user is deleted, only assigned_by is nulled while mandatory organization_id ownership is preserved.';

-- Indexes (Idempotent / Repeatable)
CREATE INDEX IF NOT EXISTS idx_user_roles_org_id ON user_roles (organization_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_lookup ON user_roles (organization_id, user_id, role);

-- ----------------------------------------------------------------------------
-- 3. ROLE AUTHORIZATION HELPER FUNCTIONS
-- ----------------------------------------------------------------------------

-- Helper function: checks if authenticated session user possesses ADMIN or SUPER_ADMIN in current_org_id
CREATE OR REPLACE FUNCTION is_admin_or_super()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth_user_id()
          AND ur.organization_id = current_org_id()
          AND ur.role IN ('SUPER_ADMIN', 'ADMIN')
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY INVOKER;

COMMENT ON FUNCTION is_admin_or_super() IS 'Evaluates whether auth_user_id() holds ADMIN or SUPER_ADMIN role within current_org_id(). Returns FALSE if unset.';

-- Helper function: checks if authenticated session user possesses SUPER_ADMIN in current_org_id
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth_user_id()
          AND ur.organization_id = current_org_id()
          AND ur.role = 'SUPER_ADMIN'
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY INVOKER;

COMMENT ON FUNCTION is_super_admin() IS 'Evaluates whether auth_user_id() holds SUPER_ADMIN role within current_org_id(). Returns FALSE if unset.';

-- ----------------------------------------------------------------------------
-- 4. ACCOUNT PROVISIONING REQUESTS TABLE (MAKER-CHECKER WORKFLOW)
-- ----------------------------------------------------------------------------
-- Durable, auditable queue for employee/user onboarding requests under DEC-09.
-- Enforces Maker-Checker separation at the database engine constraint layer:
--   - Maker (requested_by) submits the request.
--   - Checker (reviewed_by) approves or rejects the request.
--   - Maker CANNOT be Checker: CHECK (reviewed_by IS NULL OR reviewed_by != requested_by).
CREATE TABLE account_provisioning_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    idempotency_key VARCHAR(100) NOT NULL,
    phone_number VARCHAR(15) NOT NULL,
    requested_roles user_role_enum[] NOT NULL DEFAULT ARRAY['EMPLOYEE'::user_role_enum],
    status provisioning_status_enum NOT NULL DEFAULT 'SUBMITTED',

    -- Maker (Requester) Metadata
    requested_by UUID NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    request_notes TEXT,

    -- Checker (Approver/Reviewer) Metadata
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    review_decision VARCHAR(20),
    rejection_reason TEXT,
    review_notes TEXT,

    -- Distributed Execution & Reconciliation Linkages
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    error_message TEXT,

    -- Audit Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Declarative Relational & Tenant Constraints
    CONSTRAINT fk_prov_org 
        FOREIGN KEY (organization_id) 
        REFERENCES organizations(id) 
        ON DELETE RESTRICT,

    CONSTRAINT fk_prov_org_requested_by 
        FOREIGN KEY (organization_id, requested_by) 
        REFERENCES users(organization_id, id) 
        ON DELETE RESTRICT,

    CONSTRAINT fk_prov_org_reviewed_by 
        FOREIGN KEY (organization_id, reviewed_by) 
        REFERENCES users(organization_id, id) 
        ON DELETE RESTRICT,

    -- Candidate key exported for child event composite foreign keys
    CONSTRAINT uq_prov_org_id 
        UNIQUE (organization_id, id),

    -- Idempotency key uniqueness scoped to tenant
    CONSTRAINT uq_prov_org_idempotency 
        UNIQUE (organization_id, idempotency_key),

    -- Format validations
    CONSTRAINT chk_prov_phone_format 
        CHECK (phone_number ~ '^\+?[0-9]{10,15}$'),

    -- MAKER-CHECKER SEPARATION INVARIANT (Database Enforced)
    -- A requester cannot review/approve their own provisioning request!
    CONSTRAINT chk_prov_maker_checker_distinct 
        CHECK (reviewed_by IS NULL OR reviewed_by != requested_by),

    -- Review Completeness: reviewed_by and reviewed_at must exist if and only if reviewed
    CONSTRAINT chk_prov_review_completeness 
        CHECK (
            (status IN ('SUBMITTED', 'CANCELLED') AND reviewed_by IS NULL AND reviewed_at IS NULL)
            OR
            (status IN ('APPROVED', 'REJECTED', 'PROCESSING', 'COMPLETED', 'FAILED') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
        ),

    -- Rejection Reason Invariant: Rejection requires a non-empty reason
    CONSTRAINT chk_prov_rejection_reason 
        CHECK (
            (status != 'REJECTED')
            OR
            (status = 'REJECTED' AND rejection_reason IS NOT NULL AND trim(rejection_reason) != '')
        )
);

COMMENT ON TABLE account_provisioning_requests IS 'Administrative account provisioning queue with database-enforced Maker-Checker approval workflow.';
COMMENT ON CONSTRAINT chk_prov_maker_checker_distinct ON account_provisioning_requests IS 'Strict separation of duties: Maker (requested_by) cannot act as Checker (reviewed_by).';

-- Indexes (Idempotent / Repeatable)
CREATE INDEX IF NOT EXISTS idx_prov_org_status ON account_provisioning_requests (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_prov_locked_until ON account_provisioning_requests (status, locked_until) WHERE status IN ('SUBMITTED', 'APPROVED', 'PROCESSING');

-- Trigger: auto-update updated_at timestamp (Repeatable)
DROP TRIGGER IF EXISTS trg_prov_updated_at ON account_provisioning_requests;
CREATE TRIGGER trg_prov_updated_at
    BEFORE UPDATE ON account_provisioning_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 5. IMMUTABLE PROVISIONING EVENT AUDIT LEDGER
-- ----------------------------------------------------------------------------
-- Append-only audit sink recording every state transition, decision, and action
-- taken on an account provisioning request.
CREATE TABLE account_provisioning_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    request_id UUID NOT NULL,
    actor_user_id UUID NOT NULL,
    from_status provisioning_status_enum,
    to_status provisioning_status_enum NOT NULL,
    action VARCHAR(50) NOT NULL,
    reason TEXT,
    notes TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Declarative Composite Foreign Keys: Enforce Tenant Relational Boundaries
    CONSTRAINT fk_prov_event_org_req 
        FOREIGN KEY (organization_id, request_id) 
        REFERENCES account_provisioning_requests(organization_id, id) 
        ON DELETE RESTRICT,

    CONSTRAINT fk_prov_event_org_actor 
        FOREIGN KEY (organization_id, actor_user_id) 
        REFERENCES users(organization_id, id) 
        ON DELETE RESTRICT
);

COMMENT ON TABLE account_provisioning_events IS 'Immutable, append-only audit ledger recording every decision and action in the account provisioning lifecycle.';
COMMENT ON CONSTRAINT fk_prov_event_org_req ON account_provisioning_events IS 'Composite foreign key guaranteeing audit events are bound to parent request and tenant. Enforces ON DELETE RESTRICT to physically prevent deletion of provisioning requests that have audit history.';
COMMENT ON CONSTRAINT fk_prov_event_org_actor ON account_provisioning_events IS 'Composite foreign key ensuring actor belongs to identical tenant. Enforces ON DELETE RESTRICT to prevent deletion of users whose actions are recorded in the audit trail.';

-- Indexes (Idempotent / Repeatable)
CREATE INDEX IF NOT EXISTS idx_prov_events_org_req ON account_provisioning_events (organization_id, request_id);
CREATE INDEX IF NOT EXISTS idx_prov_events_created ON account_provisioning_events (organization_id, created_at);

-- Trigger: physically prevent UPDATE or DELETE on audit ledger (Append-Only Enforcement)
CREATE OR REPLACE FUNCTION trg_prevent_provisioning_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'account_provisioning_events records are append-only and strictly immutable'
        USING ERRCODE = '23505';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_no_update_delete_prov_events ON account_provisioning_events;
CREATE TRIGGER trg_no_update_delete_prov_events
    BEFORE UPDATE OR DELETE ON account_provisioning_events
    FOR EACH ROW
    EXECUTE FUNCTION trg_prevent_provisioning_event_mutation();

-- ----------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY (RLS) ACTIVATION & POLICIES
-- ----------------------------------------------------------------------------
-- Enable RLS
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_provisioning_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_provisioning_events ENABLE ROW LEVEL SECURITY;

-- FORCE Row Level Security
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE account_provisioning_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE account_provisioning_events FORCE ROW LEVEL SECURITY;

-- Policies: Horizontal Tenant Isolation
DROP POLICY IF EXISTS rls_user_roles_select ON user_roles;
CREATE POLICY rls_user_roles_select ON user_roles
    FOR SELECT
    USING (organization_id = current_org_id());

DROP POLICY IF EXISTS rls_prov_requests_select ON account_provisioning_requests;
CREATE POLICY rls_prov_requests_select ON account_provisioning_requests
    FOR SELECT
    USING (organization_id = current_org_id());

DROP POLICY IF EXISTS rls_prov_events_select ON account_provisioning_events;
CREATE POLICY rls_prov_events_select ON account_provisioning_events
    FOR SELECT
    USING (organization_id = current_org_id());

-- ----------------------------------------------------------------------------
-- 7. RUNTIME PRIVILEGES (LEAST PRIVILEGE: hrms_app_user)
-- ----------------------------------------------------------------------------
-- AUTHORIZATION BOUNDARY NOTICE:
-- To prevent ordinary tenant users from acting as administrators:
-- - Privileged mutation operations (INSERT, UPDATE on user_roles; direct mutation of requests/events)
--   are strictly KEPT UNAVAILABLE to hrms_app_user.
-- - Only read access (SELECT) is granted to hrms_app_user for runtime tenant queries.
-- - Role assignment and maker-checker approval workflows will be mediated by authorized Express
--   broker procedures / administrative services checking is_admin_or_super() or verified JWT roles.

-- Read-only grants to runtime connection role
GRANT SELECT ON user_roles TO hrms_app_user;
GRANT SELECT ON account_provisioning_requests TO hrms_app_user;
GRANT SELECT ON account_provisioning_events TO hrms_app_user;

-- Execution grants on authorization helper functions
REVOKE EXECUTE ON FUNCTION is_admin_or_super() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_admin_or_super() TO hrms_app_user;

REVOKE EXECUTE ON FUNCTION is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_super_admin() TO hrms_app_user;

-- Explicitly revoke destructive mutation operations from runtime connection role
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON user_roles FROM hrms_app_user, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON account_provisioning_requests FROM hrms_app_user, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON account_provisioning_events FROM hrms_app_user, PUBLIC;
