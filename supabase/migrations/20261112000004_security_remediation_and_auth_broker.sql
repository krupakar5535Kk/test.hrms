-- ============================================================================
-- HRMS PAYROLL 5535 — Migration 00004:
-- Security Advisor Remediation & Authentication Broker Schema / Functions
-- ============================================================================
-- Version:        20261112000004
-- Targets:
--   1. Move btree_gist extension out of public into extensions (0014 fix)
--   2. Remediate public.rls_auto_enable() & resolve_organization_by_code()
--      excessive anon/authenticated execute grants (0028 & 0029 fixes)
--      without disabling platform ensure_rls trigger
--   3. Fix mutable search_path on 00001/00003 public functions (0011 fix)
--   4. Create private hrms_internal schema, roles, auth broker tables,
--      cryptographic tx-context tables, and session/activation procedures
-- ============================================================================

-- 1. Move btree_gist into extensions schema & harden function search_paths
ALTER EXTENSION btree_gist SET SCHEMA extensions;

ALTER FUNCTION public.current_org_id() SET search_path = pg_catalog, public;
ALTER FUNCTION public.auth_user_id() SET search_path = pg_catalog, public;
ALTER FUNCTION public.update_updated_at_column() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_prevent_provisioning_event_mutation() SET search_path = pg_catalog, public;
ALTER FUNCTION public.is_admin_or_super() SET search_path = pg_catalog, public;
ALTER FUNCTION public.is_super_admin() SET search_path = pg_catalog, public;

-- Remediate 0028 & 0029 without breaking ensure_rls DDL event trigger
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable'
    ) THEN
        REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
    END IF;
END
$$;

-- Revoke Supabase default anon/authenticated grants on internal & broker helpers
REVOKE ALL ON FUNCTION public.resolve_organization_by_code(TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_organization_by_code(TEXT) TO hrms_app_user;

REVOKE ALL ON FUNCTION public.current_org_id() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_org_id() TO hrms_app_user;

REVOKE ALL ON FUNCTION public.auth_user_id() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_user_id() TO hrms_app_user;

REVOKE ALL ON FUNCTION public.is_admin_or_super() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin_or_super() TO hrms_app_user;

REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO hrms_app_user;

REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_prevent_provisioning_event_mutation() FROM PUBLIC, anon, authenticated;

-- 2. Private internal schema (not exposed to PostgREST)
CREATE SCHEMA IF NOT EXISTS hrms_internal;
REVOKE ALL ON SCHEMA hrms_internal FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA hrms_internal TO hrms_app_user;

-- Dedicated least-privilege NOLOGIN NOBYPASSRLS roles for broker isolation
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_context_verifier') THEN
        CREATE ROLE hrms_context_verifier WITH NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_session_manager') THEN
        CREATE ROLE hrms_session_manager WITH NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_auth_lookup_owner') THEN
        CREATE ROLE hrms_auth_lookup_owner WITH NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
END
$$;

GRANT hrms_context_verifier, hrms_session_manager, hrms_auth_lookup_owner TO postgres;

GRANT USAGE ON SCHEMA public TO hrms_context_verifier, hrms_session_manager, hrms_auth_lookup_owner;
GRANT USAGE ON SCHEMA extensions TO hrms_context_verifier, hrms_session_manager, hrms_auth_lookup_owner, hrms_app_user;
GRANT USAGE ON SCHEMA hrms_internal TO hrms_context_verifier, hrms_session_manager, hrms_auth_lookup_owner;

-- 3. Extend public.users & public.account_provisioning_requests (PO-01..PO-07)
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS synthetic_email VARCHAR(255),
    ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS activation_lock_state VARCHAR(30) NOT NULL DEFAULT 'NONE'
        CHECK (activation_lock_state IN ('NONE', 'IN_FLIGHT', 'QUARANTINED_MANUAL_RECOVERY')),
    ADD COLUMN IF NOT EXISTS activation_lock_op_id UUID,
    ADD COLUMN IF NOT EXISTS activation_lock_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS tokens_valid_after_epoch BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_users_synthetic_email'
    ) THEN
        ALTER TABLE public.users ADD CONSTRAINT uq_users_synthetic_email UNIQUE (synthetic_email);
    END IF;
END
$$;

ALTER TABLE public.account_provisioning_requests
    ADD COLUMN IF NOT EXISTS synthetic_email VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS uq_prov_active_phone
    ON public.account_provisioning_requests (organization_id, phone_number)
    WHERE status IN ('SUBMITTED', 'APPROVED', 'PROCESSING');

-- 4. Token / OTP / Session Tables
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'token_purpose_enum') THEN
        CREATE TYPE public.token_purpose_enum AS ENUM ('ACTIVATION', 'PASSWORD_RESET');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'token_status_enum') THEN
        CREATE TYPE public.token_status_enum AS ENUM ('ACTIVE', 'COMMITTING', 'CONSUMED', 'INVALIDATED');
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.account_activation_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL,
    purpose public.token_purpose_enum NOT NULL,
    status public.token_status_enum NOT NULL DEFAULT 'ACTIVE',
    token_hash CHAR(64) NOT NULL,
    created_by UUID NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    committing_op_id UUID,
    committing_started_at TIMESTAMPTZ,
    used_at TIMESTAMPTZ,
    invalidated_at TIMESTAMPTZ,
    invalidated_reason VARCHAR(50),
    failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_act_tokens_hash UNIQUE (token_hash),
    CONSTRAINT fk_act_tokens_org_user FOREIGN KEY (organization_id, user_id)
        REFERENCES public.users(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_act_tokens_org_creator FOREIGN KEY (organization_id, created_by)
        REFERENCES public.users(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_act_tokens_expiry CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_act_tokens_active_user_purpose
    ON public.account_activation_tokens (organization_id, user_id, purpose)
    WHERE used_at IS NULL AND invalidated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_act_tokens_cleanup ON public.account_activation_tokens (expires_at);

ALTER TABLE public.account_activation_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_activation_tokens FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_activation_tokens_tenant ON public.account_activation_tokens
    FOR SELECT
    USING (organization_id = public.current_org_id() AND public.is_admin_or_super());

REVOKE ALL ON public.account_activation_tokens FROM PUBLIC, anon, authenticated, service_role, hrms_app_user;

CREATE TABLE IF NOT EXISTS public.password_reset_otps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL,
    phone_number VARCHAR(15) NOT NULL CHECK (phone_number ~ '^\+91[6-9][0-9]{9}$'),
    otp_hmac CHAR(64) NOT NULL,
    purpose VARCHAR(30) NOT NULL DEFAULT 'PASSWORD_RESET_OTP'
        CHECK (purpose IN ('PASSWORD_RESET_OTP', 'ACTIVATION_OTP')),
    delivery_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (delivery_status IN ('PENDING', 'SENT', 'FAILED')),
    expires_at TIMESTAMPTZ NOT NULL,
    resend_available_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    sessions_revoked_at TIMESTAMPTZ,
    invalidated_at TIMESTAMPTZ,
    invalidated_reason VARCHAR(50),
    failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 3 AND 5),
    request_ip_hash CHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_pwd_reset_otp_org_user FOREIGN KEY (organization_id, user_id)
        REFERENCES public.users(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_pwd_reset_otp_expiry CHECK (
        expires_at > created_at AND expires_at <= created_at + INTERVAL '15 minutes'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pwd_reset_otp_active_user_purpose
    ON public.password_reset_otps (organization_id, user_id, purpose)
    WHERE used_at IS NULL AND invalidated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pwd_reset_otps_cleanup ON public.password_reset_otps (expires_at);
CREATE INDEX IF NOT EXISTS idx_pwd_reset_otps_org_user_recent ON public.password_reset_otps (organization_id, user_id, created_at DESC);

ALTER TABLE public.password_reset_otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_otps FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_password_reset_otps_deny_client ON public.password_reset_otps
    FOR SELECT
    USING (FALSE);

REVOKE ALL ON public.password_reset_otps FROM PUBLIC, anon, authenticated, service_role, hrms_app_user;

CREATE TABLE IF NOT EXISTS public.user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL,
    gotrue_session_id UUID NOT NULL UNIQUE,
    refresh_token_hmac CHAR(64) NOT NULL,
    prev_refresh_token_hmac CHAR(64),
    prev_rotated_at TIMESTAMPTZ,
    device_summary VARCHAR(200),
    approx_ip VARCHAR(64),
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoked_reason VARCHAR(50),
    revoked_by_user_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_user_sessions_org_user FOREIGN KEY (organization_id, user_id)
        REFERENCES public.users(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_user_sessions_org_revoker FOREIGN KEY (organization_id, revoked_by_user_id)
        REFERENCES public.users(organization_id, id) ON DELETE SET NULL (revoked_by_user_id),
    CONSTRAINT chk_user_sessions_expiry CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_active_user
    ON public.user_sessions (organization_id, user_id, last_activity_at DESC)
    WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_sessions_rt_hmac ON public.user_sessions (refresh_token_hmac);
CREATE INDEX IF NOT EXISTS idx_user_sessions_prev_rt_hmac
    ON public.user_sessions (prev_refresh_token_hmac)
    WHERE prev_refresh_token_hmac IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_sessions_cleanup ON public.user_sessions (expires_at);

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_user_sessions_tenant ON public.user_sessions
    FOR ALL
    USING (organization_id = public.current_org_id())
    WITH CHECK (organization_id = public.current_org_id());

CREATE POLICY rls_user_sessions_rt_hmac_lookup ON public.user_sessions
    FOR SELECT
    TO hrms_session_manager
    USING (
        NULLIF(pg_catalog.current_setting('app.session_rt_hmac_lookup', true), '') IS NOT NULL
        AND (
            refresh_token_hmac = pg_catalog.current_setting('app.session_rt_hmac_lookup', true)
            OR prev_refresh_token_hmac = pg_catalog.current_setting('app.session_rt_hmac_lookup', true)
        )
    );

REVOKE ALL ON public.user_sessions FROM PUBLIC, anon, authenticated, service_role, hrms_app_user;
GRANT SELECT, INSERT, UPDATE (
    refresh_token_hmac, prev_refresh_token_hmac, prev_rotated_at,
    last_activity_at, expires_at, revoked_at, revoked_reason, revoked_by_user_id
), DELETE ON public.user_sessions TO hrms_session_manager;

CREATE TABLE IF NOT EXISTS public.revoked_sessions (
    session_id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL,
    revoked_reason VARCHAR(50) NOT NULL,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,

    CONSTRAINT fk_revoked_sessions_org_user FOREIGN KEY (organization_id, user_id)
        REFERENCES public.users(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_revoked_sessions_user ON public.revoked_sessions (user_id, revoked_at DESC);
CREATE INDEX IF NOT EXISTS idx_revoked_sessions_expires_at ON public.revoked_sessions (expires_at);

ALTER TABLE public.revoked_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revoked_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_revoked_sessions_tenant ON public.revoked_sessions
    FOR ALL
    USING (organization_id = public.current_org_id())
    WITH CHECK (organization_id = public.current_org_id());

REVOKE ALL ON public.revoked_sessions FROM PUBLIC, anon, authenticated, service_role, hrms_app_user;
GRANT SELECT, INSERT, DELETE ON public.revoked_sessions TO hrms_session_manager;

-- 5. Cryptographic TX Context Verification Tables (hrms_internal)
CREATE TABLE IF NOT EXISTS hrms_internal.context_signing_keys (
    key_id VARCHAR(32) PRIMARY KEY CHECK (key_id ~ '^[a-z0-9_-]{3,32}$'),
    secret_key BYTEA NOT NULL CHECK (pg_catalog.octet_length(secret_key) = 32),
    status VARCHAR(20) NOT NULL CHECK (status IN ('ACTIVE', 'VERIFY_ONLY', 'REVOKED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rotated_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_ctx_signing_key
    ON hrms_internal.context_signing_keys (status)
    WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS hrms_internal.tx_context_challenges (
    challenge_nonce UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tx_xid TEXT NOT NULL CHECK (tx_xid ~ '^[0-9]{1,20}$'),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tx_context_challenges_cleanup ON hrms_internal.tx_context_challenges (expires_at);

REVOKE ALL ON hrms_internal.context_signing_keys, hrms_internal.tx_context_challenges
    FROM PUBLIC, anon, authenticated, service_role, hrms_app_user, hrms_session_manager, hrms_auth_lookup_owner;
GRANT SELECT ON hrms_internal.context_signing_keys TO hrms_context_verifier;
GRANT SELECT, INSERT, UPDATE, DELETE ON hrms_internal.tx_context_challenges TO hrms_context_verifier;

ALTER TABLE hrms_internal.context_signing_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms_internal.context_signing_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE hrms_internal.tx_context_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms_internal.tx_context_challenges FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_ctx_keys_verifier ON hrms_internal.context_signing_keys
    FOR SELECT TO hrms_context_verifier USING (TRUE);
CREATE POLICY rls_ctx_challenges_verifier ON hrms_internal.tx_context_challenges
    FOR ALL TO hrms_context_verifier USING (TRUE) WITH CHECK (TRUE);

-- Narrow column grants to hrms_session_manager
GRANT SELECT (id, organization_code, name, is_active) ON public.organizations TO hrms_session_manager;
GRANT SELECT (id, organization_id, is_active, activated_at, must_change_password, tokens_valid_after_epoch) ON public.users TO hrms_session_manager;
GRANT UPDATE (tokens_valid_after_epoch) ON public.users TO hrms_session_manager;
GRANT SELECT (user_id, organization_id, role) ON public.user_roles TO hrms_session_manager;
GRANT SELECT (id, organization_id, user_id, purpose, used_at, sessions_revoked_at) ON public.password_reset_otps TO hrms_session_manager;
GRANT UPDATE (sessions_revoked_at) ON public.password_reset_otps TO hrms_session_manager;

-- Pre-auth identity lookup functions (restricted SECURITY DEFINER; minimal projection)
CREATE OR REPLACE FUNCTION hrms_internal.resolve_login_identity(p_organization_id UUID, p_phone_number TEXT)
RETURNS TABLE (user_id UUID, synthetic_email VARCHAR(255))
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
    RETURN QUERY
    SELECT u.id, u.synthetic_email
    FROM public.users u
    JOIN public.organizations o ON o.id = u.organization_id
    WHERE u.organization_id = p_organization_id
      AND u.phone_number = p_phone_number
      AND o.is_active = TRUE
      AND u.is_active = TRUE
      AND u.activated_at IS NOT NULL
      AND u.synthetic_email IS NOT NULL
    LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION hrms_internal.resolve_recovery_identity(p_organization_id UUID, p_phone_number TEXT)
RETURNS TABLE (user_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
    RETURN QUERY
    SELECT u.id
    FROM public.users u
    JOIN public.organizations o ON o.id = u.organization_id
    WHERE u.organization_id = p_organization_id
      AND u.phone_number = p_phone_number
      AND o.is_active = TRUE
      AND u.is_active = TRUE
      AND u.activated_at IS NOT NULL
      AND u.phone_verified_at IS NOT NULL
    LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION hrms_internal.resolve_auth_user_tenant(p_auth_user_id UUID)
RETURNS TABLE (
    user_id UUID,
    organization_id UUID,
    org_is_active BOOLEAN,
    user_is_active BOOLEAN,
    is_activated BOOLEAN,
    must_change_password BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        u.id,
        u.organization_id,
        o.is_active,
        u.is_active,
        (u.activated_at IS NOT NULL),
        u.must_change_password
    FROM public.users u
    JOIN public.organizations o ON o.id = u.organization_id
    WHERE u.id = p_auth_user_id
    LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION hrms_internal.issue_tx_challenge()
RETURNS TABLE (tx_xid TEXT, challenge_nonce UUID)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, hrms_internal
AS $$
DECLARE
    v_xid TEXT := pg_catalog.pg_current_xact_id()::TEXT;
    v_nonce UUID;
BEGIN
    DELETE FROM hrms_internal.tx_context_challenges WHERE expires_at < NOW() - INTERVAL '5 minutes';

    INSERT INTO hrms_internal.tx_context_challenges (tx_xid, expires_at)
    VALUES (v_xid, NOW() + INTERVAL '15 seconds')
    RETURNING hrms_internal.tx_context_challenges.challenge_nonce INTO v_nonce;

    RETURN QUERY SELECT v_xid, v_nonce;
END;
$$;

CREATE OR REPLACE FUNCTION hrms_internal.assert_verified_tx_context(
    p_tx_proof TEXT,
    p_expected_op TEXT,
    p_expected_target_id TEXT
)
RETURNS TABLE (
    verified_org_id UUID,
    verified_actor_user_id UUID,
    verified_session_id UUID
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, hrms_internal, extensions
AS $$
DECLARE
    v_parts TEXT[];
    v_key_id TEXT;
    v_tx_xid TEXT;
    v_nonce UUID;
    v_org_id UUID;
    v_actor_id UUID;
    v_session_id UUID;
    v_op TEXT;
    v_target_id TEXT;
    v_exp_unix BIGINT;
    v_sig_hex TEXT;
    v_payload TEXT;
    v_secret BYTEA;
    v_calc_sig TEXT;
    v_diff INTEGER := 0;
    v_i INTEGER;
    v_consumed UUID;
BEGIN
    IF p_tx_proof IS NULL OR pg_catalog.length(p_tx_proof) > 512 THEN
        RAISE EXCEPTION 'Invalid transaction proof' USING ERRCODE = '42501';
    END IF;

    v_parts := pg_catalog.string_to_array(p_tx_proof, ':');
    IF pg_catalog.array_length(v_parts, 1) IS DISTINCT FROM 11 OR v_parts[1] <> 'v1' THEN
        RAISE EXCEPTION 'Malformed transaction proof envelope' USING ERRCODE = '42501';
    END IF;

    v_key_id := v_parts[2];
    v_tx_xid := v_parts[3];
    v_nonce := v_parts[4]::UUID;
    v_org_id := v_parts[5]::UUID;
    v_actor_id := v_parts[6]::UUID;
    v_session_id := v_parts[7]::UUID;
    v_op := v_parts[8];
    v_target_id := v_parts[9];
    v_exp_unix := v_parts[10]::BIGINT;
    v_sig_hex := v_parts[11];

    IF v_tx_xid IS DISTINCT FROM pg_catalog.pg_current_xact_id()::TEXT THEN
        RAISE EXCEPTION 'Transaction proof bound to different transaction xid' USING ERRCODE = '42501';
    END IF;

    IF v_op IS DISTINCT FROM p_expected_op OR v_target_id IS DISTINCT FROM p_expected_target_id THEN
        RAISE EXCEPTION 'Transaction proof op/target mismatch' USING ERRCODE = '42501';
    END IF;

    IF v_exp_unix < EXTRACT(EPOCH FROM NOW())::BIGINT OR v_exp_unix > EXTRACT(EPOCH FROM NOW())::BIGINT + 30 THEN
        RAISE EXCEPTION 'Transaction proof expired or invalid clock skew' USING ERRCODE = '42501';
    END IF;

    SELECT k.secret_key INTO v_secret
    FROM hrms_internal.context_signing_keys k
    WHERE k.key_id = v_key_id
      AND k.status IN ('ACTIVE', 'VERIFY_ONLY')
      AND (k.expires_at IS NULL OR k.expires_at > NOW());

    IF v_secret IS NULL THEN
        RAISE EXCEPTION 'Signing key unavailable' USING ERRCODE = '42501';
    END IF;

    v_payload := pg_catalog.concat_ws(':', v_parts[1], v_key_id, v_tx_xid, v_parts[4], v_parts[5], v_parts[6], v_parts[7], v_op, v_target_id, v_parts[10]);
    v_calc_sig := pg_catalog.encode(extensions.hmac(pg_catalog.convert_to(v_payload, 'UTF8'), v_secret, 'sha256'), 'hex');

    IF pg_catalog.length(v_sig_hex) <> pg_catalog.length(v_calc_sig) THEN
        RAISE EXCEPTION 'Invalid transaction proof signature length' USING ERRCODE = '42501';
    END IF;

    FOR v_i IN 1..pg_catalog.length(v_calc_sig) LOOP
        v_diff := v_diff | (pg_catalog.ascii(pg_catalog.substr(v_sig_hex, v_i, 1)) # pg_catalog.ascii(pg_catalog.substr(v_calc_sig, v_i, 1)));
    END LOOP;

    IF v_diff <> 0 THEN
        RAISE EXCEPTION 'Transaction proof signature verification failed' USING ERRCODE = '42501';
    END IF;

    UPDATE hrms_internal.tx_context_challenges c
    SET consumed_at = NOW()
    WHERE c.challenge_nonce = v_nonce
      AND c.tx_xid = v_tx_xid
      AND c.consumed_at IS NULL
      AND c.expires_at > NOW()
    RETURNING c.challenge_nonce INTO v_consumed;

    IF v_consumed IS NULL THEN
        RAISE EXCEPTION 'Transaction proof nonce invalid, expired, or replayed' USING ERRCODE = '42501';
    END IF;

    IF v_org_id <> '00000000-0000-0000-0000-000000000000'::UUID AND v_org_id IS DISTINCT FROM public.current_org_id() THEN
        RAISE EXCEPTION 'Transaction proof org mismatch with session GUC' USING ERRCODE = '42501';
    END IF;

    IF v_actor_id <> '00000000-0000-0000-0000-000000000000'::UUID AND v_actor_id IS DISTINCT FROM public.auth_user_id() THEN
        RAISE EXCEPTION 'Transaction proof actor mismatch with session GUC' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY SELECT v_org_id, v_actor_id, v_session_id;
END;
$$;

REVOKE ALL ON FUNCTION hrms_internal.resolve_login_identity(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION hrms_internal.resolve_login_identity(UUID, TEXT) TO hrms_app_user;

REVOKE ALL ON FUNCTION hrms_internal.resolve_recovery_identity(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION hrms_internal.resolve_recovery_identity(UUID, TEXT) TO hrms_app_user;

REVOKE ALL ON FUNCTION hrms_internal.resolve_auth_user_tenant(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION hrms_internal.resolve_auth_user_tenant(UUID) TO hrms_app_user;

REVOKE ALL ON FUNCTION hrms_internal.issue_tx_challenge() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION hrms_internal.issue_tx_challenge() TO hrms_app_user;

REVOKE ALL ON FUNCTION hrms_internal.assert_verified_tx_context(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role, hrms_app_user;
GRANT EXECUTE ON FUNCTION hrms_internal.assert_verified_tx_context(TEXT, TEXT, TEXT) TO hrms_session_manager;
