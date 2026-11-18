import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  Clock,
  AlertTriangle,
  ArrowRight,
  ShieldAlert,
  ScanFace,
  Layers,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useApiResource } from '../../hooks/useApiResource';
import { apiRequest } from '../../lib/apiClient';
import { StatusBanner } from '../../components/ui/StatusBanner';

interface EmployeeTaskItem {
  id: string;
  title: string;
  description?: string;
  dueDate?: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  category?: string;
}

type TaskFilter = 'ALL' | 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';

export const EmployeeTasksPage: React.FC = () => {
  const navigate = useNavigate();
  const { getInMemoryAccessToken } = useAuth();
  const { state, data, reload } = useApiResource<{ tasks: EmployeeTaskItem[] }>(
    '/api/v1/employee/tasks',
    { tasks: [] }
  );

  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionUnavailable, setActionUnavailable] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>('ALL');

  const updateTaskStatus = async (taskId: string, nextStatus: EmployeeTaskItem['status']) => {
    setActionError(null);
    setActionUnavailable(null);
    setBusyId(taskId);

    const res = await apiRequest<{ updated: boolean }>(
      `/api/v1/employee/tasks/${encodeURIComponent(taskId)}/status`,
      getInMemoryAccessToken(),
      { method: 'PATCH', body: { status: nextStatus } }
    );
    setBusyId(null);

    if (res.status === 'UNAVAILABLE') {
      setActionUnavailable(res.message || 'Task update endpoint is not yet implemented.');
      return;
    }
    if (res.status !== 'OK') {
      setActionError(res.message);
      return;
    }
    reload();
  };

  const pendingCount = data.tasks.filter((t) => t.status === 'PENDING').length;
  const inProgressCount = data.tasks.filter((t) => t.status === 'IN_PROGRESS').length;
  const completedCount = data.tasks.filter((t) => t.status === 'COMPLETED').length;

  const filteredTasks = useMemo(() => {
    if (filter === 'ALL') return data.tasks;
    return data.tasks.filter((t) => t.status === filter);
  }, [data.tasks, filter]);

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
            <span className="text-xs text-slate-500 font-medium">Action Items &amp; Compliance</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 mt-1.5">
            My Assigned Tasks
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Operational action items, assigned customer stops, and compliance requirements.
          </p>
        </div>
      </div>

      {state.status === 'unavailable' && (
        <StatusBanner tone="unavailable" title="Task Assignment API Pending" description={state.message} />
      )}
      {actionUnavailable && (
        <StatusBanner tone="unavailable" title="Task Update Pending Backend" description={actionUnavailable} />
      )}
      {actionError && <StatusBanner tone="error" title="Update Notice" description={actionError} />}

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1 */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-50/80 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
              <ClipboardList className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Total Assigned</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight font-mono">
              {data.tasks.length}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">All assigned tasks</p>
        </div>

        {/* KPI 2 */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-50/80 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Pending Action</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight font-mono">
              {pendingCount}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">Requires attention</p>
        </div>

        {/* KPI 3 */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-50/80 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">In Progress</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight font-mono">
              {inProgressCount}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">Currently active</p>
        </div>

        {/* KPI 4 */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-50/80 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Completed</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight font-mono">
              {completedCount}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">Successfully fulfilled</p>
        </div>
      </div>

      {/* Main Task List Card */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Assigned Work Items</h2>
              <p className="text-xs text-slate-500">
                {data.tasks.length} active or completed action items
              </p>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl self-start sm:self-auto text-xs">
            {(['ALL', 'PENDING', 'IN_PROGRESS', 'COMPLETED'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setFilter(st)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  filter === st
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st === 'ALL'
                  ? 'All'
                  : st === 'IN_PROGRESS'
                    ? 'In Progress'
                    : st.charAt(0) + st.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        <div>
          {state.status === 'loading' ? (
            <div className="py-12 text-center text-slate-400 text-xs">Loading assigned tasks...</div>
          ) : filteredTasks.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-center text-slate-400 mb-3">
                <ClipboardList className="w-8 h-8" />
              </div>
              <h4 className="font-bold text-slate-800 text-sm">No assigned tasks.</h4>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">
                Work items issued to you or pending security actions will list here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredTasks.map((task) => {
                const isPasswordTask = task.id === 'system-password-rotation';
                const isEnrollmentTask = task.id === 'system-face-enrollment';
                const isCheckoutTask = task.id.startsWith('attendance-checkout-');

                return (
                  <div
                    key={task.id}
                    className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1.5 flex-1 pr-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        {task.category && (
                          <span className="font-semibold text-[10px] px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                            {task.category}
                          </span>
                        )}
                        <span className="font-bold text-slate-900 text-sm">{task.title}</span>
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                            task.status === 'COMPLETED'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : task.status === 'IN_PROGRESS'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              task.status === 'COMPLETED'
                                ? 'bg-emerald-500'
                                : task.status === 'IN_PROGRESS'
                                  ? 'bg-blue-500'
                                  : 'bg-amber-500'
                            }`}
                          />
                          {task.status}
                        </span>
                      </div>
                      {task.description && (
                        <p className="text-xs text-slate-600 leading-relaxed">{task.description}</p>
                      )}
                      {task.dueDate && (
                        <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400">
                          <Clock className="w-3.5 h-3.5" />
                          <span>Due: {task.dueDate}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
                      {isPasswordTask && task.status !== 'COMPLETED' && (
                        <button
                          type="button"
                          onClick={() => navigate('/employee/security')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer"
                        >
                          <ShieldAlert className="w-3.5 h-3.5" />
                          Update Password
                        </button>
                      )}
                      {isEnrollmentTask && task.status !== 'COMPLETED' && (
                        <button
                          type="button"
                          onClick={() => navigate('/employee/profile')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer"
                        >
                          <ScanFace className="w-3.5 h-3.5" />
                          Enroll Face
                        </button>
                      )}
                      {isCheckoutTask && task.status !== 'COMPLETED' && (
                        <button
                          type="button"
                          onClick={() => navigate('/employee/attendance')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer"
                        >
                          <Clock className="w-3.5 h-3.5" />
                          Go to Attendance
                        </button>
                      )}
                      {!isPasswordTask && !isEnrollmentTask && !isCheckoutTask && (
                        <>
                          {task.status === 'PENDING' && (
                            <button
                              type="button"
                              disabled={busyId === task.id}
                              onClick={() => void updateTaskStatus(task.id, 'IN_PROGRESS')}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer"
                            >
                              <span>Start Task</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {task.status === 'IN_PROGRESS' && (
                            <button
                              type="button"
                              disabled={busyId === task.id}
                              onClick={() => void updateTaskStatus(task.id, 'COMPLETED')}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Complete</span>
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
