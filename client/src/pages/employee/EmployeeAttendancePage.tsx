import React, { useMemo, useState } from 'react';
import {
  Camera,
  Clock,
  CheckCircle2,
  Calendar,
  Compass,
} from 'lucide-react';
import type { DailyAttendanceRecord } from '../../types/hrms';
import { formatMinutesAsDuration, HRMS_POLICY } from '../../lib/domainRules';
import { useAuth } from '../../context/AuthContext';
import { useApiResource } from '../../hooks/useApiResource';
import { Badge } from '../../components/ui/Badge';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { DataTable } from '../../components/ui/DataTable';
import { GeofenceBoundaryMap } from '../../components/attendance/GeofenceBoundaryMap';
import {
  SmartAttendanceModal,
  type OfficeGeofenceConfig,
} from '../../components/attendance/SmartAttendanceModal';

interface EmployeeAttendancePayload {
  todayRecord: DailyAttendanceRecord | null;
  records: DailyAttendanceRecord[];
  officeGeofence: OfficeGeofenceConfig | null;
}

export const EmployeeAttendancePage: React.FC = () => {
  const { user } = useAuth();
  const { state, data, reload } = useApiResource<EmployeeAttendancePayload>(
    '/api/v1/employee/attendance',
    { todayRecord: null, records: [], officeGeofence: null }
  );

  const [punchModalMode, setPunchModalMode] = useState<'CHECK_IN' | 'CHECK_OUT' | null>(null);
  const [dateSearch, setDateSearch] = useState('');

  const todayRec = data.todayRecord;
  const totalMonthMinutes = data.records.reduce((acc, r) => acc + (r.approvedPayableMinutes || 0), 0);
  const totalLunchClipped = data.records.reduce((acc, r) => acc + (r.lunchDeductionMinutes || 0), 0);

  const filteredRecords = useMemo(() => {
    const q = dateSearch.trim().toLowerCase();
    if (!q) return data.records;
    return data.records.filter(
      (r) =>
        r.date.includes(q) ||
        (r.locationState && r.locationState.toLowerCase().includes(q)) ||
        (r.approvalStatus && r.approvalStatus.toLowerCase().includes(q))
    );
  }, [data.records, dateSearch]);

  const canCheckIn = !todayRec?.checkInTime;
  const canCheckOut = Boolean(todayRec?.checkInTime) && !todayRec?.checkOutTime;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/60">
              <Clock className="w-3.5 h-3.5 text-blue-600" />
              Attendance &amp; Hours
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs font-medium text-slate-500">
              DEC-01 &amp; DEC-02 Enforced
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 mt-1.5">
            My Attendance &amp; Check-In
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Single daily session (DEC-02). Mon–Sat {HRMS_POLICY.SCHEDULE_START_HHMM}–{HRMS_POLICY.SCHEDULE_END_HHMM} with automatic {HRMS_POLICY.LUNCH_START_HHMM}–{HRMS_POLICY.LUNCH_END_HHMM} lunch clipping.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {canCheckIn && (
            <button
              type="button"
              onClick={() => setPunchModalMode('CHECK_IN')}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              Check-In Now
            </button>
          )}
          {canCheckOut && (
            <button
              type="button"
              onClick={() => setPunchModalMode('CHECK_OUT')}
              className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <Clock className="w-4 h-4" />
              Check-Out Now
            </button>
          )}
        </div>
      </div>

      {state.status === 'unavailable' && (
        <StatusBanner tone="unavailable" title="Attendance API Endpoint Pending" description={state.message} />
      )}

      {/* Hero Today's Session Card */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-12 h-12 rounded-2xl bg-blue-50/80 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
            <Clock className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h3 className="font-bold text-slate-900 text-base">Today&apos;s Attendance Session</h3>
              {canCheckIn && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200/80">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                  No Punch Today
                </span>
              )}
              {canCheckOut && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                  Checked in at {todayRec?.checkInTime}
                </span>
              )}
              {todayRec?.checkOutTime && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                  Day Completed ({todayRec.checkInTime} – {todayRec.checkOutTime})
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {todayRec?.checkInTime
                ? `Check-In: ${todayRec.checkInTime} • ${todayRec.checkOutTime ? `Check-Out: ${todayRec.checkOutTime}` : 'Check-Out Pending (Shift active)'}`
                : `Please check in inside the ${HRMS_POLICY.OFFICE_GEOFENCE_RADIUS_METERS}m office perimeter with camera selfie.`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
          {canCheckIn && (
            <button
              type="button"
              onClick={() => setPunchModalMode('CHECK_IN')}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              Record Check-In
            </button>
          )}
          {canCheckOut && (
            <button
              type="button"
              onClick={() => setPunchModalMode('CHECK_OUT')}
              className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <Clock className="w-4 h-4" />
              Record Check-Out
            </button>
          )}
          {todayRec?.checkOutTime && (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200/80 px-3.5 py-2 rounded-xl">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              Day Completed
            </span>
          )}
        </div>
      </div>

      {/* KPI Overview Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1 */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-50/80 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
              <Camera className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Today&apos;s Check-In</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight font-mono">
              {todayRec?.checkInTime ?? '--'}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">
            {todayRec?.checkInTime ? 'Punch recorded' : 'Awaiting check-in'}
          </p>
        </div>

        {/* KPI 2 */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-50/80 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Today&apos;s Check-Out</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight font-mono">
              {todayRec?.checkOutTime ?? (todayRec?.checkInTime ? 'OPEN' : '--')}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">
            {todayRec?.checkOutTime ? 'Punch recorded' : 'Active working day'}
          </p>
        </div>

        {/* KPI 3 */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-50/80 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
              <Calendar className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Total Monthly Hours</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight font-mono">
              {formatMinutesAsDuration(totalMonthMinutes)}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">DEC-01 verified</p>
        </div>

        {/* KPI 4 */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-50/80 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
              <Compass className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Lunch Clipped</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight font-mono">
              {totalLunchClipped}m
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">13:00–14:00 interval</p>
        </div>
      </div>

      {/* Geofence Map & Policy Strip */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-12">
          <GeofenceBoundaryMap
            officeName={data.officeGeofence?.name ?? 'Headquarters Office'}
            officeLatitude={data.officeGeofence?.latitude ?? null}
            officeLongitude={data.officeGeofence?.longitude ?? null}
            radiusMeters={data.officeGeofence?.radiusMeters ?? HRMS_POLICY.OFFICE_GEOFENCE_RADIUS_METERS}
            employeeDistanceMeters={todayRec?.distanceFromOfficeMeters}
            gpsAccuracyMeters={todayRec?.gpsAccuracyMeters}
            employeeLabel={todayRec?.locationState ?? `Office ${HRMS_POLICY.OFFICE_GEOFENCE_RADIUS_METERS}m perimeter rule`}
            unconfigured={!data.officeGeofence}
          />
        </div>
      </div>

      {/* Attendance History Data Table */}
      <DataTable
        title="My Attendance History"
        description="Daily punch timestamps, automatic lunch clipping, and DEC-01 approved payable hours."
        searchPlaceholder="Filter by date (YYYY-MM-DD) or status..."
        searchValue={dateSearch}
        onSearchChange={setDateSearch}
        totalCount={data.records.length}
        filteredCount={filteredRecords.length}
        isLoading={state.status === 'loading'}
        error={state.status === 'error' ? state.message : null}
        onRetry={reload}
        emptyTitle="No attendance records found"
        emptyDescription="Your personal daily check-in and check-out sessions will appear chronologically here."
        onClearFilters={dateSearch ? () => setDateSearch('') : undefined}
      >
        <table className="w-full text-xs text-left">
          <thead className="bg-slate-50/90 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200 font-semibold">
            <tr>
              <th className="py-3 px-4">Date</th>
              <th className="py-3 px-4">Check-In / Check-Out</th>
              <th className="py-3 px-4 text-center">Lunch Clipped</th>
              <th className="py-3 px-4 text-right">Payable Hours (DEC-01)</th>
              <th className="py-3 px-4 text-center">Location</th>
              <th className="py-3 px-4 text-center">Approval Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredRecords.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50/70 transition-colors">
                <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                  {r.date}
                </td>
                <td className="py-3 px-4 font-mono tabular-nums text-slate-700">
                  <span className="font-medium text-slate-900">{r.checkInTime ?? '--'}</span>
                  <span className="mx-1 text-slate-400">→</span>
                  <span className={r.checkOutTime ? 'font-medium text-slate-900' : 'text-amber-600 font-semibold'}>
                    {r.checkOutTime ?? 'OPEN'}
                  </span>
                </td>
                <td className="py-3 px-4 font-mono tabular-nums text-center text-slate-500">
                  {r.lunchDeductionMinutes}m
                </td>
                <td className="py-3 px-4 font-mono tabular-nums text-right font-bold text-slate-900">
                  {formatMinutesAsDuration(r.approvedPayableMinutes)}
                </td>
                <td className="py-3 px-4 text-center">
                  <Badge
                    variant={r.locationState === 'INSIDE_GEOFENCE' ? 'success' : 'warning'}
                    className="text-[10px]"
                  >
                    {r.locationState === 'INSIDE_GEOFENCE' ? 'HQ ≤50m' : 'Outside HQ'}
                  </Badge>
                </td>
                <td className="py-3 px-4 text-center">
                  <Badge
                    variant={
                      r.approvalStatus === 'APPROVED'
                        ? 'success'
                        : r.approvalStatus === 'PENDING_ADMIN_REVIEW'
                          ? 'warning'
                          : 'destructive'
                    }
                    className="text-[10px]"
                  >
                    {r.approvalStatus}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTable>

      {/* Smart Attendance Modal */}
      {user && (
        <SmartAttendanceModal
          open={Boolean(punchModalMode)}
          onClose={() => setPunchModalMode(null)}
          employee={{
            id: user.id,
            fullName: user.fullName,
            employeeCode: user.employeeCode,
            jobCategory: user.jobCategory ?? 'OFFICE',
          }}
          officeGeofence={data.officeGeofence}
          mode={punchModalMode ?? 'CHECK_IN'}
          onSubmitted={reload}
        />
      )}
    </div>
  );
};
