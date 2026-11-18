import {
  BarChart3,
  Bell,
  Briefcase,
  CalendarClock,
  Camera,
  CheckSquare,
  CreditCard,
  LayoutDashboard,
  Navigation,
  Settings,
  ShieldCheck,
  User,
  Users,
  UsersRound,
} from 'lucide-react';
import type { JobCategory, Role } from '../types/role';

export type NavGroup = 'CORE' | 'WORKFORCE' | 'OPERATIONS' | 'GOVERNANCE' | 'SELF_SERVICE' | 'FIELD' | 'WORK_LIFE' | 'ACCOUNT';

export interface MenuItem {
  id: string;
  label: string;
  shortLabel?: string;
  href: string;
  icon: typeof LayoutDashboard;
  roles: Role[]; // Strictly ADMIN or EMPLOYEE
  jobCategories?: JobCategory[]; // Adapts EMPLOYEE menu by job classification; never a 3rd role
  group: NavGroup;
}

/**
 * Strictly separated ADMIN Console Navigation (/admin/*)
 */
export const ADMIN_NAVIGATION: MenuItem[] = [
  {
    id: 'admin-overview',
    label: 'Organization Overview',
    shortLabel: 'Overview',
    href: '/admin',
    icon: LayoutDashboard,
    roles: ['ADMIN'],
    group: 'CORE',
  },
  {
    id: 'admin-employees',
    label: 'Employee Management',
    shortLabel: 'Employees',
    href: '/admin/employees',
    icon: Users,
    roles: ['ADMIN'],
    group: 'WORKFORCE',
  },
  {
    id: 'admin-teams',
    label: 'Sales & Recovery Teams',
    shortLabel: 'Teams',
    href: '/admin/teams',
    icon: UsersRound,
    roles: ['ADMIN'],
    group: 'WORKFORCE',
  },
  {
    id: 'admin-attendance',
    label: 'Attendance & Approvals',
    shortLabel: 'Attend',
    href: '/admin/attendance',
    icon: Camera,
    roles: ['ADMIN'],
    group: 'OPERATIONS',
  },
  {
    id: 'admin-field-force',
    label: 'Field-Force Monitoring',
    shortLabel: 'Field',
    href: '/admin/field-force',
    icon: Navigation,
    roles: ['ADMIN'],
    group: 'OPERATIONS',
  },
  {
    id: 'admin-leave',
    label: 'Leave Approvals',
    shortLabel: 'Leave',
    href: '/admin/leave',
    icon: CalendarClock,
    roles: ['ADMIN'],
    group: 'OPERATIONS',
  },
  {
    id: 'admin-payroll',
    label: 'Payroll Management',
    shortLabel: 'Payroll',
    href: '/admin/payroll',
    icon: CreditCard,
    roles: ['ADMIN'],
    group: 'OPERATIONS',
  },
  {
    id: 'admin-reports',
    label: 'Reports & Exports',
    shortLabel: 'Reports',
    href: '/admin/reports',
    icon: BarChart3,
    roles: ['ADMIN'],
    group: 'GOVERNANCE',
  },
  {
    id: 'admin-settings',
    label: 'Settings, Geofence & Audit',
    shortLabel: 'Settings',
    href: '/admin/settings',
    icon: Settings,
    roles: ['ADMIN'],
    group: 'GOVERNANCE',
  },
  {
    id: 'admin-security',
    label: 'Security & Sessions',
    shortLabel: 'Security',
    href: '/admin/security',
    icon: ShieldCheck,
    roles: ['ADMIN'],
    group: 'GOVERNANCE',
  },
];

/**
 * Strictly separated EMPLOYEE Self-Service Navigation (/employee/*)
 */
export const EMPLOYEE_NAVIGATION: MenuItem[] = [
  {
    id: 'emp-dashboard',
    label: 'My Dashboard',
    shortLabel: 'Home',
    href: '/employee',
    icon: LayoutDashboard,
    roles: ['EMPLOYEE'],
    group: 'SELF_SERVICE',
  },
  {
    id: 'emp-attendance',
    label: 'My Attendance & Hours',
    shortLabel: 'Attend',
    href: '/employee/attendance',
    icon: Camera,
    roles: ['EMPLOYEE'],
    group: 'SELF_SERVICE',
  },
  {
    id: 'emp-field-duty',
    label: 'My Field Duty & Visits',
    shortLabel: 'Field',
    href: '/employee/field-duty',
    icon: Navigation,
    roles: ['EMPLOYEE'],
    jobCategories: ['SALES', 'RECOVERY'],
    group: 'FIELD',
  },
  {
    id: 'emp-leave',
    label: 'My Leaves',
    shortLabel: 'Leave',
    href: '/employee/leave',
    icon: CalendarClock,
    roles: ['EMPLOYEE'],
    group: 'WORK_LIFE',
  },
  {
    id: 'emp-payroll',
    label: 'My Payroll & Payslips',
    shortLabel: 'Payslips',
    href: '/employee/payroll',
    icon: CreditCard,
    roles: ['EMPLOYEE'],
    group: 'WORK_LIFE',
  },
  {
    id: 'emp-tasks',
    label: 'My Assigned Tasks',
    shortLabel: 'Tasks',
    href: '/employee/tasks',
    icon: CheckSquare,
    roles: ['EMPLOYEE'],
    group: 'WORK_LIFE',
  },
  {
    id: 'emp-notifications',
    label: 'Notifications & Requests',
    shortLabel: 'Alerts',
    href: '/employee/notifications',
    icon: Bell,
    roles: ['EMPLOYEE'],
    group: 'ACCOUNT',
  },
  {
    id: 'emp-profile',
    label: 'My Profile',
    shortLabel: 'Profile',
    href: '/employee/profile',
    icon: User,
    roles: ['EMPLOYEE'],
    group: 'ACCOUNT',
  },
  {
    id: 'emp-security',
    label: 'Active Sessions',
    shortLabel: 'Security',
    href: '/employee/security',
    icon: ShieldCheck,
    roles: ['EMPLOYEE'],
    group: 'ACCOUNT',
  },
];

export const navigation: MenuItem[] = [...ADMIN_NAVIGATION, ...EMPLOYEE_NAVIGATION];

export function getNavigationForUser(role: Role, jobCategory?: JobCategory): MenuItem[] {
  if (role === 'ADMIN') {
    return ADMIN_NAVIGATION;
  }
  return EMPLOYEE_NAVIGATION.filter((item) => {
    if (item.jobCategories && item.jobCategories.length > 0) {
      return jobCategory ? item.jobCategories.includes(jobCategory) : false;
    }
    return true;
  });
}

export const MODULE_ICON_MAP = {
  Briefcase,
};
