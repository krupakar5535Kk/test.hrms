# Role and Permission Matrix

**System Designation:** HRMS Access Control Framework  
**Model:** Hierarchical Role-Based Access Control (RBAC) + Object-Level Security via PostgreSQL RLS  
**Roles:** `SUPER_ADMIN`, `ADMIN`, `EMPLOYEE`  
**Document Version:** 1.5  
**PRD Reference:** PRD v1.6 Baseline (Section 3, 7; Incorporating Approved DEC-01 & Refined DEC-02 with Unpaired Punch Policy)  

---

## 1. Access Control Model

The HRMS platform enforces a two-tier defense-in-depth authorization mechanism:
1. **Tier 1 (Application Gateway / Middleware):** Node.js/Express route guards verify the caller's JWT role claims and evaluate granular permission keys (`requirePermission('permission:key')`).
2. **Tier 2 (Database Engine / PostgreSQL RLS):** The database context sets `app.current_user_id`. PostgreSQL Row Level Security policies ensure that even if an API route handler were compromised, an employee cannot read or mutate another employee's records.

---

## 2. Granular Permission Key Registry

| Domain | Permission Key | Description |
|---|---|---|
| **System** | `sys:manage_admins` | Provision, modify, or deactivate Admin user accounts |
| **System** | `sys:manage_policies` | Configure office geofences, global shift hours, and holiday schedules |
| **System** | `sys:view_audit_logs` | Access global audit trails, security logs, and modification histories |
| **Employee** | `emp:view_all` | View profile records of all employees across the organization |
| **Employee** | `emp:view_self` | View own profile data, contact details, and assigned office |
| **Employee** | `emp:create` | Provision new employee profiles, generate employee IDs |
| **Employee** | `emp:update` | Edit employee demographic, departmental, or salary data |
| **Employee** | `emp:exit` | Execute employee separation, notice management, and deactivation |
| **Employee** | `emp:view_sensitive` | View encrypted bank details, identity proofs, and emergency contacts |
| **Biometrics** | `bio:enroll_selfie` | Capture and submit biometric face enrollment reference |
| **Biometrics** | `bio:approve_reference`| Review, validate quality, and approve employee face reference |
| **Attendance** | `att:punch_self` | Perform live geofenced, biometric Check-In and Check-Out |
| **Attendance** | `att:view_self` | Inspect own daily logs, monthly accrued hours, and attendance labels |
| **Attendance** | `att:view_all` | Inspect organization-wide daily and monthly attendance registers |
| **Attendance** | `att:review_failures` | Review GPS failures, 3x face mismatch queues, and offline syncs |
| **Attendance** | `att:manual_correction`| Execute Admin corrections: create missing punch (Workflow A), adjust timestamps (Workflow B), or resolve unpaired punch exceptions with mandatory reason |
| **Attendance** | `att:approve_post18` | Approve verified working hours accrued after 6:00 PM |
| **Leave** | `leave:apply_self` | Submit leave requests against available entitlement quotas |
| **Leave** | `leave:view_self` | Inspect own leave balances, application history, and approval states |
| **Leave** | `leave:view_all` | View organization-wide leave applications and calendar absences |
| **Leave** | `leave:review` | Approve or reject employee leave applications |
| **Leave** | `leave:configure` | Define leave categories, annual quotas, and carry-forward rules |
| **Payroll** | `pay:compile_batch` | Calculate monthly standard hours and compile draft payroll batches |
| **Payroll** | `pay:submit_batch` | Submit draft payroll run for executive Super Admin review |
| **Payroll** | `pay:approve_batch` | Exercise exclusive authority to approve or reject submitted payroll |
| **Payroll** | `pay:record_payment` | Log manual salary disbursement details (NEFT, UTR, Paid status) |
| **Payroll** | `pay:view_all_payslips`| Inspect and download payslips for any employee |
| **Payroll** | `pay:view_self_payslip`| View and download own officially approved payslips |
| **Reports** | `rep:view_attendance` | Generate and export daily/monthly attendance registers (Excel/PDF) |
| **Reports** | `rep:view_payroll` | Generate and export monthly payroll expenditures and bank transfer sheets |

---

## 3. Granular Role-Permission Matrix

| Functional Capability | Permission Key | SUPER_ADMIN | ADMIN | EMPLOYEE |
|---|---|:---:|:---:|:---:|
| **Manage Admin Accounts** | `sys:manage_admins` | **YES** | NO | NO |
| **Configure System Policies & Geofences** | `sys:manage_policies` | **YES** | NO | NO |
| **Inspect System Audit Logs** | `sys:view_audit_logs` | **YES** | NO | NO |
| **View All Employee Rosters** | `emp:view_all` | **YES** | **YES** | NO |
| **View Own Employee Profile** | `emp:view_self` | **YES** | **YES** | **YES** |
| **Create New Employee Profile** | `emp:create` | **YES** | **YES** | NO |
| **Edit Employee Profile / Salary** | `emp:update` | **YES** | **YES** | NO |
| **Process Employee Exit / Deactivation** | `emp:exit` | **YES** | **YES** | NO |
| **Access Sensitive Bank / ID Docs** | `emp:view_sensitive` | **YES** | **YES** | Own Only |
| **Submit Biometric Face Enrollment** | `bio:enroll_selfie` | **YES** | **YES** | **YES** |
| **Approve Biometric Face Reference** | `bio:approve_reference`| **YES** | **YES** | NO |
| **Execute Smart Check-In / Check-Out** | `att:punch_self` | **YES** | **YES** | **YES** |
| **View Own Attendance & Logged Hours** | `att:view_self` | **YES** | **YES** | **YES** |
| **View All Attendance Logs** | `att:view_all` | **YES** | **YES** | NO |
| **Review Attendance Failure Queue** | `att:review_failures` | **YES** | **YES** | NO |
| **Insert Missing Punch / Correction** | `att:manual_correction`| **YES** | **YES** | NO |
| **Approve Post-18:00 Hours** | `att:approve_post18` | **YES** | **YES** | NO |
| **Submit Leave Application** | `leave:apply_self` | **YES** | **YES** | **YES** |
| **View Own Leave Balances** | `leave:view_self` | **YES** | **YES** | **YES** |
| **View Organization Leave Calendar** | `leave:view_all` | **YES** | **YES** | NO |
| **Approve / Reject Leave Applications** | `leave:review` | **YES** | **YES** | NO |
| **Configure Leave Quotas & Types** | `leave:configure` | **YES** | NO | NO |
| **Compile Draft Monthly Payroll** | `pay:compile_batch` | **YES** | **YES** | NO |
| **Submit Payroll for Approval** | `pay:submit_batch` | **YES** | **YES** | NO |
| **Approve / Reject Payroll Batch** | `pay:approve_batch` | **YES** | NO | NO |
| **Record Manual Bank Disbursement** | `pay:record_payment` | **YES** | **YES** | NO |
| **Inspect All Company Payslips** | `pay:view_all_payslips`| **YES** | **YES** | NO |
| **View Own Approved Payslips** | `pay:view_self_payslip`| **YES** | **YES** | **YES** |
| **Export Attendance Reports (Excel/PDF)**| `rep:view_attendance` | **YES** | **YES** | NO |
| **Export Payroll Reports (Excel/PDF)** | `rep:view_payroll` | **YES** | **YES** | NO |
