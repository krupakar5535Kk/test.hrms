import React, { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getPostAuthDestination } from '../lib/domainRules';
import type { JobCategory, Role } from '../types/role';
import { LoadingSpinner } from './common/LoadingSpinner';
import { Card, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { MandatoryPasswordChangeView } from './auth/MandatoryPasswordChangeView';

interface ProtectedRouteProps {
  requiredRoles: Role[];
  allowedJobCategories?: JobCategory[];
  fallback?: ReactNode;
  children?: ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  requiredRoles,
  allowedJobCategories,
  fallback,
  children,
}) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <LoadingSpinner size="lg" label="Verifying authentication context..." />
      </div>
    );
  }

  if (!user) {
    const loginPath = location.pathname.startsWith('/admin') ? '/admin/login' : '/login';
    return <Navigate to={loginPath} replace />;
  }

  if (!requiredRoles.includes(user.role)) {
    const safeHome = getPostAuthDestination(user.role);
    return (
      fallback ?? (
        <div className="min-h-[70vh] flex items-center justify-center p-6 bg-background">
          <Card className="max-w-md w-full border-rose-200">
            <CardContent className="p-6 text-center space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-lg font-bold text-foreground">Workspace Access Restricted (403)</h2>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {user.role === 'ADMIN'
                    ? 'The Admin account operates strictly inside the Admin Console and is separated from Employee self-service routes.'
                    : 'Employee accounts cannot access Admin governance, organization rosters, or approval queues.'}
                </p>
              </div>
              <Link to={safeHome} className="inline-block">
                <Button variant="primary" size="sm">
                  <ArrowLeft className="w-4 h-4" />
                  {user.role === 'ADMIN' ? 'Go to Admin Console' : 'Return to Employee Portal'}
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      )
    );
  }

  // GAP-01: Intercept Employee accounts requiring mandatory password change before accessing portal
  if (user.role === 'EMPLOYEE' && user.mustChangePassword) {
    return <MandatoryPasswordChangeView />;
  }

  if (
    user.role === 'EMPLOYEE' &&
    allowedJobCategories &&
    allowedJobCategories.length > 0 &&
    (!user.jobCategory || !allowedJobCategories.includes(user.jobCategory))
  ) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-6 bg-background">
        <Card className="max-w-md w-full border-amber-200">
          <CardContent className="p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-bold text-foreground">Field Workflow Not Assigned</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Field Duty &amp; Customer Visit modules are enabled strictly for Sales Representatives,
                Recovery Agents, and Field Officers. Your current classification follows standard 50m HQ
                geofence attendance.
              </p>
            </div>
            <Link to="/employee" className="inline-block">
              <Button variant="primary" size="sm">
                <ArrowLeft className="w-4 h-4" />
                Return to My Dashboard
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
};
