/**
 * KAMCH ERP — Academic Progression Engine, Course Duration Check & CSV Utilities
 * Implements college-specific RS7 progression & detention placement rules,
 * RS6 legacy safeguards, subject-level failure aggregation, and split-term routing.
 */

export interface SubjectPaperComponent {
  paperCode: string;
  status: 'PASS' | 'FAIL' | 'INCOMPLETE';
}

export interface SubjectResultInput {
  subjectCode: string;
  subjectName: string;
  theoryStatus?: 'PASS' | 'FAIL' | 'NA' | 'INCOMPLETE';
  practicalStatus?: 'PASS' | 'FAIL' | 'NA' | 'INCOMPLETE';
  vivaStatus?: 'PASS' | 'FAIL' | 'NA' | 'INCOMPLETE';
  papers?: SubjectPaperComponent[];
  overallResult?: 'PASS' | 'FAIL' | 'INCOMPLETE' | 'ABSENT';
}

export interface SchemeConfig {
  id: number;
  code: string;
  name: string;
  is_legacy_minimal: boolean;
  professional_years_count: number;
  regular_pass_max_failed_for_provisional: number;
  allow_provisional_promotion: boolean;
  passing_criteria_verified: boolean;
  supplementary_cycle_months: number;
}

export interface BatchConfigNode {
  id: number;
  code: string;
  name: string;
  junior_batch_id: number | null;
  current_professional_year: number | null;
  current_cohort_stage: string;
}

export interface StudentProgressionState {
  id: number;
  admission_year: number;
  admission_date: unknown;
  date_of_birth?: unknown;
  admission_status?: string | null;
  current_year_of_study: number;
  original_batch_id: number | null;
  current_placement_batch_id: number | null;
  detention_stage: number;
  progression_status: string;
  outstanding_backlogs_count: number;
}

export interface ClassroomTermTarget {
  batchId: number | null;
  batchCode: string | null;
  batchName: string;
  relationship: 'ORIGINAL_COHORT' | 'JUNIOR_COHORT' | 'SUBSEQUENT_JUNIOR_COHORT' | 'ODD_BATCH_COHORT';
}

export interface ClassroomMapping {
  mode: 'STANDARD_COHORT' | 'ODD_BATCH' | 'SPLIT_TERM' | 'FULL_JUNIOR_COHORT';
  term1: ClassroomTermTarget;
  term2: ClassroomTermTarget;
  term3: ClassroomTermTarget;
  summary: string;
}

export interface ProgressionProposal {
  workflowState: 'PROPOSED' | 'PENDING_OFFICE_REVIEW';
  proposedStatus: string;
  placementRuleApplied: string;
  previousProfessionalYear: number;
  proposedProfessionalYear: number;
  previousPlacementBatchId: number | null;
  proposedPlacementBatchId: number | null;
  previousDetentionStage: number;
  proposedDetentionStage: number;
  subjectsEvaluatedCount: number;
  subjectsPassed: Array<{ code: string; name: string }>;
  subjectsOutstanding: Array<{ code: string; name: string; reason: string }>;
  classroomMapping: ClassroomMapping | null;
  supplementaryCycleNote: string | null;
  reviewIssueExplanation: string | null;
  maxDurationYearsSnapshot: number;
  exceedsMaxDurationFlag: boolean;
  elapsedYearsFromAdmission: number | null;
  admissionDateRequiresVerification: boolean;
}

/**
 * Timezone-safe converter for MySQL DATE values (`Date` objects returned by mysql2 in local time
 * or strict ISO `YYYY-MM-DD` strings).
 *
 * - Never calls `String(dateObj).slice(0, 10)` (which turns `Date` into `"Sat Nov 22"`, causing V8
 *   `new Date("Sat Nov 22")` to fabricate year `2001` and yield ~24.92 elapsed years).
 * - Never calls `.toISOString()` on local-midnight `mysql2` `Date` objects (which shifts IST dates
 *   backward by 1 day).
 * - Rejects yearless, malformed, or nonexistent calendar dates (e.g. `2025-02-31`).
 */
export function toIsoDateOnly(val: unknown): string | null {
  if (val === null || val === undefined) return null;

  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    // mysql2 constructs DATE columns as local-midnight Date(year, monthIndex, day, 0, 0, 0)
    const isLocalMidnight =
      val.getHours() === 0 &&
      val.getMinutes() === 0 &&
      val.getSeconds() === 0 &&
      val.getMilliseconds() === 0;
    const year = isLocalMidnight ? val.getFullYear() : val.getUTCFullYear();
    const month = isLocalMidnight ? val.getMonth() + 1 : val.getUTCMonth() + 1;
    const day = isLocalMidnight ? val.getDate() : val.getUTCDate();
    if (year < 1900 || year > 2100) return null;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  if (typeof val !== 'string') return null;
  const s = val.trim();
  if (!s) return null;

  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isoDateToUtcMs(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export interface CourseDurationCheckResult {
  normalizedAdmissionDate: string | null;
  requiresVerification: boolean;
  verificationReason: string | null;
  elapsedYears: number | null;
  exceedsLimit: boolean;
  approachingLimit: boolean;
}

export function computeCourseDurationStatus(
  admissionYear: number,
  admissionDate: unknown,
  maxDurationYears: number,
  referenceDateStr?: string | null,
  options?: {
    dateOfBirth?: unknown;
    admissionStatus?: string | null;
  }
): CourseDurationCheckResult {
  const refIso = referenceDateStr ? toIsoDateOnly(referenceDateStr) : null;
  let refUtcMs: number;
  if (refIso) {
    refUtcMs = isoDateToUtcMs(refIso);
  } else {
    const now = new Date();
    refUtcMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  }

  const rawWasProvided =
    admissionDate !== null &&
    admissionDate !== undefined &&
    String(admissionDate).trim() !== '';
  const isoAdm = toIsoDateOnly(admissionDate);

  // 1. Null or malformed official admission_date -> NEVER substitute DOB, created_at, today, or Sept 1
  if (!isoAdm) {
    return {
      normalizedAdmissionDate: null,
      requiresVerification: true,
      verificationReason: rawWasProvided
        ? 'Recorded admission date format is invalid and requires verification.'
        : 'Official admission date has not been recorded yet.',
      elapsedYears: null,
      exceedsLimit: false,
      approachingLimit: false,
    };
  }

  // 2. Unconfirmed/non-admitted application status (APPLIED or CANCELLED)
  const admStatus = options?.admissionStatus
    ? String(options.admissionStatus).trim().toUpperCase()
    : null;
  if (admStatus === 'APPLIED' || admStatus === 'CANCELLED') {
    return {
      normalizedAdmissionDate: isoAdm,
      requiresVerification: true,
      verificationReason: `Admission status is ${admStatus}; official admission date requires verification.`,
      elapsedYears: null,
      exceedsLimit: false,
      approachingLimit: false,
    };
  }

  const admUtcMs = isoDateToUtcMs(isoAdm);
  const admDateYear = Number(isoAdm.slice(0, 4));

  // 3. Future date or implausible historical year (< 1990)
  if (admDateYear < 1990 || admUtcMs > refUtcMs) {
    return {
      normalizedAdmissionDate: isoAdm,
      requiresVerification: true,
      verificationReason:
        admUtcMs > refUtcMs
          ? `Recorded admission date (${isoAdm}) is in the future and requires verification.`
          : `Recorded admission date (${isoAdm}) precedes institutional establishment and requires verification.`,
      elapsedYears: null,
      exceedsLimit: false,
      approachingLimit: false,
    };
  }

  // 4. Guard against accidental Date of Birth substitution
  const isoDob = toIsoDateOnly(options?.dateOfBirth);
  if (isoDob) {
    const dobUtcMs = isoDateToUtcMs(isoDob);
    const ageAtAdmissionYears = (admUtcMs - dobUtcMs) / (365.25 * 24 * 60 * 60 * 1000);
    if (isoAdm === isoDob || ageAtAdmissionYears < 14) {
      return {
        normalizedAdmissionDate: isoAdm,
        requiresVerification: true,
        verificationReason:
          isoAdm === isoDob
            ? 'Recorded admission date matches date of birth and requires verification.'
            : `Recorded admission date (${isoAdm}) is implausibly close to date of birth (${isoDob}) and requires verification.`,
        elapsedYears: null,
        exceedsLimit: false,
        approachingLimit: false,
      };
    }
  }

  // 5. Guard against accidental record-creation-date or wrong-decade entry relative to cohort admission_year
  if (
    Number.isInteger(admissionYear) &&
    admissionYear >= 1990 &&
    Math.abs(admDateYear - admissionYear) > 1
  ) {
    return {
      normalizedAdmissionDate: isoAdm,
      requiresVerification: true,
      verificationReason: `Recorded admission date (${isoAdm}) differs from admission year (${admissionYear}) and requires verification.`,
      elapsedYears: null,
      exceedsLimit: false,
      approachingLimit: false,
    };
  }

  const diffDays = Math.max(0, (refUtcMs - admUtcMs) / (24 * 60 * 60 * 1000));
  const rounded = Math.round((diffDays / 365.25) * 100) / 100;

  return {
    normalizedAdmissionDate: isoAdm,
    requiresVerification: false,
    verificationReason: null,
    elapsedYears: rounded,
    exceedsLimit: rounded >= maxDurationYears,
    approachingLimit: rounded >= Math.max(1, maxDurationYears - 1) && rounded < maxDurationYears,
  };
}

function walkJuniorBatchChain(
  startBatchId: number | null,
  steps: number,
  batchMap: Map<number, BatchConfigNode>
): BatchConfigNode | null {
  if (!startBatchId) return null;
  let current = batchMap.get(startBatchId) || null;
  const visited = new Set<number>();
  for (let i = 0; i < steps; i++) {
    if (!current || !current.junior_batch_id || visited.has(current.id)) {
      return null;
    }
    visited.add(current.id);
    current = batchMap.get(current.junior_batch_id) || null;
  }
  return current;
}

/**
 * Evaluates official university subject-level results and proposes a progression/placement outcome.
 * - Aggregates multiple papers/components under the same subjectCode into ONE subject.
 * - Flags incomplete or conflicting results as PENDING_OFFICE_REVIEW instead of guessing.
 * - Does NOT automatically apply RS7 rules to RS6 legacy records.
 */
export function evaluateProgressionProposal(params: {
  student: StudentProgressionState;
  scheme: SchemeConfig | null;
  batches: BatchConfigNode[];
  examSessionRef: string;
  examAttemptType: 'REGULAR' | 'SUPPLEMENTARY';
  evaluatedProfessionalYear: number;
  subjects: SubjectResultInput[];
  priorUnresolvedSubjects?: Array<{ code: string; name: string }>;
  maxCourseDurationYears: number;
  effectiveDate?: string | null;
}): ProgressionProposal {
  const {
    student,
    scheme,
    batches,
    examSessionRef,
    examAttemptType,
    evaluatedProfessionalYear,
    subjects,
    priorUnresolvedSubjects = [],
    maxCourseDurationYears,
    effectiveDate,
  } = params;

  const batchMap = new Map<number, BatchConfigNode>();
  for (const b of batches) {
    batchMap.set(Number(b.id), b);
  }

  const durationCheck = computeCourseDurationStatus(
    student.admission_year,
    student.admission_date,
    maxCourseDurationYears,
    effectiveDate,
    {
      dateOfBirth: student.date_of_birth,
      admissionStatus: student.admission_status,
    }
  );

  const prevProfYear = student.current_year_of_study || 1;
  const prevBatchId = student.current_placement_batch_id ?? student.original_batch_id ?? null;
  const origBatchId = student.original_batch_id ?? prevBatchId;
  const prevDetention = student.detention_stage || 0;

  const makeReviewFallback = (ruleCode: string, explanation: string): ProgressionProposal => ({
    workflowState: 'PENDING_OFFICE_REVIEW',
    proposedStatus: 'PENDING_OFFICE_REVIEW',
    placementRuleApplied: ruleCode,
    previousProfessionalYear: prevProfYear,
    proposedProfessionalYear: prevProfYear,
    previousPlacementBatchId: prevBatchId,
    proposedPlacementBatchId: prevBatchId,
    previousDetentionStage: prevDetention,
    proposedDetentionStage: prevDetention,
    subjectsEvaluatedCount: 0,
    subjectsPassed: [],
    subjectsOutstanding: [],
    classroomMapping: null,
    supplementaryCycleNote: null,
    reviewIssueExplanation: explanation,
    maxDurationYearsSnapshot: maxCourseDurationYears,
    exceedsMaxDurationFlag: durationCheck.exceedsLimit,
    elapsedYearsFromAdmission: durationCheck.elapsedYears,
    admissionDateRequiresVerification: durationCheck.requiresVerification,
  });

  if (!scheme) {
    return makeReviewFallback(
      'MISSING_SCHEME_CONFIGURATION',
      'Student does not have an assigned curriculum scheme. Assign a valid scheme before automated progression evaluation.'
    );
  }

  // Section 6: Do not automatically apply newer three-professional-year progression rules to RS6
  if (scheme.is_legacy_minimal || scheme.code.toUpperCase() === 'RS6') {
    return makeReviewFallback(
      'RS6_LEGACY_SCHEME_GUARD',
      'RS6 legacy records do not automatically apply newer three-professional-year progression rules. Record verified RS6 academic outcome directly.'
    );
  }

  if (!scheme.passing_criteria_verified) {
    return makeReviewFallback(
      'UNVERIFIED_SCHEME_PASSING_CRITERIA',
      `Passing criteria for scheme '${scheme.code}' have not been marked as verified. Manual Office review is required.`
    );
  }

  if (!examSessionRef || !examSessionRef.trim()) {
    return makeReviewFallback(
      'MISSING_EXAM_SESSION_REFERENCE',
      'Official university examination/session reference is required to evaluate progression.'
    );
  }

  if (!Array.isArray(subjects) || subjects.length === 0) {
    return makeReviewFallback(
      'EMPTY_SUBJECT_RESULTS',
      'No subject-level university results were supplied for evaluation.'
    );
  }

  // Aggregate by normalized subjectCode so multiple papers/components of the same subject are NEVER counted as separate subjects
  interface AggregatedSubject {
    code: string;
    name: string;
    componentFailures: string[];
    componentIncompletes: string[];
    explicitPassCount: number;
    overallOutcomes: Set<string>;
  }

  const aggregatedMap = new Map<string, AggregatedSubject>();
  const issues: string[] = [];

  for (const raw of subjects) {
    const code = String(raw.subjectCode || '').trim().toUpperCase();
    const name = String(raw.subjectName || code).trim();
    if (!code) {
      issues.push('One or more result entries are missing a subject code.');
      continue;
    }

    let agg = aggregatedMap.get(code);
    if (!agg) {
      agg = {
        code,
        name: name || code,
        componentFailures: [],
        componentIncompletes: [],
        explicitPassCount: 0,
        overallOutcomes: new Set<string>(),
      };
      aggregatedMap.set(code, agg);
    }

    const checkComp = (label: string, val?: string) => {
      if (!val || val === 'NA') return;
      if (val === 'FAIL') agg!.componentFailures.push(label);
      else if (val === 'INCOMPLETE') agg!.componentIncompletes.push(label);
      else if (val === 'PASS') agg!.explicitPassCount++;
    };

    checkComp('Theory', raw.theoryStatus);
    checkComp('Practical', raw.practicalStatus);
    checkComp('Viva', raw.vivaStatus);

    if (Array.isArray(raw.papers)) {
      for (const p of raw.papers) {
        checkComp(`Paper ${p.paperCode || ''}`.trim(), p.status);
      }
    }

    if (raw.overallResult) {
      agg.overallOutcomes.add(raw.overallResult);
    }
  }

  const passedSubjects: Array<{ code: string; name: string }> = [];
  const failedSubjects: Array<{ code: string; name: string; reason: string }> = [];

  for (const agg of aggregatedMap.values()) {
    if (agg.componentIncompletes.length > 0 || agg.overallOutcomes.has('INCOMPLETE')) {
      issues.push(
        `Subject '${agg.code} (${agg.name})' has incomplete result components (${agg.componentIncompletes.join(', ') || 'Overall INCOMPLETE'}).`
      );
      continue;
    }

    if (agg.overallOutcomes.has('PASS') && agg.overallOutcomes.has('FAIL')) {
      issues.push(
        `Subject '${agg.code} (${agg.name})' has conflicting overall entries (both PASS and FAIL supplied).`
      );
      continue;
    }

    if (agg.overallOutcomes.has('PASS') && agg.componentFailures.length > 0) {
      issues.push(
        `Conflicting result in subject '${agg.code} (${agg.name})': overall marked PASS, but failed in ${agg.componentFailures.join(', ')}.`
      );
      continue;
    }

    if (
      agg.overallOutcomes.has('FAIL') &&
      agg.componentFailures.length === 0 &&
      agg.explicitPassCount > 0
    ) {
      issues.push(
        `Conflicting result in subject '${agg.code} (${agg.name})': overall marked FAIL, while all specified components (${agg.explicitPassCount}) are marked PASS.`
      );
      continue;
    }

    const isAbsent = agg.overallOutcomes.has('ABSENT');
    const isFail = isAbsent || agg.overallOutcomes.has('FAIL') || agg.componentFailures.length > 0;
    const isPass =
      !isFail && (agg.overallOutcomes.has('PASS') || agg.explicitPassCount > 0);

    if (!isFail && !isPass) {
      issues.push(
        `Subject '${agg.code} (${agg.name})' has neither a verified overall outcome nor component pass/fail statuses.`
      );
      continue;
    }

    if (isFail) {
      const failReason = isAbsent
        ? 'Absent in university examination'
        : agg.componentFailures.length > 0
        ? `Failed in ${agg.componentFailures.join(', ')}`
        : 'Failed official university subject evaluation';
      failedSubjects.push({ code: agg.code, name: agg.name, reason: failReason });
    } else {
      passedSubjects.push({ code: agg.code, name: agg.name });
    }
  }

  // Merge any prior unresolved backlogs that were NOT just passed in this session
  const passedCodeSet = new Set(passedSubjects.map((s) => s.code));
  const failedCodeSet = new Set(failedSubjects.map((s) => s.code));
  for (const prior of priorUnresolvedSubjects) {
    const pCode = prior.code.toUpperCase();
    if (!passedCodeSet.has(pCode) && !failedCodeSet.has(pCode)) {
      failedSubjects.push({
        code: pCode,
        name: prior.name,
        reason: 'Carried unresolved backlog subject',
      });
    }
  }

  if (issues.length > 0) {
    return {
      ...makeReviewFallback('CONFLICTING_OR_INCOMPLETE_RESULTS', issues.join(' ')),
      subjectsEvaluatedCount: aggregatedMap.size,
      subjectsPassed: passedSubjects,
      subjectsOutstanding: failedSubjects,
    };
  }

  const failedCount = failedSubjects.length;
  const maxProfYears = scheme.professional_years_count || 3;
  const evalYear = evaluatedProfessionalYear || prevProfYear;
  const suppCycleNote = `${scheme.supplementary_cycle_months || 6}-month supplementary examination cycle applies for backlog clearance (scheduling rule only; promotion is never automatic upon time elapsing).`;

  const origBatch = origBatchId ? batchMap.get(origBatchId) || null : null;
  const currBatch = prevBatchId ? batchMap.get(prevBatchId) || null : origBatch;

  const standardMapping = (batch: BatchConfigNode | null): ClassroomMapping | null => {
    if (!batch) return null;
    const target: ClassroomTermTarget = {
      batchId: batch.id,
      batchCode: batch.code,
      batchName: batch.name,
      relationship: batch.id === origBatchId ? 'ORIGINAL_COHORT' : 'SUBSEQUENT_JUNIOR_COHORT',
    };
    return {
      mode: 'STANDARD_COHORT',
      term1: target,
      term2: target,
      term3: target,
      summary: `All terms (1, 2, 3) with ${batch.name}`,
    };
  };

  // Helper to apply detention stage routing (Rules 3, 4, 5, 6)
  const buildDetentionOutcome = (nextStage: number, triggerRulePrefix: string): ProgressionProposal => {
    // Stage 1: First detention / odd-batch placement
    if (nextStage === 1) {
      const refBatch = currBatch || origBatch;
      const oddTarget: ClassroomTermTarget = {
        batchId: refBatch?.id ?? null,
        batchCode: refBatch?.code ?? null,
        batchName: refBatch ? `${refBatch.name} (Odd-Batch / Supplementary Cycle)` : 'Odd-Batch Placement',
        relationship: 'ODD_BATCH_COHORT',
      };
      return {
        workflowState: durationCheck.exceedsLimit ? 'PENDING_OFFICE_REVIEW' : 'PROPOSED',
        proposedStatus: 'DETAINED_ODD_BATCH',
        placementRuleApplied: `${triggerRulePrefix}_STAGE_1_ODD_BATCH`,
        previousProfessionalYear: prevProfYear,
        proposedProfessionalYear: evalYear,
        previousPlacementBatchId: prevBatchId,
        proposedPlacementBatchId: prevBatchId,
        previousDetentionStage: prevDetention,
        proposedDetentionStage: 1,
        subjectsEvaluatedCount: aggregatedMap.size,
        subjectsPassed: passedSubjects,
        subjectsOutstanding: failedSubjects,
        classroomMapping: {
          mode: 'ODD_BATCH',
          term1: oddTarget,
          term2: oddTarget,
          term3: oddTarget,
          summary: `1st Detention (Odd-Batch stage) — supplementary exam in ${scheme.supplementary_cycle_months} months`,
        },
        supplementaryCycleNote: suppCycleNote,
        reviewIssueExplanation: durationCheck.exceedsLimit
          ? `Student has reached/exceeded the configured ${maxCourseDurationYears}-year maximum course duration (${durationCheck.elapsedYears} yrs). Review required before confirmation.`
          : null,
        maxDurationYearsSnapshot: maxCourseDurationYears,
        exceedsMaxDurationFlag: durationCheck.exceedsLimit,
        elapsedYearsFromAdmission: durationCheck.elapsedYears,
        admissionDateRequiresVerification: durationCheck.requiresVerification,
      };
    }

    // Stage 2: Second consecutive detention -> Split-term routing!
    // Rule 5: Term 1 uses the junior cohort; Terms 2 and 3 use the original cohort.
    if (nextStage === 2) {
      const juniorCohort = walkJuniorBatchChain(origBatchId, 1, batchMap);
      if (!origBatch || !juniorCohort) {
        return {
          ...makeReviewFallback(
            'SPLIT_TERM_JUNIOR_BATCH_UNCONFIGURED',
            `Second consecutive detention requires split-term classroom mapping (Term 1: Junior Cohort; Terms 2 & 3: Original Cohort), but original batch or its immediate junior cohort link is not configured.`
          ),
          proposedDetentionStage: 2,
          subjectsEvaluatedCount: aggregatedMap.size,
          subjectsPassed: passedSubjects,
          subjectsOutstanding: failedSubjects,
        };
      }

      const term1Target: ClassroomTermTarget = {
        batchId: juniorCohort.id,
        batchCode: juniorCohort.code,
        batchName: juniorCohort.name,
        relationship: 'JUNIOR_COHORT',
      };
      const origTarget: ClassroomTermTarget = {
        batchId: origBatch.id,
        batchCode: origBatch.code,
        batchName: origBatch.name,
        relationship: 'ORIGINAL_COHORT',
      };

      return {
        workflowState: durationCheck.exceedsLimit ? 'PENDING_OFFICE_REVIEW' : 'PROPOSED',
        proposedStatus: 'DOUBLE_DETAINED_SPLIT_TERM',
        placementRuleApplied: `${triggerRulePrefix}_STAGE_2_SPLIT_TERM`,
        previousProfessionalYear: prevProfYear,
        proposedProfessionalYear: evalYear,
        previousPlacementBatchId: prevBatchId,
        proposedPlacementBatchId: juniorCohort.id,
        previousDetentionStage: prevDetention,
        proposedDetentionStage: 2,
        subjectsEvaluatedCount: aggregatedMap.size,
        subjectsPassed: passedSubjects,
        subjectsOutstanding: failedSubjects,
        classroomMapping: {
          mode: 'SPLIT_TERM',
          term1: term1Target,
          term2: origTarget,
          term3: origTarget,
          summary: `Split-Term Routing: Term 1 with ${juniorCohort.name} (Junior Cohort) · Terms 2 & 3 with ${origBatch.name} (Original Cohort)`,
        },
        supplementaryCycleNote: suppCycleNote,
        reviewIssueExplanation: durationCheck.exceedsLimit
          ? `Student has reached/exceeded the configured ${maxCourseDurationYears}-year maximum course duration (${durationCheck.elapsedYears} yrs). Review required before confirmation.`
          : null,
        maxDurationYearsSnapshot: maxCourseDurationYears,
        exceedsMaxDurationFlag: durationCheck.exceedsLimit,
        elapsedYearsFromAdmission: durationCheck.elapsedYears,
        admissionDateRequiresVerification: durationCheck.requiresVerification,
      };
    }

    // Stage 3+: Third and subsequent detention stages -> Subsequent junior cohort, NO split-term mapping!
    // Steps down from original cohort: Stage 3 -> 2nd junior cohort (subsequent to Stage 2's junior cohort), Stage 4 -> 3rd junior cohort, etc.
    const stepsDown = nextStage - 1;
    const subsequentJunior = walkJuniorBatchChain(origBatchId, stepsDown, batchMap);
    if (!subsequentJunior) {
      return {
        ...makeReviewFallback(
          'SUBSEQUENT_JUNIOR_BATCH_UNCONFIGURED',
          `Detention stage ${nextStage} requires full placement in the subsequent junior cohort (${stepsDown} cohorts after original batch), which is not yet configured in Academic Batches.`
        ),
        proposedDetentionStage: nextStage,
        subjectsEvaluatedCount: aggregatedMap.size,
        subjectsPassed: passedSubjects,
        subjectsOutstanding: failedSubjects,
      };
    }

    const fullJuniorTarget: ClassroomTermTarget = {
      batchId: subsequentJunior.id,
      batchCode: subsequentJunior.code,
      batchName: subsequentJunior.name,
      relationship: 'SUBSEQUENT_JUNIOR_COHORT',
    };

    return {
      workflowState: durationCheck.exceedsLimit ? 'PENDING_OFFICE_REVIEW' : 'PROPOSED',
      proposedStatus: 'JUNIOR_TIMELINE_PLACEMENT',
      placementRuleApplied: `${triggerRulePrefix}_STAGE_${nextStage}_SUBSEQUENT_JUNIOR_FULL`,
      previousProfessionalYear: prevProfYear,
      proposedProfessionalYear: evalYear,
      previousPlacementBatchId: prevBatchId,
      proposedPlacementBatchId: subsequentJunior.id,
      previousDetentionStage: prevDetention,
      proposedDetentionStage: nextStage,
      subjectsEvaluatedCount: aggregatedMap.size,
      subjectsPassed: passedSubjects,
      subjectsOutstanding: failedSubjects,
      classroomMapping: {
        mode: 'FULL_JUNIOR_COHORT',
        term1: fullJuniorTarget,
        term2: fullJuniorTarget,
        term3: fullJuniorTarget,
        summary: `Full Subsequent Junior Cohort Placement: All terms (1, 2, 3) with ${subsequentJunior.name} (No split-term mapping)`,
      },
      supplementaryCycleNote: suppCycleNote,
      reviewIssueExplanation: durationCheck.exceedsLimit
        ? `Student has reached/exceeded the configured ${maxCourseDurationYears}-year maximum course duration (${durationCheck.elapsedYears} yrs). Review required before confirmation.`
        : null,
      maxDurationYearsSnapshot: maxCourseDurationYears,
      exceedsMaxDurationFlag: durationCheck.exceedsLimit,
      elapsedYearsFromAdmission: durationCheck.elapsedYears,
      admissionDateRequiresVerification: durationCheck.requiresVerification,
    };
  };

  // Evaluate based on REGULAR vs SUPPLEMENTARY examination attempt
  if (examAttemptType === 'REGULAR') {
    // Rule 1: Regular examination with 0 failed subjects
    if (failedCount === 0) {
      const isFinalProfYear = evalYear >= maxProfYears;
      const nextProfYear = isFinalProfYear ? maxProfYears : evalYear + 1;
      const nextStatus = isFinalProfYear ? 'ELIGIBLE_FOR_INTERNSHIP' : 'PASSED_AND_PROMOTED';
      const ruleName = isFinalProfYear
        ? 'REGULAR_EXAM_ALL_PASSED_ELIGIBLE_FOR_INTERNSHIP'
        : 'REGULAR_EXAM_ALL_PASSED_NORMAL_PROMOTION';

      // If student was previously in split-term (Stage 2) and cleared everything, restore coherent cohort mapping
      const activeCohort = prevDetention === 2 && origBatch ? origBatch : currBatch;

      return {
        workflowState: durationCheck.exceedsLimit ? 'PENDING_OFFICE_REVIEW' : 'PROPOSED',
        proposedStatus: nextStatus,
        placementRuleApplied: ruleName,
        previousProfessionalYear: prevProfYear,
        proposedProfessionalYear: nextProfYear,
        previousPlacementBatchId: prevBatchId,
        proposedPlacementBatchId: activeCohort?.id ?? prevBatchId,
        previousDetentionStage: prevDetention,
        proposedDetentionStage: prevDetention,
        subjectsEvaluatedCount: aggregatedMap.size,
        subjectsPassed: passedSubjects,
        subjectsOutstanding: [],
        classroomMapping: standardMapping(activeCohort),
        supplementaryCycleNote: null,
        reviewIssueExplanation: durationCheck.exceedsLimit
          ? `Student has reached/exceeded the configured ${maxCourseDurationYears}-year maximum course duration (${durationCheck.elapsedYears} yrs). Review required before confirmation.`
          : null,
        maxDurationYearsSnapshot: maxCourseDurationYears,
        exceedsMaxDurationFlag: durationCheck.exceedsLimit,
        elapsedYearsFromAdmission: durationCheck.elapsedYears,
        admissionDateRequiresVerification: durationCheck.requiresVerification,
      };
    }

    // Rule 2: Regular examination with 1 or 2 failed subjects -> Provisional progression with backlogs (where permitted)
    if (
      scheme.allow_provisional_promotion &&
      failedCount >= 1 &&
      failedCount <= scheme.regular_pass_max_failed_for_provisional
    ) {
      if (evalYear >= maxProfYears) {
        // Final professional year requires clearing subjects before internship starts
        return {
          workflowState: durationCheck.exceedsLimit ? 'PENDING_OFFICE_REVIEW' : 'PROPOSED',
          proposedStatus: 'SUPPLEMENTARY_PENDING',
          placementRuleApplied: 'FINAL_PROF_BACKLOGS_SUPPLEMENTARY_REQUIRED_BEFORE_INTERNSHIP',
          previousProfessionalYear: prevProfYear,
          proposedProfessionalYear: evalYear,
          previousPlacementBatchId: prevBatchId,
          proposedPlacementBatchId: prevBatchId,
          previousDetentionStage: prevDetention,
          proposedDetentionStage: prevDetention,
          subjectsEvaluatedCount: aggregatedMap.size,
          subjectsPassed: passedSubjects,
          subjectsOutstanding: failedSubjects,
          classroomMapping: standardMapping(currBatch),
          supplementaryCycleNote: suppCycleNote,
          reviewIssueExplanation: durationCheck.exceedsLimit
            ? `Student has reached/exceeded the configured ${maxCourseDurationYears}-year maximum course duration (${durationCheck.elapsedYears} yrs).`
            : null,
          maxDurationYearsSnapshot: maxCourseDurationYears,
          exceedsMaxDurationFlag: durationCheck.exceedsLimit,
          elapsedYearsFromAdmission: durationCheck.elapsedYears,
          admissionDateRequiresVerification: durationCheck.requiresVerification,
        };
      }

      return {
        workflowState: durationCheck.exceedsLimit ? 'PENDING_OFFICE_REVIEW' : 'PROPOSED',
        proposedStatus: 'PROVISIONALLY_PROMOTED_WITH_BACKLOGS',
        placementRuleApplied: 'REGULAR_EXAM_1_TO_2_FAILED_PROVISIONAL_PROMOTION',
        previousProfessionalYear: prevProfYear,
        proposedProfessionalYear: evalYear + 1,
        previousPlacementBatchId: prevBatchId,
        proposedPlacementBatchId: prevBatchId,
        previousDetentionStage: prevDetention,
        proposedDetentionStage: prevDetention,
        subjectsEvaluatedCount: aggregatedMap.size,
        subjectsPassed: passedSubjects,
        subjectsOutstanding: failedSubjects,
        classroomMapping: standardMapping(currBatch),
        supplementaryCycleNote: suppCycleNote,
        reviewIssueExplanation: durationCheck.exceedsLimit
          ? `Student has reached/exceeded the configured ${maxCourseDurationYears}-year maximum course duration (${durationCheck.elapsedYears} yrs).`
          : null,
        maxDurationYearsSnapshot: maxCourseDurationYears,
        exceedsMaxDurationFlag: durationCheck.exceedsLimit,
        elapsedYearsFromAdmission: durationCheck.elapsedYears,
        admissionDateRequiresVerification: durationCheck.requiresVerification,
      };
    }

    // Rule 3: Regular examination with 3 or more failed subjects (or provisional disallowed) -> Detention!
    return buildDetentionOutcome(prevDetention + 1, 'REGULAR_EXAM_3_PLUS_FAILED_DETENTION');
  }

  // SUPPLEMENTARY examination attempt (Rule 4)
  if (failedCount === 0) {
    // Cleared all supplementary / backlog subjects!
    const isFinalProfYear = evalYear >= maxProfYears;
    const nextProfYear = isFinalProfYear ? maxProfYears : Math.max(prevProfYear, evalYear + 1);
    const nextStatus = isFinalProfYear ? 'ELIGIBLE_FOR_INTERNSHIP' : 'PASSED_AND_PROMOTED';
    // If student was in Stage 2 split-term and cleared backlogs, Terms 2 & 3 were already with original cohort
    const targetBatch = prevDetention === 2 && origBatch ? origBatch : currBatch;

    return {
      workflowState: durationCheck.exceedsLimit ? 'PENDING_OFFICE_REVIEW' : 'PROPOSED',
      proposedStatus: nextStatus,
      placementRuleApplied: isFinalProfYear
        ? 'SUPPLEMENTARY_CLEARED_ELIGIBLE_FOR_INTERNSHIP'
        : 'SUPPLEMENTARY_CLEARED_PROMOTED',
      previousProfessionalYear: prevProfYear,
      proposedProfessionalYear: nextProfYear,
      previousPlacementBatchId: prevBatchId,
      proposedPlacementBatchId: targetBatch?.id ?? prevBatchId,
      previousDetentionStage: prevDetention,
      proposedDetentionStage: prevDetention,
      subjectsEvaluatedCount: aggregatedMap.size,
      subjectsPassed: passedSubjects,
      subjectsOutstanding: [],
      classroomMapping: standardMapping(targetBatch),
      supplementaryCycleNote: null,
      reviewIssueExplanation: durationCheck.exceedsLimit
        ? `Student has reached/exceeded the configured ${maxCourseDurationYears}-year maximum course duration (${durationCheck.elapsedYears} yrs).`
        : null,
      maxDurationYearsSnapshot: maxCourseDurationYears,
      exceedsMaxDurationFlag: durationCheck.exceedsLimit,
      elapsedYearsFromAdmission: durationCheck.elapsedYears,
      admissionDateRequiresVerification: durationCheck.requiresVerification,
    };
  }

  // Rule 4: Failure to clear a supplementary attempt -> Detention event!
  // Determine next placement stage from the student's recorded progression history.
  return buildDetentionOutcome(prevDetention + 1, 'SUPPLEMENTARY_ATTEMPT_FAILURE_DETENTION');
}

// ============================================================================
// CSV TEMPLATE, RFC-4180 PARSER & SERIALIZER (Section 10)
// ============================================================================

export const STUDENT_CSV_HEADERS = [
  'batch_code',
  'full_name',
  'university_recorded_name',
  'date_of_birth',
  'gender',
  'nationality',
  'contact_phone',
  'contact_email',
  'father_name',
  'father_phone',
  'mother_name',
  'mother_phone',
  'emergency_contact_name',
  'emergency_contact_relationship',
  'emergency_contact_phone',
  'admission_academic_year',
  'admission_date',
  'admission_quota',
  'seat_category',
  'reservation_details',
  'neet_roll_number',
  'neet_score',
  'kea_acknowledgement_no',
  'admission_order_ref',
  'admission_status',
  'qualifying_exam',
  'qualifying_board',
  'qualifying_year',
  'qualifying_marks_percentage',
  'state',
  'district',
  'city_town',
  'pin_code',
  'permanent_address',
  'permanent_university_number',
] as const;

export function parseCsvContent(rawText: string): { headers: string[]; rows: Record<string, string>[] } {
  const cleaned = rawText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parsedLines: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inQuotes) {
      if (ch === '"') {
        if (cleaned[i + 1] === '"') {
          currentCell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (ch === '\n') {
        currentRow.push(currentCell.trim());
        currentCell = '';
        if (currentRow.some((cell) => cell !== '')) {
          parsedLines.push(currentRow);
        }
        currentRow = [];
      } else {
        currentCell += ch;
      }
    }
  }

  if (currentCell !== '' || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((cell) => cell !== '')) {
      parsedLines.push(currentRow);
    }
  }

  if (parsedLines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = parsedLines[0].map((h) => h.trim().toLowerCase());
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < parsedLines.length; r++) {
    const vals = parsedLines[r];
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = vals[idx] !== undefined ? vals[idx].trim() : '';
    });
    rows.push(obj);
  }

  return { headers, rows };
}

export function serializeCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const escapeCell = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCell(row[h])).join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}
