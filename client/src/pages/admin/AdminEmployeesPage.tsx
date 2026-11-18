import React, { useMemo, useState } from 'react';
import {
  Calendar,
  Check,
  CheckCircle2,
  Copy,
  History,
  KeyRound,
  Lock,
  Phone,
  Power,
  RefreshCw,
  Save,
  ShieldCheck,
  UserPlus,
  Users,
  Building2,
  Briefcase,
  ScanFace,
  MapPin,
  Eye,
  EyeOff,
} from 'lucide-react';
import type { EmployeeProfile } from '../../types/hrms';
import { formatJobCategoryLabel, type JobCategory } from '../../types/role';
import {
  excludeAdminFromEmployees,
  formatInr,
  HRMS_POLICY,
  normalizeIndianMobile,
} from '../../lib/domainRules';
import { useAuth } from '../../context/AuthContext';
import { useApiResource } from '../../hooks/useApiResource';
import { apiRequest } from '../../lib/apiClient';
import { cn } from '../../lib/cn';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { MetricCard } from '../../components/ui/MetricCard';
import { DataTable } from '../../components/ui/DataTable';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';

interface AdminEmployeesPayload {
  employees: EmployeeProfile[];
}

const JOB_CATEGORY_OPTIONS: JobCategory[] = [
  'OFFICE',
  'HR',
  'FINANCE',
  'SALES',
  'RECOVERY',
];

export const AdminEmployeesPage: React.FC = () => {
  const { getInMemoryAccessToken } = useAuth();
  const { state, data, reload } = useApiResource<AdminEmployeesPayload>(
    '/api/v1/admin/employees',
    { employees: [] }
  );

  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [selectedEmp, setSelectedEmp] = useState<EmployeeProfile | null>(null);
  const [provisionOpen, setProvisionOpen] = useState(false);

  // Maker-Checker Provisioning Form State
  const [fullName, setFullName] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [mobileInput, setMobileInput] = useState('');
  const [jobCategory, setJobCategory] = useState<JobCategory>('OFFICE');
  const [department, setDepartment] = useState('');
  const [designation, setDesignation] = useState('');
  const [monthlySalaryReference, setMonthlySalaryReference] = useState('');
  const [initialPassword, setInitialPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showProvisionPassword, setShowProvisionPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formUnavailable, setFormUnavailable] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Employee Edit / Lifecycle / History State inside Detail Dialog
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState<JobCategory>('OFFICE');
  const [editDepartment, setEditDepartment] = useState('');
  const [editSalary, setEditSalary] = useState('');
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [detailMsg, setDetailMsg] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<{
    attendanceCount: number;
    leavesCount: number;
    fieldSessionsCount: number;
    payslipsCount: number;
  } | null>(null);
  // Admin Direct Password Reset State (GAP-02)
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [tempPasswordInput, setTempPasswordInput] = useState('');
  const [showTempPassword, setShowTempPassword] = useState(false);
  const [resetPasswordBusy, setResetPasswordBusy] = useState(false);
  const [resetPasswordError, setResetPasswordError] = useState<string | null>(null);
  const [resetPasswordSuccess, setResetPasswordSuccess] = useState<string | null>(null);
  const [resetPasswordResult, setResetPasswordResult] = useState<{
    temporaryPassword: string;
    message: string;
  } | null>(null);
  const [copiedTempPassword, setCopiedTempPassword] = useState(false);

  const openEmployeeModal = (emp: EmployeeProfile) => {
    setSelectedEmp(emp);
    setEditName(emp.fullName);
    setEditCategory(emp.jobCategory);
    setEditDepartment(emp.department);
    setEditSalary(String(emp.monthlySalaryReference || ''));
    setDetailMsg(null);
    setDetailError(null);
    setHistoryData(null);
  };

  // Admin account is NEVER included in Employee counts or directories
  const roster = useMemo(() => excludeAdminFromEmployees(data.employees), [data.employees]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return roster.filter((e) => {
      if (categoryFilter !== 'ALL' && e.jobCategory !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      return (
        e.fullName.toLowerCase().includes(q) ||
        e.employeeCode.toLowerCase().includes(q) ||
        e.department.toLowerCase().includes(q) ||
        e.jobCategory.toLowerCase().includes(q)
      );
    });
  }, [roster, query, categoryFilter]);

  // Executive KPI stats
  const kpiStats = useMemo(() => {
    const total = roster.length;
    const active = roster.filter((e) => e.employmentStatus === 'ACTIVE' || e.isActive !== false).length;
    const faceEnrolled = roster.filter((e) => e.faceEnrollmentStatus === 'APPROVED').length;
    const fieldAgents = roster.filter((e) => e.jobCategory === 'SALES' || e.jobCategory === 'RECOVERY').length;
    return { total, active, faceEnrolled, fieldAgents };
  }, [roster]);

  const handleProvisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormUnavailable(null);
    setFormSuccess(null);

    if (fullName.trim().length < 2) {
      setFormError('Enter employee full legal name.');
      return;
    }
    const mobileCheck = normalizeIndianMobile(mobileInput);
    if (!mobileCheck.isValid || !mobileCheck.data) {
      setFormError(
        mobileCheck.errors[0]?.message ?? 'Enter a valid 10-digit Indian mobile number.'
      );
      return;
    }
    if (initialPassword.length < 8) {
      setFormError('Initial password is required and must be at least 8 characters.');
      return;
    }
    if (initialPassword !== confirmPassword) {
      setFormError('Passwords do not match. Please re-enter the matching initial password.');
      return;
    }

    setSubmitting(true);
    const result = await apiRequest<{
      employee?: EmployeeProfile;
      employeeCode?: string;
      message?: string;
    }>(
      '/api/v1/admin/employees',
      getInMemoryAccessToken(),
      {
        method: 'POST',
        body: {
          fullName: fullName.trim(),
          employeeCode: employeeCode.trim().toUpperCase() || undefined,
          phoneNumber: mobileCheck.data.canonicalE164,
          role: 'EMPLOYEE',
          jobCategory,
          department: department.trim(),
          designation: designation.trim(),
          monthlySalaryReference: Number(monthlySalaryReference) || 0,
          initialPassword: initialPassword.trim(),
          activateImmediately: true,
        },
      }
    );
    setSubmitting(false);

    if (result.status === 'UNAVAILABLE') {
      setFormUnavailable(
        result.message || 'Employee provisioning endpoint is pending backend milestone implementation.'
      );
      return;
    }

    if (result.status !== 'OK') {
      setFormError(result.message);
      return;
    }

    setFormSuccess(
      result.data.message ||
        `Employee account for ${fullName.trim()} successfully created and activated. Ready for immediate login.`
    );
    setFullName('');
    setEmployeeCode('');
    setMobileInput('');
    setDepartment('');
    setDesignation('');
    setMonthlySalaryReference('');
    setInitialPassword('');
    setConfirmPassword('');
    reload();
  };

  const handleSaveEmployeeEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmp) return;
    setDetailError(null);
    setDetailMsg(null);
    setLifecycleBusy(true);
    const res = await apiRequest<{ employee: EmployeeProfile }>(
      `/api/v1/admin/employees/${encodeURIComponent(selectedEmp.id)}`,
      getInMemoryAccessToken(),
      {
        method: 'PATCH',
        body: {
          fullName: editName.trim(),
          jobCategory: editCategory,
          department: editDepartment.trim() || undefined,
          monthlySalaryReference: Number(editSalary) > 0 ? Number(editSalary) : undefined,
        },
      }
    );
    setLifecycleBusy(false);
    if (res.status !== 'OK') {
      setDetailError(res.message);
      return;
    }
    setDetailMsg('Employee profile & salary reference updated.');
    setSelectedEmp(res.data.employee);
    reload();
  };

  const handleToggleActivation = async () => {
    if (!selectedEmp) return;
    setDetailError(null);
    setDetailMsg(null);
    setLifecycleBusy(true);
    const willDeactivate = selectedEmp.isActive !== false;
    const path = willDeactivate
      ? `/api/v1/admin/employees/${encodeURIComponent(selectedEmp.id)}/deactivate`
      : `/api/v1/admin/employees/${encodeURIComponent(selectedEmp.id)}/activate`;
    const res = await apiRequest<{ activationToken?: string; activationLink?: string }>(
      path,
      getInMemoryAccessToken(),
      {
        method: 'POST',
        body: willDeactivate ? { reason: 'Admin directory deactivation' } : { issueActivationLink: false },
      }
    );
    setLifecycleBusy(false);
    if (res.status !== 'OK') {
      setDetailError(res.message);
      return;
    }
    setDetailMsg(willDeactivate ? 'Employee deactivated & sessions revoked.' : 'Employee account activated.');
    reload();
  };

  const handleOpenResetDialog = () => {
    if (!selectedEmp) return;
    const randomSuffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    setTempPasswordInput(`Kmaccs#${randomSuffix}`);
    setShowTempPassword(false);
    setResetPasswordError(null);
    setResetPasswordSuccess(null);
    setResetPasswordResult(null);
    setCopiedTempPassword(false);
    setResetPasswordOpen(true);
  };

  const handleGenerateRandomPassword = () => {
    const randomSuffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    setTempPasswordInput(`Kmaccs#${randomSuffix}`);
  };

  const handleCopyCredentials = () => {
    if (!resetPasswordResult || !selectedEmp) return;
    const text = `KMACCS HRMS Credentials Reset\nEmployee: ${selectedEmp.fullName} (${selectedEmp.employeeCode})\nMobile: ${selectedEmp.phoneNumber}\nTemporary Password: ${resetPasswordResult.temporaryPassword}\nLogin Portal: ${window.location.origin}/login\nNote: You will be required to set a permanent password upon first login.`;
    navigator.clipboard.writeText(text);
    setCopiedTempPassword(true);
    setTimeout(() => setCopiedTempPassword(false), 2000);
  };

  const handleExecuteResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmp || resetPasswordBusy) return;
    if (tempPasswordInput.length < 8) {
      setResetPasswordError('Temporary password must be at least 8 characters.');
      return;
    }
    setResetPasswordError(null);
    setResetPasswordBusy(true);

    const res = await apiRequest<{
      temporaryPassword: string;
      message: string;
      employeeCode: string;
      fullName: string;
    }>(
      `/api/v1/admin/employees/${encodeURIComponent(selectedEmp.id)}/reset-credentials`,
      getInMemoryAccessToken(),
      {
        method: 'POST',
        body: { temporaryPassword: tempPasswordInput },
      }
    );

    setResetPasswordBusy(false);
    if (res.status !== 'OK') {
      setResetPasswordError(res.message);
      return;
    }

    setResetPasswordResult({
      temporaryPassword: res.data.temporaryPassword,
      message: res.data.message,
    });
    setResetPasswordSuccess('Temporary password set successfully.');
    setDetailMsg('Active employee sessions revoked. Mandatory password change pending.');
  };

  const handleLoadHistory = async () => {
    if (!selectedEmp) return;
    setDetailError(null);
    setLifecycleBusy(true);
    const res = await apiRequest<{
      attendance?: unknown[];
      leaves?: unknown[];
      fieldSessions?: unknown[];
      payslips?: unknown[];
    }>(`/api/v1/admin/employees/${encodeURIComponent(selectedEmp.id)}/history`, getInMemoryAccessToken());
    setLifecycleBusy(false);
    if (res.status !== 'OK') {
      setDetailError(res.message);
      return;
    }
    setHistoryData({
      attendanceCount: res.data.attendance?.length ?? 0,
      leavesCount: res.data.leaves?.length ?? 0,
      fieldSessionsCount: res.data.fieldSessions?.length ?? 0,
      payslipsCount: res.data.payslips?.length ?? 0,
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/60">
              <Users className="w-3 h-3 text-indigo-600" />
              Directory &amp; Governance
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs font-mono font-medium text-slate-500">
              Max Roster: {HRMS_POLICY.INITIAL_DEPLOYMENT_EMPLOYEES}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-1">
            Employee Directory
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Role-isolated personnel management. Admin credentials are strictly separated from employee rosters and payroll.
          </p>
        </div>

        <Button onClick={() => setProvisionOpen(true)} className="shadow-sm">
          <UserPlus className="w-4 h-4 mr-1.5" />
          Provision Employee
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Total Roster"
          value={kpiStats.total}
          unit={`/ ${HRMS_POLICY.INITIAL_DEPLOYMENT_EMPLOYEES}`}
          icon={Users}
          tone="primary"
          subtitle="Governed employee accounts"
        />
        <MetricCard
          label="Active Accounts"
          value={kpiStats.active}
          icon={CheckCircle2}
          tone="success"
          subtitle="Authentication enabled"
        />
        <MetricCard
          label="Face Enrolled"
          value={kpiStats.faceEnrolled}
          icon={ScanFace}
          tone="warning"
          subtitle="CompreFace biometric mapped"
        />
        <MetricCard
          label="Field Operations"
          value={kpiStats.fieldAgents}
          icon={MapPin}
          tone="info"
          subtitle="Sales & Recovery personnel"
        />
      </div>

      {state.status === 'unavailable' && (
        <StatusBanner
          tone="unavailable"
          title="Employee Directory Endpoint Unavailable"
          description={state.message}
        />
      )}

      {/* Data Table */}
      <DataTable
        title="Personnel Roster"
        description="Click any row to manage profile details, reset single-use credentials, or inspect activity history."
        searchPlaceholder="Search by name, code, dept..."
        searchValue={query}
        onSearchChange={setQuery}
        filterSlot={
          <div className="w-48">
            <Select
              selectSize="sm"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Filter by job classification"
            >
              <option value="ALL">All Classifications</option>
              {JOB_CATEGORY_OPTIONS.map((cat) => (
                <option key={cat} value={cat}>
                  {formatJobCategoryLabel(cat)}
                </option>
              ))}
            </Select>
          </div>
        }
        totalCount={roster.length}
        filteredCount={filtered.length}
        isLoading={state.status === 'loading'}
        error={state.status === 'error' ? state.message : null}
        onRetry={reload}
        emptyTitle="No employees found"
        emptyDescription={
          roster.length === 0
            ? 'No genuine employee records are stored in this tenant yet. Provision an employee account to begin.'
            : 'No employees match the active search query or classification filter.'
        }
        onClearFilters={
          query || categoryFilter !== 'ALL'
            ? () => {
                setQuery('');
                setCategoryFilter('ALL');
              }
            : undefined
        }
      >
        <table className="w-full text-xs text-left">
          <thead className="bg-slate-50/90 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200 font-semibold">
            <tr>
              <th className="py-3 px-4">Employee</th>
              <th className="py-3 px-4">Classification &amp; Dept</th>
              <th className="py-3 px-4">Mobile (+91)</th>
              <th className="py-3 px-4">Biometrics</th>
              <th className="py-3 px-4 text-right">Monthly Ref</th>
              <th className="py-3 px-4 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((emp) => (
              <tr
                key={emp.id}
                onClick={() => openEmployeeModal(emp)}
                className="hover:bg-indigo-50/30 cursor-pointer transition-colors group"
              >
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-50 text-[#0B357A] font-bold flex items-center justify-center text-xs shrink-0 border border-blue-200/80 group-hover:bg-[#0B357A] group-hover:text-white transition-colors">
                      {(() => {
                        const parts = emp.fullName.trim().split(/\s+/).filter(Boolean);
                        if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
                        return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
                      })()}
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900 group-hover:text-[#0B357A] transition-colors">
                        {emp.fullName}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 tracking-tight">
                        {emp.employeeCode}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="py-3 px-4">
                  <div className="font-medium text-slate-800">
                    {formatJobCategoryLabel(emp.jobCategory)}
                  </div>
                  <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                    <Building2 className="w-3 h-3 text-slate-400" />
                    {emp.department || 'Unassigned'}
                  </div>
                </td>
                <td className="py-3 px-4 font-mono tabular-nums text-slate-600">
                  {emp.phoneNumber}
                </td>
                <td className="py-3 px-4">
                  <span
                    className={cn(
                      'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-tight',
                      emp.faceEnrollmentStatus === 'APPROVED'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                    )}
                  >
                    {emp.faceEnrollmentStatus === 'APPROVED' ? 'ENROLLED' : 'NOT ENROLLED'}
                  </span>
                </td>
                <td className="py-3 px-4 font-mono tabular-nums text-right font-medium text-slate-900">
                  {formatInr(emp.monthlySalaryReference)}
                </td>
                <td className="py-3 px-4 text-center">
                  <span
                    className={cn(
                      'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-tight',
                      emp.employmentStatus === 'ACTIVE'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    )}
                  >
                    {emp.employmentStatus}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTable>

      {/* Employee Detail & Lifecycle Drawer */}
      <Dialog
        open={Boolean(selectedEmp)}
        onClose={() => setSelectedEmp(null)}
        title={selectedEmp ? `${selectedEmp.fullName}` : ''}
        description={selectedEmp ? `${selectedEmp.designation || 'Staff'} • ${selectedEmp.department}` : ''}
      >
        {selectedEmp && (
          <div className="space-y-4 text-xs">
            {/* Quick Metadata Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Employee Code</p>
                <p className="font-mono font-bold text-slate-900 mt-1">{selectedEmp.employeeCode}</p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Classification</p>
                <p className="font-semibold text-slate-900 mt-1">{formatJobCategoryLabel(selectedEmp.jobCategory)}</p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Registered Mobile</p>
                <p className="font-mono font-semibold text-slate-900 mt-1 flex items-center gap-1">
                  <Phone className="w-3 h-3 text-slate-400" />
                  {selectedEmp.phoneNumber}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Joining Date</p>
                <p className="font-mono font-semibold text-slate-900 mt-1 flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-slate-400" />
                  {selectedEmp.joiningDate || 'N/A'}
                </p>
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 flex items-center gap-2.5 text-[11px] text-slate-600">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                PO-01 Isolation: Internal auth emails are synthetic and never exposed or stored in employee profiles.
              </span>
            </div>

            {detailError && <StatusBanner tone="error" title="Action Failed" description={detailError} />}
            {detailMsg && <StatusBanner tone="success" title="Success" description={detailMsg} />}

            {/* Edit Form */}
            <form onSubmit={handleSaveEmployeeEdit} className="rounded-xl border border-slate-200 p-4 space-y-3 bg-white shadow-sm">
              <p className="font-bold text-slate-900 text-sm">Edit Profile &amp; Salary Reference</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Full Legal Name" required>
                  <Input
                    inputSize="sm"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Full Name"
                    required
                  />
                </FormField>
                <FormField label="Job Classification" required>
                  <Select
                    selectSize="sm"
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value as JobCategory)}
                  >
                    {JOB_CATEGORY_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {formatJobCategoryLabel(c)}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Department">
                  <Input
                    inputSize="sm"
                    value={editDepartment}
                    onChange={(e) => setEditDepartment(e.target.value)}
                    placeholder="Department"
                  />
                </FormField>
                <FormField label="Monthly Salary Reference (INR)" helperText="Used for hourly wage calculations (1/208)">
                  <Input
                    inputSize="sm"
                    type="number"
                    min="1"
                    value={editSalary}
                    onChange={(e) => setEditSalary(e.target.value)}
                    placeholder="e.g. 25000"
                    className="font-mono tabular-nums"
                  />
                </FormField>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" loading={lifecycleBusy} onClick={handleOpenResetDialog}>
                    <KeyRound className="w-3.5 h-3.5 mr-1" />
                    Reset Password
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={selectedEmp.isActive !== false ? 'destructive' : 'success'}
                    loading={lifecycleBusy}
                    onClick={handleToggleActivation}
                  >
                    <Power className="w-3.5 h-3.5 mr-1" />
                    {selectedEmp.isActive !== false ? 'Deactivate' : 'Activate'}
                  </Button>
                  <Button type="button" size="sm" variant="outline" loading={lifecycleBusy} onClick={handleLoadHistory}>
                    <History className="w-3.5 h-3.5 mr-1" />
                    Load History
                  </Button>
                </div>
                <Button type="submit" size="sm" loading={lifecycleBusy}>
                  <Save className="w-3.5 h-3.5 mr-1" />
                  Save Changes
                </Button>
              </div>
            </form>

            {historyData && (
              <div className="grid grid-cols-4 gap-2.5 text-center">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Attendance</p>
                  <p className="font-mono text-base font-bold text-slate-900 mt-0.5 tabular-nums">{historyData.attendanceCount}</p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Leaves</p>
                  <p className="font-mono text-base font-bold text-slate-900 mt-0.5 tabular-nums">{historyData.leavesCount}</p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Field Sessions</p>
                  <p className="font-mono text-base font-bold text-slate-900 mt-0.5 tabular-nums">{historyData.fieldSessionsCount}</p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Payslips</p>
                  <p className="font-mono text-base font-bold text-slate-900 mt-0.5 tabular-nums">{historyData.payslipsCount}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </Dialog>

      {/* Direct Employee Account Provisioning Dialog */}
      <Dialog
        open={provisionOpen}
        onClose={() => setProvisionOpen(false)}
        title="Provision Employee Account"
        description="Creates an active EMPLOYEE account ready for immediate login. Enter employee details, assign mobile number and configure their initial password."
      >
        <form onSubmit={handleProvisionSubmit} className="space-y-4 text-xs">
          {formUnavailable && (
            <StatusBanner tone="unavailable" title="Backend Endpoint Pending" description={formUnavailable} />
          )}
          {formError && <StatusBanner tone="error" title="Validation Error" description={formError} />}
          {formSuccess && <StatusBanner tone="success" title="Account Created" description={formSuccess} />}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <FormField label="Full Legal Name" required>
              <Input
                inputSize="md"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Rahul Sharma"
              />
            </FormField>

            <FormField label="Employee Code" helperText="Auto-assigned if left blank">
              <Input
                inputSize="md"
                value={employeeCode}
                onChange={(e) => setEmployeeCode(e.target.value)}
                placeholder="e.g. EMP005"
                className="font-mono uppercase"
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <FormField label="Indian Mobile Number (PO-02)" required helperText="10-digit primary contact number">
              <Input
                inputSize="md"
                type="tel"
                required
                value={mobileInput}
                onChange={(e) => setMobileInput(e.target.value)}
                placeholder="9876543210"
                className="font-mono tabular-nums"
                leftIcon={<Phone className="w-4 h-4 text-slate-400" />}
              />
            </FormField>

            <FormField label="Job Classification" required>
              <Select
                selectSize="md"
                value={jobCategory}
                onChange={(e) => setJobCategory(e.target.value as JobCategory)}
              >
                {JOB_CATEGORY_OPTIONS.map((cat) => (
                  <option key={cat} value={cat}>
                    {formatJobCategoryLabel(cat)}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <FormField label="Initial Password" required helperText="Minimum 8 characters">
              <div className="relative">
                <Input
                  inputSize="md"
                  type={showProvisionPassword ? 'text' : 'password'}
                  required
                  value={initialPassword}
                  onChange={(e) => setInitialPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  leftIcon={<Lock className="w-4 h-4 text-slate-400" />}
                />
                <button
                  type="button"
                  onClick={() => setShowProvisionPassword((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  tabIndex={-1}
                  aria-label={showProvisionPassword ? 'Hide password' : 'Show password'}
                >
                  {showProvisionPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </FormField>

            <FormField label="Confirm Initial Password" required helperText="Must match initial password">
              <Input
                inputSize="md"
                type={showProvisionPassword ? 'text' : 'password'}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-type initial password"
                leftIcon={<Lock className="w-4 h-4 text-slate-400" />}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <FormField label="Department" required>
              <Input
                inputSize="md"
                required
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="e.g. Operations"
                leftIcon={<Building2 className="w-4 h-4 text-slate-400" />}
              />
            </FormField>

            <FormField label="Designation">
              <Input
                inputSize="md"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                placeholder="e.g. Executive"
                leftIcon={<Briefcase className="w-4 h-4 text-slate-400" />}
              />
            </FormField>

            <FormField label="Monthly Ref (INR)" helperText="Base wage reference">
              <Input
                inputSize="md"
                type="number"
                min="0"
                value={monthlySalaryReference}
                onChange={(e) => setMonthlySalaryReference(e.target.value)}
                placeholder="25000"
                className="font-mono tabular-nums"
              />
            </FormField>
          </div>

          <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-200">
            <Button type="button" variant="outline" onClick={() => setProvisionOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              <UserPlus className="w-3.5 h-3.5 mr-1" />
              Create Active Employee
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Admin Direct Password Reset Dialog (GAP-02) */}
      <Dialog
        open={resetPasswordOpen}
        onClose={() => setResetPasswordOpen(false)}
        title="Reset Employee Credentials"
        description="Directly assign a new temporary password for this employee. All active sessions will be revoked and a mandatory password change will be enforced on their next login."
      >
        <div className="space-y-4 text-xs">
          {selectedEmp && (
            <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="font-semibold text-slate-800">{selectedEmp.fullName}</span>
                <div className="text-slate-500 flex items-center gap-2">
                  <span className="font-mono bg-slate-200/70 text-slate-700 px-1.5 py-0.5 rounded text-[11px]">
                    {selectedEmp.employeeCode}
                  </span>
                  <span>{selectedEmp.phoneNumber}</span>
                </div>
              </div>
              <span className="text-[11px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
                {selectedEmp.jobCategory}
              </span>
            </div>
          )}

          {resetPasswordError && (
            <StatusBanner tone="error" title="Reset Error" description={resetPasswordError} />
          )}

          {resetPasswordSuccess && resetPasswordResult ? (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-3">
                <div className="flex items-center gap-2 text-emerald-800 font-semibold">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <span>Temporary Credentials Ready</span>
                </div>
                <p className="text-slate-600 text-[11px] leading-relaxed">
                  All active device sessions for this employee have been terminated. Provide these temporary credentials to the employee. They must set a confidential permanent password upon signing in.
                </p>
                <div className="p-3 bg-white border border-emerald-200/80 rounded-lg flex items-center justify-between font-mono text-sm text-slate-900">
                  <span className="font-bold tracking-wide">{resetPasswordResult.temporaryPassword}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleCopyCredentials}
                    className="h-8 text-xs border-emerald-300 text-emerald-800 hover:bg-emerald-50"
                  >
                    {copiedTempPassword ? (
                      <>
                        <Check className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 mr-1" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <div className="flex justify-end pt-2 border-t border-slate-200">
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => {
                    setResetPasswordOpen(false);
                    setResetPasswordResult(null);
                  }}
                >
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleExecuteResetPassword} className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-700 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-slate-400" />
                    Temporary Password
                  </label>
                  <button
                    type="button"
                    onClick={handleGenerateRandomPassword}
                    className="text-[11px] text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Regenerate
                  </button>
                </div>
                <div className="relative">
                  <Input
                    inputSize="md"
                    type={showTempPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={tempPasswordInput}
                    onChange={(e) => setTempPasswordInput(e.target.value)}
                    placeholder="Enter or generate temporary password"
                    className="font-mono pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTempPassword(!showTempPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                  >
                    {showTempPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">
                  Must be at least 8 characters. The employee will be forced to change this immediately after sign-in.
                </p>
              </div>

              <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-lg text-[11px] text-amber-900 leading-relaxed">
                <span className="font-semibold">Security Notice:</span> Submitting this form will immediately revoke all current device sessions and tokens for this employee across all devices.
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-200">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setResetPasswordOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="destructive"
                  loading={resetPasswordBusy}
                  disabled={tempPasswordInput.length < 8}
                >
                  <KeyRound className="w-3.5 h-3.5 mr-1" />
                  Reset &amp; Revoke Sessions
                </Button>
              </div>
            </form>
          )}
        </div>
      </Dialog>
    </div>
  );
};
