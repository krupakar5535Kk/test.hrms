import React, { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  CalendarClock,
  CheckSquare,
  Coins,
  Crosshair,
  LayoutGrid,
  Leaf,
  LogOut,
  MapPin,
  Menu,
  Navigation,
  ShieldCheck,
  User,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useApiResource } from '../hooks/useApiResource';
import { apiRequest } from '../lib/apiClient';
import type { SystemNotification } from '../types/hrms';
import { formatJobCategoryLabel, isFieldExceptionEligible } from '../types/role';
import { cn } from '../lib/cn';

interface EmployeeLayoutProps {
  children: React.ReactNode;
}

export const EmployeeLayout: React.FC<EmployeeLayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, health, logout, getInMemoryAccessToken } = useAuth();

  const jobCategory = user?.jobCategory ?? 'OFFICE';
  const fieldEligible = isFieldExceptionEligible(jobCategory);

  const notificationsRes = useApiResource<{ notifications: SystemNotification[] }>(
    '/api/v1/employee/notifications',
    { notifications: [] }
  );
  const notifications = notificationsRes.data.notifications ?? [];
  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Compute initials for avatar (e.g. "Alugu varun" -> "AV")
  const userInitials = useMemo(() => {
    if (!user?.fullName) return 'EM';
    const parts = user.fullName.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
  }, [user?.fullName]);

  // Unified employee navigation list matching reference design
  const navItems = useMemo(() => {
    const items = [
      {
        id: 'emp-dashboard',
        label: 'My Dashboard',
        href: '/employee',
        icon: LayoutGrid,
      },
      {
        id: 'emp-attendance',
        label: 'My Attendance & Hours',
        href: '/employee/attendance',
        icon: CalendarClock,
      },
    ];

    if (fieldEligible) {
      items.push({
        id: 'emp-field-duty',
        label: 'My Field Duty & Visits',
        href: '/employee/field-duty',
        icon: Navigation,
      });
    }

    items.push(
      {
        id: 'emp-leave',
        label: 'My Leaves',
        href: '/employee/leave',
        icon: Leaf,
      },
      {
        id: 'emp-payroll',
        label: 'My Payroll & Payslips',
        href: '/employee/payroll',
        icon: Coins,
      },
      {
        id: 'emp-tasks',
        label: 'My Assigned Tasks',
        href: '/employee/tasks',
        icon: CheckSquare,
      },
      {
        id: 'emp-notifications',
        label: 'Notifications & Requests',
        href: '/employee/notifications',
        icon: Bell,
      },
      {
        id: 'emp-profile',
        label: 'My Profile',
        href: '/employee/profile',
        icon: User,
      },
      {
        id: 'emp-security',
        label: 'Active Sessions',
        href: '/employee/security',
        icon: ShieldCheck,
      }
    );

    return items;
  }, [fieldEligible]);

  const mobileBottomItems = navItems.slice(0, 4);

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col lg:flex-row font-sans selection:bg-blue-600/15 selection:text-blue-700">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-xs lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Clean Enterprise Employee Self-Service Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-72 bg-white text-slate-800 flex flex-col border-r border-slate-200/80 transition-transform duration-200 ease-out lg:static lg:translate-x-0 shrink-0 shadow-xs',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Brand Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <Link to="/employee" className="flex items-center gap-3 min-w-0">
            <img
              src="/kmaccs-logo.png"
              alt="KMACCS Logo"
              className="w-10 h-10 rounded-full object-contain bg-white p-0.5 border border-slate-200/90 shadow-2xs shrink-0"
              width={40}
              height={40}
            />
            <div className="min-w-0">
              <span className="font-bold text-sm tracking-tight text-slate-900 block leading-tight">
                KMACCS Self-Service
              </span>
              <p className="text-[11px] text-slate-500 truncate mt-0.5 leading-tight">
                {user?.organizationName ?? 'KMACCS — Karthikeya Mutually Aid Cooperative Credit Society'}
              </p>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
            aria-label="Close navigation menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Employee Identity Card Matching Reference */}
        <div className="px-3.5 pt-3.5 pb-2">
          <div className="rounded-2xl bg-white border border-slate-200/90 p-3 shadow-2xs space-y-2.5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-100/90 border border-blue-200/70 text-blue-700 font-bold text-xs flex items-center justify-center shrink-0">
                {userInitials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-900 truncate">
                  {user?.fullName ?? 'Employee'}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="font-mono text-[10px] font-semibold text-slate-500">
                    {user?.employeeCode ?? 'EMP001'}
                  </span>
                  <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-1.5 py-0.2 rounded">
                    {formatJobCategoryLabel(jobCategory)}
                  </span>
                </div>
              </div>
            </div>

            {/* Sub-row: Office HQ | 50m GPS */}
            <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-100">
              <span className="flex items-center gap-1 font-medium text-slate-600">
                <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                Office HQ
              </span>
              <span className="text-slate-300">|</span>
              <span className="flex items-center gap-1 font-medium text-slate-600">
                <Crosshair className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                50m GPS
              </span>
            </div>
          </div>
        </div>

        {/* Navigation Menu List */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = location.pathname === item.href;
            return (
              <Link
                key={item.id}
                to={item.href}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all duration-150',
                  active
                    ? 'bg-blue-600 text-white font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                )}
              >
                <Icon
                  className={cn(
                    'w-4 h-4 shrink-0 transition-colors',
                    active ? 'text-white' : 'text-slate-500'
                  )}
                />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Bottom User Mini Profile & Sign Out Card */}
        <div className="p-3.5 border-t border-slate-100 space-y-3 bg-white">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-blue-100/90 border border-blue-200 text-blue-700 flex items-center justify-center font-bold text-xs shrink-0">
              {userInitials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-slate-900 truncate">
                {user?.fullName ?? 'Employee'}
              </p>
              <p className="text-[11px] font-mono text-slate-500 truncate mt-0.5">
                {user?.employeeCode ? `${user.employeeCode} · ` : ''}
                {user?.phoneNumber}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-slate-200 bg-white hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 text-xs font-semibold text-slate-700 transition-colors shadow-2xs cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 pb-16 lg:pb-0">
        {/* Top Header Bar */}
        <header className="sticky top-0 z-30 h-16 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              aria-label="Open employee navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <div className="bg-slate-100/80 border border-slate-200/80 rounded-xl px-3 py-1.5 flex items-center gap-2.5">
                <span className="flex items-center gap-1.5 font-bold text-[11px] text-blue-700 tracking-wider uppercase">
                  <Users className="w-3.5 h-3.5 text-blue-600" />
                  EMPLOYEE PORTAL
                </span>
                <span className="text-slate-300">|</span>
                <span className="text-xs font-semibold text-slate-800">
                  {formatJobCategoryLabel(jobCategory)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* API Connection Indicator */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-slate-200 shadow-2xs text-xs font-medium text-slate-700">
              <span
                className={cn(
                  'w-2 h-2 rounded-full',
                  health.reachable ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
                )}
              />
              <span>{health.reachable ? 'API Connected' : 'API Unreachable'}</span>
            </div>

            {/* Notifications Bell Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((o) => !o)}
                className="relative p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors cursor-pointer text-slate-700 shadow-2xs"
                aria-label="My notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden animate-fade-in">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <span className="text-xs font-bold text-slate-900">My Notifications</span>
                    <Link
                      to="/employee/notifications"
                      onClick={() => setNotifOpen(false)}
                      className="text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                    >
                      View all ({notifications.length})
                    </Link>
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                    {notifications.length === 0 ? (
                      <p className="text-xs text-slate-500 p-4 text-center">No notifications</p>
                    ) : (
                      notifications.slice(0, 5).map((n) => (
                        <Link
                          key={n.id}
                          to={n.linkTo}
                          onClick={() => {
                            setNotifOpen(false);
                            if (!n.read) {
                              void apiRequest(
                                `/api/v1/employee/notifications/${encodeURIComponent(n.id)}/read`,
                                getInMemoryAccessToken(),
                                { method: 'POST' }
                              ).then(() => notificationsRes.reload());
                            }
                          }}
                          className="block p-3.5 hover:bg-slate-50 transition-colors"
                        >
                          <p className="text-xs font-semibold text-slate-900">{n.title}</p>
                          <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">
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

        {/* Dashboard Content Container */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Quick Bar */}
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
                active ? 'text-blue-600' : 'text-slate-500 hover:text-slate-800'
              )}
            >
              <Icon className="w-4 h-4" />
              <span>{item.label.replace('My ', '')}</span>
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
