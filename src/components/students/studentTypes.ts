export interface CurriculumScheme {
  id: number;
  code: string;
  name: string;
  courseName: string;
  isLegacyMinimal: boolean;
  professionalYearsCount: number;
  regularPassMaxFailedForProvisional: number;
  allowProvisionalPromotion: boolean;
  passingCriteriaVerified: boolean;
  supplementaryCycleMonths: number;
  defaultInternshipDays: number;
  isActive: boolean;
  notes: string | null;
}

export interface AcademicBatch {
  id: number;
  code: string;
  name: string;
  admissionAcademicYear: string;
  admissionYearStart: number | null;
  courseName: string;
  schemeId: number;
  schemeCode: string;
  schemeName: string;
  isLegacyMinimal: boolean;
  currentCohortStage: string;
  currentProfessionalYear: number | null;
  juniorBatchId: number | null;
  juniorBatchCode: string | null;
  juniorBatchName: string | null;
  admissionStatus: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CLOSED_LEGACY';
  isActive: boolean;
  displayOrder: number;
  notes: string | null;
  originalStudentCount: number;
  currentPlacementCount: number;
  detainedPlacedHereCount: number;
}

export interface ClassroomTermTarget {
  batchId: number | null;
  batchCode: string | null;
  batchName: string;
  relationship: string;
}

export interface ClassroomMapping {
  mode: 'STANDARD_COHORT' | 'ODD_BATCH' | 'SPLIT_TERM' | 'FULL_JUNIOR_COHORT';
  term1: ClassroomTermTarget;
  term2: ClassroomTermTarget;
  term3: ClassroomTermTarget;
  summary: string;
}

export interface StudentListItem {
  id: number;
  studentIdNumber: string;
  temporaryRollNumber: string;
  permanentUniversityNumber: string | null;
  universityRegStatus: 'NOT_ENTERED' | 'PENDING_VERIFICATION' | 'VERIFIED';
  fullName: string;
  universityRecordedName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  contactPhone: string;
  contactEmail: string;
  fatherName: string | null;
  schemeId: number | null;
  schemeCode: string | null;
  schemeName: string | null;
  isLegacyMinimal: boolean;
  originalBatchId: number | null;
  originalBatchCode: string | null;
  originalBatchName: string | null;
  currentPlacementBatchId: number | null;
  currentPlacementBatchCode: string | null;
  currentPlacementBatchName: string | null;
  batchRelationship:
    | 'NOT_FILTERED'
    | 'ORIGINAL_AND_CURRENT'
    | 'PLACED_HERE_FROM_SENIOR'
    | 'ORIGINAL_PLACED_IN_JUNIOR';
  batchRelationshipLabel: string;
  admissionAcademicYear: string | null;
  admissionYear: number;
  admissionDate: string | null;
  admissionQuota: 'GOVERNMENT' | 'MANAGEMENT_PRIVATE' | 'NRI';
  admissionCategory: 'GOVERNMENT' | 'MANAGEMENT_PRIVATE' | 'NRI';
  seatCategory: string | null;
  reservationDetails: string | null;
  neetRollNumber: string | null;
  keaAcknowledgementNo: string | null;
  admissionStatus: 'APPLIED' | 'PROVISIONAL' | 'CONFIRMED' | 'CANCELLED';
  administrativeStatus:
    | 'ADMISSION_PENDING'
    | 'ACTIVE'
    | 'DISCONTINUED'
    | 'CANCELLED'
    | 'COMPLETED';
  status: 'ACTIVE' | 'PASSED_OUT' | 'SUSPENDED';
  currentYearOfStudy: number;
  detentionStage: number;
  progressionStatus: string;
  classroomMapping: ClassroomMapping | null;
  outstandingBacklogsCount: number;
  supplementaryDueCycle: string | null;
  rs6InternshipCompleted: boolean | null;
  rs6AcademicSummary: string | null;
  messEnrolled: boolean;
  hostelEnrolled: boolean;
  courseDurationFlag: boolean;
  approachingCourseDurationLimit: boolean;
  elapsedYearsFromAdmission: number | null;
  admissionDateRequiresVerification: boolean;
  admissionDateVerificationNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudentFullProfileResponse {
  student: StudentListItem & {
    nationality: string;
    currentAddress: string;
    permanentAddress: string;
    state: string;
    district: string;
    cityTown: string;
    pinCode: string;
    profileRemarks: string;
    fatherPhone: string;
    motherName: string;
    motherPhone: string;
    guardianName: string;
    guardianRelationship: string;
    guardianPhone: string;
    emergencyContactName: string;
    emergencyContactRelationship: string;
    emergencyContactPhone: string;
    parentGuardianAddress: string;
    isKeaEligible: boolean;
    neetScore: string;
    applicationIdentifier: string;
    qualifyingExam: string;
    qualifyingBoard: string;
    qualifyingYear: number | null;
    qualifyingMarksPercentage: string;
    admissionOrderRef: string;
    confirmationDate: string | null;
    admissionRemarks: string;
    administrativeStatusReason: string;
    universityRegVerifiedBy: string | null;
    universityRegVerifiedAt: string | null;
    maxCourseDurationYears: number;
  };
  identifierHistory: Array<{
    id: number;
    identifierType: string;
    previousIdentifier: string | null;
    newIdentifier: string;
    verificationStatus: string;
    reason: string;
    actorName: string | null;
    verifierName: string | null;
    verifiedAt: string | null;
    createdAt: string;
  }>;
  documents: Array<{
    id: number;
    documentType: string;
    documentLabel: string;
    referenceNumber: string;
    issueDate: string | null;
    receivedStatus: 'PENDING' | 'RECEIVED' | 'NOT_APPLICABLE' | 'RETURNED_ORIGINAL';
    verificationStatus: 'UNVERIFIED' | 'VERIFIED' | 'DISCREPANCY';
    verifierName: string | null;
    verifiedAt: string | null;
    remarks: string;
    updatedAt: string;
  }>;
  progressionHistory: Array<{
    id: number;
    eventType: string;
    examSessionRef: string | null;
    examAttemptType: string;
    evaluatedProfessionalYear: number | null;
    previousProfessionalYear: number | null;
    proposedProfessionalYear: number | null;
    previousPlacementBatchId: number | null;
    previousBatchName: string | null;
    proposedPlacementBatchId: number | null;
    proposedBatchName: string | null;
    previousDetentionStage: number;
    proposedDetentionStage: number;
    subjectsEvaluatedCount: number;
    subjectsPassed: Array<{ code: string; name: string }>;
    subjectsOutstanding: Array<{ code: string; name: string; reason?: string }>;
    placementRuleApplied: string;
    proposedStatus: string;
    workflowState: 'PROPOSED' | 'PENDING_OFFICE_REVIEW' | 'CONFIRMED' | 'SUPERSEDED';
    reviewIssueExplanation: string | null;
    classroomMapping: ClassroomMapping | null;
    supplementaryCycleNote: string | null;
    maxDurationYearsSnapshot: number;
    exceedsMaxDurationFlag: boolean;
    enteredByName: string | null;
    confirmedByName: string | null;
    confirmedAt: string | null;
    effectiveDate: string | null;
    reasonOrRemarks: string | null;
    createdAt: string;
  }>;
  internship: {
    id: number;
    startDate: string | null;
    baseRequiredDays: number;
    approvedExtensionDays: number;
    adjustedRequiredDays: number;
    creditedDaysCompleted: number;
    remainingCreditedDays: number;
    attendanceSource: string;
    attendanceReconciliationStatus: string;
    lastAttendanceSyncRef: string | null;
    expectedCompletionDate: string | null;
    internshipStatus: string;
    completionVerifiedBy: string | null;
    completionVerifiedAt: string | null;
    actualCompletionDate: string | null;
    completionRemarks: string | null;
    extensions: Array<{
      id: number;
      additionalDays: number;
      previousRequiredTotal: number;
      newRequiredTotal: number;
      reason: string;
      authorizedBy: string | null;
      authorizedAt: string;
    }>;
  } | null;
  feesSummary: {
    hasAssessment: boolean;
    academicYear: string | null;
    yearOfStudy: number | null;
    assessedCollegeFee: number;
    assessedDevelopmentFee: number;
    assessedMessFee: number;
    assessedHostelFee: number;
    totalAssessedFee: number;
    concessionTotal: number;
    revisedPayable: number;
    totalVerifiedPaid: number;
    pendingBankVerificationAmount: number;
    pendingBankTransfersCount: number;
    outstandingBalance: number;
    isKeaExceptionApplied: boolean;
    concessionsCount: number;
    serviceEnrollments: Array<{
      id: number;
      serviceType: string;
      startDate: string | null;
      endDate: string | null;
      annualFee: number;
      status: string;
    }>;
    recentPayments: Array<{
      id: number;
      paymentReference: string;
      amount: number;
      destination: string;
      paymentMethod: string;
      paymentDate: string | null;
      status: string;
      receiptId: number | null;
      receiptNumber: string | null;
      receiptType: string | null;
      receiptStatus: string | null;
    }>;
  };
  auditHistory: Array<{
    id: number;
    action: string;
    actorName: string | null;
    actorRole: string | null;
    details: Record<string, any> | null;
    createdAt: string;
  }>;
}

export interface CourseDurationSettingResponse {
  settingKey: string;
  maxCourseDurationYears: number;
  effectiveDate: string;
  updatedReason: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  canModify: boolean;
  history: Array<{
    id: number;
    previousValue: number;
    newValue: number;
    effectiveDate: string;
    reason: string;
    authorizedBy: string | null;
    createdAt: string;
  }>;
}

export interface RegistryDiagnosticsResponse {
  totalStudents: number;
  potentialDuplicatesCount: number;
  potentialDuplicates: Array<{
    studentAId: number;
    studentAIdNumber: string;
    studentAName: string;
    studentBId: number;
    studentBIdNumber: string;
    studentBName: string;
    reasons: string[];
  }>;
  admissionDateIssuesCount: number;
  admissionDateIssues: Array<{
    studentId: number;
    studentIdNumber: string;
    fullName: string;
    admissionYear: number;
    admissionStatus: string;
    rawAdmissionDate: string | null;
    normalizedAdmissionDate: string | null;
    verificationNote: string;
    storedCourseDurationFlag: boolean;
  }>;
  note: string;
}

export function formatQuotaLabel(quota?: string | null): string {
  if (quota === 'GOVERNMENT') return 'Government Quota';
  if (quota === 'MANAGEMENT_PRIVATE') return 'Private / Management';
  if (quota === 'NRI') return 'NRI Quota';
  return quota || '—';
}

export type PlacementLifecycleMode =
  | 'ADMISSION_IN_PROGRESS'
  | 'PROFESSIONAL_YEAR'
  | 'INTERNSHIP'
  | 'LEGACY_COHORT';

export interface ParsedCohortPlacement {
  lifecycleMode: PlacementLifecycleMode;
  professionalYear: number | null;
  termNumber: 1 | 2 | 3 | null;
  legacyUnmigratedStage: string | null;
}

export function formatOrdinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function formatProfessionalYearLabel(
  year?: number | null,
  schemeCode?: string | null
): string {
  if (year === null || year === undefined || Number(year) <= 0) {
    return 'Not Applicable';
  }
  const y = Number(year);
  const suffix = y === 4 && schemeCode === 'RS6' ? ' (RS6)' : '';
  return `${formatOrdinal(y)} Professional Year${suffix}`;
}

export function parseCohortPlacement(
  stage?: string | null,
  currentProfessionalYear?: number | null
): ParsedCohortPlacement {
  const clean = (stage || '').trim().toUpperCase();
  if (clean === 'INTERNSHIP') {
    return {
      lifecycleMode: 'INTERNSHIP',
      professionalYear: null,
      termNumber: null,
      legacyUnmigratedStage: null,
    };
  }
  if (clean === 'LEGACY_COHORT') {
    return {
      lifecycleMode: 'LEGACY_COHORT',
      professionalYear:
        currentProfessionalYear && Number(currentProfessionalYear) > 0
          ? Number(currentProfessionalYear)
          : null,
      termNumber: null,
      legacyUnmigratedStage: null,
    };
  }
  if (clean === 'ADMISSION_IN_PROGRESS') {
    return {
      lifecycleMode: 'ADMISSION_IN_PROGRESS',
      professionalYear:
        currentProfessionalYear && Number(currentProfessionalYear) > 0
          ? Number(currentProfessionalYear)
          : 1,
      termNumber: null,
      legacyUnmigratedStage: null,
    };
  }

  const termMatch = clean.match(/^PROF_YEAR_(\d+)_TERM_([123])$/);
  if (termMatch) {
    const parsedYear = Number(termMatch[1]);
    const parsedTerm = Number(termMatch[2]) as 1 | 2 | 3;
    return {
      lifecycleMode: 'PROFESSIONAL_YEAR',
      professionalYear:
        currentProfessionalYear && Number(currentProfessionalYear) > 0
          ? Number(currentProfessionalYear)
          : parsedYear,
      termNumber: parsedTerm,
      legacyUnmigratedStage: null,
    };
  }

  const legacyYearMatch = clean.match(/^PROF_YEAR_(\d+)/);
  const fallbackYear =
    currentProfessionalYear && Number(currentProfessionalYear) > 0
      ? Number(currentProfessionalYear)
      : legacyYearMatch
        ? Number(legacyYearMatch[1])
        : 1;

  return {
    lifecycleMode: 'PROFESSIONAL_YEAR',
    professionalYear: fallbackYear,
    termNumber: null,
    legacyUnmigratedStage: clean || null,
  };
}

export function buildCohortStageCode(params: {
  lifecycleMode: PlacementLifecycleMode;
  professionalYear: number | null;
  termNumber: 1 | 2 | 3 | null;
  preserveLegacyStage?: string | null;
}): string {
  const { lifecycleMode, professionalYear, termNumber, preserveLegacyStage } = params;
  if (lifecycleMode === 'INTERNSHIP') return 'INTERNSHIP';
  if (lifecycleMode === 'LEGACY_COHORT') return 'LEGACY_COHORT';
  if (lifecycleMode === 'ADMISSION_IN_PROGRESS') return 'ADMISSION_IN_PROGRESS';

  const safeYear = professionalYear && professionalYear > 0 ? professionalYear : 1;
  if (termNumber === 1 || termNumber === 2 || termNumber === 3) {
    return `PROF_YEAR_${safeYear}_TERM_${termNumber}`;
  }
  if (preserveLegacyStage) {
    const match = preserveLegacyStage.match(/^PROF_YEAR_(\d+)/);
    if (!match || Number(match[1]) === safeYear) {
      return preserveLegacyStage;
    }
  }
  return `PROF_YEAR_${safeYear}`;
}

export function formatCohortTermOrStageLabel(stage?: string | null): string {
  if (!stage) return '—';
  const clean = stage.trim().toUpperCase();
  const termMatch = clean.match(/^PROF_YEAR_(\d+)_TERM_([123])$/);
  if (termMatch) {
    return `Term ${termMatch[2]}`;
  }
  switch (clean) {
    case 'ADMISSION_IN_PROGRESS':
      return 'Admission in Progress';
    case 'INTERNSHIP':
      return 'Compulsory Internship';
    case 'LEGACY_COHORT':
      return 'Legacy RS6 Summary';
    case 'PROF_YEAR_3_SENIOR':
      return 'Term Not Set (Legacy Senior Label)';
    case 'PROF_YEAR_3_JUNIOR':
      return 'Term Not Set (Legacy Junior Label)';
    case 'PROF_YEAR_1':
    case 'PROF_YEAR_2':
    case 'PROF_YEAR_3':
    case 'PROF_YEAR_4':
      return 'Term Not Set';
    default:
      return formatCohortStageLabel(stage);
  }
}

export function formatCohortStageLabel(stage?: string | null): string {
  if (!stage) return '—';
  const clean = stage.trim().toUpperCase();
  const termMatch = clean.match(/^PROF_YEAR_(\d+)_TERM_([123])$/);
  if (termMatch) {
    const yr = Number(termMatch[1]);
    const tm = Number(termMatch[2]);
    return `${formatOrdinal(yr)} Professional Year — Term ${tm}`;
  }
  switch (clean) {
    case 'LEGACY_COHORT':
      return 'Legacy RS6 (Pre-2021–22)';
    case 'INTERNSHIP':
      return 'Compulsory Internship';
    case 'PROF_YEAR_3_SENIOR':
      return '3rd Professional Year (Legacy Senior Cohort)';
    case 'PROF_YEAR_3_JUNIOR':
      return '3rd Professional Year (Legacy Junior Cohort)';
    case 'PROF_YEAR_4':
      return '4th Professional Year';
    case 'PROF_YEAR_3':
      return '3rd Professional Year';
    case 'PROF_YEAR_2':
      return '2nd Professional Year';
    case 'PROF_YEAR_1':
      return '1st Professional Year';
    case 'ADMISSION_IN_PROGRESS':
      return 'Admission in Progress';
    default: {
      const yrOnly = clean.match(/^PROF_YEAR_(\d+)$/);
      if (yrOnly) {
        return `${formatOrdinal(Number(yrOnly[1]))} Professional Year`;
      }
      return stage.replace(/_/g, ' ');
    }
  }
}

export function formatProgressionStatusLabel(status?: string | null): string {
  switch (status) {
    case 'REGULAR_ACTIVE':
      return 'Regular Active';
    case 'PASSED_AND_PROMOTED':
      return 'Passed & Promoted';
    case 'PROVISIONALLY_PROMOTED_WITH_BACKLOGS':
      return 'Provisionally Promoted (Backlogs)';
    case 'SUPPLEMENTARY_PENDING':
      return 'Supplementary Pending';
    case 'DETAINED_ODD_BATCH':
      return 'Detained · Stage 1 (Odd-Batch)';
    case 'DOUBLE_DETAINED_SPLIT_TERM':
      return 'Double-Detained · Stage 2 (Split-Term)';
    case 'JUNIOR_TIMELINE_PLACEMENT':
      return 'Detained · Stage 3+ (Subsequent Junior)';
    case 'ELIGIBLE_FOR_INTERNSHIP':
      return 'Eligible for Internship';
    case 'PENDING_OFFICE_REVIEW':
      return 'Pending Office Review';
    case 'LEGACY_RS6_SUMMARY':
      return 'Legacy RS6 Summary';
    default:
      return status ? status.replace(/_/g, ' ') : '—';
  }
}

export function formatInr(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount || 0);
}
