-- =============================================================================
-- Migration 00011: Allow Employees to Read Approved Payroll Runs & Periods for Issued Payslips
-- =============================================================================
-- Purpose:
--   Employees querying their officially issued payslips join payslips ->
--   payroll_items -> payroll_runs -> payroll_periods. Previously payroll_runs and
--   payroll_periods only permitted Admin SELECT under RLS, causing employee payslip
--   queries to return 0 rows even after PO formula confirmation and Admin approval.
-- Security invariant:
--   Employees can ONLY SELECT payroll_runs where status IN ('APPROVED', 'PROCESSED')
--   AND formula_approved = TRUE. Draft runs remain strictly Admin-only.
--   payroll_items, payslips, and payment_records remain strictly filtered to
--   employee_id = public.current_employee_id().
-- =============================================================================

CREATE POLICY rls_payroll_periods_employee_select ON public.payroll_periods
    FOR SELECT USING (
        organization_id = public.current_org_id()
    );

CREATE POLICY rls_payroll_runs_employee_approved_select ON public.payroll_runs
    FOR SELECT USING (
        organization_id = public.current_org_id()
        AND status IN ('APPROVED', 'PROCESSED')
        AND formula_approved = TRUE
    );
