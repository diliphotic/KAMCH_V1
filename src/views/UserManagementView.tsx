import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  UserPlus,
  Search,
  Lock,
  Unlock,
  Ban,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  RefreshCw,
  Building,
  Edit2,
  UserX,
  X,
  Eye,
  EyeOff,
  FolderTree,
  History,
  FileText,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';

export interface RoleItem {
  id: number;
  code: string;
  name: string;
  description: string;
}

export interface AssignedDeptAccountSummary {
  id: number;
  username: string;
  fullName: string;
  email: string | null;
  isSuspended: boolean;
  isLocked: boolean;
  mustChangePassword: boolean;
}

export interface DepartmentItem {
  id: number;
  code: string;
  name: string;
  description: string;
  teacherCount?: number;
  assignedAccount?: AssignedDeptAccountSummary | null;
}

export interface UserAccount {
  id: number;
  username: string;
  email: string | null;
  fullName: string;
  roleId: number;
  role: string;
  roleName: string;
  departmentId: number | null;
  departmentName: string | null;
  departmentCode: string | null;
  teacherId?: number | null;
  teacherName?: string | null;
  teacherEmployeeCode?: string | null;
  teacherCode?: string | null;
  teacherDesignation?: string | null;
  mustChangePassword: boolean;
  failedAttempts: number;
  isLocked: boolean;
  lockedAt: string | null;
  isSuspended: boolean;
  suspendedAt: string | null;
  suspensionReason?: string | null;
  isDeactivated: boolean;
  deactivatedAt: string | null;
  deactivationReason?: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AvailableTeacherItem {
  id: number;
  employeeCode: string;
  teacherCode: string;
  teacherCodeStatus: string;
  registrationNumber: string;
  fullName: string;
  designation: string;
  departmentId: number | null;
  departmentName: string;
  departmentCode: string;
  contactEmail: string;
  contactPhone: string;
  isLinked: boolean;
  linkedUserId: number | null;
  linkedUsername: string | null;
}

export interface AuditLogItem {
  id: number;
  actorId: number | null;
  actorUsername: string | null;
  actorFullName: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ipAddress: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export const UserManagementView: React.FC = () => {
  const { user, csrfToken } = useAuth();

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const isPrincipal = user?.role === 'PRINCIPAL';
  const isSecretary = user?.role === 'SECRETARY';
  const canManageAccounts = isSuperAdmin || isPrincipal || isSecretary;

  const [activeTab, setActiveTab] = useState<'directory' | 'create' | 'departments' | 'audit'>('directory');

  // Accounts & Metadata State
  const [accounts, setAccounts] = useState<UserAccount[]>([]);
  const [assignableRoles, setAssignableRoles] = useState<RoleItem[]>([]);
  const [filterRoles, setFilterRoles] = useState<RoleItem[]>([]);
  const [departments, setDepartments] = useState<DepartmentItem[]>([]);
  const [availableTeachers, setAvailableTeachers] = useState<AvailableTeacherItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalAccounts, setTotalAccounts] = useState(0);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);

  // Notification Banner
  const [bannerNotice, setBannerNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Create User Form State
  const [createForm, setCreateForm] = useState({
    username: '',
    email: '',
    fullName: '',
    roleId: '',
    departmentId: '',
    teacherId: '',
    initialPassword: '',
    confirmPassword: '',
    activateImmediately: true,
  });
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  // Edit User Modal & Role-Change Confirmation State
  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
  const [editForm, setEditForm] = useState({
    fullName: '',
    email: '',
    roleId: '',
    departmentId: '',
    teacherId: '',
  });
  const [confirmRoleChange, setConfirmRoleChange] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Reset Password Modal State
  const [resetTargetUser, setResetTargetUser] = useState<{
    id: number;
    username: string;
    fullName: string;
  } | null>(null);
  const [resetForm, setResetForm] = useState({
    temporaryPassword: '',
    confirmPassword: '',
  });
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  // Action Confirmation Dialog State (suspend, reactivate, deactivate, unlock)
  const [confirmDialog, setConfirmDialog] = useState<{
    type: 'suspend' | 'reactivate' | 'deactivate' | 'unlock';
    user: { id: number; username: string; fullName: string; failedAttempts?: number };
    reason: string;
  } | null>(null);
  const [isProcessingAction, setIsProcessingAction] = useState(false);

  // Per-User History Modal State
  const [historyTargetUser, setHistoryTargetUser] = useState<{
    id: number;
    username: string;
    fullName: string;
  } | null>(null);
  const [userHistoryLogs, setUserHistoryLogs] = useState<AuditLogItem[]>([]);
  const [isLoadingUserHistory, setIsLoadingUserHistory] = useState(false);

  // Global Audit Logs Tab State
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('ALL');
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);

  // Department Management State (Super Admin Only)
  const [isCreatingDept, setIsCreatingDept] = useState(false);
  const [newDeptForm, setNewDeptForm] = useState({ code: '', name: '', description: '' });
  const [editingDept, setEditingDept] = useState<DepartmentItem | null>(null);
  const [editDeptForm, setEditDeptForm] = useState({ code: '', name: '', description: '' });
  const [isDeptSubmitting, setIsDeptSubmitting] = useState(false);

  // Fetch Roles
  const fetchRoles = useCallback(async () => {
    try {
      const res = await fetch('/api/users/roles');
      if (res.ok) {
        const data = await res.json();
        setAssignableRoles(data.assignableRoles || data.roles || []);
        setFilterRoles(data.filterRoles || data.roles || []);
      }
    } catch {
      // Handle silently
    }
  }, []);

  // Fetch Departments
  const fetchDepartments = useCallback(async () => {
    try {
      const res = await fetch('/api/users/departments');
      if (res.ok) {
        const data = await res.json();
        setDepartments(data.departments || []);
      }
    } catch {
      // Handle silently
    }
  }, []);

  // Fetch Available Teachers (for linking Faculty accounts)
  const fetchAvailableTeachers = useCallback(async () => {
    try {
      const res = await fetch('/api/users/available-teachers');
      if (res.ok) {
        const data = await res.json();
        setAvailableTeachers(data.teachers || []);
      }
    } catch {
      // Handle silently
    }
  }, []);

  // Fetch Accounts Directory
  const fetchAccounts = useCallback(async () => {
    if (!canManageAccounts) return;
    setIsLoadingAccounts(true);
    try {
      const params = new URLSearchParams({
        page: String(currentPage),
        limit: '15',
        search: searchQuery,
        role: roleFilter,
        status: statusFilter,
      });
      const res = await fetch(`/api/users?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.users || []);
        setTotalPages(data.pagination.totalPages || 1);
        setTotalAccounts(data.pagination.total || 0);
      }
    } catch {
      // Handle silently
    } finally {
      setIsLoadingAccounts(false);
    }
  }, [canManageAccounts, currentPage, searchQuery, roleFilter, statusFilter]);

  // Fetch Audit Logs
  const fetchAuditLogs = useCallback(async () => {
    if (!canManageAccounts) return;
    setIsLoadingAudit(true);
    try {
      const params = new URLSearchParams({ limit: '60' });
      if (auditSearch.trim()) params.append('search', auditSearch.trim());
      if (auditActionFilter !== 'ALL') params.append('action', auditActionFilter);
      const res = await fetch(`/api/users/audit-logs?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data.logs || []);
      }
    } catch {
      // Handle silently
    } finally {
      setIsLoadingAudit(false);
    }
  }, [canManageAccounts, auditSearch, auditActionFilter]);

  // Fetch Per-User History
  const handleOpenUserHistory = async (target: { id: number; username: string; fullName: string }) => {
    setHistoryTargetUser(target);
    setUserHistoryLogs([]);
    setIsLoadingUserHistory(true);
    try {
      const res = await fetch(`/api/users/${target.id}/audit-logs`);
      if (res.ok) {
        const data = await res.json();
        setUserHistoryLogs(data.logs || []);
      }
    } catch {
      // Handle silently
    } finally {
      setIsLoadingUserHistory(false);
    }
  };

  useEffect(() => {
    if (user && canManageAccounts) {
      fetchRoles();
      fetchDepartments();
      fetchAvailableTeachers();
    }
  }, [user, canManageAccounts, fetchRoles, fetchDepartments, fetchAvailableTeachers]);

  useEffect(() => {
    if (canManageAccounts && activeTab === 'directory') {
      fetchAccounts();
    }
  }, [canManageAccounts, activeTab, fetchAccounts]);

  useEffect(() => {
    if (canManageAccounts && activeTab === 'departments' && isSuperAdmin) {
      fetchDepartments();
    }
  }, [canManageAccounts, activeTab, isSuperAdmin, fetchDepartments]);

  useEffect(() => {
    if (canManageAccounts && activeTab === 'audit') {
      fetchAuditLogs();
    }
  }, [canManageAccounts, activeTab, fetchAuditLogs]);

  if (!user || !canManageAccounts) {
    return null;
  }

  // Execute Account Action (Suspend, Reactivate, Deactivate, Unlock)
  const handleExecuteAction = async () => {
    if (!confirmDialog) return;
    setIsProcessingAction(true);
    setBannerNotice(null);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    };

    try {
      const { type, user: target, reason } = confirmDialog;
      const bodyPayload =
        type === 'suspend' || type === 'deactivate'
          ? JSON.stringify({ reason: reason.trim() || undefined })
          : undefined;
      const res = await fetch(`/api/users/${target.id}/${type}`, {
        method: 'PATCH',
        headers,
        ...(bodyPayload ? { body: bodyPayload } : {}),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Failed to execute ${type} action`);
      }

      setBannerNotice({ type: 'success', message: data.message });
      setConfirmDialog(null);
      fetchAccounts();
      fetchDepartments();
    } catch (err) {
      setBannerNotice({ type: 'error', message: (err as Error).message });
    } finally {
      setIsProcessingAction(false);
    }
  };

  // Handle Create Account Submission
  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setBannerNotice(null);

    if (createForm.initialPassword.length < 8) {
      setBannerNotice({ type: 'error', message: 'Temporary password must be at least 8 characters long.' });
      return;
    }

    if (createForm.initialPassword !== createForm.confirmPassword) {
      setBannerNotice({ type: 'error', message: 'Initial password and confirmation password do not match.' });
      return;
    }

    setIsCreatingUser(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify(createForm),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create account');
      }

      setBannerNotice({
        type: 'success',
        message: data.message || `Account created successfully for ${data.user?.fullName}.`,
      });
      setCreateForm({
        username: '',
        email: '',
        fullName: '',
        roleId: '',
        departmentId: '',
        teacherId: '',
        initialPassword: '',
        confirmPassword: '',
        activateImmediately: true,
      });
      setActiveTab('directory');
      fetchAccounts();
      fetchDepartments();
      fetchAvailableTeachers();
    } catch (err) {
      setBannerNotice({ type: 'error', message: (err as Error).message });
    } finally {
      setIsCreatingUser(false);
    }
  };

  // Handle Edit Account Submission (with explicit confirmation step when role changes)
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    const isRoleChanging =
      editingUser.role !== 'SUPER_ADMIN' &&
      Number(editForm.roleId) !== Number(editingUser.roleId);

    if (isRoleChanging && !confirmRoleChange) {
      setConfirmRoleChange(true);
      return;
    }

    setIsSavingEdit(true);
    setBannerNotice(null);

    try {
      const res = await fetch(`/api/users/${editingUser.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify(editForm),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update account details');
      }

      setBannerNotice({ type: 'success', message: data.message });
      setEditingUser(null);
      setConfirmRoleChange(false);
      fetchAccounts();
      fetchDepartments();
      fetchAvailableTeachers();
    } catch (err) {
      setBannerNotice({ type: 'error', message: (err as Error).message });
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Handle Password Reset Submission
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTargetUser) return;
    setBannerNotice(null);

    if (resetForm.temporaryPassword.length < 8) {
      setBannerNotice({ type: 'error', message: 'Temporary password must be at least 8 characters long.' });
      return;
    }

    if (resetForm.temporaryPassword !== resetForm.confirmPassword) {
      setBannerNotice({ type: 'error', message: 'Temporary password and confirmation password do not match.' });
      return;
    }

    setIsResettingPassword(true);
    try {
      const res = await fetch(`/api/users/${resetTargetUser.id}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify(resetForm),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to reset user password');
      }

      setBannerNotice({ type: 'success', message: data.message });
      setResetTargetUser(null);
      setResetForm({ temporaryPassword: '', confirmPassword: '' });
      fetchAccounts();
      fetchDepartments();
    } catch (err) {
      setBannerNotice({ type: 'error', message: (err as Error).message });
    } finally {
      setIsResettingPassword(false);
    }
  };

  // Handle Create Department (Super Admin)
  const handleCreateDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsDeptSubmitting(true);
    setBannerNotice(null);

    try {
      const res = await fetch('/api/users/departments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify(newDeptForm),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create department');

      setBannerNotice({ type: 'success', message: `Department '${data.department.name}' created successfully.` });
      setIsCreatingDept(false);
      setNewDeptForm({ code: '', name: '', description: '' });
      fetchDepartments();
    } catch (err) {
      setBannerNotice({ type: 'error', message: (err as Error).message });
    } finally {
      setIsDeptSubmitting(false);
    }
  };

  // Handle Edit Department (Super Admin)
  const handleUpdateDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDept) return;
    setIsDeptSubmitting(true);
    setBannerNotice(null);

    try {
      const res = await fetch(`/api/users/departments/${editingDept.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify(editDeptForm),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update department');

      setBannerNotice({ type: 'success', message: `Department '${data.department.name}' updated successfully.` });
      setEditingDept(null);
      fetchDepartments();
      fetchAccounts();
    } catch (err) {
      setBannerNotice({ type: 'error', message: (err as Error).message });
    } finally {
      setIsDeptSubmitting(false);
    }
  };

  // Pre-fill Create Account form to assign a shared account to a specific department
  const handleQuickAssignDeptAccount = (dept: DepartmentItem) => {
    const deptRole = assignableRoles.find((r) => r.code === 'DEPARTMENT');
    setCreateForm({
      username: `dept_${dept.code.toLowerCase()}`,
      email: '',
      fullName: `${dept.name} Department Account`,
      roleId: deptRole ? String(deptRole.id) : '',
      departmentId: String(dept.id),
      teacherId: '',
      initialPassword: '',
      confirmPassword: '',
      activateImmediately: true,
    });
    setBannerNotice(null);
    setActiveTab('create');
  };

  const selectedCreateRole = assignableRoles.find((r) => String(r.id) === String(createForm.roleId));
  const isCreateDeptRole = selectedCreateRole?.code === 'DEPARTMENT';
  const isCreateFacultyRole = selectedCreateRole?.code === 'FACULTY';

  const selectedEditRole =
    editingUser?.role === 'SUPER_ADMIN'
      ? { id: editingUser.roleId, code: 'SUPER_ADMIN', name: editingUser.roleName }
      : assignableRoles.find((r) => String(r.id) === String(editForm.roleId));
  const isEditDeptRole = selectedEditRole?.code === 'DEPARTMENT';
  const isEditFacultyRole = selectedEditRole?.code === 'FACULTY';

  return (
    <div className="space-y-5">
      {/* Top Banner Notice */}
      {bannerNotice && (
        <div
          className={`p-3.5 rounded-lg text-xs flex items-start justify-between gap-3 ${
            bannerNotice.type === 'success'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border border-rose-200 text-rose-900'
          }`}
          role="alert"
        >
          <div className="flex items-start gap-2 min-w-0">
            {bannerNotice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            )}
            <span className="font-medium leading-relaxed">{bannerNotice.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setBannerNotice(null)}
            className="text-stone-400 hover:text-stone-700 p-0.5 rounded cursor-pointer"
            aria-label="Dismiss message"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Page Header */}
      <PageHeader
        title="User Management"
        description="Institutional account provisioning, role assignment, account status management, and security audit history."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant={activeTab === 'create' ? 'gold' : 'primary'}
              size="sm"
              icon={<UserPlus className="w-3.5 h-3.5" />}
              onClick={() => {
                setBannerNotice(null);
                setActiveTab('create');
              }}
            >
              Create Account
            </Button>
            {isSuperAdmin && (
              <Button
                variant={activeTab === 'departments' ? 'gold' : 'outline'}
                size="sm"
                icon={<Building className="w-3.5 h-3.5" />}
                onClick={() => {
                  setBannerNotice(null);
                  setActiveTab('departments');
                }}
              >
                Departments
              </Button>
            )}
          </div>
        }
      />

      {/* Tabs Bar */}
      <div className="flex items-center gap-1.5 border-b border-stone-200 pb-2 text-xs overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => {
            setBannerNotice(null);
            setActiveTab('directory');
          }}
          className={`px-3.5 py-2 rounded-lg font-medium transition-all min-h-[38px] whitespace-nowrap cursor-pointer flex items-center gap-2 ${
            activeTab === 'directory'
              ? 'bg-[#4B2E2E] text-white shadow-xs'
              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Accounts Directory ({totalAccounts})</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setBannerNotice(null);
            setActiveTab('create');
          }}
          className={`px-3.5 py-2 rounded-lg font-medium transition-all min-h-[38px] whitespace-nowrap cursor-pointer flex items-center gap-2 ${
            activeTab === 'create'
              ? 'bg-[#4B2E2E] text-white shadow-xs'
              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'
          }`}
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span>Create Account</span>
        </button>

        {isSuperAdmin && (
          <button
            type="button"
            onClick={() => {
              setBannerNotice(null);
              setActiveTab('departments');
            }}
            className={`px-3.5 py-2 rounded-lg font-medium transition-all min-h-[38px] whitespace-nowrap cursor-pointer flex items-center gap-2 ${
              activeTab === 'departments'
                ? 'bg-[#4B2E2E] text-white shadow-xs'
                : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'
            }`}
          >
            <FolderTree className="w-3.5 h-3.5" />
            <span>Departments &amp; Accounts ({departments.length})</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setBannerNotice(null);
            setActiveTab('audit');
          }}
          className={`px-3.5 py-2 rounded-lg font-medium transition-all min-h-[38px] whitespace-nowrap cursor-pointer flex items-center gap-2 ${
            activeTab === 'audit'
              ? 'bg-[#4B2E2E] text-white shadow-xs'
              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Audit Activity</span>
        </button>
      </div>

      {/* TAB 1: ACCOUNTS DIRECTORY */}
      {activeTab === 'directory' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-3.5">
              <div className="flex flex-col md:flex-row items-center gap-3 justify-between">
                <div className="relative w-full md:w-80">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-400">
                    <Search className="w-4 h-4" />
                  </span>
                  <input
                    type="text"
                    placeholder="Search by full name, username, or email..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-[#4B2E2E] transition-all min-h-[38px]"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                  <select
                    value={roleFilter}
                    onChange={(e) => {
                      setRoleFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="flex-1 sm:flex-none py-2 px-3 text-xs bg-white border border-stone-300 rounded-lg text-stone-700 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] min-h-[38px]"
                  >
                    <option value="ALL">All Permitted Roles</option>
                    {filterRoles.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.name}
                      </option>
                    ))}
                  </select>

                  <select
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="flex-1 sm:flex-none py-2 px-3 text-xs bg-white border border-stone-300 rounded-lg text-stone-700 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] min-h-[38px]"
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="ACTIVE">Active</option>
                    <option value="LOCKED">Temporarily Locked</option>
                    <option value="SUSPENDED">Suspended</option>
                    <option value="DEACTIVATED">Deactivated</option>
                  </select>

                  <button
                    type="button"
                    onClick={fetchAccounts}
                    title="Refresh List"
                    className="min-h-[38px] min-w-[38px] flex items-center justify-center p-2 border border-stone-300 rounded-lg hover:bg-stone-100 text-stone-600 transition-all cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAccounts ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#FAF9F5] border-b border-stone-200 text-stone-700 font-semibold text-[11px] uppercase tracking-wider">
                    <th className="py-3 px-4">Account User</th>
                    <th className="py-3 px-4">Role &amp; Department</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Created</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {isLoadingAccounts ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-stone-500">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#D4AF37]" />
                        <span>Loading institutional accounts...</span>
                      </td>
                    </tr>
                  ) : accounts.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-stone-500">
                        No accounts found matching the current search and filter criteria.
                      </td>
                    </tr>
                  ) : (
                    accounts.map((acc) => {
                      const isTargetSuperAdmin = acc.role === 'SUPER_ADMIN';
                      const isSelf = acc.id === user.id;

                      return (
                        <tr key={acc.id} className="hover:bg-stone-50/80 transition-colors">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full bg-[#4B2E2E] text-[#F5F5DC] flex items-center justify-center font-bold text-xs shrink-0">
                                {(acc.fullName || acc.username).charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <span className="font-semibold text-stone-900 block leading-tight truncate">
                                  {acc.fullName}
                                  {isSelf && (
                                    <span className="ml-1.5 text-[10px] text-stone-500 font-normal">
                                      (You)
                                    </span>
                                  )}
                                </span>
                                <span className="text-[11px] text-stone-500 font-mono block truncate">
                                  {acc.username}
                                  {acc.email ? ` · ${acc.email}` : ''}
                                </span>
                              </div>
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            <div className="space-y-1">
                              <Badge variant={isTargetSuperAdmin ? 'gold' : 'institutional'} size="sm">
                                {acc.roleName}
                              </Badge>
                              {acc.teacherName ? (
                                <div className="text-[11px] text-stone-700 flex items-center gap-1 font-medium">
                                  <span className="text-[#4B2E2E] font-semibold">Teacher:</span>
                                  <span className="truncate">{acc.teacherName} {acc.teacherDesignation ? `(${acc.teacherDesignation})` : ''}</span>
                                </div>
                              ) : null}
                              {acc.departmentName && (
                                <div className="text-[11px] text-stone-600 flex items-center gap-1">
                                  <Building className="w-3 h-3 text-stone-400 shrink-0" />
                                  <span className="truncate">{acc.departmentName}</span>
                                </div>
                              )}
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {acc.isDeactivated ? (
                                <Badge variant="neutral" size="sm">
                                  <UserX className="w-3 h-3 mr-1" />
                                  Deactivated
                                </Badge>
                              ) : acc.isSuspended ? (
                                <Badge variant="warning" size="sm">
                                  <Ban className="w-3 h-3 mr-1" />
                                  Suspended
                                </Badge>
                              ) : acc.isLocked ? (
                                <Badge variant="warning" size="sm">
                                  <Lock className="w-3 h-3 mr-1" />
                                  Locked (30m)
                                </Badge>
                              ) : (
                                <Badge variant="success" size="sm">
                                  <CheckCircle2 className="w-3 h-3 mr-1" />
                                  Active
                                </Badge>
                              )}
                              {acc.mustChangePassword && !acc.isDeactivated && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">
                                  Pwd Change Req
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="py-3 px-4 text-stone-500 text-[11px] tabular-nums">
                            <span>{new Date(acc.createdAt).toLocaleDateString()}</span>
                            {acc.createdBy && (
                              <span className="block text-stone-400 text-[10px]">
                                by {acc.createdBy}
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                              {(!isTargetSuperAdmin || isSuperAdmin) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingUser(acc);
                                    setConfirmRoleChange(false);
                                    setEditForm({
                                      fullName: acc.fullName,
                                      email: acc.email || '',
                                      roleId: String(acc.roleId),
                                      departmentId: acc.departmentId ? String(acc.departmentId) : '',
                                      teacherId: acc.teacherId ? String(acc.teacherId) : '',
                                    });
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded text-stone-700 bg-stone-100 hover:bg-stone-200 border border-stone-200 transition-colors cursor-pointer min-h-[32px]"
                                  title="Edit account details"
                                >
                                  <Edit2 className="w-3 h-3" />
                                  <span>Edit</span>
                                </button>
                              )}

                              {(!isTargetSuperAdmin || isSuperAdmin) && !acc.isDeactivated && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setResetTargetUser({
                                      id: acc.id,
                                      username: acc.username,
                                      fullName: acc.fullName,
                                    });
                                    setResetForm({ temporaryPassword: '', confirmPassword: '' });
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-colors cursor-pointer min-h-[32px]"
                                  title="Reset password"
                                >
                                  <KeyRound className="w-3 h-3 text-amber-700" />
                                  <span>Reset Pwd</span>
                                </button>
                              )}

                              {/* Unlock shown strictly to Super Admin */}
                              {isSuperAdmin && acc.isLocked && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setConfirmDialog({
                                      type: 'unlock',
                                      user: acc,
                                      reason: '',
                                    })
                                  }
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors cursor-pointer min-h-[32px]"
                                  title="Unlock temporarily locked account"
                                >
                                  <Unlock className="w-3 h-3" />
                                  <span>Unlock</span>
                                </button>
                              )}

                              {!isSelf && (!isTargetSuperAdmin || isSuperAdmin) && (
                                <>
                                  {acc.isSuspended || acc.isDeactivated ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setConfirmDialog({
                                          type: 'reactivate',
                                          user: acc,
                                          reason: '',
                                        })
                                      }
                                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors cursor-pointer min-h-[32px]"
                                      title="Reactivate account"
                                    >
                                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                      <span>Reactivate</span>
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setConfirmDialog({
                                          type: 'suspend',
                                          user: acc,
                                          reason: '',
                                        })
                                      }
                                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors cursor-pointer min-h-[32px]"
                                      title="Suspend account"
                                    >
                                      <Ban className="w-3 h-3" />
                                      <span>Suspend</span>
                                    </button>
                                  )}
                                </>
                              )}

                              {!isSelf && !acc.isDeactivated && (!isTargetSuperAdmin || isSuperAdmin) && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setConfirmDialog({
                                      type: 'deactivate',
                                      user: acc,
                                      reason: '',
                                    })
                                  }
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded text-stone-700 bg-white hover:bg-stone-100 border border-stone-300 transition-colors cursor-pointer min-h-[32px]"
                                  title="Deactivate account while preserving historical records"
                                >
                                  <UserX className="w-3 h-3" />
                                  <span>Deactivate</span>
                                </button>
                              )}

                              {(!isTargetSuperAdmin || isSuperAdmin) && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleOpenUserHistory({
                                      id: acc.id,
                                      username: acc.username,
                                      fullName: acc.fullName,
                                    })
                                  }
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded text-stone-600 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer min-h-[32px]"
                                  title="View account audit history"
                                >
                                  <History className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View */}
            <div className="block md:hidden divide-y divide-stone-200">
              {isLoadingAccounts ? (
                <div className="py-10 text-center text-stone-500">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#D4AF37]" />
                  <span>Loading accounts...</span>
                </div>
              ) : accounts.length === 0 ? (
                <div className="py-10 text-center text-stone-500 text-xs p-4">
                  No accounts found matching criteria.
                </div>
              ) : (
                accounts.map((acc) => {
                  const isTargetSuperAdmin = acc.role === 'SUPER_ADMIN';
                  const isSelf = acc.id === user.id;

                  return (
                    <div key={acc.id} className="p-3.5 space-y-2.5 bg-white">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-[#4B2E2E] text-[#F5F5DC] flex items-center justify-center font-bold text-xs shrink-0">
                            {(acc.fullName || acc.username).charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <span className="font-semibold text-stone-900 block leading-tight text-xs truncate">
                              {acc.fullName}
                              {isSelf && <span className="ml-1 text-[10px] text-stone-500">(You)</span>}
                            </span>
                            <span className="text-[11px] text-stone-500 font-mono block truncate">
                              {acc.username}
                              {acc.email ? ` · ${acc.email}` : ''}
                            </span>
                          </div>
                        </div>
                        <Badge variant={isTargetSuperAdmin ? 'gold' : 'institutional'} size="sm">
                          {acc.roleName}
                        </Badge>
                      </div>

                      {acc.teacherName && (
                        <div className="text-[11px] text-stone-700 flex items-center gap-1.5 pl-10 font-medium">
                          <span className="text-[#4B2E2E] font-semibold">Teacher:</span>
                          <span>{acc.teacherName} {acc.teacherDesignation ? `(${acc.teacherDesignation})` : ''}</span>
                        </div>
                      )}

                      {acc.departmentName && (
                        <div className="text-[11px] text-stone-600 flex items-center gap-1.5 pl-10">
                          <Building className="w-3 h-3 text-stone-400" />
                          <span>{acc.departmentName}</span>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-stone-100">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {acc.isDeactivated ? (
                            <Badge variant="neutral" size="sm">Deactivated</Badge>
                          ) : acc.isSuspended ? (
                            <Badge variant="warning" size="sm">Suspended</Badge>
                          ) : acc.isLocked ? (
                            <Badge variant="warning" size="sm">Locked (30m)</Badge>
                          ) : (
                            <Badge variant="success" size="sm">Active</Badge>
                          )}
                          {acc.mustChangePassword && !acc.isDeactivated && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                              Pwd Change Req
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-stone-400 tabular-nums">
                          {new Date(acc.createdAt).toLocaleDateString()}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-stone-100">
                        {(!isTargetSuperAdmin || isSuperAdmin) && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingUser(acc);
                              setConfirmRoleChange(false);
                              setEditForm({
                                fullName: acc.fullName,
                                email: acc.email || '',
                                roleId: String(acc.roleId),
                                departmentId: acc.departmentId ? String(acc.departmentId) : '',
                                teacherId: acc.teacherId ? String(acc.teacherId) : '',
                              });
                            }}
                            className="flex-1 py-1 px-2 text-xs font-medium bg-stone-100 hover:bg-stone-200 rounded text-stone-700 min-h-[34px] flex items-center justify-center gap-1"
                          >
                            <Edit2 className="w-3 h-3" />
                            <span>Edit</span>
                          </button>
                        )}

                        {(!isTargetSuperAdmin || isSuperAdmin) && !acc.isDeactivated && (
                          <button
                            type="button"
                            onClick={() => {
                              setResetTargetUser({
                                id: acc.id,
                                username: acc.username,
                                fullName: acc.fullName,
                              });
                              setResetForm({ temporaryPassword: '', confirmPassword: '' });
                            }}
                            className="flex-1 py-1 px-2 text-xs font-medium bg-amber-50 hover:bg-amber-100 rounded text-amber-900 border border-amber-200 min-h-[34px] flex items-center justify-center gap-1"
                          >
                            <KeyRound className="w-3 h-3" />
                            <span>Reset Pwd</span>
                          </button>
                        )}

                        {isSuperAdmin && acc.isLocked && (
                          <button
                            type="button"
                            onClick={() => setConfirmDialog({ type: 'unlock', user: acc, reason: '' })}
                            className="flex-1 py-1 px-2 text-xs font-medium bg-emerald-50 rounded text-emerald-800 border border-emerald-200 min-h-[34px] flex items-center justify-center gap-1"
                          >
                            <Unlock className="w-3 h-3" />
                            <span>Unlock</span>
                          </button>
                        )}

                        {!isSelf && (!isTargetSuperAdmin || isSuperAdmin) && (
                          <>
                            {acc.isSuspended || acc.isDeactivated ? (
                              <button
                                type="button"
                                onClick={() => setConfirmDialog({ type: 'reactivate', user: acc, reason: '' })}
                                className="flex-1 py-1 px-2 text-xs font-medium bg-emerald-50 rounded text-emerald-800 border border-emerald-200 min-h-[34px] flex items-center justify-center gap-1"
                              >
                                <span>Reactivate</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDialog({ type: 'suspend', user: acc, reason: '' })}
                                className="flex-1 py-1 px-2 text-xs font-medium bg-rose-50 rounded text-rose-800 border border-rose-200 min-h-[34px] flex items-center justify-center gap-1"
                              >
                                <span>Suspend</span>
                              </button>
                            )}
                          </>
                        )}

                        {!isSelf && !acc.isDeactivated && (!isTargetSuperAdmin || isSuperAdmin) && (
                          <button
                            type="button"
                            onClick={() => setConfirmDialog({ type: 'deactivate', user: acc, reason: '' })}
                            className="flex-1 py-1 px-2 text-xs font-medium bg-white rounded text-stone-700 border border-stone-300 min-h-[34px] flex items-center justify-center gap-1"
                          >
                            <span>Deactivate</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {totalPages > 1 && (
              <div className="p-3 bg-[#FAF9F5] border-t border-stone-200 flex items-center justify-between text-xs text-stone-600">
                <span className="tabular-nums">
                  Page {currentPage} of {totalPages} ({totalAccounts} total accounts)
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* TAB 2: CREATE ACCOUNT */}
      {activeTab === 'create' && (
        <div className="max-w-2xl mx-auto space-y-4">
          <Card accentTop>
            <CardHeader>
              <div>
                <div className="flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-[#D4AF37]" />
                  <CardTitle>Create Institutional Account</CardTitle>
                </div>
                <CardDescription>
                  Set an initial temporary password and activate the account. The user must change their temporary password upon first sign in.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateAccount} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Full Name */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-stone-800 mb-1">
                      Full Name <span className="text-rose-700">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Enter staff or department account name"
                      value={createForm.fullName}
                      onChange={(e) => setCreateForm({ ...createForm, fullName: e.target.value })}
                      className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] min-h-[38px]"
                    />
                  </div>

                  {/* Unique Username */}
                  <div>
                    <label className="block text-xs font-semibold text-stone-800 mb-1">
                      Unique Username <span className="text-rose-700">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      minLength={3}
                      maxLength={50}
                      placeholder="e.g. office_clerk1"
                      value={createForm.username}
                      onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
                      className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 font-mono placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] min-h-[38px]"
                    />
                  </div>

                  {/* Optional Email */}
                  <div>
                    <label className="block text-xs font-semibold text-stone-800 mb-1">
                      Email Address <span className="text-stone-400 font-normal">(Optional)</span>
                    </label>
                    <input
                      type="email"
                      placeholder="e.g. staff@kamch.ac.in"
                      value={createForm.email}
                      onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                      className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] min-h-[38px]"
                    />
                  </div>

                  {/* Allowed Role */}
                  <div className={isCreateDeptRole || isCreateFacultyRole ? 'md:col-span-1' : 'md:col-span-2'}>
                    <label className="block text-xs font-semibold text-stone-800 mb-1">
                      Role <span className="text-rose-700">*</span>
                    </label>
                    <select
                      required
                      value={createForm.roleId}
                      onChange={(e) =>
                        setCreateForm({
                          ...createForm,
                          roleId: e.target.value,
                          departmentId: '',
                          teacherId: '',
                        })
                      }
                      className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] min-h-[38px]"
                    >
                      <option value="">Select an allowed role...</option>
                      {assignableRoles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Institutional Teacher Record Link (Mandatory when role is FACULTY) */}
                  {isCreateFacultyRole && (
                    <div className="md:col-span-1">
                      <label className="block text-xs font-semibold text-stone-800 mb-1">
                        Teacher Record <span className="text-rose-700">*</span>
                      </label>
                      <select
                        required
                        value={createForm.teacherId}
                        onChange={(e) => {
                          const tId = e.target.value;
                          const selectedT = availableTeachers.find((t) => String(t.id) === tId);
                          setCreateForm((prev) => ({
                            ...prev,
                            teacherId: tId,
                            fullName: prev.fullName || (selectedT ? selectedT.fullName : ''),
                            email: prev.email || (selectedT?.contactEmail ? selectedT.contactEmail : ''),
                            departmentId: selectedT?.departmentId ? String(selectedT.departmentId) : '',
                          }));
                        }}
                        className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] min-h-[38px]"
                      >
                        <option value="">Select teacher record...</option>
                        {availableTeachers.map((t) => (
                          <option
                            key={t.id}
                            value={t.id}
                            disabled={t.isLinked}
                          >
                            {t.fullName} ({t.designation}) — {t.departmentName || 'No Dept'}
                            {t.employeeCode ? ` [Emp: ${t.employeeCode}]` : ''}
                            {t.isLinked ? ` [Linked: ${t.linkedUsername}]` : ''}
                          </option>
                        ))}
                      </select>
                      {availableTeachers.length === 0 && (
                        <span className="text-[11px] text-amber-800 mt-1 block">
                          No active teacher records found. Create records in Teacher Records module.
                        </span>
                      )}
                    </div>
                  )}

                  {/* Department Assignment (Mandatory when role is DEPARTMENT) */}
                  {isCreateDeptRole && (
                    <div className="md:col-span-1">
                      <label className="block text-xs font-semibold text-stone-800 mb-1">
                        Associated Department <span className="text-rose-700">*</span>
                      </label>
                      <select
                        required
                        value={createForm.departmentId}
                        onChange={(e) => setCreateForm({ ...createForm, departmentId: e.target.value })}
                        className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] min-h-[38px]"
                      >
                        <option value="">Select department...</option>
                        {departments.map((d) => (
                          <option
                            key={d.id}
                            value={d.id}
                            disabled={Boolean(d.assignedAccount)}
                          >
                            {d.name} ({d.code})
                            {d.assignedAccount ? ` — Assigned (${d.assignedAccount.username})` : ''}
                          </option>
                        ))}
                      </select>
                      {departments.length === 0 && (
                        <span className="text-[11px] text-amber-800 mt-1 block">
                          No departments exist yet. Super Admin can add departments in the Departments tab.
                        </span>
                      )}
                    </div>
                  )}

                  {/* Initial Temporary Password */}
                  <div>
                    <label className="block text-xs font-semibold text-stone-800 mb-1">
                      Initial Temporary Password <span className="text-rose-700">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showCreatePassword ? 'text' : 'password'}
                        required
                        minLength={8}
                        placeholder="Minimum 8 characters"
                        value={createForm.initialPassword}
                        onChange={(e) => setCreateForm({ ...createForm, initialPassword: e.target.value })}
                        className="w-full px-3 pr-10 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] min-h-[38px]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCreatePassword(!showCreatePassword)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-stone-400 hover:text-stone-600 cursor-pointer"
                        aria-label="Toggle password visibility"
                      >
                        {showCreatePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Confirm Temporary Password */}
                  <div>
                    <label className="block text-xs font-semibold text-stone-800 mb-1">
                      Confirm Temporary Password <span className="text-rose-700">*</span>
                    </label>
                    <input
                      type={showCreatePassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      placeholder="Re-enter password"
                      value={createForm.confirmPassword}
                      onChange={(e) => setCreateForm({ ...createForm, confirmPassword: e.target.value })}
                      className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] min-h-[38px]"
                    />
                  </div>

                  {/* Activate Immediately Toggle */}
                  <div className="md:col-span-2 pt-1">
                    <label className="inline-flex items-center gap-2.5 cursor-pointer text-xs text-stone-800 font-medium">
                      <input
                        type="checkbox"
                        checked={createForm.activateImmediately}
                        onChange={(e) =>
                          setCreateForm({ ...createForm, activateImmediately: e.target.checked })
                        }
                        className="w-4 h-4 rounded border-stone-300 text-[#4B2E2E] focus:ring-[#D4AF37]"
                      />
                      <span>Activate account immediately for first-login password setup</span>
                    </label>
                  </div>
                </div>

                <div className="p-3 bg-amber-50/60 border border-amber-200/60 rounded-lg text-xs text-amber-900 flex items-start gap-2">
                  <KeyRound className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <span>
                    The user will be required to change this temporary password immediately after their first successful sign in before accessing ERP modules.
                  </span>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-200">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setActiveTab('directory')}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    isLoading={isCreatingUser}
                    icon={<UserPlus className="w-3.5 h-3.5" />}
                  >
                    {createForm.activateImmediately ? 'Create & Activate Account' : 'Create Account'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 3: DEPARTMENTS & DEPARTMENT ACCOUNTS (Super Admin Only) */}
      {activeTab === 'departments' && isSuperAdmin && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <CardTitle>Institutional Departments &amp; Shared Department Accounts</CardTitle>
                <CardDescription>
                  Each department maintains up to one shared Department Account isolated strictly to its own departmental records.
                </CardDescription>
              </div>
              <Button
                variant="gold"
                size="sm"
                icon={<Building className="w-3.5 h-3.5" />}
                onClick={() => {
                  setNewDeptForm({ code: '', name: '', description: '' });
                  setIsCreatingDept(true);
                }}
              >
                Create Department
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#FAF9F5] border-b border-stone-200 text-stone-700 font-semibold text-[11px] uppercase tracking-wider">
                      <th className="py-3 px-4">Code</th>
                      <th className="py-3 px-4">Department Name</th>
                      <th className="py-3 px-4">Assigned Account</th>
                      <th className="py-3 px-4">Account Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {departments.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-10 text-center text-stone-500">
                          No departments created yet. Click &quot;Create Department&quot; to add an institutional department.
                        </td>
                      </tr>
                    ) : (
                      departments.map((dept) => {
                        const acc = dept.assignedAccount;
                        return (
                          <tr key={dept.id} className="hover:bg-stone-50 transition-colors">
                            <td className="py-3 px-4 font-mono font-semibold text-[#4B2E2E]">
                              {dept.code}
                            </td>
                            <td className="py-3 px-4">
                              <span className="font-medium text-stone-900 block">{dept.name}</span>
                              {dept.description && (
                                <span className="text-[11px] text-stone-500 block">{dept.description}</span>
                              )}
                            </td>
                            <td className="py-3 px-4">
                              {acc ? (
                                <div>
                                  <span className="font-mono font-semibold text-stone-900 block">
                                    {acc.username}
                                  </span>
                                  <span className="text-[11px] text-stone-500">{acc.fullName}</span>
                                </div>
                              ) : (
                                <span className="text-stone-400 italic text-[11px]">Unassigned</span>
                              )}
                            </td>
                            <td className="py-3 px-4">
                              {acc ? (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {acc.isSuspended ? (
                                    <Badge variant="warning" size="sm">Suspended</Badge>
                                  ) : acc.isLocked ? (
                                    <Badge variant="warning" size="sm">Locked (30m)</Badge>
                                  ) : (
                                    <Badge variant="success" size="sm">Active</Badge>
                                  )}
                                  {acc.mustChangePassword && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                                      Pwd Change Req
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-stone-400 text-[11px]">—</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingDept(dept);
                                    setEditDeptForm({
                                      code: dept.code,
                                      name: dept.name,
                                      description: dept.description || '',
                                    });
                                  }}
                                  className="px-2.5 py-1 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded border border-stone-200 cursor-pointer min-h-[30px]"
                                >
                                  Edit Dept
                                </button>

                                {!acc ? (
                                  <button
                                    type="button"
                                    onClick={() => handleQuickAssignDeptAccount(dept)}
                                    className="px-2.5 py-1 text-xs font-medium text-[#4B2E2E] bg-[#FAF3DC] hover:bg-[#F3E7BE] rounded border border-[#E7CD7A] cursor-pointer min-h-[30px]"
                                  >
                                    Assign Account
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setResetTargetUser({
                                          id: acc.id,
                                          username: acc.username,
                                          fullName: acc.fullName,
                                        });
                                        setResetForm({ temporaryPassword: '', confirmPassword: '' });
                                      }}
                                      className="px-2.5 py-1 text-xs font-medium text-amber-900 bg-amber-50 hover:bg-amber-100 rounded border border-amber-200 cursor-pointer min-h-[30px]"
                                    >
                                      Reset Pwd
                                    </button>

                                    {acc.isSuspended ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setConfirmDialog({
                                            type: 'reactivate',
                                            user: acc,
                                            reason: '',
                                          })
                                        }
                                        className="px-2.5 py-1 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded border border-emerald-200 cursor-pointer min-h-[30px]"
                                      >
                                        Reactivate
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setConfirmDialog({
                                            type: 'suspend',
                                            user: acc,
                                            reason: '',
                                          })
                                        }
                                        className="px-2.5 py-1 text-xs font-medium text-rose-800 bg-rose-50 hover:bg-rose-100 rounded border border-rose-200 cursor-pointer min-h-[30px]"
                                      >
                                        Suspend
                                      </button>
                                    )}

                                    <button
                                      type="button"
                                      onClick={() =>
                                        setConfirmDialog({
                                          type: 'deactivate',
                                          user: acc,
                                          reason: '',
                                        })
                                      }
                                      className="px-2.5 py-1 text-xs font-medium text-stone-700 bg-white hover:bg-stone-100 rounded border border-stone-300 cursor-pointer min-h-[30px]"
                                    >
                                      Deactivate
                                    </button>
                                  </>
                                )}
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
        </div>
      )}

      {/* TAB 4: AUDIT ACTIVITY */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-3.5">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="relative w-full sm:w-80">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input
                    type="text"
                    placeholder="Filter by action or actor..."
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 min-h-[38px]"
                  />
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <select
                    value={auditActionFilter}
                    onChange={(e) => setAuditActionFilter(e.target.value)}
                    className="flex-1 sm:flex-none py-2 px-3 text-xs bg-white border border-stone-300 rounded-lg text-stone-700 min-h-[38px]"
                  >
                    <option value="ALL">All Audit Actions</option>
                    <option value="USER_CREATED">Account Created</option>
                    <option value="USER_ROLE_CHANGED">Role Changed</option>
                    <option value="USER_UPDATED">Account Updated</option>
                    <option value="ACCOUNT_SUSPENDED">Account Suspended</option>
                    <option value="ACCOUNT_REACTIVATED">Account Reactivated</option>
                    <option value="ACCOUNT_DEACTIVATED">Account Deactivated</option>
                    <option value="PASSWORD_RESET_BY_ADMIN">Password Reset</option>
                    <option value="ACCOUNT_LOCKED">Temporary Lockout</option>
                    <option value="LOGIN_SUCCESS">Login Success</option>
                    <option value="LOGIN_FAILED">Login Failed</option>
                    <option value="DEPARTMENT_CREATED">Department Created</option>
                    <option value="UNAUTHORIZED_ACCESS_ATTEMPT">Unauthorized Attempt</option>
                  </select>
                  <button
                    type="button"
                    onClick={fetchAuditLogs}
                    title="Refresh audit logs"
                    className="min-h-[38px] min-w-[38px] flex items-center justify-center p-2 border border-stone-300 rounded-lg hover:bg-stone-100 text-stone-600 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAudit ? 'animate-spin' : ''}`} />
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
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Action</th>
                    <th className="py-3 px-4">Actor</th>
                    <th className="py-3 px-4">Target</th>
                    <th className="py-3 px-4">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {isLoadingAudit ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-stone-500">
                        Loading audit activity...
                      </td>
                    </tr>
                  ) : auditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-stone-500">
                        No audit entries found for the selected filter.
                      </td>
                    </tr>
                  ) : (
                    auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-stone-50/70">
                        <td className="py-2.5 px-4 font-mono text-[11px] text-stone-500 whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                        <td className="py-2.5 px-4">
                          <span className="font-mono font-semibold text-[#4B2E2E] text-[11px]">
                            {log.action}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-stone-700">
                          {log.actorUsername ? `${log.actorFullName} (${log.actorUsername})` : log.actorFullName}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[11px] text-stone-600">
                          {log.targetType ? `${log.targetType}${log.targetId ? ` #${log.targetId}` : ''}` : '—'}
                        </td>
                        <td className="py-2.5 px-4 text-[11px] text-stone-600 max-w-md truncate">
                          {log.details ? JSON.stringify(log.details) : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* MODAL 1: EDIT USER ACCOUNT DETAILS (with Role Change Confirmation) */}
      {editingUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-lg bg-white rounded-xl border border-stone-200 shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
            <div className="p-4 sm:p-5 bg-[#FAF9F5] border-b border-stone-200 flex items-center justify-between">
              <div>
                <h3 className="font-serif text-base font-bold text-stone-900">Edit Account Details</h3>
                <p className="text-xs text-stone-500">Username: {editingUser.username}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingUser(null);
                  setConfirmRoleChange(false);
                }}
                className="text-stone-400 hover:text-stone-700 p-1 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-xs font-semibold text-stone-800 mb-1">
                  Full Name <span className="text-rose-700">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editForm.fullName}
                  onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] min-h-[38px]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-800 mb-1">
                  Email Address <span className="text-stone-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="email"
                  placeholder="Leave blank if not applicable"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] min-h-[38px]"
                />
              </div>

              {editingUser.role === 'SUPER_ADMIN' || editingUser.id === user.id ? (
                <div>
                  <label className="block text-xs font-semibold text-stone-800 mb-1">Role</label>
                  <input
                    type="text"
                    disabled
                    value={editingUser.roleName}
                    className="w-full px-3 py-2 text-xs bg-stone-100 border border-stone-200 rounded-lg text-stone-600 cursor-not-allowed min-h-[38px]"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-stone-800 mb-1">
                    Role <span className="text-rose-700">*</span>
                  </label>
                  <select
                    required
                    value={editForm.roleId}
                    onChange={(e) => {
                      setConfirmRoleChange(false);
                      setEditForm({
                        ...editForm,
                        roleId: e.target.value,
                        departmentId: '',
                        teacherId: '',
                      });
                    }}
                    className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] min-h-[38px]"
                  >
                    {assignableRoles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {isEditFacultyRole && (
                <div>
                  <label className="block text-xs font-semibold text-stone-800 mb-1">
                    Institutional Teacher Record <span className="text-rose-700">*</span>
                  </label>
                  <select
                    required
                    value={editForm.teacherId}
                    onChange={(e) => {
                      const tId = e.target.value;
                      const selectedT = availableTeachers.find((t) => String(t.id) === tId);
                      setEditForm((prev) => ({
                        ...prev,
                        teacherId: tId,
                        departmentId: selectedT?.departmentId ? String(selectedT.departmentId) : prev.departmentId,
                      }));
                    }}
                    className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] min-h-[38px]"
                  >
                    <option value="">Select teacher record...</option>
                    {availableTeachers.map((t) => {
                      const isLinkedOther = t.isLinked && t.linkedUserId !== editingUser.id;
                      return (
                        <option key={t.id} value={t.id} disabled={Boolean(isLinkedOther)}>
                          {t.fullName} ({t.designation}) — {t.departmentName || 'No Dept'}
                          {t.employeeCode ? ` [Emp: ${t.employeeCode}]` : ''}
                          {isLinkedOther ? ` [Linked: ${t.linkedUsername}]` : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              {isEditDeptRole && (
                <div>
                  <label className="block text-xs font-semibold text-stone-800 mb-1">
                    Associated Department <span className="text-rose-700">*</span>
                  </label>
                  <select
                    required
                    value={editForm.departmentId}
                    onChange={(e) => setEditForm({ ...editForm, departmentId: e.target.value })}
                    className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] min-h-[38px]"
                  >
                    <option value="">Select department...</option>
                    {departments.map((d) => {
                      const assignedOther =
                        d.assignedAccount && d.assignedAccount.id !== editingUser.id;
                      return (
                        <option key={d.id} value={d.id} disabled={Boolean(assignedOther)}>
                          {d.name} ({d.code})
                          {assignedOther ? ` — Assigned (${d.assignedAccount?.username})` : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              {/* Explicit Role Change Confirmation Step */}
              {confirmRoleChange && (
                <div
                  className="p-3.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-950 text-xs space-y-1.5"
                  role="alert"
                >
                  <div className="flex items-center gap-2 font-bold">
                    <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>Confirm Role Change</span>
                  </div>
                  <p className="leading-relaxed">
                    You are changing <strong>{editingUser.fullName}</strong>&apos;s role from{' '}
                    <strong>{editingUser.roleName}</strong> to{' '}
                    <strong>{selectedEditRole?.name}</strong>. Any active session for this user will be invalidated immediately so the new permissions take effect.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-200">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (confirmRoleChange) {
                      setConfirmRoleChange(false);
                    } else {
                      setEditingUser(null);
                    }
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" size="sm" isLoading={isSavingEdit}>
                  {confirmRoleChange ? 'Confirm Role Change & Save' : 'Save Changes'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: PASSWORD RESET CONFIRMATION DIALOG */}
      {resetTargetUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-md bg-white rounded-xl border border-stone-200 shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
            <div className="p-4 sm:p-5 bg-[#FAF9F5] border-b border-stone-200 flex items-center justify-between">
              <div>
                <h3 className="font-serif text-base font-bold text-stone-900">Reset User Password</h3>
                <p className="text-xs text-stone-500">
                  Target: {resetTargetUser.fullName} ({resetTargetUser.username})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setResetTargetUser(null)}
                className="text-stone-400 hover:text-stone-700 p-1 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleResetPassword} className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-xs font-semibold text-stone-800 mb-1">
                  New Temporary Password <span className="text-rose-700">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showResetPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    placeholder="Minimum 8 characters"
                    value={resetForm.temporaryPassword}
                    onChange={(e) => setResetForm({ ...resetForm, temporaryPassword: e.target.value })}
                    className="w-full px-3 pr-10 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] min-h-[38px]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPassword(!showResetPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-stone-400 hover:text-stone-600 cursor-pointer"
                  >
                    {showResetPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-800 mb-1">
                  Confirm Temporary Password <span className="text-rose-700">*</span>
                </label>
                <input
                  type={showResetPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  placeholder="Re-enter password"
                  value={resetForm.confirmPassword}
                  onChange={(e) => setResetForm({ ...resetForm, confirmPassword: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] min-h-[38px]"
                />
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-1">
                <p className="font-semibold">Confirmation Notice:</p>
                <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-800">
                  <li>Target user must change this temporary password at their next login.</li>
                  <li>All existing active sessions for this user will be invalidated immediately.</li>
                </ul>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-200">
                <Button type="button" variant="outline" size="sm" onClick={() => setResetTargetUser(null)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  isLoading={isResettingPassword}
                  icon={<KeyRound className="w-3.5 h-3.5" />}
                >
                  Confirm Password Reset
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: CONFIRM STATUS ACTION (Suspend, Reactivate, Deactivate, Unlock) */}
      {confirmDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-md bg-white rounded-xl border border-stone-200 shadow-2xl overflow-hidden my-auto p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                  confirmDialog.type === 'deactivate' || confirmDialog.type === 'suspend'
                    ? 'bg-rose-100 text-rose-700'
                    : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                {confirmDialog.type === 'deactivate' ? (
                  <UserX className="w-5 h-5" />
                ) : confirmDialog.type === 'suspend' ? (
                  <Ban className="w-5 h-5" />
                ) : confirmDialog.type === 'unlock' ? (
                  <Unlock className="w-5 h-5" />
                ) : (
                  <CheckCircle2 className="w-5 h-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="font-serif text-sm font-bold text-stone-900">
                  {confirmDialog.type === 'deactivate'
                    ? 'Deactivate Account'
                    : confirmDialog.type === 'suspend'
                    ? 'Suspend Account'
                    : confirmDialog.type === 'unlock'
                    ? 'Unlock Account'
                    : 'Reactivate Account'}
                </h4>
                <p className="text-xs text-stone-600 mt-1 leading-relaxed">
                  {confirmDialog.type === 'deactivate' && (
                    <>
                      Deactivate account <strong>{confirmDialog.user.fullName}</strong> ({confirmDialog.user.username})?
                      Login will be prevented and active sessions terminated. The account record, audit trail, and all historical payment/receipt/student references will be preserved.
                    </>
                  )}
                  {confirmDialog.type === 'suspend' && (
                    <>
                      Suspend account <strong>{confirmDialog.user.fullName}</strong> ({confirmDialog.user.username})?
                      Active sessions will be invalidated immediately and login prevented until reactivated.
                    </>
                  )}
                  {confirmDialog.type === 'reactivate' && (
                    <>
                      Reactivate account <strong>{confirmDialog.user.fullName}</strong> ({confirmDialog.user.username})?
                      Login eligibility will be restored while preserving any pending password-change requirement.
                    </>
                  )}
                  {confirmDialog.type === 'unlock' && (
                    <>
                      Unlock account <strong>{confirmDialog.user.fullName}</strong> ({confirmDialog.user.username}) and reset the failed login counter?
                    </>
                  )}
                </p>
              </div>
            </div>

            {(confirmDialog.type === 'suspend' || confirmDialog.type === 'deactivate') && (
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Reason <span className="text-stone-400 font-normal">(Optional — recorded in audit log)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Administrative leave / end of tenure"
                  value={confirmDialog.reason}
                  onChange={(e) =>
                    setConfirmDialog({ ...confirmDialog, reason: e.target.value })
                  }
                  className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 min-h-[38px]"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-200">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isProcessingAction}
                onClick={() => setConfirmDialog(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant={confirmDialog.type === 'deactivate' || confirmDialog.type === 'suspend' ? 'primary' : 'gold'}
                size="sm"
                isLoading={isProcessingAction}
                onClick={handleExecuteAction}
              >
                {confirmDialog.type === 'deactivate'
                  ? 'Confirm Deactivate'
                  : confirmDialog.type === 'suspend'
                  ? 'Confirm Suspend'
                  : confirmDialog.type === 'unlock'
                  ? 'Confirm Unlock'
                  : 'Confirm Reactivate'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: PER-ACCOUNT AUDIT HISTORY */}
      {historyTargetUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-2xl bg-white rounded-xl border border-stone-200 shadow-2xl overflow-hidden my-auto max-h-[88vh] flex flex-col">
            <div className="p-4 sm:p-5 bg-[#FAF9F5] border-b border-stone-200 flex items-center justify-between">
              <div>
                <h3 className="font-serif text-base font-bold text-stone-900">Account Audit History</h3>
                <p className="text-xs text-stone-500">
                  {historyTargetUser.fullName} ({historyTargetUser.username})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryTargetUser(null)}
                className="text-stone-400 hover:text-stone-700 p-1 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              {isLoadingUserHistory ? (
                <div className="p-8 text-center text-xs text-stone-500">
                  Loading account history...
                </div>
              ) : userHistoryLogs.length === 0 ? (
                <div className="p-8 text-center text-xs text-stone-500">
                  No audit events recorded for this account yet.
                </div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold text-[11px] uppercase">
                      <th className="py-2.5 px-4">Timestamp</th>
                      <th className="py-2.5 px-4">Action</th>
                      <th className="py-2.5 px-4">Actor</th>
                      <th className="py-2.5 px-4">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {userHistoryLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="py-2.5 px-4 font-mono text-[11px] text-stone-500 whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                        <td className="py-2.5 px-4 font-mono font-semibold text-[#4B2E2E] text-[11px]">
                          {log.action}
                        </td>
                        <td className="py-2.5 px-4 text-stone-700">
                          {log.actorUsername || log.actorFullName}
                        </td>
                        <td className="py-2.5 px-4 text-[11px] text-stone-600 break-all">
                          {log.details ? JSON.stringify(log.details) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="p-3.5 bg-[#FAF9F5] border-t border-stone-200 flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setHistoryTargetUser(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: CREATE DEPARTMENT (Super Admin) */}
      {isCreatingDept && isSuperAdmin && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-md bg-white rounded-xl border border-stone-200 shadow-2xl overflow-hidden my-auto p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <h3 className="font-serif text-base font-bold text-stone-900">Create Department</h3>
              <button
                type="button"
                onClick={() => setIsCreatingDept(false)}
                className="text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateDepartment} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-stone-800 mb-1">
                  Department Code <span className="text-rose-700">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. KAYACHIKITSA"
                  value={newDeptForm.code}
                  onChange={(e) => setNewDeptForm({ ...newDeptForm, code: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 uppercase font-mono min-h-[38px]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-800 mb-1">
                  Department Name <span className="text-rose-700">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Department of Kayachikitsa"
                  value={newDeptForm.name}
                  onChange={(e) => setNewDeptForm({ ...newDeptForm, name: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 min-h-[38px]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-800 mb-1">Description</label>
                <textarea
                  rows={2}
                  placeholder="Optional description"
                  value={newDeptForm.description}
                  onChange={(e) => setNewDeptForm({ ...newDeptForm, description: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-200">
                <Button type="button" variant="outline" size="sm" onClick={() => setIsCreatingDept(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" size="sm" isLoading={isDeptSubmitting}>
                  Save Department
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 6: EDIT DEPARTMENT (Super Admin) */}
      {editingDept && isSuperAdmin && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-md bg-white rounded-xl border border-stone-200 shadow-2xl overflow-hidden my-auto p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <div>
                <h3 className="font-serif text-base font-bold text-stone-900">Edit Department</h3>
                <p className="text-xs font-mono text-[#4B2E2E]">{editingDept.code}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingDept(null)}
                className="text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleUpdateDepartment} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-stone-800 mb-1">Department Code</label>
                <input
                  type="text"
                  required
                  value={editDeptForm.code}
                  onChange={(e) => setEditDeptForm({ ...editDeptForm, code: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 font-mono uppercase min-h-[38px]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-800 mb-1">Department Name</label>
                <input
                  type="text"
                  required
                  value={editDeptForm.name}
                  onChange={(e) => setEditDeptForm({ ...editDeptForm, name: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 min-h-[38px]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-800 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={editDeptForm.description}
                  onChange={(e) => setEditDeptForm({ ...editDeptForm, description: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-200">
                <Button type="button" variant="outline" size="sm" onClick={() => setEditingDept(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" size="sm" isLoading={isDeptSubmitting}>
                  Save Changes
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
