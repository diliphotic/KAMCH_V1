import React, { useState, useEffect, useCallback } from 'react';
import {
  Save,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Award,
  Users,
  Lock,
  Send,
  ShieldAlert,
  X,
  Calculator,
  Settings2,
  Info,
  ShieldCheck,
  FileText,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { OfficeIaReviewPanel } from '../components/ia/OfficeIaReviewPanel';
import { IaReportsPanel } from '../components/ia/IaReportsPanel';

interface BatchItem {
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

interface PatTermMapping {
  A: string;
  B: string;
  C: string;
}

interface PatMappingConfig {
  term1: PatTermMapping;
  term2: PatTermMapping;
  term3: PatTermMapping;
}

interface SubjectItem {
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
  iaFormulaVerified: boolean;
  patMappingVerified: boolean;
  patMappingConfig: PatMappingConfig | null;
}

function isSubjectApplicableToBatch(subject: SubjectItem, batch: BatchItem | undefined): boolean {
  if (!batch) return false;
  if (batch.isLegacyMinimal || batch.schemeCode === 'RS6') return false;
  const subjScheme = subject.schemeCode || 'RS7';
  if (batch.schemeCode && subjScheme !== batch.schemeCode) return false;
  const batchProfYear = Number(batch.currentProfessionalYear);
  if (!Number.isInteger(batchProfYear) || batchProfYear <= 0) return false;
  return Number(subject.professionalYear) === batchProfYear;
}

interface DepartmentOption {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
}

interface AssessmentItem {
  id: number;
  code: string;
  name: string;
  assessmentType: 'PAT' | 'TERM_TEST' | 'UNIVERSITY_EXAM';
  termNumber: number;
  maxMarksTheory: number;
  maxMarksPractical: number;
}

interface StudentMarkEntry {
  id: number;
  studentIdNumber: string;
  temporaryRollNumber: string;
  permanentUniversityNumber: string | null;
  fullName: string;
  administrativeStatus: string;
  outcome: 'MARKS_ENTERED' | 'ABSENT' | 'NOT_APPEARED' | 'EXEMPTED';
  theoryMarks: string | number;
  practicalMarks: string | number;
  isDraft: boolean;
}

interface SubmissionInfo {
  submittedAt: string;
  submittedBy: string;
}

interface TermTestConversionRow {
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

interface StudentIaCalculationRow {
  studentId: number;
  studentIdNumber: string;
  temporaryRollNumber: string;
  permanentUniversityNumber: string | null;
  fullName: string;
  iaMaximum: number | null;
  term1: { A: number | null; B: number | null; C: number | null; D: number | null; E: number | null; F: number | null; H: number | null };
  term2: { A: number | null; B: number | null; C: number | null; D: number | null; E: number | null; F: number | null; H: number | null };
  term3: { A: number | null; B: number | null; C: number | null; D: number | null; E: number | null; H: number | null };
  finalAutomaticIa: number | null;
  termTestConversions: TermTestConversionRow[];
  sourceAssessments: {
    patMappingVerified: boolean;
    submittedCodes: string[];
    usedInCalculation: string[];
    missingRequiredCodes: string[];
  } | null;
  calculationStatus: 'CALCULATED' | 'PENDING' | 'NOT_APPLICABLE';
  statusReason: string | null;
  calculatedAt: string;
}

interface SubmittedAssessmentSummary {
  assessmentId: number;
  assessmentCode: string;
  assessmentName: string;
  assessmentType: string;
  termNumber: number;
  submittedAt: string;
  submittedBy: string;
}

const PAT_CODES = ['PAT_1', 'PAT_2', 'PAT_3', 'PAT_4', 'PAT_5', 'PAT_6', 'PAT_7', 'PAT_8', 'PAT_9'];

function formatMark(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return '—';
  return Number(val).toFixed(2);
}

export const MarksManagementView: React.FC = () => {
  const { user, csrfToken } = useAuth();
  const isDeptScoped = ['DEPARTMENT', 'HOD'].includes(user?.role || '');
  const canConfigureIa = ['SUPER_ADMIN', 'PRINCIPAL', 'SECRETARY', 'OFFICE', 'STAFF'].includes(
    user?.role || ''
  );

  const [activeSubView, setActiveSubView] = useState<
    'entry' | 'calculations' | 'office_review' | 'reports'
  >('entry');

  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [assessments, setAssessments] = useState<AssessmentItem[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);

  const [selectedBatchId, setSelectedBatchId] = useState<number | ''>('');
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | ''>('');
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<number | ''>('');

  const [studentsEntries, setStudentsEntries] = useState<StudentMarkEntry[]>([]);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submissionInfo, setSubmissionInfo] = useState<SubmissionInfo | null>(null);

  const [iaCalculations, setIaCalculations] = useState<StudentIaCalculationRow[]>([]);
  const [submittedAssessmentsList, setSubmittedAssessmentsList] = useState<SubmittedAssessmentSummary[]>([]);
  const [calcSummary, setCalcSummary] = useState<{
    studentCount: number;
    calculatedCount: number;
    pendingCount: number;
    notApplicableCount: number;
  } | null>(null);

  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);
  const [isLoadingCalculations, setIsLoadingCalculations] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [confirmSubmitModal, setConfirmSubmitModal] = useState(false);

  // Subject IA & PAT Mapping Configuration Modal (Authorized Office / Admin only)
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [cfgDepartmentId, setCfgDepartmentId] = useState<string>('');
  const [cfgPatVerified, setCfgPatVerified] = useState<boolean>(false);
  const [cfgPatMapping, setCfgPatMapping] = useState<PatMappingConfig>({
    term1: { A: 'PAT_1', B: 'PAT_2', C: 'PAT_3' },
    term2: { A: 'PAT_4', B: 'PAT_5', C: 'PAT_6' },
    term3: { A: 'PAT_7', B: 'PAT_8', C: 'PAT_9' },
  });
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadMetadata = useCallback(async () => {
    setIsLoadingMetadata(true);
    try {
      const requests: Promise<Response>[] = [
        fetch('/api/internal-assessment/batches'),
        fetch('/api/internal-assessment/subjects'),
        fetch('/api/internal-assessment/assessments'),
      ];
      if (canConfigureIa) {
        requests.push(fetch('/api/users/departments'));
      }

      const [batchRes, subjRes, assessRes, deptRes] = await Promise.all(requests);

      let bList: BatchItem[] = [];
      let sList: SubjectItem[] = [];

      if (batchRes.ok) {
        const data = await batchRes.json();
        bList = data.batches || [];
        setBatches(bList);
      }

      if (subjRes.ok) {
        const data = await subjRes.json();
        sList = data.subjects || [];
        setSubjects(sList);
      }

      if (bList.length > 0) {
        const preferredBatch =
          bList.find(
            (b) =>
              b.isActive !== false &&
              !b.isLegacyMinimal &&
              b.schemeCode !== 'RS6' &&
              Number(b.currentProfessionalYear) > 0 &&
              sList.some((s) => isSubjectApplicableToBatch(s, b))
          ) ||
          bList.find(
            (b) =>
              b.isActive !== false &&
              !b.isLegacyMinimal &&
              b.schemeCode !== 'RS6' &&
              Number(b.currentProfessionalYear) > 0
          ) ||
          bList[0];

        setSelectedBatchId((prev) => {
          const resolvedBatch =
            prev !== '' ? bList.find((b) => b.id === prev) || preferredBatch : preferredBatch;
          const compatibleSubjects = sList.filter((s) => isSubjectApplicableToBatch(s, resolvedBatch));
          setSelectedSubjectId((prevSubj) => {
            if (prevSubj !== '' && compatibleSubjects.some((x) => x.id === prevSubj)) {
              return prevSubj;
            }
            return compatibleSubjects.length > 0 ? compatibleSubjects[0].id : '';
          });
          return resolvedBatch.id;
        });
      } else {
        setSelectedSubjectId('');
      }

      if (assessRes.ok) {
        const data = await assessRes.json();
        const aList: AssessmentItem[] = data.assessments || [];
        setAssessments(aList);
        setSelectedAssessmentId((prev) => (prev === '' && aList.length > 0 ? aList[0].id : prev));
      }

      if (deptRes && deptRes.ok) {
        const data = await deptRes.json();
        setDepartments(data.departments || []);
      }
    } catch {
      setNotice({ type: 'error', message: 'Failed to load internal assessment metadata.' });
    } finally {
      setIsLoadingMetadata(false);
    }
  }, [canConfigureIa]);

  useEffect(() => {
    loadMetadata();
  }, [loadMetadata]);

  const handleBatchChange = useCallback(
    (nextBatchId: number) => {
      const nextBatch = batches.find((b) => b.id === nextBatchId);
      const compatibleSubjects = subjects.filter((s) => isSubjectApplicableToBatch(s, nextBatch));
      setNotice(null);
      setStudentsEntries([]);
      setIsSubmitted(false);
      setSubmissionInfo(null);
      setIaCalculations([]);
      setSubmittedAssessmentsList([]);
      setCalcSummary(null);
      setSelectedBatchId(nextBatchId);
      setSelectedSubjectId((prevSubj) => {
        if (prevSubj !== '' && compatibleSubjects.some((s) => s.id === prevSubj)) {
          return prevSubj;
        }
        return compatibleSubjects.length > 0 ? compatibleSubjects[0].id : '';
      });
    },
    [batches, subjects]
  );

  const loadStudentsAndMarks = useCallback(async () => {
    if (!selectedBatchId || !selectedSubjectId || !selectedAssessmentId) {
      setStudentsEntries([]);
      setIsSubmitted(false);
      setSubmissionInfo(null);
      return;
    }

    const batchObj = batches.find((b) => b.id === selectedBatchId);
    const subjectObj = subjects.find((s) => s.id === selectedSubjectId);
    if (!batchObj || !subjectObj || !isSubjectApplicableToBatch(subjectObj, batchObj)) {
      setStudentsEntries([]);
      setIsSubmitted(false);
      setSubmissionInfo(null);
      return;
    }

    setIsLoadingStudents(true);
    try {
      const res = await fetch(
        `/api/internal-assessment/marks-entry?batchId=${selectedBatchId}&subjectId=${selectedSubjectId}&assessmentId=${selectedAssessmentId}`
      );
      if (res.ok) {
        const data = await res.json();
        setStudentsEntries(data.students || []);
        setIsSubmitted(Boolean(data.isSubmitted));
        setSubmissionInfo(data.submissionInfo || null);
      } else {
        const errData = await res.json().catch(() => ({}));
        setNotice({ type: 'error', message: errData.error || 'Failed to load students for marks entry.' });
        setStudentsEntries([]);
        setIsSubmitted(false);
        setSubmissionInfo(null);
      }
    } catch {
      setNotice({ type: 'error', message: 'Network error loading marks entry list.' });
      setStudentsEntries([]);
      setIsSubmitted(false);
      setSubmissionInfo(null);
    } finally {
      setIsLoadingStudents(false);
    }
  }, [selectedBatchId, selectedSubjectId, selectedAssessmentId, batches, subjects]);

  const loadCalculations = useCallback(async () => {
    if (!selectedBatchId || !selectedSubjectId) {
      setIaCalculations([]);
      setSubmittedAssessmentsList([]);
      setCalcSummary(null);
      return;
    }

    const batchObj = batches.find((b) => b.id === selectedBatchId);
    const subjectObj = subjects.find((s) => s.id === selectedSubjectId);
    if (!batchObj || !subjectObj || !isSubjectApplicableToBatch(subjectObj, batchObj)) {
      setIaCalculations([]);
      setSubmittedAssessmentsList([]);
      setCalcSummary(null);
      return;
    }

    setIsLoadingCalculations(true);
    try {
      const res = await fetch(
        `/api/internal-assessment/calculations?batchId=${selectedBatchId}&subjectId=${selectedSubjectId}`
      );
      if (res.ok) {
        const data = await res.json();
        setIaCalculations(data.calculations || []);
        setSubmittedAssessmentsList(data.submittedAssessments || []);
        setCalcSummary(data.summary || null);
      } else {
        const errData = await res.json().catch(() => ({}));
        setNotice({ type: 'error', message: errData.error || 'Failed to load Automatic IA calculations.' });
      }
    } catch {
      setNotice({ type: 'error', message: 'Network error loading Automatic IA calculations.' });
    } finally {
      setIsLoadingCalculations(false);
    }
  }, [selectedBatchId, selectedSubjectId, batches, subjects]);

  useEffect(() => {
    if (activeSubView === 'entry') {
      loadStudentsAndMarks();
    } else if (activeSubView === 'calculations') {
      loadCalculations();
    }
  }, [activeSubView, loadStudentsAndMarks, loadCalculations]);

  const currentBatch = batches.find((b) => b.id === selectedBatchId);
  const filteredSubjects = subjects.filter((s) => isSubjectApplicableToBatch(s, currentBatch));

  useEffect(() => {
    if (filteredSubjects.length > 0) {
      if (!filteredSubjects.some((s) => s.id === selectedSubjectId)) {
        setSelectedSubjectId(filteredSubjects[0].id);
      }
    } else if (selectedSubjectId !== '') {
      setSelectedSubjectId('');
    }
  }, [selectedBatchId, currentBatch, subjects, filteredSubjects, selectedSubjectId]);

  const currentAssessment = assessments.find((a) => a.id === selectedAssessmentId);
  const currentSubject = subjects.find((s) => s.id === selectedSubjectId);
  const isPat = currentAssessment?.assessmentType === 'PAT';
  const isSubjectExcluded = Boolean(
    currentSubject && ['RESEARCH_METHODOLOGY', 'ATYAIKACHIKITSA'].includes(currentSubject.code)
  );
  const isDepartmentDeactivated = currentSubject?.departmentIsActive === false;

  const totalStudents = studentsEntries.length;
  const completedCount = studentsEntries.filter((s) => {
    if (s.outcome === 'MARKS_ENTERED') {
      if (isPat) return s.theoryMarks !== '' && s.theoryMarks !== null;
      return (
        s.theoryMarks !== '' &&
        s.theoryMarks !== null &&
        s.practicalMarks !== '' &&
        s.practicalMarks !== null
      );
    }
    return Boolean(s.outcome);
  }).length;
  const missingCount = totalStudents - completedCount;

  const handleEntryChange = (
    studentId: number,
    field: 'outcome' | 'theoryMarks' | 'practicalMarks',
    value: any
  ) => {
    if (isSubmitted || isDepartmentDeactivated) return;
    setStudentsEntries((prev) =>
      prev.map((entry) => {
        if (entry.id !== studentId) return entry;
        const updated = { ...entry, [field]: value };
        if (field === 'outcome' && value !== 'MARKS_ENTERED') {
          if (value === 'ABSENT') {
            updated.theoryMarks = 0;
            updated.practicalMarks = 0;
          } else {
            updated.theoryMarks = '';
            updated.practicalMarks = '';
          }
        }
        return updated;
      })
    );
  };

  const handleSaveDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBatchId || !selectedSubjectId || !selectedAssessmentId || isSubmitted) return;

    if (currentAssessment) {
      for (const entry of studentsEntries) {
        if (entry.outcome === 'MARKS_ENTERED') {
          if (entry.theoryMarks !== '' && entry.theoryMarks !== null) {
            const tm = Number(entry.theoryMarks);
            if (tm < 0 || (isPat && tm > 15)) {
              setNotice({
                type: 'error',
                message: `PAT marks for ${entry.fullName} must be between 0 and 15 (entered ${tm}).`,
              });
              return;
            }
            if (!isPat && (tm < 0 || tm > 100)) {
              setNotice({
                type: 'error',
                message: `Theory marks for ${entry.fullName} must be between 0 and 100 (entered ${tm}).`,
              });
              return;
            }
          }
          if (!isPat && entry.practicalMarks !== '' && entry.practicalMarks !== null) {
            const pm = Number(entry.practicalMarks);
            if (pm < 0 || pm > 100) {
              setNotice({
                type: 'error',
                message: `Practical marks for ${entry.fullName} must be between 0 and 100 (entered ${pm}).`,
              });
              return;
            }
          }
        }
      }
    }

    setIsSaving(true);
    setNotice(null);

    try {
      const payload = {
        batchId: selectedBatchId,
        subjectId: selectedSubjectId,
        assessmentId: selectedAssessmentId,
        entries: studentsEntries.map((s) => ({
          studentId: s.id,
          outcome: s.outcome,
          theoryMarks: s.theoryMarks === '' ? null : s.theoryMarks,
          practicalMarks: s.practicalMarks === '' ? null : s.practicalMarks,
        })),
      };

      const res = await fetch('/api/internal-assessment/marks-entry', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken || '',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok) {
        setNotice({ type: 'success', message: 'Marks draft saved. You may return later to complete or submit.' });
        loadStudentsAndMarks();
      } else {
        setNotice({ type: 'error', message: data.error || 'Failed to save marks draft.' });
      }
    } catch {
      setNotice({ type: 'error', message: 'Network error while saving marks draft.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleExecuteSubmit = async () => {
    if (!selectedBatchId || !selectedSubjectId || !selectedAssessmentId || isSubmitted) return;

    setIsSubmitting(true);
    setNotice(null);

    try {
      const payload = {
        batchId: selectedBatchId,
        subjectId: selectedSubjectId,
        assessmentId: selectedAssessmentId,
        entries: studentsEntries.map((s) => ({
          studentId: s.id,
          outcome: s.outcome,
          theoryMarks: s.theoryMarks === '' ? null : s.theoryMarks,
          practicalMarks: s.practicalMarks === '' ? null : s.practicalMarks,
        })),
      };

      const res = await fetch('/api/internal-assessment/submit-assessment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken || '',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok) {
        setIsSubmitted(true);
        setConfirmSubmitModal(false);
        setNotice({
          type: 'success',
          message: 'Assessment submitted, locked, and Automatic IA Calculation updated.',
        });
        loadStudentsAndMarks();
      } else {
        setNotice({ type: 'error', message: data.error || 'Failed to submit assessment.' });
      }
    } catch {
      setNotice({ type: 'error', message: 'Network error while submitting assessment.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleManualRecalculate = async () => {
    if (!selectedBatchId || !selectedSubjectId) return;
    setIsRecalculating(true);
    setNotice(null);
    try {
      const res = await fetch('/api/internal-assessment/recalculate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken || '',
        },
        body: JSON.stringify({ batchId: selectedBatchId, subjectId: selectedSubjectId }),
      });
      const data = await res.json();
      if (res.ok) {
        setNotice({ type: 'success', message: 'Automatic IA calculation refreshed from submitted assessments.' });
        loadCalculations();
      } else {
        setNotice({ type: 'error', message: data.error || 'Failed to recalculate IA.' });
      }
    } catch {
      setNotice({ type: 'error', message: 'Network error while recalculating IA.' });
    } finally {
      setIsRecalculating(false);
    }
  };

  const openSubjectConfigModal = () => {
    if (!currentSubject) return;
    setCfgDepartmentId(currentSubject.departmentId ? String(currentSubject.departmentId) : '');
    setCfgPatVerified(Boolean(currentSubject.patMappingVerified));
    setCfgPatMapping(
      currentSubject.patMappingConfig || {
        term1: { A: 'PAT_1', B: 'PAT_2', C: 'PAT_3' },
        term2: { A: 'PAT_4', B: 'PAT_5', C: 'PAT_6' },
        term3: { A: 'PAT_7', B: 'PAT_8', C: 'PAT_9' },
      }
    );
    setConfigModalOpen(true);
  };

  const handleSaveSubjectConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentSubject) return;
    setIsSavingConfig(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/internal-assessment/subjects/${currentSubject.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken || '',
        },
        body: JSON.stringify({
          departmentId: cfgDepartmentId ? Number(cfgDepartmentId) : null,
          patMappingVerified: cfgPatVerified,
          patMappingConfig: cfgPatVerified ? cfgPatMapping : null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setConfigModalOpen(false);
        setNotice({
          type: 'success',
          message: 'Subject configuration saved and Automatic IA calculations updated.',
        });
        await loadMetadata();
        if (activeSubView === 'calculations') {
          await loadCalculations();
        }
      } else {
        setNotice({ type: 'error', message: data.error || 'Failed to save subject configuration.' });
      }
    } catch {
      setNotice({ type: 'error', message: 'Network error saving subject configuration.' });
    } finally {
      setIsSavingConfig(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="no-print space-y-5">
        <PageHeader
          title="Internal Assessment Marks & Final IA"
          description={
            canConfigureIa
              ? 'Enter draft marks, lock submitted assessments, inspect Automatic IA, approve Final IA marks, and export official reports.'
              : 'Enter draft marks, lock submitted assessments, review Automatic IA calculations, and print department reports.'
          }
          actions={
            <div className="flex items-center gap-2 flex-wrap">
              {canConfigureIa && currentSubject && activeSubView !== 'reports' && (
                <Button
                  variant="outline"
                  size="sm"
                  icon={<Settings2 className="w-3.5 h-3.5" />}
                  onClick={openSubjectConfigModal}
                >
                  Subject &amp; PAT Mapping
                </Button>
              )}
              {activeSubView !== 'office_review' && activeSubView !== 'reports' && (
                <Button
                  variant="outline"
                  size="sm"
                  icon={
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${
                        isLoadingStudents || isLoadingCalculations || isLoadingMetadata ? 'animate-spin' : ''
                      }`}
                    />
                  }
                  onClick={() => (activeSubView === 'entry' ? loadStudentsAndMarks() : loadCalculations())}
                >
                  Refresh
                </Button>
              )}
            </div>
          }
        />

        {/* Mode Switcher */}
        <div className="flex items-center gap-2 flex-wrap border-b border-stone-200 pb-3">
          <button
            type="button"
            onClick={() => setActiveSubView('entry')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0 ${
              activeSubView === 'entry'
                ? 'bg-[#4B2E2E] text-[#F5F5DC]'
                : 'bg-white border border-stone-300 text-stone-700 hover:bg-stone-50'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Assessment Marks Entry &amp; Submission</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubView('calculations')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0 ${
              activeSubView === 'calculations'
                ? 'bg-[#4B2E2E] text-[#F5F5DC]'
                : 'bg-white border border-stone-300 text-stone-700 hover:bg-stone-50'
            }`}
          >
            <Calculator className="w-3.5 h-3.5" />
            <span>Automatic IA Calculation</span>
          </button>
          {canConfigureIa && (
            <button
              type="button"
              onClick={() => setActiveSubView('office_review')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0 ${
                activeSubView === 'office_review'
                  ? 'bg-[#4B2E2E] text-[#F5F5DC]'
                  : 'bg-white border border-stone-300 text-stone-700 hover:bg-stone-50'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Office Review &amp; Final Approval</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setActiveSubView('reports')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0 ${
              activeSubView === 'reports'
                ? 'bg-[#4B2E2E] text-[#F5F5DC]'
                : 'bg-white border border-stone-300 text-stone-700 hover:bg-stone-50'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Reports &amp; Exports</span>
          </button>
        </div>

        {notice && (
          <div
            className={`p-3.5 rounded-lg border text-xs flex items-center gap-2.5 ${
              notice.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}
            role="alert"
          >
            {notice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{notice.message}</span>
          </div>
        )}

        {isDeptScoped && subjects.length === 0 && !isLoadingMetadata && (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs flex items-start gap-3">
            <Info className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">No Subjects Linked to Your Department Yet</p>
              <p className="text-stone-700 mt-0.5">
                Please ask an authorized Office or Administrative user to associate your department with its curriculum subjects using the Subject &amp; PAT Mapping control.
              </p>
            </div>
          </div>
        )}

        {isDepartmentDeactivated && activeSubView !== 'reports' && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-950 text-xs flex items-start gap-3">
            <ShieldAlert className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Department Deactivated — Read-Only Historical Mode</p>
              <p className="text-rose-800 mt-0.5">
                This department is currently inactive. New marks entry and assessment submissions are blocked while historical records and IA calculations remain accessible.
              </p>
            </div>
          </div>
        )}
      </div>

      {activeSubView === 'reports' ? (
        <IaReportsPanel
          batches={batches}
          subjects={subjects}
          departments={departments}
          assessments={assessments}
          csrfToken={csrfToken}
        />
      ) : activeSubView === 'office_review' && canConfigureIa ? (
        <OfficeIaReviewPanel
          batches={batches}
          subjects={subjects}
          departments={departments}
          selectedBatchId={selectedBatchId}
          selectedSubjectId={selectedSubjectId}
          onSelectBatch={handleBatchChange}
          onSelectSubject={(id) => setSelectedSubjectId(id)}
          csrfToken={csrfToken}
        />
      ) : (
        <>
          {/* Filter / Selection Card */}
          <Card accentTop>
            <CardHeader>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#4B2E2E]/10 text-[#4B2E2E] flex items-center justify-center">
                  <Award className="w-4 h-4" />
                </div>
                <div>
                  <CardTitle>Academic Scope Selection</CardTitle>
                  <CardDescription>
                    Select academic batch and subject{activeSubView === 'entry' ? ', plus target assessment' : ''}.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className={`grid grid-cols-1 ${activeSubView === 'entry' ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-4`}>
                <div>
                  <label className="block text-xs font-semibold text-stone-800 mb-1">Academic Batch</label>
                  <select
                    value={selectedBatchId}
                    onChange={(e) => handleBatchChange(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 min-h-[38px]"
                  >
                    {batches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.admissionAcademicYear}){b.schemeCode ? ` — ${b.schemeCode}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-800 mb-1">Subject</label>
                  <select
                    value={filteredSubjects.length > 0 ? selectedSubjectId : ''}
                    onChange={(e) => setSelectedSubjectId(e.target.value ? Number(e.target.value) : '')}
                    disabled={filteredSubjects.length === 0}
                    className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 disabled:bg-stone-100 disabled:text-stone-500 min-h-[38px]"
                  >
                    {filteredSubjects.length === 0 ? (
                      <option value="">No applicable subjects for selected batch</option>
                    ) : (
                      filteredSubjects.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.isIaEnabled ? `Max IA: ${s.iaMaximum}` : 'No IA'})
                        </option>
                      ))
                    )}
                  </select>
                </div>

                {activeSubView === 'entry' && (
                  <div>
                    <label className="block text-xs font-semibold text-stone-800 mb-1">Assessment</label>
                    <select
                      value={selectedAssessmentId}
                      onChange={(e) => setSelectedAssessmentId(Number(e.target.value))}
                      className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 min-h-[38px]"
                    >
                      {assessments.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.assessmentType === 'PAT' ? 'Max 15' : 'Theory 100 / Practical 100'})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {activeSubView === 'entry' ? (
        <>
          {isSubmitted && (
            <div className="p-4 rounded-xl bg-amber-50/80 border border-amber-300 text-amber-950 text-xs flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 mt-0.5">
                <Lock className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-serif font-bold text-sm text-stone-900">Assessment Submitted &amp; Locked</h4>
                <p className="text-stone-700 mt-0.5 leading-relaxed">
                  Submitted by <strong>{submissionInfo?.submittedBy || 'Authorized Staff'}</strong> on{' '}
                  <strong>
                    {submissionInfo?.submittedAt ? new Date(submissionInfo.submittedAt).toLocaleString() : 'Recorded'}
                  </strong>
                  . Submitted marks are locked against editing or duplicate submission and have been incorporated into Automatic IA Calculation.
                </p>
              </div>
            </div>
          )}

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2.5">
                  <Users className="w-4 h-4 text-[#D4AF37]" />
                  <div>
                    <CardTitle>
                      Student Marks Entry {currentAssessment ? `— ${currentAssessment.name}` : ''}
                    </CardTitle>
                    <CardDescription>
                      {currentSubject ? `Subject: ${currentSubject.name}` : ''} | Students: {totalStudents} | Completed:{' '}
                      {completedCount} | Missing: {missingCount}
                    </CardDescription>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!isSubmitted && !isDepartmentDeactivated && currentSubject?.code !== 'ATYAIKACHIKITSA' && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        icon={<Save className="w-3.5 h-3.5" />}
                        isLoading={isSaving}
                        onClick={handleSaveDraft}
                        disabled={studentsEntries.length === 0}
                      >
                        Save as Draft
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        icon={<Send className="w-3.5 h-3.5" />}
                        onClick={() => {
                          if (missingCount > 0) {
                            setNotice({
                              type: 'error',
                              message: `Cannot submit: ${missingCount} student(s) have unrecorded outcomes. Every student must have an outcome before submission.`,
                            });
                            return;
                          }
                          setConfirmSubmitModal(true);
                        }}
                        disabled={studentsEntries.length === 0}
                      >
                        Submit Assessment
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#FAF9F5] border-b border-stone-200 text-stone-700 font-semibold text-[11px] uppercase tracking-wider">
                      <th className="py-3 px-4">Roll Number</th>
                      <th className="py-3 px-4">Student Name</th>
                      <th className="py-3 px-4">Outcome</th>
                      {isPat ? (
                        <th className="py-3 px-4">Marks (Max 15)</th>
                      ) : (
                        <>
                          <th className="py-3 px-4">Theory Marks (Max 100)</th>
                          <th className="py-3 px-4">Practical Marks (Max 100)</th>
                        </>
                      )}
                      <th className="py-3 px-4 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {isLoadingStudents ? (
                      <tr>
                        <td colSpan={isPat ? 5 : 6} className="py-12 text-center text-stone-500">
                          <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#D4AF37]" />
                          Loading student list...
                        </td>
                      </tr>
                    ) : currentSubject?.code === 'ATYAIKACHIKITSA' ? (
                      <tr>
                        <td colSpan={isPat ? 5 : 6} className="py-12 text-center text-stone-600">
                          Atyaikachikitsa is recorded as a curriculum subject record only with no assessment structure.
                        </td>
                      </tr>
                    ) : studentsEntries.length === 0 ? (
                      <tr>
                        <td colSpan={isPat ? 5 : 6} className="py-12 text-center text-stone-500">
                          No students found for this academic batch.
                        </td>
                      </tr>
                    ) : (
                      studentsEntries.map((student) => {
                        const isEntered = student.outcome === 'MARKS_ENTERED';
                        const rowLocked = isSubmitted || isDepartmentDeactivated;
                        return (
                          <tr key={student.id} className="hover:bg-stone-50/70 transition-colors">
                            <td className="py-3 px-4 font-mono tabular-nums font-semibold text-[#4B2E2E]">
                              {student.temporaryRollNumber || student.studentIdNumber}
                            </td>
                            <td className="py-3 px-4 font-medium text-stone-900">{student.fullName}</td>
                            <td className="py-3 px-4">
                              <select
                                value={student.outcome}
                                disabled={rowLocked}
                                onChange={(e) => handleEntryChange(student.id, 'outcome', e.target.value)}
                                className="py-1 px-2.5 text-xs bg-white border border-stone-300 rounded-md text-stone-800 disabled:bg-stone-100 disabled:text-stone-500 min-h-[32px]"
                              >
                                <option value="MARKS_ENTERED">Marks Entered</option>
                                <option value="ABSENT">Absent (0)</option>
                                <option value="NOT_APPEARED">Not Appeared</option>
                                <option value="EXEMPTED">Exempted</option>
                              </select>
                            </td>

                            {isPat ? (
                              <td className="py-3 px-4">
                                <input
                                  type="number"
                                  step="0.5"
                                  min="0"
                                  max="15"
                                  disabled={!isEntered || rowLocked}
                                  placeholder="0 - 15"
                                  value={student.theoryMarks}
                                  onChange={(e) => handleEntryChange(student.id, 'theoryMarks', e.target.value)}
                                  className="w-28 px-2.5 py-1 text-xs bg-white border border-stone-300 rounded-md text-stone-900 font-mono tabular-nums disabled:bg-stone-100 disabled:text-stone-400 min-h-[32px]"
                                />
                              </td>
                            ) : (
                              <>
                                <td className="py-3 px-4">
                                  <input
                                    type="number"
                                    step="0.5"
                                    min="0"
                                    max="100"
                                    disabled={!isEntered || rowLocked}
                                    placeholder="0 - 100"
                                    value={student.theoryMarks}
                                    onChange={(e) => handleEntryChange(student.id, 'theoryMarks', e.target.value)}
                                    className="w-28 px-2.5 py-1 text-xs bg-white border border-stone-300 rounded-md text-stone-900 font-mono tabular-nums disabled:bg-stone-100 disabled:text-stone-400 min-h-[32px]"
                                  />
                                </td>
                                <td className="py-3 px-4">
                                  <input
                                    type="number"
                                    step="0.5"
                                    min="0"
                                    max="100"
                                    disabled={!isEntered || rowLocked}
                                    placeholder="0 - 100"
                                    value={student.practicalMarks}
                                    onChange={(e) => handleEntryChange(student.id, 'practicalMarks', e.target.value)}
                                    className="w-28 px-2.5 py-1 text-xs bg-white border border-stone-300 rounded-md text-stone-900 font-mono tabular-nums disabled:bg-stone-100 disabled:text-stone-400 min-h-[32px]"
                                  />
                                </td>
                              </>
                            )}

                            <td className="py-3 px-4 text-right">
                              <Badge variant={isSubmitted ? 'success' : student.isDraft ? 'warning' : 'neutral'} size="sm">
                                {isSubmitted ? 'Submitted / Locked' : 'Draft'}
                              </Badge>
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
        </>
      ) : (
        /* STEP 2D: AUTOMATIC IA CALCULATION VIEW */
        <div className="space-y-4">
          {/* Subject Formula & PAT Mapping Status Banner */}
          {currentSubject && (
            <Card>
              <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-serif font-bold text-sm text-[#4B2E2E]">{currentSubject.name}</span>
                    {isSubjectExcluded || currentBatch?.isLegacyMinimal ? (
                      <Badge variant="neutral" size="sm">Not Applicable for Automatic IA</Badge>
                    ) : currentSubject.iaFormulaVerified ? (
                      <Badge variant="success" size="sm">Verified IA Max: {currentSubject.iaMaximum}</Badge>
                    ) : (
                      <Badge variant="warning" size="sm">IA Formula Pending Verification</Badge>
                    )}
                    {!isSubjectExcluded && !currentBatch?.isLegacyMinimal && (
                      <Badge variant={currentSubject.patMappingVerified ? 'success' : 'warning'} size="sm">
                        {currentSubject.patMappingVerified
                          ? 'PAT Mapping Verified'
                          : 'PAT Mapping Unverified (Pending)'}
                      </Badge>
                    )}
                  </div>
                  <p className="text-stone-600 leading-relaxed">
                    {currentSubject.code === 'RESEARCH_METHODOLOGY'
                      ? 'Research Methodology and Medical Statistics has no Internal Assessment calculation.'
                      : currentSubject.code === 'ATYAIKACHIKITSA'
                        ? 'Atyaikachikitsa is maintained as a subject record only with no assessment structure or IA calculation.'
                        : currentBatch?.isLegacyMinimal
                          ? 'RS6 Legacy cohort uses minimal historical records; RS7 automatic IA formulas are not applied.'
                          : currentSubject.patMappingVerified && currentSubject.patMappingConfig
                            ? `Verified Periodic Inputs — Term 1: (${currentSubject.patMappingConfig.term1.A}, ${currentSubject.patMappingConfig.term1.B}, ${currentSubject.patMappingConfig.term1.C}) | Term 2: (${currentSubject.patMappingConfig.term2.A}, ${currentSubject.patMappingConfig.term2.B}, ${currentSubject.patMappingConfig.term2.C}) | Term 3: (${currentSubject.patMappingConfig.term3.A}, ${currentSubject.patMappingConfig.term3.B}, ${currentSubject.patMappingConfig.term3.C}; no Term 3 test).`
                            : 'Periodic PAT-to-Term (A, B, C) mapping is not yet verified. Term-Test conversions (F1, F2) are computed separately when submitted, while Final Automatic IA remains Pending without fabricating PAT averages.'}
                  </p>
                  {submittedAssessmentsList.length > 0 && (
                    <p className="text-[11px] text-stone-500">
                      Submitted Source Assessments ({submittedAssessmentsList.length}):{' '}
                      <span className="font-mono text-stone-800">
                        {submittedAssessmentsList.map((a) => a.assessmentCode).join(', ')}
                      </span>
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {calcSummary && (
                    <div className="text-right mr-2 hidden sm:block">
                      <div className="text-[11px] text-stone-500">Batch Summary</div>
                      <div className="font-mono tabular-nums font-semibold text-stone-800">
                        {calcSummary.calculatedCount} Calculated / {calcSummary.pendingCount} Pending
                      </div>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<Calculator className="w-3.5 h-3.5" />}
                    isLoading={isRecalculating}
                    onClick={handleManualRecalculate}
                  >
                    Recalculate IA
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Automatic IA Breakdown Table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2.5">
                  <Calculator className="w-4 h-4 text-[#D4AF37]" />
                  <div>
                    <CardTitle>Automatic Internal Assessment Results</CardTitle>
                    <CardDescription>
                      Raw marks remain preserved. Term-test conversions (F1, F2), periodic averages (E1, E2, E3), term scores (H1, H2, H3), and Final Automatic IA are stored separately.
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
                      <th className="py-3 px-3">Roll No</th>
                      <th className="py-3 px-3">Student Name</th>
                      <th className="py-3 px-3 text-right">Term 1 (E1 / F1 / H1)</th>
                      <th className="py-3 px-3 text-right">Term 2 (E2 / F2 / H2)</th>
                      <th className="py-3 px-3 text-right">Term 3 (E3 = H3)</th>
                      <th className="py-3 px-3 text-right">
                        Automatic IA {currentSubject?.isIaEnabled ? `(/${currentSubject.iaMaximum})` : ''}
                      </th>
                      <th className="py-3 px-3">Status &amp; Explanation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {isLoadingCalculations ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-stone-500">
                          <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#D4AF37]" />
                          Loading Automatic IA calculations...
                        </td>
                      </tr>
                    ) : iaCalculations.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-stone-500">
                          No students found in this academic batch.
                        </td>
                      </tr>
                    ) : (
                      iaCalculations.map((row) => {
                        const tt1Conv = row.termTestConversions.find((c) => c.termNumber === 1);
                        const tt2Conv = row.termTestConversions.find((c) => c.termNumber === 2);
                        return (
                          <tr key={row.studentId} className="hover:bg-stone-50/70 transition-colors align-top">
                            <td className="py-3 px-3 font-mono tabular-nums font-semibold text-[#4B2E2E]">
                              {row.temporaryRollNumber || row.studentIdNumber}
                            </td>
                            <td className="py-3 px-3">
                              <div className="font-medium text-stone-900">{row.fullName}</div>
                              <div className="text-[11px] text-stone-500 mt-0.5">
                                Updated: {row.calculatedAt ? new Date(row.calculatedAt).toLocaleString() : '—'}
                              </div>
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums">
                              <div className="text-stone-900 font-semibold">H1: {formatMark(row.term1.H)}</div>
                              <div className="text-[11px] text-stone-500">
                                E1: {formatMark(row.term1.E)} | F1: {formatMark(row.term1.F)}
                              </div>
                              {tt1Conv && tt1Conv.combinedRawMarks !== null && (
                                <div className="text-[10px] text-stone-400">
                                  Raw TT1: {tt1Conv.rawTheoryMarks}+{tt1Conv.rawPracticalMarks}={tt1Conv.combinedRawMarks}/200
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums">
                              <div className="text-stone-900 font-semibold">H2: {formatMark(row.term2.H)}</div>
                              <div className="text-[11px] text-stone-500">
                                E2: {formatMark(row.term2.E)} | F2: {formatMark(row.term2.F)}
                              </div>
                              {tt2Conv && tt2Conv.combinedRawMarks !== null && (
                                <div className="text-[10px] text-stone-400">
                                  Raw TT2: {tt2Conv.rawTheoryMarks}+{tt2Conv.rawPracticalMarks}={tt2Conv.combinedRawMarks}/200
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums">
                              <div className="text-stone-900 font-semibold">H3: {formatMark(row.term3.H)}</div>
                              <div className="text-[11px] text-stone-500">E3: {formatMark(row.term3.E)}</div>
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums">
                              <span className="text-sm font-bold text-[#4B2E2E]">
                                {formatMark(row.finalAutomaticIa)}
                              </span>
                            </td>
                            <td className="py-3 px-3 max-w-xs">
                              <Badge
                                variant={
                                  row.calculationStatus === 'CALCULATED'
                                    ? 'success'
                                    : row.calculationStatus === 'NOT_APPLICABLE'
                                      ? 'neutral'
                                      : 'warning'
                                }
                                size="sm"
                              >
                                {row.calculationStatus}
                              </Badge>
                              {row.statusReason && (
                                <p className="text-[11px] text-stone-600 mt-1 leading-snug">{row.statusReason}</p>
                              )}
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
        </div>
          )}
        </>
      )}

      {/* CONFIRM SUBMISSION MODAL */}
      {confirmSubmitModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-lg bg-white rounded-xl border border-stone-200 shadow-2xl overflow-hidden my-auto p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-[#4B2E2E] text-[#F5F5DC] flex items-center justify-center font-bold">
                  <Send className="w-4 h-4 text-[#D4AF37]" />
                </div>
                <div>
                  <h3 className="font-serif text-base font-bold text-stone-900">Confirm Assessment Submission</h3>
                  <p className="text-xs text-stone-500">Final institutional submission, locking &amp; IA update</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfirmSubmitModal(false)}
                className="text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-stone-700">
              <div className="p-3.5 bg-[#FAF9F5] rounded-lg border border-stone-200 space-y-2">
                <div className="flex justify-between">
                  <span className="text-stone-500">Assessment:</span>
                  <span className="font-semibold text-stone-900">{currentAssessment?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Subject:</span>
                  <span className="font-semibold text-stone-900">{currentSubject?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Academic Batch:</span>
                  <span className="font-semibold text-stone-900">{currentBatch?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Total Students:</span>
                  <span className="font-mono tabular-nums font-semibold text-stone-900">{totalStudents}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Completed Outcomes:</span>
                  <span className="font-mono tabular-nums font-semibold text-emerald-700">
                    {completedCount} / {totalStudents}
                  </span>
                </div>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-950 space-y-1">
                <p className="font-bold flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>Permanent Locking Notice</span>
                </p>
                <p className="text-[11px] leading-relaxed">
                  Once submitted, this assessment is locked immediately against department edits or duplicate submission, and Automatic IA Calculation will refresh from submitted records.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-200">
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirmSubmitModal(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                isLoading={isSubmitting}
                icon={<Send className="w-3.5 h-3.5" />}
                onClick={handleExecuteSubmit}
              >
                Confirm &amp; Lock Assessment
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* SUBJECT DEPARTMENT & PAT MAPPING CONFIGURATION MODAL (OFFICE / ADMIN ONLY) */}
      {configModalOpen && currentSubject && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleSaveSubjectConfig}
            className="relative w-full max-w-xl bg-white rounded-xl border border-stone-200 shadow-2xl overflow-hidden my-auto p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <div>
                <h3 className="font-serif text-base font-bold text-stone-900">
                  Subject &amp; PAT Mapping Configuration
                </h3>
                <p className="text-xs text-stone-500">
                  {currentSubject.name} ({currentSubject.code})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfigModalOpen(false)}
                className="text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-stone-800 mb-1">Assigned Department</label>
                <select
                  value={cfgDepartmentId}
                  onChange={(e) => setCfgDepartmentId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-stone-900"
                >
                  <option value="">— Unassigned —</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.code}){!d.isActive ? ' [Inactive]' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {isSubjectExcluded ? (
                <div className="p-3 bg-stone-100 border border-stone-200 rounded-lg text-stone-700">
                  This curriculum subject does not participate in Automatic IA calculation.
                </div>
              ) : (
                <div className="space-y-3 p-3.5 bg-[#FAF9F5] border border-stone-200 rounded-lg">
                  <label className="flex items-center gap-2 font-semibold text-stone-900 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfgPatVerified}
                      onChange={(e) => setCfgPatVerified(e.target.checked)}
                      className="rounded border-stone-300"
                    />
                    <span>Verify &amp; Enable Explicit PAT-to-Term Periodic Inputs (A, B, C)</span>
                  </label>
                  <p className="text-[11px] text-stone-600">
                    Automatic IA never averages all nine PATs or assumes an unverified mapping. Enable only when the three periodic assessment inputs (A, B, C) per term are institutionally verified.
                  </p>

                  {cfgPatVerified && (
                    <div className="space-y-3 pt-2">
                      {(['term1', 'term2', 'term3'] as const).map((tKey, idx) => (
                        <div key={tKey} className="grid grid-cols-4 gap-2 items-center">
                          <span className="font-semibold text-stone-800">Term {idx + 1} (A, B, C):</span>
                          {(['A', 'B', 'C'] as const).map((slot) => (
                            <select
                              key={slot}
                              value={cfgPatMapping[tKey][slot]}
                              onChange={(e) =>
                                setCfgPatMapping((prev) => ({
                                  ...prev,
                                  [tKey]: { ...prev[tKey], [slot]: e.target.value },
                                }))
                              }
                              className="px-2 py-1.5 bg-white border border-stone-300 rounded-md font-mono text-xs"
                            >
                              {PAT_CODES.map((code) => (
                                <option key={code} value={code}>
                                  {slot}: {code}
                                </option>
                              ))}
                            </select>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-200">
              <Button type="button" variant="outline" size="sm" onClick={() => setConfigModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" isLoading={isSavingConfig}>
                Save Configuration
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
