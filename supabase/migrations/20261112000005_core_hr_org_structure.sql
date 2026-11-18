-- ============================================================================
-- HRMS PAYROLL 5535 — Migration 00005:
-- Core HR & Organizational Structure (Offices, Departments, Designations,
-- Employees, Employee Number Counter, Bank Details, Documents)
-- ============================================================================
-- Version:        20261112000005
-- Non-destructive additive migration preserving 00001..00004.
-- ============================================================================

-- 1. Extend public.organizations with policy configuration columns
ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS legal_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    ADD COLUMN IF NOT EXISTS selfie_retention_days INTEGER NOT NULL DEFAULT 30
        CHECK (selfie_retention_days BETWEEN 7 AND 365),
    ADD COLUMN IF NOT EXISTS planned_employee_count INTEGER NOT NULL DEFAULT 15
        CHECK (planned_employee_count >= 1);

-- 2. Offices (exact NUMERIC(18, 14) coordinates; approved 50m geofence default)
CREATE TABLE IF NOT EXISTS public.offices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    code VARCHAR(50) NOT NULL DEFAULT 'HQ',
    name VARCHAR(200) NOT NULL,
    branch_name VARCHAR(200) NOT NULL DEFAULT 'Head Office',
    address TEXT NOT NULL,
    latitude NUMERIC(18, 14) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude NUMERIC(18, 14) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    geofence_radius_meters INTEGER NOT NULL DEFAULT 50 CHECK (geofence_radius_meters BETWEEN 10 AND 5000),
    max_gps_accuracy_meters INTEGER NOT NULL DEFAULT 30 CHECK (max_gps_accuracy_meters BETWEEN 5 AND 200),
    policy_version VARCHAR(50) NOT NULL DEFAULT 'v1.0',
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_offices_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_offices_org_code UNIQUE (organization_id, code),
    CONSTRAINT fk_offices_org_updated_by FOREIGN KEY (organization_id, updated_by)
        REFERENCES public.users(organization_id, id) ON DELETE SET NULL (updated_by)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_offices_one_primary_per_org
    ON public.offices (organization_id)
    WHERE is_primary = TRUE;

CREATE TRIGGER trg_offices_updated_at
    BEFORE UPDATE ON public.offices
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Immutable Office Location Change Audit History
CREATE TABLE IF NOT EXISTS public.office_location_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    office_id UUID NOT NULL,
    previous_name VARCHAR(200),
    previous_address TEXT,
    previous_latitude NUMERIC(18, 14),
    previous_longitude NUMERIC(18, 14),
    previous_radius_meters INTEGER,
    previous_max_accuracy_meters INTEGER,
    new_name VARCHAR(200) NOT NULL,
    new_address TEXT NOT NULL,
    new_latitude NUMERIC(18, 14) NOT NULL,
    new_longitude NUMERIC(18, 14) NOT NULL,
    new_radius_meters INTEGER NOT NULL,
    new_max_accuracy_meters INTEGER NOT NULL,
    reason TEXT NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(reason)) >= 3),
    changed_by UUID NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_office_hist_org_office FOREIGN KEY (organization_id, office_id)
        REFERENCES public.offices(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_office_hist_org_actor FOREIGN KEY (organization_id, changed_by)
        REFERENCES public.users(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_office_location_history_org_office_time
    ON public.office_location_history (organization_id, office_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.trg_prevent_office_location_history_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    RAISE EXCEPTION 'office_location_history is strictly append-only and immutable'
        USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER trg_office_location_history_immutable
    BEFORE UPDATE OR DELETE ON public.office_location_history
    FOR EACH ROW EXECUTE FUNCTION public.trg_prevent_office_location_history_mutation();

-- 4. Departments
CREATE TABLE IF NOT EXISTS public.departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    allow_field_attendance BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_departments_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_departments_org_code UNIQUE (organization_id, code),
    CONSTRAINT uq_departments_org_name UNIQUE (organization_id, name)
);

CREATE TRIGGER trg_departments_updated_at
    BEFORE UPDATE ON public.departments
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Designations
CREATE TABLE IF NOT EXISTS public.designations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    department_id UUID,
    code VARCHAR(50) NOT NULL,
    title VARCHAR(150) NOT NULL,
    job_category VARCHAR(30) NOT NULL
        CHECK (job_category IN ('OFFICE', 'SALES', 'RECOVERY', 'HR', 'FINANCE')),
    is_field_eligible BOOLEAN NOT NULL DEFAULT FALSE
        CHECK ((NOT is_field_eligible) OR (job_category IN ('SALES', 'RECOVERY'))),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_designations_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_designations_org_code UNIQUE (organization_id, code),
    CONSTRAINT uq_designations_org_title UNIQUE (organization_id, title),
    CONSTRAINT fk_designations_org_dept FOREIGN KEY (organization_id, department_id)
        REFERENCES public.departments(organization_id, id) ON DELETE SET NULL (department_id)
);

CREATE TRIGGER trg_designations_updated_at
    BEFORE UPDATE ON public.designations
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. Tenant-scoped atomic employee code counter (EMP001, EMP002, ...)
CREATE TABLE IF NOT EXISTS public.organization_employee_counters (
    organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE RESTRICT,
    next_sequence INTEGER NOT NULL DEFAULT 1 CHECK (next_sequence >= 1),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.generate_next_employee_code(p_org_id UUID)
RETURNS VARCHAR(50)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_seq INTEGER;
BEGIN
    IF p_org_id IS DISTINCT FROM public.current_org_id() THEN
        RAISE EXCEPTION 'Cross-tenant employee code generation denied' USING ERRCODE = '42501';
    END IF;
    IF NOT public.is_admin_or_super() THEN
        RAISE EXCEPTION 'Admin role required to generate employee codes' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.organization_employee_counters (organization_id, next_sequence, updated_at)
    VALUES (p_org_id, 2, NOW())
    ON CONFLICT (organization_id) DO UPDATE
        SET next_sequence = public.organization_employee_counters.next_sequence + 1,
            updated_at = NOW()
    RETURNING next_sequence - 1 INTO v_seq;

    WHILE EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.organization_id = p_org_id
          AND e.employee_code = ('EMP' || pg_catalog.lpad(v_seq::TEXT, 3, '0'))
    ) LOOP
        UPDATE public.organization_employee_counters
        SET next_sequence = next_sequence + 1, updated_at = NOW()
        WHERE organization_id = p_org_id
        RETURNING next_sequence - 1 INTO v_seq;
    END LOOP;

    RETURN 'EMP' || pg_catalog.lpad(v_seq::TEXT, 3, '0');
END;
$$;

-- 7. Employees (Admin account strictly excluded at DB trigger level)
CREATE TABLE IF NOT EXISTS public.employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL,
    employee_code VARCHAR(50) NOT NULL,
    first_name VARCHAR(100) NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(first_name)) >= 1),
    last_name VARCHAR(100) NOT NULL DEFAULT '',
    full_name VARCHAR(201) GENERATED ALWAYS AS (
        pg_catalog.btrim(first_name || CASE WHEN pg_catalog.btrim(last_name) <> '' THEN ' ' || pg_catalog.btrim(last_name) ELSE '' END)
    ) STORED,
    phone_number VARCHAR(15) NOT NULL CHECK (phone_number ~ '^\+91[6-9][0-9]{9}$'),
    job_category VARCHAR(30) NOT NULL
        CHECK (job_category IN ('OFFICE', 'SALES', 'RECOVERY', 'HR', 'FINANCE')),
    department_id UUID NOT NULL,
    designation_id UUID NOT NULL,
    office_id UUID NOT NULL,
    joining_date DATE NOT NULL,
    employment_status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE'
        CHECK (employment_status IN ('ACTIVE', 'PROBATION', 'NOTICE_PERIOD', 'SUSPENDED', 'TERMINATED', 'RESIGNED')),
    is_field_eligible BOOLEAN NOT NULL DEFAULT FALSE
        CHECK ((NOT is_field_eligible) OR (job_category IN ('SALES', 'RECOVERY'))),
    shift_start_time TIME NOT NULL DEFAULT '10:00:00',
    shift_end_time TIME NOT NULL DEFAULT '18:00:00',
    emergency_contact_name VARCHAR(200),
    emergency_contact_phone VARCHAR(20),
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_employees_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_employees_org_code UNIQUE (organization_id, employee_code),
    CONSTRAINT uq_employees_org_user UNIQUE (organization_id, user_id),
    CONSTRAINT uq_employees_user_id UNIQUE (user_id),
    CONSTRAINT uq_employees_org_phone UNIQUE (organization_id, phone_number),
    CONSTRAINT fk_employees_org_user FOREIGN KEY (organization_id, user_id)
        REFERENCES public.users(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_employees_org_dept FOREIGN KEY (organization_id, department_id)
        REFERENCES public.departments(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_employees_org_desig FOREIGN KEY (organization_id, designation_id)
        REFERENCES public.designations(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_employees_org_office FOREIGN KEY (organization_id, office_id)
        REFERENCES public.offices(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_employees_org_created_by FOREIGN KEY (organization_id, created_by)
        REFERENCES public.users(organization_id, id) ON DELETE SET NULL (created_by)
);

CREATE INDEX IF NOT EXISTS idx_employees_org_status ON public.employees (organization_id, employment_status);
CREATE INDEX IF NOT EXISTS idx_employees_org_dept ON public.employees (organization_id, department_id);

CREATE TRIGGER trg_employees_updated_at
    BEFORE UPDATE ON public.employees
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enforce strict separation: ADMIN account must NEVER appear in public.employees
CREATE OR REPLACE FUNCTION public.trg_enforce_employee_role_exclusivity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_TABLE_NAME = 'employees' THEN
        IF EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = NEW.user_id
              AND ur.role IN ('ADMIN', 'SUPER_ADMIN')
        ) THEN
            RAISE EXCEPTION 'ADMIN users cannot have employee records or be counted as employees'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    ELSIF TG_TABLE_NAME = 'user_roles' THEN
        IF NEW.role IN ('ADMIN', 'SUPER_ADMIN') AND EXISTS (
            SELECT 1 FROM public.employees e
            WHERE e.user_id = NEW.user_id
        ) THEN
            RAISE EXCEPTION 'Existing employee cannot hold ADMIN role'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_employees_no_admin_role
    BEFORE INSERT OR UPDATE OF user_id ON public.employees
    FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_employee_role_exclusivity();

CREATE TRIGGER trg_user_roles_no_employee_admin
    BEFORE INSERT OR UPDATE OF user_id, role ON public.user_roles
    FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_employee_role_exclusivity();

-- Helper: current employee ID for authenticated user inside current org
CREATE OR REPLACE FUNCTION public.current_employee_id()
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
    SELECT e.id
    FROM public.employees e
    WHERE e.organization_id = public.current_org_id()
      AND e.user_id = public.auth_user_id()
    LIMIT 1;
$$;

-- 8. Employee Bank Details (sensitive - strictly Admin + owner self-view)
CREATE TABLE IF NOT EXISTS public.employee_bank_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    employee_id UUID NOT NULL,
    account_holder_name VARCHAR(200) NOT NULL,
    bank_name VARCHAR(200) NOT NULL,
    account_number_last4 CHAR(4) NOT NULL CHECK (account_number_last4 ~ '^[0-9]{4}$'),
    ifsc_code VARCHAR(11) NOT NULL CHECK (ifsc_code ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
    is_primary BOOLEAN NOT NULL DEFAULT TRUE,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_bank_org_emp FOREIGN KEY (organization_id, employee_id)
        REFERENCES public.employees(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_bank_org_actor FOREIGN KEY (organization_id, updated_by)
        REFERENCES public.users(organization_id, id) ON DELETE SET NULL (updated_by)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_one_primary_per_emp
    ON public.employee_bank_details (organization_id, employee_id)
    WHERE is_primary = TRUE;

CREATE TRIGGER trg_employee_bank_details_updated_at
    BEFORE UPDATE ON public.employee_bank_details
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 9. Employee Documents (references private storage only)
CREATE TABLE IF NOT EXISTS public.employee_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    employee_id UUID NOT NULL,
    document_type VARCHAR(50) NOT NULL CHECK (document_type IN ('ID_PROOF', 'OFFER_LETTER', 'JOINING_FORM', 'BANK_PROOF', 'OTHER')),
    title VARCHAR(200) NOT NULL,
    storage_bucket VARCHAR(100) NOT NULL DEFAULT 'hrms-documents',
    storage_path TEXT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760),
    uploaded_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_docs_org_emp FOREIGN KEY (organization_id, employee_id)
        REFERENCES public.employees(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_docs_org_uploader FOREIGN KEY (organization_id, uploaded_by)
        REFERENCES public.users(organization_id, id) ON DELETE RESTRICT
);

-- 10. Row-Level Security & Least-Privilege Grants
ALTER TABLE public.offices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offices FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_offices_select ON public.offices
    FOR SELECT USING (organization_id = public.current_org_id());
CREATE POLICY rls_offices_admin_write ON public.offices
    FOR ALL USING (organization_id = public.current_org_id() AND public.is_admin_or_super())
    WITH CHECK (organization_id = public.current_org_id() AND public.is_admin_or_super());

ALTER TABLE public.office_location_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_location_history FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_office_hist_admin_select ON public.office_location_history
    FOR SELECT USING (organization_id = public.current_org_id() AND public.is_admin_or_super());
CREATE POLICY rls_office_hist_admin_insert ON public.office_location_history
    FOR INSERT WITH CHECK (organization_id = public.current_org_id() AND public.is_admin_or_super());

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_departments_select ON public.departments
    FOR SELECT USING (organization_id = public.current_org_id());
CREATE POLICY rls_departments_admin_write ON public.departments
    FOR ALL USING (organization_id = public.current_org_id() AND public.is_admin_or_super())
    WITH CHECK (organization_id = public.current_org_id() AND public.is_admin_or_super());

ALTER TABLE public.designations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designations FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_designations_select ON public.designations
    FOR SELECT USING (organization_id = public.current_org_id());
CREATE POLICY rls_designations_admin_write ON public.designations
    FOR ALL USING (organization_id = public.current_org_id() AND public.is_admin_or_super())
    WITH CHECK (organization_id = public.current_org_id() AND public.is_admin_or_super());

ALTER TABLE public.organization_employee_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_employee_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_emp_counters_admin ON public.organization_employee_counters
    FOR ALL USING (organization_id = public.current_org_id() AND public.is_admin_or_super())
    WITH CHECK (organization_id = public.current_org_id() AND public.is_admin_or_super());

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_employees_select ON public.employees
    FOR SELECT USING (
        organization_id = public.current_org_id()
        AND (public.is_admin_or_super() OR user_id = public.auth_user_id())
    );
CREATE POLICY rls_employees_admin_insert ON public.employees
    FOR INSERT WITH CHECK (organization_id = public.current_org_id() AND public.is_admin_or_super());
CREATE POLICY rls_employees_admin_update ON public.employees
    FOR UPDATE USING (organization_id = public.current_org_id() AND public.is_admin_or_super())
    WITH CHECK (organization_id = public.current_org_id() AND public.is_admin_or_super());

ALTER TABLE public.employee_bank_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_bank_details FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_bank_select ON public.employee_bank_details
    FOR SELECT USING (
        organization_id = public.current_org_id()
        AND (public.is_admin_or_super() OR employee_id = public.current_employee_id())
    );
CREATE POLICY rls_bank_admin_write ON public.employee_bank_details
    FOR ALL USING (organization_id = public.current_org_id() AND public.is_admin_or_super())
    WITH CHECK (organization_id = public.current_org_id() AND public.is_admin_or_super());

ALTER TABLE public.employee_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_docs_select ON public.employee_documents
    FOR SELECT USING (
        organization_id = public.current_org_id()
        AND (public.is_admin_or_super() OR employee_id = public.current_employee_id())
    );
CREATE POLICY rls_docs_admin_write ON public.employee_documents
    FOR ALL USING (organization_id = public.current_org_id() AND public.is_admin_or_super())
    WITH CHECK (organization_id = public.current_org_id() AND public.is_admin_or_super());

-- Revoke defaults & grant precise privileges to hrms_app_user
REVOKE ALL ON public.offices, public.office_location_history, public.departments, public.designations,
    public.organization_employee_counters, public.employees, public.employee_bank_details, public.employee_documents
    FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON public.offices, public.departments, public.designations,
    public.employees, public.employee_bank_details, public.employee_documents TO hrms_app_user;
GRANT SELECT, INSERT ON public.office_location_history TO hrms_app_user;
GRANT SELECT, INSERT, UPDATE ON public.organization_employee_counters TO hrms_app_user;

GRANT SELECT (id, organization_code, name, legal_name, timezone, selfie_retention_days, planned_employee_count, is_active, created_at, updated_at)
    ON public.organizations TO hrms_app_user;
GRANT UPDATE (name, legal_name, timezone, selfie_retention_days, planned_employee_count)
    ON public.organizations TO hrms_app_user;

REVOKE ALL ON FUNCTION public.generate_next_employee_code(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_next_employee_code(UUID) TO hrms_app_user;

REVOKE ALL ON FUNCTION public.current_employee_id() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_employee_id() TO hrms_app_user;

REVOKE ALL ON FUNCTION public.trg_prevent_office_location_history_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_enforce_employee_role_exclusivity() FROM PUBLIC, anon, authenticated;
