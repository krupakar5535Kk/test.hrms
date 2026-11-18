import React, { useMemo, useState } from 'react';
import {
  Bell,
  CheckCheck,
  Clock,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Info,
} from 'lucide-react';
import type { SystemNotification } from '../../types/hrms';
import { useAuth } from '../../context/AuthContext';
import { useApiResource } from '../../hooks/useApiResource';
import { apiRequest } from '../../lib/apiClient';
import { StatusBanner } from '../../components/ui/StatusBanner';

type NotificationFilter = 'ALL' | 'UNREAD' | 'READ';

export const EmployeeNotificationsPage: React.FC = () => {
  const { getInMemoryAccessToken } = useAuth();
  const { state, data, reload } = useApiResource<{ notifications: SystemNotification[] }>(
    '/api/v1/employee/notifications',
    { notifications: [] }
  );

  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<NotificationFilter>('ALL');

  const markRead = async (id: string) => {
    setActionMsg(null);
    setBusyId(id);
    const res = await apiRequest<{ updated: boolean }>(
      `/api/v1/employee/notifications/${encodeURIComponent(id)}/read`,
      getInMemoryAccessToken(),
      { method: 'POST' }
    );
    setBusyId(null);
    if (res.status !== 'OK') {
      setActionMsg(res.message);
      return;
    }
    reload();
  };

  const markAllRead = async () => {
    const unread = data.notifications.filter((n) => !n.read);
    if (unread.length === 0) return;
    setActionMsg(null);
    setBusyId('all');

    for (const item of unread) {
      await apiRequest(
        `/api/v1/employee/notifications/${encodeURIComponent(item.id)}/read`,
        getInMemoryAccessToken(),
        { method: 'POST' }
      );
    }
    setBusyId(null);
    reload();
  };

  const unreadCount = data.notifications.filter((n) => !n.read).length;
  const criticalCount = data.notifications.filter((n) => n.severity === 'critical').length;
  const readCount = data.notifications.filter((n) => n.read).length;

  const filteredNotifications = useMemo(() => {
    if (filter === 'UNREAD') return data.notifications.filter((n) => !n.read);
    if (filter === 'READ') return data.notifications.filter((n) => n.read);
    return data.notifications;
  }, [data.notifications, filter]);

  const getSeverityBadge = (severity?: SystemNotification['severity']) => {
    switch (severity) {
      case 'critical':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            CRITICAL
          </span>
        );
      case 'warning':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            ALERT
          </span>
        );
      case 'success':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            CONFIRMED
          </span>
        );
      case 'info':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            INFO
          </span>
        );
    }
  };

  const getSeverityIcon = (severity?: SystemNotification['severity']) => {
    switch (severity) {
      case 'critical':
        return <AlertCircle className="w-4 h-4 text-rose-600" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-amber-600" />;
      case 'success':
        return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
      case 'info':
      default:
        return <Info className="w-4 h-4 text-blue-600" />;
    }
  };

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
            <span className="text-xs text-slate-500 font-medium">Real-Time Alerts</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 mt-1.5">
            Personal Notifications
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Attendance exception decisions, leave filing outcomes, and official payslip releases.
          </p>
        </div>

        {unreadCount > 0 && (
          <button
            type="button"
            disabled={busyId === 'all'}
            onClick={() => void markAllRead()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 shadow-2xs transition-colors cursor-pointer self-start sm:self-auto"
          >
            <CheckCheck className="w-4 h-4 text-blue-600" />
            Mark All as Read ({unreadCount})
          </button>
        )}
      </div>

      {state.status === 'unavailable' && (
        <StatusBanner tone="unavailable" title="Notifications API Pending" description={state.message} />
      )}
      {actionMsg && <StatusBanner tone="error" title="Action Notice" description={actionMsg} />}

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1 */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-50/80 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
              <Bell className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Total Alerts</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight font-mono">
              {data.notifications.length}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">Received messages</p>
        </div>

        {/* KPI 2 */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-50/80 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Unread Alerts</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight font-mono">
              {unreadCount}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">Awaiting acknowledgement</p>
        </div>

        {/* KPI 3 */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-rose-50/80 border border-rose-100 flex items-center justify-center text-rose-600 shrink-0">
              <AlertCircle className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Critical Notices</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight font-mono">
              {criticalCount}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">High priority matters</p>
        </div>

        {/* KPI 4 */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-50/80 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
              <CheckCheck className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Acknowledged</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight font-mono">
              {readCount}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">Processed notifications</p>
        </div>
      </div>

      {/* Main Notifications Inbox Card */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Notification Inbox</h2>
              <p className="text-xs text-slate-500">
                {data.notifications.length} total event notification(s)
              </p>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl self-start sm:self-auto text-xs">
            {(['ALL', 'UNREAD', 'READ'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  filter === tab
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab === 'ALL' ? 'All' : tab === 'UNREAD' ? 'Unread' : 'Read'}
              </button>
            ))}
          </div>
        </div>

        <div>
          {state.status === 'loading' ? (
            <div className="py-12 text-center text-slate-400 text-xs">Loading notifications...</div>
          ) : filteredNotifications.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-center text-slate-400 mb-3">
                <Bell className="w-8 h-8" />
              </div>
              <h4 className="font-bold text-slate-800 text-sm">No notifications.</h4>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">
                Attendance review decisions, leave outcomes, and review comments will appear here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredNotifications.map((n) => (
                <div
                  key={n.id}
                  className={`py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs transition-colors rounded-xl px-2 ${
                    !n.read ? 'bg-blue-50/30' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-xl bg-slate-50 border border-slate-200 shrink-0 mt-0.5">
                      {getSeverityIcon(n.severity)}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 text-sm">{n.title}</span>
                        {getSeverityBadge(n.severity)}
                        {!n.read && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">
                            NEW
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">{n.message}</p>
                      <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{n.timestamp}</span>
                      </div>
                    </div>
                  </div>

                  {!n.read && (
                    <button
                      type="button"
                      disabled={busyId === n.id}
                      onClick={() => void markRead(n.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 shadow-2xs transition-colors cursor-pointer self-start sm:self-center shrink-0"
                    >
                      <CheckCheck className="w-3.5 h-3.5 text-blue-600" />
                      Mark Read
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
