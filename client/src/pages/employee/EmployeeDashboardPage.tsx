import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Bell,
  Briefcase,
  Calendar,
  Camera,
  CheckCircle2,
  CheckSquare,
  ClipboardCheck,
  Clock,
  Leaf,
  MapPin,
  ShieldCheck,
  Timer,
  Wallet,
} from 'lucide-react';
import type {
  DailyAttendanceRecord,
  FieldDutySessionRecord,
  SystemNotification,
} from '../../types/hrms';
import { formatJobCategoryLabel } from '../../types/role';
import { formatInr, formatMinutesAsDuration, HRMS_POLICY } from '../../lib/domainRules';
import { useAuth } from '../../context/AuthContext';
import { useApiResource } from '../../hooks/useApiResource';
import { StatusBanner } from '../../components/ui/StatusBanner';
import {
  SmartAttendanceModal,
  type OfficeGeofenceConfig,
} from '../../components/attendance/SmartAttendanceModal';

interface EmployeeTaskSummary {
  id: string;
  title: string;
  dueDate?: string;
  status: string;
  priority?: string;
}

interface EmployeeDashboardPayload {
  todayAttendance: DailyAttendanceRecord | null;
  activeFieldSession: FieldDutySessionRecord | null;
  monthlyPayableMinutes: number;
  pendingLeavesCount: number;
  latestApprovedNetSalaryInr: number | null;
  tasks: EmployeeTaskSummary[];
  notifications: SystemNotification[];
  officeGeofence: OfficeGeofenceConfig | null;
}

const EMPTY_EMP_DASHBOARD: EmployeeDashboardPayload = {
  todayAttendance: null,
  activeFieldSession: null,
  monthlyPayableMinutes: 0,
  pendingLeavesCount: 0,
  latestApprovedNetSalaryInr: null,
  tasks: [],
  notifications: [],
  officeGeofence: null,
};

export const EmployeeDashboardPage: React.FC = () => {
  const { user } = useAuth();
  const { state, data, reload } = useApiResource<EmployeeDashboardPayload>(
    '/api/v1/employee/dashboard',
    EMPTY_EMP_DASHBOARD
  );

  const [punchMode, setPunchMode] = useState<'CHECK_IN' | 'CHECK_OUT' | null>(null);

  const jobCategory = user?.jobCategory ?? 'OFFICE';
  const todayRec = data.todayAttendance;
  const canCheckIn = !todayRec?.checkInTime;
  const canCheckOut = Boolean(todayRec?.checkInTime) && !todayRec?.checkOutTime;

  // Context-aware dynamic greeting based on IST hour (matches reference e.g. "Good afternoon, Alugu varun")
  const timeGreeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  return (
    <div className="space-y-6 animate-fade-in font-sans">
      {/* 1. Header & Welcome Greeting Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
        <div>
          {/* Workspace Pill Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200/80 text-xs font-semibold">
            <Briefcase className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>{formatJobCategoryLabel(jobCategory)} Workspace</span>
            <span className="text-emerald-300 font-light">|</span>
            <span className="font-mono text-emerald-700">{user?.employeeCode ?? 'EMP001'}</span>
          </div>

          {/* Personalized Headline */}
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 mt-2">
            {timeGreeting}, {user?.fullName ?? 'Alugu varun'}
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-1">
            Shift: Mon-Sat {HRMS_POLICY.SCHEDULE_START_HHMM}–{HRMS_POLICY.SCHEDULE_END_HHMM} • {HRMS_POLICY.LUNCH_START_HHMM}–{HRMS_POLICY.LUNCH_END_HHMM} lunch policy (DEC-01)
          </p>
        </div>

        {/* Top Right Action: Prominent Smart Check-In Button */}
        <div className="flex items-center gap-3 shrink-0">
          {canCheckIn && (
            <button
              type="button"
              onClick={() => setPunchMode('CHECK_IN')}
              className="inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm px-5 py-2.5 rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              Smart Check-In
            </button>
          )}
          {canCheckOut && (
            <button
              type="button"
              onClick={() => setPunchMode('CHECK_OUT')}
              className="inline-flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-sm px-5 py-2.5 rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <Clock className="w-4 h-4" />
              Smart Check-Out
            </button>
          )}
          {todayRec?.checkOutTime && (
            <span className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 border border-emerald-200 px-4 py-2 rounded-xl text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              Day Completed
            </span>
          )}
        </div>
      </div>

      {state.status === 'unavailable' && (
        <StatusBanner
          tone="unavailable"
          title="Employee Domain APIs Pending Implementation"
          description={state.message}
        />
      )}
      {state.status === 'error' && (
        <StatusBanner
          tone="error"
          title="Unable to Load Personal Dashboard"
          description={state.message}
        />
      )}

      {/* 2. Today's Attendance Session Card Matching Reference */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-12 h-12 rounded-2xl bg-blue-50/80 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
            <Clock className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h3 className="font-bold text-slate-900 text-base">Today&apos;s attendance</h3>
              {canCheckIn && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200/80">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                  Not checked in
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
            <p className="text-xs text-slate-500 mt-1 font-medium">
              {todayRec?.checkInTime
                ? todayRec.checkOutTime
                  ? `Completed shift session • ${
                      todayRec.approvedPayableMinutes
                        ? formatMinutesAsDuration(todayRec.approvedPayableMinutes)
                        : 'Recorded'
                    } payable time.`
                  : 'Check-in verified inside 50m geofence. Session active.'
                : `Check-in must occur inside the ${HRMS_POLICY.OFFICE_GEOFENCE_RADIUS_METERS}m office geofence.`}
            </p>
          </div>
        </div>

        {/* Action Button */}
        <div className="shrink-0 self-start sm:self-auto">
          {canCheckIn && (
            <button
              type="button"
              onClick={() => setPunchMode('CHECK_IN')}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              Record check-in
            </button>
          )}
          {canCheckOut && (
            <button
              type="button"
              onClick={() => setPunchMode('CHECK_OUT')}
              className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <Clock className="w-4 h-4" />
              Record check-out
            </button>
          )}
          {todayRec?.checkOutTime && (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200/80 px-3.5 py-2 rounded-xl">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              Session Closed
            </span>
          )}
        </div>
      </div>

      {/* 3. Four Equal KPI Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Today's Hours */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-50/80 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
              <Calendar className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Today&apos;s Hours</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight">
              {todayRec?.approvedPayableMinutes
                ? formatMinutesAsDuration(todayRec.approvedPayableMinutes)
                : todayRec?.checkInTime
                  ? 'In Progress'
                  : '--'}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">DEC-02 single session</p>
        </div>

        {/* KPI 2: Working Hours This Month */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-50/80 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
              <Timer className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Working Hours This Month</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight">
              {formatMinutesAsDuration(data.monthlyPayableMinutes)}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">DEC-01 verified payable time</p>
        </div>

        {/* KPI 3: Pending Leaves */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-50/80 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
              <Leaf className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Pending Leaves</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight">
              {data.pendingLeavesCount}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">CL, SL, PL, LWP (unpaid 0h)</p>
        </div>

        {/* KPI 4: Latest Approved Pay */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-50/80 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
              <Wallet className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Latest Approved Pay</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight">
              {data.latestApprovedNetSalaryInr !== null
                ? formatInr(data.latestApprovedNetSalaryInr)
                : '--'}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">Unlocks on Admin approval</p>
        </div>
      </div>

      {/* 4. Role-Specific Attendance Policy Strip */}
      <div className="rounded-2xl border border-blue-100/90 bg-blue-50/60 p-4 flex items-start sm:items-center gap-3.5 shadow-2xs">
        <div className="w-9 h-9 rounded-xl bg-blue-100/70 text-blue-700 flex items-center justify-center shrink-0">
          <MapPin className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <span className="font-bold text-xs text-blue-950 block">
            {formatJobCategoryLabel(jobCategory)} Attendance Policy
          </span>
          <p className="text-xs text-blue-900/80 mt-0.5 leading-relaxed font-normal">
            Check-in and check-out require physical presence inside the {HRMS_POLICY.OFFICE_GEOFENCE_RADIUS_METERS}m HQ perimeter (GPS accuracy ≤{HRMS_POLICY.MAX_GPS_ACCURACY_METERS}m) with live selfie verification. Remote punches without field eligibility are restricted.
          </p>
        </div>
      </div>

      {/* 5. Two Feature Cards: Assigned Tasks & Notifications */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card A: My Assigned Tasks */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100/80 text-indigo-600 flex items-center justify-center shrink-0">
                  <CheckSquare className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    My Assigned Tasks ({data.tasks.length})
                  </h4>
                  <p className="text-xs text-slate-500">Operational action items assigned to you.</p>
                </div>
              </div>
              <Link
                to="/employee/tasks"
                className="text-xs font-semibold text-slate-700 hover:text-blue-600 flex items-center gap-1 transition-colors"
              >
                View All
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            <div className="pt-3">
              {data.tasks.length === 0 ? (
                <div className="py-10 flex flex-col items-center justify-center text-center">
                  <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-200/70 flex items-center justify-center text-slate-400 mb-2.5">
                    <ClipboardCheck className="w-7 h-7 text-slate-400" />
                  </div>
                  <p className="text-sm font-bold text-slate-800">No assigned tasks</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Tasks assigned by management will display here.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 text-xs">
                  {data.tasks.slice(0, 5).map((task) => (
                    <div
                      key={task.id}
                      className="py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50/60 px-2 rounded-xl transition-colors"
                    >
                      <div>
                        <p className="font-semibold text-slate-900">{task.title}</p>
                        {task.dueDate && (
                          <p className="text-[11px] font-mono text-slate-500 tabular-nums">
                            Due {task.dueDate}
                          </p>
                        )}
                      </div>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                        {task.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Card B: Notifications & Alerts */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100/80 text-indigo-600 flex items-center justify-center shrink-0">
                  <Bell className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    Notifications &amp; Alerts ({data.notifications.length})
                  </h4>
                  <p className="text-xs text-slate-500">
                    Attendance reviews, leave decisions, and payslip releases.
                  </p>
                </div>
              </div>
              <Link
                to="/employee/notifications"
                className="text-xs font-semibold text-slate-700 hover:text-blue-600 flex items-center gap-1 transition-colors"
              >
                All Alerts
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            <div className="pt-3">
              {data.notifications.length === 0 ? (
                <div className="py-10 flex flex-col items-center justify-center text-center">
                  <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-200/70 flex items-center justify-center text-slate-400 mb-2.5">
                    <Bell className="w-7 h-7 text-slate-400" />
                  </div>
                  <p className="text-sm font-bold text-slate-800">No notifications</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    You have no unread alerts at this time.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 text-xs">
                  {data.notifications.slice(0, 5).map((n) => (
                    <div
                      key={n.id}
                      className="py-2.5 space-y-0.5 hover:bg-slate-50/60 px-2 rounded-xl transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900">{n.title}</span>
                        <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                          {n.timestamp}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 line-clamp-2">{n.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 6. Quick Self-Service Navigation Strip Matching Reference */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-2 text-slate-600 font-medium">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>
            Personal workspace: Only your own attendance, hours, leaves, and approved payslips are accessible.
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <Link to="/employee/attendance">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
            >
              <Calendar className="w-3.5 h-3.5 text-blue-600" />
              Attendance &amp; Hours
            </button>
          </Link>
          <Link to="/employee/leave">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
            >
              <Leaf className="w-3.5 h-3.5 text-emerald-600" />
              Apply Leave
            </button>
          </Link>
          <Link to="/employee/payroll">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
            >
              <Wallet className="w-3.5 h-3.5 text-indigo-600" />
              My Payslips
            </button>
          </Link>
        </div>
      </div>

      {/* 7. Smart Attendance Modal (Webcam Selfie Capture + Liveness + 50m Geofence) */}
      {user && (
        <SmartAttendanceModal
          open={Boolean(punchMode)}
          onClose={() => setPunchMode(null)}
          employee={{
            id: user.id,
            fullName: user.fullName,
            employeeCode: user.employeeCode,
            jobCategory: jobCategory,
          }}
          officeGeofence={data.officeGeofence}
          mode={punchMode ?? 'CHECK_IN'}
          onSubmitted={reload}
        />
      )}
    </div>
  );
};
