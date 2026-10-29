import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  FileCheck2,
  SlidersHorizontal,
  History,
  AlertTriangle,
  X,
  Filter,
  ShieldCheck,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';

export interface ReviewBatchOption {
  id: number;
  code: string;
  name: string;
  admissionAcademicYear: string;
  currentCohortStage: string;
  currentProfessionalYear?: number | null;
  schemeCode?: string | null;
  isLegacyMinimal?: boolean;
}

export interface ReviewSubjectOption {
  id: number;
  code: string;
  name: string;
  professionalYear: number;
  schemeCode?: string | null;
  departmentId: number | null;
  departmentName: string | null;
  iaMaximum: number;
  isIaEnabled: boolean;
  iaCalculationRule: string;
  iaFormulaVerified: boolean;
  patMappingVerified: boolean;
}

function isReviewSubjectCompatibleWithBatch(
  subject: ReviewSubjectOption,
  batch: ReviewBatchOption | undefined
): boolean {
  if (!batch) return false;
  if (batch.isLegacyMinimal || batch.schemeCode === 'RS6') return false;
  const subjScheme = subject.schemeCode || 'RS7';
  if (batch.schemeCode && subjScheme !== batch.schemeCode) return false;
  const batchProfYear = Number(batch.currentProfessionalYear);
  if (!Number.isInteger(batchProfYear) || batchProfYear <= 0) return false;
  return Number(subject.professionalYear) === batchProfYear;
}

export interface ReviewDepartmentOption {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
}

interface RawAssessmentEntry {
  assessmentId: number;
  assessmentCode: string;
  assessmentName: string;
  assessmentType: 'PAT' | 'TERM_TEST' | 'UNIVERSITY_EXAM';
  termNumber: number;
  outcome: 'MARKS_ENTERED' | 'ABSENT' | 'NOT_APPEARED' | 'EXEMPTED';
  theoryMarks: number | null;
  practicalMarks: number | null;
  submittedAt: string | null;
}

interface TermTestConversionItem {
  assessmentId: number;
  assessmentCode: string;
  assessmentName: string;
  termNumber: number;
  outcome: string;
  rawTheoryMarks: number | null;
  rawPracticalMarks: number | null;
  combinedRawMarks: number | null;
  conversionMaximum: number;
  convertedMarks: number | null;
  conversionStatus: string;
  statusReason: string | null;
}

interface StudentApprovalDetail {
  id: number;
  iaMaximum: number;
  automaticIaAtApproval: number;
  approvedFinalIa: number;
  approvalType: 'APPROVED_AS_CALCULATED' | 'MANUAL_ADJUSTMENT';
  finalStatus: 'APPROVED' | 'ADJUSTED_APPROVED' | 'REQUIRES_REVIEW';
  requiresOfficeReview: boolean;
  reviewFlagReason: string | null;
  reasonCategory: string | null;
  explanation: string | null;
  approvedById: number;
  approvedByName: string;
  approvedAt: string;
  updatedAt: string;
}

interface StudentFinalIaHistoryItem {
  id: number;
  actionType: 'APPROVED_AS_CALCULATED' | 'MANUAL_ADJUSTMENT' | 'FLAGGED_FOR_REVIEW_ON_RECALC';
  previousFinalIa: number | null;
  newFinalIa: number;
  automaticIaValue: number | null;
  reasonCategory: string | null;
  explanation: string | null;
  actorId: number | null;
  actorName: string;
  createdAt: string;
}

interface OfficeReviewStudentRow {
  studentId: number;
  studentIdNumber: string;
  temporaryRollNumber: string;
  permanentUniversityNumber: string | null;
  fullName: string;
  administrativeStatus: string;
  iaMaximum: number | null;
  rawAssessments: Record<string, RawAssessmentEntry>;
  termTestConversions: TermTestConversionItem[];
  calculation: {
    calculationStatus: 'CALCULATED' | 'PENDING' | 'NOT_APPLICABLE';
    statusReason: string | null;
    finalAutomaticIa: number | null;
    term1: { A: number | null; B: number | null; C: number | null; D: number | null; E: number | null; F: number | null; H: number | null };
    term2: { A: number | null; B: number | null; C: number | null; D: number | null; E: number | null; F: number | null; H: number | null };
    term3: { A: number | null; B: number | null; C: number | null; D: number | null; E: number | null; H: number | null };
    sourceAssessments: {
      patMappingVerified: boolean;
      patMapping?: {
        term1: { A: string; B: string; C: string };
        term2: { A: string; B: string; C: string };
        term3: { A: string; B: string; C: string };
      } | null;
      submittedCodes: string[];
      usedInCalculation: string[];
      missingRequiredCodes: string[];
    } | null;
    calculatedAt: string;
  };
  approval: StudentApprovalDetail | null;
  currentFinalStatus:
    | 'NOT_APPLICABLE'
    | 'PENDING_CALCULATION'
    | 'AWAITING_APPROVAL'
    | 'APPROVED'
    | 'ADJUSTED_APPROVED'
    | 'REQUIRES_REVIEW';
  officeReviewRequired: boolean;
  officeReviewReason: string | null;
  canApproveOrAdjust: boolean;
  history: StudentFinalIaHistoryItem[];
}

interface ReasonCategoryOption {
  code: string;
  label: string;
  description: string;
}

interface OfficeIaReviewPanelProps {
  batches: ReviewBatchOption[];
  subjects: ReviewSubjectOption[];
  departments: ReviewDepartmentOption[];
  selectedBatchId: number | '';
  selectedSubjectId: number | '';
  onSelectBatch: (batchId: number) => void;
  onSelectSubject: (subjectId: number | '') => void;
  csrfToken: string | null;
}

const PAT_CODES = ['PAT_1', 'PAT_2', 'PAT_3', 'PAT_4', 'PAT_5', 'PAT_6', 'PAT_7', 'PAT_8', 'PAT_9'] as const;

function formatNum(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return '—';
  return Number(val).toFixed(2);
}

function formatRawPatCompact(entry?: RawAssessmentEntry): string {
  if (!entry) return '—';
  if (entry.outcome === 'ABSENT') return 'AB(0)';
  if (entry.outcome === 'NOT_APPEARED') return 'NA';
  if (entry.outcome === 'EXEMPTED') return 'EX';
  return entry.theoryMarks !== null ? String(entry.theoryMarks) : '—';
}

function formatRawTermTestCompact(entry?: RawAssessmentEntry): string {
  if (!entry) return 'Not Submitted';
  if (entry.outcome === 'ABSENT') return 'Absent (0 + 0)';
  if (entry.outcome === 'NOT_APPEARED') return 'Not Appeared';
  if (entry.outcome === 'EXEMPTED') return 'Exempted';
  return `Th ${entry.theoryMarks ?? '—'} + Pr ${entry.practicalMarks ?? '—'}`;
}

function formatStatusLabel(status: OfficeReviewStudentRow['currentFinalStatus']): string {
  switch (status) {
    case 'APPROVED':
      return 'Approved (Auto IA)';
    case 'ADJUSTED_APPROVED':
      return 'Approved (Adjusted)';
    case 'REQUIRES_REVIEW':
      return 'Re-Review Required';
    case 'AWAITING_APPROVAL':
      return 'Awaiting Approval';
    case 'PENDING_CALCULATION':
      return 'Pending Calculation';
    case 'NOT_APPLICABLE':
      return 'Not Applicable';
    default:
      return status;
  }
}

export const OfficeIaReviewPanel: React.FC<OfficeIaReviewPanelProps> = ({
  batches,
  subjects,
  departments,
  selectedBatchId,
  selectedSubjectId,
  onSelectBatch,
  onSelectSubject,
  csrfToken,
}) => {
  const [profYearFilter, setProfYearFilter] = useState<string>('ALL');
  const [departmentFilter, setDepartmentFilter] = useState<string>('ALL');
  const [reviewStateFilter, setReviewStateFilter] = useState<string>('ALL');

  const [students, setStudents] = useState<OfficeReviewStudentRow[]>([]);
  const [reasonCategories, setReasonCategories] = useState<ReasonCategoryOption[]>([]);
  const [subjectMeta, setSubjectMeta] = useState<any | null>(null);
  const [batchMeta, setBatchMeta] = useState<any | null>(null);
  const [summary, setSummary] = useState<{
    totalStudents: number;
    calculatedCount: number;
    pendingCount: number;
    notApplicableCount: number;
    approvedCount: number;
    adjustedCount: number;
    awaitingApprovalCount: number;
    requiresReReviewCount: number;
  } | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Approve confirmation modal state
  const [approveTarget, setApproveTarget] = useState<OfficeReviewStudentRow | null>(null);
  const [isApproving, setIsApproving] = useState(false);

  // Manual Adjustment modal state
  const [adjustTarget, setAdjustTarget] = useState<OfficeReviewStudentRow | null>(null);
  const [adjustedMarkInput, setAdjustedMarkInput] = useState<string>('');
  const [selectedReasonCategory, setSelectedReasonCategory] = useState<string>('ACADEMIC_EXCELLENCE');
  const [explanationInput, setExplanationInput] = useState<string>('');
  const [isAdjusting, setIsAdjusting] = useState(false);

  // Calculation Breakdown & History modal state
  const [detailTarget, setDetailTarget] = useState<OfficeReviewStudentRow | null>(null);

  const currentBatch = useMemo(
    () => batches.find((b) => b.id === selectedBatchId),
    [batches, selectedBatchId]
  );

  // Filter batches by Professional Year when selected
  const filteredBatches = useMemo(() => {
    if (profYearFilter === 'ALL') return batches;
    return batches.filter(
      (b) =>
        !b.isLegacyMinimal &&
        b.schemeCode !== 'RS6' &&
        Number(b.currentProfessionalYear) === Number(profYearFilter)
    );
  }, [batches, profYearFilter]);

  // Filter subjects by selected batch's scheme + currentProfessionalYear, plus optional Professional Year & Department filters
  const filteredSubjects = useMemo(() => {
    return subjects.filter((s) => {
      if (!isReviewSubjectCompatibleWithBatch(s, currentBatch)) {
        return false;
      }
      if (profYearFilter !== 'ALL' && Number(s.professionalYear) !== Number(profYearFilter)) {
        return false;
      }
      if (departmentFilter === 'UNASSIGNED') {
        return s.departmentId === null;
      }
      if (departmentFilter !== 'ALL' && Number(s.departmentId) !== Number(departmentFilter)) {
        return false;
      }
      return true;
    });
  }, [subjects, currentBatch, profYearFilter, departmentFilter]);

  // Keep selectedBatchId synchronized if Professional Year filter narrows out the active batch
  useEffect(() => {
    if (filteredBatches.length > 0) {
      const batchStillPresent = filteredBatches.some((b) => b.id === selectedBatchId);
      if (!batchStillPresent) {
        onSelectBatch(filteredBatches[0].id);
      }
    }
  }, [filteredBatches, selectedBatchId, onSelectBatch]);

  // Keep selectedSubjectId synchronized if batch/filters narrow out the active subject
  useEffect(() => {
    if (filteredSubjects.length > 0) {
      const stillPresent = filteredSubjects.some((s) => s.id === selectedSubjectId);
      if (!stillPresent) {
        onSelectSubject(filteredSubjects[0].id);
      }
    } else if (selectedSubjectId !== '') {
      onSelectSubject('');
    }
  }, [filteredSubjects, selectedSubjectId, onSelectSubject]);

  const loadOfficeReview = useCallback(async () => {
    if (!selectedBatchId || !selectedSubjectId) {
      setStudents([]);
      setSummary(null);
      setSubjectMeta(null);
      setBatchMeta(null);
      return;
    }

    const batchObj = batches.find((b) => b.id === selectedBatchId);
    const subjectObj = subjects.find((s) => s.id === selectedSubjectId);
    if (
      !batchObj ||
      !subjectObj ||
      !isReviewSubjectCompatibleWithBatch(subjectObj, batchObj) ||
      !filteredSubjects.some((s) => s.id === subjectObj.id)
    ) {
      setStudents([]);
      setSummary(null);
      setSubjectMeta(null);
      setBatchMeta(null);
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/internal-assessment/office-review?batchId=${selectedBatchId}&subjectId=${selectedSubjectId}`
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStudents(data.students || []);
        setReasonCategories(data.reasonCategories || []);
        setSubjectMeta(data.subject || null);
        setBatchMeta(data.batch || null);
        setSummary(data.reviewSummary || null);
      } else {
        setNotice({
          type: 'error',
          message: data.error || 'Failed to load Office IA Review records.',
        });
      }
    } catch {
      setNotice({ type: 'error', message: 'Network error loading Office IA Review records.' });
    } finally {
      setIsLoading(false);
    }
  }, [selectedBatchId, selectedSubjectId, batches, subjects, filteredSubjects]);

  useEffect(() => {
    loadOfficeReview();
  }, [loadOfficeReview]);

  const visibleStudents = useMemo(() => {
    return students.filter((st) => {
      if (reviewStateFilter === 'REVIEW_REQUIRED') return st.officeReviewRequired;
      if (reviewStateFilter === 'RECALC_FLAGGED') return st.currentFinalStatus === 'REQUIRES_REVIEW';
      if (reviewStateFilter === 'AWAITING_APPROVAL') return st.currentFinalStatus === 'AWAITING_APPROVAL';
      if (reviewStateFilter === 'FINALIZED') {
        return st.currentFinalStatus === 'APPROVED' || st.currentFinalStatus === 'ADJUSTED_APPROVED';
      }
      if (reviewStateFilter === 'PENDING') {
        return st.currentFinalStatus === 'PENDING_CALCULATION' || st.currentFinalStatus === 'NOT_APPLICABLE';
      }
      return true;
    });
  }, [students, reviewStateFilter]);

  const handleConfirmApprove = async () => {
    if (!approveTarget || !selectedBatchId || !selectedSubjectId) return;
    setIsApproving(true);
    setNotice(null);

    try {
      const res = await fetch('/api/internal-assessment/final-approval', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken || '',
        },
        body: JSON.stringify({
          batchId: selectedBatchId,
          subjectId: selectedSubjectId,
          studentId: approveTarget.studentId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setNotice({
          type: 'success',
          message: `Approved Final IA (${formatNum(data.approval?.approvedFinalIa)}) for ${approveTarget.fullName}.`,
        });
        setApproveTarget(null);
        await loadOfficeReview();
      } else {
        setNotice({ type: 'error', message: data.error || 'Failed to approve Final IA.' });
      }
    } catch {
      setNotice({ type: 'error', message: 'Network error while approving Final IA.' });
    } finally {
      setIsApproving(false);
    }
  };

  const openAdjustModal = (row: OfficeReviewStudentRow) => {
    setAdjustTarget(row);
    const defaultVal =
      row.approval?.approvedFinalIa !== undefined && row.approval?.approvedFinalIa !== null
        ? String(row.approval.approvedFinalIa)
        : row.calculation.finalAutomaticIa !== null
          ? String(row.calculation.finalAutomaticIa)
          : '';
    setAdjustedMarkInput(defaultVal);
    setSelectedReasonCategory(row.approval?.reasonCategory || 'ACADEMIC_EXCELLENCE');
    setExplanationInput('');
  };

  const handleConfirmAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustTarget || !selectedBatchId || !selectedSubjectId) return;

    const maxAllowed = Number(subjectMeta?.iaMaximum || adjustTarget.iaMaximum || 0);
    const parsedMark = Number(adjustedMarkInput);
    if (adjustedMarkInput.trim() === '' || Number.isNaN(parsedMark) || parsedMark < 0 || parsedMark > maxAllowed) {
      setNotice({
        type: 'error',
        message: `Adjusted Final IA mark must be between 0 and ${maxAllowed}.`,
      });
      return;
    }

    if (!selectedReasonCategory) {
      setNotice({ type: 'error', message: 'Please select a reason category for manual adjustment.' });
      return;
    }

    if (!explanationInput.trim()) {
      setNotice({
        type: 'error',
        message: 'A mandatory written explanation is required for manual Final IA adjustment.',
      });
      return;
    }

    setIsAdjusting(true);
    setNotice(null);

    try {
      const res = await fetch('/api/internal-assessment/manual-adjustment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken || '',
        },
        body: JSON.stringify({
          batchId: selectedBatchId,
          subjectId: selectedSubjectId,
          studentId: adjustTarget.studentId,
          adjustedFinalIa: parsedMark,
          reasonCategory: selectedReasonCategory,
          explanation: explanationInput.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setNotice({
          type: 'success',
          message: `Recorded adjusted Final IA (${formatNum(data.approval?.approvedFinalIa)}) for ${adjustTarget.fullName}. Automatic IA remains preserved separately.`,
        });
        setAdjustTarget(null);
        await loadOfficeReview();
      } else {
        setNotice({ type: 'error', message: data.error || 'Failed to save manual Final IA adjustment.' });
      }
    } catch {
      setNotice({ type: 'error', message: 'Network error while saving manual Final IA adjustment.' });
    } finally {
      setIsAdjusting(false);
    }
  };

  const reasonLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of reasonCategories) {
      map.set(r.code, r.label);
    }
    map.set('SOURCE_MARK_RECALCULATION', 'Source Assessment Recalculation');
    return map;
  }, [reasonCategories]);

  return (
    <div className="space-y-4">
      {notice && (
        <div
          className={`p-3.5 rounded-lg border text-xs flex items-center justify-between gap-3 ${
            notice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
          role="alert"
        >
          <div className="flex items-center gap-2.5">
            {notice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{notice.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-stone-500 hover:text-stone-800 cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Office IA Review Filters */}
      <Card accentTop>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#4B2E2E]/10 text-[#4B2E2E] flex items-center justify-center">
                <Filter className="w-4 h-4" />
              </div>
              <div>
                <CardTitle>Office IA Review &amp; Final Approval Filters</CardTitle>
                <CardDescription>
                  Filter by academic batch, professional year, department, and curriculum subject.
                </CardDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              icon={<RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />}
              onClick={loadOfficeReview}
            >
              Refresh Review Ledger
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            <div>
              <label className="block text-xs font-semibold text-stone-800 mb-1">Professional Year</label>
              <select
                value={profYearFilter}
                onChange={(e) => setProfYearFilter(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 min-h-[38px]"
              >
                <option value="ALL">All Professional Years</option>
                <option value="1">1st Professional Year</option>
                <option value="2">2nd Professional Year</option>
                <option value="3">3rd Professional Year</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-800 mb-1">Academic Batch</label>
              <select
                value={filteredBatches.length > 0 ? selectedBatchId : ''}
                onChange={(e) => {
                  setNotice(null);
                  if (e.target.value) onSelectBatch(Number(e.target.value));
                }}
                disabled={filteredBatches.length === 0}
                className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 disabled:bg-stone-100 min-h-[38px]"
              >
                {filteredBatches.length === 0 ? (
                  <option value="">No batches in selected year</option>
                ) : (
                  filteredBatches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.admissionAcademicYear}){b.schemeCode ? ` — ${b.schemeCode}` : ''}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-800 mb-1">Department</label>
              <select
                value={departmentFilter}
                onChange={(e) => {
                  setNotice(null);
                  setDepartmentFilter(e.target.value);
                }}
                className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 min-h-[38px]"
              >
                <option value="ALL">All Departments</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
                <option value="UNASSIGNED">Unassigned Subject Department</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-800 mb-1">Subject</label>
              <select
                value={filteredSubjects.length > 0 ? selectedSubjectId : ''}
                onChange={(e) => {
                  setNotice(null);
                  onSelectSubject(e.target.value ? Number(e.target.value) : '');
                }}
                disabled={filteredSubjects.length === 0}
                className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 disabled:bg-stone-100 min-h-[38px]"
              >
                {filteredSubjects.length === 0 ? (
                  <option value="">No applicable subjects for batch/filter</option>
                ) : (
                  filteredSubjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.isIaEnabled ? `Max ${s.iaMaximum}` : 'No IA'})
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-800 mb-1">Review Filter</label>
              <select
                value={reviewStateFilter}
                onChange={(e) => setReviewStateFilter(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 min-h-[38px]"
              >
                <option value="ALL">All Students</option>
                <option value="REVIEW_REQUIRED">Office Review Required</option>
                <option value="RECALC_FLAGGED">Flagged After Recalculation</option>
                <option value="AWAITING_APPROVAL">Awaiting Initial Approval</option>
                <option value="FINALIZED">Approved / Adjusted</option>
                <option value="PENDING">Pending / Not Applicable</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Strip */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="p-3.5 rounded-xl bg-white border border-stone-200">
            <div className="text-[11px] font-medium text-stone-500">Batch Students</div>
            <div className="mt-1 text-lg font-mono tabular-nums font-bold text-stone-900">
              {summary.totalStudents}
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-white border border-stone-200">
            <div className="text-[11px] font-medium text-stone-500">Valid Calculated</div>
            <div className="mt-1 text-lg font-mono tabular-nums font-bold text-[#4B2E2E]">
              {summary.calculatedCount}
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-white border border-stone-200">
            <div className="text-[11px] font-medium text-stone-500">Awaiting Approval</div>
            <div className="mt-1 text-lg font-mono tabular-nums font-bold text-amber-700">
              {summary.awaitingApprovalCount}
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-white border border-stone-200">
            <div className="text-[11px] font-medium text-stone-500">Approved (Auto)</div>
            <div className="mt-1 text-lg font-mono tabular-nums font-bold text-emerald-700">
              {summary.approvedCount}
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-white border border-stone-200">
            <div className="text-[11px] font-medium text-stone-500">Manually Adjusted</div>
            <div className="mt-1 text-lg font-mono tabular-nums font-bold text-stone-800">
              {summary.adjustedCount}
            </div>
          </div>
          <div
            className={`p-3.5 rounded-xl border ${
              summary.requiresReReviewCount > 0
                ? 'bg-amber-50 border-amber-300'
                : 'bg-white border-stone-200'
            }`}
          >
            <div className="text-[11px] font-medium text-stone-600">Flagged on Recalc</div>
            <div
              className={`mt-1 text-lg font-mono tabular-nums font-bold ${
                summary.requiresReReviewCount > 0 ? 'text-rose-700' : 'text-stone-700'
              }`}
            >
              {summary.requiresReReviewCount}
            </div>
          </div>
        </div>
      )}

      {/* Flagged Re-Review Callout if any approved record diverged after recalculation */}
      {summary && summary.requiresReReviewCount > 0 && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold">
              Source Calculation Updated After Prior Approval ({summary.requiresReReviewCount} student
              {summary.requiresReReviewCount === 1 ? '' : 's'})
            </p>
            <p className="text-stone-700 leading-relaxed">
              Previously approved Final IA marks have been preserved without automatic overwrite. Review the updated Automatic IA alongside the preserved Final IA and explicitly re-approve or record a manual adjustment.
            </p>
          </div>
        </div>
      )}

      {/* Main Office IA Review Ledger */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-4 h-4 text-[#D4AF37]" />
              <div>
                <CardTitle>
                  Office IA Review &amp; Final Approval Ledger
                  {subjectMeta ? ` — ${subjectMeta.name}` : ''}
                </CardTitle>
                <CardDescription>
                  {batchMeta
                    ? `Batch: ${batchMeta.name} (${batchMeta.admissionAcademicYear})`
                    : 'Select batch and subject'}{' '}
                  {subjectMeta?.departmentName ? `| Department: ${subjectMeta.departmentName}` : ''}
                  {subjectMeta?.isIaEnabled ? ` | Configured IA Max: ${subjectMeta.iaMaximum}` : ' | IA Not Applicable'}
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#FAF9F5] border-b border-stone-200 text-stone-700 font-semibold text-[11px] uppercase tracking-wider">
                  <th className="py-3 px-3">Student</th>
                  <th className="py-3 px-3">Raw PAT Marks (PAT 1–9)</th>
                  <th className="py-3 px-3">Raw Term Tests &amp; Converted</th>
                  <th className="py-3 px-3 text-right">
                    Automatic IA {subjectMeta?.isIaEnabled ? `(/${subjectMeta.iaMaximum})` : ''}
                  </th>
                  <th className="py-3 px-3 text-right">Approved Final IA</th>
                  <th className="py-3 px-3">Final IA Status</th>
                  <th className="py-3 px-3">Office Review</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-stone-500">
                      <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#D4AF37]" />
                      Loading Office IA Review records...
                    </td>
                  </tr>
                ) : filteredSubjects.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-stone-500">
                      No curriculum subjects match the selected Professional Year and Department filters.
                    </td>
                  </tr>
                ) : visibleStudents.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-stone-500">
                      No student IA records match the current filter selection.
                    </td>
                  </tr>
                ) : (
                  visibleStudents.map((row) => {
                    const tt1Conv = row.termTestConversions.find((c) => c.termNumber === 1);
                    const tt2Conv = row.termTestConversions.find((c) => c.termNumber === 2);
                    const isFlaggedRecalc = row.currentFinalStatus === 'REQUIRES_REVIEW';

                    return (
                      <tr
                        key={row.studentId}
                        className={`align-top transition-colors ${
                          isFlaggedRecalc ? 'bg-amber-50/40 hover:bg-amber-50/70' : 'hover:bg-stone-50/70'
                        }`}
                      >
                        {/* Roll No & Name */}
                        <td className="py-3 px-3 min-w-[165px]">
                          <div className="font-mono tabular-nums font-semibold text-[#4B2E2E]">
                            {row.temporaryRollNumber || row.studentIdNumber}
                          </div>
                          <div className="font-medium text-stone-900 mt-0.5">{row.fullName}</div>
                          {row.permanentUniversityNumber && (
                            <div className="text-[10px] font-mono tabular-nums text-stone-500">
                              Univ: {row.permanentUniversityNumber}
                            </div>
                          )}
                        </td>

                        {/* Raw PAT Marks (PAT 1-9) */}
                        <td className="py-3 px-3 min-w-[220px]">
                          <div className="grid grid-cols-3 gap-x-2 gap-y-1 font-mono tabular-nums text-[11px]">
                            {PAT_CODES.map((code, idx) => (
                              <div key={code} className="text-stone-700 whitespace-nowrap">
                                <span className="text-stone-400">P{idx + 1}:</span>{' '}
                                <span className="font-medium text-stone-900">
                                  {formatRawPatCompact(row.rawAssessments[code])}
                                </span>
                              </div>
                            ))}
                          </div>
                        </td>

                        {/* Raw Term Tests & Converted Marks (F1, F2) */}
                        <td className="py-3 px-3 min-w-[215px] font-mono tabular-nums text-[11px]">
                          <div className="space-y-1">
                            <div>
                              <span className="text-stone-500">TT1:</span>{' '}
                              <span className="text-stone-900">
                                {formatRawTermTestCompact(row.rawAssessments['TERM_TEST_1'])}
                              </span>
                              <span className="text-stone-500"> → F1: </span>
                              <span className="font-semibold text-[#4B2E2E]">
                                {formatNum(tt1Conv?.convertedMarks ?? row.calculation.term1.F)}
                              </span>
                            </div>
                            <div>
                              <span className="text-stone-500">TT2:</span>{' '}
                              <span className="text-stone-900">
                                {formatRawTermTestCompact(row.rawAssessments['TERM_TEST_2'])}
                              </span>
                              <span className="text-stone-500"> → F2: </span>
                              <span className="font-semibold text-[#4B2E2E]">
                                {formatNum(tt2Conv?.convertedMarks ?? row.calculation.term2.F)}
                              </span>
                            </div>
                            <div className="text-[10px] text-stone-500 pt-0.5">
                              H1: {formatNum(row.calculation.term1.H)} | H2:{' '}
                              {formatNum(row.calculation.term2.H)} | H3:{' '}
                              {formatNum(row.calculation.term3.H)}
                            </div>
                          </div>
                        </td>

                        {/* Stored Automatic IA & Calculation Status */}
                        <td className="py-3 px-3 text-right min-w-[130px]">
                          <div className="font-mono tabular-nums text-sm font-bold text-[#4B2E2E]">
                            {formatNum(row.calculation.finalAutomaticIa)}
                          </div>
                          <div className="mt-1">
                            <Badge
                              variant={
                                row.calculation.calculationStatus === 'CALCULATED'
                                  ? 'success'
                                  : row.calculation.calculationStatus === 'NOT_APPLICABLE'
                                    ? 'neutral'
                                    : 'warning'
                              }
                              size="sm"
                            >
                              {row.calculation.calculationStatus}
                            </Badge>
                          </div>
                        </td>

                        {/* Approved Final IA Mark */}
                        <td className="py-3 px-3 text-right min-w-[140px]">
                          {row.approval ? (
                            <div className="space-y-0.5">
                              <div className="font-mono tabular-nums text-sm font-bold text-stone-900">
                                {formatNum(row.approval.approvedFinalIa)}
                                <span className="text-[11px] font-normal text-stone-500">
                                  /{row.approval.iaMaximum}
                                </span>
                              </div>
                              <div className="text-[10px] font-mono tabular-nums text-stone-500">
                                Auto at approval: {formatNum(row.approval.automaticIaAtApproval)}
                              </div>
                              {row.approval.reasonCategory && (
                                <div className="text-[10px] text-stone-600">
                                  {reasonLabelMap.get(row.approval.reasonCategory) ||
                                    row.approval.reasonCategory}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="font-mono tabular-nums text-stone-400">Not Approved</span>
                          )}
                        </td>

                        {/* Current Final IA Status */}
                        <td className="py-3 px-3 min-w-[150px]">
                          <Badge
                            variant={
                              row.currentFinalStatus === 'APPROVED' ||
                              row.currentFinalStatus === 'ADJUSTED_APPROVED'
                                ? 'success'
                                : row.currentFinalStatus === 'REQUIRES_REVIEW' ||
                                    row.currentFinalStatus === 'AWAITING_APPROVAL'
                                  ? 'warning'
                                  : 'neutral'
                            }
                            size="sm"
                            className={
                              row.currentFinalStatus === 'REQUIRES_REVIEW'
                                ? '!bg-rose-50 !text-rose-800 !border-rose-200'
                                : ''
                            }
                          >
                            {formatStatusLabel(row.currentFinalStatus)}
                          </Badge>
                          {row.calculation.statusReason &&
                            row.calculation.calculationStatus !== 'CALCULATED' && (
                              <p className="text-[10px] text-stone-600 mt-1 leading-snug max-w-[200px]">
                                {row.calculation.statusReason}
                              </p>
                            )}
                        </td>

                        {/* Office Review Required */}
                        <td className="py-3 px-3 min-w-[155px]">
                          {row.officeReviewRequired ? (
                            <div className="space-y-1">
                              <Badge
                                variant="warning"
                                size="sm"
                                className={
                                  isFlaggedRecalc
                                    ? '!bg-rose-50 !text-rose-800 !border-rose-200'
                                    : ''
                                }
                              >
                                {isFlaggedRecalc ? 'Yes — Re-Review' : 'Yes — Awaiting'}
                              </Badge>
                              {row.officeReviewReason && (
                                <p className="text-[10px] text-stone-600 leading-snug max-w-[210px]">
                                  {row.officeReviewReason}
                                </p>
                              )}
                            </div>
                          ) : (
                            <Badge variant="neutral" size="sm">
                              {row.approval ? 'No — Reviewed' : 'No'}
                            </Badge>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-3 text-right min-w-[215px]">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            <Button
                              type="button"
                              variant="primary"
                              size="sm"
                              disabled={!row.canApproveOrAdjust}
                              icon={<FileCheck2 className="w-3.5 h-3.5" />}
                              onClick={() => setApproveTarget(row)}
                              className="whitespace-nowrap shrink-0"
                            >
                              Approve
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={!row.canApproveOrAdjust}
                              icon={<SlidersHorizontal className="w-3.5 h-3.5" />}
                              onClick={() => openAdjustModal(row)}
                              className="whitespace-nowrap shrink-0"
                            >
                              Adjust
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              icon={<History className="w-3.5 h-3.5" />}
                              onClick={() => setDetailTarget(row)}
                              className="whitespace-nowrap shrink-0"
                            >
                              Details ({row.history.length})
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* APPROVE FINAL IA CONFIRMATION MODAL */}
      {approveTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-md bg-white rounded-xl border border-stone-200 shadow-2xl overflow-hidden my-auto p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <div>
                <h3 className="font-serif text-base font-bold text-stone-900">
                  Approve Calculated Final IA
                </h3>
                <p className="text-xs text-stone-500">
                  Confirm official Final IA mark from verified Automatic IA
                </p>
              </div>
              <button
                type="button"
                onClick={() => setApproveTarget(null)}
                className="text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 bg-[#FAF9F5] rounded-lg border border-stone-200 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-stone-500">Student:</span>
                <span className="font-semibold text-stone-900">
                  {approveTarget.fullName} (
                  <span className="font-mono tabular-nums">
                    {approveTarget.temporaryRollNumber || approveTarget.studentIdNumber}
                  </span>
                  )
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Subject:</span>
                <span className="font-semibold text-stone-900">{subjectMeta?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Batch:</span>
                <span className="font-semibold text-stone-900">{batchMeta?.name}</span>
              </div>
              {approveTarget.approval && (
                <div className="flex justify-between">
                  <span className="text-stone-500">Previously Approved Final IA:</span>
                  <span className="font-mono tabular-nums font-semibold text-stone-700">
                    {formatNum(approveTarget.approval.approvedFinalIa)} / {subjectMeta?.iaMaximum}
                  </span>
                </div>
              )}
              <div className="flex justify-between pt-1 border-t border-stone-200">
                <span className="text-stone-700 font-semibold">Calculated Automatic IA to Approve:</span>
                <span className="font-mono tabular-nums text-sm font-bold text-[#4B2E2E]">
                  {formatNum(approveTarget.calculation.finalAutomaticIa)} / {subjectMeta?.iaMaximum}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-200">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setApproveTarget(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                isLoading={isApproving}
                icon={<FileCheck2 className="w-3.5 h-3.5" />}
                onClick={handleConfirmApprove}
              >
                Confirm Final IA Approval
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MANUAL FINAL IA ADJUSTMENT MODAL */}
      {adjustTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleConfirmAdjustment}
            className="relative w-full max-w-lg bg-white rounded-xl border border-stone-200 shadow-2xl overflow-hidden my-auto p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <div>
                <h3 className="font-serif text-base font-bold text-stone-900">
                  Manual Final IA Adjustment
                </h3>
                <p className="text-xs text-stone-500">
                  Automatic IA remains preserved separately; adjustment is logged in audit history.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAdjustTarget(null)}
                className="text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 bg-[#FAF9F5] rounded-lg border border-stone-200 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-stone-500">Student:</span>
                <span className="font-semibold text-stone-900">
                  {adjustTarget.fullName} (
                  <span className="font-mono tabular-nums">
                    {adjustTarget.temporaryRollNumber || adjustTarget.studentIdNumber}
                  </span>
                  )
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Subject &amp; Max IA:</span>
                <span className="font-semibold text-stone-900">
                  {subjectMeta?.name} (Max <span className="font-mono tabular-nums">{subjectMeta?.iaMaximum}</span>)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Stored Automatic IA (Preserved):</span>
                <span className="font-mono tabular-nums font-bold text-[#4B2E2E]">
                  {formatNum(adjustTarget.calculation.finalAutomaticIa)} / {subjectMeta?.iaMaximum}
                </span>
              </div>
              {adjustTarget.approval && (
                <div className="flex justify-between">
                  <span className="text-stone-500">Previous Approved Final IA:</span>
                  <span className="font-mono tabular-nums font-semibold text-stone-800">
                    {formatNum(adjustTarget.approval.approvedFinalIa)} / {subjectMeta?.iaMaximum}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-stone-800 mb-1">
                  Adjusted Final IA Mark (0 – {subjectMeta?.iaMaximum}) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={subjectMeta?.iaMaximum || 30}
                  required
                  value={adjustedMarkInput}
                  onChange={(e) => setAdjustedMarkInput(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-stone-900 font-mono tabular-nums"
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-800 mb-1">
                  Reason Category *
                </label>
                <select
                  value={selectedReasonCategory}
                  onChange={(e) => setSelectedReasonCategory(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-stone-900"
                >
                  {reasonCategories.map((cat) => (
                    <option key={cat.code} value={cat.code}>
                      {cat.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-stone-500 mt-1">
                  {reasonCategories.find((c) => c.code === selectedReasonCategory)?.description}
                </p>
              </div>

              <div>
                <label className="block font-semibold text-stone-800 mb-1">
                  Mandatory Written Academic Explanation *
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder="Provide specific, documented academic justification for adjusting Final IA..."
                  value={explanationInput}
                  onChange={(e) => setExplanationInput(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-stone-900"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-200">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAdjustTarget(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                isLoading={isAdjusting}
                icon={<SlidersHorizontal className="w-3.5 h-3.5" />}
              >
                Save Adjusted Final IA
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* STORED CALCULATION BREAKDOWN & APPROVAL HISTORY MODAL */}
      {detailTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-3xl bg-white rounded-xl border border-stone-200 shadow-2xl overflow-hidden my-auto p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <div>
                <h3 className="font-serif text-base font-bold text-stone-900">
                  Stored IA Calculation Breakdown &amp; Approval History
                </h3>
                <p className="text-xs text-stone-500">
                  {detailTarget.fullName} (
                  <span className="font-mono tabular-nums">
                    {detailTarget.temporaryRollNumber || detailTarget.studentIdNumber}
                  </span>
                  ) — {subjectMeta?.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailTarget(null)}
                className="text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Stored Term-by-Term Breakdown (displayed directly from backend record) */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-600">
                1. Stored Backend Calculation Breakdown
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono tabular-nums">
                <div className="p-3 rounded-lg bg-[#FAF9F5] border border-stone-200 space-y-1">
                  <div className="font-sans font-semibold text-stone-800">Term 1</div>
                  <div>
                    A/B/C: {formatNum(detailTarget.calculation.term1.A)} /{' '}
                    {formatNum(detailTarget.calculation.term1.B)} /{' '}
                    {formatNum(detailTarget.calculation.term1.C)}
                  </div>
                  <div>D1 (Avg /15): {formatNum(detailTarget.calculation.term1.D)}</div>
                  <div>E1 (Periodic): {formatNum(detailTarget.calculation.term1.E)}</div>
                  <div>F1 (TT1 Conv): {formatNum(detailTarget.calculation.term1.F)}</div>
                  <div className="font-bold text-[#4B2E2E] pt-1 border-t border-stone-200">
                    H1: {formatNum(detailTarget.calculation.term1.H)}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-[#FAF9F5] border border-stone-200 space-y-1">
                  <div className="font-sans font-semibold text-stone-800">Term 2</div>
                  <div>
                    A/B/C: {formatNum(detailTarget.calculation.term2.A)} /{' '}
                    {formatNum(detailTarget.calculation.term2.B)} /{' '}
                    {formatNum(detailTarget.calculation.term2.C)}
                  </div>
                  <div>D2 (Avg /15): {formatNum(detailTarget.calculation.term2.D)}</div>
                  <div>E2 (Periodic): {formatNum(detailTarget.calculation.term2.E)}</div>
                  <div>F2 (TT2 Conv): {formatNum(detailTarget.calculation.term2.F)}</div>
                  <div className="font-bold text-[#4B2E2E] pt-1 border-t border-stone-200">
                    H2: {formatNum(detailTarget.calculation.term2.H)}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-[#FAF9F5] border border-stone-200 space-y-1">
                  <div className="font-sans font-semibold text-stone-800">Term 3 (No Term Test)</div>
                  <div>
                    A/B/C: {formatNum(detailTarget.calculation.term3.A)} /{' '}
                    {formatNum(detailTarget.calculation.term3.B)} /{' '}
                    {formatNum(detailTarget.calculation.term3.C)}
                  </div>
                  <div>D3 (Avg /15): {formatNum(detailTarget.calculation.term3.D)}</div>
                  <div>E3 (Periodic): {formatNum(detailTarget.calculation.term3.E)}</div>
                  <div className="text-stone-400">F3: Not Applicable</div>
                  <div className="font-bold text-[#4B2E2E] pt-1 border-t border-stone-200">
                    H3 (= E3): {formatNum(detailTarget.calculation.term3.H)}
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-[#FAF9F5] border border-stone-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div>
                  <span className="text-stone-600">Stored Calculation Status: </span>
                  <span className="font-semibold text-stone-900">
                    {detailTarget.calculation.calculationStatus}
                  </span>
                  {detailTarget.calculation.statusReason && (
                    <span className="text-stone-500"> — {detailTarget.calculation.statusReason}</span>
                  )}
                </div>
                <div className="font-mono tabular-nums font-bold text-[#4B2E2E]">
                  Stored Automatic IA: {formatNum(detailTarget.calculation.finalAutomaticIa)}
                  {detailTarget.approval && (
                    <span className="ml-3 text-stone-900">
                      | Approved Final IA: {formatNum(detailTarget.approval.approvedFinalIa)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Chronological Approval & Adjustment History */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-600">
                2. Final IA Approval &amp; Adjustment History
              </h4>
              {detailTarget.history.length === 0 ? (
                <div className="p-4 rounded-lg border border-stone-200 text-xs text-stone-500 text-center">
                  No Final IA approval or adjustment actions recorded yet for this student.
                </div>
              ) : (
                <div className="overflow-x-auto border border-stone-200 rounded-lg">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-[#FAF9F5] border-b border-stone-200 text-stone-700 font-semibold text-[11px]">
                        <th className="py-2.5 px-3">Timestamp</th>
                        <th className="py-2.5 px-3">Action</th>
                        <th className="py-2.5 px-3 text-right">Prev Final</th>
                        <th className="py-2.5 px-3 text-right">New Final</th>
                        <th className="py-2.5 px-3 text-right">Auto IA</th>
                        <th className="py-2.5 px-3">Reason &amp; Explanation</th>
                        <th className="py-2.5 px-3">Actor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200">
                      {detailTarget.history.map((h) => (
                        <tr key={h.id} className="align-top">
                          <td className="py-2.5 px-3 font-mono tabular-nums text-[11px] text-stone-600 whitespace-nowrap">
                            {h.createdAt ? new Date(h.createdAt).toLocaleString() : '—'}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <Badge
                              variant={
                                h.actionType === 'APPROVED_AS_CALCULATED'
                                  ? 'success'
                                  : 'warning'
                              }
                              size="sm"
                              className={
                                h.actionType === 'FLAGGED_FOR_REVIEW_ON_RECALC'
                                  ? '!bg-rose-50 !text-rose-800 !border-rose-200'
                                  : ''
                              }
                            >
                              {h.actionType === 'APPROVED_AS_CALCULATED'
                                ? 'Approved Auto IA'
                                : h.actionType === 'MANUAL_ADJUSTMENT'
                                  ? 'Manual Adjustment'
                                  : 'Flagged on Recalc'}
                            </Badge>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-stone-600">
                            {formatNum(h.previousFinalIa)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-stone-900">
                            {formatNum(h.newFinalIa)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#4B2E2E]">
                            {formatNum(h.automaticIaValue)}
                          </td>
                          <td className="py-2.5 px-3 max-w-xs">
                            {h.reasonCategory && (
                              <div className="font-semibold text-stone-800">
                                {reasonLabelMap.get(h.reasonCategory) || h.reasonCategory}
                              </div>
                            )}
                            {h.explanation && (
                              <div className="text-[11px] text-stone-600 leading-snug">
                                {h.explanation}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-stone-800 whitespace-nowrap">
                            {h.actorName}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-stone-200">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDetailTarget(null)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
