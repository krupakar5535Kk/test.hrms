# PRODUCT REQUIREMENTS DOCUMENT

## HRMS + SMART ATTENDANCE + PAYROLL

**Current Baseline:** Version 1.9  
**Date:** 2026-11-08  
**Status:** Current Amended PRD Baseline with Open Policy Blockers (Incorporating Confirmed Product Owner Payroll Policies with Explicitly Cataloged Open Policy Decisions)  
**Historical Baselines:** 
- Version 1.3 (Initial Product Discovery Baseline)
- Version 1.4 (Historical Approved DEC-01: Exact Lunch Window Intersection Clipping - Superseded by v1.9)  
- Version 1.5 (Historical Approved DEC-02: Single Daily Attendance Pair Initial Baseline)  
- Version 1.6 (Historical Approved Baseline: DEC-02 Refinements, Idempotency & Unpaired Check-Out Safeguards)  
- Version 1.7 (Historical Approved Baseline: DEC-13 Tri-Partite Tenant Login Architecture)  
- Version 1.8 (Historical Approved Baseline: DEC-09 Supabase Auth Broker Architecture)  
**Initial Scale:** Approximately 10 employees • 1 Office • Multi-office and SaaS-ready architecture  

---

### Document Metadata & Revision History

| Document Field | Value |
|---|---|
| Product | Human Resource Management System with smart attendance and working-hour-based payroll |
| Version | 1.9 (Current Baseline) |
| Historical Baselines | Version 1.3 (Discovery Baseline), Version 1.4 (DEC-01 Approved), Version 1.5 (DEC-02 Approved), Version 1.6 (DEC-02 Refined Baseline), Version 1.7 (DEC-13 Approved Baseline), Version 1.8 (DEC-09 Approved Baseline) |
| Audience | Product Owner, Software Architect, Developers, QA |
| Purpose | Define agreed product behavior, constraints, workflows, calculations, and acceptance criteria |

#### Revision History
- **v1.0 - v1.2:** Initial drafts and discovery iterations.
- **v1.3:** Approved requirements baseline for Antigravity implementation planning.
- **v1.4:** Officially incorporated Product Owner approval of **DEC-01 (Option A: Exact Lunch Window Intersection Clipping)**. Resolved TBD-01. Standardized deduction formulas and calculation examples. *(Superseded by v1.9)*.
- **v1.5:** Officially incorporated Product Owner approval of **DEC-02 (Option A: One Attendance Pair Per Employee Per Working Day)**. Enforced single Check-In and single Check-Out pair per scheduled working day. Codified Admin-only attendance corrections, duplicate punch prevention, and idempotent retry safety.
- **v1.6:** Refined DEC-02 technical boundaries based on Product Owner review (maximum one pair boundary, Admin dual-workflow corrections, deterministic check-out validation precedence, idempotency replay, unpaired check-out exception policy).
- **v1.7:** Officially incorporated Product Owner approval of **DEC-13 (Option A: Organization Code + Phone Number + Password Login Architecture)**: server-side tenant pre-resolution, multi-tenant credential scoping, zero client trust for tenant UUIDs.
- **v1.8:** Officially incorporated Product Owner approval of **DEC-09 (Supabase Auth with Express Authentication Broker)**: Supabase Auth as single password and identity source of truth; Express broker translates org code + phone to deterministic synthetic email; no second password store; 1:1 user mapping.
- **v1.9 (Current Amended Baseline with Open Policy Blockers — 2026-11-08):** Officially incorporated Product Owner Payroll Policy Amendment (**Task ID: HRMS-PO-PAYROLL-AMENDMENT-01**):
  1. **Paid Lunch Policy (DEC-01 Amendment):** Normal working schedule is 10:00 AM to 6:00 PM (8.0 scheduled hours). Lunch is 1:00 PM to 2:00 PM and is **PAID**. Lunch is **not deducted** from employee salary. A completed scheduled day receives **8 payable hours** (480 minutes). Lunch cannot be counted twice. Historical DEC-01 deduction algorithm is superseded.
  2. **Payable Hours Formulation:** Defined as:
     $$\text{Payable Hours} = \text{Approved Actual Working Hours} + \text{1 Paid Lunch Hour}$$
     *(Payable Minutes = Approved Actual Working Minutes + 60 Paid Lunch Minutes)*. Paid lunch is paid time, not actual productive working time. Actual working time must be independently established and approved.
  3. **Paid Sundays:** Sunday is a paid weekly off. Employees do not attend office to receive this credit. The system automatically credits **8 paid hours (480 minutes)** for each Sunday in the monthly payroll calculation.
  4. **Paid Recognized Public Holidays:** Recognized public holidays are paid. Employees do not attend office to receive this credit. The system automatically credits **8 paid hours (480 minutes)** for each recognized public holiday on the organization's recognized holiday calendar.
  5. **Sunday & Public Holiday Overlap Rule:** When a recognized public holiday falls on a Sunday, the system credits **8 paid hours only** (not 16 hours). Prevents duplicate paid-day credits while preserving dual calendar classification.
  6. **Calendar-Day Monthly Salary Reference Model:** Monthly salary reference is distributed across calendar days of the payroll month ($D_{\text{month}} \in \{28, 29, 30, 31\}$):
     $$\text{Daily Rate} = \frac{\text{Monthly Salary Reference}}{D_{\text{month}}}$$
     $$\text{Hourly Rate} = \frac{\text{Daily Rate}}{8} = \frac{\text{Monthly Salary Reference}}{D_{\text{month}} \times 8}$$
  7. **DEC-15 Approved Option A (Effective-Date Salary Proration):** When monthly salary reference changes mid-month, rates are applied based on the salary reference active on each specific date. Pre-effective dates use old rate; effective date onward uses new rate. Automatic Sunday and holiday credits use the rate active on that date. Closing rate is not applied retrospectively.
  8. **DEC-14 Approved Baseline Preserved:** Strict 30-day maximum ceiling on raw attendance selfies subject to legal review before production. The precise retention-clock starting point (device capture timestamp vs. trusted server receipt timestamp) is an unresolved policy and architectural clarification.
  9. **Open Policy Decisions Explicitly Cataloged:** DEC-16 (Salary advance deficit carry-forward), Sunday work compensation, public holiday work compensation, leave-policy conflict (CL/SL/PL/LWP zero payable hours vs. calendar-day salary model), leave quota deduction metric (TBD-06), and Sunday/holiday leave classification remain strictly open.
- **v1.9 Attendance Architecture Clarification Addendum (2026-11-10 — Proposed Policy Updates Pending PO Approval):**
  1. **Proposed Office Geofence Tightening (`PO-ATT-GEOFENCE-50M` — Pending Formal PO Approval):** Proposes tightening standard office geofence radius from the `100m` legacy baseline to **`50 metres`** (while retaining the $\le 30\text{m}$ GPS accuracy threshold). Applies uniformly to all employees—including Sales Team members—when attending the office.
  2. **Proposed Sales Team Field Attendance Exception (`PO-ATT-FIELD-SALES` — Pending Formal PO Sign-Off):** Introduces an exception-only **"Field Attendance Request"** restricted exclusively to active Sales Team employees working away from the office at distant customer/sales sites. Normal employees cannot view or submit field requests. Enforces live selfie, face matching, liveness, actual GPS telemetry + accuracy $\le 30\text{m}$ (retained truthfully without geofence requirement), mandatory sales/location comment, strict `PENDING_REVIEW` status (never auto-approved), explicit Admin `APPROVE`/`REJECT`, and full DEC-02/payroll non-duplication integrity. Does not alter Authentication Design (`DEC-09`, `DEC-13`, `PO-01`–`PO-07`).

---

# 1. Executive Summary

Build a secure, responsive HRMS for employee administration, GPS- and selfie-based attendance, leave management, working-hour-based payroll, payslips, reporting, and auditability. The first deployment is for one organization with approximately 10 employees and one office. The architecture must support future growth and multiple offices without requiring an initial microservices architecture.

The defining business rule is that **salary is proportional to approved payable working hours**, calculated under a calendar-day monthly distribution:
1. Normal schedule is **10:00 AM to 6:00 PM** (8 scheduled hours).
2. Lunch (1:00 PM to 2:00 PM) is **PAID** and contributes 1 hour (60 minutes) to daily payable time for scheduled working days.
3. Daily Payable Hours = Approved Actual Working Hours + 1 Paid Lunch Hour.
4. Sundays and recognized public holidays receive an **automatic 8-hour paid credit (480 minutes)** without requiring office attendance.
5. Overlapping Sunday and public holiday receives exactly 8 paid hours (never 16).
6. Time worked beyond 6:00 PM is included when verified and approved by Admin; it is paid at the normal hourly rate ($1.0\times$), with no separate overtime multiplier.
7. Employees are not assigned an arbitrary fixed half-day salary and do not receive an additional late-arrival or early-departure penalty on top of actual-hours accounting.

---

# 2. Product Goals and Non-Goals

## 2.1 Goals
- Replace manual HR, attendance, and payroll workflows with a centralized application.
- Capture attendance using GPS geofencing, mandatory selfies, face matching, and liveness checks.
- Enforce strict single-interval daily attendance per employee (maximum one check-in, maximum one check-out).
- Calculate salary transparently from approved payable hours using calendar-day hourly rates, credited paid lunch, and automatic Sunday/holiday credits.
- Provide separate Super Admin, Admin, and Employee experiences with role-based permissions.
- Maintain traceable attendance corrections, payroll approvals, sensitive changes, and evidence access.
- Start with one office and approximately 10 employees while supporting future multi-office growth.
- Deliver a responsive web application and PWA first; consider native mobile apps in a later phase.

## 2.2 Non-Goals for Initial Release
- Multiple attendance sessions or split shifts per working day are **not supported in Phase 1 or Phase 2**.
- Native Android and iOS applications are not part of the initial release.
- Automatic bank salary disbursement is not part of the initial release; payment tracking is manual.
- Microservices are not required for the initial scale.
- A specific commercial face-verification vendor has not yet been selected.
- The product must not claim legal or statutory payroll compliance until applicable rules have been reviewed and configured. The interaction between paid calendar-day salary and existing unpaid leave rules (CL/SL/PL) must receive employment-law review and Product Owner resolution before production use.
- **Actual Working Time vs. Elapsed Attendance Blocker (`BLOCKER-ACTUAL-WORK-MEASUREMENT`):** A single check-in/check-out pair captures elapsed attendance span, not granular productive working intervals. The system must not automatically equate elapsed presence with productive work, nor assume computer inactivity is non-working time. An auditable measurement or approval mechanism must be designed and approved before implementation.

---

# 3. Users, Roles and Access Control

## 3.1 Super Admin
- Has full system authority.
- Creates, manages, and deactivates Admin accounts.
- Configures payroll settings, sensitive system settings, and office-wide policies.
- Approves or rejects payroll submitted by Admin.
- Controls sensitive salary changes and access to audit records.
- Reviews system-level exceptions, security events, and attendance audit logs.

## 3.2 Admin
- Manages employee profiles, departments (including Sales Team field-attendance department designation), designations, and employee lifecycle.
- Reviews attendance, GPS/face exceptions, **Sales Team Field Attendance Requests** (inspecting comment, live selfie, biometric verification telemetry, captured field GPS coordinates/accuracy, submission timestamp, and same-day attendance records to `APPROVE` or `REJECT`), and correction requests.
- **Exclusive authority to perform attendance corrections** (missing punches, accidental check-outs, timestamp corrections) with mandatory justification reason.
- Approves or rejects leave applications.
- Prepares and submits payroll for Super Admin approval.
- Generates reports and performs authorized HR operations.

## 3.3 Employee
- Logs in using organization code, phone number, and password (DEC-13 & DEC-09 Approved).
- Views and manages permitted parts of their own profile.
- Checks in and checks out using the required **standard office attendance verification flow** (strictly once per day; mandatory for ALL employees, including Sales Team employees attending the office).
- **Sales Team Field Attendance Exception (`PO-ATT-FIELD-SALES` Proposed):** Employees assigned exclusively to the Sales Team may submit a **"Field Attendance Request"** (`PENDING_REVIEW`) when performing work at a distant customer or sales location and unable to physically reach the office. Standard (non-Sales) employees must not see or use this feature.
- Views their own attendance, hours, field request outcomes, leave balance, salary estimates, approved payslips, and notifications.
- Applies for leave and views application outcomes.
- **Cannot directly edit attendance records, self-correct punches, self-approve field requests, or access another employee's data.**
- After checking out for the day, the attendance state is completed; no further check-in or check-out action is offered.

---

# 4. Authentication and Account Lifecycle (DEC-09 & DEC-13 Approved)

Authentication operates via the approved Supabase Auth with Express Authentication Broker model:
- Express accepts `{ organizationCode, phoneNumber, password }`. Employees never enter or see an email address.
- Backend resolves tenant internally (`resolve_organization_by_code()` in Migration `00002`), discards client tenant UUIDs, resolves internal login identity (`hrms_internal.resolve_login_identity()` proposed for future Migration `00004` under dedicated non-login read-only owner `hrms_auth_lookup_owner`, returning zero info for inactive/unactivated/missing accounts), and brokers password authentication against Supabase Auth (GoTrue). **No custom password hashes or custom JWTs/capability tickets are generated.**
- Supabase Auth GoTrue verifies password and issues signed JWTs (`ES256` locally). Express cryptographically verifies the JWT via JWKS, resolves verified tenant/active/session-revocation status from PostgreSQL, and establishes transaction-local RLS context (`SET LOCAL app.current_org_id`, `SET LOCAL app.current_user_id`) under `hrms_app_user`.
- During onboarding/activation, employees activate accounts via an approved two-factor flow: Admin-generated single-use, time-limited 256-bit opaque activation token URL with client-only fragment (`/auth/activate#token=...`) and QR code (`account_activation_tokens` proposed for future Migration `00004`, shared strictly out-of-band by Admin) combined with automated SMS OTP verification dispatched to their registered Indian mobile (`+91XXXXXXXXXX`, `PO-02`). Plaintext tokens are never logged or exposed in telemetry. Cross-system completion enforces a user-level operation lock (`public.users.activation_lock_state` per `auth_user_id`; preventing cross-token overwrites; releasing ONLY on verified GoTrue `422 weak_password`; quarantining uncertain outcomes `QUARANTINED_MANUAL_RECOVERY` and blocking Admin reissue until manual `SUPER_ADMIN`/SRE unlock because **fully automatic safe retry is not technically possible with GoTrue**; leaving already-completed `account_provisioning_requests` untouched) without holding open database locks across GoTrue calls. Employees choose their own permanent password; Administrators never create, set, view, or know employees' permanent passwords. Tokens invalidate on use, 24h expiry, cancellation, uncertain-outcome quarantine, or Admin reissue (`POST /api/v1/admin/users/:userId/reissue-activation` scoped to same-tenant Admins when lock is `'NONE'`). Employees never see or enter an email address, preserving `PO-01` Scheme 3 (`<immutable_uuid>@auth.hrms.internal`).
- *Auth Broker Decisions Approved (`PO-01`–`PO-07` & Initial Account Activation Policy) & Open Operational Dependencies:* **`PO-01` (`REC-01`) is OFFICIALLY APPROVED / CLOSED as Scheme 3 (`<immutable_uuid>@auth.hrms.internal`)** — generated during account provisioning, stored internally in `public.users.synthetic_email`, stable across employee mobile number changes, and strictly prohibited from exposure in employee-facing UI, API responses, logs, error messages, or payslips (employees never enter an email address). **`PO-02` (Indian Mobile Number Normalization) is OFFICIALLY APPROVED / CLOSED (`2026-11-10`)** — Phase 1 supports Indian mobile numbers only, storing canonical E.164 `+91XXXXXXXXXX` (`^\+91[6-9][0-9]{9}$`) across `public.users.phone_number` and `account_provisioning_requests.phone_number`, accepting `9876543210`, `919876543210`, or `+919876543210` (with spaces/hyphens stripped) server-side while rejecting international numbers, leading `0` trunk prefixes, arbitrary prefixes, landlines, and short codes, maintaining tenant-scoped uniqueness (`uq_users_org_phone`), keeping `PO-01` `synthetic_email` immutable on phone changes, and returning generic auth errors. **`PO-03` (Self-Service Password Recovery via Mobile OTP) is OFFICIALLY APPROVED / CLOSED (`2026-11-10`)** — Phase 1 employees recover forgotten passwords self-service via OTP sent exclusively to their registered, verified Indian mobile number (`Organization Code + Mobile Number + OTP + New Password`; zero email input or exposure; preserves `DEC-09` & `PO-01` Scheme 3 without Supabase native phone auth; mandates CSPRNG generation, short TTL, single-use atomic lock, keyed HMAC digest storage in proposed `password_reset_otps`, max attempts, cooldowns/rate limits, anti-enumeration responses, GoTrue password update, global session revocation, and non-secret audit logging; Admins never learn passwords). **`Initial Account Activation Policy` is OFFICIALLY APPROVED / CLOSED (`2026-11-10`) as a distinct onboarding policy** via Admin-generated 256-bit activation link / QR code (`#token=...`) shared out-of-band + mobile SMS OTP verification with user-scoped single-flight cross-system completion and deterministic `app_metadata.hrms_activation_op_id` reconciliation (manual SRE recovery if quarantined). **`PO-04` (Authentication Rate Limiting & Error Responses) is OFFICIALLY APPROVED / CLOSED (`2026-11-10`)** — **`5` failed login attempts per account within a rolling `15-minute` window** tracked via atomic shared counters across instances using a privacy-preserving `HMAC` key (`normalizedOrg + canonicalPhone`), temporary throttling only (never permanent account lockout), separate IP rate limiting with verified `trust proxy`, equivalent pre-DB throttling on unknown accounts, generic `HTTP 401 INVALID_CREDENTIALS` and `HTTP 429` (`Retry-After` only when reliable retry time exists), account counter reset on success without clearing IP limits, and non-secret audit logging (preserves `PO-03` OTP rules unchanged). **`PO-05` (Refresh Token Transport & Browser Security) is OFFICIALLY APPROVED / CLOSED (`2026-11-10`)** — refresh tokens transported strictly via `Secure`, `HttpOnly` cookies (`__Host-hrms_refresh_token`, `Path=/`, omitted `Domain`, topology-matched `SameSite`, conditional dev-HTTP handling), never returned in JSON bodies (updating [`AuthTokens`](file:///Users/mac/Desktop/HRMS/shared/src/auth/contracts.ts#L22-L27) in Task `2.2C`/`2.2D`), short-lived access tokens kept in JS memory only (`Authorization: Bearer`), signed double-submit/synchronizer CSRF + strict `Origin` allowlisting (`403` on missing/malformed/untrusted) on `/refresh` and `/logout`, strict `CORS_ALLOWED_ORIGINS` (zero wildcard with credentials), and refresh-token rotation + reuse detection (`DEC-11` deployment topology binding remains open). **`PO-06` (GoTrue Configuration Alignment) is OFFICIALLY APPROVED / CLOSED (`2026-11-10`)** — `enable_signup = false`, `jwt_expiry = 900` (15m), `minimum_password_length = 8`, `enable_confirmations = false` (preserving HRMS onboarding activation gate), refresh-token rotation + reuse detection enabled, and Express broker-only employee authentication (`supabase/config.toml` update queued for Task `2.2C`; hosted Supabase project settings unverified until deploy). **`PO-07` (Concurrent Device Session Policy) is OFFICIALLY APPROVED / CLOSED (`2026-11-10`; Tasks 2.2B.9A–C Hardened)** — multiple simultaneous device sessions allowed with no arbitrary initial cap; independent tenant-isolated sessions tracked in proposed `public.user_sessions` (keyed `HMAC-SHA256` refresh digests, zero plaintext tokens/JWTs, privacy-safe device/IP/activity visibility) isolated under `hrms_session_manager` (`NOBYPASSRLS`) with `hrms_context_verifier` transaction-bound signed `p_tx_proof` (`xid8` + single-use nonce) & OTP `sessions_revoked_at` guard preventing GUC impersonation; supports employee active-session listing (`GET /api/v1/auth/sessions`), individual revocation (`DELETE /api/v1/auth/sessions/:sessionId`), employee revoke-all (`POST /api/v1/auth/sessions/revoke-all` / `/logout`), mandatory revoke-all on password change/reset & deactivation, same-tenant Admin revocation (`POST /api/v1/admin/users/:userId/sessions/revoke-all`, blocking `ADMIN` on `SUPER_ADMIN`), protected-request DB revocation (`revoked_sessions` + `tokens_valid_after_epoch` + `is_active` blocking already-issued `900s` JWTs), concurrent refresh coordination + affected-family revocation on reuse, and 7 mandatory `audit_logs` events (`SESSION_CREATED`, `SESSION_REFRESHED`, `SESSION_REVOKED`, `ALL_SESSIONS_REVOKED`, `PASSWORD_CHANGE_SESSIONS_REVOKED`, `ADMIN_SESSIONS_REVOKED`, `REFRESH_TOKEN_REUSE_DETECTED`). Live GoTrue capability checks are queued for Task `2.2H`; commercial SMS provider/DLT integration remains unresolved (**`DEC-10` OPEN**), exact OTP tuning parameters remain proposed, and the **Admin-assisted recovery alternative for lost registered mobile numbers** is documented without finalizing its operational approval workflow. Full specification in [`docs/09_AUTHENTICATION_BROKER_ARCHITECTURE.md`](file:///Users/mac/Desktop/HRMS/docs/09_AUTHENTICATION_BROKER_ARCHITECTURE.md) and [`docs/03_DATABASE_SCHEMA_AND_ERD.md`](file:///Users/mac/Desktop/HRMS/docs/03_DATABASE_SCHEMA_AND_ERD.md#L961).

---

# 5. Employee Management

- Employee IDs: Automatically generated per organization starting at `EMP001`, `EMP002`, ... (`UNIQUE (organization_id, employee_code)`).
- Departments and Designations: Managed by Admin with historical preservation.
- Employee Exit: Resignation/termination tracking, last working day, deactivation (`is_active = FALSE`).

---

# 6. Office and Work Schedule (Amended v1.9 Baseline)

| Parameter | Confirmed Requirement (v1.9 Baseline) |
|---|---|
| Working days | Monday through Saturday |
| Weekly holiday | Sunday (**PAID** — Automatic 8-hour paid credit) |
| Public holidays | Organization-recognized holidays (**PAID** — Automatic 8-hour paid credit) |
| Sunday/Holiday overlap | Exactly 8 paid hours credited (no duplicate credit) |
| Official start | 10:00 AM |
| Official end | 6:00 PM; verified hours beyond 18:00 count when approved by Admin. |
| Lunch interval | 1:00 PM – 2:00 PM (**PAID** — Credited as 60 payable minutes on working days). |
| Standard full day | **8.0 payable hours** (7.0 hours approved actual work + 1.0 hour paid lunch). |
| Daily session policy | **Maximum one Check-In and maximum one Check-Out pair per employee per working day (DEC-02 Approved).** |
| Late grace | 10 minutes; arrival after 10:10 AM is labeled Late (descriptive flag, no monetary fine). |
| Early-departure grace | 10 minutes; departure before 5:50 PM is labeled Early Departure (descriptive flag, no monetary fine). |
| Overtime | No separate overtime premium/multiplier. Verified hours beyond 6:00 PM count when approved by Admin, at normal hourly rate ($1.0\times$). |

---

# 7. Smart Attendance & Daily Session Lifecycle

### 7.1 Standard Office Attendance Verification (Mandatory for ALL Employees, Including Sales Team at Office)
- **Maximum Attendance Events (DEC-02 Approved):** Maximum one `CHECK_IN` and one `CHECK_OUT` per employee per scheduled working day ($\le 1$ pair).
- **Deterministic Check-Out Validation:** (1) Already checked out $\rightarrow$ HTTP 409 `ATTENDANCE_ALREADY_COMPLETED`; (2) No check-in $\rightarrow$ HTTP 409 `CHECK_OUT_WITHOUT_CHECK_IN`; (3) Process punch.
- **Verification Gates (All Required for Auto-Approval):**
  1. Live camera selfie capture (file picker uploads prohibited), liveness verification challenge, and 1:1 facial match against Admin-approved biometric enrollment reference (up to 3 attempts; 3rd failure routes to `PENDING_REVIEW` with Admin notification).
  2. GPS coordinates, horizontal accuracy, and capture timestamp: maximum allowed GPS accuracy remains $\le 30\text{m}$ (poor accuracy $> 30\text{m}$ prompts employee retry).
  3. Server-side Haversine distance computed against authoritative DB office coordinates: legacy baseline radius is `100m`; **proposed policy change tightens standard office radius to `50 metres` (`PO-ATT-GEOFENCE-50M` pending formal PO approval)**.
  4. Suspected GPS spoofing / impossible-travel anomalies are rejected or flagged per security rules.
  5. Both face/liveness verification and office geofence verification must pass for automatic approval; punches outside the office geofence reject normal office attendance.
  6. Offline punches (`is_offline_sync = true`) route strictly to `PENDING_REVIEW` and never auto-approve.
- **Admin Correction Policy:** Workflow A (Missing punch created in `attendance_events` with `is_manual_entry = true`) vs. Workflow B (Incorrect punch corrected via `attendance_corrections` updating effective timestamps on `attendance_days`, preserving immutable raw events).
- **Biometric Retention (DEC-14 Approved Subject to Legal Review):** Strict 30-day maximum ceiling on raw attendance selfies stored strictly in private Supabase Storage (`attendance-evidence`, no public image URLs).

### 7.2 Sales Team Field Attendance Exception (`PO-ATT-FIELD-SALES` — PROPOSED Pending Formal PO Approval)
- **Eligibility Scope (Exception Only):** Available **exclusively** to active employees assigned to a designated Sales Team department (`departments.allow_field_attendance = TRUE`) when working at a distant customer or sales location and unable to physically reach the office. Standard (non-Sales) employees must neither see nor invoke this workflow. When attending the office, Sales Team members must use standard office attendance (§7.1).
- **DEC-02 Single-Pair & Independent Per-Punch Submission (`CHECK_IN` / `CHECK_OUT`):**
  1. Every field attendance request must carry an explicit `request_type` (`CHECK_IN` or `CHECK_OUT`), and a field-work day follows the exact same **DEC-02 maximum of one `CHECK_IN` and one `CHECK_OUT` per employee per scheduled working day**.
  2. **Both** field `CHECK_IN` and field `CHECK_OUT` must each independently capture their own live camera selfie, pass liveness verification and 1:1 face matching, capture actual GPS coordinates + horizontal accuracy ($\le 30\text{m}$ required) + timestamp, and include a mandatory comment explaining the sales activity and field location.
  3. Server retains true outside-office coordinates and Haversine distance (`is_within_office_geofence = FALSE`; never discarded or falsified), exempts only the 50m office geofence gate, enforces duplicate prevention and check-in-before-check-out ordering, and creates each request strictly as `PENDING_REVIEW` (never auto-approved).
- **Mandatory Biometric Gate, 3-Attempt `Verification Pending` & Admin-Supervised Resolution:**
  - Field attendance strictly requires successful face matching and liveness verification. Preserves the maximum **3 automated face verification attempts** and **`Verification Pending`** rule: failing all 3 automated attempts routes evidence to `Verification Pending` (retaining failed probes in private storage and notifying Admin). **`Verification Pending` is NOT attendance approval and creates zero payable attendance credit.**
  - An Admin **cannot approve** any field attendance request that failed either face matching or liveness verification. Attendance cannot be credited for failed-biometric cases without successful identity verification through an authorized **Admin-supervised process** (e.g., Admin-supervised live re-verification / re-enrollment check).
- **Independent Admin Review, Reconciliation & Payroll Neutrality:**
  - Each field `CHECK_IN` and field `CHECK_OUT` request is reviewed independently by an authorized Admin (`APPROVE` or `REJECT`, recording Admin ID, timestamp, and mandatory rejection reason where rejected).
  - `PENDING_REVIEW` requests do NOT count as `Present`. Each `APPROVED` request reconciles **exactly one** corresponding immutable event into `attendance_events` (`is_field_attendance = TRUE`, `UNIQUE(attendance_day_id, event_type)` preserved, raw events never overwritten, no duplicate credit). `REJECTED` requests do NOT automatically mark `ABSENT` (existing resolution applies). There is **no separate field attendance calculation or payroll mechanism**: approved field events feed strictly into the standard `attendance_days` working-hour and payroll engine.

---

# 8. Working-Hour and Salary Calculation Engine (Amended v1.9 Baseline)

## 8.1 Monthly Salary Reference Model & Precision Architecture
The agreed monthly salary reference ($S_{\text{ref}}$, expressed in integer paise) is distributed across all calendar days of the specific payroll month ($D_{\text{month}} \in \{28, 29, 30, 31\}$):
$$\text{Daily Rate} = \frac{S_{\text{ref}}}{D_{\text{month}}}$$
$$\text{Hourly Rate} = \frac{\text{Daily Rate}}{8} = \frac{S_{\text{ref}}}{D_{\text{month}} \times 8}$$
$$\text{Minute Rate} = \frac{\text{Hourly Rate}}{60} = \frac{S_{\text{ref}}}{D_{\text{month}} \times 480}$$

*Precision & Rounding Policy:*
- **Data-Model Distinction (Amounts vs. Derived Rates):**
  1. *Monetary Amounts:* Monthly salary reference ($S_{\text{ref}}$), gross earned salary, allowances, deductions, approved adjustments, and net payable salary are whole-currency amounts modeled and stored as exact 64-bit integer paise (`BIGINT`), constrained by check bounds (`CHECK >= 0` where appropriate).
  2. *Derived Rates for Reporting & Display:* Daily rate ($\frac{S_{\text{ref}}}{D_{\text{month}}}$), hourly rate ($\frac{\text{Daily Rate}}{8}$), and minute rate ($\frac{\text{Hourly Rate}}{60}$) are derived values. Fractional paise frequently result (e.g. ₹20,000 / 30 yields 66,666.666667 paise/day, 8,333.333333 paise/hr, and 138.888889 paise/min). Storing derived rates as `NUMERIC(14,6)` provides fractional decimal precision for reporting, display, and payslips; however, `NUMERIC(14,6)` is fractional decimal representation, **not exact rational arithmetic**, and must **never** be used as the authoritative calculation source for accumulated earnings. Storing derived rates in integer `BIGINT` columns is strictly prohibited.
- **Correction of Rounding Invalidation:** A rounded six-decimal minute rate does **not** guarantee zero truncation loss or exact full-month reconciliation. Multiplying accumulated minutes by a rounded six-decimal minute rate (e.g. ₹20,000 / 14,400 = 138.888889 paise) yields 2,000,001.6 paise (a 2-paise drift). Evaluating daily rounded rates yields even larger discrepancies (up to 10 paise drift). Internal precision (`NUMERIC(14,6)` paise) is retained strictly for intermediate rate displays.
- **Authoritative Accumulated Earnings Calculation (Exact Rational Arithmetic):** To guarantee exact mathematical reconciliation without truncation drift, employee earnings must be evaluated across accumulated payable minutes using the exact numerator and denominator before applying final monetary rounding:
  $$\text{segment\_earnings\_paise}_k = \frac{\sum M_{\text{payable}, k} \times S_{\text{ref}, k, \text{paise}}}{D_{\text{month}} \times 480}$$
  Unrounded segment earnings are summed across DEC-15 effective-date segments, and the combined gross amount is rounded once to integer paise:
  $$\text{Gross Earned (Paise)} = \text{ROUND\_HALF\_UP}\left( \sum_{k} \frac{\sum M_{\text{payable}, k} \times S_{\text{ref}, k, \text{paise}}}{D_{\text{month}} \times 480} \right)$$
- **Uniform Integer-Paise Amount Precision:** All final payroll amounts—including gross earnings, allowances, adjustments, deductions, and net salary—are maintained strictly in 64-bit integer paise (`BIGINT`).
- **Net Salary Formulation:**
  $$\text{Net Salary (Paise)} = \text{Gross Earned (Paise)} + \sum \text{Allowances (Paise)} + \sum \text{Adjustments (Paise)} - \sum \text{Deductions (Paise)}$$
- **Open Decision on Whole-Rupee Net Rounding (DEC-05: Net Salary Rounding Rule):** Rounding net salary to the nearest whole Indian Rupee for cash payout or bank settlement display is **NOT** an approved mandatory calculation rule. Net salary retains exact integer-paise precision unless the Product Owner explicitly confirms a separate settlement or display rounding rule. In the master decision register, DEC-05 remains an open decision.

## 8.2 Scheduled Working Day Calculation (Paid Lunch & Absence Rules)
For any scheduled working day (Monday–Saturday):
$$\text{Approved Actual Working Minutes} = M_{\text{actual\_approved}}$$

1. **Confirmed Benchmark Attendance:**
   - **Full Day Benchmark:** Employee completes 7.0 hours of approved actual work (420 minutes) and takes lunch $\rightarrow$ receives 60-minute paid lunch credit:
     $$\text{Daily Payable Minutes} = 420 + 60 = 480\text{ minutes} = 8.0\text{ hours}$$
     $$\text{Daily Earned Value} = \text{Daily Rate}$$
   - **Confirmed Partial Day Benchmark:** Employee completes 5.0 hours of approved actual work (300 minutes) and takes lunch:
     $$\text{Daily Payable Minutes} = 300 + 60 = 360\text{ minutes} = 6.0\text{ hours}$$

2. **Absence & Paid Lunch Policy (UNASSIGNED-PO-ABSENCE-LUNCH — Proposed Design Default / Open Decision):**
   - No explicit Product Owner decision decree exists defining whether zero lunch credit is awarded on absence.
   - As an engineering design default, an employee who records 0 approved actual working minutes and has no approved paid leave is classified as `Absent` and credited with $0\text{ payable minutes}$ and $0\text{ lunch credit minutes}$ ($M_{\text{actual\_approved}} = 0, M_{\text{lunch\_credit}} = 0$).
   - This rule is cataloged as **`UNASSIGNED-PO-ABSENCE-LUNCH`** (Pending Formal Product Owner Confirmation).
   - *Separation of Policy Domains:* Full absence (`UNASSIGNED-PO-ABSENCE-LUNCH`), partial-day attendance qualification (`UNASSIGNED-PO-LUNCH-ELIGIBILITY`), leave pay treatment (`UNASSIGNED-PO-LEAVE-PAY`), and weekend/holiday spans (`UNASSIGNED-PO-HOLIDAY-LEAVE`) are distinct policy domains and must not be conflated.

3. **Open Policy Decision on Partial Attendance (UNASSIGNED-PO-LUNCH-ELIGIBILITY):**
   The detailed qualification criteria for the 60-minute paid lunch credit during partial-attendance scenarios remain an open Product Owner decision:
   - *Case 1 (Pre-Lunch Only):* Employee works only before lunch (e.g., 10:00 AM to 1:00 PM, 3.0 actual hours) and departs. Does employee qualify for paid lunch credit?
   - *Case 2 (Post-Lunch Only):* Employee arrives at 2:00 PM and works until 6:00 PM (4.0 actual hours). Does employee qualify for paid lunch credit?
   - *Case 3 (Span Across Lunch):* Employee works across the lunch window (e.g., 12:00 PM to 4:00 PM, 4.0 actual hours). Does employee qualify for paid lunch credit?
   - *Case 4 (Partial-Day Leave):* Employee is on approved half-day leave overlapping the lunch window.
   - *Case 5 (Minimum Actual Hours Threshold):* Whether a minimum threshold of actual work (e.g. $\ge 4.0\text{ hours}$) is required before the 60-minute paid lunch credit applies.

## 8.3 Sundays and Recognized Public Holidays Calculation
- **Sunday Credit:** Automatic credit of $480\text{ minutes}$ (8.0 paid hours) at the applicable rate without requiring office attendance.
- **Public Holiday Credit:** Automatic credit of $480\text{ minutes}$ (8.0 paid hours) at the applicable rate for recognized holidays on the organization's holiday calendar without requiring office attendance.
- **Sunday/Holiday Overlap:** Exactly $480\text{ minutes}$ credited. Never $960\text{ minutes}$.

## 8.4 DEC-15 Approved Option A: Mid-Period Salary Change Proration
When an employee's monthly salary reference changes mid-month:
1. The month is partitioned into continuous date segments $k$, each governed by the reference salary active on those dates ($S_{\text{ref}, k}$).
2. Each segment's unrounded earnings are evaluated with full internal precision using that segment's approved payable minutes and the month's calendar-day divisor ($D_{\text{month}} \times 480$):
   $$\text{segment\_earnings\_paise}_k = \frac{\sum M_{\text{payable}, k} \times S_{\text{ref}, k, \text{paise}}}{D_{\text{month}} \times 480}$$
3. The unrounded segment earnings are summed across all segments:
   $$\text{unrounded\_gross\_paise} = \sum_{k} \text{segment\_earnings\_paise}_k$$
4. Intermediate rounding of individual segments is **strictly prohibited** to prevent cumulative multi-segment rounding drift. The combined gross earnings are rounded once to the nearest integer paisa using Half-Up rounding:
   $$\text{Gross Earned (Paise)} = \text{ROUND\_HALF\_UP}\left( \sum_{k} \frac{\sum M_{\text{payable}, k} \times S_{\text{ref}, k, \text{paise}}}{D_{\text{month}} \times 480} \right)$$
5. The closing salary reference is never applied retrospectively to prior dates.

## 8.5 Full-Month Reconciliation Proof
For any calendar month length $D_{\text{month}} \in \{28, 29, 30, 31\}$, when an employee completes full attendance (all scheduled working days worked with full lunch credit + all Sundays and recognized public holidays credited):
$$\sum M_{\text{payable}} = D_{\text{month}} \times 480\text{ minutes}$$
Substituting into the accumulated earnings formula:
$$\text{Gross Earned (Paise)} = \text{ROUND\_HALF\_UP}\left( \frac{(D_{\text{month}} \times 480) \times S_{\text{ref, paise}}}{D_{\text{month}} \times 480} \right) = S_{\text{ref, paise}}$$
Since $S_{\text{ref, paise}}$ is an exact integer, $\frac{(D_{\text{month}} \times 480) \times S_{\text{ref, paise}}}{D_{\text{month}} \times 480} \equiv S_{\text{ref, paise}}$ exactly with zero remainder. No rounding or truncation drift occurs across 28, 29, 30, or 31-day months.

## 8.6 Technical Design Blocker: Actual Working-Time Measurement (BLOCKER-ACTUAL-WORK-MEASUREMENT)
- **Elapsed Attendance vs. Productive Work:** Under the approved single-pair attendance architecture (DEC-02 Approved), the system captures a maximum of one check-in and one check-out timestamp per day. These timestamps establish **elapsed wall-clock attendance presence**; they do **not** independently prove actual productive working minutes. Productive working time is not currently measurable under the baseline attendance engine.
- **Payroll Input Prerequisite:** The payroll engine requires **Approved Actual Working Minutes** ($M_{\text{actual\_approved}}$) as an auditable input. Elapsed attendance time cannot be automatically equated with productive work.
- **Inactivity Assumption Prohibition:** Computer inactivity, network disconnects, or absence of keystrokes cannot be assumed to be non-working time (employees engage in meetings, client interactions, document review, and field tasks).
- **Unresolved Technical Blocker & Illustrative Alternatives:** Before Phase 4 payroll calculation can be implemented, a defined, auditable measurement or approval mechanism must be formally evaluated and approved by the Product Owner. Illustrative alternatives (such as active task logging, desktop monitoring, or supervisor timesheet approval) represent possible approaches requiring separate evaluation, privacy review, and explicit approval. No surveillance or monitoring method is selected or recommended as an approved architecture, and no claim is made that productive working time is currently measurable.
- **Status:** **CRITICAL TECHNICAL DESIGN BLOCKER (`BLOCKER-ACTUAL-WORK-MEASUREMENT`)**. Implementation of automated actual-work deduction beyond the scheduled 1-hour lunch is blocked pending architectural design.

---

# 9. Leave Management and Policy Conflicts (Open Reconciliation)

- **Existing Baseline (v1.8):** CL, SL, PL, and LWP receive 0 payable hours and 0 salary.
- **Conflict with Calendar-Day Paid Model:** Under a full calendar-day salary distribution, Sundays and holidays are paid. If an employee takes 1 day of CL/SL/PL and receives 0 payable hours, their salary is reduced by exactly 1 day's pay ($\text{Daily Rate}$), identical to LWP.
- **Status:** **OPEN PRODUCT OWNER DECISION (`UNASSIGNED-PO-LEAVE-PAY`: Leave Pay Treatment and Salary Model Reconciliation)**. Formal resolution is required to reconcile internal company leave policy with the calendar-day paid salary distribution. This represents an unresolved organizational policy matter, not an established statutory entitlement. The unit of leave quota deduction remains an independent open decision cataloged under `TBD-06`.

---

# 10. Open Items & Decision Register Status (v1.9 Baseline)

| ID | Topic | Status in v1.9 | Details |
|---|---|---|---|
| **DEC-01** | **Lunch Policy** | **AMENDED & APPROVED** | **Paid Lunch Policy:** 1:00 PM – 2:00 PM lunch is PAID. Full day receives 8 payable hours (7h actual + 1h lunch). Lunch is not deducted. Supersedes historical deduction algorithm. |
| **DEC-02** | **Daily Punch Count Policy** | **OFFICIALLY APPROVED** | **Option A (Refined):** Maximum one Check-In and Check-Out pair per employee per working day ($\le 1$). Admin dual-workflow corrections; deterministic check-out order; strict idempotency replay. |
| **DEC-PAY** | **Master Payroll Calculation Model** | **AMENDED & APPROVED BY PO** | **Product Owner Amendment (HRMS-PO-PAYROLL-AMENDMENT-01):** Supersedes historical working-days scheduled hours model ($N_{\text{sched}} \times 7.0\text{h}$) with calendar-day monthly distribution ($D_{\text{month}} \times 8.0\text{h}$, i.e., $D_{\text{month}} \times 480\text{ mins}$), 60m paid lunch, automatic 8h paid credit for Sundays/holidays, flat 1.0x post-18:00 rate, actual payable minutes accumulation, and accumulated earnings rounding formula. |
| **DEC-09** | **Auth Broker Architecture** | **OFFICIALLY APPROVED** | **Supabase Auth with Express Authentication Broker:** Single password & JWT authority in GoTrue; Express internal identity brokerage; 1:1 `auth.users.id` $\leftrightarrow$ `public.users.id` mapping; zero custom password store or custom capability tickets. |
| **DEC-13** | **Login Tenant Resolution** | **OFFICIALLY APPROVED** | **Option A:** Organization Code + Mobile Number + Password. Multi-tenant credential scoping, server-side tenant pre-resolution, zero client UUID trust. |
| **PO-01 (`REC-01`)** | **Synthetic Email Identity Scheme** | **APPROVED / CLOSED (Scheme 3 — 2026-11-10)** | **Selected Scheme 3:** `<immutable_uuid>@auth.hrms.internal` generated at provisioning, persisted in `public.users.synthetic_email`, immutable on phone changes, and never exposed in employee UI, API responses, logs, errors, or payslips. |
| **PO-02** | **Indian Mobile Number Normalization** | **APPROVED / CLOSED (Indian-Only — 2026-11-10)** | Phase 1 supports Indian mobile numbers only (no international numbers). Canonical E.164 `+91XXXXXXXXXX` (`^\+91[6-9][0-9]{9}$`); accepts `9876543210`, `919876543210`, `+919876543210` (common spaces/hyphens stripped); rejects trunk `0`, international, landlines, short codes, and arbitrary prefixes; normalized server-side before lookup/provisioning/uniqueness checks (`uq_users_org_phone`); `PO-01` `synthetic_email` unchanged on mobile edits; generic auth errors. |
| **PO-03** | **Self-Service Password Recovery via Mobile OTP** | **APPROVED / CLOSED (2026-11-10)** | Phase 1 supports employee self-service password reset via SMS OTP sent strictly to the employee's registered, verified Indian mobile (`+91XXXXXXXXXX`). Flow requires `Organization Code + Mobile Number + OTP + New Password` (no email UX/exposure), preserves `DEC-09` & `PO-01` Scheme 3 (never uses Supabase native phone auth), mandates CSPRNG generation, short expiry, single use, keyed-HMAC digest storage (`password_reset_otps`), max attempts, cooldowns/rate limits, anti-enumeration responses, GoTrue password update, global session revocation, and non-secret audit logging (zero Admin password access). SMS provider/DLT (`DEC-10`), exact OTP numeric parameters, and lost-mobile Admin-assisted operational workflow remain open/unfinalized. |
| **`Initial Account Activation Policy`** *(Tracked under Task 2.2B.5 / 2.2B.5A–D Approval)* | **Initial Employee Account Activation** | **APPROVED / CLOSED (2026-11-10)** | Distinct onboarding policy: Initial employee account activation via Admin-generated 256-bit activation link / QR code containing a URL fragment (`/auth/activate#token=...`, `account_activation_tokens`) shared out-of-band + mobile SMS OTP verification. Two-factor activation, frontend clears address bar, plaintext tokens never logged in telemetry, user-level single-flight lock (`public.users.activation_lock_state` per `auth_user_id`) preventing cross-token overwrites without open DB locks across GoTrue (releasing ONLY on GoTrue `422 weak_password`; writing password + `app_metadata.hrms_activation_op_id` atomically; positive marker match auto-completes; missing marker quarantines the user `QUARANTINED_MANUAL_RECOVERY`, blocking Admin reissue until manual `SUPER_ADMIN`/SRE recovery because **fully automatic safe retry is not possible with GoTrue**; leaving already-completed `account_provisioning_requests` untouched), employee chooses own password, Admins never learn passwords, token invalidates on use/24h expiry/cancellation/quarantine/reissue (`POST /api/v1/admin/users/:userId/reissue-activation` when lock is `'NONE'`), zero email UX. Commercial SMS provider/DLT (`DEC-10`) remains open. Zero new decision IDs invented. |
| **PO-04** | **Authentication Rate Limiting & Error-Response Policy** | **APPROVED / CLOSED (2026-11-10)** | Enforces `5` failed login attempts per account within a rolling `15-minute` window via atomic shared counters across instances using keyed `HMAC` of normalized org + canonical E.164 phone; temporary throttling only (never permanent account lockout); separate IP-based rate limiting (`trust proxy` pinned); equivalent pre-DB throttling on unknown accounts; identical generic `HTTP 401 INVALID_CREDENTIALS` across unknown org/phone/inactive/unactivated/wrong password; generic `HTTP 429` (`Retry-After` only when reliable retry time exists); resets account counter on successful login without clearing IP limits; non-secret audit logging. IP numeric ceilings and temporary tuning values remain implementation config; preserves `PO-03` OTP rules unchanged. |
| **PO-05** | **Refresh Token Transport & Browser Security Policy** | **APPROVED / CLOSED (2026-11-10)** | Refresh tokens transported exclusively in `Secure`, `HttpOnly` cookies (`__Host-hrms_refresh_token`, `Path=/`, omitted `Domain`, topology-matched `SameSite`, dev-HTTP conditional handling), **never** returned in JSON bodies (`AuthTokens` updated in Task `2.2C`/`2.2D`) or exposed to JS/storage/URLs/logs; access tokens kept in JS memory only (`Authorization: Bearer`); signed CSRF + explicit `Origin` allowlisting (`403` on missing/malformed/untrusted) on `/refresh`, `/logout`, and cookie-authenticated endpoints; strict `CORS_ALLOWED_ORIGINS` (zero wildcard with credentials); refresh rotation + reuse detection (`DEC-11` hosting topology open). |
| **PO-06** | **GoTrue Configuration Alignment** | **APPROVED / CLOSED (2026-11-10)** | `enable_signup = false` (preserving Admin `createUser`), `jwt_expiry = 900` (15m), `minimum_password_length = 8`, `enable_confirmations = false` (solely for non-routable Scheme 3 synthetic emails while keeping mandatory HRMS onboarding activation), refresh-token rotation + reuse detection enabled, and Express broker-only employee authentication (`supabase/config.toml` update + `jwt-verification.test.ts` update queued for Task `2.2C`; hosted project settings unverified until deploy). |
| **PO-07** | **Concurrent Device Session Policy** | **APPROVED / CLOSED (2026-11-10; Tasks 2.2B.9A–C Hardened)** | Concurrent multi-device sessions allowed with no arbitrary fixed initial device limit; independent tenant-isolated sessions tracked via proposed `public.user_sessions` (keyed `HMAC-SHA256` refresh digests, zero plaintext tokens/JWTs, privacy-safe device/IP/activity visibility) isolated under `hrms_session_manager` (`NOBYPASSRLS`) with `hrms_context_verifier` transaction-bound signed `p_tx_proof` (`xid8` + single-use nonce) & OTP `sessions_revoked_at` guard preventing SQL GUC impersonation; supports active-session listing (`GET /api/v1/auth/sessions`), individual revocation (`DELETE /api/v1/auth/sessions/:sessionId`), employee revoke-all (`POST /api/v1/auth/sessions/revoke-all` / `/logout`), mandatory revoke-all on password change/reset & deactivation, same-tenant Admin revocation (`POST /api/v1/admin/users/:userId/sessions/revoke-all`, `ADMIN` blocked on `SUPER_ADMIN`), protected-request DB revocation (`revoked_sessions` + `tokens_valid_after_epoch` + `is_active` blocking already-issued `900s` JWTs), concurrent refresh serialization + affected-family reuse revocation (`PO-05`), and 7 mandatory `audit_logs` events; live GoTrue & adversarial SQL checks queued for Task `2.2H`. |
| **DEC-10** | **Commercial SMS Provider & Indian DLT** | **OPEN (Pending PO Approval)** | Commercial transactional SMS vendor selection and Indian DLT registration required before live production SMS OTP dispatch (`PO-03` & Activation) and external notifications (dev uses mock/console sink). |
| **DEC-14** | **Daily Selfie Retention** | **APPROVED (Legal Review)** | Strict 30-day maximum ceiling on raw attendance selfies (standard and Sales field attendance). 4-tier deletion. Retention-clock starting point (device capture time vs. trusted server receipt time) is an unresolved policy/architecture clarification. Subject to Indian legal counsel review before production. |
| **`PO-ATT-GEOFENCE-50M`** | **Office Geofence Radius (50m Proposed)** | **PROPOSED / OPEN (Pending Formal PO Approval)** | Proposes tightening standard office geofence radius from legacy `100m` baseline to **`50 metres`** (keeping $\le 30\text{m}$ GPS accuracy threshold). Applies uniformly to all employees—including Sales Team staff—when attending the office. |
| **`PO-ATT-FIELD-SALES`** | **Sales Team Field Attendance Exception** | **PROPOSED / OPEN (Pending Formal PO Sign-Off)** | Introduces exception-only **"Field Attendance Request"** strictly for active Sales Team employees working at distant customer/sales sites (`departments.allow_field_attendance = TRUE`). Hidden from standard employees; enforces explicit `CHECK_IN` / `CHECK_OUT` under DEC-02 (`<= 1` pair/day, independent per-request live selfie, passing face match + liveness, retained field GPS $\le 30\text{m}$ accuracy, and mandatory comment); preserves 3-attempt `Verification Pending` (0 credit; Admin cannot approve failed biometrics without Admin-supervised identity verification); enters `PENDING_REVIEW` for independent Admin `APPROVE`/`REJECT`; creates 1 immutable `attendance_events` row per approval using the single standard payroll/attendance engine. |
| **DEC-15** | **Mid-Period Salary Proration** | **OFFICIALLY APPROVED** | **Option A:** Effective-date proration based on calendar days in month and applicable rate on each calendar date. Unrounded segment earnings summed and rounded once at gross level. |
| **DEC-05** | **Net Salary Rounding Rule** | **OPEN (Category B)** | Whether final net payout is rounded to the nearest whole Rupee for cash settlement/display or retained in exact integer paise. Mandatory calculation rules retain integer paise (`BIGINT`). |
| **UNASSIGNED-PO-ABSENCE-LUNCH** | **Absence Paid Lunch Policy** | **PROPOSED DEFAULT / OPEN** | Whether absent employees (0 actual working minutes and no approved paid leave) receive zero paid lunch credit. Engineering design default is 0m credit; pending formal Product Owner confirmation. |
| **UNASSIGNED-PO-LUNCH-ELIGIBILITY** | **Partial Attendance Lunch Policy** | **OPEN PRODUCT OWNER DECISION** | Qualification criteria for 60m paid lunch during partial attendance (works only before lunch, works only after lunch, works across lunch, partial-day leave, minimum actual hours threshold). Preserves 5h actual + 1h lunch = 6h payable benchmark. |
| **DEC-16** | Salary Advance Deficit Carry-Forward | **OPEN** | Deficit handling when deductions exceed earnings: Zero-net floor vs. negative-net carry forward. |
| **UNASSIGNED-PO-SUN-WORK**| Sunday Work Compensation | **OPEN** | Whether actual work on Sunday generates compensation beyond the automatic 8-hour weekly off credit. |
| **UNASSIGNED-PO-HOL-WORK**| Holiday Work Compensation | **OPEN** | Whether actual work on a recognized public holiday generates compensation beyond the automatic 8-hour holiday credit. |
| **UNASSIGNED-PO-LEAVE-PAY**| Leave Pay Treatment & Model Reconciliation | **OPEN** | Reconciling internal company CL/SL/PL zero-pay baseline with calendar-day paid salary distribution. Unresolved organizational policy; not an established statutory entitlement. |
| **TBD-06** | Leave Quota Deduction Metric | **OPEN** | Unit of leave quota deduction (calendar days vs. scheduled working days vs. hours). Kept separate from leave pay treatment. |
| **UNASSIGNED-PO-HOLIDAY-LEAVE**| Sunday/Holiday Leave Span Overlap | **OPEN** | Treatment of Sundays and public holidays within an approved multi-day leave span (Preserve off status vs. sandwich rule). |
| **BLOCKER-ACTUAL-WORK-MEASUREMENT** | **Actual Work Measurement Blocker** | **CRITICAL TECHNICAL BLOCKER** | A single check-in/check-out pair captures elapsed attendance, not productive working intervals. Cannot equate presence with work or assume inactivity is non-work. Controlled measurement or approval mechanism required before Phase 4. |

---

# 11. Phased Delivery Roadmap

- **Phase 0 — Specification & Architecture:** Baseline updated (PRD v1.9, SRS v1.7, ERD, API specs, RTM).
- **Phase 1 — Foundation & Employee Administration:** Auth (DEC-09 & DEC-13 Approved), roles, employee profiles, departments, designations, office settings, project scaffolding.
- **Phase 2 — Attendance:** Single-pair attendance engine, geofencing (`100m` baseline / proposed `50m` tightening `PO-ATT-GEOFENCE-50M`), selfie capture, liveness & biometric adapter, failure queue, Sales Team field attendance exception (`PO-ATT-FIELD-SALES` proposed pending PO approval), Admin review & corrections.
- **Phase 3 — Leave:** Leave management, unseeded quotas, applications, approvals, holiday calendar.
- **Phase 4 — Payroll:** Working-hour engine with paid lunch, calendar-day hourly rates, automatic Sunday/holiday credits, DEC-15 proration, Admin prep, Super Admin approval, payslips.
- **Phase 5 — Reporting & Release:** Dashboards, exports, audit review, security testing, deployment.

---

*END OF PRODUCT REQUIREMENTS DOCUMENT v1.9*
