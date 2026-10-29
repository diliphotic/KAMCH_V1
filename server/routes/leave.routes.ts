import { Router, Request, Response } from 'express';
import { getPool } from '../db.ts';
import { requireAuth, requireRoles } from '../middleware/auth.ts';
import { ROLES } from '../permissions.ts';
import { recordAuditLog } from '../services/audit.ts';

export const leaveRouter = Router();

// Apply auth to all leave routes
leaveRouter.use(requireAuth);

// Helper to check if a user is linked to a teacher record
const requireLinkedTeacher = (req: Request, res: Response, next: any) => {
  if (!req.user || !req.user.teacherId) {
    res.status(403).json({ error: 'Access denied: Teacher account not linked.', code: 'UNLINKED_TEACHER' });
    return;
  }
  next();
};

export function getKolkataDateString(date = new Date()): string {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  };
  const formatter = new Intl.DateTimeFormat('en-CA', options);
  return formatter.format(date);
}

export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().split('T')[0];
}

async function getLeaveMaxAdvanceDays(pool: any): Promise<number> {
  try {
    const [rows] = await pool.query(
      "SELECT setting_value FROM institutional_settings WHERE setting_key = 'LEAVE_MAX_ADVANCE_DAYS' LIMIT 1"
    );
    if (rows && rows.length > 0) {
      const val = parseInt(rows[0].setting_value, 10);
      if (!isNaN(val) && val > 0) return val;
    }
  } catch {
    // fallback default
  }
  return 20;
}

/**
 * GET /api/leave/settings
 * Retrieves leave application window settings
 */
leaveRouter.get('/settings', async (_req: Request, res: Response) => {
  const pool = getPool();
  try {
    const maxAdvanceDays = await getLeaveMaxAdvanceDays(pool);
    const todayKolkata = getKolkataDateString();
    const minStartDate = addDaysToDateString(todayKolkata, 1);
    const maxStartDate = addDaysToDateString(todayKolkata, maxAdvanceDays);

    res.json({
      success: true,
      maxAdvanceDays,
      minAdvanceDays: 1,
      today: todayKolkata,
      minStartDate,
      maxStartDate,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve leave settings', code: 'DATABASE_ERROR' });
  }
});

/**
 * POST /api/leave/settings
 * Principal/Super Admin configures maximum advance leave application window
 */
leaveRouter.post(
  '/settings',
  requireRoles(ROLES.PRINCIPAL, ROLES.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    const { maxAdvanceDays } = req.body;
    const numDays = Number(maxAdvanceDays);

    if (isNaN(numDays) || numDays < 1 || numDays > 365) {
      res.status(400).json({
        error: 'Maximum advance window must be a positive number of days (1-365).',
        code: 'INVALID_WINDOW',
      });
      return;
    }

    const pool = getPool();
    try {
      await pool.query(
        `INSERT INTO institutional_settings (setting_key, setting_value, effective_date, updated_reason)
         VALUES ('LEAVE_MAX_ADVANCE_DAYS', ?, CURDATE(), 'Updated by Principal')
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()`,
        [String(numDays)]
      );

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'LEAVE_SETTINGS_UPDATED',
        targetType: 'INSTITUTIONAL_SETTING',
        targetId: 'LEAVE_MAX_ADVANCE_DAYS',
        ipAddress: req.ip || null,
        details: { maxAdvanceDays: numDays },
      });

      res.json({ success: true, maxAdvanceDays: numDays });
    } catch (err) {
      console.error('[Leave] Update settings error:', err);
      res.status(500).json({ error: 'Failed to update leave settings', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * POST /api/leave/apply
 * Submit a leave application
 */
leaveRouter.post(
  '/apply',
  requireLinkedTeacher,
  async (req: Request, res: Response) => {
    const { startDate, endDate, reason } = req.body;
    
    if (!startDate || !endDate || !reason) {
      res.status(400).json({ error: 'Start date, end date, and reason are required.', code: 'MISSING_FIELDS' });
      return;
    }

    if (new Date(startDate) > new Date(endDate)) {
        res.status(400).json({ error: 'Start date cannot be after end date.', code: 'INVALID_DATE_RANGE' });
        return;
    }

    const pool = getPool();
    const maxAdvanceDays = await getLeaveMaxAdvanceDays(pool);
    const todayKolkata = getKolkataDateString();
    const minStartDate = addDaysToDateString(todayKolkata, 1);
    const maxStartDate = addDaysToDateString(todayKolkata, maxAdvanceDays);

    if (startDate < minStartDate) {
      res.status(400).json({
        error: `Leave applications cannot start today or in the past. Earliest permitted start date is ${minStartDate}.`,
        code: 'INVALID_START_DATE_TOO_EARLY',
      });
      return;
    }

    if (startDate > maxStartDate) {
      res.status(400).json({
        error: `Start date exceeds the maximum advance application window of ${maxAdvanceDays} days (${maxStartDate}).`,
        code: 'INVALID_START_DATE_TOO_LATE',
      });
      return;
    }

    try {
      const [result] = await pool.query<any>(
        'INSERT INTO leave_applications (teacher_id, start_date, end_date, reason) VALUES (?, ?, ?, ?)',
        [req.user!.teacherId, startDate, endDate, reason]
      );
      const applicationId = result.insertId;

      // Notify authorized Principal and Super Admin accounts
      const [teachers] = await pool.query<any[]>('SELECT full_name FROM teachers WHERE id = ?', [req.user!.teacherId]);
      const teacherName = teachers[0]?.full_name || 'A teacher';

      const [principals] = await pool.query<any[]>(
        `SELECT u.id FROM users u JOIN roles r ON u.role_id = r.id WHERE r.code IN ('PRINCIPAL', 'SUPER_ADMIN') AND u.is_deactivated = FALSE`
      );

      for (const p of principals) {
        const [existing] = await pool.query<any[]>(
          'SELECT id FROM notifications WHERE user_id = ? AND type = ? AND related_id = ?',
          [p.id, 'LEAVE_SUBMISSION', applicationId]
        );
        if (existing.length === 0) {
          const title = 'New Leave Application Submitted';
          const message = `${teacherName} has requested leave from ${startDate} to ${endDate}. Reason: ${reason}`;
          await pool.query(
            'INSERT INTO notifications (user_id, title, message, type, related_id) VALUES (?, ?, ?, ?, ?)',
            [p.id, title, message, 'LEAVE_SUBMISSION', applicationId]
          );
        }
      }

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'LEAVE_APPLICATION_SUBMITTED',
        targetType: 'LEAVE_APPLICATION',
        targetId: String(applicationId),
        ipAddress: req.ip || null,
        details: { teacherId: req.user!.teacherId, startDate, endDate },
      });

      res.status(201).json({ success: true, applicationId });
    } catch (err) {
      console.error('[Leave] Submission error:', err);
      res.status(500).json({ error: 'Failed to submit application', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * GET /api/leave/my-applications
 * Teacher views own applications
 */
leaveRouter.get(
  '/my-applications',
  requireLinkedTeacher,
  async (req: Request, res: Response) => {
    const pool = getPool();
    try {
      const [rows] = await pool.query<any[]>(
        'SELECT * FROM leave_applications WHERE teacher_id = ? ORDER BY submitted_at DESC',
        [req.user!.teacherId]
      );
      res.json({ success: true, applications: rows });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch applications', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * GET /api/leave/all-applications
 * Principal views all applications
 */
leaveRouter.get(
  '/all-applications',
  requireRoles(ROLES.PRINCIPAL, ROLES.SUPER_ADMIN),
  async (_req: Request, res: Response) => {
    const pool = getPool();
    try {
      const [rows] = await pool.query<any[]>(
        `SELECT la.*, t.full_name AS teacher_name, t.designation AS teacher_designation, d.name AS department_name 
         FROM leave_applications la 
         JOIN teachers t ON la.teacher_id = t.id 
         LEFT JOIN departments d ON t.department_id = d.id 
         ORDER BY la.submitted_at DESC`
      );
      res.json({ success: true, applications: rows });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch applications', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * POST /api/leave/:id/decide
 * Principal approves/rejects application
 */
leaveRouter.post(
  '/:id/decide',
  requireRoles(ROLES.PRINCIPAL, ROLES.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    const { status, remarks } = req.body;
    const applicationId = req.params.id;

    if (!['APPROVED', 'REJECTED'].includes(status)) {
        res.status(400).json({ error: 'Invalid decision status', code: 'INVALID_STATUS' });
        return;
    }

    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [apps] = await conn.query<any[]>('SELECT teacher_id FROM leave_applications WHERE id = ?', [applicationId]);
      if (apps.length === 0) {
          await conn.rollback();
          res.status(404).json({ error: 'Application not found' });
          return;
      }
      const teacherId = apps[0].teacher_id;

      await conn.query(
        'UPDATE leave_applications SET status = ?, decided_by = ?, decided_at = NOW(), decision_remarks = ? WHERE id = ?',
        [status, req.user!.id, remarks, applicationId]
      );

      const [users] = await conn.query<any[]>('SELECT id FROM users WHERE teacher_id = ?', [teacherId]);
      if (users.length > 0) {
        const userId = users[0].id;
        const [existingNotif] = await conn.query<any[]>(
          'SELECT id FROM notifications WHERE user_id = ? AND type = ? AND related_id = ?',
          [userId, 'LEAVE_DECISION', applicationId]
        );
        if (existingNotif.length === 0) {
          const message = status === 'APPROVED' 
              ? `Your leave application has been approved. Remarks: ${remarks || 'None'}`
              : `Your leave application has been rejected. Remarks: ${remarks || 'None'}`;
          await conn.query(
              'INSERT INTO notifications (user_id, title, message, type, related_id) VALUES (?, ?, ?, ?, ?)',
              [userId, 'Leave Application Update', message, 'LEAVE_DECISION', applicationId]
          );
        }
      }

      await conn.commit();

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'LEAVE_APPLICATION_DECIDED',
        targetType: 'LEAVE_APPLICATION',
        targetId: String(applicationId),
        ipAddress: req.ip || null,
        details: { status, remarks },
      });

      res.json({ success: true });
    } catch (err) {
      await conn.rollback();
      console.error('[Leave] Decision error:', err);
      res.status(500).json({ error: 'Failed to update application', code: 'DATABASE_ERROR' });
    } finally {
        conn.release();
    }
  }
);
