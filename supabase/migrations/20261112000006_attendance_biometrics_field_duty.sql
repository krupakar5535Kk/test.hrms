-- ============================================================================
-- HRMS PAYROLL 5535 — Migration 00006:
-- Attendance, Biometrics, Selfie Evidence, Idempotency & Field Duty
-- ============================================================================
-- Version:        20261112000006
-- Non-destructive additive migration preserving 00001..00005.
-- ============================================================================

-- 1. Biometric Enrollments (provider-independent face enrollment lifecycle)
CREATE TABLE IF NOT EXISTS public.biometric_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    employee_id UUID NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'REQUIRED'
        CHECK (status IN ('REQUIRED', 'PENDING', 'APPROVED', 'REJECTED', 'REVOKED')),
    provider_name VARCHAR(64) NOT NULL DEFAULT 'UNCONFIGURED',
    template_reference TEXT,
    evidence_bucket VARCHAR(100) NOT NULL DEFAULT 'face-enrollment',
    evidence_path TEXT,
    image_quality_score NUMERIC(5, 2),
    consent_given BOOLEAN NOT NULL DEFAULT FALSE,
    consent_version VARCHAR(32) NOT NULL DEFAULT 'v1.0',
    consent_recorded_at TIMESTAMPTZ,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    submitted_by UUID,
    submitted_at TIMESTAMPTZ,
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    rejection_reason TEXT,
    revoked_by UUID,
    revoked_at TIMESTAMPTZ,
    revoked_reason TEXT,
    retention_until DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_bio_org_emp FOREIGN KEY (organization_id, employee_id)
        REFERENCES public.employees(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_bio_org_sub FOREIGN KEY (organization_id, submitted_by)
        REFERENCES public.users(organization_id, id) ON DELETE SET NULL (submitted_by),
    CONSTRAINT fk_bio_org_rev FOREIGN KEY (organization_id, reviewed_by)
        REFERENCES public.users(organization_id, id) ON DELETE SET NULL (reviewed_by),
    CONSTRAINT fk_bio_org_revk FOREIGN KEY (organization_id, revoked_by)
        REFERENCES public.users(organization_id, id) ON DELETE SET NULL (revoked_by)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_biometric_current_emp
    ON public.biometric_enrollments (organization_id, employee_id)
    WHERE is_current = TRUE;

CREATE TRIGGER trg_biometric_enrollments_updated_at
    BEFORE UPDATE ON public.biometric_enrollments
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Attendance Days (authoritative daily attendance & DEC-01 breakdown)
CREATE TABLE IF NOT EXISTS public.attendance_days (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    employee_id UUID NOT NULL,
    office_id UUID NOT NULL,
    attendance_date DATE NOT NULL,
    check_in_at TIMESTAMPTZ,
    check_out_at TIMESTAMPTZ,
    check_in_event_type VARCHAR(30)
        CHECK (check_in_event_type IN ('FACE_AUTO', 'FACE_BUTTON', 'FACE_EMPLOYEE_APP', 'PIN_FALLBACK', 'MANAGER_OVERRIDE')),
    check_out_event_type VARCHAR(30)
        CHECK (check_out_event_type IN ('FACE_AUTO', 'FACE_BUTTON', 'FACE_EMPLOYEE_APP', 'PIN_FALLBACK', 'MANAGER_OVERRIDE')),
    approval_status VARCHAR(30) NOT NULL DEFAULT 'NOT_MARKED'
        CHECK (approval_status IN ('NOT_MARKED', 'SUBMITTED', 'APPROVED', 'PENDING_ADMIN_REVIEW', 'VERIFICATION_PENDING', 'REJECTED')),
    verification_state VARCHAR(40) NOT NULL DEFAULT 'VERIFICATION_PENDING',
    location_state VARCHAR(40) NOT NULL DEFAULT 'VERIFICATION_PENDING',
    check_in_latitude NUMERIC(18, 14),
    check_in_longitude NUMERIC(18, 14),
    check_in_accuracy_meters NUMERIC(8, 2),
    check_in_distance_meters NUMERIC(10, 2),
    check_out_latitude NUMERIC(18, 14),
    check_out_longitude NUMERIC(18, 14),
    check_out_accuracy_meters NUMERIC(8, 2),
    check_out_distance_meters NUMERIC(10, 2),
    is_outside_geofence BOOLEAN NOT NULL DEFAULT FALSE,
    outside_geofence_comment TEXT,
    is_late_arrival BOOLEAN NOT NULL DEFAULT FALSE,
    is_early_departure BOOLEAN NOT NULL DEFAULT FALSE,
    is_unpaired_checkout BOOLEAN NOT NULL DEFAULT FALSE,
    raw_duration_minutes INTEGER NOT NULL DEFAULT 0 CHECK (raw_duration_minutes >= 0),
    lunch_deducted_minutes INTEGER NOT NULL DEFAULT 0 CHECK (lunch_deducted_minutes >= 0),
    payable_minutes INTEGER NOT NULL DEFAULT 0 CHECK (payable_minutes >= 0),
    approved_payable_minutes INTEGER NOT NULL DEFAULT 0 CHECK (approved_payable_minutes >= 0),
    post_6pm_minutes INTEGER NOT NULL DEFAULT 0 CHECK (post_6pm_minutes >= 0),
    post_6pm_approved BOOLEAN NOT NULL DEFAULT FALSE,
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    review_reason TEXT,
    clarification_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_attendance_days_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_attendance_days_emp_date UNIQUE (organization_id, employee_id, attendance_date),
    CONSTRAINT fk_att_days_org_emp FOREIGN KEY (organization_id, employee_id)
        REFERENCES public.employees(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_att_days_org_office FOREIGN KEY (organization_id, office_id)
        REFERENCES public.offices(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_att_days_org_reviewer FOREIGN KEY (organization_id, reviewed_by)
        REFERENCES public.users(organization_id, id) ON DELETE SET NULL (reviewed_by),
    CONSTRAINT chk_att_days_checkout_after_checkin CHECK (
        check_out_at IS NULL OR check_in_at IS NULL OR check_out_at >= check_in_at
    )
);

CREATE INDEX IF NOT EXISTS idx_attendance_days_org_date
    ON public.attendance_days (organization_id, attendance_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_days_org_status
    ON public.attendance_days (organization_id, approval_status, attendance_date DESC);

CREATE TRIGGER trg_attendance_days_updated_at
    BEFORE UPDATE ON public.attendance_days
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Prevent employees from mutating attendance records directly
CREATE OR REPLACE FUNCTION public.trg_guard_attendance_day_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF pg_catalog.current_setting('app.internal_punch_tx', true) = 'on' THEN
        RETURN NEW;
    END IF;
    IF NOT public.is_admin_or_super() THEN
        RAISE EXCEPTION 'Employees cannot edit or approve attendance records directly'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_attendance_days_guard_mutation
    BEFORE UPDATE ON public.attendance_days
    FOR EACH ROW EXECUTE FUNCTION public.trg_guard_attendance_day_mutation();

-- 3. Attendance Events (strictly 1 CHECK_IN and 1 CHECK_OUT per attendance_day)
CREATE TABLE IF NOT EXISTS public.attendance_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    attendance_day_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    punch_direction VARCHAR(20) NOT NULL CHECK (punch_direction IN ('CHECK_IN', 'CHECK_OUT')),
    event_type VARCHAR(30) NOT NULL
        CHECK (event_type IN ('FACE_AUTO', 'FACE_BUTTON', 'FACE_EMPLOYEE_APP', 'PIN_FALLBACK', 'MANAGER_OVERRIDE')),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    latitude NUMERIC(18, 14) NOT NULL,
    longitude NUMERIC(18, 14) NOT NULL,
    accuracy_meters NUMERIC(8, 2) NOT NULL CHECK (accuracy_meters >= 0),
    distance_from_office_meters NUMERIC(10, 2) NOT NULL CHECK (distance_from_office_meters >= 0),
    location_state VARCHAR(40) NOT NULL,
    face_verification_status VARCHAR(40) NOT NULL,
    liveness_status VARCHAR(40) NOT NULL,
    verification_attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (verification_attempt_count >= 1),
    employee_comment TEXT,
    selfie_bucket VARCHAR(100) NOT NULL DEFAULT 'attendance-selfies',
    selfie_path TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_att_events_org_id UNIQUE (organization_id, id),
    CONSTRAINT uq_att_events_one_per_direction UNIQUE (attendance_day_id, punch_direction),
    CONSTRAINT fk_att_events_org_day FOREIGN KEY (organization_id, attendance_day_id)
        REFERENCES public.attendance_days(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_att_events_org_emp FOREIGN KEY (organization_id, employee_id)
        REFERENCES public.employees(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_attendance_events_org_emp_time
    ON public.attendance_events (organization_id, employee_id, recorded_at DESC);

-- 4. Face Verification Attempts (max 3 unsuccessful attempts -> VERIFICATION_PENDING)
CREATE TABLE IF NOT EXISTS public.face_verification_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    employee_id UUID NOT NULL,
    attendance_day_id UUID,
    punch_direction VARCHAR(20) NOT NULL CHECK (punch_direction IN ('CHECK_IN', 'CHECK_OUT', 'ENROLLMENT')),
    attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
    provider_name VARCHAR(64) NOT NULL DEFAULT 'UNCONFIGURED',
    event_type VARCHAR(30) NOT NULL
        CHECK (event_type IN ('FACE_AUTO', 'FACE_BUTTON', 'FACE_EMPLOYEE_APP', 'PIN_FALLBACK', 'MANAGER_OVERRIDE')),
    match_status VARCHAR(40) NOT NULL
        CHECK (match_status IN ('PENDING', 'VERIFIED', 'MISMATCH', 'SPOOFING_SUSPECTED', 'PROVIDER_UNCONFIGURED', 'FAILED', 'FACE_NOT_DETECTED', 'MULTIPLE_FACES_DETECTED', 'POOR_IMAGE_QUALITY')),
    liveness_status VARCHAR(40) NOT NULL
        CHECK (liveness_status IN ('PENDING', 'LIVE', 'FAILED', 'UNAVAILABLE')),
    confidence_score NUMERIC(5, 4),
    selfie_bucket VARCHAR(100) NOT NULL DEFAULT 'attendance-selfies',
    selfie_path TEXT NOT NULL,
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_face_att_org_emp FOREIGN KEY (organization_id, employee_id)
        REFERENCES public.employees(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_face_att_org_day FOREIGN KEY (organization_id, attendance_day_id)
        REFERENCES public.attendance_days(organization_id, id) ON DELETE SET NULL (attendance_day_id)
);

CREATE INDEX IF NOT EXISTS idx_face_attempts_emp_time
    ON public.face_verification_attempts (organization_id, employee_id, created_at DESC);

-- 5. Attendance Private Storage Evidence Index
CREATE TABLE IF NOT EXISTS public.attendance_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    employee_id UUID NOT NULL,
    attendance_day_id UUID,
    attendance_event_id UUID,
    evidence_kind VARCHAR(30) NOT NULL CHECK (evidence_kind IN ('CHECK_IN_SELFIE', 'CHECK_OUT_SELFIE', 'ENROLLMENT', 'VISIT_EVIDENCE')),
    storage_bucket VARCHAR(100) NOT NULL,
    storage_path TEXT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760),
    sha256_digest CHAR(64),
    retained_until DATE NOT NULL,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_att_ev_org_emp FOREIGN KEY (organization_id, employee_id)
        REFERENCES public.employees(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_att_ev_org_day FOREIGN KEY (organization_id, attendance_day_id)
        REFERENCES public.attendance_days(organization_id, id) ON DELETE SET NULL (attendance_day_id),
    CONSTRAINT fk_att_ev_org_event FOREIGN KEY (organization_id, attendance_event_id)
        REFERENCES public.attendance_events(organization_id, id) ON DELETE SET NULL (attendance_event_id)
);

-- 6. Immutable Attendance Correction Ledger (Admin-only, reason required)
CREATE TABLE IF NOT EXISTS public.attendance_corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    attendance_day_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    corrected_by UUID NOT NULL,
    reason TEXT NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(reason)) >= 5),
    previous_check_in_at TIMESTAMPTZ,
    new_check_in_at TIMESTAMPTZ,
    previous_check_out_at TIMESTAMPTZ,
    new_check_out_at TIMESTAMPTZ,
    previous_status VARCHAR(30) NOT NULL,
    new_status VARCHAR(30) NOT NULL,
    previous_payable_minutes INTEGER NOT NULL,
    new_payable_minutes INTEGER NOT NULL,
    previous_approved_payable_minutes INTEGER NOT NULL,
    new_approved_payable_minutes INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_att_corr_org_day FOREIGN KEY (organization_id, attendance_day_id)
        REFERENCES public.attendance_days(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_att_corr_org_emp FOREIGN KEY (organization_id, employee_id)
        REFERENCES public.employees(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_att_corr_org_actor FOREIGN KEY (organization_id, corrected_by)
        REFERENCES public.users(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_attendance_corrections_org_day
    ON public.attendance_corrections (organization_id, attendance_day_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.trg_prevent_attendance_correction_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    RAISE EXCEPTION 'attendance_corrections is strictly append-only and immutable'
        USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER trg_attendance_corrections_immutable
    BEFORE UPDATE OR DELETE ON public.attendance_corrections
    FOR EACH ROW EXECUTE FUNCTION public.trg_prevent_attendance_correction_mutation();

-- 7. API Idempotency & Replay Protection Records
CREATE TABLE IF NOT EXISTS public.idempotency_records (
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    actor_user_id UUID NOT NULL,
    endpoint VARCHAR(100) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    response_status INTEGER NOT NULL,
    response_body JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '48 hours'),

    PRIMARY KEY (organization_id, actor_user_id, endpoint, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_cleanup ON public.idempotency_records (expires_at);

-- 8. Field Duty Sessions (Sales & Recovery only; status separate from Attendance)
CREATE TABLE IF NOT EXISTS public.field_duty_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    employee_id UUID NOT NULL,
    attendance_day_id UUID,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'ENDED', 'CANCELLED')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    start_latitude NUMERIC(18, 14) NOT NULL,
    start_longitude NUMERIC(18, 14) NOT NULL,
    start_accuracy_meters NUMERIC(8, 2) NOT NULL CHECK (start_accuracy_meters >= 0),
    end_latitude NUMERIC(18, 14),
    end_longitude NUMERIC(18, 14),
    end_accuracy_meters NUMERIC(8, 2),
    authorized_by UUID,
    authorization_note TEXT,
    end_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_field_duty_org_id UNIQUE (organization_id, id),
    CONSTRAINT fk_fd_org_emp FOREIGN KEY (organization_id, employee_id)
        REFERENCES public.employees(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_fd_org_att FOREIGN KEY (organization_id, attendance_day_id)
        REFERENCES public.attendance_days(organization_id, id) ON DELETE SET NULL (attendance_day_id),
    CONSTRAINT fk_fd_org_auth FOREIGN KEY (organization_id, authorized_by)
        REFERENCES public.users(organization_id, id) ON DELETE SET NULL (authorized_by)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_field_duty_one_active_per_emp
    ON public.field_duty_sessions (organization_id, employee_id)
    WHERE status = 'ACTIVE';

CREATE TRIGGER trg_field_duty_sessions_updated_at
    BEFORE UPDATE ON public.field_duty_sessions
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.trg_validate_field_duty_eligibility()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_eligible BOOLEAN;
BEGIN
    SELECT e.is_field_eligible INTO v_eligible
    FROM public.employees e
    WHERE e.organization_id = NEW.organization_id
      AND e.id = NEW.employee_id;

    IF v_eligible IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Only authorised Sales Representatives and Recovery Agents may initiate field duty'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_field_duty_eligibility
    BEFORE INSERT ON public.field_duty_sessions
    FOR EACH ROW EXECUTE FUNCTION public.trg_validate_field_duty_eligibility();

-- 9. Field Duty GPS Events (allowed ONLY during active field duty)
CREATE TABLE IF NOT EXISTS public.field_duty_gps_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    session_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    latitude NUMERIC(18, 14) NOT NULL,
    longitude NUMERIC(18, 14) NOT NULL,
    accuracy_meters NUMERIC(8, 2) NOT NULL CHECK (accuracy_meters >= 0),
    distance_from_office_meters NUMERIC(10, 2),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_fd_gps_org_session FOREIGN KEY (organization_id, session_id)
        REFERENCES public.field_duty_sessions(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_fd_gps_org_emp FOREIGN KEY (organization_id, employee_id)
        REFERENCES public.employees(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_field_duty_gps_session_time
    ON public.field_duty_gps_events (organization_id, session_id, recorded_at DESC);

CREATE OR REPLACE FUNCTION public.trg_validate_gps_event_active_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_status VARCHAR(20);
    v_emp UUID;
BEGIN
    SELECT s.status, s.employee_id INTO v_status, v_emp
    FROM public.field_duty_sessions s
    WHERE s.organization_id = NEW.organization_id
      AND s.id = NEW.session_id;

    IF v_status IS DISTINCT FROM 'ACTIVE' OR v_emp IS DISTINCT FROM NEW.employee_id THEN
        RAISE EXCEPTION 'Background GPS events require an active field-duty session owned by the employee'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_gps_event_requires_active_session
    BEFORE INSERT ON public.field_duty_gps_events
    FOR EACH ROW EXECUTE FUNCTION public.trg_validate_gps_event_active_session();

-- 10. Customer Visits (no invented customer geofence radius!)
CREATE TABLE IF NOT EXISTS public.customer_visits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    session_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    customer_name VARCHAR(200) NOT NULL,
    customer_reference VARCHAR(100),
    visit_purpose VARCHAR(50) NOT NULL
        CHECK (visit_purpose IN ('SALES_PITCH', 'FOLLOW_UP', 'COLLECTION', 'RECOVERY', 'SUPPORT', 'OTHER')),
    notes TEXT,
    latitude NUMERIC(18, 14) NOT NULL,
    longitude NUMERIC(18, 14) NOT NULL,
    accuracy_meters NUMERIC(8, 2) NOT NULL CHECK (accuracy_meters >= 0),
    distance_from_office_meters NUMERIC(10, 2),
    evidence_bucket VARCHAR(100) NOT NULL DEFAULT 'visit-evidence',
    evidence_path TEXT,
    visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    review_status VARCHAR(30) NOT NULL DEFAULT 'SUBMITTED'
        CHECK (review_status IN ('SUBMITTED', 'VERIFIED', 'FLAGGED', 'REJECTED')),
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    review_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_visits_org_session FOREIGN KEY (organization_id, session_id)
        REFERENCES public.field_duty_sessions(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_visits_org_emp FOREIGN KEY (organization_id, employee_id)
        REFERENCES public.employees(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_visits_org_rev FOREIGN KEY (organization_id, reviewed_by)
        REFERENCES public.users(organization_id, id) ON DELETE SET NULL (reviewed_by)
);

CREATE INDEX IF NOT EXISTS idx_customer_visits_org_emp_time
    ON public.customer_visits (organization_id, employee_id, visited_at DESC);

CREATE TRIGGER trg_customer_visits_updated_at
    BEFORE UPDATE ON public.customer_visits
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 11. Trusted Server Attendance Punch Helper (blocks direct employee UPDATE bypass)
CREATE OR REPLACE FUNCTION hrms_internal.commit_attendance_punch(
    p_org_id UUID,
    p_employee_id UUID,
    p_office_id UUID,
    p_attendance_date DATE,
    p_punch_direction TEXT,
    p_event_type TEXT,
    p_recorded_at TIMESTAMPTZ,
    p_latitude NUMERIC(18, 14),
    p_longitude NUMERIC(18, 14),
    p_accuracy_meters NUMERIC(8, 2),
    p_distance_meters NUMERIC(10, 2),
    p_location_state TEXT,
    p_face_verification_status TEXT,
    p_liveness_status TEXT,
    p_verification_attempt_count INTEGER,
    p_is_outside_geofence BOOLEAN,
    p_employee_comment TEXT,
    p_selfie_bucket TEXT,
    p_selfie_path TEXT,
    p_approval_status TEXT,
    p_verification_state TEXT,
    p_is_late_arrival BOOLEAN,
    p_is_early_departure BOOLEAN,
    p_raw_duration_minutes INTEGER,
    p_lunch_deducted_minutes INTEGER,
    p_payable_minutes INTEGER,
    p_approved_payable_minutes INTEGER,
    p_post_6pm_minutes INTEGER
)
RETURNS TABLE (
    attendance_day_id UUID,
    attendance_event_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, hrms_internal
AS $$
DECLARE
    v_day_id UUID;
    v_event_id UUID;
BEGIN
    IF p_org_id IS DISTINCT FROM public.current_org_id() THEN
        RAISE EXCEPTION 'Cross-tenant attendance mutation denied' USING ERRCODE = '42501';
    END IF;
    IF NOT public.is_admin_or_super() AND p_employee_id IS DISTINCT FROM public.current_employee_id() THEN
        RAISE EXCEPTION 'Cannot record attendance for another employee' USING ERRCODE = '42501';
    END IF;

    PERFORM pg_catalog.set_config('app.internal_punch_tx', 'on', true);

    IF p_punch_direction = 'CHECK_IN' THEN
        INSERT INTO public.attendance_days (
            organization_id, employee_id, office_id, attendance_date,
            check_in_at, check_in_event_type, approval_status, verification_state, location_state,
            check_in_latitude, check_in_longitude, check_in_accuracy_meters, check_in_distance_meters,
            is_outside_geofence, outside_geofence_comment, is_late_arrival
        ) VALUES (
            p_org_id, p_employee_id, p_office_id, p_attendance_date,
            p_recorded_at, p_event_type, p_approval_status, p_verification_state, p_location_state,
            p_latitude, p_longitude, p_accuracy_meters, p_distance_meters,
            p_is_outside_geofence, p_employee_comment, p_is_late_arrival
        )
        ON CONFLICT (organization_id, employee_id, attendance_date) DO UPDATE
            SET check_in_at = EXCLUDED.check_in_at,
                check_in_event_type = EXCLUDED.check_in_event_type,
                approval_status = EXCLUDED.approval_status,
                verification_state = EXCLUDED.verification_state,
                location_state = EXCLUDED.location_state,
                check_in_latitude = EXCLUDED.check_in_latitude,
                check_in_longitude = EXCLUDED.check_in_longitude,
                check_in_accuracy_meters = EXCLUDED.check_in_accuracy_meters,
                check_in_distance_meters = EXCLUDED.check_in_distance_meters,
                is_outside_geofence = EXCLUDED.is_outside_geofence,
                outside_geofence_comment = COALESCE(EXCLUDED.outside_geofence_comment, public.attendance_days.outside_geofence_comment),
                is_late_arrival = EXCLUDED.is_late_arrival
        WHERE public.attendance_days.check_in_at IS NULL
        RETURNING id INTO v_day_id;

        IF v_day_id IS NULL THEN
            RAISE EXCEPTION 'ATTENDANCE_ALREADY_COMPLETED: Check-in already exists for today' USING ERRCODE = '23505';
        END IF;
    ELSIF p_punch_direction = 'CHECK_OUT' THEN
        UPDATE public.attendance_days ad
        SET check_out_at = p_recorded_at,
            check_out_event_type = p_event_type,
            approval_status = p_approval_status,
            verification_state = p_verification_state,
            location_state = p_location_state,
            check_out_latitude = p_latitude,
            check_out_longitude = p_longitude,
            check_out_accuracy_meters = p_accuracy_meters,
            check_out_distance_meters = p_distance_meters,
            is_outside_geofence = (ad.is_outside_geofence OR p_is_outside_geofence),
            outside_geofence_comment = COALESCE(p_employee_comment, ad.outside_geofence_comment),
            is_early_departure = p_is_early_departure,
            raw_duration_minutes = p_raw_duration_minutes,
            lunch_deducted_minutes = p_lunch_deducted_minutes,
            payable_minutes = p_payable_minutes,
            approved_payable_minutes = p_approved_payable_minutes,
            post_6pm_minutes = p_post_6pm_minutes
        WHERE ad.organization_id = p_org_id
          AND ad.employee_id = p_employee_id
          AND ad.attendance_date = p_attendance_date
          AND ad.check_in_at IS NOT NULL
          AND ad.check_out_at IS NULL
        RETURNING ad.id INTO v_day_id;

        IF v_day_id IS NULL THEN
            RAISE EXCEPTION 'CHECK_OUT_WITHOUT_CHECK_IN_OR_COMPLETED' USING ERRCODE = 'P0001';
        END IF;
    ELSE
        RAISE EXCEPTION 'Unsupported punch direction: %', p_punch_direction USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.attendance_events (
        organization_id, attendance_day_id, employee_id, punch_direction, event_type, recorded_at,
        latitude, longitude, accuracy_meters, distance_from_office_meters, location_state,
        face_verification_status, liveness_status, verification_attempt_count,
        employee_comment, selfie_bucket, selfie_path
    ) VALUES (
        p_org_id, v_day_id, p_employee_id, p_punch_direction, p_event_type, p_recorded_at,
        p_latitude, p_longitude, p_accuracy_meters, p_distance_meters, p_location_state,
        p_face_verification_status, p_liveness_status, p_verification_attempt_count,
        p_employee_comment, p_selfie_bucket, p_selfie_path
    )
    RETURNING id INTO v_event_id;

    RETURN QUERY SELECT v_day_id, v_event_id;
END;
$$;

-- 12. Row-Level Security & Least-Privilege Grants
ALTER TABLE public.biometric_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.biometric_enrollments FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_bio_select ON public.biometric_enrollments
    FOR SELECT USING (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR employee_id = public.current_employee_id()));
CREATE POLICY rls_bio_emp_insert ON public.biometric_enrollments
    FOR INSERT WITH CHECK (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR employee_id = public.current_employee_id()));
CREATE POLICY rls_bio_admin_update ON public.biometric_enrollments
    FOR UPDATE USING (organization_id = public.current_org_id() AND public.is_admin_or_super())
    WITH CHECK (organization_id = public.current_org_id() AND public.is_admin_or_super());

ALTER TABLE public.attendance_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_days FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_att_days_select ON public.attendance_days
    FOR SELECT USING (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR employee_id = public.current_employee_id()));
CREATE POLICY rls_att_days_admin_write ON public.attendance_days
    FOR ALL USING (organization_id = public.current_org_id() AND public.is_admin_or_super())
    WITH CHECK (organization_id = public.current_org_id() AND public.is_admin_or_super());

ALTER TABLE public.attendance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_events FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_att_events_select ON public.attendance_events
    FOR SELECT USING (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR employee_id = public.current_employee_id()));
CREATE POLICY rls_att_events_admin_insert ON public.attendance_events
    FOR INSERT WITH CHECK (organization_id = public.current_org_id() AND public.is_admin_or_super());

ALTER TABLE public.face_verification_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.face_verification_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_face_attempts_select ON public.face_verification_attempts
    FOR SELECT USING (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR employee_id = public.current_employee_id()));
CREATE POLICY rls_face_attempts_insert ON public.face_verification_attempts
    FOR INSERT WITH CHECK (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR employee_id = public.current_employee_id()));

ALTER TABLE public.attendance_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_att_ev_select ON public.attendance_evidence
    FOR SELECT USING (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR employee_id = public.current_employee_id()));
CREATE POLICY rls_att_ev_insert ON public.attendance_evidence
    FOR INSERT WITH CHECK (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR employee_id = public.current_employee_id()));

ALTER TABLE public.attendance_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_corrections FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_att_corr_select ON public.attendance_corrections
    FOR SELECT USING (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR employee_id = public.current_employee_id()));
CREATE POLICY rls_att_corr_admin_insert ON public.attendance_corrections
    FOR INSERT WITH CHECK (organization_id = public.current_org_id() AND public.is_admin_or_super());

ALTER TABLE public.idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_records FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_idempotency_actor ON public.idempotency_records
    FOR ALL USING (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR actor_user_id = public.auth_user_id()))
    WITH CHECK (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR actor_user_id = public.auth_user_id()));

ALTER TABLE public.field_duty_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_duty_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_fd_select ON public.field_duty_sessions
    FOR SELECT USING (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR employee_id = public.current_employee_id()));
CREATE POLICY rls_fd_insert ON public.field_duty_sessions
    FOR INSERT WITH CHECK (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR employee_id = public.current_employee_id()));
CREATE POLICY rls_fd_update ON public.field_duty_sessions
    FOR UPDATE USING (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR employee_id = public.current_employee_id()))
    WITH CHECK (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR employee_id = public.current_employee_id()));

ALTER TABLE public.field_duty_gps_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_duty_gps_events FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_fd_gps_select ON public.field_duty_gps_events
    FOR SELECT USING (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR employee_id = public.current_employee_id()));
CREATE POLICY rls_fd_gps_insert ON public.field_duty_gps_events
    FOR INSERT WITH CHECK (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR employee_id = public.current_employee_id()));

ALTER TABLE public.customer_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_visits FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_visits_select ON public.customer_visits
    FOR SELECT USING (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR employee_id = public.current_employee_id()));
CREATE POLICY rls_visits_insert ON public.customer_visits
    FOR INSERT WITH CHECK (organization_id = public.current_org_id() AND (public.is_admin_or_super() OR employee_id = public.current_employee_id()));
CREATE POLICY rls_visits_admin_update ON public.customer_visits
    FOR UPDATE USING (organization_id = public.current_org_id() AND public.is_admin_or_super())
    WITH CHECK (organization_id = public.current_org_id() AND public.is_admin_or_super());

REVOKE ALL ON public.biometric_enrollments, public.attendance_days, public.attendance_events,
    public.face_verification_attempts, public.attendance_evidence, public.attendance_corrections,
    public.idempotency_records, public.field_duty_sessions, public.field_duty_gps_events, public.customer_visits
    FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON public.biometric_enrollments, public.attendance_days,
    public.field_duty_sessions, public.customer_visits, public.idempotency_records TO hrms_app_user;
GRANT SELECT, INSERT ON public.attendance_events, public.face_verification_attempts,
    public.attendance_evidence, public.attendance_corrections, public.field_duty_gps_events TO hrms_app_user;

REVOKE ALL ON FUNCTION hrms_internal.commit_attendance_punch(UUID,UUID,UUID,DATE,TEXT,TEXT,TIMESTAMPTZ,NUMERIC,NUMERIC,NUMERIC,NUMERIC,TEXT,TEXT,TEXT,INTEGER,BOOLEAN,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN,BOOLEAN,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION hrms_internal.commit_attendance_punch(UUID,UUID,UUID,DATE,TEXT,TEXT,TIMESTAMPTZ,NUMERIC,NUMERIC,NUMERIC,NUMERIC,TEXT,TEXT,TEXT,INTEGER,BOOLEAN,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN,BOOLEAN,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER)
    TO hrms_app_user;

REVOKE ALL ON FUNCTION public.trg_guard_attendance_day_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_prevent_attendance_correction_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_validate_field_duty_eligibility() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_validate_gps_event_active_session() FROM PUBLIC, anon, authenticated;
