import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getPool } from '../db.ts';
import { recordAuditLog } from '../services/audit.ts';
import { NON_LOGIN_ROLES } from '../permissions.ts';

export interface AuthUser {
  id: number;
  username: string;
  email: string | null;
  fullName: string;
  roleId: number;
  role: string;
  roleName: string;
  mustChangePassword: boolean;
  departmentId?: number | null;
  departmentName?: string | null;
  teacherId?: number | null;
  teacherEmployeeCode?: string | null;
  teacherCode?: string | null;
  teacherDesignation?: string | null;
}

export interface SessionRecord {
  id: number;
  userId: number;
  lastActivityAt: Date;
  expiresAt: Date;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionRecord?: SessionRecord;
    }
  }
}

const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Validates session token from secure HTTP-only cookie,
 * checks inactivity timeout, verifies account status, and updates last activity.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.kamch_session;

  if (!token || typeof token !== 'string') {
    res.status(401).json({
      error: 'Authentication required',
      code: 'UNAUTHENTICATED',
    });
    return;
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  try {
    const pool = getPool();
    const [rows] = await pool.query<any[]>(
      `SELECT 
        s.id AS session_id,
        s.user_id,
        s.last_activity_at,
        s.expires_at,
        s.is_active,
        (SELECT COUNT(*) FROM sessions s2 WHERE s2.user_id = s.user_id AND s2.is_active = TRUE AND s2.id > s.id) AS newer_active_sessions,
        u.id AS user_id,
        u.username,
        u.email,
        u.full_name,
        u.role_id,
        u.department_id,
        d.name AS department_name,
        u.teacher_id,
        t.employee_code AS teacher_employee_code,
        t.teacher_code AS teacher_code,
        t.designation AS teacher_designation,
        u.must_change_password,
        u.is_locked,
        u.locked_at,
        u.is_suspended,
        u.is_deactivated,
        r.code AS role_code,
        r.name AS role_name
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN departments d ON u.department_id = d.id
       LEFT JOIN teachers t ON u.teacher_id = t.id
       WHERE s.token_hash = ?
       LIMIT 1`,
      [tokenHash]
    );

    if (!rows || rows.length === 0) {
      res.clearCookie('kamch_session', { path: '/' });
      res.status(401).json({
        error: 'Invalid session',
        code: 'INVALID_SESSION',
      });
      return;
    }

    const row = rows[0];

    // Single active session enforcement:
    // Reject if session is explicitly inactive OR superseded by a newer session for this user
    if (!row.is_active || Number(row.newer_active_sessions) > 0) {
      if (row.is_active) {
        await pool.query('UPDATE sessions SET is_active = FALSE WHERE id = ?', [row.session_id]);
      }
      res.clearCookie('kamch_session', { path: '/' });
      res.clearCookie('kamch_csrf', { path: '/' });

      res.status(401).json({
        error: 'Session has been superseded by a newer login on another device or terminated',
        code: 'SESSION_SUPERSEDED',
      });
      return;
    }

    const lastActivityTime = new Date(row.last_activity_at).getTime();
    const expiresTime = new Date(row.expires_at).getTime();
    const now = Date.now();

    // Check 1-hour inactivity timeout or absolute expiration
    if (now - lastActivityTime > INACTIVITY_TIMEOUT_MS || now > expiresTime) {
      await pool.query('UPDATE sessions SET is_active = FALSE WHERE id = ?', [row.session_id]);
      await recordAuditLog({
        actorId: row.user_id,
        action: 'SESSION_EXPIRED',
        targetType: 'SESSION',
        targetId: String(row.session_id),
        ipAddress: req.ip || null,
        details: { reason: 'inactivity_timeout_1_hour' },
      });

      res.clearCookie('kamch_session', { path: '/' });
      res.status(401).json({
        error: 'Session expired due to 1 hour of inactivity. Please log in again.',
        code: 'SESSION_EXPIRED',
      });
      return;
    }

    // Block non-login record roles (Student / Faculty) in this phase
    if (NON_LOGIN_ROLES.includes(row.role_code)) {
      await pool.query('UPDATE sessions SET is_active = FALSE WHERE id = ?', [row.session_id]);
      res.clearCookie('kamch_session', { path: '/' });
      res.status(403).json({
        error: 'Portal login is not enabled for this record type.',
        code: 'ROLE_LOGIN_DISABLED',
      });
      return;
    }

    // Check account lockout status (30-minute automatic window)
    if (row.is_locked) {
      const lockedAtMs = row.locked_at ? new Date(row.locked_at).getTime() : now;
      if (now - lockedAtMs < LOCKOUT_DURATION_MS) {
        await pool.query('UPDATE sessions SET is_active = FALSE WHERE id = ?', [row.session_id]);
        res.clearCookie('kamch_session', { path: '/' });
        res.status(403).json({
          error: 'This account is temporarily locked. Please try again after the lockout period expires.',
          code: 'ACCOUNT_LOCKED',
        });
        return;
      } else {
        await pool.query(
          'UPDATE users SET is_locked = FALSE, locked_at = NULL, failed_attempts = 0 WHERE id = ?',
          [row.user_id]
        );
      }
    }

    // Check account suspension status
    if (row.is_suspended) {
      await pool.query('UPDATE sessions SET is_active = FALSE WHERE id = ?', [row.session_id]);
      res.clearCookie('kamch_session', { path: '/' });
      res.status(403).json({
        error: 'This account has been suspended. Please contact the administration.',
        code: 'ACCOUNT_SUSPENDED',
      });
      return;
    }

    // Check account deactivation status
    if (row.is_deactivated) {
      await pool.query('UPDATE sessions SET is_active = FALSE WHERE id = ?', [row.session_id]);
      res.clearCookie('kamch_session', { path: '/' });
      res.status(403).json({
        error: 'This account has been deactivated. Historical records have been preserved.',
        code: 'ACCOUNT_DEACTIVATED',
      });
      return;
    }

    // Safe activity timestamp renewal (updates last_activity_at and pushes expires_at by 1 hour)
    await pool.query(
      `UPDATE sessions 
       SET last_activity_at = NOW(), 
           expires_at = DATE_ADD(NOW(), INTERVAL 1 HOUR) 
       WHERE id = ?`,
      [row.session_id]
    );

    // Attach verified user and session to request
    req.user = {
      id: row.user_id,
      username: row.username,
      email: row.email || null,
      fullName: row.full_name,
      roleId: row.role_id,
      role: row.role_code,
      roleName: row.role_name,
      mustChangePassword: Boolean(row.must_change_password),
      departmentId: row.department_id || null,
      departmentName: row.department_name || null,
      teacherId: row.teacher_id || null,
      teacherEmployeeCode: row.teacher_employee_code || null,
      teacherCode: row.teacher_code || null,
      teacherDesignation: row.teacher_designation || null,
    };

    req.sessionRecord = {
      id: row.session_id,
      userId: row.user_id,
      lastActivityAt: new Date(),
      expiresAt: new Date(Date.now() + INACTIVITY_TIMEOUT_MS),
    };

    next();
  } catch (err) {
    console.error('[KAMCH Auth] Session verification error:', (err as Error).message);
    res.status(500).json({
      error: 'Authentication verification failed',
      code: 'AUTH_INTERNAL_ERROR',
    });
  }
}

/**
 * Middleware ensuring accounts flagged with must_change_password cannot
 * access general ERP application endpoints until their password has been changed.
 */
export function requirePasswordChangeClear(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.mustChangePassword) {
    res.status(403).json({
      error: 'You must change your initial password before accessing the system',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
    return;
  }
  next();
}

/**
 * Reusable role-based authorization guard for protecting endpoints.
 */
export function requireRoles(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'Authentication required',
        code: 'UNAUTHENTICATED',
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      void recordAuditLog({
        actorId: req.user.id,
        action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
        targetType: 'ENDPOINT',
        targetId: req.originalUrl?.slice(0, 50) || req.path.slice(0, 50),
        ipAddress: req.ip || null,
        details: {
          method: req.method,
          path: req.originalUrl || req.path,
          userRole: req.user.role,
        },
      });
      res.status(403).json({
        error: 'Access denied: insufficient permissions',
        code: 'FORBIDDEN',
      });
      return;
    }

    next();
  };
}
