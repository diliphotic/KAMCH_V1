import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FileText,
  Printer,
  Download,
  RefreshCw,
  Settings2,
  AlertCircle,
  CheckCircle2,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { CollegeLogo } from '../ui/CollegeLogo';

interface BatchOption {
  id: number;
  code: string;
  name: string;
  admissionAcademicYear: string;
  currentCohortStage: string;
  currentProfessionalYear?: number | null;
  schemeCode?: string | null;
  isLegacyMinimal?: boolean;
  isActive?: boolean;
}

interface SubjectOption {
  id: number;
  code: string;
  name: string;
  professionalYear: number;
  schemeCode?: string | null;
  departmentId: number | null;
  departmentName: string | null;
  departmentIsActive?: boolean | null;
  iaMaximum: number;
  isIaEnabled: boolean;
  iaCalculationRule: string;
}

function isReportSubjectApplicableToBatch(
  subject: SubjectOption,
  batch: BatchOption | undefined
): boolean {
  if (!batch) return false;
  if (batch.isLegacyMinimal || batch.schemeCode === 'RS6') return false;
  const subjScheme = subject.schemeCode || 'RS7';
  if (batch.schemeCode && subjScheme !== batch.schemeCode) return false;
  if (
    batch.currentProfessionalYear !== null &&
    batch.currentProfessionalYear !== undefined &&
    Number(batch.currentProfessionalYear) > 0
  ) {
    return Number(subject.professionalYear) === Number(batch.currentProfessionalYear);
  }
  return true;
}

function pickDefaultReportBatch(list: BatchOption[]): BatchOption | undefined {
  return (
    list.find(
      (b) =>
        b.isActive !== false &&
        !b.isLegacyMinimal &&
        b.schemeCode !== 'RS6' &&
        Number(b.currentProfessionalYear) > 0
    ) ||
    list.find((b) => !b.isLegacyMinimal && b.schemeCode !== 'RS6') ||
    list[0]
  );
}

interface DepartmentOption {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
}

interface AssessmentOption {
  id: number;
  code: string;
  name: string;
  assessmentType: 'PAT' | 'TERM_TEST' | 'UNIVERSITY_EXAM';
  termNumber: number;
  maxMarksTheory: number;
  maxMarksPractical: number;
}

interface ReportBranding {
  collegeName: string;
  subtitle: string;
  logoUrl: string;
}

interface AssessmentReportStudentRow {
  studentId: number;
  studentIdNumber: string;
  rollNumber: string;
  permanentUniversityNumber: string | null;
  fullName: string;
  administrativeStatus: string;
  outcome: 'MARKS_ENTERED' | 'ABSENT' | 'NOT_APPEARED' | 'EXEMPTED' | 'NOT_RECORDED';
  entryState: 'SUBMITTED' | 'DRAFT' | 'NOT_RECORDED';
  theoryMarks: number | null;
  practicalMarks: number | null;
  maxMarksTheory: number;
  maxMarksPractical: number | null;
}

interface AssessmentReportPayload {
  reportType: 'ASSESSMENT_REPORT';
  branding: ReportBranding;
  generatedAt: string;
  generatedBy: string;
  batch: {
    id: number;
    code: string;
    name: string;
    admissionAcademicYear: string;
    currentProfessionalYear: number | null;
    currentCohortStage: string;
    schemeCode: string | null;
    isActive: boolean;
  };
  department: {
    id: number | null;
    code: string | null;
    name: string;
    isActive: boolean | null;
  };
  subject: {
    id: number;
    code: string;
    name: string;
    professionalYear: number;
  };
  assessment: {
    id: number;
    code: string;
    name: string;
    assessmentType: 'PAT' | 'TERM_TEST' | 'UNIVERSITY_EXAM';
    termNumber: number;
    maxMarksTheory: number;
    maxMarksPractical: number;
    configuredFromDate: string | null;
    configuredToDate: string | null;
    assessmentDateDisplay: string;
  };
  submission: {
    status: 'SUBMITTED' | 'DRAFT_IN_PROGRESS' | 'NOT_STARTED';
    submittedBy: string | null;
    submittedAt: string | null;
  };
  summary: {
    totalStudents: number;
    marksEnteredCount: number;
    absentCount: number;
    notAppearedCount: number;
    exemptedCount: number;
    notRecordedCount: number;
  };
  students: AssessmentReportStudentRow[];
}

interface FinalIaReportStudentRow {
  studentId: number;
  studentIdNumber: string;
  rollNumber: string;
  permanentUniversityNumber: string | null;
  fullName: string;
  administrativeStatus: string;
  iaMaximum: number | null;
  automaticIa: number | null;
  calculationStatus: 'CALCULATED' | 'PENDING' | 'NOT_APPLICABLE';
  approvedFinalIa: number | null;
  previouslyApprovedFinalIa: number | null;
  finalApprovalStatus:
    | 'APPROVED'
    | 'ADJUSTED_APPROVED'
    | 'REQUIRES_REVIEW'
    | 'AWAITING_APPROVAL'
    | 'PENDING_CALCULATION'
    | 'NOT_APPLICABLE';
  reviewRequired: boolean;
  statusNote: string;
  approvedBy: string | null;
  approvedAt: string | null;
}

interface FinalIaReportPayload {
  reportType: 'FINAL_IA_REPORT';
  branding: ReportBranding;
  generatedAt: string;
  generatedBy: string;
  batch: {
    id: number;
    code: string;
    name: string;
    admissionAcademicYear: string;
    currentProfessionalYear: number | null;
    currentCohortStage: string;
    schemeCode: string | null;
    isLegacyMinimal: boolean;
    isActive: boolean;
  };
  department: {
    id: number | null;
    code: string | null;
    name: string;
    isActive: boolean | null;
  };
  subject: {
    id: number;
    code: string;
    name: string;
    professionalYear: number;
    iaMaximum: number | null;
    isIaEnabled: boolean;
    iaCalculationRule: string;
    patMappingVerified: boolean;
  };
  summary: {
    totalStudents: number;
    calculatedCount: number;
    pendingCount: number;
    notApplicableCount: number;
    approvedFinalCount: number;
    adjustedFinalCount: number;
    awaitingApprovalCount: number;
    requiresReviewCount: number;
  };
  students: FinalIaReportStudentRow[];
}

export interface IaReportsPanelProps {
  batches: BatchOption[];
  subjects: SubjectOption[];
  departments: DepartmentOption[];
  assessments: AssessmentOption[];
  csrfToken: string | null;
}

function formatDateTimeDisplay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatNum2(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return '—';
  return Number(val).toFixed(2);
}

function formatOutcomeText(outcome: AssessmentReportStudentRow['outcome']): string {
  switch (outcome) {
    case 'MARKS_ENTERED':
      return 'Marks Entered';
    case 'ABSENT':
      return 'Absent (0)';
    case 'NOT_APPEARED':
      return 'Not Appeared';
    case 'EXEMPTED':
      return 'Exempted';
    default:
      return 'Not Recorded';
  }
}

function formatFinalApprovalStatusText(status: FinalIaReportStudentRow['finalApprovalStatus']): string {
  switch (status) {
    case 'APPROVED':
      return 'Approved';
    case 'ADJUSTED_APPROVED':
      return 'Approved (Adjusted)';
    case 'REQUIRES_REVIEW':
      return 'Requires Re-Review';
    case 'AWAITING_APPROVAL':
      return 'Awaiting Approval';
    case 'PENDING_CALCULATION':
      return 'Pending Calculation';
    default:
      return 'Not Applicable';
  }
}

export const IaReportsPanel: React.FC<IaReportsPanelProps> = ({
  batches,
  subjects,
  departments,
  assessments,
  csrfToken,
}) => {
  const { user } = useAuth();
  const isDeptScoped = ['DEPARTMENT', 'HOD'].includes(user?.role || '');
  const canConfigureIa = ['SUPER_ADMIN', 'PRINCIPAL', 'SECRETARY', 'OFFICE', 'STAFF'].includes(
    user?.role || ''
  );

  const [reportKind, setReportKind] = useState<'assessment' | 'final_ia'>('assessment');
  const [selectedBatchId, setSelectedBatchId] = useState<string>(() => {
    const preferred = pickDefaultReportBatch(batches);
    return preferred ? String(preferred.id) : '';
  });

  const currentBatch = useMemo(
    () => batches.find((b) => String(b.id) === selectedBatchId),
    [batches, selectedBatchId]
  );

  const batchScopedSubjects = useMemo(
    () => subjects.filter((s) => isReportSubjectApplicableToBatch(s, currentBatch)),
    [subjects, currentBatch]
  );

  const hasUnassignedSubjects = useMemo(
    () => subjects.some((s) => s.departmentId === null || s.departmentId === undefined),
    [subjects]
  );

  const [selectedDepartmentKey, setSelectedDepartmentKey] = useState<string>(() => {
    if (isDeptScoped && user?.departmentId) {
      return String(user.departmentId);
    }
    const initBatch = pickDefaultReportBatch(batches);
    const initSubjects = subjects.filter((s) => isReportSubjectApplicableToBatch(s, initBatch));
    if (departments.length > 0) {
      const withBatchSubjects = departments.find((d) =>
        initSubjects.some((s) => s.departmentId === d.id)
      );
      if (withBatchSubjects) return String(withBatchSubjects.id);
      if (initSubjects.some((s) => s.departmentId === null || s.departmentId === undefined)) {
        return 'UNASSIGNED';
      }
      return String(departments[0].id);
    }
    return hasUnassignedSubjects ? 'UNASSIGNED' : '';
  });

  // Sync department key if metadata finishes loading after mount
  useEffect(() => {
    if (isDeptScoped && user?.departmentId) {
      setSelectedDepartmentKey(String(user.departmentId));
      return;
    }
    if (!selectedDepartmentKey) {
      if (departments.length > 0) {
        const withSubjects = departments.find((d) =>
          batchScopedSubjects.some((s) => s.departmentId === d.id)
        );
        if (withSubjects) {
          setSelectedDepartmentKey(String(withSubjects.id));
        } else if (
          batchScopedSubjects.some((s) => s.departmentId === null || s.departmentId === undefined)
        ) {
          setSelectedDepartmentKey('UNASSIGNED');
        } else {
          setSelectedDepartmentKey(String(departments[0].id));
        }
      } else if (hasUnassignedSubjects) {
        setSelectedDepartmentKey('UNASSIGNED');
      }
    }
  }, [
    isDeptScoped,
    user?.departmentId,
    departments,
    batchScopedSubjects,
    hasUnassignedSubjects,
    selectedDepartmentKey,
  ]);

  useEffect(() => {
    if (!selectedBatchId && batches.length > 0) {
      const preferred = pickDefaultReportBatch(batches);
      if (preferred) setSelectedBatchId(String(preferred.id));
    }
  }, [batches, selectedBatchId]);

  const handleReportBatchChange = useCallback(
    (nextBatchIdStr: string) => {
      setSelectedBatchId(nextBatchIdStr);
      const nextBatch = batches.find((b) => String(b.id) === nextBatchIdStr);
      const nextBatchSubjects = subjects.filter((s) =>
        isReportSubjectApplicableToBatch(s, nextBatch)
      );

      let resolvedDeptKey = selectedDepartmentKey;
      if (!isDeptScoped) {
        const currentDeptHasMatch =
          resolvedDeptKey === 'UNASSIGNED'
            ? nextBatchSubjects.some((s) => s.departmentId === null || s.departmentId === undefined)
            : Boolean(
                resolvedDeptKey &&
                  nextBatchSubjects.some((s) => Number(s.departmentId) === Number(resolvedDeptKey))
              );

        if (!currentDeptHasMatch && nextBatchSubjects.length > 0) {
          const matchingDept = departments.find((d) =>
            nextBatchSubjects.some((s) => s.departmentId === d.id)
          );
          if (matchingDept) {
            resolvedDeptKey = String(matchingDept.id);
            setSelectedDepartmentKey(resolvedDeptKey);
          } else if (
            nextBatchSubjects.some((s) => s.departmentId === null || s.departmentId === undefined)
          ) {
            resolvedDeptKey = 'UNASSIGNED';
            setSelectedDepartmentKey('UNASSIGNED');
          }
        }
      }

      const nextFilteredSubjects = isDeptScoped
        ? nextBatchSubjects.filter(
            (s) => user?.departmentId && Number(s.departmentId) === Number(user.departmentId)
          )
        : resolvedDeptKey === 'UNASSIGNED'
        ? nextBatchSubjects.filter((s) => s.departmentId === null || s.departmentId === undefined)
        : resolvedDeptKey
        ? nextBatchSubjects.filter((s) => Number(s.departmentId) === Number(resolvedDeptKey))
        : nextBatchSubjects;

      setSelectedSubjectId((prevSubj) => {
        if (prevSubj && nextFilteredSubjects.some((s) => String(s.id) === prevSubj)) {
          return prevSubj;
        }
        return nextFilteredSubjects.length > 0 ? String(nextFilteredSubjects[0].id) : '';
      });
    },
    [batches, subjects, departments, isDeptScoped, user?.departmentId, selectedDepartmentKey]
  );

  const filteredSubjects = useMemo(() => {
    if (isDeptScoped) {
      return batchScopedSubjects.filter(
        (s) => user?.departmentId && Number(s.departmentId) === Number(user.departmentId)
      );
    }
    if (!selectedDepartmentKey) return batchScopedSubjects;
    if (selectedDepartmentKey === 'UNASSIGNED') {
      return batchScopedSubjects.filter(
        (s) => s.departmentId === null || s.departmentId === undefined
      );
    }
    const targetDeptId = Number(selectedDepartmentKey);
    return batchScopedSubjects.filter((s) => Number(s.departmentId) === targetDeptId);
  }, [isDeptScoped, user?.departmentId, batchScopedSubjects, selectedDepartmentKey]);

  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string>(() =>
    assessments.length > 0 ? String(assessments[0].id) : ''
  );

  useEffect(() => {
    if (filteredSubjects.length === 0) {
      if (selectedSubjectId !== '') setSelectedSubjectId('');
      return;
    }
    if (!selectedSubjectId || !filteredSubjects.some((s) => String(s.id) === selectedSubjectId)) {
      setSelectedSubjectId(String(filteredSubjects[0].id));
    }
  }, [filteredSubjects, selectedSubjectId]);

  useEffect(() => {
    if (!selectedAssessmentId && assessments.length > 0) {
      setSelectedAssessmentId(String(assessments[0].id));
    }
  }, [assessments, selectedAssessmentId]);

  // Generated report state (strictly on-demand)
  const [activeReport, setActiveReport] = useState<
    AssessmentReportPayload | FinalIaReportPayload | null
  >(null);
  const [generatedParamsKey, setGeneratedParamsKey] = useState<string>('');
  const [generatedQueryUrl, setGeneratedQueryUrl] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [reportNotice, setReportNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [customLogoFailed, setCustomLogoFailed] = useState(false);

  // Branding configuration modal state (authorized Office / Admin only)
  const [brandingModalOpen, setBrandingModalOpen] = useState(false);
  const [brandingForm, setBrandingForm] = useState<ReportBranding>({
    collegeName: 'Krishna Ayurvedic Medical College & Hospital',
    subtitle: 'Internal Assessment & Examination Cell',
    logoUrl: '/assets/kamch-logo.png',
  });
  const [isSavingBranding, setIsSavingBranding] = useState(false);

  const loadBranding = useCallback(async () => {
    try {
      const res = await fetch('/api/internal-assessment/report-branding');
      if (res.ok) {
        const data = await res.json();
        if (data.branding) {
          setBrandingForm(data.branding);
        }
      }
    } catch {
      // Keep default branding fallback
    }
  }, []);

  useEffect(() => {
    loadBranding();
  }, [loadBranding]);

  const currentSelectionKey = useMemo(() => {
    if (reportKind === 'assessment') {
      return `assessment|${selectedBatchId}|${selectedDepartmentKey}|${selectedSubjectId}|${selectedAssessmentId}`;
    }
    return `final_ia|${selectedBatchId}|${selectedDepartmentKey}|${selectedSubjectId}`;
  }, [reportKind, selectedBatchId, selectedDepartmentKey, selectedSubjectId, selectedAssessmentId]);

  const isSelectionDirtySinceGenerate =
    Boolean(activeReport) && generatedParamsKey !== currentSelectionKey;

  const handleGenerateReport = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setReportNotice(null);

    if (!selectedBatchId || !selectedSubjectId) {
      setReportNotice({
        type: 'error',
        message: 'Please select an academic batch, department, and subject to generate a report.',
      });
      return;
    }

    if (reportKind === 'assessment' && !selectedAssessmentId) {
      setReportNotice({
        type: 'error',
        message: 'Please select an assessment to generate an Assessment Report.',
      });
      return;
    }

    setIsGenerating(true);
    setCustomLogoFailed(false);

    try {
      const qs = new URLSearchParams();
      qs.set('batchId', selectedBatchId);
      qs.set('subjectId', selectedSubjectId);
      if (selectedDepartmentKey) {
        qs.set('departmentId', selectedDepartmentKey);
      }

      let endpoint = '/api/internal-assessment/reports/final-ia';
      if (reportKind === 'assessment') {
        qs.set('assessmentId', selectedAssessmentId);
        endpoint = '/api/internal-assessment/reports/assessment';
      }

      const fullQueryUrl = `${endpoint}?${qs.toString()}`;
      const res = await fetch(fullQueryUrl);
      const data = await res.json();

      if (!res.ok) {
        setReportNotice({
          type: 'error',
          message: data.error || 'Failed to generate report.',
        });
        return;
      }

      setActiveReport(data.report);
      setGeneratedParamsKey(currentSelectionKey);
      setGeneratedQueryUrl(fullQueryUrl);
    } catch {
      setReportNotice({
        type: 'error',
        message: 'Network error while generating report.',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadCsv = async () => {
    if (!generatedQueryUrl || !activeReport) return;
    setIsExportingCsv(true);
    setReportNotice(null);

    try {
      const csvUrl = `${generatedQueryUrl}&format=csv`;
      const res = await fetch(csvUrl, { credentials: 'include' });
      if (!res.ok) {
        let errMessage = 'Failed to export Excel-compatible CSV.';
        try {
          const errJson = await res.json();
          if (errJson?.error) errMessage = errJson.error;
        } catch {
          // Non-JSON response
        }
        setReportNotice({ type: 'error', message: errMessage });
        return;
      }

      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^"]+)"?/i);
      const fallbackFilename =
        activeReport.reportType === 'ASSESSMENT_REPORT'
          ? `KAMCH_Assessment_Report_${activeReport.batch.code}_${activeReport.subject.code}_${activeReport.assessment.code}.csv`
          : `KAMCH_Final_IA_Report_${activeReport.batch.code}_${activeReport.subject.code}.csv`;
      const downloadName = match?.[1] || fallbackFilename;

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch {
      setReportNotice({
        type: 'error',
        message: 'Network error while downloading CSV export.',
      });
    } finally {
      setIsExportingCsv(false);
    }
  };

  const handlePrintReport = () => {
    if (!activeReport) return;
    window.print();
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingBranding(true);
    setReportNotice(null);

    try {
      const res = await fetch('/api/internal-assessment/report-branding', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken || '',
        },
        body: JSON.stringify(brandingForm),
      });
      const data = await res.json();
      if (!res.ok) {
        setReportNotice({
          type: 'error',
          message: data.error || 'Failed to save report header branding.',
        });
        return;
      }

      setBrandingForm(data.branding);
      setCustomLogoFailed(false);
      if (activeReport) {
        setActiveReport({
          ...activeReport,
          branding: data.branding,
        });
      }
      setBrandingModalOpen(false);
      setReportNotice({
        type: 'success',
        message: 'Report college header and logo settings saved.',
      });
    } catch {
      setReportNotice({
        type: 'error',
        message: 'Network error while saving report header branding.',
      });
    } finally {
      setIsSavingBranding(false);
    }
  };

  const activeBranding = activeReport?.branding || brandingForm;
  const shouldUseDefaultLogoComponent =
    !activeBranding.logoUrl ||
    activeBranding.logoUrl === '/assets/kamch-logo.png' ||
    customLogoFailed;

  return (
    <div className="space-y-5">
      {/* On-Demand Filter & Report Controls (Hidden when printing) */}
      <div className="no-print space-y-4">
        {reportNotice && (
          <div
            className={`p-3.5 rounded-lg border text-xs flex items-center gap-2.5 ${
              reportNotice.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}
            role="alert"
          >
            {reportNotice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{reportNotice.message}</span>
          </div>
        )}

        <Card accentTop>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#4B2E2E]/10 text-[#4B2E2E] flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <CardTitle>On-Demand Official Reports &amp; Exports</CardTitle>
                  <CardDescription>
                    Generate print-ready PDF sheets and Excel-compatible CSV exports directly from saved institutional records.
                  </CardDescription>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Report Type Segmented Control */}
                <div className="flex items-center gap-1 p-1 bg-stone-100 border border-stone-200 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setReportKind('assessment')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      reportKind === 'assessment'
                        ? 'bg-[#4B2E2E] text-[#F5F5DC]'
                        : 'text-stone-700 hover:text-stone-900'
                    }`}
                  >
                    Assessment Report
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportKind('final_ia')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      reportKind === 'final_ia'
                        ? 'bg-[#4B2E2E] text-[#F5F5DC]'
                        : 'text-stone-700 hover:text-stone-900'
                    }`}
                  >
                    Final IA Report
                  </button>
                </div>

                {canConfigureIa && (
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<Settings2 className="w-3.5 h-3.5" />}
                    onClick={() => setBrandingModalOpen(true)}
                  >
                    Report Branding
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleGenerateReport} className="space-y-4">
              <div
                className={`grid grid-cols-1 ${
                  reportKind === 'assessment' ? 'md:grid-cols-4' : 'md:grid-cols-3'
                } gap-4`}
              >
                {/* 1. Academic Batch (includes historical/inactive batches) */}
                <div>
                  <label className="block text-xs font-semibold text-stone-800 mb-1">
                    Academic Batch
                  </label>
                  <select
                    value={selectedBatchId}
                    onChange={(e) => handleReportBatchChange(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 min-h-[38px]"
                  >
                    {batches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.admissionAcademicYear})
                        {b.schemeCode ? ` · ${b.schemeCode}` : ''}
                        {b.isActive === false ? ' [Historical / Inactive]' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 2. Department */}
                <div>
                  <label className="block text-xs font-semibold text-stone-800 mb-1">
                    Department
                  </label>
                  {isDeptScoped ? (
                    <input
                      type="text"
                      readOnly
                      value={user?.departmentName || 'Assigned Department'}
                      className="w-full px-3 py-2 text-xs bg-stone-100 border border-stone-300 rounded-lg text-stone-700 min-h-[38px]"
                    />
                  ) : (
                    <select
                      value={selectedDepartmentKey}
                      onChange={(e) => setSelectedDepartmentKey(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 min-h-[38px]"
                    >
                      {departments.map((d) => (
                        <option key={d.id} value={String(d.id)}>
                          {d.name} ({d.code}){!d.isActive ? ' [Inactive]' : ''}
                        </option>
                      ))}
                      {hasUnassignedSubjects && (
                        <option value="UNASSIGNED">Unassigned Curriculum Subjects</option>
                      )}
                    </select>
                  )}
                </div>

                {/* 3. Subject */}
                <div>
                  <label className="block text-xs font-semibold text-stone-800 mb-1">
                    Subject
                  </label>
                  <select
                    value={selectedSubjectId}
                    onChange={(e) => setSelectedSubjectId(e.target.value)}
                    disabled={filteredSubjects.length === 0}
                    className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 min-h-[38px] disabled:bg-stone-100 disabled:text-stone-500"
                  >
                    {filteredSubjects.length === 0 ? (
                      <option value="">No applicable subjects for batch &amp; department</option>
                    ) : (
                      filteredSubjects.map((s) => (
                        <option key={s.id} value={String(s.id)}>
                          {s.name} (Prof. Year {s.professionalYear})
                        </option>
                      ))
                    )}
                  </select>
                </div>

                {/* 4. Assessment (Assessment Report only) */}
                {reportKind === 'assessment' && (
                  <div>
                    <label className="block text-xs font-semibold text-stone-800 mb-1">
                      Assessment
                    </label>
                    <select
                      value={selectedAssessmentId}
                      onChange={(e) => setSelectedAssessmentId(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 min-h-[38px]"
                    >
                      {assessments.map((a) => (
                        <option key={a.id} value={String(a.id)}>
                          {a.name} (Term {a.termNumber})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-stone-200/80">
                <p className="text-xs text-stone-600">
                  {reportKind === 'assessment'
                    ? 'Generates an on-demand marks and submission status statement for the selected assessment.'
                    : 'Generates an on-demand Final IA statement strictly from stored calculation and approval records.'}
                </p>

                <div className="flex items-center gap-2 flex-wrap shrink-0">
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={isGenerating || !selectedBatchId || !selectedSubjectId}
                    icon={
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`}
                      />
                    }
                  >
                    {isGenerating ? 'Generating Report...' : 'Generate Report'}
                  </Button>

                  {activeReport && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handlePrintReport}
                        icon={<Printer className="w-3.5 h-3.5" />}
                      >
                        Print / Save PDF
                      </Button>

                      <Button
                        type="button"
                        variant="gold"
                        size="sm"
                        disabled={isExportingCsv}
                        onClick={handleDownloadCsv}
                        icon={<Download className="w-3.5 h-3.5" />}
                      >
                        {isExportingCsv ? 'Exporting CSV...' : 'Export Excel (CSV)'}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </form>
          </CardContent>
        </Card>

        {isSelectionDirtySinceGenerate && activeReport && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-300 text-amber-950 text-xs flex items-center justify-between gap-3">
            <span>
              Filter selection changed. The report and export buttons below reflect{' '}
              <strong>{activeReport.batch.name}</strong> · <strong>{activeReport.subject.name}</strong>
              {activeReport.reportType === 'ASSESSMENT_REPORT'
                ? ` · ${activeReport.assessment.name}`
                : ''}{' '}
              until you click <strong>Generate Report</strong>.
            </span>
          </div>
        )}
      </div>

      {/* Empty State Before First On-Demand Report */}
      {!activeReport && !isGenerating && (
        <div className="no-print bg-white border border-stone-200 rounded-xl p-10 text-center space-y-2">
          <p className="text-sm font-semibold text-stone-800">
            No Official Report Generated Yet
          </p>
          <p className="text-xs text-stone-600 max-w-xl mx-auto">
            Select an academic batch, department, and subject above, then click{' '}
            <strong>Generate Report</strong> to build an on-demand printable statement and Excel-compatible CSV export.
          </p>
        </div>
      )}

      {/* Printable Institutional Report Document */}
      {activeReport && (
        <section
          id="kamch-printable-report"
          aria-label="Official Institutional Report"
          className="bg-white border border-stone-300 rounded-xl p-6 sm:p-8 space-y-6 text-stone-900"
        >
          {/* 1. Institutional Masthead */}
          <div className="border-b-2 border-[#4B2E2E] pb-4 flex items-start justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              {shouldUseDefaultLogoComponent ? (
                <div className="w-14 h-14 rounded-lg bg-[#FAF9F5] border border-[#D4AF37]/50 p-1 flex items-center justify-center shrink-0">
                  <CollegeLogo size="md" className="w-full h-full" />
                </div>
              ) : (
                <div className="w-14 h-14 rounded-lg bg-[#FAF9F5] border border-[#D4AF37]/50 p-1 flex items-center justify-center shrink-0">
                  <img
                    src={activeBranding.logoUrl}
                    alt={`${activeBranding.collegeName} Logo`}
                    referrerPolicy="no-referrer"
                    onError={() => setCustomLogoFailed(true)}
                    className="w-full h-full object-contain"
                  />
                </div>
              )}

              <div className="min-w-0">
                <h2 className="font-serif text-lg sm:text-xl font-bold text-[#4B2E2E] leading-snug">
                  {activeBranding.collegeName}
                </h2>
                {activeBranding.subtitle && (
                  <p className="text-xs font-medium text-stone-700 mt-0.5">
                    {activeBranding.subtitle}
                  </p>
                )}
                <p className="text-xs font-semibold text-[#4B2E2E] mt-1">
                  {activeReport.reportType === 'ASSESSMENT_REPORT'
                    ? 'Official Internal Assessment — Marks & Outcome Statement'
                    : 'Official Final Internal Assessment (IA) Statement'}
                </p>
              </div>
            </div>

            <div className="text-right text-[11px] text-stone-600 shrink-0 font-mono tabular-nums">
              <div>Generated: {formatDateTimeDisplay(activeReport.generatedAt)}</div>
              <div className="mt-0.5">By: {activeReport.generatedBy}</div>
            </div>
          </div>

          {/* 2. Metadata Summary Grid */}
          {activeReport.reportType === 'ASSESSMENT_REPORT' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-[#FAF9F5] border border-stone-200 rounded-lg p-4 text-xs print-avoid-break">
              <div>
                <div className="text-[11px] text-stone-500">Academic Batch &amp; Year</div>
                <div className="font-semibold text-stone-900 mt-0.5">
                  {activeReport.batch.name} ({activeReport.batch.admissionAcademicYear})
                </div>
                <div className="text-[11px] text-stone-600 mt-0.5">
                  {activeReport.batch.currentProfessionalYear
                    ? `Batch Prof. Year ${activeReport.batch.currentProfessionalYear}`
                    : `Subject Prof. Year ${activeReport.subject.professionalYear}`}
                  {!activeReport.batch.isActive ? ' · Historical / Inactive Batch' : ''}
                </div>
              </div>

              <div>
                <div className="text-[11px] text-stone-500">Department &amp; Subject</div>
                <div className="font-semibold text-stone-900 mt-0.5">
                  {activeReport.subject.name} ({activeReport.subject.code})
                </div>
                <div className="text-[11px] text-stone-600 mt-0.5">
                  {activeReport.department.name}
                  {activeReport.department.isActive === false ? ' · Inactive Dept.' : ''}
                </div>
              </div>

              <div>
                <div className="text-[11px] text-stone-500">Assessment &amp; Configured Date</div>
                <div className="font-semibold text-stone-900 mt-0.5">
                  {activeReport.assessment.name} (Term {activeReport.assessment.termNumber})
                </div>
                <div className="text-[11px] text-stone-600 mt-0.5 font-mono tabular-nums">
                  Date: {activeReport.assessment.assessmentDateDisplay} · Max:{' '}
                  {activeReport.assessment.assessmentType === 'TERM_TEST'
                    ? `Th ${activeReport.assessment.maxMarksTheory} / Pr ${activeReport.assessment.maxMarksPractical}`
                    : activeReport.assessment.maxMarksTheory}
                </div>
              </div>

              <div>
                <div className="text-[11px] text-stone-500">Submission &amp; Lock Status</div>
                <div className="font-semibold text-stone-900 mt-0.5">
                  {activeReport.submission.status === 'SUBMITTED'
                    ? 'Submitted & Locked'
                    : activeReport.submission.status === 'DRAFT_IN_PROGRESS'
                      ? 'Draft (Unsubmitted)'
                      : 'Not Started'}
                </div>
                <div className="text-[11px] text-stone-600 mt-0.5 font-mono tabular-nums">
                  {activeReport.submission.submittedBy
                    ? `${activeReport.submission.submittedBy} · ${formatDateTimeDisplay(
                        activeReport.submission.submittedAt
                      )}`
                    : 'Not yet submitted'}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-[#FAF9F5] border border-stone-200 rounded-lg p-4 text-xs print-avoid-break">
              <div>
                <div className="text-[11px] text-stone-500">Academic Batch &amp; Scheme</div>
                <div className="font-semibold text-stone-900 mt-0.5">
                  {activeReport.batch.name} ({activeReport.batch.admissionAcademicYear})
                </div>
                <div className="text-[11px] text-stone-600 mt-0.5">
                  {activeReport.batch.schemeCode || 'BAMS'}
                  {activeReport.batch.currentProfessionalYear
                    ? ` · Prof. Year ${activeReport.batch.currentProfessionalYear}`
                    : ` · Subject Year ${activeReport.subject.professionalYear}`}
                  {!activeReport.batch.isActive ? ' · Historical Batch' : ''}
                </div>
              </div>

              <div>
                <div className="text-[11px] text-stone-500">Department &amp; Subject</div>
                <div className="font-semibold text-stone-900 mt-0.5">
                  {activeReport.subject.name} ({activeReport.subject.code})
                </div>
                <div className="text-[11px] text-stone-600 mt-0.5">
                  {activeReport.department.name}
                  {activeReport.department.isActive === false ? ' · Inactive Dept.' : ''}
                </div>
              </div>

              <div>
                <div className="text-[11px] text-stone-500">IA Scheme &amp; Maximum Marks</div>
                <div className="font-semibold text-stone-900 mt-0.5 font-mono tabular-nums">
                  {activeReport.subject.iaMaximum !== null
                    ? `Maximum IA: ${activeReport.subject.iaMaximum} Marks`
                    : 'IA Not Applicable'}
                </div>
                <div className="text-[11px] text-stone-600 mt-0.5">
                  {activeReport.subject.isIaEnabled
                    ? activeReport.subject.patMappingVerified
                      ? 'PAT Mapping Verified'
                      : 'PAT Mapping Unverified (Pending)'
                    : 'Excluded Subject'}
                </div>
              </div>

              <div>
                <div className="text-[11px] text-stone-500">Cohort IA Status Summary</div>
                <div className="font-semibold text-stone-900 mt-0.5 font-mono tabular-nums">
                  Approved: {activeReport.summary.approvedFinalCount + activeReport.summary.adjustedFinalCount} /{' '}
                  {activeReport.summary.totalStudents}
                </div>
                <div className="text-[11px] text-stone-600 mt-0.5 font-mono tabular-nums">
                  Calc: {activeReport.summary.calculatedCount} · Pending:{' '}
                  {activeReport.summary.pendingCount} · Review Req:{' '}
                  {activeReport.summary.awaitingApprovalCount + activeReport.summary.requiresReviewCount}
                </div>
              </div>
            </div>
          )}

          {/* 3. Student Data Table */}
          {activeReport.students.length === 0 ? (
            <div className="py-8 text-center border border-stone-200 rounded-lg text-xs text-stone-600">
              No enrolled active students found in {activeReport.batch.name}.
            </div>
          ) : activeReport.reportType === 'ASSESSMENT_REPORT' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse border border-stone-300">
                <thead>
                  <tr className="bg-[#FAF9F5] border-b border-stone-300 text-stone-800">
                    <th className="py-2 px-2.5 text-left font-semibold border-r border-stone-300 w-10">
                      #
                    </th>
                    <th className="py-2 px-2.5 text-left font-semibold border-r border-stone-300">
                      Roll Number
                    </th>
                    <th className="py-2 px-2.5 text-left font-semibold border-r border-stone-300">
                      Univ. Reg. No.
                    </th>
                    <th className="py-2 px-2.5 text-left font-semibold border-r border-stone-300">
                      Student Name
                    </th>
                    <th className="py-2 px-2.5 text-left font-semibold border-r border-stone-300">
                      Status
                    </th>
                    <th className="py-2 px-2.5 text-left font-semibold border-r border-stone-300">
                      Outcome
                    </th>
                    {activeReport.assessment.assessmentType === 'TERM_TEST' ? (
                      <>
                        <th className="py-2 px-2.5 text-right font-semibold border-r border-stone-300">
                          Theory (/{activeReport.assessment.maxMarksTheory})
                        </th>
                        <th className="py-2 px-2.5 text-right font-semibold border-r border-stone-300">
                          Practical (/{activeReport.assessment.maxMarksPractical})
                        </th>
                      </>
                    ) : (
                      <th className="py-2 px-2.5 text-right font-semibold border-r border-stone-300">
                        Marks (/{activeReport.assessment.maxMarksTheory})
                      </th>
                    )}
                    <th className="py-2 px-2.5 text-left font-semibold">Record State</th>
                  </tr>
                </thead>
                <tbody>
                  {activeReport.students.map((st, idx) => (
                    <tr
                      key={st.studentId}
                      className="border-b border-stone-200 hover:bg-stone-50/70"
                    >
                      <td className="py-2 px-2.5 font-mono tabular-nums text-stone-500 border-r border-stone-200">
                        {idx + 1}
                      </td>
                      <td className="py-2 px-2.5 font-mono tabular-nums font-medium text-stone-900 border-r border-stone-200 whitespace-nowrap">
                        {st.rollNumber}
                      </td>
                      <td className="py-2 px-2.5 font-mono tabular-nums text-stone-600 border-r border-stone-200 whitespace-nowrap">
                        {st.permanentUniversityNumber || '—'}
                      </td>
                      <td className="py-2 px-2.5 font-medium text-stone-900 border-r border-stone-200">
                        {st.fullName}
                      </td>
                      <td className="py-2 px-2.5 text-stone-600 border-r border-stone-200 whitespace-nowrap">
                        {st.administrativeStatus}
                      </td>
                      <td className="py-2 px-2.5 text-stone-800 border-r border-stone-200 whitespace-nowrap">
                        {formatOutcomeText(st.outcome)}
                      </td>
                      {activeReport.assessment.assessmentType === 'TERM_TEST' ? (
                        <>
                          <td className="py-2 px-2.5 text-right font-mono tabular-nums font-semibold text-stone-900 border-r border-stone-200">
                            {st.outcome === 'MARKS_ENTERED'
                              ? `${formatNum2(st.theoryMarks)} / ${st.maxMarksTheory}`
                              : '—'}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono tabular-nums font-semibold text-stone-900 border-r border-stone-200">
                            {st.outcome === 'MARKS_ENTERED'
                              ? `${formatNum2(st.practicalMarks)} / ${st.maxMarksPractical}`
                              : '—'}
                          </td>
                        </>
                      ) : (
                        <td className="py-2 px-2.5 text-right font-mono tabular-nums font-semibold text-stone-900 border-r border-stone-200">
                          {st.outcome === 'MARKS_ENTERED'
                            ? `${formatNum2(st.theoryMarks)} / ${st.maxMarksTheory}`
                            : '—'}
                        </td>
                      )}
                      <td className="py-2 px-2.5 text-stone-700 whitespace-nowrap">
                        {st.entryState === 'SUBMITTED'
                          ? 'Submitted'
                          : st.entryState === 'DRAFT'
                            ? 'Draft (Unsubmitted)'
                            : 'Not Recorded'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse border border-stone-300">
                <thead>
                  <tr className="bg-[#FAF9F5] border-b border-stone-300 text-stone-800">
                    <th className="py-2 px-2.5 text-left font-semibold border-r border-stone-300 w-10">
                      #
                    </th>
                    <th className="py-2 px-2.5 text-left font-semibold border-r border-stone-300">
                      Roll Number
                    </th>
                    <th className="py-2 px-2.5 text-left font-semibold border-r border-stone-300">
                      Student Name
                    </th>
                    <th className="py-2 px-2.5 text-right font-semibold border-r border-stone-300">
                      Max IA
                    </th>
                    <th className="py-2 px-2.5 text-right font-semibold border-r border-stone-300">
                      Automatic IA
                    </th>
                    <th className="py-2 px-2.5 text-left font-semibold border-r border-stone-300">
                      Calc. Status
                    </th>
                    <th className="py-2 px-2.5 text-right font-semibold border-r border-stone-300">
                      Approved Final IA
                    </th>
                    <th className="py-2 px-2.5 text-left font-semibold border-r border-stone-300">
                      Final Approval Status
                    </th>
                    <th className="py-2 px-2.5 text-center font-semibold border-r border-stone-300">
                      Review Req.
                    </th>
                    <th className="py-2 px-2.5 text-left font-semibold">
                      Remarks / Pending Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activeReport.students.map((st, idx) => (
                    <tr
                      key={st.studentId}
                      className="border-b border-stone-200 hover:bg-stone-50/70"
                    >
                      <td className="py-2 px-2.5 font-mono tabular-nums text-stone-500 border-r border-stone-200">
                        {idx + 1}
                      </td>
                      <td className="py-2 px-2.5 font-mono tabular-nums font-medium text-stone-900 border-r border-stone-200 whitespace-nowrap">
                        {st.rollNumber}
                      </td>
                      <td className="py-2 px-2.5 font-medium text-stone-900 border-r border-stone-200">
                        {st.fullName}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono tabular-nums text-stone-700 border-r border-stone-200">
                        {st.iaMaximum !== null ? st.iaMaximum : 'N/A'}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono tabular-nums text-stone-900 border-r border-stone-200 whitespace-nowrap">
                        {st.calculationStatus === 'CALCULATED' && st.automaticIa !== null
                          ? formatNum2(st.automaticIa)
                          : st.calculationStatus === 'NOT_APPLICABLE'
                            ? 'N/A'
                            : 'Pending'}
                      </td>
                      <td className="py-2 px-2.5 text-stone-700 border-r border-stone-200 whitespace-nowrap">
                        {st.calculationStatus === 'CALCULATED'
                          ? 'Calculated'
                          : st.calculationStatus === 'PENDING'
                            ? 'Pending'
                            : 'Not Applicable'}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono tabular-nums font-semibold text-stone-900 border-r border-stone-200 whitespace-nowrap">
                        {st.approvedFinalIa !== null ? (
                          `${formatNum2(st.approvedFinalIa)}${
                            st.iaMaximum !== null ? ` / ${st.iaMaximum}` : ''
                          }`
                        ) : st.finalApprovalStatus === 'REQUIRES_REVIEW' &&
                          st.previouslyApprovedFinalIa !== null ? (
                          <span className="text-amber-800 font-normal">
                            Re-Review (Prev: {formatNum2(st.previouslyApprovedFinalIa)})
                          </span>
                        ) : (
                          <span className="text-stone-400 font-normal">Not Approved</span>
                        )}
                      </td>
                      <td className="py-2 px-2.5 text-stone-800 border-r border-stone-200 whitespace-nowrap">
                        {formatFinalApprovalStatusText(st.finalApprovalStatus)}
                      </td>
                      <td className="py-2 px-2.5 text-center font-medium border-r border-stone-200 whitespace-nowrap">
                        {st.reviewRequired ? (
                          <span className="text-amber-800 font-semibold">Yes</span>
                        ) : (
                          <span className="text-stone-600">No</span>
                        )}
                      </td>
                      <td className="py-2 px-2.5 text-stone-600">
                        {st.statusNote}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 4. Report Summary & Institutional Sign-Off Block */}
          <div className="pt-4 border-t border-stone-200 space-y-6 print-avoid-break">
            {activeReport.reportType === 'ASSESSMENT_REPORT' ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-600 font-mono tabular-nums">
                <span>Total Students: {activeReport.summary.totalStudents}</span>
                <span aria-hidden="true">·</span>
                <span>Marks Entered: {activeReport.summary.marksEnteredCount}</span>
                <span aria-hidden="true">·</span>
                <span>Absent: {activeReport.summary.absentCount}</span>
                <span aria-hidden="true">·</span>
                <span>Not Appeared: {activeReport.summary.notAppearedCount}</span>
                <span aria-hidden="true">·</span>
                <span>Exempted: {activeReport.summary.exemptedCount}</span>
                <span aria-hidden="true">·</span>
                <span>Not Recorded: {activeReport.summary.notRecordedCount}</span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-600 font-mono tabular-nums">
                <span>Total Students: {activeReport.summary.totalStudents}</span>
                <span aria-hidden="true">·</span>
                <span>Approved (Calculated): {activeReport.summary.approvedFinalCount}</span>
                <span aria-hidden="true">·</span>
                <span>Approved (Adjusted): {activeReport.summary.adjustedFinalCount}</span>
                <span aria-hidden="true">·</span>
                <span>Awaiting Approval: {activeReport.summary.awaitingApprovalCount}</span>
                <span aria-hidden="true">·</span>
                <span>Requires Re-Review: {activeReport.summary.requiresReviewCount}</span>
                <span aria-hidden="true">·</span>
                <span>Pending Calculation: {activeReport.summary.pendingCount}</span>
                <span aria-hidden="true">·</span>
                <span>Not Applicable: {activeReport.summary.notApplicableCount}</span>
              </div>
            )}

            <div className="grid grid-cols-3 gap-8 pt-8 text-xs text-stone-700">
              <div className="border-t border-stone-400 pt-2">
                <div className="font-semibold text-stone-900">Prepared / Verified By</div>
                <div className="text-[11px] text-stone-500 mt-0.5">Academic Office / Subject Coordinator</div>
              </div>
              <div className="border-t border-stone-400 pt-2">
                <div className="font-semibold text-stone-900">Head of Department</div>
                <div className="text-[11px] text-stone-500 mt-0.5">{activeReport.department.name}</div>
              </div>
              <div className="border-t border-stone-400 pt-2">
                <div className="font-semibold text-stone-900">Principal &amp; Institution Seal</div>
                <div className="text-[11px] text-stone-500 mt-0.5">{activeBranding.collegeName}</div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Report Branding Settings Modal (Office / Admin Only) */}
      {brandingModalOpen && canConfigureIa && (
        <div
          className="no-print fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-branding-modal-title"
        >
          <div className="bg-white rounded-xl border border-stone-200 shadow-xl max-w-lg w-full overflow-hidden">
            <div className="px-5 py-4 bg-[#4B2E2E] text-[#F5F5DC] flex items-center justify-between">
              <h3 id="report-branding-modal-title" className="text-sm font-bold">
                Official Report Header &amp; Logo Configuration
              </h3>
              <button
                type="button"
                onClick={() => setBrandingModalOpen(false)}
                className="text-[#F5F5DC]/80 hover:text-white p-1 rounded cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveBranding} className="p-5 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-stone-800 mb-1">
                  Institution / College Name
                </label>
                <input
                  type="text"
                  required
                  maxLength={250}
                  value={brandingForm.collegeName}
                  onChange={(e) =>
                    setBrandingForm((prev) => ({ ...prev, collegeName: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900"
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-800 mb-1">
                  Report Header Subtitle
                </label>
                <input
                  type="text"
                  maxLength={250}
                  value={brandingForm.subtitle}
                  onChange={(e) =>
                    setBrandingForm((prev) => ({ ...prev, subtitle: e.target.value }))
                  }
                  placeholder="Internal Assessment & Examination Cell"
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-stone-800">
                    College Logo Path or HTTPS / Data URL
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setBrandingForm((prev) => ({
                        ...prev,
                        logoUrl: '/assets/kamch-logo.png',
                      }))
                    }
                    className="text-[11px] font-medium text-[#4B2E2E] underline cursor-pointer"
                  >
                    Use Default KAMCH Crest
                  </button>
                </div>
                <input
                  type="text"
                  maxLength={450}
                  value={brandingForm.logoUrl}
                  onChange={(e) =>
                    setBrandingForm((prev) => ({ ...prev, logoUrl: e.target.value }))
                  }
                  placeholder="/assets/kamch-logo.png"
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 font-mono"
                />
                <p className="text-[11px] text-stone-500 mt-1">
                  Leave as <code>/assets/kamch-logo.png</code> to render the institutional KAMCH emblem offline.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-200">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setBrandingModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" size="sm" disabled={isSavingBranding}>
                  {isSavingBranding ? 'Saving...' : 'Save Branding'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
