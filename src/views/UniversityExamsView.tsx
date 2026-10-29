import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Users,
  ShieldAlert,
  Save,
  Check,
  Lock,
  Unlock,
  ArrowRight,
  GraduationCap,
  AlertTriangle,
  FileCheck2,
  ListFilter,
  CheckCheck,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { FormField, Input, Select, Textarea } from '../components/ui/FormField';

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

interface UniversitySubject {
  id: number;
  code: string;
  name: string;
  professionalYear: number;
  maxMarks: number;
}

interface StudentAttempt {
  id: number;
  subjectId: number;
  subjectCode: string;
  subjectName: string;
  professionalYear: number;
  examSessionRef: string;
  attemptType: 'REGULAR' | 'SUPPLEMENTARY';
  resultStatus: 'PASS' | 'FAIL' | 'PENDING' | 'WITHHELD';
  marksObtained: number | null;
  failedSubjects: number[];
  officeDecision: 'PROMOTED' | 'DETAINED' | 'PENDING';
  isFinalized?: boolean;
  finalizedBy?: number | null;
  finalizedByName?: string | null;
  finalizedAt?: string | null;
  finalizationRemarks?: string | null;
  recordedAt: string;
}

interface StudentExamResult {
  id: number;
  studentIdNumber: string;
  temporaryRollNumber: string;
  permanentUniversityNumber: string | null;
  fullName: string;
  originalBatchId?: number | null;
  originalBatchName?: string;
  currentPlacementBatchId?: number | null;
  currentYearOfStudy?: number;
  detentionStage?: number;
  progressionStatus?: string;
  outstandingBacklogsCount?: number;
  attempts: StudentAttempt[];
}

interface PromotionPreviewStudent {
  studentId: number;
  studentIdNumber: string;
  temporaryRollNumber: string;
  permanentUniversityNumber: string | null;
  fullName: string;
  originalBatchId: number | null;
  originalBatchName: string;
  currentPlacementBatchId: number | null;
  currentPlacementBatchName: string;
  currentYearOfStudy: number;
  schemeCode: string;
  finalizedResultsCount: number;
  totalRequiredSubjectsCount: number;
  failedSubjects: Array<{ id: number; code: string; name: string }>;
  administrativeOutcome: 'PASSED' | 'FAILED — PROMOTED' | 'FAILED — DETAINED' | 'PENDING' | 'WITHHELD';
  proposedDecision: string;
  proposedProfessionalYear: number;
  proposedPlacementBatchId: number | null;
  proposedPlacementBatchName: string;
  proposalReason: string;
  applicableRule: string;
  unverifiedThirdProfRuleNote: string | null;
  canConfirm: boolean;
}

interface PromotionPreviewStats {
  totalStudents: number;
  passed: number;
  failedPromoted: number;
  failedDetained: number;
  pendingOrWithheld: number;
  eligibleToConfirm: number;
}

export const UniversityExamsView: React.FC = () => {
  const { user, csrfToken } = useAuth();
  const [activeTab, setActiveTab] = useState<'entry' | 'review' | 'preview'>('entry');

  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);

  const [batchProfile, setBatchProfile] = useState<{
    batchName: string;
    schemeCode: string;
    professionalYear: number | null;
  } | null>(null);

  const [subjects, setSubjects] = useState<UniversitySubject[]>([]);
  const [students, setStudents] = useState<StudentExamResult[]>([]);

  // Examination session & attempt state
  const [examSessionRef, setExamSessionRef] = useState('RGUHS_2026_MAY');
  const [attemptType, setAttemptType] = useState<'REGULAR' | 'SUPPLEMENTARY'>('REGULAR');

  // Draft results map for entry tab: studentId -> { subjectId, resultStatus, marksObtained, failedSubjectIds, officeDecision }
  const [draftResults, setDraftResults] = useState<
    Map<
      number,
      {
        subjectId: number;
        resultStatus: 'PASS' | 'FAIL' | 'PENDING' | 'WITHHELD';
        marksObtained: string;
        failedSubjectIds: number[];
        officeDecision: 'PROMOTED' | 'DETAINED' | 'PENDING';
      }
    >
  >(new Map());

  // Promotion preview data
  const [previewStudents, setPreviewStudents] = useState<PromotionPreviewStudent[]>([]);
  const [previewStats, setPreviewStats] = useState<PromotionPreviewStats | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  // Finalization modal state
  const [isFinalizeModalOpen, setIsFinalizeModalOpen] = useState(false);
  const [finalizeRemarks, setFinalizeRemarks] = useState('Official university exam results verified and finalized.');
  const [isSubmittingFinalize, setIsSubmittingFinalize] = useState(false);

  // Reopen correction modal state
  const [reopenAttemptId, setReopenAttemptId] = useState<number | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [isSubmittingReopen, setIsSubmittingReopen] = useState(false);

  // Promotion confirmation modal state
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [hasAcknowledgedGazette, setHasAcknowledgedGazette] = useState(false);
  const [isSubmittingProgression, setIsSubmittingProgression] = useState(false);

  const [isLoadingBatches, setIsLoadingBatches] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const isAuthorizedOffice = user && ['SUPER_ADMIN', 'PRINCIPAL', 'SECRETARY', 'OFFICE'].includes(user.role);

  // 1. Fetch Batches on mount
  useEffect(() => {
    const fetchBatches = async () => {
      setIsLoadingBatches(true);
      try {
        const res = await fetch('/api/internal-assessment/batches');
        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.batches)) {
            const activeBatches = data.batches.filter((b: BatchItem) => !b.isLegacyMinimal);
            setBatches(activeBatches);
            if (activeBatches.length > 0) {
              setSelectedBatchId(activeBatches[0].id);
            }
          }
        }
      } catch {
        setErrorMsg('Failed to load academic batches');
      } finally {
        setIsLoadingBatches(false);
      }
    };
    fetchBatches();
  }, []);

  // 2. Fetch Subjects and Results when selectedBatchId changes
  const loadBatchData = useCallback(async (batchId: number) => {
    setIsLoadingData(true);
    setErrorMsg(null);
    try {
      const [subjRes, resRes] = await Promise.all([
        fetch(`/api/university-exams/subjects?batchId=${batchId}`),
        fetch(`/api/university-exams/results?batchId=${batchId}`),
      ]);

      let loadedSubjects: UniversitySubject[] = [];
      if (subjRes.ok) {
        const subjData = await subjRes.json();
        if (subjData.success) {
          setBatchProfile({
            batchName: subjData.batchName,
            schemeCode: subjData.schemeCode,
            professionalYear: subjData.professionalYear,
          });
          loadedSubjects = subjData.subjects || [];
          setSubjects(loadedSubjects);
        }
      }

      if (resRes.ok) {
        const resData = await resRes.json();
        if (resData.success) {
          setStudents(resData.students || []);

          // Initialize draft results with existing latest attempt if present
          const newDrafts = new Map<
            number,
            {
              subjectId: number;
              resultStatus: 'PASS' | 'FAIL' | 'PENDING' | 'WITHHELD';
              marksObtained: string;
              failedSubjectIds: number[];
              officeDecision: 'PROMOTED' | 'DETAINED' | 'PENDING';
            }
          >();

          const defaultSubjectId = loadedSubjects[0]?.id || 0;

          for (const s of resData.students || []) {
            if (s.attempts && s.attempts.length > 0) {
              const latest = s.attempts[0];
              newDrafts.set(s.id, {
                subjectId: latest.subjectId || defaultSubjectId,
                resultStatus: latest.resultStatus,
                marksObtained: latest.marksObtained !== null ? String(latest.marksObtained) : '',
                failedSubjectIds: latest.failedSubjects || [],
                officeDecision: latest.officeDecision || 'PENDING',
              });
            } else {
              newDrafts.set(s.id, {
                subjectId: defaultSubjectId,
                resultStatus: 'PASS',
                marksObtained: '',
                failedSubjectIds: [],
                officeDecision: 'PENDING',
              });
            }
          }
          setDraftResults(newDrafts);
        }
      }
    } catch {
      setErrorMsg('Failed to load university exam curriculum or student result records');
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (selectedBatchId !== null) {
      loadBatchData(selectedBatchId);
    }
  }, [selectedBatchId, loadBatchData]);

  // Load preview data when preview tab is selected
  const loadPromotionPreview = useCallback(async () => {
    if (!selectedBatchId) return;
    setIsLoadingPreview(true);
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/university-exams/promotion-preview?batchId=${selectedBatchId}&examSessionRef=${encodeURIComponent(
          examSessionRef
        )}&attemptType=${encodeURIComponent(attemptType)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate promotion preview');

      setPreviewStudents(data.students || []);
      setPreviewStats(data.stats || null);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setIsLoadingPreview(false);
    }
  }, [selectedBatchId, examSessionRef, attemptType]);

  useEffect(() => {
    if (activeTab === 'preview' && selectedBatchId !== null) {
      loadPromotionPreview();
    }
  }, [activeTab, selectedBatchId, loadPromotionPreview]);

  const handleStudentFieldChange = (
    studentId: number,
    field: 'subjectId' | 'resultStatus' | 'marksObtained' | 'officeDecision',
    value: any
  ) => {
    const current = draftResults.get(studentId) || {
      subjectId: subjects[0]?.id || 0,
      resultStatus: 'PASS',
      marksObtained: '',
      failedSubjectIds: [],
      officeDecision: 'PENDING',
    };

    let updatedFailed = current.failedSubjectIds;
    if (field === 'resultStatus' && value !== 'FAIL') {
      updatedFailed = [];
    }

    draftResults.set(studentId, {
      ...current,
      [field]: field === 'subjectId' ? Number(value) : value,
      failedSubjectIds: updatedFailed,
    });
    setDraftResults(new Map(draftResults));
  };

  const handleToggleFailedSubject = (studentId: number, subjId: number) => {
    const current = draftResults.get(studentId);
    if (!current) return;
    const exists = current.failedSubjectIds.includes(subjId);
    const updated = exists
      ? current.failedSubjectIds.filter((id) => id !== subjId)
      : [...current.failedSubjectIds, subjId];

    draftResults.set(studentId, {
      ...current,
      failedSubjectIds: updated,
    });
    setDraftResults(new Map(draftResults));
  };

  const handleSaveResult = async (studentId: number) => {
    if (!selectedBatchId) return;
    const draft = draftResults.get(studentId);
    if (!draft) return;

    const targetSubjectId = draft.subjectId || subjects[0]?.id || 0;

    setIsSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/university-exams/results', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify({
          batchId: selectedBatchId,
          studentId,
          subjectId: targetSubjectId,
          examSessionRef,
          attemptType,
          resultStatus: draft.resultStatus,
          marksObtained: draft.marksObtained !== '' ? Number(draft.marksObtained) : null,
          failedSubjectIds: draft.resultStatus === 'FAIL' ? draft.failedSubjectIds : [],
          officeDecision: draft.resultStatus === 'FAIL' ? draft.officeDecision : 'PENDING',
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save university exam result');

      setSuccessMsg(data.message || 'University examination result recorded successfully.');
      loadBatchData(selectedBatchId);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  // Finalize eligible exam results
  const handleFinalizeResults = async () => {
    if (!selectedBatchId) return;
    setIsSubmittingFinalize(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/university-exams/finalize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify({
          batchId: selectedBatchId,
          examSessionRef,
          attemptType,
          remarks: finalizeRemarks,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to finalize examination results');

      setSuccessMsg(data.message || 'University examination results finalized successfully.');
      setIsFinalizeModalOpen(false);
      loadBatchData(selectedBatchId);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setIsSubmittingFinalize(false);
    }
  };

  // Reopen result for documented correction
  const handleReopenCorrection = async () => {
    if (!reopenAttemptId || !reopenReason.trim()) {
      setErrorMsg('A documented justification reason is required to reopen a finalized record.');
      return;
    }
    setIsSubmittingReopen(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/university-exams/reopen-correction', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify({
          attemptId: reopenAttemptId,
          reason: reopenReason.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reopen result record');

      setSuccessMsg(data.message || 'Result reopened for documented correction.');
      setReopenAttemptId(null);
      setReopenReason('');
      if (selectedBatchId) {
        loadBatchData(selectedBatchId);
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setIsSubmittingReopen(false);
    }
  };

  // Confirm progression placements
  const handleConfirmProgression = async () => {
    if (!selectedBatchId || !hasAcknowledgedGazette) return;
    const eligibleConfirmations = previewStudents
      .filter((s) => s.canConfirm)
      .map((s) => ({
        studentId: s.studentId,
        proposedDecision: s.proposedDecision,
        proposedProfessionalYear: s.proposedProfessionalYear,
        proposedPlacementBatchId: s.proposedPlacementBatchId,
        applicableRule: s.applicableRule,
        reason: s.proposalReason,
      }));

    if (eligibleConfirmations.length === 0) {
      setErrorMsg('No students are currently eligible for progression confirmation.');
      return;
    }

    setIsSubmittingProgression(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/university-exams/confirm-progression', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify({
          batchId: selectedBatchId,
          examSessionRef,
          attemptType,
          confirmations: eligibleConfirmations,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to confirm academic progression');

      setSuccessMsg(data.message || 'Academic progression confirmed and student placements updated.');
      setIsConfirmModalOpen(false);
      setHasAcknowledgedGazette(false);
      loadBatchData(selectedBatchId);
      loadPromotionPreview();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setIsSubmittingProgression(false);
    }
  };

  // Extract all attempts across students for current batch and session
  const currentSessionAttempts: Array<StudentAttempt & { studentName: string; studentIdNumber: string; studentId: number }> = [];
  for (const st of students) {
    for (const att of st.attempts) {
      if (att.examSessionRef === examSessionRef && att.attemptType === attemptType) {
        currentSessionAttempts.push({
          ...att,
          studentName: st.fullName,
          studentIdNumber: st.studentIdNumber,
          studentId: st.id,
        });
      }
    }
  }

  const finalizedCount = currentSessionAttempts.filter((a) => a.isFinalized).length;
  const eligibleToFinalizeCount = currentSessionAttempts.filter(
    (a) => !a.isFinalized && (a.resultStatus === 'PASS' || a.resultStatus === 'FAIL')
  ).length;
  const ineligiblePendingCount = currentSessionAttempts.filter(
    (a) => a.resultStatus === 'PENDING' || a.resultStatus === 'WITHHELD'
  ).length;

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        title="University Examination & Result Management"
        kicker="EXAMINATION CELL"
        description="Official RGUHS / NCISM university result entry, finalization review, and auditable student placement preview workspace."
      />

      {errorMsg && (
        <Card accentTop>
          <CardContent className="p-4 bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button
              onClick={() => setErrorMsg(null)}
              className="text-rose-500 hover:text-rose-800 text-sm font-bold"
            >
              &times;
            </button>
          </CardContent>
        </Card>
      )}

      {successMsg && (
        <Card accentTop>
          <CardContent className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{successMsg}</span>
            </div>
            <button
              onClick={() => setSuccessMsg(null)}
              className="text-emerald-600 hover:text-emerald-900 text-sm font-bold"
            >
              &times;
            </button>
          </CardContent>
        </Card>
      )}

      {/* Batch & Examination Session Setup Card */}
      <Card accentTop>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#4B2E2E]" />
            <div>
              <CardTitle>Batch &amp; Examination Session Setup</CardTitle>
              <CardDescription>
                Select academic batch to automatically resolve professional year and curriculum scheme.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          <FormField id="sel-batch" label="Select Academic Batch" required>
            <Select
              id="sel-batch"
              value={selectedBatchId !== null ? String(selectedBatchId) : ''}
              onChange={(e) => {
                const val = Number(e.target.value);
                setSelectedBatchId(val);
                setDraftResults(new Map());
              }}
              disabled={isLoadingBatches}
            >
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.admissionAcademicYear})
                </option>
              ))}
            </Select>
          </FormField>

          <FormField id="exam-session" label="Examination Session Reference" required>
            <Input
              id="exam-session"
              value={examSessionRef}
              onChange={(e) => setExamSessionRef(e.target.value)}
              placeholder="e.g. RGUHS_2026_MAY"
            />
          </FormField>

          <FormField id="attempt-type" label="Attempt Type" required>
            <Select
              id="attempt-type"
              value={attemptType}
              onChange={(e) => setAttemptType(e.target.value as any)}
            >
              <option value="REGULAR">Regular Attempt</option>
              <option value="SUPPLEMENTARY">Supplementary Attempt</option>
            </Select>
          </FormField>
        </CardContent>

        {batchProfile && (
          <div className="px-6 py-3.5 bg-[#FAF9F5] border-t border-stone-200 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-stone-900">Selected Batch:</span>
              <span className="font-mono text-[#4B2E2E] font-bold">{batchProfile.batchName}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-semibold text-stone-900">Curriculum Scheme:</span>
              <Badge variant="institutional" size="sm">
                {batchProfile.schemeCode}
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-semibold text-stone-900">Professional Year:</span>
              <Badge variant="gold" size="sm">
                {batchProfile.professionalYear !== null
                  ? `Professional Year ${batchProfile.professionalYear}`
                  : 'Not Set'}
              </Badge>
            </div>
          </div>
        )}
      </Card>

      {/* Stage Workflow Navigation Tabs */}
      <div className="flex border-b border-stone-200 bg-[#FAF9F5] p-1 rounded-t-lg">
        <button
          onClick={() => setActiveTab('entry')}
          className={`flex items-center gap-2 py-2.5 px-4 text-xs font-semibold rounded-md transition-colors ${
            activeTab === 'entry'
              ? 'bg-[#4B2E2E] text-white shadow-sm'
              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>1. Result Entry</span>
        </button>

        <button
          onClick={() => setActiveTab('review')}
          className={`flex items-center gap-2 py-2.5 px-4 text-xs font-semibold rounded-md transition-colors ${
            activeTab === 'review'
              ? 'bg-[#4B2E2E] text-white shadow-sm'
              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'
          }`}
        >
          <FileCheck2 className="w-4 h-4" />
          <span>2. Result Review &amp; Finalization</span>
          {currentSessionAttempts.length > 0 && (
            <span
              className={`ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] ${
                activeTab === 'review' ? 'bg-[#D4AF37] text-[#4B2E2E]' : 'bg-stone-200 text-stone-700'
              }`}
            >
              {currentSessionAttempts.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('preview')}
          className={`flex items-center gap-2 py-2.5 px-4 text-xs font-semibold rounded-md transition-colors ${
            activeTab === 'preview'
              ? 'bg-[#4B2E2E] text-white shadow-sm'
              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'
          }`}
        >
          <GraduationCap className="w-4 h-4" />
          <span>3. Promotion &amp; Placement Preview</span>
          {previewStats && previewStats.eligibleToConfirm > 0 && (
            <span
              className={`ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                activeTab === 'preview' ? 'bg-[#D4AF37] text-[#4B2E2E]' : 'bg-emerald-100 text-emerald-800'
              }`}
            >
              {previewStats.eligibleToConfirm}
            </span>
          )}
        </button>
      </div>

      {/* =========================================================================
          TAB 1: RESULT ENTRY (Existing Workspace Preserved)
          ========================================================================= */}
      {activeTab === 'entry' && (
        <Card accentTop>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-[#4B2E2E]" />
                <div>
                  <CardTitle>Student Result &amp; Status Entry Workspace</CardTitle>
                  <CardDescription>
                    Record official university result status, failed subjects, and office promotion/detention decisions.
                  </CardDescription>
                </div>
              </div>
              {isLoadingData && (
                <div className="flex items-center gap-2 text-xs text-stone-500">
                  <RefreshCw className="w-4 h-4 animate-spin text-[#4B2E2E]" />
                  <span>Loading students...</span>
                </div>
              )}
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {students.length === 0 ? (
              <div className="py-12 text-center text-xs text-stone-500">
                No active students found for the selected batch.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-[#FAF9F5] border-b border-stone-200 text-[11px] font-semibold uppercase text-stone-600">
                    <tr>
                      <th className="py-3 px-4">Student &amp; Roll Number</th>
                      <th className="py-3 px-4">University Reg. No.</th>
                      <th className="py-3 px-4">Result Status</th>
                      <th className="py-3 px-4">Failed Subjects (if Fail)</th>
                      <th className="py-3 px-4">Office Decision</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {students.map((student) => {
                      const draft = draftResults.get(student.id) || {
                        subjectId: subjects[0]?.id || 0,
                        resultStatus: 'PASS',
                        marksObtained: '',
                        failedSubjectIds: [],
                        officeDecision: 'PENDING',
                      };

                      // Check if already finalized for this session
                      const matchingAttempt = student.attempts.find(
                        (a) =>
                          a.examSessionRef === examSessionRef &&
                          a.attemptType === attemptType &&
                          (draft.subjectId ? a.subjectId === draft.subjectId : true)
                      );
                      const isAttemptFinalized = Boolean(matchingAttempt?.isFinalized);

                      return (
                        <tr key={student.id} className="hover:bg-stone-50/70 transition-colors">
                          <td className="py-3.5 px-4 font-medium text-stone-900">
                            <div>{student.fullName}</div>
                            <div className="text-[11px] font-mono text-stone-500 mt-0.5">
                              {student.temporaryRollNumber}
                            </div>
                            {student.originalBatchName && student.originalBatchName !== batchProfile?.batchName && (
                              <div className="text-[10px] text-amber-700 bg-amber-50 rounded px-1 mt-1 inline-block">
                                Orig: {student.originalBatchName}
                              </div>
                            )}
                          </td>
                          <td className="py-3.5 px-4 font-mono text-stone-600">
                            {student.permanentUniversityNumber || (
                              <span className="text-stone-400 italic">Not Assigned</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            <Select
                              value={draft.resultStatus}
                              onChange={(e) =>
                                handleStudentFieldChange(student.id, 'resultStatus', e.target.value as any)
                              }
                              className="text-xs py-1 font-semibold"
                              disabled={isAttemptFinalized}
                            >
                              <option value="PASS">PASS</option>
                              <option value="FAIL">FAIL</option>
                              <option value="PENDING">PENDING</option>
                              <option value="WITHHELD">WITHHELD</option>
                            </Select>
                          </td>
                          <td className="py-3.5 px-4 min-w-[220px]">
                            {draft.resultStatus === 'FAIL' ? (
                              <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
                                {subjects.length === 0 ? (
                                  <span className="text-stone-400 italic text-[11px]">No curriculum subjects found</span>
                                ) : (
                                  subjects.map((s) => {
                                    const isChecked = draft.failedSubjectIds.includes(s.id);
                                    return (
                                      <label
                                        key={s.id}
                                        className={`flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border cursor-pointer ${
                                          isChecked
                                            ? 'bg-rose-50 border-rose-300 text-rose-900 font-semibold'
                                            : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'
                                        }`}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={() => handleToggleFailedSubject(student.id, s.id)}
                                          className="rounded border-stone-300 text-rose-600 focus:ring-rose-500"
                                          disabled={isAttemptFinalized}
                                        />
                                        <span className="truncate">{s.name} ({s.code})</span>
                                      </label>
                                    );
                                  })
                                )}
                              </div>
                            ) : (
                              <span className="text-stone-400 italic text-[11px]">
                                {draft.resultStatus === 'PASS'
                                  ? 'All subjects cleared'
                                  : 'Not applicable'}
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            {draft.resultStatus === 'FAIL' ? (
                              <Select
                                value={draft.officeDecision}
                                onChange={(e) =>
                                  handleStudentFieldChange(student.id, 'officeDecision', e.target.value as any)
                                }
                                className="text-xs py-1"
                                disabled={isAttemptFinalized}
                              >
                                <option value="PENDING">Pending Decision</option>
                                <option value="PROMOTED">Provisional Promoted</option>
                                <option value="DETAINED">Detained / Odd Batch</option>
                              </Select>
                            ) : (
                              <Badge variant="neutral" size="sm">
                                Standard ({draft.resultStatus})
                              </Badge>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            {isAttemptFinalized ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-800 bg-emerald-50 px-2 py-1 rounded font-semibold border border-emerald-200">
                                <Lock className="w-3 h-3 text-emerald-600" />
                                Finalized
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleSaveResult(student.id)}
                                disabled={isSaving || !isAuthorizedOffice}
                                className="text-xs"
                              >
                                <Save className="w-3.5 h-3.5 mr-1" />
                                Save
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* =========================================================================
          TAB 2: RESULT REVIEW & FINALIZATION (Stage 4 Part 1)
          ========================================================================= */}
      {activeTab === 'review' && (
        <div className="space-y-6">
          {/* Action and Summary Banner */}
          <div className="bg-[#FAF9F5] border border-stone-200 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <div className="p-3 bg-white rounded border border-stone-200 shadow-sm">
                <div className="text-stone-500 uppercase text-[10px] font-semibold">Total Exam Records</div>
                <div className="text-lg font-bold text-stone-900 mt-0.5">{currentSessionAttempts.length}</div>
              </div>
              <div className="p-3 bg-white rounded border border-emerald-200 shadow-sm">
                <div className="text-emerald-700 uppercase text-[10px] font-semibold">Finalized Records</div>
                <div className="text-lg font-bold text-emerald-800 mt-0.5">{finalizedCount}</div>
              </div>
              <div className="p-3 bg-white rounded border border-amber-200 shadow-sm">
                <div className="text-amber-700 uppercase text-[10px] font-semibold">Eligible to Finalize</div>
                <div className="text-lg font-bold text-amber-900 mt-0.5">{eligibleToFinalizeCount}</div>
              </div>
              {ineligiblePendingCount > 0 && (
                <div className="p-3 bg-white rounded border border-stone-200 shadow-sm">
                  <div className="text-stone-500 uppercase text-[10px] font-semibold">Pending / Withheld</div>
                  <div className="text-lg font-bold text-stone-600 mt-0.5">{ineligiblePendingCount}</div>
                  <div className="text-[10px] text-stone-400">Cannot be finalized</div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                onClick={() => setIsFinalizeModalOpen(true)}
                disabled={eligibleToFinalizeCount === 0 || !isAuthorizedOffice}
                className="bg-[#4B2E2E] hover:bg-[#3B2424] text-white"
              >
                <Lock className="w-4 h-4 mr-1.5" />
                Finalize Eligible Results ({eligibleToFinalizeCount})
              </Button>
            </div>
          </div>

          <Card accentTop>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Entered Examination Results Review</CardTitle>
                  <CardDescription>
                    Review student results for {examSessionRef} ({attemptType}). Pending and Withheld records cannot be finalized as passes or failures.
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => selectedBatchId && loadBatchData(selectedBatchId)}
                  className="text-xs"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1" />
                  Refresh
                </Button>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {currentSessionAttempts.length === 0 ? (
                <div className="py-12 text-center text-xs text-stone-500">
                  No examination result attempts recorded yet for session &quot;{examSessionRef}&quot; ({attemptType}). Enter results in Tab 1 first.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-[#FAF9F5] border-b border-stone-200 text-[11px] font-semibold uppercase text-stone-600">
                      <tr>
                        <th className="py-3 px-4">Student &amp; ID</th>
                        <th className="py-3 px-4">Subject</th>
                        <th className="py-3 px-4">Result Status</th>
                        <th className="py-3 px-4">Marks</th>
                        <th className="py-3 px-4">Office Decision</th>
                        <th className="py-3 px-4">Finalization Status</th>
                        <th className="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200">
                      {currentSessionAttempts.map((att) => {
                        const isFinalized = Boolean(att.isFinalized);
                        const isPass = att.resultStatus === 'PASS';
                        const isFail = att.resultStatus === 'FAIL';
                        const isPending = att.resultStatus === 'PENDING';
                        const isWithheld = att.resultStatus === 'WITHHELD';

                        return (
                          <tr key={att.id} className="hover:bg-stone-50/70 transition-colors">
                            <td className="py-3 px-4">
                              <div className="font-semibold text-stone-900">{att.studentName}</div>
                              <div className="font-mono text-[11px] text-stone-500">{att.studentIdNumber}</div>
                            </td>
                            <td className="py-3 px-4">
                              {att.resultStatus === 'FAIL' && att.failedSubjects && att.failedSubjects.length > 0 ? (
                                <div className="space-y-0.5">
                                  <div className="font-semibold text-rose-800 text-[11px]">
                                    {att.failedSubjects.length} Failed Subject(s):
                                  </div>
                                  <div className="text-[10px] text-stone-600 max-w-xs">
                                    {att.failedSubjects.map((fsId: number) => {
                                      const sMatch = subjects.find((s) => s.id === fsId);
                                      return (
                                        <div key={fsId} className="truncate text-rose-700">
                                          &bull; {sMatch ? sMatch.name : `Subject #${fsId}`}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : att.resultStatus === 'PASS' ? (
                                <div className="text-emerald-700 font-medium text-[11px] flex items-center gap-1">
                                  <Check className="w-3.5 h-3.5 shrink-0" />
                                  <span>All Prescribed Subjects Cleared</span>
                                </div>
                              ) : (
                                <div>
                                  <div className="font-medium text-stone-900">{att.subjectName || 'Prescribed Curriculum'}</div>
                                  {att.subjectCode && <div className="font-mono text-[10px] text-stone-500">{att.subjectCode}</div>}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-4">
                              {isPass && (
                                <Badge variant="success" size="sm">
                                  PASS
                                </Badge>
                              )}
                              {isFail && (
                                <Badge variant="warning" size="sm" className="bg-rose-50 text-rose-800 border-rose-300">
                                  FAIL
                                </Badge>
                              )}
                              {isPending && (
                                <Badge variant="neutral" size="sm">
                                  PENDING
                                </Badge>
                              )}
                              {isWithheld && (
                                <Badge variant="neutral" size="sm" className="text-purple-800 bg-purple-50 border-purple-300">
                                  WITHHELD
                                </Badge>
                              )}
                            </td>
                            <td className="py-3 px-4 font-mono">
                              {att.marksObtained !== null ? att.marksObtained : '—'}
                            </td>
                            <td className="py-3 px-4">
                              <span className="font-medium text-stone-700">{att.officeDecision || 'PENDING'}</span>
                            </td>
                            <td className="py-3 px-4">
                              {isFinalized ? (
                                <div className="space-y-0.5">
                                  <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                    <Lock className="w-3 h-3 text-emerald-600" />
                                    Finalized
                                  </div>
                                  <div className="text-[10px] text-stone-500">
                                    by {att.finalizedByName || 'Office Staff'}
                                  </div>
                                </div>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] text-stone-600 bg-stone-100 px-2 py-0.5 rounded border border-stone-200">
                                  <Unlock className="w-3 h-3 text-stone-400" />
                                  Draft / Unfinalized
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right">
                              {isFinalized ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setReopenAttemptId(att.id);
                                    setReopenReason('');
                                  }}
                                  disabled={!isAuthorizedOffice}
                                  className="text-xs text-amber-800 border-amber-300 hover:bg-amber-50"
                                >
                                  Reopen Correction
                                </Button>
                              ) : (
                                (isPending || isWithheld) ? (
                                  <span className="text-[11px] text-stone-400 italic">Blocked</span>
                                ) : (
                                  <span className="text-[11px] text-amber-700 font-semibold">Ready to Finalize</span>
                                )
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* =========================================================================
          TAB 3: PROMOTION & PLACEMENT PREVIEW (Stage 4 Parts 2, 3, 4)
          ========================================================================= */}
      {activeTab === 'preview' && (
        <div className="space-y-6">
          {/* Statistics Bar */}
          {previewStats && (
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
              <div className="bg-[#FAF9F5] p-3 rounded-lg border border-stone-200">
                <div className="text-stone-500 uppercase text-[10px] font-semibold">Students in Batch</div>
                <div className="text-xl font-bold text-stone-900 mt-1">{previewStats.totalStudents}</div>
              </div>
              <div className="bg-emerald-50/60 p-3 rounded-lg border border-emerald-200">
                <div className="text-emerald-800 uppercase text-[10px] font-semibold">Passed / Promote</div>
                <div className="text-xl font-bold text-emerald-900 mt-1">{previewStats.passed}</div>
              </div>
              <div className="bg-amber-50/60 p-3 rounded-lg border border-amber-200">
                <div className="text-amber-800 uppercase text-[10px] font-semibold">Failed — Promoted</div>
                <div className="text-xl font-bold text-amber-900 mt-1">{previewStats.failedPromoted}</div>
                <div className="text-[9px] text-amber-700">Provisional (RS7 backlogs)</div>
              </div>
              <div className="bg-rose-50/60 p-3 rounded-lg border border-rose-200">
                <div className="text-rose-800 uppercase text-[10px] font-semibold">Failed — Detained</div>
                <div className="text-xl font-bold text-rose-900 mt-1">{previewStats.failedDetained}</div>
                <div className="text-[9px] text-rose-700">Odd-Batch / Retained</div>
              </div>
              <div className="bg-stone-50 p-3 rounded-lg border border-stone-200">
                <div className="text-stone-500 uppercase text-[10px] font-semibold">Pending / Withheld</div>
                <div className="text-xl font-bold text-stone-700 mt-1">{previewStats.pendingOrWithheld}</div>
                <div className="text-[9px] text-stone-400">Not eligible</div>
              </div>
              <div className="bg-[#FDFBF7] p-3 rounded-lg border border-[#D4AF37]">
                <div className="text-[#8C6D23] uppercase text-[10px] font-semibold">Eligible to Confirm</div>
                <div className="text-xl font-bold text-[#4B2E2E] mt-1">{previewStats.eligibleToConfirm}</div>
              </div>
            </div>
          )}

          {/* Action Banner */}
          <div className="bg-[#FAF9F5] border border-stone-200 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-sm font-bold text-stone-900 flex items-center gap-2">
                <GraduationCap className="w-4 h-4 text-[#4B2E2E]" />
                Academic Progression &amp; Placement Proposal
              </div>
              <div className="text-xs text-stone-600 mt-0.5">
                Proposals are computed using verified RS7 curriculum progression rules. Preview outcomes before executing placement changes.
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={loadPromotionPreview}
                disabled={isLoadingPreview}
                className="text-xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoadingPreview ? 'animate-spin' : ''}`} />
                Recalculate Preview
              </Button>

              <Button
                variant="primary"
                onClick={() => setIsConfirmModalOpen(true)}
                disabled={!previewStats || previewStats.eligibleToConfirm === 0 || !isAuthorizedOffice}
                className="bg-[#4B2E2E] hover:bg-[#3B2424] text-white"
              >
                <CheckCheck className="w-4 h-4 mr-1.5 text-[#D4AF37]" />
                Confirm Placements ({previewStats?.eligibleToConfirm || 0})
              </Button>
            </div>
          </div>

          <Card accentTop>
            <CardHeader>
              <CardTitle>Student Progression Preview Table</CardTitle>
              <CardDescription>
                Shows original admission batch identity preserved alongside current placements, proposed decision, and applicable rules.
              </CardDescription>
            </CardHeader>

            <CardContent className="p-0">
              {isLoadingPreview ? (
                <div className="py-12 text-center text-xs text-stone-500 flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-[#4B2E2E]" />
                  <span>Generating auditable placement preview...</span>
                </div>
              ) : previewStudents.length === 0 ? (
                <div className="py-12 text-center text-xs text-stone-500">
                  No students loaded for preview. Please ensure batch and examination session are selected.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-[#FAF9F5] border-b border-stone-200 text-[11px] font-semibold uppercase text-stone-600">
                      <tr>
                        <th className="py-3 px-4">Student &amp; IDs</th>
                        <th className="py-3 px-4">Batches &amp; Placements</th>
                        <th className="py-3 px-4">Scheme</th>
                        <th className="py-3 px-4">Result &amp; Failed Subjects</th>
                        <th className="py-3 px-4">Administrative Outcome</th>
                        <th className="py-3 px-4">Proposed Decision &amp; Target</th>
                        <th className="py-3 px-4">Applicable Rule &amp; Reason</th>
                        <th className="py-3 px-4 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200">
                      {previewStudents.map((st) => {
                        const isPass = st.administrativeOutcome === 'PASSED';
                        const isProv = st.administrativeOutcome === 'FAILED — PROMOTED';
                        const isDet = st.administrativeOutcome === 'FAILED — DETAINED';
                        const isPending = st.administrativeOutcome === 'PENDING';
                        const isWithheld = st.administrativeOutcome === 'WITHHELD';

                        return (
                          <tr key={st.studentId} className="hover:bg-stone-50/70 transition-colors">
                            <td className="py-3.5 px-4 font-medium text-stone-900">
                              <div>{st.fullName}</div>
                              <div className="font-mono text-[11px] text-stone-500">{st.studentIdNumber}</div>
                              {st.permanentUniversityNumber && (
                                <div className="font-mono text-[10px] text-emerald-800">
                                  Reg: {st.permanentUniversityNumber}
                                </div>
                              )}
                            </td>

                            <td className="py-3.5 px-4 text-[11px]">
                              <div>
                                <span className="text-stone-500">Original:</span>{' '}
                                <span className="font-semibold text-stone-800">{st.originalBatchName}</span>
                              </div>
                              <div className="mt-0.5">
                                <span className="text-stone-500">Current:</span>{' '}
                                <span className="font-semibold text-[#4B2E2E]">{st.currentPlacementBatchName}</span>
                              </div>
                              <div className="text-stone-400 text-[10px] mt-0.5">
                                Year {st.currentYearOfStudy}
                              </div>
                            </td>

                            <td className="py-3.5 px-4">
                              <Badge variant="institutional" size="sm">
                                {st.schemeCode}
                              </Badge>
                            </td>

                            <td className="py-3.5 px-4 max-w-[180px]">
                              {st.failedSubjects.length === 0 ? (
                                <span className="text-emerald-700 font-semibold flex items-center gap-1 text-[11px]">
                                  <Check className="w-3.5 h-3.5" /> All Subjects Cleared
                                </span>
                              ) : (
                                <div className="space-y-1">
                                  <span className="text-rose-700 font-bold text-[11px]">
                                    {st.failedSubjects.length} Subject(s) Failed:
                                  </span>
                                  <div className="text-[10px] text-stone-600 space-y-0.5">
                                    {st.failedSubjects.map((f) => (
                                      <div key={f.id} className="truncate text-rose-800">
                                        &bull; {f.name}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </td>

                            <td className="py-3.5 px-4">
                              {isPass && (
                                <Badge variant="success" size="sm" className="font-bold">
                                  PASSED
                                </Badge>
                              )}
                              {isProv && (
                                <Badge variant="warning" size="sm" className="font-bold">
                                  FAILED — PROMOTED
                                </Badge>
                              )}
                              {isDet && (
                                <Badge variant="warning" size="sm" className="bg-rose-50 text-rose-800 border-rose-300 font-bold">
                                  FAILED — DETAINED
                                </Badge>
                              )}
                              {isPending && (
                                <Badge variant="neutral" size="sm">
                                  PENDING
                                </Badge>
                              )}
                              {isWithheld && (
                                <Badge variant="neutral" size="sm" className="text-purple-800 bg-purple-50 border-purple-300">
                                  WITHHELD
                                </Badge>
                              )}
                            </td>

                            <td className="py-3.5 px-4">
                              <div className="font-semibold text-stone-900 flex items-center gap-1.5">
                                <ArrowRight className="w-3 h-3 text-[#4B2E2E]" />
                                <span>{st.proposedDecision}</span>
                              </div>
                              <div className="text-[10px] text-stone-500 mt-0.5">
                                Target Batch: <span className="font-semibold text-stone-700">{st.proposedPlacementBatchName}</span> (Year {st.proposedProfessionalYear})
                              </div>
                            </td>

                            <td className="py-3.5 px-4 max-w-[220px]">
                              <div className="text-[11px] text-stone-700 leading-relaxed">
                                {st.proposalReason}
                              </div>
                              {st.unverifiedThirdProfRuleNote && (
                                <div className="mt-1.5 p-1.5 bg-amber-50 border border-amber-200 rounded text-[10px] text-amber-900 flex items-start gap-1">
                                  <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0 mt-0.5" />
                                  <span>{st.unverifiedThirdProfRuleNote}</span>
                                </div>
                              )}
                            </td>

                            <td className="py-3.5 px-4 text-center">
                              {st.canConfirm ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                  <Check className="w-3 h-3" /> Eligible
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] text-stone-500 bg-stone-100 px-2 py-0.5 rounded border border-stone-200">
                                  Pending Review
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* =========================================================================
          MODAL: FINALIZE ELIGIBLE RESULTS
          ========================================================================= */}
      {isFinalizeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full overflow-hidden border border-stone-200">
            <div className="bg-[#4B2E2E] px-6 py-4 flex items-center justify-between text-white">
              <div className="flex items-center gap-2">
                <Lock className="w-5 h-5 text-[#D4AF37]" />
                <h3 className="font-semibold text-sm">Finalize Examination Results</h3>
              </div>
              <button
                onClick={() => setIsFinalizeModalOpen(false)}
                className="text-stone-300 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded text-amber-900 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">Review &amp; Governance Notice</div>
                  <div className="text-[11px] mt-0.5 leading-relaxed">
                    You are finalizing <strong>{eligibleToFinalizeCount}</strong> eligible PASS/FAIL result records for session <strong>{examSessionRef}</strong> ({attemptType}).
                    Pending and Withheld results will <strong>not</strong> be finalized. Once finalized, records become locked and require a documented correction audit to reopen.
                  </div>
                </div>
              </div>

              <FormField id="finalize-remarks" label="Review & Finalization Remarks" required>
                <Textarea
                  id="finalize-remarks"
                  value={finalizeRemarks}
                  onChange={(e) => setFinalizeRemarks(e.target.value)}
                  rows={3}
                  className="text-xs"
                />
              </FormField>
            </div>

            <div className="px-6 py-3 bg-stone-50 border-t border-stone-200 flex items-center justify-end gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsFinalizeModalOpen(false)}
                disabled={isSubmittingFinalize}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleFinalizeResults}
                disabled={isSubmittingFinalize || !finalizeRemarks.trim()}
                className="bg-[#4B2E2E] hover:bg-[#3B2424] text-white"
              >
                {isSubmittingFinalize ? 'Finalizing...' : 'Confirm Finalization'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: REOPEN FINALIZED RECORD FOR CORRECTION
          ========================================================================= */}
      {reopenAttemptId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full overflow-hidden border border-stone-200">
            <div className="bg-[#4B2E2E] px-6 py-4 flex items-center justify-between text-white">
              <div className="flex items-center gap-2">
                <Unlock className="w-5 h-5 text-amber-400" />
                <h3 className="font-semibold text-sm">Reopen Result for Documented Correction</h3>
              </div>
              <button
                onClick={() => setReopenAttemptId(null)}
                className="text-stone-300 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <p className="text-stone-600 leading-relaxed">
                Reopening this finalized record allows the office staff to correct entered marks or status.
                A documented official justification is mandatory and will be recorded in the immutable audit log.
              </p>

              <FormField id="reopen-reason" label="Documented Justification Reason" required>
                <Textarea
                  id="reopen-reason"
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  placeholder="e.g. University revaluation gazette issued with revised marks."
                  rows={3}
                  className="text-xs"
                />
              </FormField>
            </div>

            <div className="px-6 py-3 bg-stone-50 border-t border-stone-200 flex items-center justify-end gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReopenAttemptId(null)}
                disabled={isSubmittingReopen}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleReopenCorrection}
                disabled={isSubmittingReopen || !reopenReason.trim()}
                className="bg-amber-800 hover:bg-amber-900 text-white"
              >
                {isSubmittingReopen ? 'Reopening...' : 'Confirm Reopen'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: CONFIRM PROMOTION & PLACEMENT CHANGES
          ========================================================================= */}
      {isConfirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-xl w-full overflow-hidden border border-stone-200">
            <div className="bg-[#4B2E2E] px-6 py-4 flex items-center justify-between text-white">
              <div className="flex items-center gap-2">
                <CheckCheck className="w-5 h-5 text-[#D4AF37]" />
                <h3 className="font-semibold text-sm">Confirm Academic Progression Placements</h3>
              </div>
              <button
                onClick={() => setIsConfirmModalOpen(false)}
                className="text-stone-300 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="p-3 bg-[#FAF9F5] border border-stone-200 rounded space-y-2">
                <div className="font-bold text-stone-900">Confirmation Summary</div>
                <div className="grid grid-cols-3 gap-2 text-[11px] pt-1">
                  <div className="p-2 bg-emerald-50 border border-emerald-200 rounded">
                    <span className="text-emerald-800 font-bold">{previewStats?.passed || 0}</span>
                    <span className="text-stone-600 block text-[10px]">Normal Promotion / Internship</span>
                  </div>
                  <div className="p-2 bg-amber-50 border border-amber-200 rounded">
                    <span className="text-amber-800 font-bold">{previewStats?.failedPromoted || 0}</span>
                    <span className="text-stone-600 block text-[10px]">Provisional (RS7 Backlogs)</span>
                  </div>
                  <div className="p-2 bg-rose-50 border border-rose-200 rounded">
                    <span className="text-rose-800 font-bold">{previewStats?.failedDetained || 0}</span>
                    <span className="text-stone-600 block text-[10px]">Detained / Odd Batch</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2 text-stone-600 leading-relaxed text-[11px]">
                <p>
                  Confirming this batch will execute the following actions:
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Increment professional year and update active placement batch for promoted students.</li>
                  <li>Record official progression events in <code>student_progression_events</code> with workflow state <code>CONFIRMED</code>.</li>
                  <li>Record detailed audit log entries for every student placement change.</li>
                  <li><strong>Strictly preserve original admission batch identity</strong> (never altered).</li>
                </ul>
              </div>

              <label className="flex items-start gap-2.5 p-3 bg-amber-50/70 border border-amber-200 rounded cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasAcknowledgedGazette}
                  onChange={(e) => setHasAcknowledgedGazette(e.target.checked)}
                  className="rounded border-amber-400 text-[#4B2E2E] focus:ring-[#4B2E2E] mt-0.5"
                />
                <span className="text-[11px] text-amber-900 font-medium">
                  I confirm that official university examination results have been verified against official university gazettes, all eligible results are finalized, and these placement proposals are authorized for execution.
                </span>
              </label>
            </div>

            <div className="px-6 py-3 bg-stone-50 border-t border-stone-200 flex items-center justify-end gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsConfirmModalOpen(false)}
                disabled={isSubmittingProgression}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleConfirmProgression}
                disabled={isSubmittingProgression || !hasAcknowledgedGazette}
                className="bg-[#4B2E2E] hover:bg-[#3B2424] text-white"
              >
                {isSubmittingProgression ? 'Executing Placement...' : 'Confirm & Execute Placement'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
