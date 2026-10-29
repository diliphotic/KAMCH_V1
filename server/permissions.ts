/**
 * KAMCH ERP — Centralized Role & Permission Definitions (Backend Authority)
 */

export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  PRINCIPAL: 'PRINCIPAL',
  SECRETARY: 'SECRETARY',
  OFFICE: 'OFFICE',
  STAFF: 'STAFF', // Legacy alias mapped to Office permissions for existing records
  LIBRARY: 'LIBRARY',
  DEPARTMENT: 'DEPARTMENT',
  HOD: 'HOD', // Legacy alias mapped to Department permissions if department_id exists
  FACULTY: 'FACULTY', // Individual teacher/faculty account role (Phase 1)
  STUDENT: 'STUDENT', // Non-login institutional record role in this phase
} as const;

export type RoleCode = (typeof ROLES)[keyof typeof ROLES];

/**
 * Canonical roles that can be assigned when creating or editing login accounts
 * through the User Management interface in this phase.
 * - SUPER_ADMIN is provisioned exclusively via the protected db:init process.
 * - STUDENT login accounts remain disabled as institutional records only.
 * - FACULTY accounts can be assigned to link individual teachers.
 */
export const ASSIGNABLE_ACCOUNT_ROLES: readonly string[] = [
  ROLES.PRINCIPAL,
  ROLES.SECRETARY,
  ROLES.OFFICE,
  ROLES.LIBRARY,
  ROLES.DEPARTMENT,
  ROLES.FACULTY,
];

/**
 * Roles that represent institutional records rather than login accounts in this phase.
 */
export const NON_LOGIN_ROLES: readonly string[] = [
  ROLES.STUDENT,
];

export const USER_MANAGEMENT_ROLES: readonly string[] = [
  ROLES.SUPER_ADMIN,
  ROLES.PRINCIPAL,
  ROLES.SECRETARY,
];

export const FEES_AND_STUDENTS_ROLES: readonly string[] = [
  ROLES.SUPER_ADMIN,
  ROLES.PRINCIPAL,
  ROLES.SECRETARY,
  ROLES.OFFICE,
  ROLES.STAFF,
];

export const TEACHER_RECORDS_ROLES: readonly string[] = [
  ROLES.SUPER_ADMIN,
  ROLES.PRINCIPAL,
  ROLES.SECRETARY,
  ROLES.OFFICE,
  ROLES.STAFF,
  ROLES.DEPARTMENT,
  ROLES.HOD,
];

export const DEPARTMENT_WORKSPACE_ROLES: readonly string[] = [
  ROLES.SUPER_ADMIN,
  ROLES.PRINCIPAL,
  ROLES.SECRETARY,
  ROLES.DEPARTMENT,
  ROLES.HOD,
];

export const LIBRARY_WORKSPACE_ROLES: readonly string[] = [
  ROLES.SUPER_ADMIN,
  ROLES.PRINCIPAL,
  ROLES.SECRETARY,
  ROLES.LIBRARY,
];

export function isDepartmentScopedRole(role: string): boolean {
  return role === ROLES.DEPARTMENT || role === ROLES.HOD;
}

export function isOfficeScopedRole(role: string): boolean {
  return role === ROLES.OFFICE || role === ROLES.STAFF;
}

export function isFacultyRole(role: string): boolean {
  return role === ROLES.FACULTY;
}
