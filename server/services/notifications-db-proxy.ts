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
}

export function handleNotificationsQuery(
  memDb: MemoryDatabase,
  sql: string,
  params: any[] = []
): [any, any] | null {
  const upper = sql.trim().toUpperCase();
  ensureNotificationsMemoryStore(memDb);
  const m = memDb as any;

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
