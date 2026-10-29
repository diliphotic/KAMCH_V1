import bcrypt from 'bcryptjs';

export interface MemoryRole {
  id: number;
  code: string;
  name: string;
  description: string;
}

export interface MemoryDepartment {
  id: number;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MemoryUser {
  id: number;
  username: string;
  email: string | null;
  password_hash: string;
  role_id: number;
  department_id: number | null;
  teacher_id?: number | null;
  full_name: string;
  must_change_password: boolean;
  failed_attempts: number;
  is_locked: boolean;
  locked_at: string | null;
  is_suspended: boolean;
  suspended_at: string | null;
  suspension_reason: string | null;
  is_deactivated: boolean;
  deactivated_at: string | null;
  deactivation_reason: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface MemorySession {
  id: number;
  user_id: number;
  token_hash: string;
  ip_address: string | null;
  user_agent: string | null;
  last_activity_at: string;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

export interface MemoryTeacher {
  id: number;
  employee_code: string | null;
  teacher_code?: string | null;
  teacher_code_status?: 'VERIFIED' | 'APPLIED' | 'NOT_PROVIDED' | 'REQUIRES_VERIFICATION';
  registration_number?: string | null;
  full_name: string;
  designation: string;
  department_id: number;
  qualification: string | null;
  date_of_birth?: string | null;
  joining_date_service?: string | null;
  joining_date_institute?: string | null;
  reported_experience?: string | null;
  previous_institute?: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  profile_photo_url?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  data_verification_required?: boolean;
  verification_notes?: string | null;
  raw_source_snapshot?: any;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryFeeStructure {
  id: number;
  academic_year: string;
  admission_category: 'GOVERNMENT' | 'MANAGEMENT_PRIVATE' | 'NRI';
  year_of_study: number;
  college_fee: number;
  development_fee: number;
  mess_fee: number;
  hostel_fee: number;
  total_annual_fee: number;
  description: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MemoryCurriculumScheme {
  id: number;
  code: string;
  name: string;
  course_name: string;
  is_legacy_minimal: boolean;
  professional_years_count: number;
  regular_pass_max_failed_for_provisional: number;
  allow_provisional_promotion: boolean;
  passing_criteria_verified: boolean;
  passing_rule_config: any;
  supplementary_cycle_months: number;
  default_internship_days: number;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryAcademicBatch {
  id: number;
  code: string;
  name: string;
  admission_academic_year: string;
  admission_year_start: number | null;
  course_name: string;
  scheme_id: number;
  current_cohort_stage: string;
  current_professional_year: number | null;
  junior_batch_id: number | null;
  admission_status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CLOSED_LEGACY';
  is_active: boolean;
  display_order: number;
  notes: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryStudentRollSequence {
  admission_year: number;
  last_seq: number;
  updated_at: string;
}

export interface MemoryStudent {
  id: number;
  student_id_number: string;
  full_name: string;
  admission_category: 'GOVERNMENT' | 'MANAGEMENT_PRIVATE' | 'NRI';
  admission_year: number;
  current_year_of_study: number;
  is_kea_eligible: boolean;
  kea_acknowledgement_no: string | null;
  mess_enrolled: boolean;
  hostel_enrolled: boolean;
  contact_phone: string | null;
  contact_email: string | null;
  status: 'ACTIVE' | 'PASSED_OUT' | 'SUSPENDED';
  // Additive Student Management columns
  temporary_roll_number?: string | null;
  permanent_university_number?: string | null;
  university_reg_status?: 'NOT_ENTERED' | 'PENDING_VERIFICATION' | 'VERIFIED';
  university_reg_verified_by?: number | null;
  university_reg_verified_at?: string | null;
  scheme_id?: number | null;
  original_batch_id?: number | null;
  current_placement_batch_id?: number | null;
  detention_stage?: number;
  progression_status?: string;
  classroom_mapping?: any;
  outstanding_backlogs_count?: number;
  supplementary_due_cycle?: string | null;
  rs6_internship_completed?: boolean | null;
  rs6_academic_summary?: string | null;
  university_recorded_name?: string | null;
  date_of_birth?: string | null;
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | 'NOT_SPECIFIED' | null;
  nationality?: string | null;
  current_address?: string | null;
  permanent_address?: string | null;
  state?: string | null;
  district?: string | null;
  city_town?: string | null;
  pin_code?: string | null;
  profile_remarks?: string | null;
  father_name?: string | null;
  father_phone?: string | null;
  mother_name?: string | null;
  mother_phone?: string | null;
  guardian_name?: string | null;
  guardian_relationship?: string | null;
  guardian_phone?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_relationship?: string | null;
  emergency_contact_phone?: string | null;
  parent_guardian_address?: string | null;
  admission_academic_year?: string | null;
  admission_date?: string | null;
  seat_category?: string | null;
  reservation_details?: string | null;
  neet_roll_number?: string | null;
  neet_score?: string | null;
  application_identifier?: string | null;
  qualifying_exam?: string | null;
  qualifying_board?: string | null;
  qualifying_year?: number | null;
  qualifying_marks_percentage?: string | null;
  admission_order_ref?: string | null;
  admission_status?: 'APPLIED' | 'PROVISIONAL' | 'CONFIRMED' | 'CANCELLED';
  confirmation_date?: string | null;
  admission_remarks?: string | null;
  administrative_status?: 'ADMISSION_PENDING' | 'ACTIVE' | 'DISCONTINUED' | 'CANCELLED' | 'COMPLETED';
  administrative_status_reason?: string | null;
  course_duration_flag?: boolean;
  created_at: string;
  updated_at: string;
}

export interface MemoryStudentIdentifierHistory {
  id: number;
  student_id: number;
  identifier_type:
    | 'TEMPORARY_ROLL_GENERATED'
    | 'PERMANENT_UNIVERSITY_ENTERED'
    | 'PERMANENT_UNIVERSITY_VERIFIED'
    | 'IDENTIFIER_CORRECTION';
  previous_identifier: string | null;
  new_identifier: string;
  verification_status: 'PENDING_VERIFICATION' | 'VERIFIED' | 'HISTORICAL';
  reason: string;
  actor_id: number | null;
  verified_by: number | null;
  verified_at: string | null;
  created_at: string;
}

export interface MemoryStudentDocument {
  id: number;
  student_id: number;
  document_type: string;
  document_label: string | null;
  reference_number: string | null;
  issue_date: string | null;
  received_status: 'PENDING' | 'RECEIVED' | 'NOT_APPLICABLE' | 'RETURNED_ORIGINAL';
  verification_status: 'UNVERIFIED' | 'VERIFIED' | 'DISCREPANCY';
  verified_by: number | null;
  verified_at: string | null;
  remarks: string | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryStudentProgressionEvent {
  id: number;
  student_id: number;
  scheme_id: number | null;
  event_type:
    | 'INITIAL_ENROLLMENT'
    | 'PROPOSED_RESULT_OUTCOME'
    | 'CONFIRMED_PROGRESSION'
    | 'DOCUMENTED_OFFICE_CORRECTION'
    | 'MANUAL_PLACEMENT_CHANGE'
    | 'LEGACY_RS6_RECORD';
  exam_session_ref: string | null;
  exam_attempt_type: 'REGULAR' | 'SUPPLEMENTARY' | 'NOT_APPLICABLE';
  evaluated_professional_year: number | null;
  previous_professional_year: number | null;
  proposed_professional_year: number | null;
  previous_placement_batch_id: number | null;
  proposed_placement_batch_id: number | null;
  previous_detention_stage: number;
  proposed_detention_stage: number;
  subjects_evaluated_count: number;
  subjects_passed: any;
  subjects_outstanding: any;
  placement_rule_applied: string;
  proposed_status: string;
  workflow_state: 'PROPOSED' | 'PENDING_OFFICE_REVIEW' | 'CONFIRMED' | 'SUPERSEDED';
  review_issue_explanation: string | null;
  classroom_mapping: any;
  supplementary_cycle_note: string | null;
  max_duration_years_snapshot: number;
  exceeds_max_duration_flag: boolean;
  entered_by: number | null;
  confirmed_by: number | null;
  confirmed_at: string | null;
  effective_date: string | null;
  reason_or_remarks: string | null;
  created_at: string;
}

export interface MemoryInstitutionalSetting {
  setting_key: string;
  setting_value: string;
  effective_date: string;
  updated_by: number | null;
  updated_reason: string | null;
  updated_at: string;
}

export interface MemoryInstitutionalSettingHistory {
  id: number;
  setting_key: string;
  previous_value: string;
  new_value: string;
  effective_date: string;
  reason: string;
  authorized_by: number;
  created_at: string;
}

export interface MemoryStudentInternship {
  id: number;
  student_id: number;
  start_date: string | null;
  base_required_days: number;
  approved_extension_days: number;
  adjusted_required_days: number;
  credited_days_completed: number;
  attendance_source: 'PENDING_ATTENDANCE_MODULE' | 'VERIFIED_BIOMETRIC_SYNC' | 'VERIFIED_ATTENDANCE_LEDGER';
  attendance_reconciliation_status: 'UNAVAILABLE_PENDING_INTEGRATION' | 'RECONCILED' | 'DISCREPANCY_REVIEW';
  last_attendance_sync_ref: string | null;
  expected_completion_date: string | null;
  internship_status: 'NOT_STARTED' | 'ELIGIBLE' | 'IN_PROGRESS' | 'EXTENDED' | 'COMPLETED' | 'ON_HOLD';
  completion_verified_by: number | null;
  completion_verified_at: string | null;
  actual_completion_date: string | null;
  completion_remarks: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryStudentInternshipExtension {
  id: number;
  internship_id: number;
  student_id: number;
  additional_days: number;
  previous_required_total: number;
  new_required_total: number;
  reason: string;
  authorized_by: number;
  authorized_at: string;
}

export interface MemoryServiceEnrollment {
  id: number;
  student_id: number;
  service_type: 'MESS' | 'HOSTEL';
  start_date: string;
  end_date: string | null;
  annual_fee: number;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  created_by: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryFeeAssessment {
  id: number;
  student_id: number;
  academic_year: string;
  year_of_study: number;
  admission_category: 'GOVERNMENT' | 'MANAGEMENT_PRIVATE' | 'NRI';
  is_kea_exception_applied: boolean;
  kea_exception_reason: string | null;
  assessed_college_fee: number;
  assessed_development_fee: number;
  assessed_mess_fee: number;
  assessed_hostel_fee: number;
  total_assessed_fee: number;
  concession_total: number;
  revised_payable: number;
  notes: string | null;
  assessed_by: number;
  created_at: string;
  updated_at: string;
}

export interface MemoryFeeConcession {
  id: number;
  student_id: number;
  assessment_id: number;
  fee_component: string;
  concession_type: 'FIXED' | 'PERCENTAGE';
  value: number;
  calculated_reduction: number;
  reason: string;
  authorized_by: number;
  created_at: string;
}

export interface MemoryFeePayment {
  id: number;
  assessment_id: number;
  student_id: number;
  payment_reference: string;
  amount: number;
  destination: 'COLLEGE_ACCOUNT' | 'SECRETARY_DEV_ACCOUNT';
  payment_method: 'CASH' | 'BANK_TRANSFER' | 'ONLINE_DEV';
  bank_transaction_ref: string | null;
  student_tx_ref: string | null;
  passbook_tx_ref: string | null;
  bank_name: string | null;
  payment_date: string;
  recorded_by: number;
  notes: string | null;
  status: 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED' | 'REVERSED';
  verified_by: number | null;
  verified_at: string | null;
  rejection_reason: string | null;
  reversal_reason: string | null;
  reversed_by: number | null;
  reversed_at: string | null;
  created_at: string;
}

export interface MemoryFeeReceipt {
  id: number;
  payment_id: number;
  student_id: number;
  receipt_number: string;
  receipt_type: 'PROVISIONAL_ACKNOWLEDGEMENT' | 'FINAL_COLLEGE_RECEIPT' | 'SECRETARY_DEV_RECEIPT';
  destination: 'COLLEGE_ACCOUNT' | 'SECRETARY_DEV_ACCOUNT';
  amount: number;
  requested_by: number;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  reviewed_by: number | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  issued_at: string;
  created_at: string;
}

export interface MemoryAuditLog {
  id: number;
  actor_id: number | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  ip_address: string | null;
  details: any;
  created_at: string;
}

export interface MemoryIaSubject {
  id: number;
  code: string;
  name: string;
  professional_year: number;
  department_id: number | null;
  max_marks_theory: number | null;
  max_marks_practical: number | null;
  ia_maximum: number;
  is_ia_enabled: boolean;
  ia_calculation_rule: string | null;
  ia_formula_verified: boolean;
  pat_mapping_verified: boolean;
  pat_mapping_config: any;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryIaAssessment {
  id: number;
  code: string;
  name: string;
  assessment_type: 'PAT' | 'TERM_TEST' | 'UNIVERSITY_EXAM';
  term_number: number;
  max_marks_theory: number;
  max_marks_practical: number;
  is_active: boolean;
  created_at: string;
}

export interface MemorySubjectAssessmentConfig {
  id: number;
  subject_id: number;
  assessment_id: number;
  is_applicable: boolean;
  is_available_for_entry: boolean;
  available_from_date: string | null;
  available_to_date: string | null;
  updated_by: number | null;
  updated_at: string;
}

export interface MemoryStudentAssessmentMark {
  id: number;
  student_id: number;
  subject_id: number;
  assessment_id: number;
  batch_id: number;
  outcome: 'MARKS_ENTERED' | 'ABSENT' | 'NOT_APPEARED' | 'EXEMPTED';
  theory_marks: number | null;
  practical_marks: number | null;
  is_draft: boolean;
  saved_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryAssessmentSubmission {
  id: number;
  batch_id: number;
  subject_id: number;
  assessment_id: number;
  department_id: number | null;
  submitted_by: number;
  submitted_at: string;
  status: 'SUBMITTED';
}

export interface MemoryStudentTermTestConversion {
  id: number;
  student_id: number;
  batch_id: number;
  subject_id: number;
  assessment_id: number;
  term_number: number;
  outcome: 'MARKS_ENTERED' | 'ABSENT' | 'NOT_APPEARED' | 'EXEMPTED';
  raw_theory_marks: number | null;
  raw_practical_marks: number | null;
  combined_raw_marks: number | null;
  conversion_maximum: number;
  converted_marks: number | null;
  conversion_status: 'CONVERTED' | 'PENDING_OUTCOME_RULE';
  status_reason: string | null;
  calculated_at: string;
}

export interface MemoryStudentIaCalculation {
  id: number;
  student_id: number;
  batch_id: number;
  subject_id: number;
  scheme_code: string | null;
  ia_maximum: number | null;
  term1_a: number | null;
  term1_b: number | null;
  term1_c: number | null;
  term1_d: number | null;
  term1_e: number | null;
  term1_f: number | null;
  term1_h: number | null;
  term2_a: number | null;
  term2_b: number | null;
  term2_c: number | null;
  term2_d: number | null;
  term2_e: number | null;
  term2_f: number | null;
  term2_h: number | null;
  term3_a: number | null;
  term3_b: number | null;
  term3_c: number | null;
  term3_d: number | null;
  term3_e: number | null;
  term3_h: number | null;
  final_automatic_ia: number | null;
  source_assessments: any;
  calculation_status: 'CALCULATED' | 'PENDING' | 'NOT_APPLICABLE';
  status_reason: string | null;
  calculated_at: string;
}

export interface MemoryStudentFinalIaApproval {
  id: number;
  student_id: number;
  batch_id: number;
  subject_id: number;
  ia_maximum: number;
  automatic_ia_at_approval: number;
  approved_final_ia: number;
  approval_type: 'APPROVED_AS_CALCULATED' | 'MANUAL_ADJUSTMENT';
  final_status: 'APPROVED' | 'ADJUSTED_APPROVED' | 'REQUIRES_REVIEW';
  requires_office_review: boolean;
  review_flag_reason: string | null;
  reason_category: string | null;
  explanation: string | null;
  approved_by: number;
  approved_at: string;
  updated_at: string;
}

export interface MemoryStudentFinalIaHistory {
  id: number;
  student_id: number;
  batch_id: number;
  subject_id: number;
  action_type: 'APPROVED_AS_CALCULATED' | 'MANUAL_ADJUSTMENT' | 'FLAGGED_FOR_REVIEW_ON_RECALC';
  previous_final_ia: number | null;
  new_final_ia: number;
  automatic_ia_value: number | null;
  reason_category: string | null;
  explanation: string | null;
  actor_id: number | null;
  created_at: string;
}

export interface MemoryUniversitySubject {
  id: number;
  scheme_id: number;
  professional_year: number;
  code: string;
  name: string;
  max_marks: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MemoryStudentUniversityExamAttempt {
  id: number;
  student_id: number;
  subject_id: number;
  batch_id: number;
  exam_session_ref: string;
  attempt_type: 'REGULAR' | 'SUPPLEMENTARY';
  result_status: 'PASS' | 'FAIL' | 'PENDING' | 'WITHHELD';
  marks_obtained: number | null;
  max_marks: number | null;
  failed_subjects_json: any;
  office_decision: 'PROMOTED' | 'DETAINED' | 'PENDING' | 'EXPELLED' | 'WITHHELD' | null;
  remarks: string | null;
  is_finalized?: boolean;
  finalized_by?: number | null;
  finalized_at?: string | null;
  finalization_remarks?: string | null;
  recorded_by: number;
  recorded_at: string;
  created_at: string;
  updated_at: string;
}

export class MemoryDatabase {
  private static instance: MemoryDatabase;

  roles: MemoryRole[] = [];
  departments: MemoryDepartment[] = [];
  users: MemoryUser[] = [];
  sessions: MemorySession[] = [];
  auditLogs: MemoryAuditLog[] = [];
  teachers: MemoryTeacher[] = [];
  feeStructures: MemoryFeeStructure[] = [];
  curriculumSchemes: MemoryCurriculumScheme[] = [];
  academicBatches: MemoryAcademicBatch[] = [];
  rollSequences: MemoryStudentRollSequence[] = [];
  students: MemoryStudent[] = []; // Empty initially; no fake students
  identifierHistory: MemoryStudentIdentifierHistory[] = [];
  studentDocuments: MemoryStudentDocument[] = [];
  progressionEvents: MemoryStudentProgressionEvent[] = [];
  institutionalSettings: MemoryInstitutionalSetting[] = [];
  settingHistory: MemoryInstitutionalSettingHistory[] = [];
  internships: MemoryStudentInternship[] = [];
  internshipExtensions: MemoryStudentInternshipExtension[] = [];
  serviceEnrollments: MemoryServiceEnrollment[] = [];
  assessments: MemoryFeeAssessment[] = [];
  concessions: MemoryFeeConcession[] = [];
  payments: MemoryFeePayment[] = [];
  receipts: MemoryFeeReceipt[] = [];
  iaSubjects: MemoryIaSubject[] = [];
  iaAssessments: MemoryIaAssessment[] = [];
  subjectAssessmentConfigs: MemorySubjectAssessmentConfig[] = [];
  studentAssessmentMarks: MemoryStudentAssessmentMark[] = [];
  assessmentSubmissions: MemoryAssessmentSubmission[] = [];
  studentTermTestConversions: MemoryStudentTermTestConversion[] = [];
  studentIaCalculations: MemoryStudentIaCalculation[] = [];
  studentFinalIaApprovals: MemoryStudentFinalIaApproval[] = [];
  studentFinalIaHistory: MemoryStudentFinalIaHistory[] = [];
  universitySubjects: MemoryUniversitySubject[] = [];
  studentUniversityExamAttempts: MemoryStudentUniversityExamAttempt[] = [];

  private nextIds: Record<string, number> = {
    roles: 1,
    departments: 1,
    users: 1,
    sessions: 1,
    auditLogs: 1,
    teachers: 1,
    feeStructures: 1,
    curriculumSchemes: 1,
    academicBatches: 1,
    students: 1,
    identifierHistory: 1,
    studentDocuments: 1,
    progressionEvents: 1,
    settingHistory: 1,
    internships: 1,
    internshipExtensions: 1,
    serviceEnrollments: 1,
    assessments: 1,
    concessions: 1,
    payments: 1,
    receipts: 1,
    iaSubjects: 1,
    iaAssessments: 1,
    subjectAssessmentConfigs: 1,
    studentAssessmentMarks: 1,
    assessmentSubmissions: 1,
    studentTermTestConversions: 1,
    studentIaCalculations: 1,
    studentFinalIaApprovals: 1,
    studentFinalIaHistory: 1,
  };

  private initialized = false;

  public static getInstance(): MemoryDatabase {
    if (!MemoryDatabase.instance) {
      MemoryDatabase.instance = new MemoryDatabase();
      MemoryDatabase.instance.init();
    }
    return MemoryDatabase.instance;
  }

  private init(): void {
    if (this.initialized) return;
    this.initialized = true;

    const now = new Date().toISOString();

    // 1. Seed Institutional Roles
    const initialRoles: Array<Omit<MemoryRole, 'id'>> = [
      { code: 'SUPER_ADMIN', name: 'Super Administrator', description: 'Institutional super administrative control and security management' },
      { code: 'PRINCIPAL', name: 'Principal', description: 'Executive institutional governance, faculty supervision, and audit review' },
      { code: 'SECRETARY', name: 'Secretary', description: 'Trust and institutional administrative utilities and records' },
      { code: 'HOD', name: 'Head of Department', description: 'Academic and clinical department leadership and postings' },
      { code: 'FACULTY', name: 'Faculty Member', description: 'Teaching, clinical instruction, and marks entry' },
      { code: 'STAFF', name: 'Administrative Staff', description: 'Office administration and departmental operations' },
      { code: 'OFFICE', name: 'Office & Accounts Staff', description: 'Student fee management, payment collection, and receipt request submission' },
      { code: 'STUDENT', name: 'Student', description: 'Student academic portal and examination record view' },
      { code: 'LIBRARY', name: 'Library Staff', description: 'Library administration and circulation management' },
      { code: 'DEPARTMENT', name: 'Department Account', description: 'Shared institutional department account for marks and department records' },
    ];

    for (const r of initialRoles) {
      this.roles.push({ id: this.nextIds.roles++, ...r });
    }

    // 2. Provision initial Super Admin ONLY if provided via environment (never hardcoded)
    const envPassword = process.env.INITIAL_SUPERADMIN_PASSWORD?.trim();
    if (
      envPassword &&
      envPassword !== 'your_initial_superadmin_password_here' &&
      envPassword.length >= 8
    ) {
      this.provisionInitialSuperAdmin({
        username: process.env.INITIAL_SUPERADMIN_USERNAME?.trim() || 'superadmin',
        email: process.env.INITIAL_SUPERADMIN_EMAIL?.trim() || 'admin@kamch.ac.in',
        password: envPassword,
        mustChangePassword: true,
      });
    }

    // 3. Seed Initial Approved Fee Structures (Preserved from Fees Management specification)
    this.feeStructures.push(
      {
        id: this.nextIds.feeStructures++,
        academic_year: '2026-2027',
        admission_category: 'GOVERNMENT',
        year_of_study: 1,
        college_fee: 75750.0,
        development_fee: 50000.0,
        mess_fee: 30000.0,
        hostel_fee: 30000.0,
        total_annual_fee: 125750.0,
        description: 'Government Seat Base: College ₹75,750 + Dev ₹50,000 (Optional: Mess ₹30,000, Hostel ₹30,000)',
        is_active: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: this.nextIds.feeStructures++,
        academic_year: '2026-2027',
        admission_category: 'MANAGEMENT_PRIVATE',
        year_of_study: 1,
        college_fee: 400000.0,
        development_fee: 0.0,
        mess_fee: 30000.0,
        hostel_fee: 30000.0,
        total_annual_fee: 400000.0,
        description: 'Private Seat Base: Combined College & Dev ₹4,00,000 (Optional: Mess ₹30,000, Hostel ₹30,000)',
        is_active: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: this.nextIds.feeStructures++,
        academic_year: '2026-2027',
        admission_category: 'NRI',
        year_of_study: 1,
        college_fee: 600000.0,
        development_fee: 0.0,
        mess_fee: 30000.0,
        hostel_fee: 30000.0,
        total_annual_fee: 600000.0,
        description: 'NRI Seat Base: Combined College & Dev ₹6,00,000 (Optional: Mess ₹30,000, Hostel ₹30,000)',
        is_active: true,
        created_at: now,
        updated_at: now,
      }
    );

    // 4. Seed Initial Curriculum Schemes (Section 5 & 6)
    const rs6SchemeId = this.nextIds.curriculumSchemes++;
    const rs7SchemeId = this.nextIds.curriculumSchemes++;
    this.curriculumSchemes.push(
      {
        id: rs6SchemeId,
        code: 'RS6',
        name: 'RS6 Legacy Curriculum (Pre-2021–22)',
        course_name: 'BAMS',
        is_legacy_minimal: true,
        professional_years_count: 4,
        regular_pass_max_failed_for_provisional: 0,
        allow_provisional_promotion: false,
        passing_criteria_verified: false,
        passing_rule_config: null,
        supplementary_cycle_months: 6,
        default_internship_days: 365,
        is_active: true,
        notes: 'Legacy minimal record scheme for batches admitted prior to 2021–22. Newer 3-professional-year progression rules are not auto-applied.',
        created_at: now,
        updated_at: now,
      },
      {
        id: rs7SchemeId,
        code: 'RS7',
        name: 'RS7 / NCISM Curriculum (2021–22 Onwards)',
        course_name: 'BAMS',
        is_legacy_minimal: false,
        professional_years_count: 3,
        regular_pass_max_failed_for_provisional: 2,
        allow_provisional_promotion: true,
        passing_criteria_verified: true,
        passing_rule_config: null,
        supplementary_cycle_months: 6,
        default_internship_days: 365,
        is_active: true,
        notes: 'Three-professional-year BAMS curriculum scheme (2021–22 onwards) with subject-level progression, odd-batch/split-term detention routing, and 365 credited-day internship.',
        created_at: now,
        updated_at: now,
      }
    );

    // 5. Seed Initial College-Supplied Batches (Section 5 — configurable, no invented newest batch name)
    const bRs6 = this.nextIds.academicBatches++;
    const bMrut = this.nextIds.academicBatches++;
    const bAgas = this.nextIds.academicBatches++;
    const bDaks = this.nextIds.academicBatches++;
    const bAgni = this.nextIds.academicBatches++;
    const bVeda = this.nextIds.academicBatches++;
    const bNew = this.nextIds.academicBatches++;

    this.academicBatches.push(
      {
        id: bRs6,
        code: 'RS6_LEGACY',
        name: 'RS6 (Legacy Pre-2021–22)',
        admission_academic_year: 'Pre-2021-22',
        admission_year_start: 2020,
        course_name: 'BAMS',
        scheme_id: rs6SchemeId,
        current_cohort_stage: 'LEGACY_COHORT',
        current_professional_year: null,
        junior_batch_id: null,
        admission_status: 'CLOSED_LEGACY',
        is_active: true,
        display_order: 10,
        notes: 'Legacy batches admitted before 2021–22; minimal historical records.',
        created_by: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: bMrut,
        code: 'MRUTYUNJAYA',
        name: 'Mrutyunjaya',
        admission_academic_year: '2021-2022',
        admission_year_start: 2021,
        course_name: 'BAMS',
        scheme_id: rs7SchemeId,
        current_cohort_stage: 'INTERNSHIP',
        current_professional_year: null,
        junior_batch_id: bAgas,
        admission_status: 'COMPLETED',
        is_active: true,
        display_order: 20,
        notes: 'RS7 2021–22 cohort; currently in internship.',
        created_by: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: bAgas,
        code: 'AGASTYA',
        name: 'Agastya',
        admission_academic_year: '2022-2023',
        admission_year_start: 2022,
        course_name: 'BAMS',
        scheme_id: rs7SchemeId,
        current_cohort_stage: 'PROF_YEAR_3_SENIOR',
        current_professional_year: 3,
        junior_batch_id: bDaks,
        admission_status: 'COMPLETED',
        is_active: true,
        display_order: 30,
        notes: '3rd Professional Year (Seniors).',
        created_by: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: bDaks,
        code: 'DAKSHA',
        name: 'Daksha',
        admission_academic_year: '2023-2024',
        admission_year_start: 2023,
        course_name: 'BAMS',
        scheme_id: rs7SchemeId,
        current_cohort_stage: 'PROF_YEAR_3_JUNIOR',
        current_professional_year: 3,
        junior_batch_id: bAgni,
        admission_status: 'COMPLETED',
        is_active: true,
        display_order: 40,
        notes: '3rd Professional Year (Juniors).',
        created_by: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: bAgni,
        code: 'AGNIVESH',
        name: 'Agnivesh',
        admission_academic_year: '2024-2025',
        admission_year_start: 2024,
        course_name: 'BAMS',
        scheme_id: rs7SchemeId,
        current_cohort_stage: 'PROF_YEAR_2',
        current_professional_year: 2,
        junior_batch_id: bVeda,
        admission_status: 'COMPLETED',
        is_active: true,
        display_order: 50,
        notes: '2nd Professional Year.',
        created_by: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: bVeda,
        code: 'VEDANG',
        name: 'Vedang',
        admission_academic_year: '2025-2026',
        admission_year_start: 2025,
        course_name: 'BAMS',
        scheme_id: rs7SchemeId,
        current_cohort_stage: 'PROF_YEAR_1',
        current_professional_year: 1,
        junior_batch_id: bNew,
        admission_status: 'IN_PROGRESS',
        is_active: true,
        display_order: 60,
        notes: '1st Professional Year once admissions are complete.',
        created_by: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: bNew,
        code: 'NEW_INTAKE_PENDING',
        name: 'New Intake (Batch Name Not Assigned)',
        admission_academic_year: '2026-2027',
        admission_year_start: 2026,
        course_name: 'BAMS',
        scheme_id: rs7SchemeId,
        current_cohort_stage: 'ADMISSION_IN_PROGRESS',
        current_professional_year: 1,
        junior_batch_id: null,
        admission_status: 'IN_PROGRESS',
        is_active: false,
        display_order: 70,
        notes: 'Admission in progress; batch name not yet assigned and not activated prematurely.',
        created_by: null,
        created_at: now,
        updated_at: now,
      }
    );

    // 6. Seed Initial Institutional Settings (Section 12: Max Course Duration = 9 years + Step 2F Report Branding)
    this.institutionalSettings.push(
      {
        setting_key: 'MAX_COURSE_DURATION_YEARS',
        setting_value: '9',
        effective_date: '2021-09-01',
        updated_by: null,
        updated_reason: 'Initial college-configured maximum course duration setting (9 years from admission).',
        updated_at: now,
      },
      {
        setting_key: 'REPORT_COLLEGE_NAME',
        setting_value: 'Krishna Ayurvedic Medical College & Hospital',
        effective_date: '2021-09-01',
        updated_by: null,
        updated_reason: 'Default college name for official IA and assessment reports.',
        updated_at: now,
      },
      {
        setting_key: 'REPORT_SUBTITLE',
        setting_value: 'Internal Assessment & Examination Cell',
        effective_date: '2021-09-01',
        updated_by: null,
        updated_reason: 'Default subtitle for official IA and assessment reports.',
        updated_at: now,
      },
      {
        setting_key: 'REPORT_LOGO_URL',
        setting_value: '/assets/kamch-logo.png',
        effective_date: '2021-09-01',
        updated_by: null,
        updated_reason: 'Default logo path for official IA and assessment reports.',
        updated_at: now,
      }
    );

    // 7. Seed Predefined IA Assessments (PAT 1–9, Term Test 1 & 2; no Term Test 3)
    const predefinedAssessments: Array<Omit<MemoryIaAssessment, 'id' | 'created_at'>> = [
      { code: 'PAT_1', name: 'Periodic Assessment Test 1', assessment_type: 'PAT', term_number: 1, max_marks_theory: 15, max_marks_practical: 0, is_active: true },
      { code: 'PAT_2', name: 'Periodic Assessment Test 2', assessment_type: 'PAT', term_number: 1, max_marks_theory: 15, max_marks_practical: 0, is_active: true },
      { code: 'PAT_3', name: 'Periodic Assessment Test 3', assessment_type: 'PAT', term_number: 1, max_marks_theory: 15, max_marks_practical: 0, is_active: true },
      { code: 'PAT_4', name: 'Periodic Assessment Test 4', assessment_type: 'PAT', term_number: 2, max_marks_theory: 15, max_marks_practical: 0, is_active: true },
      { code: 'PAT_5', name: 'Periodic Assessment Test 5', assessment_type: 'PAT', term_number: 2, max_marks_theory: 15, max_marks_practical: 0, is_active: true },
      { code: 'PAT_6', name: 'Periodic Assessment Test 6', assessment_type: 'PAT', term_number: 2, max_marks_theory: 15, max_marks_practical: 0, is_active: true },
      { code: 'PAT_7', name: 'Periodic Assessment Test 7', assessment_type: 'PAT', term_number: 3, max_marks_theory: 15, max_marks_practical: 0, is_active: true },
      { code: 'PAT_8', name: 'Periodic Assessment Test 8', assessment_type: 'PAT', term_number: 3, max_marks_theory: 15, max_marks_practical: 0, is_active: true },
      { code: 'PAT_9', name: 'Periodic Assessment Test 9', assessment_type: 'PAT', term_number: 3, max_marks_theory: 15, max_marks_practical: 0, is_active: true },
      { code: 'TERM_TEST_1', name: 'Term Test 1', assessment_type: 'TERM_TEST', term_number: 1, max_marks_theory: 100, max_marks_practical: 100, is_active: true },
      { code: 'TERM_TEST_2', name: 'Term Test 2', assessment_type: 'TERM_TEST', term_number: 2, max_marks_theory: 100, max_marks_practical: 100, is_active: true },
    ];
    for (const a of predefinedAssessments) {
      this.iaAssessments.push({ id: this.generateId('iaAssessments'), ...a, created_at: now });
    }

    // 8. Seed Verified Subjects (PAT mapping unverified initially until explicitly configured)
    const predefinedSubjects: Array<Omit<MemoryIaSubject, 'id' | 'created_at' | 'updated_at'>> = [
      { code: 'SAMHITA_1', name: 'Samhita Adhyayana-1', professional_year: 1, department_id: null, max_marks_theory: null, max_marks_practical: null, ia_maximum: 15, is_ia_enabled: true, ia_calculation_rule: 'STANDARD_PAT_TERM', ia_formula_verified: true, pat_mapping_verified: false, pat_mapping_config: null, notes: 'Verified 15-mark IA maximum' },
      { code: 'SAMHITA_2', name: 'Samhita Adhyayana-2', professional_year: 2, department_id: null, max_marks_theory: null, max_marks_practical: null, ia_maximum: 15, is_ia_enabled: true, ia_calculation_rule: 'STANDARD_PAT_TERM', ia_formula_verified: true, pat_mapping_verified: false, pat_mapping_config: null, notes: 'Verified 15-mark IA maximum' },
      { code: 'SAMHITA_3', name: 'Samhita Adhyayana-3', professional_year: 3, department_id: null, max_marks_theory: null, max_marks_practical: null, ia_maximum: 15, is_ia_enabled: true, ia_calculation_rule: 'STANDARD_PAT_TERM', ia_formula_verified: true, pat_mapping_verified: false, pat_mapping_config: null, notes: 'Verified 15-mark IA maximum' },
      { code: 'KAYACHIKITSA', name: 'Kayachikitsa', professional_year: 3, department_id: null, max_marks_theory: null, max_marks_practical: null, ia_maximum: 30, is_ia_enabled: true, ia_calculation_rule: 'STANDARD_PAT_TERM', ia_formula_verified: true, pat_mapping_verified: false, pat_mapping_config: null, notes: 'Confirmed 30-mark subject' },
      { code: 'PANCHAKARMA', name: 'Panchakarma', professional_year: 3, department_id: null, max_marks_theory: null, max_marks_practical: null, ia_maximum: 30, is_ia_enabled: true, ia_calculation_rule: 'STANDARD_PAT_TERM', ia_formula_verified: true, pat_mapping_verified: false, pat_mapping_config: null, notes: 'Confirmed 30-mark subject' },
      { code: 'SHALYA_TANTRA', name: 'Shalya Tantra', professional_year: 3, department_id: null, max_marks_theory: null, max_marks_practical: null, ia_maximum: 30, is_ia_enabled: true, ia_calculation_rule: 'STANDARD_PAT_TERM', ia_formula_verified: true, pat_mapping_verified: false, pat_mapping_config: null, notes: 'Confirmed 30-mark subject' },
      { code: 'PRASUTI_TANTRA', name: 'Prasuti Tantra evam Stree Roga', professional_year: 3, department_id: null, max_marks_theory: null, max_marks_practical: null, ia_maximum: 30, is_ia_enabled: true, ia_calculation_rule: 'STANDARD_PAT_TERM', ia_formula_verified: true, pat_mapping_verified: false, pat_mapping_config: null, notes: 'Confirmed 30-mark subject' },
      { code: 'SHALAKYA_TANTRA', name: 'Shalakya Tantra', professional_year: 3, department_id: null, max_marks_theory: null, max_marks_practical: null, ia_maximum: 30, is_ia_enabled: true, ia_calculation_rule: 'STANDARD_PAT_TERM', ia_formula_verified: true, pat_mapping_verified: false, pat_mapping_config: null, notes: 'Confirmed 30-mark subject' },
      { code: 'KAUMARABHRITYA', name: 'Kaumarabhritya', professional_year: 3, department_id: null, max_marks_theory: null, max_marks_practical: null, ia_maximum: 30, is_ia_enabled: true, ia_calculation_rule: 'STANDARD_PAT_TERM', ia_formula_verified: true, pat_mapping_verified: false, pat_mapping_config: null, notes: 'Confirmed 30-mark subject' },
      { code: 'RESEARCH_METHODOLOGY', name: 'Research Methodology and Medical Statistics', professional_year: 3, department_id: null, max_marks_theory: null, max_marks_practical: null, ia_maximum: 0, is_ia_enabled: false, ia_calculation_rule: 'NO_IA', ia_formula_verified: false, pat_mapping_verified: false, pat_mapping_config: null, notes: 'No IA calculation required' },
      { code: 'ATYAIKACHIKITSA', name: 'Atyaikachikitsa', professional_year: 3, department_id: null, max_marks_theory: null, max_marks_practical: null, ia_maximum: 0, is_ia_enabled: false, ia_calculation_rule: 'SUBJECT_ONLY', ia_formula_verified: false, pat_mapping_verified: false, pat_mapping_config: null, notes: 'Subject record only, no invented assessment structure' },
    ];
    for (const s of predefinedSubjects) {
      const subjId = this.generateId('iaSubjects');
      this.iaSubjects.push({ id: subjId, ...s, created_at: now, updated_at: now });
      if (s.is_ia_enabled) {
        for (const a of this.iaAssessments) {
          this.subjectAssessmentConfigs.push({
            id: this.generateId('subjectAssessmentConfigs'),
            subject_id: subjId,
            assessment_id: a.id,
            is_applicable: true,
            is_available_for_entry: false,
            available_from_date: null,
            available_to_date: null,
            updated_by: null,
            updated_at: now,
          });
        }
      }
    }

    // 9. Seed Official RS7 University Examination Subjects
    const univSubjects: Array<{ code: string; name: string; year: number }> = [
      { code: 'BAMS1-PV', name: 'Padartha Vijnana', year: 1 },
      { code: 'BAMS1-SA1', name: 'Samhita Adhyayan 1', year: 1 },
      { code: 'BAMS1-RS', name: 'Rachana Sharir', year: 1 },
      { code: 'BAMS1-KS', name: 'Kriya Sharir', year: 1 },
      { code: 'BAMS1-SKT', name: 'Sanskritam evam Ayurved Ithihas', year: 1 },
      { code: 'BAMS2-DG', name: 'Dravyaguna Vijnana', year: 2 },
      { code: 'BAMS2-RN', name: 'Roga Nidan evam Vikriti Vigyan', year: 2 },
      { code: 'BAMS2-RSBK', name: 'Rasashastra evam Bhaishajya Kalpana', year: 2 },
      { code: 'BAMS2-CS1', name: 'Charaka Samhita Purvardha', year: 2 },
      { code: 'BAMS3-KC', name: 'Kayachikitsa', year: 3 },
      { code: 'BAMS3-ST', name: 'Shalya Tantra', year: 3 },
      { code: 'BAMS3-SKT', name: 'Shalakya Tantra', year: 3 },
      { code: 'BAMS3-PTSR', name: 'Prasuti Tantra evam Stri Roga', year: 3 },
      { code: 'BAMS3-KB', name: 'Kaumarbhritya', year: 3 },
      { code: 'BAMS3-PK', name: 'Panchakarma', year: 3 },
      { code: 'BAMS3-CS2', name: 'Charaka Samhita Uttarardha', year: 3 },
      { code: 'BAMS3-SW', name: 'Swasthavritta evam Yoga', year: 3 },
      { code: 'BAMS3-AT', name: 'Agada Tantra evam Vidhi Vaidyaka', year: 3 },
    ];

    for (const us of univSubjects) {
      this.universitySubjects.push({
        id: this.generateId('universitySubjects'),
        scheme_id: rs7SchemeId,
        professional_year: us.year,
        code: us.code,
        name: us.name,
        max_marks: 100,
        is_active: true,
        created_at: now,
        updated_at: now,
      });
    }

    console.log('[KAMCH ERP Memory Database] Initialized clean store with RS7 curriculum and university subjects.');
  }

  public createSnapshot(): string {
    return JSON.stringify({
      departments: this.departments,
      users: this.users,
      sessions: this.sessions,
      auditLogs: this.auditLogs,
      teachers: this.teachers,
      feeStructures: this.feeStructures,
      curriculumSchemes: this.curriculumSchemes,
      academicBatches: this.academicBatches,
      rollSequences: this.rollSequences,
      students: this.students,
      identifierHistory: this.identifierHistory,
      studentDocuments: this.studentDocuments,
      progressionEvents: this.progressionEvents,
      institutionalSettings: this.institutionalSettings,
      settingHistory: this.settingHistory,
      internships: this.internships,
      internshipExtensions: this.internshipExtensions,
      serviceEnrollments: this.serviceEnrollments,
      assessments: this.assessments,
      concessions: this.concessions,
      payments: this.payments,
      receipts: this.receipts,
      iaSubjects: this.iaSubjects,
      iaAssessments: this.iaAssessments,
      subjectAssessmentConfigs: this.subjectAssessmentConfigs,
      studentAssessmentMarks: this.studentAssessmentMarks,
      assessmentSubmissions: this.assessmentSubmissions,
      studentTermTestConversions: this.studentTermTestConversions,
      studentIaCalculations: this.studentIaCalculations,
      studentFinalIaApprovals: this.studentFinalIaApprovals,
      studentFinalIaHistory: this.studentFinalIaHistory,
      universitySubjects: this.universitySubjects,
      studentUniversityExamAttempts: this.studentUniversityExamAttempts,
      nextIds: this.nextIds,
    });
  }

  public restoreSnapshot(rawSnapshot: string): void {
    const parsed = JSON.parse(rawSnapshot);
    this.departments = parsed.departments;
    this.users = parsed.users;
    this.sessions = parsed.sessions;
    this.auditLogs = parsed.auditLogs;
    this.teachers = parsed.teachers;
    this.feeStructures = parsed.feeStructures;
    this.curriculumSchemes = parsed.curriculumSchemes;
    this.academicBatches = parsed.academicBatches;
    this.rollSequences = parsed.rollSequences;
    this.students = parsed.students;
    this.identifierHistory = parsed.identifierHistory;
    this.studentDocuments = parsed.studentDocuments;
    this.progressionEvents = parsed.progressionEvents;
    this.institutionalSettings = parsed.institutionalSettings;
    this.settingHistory = parsed.settingHistory;
    this.internships = parsed.internships;
    this.internshipExtensions = parsed.internshipExtensions;
    this.serviceEnrollments = parsed.serviceEnrollments;
    this.assessments = parsed.assessments;
    this.concessions = parsed.concessions;
    this.payments = parsed.payments;
    this.receipts = parsed.receipts;
    this.iaSubjects = parsed.iaSubjects || [];
    this.iaAssessments = parsed.iaAssessments || [];
    this.subjectAssessmentConfigs = parsed.subjectAssessmentConfigs || [];
    this.studentAssessmentMarks = parsed.studentAssessmentMarks || [];
    this.assessmentSubmissions = parsed.assessmentSubmissions || [];
    this.studentTermTestConversions = parsed.studentTermTestConversions || [];
    this.studentIaCalculations = parsed.studentIaCalculations || [];
    this.studentFinalIaApprovals = parsed.studentFinalIaApprovals || [];
    this.studentFinalIaHistory = parsed.studentFinalIaHistory || [];
    this.universitySubjects = parsed.universitySubjects || [];
    this.studentUniversityExamAttempts = parsed.studentUniversityExamAttempts || [];
    this.nextIds = parsed.nextIds;
  }

  /**
   * Protected one-time Super Admin provisioning matching server/db/init.ts.
   * No-op if a Super Admin account already exists.
   */
  public provisionInitialSuperAdmin(opts: {
    username?: string;
    email?: string | null;
    password: string;
    fullName?: string;
    mustChangePassword?: boolean;
  }): MemoryUser | null {
    const superAdminRole = this.roles.find((r) => r.code === 'SUPER_ADMIN');
    if (!superAdminRole) return null;

    const existing = this.users.find((u) => u.role_id === superAdminRole.id);
    if (existing) return existing;

    if (!opts.password || opts.password.trim().length < 8) {
      throw new Error('Initial Super Admin password must be at least 8 characters');
    }

    const now = new Date().toISOString();
    const id = this.generateId('users');
    const created: MemoryUser = {
      id,
      username: (opts.username || 'superadmin').trim(),
      email: opts.email !== undefined ? (opts.email ? opts.email.trim().toLowerCase() : null) : 'admin@kamch.ac.in',
      password_hash: bcrypt.hashSync(opts.password.trim(), 12),
      role_id: superAdminRole.id,
      department_id: null,
      teacher_id: null,
      full_name: opts.fullName || 'KAMCH System Administrator',
      must_change_password: opts.mustChangePassword !== undefined ? opts.mustChangePassword : true,
      failed_attempts: 0,
      is_locked: false,
      locked_at: null,
      is_suspended: false,
      suspended_at: null,
      suspension_reason: null,
      is_deactivated: false,
      deactivated_at: null,
      deactivation_reason: null,
      created_by: null,
      created_at: now,
      updated_at: now,
    };

    this.users.push(created);
    this.auditLogs.push({
      id: this.generateId('auditLogs'),
      actor_id: id,
      action: 'INITIAL_SUPERADMIN_SEEDED',
      target_type: 'USER',
      target_id: String(id),
      ip_address: '127.0.0.1',
      details: { username: created.username, email: created.email, seededAt: now },
      created_at: now,
    });
    return created;
  }

  generateId(table: string): number {
    if (!this.nextIds[table]) this.nextIds[table] = 1;
    return this.nextIds[table]++;
  }
}
