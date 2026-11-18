-- ============================================================================
-- HRMS PAYROLL 5535 — Migration 00012:
-- Tenant-Safe CompreFace / Biometric Subject Identity Mapping
-- ============================================================================
-- Version:        20261112000012
-- Non-destructive additive migration preserving 00001..00011 and all existing
-- public.biometric_enrollments records.
--
-- Security & Isolation Guarantees:
--   1. Multi-organization isolation via mandatory organization_id FK + composite
--      FK (organization_id, employee_id) -> public.employees(organization_id, id)
--      + FORCE ROW LEVEL SECURITY.
--   2. Prevents a single CompreFace subject from being assigned to multiple
--      active employees — both within an organization and across organizations
--      sharing the same CompreFace recognition collection key.
--   3. Preserves full revocation & assignment history (no hard DELETEs; active
--      uniqueness enforced via partial indexes WHERE status = 'ACTIVE').
--   4. Automatically writes immutable audit entries to public.audit_logs on
--      every assignment, update, and revocation.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.face_provider_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    employee_id UUID NOT NULL,
    provider_name VARCHAR(64) NOT NULL DEFAULT 'compreface'
        CHECK (provider_name IN ('compreface', 'http')),
    provider_collection_key VARCHAR(128) NOT NULL DEFAULT 'default'
        CHECK (
            pg_catalog.length(pg_catalog.btrim(provider_collection_key)) >= 1
            AND provider_collection_key = pg_catalog.btrim(provider_collection_key)
        ),
    provider_subject VARCHAR(160) NOT NULL
        CHECK (
            pg_catalog.length(pg_catalog.btrim(provider_subject)) >= 1
            AND provider_subject = pg_catalog.btrim(provider_subject)
        ),
    biometric_enrollment_id UUID REFERENCES public.biometric_enrollments(id) ON DELETE SET NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'REVOKED')),
    assigned_by UUID,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT,
    revoked_by UUID,
    revoked_at TIMESTAMPTZ,
    revoked_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_face_map_org_emp FOREIGN KEY (organization_id, employee_id)
        REFERENCES public.employees(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_face_map_org_assigned_by FOREIGN KEY (organization_id, assigned_by)
        REFERENCES public.users(organization_id, id) ON DELETE SET NULL (assigned_by),
    CONSTRAINT fk_face_map_org_revoked_by FOREIGN KEY (organization_id, revoked_by)
        REFERENCES public.users(organization_id, id) ON DELETE SET NULL (revoked_by),
    CONSTRAINT chk_face_map_revoked_consistency CHECK (
        (status = 'ACTIVE' AND revoked_at IS NULL)
        OR (status = 'REVOKED' AND revoked_at IS NOT NULL)
    )
);

-- At most one ACTIVE mapping per employee per biometric provider inside an organization.
CREATE UNIQUE INDEX IF NOT EXISTS uq_face_map_active_employee
    ON public.face_provider_mappings (organization_id, employee_id, provider_name)
    WHERE status = 'ACTIVE';

-- Prevents any single CompreFace subject (case-insensitively) within a provider collection
-- from being assigned to multiple active employees — protecting both intra-org and shared-service
-- multi-tenant deployments.
CREATE UNIQUE INDEX IF NOT EXISTS uq_face_map_active_subject_per_collection
    ON public.face_provider_mappings (provider_name, provider_collection_key, pg_catalog.lower(provider_subject))
    WHERE status = 'ACTIVE';

-- Fast tenant-scoped lookup for Admin management, employee self-check, and attendance preflight.
CREATE INDEX IF NOT EXISTS idx_face_map_org_status
    ON public.face_provider_mappings (organization_id, status, provider_name, employee_id);

-- Fast history lookup by employee.
CREATE INDEX IF NOT EXISTS idx_face_map_emp_history
    ON public.face_provider_mappings (organization_id, employee_id, created_at DESC);

-- Maintain updated_at automatically via shared platform trigger function.
CREATE TRIGGER trg_face_provider_mappings_updated_at
    BEFORE UPDATE ON public.face_provider_mappings
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enforce employee eligibility, enrollment cross-reference integrity, and lifecycle immutability.
CREATE OR REPLACE FUNCTION public.trg_validate_face_provider_mapping()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_emp_status VARCHAR(30);
    v_enroll_org UUID;
    v_enroll_emp UUID;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
           OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
           OR NEW.provider_name IS DISTINCT FROM OLD.provider_name
           OR NEW.provider_collection_key IS DISTINCT FROM OLD.provider_collection_key
           OR NEW.provider_subject IS DISTINCT FROM OLD.provider_subject THEN
            RAISE EXCEPTION 'Identity fields on face_provider_mappings are immutable; revoke and create a new mapping instead'
                USING ERRCODE = '42501';
        END IF;

        IF OLD.status = 'REVOKED' AND NEW.status <> 'REVOKED' THEN
            RAISE EXCEPTION 'Revoked face_provider_mappings cannot be reactivated; create a new mapping instead'
                USING ERRCODE = '22023';
        END IF;

        IF OLD.status = 'ACTIVE' AND NEW.status = 'REVOKED' THEN
            NEW.revoked_at := COALESCE(NEW.revoked_at, NOW());
            NEW.revoked_by := COALESCE(NEW.revoked_by, public.auth_user_id());
            IF pg_catalog.btrim(COALESCE(NEW.revoked_reason, '')) = '' THEN
                NEW.revoked_reason := 'Revoked by Admin';
            END IF;
        END IF;
    END IF;

    IF NEW.status = 'ACTIVE' THEN
        SELECT e.employment_status
        INTO v_emp_status
        FROM public.employees e
        WHERE e.organization_id = NEW.organization_id
          AND e.id = NEW.employee_id
        LIMIT 1;

        IF v_emp_status IS NULL THEN
            RAISE EXCEPTION 'Target employee not found inside organization %', NEW.organization_id
                USING ERRCODE = '23503';
        END IF;

        IF v_emp_status IN ('TERMINATED', 'RESIGNED') THEN
            RAISE EXCEPTION 'Cannot assign active biometric mapping to separated employee (status=%)', v_emp_status
                USING ERRCODE = '22023';
        END IF;

        IF NEW.assigned_by IS NULL THEN
            NEW.assigned_by := public.auth_user_id();
        END IF;
    END IF;

    IF NEW.biometric_enrollment_id IS NOT NULL THEN
        SELECT b.organization_id, b.employee_id
        INTO v_enroll_org, v_enroll_emp
        FROM public.biometric_enrollments b
        WHERE b.id = NEW.biometric_enrollment_id
        LIMIT 1;

        IF v_enroll_org IS NULL
           OR v_enroll_org IS DISTINCT FROM NEW.organization_id
           OR v_enroll_emp IS DISTINCT FROM NEW.employee_id THEN
            RAISE EXCEPTION 'biometric_enrollment_id must belong to the exact same organization and employee'
                USING ERRCODE = '23503';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_face_provider_mappings_validate
    BEFORE INSERT OR UPDATE ON public.face_provider_mappings
    FOR EACH ROW EXECUTE FUNCTION public.trg_validate_face_provider_mapping();

-- Automatically record an immutable audit trail entry in public.audit_logs on every mapping write.
CREATE OR REPLACE FUNCTION public.trg_audit_face_provider_mapping()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_action VARCHAR(100);
    v_actor UUID;
    v_summary TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_action := 'FACE_SUBJECT_MAPPING_ASSIGNED';
        v_actor := COALESCE(public.auth_user_id(), NEW.assigned_by);
        v_summary := pg_catalog.format(
            'Assigned %s subject "%s" (collection=%s) to employee %s.',
            NEW.provider_name,
            NEW.provider_subject,
            NEW.provider_collection_key,
            NEW.employee_id
        );
    ELSIF OLD.status = 'ACTIVE' AND NEW.status = 'REVOKED' THEN
        v_action := 'FACE_SUBJECT_MAPPING_REVOKED';
        v_actor := COALESCE(public.auth_user_id(), NEW.revoked_by, NEW.assigned_by);
        v_summary := pg_catalog.format(
            'Revoked %s subject "%s" (collection=%s) from employee %s.',
            NEW.provider_name,
            NEW.provider_subject,
            NEW.provider_collection_key,
            NEW.employee_id
        );
    ELSE
        v_action := 'FACE_SUBJECT_MAPPING_UPDATED';
        v_actor := COALESCE(public.auth_user_id(), NEW.assigned_by);
        v_summary := pg_catalog.format(
            'Updated %s subject mapping metadata for employee %s.',
            NEW.provider_name,
            NEW.employee_id
        );
    END IF;

    INSERT INTO public.audit_logs (
        organization_id,
        actor_user_id,
        actor_role,
        action,
        entity_type,
        entity_id,
        summary,
        metadata
    ) VALUES (
        NEW.organization_id,
        v_actor,
        CASE WHEN public.is_admin_or_super() THEN 'ADMIN' ELSE 'SYSTEM' END,
        v_action,
        'BIOMETRIC_MAPPING',
        NEW.id,
        v_summary,
        pg_catalog.jsonb_build_object(
            'employeeId', NEW.employee_id,
            'providerName', NEW.provider_name,
            'collectionKey', NEW.provider_collection_key,
            'providerSubject', NEW.provider_subject,
            'status', NEW.status,
            'biometricEnrollmentId', NEW.biometric_enrollment_id,
            'revokedReason', NEW.revoked_reason
        )
    );

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_face_provider_mappings_audit
    AFTER INSERT OR UPDATE ON public.face_provider_mappings
    FOR EACH ROW EXECUTE FUNCTION public.trg_audit_face_provider_mapping();

-- Row-Level Security & Least-Privilege Grants
ALTER TABLE public.face_provider_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.face_provider_mappings FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_face_map_select ON public.face_provider_mappings
    FOR SELECT USING (
        organization_id = public.current_org_id()
        AND (
            public.is_admin_or_super()
            OR employee_id = public.current_employee_id()
        )
    );

CREATE POLICY rls_face_map_admin_insert ON public.face_provider_mappings
    FOR INSERT WITH CHECK (
        organization_id = public.current_org_id()
        AND public.is_admin_or_super()
    );

CREATE POLICY rls_face_map_admin_update ON public.face_provider_mappings
    FOR UPDATE USING (
        organization_id = public.current_org_id()
        AND public.is_admin_or_super()
    )
    WITH CHECK (
        organization_id = public.current_org_id()
        AND public.is_admin_or_super()
    );

REVOKE ALL ON public.face_provider_mappings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.face_provider_mappings TO hrms_app_user;

REVOKE ALL ON FUNCTION public.trg_validate_face_provider_mapping() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_audit_face_provider_mapping() FROM PUBLIC, anon, authenticated;
