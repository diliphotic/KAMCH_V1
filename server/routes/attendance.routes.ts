import { Router, Request, Response } from 'express';
import { requireAuth, requireRoles } from '../middleware/auth.ts';
import { ROLES } from '../permissions.ts';
import { getPool } from '../db.ts';
import { recordAuditLog } from '../services/audit.ts';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export const attendanceRouter = Router();

attendanceRouter.use(requireAuth);

export interface WorkingDaysCalculation {
  year: number;
  month: number;
  daysInMonth: number;
  sundaysCount: number;
  additionalHolidaysCount: number;
  workingDays: number;
  holidays: Array<{ date: string; name: string; isSunday: boolean }>;
}

export async function calculateWorkingDaysForMonth(
  pool: any,
  year: number,
  month: number
): Promise<WorkingDaysCalculation> {
  const daysInMonth = new Date(year, month, 0).getDate();
  const startDateStr = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDateStr = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  let holidaysRows: any[] = [];
  try {
    const [rows] = await pool.query(
      `SELECT holiday_date, holiday_name, description FROM institutional_holidays WHERE holiday_date BETWEEN ? AND ?`,
      [startDateStr, endDateStr]
    );
    holidaysRows = rows || [];
  } catch {
    //
  }

  const holidayMap = new Map<string, string>();
  for (const h of holidaysRows) {
    const dStr = typeof h.holiday_date === 'string' ? h.holiday_date.split('T')[0] : new Date(h.holiday_date).toISOString().split('T')[0];
    holidayMap.set(dStr, h.holiday_name);
  }

  let sundaysCount = 0;
  let additionalHolidaysCount = 0;
  let workingDays = 0;
  const holidaysList: Array<{ date: string; name: string; isSunday: boolean }> = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const dStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dt = new Date(year, month - 1, day);
    const isSunday = dt.getDay() === 0;
    const holidayName = holidayMap.get(dStr);

    if (isSunday) {
      sundaysCount++;
      if (holidayName) {
        holidaysList.push({ date: dStr, name: `${holidayName} (Sunday)`, isSunday: true });
      }
    } else if (holidayName) {
      additionalHolidaysCount++;
      holidaysList.push({ date: dStr, name: holidayName, isSunday: false });
    } else {
      workingDays++;
    }
  }

  return {
    year,
    month,
    daysInMonth,
    sundaysCount,
    additionalHolidaysCount,
    workingDays,
    holidays: holidaysList,
  };
}

async function getTeacherApprovedLeaveWorkingDays(
  pool: any,
  teacherId: number,
  year: number,
  month: number,
  holidaySet: Set<string>
): Promise<{ approvedLeaveDaysCount: number; approvedLeaveDates: string[] }> {
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthStartStr = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEndStr = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  let leaves: any[] = [];
  try {
    const [rows] = await pool.query(
      `SELECT start_date, end_date FROM leave_applications
       WHERE teacher_id = ? AND status = 'APPROVED'
         AND start_date <= ? AND end_date >= ?`,
      [teacherId, monthEndStr, monthStartStr]
    );
    leaves = rows || [];
  } catch {
    //
  }

  const uniqueWorkingLeaveDates = new Set<string>();

  for (const l of leaves) {
    const sStr = typeof l.start_date === 'string' ? l.start_date.split('T')[0] : new Date(l.start_date).toISOString().split('T')[0];
    const eStr = typeof l.end_date === 'string' ? l.end_date.split('T')[0] : new Date(l.end_date).toISOString().split('T')[0];

    const [sy, sm, sd] = sStr.split('-').map(Number);
    const [ey, em, ed] = eStr.split('-').map(Number);

    const startDt = new Date(sy, sm - 1, sd);
    const endDt = new Date(ey, em - 1, ed);

    let cur = new Date(startDt);
    while (cur <= endDt) {
      const cy = cur.getFullYear();
      const cm = cur.getMonth() + 1;
      const cd = cur.getDate();
      const curStr = `${cy}-${String(cm).padStart(2, '0')}-${String(cd).padStart(2, '0')}`;

      if (cy === year && cm === month) {
        const dayOfWeek = cur.getDay();
        const isSunday = dayOfWeek === 0;
        const isHoliday = holidaySet.has(curStr);

        if (!isSunday && !isHoliday) {
          uniqueWorkingLeaveDates.add(curStr);
        }
      }
      cur.setDate(cur.getDate() + 1);
    }
  }

  return {
    approvedLeaveDaysCount: uniqueWorkingLeaveDates.size,
    approvedLeaveDates: Array.from(uniqueWorkingLeaveDates),
  };
}

/**
 * GET /api/attendance/holidays
 * Get configured institutional holidays for a month/year
 */
attendanceRouter.get('/holidays', async (req: Request, res: Response) => {
  const year = Number(req.query.year);
  const month = Number(req.query.month);

  if (!year || !month || month < 1 || month > 12) {
    res.status(400).json({ error: 'Valid year and month are required.', code: 'INVALID_PERIOD' });
    return;
  }

  const pool = getPool();
  try {
    const calc = await calculateWorkingDaysForMonth(pool, year, month);
    res.json({ success: true, ...calc });
  } catch (err) {
    console.error('[Attendance] Get holidays error:', err);
    res.status(500).json({ error: 'Failed to fetch holidays', code: 'DATABASE_ERROR' });
  }
});

/**
 * POST /api/attendance/holidays
 * Add or update an institutional holiday
 */
attendanceRouter.post(
  '/holidays',
  requireRoles(ROLES.PRINCIPAL, ROLES.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    const { holidayDate, holidayName, description } = req.body;

    if (!holidayDate || !holidayName || !String(holidayDate).trim() || !String(holidayName).trim()) {
      res.status(400).json({ error: 'Holiday date and holiday name are required.', code: 'MISSING_FIELDS' });
      return;
    }

    const cleanDate = String(holidayDate).trim().split('T')[0];
    const cleanName = String(holidayName).trim();
    const cleanDesc = description ? String(description).trim() : null;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
      res.status(400).json({ error: 'Holiday date must be in YYYY-MM-DD format.', code: 'INVALID_DATE' });
      return;
    }

    const pool = getPool();
    try {
      await pool.query(
        `INSERT INTO institutional_holidays (holiday_date, holiday_name, description, created_by)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE holiday_name = VALUES(holiday_name), description = VALUES(description), updated_at = NOW()`,
        [cleanDate, cleanName, cleanDesc, req.user!.id]
      );

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'INSTITUTIONAL_HOLIDAY_SAVED',
        targetType: 'HOLIDAY',
        targetId: cleanDate,
        ipAddress: req.ip || null,
        details: { holidayDate: cleanDate, holidayName: cleanName },
      });

      const [y, m] = cleanDate.split('-').map(Number);
      const calc = await calculateWorkingDaysForMonth(pool, y, m);

      res.json({ success: true, message: 'Holiday saved successfully.', ...calc });
    } catch (err) {
      console.error('[Attendance] Save holiday error:', err);
      res.status(500).json({ error: 'Failed to save holiday', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * DELETE /api/attendance/holidays/:date
 * Remove an institutional holiday
 */
attendanceRouter.delete(
  '/holidays/:date',
  requireRoles(ROLES.PRINCIPAL, ROLES.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    const cleanDate = String(req.params.date).trim().split('T')[0];

    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
      res.status(400).json({ error: 'Valid holiday date in YYYY-MM-DD format is required.', code: 'INVALID_DATE' });
      return;
    }

    const pool = getPool();
    try {
      await pool.query('DELETE FROM institutional_holidays WHERE holiday_date = ?', [cleanDate]);

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'INSTITUTIONAL_HOLIDAY_REMOVED',
        targetType: 'HOLIDAY',
        targetId: cleanDate,
        ipAddress: req.ip || null,
        details: { holidayDate: cleanDate },
      });

      const [y, m] = cleanDate.split('-').map(Number);
      const calc = await calculateWorkingDaysForMonth(pool, y, m);

      res.json({ success: true, message: 'Holiday removed successfully.', ...calc });
    } catch (err) {
      console.error('[Attendance] Delete holiday error:', err);
      res.status(500).json({ error: 'Failed to remove holiday', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * GET /api/attendance/reports
 * Principal/Admin views attendance records for a specific month and year
 */
attendanceRouter.get(
  '/reports',
  requireRoles(ROLES.PRINCIPAL, ROLES.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    const year = Number(req.query.year);
    const month = Number(req.query.month);

    if (!year || !month || month < 1 || month > 12) {
      res.status(400).json({ error: 'Valid year and month (1-12) are required.', code: 'INVALID_PERIOD' });
      return;
    }

    const pool = getPool();
    try {
      // 1. Calculate working days for the calendar month
      const calendar = await calculateWorkingDaysForMonth(pool, year, month);
      const holidaySet = new Set(calendar.holidays.map((h) => h.date));

      // 2. Fetch active teachers
      const [teachers] = await pool.query<any[]>(
        `SELECT t.id AS teacher_id, t.full_name AS teacher_name, t.employee_code, t.designation, d.name AS department_name 
         FROM teachers t 
         LEFT JOIN departments d ON t.department_id = d.id 
         WHERE t.status = 'ACTIVE' 
         ORDER BY t.full_name ASC`
      );

      // 3. Fetch existing saved monthly records for this period
      const [existingRecords] = await pool.query<any[]>(
        'SELECT * FROM monthly_attendance WHERE year = ? AND month = ?',
        [year, month]
      );

      const recordMap = new Map<number, any>();
      for (const rec of existingRecords) {
        recordMap.set(rec.teacher_id, rec);
      }

      let needsRefinalization = false;

      // 4. Build comprehensive report entries with provisional formula
      const reports = await Promise.all(
        teachers.map(async (t) => {
          const rec = recordMap.get(t.teacher_id);
          const leaveData = await getTeacherApprovedLeaveWorkingDays(pool, t.teacher_id, year, month, holidaySet);

          const provisionalDaysPresent = Math.max(0, calendar.workingDays - leaveData.approvedLeaveDaysCount);
          const provisionalPercentage =
            calendar.workingDays > 0 ? Math.round(((provisionalDaysPresent / calendar.workingDays) * 100) * 100) / 100 : 0;

          if (rec) {
            const savedWorkingDays = Number(rec.total_working_days);
            const savedDaysPresent = Number(rec.days_present);
            const savedPercentage = Number(rec.attendance_percentage);
            const hasWorkingDaysConflict = savedWorkingDays !== calendar.workingDays;
            const hasFormulaConflict = savedDaysPresent !== provisionalDaysPresent;

            if (rec.status === 'FINALIZED' && hasWorkingDaysConflict) {
              needsRefinalization = true;
            }

            return {
              id: rec.id,
              teacher_id: t.teacher_id,
              teacher_name: t.teacher_name,
              employee_code: t.employee_code,
              designation: t.designation,
              department_name: t.department_name,
              total_working_days: savedWorkingDays,
              days_present: savedDaysPresent,
              attendance_percentage: savedPercentage,
              approved_leave_days: leaveData.approvedLeaveDaysCount,
              provisional_days_present: provisionalDaysPresent,
              provisional_percentage: provisionalPercentage,
              has_conflict: hasFormulaConflict || hasWorkingDaysConflict,
              status: rec.status,
              finalized_by: rec.finalized_by,
              finalized_at: rec.finalized_at,
            };
          } else {
            return {
              id: null,
              teacher_id: t.teacher_id,
              teacher_name: t.teacher_name,
              employee_code: t.employee_code,
              designation: t.designation,
              department_name: t.department_name,
              total_working_days: calendar.workingDays,
              days_present: provisionalDaysPresent,
              attendance_percentage: provisionalPercentage,
              approved_leave_days: leaveData.approvedLeaveDaysCount,
              provisional_days_present: provisionalDaysPresent,
              provisional_percentage: provisionalPercentage,
              has_conflict: false,
              status: 'PENDING',
              finalized_by: null,
              finalized_at: null,
            };
          }
        })
      );

      res.json({
        success: true,
        year,
        month,
        calendar,
        needsRefinalization,
        reports,
      });
    } catch (err) {
      console.error('[Attendance] Fetch reports error:', err);
      res.status(500).json({ error: 'Failed to fetch attendance reports', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * POST /api/attendance/entry
 * Principal/Admin saves manual attendance entries
 */
attendanceRouter.post(
  '/entry',
  requireRoles(ROLES.PRINCIPAL, ROLES.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    const { year, month, totalWorkingDays, entries } = req.body;

    const numYear = Number(year);
    const numMonth = Number(month);
    const numWorkingDays = Number(totalWorkingDays);

    if (!numYear || !numMonth || numMonth < 1 || numMonth > 12) {
      res.status(400).json({ error: 'Valid year and month (1-12) are required.', code: 'INVALID_PERIOD' });
      return;
    }

    if (!numWorkingDays || isNaN(numWorkingDays) || numWorkingDays <= 0) {
      res.status(400).json({ error: 'Working days must be greater than zero.', code: 'INVALID_WORKING_DAYS' });
      return;
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      res.status(400).json({ error: 'At least one attendance entry is required.', code: 'MISSING_ENTRIES' });
      return;
    }

    // Validate all entries before saving
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const tid = Number(e.teacherId);
      const days = Number(e.daysPresent);

      if (!tid) {
        res.status(400).json({ error: `Entry ${i + 1}: Invalid teacher ID.`, code: 'INVALID_TEACHER_ID' });
        return;
      }

      if (isNaN(days) || days < 0 || days > numWorkingDays) {
        res.status(400).json({
          error: `Entry ${i + 1}: Days present (${days}) must be between 0 and total working days (${numWorkingDays}).`,
          code: 'INVALID_DAYS_PRESENT',
        });
        return;
      }
    }

    const pool = getPool();
    try {
      for (const e of entries) {
        const tid = Number(e.teacherId);
        const days = Number(e.daysPresent);
        const percentage = Math.round(((days / numWorkingDays) * 100) * 100) / 100;

        await pool.query(
          `INSERT INTO monthly_attendance (teacher_id, year, month, total_working_days, days_present, attendance_percentage, status)
           VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
           ON DUPLICATE KEY UPDATE
             total_working_days = VALUES(total_working_days),
             days_present = VALUES(days_present),
             attendance_percentage = VALUES(attendance_percentage),
             updated_at = NOW()`,
          [tid, numYear, numMonth, numWorkingDays, days, percentage]
        );
      }

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'TEACHER_ATTENDANCE_SAVED',
        targetType: 'MONTHLY_ATTENDANCE',
        targetId: `${numYear}-${numMonth}`,
        ipAddress: req.ip || null,
        details: { year: numYear, month: numMonth, totalWorkingDays: numWorkingDays, entryCount: entries.length },
      });

      res.json({ success: true, updatedCount: entries.length });
    } catch (err) {
      console.error('[Attendance] Save entry error:', err);
      res.status(500).json({ error: 'Failed to save attendance entries', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * POST /api/attendance/import
 * Principal/Admin imports attendance records from CSV / template string
 */
attendanceRouter.post(
  '/import',
  requireRoles(ROLES.PRINCIPAL, ROLES.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    const { year, month, totalWorkingDays, csvText } = req.body;

    const numYear = Number(year);
    const numMonth = Number(month);
    const numWorkingDays = Number(totalWorkingDays);

    if (!numYear || !numMonth || numMonth < 1 || numMonth > 12) {
      res.status(400).json({ error: 'Valid year and month (1-12) are required.', code: 'INVALID_PERIOD' });
      return;
    }

    if (!numWorkingDays || isNaN(numWorkingDays) || numWorkingDays <= 0) {
      res.status(400).json({ error: 'Working days must be greater than zero.', code: 'INVALID_WORKING_DAYS' });
      return;
    }

    if (!csvText || typeof csvText !== 'string' || csvText.trim() === '') {
      res.status(400).json({ error: 'CSV text content is required for import.', code: 'MISSING_CSV' });
      return;
    }

    const pool = getPool();
    try {
      const [allTeachers] = await pool.query<any[]>('SELECT id, employee_code, full_name FROM teachers');
      const teacherByCodeMap = new Map<string, any>();
      for (const t of allTeachers) {
        if (t.employee_code) {
          teacherByCodeMap.set(String(t.employee_code).trim().toUpperCase(), t);
        }
        teacherByCodeMap.set(`ID:${t.id}`, t);
      }

      const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
      const errors: string[] = [];
      const validEntries: Array<{ teacherId: number; daysPresent: number }> = [];

      let startIdx = 0;
      if (lines[0].toLowerCase().includes('employee') || lines[0].toLowerCase().includes('code') || lines[0].toLowerCase().includes('days')) {
        startIdx = 1; // Header row
      }

      for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i];
        const parts = line.split(',').map((p) => p.trim());
        if (parts.length < 2) {
          errors.push(`Line ${i + 1}: Malformed line format (expected employee_code, days_present).`);
          continue;
        }

        const codeOrId = parts[0].toUpperCase();
        const days = Number(parts[1]);

        let teacher = teacherByCodeMap.get(codeOrId);
        if (!teacher && !isNaN(Number(codeOrId))) {
          teacher = teacherByCodeMap.get(`ID:${codeOrId}`);
        }

        if (!teacher) {
          errors.push(`Line ${i + 1}: Teacher identifier '${parts[0]}' not found in institutional records.`);
          continue;
        }

        if (isNaN(days) || days < 0 || days > numWorkingDays) {
          errors.push(`Line ${i + 1}: Days present (${parts[1]}) must be between 0 and total working days (${numWorkingDays}).`);
          continue;
        }

        validEntries.push({ teacherId: teacher.id, daysPresent: days });
      }

      if (errors.length > 0) {
        res.status(400).json({
          error: 'Spreadsheet import validation failed. Correct the errors and retry.',
          code: 'IMPORT_VALIDATION_FAILED',
          errors,
        });
        return;
      }

      for (const entry of validEntries) {
        const percentage = Math.round(((entry.daysPresent / numWorkingDays) * 100) * 100) / 100;
        await pool.query(
          `INSERT INTO monthly_attendance (teacher_id, year, month, total_working_days, days_present, attendance_percentage, status)
           VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
           ON DUPLICATE KEY UPDATE
             total_working_days = VALUES(total_working_days),
             days_present = VALUES(days_present),
             attendance_percentage = VALUES(attendance_percentage),
             updated_at = NOW()`,
          [entry.teacherId, numYear, numMonth, numWorkingDays, entry.daysPresent, percentage]
        );
      }

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'TEACHER_ATTENDANCE_IMPORTED',
        targetType: 'MONTHLY_ATTENDANCE',
        targetId: `${numYear}-${numMonth}`,
        ipAddress: req.ip || null,
        details: { year: numYear, month: numMonth, importedCount: validEntries.length },
      });

      res.json({ success: true, count: validEntries.length });
    } catch (err) {
      console.error('[Attendance] Import error:', err);
      res.status(500).json({ error: 'Failed to import attendance data', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * POST /api/attendance/reports/finalize
 * Principal/Admin finalizes a month's attendance report and generates persistent in-app notifications
 */
attendanceRouter.post(
  '/reports/finalize',
  requireRoles(ROLES.PRINCIPAL, ROLES.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    const { year, month } = req.body;
    const numYear = Number(year);
    const numMonth = Number(month);

    if (!numYear || !numMonth || numMonth < 1 || numMonth > 12) {
      res.status(400).json({ error: 'Valid year and month (1-12) are required.', code: 'INVALID_PERIOD' });
      return;
    }

    const pool = getPool();
    try {
      // 1. Fetch all attendance records for this period
      const [records] = await pool.query<any[]>(
        'SELECT * FROM monthly_attendance WHERE year = ? AND month = ?',
        [numYear, numMonth]
      );

      if (records.length === 0) {
        res.status(400).json({ error: 'No attendance records found to finalize for this month.', code: 'NO_RECORDS' });
        return;
      }

      // 2. Mark records as FINALIZED
      await pool.query(
        `UPDATE monthly_attendance 
         SET status = 'FINALIZED', finalized_by = ?, finalized_at = NOW() 
         WHERE year = ? AND month = ?`,
        [req.user!.id, numYear, numMonth]
      );

      const monthName = MONTH_NAMES[numMonth - 1] || `Month ${numMonth}`;
      let notificationCount = 0;

      // 3. Generate or update persistent in-app notifications for linked teacher accounts
      for (const rec of records) {
        const [users] = await pool.query<any[]>('SELECT id FROM users WHERE teacher_id = ? AND is_deactivated = FALSE', [rec.teacher_id]);
        if (users.length > 0) {
          const userId = users[0].id;
          const notifTitle = `Monthly Attendance Report Finalized: ${monthName} ${numYear}`;
          const notifMsg = `Your attendance report for ${monthName} ${numYear} has been finalized. Days Present: ${rec.days_present} out of ${rec.total_working_days} working days. Attendance Percentage: ${rec.attendance_percentage}%.`;

          // Check if notification already exists for this finalized report
          const [existingNotif] = await pool.query<any[]>(
            'SELECT id FROM notifications WHERE user_id = ? AND type = ? AND related_id = ?',
            [userId, 'ATTENDANCE_FINALIZED', rec.id]
          );

          if (existingNotif.length === 0) {
            await pool.query(
              'INSERT INTO notifications (user_id, title, message, type, related_id) VALUES (?, ?, ?, ?, ?)',
              [userId, notifTitle, notifMsg, 'ATTENDANCE_FINALIZED', rec.id]
            );
          } else {
            // Re-finalization / correction: update existing notification message with updated metrics
            await pool.query(
              'UPDATE notifications SET message = ?, is_read = FALSE, created_at = NOW() WHERE id = ?',
              [notifMsg, existingNotif[0].id]
            );
          }
          notificationCount++;
        }
      }

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'MONTHLY_ATTENDANCE_FINALIZED',
        targetType: 'MONTHLY_ATTENDANCE',
        targetId: `${numYear}-${numMonth}`,
        ipAddress: req.ip || null,
        details: { year: numYear, month: numMonth, recordCount: records.length, notificationsSent: notificationCount },
      });

      res.json({ success: true, count: records.length, notificationsSent: notificationCount });
    } catch (err) {
      console.error('[Attendance] Finalize report error:', err);
      res.status(500).json({ error: 'Failed to finalize attendance report', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * POST /api/attendance/low-attendance-alert
 * Principal sends an individual low-attendance alert in-app notification to a teacher
 */
attendanceRouter.post(
  '/low-attendance-alert',
  requireRoles(ROLES.PRINCIPAL, ROLES.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    const { teacherId, year, month, threshold, customMessage } = req.body;
    const numTeacherId = Number(teacherId);
    const numYear = Number(year);
    const numMonth = Number(month);
    const targetThreshold = Number(threshold) || 75;

    if (!numTeacherId || !numYear || !numMonth) {
      res.status(400).json({ error: 'Teacher ID, year, and month are required.', code: 'MISSING_FIELDS' });
      return;
    }

    const pool = getPool();
    try {
      const [users] = await pool.query<any[]>('SELECT id FROM users WHERE teacher_id = ? AND is_deactivated = FALSE', [numTeacherId]);
      if (users.length === 0) {
        res.status(400).json({ error: 'No active user account found for this teacher.', code: 'NO_TEACHER_USER' });
        return;
      }

      const [reports] = await pool.query<any[]>(
        'SELECT * FROM monthly_attendance WHERE teacher_id = ? AND year = ? AND month = ?',
        [numTeacherId, numYear, numMonth]
      );

      if (reports.length === 0) {
        res.status(400).json({ error: 'No attendance record found for this teacher and period.', code: 'NO_REPORT_FOUND' });
        return;
      }

      const report = reports[0];
      const monthName = MONTH_NAMES[numMonth - 1] || `Month ${numMonth}`;
      const userId = users[0].id;

      const title = `Low Attendance Notice — ${monthName} ${numYear}`;
      const message = `Your attendance percentage for ${monthName} ${numYear} is ${report.attendance_percentage}% (${report.days_present}/${report.total_working_days} days), which is below the target threshold of ${targetThreshold}%. ${customMessage ? `Remarks: ${customMessage}` : ''}`;

      await pool.query(
        'INSERT INTO notifications (user_id, title, message, type, related_id) VALUES (?, ?, ?, ?, ?)',
        [userId, title, message, 'LOW_ATTENDANCE_ALERT', report.id]
      );

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'LOW_ATTENDANCE_ALERT_SENT',
        targetType: 'TEACHER',
        targetId: String(numTeacherId),
        ipAddress: req.ip || null,
        details: { teacherId: numTeacherId, year: numYear, month: numMonth, percentage: report.attendance_percentage, threshold: targetThreshold },
      });

      res.json({ success: true });
    } catch (err) {
      console.error('[Attendance] Low attendance alert error:', err);
      res.status(500).json({ error: 'Failed to send low attendance alert', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * GET /api/attendance/my-reports
 * Authenticated FACULTY user views own finalized monthly attendance reports
 */
attendanceRouter.get(
  '/my-reports',
  async (req: Request, res: Response) => {
    const teacherId = req.user?.teacherId;
    if (!teacherId) {
      res.status(403).json({ error: 'Access denied: No linked teacher profile found.', code: 'NO_TEACHER_PROFILE' });
      return;
    }

    const pool = getPool();
    try {
      const [rows] = await pool.query<any[]>(
        `SELECT id, teacher_id, year, month, total_working_days, days_present, attendance_percentage, status, finalized_at 
         FROM monthly_attendance 
         WHERE teacher_id = ? AND status = 'FINALIZED' 
         ORDER BY year DESC, month DESC`,
        [teacherId]
      );

      const reports = rows.map((r) => ({
        ...r,
        month_name: MONTH_NAMES[r.month - 1] || `Month ${r.month}`,
      }));

      res.json({ success: true, reports });
    } catch (err) {
      console.error('[Attendance] Fetch my reports error:', err);
      res.status(500).json({ error: 'Failed to fetch attendance reports', code: 'DATABASE_ERROR' });
    }
  }
);
