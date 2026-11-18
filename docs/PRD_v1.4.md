# PRODUCT REQUIREMENTS DOCUMENT

## HRMS + SMART ATTENDANCE + PAYROLL

**Current Baseline:** Version 1.4  
**Date:** 2026-11-07  
**Status:** Approved Requirements Baseline (Updated with Approved DEC-01 Lunch Window Clipping)  
**Historical Baseline:** Version 1.3 (Initial Product Discovery Baseline)  
**Initial Scale:** Approximately 10 employees • 1 Office • Multi-office and SaaS-ready architecture  

---

### Document Metadata & Revision History

| Document Field | Value |
|---|---|
| Product | Human Resource Management System with smart attendance and working-hour-based payroll |
| Version | 1.4 |
| Historical Baseline | Version 1.3 (Approved on discovery baseline) |
| Audience | Product Owner, Software Architect, Developers, QA |
| Purpose | Define agreed product behavior, constraints, workflows, calculations, and acceptance criteria |

#### Revision History
- **v1.0 - v1.2:** Initial drafts and discovery iterations.
- **v1.3:** Approved requirements baseline for Antigravity implementation planning.
- **v1.4 (Current):** Officially incorporated Product Owner approval of **DEC-01 (Option A: Exact Lunch Window Intersection Clipping)**. Resolved TBD-01. Updated mathematical deduction formulas and standardized required calculation examples with minute-level precision.

---

# 1. Executive Summary

Build a secure, responsive HRMS for employee administration, GPS- and selfie-based attendance, leave management, working-hour-based payroll, payslips, reporting, and auditability. The first deployment is for one organization with approximately 10 employees and one office. The architecture must support future growth and multiple offices without requiring an initial microservices architecture.

The defining business rule is that **salary is proportional to actual approved payable working hours**. Employees are not assigned an arbitrary fixed half-day salary and do not receive an additional late-arrival or early-departure penalty on top of the actual-hours calculation. Time worked beyond 6:00 PM is included when verified and approved by Admin; it is paid at the normal hourly rate, with no separate overtime multiplier or premium.

---

# 2. Product Goals and Non-Goals

## 2.1 Goals
- Replace manual HR, attendance, and payroll workflows with a centralized application.
- Capture attendance using GPS geofencing, mandatory selfies, face matching, and liveness checks.
- Calculate salary transparently from approved payable hours; CL, SL, PL, and LWP days are unpaid and contribute zero payable hours.
- Provide separate Super Admin, Admin, and Employee experiences with role-based permissions.
- Maintain traceable attendance corrections, payroll approvals, sensitive changes, and evidence access.
- Start with one office and approximately 10 employees while supporting future multi-office growth.
- Deliver a responsive web application and PWA first; consider native mobile apps in a later phase.

## 2.2 Non-Goals for Initial Release
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
- Reviews system-level exceptions and security events.

## 3.2 Admin
- Manages employee profiles, departments, designations, and employee lifecycle.
- Reviews attendance, GPS/face exceptions, and correction requests.
- Creates missing attendance entries with a mandatory reason.
- Approves or rejects leave applications.
- Prepares and submits payroll for Super Admin approval.
- Generates reports and performs authorized HR operations.

## 3.3 Employee
- Logs in using phone number and password.
- Views and manages permitted parts of their own profile.
- Checks in and checks out using the required attendance verification flow.
- Views their own attendance, hours, leave balance, salary estimates, approved payslips, and notifications.
- Applies for leave and views application outcomes.
- Cannot directly edit attendance records or access another employee's data.
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

| Parameter | Confirmed Requirement (v1.4 Baseline) |
|---|---|
| Initial offices | One |
| Future architecture | Multiple offices supported |
| Working days | Monday through Saturday |
| Weekly holiday | Sunday |
| Official start | 10:00 AM |
| Official end | 6:00 PM; additional verified hours beyond this time count when approved by Admin. |
| Lunch interval | 1:00 PM – 2:00 PM (Exact window intersection clipping: deducts actual minutes overlapping this break). |
| Standard net day | 7 hours (8.0 elapsed minus 1.0 hour lunch deduction for full 10:00 AM–6:00 PM day). |
| Late grace | 10 minutes; arrival after 10:10 AM is labeled Late. |
| Early-departure grace | 10 minutes; departure before 5:50 PM is labeled Early Departure. |
| Overtime | No separate overtime premium/multiplier. Verified hours beyond 6:00 PM count when approved by Admin, at the normal hourly rate. |

**Confirmed Lunch Rule (DEC-01 Approved):**
- Standard lunch break window: 1:00 PM to 2:00 PM.
- Deduct only the actual minutes overlapping this interval.
- A working interval that ends before 1:00 PM incurs a 0-minute lunch deduction.
- Office records must support office ID, name, address, GPS coordinates, geofence radius (100 meters initial), assigned employees, schedule, and active status.

---

# 7. Smart Attendance

## 7.1 Attendance Workflow
- Employee opens dashboard quick action or dedicated attendance page.
- Employee selects Check In or Check Out.
- Application captures live camera selfie and GPS coordinates.
- System validates GPS accuracy ($\le 30\text{m}$) and office geofence ($\le 100\text{m}$).
- System performs face matching and liveness verification.
- Prevent duplicate check-ins, check-out without valid check-in, duplicate check-outs, and impossible sequences.
- Server time is authoritative for online submissions.

## 7.2 GPS Verification
- Geofence radius: 100 meters from assigned office coordinates.
- Minimum acceptable GPS accuracy: 30 meters or better. If worse than 30m, prompt employee to retry.
- If outside 100m, reject normal attendance attempt.
- Server-side Haversine verification is mandatory.

## 7.3 Selfie and Face Verification
- Mandatory selfie at both Check-In and Check-Out.
- Face matching against approved enrollment reference + liveness check.
- Hybrid architecture: abstract via adapter interface; commercial provider TBD.

## 7.4 Employee Face Enrollment
- Admin creates employee profile.
- Explicit biometric processing notice and consent logged.
- Live reference selfie captured under Admin supervision. Quality and liveness validated.
- Admin reviews and approves enrollment.

## 7.5 Face Verification Failure
- Up to 3 automatic verification attempts allowed per punch.
- After 3 failures, record set to `Verification Pending`.
- Admin reviews available evidence and approves or rejects with mandatory reason.

## 7.6 GPS or Network Failure / Offline Submission
- Controlled `Pending Review` submission with local device timestamp and stored evidence.
- Synchronized when connectivity returns; treated as untrusted until server validation and Admin approval. Never auto-approved.

## 7.7 Missing Check-In or Check-Out
- Admin entry only. Employees cannot insert missing punches.
- Requires employee, date, missing event type, actual reported time, and mandatory explanation note. Fully audited.

---

# 8. Working-Hour Calculation and Attendance Status

## 8.1 Core Rule
Pay is based on actual approved payable working hours. There is no fixed half-day salary and no separate monetary penalty for late arrival or early departure. Late and early labels are descriptive attendance classifications only.

## 8.2 Confirmed Calculation Formula (DEC-01 Approved Baseline)

$$\text{Valid Elapsed Working Minutes} = T_{\text{out}} - T_{\text{in}}$$

$$\text{Deducted Lunch Minutes} = \max\left(0, \min(T_{\text{out}}, \text{14:00}) - \max(T_{\text{in}}, \text{13:00})\right)$$

$$\text{Payable Working Minutes} = \text{Valid Elapsed Working Minutes} - \text{Deducted Lunch Minutes} - \text{Unapproved Post-18:00 Minutes}$$

$$\text{Approved Payable Hours} = \frac{\text{Payable Working Minutes}}{60.0}$$

- Minute-level precision is preserved; do not round partial days to arbitrary half-day amounts.
- Verified hours beyond 6:00 PM are included only when approved by Admin, paid at the normal hourly rate.

## 8.3 Standard Examples (DEC-01 Approved)

| Attendance Interval | Elapsed Duration | Deducted Lunch Minutes | Payable Working Time | Notes |
|---|:---:|:---:|:---:|---|
| **10:00 AM – 1:00 PM** | 180 mins (3.0h) | **0 mins** | **3.0 hours (180 mins)** | Ends before lunch window begins; 0 deduction. |
| **10:00 AM – 1:30 PM** | 210 mins (3.5h) | **30 mins** | **3.0 hours (180 mins)** | Overlaps 13:00–13:30 by 30 mins; exactly 30 mins deducted. |
| **10:00 AM – 6:00 PM** | 480 mins (8.0h) | **60 mins** | **7.0 hours (420 mins)** | Crosses entire 13:00–14:00 window; exactly 60 mins deducted. |
| **1:30 PM – 6:00 PM** | 270 mins (4.5h) | **30 mins** | **4.0 hours (240 mins)** | Overlaps 13:30–14:00 by 30 mins; exactly 30 mins deducted. |
| **1:05 PM – 1:55 PM** | 50 mins (0.83h) | **50 mins** | **0.0 hours (0 mins)** | Shift entirely inside lunch window; 50 mins deducted; net 0. |

## 8.4 Attendance Labels
- `Present`
- `Late` (arrival after 10:10 AM)
- `Early Departure` (departure before 5:50 PM)
- `Absent`
- `Verification Pending`
- `GPS Failed / Location Review`
- `Face Verification Failed`
- `Correction Pending`
- `Absent – CL/SL/PL/LWP (unpaid)`
- `Weekly Off`
- `Public Holiday`

Labels are descriptive only and do not incur monetary fines.

## 8.5 Absence
- No valid attendance and no approved leave = `Absent` (0 payable hours).
- Consecutive absence alert threshold is Admin-configurable. Sundays, holidays, and approved leave do not count toward consecutive days.

---

# 9. Leave Management

## 9.1 Leave Categories
- **CL (Casual Leave):** 0 payable hours; Absent/unpaid.
- **SL (Sick Leave):** 0 payable hours; Absent/unpaid.
- **PL (Privilege Leave):** 0 payable hours; Absent/unpaid.
- **LWP (Leave Without Pay):** 0 payable hours; Absent/unpaid.

Approved leave is an administrative record for absence excuse and quota debiting. All leave categories currently receive 0 payable hours and 0 salary.

## 9.2 Leave Configuration
- Entitlements, accrual schedules, and carry-forward rules are unseeded and fully configurable by Admin.
- Exact entitlement values remain TBD-06 pending organizational determination.

---

# 10. Sundays and Public Holidays

- Sunday receives 0 payable hours under current policy.
- Admin-declared public holidays receive 0 payable hours under current policy.
- Sundays and declared holidays are excluded from scheduled monthly standard hours.
- **LEGAL HOLD POINT:** Configurable policy flags (`is_paid: false`) maintained to permit zero-code migration if legal counsel determines paid rest days or statutory holidays apply.

---

# 11. Payroll Engine

## 11.1 Salary Configuration
Admin enters monthly salary reference. System derives hourly rate using standard scheduled hours for the month.

## 11.2 Standard Monthly Hours
$$\text{Standard Monthly Hours } (H_{\text{std}}) = N_{\text{sched}} \times 7.0$$
$$\text{Standard Monthly Minutes } (M_{\text{std}}) = H_{\text{std}} \times 60$$

## 11.3 Calculation Formulas
$$\text{Hourly Rate (paise)} = \frac{\text{Monthly Reference Salary (paise)}}{H_{\text{std}}} \quad [\text{stored as NUMERIC(14,6)}]$$
$$\text{Minute Rate (paise)} = \frac{\text{Monthly Reference Salary (paise)}}{M_{\text{std}}} \quad [\text{stored as NUMERIC(14,6)}]$$
$$\text{Earned Salary (paise)} = \text{round}\left(\sum \text{Payable Minutes} \times \text{Minute Rate}\right)$$
$$\text{Net Salary (paise)} = \text{Earned Salary} + \text{Allowances} + \text{Adjustments} - \text{Deductions}$$

## 11.5 Payroll Workflow & Governance
- Admin selects month $\rightarrow$ system compiles hours and preview $\rightarrow$ Admin submits batch (`SUBMITTED_FOR_APPROVAL`).
- Super Admin reviews and approves or rejects batch.
- Approved payroll runs are immutable. Payslips generated only post-approval.

## 11.6 Payment Tracking
Manual tracking: `Paid`, `Pending`, `Failed`, payment mode, date, transaction reference.

---

# 12. Payslips

Generated post-approval with full breakdown: standard hours, approved payable hours, minute rate, hourly rate, earned salary, allowances, deductions, net salary, and payment status. Downloadable as PDF.

---

# 13. Dashboards, Reports & Security

- **Admin Dashboard:** Headcount, present, late, absent, pending review counter, monthly hours chart.
- **Employee Dashboard:** Today's punch state, hours progress ring, estimated earned salary, leave balances, approved payslips.
- **Reports:** Attendance and payroll registers with Excel and PDF export.
- **Security:** PostgreSQL Row Level Security (RLS), native Supabase Storage pre-signed URLs (15-min TTL), tamper-evident audit logging for sensitive actions.

---

# 14. Open Items & TBD Status (v1.4 Baseline)

| ID | Topic | Status in v1.4 | Resolution / Requirement |
|---|---|---|---|
| **TBD-01** | **Exact Lunch Interval & Partial Overlaps** | **RESOLVED & APPROVED** | **DEC-01 Approved:** Exact Window Intersection Clipping: $\max(0, \min(T_{\text{out}}, 14:00) - \max(T_{\text{in}}, 13:00))$. |
| **TBD-02** | Face Verification Provider | Open (TBD) | Evaluate provider, pricing, and liveness resistance. |
| **TBD-03** | Biometric Notice, Lawful Basis & Retention | Open (Legal Hold) | 4-tier data segregation; retention pending privacy review. |
| **TBD-04** | GPS Spoofing Controls | Open (TBD) | Acknowledge browser limitations; enforce server-side distance/accuracy gates. |
| **TBD-05** | Admin MFA | Open (TBD) | TOTP Authenticator app recommended. |
| **TBD-06** | Leave Policy Values | Open (TBD) | Quotas unseeded; configurable in Admin settings. |
| **TBD-07** | Statutory Payroll Rules | Open (Legal Hold) | Configurable policy flags (`is_paid: false`) pending legal review. |
| **TBD-08** | Notification Provider | Open (TBD) | Abstract via notification service; provider TBD. |
| **TBD-09** | Company Branding | Open (Ready for Spec) | Configurable organization settings page. |
| **TBD-10** | Production Infrastructure | Open (TBD) | Vercel frontend confirmed; backend cloud host TBD. |
| **TBD-11** | Backup and Recovery | Open (TBD) | Automated Supabase backups with PITR. |
| **TBD-12** | SaaS Tenancy | **RESOLVED** | Tenant-aware schema (`organization_id`) from Day 1. |
| **TBD-13** | Statutory Deductions & Allowances | Open (TBD) | Dynamic line items on payroll items. |
| **TBD-14** | Rounding & Payroll Adjustment Policy | Open (TBD) | Half-Up Rounding to whole Rupee proposed. |

---

# 15. Phased Delivery Roadmap

- **Phase 0 — Specification & Architecture:** Baseline finalized (PRD v1.4, SRS, ERD, API specs).
- **Phase 1 — Foundation:** Auth, roles, employee profiles, departments, designations, office settings.
- **Phase 2 — Attendance:** Geofencing, selfie capture, biometric adapter, enrollment, events, reviews, corrections.
- **Phase 3 — Leave:** Leave management, unseeded quotas, applications, approvals, holiday calendar.
- **Phase 4 — Payroll:** Working-hour engine with DEC-01 lunch clipping, Admin prep, Super Admin approval, payslips.
- **Phase 5 — Reporting & Release:** Dashboards, exports, audit review, security audit, deployment.

---

*END OF PRODUCT REQUIREMENTS DOCUMENT v1.4*
