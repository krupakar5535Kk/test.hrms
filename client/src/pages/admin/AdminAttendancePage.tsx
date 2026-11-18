import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Edit3,
  ShieldAlert,
  Terminal,
  Calendar,
  Check,
} from 'lucide-react';
import type { DailyAttendanceRecord, FieldDutySessionRecord } from '../../types/hrms';
import {
  calculateDec01AttendanceMinutes,
  formatMinutesAsDuration,
  HRMS_POLICY,
} from '../../lib/domainRules';
import { useAuth } from '../../context/AuthContext';
import { useApiResource } from '../../hooks/useApiResource';
import { apiRequest } from '../../lib/apiClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { MetricCard } from '../../components/ui/MetricCard';
import { DataTable } from '../../components/ui/DataTable';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import { AdminReviewModal } from '../../components/attendance/AdminReviewModal';

interface AdminAttendancePayload {
  records: DailyAttendanceRecord[];
  fieldSessions?: FieldDutySessionRecord[];
}

export const AdminAttendancePage: React.FC = () => {
  const { getInMemoryAccessToken } = useAuth();
  const { state, data, reload } = useApiResource<AdminAttendancePayload>(
    '/api/v1/admin/attendance',
    { records: [], fieldSessions: [] }
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [filterState, setFilterState] = useState<
    'ALL' | 'PENDING_ADMIN_REVIEW' | 'VERIFICATION_PENDING' | 'APPROVED' | 'REJECTED'
  >('ALL');
  const [reviewRecord, setReviewRecord] = useState<DailyAttendanceRecord | null>(null);

  // Admin correction modal state
  const [correctingRecord, setCorrectingRecord] = useState<DailyAttendanceRecord | null>(null);
  const [corrActionType, setCorrActionType] = useState<'CHECK_IN' | 'CHECK_OUT'>('CHECK_OUT');
  const [corrTime, setCorrTime] = useState('18:00');
  const [corrPostShiftApproved, setCorrPostShiftApproved] = useState(false);
  const [corrReason, setCorrReason] = useState('');
  const [corrSubmitting, setCorrSubmitting] = useState(false);
  const [corrError, setCorrError] = useState<string | null>(null);
  const [corrUnavailable, setCorrUnavailable] = useState<string | null>(null);

  // Pure domain-rule DEC-01 policy calculator
  const [calcIn, setCalcIn] = useState('10:00');
  const [calcOut, setCalcOut] = useState('18:00');
  const [calcOtApproved, setCalcOtApproved] = useState(false);
  const calcResult = calculateDec01AttendanceMinutes(calcIn, calcOut, calcOtApproved);

  const pendingQueue = useMemo(
    () =>
      data.records.filter(
        (r) =>
          r.approvalStatus === 'PENDING_ADMIN_REVIEW' ||
          r.approvalStatus === 'VERIFICATION_PENDING'
      ),
    [data.records]
  );

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return data.records.filter((r) => {
      if (filterState !== 'ALL' && r.approvalStatus !== filterState) {
        return false;
      }
      if (!q) return true;
      return (
        r.employeeName.toLowerCase().includes(q) ||
        r.employeeCode.toLowerCase().includes(q) ||
        r.date.includes(q)
      );
    });
  }, [data.records, filterState, searchQuery]);

  // Attendance metrics overview
  const attendanceMetrics = useMemo(() => {
    const total = data.records.length;
    const pendingExceptions = pendingQueue.length;
    const approved = data.records.filter((r) => r.approvalStatus === 'APPROVED').length;
    const totalMinutes = data.records.reduce((acc, r) => acc + (r.approvedPayableMinutes || 0), 0);
    return { total, pendingExceptions, approved, totalMinutes };
  }, [data.records, pendingQueue]);

  const handleSaveCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctingRecord) return;
    setCorrError(null);
    setCorrUnavailable(null);

    if (corrReason.trim().length < 5) {
      setCorrError('Mandatory audit justification requires at least 5 characters.');
      return;
    }

    setCorrSubmitting(true);
    const res = await apiRequest<{ updated: boolean }>(
      `/api/v1/admin/attendance/${encodeURIComponent(correctingRecord.id)}/correct`,
      getInMemoryAccessToken(),
      {
        method: 'POST',
        body: {
          actionType: corrActionType,
          newTime: corrTime,
          reason: corrReason.trim(),
          postShiftApproved: corrPostShiftApproved,
        },
      }
    );
    setCorrSubmitting(false);

    if (res.status === 'UNAVAILABLE') {
      setCorrUnavailable(res.message || 'Attendance correction API is not yet implemented.');
      return;
    }
    if (res.status !== 'OK') {
      setCorrError(res.message);
      return;
    }

    setCorrReason('');
    setCorrectingRecord(null);
    reload();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/60">
              <Clock className="w-3 h-3 text-indigo-600" />
              Attendance Operations
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs font-mono font-medium text-slate-500">
              Perimeter: {HRMS_POLICY.OFFICE_GEOFENCE_RADIUS_METERS}m
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-1">
            Attendance Monitoring &amp; Exception Queue
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Strict biometric, liveness, geofence, and DEC-01 shift policy enforcement.
          </p>
        </div>
      </div>

      {state.status === 'unavailable' && (
        <StatusBanner
          tone="unavailable"
          title="Attendance Monitoring API Pending"
          description={state.message}
        />
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Total Sessions"
          value={attendanceMetrics.total}
          icon={Calendar}
          tone="primary"
          subtitle="Punches recorded"
        />
        <MetricCard
          label="Pending Review"
          value={attendanceMetrics.pendingExceptions}
          icon={ShieldAlert}
          tone={attendanceMetrics.pendingExceptions > 0 ? 'warning' : 'default'}
          subtitle="Outside perimeter / biometric exceptions"
        />
        <MetricCard
          label="Approved Sessions"
          value={attendanceMetrics.approved}
          icon={CheckCircle2}
          tone="success"
          subtitle="Verified & policy compliant"
        />
        <MetricCard
          label="Approved Duration"
          value={formatMinutesAsDuration(attendanceMetrics.totalMinutes)}
          icon={Clock}
          tone="info"
          subtitle="Payable shift hours (DEC-01)"
        />
      </div>

      {/* Outside Perimeter Exception Queue */}
      {pendingQueue.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/20 shadow-card">
          <CardHeader className="pb-3 border-b border-amber-100">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm text-amber-950 font-bold">
                <div className="w-7 h-7 rounded-lg bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-800">
                  <ShieldAlert className="w-4 h-4" />
                </div>
                Outside-Perimeter Exception Queue ({pendingQueue.length})
              </CardTitle>
              <Badge variant="warning" className="text-[10px]">Action Required</Badge>
            </div>
            <CardDescription className="text-xs text-amber-900/80 mt-1">
              Sales &amp; Recovery personnel check-in attempts outside the {HRMS_POLICY.OFFICE_GEOFENCE_RADIUS_METERS}m office perimeter requiring explicit Admin adjudication.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-3">
            <div className="divide-y divide-amber-200/60">
              {pendingQueue.map((r) => (
                <div
                  key={r.id}
                  className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs hover:bg-amber-100/30 px-2 rounded-lg transition-colors"
                >
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-slate-900">
                      <span className="font-mono text-indigo-600 bg-white px-1.5 py-0.5 rounded border border-slate-200 text-[11px]">
                        {r.employeeCode}
                      </span>
                      <span>{r.employeeName}</span>
                      <span className="text-slate-400">•</span>
                      <span className="font-mono text-slate-500">{r.date}</span>
                    </div>
                    <div className="text-[11px] text-slate-600 flex flex-wrap items-center gap-2 mt-1">
                      <span>In: <strong className="font-mono text-slate-800">{r.checkInTime ?? '--'}</strong></span>
                      <span>•</span>
                      <span>Distance: <strong className="font-mono text-amber-800">{r.distanceFromOfficeMeters ?? '--'}m</strong></span>
                      <span>•</span>
                      <span className="text-slate-500 italic truncate max-w-xs">
                        &ldquo;{r.employeeComment || 'No comment provided'}&rdquo;
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setReviewRecord(r)}
                    className="shrink-0 bg-amber-600 hover:bg-amber-700 text-white shadow-2xs"
                  >
                    <Check className="w-3.5 h-3.5 mr-1" />
                    Review Exception
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Attendance Records Table */}
      <DataTable
        title="Attendance Ledger"
        description="Daily employee attendance punches with biometric verification, GPS geofence audit, and DEC-01 payable minutes."
        searchPlaceholder="Search by name, employee code, or date..."
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        filterSlot={
          <div className="w-48">
            <Select
              selectSize="sm"
              value={filterState}
              onChange={(e) => setFilterState(e.target.value as typeof filterState)}
              aria-label="Filter by approval status"
            >
              <option value="ALL">All Statuses</option>
              <option value="PENDING_ADMIN_REVIEW">Pending Admin Review</option>
              <option value="VERIFICATION_PENDING">Verification Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </Select>
          </div>
        }
        totalCount={data.records.length}
        filteredCount={filteredRecords.length}
        isLoading={state.status === 'loading'}
        error={state.status === 'error' ? state.message : null}
        onRetry={reload}
        emptyTitle="No attendance records found"
        emptyDescription={
          data.records.length === 0
            ? 'No attendance records have been registered in this billing cycle yet.'
            : 'No attendance records match the selected status filter or search query.'
        }
        onClearFilters={
          searchQuery || filterState !== 'ALL'
            ? () => {
                setSearchQuery('');
                setFilterState('ALL');
              }
            : undefined
        }
      >
        <table className="w-full text-xs text-left">
          <thead className="bg-slate-50/90 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200 font-semibold">
            <tr>
              <th className="py-3 px-4">Employee &amp; Date</th>
              <th className="py-3 px-4">In / Out Time</th>
              <th className="py-3 px-4">Payable (DEC-01)</th>
              <th className="py-3 px-4">Biometrics &amp; Geofence</th>
              <th className="py-3 px-4 text-center">Status</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredRecords.map((rec) => (
              <tr key={rec.id} className="hover:bg-slate-50/70 transition-colors">
                <td className="py-3 px-4">
                  <div className="font-semibold text-slate-900">
                    <span className="font-mono text-indigo-600 mr-1.5">{rec.employeeCode}</span>
                    {rec.employeeName}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 mt-0.5">{rec.date}</div>
                </td>
                <td className="py-3 px-4 font-mono tabular-nums text-slate-700">
                  <span className="font-medium text-slate-900">{rec.checkInTime ?? '--'}</span>
                  <span className="mx-1 text-slate-400">→</span>
                  <span className={rec.checkOutTime ? 'font-medium text-slate-900' : 'text-amber-600 font-semibold'}>
                    {rec.checkOutTime ?? 'OPEN'}
                  </span>
                </td>
                <td className="py-3 px-4 font-mono tabular-nums font-semibold text-slate-900">
                  {formatMinutesAsDuration(rec.approvedPayableMinutes)}
                </td>
                <td className="py-3 px-4">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant={rec.locationState === 'INSIDE_GEOFENCE' ? 'success' : 'warning'}
                      className="text-[10px]"
                    >
                      {rec.locationState === 'INSIDE_GEOFENCE' ? 'HQ ≤50m' : 'Outside HQ'}
                    </Badge>
                    {(() => {
                      const faceLabel = String(rec.faceState ?? 'VERIFICATION_PENDING');
                      const variant =
                        faceLabel === 'VERIFIED' || faceLabel === 'FACE_MATCHED'
                          ? 'success'
                          : faceLabel === 'FAILED' ||
                              faceLabel === 'VERIFICATION_FAILED' ||
                              faceLabel === 'FACE_MISMATCH' ||
                              faceLabel === 'FACE_NOT_DETECTED' ||
                              faceLabel === 'SPOOFING_SUSPECTED'
                            ? 'destructive'
                            : 'warning';
                      return (
                        <Badge variant={variant} className="text-[10px]">
                          {faceLabel}
                        </Badge>
                      );
                    })()}
                    <Badge
                      variant={rec.livenessPassed ? 'success' : 'warning'}
                      className="text-[10px]"
                    >
                      {rec.livenessPassed ? 'Live' : 'Liveness Pending'}
                    </Badge>
                  </div>
                </td>
                <td className="py-3 px-4 text-center">
                  <Badge
                    variant={
                      rec.approvalStatus === 'APPROVED'
                        ? 'success'
                        : rec.approvalStatus === 'PENDING_ADMIN_REVIEW' ||
                            rec.approvalStatus === 'VERIFICATION_PENDING'
                          ? 'warning'
                          : 'destructive'
                    }
                    className="text-[10px]"
                  >
                    {rec.approvalStatus}
                  </Badge>
                </td>
                <td className="py-3 px-4 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setReviewRecord(rec)}
                      className="h-7 text-xs px-2"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                      Inspect
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setCorrectingRecord(rec)}
                      className="h-7 text-xs px-2 text-slate-600 hover:text-slate-900"
                    >
                      <Edit3 className="w-3.5 h-3.5 mr-1" />
                      Correct
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTable>

      {/* Pure DEC-01 Policy Rule Calculator */}
      <Card className="shadow-card">
        <CardHeader className="border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-50 border border-indigo-200/60 flex items-center justify-center text-indigo-700">
              <Terminal className="w-3.5 h-3.5" />
            </div>
            <div>
              <CardTitle className="text-sm">DEC-01 Shift &amp; Lunch Clipping Calculator</CardTitle>
              <CardDescription className="text-xs text-slate-500 mt-0.5">
                Audited rule verification for Mon–Sat {HRMS_POLICY.SCHEDULE_START_HHMM}–{HRMS_POLICY.SCHEDULE_END_HHMM} shift, {HRMS_POLICY.LUNCH_START_HHMM}–{HRMS_POLICY.LUNCH_END_HHMM} unpaid lunch clipping, and post-18:00 approved hours.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end text-xs">
            <FormField label="Check-In (HH:MM)">
              <Input
                inputSize="md"
                type="time"
                value={calcIn}
                onChange={(e) => setCalcIn(e.target.value)}
                className="font-mono tabular-nums"
              />
            </FormField>

            <FormField label="Check-Out (HH:MM)">
              <Input
                inputSize="md"
                type="time"
                value={calcOut}
                onChange={(e) => setCalcOut(e.target.value)}
                className="font-mono tabular-nums"
              />
            </FormField>

            <div className="pb-2">
              <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={calcOtApproved}
                  onChange={(e) => setCalcOtApproved(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                />
                <span className="font-medium">Approve Post-18:00 (1.0x)</span>
              </label>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 font-mono">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Payable Duration</p>
              <p className="font-bold text-base text-slate-900 tabular-nums mt-0.5">
                {formatMinutesAsDuration(calcResult.payableMinutes)}
              </p>
              <p className="text-[10px] text-slate-500 mt-1 tabular-nums">
                Gross: {formatMinutesAsDuration(calcResult.grossMinutes)} • Lunch clipped: {calcResult.lunchDeductionMinutes}m • OT: {formatMinutesAsDuration(calcResult.postShiftMinutes)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Admin Review Modal */}
      <AdminReviewModal
        record={reviewRecord}
        fieldSession={data.fieldSessions?.find(
          (f) => reviewRecord && f.employeeId === reviewRecord.employeeId && f.date === reviewRecord.date
        )}
        onClose={() => setReviewRecord(null)}
        onReviewed={reload}
      />

      {/* Audited Admin Attendance Correction Dialog */}
      <Dialog
        open={Boolean(correctingRecord)}
        onClose={() => setCorrectingRecord(null)}
        title={
          correctingRecord
            ? `Admin Attendance Correction — ${correctingRecord.employeeName}`
            : ''
        }
        description={
          correctingRecord
            ? `Adjust punch timestamps for ${correctingRecord.employeeCode} (${correctingRecord.date}). Preserves original telemetry with immutable audit trail.`
            : ''
        }
      >
        <form onSubmit={handleSaveCorrection} className="space-y-4 text-xs">
          {corrUnavailable && (
            <StatusBanner tone="unavailable" title="Backend Endpoint Pending" description={corrUnavailable} />
          )}
          {corrError && <StatusBanner tone="error" title="Validation Error" description={corrError} />}

          <div className="grid grid-cols-2 gap-3.5">
            <FormField label="Correction Target" required>
              <Select
                selectSize="md"
                value={corrActionType}
                onChange={(e) => setCorrActionType(e.target.value as 'CHECK_IN' | 'CHECK_OUT')}
              >
                <option value="CHECK_IN">Check-In Time</option>
                <option value="CHECK_OUT">Check-Out Time</option>
              </Select>
            </FormField>

            <FormField label="Adjusted Time (HH:MM)" required>
              <Input
                inputSize="md"
                type="time"
                value={corrTime}
                onChange={(e) => setCorrTime(e.target.value)}
                className="font-mono tabular-nums"
              />
            </FormField>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer text-xs text-slate-700 select-none pt-1">
            <input
              type="checkbox"
              checked={corrPostShiftApproved}
              onChange={(e) => setCorrPostShiftApproved(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
            />
            <span>Approve post-18:00 hours at 1.0x hourly wage reference</span>
          </label>

          <FormField
            label="Mandatory Audit Reason (min 5 characters)"
            required
            helperText="Justification will be permanently recorded in the audit trail."
          >
            <Textarea
              rows={3}
              value={corrReason}
              onChange={(e) => setCorrReason(e.target.value)}
              placeholder="State the verified business reason for this timestamp adjustment..."
            />
          </FormField>

          <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-200">
            <Button type="button" variant="outline" onClick={() => setCorrectingRecord(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={corrSubmitting}>
              Apply Audited Correction
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
};
