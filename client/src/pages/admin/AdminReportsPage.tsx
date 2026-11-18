import React, { useState } from 'react';
import {
  BarChart3,
  Clock,
  CreditCard,
  MapPin,
  Navigation,
  Printer,
  Users,
} from 'lucide-react';
import { formatInr, formatMinutesAsDuration } from '../../lib/domainRules';
import { useApiResource } from '../../hooks/useApiResource';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { MetricCard } from '../../components/ui/MetricCard';
import { Input } from '../../components/ui/Input';

interface AdminReportsSummary {
  month: string;
  employeeCount: number;
  totalAttendanceRecords: number;
  pendingExceptionsCount: number;
  totalApprovedMinutes: number;
  approvedLeaveDays: number;
  fieldSessionsCount: number;
  completedVisitsCount: number;
  payrollTotalNetInr: number;
}

export const AdminReportsPage: React.FC = () => {
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const { state, data } = useApiResource<{ report: AdminReportsSummary | null }>(
    `/api/v1/admin/reports?month=${encodeURIComponent(selectedMonth)}`,
    { report: null }
  );

  const report = data.report;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/60">
              <BarChart3 className="w-3 h-3 text-indigo-600" />
              Executive Analytics &amp; Compliance
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs font-mono font-medium text-slate-500">
              Cycle: {selectedMonth}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-1">
            Reports &amp; Operational Audit
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Aggregated metrics for personnel attendance, DEC-01 working hours, field customer visits, and payroll liabilities.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Input
            type="month"
            inputSize="sm"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="w-36 font-mono text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.print()}
            className="shadow-2xs"
          >
            <Printer className="w-3.5 h-3.5 mr-1.5" />
            Print Report
          </Button>
        </div>
      </div>

      {state.status === 'unavailable' && (
        <StatusBanner tone="unavailable" title="Reporting API Pending" description={state.message} />
      )}

      {state.status === 'loading' ? (
        <Card className="shadow-card">
          <CardContent className="py-12">
            <EmptyState variant="loading" title="Loading monthly report..." />
          </CardContent>
        </Card>
      ) : state.status === 'error' ? (
        <Card className="shadow-card">
          <CardContent className="py-12">
            <EmptyState variant="error" title="Report query failed" description={state.message} />
          </CardContent>
        </Card>
      ) : !report ? (
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="w-4 h-4 text-indigo-600" />
              Monthly Aggregate ({selectedMonth})
            </CardTitle>
            <CardDescription className="text-xs text-slate-500">
              Real database metrics will appear once domain records exist for this period.
            </CardDescription>
          </CardHeader>
          <CardContent className="py-12">
            <EmptyState
              variant="empty"
              title="No report data yet"
              description={`No verified operational telemetry has been recorded for ${selectedMonth}.`}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Executive KPI Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard
              label="Active Personnel"
              value={report.employeeCount}
              icon={Users}
              tone="primary"
              subtitle="Excludes Admin account"
            />
            <MetricCard
              label="Approved Payable Time"
              value={formatMinutesAsDuration(report.totalApprovedMinutes)}
              icon={Clock}
              tone="info"
              subtitle="DEC-01 compliant shift duration"
            />
            <MetricCard
              label="Completed Visits"
              value={report.completedVisitsCount}
              icon={MapPin}
              tone="success"
              subtitle="Field client visits verified"
            />
            <MetricCard
              label="Net Payroll Liability"
              value={formatInr(report.payrollTotalNetInr)}
              icon={CreditCard}
              tone="warning"
              subtitle={`Final net payable for ${selectedMonth}`}
            />
          </div>

          {/* Operational Breakdown Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Attendance & Compliance Summary */}
            <Card className="shadow-card">
              <CardHeader className="border-b border-slate-100 pb-3">
                <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-indigo-600" />
                  Attendance &amp; Schedule Compliance
                </CardTitle>
                <CardDescription className="text-xs text-slate-500">
                  Daily punch sessions, geofence audit compliance, and unpaid leave records.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-3">
                <div className="divide-y divide-slate-100 text-xs">
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-slate-600">Total Recorded Sessions</span>
                    <span className="font-mono font-bold text-slate-900 tabular-nums">
                      {report.totalAttendanceRecords}
                    </span>
                  </div>
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-slate-600">Outside-Office Exceptions Awaiting Review</span>
                    <span className="font-mono font-bold text-amber-600 tabular-nums">
                      {report.pendingExceptionsCount}
                    </span>
                  </div>
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-slate-600">Approved Unpaid Leave Days (PO-03)</span>
                    <span className="font-mono font-bold text-slate-900 tabular-nums">
                      {report.approvedLeaveDays} days (0h payable)
                    </span>
                  </div>
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-slate-600">DEC-01 Shift Policy</span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      Mon–Sat 10:00–18:00
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Field Force & Biometric Audit */}
            <Card className="shadow-card">
              <CardHeader className="border-b border-slate-100 pb-3">
                <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Navigation className="w-4 h-4 text-indigo-600" />
                  Field Force &amp; Biometric Governance
                </CardTitle>
                <CardDescription className="text-xs text-slate-500">
                  Sales &amp; Recovery telemetry audit and biometric verification compliance.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-3">
                <div className="divide-y divide-slate-100 text-xs">
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-slate-600">Field Duty Sessions Conducted</span>
                    <span className="font-mono font-bold text-slate-900 tabular-nums">
                      {report.fieldSessionsCount}
                    </span>
                  </div>
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-slate-600">Client / Recovery Stops Completed</span>
                    <span className="font-mono font-bold text-slate-900 tabular-nums">
                      {report.completedVisitsCount}
                    </span>
                  </div>
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-slate-600">Anti-Spoofing &amp; Liveness Validation</span>
                    <Badge variant="success" className="text-[10px]">
                      MiniFASNet (≥0.62)
                    </Badge>
                  </div>
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-slate-600">Office Geofence Boundary</span>
                    <Badge variant="outline" className="text-[10px]">
                      50m Radius • ≤30m Accuracy
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
};
