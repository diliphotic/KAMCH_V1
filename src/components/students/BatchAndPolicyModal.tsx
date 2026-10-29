import React, { useState } from 'react';
import { X, Lock, Plus, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { FormField, Input, Select, Textarea } from '../ui/FormField';
import {
  AcademicBatch,
  CurriculumScheme,
  CourseDurationSettingResponse,
  PlacementLifecycleMode,
  parseCohortPlacement,
  buildCohortStageCode,
  formatOrdinal,
  formatCohortTermOrStageLabel,
} from './studentTypes';

export interface BatchAndPolicyModalProps {
  batches: AcademicBatch[];
  schemes: CurriculumScheme[];
  courseDuration: CourseDurationSettingResponse | null;
  userRole: string;
  csrfToken: string | null;
  onClose: () => void;
  onUpdated: (message: string) => void;
}

export const BatchAndPolicyModal: React.FC<BatchAndPolicyModalProps> = ({
  batches,
  schemes,
  courseDuration,
  userRole,
  csrfToken,
  onClose,
  onUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<'batches' | 'schemes' | 'duration'>('batches');
  const canManageStructure = ['SUPER_ADMIN', 'PRINCIPAL', 'SECRETARY'].includes(userRole);
  const isPrincipal = userRole === 'PRINCIPAL';

  const defaultRs7Scheme = schemes.find((s) => s.code === 'RS7') || schemes[0];

  const [editingBatch, setEditingBatch] = useState<AcademicBatch | null>(null);
  const [batchForm, setBatchForm] = useState<{
    code: string;
    name: string;
    admissionAcademicYear: string;
    admissionYearStart: string;
    schemeId: string;
    lifecycleMode: PlacementLifecycleMode;
    currentProfessionalYear: string;
    currentTerm: string;
    preservedLegacyStage: string | null;
    juniorBatchId: string;
    admissionStatus: string;
    isActive: boolean;
    displayOrder: string;
    notes: string;
  }>({
    code: '',
    name: '',
    admissionAcademicYear: '2026-2027',
    admissionYearStart: '2026',
    schemeId: defaultRs7Scheme ? String(defaultRs7Scheme.id) : '',
    lifecycleMode: 'PROFESSIONAL_YEAR',
    currentProfessionalYear: '1',
    currentTerm: '1',
    preservedLegacyStage: null,
    juniorBatchId: '',
    admissionStatus: 'IN_PROGRESS',
    isActive: false,
    displayOrder: '80',
    notes: '',
  });
  const [showNewBatchForm, setShowNewBatchForm] = useState(false);

  const [durationForm, setDurationForm] = useState({
    maxCourseDurationYears: String(courseDuration?.maxCourseDurationYears ?? 9),
    effectiveDate: new Date().toISOString().slice(0, 10),
    reason: '',
  });

  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedScheme =
    schemes.find((s) => String(s.id) === String(batchForm.schemeId)) || defaultRs7Scheme || null;
  const maxProfYearsForScheme = Math.max(1, Number(selectedScheme?.professionalYearsCount || 3));
  const isSelectedSchemeLegacy = Boolean(
    selectedScheme?.isLegacyMinimal || selectedScheme?.code === 'RS6'
  );
  const dynamicProfYears = Array.from({ length: maxProfYearsForScheme }, (_, idx) => idx + 1);

  const openEditBatch = (b: AcademicBatch) => {
    setShowNewBatchForm(false);
    setEditingBatch(b);
    const parsed = parseCohortPlacement(b.currentCohortStage, b.currentProfessionalYear);
    setBatchForm({
      code: b.code,
      name: b.name,
      admissionAcademicYear: b.admissionAcademicYear,
      admissionYearStart: b.admissionYearStart ? String(b.admissionYearStart) : '',
      schemeId: String(b.schemeId),
      lifecycleMode: parsed.lifecycleMode,
      currentProfessionalYear:
        parsed.professionalYear !== null ? String(parsed.professionalYear) : '',
      currentTerm: parsed.termNumber !== null ? String(parsed.termNumber) : '',
      preservedLegacyStage: parsed.legacyUnmigratedStage,
      juniorBatchId: b.juniorBatchId ? String(b.juniorBatchId) : '',
      admissionStatus: b.admissionStatus,
      isActive: b.isActive,
      displayOrder: String(b.displayOrder),
      notes: b.notes || '',
    });
  };

  const handleSchemeSelectChange = (newSchemeId: string) => {
    const nextScheme = schemes.find((s) => String(s.id) === newSchemeId);
    const nextMaxYears = Math.max(1, Number(nextScheme?.professionalYearsCount || 3));
    const nextIsLegacy = Boolean(nextScheme?.isLegacyMinimal || nextScheme?.code === 'RS6');

    let nextMode = batchForm.lifecycleMode;
    let nextYear = batchForm.currentProfessionalYear;
    let nextTerm = batchForm.currentTerm;

    if (!nextIsLegacy && nextMode === 'LEGACY_COHORT') {
      nextMode = 'PROFESSIONAL_YEAR';
      nextYear = '1';
      nextTerm = '1';
    } else if (nextIsLegacy && editingBatch === null && nextMode === 'PROFESSIONAL_YEAR') {
      nextMode = 'LEGACY_COHORT';
      nextYear = '';
      nextTerm = '';
    }

    if (nextYear && Number(nextYear) > nextMaxYears) {
      nextYear = String(nextMaxYears);
    }

    setBatchForm({
      ...batchForm,
      schemeId: newSchemeId,
      lifecycleMode: nextMode,
      currentProfessionalYear: nextYear,
      currentTerm: nextTerm,
      preservedLegacyStage: null,
    });
  };

  const handlePlacementStageSelectChange = (val: string) => {
    if (val === 'ADMISSION_IN_PROGRESS') {
      setBatchForm({
        ...batchForm,
        lifecycleMode: 'ADMISSION_IN_PROGRESS',
        currentProfessionalYear: batchForm.currentProfessionalYear || '1',
        currentTerm: '',
        preservedLegacyStage: null,
      });
      return;
    }
    if (val === 'INTERNSHIP') {
      setBatchForm({
        ...batchForm,
        lifecycleMode: 'INTERNSHIP',
        currentProfessionalYear: '',
        currentTerm: '',
        preservedLegacyStage: null,
      });
      return;
    }
    if (val === 'LEGACY_COHORT') {
      setBatchForm({
        ...batchForm,
        lifecycleMode: 'LEGACY_COHORT',
        currentProfessionalYear: '',
        currentTerm: '',
        preservedLegacyStage: null,
      });
      return;
    }
    if (val.startsWith('YEAR_')) {
      const yr = val.replace('YEAR_', '');
      setBatchForm({
        ...batchForm,
        lifecycleMode: 'PROFESSIONAL_YEAR',
        currentProfessionalYear: yr,
        currentTerm: batchForm.currentTerm || '1',
        preservedLegacyStage: null,
      });
    }
  };

  const placementSelectValue =
    batchForm.lifecycleMode === 'PROFESSIONAL_YEAR'
      ? `YEAR_${batchForm.currentProfessionalYear || '1'}`
      : batchForm.lifecycleMode;

  const handleSaveBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSaving(true);
    try {
      const resolvedProfYear =
        batchForm.lifecycleMode === 'PROFESSIONAL_YEAR' ||
        batchForm.lifecycleMode === 'ADMISSION_IN_PROGRESS'
          ? batchForm.currentProfessionalYear
            ? Number(batchForm.currentProfessionalYear)
            : batchForm.lifecycleMode === 'PROFESSIONAL_YEAR'
              ? 1
              : null
          : null;

      const resolvedTerm =
        batchForm.lifecycleMode === 'PROFESSIONAL_YEAR' &&
        (batchForm.currentTerm === '1' ||
          batchForm.currentTerm === '2' ||
          batchForm.currentTerm === '3')
          ? (Number(batchForm.currentTerm) as 1 | 2 | 3)
          : null;

      const resolvedCohortStage = buildCohortStageCode({
        lifecycleMode: batchForm.lifecycleMode,
        professionalYear: resolvedProfYear,
        termNumber: resolvedTerm,
        preserveLegacyStage: batchForm.preservedLegacyStage,
      });

      const url = editingBatch
        ? `/api/students/batches/${editingBatch.id}`
        : '/api/students/batches';
      const method = editingBatch ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify({
          code: batchForm.code,
          name: batchForm.name,
          admissionAcademicYear: batchForm.admissionAcademicYear,
          admissionYearStart: batchForm.admissionYearStart
            ? Number(batchForm.admissionYearStart)
            : null,
          schemeId: Number(batchForm.schemeId),
          currentCohortStage: resolvedCohortStage,
          currentProfessionalYear: resolvedProfYear,
          juniorBatchId: batchForm.juniorBatchId ? Number(batchForm.juniorBatchId) : null,
          admissionStatus: batchForm.admissionStatus,
          isActive: batchForm.isActive,
          displayOrder: Number(batchForm.displayOrder || 100),
          notes: batchForm.notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save academic batch');
      setEditingBatch(null);
      setShowNewBatchForm(false);
      onUpdated(data.message);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveDuration = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSaving(true);
    try {
      const res = await fetch('/api/students/settings/course-duration', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify({
          maxCourseDurationYears: Number(durationForm.maxCourseDurationYears),
          effectiveDate: durationForm.effectiveDate,
          reason: durationForm.reason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update course duration setting');
      setDurationForm({ ...durationForm, reason: '' });
      onUpdated(data.message);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-stone-900/60 backdrop-blur-xs overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <Card className="w-full max-w-4xl my-auto max-h-[92vh] flex flex-col">
        <CardHeader className="shrink-0">
          <div>
            <CardTitle>Academic Batches, Curriculum Schemes &amp; Duration Policy</CardTitle>
            <CardDescription>
              Configurable institutional cohort structure, RS6/RS7 curriculum parameters, and Principal-governed maximum course duration.
            </CardDescription>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 cursor-pointer p-1"
            aria-label="Close governance modal"
          >
            <X className="w-4 h-4" />
          </button>
        </CardHeader>

        <div className="px-5 border-b border-stone-200 flex items-center gap-4 bg-[#FAF9F5] shrink-0">
          {[
            { id: 'batches', label: 'Academic Batches' },
            { id: 'schemes', label: 'Curriculum Schemes' },
            { id: 'duration', label: 'Max Course Duration (Principal)' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setActiveTab(t.id as any);
                setErrorMsg(null);
              }}
              className={`py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                activeTab === t.id
                  ? 'border-[#4B2E2E] text-[#4B2E2E]'
                  : 'border-transparent text-stone-500 hover:text-stone-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <CardContent className="overflow-y-auto space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {activeTab === 'batches' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-stone-600">
                  Original admission batch identity, curriculum scheme, current professional year, and term (Term 1–3) are maintained independently.
                </p>
                {canManageStructure && !showNewBatchForm && !editingBatch && (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    icon={<Plus className="w-3.5 h-3.5" />}
                    onClick={() => {
                      setShowNewBatchForm(true);
                      setBatchForm({
                        code: '',
                        name: '',
                        admissionAcademicYear: '2026-2027',
                        admissionYearStart: '2026',
                        schemeId: defaultRs7Scheme ? String(defaultRs7Scheme.id) : '',
                        lifecycleMode: 'PROFESSIONAL_YEAR',
                        currentProfessionalYear: '1',
                        currentTerm: '1',
                        preservedLegacyStage: null,
                        juniorBatchId: '',
                        admissionStatus: 'IN_PROGRESS',
                        isActive: false,
                        displayOrder: '80',
                        notes: '',
                      });
                    }}
                  >
                    Add Intake Batch
                  </Button>
                )}
              </div>

              {(showNewBatchForm || editingBatch) && canManageStructure && (
                <form
                  onSubmit={handleSaveBatch}
                  className="p-4 rounded-lg bg-[#FAF9F5] border border-stone-200 space-y-3"
                >
                  <div className="text-xs font-semibold text-[#4B2E2E]">
                    {editingBatch ? `Configure Batch: ${editingBatch.name}` : 'Create New Intake Batch'}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {!editingBatch && (
                      <FormField id="b-code" label="Batch Code" required>
                        <Input
                          id="b-code"
                          required
                          className="font-mono uppercase"
                          placeholder="e.g. CHARAKA"
                          value={batchForm.code}
                          onChange={(e) =>
                            setBatchForm({ ...batchForm, code: e.target.value.toUpperCase() })
                          }
                        />
                      </FormField>
                    )}
                    <FormField id="b-name" label="Official Batch Name" required>
                      <Input
                        id="b-name"
                        required
                        value={batchForm.name}
                        onChange={(e) => setBatchForm({ ...batchForm, name: e.target.value })}
                      />
                    </FormField>
                    <FormField id="b-acad-year" label="Admission Academic Year" required>
                      <Input
                        id="b-acad-year"
                        required
                        placeholder="e.g. 2026-2027"
                        value={batchForm.admissionAcademicYear}
                        onChange={(e) =>
                          setBatchForm({ ...batchForm, admissionAcademicYear: e.target.value })
                        }
                      />
                    </FormField>
                    <FormField id="b-scheme" label="Curriculum Scheme" required>
                      <Select
                        id="b-scheme"
                        value={batchForm.schemeId}
                        onChange={(e) => handleSchemeSelectChange(e.target.value)}
                      >
                        {schemes.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.code} — {s.name}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                    <FormField id="b-prof-yr" label="Current Professional Year / Lifecycle">
                      <Select
                        id="b-prof-yr"
                        value={placementSelectValue}
                        onChange={(e) => handlePlacementStageSelectChange(e.target.value)}
                      >
                        <option value="ADMISSION_IN_PROGRESS">
                          Admission in Progress (Pre-Term Placement)
                        </option>
                        {dynamicProfYears.map((yr) => (
                          <option key={yr} value={`YEAR_${yr}`}>
                            {formatOrdinal(yr)} Professional Year
                            {isSelectedSchemeLegacy ? ` (${selectedScheme?.code || 'RS6'})` : ''}
                          </option>
                        ))}
                        <option value="INTERNSHIP">Compulsory Internship (No Active Subjects)</option>
                        {isSelectedSchemeLegacy && (
                          <option value="LEGACY_COHORT">Legacy RS6 Historical Summary</option>
                        )}
                      </Select>
                    </FormField>
                    <FormField id="b-term" label="Current Term">
                      {batchForm.lifecycleMode === 'PROFESSIONAL_YEAR' ? (
                        <Select
                          id="b-term"
                          value={batchForm.currentTerm}
                          onChange={(e) =>
                            setBatchForm({
                              ...batchForm,
                              currentTerm: e.target.value,
                              preservedLegacyStage:
                                e.target.value === '' ? batchForm.preservedLegacyStage : null,
                            })
                          }
                        >
                          {batchForm.preservedLegacyStage && (
                            <option value="">
                              Term Not Set (Keep Existing Stage)
                            </option>
                          )}
                          <option value="1">Term 1</option>
                          <option value="2">Term 2</option>
                          <option value="3">Term 3</option>
                        </Select>
                      ) : (
                        <Input
                          id="b-term"
                          readOnly
                          disabled
                          value="Not Applicable for Selected Lifecycle Stage"
                          className="bg-stone-100 text-stone-500"
                        />
                      )}
                    </FormField>
                    <FormField id="b-junior" label="Immediate Junior Cohort (for Detention Routing)">
                      <Select
                        id="b-junior"
                        value={batchForm.juniorBatchId}
                        onChange={(e) =>
                          setBatchForm({ ...batchForm, juniorBatchId: e.target.value })
                        }
                      >
                        <option value="">None / Not Linked Yet</option>
                        {batches
                          .filter((item) => !editingBatch || item.id !== editingBatch.id)
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} ({item.admissionAcademicYear})
                            </option>
                          ))}
                      </Select>
                    </FormField>
                    <FormField id="b-adm-st" label="Admission Intake Status">
                      <Select
                        id="b-adm-st"
                        value={batchForm.admissionStatus}
                        onChange={(e) =>
                          setBatchForm({ ...batchForm, admissionStatus: e.target.value })
                        }
                      >
                        <option value="OPEN">Open</option>
                        <option value="IN_PROGRESS">In Progress</option>
                        <option value="COMPLETED">Completed</option>
                        <option value="CLOSED_LEGACY">Closed (Legacy)</option>
                      </Select>
                    </FormField>
                  </div>

                  <label className="flex items-center gap-2 text-xs font-medium text-stone-800 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={batchForm.isActive}
                      onChange={(e) => setBatchForm({ ...batchForm, isActive: e.target.checked })}
                      className="rounded border-stone-300 text-[#4B2E2E]"
                    />
                    <span>Active for Student Registration &amp; Academic Placement (Requires Official Batch Name)</span>
                  </label>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingBatch(null);
                        setShowNewBatchForm(false);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" variant="primary" size="sm" isLoading={isSaving}>
                      Save Batch Configuration
                    </Button>
                  </div>
                </form>
              )}

              <div className="overflow-x-auto border border-stone-200 rounded-lg">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-[#FAF9F5] border-b border-stone-200 text-[11px] font-semibold uppercase text-stone-600">
                    <tr>
                      <th className="py-2.5 px-3">Batch Name &amp; Code</th>
                      <th className="py-2.5 px-3">Academic Year &amp; Intake</th>
                      <th className="py-2.5 px-3">Scheme</th>
                      <th className="py-2.5 px-3">Current Prof. Year</th>
                      <th className="py-2.5 px-3">Current Term / Stage</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Orig / Placed</th>
                      {canManageStructure && <th className="py-2.5 px-3 text-right">Action</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {batches.map((b) => (
                      <tr key={b.id} className="hover:bg-stone-50/70">
                        <td className="py-2.5 px-3">
                          <span className="font-semibold text-stone-900 block">{b.name}</span>
                          <span className="font-mono text-[11px] text-stone-500">{b.code}</span>
                        </td>
                        <td className="py-2.5 px-3 tabular-nums">
                          <div className="font-medium text-stone-900">{b.admissionAcademicYear}</div>
                          <span className="text-[11px] text-stone-500">Start: {b.admissionYearStart || '—'}</span>
                        </td>
                        <td className="py-2.5 px-3 font-medium text-stone-800">
                          {b.schemeCode}
                        </td>
                        <td className="py-2.5 px-3 tabular-nums font-semibold text-stone-900">
                          {b.currentProfessionalYear
                            ? `${formatOrdinal(b.currentProfessionalYear)} Prof. Year`
                            : 'N/A'}
                        </td>
                        <td className="py-2.5 px-3 text-stone-700">
                          {formatCohortTermOrStageLabel(b.currentCohortStage)}
                        </td>
                        <td className="py-2.5 px-3">
                          <Badge variant={b.isActive ? 'success' : 'planned'} size="sm">
                            {b.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                          {b.originalStudentCount} / {b.currentPlacementCount}
                        </td>
                        {canManageStructure && (
                          <td className="py-2.5 px-3 text-right">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openEditBatch(b)}
                            >
                              Configure
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'schemes' && (
            <div className="space-y-3">
              {schemes.map((sc) => (
                <div
                  key={sc.id}
                  className="p-4 rounded-lg border border-stone-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm text-[#4B2E2E]">{sc.code}</span>
                      <span className="font-semibold text-xs text-stone-900">{sc.name}</span>
                      <Badge variant={sc.passingCriteriaVerified ? 'success' : 'gold'} size="sm">
                        {sc.isLegacyMinimal
                          ? 'Legacy Minimal Mode'
                          : sc.passingCriteriaVerified
                          ? 'Verified Progression Rules'
                          : 'Manual Review Mode'}
                      </Badge>
                    </div>
                    <p className="text-xs text-stone-600">{sc.notes}</p>
                    {!sc.isLegacyMinimal && (
                      <div className="text-[11px] text-stone-500 tabular-nums">
                        Professional Years: {sc.professionalYearsCount} · Max Failed Subjects for Provisional Promotion: {sc.regularPassMaxFailedForProvisional} · Supplementary Cycle: {sc.supplementaryCycleMonths} months · Internship: {sc.defaultInternshipDays} credited days
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'duration' && courseDuration && (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-[#FAF9F5] border border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-stone-500">
                    Active Maximum Course Duration Setting
                  </div>
                  <div className="text-xl font-bold text-[#4B2E2E] tabular-nums mt-0.5">
                    {courseDuration.maxCourseDurationYears} Years from Admission
                  </div>
                  <div className="text-xs text-stone-600 mt-0.5 tabular-nums">
                    Effective Date: {courseDuration.effectiveDate}
                    {courseDuration.updatedBy ? ` · Last Authorized by: ${courseDuration.updatedBy}` : ''}
                  </div>
                </div>
                <Badge variant="institutional" size="sm">
                  Review Flag Only · Never Auto-Expels
                </Badge>
              </div>

              {isPrincipal ? (
                <form
                  onSubmit={handleSaveDuration}
                  className="p-4 rounded-lg border border-stone-200 bg-white space-y-3"
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#4B2E2E]">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                    <span>Principal Governance Control — Update Maximum Course Duration</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormField id="dur-years" label="Maximum Course Duration (Years)" required>
                      <Input
                        id="dur-years"
                        type="number"
                        min={4}
                        max={20}
                        required
                        value={durationForm.maxCourseDurationYears}
                        onChange={(e) =>
                          setDurationForm({
                            ...durationForm,
                            maxCourseDurationYears: e.target.value,
                          })
                        }
                      />
                    </FormField>
                    <FormField id="dur-eff" label="Effective Date" required>
                      <Input
                        id="dur-eff"
                        type="date"
                        required
                        value={durationForm.effectiveDate}
                        onChange={(e) =>
                          setDurationForm({ ...durationForm, effectiveDate: e.target.value })
                        }
                      />
                    </FormField>
                  </div>
                  <FormField
                    id="dur-reason"
                    label="Official University / Regulatory Circular Reason"
                    required
                  >
                    <Textarea
                      id="dur-reason"
                      rows={2}
                      required
                      placeholder="Cite official NCISM / RGUHS notification or Principal authorization note..."
                      value={durationForm.reason}
                      onChange={(e) =>
                        setDurationForm({ ...durationForm, reason: e.target.value })
                      }
                    />
                  </FormField>
                  <div className="flex justify-end">
                    <Button type="submit" variant="primary" size="sm" isLoading={isSaving}>
                      Authorize Duration Policy Update
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="p-3.5 rounded-lg bg-stone-50 border border-stone-200 text-xs text-stone-700 flex items-center gap-2.5">
                  <Lock className="w-4 h-4 text-stone-500 shrink-0" />
                  <span>
                    Read-only policy view: Only the <strong>Principal</strong> account is authorized to modify the maximum course duration setting.
                  </span>
                </div>
              )}

              {courseDuration.history.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-stone-800">
                    Policy Change Audit History
                  </div>
                  <div className="overflow-x-auto border border-stone-200 rounded-lg">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-[#FAF9F5] border-b border-stone-200 text-[11px] font-semibold uppercase text-stone-600">
                        <tr>
                          <th className="py-2 px-3">Changed</th>
                          <th className="py-2 px-3">Effective Date</th>
                          <th className="py-2 px-3">Reason</th>
                          <th className="py-2 px-3">Authorized By</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-200">
                        {courseDuration.history.map((h) => (
                          <tr key={h.id}>
                            <td className="py-2 px-3 font-mono tabular-nums font-semibold">
                              {h.previousValue} yrs → {h.newValue} yrs
                            </td>
                            <td className="py-2 px-3 tabular-nums">{h.effectiveDate}</td>
                            <td className="py-2 px-3 text-stone-700">{h.reason}</td>
                            <td className="py-2 px-3 text-stone-600">{h.authorizedBy || 'Principal'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
