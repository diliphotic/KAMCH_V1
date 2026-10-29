import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Notification } from '../components/ui/Notification';
import { Badge } from '../components/ui/Badge';
import {
  Save,
  CheckCircle,
  AlertTriangle,
  Upload,
  RefreshCw,
  FileSpreadsheet,
  Bell,
  Calendar as CalendarIcon,
  Plus,
  Trash2,
  Info,
  Check,
  AlertCircle,
} from 'lucide-react';

export interface CalendarHoliday {
  date: string;
  name: string;
  isSunday: boolean;
}

export interface WorkingDaysCalendar {
  year: number;
  month: number;
  daysInMonth: number;
  sundaysCount: number;
  additionalHolidaysCount: number;
  workingDays: number;
  holidays: CalendarHoliday[];
}

export interface AttendanceReportRow {
  id: number | null;
  teacher_id: number;
  teacher_name: string;
  employee_code: string | null;
  designation: string;
  department_name: string | null;
  total_working_days: number;
  days_present: number;
  attendance_percentage: number;
  approved_leave_days: number;
  provisional_days_present: number;
  provisional_percentage: number;
  has_conflict: boolean;
  status: 'PENDING' | 'FINALIZED';
  finalized_by?: number | null;
  finalized_at: string | null;
}

const MONTHS = [
  { value: 1, name: 'January' }, { value: 2, name: 'February' }, { value: 3, name: 'March' },
  { value: 4, name: 'April' }, { value: 5, name: 'May' }, { value: 6, name: 'June' },
  { value: 7, name: 'July' }, { value: 8, name: 'August' }, { value: 9, name: 'September' },
  { value: 10, name: 'October' }, { value: 11, name: 'November' }, { value: 12, name: 'December' },
];

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const AttendanceManagementView: React.FC = () => {
  const { user, csrfToken } = useAuth();
  const isPrincipal = user?.role === 'PRINCIPAL' || user?.role === 'SUPER_ADMIN' || user?.role === 'SECRETARY';

  const [year, setYear] = useState<number>(2026);
  const [month, setMonth] = useState<number>(11);

  // Calendar & Working Days calculation state
  const [calendarData, setCalendarData] = useState<WorkingDaysCalendar | null>(null);
  const [needsRefinalization, setNeedsRefinalization] = useState(false);

  // Modal / Form state for marking holidays
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  const [holidayNameInput, setHolidayNameInput] = useState('');
  const [holidayDescInput, setHolidayDescInput] = useState('');
  const [isSavingHoliday, setIsSavingHoliday] = useState(false);

  // Attendance reports & draft days
  const [reports, setReports] = useState<AttendanceReportRow[]>([]);
  const [editedDays, setEditedDays] = useState<Record<number, number>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'warning' | 'info'; title: string; message: string } | null>(null);

  // Sub-tab navigation
  const [activeSubTab, setActiveSubTab] = useState<'calendar' | 'entry' | 'import' | 'low_attendance'>('entry');

  // CSV Import state
  const [csvText, setCsvText] = useState('');
  const [importErrors, setImportErrors] = useState<string[]>([]);

  // Low attendance alert threshold
  const [alertThreshold, setAlertThreshold] = useState<number>(75);
  const [alertMessage, setAlertMessage] = useState<string>('Please submit an explanation for low monthly attendance.');

  // Teacher self-view state
  const [myReports, setMyReports] = useState<any[]>([]);

  const fetchReports = useCallback(async () => {
    if (!isPrincipal) {
      setIsLoading(true);
      try {
        const res = await fetch('/api/attendance/my-reports');
        if (res.ok) {
          const data = await res.json();
          setMyReports(data.reports || []);
        }
      } catch (err) {
        console.error('Failed to fetch my attendance reports:', err);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`/api/attendance/reports?year=${year}&month=${month}`);
      if (res.ok) {
        const data = await res.json();
        setCalendarData(data.calendar || null);
        setNeedsRefinalization(Boolean(data.needsRefinalization));

        const fetchedRows: AttendanceReportRow[] = data.reports || [];
        setReports(fetchedRows);

        const initialDays: Record<number, number> = {};
        for (const r of fetchedRows) {
          initialDays[r.teacher_id] = r.days_present;
        }
        setEditedDays(initialDays);
      }
    } catch (err) {
      console.error('Failed to fetch attendance reports:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isPrincipal, year, month]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const handleDayChange = (teacherId: number, days: number) => {
    setEditedDays((prev) => ({ ...prev, [teacherId]: days }));
  };

  const applyProvisionalToTeacher = (teacherId: number, provDays: number) => {
    setEditedDays((prev) => ({ ...prev, [teacherId]: provDays }));
  };

  const applyProvisionalToAll = () => {
    const updated: Record<number, number> = { ...editedDays };
    for (const r of reports) {
      updated[r.teacher_id] = r.provisional_days_present;
    }
    setEditedDays(updated);
    setNotification({
      type: 'info',
      title: 'Provisional Sync',
      message: 'Applied calculated provisional days present (working days minus approved leave) to all teachers.',
    });
  };

  // Add / Update Holiday
  const handleSaveHoliday = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!csrfToken || !selectedCalendarDate || !holidayNameInput.trim()) return;

    setIsSavingHoliday(true);
    try {
      const res = await fetch('/api/attendance/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({
          holidayDate: selectedCalendarDate,
          holidayName: holidayNameInput.trim(),
          description: holidayDescInput.trim() || null,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setNotification({
          type: 'success',
          title: 'Holiday Saved',
          message: `Holiday '${holidayNameInput}' set for ${selectedCalendarDate}. Total working days recalculated to ${data.workingDays}.`,
        });
        setSelectedCalendarDate(null);
        setHolidayNameInput('');
        setHolidayDescInput('');
        fetchReports();
      } else {
        const data = await res.json();
        setNotification({ type: 'warning', title: 'Holiday Error', message: data.error || 'Failed to save holiday.' });
      }
    } catch (err) {
      setNotification({ type: 'warning', title: 'Error', message: 'Failed to save holiday.' });
    } finally {
      setIsSavingHoliday(false);
    }
  };

  // Delete Holiday
  const handleDeleteHoliday = async (dateStr: string) => {
    if (!csrfToken) return;
    if (!window.confirm(`Remove holiday on ${dateStr}?`)) return;

    try {
      const res = await fetch(`/api/attendance/holidays/${dateStr}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': csrfToken },
      });

      if (res.ok) {
        const data = await res.json();
        setNotification({
          type: 'success',
          title: 'Holiday Removed',
          message: `Holiday on ${dateStr} removed. Total working days recalculated to ${data.workingDays}.`,
        });
        setSelectedCalendarDate(null);
        fetchReports();
      } else {
        const data = await res.json();
        setNotification({ type: 'warning', title: 'Error', message: data.error || 'Failed to remove holiday.' });
      }
    } catch (err) {
      setNotification({ type: 'warning', title: 'Error', message: 'Failed to remove holiday.' });
    }
  };

  // Save Manual Draft Entry
  const handleSaveEntry = async () => {
    if (!csrfToken || !calendarData) return;

    if (calendarData.workingDays <= 0) {
      setNotification({ type: 'warning', title: 'Invalid Days', message: 'Total working days must be greater than 0.' });
      return;
    }

    const entries = Object.entries(editedDays).map(([tid, days]) => ({
      teacherId: Number(tid),
      daysPresent: Number(days),
    }));

    try {
      const res = await fetch('/api/attendance/entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({
          year,
          month,
          totalWorkingDays: calendarData.workingDays,
          entries,
        }),
      });

      if (res.ok) {
        setNotification({ type: 'success', title: 'Saved', message: 'Attendance entries saved successfully.' });
        fetchReports();
      } else {
        const data = await res.json();
        setNotification({ type: 'warning', title: 'Error', message: data.error || 'Failed to save entries.' });
      }
    } catch (err) {
      setNotification({ type: 'warning', title: 'Error', message: 'Failed to save attendance entries.' });
    }
  };

  // Finalize / Re-Finalize Report
  const handleFinalizeReport = async () => {
    if (!csrfToken) return;

    const monthName = MONTHS.find((m) => m.value === month)?.name;
    const isRefinalize = reports.length > 0 && reports.every((r) => r.status === 'FINALIZED');

    const promptText = isRefinalize
      ? `Re-finalize the attendance report for ${monthName} ${year}? This will update the finalized metrics and refresh existing in-app notifications without creating duplicates.`
      : `Finalize the attendance report for ${monthName} ${year}? This will issue persistent notifications to all linked teachers.`;

    if (!window.confirm(promptText)) return;

    try {
      const res = await fetch('/api/attendance/reports/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ year, month }),
      });

      if (res.ok) {
        const data = await res.json();
        setNotification({
          type: 'success',
          title: isRefinalize ? 'Re-Finalized' : 'Finalized',
          message: `Attendance report for ${monthName} ${year} finalized successfully. Updated ${data.notificationsSent} in-app notifications.`,
        });
        fetchReports();
      } else {
        const data = await res.json();
        setNotification({ type: 'warning', title: 'Error', message: data.error || 'Failed to finalize report.' });
      }
    } catch (err) {
      setNotification({ type: 'warning', title: 'Error', message: 'Failed to finalize report.' });
    }
  };

  // CSV Import
  const handleCsvImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csrfToken || !calendarData) return;
    setImportErrors([]);

    try {
      const res = await fetch('/api/attendance/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({
          year,
          month,
          totalWorkingDays: calendarData.workingDays,
          csvText,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setNotification({ type: 'success', title: 'Import Successful', message: `Successfully imported ${data.count} attendance records.` });
        setCsvText('');
        setActiveSubTab('entry');
        fetchReports();
      } else {
        const data = await res.json();
        if (data.errors) {
          setImportErrors(data.errors);
        } else {
          setNotification({ type: 'warning', title: 'Import Failed', message: data.error });
        }
      }
    } catch (err) {
      setNotification({ type: 'warning', title: 'Error', message: 'Failed to import CSV data.' });
    }
  };

  const handleSendLowAttendanceAlert = async (teacherId: number) => {
    if (!csrfToken) return;
    try {
      const res = await fetch('/api/attendance/low-attendance-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({
          teacherId,
          year,
          month,
          threshold: alertThreshold,
          customMessage: alertMessage,
        }),
      });

      if (res.ok) {
        setNotification({ type: 'success', title: 'Alert Sent', message: 'Low-attendance notice sent to teacher account.' });
      } else {
        const data = await res.json();
        setNotification({ type: 'warning', title: 'Failed', message: data.error });
      }
    } catch (err) {
      setNotification({ type: 'warning', title: 'Error', message: 'Failed to send alert.' });
    }
  };

  // Percentage badge color helper
  const getPercentageBadge = (pct: number) => {
    if (pct >= 85) return <Badge variant="success" size="sm">{pct.toFixed(2)}%</Badge>;
    if (pct >= 75) return <Badge variant="gold" size="sm">{pct.toFixed(2)}%</Badge>;
    return <Badge variant="warning" size="sm">{pct.toFixed(2)}%</Badge>;
  };

  // Render teacher self-view
  if (!isPrincipal) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-stone-900">My Monthly Attendance Reports</h2>
        {notification && <Notification {...notification} onDismiss={() => setNotification(null)} />}

        <Card accentTop>
          <CardHeader><CardTitle>Finalized Attendance Summary</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-8 flex justify-center"><RefreshCw className="animate-spin w-5 h-5 text-stone-500" /></div>
            ) : myReports.length === 0 ? (
              <div className="py-12 text-center text-xs text-stone-500">No finalized monthly attendance reports available yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 uppercase tracking-wider">
                      <th className="p-3">Period</th>
                      <th className="p-3">Days Present</th>
                      <th className="p-3">Working Days</th>
                      <th className="p-3">Attendance %</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Finalized Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {myReports.map((r: any) => (
                      <tr key={r.id} className="hover:bg-stone-50">
                        <td className="p-3 font-semibold text-stone-900">{r.month_name} {r.year}</td>
                        <td className="p-3 font-mono text-stone-800">{r.days_present}</td>
                        <td className="p-3 font-mono text-stone-500">{r.total_working_days}</td>
                        <td className="p-3">{getPercentageBadge(r.attendance_percentage)}</td>
                        <td className="p-3"><Badge variant="success" size="sm">FINALIZED</Badge></td>
                        <td className="p-3 font-mono text-stone-400">
                          {r.finalized_at ? new Date(r.finalized_at).toLocaleDateString() : 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Generate Calendar Grid Days
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay(); // 0 = Sun
  const holidayMap = new Map<string, CalendarHoliday>();
  if (calendarData && calendarData.holidays) {
    for (const h of calendarData.holidays) {
      holidayMap.set(h.date, h);
    }
  }

  const calendarGridCells: Array<{ dayNum: number | null; dateStr: string | null; isSunday: boolean; holiday: CalendarHoliday | null }> = [];
  for (let i = 0; i < firstDayOfWeek; i++) {
    calendarGridCells.push({ dayNum: null, dateStr: null, isSunday: false, holiday: null });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dt = new Date(year, month - 1, d);
    const isSun = dt.getDay() === 0;
    const h = holidayMap.get(dStr) || null;
    calendarGridCells.push({ dayNum: d, dateStr: dStr, isSunday: isSun, holiday: h });
  }

  const isCurrentMonthFinalized = reports.length > 0 && reports.every((r) => r.status === 'FINALIZED');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-stone-900">Monthly Teacher Attendance Reports</h2>
          <p className="text-xs text-stone-500">
            Institutional attendance management &amp; working-day calendar calculation governance.
          </p>
        </div>
      </div>

      {notification && <Notification {...notification} onDismiss={() => setNotification(null)} />}

      {/* Period Selection Bar */}
      <Card accentTop>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">Select Year</label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-full p-2 text-xs border rounded-lg bg-white font-semibold"
              >
                <option value={2026}>2026</option>
                <option value={2025}>2025</option>
                <option value={2027}>2027</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">Select Month</label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="w-full p-2 text-xs border rounded-lg bg-white font-semibold"
              >
                {MONTHS.map((m) => (
                  <option key={m.value} value={m.value}>{m.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">Working Days (Calculated)</label>
              <div className="p-2 text-xs border rounded-lg bg-stone-100 font-mono font-bold text-[#4B2E2E] flex items-center justify-between">
                <span>{calendarData ? `${calendarData.workingDays} Days` : 'Calculating...'}</span>
                <span className="text-[10px] text-stone-500 font-normal">Auto-derived</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" onClick={fetchReports} variant="outline" className="w-full flex items-center justify-center gap-1 text-xs">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Working Days Breakdown Cards */}
      {calendarData && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 bg-white border border-stone-200 rounded-xl shadow-xs">
            <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block">Total Days in Month</span>
            <div className="text-lg font-bold font-mono text-stone-900">{calendarData.daysInMonth}</div>
          </div>
          <div className="p-3 bg-white border border-stone-200 rounded-xl shadow-xs">
            <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block">Sundays (Non-Working)</span>
            <div className="text-lg font-bold font-mono text-amber-700">{calendarData.sundaysCount}</div>
          </div>
          <div className="p-3 bg-white border border-stone-200 rounded-xl shadow-xs">
            <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block">Non-Sunday Holidays</span>
            <div className="text-lg font-bold font-mono text-purple-700">{calendarData.additionalHolidaysCount}</div>
          </div>
          <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl shadow-xs">
            <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider block">Calculated Working Days</span>
            <div className="text-lg font-bold font-mono text-[#4B2E2E]">{calendarData.workingDays}</div>
          </div>
        </div>
      )}

      {needsRefinalization && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Re-Finalization Notice:</strong> The calendar holidays or working days count has been updated since this month was finalized. Re-finalize to update finalized records and notifications.
            </span>
          </div>
          <Button size="sm" onClick={handleFinalizeReport} className="bg-amber-700 hover:bg-amber-800 text-white whitespace-nowrap">
            Re-Finalize Now
          </Button>
        </div>
      )}

      {/* Sub-Tab Navigation */}
      <div className="flex border-b border-stone-200 gap-4 text-xs font-semibold">
        <button
          type="button"
          onClick={() => setActiveSubTab('entry')}
          className={`pb-2 transition-colors cursor-pointer ${
            activeSubTab === 'entry' ? 'border-b-2 border-[#4B2E2E] text-[#4B2E2E]' : 'text-stone-500 hover:text-stone-800'
          }`}
        >
          Attendance Entry &amp; Conflict Review
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('calendar')}
          className={`pb-2 transition-colors cursor-pointer ${
            activeSubTab === 'calendar' ? 'border-b-2 border-[#4B2E2E] text-[#4B2E2E]' : 'text-stone-500 hover:text-stone-800'
          }`}
        >
          Holiday Calendar Management
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('import')}
          className={`pb-2 transition-colors cursor-pointer ${
            activeSubTab === 'import' ? 'border-b-2 border-[#4B2E2E] text-[#4B2E2E]' : 'text-stone-500 hover:text-stone-800'
          }`}
        >
          Spreadsheet Import (CSV)
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('low_attendance')}
          className={`pb-2 transition-colors cursor-pointer ${
            activeSubTab === 'low_attendance' ? 'border-b-2 border-[#4B2E2E] text-[#4B2E2E]' : 'text-stone-500 hover:text-stone-800'
          }`}
        >
          Low-Attendance Alerts
        </button>
      </div>

      {/* 1. CALENDAR MANAGEMENT SUB-TAB */}
      {activeSubTab === 'calendar' && (
        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-[#4B2E2E]" /> Monthly Holiday Calendar — {MONTHS.find((m) => m.value === month)?.name} {year}
            </CardTitle>
            <p className="text-xs text-stone-500">Click any date to mark/unmark an institutional holiday.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Calendar Days Grid */}
            <div className="grid grid-cols-7 gap-1 bg-stone-200 p-1.5 rounded-xl text-center">
              {DAYS_OF_WEEK.map((dayName, idx) => (
                <div key={dayName} className={`py-1.5 text-xs font-bold ${idx === 0 ? 'text-amber-800 bg-amber-100/60 rounded' : 'text-stone-700'}`}>
                  {dayName}
                </div>
              ))}

              {calendarGridCells.map((cell, idx) => {
                if (!cell.dayNum || !cell.dateStr) {
                  return <div key={`empty-${idx}`} className="bg-stone-50 min-h-[64px] rounded-lg" />;
                }

                const isSunday = cell.isSunday;
                const hasHoliday = Boolean(cell.holiday);
                const isSelected = selectedCalendarDate === cell.dateStr;

                return (
                  <div
                    key={cell.dateStr}
                    onClick={() => {
                      setSelectedCalendarDate(cell.dateStr);
                      setHolidayNameInput(cell.holiday ? cell.holiday.name.replace(' (Sunday)', '') : '');
                    }}
                    className={`min-h-[64px] p-1.5 rounded-lg border text-left cursor-pointer transition-all flex flex-col justify-between ${
                      isSelected
                        ? 'ring-2 ring-[#4B2E2E] bg-amber-50 border-amber-300'
                        : isSunday
                        ? 'bg-amber-50/50 border-amber-200 hover:bg-amber-100/60'
                        : hasHoliday
                        ? 'bg-purple-50 border-purple-200 hover:bg-purple-100/70'
                        : 'bg-white border-stone-200 hover:border-stone-400'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-bold font-mono ${isSunday ? 'text-amber-800' : 'text-stone-900'}`}>
                        {cell.dayNum}
                      </span>
                      {isSunday && <span className="text-[9px] font-semibold text-amber-700">SUN</span>}
                    </div>

                    <div className="mt-1">
                      {isSunday && !hasHoliday && (
                        <span className="text-[9px] text-amber-800 font-semibold block leading-tight">Sunday</span>
                      )}
                      {hasHoliday && (
                        <span className="text-[9px] font-bold text-purple-900 bg-purple-100 px-1 py-0.5 rounded block truncate">
                          {cell.holiday!.name}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Selected Date Holiday Editor Drawer / Modal */}
            {selectedCalendarDate && (
              <div className="p-4 bg-stone-50 border border-stone-300 rounded-xl space-y-3">
                <div className="flex items-center justify-between border-b pb-2">
                  <div className="font-bold text-xs text-stone-900 flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4 text-[#4B2E2E]" />
                    <span>Manage Holiday for {selectedCalendarDate}</span>
                    {new Date(selectedCalendarDate).getDay() === 0 && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">
                        Sunday (Already Non-Working)
                      </span>
                    )}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setSelectedCalendarDate(null)} className="text-xs py-0.5">
                    Cancel
                  </Button>
                </div>

                <form onSubmit={handleSaveHoliday} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-stone-700 mb-1">
                      Holiday Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Gandhi Jayanti / Deepavali / Institutional Holiday"
                      value={holidayNameInput}
                      onChange={(e) => setHolidayNameInput(e.target.value)}
                      required
                      className="w-full p-2 text-xs border rounded-lg bg-white"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Button type="submit" disabled={isSavingHoliday} size="sm" className="w-full">
                      {isSavingHoliday ? 'Saving...' : 'Save Holiday'}
                    </Button>
                    {holidayMap.has(selectedCalendarDate) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeleteHoliday(selectedCalendarDate)}
                        className="text-red-700 border-red-200 hover:bg-red-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </form>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 2. MANUAL ENTRY & CONFLICT REVIEW SUB-TAB */}
      {activeSubTab === 'entry' && (
        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle>
                Teacher Records — {MONTHS.find((m) => m.value === month)?.name} {year}
              </CardTitle>
              <p className="text-xs text-stone-500">
                Provisional days present formula: <code className="bg-stone-100 px-1 py-0.5 rounded">Working Days ({calendarData?.workingDays}) - Approved Leave Days</code>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={applyProvisionalToAll} className="flex items-center gap-1.5 text-xs">
                <Check className="w-3.5 h-3.5" /> Apply Provisional to All
              </Button>
              <Button size="sm" onClick={handleSaveEntry} className="flex items-center gap-1.5 text-xs">
                <Save className="w-3.5 h-3.5" /> Save Drafts
              </Button>
              <Button
                size="sm"
                onClick={handleFinalizeReport}
                className="bg-emerald-700 hover:bg-emerald-800 text-white flex items-center gap-1.5 text-xs"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                {isCurrentMonthFinalized ? 'Re-Finalize & Update Notifications' : 'Finalize & Issue Notifications'}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-12 flex justify-center"><RefreshCw className="animate-spin w-5 h-5 text-stone-500" /></div>
            ) : reports.length === 0 ? (
              <div className="py-12 text-center text-xs text-stone-500">No active teachers found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 uppercase tracking-wider">
                      <th className="p-3">Teacher</th>
                      <th className="p-3">Code / Designation</th>
                      <th className="p-3">Approved Leave</th>
                      <th className="p-3">Provisional Present</th>
                      <th className="p-3">Days Present (Draft/Saved)</th>
                      <th className="p-3">Attendance %</th>
                      <th className="p-3">Conflict Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {reports.map((r) => {
                      const days = editedDays[r.teacher_id] !== undefined ? editedDays[r.teacher_id] : r.days_present;
                      const workingDays = calendarData ? calendarData.workingDays : r.total_working_days;
                      const calculatedPct = workingDays > 0 ? Math.round(((days / workingDays) * 100) * 100) / 100 : 0;
                      const hasConflict = days !== r.provisional_days_present;

                      return (
                        <tr key={r.teacher_id} className={`hover:bg-stone-50 ${hasConflict ? 'bg-amber-50/30' : ''}`}>
                          <td className="p-3">
                            <div className="font-semibold text-stone-900">{r.teacher_name}</div>
                            <div className="text-[10px] text-stone-400">{r.department_name || 'General Faculty'}</div>
                          </td>

                          <td className="p-3 text-stone-600 font-mono">
                            {r.employee_code || 'N/A'} · {r.designation}
                          </td>

                          <td className="p-3 font-mono font-semibold text-amber-800">
                            {r.approved_leave_days} days
                          </td>

                          <td className="p-3">
                            <div className="font-mono font-bold text-stone-800">{r.provisional_days_present} days</div>
                            <div className="text-[10px] text-stone-400">Formula: {workingDays} - {r.approved_leave_days}</div>
                          </td>

                          <td className="p-3">
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min={0}
                                max={workingDays}
                                value={days}
                                onChange={(e) => handleDayChange(r.teacher_id, Number(e.target.value))}
                                className="w-20 p-1.5 text-xs border rounded font-mono font-bold text-stone-900 bg-white"
                              />
                              {hasConflict && (
                                <button
                                  type="button"
                                  title="Sync to calculated provisional days present"
                                  onClick={() => applyProvisionalToTeacher(r.teacher_id, r.provisional_days_present)}
                                  className="text-[10px] text-amber-800 hover:text-amber-900 underline font-semibold"
                                >
                                  Use Provisional ({r.provisional_days_present})
                                </button>
                              )}
                            </div>
                          </td>

                          <td className="p-3">{getPercentageBadge(calculatedPct)}</td>

                          <td className="p-3">
                            {hasConflict ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold text-[10px] bg-amber-100 text-amber-800">
                                <AlertCircle className="w-3 h-3 text-amber-700" /> Manual Override
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold text-[10px] bg-emerald-100 text-emerald-800">
                                <Check className="w-3 h-3 text-emerald-700" /> Synced
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
      )}

      {/* 3. CSV SPREADSHEET IMPORT SUB-TAB */}
      {activeSubTab === 'import' && (
        <Card>
          <CardHeader><CardTitle>Spreadsheet CSV Attendance Import</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3 bg-stone-50 border border-stone-200 rounded-lg text-xs text-stone-700 space-y-1">
              <div className="font-semibold text-[#4B2E2E] flex items-center gap-1">
                <FileSpreadsheet className="w-4 h-4" /> CSV Formatting Rules:
              </div>
              <p>Header row: <code className="bg-stone-200 px-1 py-0.5 rounded font-mono">employee_code,days_present</code></p>
              <p>Example rows: <code className="bg-stone-200 px-1 py-0.5 rounded font-mono">EMP101, 24</code> or <code className="bg-stone-200 px-1 py-0.5 rounded font-mono">ID:101, 26</code></p>
            </div>

            {importErrors.length > 0 && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 space-y-1">
                <div className="font-bold flex items-center gap-1"><AlertTriangle className="w-4 h-4 text-red-600" /> Validation Errors:</div>
                <ul className="list-disc pl-5 space-y-0.5 font-mono text-[11px]">
                  {importErrors.map((err, idx) => (
                    <li key={idx}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            <form onSubmit={handleCsvImport} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Paste CSV Data</label>
                <textarea
                  rows={8}
                  placeholder={`employee_code,days_present\nEMP101,24\nEMP102,26`}
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  className="w-full p-2.5 text-xs font-mono border rounded-lg bg-stone-50/50"
                  required
                />
              </div>

              <div className="flex justify-end">
                <Button type="submit" className="flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5" /> Validate &amp; Save Import
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* 4. LOW ATTENDANCE ALERTS SUB-TAB */}
      {activeSubTab === 'low_attendance' && (
        <Card>
          <CardHeader><CardTitle>Low-Attendance Alerts Panel</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Target Threshold (%)</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={alertThreshold}
                  onChange={(e) => setAlertThreshold(Number(e.target.value))}
                  className="w-full p-2 text-xs border rounded-lg font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Notice Custom Remarks</label>
                <input
                  type="text"
                  value={alertMessage}
                  onChange={(e) => setAlertMessage(e.target.value)}
                  className="w-full p-2 text-xs border rounded-lg"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500 uppercase tracking-wider">
                    <th className="p-3">Teacher</th>
                    <th className="p-3">Days Present</th>
                    <th className="p-3">Attendance %</th>
                    <th className="p-3">Threshold Status</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {reports
                    .filter((r) => r.attendance_percentage < alertThreshold)
                    .map((r) => (
                      <tr key={r.teacher_id} className="hover:bg-red-50/30">
                        <td className="p-3 font-semibold text-stone-900">{r.teacher_name} ({r.employee_code || 'N/A'})</td>
                        <td className="p-3 font-mono">{r.days_present} / {calendarData?.workingDays || r.total_working_days}</td>
                        <td className="p-3">{getPercentageBadge(r.attendance_percentage)}</td>
                        <td className="p-3">
                          <Badge variant="warning" size="sm">
                            Below {alertThreshold}%
                          </Badge>
                        </td>
                        <td className="p-3 text-right">
                          <Button
                            size="sm"
                            onClick={() => handleSendLowAttendanceAlert(r.teacher_id)}
                            className="bg-amber-700 hover:bg-amber-800 text-white flex items-center gap-1.5 ml-auto"
                          >
                            <Bell className="w-3.5 h-3.5" /> Send Notice
                          </Button>
                        </td>
                      </tr>
                    ))}
                  {reports.filter((r) => r.attendance_percentage < alertThreshold).length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-stone-500">
                        No teachers found below the {alertThreshold}% threshold for this month.
                      </td>
                    </tr>
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
