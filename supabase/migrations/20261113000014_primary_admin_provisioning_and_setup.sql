-- =============================================================================
-- Migration 00014: Secure Primary KMACCS Admin Provisioning & Setup Architecture
-- =============================================================================
-- Purpose:
--   Provisions the authorized production Primary Administrator identity for KMACCS
--   (Organization Code: ORG001, Registered Mobile: +917816029162, Role: ADMIN)
--   with NO SMS dependency, NO temporary password invention, and NO phone OTP.
--   Provides a cryptographically secure, single-use setup mechanism through which
--   the Admin personally establishes their own password directly in Supabase Auth.
-- =============================================================================

-- 1. Helper function: Establish Primary Admin Password via Single-Use Setup Token
CREATE OR REPLACE FUNCTION hrms_internal.complete_primary_admin_setup(
    p_token_hash CHAR(64),
    p_phone TEXT,
    p_password TEXT
)
RETURNS TABLE (
    success BOOLEAN,
    user_id UUID,
    organization_id UUID,
    message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, hrms_internal, extensions
AS $$
DECLARE
    v_tok RECORD;
    v_user RECORD;
    v_password_hash TEXT;
    v_cleaned_phone TEXT;
BEGIN
    -- 1. Validate password strength (at least 8 chars)
    IF p_password IS NULL OR length(trim(p_password)) < 8 THEN
        RAISE EXCEPTION 'Password must be at least 8 characters in length' USING ERRCODE = '22023';
    END IF;

    -- 2. Clean and verify authorized phone number
    v_cleaned_phone := regexp_replace(p_phone, '[^0-9]', '', 'g');
    IF length(v_cleaned_phone) = 12 AND v_cleaned_phone LIKE '91%' THEN
        v_cleaned_phone := substring(v_cleaned_phone FROM 3);
    END IF;

    IF v_cleaned_phone != '7816029162' THEN
        RAISE EXCEPTION 'Phone number does not match authorized primary administrator' USING ERRCODE = '42501';
    END IF;

    -- 3. Find and lock active single-use setup token
    SELECT * INTO v_tok
    FROM public.account_activation_tokens
    WHERE token_hash = p_token_hash
      AND purpose = 'ACTIVATION'
      AND status = 'ACTIVE'
      AND used_at IS NULL
      AND expires_at > NOW()
    FOR UPDATE;

    IF v_tok IS NULL THEN
        RAISE EXCEPTION 'Setup token is invalid, expired, or has already been consumed' USING ERRCODE = '42501';
    END IF;

    -- 4. Verify account is authorized primary admin (+917816029162) with ADMIN role
    SELECT u.* INTO v_user
    FROM public.users u
    JOIN public.user_roles ur ON ur.user_id = u.id AND ur.organization_id = u.organization_id
    WHERE u.id = v_tok.user_id
      AND u.organization_id = v_tok.organization_id
      AND (u.phone_number = '+917816029162' OR u.phone_number = '7816029162')
      AND ur.role = 'ADMIN';

    IF v_user IS NULL THEN
        RAISE EXCEPTION 'Token is not bound to authorized primary administrator account' USING ERRCODE = '42501';
    END IF;

    -- 5. Compute standard bcrypt hash using pgcrypto gen_salt('bf', 10)
    v_password_hash := extensions.crypt(p_password, extensions.gen_salt('bf', 10));

    -- 6. Update auth.users encrypted_password in Supabase Auth
    UPDATE auth.users
    SET encrypted_password = v_password_hash,
        updated_at = NOW()
    WHERE id = v_user.id;

    -- 7. Mark single-use token as consumed
    UPDATE public.account_activation_tokens
    SET status = 'CONSUMED',
        used_at = NOW()
    WHERE id = v_tok.id;

    -- 8. Update public.users status
    UPDATE public.users
    SET must_change_password = FALSE,
        phone_verified_at = COALESCE(phone_verified_at, NOW()),
        activated_at = COALESCE(activated_at, NOW()),
        updated_at = NOW()
    WHERE id = v_user.id;

    -- 9. Write immutable audit log
    INSERT INTO public.audit_logs (
        organization_id, actor_user_id, actor_role, action, entity_type, entity_id, summary
    ) VALUES (
        v_user.organization_id, v_user.id, 'ADMIN', 'ADMIN_PASSWORD_ESTABLISHED', 'USER', v_user.id,
        'Primary Admin (+917816029162) personally established password via secure one-time setup token.'
    );

    RETURN QUERY SELECT TRUE, v_user.id, v_user.organization_id, 'Primary Admin password established successfully.'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION hrms_internal.complete_primary_admin_setup(CHAR(64), TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hrms_internal.complete_primary_admin_setup(CHAR(64), TEXT, TEXT) TO hrms_app_user, postgres;

-- 2. Helper function: Issue Single-Use Primary Admin Setup Token
CREATE OR REPLACE FUNCTION hrms_internal.issue_primary_admin_setup_token(p_raw_token TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, hrms_internal, extensions
AS $$
DECLARE
    v_admin_id UUID := 'a1000000-0000-4000-8000-000000000001'::uuid;
    v_org_id UUID;
    v_token_hash CHAR(64);
BEGIN
    SELECT organization_id INTO v_org_id
    FROM public.users
    WHERE id = v_admin_id;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'Primary admin user not found' USING ERRCODE = 'P0002';
    END IF;

    v_token_hash := encode(extensions.digest(p_raw_token, 'sha256'), 'hex');

    -- Invalidate any prior unused setup tokens for this user
    UPDATE public.account_activation_tokens
    SET status = 'INVALIDATED',
        invalidated_at = NOW(),
        invalidated_reason = 'SUPERSEDED'
    WHERE organization_id = v_org_id
      AND user_id = v_admin_id
      AND purpose = 'ACTIVATION'
      AND used_at IS NULL;

    -- Insert active single-use setup token
    INSERT INTO public.account_activation_tokens (
        id,
        organization_id,
        user_id,
        purpose,
        status,
        token_hash,
        created_by,
        expires_at
    ) VALUES (
        gen_random_uuid(),
        v_org_id,
        v_admin_id,
        'ACTIVATION',
        'ACTIVE',
        v_token_hash,
        v_admin_id,
        NOW() + INTERVAL '48 hours'
    );

    RETURN v_token_hash;
END;
$$;

REVOKE ALL ON FUNCTION hrms_internal.issue_primary_admin_setup_token(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hrms_internal.issue_primary_admin_setup_token(TEXT) TO hrms_app_user, postgres;

-- 3. Idempotently provision Primary Admin Identity
DO $$
DECLARE
    v_org_id UUID;
    v_admin_id UUID := 'a1000000-0000-4000-8000-000000000001'::uuid;
    v_synthetic_email TEXT;
    v_phone TEXT := '+917816029162';
BEGIN
    -- Verify KMACCS organization exists
    SELECT id INTO v_org_id
    FROM public.organizations
    WHERE organization_code = 'ORG001';

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'KMACCS organization ORG001 not found' USING ERRCODE = 'P0002';
    END IF;

    v_synthetic_email := 'uid-' || v_admin_id || '@org-' || v_org_id || '.auth.hrms.internal';

    -- Provision identity in auth.users if not already exists
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_admin_id OR email = v_synthetic_email OR phone = v_phone) THEN
        INSERT INTO auth.users (
            id,
            instance_id,
            aud,
            role,
            email,
            encrypted_password,
            email_confirmed_at,
            phone,
            phone_confirmed_at,
            raw_app_meta_data,
            raw_user_meta_data,
            is_sso_user,
            is_anonymous,
            created_at,
            updated_at
        ) VALUES (
            v_admin_id,
            '00000000-0000-0000-0000-000000000000'::uuid,
            'authenticated',
            'authenticated',
            v_synthetic_email,
            NULL, -- Password unestablished until owner completes personal setup
            NOW(),
            v_phone,
            NOW(),
            '{"provider": "email", "providers": ["email"]}'::jsonb,
            '{"role": "ADMIN", "organization_code": "ORG001", "phone_number": "+917816029162"}'::jsonb,
            FALSE,
            FALSE,
            NOW(),
            NOW()
        );

        INSERT INTO auth.identities (
            id,
            user_id,
            identity_data,
            provider,
            provider_id,
            created_at,
            updated_at
        ) VALUES (
            gen_random_uuid(),
            v_admin_id,
            jsonb_build_object('sub', v_admin_id::text, 'email', v_synthetic_email),
            'email',
            v_synthetic_email,
            NOW(),
            NOW()
        );
    END IF;

    -- Provision application user record in public.users
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_admin_id) THEN
        INSERT INTO public.users (
            id,
            organization_id,
            phone_number,
            synthetic_email,
            is_active,
            must_change_password,
            activated_at,
            phone_verified_at,
            created_at,
            updated_at
        ) VALUES (
            v_admin_id,
            v_org_id,
            v_phone,
            v_synthetic_email,
            TRUE,
            TRUE, -- Must establish personal password
            NOW(),
            NOW(),
            NOW(),
            NOW()
        );
    END IF;

    -- Assign strictly ADMIN role in public.user_roles
    IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_admin_id AND organization_id = v_org_id AND role = 'ADMIN') THEN
        INSERT INTO public.user_roles (
            id,
            organization_id,
            user_id,
            role,
            assigned_by,
            assigned_at
        ) VALUES (
            gen_random_uuid(),
            v_org_id,
            v_admin_id,
            'ADMIN',
            NULL,
            NOW()
        );
    END IF;

    -- Write audit log entry
    INSERT INTO public.audit_logs (
        organization_id, actor_role, action, entity_type, entity_id, summary
    ) VALUES (
        v_org_id, 'ADMIN', 'PRIMARY_ADMIN_PROVISIONED', 'USER', v_admin_id,
        'Primary production Admin identity for KMACCS (+917816029162) provisioned. Initial password unassigned pending owner setup.'
    );
END
$$;
