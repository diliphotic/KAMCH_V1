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

// ==============================================================================
// WEB PUSH NOTIFICATION INFRASTRUCTURE ENDPOINTS
// ==============================================================================

import {
  getPublicVapidKey,
  saveUserSubscription,
  removeUserSubscription,
  getUserSubscriptionStatus,
  sendTestPushNotification,
  sendPushNotificationToUser,
} from '../services/web-push.service.ts';

/**
 * GET /api/notifications/push/public-key
 * Returns the public VAPID key so the browser can create a push subscription.
 * Safe to expose to authenticated clients. Private key is never returned.
 */
notificationsRouter.get('/push/public-key', (req: Request, res: Response) => {
  try {
    const publicKey = getPublicVapidKey();
    res.json({ success: true, publicKey });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve VAPID public key', details: (err as Error).message });
  }
});

/**
 * GET /api/notifications/push/status
 * Returns whether the current authenticated user has an active push subscription.
 */
notificationsRouter.get('/push/status', async (req: Request, res: Response) => {
  try {
    const status = await getUserSubscriptionStatus(req.user!.id);
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check push subscription status', details: (err as Error).message });
  }
});

/**
 * POST /api/notifications/push/subscribe
 * Registers a client's PushSubscription associated with the authenticated user.
 */
notificationsRouter.post('/push/subscribe', async (req: Request, res: Response) => {
  const { subscription } = req.body || {};
  if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    res.status(400).json({ error: 'Invalid push subscription payload', code: 'INVALID_SUBSCRIPTION' });
    return;
  }

  try {
    const userAgent = req.headers['user-agent'] || undefined;
    const result = await saveUserSubscription(req.user!.id, subscription, userAgent);
    res.json({
      success: true,
      message: result.updated ? 'Subscription updated' : 'Subscription registered successfully',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save push subscription', details: (err as Error).message });
  }
});

/**
 * POST /api/notifications/push/unsubscribe
 * Deactivates the user's push subscription (strictly scoped to the authenticated user).
 */
notificationsRouter.post('/push/unsubscribe', async (req: Request, res: Response) => {
  const { endpoint } = req.body || {};
  try {
    const deactivatedCount = await removeUserSubscription(req.user!.id, endpoint);
    res.json({ success: true, message: 'Unsubscribed successfully', deactivatedCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove push subscription', details: (err as Error).message });
  }
});

/**
 * POST /api/notifications/push/test
 * Sends a controlled test notification to the authenticated user's registered devices.
 */
notificationsRouter.post('/push/test', async (req: Request, res: Response) => {
  try {
    const result = await sendTestPushNotification(req.user!.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to send test push notification', details: (err as Error).message });
  }
});

/**
 * POST /api/notifications/push/admin-test
 * Administrative endpoint to verify push dispatch to a target user.
 * Protected with SUPER_ADMIN / PRINCIPAL roles.
 */
notificationsRouter.post(
  '/push/admin-test',
  requireRoles(ROLES.PRINCIPAL, ROLES.SUPER_ADMIN),
  async (req: Request, res: Response) => {
    const { targetUserId, title, body } = req.body || {};
    const userId = Number(targetUserId) || req.user!.id;

    try {
      const result = await sendPushNotificationToUser(userId, {
        title: title || 'KAMCH ERP Administrative Notification Test',
        body: body || 'Controlled Web Push dispatch verification by Institutional Administrator.',
        url: '/',
        tag: 'admin-test',
      });

      res.json({
        success: true,
        targetUserId: userId,
        result,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to execute admin push test', details: (err as Error).message });
    }
  }
);

