import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AdminLayout } from './layouts/AdminLayout';
import { EmployeeLayout } from './layouts/EmployeeLayout';
import { AdminLoginPage, LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { HomePage } from './pages/HomePage';

// Admin Governance Panel Pages (/admin/*)
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage';
import { AdminEmployeesPage } from './pages/admin/AdminEmployeesPage';
import { AdminTeamsPage } from './pages/admin/AdminTeamsPage';
import { AdminAttendancePage } from './pages/admin/AdminAttendancePage';
import { AdminFieldForcePage } from './pages/admin/AdminFieldForcePage';
import { AdminLeavePage } from './pages/admin/AdminLeavePage';
import { AdminPayrollPage } from './pages/admin/AdminPayrollPage';
import { AdminReportsPage } from './pages/admin/AdminReportsPage';
import { AdminSettingsAuditPage } from './pages/admin/AdminSettingsAuditPage';
import { AdminSecurityPage } from './pages/admin/AdminSecurityPage';

// Employee Self-Service Panel Pages (/employee/*)
import { EmployeeDashboardPage } from './pages/employee/EmployeeDashboardPage';
import { EmployeeAttendancePage } from './pages/employee/EmployeeAttendancePage';
import { EmployeeFieldDutyPage } from './pages/employee/EmployeeFieldDutyPage';
import { EmployeeLeavePage } from './pages/employee/EmployeeLeavePage';
import { EmployeePayrollPage } from './pages/employee/EmployeePayrollPage';
import { EmployeeTasksPage } from './pages/employee/EmployeeTasksPage';
import { EmployeeNotificationsPage } from './pages/employee/EmployeeNotificationsPage';
import { EmployeeProfilePage } from './pages/employee/EmployeeProfilePage';
import { EmployeeSecurityPage } from './pages/employee/EmployeeSecurityPage';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Separate Login Destinations (both use real backend /api/v1/auth/login broker) */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/auth/activate" element={<Navigate to="/login" replace />} />

          {/* Root role-based destination resolver */}
          <Route path="/" element={<HomePage />} />

          {/* ADMIN PANEL (/admin/*) — strictly restricted to backend-verified ADMIN role */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute requiredRoles={['ADMIN']}>
                <AdminLayout>
                  <AdminDashboardPage />
                </AdminLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/employees"
            element={
              <ProtectedRoute requiredRoles={['ADMIN']}>
                <AdminLayout>
                  <AdminEmployeesPage />
                </AdminLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/teams"
            element={
              <ProtectedRoute requiredRoles={['ADMIN']}>
                <AdminLayout>
                  <AdminTeamsPage />
                </AdminLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/attendance"
            element={
              <ProtectedRoute requiredRoles={['ADMIN']}>
                <AdminLayout>
                  <AdminAttendancePage />
                </AdminLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/field-force"
            element={
              <ProtectedRoute requiredRoles={['ADMIN']}>
                <AdminLayout>
                  <AdminFieldForcePage />
                </AdminLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/leave"
            element={
              <ProtectedRoute requiredRoles={['ADMIN']}>
                <AdminLayout>
                  <AdminLeavePage />
                </AdminLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/payroll"
            element={
              <ProtectedRoute requiredRoles={['ADMIN']}>
                <AdminLayout>
                  <AdminPayrollPage />
                </AdminLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/reports"
            element={
              <ProtectedRoute requiredRoles={['ADMIN']}>
                <AdminLayout>
                  <AdminReportsPage />
                </AdminLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/settings"
            element={
              <ProtectedRoute requiredRoles={['ADMIN']}>
                <AdminLayout>
                  <AdminSettingsAuditPage />
                </AdminLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/security"
            element={
              <ProtectedRoute requiredRoles={['ADMIN']}>
                <AdminLayout>
                  <AdminSecurityPage />
                </AdminLayout>
              </ProtectedRoute>
            }
          />

          {/* EMPLOYEE PANEL (/employee/*) — strictly restricted to backend-verified EMPLOYEE role */}
          <Route
            path="/employee"
            element={
              <ProtectedRoute requiredRoles={['EMPLOYEE']}>
                <EmployeeLayout>
                  <EmployeeDashboardPage />
                </EmployeeLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/employee/attendance"
            element={
              <ProtectedRoute requiredRoles={['EMPLOYEE']}>
                <EmployeeLayout>
                  <EmployeeAttendancePage />
                </EmployeeLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/employee/field-duty"
            element={
              <ProtectedRoute
                requiredRoles={['EMPLOYEE']}
                allowedJobCategories={['SALES', 'RECOVERY']}
              >
                <EmployeeLayout>
                  <EmployeeFieldDutyPage />
                </EmployeeLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/employee/leave"
            element={
              <ProtectedRoute requiredRoles={['EMPLOYEE']}>
                <EmployeeLayout>
                  <EmployeeLeavePage />
                </EmployeeLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/employee/payroll"
            element={
              <ProtectedRoute requiredRoles={['EMPLOYEE']}>
                <EmployeeLayout>
                  <EmployeePayrollPage />
                </EmployeeLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/employee/tasks"
            element={
              <ProtectedRoute requiredRoles={['EMPLOYEE']}>
                <EmployeeLayout>
                  <EmployeeTasksPage />
                </EmployeeLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/employee/notifications"
            element={
              <ProtectedRoute requiredRoles={['EMPLOYEE']}>
                <EmployeeLayout>
                  <EmployeeNotificationsPage />
                </EmployeeLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/employee/profile"
            element={
              <ProtectedRoute requiredRoles={['EMPLOYEE']}>
                <EmployeeLayout>
                  <EmployeeProfilePage />
                </EmployeeLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/employee/security"
            element={
              <ProtectedRoute requiredRoles={['EMPLOYEE']}>
                <EmployeeLayout>
                  <EmployeeSecurityPage />
                </EmployeeLayout>
              </ProtectedRoute>
            }
          />

          {/* Catch-all resolves safely through HomePage role check */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
