import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  Link2,
  LogOut,
  MonitorSmartphone,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  ShieldX,
  Lock,
  Smartphone,
  Eye,
  Camera,
  Activity,
} from 'lucide-react';
import type { DeviceSessionRecord, EmployeeProfile } from '../../types/hrms';
import { excludeAdminFromEmployees } from '../../lib/domainRules';
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

interface BiometricQueueRow {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  status: string;
  consent_given: boolean;
  evidence_signed_url?: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
}

interface CompreFaceMappingRow {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  employment_status: string;
  provider_name: string;
  provider_collection_key: string | null;
  provider_subject: string;
  biometric_enrollment_id: string | null;
  status: 'ACTIVE' | 'REVOKED';
  assigned_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  notes: string | null;
}

interface CompreFaceSubjectRow {
  subject: string;
  assignedEmployeeId: string | null;
  assignedEmployeeCode: string | null;
  assignedEmployeeName: string | null;
}

export const AdminSecurityPage: React.FC = () => {
  const { user, logout, getInMemoryAccessToken } = useAuth();
  const { state, data, reload } = useApiResource<{ sessions: DeviceSessionRecord[] }>(
    '/api/v1/auth/sessions',
    { sessions: [] }
  );
  const {
    state: bioState,
    data: bioData,
    reload: reloadBiometrics,
  } = useApiResource<{ enrollments: BiometricQueueRow[] }>(
    '/api/v1/admin/biometrics',
    { enrollments: [] }
  );
  const {
    state: mappingState,
    data: mappingData,
    reload: reloadMappings,
  } = useApiResource<{ mappings: CompreFaceMappingRow[] }>(
    '/api/v1/admin/biometrics/mappings',
    { mappings: [] }
  );
  const {
    state: subjectState,
    data: subjectData,
    reload: reloadSubjects,
  } = useApiResource<{ available: boolean; subjects: CompreFaceSubjectRow[] }>(
    '/api/v1/admin/biometrics/compreface/subjects',
    { available: false, subjects: [] }
  );
  const { data: empData } = useApiResource<{ employees: EmployeeProfile[] }>(
    '/api/v1/admin/employees',
    { employees: [] }
  );

  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);

  const [bioReasons, setBioReasons] = useState<Record<string, string>>({});
  const [bioBusyId, setBioBusyId] = useState<string | null>(null);
  const [bioNotice, setBioNotice] = useState<string | null>(null);

  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [mappingNotes, setMappingNotes] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [mappingSuccess, setMappingSuccess] = useState<string | null>(null);
  const [revokeReasons, setRevokeReasons] = useState<Record<string, string>>({});
  const [revokeMappingBusyId, setRevokeMappingBusyId] = useState<string | null>(null);

  const assignableEmployees = useMemo(
    () => excludeAdminFromEmployees(empData.employees),
    [empData.employees]
  );
  const activeMappings = useMemo(
    () => mappingData.mappings.filter((m) => m.status === 'ACTIVE'),
    [mappingData.mappings]
  );
  const revokedMappings = useMemo(
    () => mappingData.mappings.filter((m) => m.status === 'REVOKED'),
    [mappingData.mappings]
  );

  const handleRevoke = async (sessionId: string) => {
    setActionMsg(null);
    setRevokingId(sessionId);
    const res = await apiRequest<{ revoked: boolean }>(
      `/api/v1/auth/sessions/${encodeURIComponent(sessionId)}/revoke`,
      getInMemoryAccessToken(),
      { method: 'POST' }
    );
    setRevokingId(null);

    if (res.status !== 'OK') {
      setActionMsg(res.message);
      return;
    }
    reload();
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(null);

    if (!currentPassword || newPassword.length < 8) {
      setPwError('Current password and a new password (min 8 characters) are required.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('New password and confirmation do not match.');
      return;
    }

    setPwBusy(true);
    const res = await apiRequest<{ message?: string }>(
      '/api/v1/auth/change-password',
      getInMemoryAccessToken(),
      {
        method: 'POST',
        body: { currentPassword, newPassword },
      }
    );
    setPwBusy(false);

    if (res.status !== 'OK') {
      setPwError(res.message);
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPwSuccess(res.data.message || 'Admin password updated securely.');
    reload();
  };

  const handleBiometricReview = async (
    id: string,
    decision: 'APPROVED' | 'REJECTED' | 'REVOKED'
  ) => {
    setBioNotice(null);
    setBioBusyId(id);
    const res = await apiRequest<{ updated: boolean }>(
      `/api/v1/admin/biometrics/${encodeURIComponent(id)}/review`,
      getInMemoryAccessToken(),
      {
        method: 'POST',
        body: {
          decision,
          reason: bioReasons[id]?.trim() || `Biometric ${decision.toLowerCase()} by Admin`,
        },
      }
    );
    setBioBusyId(null);
    if (res.status !== 'OK') {
      setBioNotice(res.message);
      return;
    }
    reloadBiometrics();
  };

  const handleAssignSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    setMappingError(null);
    setMappingSuccess(null);

    if (!selectedEmployeeId || !selectedSubject) {
      setMappingError('Please select both an employee and a CompreFace subject.');
      return;
    }

    setAssignBusy(true);
    const res = await apiRequest<{ mapping: CompreFaceMappingRow }>(
      '/api/v1/admin/biometrics/mappings',
      getInMemoryAccessToken(),
      {
        method: 'POST',
        body: {
          employeeId: selectedEmployeeId,
          providerSubject: selectedSubject,
          notes: mappingNotes.trim() || undefined,
        },
      }
    );
    setAssignBusy(false);

    if (res.status !== 'OK') {
      setMappingError(res.message);
      return;
    }

    setSelectedSubject('');
    setMappingNotes('');
    setMappingSuccess(`Assigned CompreFace subject "${res.data.mapping.provider_subject}" cleanly.`);
    reloadMappings();
    reloadSubjects();
  };

  const handleRevokeMapping = async (mappingId: string) => {
    setMappingError(null);
    setMappingSuccess(null);
    setRevokeMappingBusyId(mappingId);
    const res = await apiRequest<{ mapping: CompreFaceMappingRow }>(
      `/api/v1/admin/biometrics/mappings/${encodeURIComponent(mappingId)}/revoke`,
      getInMemoryAccessToken(),
      {
        method: 'POST',
        body: {
          reason: revokeReasons[mappingId]?.trim() || 'Revoked from Admin Biometric Management',
        },
      }
    );
    setRevokeMappingBusyId(null);

    if (res.status !== 'OK') {
      setMappingError(res.message);
      return;
    }

    setMappingSuccess(`Revoked mapping for subject "${res.data.mapping.provider_subject}".`);
    reloadMappings();
    reloadSubjects();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/60">
              <ShieldCheck className="w-3 h-3 text-indigo-600" />
              Security &amp; Device Sessions
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs font-mono font-medium text-slate-500">
              User: {user?.phoneNumber ?? 'ADMIN'}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-1">
            Admin Security &amp; Biometric Governance
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage multi-device session revocation (PO-07), live employee selfie approvals, and CompreFace subject mappings.
          </p>
        </div>

        <Button
          variant="destructive"
          size="sm"
          onClick={() => void logout()}
          className="shadow-2xs"
        >
          <LogOut className="w-3.5 h-3.5 mr-1.5" />
          Sign Out Admin Session
        </Button>
      </div>

      {state.status === 'unavailable' && (
        <StatusBanner tone="unavailable" title="Session Directory API Pending" description={state.message} />
      )}
      {actionMsg && <StatusBanner tone="error" title="Session Action Notice" description={actionMsg} />}

      {/* Security Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Active Sessions"
          value={data.sessions.length}
          icon={MonitorSmartphone}
          tone="primary"
          subtitle="Signed-in Admin devices"
        />
        <MetricCard
          label="Pending Biometrics"
          value={bioData.enrollments.filter((e) => e.status === 'PENDING').length}
          icon={ScanFace}
          tone={bioData.enrollments.some((e) => e.status === 'PENDING') ? 'warning' : 'default'}
          subtitle="Selfies awaiting review"
        />
        <MetricCard
          label="CompreFace Mappings"
          value={activeMappings.length}
          unit={`/ ${subjectData.subjects.length} subjects`}
          icon={Link2}
          tone="success"
          subtitle="Active 1:1 biometric bindings"
        />
        <MetricCard
          label="Recognition Service"
          value={subjectData.available ? 'Online' : 'Unavailable'}
          icon={Activity}
          tone={subjectData.available ? 'success' : 'warning'}
          subtitle="CompreFace self-hosted API"
        />
      </div>

      {/* Multi-Device Sessions */}
      <Card className="shadow-card">
        <CardHeader className="border-b border-slate-100 pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <MonitorSmartphone className="w-4 h-4 text-indigo-600" />
              Active Admin Device Sessions ({data.sessions.length})
            </CardTitle>
            <Badge variant="outline" className="text-[10px]">PO-07 Policy Enforced</Badge>
          </div>
          <CardDescription className="text-xs text-slate-500">
            Inspect active login tokens and remotely revoke unverified devices.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-3">
          {state.status === 'loading' ? (
            <EmptyState variant="loading" title="Loading active sessions..." compact />
          ) : data.sessions.length === 0 ? (
            <EmptyState
              variant="empty"
              title="No active multi-device sessions recorded."
              description="Device session history will display here once remote logins are active."
              compact
            />
          ) : (
            <div className="divide-y divide-slate-100 text-xs">
              {data.sessions.map((s) => (
                <div
                  key={s.id}
                  className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/50 px-2 rounded-lg transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-200/60 flex items-center justify-center text-indigo-700 shrink-0">
                      <Smartphone className="w-4 h-4" />
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900">{s.deviceName}</span>
                        {s.isCurrent && (
                          <Badge variant="success" dot className="text-[10px]">
                            Current Session
                          </Badge>
                        )}
                      </div>
                      <p className="font-mono text-[11px] text-slate-500 tabular-nums">
                        {s.platform || 'Browser'} • IP: {s.ipSummary || s.ipAddressMasked || 'Masked'} • Active: {s.lastActiveAt}
                      </p>
                    </div>
                  </div>

                  {!s.isCurrent && (
                    <Button
                      size="sm"
                      variant="destructive"
                      loading={revokingId === s.id}
                      onClick={() => handleRevoke(s.id)}
                      className="h-8 text-xs px-2.5 shrink-0"
                    >
                      Revoke Device
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Biometric Enrollment Queue */}
      <Card className="shadow-card">
        <CardHeader className="border-b border-slate-100 pb-3">
          <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <ScanFace className="w-4 h-4 text-indigo-600" />
            Employee Biometric Reference Selfie Queue ({bioData.enrollments.length})
          </CardTitle>
          <CardDescription className="text-xs text-slate-500">
            Adjudicate reference face photos before granting automated 1:1 facial recognition.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-3 space-y-3">
          {bioNotice && <StatusBanner tone="error" title="Biometric Review Notice" description={bioNotice} />}
          {bioState.status === 'loading' ? (
            <EmptyState variant="loading" title="Loading biometric enrollments..." compact />
          ) : bioData.enrollments.length === 0 ? (
            <EmptyState
              variant="empty"
              title="No biometric enrollments submitted yet."
              description="Employees capture live reference selfies under My Profile before Admin review."
              compact
            />
          ) : (
            <div className="divide-y divide-slate-100 text-xs">
              {bioData.enrollments.map((item) => (
                <div
                  key={item.id}
                  className="py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3 hover:bg-slate-50/50 px-2 rounded-lg transition-colors"
                >
                  <div className="flex items-start gap-3">
                    {item.evidence_signed_url ? (
                      <a
                        href={item.evidence_signed_url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 group relative block"
                      >
                        <img
                          src={item.evidence_signed_url}
                          alt={`Enrollment ${item.employee_code}`}
                          className="w-14 h-14 rounded-xl object-cover border border-slate-200 bg-slate-100 group-hover:opacity-90 transition-opacity"
                        />
                        <div className="absolute inset-0 bg-black/40 rounded-xl opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                          <Eye className="w-3.5 h-3.5" />
                        </div>
                      </a>
                    ) : (
                      <div className="w-14 h-14 rounded-xl border border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center text-[10px] text-slate-400 shrink-0">
                        <Camera className="w-3.5 h-3.5 mb-0.5 text-slate-300" />
                        No Photo
                      </div>
                    )}

                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-indigo-600 bg-indigo-50 border border-indigo-200/50 px-1.5 py-0.5 rounded text-[11px]">
                          {item.employee_code}
                        </span>
                        <span className="font-bold text-slate-900">{item.employee_name}</span>
                        <Badge
                          variant={
                            item.status === 'APPROVED'
                              ? 'success'
                              : item.status === 'REJECTED' || item.status === 'REVOKED'
                                ? 'destructive'
                                : 'warning'
                          }
                          className="text-[10px]"
                        >
                          {item.status}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Consent: <strong className="text-slate-700">{item.consent_given ? 'Recorded' : 'Missing'}</strong> • Submitted: <span className="font-mono tabular-nums">{item.submitted_at ? item.submitted_at.slice(0, 16) : '--'}</span>
                      </p>
                      {item.rejection_reason && (
                        <p className="text-[11px] text-rose-700 font-medium">Rejection Reason: {item.rejection_reason}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <div className="w-44">
                      <Input
                        inputSize="sm"
                        placeholder="Review note / reason..."
                        value={bioReasons[item.id] ?? ''}
                        onChange={(e) =>
                          setBioReasons((p) => ({ ...p, [item.id]: e.target.value }))
                        }
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="success"
                      loading={bioBusyId === item.id}
                      onClick={() => void handleBiometricReview(item.id, 'APPROVED')}
                      className="h-8 text-xs px-2.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      loading={bioBusyId === item.id}
                      onClick={() => void handleBiometricReview(item.id, 'REJECTED')}
                      className="h-8 text-xs px-2.5 text-rose-700 border-rose-300 hover:bg-rose-50"
                    >
                      <ShieldX className="w-3.5 h-3.5 mr-1" />
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      loading={bioBusyId === item.id}
                      onClick={() => void handleBiometricReview(item.id, 'REVOKED')}
                      className="h-8 text-xs px-2.5"
                    >
                      Revoke
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* CompreFace Subject Mappings */}
      <Card className="shadow-card">
        <CardHeader className="border-b border-slate-100 pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Link2 className="w-4 h-4 text-indigo-600" />
                CompreFace Biometric Subject Mappings ({activeMappings.length} Active / {revokedMappings.length} Revoked)
              </CardTitle>
              <CardDescription className="text-xs text-slate-500 mt-0.5">
                Link enrolled CompreFace subjects to employee profiles. Biometrics establish identity; MiniFASNet independently validates liveness.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant={subjectData.available ? 'success' : 'warning'} className="text-[10px]">
                {subjectState.status === 'loading'
                  ? 'Checking CompreFace...'
                  : subjectData.available
                    ? `CompreFace Ready (${subjectData.subjects.length} Subjects)`
                    : 'CompreFace Unavailable'}
              </Badge>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  reloadSubjects();
                  reloadMappings();
                }}
                className="h-8 text-xs px-2.5"
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1" />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pt-4 text-xs">
          {mappingError && (
            <StatusBanner tone="error" title="Subject Mapping Error" description={mappingError} />
          )}
          {mappingSuccess && (
            <StatusBanner tone="success" title="Subject Mapping Updated" description={mappingSuccess} />
          )}
          {subjectState.status === 'unavailable' && (
            <StatusBanner
              tone="unavailable"
              title="CompreFace Subject Discovery Unavailable"
              description={subjectState.message}
            />
          )}

          {/* Assignment Form */}
          <form
            onSubmit={(e) => void handleAssignSubject(e)}
            className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end p-4 rounded-xl border border-slate-200 bg-slate-50/50"
          >
            <FormField label="Target Employee" required>
              <Select
                selectSize="md"
                value={selectedEmployeeId}
                onChange={(e) => setSelectedEmployeeId(e.target.value)}
              >
                <option value="">Select employee...</option>
                {assignableEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.employeeCode} — {emp.fullName}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label="CompreFace Subject" required>
              <Select
                selectSize="md"
                value={selectedSubject}
                onChange={(e) => setSelectedSubject(e.target.value)}
              >
                <option value="">Select CompreFace subject...</option>
                {subjectData.subjects.map((subj) => (
                  <option key={subj.subject} value={subj.subject}>
                    {subj.subject}
                    {subj.assignedEmployeeCode ? ` (Assigned: ${subj.assignedEmployeeCode})` : ' (Unassigned)'}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label="Notes (Optional)">
              <Input
                inputSize="md"
                type="text"
                value={mappingNotes}
                onChange={(e) => setMappingNotes(e.target.value)}
                placeholder="e.g. Verified CompreFace enrollment"
              />
            </FormField>

            <div>
              <Button
                type="submit"
                size="md"
                loading={assignBusy}
                disabled={!subjectData.available && subjectData.subjects.length === 0}
                className="w-full"
              >
                <Link2 className="w-3.5 h-3.5 mr-1.5" />
                Assign Subject
              </Button>
            </div>
          </form>

          {/* Active Mappings List */}
          <div className="space-y-3 pt-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Active Subject Mappings ({activeMappings.length})
            </h4>

            {mappingState.status === 'loading' ? (
              <EmptyState variant="loading" title="Loading CompreFace subject mappings..." compact />
            ) : activeMappings.length === 0 ? (
              <EmptyState
                variant="empty"
                title="No active CompreFace subject mappings."
                description="Assign an employee to a registered CompreFace subject above."
                compact
              />
            ) : (
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
                {activeMappings.map((m) => (
                  <div
                    key={m.id}
                    className="p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs hover:bg-slate-50/50 transition-colors"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-indigo-600 bg-indigo-50 border border-indigo-200/50 px-1.5 py-0.5 rounded text-[11px]">
                          {m.employee_code}
                        </span>
                        <span className="font-bold text-slate-900">{m.employee_name}</span>
                        <Badge variant="success" className="text-[10px]">ACTIVE</Badge>
                        <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold border border-slate-200">
                          Subject: {m.provider_subject}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Provider: {m.provider_name} • Assigned: <span className="font-mono tabular-nums">{m.assigned_at.slice(0, 16)}</span>
                        {m.notes ? ` • Note: ${m.notes}` : ''}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <div className="w-44">
                        <Input
                          inputSize="sm"
                          placeholder="Revocation reason..."
                          value={revokeReasons[m.id] ?? ''}
                          onChange={(e) =>
                            setRevokeReasons((prev) => ({ ...prev, [m.id]: e.target.value }))
                          }
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        loading={revokeMappingBusyId === m.id}
                        onClick={() => void handleRevokeMapping(m.id)}
                        className="h-8 text-xs px-2.5"
                      >
                        Revoke Mapping
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Revoked Mappings History */}
          {revokedMappings.length > 0 && (
            <div className="space-y-2 pt-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Revoked Mappings History ({revokedMappings.length})
              </h4>
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-slate-50/50">
                {revokedMappings.map((m) => (
                  <div key={m.id} className="p-3 text-xs space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-slate-400">{m.employee_code}</span>
                      <span className="font-medium text-slate-700">{m.employee_name}</span>
                      <Badge variant="destructive" className="text-[10px]">REVOKED</Badge>
                      <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">
                        Subject: {m.provider_subject}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Revoked: <span className="font-mono tabular-nums">{m.revoked_at ? m.revoked_at.slice(0, 16) : '--'}</span>
                      {m.revoked_reason ? ` • Reason: ${m.revoked_reason}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Change Admin Password */}
      <Card className="shadow-card">
        <CardHeader className="border-b border-slate-100 pb-3">
          <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-indigo-600" />
            Update Admin Password
          </CardTitle>
          <CardDescription className="text-xs text-slate-500">
            Updates Supabase GoTrue credentials and automatically revokes all other active sessions (PO-07).
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={handleChangePassword} className="space-y-3.5 max-w-lg text-xs">
            {pwError && <StatusBanner tone="error" title="Password Update Failed" description={pwError} />}
            {pwSuccess && <StatusBanner tone="success" title="Password Updated" description={pwSuccess} />}

            <FormField label="Current Password" required>
              <Input
                inputSize="md"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </FormField>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <FormField label="New Password (min 8 chars)" required>
                <Input
                  inputSize="md"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </FormField>

              <FormField label="Confirm New Password" required>
                <Input
                  inputSize="md"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </FormField>
            </div>

            <div className="pt-1">
              <Button type="submit" size="md" loading={pwBusy}>
                <KeyRound className="w-3.5 h-3.5 mr-1.5" />
                Update Admin Password
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Security Invariant Callout */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs flex items-center gap-3 text-slate-600 shadow-2xs">
        <Lock className="w-4 h-4 text-emerald-600 shrink-0" />
        <span>
          <strong>PO-05 Architectural Security Guarantee:</strong> Access tokens reside strictly in JavaScript memory (`useRef`), never in localStorage, cookies, or sessionStorage, immunizing against XSS credential exfiltration.
        </span>
      </div>
    </div>
  );
};
