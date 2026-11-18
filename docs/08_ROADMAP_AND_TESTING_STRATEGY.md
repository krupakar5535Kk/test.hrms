# Development Roadmap & Testing/Acceptance Strategy

**System Designation:** HRMS Phased Implementation & Verification Framework  
**Delivery Model:** Phased Milestone Delivery with Strict Quality Exit Gates  
**Testing Stack:** Jest / Vitest (Unit & Integration), Supertest (API), Playwright (E2E), PostgreSQL pgTAP  
**Document Version:** 1.7  
**PRD Reference:** PRD v1.9 Baseline (Incorporating Approved DEC-15 Option A, Amended DEC-01 Paid Lunch Policy, Paid Sundays & Public Holidays Model, and Approved DEC-14 Selfie Retention Ceiling)  

---

## 1. Phased Development Roadmap

The platform will be constructed in strict adherence to the six delivery phases established in PRD Section 23. No downstream phase begins until the preceding phase satisfies all acceptance criteria.

```
+----------------------------------------------------------------------------------------------------+
|                                    PHASED IMPLEMENTATION TIMELINE                                  |
+----------------------------------------------------------------------------------------------------+
| PHASE 0: SPECIFICATION & ARCHITECTURAL FOUNDATION (CURRENT MILESTONE)                             |
| • Finalize SRS, Database Schema, ERD, API specs, RBAC matrix, Security model, and RTM              |
| • Document gap analysis, business contradictions, and TBD resolution requests                      |
| • Exit Gate: Product Owner formal approval of specifications                                       |
+----------------------------------------------------------------------------------------------------+
| PHASE 1: SYSTEM FOUNDATION & EMPLOYEE ADMINISTRATION                                              |
| • Project scaffolding (React + Vite + Tailwind + Express + Supabase)                               |
| • Database migrations for core tables (`organizations`, `offices`, `users`, `employees`, `roles`)  |
| • Org Code + Mobile + Password auth, secure Admin link/QR + Mobile OTP activation (self-password) |
| • Auto-generating employee code sequence (`EMP001`, `EMP002`, ...)                                 |
| • Employee profile CRUD, departmental rosters, designation assignments, and exit workflows         |
| • Exit Gate: Automated RBAC and tenant data-isolation tests passing 100%                           |
+----------------------------------------------------------------------------------------------------+
| PHASE 2: SMART ATTENDANCE & BIOMETRIC VERIFICATION                                                 |
| • Geofence engine (Haversine distance calculation, $\le 30\text{m}$ accuracy gate; $100\text{m}$ baseline / **$50\text{m}$ proposed `PO-ATT-GEOFENCE-50M` pending PO approval**) |
| • Biometric Hexagonal Adapter (`IFaceVerificationProvider`) with mock and cloud AI connectors      |
| • Admin-supervised employee face enrollment workflow with quality threshold validation            |
| • Mobile PWA Check-In and Check-Out flows with live camera and liveness verification (mandatory at office for all staff) |
| • 3-attempt failure throttling and routing to `Verification Pending` Admin review queue            |
| • Sales Team Field Attendance Exception (`PO-ATT-FIELD-SALES` proposed pending PO approval; never auto-approved; Admin `APPROVE`/`REJECT` console) |
| • Admin manual punch insertion and Workflow B corrections with mandatory justification audit notes |
| • Exit Gate: Office & field attendance exception tests (`SUITE-SEC`, `SUITE-SESS`, `SUITE-FIELD`) pass on iOS Safari and Android Chrome |
+----------------------------------------------------------------------------------------------------+
| PHASE 3: LEAVE MANAGEMENT & CALENDARS                                                              |
| • Leave type configuration (`CL`, `SL`, `PL`, `LWP`) with administrative entitlement balances     |
| • Configurable `is_paid: false` policy flags (preserving legal compliance upgrade path)           |
| • Employee leave application workflow and Admin review/approval console                            |
| • Organization holiday calendar management and Sunday exclusion logic                              |
| • Exit Gate: Leave application lifecycle and zero-hour credit verification tests pass              |
+----------------------------------------------------------------------------------------------------+
| PHASE 4: PRECISION WORKING-HOUR & PAYROLL ENGINE                                                   |
| • Dynamic calendar-day monthly divisor ($D_{\text{month}} \times 8.0\text{ hrs}$)                  |
| • Paid lunch crediting (60m on working days) and automatic 8h credit for Sundays & public holidays  |
| • DEC-15 Approved Option A: Effective-date proration based on calendar dates in month               |
| • Post-18:00 extended hours approval at flat $1.0\times$ hourly rate                               |
| • Integer paise payroll calculation engine with 6-decimal minute rate precision                    |
| • Dual-key governance workflow: Admin preparation $\rightarrow$ Super Admin approval               |
| • Automatic PDF payslip generation and manual bank payment disbursement logging                    |
| • Exit Gate: Mathematical reconciliation tests pass across all 19 defined edge-case scenarios      |
+----------------------------------------------------------------------------------------------------+
| PHASE 5: REPORTING, DASHBOARDS & PRODUCTION RELEASE                                               |
| • Super Admin, Admin, and Employee dashboard analytics with Recharts                               |
| • Attendance register and payroll expenditure exports to Excel and PDF                             |
| • End-to-end security audit, DPDP consent verification, and penetration testing                    |
| • Automated backup and point-in-time recovery verification on Supabase                             |
| • Production deployment to Vercel (Frontend) and Cloud Provider (Backend)                         |
| • Exit Gate: Formal Production Readiness Review and sign-off                                       |
+----------------------------------------------------------------------------------------------------+
```

---

## 2. Comprehensive Acceptance Testing Matrix

The following test suites define the exact verification criteria required for each critical subsystem.

### 2.1 Working-Hour & Paid Lunch Test Suite (SUITE-CALC — Amended DEC-01 Baseline)
All scenarios enforce the **Amended DEC-01 Paid Lunch Formula**:  
$$\text{Payable Minutes} = \text{Approved Actual Working Minutes} + 60\text{ Paid Lunch Minutes}$$
$$\text{Payable Hours} = \text{Approved Actual Working Hours} + 1.0\text{ Paid Lunch Hour}$$

| Test ID | Scenario Description | Actual Working Time | Paid Lunch Credit | Total Payable Time | Expected Status | Pass Criteria |
|---|---|:---:|:---:|:---:|---|---|
| **TC-CALC-01** | Full standard day (7h actual + 1h lunch) | 7.0h (420m) | **1.0h (60m)** | **8.0h (480m)** | `Present` | Net exactly 480 mins (8.0 hrs) |
| **TC-CALC-02** | Partial day (6h actual + 1h lunch) | 6.0h (360m) | **1.0h (60m)** | **7.0h (420m)** | `Present` | Net exactly 420 mins (7.0 hrs) |
| **TC-CALC-03** | Partial day (5h actual + 1h lunch) | 5.0h (300m) | **1.0h (60m)** | **6.0h (360m)** | `Present` | Net exactly 360 mins (6.0 hrs) |
| **TC-CALC-04** | Partial day (4h actual + 1h lunch) | 4.0h (240m) | **1.0h (60m)** | **5.0h (300m)** | `Present` | Net exactly 300 mins (5.0 hrs) |
| **TC-CALC-05** | Partial day (3h actual + 1h lunch) | 3.0h (180m) | **1.0h (60m)** | **4.0h (240m)** | `Present` | Net exactly 240 mins (4.0 hrs) |
| **TC-CALC-06** | Extended hours (Admin approved) | 8.5h (510m) | **1.0h (60m)** | **9.5h (570m)** | `Present` | 90m post-18:00 credited at 1.0x |
| **TC-CALC-07** | Extended hours (Admin rejected) | 7.0h (420m) | **1.0h (60m)** | **8.0h (480m)** | `Present` | Post-18:00 time excluded (480m) |
| **TC-CALC-08** | Full Day Absence (0 actual work) | 0.0h (0m) | **0.0h (0m)** | **0.0h (0m)** | `Absent` | Proposed default credits 0m lunch on absence (`PO-ABSENCE-LUNCH` pending formal confirmation) |

*(Historical Note: The previous DEC-01 deduction algorithm deducting $\max(0, \min(T_{\text{out}}, 14:00) - \max(T_{\text{in}}, 13:00))$ is formally superseded).*

### 2.2 Attendance Grace Period & Penalty Integrity Suite (SUITE-GRACE)

| Test ID | Check-In Time | Check-Out Time | Late Flag? | Early Flag? | Salary Deduction Applied? | Pass Criteria |
|---|:---:|:---:|:---:|:---:|:---:|---|
| **TC-GRACE-01** | 10:09 AM | 6:01 PM | FALSE | FALSE | NONE | Grace period honored ($\le 10\text{ mins}$) |
| **TC-GRACE-02** | 10:11 AM | 6:00 PM | **TRUE** | FALSE | **NONE** (Only actual minutes paid) | No monetary fine applied |
| **TC-GRACE-03** | 10:00 AM | 5:51 PM | FALSE | FALSE | NONE | Grace period honored ($\ge 5:50\text{ PM}$) |
| **TC-GRACE-04** | 10:00 AM | 5:48 PM | FALSE | **TRUE** | **NONE** (Only actual minutes paid) | No monetary fine applied |

### 2.3 Biometric & GPS Security Suite (SUITE-SEC)

| Test ID | Test Vector | Input Parameters | Expected System Behavior | HTTP Status |
|---|---|---|---|:---:|
| **TC-SEC-01** | GPS Geofence Breach | Coordinates $150\text{m}$ from office (exceeds $100\text{m}$ baseline and proposed $50\text{m}$ `PO-ATT-GEOFENCE-50M` radius; also verify $65\text{m}$ rejection once $50\text{m}$ is approved) | Reject standard punch (applies to all employees including Sales Team at office); return distance error | `422 Unprocessable` |
| **TC-SEC-02** | Poor GPS Accuracy | Accuracy reported as $45\text{m}$ ($> 30\text{m}$) | Reject punch; request satellite lock retry | `422 Unprocessable` |
| **TC-SEC-03** | Face & Geofence Match Success | Valid live selfie (match $\ge 0.85$, liveness pass) AND within office geofence | Both checks pass $\rightarrow$ auto-approve & commit `attendance_event` | `200 OK` |
| **TC-SEC-04** | Face Match Failure (1-2) | Mismatch photo, attempt 1 | Return mismatch error, prompt attempt 2 | `422 Unprocessable` |
| **TC-SEC-05** | Face Failure Threshold (3) | Mismatch photo, attempt 3 | Enters `Verification Pending` (`PENDING_REVIEW`, `0` payable credit); requires Admin-supervised identity verification before crediting attendance | `200 OK` (Pending, 0 credit) |
| **TC-SEC-06** | Duplicate Check-In | Second Check-In with active session | Reject duplicate punch attempt | `409 Conflict` |
| **TC-SEC-07** | Check-Out Without Check-In | Check-Out attempted on empty day | Reject orphan check-out | `409 Conflict` |
| **TC-SEC-08** | Offline Sync Injection | Synchronized batch with client timestamp | Mark `is_offline_sync: true`, route to review | `200 OK` (Pending) |
| **TC-SEC-08B** | Suspected GPS Spoofing / Velocity Anomaly | Standard or field punch exhibiting impossible travel velocity or spoof telemetry | Reject or flag `is_spoof_suspected = true` per security rules; log security audit event | `422` / Flagged |
| **TC-SEC-09** | Horizontal Privilege Breach | Employee A requests Employee B payslip | PostgreSQL RLS blocks row; return 404/403 | `403 Forbidden` |
| **TC-SEC-10** | 30-Day Selfie Purge Ceiling | Worker runs against selfies with retention age older than configured retention (max 30d ceiling; retention-clock starting point between device timestamp and server receipt timestamp is an unresolved clarification) | Primary object purged; RAM/temp cleared; path set NULL; `retention_status = 'PURGED'`; `audit_logs` appended without image bytes; statutory attendance/wage records 100% intact | N/A (Worker) |
| **TC-SEC-11** | Legal Hold Purge Suspension | Worker encounters selfie past retention ceiling with `is_legal_hold = TRUE` | Worker skips deletion across all tiers; upon audited hold release, subsequent worker run purges object | N/A (Worker) |

### 2.3.1 Sales Team Field Attendance Exception Suite (`SUITE-FIELD` — Proposed Pending `PO-ATT-FIELD-SALES`)
*(Proposed Phase 2 verification suite validating isolation, zero auto-approval, evidence privacy, and DEC-02/payroll reconciliation once `PO-ATT-FIELD-SALES` is approved.)*

| Test ID | Test Vector | Input Parameters / Precondition | Expected System Behavior | HTTP Status |
|---|---|---|---|:---:|
| **TC-FIELD-01** | Non-Sales Employee Access Blocked | Standard employee calls `POST /attendance/field-requests` | Server rejects based on `departments.allow_field_attendance = FALSE` | `403 Forbidden` |
| **TC-FIELD-02** | Valid Sales Field Request Submission | Sales employee 15 km outside office submits explicit `CHECK_IN` (or `CHECK_OUT` with active `CHECK_IN`) with own live selfie + liveness + face match + GPS accuracy $12\text{m}$ + comment | Created strictly as `PENDING_REVIEW`; actual coords & `is_within_office_geofence = FALSE` retained; `attendance_days` NOT `Present` (`0` credit) | `201 Created` |
| **TC-FIELD-03** | Field GPS Accuracy Gate (> 30m) | Sales employee submits field request with accuracy $42\text{m}$ | Rejects request; instructs employee to retry GPS lock | `422 Unprocessable` |
| **TC-FIELD-04** | Missing / Blank Field Comment | Sales employee submits field request without sales/location comment | Validation failure; request rejected | `422 Unprocessable` |
| **TC-FIELD-05** | 3-Attempt Biometric Fail -> `Verification Pending` | Field submission fails liveness or exhausts 3 face mismatch attempts | Attempts 1–2 / bad liveness prompt retry (`422`); 3rd fail enters `Verification Pending` (`biometric_verified = FALSE`, `status = 'PENDING_REVIEW'`, `0` Present/payable credit) | `422` / `201` (Pending, 0 credit) |
| **TC-FIELD-05B** | Failed Biometric Approval Blocked | Admin attempts `APPROVE` on a field request with `biometric_verified = FALSE` or `is_liveness_verified = FALSE` | API (`422 BIOMETRIC_VERIFICATION_REQUIRED`) & DB `chk_field_req_approve_requires_biometrics` reject; requires Admin-supervised identity verification before credit | `422 Unprocessable` |
| **TC-FIELD-06** | Duplicate / Ordering Conflict Guard | Duplicate active/approved `(emp, date, requestType)` OR `CHECK_OUT` with no existing `CHECK_IN` punch/request | Partial unique index / `CHECK_OUT_WITHOUT_CHECK_IN` check rejects request | `409 Conflict` |
| **TC-FIELD-07** | Admin Approval Reconciles 1 Immutable Event | Admin approves verified `PENDING_REVIEW` field `CHECK_IN` (and separately `CHECK_OUT` only after `CHECK_IN` event exists) | Inserts exactly 1 `attendance_events` row (`is_field_attendance = TRUE`, `is_within_geofence = FALSE`, original timestamps/coords); updates `attendance_days` via standard calculation only; logs `audit_logs` | `200 OK` |
| **TC-FIELD-08** | Admin Rejection & Non-Absence Integrity | Admin rejects field request with mandatory reason while employee later completes office punch or holds approved leave | Request marked `REJECTED` with Admin ID & reason; 0 events added; day evaluated by existing rules (not forced `ABSENT`) | `200 OK` |
| **TC-FIELD-09** | Non-Admin Review Blocked | Sales employee calls `POST /attendance/field-requests/:id/review` | RBAC blocks self-approval | `403 Forbidden` |
| **TC-FIELD-10** | Private Selfie Storage & Signed URL | Inspect field request response vs Admin queue | No public URL exposed; Admin receives 15m `createSignedUrl` token; purge respects DEC-14 30d ceiling | `200 OK` (Admin only) |
| **TC-FIELD-11** | Closed Payroll Period Guard | Admin attempts approval of prior-month field request when `payroll_periods.is_closed = TRUE` | Transaction fails closed; no retroactive attendance mutation | `409 Conflict` |
| **TC-FIELD-12** | Full Field Day Uses Standard Calculation | Sales employee completes separate approved Field `CHECK_IN` & Field `CHECK_OUT` (each with own selfie, biometrics, GPS, comment) | `attendance_days` executes existing DEC-01 Paid Lunch + DEC-02 rules (`<= 1` pair, zero separate field formula or duplicate credit) | `200 OK` |

### 2.4 Single Daily Attendance Session & Admin Correction Suite (SUITE-SESS — DEC-02 Approved)
This suite verifies compliance with the approved **DEC-02 policy (Option A: One Check-In and One Check-Out Pair Per Employee Per Working Day)**, enforcing single working intervals ($\le 1$ pair; no forced punches; absence/leave/incomplete remain valid states), deterministic check-out validation precedence, Admin dual-workflow correction audit, and strict idempotency semantics:

| Test ID | Test Vector | Description / Input Condition | Expected System Behavior | HTTP Status | Pass Criteria |
|---|---|---|---|:---:|---|
| **TC-SESS-01** | First Check-In Success | Employee with no active session executes valid check-in | Creates `CHECK_IN` event; updates `first_check_in_at` | `200 OK` | Session opened; state = active |
| **TC-SESS-02** | First Check-Out Success | Employee with open check-in executes valid check-out | Creates `CHECK_OUT` event; computes DEC-01 lunch; closes day | `200 OK` | Day completed; payable minutes computed |
| **TC-SESS-03** | Duplicate Check-In Rejection | Second check-in attempted while session is active | Rejection (`ATTENDANCE_ALREADY_CHECKED_IN`); no second event created | `409 Conflict` | Exactly 1 check-in event in DB |
| **TC-SESS-04** | Check-Out Order: Completed Check | Second check-out attempted after day already closed | Priority 1 check triggers: Rejection (`ATTENDANCE_ALREADY_COMPLETED`) | `409 Conflict` | Exactly 1 check-out event; 0 extra minutes |
| **TC-SESS-05** | Check-In After Completed Day | Check-in attempted on day with existing checkout | Rejection (`ATTENDANCE_ALREADY_CHECKED_IN`); split shift blocked | `409 Conflict` | Day remains closed; 0 second session |
| **TC-SESS-06** | Check-Out Order: Missing Check-In | Check-out attempted on empty day (no checkout, no checkin) | Priority 1 passes; Priority 2 triggers: Rejection (`CHECK_OUT_WITHOUT_CHECK_IN`) | `409 Conflict` | Precedence verified: check-in absence caught |
| **TC-SESS-06B** | Unpaired Check-Out Exception | DB contains unpaired check-out (from exceptional Admin entry/legacy import) | Engine flags `requires_admin_review = true`; credits 0 payable minutes; no employee API exists | N/A (Engine) | Unpaired punch yields 0 pay until resolved |
| **TC-SESS-07** | Incomplete Attendance Handling | Check-in recorded but no checkout by day close | Flagged `requires_admin_review = true`; excluded from payable hours; punch not forced | N/A (EOD Cron) | Net payable minutes = 0 until resolved |
| **TC-SESS-08** | Admin Correction Workflow A | Admin creates missing checkout (Workflow A: missing punch) | Inserts `CHECK_OUT` in `attendance_events` with `is_manual_entry = true`, reason, and Admin ID | `200 OK` | Missing event created; net minutes recomputed |
| **TC-SESS-08B** | Admin Correction Workflow B | Admin corrects incorrect checkout timestamp (Workflow B: correction) | Updates effective timestamp on `attendance_days`; appends `attendance_corrections`; NO duplicate row | `200 OK` | `UNIQUE(attendance_day_id, event_type)` preserved |
| **TC-SESS-09** | Preservation of Original Raw Data | Inspect raw events after Workflow B correction | Original timestamps, raw coordinates, and selfies remain untouched | N/A (DB Query) | Original evidence rows 100% unaltered |
| **TC-SESS-10** | Correction Audit Trail | Inspect `attendance_corrections` after update | Contains `previous_state`, `updated_state`, Admin ID, timestamp, reason | N/A (DB Query) | Complete immutable audit record present |
| **TC-SESS-11A** | Idempotency Replay (Same Key + Identical Payload) | Network retry with same Idempotency-Key and identical payload | Returns original cached/stored HTTP response without re-executing logic or creating duplicates | `200 OK` / `201 Created` | Exactly 1 event in DB; identical response |
| **TC-SESS-11B** | Idempotency Mismatch (Same Key + Diff Payload) | Client reuses same Idempotency-Key with different payload | Hash mismatch detected; rejected without processing | `422 Unprocessable` | Error `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH` |
| **TC-SESS-11C** | Duplicate Action (Diff Key + Duplicate Action) | Client sends duplicate punch with fresh Idempotency-Key | Business rule check blocks second punch | `409 Conflict` | Error `ATTENDANCE_ALREADY_CHECKED_IN` / `COMPLETED` |
| **TC-SESS-12** | Paid Lunch Compatibility | Check-out on single daily interval (10:00-18:00) | 60 mins paid lunch credited; standard day yields 480 mins (8.0h) | `200 OK` | Net payable = exactly 480 mins (8.0h) |
| **TC-SESS-13** | Payroll Valid Minutes Only | Payroll batch compiled for employee with incomplete punch | Engine excludes unverified/incomplete days from payable hours | `200 OK` | Unpaired day contributes 0 payable paise |
| **TC-SESS-14** | Duplicate Minutes Prevention | Rapid double-checkout attempted over network | Only the first request calculates payable minutes; second rejected | `409 Conflict` | Total payable minutes cannot exceed interval |

### 2.5 Mathematical Payroll Reconciliation Suite (SUITE-PAY — Amended DEC-PAY Baseline)
All test cases evaluate payroll using the confirmed calendar-day monthly distribution ($D_{\text{month}} \times 8.0\text{h}$) and accumulated earnings formula:
$$\text{Gross Earned (Paise)} = \text{ROUND\_HALF\_UP}\left( \sum_{k} \frac{\sum M_{\text{payable}, k} \times S_{\text{ref}, k, \text{paise}}}{D_{\text{month}} \times 480} \right)$$
$$\text{Net Salary (Paise)} = \text{Gross Earned (Paise)} + \sum \text{Allowances} + \sum \text{Adjustments} - \sum \text{Deductions}$$
*(Note: Monetary amounts maintain exact 64-bit integer paise precision [`BIGINT`]. Derived rates may be stored as `NUMERIC(14,6)` for fractional reporting, but `NUMERIC(14,6)` is fractional decimal precision, not exact rational arithmetic. Authoritative earnings calculation evaluates exact rational numerator/denominator arithmetic: $\text{segment\_earnings\_paise} = \frac{\sum M_{\text{payable}} \times S_{\text{ref, paise}}}{D_{\text{month}} \times 480}$, summed unrounded and rounded once to integer paise. Calendar days are strictly validated against the actual payroll period without static 30-day defaults. Whole-rupee rounding of net pay is an open Product Owner decision under `DEC-05: Net Salary Rounding Rule`).*

| Test ID | Base Monthly Reference | Month Days ($D_{\text{month}}$) | Total Month Minutes | Daily Rate (INR) | Total Payable Minutes | Expected Gross / Net (INR) | Pass Criteria |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| **TC-PAY-01** | ₹20,000.00 | 30 days | 14,400m | ₹666.67 | 14,400 mins (Full Month) | **₹20,000.00** | Exact full-month match ($S_{\text{ref}}$) |
| **TC-PAY-02** | ₹20,000.00 | 30 days | 14,400m | ₹666.67 | 7,200 mins (Half Month) | **₹10,000.00** | Exact proportional half-month |
| **TC-PAY-03** | ₹20,000.00 | 30 days | 14,400m | ₹666.67 | 13,920 mins (1 Day Absent) | **₹19,333.33** | Half-up paisa rounding match |
| **TC-PAY-04** | ₹30,000.00 | 31 days | 14,880m | ₹967.74 | 0 mins (All Absent) | **₹0.00** | Zero work produces zero salary |
| **TC-PAY-05** | ₹20,000.00 | 30 days | 14,400m | ₹666.67 | DEC-15 Mid-Month Proration | **₹22,500.00** | 15d @ ₹20k + 15d @ ₹25k |
| **TC-PAY-06** | Dual Approval Gate | - | - | - | Admin approves batch | **REJECTED (403)** | Only Super Admin can approve |
| **TC-PAY-07** | Payslip Immutability | - | - | - | Edit approved payroll run | **REJECTED (409)** | Approved batch is immutable |

#### 2.5.1 Multi-Month Exact Precision Reconciliation Suite (SUITE-PAYROLL-PRECISION)
This suite verifies that the accumulated earnings formula $\text{ROUND\_HALF\_UP}\left( \sum_{k} \frac{\sum M_{\text{payable}, k} \times S_{\text{ref}, k, \text{paise}}}{D_{\text{month}} \times 480} \right)$ completely eliminates minute-rate and segment-level truncation drift and produces exact reference salary reconciliation across all calendar month lengths (28, 29, 30, and 31 days). It explicitly verifies that intermediate segment-level rounding is prohibited:

| Test ID | Month Type / Days ($D_{\text{month}}$) | Reference Salary ($S_{\text{ref}}$) | Total Month Minutes ($D_{\text{month}} \times 480$) | Intermediate 6-Dec Minute Rate (Paise) | Naive 6-Dec Rounded Result (INR) | Accumulated Formula Gross (Paise) | Final Reconciled Amount (INR) | Truncation Drift Under Accumulated Formula |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **TC-PREC-28** | 28 days (Feb non-leap) | ₹20,000.00 (2,000,000 p) | 13,440 mins | 148.809524 | ₹20,000.000026 | **2,000,000** | **₹20,000.00** | **0.000000 paise (Exact)** |
| **TC-PREC-29** | 29 days (Feb leap year) | ₹20,000.00 (2,000,000 p) | 13,920 mins | 143.678161 | ₹20,000.000011 | **2,000,000** | **₹20,000.00** | **0.000000 paise (Exact)** |
| **TC-PREC-30** | 30 days (Apr, Jun, Sep, Nov) | ₹20,000.00 (2,000,000 p) | 14,400 mins | 138.888889 | ₹20,000.02 (drift!) | **2,000,000** | **₹20,000.00** | **0.000000 paise (Exact)** |
| **TC-PREC-31** | 31 days (Jan, Mar, May, etc.) | ₹20,000.00 (2,000,000 p) | 14,880 mins | 134.408602 | ₹19,999.999976 | **2,000,000** | **₹20,000.00** | **0.000000 paise (Exact)** |
| **TC-PREC-PRORATE** | 30 days (DEC-15 Day 16 Proration) | ₹20k $\rightarrow$ ₹25k | $7,200\text{m} + 7,200\text{m}$ | N/A (Segmented) | ₹22,500.015 (drift!) | **2,250,000** | **₹22,500.00** | **0.000000 paise (Exact)** |
| **TC-PREC-MULTI-SEG** | 30 days (Two Salary Changes: 3 Segments: 10d @ ₹20k, 10d @ ₹23k, 10d @ ₹24k) | ₹20k $\rightarrow$ ₹23k $\rightarrow$ ₹24k | $4,800\text{m} + 4,800\text{m} + 4,800\text{m}$ | N/A (Unrounded Segments) | If segments rounded independently: ₹22,333.34 (+1p error!) | **2,233,333** (Unrounded sum $= 2,233,333.33\text{p}$) | **₹22,333.33** | **0.000000 paise (Exact)** |
| **TC-PREC-PARTIAL** | 30 days (1 Full Day Absent) | ₹20,000.00 (2,000,000 p) | 13,920 mins | 138.888889 | ₹19,333.35 (drift!) | **1,933,333** | **₹19,333.33** | **0.000000 paise (Exact)** |

#### 2.5.2 Database-Level Calendar-Day Referential Integrity Test Suite (SUITE-DB-CALENDAR-INTEGRITY)

> [!IMPORTANT]
> **PROPOSED TEST SPECIFICATIONS — ARCHITECTURE REVIEW ONLY (NOT EXECUTED):**
> The following test vectors are formal database specification tests designed to verify that the composite foreign key architecture physically enforces tenant boundaries and denominator integrity under PostgreSQL engine semantics. Phase B remains strictly locked; zero tests have been executed.

##### Execution & Isolation Protocol (PostgreSQL Savepoint Pattern):
In PostgreSQL, any unhandled constraint violation aborts the entire transaction (`SQLSTATE 25P02: current transaction is aborted, commands ignored until end of transaction block`). To test multiple expected-failure statements within an automated test harness without aborting subsequent test vectors, each test statement must be wrapped in its own `SAVEPOINT`, with immediate rollback upon capturing the expected SQLSTATE:

```sql
BEGIN;

-- 1. Insert Pre-requisite Fixtures (Fixtures 1 to 8)

-- 2. Execute Each Test Inside an Isolated Savepoint Block:
--    SAVEPOINT sp_<test_id>;
--    -- Execute statement expecting failure
--    -- Assert caught SQLSTATE matches expected code
--    ROLLBACK TO SAVEPOINT sp_<test_id>;

-- 3. Outer Transaction Teardown:
ROLLBACK; -- Guaranteed zero persistence and zero side effects
```

##### Pre-requisite Test Fixtures (Isolated Baseline):
```sql
-- Fixture 1: Organization A
INSERT INTO organizations (id, name, legal_name, contact_phone, contact_email, address)
VALUES ('11111111-1111-1111-1111-111111111111', 'Acme Corp A', 'Acme Corporation Pvt Ltd', '+919876543210', 'admin@acme.com', '123 Main St, Hyderabad');

-- Fixture 2: Organization B (Cross-Tenant Verification)
INSERT INTO organizations (id, name, legal_name, contact_phone, contact_email, address)
VALUES ('22222222-2222-2222-2222-222222222222', 'Beta Corp B', 'Beta Corporation Pvt Ltd', '+919876543211', 'admin@beta.com', '456 Side St, Hyderabad');

-- Fixture 3: Admin User in Org A
INSERT INTO users (id, organization_id, email, full_name, phone_number, is_active)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'admin.acme@auth.hrms.internal', 'Admin User A', '+919876543210', true);

-- Fixture 4: Admin User in Org B
INSERT INTO users (id, organization_id, email, full_name, phone_number, is_active)
VALUES ('bbbbbbbb-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'admin.beta@auth.hrms.internal', 'Admin User B', '+919876543211', true);

-- Fixture 5: Employee in Org A
INSERT INTO employees (id, organization_id, user_id, employee_code, first_name, last_name, gender, date_of_birth, date_of_joining, employment_status)
VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'EMP001', 'Rahul', 'Sharma', 'MALE', '1990-01-01', '2025-01-01', 'CONFIRMED');

-- Fixture 6: Employee in Org B
INSERT INTO employees (id, organization_id, user_id, employee_code, first_name, last_name, gender, date_of_birth, date_of_joining, employment_status)
VALUES ('ffffffff-ffff-ffff-ffff-ffffffffffff', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-1111-1111-1111-111111111111', 'EMP002', 'Suresh', 'Verma', 'MALE', '1992-02-02', '2025-02-01', 'CONFIRMED');

-- Fixture 7: Valid Period in Org A (February 2026: 28 Days)
INSERT INTO payroll_periods (id, organization_id, year, month, start_date, end_date, calendar_days, scheduled_working_days, standard_monthly_hours, standard_monthly_minutes)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 2026, 2, '2026-02-01', '2026-02-28', 28, 24, 224.0, 13440);

-- Fixture 8: Valid Run in Org A (matching Period A with 28 Days)
INSERT INTO payroll_runs (id, organization_id, payroll_period_id, calendar_days, prepared_by, status, total_gross_paise, total_deductions_paise, total_net_paise)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 28, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'DRAFT', 0, 0, 0);
```

##### Automated Test Vectors & Complete SQL Specifications:
| Test ID | Target Table & Operation | Test Vector / Attack Scenario | Expected Engine Mechanism | Expected SQLSTATE / Constraint | Pass Criteria |
|---|---|---|---|:---:|---|
| **TC-DB-CAL-01** | `payroll_periods` INSERT | Insert period for `ORG_A` with non-colliding year/month (`2027, 2`), explicit ID, `start_date = 2027-02-01`, `end_date = 2027-02-28`, but setting `calendar_days = 30` | Intra-row CHECK constraint `chk_payroll_periods_calendar_days_exact` | `SQLSTATE 23514` (`check_violation`) | Aborts immediately; period calendar_days must strictly match date span; zero collision with Fixture 7 |
| **TC-DB-CAL-02** | `payroll_runs` INSERT | Insert run for `ORG_A` referencing 28-day Feb period (`PERIOD_A`), but setting `calendar_days = 30` (all other fields valid) | Composite FK `fk_payroll_runs_period_tenant_calendar` on `(organization_id, payroll_period_id, calendar_days)` | `SQLSTATE 23503` (`foreign_key_violation`) | Aborts immediately; run cannot deviate from parent period calendar_days |
| **TC-DB-CAL-03** | `payroll_items` INSERT | Insert line item for `ORG_A` referencing 28-day Feb run (`RUN_A`), but setting `calendar_days = 31` (all NOT NULL fields valid) | Composite FK `fk_payroll_items_run_tenant_calendar` on `(organization_id, payroll_run_id, calendar_days)` | `SQLSTATE 23503` (`foreign_key_violation`) | Aborts immediately; item denominator cannot deviate from run or period |
| **TC-DB-CAL-04** | `payroll_periods` UPDATE | Alter `end_date = 2026-03-01` and `calendar_days = 29` simultaneously on `PERIOD_A` (preserving exact date-span check) while dependent `RUN_A` exists | Foreign key `ON UPDATE RESTRICT` on child composite foreign key `fk_payroll_runs_period_tenant_calendar` | `SQLSTATE 23503` (`foreign_key_violation`) | Aborts immediately; period calendar_days immutable while active runs/items exist |
| **TC-DB-CAL-05** | `payroll_runs` INSERT | Attempt cross-tenant reference: Insert run for `ORG_B` referencing `PERIOD_A` of `ORG_A`, with matching `calendar_days = 28` | Composite FK `fk_payroll_runs_period_tenant_calendar` on `(organization_id, payroll_period_id, calendar_days)` | `SQLSTATE 23503` (`foreign_key_violation`) | Aborts immediately; cross-tenant run-to-period reference physically blocked |
| **TC-DB-CAL-06** | `payroll_items` INSERT | Attempt cross-tenant reference: Insert item for `ORG_B` referencing `RUN_A` of `ORG_A`, with matching `calendar_days = 28` | Composite FK `fk_payroll_items_run_tenant_calendar` on `(organization_id, payroll_run_id, calendar_days)` | `SQLSTATE 23503` (`foreign_key_violation`) | Aborts immediately; cross-tenant item-to-run reference physically blocked |

```sql
-- COMPLETE PROPOSED EXECUTABLE SQL STATEMENTS (SPECIFICATION ONLY):

-- TC-DB-CAL-01: Period Date Span Check (Isolated via Savepoint)
-- Uses year 2027 to prevent UNIQUE(organization_id, year, month) collision with Fixture 7.
SAVEPOINT sp_tc_db_cal_01;
INSERT INTO payroll_periods (
    id, organization_id, year, month, start_date, end_date, calendar_days,
    scheduled_working_days, standard_monthly_hours, standard_monthly_minutes
) VALUES (
    'bbbbbbbb-2027-0200-0000-000000000001', '11111111-1111-1111-1111-111111111111',
    2027, 2, '2027-02-01', '2027-02-28', 30, -- Mismatch: 28-day date span vs 30 calendar_days
    24, 224.0, 13440
);
-- EXPECTED: SQLSTATE 23514 (check_violation on chk_payroll_periods_calendar_days_exact)
ROLLBACK TO SAVEPOINT sp_tc_db_cal_01;

-- TC-DB-CAL-02: Run Composite FK Denominator Mismatch Rejection
SAVEPOINT sp_tc_db_cal_02;
INSERT INTO payroll_runs (
    organization_id, payroll_period_id, calendar_days, prepared_by, status,
    total_gross_paise, total_deductions_paise, total_net_paise
) VALUES (
    '11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 30,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'DRAFT', 0, 0, 0
);
-- EXPECTED: SQLSTATE 23503 (foreign_key_violation on fk_payroll_runs_period_tenant_calendar)
ROLLBACK TO SAVEPOINT sp_tc_db_cal_02;

-- TC-DB-CAL-03: Item Composite FK Denominator Mismatch Rejection
SAVEPOINT sp_tc_db_cal_03;
INSERT INTO payroll_items (
    organization_id, payroll_run_id, employee_id, calendar_days,
    monthly_salary_reference_paise, standard_scheduled_minutes, minute_rate_paise,
    daily_rate_paise, hourly_rate_paise, approved_payable_minutes,
    actual_worked_minutes, approved_actual_worked_minutes, paid_lunch_minutes,
    paid_sunday_minutes, paid_holiday_minutes, earned_salary_paise,
    total_allowances_paise, total_adjustments_paise, total_deductions_paise, net_salary_paise
) VALUES (
    '11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 31,
    2000000, 13440, 148.809524, 71428.571429, 8928.571429, 13440,
    11760, 11760, 1680, 0, 0, 2000000, 0, 0, 0, 2000000
);
-- EXPECTED: SQLSTATE 23503 (foreign_key_violation on fk_payroll_items_run_tenant_calendar)
ROLLBACK TO SAVEPOINT sp_tc_db_cal_03;

-- TC-DB-CAL-04: Denominator Immutability under Active References
-- Both date span and calendar_days updated together (2026-03-01 - 2026-02-01 + 1 = 29 days),
-- passing intra-row check constraint but failing on foreign key ON UPDATE RESTRICT.
SAVEPOINT sp_tc_db_cal_04;
UPDATE payroll_periods
SET end_date = '2026-03-01',
    calendar_days = 29
WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
-- EXPECTED: SQLSTATE 23503 (foreign_key_violation on fk_payroll_runs_period_tenant_calendar under ON UPDATE RESTRICT)
ROLLBACK TO SAVEPOINT sp_tc_db_cal_04;

-- TC-DB-CAL-05: Cross-Tenant Reference Rejection on payroll_runs
SAVEPOINT sp_tc_db_cal_05;
INSERT INTO payroll_runs (
    organization_id, payroll_period_id, calendar_days, prepared_by, status,
    total_gross_paise, total_deductions_paise, total_net_paise
) VALUES (
    '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 28,
    'bbbbbbbb-1111-1111-1111-111111111111', 'DRAFT', 0, 0, 0
);
-- EXPECTED: SQLSTATE 23503 (foreign_key_violation on fk_payroll_runs_period_tenant_calendar)
ROLLBACK TO SAVEPOINT sp_tc_db_cal_05;

-- TC-DB-CAL-06: Cross-Tenant Reference Rejection on payroll_items
-- Supplies valid ORG_B employee (EMP_B) to pass fk_payroll_items_org_emp, isolating the run FK.
SAVEPOINT sp_tc_db_cal_06;
INSERT INTO payroll_items (
    organization_id, payroll_run_id, employee_id, calendar_days,
    monthly_salary_reference_paise, standard_scheduled_minutes, minute_rate_paise,
    daily_rate_paise, hourly_rate_paise, approved_payable_minutes,
    actual_worked_minutes, approved_actual_worked_minutes, paid_lunch_minutes,
    paid_sunday_minutes, paid_holiday_minutes, earned_salary_paise,
    total_allowances_paise, total_adjustments_paise, total_deductions_paise, net_salary_paise
) VALUES (
    '22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'ffffffff-ffff-ffff-ffff-ffffffffffff', 28,
    2000000, 13440, 148.809524, 71428.571429, 8928.571429, 13440,
    11760, 11760, 1680, 0, 0, 2000000, 0, 0, 0, 2000000
);
-- EXPECTED: SQLSTATE 23503 (foreign_key_violation on fk_payroll_items_run_tenant_calendar)
ROLLBACK TO SAVEPOINT sp_tc_db_cal_06;
```

### 2.6 Automated Multi-Tenant Isolation Testing Suite (SUITE-TENANT-ISOLATION)
Automated integration tests run on every pull request to prove that cross-tenant access is structurally impossible across all modules, verifying RLS policies, closed-ring foreign keys, and server-side tenant derivation:

| Test ID | Module Tested | Test Vector / Attack Scenario | Expected System Behavior | HTTP Status | Pass Criteria |
|---|---|---|---|:---:|---|
| **TC-TEN-01** | Employees | User of Org A requests `GET /api/v1/employees/:id_of_org_b` | RLS blocks visibility; returns 404 | `404 Not Found` | Org B employee data never leaked |
| **TC-TEN-02** | Employees | Admin of Org A sends `PATCH /api/v1/employees/:id_of_org_b` with update payload | Zero rows affected; returns 404 | `404 Not Found` | Cross-tenant mutation rejected |
| **TC-TEN-03** | Employees | Admin of Org A posts employee with body `{ "organization_id": "ORG_B_UUID" }` | Server overrides payload with Org A ID derived from token | `201 Created` (in Org A) | Payload injection neutralized |
| **TC-TEN-04** | Attendance | Employee of Org A attempts check-in at Office ID of Org B | Composite FK `fk_emp_office_tenant` rejects | `422 Unprocessable` | Cross-tenant office reference blocked |
| **TC-TEN-05** | Attendance | Admin of Org A requests attendance reviews for Org B employee | RLS filters review list to Org A only | `200 OK` (Empty list) | Cross-tenant queue isolation |
| **TC-TEN-06** | Attendance | Admin of Org A attempts attendance correction on Org B attendance day | RLS prevents row update; 0 rows modified | `404 Not Found` | Cross-tenant correction blocked |
| **TC-TEN-07** | Payroll | Admin of Org A requests `GET /api/v1/payroll/runs/:id_of_org_b` | RLS blocks row visibility | `404 Not Found` | Payroll run isolation verified |
| **TC-TEN-08** | Payroll | Super Admin of Org A attempts to approve payroll run of Org B | RLS blocks update; returns 404/403 | `404 Not Found` | Cross-tenant approval prevented |
| **TC-TEN-09** | Payslips | Employee of Org A attempts `GET /api/v1/payslips/:id_of_org_b/download` | RLS blocks row; signed URL not issued | `404 Not Found` | Payslip document isolation verified |
| **TC-TEN-10** | Documents | User of Org A attempts signed URL generation for Org B storage path | Path validation blocks cross-tenant prefix | `403 Forbidden` | Storage tenant traversal blocked |
| **TC-TEN-11** | Reports | Admin of Org A triggers `/reports/attendance` with Org B employee filter | Aggregation includes 0 records from Org B | `200 OK` (0 matching) | Aggregation tenant isolation verified |
| **TC-TEN-12** | Database Query | Direct query executed on connection with missing `SET LOCAL app.current_org_id` | RLS policy defaults to empty UUID; returns 0 rows | Empty Result Set | Fail-closed default RLS verified |
| **TC-TEN-13** | Field Attendance *(Proposed)* | Org A user/Admin attempts access or review on Org B `field_attendance_requests` or field selfie path | `FORCE RLS` + closed-ring FKs + signed-URL prefix check block access | `403` / `404 Not Found` | Cross-tenant field request isolation verified |
| **TC-TEN-14** | Auth Broker Session Context *(Task `2.2B.9C` / `2.2H`)* | Raw `hrms_app_user` spoofs `SET LOCAL app.current_org_id` / `app.current_user_id` to victim employee / `SUPER_ADMIN`, replays `p_tx_proof` (same TX, rolled-back TX, new TX), mutates `op`/`target_id`, replays OTP revocation within 60s, or directly reads `context_signing_keys` (`T1`–`T15` in `09_AUTHENTICATION_BROKER_ARCHITECTURE.md` §9.6.8) | `hrms_context_verifier` (`assert_verified_tx_context`) + `password_reset_otps.sessions_revoked_at` reject every forged, spoofed, mismatched, expired, or replayed context fail-closed | `SQLSTATE 42501` (`insufficient_privilege`) | Zero GUC impersonation, replay, or key disclosure across all 11 `hrms_session_manager` functions |

### 2.7 Append-Only Audit Trail Verification Suite (SUITE-AUDIT)
This suite verifies that the `audit_logs` subsystem is completely immutable, comprehensive, and tamper-evident across all administrative actions, testing both role-level permission revokes and trigger defenses:

| Test ID | Test Vector | Description / Input Condition | Expected System Behavior | Result / Status | Pass Criteria |
|---|---|---|---|:---:|---|
| **TC-AUD-01** | Role Permission: Block UPDATE | Runtime application role `hrms_app_user` attempts `UPDATE audit_logs SET action = 'tampered'` | PostgreSQL query planner halts execution; permission denied | `SQLSTATE 42501` (insufficient_privilege) | Role-level mutation blocked; 0 rows modified |
| **TC-AUD-02** | Role Permission: Block DELETE | Runtime application role `hrms_app_user` attempts `DELETE FROM audit_logs WHERE id = ...` | PostgreSQL query planner halts execution; permission denied | `SQLSTATE 42501` (insufficient_privilege) | Role-level deletion blocked; 0 rows deleted |
| **TC-AUD-02B** | Trigger Defense-in-Depth | Privileged/owner connection in test harness attempts `DELETE FROM audit_logs` | Trigger `trg_audit_logs_no_mutation` intercepts statement and raises exception | `SQLSTATE 42501` (Trigger Abort) | Statement and enclosing transaction aborted |
| **TC-AUD-03** | Complete Payload Capture | Admin updates employee salary, approves leave, and executes attendance correction | System appends audit rows with mandatory `actor_user_id`, `actor_role`, `target_table`, `payload_before`, `payload_after`, `reason`, `ip_address` | `200 OK` (Logged) | `payload_before` and `payload_after` diff present and accurate |
| **TC-AUD-04** | Super Admin Action Coverage | Super Admin performs payroll final approval, payroll reversal, or tenant role change | Mandatory audit log record generated with role `SUPER_ADMIN`, full payload capture, and justification reason | `200 OK` (Logged) | Super Admin actions fully audited without exception |

### 2.8 Disaster Recovery & Backup Verification Suite (SUITE-DR)
This suite verifies database resilience, backup integrity, point-in-time recovery capabilities, and disaster recovery SLA adherence in staging/sandbox environments. *(Note: Recovery Point Objective $\le 1\text{ hour}$ and Recovery Time Objective $\le 4\text{ hours}$ are Engineering Design Targets pending benchmark validation upon subscribing to Supabase Pro with PITR add-on)*:

| Test ID | Test Vector | Description / Input Condition | Expected System Behavior | Target Metric | Pass Criteria |
|---|---|---|---|:---:|---|
| **TC-DR-01** | Monthly Sandbox Restore Rehearsal | Automated scheduled CI/CD job restores latest production base snapshot into isolated sandbox database | Full database restored; relational integrity verified; table counts match production telemetry; financial sums match exactly | Integrity Check Pass | 100% schema match; 0 foreign key or counter mismatches |
| **TC-DR-02** | Continuous WAL PITR Rewind Simulation | Simulate catastrophic data corruption at $T_0$; execute PITR restore to $T_0 - 60\text{ seconds}$ (Requires Pro + PITR Add-on) | Database restored to exact second prior to corruption event; transactions replayed successfully | $\text{RPO} \le 1\text{ hour}$ (Design Target; actual $\le 5\text{m}$) | Zero committed transaction loss prior to rollback boundary |
| **TC-DR-03** | Failover & Cold Disaster Recovery Test | Simulate primary host total outage; provision standby database, apply WAL archives, and restart API cluster | Standby database online; application health checks pass; API endpoints resume servicing requests | $\text{RTO} \le 4\text{ hours}$ (Design Target) | System fully operational within 4 hours target window |

---

## 3. Phase Exit Gates & Verification Sign-Off Matrix

| Phase | Milestone Name | Mandatory Verification Suites | Required Pass Rate | Exit Gate Approver |
|---|---|---|:---:|---|
| **Phase 0** | Architecture & Specifications | PRD, SRS, ERD, API Specs, Security Model, RTM Review | 100% | Product Owner / Lead Architect |
| **Phase 1** | Foundation & Employee Admin | `SUITE-TENANT-ISOLATION`, `SUITE-AUDIT`, RBAC Matrix | 100% | Lead Architect / Tech Lead |
| **Phase 2** | Smart Attendance & Biometrics | `SUITE-CALC`, `SUITE-GRACE`, `SUITE-SEC`, `SUITE-FIELD` *(proposed)*, `SUITE-SESS` | 100% | QA Lead / Tech Lead |
| **Phase 3** | Leave & Holiday Management | Leave balance integrity, zero-hour payroll impact tests | 100% | QA Lead / Product Owner |
| **Phase 4** | Working-Hour & Payroll Engine | `SUITE-CALC`, `SUITE-PAY`, Dual-Key Approval Gate | 100% | Finance Lead / Product Owner |
| **Phase 5** | Production Release & Audits | `SUITE-DR`, E2E Security Audit, DPDP Verification | 100% | Security Lead / Product Owner |

---

## 4. Implementation Sequencing & Decision Dependency Matrix

To ensure that development progress is not artificially blocked by later-phase decisions, all open architectural items are classified into strict dependency categories:

### 4.1 Category A: Required Before Authentication Implementation (BLOCKS Task 1.1)
*These decisions directly govern core login payloads and session schemas and must be decided before writing Task 1.1 authentication code:*
- **DEC-13 (Login Tenant Resolution Conflict):** Resolve whether login payload requires Organization Code + Phone Number + Password (`POST /api/v1/auth/login`) [Option A, Recommended] OR phone + password with tenant disambiguation prompt [Option B].  
  *(GENUINELY BLOCKS Task 1.1 Auth Implementation).*

### 4.2 Category B: Required Before Relevant Module Implementation (DOES NOT Block Task 1.1)
*These decisions govern specific downstream functional modules and do not block project scaffolding, employee administration, or core database setup:*
- **DEC-07 (Admin MFA Mechanism):** Required before Super Admin/Admin login hardening in Phase 1/Phase 2 (scaffolding proceeds with standard auth).
- **DEC-03 (Biometric Provider Selection):** Required before deploying live biometric matching in Phase 2 (Phase 1 uses local mock adapter).
- **DEC-04 (Biometric Retention & Legal Hold Policies):** Required before deploying biometric storage in Phase 2.
- **DEC-06 (Unauthorized Absence Alert Threshold):** Required before activating EOD attendance cron in Phase 2/Phase 3.
- **DEC-10 (Notification Provider Selection):** Required before live transactional SMS OTP dispatch for approved `PO-03` password recovery and before external SMS/Email alerts in Phase 2/Phase 3 (dev/local environments use mock/console sinks).
- **DEC-08 (Leave Quota Policy Values):** Required before leave balance allocation in Phase 3.
- **DEC-05 (Net Salary Rounding Rule):** Required before payroll mathematical engine implementation in Phase 4.
- **DEC-14 (Daily Attendance Selfie Retention — Strict 30-Day Ceiling):** Required before Phase 2 biometric storage and retention worker implementation. Defines strict 30-day maximum ceiling, multi-tier deletion coverage (primary, server buffers, backup expiry, third-party provider), legal hold suspension, decoupled differentiated statutory schedules (employment registers 3y, wage registers 3y, tax ledgers 6–7y marked for legal verification), SHA-256 linkability classification, and audit logging without image bytes. Applies equally to standard and field attendance selfies. The precise retention-clock starting point (device capture timestamp vs. trusted server receipt timestamp) is an unresolved policy and architectural clarification. Subject to Indian legal review. Does not block Task 1.1.
- **`PO-ATT-GEOFENCE-50M` (Proposed Standard Office Geofence Radius — 50m):** Required before Phase 2 geofence enforcement; proposes tightening standard office radius from the `100m` legacy baseline to **`50 metres`** (keeping $\le 30\text{m}$ GPS accuracy gate) pending formal PO approval. Does not block Phase 1 / Task 1.1.
- **`PO-ATT-FIELD-SALES` (Sales Team Field Attendance Exception):** Required before Phase 2 field attendance exception rollout; enforces DEC-02 explicit `CHECK_IN`/`CHECK_OUT` field requests (`<= 1` pair/day, independent selfie + passing face/liveness + field GPS $\le 30\text{m}$ + comment), 3-attempt `Verification Pending` (0 credit; Admin approval blocked on failed biometrics pending Admin-supervised identity verification), strict `PENDING_REVIEW`, independent Admin `APPROVE`/`REJECT` creating 1 immutable `attendance_events` row, and single standard `attendance_days`/payroll calculation pending formal PO sign-off. Does not block Phase 1 / Task 1.1.

### 4.3 Category C: Required Before Production Deployment (DOES NOT Block Development)
*These decisions govern infrastructure subscriptions and legal compliance and do not block any coding milestone:*
- **DEC-11 (Backend Production Cloud Hosting Provider):** Required before production deployment in Phase 5 (development uses local Node.js environment).
- **DEC-12 (Disaster Recovery SLA Targets & Supabase PITR Subscription):** Required before Production Readiness Review in Phase 5; governs whether client subscribes to Supabase Pro with PITR add-on.
- **LEG-01 to LEG-04 (Statutory Legal Reviews):** Legal hold points on zero-pay leave, biometric notices, demographic minimization, and statutory retention periods. Code implements configurable policy flags without hardcoding unverified legal assumptions.

