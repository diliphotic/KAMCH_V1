import { getPool } from '../db.ts';

export interface MonthlyAttendance {
  id: number;
  teacher_id: number;
  year: number;
  month: number;
  total_working_days: number;
  days_present: number;
  attendance_percentage: number;
  status: 'PENDING' | 'FINALIZED';
  finalized_by?: number;
  finalized_at?: Date;
}

export const AttendanceService = {
  async getTeacherAttendance(teacherId: number, year: number, month: number): Promise<MonthlyAttendance | null> {
    const pool = getPool();
    const [rows] = await pool.query<any[]>(
      'SELECT * FROM monthly_attendance WHERE teacher_id = ? AND year = ? AND month = ?',
      [teacherId, year, month]
    );
    return rows.length > 0 ? rows[0] : null;
  },

  async getAllReports(year: number, month: number): Promise<any[]> {
    const pool = getPool();
    const [rows] = await pool.query<any[]>(
      `SELECT ma.*, t.full_name as teacher_name, t.employee_code 
       FROM monthly_attendance ma 
       JOIN teachers t ON ma.teacher_id = t.id 
       WHERE ma.year = ? AND ma.month = ?`,
      [year, month]
    );
    return rows;
  },

  async upsertAttendance(data: Omit<MonthlyAttendance, 'id' | 'attendance_percentage' | 'status'> & { finalized_by?: number, status?: 'PENDING' | 'FINALIZED' }): Promise<void> {
    const percentage = (data.days_present / data.total_working_days) * 100;
    const pool = getPool();
    await pool.query(
      `INSERT INTO monthly_attendance 
       (teacher_id, year, month, total_working_days, days_present, attendance_percentage, status, finalized_by) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
       total_working_days = VALUES(total_working_days), 
       days_present = VALUES(days_present), 
       attendance_percentage = VALUES(attendance_percentage),
       status = VALUES(status),
       finalized_by = VALUES(finalized_by)`,
      [data.teacher_id, data.year, data.month, data.total_working_days, data.days_present, percentage, data.status || 'PENDING', data.finalized_by || null]
    );
  },

  async getReportById(id: number): Promise<MonthlyAttendance | null> {
    const pool = getPool();
    const [rows] = await pool.query<any[]>(
      'SELECT * FROM monthly_attendance WHERE id = ?',
      [id]
    );
    return rows.length > 0 ? rows[0] : null;
  },

  async createNotification(userId: number, title: string, message: string, type: string, relatedId: number | null): Promise<void> {
    const pool = getPool();
    await pool.query(
      'INSERT INTO notifications (user_id, title, message, type, related_id) VALUES (?, ?, ?, ?, ?)',
      [userId, title, message, type, relatedId]
    );
  },

  async finalizeReport(id: number, userId: number): Promise<void> {
    const pool = getPool();
    await pool.query(
      'UPDATE monthly_attendance SET status = "FINALIZED", finalized_by = ?, finalized_at = NOW() WHERE id = ? AND status = "PENDING"',
      [userId, id]
    );
  }
};
