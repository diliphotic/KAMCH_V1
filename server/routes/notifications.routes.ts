import { Router, Request, Response } from 'express';
import { getPool } from '../db.ts';
import { requireAuth, requireRoles } from '../middleware/auth.ts';
import { ROLES } from '../permissions.ts';
import { recordAuditLog } from '../services/audit.ts';

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

// GET /api/notifications
notificationsRouter.get('/', async (req: Request, res: Response) => {
  const pool = getPool();
  try {
    const [notifications] = await pool.query<any[]>(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC',
      [req.user!.id]
    );
    res.json({ success: true, notifications });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications', code: 'DATABASE_ERROR' });
  }
});

// POST /api/notifications/:id/read
notificationsRouter.post('/:id/read', async (req: Request, res: Response) => {
  const pool = getPool();
  const notificationId = req.params.id;
  try {
    await pool.query(
      'UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?',
      [notificationId, req.user!.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark notification as read', code: 'DATABASE_ERROR' });
  }
});

// GET /api/notifications/unread-count
notificationsRouter.get('/unread-count', async (req: Request, res: Response) => {
  const pool = getPool();
  try {
    const [rows] = await pool.query<any[]>(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE',
      [req.user!.id]
    );
    res.json({ success: true, count: rows[0].count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch unread count', code: 'DATABASE_ERROR' });
  }
});

// POST /api/notifications/broadcast
notificationsRouter.post(
  '/broadcast',
  requireRoles(ROLES.PRINCIPAL, ROLES.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    const { recipientType, recipientTeacherIds, recipientUserIds, departmentId, title, message } = req.body;

    if (!title || !message || !recipientType) {
      res.status(400).json({ error: 'Title, message, and recipientType are required.', code: 'MISSING_FIELDS' });
      return;
    }

    const pool = getPool();
    try {
      let targetUserIds: number[] = [];

      if (recipientType === 'single') {
        if (recipientTeacherIds && recipientTeacherIds.length > 0) {
          const [users] = await pool.query<any[]>('SELECT id FROM users WHERE teacher_id = ? AND is_deactivated = FALSE', [recipientTeacherIds[0]]);
          if (users.length > 0) targetUserIds.push(users[0].id);
        } else if (recipientUserIds && recipientUserIds.length > 0) {
          targetUserIds.push(recipientUserIds[0]);
        }
      } else if (recipientType === 'selected') {
        if (recipientTeacherIds && recipientTeacherIds.length > 0) {
          for (const tid of recipientTeacherIds) {
            const [users] = await pool.query<any[]>('SELECT id FROM users WHERE teacher_id = ? AND is_deactivated = FALSE', [tid]);
            if (users.length > 0) targetUserIds.push(users[0].id);
          }
        } else if (recipientUserIds && recipientUserIds.length > 0) {
          targetUserIds.push(...recipientUserIds);
        }
      } else if (recipientType === 'department') {
        if (!departmentId) {
          res.status(400).json({ error: 'Department ID is required for department broadcast.', code: 'MISSING_DEPARTMENT' });
          return;
        }
        const [teachers] = await pool.query<any[]>('SELECT id FROM teachers WHERE department_id = ?', [departmentId]);
        const teacherIds = teachers.map((t: any) => t.id);
        if (teacherIds.length > 0) {
          const placeholders = teacherIds.map(() => '?').join(',');
          const [users] = await pool.query<any[]>(`SELECT id FROM users WHERE teacher_id IN (${placeholders}) AND is_deactivated = FALSE`, teacherIds);
          targetUserIds.push(...users.map((u: any) => u.id));
        }
      } else if (recipientType === 'all') {
        const [users] = await pool.query<any[]>('SELECT id FROM users WHERE teacher_id IS NOT NULL AND is_deactivated = FALSE');
        targetUserIds.push(...users.map((u: any) => u.id));
      }

      targetUserIds = Array.from(new Set(targetUserIds));

      if (targetUserIds.length === 0) {
        res.status(400).json({ error: 'No valid recipient users found for notification.', code: 'NO_RECIPIENTS' });
        return;
      }

      for (const userId of targetUserIds) {
        await pool.query(
          'INSERT INTO notifications (user_id, title, message, type, related_id) VALUES (?, ?, ?, ?, ?)',
          [userId, title, message, 'BROADCAST', null]
        );
      }

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'NOTIFICATION_BROADCAST_SENT',
        targetType: 'NOTIFICATION',
        targetId: null,
        ipAddress: req.ip || null,
        details: { recipientType, recipientCount: targetUserIds.length, title },
      });

      res.json({ success: true, recipientCount: targetUserIds.length });
    } catch (err) {
      console.error('[Notifications] Broadcast error:', err);
      res.status(500).json({ error: 'Failed to send broadcast notification', code: 'DATABASE_ERROR' });
    }
  }
);
