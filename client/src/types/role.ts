/**
 * STRICT APPLICATION ROLE POLICY (Part 2 & Part 22 of Master Instruction):
 * Exactly TWO application roles exist across the entire application:
 *   1. ADMIN
 *   2. EMPLOYEE
 * No Super Admin. No third application role.
 */
export type Role = 'ADMIN' | 'EMPLOYEE';

/**
 * Employee job categories adapt the EMPLOYEE experience without creating
 * additional application roles.
 */
export type JobCategory =
  | 'OFFICE'
  | 'HR'
  | 'FINANCE'
  | 'SALES'
  | 'RECOVERY';

export const APPLICATION_ROLES: readonly Role[] = ['ADMIN', 'EMPLOYEE'] as const;

export function normalizeFrontendRole(rawRole: unknown): Role {
  if (typeof rawRole !== 'string') {
    return 'EMPLOYEE';
  }
  const normalized = rawRole.trim().toUpperCase();
  // Preserve strict 2-role surface even if legacy seed claims carry a deprecated label
  if (normalized === 'ADMIN' || normalized === 'SUPER_ADMIN') {
    return 'ADMIN';
  }
  return 'EMPLOYEE';
}

export function isFieldExceptionEligible(jobCategory?: JobCategory): boolean {
  return jobCategory === 'SALES' || jobCategory === 'RECOVERY';
}

export function isFieldOperationalCategory(jobCategory?: JobCategory): boolean {
  return jobCategory === 'SALES' || jobCategory === 'RECOVERY';
}

export function formatJobCategoryLabel(jobCategory: JobCategory): string {
  switch (jobCategory) {
    case 'OFFICE':
      return 'Office Employee';
    case 'HR':
      return 'HR Operations';
    case 'FINANCE':
      return 'Finance & Accounts';
    case 'SALES':
      return 'Sales Representative';
    case 'RECOVERY':
      return 'Recovery Agent';
  }
}
