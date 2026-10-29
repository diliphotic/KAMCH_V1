import React, { useState, useEffect, useCallback } from 'react';
import {
  Briefcase,
  UserPlus,
  Search,
  RefreshCw,
  Edit2,
  Eye,
  X,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Building,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { isDepartmentAccountRole } from '../config/permissions';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

interface DepartmentOption {
  id: number;
  code: string;
  name: string;
}

type TeacherCodeStatus = 'VERIFIED' | 'APPLIED' | 'NOT_PROVIDED' | 'REQUIRES_VERIFICATION';

interface TeacherRecord {
  id: number;
  employeeCode: string;
  teacherCode: string;
  teacherCodeStatus: TeacherCodeStatus;
  registrationNumber: string;
  fullName: string;
  designation: string;
  departmentId: number;
  departmentName: string;
  departmentCode: string;
  qualification: string;
  dateOfBirth: string;
  joiningDateService: string;
  joiningDateInstitute: string;
  reportedExperience: string;
  previousInstitute: string;
  contactPhone: string;
  contactEmail: string;
  profilePhotoUrl: string;
  status: 'ACTIVE' | 'INACTIVE';
  dataVerificationRequired: boolean;
  verificationNotes: string;
}

interface TeacherFormState {
  employeeCode: string;
  teacherCode: string;
  teacherCodeStatus: TeacherCodeStatus;
  registrationNumber: string;
  fullName: string;
  designation: string;
  departmentId: string;
  qualification: string;
  dateOfBirth: string;
  joiningDateService: string;
  joiningDateInstitute: string;
  reportedExperience: string;
  previousInstitute: string;
  contactPhone: string;
  contactEmail: string;
  profilePhotoUrl: string;
  status: 'ACTIVE' | 'INACTIVE';
  dataVerificationRequired: boolean;
  verificationNotes: string;
}

function createInitialFormState(defaultDepartmentId: string): TeacherFormState {
  return {
    employeeCode: '',
    teacherCode: '',
    teacherCodeStatus: 'NOT_PROVIDED',
    registrationNumber: '',
    fullName: '',
    designation: '',
    departmentId: defaultDepartmentId,
    qualification: '',
    dateOfBirth: '',
    joiningDateService: '',
    joiningDateInstitute: '',
    reportedExperience: '',
    previousInstitute: '',
    contactPhone: '',
    contactEmail: '',
    profilePhotoUrl: '',
    status: 'ACTIVE',
    dataVerificationRequired: false,
    verificationNotes: '',
  };
}

function formatTeacherCodeSummary(t: Pick<TeacherRecord, 'teacherCode' | 'teacherCodeStatus'>): string {
  if (t.teacherCode) return t.teacherCode;
  if (t.teacherCodeStatus === 'APPLIED') return 'Applied (Pending)';
  if (t.teacherCodeStatus === 'REQUIRES_VERIFICATION') return 'Requires Verification';
  return 'Not Provided';
}

export const TeacherRecordsView: React.FC = () => {
  const { user, csrfToken } = useAuth();
  const isDeptScoped = isDepartmentAccountRole(user?.role);
  const defaultDeptId = user?.departmentId ? String(user.departmentId) : '';

  const [teachers, setTeachers] = useState<TeacherRecord[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [verificationFilter, setVerificationFilter] = useState<'ALL' | 'FLAGGED'>('ALL');
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [viewingTeacher, setViewingTeacher] = useState<TeacherRecord | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addForm, setAddForm] = useState<TeacherFormState>(() =>
    createInitialFormState(defaultDeptId)
  );
  const [editingTeacher, setEditingTeacher] = useState<TeacherRecord | null>(null);
  const [editForm, setEditForm] = useState<TeacherFormState>(() =>
    createInitialFormState(defaultDeptId)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchDepartments = useCallback(async () => {
    if (isDeptScoped) return;
    try {
      const res = await fetch('/api/users/departments');
      if (res.ok) {
        const data = await res.json();
        setDepartments(data.departments || []);
      }
    } catch {
      // Ignore network hiccup
    }
  }, [isDeptScoped]);

  const fetchTeachers = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.append('search', searchQuery.trim());
      if (!isDeptScoped && deptFilter) params.append('departmentId', deptFilter);
      if (verificationFilter === 'FLAGGED') params.append('verificationRequired', 'true');
      const res = await fetch(`/api/teachers?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setTeachers(data.teachers || []);
      }
    } catch {
      // Ignore network hiccup
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, deptFilter, verificationFilter, isDeptScoped]);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  useEffect(() => {
    fetchTeachers();
  }, [fetchTeachers]);

  const handleCreateTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setIsSubmitting(true);

    try {
      const payload = {
        ...addForm,
        teacherCodeStatus:
          addForm.teacherCode.trim() && addForm.teacherCodeStatus === 'NOT_PROVIDED'
            ? 'VERIFIED'
            : addForm.teacherCodeStatus,
        departmentId: isDeptScoped ? user?.departmentId : addForm.departmentId,
      };
      const res = await fetch('/api/teachers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save teacher record');
      }
      setNotice({ type: 'success', message: data.message });
      setIsAddModalOpen(false);
      setAddForm(createInitialFormState(defaultDeptId));
      fetchTeachers();
    } catch (err) {
      setNotice({ type: 'error', message: (err as Error).message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTeacher) return;
    setNotice(null);
    setIsSubmitting(true);

    try {
      const payload = {
        ...editForm,
        teacherCodeStatus:
          editForm.teacherCode.trim() && editForm.teacherCodeStatus === 'NOT_PROVIDED'
            ? 'VERIFIED'
            : editForm.teacherCodeStatus,
        departmentId: isDeptScoped ? user?.departmentId : editForm.departmentId,
      };
      const res = await fetch(`/api/teachers/${editingTeacher.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update teacher record');
      }
      setNotice({ type: 'success', message: data.message });
      setEditingTeacher(null);
      fetchTeachers();
    } catch (err) {
      setNotice({ type: 'error', message: (err as Error).message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditModal = (t: TeacherRecord) => {
    setEditingTeacher(t);
    setEditForm({
      employeeCode: t.employeeCode || '',
      teacherCode: t.teacherCode || '',
      teacherCodeStatus:
        t.teacherCodeStatus || (t.teacherCode ? 'VERIFIED' : 'NOT_PROVIDED'),
      registrationNumber: t.registrationNumber || '',
      fullName: t.fullName,
      designation: t.designation,
      departmentId: String(t.departmentId),
      qualification: t.qualification || '',
      dateOfBirth: t.dateOfBirth || '',
      joiningDateService: t.joiningDateService || '',
      joiningDateInstitute: t.joiningDateInstitute || '',
      reportedExperience: t.reportedExperience || '',
      previousInstitute: t.previousInstitute || '',
      contactPhone: t.contactPhone || '',
      contactEmail: t.contactEmail || '',
      profilePhotoUrl: t.profilePhotoUrl || '',
      status: t.status,
      dataVerificationRequired: Boolean(t.dataVerificationRequired),
      verificationNotes: t.verificationNotes || '',
    });
  };

  const renderFormFields = (
    form: TeacherFormState,
    setForm: React.Dispatch<React.SetStateAction<TeacherFormState>>,
    isEdit: boolean
  ) => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-semibold text-stone-800 mb-1">
            Full Name <span className="text-rose-700">*</span>
          </label>
          <input
            type="text"
            required
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg min-h-[38px]"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-stone-800 mb-1">
            Designation <span className="text-rose-700">*</span>
          </label>
          <input
            type="text"
            required
            placeholder="e.g. Professor / Associate Professor"
            value={form.designation}
            onChange={(e) => setForm({ ...form, designation: e.target.value })}
            className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg min-h-[38px]"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-stone-800 mb-1">
            Qualification
          </label>
          <input
            type="text"
            placeholder="e.g. BAMS, MD (AYU)"
            value={form.qualification}
            onChange={(e) => setForm({ ...form, qualification: e.target.value })}
            className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg min-h-[38px]"
          />
        </div>

        {!isDeptScoped && (
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-stone-800 mb-1">
              Department <span className="text-rose-700">*</span>
            </label>
            <select
              required
              value={form.departmentId}
              onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white min-h-[38px]"
            >
              <option value="">Select department...</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.code})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Distinct Regulatory & Institutional Identifiers */}
      <div className="pt-3 border-t border-stone-200">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 mb-2.5">
          Regulatory &amp; Institutional Identifiers (Kept Separate)
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold text-stone-800 mb-1">
              NCISM Teacher Code
            </label>
            <input
              type="text"
              placeholder="e.g. AYRB00276"
              value={form.teacherCode}
              onChange={(e) => {
                const nextTc = e.target.value.toUpperCase();
                setForm({
                  ...form,
                  teacherCode: nextTc,
                  teacherCodeStatus: nextTc.trim() ? 'VERIFIED' : form.teacherCodeStatus,
                });
              }}
              className="w-full px-3 py-2 text-xs font-mono border border-stone-300 rounded-lg min-h-[38px]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-800 mb-1">
              Teacher Code Status
            </label>
            <select
              value={form.teacherCodeStatus}
              onChange={(e) =>
                setForm({ ...form, teacherCodeStatus: e.target.value as TeacherCodeStatus })
              }
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white min-h-[38px]"
            >
              <option value="VERIFIED">Verified Code</option>
              <option value="APPLIED">Applied for Teacher Code</option>
              <option value="NOT_PROVIDED">Not Provided</option>
              <option value="REQUIRES_VERIFICATION">Requires Verification</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-800 mb-1">
              Prof. Registration No.
            </label>
            <input
              type="text"
              placeholder="e.g. 15551 or I-45554-A"
              value={form.registrationNumber}
              onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })}
              className="w-full px-3 py-2 text-xs font-mono border border-stone-300 rounded-lg min-h-[38px]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-800 mb-1">
              HR Employee Code (Optional)
            </label>
            <input
              type="text"
              placeholder="Leave blank if unassigned"
              value={form.employeeCode}
              onChange={(e) =>
                setForm({ ...form, employeeCode: e.target.value.toUpperCase() })
              }
              className="w-full px-3 py-2 text-xs font-mono border border-stone-300 rounded-lg min-h-[38px]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-800 mb-1">
              Date of Birth
            </label>
            <input
              type="date"
              value={form.dateOfBirth}
              onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg min-h-[38px]"
            />
          </div>

          {isEdit && (
            <div>
              <label className="block text-xs font-semibold text-stone-800 mb-1">
                Record Status
              </label>
              <select
                value={form.status}
                onChange={(e) =>
                  setForm({ ...form, status: e.target.value as 'ACTIVE' | 'INACTIVE' })
                }
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white min-h-[38px]"
              >
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Service Dates, Experience & Contact */}
      <div className="pt-3 border-t border-stone-200">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 mb-2.5">
          Service History &amp; Contact Information
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold text-stone-800 mb-1">
              Joining Date of Service
            </label>
            <input
              type="date"
              value={form.joiningDateService}
              onChange={(e) => setForm({ ...form, joiningDateService: e.target.value })}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg min-h-[38px]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-800 mb-1">
              Joining Date at Institute
            </label>
            <input
              type="date"
              value={form.joiningDateInstitute}
              onChange={(e) => setForm({ ...form, joiningDateInstitute: e.target.value })}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg min-h-[38px]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-800 mb-1">
              Reported Experience (Source)
            </label>
            <input
              type="text"
              placeholder="e.g. 12 Years 2 Months"
              value={form.reportedExperience}
              onChange={(e) => setForm({ ...form, reportedExperience: e.target.value })}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg min-h-[38px]"
            />
          </div>

          <div className="sm:col-span-3">
            <label className="block text-xs font-semibold text-stone-800 mb-1">
              Previous Institute
            </label>
            <input
              type="text"
              placeholder="Leave blank if none"
              value={form.previousInstitute}
              onChange={(e) => setForm({ ...form, previousInstitute: e.target.value })}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg min-h-[38px]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-800 mb-1">
              Contact Phone
            </label>
            <input
              type="tel"
              value={form.contactPhone}
              onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg min-h-[38px]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-800 mb-1">
              Contact Email
            </label>
            <input
              type="email"
              value={form.contactEmail}
              onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg min-h-[38px]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-800 mb-1">
              Profile Photo URL (Optional)
            </label>
            <input
              type="text"
              placeholder="https://... or /assets/..."
              value={form.profilePhotoUrl}
              onChange={(e) => setForm({ ...form, profilePhotoUrl: e.target.value })}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg min-h-[38px]"
            />
          </div>
        </div>
      </div>

      {/* Verification Flag & Notes */}
      <div className="pt-3 border-t border-stone-200 space-y-2.5">
        <label className="inline-flex items-center gap-2 text-xs font-semibold text-stone-800 cursor-pointer">
          <input
            type="checkbox"
            checked={form.dataVerificationRequired}
            onChange={(e) => setForm({ ...form, dataVerificationRequired: e.target.checked })}
            className="rounded border-stone-300 text-[#4B2E2E] focus:ring-[#D4AF37]"
          />
          <span>Flag record for manual Office / Department verification</span>
        </label>
        <div>
          <label className="block text-xs font-semibold text-stone-800 mb-1">
            Verification Notes
          </label>
          <textarea
            rows={2}
            placeholder="Optional notes regarding dates, registration number, or source verification..."
            value={form.verificationNotes}
            onChange={(e) => setForm({ ...form, verificationNotes: e.target.value })}
            className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg"
          />
        </div>
      </div>
    </div>
  );

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
        title={
          isDeptScoped && user?.departmentName
            ? `Teacher Records — ${user.departmentName}`
            : 'Teacher Records'
        }
        description="Institutional faculty registry. Teacher records do not create login accounts."
        actions={
          <Button
            variant="primary"
            size="sm"
            icon={<UserPlus className="w-3.5 h-3.5" />}
            onClick={() => {
              setNotice(null);
              setAddForm(createInitialFormState(defaultDeptId));
              setIsAddModalOpen(true);
            }}
          >
            Add Teacher Record
          </Button>
        }
      />

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
            <div className="relative w-full lg:w-96">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                type="text"
                placeholder="Search by name, teacher code, reg. no., employee code, or designation..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] min-h-[40px]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="inline-flex items-center p-1 bg-stone-100 rounded-lg border border-stone-200">
                <button
                  type="button"
                  onClick={() => setVerificationFilter('ALL')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer min-h-[32px] ${
                    verificationFilter === 'ALL'
                      ? 'bg-white text-stone-900 shadow-xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  All Faculty
                </button>
                <button
                  type="button"
                  onClick={() => setVerificationFilter('FLAGGED')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer min-h-[32px] ${
                    verificationFilter === 'FLAGGED'
                      ? 'bg-white text-amber-900 shadow-xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  Needs Verification
                </button>
              </div>

              {!isDeptScoped && (
                <select
                  value={deptFilter}
                  onChange={(e) => setDeptFilter(e.target.value)}
                  className="py-2 px-3 text-xs bg-white border border-stone-300 rounded-lg text-stone-700 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] min-h-[40px]"
                >
                  <option value="">All Departments</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.code})
                    </option>
                  ))}
                </select>
              )}

              <button
                type="button"
                onClick={fetchTeachers}
                title="Refresh list"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center p-2 border border-stone-300 rounded-lg hover:bg-stone-100 text-stone-600 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#FAF9F5] border-b border-stone-200 text-stone-700 font-semibold text-[11px] uppercase tracking-wider">
                <th className="py-3 px-4">Faculty Member</th>
                <th className="py-3 px-4">NCISM Teacher Code</th>
                <th className="py-3 px-4">Prof. Reg. No.</th>
                <th className="py-3 px-4">Department</th>
                <th className="py-3 px-4">Service &amp; Experience</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-stone-500">
                    Loading teacher records...
                  </td>
                </tr>
              ) : teachers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-stone-500">
                    <Briefcase className="w-6 h-6 mx-auto mb-2 text-stone-400" />
                    No teacher records found.
                  </td>
                </tr>
              ) : (
                teachers.map((t) => (
                  <tr key={t.id} className="hover:bg-stone-50/70">
                    <td className="py-3 px-4">
                      <span className="font-semibold text-stone-900 block">{t.fullName}</span>
                      <span className="text-[11px] text-stone-600 block">
                        {t.designation}
                        {t.qualification ? ` · ${t.qualification}` : ''}
                      </span>
                      {t.employeeCode && (
                        <span className="font-mono text-[11px] text-stone-500 block mt-0.5">
                          Emp ID: {t.employeeCode}
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      {t.teacherCode ? (
                        <span className="font-mono font-medium text-stone-900">
                          {t.teacherCode}
                        </span>
                      ) : (
                        <span className="text-[11px] text-amber-800">
                          {formatTeacherCodeSummary(t)}
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      {t.registrationNumber ? (
                        <span className="font-mono text-stone-800">{t.registrationNumber}</span>
                      ) : (
                        <span className="text-[11px] text-stone-400">Not Provided</span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1.5 text-stone-700">
                        <Building className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                        <span>{t.departmentName || `Dept #${t.departmentId}`}</span>
                      </span>
                    </td>

                    <td className="py-3 px-4 text-stone-700">
                      {t.joiningDateInstitute ? (
                        <span className="block">Inst: {t.joiningDateInstitute}</span>
                      ) : (
                        <span className="text-stone-400 block">Inst date unset</span>
                      )}
                      {t.reportedExperience && (
                        <span className="text-[11px] text-stone-500 block">
                          Exp: {t.reportedExperience}
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <span
                        className={`font-medium block ${
                          t.status === 'ACTIVE' ? 'text-emerald-800' : 'text-stone-500'
                        }`}
                      >
                        {t.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                      </span>
                      {t.dataVerificationRequired && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-800 mt-0.5">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span>Verify Data</span>
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setViewingTeacher(t)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded text-stone-700 bg-white hover:bg-stone-100 border border-stone-300 cursor-pointer min-h-[36px]"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Details</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(t)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded text-stone-700 bg-stone-100 hover:bg-stone-200 border border-stone-200 cursor-pointer min-h-[36px]"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* View Faculty Details Modal */}
      {viewingTeacher && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <Card className="w-full max-w-2xl my-auto">
            <CardHeader>
              <div className="flex items-center gap-3">
                {viewingTeacher.profilePhotoUrl && (
                  <img
                    src={viewingTeacher.profilePhotoUrl}
                    alt={viewingTeacher.fullName}
                    className="w-11 h-11 rounded-lg object-cover border border-stone-200"
                  />
                )}
                <div>
                  <CardTitle>{viewingTeacher.fullName}</CardTitle>
                  <CardDescription>
                    {viewingTeacher.designation}
                    {viewingTeacher.departmentName ? ` · ${viewingTeacher.departmentName}` : ''}
                  </CardDescription>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingTeacher(null)}
                className="text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              {viewingTeacher.dataVerificationRequired && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-950 space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>Flagged for Manual Verification</span>
                  </div>
                  {viewingTeacher.verificationNotes && (
                    <p className="text-[11px] leading-relaxed text-amber-900">
                      {viewingTeacher.verificationNotes}
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                <div>
                  <span className="text-[11px] text-stone-500 block">NCISM Teacher Code</span>
                  <span className="font-mono font-medium text-stone-900">
                    {formatTeacherCodeSummary(viewingTeacher)}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-stone-500 block">
                    Professional Registration No.
                  </span>
                  <span className="font-mono font-medium text-stone-900">
                    {viewingTeacher.registrationNumber || 'Not Provided'}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-stone-500 block">HR Employee Code</span>
                  <span className="font-mono text-stone-800">
                    {viewingTeacher.employeeCode || 'Not Assigned'}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-stone-500 block">Qualification</span>
                  <span className="text-stone-800">
                    {viewingTeacher.qualification || 'Not Provided'}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-stone-500 block">Date of Birth</span>
                  <span className="text-stone-800">
                    {viewingTeacher.dateOfBirth || 'Not Provided'}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-stone-500 block">
                    Reported Experience (Source)
                  </span>
                  <span className="text-stone-800">
                    {viewingTeacher.reportedExperience || 'Not Provided'}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-stone-500 block">Joining Date of Service</span>
                  <span className="text-stone-800">
                    {viewingTeacher.joiningDateService || 'Not Provided'}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-stone-500 block">
                    Joining Date at This Institute
                  </span>
                  <span className="text-stone-800">
                    {viewingTeacher.joiningDateInstitute || 'Not Provided'}
                  </span>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-[11px] text-stone-500 block">Previous Institute</span>
                  <span className="text-stone-800">
                    {viewingTeacher.previousInstitute || 'None / Not Provided'}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-stone-500 block">Contact Email</span>
                  <span className="text-stone-800">
                    {viewingTeacher.contactEmail || 'Not Provided'}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-stone-500 block">Contact Phone</span>
                  <span className="font-mono text-stone-800">
                    {viewingTeacher.contactPhone || 'Not Provided'}
                  </span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-stone-200">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setViewingTeacher(null)}
                >
                  Close
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  icon={<Edit2 className="w-3.5 h-3.5" />}
                  onClick={() => {
                    const target = viewingTeacher;
                    setViewingTeacher(null);
                    openEditModal(target);
                  }}
                >
                  Edit Record
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Add Teacher Modal */}
      {isAddModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <Card className="w-full max-w-2xl my-auto">
            <CardHeader>
              <div>
                <CardTitle>Add Teacher Record</CardTitle>
                <CardDescription>
                  Institutional faculty record only; does not generate a user login account.
                </CardDescription>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </CardHeader>
            <CardContent className="max-h-[80vh] overflow-y-auto">
              <form onSubmit={handleCreateTeacher} className="space-y-4">
                {renderFormFields(addForm, setAddForm, false)}
                <div className="flex justify-end gap-2 pt-3 border-t border-stone-200">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsAddModalOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" size="sm" isLoading={isSubmitting}>
                    Save Teacher Record
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Edit Teacher Modal */}
      {editingTeacher && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <Card className="w-full max-w-2xl my-auto">
            <CardHeader>
              <div>
                <CardTitle>Edit Teacher Record</CardTitle>
                <CardDescription>
                  {editingTeacher.fullName}
                  {editingTeacher.teacherCode ? ` · ${editingTeacher.teacherCode}` : ''}
                </CardDescription>
              </div>
              <button
                type="button"
                onClick={() => setEditingTeacher(null)}
                className="text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </CardHeader>
            <CardContent className="max-h-[80vh] overflow-y-auto">
              <form onSubmit={handleUpdateTeacher} className="space-y-4">
                {renderFormFields(editForm, setEditForm, true)}
                <div className="flex justify-end gap-2 pt-3 border-t border-stone-200">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingTeacher(null)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" size="sm" isLoading={isSubmitting}>
                    Save Changes
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
