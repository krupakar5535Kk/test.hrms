-- ============================================================================
-- HRMS SaaS Platform — Migration 00002: Organizations & Tenant Users Foundation
-- ============================================================================
-- Version:        20261109000002
-- Task ID:        HRMS-PHASE-B-TASK-1.2-FINAL-REVIEW
-- Scope:          Organizations Master, Pre-Auth Tenant Lookup, Users Master,
--                 Row-Level Security (RLS) Isolation & Least-Privilege Grants
-- Engine:         PostgreSQL 15+ (Supabase Production Architecture)
-- Prerequisite:   Supabase Auth schema ('auth.users') must exist.
--                 (For local test harnesses, run 00_auth_test_stub.sql fixture first)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ORGANIZATIONS MASTER TABLE (ROOT TENANT ENTITY)
-- ----------------------------------------------------------------------------
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_code VARCHAR(20) NOT NULL,
    name VARCHAR(255) NOT NULL,
    legal_name VARCHAR(255) NOT NULL,
    registration_number VARCHAR(100),
    contact_phone VARCHAR(20) NOT NULL,
    contact_email VARCHAR(255) NOT NULL,
    address TEXT NOT NULL,
    logo_url TEXT,
    -- DEC-14: Configurable daily attendance selfie retention ceiling (1-30 calendar days).
    -- DEC-14 establishes a permissible range of 1-30 days, but does NOT approve an automatic default.
    -- Explicit configuration is mandatory upon organization creation; zero unapproved default.
    selfie_retention_days INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT uq_organizations_code UNIQUE (organization_code),
    CONSTRAINT chk_organizations_code_format CHECK (organization_code ~ '^[A-Za-z0-9_-]{2,20}$'),
    CONSTRAINT chk_organizations_selfie_retention_days CHECK (selfie_retention_days BETWEEN 1 AND 30)
);

COMMENT ON TABLE organizations IS 'Master tenant entity representing client corporate organizations. Root anchor for all tenant isolation.';
COMMENT ON COLUMN organizations.organization_code IS 'DEC-13 tri-partite tenant anchor used in login requests. Normalized to uppercase in queries.';
COMMENT ON COLUMN organizations.selfie_retention_days IS 'DEC-14: Configurable daily attendance selfie retention ceiling (1-30 calendar days). Must be explicitly configured; zero unapproved default.';

-- Indexes (Idempotent / Repeatable)
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_code_upper ON organizations (UPPER(organization_code));
CREATE INDEX IF NOT EXISTS idx_organizations_is_active ON organizations (is_active);

-- Trigger: auto-update updated_at timestamp (Repeatable)
DROP TRIGGER IF EXISTS trg_organizations_updated_at ON organizations;
CREATE TRIGGER trg_organizations_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 2. PRE-AUTHENTICATION TENANT RESOLUTION HELPER
-- ----------------------------------------------------------------------------
-- Under DEC-13, login requests submit organizationCode + phoneNumber + password.
-- The Express backend must resolve the tenant internally before authentication.
--
-- SECURITY ARCHITECTURE & PRIVILEGE BOUNDARY:
-- 1. SECURITY DEFINER: Executes with the privileges of its creator and table owner (postgres).
-- 2. Interaction with RLS: organizations has ENABLE ROW LEVEL SECURITY, but is
--    EXCLUDED from FORCE ROW LEVEL SECURITY (Finding G6-G9 in A3.13.4). Because
--    the table owner owns the table and function, it can perform this pre-auth lookup
--    without app.current_org_id being set.
-- 3. Fixed search path: SET search_path = pg_catalog, public prevents search-path hijacking.
-- 4. Minimal projection: Only id, organization_code, name, is_active are returned.
--    Physical address, contact email, phone, and retention settings are NEVER exposed.
CREATE OR REPLACE FUNCTION resolve_organization_by_code(p_code TEXT)
RETURNS TABLE (
    id UUID,
    organization_code VARCHAR(20),
    name VARCHAR(255),
    is_active BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        o.id,
        o.organization_code,
        o.name,
        o.is_active
    FROM public.organizations o
    WHERE UPPER(o.organization_code) = UPPER(TRIM(p_code))
      AND o.is_active = TRUE
    LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public;

COMMENT ON FUNCTION resolve_organization_by_code(TEXT) IS 'Pre-authentication tenant lookup helper. Bypasses RLS in a restricted manner to resolve tenant UUID and verify active status for valid organization code. Exposes zero sensitive organization fields.';

-- ----------------------------------------------------------------------------
-- 3. APPLICATION USERS TABLE (MAPPING 1:1 TO AUTH.USERS)
-- ----------------------------------------------------------------------------
-- Under DEC-09, Supabase Auth GoTrue is the single authoritative credential store.
-- The application user ID MUST be the exact existing auth.users.id.
-- No independent UUID generation (DEFAULT gen_random_uuid()) is permitted.
-- Foreign key references real auth.users(id) unconditionally; fails if auth schema is absent.
CREATE TABLE users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    phone_number VARCHAR(15) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    -- Phone number must be unique within an organization, but can be reused across different organizations
    CONSTRAINT uq_users_org_phone UNIQUE (organization_id, phone_number),
    -- Candidate key for multi-parent composite foreign keys from child tables (user_roles, employees, audit_logs)
    CONSTRAINT uq_users_org_id UNIQUE (organization_id, id),
    CONSTRAINT chk_users_phone_format CHECK (phone_number ~ '^\+?[0-9]{10,15}$')
);

COMMENT ON TABLE users IS 'Application user identity table mapping 1:1 to auth.users.id. Bounded strictly to organization_id.';
COMMENT ON COLUMN users.id IS 'Primary key strictly supplied from auth.users.id (DEC-09 1:1 mapping; zero independent default UUID generation).';
COMMENT ON CONSTRAINT uq_users_org_phone ON users IS 'Ensures phone number uniqueness within a tenant, while allowing same phone across separate organizations.';
COMMENT ON CONSTRAINT uq_users_org_id ON users IS 'Candidate key (organization_id, id) exported for declarative composite foreign keys from child tables.';

-- Indexes (Idempotent / Repeatable)
CREATE INDEX IF NOT EXISTS idx_users_organization_id ON users (organization_id);
CREATE INDEX IF NOT EXISTS idx_users_phone_number ON users (phone_number);

-- Trigger: auto-update updated_at timestamp (Repeatable)
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY (RLS) ACTIVATION & POLICIES
-- ----------------------------------------------------------------------------
-- Enable RLS across tenant foundation tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- FORCE Row Level Security:
-- - users: FORCED. All roles (including table owner if not superuser/bypassrls) obey RLS.
-- - organizations: EXCLUDED from FORCE RLS (Finding G6-G9 in A3.13.4).
--   This allows resolve_organization_by_code() (SECURITY DEFINER owned by postgres / table owner)
--   to query tenant metadata before app.current_org_id is set.
--   hrms_app_user has NOBYPASSRLS and does not own organizations, so it is 100% subject to RLS.
ALTER TABLE users FORCE ROW LEVEL SECURITY;

-- Organizations Policies
-- 1. SELECT: Authenticated users can only read their own tenant organization
DROP POLICY IF EXISTS rls_organizations_select ON organizations;
CREATE POLICY rls_organizations_select ON organizations
    FOR SELECT
    USING (id = current_org_id());

-- Users Policies
-- 1. SELECT: Authenticated users can only read users within their own tenant organization
DROP POLICY IF EXISTS rls_users_select ON users;
CREATE POLICY rls_users_select ON users
    FOR SELECT
    USING (organization_id = current_org_id());

-- ----------------------------------------------------------------------------
-- 5. RUNTIME PRIVILEGES (LEAST PRIVILEGE: hrms_app_user)
-- ----------------------------------------------------------------------------
-- AUTHORIZATION BOUNDARY NOTICE:
-- RBAC (Role-Based Access Control) is NOT yet implemented in Task 1.2 (pending Task 1.3 user_roles).
-- To prevent ordinary tenant users from acting as administrators:
-- - Privileged mutation operations (UPDATE on organizations, INSERT/UPDATE on users)
--   are strictly KEPT UNAVAILABLE to hrms_app_user.
-- - Only read access (SELECT) is granted to hrms_app_user.
-- - Administrative onboarding and organization modification will be wired in Task 1.3
--   via dedicated provisioning queues/procedures and Task 2.1 Express RBAC middleware.

-- Table Grants (READ ONLY for runtime tenant queries)
GRANT SELECT ON organizations TO hrms_app_user;
GRANT SELECT ON users TO hrms_app_user;

-- Pre-Auth Function Execution: Granted explicitly to application role; revoked from PUBLIC
REVOKE EXECUTE ON FUNCTION resolve_organization_by_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_organization_by_code(TEXT) TO hrms_app_user;

-- Explicitly revoke all mutation operations from runtime application role
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON organizations FROM hrms_app_user, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON users FROM hrms_app_user, PUBLIC;
