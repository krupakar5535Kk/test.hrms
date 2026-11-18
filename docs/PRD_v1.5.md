# PRODUCT REQUIREMENTS DOCUMENT

## HRMS + SMART ATTENDANCE + PAYROLL

**Current Baseline:** Version 1.5  
**Date:** 2026-11-07  
**Status:** Approved Requirements Baseline (Updated with Approved DEC-01 Lunch Clipping & Approved DEC-02 Single Daily Attendance Pair)  
**Historical Baselines:** 
- Version 1.3 (Initial Product Discovery Baseline)
- Version 1.4 (Approved DEC-01: Exact Lunch Window Intersection Clipping)  
**Initial Scale:** Approximately 10 employees • 1 Office • Multi-office and SaaS-ready architecture  

---

### Document Metadata & Revision History

| Document Field | Value |
|---|---|
| Product | Human Resource Management System with smart attendance and working-hour-based payroll |
| Version | 1.5 |
| Historical Baselines | Version 1.3 (Discovery Baseline), Version 1.4 (DEC-01 Approved) |
| Audience | Product Owner, Software Architect, Developers, QA |
| Purpose | Define agreed product behavior, constraints, workflows, calculations, and acceptance criteria |

#### Revision History
- **v1.0 - v1.2:** Initial drafts and discovery iterations.
- **v1.3:** Approved requirements baseline for Antigravity implementation planning.
- **v1.4:** Officially incorporated Product Owner approval of **DEC-01 (Option A: Exact Lunch Window Intersection Clipping)**. Resolved TBD-01. Updated mathematical deduction formulas and standardized required calculation examples.
- **v1.5 (Current):** Officially incorporated Product Owner approval of **DEC-02 (Option A: One Attendance Pair Per Employee Per Working Day)**. Enforced single Check-In and single Check-Out pair per scheduled working day. Codified comprehensive Admin-only attendance correction and audit policies, duplicate punch prevention, and idempotent retry safety.

---

# 1. Executive Summary

Build a secure, responsive HRMS for employee administration, GPS- and selfie-based attendance, leave management, working-hour-based payroll, payslips, reporting, and auditability. The first deployment is for one organization with approximately 10 employees and one office. The architecture must support future growth and multiple offices without requiring an initial microservices architecture.

The defining business rule is that **salary is proportional to actual approved payable working hours**. Employees are not assigned an arbitrary fixed half-day salary and do not receive an additional late-arrival or early-departure penalty on top of the actual-hours calculation. Time worked beyond 6:00 PM is included when verified and approved by Admin; it is paid at the normal hourly rate, with no separate overtime multiplier or premium.

---

# 2. Product Goals and Non-Goals

## 2.1 Goals
- Replace manual HR, attendance, and payroll workflows with a centralized application.
- Capture attendance using GPS geofencing, mandatory selfies, face matching, and liveness checks.
- Enforce strict single-interval daily attendance per employee (one check-in, one check-out).
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
- Logs in using phone number and password.
- Views and manages permitted parts of their own profile.
- Checks in and checks out using the required attendance verification flow (strictly once per day).
- Views their own attendance, hours, leave balance, salary estimates, approved payslips, and notifications.
- Applies for leave and views application outcomes.
- **Cannot directly edit attendance records, self-correct punches, or access another employee's data.**
- After checking out for the day, the attendance state is completed; no further check-in action is offered.
- Authorization must be enforced server-side. Hiding a screen or button in the frontend is not sufficient security.

---

# 4. Authentication and Account Lifecycle

- Employee login identifier: phone number. Authentication method: password. OTP is not required for normal login.
- Admin creates the initial temporary password. Employee must change it on first login.
- Password reset supports employee self-service using phone verification and an Admin-assisted reset.
- Reset tokens must expire; password changes must invalidate relevant active sessions.
- Passwords must be securely hashed. Apply rate limiting, abuse protection, session expiry, and login/logout history.
- Admin MFA is not yet decided and remains a security design item (TBD-05).

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
- Automatically generate IDs in the format `EMP001`, `EMP002`, `EMP003`, and so on.
- IDs must be unique, immutable, and never reused.
- Use the employee ID as a stable reference across attendance, leave, payroll, and payslips.

## 5.3 Departments and Designations
- Authorized Admin users can create, edit, assign, and deactivate departments and designations.
- Preserve historical assignments so old reports and payslips do not change when an employee transfers.

## 5.4 Employee Exit
- Admin records resignation or termination reason, effective date, and last working day.
- Review pending attendance corrections, leave, and payroll items.
- Complete final salary/final settlement workflow.
- Deactivate access on the effective date while preserving historical records.
- Apply the approved retention and deletion policy to former-employee data.

---

# 6. Office and Work Schedule

| Parameter | Confirmed Requirement (v1.5 Baseline) |
|---|---|
| Initial offices | One |
| Future architecture | Multiple offices supported |
| Working days | Monday through Saturday |
| Weekly holiday | Sunday |
| Official start | 10:00 AM |
| Official end | 6:00 PM; additional verified hours beyond this time count when approved by Admin. |
| Lunch interval | 1:00 PM – 2:00 PM (Exact window intersection clipping per approved DEC-01). |
| Standard net day | 7 hours (8.0 elapsed minus 1.0 hour lunch deduction for full 10:00 AM–6:00 PM day). |
| Daily session policy | **One Check-In and One Check-Out pair per employee per working day (DEC-02 Approved).** |
| Late grace | 10 minutes; arrival after 10:10 AM is labeled Late. |
| Early-departure grace | 10 minutes; departure before 5:50 PM is labeled Early Departure. |
| Overtime | No separate overtime premium/multiplier. Verified hours beyond 6:00 PM count when approved by Admin, at normal hourly rate ($1.0\times$). |

---

# 7. Smart Attendance & Daily Session Lifecycle

## 7.1 Confirmed Daily Attendance Rule (DEC-02 Approved)
Each employee is permitted:
- **Exactly one Check-In** per scheduled working day.
- **Exactly one Check-Out** per scheduled working day.
- **Exactly one attendance working interval** per scheduled working day.
- **No employee-initiated second check-in or second check-out** on the same working day.
- Multiple attendance sessions, split shifts, or multiple pause/resume intervals are **strictly unsupported** in Phase 1 and Phase 2.

## 7.2 Attendance Validation & Error Handling
- **Duplicate Check-In:** If an employee attempts a check-in while an active session exists or after already checking in for the calendar day, the request must be rejected (HTTP 409 Conflict: `ATTENDANCE_ALREADY_CHECKED_IN`).
- **Orphan Check-Out:** If an employee attempts to check out without an active, verified check-in for the day, the request must be rejected (HTTP 409 Conflict: `CHECK_OUT_WITHOUT_CHECK_IN`).
- **Duplicate Check-Out:** If an employee attempts a second check-out after successfully checking out, the request must be rejected (HTTP 409 Conflict: `ATTENDANCE_ALREADY_COMPLETED`).
- **No Self-Correction:** An employee cannot independently edit, overwrite, replace, or delete any recorded attendance event.
- **Incomplete / Unpaired Attendance:** Any working day with a check-in but no check-out (or missing check-in) must be flagged as `Incomplete / Requires Admin Review` (`requires_admin_review = true`) and excluded from final payable hour calculation until corrected by an Admin.
- **Idempotency & Retry Safety:** The API must safely handle client network retries without generating duplicate attendance events, double sessions, or multiple payable hour credits.

## 7.3 Admin Attendance Correction Policy
All attendance corrections must be executed exclusively by an authorized Admin (or Super Admin).
- **Correction Triggers:**
  1. Employee forgot to check in.
  2. Employee forgot to check out.
  3. Employee accidentally checked out early.
  4. Device timestamp malfunction or synchronization discrepancy.
  5. Attendance event requiring manual identity verification.
- **Mandatory Audit Data for Every Correction:**
  - Original attendance data and timestamps.
  - Corrected attendance data and timestamps.
  - **Mandatory correction reason** (free-text explanation required; empty submissions rejected).
  - Admin user ID of the acting administrator.
  - Server timestamp of the correction.
  - Previous and updated values stored in structured audit log.
- **Non-Destructive Principle:** Original attendance events, GPS coordinates, selfies, and verification telemetry must **never be deleted or overwritten**. Corrections are appended to an immutable `attendance_corrections` history table.

## 7.4 GPS & Biometric Verification
- Geofence radius: 100 meters from assigned office coordinates.
- Minimum acceptable GPS accuracy: $\le 30$ meters.
- Mandatory live camera selfie and liveness detection on both Check-In and Check-Out.
- Up to 3 automatic facial verification attempts per punch before routing to `Verification Pending` for Admin review.
- Server time is authoritative for all online submissions.

## 7.5 Offline Attendance Submissions
- Offline punch submissions are marked `is_offline_sync: true` with client-reported timestamps.
- Treated as untrusted until verified and approved by an Admin. Offline attempts are never auto-approved.

---

# 8. Working-Hour Calculation and Attendance Status

## 8.1 Core Working-Hour Rule
Pay is based on actual approved payable working hours from the **single valid daily attendance interval**. There is no fixed half-day salary and no separate monetary penalty for late arrival or early departure. Late and early labels are descriptive classifications only.

## 8.2 Working-Hour Formula (DEC-01 & DEC-02 Baseline)

$$\text{Valid Elapsed Working Minutes} = T_{\text{out}} - T_{\text{in}}$$

$$\text{Deducted Lunch Minutes} = \max\left(0, \min(T_{\text{out}}, \text{14:00}) - \max(T_{\text{in}}, \text{13:00})\right)$$

$$\text{Payable Working Minutes} = \text{Valid Elapsed Working Minutes} - \text{Deducted Lunch Minutes} - \text{Unapproved Post-18:00 Minutes}$$

$$\text{Approved Payable Hours} = \frac{\text{Payable Working Minutes}}{60.0}$$

- **Single Deduction Application:** Because DEC-02 enforces exactly one attendance interval per day, the DEC-01 lunch deduction is applied **at most once per calendar day**.
- Minute-level precision is preserved; partial days are not rounded to arbitrary half-day blocks.
- Post-18:00 verified minutes are included only when explicitly approved by an Admin, compensated at the normal hourly rate ($1.0\times$).

## 8.3 Confirmed Examples (DEC-01 & DEC-02 Unified)

| Attendance Interval | Elapsed Duration | Deducted Lunch Minutes | Payable Working Time | Notes |
|---|:---:|:---:|:---:|---|
| **10:00 AM – 1:00 PM** | 180 mins (3.0h) | **0 mins** | **3.0 hours (180 mins)** | Single interval ending before lunch window; 0 deduction. |
| **10:00 AM – 1:30 PM** | 210 mins (3.5h) | **30 mins** | **3.0 hours (180 mins)** | Single interval overlapping 13:00–13:30; 30 mins deducted. |
| **10:00 AM – 6:00 PM** | 480 mins (8.0h) | **60 mins** | **7.0 hours (420 mins)** | Full standard day crossing lunch; 60 mins deducted. |
| **1:30 PM – 6:00 PM** | 270 mins (4.5h) | **30 mins** | **4.0 hours (240 mins)** | Single interval overlapping 13:30–14:00; 30 mins deducted. |
| **1:05 PM – 1:55 PM** | 50 mins (0.83h) | **50 mins** | **0.0 hours (0 mins)** | Interval strictly inside lunch window; 50 mins deducted; net 0. |

## 8.4 Attendance Status Labels
- `Present`
- `Late` (arrival after 10:10 AM)
- `Early Departure` (departure before 5:50 PM)
- `Absent`
- `Verification Pending`
- `Correction Pending / Incomplete`
- `Absent – CL/SL/PL/LWP (unpaid)`
- `Weekly Off`
- `Public Holiday`

Labels are descriptive only and do not independently levy salary fines.

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
- Earned salary computed from total approved payable minutes across the single daily sessions.
- Dual-key governance: Admin compiles draft batch $\rightarrow$ Super Admin approves $\rightarrow$ Payslips generated.
- Approved payroll runs are immutable; adjustments require documented reversal workflows.

---

# 12. UI/UX Architecture Baseline (DEC-02 Aligned)

## 12.1 Employee Dashboard State Progression
The employee attendance card strictly follows a 3-state deterministic flow:
1. **State 1 (Pre-Punch):** Employee has not checked in today. Primary action button: `[Check In]`.
2. **State 2 (Active Session):** Employee has successfully checked in. Display: Check-In timestamp (e.g., `10:04 AM`), elapsed time counter. Primary action button: `[Check Out]`.
3. **State 3 (Completed Day):** Employee has successfully checked out. Display: `Attendance Completed for Today` card with summary of elapsed time, lunch deduction, and net payable hours. **No check-in or check-out buttons are rendered.**
4. **No Self-Service Correction:** The employee interface does not offer manual timestamp editing or punch creation.

## 12.2 Admin Correction Interface
- Dedicated Exception & Correction Console.
- Displays original punch data, proposed corrected timestamp, employee profile, and existing evidence.
- Requires mandatory justification text.
- Maintains complete chronological audit history with Admin ID and timestamp.

---

# 13. Open Items & Decision Register Status (v1.5 Baseline)

| ID | Topic | Status in v1.5 | Details |
|---|---|---|---|
| **DEC-01** | **Lunch Deduction Algorithm** | **OFFICIALLY APPROVED** | **Option A:** Exact Window Intersection Clipping. |
| **DEC-02** | **Daily Punch Count Policy** | **OFFICIALLY APPROVED** | **Option A:** Exactly one Check-In and Check-Out pair per employee per working day. Admin-only corrections. |
| **DEC-03** | Face Verification Provider | Open (TBD) | Hexagonal adapter; provider selection pending. |
| **DEC-04** | Biometric Data Retention | Open (Legal Hold) | 4-tier data separation; retention schedule pending legal review. |
| **DEC-05** | Net Salary Rounding Rule | Open (TBD) | Half-Up Rounding to nearest whole Rupee proposed. |
| **DEC-06** | Absence Alert Threshold | Open (TBD) | Default 3 consecutive unauthorized absences proposed. |
| **DEC-07** | Admin MFA Mechanism | Open (TBD) | TOTP Authenticator app (RFC 6238) proposed. |
| **DEC-08** | Leave Quota Policy Values | Open (TBD) | Quotas unseeded; configurable in Admin settings. |
| **DEC-09** | Auth Broker Architecture | Open (TBD) | Express proxy mapping phone numbers to Supabase Auth. |
| **DEC-10** | Notification Provider | Open (TBD) | In-app notifications and console logger for Phase 1–2. |
| **DEC-11** | Backend Hosting Provider | Open (TBD) | Render / AWS ECS / Railway connecting to Supabase Postgres. |
| **DEC-12** | Disaster Recovery Targets | Open (TBD) | RPO $\le 1\text{ hr}$, RTO $\le 4\text{ hrs}$ via Supabase PITR. |
| **LEG-01** | Statutory Leave & Rest Pay | Open (Legal Hold) | Configurable policy flags (`is_paid: false`) pending legal review. |
| **LEG-02** | Biometric DPDP Notice | Open (Legal Hold) | Explicit notice and consent logging before biometric capture. |

---

# 14. Phased Delivery Roadmap

- **Phase 0 — Specification & Architecture:** Baseline updated (PRD v1.5, SRS, ERD, API specs).
- **Phase 1 — Foundation:** Auth, roles, employee profiles, departments, designations, office settings.
- **Phase 2 — Attendance:** Single-pair attendance engine, geofencing, selfie capture, biometric adapter, failure queue, Admin corrections.
- **Phase 3 — Leave:** Leave management, unseeded quotas, applications, approvals, holiday calendar.
- **Phase 4 — Payroll:** Working-hour engine with DEC-01 lunch clipping & DEC-02 single session aggregation, Admin prep, Super Admin approval, payslips.
- **Phase 5 — Reporting & Release:** Dashboards, exports, audit review, security testing, deployment.

---

*END OF PRODUCT REQUIREMENTS DOCUMENT v1.5*
