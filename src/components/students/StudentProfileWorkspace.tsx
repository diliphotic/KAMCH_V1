import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  FileText,
  CreditCard,
  Clock,
  Lock,
  RefreshCw,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { FormField, Input, Select, Textarea } from '../ui/FormField';
import { NavigationItemKey } from '../../types';
import {
  AcademicBatch,
  StudentFullProfileResponse,
  formatQuotaLabel,
  formatProgressionStatusLabel,
  formatInr,
} from './studentTypes';
import { deriveProgressionViewState } from './progressionViewModel';

export interface StudentProfileWorkspaceProps {
  studentId: number;
  batches: AcademicBatch[];
  userRole: string;
  isOfficeRole: boolean;
  csrfToken: string | null;
  onBack: () => void;
  onNavigate?: (tab: NavigationItemKey) => void;
  onOpenStudentInFees?: (studentId: number) => void;
  onGlobalNotice: (notice: { type: 'success' | 'error'; message: string }) => void;
}

type ProfileTabKey =
  | 'overview'
  | 'personal'
  | 'guardian'
  | 'admission'
  | 'identifiers'
  | 'documents'
  | 'progression'
  | 'internship'
  | 'fees'
  | 'audit';

export const StudentProfileWorkspace: React.FC<StudentProfileWorkspaceProps> = ({
  studentId,
  batches,
  userRole,
  isOfficeRole,
  csrfToken,
  onBack,
  onNavigate,
  onOpenStudentInFees,
  onGlobalNotice,
}) => {
  const isPrincipal = userRole === 'PRINCIPAL';
  const [profile, setProfile] = useState<StudentFullProfileResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ProfileTabKey>('overview');
  const [localMsg, setLocalMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const [isSaving, setIsSaving] = useState(false);

  // Editable profile state
  const [editState, setEditState] = useState<Record<string, any>>({});

  // Identifier form
  const [univForm, setUnivForm] = useState({
    permanentUniversityNumber: '',
    verifyNow: false,
    reason: '',
  });

  // Document metadata form
  const [docForm, setDocForm] = useState({
    documentType: 'NEET_SCORE_CARD',
    documentLabel: 'NEET UG Score Card',
    referenceNumber: '',
    issueDate: '',
    receivedStatus: 'RECEIVED',
    verificationStatus: 'VERIFIED',
    remarks: '',
  });

  // Review resolution state
  const [resolvingEventId, setResolvingEventId] = useState<number | null>(null);
  const [resolveForm, setResolveForm] = useState({
    resolvedStatus: 'REGULAR_ACTIVE',
    proposedProfessionalYear: '1',
    proposedPlacementBatchId: '',
    proposedDetentionStage: '0',
    outstandingBacklogsCount: '0',
    reason: '',
  });

  // Internship forms
  const [internInitForm, setInternInitForm] = useState({
    startDate: '',
    remarks: '',
  });
  const [internExtForm, setInternExtForm] = useState({
    additionalDays: '15',
    reason: '',
  });
  const [internCompleteForm, setInternCompleteForm] = useState({
    actualCompletionDate: new Date().toISOString().slice(0, 10),
    remarks: '',
  });

  const loadProfile = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/students/${studentId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load student profile');
      setProfile(data);
      const s = data.student;
      setEditState({
        fullName: s.fullName || '',
        universityRecordedName: s.universityRecordedName || '',
        dateOfBirth: s.dateOfBirth || '',
        gender: s.gender || '',
        nationality: s.nationality || 'Indian',
        contactPhone: s.contactPhone || '',
        contactEmail: s.contactEmail || '',
        currentAddress: s.currentAddress || '',
        permanentAddress: s.permanentAddress || '',
        state: s.state || '',
        district: s.district || '',
        cityTown: s.cityTown || '',
        pinCode: s.pinCode || '',
        profileRemarks: s.profileRemarks || '',
        fatherName: s.fatherName || '',
        fatherPhone: s.fatherPhone || '',
        motherName: s.motherName || '',
        motherPhone: s.motherPhone || '',
        guardianName: s.guardianName || '',
        guardianRelationship: s.guardianRelationship || '',
        guardianPhone: s.guardianPhone || '',
        emergencyContactName: s.emergencyContactName || '',
        emergencyContactRelationship: s.emergencyContactRelationship || '',
        emergencyContactPhone: s.emergencyContactPhone || '',
        parentGuardianAddress: s.parentGuardianAddress || '',
        originalBatchId: s.originalBatchId ? String(s.originalBatchId) : '',
        currentPlacementBatchId: s.currentPlacementBatchId ? String(s.currentPlacementBatchId) : '',
        admissionAcademicYear: s.admissionAcademicYear || '',
        admissionYear: String(s.admissionYear || ''),
        admissionDate: s.admissionDate || '',
        admissionQuota: s.admissionQuota || 'GOVERNMENT',
        seatCategory: s.seatCategory || '',
        reservationDetails: s.reservationDetails || '',
        isKeaEligible: Boolean(s.isKeaEligible),
        keaAcknowledgementNo: s.keaAcknowledgementNo || '',
        neetRollNumber: s.neetRollNumber || '',
        neetScore: s.neetScore || '',
        applicationIdentifier: s.applicationIdentifier || '',
        qualifyingExam: s.qualifyingExam || '',
        qualifyingBoard: s.qualifyingBoard || '',
        qualifyingYear: s.qualifyingYear ? String(s.qualifyingYear) : '',
        qualifyingMarksPercentage: s.qualifyingMarksPercentage || '',
        admissionOrderRef: s.admissionOrderRef || '',
        admissionStatus: s.admissionStatus || 'PROVISIONAL',
        confirmationDate: s.confirmationDate || '',
        admissionRemarks: s.admissionRemarks || '',
        currentYearOfStudy: String(s.currentYearOfStudy || 1),
        administrativeStatus: s.administrativeStatus || 'ACTIVE',
        administrativeStatusReason: s.administrativeStatusReason || '',
        rs6InternshipCompleted: Boolean(s.rs6InternshipCompleted),
        rs6AcademicSummary: s.rs6AcademicSummary || '',
        changeReason: '',
      });
      setUnivForm((prev) => ({
        ...prev,
        permanentUniversityNumber: s.permanentUniversityNumber || '',
      }));
      if (data.internship?.startDate) {
        setInternInitForm((prev) => ({
          ...prev,
          startDate: data.internship.startDate || '',
        }));
      }
    } catch (err) {
      setLocalMsg({ type: 'error', text: (err as Error).message });
    } finally {
      setIsLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleSaveProfileSection = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalMsg(null);
    setIsSaving(true);
    try {
      const payload: Record<string, any> = {
        ...editState,
        originalBatchId: editState.originalBatchId ? Number(editState.originalBatchId) : null,
        currentPlacementBatchId: editState.currentPlacementBatchId
          ? Number(editState.currentPlacementBatchId)
          : null,
        admissionYear: Number(editState.admissionYear),
        currentYearOfStudy: Number(editState.currentYearOfStudy),
        qualifyingYear: editState.qualifyingYear ? Number(editState.qualifyingYear) : null,
      };
      if (isOfficeRole) {
        delete payload.admissionQuota;
        delete payload.admissionCategory;
      }

      const res = await fetch(`/api/students/${studentId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update student profile');
      setLocalMsg({ type: 'success', text: data.message });
      onGlobalNotice({ type: 'success', message: data.message });
      await loadProfile();
    } catch (err) {
      setLocalMsg({ type: 'error', text: (err as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveUniversityNumber = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalMsg(null);
    setIsSaving(true);
    try {
      const res = await fetch(`/api/students/${studentId}/university-number`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify(univForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save university number');
      setLocalMsg({ type: 'success', text: data.message });
      setUnivForm((prev) => ({ ...prev, reason: '' }));
      await loadProfile();
    } catch (err) {
      setLocalMsg({ type: 'error', text: (err as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleVerifyPendingUniversityNumber = async () => {
    setLocalMsg(null);
    setIsSaving(true);
    try {
      const res = await fetch(`/api/students/${studentId}/university-number/verify`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify({
          reason: univForm.reason || 'Verified against RGUHS university registration list',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification failed');
      setLocalMsg({ type: 'success', text: data.message });
      await loadProfile();
    } catch (err) {
      setLocalMsg({ type: 'error', text: (err as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalMsg(null);
    setIsSaving(true);
    try {
      const res = await fetch(`/api/students/${studentId}/documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify(docForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add document metadata');
      setLocalMsg({ type: 'success', text: data.message });
      setDocForm({
        ...docForm,
        referenceNumber: '',
        issueDate: '',
        remarks: '',
      });
      await loadProfile();
    } catch (err) {
      setLocalMsg({ type: 'error', text: (err as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleDocVerified = async (doc: StudentFullProfileResponse['documents'][number]) => {
    setLocalMsg(null);
    try {
      const nextVerif = doc.verificationStatus === 'VERIFIED' ? 'UNVERIFIED' : 'VERIFIED';
      const res = await fetch(`/api/students/${studentId}/documents/${doc.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify({
          ...doc,
          receivedStatus: nextVerif === 'VERIFIED' ? 'RECEIVED' : doc.receivedStatus,
          verificationStatus: nextVerif,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update document status');
      await loadProfile();
    } catch (err) {
      setLocalMsg({ type: 'error', text: (err as Error).message });
    }
  };

  const handleConfirmProgressionEvent = async (eventId: number) => {
    setLocalMsg(null);
    setIsSaving(true);
    try {
      const res = await fetch(`/api/students/${studentId}/progression/${eventId}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify({
          remarks: 'Confirmed after official university result verification',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to confirm progression');
      setLocalMsg({ type: 'success', text: data.message });
      await loadProfile();
    } catch (err) {
      setLocalMsg({ type: 'error', text: (err as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleResolveReviewEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvingEventId) return;
    setLocalMsg(null);
    setIsSaving(true);
    try {
      const res = await fetch(
        `/api/students/${studentId}/progression/${resolvingEventId}/resolve-review`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
          },
          body: JSON.stringify({
            resolvedStatus: resolveForm.resolvedStatus,
            proposedProfessionalYear: Number(resolveForm.proposedProfessionalYear),
            proposedPlacementBatchId: resolveForm.proposedPlacementBatchId
              ? Number(resolveForm.proposedPlacementBatchId)
              : null,
            proposedDetentionStage: Number(resolveForm.proposedDetentionStage),
            outstandingBacklogsCount: Number(resolveForm.outstandingBacklogsCount),
            reason: resolveForm.reason,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resolve review event');
      setLocalMsg({ type: 'success', text: data.message });
      setResolvingEventId(null);
      await loadProfile();
    } catch (err) {
      setLocalMsg({ type: 'error', text: (err as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleInitializeInternship = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalMsg(null);
    setIsSaving(true);
    try {
      const res = await fetch(`/api/students/${studentId}/internship/initialize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify(internInitForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update internship schedule');
      setLocalMsg({ type: 'success', text: data.message });
      await loadProfile();
    } catch (err) {
      setLocalMsg({ type: 'error', text: (err as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddInternshipExtension = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalMsg(null);
    setIsSaving(true);
    try {
      const res = await fetch(`/api/students/${studentId}/internship/extensions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify({
          additionalDays: Number(internExtForm.additionalDays),
          reason: internExtForm.reason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to approve internship extension');
      setLocalMsg({ type: 'success', text: data.message });
      setInternExtForm({ additionalDays: '15', reason: '' });
      await loadProfile();
    } catch (err) {
      setLocalMsg({ type: 'error', text: (err as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCompleteInternship = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalMsg(null);
    setIsSaving(true);
    try {
      const res = await fetch(`/api/students/${studentId}/internship/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify(internCompleteForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Cannot mark internship complete');
      setLocalMsg({ type: 'success', text: data.message });
      await loadProfile();
    } catch (err) {
      setLocalMsg({ type: 'error', text: (err as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading || !profile) {
    return (
      <Card>
        <CardContent className="p-10 text-center text-xs text-stone-500 flex flex-col items-center gap-2">
          <RefreshCw className="w-5 h-5 animate-spin text-[#4B2E2E]" />
          <span>Loading institutional student profile...</span>
        </CardContent>
      </Card>
    );
  }

  const s = profile.student;
  const isLegacyRs6 = s.isLegacyMinimal;
  const progressionView = deriveProgressionViewState(s, profile.progressionHistory);

  const tabs: Array<{ id: ProfileTabKey; label: string }> = isLegacyRs6
    ? [
        { id: 'overview', label: 'RS6 Legacy Profile & Summary' },
        { id: 'identifiers', label: 'Official Identifiers' },
        { id: 'fees', label: 'Fees Summary' },
        { id: 'audit', label: 'Audit History' },
      ]
    : [
        { id: 'overview', label: 'Overview' },
        { id: 'personal', label: 'Personal & Contact' },
        { id: 'guardian', label: 'Parent / Emergency' },
        { id: 'admission', label: 'Admission & Quota' },
        { id: 'identifiers', label: 'Identifiers' },
        { id: 'documents', label: 'Documents' },
        { id: 'progression', label: 'Academic Progression' },
        { id: 'internship', label: 'Internship' },
        { id: 'fees', label: 'Fees Summary' },
        { id: 'audit', label: 'Audit History' },
      ];

  return (
    <div className="space-y-4">
      {/* Top Back Bar */}
      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          icon={<ArrowLeft className="w-3.5 h-3.5" />}
          onClick={onBack}
        >
          Back to Student Registry
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={<RefreshCw className="w-3.5 h-3.5" />}
          onClick={loadProfile}
        >
          Refresh Record
        </Button>
      </div>

      {/* Institutional Identity Header */}
      <Card accentTop>
        <CardContent className="p-5 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="font-serif text-lg sm:text-xl font-bold text-stone-900">
                  {s.fullName}
                </h2>
                <Badge variant="institutional" size="sm">
                  {s.schemeCode || 'RS7'}
                </Badge>
                <Badge
                  variant={
                    s.administrativeStatus === 'ACTIVE'
                      ? 'success'
                      : s.administrativeStatus === 'COMPLETED'
                      ? 'gold'
                      : 'warning'
                  }
                  size="sm"
                >
                  {s.administrativeStatus}
                </Badge>
              </div>
              {s.universityRecordedName && (
                <p className="text-xs text-stone-500">
                  University Recorded Name: <strong className="text-stone-700">{s.universityRecordedName}</strong>
                </p>
              )}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-stone-600 pt-1 tabular-nums">
                <span>
                  Active Student ID:{' '}
                  <strong className="font-mono text-[#4B2E2E]">{s.studentIdNumber}</strong>
                </span>
                <span>
                  Temp Roll:{' '}
                  <span className="font-mono text-stone-800">{s.temporaryRollNumber}</span>
                </span>
                <span>
                  RGUHS Reg:{' '}
                  <span className="font-mono text-stone-800">
                    {s.permanentUniversityNumber || 'Not Issued Yet'}
                  </span>{' '}
                  ({s.universityRegStatus.replace(/_/g, ' ')})
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2.5 text-xs shrink-0">
              {progressionView.showOriginalBatch && (
                <div className="px-3 py-2 rounded-lg bg-[#FAF9F5] border border-stone-200">
                  <span className="text-[10px] uppercase tracking-wider text-stone-500 block font-semibold">
                    Original Batch
                  </span>
                  <span className="font-semibold text-stone-900">
                    {s.originalBatchName || `Intake ${s.admissionYear}`}
                  </span>
                </div>
              )}
              <div className="px-3 py-2 rounded-lg bg-[#FAF9F5] border border-stone-200">
                <span className="text-[10px] uppercase tracking-wider text-stone-500 block font-semibold">
                  Current Placement
                </span>
                <span className="font-semibold text-stone-900">
                  {s.currentPlacementBatchName || s.originalBatchName || '—'}
                </span>
              </div>
              <div className="px-3 py-2 rounded-lg bg-[#FAF9F5] border border-stone-200">
                <span className="text-[10px] uppercase tracking-wider text-stone-500 block font-semibold">
                  Admission Quota
                </span>
                <span className="font-semibold text-stone-900">
                  {formatQuotaLabel(s.admissionQuota)}
                </span>
              </div>
            </div>
          </div>

          {/* Course Duration & Admission Date Verification Banner (Section 13) */}
          {!isLegacyRs6 && s.admissionDateRequiresVerification ? (
            <div className="p-3 rounded-lg border bg-amber-50 border-amber-200 text-amber-950 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Admission date requires verification</span>
                <span className="block text-[11px] opacity-90 mt-0.5">
                  {s.admissionDateVerificationNote ||
                    'Course-duration calculation and exhaustion flags are withheld until an official verified admission date is recorded.'}
                </span>
              </div>
            </div>
          ) : (
            (s.courseDurationFlag || s.approachingCourseDurationLimit) &&
            s.elapsedYearsFromAdmission !== null && (
              <div
                className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${
                  s.courseDurationFlag
                    ? 'bg-rose-50 border-rose-200 text-rose-950'
                    : 'bg-amber-50 border-amber-200 text-amber-950'
                }`}
              >
                <Clock className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">
                    {s.courseDurationFlag
                      ? `Course Duration Limit Reached / Exceeded (${s.elapsedYearsFromAdmission} yrs vs ${s.maxCourseDurationYears}-yr max)`
                      : `Approaching Maximum Course Duration (${s.elapsedYearsFromAdmission} yrs elapsed of ${s.maxCourseDurationYears}-yr max)`}
                  </span>
                  <span className="block text-[11px] opacity-90 mt-0.5">
                    Flagged for Principal &amp; Office administrative review from official admission date ({s.admissionDate}). KAMCH ERP never auto-expels or deactivates students automatically.
                  </span>
                </div>
              </div>
            )
          )}

        </CardContent>
      </Card>

      {localMsg && (
        <div
          className={`p-3 rounded-lg text-xs border flex items-center justify-between gap-2 ${
            localMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <span>{localMsg.text}</span>
          <button
            type="button"
            onClick={() => setLocalMsg(null)}
            className="text-stone-500 hover:text-stone-800 font-semibold cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Horizontal Section Tabs */}
      <div className="bg-white rounded-xl border border-stone-200 px-3 overflow-x-auto">
        <div className="flex items-center gap-4 min-w-max">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setActiveTab(t.id);
                setLocalMsg(null);
              }}
              className={`py-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === t.id
                  ? 'border-[#4B2E2E] text-[#4B2E2E]'
                  : 'border-transparent text-stone-500 hover:text-stone-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB 1: OVERVIEW (OR RS6 MINIMAL SUMMARY) */}
      {activeTab === 'overview' && (
        <Card>
          <CardContent className="p-5 space-y-5">
            {isLegacyRs6 ? (
              <form onSubmit={handleSaveProfileSection} className="space-y-4">
                <div className="p-3.5 rounded-lg bg-amber-50/50 border border-amber-200 text-xs text-stone-700">
                  <strong>RS6 Legacy Minimal Record:</strong> Pre-2021–22 historical record. Newer three-professional-year progression rules are intentionally not applied.
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField id="rs6-edit-name" label="Student Full Name" required>
                    <Input
                      id="rs6-edit-name"
                      required
                      value={editState.fullName || ''}
                      onChange={(e) => setEditState({ ...editState, fullName: e.target.value })}
                    />
                  </FormField>
                  <FormField id="rs6-edit-phone" label="Contact Phone">
                    <Input
                      id="rs6-edit-phone"
                      value={editState.contactPhone || ''}
                      onChange={(e) =>
                        setEditState({ ...editState, contactPhone: e.target.value })
                      }
                    />
                  </FormField>
                </div>

                <FormField id="rs6-edit-summary" label="RS6 Academic Standing Summary">
                  <Textarea
                    id="rs6-edit-summary"
                    rows={3}
                    value={editState.rs6AcademicSummary || ''}
                    onChange={(e) =>
                      setEditState({ ...editState, rs6AcademicSummary: e.target.value })
                    }
                  />
                </FormField>

                <label className="flex items-center gap-2.5 text-xs font-semibold text-stone-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(editState.rs6InternshipCompleted)}
                    onChange={(e) =>
                      setEditState({
                        ...editState,
                        rs6InternshipCompleted: e.target.checked,
                        administrativeStatus: e.target.checked
                          ? 'COMPLETED'
                          : editState.administrativeStatus,
                      })
                    }
                    className="rounded border-stone-300 text-[#4B2E2E]"
                  />
                  <span>1-Year Compulsory Rotating Internship Completed</span>
                </label>

                <div className="flex justify-end pt-2 border-t border-stone-200">
                  <Button type="submit" variant="primary" size="sm" isLoading={isSaving}>
                    Save RS6 Record Summary
                  </Button>
                </div>
              </form>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg border border-stone-200 bg-[#FAF9F5] space-y-2 text-xs">
                  <div className="font-semibold text-[#4B2E2E] uppercase tracking-wider text-[11px]">
                    Academic Standing
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">Professional Year:</span>
                    <strong className="tabular-nums">{s.currentYearOfStudy}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">Progression Status:</span>
                    <strong>{formatProgressionStatusLabel(s.progressionStatus)}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">Current Cohort:</span>
                    <strong>{s.currentPlacementBatchName || s.originalBatchName || '—'}</strong>
                  </div>
                  {progressionView.showDetentionStage && (
                    <div className="flex justify-between">
                      <span className="text-stone-500">Detention Stage:</span>
                      <strong className="tabular-nums">Stage {s.detentionStage}</strong>
                    </div>
                  )}
                  {progressionView.showOutstandingSubjects && (
                    <div className="flex justify-between">
                      <span className="text-stone-500">Outstanding Subjects:</span>
                      <strong className="tabular-nums text-rose-700">
                        {s.outstandingBacklogsCount}
                      </strong>
                    </div>
                  )}
                </div>

                <div className="p-4 rounded-lg border border-stone-200 bg-[#FAF9F5] space-y-2 text-xs">
                  <div className="font-semibold text-[#4B2E2E] uppercase tracking-wider text-[11px]">
                    Admission &amp; Duration
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">Admission Status:</span>
                    <strong>{s.admissionStatus}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">Seat Category:</span>
                    <strong>{s.seatCategory || '—'}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">Official Admission Date:</span>
                    <strong className="font-mono">{s.admissionDate || 'Not Recorded'}</strong>
                  </div>
                  <div className="flex justify-between tabular-nums gap-2">
                    <span className="text-stone-500">Elapsed Course Time:</span>
                    {s.admissionDateRequiresVerification || s.elapsedYearsFromAdmission === null ? (
                      <strong className="text-amber-800 text-right">
                        Admission date requires verification
                      </strong>
                    ) : (
                      <strong>
                        {s.elapsedYearsFromAdmission} / {s.maxCourseDurationYears} yrs
                      </strong>
                    )}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">Documents Verified:</span>
                    <strong className="tabular-nums">
                      {profile.documents.filter((d) => d.verificationStatus === 'VERIFIED').length} /{' '}
                      {profile.documents.length}
                    </strong>
                  </div>
                </div>

                <div className="p-4 rounded-lg border border-stone-200 bg-[#FAF9F5] space-y-2 text-xs tabular-nums">
                  <div className="font-semibold text-[#4B2E2E] uppercase tracking-wider text-[11px]">
                    Fees Summary ({profile.feesSummary.academicYear || 'Current'})
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">Revised Payable:</span>
                    <strong>{formatInr(profile.feesSummary.revisedPayable)}</strong>
                  </div>
                  <div className="flex justify-between text-emerald-800">
                    <span>Verified Paid:</span>
                    <strong>{formatInr(profile.feesSummary.totalVerifiedPaid)}</strong>
                  </div>
                  <div className="flex justify-between text-amber-800">
                    <span>Pending Bank Verif.:</span>
                    <strong>{formatInr(profile.feesSummary.pendingBankVerificationAmount)}</strong>
                  </div>
                  <div className="flex justify-between border-t border-stone-200 pt-1.5 text-stone-900">
                    <span className="font-semibold">Outstanding Balance:</span>
                    <strong className="text-sm">
                      {formatInr(profile.feesSummary.outstandingBalance)}
                    </strong>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* TAB 2: PERSONAL & CONTACT */}
      {activeTab === 'personal' && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Personal &amp; Contact Information</CardTitle>
              <CardDescription>
                Core student demographics, university recorded name, and residential addresses.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveProfileSection} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <FormField id="p-name" label="Full Legal Name" required>
                  <Input
                    id="p-name"
                    required
                    value={editState.fullName || ''}
                    onChange={(e) => setEditState({ ...editState, fullName: e.target.value })}
                  />
                </FormField>
                <FormField id="p-uname" label="Official University Recorded Name">
                  <Input
                    id="p-uname"
                    value={editState.universityRecordedName || ''}
                    onChange={(e) =>
                      setEditState({ ...editState, universityRecordedName: e.target.value })
                    }
                  />
                </FormField>
                <FormField id="p-dob" label="Date of Birth">
                  <Input
                    id="p-dob"
                    type="date"
                    value={editState.dateOfBirth || ''}
                    onChange={(e) => setEditState({ ...editState, dateOfBirth: e.target.value })}
                  />
                </FormField>
                <FormField id="p-gender" label="Gender">
                  <Select
                    id="p-gender"
                    value={editState.gender || ''}
                    onChange={(e) => setEditState({ ...editState, gender: e.target.value })}
                  >
                    <option value="">Not Specified</option>
                    <option value="FEMALE">Female</option>
                    <option value="MALE">Male</option>
                    <option value="OTHER">Other</option>
                    <option value="NOT_SPECIFIED">Prefer Not to Specify</option>
                  </Select>
                </FormField>
                <FormField id="p-nat" label="Nationality">
                  <Input
                    id="p-nat"
                    value={editState.nationality || ''}
                    onChange={(e) => setEditState({ ...editState, nationality: e.target.value })}
                  />
                </FormField>
                <FormField id="p-phone" label="Mobile Number">
                  <Input
                    id="p-phone"
                    value={editState.contactPhone || ''}
                    onChange={(e) => setEditState({ ...editState, contactPhone: e.target.value })}
                  />
                </FormField>
                <FormField id="p-email" label="Email Address">
                  <Input
                    id="p-email"
                    type="email"
                    value={editState.contactEmail || ''}
                    onChange={(e) => setEditState({ ...editState, contactEmail: e.target.value })}
                  />
                </FormField>
                <FormField id="p-city" label="City / Town">
                  <Input
                    id="p-city"
                    value={editState.cityTown || ''}
                    onChange={(e) => setEditState({ ...editState, cityTown: e.target.value })}
                  />
                </FormField>
                <FormField id="p-dist" label="District">
                  <Input
                    id="p-dist"
                    value={editState.district || ''}
                    onChange={(e) => setEditState({ ...editState, district: e.target.value })}
                  />
                </FormField>
                <FormField id="p-state" label="State">
                  <Input
                    id="p-state"
                    value={editState.state || ''}
                    onChange={(e) => setEditState({ ...editState, state: e.target.value })}
                  />
                </FormField>
                <FormField id="p-pin" label="PIN Code">
                  <Input
                    id="p-pin"
                    className="font-mono"
                    value={editState.pinCode || ''}
                    onChange={(e) => setEditState({ ...editState, pinCode: e.target.value })}
                  />
                </FormField>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <FormField id="p-cur-addr" label="Current Residential Address">
                  <Textarea
                    id="p-cur-addr"
                    rows={2}
                    value={editState.currentAddress || ''}
                    onChange={(e) =>
                      setEditState({ ...editState, currentAddress: e.target.value })
                    }
                  />
                </FormField>
                <FormField id="p-perm-addr" label="Permanent Address">
                  <Textarea
                    id="p-perm-addr"
                    rows={2}
                    value={editState.permanentAddress || ''}
                    onChange={(e) =>
                      setEditState({ ...editState, permanentAddress: e.target.value })
                    }
                  />
                </FormField>
              </div>

              <FormField id="p-remarks" label="Profile Remarks">
                <Input
                  id="p-remarks"
                  value={editState.profileRemarks || ''}
                  onChange={(e) => setEditState({ ...editState, profileRemarks: e.target.value })}
                />
              </FormField>

              <div className="flex justify-end pt-2 border-t border-stone-200">
                <Button type="submit" variant="primary" size="sm" isLoading={isSaving}>
                  Save Personal &amp; Contact Details
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* TAB 3: PARENT, GUARDIAN & EMERGENCY */}
      {activeTab === 'guardian' && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Parent, Guardian &amp; Emergency Contacts</CardTitle>
              <CardDescription>
                Institutional parent/guardian directory and emergency contact details.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveProfileSection} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <FormField id="g-fname" label="Father's Name">
                  <Input
                    id="g-fname"
                    value={editState.fatherName || ''}
                    onChange={(e) => setEditState({ ...editState, fatherName: e.target.value })}
                  />
                </FormField>
                <FormField id="g-fphone" label="Father's Phone">
                  <Input
                    id="g-fphone"
                    value={editState.fatherPhone || ''}
                    onChange={(e) => setEditState({ ...editState, fatherPhone: e.target.value })}
                  />
                </FormField>
                <FormField id="g-mname" label="Mother's Name">
                  <Input
                    id="g-mname"
                    value={editState.motherName || ''}
                    onChange={(e) => setEditState({ ...editState, motherName: e.target.value })}
                  />
                </FormField>
                <FormField id="g-mphone" label="Mother's Phone">
                  <Input
                    id="g-mphone"
                    value={editState.motherPhone || ''}
                    onChange={(e) => setEditState({ ...editState, motherPhone: e.target.value })}
                  />
                </FormField>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-2 border-t border-stone-200">
                <FormField id="g-gname" label="Local Guardian Name">
                  <Input
                    id="g-gname"
                    value={editState.guardianName || ''}
                    onChange={(e) => setEditState({ ...editState, guardianName: e.target.value })}
                  />
                </FormField>
                <FormField id="g-grel" label="Guardian Relationship">
                  <Input
                    id="g-grel"
                    value={editState.guardianRelationship || ''}
                    onChange={(e) =>
                      setEditState({ ...editState, guardianRelationship: e.target.value })
                    }
                  />
                </FormField>
                <FormField id="g-gphone" label="Guardian Phone">
                  <Input
                    id="g-gphone"
                    value={editState.guardianPhone || ''}
                    onChange={(e) =>
                      setEditState({ ...editState, guardianPhone: e.target.value })
                    }
                  />
                </FormField>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-2 border-t border-stone-200">
                <FormField id="g-ename" label="Emergency Contact Name">
                  <Input
                    id="g-ename"
                    value={editState.emergencyContactName || ''}
                    onChange={(e) =>
                      setEditState({ ...editState, emergencyContactName: e.target.value })
                    }
                  />
                </FormField>
                <FormField id="g-erel" label="Emergency Relationship">
                  <Input
                    id="g-erel"
                    value={editState.emergencyContactRelationship || ''}
                    onChange={(e) =>
                      setEditState({ ...editState, emergencyContactRelationship: e.target.value })
                    }
                  />
                </FormField>
                <FormField id="g-ephone" label="Emergency Contact Phone">
                  <Input
                    id="g-ephone"
                    value={editState.emergencyContactPhone || ''}
                    onChange={(e) =>
                      setEditState({ ...editState, emergencyContactPhone: e.target.value })
                    }
                  />
                </FormField>
              </div>

              <FormField id="g-addr" label="Parent / Guardian Address">
                <Textarea
                  id="g-addr"
                  rows={2}
                  value={editState.parentGuardianAddress || ''}
                  onChange={(e) =>
                    setEditState({ ...editState, parentGuardianAddress: e.target.value })
                  }
                />
              </FormField>

              <div className="flex justify-end pt-2 border-t border-stone-200">
                <Button type="submit" variant="primary" size="sm" isLoading={isSaving}>
                  Save Parent &amp; Emergency Details
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* TAB 4: ADMISSION, QUOTA & ADMINISTRATIVE STATUS */}
      {activeTab === 'admission' && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Admission, Quota, Qualifying Exam &amp; Administrative Status</CardTitle>
              <CardDescription>
                Separates Admission Quota (linked to Fees Management) from Seat / Reservation Category. Hard deletion is disabled.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveProfileSection} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <FormField
                  id="a-quota"
                  label="Admission Quota"
                  helperText={isOfficeRole ? 'Office accounts cannot alter registered quota.' : undefined}
                >
                  <Select
                    id="a-quota"
                    disabled={isOfficeRole}
                    value={editState.admissionQuota || 'GOVERNMENT'}
                    onChange={(e) =>
                      setEditState({ ...editState, admissionQuota: e.target.value })
                    }
                  >
                    <option value="GOVERNMENT">Government Quota</option>
                    <option value="MANAGEMENT_PRIVATE">Management / Private Quota</option>
                    <option value="NRI">NRI Quota</option>
                  </Select>
                </FormField>
                <FormField id="a-seat" label="Seat Category">
                  <Input
                    id="a-seat"
                    placeholder="e.g. GM, 2A, 3B, SC, ST"
                    value={editState.seatCategory || ''}
                    onChange={(e) => setEditState({ ...editState, seatCategory: e.target.value })}
                  />
                </FormField>
                <FormField id="a-res" label="Reservation Details">
                  <Input
                    id="a-res"
                    placeholder="e.g. Rural / Kannada Medium / HK"
                    value={editState.reservationDetails || ''}
                    onChange={(e) =>
                      setEditState({ ...editState, reservationDetails: e.target.value })
                    }
                  />
                </FormField>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5">
                <FormField
                  id="a-date"
                  label="Official Admission Date"
                  helperText={
                    s.admissionDateRequiresVerification
                      ? 'Admission date requires verification'
                      : undefined
                  }
                >
                  <Input
                    id="a-date"
                    type="date"
                    value={editState.admissionDate || ''}
                    onChange={(e) => setEditState({ ...editState, admissionDate: e.target.value })}
                  />
                </FormField>
                <FormField id="a-status" label="Admission Status">
                  <Select
                    id="a-status"
                    value={editState.admissionStatus || 'PROVISIONAL'}
                    onChange={(e) =>
                      setEditState({ ...editState, admissionStatus: e.target.value })
                    }
                  >
                    <option value="APPLIED">Applied</option>
                    <option value="PROVISIONAL">Provisional</option>
                    <option value="CONFIRMED">Confirmed</option>
                    <option value="CANCELLED">Cancelled</option>
                  </Select>
                </FormField>
                <FormField id="a-conf" label="Confirmation Date">
                  <Input
                    id="a-conf"
                    type="date"
                    value={editState.confirmationDate || ''}
                    onChange={(e) =>
                      setEditState({ ...editState, confirmationDate: e.target.value })
                    }
                  />
                </FormField>
                <FormField id="a-order" label="Admission Order / Allotment Ref.">
                  <Input
                    id="a-order"
                    className="font-mono"
                    value={editState.admissionOrderRef || ''}
                    onChange={(e) =>
                      setEditState({ ...editState, admissionOrderRef: e.target.value })
                    }
                  />
                </FormField>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5">
                <FormField id="a-neet" label="NEET Roll Number">
                  <Input
                    id="a-neet"
                    className="font-mono"
                    value={editState.neetRollNumber || ''}
                    onChange={(e) =>
                      setEditState({ ...editState, neetRollNumber: e.target.value })
                    }
                  />
                </FormField>
                <FormField id="a-score" label="NEET Score / Rank">
                  <Input
                    id="a-score"
                    value={editState.neetScore || ''}
                    onChange={(e) => setEditState({ ...editState, neetScore: e.target.value })}
                  />
                </FormField>
                <FormField id="a-kea" label="KEA Acknowledgement No.">
                  <Input
                    id="a-kea"
                    className="font-mono"
                    value={editState.keaAcknowledgementNo || ''}
                    onChange={(e) =>
                      setEditState({ ...editState, keaAcknowledgementNo: e.target.value })
                    }
                  />
                </FormField>
                <FormField id="a-app" label="Application Identifier">
                  <Input
                    id="a-app"
                    className="font-mono"
                    value={editState.applicationIdentifier || ''}
                    onChange={(e) =>
                      setEditState({ ...editState, applicationIdentifier: e.target.value })
                    }
                  />
                </FormField>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5 pt-2 border-t border-stone-200">
                <FormField id="a-qexam" label="Qualifying Examination">
                  <Input
                    id="a-qexam"
                    value={editState.qualifyingExam || ''}
                    onChange={(e) =>
                      setEditState({ ...editState, qualifyingExam: e.target.value })
                    }
                  />
                </FormField>
                <FormField id="a-qboard" label="Board / University">
                  <Input
                    id="a-qboard"
                    value={editState.qualifyingBoard || ''}
                    onChange={(e) =>
                      setEditState({ ...editState, qualifyingBoard: e.target.value })
                    }
                  />
                </FormField>
                <FormField id="a-qyear" label="Passing Year">
                  <Input
                    id="a-qyear"
                    type="number"
                    value={editState.qualifyingYear || ''}
                    onChange={(e) =>
                      setEditState({ ...editState, qualifyingYear: e.target.value })
                    }
                  />
                </FormField>
                <FormField id="a-qmarks" label="PCB / Aggregate Marks %">
                  <Input
                    id="a-qmarks"
                    value={editState.qualifyingMarksPercentage || ''}
                    onChange={(e) =>
                      setEditState({ ...editState, qualifyingMarksPercentage: e.target.value })
                    }
                  />
                </FormField>
              </div>

              <div className="p-3.5 rounded-lg bg-[#FAF9F5] border border-stone-200 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <FormField id="a-admin-st" label="Administrative Registry Status">
                  <Select
                    id="a-admin-st"
                    value={editState.administrativeStatus || 'ACTIVE'}
                    onChange={(e) =>
                      setEditState({ ...editState, administrativeStatus: e.target.value })
                    }
                  >
                    <option value="ADMISSION_PENDING">Admission Pending</option>
                    <option value="ACTIVE">Active</option>
                    <option value="COMPLETED">Completed / Graduated</option>
                    <option value="DISCONTINUED">Discontinued (Requires Reason)</option>
                    <option value="CANCELLED">Admission Cancelled (Requires Reason)</option>
                  </Select>
                </FormField>
                <FormField
                  id="a-admin-reason"
                  label="Administrative Status / Change Reason"
                  required={['DISCONTINUED', 'CANCELLED'].includes(editState.administrativeStatus)}
                >
                  <Input
                    id="a-admin-reason"
                    placeholder="Mandatory when marking Discontinued or Cancelled"
                    value={editState.administrativeStatusReason || ''}
                    onChange={(e) =>
                      setEditState({ ...editState, administrativeStatusReason: e.target.value })
                    }
                  />
                </FormField>
              </div>

              <div className="flex justify-end pt-2 border-t border-stone-200">
                <Button type="submit" variant="primary" size="sm" isLoading={isSaving}>
                  Save Admission &amp; Status Details
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* TAB 5: OFFICIAL IDENTIFIERS & HISTORY */}
      {activeTab === 'identifiers' && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Roll Number &amp; Permanent RGUHS University Registration</CardTitle>
                <CardDescription>
                  Verifying the RGUHS permanent number promotes it to the active displayed student identifier while preserving the temporary roll number in history and search. Internal student ID #{s.id} never changes.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs tabular-nums">
                <div className="p-3 rounded-lg bg-[#FAF9F5] border border-stone-200">
                  <span className="text-[10px] uppercase font-semibold text-stone-500 block">
                    Active Displayed Student ID
                  </span>
                  <span className="font-mono font-bold text-sm text-[#4B2E2E]">
                    {s.studentIdNumber}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-[#FAF9F5] border border-stone-200">
                  <span className="text-[10px] uppercase font-semibold text-stone-500 block">
                    Original Temporary Roll No.
                  </span>
                  <span className="font-mono font-semibold text-sm text-stone-800">
                    {s.temporaryRollNumber}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-[#FAF9F5] border border-stone-200">
                  <span className="text-[10px] uppercase font-semibold text-stone-500 block">
                    RGUHS Verification Status
                  </span>
                  <span className="font-semibold text-sm text-stone-900">
                    {s.universityRegStatus.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>

              <form
                onSubmit={handleSaveUniversityNumber}
                className="p-4 rounded-lg border border-stone-200 bg-white space-y-3"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormField
                    id="u-perm"
                    label="Permanent RGUHS University Registration Number"
                    required
                  >
                    <Input
                      id="u-perm"
                      required
                      className="font-mono uppercase"
                      placeholder="e.g. 24A0156"
                      value={univForm.permanentUniversityNumber}
                      onChange={(e) =>
                        setUnivForm({
                          ...univForm,
                          permanentUniversityNumber: e.target.value.toUpperCase(),
                        })
                      }
                    />
                  </FormField>
                  <FormField
                    id="u-reason"
                    label="Verification / Allotment Reference Note"
                    required={s.universityRegStatus === 'VERIFIED'}
                  >
                    <Input
                      id="u-reason"
                      placeholder="e.g. RGUHS Approval List Ref. 2025/BAMS/04"
                      value={univForm.reason}
                      onChange={(e) => setUnivForm({ ...univForm, reason: e.target.value })}
                    />
                  </FormField>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <label className="flex items-center gap-2 text-xs font-medium text-stone-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={univForm.verifyNow}
                      onChange={(e) =>
                        setUnivForm({ ...univForm, verifyNow: e.target.checked })
                      }
                      className="rounded border-stone-300 text-[#4B2E2E]"
                    />
                    <span>Verify &amp; replace temporary roll number as active displayed ID now</span>
                  </label>

                  <div className="flex items-center gap-2">
                    {s.universityRegStatus === 'PENDING_VERIFICATION' &&
                      s.permanentUniversityNumber && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          icon={<ShieldCheck className="w-3.5 h-3.5" />}
                          isLoading={isSaving}
                          onClick={handleVerifyPendingUniversityNumber}
                        >
                          Verify Pending Number ({s.permanentUniversityNumber})
                        </Button>
                      )}
                    <Button type="submit" variant="primary" size="sm" isLoading={isSaving}>
                      Save University Number
                    </Button>
                  </div>
                </div>
              </form>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-stone-800">
                  Identifier Change &amp; Verification History
                </div>
                <div className="overflow-x-auto border border-stone-200 rounded-lg">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-[#FAF9F5] border-b border-stone-200 text-[11px] font-semibold uppercase text-stone-600">
                      <tr>
                        <th className="py-2 px-3">Event</th>
                        <th className="py-2 px-3">Previous ID</th>
                        <th className="py-2 px-3">New ID</th>
                        <th className="py-2 px-3">Status</th>
                        <th className="py-2 px-3">Reason &amp; Actor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200">
                      {profile.identifierHistory.map((h) => (
                        <tr key={h.id}>
                          <td className="py-2 px-3 font-medium">
                            {h.identifierType.replace(/_/g, ' ')}
                          </td>
                          <td className="py-2 px-3 font-mono text-stone-500">
                            {h.previousIdentifier || '—'}
                          </td>
                          <td className="py-2 px-3 font-mono font-semibold text-[#4B2E2E]">
                            {h.newIdentifier}
                          </td>
                          <td className="py-2 px-3">{h.verificationStatus}</td>
                          <td className="py-2 px-3 text-stone-600">
                            <div>{h.reason}</div>
                            <span className="text-[11px] text-stone-400">
                              {h.actorName || 'System'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 6: DOCUMENTS METADATA */}
      {activeTab === 'documents' && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Admission &amp; Eligibility Document Verification Metadata</CardTitle>
              <CardDescription>
                Records physical document receipt, reference numbers, and verification status only. Photographs and binary file uploads are intentionally excluded in this phase.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              onSubmit={handleAddDocument}
              className="p-4 rounded-lg bg-[#FAF9F5] border border-stone-200 space-y-3"
            >
              <div className="text-xs font-semibold text-[#4B2E2E]">
                Add Document Verification Entry
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <FormField id="doc-type" label="Document Type" required>
                  <Select
                    id="doc-type"
                    value={docForm.documentType}
                    onChange={(e) => {
                      const val = e.target.value;
                      const labels: Record<string, string> = {
                        NEET_SCORE_CARD: 'NEET UG Score Card',
                        KEA_ALLOTMENT_ORDER: 'KEA / Ayush Allotment Order',
                        SSLC_10TH_MARKS: '10th / SSLC Marks Card',
                        PUC_12TH_MARKS: 'PUC II / 12th Marks Card',
                        TRANSFER_CERTIFICATE: 'Transfer Certificate (TC)',
                        CASTE_INCOME_CERT: 'Caste / Category Certificate',
                        ELIGIBILITY_CERT_RGUHS: 'RGUHS Eligibility Certificate',
                        MIGRATION_CERTIFICATE: 'Migration Certificate',
                      };
                      setDocForm({
                        ...docForm,
                        documentType: val,
                        documentLabel: labels[val] || val,
                      });
                    }}
                  >
                    <option value="NEET_SCORE_CARD">NEET UG Score Card</option>
                    <option value="KEA_ALLOTMENT_ORDER">KEA / Ayush Allotment Order</option>
                    <option value="SSLC_10TH_MARKS">10th / SSLC Marks Card</option>
                    <option value="PUC_12TH_MARKS">PUC II / 12th Marks Card</option>
                    <option value="TRANSFER_CERTIFICATE">Transfer Certificate (TC)</option>
                    <option value="CASTE_INCOME_CERT">Caste / Category Certificate</option>
                    <option value="ELIGIBILITY_CERT_RGUHS">RGUHS Eligibility Certificate</option>
                    <option value="MIGRATION_CERTIFICATE">Migration Certificate</option>
                  </Select>
                </FormField>
                <FormField id="doc-ref" label="Certificate / Serial Ref. No.">
                  <Input
                    id="doc-ref"
                    className="font-mono"
                    value={docForm.referenceNumber}
                    onChange={(e) =>
                      setDocForm({ ...docForm, referenceNumber: e.target.value })
                    }
                  />
                </FormField>
                <FormField id="doc-recv" label="Received Status">
                  <Select
                    id="doc-recv"
                    value={docForm.receivedStatus}
                    onChange={(e) => setDocForm({ ...docForm, receivedStatus: e.target.value })}
                  >
                    <option value="PENDING">Pending Submission</option>
                    <option value="RECEIVED">Original Received</option>
                    <option value="RETURNED_ORIGINAL">Returned to Student</option>
                    <option value="NOT_APPLICABLE">Not Applicable</option>
                  </Select>
                </FormField>
                <FormField id="doc-verif" label="Verification Status">
                  <Select
                    id="doc-verif"
                    value={docForm.verificationStatus}
                    onChange={(e) =>
                      setDocForm({ ...docForm, verificationStatus: e.target.value })
                    }
                  >
                    <option value="UNVERIFIED">Unverified</option>
                    <option value="VERIFIED">Verified</option>
                    <option value="DISCREPANCY">Discrepancy Noted</option>
                  </Select>
                </FormField>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <FormField id="doc-date" label="Issue Date">
                  <Input
                    id="doc-date"
                    type="date"
                    value={docForm.issueDate}
                    onChange={(e) => setDocForm({ ...docForm, issueDate: e.target.value })}
                  />
                </FormField>
                <FormField id="doc-rem" label="Verification Remarks">
                  <Input
                    id="doc-rem"
                    value={docForm.remarks}
                    onChange={(e) => setDocForm({ ...docForm, remarks: e.target.value })}
                  />
                </FormField>
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    icon={<FileText className="w-3.5 h-3.5" />}
                    isLoading={isSaving}
                  >
                    Record Document Metadata
                  </Button>
                </div>
              </div>
            </form>

            <div className="overflow-x-auto border border-stone-200 rounded-lg">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#FAF9F5] border-b border-stone-200 text-[11px] font-semibold uppercase text-stone-600">
                  <tr>
                    <th className="py-2.5 px-3">Document</th>
                    <th className="py-2.5 px-3">Reference &amp; Issue Date</th>
                    <th className="py-2.5 px-3">Custody</th>
                    <th className="py-2.5 px-3">Verification</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {profile.documents.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-stone-500">
                        No document metadata recorded for this student yet.
                      </td>
                    </tr>
                  ) : (
                    profile.documents.map((d) => (
                      <tr key={d.id}>
                        <td className="py-2.5 px-3">
                          <span className="font-semibold text-stone-900 block">
                            {d.documentLabel || d.documentType}
                          </span>
                          {d.remarks && (
                            <span className="text-[11px] text-stone-500">{d.remarks}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono tabular-nums text-stone-700">
                          <div>{d.referenceNumber || '—'}</div>
                          {d.issueDate && (
                            <span className="text-[11px] text-stone-500">{d.issueDate}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">{d.receivedStatus.replace(/_/g, ' ')}</td>
                        <td className="py-2.5 px-3">
                          <Badge
                            variant={
                              d.verificationStatus === 'VERIFIED'
                                ? 'success'
                                : d.verificationStatus === 'DISCREPANCY'
                                ? 'warning'
                                : 'neutral'
                            }
                            size="sm"
                          >
                            {d.verificationStatus}
                          </Badge>
                          {d.verifierName && (
                            <span className="block text-[10px] text-stone-400 mt-0.5">
                              by {d.verifierName}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleToggleDocVerified(d)}
                          >
                            {d.verificationStatus === 'VERIFIED'
                              ? 'Mark Unverified'
                              : 'Mark Verified'}
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* TAB 7: ACADEMIC PROGRESSION */}
      {activeTab === 'progression' && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Academic Progression</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Minimal Verified Standing & Placement Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs tabular-nums">
                <div className="p-3 rounded-lg bg-[#FAF9F5] border border-stone-200">
                  <span className="text-[10px] uppercase font-semibold text-stone-500 block">
                    Verified Academic Status
                  </span>
                  <span className="font-semibold text-[#4B2E2E] block mt-0.5">
                    {formatProgressionStatusLabel(s.progressionStatus)}
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-[#FAF9F5] border border-stone-200">
                  <span className="text-[10px] uppercase font-semibold text-stone-500 block">
                    Current Placement
                  </span>
                  <span className="font-semibold text-stone-900 block mt-0.5">
                    {s.currentPlacementBatchName || s.originalBatchName || '—'}
                  </span>
                  <span className="text-[10px] text-stone-500">
                    Prof. Year {s.currentYearOfStudy}
                  </span>
                </div>

                {progressionView.showOriginalBatch && (
                  <div className="p-3 rounded-lg bg-[#FAF9F5] border border-stone-200">
                    <span className="text-[10px] uppercase font-semibold text-stone-500 block">
                      Original Admission Batch
                    </span>
                    <span className="font-semibold text-stone-900 block mt-0.5">
                      {s.originalBatchName || `Intake ${s.admissionYear}`}
                    </span>
                    <span className="text-[10px] text-stone-500">
                      {s.admissionAcademicYear || s.admissionYear}
                    </span>
                  </div>
                )}

                {progressionView.showDetentionStage && (
                  <div className="p-3 rounded-lg bg-[#FAF9F5] border border-stone-200">
                    <span className="text-[10px] uppercase font-semibold text-stone-500 block">
                      Detention Stage
                    </span>
                    <span className="font-bold text-sm text-stone-900 block mt-0.5">
                      Stage {s.detentionStage}
                    </span>
                    <span className="text-[10px] text-stone-500">
                      {s.detentionStage === 1
                        ? 'Odd-Batch Placement'
                        : s.detentionStage === 2
                        ? 'Split-Term Placement'
                        : 'Subsequent Junior Cohort'}
                    </span>
                  </div>
                )}

                {progressionView.showRoutingMode && s.classroomMapping && (
                  <div className="p-3 rounded-lg bg-[#FAF9F5] border border-stone-200">
                    <span className="text-[10px] uppercase font-semibold text-stone-500 block">
                      Classroom Routing
                    </span>
                    <span className="font-semibold text-stone-900 block mt-0.5">
                      {s.classroomMapping.mode.replace(/_/g, ' ')}
                    </span>
                    {!progressionView.showSplitTermCards && s.classroomMapping.summary && (
                      <span className="text-[10px] text-stone-500 block mt-0.5">
                        {s.classroomMapping.summary}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Conditional Split-Term Cohort Mapping (ONLY when verified split-term / distinct term cohorts apply) */}
              {progressionView.showSplitTermCards && s.classroomMapping && (
                <div className="p-3.5 rounded-lg bg-[#FAF3DC]/50 border border-[#E7CD7A] space-y-2 text-xs">
                  <div className="font-semibold text-[#4B2E2E]">
                    Term-Wise Cohort Placement
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11px]">
                    <div className="p-2.5 rounded bg-white border border-stone-200">
                      <span className="text-[10px] uppercase font-semibold text-stone-500 block">
                        Term 1 Cohort
                      </span>
                      <strong className="text-stone-900">
                        {s.classroomMapping.term1.batchName}
                      </strong>
                      <span className="block text-[10px] text-stone-500">
                        {s.classroomMapping.term1.relationship.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="p-2.5 rounded bg-white border border-stone-200">
                      <span className="text-[10px] uppercase font-semibold text-stone-500 block">
                        Term 2 Cohort
                      </span>
                      <strong className="text-stone-900">
                        {s.classroomMapping.term2.batchName}
                      </strong>
                      <span className="block text-[10px] text-stone-500">
                        {s.classroomMapping.term2.relationship.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="p-2.5 rounded bg-white border border-stone-200">
                      <span className="text-[10px] uppercase font-semibold text-stone-500 block">
                        Term 3 Cohort
                      </span>
                      <strong className="text-stone-900">
                        {s.classroomMapping.term3.batchName}
                      </strong>
                      <span className="block text-[10px] text-stone-500">
                        {s.classroomMapping.term3.relationship.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>
                  {s.classroomMapping.summary && (
                    <p className="text-[11px] text-stone-700">{s.classroomMapping.summary}</p>
                  )}
                </div>
              )}

              {/* Conditional Outstanding Subjects (ONLY when verified backlog count > 0) */}
              {progressionView.showOutstandingSubjects && (
                <div className="p-3.5 rounded-lg bg-rose-50/60 border border-rose-200 space-y-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-rose-900">
                      Outstanding Subjects ({s.outstandingBacklogsCount})
                    </span>
                    {s.supplementaryDueCycle && (
                      <span className="text-[11px] text-rose-800">
                        {s.supplementaryDueCycle}
                      </span>
                    )}
                  </div>
                  {progressionView.outstandingSubjects.length > 0 && (
                    <ul className="space-y-1 text-[11px] text-rose-950">
                      {progressionView.outstandingSubjects.map((sub) => (
                        <li
                          key={sub.code}
                          className="px-2.5 py-1.5 rounded bg-white border border-rose-200/80 flex flex-wrap items-center justify-between gap-2"
                        >
                          <span>
                            <strong className="font-mono">{sub.code}</strong> — {sub.name}
                          </span>
                          {sub.reason && (
                            <span className="text-rose-700">{sub.reason}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Conditional Pending Office Review (shows ONLY the relevant issue and action) */}
              {progressionView.showPendingReviewSection && (
                <div className="p-3.5 rounded-lg bg-amber-50/70 border border-amber-200 space-y-3 text-xs text-amber-950">
                  <div className="font-semibold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>Pending Office Review</span>
                  </div>

                  {progressionView.pendingReviewEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className="p-3 rounded bg-white border border-amber-200 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-stone-600">
                        <span className="font-mono font-semibold text-stone-700">
                          Review Item #{ev.id}
                        </span>
                        {ev.examSessionRef && (
                          <span>
                            {ev.examSessionRef} ({ev.examAttemptType})
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-amber-950">
                        {ev.reviewIssueExplanation ||
                          'Academic progression outcome requires Office verification before confirmation.'}
                      </p>
                      {ev.subjectsOutstanding && ev.subjectsOutstanding.length > 0 && (
                        <div className="text-[11px] text-rose-800">
                          <strong>Flagged Subjects ({ev.subjectsOutstanding.length}):</strong>{' '}
                          {ev.subjectsOutstanding
                            .map((sub) => `${sub.code} (${sub.name})`)
                            .join(', ')}
                        </div>
                      )}
                      <div className="flex justify-end pt-1">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setResolvingEventId(ev.id);
                            setResolveForm({
                              resolvedStatus:
                                s.detentionStage > 0
                                  ? s.progressionStatus
                                  : ev.subjectsOutstanding?.length
                                  ? 'PROVISIONALLY_PROMOTED_WITH_BACKLOGS'
                                  : 'REGULAR_ACTIVE',
                              proposedProfessionalYear: String(
                                ev.proposedProfessionalYear || s.currentYearOfStudy || 1
                              ),
                              proposedPlacementBatchId: ev.proposedPlacementBatchId
                                ? String(ev.proposedPlacementBatchId)
                                : s.currentPlacementBatchId
                                ? String(s.currentPlacementBatchId)
                                : '',
                              proposedDetentionStage: String(ev.proposedDetentionStage || 0),
                              outstandingBacklogsCount: String(
                                ev.subjectsOutstanding?.length || 0
                              ),
                              reason: '',
                            });
                          }}
                        >
                          Resolve Review with Documented Correction
                        </Button>
                      </div>
                    </div>
                  ))}

                  {progressionView.pendingReviewEvents.length === 0 &&
                    progressionView.isPendingOfficeReview && (
                      <p className="text-[11px] text-amber-900">
                        Progression status is marked for Office review. Verify the student&apos;s academic records before updating placement.
                      </p>
                    )}

                  {progressionView.hasPendingAdmissionConfirmation && (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-amber-900">
                      <span>
                        Admission status is currently <strong>{s.admissionStatus}</strong> and awaits confirmation.
                      </span>
                      <button
                        type="button"
                        onClick={() => setActiveTab('admission')}
                        className="font-semibold text-[#4B2E2E] hover:underline cursor-pointer"
                      >
                        Open Admission &amp; Quota &rarr;
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Conditional Unconfirmed Proposed Outcomes */}
              {progressionView.proposedEvents.length > 0 && (
                <div className="p-3.5 rounded-lg bg-[#FAF3DC]/60 border border-[#E7CD7A] space-y-2.5 text-xs">
                  <div className="font-semibold text-[#4B2E2E]">
                    Proposed Progression Outcome Awaiting Confirmation
                  </div>
                  {progressionView.proposedEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className="p-3 rounded bg-white border border-stone-200 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-stone-900">
                          {formatProgressionStatusLabel(ev.proposedStatus)}
                        </span>
                        {ev.examSessionRef && (
                          <span className="text-[11px] text-stone-500 tabular-nums">
                            {ev.examSessionRef} ({ev.examAttemptType})
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-stone-600 flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                        {ev.proposedBatchName && (
                          <span>
                            Target Cohort: <strong>{ev.proposedBatchName}</strong>
                          </span>
                        )}
                        {ev.proposedProfessionalYear && (
                          <span>
                            Prof. Year: <strong>{ev.proposedProfessionalYear}</strong>
                          </span>
                        )}
                        {ev.proposedDetentionStage > 0 && (
                          <span>
                            Detention Stage: <strong>Stage {ev.proposedDetentionStage}</strong>
                          </span>
                        )}
                      </div>
                      {ev.subjectsOutstanding && ev.subjectsOutstanding.length > 0 && (
                        <div className="text-[11px] text-rose-800">
                          <strong>Outstanding Subjects ({ev.subjectsOutstanding.length}):</strong>{' '}
                          {ev.subjectsOutstanding
                            .map((sub) => `${sub.code} (${sub.name})`)
                            .join(', ')}
                        </div>
                      )}
                      <div className="flex justify-end pt-1">
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                          isLoading={isSaving}
                          onClick={() => handleConfirmProgressionEvent(ev.id)}
                        >
                          Confirm &amp; Apply Placement
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Documented Office Review Resolution Panel */}
          {resolvingEventId && (
            <Card className="border-amber-300 bg-amber-50/30">
              <CardHeader>
                <div>
                  <CardTitle>Documented Office Review Resolution (Event #{resolvingEventId})</CardTitle>
                  <CardDescription>
                    Supersedes the flagged review item with an audited Office correction while preserving the original record in history.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleResolveReviewEvent} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    <FormField id="rv-status" label="Resolved Progression Status" required>
                      <Select
                        id="rv-status"
                        value={resolveForm.resolvedStatus}
                        onChange={(e) =>
                          setResolveForm({ ...resolveForm, resolvedStatus: e.target.value })
                        }
                      >
                        <option value="REGULAR_ACTIVE">Regular Active</option>
                        <option value="PASSED_AND_PROMOTED">Passed &amp; Promoted</option>
                        <option value="PROVISIONALLY_PROMOTED_WITH_BACKLOGS">
                          Provisionally Promoted (Backlogs)
                        </option>
                        <option value="DETAINED_ODD_BATCH">Detained · Stage 1 (Odd-Batch)</option>
                        <option value="DOUBLE_DETAINED_SPLIT_TERM">
                          Double-Detained · Stage 2 (Split-Term)
                        </option>
                        <option value="JUNIOR_TIMELINE_PLACEMENT">
                          Detained · Stage 3+ (Subsequent Junior)
                        </option>
                        <option value="ELIGIBLE_FOR_INTERNSHIP">Eligible for Internship</option>
                      </Select>
                    </FormField>
                    <FormField id="rv-prof" label="Target Prof. Year">
                      <Select
                        id="rv-prof"
                        value={resolveForm.proposedProfessionalYear}
                        onChange={(e) =>
                          setResolveForm({
                            ...resolveForm,
                            proposedProfessionalYear: e.target.value,
                          })
                        }
                      >
                        <option value="1">1st Prof. Year</option>
                        <option value="2">2nd Prof. Year</option>
                        <option value="3">3rd Prof. Year</option>
                      </Select>
                    </FormField>
                    <FormField id="rv-batch" label="Target Placement Batch">
                      <Select
                        id="rv-batch"
                        value={resolveForm.proposedPlacementBatchId}
                        onChange={(e) =>
                          setResolveForm({
                            ...resolveForm,
                            proposedPlacementBatchId: e.target.value,
                          })
                        }
                      >
                        <option value="">Keep Current Cohort</option>
                        {batches
                          .filter((b) => b.isActive)
                          .map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name} ({b.admissionAcademicYear})
                            </option>
                          ))}
                      </Select>
                    </FormField>
                    <FormField id="rv-stage" label="Detention Stage">
                      <Input
                        id="rv-stage"
                        type="number"
                        min={0}
                        max={6}
                        value={resolveForm.proposedDetentionStage}
                        onChange={(e) =>
                          setResolveForm({
                            ...resolveForm,
                            proposedDetentionStage: e.target.value,
                          })
                        }
                      />
                    </FormField>
                    <FormField id="rv-backlogs" label="Backlog Subjects">
                      <Input
                        id="rv-backlogs"
                        type="number"
                        min={0}
                        max={20}
                        value={resolveForm.outstandingBacklogsCount}
                        onChange={(e) =>
                          setResolveForm({
                            ...resolveForm,
                            outstandingBacklogsCount: e.target.value,
                          })
                        }
                      />
                    </FormField>
                  </div>
                  <FormField
                    id="rv-reason"
                    label="Mandatory Documented Office Correction Reason"
                    required
                  >
                    <Textarea
                      id="rv-reason"
                      rows={2}
                      required
                      placeholder="Cite verified RGUHS corrigendum / Principal review note..."
                      value={resolveForm.reason}
                      onChange={(e) => setResolveForm({ ...resolveForm, reason: e.target.value })}
                    />
                  </FormField>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setResolvingEventId(null)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" variant="primary" size="sm" isLoading={isSaving}>
                      Record Documented Resolution
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Concise Progression History (ONLY rendered when meaningful post-enrollment history exists) */}
          {progressionView.showProgressionHistory && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Progression History</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {progressionView.historyEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="p-3 rounded-lg border border-stone-200 bg-white space-y-1.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-stone-900">
                          {formatProgressionStatusLabel(ev.proposedStatus)}
                        </span>
                        <Badge
                          variant={ev.workflowState === 'CONFIRMED' ? 'success' : 'neutral'}
                          size="sm"
                        >
                          {ev.workflowState}
                        </Badge>
                      </div>
                      <span className="text-[11px] text-stone-500 tabular-nums">
                        {ev.examSessionRef
                          ? `${ev.examSessionRef} (${ev.examAttemptType})`
                          : ev.eventType.replace(/_/g, ' ')}
                        {ev.effectiveDate ? ` · ${ev.effectiveDate}` : ''}
                      </span>
                    </div>

                    <div className="text-[11px] text-stone-600 flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                      {ev.proposedBatchName && (
                        <span>
                          Placement: <strong>{ev.proposedBatchName}</strong>
                        </span>
                      )}
                      {ev.proposedProfessionalYear && (
                        <span>
                          Prof. Year: <strong>{ev.proposedProfessionalYear}</strong>
                        </span>
                      )}
                      {ev.proposedDetentionStage > 0 && (
                        <span>
                          Detention Stage: <strong>Stage {ev.proposedDetentionStage}</strong>
                        </span>
                      )}
                    </div>

                    {ev.classroomMapping &&
                      ev.classroomMapping.mode !== 'STANDARD_COHORT' && (
                        <div className="text-[11px] text-stone-700">
                          <strong>Routing:</strong> {ev.classroomMapping.summary}
                        </div>
                      )}

                    {ev.subjectsOutstanding && ev.subjectsOutstanding.length > 0 && (
                      <div className="text-[11px] text-rose-800">
                        <strong>Outstanding Subjects ({ev.subjectsOutstanding.length}):</strong>{' '}
                        {ev.subjectsOutstanding
                          .map((sub) => `${sub.code} (${sub.name})`)
                          .join(', ')}
                      </div>
                    )}

                    {ev.reviewIssueExplanation && (
                      <div className="text-[11px] text-amber-800">
                        Review Note: {ev.reviewIssueExplanation}
                      </div>
                    )}

                    {ev.reasonOrRemarks && (
                      <div className="text-[11px] text-stone-500">{ev.reasonOrRemarks}</div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* TAB 8: INTERNSHIP MANAGEMENT */}
      {activeTab === 'internship' && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Compulsory Rotating Internship (365 Credited Days)</CardTitle>
                <CardDescription>
                  Tracks base 365 required credited days, Principal-approved extensions, and verified Attendance/Biometric reconciliation boundary.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {profile.internship ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 text-xs tabular-nums">
                    <div className="p-3 rounded-lg bg-[#FAF9F5] border border-stone-200">
                      <span className="text-[10px] uppercase font-semibold text-stone-500 block">
                        Start Date
                      </span>
                      <span className="font-mono font-bold text-stone-900 block mt-0.5">
                        {profile.internship.startDate || 'Not Set'}
                      </span>
                      {profile.internship.expectedCompletionDate && (
                        <span className="block text-[10px] text-stone-500">
                          Exp: {profile.internship.expectedCompletionDate}
                        </span>
                      )}
                    </div>

                    <div className="p-3 rounded-lg bg-[#FAF9F5] border border-stone-200">
                      <span className="text-[10px] uppercase font-semibold text-stone-500 block">
                        Required Credited Days
                      </span>
                      <span className="font-bold text-sm text-stone-900 block mt-0.5">
                        {profile.internship.adjustedRequiredDays} days
                      </span>
                      <span className="block text-[10px] text-stone-500">
                        Base: {profile.internship.baseRequiredDays}d
                      </span>
                    </div>

                    <div className="p-3 rounded-lg bg-[#FAF9F5] border border-stone-200">
                      <span className="text-[10px] uppercase font-semibold text-stone-500 block">
                        Verified Credited Days
                      </span>
                      <span className="font-bold text-sm text-emerald-800 block mt-0.5">
                        {profile.internship.creditedDaysCompleted} days
                      </span>
                    </div>

                    <div className="p-3 rounded-lg bg-[#FAF9F5] border border-stone-200">
                      <span className="text-[10px] uppercase font-semibold text-stone-500 block">
                        Approved Extensions
                      </span>
                      <span className="font-bold text-sm text-amber-900 block mt-0.5">
                        +{profile.internship.approvedExtensionDays} days
                      </span>
                      <span className="block text-[10px] text-stone-500">
                        {profile.internship.extensions.length} approval(s)
                      </span>
                    </div>

                    <div className="p-3 rounded-lg bg-[#FAF9F5] border border-stone-200">
                      <span className="text-[10px] uppercase font-semibold text-stone-500 block">
                        Remaining Days
                      </span>
                      <span className="font-bold text-sm text-stone-900 block mt-0.5">
                        {profile.internship.remainingCreditedDays} days
                      </span>
                    </div>

                    <div className="p-3 rounded-lg bg-[#FAF9F5] border border-stone-200">
                      <span className="text-[10px] uppercase font-semibold text-stone-500 block">
                        Reconciliation Status
                      </span>
                      <span className="font-mono font-bold text-[#4B2E2E] block mt-0.5">
                        {profile.internship.attendanceReconciliationStatus}
                      </span>
                      <span className="block text-[10px] text-stone-500">
                        {profile.internship.attendanceSource}
                      </span>
                    </div>

                    <div className="p-3 rounded-lg bg-[#FAF9F5] border border-stone-200 col-span-2 sm:col-span-1">
                      <span className="text-[10px] uppercase font-semibold text-stone-500 block">
                        Completion Status
                      </span>
                      <span className="font-bold text-sm text-[#4B2E2E] block mt-0.5">
                        {profile.internship.internshipStatus}
                      </span>
                      {profile.internship.actualCompletionDate && (
                        <span className="block text-[10px] text-emerald-800">
                          {profile.internship.actualCompletionDate}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Attendance & Biometric Module Deferral Notice */}
                  <div className="p-3.5 rounded-lg bg-stone-50 border border-stone-200 text-xs text-stone-700 space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <strong className="text-stone-900">Attendance Management Module Boundary:</strong>{' '}
                        Biometric integration and daily attendance-day calculation are handled in the future <strong>Attendance Management</strong> module.
                      </span>
                      {profile.internship.lastAttendanceSyncRef && (
                        <span className="font-mono text-[11px] text-stone-500">
                          Sync Ref: {profile.internship.lastAttendanceSyncRef}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-stone-600">
                      Internship completion cannot be marked in Student Management until verified attendance reconciliation status is <code className="text-stone-800">RECONCILED</code> and verified credited days &ge; {profile.internship.adjustedRequiredDays}.
                    </p>
                  </div>
                </>
              ) : (
                <div className="p-4 rounded-lg bg-stone-50 border border-stone-200 text-xs text-stone-600">
                  No internship ledger initialized yet for this student. Initialize below once eligible.
                </div>
              )}

              {/* Start / Update Internship Schedule */}
              <form
                onSubmit={handleInitializeInternship}
                className="p-4 rounded-lg border border-stone-200 bg-white space-y-3"
              >
                <div className="text-xs font-semibold text-stone-800">
                  Initialize or Update Internship Schedule
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                  <FormField id="int-start" label="Internship Start Date">
                    <Input
                      id="int-start"
                      type="date"
                      value={internInitForm.startDate}
                      onChange={(e) =>
                        setInternInitForm({ ...internInitForm, startDate: e.target.value })
                      }
                    />
                  </FormField>
                  <FormField id="int-rem" label="Schedule Remarks">
                    <Input
                      id="int-rem"
                      value={internInitForm.remarks}
                      onChange={(e) =>
                        setInternInitForm({ ...internInitForm, remarks: e.target.value })
                      }
                    />
                  </FormField>
                  <Button type="submit" variant="primary" size="sm" isLoading={isSaving}>
                    {profile.internship ? 'Update Schedule' : 'Initialize Internship (365 Days)'}
                  </Button>
                </div>
              </form>

              {/* Principal-Only Internship Extension Control */}
              {profile.internship && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {isPrincipal ? (
                    <form
                      onSubmit={handleAddInternshipExtension}
                      className="p-4 rounded-lg border border-stone-200 bg-[#FAF9F5] space-y-3"
                    >
                      <div className="text-xs font-semibold text-[#4B2E2E]">
                        Principal Governance — Approve Internship Extension
                      </div>
                      <FormField id="ext-days" label="Additional Extension Days" required>
                        <Input
                          id="ext-days"
                          type="number"
                          min={1}
                          max={730}
                          required
                          value={internExtForm.additionalDays}
                          onChange={(e) =>
                            setInternExtForm({
                              ...internExtForm,
                              additionalDays: e.target.value,
                            })
                          }
                        />
                      </FormField>
                      <FormField id="ext-reason" label="Mandatory Official Reason" required>
                        <Textarea
                          id="ext-reason"
                          rows={2}
                          required
                          placeholder="State attendance shortfall / clinical posting extension reason..."
                          value={internExtForm.reason}
                          onChange={(e) =>
                            setInternExtForm({ ...internExtForm, reason: e.target.value })
                          }
                        />
                      </FormField>
                      <div className="flex justify-end">
                        <Button type="submit" variant="primary" size="sm" isLoading={isSaving}>
                          Approve Extension
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <div className="p-4 rounded-lg border border-stone-200 bg-stone-50 text-xs text-stone-600 flex items-center gap-2.5">
                      <Lock className="w-4 h-4 text-stone-400 shrink-0" />
                      <span>
                        Only the <strong>Principal</strong> may approve internship extensions beyond 365 credited days.
                      </span>
                    </div>
                  )}

                  {/* Mark Internship Complete (strictly blocked without verified attendance reconciliation) */}
                  {profile.internship.internshipStatus !== 'COMPLETED' && (
                    <form
                      onSubmit={handleCompleteInternship}
                      className="p-4 rounded-lg border border-stone-200 bg-white space-y-3"
                    >
                      <div className="text-xs font-semibold text-stone-800">
                        Verify &amp; Record Internship Completion
                      </div>
                      {profile.internship.attendanceReconciliationStatus !== 'RECONCILED' ||
                      profile.internship.creditedDaysCompleted <
                        profile.internship.adjustedRequiredDays ? (
                        <div className="p-2.5 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-950">
                          Completion Blocked: Requires <code className="font-semibold">RECONCILED</code> attendance status and {profile.internship.adjustedRequiredDays} verified credited days (currently {profile.internship.creditedDaysCompleted} days, status: <code className="font-semibold">{profile.internship.attendanceReconciliationStatus}</code>).
                        </div>
                      ) : null}
                      <FormField id="comp-date" label="Actual Completion Date" required>
                        <Input
                          id="comp-date"
                          type="date"
                          required
                          value={internCompleteForm.actualCompletionDate}
                          onChange={(e) =>
                            setInternCompleteForm({
                              ...internCompleteForm,
                              actualCompletionDate: e.target.value,
                            })
                          }
                        />
                      </FormField>
                      <FormField id="comp-rem" label="Completion Verification Remarks">
                        <Input
                          id="comp-rem"
                          value={internCompleteForm.remarks}
                          onChange={(e) =>
                            setInternCompleteForm({
                              ...internCompleteForm,
                              remarks: e.target.value,
                            })
                          }
                        />
                      </FormField>
                      <div className="flex justify-end">
                        <Button
                          type="submit"
                          variant="secondary"
                          size="sm"
                          isLoading={isSaving}
                          disabled={
                            profile.internship.attendanceReconciliationStatus !== 'RECONCILED' ||
                            profile.internship.creditedDaysCompleted <
                              profile.internship.adjustedRequiredDays
                          }
                        >
                          Verify Completion
                        </Button>
                      </div>
                    </form>
                  )}
                </div>
              )}

              {profile.internship && profile.internship.extensions.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-stone-800">
                    Principal-Approved Extension History
                  </div>
                  <div className="overflow-x-auto border border-stone-200 rounded-lg">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-[#FAF9F5] border-b border-stone-200 text-[11px] font-semibold uppercase text-stone-600">
                        <tr>
                          <th className="py-2 px-3">Added Days</th>
                          <th className="py-2 px-3">Adjusted Total</th>
                          <th className="py-2 px-3">Reason</th>
                          <th className="py-2 px-3">Authorized By</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-200 tabular-nums">
                        {profile.internship.extensions.map((ext) => (
                          <tr key={ext.id}>
                            <td className="py-2 px-3 font-mono font-semibold text-amber-900">
                              +{ext.additionalDays} days
                            </td>
                            <td className="py-2 px-3 font-mono">
                              {ext.previousRequiredTotal} → {ext.newRequiredTotal} days
                            </td>
                            <td className="py-2 px-3 text-stone-700">{ext.reason}</td>
                            <td className="py-2 px-3 text-stone-600">
                              {ext.authorizedBy || 'Principal'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 9: READ-ONLY FEES MANAGEMENT INTEGRATION SUMMARY */}
      {activeTab === 'fees' && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Fees Management Summary (Read-Only Live View)</CardTitle>
              <CardDescription>
                Reads directly from the shared Fees Management assessments, concessions, verified payments, and receipts linked to Student ID #{s.id}. All fee collections, concessions, and reversals remain governed inside Fees Management.
              </CardDescription>
            </div>
            {(onOpenStudentInFees || onNavigate) && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                icon={<CreditCard className="w-3.5 h-3.5" />}
                onClick={() => {
                  if (onOpenStudentInFees) {
                    onOpenStudentInFees(s.id);
                  } else if (onNavigate) {
                    onNavigate('fees_mgmt');
                  }
                }}
              >
                Open in Fees Management
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs tabular-nums">
              <div className="p-3 rounded-lg bg-[#FAF9F5] border border-stone-200">
                <span className="text-[10px] uppercase font-semibold text-stone-500 block">
                  Total Assessed
                </span>
                <span className="font-bold text-sm text-stone-900">
                  {formatInr(profile.feesSummary.totalAssessedFee)}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-[#FAF9F5] border border-stone-200">
                <span className="text-[10px] uppercase font-semibold text-stone-500 block">
                  Concessions ({profile.feesSummary.concessionsCount})
                </span>
                <span className="font-bold text-sm text-stone-800">
                  {formatInr(profile.feesSummary.concessionTotal)}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-[#FAF9F5] border border-stone-200">
                <span className="text-[10px] uppercase font-semibold text-stone-500 block">
                  Revised Payable
                </span>
                <span className="font-bold text-sm text-[#4B2E2E]">
                  {formatInr(profile.feesSummary.revisedPayable)}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-emerald-50/70 border border-emerald-200">
                <span className="text-[10px] uppercase font-semibold text-emerald-800 block">
                  Verified Paid
                </span>
                <span className="font-bold text-sm text-emerald-900">
                  {formatInr(profile.feesSummary.totalVerifiedPaid)}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-amber-50/70 border border-amber-200 col-span-2 sm:col-span-1">
                <span className="text-[10px] uppercase font-semibold text-amber-900 block">
                  Outstanding Balance
                </span>
                <span className="font-bold text-sm text-amber-950">
                  {formatInr(profile.feesSummary.outstandingBalance)}
                </span>
              </div>
            </div>

            {profile.feesSummary.pendingBankTransfersCount > 0 && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950 tabular-nums">
                <strong>{profile.feesSummary.pendingBankTransfersCount}</strong> bank transfer(s) totalling{' '}
                <strong>{formatInr(profile.feesSummary.pendingBankVerificationAmount)}</strong> are awaiting passbook verification in Fees Management.
              </div>
            )}

            <div className="overflow-x-auto border border-stone-200 rounded-lg">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#FAF9F5] border-b border-stone-200 text-[11px] font-semibold uppercase text-stone-600">
                  <tr>
                    <th className="py-2.5 px-3">Payment Ref</th>
                    <th className="py-2.5 px-3">Date &amp; Method</th>
                    <th className="py-2.5 px-3 text-right">Amount</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200 tabular-nums">
                  {profile.feesSummary.recentPayments.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-stone-500">
                        No fee payments recorded for this student yet.
                      </td>
                    </tr>
                  ) : (
                    profile.feesSummary.recentPayments.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2.5 px-3 font-mono font-medium">{p.paymentReference}</td>
                        <td className="py-2.5 px-3">
                          {p.paymentDate} · {p.paymentMethod}
                        </td>
                        <td className="py-2.5 px-3 text-right font-semibold">
                          {formatInr(p.amount)}
                        </td>
                        <td className="py-2.5 px-3">
                          <Badge
                            variant={
                              p.status === 'VERIFIED'
                                ? 'success'
                                : p.status === 'PENDING_VERIFICATION'
                                ? 'warning'
                                : 'neutral'
                            }
                            size="sm"
                          >
                            {p.status}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-stone-700">
                          {p.receiptNumber || '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* TAB 10: AUDIT HISTORY */}
      {activeTab === 'audit' && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Student Record Audit Trail</CardTitle>
              <CardDescription>
                Chronological audit log of registration, profile edits, university number verifications, progression proposals, and internship actions.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto border border-stone-200 rounded-lg">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#FAF9F5] border-b border-stone-200 text-[11px] font-semibold uppercase text-stone-600">
                  <tr>
                    <th className="py-2.5 px-3">Timestamp</th>
                    <th className="py-2.5 px-3">Action</th>
                    <th className="py-2.5 px-3">Authorized Actor</th>
                    <th className="py-2.5 px-3">Recorded Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {profile.auditHistory.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-stone-500">
                        No audit entries found.
                      </td>
                    </tr>
                  ) : (
                    profile.auditHistory.map((al) => (
                      <tr key={al.id}>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-stone-500 tabular-nums whitespace-nowrap">
                          {new Date(al.createdAt).toLocaleString('en-IN')}
                        </td>
                        <td className="py-2.5 px-3 font-mono font-semibold text-[#4B2E2E]">
                          {al.action}
                        </td>
                        <td className="py-2.5 px-3 text-stone-700">
                          {al.actorName || 'System'}
                          {al.actorRole ? ` (${al.actorRole})` : ''}
                        </td>
                        <td className="py-2.5 px-3 text-[11px] text-stone-600 font-mono break-all">
                          {al.details ? JSON.stringify(al.details) : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
