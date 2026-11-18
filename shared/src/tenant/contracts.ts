/**
 * Tenant and Organization Domain Contracts
 * Task 1.2: Organization & Tenant Foundation
 */

export interface CreateOrganizationInput {
  name: string;
  legalName: string;
  organizationCode: string;
  registrationNumber?: string;
  contactPhone: string;
  contactEmail: string;
  address: string;
  logoUrl?: string;
  selfieRetentionDays: number; // 1-30 days per DEC-14 (mandatory explicit configuration; zero unapproved default)
  isActive?: boolean;
}

export interface CreateUserInput {
  id: string; // Mandatory Supabase Auth user ID (DEC-09 1:1 mapping; zero independent default UUID generation)
  organizationId: string;
  phoneNumber: string;
  isActive?: boolean;
  mustChangePassword?: boolean;
}

export interface ResolvedOrganization {
  id: string;
  organizationCode: string;
  name: string;
  isActive: boolean;
}
