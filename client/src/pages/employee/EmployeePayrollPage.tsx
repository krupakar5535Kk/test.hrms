import React, { useState } from 'react';
import {
  CreditCard,
  Printer,
  Calendar,
  Clock,
  ShieldCheck,
  CheckCircle2,
  FileText,
  DollarSign,
} from 'lucide-react';
import type { PayrollLineItem } from '../../types/hrms';
import { formatInr } from '../../lib/domainRules';
import { useAuth } from '../../context/AuthContext';
import { useApiResource } from '../../hooks/useApiResource';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { Dialog } from '../../components/ui/Dialog';

export const EmployeePayrollPage: React.FC = () => {
  const { user } = useAuth();
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const { state, data } = useApiResource<{ items: PayrollLineItem[] }>(
    `/api/v1/employee/payroll?month=${encodeURIComponent(selectedMonth)}`,
    { items: [] }
  );

  const [payslipPreview, setPayslipPreview] = useState<PayrollLineItem | null>(null);

  const currentItem = data.items[0] || null;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/60">
              EMPLOYEE PORTAL
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs text-slate-500 font-medium">DEC-01: Hourly Wages</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 mt-1.5">
            My Salary &amp; Payslips
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Review your approved working hours, Sat 10:00–18:00 with official payslip releases.
          </p>
        </div>

        {/* Month Selector */}
        <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200/80 shadow-xs self-start sm:self-auto">
          <Calendar className="w-4 h-4 text-slate-400" />
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="h-8 font-mono text-xs text-slate-800 bg-transparent focus:outline-hidden cursor-pointer"
          />
        </div>
      </div>

      {/* Hourly Wage Policy Banner */}
      <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 text-xs text-slate-700 shadow-xs flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-bold text-slate-900">
            Approved Working-Hour Compensation Policy (DEC-01)
          </p>
          <p className="leading-relaxed text-slate-600">
            Wages are computed deterministically from approved working hours (10:00–18:00 standard shift, 13:00–14:00 unpaid lunch interval deducted). Post-18:00 working time is subject to explicit Administrator verification and is compensated at the standard <strong>1.0x hourly rate</strong> (no overtime multiplier). Official payslips unlock once marked <strong>APPROVED</strong> by Administration.
          </p>
        </div>
      </div>

      {state.status === 'unavailable' && (
        <StatusBanner tone="unavailable" title="Employee Payroll API Pending" description={state.message} />
      )}

      {/* Monthly Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Approved Hours */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-50/80 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Approved Hours</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight font-mono">
              {currentItem ? `${currentItem.approvedWorkingHours} hrs` : '--'}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">Month: {selectedMonth}</p>
        </div>

        {/* KPI 2: Base Hourly Rate */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 shrink-0">
              <DollarSign className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Base Hourly Rate</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight font-mono">
              {currentItem ? `${formatInr(currentItem.hourlyRate)}/h` : '--'}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">Monthly divisor rate</p>
        </div>

        {/* KPI 3: Net Salary */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-50/80 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
              <CreditCard className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Net Salary</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight font-mono">
              {currentItem ? formatInr(currentItem.netSalary) : '--'}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">
            {currentItem ? `Status: ${currentItem.paymentStatus}` : 'Awaiting computation'}
          </p>
        </div>

        {/* KPI 4: Approval Gate */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-50/80 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Approval Gate</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight font-mono">
              {currentItem ? currentItem.approvalStatus : 'NO RECORD'}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">Pending Admin sign-off</p>
        </div>
      </div>

      {/* Payslip Records Ledger Card */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Payslip Ledger — {selectedMonth}</h2>
              <p className="text-xs text-slate-500">
                Proportional net earnings calculated from verified attendance logs.
              </p>
            </div>
          </div>

          {currentItem && (
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                currentItem.approvalStatus === 'APPROVED'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border border-amber-200'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${currentItem.approvalStatus === 'APPROVED' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              {currentItem.approvalStatus === 'APPROVED' ? 'RELEASED' : 'DRAFT REVIEW'}
            </span>
          )}
        </div>

        {state.status === 'loading' ? (
          <div className="py-12 text-center text-slate-400 text-xs">Loading payslip records...</div>
        ) : !currentItem ? (
          <div className="py-12 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-center text-slate-400 mb-3">
              <FileText className="w-8 h-8" />
            </div>
            <h4 className="font-bold text-slate-800 text-sm">No payroll issued for this period.</h4>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">
              The payroll ledger for {selectedMonth} has not been generated by the organization administration yet.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50/90 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200 font-semibold">
                  <tr>
                    <th className="py-3 px-4">Period</th>
                    <th className="py-3 px-4">Approved Hours</th>
                    <th className="py-3 px-4">Hourly Rate</th>
                    <th className="py-3 px-4">Gross Earnings</th>
                    <th className="py-3 px-4">Deductions</th>
                    <th className="py-3 px-4 font-bold text-slate-900">Net Payable</th>
                    <th className="py-3 px-4 text-center">Approval Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4 font-mono font-semibold text-slate-900">{currentItem.month}</td>
                    <td className="py-3 px-4 font-mono text-slate-700">{currentItem.approvedWorkingHours} hrs</td>
                    <td className="py-3 px-4 font-mono text-slate-700">{formatInr(currentItem.hourlyRate)}/h</td>
                    <td className="py-3 px-4 font-mono text-slate-700">{formatInr(currentItem.grossEarned)}</td>
                    <td className="py-3 px-4 font-mono text-rose-600">-{formatInr(currentItem.adjustments)}</td>
                    <td className="py-3 px-4 font-mono font-bold text-emerald-700 text-sm">
                      {formatInr(currentItem.netSalary)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                          currentItem.approvalStatus === 'APPROVED'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {currentItem.approvalStatus}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {currentItem.approvalStatus === 'APPROVED' ? (
                        <button
                          type="button"
                          onClick={() => setPayslipPreview(currentItem)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs cursor-pointer shadow-2xs transition-colors"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          View Payslip
                        </button>
                      ) : (
                        <span className="text-slate-400 text-xs italic">Awaiting Approval</span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Payslip View Modal */}
      {payslipPreview && (
        <Dialog
          open={Boolean(payslipPreview)}
          onClose={() => setPayslipPreview(null)}
          title={`Official Payslip — ${payslipPreview.month}`}
          description={`Employee: ${user?.fullName ?? 'Employee'} (${user?.employeeCode ?? 'EMP001'})`}
        >
          <div className="space-y-6 text-xs p-2 print:p-0">
            {/* Header / Letterhead */}
            <div className="flex items-center justify-between border-b pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center p-1 shrink-0">
                  <img src="/kmaccs-logo.png" alt="KMACCS Emblem" className="w-full h-full object-contain" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base leading-tight">
                    Karthikeya Mutually Aided Cooperative Credit Society Limited
                  </h3>
                  <p className="text-[11px] text-slate-500">Official Monthly Wage Statement (DEC-01 Compliant)</p>
                </div>
              </div>
              <div className="text-right font-mono text-[11px] text-slate-500">
                <p>Period: {payslipPreview.month}</p>
                <p className="text-emerald-700 font-semibold">STATUS: APPROVED</p>
              </div>
            </div>

            {/* Employee Information */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
              <div>
                <p className="text-[10px] uppercase font-semibold text-slate-400">Employee Name</p>
                <p className="font-bold text-slate-900 mt-0.5">{user?.fullName ?? 'Alugu varun'}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-semibold text-slate-400">Employee Code</p>
                <p className="font-mono font-bold text-slate-900 mt-0.5">{user?.employeeCode ?? 'EMP001'}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-semibold text-slate-400">Classification</p>
                <p className="font-medium text-slate-900 mt-0.5">Office Employee</p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-semibold text-slate-400">Mobile Credential</p>
                <p className="font-mono text-slate-900 mt-0.5">{user?.phoneNumber ?? '+917842427275'}</p>
              </div>
            </div>

            {/* Earnings Breakdown */}
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold text-[11px]">
                  <tr>
                    <th className="py-2.5 px-4 text-left">Description</th>
                    <th className="py-2.5 px-4 text-right">Computation Basis</th>
                    <th className="py-2.5 px-4 text-right">Amount (INR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  <tr>
                    <td className="py-2 px-4 text-slate-800">Approved Working Hours (DEC-01)</td>
                    <td className="py-2 px-4 text-right text-slate-600">
                      {payslipPreview.approvedWorkingHours} hrs @ {formatInr(payslipPreview.hourlyRate)}/hr
                    </td>
                    <td className="py-2 px-4 text-right font-semibold text-slate-900">
                      {formatInr(payslipPreview.grossEarned)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 px-4 text-slate-800">Unpaid Lunch Clipping (DEC-01)</td>
                    <td className="py-2 px-4 text-right text-slate-500">13:00–14:00 daily deducted</td>
                    <td className="py-2 px-4 text-right text-slate-500">₹0.00</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-4 text-slate-800">Statutory Deductions (TDS / ESI / PF)</td>
                    <td className="py-2 px-4 text-right text-slate-500">Standard Schedule</td>
                    <td className="py-2 px-4 text-right text-rose-600">
                      -{formatInr(payslipPreview.adjustments)}
                    </td>
                  </tr>
                  <tr className="bg-blue-50/50 font-bold border-t-2 border-slate-200">
                    <td className="py-3 px-4 text-slate-900 font-sans text-sm">Net Payable Disbursed</td>
                    <td className="py-3 px-4 text-right text-slate-500 font-sans text-xs">1.0x Regular Wage Rate</td>
                    <td className="py-3 px-4 text-right text-emerald-700 text-base">
                      {formatInr(payslipPreview.netSalary)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Footer Notice */}
            <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-[11px] text-slate-500">
              <p>Electronically generated and verified by KMACCS Administration.</p>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-xs cursor-pointer self-start sm:self-auto"
              >
                <Printer className="w-3.5 h-3.5" />
                Print Payslip
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
};
