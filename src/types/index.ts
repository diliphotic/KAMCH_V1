/**
 * KAMCH ERP — Krishna Ayurvedic Medical College and Hospital
 * Core Type Definitions & Interfaces
 */

export type NavigationItemKey =
  | 'welcome'
  | 'components'
  | 'roadmap'
  | 'architecture'
  | 'user_mgmt'
  | 'dept_mgmt'
  | 'fees_mgmt'
  | 'student_records'
  | 'teacher_records'
  | 'marks_mgmt'
  | 'dept_portal'
  | 'library_mgmt'
  | 'principal_utils'
  | 'secretary_utils'
  | 'reports'
  | 'univ_exams'
  | 'leave_mgmt'
  | 'attendance_mgmt';

export interface NavigationItem {
  id: NavigationItemKey;
  label: string;
  category: 'foundation' | 'academic' | 'administrative' | 'governance';
  isImplemented: boolean;
  iconName: string;
  badgeText?: string;
  description: string;
}

export type ModuleStatus = 'implemented' | 'in_development' | 'planned';

export interface ERPModuleDefinition {
  id: string;
  title: string;
  code: string;
  category: 'Core System' | 'Academic' | 'Financial' | 'Governance' | 'Hospital & Clinical';
  status: ModuleStatus;
  isImplemented: boolean;
  plannedPhase: string;
  description: string;
  scopeSummary: string[];
  intendedTables: string[];
}

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'gold';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type BadgeVariant = 'institutional' | 'gold' | 'neutral' | 'success' | 'warning' | 'planned';
export type NotificationType = 'info' | 'warning' | 'success' | 'institutional';
