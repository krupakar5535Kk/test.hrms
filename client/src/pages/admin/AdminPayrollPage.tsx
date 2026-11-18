import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  Lock,
  Printer,
  FileCheck2,
  DollarSign,
} from 'lucide-react';
import type { PayrollLineItem } from '../../types/hrms';
import { formatInr } from '../../lib/domainRules';
import { useAuth } from '../../context/AuthContext';
import { useApiResource } from '../../hooks/useApiResource';
import { apiRequest } from '../../lib/apiClient';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { MetricCard } from '../../components/ui/MetricCard';
import { DataTable } from '../../components/ui/DataTable';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';

interface AdminPayrollPayload {
  items: PayrollLineItem[];
}

export const AdminPayrollPage: React.FC = () => {
  const { getInMemoryAccessToken } = useAuth();
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const { state, data, reload } = useApiResource<AdminPayrollPayload>(
    `/api/v1/admin/payroll?month=${encodeURIComponent(selectedMonth)}`,
    { items: [] }
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [payslipPreview, setPayslipPreview] = useState<PayrollLineItem | null>(null);
  const [adjustItem, setAdjustItem] = useState<PayrollLineItem | null>(null);
  const [adjType, setAdjType] = useState<'ADDITION' | 'DEDUCTION' | 'REVERSAL'>('ADDITION');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [payRefMap, setPayRefMap] = useState<Record<string, string>>({});
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionUnavailable, setActionUnavailable] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const items = data.items;
  const draftCount = useMemo(
    () => items.filter((p) => p.approvalStatus === 'DRAFT').length,
    [items]
  );
  const approvedCount = useMemo(
    () => items.filter((p) => p.approvalStatus === 'APPROVED').length,
    [items]
  );
  const totalNet = useMemo(
    () => items.reduce((sum, item) => sum + item.netSalary, 0),
    [items]
  );
  const paidCount = useMemo(
    () => items.filter((p) => p.paymentStatus === 'Paid').length,
    [items]
  );
  const pendingPaymentCount = useMemo(
    () => items.filter((p) => p.paymentStatus === 'Pending').length,
    [items]
  );

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.employeeName.toLowerCase().includes(q) ||
        item.employeeCode.toLowerCase().includes(q) ||
        item.department.toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  const runPayrollAction = async (
    endpoint: string,
    method: 'POST' | 'PATCH',
    body: Record<string, unknown>,
    successMsg: string
  ) => {
    setActionError(null);
    setActionUnavailable(null);
    setActionSuccess(null);
    setActionBusy(true);

    const res = await apiRequest<{ updated?: boolean }>(
      endpoint,
      getInMemoryAccessToken(),
      { method, body }
    );
    setActionBusy(false);

    if (res.status === 'UNAVAILABLE') {
      setActionUnavailable(res.message || 'Payroll processing API is not yet implemented on backend.');
      return;
    }
    if (res.status !== 'OK') {
      setActionError(res.message);
      return;
    }
    setActionSuccess(successMsg);
    reload();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/60">
              <CreditCard className="w-3 h-3 text-indigo-600" />
              Payroll Operations
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs font-mono font-medium text-slate-500">
              Period: {selectedMonth}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-1">
            Working-Hour Payroll Engine
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Deterministic hourly wage calculations based on approved working hours. Post-18:00 hours require Admin approval and are compensated at the standard 1.0x rate (no overtime multiplier). Admin account is strictly excluded.
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
            variant="primary"
            loading={actionBusy}
            onClick={() =>
              runPayrollAction(
                '/api/v1/admin/payroll/prepare',
                'POST',
                { month: selectedMonth },
                `Payroll batch prepared for ${selectedMonth}.`
              )
            }
          >
            Prepare Batch
          </Button>
          {draftCount > 0 && (
            <Button
              variant="success"
              size="sm"
              loading={actionBusy}
              onClick={() =>
                runPayrollAction(
                  '/api/v1/admin/payroll/approve',
                  'POST',
                  {
                    month: selectedMonth,
                    confirmFormulaMode: 'CALENDAR_DAYS_X_8H_PAID_LUNCH',
                    confirmPoFormulaApproval: true,
                  },
                  `Payroll batch approved & official payslips issued for ${selectedMonth}.`
                )
              }
            >
              <CheckCircle2 className="w-4 h-4 mr-1.5" />
              Final Admin Approve ({draftCount})
            </Button>
          )}
        </div>
      </div>

      {state.status === 'unavailable' && (
        <StatusBanner tone="unavailable" title="Payroll API Endpoint Pending" description={state.message} />
      )}
      {actionUnavailable && (
        <StatusBanner tone="unavailable" title="Payroll Action Unavailable" description={actionUnavailable} />
      )}
      {actionError && <StatusBanner tone="error" title="Payroll Error" description={actionError} />}
      {actionSuccess && <StatusBanner tone="success" title="Payroll Updated" description={actionSuccess} />}

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          label="Total Net Payable"
          value={formatInr(totalNet)}
          icon={DollarSign}
          tone="primary"
          subtitle={`Calculated gross minus deductions for ${selectedMonth}`}
        />
        <MetricCard
          label="Approval Status"
          value={`${approvedCount} Approved`}
          unit={`/ ${draftCount} Draft`}
          icon={FileCheck2}
          tone="success"
          subtitle="Admin sign-off unlocks employee payslips"
        />
        <MetricCard
          label="Disbursement Status"
          value={`${paidCount} Settled`}
          unit={`/ ${pendingPaymentCount} Pending`}
          icon={CreditCard}
          tone="info"
          subtitle="UTR / bank reference tracking"
        />
      </div>

      {/* Payroll Ledger Table */}
      <DataTable
        title="Employee Payroll Ledger"
        description="Line-item working-hour earnings, adjustments, and payment settlement records. ADMIN account is strictly excluded."
        searchPlaceholder="Search employee name, code, dept..."
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        totalCount={items.length}
        filteredCount={filteredItems.length}
        isLoading={state.status === 'loading'}
        error={state.status === 'error' ? state.message : null}
        onRetry={reload}
        emptyTitle="No payroll processed"
        emptyDescription={`No payroll line items exist for ${selectedMonth} yet. Click 'Prepare Batch' to generate line items.`}
        onClearFilters={searchQuery ? () => setSearchQuery('') : undefined}
      >
        <table className="w-full text-xs text-left">
          <thead className="bg-slate-50/90 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200 font-semibold">
            <tr>
              <th className="py-3 px-4">Employee</th>
              <th className="py-3 px-4 text-right">Monthly Ref</th>
              <th className="py-3 px-4 text-right">Hourly Rate</th>
              <th className="py-3 px-4 text-right">Worked Hrs</th>
              <th className="py-3 px-4 text-right">Unpaid Leave</th>
              <th className="py-3 px-4 text-right">Net Payable</th>
              <th className="py-3 px-4 text-center">Approval</th>
              <th className="py-3 px-4">Payment &amp; UTR</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredItems.map((item) => (
              <tr key={item.employeeId} className="hover:bg-slate-50/70 transition-colors">
                <td className="py-3 px-4">
                  <div className="font-semibold text-slate-900">{item.employeeName}</div>
                  <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                    <span className="text-indigo-600 font-semibold">{item.employeeCode}</span> • {item.department}
                  </div>
                </td>
                <td className="py-3 px-4 font-mono tabular-nums text-right text-slate-700">
                  {formatInr(item.monthlySalaryReference)}
                </td>
                <td className="py-3 px-4 font-mono tabular-nums text-right text-slate-700">
                  {formatInr(item.hourlyRate)}/hr
                </td>
                <td className="py-3 px-4 font-mono tabular-nums text-right font-semibold text-slate-900">
                  {item.approvedWorkingHours}h
                </td>
                <td className="py-3 px-4 font-mono tabular-nums text-right text-slate-500">
                  {item.unpaidLeaveDays > 0 ? `${item.unpaidLeaveDays}d` : '--'}
                </td>
                <td className="py-3 px-4 font-mono tabular-nums text-right">
                  <span className="font-bold text-slate-900 text-sm">{formatInr(item.netSalary)}</span>
                </td>
                <td className="py-3 px-4 text-center">
                  <Badge
                    variant={item.approvalStatus === 'APPROVED' ? 'success' : 'warning'}
                    className="text-[10px]"
                  >
                    {item.approvalStatus}
                  </Badge>
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-1.5">
                    <Select
                      selectSize="sm"
                      value={item.paymentStatus}
                      disabled={actionBusy}
                      onChange={(e) =>
                        runPayrollAction(
                          `/api/v1/admin/payroll/${encodeURIComponent(item.employeeId)}/payment-status`,
                          'PATCH',
                          {
                            month: selectedMonth,
                            paymentStatus: e.target.value,
                            paymentReference: payRefMap[item.employeeId]?.trim() || undefined,
                          },
                          `Payment status updated for ${item.employeeName}.`
                        )
                      }
                      className="w-24 text-[11px]"
                    >
                      <option value="Paid">Paid</option>
                      <option value="Pending">Pending</option>
                      <option value="Failed">Failed</option>
                    </Select>
                    <Input
                      inputSize="sm"
                      placeholder="UTR / Ref"
                      value={payRefMap[item.employeeId] ?? item.paymentReference ?? ''}
                      onChange={(e) =>
                        setPayRefMap((prev) => ({ ...prev, [item.employeeId]: e.target.value }))
                      }
                      className="w-28 text-[11px] font-mono tabular-nums"
                    />
                  </div>
                </td>
                <td className="py-3 px-4 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {item.approvalStatus === 'DRAFT' && item.itemId && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setAdjustItem(item);
                          setAdjAmount('');
                          setAdjReason('');
                        }}
                        className="h-7 text-xs px-2"
                      >
                        Adjust
                      </Button>
                    )}
                    {item.approvalStatus === 'APPROVED' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPayslipPreview(item)}
                        className="h-7 text-xs px-2"
                      >
                        <Printer className="w-3.5 h-3.5 mr-1" />
                        Payslip
                      </Button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 font-medium">
                        <Lock className="w-3 h-3" />
                        Locked
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTable>

      {/* Adjustments Dialog */}
      <Dialog
        open={Boolean(adjustItem)}
        onClose={() => setAdjustItem(null)}
        title={adjustItem ? `Payroll Adjustment — ${adjustItem.employeeName}` : ''}
        description="Record an addition, deduction, or advance recovery entry prior to final approval."
      >
        {adjustItem && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await runPayrollAction(
                '/api/v1/admin/payroll/adjustments',
                'POST',
                {
                  payrollItemId: adjustItem.itemId,
                  adjustmentType: adjType,
                  amountInr: Number(adjAmount),
                  reason: adjReason.trim(),
                },
                `Adjustment recorded for ${adjustItem.employeeName}.`
              );
              setAdjustItem(null);
            }}
            className="space-y-4 text-xs"
          >
            <div className="grid grid-cols-2 gap-3.5">
              <FormField label="Adjustment Type" required>
                <Select
                  selectSize="md"
                  value={adjType}
                  onChange={(e) => setAdjType(e.target.value as typeof adjType)}
                >
                  <option value="ADDITION">Addition (+)</option>
                  <option value="DEDUCTION">Deduction (-)</option>
                  <option value="REVERSAL">Reversal (-)</option>
                </Select>
              </FormField>

              <FormField label="Amount (INR)" required>
                <Input
                  inputSize="md"
                  type="number"
                  min="1"
                  required
                  value={adjAmount}
                  onChange={(e) => setAdjAmount(e.target.value)}
                  placeholder="e.g. 1500"
                  className="font-mono tabular-nums"
                />
              </FormField>
            </div>

            <FormField label="Mandatory Audit Reason (min 5 characters)" required>
              <Input
                inputSize="md"
                type="text"
                minLength={5}
                required
                value={adjReason}
                onChange={(e) => setAdjReason(e.target.value)}
                placeholder="e.g. Punctuality bonus or travel reimbursement"
              />
            </FormField>

            <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-200">
              <Button type="button" variant="outline" onClick={() => setAdjustItem(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={actionBusy}>
                Save Adjustment
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      {/* Official Payslip Dialog */}
      <Dialog
        open={Boolean(payslipPreview)}
        onClose={() => setPayslipPreview(null)}
        title={`Official Payslip — ${payslipPreview?.employeeName ?? ''}`}
        description={`Issued for ${selectedMonth} under executive sign-off.`}
      >
        {payslipPreview && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200">
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Employee</p>
                <p className="font-bold text-slate-900 mt-0.5">
                  {payslipPreview.employeeName}
                </p>
                <p className="font-mono text-[10px] text-slate-500">{payslipPreview.employeeCode}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Department</p>
                <p className="font-semibold text-slate-900 mt-0.5">{payslipPreview.department}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Approved By</p>
                <p className="font-mono text-slate-900 mt-0.5">{payslipPreview.approvedBy ?? 'Admin'}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Payment Status</p>
                <p className="font-bold text-emerald-700 mt-0.5">{payslipPreview.paymentStatus}</p>
              </div>
            </div>

            <div className="space-y-2 border border-slate-200 rounded-xl p-4 bg-white shadow-2xs">
              <div className="flex justify-between py-1 text-slate-600">
                <span>Monthly Reference Salary ({payslipPreview.calendarDaysInMonth} days)</span>
                <span className="font-mono tabular-nums font-medium text-slate-900">
                  {formatInr(payslipPreview.monthlySalaryReference)}
                </span>
              </div>
              <div className="flex justify-between py-1 text-slate-600 border-t border-slate-100">
                <span>Derived Hourly Rate</span>
                <span className="font-mono tabular-nums font-medium text-slate-900">
                  {formatInr(payslipPreview.hourlyRate)}/hr
                </span>
              </div>
              <div className="flex justify-between py-1 text-slate-600 border-t border-slate-100">
                <span>Approved Working Hours</span>
                <span className="font-mono tabular-nums font-semibold text-slate-900">
                  {payslipPreview.approvedWorkingHours} hrs
                </span>
              </div>
              <div className="flex justify-between py-1 text-slate-600 border-t border-slate-100">
                <span>Adjustments / Advance Recovery</span>
                <span className="font-mono tabular-nums font-medium text-slate-900">
                  {formatInr(payslipPreview.adjustments)}
                </span>
              </div>
              <div className="flex justify-between pt-3 border-t-2 border-slate-200 font-bold text-sm text-indigo-900">
                <span>Net Salary Payable</span>
                <span className="font-mono tabular-nums text-base text-indigo-700">
                  {formatInr(payslipPreview.netSalary)}
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <Button variant="outline" onClick={() => setPayslipPreview(null)}>
                Close
              </Button>
              <Button onClick={() => window.print()}>
                <Printer className="w-3.5 h-3.5 mr-1" />
                Print / Save PDF
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
};
