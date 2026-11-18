import { useAuth, type AuthenticatedSessionUser } from '../context/AuthContext';
import type { Role } from '../types/role';

export type CurrentUser = AuthenticatedSessionUser & {
  role: Role; // Strictly 'ADMIN' | 'EMPLOYEE'
};

export function useCurrentUser() {
  const { user, loading, error } = useAuth();
  return { user, loading, error };
}
