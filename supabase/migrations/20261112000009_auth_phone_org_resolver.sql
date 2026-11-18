-- =============================================================================
-- Migration 00009: Security-Definer Organization Lookup for Mobile-First Login
-- =============================================================================
-- Purpose:
--   Unauthenticated POST /api/v1/auth/login runs under hrms_app_user BEFORE
--   any tenant RLS context (app.organization_id) exists. Direct SELECT queries
--   against public.organizations / public.users return 0 rows under RLS.
--   Provide a strictly scoped SECURITY DEFINER lookup returning only the minimal
--   organization metadata needed to resolve ambiguous multi-tenant phones.
-- =============================================================================

CREATE OR REPLACE FUNCTION hrms_internal.resolve_organizations_by_phone(
    p_phone_e164 TEXT,
    p_phone_raw TEXT
)
RETURNS TABLE(
    id UUID,
    organization_code VARCHAR(32),
    name VARCHAR(255),
    is_active BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT
        o.id,
        o.organization_code,
        o.name,
        o.is_active
    FROM public.organizations o
    JOIN public.users u ON u.organization_id = o.id
    WHERE o.is_active = TRUE
      AND u.is_active = TRUE
      AND u.activated_at IS NOT NULL
      AND (u.phone_number = p_phone_e164 OR u.phone_number = p_phone_raw)
    LIMIT 2;
END;
$$;

REVOKE ALL ON FUNCTION hrms_internal.resolve_organizations_by_phone(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hrms_internal.resolve_organizations_by_phone(TEXT, TEXT) TO hrms_app_user;
