import React, { useMemo, useState } from 'react';
import {
  Briefcase,
  Building2,
  MapPin,
  Plus,
  ShieldAlert,
  UserCheck,
  Users,
  Layers,
  Sparkles,
} from 'lucide-react';
import type { EmployeeProfile } from '../../types/hrms';
import { formatJobCategoryLabel, type JobCategory } from '../../types/role';
import { excludeAdminFromEmployees, HRMS_POLICY } from '../../lib/domainRules';
import { useAuth } from '../../context/AuthContext';
import { useApiResource } from '../../hooks/useApiResource';
import { apiRequest } from '../../lib/apiClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { MetricCard } from '../../components/ui/MetricCard';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';

interface DepartmentItem {
  id: string;
  code: string;
  name: string;
  allow_field_attendance: boolean;
}

interface DesignationItem {
  id: string;
  department_id: string;
  title: string;
  job_category: JobCategory;
}

export const AdminTeamsPage: React.FC = () => {
  const { getInMemoryAccessToken } = useAuth();
  const { state, data } = useApiResource<{ employees: EmployeeProfile[] }>(
    '/api/v1/admin/employees',
    { employees: [] }
  );
  const deptRes = useApiResource<{ departments: DepartmentItem[]; designations: DesignationItem[] }>(
    '/api/v1/admin/departments',
    { departments: [], designations: [] }
  );

  const [deptName, setDeptName] = useState('');
  const [allowFieldDept, setAllowFieldDept] = useState(false);
  const [desigTitle, setDesigTitle] = useState('');
  const [desigDeptId, setDesigDeptId] = useState('');
  const [desigCategory, setDesigCategory] = useState<JobCategory>('OFFICE');
  const [orgBusy, setOrgBusy] = useState(false);
  const [orgMsg, setOrgMsg] = useState<string | null>(null);
  const [orgErr, setOrgErr] = useState<string | null>(null);

  const handleCreateDept = async (e: React.FormEvent) => {
    e.preventDefault();
    setOrgErr(null);
    setOrgMsg(null);
    setOrgBusy(true);
    const res = await apiRequest('/api/v1/admin/departments', getInMemoryAccessToken(), {
      method: 'POST',
      body: { name: deptName.trim(), allowFieldAttendance: allowFieldDept },
    });
    setOrgBusy(false);
    if (res.status !== 'OK') {
      setOrgErr(res.message);
      return;
    }
    setOrgMsg(`Department "${deptName.trim()}" created successfully.`);
    setDeptName('');
    setAllowFieldDept(false);
    deptRes.reload();
  };

  const handleCreateDesig = async (e: React.FormEvent) => {
    e.preventDefault();
    setOrgErr(null);
    setOrgMsg(null);
    const targetDeptId = desigDeptId || deptRes.data.departments[0]?.id || '';
    if (!targetDeptId) {
      setOrgErr('Create or select a department first.');
      return;
    }
    setOrgBusy(true);
    const res = await apiRequest('/api/v1/admin/designations', getInMemoryAccessToken(), {
      method: 'POST',
      body: {
        title: desigTitle.trim(),
        departmentId: targetDeptId,
        jobCategory: desigCategory,
      },
    });
    setOrgBusy(false);
    if (res.status !== 'OK') {
      setOrgErr(res.message);
      return;
    }
    setOrgMsg(`Designation "${desigTitle.trim()}" created.`);
    setDesigTitle('');
    deptRes.reload();
  };

  const employees = useMemo(() => excludeAdminFromEmployees(data.employees), [data.employees]);
  const salesTeam = useMemo(
    () => employees.filter((e) => e.jobCategory === 'SALES'),
    [employees]
  );
  const recoveryTeam = useMemo(
    () => employees.filter((e) => e.jobCategory === 'RECOVERY'),
    [employees]
  );
  const officeSupportTeam = useMemo(
    () =>
      employees.filter(
        (e) =>
          e.jobCategory === 'OFFICE' ||
          e.jobCategory === 'HR' ||
          e.jobCategory === 'FINANCE'
      ),
    [employees]
  );

  const renderTeamList = (members: EmployeeProfile[], emptyLabel: string) => {
    if (state.status === 'loading') {
      return <EmptyState variant="loading" title="Loading team roster..." compact />;
    }
    if (members.length === 0) {
      return <EmptyState variant="empty" title={emptyLabel} compact />;
    }
    return (
      <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto pr-1">
        {members.map((m) => (
          <div key={m.id} className="py-2.5 flex items-center justify-between gap-3 text-xs hover:bg-slate-50/70 px-2 rounded-lg transition-colors">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-full bg-blue-50 text-[#0B357A] font-bold flex items-center justify-center text-[10px] shrink-0 border border-blue-200">
                {(() => {
                  const parts = m.fullName.trim().split(/\s+/).filter(Boolean);
                  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
                  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
                })()}
              </div>
              <div className="truncate">
                <p className="font-semibold text-slate-900 truncate">
                  <span className="font-mono text-indigo-600 mr-1.5 text-[11px]">{m.employeeCode}</span>
                  {m.fullName}
                </p>
                <p className="text-[11px] text-slate-500 truncate mt-0.5">
                  {m.designation || formatJobCategoryLabel(m.jobCategory)} • {m.department || 'HQ'}
                </p>
              </div>
            </div>
            <Badge
              variant={m.employmentStatus === 'ACTIVE' ? 'success' : 'outline'}
              className="text-[10px] shrink-0"
            >
              {m.employmentStatus}
            </Badge>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/60">
              <Users className="w-3 h-3 text-indigo-600" />
              Organizational Hierarchy
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs font-mono font-medium text-slate-500">
              Total Personnel: {employees.length}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-1">
            Teams &amp; Organizational Structure
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Role-isolated classification governance. Configure departments, designation ladders, and field eligibility policies.
          </p>
        </div>
      </div>

      {state.status === 'unavailable' && (
        <StatusBanner
          tone="unavailable"
          title="Team Directory Backend Pending"
          description={state.message}
        />
      )}

      {/* KPI Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Sales Force"
          value={salesTeam.length}
          icon={UserCheck}
          tone="primary"
          subtitle="Outside geofence eligible"
        />
        <MetricCard
          label="Recovery Agents"
          value={recoveryTeam.length}
          icon={MapPin}
          tone="warning"
          subtitle="Non-collection policy strictly enforced"
        />
        <MetricCard
          label="HQ &amp; Administration"
          value={officeSupportTeam.length}
          icon={Briefcase}
          tone="success"
          subtitle={`Mandatory ${HRMS_POLICY.OFFICE_GEOFENCE_RADIUS_METERS}m perimeter`}
        />
        <MetricCard
          label="Departments"
          value={deptRes.data.departments.length}
          unit={`/ ${deptRes.data.designations.length} titles`}
          icon={Layers}
          tone="info"
          subtitle="Configured organizational units"
        />
      </div>

      {/* 3 Team Classification Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="shadow-card">
          <CardHeader className="pb-3 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm">
                <div className="w-7 h-7 rounded-lg bg-indigo-50 border border-indigo-200/60 flex items-center justify-center text-indigo-700">
                  <UserCheck className="w-3.5 h-3.5" />
                </div>
                Sales Force ({salesTeam.length})
              </CardTitle>
              <Badge variant="primary" className="text-[10px]">Field Eligible</Badge>
            </div>
            <CardDescription className="text-xs text-slate-500 mt-1">
              Field duty allowed. Remote check-ins trigger Admin Review with GPS audit evidence.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-3">{renderTeamList(salesTeam, 'No sales personnel enrolled.')}</CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader className="pb-3 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm">
                <div className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-200/60 flex items-center justify-center text-amber-700">
                  <MapPin className="w-3.5 h-3.5" />
                </div>
                Recovery Officers ({recoveryTeam.length})
              </CardTitle>
              <Badge variant="warning" className="text-[10px]">Audit Only</Badge>
            </div>
            <CardDescription className="text-xs text-slate-500 mt-1">
              Field follow-ups &amp; customer visits only. Cash collection is strictly prohibited.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-3 space-y-3">
            {renderTeamList(recoveryTeam, 'No recovery personnel enrolled.')}
            <div className="rounded-lg bg-amber-50/80 border border-amber-200 p-2.5 text-[11px] text-amber-900 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <span>
                <strong>Non-Collection Policy:</strong> Recovery staff record arrival/departure GPS coordinates. Receipts &amp; payments must be completed via certified banking rails.
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader className="pb-3 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm">
                <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-200/60 flex items-center justify-center text-emerald-700">
                  <Briefcase className="w-3.5 h-3.5" />
                </div>
                Office, HR &amp; Finance ({officeSupportTeam.length})
              </CardTitle>
              <Badge variant="success" className="text-[10px]">On-Premises</Badge>
            </div>
            <CardDescription className="text-xs text-slate-500 mt-1">
              Strictly enforced inside the {HRMS_POLICY.OFFICE_GEOFENCE_RADIUS_METERS}m HQ boundary. Remote check-ins are blocked.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-3">{renderTeamList(officeSupportTeam, 'No office personnel enrolled.')}</CardContent>
        </Card>
      </div>

      {/* Organizational Structure Configuration */}
      <Card className="shadow-card">
        <CardHeader className="border-b border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="w-4 h-4 text-indigo-600" />
                Departments &amp; Designations Directory
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Structured database entities for department divisions and functional designations.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                {deptRes.data.departments.length} Depts
              </span>
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                {deptRes.data.designations.length} Titles
              </span>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-4 text-xs">
          {orgErr && <StatusBanner tone="error" title="Validation Error" description={orgErr} />}
          {orgMsg && <StatusBanner tone="success" title="Saved" description={orgMsg} />}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Create Department Form */}
            <form onSubmit={handleCreateDept} className="rounded-xl border border-slate-200 p-4 space-y-3 bg-slate-50/50">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider">Create New Department</h4>
              </div>

              <FormField label="Department Name" required>
                <div className="flex gap-2">
                  <Input
                    inputSize="md"
                    required
                    value={deptName}
                    onChange={(e) => setDeptName(e.target.value)}
                    placeholder="e.g. Corporate Finance"
                    className="flex-1"
                  />
                  <Button type="submit" size="md" loading={orgBusy} className="shrink-0">
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Add Dept
                  </Button>
                </div>
              </FormField>

              <label className="flex items-center gap-2.5 cursor-pointer text-xs text-slate-600 pt-1 select-none">
                <input
                  type="checkbox"
                  checked={allowFieldDept}
                  onChange={(e) => setAllowFieldDept(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                />
                <span>Allow field duty exceptions for this department</span>
              </label>
            </form>

            {/* Create Designation Form */}
            <form onSubmit={handleCreateDesig} className="rounded-xl border border-slate-200 p-4 space-y-3 bg-slate-50/50">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-600" />
                <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider">Create Designation</h4>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <FormField label="Designation Title" required>
                  <Input
                    inputSize="md"
                    required
                    value={desigTitle}
                    onChange={(e) => setDesigTitle(e.target.value)}
                    placeholder="e.g. Field Executive"
                  />
                </FormField>

                <FormField label="Target Department" required>
                  <Select
                    selectSize="md"
                    value={desigDeptId || deptRes.data.departments[0]?.id || ''}
                    onChange={(e) => setDesigDeptId(e.target.value)}
                  >
                    {deptRes.data.departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </Select>
                </FormField>

                <FormField label="Job Classification" required>
                  <Select
                    selectSize="md"
                    value={desigCategory}
                    onChange={(e) => setDesigCategory(e.target.value as JobCategory)}
                  >
                    <option value="OFFICE">Office</option>
                    <option value="HR">HR</option>
                    <option value="FINANCE">Finance</option>
                    <option value="SALES">Sales</option>
                    <option value="RECOVERY">Recovery</option>
                  </Select>
                </FormField>
              </div>

              <div className="flex justify-end pt-1">
                <Button type="submit" size="md" loading={orgBusy}>
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add Designation
                </Button>
              </div>
            </form>
          </div>

          {/* Department Chips List */}
          {deptRes.data.departments.length > 0 && (
            <div className="pt-2">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Active Organizational Departments
              </p>
              <div className="flex flex-wrap gap-2">
                {deptRes.data.departments.map((d) => (
                  <div
                    key={d.id}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white shadow-2xs text-xs font-medium text-slate-800"
                  >
                    <Building2 className="w-3.5 h-3.5 text-slate-400" />
                    <span>{d.name}</span>
                    <span className="font-mono text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                      {d.code}
                    </span>
                    {d.allow_field_attendance && (
                      <Badge variant="primary" className="text-[9px] py-0 px-1.5">
                        Field
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
