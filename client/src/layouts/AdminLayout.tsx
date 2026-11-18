import React, { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  LogOut,
  MapPin,
  Menu,
  ShieldCheck,
  UserCog,
  X,
} from 'lucide-react';
import { ADMIN_NAVIGATION, type MenuItem } from '../config/menus';
import { useAuth } from '../context/AuthContext';
import { useApiResource } from '../hooks/useApiResource';
import { apiRequest } from '../lib/apiClient';
import type { SystemNotification } from '../types/hrms';
import { HRMS_POLICY } from '../lib/domainRules';
import { cn } from '../lib/cn';

interface AdminLayoutProps {
  children: React.ReactNode;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, health, logout, getInMemoryAccessToken } = useAuth();

  const notificationsRes = useApiResource<{ notifications: SystemNotification[] }>(
    '/api/v1/notifications',
    { notifications: [] }
  );
  const notifications = notificationsRes.data.notifications ?? [];
  const unreadCount = notifications.filter((n) => !n.read).length;

  const groupedNav = useMemo(
    () => ({
      CORE: ADMIN_NAVIGATION.filter((n) => n.group === 'CORE'),
      WORKFORCE: ADMIN_NAVIGATION.filter((n) => n.group === 'WORKFORCE'),
      OPERATIONS: ADMIN_NAVIGATION.filter((n) => n.group === 'OPERATIONS'),
      GOVERNANCE: ADMIN_NAVIGATION.filter((n) => n.group === 'GOVERNANCE'),
    }),
    []
  );

  const mobileBottomItems: MenuItem[] = [
    ADMIN_NAVIGATION[0]!, // Dashboard
    ADMIN_NAVIGATION[1]!, // Employees
    ADMIN_NAVIGATION[3]!, // Attendance
    ADMIN_NAVIGATION[6]!, // Payroll
  ];

  const handleLogout = async () => {
    await logout();
    navigate('/admin/login');
  };

  return (
    <div className="min-h-screen bg-[#F4F6F9] flex flex-col lg:flex-row font-sans">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#0B1528]/80 backdrop-blur-xs lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Admin Dark Governance Command Rail */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-72 bg-[#0B1528] text-slate-100 flex flex-col border-r border-[#1E293B] transition-transform duration-200 ease-out lg:static lg:translate-x-0 shrink-0 select-none',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="px-5 py-4 border-b border-[#1E293B] flex items-center justify-between">
          <Link to="/admin" className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-white p-0.5 shadow-md shadow-black/30 flex items-center justify-center shrink-0">
              <img
                src="/kmaccs-logo.png"
                alt="KMACCS Logo"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-sm tracking-tight text-white">KMACCS Console</span>
                {user?.organizationCode && (
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#132240] text-emerald-300 border border-[#1E293B]">
                    {user.organizationCode}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-400 truncate mt-0.5">
                {user?.organizationName ?? 'KMACCS — Karthikeya Mutually Aided Cooperative Credit Society'}
              </p>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1.5 text-slate-400 hover:text-white hover:bg-[#132240] rounded-lg"
            aria-label="Close navigation menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Account Separation & Active Policy Summary */}
        <div className="px-3.5 pt-3.5 pb-2">
          <div className="rounded-xl bg-[#111C33] border border-[#1E293B] px-3 py-2.5 space-y-1.5 text-[11px]">
            <div className="flex items-center justify-between text-emerald-400 font-semibold">
              <span className="flex items-center gap-1.5">
                <UserCog className="w-3.5 h-3.5 text-emerald-400" />
                Separate Admin Account
              </span>
              <span className="font-mono text-[10px] text-slate-300">Not in 15 Emp</span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3 text-emerald-400" />
                Office Geofence
              </span>
              <span className="font-mono text-slate-200">
                {HRMS_POLICY.OFFICE_GEOFENCE_RADIUS_METERS}m · {HRMS_POLICY.MAX_GPS_ACCURACY_METERS}m GPS
              </span>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-4">
          {(
            [
              ['CORE', 'Command Overview'],
              ['WORKFORCE', 'Workforce & Field Teams'],
              ['OPERATIONS', 'Operations & Approvals'],
              ['GOVERNANCE', 'Governance & Security'],
            ] as const
          ).map(([groupKey, label]) => {
            const items = groupedNav[groupKey];
            if (items.length === 0) return null;
            return (
              <div key={groupKey} className="space-y-1">
                <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400/80">
                  {label}
                </p>
                {items.map((item) => {
                  const Icon = item.icon;
                  const active = location.pathname === item.href;
                  return (
                    <Link
                      key={item.id}
                      to={item.href}
                      onClick={() => setSidebarOpen(false)}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-xl text-xs transition-all duration-150',
                        active
                          ? 'bg-[#059669] text-white shadow-md shadow-emerald-950/40 font-semibold'
                          : 'text-slate-300 hover:text-white hover:bg-[#132240] font-medium'
                      )}
                    >
                      <Icon
                        className={cn(
                          'w-4 h-4 shrink-0',
                          active ? 'text-white' : 'text-slate-400'
                        )}
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="p-3.5 border-t border-[#1E293B] space-y-2.5 bg-[#080E1A]">
          <div className="flex items-center gap-2.5 min-w-0 px-1">
            <div className="w-8 h-8 rounded-full bg-[#059669]/20 border border-emerald-500/40 flex items-center justify-center font-bold text-xs text-emerald-300 shrink-0">
              {user?.fullName
                ? user.fullName
                    .split(' ')
                    .filter(Boolean)
                    .map((n) => n[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()
                : 'AK'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-white truncate">{user?.fullName ?? 'alugukrupakar'}</p>
              <p className="text-[10px] font-mono text-slate-400 truncate">
                ADMIN • {user?.phoneNumber ?? '+917816029162'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-[#111C33] hover:bg-rose-600 border border-[#1E293B] transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out of Admin Console
          </button>
        </div>
      </aside>

      {/* Main Content Container */}
      <div className="flex-1 flex flex-col min-w-0 pb-16 lg:pb-0">
        <header className="sticky top-0 z-30 h-16 bg-white/95 backdrop-blur-md border-b border-slate-200/90 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              aria-label="Open admin navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2.5 flex-wrap min-w-0">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200/80">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                ADMIN CONSOLE
              </span>
              <span className="hidden sm:inline-flex text-slate-300 text-xs">|</span>
              <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-slate-600 font-medium">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                Separate Governance Account
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200/80 text-xs font-medium text-emerald-700">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>{health.reachable ? 'API Connected' : 'API Unreachable'}</span>
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((o) => !o)}
                className="relative p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-colors shadow-2xs"
                aria-label="Admin notifications"
              >
                <Bell className="w-4 h-4 text-slate-700" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-card border border-border rounded-2xl shadow-elevated z-50 overflow-hidden animate-fade-in">
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <span className="text-xs font-bold">Admin Alerts</span>
                    <button
                      type="button"
                      onClick={() => setNotifOpen(false)}
                      className="text-[11px] text-primary hover:underline"
                    >
                      Close
                    </button>
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-border/60">
                    {notifications.length === 0 ? (
                      <p className="p-4 text-xs text-muted-foreground text-center">
                        No admin alerts or pending review notifications.
                      </p>
                    ) : (
                      notifications.map((n) => (
                        <Link
                          key={n.id}
                          to={n.linkTo}
                          onClick={() => {
                            setNotifOpen(false);
                            if (!n.read) {
                              void apiRequest(`/api/v1/notifications/${encodeURIComponent(n.id)}/read`, getInMemoryAccessToken(), {
                                method: 'POST',
                              }).then(() => notificationsRes.reload());
                            }
                          }}
                          className="block p-3.5 hover:bg-muted/50 transition-colors"
                        >
                          <p className="text-xs font-semibold text-foreground">{n.title}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                            {n.message}
                          </p>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">{children}</main>
      </div>

      {/* Mobile Bottom Nav */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 h-16 bg-white/95 backdrop-blur-md border-t border-slate-200 px-2 flex items-center justify-around shadow-lg">
        {mobileBottomItems.map((item) => {
          const Icon = item.icon;
          const active = location.pathname === item.href;
          return (
            <Link
              key={item.id}
              to={item.href}
              className={cn(
                'flex flex-col items-center justify-center gap-1 px-3 py-1 rounded-xl text-[10px] font-semibold transition-colors',
                active ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-800'
              )}
            >
              <Icon className="w-4 h-4" />
              <span>{item.shortLabel ?? item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="flex flex-col items-center justify-center gap-1 px-3 py-1 rounded-xl text-[10px] font-semibold text-slate-500 hover:text-slate-800"
        >
          <Menu className="w-4 h-4" />
          <span>More</span>
        </button>
      </nav>
    </div>
  );
};
