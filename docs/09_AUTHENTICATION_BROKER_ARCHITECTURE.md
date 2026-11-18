# HRMS Authentication Broker Architecture Specification (Task 2.2B.1)

**Document Version:** 1.11 (Task 2.2B.9C — Cryptographic Transaction Context Verification & `PO-01`–`PO-07` Approved)  
**Status:** Architecture Specification Only — **`PO-01`–`PO-07` & Initial Account Activation Policy APPROVED / CLOSED (`2026-11-10`); Core Auth Policy Complete; Implementation Pending `DEC-10` SMS Provider, Operational Fallbacks, & `DEC-11` Deployment Topology**  
**Target Modules:** Express API Broker (`server/`), Shared Validation (`shared/`), PostgreSQL Tenant Schema (`supabase/migrations/` 00004+)  
**Approved Baselines Preserved:** `DEC-09` (Supabase Auth Exclusive Authority + Express Broker) & `DEC-13` (Organization Code + Mobile Number + Password Login)  
**Implemented Prerequisites Referenced:** Tasks 1.2–1.3 (`00001`–`00003` migrations), Task 2.1A (`withTenantTransaction`, `hrms_app_user` pool), Task 2.1B (local role credentials), Task 2.2A (`verifySupabaseToken` / `requireAuth` JWKS middleware).

---

## 1. Preserved Authentication Model & Core Security Boundaries

### 1.1 Locked Architectural Baselines (Do Not Redesign)
- **DEC-13 (Approved — Option A):** Employees and Admins authenticate using strictly three fields:
  1. `Organization Code` (2–20 alphanumeric, underscore, or hyphen characters)
  2. `Mobile Number` (canonical normalized phone number)
  3. `Password`
  - **Employees NEVER enter, see, or manage an email address** during login, activation, or password reset.
- **DEC-09 (Approved — Exclusive Password & Token Authority):**
  - **Supabase Auth (GoTrue)** is the exclusive system for password hashing, password verification, session lifecycle, and JWT issuance.
  - **Zero Custom Password Store:** Neither Express nor PostgreSQL `public` schema stores passwords or password hashes.
  - **Zero Custom JWT / Capability Ticket Generation:** Express never mints custom access JWTs, capability tickets, or session tokens. PostgreSQL RLS context relies strictly on verified GoTrue JWT claims mapped to database identity and established transaction-locally via `SELECT set_config('app.current_org_id', $1, true)` (`SET LOCAL`).
  - **1:1 Identity Mapping:** `public.users.id PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE`.
  - **Tenant-Scoped Phone Uniqueness:** `public.users` enforces `CONSTRAINT uq_users_org_phone UNIQUE (organization_id, phone_number)`. The same mobile number **may exist across multiple organizations** as distinct user accounts.
- **Strict Separation from Untrusted Browsers:**
  - Browser-supplied `organization_id`, `organizationId`, `userId`, or role claims in headers, query strings, or bodies are **never trusted** for authorization.
  - Browsers never receive `SUPABASE_SERVICE_ROLE_KEY`, never call Supabase Auth `/auth/v1/*` directly, and never connect directly to PostgreSQL (`hrms_app_user` strictly lacks table mutation privileges).

### 1.2 Admin Password Knowledge Elimination (Task 2.2B.1 Correction)
- Earlier draft specifications (`docs/04_API_SPECIFICATION.md` v1.8 and `docs/02_SOFTWARE_REQUIREMENTS_SPECIFICATION_SRS.md` v1.6 `SRS-FR-AUTH-03`) assumed Administrators would create and deliver temporary passwords to employees upon onboarding or reset.
- **Corrected Design Rule:** **Employees must be able to choose their own password during secure account activation**, and **administrators must never create, view, or know employees' permanent passwords** (and under recommended Token Activation, never know initial credentials either). See Section 6.

---

## 2. Synthetic Email Identity Strategy (`PO-01` / `REC-01` — APPROVED Scheme 3)

### 2.1 Why Synthetic Email Remains Required
Supabase Auth (`auth.users`) cannot represent the same `phone` string across two distinct `auth.users` rows because `auth.users.phone` is globally unique, and local Supabase config ([config.toml](file:///Users/mac/Desktop/HRMS/supabase/config.toml#L263-L303)) disables SMS/phone authentication (`[auth.sms] enabled = false`, `GOTRUE_EXTERNAL_PHONE_ENABLED=false`). Sharing a single `auth.users` row across multiple organizations would break the locked 1:1 `public.users.id = auth.users.id` invariant (`users.organization_id NOT NULL`) and leak password changes, bans, and lockouts across tenants.

### 2.2 Format Evaluation & Approved Scheme (`PO-01` Scheme 3)

| Criterion | Legacy Proposal (Rejected): `<phone>.<org_code>@auth.hrms.internal` | Org-UUID + Phone (Rejected): `<phone>.<org_uuid>@auth.hrms.internal` | **`PO-01` APPROVED (Scheme 3 — 2026-11-10):** `<immutable_uuid>@auth.hrms.internal` |
|---|---|---|---|
| **Mutable Field Coupling** | Coupled to both `phone_number` AND `organization_code` | Coupled to `phone_number` | **Fully decoupled** from mutable phone numbers and organization codes |
| **Phone Number Changes** | Requires distributed 2-system sync (`PG UPDATE` + `GoTrue admin.updateUserById`); split-brain lockout on partial failure | Requires same distributed 2-system sync hazard | **ACID PostgreSQL update only** (`public.users.phone_number`); zero GoTrue email mutation required |
| **Collision Prevention** | Vulnerable to inconsistent phone formatting or `org_code` character collisions | Immune to `org_code` change; still relies on canonical phone formatting | **Guaranteed unique** via immutable CSPRNG UUID generated at provisioning + DB unique constraints |
| **PII Exposure** | Exposes mobile number and org code in GoTrue HTTP logs & JWT telemetry | Exposes mobile number in GoTrue logs | **Zero PII** in GoTrue `email` column or auth logs |
| **Provisioning Retries** | Repeatable if strings normalized | Repeatable if strings normalized | **Strictly idempotent** once generated `synthetic_email` is committed on `account_provisioning_requests` prior to calling GoTrue |

> **Governance Status:** **`PO-01` (`REC-01`) — APPROVED / CLOSED (`2026-11-10`, Scheme 3 `<immutable_uuid>@auth.hrms.internal`).** **`PO-02` — APPROVED / CLOSED (`2026-11-10`, Indian-only E.164 `+91XXXXXXXXXX`).** **`PO-03` — APPROVED / CLOSED (`2026-11-10`, Self-Service Mobile OTP Password Recovery).** **`Initial Account Activation Policy` — APPROVED / CLOSED (`2026-11-10`, Admin link/QR `#token=...` + Mobile OTP + User-Scoped Lock).** **`PO-04` — APPROVED / CLOSED (`2026-11-10`, Auth Login Rate Limiting `5 fails / 15m` + IP limiting + `HTTP 401/429`).** **`PO-05` — APPROVED / CLOSED (`2026-11-10`, Secure HttpOnly Refresh-Token Cookies + CSRF + Strict CORS + Rotation).** **`PO-06` — APPROVED / CLOSED (`2026-11-10`, GoTrue Configuration Alignment `enable_signup=false`, `jwt_expiry=900`, `minimum_password_length=8`, `enable_confirmations=false`).** **`PO-07` — APPROVED / CLOSED (`2026-11-10`, Concurrent Device Sessions Allowed + No Initial Cap + `user_sessions` / `revoked_sessions` / `tokens_valid_after_epoch`).** `DEC-10` (commercial SMS provider & DLT) remains **OPEN** pending formal Product Owner approval.

### 2.3 Identity Mapping, Uniqueness Constraints & Lifecycle (`<immutable_uuid>@auth.hrms.internal`)
1. **Strict Internal Scope & Non-Exposure:** `synthetic_email` is exclusively an internal technical identifier used by the Express backend to integrate with Supabase Auth email/password authentication. Employees **must NEVER be asked to enter an email address** (login remains `Organization Code + Mobile Number + Password`). All frontend and backend components must **never expose `synthetic_email` in employee-facing UI, API responses (`LoginResponseData`, `/auth/me`, etc.), plaintext/structured logs, error messages, or payslips**. *(Note: `GET /api/v1/auth/me` must sanitize `rawTokenClaims` and omit synthetic email fields when wired.)*
2. **Independence from Client-Supplied `id` Support:** Rather than assuming whether GoTrue `admin.createUser` honors a pre-supplied `id` UUID, the provisioning worker:
   - Generates `v_handle_uuid = crypto.randomUUID()` -> `synthetic_email = "${v_handle_uuid}@auth.hrms.internal"`.
   - Commits `synthetic_email` onto `account_provisioning_requests` *before* calling GoTrue.
   - Calls `admin.createUser({ email: synthetic_email, ... })`; GoTrue returns authoritative `auth.users.id`.
   - Persists `public.users` with `id = auth.users.id` (1:1 PK/FK) and `synthetic_email = synthetic_email` (`VARCHAR(255) UNIQUE NOT NULL`).
3. **Database Uniqueness Guarantees:**
   - `auth.users.email`: unique constraint inside GoTrue schema.
   - `public.users.id`: `PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE`.
   - `public.users.synthetic_email`: `UNIQUE NOT NULL` constraint.
   - `public.users (organization_id, phone_number)`: `CONSTRAINT uq_users_org_phone UNIQUE`.
4. **Immutable Lifecycle:** Once created, `synthetic_email` never mutates across employee role changes, mobile number changes, temporary deactivation, or activation resets. Only permanent account deletion (`auth.admin.deleteUser`) removes it via `ON DELETE CASCADE` (blocked if historical payroll/provisioning FKs `ON DELETE RESTRICT` exist; terminated employees remain soft-deactivated via `is_active = FALSE` + GoTrue ban).

---

## 3. Pre-Authentication Identity Lookup (`resolve_login_identity`)

During `POST /api/v1/auth/login`, no JWT exists yet, and `public.users` enforces `ALTER TABLE users FORCE ROW LEVEL SECURITY` (`USING (organization_id = current_org_id())`). Rather than setting `app.current_org_id` pre-authentication (which mixes unauthenticated lookup state with tenant RLS GUC state), Express must use a narrow, minimal-projection database routine.

### 3.1 Function Signature & Specification
```sql
CREATE OR REPLACE FUNCTION hrms_internal.resolve_login_identity(
    p_organization_id UUID,
    p_phone_number TEXT
)
RETURNS TABLE (
    user_id UUID,
    synthetic_email VARCHAR(255)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT
        u.id AS user_id,
        u.synthetic_email
    FROM public.users u
    INNER JOIN public.organizations o
        ON o.id = u.organization_id
    WHERE p_organization_id IS NOT NULL
      AND p_phone_number IS NOT NULL
      AND o.id = p_organization_id
      AND u.organization_id = p_organization_id
      AND u.phone_number = p_phone_number
      AND o.is_active = TRUE
      AND u.is_active = TRUE
      AND u.activated_at IS NOT NULL
    LIMIT 1;
$$;
```

### 3.2 Exact Security, Password-Setup & Behavior Rules
1. **Inputs:**
   - `p_organization_id`: Authoritative UUID resolved server-side from `resolve_organization_by_code(orgCode)` — never client input.
   - `p_phone_number`: Server-normalized canonical Indian mobile number (`+91XXXXXXXXXX`, `^\+91[6-9][0-9]{9}$`, approved `PO-02`) matching Migration `00004` `chk_users_phone_format`.
2. **Minimal Output, Zero Existence Indicators & Secret Shielding:**
   - Joins `public.users u` with `public.organizations o ON o.id = u.organization_id`.
   - Enforces strict fail-closed filtering inside the query:
     ```sql
     WHERE p_organization_id IS NOT NULL
       AND p_phone_number IS NOT NULL
       AND o.id = p_organization_id
       AND u.organization_id = p_organization_id
       AND u.phone_number = p_phone_number
       AND o.is_active = TRUE
       AND u.is_active = TRUE
       AND u.activated_at IS NOT NULL
     LIMIT 1;
     ```
   - **Zero Information For Inactive / Unactivated / Non-Existent Accounts:** For missing organizations, inactive organizations (`o.is_active = FALSE`), missing users, inactive/deactivated employees (`u.is_active = FALSE`), or pending-activation accounts (`u.activated_at IS NULL`), `hrms_internal.resolve_login_identity()` returns **ZERO ROWS** (no `user_id`, no `synthetic_email`, no `is_active`, and **no redundant `account_exists` boolean**).
   - Never returns employee profile PII, phone numbers, roles, bank flags, or organization details.
   - Express consumes `synthetic_email` solely in memory to invoke GoTrue `signInWithPassword` and **never exposes `synthetic_email` to callers, HTTP responses, or logs**.
3. **Why `must_change_password` Exists & How It Aligns With Employee-Selected Activation Passwords:**
   - Migration `00002` and [`AuthUser`](file:///Users/mac/Desktop/HRMS/shared/src/auth/contracts.ts#L43-L48) (`mustChangePassword: boolean`) define `must_change_password` on `public.users`. Because employees now choose their own permanent password during secure activation (`POST /api/v1/auth/activate`) rather than receiving an Admin-created temporary password, **newly activated users do NOT need a second `/first-login-change` hop** after activation:
     - *Pending Activation (`activated_at IS NULL`, `must_change_password = TRUE`):* Account has only an ephemeral discarded GoTrue placeholder secret. `resolve_login_identity()` returns 0 rows so pre-activation login attempts are blocked cleanly until activation completes.
     - *Activated (`activated_at = NOW()`, `must_change_password = FALSE`):* Completed atomically inside `POST /api/v1/auth/activate` once the employee chooses their own private password. Standard login succeeds directly.
     - *Exceptional Post-Activation Rotation (`activated_at IS NOT NULL`, `must_change_password = TRUE`):* Retained strictly for compliance-mandated password rotation on already-activated accounts (or legacy/test accounts explicitly flagged for forced change). Checked post-authentication inside `withTenantTransaction` (`resolveTenantContext`), enforcing `403 MUST_CHANGE_PASSWORD` until rotated via `/auth/first-login-change`.
4. **Cross-Tenant Isolation & Multi-Predicate Scoping:**
   - **Signature:** `hrms_internal.resolve_login_identity(p_organization_id UUID, p_phone_number TEXT)` (referenced as `resolve_login_identity()` in high-level architecture diagrams).
   - **Mandatory Tenant-Scoped Predicate:**
     - Requires `p_organization_id IS NOT NULL AND p_phone_number IS NOT NULL`, joining `public.users u` to `public.organizations o` with explicit equality filters `o.id = p_organization_id AND u.organization_id = p_organization_id AND u.phone_number = p_phone_number`.
     - Requires active, activated state: `o.is_active = TRUE AND u.is_active = TRUE AND u.activated_at IS NOT NULL`.
     - **Why cross-tenant enumeration via this lookup is blocked:** The query never performs cross-tenant scans or phone-only lookups, leverages `uq_users_org_phone (organization_id, phone_number)`, and accepts `p_organization_id` exclusively from server-side `resolve_organization_by_code()` (`DEC-13` — Express never passes browser-supplied org UUIDs). For missing orgs, inactive orgs, missing phones, inactive users, or unactivated accounts (`activated_at IS NULL`), the function returns **0 rows** (zero existence booleans or status flags).

5. **Least-Privilege Function Ownership (`hrms_auth_lookup_owner`), Existing Supabase Roles & Feasibility:**
   - **Inspection of Existing Local Role Model (`00001`–`00003` & `supabase/config.toml`):**
     - [`20261109000001_foundation_types_extensions.sql`](file:///Users/mac/Desktop/HRMS/supabase/migrations/20261109000001_foundation_types_extensions.sql#L23-L35) defines **`hrms_schema_owner`** (`NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`, default **`NOBYPASSRLS`**) and **`hrms_app_user`** (`LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`).
     - [`20261109000002_organizations_and_users.sql`](file:///Users/mac/Desktop/HRMS/supabase/migrations/20261109000002_organizations_and_users.sql#L62-L147) enforces `FORCE ROW LEVEL SECURITY` on `public.users` (`USING (organization_id = current_org_id())`), while keeping `resolve_organization_by_code()` `postgres`-owned (and omitting `FORCE RLS` on `public.organizations`).
     - [`supabase/config.toml`](file:///Users/mac/Desktop/HRMS/supabase/config.toml#L14-L42) configures PostgreSQL `major_version = 17` and PostgREST `schemas = ["public", "graphql_public"]`.
     - **Why `hrms_schema_owner` Is NOT Reused:** `hrms_schema_owner` lacks `BYPASSRLS`, so under `users` `FORCE ROW LEVEL SECURITY` it returns 0 rows before `app.current_org_id` is set; conversely, granting `BYPASSRLS` to the broad `hrms_schema_owner` role would over-privilege all future schema-owned routines.
   - **Selected Primary Ownership Model (Dedicated Non-Login Role in Private Schema `hrms_internal`):**
     Instead of assigning ownership to `postgres` (`SUPERUSER` locally; `CREATEROLE`/`CREATEDB`/`BYPASSRLS` + `public` table owner on hosted Supabase) or modifying `hrms_schema_owner`, **proposed Migration `00004`** isolates `resolve_login_identity()` under a dedicated single-purpose non-login role **`hrms_auth_lookup_owner`**:
     ```sql
     -- PROPOSED FUTURE MIGRATION 00004 (PO-01..PO-07 & ACTIVATION POLICY APPROVED; PENDING DEC-10)
     CREATE ROLE hrms_auth_lookup_owner
         WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;

     -- Allow non-superuser migration runner (hosted postgres) to transfer ownership without inheriting privileges:
     GRANT hrms_auth_lookup_owner TO postgres WITH SET TRUE, INHERIT FALSE;

     -- Private schema excluded from PostgREST config.toml api.schemas ("public", "graphql_public"):
     CREATE SCHEMA IF NOT EXISTS hrms_internal AUTHORIZATION postgres;
     REVOKE ALL ON SCHEMA hrms_internal FROM PUBLIC, anon, authenticated, service_role;
     GRANT USAGE ON SCHEMA hrms_internal TO hrms_app_user;
     -- Prevent default PUBLIC EXECUTE grants on newly created functions in hrms_internal:
     ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA hrms_internal REVOKE ALL ON FUNCTIONS FROM PUBLIC;
     -- Target owner MUST hold CREATE on function's schema for ALTER FUNCTION ... OWNER TO (avoiding Migration 00002 SQLSTATE 42501 on public):
     GRANT USAGE, CREATE ON SCHEMA hrms_internal TO hrms_auth_lookup_owner;
     ```
   - **Why `BYPASSRLS` Is Safe on `hrms_auth_lookup_owner`:**
     - `public.users` enforces `FORCE ROW LEVEL SECURITY` (Migration `00002`), meaning any role with `NOBYPASSRLS` (even a table owner) is filtered by `rls_users_select` unless a dedicated lookup policy permits it or the role holds `BYPASSRLS`.
     - In PostgreSQL, object-level ACLs (`GRANT`/`REVOKE`) execute **before** RLS row filters. `BYPASSRLS` **only** skips RLS row policies on tables where the role already possesses explicit SQL `GRANT` privileges; it grants **zero** access to ungranted tables, **zero** DML mutations, **zero** DDL capability, and **zero** access to `auth.users`.
     - Combined with `NOLOGIN`, `NOSUPERUSER`, `NOINHERIT`, strict schema/column-level grants, and zero `public` schema `CREATE` rights, `hrms_auth_lookup_owner` cannot authenticate to PostgreSQL, cannot mutate any record, and cannot read employee profiles, payroll, attendance, roles, tokens, **sessions (`public.user_sessions`, `public.revoked_sessions`)**, provisioning tables, or audit logs even if a bug existed inside a routine it owns. **`hrms_auth_lookup_owner` MUST NEVER be expanded for `PO-07` session management; session operations use a separate dedicated `NOLOGIN NOBYPASSRLS` role (`hrms_session_manager`, Section 9.6.7).**
   - **Strict Least-Privilege Permission Matrix (`hrms_auth_lookup_owner`):**
     ```sql
     GRANT USAGE ON SCHEMA public TO hrms_auth_lookup_owner;
     REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hrms_auth_lookup_owner;
     REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM hrms_auth_lookup_owner;

     -- Column-level SELECT ONLY (excludes org codes/names/retention config, user tokens_valid_after_epoch, etc.):
     GRANT SELECT (id, is_active)
         ON public.organizations TO hrms_auth_lookup_owner;
     GRANT SELECT (id, organization_id, phone_number, synthetic_email, is_active, activated_at, phone_verified_at)
         ON public.users TO hrms_auth_lookup_owner;
     -- Zero privileges (REVOKE ALL) on public.user_sessions, public.revoked_sessions, user_roles, employees,
     -- payroll_*, attendance_*, account_provisioning_*, account_activation_tokens, password_reset_otps, audit_logs, or auth.*.
     -- Zero INSERT, UPDATE, DELETE, TRUNCATE anywhere.
     ```
   - **Function Hardening & Exclusive Execution Grants:**
     - Defined as `STABLE`, `SECURITY DEFINER`, **`SET search_path = pg_catalog, public`**, pure static parameterized SQL (`SELECT ...` only — no `EXECUTE` dynamic SQL, no side effects, all table references schema-qualified as `public.users` and `public.organizations`).
     - Owns **strictly** the three minimal identity-resolution routines requiring pre-tenant user/org resolution:
       1. `hrms_internal.resolve_login_identity(p_organization_id UUID, p_phone_number TEXT)` -> `(user_id, synthetic_email)`
       2. `hrms_internal.resolve_recovery_identity(p_organization_id UUID, p_phone_number TEXT)` -> `(user_id)`
       3. `hrms_internal.resolve_auth_user_tenant(p_auth_user_id UUID)` -> `(user_id, organization_id, org_is_active, user_is_active, is_activated)` *(Reads ONLY existing granted `users` / `organizations` columns so Step 2 `verify_authenticated_session_and_roles` executes entirely inside `SET LOCAL app.current_org_id` as `NOBYPASSRLS` `hrms_session_manager` — adding ZERO privileges to `hrms_auth_lookup_owner`!)*
     - Created inside transaction with immediate privilege lockdown:
       ```sql
       REVOKE ALL ON FUNCTION hrms_internal.resolve_login_identity(UUID, TEXT)
           FROM PUBLIC, anon, authenticated, service_role;
       GRANT EXECUTE ON FUNCTION hrms_internal.resolve_login_identity(UUID, TEXT)
           TO hrms_app_user;
       ALTER FUNCTION hrms_internal.resolve_login_identity(UUID, TEXT)
           OWNER TO hrms_auth_lookup_owner;
       -- Identical REVOKE FROM PUBLIC / GRANT EXECUTE TO hrms_app_user / OWNER TO hrms_auth_lookup_owner
       -- applied to resolve_recovery_identity(UUID, TEXT) and resolve_auth_user_tenant(UUID).
       ```
     - *(Note: Existing implemented Migration `00002` `public.resolve_organization_by_code(TEXT)` remains `postgres`-owned on `public.organizations` (which holds no secrets/PII and omits `FORCE RLS`); proposed future `00004` session management routines run under dedicated `NOLOGIN NOBYPASSRLS` `hrms_session_manager` (Section 9.6.7), and other state-mutating broker procedures such as `complete_account_activation()` will use equivalent narrow least-privilege role separation during Task 2.2C rather than `postgres` ownership.)*
   - **Supabase Feasibility & Mandatory Fallback Hierarchy (Verified in Task 2.2C):**
     - Local Supabase (`config.toml` `major_version = 17`) runs `postgres` as `SUPERUSER` and permits `CREATE ROLE ... BYPASSRLS` and `ALTER FUNCTION ... OWNER TO` natively. Hosted managed Supabase runs `postgres` as `NOSUPERUSER` (`CREATEROLE`, `CREATEDB`, `BYPASSRLS`, governed by `supautils`); PG 16/17 natively permits `CREATEROLE + BYPASSRLS` delegation unless restricted by hosted `supautils` cluster rules.
     - Therefore Task 2.2C pre-flight testing against the target hosted PostgreSQL cluster selects strictly in priority order:
       1. **Tier 1 (Preferred — Primary Design above):** `hrms_auth_lookup_owner` (`NOLOGIN`, `BYPASSRLS`, column-level `SELECT`) in `hrms_internal` — zero changes to existing `00002` RLS policies, pure `STABLE` read-only execution.
       2. **Tier 2 (Zero-`BYPASSRLS` Dedicated Alternative — if hosted `supautils` blocks creating custom `BYPASSRLS` roles):** Create `hrms_auth_lookup_owner` with **`NOBYPASSRLS`** + identical column-level `SELECT` grants in `hrms_internal`, and add two narrow permissive lookup RLS policies scoped strictly `TO hrms_auth_lookup_owner` matching transaction-local internal GUCs (`app.login_lookup_org_id`, `app.login_lookup_phone` coerced fail-closed via `NULLIF(pg_catalog.current_setting(..., true), '')`). Make the function `VOLATILE SECURITY DEFINER` so it sets both GUCs from its validated parameters immediately prior to `SELECT` and clears both before returning. This avoids `BYPASSRLS` entirely while keeping `rls_users_select` for `hrms_app_user` unchanged.
       3. **Tier 3 (Hardened `postgres`-Owned Fallback — ONLY if managed Supabase prohibits non-superuser ownership transfer on `SECURITY DEFINER` routines):** Retain `postgres` ownership with static parameterized `SELECT`, `SET search_path = pg_catalog, public`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO hrms_app_user`, and explicit acceptance in the security register that any future SQL logic defect inside the routine executes with `postgres` `CREATEROLE`/`CREATEDB`/`BYPASSRLS` and `public` table-owner privileges.

6. **Anti-Enumeration:** Whenever `resolve_organization_by_code` returns 0 rows OR `hrms_internal.resolve_login_identity` returns 0 rows, Express follows the timing-mitigation path (Section 8.3) and returns identical HTTP `401 INVALID_CREDENTIALS`.

### 3.3 Compromised Application Database Credential (`hrms_app_user`) Blast-Radius Analysis
Because `hrms_app_user` holds `GRANT EXECUTE` on pre-auth lookups and runtime application access, credential exposure (e.g., leaked `DATABASE_URL`) creates distinct, bounded impacts:
- **Strictly Prevented (Enforced by PostgreSQL Role & ACL Boundaries):**
  1. **Zero Role Escalation:** `hrms_app_user` is `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT` and has zero `SET ROLE` grants on `postgres`, `hrms_schema_owner`, `hrms_auth_lookup_owner`, or `hrms_session_manager`.
  2. **Zero Foundation/Identity/Session/Audit Mutation:** Direct `INSERT`, `UPDATE`, `DELETE`, `SELECT`, and `TRUNCATE` privileges on sensitive auth/session tables (proposed `account_activation_tokens`, `password_reset_otps`, `user_sessions`, `revoked_sessions`) and direct mutation privileges on `organizations`, `users`, `user_roles`, `account_provisioning_*`, and `audit_logs` are revoked from `hrms_app_user` (`audit_logs` remains strictly `INSERT`/`SELECT` only).
  3. **Zero Password Hash / GoTrue Access:** `auth.users` (`encrypted_password`, recovery state) and GoTrue `auth.sessions`/`auth.refresh_tokens` are inaccessible to `hrms_app_user`, `hrms_auth_lookup_owner`, and `hrms_session_manager`.
  4. **Zero Unrelated Domain Leakage via `hrms_auth_lookup_owner`:** Calling pre-auth identity lookups cannot access `employees`, `payroll_*`, `attendance_*`, `user_sessions`, `revoked_sessions`, `user_roles`, or ungranted user/organization columns.
- **Residual Blast Radius Under Raw `hrms_app_user` SQL Compromise:**
  1. **Tenant & Actor GUC Spoofing Blocked on Session Operations (Task 2.2B.9C):** As already documented in Migration `00001` (`current_org_id()` and `auth_user_id()`), custom PostgreSQL GUCs are **unsigned transaction-local strings** at the SQL engine layer, so an attacker holding direct SQL access as `hrms_app_user` can execute `SET LOCAL app.current_org_id` / `SET LOCAL app.current_user_id` freely. Consequently, **every `hrms_session_manager` `SECURITY DEFINER` function MUST verify a cryptographically signed, transaction-bound `p_tx_proof` via `hrms_context_verifier` (`hrms_internal.assert_verified_tx_context`, Section 9.6.8)** rather than trusting GUCs alone. Raw `hrms_app_user` SQL sessions lacking `TX_CONTEXT_HMAC_KEY` cannot forge `p_tx_proof` and fail closed with `SQLSTATE 42501`. Express writes GUCs via [`withTenantTransaction`](file:///Users/mac/Desktop/HRMS/server/src/db/transaction.ts#L64-L93) strictly after JWT verification (`verifySupabaseToken`), obtains a per-transaction `pg_current_xact_id()` + `challenge_nonce` from `hrms_internal.issue_tx_challenge()`, and signs `p_tx_proof`; PostgreSQL still cross-checks GUCs, org membership, active/activated status, and `public.user_roles`. Non-session Migration `00001`–`00003` tenant RLS helpers retain baseline GUC behavior unless explicitly extended to require `p_tx_proof`.
  2. **Unthrottled Lookup Oracle:** Bypassing Express rate limits, raw SQL access as `hrms_app_user` can call `resolve_organization_by_code()` to resolve org UUIDs and probe `hrms_internal.resolve_login_identity(org_uuid, guessed_phone)` to discover matching `user_id` + opaque `synthetic_email` pairs (`<immutable_uuid>@auth.hrms.internal`) for active, activated accounts (still exposing zero passwords, roles, names, session tokens, or payroll data).
- **Mandatory Compensating Controls:** Bind PostgreSQL network ingress strictly to private VPC / application host IPs (zero direct browser/frontend PostgreSQL access), store `hrms_app_user` credentials and `TX_CONTEXT_HMAC_KEY` strictly in server runtime secret storage (never inside GUCs or readable tables), rotate keys on any suspected exposure, and alert on `SQLSTATE 42501` verification failures and anomalous lookup/session execution rates.

---

## 4. JWT Precision, Session Revocation & Actual GoTrue Correctness

### 4.1 Identified Defect in Initial Task 2.2B Draft (`iat` Sub-Second Precision Bug)
In the Task 2.2B draft, setting `public.users.tokens_valid_after = NOW()` (microsecond `TIMESTAMPTZ` precision in PostgreSQL) and comparing against GoTrue JWT `iat` (standard RFC 7519 **integer seconds**, e.g. `Math.floor(epochMs / 1000)`) creates two severe edge-case defects:
1. **False Rejection / Self-Lockout Bug:** If a user changes password at `14:00:05.820Z` and Express stores `tokens_valid_after = 1794319205.82`, any new JWT minted by GoTrue at `14:00:05.850Z` carries `iat = 1794319205`. Strict `iat < tokens_valid_after` (`1794319205 < 1794319205.82`) erroneously rejects the freshly minted valid token!
2. **Same-Second Bypass & Clock-Skew Window:** Conversely, using `floor(tokens_valid_after)` allows an attacker token minted at `14:00:05.100Z` (`iat = 1794319205`) to bypass revocation issued at `14:00:05.500Z` (`floor = 1794319205`) during the remainder of that second, or longer if clock skew exists between the GoTrue container/service and PostgreSQL server!

### 4.2 Corrected Revocation & Precision Architecture

#### A. What GoTrue `v2.197.0` Actually Provides (Verified vs Unverified)
- **Verified locally (observed in Task 2.2A live JWT inspection):** GoTrue `v2.197.0` mints `ES256` access tokens containing `"sub"` (user UUID), `"iat"` (integer Unix seconds), `"exp"` (integer Unix seconds), `"aud": "authenticated"`, and `"session_id"` (UUID identifying the specific GoTrue session in `auth.sessions`). Local `config.toml` specifies `jwt_expiry = 3600` (1h), `enable_refresh_token_rotation = true`, `refresh_token_reuse_interval = 10`s.
- **Must Be Live-Verified Before Production Claims (Task 2.2H):**
  1. Exact GoTrue REST/Admin SDK semantics in `v2.197.0` for `auth.admin.signOut(jwt, 'global' | 'local' | 'others')` and `auth.admin.updateUserById(id, { ban_duration })` (e.g., confirming whether bans cleanly block `refresh_token` grants with HTTP 401/403).
  2. Whether GoTrue `v2.197.0` exposes any server-side Admin call to terminate a *different* device's `session_id` directly when Express does not hold that remote device's JWT (under approved `PO-07`, Express blocks remote revoked sessions proactively on BOTH protected API calls via `revoked_sessions`/`user_sessions` AND `/auth/refresh` via `refresh_token_hmac` check, plus lazily calls `admin.signOut(jwt, 'local')` if a revoked session still holds a bearer JWT; live Task `2.2H` confirms whether an eager remote GoTrue call is also supported).
  3. Exact `auth.refreshSession({ refresh_token })` response and reuse-detection trigger semantics under `refresh_token_reuse_interval = 10`s when multi-tab concurrent refresh calls arrive in quick succession vs. delayed token-theft replay.

#### B. Honest Distinction: Access Token Validity vs Refresh Revocation (`PO-07` Enforced)
1. **Refresh Tokens (Statefully Checked at Express Broker & GoTrue):**
   - Revoking sessions in GoTrue (`admin.signOut` / user ban) combined with pre-GoTrue `public.user_sessions` revocation checks (`refresh_token_hmac`, `revoked_at IS NULL`) and `users.is_active` / `organizations.is_active` checks inside Express `POST /api/v1/auth/refresh` immediately prevents refresh-token renewal upon individual session revocation, global logout, password change, reset, admin revocation, or account deactivation — **even when GoTrue itself has not yet seen a remote device's JWT**.
2. **Already-Issued Access Tokens (`ES256` Stateless JWTs):**
   - Revoking a refresh token in GoTrue does **NOT** automatically invalidate an already-issued stateless GoTrue access JWT before `exp` (`3600s` currently in local `config.toml`; **`PO-06` approved `900s` / 15 minutes** to apply in Task `2.2C`).
   - **How Express Enforces Immediate Revocation (`resolveTenantContext`, PO-07 & Tasks 2.2B.9A–C):** Rather than querying `public.user_sessions` or `public.revoked_sessions` through `hrms_auth_lookup_owner` (`BYPASSRLS`), `resolveTenantContext` executes a strict **multi-boundary sequence** on every protected request after `requireAuth` (`verifySupabaseToken` cryptographically validates JWT signature/claims) with zero positive revocation caching:
     - *Step 1 (`hrms_auth_lookup_owner` — Identity/Org Resolution ONLY):* Calls `hrms_internal.resolve_auth_user_tenant(sub)` using ONLY pre-existing granted columns on `public.users` (`id, organization_id, is_active, activated_at`) and `public.organizations` (`id, is_active`) — zero access to session tables, roles, `tokens_valid_after_epoch`, or signing keys. Inside [`withTenantTransaction`](file:///Users/mac/Desktop/HRMS/server/src/db/transaction.ts#L64-L93), Express binds `SET LOCAL app.current_org_id = resolved_org_id` AND `SET LOCAL app.current_user_id = sub` strictly transaction-locally, then calls `hrms_internal.issue_tx_challenge()` (`hrms_context_verifier`) to obtain `(tx_xid, challenge_nonce)` for the active PostgreSQL transaction and signs `p_tx_proof` (`op = 'VERIFY_SESSION'`, `org_id = resolved_org_id`, `actor_user_id = sub`, `session_id = session_id`, `target_id = session_id`) with `TX_CONTEXT_HMAC_KEY`.
     - *Step 2 (`hrms_session_manager` (`NOLOGIN NOBYPASSRLS`) + `hrms_context_verifier` — Enforced Strictly Under `FORCE RLS`):* Calls `hrms_internal.verify_authenticated_session_and_roles(p_tx_proof, session_id, iat)`. The function FIRST invokes `hrms_internal.assert_verified_tx_context(p_tx_proof, 'VERIFY_SESSION', session_id::TEXT)` (`hrms_context_verifier`) to verify HMAC signature, `pg_current_xact_id()`, single-use `challenge_nonce`, TTL, and exact GUC match (`resolved_org_id` / `sub`) before touching any table, and THEN checks three unambiguous controls (with zero caller-supplied `p_actor_user_id`):
       1) **Immediate Deactivation / Org Suspension:** `users.is_active = TRUE AND organizations.is_active = TRUE`. Terminated users or deactivated tenants fail immediately on their next API call regardless of remaining JWT `exp`.
       2) **Per-Session Revocation (`public.revoked_sessions` + `public.user_sessions.revoked_at`):** Rejects if verified GoTrue `"session_id"` appears in `public.revoked_sessions` or its `public.user_sessions` row has `revoked_at IS NOT NULL` or `expires_at <= NOW()`. On **individual session revocation** (`DELETE /api/v1/auth/sessions/:sessionId`, `/logout` `'local'`, or scoped reuse revocation), **ONLY that single `user_sessions` row and its single `gotrue_session_id` in `revoked_sessions` are marked**; `public.users.tokens_valid_after_epoch` and all sibling device sessions remain untouched!
       3) **User-Wide Cutoff Epoch (`public.users.tokens_valid_after_epoch`):** Reserved strictly for **revoke-all flows** (employee `revoke-all`, global `/logout`, password change/OTP reset, admin session revocation, or account deactivation), advancing `tokens_valid_after_epoch = EXTRACT(EPOCH FROM date_trunc('second', NOW()))::BIGINT + 1` alongside bulk session revocation so every prior JWT across all devices with `iat < tokens_valid_after_epoch` fails immediately (`401 SESSION_REVOKED`) until fresh `/login`.

### 4.3 GoTrue Configuration Alignment (`PO-06` APPROVED / CLOSED — 2026-11-10)

#### A. Approved Settings vs. Inspected Environment Evidence
*(Local values below were directly inspected in [`supabase/config.toml`](file:///Users/mac/Desktop/HRMS/supabase/config.toml#L167-L268). Hosted Supabase project settings cannot be inspected from the local repository and are explicitly marked **UNVERIFIED** — no config edits have been applied yet.)*

| Setting | Approved Policy (`PO-06`) | Local [`supabase/config.toml`](file:///Users/mac/Desktop/HRMS/supabase/config.toml#L167-L268) *(Inspected)* | Hosted Supabase GoTrue *(Status)* | Required Task `2.2C` Alignment Work |
|---|---|---|---|---|
| **Public Signup** | **Disabled** (`enable_signup = false`) | Line 178: **`enable_signup = true`** *(Mismatch)* | **UNVERIFIED** (Must disable in hosted Auth Providers) | Set `enable_signup = false` locally & on hosted project; update [`jwt-verification.test.ts`](file:///Users/mac/Desktop/HRMS/server/tests/jwt-verification.test.ts) fixture creation from `/signup` to `admin.createUser`. |
| **JWT Expiry** | **`900` seconds** (15 minutes) | Line 167: **`jwt_expiry = 3600`** *(Mismatch)* | **UNVERIFIED** (Default hosted value is typically `3600`s; verify & set to `900`s) | Set `jwt_expiry = 900` locally & on hosted dashboard to align with `expiresIn: 900` in API contracts (`PO-05`). |
| **Minimum Password Length** | **`8` characters** | Line 184: **`minimum_password_length = 6`** *(Mismatch)* | **UNVERIFIED** (Must set to `8` on hosted project + verify complexity alignment) | Set `minimum_password_length = 8` locally & on hosted Auth settings. |
| **Email Confirmation** | **Disabled** (`enable_confirmations = false`) | Line 224/229: `[auth.email] enabled = true`, **`enable_confirmations = false`** *(Aligned)* | **UNVERIFIED** (Must confirm OFF on hosted Email Provider) | Preserve `enable_confirmations = false` locally & ensure OFF on hosted project (alongside `email_confirm: true` on `admin.createUser`). |
| **Refresh-Token Rotation** | **Enabled** (`true`) | Line 173: **`enable_refresh_token_rotation = true`** *(Aligned)* | **UNVERIFIED** (Must confirm ON on hosted Auth settings) | Preserve `true` locally and verify enabled on hosted project. |
| **Refresh-Token Reuse Detection** | **Enabled** | Line 176: **`refresh_token_reuse_interval = 10`** *(Enabled locally alongside rotation)* | **UNVERIFIED** (Hosted controls rotation + reuse detection toggle; exact interval configurability to be checked at hosted deploy) | Preserve enabled locally & verify hosted reuse detection behavior in pre-prod. |
| **External Phone Auth** | **Disabled** | Line 266/268: `[auth.sms] enabled = false`, `enable_confirmations = false` *(Aligned)* | **UNVERIFIED** (Must remain OFF) | Preserve disabled so Express handles Indian mobile auth (`PO-01`/`PO-02`). |
| **Employee Auth Path** | **Express Authentication Broker ONLY** | No frontend GoTrue SDK or `SERVICE_ROLE` exposure; `[auth.rate_limit] sign_in_sign_ups = 30` per IP (Line 209) | **UNVERIFIED** (Hosted GoTrue enforces platform Auth IP rate limits; verify forwarding/proxy headroom during deploy) | Zero frontend GoTrue calls; Express throttles upstream (`PO-04`) and verifies GoTrue forwarding behavior in Task `2.2H`. |

#### B. Mandatory Security Safeguards (`PO-06`)
1. **Admin Provisioning Unaffected by `enable_signup = false`:** Disabling public `/auth/v1/signup` blocks untrusted self-registration while keeping privileged server-side `supabaseAdmin.auth.admin.createUser()` operational via `SUPABASE_SERVICE_ROLE_KEY`.
2. **Email Confirmation Disabled $\ne$ Bypassing Activation:** Setting `[auth.email] enable_confirmations = false` simply prevents GoTrue from emailing non-routable `<immutable_uuid>@auth.hrms.internal` synthetic addresses (`PO-01` Scheme 3). **HRMS employee activation remains strictly gated:** newly provisioned users start with `activated_at IS NULL`, `phone_verified_at IS NULL`, `must_change_password = TRUE`, and an unshared 256-bit ephemeral secret in RAM; `resolve_login_identity()` returns **0 rows** while `activated_at IS NULL`.
3. **Full Activation Workflow Preserved:** Employee activation continues to require the Admin-generated activation link/QR fragment (`#token=...`), mobile SMS OTP verification (`+91XXXXXXXXXX`, `PO-02`), and employee-chosen password ($\ge 8$ chars, `activation_lock_state` single-flight protected).
4. **Scheme 3 & Login UX Preserved:** Employees log in strictly via `Organization Code + Mobile Number + Password` (`DEC-13`), never entering or seeing email addresses.
5. **Credential Isolation:** `SUPABASE_SERVICE_ROLE_KEY` and Supabase Admin API calls remain isolated inside Express backend runtime secrets and are never exposed to browsers.
6. **JWT, Issuer, Audience & JWKS Parity:** Setting `jwt_expiry = 900` aligns local/hosted GoTrue `exp` claims with [`jwtVerifier.ts`](file:///Users/mac/Desktop/HRMS/server/src/auth/jwtVerifier.ts) verification (which validates `ES256`/JWKS signatures, `iss`, `aud: "authenticated"`, `sub`, and `exp`) and seamlessly pairs with `PO-05` memory-only access tokens (`expiresIn: 900`) and `HttpOnly` cookie rotation.

---

## 5. Idempotent Account Provisioning & Verified Recovery Workflow

### 5.1 Preserving Migration `00003` Governance Invariants
All provisioning builds strictly on existing tables in [20261109000003_roles_and_provisioning.sql](file:///Users/mac/Desktop/HRMS/supabase/migrations/20261109000003_roles_and_provisioning.sql):
- **Status Enum (`provisioning_status_enum`):** `'SUBMITTED'`, `'APPROVED'`, `'REJECTED'`, `'PROCESSING'`, `'COMPLETED'`, `'FAILED'`, `'CANCELLED'`. *(Note: Does NOT invent `'POISON_FAILED'`; permanent failures after `MAX_RETRIES = 5` terminate cleanly in `'FAILED'`.)*
- **Maker-Checker Enforcement (`chk_prov_maker_checker_distinct`):** `CHECK (reviewed_by IS NULL OR reviewed_by != requested_by)` with composite FKs binding both Maker and Checker to `organization_id`.
- **Immutable Audit Ledger (`account_provisioning_events`):** Append-only (`trg_no_update_delete_prov_events`, `ON DELETE RESTRICT` on both request and actor).

### 5.2 Distributed State Machine, Provenance Proof & Crash Recovery
1. **Maker Submission (`SUBMITTED`):** Admin A submits `{ phoneNumber (canonicalized), requestedRoles, idempotencyKey }`. DB enforces `uq_prov_org_idempotency` AND partial unique index `uq_prov_active_phone` (`WHERE status IN ('SUBMITTED', 'APPROVED', 'PROCESSING')`), plus validates phone is not already registered in `public.users` (`uq_users_org_phone`).
2. **Checker Approval (`APPROVED`):** Distinct Admin B approves. Immutable event recorded.
3. **Leased Claim & Pre-Commit Identity Allocation (`PROCESSING`):**
   - Worker claims next row atomically using `SELECT ... FOR UPDATE SKIP LOCKED` (`locked_until = NOW() + interval '60 seconds'`).
   - If `retry_count >= 5`, transition directly to `'FAILED'` (escalate to Admin review queue + audit event) without touching GoTrue.
   - **Before calling GoTrue:** Generate immutable handle `v_handle = crypto.randomUUID()`, set `synthetic_email = "${v_handle}@auth.hrms.internal"`, commit `status = 'PROCESSING'`, `synthetic_email`, `retry_count = retry_count + 1` in PostgreSQL!
4. **GoTrue Creation With Cryptographic Provenance Claims:**
   - Generate ephemeral high-entropy 256-bit placeholder secret in RAM (never persisted, never shown to Admins or users; user will set their own password during Activation per Section 6).
   - Call `supabaseAdmin.auth.admin.createUser` passing trusted Service-Role-only provenance claims:
     ```json
     {
       "email": "<v_handle>@auth.hrms.internal",
       "password": "<ephemeral_256bit_secret>",
       "email_confirm": true,
       "app_metadata": {
         "hrms_provisioned": true,
         "hrms_organization_id": "<request.organization_id>",
         "hrms_provisioning_request_id": "<request.id>"
       }
     }
     ```
   - **Rule Against Naive `422 email_exists` Adoption:**
     > **A duplicate email response (`422 email_exists`) from GoTrue MUST NEVER alone be treated as proof that an existing Auth account belongs to the employee being provisioned.**
   - **Verified Duplicate-Email Recovery Protocol:**
     If GoTrue returns `422` (`email_exists` / duplicate email) — e.g. worker crashed after GoTrue created the account on attempt 1 before persisting `auth_user_id` — worker executes strict **4-Point Ownership Verification**:
     1. Look up the existing `auth.users` account matching `request.synthetic_email` via verified Admin lookup / scoped read-only Auth lookup helper.
     2. Assert `gotrueUser.email === request.synthetic_email`.
     3. Assert `gotrueUser.app_metadata.hrms_provisioned === true`, `gotrueUser.app_metadata.hrms_organization_id === request.organization_id`, AND `gotrueUser.app_metadata.hrms_provisioning_request_id === request.id`.
     4. Assert `SELECT 1 FROM public.users WHERE id = gotrueUser.id` does **NOT** exist for a different `organization_id` or user!
     - **If all 4 assertions pass:** Ownership is verified -> adopt `auth_user_id = gotrueUser.id` and proceed to step 5.
     - **If ANY assertion fails:** **ABORT IMMEDIATELY!** Never link that account. Mark request `'FAILED'`, record `'IDENTITY_OWNERSHIP_MISMATCH'` in `account_provisioning_events` with full anomaly context, and escalate to SRE/Super Admin.
5. **Local Atomic Commit (`COMPLETED`) & Activation Token Issuance:**
   - Persist `auth_user_id` on `account_provisioning_requests`, then execute atomic PostgreSQL transaction (`SECURITY DEFINER` provisioning procedure):
     - `INSERT INTO public.users (id, organization_id, phone_number, synthetic_email, is_active, must_change_password) VALUES (auth_user_id, org_id, canonical_phone, synthetic_email, TRUE, TRUE)`
     - `INSERT INTO public.user_roles ...`
     - Create single-use, time-limited Activation Token (`account_activation_tokens`, SHA-256 hashed at rest, TTL configurable e.g. 24h)
     - Update `account_provisioning_requests SET status = 'COMPLETED', user_id = auth_user_id`
     - Append `'COMPLETED'` event to `account_provisioning_events`.
6. **Compensating Rollback on Irrecoverable Partial Failure:**
   - If PostgreSQL transaction repeatedly fails (e.g., domain constraint or max retries exhausted while `auth_user_id` was created in GoTrue and no `public.users` row landed), worker executes `supabaseAdmin.auth.admin.deleteUser(auth_user_id)` only after proving via Step 4 provenance metadata that *this exact request created the orphan GoTrue user* AND no `public.users` row references it, then sets status `'FAILED'`.

---

## 6. Employee Password Activation & Account Recovery Architecture

### 6.1 Core Security Principle
Admins provision employee profiles and roles, **but NEVER create, view, set, or learn an employee's permanent password**. Employees choose their own permanent password during onboarding Activation and during approved Self-Service Mobile OTP Password Recovery (`PO-03`).

### 6.2 Onboarding Account Activation Lifecycle (APPROVED POLICY — Admin Link / QR Code + Mobile OTP Verification)

**Approved Activation Architecture (Task 2.2B.5 — 2026-11-10):**
Initial employee account activation enforces a **Two-Factor Secure Activation Protocol**:
- **Factor 1 (Possession of One-Time Token):** Admin-generated cryptographically secure 256-bit activation link / QR code shared out-of-band.
- **Factor 2 (Possession of Registered Mobile Number):** Automated SMS OTP verification dispatched to the employee's registered Indian mobile (`+91XXXXXXXXXX`, `PO-02`).

1. **Cryptographically Secure Opaque Token Generation (256-Bit Entropy):**
   - Admin creates an employee account through the approved Maker-Checker provisioning workflow (`account_provisioning_requests` in Migration `00003`).
   - Upon completion, the system generates a **high-entropy 256-bit (32-byte) opaque random token** from Node's CSPRNG (`crypto.randomBytes(32).toString('base64url')`, 43 URL-safe characters).
   - **Why `SHA-256` Representation Is Cryptographically Sufficient for Opaque Tokens:** Because a 256-bit CSPRNG token spans a uniform $2^{256}$ search space, precomputation, rainbow tables, and offline brute-force attacks against `SHA-256(raw_token)` remain computationally infeasible even upon read-only database compromise. Storing **only `token_hash CHAR(64)`** (`SHA-256` hex digest) in PostgreSQL `account_activation_tokens` protects the secret cleanly. Plaintext tokens are **never** stored or logged.
   - **Strict Prohibition Against Low-Entropy Numeric Equivalence:** Low-entropy numeric OTPs (e.g., 6-digit SMS codes, $10^6$ space under approved `PO-03`) **must NEVER be stored in `account_activation_tokens` or hashed with unkeyed `SHA-256`** (since $10^6$ unkeyed `SHA-256` digests can be cracked instantaneously offline if a SQL dump leaks). Numeric OTP challenges MUST reside in a **keyed HMAC challenge store (`public.password_reset_otps` / activation OTP challenges)** protected by **keyed `HMAC-SHA256` with server-only secret pepper (`OTP_HMAC_PEPPER`)**, short expiry, max verification attempts, and single-use locking (Section 6.3).
   - **Database State & Constraints (`account_activation_tokens`, Proposed Migration `00004`):**
     - `id`, `organization_id`, `user_id` (composite FK `(organization_id, user_id)`), `token_hash CHAR(64) UNIQUE`, `purpose ('ACTIVATION' | 'PASSWORD_RESET')` (`'PASSWORD_RESET'` reserved strictly for optional future Admin-assisted lost-mobile 256-bit fallback if finalized), `expires_at` (default `+24h` from creation), `used_at`, `invalidated_at`, `invalidated_reason`, `failed_attempts DEFAULT 0`, `max_attempts DEFAULT 5`, `created_by`.
     - Partial unique index `uq_act_tokens_active_user_purpose` guarantees at most one active unconsumed token per `(organization_id, user_id, purpose)` concurrently.
   - **Account Pre-Activation Gate:** `public.users` starts with `activated_at IS NULL`, `phone_verified_at IS NULL` (proposed `00004`), and `must_change_password = TRUE`. `hrms_internal.resolve_login_identity()` returns 0 rows while `activated_at IS NULL`, guaranteeing no pre-activation login can occur before the employee successfully completes activation and chooses their own password.

2. **Admin-Generated Activation Link, QR Code & Out-of-Band Delivery:**
   - The backend constructs a single-use activation URL containing the opaque token in a **URL fragment** rather than a query string:
     `https://<app_domain>/auth/activate#token=<opaque_256bit_token>`
   - **Why URL Fragment (`#token=...`) Is Cryptographically Mandatory:** Per RFC 3986, URL fragments (`#...`) are processed purely on client user agents and are **never transmitted to web servers in HTTP request lines, reverse-proxy access logs (Nginx/Cloudflare), Referer headers, browser history sync, or browser telemetry/analytics**.
   - The provisioning system renders an equivalent **QR code** containing the exact same fragment-based activation URL.
   - The provisioning Admin shares the activation link or QR code with the employee **strictly through an approved out-of-band channel** (e.g., in-person onboarding handover, printed welcome sheet, or corporate direct messaging).
   - **Privacy, Telemetry & Exposure Prohibition:** The plaintext activation token, URL, and QR code must **never** be logged in application logs, error reporting tools (e.g., Sentry), or browser analytics, and must **never** be exposed in public employee directories, employee list API responses, or ordinary user profile payloads.
   - **Admin Reissue Endpoint Scoping:** The Admin reissue endpoint (`POST /api/v1/admin/users/:userId/reissue-activation`) generates the fresh activation URL/QR payload and exposes it **only to authenticated, authorized same-tenant administrators**, recording an immutable audit event (`ACTIVATION_TOKEN_REISSUED`) with mandatory justification reason while strictly omitting plaintext tokens or hashes from log statements.

3. **Activation Challenge & Mobile OTP Verification Sequence:**
   - **Step A (Open Link / Scan QR Code):** The employee opens the activation URL or scans the QR code on their device. The frontend application parses `window.location.hash`, extracts the opaque token from the fragment, immediately strips or clears the fragment from the browser address bar (`window.history.replaceState`), and submits `{ organizationCode, phoneNumber, activationToken }` over TLS 1.3 / HTTPS to `POST /api/v1/auth/activate/request-otp`. The plaintext token is held strictly in volatile JavaScript memory and never saved to `localStorage`, `sessionStorage`, or telemetry beacons.
   - **Step B (Token & Identity Validation):** The backend resolves the organization (`resolve_organization_by_code()`), normalizes the mobile number (`PO-02` E.164 `+91XXXXXXXXXX`), and validates:
     1. Token hash matches an active, unconsumed, non-expired row in `account_activation_tokens` under `purpose = 'ACTIVATION'` and `status = 'ACTIVE'`.
     2. Token belongs to the matching user and tenant `(organization_id, user_id)`.
     3. User account is active (`is_active = TRUE`) and currently unactivated (`activated_at IS NULL`).
     4. Provisioning has **already completed** prior to token issuance (Section 5.2 Step 5 transitions `account_provisioning_requests.status = 'COMPLETED'` when creating `auth.users`, `public.users`, `user_roles`, and issuing the initial activation token; verification checks existing `status = 'COMPLETED'` without mutating it again).
   - **Step C (Mobile OTP Dispatch):** Upon successful token validation, the backend dispatches an SMS OTP to the employee's registered Indian mobile number (`+91XXXXXXXXXX`).
     - **Hexagonal Port & `DEC-10` Decoupling:** Express dispatches OTP via `ISmsOtpDispatcher`. In local development/test, the OTP is emitted to console/mock sink. Commercial SMS gateway vendor selection, Indian DLT registration, and production delivery remain tracked under open decision **`DEC-10`**.
   - **Step D (Employee Submission):** The employee enters:
     - **Organization Code**
     - **Registered Mobile Number**
     - **Activation Token** (submitted via in-memory client state)
     - **SMS OTP**
     - **New Password** (self-chosen, $\ge 8$ chars meeting password policy).

4. **Cross-System Completion Reliability & Recoverable State Machine (`POST /api/v1/auth/activate`):**
   - **Fundamental Architecture Reality:** PostgreSQL and Supabase GoTrue are distinct, physically separated distributed systems communicating over an asynchronous network interface. **They DO NOT share a distributed two-phase commit (2PC) transaction.** Express must never claim or assume atomic ACID coupling across PostgreSQL and GoTrue.
   - **Strict Prohibition Against Holding Database Transactions Open Over Network Calls:**
     > **A PostgreSQL transaction lock (`FOR UPDATE`) MUST NEVER be held open while awaiting GoTrue remote HTTP API responses.** Holding locks open across remote network hops causes connection pool exhaustion, database thread starvation, and catastrophic cascading failure during transient network latency.
   - **Why `updated_at` Timestamp Is NOT Reliable Evidence:**
     > A changed GoTrue `updated_at` timestamp **NEVER proves that a password update succeeded**. Any unrelated GoTrue event (admin metadata change, session activity, phone/email confirm, or ban/unban) alters `updated_at` without changing the password hash. Relying on `updated_at` risks falsely marking unupdated accounts as activated and permanently locking out the employee.
   - **Verified GoTrue SDK/API Contract & Hard Technical Boundaries (`admin.updateUserById`):**
     - Verified against `@supabase/auth-js` `AdminUserAttributes` and `supabase/auth` GoTrue (`internal/api/admin.go` `adminUserUpdate`): updating both `password` and trusted `app_metadata` in a **single** `PUT /admin/users/{user_id}` call executes both `user.UpdatePassword(tx, nil)` and `user.UpdateAppMetaData(tx, params.AppMetaData)` inside GoTrue's **same single PostgreSQL `db.Transaction(...)`** (either both commit together or neither commits). Top-level `app_metadata` keys shallow-merge into `raw_app_meta_data` (preserving flat provisioning provenance claims `hrms_provisioned`, `hrms_organization_id`, `hrms_provisioning_request_id` when adding flat key `hrms_activation_op_id`, subject to live local GoTrue `v2.197.0` verification in Task `2.2H`).
     - **Explicit Technical Fact — Why Fully Automatic Safe Retry Is NOT Technically Possible:** GoTrue `PUT /admin/users/{user_id}` provides **NO compare-and-swap (CAS), NO `If-Match`/ETag concurrency guard, NO server-side idempotency key, and NO distributed abort/cancellation guarantee** once an HTTP request leaves Express. Moreover, **client HTTP timeout or socket cancellation (`AbortController.abort()`) NEVER proves the remote GoTrue server or intermediate reverse proxy stopped processing the request**. Consequently:
       1. **User-Level Operation Lock (`auth_user_id` Scope, NOT Merely Per Token):** Locking per activation token alone fails if an earlier stalled GoTrue request from `token_1` lands late after Admin issues `token_2`. The activation lock MUST live on the user record (`public.users.activation_lock_state` / `activation_lock_op_id`, keyed by `user_id = auth_user_id`). No new token and no Admin reissue may authorize a new GoTrue password update while an earlier operation for that `auth_user_id` is `'IN_FLIGHT'` or `'QUARANTINED_MANUAL_RECOVERY'`.
       2. **Strict Pre-Commit HTTP Response Classification (Never Blanket 4xx):** Only a **specifically identified GoTrue pre-commit validation rejection**—specifically GoTrue HTTP `422 Unprocessable Entity` with structured JSON `error_code === 'weak_password'` (proven to fail `checkPasswordStrength()` before `adminUserUpdate` opens its `db.Transaction`)—allows automatic lock release. All other `4xx`/`5xx`/non-JSON/proxy errors (e.g., `408`, `429`, `400`, `404`, `409`, `502`, `504`, socket drops) MUST be treated as **uncertain**.
       3. **User-Level Quarantine & Controlled Manual Recovery:** Because neither invalidating the old token nor client timeouts prove the remote HTTP request died, uncertain GoTrue outcomes **quarantine the Auth user's activation state (`QUARANTINED_MANUAL_RECOVERY`)** and require **manual verification & controlled recovery**—never automatic retry—whenever `app_metadata.hrms_activation_op_id` is not observed.
   - **Recoverable Single-Flight State Machine (User-Scoped Lock per `auth_user_id`):**
     ```
     Phase 1: User-Scoped Single-Flight Claim (Short TX 1, <5ms)
       - Lock target user & token rows via SELECT ... FOR UPDATE on public.users (id = authUserId)
         AND public.account_activation_tokens (id = token.id).
       - If public.users.activation_lock_state IN ('IN_FLIGHT', 'QUARANTINED_MANUAL_RECOVERY'):
         DO NOT claim a second operation, DO NOT issue a GoTrue call, and DO NOT allow retry!
         Return 409 ACTIVATION_LOCKED_PENDING_RECOVERY (for IN_FLIGHT, wait briefly;
         for QUARANTINED_MANUAL_RECOVERY, manual SRE/Admin recovery required).
       - Validate token status = 'ACTIVE', expiry, remaining attempts, SHA-256 hash, and keyed HMAC OTP.
       - If invalid: increment failed_attempts (invalidate if >= max_attempts), commit, return uniform generic error.
       - If valid:
           opId = crypto.randomUUID()
           UPDATE public.users
             SET activation_lock_state = 'IN_FLIGHT',
                 activation_lock_op_id = opId,
                 activation_lock_started_at = NOW()
             WHERE id = authUserId AND activation_lock_state = 'NONE' AND activated_at IS NULL;
           UPDATE public.account_activation_tokens
             SET status = 'COMMITTING',
                 committing_op_id = opId,
                 committing_started_at = NOW()
             WHERE id = token.id AND status = 'ACTIVE';
           COMMIT immediately, releasing all PostgreSQL locks BEFORE touching the network!

     Phase 2: Bounded HTTP Request + Atomic GoTrue Credential & Marker Write
       - Attach client timeout (AbortController, e.g. 10s deadline; remembering timeout/abort NEVER proves
         GoTrue stopped processing on the server!) and call:
         supabaseAdmin.auth.admin.updateUserById(authUserId, {
           password: newPassword,
           app_metadata: { hrms_activation_op_id: opId }
         })
       - Outcome A (Synchronous GoTrue 200 OK AND returned user.app_metadata.hrms_activation_op_id === opId):
         Proceed to Phase 3A.
       - Outcome B (Verified Pre-Commit Rejection: Synchronous GoTrue HTTP 422 with JSON error_code === 'weak_password'):
         Proceed to Phase 3B.
       - Outcome C (HTTP Timeout, AbortError, Socket Disconnect, Proxy 408/429, Any Other 4xx, Any 5xx,
         or Malformed Response):
         Proceed to Phase 3C (Uncertain Outcome).

     Phase 3A (Confirmed GoTrue Commit -> Finalize Local Activation, Short TX 2 <5ms):
       - UPDATE public.users
           SET activated_at = NOW(),
               phone_verified_at = NOW(),
               must_change_password = FALSE,
               activation_lock_state = 'NONE',
               activation_lock_op_id = NULL,
               activation_lock_started_at = NULL
           WHERE id = authUserId AND activated_at IS NULL;
       - UPDATE public.account_activation_tokens
           SET status = 'CONSUMED', used_at = NOW()
           WHERE id = token.id AND status = 'COMMITTING' AND committing_op_id = opId;
       - UPDATE public.password_reset_otps SET used_at = NOW() WHERE id = otpRow.id;
       - (Account provisioning is ALREADY 'COMPLETED' from Section 5.2 Step 5; NEVER mutate
          account_provisioning_requests.status or emit duplicate 'COMPLETED' provisioning events.)
       - COMMIT. Revoke placeholder GoTrue sessions; log ACCOUNT_ACTIVATED in audit_logs. Return HTTP 200 OK.

     Phase 3B (Strictly Verified GoTrue weak_password Pre-Commit Rejection -> Safe Release, Short TX 2 <5ms):
       - Only after verifying GoTrue HTTP 422 JSON error_code === 'weak_password' (checked BEFORE GoTrue
         opens its db.Transaction), release user lock and return token to ACTIVE:
           UPDATE public.users
             SET activation_lock_state = 'NONE', activation_lock_op_id = NULL, activation_lock_started_at = NULL
             WHERE id = authUserId AND activation_lock_op_id = opId;
           UPDATE public.account_activation_tokens
             SET status = 'ACTIVE', committing_op_id = NULL, committing_started_at = NULL
             WHERE id = token.id AND status = 'COMMITTING' AND committing_op_id = opId;
       - Return HTTP 400 weak_password guidance.

     Phase 3C (Uncertain Network Outcome -> Recoverable Wait Window -> User-Level Quarantine):
       - Keep public.users.activation_lock_state = 'IN_FLIGHT' and token status = 'COMMITTING' (used_at IS NULL).
       - Reconciliation Worker polls GoTrue getUserById(authUserId) during initial wait window (e.g. up to 90s):
         - IF gotrueUser.app_metadata?.hrms_activation_op_id === users.activation_lock_op_id:
           Positive cryptographic/transaction proof that GoTrue committed password + marker!
           Reconciliation deterministically executes Phase 3A (clears lock to 'NONE', sets activated_at,
           sets phone_verified_at, marks token 'CONSUMED', burns OTP, logs ACCOUNT_ACTIVATED).
         - IF marker mismatch / absent after wait window (NEVER assume mismatch proves failure!):
           Because GoTrue cannot prove the remote request stopped, QUARANTINE THE AUTH USER'S OPERATION:
             UPDATE public.users
               SET activation_lock_state = 'QUARANTINED_MANUAL_RECOVERY'
               WHERE id = authUserId AND activation_lock_state = 'IN_FLIGHT' AND activation_lock_op_id = opId;
             UPDATE public.account_activation_tokens
               SET status = 'INVALIDATED', invalidated_at = NOW(), invalidated_reason = 'UNCERTAIN_PROVIDER_OUTCOME'
               WHERE id = token.id AND status = 'COMMITTING' AND committing_op_id = opId;
           Keep activated_at IS NULL and phone_verified_at IS NULL; emit USER_ACTIVATION_QUARANTINED (with opId)
           to audit_logs. Neither the employee NOR Admin reissue may trigger a new password update while quarantined!
     ```
   - **Controlled Manual Recovery Procedure (`QUARANTINED_MANUAL_RECOVERY`):**
     1. Triggered when an account enters `QUARANTINED_MANUAL_RECOVERY` because an earlier GoTrue request timed out / errored uncertainly and `hrms_activation_op_id` was not observed within the wait window.
     2. **Mandatory Evidence Check Before Unlocking:** Authorized `SUPER_ADMIN` / SRE inspects GoTrue server logs, PostgreSQL `auth.audit_log_entries`, reverse-proxy access logs (for `opId` request completion/termination), and calls `admin.getUserById(authUserId)`:
        - **If investigation proves the delayed GoTrue request DID execute (`hrms_activation_op_id === activation_lock_op_id` eventually landed):** Clear lock and finalize Phase 3A (account activated with the user's chosen password; no second GoTrue write).
        - **If logs definitively verify GoTrue never executed the write / upstream aborted prior to commit (and `getUserById` confirms marker absent):** Execute controlled unlock (`POST /api/v1/admin/users/:userId/clear-activation-quarantine` restricted to `SUPER_ADMIN` with mandatory `incidentTicket` and justification `reason >= 20` chars, emitting `ACTIVATION_QUARANTINE_CLEARED` to `audit_logs`), resetting `activation_lock_state = 'NONE'` so Admin reissue can safely issue a fresh token.
        - **If logs remain ambiguous:** Require credential reset / clean Auth replacement under SRE incident governance before clearing quarantine.
   - **Evaluation of Controls & Residual Uncertainty (User-Scoped Lock):**
     | Control Mechanism | Deterministic Guarantee | What It CANNOT Guarantee (Residual Uncertainty) |
     |---|---|---|
     | **User Lock `activation_lock_state` on `public.users`** | **Completely prevents cross-token GoTrue races:** even if Admin tries to reissue `token_2` while `token_1` is `'IN_FLIGHT'` or `'QUARANTINED_MANUAL_RECOVERY'`, reissue and activation are physically blocked for `auth_user_id`. | Does not make the remote GoTrue HTTP API itself atomic with PostgreSQL or add CAS support. |
     | **Bounded HTTP Timeout (`AbortController`)** | Prevents Express connection/thread exhaustion. | Does **NOT** prove GoTrue or proxies stopped processing the `PUT` request upon abort/timeout. |
     | **Verified `422 weak_password` Pre-Commit Filter** | Releases lock safely only when GoTrue's JSON error guarantees validation failed *before* opening `db.Transaction`. | Other 4xx errors (`408`, `429`, gateway errors) cannot prove pre-commit safety and intentionally quarantine instead. |
     | **`app_metadata.hrms_activation_op_id` + Quarantine** | Positively proves committed password updates and prevents automatic unsafe retries; exposes full auditability for manual recovery. | Because GoTrue lacks CAS/idempotency/cancellation, **fully automatic safe retry is NOT possible** when outcomes are uncertain; controlled manual SRE/Super Admin recovery is required before reissue. |

5. **Token Invalidation, Expiry, Cancellation & Admin Reissue Lifecycle:**
   - **Automatic Invalidation Triggers:**
     - *On Successful Activation:* `used_at = NOW()` burns the token immediately.
     - *On Expiry:* Tokens expire after default 24 hours (`expires_at < NOW()`).
     - *On Max Failed Attempts:* 5 consecutive failed attempts set `invalidated_at = NOW(), invalidated_reason = 'MAX_ATTEMPTS_EXCEEDED'`.
     - *On Uncertain Operation Quarantine:* Quarantine invalidates the stalled token (`UNCERTAIN_PROVIDER_OUTCOME`) **and** locks `public.users.activation_lock_state = 'QUARANTINED_MANUAL_RECOVERY'`.
     - *On Provisioning Cancellation:* Rejecting or cancelling the provisioning request invalidates associated tokens (`invalidated_reason = 'PROVISIONING_CANCELLED'`).
     - *On Admin Reissue (`POST /api/v1/admin/users/:userId/reissue-activation`):* Allowed ONLY when `public.users.activation_lock_state = 'NONE'` (blocked with `409` if `'IN_FLIGHT'` or `'QUARANTINED_MANUAL_RECOVERY'`, preventing any new token or password write while an earlier GoTrue request might still complete!). Same-tenant `ADMIN` or `SUPER_ADMIN` (`ADMIN` blocked from `SUPER_ADMIN`; mandatory `reason`); marks prior unconsumed `'ACTIVE'` token `invalidated_at = NOW(), invalidated_reason = 'REISSUED_BY_ADMIN'` and mints fresh 256-bit fragment token/QR.
   - **Anti-Enumeration Protection:** Opening an activation link or submitting activation requests with invalid, expired, used, or non-existent tokens returns identical uniform generic failure responses (`INVALID_ACTIVATION_REQUEST`) with timing equalization, preventing attackers from probing for valid tokens or active employee accounts.

6. **Non-Negotiable Architecture Invariants:**
   - **Zero Email Entry or Exposure:** The employee is **NEVER** asked for an email address. Approved `PO-01` Scheme 3 (`<immutable_uuid>@auth.hrms.internal`) is used solely by Express to interface with GoTrue and is never shown in the UI, activation forms, API responses, or logs.
   - **Zero Admin Password Knowledge:** Administrators **NEVER** create, set, view, or learn permanent passwords. The employee alone sets their permanent password during activation.
   - **Separation from Password Recovery:** Account activation is strictly distinct from self-service password recovery (`PO-03`). Activation requires possession of the Admin-issued 256-bit token + SMS OTP, operates on unactivated accounts (`activated_at IS NULL`), and sets both `activated_at` and `phone_verified_at`. Password recovery operates exclusively on already-activated accounts (`activated_at IS NOT NULL AND phone_verified_at IS NOT NULL`).

### 6.3 Self-Service Password Recovery via Mobile OTP (`PO-03` APPROVED — 2026-11-10)

**Decision Status (`PO-03` — OFFICIALLY APPROVED / CLOSED `2026-11-10`):**
Phase 1 supports **employee self-service password recovery using a Mobile OTP sent exclusively to the employee's registered, verified Indian mobile number**. Administrators must never view, set, or learn an employee's permanent password.

#### 6.3.1 Strict Separation: Approved Policy vs Unresolved Implementation Details
- **Approved & Locked Policy (`PO-03` + `DEC-09` + `DEC-13` + `PO-01` + `PO-02`):**
  1. Employees recover forgotten passwords themselves in Phase 1 using `Organization Code + registered Indian Mobile Number + OTP + New Password` (zero email input or display).
  2. OTPs may be dispatched **only** to the employee's registered, verified, active Indian mobile number (`+91XXXXXXXXXX`, normalized per `PO-02`; `o.is_active = TRUE`, `u.is_active = TRUE`, `u.activated_at IS NOT NULL`, `u.phone_verified_at IS NOT NULL`).
  3. **No Native Supabase Phone Auth Shortcut:** Must **NOT** switch login/recovery to Supabase native `signInWithOtp({ phone })` or `auth.users.phone`. `DEC-09` and `PO-01` Scheme 3 (`<immutable_uuid>@auth.hrms.internal`) remain exclusive; Express verifies OTPs and updates the password via `supabaseAdmin.auth.admin.updateUserById(authUserId, { password: newPassword })`.
  4. Never disclose account, organization, or mobile existence during initiation or confirmation; never expose `synthetic_email`, `auth.users.id`, OTP values/digests, or internal account metadata in employee-facing UI, API responses, logs, or errors.
  5. Cryptographic OTP controls (CSPRNG generation, short expiry, single use, keyed-HMAC or secure hash storage with zero plaintext OTP persistence, max attempts, resend cooldown/rate limits, post-use invalidation, replay/concurrency prevention, global session revocation, and non-secret security audit logs) are mandatory.
- **Unresolved Details (Tracked Explicitly — Do NOT Hardcode Assumptions):**
  1. **SMS Gateway Provider & Indian DLT Integration (`DEC-10` — OPEN):** Commercial vendor selection, Entity ID / DLT template registration, sender ID, delivery receipts, and cost budgets are **not resolved**. Express integrates via hexagonal port **`ISmsOtpDispatcher`** (local dev/test console/mock sink; production fails closed if unconfigured).
  2. **Concrete Numeric OTP Policy Parameters (`PO-03` / `PO-04` Tuning):** Recommended baseline values below (6-digit CSPRNG OTP, `5m–10m` TTL, max `3–5` verification attempts, `60s` resend cooldown, hourly/daily cap, `429` vs uniform responses) remain engineering proposals subject to operational/`PO-04` confirmation.
  3. **Onboarding Phone Verification Bootstrap (`phone_verified_at`):** How `public.users.phone_verified_at` is populated on initial onboarding (e.g., Maker-Checker verified corporate mobile record vs SMS OTP challenge at `/auth/activate` once `DEC-10` is integrated) must be finalized in Task `2.2C` before Migration `00004`.
  4. **Lost / Changed Registered Mobile Number Operational Workflow (Admin-Assisted Fallback — NOT Finalized):** See Section 6.3.5 below.

#### 6.3.2 End-to-End OTP Recovery Sequence (`request-otp` -> `confirm`)

```
Employee Browser / PWA                Express Auth Broker             PostgreSQL (RLS / hrms_internal)       ISmsOtpDispatcher (DEC-10) / GoTrue
        |                                     |                                     |                                   |
        |-- 1. POST /reset-password/request-otp                                     |                                   |
        |   { organizationCode, phoneNumber } |                                     |                                   |
        |------------------------------------>|                                     |                                   |
        |                                     |-- 2. Validate syntax + PO-02 norm  |                                   |
        |                                     |-- 3. Pre-DB Rate Limit & Cooldown  |                                   |
        |                                     |   HMAC(IP+org+phone), HMAC(org+phone)                                   |
        |                                     |-- 4. Resolve org + eligible user -->|                                   |
        |                                     |   (active org/user/activated/       |                                   |
        |                                     |    phone_verified_at IS NOT NULL)  |                                   |
        |                                     |<-- { user_id } or 0 rows -----------|                                   |
        |                                     |                                     |                                   |
        |   [IF ineligible / unknown]: run dummy HMAC/timing equalization; skip SMS!                                    |
        |   [IF eligible & outside DB cooldown]:                                    |                                   |
        |                                     |-- 5. rawOtp = crypto.randomInt(...) |                                   |
        |                                     |   challengeId = randomUUID()        |                                   |
        |                                     |   otpHmac = HMAC-SHA256(OTP_PEPPER, |                                   |
        |                                     |     'PASSWORD_RESET_OTP:'+org+user+challengeId+rawOtp)                 |
        |                                     |-- 6. Supersede old OTP + INSERT --->|                                   |
        |                                     |   public.password_reset_otps        |                                   |
        |                                     |-- 7. Dispatch rawOtp to +91XXXXXXXXXX --------------------------------->|
        |                                     |-- 8. Audit OTP_REQUESTED (no OTP!) ->|                                   |
        |<-- 9. HTTP 202 Accepted (Identical anti-enumeration JSON body) -----------|                                   |
        |                                                                           |                                   |
        |-- 10. POST /reset-password/confirm { organizationCode, phoneNumber, otp, newPassword }                        |
        |------------------------------------>|                                     |                                   |
        |                                     |-- 11. Pre-DB Rate Limit + PO-02 norm|                                   |
        |                                     |   + validate newPassword policy     |                                   |
        |                                     |-- 12. Short TX (<5ms): Lock row --->|                                   |
        |                                     |   SELECT ... FOR UPDATE             |                                   |
        |                                     |   verify HMAC + crypto.timingSafeEqual in RAM                          |
        |                                     |   [Match]: used_at = NOW(); COMMIT  |                                   |
        |                                     |   [Miss]: failed_attempts+1; COMMIT |                                   |
        |                                     |                                     |                                   |
        |   [Only if OTP burned cleanly above]:                                     |                                   |
        |                                     |-- 13. GoTrue admin.updateUserById(authUserId, { password }) ----------->|
        |                                     |-- 14. GoTrue admin.signOut(authUserId, 'global') ---------------------->|
        |                                     |-- 15. DB: clear must_change_password, revoke sessions + epoch + audit -->|
        |<-- 16. HTTP 200 OK ("Password reset; please log in.") (ZERO tokens / synthetic_email / user_id exposed) ------|
```

#### 6.3.3 Mandatory Cryptographic & Lifecycle Controls
1. **CSPRNG Generation:** Generate numeric OTP strictly with unbiased rejection sampling (`crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')` for 6-digit baseline `[PROPOSED]`). Never use `Math.random()`.
2. **Keyed Digest Storage (`OTP_HMAC_PEPPER` Never in PostgreSQL):**
   - Plaintext OTP must never be written to PostgreSQL, Redis, application logs, APM spans, or error messages.
   - Store `otp_hmac CHAR(64)` in `public.password_reset_otps` computed inside Express as:
     `HMAC-SHA256(OTP_HMAC_PEPPER, 'PASSWORD_RESET_OTP:' || organization_id || ':' || user_id || ':' || challenge_id || ':' || raw_otp)`.
   - Binding `organization_id`, `user_id`, and `challenge_id` inside the HMAC prevents digest substitution across tenants, users, or resends, and keeping `OTP_HMAC_PEPPER` strictly in Express secret configuration prevents offline brute-force of $10^6$ codes even if an attacker obtains a read-only database backup.
3. **Short Expiry, Single Use, & Concurrent Replay Prevention:**
   - Recommended TTL `[PROPOSED]`: `5 minutes` (hard DB check ceiling `<= 15 minutes`).
   - Partial unique index `uq_pwd_reset_otp_active_user` enforces at most one active unconsumed OTP challenge per `(organization_id, user_id)`. Resending atomically invalidates any prior active challenge (`invalidated_reason = 'SUPERSEDED_BY_RESEND'`).
   - Confirmation runs in a **short local `<5ms` database transaction** (`SECURITY DEFINER`) acquiring `FOR UPDATE` on the single active challenge row, validating snapshot phone parity (`otp.phone_number = users.phone_number`), expiry, and attempt ceiling, verifying `otp_hmac` via `crypto.timingSafeEqual` in Express memory, and **atomically committing `used_at = NOW()` before calling GoTrue `admin.updateUserById`**. Any parallel duplicate `confirm` request waits behind `FOR UPDATE`, immediately observes `used_at IS NOT NULL`, and fails — eliminating replay and concurrent reuse without holding DB locks over remote HTTP calls!
   - If GoTrue returns a transient failure *after* atomic OTP burn, the employee's previous password remains unchanged, audit records `PASSWORD_RESET_PROVIDER_ERROR`, and Express returns HTTP `503` instructing the user to retry cleanly via a fresh OTP (single-use integrity never relaxed).
4. **Attempt Ceiling, Resend Cooldown & Anti-Enumeration Throttling:**
   - Recommended cap `[PROPOSED]`: max `5` failed verification attempts per challenge (`failed_attempts >= max_attempts` atomically sets `invalidated_at = NOW(), invalidated_reason = 'MAX_ATTEMPTS_EXCEEDED'`).
   - Recommended cooldown `[PROPOSED]`: `60 seconds` minimum resend cooldown and bounded hourly/daily SMS requests per tuple.
   - **Pre-DB Symmetric Cooldown & Throttling Keys:** Throttle and cooldown keys (`HMAC(secret, ip + ':' + orgCode + ':' + canonicalPhone)` and `HMAC(secret, orgCode + ':' + canonicalPhone)`) execute **before** DB existence lookup so existing and nonexistent phone numbers exhibit symmetric response payloads (`202 Accepted` neutral message during normal probes, or symmetric `PO-04` limits) and timing equalization, preventing account enumeration and avoiding any leak via differential cooldown errors.
5. **Password Reset via Trusted Backend (`DEC-09` & `PO-01` Intact):**
   - Upon atomic OTP burn, Express calls `supabaseAdmin.auth.admin.updateUserById(authUserId, { password: newPassword })` (identifying the GoTrue user via `authUserId = user_id`, `1:1` mapped). Express never creates an intermediate "reset JWT" or custom capability ticket (`DEC-09`), clears `must_change_password = FALSE`, and performs mandatory global session revocation (`admin.signOut(authUserId, 'global')` + `tokens_valid_after_epoch` cutoff + `revoked_sessions`).
   - Employee must subsequently authenticate normally via `POST /api/v1/auth/login` (`Organization Code + Mobile Number + Password`).
6. **Security Audit Trail (Zero Secret Leakage):**
   - Append immutable `audit_logs` events (`PASSWORD_RESET_OTP_REQUESTED`, `PASSWORD_RESET_OTP_SUPERSEDED`, `PASSWORD_RESET_OTP_FAILED`, `PASSWORD_RESET_OTP_EXHAUSTED`, `PASSWORD_RESET_OTP_DISPATCH_FAILED`, `PASSWORD_RESET_COMPLETED`) recording `organization_id`, `target_user_id` (only for resolved users; hashed request telemetry for unmatched probes), masked IP / correlation ID, and reason — strictly omitting OTP values, `otp_hmac`, passwords, and `synthetic_email`.

#### 6.3.4 Threat & Abuse Scenarios Matrix
| Abuse / Attack Scenario | Concrete Threat Vector | Mandatory Defense Controls (`PO-03` + `PO-02` + `PO-04`) |
|---|---|---|
| **1. Account / Phone Enumeration** | Probing `request-otp` or `confirm` across `{orgCode, phone}` to identify active employees. | Pre-DB normalized tuple rate limits; identical `202 Accepted` neutral JSON + timing equalization on `request-otp` regardless of org/phone/verification state; uniform generic `INVALID_RESET_REQUEST` on `confirm`. |
| **2. Online OTP Brute Force** | Firing rapid OTP guesses (`000000`–`999999`) against `confirm`. | Short expiry (`<= 10m`), max `3–5` failed attempts atomically burning the challenge, per-`(IP+tuple)` & per-`tuple` rate limits (`PO-04`). |
| **3. SMS Pumping / Flooding DoS** | Flooding `request-otp` to harass employees, constantly burn OTPs, or rack up telco SMS billing (toll fraud). | Phase 1 **`PO-02` Indian-only `+91[6-9]` allowlist** (blocks international premium toll routes); pre-DB `60s` resend cooldown + hourly/daily per-tuple SMS quota; IP/subnet caps; `DEC-10` gateway vendor geo-fencing & anomaly alerts. |
| **4. Concurrent Replay / Race Condition** | Sending multiple simultaneous `confirm` calls with the same OTP to race GoTrue updates. | Short TX `FOR UPDATE` row lock + atomic `used_at = NOW()` burn committed before calling `admin.updateUserById`. Second request blocks cleanly on lock and sees `used_at IS NOT NULL`. |
| **5. Offline SQL Backup / Log Breach** | Attacker dumps DB rows or logs to precompute all $10^6$ numeric OTP digests. | Plaintext OTP never reaches PostgreSQL or logs; `otp_hmac` uses keyed `HMAC-SHA256` with domain separation (`org:user:challenge_id:otp`) and Express-only `OTP_HMAC_PEPPER`. |
| **6. Cross-Tenant or Stale-Phone Hijack** | Employee shares same mobile in `ACME` and `BETA`, or changes mobile mid-recovery. | Challenge uniquely scoped by `(organization_id, user_id)` and HMAC-bound; changing `public.users.phone_number` atomically invalidates active challenges (`PHONE_CHANGED`); `confirm` verifies snapshot parity and `phone_verified_at IS NOT NULL`. |
| **7. Stolen Session Persistence** | Thief holds active access/refresh JWT obtained prior to victim's password reset. | Global GoTrue `signOut`, `tokens_valid_after_epoch` advance, and `revoked_sessions` invalidate refresh and access tokens immediately post-reset. |
| **8. Rogue Admin Credential Impersonation** | Compromised Admin sets victim's password or alters a `SUPER_ADMIN`'s phone/recovery flow. | Admins never see/set passwords; `ADMIN` blocked from resetting `SUPER_ADMIN`; self-reset prohibited; lost-mobile fallback requires strict identity check, audit trail, and unfinalized Maker-Checker governance review. |

#### 6.3.5 Admin-Assisted Recovery Alternative (Lost / Inaccessible Registered Mobile — Operational Workflow NOT Finalized)
- **Trigger Condition:** Employee physically loses SIM / access to their registered Indian mobile number (`+91XXXXXXXXXX`) and cannot receive `PO-03` SMS OTPs.
- **Security Invariants That Remain Non-Negotiable:**
  1. Administrators **MUST NEVER** create, set, view, or learn the employee's permanent password.
  2. Tenant/role hierarchy remains strict: caller must hold same-tenant `ADMIN` or `SUPER_ADMIN`; **`ADMIN` is strictly blocked (`403 FORBIDDEN`) from recovering or reassigning a `SUPER_ADMIN` account**; self-recovery is blocked (`actor_user_id != target_user_id`).
  3. Immediate global session revocation + mandatory `audit_logs` trail (`reason >= 10` chars + out-of-band identity verification evidence reference).
- **Proposed Operational Pathways *(NOT Silently Finalized — Requires Formal PO Operational Approval)*:**
  - *Candidate Pathway 1 (Maker-Checker Mobile Re-Binding -> Normal `PO-03` OTP):* Out-of-band KYC verification of the new Indian mobile (`PO-02` normalized `+91XXXXXXXXXX`) -> optional Maker-Checker dual approval updates `public.users.phone_number` (leaving immutable `PO-01` `synthetic_email` untouched!), invalidates stale OTPs, marks `phone_verified_at`, and employee completes standard `PO-03` self-service SMS OTP recovery independently.
  - *Candidate Pathway 2 (Maker-Checker One-Time Opaque Reset Link — Option A):* Out-of-band KYC verification -> dual-control Admin initiation (`/api/v1/admin/users/:userId/reset-password`) issues a separate high-entropy 256-bit CSPRNG `PASSWORD_RESET` opaque token in `account_activation_tokens` (`SHA-256` hashed, TTL e.g. `30m`, distinct endpoint from numeric OTPs) enabling the employee to set their own replacement password without receiving an SMS at the lost number.
  - **Explicit Unresolved Boundary:** Operational Maker-Checker threshold (e.g., whether standard employees also require `Maker != Checker` dual approval for SIM-swap/lost-mobile recovery vs `ADMIN`/`SUPER_ADMIN` targets only, mandatory verification documents, and cooling window) is **NOT finalized** in this task and must be confirmed explicitly before Phase `2.2F` Admin fallback implementation.

### 6.4 Authenticated Password Changes (`/auth/change-password` & `/auth/first-login-change`)
- Retained unchanged under `DEC-09` and `PO-01`: active users verify `currentPassword` against GoTrue before invoking `admin.updateUserById`, trigger global session revocation, clear `must_change_password = FALSE`, and emit `audit_logs`.

---

## 7. Mobile Number Normalization & Edge-Case Policy (`PO-02` APPROVED / CLOSED — 2026-11-10)

**Policy Gap Discovered in Current Pre-Task-2.2C Codebase:** [`validateLoginPayload`](file:///Users/mac/Desktop/HRMS/shared/src/auth/schemas.ts#L47-L55), [`validateCreateUserPayload`](file:///Users/mac/Desktop/HRMS/shared/src/tenant/schemas.ts#L196-L202), and Migration `00002` (`chk_users_phone_format`: `phone_number ~ '^\+?[0-9]{10,15}$'`) strip spaces/hyphens/parens or permit non-canonical strings, leaving `+919876543210`, `919876543210`, and `9876543210` as non-identical values and failing to enforce Phase 1 India-only normalization. Task `2.2C` implementation must align shared validators, server normalization, and Migration `00004` DB constraints with the approved `PO-02` policy below.

**Approved Canonical Normalization Specification (`PO-02` — OFFICIALLY APPROVED / CLOSED `2026-11-10`):**

- **Phase 1 Geographic Scope:** Phase 1 supports **Indian mobile numbers only**. International phone numbers are **not** supported.
- **Canonical Storage Format:** Strict E.164 `+91XXXXXXXXXX` matching `^\+91[6-9][0-9]{9}$` (`+91` followed by 10 national significant digits starting with `6`, `7`, `8`, or `9`).
- **Preprocessing & Strict Parsing:** Trim surrounding whitespace and strip common spaces (` `) and hyphens (`-`) before validation. Accept **only** the three supported Indian mobile input shapes below; never silently truncate, guess, or reinterpret invalid numbers, and reject arbitrary prefixes (such as leading `0` trunk prefixes or `0091`).
- **Server-Authoritative Enforcement:** Shared schemas and Express routes accept the supported input forms and normalize **authoritatively on the server** before account lookup, provisioning, uniqueness checks, and login (never trust client-supplied pre-normalized strings). Login failures must return generic `401 INVALID_CREDENTIALS` errors without revealing whether an organization or phone number exists.

| Rule / Pattern | Example Input | Approved `PO-02` Behavior | Canonical Result / Outcome | Status |
|---|---|---|---|---|
| **1. Preprocessing** | `" +91 98765-43210 "` | Trim outer whitespace and strip common spaces and hyphens before validating prefix and 10 national significant digits. | `+919876543210` | **Approved (`PO-02`)** |
| **2. 10-Digit Indian Mobile** | `"9876543210"` | Exactly 10 digits with first digit in `[6-9]` and no prefix -> prepend `+91`. | `"+919876543210"` | **Approved (`PO-02`)** |
| **3. Country-Code Form (`91`)** | `"919876543210"` | Exactly 12 digits starting with `91`, followed by 10 national digits starting with `[6-9]` -> normalize to `+91XXXXXXXXXX`. | `"+919876543210"` | **Approved (`PO-02`)** |
| **4. International-Prefix Form (`+91`)** | `"+919876543210"` | Starts with `+91` followed by exact 10 national digits starting with `[6-9]` -> retain `+91XXXXXXXXXX`. | `"+919876543210"` | **Approved (`PO-02`)** |
| **5. Leading `0` / Arbitrary Prefixes** | `"09876543210"`, `"00919876543210"`, `"+09876543210"` | Reject arbitrary prefixes immediately. Do **not** strip trunk `0` or guess user intent. | **Rejected** (`400` / generic `401` on login) | **Approved (`PO-02`)** |
| **6. International Numbers & Unsupported Country Codes** | `"+14155552671"`, `"+447911123456"` | International phone numbers are **not supported in Phase 1**. Reject unsupported country codes without exception. | **Rejected** (`400` / generic `401` on login) | **Approved (`PO-02`)** |
| **7. Landlines, Short Codes & Malformed Inputs** | `"+915876543210"`, `"01123456789"`, `"12345"`, `"987654321012"`, `"abc"` | Reject national digits starting outside `[6-9]`, landlines, short codes, wrong digit counts, and non-numeric strings; never truncate or coerce. | **Rejected** (`400` / generic `401` on login) | **Approved (`PO-02`)** |
| **8. Duplicate Within Same Organization** | `"9876543210"` and `"+919876543210"` in `ACME` | Pre-write server normalization yields identical `+919876543210`, blocked deterministically by `uq_users_org_phone (organization_id, phone_number)` and active provisioning checks. | **Rejected** (`409 CONFLICT`) | **Approved (`PO-02` + `DEC-13`)** |
| **9. Reuse Across Different Organizations** | `"+919876543210"` in `ACME` & `BETA` | Permitted cleanly. Tenant-scoped uniqueness allows the same canonical Indian number across separate orgs, each mapping to a distinct `public.users` row, `auth.users.id`, and `PO-01` synthetic email. | **Allowed** | **Approved (`PO-02` + `DEC-13`)** |
| **10. Mobile Number Updates** | `"+919876543210"` -> `"9988776655"` (`"+919988776655"`) | Server normalizes and validates new Indian mobile -> updates `public.users.phone_number` atomically (enforcing `uq_users_org_phone`) + writes `audit_logs`. Approved `PO-01` Scheme 3 `synthetic_email` (`<immutable_uuid>@auth.hrms.internal`) **remains completely unchanged**. | Atomic PG update | **Approved (`PO-01` + `PO-02`)** |

> **Canonical Normalization Invariant (`PO-02` Approved):** Server storage (`public.users.phone_number`, `account_provisioning_requests.phone_number`), pre-auth lookup (`hrms_internal.resolve_login_identity`), provisioning uniqueness checks, and Migration `00004` `CHECK` constraints (`^\+91[6-9][0-9]{9}$`) must store and accept **only** canonical `+91XXXXXXXXXX`. UI login remains strictly `Organization Code + Mobile Number + Password` (`DEC-13`), with zero email input.

---

## 8. Authentication Rate Limiting & Error-Response Policy (`PO-04` APPROVED / CLOSED — 2026-11-10)

### 8.1 Approved `PO-04` Policy Decisions (`2026-11-10`)
| Control | Approved Policy (`PO-04`) |
|---|---|
| **Failed login threshold** | **`5` failed attempts per account within a rolling `15-minute` window** |
| **Account protection** | **Temporary throttling**; **never** permanently disable or lock an account due only to failed login attempts |
| **IP protection** | Additional **IP-based rate limiting** to mitigate automated attacks |
| **Invalid credentials** | **`HTTP 401`** |
| **Rate limit exceeded** | **`HTTP 429`** |
| **Credential error message** | **Identical generic message** for unknown organization, unknown mobile number, inactive/unactivated account, and incorrect password |
| **Unknown accounts** | Apply **equivalent account-based throttling** before identity lookup; never create an account-enumeration bypass |
| **Audit logging** | Record security-relevant failed attempts and throttling events without passwords, OTPs, raw activation tokens, tokens, or authentication secrets |

### 8.2 Architectural & Concurrency Implementation Requirements
1. **Privacy-Preserving Account Key (Normalized Identity):**
   - Compute account throttling keys from a **keyed hash** (`HMAC-SHA256(RATE_LIMIT_HMAC_KEY, normalizedOrgIdentity + ":" + canonicalPhone)`) using normalized organization code/identity and canonical E.164 mobile number (`PO-02`).
   - **Strictly prohibit** storing raw passwords or exposing raw mobile numbers inside rate-limit keys, cache entries, or audit logs.
2. **Shared Atomic Rolling Window (`5` Attempts / `15` Minutes):**
   - Apply the `5`-attempt / `15`-minute rolling window consistently across login endpoints and concurrent requests.
   - Counters **MUST be atomic and shared across all backend Express instances** (e.g., PostgreSQL transactional `public.auth_rate_limits` sliding window or atomic Redis operations). Per-process in-memory JavaScript `Map` counters are prohibited in production/multi-instance setups.
3. **Additional IP-Based Rate Limiting & Trusted Proxy Handling:**
   - Apply a separate IP-based rate limit in addition to account-based throttling to mitigate distributed spray attacks, credential stuffing, and infrastructure DoS.
   - Configure `express.set('trust proxy', ...)` strictly pinned to verified reverse-proxy hops; **never trust arbitrary client-supplied forwarding headers** (`X-Forwarded-For`, `Forwarded`).
   - *Implementation Configuration Boundary:* Specific numerical IP rate-limit ceilings, burst parameters, and temporary throttling window/backoff tuning beyond the approved account threshold (`5` fails / `15` minutes) are **implementation configuration values to be established and load-tested**, NOT pre-approved fixed policy numbers.
4. **Temporary Throttling & Eligibility to Retry (Zero Permanent Lockout):**
   - Throttling is strictly **temporary**: failing 5 times within the rolling 15-minute window blocks subsequent login attempts for that account key until the rolling window ages out (attempts older than 15 minutes expire) or the temporary throttle window elapses.
   - `public.users.is_active` is **never** modified or deactivated due only to failed login attempts.
5. **Identical Generic `HTTP 401` Credential Errors:**
   - Unknown organization, inactive organization, unknown phone, inactive user, unactivated user (`activated_at IS NULL`), and wrong password MUST return the exact same `HTTP 401 INVALID_CREDENTIALS` structure and message (`"Invalid organization code, phone number, or password."`), disclosing zero lookup-stage details.
6. **Generic `HTTP 429` Rate-Limit Responses & Unknown Accounts:**
   - Execute both account-keyed and IP-based rate-limit checks **before** DB lookups (`resolve_organization_by_code` / `resolve_login_identity`).
   - Returning **`HTTP 429 TOO_MANY_REQUESTS`** cleanly with a generic error payload (`"Too many login attempts. Please wait and try again later."`) prevents distinguishing valid from nonexistent organization/mobile tuples (equivalent throttling applies to unknown accounts).
   - Include `Retry-After` HTTP header (integer seconds) **only when a reliable retry timestamp is available** from the shared atomic counter store.
7. **Successful Authentication Counter Handling:**
   - On successful login (`200 OK`), clear/reset the **account-scoped** failure counter so genuine users recover cleanly from prior isolated typos.
   - **Do NOT reset or clear IP-based rate-limit counters** on successful authentication, preventing attackers from laundering or resetting an abusive IP limit via valid logins from the same IP.
8. **Audit Logging & Secret Exclusion:**
   - Append immutable security events (`LOGIN_FAILURE`, `LOGIN_RATE_LIMITED`, `LOGIN_SUCCESS`) recording event type, timestamp, outcome, masked IP, correlation ID, and privacy-safe keyed tuple identifier (`HMAC` digest / `user_id` if known).
   - **Strictly omit** passwords, OTP values, raw activation tokens, `accessToken`, `refreshToken`, `synthetic_email`, or secret material.
9. **Scope Separation (`PO-03` OTP & Initial Activation Unaffected):**
   - `PO-04` specifically governs **authentication login rate limiting** (`POST /api/v1/auth/login`).
   - It does **not** alter `PO-03` approved password-recovery OTP policies (60s resend cooldown / attempt caps / challenge TTL) or Initial Account Activation OTP policies, though recovery and activation endpoints independently enforce pre-DB anti-enumeration IP/tuple throttling using compatible privacy-preserving HMAC keys.

### 8.3 Timing and Enumeration Protection (Practical Bounds & Residual Risks)
- **Why Local Fast-Fail Leaks Exist:** Pre-auth DB lookups (`resolve_organization_by_code` + `resolve_login_identity`) finish in ~1–5ms when an org or employee is missing, inactive, or unactivated, whereas existing activated accounts proceed to a remote HTTP call to Supabase Auth GoTrue (`signInWithPassword`), which performs TLS/HTTP round-trip I/O, GoTrue `auth.users` SQL lookup, and GoTrue bcrypt verification.
- **What Local Dummy Bcrypt Achieves vs Does Not Achieve:**
  - *Achieves:* Running an in-process asynchronous bcrypt verification on miss eliminates the obvious ~100ms fast-fail cliff against casual probes, without firing bogus HTTP calls into GoTrue (which would exhaust GoTrue rate limits or HTTP sockets).
  - *Does NOT Achieve:* In-process dummy bcrypt **cannot guarantee exact constant-time equality** with a full remote GoTrue call! It does not replicate GoTrue network RTT variance, TLS/HTTP overhead, GoTrue's internal `auth.users` / `auth.sessions` DB latency, or an identical cost factor if GoTrue's cost differs.
- **Residual Timing Risks & Practical Mitigations:**
  - *Residual Risk:* An attacker permitted to fire high sample volumes ($N \gg 50$ repeated probes) could apply statistical distribution analysis (mean/median/variance tail comparison) to infer whether a path executed locally in Express vs remotely in GoTrue.
  - *Layered Practical Mitigations:*
    1. Enforce pre-lookup account & IP rate limits (Section 8.2) **before** executing DB lookups or dummy hashing, starving attackers of sample counts needed for statistical significance.
    2. Combine dummy CPU work with a calibrated minimum latency floor (measured dynamically from rolling failed GoTrue calls via EWMA + small random jitter) capped with a concurrency guard so Node.js libuv threads cannot be saturated during traffic spikes.
    3. Preserve strictly identical HTTP status `401` (`INVALID_CREDENTIALS`), headers, and JSON body size across unknown organization, inactive organization, unknown employee, inactive employee, unactivated employee, and wrong password cases.

---

## 9. Refresh Token Transport, Browser Security & Concurrent Device Sessions (`PO-05` & `PO-07` APPROVED / CLOSED — 2026-11-10)

### 9.1 Approved `PO-05` Policy: Strict Separation of Refresh vs. Access Tokens
- **Refresh Tokens MUST NEVER Appear in JSON, Storage, or Logs:** Refresh tokens MUST be transported exclusively in **`Secure`, `HttpOnly` cookies** (`Set-Cookie`) and MUST NEVER be returned in JSON response bodies or exposed to browser JavaScript, `localStorage`, `sessionStorage`, URLs, analytics, or application logs.
- **Access Tokens (`Authorization: Bearer`):** Short-lived access JWTs remain returned in JSON (`tokens.accessToken`), held strictly in browser JavaScript memory (never `localStorage`/`sessionStorage`), sent via `Authorization: Bearer`, and verified by Express on protected API calls. *(Note: Current [`AuthTokens`](file:///Users/mac/Desktop/HRMS/shared/src/auth/contracts.ts#L22-L27) in `shared/src/auth/contracts.ts` includes `refreshToken` as a pre-2.2C baseline interface and MUST be updated in Task `2.2C`/`2.2D` to omit `refreshToken` from JSON responses.)*

### 9.2 Refresh Cookie Configuration & Environment Attributes (Section A)
| Attribute | Same-Site / Same-Origin Topology *(Recommended)* | Cross-Site Topology *(Unresolved Split Deployment Fallback)* | Local HTTP Dev (`NODE_ENV=development` Only) |
|---|---|---|---|
| **Cookie Name** | **`__Host-hrms_refresh_token`** | **`__Host-hrms_refresh_token`** | `hrms_refresh_token_dev` *(prefix drops only if TLS absent locally)* |
| **`HttpOnly`** | **`true`** | **`true`** | **`true`** |
| **`Secure`** | **`true`** (HTTPS enforced) | **`true`** (Mandatory for `SameSite=None`) | Conditional on local HTTPS (`false` on plain `http://localhost` only) |
| **`Path`** | **`/`** *(Required by `__Host-` spec)* | **`/`** *(Required by `__Host-` spec)* | `/` |
| **`Domain`** | **Omitted** *(Required by `__Host-` prefix; binds strictly to host)* | **Omitted** *(Required by `__Host-`)* | Omitted |
| **`SameSite`** | **`Lax`** *(or `Strict` where zero cross-site top-level flows exist)* | **`None`** *(NEVER valid or safe without `Secure=true` + explicit CSRF)* | `Lax` |
| **Expiry (`Max-Age`)** | Aligned with configured GoTrue refresh-token session lifetime | Aligned with configured GoTrue refresh-token session lifetime | Matches session lifetime |

- **Cookie Clearing Behavior:** On **`POST /api/v1/auth/logout`** OR **any refresh failure** (`401`, reuse detected, expired session, inactive user), Express clears the cookie (`Set-Cookie: <name>=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=...` matching original attributes).

### 9.3 Mandatory CSRF Protection (Section B)
Required on `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`, and any future cookie-authenticated state-changing endpoint:
1. **Signed Double-Submit CSRF Token (or Synchronizer Token):**
   - Upon login/session establishment, Express issues a cryptographically signed CSRF token (`HMAC-SHA256` bound to session/nonce using server CSRF secret, delivered via readable companion cookie/endpoint or response header). Browser JS transmits this token in custom header **`X-CSRF-Token`**.
   - Express verifies signature and constant-time equality (`crypto.timingSafeEqual`).
   - **Critical Invariant:** CSRF tokens are **NOT authentication credentials** and can never authorize access or mint sessions without a valid `HttpOnly` refresh cookie or verified bearer JWT.
2. **Explicit `Origin` Header Validation (Do NOT Rely on CORS Alone):**
   - Express validates `req.headers.origin` explicitly against `env.CORS_ALLOWED_ORIGINS` before invoking GoTrue or mutating state.
   - **Missing / Malformed / Null / Untrusted `Origin`:** Requests to `/auth/refresh` and `/auth/logout` with missing `Origin`, unparseable URL, `Origin: null`, or unlisted origins are **rejected immediately with `HTTP 403 CSRF_ORIGIN_REJECTED`** (fail closed).

### 9.4 CORS, Origin Allowlisting & Reverse Proxies (Section C)
- **Explicit Allowlist (`CORS_ALLOWED_ORIGINS`):** Strict comma-separated exact origins (`https://...`); never wildcard `*`.
- **No Wildcard with Credentials:** `Access-Control-Allow-Origin: *` MUST NEVER be sent alongside `Access-Control-Allow-Credentials: true`.
- **Approved Origins Only:** Reflect only exact allowlisted `Origin` with `Access-Control-Allow-Credentials: true` and `Vary: Origin`. Reject untrusted origins (`403` on credentialed routes; omit `Allow-Origin` on preflight).
- **Preflight & Headers:** `OPTIONS` allows `GET, POST, PUT, PATCH, DELETE, OPTIONS` and headers `Authorization, Content-Type, X-CSRF-Token, Idempotency-Key`.
- **Trusted Proxies:** `express.set('trust proxy', ...)` pinned strictly to known reverse-proxy hops so attackers cannot forge `X-Forwarded-Proto` or `X-Forwarded-Host` to bypass `Secure` cookie checks.

### 9.5 Refresh-Token Rotation, Reuse Detection & Concurrent Refresh Coordination (Section D)
- **Single-Use Rotation (`PO-05` + `config.toml` verified):** Every successful `POST /api/v1/auth/refresh` exchanges the cookie's refresh token at GoTrue (`enable_refresh_token_rotation = true`), updates the keyed digest stored in `public.user_sessions` (`refresh_token_hmac`), emits the newly rotated `__Host-hrms_refresh_token` `HttpOnly` cookie, and returns a new short-lived `accessToken` in JSON (`expiresIn: 900`, `PO-06`). Previous refresh tokens MUST NOT remain accepted outside the controlled concurrency grace window.
- **Explicit Non-Atomicity Notice Across GoTrue, PostgreSQL & HTTP Delivery:**
  > Refresh rotation spans GoTrue (`refreshSession`), Express PostgreSQL updates (`user_sessions.refresh_token_hmac` / `last_activity_at`), and HTTP `Set-Cookie` emission. **GoTrue and PostgreSQL do NOT form one atomic transaction across refresh rotation.** If the client drops connection after GoTrue rotates `RT_0 -> RT_1` before receiving `Set-Cookie`, or if the PostgreSQL write fails after GoTrue rotates, Express must **never** weaken single-use rotation: the request fails closed (`401 INVALID_REFRESH_SESSION`), clears any stale cookie, and the device cleanly re-authenticates via `POST /api/v1/auth/login` creating a fresh independent session.
- **Concurrent Refresh Coordination (Preventing False-Positive Theft Revocation):**
  1. **Client-Side Serialization (In-Memory Only):** Within each tab, browser code uses an in-memory single-flight refresh promise (`refreshPromise`) so parallel `401` API responses dispatch at most one `POST /api/v1/auth/refresh`. Multi-tab coordination on the same origin may optionally use in-memory browser channels (`BroadcastChannel` / Web Locks `navigator.locks` without ever persisting tokens in `localStorage`/`sessionStorage`) so sibling tabs do not race identical cookies simultaneously.
  2. **Server-Side Per-Session Serialization & Grace Matching:** Express computes `incomingHmac = HMAC-SHA256(SESSION_TOKEN_HMAC_KEY, cookieRefreshToken)`. Inside a `READ WRITE` transaction, Express calls `hrms_internal.issue_tx_challenge()` (`hrms_context_verifier`) -> `(txXid, challengeNonce)`, signs `p_tx_proof` (`op = 'LOOKUP_REFRESH_HMAC'`, `target_id = incomingHmac`, `org_id = 00000000-0000-0000-0000-000000000000`, `actor_user_id = 00000000-0000-0000-0000-000000000000`, `session_id = 00000000-0000-0000-0000-000000000000`) with `TX_CONTEXT_HMAC_KEY`, and locates the session via `hrms_internal.lookup_session_by_refresh_hmac(p_tx_proof, incomingHmac)` (`hrms_session_manager`, `NOBYPASSRLS`, matching `refresh_token_hmac` or bounded-grace `prev_refresh_token_hmac` within `refresh_token_reuse_interval`, Section 9.6.7). Express then enters `withTenantTransaction(organization_id, ..., session.user_id)` (`SET LOCAL app.current_org_id` + `SET LOCAL app.current_user_id` strictly scoped to the verified cookie session), obtains a fresh per-transaction `(txXid, challengeNonce)` via `issue_tx_challenge()`, acquires a bounded per-session server coordination lock, verifies pre-GoTrue preconditions under `FORCE RLS` (`revoked_at IS NULL`, `expires_at > NOW()`, `users.is_active = TRUE`, `organizations.is_active = TRUE`), calls GoTrue `refreshSession`, verifies JWKS `sub === session.user_id`, and rotates via `hrms_internal.rotate_user_session(rotateTxProof, ...)`. Within GoTrue's configured grace interval (`refresh_token_reuse_interval = 10`s locally; **exact multi-tab grace behavior in GoTrue `v2.197.0` MUST be live-verified in Task `2.2H`**), legitimate nearly-simultaneous refreshes resolve cleanly without revoking the session family.
- **Confirmed Reuse Detection & Scoped Token-Family Revocation:**
  - When a previously rotated refresh token is presented *outside* the bounded grace window, rejected by GoTrue reuse detection, or replayed after rotation/revocation:
    1. Revoke **ONLY the affected session / token family** inside a tenant transaction via `hrms_internal.issue_tx_challenge()` + signed `p_tx_proof` (`op = 'REVOKE_COMPROMISED_FAMILY'`, `target_id = session.id`) -> `hrms_internal.revoke_compromised_session_family(p_tx_proof, session.id, jwtExp)` (`public.user_sessions.revoked_at = NOW(), revoked_reason = 'REFRESH_REUSE_DETECTED'`, inserting ONLY its `gotrue_session_id` into `public.revoked_sessions` without touching `tokens_valid_after_epoch`), leaving the employee's other unrelated healthy device sessions active (`PO-07` #10).
    2. If Express still holds a verified session JWT or GoTrue didn't already kill the family, ensure GoTrue session termination (`admin.signOut(jwt, 'local')` when JWT is returned/available; live-verified in Task `2.2H`).
    3. Emit `Set-Cookie: __Host-hrms_refresh_token=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=...`.
    4. Append `REFRESH_TOKEN_REUSE_DETECTED` security event to `audit_logs` (Section 9.6.6).
    5. Return uniform `HTTP 401 INVALID_REFRESH_SESSION` forcing fresh login on that compromised device.

### 9.6 Concurrent Device Session Architecture (`PO-07` APPROVED / CLOSED — 2026-11-10)

#### 9.6.1 Approved `PO-07` Policy Rules
| Policy Rule | Approved Requirement (`PO-07` — `2026-11-10`) |
|---|---|
| **1. Multiple devices allowed** | Employees may remain logged in simultaneously across multiple browsers/devices (phone, desktop, tablet, PWA). |
| **2. Independent sessions** | Every login mints an independently identifiable HRMS application session mapped 1:1 to a distinct GoTrue session/family. |
| **3. No arbitrary device limit** | **Zero fixed initial maximum device count.** Do not cap or silently evict sibling sessions on login. |
| **4. Session visibility** | Employees can inspect active sessions showing non-sensitive device/browser info, approximate IP info, creation time, `isCurrent`, and `lastActivityAt` where available. |
| **5. Individual revocation** | Employees can revoke a selected active session individually without disrupting their other active devices. |
| **6. Revoke all sessions** | Employees can explicitly sign out of all active devices simultaneously. |
| **7. Password change** | Successful password change (`/reset-password/confirm`, `/change-password`, `/first-login-change`) revokes **all** existing sessions across devices, requiring fresh authentication. |
| **8. Account deactivation** | Deactivating an employee (`users.is_active = FALSE` + GoTrue ban) immediately revokes **all** their sessions. |
| **9. Administrative revocation** | Authorized same-tenant `ADMIN` / `SUPER_ADMIN` (`ADMIN` strictly blocked from `SUPER_ADMIN`) can revoke all sessions for a target employee with immutable `audit_logs` trail and mandatory `reason`. |
| **10. Refresh-token reuse** | Detected refresh-token reuse triggers revocation of the affected token family + `REFRESH_TOKEN_REUSE_DETECTED` audit logging. |

#### 9.6.2 Session Identity & Storage Model (Section A)
1. **Unique Session Identity & Authority Split (GoTrue vs. HRMS Tables):**
   - **GoTrue Internal Session Family (`auth.sessions` + `auth.refresh_tokens`):** Authoritative cryptographic credential engine managed exclusively by Supabase GoTrue behind Express. Mints `session_id` UUID claims inside `ES256` JWTs (`900s` expiry under `PO-06`), handles refresh-token rotation chains, and detects token reuse. Strictly inaccessible to `hrms_app_user` and untrusted clients.
   - **HRMS Application Session Registry (`public.user_sessions` — Proposed Migration `00004`):** Tenant-isolated PostgreSQL table (`ENABLE` + `FORCE ROW LEVEL SECURITY`) owned by schema/broker privilege boundaries (`REVOKE` direct client/app DML, mediated via controlled `SECURITY DEFINER` routines):
     - Primary Identity: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` (exposed safely as the session identifier in UI/API lists), `organization_id UUID`, `user_id UUID` (composite tenant FK `(organization_id, user_id) REFERENCES public.users(organization_id, id) ON DELETE CASCADE`), and **`gotrue_session_id UUID NOT NULL UNIQUE`** bound directly to the verified GoTrue JWT `session_id` claim extracted at login.
     - Secure Token Binding (Zero Plaintext Storage): Persists **`refresh_token_hmac CHAR(64) NOT NULL`** (and bounded-grace `prev_refresh_token_hmac CHAR(64)`, `prev_rotated_at TIMESTAMPTZ`), computed in Express memory via `HMAC-SHA256(SESSION_TOKEN_HMAC_KEY, rawRefreshToken)`. **`SESSION_TOKEN_HMAC_KEY` resides exclusively in Express runtime secret storage (never in PostgreSQL). Plaintext refresh tokens and plaintext access JWTs are NEVER stored in any application table or log.**
     - Privacy-Safe Visibility Metadata: `device_summary VARCHAR(200)` (parsed non-sensitive UA description, e.g. `"Chrome 141 · Android"`), `approx_ip VARCHAR(64)` (masked network prefix e.g. IPv4 `/24` or IPv6 `/48`, never sensitive raw token secrets), `last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `created_at`, `expires_at`, `revoked_at`, `revoked_reason`, `revoked_by_user_id`.
   - **Compact Active-JWT Revocation Blocklist (`public.revoked_sessions` — Proposed Migration `00004`):** Indexed solely by `session_id UUID PRIMARY KEY` (matching GoTrue JWT `session_id` claim), `organization_id`, `user_id`, `revoked_reason`, `revoked_at`, `expires_at` (`exp + clock_skew`). Keeps protected-route revocation lookup $O(1)$ and self-expiring within 15 minutes (`PO-06`).

#### 9.6.3 Complete Session Lifecycle (Section B)
1. **Login & Session Creation:** `POST /api/v1/auth/login` verifies org/phone/credentials against GoTrue -> verifies issued access JWT via JWKS (`verifySupabaseToken`) -> extracts `sub` and verified `session_id` claim -> computes `HMAC-SHA256(refreshToken)` -> inserts a new `public.user_sessions` row (`id`, `organization_id`, `user_id`, `gotrue_session_id`, `refresh_token_hmac`, parsed `device_summary`, `approx_ip`, `last_activity_at = NOW()`, `expires_at` matching GoTrue refresh lifetime) -> sets `__Host-hrms_refresh_token` `HttpOnly` cookie -> returns JSON access JWT (`expiresIn: 900`, zero `refreshToken`) -> appends `SESSION_CREATED`. No limit check evicts existing sessions on other devices.
2. **Refresh-Token Rotation:** Handled per Section 9.5 via `POST /api/v1/auth/refresh` (validates `Origin` + `X-CSRF-Token`, matches `refresh_token_hmac` / grace `prev_refresh_token_hmac` on unrevoked session, rotates via GoTrue, updates `refresh_token_hmac` and `last_activity_at`, emits new `HttpOnly` cookie + JSON access JWT, appends `SESSION_REFRESHED`).
3. **Last-Activity Updates:** Unconditionally updated inside `POST /api/v1/auth/refresh`, and **debounced** on authenticated API calls inside `resolveTenantContext` / async tail update (updating `last_activity_at = NOW()` only when `NOW() - last_activity_at >= INTERVAL '60 seconds'` to avoid hot-row write amplification under concurrent UI fetches).
4. **Individual Session Revocation:** Employee invokes `DELETE /api/v1/auth/sessions/:sessionId` (or `POST /api/v1/auth/logout` `{ scope: 'local' }`): after backend JWT verification (`requireAuth` -> `resolveTenantContext`, or for cookie-only `/logout`, verified high-entropy `lookup_session_by_refresh_hmac(p_tx_proof, incomingHmac)` possession proof), Express opens `withTenantTransaction(orgId, ..., verifiedUserId)` (`app.current_org_id` and `app.current_user_id` set strictly transaction-locally), obtains `(txXid, challengeNonce)` from `hrms_internal.issue_tx_challenge()`, signs `p_tx_proof` (`op = 'REVOKE_SESSION'`, `target_id = sessionId`), and calls `hrms_internal.revoke_user_session(p_tx_proof, sessionId, jwtExp)` owned by `hrms_session_manager` (`NOBYPASSRLS`) — **zero `p_actor_user_id` parameter**. Inside PostgreSQL, the routine first verifies `p_tx_proof` via `hrms_internal.assert_verified_tx_context`, derives actor strictly from `v_actor_id := public.auth_user_id()` and `v_org_id := public.current_org_id()`, independently verifies active user/org membership, updates **only that single** `public.user_sessions` row matching `id = sessionId AND organization_id = v_org_id AND user_id = v_actor_id AND revoked_at IS NULL`, AND inserts **only its** `gotrue_session_id` into `public.revoked_sessions`. **Strictly preserves `public.users.tokens_valid_after_epoch` and all sibling `public.user_sessions` rows untouched**, ensuring sibling devices stay active! If revoking the current session, invokes `supabaseAdmin.auth.admin.signOut(currentJwt, 'local')` *(never `'global'` or `'others'`!)* and clears `__Host-hrms_refresh_token` (`Max-Age=0`). When revoking a *remote* device session where Express does not hold the remote JWT, Express blocks both API calls (via `revoked_sessions`) and refresh attempts (via `user_sessions.revoked_at` HMAC lookup prior to returning tokens; lazy `admin.signOut` if triggered) — while Task `2.2H` verifies live whether GoTrue `v2.197.0` supports direct remote `session_id` termination. Appends `SESSION_REVOKED`.
5. **Employee Revoke-All Sessions:** Employee invokes `POST /api/v1/auth/sessions/revoke-all` (or `POST /api/v1/auth/logout` `{ scope: 'global' }`): inside `withTenantTransaction(orgId, ..., verifiedUserId)`, Express obtains `(txXid, challengeNonce)` from `issue_tx_challenge()`, signs `p_tx_proof` (`op = 'REVOKE_OWN_ALL'`, `target_id = verifiedUserId`), and executes `hrms_internal.revoke_own_all_sessions(p_tx_proof, 'USER_GLOBAL_LOGOUT', triggeringGotrueSessionId, jwtExp)` under `hrms_session_manager` (`NOBYPASSRLS`, `FORCE RLS`) — **zero `p_actor_user_id` or `p_target_user_id` parameter!** PostgreSQL validates `p_tx_proof`, derives target strictly from verified `(v_org_id, v_actor_id)`, atomically revokes **all** active `user_sessions` for that user, advances `public.users.tokens_valid_after_epoch = EXTRACT(EPOCH FROM date_trunc('second', NOW()))::BIGINT + 1`, inserts `triggeringGotrueSessionId` into `revoked_sessions`, invokes `admin.signOut(currentJwt, 'global')`, clears `__Host-hrms_refresh_token` (`Max-Age=0`), and appends `ALL_SESSIONS_REVOKED`.
6. **Password-Change Revocation:**
   - *Authenticated `/change-password` & `/first-login-change`:* Calls `hrms_internal.revoke_own_all_sessions(p_tx_proof, 'PASSWORD_CHANGE', triggeringGotrueSessionId, jwtExp)` with `op = 'REVOKE_OWN_ALL'` (`target_id = verifiedUserId`; strictly self-scoped via verified `sub` + signed proof, zero arbitrary target ID!).
   - *Unauthenticated `PO-03` `/reset-password/confirm`:* Because no caller JWT exists during OTP recovery, after Express consumes the single-use OTP inside `consume_password_reset_otp(...)` and updates GoTrue's password via `admin.updateUserById`, Express opens `withTenantTransaction(otp.organization_id, ..., otp.user_id)`, calls `issue_tx_challenge()`, signs `p_tx_proof` (`op = 'OTP_REVOKE_ALL'`, `org_id = otp.organization_id`, `actor_user_id = otp.user_id`, `target_id = otpChallengeId`), and calls dedicated **`hrms_internal.otp_revoke_all_user_sessions(p_tx_proof, p_otp_challenge_id)`**. Inside PostgreSQL, **double defense** enforces: (a) `assert_verified_tx_context(p_tx_proof, 'OTP_REVOKE_ALL', p_otp_challenge_id::TEXT)` (proving Express authorized revocation for that exact `otp_challenge_id` inside this PostgreSQL transaction), **AND** (b) atomic single-use `UPDATE public.password_reset_otps SET sessions_revoked_at = NOW() WHERE id = p_otp_challenge_id AND organization_id = v_org_id AND user_id = v_actor_id AND purpose = 'PASSWORD_RESET_OTP' AND used_at IS NOT NULL AND used_at >= NOW() - INTERVAL '60 seconds' AND sessions_revoked_at IS NULL RETURNING user_id` (blocking OTP challenge fabrication, cross-user targeting, or repeat revocation within 60 seconds). Both paths clear refresh cookies, invoke GoTrue global signout (live-verified Task `2.2H`), log `PASSWORD_CHANGE_SESSIONS_REVOKED`, and require fresh `/login`.
7. **Account-Deactivation Revocation:** Interactive Admin/Super Admin deactivation obtains `(txXid, challengeNonce)`, signs `p_tx_proof` (`op = 'ADMIN_REVOKE_ALL'`, `target_id = targetUserId`), and calls `hrms_internal.admin_revoke_all_user_sessions(p_tx_proof, targetUserId, 'ACCOUNT_DEACTIVATED')` alongside GoTrue `ban_duration` and `users.is_active = FALSE` (enforcing same-tenant `user_roles` hierarchy + signed proof inside PostgreSQL); scheduled exit cron deactivations run via system deactivation (`users.is_active = FALSE`) verified inside DB. Both protected requests and `/auth/refresh` fail immediately on `users.is_active = FALSE`.
8. **Administrative Revocation:** Same-tenant `ADMIN` or `SUPER_ADMIN` invokes `POST /api/v1/admin/users/:userId/sessions/revoke-all` with mandatory `reason`: after backend `requireAuth` + `resolveTenantContext` sets verified `app.current_org_id` and `app.current_user_id`, Express obtains `(txXid, challengeNonce)`, signs `p_tx_proof` (`op = 'ADMIN_REVOKE_ALL'`, `target_id = targetUserId`), and calls **`hrms_internal.admin_revoke_all_user_sessions(p_tx_proof, targetUserId, 'ADMIN_REVOKED_ALL')`** — **zero `p_actor_user_id` parameter!** Inside PostgreSQL (`hrms_session_manager`, `NOBYPASSRLS`), the function first validates `p_tx_proof` (`assert_verified_tx_context`), derives acting admin strictly from `v_actor_id := public.auth_user_id()` inside `v_org_id := public.current_org_id()`, independently verifies active org/user status, **queries `public.user_roles` to verify `v_actor_id` holds `'ADMIN'` or `'SUPER_ADMIN'` in `v_org_id` (blocking non-admin callers with `SQLSTATE 42501`), confirms `targetUserId` belongs to `v_org_id`, AND strictly blocks `ADMIN` from revoking a `'SUPER_ADMIN'` target (`SQLSTATE 42501`)**, marks all active `user_sessions` for `targetUserId` revoked (`revoked_by_user_id = v_actor_id`), advances target's `tokens_valid_after_epoch`, invokes GoTrue global revocation/ban check (`2.2H`), and logs `ADMIN_SESSIONS_REVOKED`.
9. **Expiry & Scheduled Cleanup:** Periodic cleanup worker iterates tenant `organization_id` values, enters `SET LOCAL app.current_org_id = org_id`, obtains `(txXid, challengeNonce)` from `issue_tx_challenge()`, signs `p_tx_proof` (`op = 'PURGE_EXPIRED_SESSIONS'`, `org_id = org_id`, `actor_user_id = 00000000-0000-0000-0000-000000000000`, `target_id = org_id`), and calls `hrms_internal.purge_expired_sessions(p_tx_proof)` (`hrms_session_manager`, `NOBYPASSRLS` under `FORCE RLS`): verifies `p_tx_proof` (`org_id = current_org_id()`, `actor_user_id = zero UUID`), then (a) `DELETE FROM public.revoked_sessions WHERE organization_id = current_org_id() AND expires_at < NOW()`, and (b) `DELETE FROM public.user_sessions WHERE organization_id = current_org_id() AND COALESCE(revoked_at, expires_at) < NOW() - INTERVAL '30 days'` (plus cleanup of expired/consumed `hrms_internal.tx_context_challenges` rows via `hrms_context_verifier`, keeping all sweeps `NOBYPASSRLS` and tenant-scoped).

#### 9.6.4 Protected-Request Revocation Enforcement & Tenant Isolation (Section C)
1. **Access JWT Reality (`PO-06` `900s` Window):** Revoking a GoTrue refresh token stops future token refreshes, **not** already-minted stateless `ES256` access JWTs prior to `exp`.
2. **Backend Enforcement on Every Protected Request (`resolveTenantContext` Three-Boundary Privilege Sequence):** `requireAuth` (`verifySupabaseToken` — cryptographic `ES256`/JWKS signature, `iss`, `aud: "authenticated"`, `exp`, `nbf`, UUID `sub`, UUID `session_id`) MUST chain directly into DB-backed `resolveTenantContext` using strictly separated database privileges:
   - *Step 1 (`hrms_auth_lookup_owner`, Pre-Tenant Read-Only Identity Resolution):* Executes `hrms_internal.resolve_auth_user_tenant(sub)` using ONLY `SELECT` on existing granted identity columns (`public.users`, `public.organizations`) — **zero access to `public.user_sessions`, `public.revoked_sessions`, or `context_signing_keys`**. Express enters `withTenantTransaction`, binds `SET LOCAL app.current_org_id = resolved_org_id` and `SET LOCAL app.current_user_id = sub`, calls `hrms_internal.issue_tx_challenge()` (`hrms_context_verifier`), and signs `p_tx_proof` (`op = 'VERIFY_SESSION'`, `org_id = resolved_org_id`, `actor_user_id = sub`, `session_id = p_session_id`, `target_id = p_session_id`).
   - *Step 2 (`hrms_session_manager`, `NOBYPASSRLS` under `FORCE RLS` + `hrms_context_verifier`):* Executes `hrms_internal.verify_authenticated_session_and_roles(p_tx_proof, p_session_id, p_jwt_iat)` inside active tenant RLS (`organization_id = current_org_id()`): first verifies `p_tx_proof` via `assert_verified_tx_context`, derives acting user from verified `public.auth_user_id()`, then checks:
     - **Check 1 (Active Org & User):** Requires `o.is_active = TRUE AND u.is_active = TRUE AND u.activated_at IS NOT NULL`. Deactivated employees/orgs fail immediately (`401 ACCOUNT_INACTIVE`).
     - **Check 2 (Individual & Family Blocklist):** Rejects immediately if `p_session_id` exists in `public.revoked_sessions` (covers individual session revocation & compromised refresh-reuse family revocation).
     - **Check 3 (User-Wide Epoch Cutoff):** Rejects immediately if JWT `iat < u.tokens_valid_after_epoch` (blocks pre-revocation JWTs across *all* remote devices on revoke-all, password change, deactivation, or Admin revocation without affecting individual revocations).
     - **Check 4 (HRMS Session Record Consistency):** Confirms `public.user_sessions` matching `(organization_id, user_id, gotrue_session_id)` has `revoked_at IS NULL AND expires_at > NOW()` (and debounces `last_activity_at = NOW()` when `>= 60s` stale). *(Zero positive caching of revocation checks across requests!)*
3. **Tenant & Role Isolation & Cryptographic GUC Trust Boundary (Task 2.2B.9C):** Both `public.user_sessions` and `public.revoked_sessions` enforce `ENABLE` + `FORCE ROW LEVEL SECURITY` with composite FK `(organization_id, user_id) REFERENCES public.users(organization_id, id)` and server-derived `organization_id` (`DEC-13` / `resolve_auth_user_tenant`). Because custom PostgreSQL GUCs (`app.current_org_id`, `app.current_user_id`) are **caller-settable session variables** that an attacker with `hrms_app_user` SQL access can spoof directly via `SET LOCAL`, GUCs are **NEVER trusted independently on session routines**: every `hrms_session_manager` routine mandates a valid, single-use, transaction-bound `p_tx_proof` verified cryptographically by `hrms_context_verifier` (Section 9.6.8) alongside DB membership/`user_roles` checks, zero direct frontend DB privileges (`anon`, `authenticated`), `REVOKE ALL` from `hrms_app_user`, and private VPC network isolation.

#### 9.6.5 Session Management API Summary (Section E)
*(Full request/response schemas and HTTP error contracts are specified in [`docs/04_API_SPECIFICATION.md`](file:///Users/mac/Desktop/HRMS/docs/04_API_SPECIFICATION.md#L257) Section 2.5.)*
- **`GET /api/v1/auth/sessions`** *(Authenticated Employee/Admin/Super Admin)* — Lists current user's active sessions (`revoked_at IS NULL AND expires_at > NOW()`) in current tenant: `{ id, isCurrent, deviceSummary, approximateIp, createdAt, lastActivityAt, expiresAt }`. **Never returns `refreshToken`, `refresh_token_hmac`, `accessToken`, `gotrue_session_id` internal claim internals, or `synthetic_email`.**
- **`DELETE /api/v1/auth/sessions/:sessionId`** *(Authenticated User)* — Revokes only the selected session belonging to `(currentOrgId, currentUserId)` without disturbing other sessions; clears `__Host-` cookie if `isCurrent`.
- **`POST /api/v1/auth/sessions/revoke-all`** *(Authenticated User; complements CSRF+cookie `POST /api/v1/auth/logout` `{ scope: 'global' }`)* — Revokes all sessions for the calling user across all devices and clears current refresh cookie.
- **`POST /api/v1/admin/users/:userId/sessions/revoke-all`** *(Same-tenant `ADMIN` / `SUPER_ADMIN`; `ADMIN` blocked `403` from `SUPER_ADMIN`; mandatory `reason`)* — Revokes all active sessions for target employee and writes immutable audit trail.

#### 9.6.6 Mandatory Session Audit Events (Section F)
Every session lifecycle and security event appends an immutable record to `public.audit_logs` (`organization_id`, `actor_user_id`, `actor_role`, `action`, `target_table = 'user_sessions'` / `'users'`, `target_id`, `payload_after`, `reason`, masked `ip_address`, parsed `user_agent`, server `created_at`):

| Audit Action | Triggering Flow | Actor & Target | Recorded Privacy-Safe Metadata (`payload_after` / columns) | Strictly Excluded Secrets |
|---|---|---|---|---|
| **`SESSION_CREATED`** | `POST /api/v1/auth/login` | Actor: `user` / Target: `user_sessions.id` | `{ outcome: 'SUCCESS', targetUserId, hrmsSessionId, deviceSummary, approxIp, correlationId }` + `organization_id`, `created_at` | Plaintext `refreshToken`, `accessToken`, `password`, `synthetic_email`, raw HMAC keys |
| **`SESSION_REFRESHED`** | `POST /api/v1/auth/refresh` | Actor: `user` / Target: `user_sessions.id` | `{ outcome: 'SUCCESS', targetUserId, hrmsSessionId, rotated: true, approxIp, correlationId }` + `organization_id`, `created_at` | Old/new `refreshToken`, `accessToken`, `refresh_token_hmac`, cookies |
| **`SESSION_REVOKED`** | `DELETE /api/v1/auth/sessions/:sessionId` / `/logout` (`local`) | Actor: `user` / Target: `user_sessions.id` | `{ outcome: 'REVOKED', targetUserId, hrmsSessionId, isCurrent, revokedReason: 'USER_REVOKED_SESSION', correlationId }` + `organization_id`, `created_at` | Tokens, `synthetic_email` |
| **`ALL_SESSIONS_REVOKED`** | `POST /api/v1/auth/sessions/revoke-all` / `/logout` (`global`) | Actor: `user` / Target: `users.id` | `{ outcome: 'REVOKED', targetUserId, revokedCount, tokensValidAfterEpoch, revokedReason: 'USER_GLOBAL_LOGOUT', correlationId }` + `organization_id`, `created_at` | Tokens, passwords, `synthetic_email` |
| **`PASSWORD_CHANGE_SESSIONS_REVOKED`** | `/reset-password/confirm`, `/change-password`, `/first-login-change` | Actor: `user` / Target: `users.id` | `{ outcome: 'REVOKED', targetUserId, revokedCount, tokensValidAfterEpoch, triggerFlow, correlationId }` + `organization_id`, `created_at` | Old/new passwords, OTPs, HMAC digests, tokens |
| **`ADMIN_SESSIONS_REVOKED`** | `POST /api/v1/admin/users/:userId/sessions/revoke-all` & employee deactivation | Actor: `ADMIN`/`SUPER_ADMIN`/`SYSTEM` / Target: `users.id` | `{ outcome: 'REVOKED', targetUserId, actorUserId, actorRole, revokedCount, tokensValidAfterEpoch, revokedReason, correlationId }` + mandatory `reason`, `organization_id`, `created_at` | Tokens, passwords, `synthetic_email` |
| **`REFRESH_TOKEN_REUSE_DETECTED`** | Compromised/stale replay on `/auth/refresh` | Actor: `SYSTEM` (untrusted cookie) / Target: `user_sessions.id` | `{ outcome: 'BLOCKED', targetUserId, hrmsSessionId, revokedReason: 'REFRESH_REUSE_DETECTED', approxIp, deviceSummary, correlationId }` + `organization_id`, `created_at` | Replayed `refreshToken`, cookie value, `refresh_token_hmac` |

#### 9.6.7 Database Privilege Separation, `FORCE RLS` & Trusted Actor Verification (`hrms_session_manager` — Tasks 2.2B.9A & 2.2B.9B)
To preserve strict separation between pre-authentication identity lookup (`hrms_auth_lookup_owner`) and post-login session lifecycle management, proposed Migration `00004` isolates all session operations inside a **separate, non-login, `NOBYPASSRLS` database role (`hrms_session_manager`)** and removes all caller-supplied actor impersonation parameters (`p_actor_user_id`):

1. **Strict Freeze on `hrms_auth_lookup_owner` (`BYPASSRLS` Not Expanded):**
   - `hrms_auth_lookup_owner` retains **only** `SELECT (id, is_active) ON public.organizations` and `SELECT (id, organization_id, phone_number, synthetic_email, is_active, activated_at, phone_verified_at) ON public.users`.
   - `hrms_auth_lookup_owner` receives **zero privileges (`REVOKE ALL`) on `public.user_sessions`, `public.revoked_sessions`, `public.user_roles`, or `public.users.tokens_valid_after_epoch`**. It owns strictly `resolve_login_identity`, `resolve_recovery_identity`, and `resolve_auth_user_tenant` (resolving `(user_id, organization_id, org_is_active, user_is_active, is_activated)` prior to `SET LOCAL app.current_org_id`).
2. **Dedicated `NOLOGIN NOBYPASSRLS` Role & Minimum Table/Column Grants (`hrms_session_manager`):**
   ```sql
   CREATE ROLE hrms_session_manager
       WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
   GRANT hrms_session_manager TO postgres WITH SET TRUE, INHERIT FALSE;
   GRANT USAGE, CREATE ON SCHEMA hrms_internal TO hrms_session_manager;
   GRANT USAGE ON SCHEMA public TO hrms_session_manager;
   REVOKE ALL ON ALL TABLES, SEQUENCES IN SCHEMA public FROM hrms_session_manager;

   -- Minimum column-level privileges (zero access to employees, payroll_*, attendance_*, synthetic_email, phone_number, otp_hmac, audit_logs, auth.*):
   GRANT SELECT (id, organization_code, name, is_active) ON public.organizations TO hrms_session_manager;
   GRANT SELECT (id, organization_id, is_active, activated_at, must_change_password, tokens_valid_after_epoch) ON public.users TO hrms_session_manager;
   GRANT UPDATE (tokens_valid_after_epoch) ON public.users TO hrms_session_manager;
   GRANT SELECT (user_id, organization_id, role) ON public.user_roles TO hrms_session_manager;
   GRANT SELECT (id, organization_id, user_id, purpose, used_at) ON public.password_reset_otps TO hrms_session_manager; -- Proof check for otp_revoke_all_user_sessions only
   GRANT SELECT, INSERT, DELETE ON public.user_sessions TO hrms_session_manager;
   GRANT UPDATE (refresh_token_hmac, prev_refresh_token_hmac, prev_rotated_at, last_activity_at, expires_at, revoked_at, revoked_reason, revoked_by_user_id)
       ON public.user_sessions TO hrms_session_manager;
   GRANT SELECT, INSERT, DELETE ON public.revoked_sessions TO hrms_session_manager;
   ```
   *(Note: Immutable `audit_logs` inserts continue via existing `hrms_app_user` `INSERT` privileges within the caller transaction rather than granting `audit_logs` privileges to `hrms_session_manager`.)*
3. **Preservation of `FORCE RLS` & Zero `BYPASSRLS` Exposure:**
   - `public.user_sessions` and `public.revoked_sessions` enforce `ENABLE` + `FORCE ROW LEVEL SECURITY` with tenant isolation policies `USING (organization_id = public.current_org_id()) WITH CHECK (organization_id = public.current_org_id())`. Because `hrms_session_manager` is **`NOBYPASSRLS`**, PostgreSQL enforces `FORCE RLS` across every session read and write.
   - **Cookie Refresh Lookup Without `BYPASSRLS`:** On cookie-only `/auth/refresh` before `app.current_org_id` is known, `hrms_internal.lookup_session_by_refresh_hmac(p_rt_hmac CHAR(64))` (`VOLATILE SECURITY DEFINER`, owned by `hrms_session_manager`) validates `p_rt_hmac ~ '^[0-9a-f]{64}$'`, sets transaction-local `SET LOCAL app.session_rt_hmac_lookup = p_rt_hmac` for a single narrow `FOR SELECT TO hrms_session_manager` equality policy matching `refresh_token_hmac` / `prev_refresh_token_hmac` (fail-closed `FALSE` when empty), reads strictly minimal `(id, organization_id, user_id, gotrue_session_id, revoked_at, expires_at, is_current_digest, prev_rotated_at)`, and resets the GUC to `''` before return. Immediately afterward, Express enters `withTenantTransaction(organization_id, ..., verifiedUserId)` (`SET LOCAL app.current_org_id` + `SET LOCAL app.current_user_id`) so rotation or revocation executes strictly inside `current_org_id()` `FORCE RLS`.
4. **Function Hardening, Exclusive Grants, Mandatory `p_tx_proof` & Non-Trust of Caller `p_actor_user_id` or Raw GUCs (Tasks 2.2B.9B & 2.2B.9C):**
   - Every session `SECURITY DEFINER` routine inside `hrms_internal` is defined with **`SET search_path = pg_catalog, public`**, schema-qualified table/function references (`public.*`), and strict execution grants: `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION ... TO hrms_app_user;`. Frontend/browser roles (`anon`, `authenticated`) have zero schema `USAGE`, zero direct session table grants, and zero `EXECUTE` access.
   - **Zero Caller-Supplied Actor Parameters (`p_actor_user_id` Eliminated) + Cryptographic Transaction Proof (`p_tx_proof` Mandated — Task 2.2B.9C):** None of the self-service, refresh, or administrative session functions accept a caller-supplied `p_actor_user_id`. All authenticated actor identities derive from `v_actor_id := public.auth_user_id()` (`app.current_user_id`) inside `v_org_id := public.current_org_id()` (`app.current_org_id`), AND **every single `hrms_session_manager` function now requires `p_tx_proof TEXT` verified via `hrms_internal.assert_verified_tx_context(p_tx_proof, expected_op, expected_target_id)`** (owned by `hrms_context_verifier`, Section 9.6.8) BEFORE touching any session row or role table.
   - **Why Custom GUCs Alone Failed Security Review:** As established in Migration `00001`, PostgreSQL custom GUCs (`app.current_org_id`, `app.current_user_id`) are **caller-settable session variables**. Without `p_tx_proof`, a compromised client or attacker holding `hrms_app_user` credentials could forge `SET LOCAL app.current_org_id` and `SET LOCAL app.current_user_id` directly in SQL and impersonate any active employee or `SUPER_ADMIN` inside `hrms_session_manager` functions. Pairing GUCs with cryptographic `p_tx_proof` bound to `pg_current_xact_id()` and a single-use challenge nonce eliminates SQL-layer GUC impersonation across all session functions.
5. **Individual vs. Revoke-All Isolation Guarantee:**
   - `hrms_internal.revoke_user_session(p_tx_proof, p_user_session_id, p_jwt_exp)` and `hrms_internal.revoke_compromised_session_family(p_tx_proof, p_user_session_id, p_jwt_exp)` validate `p_tx_proof`, update **only** the single matched `public.user_sessions` row (`user_id = v_actor_id` / matched session), and insert **only** its single `gotrue_session_id` into `public.revoked_sessions`; they **never modify `public.users.tokens_valid_after_epoch`** and **never update sibling `user_sessions` rows**, ensuring sibling devices remain active.
6. **Complete Security Review Matrix of All `hrms_session_manager` Functions (Tasks 2.2B.9B & 2.2B.9C Audit):**

| Function (`hrms_internal.*`) | Signed `p_tx_proof` Binding (`op`, `target_id`) & Identity Source | Mandatory In-DB Security, Proof & Authorization Checks | Resolution of Pre-2.2B.9B / 9C Gaps |
|---|---|---|---|
| `verify_authenticated_session_and_roles(p_tx_proof, p_session_id, p_jwt_iat)` | `op = 'VERIFY_SESSION'`, `target_id = p_session_id::TEXT` -> matches GUCs `(current_org_id(), auth_user_id())` + signed `(org_id, actor_user_id, session_id)` | Calls `assert_verified_tx_context`; checks active org/user (`activated_at IS NOT NULL`), `p_session_id NOT IN revoked_sessions`, `p_jwt_iat >= users.tokens_valid_after_epoch`, `user_sessions` active & unrevoked, loads `user_roles`, debounces `last_activity_at` under `FORCE RLS`. | Closed GUC-only trust gap (`2.2B.9C`) + removed redundant `p_user_id` (`2.2B.9B`). |
| `lookup_session_by_refresh_hmac(p_tx_proof, p_rt_hmac)` | `op = 'LOOKUP_REFRESH_HMAC'`, `target_id = p_rt_hmac`, sentinel zero UUIDs `(org_id, actor_user_id, session_id)` (pre-tenant proof issued strictly by Express holding `TX_CONTEXT_HMAC_KEY`) | Calls `assert_verified_tx_context`; validates 64-hex HMAC regex; sets & clears `app.session_rt_hmac_lookup` GUC under narrow `NOBYPASSRLS` equality policy; returns minimal non-secret state. | Prevents unauthenticated `hrms_app_user` SQL brute probing of HMAC hashes without `TX_CONTEXT_HMAC_KEY`. |
| `create_user_session(p_tx_proof, p_gotrue_session_id, p_rt_hmac, p_device_summary, p_approx_ip, p_expires_at)` | `op = 'CREATE_SESSION'`, `target_id = p_gotrue_session_id::TEXT` -> matches GUCs `(current_org_id(), auth_user_id())` | Calls `assert_verified_tx_context`; checks active org/user membership (`activated_at IS NOT NULL`), `p_expires_at > NOW()`, inserts under `FORCE RLS`. | Closed GUC spoofing (`2.2B.9C`) & removed caller `p_organization_id` / `p_user_id` (`2.2B.9B`). |
| `rotate_user_session(p_tx_proof, p_user_session_id, p_expected_rt_hmac, p_new_rt_hmac, p_new_expires_at)` | `op = 'ROTATE_SESSION'`, `target_id = p_user_session_id::TEXT` -> matches GUCs `(current_org_id(), auth_user_id())` | Calls `assert_verified_tx_context`; verifies active org/user membership, session row ownership `(id, organization_id = v_org_id, user_id = v_actor_id)`, unrevoked state, and HMAC parity under `FORCE RLS`. | Closed GUC spoofing on refresh rotation (`2.2B.9C`). |
| `list_active_user_sessions(p_tx_proof, p_current_gotrue_session_id)` | `op = 'LIST_SESSIONS'`, `target_id = v_actor_id::TEXT` -> matches GUCs `(current_org_id(), auth_user_id())` | Calls `assert_verified_tx_context`; verifies active org/user membership in DB; filters strictly `WHERE organization_id = v_org_id AND user_id = v_actor_id AND revoked_at IS NULL AND expires_at > NOW()`; omits all HMAC digests. | Blocked `SET LOCAL` session enumeration (`2.2B.9C`) & removed `p_actor_user_id` (`2.2B.9B`). |
| `revoke_user_session(p_tx_proof, p_user_session_id, p_jwt_exp)` | `op = 'REVOKE_SESSION'`, `target_id = p_user_session_id::TEXT` -> matches GUCs `(current_org_id(), auth_user_id())` | Calls `assert_verified_tx_context`; verifies active org/user membership; updates ONLY single row matching `(id = p_user_session_id, organization_id = v_org_id, user_id = v_actor_id, revoked_at IS NULL)`; inserts single `gotrue_session_id` into `revoked_sessions`; **preserves `tokens_valid_after_epoch`**. | Blocked `SET LOCAL` victim session revocation (`2.2B.9C`) & removed `p_actor_user_id` (`2.2B.9B`). |
| `revoke_compromised_session_family(p_tx_proof, p_user_session_id, p_jwt_exp)` | `op = 'REVOKE_COMPROMISED_FAMILY'`, `target_id = p_user_session_id::TEXT` -> matches GUCs `(current_org_id(), auth_user_id())` | Calls `assert_verified_tx_context`; verifies org/user/session ownership match; marks single compromised session revoked (`'REFRESH_REUSE_DETECTED'`) + `revoked_sessions` insert; **preserves sibling sessions & `tokens_valid_after_epoch`**. | Closed GUC spoofing (`2.2B.9C`) & verifies `(org, user)` match (`2.2B.9B`). |
| `revoke_own_all_sessions(p_tx_proof, p_reason_code, p_trigger_gotrue_session_id, p_trigger_jwt_exp)` | `op = 'REVOKE_OWN_ALL'`, `target_id = v_actor_id::TEXT` -> matches GUCs `(current_org_id(), auth_user_id())` | Calls `assert_verified_tx_context`; allowlists `'USER_GLOBAL_LOGOUT' \| 'PASSWORD_CHANGE'`; verifies active org/user membership; revokes ONLY rows owned by `v_actor_id` in `v_org_id`; advances `tokens_valid_after_epoch`. | Blocked `SET LOCAL` mass employee logout DoS (`2.2B.9C`) & removed `p_actor_user_id` (`2.2B.9B`). |
| `otp_revoke_all_user_sessions(p_tx_proof, p_otp_challenge_id)` | `op = 'OTP_REVOKE_ALL'`, `target_id = p_otp_challenge_id::TEXT` -> matches GUCs `(current_org_id(), auth_user_id())` + signed OTP owner `(org_id, user_id)` | **Double Defense:** Calls `assert_verified_tx_context` **AND** atomically executes `UPDATE public.password_reset_otps SET sessions_revoked_at = NOW() WHERE id = p_otp_challenge_id AND organization_id = v_org_id AND user_id = v_actor_id AND purpose = 'PASSWORD_RESET_OTP' AND used_at IS NOT NULL AND used_at >= NOW() - INTERVAL '60 seconds' AND sessions_revoked_at IS NULL` before revoking that OTP user's sessions & advancing epoch. | Defeated OTP UUID brute/lookup AND 60-second multi-call replay via single-use `sessions_revoked_at` (`2.2B.9C`). |
| `admin_revoke_all_user_sessions(p_tx_proof, p_target_user_id, p_reason_code)` | `op = 'ADMIN_REVOKE_ALL'`, `target_id = p_target_user_id::TEXT` -> matches GUCs `(current_org_id(), auth_user_id())` | Calls `assert_verified_tx_context`; allowlists `'ADMIN_REVOKED_ALL' \| 'ACCOUNT_DEACTIVATED'`; verifies actor is active member of `v_org_id` AND holds `'ADMIN'`/`'SUPER_ADMIN'` in `public.user_roles`; verifies target belongs to `v_org_id`; **blocks `'ADMIN'` targeting `'SUPER_ADMIN'` (`SQLSTATE 42501`)**; writes `revoked_by_user_id = v_actor_id` & advances target epoch. | Blocked `SET LOCAL` `SUPER_ADMIN` impersonation (`2.2B.9C`) & removed `p_actor_user_id` (`2.2B.9B`). |
| `purge_expired_sessions(p_tx_proof)` | `op = 'PURGE_EXPIRED_SESSIONS'`, `target_id = v_org_id::TEXT`, `actor_user_id = 00000000-0000-0000-0000-000000000000` -> matches `current_org_id()` | Calls `assert_verified_tx_context`; requires non-null `current_org_id()`; deletes strictly expired `revoked_sessions` and `>= 30d` aged `user_sessions` within `v_org_id` under `FORCE RLS`. | Closed unauthorized cross-tenant/premature purge by raw `hrms_app_user` (`2.2B.9C`). |

#### 9.6.8 Cryptographic Transaction Context Verification (`hrms_context_verifier` — Task 2.2B.9C)

To close the custom GUC spoofing vulnerability without exposing signing secrets to `hrms_app_user`, Task `2.2B.9C` establishes an independent third security boundary owned by **`hrms_context_verifier`** (`NOLOGIN NOBYPASSRLS`) enforcing transaction-bound challenge-response authentication across all 11 `hrms_session_manager` functions:

1. **Exact Attack Path Against Task `2.2B.9B` Design (Why GUCs Alone Were Insufficient):**
   - `hrms_app_user` holds `EXECUTE` grants on every `hrms_internal` `SECURITY DEFINER` routine, and any PostgreSQL session can freely execute `SET LOCAL app.current_org_id = '<victim_org_uuid>'; SET LOCAL app.current_user_id = '<victim_super_admin_uuid>';`.
   - Prior to Task `2.2B.9C`, functions such as `list_active_user_sessions`, `revoke_user_session`, `revoke_own_all_sessions`, `admin_revoke_all_user_sessions`, `create_user_session`, and `rotate_user_session` verified only whether `current_org_id()` and `auth_user_id()` were active users/admins in `public.users` / `public.user_roles`. Any attacker obtaining direct `hrms_app_user` SQL connectivity (e.g., compromised app worker env, SSRF/SQLi into a side query, or leaked DB pooler credential) could spoof a `SUPER_ADMIN` UUID in GUCs, pass all in-DB checks, list active sessions, kick every user off the tenant (`admin_revoke_all_user_sessions`), or probe `otp_revoke_all_user_sessions` with a leaked OTP UUID during its 60-second post-consumption window.
   - Relying on "only Express calls `SET LOCAL`" was merely an application convention, not a cryptographic database boundary.

2. **Corrected Trust Architecture (`hrms_context_verifier`) & Shared HMAC vs. Asymmetric Ed25519 Evaluation:**
   - **Recommended Baseline (`pgcrypto` HMAC-SHA256 + 1-TX Challenge-Response):** Proposed Migration `00004` introduces a dedicated non-login role **`hrms_context_verifier`** (`NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`, `GRANT USAGE ON SCHEMA hrms_internal`) owning two internal tables (zero grants to `hrms_app_user`, `hrms_auth_lookup_owner`, `hrms_session_manager`, `anon`, `authenticated`, `service_role`):
     - `hrms_internal.context_signing_keys (key_id VARCHAR(32) PK, secret_key BYTEA NOT NULL, status VARCHAR(20) CHECK ('ACTIVE'|'VERIFY_ONLY'|'REVOKED'), created_at, expires_at, rotated_at)`
     - `hrms_internal.tx_context_challenges (challenge_nonce UUID PK, tx_xid TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ)`
   - **Two `hrms_context_verifier` Routines (`SET search_path = pg_catalog, public`):**
     1. `hrms_internal.issue_tx_challenge() -> TABLE(tx_xid TEXT, challenge_nonce UUID)`: Granted ONLY to `hrms_app_user`. Called inside Express's active `READ WRITE` transaction right after setting `app.current_org_id` / `app.current_user_id`. Calls `pg_catalog.pg_current_xact_id()::TEXT` (`xid8` monotonically increasing 64-bit transaction ID, forcing immediate XID assignment) and inserts `(challenge_nonce = gen_random_uuid(), tx_xid, expires_at = NOW() + INTERVAL '15 seconds')` into `tx_context_challenges`. Also opportunistically purges aged expired/consumed challenges in small batches.
     2. `hrms_internal.assert_verified_tx_context(p_tx_proof TEXT, p_expected_op TEXT, p_expected_target_id TEXT) -> TABLE(verified_org_id UUID, verified_actor_user_id UUID, verified_session_id UUID)`: Invoked unconditionally as Step 1 of every `hrms_session_manager` routine (`REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO hrms_session_manager`). Parses fixed-format proof, recomputes `pgcrypto` `hmac(..., v_secret_key, 'sha256')` via constant-time bytewise XOR comparison, atomically consumes `challenge_nonce` for `pg_current_xact_id()::TEXT`, verifies exact `op` / `target_id`, and validates exact GUC parity (`SQLSTATE 42501` on any anomaly).
   - **Honest Architectural Trade-Off — Shared Symmetric HMAC vs. Asymmetric Ed25519 (`pgsodium`):**
     - *Why Baseline Uses `pgcrypto` `HMAC-SHA256`:* `pgcrypto` is already verified installed and enabled in [`supabase/migrations/20261109000001_foundation_types_extensions.sql`](file:///Users/mac/Desktop/HRMS/supabase/migrations/20261109000001_foundation_types_extensions.sql#L11), making `HMAC-SHA256` zero-dependency locally and on hosted PostgreSQL. It completely blocks `hrms_app_user`, `hrms_auth_lookup_owner`, and `hrms_session_manager` (none can read `context_signing_keys`).
     - *Symmetric HMAC Limitation:* Because both Express (signer) and PostgreSQL `hrms_internal.context_signing_keys` (verifier) hold the same symmetric key, a PostgreSQL superuser (`postgres`), DBA, or attacker reading raw **database backups / physical snapshots** containing `hrms_internal.context_signing_keys` could extract `secret_key` and forge valid transaction proofs. Additionally, `pgcrypto` does not natively support raw `Ed25519` detached signature verification.
     - *Asymmetric Ed25519 Upgrade Path (`pgsodium`):* Storing an Ed25519 **private signing key exclusively in Express runtime secret storage** and storing **only the 32-byte Ed25519 public verifying key** in `hrms_internal.context_verifying_public_keys` eliminates the DBA/backup-snapshot secret-sharing weakness completely (a full DB dump yields zero signing capability). During **Task `2.2C`**, inspect hosted Supabase support for `pgsodium` (`pgsodium.crypto_sign_verify_detached(sig_bytea, msg_bytea, pubkey_bytea)`). If hosted `pgsodium` is enabled and permitted for `hrms_context_verifier`, prefer **Ed25519 public-key verification** inside `assert_verified_tx_context` with identical proof envelope fields; otherwise retain `pgcrypto` `HMAC-SHA256` with encrypted DB backups and explicit DBA/backup key-access controls.

3. **Canonical Proof Format, Validation Rules, Secret Storage & Zero-Downtime Rotation Strategy:**
   - **Delimiter-Safe Canonical Proof Structure:** Proof string `p_tx_proof` uses versioned 11-segment colon-delimited wire encoding (`v1:<key_id>:<tx_xid>:<challenge_nonce>:<org_id>:<actor_user_id>:<session_id>:<op>:<target_id>:<expires_at_unix>:<sig_hex>`) where **every field is strictly character-set constrained BEFORE HMAC computation** (eliminating canonicalization ambiguity / delimiter injection because colons are impossible in every field):
     - `version`: literal `'v1'`
     - `key_id`: `^[a-z0-9_-]{3,32}$` (no colons)
     - `tx_xid`: `^[0-9]{1,20}$` (decimal `xid8`)
     - `challenge_nonce`, `org_id`, `actor_user_id`, `session_id`: lowercase canonical UUID `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` (`00000000-0000-0000-0000-000000000000` allowed strictly for pre-tenant `LOOKUP_REFRESH_HMAC` `(org, actor, session)` and `PURGE_EXPIRED_SESSIONS` `(actor, session)`)
     - `op`: allowlisted uppercase ASCII `^[A-Z0-9_]{3,40}$` (`VERIFY_SESSION`, `LOOKUP_REFRESH_HMAC`, `CREATE_SESSION`, `ROTATE_SESSION`, `LIST_SESSIONS`, `REVOKE_SESSION`, `REVOKE_COMPROMISED_FAMILY`, `REVOKE_OWN_ALL`, `OTP_REVOKE_ALL`, `ADMIN_REVOKE_ALL`, `PURGE_EXPIRED_SESSIONS`)
     - `target_id`: `^[0-9a-f]{64}$` (when `op = 'LOOKUP_REFRESH_HMAC'`) or canonical UUID (all other 10 operations; zero arbitrary strings containing `:`)
     - `expires_at_unix`: `^[0-9]{10,13}$` (PostgreSQL `EXTRACT(EPOCH FROM NOW())::BIGINT`; max proof TTL `<= 15 seconds` past `NOW()`, AND bounded `<= NOW() + 5 seconds` clock skew so long-lived proofs cannot be minted)
     - `sig_hex`: `^[0-9a-f]{64}$` (`HMAC-SHA256` hex over UTF-8 canonical string `v1:<key_id>:<tx_xid>:<challenge_nonce>:<org_id>:<actor_user_id>:<session_id>:<op>:<target_id>:<expires_at_unix>`)
   - **Constant-Time Verification in PL/pgSQL:** Compute expected 32-byte raw MAC `v_expected_bytes := extensions.hmac(v_payload::bytea, v_secret_key, 'sha256')` (schema-verified during `2.2C`) and decode `v_actual_bytes := pg_catalog.decode(v_sig_hex, 'hex')`, then compare all 32 bytes in a full fixed-length `FOR i IN 0..31 LOOP v_diff := v_diff | (get_byte(v_expected_bytes, i) # get_byte(v_actual_bytes, i)); END LOOP;` returning `v_diff = 0` — never using short-circuit SQL `=`.
   - **Secret Storage Rules:**
     - `TX_CONTEXT_HMAC_KEY` (256-bit CSPRNG secret, distinct from `SESSION_TOKEN_HMAC_KEY`, `OTP_HMAC_PEPPER`, JWT secret, and `SUPABASE_SERVICE_ROLE_KEY`) lives in Express runtime secret manager alongside its active `key_id` (`TX_CONTEXT_HMAC_KEY_ID` + `TX_CONTEXT_HMAC_KEY`), and in `hrms_internal.context_signing_keys` readable **only** by `hrms_context_verifier`.
     - **PROHIBITED Storage Locations:** NEVER store signing secrets in PostgreSQL GUCs (`postgresql.conf` / `ALTER DATABASE SET` / `app.*` GUCs — readable via `pg_settings` or session functions), `supabase/config.toml`, Git repository files, environment logs, `public.*` tables, or client bundles.
   - **Zero-Downtime Key Rotation Lifecycle (`ACTIVE` -> `VERIFY_ONLY` -> `REVOKED`):**
     1. *Provision Next Key:* Admin/DBA out-of-band job inserts new `(key_id = 'k2026_12', secret_key_new, status = 'ACTIVE')` into `hrms_internal.context_signing_keys` and updates old key `'k2026_11'` from `'ACTIVE'` to **`'VERIFY_ONLY'`** (partial unique index ensures at most **one `'ACTIVE'`** signing key at a time while permitting transitional `'VERIFY_ONLY'` keys during rollover).
     2. *Rolling Deploy:* Older Express instances still signing with `'k2026_11'` continue validating cleanly (`status IN ('ACTIVE', 'VERIFY_ONLY')`) while updated Express instances sign immediately with `'k2026_12'`.
     3. *Drain & Retire:* After all Express instances cycle and active proofs (`<= 15s`) drain, transition `'k2026_11'` to `'REVOKED'`; `assert_verified_tx_context` rejects `'REVOKED'` keys immediately with `SQLSTATE 42501`.
     4. *Emergency Compromise Rotation:* Immediately update compromised key to `'REVOKED'` AND insert + deploy new `'ACTIVE'` key; stale compromised proofs stop working instantaneously even before Express rollout completes.

4. **Transaction Binding & Replay Prevention Strategy:**
   - **Cross-Transaction Replay Impossible:** Proof binds PostgreSQL's `pg_current_xact_id()::TEXT` (`xid8` 64-bit monotonic transaction identifier that never wraps around in realistic lifetime). Even if an attacker captures a valid `p_tx_proof` string from wire logs within 15 seconds, executing `assert_verified_tx_context` in any other transaction sees a different `pg_current_xact_id()` and fails closed (`SQLSTATE 42501`).
   - **Intra-Transaction & Subtransaction Replay Defense:** Inside the same transaction, `UPDATE hrms_internal.tx_context_challenges SET consumed_at = NOW() WHERE challenge_nonce = v_nonce AND tx_xid = v_current_xid AND consumed_at IS NULL AND expires_at > NOW()` executes atomically inside the business transaction; any second invocation sees `consumed_at IS NOT NULL` -> `0` rows updated -> `SQLSTATE 42501`. Every `hrms_session_manager` call within a multi-step Express handler receives its own distinct `issue_tx_challenge()` call and op-bound `p_tx_proof` — proofs are strictly **single-op, single-target, single-use**, and Express middleware MUST NOT place retryable `SAVEPOINT` wrappers around failed proof validations within a transaction.
   - **Rolled-Back Transaction Replay Impossible:** If Transaction A calls `issue_tx_challenge()`, obtains `(tx_xid_100, nonce_A)`, receives a proof, and rolls back before commit, the challenge row rolls back with Transaction A and `tx_xid_100` is permanently burned; any future Transaction B has `tx_xid > 100` AND has no matching row in `tx_context_challenges`, so replay fails closed (`42501`).
   - **Exact GUC Parity Assertion:** For all tenant/actor operations, `assert_verified_tx_context` verifies `v_org_id = public.current_org_id()` AND `v_actor_id = public.auth_user_id()` (`42501` if either GUC is NULL or disagrees with the signed payload). Thus an attacker calling a function under spoofed GUCs cannot reuse an Express proof minted for another user/org.
   - **OTP Double Defense (`otp_revoke_all_user_sessions`):** Even beyond signed `p_tx_proof` (`op = 'OTP_REVOKE_ALL'`, `org_id = otp.organization_id`, `actor_user_id = otp.user_id`, `target_id = otp_challenge_id`), `otp_revoke_all_user_sessions` requires `UPDATE public.password_reset_otps SET sessions_revoked_at = NOW() WHERE id = p_otp_challenge_id AND organization_id = v_org_id AND user_id = v_actor_id AND purpose = 'PASSWORD_RESET_OTP' AND used_at IS NOT NULL AND used_at >= NOW() - INTERVAL '60 seconds' AND sessions_revoked_at IS NULL RETURNING user_id` (`SELECT + UPDATE (sessions_revoked_at)` narrow grant replacing bare `SELECT`). Guessing/leaking an already-revoked OTP UUID fails after the single authorized revocation completes.

5. **Adversarial Test Matrix (Mandatory for Task `2.2H` Security Verification):**

| # | Attack Scenario / Test Case | Attacker Action / State Setup | Expected Outcome (`SQLSTATE` / Behavior) |
|---|---|---|---|
| **T1** | Missing or NULL `p_tx_proof` | Call any of the 11 `hrms_session_manager` functions with `NULL`, `''`, or whitespace `p_tx_proof` after `SET LOCAL` valid GUCs | **FAILS CLOSED — `SQLSTATE 42501`** (`TX_PROOF_REQUIRED`); zero rows read or mutated. |
| **T2** | Spoofed GUC + GUC-only impersonation of employee | Raw `hrms_app_user` runs `SET LOCAL app.current_org_id = orgA; SET LOCAL app.current_user_id = victimId;` and calls `list_active_user_sessions` / `revoke_user_session` with forged signature | **FAILS CLOSED — `SQLSTATE 42501`** (`TX_PROOF_INVALID_SIGNATURE`); victim sessions untouched. |
| **T3** | Spoofed GUC impersonating `SUPER_ADMIN` | Raw `hrms_app_user` runs `SET LOCAL` to active `SUPER_ADMIN` UUID and calls `admin_revoke_all_user_sessions` without valid `TX_CONTEXT_HMAC_KEY` | **FAILS CLOSED — `SQLSTATE 42501`** (`TX_PROOF_INVALID_SIGNATURE`); `user_roles` query not even reached. |
| **T4** | Captured valid proof replayed in new transaction | Capture valid `p_tx_proof` from TX A; replay inside TX B with identical GUCs within 2 seconds | **FAILS CLOSED — `SQLSTATE 42501`** (`TX_PROOF_XID_MISMATCH` / `CHALLENGE_NOT_FOUND`); `pg_current_xact_id()` differs. |
| **T5** | Same-TX intra-transaction replay (double call) | Call `revoke_user_session(proofA, ...)` then `revoke_user_session(proofA, ...)` inside same TX B with identical proof | 1st call succeeds & consumes `challenge_nonce`; 2nd call **FAILS CLOSED — `SQLSTATE 42501`** (`TX_CHALLENGE_ALREADY_CONSUMED`). |
| **T6** | Rolled-back TX proof reuse attempt | Call `issue_tx_challenge()`, sign `proofA`, immediately `ROLLBACK`, start new TX, replay `proofA` | **FAILS CLOSED — `SQLSTATE 42501`** (challenge never committed & `xid8` permanently changed). |
| **T7** | GUC mismatch vs signed payload | Sign valid proof for `(orgA, userA)` -> `SET LOCAL app.current_user_id = userB` in same TX -> invoke session function | **FAILS CLOSED — `SQLSTATE 42501`** (`TX_CONTEXT_GUC_MISMATCH`). |
| **T8** | Operation (`op`) substitution attack | Mint proof with `op = 'LIST_SESSIONS'` (`target_id = userA`), pass proof to `revoke_own_all_sessions` (`expected_op = 'REVOKE_OWN_ALL'`) | **FAILS CLOSED — `SQLSTATE 42501`** (`TX_PROOF_OP_MISMATCH`). |
| **T9** | Target ID (`target_id`) substitution attack | Mint proof for `revoke_user_session` (`target_id = session1`), pass `p_user_session_id = session2` | **FAILS CLOSED — `SQLSTATE 42501`** (`TX_PROOF_TARGET_MISMATCH`); `session2` untouched. |
| **T10** | Expired proof / extended TTL attack | Mint proof with `expires_at_unix = now - 1` or `now + 120` (> 15s max ceiling), or sleep past 15s after `issue_tx_challenge()` | **FAILS CLOSED — `SQLSTATE 42501`** (`TX_PROOF_EXPIRED` or `TX_CHALLENGE_EXPIRED`). |
| **T11** | Revoked `key_id` or unknown `key_id` | Sign proof with `'REVOKED'` or nonexistent `key_id` | **FAILS CLOSED — `SQLSTATE 42501`** (`TX_SIGNING_KEY_INVALID`). |
| **T12** | Zero-downtime rotation `'VERIFY_ONLY'` vs `'ACTIVE'` | Rotate old key `'k1'` to `'VERIFY_ONLY'` and deploy `'k2'` `'ACTIVE'`; verify proofs from `'k1'` succeed during window and fail immediately after `'k1'` -> `'REVOKED'` | `'k1'` `'VERIFY_ONLY'` **PASSES**; `'k1'` `'REVOKED'` **FAILS CLOSED — `SQLSTATE 42501`**. |
| **T13** | Direct read/write of signing keys by `hrms_app_user` / `hrms_session_manager` / `hrms_auth_lookup_owner` / `anon` | Execute `SELECT * FROM hrms_internal.context_signing_keys;` or `UPDATE hrms_internal.tx_context_challenges` as each role | **FAILS CLOSED — `SQLSTATE 42501`** (`permission denied for table/schema`). |
| **T14** | `otp_revoke_all_user_sessions` forged proof & double-use replay | (a) Call with guessed valid recent OTP UUID but spoofed GUCs/forged proof; (b) Call a 2nd time with valid proof within 60s after 1st revocation succeeds | (a) **FAILS `42501`** (`TX_PROOF_INVALID_SIGNATURE`); (b) 2nd call **FAILS `42501`** (`OTP_SESSIONS_ALREADY_REVOKED` via `sessions_revoked_at IS NOT NULL`). |
| **T15** | Valid `'ADMIN'` proof attempting to revoke `'SUPER_ADMIN'` | Valid `'ADMIN'` gets genuine Express proof `(ADMIN, op='ADMIN_REVOKE_ALL', target=SUPER_ADMIN_ID)` | **FAILS CLOSED — `SQLSTATE 42501`** (in-DB `user_roles` hierarchy check blocks `ADMIN` targeting `SUPER_ADMIN`). |

6. **Remaining Risks & Architectural Limitations (Honest Disclosure):**
   - **Shared Symmetric Secret & DB-Snapshot / Superuser Exposure:** Under `pgcrypto` `HMAC-SHA256`, `hrms_internal.context_signing_keys` contains the shared symmetric `BYTEA` key inside PostgreSQL. Anyone with `postgres` superuser access, direct DB host volume access, or unencrypted DB backups/snapshots can read `secret_key` and mint valid proofs outside Express. Mitigation: treat superuser/backup artifacts as Tier-0 sensitive credentials, enable encrypted snapshots, alert on access to `hrms_internal.context_signing_keys`, and evaluate upgrading `assert_verified_tx_context` to **`pgsodium` Ed25519 asymmetric public-key verification** during Task `2.2C` hosted pre-flight.
   - **Primary `READ WRITE` Transaction Dependency (No Read Replicas / `BEGIN READ ONLY`):** Calling `pg_current_xact_id()` and inserting/consuming rows in `hrms_internal.tx_context_challenges` assigns an `xid8` and mutates WAL state, meaning session-manager calls **cannot** execute inside `BEGIN READ ONLY` or against PostgreSQL read replicas; Express must always route session verification/revocation/listing to the writable primary via [`withTenantTransaction`](file:///Users/mac/Desktop/HRMS/server/src/db/transaction.ts#L64-L93).
   - **Per-Transaction Round-Trip Overhead & Table Churn:** Every session-checked request executes one extra lightweight `issue_tx_challenge()` statement (`INSERT` into `tx_context_challenges`) before calling `verify_authenticated_session_and_roles` (or `assert_verified_tx_context` + `UPDATE`). Batched cleanup inside `issue_tx_challenge()` + scheduled vacuum/purge keeps `tx_context_challenges` bounded.
   - **Same-TX Savepoint Replay Window Under Compromised Code:** If a bug inside an *already authenticated* Express transaction rolls back to a `SAVEPOINT` placed *after* `issue_tx_challenge()` and *before* or around `assert_verified_tx_context`, `consumed_at` resets within that same uncommitted TX; however, an attacker lacking `TX_CONTEXT_HMAC_KEY` still cannot redirect the proof to another `op`, `target_id`, `org_id`, or `actor_user_id`. Express middleware MUST NOT place retryable `SAVEPOINT` wrappers after issuing `p_tx_proof`.
   - **Scope Boundary Outside `hrms_session_manager`:** This task closes the GUC trust gap across all 11 `hrms_session_manager` routines. Baseline Migration `00001`–`00003` business-table RLS helpers (`public.current_org_id()`, `public.auth_user_id()`, `is_admin_or_super()`, `is_super_admin()`) and pre-auth lookups (`resolve_organization_by_code`, `resolve_login_identity`, `resolve_recovery_identity`, `resolve_auth_user_tenant`) are intentionally preserved intact without modifying Migrations `00001`–`00003`; broader migration of general tenant RLS or Express-trusted middleware GUCs may be evaluated separately if direct SQL compromise risk extends beyond broker session control.

### 9.7 Deployment Topology & Unresolved Hosting Binding (Section G)
- **Same-Site Deployment (Recommended):** Hosting frontend SPA and `/api/v1/*` on the same origin (reverse-proxy rewrite) or same eTLD+1 subdomains supports `__Host-hrms_refresh_token` with `SameSite=Lax` (or `Strict`) without third-party cookie restrictions.
- **Cross-Site Deployment Fallback:** Separate eTLD+1 origins (e.g. default `*.vercel.app` SPA calling `*.onrender.com` API) are cross-site under Public Suffix List rules, forcing `SameSite=None; Secure; HttpOnly` + strict CORS + CSRF + Safari ITP/third-party cookie risk.
- **Unresolved Boundary (`DEC-11` Open):** Final production hosting/custom-domain topology remains open under `DEC-11`; Express selects deployment-appropriate `SameSite` attributes (`Lax`/`Strict` vs `None; Secure`) strictly from verified environment config rather than hardcoding an incompatible production cookie policy.

---

## 10. Consolidated Product Owner Decision Register

*(Strictly retains existing approved decisions and existing `PO-01`–`PO-07` IDs — zero new IDs invented.)*

| ID | Category | Classification | Issue Summary | Options / Proposed Policy | Impact & Blockers |
|---|---|---|---|---|---|
| **`DEC-09`** | Auth Broker Architecture | **ALREADY APPROVED** | Supabase Auth as exclusive password/JWT authority; Express acts as broker; 1:1 `auth.users.id = public.users.id`. Zero custom password stores or custom JWTs. | Locked Baseline (2026-11-07). *(Correction made in Task 2.2B.1: excised stale reference to custom "capability tickets" in PRD v1.9).* | Preserved unchanged. |
| **`DEC-13`** | Login Tenant Model | **ALREADY APPROVED** | Login strictly requires `Organization Code + Mobile Number + Password`; server resolves tenant; zero trust in browser UUIDs. | Locked Baseline Option A (2026-11-07). | Preserved unchanged. |
| **`PO-01`** *(Existing `REC-01`)* | Synthetic Email Identity Format | **APPROVED / CLOSED (2026-11-10)** | Use **Scheme 3 — `<immutable_uuid>@auth.hrms.internal`** exclusively behind Express Auth Broker (`DEC-09` & `DEC-13`). | **Selected Option (Scheme 3):** Immutable UUID generated at provisioning, persisted in `public.users.synthetic_email`, stable across mobile number changes, zero email input for employees, and never exposed in employee-facing UI, API responses, logs, error messages, or payslips. *(Phone-coupled Schemes 1 & 2 rejected.)* | **Approved Policy (`PO-01` closed).** All `PO-01`–`PO-07` auth policies closed; live OTP SMS delivery awaits open `DEC-10`. |
| **`PO-02`** | Mobile Number Normalization Policy (Indian Mobile Only — Phase 1) | **APPROVED / CLOSED (2026-11-10)** | Phase 1 Indian-only normalization rule: canonical E.164 `+91XXXXXXXXXX` (`^\+91[6-9][0-9]{9}$`); accept `9876543210`, `919876543210`, `+919876543210` (strip spaces/hyphens only); national first digit `[6-9]`; reject international numbers, leading `0` trunk prefixes, landlines, short codes, malformed values, and arbitrary prefixes without silent truncation. | Backend normalizes authoritatively before lookup, provisioning, uniqueness checks (`uq_users_org_phone`), and login (same canonical Indian number permitted across different orgs; `PO-01` `synthetic_email` unchanged on phone updates; generic login errors). | **Enforced in Task 2.2C Shared Validators, Server Broker & Migration `00004` `CHECK` (`^\+91[6-9][0-9]{9}$`).** |
| **`PO-03`** | Self-Service Password Recovery via Mobile OTP | **APPROVED / CLOSED (2026-11-10)** | Phase 1 supports employee self-service password reset via SMS OTP sent strictly to registered, verified Indian mobile (`+91XXXXXXXXXX`), using `Org Code + Mobile + OTP + New Password` (zero email UX/exposure, preserving `DEC-09` & `PO-01` without Supabase native phone auth; Admins never learn passwords). Mandatory CSPRNG generation, short TTL, single-use `FOR UPDATE` consumption, keyed `HMAC-SHA256` challenge storage in proposed `password_reset_otps` (`OTP_HMAC_PEPPER` Express-only), max attempts, cooldowns/rate limits, anti-enumeration `202`/generic failures, GoTrue backend `updateUserById`, global session revocation, and non-secret `audit_logs`. | **Approved Policy.** Commercial SMS gateway/DLT (`DEC-10`), exact numeric OTP operational parameter tuning, & proposed lost-mobile Admin fallback operational workflow remain open/unfinalized (`2.2C`/`2.2F`). |
| **`Initial Account Activation Policy`** *(Tracked under Task 2.2B.5 / 2.2B.5A–D Approval)* | Initial Employee Account Activation | **APPROVED / CLOSED (2026-11-10)** | Separate, distinct onboarding activation policy: Admin provisions employee (`account_provisioning_requests.status = 'COMPLETED'` when user & initial token are created); system generates 256-bit CSPRNG token (`token_hash CHAR(64)` in `account_activation_tokens`) and single-use URL with fragment (`/auth/activate#token=...`) and QR code, shared strictly out-of-band by Admin (never in public directories or telemetry); frontend extracts fragment, clears address bar, and sends over HTTPS; backend validates token and dispatches SMS OTP to registered Indian mobile (`+91XXXXXXXXXX`, `PO-02`); employee submits Org Code, Mobile, Token, OTP, and chooses private password; user-level single-flight lock (`public.users.activation_lock_state`, per `auth_user_id`) prevents cross-token and parallel GoTrue overwrites (`'NONE' -> 'IN_FLIGHT'` once; zero automatic retry/takeover on timeout/mismatch; releases ONLY on synchronous verified `422 weak_password` before commit; atomically writes password + `app_metadata.hrms_activation_op_id` in GoTrue; positive marker match auto-completes; missing marker after observation window transitions user to `QUARANTINED_MANUAL_RECOVERY` and invalidates token `UNCERTAIN_PROVIDER_OUTCOME`, blocking Admin reissue until Super Admin/SRE controlled unlock); leaves already-completed `account_provisioning_requests` untouched; Admins never see/set passwords; employee never sees or enters email (`PO-01` Scheme 3). | **Approved Policy (Distinct from PO-03 Password Recovery). Fully automatic safe retry is NOT possible under uncertain GoTrue outcomes without CAS; manual recovery applies on quarantine.** Commercial SMS gateway/DLT (`DEC-10`) remains open. Zero new decision IDs invented. |
| **`PO-04`** | Authentication Rate Limiting & Error-Response Policy | **APPROVED / CLOSED (2026-11-10)** | **Approved Policy:** `5` failed login attempts per account within a rolling `15-minute` window using privacy-preserving keyed hash (`HMAC` of normalized org + canonical E.164 phone) and shared atomic counters across instances; temporary throttling only (never permanent account lockout); separate IP-based rate limiting with verified `trust proxy`; equivalent pre-DB throttling on unknown accounts; generic `HTTP 401 INVALID_CREDENTIALS` across unknown org/phone/inactive/unactivated/wrong password; generic `HTTP 429` rate-limit error (`Retry-After` only when reliable retry timestamp exists); resets account counter on successful login without clearing IP limits; non-secret audit logging. IP numeric ceilings and tuning durations remain implementation config (not invented policy). Preserves `PO-03` OTP rules unchanged. | **Approved Policy (`PO-04` closed).** Enforced in Task `2.2C`–`2.2D`. |
| **`PO-05`** | Refresh Token Transport & Browser Security Policy | **APPROVED / CLOSED (2026-11-10)** | **Approved Policy:** Refresh tokens transported exclusively in `Secure`, `HttpOnly` cookies (`__Host-hrms_refresh_token`, `Path=/`, omitted `Domain`, topology-matched `SameSite`, conditional dev-HTTP handling), **never** in JSON bodies or JS/storage/URLs/logs; access tokens short-lived JWTs in browser JS memory only (`Authorization: Bearer`); mandatory signed double-submit/synchronizer CSRF + strict `Origin` allowlisting (`403` on missing/malformed/untrusted) on `/refresh`, `/logout`, and cookie-authenticated endpoints; strict `CORS_ALLOWED_ORIGINS` allowlist (`Access-Control-Allow-Credentials: true` only for exact approved origins, zero wildcard); refresh-token rotation (`enable_refresh_token_rotation = true`) + reuse detection/family revocation + honest non-atomicity across GoTrue & PostgreSQL; active DB checks (`resolveTenantContext`) to limit pre-`exp` access JWT exposure; Task `2.2C`/`2.2D` updates [`AuthTokens`](file:///Users/mac/Desktop/HRMS/shared/src/auth/contracts.ts#L22-L27) to omit JSON `refreshToken`. Same-site vs cross-site hosting deployment decision remains open under `DEC-11`. | **Approved Policy (`PO-05` closed).** Deployment topology finalized under `DEC-11` (`PO-01`–`PO-07` auth policies closed). |
| **`PO-06`** | GoTrue Configuration Alignment | **APPROVED / CLOSED (2026-11-10)** | **Approved Policy:** Disable public signup (`enable_signup = false`), set `jwt_expiry = 900` (15m matching `expiresIn: 900`), set `minimum_password_length = 8`, disable GoTrue email confirmation (`enable_confirmations = false` for non-routable Scheme 3 synthetic email), enable refresh-token rotation + reuse detection, and mandate Express broker-only employee auth (zero direct frontend GoTrue calls or `SERVICE_ROLE` exposure). *(Disabling public signup leaves server-side `admin.createUser` operational; disabling email confirmation preserves mandatory HRMS link/QR + SMS OTP activation; requires updating local `config.toml`, [`jwt-verification.test.ts`](file:///Users/mac/Desktop/HRMS/server/tests/jwt-verification.test.ts), and unverified hosted project settings in Task `2.2C`.)* | **Approved Policy (`PO-06` closed).** Hosted settings remain **UNVERIFIED** until Task `2.2C`/deploy. |
| **`PO-07`** | Concurrent Device Session Policy | **APPROVED / CLOSED (2026-11-10)** | **Approved Policy:** Allow employees to remain signed in across **multiple devices simultaneously** with **no arbitrary fixed initial device limit**. Each login creates an independently identifiable `public.user_sessions` record (linked 1:1 via `gotrue_session_id`, keyed `refresh_token_hmac` ONLY, never plaintext tokens; privacy-safe `device_summary`, `approx_ip`, `last_activity_at`). Supports session visibility (`GET /api/v1/auth/sessions`), individual revocation (`DELETE /api/v1/auth/sessions/:sessionId`), revoke-all (`POST /api/v1/auth/sessions/revoke-all` / `/logout` `global`), mandatory revoke-all on password change/OTP reset & employee deactivation, same-tenant Admin revocation (`POST /api/v1/admin/users/:userId/sessions/revoke-all`, `ADMIN` blocked from `SUPER_ADMIN`), protected-request DB revocation enforcement (`revoked_sessions` + `tokens_valid_after_epoch` + `is_active`), concurrent refresh coordination + scoped token-family revocation on confirmed reuse, and 7 mandatory `audit_logs` events. | **Approved Policy (`PO-07` closed).** Live GoTrue `admin.signOut` / remote session termination & `refresh_token_reuse_interval` grace checks queued for Task `2.2H`; all `PO-01`–`PO-07` auth broker policies now complete. |
| **`DEC-10`** | Notification Provider & DLT Selection | **OPEN — Pending Owner Approval** *(Existing Open Item)* | Commercial SMS/Email delivery vendor and Indian DLT template registration for transactional OTP delivery (`PO-03` & Activation SMS OTP) and Phase 2–3 alerts. | Hexagonal `ISmsOtpDispatcher` / `INotificationService` uses mock/console sink in local/dev until commercial gateway + DLT templates are contracted. | **OPEN for live transactional SMS OTP (`PO-03` / Activation); local dev unblocked via mock sink.** |

---

## 11. Existing Implemented Schema vs Proposed Migration `00004` & Implementation Sequence

> *(Full proposed DDL, constraints, partial indexes, and cleanup rules are maintained consistently in [`docs/03_DATABASE_SCHEMA_AND_ERD.md`](file:///Users/mac/Desktop/HRMS/docs/03_DATABASE_SCHEMA_AND_ERD.md#L931) Section 9.)*

### 11.1 Database Implementation Boundary (`00001`–`00003` Live vs `00004` Proposed)
- **Already Implemented in Live Local Database (`supabase/migrations/00001`–`00003`):**
  - `hrms_app_user`, `hrms_schema_owner`, `current_org_id()`, `auth_user_id()` (`00001`)
  - `organizations` (`organization_code`, explicit `selfie_retention_days`, `ENABLE RLS` without `FORCE RLS`), `resolve_organization_by_code()`, `users` (`id PK REFERENCES auth.users(id)`, `uq_users_org_phone`, `uq_users_org_id`, `is_active`, `must_change_password`, `FORCE RLS`) (`00002`)
  - `user_roles`, `is_admin_or_super()`, `is_super_admin()`, `account_provisioning_requests`, `account_provisioning_events` (`ON DELETE RESTRICT`, immutable ledger trigger) (`00003`)
- **NOT YET IN LIVE DATABASE — Proposed Future Migration `00004` (`PO-01`–`PO-07` & Activation Policy Approved; Live SMS Dispatch Pending `DEC-10`):**
  - **`public.users`:** `synthetic_email VARCHAR(255) UNIQUE NOT NULL` (`PO-01` Approved Scheme 3 `<immutable_uuid>@auth.hrms.internal`, post-backfill), `activated_at TIMESTAMPTZ`, `phone_verified_at TIMESTAMPTZ` (populated at successful initial two-factor activation; required for `PO-03` password recovery), `activation_lock_state VARCHAR(30) NOT NULL DEFAULT 'NONE'` (`'NONE' | 'IN_FLIGHT' | 'QUARANTINED_MANUAL_RECOVERY'`), `activation_lock_op_id UUID`, `activation_lock_started_at TIMESTAMPTZ` (user-scoped operation lock preventing cross-token GoTrue races), `tokens_valid_after_epoch BIGINT NOT NULL DEFAULT 0`, `last_login_at TIMESTAMPTZ`, canonical Indian-only E.164 phone `CHECK (phone_number ~ '^\+91[6-9][0-9]{9}$')` (`PO-02` Approved `2026-11-10`).
  - **`public.account_provisioning_requests`:** `synthetic_email VARCHAR(255)` (`PO-01` Approved Scheme 3), partial unique index `uq_prov_active_phone` (`WHERE status IN ('SUBMITTED', 'APPROVED', 'PROCESSING')`), canonical Indian-only E.164 check parity `CHECK (phone_number ~ '^\+91[6-9][0-9]{9}$')` (`PO-02` Approved `2026-11-10`).
  - **`public.account_activation_tokens`:** Single-use high-entropy 256-bit opaque token table (`token_hash CHAR(64) UNIQUE` via SHA-256, `purpose`, `status`, `committing_op_id UUID`, `committing_started_at TIMESTAMPTZ`, `expires_at`, `used_at`, `invalidated_at`, `invalidated_reason`, `failed_attempts`, `max_attempts`, tenant composite FK `(organization_id, user_id)` `ON DELETE CASCADE`, `created_by` FK, active unique partial index `uq_act_tokens_active_user_purpose`, 30-day retention purge job; stores Admin-generated activation link / QR code tokens and optional unfinalized lost-mobile Admin fallback, never low-entropy numeric OTPs).
  - **`public.password_reset_otps`:** Dedicated **`PO-03`** keyed-HMAC OTP challenge table (supports both password reset challenges and initial activation OTP challenges via `purpose`, `otp_hmac CHAR(64)` using Express-only `OTP_HMAC_PEPPER`, `phone_number` snapshot `CHECK (^\+91[6-9][0-9]{9}$)`, `delivery_status`, `expires_at <= created_at + 15m`, `resend_available_at`, `used_at`, **`sessions_revoked_at TIMESTAMPTZ`** single-use session-revocation guard, `invalidated_at`, `invalidated_reason`, `failed_attempts`, `max_attempts`, `FORCE RLS`, zero direct `hrms_app_user` access, active unique partial index `uq_pwd_reset_otp_active_user`, 30-day purge rule; concrete TTL/attempt/cooldown numbers remain proposed parameters).
  - **`public.user_sessions` (`PO-07` Approved):** Tenant-isolated multi-device session ledger (`id UUID PRIMARY KEY`, `organization_id`, `user_id` composite FK `ON DELETE CASCADE`, `gotrue_session_id UUID NOT NULL UNIQUE`, keyed `refresh_token_hmac CHAR(64)` + bounded-grace `prev_refresh_token_hmac CHAR(64)`/`prev_rotated_at` [zero plaintext refresh tokens or JWTs], privacy-safe `device_summary` & masked `approx_ip`, `last_activity_at`, `expires_at`, `revoked_at`, `revoked_reason`, `revoked_by_user_id`, `FORCE RLS`, 30-day expired/revoked purge sweep).
  - **`public.revoked_sessions`:** Short-lived blocklist keyed by GoTrue JWT `session_id UUID PRIMARY KEY`, `organization_id`, `user_id` composite FK, `revoked_reason`, `expires_at TIMESTAMPTZ`, indexed expiry sweep cleanup (`DELETE WHERE expires_at < NOW()`).
  - **`hrms_internal.context_signing_keys` & `hrms_internal.tx_context_challenges` (Task 2.2B.9C):** Private tables owned exclusively by `hrms_context_verifier` (`NOBYPASSRLS`) holding versioned 256-bit `HMAC-SHA256` keys (`'ACTIVE' | 'VERIFY_ONLY' | 'REVOKED'`, or Ed25519 public verifying keys if `pgsodium` is confirmed on hosted Supabase in Task `2.2C`) and single-use `pg_current_xact_id()`-bound nonces (`15s` TTL, zero grants to `hrms_app_user`, `hrms_auth_lookup_owner`, `hrms_session_manager`, or frontend roles).
  - **`public.auth_rate_limits` & `public.audit_logs`:** Persistent sliding-window rate-limit store (if multi-instance Express without Redis) and append-only general security `audit_logs` ledger (`LOGIN_FAILURE`, `LOGIN_RATE_LIMITED`, `LOGIN_SUCCESS`, `SESSION_CREATED`, `SESSION_REFRESHED`, `SESSION_REVOKED`, `ALL_SESSIONS_REVOKED`, `PASSWORD_CHANGE_SESSIONS_REVOKED`, `ADMIN_SESSIONS_REVOKED`, `REFRESH_TOKEN_REUSE_DETECTED`, `ACCOUNT_ACTIVATED`, `USER_ACTIVATION_QUARANTINED`, `ACTIVATION_QUARANTINE_CLEARED`, `PASSWORD_CHANGE`, `PASSWORD_RESET_OTP_*`, `PASSWORD_RESET_COMPLETED`, `USER_DEACTIVATED` — strictly zero OTPs/passwords/refresh tokens/`synthetic_email`).
  - **`SECURITY DEFINER` Functions (`SET search_path = pg_catalog, public`, Granted ONLY to `hrms_app_user`):**
    - **`hrms_auth_lookup_owner` (`NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS` + Pre-Auth Read-Only Columns ONLY in Private Schema `hrms_internal`; ZERO access to `public.user_sessions`, `public.revoked_sessions`, `user_roles`, or `context_signing_keys`, with Tier 2/3 fallbacks in Section 3.2):**
      - `hrms_internal.resolve_login_identity(p_organization_id UUID, p_phone_number TEXT)` -> `(user_id UUID, synthetic_email VARCHAR(255))`
      - `hrms_internal.resolve_recovery_identity(p_organization_id UUID, p_phone_number TEXT)` -> `(user_id UUID)`
      - `hrms_internal.resolve_auth_user_tenant(p_auth_user_id UUID)` -> `(user_id, organization_id, org_is_active, user_is_active, is_activated)` *(reads strictly pre-existing granted columns on `public.users` & `public.organizations` — zero session-table access)*
    - **`hrms_context_verifier` (`NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`, Task 2.2B.9C):**
      - `hrms_internal.issue_tx_challenge()` -> `(tx_xid, challenge_nonce)` *(granted to `hrms_app_user`; issues 64-bit `pg_current_xact_id()` + CSPRNG nonce inside active `READ WRITE` transaction)*
      - `hrms_internal.assert_verified_tx_context(p_tx_proof, p_expected_op, p_expected_target_id)` *(granted strictly to `hrms_session_manager`; validates constant-time `pgcrypto` `HMAC-SHA256`, `xid8`, single-use nonce consumption, TTL, `op`, `target_id`, and exact GUC parity)*
    - **`hrms_session_manager` (`NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS` + `FORCE RLS` Preserved on `public.user_sessions` & `public.revoked_sessions`, zero caller-supplied `p_actor_user_id`, mandatory `p_tx_proof` first arg on ALL 11 routines, Sections 9.6.7–9.6.8):**
      - `hrms_internal.verify_authenticated_session_and_roles(p_tx_proof, p_session_id, p_jwt_iat)` *(verifies `p_tx_proof`, checks active org/user, `revoked_sessions`, `tokens_valid_after_epoch`, `user_sessions`, roles, and debounced activity)*
      - `hrms_internal.lookup_session_by_refresh_hmac(p_tx_proof, p_rt_hmac)` *(verifies `p_tx_proof` `'LOOKUP_REFRESH_HMAC'` + narrow GUC equality policy for cookie-only `/refresh`)*
      - `hrms_internal.create_user_session(p_tx_proof, p_gotrue_session_id, ...)`, `hrms_internal.rotate_user_session(p_tx_proof, ...)`, `hrms_internal.list_active_user_sessions(p_tx_proof, p_current_gotrue_session_id)`, `hrms_internal.revoke_user_session(p_tx_proof, p_user_session_id, p_jwt_exp)` *(individual session only; preserves sibling sessions & `tokens_valid_after_epoch`)*, `hrms_internal.revoke_compromised_session_family(p_tx_proof, p_user_session_id, p_jwt_exp)`, `hrms_internal.revoke_own_all_sessions(p_tx_proof, ...)`, `hrms_internal.otp_revoke_all_user_sessions(p_tx_proof, p_otp_challenge_id)` *(double defense: signed `p_tx_proof` + atomic single-use `sessions_revoked_at` update)*, `hrms_internal.admin_revoke_all_user_sessions(p_tx_proof, p_target_user_id, p_reason_code)` *(verifies `p_tx_proof`, actor `user_roles` in DB, and blocks `ADMIN` targeting `SUPER_ADMIN`)*, and `hrms_internal.purge_expired_sessions(p_tx_proof)` *(per-tenant sweep)*
    - Remaining controlled onboarding/provisioning/OTP routines (`complete_account_activation(...)`, `reissue_account_activation(...)`, `clear_activation_quarantine(...)`, `create_password_reset_otp(...)`, `lock_password_reset_otp(...)`, `consume_password_reset_otp(...)`, `record_password_reset_otp_failure(...)`, `initiate_password_reset(...)`, `claim_next_provisioning_request(...)`, `complete_provisioning_request(...)`, `deactivate_user_account(...)`) — authored with equivalent least-privilege `NOLOGIN NOBYPASSRLS` role separation in Task 2.2C.

### 11.2 Execution Sequence (`PO-01`–`PO-07` & Activation Policy Approved; Live SMS Dispatch Awaits `DEC-10`)
1. **Task 2.2C (Config Alignment, Shared Contracts & Migration `00004`):** Policy phase `PO-01`–`PO-07` complete (`DEC-10` SMS vendor/DLT, operational OTP parameter defaults, lost-mobile Admin fallback approval, and `DEC-11` deployment topology remain open operational/infra items). Align local [`supabase/config.toml`](file:///Users/mac/Desktop/HRMS/supabase/config.toml) (`enable_signup = false`, `jwt_expiry = 900`, `minimum_password_length = 8`) & verify hosted project alignment **plus inspect hosted `pgsodium` support for asymmetric Ed25519 `hrms_context_verifier` upgrade vs `pgcrypto` HMAC-SHA256 baseline**, update `jwt-verification.test.ts`, author Migration `00004` (`CHECK (phone_number ~ '^\+91[6-9][0-9]{9}$')`, `account_activation_tokens`, `password_reset_otps` incl. `sessions_revoked_at`, `user_sessions`, `revoked_sessions`, `hrms_internal.context_signing_keys`, `hrms_internal.tx_context_challenges`, `hrms_auth_lookup_owner`, `hrms_context_verifier`, `hrms_session_manager`, `phone_verified_at`, initial key bootstrap procedure), implement canonical `+91XXXXXXXXXX` Indian mobile normalizer & cookie-only `AuthTokens` contract in `@hrms/shared`, build Express `txContextSigner` (`TX_CONTEXT_HMAC_KEY` + `TX_CONTEXT_HMAC_KEY_ID` + key rotation loader), and install `@supabase/supabase-js` in `@hrms/server`.
2. **Task 2.2D (Stateless Auth Clients & Login/Activation Endpoints):** Build stateless Anon/Admin clients (`persistSession: false`), dual-key anti-DoS rate limiter, timing-equalized `POST /api/v1/auth/login` (obtaining `issue_tx_challenge()` + signing `p_tx_proof` to create `user_sessions` via `hrms_session_manager` + issuing `__Host-` refresh cookie + JSON access token only + `SESSION_CREATED`), `POST /api/v1/auth/activate/request-otp`, `POST /api/v1/auth/activate`, and Admin `POST /api/v1/admin/users/:userId/reissue-activation`.
3. **Task 2.2E (`resolveTenantContext` Middleware & Revocation Guard):** Implement three-boundary DB-backed verification (`resolve_auth_user_tenant` -> `SET LOCAL app.current_org_id` + `SET LOCAL app.current_user_id` -> `issue_tx_challenge()` + Express `TX_CONTEXT_HMAC_KEY` signature -> `verify_authenticated_session_and_roles(p_tx_proof, ...)` enforcing cryptographic context parity, `revoked_sessions`, `user_sessions.revoked_at`, `tokens_valid_after_epoch`, debounced `last_activity_at`) bridging `requireAuth` (Task 2.2A) and [`withTenantTransaction`](file:///Users/mac/Desktop/HRMS/server/src/db/transaction.ts#L64-L93).
4. **Task 2.2F (Token Refresh, Logout, Session Management & OTP Password Recovery Endpoints):** Implement `/refresh` (`PO-05` CSRF `Origin` + `X-CSRF-Token` + `__Host-` cookie + signed `p_tx_proof` on lookup/rotate/reuse revocation + per-session concurrency lock), `/logout`, `/auth/sessions`, `DELETE /auth/sessions/:sessionId`, `POST /auth/sessions/revoke-all`, `POST /admin/users/:userId/sessions/revoke-all`, `/change-password`, `/first-login-change`, `PO-03` `/reset-password/request-otp` & `/reset-password/confirm` (calling `otp_revoke_all_user_sessions(p_tx_proof, otpChallengeId)` backed by `sessions_revoked_at` + `ISmsOtpDispatcher` using mock sink locally pending `DEC-10`), plus any formally approved Admin lost-mobile recovery fallback.
5. **Task 2.2G (Provisioning Worker & Deactivation Synchronization):** Build Maker-Checker provisioning queue executor with GoTrue provenance check (`422` verification), compensation, and exit/deactivation sync (signed `admin_revoke_all_user_sessions`, advancing `tokens_valid_after_epoch`, GoTrue ban/signout).
6. **Task 2.2H (Live GoTrue + PostgreSQL Integration & Security Suite):** Live-verify GoTrue `v2.197.0` `admin.signOut` scopes, `refresh_token_reuse_interval`, `ban_duration`, `422` ownership verification, `iat`/session revocation, timing equalization, multi-org phone reuse, **key rotation (`ACTIVE -> VERIFY_ONLY -> REVOKED`), and the complete 15-scenario Task `2.2B.9C` adversarial GUC/proof/replay/OTP SQL test matrix (`T1`–`T15`) against live local PostgreSQL**.
