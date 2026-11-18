# Security Architecture & Data Privacy Framework

**System Designation:** HRMS Security & Compliance Framework  
**Threat Model:** STRIDE-based Defense-in-Depth  
**Regulatory Standards:** India Digital Personal Data Protection (DPDP) Act 2023, ISO 27001 Controls, OWASP Top 10  
**Document Version:** 1.6  
**PRD Reference:** PRD v1.6 Baseline (Section 4, 7, 17, 18, 19, 20, 21; Incorporating Approved DEC-01, Refined DEC-02 & Mandatory Safeguards: Multi-Tenant Testing, Append-Only Audit, Data Privacy, and BCDR)  

---

## 1. Security Architecture Overview

The HRMS platform manages high-sensitivity operational data: biometric facial enrollment references, real-time employee geolocations, banking information, and confidential payroll calculations. The architecture enforces zero-trust principles across all layers:

```
+-------------------------------------------------------------------------------------------------+
|                                 ZERO-TRUST DEFENSE-IN-DEPTH                                     |
+-------------------------------------------------------------------------------------------------+
| LAYER 1: NETWORK & PERIMETER                                                                    |
| • TLS 1.3 encryption in transit • DDoS protection via Cloudflare/Vercel • CORS restricted       |
+-------------------------------------------------------------------------------------------------+
| LAYER 2: AUTHENTICATION & IDENTITY                                                              |
| • Express Auth Broker with Supabase Auth GoTrue (exclusive password hashing & JWT authority)    |
| • Single-use secure activation (employee sets private password) & dual-key anti-DoS rate limits |
| • Session revocation (`session_id` + refresh invalidation) & per-request active-status checks     |
+-------------------------------------------------------------------------------------------------+
| LAYER 3: APPLICATION AUTHORIZATION                                                              |
| • Server-side permission guards • RBAC middleware (`requirePermission`) • Input sanitization    |
+-------------------------------------------------------------------------------------------------+
| LAYER 4: DATABASE & DATA STORAGE                                                                |
| • PostgreSQL Row Level Security (RLS) • AES-256 encryption at rest • Encrypted bank account no. |
| • Private Supabase Storage buckets with native 15-minute pre-signed URLs                        |
+-------------------------------------------------------------------------------------------------+
| LAYER 5: GOVERNANCE & AUDITABILITY                                                              |
| • Immutable append-only audit trail • Dual-authorization for payroll • Versioned policy rules   |
+-------------------------------------------------------------------------------------------------+
```

---

## 2. Data Privacy, Biometric Protection & Regulatory Framework

Biometric data (facial images, templates, and embeddings) and location coordinates constitute sensitive personal data. The system enforces strict architectural isolation into **four distinct data tiers**, ephemeral processing boundaries, role-restricted access, and short-lived credentialing:

### 2.1 Biometric Data Separation Model & Storage
1. **Tier 1: Enrollment Reference Images**
   - Supervised, high-quality reference photo captured during Admin onboarding.
   - Stored in a private Supabase Storage bucket (`biometric-references`). Direct public access is disabled.
   - *Retention & Deletion Policy:* Retained strictly during active employment. Upon employee exit/termination, enrollment photos and derived embeddings are purged in accordance with the organization's exit runbook and legal hold rules (**DEC-04 / LEG-02 / LEG-04**).
2. **Tier 2: Daily Attendance Selfies (Verification Probes — DEC-14 Proposed Policy)**
   - Operational probe images captured at standard Check-In / Check-Out AND during **Sales Team Field Attendance Requests (`PO-ATT-FIELD-SALES` proposed)**.
   - Stored strictly in private Supabase Storage bucket `attendance-evidence`. Public image URLs or unauthenticated bucket paths are **strictly prohibited**.
   - *Strict 30-Day Maximum Ceiling:* Daily attendance selfies (both standard attendance and field attendance request selfies) are retained for a maximum of **30 calendar days**. Individual organizations may configure a shorter duration (e.g., 7, 14, 21 days) via `organizations.selfie_retention_days`, while `CHECK (selfie_retention_days BETWEEN 1 AND 30)` prohibits exceeding 30 calendar days.
   - *Retention-Clock Reference Clarification:* Per PRD v1.9 / SRS v1.7, the exact starting point for the 30-day countdown (`captured_at` vs trusted `server_timestamp`/`created_at`) remains an unresolved policy and architectural clarification under DEC-14.
   - *Comprehensive Multi-Tier Deletion Coverage:* Upon expiration ($\le 30$ days), an automated background worker purges evidence across four layers:
     1. **Primary Object Storage:** The original selfie image file is permanently deleted from private Supabase Storage bucket `attendance-evidence`.
     2. **Transient Processing Copies & Buffers:** In-memory buffers and local `/tmp` files on application servers are immediately released/cleared upon initial upload (0-second persistence post-upload).
     3. **Applicable Backup Expiry Horizon:** Database WAL archives, base snapshots, and storage backups expire per configured backup lifecycles (e.g., 7-day to 30-day recovery horizons). Restored backups must not resurrect previously purged images.
     4. **Third-Party Biometric Provider Compliance:** External biometric APIs (DEC-03) must adhere to contractual zero-retention SLAs (RAM-only probe processing without caching or model training), or an explicit deletion API call is dispatched using `ae.provider_transaction_id`.
   - *Legal Hold Suspension:* If an attendance dispute, formal investigation, disciplinary inquiry, or legal hold exists (`is_legal_hold = TRUE`), automated deletion across all tiers is strictly suspended for the affected evidence until the hold is formally released by an authorized Admin.
   - *Post-Release Processing:* Once a legal hold is formally released, standard retention evaluation applies, and expired records proceed to deletion.
   - *Decoupled Preservation:* Deleting a selfie does not delete or alter the attendance record. Punch timestamps, net payable minutes, verification confidence scores, and payroll items remain preserved in accordance with separate statutory retention policies. The database sets `attendance_evidence.selfie_storage_path = NULL`, `retention_status = 'PURGED'`, and timestamps `purged_at`.
   - *SHA-256 Linkability & Evidentiary Status:* `audit_image_hash` is a deterministic SHA-256 digest kept for cryptographic non-repudiation and integrity verification. Under data protection law (DPDP Act 2023 / GDPR), cryptographic hashes derived from biometric images remain pseudonymous, potentially linkable personal data, and must NOT be treated as anonymous information or as a legal/visual substitute for original photographic evidence.
   - *Audit Trail:* Deletion activity is recorded in `audit_logs` (capturing evidence ID, deletion timestamp, acting mechanism `SYSTEM`, action `RETENTION_PURGE`, and outcome). Under no circumstances are actual selfie image bytes retained in audit records.
   - *External Provider Contractual Alignment:* Any commercial biometric vendor engaged under DEC-03 must contractually support compatible retention and deletion terms.
   - *Statutory Qualification:* This policy is explicitly marked as subject to formal Indian legal review under the DPDP Act 2023, IT SPDI Rules 2011, and Telangana Shops and Establishments Act 1988 (LEG-04).
3. **Tier 3: Verification Telemetry & AI Confidence Scores**
   - Numerical match confidence scores, liveness detection results, provider transaction IDs.
   - Stored in PostgreSQL relational table `attendance_evidence`.
   - *Retention Policy:* Retained alongside attendance logs for compliance auditing.
4. **Tier 4: Attendance Metadata & Location Telemetry**
   - Authoritative server timestamps, client timestamps, GPS coordinates, accuracy radius, office ID, punch action.
   - Stored in PostgreSQL relational table `attendance_events`.
   - *Retention Policy:* Retained as core statutory employment records in accordance with applicable labor regulations.

### 2.2 Separation of Biometric Data Deletion from Statutory & Business-Record Retention
A foundational compliance rule of the system is the **strict architectural decoupling of biometric data erasure from statutory business record retention**. The system does not assume a single universal retention duration (e.g. 3–5 years) across all data types; rather, each distinct record category is governed by its own legal basis and lifecycle:

#### Differentiated Statutory Retention Schedules

| Retention Category | Record Types | Governing Indian Enactment | Proposed Retention Schedule | Legal Verification Status |
|---|---|---|---|---|
| **1. Biometric Selfies (Tier 2)** | Daily attendance punch photos | DPDP Act 2023 §6, §8(7) (Purpose & Storage Limitation) | **Max 30 calendar days** (Configurable 1–30 days; auto-purge) | **Proposed DEC-14 (Subject to Legal Sign-off)** |
| **2. Biometric Enrollments & Vectors (Tier 1)** | Onboarding face reference photo, facial embeddings | DPDP Act 2023 §8(7); IT SPDI Rules 2011 | **Active employment only**; purged upon exit (unless under legal hold) | **Pending Legal Counsel Verification** |
| **3. Employment & Attendance Registers** | Daily punch timestamps, check-in/out, payable minutes, Form XXII | Telangana Shops & Establishments Act, 1988 §62 (Rules Form XXII) | **3 years** from the date of the last entry | **Pending Legal Counsel Verification** |
| **4. Wage & Payroll Registers** | Monthly gross/net salary, deduction ledgers, Form X/XII wage registers | Payment of Wages Act, 1936 §13A; Minimum Wages Act, 1948 | **3 years statutory minimum** (Standard corporate practice: 5–8 years) | **Pending Legal Counsel Verification** |
| **5. Taxation & Social Security Records** | TDS deductions (Form 16/16A), PF/ESI schedules | Income Tax Act, 1961 §44AA / §149; EPF Scheme, 1952; ESI Act, 1948 | **6–7 assessment years** (Tax); **5 years** (EPF/ESI) | **Pending Legal Counsel Verification** |
| **6. Audit Logs & System Mutations** | `audit_logs`, `attendance_corrections`, legal hold histories | Information Technology Act, 2000 §7A; Bharatiya Sakshya Adhiniyam, 2023 | **3 years minimum** (Retained for forensic defense and auditability) | **Pending Legal Counsel Verification** |

#### Evidentiary Principles & Data Protection
1. **No Accidental Record Loss:** Under no circumstances shall an employee exit, right-to-erasure request, or biometric purge delete or alter historical records in `attendance_days`, `attendance_events`, `employee_salaries`, `payroll_runs`, or `payslips`.
2. **Biometric Privacy Erasure (Data Minimization):** In contrast to statutory payroll and wage ledgers, raw biometric reference images, facial embeddings, and probe selfies have no statutory retention requirement beyond active identity verification. When an employee exits or the 30-day selfie ceiling expires, the system purges physical files from Supabase Storage buckets (`biometric-references`, `attendance-evidence`), nullifies storage paths, and purges RAM/temp copies.
3. **SHA-256 Linkability Caveat:** To maintain non-repudiation without storing raw biometrics, the system retains an immutable cryptographic fingerprint (`audit_image_hash` = SHA-256 of the deleted image) and the original verification telemetry in `attendance_evidence`. Because cryptographic hashes are deterministic, under the DPDP Act 2023 and GDPR they remain **pseudonymous, potentially linkable personal data** (linkable via hash comparison to the subject). They must **never be treated as anonymous information** nor as a legal/visual substitute for original photographic evidence in court or labor conciliation proceedings.

### 2.3 Configurable Retention, Legal Holds & Employee Exit Handling
1. **Configurable Retention Workflows:**
   - Retention durations for Tier 1 and Tier 2 storage are configurable via `biometric_retention_policies` (e.g., default: immediate purge for verified selfies, 30 days post-exit for enrollment photos, 90 days for audit failure images).
2. **Legal Hold Framework (`is_legal_hold`):**
   - An authorized Admin or Super Admin may flag an employee or attendance evidence row with `is_legal_hold = TRUE` (recording a mandatory justification note, e.g., ongoing labor conciliation, wage claim litigation, disciplinary proceeding, or POSH inquiry).
   - While `is_legal_hold = TRUE`, all automated retention cleanup crons and right-to-erasure workflows are **strictly suspended** for that employee's evidence.
   - Legal holds can only be released through an explicit, audited Admin action recording the resolution rationale.
3. **Employee Exit Handling:**
   - Initiated via `SRS-FR-EMP-05` (Exit Workflow).
   - Once full-and-final settlement is finalized, if `is_legal_hold = FALSE`, the system marks biometric enrollment as `FLAGGED_FOR_PURGE` and executes automated storage scrubbing following the post-exit grace window.

### 2.4 Strict Data Minimization & Ephemeral Handling (Vendor Verification Requirement)
- **RAM-Only Processing Requirement (Subject to Provider Capability):**
  - The architectural baseline requires that daily verification selfies be processed in RAM and discarded immediately without persistent storage.
  - **Prerequisite Validation (DEC-03):** This requirement is subject to verification against the selected biometric provider's technical capabilities and contractual terms:
    - *Self-Hosted / Local Models:* Fully support pure RAM buffer processing with 100% data residency guarantees.
    - *Cloud SaaS Providers (e.g., AWS Rekognition, Azure Face, FaceIO):* Many cloud APIs accept base64 or binary byte streams via HTTPS POST. However, vendor contracts must be verified to confirm: (1) whether the provider persists images for service improvement unless explicitly opted out (e.g., AWS AI Services Opt-Out policy via AWS Organizations), and (2) whether the provider mandates staging images in cloud object storage (e.g., S3).
    - If a selected commercial provider mandates object storage staging, a transient staging bucket with an automated 1-hour lifecycle auto-delete rule must be provisioned and approved.
- **No Video Storage:** Live camera streams are processed client-side in memory for liveness challenges; continuous video feeds are never recorded or transmitted.
- **Single-Frame Probe:** Only the single verified snapshot frame is transmitted to the server.
- **No Secondary Use:** Biometric templates and probe photos are strictly restricted to workplace attendance verification. No emotional analysis, secondary profiling, or third-party data enrichment is performed.

### 2.5 Role-Based Access Control & Short-Lived Signed URLs
- **Strict Role-Based Access:**
  - Standard employees **cannot** view or download other employees' selfies or biometric references. Employees can only access their own attendance metadata (timestamps, hours, labels) and field-request decision status (no public image URLs stored or returned).
  - Only authorized same-tenant Admins (with `att:review_failures` / field-review authority) and Super Admins can view verification probe images (both standard failure probes and Sales Team field request selfies) during exception review.
- **Native 15-Minute Pre-Signed URLs:**
  - All storage buckets are private (`attendance-evidence`, `biometric-references`). Public image URLs are prohibited.
  - Access to image assets is mediated exclusively via temporary pre-signed URLs generated server-side (`supabase.storage.from(bucket).createSignedUrl(path, 900)`) and logged in `audit_logs`.
  - Time-to-Live (TTL) is strictly enforced at **15 minutes** ($900\text{ seconds}$), after which the signed token expires automatically.

### 2.6 Consent Lifecycle & Employee Rights (DPDP Section 6 & 11)
- **Mandatory Pre-Enrollment Notice:** Before biometric enrollment, the employee must be presented with an explicit, plain-language notice outlining:
  1. Specific purpose of collection (workplace attendance and identity verification).
  2. Storage tiers, encryption standards, and retention schedules.
  3. Third-party face verification processor identity (if commercial vendor selected).
  4. Employee rights to review data, request re-enrollment, or file grievances.
- **Immutable Consent Logging:** Timestamp, IP address, user agent, and notice version are logged immutably in `biometric_enrollments.consent_recorded_at`.
- **Right to Erasure:** Documented procedure to delete biometric enrollment references upon employee exit or upon verified consent withdrawal (with administrative fallback to manual attendance).

### 2.7 Applicable Indian Legal & Regulatory Requirements (For Legal Review)
The system architecture identifies the following statutory benchmarks for formal review by qualified legal counsel. **The system does not claim certified statutory compliance without verified legal review (LEG-02, LEG-04):**
1. **Digital Personal Data Protection (DPDP) Act, 2023:**
   - *Section 4 & 5:* Notice and lawful grounds for processing personal data.
   - *Section 6:* Conditions for valid, informed, unconditional, and unambiguous consent.
   - *Section 8:* General obligations of Data Fiduciary (reasonable security safeguards, data erasure upon purpose fulfillment).
   - *Section 9:* Higher threshold of care for sensitive categories including biometric data.
   - *Section 11, 12, 13:* Data Principal rights (access, correction, erasure, grievance redressal).
2. **Information Technology Act, 2000 & IT (Reasonable Security Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011 (SPDI Rules):**
   - *Rule 3:* Classification of biometric information as Sensitive Personal Data or Information (SPDI).
   - *Rule 5:* Collection limitations, prior consent mandate, purpose specification, and retention restriction.
   - *Rule 6:* Disclosure restrictions and third-party transfer prohibitions.
   - *Rule 8:* Mandatory ISO/IEC 27001 or equivalent comprehensive security program.
3. **State Labor Enactments (e.g., Telangana Shops and Establishments Act, 1988):**
   - Statutory obligations to maintain wage and attendance registers for statutory inspection periods, which must be reconciled with biometric retention limits.

---

## 3. Anti-Spoofing & Geofence Integrity Controls: Technical Assessment

Mobile web browsers (Safari, Chrome) present distinct security constraints compared to native operating system applications. The system design explicitly acknowledges these platform realities:

### 3.1 Technical Assessment of Web/PWA Geofencing
1. **Inherent Limitations of Browser APIs:**
   - The HTML5 Geolocation API (`navigator.geolocation`) operates inside a browser security sandbox.
   - Browser JavaScript **cannot detect Android mock-location flags** (`isFromMockProvider`) or inspect underlying device sensor registers.
   - Client device clocks can be altered by users.
   - IP geolocation via cellular mobile carriers (e.g., Jio, Airtel) resolves to distant PGW/GGSN network aggregation centers (often 50–200 km away) and **cannot reliably validate a 50-meter or 100-meter office perimeter**.
   - HTML5 `<canvas>` frame captures do not contain hardware camera EXIF metadata.
2. **Realistic Security Controls:**
   - Client-side browser checks **do not reliably prevent GPS spoofing** on mobile web/PWA.
   - The system therefore relies on **authoritative server-side controls**:
     - Strict server-side Haversine distance calculation against immutable office coordinates stored in the database (`100m` legacy baseline; **proposed `50m` standard perimeter under `PO-ATT-GEOFENCE-50M` pending formal PO approval**).
     - Enforcement of GPS accuracy threshold $\le 30\text{ meters}$ on both standard office punches and Sales Team Field Attendance Requests.
     - Server timestamp as the sole source of truth for online submissions and derived `attendance_date`.
     - Rate-limiting punch attempts and anomaly/impossible-travel velocity checks to reject or flag suspected GPS spoofing (`is_spoof_suspected`, `spoof_flag_reason`).
3. **Multi-Factor Presence Verification:**
   - Because GPS proves only that a device reporting certain coordinates was at the reported location, **physical presence relies on the secondary biometric verification layer** (live selfie + liveness detection + 1:1 face match). This remains mandatory for **both** standard office attendance and Sales Team field attendance requests.
   - If strict hardware-level anti-spoofing is mandated in future phases, native Android/iOS mobile applications with hardware attestation (Play Integrity / DeviceCheck) must be implemented.

### 3.2 Idempotency & Replay Protection for Attendance Submissions (DEC-02 Approved)
To prevent accidental duplicate punches caused by client double-taps, network retries, or malicious replay attacks:
1. **Database Constraint Serialization:**
   - The relational schema enforces `UNIQUE(attendance_day_id, event_type)` on `attendance_events`, and proposed partial unique index `uq_field_req_active_emp_day_type` prevents duplicate active/approved `field_attendance_requests` per `(organization_id, employee_id, attendance_date, request_type)`.
   - PostgreSQL engine transactions guarantee that even simultaneous concurrent HTTP requests cannot insert duplicate `CHECK_IN`/`CHECK_OUT` events or overlapping active field attendance requests for the same employee day.
2. **Deterministic Conflict Handling:**
   - Duplicate Check-In attempts return HTTP 409 Conflict (`ATTENDANCE_ALREADY_CHECKED_IN`).
   - Check-Out without active Check-In returns HTTP 409 Conflict (`CHECK_OUT_WITHOUT_CHECK_IN`).
   - Duplicate Check-Out attempts return HTTP 409 Conflict (`ATTENDANCE_ALREADY_COMPLETED`).
   - Duplicate active/approved field requests for the same day/type return HTTP 409 Conflict (`FIELD_ATTENDANCE_ALREADY_PENDING` / event conflict).
3. **Payload Tokenization & Idempotency Semantics:**
   - Client punch and field request submissions include an `Idempotency-Key` header generated per attempt.
   - **Same `Idempotency-Key` + Identical Payload:** Returns the cached original stored response (HTTP 200/201 replay) without re-executing verification or database writes.
   - **Different `Idempotency-Key` + Duplicate Action:** Triggers database/business conflict returning **HTTP 409 Conflict** (`ATTENDANCE_ALREADY_CHECKED_IN`, `ATTENDANCE_ALREADY_COMPLETED`, or `FIELD_ATTENDANCE_ALREADY_PENDING`).
   - **Same `Idempotency-Key` + Different Payload:** Rejects immediately with **HTTP 422 Unprocessable Entity** (`IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`).

### 3.3 Sales Team Field Attendance Exception Security Controls (`PO-ATT-FIELD-SALES` Proposed)
1. **Strict Server-Side Eligibility & DEC-02 Per-Punch Isolation:** UI hides the Field Attendance Request workflow from non-Sales employees, and the backend derives eligibility strictly server-side by joining `employees.department_id` to `departments.allow_field_attendance = TRUE` within `current_org_id()`. Client-supplied flags are ignored (`403 FIELD_ATTENDANCE_NOT_ELIGIBLE`). Every field request explicitly targets `CHECK_IN` or `CHECK_OUT`, follows DEC-02's single daily pair maximum, enforces check-in-before-check-out order, requires its own live selfie, biometric verification, GPS evidence, and mandatory comment, and is reviewed independently by Admin.
2. **No GPS Falsification / Coordinate Integrity:** Field attendance waives the 50m office geofence gate **only**; it never discards, clamps, or falsifies outside-office coordinates. Actual captured `(latitude, longitude)`, `accuracy_meters` ($\le 30\text{m}$ mandatory), Haversine `distance_from_office_meters`, and factual `is_within_office_geofence` (`FALSE` when outside office perimeter) are retained immutably.
3. **Strict Biometric Pass Requirement & `Verification Pending` Prohibition:** Removing the office geofence makes live liveness verification and 1:1 facial matching mandatory preconditions for approval. Preserves the maximum 3 automated face attempts and `Verification Pending` rule: `Verification Pending` is never attendance approval and yields **0** payable credit. PostgreSQL constraint `chk_field_req_approve_requires_biometrics` and API review guards physically prohibit an Admin from approving any field request where `is_liveness_verified = FALSE` or `biometric_verified = FALSE`. Attendance credit requires successful identity verification via an authorized Admin-supervised process first.
4. **Private Evidence Storage & Signed URL Access:** Field attendance selfies reside strictly in private bucket `attendance-evidence` (never public image URLs), encrypted at rest, purged within the DEC-14 30-day ceiling (unless `is_legal_hold = TRUE`), and viewed solely by authorized same-tenant Admins/Super Admins via 15-minute pre-signed URLs logged in `audit_logs`.

---

## 4. Authentication Architecture & Credential Brokerage (DEC-09 & DEC-13 Approved)

*(For the complete Task 2.2B.1 remediated broker architecture, threat analysis, sequence diagram, and PO decision register, see [`docs/09_AUTHENTICATION_BROKER_ARCHITECTURE.md`](file:///Users/mac/Desktop/HRMS/docs/09_AUTHENTICATION_BROKER_ARCHITECTURE.md).)*

### 4.1 Approved Express Authentication Broker Architecture (DEC-09 Approved)
- **Approved Decision Status:** The Product Owner officially **APPROVED DEC-09** on 2026-11-07, confirming the **Supabase Auth with Express Authentication Broker** architecture for multi-tenant mobile number + password authentication.
- **Core Principles & Safeguards:**
  1. **Single Source of Truth for Credentials:** All user passwords, cryptographic hashing, and session JWT issuance are managed exclusively by Supabase Auth (GoTrue). The Express application and application database (`public.users`) **strictly do NOT implement a second password-storage or verification system**, and **never mint custom JWTs or capability tickets**.
  2. **Tri-Partite Tenant Scoping (DEC-13):** Login requests submit `organizationCode`, `phoneNumber`, and `password`. Employees never enter or manage email addresses. The Express backend resolves the tenant internally via `resolve_organization_by_code()` (implemented in Migration `00002`, verifying active organization status), then looks up internal login identity via `hrms_internal.resolve_login_identity()` (proposed Migration `00004`, owned by dedicated non-login read-only role `hrms_auth_lookup_owner` with column-restricted `SELECT`, fixed `search_path = pg_catalog, public`, zero DML/payroll/employee/provisioning access, and `EXECUTE` granted solely to `hrms_app_user`).
  3. **Internal Synthetic Identity Mapping (`PO-01` / `REC-01` — APPROVED Scheme 3, 2026-11-10):** Because Supabase `auth.users.phone` enforces global uniqueness while HRMS scopes phone numbers to organizations (`uq_users_org_phone`), Express uses the formally approved **Scheme 3 (`<immutable_uuid>@auth.hrms.internal`)** generated during account provisioning and persisted in `public.users.synthetic_email`. This decouples GoTrue from mutable phone numbers and organization codes so mobile number changes require zero distributed GoTrue email renames. Employees never enter an email address, and `synthetic_email` is never exposed in employee-facing UI, API responses, logs, error messages, or payslips.
  4. **Strict Gateway Isolation:** Untrusted clients (browser/mobile PWA) never connect directly to Supabase Auth or PostgreSQL, and never receive `SUPABASE_SERVICE_ROLE_KEY`. All authentication traffic terminates at Express over TLS 1.3.
  5. **Identity Mapping:** Supabase Auth `auth.users.id` maps 1:1 to `public.users.id`. Profile, role, and employee relationships are maintained in PostgreSQL under RLS.
  6. **Employee-Controlled Activation, Self-Service OTP Recovery & Anti-Enumeration Protection:** Employees activate accounts via approved two-factor onboarding verification (Task 2.2B.5 / 2.2B.5A–D): an Admin-generated single-use, time-limited 256-bit CSPRNG opaque activation token rendered as a URL with a client-only fragment (`/auth/activate#token=...`) and equivalent QR code (`account_activation_tokens`, SHA-256 hashed at rest; shared strictly out-of-band during onboarding, never in public directories or standard API lists) combined with automated SMS OTP verification dispatched to the registered Indian mobile (`+91XXXXXXXXXX`, `PO-02`). Plaintext tokens are never transmitted in HTTP request lines, never logged in proxy access logs or browser analytics/telemetry, and frontend clears fragments immediately from the address bar. Cross-system completion reliability enforces a **user-level single-flight operation lock** (`public.users.activation_lock_state` keyed by `auth_user_id` — preventing both same-token and cross-token GoTrue races without holding open database locks across GoTrue network calls; atomically sending password + `app_metadata.hrms_activation_op_id = opId` in GoTrue `admin.updateUserById`; releasing ONLY on specifically identified pre-commit `422 weak_password` rejection rather than blanket 4xx; client timeout/cancellation explicitly non-conclusive; uncertain outcomes positively auto-complete ONLY on exact `hrms_activation_op_id === opId` match, and otherwise quarantine the Auth user's activation state `QUARANTINED_MANUAL_RECOVERY`, blocking Admin reissue until controlled manual `SUPER_ADMIN`/SRE recovery — acknowledging **fully automatic safe retry is NOT technically possible with GoTrue**; leaving already-completed `account_provisioning_requests` untouched). Employees choose their own permanent password during activation; Administrators never create, set, view, or know an employee's permanent password. Tokens invalidate on use, 24h expiry, cancellation, uncertain-outcome quarantine, or Admin reissue (`POST /api/v1/admin/users/:userId/reissue-activation` scoped strictly to authorized same-tenant Admins when lock is `'NONE'`). Employees recover forgotten passwords via **`PO-03` Approved Self-Service Mobile OTP** (`password_reset_otps` using keyed `HMAC-SHA256` + server-only `OTP_HMAC_PEPPER`, CSPRNG generation, short expiry, single use under atomic `FOR UPDATE` consumption prior to GoTrue password update, max attempts, resend cooldown/rate limits, anti-enumeration uniform `202` / generic failure responses, global session revocation, and non-secret `audit_logs` without exposing `synthetic_email`, Supabase Auth IDs, OTPs, or passwords). Low-entropy numeric OTPs are strictly prohibited on the `SHA-256` opaque token table. Login, activation, and recovery failures apply pre-DB tuple rate limiting and practical timing mitigation (bounded latency floor + dummy hashing) with uniform error payloads.

### 4.2 Authentication Broker Policy Status (`PO-01`–`PO-07` & Initial Account Activation Policy Approved; `DEC-10` Open)
1. **`PO-01` (`REC-01` — Synthetic Identity Format): OFFICIALLY APPROVED / CLOSED (2026-11-10).** Selected Option: **Scheme 3 (`<immutable_uuid>@auth.hrms.internal`)** generated during provisioning, persisted in `public.users.synthetic_email`, immutable when mobile numbers change, and never exposed in employee-facing UI, API responses, logs, error messages, or payslips.
2. **`PO-02` (Indian Mobile Number Normalization): OFFICIALLY APPROVED / CLOSED (2026-11-10).** Phase 1 supports **Indian mobile numbers only** (no international numbers). Canonical storage format is strict E.164 `+91XXXXXXXXXX` (`^\+91[6-9][0-9]{9}$`) across `public.users.phone_number` and `account_provisioning_requests.phone_number`. Accepted input forms are strictly `9876543210`, `919876543210`, and `+919876543210` (with common spaces and hyphens stripped before validation); landlines, short codes, malformed numbers, international numbers, and arbitrary prefixes (including leading `0` trunk prefixes) must be rejected without silent truncation or guesswork. Backend normalizes authoritatively prior to lookup, provisioning, tenant-scoped uniqueness checks (`uq_users_org_phone`), and login (never trusting client-normalized values); phone updates preserve the `PO-01` immutable `synthetic_email`, and failed logins return generic errors without leaking organization or phone existence.
3. **`PO-03` (Self-Service Password Recovery via Mobile OTP): OFFICIALLY APPROVED / CLOSED (2026-11-10).** Phase 1 supports self-service password recovery via SMS OTP dispatched strictly to the employee's registered, verified Indian mobile number (`phone_verified_at IS NOT NULL`, active org/user/activated). Preserves `DEC-09`, `DEC-13`, `PO-01` Scheme 3 (`<immutable_uuid>@auth.hrms.internal`), and `PO-02` Indian-only normalization without switching to Supabase native phone authentication. Mandates CSPRNG OTP generation, short TTL, single-use atomic lock + burn before GoTrue `admin.updateUserById`, keyed `HMAC-SHA256` storage with server-only pepper (`public.password_reset_otps`, never plaintext OTP or unkeyed SHA-256), max attempts, resend cooldown, pre-DB anti-enumeration rate limits, global session revocation, audit logging without secret/PII leakage, and zero password visibility for Admins. *Unresolved details kept explicitly open:* SMS vendor selection and Indian DLT registration (`DEC-10`), exact OTP numeric tuning parameters, and operational approval workflow for the proposed **Admin-assisted lost-mobile recovery alternative** (not finalized).
4. **`Initial Account Activation Policy` (Distinct Approved Policy — Task 2.2B.5 / 2.2B.5A–D Approved 2026-11-10):** Distinct, un-conflated initial onboarding activation policy: Two-factor onboarding activation using Admin-generated single-use 256-bit activation link / QR code containing a URL fragment (`/auth/activate#token=...`, `token_hash CHAR(64)` in `account_activation_tokens`) shared out-of-band + mobile SMS OTP verification sent to registered Indian mobile (`+91XXXXXXXXXX`). Frontend strips fragment immediately and sends over HTTPS; tokens are never logged in browser telemetry or server proxy logs; user-level single-flight lock (`public.users.activation_lock_state` keyed by `auth_user_id`) prevents cross-token and parallel GoTrue password overwrites (`NONE -> IN_FLIGHT` once; zero automatic takeover/mismatch reset; releases ONLY on GoTrue `422 weak_password`; positive `app_metadata.hrms_activation_op_id` match auto-completes; missing marker quarantines the user `QUARANTINED_MANUAL_RECOVERY`, blocking Admin reissue until controlled manual `SUPER_ADMIN`/SRE unlock because **fully automatic safe retry is NOT possible with GoTrue**; leaving already-completed `account_provisioning_requests` untouched); employee sets permanent password; Admins never see, set, or know passwords. Tokens invalidate on use, 24h expiry, cancellation, uncertain-outcome quarantine, or Admin reissue (`POST /api/v1/admin/users/:userId/reissue-activation` scoped to same-tenant Admins when lock is `'NONE'`). Setting `activated_at = NOW()` and `phone_verified_at = NOW()` completes onboarding. Preserves zero email UX (`PO-01` Scheme 3). Zero new decision IDs invented.
5. **`PO-04` (Authentication Rate Limiting & Error-Response Policy): OFFICIALLY APPROVED / CLOSED (2026-11-10).** Enforces **`5` failed login attempts per account within a rolling `15-minute` window** using a privacy-preserving keyed hash (`HMAC-SHA256` of normalized org identity + canonical E.164 phone) and **atomic shared counters across backend instances** (no per-process in-memory counters); temporary throttling only (never permanent account lockout); separate **IP-based rate limiting** with pinned `trust proxy` configuration; identical generic **`HTTP 401 INVALID_CREDENTIALS`** across unknown org, unknown phone, inactive/unactivated user, and wrong password; generic **`HTTP 429 TOO_MANY_REQUESTS`** applied symmetrically to unknown accounts (including `Retry-After` only when a reliable retry timestamp exists); resets account counter upon successful login without clearing IP counters; preserves layered timing mitigation (without claiming constant time); and records non-secret `audit_logs` omitting passwords, OTPs, raw tokens, JWTs, or secret material. IP numeric thresholds and temporary tuning durations remain implementation configuration to be tested, and `PO-03` OTP rules remain untouched.
6. **`PO-05` (Refresh Token Transport & Browser Security Policy): OFFICIALLY APPROVED / CLOSED (2026-11-10).** Refresh tokens MUST be delivered exclusively via `Secure`, `HttpOnly` cookies (`__Host-hrms_refresh_token`, `Path=/`, omitted `Domain`, topology-matched `SameSite`, conditional dev-HTTP handling), **never** returned in JSON response bodies or exposed to browser JavaScript, `localStorage`, `sessionStorage`, URLs, analytics, or logs. Access tokens remain short-lived JWTs in browser memory only (`Authorization: Bearer`) paired with Express DB-backed active/revocation checks (`revoked_sessions`, `tokens_valid_after_epoch`, `resolveTenantContext`). Requires signed double-submit/synchronizer CSRF protection (`X-CSRF-Token`, non-credential) plus explicit `Origin` allowlisting (`403 CSRF_ORIGIN_REJECTED` on missing/malformed/`null`/untrusted `Origin`) on `/auth/refresh`, `/auth/logout`, and cookie-authenticated endpoints; strict `CORS_ALLOWED_ORIGINS` allowlist (never `*` with credentials); refresh-token rotation + reuse detection/family revocation (noting honest non-atomicity across GoTrue and PostgreSQL/cookie delivery). Same-site vs cross-site hosting binding remains open under `DEC-11`.
7. **`PO-06` (GoTrue Configuration Alignment): OFFICIALLY APPROVED / CLOSED (2026-11-10).** Mandates disabling public signup (`enable_signup = false`, keeping server-side `admin.createUser` operational), `jwt_expiry = 900` seconds (15 minutes, matching `expiresIn: 900` API contract and `jwtVerifier.ts` validation), `minimum_password_length = 8`, disabling email confirmation (`enable_confirmations = false` solely for non-routable Scheme 3 synthetic emails while strictly preserving mandatory HRMS link/QR + SMS OTP activation), enabling refresh-token rotation + reuse detection, and restricting employee authentication exclusively to Express broker routes. *Local vs. Hosted Verification:* Actual local [`supabase/config.toml`](file:///Users/mac/Desktop/HRMS/supabase/config.toml#L167-L268) currently sets `jwt_expiry = 3600`, `enable_signup = true`, and `minimum_password_length = 6` (with `enable_confirmations = false`, `enable_refresh_token_rotation = true`, `refresh_token_reuse_interval = 10`, and `[auth.sms] enabled = false` already matching) — queued for Task `2.2C` updates alongside `jwt-verification.test.ts` fixtures; hosted Supabase settings remain **UNVERIFIED** from local workspace and must be configured/verified directly on deployment.
8. **`PO-07` (Concurrent Device Session Policy): OFFICIALLY APPROVED / CLOSED (2026-11-10; Privilege Separation, Trusted Actor & Cryptographic Context Hardened in Tasks 2.2B.9A–C).** Allows employees to stay authenticated concurrently across multiple devices with **no arbitrary fixed initial device limit**, tracking each login as an independent session in proposed tenant-isolated `public.user_sessions` (bound 1:1 to GoTrue JWT `session_id` via `gotrue_session_id`, persisting strictly keyed `HMAC-SHA256` `refresh_token_hmac` digests with Express-only `SESSION_TOKEN_HMAC_KEY` — zero plaintext refresh tokens or JWTs stored in DB/logs — alongside privacy-safe `device_summary`, masked `approx_ip`, and debounced `last_activity_at`). **Strict DB Privilege Separation, Trusted Actor & Cryptographic Context Verification (Tasks 2.2B.9A–C):** `hrms_auth_lookup_owner` (`BYPASSRLS`) stays strictly frozen to pre-auth identity/org resolution (`REVOKE ALL` on `user_sessions`, `revoked_sessions`, and `context_signing_keys`), while all session operations run under separate **`hrms_session_manager` (`NOLOGIN NOBYPASSRLS`)** preserving `FORCE ROW LEVEL SECURITY` (`organization_id = public.current_org_id()`) and zero caller-supplied `p_actor_user_id`. Because custom GUCs (`app.current_org_id`, `app.current_user_id`) are caller-settable variables that a raw `hrms_app_user` SQL session could spoof, dedicated **`hrms_context_verifier` (`NOLOGIN NOBYPASSRLS`)** enforces transaction-bound cryptographic **`p_tx_proof`** verification (`pg_current_xact_id()` `xid8` + single-use `challenge_nonce` + constant-time `pgcrypto` `HMAC-SHA256` with `TX_CONTEXT_HMAC_KEY` stored outside GUCs in `hrms_internal.context_signing_keys` supporting `'ACTIVE' -> 'VERIFY_ONLY' -> 'REVOKED'` rotation and Task `2.2C` `pgsodium` Ed25519 evaluation) across **all 11** `hrms_session_manager` functions (`SQLSTATE 42501` fail-closed on missing, forged, replayed, GUC-mismatched, wrong-op, or expired proofs), paired with single-use `public.password_reset_otps.sessions_revoked_at` locking on `otp_revoke_all_user_sessions`. Supports active session listing (`GET /api/v1/auth/sessions`), individual revocation (`DELETE /api/v1/auth/sessions/:sessionId`, strictly leaving `tokens_valid_after_epoch` and sibling device sessions intact), employee revoke-all (`POST /api/v1/auth/sessions/revoke-all` / `/logout` `'global'`), mandatory global revocation on password change/OTP reset & employee deactivation, same-tenant Admin revocation (`POST /api/v1/admin/users/:userId/sessions/revoke-all` blocking `ADMIN` from targeting `SUPER_ADMIN` with mandatory `reason`), protected-request DB revocation enforcement (`revoked_sessions`, `user_sessions.revoked_at`, `tokens_valid_after_epoch`, and `is_active` blocking already-issued `900s` access JWTs), per-session concurrent refresh coordination + scoped token-family revocation on confirmed reuse (`PO-05`), and 7 mandatory `audit_logs` events. Live GoTrue `v2.197.0` `admin.signOut` scopes, remote session termination vs. broker blocking, `refresh_token_reuse_interval` concurrency semantics, `ban_duration` vs. refresh grants, and the 15-scenario Task `2.2B.9C` adversarial test matrix remain queued for Task `2.2H` live verification. *(Only `DEC-10` commercial SMS provider/DLT remains open across the Authentication Broker decision set.)*
9. **Provisioning Provenance Verification:** When recovering from GoTrue `422 email_exists` crashes during worker retries, verifying trusted `app_metadata` (`hrms_organization_id`, `hrms_provisioning_request_id`) and DB cross-checks rather than treating a duplicate-email response alone as ownership proof. *(Note: Cryptographic JWT verification via `jose` / local JWKS is implemented in Task 2.2A [`jwtVerifier.ts`](file:///Users/mac/Desktop/HRMS/server/src/auth/jwtVerifier.ts)).*

---

## 5. Financial & Payroll Data Integrity

### 5.1 Standardized Precision (Paise Accounting)
- Floating-point representations (`FLOAT`, `DOUBLE PRECISION`) are prohibited.
- All monetary columns in PostgreSQL are typed as `BIGINT` representing integer paise.
- Intermediate multiplication with hourly and minute rates uses standardized **`NUMERIC(14,6)`** precision.
- Half-Up Rounding is applied only at the final net salary compilation step.

### 5.2 Dual-Authorization Payroll Lock
- Admin users can prepare draft payroll runs, but **cannot approve their own batches**.
- Super Admin possesses exclusive authority to approve a submitted batch (`SUBMITTED_FOR_APPROVAL` $\rightarrow$ `APPROVED`).
- Approved payroll batches and constituent `payroll_items` are immutable. Reversals or adjustments require a formal reversal transaction with complete audit logging.

---

## 6. Complete Append-Only Audit Trail Architecture

The HRMS platform enforces a comprehensive, tamper-evident audit trail capturing every state modification across all operational modules. Audit logs are **strictly append-only** and structurally protected against tampering or deletion.

### 6.1 Audit Data Model & Mandatory Attributes
Every audited transaction writes a structured row to the `audit_logs` table containing:
1. **Actor Identity:** `actor_user_id` (UUID) and `actor_role` (`SUPER_ADMIN`, `ADMIN`, `EMPLOYEE`, or `SYSTEM_CRON`).
2. **Tenant Context:** `organization_id` (UUID).
3. **Action Performed:** Explicit action verb (`CREATE`, `UPDATE`, `DELETE`, `APPROVE`, `REJECT`, `REVERSE`, `PAYMENT_RECORD`, `EXPORT`, `OVERRIDE`, `LOGIN_FAILURE`).
4. **Affected Target:** `target_table` (name of entity table) and `target_id` (UUID of mutated entity).
5. **State Diff Snapshots:** `payload_before` (complete JSONB snapshot prior to mutation) and `payload_after` (complete JSONB snapshot after mutation).
6. **Justification & Metadata:** `reason` (mandatory text note for administrative actions) and `metadata` (JSONB for client IP address, user agent, request correlation ID).
7. **Authoritative Timestamp:** `created_at` (server-generated `TIMESTAMPTZ NOT NULL DEFAULT NOW()`).

### 6.2 Operations Covered by Mandatory Audit Logging
The audit trail captures 100% of mutations initiated by Super Admins and Admins, as well as sensitive employee actions:
1. **Employee Records:** Creation, demographic updates, office reassignments, departmental transfers, salary rate changes, and separation/exit workflows (`employees`, `employee_bank_details`, `employee_documents`).
2. **Attendance Corrections & Sales Field Attendance Exception:**
   - *Workflow A (Missing Punches):* Manual insertion of check-in or check-out with mandatory explanation note ($\ge 10\text{ chars}$) and Admin ID.
   - *Workflow B (Timestamp Adjustments):* Effective timestamp modifications on `attendance_days` preserving raw evidence in `attendance_events`.
   - *Unpaired Punch Resolutions:* Administrative reconciliation of unpaired punches.
   - *Sales Team Field Attendance Exception (`PO-ATT-FIELD-SALES` Proposed):* Field request rejections/approvals (`field_attendance_requests`, Admin ID, `reviewed_at`, mandatory `rejection_reason`, `payload_before`/`payload_after`), spoofing/impossible-travel anomaly alerts, and department field-eligibility flag changes (`departments.allow_field_attendance`).
3. **Leave Lifecycle:** Application submissions, Admin approvals, rejections (with remarks), and manual quota adjustments/overrides (`leave_applications`, `leave_balances`).
4. **Salary Configuration:** Base monthly reference changes, recurring allowances, fixed deduction updates (`employee_salaries`).
5. **Payroll Preparation:** Batch compilation, standard monthly hours configuration, proration adjustments, and draft submissions (`payroll_runs`, `payroll_items`).
6. **Payroll Approvals & Dual-Key Governance:** Super Admin batch approvals, rejections (with reason), and formal payroll reversals (`payroll_runs`).
7. **Payment Tracking Updates:** Recording disbursement status (`PENDING` $\rightarrow$ `PAID`), payment mode (NEFT/RTGS/IMPS), UTR reference numbers, and disbursement timestamps (`payment_records`).
8. **Sensitive Access & Data Exports:** Every access to raw biometric probe images, unmasked employee banking details, and exported CSV/PDF attendance or payroll registers.
9. **Authentication Broker & Concurrent Device Sessions (`PO-01`–`PO-07`):** Account activation/reissue/quarantine, OTP password recovery requests/completions, login attempts/throttling (`PO-04`), and all 7 mandatory `PO-07` session events (`SESSION_CREATED`, `SESSION_REFRESHED`, `SESSION_REVOKED`, `ALL_SESSIONS_REVOKED`, `PASSWORD_CHANGE_SESSIONS_REVOKED`, `ADMIN_SESSIONS_REVOKED` including deactivation, and `REFRESH_TOKEN_REUSE_DETECTED`), capturing actor, target user, organization, server timestamp, explicit outcome, and privacy-safe metadata while strictly excluding passwords, OTPs, plaintext refresh tokens, access JWTs, HMAC secrets, and `synthetic_email`.

### 6.3 Append-Only Database Immutability Enforcement (Multi-Layered Architecture)
Audit log immutability is guaranteed through a defense-in-depth model combining role-based permission revoking, statement-level triggers, privileged role separation, and automated regression testing:

1. **Application-Role Permissions (Primary Defense):**
   - The runtime application connects to PostgreSQL strictly as `hrms_app_user` (or `authenticated`).
   - The database role `hrms_app_user` is explicitly restricted:
     ```sql
     REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM hrms_app_user, PUBLIC;
     GRANT INSERT, SELECT ON audit_logs TO hrms_app_user;
     ```
   - Any runtime application statement attempting to update, delete, or truncate `audit_logs` is halted immediately at the PostgreSQL parser/planner level with `SQLSTATE 42501 (insufficient_privilege)`.
2. **Trigger Protections (Defense-in-Depth):**
   - As an additional safeguard against accidental administrative updates or roles with residual privileges, a statement-level trigger intercepts any `UPDATE` or `DELETE`:
     ```sql
     CREATE OR REPLACE FUNCTION trg_enforce_audit_immutability()
     RETURNS TRIGGER AS $$
     BEGIN
         RAISE EXCEPTION 'audit_logs table is strictly append-only. UPDATE and DELETE statements are prohibited (SQLSTATE 42501).'
             USING ERRCODE = 'insufficient_privilege';
     END;
     $$ LANGUAGE plpgsql;

     CREATE TRIGGER trg_audit_logs_no_mutation
     BEFORE UPDATE OR DELETE ON audit_logs
     FOR EACH STATEMENT
     EXECUTE FUNCTION trg_enforce_audit_immutability();
     ```
   - *Technical Precision:* In PostgreSQL, PL/pgSQL exceptions abort statement and transaction execution unless caught within an enclosing PL/pgSQL `EXCEPTION` block. Standard client SQL statements submitted over application connection pools cannot bypass this statement abort, and because `hrms_app_user` lacks update/delete permissions, client queries are rejected before trigger invocation.
3. **Privileged-Role Limitations:**
   - The `audit_logs` table is owned by the migration/superuser role (e.g., `supabase_admin` or `postgres_migrator`).
   - Neither the backend application server nor application users possess credentials for the migration role during runtime operations.
   - Application Super Admins (`SUPER_ADMIN`) are application-layer roles stored in `user_roles`; their queries still execute over database connections as `hrms_app_user`. Application Super Admins therefore have zero database capability to modify or delete audit rows.
   - Direct superuser access is restricted to versioned CI/CD migration scripts and platform maintenance, and all superuser sessions are recorded in Supabase platform access logs.
4. **Automated Verification Tests (`SUITE-AUDIT`):**
   - Automated tests in `08_ROADMAP_AND_TESTING_STRATEGY.md` (`TC-AUD-01` and `TC-AUD-02`) connect as `hrms_app_user` and verify that `UPDATE` and `DELETE` queries fail with `42501`. Test `TC-AUD-02B` verifies that even privileged execution triggers statement abort.

---

## 7. Multi-Tenant Security & Automated Isolation Testing Framework

The SaaS architecture guarantees absolute cryptographic and relational separation between tenant organizations.

### 7.1 Trusted Tenant Context Establishment & Isolation
1. **Network Boundary & Express Broker:**
   - Untrusted clients (mobile PWA, browser) **never connect directly to PostgreSQL or PostgREST**. Port 5432 is strictly firewalled and accessible only from the Express backend VPC.
   - All client requests terminate at the Node.js/Express API gateway over TLS.
2. **Server-Side Tenant Context Derivation:**
   - The frontend client is **never trusted** to supply `organization_id`. Any client-supplied tenant identifier in headers, query parameters, or request body is discarded.
   - Express authentication middleware validates the incoming `Authorization: Bearer <token>`, verifies its cryptographic signature, and resolves the trusted `user_id` and active `organization_id` from the server's verified session store / user organization memberships.
3. **Transaction-Scoped Context Setting (`set_config(..., true)`):**
   - When executing database operations for a request, Express checks out a connection from the pool and establishes context strictly inside an explicit transaction:
     ```sql
     BEGIN;
     SELECT set_config('app.current_org_id', :trusted_org_id, true);
     SELECT set_config('app.current_user_id', :trusted_user_id, true);
     -- Business logic query executes here with RLS filtering
     COMMIT;
     ```
   - Setting parameter `is_local = true` (the third argument in `set_config`) guarantees that these configuration settings are strictly transaction-scoped. Upon `COMMIT` or `ROLLBACK`, the variables automatically revert to empty strings, completely preventing connection-pool contamination in pooled environments (such as PgBouncer or Supabase transaction pooler).
4. **Why Untrusted Clients Cannot Manipulate Tenant Context:**
   - Clients have no direct connection to the database.
   - All backend SQL queries use parameterized prepared statements; client input cannot inject SQL commands or invoke `set_config`.
   - If an internal query executes without setting `app.current_org_id`, the helper function `current_org_id()` returns `NULL`, causing `organization_id = current_org_id()` to evaluate to `FALSE` (fail-closed, returning 0 rows).
5. **Exact PostgreSQL Roles, Grants & RLS Enforcement:**
   - **Implemented Runtime Application Role (`hrms_app_user`, Migration `00001`–`00003`):** Created with strict least privilege:
     ```sql
     CREATE ROLE hrms_app_user WITH LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
     GRANT USAGE ON SCHEMA public TO hrms_app_user;
     -- Sensitive identity, tenant, role, and provisioning tables are READ ONLY to hrms_app_user:
     GRANT SELECT ON organizations, users, user_roles, account_provisioning_requests, account_provisioning_events TO hrms_app_user;
     REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON organizations, users, user_roles, account_provisioning_requests, account_provisioning_events FROM hrms_app_user, PUBLIC;
     -- Pre-auth org resolution implemented in Migration 00002 (resolve_organization_by_code);
     -- Proposed login lookup & broker procedures execute via controlled SECURITY DEFINER routines in Migration 00004.
     -- Future immutable audit ledger strictly prohibits mutations:
     REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM hrms_app_user, PUBLIC;
     ```
   - **Proposed Dedicated Pre-Auth Lookup Owner (`hrms_auth_lookup_owner`, Future Migration `00004` — Zero Session Access):**
     - `CREATE ROLE hrms_auth_lookup_owner WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;` (distinct from Migration `00001` `hrms_schema_owner` and `hrms_session_manager`, both `NOBYPASSRLS`).
     - Owns strictly `hrms_internal.resolve_login_identity(UUID, TEXT)`, `hrms_internal.resolve_recovery_identity(UUID, TEXT)`, and `hrms_internal.resolve_auth_user_tenant(UUID)` inside non-PostgREST internal schema `hrms_internal` outside `supabase/config.toml` `api.schemas = ["public", "graphql_public"]` (`REVOKE ALL ON SCHEMA hrms_internal FROM PUBLIC, anon, authenticated, service_role; GRANT USAGE ON SCHEMA hrms_internal TO hrms_app_user;`).
     - Because PostgreSQL evaluates table/column ACLs **before** RLS (`BYPASSRLS` only skips RLS row policies on explicitly `GRANT`ed columns), granting strictly column-level `SELECT (id, is_active) ON public.organizations` and `SELECT (id, organization_id, phone_number, synthetic_email, is_active, activated_at, phone_verified_at) ON public.users` (with `REVOKE ALL` on all other tables, zero DML, fixed `SET search_path = pg_catalog, public`, and `EXECUTE` granted solely to `hrms_app_user`) isolates `hrms_auth_lookup_owner` from **`public.user_sessions`**, **`public.revoked_sessions`**, `user_roles`, `employees`, `payroll_*`, `account_provisioning_*`, `account_activation_tokens`, `password_reset_otps`, `audit_logs`, and `auth.*`. Its `BYPASSRLS` privileges MUST NEVER be expanded for `PO-07` session management.
     - **Supabase Fallback & Credential Compromise Containment:** If hosted `supautils` disallows custom `BYPASSRLS` role creation in Task 2.2C pre-flight checks, Migration `00004` falls back to `hrms_auth_lookup_owner WITH NOBYPASSRLS` + narrow internal-GUC lookup RLS policies (or hardened `postgres` ownership only if role ownership transfer is prohibited, with explicit risk acceptance). If the `hrms_app_user` runtime credential itself is leaked, the attacker cannot escalate roles or mutate foundation/identity/session/audit records, and **session GUC spoofing is cryptographically blocked** by `hrms_context_verifier` (failing closed with `SQLSTATE 42501` without `TX_CONTEXT_HMAC_KEY`), though raw SQL access still leaves non-session `00001`–`00003` helpers / lookup oracles exposed — mandating VPC/network DB firewalling and credential rotation (see [`docs/09_AUTHENTICATION_BROKER_ARCHITECTURE.md`](file:///Users/mac/Desktop/HRMS/docs/09_AUTHENTICATION_BROKER_ARCHITECTURE.md) §§ 3.2–3.3, 9.6.8).
   - **Proposed Dedicated Cryptographic Context Verifier (`hrms_context_verifier`, Future Migration `00004` — `NOLOGIN NOBYPASSRLS`, Task 2.2B.9C):**
     - `CREATE ROLE hrms_context_verifier WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;` owning `hrms_internal.context_signing_keys` (256-bit `BYTEA` secrets `'ACTIVE' | 'VERIFY_ONLY' | 'REVOKED'`, partial unique `'ACTIVE'` index; NEVER stored in PostgreSQL GUCs) and `hrms_internal.tx_context_challenges` (`challenge_nonce UUID`, `tx_xid TEXT`, `15s` TTL, atomic `consumed_at`), with **`REVOKE ALL` from `hrms_app_user`, `hrms_auth_lookup_owner`, `hrms_session_manager`, `anon`, `authenticated`, and `service_role`**.
     - Owns `hrms_internal.issue_tx_challenge()` (granted strictly to `hrms_app_user` inside active `READ WRITE` primary transactions, returning `pg_current_xact_id()::TEXT` `xid8` + CSPRNG nonce) and `hrms_internal.assert_verified_tx_context(p_tx_proof, p_expected_op, p_expected_target_id)` (granted strictly to `hrms_session_manager`; performs constant-time `pgcrypto` `HMAC-SHA256` verification, atomic `consumed_at` claim, `xid8` binding, TTL cap, `op`/`target_id` binding, and exact `current_org_id()`/`auth_user_id()` parity check — rejecting anomalies with `SQLSTATE 42501`).
     - Supports zero-downtime key rotation (`ACTIVE -> VERIFY_ONLY -> REVOKED`), requires writable primary transactions (`READ WRITE`), documents shared-secret backup/superuser risk mitigation, and evaluates upgrading to asymmetric **`pgsodium` Ed25519** public-key-in-DB verification in Task `2.2C`.
   - **Proposed Dedicated Session-Management Boundary (`hrms_session_manager`, Future Migration `00004` — `NOLOGIN NOBYPASSRLS`, Zero `p_actor_user_id`, Mandatory `p_tx_proof` — Tasks 2.2B.9A–C):**
     - `CREATE ROLE hrms_session_manager WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;` (`USAGE, CREATE ON SCHEMA hrms_internal`, `REVOKE ALL` on `hrms_internal.context_signing_keys`, `hrms_internal.tx_context_challenges`, `employees`, `payroll_*`, `attendance_*`, `leave_*`, `employee_salaries`, `account_provisioning_*`, `account_activation_tokens`, `audit_logs`, `users.synthetic_email`, `users.phone_number`, `password_reset_otps.otp_hmac`, `auth.*`).
     - Minimum column/table privileges: `SELECT (id, organization_code, name, is_active)` on `public.organizations`; `SELECT (id, organization_id, is_active, activated_at, must_change_password, tokens_valid_after_epoch)` + `UPDATE (tokens_valid_after_epoch)` on `public.users`; `SELECT (user_id, organization_id, role)` on `public.user_roles` (read-only for roles and Admin-vs-Super-Admin checks); `SELECT (id, organization_id, user_id, purpose, used_at, sessions_revoked_at)` + `UPDATE (sessions_revoked_at)` on `public.password_reset_otps` (single-use atomic OTP revocation guard); and `SELECT, INSERT, DELETE` + restricted `UPDATE` columns on `public.user_sessions` and `SELECT, INSERT, DELETE` on `public.revoked_sessions`.
     - Owns all 11 session `SECURITY DEFINER` routines in `hrms_internal` (`verify_authenticated_session_and_roles`, `lookup_session_by_refresh_hmac`, `create_user_session`, `rotate_user_session`, `list_active_user_sessions`, `revoke_user_session`, `revoke_compromised_session_family`, `revoke_own_all_sessions`, `otp_revoke_all_user_sessions`, `admin_revoke_all_user_sessions`, `purge_expired_sessions`) with **`SET search_path = pg_catalog, public`**, schema-qualified `public.*` references, `REVOKE ALL FROM PUBLIC, anon, authenticated, service_role`, and explicit `GRANT EXECUTE ... TO hrms_app_user` (zero frontend `anon`/`authenticated` DB access).
     - **Cryptographic Proof, Trusted Actor & `FORCE RLS` Enforcement:** Preserves `ENABLE` + `FORCE ROW LEVEL SECURITY` on `public.user_sessions` and `public.revoked_sessions` (`organization_id = public.current_org_id()`), eliminates caller-supplied `p_actor_user_id`, **mandates signed `p_tx_proof` verified via `assert_verified_tx_context()` as Step 1 of every routine** (preventing raw `hrms_app_user` `SET LOCAL` GUC impersonation of employees or `SUPER_ADMIN`), additionally enforces atomic `password_reset_otps.sessions_revoked_at` locking on OTP recovery, re-verifies org/user membership and `user_roles` (`'ADMIN'` blocked from `'SUPER_ADMIN'`), and preserves individual revocation isolation (`tokens_valid_after_epoch` and sibling sessions untouched).
   - All tenant-scoped tables enforce RLS:
     ```sql
     ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
     ALTER TABLE employees FORCE ROW LEVEL SECURITY;
     ALTER TABLE attendance_days ENABLE ROW LEVEL SECURITY;
     ALTER TABLE attendance_days FORCE ROW LEVEL SECURITY;
     -- (All other tenant tables configured with FORCE ROW LEVEL SECURITY)
     ```
   - Policies strictly enforce `USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id())`.
6. **Closed-Ring Composite Foreign Keys:**
   - All entity relationships enforce composite keys `(id, organization_id)`, making cross-tenant foreign key assignment physically rejected by PostgreSQL constraint engines.

### 7.2 Automated Multi-Tenant Security Test Suite (`SUITE-TENANT-ISOLATION`)
Automated integration tests run on every pull request to prove that cross-tenant access is impossible across all modules:

| Test ID | Module Tested | Test Vector / Attack Scenario | Expected System Behavior | HTTP Status |
|---|---|---|---|:---:|
| **TC-TEN-01** | Employees | User of Org A requests `GET /api/v1/employees/:id_of_org_b` | RLS blocks visibility; returns 404 | `404 Not Found` |
| **TC-TEN-02** | Employees | Admin of Org A sends `PATCH /api/v1/employees/:id_of_org_b` with update payload | Zero rows affected; returns 404 | `404 Not Found` |
| **TC-TEN-03** | Employees | Admin of Org A posts employee with body `{ "organization_id": "ORG_B_UUID" }` | Server overrides payload with Org A ID | `201 Created` (in Org A) |
| **TC-TEN-04** | Attendance | Employee of Org A attempts check-in at Office ID of Org B | Composite FK `fk_emp_office_tenant` rejects | `422 Unprocessable` |
| **TC-TEN-05** | Attendance | Admin of Org A requests attendance reviews for Org B employee | RLS filters review list to Org A only | `200 OK` (Empty list) |
| **TC-TEN-06** | Attendance | Admin of Org A attempts attendance correction on Org B attendance day | RLS prevents row update; 0 rows modified | `404 Not Found` |
| **TC-TEN-07** | Payroll | Admin of Org A requests `GET /api/v1/payroll/runs/:id_of_org_b` | RLS blocks row visibility | `404 Not Found` |
| **TC-TEN-08** | Payroll | Super Admin of Org A attempts to approve payroll run of Org B | RLS blocks update; returns 404/403 | `404 Not Found` |
| **TC-TEN-09** | Payslips | Employee of Org A attempts `GET /api/v1/payslips/:id_of_org_b/download` | RLS blocks row; signed URL not issued | `404 Not Found` |
| **TC-TEN-10** | Documents | User of Org A attempts signed URL generation for Org B storage path | Path validation blocks cross-tenant prefix | `403 Forbidden` |
| **TC-TEN-11** | Reports | Admin of Org A triggers `/reports/attendance` with Org B employee filter | Aggregation includes 0 records from Org B | `200 OK` (0 matching) |
| **TC-TEN-12** | Database Query | Direct query executed on connection with missing `SET LOCAL app.current_org_id` | RLS policy defaults to empty UUID; returns 0 rows | Empty Result Set |
| **TC-TEN-13** | Field Attendance *(Proposed)* | Org A user/Admin attempts access or review on Org B `field_attendance_requests` or field selfie path | `FORCE RLS` + closed-ring FKs + signed-URL prefix check block access | `403` / `404 Not Found` |

---

## 8. Backup, Disaster Recovery & Incident Response Framework

### 8.1 Automated Database Backup Frequency, Plan Dependencies & Costs
The platform establishes a multi-tiered backup architecture with clear separation between baseline capabilities, plan add-ons, and secondary cold storage:

1. **Continuous Write-Ahead Logging (WAL) & Point-in-Time Recovery (PITR):**
   - *Capability:* Enables point-in-time recovery to any second within the retention window.
   - *Plan Dependency:* Continuous WAL PITR is **not included in Supabase Free tier** and requires the **Supabase Pro Plan ($25/mo base) with the optional PITR Add-on** (starting at an additional $100/mo for 7-day retention, or $280/mo for 30-day retention). Team and Enterprise plans include customizable PITR.
   - *Baseline Capability without PITR Add-on:* If operating on standard Pro without the PITR add-on, Supabase provides daily automated base snapshots retained for 7 days (yielding a baseline data-loss window of up to 24 hours in catastrophic failure).
2. **Daily Automated Base Snapshots:**
   - Full base backups executed daily during minimum traffic window (02:00 IST).
   - Retained for 30 rolling calendar days on production configurations.
3. **Weekly Offsite Cold Snapshots:**
   - Automated weekly snapshot exported to an independent secondary cloud provider (e.g., AWS S3 Glacier / Google Cloud Storage Coldline).
   - Encrypted with AES-256 using dedicated backup KMS keys.
   - *Retention:* 90 rolling days for operational recovery; quarterly archives retained for 1 year for compliance audits.
   - *Cost Considerations:* Incurs Supabase database egress fees for snapshot downloads and cloud object storage archive fees (with minimum 90-day archive storage commitments).

### 8.2 Recovery Objectives: Proposed Targets vs. Verified Capabilities
- **Distinction Between Design Targets and Certified Capabilities:**
  - The metrics below represent **Engineering Design Targets (Proposed Service Level Objectives - SLOs)**.
  - They **must not be treated as contractual guarantees** until formally certified through benchmark restore tests on staging and production infrastructure.
- **Proposed Design Targets (Assuming Pro + PITR Add-on Active):**
  - **Recovery Point Objective (RPO) Target:** $\le 1\text{ hour}$ *(Design target; with active WAL PITR add-on, transaction loss in standard database failure is $\le 5\text{ minutes}$; without PITR add-on, baseline RPO is $\le 24\text{ hours}$)*.
  - **Recovery Time Objective (RTO) Target:** $\le 4\text{ hours}$ *(Design target covering standby database provisioning, backup/WAL replay, connection secret updates, API restarts, and health validation)*.

### 8.3 Periodic Restore Testing Rehearsals & Certification Requirements
Operational recovery capabilities are validated through scheduled, audited restore rehearsals:
- **Monthly Sandbox Restore Rehearsal (`TC-DR-01`):**
  - Automated CI/CD scheduled pipeline restores the latest production backup snapshot into an isolated, ephemeral sandbox database.
  - Automated verification script validates:
    1. Table counts across all 25 schema tables match production telemetry.
    2. Primary key and foreign key relational integrity constraints pass 100%.
    3. Organization employee counter (`organization_employee_counters`) matches maximum issued employee code numbers.
    4. Row-level checksums on financial balances (`employee_salaries`, `payroll_runs`) match production snapshots.
- **Documentation & Audit Sign-Off:** Each restore rehearsal generates an automated execution report logged in the DevOps audit register. Recovery capabilities are marked "Certified" only after three consecutive successful monthly rehearsals.

### 8.4 Disaster Recovery Runbooks by Incident Scenario

```
+----------------------------------------------------------------------------------------------------+
|                                      DISASTER RECOVERY RUNBOOKS                                    |
+----------------------------------------------------------------------------------------------------+
| SCENARIO A: DATABASE HARDWARE FAILURE / REGIONAL CLOUD OUTAGE                                      |
| 1. Trigger automated failover to standby replica (or spin up PITR replacement instance).           |
| 2. Replay WAL logs to the latest available transaction boundary.                                   |
| 3. Update backend connection secret `DATABASE_URL` via secret manager.                             |
| 4. Rolling restart of Node.js/Express API cluster.                                                 |
| 5. Validate system health via `GET /api/v1/health` and verify sub-second DB response.               |
+----------------------------------------------------------------------------------------------------+
| SCENARIO B: ACCIDENTAL DATA DELETION OR CORRUPTION (E.G. ERRONEOUS ADMIN OPERATION)                |
| 1. Identify exact incident timestamp ($T_{\text{incident}}$) from `audit_logs`.                    |
| 2. Initiate PITR restore to target timestamp $T_{\text{restore}} = T_{\text{incident}} - 1\text{m}$|
|    into an auxiliary recovery database.                                                            |
| 3. Extract the corrupted or deleted table records from the recovery database.                      |
| 4. In a controlled maintenance transaction, insert/restore the missing records into production.    |
| 5. Replay any valid intervening audit logs recorded between $T_{\text{restore}}$ and present.      |
| 6. Log incident post-mortem in administrative security log.                                        |
+----------------------------------------------------------------------------------------------------+
| SCENARIO C: COMPROMISED DATABASE OR SUPABASE SERVICE-ROLE CREDENTIALS                              |
| 1. Emergency lockdown: Revoke leaked credentials immediately in Supabase Dashboard.                |
| 2. Generate new database passwords and new `SUPABASE_SERVICE_ROLE_KEY`.                            |
| 3. Terminate all active Supabase Auth sessions (`auth.sessions`) forcing global re-authentication. |
| 4. Deploy updated secret configuration to backend API cluster.                                     |
| 5. Inspect `audit_logs` and access logs for unauthorized read/write activity during leak window.   |
| 6. Notify Data Protection Officer and file incident report under DPDP compliance runbooks.         |
+----------------------------------------------------------------------------------------------------+
```
