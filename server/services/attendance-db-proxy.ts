import { MemoryDatabase } from './memory-db.ts';

export interface MemoryMonthlyAttendance {
  id: number;
  teacher_id: number;
  year: number;
  month: number;
  total_working_days: number;
  days_present: number;
  attendance_percentage: number;
  status: 'PENDING' | 'FINALIZED';
  finalized_by: number | null;
  finalized_at: string | null;
  created_at: string;
  updated_at: string;
}

export function ensureAttendanceMemoryStore(memDb: any) {
  if (!memDb.monthlyAttendance) memDb.monthlyAttendance = [];
}

export function handleAttendanceQuery(
  memDb: MemoryDatabase,
  sql: string,
  params: any[] = []
): [any, any] | null {
  const upper = sql.trim().toUpperCase();
  ensureAttendanceMemoryStore(memDb);
  const m = memDb as any;

  if (upper.startsWith('DELETE FROM MONTHLY_ATTENDANCE') || upper.startsWith('DELETE FROM `MONTHLY_ATTENDANCE`')) {
    m.monthlyAttendance = [];
    return [{ affectedRows: 0 }, []];
  }

  if (upper.includes('FROM MONTHLY_ATTENDANCE') || upper.includes('FROM `MONTHLY_ATTENDANCE`')) {
    let list = m.monthlyAttendance.map((ma: any) => {
      const t = memDb.teachers.find((teacher) => teacher.id === ma.teacher_id);
      return {
        ...ma,
        teacher_name: t?.full_name || '',
        employee_code: t?.employee_code || '',
        designation: t?.designation || '',
        department_id: t?.department_id || null,
      };
    });

    if (upper.includes('WHERE TEACHER_ID = ? AND YEAR = ? AND MONTH = ?') || upper.includes('WHERE MA.TEACHER_ID = ? AND MA.YEAR = ? AND MA.MONTH = ?')) {
      const tid = Number(params[0]);
      const yr = Number(params[1]);
      const mo = Number(params[2]);
      const found = list.filter((a: any) => a.teacher_id === tid && a.year === yr && a.month === mo);
      return [found, []];
    }

    if (upper.includes('WHERE YEAR = ? AND MONTH = ?') || upper.includes('WHERE MA.YEAR = ? AND MA.MONTH = ?')) {
      const yr = Number(params[0]);
      const mo = Number(params[1]);
      const found = list.filter((a: any) => a.year === yr && a.month === mo);
      return [found, []];
    }

    if (upper.includes('WHERE ID = ?') || upper.includes('WHERE MA.ID = ?')) {
      const id = Number(params[0]);
      const found = list.filter((a: any) => a.id === id);
      return [found, []];
    }

    if (upper.includes('WHERE TEACHER_ID = ?') || upper.includes('WHERE MA.TEACHER_ID = ?')) {
      const tid = Number(params[0]);
      let found = list.filter((a: any) => a.teacher_id === tid);
      if (upper.includes('STATUS = "FINALIZED"') || upper.includes("STATUS = 'FINALIZED'")) {
        found = found.filter((a: any) => a.status === 'FINALIZED');
      }
      return [found, []];
    }

    return [list, []];
  }

  if (upper.startsWith('INSERT INTO MONTHLY_ATTENDANCE') || upper.startsWith('INSERT INTO `MONTHLY_ATTENDANCE`')) {
    const tid = Number(params[0]);
    const yr = Number(params[1]);
    const mo = Number(params[2]);
    const totalWorking = Number(params[3]);
    const daysPresent = Number(params[4]);
    const percentage = Number(params[5]);
    const status = params[6] || 'PENDING';
    const finalizedBy = params[7] !== undefined && params[7] !== null ? Number(params[7]) : null;

    const existing = m.monthlyAttendance.find((a: any) => a.teacher_id === tid && a.year === yr && a.month === mo);
    const now = new Date().toISOString();

    if (existing) {
      existing.total_working_days = totalWorking;
      existing.days_present = daysPresent;
      existing.attendance_percentage = percentage;
      existing.status = status;
      if (finalizedBy) {
        existing.finalized_by = finalizedBy;
        existing.finalized_at = now;
      }
      existing.updated_at = now;
      return [{ insertId: existing.id, affectedRows: 1 }, []];
    } else {
      const nextId = m.monthlyAttendance.length > 0 ? Math.max(...m.monthlyAttendance.map((a: any) => a.id)) + 1 : 1;
      const newRec: MemoryMonthlyAttendance = {
        id: nextId,
        teacher_id: tid,
        year: yr,
        month: mo,
        total_working_days: totalWorking,
        days_present: daysPresent,
        attendance_percentage: percentage,
        status: status as any,
        finalized_by: finalizedBy,
        finalized_at: status === 'FINALIZED' ? now : null,
        created_at: now,
        updated_at: now,
      };
      m.monthlyAttendance.push(newRec);
      return [{ insertId: nextId, affectedRows: 1 }, []];
    }
  }

  if (upper.startsWith('UPDATE MONTHLY_ATTENDANCE') || upper.startsWith('UPDATE `MONTHLY_ATTENDANCE`')) {
    const now = new Date().toISOString();
    if (upper.includes('WHERE ID = ?')) {
      const id = Number(params[params.length - 1]);
      const rec = m.monthlyAttendance.find((a: any) => a.id === id);
      if (rec) {
        if (upper.includes('STATUS = "FINALIZED"') || upper.includes("STATUS = 'FINALIZED'")) {
          rec.status = 'FINALIZED';
          rec.finalized_by = params[0] !== undefined && params[0] !== null ? Number(params[0]) : null;
          rec.finalized_at = now;
        }
        rec.updated_at = now;
        return [{ affectedRows: 1 }, []];
      }
    }
    if (upper.includes('WHERE YEAR = ? AND MONTH = ?')) {
      const yr = Number(params[params.length - 2]);
      const mo = Number(params[params.length - 1]);
      let updatedCount = 0;
      m.monthlyAttendance.forEach((rec: any) => {
        if (rec.year === yr && rec.month === mo) {
          rec.status = 'FINALIZED';
          rec.finalized_by = params[0] !== undefined && params[0] !== null ? Number(params[0]) : null;
          rec.finalized_at = now;
          rec.updated_at = now;
          updatedCount++;
        }
      });
      return [{ affectedRows: updatedCount }, []];
    }
    return [{ affectedRows: 0 }, []];
  }

  return null;
}
