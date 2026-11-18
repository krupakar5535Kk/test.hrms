-- =============================================================================
-- Migration 00010: Fix PL/pgSQL OUT Variable Qualification in consume_activation_token
-- =============================================================================
-- Purpose:
--   In PL/pgSQL functions using RETURNS TABLE(..., organization_id, user_id, ...),
--   unqualified references to organization_id or user_id inside UPDATE statements
--   fail at runtime with SQLSTATE 42702 (column reference "organization_id" is ambiguous).
-- =============================================================================

CREATE OR REPLACE FUNCTION hrms_internal.consume_activation_token(p_token_hash character)
RETURNS TABLE(
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

    UPDATE public.account_activation_tokens AS tok
    SET status = 'CONSUMED',
        used_at = NOW()
    WHERE tok.id = v_tok.id;

    UPDATE public.users AS u
    SET activated_at = COALESCE(u.activated_at, NOW()),
        phone_verified_at = COALESCE(u.phone_verified_at, NOW()),
        must_change_password = FALSE,
        is_active = TRUE
    WHERE u.organization_id = v_tok.organization_id
      AND u.id = v_tok.user_id
    RETURNING u.synthetic_email, u.phone_number INTO v_email, v_phone;

    RETURN QUERY SELECT v_tok.id, v_tok.organization_id, v_tok.user_id, v_tok.purpose::TEXT, v_email, v_phone;
END;
$$;
