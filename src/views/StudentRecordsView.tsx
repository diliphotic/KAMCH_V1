import React, { useState, useEffect, useCallback } from 'react';
import {
  GraduationCap,
  UserPlus,
  Search,
  RefreshCw,
  Upload,
  Download,
  SlidersHorizontal,
  X,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Clock,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { isOfficeMemberRole } from '../config/permissions';
import { NavigationItemKey } from '../types';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import {
  AcademicBatch,
  CurriculumScheme,
  StudentListItem,
  CourseDurationSettingResponse,
  RegistryDiagnosticsResponse,
  formatQuotaLabel,
  formatCohortStageLabel,
  formatProgressionStatusLabel,
} from '../components/students/studentTypes';
import { StudentRegisterModal } from '../components/students/StudentRegisterModal';
import { StudentCsvImportModal } from '../components/students/StudentCsvImportModal';
import { BatchAndPolicyModal } from '../components/students/BatchAndPolicyModal';
import { StudentProfileWorkspace } from '../components/students/StudentProfileWorkspace';

export interface StudentRecordsViewProps {
  onNavigate?: (tab: NavigationItemKey) => void;
  autoOpenRegisterForFees?: boolean;
  onRegisteredForFees?: (studentId: number) => void;
  onCancelForFees?: () => void;
  initialSelectedStudentId?: number | null;
  onClearInitialSelectedStudent?: () => void;
  onOpenStudentInFees?: (studentId: number) => void;
}

export const StudentRecordsView: React.FC<StudentRecordsViewProps> = ({
  onNavigate,
  autoOpenRegisterForFees = false,
  onRegisteredForFees,
  onCancelForFees,
  initialSelectedStudentId,
  onClearInitialSelectedStudent,
  onOpenStudentInFees,
}) => {
  const { user, csrfToken } = useAuth();
  const isOffice = isOfficeMemberRole(user?.role);

  const [batches, setBatches] = useState<AcademicBatch[]>([]);
  const [schemes, setSchemes] = useState<CurriculumScheme[]>([]);
  const [courseDuration, setCourseDuration] = useState<CourseDurationSettingResponse | null>(null);
  const [diagnostics, setDiagnostics] = useState<RegistryDiagnosticsResponse | null>(null);
  const [showDiagnosticsDetails, setShowDiagnosticsDetails] = useState(false);
  const [students, setStudents] = useState<StudentListItem[]>([]);

  // Batch & multi-criteria filters
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [batchScope, setBatchScope] = useState<
    'BOTH' | 'ORIGINAL' | 'CURRENT' | 'DETAINED_IN' | 'DETAINED_OUT'
  >('BOTH');
  const [searchQuery, setSearchQuery] = useState('');
  const [quotaFilter, setQuotaFilter] = useState('');
  const [adminStatusFilter, setAdminStatusFilter] = useState('');
  const [progressionFilter, setProgressionFilter] = useState('');
  const [univRegFilter, setUnivRegFilter] = useState('');
  const [durationFlagOnly, setDurationFlagOnly] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  // Modals & active profile state
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [isCsvImportOpen, setIsCsvImportOpen] = useState(false);
  const [isBatchPolicyOpen, setIsBatchPolicyOpen] = useState(false);
  const [activeStudentId, setActiveStudentId] = useState<number | null>(null);

  useEffect(() => {
    if (autoOpenRegisterForFees) {
      setIsRegisterModalOpen(true);
    }
  }, [autoOpenRegisterForFees]);

  useEffect(() => {
    if (initialSelectedStudentId) {
      setActiveStudentId(initialSelectedStudentId);
      onClearInitialSelectedStudent?.();
    }
  }, [initialSelectedStudentId, onClearInitialSelectedStudent]);

  const fetchMetadata = useCallback(async () => {
    try {
      const [bRes, sRes, dRes, diagRes] = await Promise.all([
        fetch('/api/students/batches'),
        fetch('/api/students/schemes'),
        fetch('/api/students/settings/course-duration'),
        fetch('/api/students/registry-diagnostics'),
      ]);
      if (bRes.ok) {
        const bData = await bRes.json();
        setBatches(bData.batches || []);
      }
      if (sRes.ok) {
        const sData = await sRes.json();
        setSchemes(sData.schemes || []);
      }
      if (dRes.ok) {
        const dData = await dRes.json();
        setCourseDuration(dData);
      }
      if (diagRes.ok) {
        const diagData = await diagRes.json();
        setDiagnostics(diagData);
      }
    } catch {
      // Ignore metadata refresh hiccup
    }
  }, []);

  const buildFilterQueryParams = useCallback(() => {
    const params = new URLSearchParams();
    if (selectedBatchId) {
      params.append('batchId', String(selectedBatchId));
      params.append('batchScope', batchScope);
    }
    if (searchQuery.trim()) params.append('search', searchQuery.trim());
    if (quotaFilter) params.append('quota', quotaFilter);
    if (adminStatusFilter) params.append('administrativeStatus', adminStatusFilter);
    if (progressionFilter) params.append('progressionStatus', progressionFilter);
    if (univRegFilter) params.append('universityRegStatus', univRegFilter);
    if (durationFlagOnly) params.append('courseDurationExceeded', 'true');
    return params;
  }, [
    selectedBatchId,
    batchScope,
    searchQuery,
    quotaFilter,
    adminStatusFilter,
    progressionFilter,
    univRegFilter,
    durationFlagOnly,
  ]);

  const fetchStudents = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = buildFilterQueryParams();
      const res = await fetch(`/api/students?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setStudents(data.students || []);
      }
    } catch {
      // Ignore transient network hiccup
    } finally {
      setIsLoading(false);
    }
  }, [buildFilterQueryParams]);

  useEffect(() => {
    fetchMetadata();
  }, [fetchMetadata]);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  const handleExportCsv = async () => {
    try {
      const params = buildFilterQueryParams();
      const res = await fetch(`/api/students/export/csv?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to export student registry CSV');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kamch_students_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setNotice({ type: 'error', message: (err as Error).message });
    }
  };

  if (activeStudentId !== null) {
    return (
      <StudentProfileWorkspace
        studentId={activeStudentId}
        batches={batches}
        userRole={user?.role || ''}
        isOfficeRole={isOffice}
        csrfToken={csrfToken}
        onBack={() => {
          setActiveStudentId(null);
          fetchMetadata();
          fetchStudents();
        }}
        onNavigate={onNavigate}
        onOpenStudentInFees={onOpenStudentInFees}
        onGlobalNotice={(n) => setNotice(n)}
      />
    );
  }

  return (
    <div className="space-y-5">
      {notice && (
        <div
          className={`p-3.5 rounded-lg text-xs flex items-start justify-between gap-3 ${
            notice.type === 'success'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border border-rose-200 text-rose-900'
          }`}
          role="alert"
        >
          <div className="flex items-start gap-2">
            {notice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            )}
            <span className="font-medium">{notice.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-stone-400 hover:text-stone-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <PageHeader
        title="Student Management"
        description="Central institutional student registry across RS6 legacy and RS7 BAMS cohorts — integrated with Fees Management, roll sequences, academic progression, and compulsory internship."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              icon={<SlidersHorizontal className="w-3.5 h-3.5" />}
              onClick={() => setIsBatchPolicyOpen(true)}
            >
              Batches &amp; Duration Policy
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              icon={<Download className="w-3.5 h-3.5" />}
              onClick={handleExportCsv}
            >
              Export CSV
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<Upload className="w-3.5 h-3.5" />}
              onClick={() => setIsCsvImportOpen(true)}
            >
              Import CSV
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              icon={<UserPlus className="w-3.5 h-3.5" />}
              onClick={() => setIsRegisterModalOpen(true)}
            >
              Register Student
            </Button>
          </div>
        }
      />

      {/* Read-Only Registry Data Verification Report (Duplicates & Unverified Admission Dates) */}
      {diagnostics &&
        (diagnostics.potentialDuplicatesCount > 0 || diagnostics.admissionDateIssuesCount > 0) && (
          <Card className="border-amber-300 bg-amber-50/40">
            <CardContent className="p-3.5 space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold text-amber-950">
                  <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>
                    Registry Verification Report (Read-Only):{' '}
                    {diagnostics.potentialDuplicatesCount} potential duplicate pair(s),{' '}
                    {diagnostics.admissionDateIssuesCount} record(s) requiring admission-date verification
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDiagnosticsDetails((prev) => !prev)}
                >
                  {showDiagnosticsDetails ? 'Hide Report' : 'Review Flagged Records'}
                </Button>
              </div>
              {showDiagnosticsDetails && (
                <div className="space-y-3 pt-2 border-t border-amber-200/80 text-[11px] text-stone-800">
                  <p className="text-amber-900">{diagnostics.note}</p>

                  {diagnostics.potentialDuplicates.length > 0 && (
                    <div className="space-y-1">
                      <div className="font-semibold text-stone-900">
                        Potential Duplicate Student Records ({diagnostics.potentialDuplicatesCount}):
                      </div>
                      <ul className="space-y-1">
                        {diagnostics.potentialDuplicates.map((dup, idx) => (
                          <li
                            key={idx}
                            className="p-2 rounded bg-white border border-amber-200 flex flex-wrap items-center justify-between gap-2"
                          >
                            <span>
                              <strong className="font-mono">{dup.studentAIdNumber}</strong> ({dup.studentAName}) &harr;{' '}
                              <strong className="font-mono">{dup.studentBIdNumber}</strong> ({dup.studentBName}) —{' '}
                              <span className="text-amber-900">{dup.reasons.join('; ')}</span>
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setActiveStudentId(dup.studentAId)}
                                className="text-[#4B2E2E] font-semibold hover:underline cursor-pointer"
                              >
                                Inspect #{dup.studentAId}
                              </button>
                              <span className="text-stone-300">|</span>
                              <button
                                type="button"
                                onClick={() => setActiveStudentId(dup.studentBId)}
                                className="text-[#4B2E2E] font-semibold hover:underline cursor-pointer"
                              >
                                Inspect #{dup.studentBId}
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {diagnostics.admissionDateIssues.length > 0 && (
                    <div className="space-y-1">
                      <div className="font-semibold text-stone-900">
                        Records Requiring Official Admission Date Verification ({diagnostics.admissionDateIssuesCount}):
                      </div>
                      <ul className="space-y-1">
                        {diagnostics.admissionDateIssues.map((iss) => (
                          <li
                            key={iss.studentId}
                            className="p-2 rounded bg-white border border-amber-200 flex flex-wrap items-center justify-between gap-2"
                          >
                            <span>
                              <strong className="font-mono">{iss.studentIdNumber}</strong> — {iss.fullName} (Intake {iss.admissionYear}):{' '}
                              <span className="text-amber-900">{iss.verificationNote}</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => setActiveStudentId(iss.studentId)}
                              className="text-[#4B2E2E] font-semibold hover:underline cursor-pointer"
                            >
                              Verify in Profile &rarr;
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

      {/* Batch-Wise Cohort Selector Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
        <button
          type="button"
          onClick={() => setSelectedBatchId(null)}
          className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
            selectedBatchId === null
              ? 'bg-[#4B2E2E] text-[#F5F5DC] border-[#3A2222] shadow-xs'
              : 'bg-white text-stone-800 border-stone-200 hover:border-stone-300'
          }`}
        >
          <span
            className={`text-[10px] uppercase tracking-wider font-semibold block ${
              selectedBatchId === null ? 'text-[#D4AF37]' : 'text-stone-500'
            }`}
          >
            All Cohorts
          </span>
          <span className="font-serif font-bold text-sm block mt-0.5">Complete Registry</span>
          <span
            className={`text-[11px] font-mono tabular-nums block mt-1 ${
              selectedBatchId === null ? 'text-[#F5F5DC]/90' : 'text-stone-500'
            }`}
          >
            Max Duration: {courseDuration?.maxCourseDurationYears ?? 9} yrs
          </span>
        </button>

        {batches.map((b) => {
          const isSelected = selectedBatchId === b.id;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => setSelectedBatchId(b.id)}
              className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                isSelected
                  ? 'bg-[#4B2E2E] text-[#F5F5DC] border-[#3A2222] shadow-xs'
                  : b.isActive
                  ? 'bg-white text-stone-800 border-stone-200 hover:border-stone-300'
                  : 'bg-stone-50 text-stone-500 border-dashed border-stone-300 hover:border-stone-400'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span
                  className={`text-[10px] font-mono font-semibold truncate ${
                    isSelected ? 'text-[#D4AF37]' : 'text-stone-500'
                  }`}
                >
                  {b.admissionAcademicYear}
                </span>
                <span
                  className={`text-[10px] font-mono ${
                    isSelected ? 'text-[#F5F5DC]/80' : 'text-stone-400'
                  }`}
                >
                  {b.schemeCode}
                </span>
              </div>
              <span className="font-serif font-bold text-xs sm:text-sm block truncate mt-0.5">
                {b.name}
              </span>
              <span
                className={`text-[10px] block truncate ${
                  isSelected ? 'text-[#F5F5DC]/85' : 'text-stone-500'
                }`}
              >
                {b.isActive ? formatCohortStageLabel(b.currentCohortStage) : 'Inactive · Name Pending'}
              </span>
              <div
                className={`text-[10px] font-mono tabular-nums mt-1 flex items-center justify-between ${
                  isSelected ? 'text-[#D4AF37]' : 'text-stone-600'
                }`}
              >
                <span>Orig: {b.originalStudentCount}</span>
                <span>Placed: {b.currentPlacementCount}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Multi-Criteria Search & Filter Bar */}
      <Card>
        <CardContent className="p-3.5 space-y-3">
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                type="text"
                placeholder="Search by name, active ID, former temporary roll (KAMCH-...), RGUHS no., NEET, phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:border-[#4B2E2E] min-h-[38px]"
              />
            </div>

            {selectedBatchId !== null && (
              <select
                value={batchScope}
                onChange={(e) => setBatchScope(e.target.value as any)}
                aria-label="Batch Relationship Filter"
                className="py-2 px-3 text-xs bg-[#FAF3DC]/50 border border-[#E7CD7A] rounded-lg text-[#4B2E2E] font-semibold min-h-[38px]"
              >
                <option value="BOTH">Original + Placed in Cohort</option>
                <option value="ORIGINAL">Original Admission Cohort Only</option>
                <option value="CURRENT">Currently Placed Here Only</option>
                <option value="DETAINED_IN">Detained Students Placed Into This Batch</option>
                <option value="DETAINED_OUT">Original Members Placed in Junior Cohort</option>
              </select>
            )}

            <select
              value={quotaFilter}
              onChange={(e) => setQuotaFilter(e.target.value)}
              className="py-2 px-3 text-xs bg-white border border-stone-300 rounded-lg text-stone-700 min-h-[38px]"
            >
              <option value="">All Admission Quotas</option>
              <option value="GOVERNMENT">Government Quota</option>
              <option value="MANAGEMENT_PRIVATE">Private / Management</option>
              <option value="NRI">NRI Quota</option>
            </select>

            <select
              value={progressionFilter}
              onChange={(e) => setProgressionFilter(e.target.value)}
              className="py-2 px-3 text-xs bg-white border border-stone-300 rounded-lg text-stone-700 min-h-[38px]"
            >
              <option value="">All Progression States</option>
              <option value="REGULAR_ACTIVE">Regular Active</option>
              <option value="PASSED_AND_PROMOTED">Passed &amp; Promoted</option>
              <option value="PROVISIONALLY_PROMOTED_WITH_BACKLOGS">Provisional (Backlogs)</option>
              <option value="DETAINED_ODD_BATCH">Detained · Stage 1 (Odd-Batch)</option>
              <option value="DOUBLE_DETAINED_SPLIT_TERM">Detained · Stage 2 (Split-Term)</option>
              <option value="JUNIOR_TIMELINE_PLACEMENT">Detained · Stage 3+ (Junior)</option>
              <option value="ELIGIBLE_FOR_INTERNSHIP">Eligible for Internship</option>
              <option value="PENDING_OFFICE_REVIEW">Pending Office Review</option>
            </select>

            <select
              value={adminStatusFilter}
              onChange={(e) => setAdminStatusFilter(e.target.value)}
              className="py-2 px-3 text-xs bg-white border border-stone-300 rounded-lg text-stone-700 min-h-[38px]"
            >
              <option value="">All Admin Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="ADMISSION_PENDING">Admission Pending</option>
              <option value="COMPLETED">Completed</option>
              <option value="DISCONTINUED">Discontinued</option>
              <option value="CANCELLED">Cancelled</option>
            </select>

            <button
              type="button"
              onClick={() => {
                fetchMetadata();
                fetchStudents();
              }}
              title="Refresh student registry"
              className="min-h-[38px] min-w-[38px] flex items-center justify-center p-2 border border-stone-300 rounded-lg hover:bg-stone-100 text-stone-600 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-stone-600 pt-1 border-t border-stone-100">
            <div className="flex flex-wrap items-center gap-4">
              <select
                value={univRegFilter}
                onChange={(e) => setUnivRegFilter(e.target.value)}
                className="py-1 px-2 text-[11px] bg-stone-50 border border-stone-200 rounded text-stone-700"
              >
                <option value="">All RGUHS Reg. States</option>
                <option value="NOT_ENTERED">RGUHS Not Entered</option>
                <option value="PENDING_VERIFICATION">RGUHS Pending Verification</option>
                <option value="VERIFIED">RGUHS Verified</option>
              </select>

              <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={durationFlagOnly}
                  onChange={(e) => setDurationFlagOnly(e.target.checked)}
                  className="rounded border-stone-300 text-[#4B2E2E]"
                />
                <span>Max Course Duration Flagged Only</span>
              </label>
            </div>

            <span className="font-mono tabular-nums text-stone-500">
              Showing <strong className="text-stone-900">{students.length}</strong> student record(s)
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Student Registry Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#FAF9F5] border-b border-stone-200 text-stone-700 font-semibold text-[11px] uppercase tracking-wider">
                <th className="py-3 px-4">Student Identity &amp; Roll No.</th>
                <th className="py-3 px-4">Batch &amp; Cohort Relationship</th>
                <th className="py-3 px-4">Quota &amp; Seat Category</th>
                <th className="py-3 px-4">Academic Progression</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Profile</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-stone-500">
                    Loading institutional student registry...
                  </td>
                </tr>
              ) : students.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-stone-500">
                    <GraduationCap className="w-6 h-6 mx-auto mb-2 text-stone-400" />
                    No student records match the selected cohort or filter criteria.
                  </td>
                </tr>
              ) : (
                students.map((st) => (
                  <tr
                    key={st.id}
                    onClick={() => setActiveStudentId(st.id)}
                    className="hover:bg-stone-50/90 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4">
                      <span className="font-semibold text-stone-900 block">{st.fullName}</span>
                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5 tabular-nums">
                        <span className="font-mono text-[11px] font-semibold text-[#4B2E2E]">
                          {st.studentIdNumber}
                        </span>
                        {st.universityRegStatus === 'VERIFIED' ? (
                          <span className="text-[10px] text-emerald-700 font-medium">
                            (RGUHS Verified · Temp: {st.temporaryRollNumber})
                          </span>
                        ) : st.universityRegStatus === 'PENDING_VERIFICATION' ? (
                          <span className="text-[10px] text-amber-800 font-medium">
                            (RGUHS Pending: {st.permanentUniversityNumber})
                          </span>
                        ) : (
                          <span className="text-[10px] text-stone-400">(Temp Roll)</span>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-medium text-stone-800">
                        {st.currentPlacementBatchName || st.originalBatchName || `Intake ${st.admissionYear}`}
                        <span className="text-stone-400 font-normal ml-1.5">
                          ({st.schemeCode || 'RS7'})
                        </span>
                      </div>
                      <span
                        className={`text-[11px] block mt-0.5 ${
                          st.batchRelationship === 'PLACED_HERE_FROM_SENIOR' ||
                          st.batchRelationship === 'ORIGINAL_PLACED_IN_JUNIOR'
                            ? 'text-amber-900 font-medium'
                            : 'text-stone-500'
                        }`}
                      >
                        {st.batchRelationshipLabel}
                      </span>
                    </td>

                    <td className="py-3 px-4">
                      <span className="font-medium text-stone-800 block">
                        {formatQuotaLabel(st.admissionQuota)}
                      </span>
                      <span className="text-[11px] text-stone-500">
                        {st.seatCategory ? `Seat: ${st.seatCategory}` : `Adm: ${st.admissionStatus}`}
                      </span>
                    </td>

                    <td className="py-3 px-4">
                      {st.isLegacyMinimal ? (
                        <div>
                          <span className="text-stone-700 font-medium block">Legacy RS6 Record</span>
                          <span className="text-[11px] text-stone-500">
                            Internship: {st.rs6InternshipCompleted ? 'Completed' : 'Pending / Not Recorded'}
                          </span>
                        </div>
                      ) : (
                        <div>
                          <span className="font-medium text-stone-800 block">
                            Prof. Year {st.currentYearOfStudy} ·{' '}
                            {formatProgressionStatusLabel(st.progressionStatus)}
                          </span>
                          {st.classroomMapping?.mode === 'SPLIT_TERM' && (
                            <span className="text-[10px] text-[#7A5B0B] font-medium block mt-0.5">
                              Split-Term: T1 {st.classroomMapping.term1.batchName} · T2/T3{' '}
                              {st.classroomMapping.term2.batchName}
                            </span>
                          )}
                          {st.outstandingBacklogsCount > 0 && (
                            <span className="text-[10px] text-rose-700 block tabular-nums">
                              {st.outstandingBacklogsCount} unresolved backlog subject(s)
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <div className="flex flex-col items-start gap-1">
                        <Badge
                          variant={
                            st.administrativeStatus === 'ACTIVE'
                              ? 'success'
                              : st.administrativeStatus === 'COMPLETED'
                              ? 'gold'
                              : 'warning'
                          }
                          size="sm"
                        >
                          {st.administrativeStatus}
                        </Badge>
                        {!st.isLegacyMinimal && st.admissionDateRequiresVerification ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800">
                            <AlertCircle className="w-3 h-3" />
                            Admission date requires verification
                          </span>
                        ) : st.courseDurationFlag ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-700">
                            <Clock className="w-3 h-3" />
                            Duration Review
                          </span>
                        ) : null}
                      </div>
                    </td>

                    <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        icon={<ArrowRight className="w-3 h-3" />}
                        iconPosition="right"
                        onClick={() => setActiveStudentId(st.id)}
                      >
                        Open Profile
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {isRegisterModalOpen && (
        <StudentRegisterModal
          batches={batches}
          defaultBatchId={selectedBatchId}
          csrfToken={csrfToken}
          returnToFeesMode={autoOpenRegisterForFees}
          onClose={() => {
            setIsRegisterModalOpen(false);
            if (autoOpenRegisterForFees && onCancelForFees) {
              onCancelForFees();
            }
          }}
          onRegistered={(msg, createdStudent) => {
            setIsRegisterModalOpen(false);
            if (autoOpenRegisterForFees && createdStudent?.id && onRegisteredForFees) {
              onRegisteredForFees(createdStudent.id);
              return;
            }
            setNotice({ type: 'success', message: msg });
            fetchMetadata();
            fetchStudents();
          }}
        />
      )}

      {isCsvImportOpen && (
        <StudentCsvImportModal
          batches={batches}
          defaultBatchId={selectedBatchId}
          csrfToken={csrfToken}
          onClose={() => setIsCsvImportOpen(false)}
          onImported={(msg) => {
            setIsCsvImportOpen(false);
            setNotice({ type: 'success', message: msg });
            fetchMetadata();
            fetchStudents();
          }}
        />
      )}

      {isBatchPolicyOpen && (
        <BatchAndPolicyModal
          batches={batches}
          schemes={schemes}
          courseDuration={courseDuration}
          userRole={user?.role || ''}
          csrfToken={csrfToken}
          onClose={() => setIsBatchPolicyOpen(false)}
          onUpdated={(msg) => {
            setNotice({ type: 'success', message: msg });
            fetchMetadata();
            fetchStudents();
          }}
        />
      )}
    </div>
  );
};
