import React, { useMemo, useState } from 'react';
import {
  CalendarClock,
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Send,
  Calendar,
  Layers,
} from 'lucide-react';
import type { LeaveApplicationRecord, LeaveCategory } from '../../types/hrms';
import { UNPAID_LEAVE_LABELS } from '../../lib/domainRules';
import { useAuth } from '../../context/AuthContext';
import { useApiResource } from '../../hooks/useApiResource';
import { apiRequest } from '../../lib/apiClient';
import { StatusBanner } from '../../components/ui/StatusBanner';

type FilterStatus = 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED';

export const EmployeeLeavePage: React.FC = () => {
  const { user, getInMemoryAccessToken } = useAuth();
  const { state, data, reload } = useApiResource<{ leaves: LeaveApplicationRecord[] }>(
    '/api/v1/employee/leaves',
    { leaves: [] }
  );

  const [category, setCategory] = useState<LeaveCategory>('CL');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [supportingDoc, setSupportingDoc] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formUnavailable, setFormUnavailable] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('ALL');

  // Dynamic day count calculation
  const calculatedDays = useMemo(() => {
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();
    if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) {
      return 0;
    }
    return Math.max(1, Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1);
  }, [startDate, endDate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormUnavailable(null);
    setFormSuccess(null);

    if (reason.trim().length < 5) {
      setFormError('Please enter a descriptive reason for your leave request (at least 5 characters).');
      return;
    }

    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();
    if (endMs < startMs) {
      setFormError('End date cannot precede start date.');
      return;
    }
    const totalDays = Math.max(1, Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1);

    setSubmitting(true);
    const res = await apiRequest<{ leaveId?: string; message?: string }>(
      '/api/v1/employee/leaves',
      getInMemoryAccessToken(),
      {
        method: 'POST',
        body: {
          category,
          startDate,
          endDate,
          totalDays,
          reason: reason.trim(),
          supportingDocName: supportingDoc.trim() || undefined,
        },
      }
    );
    setSubmitting(false);

    if (res.status === 'UNAVAILABLE') {
      setFormUnavailable(res.message || 'Leave submission endpoint is not yet implemented.');
      return;
    }
    if (res.status !== 'OK') {
      setFormError(res.message);
      return;
    }

    setReason('');
    setSupportingDoc('');
    setFormSuccess(
      res.data.message || `Submitted ${category} request (${totalDays} day(s), unpaid 0h) for Admin review.`
    );
    reload();
  };

  // Metrics
  const pendingCount = data.leaves.filter((l) => l.status === 'PENDING').length;
  const approvedCount = data.leaves.filter((l) => l.status === 'APPROVED').length;
  const rejectedCount = data.leaves.filter((l) => l.status === 'REJECTED').length;

  const filteredLeaves = useMemo(() => {
    if (statusFilter === 'ALL') return data.leaves;
    return data.leaves.filter((l) => l.status === statusFilter);
  }, [data.leaves, statusFilter]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/60">
              EMPLOYEE PORTAL
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs text-slate-500 font-medium">PO-03: Unpaid Leaves</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 mt-1.5">
            My Leave Applications
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Submit leave requests and track administrative decisions.
          </p>
        </div>
      </div>

      {/* PO-03 Statutory Notice Banner */}
      <div className="rounded-2xl border border-amber-200/80 bg-amber-50/70 p-4 text-xs text-amber-900 shadow-xs flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-bold text-amber-950">
            Statutory &amp; Organizational Policy Notice (PO-03)
          </p>
          <p className="leading-relaxed text-amber-900/90 text-xs">
            All leave categories—<strong>CL</strong>, <strong>SL</strong>, <strong>PL</strong>, and <strong>LWP</strong>—are recorded
            as <strong>Unpaid (0 payable hours in payroll)</strong>. Leave applications require explicit
            Admin authorization prior to absence.
          </p>
        </div>
      </div>

      {state.status === 'unavailable' && (
        <StatusBanner tone="unavailable" title="Leave History API Pending" description={state.message} />
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1 */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-50/80 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
              <Layers className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Total Filings</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight font-mono">
              {data.leaves.length}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">Lifetime applications</p>
        </div>

        {/* KPI 2 */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-50/80 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Pending Review</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight font-mono">
              {pendingCount}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">Awaiting Admin sign-off</p>
        </div>

        {/* KPI 3 */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-50/80 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Approved</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight font-mono">
              {approvedCount}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">Authorized absences (0h)</p>
        </div>

        {/* KPI 4 */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-rose-50/80 border border-rose-100 flex items-center justify-center text-rose-600 shrink-0">
              <XCircle className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Rejected</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight font-mono">
              {rejectedCount}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">Denied requests</p>
        </div>
      </div>

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Leave Application Form */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
          <div className="flex items-center gap-3 pb-4 mb-4 border-b border-slate-100">
            <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
              <CalendarClock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Apply for Leave</h2>
              <p className="text-xs text-slate-500">
                Applicant: {user?.fullName ?? 'Alugu varun'} ({user?.employeeCode ?? 'EMP001'})
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            {formUnavailable && (
              <StatusBanner tone="unavailable" title="Submission Pending Backend" description={formUnavailable} />
            )}
            {formError && <StatusBanner tone="error" title="Validation Error" description={formError} />}
            {formSuccess && <StatusBanner tone="success" title="Leave Submitted" description={formSuccess} />}

            <div>
              <label htmlFor="leaveCategory" className="block text-[11px] font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Leave Category *
              </label>
              <select
                id="leaveCategory"
                value={category}
                onChange={(e) => setCategory(e.target.value as LeaveCategory)}
                className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-xs text-slate-900 focus:outline-hidden focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
              >
                {(['CL', 'SL', 'PL', 'LWP'] as const).map((cat) => (
                  <option key={cat} value={cat}>
                    {UNPAID_LEAVE_LABELS[cat]} — Unpaid (0 payable hrs)
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="leaveStartDate" className="block text-[11px] font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Start Date *
                </label>
                <input
                  id="leaveStartDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-xs font-mono text-slate-900 focus:outline-hidden focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
                />
              </div>
              <div>
                <label htmlFor="leaveEndDate" className="block text-[11px] font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  End Date *
                </label>
                <input
                  id="leaveEndDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-xs font-mono text-slate-900 focus:outline-hidden focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
                />
              </div>
            </div>

            {/* Dynamic Calculation Callout */}
            <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-slate-600">
                <Calendar className="w-4 h-4 text-blue-600" />
                <span className="font-medium">Calculated Duration:</span>
              </div>
              <div className="font-mono font-bold text-slate-900">
                {calculatedDays > 0 ? (
                  <span className="text-blue-700">{calculatedDays} Day(s) — Unpaid (PO-03: 0h payable time)</span>
                ) : (
                  <span className="text-rose-600">Invalid Date Range</span>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="leaveReason" className="block text-[11px] font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Reason for Absence *
              </label>
              <textarea
                id="leaveReason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="State the business reason or personal circumstance for absence..."
                className="w-full p-3 rounded-xl border border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all resize-none"
              />
            </div>

            <div>
              <label htmlFor="leaveDocRef" className="block text-[11px] font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Supporting Document Reference (Optional)
              </label>
              <input
                id="leaveDocRef"
                type="text"
                value={supportingDoc}
                onChange={(e) => setSupportingDoc(e.target.value)}
                placeholder="e.g. medical_certificate_nov2026.pdf"
                className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={submitting || calculatedDays <= 0 || reason.trim().length < 5}
              className="w-full h-11 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs sm:text-sm rounded-xl shadow-xs transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              <Send className="w-4 h-4" />
              {submitting ? 'Submitting Application...' : 'Submit Leave Application'}
            </button>
          </form>
        </div>

        {/* Leave History List */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Leave Filing History</h2>
                <p className="text-xs text-slate-500">
                  {data.leaves.length} recorded application(s)
                </p>
              </div>
            </div>

            {/* Status Filter Tabs */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl self-start sm:self-auto text-xs">
              {(['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    statusFilter === st
                      ? 'bg-blue-600 text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {st === 'ALL' ? 'All' : st.charAt(0) + st.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>

          <div>
            {state.status === 'loading' ? (
              <div className="py-12 text-center text-slate-400 text-xs">Loading leave history...</div>
            ) : filteredLeaves.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-center">
                <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-center text-slate-400 mb-3">
                  <Calendar className="w-8 h-8" />
                </div>
                <h4 className="font-bold text-slate-800 text-sm">No leave applications filed yet.</h4>
                <p className="text-xs text-slate-500 mt-1 max-w-sm">
                  Submitted leave requests and administrative review comments will appear here.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredLeaves.map((leave) => (
                  <div key={leave.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 font-mono text-sm">
                          {leave.category}
                        </span>
                        <span className="text-slate-400">•</span>
                        <span className="font-mono text-slate-700">
                          {leave.startDate} → {leave.endDate}
                        </span>
                        <span className="text-xs text-slate-500">
                          ({leave.totalDays} day{leave.totalDays > 1 ? 's' : ''})
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-1">{leave.reason}</p>
                      {leave.adminRemarks && (
                        <p className="text-[11px] text-amber-700 bg-amber-50 rounded-md p-1.5 mt-1 border border-amber-200/50">
                          <strong>Admin:</strong> {leave.adminRemarks}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 self-start sm:self-center">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                          leave.status === 'APPROVED'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : leave.status === 'REJECTED'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {leave.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
