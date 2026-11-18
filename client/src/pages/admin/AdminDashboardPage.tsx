import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  MapPin,
  Navigation,
  Settings,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Users,
} from 'lucide-react';
import type {
  DailyAttendanceRecord,
  EmployeeProfile,
  LeaveApplicationRecord,
} from '../../types/hrms';
import { useAuth } from '../../context/AuthContext';
import { useApiResource } from '../../hooks/useApiResource';
import {
  countEmployeesExcludingAdmin,
  excludeAdminFromEmployees,
  HRMS_POLICY,
} from '../../lib/domainRules';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { MetricCard } from '../../components/ui/MetricCard';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { AdminReviewModal } from '../../components/attendance/AdminReviewModal';

interface AdminDashboardData {
  employees: EmployeeProfile[];
  attendanceRecords: DailyAttendanceRecord[];
  leaveApplications: LeaveApplicationRecord[];
  payrollDraftCount: number;
  payrollProcessedMonths: number;
}

const EMPTY_ADMIN_DASHBOARD: AdminDashboardData = {
  employees: [],
  attendanceRecords: [],
  leaveApplications: [],
  payrollDraftCount: 0,
  payrollProcessedMonths: 0,
};

export const AdminDashboardPage: React.FC = () => {
  const { user } = useAuth();
  const { state, data, reload } = useApiResource<AdminDashboardData>(
    '/api/v1/admin/dashboard',
    EMPTY_ADMIN_DASHBOARD
  );
  const [reviewRecord, setReviewRecord] = useState<DailyAttendanceRecord | null>(null);

  const employees = useMemo(() => excludeAdminFromEmployees(data.employees), [data.employees]);
  const employeeCount = useMemo(() => countEmployeesExcludingAdmin(employees), [employees]);

  const pendingAttendance = useMemo(
    () =>
      data.attendanceRecords.filter(
        (r) =>
          r.approvalStatus === 'PENDING_ADMIN_REVIEW' ||
          r.approvalStatus === 'VERIFICATION_PENDING'
      ),
    [data.attendanceRecords]
  );

  const pendingLeaves = useMemo(
    () => data.leaveApplications.filter((l) => l.status === 'PENDING'),
    [data.leaveApplications]
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Header Command Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#0B357A] bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
              Command Overview
            </span>
            <span className="text-xs text-slate-500">• Org Governance Active</span>
            {user?.fullName && (
              <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                Welcome, {user.fullName}
              </span>
            )}
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 mt-1">
            Executive Command &amp; Governance Center
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Strict 2-role governance boundary: 1 dedicated ADMIN account controlling workforce operations, verified biometric attendance, and hourly payroll.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <Link to="/admin/employees">
            <Button size="sm" variant="outline">
              <Users className="w-3.5 h-3.5" />
              Workforce
            </Button>
          </Link>
          <Link to="/admin/attendance">
            <Button size="sm" variant="outline">
              <ClipboardCheck className="w-3.5 h-3.5" />
              Attendance
            </Button>
          </Link>
          <Link to="/admin/payroll">
            <Button size="sm" variant="primary">
              <CreditCard className="w-3.5 h-3.5" />
              Payroll Run
            </Button>
          </Link>
        </div>
      </div>

      {state.status === 'unavailable' && (
        <StatusBanner
          tone="unavailable"
          title="Admin Domain API Endpoints Not Yet Connected"
          description={state.message}
        />
      )}
      {state.status === 'error' && (
        <StatusBanner
          tone="error"
          title="Unable to Load Organization Summary"
          description={state.message}
        />
      )}

      {/* Primary KPI Metric Cards (High-Density, Zero-Fluff) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Active Workforce"
          value={state.status === 'loading' ? '--' : `${employeeCount} / ${HRMS_POLICY.INITIAL_DEPLOYMENT_EMPLOYEES}`}
          subtitle="1 Separate Admin Excluded"
          badge={<Badge variant="primary" dot>Live Roster</Badge>}
          icon={<Users className="w-4 h-4" />}
          tone="info"
        />

        <MetricCard
          label="Attendance Review Queue"
          value={state.status === 'loading' ? '--' : pendingAttendance.length}
          subtitle={`Outside ${HRMS_POLICY.OFFICE_GEOFENCE_RADIUS_METERS}m / Biometric Holds`}
          badge={
            pendingAttendance.length > 0 ? (
              <Badge variant="warning" dot>Action Required</Badge>
            ) : (
              <Badge variant="success" dot>Cleared</Badge>
            )
          }
          icon={<ShieldAlert className="w-4 h-4" />}
          tone={pendingAttendance.length > 0 ? 'warning' : 'default'}
        />

        <MetricCard
          label="Pending Leave Requests"
          value={state.status === 'loading' ? '--' : pendingLeaves.length}
          subtitle="PO-03 Unpaid Policy Enforced"
          badge={<Badge variant="default">CL • SL • PL • LWP</Badge>}
          icon={<CalendarClock className="w-4 h-4" />}
          tone="default"
        />

        <MetricCard
          label="Hourly Payroll Batches"
          value={state.status === 'loading' ? '--' : data.payrollDraftCount}
          subtitle={`${data.payrollProcessedMonths} Processed Months On Record`}
          badge={<Badge variant="success" dot>DEC-01 Engine</Badge>}
          icon={<CreditCard className="w-4 h-4" />}
          tone="success"
        />
      </div>

      {/* Core Policy Invariant Strip */}
      <div className="rounded-2xl bg-[#0B1528] border border-[#1E293B] text-white p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400 shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <p className="font-semibold text-slate-100 flex items-center gap-1.5">
              <span>Enterprise Compliance Matrix Active</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#132240] text-emerald-300 border border-emerald-500/30">
                LOCKED
              </span>
            </p>
            <p className="text-[11px] text-slate-300 mt-0.5">
              Shift {HRMS_POLICY.SCHEDULE_START_HHMM}–{HRMS_POLICY.SCHEDULE_END_HHMM} • Lunch {HRMS_POLICY.LUNCH_START_HHMM}–{HRMS_POLICY.LUNCH_END_HHMM} unpayable clipping • Single daily check-in (DEC-02) • MiniFASNet 0.62 Liveness
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-300 font-mono shrink-0">
          <span className="flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 text-emerald-400" />
            {HRMS_POLICY.OFFICE_GEOFENCE_RADIUS_METERS}m HQ Perimeter
          </span>
          <span className="text-slate-600">|</span>
          <span>≤ {HRMS_POLICY.MAX_GPS_ACCURACY_METERS}m GPS Accuracy</span>
        </div>
      </div>

      {/* Operational Queues: Attendance Exception Review & Leave Approval */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Attendance Review Queue */}
        <Card className="lg:col-span-7">
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4 text-amber-600" />
                <span>Attendance Exception Queue</span>
                {pendingAttendance.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-mono font-bold">
                    {pendingAttendance.length}
                  </span>
                )}
              </CardTitle>
              <CardDescription>
                Outside-office check-ins and pending biometric verifications requiring Maker-Checker Admin approval.
              </CardDescription>
            </div>
            <Link to="/admin/attendance">
              <Button size="sm" variant="ghost">
                View Log
                <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </CardHeader>

          <CardContent className="p-0">
            {state.status === 'loading' ? (
              <div className="p-6">
                <EmptyState variant="loading" title="Loading pending exceptions..." compact />
              </div>
            ) : pendingAttendance.length === 0 ? (
              <div className="py-10">
                <EmptyState
                  variant="empty"
                  title="Exception queue is clear"
                  description="All submitted punches conform to HQ geofence and biometric thresholds."
                  compact
                />
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {pendingAttendance.map((rec) => (
                  <div
                    key={rec.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs hover:bg-slate-50/70 transition-colors"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded text-[11px] border border-indigo-200">
                          {rec.employeeCode}
                        </span>
                        <span className="font-semibold text-slate-900 truncate">
                          {rec.employeeName}
                        </span>
                        <Badge
                          variant={rec.approvalStatus === 'VERIFICATION_PENDING' ? 'warning' : 'destructive'}
                          dot
                        >
                          {rec.approvalStatus === 'VERIFICATION_PENDING'
                            ? 'LIVENESS PENDING'
                            : 'OUTSIDE GEOFENCE'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono">
                        <span>{rec.date}</span>
                        <span>•</span>
                        <span>Check-In: {rec.checkInTime ?? '--'}</span>
                        <span>•</span>
                        <span className={rec.distanceFromOfficeMeters && rec.distanceFromOfficeMeters > 50 ? 'text-rose-600 font-bold' : ''}>
                          {rec.distanceFromOfficeMeters !== null && rec.distanceFromOfficeMeters !== undefined
                            ? `${rec.distanceFromOfficeMeters}m away`
                            : 'Distance N/A'}
                        </span>
                      </div>
                      {rec.employeeComment && (
                        <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200/80 rounded px-2 py-1 italic mt-1 line-clamp-1">
                          "{rec.employeeComment}"
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => setReviewRecord(rec)}
                      className="shrink-0"
                    >
                      Review Evidence
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Leave Queue */}
        <Card className="lg:col-span-5">
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-indigo-600" />
                <span>Pending Leave Requests</span>
                {pendingLeaves.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[10px] font-mono font-bold">
                    {pendingLeaves.length}
                  </span>
                )}
              </CardTitle>
              <CardDescription>Employee leave applications under review.</CardDescription>
            </div>
            <Link to="/admin/leave">
              <Button size="sm" variant="ghost">
                Manage
                <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </CardHeader>

          <CardContent className="p-0">
            {state.status === 'loading' ? (
              <div className="p-6">
                <EmptyState variant="loading" title="Loading leave queue..." compact />
              </div>
            ) : pendingLeaves.length === 0 ? (
              <div className="py-10">
                <EmptyState
                  variant="empty"
                  title="No pending leaves"
                  description="All leave requests have been reviewed and decided."
                  compact
                />
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {pendingLeaves.map((lv) => (
                  <div key={lv.id} className="p-4 text-xs space-y-1.5 hover:bg-slate-50/70 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 truncate">
                        <span className="font-mono text-slate-500 font-bold text-[11px]">
                          {lv.employeeCode}
                        </span>
                        <span className="font-semibold text-slate-900 truncate">
                          {lv.employeeName}
                        </span>
                      </div>
                      <Badge variant="outline">{lv.category}</Badge>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                      <span>{lv.startDate} → {lv.endDate}</span>
                      <span className="font-bold text-slate-700">{lv.totalDays} Day{lv.totalDays > 1 ? 's' : ''} (Unpaid)</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Governance Directory Navigation */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="text-sm font-semibold">Governance Operations Directory</CardTitle>
            <CardDescription>
              Direct shortcuts to operational consoles, biometric identity mappings, and compliance modules.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            {[
              {
                to: '/admin/employees',
                title: 'Workforce Roster',
                desc: '15-employee target roster & Maker-Checker provisioning.',
                icon: Users,
              },
              {
                to: '/admin/teams',
                title: 'Departments & Teams',
                desc: 'Job category classifications (Sales, Recovery, Office).',
                icon: UserCheck,
              },
              {
                to: '/admin/field-force',
                title: 'Field-Force GPS',
                desc: 'Real-time routes, visit logs, and field distance tracking.',
                icon: Navigation,
              },
              {
                to: '/admin/payroll',
                title: 'Hourly Payroll',
                desc: 'DEC-01 working-hour payroll calculation & payment logs.',
                icon: CreditCard,
              },
              {
                to: '/admin/reports',
                title: 'Compliance Reports',
                desc: 'Attendance compliance, overtime audit, and CSV export.',
                icon: BarChart3,
              },
              {
                to: '/admin/settings',
                title: 'HQ Geofence Editor',
                desc: '50m perimeter coordinates & location change history.',
                icon: MapPin,
              },
              {
                to: '/admin/security',
                title: 'Biometrics & Security',
                desc: 'CompreFace mappings, liveness queue & active sessions.',
                icon: Settings,
              },
              {
                to: '/admin/attendance',
                title: 'Daily Attendance',
                desc: 'DEC-01 calculator, punch logs, and audited corrections.',
                icon: CheckCircle2,
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className="p-3.5 rounded-xl border border-slate-200/90 bg-white hover:border-indigo-400 hover:shadow-sm transition-all duration-150 space-y-1.5 group"
                >
                  <div className="flex items-center justify-between">
                    <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all" />
                  </div>
                  <p className="font-semibold text-slate-900">{item.title}</p>
                  <p className="text-[11px] text-slate-500 leading-relaxed">{item.desc}</p>
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <AdminReviewModal
        record={reviewRecord}
        onClose={() => setReviewRecord(null)}
        onReviewed={reload}
      />
    </div>
  );
};
