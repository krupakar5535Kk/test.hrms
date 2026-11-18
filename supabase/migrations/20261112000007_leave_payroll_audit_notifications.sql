-- ============================================================================
-- HRMS PAYROLL 5535 — Migration 00007:
-- Leave Management, Hourly Payroll Engine, Payslips, Payments,
-- Notifications & Immutable Audit Logs
-- ============================================================================
-- Version:        20261112000007
-- Non-destructive additive migration preserving 00001..00006.
-- ============================================================================

-- 1. Leave Types (strictly CL, SL, PL, LWP — all unpaid, 0 payable hours, 0 quotas)
CREATE TABLE IF NOT EXISTS public.leave_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    code VARCHAR(10) NOT NULL CHECK (code IN ('CL', 'SL', 'PL', 'LWP')),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_paid BOOLEAN NOT NULL DEFAULT FALSE CHECK (is_paid = FALSE),
    payable_minutes_credit INTEGER NOT NULL DEFAULT 0 CHECK (payable_minutes_credit = 0),
    has_quota BOOLEAN NOT NULL DEFAULT FALSE CHECK (has_quota = FALSE),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_leave_types_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_leave_types_org_code UNIQUE (organization_id, code)
);

-- 2. Leave Applications
CREATE TABLE IF NOT EXISTS public.leave_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    employee_id UUID NOT NULL,
    leave_type_id UUID NOT NULL,
    leave_code VARCHAR(10) NOT NULL CHECK (leave_code IN ('CL', 'SL', 'PL', 'LWP')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL CHECK (end_date >= start_date),
    total_days INTEGER GENERATED ALWAYS AS ((end_date - start_date) + 1) STORED,
    reason TEXT NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(reason)) >= 3),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    decision_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_leave_apps_org_emp FOREIGN KEY (organization_id, employee_id)
        REFERENCES public.employees(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_leave_apps_org_type FOREIGN KEY (organization_id, leave_type_id)
        REFERENCES public.leave_types(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_leave_apps_org_rev FOREIGN KEY (organization_id, reviewed_by)
        REFERENCES public.users(organization_id, id) ON DELETE SET NULL (reviewed_by)
);

CREATE INDEX IF NOT EXISTS idx_leave_apps_org_emp_dates
    ON public.leave_applications (organization_id, employee_id, start_date DESC);

CREATE TRIGGER trg_leave_applications_updated_at
    BEFORE UPDATE ON public.leave_applications
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Prevent employees from self-approving/rejecting leaves or creating pre-approved leaves
CREATE OR REPLACE FUNCTION public.trg_guard_leave_application_workflow()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NOT public.is_admin_or_super() AND NEW.status <> 'PENDING' THEN
            RAISE EXCEPTION 'Employees may only submit leave applications in PENDING status'
                USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NOT public.is_admin_or_super() THEN
            IF OLD.status <> 'PENDING' OR NEW.status <> 'CANCELLED' THEN
                RAISE EXCEPTION 'Employees may only cancel their own PENDING leave applications'
                    USING ERRCODE = '42501';
            END IF;
        END IF;
        RETURN NEW;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_leave_applications_guard_workflow
    BEFORE INSERT OR UPDATE ON public.leave_applications
    FOR EACH ROW EXECUTE FUNCTION public.trg_guard_leave_application_workflow();

-- 3. Holidays Calendar (organization-scoped)
CREATE TABLE IF NOT EXISTS public.holidays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    holiday_date DATE NOT NULL,
    name VARCHAR(200) NOT NULL,
    is_paid BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_holidays_org_date UNIQUE (organization_id, holiday_date)
);

-- 4. Effective-Dated Employee Salaries (integer paise; zero overlapping ranges via btree_gist)
CREATE TABLE IF NOT EXISTS public.employee_salaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    employee_id UUID NOT NULL,
    monthly_salary_paise BIGINT NOT NULL CHECK (monthly_salary_paise > 0),
    effective_from DATE NOT NULL,
    effective_to DATE CHECK (effective_to IS NULL OR effective_to >= effective_from),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'SUPERSEDED')),
    notes TEXT,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_salaries_org_id UNIQUE (organization_id, id),
    CONSTRAINT fk_salaries_org_emp FOREIGN KEY (organization_id, employee_id)
        REFERENCES public.employees(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_salaries_org_creator FOREIGN KEY (organization_id, created_by)
        REFERENCES public.users(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT excl_salary_no_overlap EXCLUDE USING gist (
        organization_id WITH =,
        employee_id WITH =,
        pg_catalog.daterange(effective_from, COALESCE(effective_to, '9999-12-31'::DATE), '[]') WITH &&
    )
);

CREATE TRIGGER trg_employee_salaries_updated_at
    BEFORE UPDATE ON public.employee_salaries
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Payroll Periods
CREATE TABLE IF NOT EXISTS public.payroll_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    year INTEGER NOT NULL CHECK (year BETWEEN 2020 AND 2100),
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL CHECK (end_date >= start_date),
    calendar_days INTEGER NOT NULL CHECK (calendar_days BETWEEN 28 AND 31 AND calendar_days = ((end_date - start_date) + 1)),
    working_days_mon_sat INTEGER NOT NULL CHECK (working_days_mon_sat BETWEEN 20 AND 27),
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'LOCKED', 'CLOSED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_payroll_periods_org_ym UNIQUE (organization_id, year, month),
    CONSTRAINT uq_payroll_periods_tenant_calendar UNIQUE (organization_id, id, calendar_days)
);

CREATE TRIGGER trg_payroll_periods_updated_at
    BEFORE UPDATE ON public.payroll_periods
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. Payroll Runs (Approval gated on explicit PO formula sign-off)
CREATE TABLE IF NOT EXISTS public.payroll_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    payroll_period_id UUID NOT NULL,
    calendar_days INTEGER NOT NULL CHECK (calendar_days BETWEEN 28 AND 31),
    run_number INTEGER NOT NULL DEFAULT 1 CHECK (run_number >= 1),
    formula_mode VARCHAR(50) NOT NULL DEFAULT 'PENDING_PO_APPROVAL'
        CHECK (formula_mode IN ('PENDING_PO_APPROVAL', 'CALENDAR_DAYS_X_8H_PAID_LUNCH', 'SCHEDULED_DAYS_X_7H_NET')),
    formula_approved BOOLEAN NOT NULL DEFAULT FALSE,
    formula_approved_by UUID,
    formula_approved_at TIMESTAMPTZ,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING_FORMULA_APPROVAL'
        CHECK (status IN ('PENDING_FORMULA_APPROVAL', 'DRAFT', 'REVIEWED', 'APPROVED', 'PROCESSED', 'CANCELLED')),
    total_employees INTEGER NOT NULL DEFAULT 0 CHECK (total_employees >= 0),
    total_payable_minutes BIGINT NOT NULL DEFAULT 0 CHECK (total_payable_minutes >= 0),
    total_gross_paise BIGINT NOT NULL DEFAULT 0 CHECK (total_gross_paise >= 0),
    total_net_paise BIGINT NOT NULL DEFAULT 0 CHECK (total_net_paise >= 0),
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_payroll_runs_tenant_calendar UNIQUE (organization_id, id, calendar_days),
    CONSTRAINT uq_payroll_runs_period_num UNIQUE (organization_id, payroll_period_id, run_number),
    CONSTRAINT fk_payroll_runs_period_tenant_calendar
        FOREIGN KEY (organization_id, payroll_period_id, calendar_days)
        REFERENCES public.payroll_periods(organization_id, id, calendar_days)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_payroll_runs_org_creator FOREIGN KEY (organization_id, created_by)
        REFERENCES public.users(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_payroll_runs_org_approver FOREIGN KEY (organization_id, approved_by)
        REFERENCES public.users(organization_id, id) ON DELETE SET NULL (approved_by),
    CONSTRAINT fk_payroll_runs_org_formula_approver FOREIGN KEY (organization_id, formula_approved_by)
        REFERENCES public.users(organization_id, id) ON DELETE SET NULL (formula_approved_by),
    CONSTRAINT chk_payroll_approval_requires_formula CHECK (
        status NOT IN ('APPROVED', 'PROCESSED') OR formula_approved = TRUE
    )
);

CREATE TRIGGER trg_payroll_runs_updated_at
    BEFORE UPDATE ON public.payroll_runs
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7. Payroll Line Items (tenant-safe composite FK inheriting calendar_days)
CREATE TABLE IF NOT EXISTS public.payroll_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    payroll_run_id UUID NOT NULL,
    calendar_days INTEGER NOT NULL CHECK (calendar_days BETWEEN 28 AND 31),
    employee_id UUID NOT NULL,
    employee_salary_id UUID,
    approved_payable_minutes INTEGER NOT NULL DEFAULT 0 CHECK (approved_payable_minutes >= 0),
    pending_review_minutes INTEGER NOT NULL DEFAULT 0 CHECK (pending_review_minutes >= 0),
    unpaid_leave_days INTEGER NOT NULL DEFAULT 0 CHECK (unpaid_leave_days >= 0),
    approved_days_count INTEGER NOT NULL DEFAULT 0 CHECK (approved_days_count >= 0),
    late_arrivals_count INTEGER NOT NULL DEFAULT 0 CHECK (late_arrivals_count >= 0),
    early_departures_count INTEGER NOT NULL DEFAULT 0 CHECK (early_departures_count >= 0),
    salary_reference_paise BIGINT NOT NULL CHECK (salary_reference_paise >= 0),
    derived_hourly_rate_paise NUMERIC(14, 6) NOT NULL DEFAULT 0,
    gross_earned_paise BIGINT NOT NULL DEFAULT 0 CHECK (gross_earned_paise >= 0),
    adjustments_paise BIGINT NOT NULL DEFAULT 0,
    net_payable_paise BIGINT NOT NULL DEFAULT 0 CHECK (net_payable_paise >= 0),
    calculation_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_payroll_items_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_payroll_items_run_emp UNIQUE (organization_id, payroll_run_id, employee_id),
    CONSTRAINT fk_payroll_items_run_tenant_calendar
        FOREIGN KEY (organization_id, payroll_run_id, calendar_days)
        REFERENCES public.payroll_runs(organization_id, id, calendar_days)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_payroll_items_org_emp FOREIGN KEY (organization_id, employee_id)
        REFERENCES public.employees(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_payroll_items_org_salary FOREIGN KEY (organization_id, employee_salary_id)
        REFERENCES public.employee_salaries(organization_id, id) ON DELETE SET NULL (employee_salary_id)
);

-- 8. Immutable Payroll Adjustments / Reversals Ledger
CREATE TABLE IF NOT EXISTS public.payroll_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    payroll_run_id UUID NOT NULL,
    payroll_item_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    adjustment_type VARCHAR(20) NOT NULL CHECK (adjustment_type IN ('ADDITION', 'DEDUCTION', 'REVERSAL')),
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    reason TEXT NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(reason)) >= 5),
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_pay_adj_org_item FOREIGN KEY (organization_id, payroll_item_id)
        REFERENCES public.payroll_items(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_pay_adj_org_emp FOREIGN KEY (organization_id, employee_id)
        REFERENCES public.employees(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_pay_adj_org_creator FOREIGN KEY (organization_id, created_by)
        REFERENCES public.users(organization_id, id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION public.trg_prevent_payroll_adjustment_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    RAISE EXCEPTION 'payroll_adjustments is strictly append-only and immutable'
        USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER trg_payroll_adjustments_immutable
    BEFORE UPDATE OR DELETE ON public.payroll_adjustments
    FOR EACH ROW EXECUTE FUNCTION public.trg_prevent_payroll_adjustment_mutation();

-- 9. Approved Payslips (cannot exist before final payroll approval!)
CREATE TABLE IF NOT EXISTS public.payslips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    payroll_run_id UUID NOT NULL,
    payroll_item_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    year INTEGER NOT NULL CHECK (year BETWEEN 2020 AND 2100),
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    payslip_number VARCHAR(64) NOT NULL,
    approved_payable_minutes INTEGER NOT NULL CHECK (approved_payable_minutes >= 0),
    gross_paise BIGINT NOT NULL CHECK (gross_paise >= 0),
    adjustments_paise BIGINT NOT NULL DEFAULT 0,
    net_paise BIGINT NOT NULL CHECK (net_paise >= 0),
    snapshot_json JSONB NOT NULL,
    issued_by UUID NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_payslips_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_payslips_org_number UNIQUE (organization_id, payslip_number),
    CONSTRAINT uq_payslips_org_run_emp UNIQUE (organization_id, payroll_run_id, employee_id),
    CONSTRAINT fk_payslips_org_item FOREIGN KEY (organization_id, payroll_item_id)
        REFERENCES public.payroll_items(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_payslips_org_emp FOREIGN KEY (organization_id, employee_id)
        REFERENCES public.employees(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_payslips_org_issuer FOREIGN KEY (organization_id, issued_by)
        REFERENCES public.users(organization_id, id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION public.trg_enforce_payslip_requires_approved_payroll()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_status VARCHAR(30);
    v_formula_ok BOOLEAN;
BEGIN
    SELECT pr.status, pr.formula_approved
    INTO v_status, v_formula_ok
    FROM public.payroll_runs pr
    WHERE pr.organization_id = NEW.organization_id
      AND pr.id = NEW.payroll_run_id;

    IF v_status NOT IN ('APPROVED', 'PROCESSED') OR v_formula_ok IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Payslips cannot be generated before payroll formula confirmation and final payroll approval'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payslips_require_approved_payroll
    BEFORE INSERT OR UPDATE ON public.payslips
    FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_payslip_requires_approved_payroll();

-- 10. Separate Payment Tracking Records (PENDING / PAID / FAILED)
CREATE TABLE IF NOT EXISTS public.payment_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    payroll_run_id UUID NOT NULL,
    payroll_item_id UUID NOT NULL,
    payslip_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    amount_paise BIGINT NOT NULL CHECK (amount_paise >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PAID', 'FAILED')),
    payment_reference VARCHAR(120),
    payment_mode VARCHAR(50),
    paid_at TIMESTAMPTZ,
    failure_reason TEXT,
    recorded_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_payment_records_org_payslip UNIQUE (organization_id, payslip_id),
    CONSTRAINT fk_payment_org_payslip FOREIGN KEY (organization_id, payslip_id)
        REFERENCES public.payslips(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_payment_org_item FOREIGN KEY (organization_id, payroll_item_id)
        REFERENCES public.payroll_items(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_payment_org_emp FOREIGN KEY (organization_id, employee_id)
        REFERENCES public.employees(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_payment_org_actor FOREIGN KEY (organization_id, recorded_by)
        REFERENCES public.users(organization_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_payment_records_updated_at
    BEFORE UPDATE ON public.payment_records
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 11. Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    recipient_user_id UUID NOT NULL,
    category VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    entity_type VARCHAR(64),
    entity_id UUID,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_notifications_org_user FOREIGN KEY (organization_id, recipient_user_id)
        REFERENCES public.users(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON public.notifications (organization_id, recipient_user_id, is_read, created_at DESC);

-- 12. Immutable System Audit Logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    actor_user_id UUID,
    actor_role VARCHAR(30),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(64) NOT NULL,
    entity_id UUID,
    summary TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    ip_address VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_audit_logs_org_actor FOREIGN KEY (organization_id, actor_user_id)
        REFERENCES public.users(organization_id, id) ON DELETE SET NULL (actor_user_id)
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_time
    ON public.audit_logs (organization_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.trg_enforce_audit_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is strictly append-only and immutable'
        USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER trg_audit_logs_immutable
    BEFORE UPDATE OR DELETE ON public.audit_logs
    FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_audit_immutability();

-- 13. Row-Level Security & Least-Privilege Grants
ALTER TABLE public.leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_types FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_leave_types_select ON public.leave_types
    FOR SELECT USING (organization_id = public.current_org_id());
CREATE POLICY rls_leave_types_admin_write ON public.leave_types
    FOR ALL USING (organization_id = public.current_org_id() AND public.is_admin_or_super())
    WITH CHECK (organization_id = public.current_org_id() AND public.is_admin_or_super());

ALTER TABLE public.leave_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_applications FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_leave_apps_select ON public.leave_applications
    FOR SELECT USING (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR employee_id = public.current_employee_id()));
CREATE POLICY rls_leave_apps_insert ON public.leave_applications
    FOR INSERT WITH CHECK (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR employee_id = public.current_employee_id()));
CREATE POLICY rls_leave_apps_update ON public.leave_applications
    FOR UPDATE USING (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR employee_id = public.current_employee_id()))
    WITH CHECK (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR employee_id = public.current_employee_id()));

ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_holidays_select ON public.holidays
    FOR SELECT USING (organization_id = public.current_org_id());
CREATE POLICY rls_holidays_admin_write ON public.holidays
    FOR ALL USING (organization_id = public.current_org_id() AND public.is_admin_or_super())
    WITH CHECK (organization_id = public.current_org_id() AND public.is_admin_or_super());

ALTER TABLE public.employee_salaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_salaries FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_salaries_select ON public.employee_salaries
    FOR SELECT USING (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR employee_id = public.current_employee_id()));
CREATE POLICY rls_salaries_admin_write ON public.employee_salaries
    FOR ALL USING (organization_id = public.current_org_id() AND public.is_admin_or_super())
    WITH CHECK (organization_id = public.current_org_id() AND public.is_admin_or_super());

ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_periods FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_payroll_periods_admin ON public.payroll_periods
    FOR ALL USING (organization_id = public.current_org_id() AND public.is_admin_or_super())
    WITH CHECK (organization_id = public.current_org_id() AND public.is_admin_or_super());

ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_payroll_runs_admin ON public.payroll_runs
    FOR ALL USING (organization_id = public.current_org_id() AND public.is_admin_or_super())
    WITH CHECK (organization_id = public.current_org_id() AND public.is_admin_or_super());

ALTER TABLE public.payroll_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_items FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_payroll_items_select ON public.payroll_items
    FOR SELECT USING (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR employee_id = public.current_employee_id()));
CREATE POLICY rls_payroll_items_admin_write ON public.payroll_items
    FOR ALL USING (organization_id = public.current_org_id() AND public.is_admin_or_super())
    WITH CHECK (organization_id = public.current_org_id() AND public.is_admin_or_super());

ALTER TABLE public.payroll_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_adjustments FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_payroll_adj_admin ON public.payroll_adjustments
    FOR ALL USING (organization_id = public.current_org_id() AND public.is_admin_or_super())
    WITH CHECK (organization_id = public.current_org_id() AND public.is_admin_or_super());

ALTER TABLE public.payslips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payslips FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_payslips_select ON public.payslips
    FOR SELECT USING (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR employee_id = public.current_employee_id()));
CREATE POLICY rls_payslips_admin_write ON public.payslips
    FOR ALL USING (organization_id = public.current_org_id() AND public.is_admin_or_super())
    WITH CHECK (organization_id = public.current_org_id() AND public.is_admin_or_super());

ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_records FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_payment_records_select ON public.payment_records
    FOR SELECT USING (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR employee_id = public.current_employee_id()));
CREATE POLICY rls_payment_records_admin_write ON public.payment_records
    FOR ALL USING (organization_id = public.current_org_id() AND public.is_admin_or_super())
    WITH CHECK (organization_id = public.current_org_id() AND public.is_admin_or_super());

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_notifications_select ON public.notifications
    FOR SELECT USING (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR recipient_user_id = public.auth_user_id()));
CREATE POLICY rls_notifications_insert ON public.notifications
    FOR INSERT WITH CHECK (organization_id = public.current_org_id());
CREATE POLICY rls_notifications_update ON public.notifications
    FOR UPDATE USING (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR recipient_user_id = public.auth_user_id()))
    WITH CHECK (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR recipient_user_id = public.auth_user_id()));

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_audit_logs_admin_select ON public.audit_logs
    FOR SELECT USING (organization_id = public.current_org_id() AND public.is_admin_or_super());
CREATE POLICY rls_audit_logs_insert ON public.audit_logs
    FOR INSERT WITH CHECK (organization_id = public.current_org_id());

REVOKE ALL ON public.leave_types, public.leave_applications, public.holidays, public.employee_salaries,
    public.payroll_periods, public.payroll_runs, public.payroll_items, public.payroll_adjustments,
    public.payslips, public.payment_records, public.notifications, public.audit_logs
    FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON public.leave_types, public.leave_applications, public.holidays,
    public.employee_salaries, public.payroll_periods, public.payroll_runs, public.payroll_items,
    public.payslips, public.payment_records, public.notifications TO hrms_app_user;
GRANT SELECT, INSERT ON public.payroll_adjustments, public.audit_logs TO hrms_app_user;

REVOKE ALL ON FUNCTION public.trg_guard_leave_application_workflow() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_prevent_payroll_adjustment_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_enforce_payslip_requires_approved_payroll() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_enforce_audit_immutability() FROM PUBLIC, anon, authenticated;
