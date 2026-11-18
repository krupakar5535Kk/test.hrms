-- ============================================================================
-- TEST HARNESS FIXTURE: Supabase Auth Schema & Stub Table
-- ============================================================================
-- Target Environment: Local Standalone PostgreSQL Test Runners ONLY (CI / Docker)
-- WARNING: DO NOT APPLY TO HOSTED OR PRODUCTION SUPABASE ENVIRONMENTS.
--
-- Purpose:
-- In real Supabase environments, the 'auth' schema and 'auth.users' table are
-- provisioned and managed by Supabase GoTrue migrations.
-- When running integration test suites on a local standalone PostgreSQL instance
-- where Supabase GoTrue is not running, this fixture creates the prerequisite
-- 'auth.users' table required by the mandatory foreign key constraint:
--   public.users.id REFERENCES auth.users(id) ON DELETE CASCADE
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID,
    aud VARCHAR(255),
    role VARCHAR(255),
    email VARCHAR(255) UNIQUE,
    encrypted_password VARCHAR(255),
    email_confirmed_at TIMESTAMPTZ,
    invited_at TIMESTAMPTZ,
    confirmation_token VARCHAR(255),
    confirmation_sent_at TIMESTAMPTZ,
    recovery_token VARCHAR(255),
    recovery_sent_at TIMESTAMPTZ,
    email_change_token_new VARCHAR(255),
    email_change VARCHAR(255),
    email_change_sent_at TIMESTAMPTZ,
    last_sign_in_at TIMESTAMPTZ,
    raw_app_meta_data JSONB DEFAULT '{}'::jsonb,
    raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
    is_super_admin BOOLEAN,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    phone VARCHAR(15),
    phone_confirmed_at TIMESTAMPTZ,
    phone_change VARCHAR(15),
    phone_change_token VARCHAR(255),
    phone_change_sent_at TIMESTAMPTZ,
    confirmed_at TIMESTAMPTZ,
    email_change_token_current VARCHAR(255),
    email_change_confirm_status SMALLINT,
    banned_until TIMESTAMPTZ,
    reauthentication_token VARCHAR(255),
    reauthentication_sent_at TIMESTAMPTZ,
    is_sso_user BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMPTZ
);
