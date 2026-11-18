import { UserRole } from '../types/index.js';

/**
 * DEC-13 Approved Login Request Contract
 * Organization Code (optional in single-tenant Employee UX, explicit in Admin/multi-org) + Phone Number + Password
 */
export interface LoginRequest {
  fullName?: string;
  organizationCode?: string;
  phoneNumber: string;
  password: string;
}

/**
 * Alternative snake_case contract accepted by API parser
 */
export interface LoginSnakeCaseRequest {
  full_name?: string;
  organization_code?: string;
  phone_number: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds (e.g. 900 for 15m)
  tokenType: 'Bearer';
}

export interface AuthOrganization {
  id: string;
  code: string;
  name: string;
}

export interface AuthEmployee {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  officeId: string;
}

export interface AuthUser {
  id: string;
  phoneNumber: string;
  roles: UserRole[];
  mustChangePassword: boolean;
  fullName?: string;
}

export interface LoginResponseData {
  tokens: AuthTokens;
  organization: AuthOrganization;
  user: AuthUser;
  employee?: AuthEmployee;
}

export interface FirstLoginChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}
