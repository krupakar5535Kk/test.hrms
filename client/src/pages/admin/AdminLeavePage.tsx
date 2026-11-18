import React, { useMemo, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  FileText,
  XCircle,
  Clock,
} from 'lucide-react';
import type { LeaveApplicationRecord } from '../../types/hrms';
import { UNPAID_LEAVE_LABELS } from '../../lib/domainRules';
import { useAuth } from '../../context/AuthContext';
import { useApiResource } from '../../hooks/useApiResource';
import { apiRequest } from '../../lib/apiClient';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { MetricCard } from '../../components/ui/MetricCard';
import { DataTable } from '../../components/ui/DataTable';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';

interface AdminLeavesPayload {
  leaves: LeaveApplicationRecord[];
}

export const AdminLeavePage: React.FC = () => {
  const { getInMemoryAccessToken } = useAuth();
  const { state, data, reload } = useApiResource<AdminLeavesPayload>(
    '/api/v1/admin/leaves',
    { leaves: [] }
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');
  const [remarksMap, setRemarksMap] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionUnavailable, setActionUnavailable] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const kpis = useMemo(() => {
    const total = data.leaves.length;
    const pending = data.leaves.filter((l) => l.status === 'PENDING').length;
    const approved = data.leaves.filter((l) => l.status === 'APPROVED').length;
    const rejected = data.leaves.filter((l) => l.status === 'REJECTED').length;
    return { total, pending, approved, rejected };
  }, [data.leaves]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return data.leaves.filter((l) => {
      if (statusFilter !== 'ALL' && l.status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        l.employeeName.toLowerCase().includes(q) ||
        l.employeeCode.toLowerCase().includes(q) ||
        l.category.toLowerCase().includes(q) ||
        l.reason.toLowerCase().includes(q)
      );
    });
  }, [data.leaves, statusFilter, searchQuery]);

  const handleDecision = async (leaveId: string, decision: 'APPROVED' | 'REJECTED') => {
    setActionError(null);
    setActionUnavailable(null);
    setActionSuccess(null);

    const remarks = (remarksMap[leaveId] ?? '').trim();
    if (remarks.length < 5) {
      setActionError('Enter mandatory Admin review remarks (min 5 characters) before deciding.');
      return;
    }

    setBusyId(leaveId);
    const res = await apiRequest<{ updated: boolean }>(
      `/api/v1/admin/leaves/${encodeURIComponent(leaveId)}/review`,
      getInMemoryAccessToken(),
      {
        method: 'POST',
        body: { decision, remarks },
      }
    );
    setBusyId(null);

    if (res.status === 'UNAVAILABLE') {
      setActionUnavailable(res.message || 'Leave review API is not yet implemented.');
      return;
    }
    if (res.status !== 'OK') {
      setActionError(res.message);
      return;
    }

    setActionSuccess(`Leave request ${decision.toLowerCase()} cleanly with audit remarks.`);
    reload();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/60">
              <CalendarClock className="w-3 h-3 text-indigo-600" />
              Leave Governance
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs font-mono font-medium text-slate-500">
              Pending Adjudication: {kpis.pending}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-1">
            Leave Applications &amp; Approvals
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Audit and adjudicate employee leave requests. All 4 categories (CL, SL, PL, LWP) carry 0 payable hours under PO-03.
          </p>
        </div>
      </div>

      {state.status === 'unavailable' && (
        <StatusBanner tone="unavailable" title="Leave Management API Pending" description={state.message} />
      )}
      {actionUnavailable && (
        <StatusBanner tone="unavailable" title="Review Endpoint Unavailable" description={actionUnavailable} />
      )}
      {actionError && <StatusBanner tone="error" title="Action Blocked" description={actionError} />}
      {actionSuccess && <StatusBanner tone="success" title="Updated" description={actionSuccess} />}

      {/* Policy Reminder Banner */}
      <div className="rounded-2xl border border-amber-200/90 bg-amber-50/80 p-4 text-xs text-amber-950 flex items-start gap-3 shadow-xs">
        <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-amber-950">PO-03 Policy Invariant: All 4 Leave Categories Are Unpaid (0 Payable Hours)</span>
          <p className="text-[11px] text-amber-900/80 mt-0.5">
            {Object.values(UNPAID_LEAVE_LABELS).join(' • ')}
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Total Applications"
          value={kpis.total}
          icon={FileText}
          tone="primary"
          subtitle="All-time leave filings"
        />
        <MetricCard
          label="Awaiting Approval"
          value={kpis.pending}
          icon={CalendarClock}
          tone={kpis.pending > 0 ? 'warning' : 'default'}
          subtitle="Pending Admin review"
        />
        <MetricCard
          label="Approved Leaves"
          value={kpis.approved}
          icon={CheckCircle2}
          tone="success"
          subtitle="Sanctioned with audit remarks"
        />
        <MetricCard
          label="Rejected Leaves"
          value={kpis.rejected}
          icon={XCircle}
          tone={kpis.rejected > 0 ? 'destructive' : 'default'}
          subtitle="Declined with audit feedback"
        />
      </div>

      {/* Leaves Data Table */}
      <DataTable
        title="Employee Leave Ledger"
        description="Review incoming leave requests, inspect supporting documentation, and record mandatory approval/rejection remarks."
        searchPlaceholder="Search employee, code, category, reason..."
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        filterSlot={
          <div className="w-48">
            <Select
              selectSize="sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              aria-label="Filter by leave status"
            >
              <option value="ALL">All Statuses</option>
              <option value="PENDING">Pending Review</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </Select>
          </div>
        }
        totalCount={data.leaves.length}
        filteredCount={filtered.length}
        isLoading={state.status === 'loading'}
        error={state.status === 'error' ? state.message : null}
        onRetry={reload}
        emptyTitle="No leave applications found"
        emptyDescription="Submitted employee CL, SL, PL, and LWP requests will appear here for Admin review."
        onClearFilters={
          searchQuery || statusFilter !== 'ALL'
            ? () => {
                setSearchQuery('');
                setStatusFilter('ALL');
              }
            : undefined
        }
      >
        <div className="divide-y divide-slate-100">
          {filtered.map((lv) => (
            <div
              key={lv.id}
              className="p-4 space-y-3 text-xs hover:bg-slate-50/70 transition-colors"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-bold text-indigo-600 bg-indigo-50 border border-indigo-200/50 px-1.5 py-0.5 rounded text-[11px]">
                    {lv.employeeCode}
                  </span>
                  <span className="font-bold text-slate-900 text-sm">{lv.employeeName}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {lv.category} (Unpaid · 0h)
                  </Badge>
                  <Badge
                    variant={
                      lv.status === 'APPROVED'
                        ? 'success'
                        : lv.status === 'PENDING'
                          ? 'warning'
                          : 'destructive'
                    }
                    className="text-[10px]"
                  >
                    {lv.status}
                  </Badge>
                </div>
                <div className="font-mono text-xs text-slate-500 tabular-nums">
                  {lv.startDate} → {lv.endDate} ({lv.totalDays} day{lv.totalDays > 1 ? 's' : ''})
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200/70 rounded-lg p-3">
                <p className="text-slate-800 font-normal leading-relaxed">{lv.reason}</p>
                {lv.supportingDocName && (
                  <p className="text-[11px] text-slate-500 mt-1.5 flex items-center gap-1 font-mono">
                    <FileText className="w-3.5 h-3.5 text-slate-400" />
                    Attachment: {lv.supportingDocName}
                  </p>
                )}
              </div>

              {lv.adminRemarks && (
                <div className="rounded-lg bg-indigo-50/50 border border-indigo-200/60 p-2.5 text-[11px] text-indigo-900">
                  <span className="font-semibold">Admin Adjudication ({lv.reviewedBy ?? 'Admin'}):</span>{' '}
                  {lv.adminRemarks}
                </div>
              )}

              {lv.status === 'PENDING' && (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1 border-t border-slate-100">
                  <div className="flex-1">
                    <Input
                      inputSize="sm"
                      placeholder="Mandatory Admin remarks (min 5 characters)..."
                      value={remarksMap[lv.id] ?? ''}
                      onChange={(e) =>
                        setRemarksMap((p) => ({ ...p, [lv.id]: e.target.value }))
                      }
                    />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="destructive"
                      loading={busyId === lv.id}
                      onClick={() => handleDecision(lv.id, 'REJECTED')}
                      className="h-8 text-xs px-2.5"
                    >
                      <XCircle className="w-3.5 h-3.5 mr-1" />
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      variant="success"
                      loading={busyId === lv.id}
                      onClick={() => handleDecision(lv.id, 'APPROVED')}
                      className="h-8 text-xs px-2.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                      Approve
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </DataTable>
    </div>
  );
};
