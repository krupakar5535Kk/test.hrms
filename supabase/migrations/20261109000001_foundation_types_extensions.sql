-- ============================================================================
-- HRMS SaaS Platform — Migration 00001: Foundation Types, Roles & Extensions
-- ============================================================================
-- Version:        20261109000001
-- Task ID:        HRMS-PHASE-B-TASK-1.2-FINAL-REVIEW
-- Scope:          Base Roles, Extensions, Foundational ENUMs & Session Context Helpers
-- Engine:         PostgreSQL 15+ (Supabase Production Architecture)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CRYPTOGRAPHIC & INDEX EXTENSIONS
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- ----------------------------------------------------------------------------
-- 2. DATABASE ROLES & SECURITY PRINCIPALS
-- ----------------------------------------------------------------------------
-- Schema Owner Role (Dedicated routine and object owner)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hrms_schema_owner') THEN
        CREATE ROLE hrms_schema_owner WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
END
$$;

-- Runtime Application Connection Role (Used exclusively by Express pool)
-- Strictly lacks BYPASSRLS, SUPERUSER, and DDL table mutation capabilities
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hrms_app_user') THEN
        CREATE ROLE hrms_app_user WITH LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 3. FOUNDATIONAL ENUM TYPES
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role_enum') THEN
        CREATE TYPE user_role_enum AS ENUM ('SUPER_ADMIN', 'ADMIN', 'EMPLOYEE');
    END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 4. SESSION CONTEXT & UTILITY FUNCTIONS
-- ----------------------------------------------------------------------------

-- Helper function: get transaction-local organization ID set by Express middleware
-- SECURITY & THREAT MODEL NOTICE:
-- 1. Custom PostgreSQL GUC parameters (such as app.current_org_id) are NOT
--    cryptographically signed or tamper-proof at the database engine layer.
-- 2. Any database session connected as hrms_app_user possesses the PostgreSQL
--    privilege to execute 'SET app.current_org_id = <arbitrary-uuid>'.
-- 3. Parameterized queries in application code prevent SQL injection, but do NOT
--    eliminate the database-level threat if connection context is compromised or leaked.
-- 4. True cryptographic isolation requires integration with verified Supabase Auth
--    JWT claims (auth.jwt() ->> 'organization_id'), which is an open security dependency
--    slated for the Authentication Broker (Task 2.1).
-- This function is STABLE and executes with SECURITY INVOKER.
CREATE OR REPLACE FUNCTION current_org_id() 
RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_org_id', true), '')::UUID;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY INVOKER;

COMMENT ON FUNCTION current_org_id() IS 'Retrieves the transaction-local authenticated organization UUID established by backend connection middleware (app.current_org_id). Returns NULL if unset or invalid. Note: GUC is not cryptographically trusted at the DB engine layer.';

-- Helper function: get transaction-local authenticated user ID
CREATE OR REPLACE FUNCTION auth_user_id() 
RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_user_id', true), '')::UUID;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY INVOKER;

COMMENT ON FUNCTION auth_user_id() IS 'Retrieves the transaction-local authenticated user UUID established by backend connection middleware (app.current_user_id). Returns NULL if unset or invalid.';

-- Trigger function: auto-update updated_at timestamp on row mutation
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_updated_at_column() IS 'Trigger function to automatically update the updated_at timestamp on row mutation.';

-- ----------------------------------------------------------------------------
-- 5. INITIAL ROLE PERMISSIONS (LEAST PRIVILEGE)
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO hrms_app_user;

-- Revoke default public execution; grant explicitly to application role
REVOKE EXECUTE ON FUNCTION current_org_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_org_id() TO hrms_app_user;

REVOKE EXECUTE ON FUNCTION auth_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_user_id() TO hrms_app_user;
