import type { StudentFullProfileResponse } from './studentTypes';

export type StudentProfileSummary = StudentFullProfileResponse['student'];
export type ProgressionHistoryEntry = StudentFullProfileResponse['progressionHistory'][number];

const VERIFIED_DETENTION_STATUSES = new Set([
  'DETAINED_ODD_BATCH',
  'DOUBLE_DETAINED_SPLIT_TERM',
  'JUNIOR_TIMELINE_PLACEMENT',
]);

const BASELINE_ENROLLMENT_EVENT_TYPES = new Set([
  'INITIAL_ENROLLMENT',
  'LEGACY_RS6_RECORD',
]);

export interface ProgressionViewState {
  /** True when progression or result evaluation is flagged for Office review */
  isPendingOfficeReview: boolean;
  /** True when admission status itself is unconfirmed (APPLIED / PROVISIONAL) */
  hasPendingAdmissionConfirmation: boolean;
  /** True when any progression/admission review callout should be rendered */
  showPendingReviewSection: boolean;
  /** Active PENDING_OFFICE_REVIEW events requiring documented Office resolution */
  pendingReviewEvents: ProgressionHistoryEntry[];
  /** Active PROPOSED events awaiting Office confirmation */
  proposedEvents: ProgressionHistoryEntry[];
  /** Show Original Admission Batch only when it differs from Current Placement or detention/split-term applies */
  showOriginalBatch: boolean;
  /** Show Detention Stage only when verified detention records exist (never inferred from batch name) */
  showDetentionStage: boolean;
  /** Show Routing Mode only when non-standard classroom routing applies */
  showRoutingMode: boolean;
  /** Show Term 1 / Term 2 / Term 3 cohort cards only when verified split-term / distinct term mapping applies */
  showSplitTermCards: boolean;
  /** Show Outstanding Subjects section only when verified backlog count > 0 */
  showOutstandingSubjects: boolean;
  /** Verified outstanding subject entries from the latest confirmed progression record, if recorded */
  outstandingSubjects: Array<{ code: string; name: string; reason?: string }>;
  /** Concise post-enrollment progression history items (excludes baseline initial registration noise) */
  historyEvents: ProgressionHistoryEntry[];
  /** Show Progression History card only when meaningful history exists */
  showProgressionHistory: boolean;
}

function isRedundantBaselineEvent(ev: ProgressionHistoryEntry): boolean {
  return (
    BASELINE_ENROLLMENT_EVENT_TYPES.has(ev.eventType) &&
    ev.workflowState === 'CONFIRMED' &&
    ev.proposedDetentionStage === 0 &&
    (!ev.subjectsOutstanding || ev.subjectsOutstanding.length === 0) &&
    (!ev.classroomMapping || ev.classroomMapping.mode === 'STANDARD_COHORT')
  );
}

/**
 * Computes conditional UI visibility flags for Student Management -> Student Profile -> Academic Progression
 * strictly from verified progression, detention, backlog, and classroom-mapping records.
 * Never infers detention from batch names and never mutates underlying progression logic.
 */
export function deriveProgressionViewState(
  student: StudentProfileSummary,
  progressionHistory: ProgressionHistoryEntry[]
): ProgressionViewState {
  const pendingReviewEvents = progressionHistory.filter(
    (ev) => ev.workflowState === 'PENDING_OFFICE_REVIEW'
  );
  const proposedEvents = progressionHistory.filter(
    (ev) => ev.workflowState === 'PROPOSED'
  );

  const isPendingOfficeReview =
    student.progressionStatus === 'PENDING_OFFICE_REVIEW' ||
    pendingReviewEvents.length > 0;

  const hasPendingAdmissionConfirmation =
    student.admissionStatus === 'APPLIED' ||
    student.administrativeStatus === 'ADMISSION_PENDING';

  const showPendingReviewSection =
    isPendingOfficeReview || hasPendingAdmissionConfirmation;

  const hasVerifiedDetention =
    student.detentionStage > 0 ||
    VERIFIED_DETENTION_STATUSES.has(student.progressionStatus);

  const mapping = student.classroomMapping;
  const hasDistinctTermCohorts = Boolean(
    mapping &&
      (mapping.mode === 'SPLIT_TERM' ||
        mapping.term1.batchId !== mapping.term2.batchId ||
        mapping.term2.batchId !== mapping.term3.batchId ||
        mapping.term1.batchName !== mapping.term2.batchName ||
        mapping.term2.batchName !== mapping.term3.batchName)
  );

  // When pending Office review, suppress speculative/unrelated detention and split-term panels
  const showDetentionStage = !isPendingOfficeReview && hasVerifiedDetention;
  const showSplitTermCards = !isPendingOfficeReview && hasDistinctTermCohorts;
  const showRoutingMode = Boolean(
    !isPendingOfficeReview && mapping && mapping.mode !== 'STANDARD_COHORT'
  );

  const hasDifferentBatchIds =
    student.originalBatchId !== null &&
    student.currentPlacementBatchId !== null &&
    student.originalBatchId !== student.currentPlacementBatchId;

  const hasDifferentBatchNames =
    Boolean(student.originalBatchName) &&
    Boolean(student.currentPlacementBatchName) &&
    student.originalBatchName !== student.currentPlacementBatchName;

  const showOriginalBatch =
    hasDifferentBatchIds ||
    hasDifferentBatchNames ||
    showDetentionStage ||
    showSplitTermCards;

  const showOutstandingSubjects =
    !isPendingOfficeReview && Number(student.outstandingBacklogsCount || 0) > 0;

  const latestConfirmedEvent =
    progressionHistory.find((ev) => ev.workflowState === 'CONFIRMED') || null;
  const outstandingSubjects =
    showOutstandingSubjects && latestConfirmedEvent?.subjectsOutstanding?.length
      ? latestConfirmedEvent.subjectsOutstanding
      : [];

  const historyEvents = progressionHistory.filter(
    (ev) =>
      ev.workflowState !== 'PENDING_OFFICE_REVIEW' &&
      ev.workflowState !== 'PROPOSED' &&
      !isRedundantBaselineEvent(ev)
  );

  return {
    isPendingOfficeReview,
    hasPendingAdmissionConfirmation,
    showPendingReviewSection,
    pendingReviewEvents,
    proposedEvents,
    showOriginalBatch,
    showDetentionStage,
    showRoutingMode,
    showSplitTermCards,
    showOutstandingSubjects,
    outstandingSubjects,
    historyEvents,
    showProgressionHistory: historyEvents.length > 0,
  };
}
