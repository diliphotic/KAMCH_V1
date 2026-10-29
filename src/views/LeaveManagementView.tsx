import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Notification } from '../components/ui/Notification';
import {
  Send,
  RefreshCw,
  Calendar,
  Settings,
  Users,
  CheckSquare,
  Square,
  Search,
  Info,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from 'lucide-react';

export interface LeaveApplication {
  id: number;
  teacher_id: number;
  teacher_name?: string;
  teacher_designation?: string;
  department_name?: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  submitted_at: string;
  decided_by: number | null;
  decided_at: string | null;
  decision_remarks: string | null;
}

export interface LeaveSettings {
  maxAdvanceDays: number;
  minAdvanceDays: number;
  today: string;
  minStartDate: string;
  maxStartDate: string;
}

export const formatLeaveDate = (dateStr: string) => {
  if (!dateStr) return '';
  const clean = dateStr.split('T')[0];
  const [y, m, d] = clean.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

export const LeaveManagementView: React.FC = () => {
  const { user, csrfToken } = useAuth();
  const isPrincipal = user?.role === 'PRINCIPAL' || user?.role === 'SUPER_ADMIN';

  const [applications, setApplications] = useState<LeaveApplication[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [notification, setNotification] = useState<{
    type: 'success' | 'warning' | 'info';
    title: string;
    message: string;
  } | null>(null);

  // Leave Settings
  const [leaveSettings, setLeaveSettings] = useState<LeaveSettings | null>(null);
  const [newMaxAdvanceDays, setNewMaxAdvanceDays] = useState<number>(20);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Leave Form states for FACULTY
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');

  // Principal decision remarks map
  const [decisionRemarksMap, setDecisionRemarksMap] = useState<Record<number, string>>({});

  // Principal Notification Composer states
  const [broadcastType, setBroadcastType] = useState<'all' | 'department' | 'single' | 'selected'>('all');
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [targetTeacherId, setTargetTeacherId] = useState<number | null>(null);
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<number[]>([]);
  const [targetDepartmentId, setTargetDepartmentId] = useState<number | null>(null);
  const [teachersList, setTeachersList] = useState<any[]>([]);
  const [departmentsList, setDepartmentsList] = useState<any[]>([]);
  const [teacherSearch, setTeacherSearch] = useState('');
  const [isLoadingRecipients, setIsLoadingRecipients] = useState(false);

  const fetchApplications = useCallback(async () => {
    setIsLoading(true);
    try {
      const endpoint = isPrincipal ? '/api/leave/all-applications' : '/api/leave/my-applications';
      const res = await fetch(endpoint);
      if (res.ok) {
        const data = await res.json();
        setApplications(data.applications || []);
      }
    } catch (err) {
      console.error('Failed to fetch applications:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isPrincipal]);

  const fetchLeaveSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/leave/settings');
      if (res.ok) {
        const data = await res.json();
        setLeaveSettings(data);
        setNewMaxAdvanceDays(data.maxAdvanceDays || 20);
      }
    } catch (err) {
      console.error('Failed to fetch leave settings:', err);
    }
  }, []);

  const fetchRecipients = useCallback(async () => {
    if (!isPrincipal) return;
    setIsLoadingRecipients(true);
    try {
      const [tRes, dRes] = await Promise.all([
        fetch('/api/users/available-teachers'),
        fetch('/api/users/departments'),
      ]);
      if (tRes.ok) {
        const tData = await tRes.json();
        setTeachersList(tData.teachers || []);
      }
      if (dRes.ok) {
        const dData = await dRes.json();
        setDepartmentsList(dData.departments || []);
      }
    } catch (err) {
      console.error('Failed to fetch recipient lists:', err);
    } finally {
      setIsLoadingRecipients(false);
    }
  }, [isPrincipal]);

  useEffect(() => {
    fetchApplications();
    fetchLeaveSettings();
    if (isPrincipal) {
      fetchRecipients();
    }
  }, [fetchApplications, fetchLeaveSettings, fetchRecipients, isPrincipal]);

  // Handle Leave Settings Update
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csrfToken) return;

    if (newMaxAdvanceDays < 1 || newMaxAdvanceDays > 365) {
      setNotification({
        type: 'warning',
        title: 'Invalid Window',
        message: 'Maximum advance window must be between 1 and 365 days.',
      });
      return;
    }

    setIsSavingSettings(true);
    try {
      const res = await fetch('/api/leave/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ maxAdvanceDays: newMaxAdvanceDays }),
      });
      if (res.ok) {
        setNotification({
          type: 'success',
          title: 'Settings Saved',
          message: `Leave advance window updated to ${newMaxAdvanceDays} days.`,
        });
        fetchLeaveSettings();
      } else {
        const data = await res.json();
        setNotification({ type: 'warning', title: 'Error', message: data.error || 'Failed to update settings.' });
      }
    } catch (err) {
      setNotification({ type: 'warning', title: 'Error', message: 'Failed to update leave settings.' });
    } finally {
      setIsSavingSettings(false);
    }
  };

  // Handle Teacher Submit Leave Application
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csrfToken) return;

    if (!startDate || !endDate || !reason.trim()) {
      setNotification({
        type: 'warning',
        title: 'Missing Fields',
        message: 'Please fill in all required fields (Start date, End date, Reason).',
      });
      return;
    }

    if (startDate > endDate) {
      setNotification({
        type: 'warning',
        title: 'Invalid Date Range',
        message: 'Start date cannot be after end date.',
      });
      return;
    }

    if (leaveSettings) {
      if (startDate < leaveSettings.minStartDate) {
        setNotification({
          type: 'warning',
          title: 'Invalid Start Date',
          message: `Leave applications cannot start today or in the past. Earliest allowed start date is ${formatLeaveDate(leaveSettings.minStartDate)}.`,
        });
        return;
      }
      if (startDate > leaveSettings.maxStartDate) {
        setNotification({
          type: 'warning',
          title: 'Advance Limit Exceeded',
          message: `Start date exceeds maximum advance window of ${leaveSettings.maxAdvanceDays} days (${formatLeaveDate(leaveSettings.maxStartDate)}).`,
        });
        return;
      }
    }

    try {
      const res = await fetch('/api/leave/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ startDate, endDate, reason }),
      });
      if (res.ok) {
        setNotification({
          type: 'success',
          title: 'Application Submitted',
          message: 'Leave application submitted successfully for Principal review.',
        });
        setStartDate('');
        setEndDate('');
        setReason('');
        fetchApplications();
      } else {
        const data = await res.json();
        setNotification({ type: 'warning', title: 'Submission Error', message: data.error || 'Failed to submit application' });
      }
    } catch (err) {
      setNotification({ type: 'warning', title: 'Error', message: 'Failed to submit application.' });
    }
  };

  // Handle Principal Decision
  const handleDecision = async (id: number, status: 'APPROVED' | 'REJECTED', defaultRemark: string) => {
    if (!csrfToken) return;
    const remark = decisionRemarksMap[id] || defaultRemark;
    try {
      const res = await fetch(`/api/leave/${id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ status, remarks: remark }),
      });
      if (res.ok) {
        setNotification({
          type: 'success',
          title: 'Decision Recorded',
          message: `Leave application ${status.toLowerCase()} successfully. Notification issued to teacher.`,
        });
        fetchApplications();
      } else {
        const data = await res.json();
        setNotification({ type: 'warning', title: 'Error', message: data.error || 'Failed to record decision.' });
      }
    } catch (err) {
      console.error('Failed to decide:', err);
    }
  };

  // Toggle selection for multi-select teachers
  const toggleTeacherSelection = (teacherId: number) => {
    setSelectedTeacherIds((prev) =>
      prev.includes(teacherId) ? prev.filter((id) => id !== teacherId) : [...prev, teacherId]
    );
  };

  const selectAllFilteredTeachers = () => {
    const filtered = filteredTeachers.map((t) => t.id);
    const allSelected = filtered.every((id) => selectedTeacherIds.includes(id));
    if (allSelected) {
      setSelectedTeacherIds((prev) => prev.filter((id) => !filtered.includes(id)));
    } else {
      setSelectedTeacherIds((prev) => Array.from(new Set([...prev, ...filtered])));
    }
  };

  // Handle Send Broadcast Notification
  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csrfToken) return;

    if (!broadcastTitle.trim() || !broadcastMessage.trim()) {
      setNotification({ type: 'warning', title: 'Missing Fields', message: 'Title and message content are required.' });
      return;
    }

    if (broadcastType === 'single' && !targetTeacherId) {
      setNotification({ type: 'warning', title: 'Selection Required', message: 'Please select a target teacher.' });
      return;
    }

    if (broadcastType === 'selected' && selectedTeacherIds.length === 0) {
      setNotification({ type: 'warning', title: 'Selection Required', message: 'Please select at least one teacher from the list.' });
      return;
    }

    if (broadcastType === 'department' && !targetDepartmentId) {
      setNotification({ type: 'warning', title: 'Selection Required', message: 'Please select a target department.' });
      return;
    }

    const confirmMsg =
      broadcastType === 'all'
        ? 'Send this in-app notification to all linked individual teacher accounts?'
        : broadcastType === 'department'
        ? 'Send this in-app notification to all linked teachers in the selected department?'
        : broadcastType === 'selected'
        ? `Send this in-app notification to the ${selectedTeacherIds.length} selected teacher(s)?`
        : 'Send this in-app notification to the selected teacher?';

    if (!window.confirm(confirmMsg)) return;

    try {
      const payload: any = {
        recipientType: broadcastType,
        title: broadcastTitle,
        message: broadcastMessage,
      };

      if (broadcastType === 'single') payload.recipientTeacherIds = [targetTeacherId];
      if (broadcastType === 'selected') payload.recipientTeacherIds = selectedTeacherIds;
      if (broadcastType === 'department') payload.departmentId = targetDepartmentId;

      const res = await fetch('/api/notifications/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        setNotification({
          type: 'success',
          title: 'Notification Sent',
          message: `Successfully issued in-app notification to ${data.recipientCount} linked teacher account(s).`,
        });
        setBroadcastTitle('');
        setBroadcastMessage('');
        setTargetTeacherId(null);
        setSelectedTeacherIds([]);
      } else {
        const data = await res.json();
        setNotification({ type: 'warning', title: 'Send Error', message: data.error || 'Failed to send notification.' });
      }
    } catch (err) {
      setNotification({ type: 'warning', title: 'Error', message: 'Failed to send broadcast notification.' });
    }
  };

  const filteredTeachers = teachersList.filter((t) => {
    if (!teacherSearch.trim()) return true;
    const term = teacherSearch.toLowerCase();
    return (
      (t.fullName && t.fullName.toLowerCase().includes(term)) ||
      (t.employeeCode && t.employeeCode.toLowerCase().includes(term)) ||
      (t.designation && t.designation.toLowerCase().includes(term)) ||
      (t.departmentName && t.departmentName.toLowerCase().includes(term))
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-stone-900">
            {isPrincipal ? 'Teacher Leave Governance & Notification Center' : 'Teacher Leave Management'}
          </h2>
          <p className="text-xs text-stone-500">
            {isPrincipal
              ? 'Review leave applications, configure application window parameters, and dispatch persistent in-app notifications.'
              : 'Submit leave applications within institutional date windows and track decision status.'}
          </p>
        </div>
      </div>

      {notification && <Notification {...notification} onDismiss={() => setNotification(null)} />}

      {/* Leave Window Settings Card for Principal / Super Admin */}
      {isPrincipal && (
        <Card accentTop>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-[#4B2E2E]" /> Leave Application Window Configuration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveSettings} className="flex flex-col sm:flex-row items-end gap-4">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Maximum Advance Application Days (Default: 20)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={newMaxAdvanceDays}
                    onChange={(e) => setNewMaxAdvanceDays(Number(e.target.value))}
                    required
                    className="w-full p-2 text-xs border rounded-lg font-mono font-bold"
                  />
                </div>
                {leaveSettings && (
                  <p className="text-[11px] text-stone-500 mt-1">
                    Current Window: Minimum 1 day in advance (earliest:{' '}
                    <span className="font-semibold text-stone-800">{formatLeaveDate(leaveSettings.minStartDate)}</span>),
                    Maximum {leaveSettings.maxAdvanceDays} days in advance (latest:{' '}
                    <span className="font-semibold text-stone-800">{formatLeaveDate(leaveSettings.maxStartDate)}</span>).
                  </p>
                )}
              </div>
              <Button type="submit" disabled={isSavingSettings} size="sm" className="whitespace-nowrap">
                {isSavingSettings ? 'Saving...' : 'Update Advance Limit'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Faculty Leave Application Form */}
      {!isPrincipal && (
        <Card accentTop>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#4B2E2E]" /> Submit Leave Application
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {leaveSettings && (
              <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-start gap-2">
                <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">Institutional Advance Leave Policy:</span>
                  Leave applications must be submitted at least 1 day in advance (start date cannot be today or in the past).
                  Maximum advance window is <strong>{leaveSettings.maxAdvanceDays} days</strong>.
                  Allowed start date window: <strong>{formatLeaveDate(leaveSettings.minStartDate)}</strong> to{' '}
                  <strong>{formatLeaveDate(leaveSettings.maxStartDate)}</strong>.
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Start Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    min={leaveSettings?.minStartDate || ''}
                    max={leaveSettings?.maxStartDate || ''}
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    required
                    className="w-full p-2 text-xs border rounded-lg bg-white"
                  />
                  {startDate && <p className="text-[11px] text-stone-500 mt-1">Formatted: {formatLeaveDate(startDate)}</p>}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    End Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    min={startDate || leaveSettings?.minStartDate || ''}
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    required
                    className="w-full p-2 text-xs border rounded-lg bg-white"
                  />
                  {endDate && <p className="text-[11px] text-stone-500 mt-1">Formatted: {formatLeaveDate(endDate)}</p>}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Mandatory Reason for Leave <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="Provide detailed institutional reason for leave..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  className="w-full p-2 text-xs border rounded-lg"
                />
              </div>

              <div className="flex justify-end">
                <Button type="submit" className="flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5" /> Submit Leave Application
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Principal Personal Notification Composer */}
      {isPrincipal && (
        <Card accentTop>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="w-4 h-4 text-[#4B2E2E]" /> Personal Notification Composer
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSendBroadcast} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">Recipient Scope</label>
                  <select
                    value={broadcastType}
                    onChange={(e) => {
                      setBroadcastType(e.target.value as any);
                      setSelectedTeacherIds([]);
                      setTargetTeacherId(null);
                      setTargetDepartmentId(null);
                    }}
                    className="w-full p-2 text-xs border rounded-lg bg-white font-semibold"
                  >
                    <option value="all">All Linked Individual Teachers</option>
                    <option value="department">Specific Department</option>
                    <option value="single">Single Teacher</option>
                    <option value="selected">Selected Teachers (Multi-Select)</option>
                  </select>
                </div>

                {broadcastType === 'department' && (
                  <div>
                    <label className="block text-xs font-semibold text-stone-700 mb-1">Select Department</label>
                    <select
                      value={targetDepartmentId || ''}
                      onChange={(e) => setTargetDepartmentId(Number(e.target.value))}
                      className="w-full p-2 text-xs border rounded-lg bg-white"
                      required
                    >
                      <option value="">-- Choose Department --</option>
                      {departmentsList.map((d: any) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.code})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {broadcastType === 'single' && (
                  <div>
                    <label className="block text-xs font-semibold text-stone-700 mb-1">Select Teacher</label>
                    <select
                      value={targetTeacherId || ''}
                      onChange={(e) => setTargetTeacherId(Number(e.target.value))}
                      className="w-full p-2 text-xs border rounded-lg bg-white"
                      required
                    >
                      <option value="">-- Choose Teacher --</option>
                      {teachersList.map((t: any) => (
                        <option key={t.id} value={t.id}>
                          {t.fullName || t.full_name} ({t.designation || 'Faculty'}{' '}
                          {t.departmentName ? `· ${t.departmentName}` : ''})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Multi-Select Teachers Grid */}
              {broadcastType === 'selected' && (
                <div className="p-3 border rounded-lg bg-stone-50/50 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-stone-800">Select Target Teachers</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#4B2E2E] text-white font-mono font-bold">
                        {selectedTeacherIds.length} Selected
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="relative flex-1 sm:w-48">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-stone-400" />
                        <input
                          type="text"
                          placeholder="Search teachers..."
                          value={teacherSearch}
                          onChange={(e) => setTeacherSearch(e.target.value)}
                          className="w-full pl-8 pr-2 py-1.5 text-xs border rounded-md bg-white"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={selectAllFilteredTeachers}
                        className="text-xs py-1"
                      >
                        Select All Filtered
                      </Button>
                    </div>
                  </div>

                  {isLoadingRecipients ? (
                    <div className="py-6 flex justify-center">
                      <RefreshCw className="animate-spin w-4 h-4 text-stone-500" />
                    </div>
                  ) : filteredTeachers.length === 0 ? (
                    <div className="py-6 text-center text-xs text-stone-500">
                      No active linked teachers match your search.
                    </div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2 pr-1">
                      {filteredTeachers.map((t) => {
                        const isSelected = selectedTeacherIds.includes(t.id);
                        return (
                          <div
                            key={t.id}
                            onClick={() => toggleTeacherSelection(t.id)}
                            className={`p-2 rounded-lg border text-xs cursor-pointer flex items-center justify-between transition-colors ${
                              isSelected
                                ? 'bg-amber-50 border-amber-300 text-stone-900 font-semibold'
                                : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-100'
                            }`}
                          >
                            <div className="truncate pr-2">
                              <div className="truncate font-semibold">{t.fullName || t.full_name}</div>
                              <div className="text-[10px] text-stone-500 truncate">
                                {t.employeeCode ? `${t.employeeCode} · ` : ''}
                                {t.designation} {t.departmentName ? `(${t.departmentName})` : ''}
                              </div>
                            </div>
                            <div>
                              {isSelected ? (
                                <CheckSquare className="w-4 h-4 text-[#4B2E2E] shrink-0" />
                              ) : (
                                <Square className="w-4 h-4 text-stone-400 shrink-0" />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Notification Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Important Faculty Meeting / Schedule Update"
                  value={broadcastTitle}
                  onChange={(e) => setBroadcastTitle(e.target.value)}
                  required
                  className="w-full p-2 text-xs border rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Message Content <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={3}
                  placeholder="Enter detailed message to send..."
                  value={broadcastMessage}
                  onChange={(e) => setBroadcastMessage(e.target.value)}
                  required
                  className="w-full p-2 text-xs border rounded-lg"
                />
              </div>

              <div className="flex justify-end">
                <Button type="submit" className="flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5" /> Dispatch Notification
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Leave Applications Review List */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <CardTitle>{isPrincipal ? 'Leave Applications Review' : 'My Leave Applications'}</CardTitle>
          <Button size="sm" variant="outline" onClick={fetchApplications} className="flex items-center gap-1">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh List
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 flex justify-center">
              <RefreshCw className="animate-spin w-5 h-5 text-stone-500" />
            </div>
          ) : applications.length === 0 ? (
            <div className="py-12 text-center text-xs text-stone-500">No leave applications found.</div>
          ) : (
            <div className="space-y-4">
              {applications.map((app) => (
                <div key={app.id} className="p-4 rounded-xl border border-stone-200 bg-white shadow-xs space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-100 pb-3">
                    <div className="space-y-0.5">
                      {isPrincipal && (
                        <div className="font-bold text-stone-900 text-sm flex flex-wrap items-center gap-2">
                          <span>{app.teacher_name}</span>
                          {app.teacher_designation && (
                            <span className="text-xs font-normal text-stone-600">({app.teacher_designation})</span>
                          )}
                          {app.department_name && (
                            <span className="text-[11px] px-2 py-0.5 rounded bg-stone-100 text-stone-600 font-semibold">
                              {app.department_name}
                            </span>
                          )}
                        </div>
                      )}
                      <div className="text-xs font-semibold text-stone-700 flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-stone-500" />
                        <span>
                          Requested Dates:{' '}
                          <strong className="text-stone-900 font-mono">
                            {formatLeaveDate(app.start_date)} to {formatLeaveDate(app.end_date)}
                          </strong>
                        </span>
                      </div>
                    </div>

                    <div>
                      <span
                        className={`inline-flex px-2.5 py-1 rounded-full font-bold text-xs ${
                          app.status === 'APPROVED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : app.status === 'REJECTED'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {app.status}
                      </span>
                    </div>
                  </div>

                  <div className="bg-stone-50 p-3 rounded-lg border border-stone-100 space-y-1">
                    <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block">
                      Reason for Leave
                    </span>
                    <p className="text-xs text-stone-800 whitespace-pre-wrap">{app.reason}</p>
                  </div>

                  {app.decision_remarks && (
                    <div className="text-xs text-stone-700 bg-amber-50/70 p-2.5 rounded-lg border border-amber-200">
                      <strong>Decision Remarks:</strong> {app.decision_remarks}
                    </div>
                  )}

                  {isPrincipal && app.status === 'PENDING' && (
                    <div className="pt-2 border-t border-stone-100 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <input
                        type="text"
                        placeholder="Enter decision remarks (optional)..."
                        value={decisionRemarksMap[app.id] || ''}
                        onChange={(e) =>
                          setDecisionRemarksMap({ ...decisionRemarksMap, [app.id]: e.target.value })
                        }
                        className="flex-1 p-2 text-xs border rounded-lg"
                      />
                      <div className="flex items-center gap-2 justify-end">
                        <Button
                          size="sm"
                          onClick={() =>
                            handleDecision(app.id, 'APPROVED', decisionRemarksMap[app.id] || 'Approved by Principal')
                          }
                          className="bg-emerald-700 hover:bg-emerald-800 text-white text-xs px-4"
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            handleDecision(app.id, 'REJECTED', decisionRemarksMap[app.id] || 'Rejected by Principal')
                          }
                          className="text-red-700 border-red-200 hover:bg-red-50 text-xs px-4"
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
