import { MemoryDatabase } from './memory-db.ts';

export interface MemoryNotification {
  id: number;
  user_id: number;
  title: string;
  message: string;
  type: string;
  related_id: number | null;
  is_read: boolean;
  created_at: string;
}

export function ensureNotificationsMemoryStore(memDb: any) {
  if (!memDb.notifications) memDb.notifications = [];
  if (!memDb.pushSubscriptions) memDb.pushSubscriptions = [];
}

export function handleNotificationsQuery(
  memDb: MemoryDatabase,
  sql: string,
  params: any[] = []
): [any, any] | null {
  const upper = sql.trim().toUpperCase();
  ensureNotificationsMemoryStore(memDb);
  const m = memDb as any;

  // 1. push_subscriptions table handling
  if (upper.includes('FROM PUSH_SUBSCRIPTIONS') || upper.includes('FROM `PUSH_SUBSCRIPTIONS`')) {
    if (upper.includes('WHERE USER_ID = ?') && upper.includes('IS_ACTIVE = TRUE')) {
      const uid = Number(params[0]);
      const list = m.pushSubscriptions.filter((s: any) => s.user_id === uid && s.is_active);
      if (upper.includes('COUNT(*)')) {
        return [[{ cnt: list.length, count: list.length }], []];
      }
      return [list, []];
    }
    if (upper.includes('WHERE USER_ID = ?') && upper.includes('ENDPOINT = ?')) {
      const uid = Number(params[0]);
      const ep = String(params[1]);
      const list = m.pushSubscriptions.filter((s: any) => s.user_id === uid && s.endpoint === ep);
      return [list, []];
    }
    return [m.pushSubscriptions, []];
  }

  if (upper.startsWith('INSERT INTO PUSH_SUBSCRIPTIONS') || upper.startsWith('INSERT INTO `PUSH_SUBSCRIPTIONS`')) {
    const nextId = m.pushSubscriptions.length > 0 ? Math.max(...m.pushSubscriptions.map((s: any) => s.id)) + 1 : 1;
    const now = new Date().toISOString();
    const newSub = {
      id: nextId,
      user_id: Number(params[0]),
      endpoint: String(params[1]),
      p256dh: String(params[2]),
      auth: String(params[3]),
      user_agent: params[4] ? String(params[4]) : null,
      is_active: true,
      created_at: now,
      updated_at: now,
    };
    m.pushSubscriptions.push(newSub);
    return [{ insertId: nextId, affectedRows: 1 }, []];
  }

  if (upper.startsWith('UPDATE PUSH_SUBSCRIPTIONS') || upper.startsWith('UPDATE `PUSH_SUBSCRIPTIONS`')) {
    if (upper.includes('SET IS_ACTIVE = FALSE') && upper.includes('WHERE USER_ID = ?')) {
      const uid = Number(params[0]);
      let affected = 0;
      if (params.length > 1 && upper.includes('AND ENDPOINT = ?')) {
        const ep = String(params[1]);
        for (const s of m.pushSubscriptions) {
          if (s.user_id === uid && s.endpoint === ep) {
            s.is_active = false;
            affected++;
          }
        }
      } else {
        for (const s of m.pushSubscriptions) {
          if (s.user_id === uid) {
            s.is_active = false;
            affected++;
          }
        }
      }
      return [{ affectedRows: affected }, []];
    }
    if (upper.includes('SET IS_ACTIVE = TRUE') && upper.includes('WHERE USER_ID = ?') && upper.includes('ENDPOINT = ?')) {
      const uid = Number(params[0]);
      const ep = String(params[1]);
      const existing = m.pushSubscriptions.find((s: any) => s.user_id === uid && s.endpoint === ep);
      if (existing) {
        existing.is_active = true;
        existing.updated_at = new Date().toISOString();
        return [{ affectedRows: 1 }, []];
      }
    }
    return [{ affectedRows: 0 }, []];
  }

  if (upper.includes('FROM NOTIFICATIONS') || upper.includes('FROM `NOTIFICATIONS`')) {
    if (upper.includes('WHERE USER_ID = ?')) {
      const uid = Number(params[0]);
      if (upper.includes('COUNT(*)') && upper.includes('IS_READ = FALSE')) {
        const count = m.notifications.filter((n: any) => n.user_id === uid && !n.is_read).length;
        return [[{ count }], []];
      }
      let list = m.notifications.filter((n: any) => n.user_id === uid);
      if (upper.includes('AND TYPE = ?')) {
        const ntype = String(params[1]);
        list = list.filter((n: any) => n.type === ntype);
      }
      if (upper.includes('AND RELATED_ID = ?')) {
        const relId = Number(params[2]);
        list = list.filter((n: any) => n.related_id === relId);
      }
      list.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return [list, []];
    }
    return [m.notifications, []];
  }

  if (upper.startsWith('INSERT INTO NOTIFICATIONS') || upper.startsWith('INSERT INTO `NOTIFICATIONS`')) {
    const nextId = m.notifications.length > 0 ? Math.max(...m.notifications.map((n: any) => n.id)) + 1 : 1;
    const now = new Date().toISOString();
    const newNotif: MemoryNotification = {
      id: nextId,
      user_id: Number(params[0]),
      title: String(params[1]),
      message: String(params[2]),
      type: String(params[3]),
      related_id: params[4] !== undefined && params[4] !== null ? Number(params[4]) : null,
      is_read: false,
      created_at: now,
    };
    m.notifications.push(newNotif);
    return [{ insertId: nextId, affectedRows: 1 }, []];
  }

  if (upper.startsWith('UPDATE NOTIFICATIONS') || upper.startsWith('UPDATE `NOTIFICATIONS`')) {
    if (upper.includes('IS_READ = TRUE') && upper.includes('WHERE ID = ?')) {
      const notifId = Number(params[0]);
      const userId = Number(params[1]);
      const notif = m.notifications.find((n: any) => n.id === notifId && n.user_id === userId);
      if (notif) {
        notif.is_read = true;
        return [{ affectedRows: 1 }, []];
      }
    }
    if (upper.includes('SET MESSAGE = ?')) {
      const newMsg = String(params[0]);
      const userId = Number(params[1]);
      const notifType = String(params[2]);
      const relId = Number(params[3]);
      const notif = m.notifications.find((n: any) => n.user_id === userId && n.type === notifType && n.related_id === relId);
      if (notif) {
        notif.message = newMsg;
        notif.is_read = false;
        notif.created_at = new Date().toISOString();
        return [{ affectedRows: 1 }, []];
      }
    }
    return [{ affectedRows: 0 }, []];
  }

  return null;
}
