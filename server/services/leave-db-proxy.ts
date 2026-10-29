import { MemoryDatabase } from './memory-db.ts';

export interface MemoryLeaveApplication {
  id: number;
  teacher_id: number;
  start_date: string;
  end_date: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  submitted_at: string;
  decided_by: number | null;
  decided_at: string | null;
  decision_remarks: string | null;
}

export function ensureLeaveMemoryStore(memDb: any) {
  if (!memDb.leaveApplications) memDb.leaveApplications = [];
}

export function handleLeaveQuery(
  memDb: MemoryDatabase,
  sql: string,
  params: any[] = []
): [any, any] | null {
  const upper = sql.trim().toUpperCase();
  ensureLeaveMemoryStore(memDb);
  const m = memDb as any;

  if (upper.includes('FROM LEAVE_APPLICATIONS') || upper.includes('FROM `LEAVE_APPLICATIONS`')) {
    if (upper.includes('WHERE TEACHER_ID = ?')) {
        const tid = Number(params[0]);
        const apps = m.leaveApplications.filter((a: any) => a.teacher_id === tid);
        return [apps, []];
    }
    if (upper.includes('WHERE ID = ?')) {
        const id = Number(params[0]);
        const app = m.leaveApplications.find((a: any) => a.id === id);
        return [app ? [app] : [], []];
    }
    return [m.leaveApplications, []];
  }

  if (upper.startsWith('INSERT INTO LEAVE_APPLICATIONS') || upper.startsWith('INSERT INTO `LEAVE_APPLICATIONS`')) {
    const nextId = m.leaveApplications.length > 0 ? Math.max(...m.leaveApplications.map((a: any) => a.id)) + 1 : 1;
    const now = new Date().toISOString();
    const newApp: MemoryLeaveApplication = {
      id: nextId,
      teacher_id: Number(params[0]),
      start_date: String(params[1]),
      end_date: String(params[2]),
      reason: String(params[3]),
      status: 'PENDING',
      submitted_at: now,
      decided_by: null,
      decided_at: null,
      decision_remarks: null
    };
    m.leaveApplications.push(newApp);
    return [{ insertId: nextId, affectedRows: 1 }, []];
  }

  if (upper.startsWith('UPDATE LEAVE_APPLICATIONS') || upper.startsWith('UPDATE `LEAVE_APPLICATIONS`')) {
    const id = Number(params[params.length - 1]);
    const app = m.leaveApplications.find((a: any) => a.id === id);
    if (app) {
        if (upper.includes('SET STATUS = ?')) {
            app.status = params[0];
            if (upper.includes('DECIDED_BY = ?')) app.decided_by = Number(params[1]);
            if (upper.includes('DECISION_REMARKS = ?')) app.decision_remarks = params[2];
            app.decided_at = new Date().toISOString();
            return [{ affectedRows: 1 }, []];
        }
    }
    return [{ affectedRows: 0 }, []];
  }

  return null;
}
