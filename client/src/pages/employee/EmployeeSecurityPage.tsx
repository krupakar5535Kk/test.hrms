import React, { useState } from 'react';
import {
  KeyRound,
  LogOut,
  MonitorSmartphone,
  ShieldCheck,
  Smartphone,
  Laptop,
  Lock,
} from 'lucide-react';
import type { DeviceSessionRecord } from '../../types/hrms';
import { useAuth } from '../../context/AuthContext';
import { useApiResource } from '../../hooks/useApiResource';
import { apiRequest } from '../../lib/apiClient';
import { StatusBanner } from '../../components/ui/StatusBanner';

export const EmployeeSecurityPage: React.FC = () => {
  const { user, logout, getInMemoryAccessToken } = useAuth();
  const { state, data, reload } = useApiResource<{ sessions: DeviceSessionRecord[] }>(
    '/api/v1/auth/sessions',
    { sessions: [] }
  );

  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);

  const handleRevoke = async (sessionId: string) => {
    setActionMsg(null);
    setRevokingId(sessionId);
    const res = await apiRequest<{ revoked: boolean }>(
      `/api/v1/auth/sessions/${encodeURIComponent(sessionId)}/revoke`,
      getInMemoryAccessToken(),
      { method: 'POST' }
    );
    setRevokingId(null);
    if (res.status !== 'OK') {
      setActionMsg(res.message);
      return;
    }
    reload();
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(null);

    if (!currentPassword || newPassword.length < 8) {
      setPwError('Current password and a new password (min 8 characters) are required.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('New password and confirmation do not match.');
      return;
    }

    setPwBusy(true);
    const res = await apiRequest<{ message?: string }>(
      '/api/v1/auth/change-password',
      getInMemoryAccessToken(),
      {
        method: 'POST',
        body: { currentPassword, newPassword },
      }
    );
    setPwBusy(false);

    if (res.status !== 'OK') {
      setPwError(res.message);
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPwSuccess(res.data.message || 'Your password has been updated. Other sessions have been revoked.');
    reload();
  };

  const currentSession = data.sessions.find((s) => s.isCurrent);
  const remoteSessions = data.sessions.filter((s) => !s.isCurrent);

  const getPlatformIcon = (nameOrPlatform?: string) => {
    const lower = (nameOrPlatform || '').toLowerCase();
    if (lower.includes('mobile') || lower.includes('android') || lower.includes('ios') || lower.includes('iphone')) {
      return <Smartphone className="w-4 h-4 text-blue-600" />;
    }
    return <Laptop className="w-4 h-4 text-blue-600" />;
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
            <span className="text-xs text-slate-500 font-medium">PO-05 &amp; PO-07: Access Control</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 mt-1.5">
            Security &amp; Device Sessions
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Signed in as {user?.fullName ?? 'Alugu varun'} ({user?.employeeCode ?? 'EMP001'} •{' '}
            {user?.phoneNumber ?? '+917842427275'}).
          </p>
        </div>

        <button
          type="button"
          onClick={() => void logout()}
          className="inline-flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-xs transition-colors cursor-pointer self-start sm:self-auto"
        >
          <LogOut className="w-4 h-4" />
          Sign Out This Device
        </button>
      </div>

      {state.status === 'unavailable' && (
        <StatusBanner tone="unavailable" title="Session History API Pending" description={state.message} />
      )}
      {actionMsg && <StatusBanner tone="error" title="Session Notice" description={actionMsg} />}

      {/* Security Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1 */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-50/80 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
              <MonitorSmartphone className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Active Sessions</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight font-mono">
              {data.sessions.length || 1}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">Registered authentications</p>
        </div>

        {/* KPI 2 */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 shrink-0">
              <Laptop className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Current Device</span>
          </div>
          <div className="my-2.5">
            <p className="text-xs font-bold text-slate-900 truncate" title={currentSession?.deviceName}>
              {currentSession?.deviceName ? currentSession.deviceName.slice(0, 32) : 'Current Browser'}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium font-mono">
            IP: {currentSession?.ipSummary ?? currentSession?.ipAddressMasked ?? '::1'}
          </p>
        </div>

        {/* KPI 3 */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-50/80 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Token Storage</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight">In-Memory</p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">Zero web storage (PO-05)</p>
        </div>

        {/* KPI 4 */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-50/80 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
              <Lock className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Remote Revocation</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight font-mono">
              {remoteSessions.length > 0 ? `${remoteSessions.length} Remote` : '0 Remote'}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">Single-click invalidation</p>
        </div>
      </div>

      {/* Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Authorized Device Sessions */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
            <div className="flex items-center gap-3 pb-4 mb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                <MonitorSmartphone className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Authorized Device Sessions ({data.sessions.length})
                </h2>
                <p className="text-xs text-slate-500">
                  Active device sessions bound to your employee account.
                </p>
              </div>
            </div>

            <div>
              {state.status === 'loading' ? (
                <div className="py-12 text-center text-slate-400 text-xs">Loading active sessions...</div>
              ) : data.sessions.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-500">
                  Current active session verified. No remote devices connected.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {data.sessions.map((s) => (
                    <div
                      key={s.id}
                      className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-start gap-3">
                        <div className="p-2 rounded-xl bg-slate-50 border border-slate-200 shrink-0 mt-0.5">
                          {getPlatformIcon(s.platform || s.deviceName)}
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-slate-900 text-xs sm:text-sm line-clamp-1">
                              {s.deviceName}
                            </span>
                            {s.isCurrent ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                Current Device
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                                Remote Device
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 font-mono text-[11px] text-slate-400 flex-wrap">
                            <span>{s.platform || 'Browser'}</span>
                            <span>•</span>
                            <span>IP: {s.ipSummary || s.ipAddressMasked || '::1'}</span>
                            <span>•</span>
                            <span>Last Active: {s.lastActiveAt}</span>
                          </div>
                        </div>
                      </div>

                      {!s.isCurrent && (
                        <button
                          type="button"
                          disabled={revokingId === s.id}
                          onClick={() => handleRevoke(s.id)}
                          className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold shadow-2xs transition-colors cursor-pointer self-start sm:self-center shrink-0"
                        >
                          {revokingId === s.id ? 'Revoking...' : 'Revoke Access'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Architectural Security Guarantee Notice Banner */}
          <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/70 p-4 text-xs text-emerald-950 shadow-xs flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold text-emerald-950">
                Architectural Security Guarantee (PO-05 &amp; PO-07)
              </p>
              <p className="leading-relaxed text-emerald-900/90 text-xs">
                Access tokens reside strictly in JavaScript memory (&apos;useRef&apos;), never written to localStorage, sessionStorage, or client-side storage. Revoking a remote device terminates its refresh token immediately, blocking subsequent access attempts.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: Change Password Card */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
          <div className="flex items-center gap-3 pb-4 mb-4 border-b border-slate-100">
            <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Change Password</h2>
              <p className="text-xs text-slate-500">
                Invalidates all other active sessions upon update.
              </p>
            </div>
          </div>

          <form onSubmit={handleChangePassword} className="space-y-4 text-xs">
            {pwError && <StatusBanner tone="error" title="Password Update Failed" description={pwError} />}
            {pwSuccess && <StatusBanner tone="success" title="Password Updated" description={pwSuccess} />}

            <div>
              <label htmlFor="currentPassword" className="block text-[11px] font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Current Password *
              </label>
              <input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-xs text-slate-900 focus:outline-hidden focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>

            <div>
              <label htmlFor="newPassword" className="block text-[11px] font-semibold text-slate-700 uppercase tracking-wider mb-1">
                New Password *
              </label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-xs text-slate-900 focus:outline-hidden focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
              />
              <p className="text-[11px] text-slate-400 mt-1">Minimum 8 characters with letters and numbers</p>
            </div>

            <div>
              <label htmlFor="confirmNewPassword" className="block text-[11px] font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Confirm New Password *
              </label>
              <input
                id="confirmNewPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-xs text-slate-900 focus:outline-hidden focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
              />
              {confirmPassword && newPassword !== confirmPassword && (
                <p className="text-[11px] text-rose-600 font-medium mt-1">Passwords do not match</p>
              )}
            </div>

            <button
              type="submit"
              disabled={pwBusy || !currentPassword || newPassword.length < 8 || newPassword !== confirmPassword}
              className="w-full h-11 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs sm:text-sm rounded-xl shadow-xs transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              <Lock className="w-4 h-4" />
              {pwBusy ? 'Updating Password...' : 'Update Password & Revoke Other Devices'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
