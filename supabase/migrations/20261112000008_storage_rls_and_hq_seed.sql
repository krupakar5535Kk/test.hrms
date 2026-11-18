-- ============================================================================
-- HRMS PAYROLL 5535 — Migration 00008:
-- Auth & Provisioning Broker RPCs, Private Storage Buckets & RLS Policies,
-- and Official HQ Baseline Seed (ORG001 + Exact Coordinates)
-- ============================================================================
-- Version:        20261112000008
-- Non-destructive additive migration preserving 00001..00007.
-- Contains ZERO demo employees, ZERO fake attendance, ZERO fake payroll,
-- and ZERO hardcoded Admin credentials.
-- ============================================================================

-- 1. Allow org Admin to update safe organization policy settings
CREATE POLICY rls_organizations_admin_update ON public.organizations
    FOR UPDATE
    USING (id = public.current_org_id() AND public.is_admin_or_super())
    WITH CHECK (id = public.current_org_id() AND public.is_admin_or_super());

GRANT UPDATE (name, legal_name, contact_phone, contact_email, address, timezone, selfie_retention_days, planned_employee_count)
    ON public.organizations TO hrms_app_user;

-- 2. Secure Auth & Provisioning Broker RPCs (callable only by hrms_app_user)
CREATE OR REPLACE FUNCTION hrms_internal.create_user_session(
    p_org_id UUID,
    p_user_id UUID,
    p_gotrue_session_id UUID,
    p_refresh_token_hmac TEXT,
    p_device_summary TEXT,
    p_approx_ip TEXT,
    p_expires_at TIMESTAMPTZ
)
RETURNS TABLE (
    session_id UUID,
    role TEXT,
    must_change_password BOOLEAN,
    employee_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, hrms_internal
AS $$
DECLARE
    v_role TEXT;
    v_must_change BOOLEAN;
    v_emp_id UUID;
    v_session_id UUID;
BEGIN
    SELECT ur.role::TEXT INTO v_role
    FROM public.user_roles ur
    JOIN public.users u ON u.id = ur.user_id AND u.organization_id = ur.organization_id
    JOIN public.organizations o ON o.id = u.organization_id
    WHERE ur.organization_id = p_org_id
      AND ur.user_id = p_user_id
      AND o.is_active = TRUE
      AND u.is_active = TRUE
      AND u.activated_at IS NOT NULL
    ORDER BY CASE ur.role WHEN 'ADMIN' THEN 1 WHEN 'EMPLOYEE' THEN 2 ELSE 99 END
    LIMIT 1;

    IF v_role IS NULL OR v_role NOT IN ('ADMIN', 'EMPLOYEE') THEN
        RAISE EXCEPTION 'Account is not active, activated, or assigned a valid application role'
            USING ERRCODE = '42501';
    END IF;

    SELECT u.must_change_password INTO v_must_change
    FROM public.users u
    WHERE u.organization_id = p_org_id AND u.id = p_user_id;

    IF v_role = 'EMPLOYEE' THEN
        SELECT e.id INTO v_emp_id
        FROM public.employees e
        WHERE e.organization_id = p_org_id AND e.user_id = p_user_id
        LIMIT 1;
    ELSE
        v_emp_id := NULL;
    END IF;

    INSERT INTO public.user_sessions (
        organization_id, user_id, gotrue_session_id, refresh_token_hmac,
        device_summary, approx_ip, expires_at
    ) VALUES (
        p_org_id, p_user_id, p_gotrue_session_id, p_refresh_token_hmac,
        pg_catalog.left(COALESCE(p_device_summary, 'Web Client'), 200),
        pg_catalog.left(COALESCE(p_approx_ip, 'unknown'), 64),
        p_expires_at
    )
    ON CONFLICT (gotrue_session_id) DO UPDATE
        SET refresh_token_hmac = EXCLUDED.refresh_token_hmac,
            last_activity_at = NOW(),
            expires_at = EXCLUDED.expires_at,
            revoked_at = NULL,
            revoked_reason = NULL
    RETURNING id INTO v_session_id;

    UPDATE public.users
    SET last_login_at = NOW()
    WHERE organization_id = p_org_id AND id = p_user_id;

    RETURN QUERY SELECT v_session_id, v_role, COALESCE(v_must_change, FALSE), v_emp_id;
END;
$$;

CREATE OR REPLACE FUNCTION hrms_internal.rotate_user_session(
    p_lookup_hmac TEXT,
    p_new_hmac TEXT,
    p_new_expires_at TIMESTAMPTZ,
    p_approx_ip TEXT
)
RETURNS TABLE (
    status TEXT,
    session_id UUID,
    organization_id UUID,
    user_id UUID,
    gotrue_session_id UUID,
    role TEXT,
    synthetic_email VARCHAR(255)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, hrms_internal
AS $$
DECLARE
    v_sess RECORD;
    v_role TEXT;
    v_email VARCHAR(255);
BEGIN
    SELECT s.* INTO v_sess
    FROM public.user_sessions s
    WHERE s.refresh_token_hmac = p_lookup_hmac
       OR s.prev_refresh_token_hmac = p_lookup_hmac
    FOR UPDATE;

    IF v_sess IS NULL THEN
        RETURN QUERY SELECT 'NOT_FOUND'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::VARCHAR(255);
        RETURN;
    END IF;

    IF v_sess.revoked_at IS NOT NULL OR v_sess.expires_at <= NOW() THEN
        RETURN QUERY SELECT 'REVOKED_OR_EXPIRED'::TEXT, v_sess.id, v_sess.organization_id, v_sess.user_id, v_sess.gotrue_session_id, NULL::TEXT, NULL::VARCHAR(255);
        RETURN;
    END IF;

    -- Refresh token reuse detection (token already rotated previously)
    IF v_sess.prev_refresh_token_hmac = p_lookup_hmac THEN
        UPDATE public.user_sessions
        SET revoked_at = NOW(), revoked_reason = 'REFRESH_TOKEN_REUSE'
        WHERE id = v_sess.id AND revoked_at IS NULL;

        INSERT INTO public.revoked_sessions (session_id, organization_id, user_id, revoked_reason, expires_at)
        VALUES (v_sess.gotrue_session_id, v_sess.organization_id, v_sess.user_id, 'REFRESH_TOKEN_REUSE', v_sess.expires_at)
        ON CONFLICT (session_id) DO NOTHING;

        RETURN QUERY SELECT 'REUSE_DETECTED'::TEXT, v_sess.id, v_sess.organization_id, v_sess.user_id, v_sess.gotrue_session_id, NULL::TEXT, NULL::VARCHAR(255);
        RETURN;
    END IF;

    SELECT ur.role::TEXT, u.synthetic_email
    INTO v_role, v_email
    FROM public.user_roles ur
    JOIN public.users u ON u.id = ur.user_id AND u.organization_id = ur.organization_id
    JOIN public.organizations o ON o.id = u.organization_id
    WHERE ur.organization_id = v_sess.organization_id
      AND ur.user_id = v_sess.user_id
      AND o.is_active = TRUE
      AND u.is_active = TRUE
      AND u.activated_at IS NOT NULL
    ORDER BY CASE ur.role WHEN 'ADMIN' THEN 1 WHEN 'EMPLOYEE' THEN 2 ELSE 99 END
    LIMIT 1;

    IF v_role IS NULL OR v_role NOT IN ('ADMIN', 'EMPLOYEE') THEN
        RETURN QUERY SELECT 'ACCOUNT_DISABLED'::TEXT, v_sess.id, v_sess.organization_id, v_sess.user_id, v_sess.gotrue_session_id, NULL::TEXT, NULL::VARCHAR(255);
        RETURN;
    END IF;

    UPDATE public.user_sessions
    SET prev_refresh_token_hmac = v_sess.refresh_token_hmac,
        refresh_token_hmac = p_new_hmac,
        prev_rotated_at = NOW(),
        last_activity_at = NOW(),
        expires_at = p_new_expires_at,
        approx_ip = pg_catalog.left(COALESCE(p_approx_ip, v_sess.approx_ip), 64)
    WHERE id = v_sess.id;

    RETURN QUERY SELECT 'OK'::TEXT, v_sess.id, v_sess.organization_id, v_sess.user_id, v_sess.gotrue_session_id, v_role, v_email;
END;
$$;

CREATE OR REPLACE FUNCTION hrms_internal.check_session_state(
    p_org_id UUID,
    p_user_id UUID,
    p_gotrue_session_id UUID DEFAULT NULL
)
RETURNS TABLE (
    active BOOLEAN,
    role TEXT,
    org_is_active BOOLEAN,
    user_is_active BOOLEAN,
    is_activated BOOLEAN,
    must_change_password BOOLEAN,
    revoked_reason VARCHAR(50),
    session_id UUID,
    employee_id UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, hrms_internal
AS $$
DECLARE
    v_role TEXT;
    v_org_active BOOLEAN := FALSE;
    v_user_active BOOLEAN := FALSE;
    v_activated BOOLEAN := FALSE;
    v_must_change BOOLEAN := FALSE;
    v_revoked_reason VARCHAR(50) := NULL;
    v_session_id UUID := NULL;
    v_session_revoked BOOLEAN := FALSE;
    v_emp_id UUID := NULL;
BEGIN
    SELECT o.is_active, u.is_active, (u.activated_at IS NOT NULL), u.must_change_password
    INTO v_org_active, v_user_active, v_activated, v_must_change
    FROM public.users u
    JOIN public.organizations o ON o.id = u.organization_id
    WHERE u.organization_id = p_org_id AND u.id = p_user_id;

    SELECT ur.role::TEXT INTO v_role
    FROM public.user_roles ur
    WHERE ur.organization_id = p_org_id AND ur.user_id = p_user_id
    ORDER BY CASE ur.role WHEN 'ADMIN' THEN 1 WHEN 'EMPLOYEE' THEN 2 ELSE 99 END
    LIMIT 1;

    IF p_gotrue_session_id IS NOT NULL THEN
        SELECT s.id, (s.revoked_at IS NOT NULL OR s.expires_at <= NOW()), s.revoked_reason
        INTO v_session_id, v_session_revoked, v_revoked_reason
        FROM public.user_sessions s
        WHERE s.organization_id = p_org_id
          AND s.user_id = p_user_id
          AND s.gotrue_session_id = p_gotrue_session_id
        LIMIT 1;

        IF v_revoked_reason IS NULL THEN
            SELECT rs.revoked_reason INTO v_revoked_reason
            FROM public.revoked_sessions rs
            WHERE rs.session_id = p_gotrue_session_id;
            IF v_revoked_reason IS NOT NULL THEN
                v_session_revoked := TRUE;
            END IF;
        END IF;
    END IF;

    IF v_role = 'EMPLOYEE' THEN
        SELECT e.id INTO v_emp_id
        FROM public.employees e
        WHERE e.organization_id = p_org_id AND e.user_id = p_user_id
        LIMIT 1;
    END IF;

    RETURN QUERY SELECT
        (COALESCE(v_org_active, FALSE)
         AND COALESCE(v_user_active, FALSE)
         AND COALESCE(v_activated, FALSE)
         AND v_role IN ('ADMIN', 'EMPLOYEE')
         AND NOT COALESCE(v_session_revoked, FALSE)),
        v_role,
        COALESCE(v_org_active, FALSE),
        COALESCE(v_user_active, FALSE),
        COALESCE(v_activated, FALSE),
        COALESCE(v_must_change, FALSE),
        v_revoked_reason,
        v_session_id,
        v_emp_id;
END;
$$;

CREATE OR REPLACE FUNCTION hrms_internal.revoke_user_session(
    p_org_id UUID,
    p_session_id UUID,
    p_actor_user_id UUID,
    p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, hrms_internal
AS $$
DECLARE
    v_sess RECORD;
BEGIN
    IF p_org_id IS DISTINCT FROM public.current_org_id() THEN
        RAISE EXCEPTION 'Cross-tenant session revocation denied' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_sess
    FROM public.user_sessions s
    WHERE s.organization_id = p_org_id AND s.id = p_session_id
    FOR UPDATE;

    IF v_sess IS NULL THEN
        RETURN FALSE;
    END IF;

    IF v_sess.user_id IS DISTINCT FROM public.auth_user_id() AND NOT public.is_admin_or_super() THEN
        RAISE EXCEPTION 'Cannot revoke another user session without Admin permission' USING ERRCODE = '42501';
    END IF;

    UPDATE public.user_sessions
    SET revoked_at = COALESCE(revoked_at, NOW()),
        revoked_reason = COALESCE(revoked_reason, pg_catalog.left(p_reason, 50)),
        revoked_by_user_id = p_actor_user_id
    WHERE id = v_sess.id;

    INSERT INTO public.revoked_sessions (session_id, organization_id, user_id, revoked_reason, expires_at)
    VALUES (v_sess.gotrue_session_id, p_org_id, v_sess.user_id, pg_catalog.left(p_reason, 50), v_sess.expires_at)
    ON CONFLICT (session_id) DO NOTHING;

    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION hrms_internal.revoke_all_user_sessions(
    p_org_id UUID,
    p_target_user_id UUID,
    p_actor_user_id UUID,
    p_reason TEXT,
    p_except_gotrue_session_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, hrms_internal
AS $$
DECLARE
    v_count INTEGER := 0;
    v_rec RECORD;
BEGIN
    IF p_org_id IS DISTINCT FROM public.current_org_id() THEN
        RAISE EXCEPTION 'Cross-tenant session revocation denied' USING ERRCODE = '42501';
    END IF;
    IF p_target_user_id IS DISTINCT FROM public.auth_user_id() AND NOT public.is_admin_or_super() THEN
        RAISE EXCEPTION 'Cannot revoke target user sessions without Admin permission' USING ERRCODE = '42501';
    END IF;

    FOR v_rec IN
        SELECT id, gotrue_session_id, expires_at
        FROM public.user_sessions
        WHERE organization_id = p_org_id
          AND user_id = p_target_user_id
          AND revoked_at IS NULL
          AND (p_except_gotrue_session_id IS NULL OR gotrue_session_id IS DISTINCT FROM p_except_gotrue_session_id)
        FOR UPDATE
    LOOP
        UPDATE public.user_sessions
        SET revoked_at = NOW(),
            revoked_reason = pg_catalog.left(p_reason, 50),
            revoked_by_user_id = p_actor_user_id
        WHERE id = v_rec.id;

        INSERT INTO public.revoked_sessions (session_id, organization_id, user_id, revoked_reason, expires_at)
        VALUES (v_rec.gotrue_session_id, p_org_id, p_target_user_id, pg_catalog.left(p_reason, 50), v_rec.expires_at)
        ON CONFLICT (session_id) DO NOTHING;

        v_count := v_count + 1;
    END LOOP;

    UPDATE public.users
    SET tokens_valid_after_epoch = EXTRACT(EPOCH FROM NOW())::BIGINT
    WHERE organization_id = p_org_id AND id = p_target_user_id;

    RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION hrms_internal.list_user_sessions(
    p_org_id UUID,
    p_target_user_id UUID
)
RETURNS TABLE (
    id UUID,
    device_summary VARCHAR(200),
    approx_ip VARCHAR(64),
    last_activity_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revoked_reason VARCHAR(50),
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, hrms_internal
AS $$
BEGIN
    IF p_org_id IS DISTINCT FROM public.current_org_id() THEN
        RAISE EXCEPTION 'Cross-tenant access denied' USING ERRCODE = '42501';
    END IF;
    IF p_target_user_id IS DISTINCT FROM public.auth_user_id() AND NOT public.is_admin_or_super() THEN
        RAISE EXCEPTION 'Cannot inspect another user sessions' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT s.id, s.device_summary, s.approx_ip, s.last_activity_at, s.expires_at,
           s.revoked_at, s.revoked_reason, s.created_at
    FROM public.user_sessions s
    WHERE s.organization_id = p_org_id
      AND s.user_id = p_target_user_id
    ORDER BY s.last_activity_at DESC
    LIMIT 25;
END;
$$;

CREATE OR REPLACE FUNCTION hrms_internal.admin_provision_employee_user(
    p_org_id UUID,
    p_user_id UUID,
    p_phone_number TEXT,
    p_synthetic_email TEXT,
    p_created_by UUID,
    p_must_change_password BOOLEAN DEFAULT TRUE,
    p_activate_immediately BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, hrms_internal
AS $$
BEGIN
    IF p_org_id IS DISTINCT FROM public.current_org_id() OR NOT public.is_admin_or_super() THEN
        RAISE EXCEPTION 'Only tenant Admin may provision employee accounts' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.users (
        id, organization_id, phone_number, synthetic_email,
        is_active, must_change_password, activated_at, phone_verified_at
    ) VALUES (
        p_user_id, p_org_id, p_phone_number, p_synthetic_email,
        TRUE, p_must_change_password,
        CASE WHEN p_activate_immediately THEN NOW() ELSE NULL END,
        CASE WHEN p_activate_immediately THEN NOW() ELSE NULL END
    );

    INSERT INTO public.user_roles (user_id, organization_id, role, assigned_by)
    VALUES (p_user_id, p_org_id, 'EMPLOYEE', p_created_by);

    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION hrms_internal.admin_set_user_activation(
    p_org_id UUID,
    p_target_user_id UUID,
    p_is_active BOOLEAN,
    p_mark_activated BOOLEAN,
    p_must_change_password BOOLEAN,
    p_actor_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, hrms_internal
AS $$
BEGIN
    IF p_org_id IS DISTINCT FROM public.current_org_id() OR NOT public.is_admin_or_super() THEN
        RAISE EXCEPTION 'Only tenant Admin may change account activation state' USING ERRCODE = '42501';
    END IF;
    IF p_target_user_id = p_actor_user_id AND NOT p_is_active THEN
        RAISE EXCEPTION 'Administrator cannot deactivate their own active account' USING ERRCODE = '23514';
    END IF;

    UPDATE public.users
    SET is_active = p_is_active,
        activated_at = CASE WHEN p_mark_activated THEN COALESCE(activated_at, NOW()) ELSE activated_at END,
        phone_verified_at = CASE WHEN p_mark_activated THEN COALESCE(phone_verified_at, NOW()) ELSE phone_verified_at END,
        must_change_password = COALESCE(p_must_change_password, must_change_password)
    WHERE organization_id = p_org_id AND id = p_target_user_id;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    IF NOT p_is_active THEN
        PERFORM hrms_internal.revoke_all_user_sessions(p_org_id, p_target_user_id, p_actor_user_id, 'ACCOUNT_DEACTIVATED', NULL);
    END IF;

    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION hrms_internal.admin_issue_activation_token(
    p_org_id UUID,
    p_user_id UUID,
    p_purpose TEXT,
    p_token_hash CHAR(64),
    p_created_by UUID,
    p_expires_at TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, hrms_internal
AS $$
DECLARE
    v_token_id UUID;
BEGIN
    IF p_org_id IS DISTINCT FROM public.current_org_id() OR NOT public.is_admin_or_super() THEN
        RAISE EXCEPTION 'Only tenant Admin may issue activation or reset tokens' USING ERRCODE = '42501';
    END IF;

    UPDATE public.account_activation_tokens
    SET status = 'INVALIDATED',
        invalidated_at = NOW(),
        invalidated_reason = 'SUPERSEDED'
    WHERE organization_id = p_org_id
      AND user_id = p_user_id
      AND purpose = p_purpose::public.token_purpose_enum
      AND used_at IS NULL
      AND invalidated_at IS NULL;

    INSERT INTO public.account_activation_tokens (
        organization_id, user_id, purpose, status, token_hash, created_by, expires_at
    ) VALUES (
        p_org_id, p_user_id, p_purpose::public.token_purpose_enum, 'ACTIVE', p_token_hash, p_created_by, p_expires_at
    )
    RETURNING id INTO v_token_id;

    RETURN v_token_id;
END;
$$;

CREATE OR REPLACE FUNCTION hrms_internal.consume_activation_token(
    p_token_hash CHAR(64)
)
RETURNS TABLE (
    token_id UUID,
    organization_id UUID,
    user_id UUID,
    purpose TEXT,
    synthetic_email VARCHAR(255),
    phone_number VARCHAR(15)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, hrms_internal
AS $$
DECLARE
    v_tok RECORD;
    v_email VARCHAR(255);
    v_phone VARCHAR(15);
BEGIN
    SELECT t.* INTO v_tok
    FROM public.account_activation_tokens t
    WHERE t.token_hash = p_token_hash
      AND t.used_at IS NULL
      AND t.invalidated_at IS NULL
      AND t.expires_at > NOW()
    FOR UPDATE;

    IF v_tok IS NULL THEN
        RETURN;
    END IF;

    UPDATE public.account_activation_tokens
    SET status = 'CONSUMED',
        used_at = NOW()
    WHERE id = v_tok.id;

    UPDATE public.users
    SET activated_at = COALESCE(activated_at, NOW()),
        phone_verified_at = COALESCE(phone_verified_at, NOW()),
        must_change_password = FALSE,
        is_active = TRUE
    WHERE organization_id = v_tok.organization_id AND id = v_tok.user_id
    RETURNING users.synthetic_email, users.phone_number INTO v_email, v_phone;

    RETURN QUERY SELECT v_tok.id, v_tok.organization_id, v_tok.user_id, v_tok.purpose::TEXT, v_email, v_phone;
END;
$$;

CREATE OR REPLACE FUNCTION hrms_internal.mark_password_changed(
    p_org_id UUID,
    p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, hrms_internal
AS $$
BEGIN
    IF p_org_id IS DISTINCT FROM public.current_org_id() THEN
        RAISE EXCEPTION 'Cross-tenant password update denied' USING ERRCODE = '42501';
    END IF;
    IF p_user_id IS DISTINCT FROM public.auth_user_id() AND NOT public.is_admin_or_super() THEN
        RAISE EXCEPTION 'Unauthorized password state update' USING ERRCODE = '42501';
    END IF;

    UPDATE public.users
    SET must_change_password = FALSE,
        tokens_valid_after_epoch = EXTRACT(EPOCH FROM NOW())::BIGINT
    WHERE organization_id = p_org_id AND id = p_user_id;

    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION hrms_internal.create_user_session(UUID,UUID,UUID,TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION hrms_internal.create_user_session(UUID,UUID,UUID,TEXT,TEXT,TEXT,TIMESTAMPTZ) TO hrms_app_user;

REVOKE ALL ON FUNCTION hrms_internal.rotate_user_session(TEXT,TEXT,TIMESTAMPTZ,TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION hrms_internal.rotate_user_session(TEXT,TEXT,TIMESTAMPTZ,TEXT) TO hrms_app_user;

REVOKE ALL ON FUNCTION hrms_internal.check_session_state(UUID,UUID,UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION hrms_internal.check_session_state(UUID,UUID,UUID) TO hrms_app_user;

REVOKE ALL ON FUNCTION hrms_internal.revoke_user_session(UUID,UUID,UUID,TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION hrms_internal.revoke_user_session(UUID,UUID,UUID,TEXT) TO hrms_app_user;

REVOKE ALL ON FUNCTION hrms_internal.revoke_all_user_sessions(UUID,UUID,UUID,TEXT,UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION hrms_internal.revoke_all_user_sessions(UUID,UUID,UUID,TEXT,UUID) TO hrms_app_user;

REVOKE ALL ON FUNCTION hrms_internal.list_user_sessions(UUID,UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION hrms_internal.list_user_sessions(UUID,UUID) TO hrms_app_user;

REVOKE ALL ON FUNCTION hrms_internal.admin_provision_employee_user(UUID,UUID,TEXT,TEXT,UUID,BOOLEAN,BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION hrms_internal.admin_provision_employee_user(UUID,UUID,TEXT,TEXT,UUID,BOOLEAN,BOOLEAN) TO hrms_app_user;

REVOKE ALL ON FUNCTION hrms_internal.admin_set_user_activation(UUID,UUID,BOOLEAN,BOOLEAN,BOOLEAN,UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION hrms_internal.admin_set_user_activation(UUID,UUID,BOOLEAN,BOOLEAN,BOOLEAN,UUID) TO hrms_app_user;

REVOKE ALL ON FUNCTION hrms_internal.admin_issue_activation_token(UUID,UUID,TEXT,CHAR,UUID,TIMESTAMPTZ) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION hrms_internal.admin_issue_activation_token(UUID,UUID,TEXT,CHAR,UUID,TIMESTAMPTZ) TO hrms_app_user;

REVOKE ALL ON FUNCTION hrms_internal.consume_activation_token(CHAR) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION hrms_internal.consume_activation_token(CHAR) TO hrms_app_user;

REVOKE ALL ON FUNCTION hrms_internal.mark_password_changed(UUID,UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION hrms_internal.mark_password_changed(UUID,UUID) TO hrms_app_user;

-- 3. Private Storage Buckets & Strict Path/Role RLS (ZERO public buckets)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
    ('attendance-selfies', 'attendance-selfies', FALSE, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
    ('face-enrollment', 'face-enrollment', FALSE, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
    ('visit-evidence', 'visit-evidence', FALSE, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
    ('hrms-documents', 'hrms-documents', FALSE, 10485760, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
    SET public = FALSE,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Path format: <organization_id>/<user_id>/<filename>
CREATE POLICY rls_storage_selfies_select ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id IN ('attendance-selfies', 'face-enrollment', 'visit-evidence')
        AND (
            (
                (storage.foldername(name))[2] = auth.uid()::TEXT
                AND EXISTS (
                    SELECT 1 FROM public.users u
                    WHERE u.id = auth.uid()
                      AND u.organization_id::TEXT = (storage.foldername(name))[1]
                      AND u.is_active = TRUE
                )
            )
            OR EXISTS (
                SELECT 1 FROM public.user_roles ur
                WHERE ur.user_id = auth.uid()
                  AND ur.organization_id::TEXT = (storage.foldername(name))[1]
                  AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
            )
        )
    );

CREATE POLICY rls_storage_selfies_insert ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id IN ('attendance-selfies', 'face-enrollment', 'visit-evidence')
        AND (storage.foldername(name))[2] = auth.uid()::TEXT
        AND EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = auth.uid()
              AND u.organization_id::TEXT = (storage.foldername(name))[1]
              AND u.is_active = TRUE
              AND u.activated_at IS NOT NULL
        )
    );

CREATE POLICY rls_storage_docs_select ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'hrms-documents'
        AND (
            (storage.foldername(name))[2] = auth.uid()::TEXT
            OR EXISTS (
                SELECT 1 FROM public.user_roles ur
                WHERE ur.user_id = auth.uid()
                  AND ur.organization_id::TEXT = (storage.foldername(name))[1]
                  AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
            )
        )
    );

CREATE POLICY rls_storage_docs_admin_insert ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'hrms-documents'
        AND EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.organization_id::TEXT = (storage.foldername(name))[1]
              AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
        )
    );

CREATE POLICY rls_storage_admin_delete ON storage.objects
    FOR DELETE TO authenticated
    USING (
        bucket_id IN ('attendance-selfies', 'face-enrollment', 'visit-evidence', 'hrms-documents')
        AND EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.organization_id::TEXT = (storage.foldername(name))[1]
              AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
        )
    );

-- 4. Approved Baseline Organizational Seed (Zero fake employees or credentials)
WITH org_upsert AS (
    INSERT INTO public.organizations (
        organization_code, name, legal_name, contact_phone, contact_email, address,
        timezone, selfie_retention_days, planned_employee_count, is_active
    ) VALUES (
        'ORG001',
        'HRMS Payroll 5535 Organization',
        'HRMS Payroll 5535 Enterprise Operations',
        'Pending Config',
        'admin-ops@org001.hrms.internal',
        'Official Registered Premises (17.31917323150614, 78.65081944376108)',
        'Asia/Kolkata',
        30,
        15,
        TRUE
    )
    ON CONFLICT (organization_code) DO UPDATE
        SET selfie_retention_days = 30,
            planned_employee_count = 15,
            is_active = TRUE
    RETURNING id
),
org_ref AS (
    SELECT id FROM org_upsert
    UNION ALL
    SELECT id FROM public.organizations WHERE organization_code = 'ORG001'
    LIMIT 1
)
INSERT INTO public.offices (
    organization_id, code, name, branch_name, address,
    latitude, longitude, geofence_radius_meters, max_gps_accuracy_meters, policy_version, is_primary, is_active
)
SELECT
    org_ref.id,
    'HQ',
    'Official Head Office',
    'Head Office (50m Geofence)',
    'Official Registered Premises (17.31917323150614, 78.65081944376108)',
    17.31917323150614::NUMERIC(18, 14),
    78.65081944376108::NUMERIC(18, 14),
    50,
    30,
    'v1.0',
    TRUE,
    TRUE
FROM org_ref
ON CONFLICT (organization_id, code) DO NOTHING;

-- Standard Departments
WITH org_ref AS (SELECT id FROM public.organizations WHERE organization_code = 'ORG001' LIMIT 1)
INSERT INTO public.departments (organization_id, code, name, description, allow_field_attendance, is_active)
SELECT org_ref.id, d.code, d.name, d.descr, d.allow_field, TRUE
FROM org_ref
CROSS JOIN (
    VALUES
        ('OFFICE',   'Office Operations',    'General office-based staff subject to 50m office geofence', FALSE),
        ('SALES',    'Sales',                'Field sales team eligible for outside-office attendance review and field duty', TRUE),
        ('RECOVERY', 'Recovery',             'Field recovery team eligible for outside-office attendance review and field duty', TRUE),
        ('HR',       'Human Resources',      'HR operations staff subject to 50m office geofence', FALSE),
        ('FINANCE',  'Finance & Accounts',   'Finance operations staff subject to 50m office geofence', FALSE)
) AS d(code, name, descr, allow_field)
ON CONFLICT (organization_id, code) DO NOTHING;

-- Standard Designations
WITH org_ref AS (SELECT id FROM public.organizations WHERE organization_code = 'ORG001' LIMIT 1)
INSERT INTO public.designations (organization_id, department_id, code, title, job_category, is_field_eligible, is_active)
SELECT
    org_ref.id,
    dep.id,
    ds.code,
    ds.title,
    ds.job_cat,
    ds.field_elig,
    TRUE
FROM org_ref
CROSS JOIN (
    VALUES
        ('OFFICE',   'OFF_EXEC',   'Office Executive',       'OFFICE',   FALSE),
        ('SALES',    'SALES_REP',  'Sales Representative',   'SALES',    TRUE),
        ('RECOVERY', 'REC_AGENT',  'Recovery Agent',         'RECOVERY', TRUE),
        ('HR',       'HR_EXEC',    'HR Executive',           'HR',       FALSE),
        ('FINANCE',  'FIN_EXEC',   'Finance Executive',      'FINANCE',  FALSE)
) AS ds(dept_code, code, title, job_cat, field_elig)
JOIN public.departments dep
  ON dep.organization_id = org_ref.id AND dep.code = ds.dept_code
ON CONFLICT (organization_id, code) DO NOTHING;

-- Approved Unpaid Leave Types (strictly CL, SL, PL, LWP)
WITH org_ref AS (SELECT id FROM public.organizations WHERE organization_code = 'ORG001' LIMIT 1)
INSERT INTO public.leave_types (organization_id, code, name, description, is_paid, payable_minutes_credit, has_quota, is_active)
SELECT org_ref.id, lt.code, lt.name, lt.descr, FALSE, 0, FALSE, TRUE
FROM org_ref
CROSS JOIN (
    VALUES
        ('CL',  'Casual Leave (CL)',        'Approved unpaid casual leave — zero payable hours under hourly payroll policy'),
        ('SL',  'Sick Leave (SL)',          'Approved unpaid sick leave — zero payable hours under hourly payroll policy'),
        ('PL',  'Privilege Leave (PL)',     'Approved unpaid privilege leave — zero payable hours under hourly payroll policy'),
        ('LWP', 'Leave Without Pay (LWP)',  'Unpaid leave without pay — zero payable hours under hourly payroll policy')
) AS lt(code, name, descr)
ON CONFLICT (organization_id, code) DO NOTHING;
