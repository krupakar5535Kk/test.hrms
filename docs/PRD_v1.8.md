# PRODUCT REQUIREMENTS DOCUMENT

## HRMS + SMART ATTENDANCE + PAYROLL

**Current Baseline:** Version 1.8  
**Date:** 2026-11-07  
**Status:** Approved Requirements Baseline (Updated with Approved DEC-01 Lunch Clipping, Approved DEC-02 Refinements, Approved DEC-13 Login Architecture & Approved DEC-09 Supabase Auth Broker Architecture)  
**Historical Baselines:** 
- Version 1.3 (Initial Product Discovery Baseline)
- Version 1.4 (Approved DEC-01: Exact Lunch Window Intersection Clipping)  
- Version 1.5 (Approved DEC-02: Single Daily Attendance Pair Initial Baseline)  
- Version 1.6 (Historical Approved Baseline: DEC-02 Refinements, Idempotency & Unpaired Check-Out Safeguards)  
- Version 1.7 (Historical Approved Baseline: DEC-13 Tri-Partite Tenant Login Architecture)  
**Initial Scale:** Approximately 10 employees • 1 Office • Multi-office and SaaS-ready architecture  

---

### Document Metadata & Revision History

| Document Field | Value |
|---|---|
| Product | Human Resource Management System with smart attendance and working-hour-based payroll |
| Version | 1.8 |
| Historical Baselines | Version 1.3 (Discovery Baseline), Version 1.4 (DEC-01 Approved), Version 1.5 (DEC-02 Approved), Version 1.6 (DEC-02 Refined Baseline), Version 1.7 (DEC-13 Approved Baseline) |
| Audience | Product Owner, Software Architect, Developers, QA |
| Purpose | Define agreed product behavior, constraints, workflows, calculations, and acceptance criteria |

#### Revision History
- **v1.0 - v1.2:** Initial drafts and discovery iterations.
- **v1.3:** Approved requirements baseline for Antigravity implementation planning.
- **v1.4:** Officially incorporated Product Owner approval of **DEC-01 (Option A: Exact Lunch Window Intersection Clipping)**. Resolved TBD-01. Standardized deduction formulas and calculation examples.
- **v1.5:** Officially incorporated Product Owner approval of **DEC-02 (Option A: One Attendance Pair Per Employee Per Working Day)**. Enforced single Check-In and single Check-Out pair per scheduled working day. Codified Admin-only attendance corrections, duplicate punch prevention, and idempotent retry safety.
- **v1.6:** Refined DEC-02 technical boundaries based on Product Owner review:
  1. Clarified **maximum one pair boundary** ($\le 1$ check-in, $\le 1$ check-out); established that absence, approved leave, and incomplete attendance are valid business states; the system never forces punches.
  2. Codified **Admin dual-workflow correction model**: Workflow A (missing punch creation in `attendance_events`) vs. Workflow B (incorrect punch correction via effective timestamp on `attendance_days` and JSONB audit history in `attendance_corrections`), preserving database constraint `UNIQUE(attendance_day_id, event_type)` and raw evidence immutability.
  3. Established **deterministic check-out validation precedence**: (1) `ATTENDANCE_ALREADY_COMPLETED`, (2) `CHECK_OUT_WITHOUT_CHECK_IN`, (3) process check-out.
  4. Formalized **strict idempotency replay and payload mismatch semantics** (same key + identical payload $\rightarrow$ return original stored response; different key + duplicate action $\rightarrow$ HTTP 409 Conflict; same key + different payload $\rightarrow$ HTTP 422 with `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`).
  5. Codified **unpaired check-out exception policy**: normal employee check-out without check-in is strictly rejected; unpaired check-out records can arise only through exceptional administrative manual correction, legacy data import, or data-integrity recovery; all unpaired records are flagged `requires_admin_review = true` and generate 0 payable minutes until resolved; no new employee-facing workflow is introduced.
- **v1.7:** Officially incorporated Product Owner approval of **DEC-13 (Option A: Organization Code + Phone Number + Password Login Architecture)**:
  1. **Tri-Partite Login Identifier:** Login requires three credentials: Organization Code (`organization_code`), Phone Number (`phone_number`), and Password (`password`).
  2. **Server-Side Tenant Pre-Resolution:** The `organization_code` identifies the tenant before authentication. The Express backend resolves the organization internally to an internal `organization_id` and verifies active organization status (`is_active = TRUE`).
  3. **Multi-Tenant Credential Scoping:** Backend authenticates the phone number and password strictly within that resolved organization (`UNIQUE(organization_id, phone_number)`).
  4. **Zero Client Trust:** Browser or mobile clients must never supply, manipulate, or select an `organization_id` (UUID). The backend strictly ignores and rejects client-provided tenant UUIDs.
  5. **Anti-Enumeration & Security Isolation:** Prevents cross-tenant account collisions, unauthorized cross-tenant login attempts, and phone number harvesting across organizations. Failed logins return uniform generic error messages (`INVALID_CREDENTIALS`).
- **v1.8 (Current):** Officially incorporated Product Owner approval of **DEC-09 (Supabase Auth with Express Authentication Broker)** on 2026-11-07:
  1. **Supabase Auth as Single Identity Source of Truth:** All user credentials, password hashing (bcrypt), and session JWT issuance are managed exclusively by Supabase Auth (GoTrue). The Express application and PostgreSQL database strictly do NOT implement a second password-storage or verification system.
  2. **Express Authentication Broker:** Express coordinates all login and credential operations. It accepts the approved DEC-13 tri-partite payload (`organizationCode`, `phoneNumber`, `password`), validates format, resolves tenant context, translates phone + org code into a deterministic synthetic email identity in Supabase Auth, and brokers authentication calls to the Supabase Auth GoTrue API.
  3. **Identity Mapping:** The Supabase Auth user ID (`auth.users.id`) maps 1:1 to the application user ID (`public.users.id`). Application profile, role, and employee mappings are maintained in PostgreSQL.
  4. **Direct Client Access Prohibited:** Untrusted clients (browser/mobile) never connect directly to Supabase Auth or PostgREST. All authentication requests terminate at the Express API gateway.
  5. **Specification of Unresolved Implementation Details:** Formally inventories the eight operational and engineering details (synthetic email format, phone normalization, password recovery without inbox, admin provisioning, JWT verification, token refresh, deactivation synchronization, and brute-force throttling) scheduled for implementation in Phase 1.

---

# 1. Executive Summary

Build a secure, responsive HRMS for employee administration, GPS- and selfie-based attendance, leave management, working-hour-based payroll, payslips, reporting, and auditability. The first deployment is for one organization with approximately 10 employees and one office. The architecture must support future growth and multiple offices without requiring an initial microservices architecture.

The defining business rule is that **salary is proportional to actual approved payable working hours**. Employees are not assigned an arbitrary fixed half-day salary and do not receive an additional late-arrival or early-departure penalty on top of the actual-hours calculation. Time worked beyond 6:00 PM is included when verified and approved by Admin; it is paid at the normal hourly rate, with no separate overtime multiplier or premium.

---

# 2. Product Goals and Non-Goals

## 2.1 Goals
- Replace manual HR, attendance, and payroll workflows with a centralized application.
- Capture attendance using GPS geofencing, mandatory selfies, face matching, and liveness checks.
- Enforce strict single-interval daily attendance per employee (maximum one check-in, maximum one check-out).
- Calculate salary transparently from approved payable hours; CL, SL, PL, and LWP days are unpaid and contribute zero payable hours.
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
- The product must not claim legal or statutory payroll compliance until applicable rules have been reviewed and configured. The requested policy of zero salary for CL, SL, and PL must also receive employment-law review before production use.

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
- Manages employee profiles, departments, designations, and employee lifecycle.
- Reviews attendance, GPS/face exceptions, and correction requests.
- **Exclusive authority to perform attendance corrections** (missing punches, accidental check-outs, timestamp corrections) with mandatory justification reason.
- Approves or rejects leave applications.
- Prepares and submits payroll for Super Admin approval.
- Generates reports and performs authorized HR operations.

## 3.3 Employee
- Logs in using organization code, phone number, and password (DEC-13 & DEC-09 Approved).
- Views and manages permitted parts of their own profile.
- Checks in and checks out using the required attendance verification flow (strictly once per day).
- Views their own attendance, hours, leave balance, salary estimates, approved payslips, and notifications.
- Applies for leave and views application outcomes.
- **Cannot directly edit attendance records, self-correct punches, or access another employee's data.**
- After checking out for the day, the attendance state is completed; no further check-in or check-out action is offered.
- Authorization must be enforced server-side. Hiding a screen or button in the frontend is not sufficient security.

---

# 4. Authentication and Account Lifecycle (DEC-09 & DEC-13 Approved)

## 4.1 Approved Authentication Architecture: Supabase Auth with Express Broker
In accordance with Product Owner decisions **DEC-13** (Tri-Partite Tenant Scoping) and **DEC-09** (Express Authentication Broker), authentication is delivered through an integrated gateway model:

1. **Client Submission:** The client application submits three credentials to Express (`POST /api/v1/auth/login`):
   - `organizationCode` (e.g., `ACME`)
   - `phoneNumber` (e.g., `9876543210`)
   - `password` (e.g., `TemporaryPassword123`)
2. **Server-Side Tenant Pre-Resolution:** Express normalizes `organizationCode` to uppercase and executes the hardened `resolve_organization_by_code()` function in PostgreSQL. It verifies that the organization exists and is active (`is_active = TRUE`). If not, it fails immediately with uniform `401 INVALID_CREDENTIALS`.
3. **Synthetic Identity Translation:** Because Supabase Auth natively enforces email or phone+OTP, and multiple tenant organizations can have employees with identical phone numbers, Express deterministically translates the credentials into an internal synthetic email identity:
   $$\text{Synthetic Email} = \text{normalized\_phone} \mathbin{\Vert} \text{"."} \mathbin{\Vert} \text{lower(organization\_code)} \mathbin{\Vert} \text{"@auth.hrms.internal"}$$
   *(Example: `9876543210.acme@auth.hrms.internal`)*
4. **Supabase Auth Credential Verification:** Express dispatches `supabase.auth.signInWithPassword({ email: syntheticEmail, password })` to Supabase GoTrue over secure internal TLS.
5. **No Second Password Store:** Passwords and password hashes are **strictly NOT stored in the Express application or `public.users` database**. Supabase Auth is the single, authoritative credential storage system.
6. **Identity Mapping & Session Minting:** Upon successful verification from Supabase Auth:
   - Supabase returns an `access_token` (JWT) and `refresh_token`.
   - The token's subject (`sub = auth.users.id`) maps 1:1 to `public.users.id`.
   - Express checks out a PostgreSQL connection, opens an explicit transaction, sets `SET LOCAL app.current_org_id = :org_id; SET LOCAL app.current_user_id = :user_id;`, queries `public.users` and `public.employees`, and returns the authenticated session payload with organization and employee metadata.
7. **Uniform Anti-Enumeration Failure:** Any failure at any step (unknown org code, inactive org, unknown phone, incorrect password, locked account) returns the exact same HTTP 401 response:
   ```json
   {
     "success": false,
     "error": {
       "code": "INVALID_CREDENTIALS",
       "message": "Invalid organization code, phone number, or password."
     }
   }
   ```

## 4.2 Explicit Unresolved Implementation Details (To Be Finalized in Phase 1)
The following eight implementation details are formally cataloged and will be resolved during Task 1.2 / Task 1.3 implementation:
1. **Synthetic Identity Format:** Finalizing exact string formatting rules and case handling (e.g., stripping non-digit characters from phone, lowercase organization code, domain suffix `.auth.hrms.internal`).
2. **Phone Number Normalization:** Standardizing format (e.g., 10-digit Indian standard without leading `0` or `+91` prefix for internal mapping, while preserving display format).
3. **Password Recovery Workflow:** Because users do not possess inboxes for `@auth.hrms.internal`, self-service email recovery links cannot be delivered directly. Designing the recovery workflow (Admin-assisted password reset via temporary password generation with forced first-login change, or secondary personal email verification).
4. **Account Provisioning Flow:** Defining the atomic transactional sequence when an Admin creates a new employee profile: (1) create user in Supabase Auth via Admin API (`supabase.auth.admin.createUser`) with confirmed email; (2) insert corresponding row into `public.users` (`id = auth.users.id`, `synthetic_email`); (3) insert employee into `public.employees`.
5. **JWT Validation Middleware:** Implementing Express middleware that cryptographically validates the Supabase Auth JWT signature (using `SUPABASE_JWT_SECRET` or Supabase JWKS public keys), extracts `sub`, and initializes transaction-local PostgreSQL tenant context.
6. **Token Refresh Mechanism:** Contract and route handler for `POST /api/v1/auth/refresh` invoking `supabase.auth.refreshSession()`.
7. **Account Deactivation Synchronization:** Ensuring that deactivating an employee sets `public.users.is_active = FALSE` AND revokes Supabase Auth active sessions / disables the Supabase Auth account.
8. **Brute-Force & Rate Limiting Integration:** Coordinating Express-level IP/account rate limits (5 failed attempts per 15 minutes) with Supabase Auth GoTrue rate-limiting safeguards.

---

# 5. Employee Management

## 5.1 Employee Profile Data
- **Personal:** Full name, date of birth, gender, profile photograph.
- **Contact:** Phone number, email, residential address.
- **Employment:** Employee ID, department, designation, joining date, employment status.
- **Bank:** Account holder name, account number, IFSC.
- **Emergency:** Emergency contact name, relationship, and contact details.
- **Documents:** Identity proof, appointment letter, and other authorized employment documents.

Collect only data needed for the organization’s purpose. Restrict access to bank details, identity documents, and other sensitive employee information.

## 5.2 Employee IDs
- Automatically generate IDs per organization starting at `EMP001`, `EMP002`, `EMP003`, ..., `EMP1000+` (using `FM000` formatting with zero truncation).
- IDs must be unique per organization (`UNIQUE (organization_id, employee_code)`), immutable, and never reused upon employee termination.
- Generated automatically via database `BEFORE INSERT` trigger during employee creation.
- Use the employee ID as a stable reference across attendance, leave, payroll, and payslips.

## 5.3 Departments and Designations
- Authorized Admin users can create, edit, assign, and deactivate departments and designations.
- Preserve historical assignments so old reports and payslips do not change when an employee transfers.

## 5.4 Employee Exit
- Admin records resignation or termination reason, effective date, and last working day.
- Review pending attendance corrections, leave, and payroll items.
- Complete final salary/final settlement workflow.
- Deactivate access on the effective date (`is_active = FALSE`) while preserving historical records.
- Apply the approved retention and deletion policy to former-employee data.

---

# 6. Office and Work Schedule

| Parameter | Confirmed Requirement (v1.8 Baseline) |
|---|---|
| Initial offices | One |
| Future architecture | Multiple offices supported |
| Working days | Monday through Saturday |
| Weekly holiday | Sunday |
| Official start | 10:00 AM |
| Official end | 6:00 PM; additional verified hours beyond this time count when approved by Admin. |
| Lunch interval | 1:00 PM – 2:00 PM (Exact window intersection clipping per approved DEC-01). |
| Standard net day | 7 hours (8.0 elapsed minus 1.0 hour lunch deduction for full 10:00 AM–6:00 PM day). |
| Daily session policy | **Maximum one Check-In and maximum one Check-Out pair per employee per working day (DEC-02 Approved).** A completed record requires one valid check-in and one valid check-out; absence, leave, and incomplete attendance remain valid business states. The system never forces a punch event. |
| Late grace | 10 minutes; arrival after 10:10 AM is labeled Late. |
| Early-departure grace | 10 minutes; departure before 5:50 PM is labeled Early Departure. |
| Overtime | No separate overtime premium/multiplier. Verified hours beyond 6:00 PM count when approved by Admin, at normal hourly rate ($1.0\times$). |

---

# 7. Smart Attendance & Daily Session Lifecycle

## 7.1 Confirmed Daily Attendance Rule (DEC-02 Approved — Maximum One Pair)
- **Maximum Attendance Events:**
  - **Maximum one CHECK_IN event** per employee per scheduled working day ($\le 1$).
  - **Maximum one CHECK_OUT event** per employee per scheduled working day ($\le 1$).
  - **Maximum one attendance working interval** per scheduled working day.
- **Valid Attendance States:**
  - A *completed* attendance record requires exactly one valid CHECK_IN and one valid CHECK_OUT.
  - *Absence*, *approved leave* (CL/SL/PL/LWP), and *incomplete attendance* (unpaired punch) are valid business states.
  - The system must **never force a punch event** merely to satisfy attendance constraints.
- **Strict Boundary:** No employee-initiated second check-in or second check-out is permitted on the same working day. Multiple attendance sessions or split shifts are strictly unsupported in Phase 1 and Phase 2.

## 7.2 Attendance Validation, Execution Order, Idempotency & Unpaired Punch Handling

### 7.2.1 Deterministic Check-Out Validation Order
When an employee initiates a check-out request, the backend evaluates conditions in this strict sequence:
1. **If CHECK_OUT already exists:** Immediately reject with HTTP 409 Conflict (`ATTENDANCE_ALREADY_COMPLETED`).
2. **Otherwise, if CHECK_IN does not exist:** Immediately reject with HTTP 409 Conflict (`CHECK_OUT_WITHOUT_CHECK_IN`).
3. **Otherwise:** Process the check-out event.

### 7.2.2 Check-In Validation
If a CHECK_IN already exists for the day, immediately reject with HTTP 409 Conflict (`ATTENDANCE_ALREADY_CHECKED_IN`).

### 7.2.3 No Employee Self-Correction
An employee cannot independently edit, overwrite, replace, or delete any recorded attendance event.

### 7.2.4 Unpaired Punch Handling (Incomplete Check-In vs. Exceptional Unpaired Check-Out)
- **Normal Employee API Check-Out:** An employee attempting to submit a check-out via the client API without an existing, valid check-in for the scheduled day is strictly rejected with HTTP 409 Conflict (`CHECK_OUT_WITHOUT_CHECK_IN`).
- **Origins of Unpaired Check-Out Records:** Exceptional administrative manual correction, legacy data import, or data-integrity recovery.
- **Enforcement & Payable Working Minutes:** Any attendance record containing an unpaired check-out (or unpaired check-in) must be immediately flagged with `requires_admin_review = true`. Under no circumstances shall an unpaired punch generate payable working minutes; payable minutes remain strictly zero ($0$) until an authorized Admin explicitly reviews, matches, or corrects the record.

### 7.2.5 Idempotency & Concurrency Semantics
- *Same `Idempotency-Key` + identical payload:* Return original stored response (HTTP 200/201).
- *Different `Idempotency-Key` + duplicate action:* Return HTTP 409 Conflict (`ATTENDANCE_ALREADY_CHECKED_IN` or `ATTENDANCE_ALREADY_COMPLETED`).
- *Same `Idempotency-Key` + different payload:* Reject with HTTP 422 Unprocessable Entity (`IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`).
- *Database Uniqueness Guarantee:* `UNIQUE(attendance_day_id, event_type)` serves as atomic barrier against race conditions.

## 7.3 Admin Attendance Correction Policy (Two Distinct Workflows)
- **Workflow A: Missing Punch (No prior punch of that type existed):** Admin manually creates missing attendance event in `attendance_events` with `is_manual_entry = true`, reason, and Admin identity.
- **Workflow B: Incorrect Existing Punch (A raw event already exists):** Original raw event, GPS coordinates, and selfies in `attendance_events` remain unaltered. The corrected effective timestamp is recorded in `attendance_corrections` and updated on `attendance_days` for payable hour calculation.

## 7.4 GPS & Biometric Verification
- Geofence radius: 100 meters from assigned office coordinates.
- Minimum acceptable GPS accuracy: $\le 30$ meters.
- Mandatory live camera selfie and liveness detection on both Check-In and Check-Out.
- Up to 3 automatic facial verification attempts per punch before routing to `Verification Pending` for Admin review.
- Server time is authoritative for all online submissions.

## 7.5 Offline Attendance Submissions
- Marked `is_offline_sync: true` with client timestamps; treated as untrusted until verified and approved by Admin.

---

# 8. Working-Hour Calculation and Attendance Status

## 8.1 Core Working-Hour Rule
Pay is based on actual approved payable working hours from the **single valid daily attendance interval**. There is no fixed half-day salary and no separate monetary penalty for late arrival or early departure. Late and early labels are descriptive classifications only.

## 8.2 Working-Hour Formula (DEC-01 & DEC-02 Baseline)

$$\text{Valid Elapsed Working Minutes} = T_{\text{out}} - T_{\text{in}}$$

$$\text{Deducted Lunch Minutes} = \max\left(0, \min(T_{\text{out}}, \text{14:00}) - \max(T_{\text{in}}, \text{13:00})\right)$$

$$\text{Payable Working Minutes} = \text{Valid Elapsed Working Minutes} - \text{Deducted Lunch Minutes} - \text{Unapproved Post-18:00 Minutes}$$

$$\text{Approved Payable Hours} = \frac{\text{Payable Working Minutes}}{60.0}$$

---

# 9. Leave Management

- **CL, SL, PL, and LWP:** 0 payable hours, 0 salary. Recorded as `Absent/unpaid` for attendance and payroll purposes.
- Quotas, accruals, and carry-forward limits remain unseeded and fully configurable by Admin (TBD-06).

---

# 10. Sundays and Public Holidays

- Sunday receives 0 payable hours under current policy.
- Admin-declared public holidays receive 0 payable hours under current policy.
- Excluded from monthly standard scheduled hours.
- Configurable policy flags (`is_paid: false`) maintained pending qualified legal counsel review.

---

# 11. Payroll Engine

- Monthly salary reference stored as integer paise (`BIGINT`).
- Standard monthly hours ($H_{\text{std}}$) = $N_{\text{sched}} \times 7.0$ hours ($M_{\text{std}} = H_{\text{std}} \times 60$ minutes).
- Hourly and minute rates stored to 6 decimal places (`NUMERIC(14,6)` paise).
- Earned salary computed from total approved payable minutes across single daily sessions.
- Dual-key governance: Admin compiles draft batch $\rightarrow$ Super Admin approves $\rightarrow$ Payslips generated.
- Approved payroll runs are immutable; adjustments require documented reversal workflows.

---

# 12. UI/UX Architecture Baseline (DEC-02, DEC-09 & DEC-13 Aligned)

## 12.1 Authentication & Login Experience
- **Login Screen:** Provides three input fields:
  1. `Organization Code` (e.g. `ACME`) with automatic uppercase transformation and client-side format validation.
  2. `Phone Number` (10 digits or E.164 format).
  3. `Password` with show/hide toggle.
- **Client Submission:** Dispatches `POST /api/v1/auth/login` containing `{ "organizationCode": "ACME", "phoneNumber": "9876543210", "password": "..." }`.
- **Error Presentation:** Displays unified error message (`"Invalid organization code, phone number, or password"`) for any authentication failure to prevent tenant or user enumeration.

## 12.2 Employee Dashboard State Progression
1. **State 1 (Pre-Punch):** Not checked in today. Primary action button: `[Check In]`.
2. **State 2 (Active Session):** Checked in. Display: Check-In timestamp, elapsed time. Primary action button: `[Check Out]`.
3. **State 3 (Completed Day):** Checked out. Display: `Attendance Completed for Today` card with summary of elapsed time, lunch deduction, and net payable hours. No check-in or check-out buttons rendered.
4. **No Self-Service Correction:** Manual editing is strictly disabled.

---

# 13. Open Items & Decision Register Status (v1.8 Baseline)

| ID | Topic | Status in v1.8 | Details |
|---|---|---|---|
| **DEC-01** | **Lunch Deduction Algorithm** | **OFFICIALLY APPROVED** | **Option A:** Exact Window Intersection Clipping. |
| **DEC-02** | **Daily Punch Count Policy** | **OFFICIALLY APPROVED** | **Option A (Refined):** Maximum one Check-In and Check-Out pair per employee per working day ($\le 1$). Admin dual-workflow corrections; deterministic check-out order; strict idempotency replay. |
| **DEC-03** | Face Verification Provider | Open (TBD) | Hexagonal adapter; provider selection pending before Phase 2. |
| **DEC-04** | Biometric Data Retention | Open (Legal Hold) | 4-tier data separation; retention schedule pending legal review. |
| **DEC-05** | Net Salary Rounding Rule | Open (TBD) | Half-Up Rounding to nearest whole Rupee proposed. |
| **DEC-06** | Absence Alert Threshold | Open (TBD) | Default 3 consecutive unauthorized absences proposed. |
| **DEC-07** | Admin MFA Mechanism | Open (TBD) | TOTP Authenticator app (RFC 6238) proposed. |
| **DEC-08** | Leave Quota Policy Values | Open (TBD) | Quotas unseeded; configurable in Admin settings. |
| **DEC-09** | **Auth Broker Architecture** | **OFFICIALLY APPROVED** | **Supabase Auth with Express Authentication Broker:** Express translates org code + phone number to synthetic email identity in Supabase Auth; Supabase Auth is single source of truth for passwords and JWT issuance; no second password store; 1:1 user mapping; 8 unresolved implementation details cataloged for Phase 1. |
| **DEC-10** | Notification Provider | Open (TBD) | In-app notifications and console logger for Phase 1–2. |
| **DEC-11** | Backend Hosting Provider | Open (TBD) | Render / AWS ECS / Railway connecting to Supabase Postgres. |
| **DEC-12** | Disaster Recovery Targets | Open (TBD) | RPO $\le 1\text{ hr}$, RTO $\le 4\text{ hrs}$ via Supabase PITR. |
| **DEC-13** | **Login Tenant Resolution** | **OFFICIALLY APPROVED** | **Option A:** Organization Code + Phone Number + Password. Multi-tenant credential scoping, server-side tenant pre-resolution, zero client UUID trust. |
| **DEC-14** | Daily Selfie Retention (30 Days) | Proposed (Category B) | Strict 30-day ceiling (`captured_at` calc; 4-tier deletion; legal hold suspension; decoupled statutory records). Pending Indian legal review. |
| **LEG-01** | Statutory Leave & Rest Pay | Open (Legal Hold) | Configurable policy flags (`is_paid: false`) pending legal review. |
| **LEG-02** | Biometric DPDP Notice | Open (Legal Hold) | Explicit notice and consent logging before biometric capture. |
| **LEG-03** | Demographic Minimization | Open (Legal Hold) | Secondary profile fields optional pending legal review. |
| **LEG-04** | Biometric Retention Schedule | Open (Legal Hold) | Retention schedules differentiated by statutory class; pending legal verification. |

---

# 14. Phased Delivery Roadmap

- **Phase 0 — Specification & Architecture:** Baseline updated (PRD v1.8, SRS, ERD, API specs).
- **Phase 1 — Foundation & Employee Administration:** Auth (DEC-09 & DEC-13 Approved), roles, employee profiles, departments, designations, office settings, project scaffolding.
- **Phase 2 — Attendance:** Single-pair attendance engine, geofencing, selfie capture, biometric adapter, failure queue, Admin corrections.
- **Phase 3 — Leave:** Leave management, unseeded quotas, applications, approvals, holiday calendar.
- **Phase 4 — Payroll:** Working-hour engine with DEC-01 lunch clipping & DEC-02 single session aggregation, Admin prep, Super Admin approval, payslips.
- **Phase 5 — Reporting & Release:** Dashboards, exports, audit review, security testing, deployment.

---

*END OF PRODUCT REQUIREMENTS DOCUMENT v1.8*
