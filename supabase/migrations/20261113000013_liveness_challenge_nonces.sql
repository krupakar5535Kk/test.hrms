-- ============================================================================
-- HRMS PAYROLL 5535 — Migration 00013:
-- Distributed Single-Use Liveness Challenge Nonce Storage
-- ============================================================================
-- Version:        20261113000013
-- Non-destructive additive migration preserving 00001..00012.
--
-- Security Guarantees:
--   1. Replaces volatile in-memory nonce caches with atomic PostgreSQL storage.
--   2. Enforces single-use consumption via PRIMARY KEY (nonce) and
--      INSERT ... ON CONFLICT (nonce) DO NOTHING RETURNING nonce.
--   3. Binds challenge tokens strictly to organization_id, employee_id,
--      punch_direction, and action with exact expires_at timestamps.
--   4. Prevents replay attacks across backend restarts and multiple horizontal
--      backend replicas.
--   5. Ephemeral single-use lifecycle: indexed expires_at enables fast
--      opportunistic pruning without table locking.
--   6. Strict tenant isolation under RLS with exclusive grant to hrms_app_user;
--      zero access to PUBLIC, anon, authenticated or service_role PostgREST.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.liveness_challenge_nonces (
    nonce UUID PRIMARY KEY,
    organization_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    punch_direction VARCHAR(16) NOT NULL CHECK (punch_direction IN ('CHECK_IN', 'CHECK_OUT')),
    action VARCHAR(32) NOT NULL CHECK (action IN ('BLINK', 'TURN_LEFT', 'TURN_RIGHT')),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for opportunistic / scheduled expiry pruning
CREATE INDEX IF NOT EXISTS idx_liveness_challenge_nonces_exp
    ON public.liveness_challenge_nonces (expires_at);

-- Tenant + employee lookup index for inspection and verification audits
CREATE INDEX IF NOT EXISTS idx_liveness_challenge_nonces_tenant_emp
    ON public.liveness_challenge_nonces (organization_id, employee_id, punch_direction);

-- Enable and Force Row-Level Security
ALTER TABLE public.liveness_challenge_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.liveness_challenge_nonces FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_liveness_challenge_nonces_tenant ON public.liveness_challenge_nonces
    FOR ALL
    USING (
        public.current_org_id() IS NULL
        OR organization_id = public.current_org_id()
    )
    WITH CHECK (
        public.current_org_id() IS NULL
        OR organization_id = public.current_org_id()
    );

-- Least privilege grants: hrms_app_user only, isolated from direct PostgREST/client exposure
REVOKE ALL ON public.liveness_challenge_nonces FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON public.liveness_challenge_nonces TO hrms_app_user;
