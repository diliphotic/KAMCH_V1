import React, { useState, useMemo } from 'react';
import { X, AlertTriangle, ShieldCheck } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { FormField, Input, Select, Textarea } from '../ui/FormField';
import { AcademicBatch, formatCohortStageLabel } from './studentTypes';

export interface StudentRegisterModalProps {
  batches: AcademicBatch[];
  defaultBatchId: number | null;
  csrfToken: string | null;
  returnToFeesMode?: boolean;
  onClose: () => void;
  onRegistered: (
    message: string,
    student?: { id: number; studentIdNumber: string; fullName: string }
  ) => void;
}

export const StudentRegisterModal: React.FC<StudentRegisterModalProps> = ({
  batches,
  defaultBatchId,
  csrfToken,
  returnToFeesMode = false,
  onClose,
  onRegistered,
}) => {
  const activeBatches = useMemo(() => batches.filter((b) => b.isActive), [batches]);
  const initialBatchId = useMemo(() => {
    if (defaultBatchId && activeBatches.some((b) => b.id === defaultBatchId)) {
      return String(defaultBatchId);
    }
    const vedang = activeBatches.find((b) => b.code === 'VEDANG');
    return vedang ? String(vedang.id) : activeBatches[0] ? String(activeBatches[0].id) : '';
  }, [defaultBatchId, activeBatches]);

  const [form, setForm] = useState({
    originalBatchId: initialBatchId,
    fullName: '',
    universityRecordedName: '',
    dateOfBirth: '',
    gender: '',
    nationality: 'Indian',
    contactPhone: '',
    contactEmail: '',
    fatherName: '',
    fatherPhone: '',
    motherName: '',
    motherPhone: '',
    emergencyContactName: '',
    emergencyContactRelationship: '',
    emergencyContactPhone: '',
    admissionDate: '',
    admissionQuota: 'GOVERNMENT' as 'GOVERNMENT' | 'MANAGEMENT_PRIVATE' | 'NRI',
    seatCategory: '',
    reservationDetails: '',
    neetRollNumber: '',
    neetScore: '',
    keaAcknowledgementNo: '',
    qualifyingExam: 'PUC II / 10+2 PCB',
    qualifyingBoard: '',
    qualifyingYear: '',
    qualifyingMarksPercentage: '',
    admissionOrderRef: '',
    admissionStatus: 'PROVISIONAL',
    permanentAddress: '',
    state: 'Karnataka',
    district: '',
    cityTown: '',
    pinCode: '',
    permanentUniversityNumber: '',
    verifyUniversityNumberNow: false,
    rs6InternshipCompleted: false,
    rs6AcademicSummary: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{
    message: string;
    candidates: Array<{ studentIdNumber: string; fullName: string; reason: string }>;
  } | null>(null);
  const [duplicateOverrideReason, setDuplicateOverrideReason] = useState('');

  const selectedBatch = useMemo(
    () => batches.find((b) => String(b.id) === form.originalBatchId) || null,
    [batches, form.originalBatchId]
  );

  const isLegacyRs6 = Boolean(selectedBatch?.isLegacyMinimal);

  const handleSubmit = async (e: React.FormEvent, allowDuplicateOverride = false) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);

    try {
      const payload: Record<string, any> = {
        ...form,
        originalBatchId: form.originalBatchId ? Number(form.originalBatchId) : null,
        admissionYear: selectedBatch?.admissionYearStart || new Date().getFullYear(),
        admissionAcademicYear: selectedBatch?.admissionAcademicYear || null,
        currentYearOfStudy: selectedBatch?.currentProfessionalYear || 1,
      };

      if (allowDuplicateOverride) {
        payload.allowDuplicateOverride = true;
        payload.duplicateOverrideReason = duplicateOverrideReason;
      }

      const res = await fetch('/api/students', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && data.code === 'POTENTIAL_DUPLICATE_STUDENT') {
          setDuplicateWarning({
            message: data.error,
            candidates: data.duplicateCandidates || [],
          });
          return;
        }
        throw new Error(data.error || 'Failed to register student record');
      }

      onRegistered(data.message, data.student);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-stone-900/60 backdrop-blur-xs overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="register-student-title"
    >
      <Card className="w-full max-w-3xl my-auto max-h-[92vh] flex flex-col">
        <CardHeader className="shrink-0">
          <div>
            <CardTitle id="register-student-title">Register Institutional Student Record</CardTitle>
            <CardDescription>
              Generates a unique server-side temporary roll number (KAMCH-YYYY-NNNN) and links directly with Fees Management. No student login account is created.
            </CardDescription>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 cursor-pointer p-1"
            aria-label="Close registration modal"
          >
            <X className="w-4 h-4" />
          </button>
        </CardHeader>

        <CardContent className="overflow-y-auto space-y-5">
          {returnToFeesMode && (
            <div className="p-3 rounded-lg bg-[#FAF3DC]/70 border border-[#E7CD7A] text-[#4B2E2E] text-xs">
              <strong>Fees Management Handoff:</strong> Student Management is the single institutional registry. Completing this registration will automatically return you to Fees Management with this student&apos;s fee account open.
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {duplicateWarning && (
            <div className="p-4 rounded-lg bg-amber-50 border border-amber-300 text-amber-950 text-xs space-y-3">
              <div className="flex items-start gap-2 font-semibold">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <span>Potential Duplicate Student Record Detected</span>
              </div>
              <ul className="list-disc pl-5 space-y-1 text-amber-900">
                {duplicateWarning.candidates.map((c, idx) => (
                  <li key={idx}>
                    <span className="font-mono font-semibold">{c.studentIdNumber}</span> — {c.fullName}: {c.reason}
                  </li>
                ))}
              </ul>
              <FormField
                id="dup-override-reason"
                label="Documented Override Reason (only if genuinely a distinct student)"
                required
              >
                <Input
                  id="dup-override-reason"
                  placeholder="State verified verification note confirming distinct candidate..."
                  value={duplicateOverrideReason}
                  onChange={(e) => setDuplicateOverrideReason(e.target.value)}
                />
              </FormField>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDuplicateWarning(null)}
                >
                  Cancel &amp; Review Details
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={!duplicateOverrideReason.trim() || isSubmitting}
                  onClick={(e) => handleSubmit(e as any, true)}
                >
                  Confirm Distinct Student &amp; Register
                </Button>
              </div>
            </div>
          )}

          <form onSubmit={(e) => handleSubmit(e, false)} className="space-y-5">
            {/* Section 1: Cohort & Scheme Selection */}
            <div className="p-3.5 rounded-lg bg-[#FAF9F5] border border-stone-200 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField id="reg-batch" label="Original Admission Batch" required>
                  <Select
                    id="reg-batch"
                    value={form.originalBatchId}
                    onChange={(e) => setForm({ ...form, originalBatchId: e.target.value })}
                    required
                  >
                    {batches.map((b) => (
                      <option key={b.id} value={b.id} disabled={!b.isActive}>
                        {b.name} ({b.admissionAcademicYear}) · {b.schemeCode}
                        {!b.isActive ? ' [Inactive — Name Not Assigned]' : ''}
                      </option>
                    ))}
                  </Select>
                </FormField>

                <FormField id="reg-quota" label="Admission Quota (Fee Structure Link)" required>
                  <Select
                    id="reg-quota"
                    value={form.admissionQuota}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        admissionQuota: e.target.value as 'GOVERNMENT' | 'MANAGEMENT_PRIVATE' | 'NRI',
                      })
                    }
                  >
                    <option value="GOVERNMENT">Government Quota</option>
                    <option value="MANAGEMENT_PRIVATE">Management / Private Quota</option>
                    <option value="NRI">NRI Quota</option>
                  </Select>
                </FormField>
              </div>

              {selectedBatch && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-stone-600 pt-1 border-t border-stone-200/80">
                  <span>
                    Curriculum Scheme: <strong className="text-stone-900">{selectedBatch.schemeCode}</strong> ({formatCohortStageLabel(selectedBatch.currentCohortStage)})
                  </span>
                  <span className="font-mono text-[#4B2E2E]">
                    Auto Roll Sequence: KAMCH-{selectedBatch.admissionYearStart || new Date().getFullYear()}-NNNN
                  </span>
                </div>
              )}
            </div>

            {/* Core Identity Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <FormField id="reg-fullname" label="Student Full Name" required>
                <Input
                  id="reg-fullname"
                  required
                  placeholder="Full legal name as per qualifying records"
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                />
              </FormField>

              <FormField
                id="reg-univname"
                label="Official University Recorded Name (Optional)"
              >
                <Input
                  id="reg-univname"
                  placeholder="As recorded on RGUHS allotment (if different)"
                  value={form.universityRecordedName}
                  onChange={(e) => setForm({ ...form, universityRecordedName: e.target.value })}
                />
              </FormField>
            </div>

            {isLegacyRs6 ? (
              /* RS6 Legacy Minimal Form (Section 6) */
              <div className="p-4 rounded-lg border border-amber-200 bg-amber-50/40 space-y-3.5">
                <div className="text-xs font-semibold text-[#4B2E2E]">
                  RS6 Legacy Minimal Record Mode (Pre-2021–22 Intake)
                </div>
                <p className="text-[11px] text-stone-600 leading-relaxed">
                  RS6 historical batches store essential identification, academic summary, and 1-year compulsory internship completion without applying newer 3-professional-year progression rules.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormField id="rs6-phone" label="Contact Phone">
                    <Input
                      id="rs6-phone"
                      value={form.contactPhone}
                      onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                    />
                  </FormField>
                  <FormField id="rs6-rguhs" label="RGUHS Permanent Registration No. (Optional)">
                    <Input
                      id="rs6-rguhs"
                      className="font-mono uppercase"
                      placeholder="e.g. 20A0012"
                      value={form.permanentUniversityNumber}
                      onChange={(e) =>
                        setForm({ ...form, permanentUniversityNumber: e.target.value.toUpperCase() })
                      }
                    />
                  </FormField>
                </div>

                <FormField id="rs6-summary" label="RS6 Academic &amp; Passing Summary">
                  <Textarea
                    id="rs6-summary"
                    rows={2}
                    placeholder="Summary of RS6 professional examinations / historical standing..."
                    value={form.rs6AcademicSummary}
                    onChange={(e) => setForm({ ...form, rs6AcademicSummary: e.target.value })}
                  />
                </FormField>

                <label className="flex items-center gap-2.5 text-xs font-medium text-stone-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.rs6InternshipCompleted}
                    onChange={(e) =>
                      setForm({ ...form, rs6InternshipCompleted: e.target.checked })
                    }
                    className="rounded border-stone-300 text-[#4B2E2E] focus:ring-[#4B2E2E]"
                  />
                  <span>1-Year Compulsory Rotating Internship Completed</span>
                </label>
              </div>
            ) : (
              /* RS7+ Complete Structured Registration Fields (Section 8) */
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  <FormField id="reg-dob" label="Date of Birth">
                    <Input
                      id="reg-dob"
                      type="date"
                      value={form.dateOfBirth}
                      onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                    />
                  </FormField>
                  <FormField id="reg-gender" label="Gender">
                    <Select
                      id="reg-gender"
                      value={form.gender}
                      onChange={(e) => setForm({ ...form, gender: e.target.value })}
                    >
                      <option value="">Select...</option>
                      <option value="FEMALE">Female</option>
                      <option value="MALE">Male</option>
                      <option value="OTHER">Other</option>
                      <option value="NOT_SPECIFIED">Prefer Not to Specify</option>
                    </Select>
                  </FormField>
                  <FormField id="reg-phone" label="Student Mobile Number">
                    <Input
                      id="reg-phone"
                      type="tel"
                      placeholder="10-digit mobile"
                      value={form.contactPhone}
                      onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                    />
                  </FormField>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  <FormField id="reg-email" label="Student Email">
                    <Input
                      id="reg-email"
                      type="email"
                      value={form.contactEmail}
                      onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                    />
                  </FormField>
                  <FormField id="reg-seat-cat" label="Seat / Reservation Category">
                    <Input
                      id="reg-seat-cat"
                      placeholder="e.g. GM, 2A, 3B, SC, ST, OBC"
                      value={form.seatCategory}
                      onChange={(e) => setForm({ ...form, seatCategory: e.target.value })}
                    />
                  </FormField>
                  <FormField id="reg-adm-status" label="Admission Status">
                    <Select
                      id="reg-adm-status"
                      value={form.admissionStatus}
                      onChange={(e) => setForm({ ...form, admissionStatus: e.target.value })}
                    >
                      <option value="APPLIED">Applied</option>
                      <option value="PROVISIONAL">Provisional Admission</option>
                      <option value="CONFIRMED">Confirmed Admission</option>
                    </Select>
                  </FormField>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5">
                  <FormField
                    id="reg-adm-date"
                    label="Official Admission Date"
                    helperText="Leave blank if unverified"
                  >
                    <Input
                      id="reg-adm-date"
                      type="date"
                      value={form.admissionDate}
                      onChange={(e) => setForm({ ...form, admissionDate: e.target.value })}
                    />
                  </FormField>
                  <FormField id="reg-neet-roll" label="NEET Roll No.">
                    <Input
                      id="reg-neet-roll"
                      className="font-mono"
                      value={form.neetRollNumber}
                      onChange={(e) => setForm({ ...form, neetRollNumber: e.target.value })}
                    />
                  </FormField>
                  <FormField id="reg-neet-score" label="NEET Score / Rank">
                    <Input
                      id="reg-neet-score"
                      value={form.neetScore}
                      onChange={(e) => setForm({ ...form, neetScore: e.target.value })}
                    />
                  </FormField>
                  <FormField id="reg-kea-ack" label="KEA / Allotment Ref.">
                    <Input
                      id="reg-kea-ack"
                      className="font-mono"
                      value={form.keaAcknowledgementNo}
                      onChange={(e) => setForm({ ...form, keaAcknowledgementNo: e.target.value })}
                    />
                  </FormField>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-2 border-t border-stone-200">
                  <FormField id="reg-father" label="Father's Name">
                    <Input
                      id="reg-father"
                      value={form.fatherName}
                      onChange={(e) => setForm({ ...form, fatherName: e.target.value })}
                    />
                  </FormField>
                  <FormField id="reg-father-phone" label="Father / Parent Phone">
                    <Input
                      id="reg-father-phone"
                      type="tel"
                      value={form.fatherPhone}
                      onChange={(e) => setForm({ ...form, fatherPhone: e.target.value })}
                    />
                  </FormField>
                  <FormField id="reg-mother" label="Mother's Name">
                    <Input
                      id="reg-mother"
                      value={form.motherName}
                      onChange={(e) => setForm({ ...form, motherName: e.target.value })}
                    />
                  </FormField>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  <FormField id="reg-emg-name" label="Emergency Contact Name">
                    <Input
                      id="reg-emg-name"
                      value={form.emergencyContactName}
                      onChange={(e) => setForm({ ...form, emergencyContactName: e.target.value })}
                    />
                  </FormField>
                  <FormField id="reg-emg-rel" label="Emergency Relationship">
                    <Input
                      id="reg-emg-rel"
                      placeholder="e.g. Father, Guardian"
                      value={form.emergencyContactRelationship}
                      onChange={(e) =>
                        setForm({ ...form, emergencyContactRelationship: e.target.value })
                      }
                    />
                  </FormField>
                  <FormField id="reg-emg-phone" label="Emergency Phone">
                    <Input
                      id="reg-emg-phone"
                      type="tel"
                      value={form.emergencyContactPhone}
                      onChange={(e) => setForm({ ...form, emergencyContactPhone: e.target.value })}
                    />
                  </FormField>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5 pt-2 border-t border-stone-200">
                  <FormField id="reg-city" label="City / Town">
                    <Input
                      id="reg-city"
                      value={form.cityTown}
                      onChange={(e) => setForm({ ...form, cityTown: e.target.value })}
                    />
                  </FormField>
                  <FormField id="reg-dist" label="District">
                    <Input
                      id="reg-dist"
                      value={form.district}
                      onChange={(e) => setForm({ ...form, district: e.target.value })}
                    />
                  </FormField>
                  <FormField id="reg-state" label="State">
                    <Input
                      id="reg-state"
                      value={form.state}
                      onChange={(e) => setForm({ ...form, state: e.target.value })}
                    />
                  </FormField>
                  <FormField id="reg-pin" label="PIN Code">
                    <Input
                      id="reg-pin"
                      className="font-mono"
                      value={form.pinCode}
                      onChange={(e) => setForm({ ...form, pinCode: e.target.value })}
                    />
                  </FormField>
                </div>

                {/* Optional RGUHS Permanent Number */}
                <div className="p-3.5 rounded-lg bg-stone-50 border border-stone-200 space-y-2.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-stone-800">
                    <ShieldCheck className="w-4 h-4 text-[#4B2E2E]" />
                    <span>Permanent RGUHS University Registration Number (Not Required at Admission)</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                    <Input
                      placeholder="Leave blank until RGUHS issues permanent number"
                      className="font-mono uppercase"
                      value={form.permanentUniversityNumber}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          permanentUniversityNumber: e.target.value.toUpperCase(),
                        })
                      }
                    />
                    {form.permanentUniversityNumber.trim() && (
                      <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.verifyUniversityNumberNow}
                          onChange={(e) =>
                            setForm({ ...form, verifyUniversityNumberNow: e.target.checked })
                          }
                          className="rounded border-stone-300 text-[#4B2E2E]"
                        />
                        <span>Verify &amp; activate immediately as displayed ID</span>
                      </label>
                    )}
                  </div>
                </div>
              </>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-stone-200">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" isLoading={isSubmitting}>
                Register Student &amp; Generate Roll Number
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
