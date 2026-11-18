import React from 'react';
import { useAuth } from '../context/AuthContext';
import { AdminLayout, EmployeeLayout } from './RoleLayouts';

export const RoleBasedLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading || !user) {
    return null;
  }

  // Strictly two application roles: ADMIN and EMPLOYEE
  if (user.role === 'ADMIN') {
    return <AdminLayout>{children}</AdminLayout>;
  }

  return <EmployeeLayout>{children}</EmployeeLayout>;
};
