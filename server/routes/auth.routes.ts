import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getPool } from '../db.ts';
import { requireAuth } from '../middleware/auth.ts';
import { validateCsrf, generateCsrfToken, setCsrfCookie } from '../middleware/csrf.ts';
import { recordAuditLog } from '../services/audit.ts';
import { NON_LOGIN_ROLES } from '../permissions.ts';

export const authRouter = Router();

const SESSION_DURATION_MS = 60 * 60 * 1000; // 1 hour
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes
// Precomputed dummy bcrypt hash (cost 12) for constant-time comparison when identifier is not found
const DUMMY_BCRYPT_HASH = '$2b$12$KIX9s2Z9K7q4L2M1N0P8OeQ3R5S7T9U1V3W5X7Y9Z1a3b5c7d9e1f';

/**
 * GET /api/auth/csrf
 * Returns a fresh CSRF token and sets the kamch_csrf cookie.
 */
authRouter.get('/csrf', (req: Request, res: Response) => {
  let token = req.cookies?.kamch_csrf;
  if (!token || typeof token !== 'string' || token.length < 16) {
    token = generateCsrfToken();
  }
  const isSecure = Boolean(req.secure || req.headers['x-forwarded-proto'] === 'https');
  setCsrfCookie(res, token, isSecure);
  res.json({ csrfToken: token });
});

/**
 * POST /api/auth/login
 * Public authentication endpoint:
 * - Accepts unique username or registered email address
 * - Validates credentials using bcrypt without leaking account existence
 * - Enforces 6 consecutive failed attempts -> 30-minute automatic lockout
 * - Invalidates previous active sessions (single active session enforcement)
 * - Sets secure HTTP-only session cookie & CSRF token
 */
authRouter.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { usernameOrEmail, password } = req.body || {};

  if (
    !usernameOrEmail ||
    !password ||
    typeof usernameOrEmail !== 'string' ||
    typeof password !== 'string' ||
    usernameOrEmail.trim() === '' ||
    password === ''
  ) {
    res.status(400).json({
      error: 'Username or email and password are required',
      code: 'MISSING_CREDENTIALS',
    });
    return;
  }

  const identifier = usernameOrEmail.trim();
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Query user by username or non-null email with row lock to prevent race conditions
    const [userRows] = await connection.query<any[]>(
      `SELECT 
        u.id, 
        u.username, 
        u.email, 
        u.password_hash, 
        u.role_id, 
        u.department_id,
        d.name AS department_name,
        u.teacher_id,
        t.employee_code AS teacher_employee_code,
        t.teacher_code,
        t.designation AS teacher_designation,
        u.full_name,
        u.must_change_password, 
        u.failed_attempts, 
        u.is_locked, 
        u.locked_at,
        u.is_suspended, 
        u.suspended_at,
        u.is_deactivated,
        r.code AS role_code, 
        r.name AS role_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN departments d ON u.department_id = d.id
       LEFT JOIN teachers t ON u.teacher_id = t.id
       WHERE u.username = ? OR (u.email IS NOT NULL AND u.email = ?)
       LIMIT 1
       FOR UPDATE`,
      [identifier, identifier]
    );

    // Constant-time generic rejection if user not found (never reveals whether username/email exists)
    if (!userRows || userRows.length === 0) {
      await connection.commit();
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH).catch(() => false);
      await recordAuditLog({
        action: 'LOGIN_FAILED',
        targetType: 'USER',
        ipAddress: req.ip || null,
        details: { reason: 'invalid_credentials' },
      });

      res.status(401).json({
        error: 'Invalid username/email or password',
        code: 'INVALID_CREDENTIALS',
      });
      return;
    }

    const user = userRows[0];

    // Block Student and Faculty login accounts in this phase
    if (NON_LOGIN_ROLES.includes(user.role_code)) {
      await connection.commit();
      await recordAuditLog({
        actorId: user.id,
        action: 'LOGIN_REJECTED_ROLE_DISABLED',
        targetType: 'USER',
        targetId: String(user.id),
        ipAddress: req.ip || null,
        details: { role: user.role_code },
      });

      res.status(401).json({
        error: 'Invalid username/email or password',
        code: 'INVALID_CREDENTIALS',
      });
      return;
    }

    // Check if account is deactivated
    if (user.is_deactivated) {
      await connection.commit();
      await recordAuditLog({
        actorId: user.id,
        action: 'LOGIN_REJECTED_DEACTIVATED',
        targetType: 'USER',
        targetId: String(user.id),
        ipAddress: req.ip || null,
      });

      res.status(403).json({
        error: 'This account is not active. Please contact the institutional administration.',
        code: 'ACCOUNT_DEACTIVATED',
      });
      return;
    }

    // Check if account is suspended
    if (user.is_suspended) {
      await connection.commit();
      await recordAuditLog({
        actorId: user.id,
        action: 'LOGIN_REJECTED_SUSPENDED',
        targetType: 'USER',
        targetId: String(user.id),
        ipAddress: req.ip || null,
      });

      res.status(403).json({
        error: 'This account has been suspended. Please contact the institutional administration.',
        code: 'ACCOUNT_SUSPENDED',
      });
      return;
    }

    // 30-Minute Temporary Lockout Check (Applies equally to username and email login)
    const nowMs = Date.now();

    if (user.is_locked) {
      const lockedAtMs = user.locked_at ? new Date(user.locked_at).getTime() : nowMs;
      const elapsedMs = nowMs - lockedAtMs;

      if (elapsedMs < LOCKOUT_DURATION_MS) {
        // Active lockout: even valid credentials CANNOT bypass an active lockout
        const remainingMinutes = Math.max(1, Math.ceil((LOCKOUT_DURATION_MS - elapsedMs) / 60000));
        await connection.commit();
        await recordAuditLog({
          actorId: user.id,
          action: 'LOGIN_REJECTED_LOCKED',
          targetType: 'USER',
          targetId: String(user.id),
          ipAddress: req.ip || null,
          details: { remainingMinutes },
        });

        res.status(403).json({
          error: `This account is temporarily locked due to multiple failed login attempts. Please try again after ${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}.`,
          code: 'ACCOUNT_LOCKED',
        });
        return;
      } else {
        // 30-minute lockout period has expired automatically without requiring admin unlock
        await connection.query(
          'UPDATE users SET is_locked = FALSE, locked_at = NULL, failed_attempts = 0 WHERE id = ?',
          [user.id]
        );
        user.is_locked = false;
        user.locked_at = null;
        user.failed_attempts = 0;
      }
    }

    // Verify password with bcrypt
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      const newAttempts = Number(user.failed_attempts || 0) + 1;

      if (newAttempts >= 6) {
        // Six consecutive failed attempts trigger 30-minute lockout and invalidate any active sessions
        await connection.query(
          'UPDATE users SET failed_attempts = ?, is_locked = TRUE, locked_at = NOW() WHERE id = ?',
          [newAttempts, user.id]
        );
        await connection.query(
          'UPDATE sessions SET is_active = FALSE WHERE user_id = ? AND is_active = TRUE',
          [user.id]
        );
        await connection.commit();

        await recordAuditLog({
          actorId: user.id,
          action: 'ACCOUNT_LOCKED',
          targetType: 'USER',
          targetId: String(user.id),
          ipAddress: req.ip || null,
          details: { consecutiveFailures: newAttempts, lockoutMinutes: 30 },
        });

        res.status(403).json({
          error: 'This account has been temporarily locked for 30 minutes due to 6 consecutive failed login attempts.',
          code: 'ACCOUNT_LOCKED',
        });
        return;
      } else {
        await connection.query(
          'UPDATE users SET failed_attempts = ? WHERE id = ?',
          [newAttempts, user.id]
        );
        await connection.commit();

        await recordAuditLog({
          actorId: user.id,
          action: 'LOGIN_FAILED',
          targetType: 'USER',
          targetId: String(user.id),
          ipAddress: req.ip || null,
          details: { failureCount: newAttempts },
        });

        res.status(401).json({
          error: 'Invalid username/email or password',
          code: 'INVALID_CREDENTIALS',
        });
        return;
      }
    }

    // Password is valid: reset consecutive failed attempts and lockout counter
    await connection.query(
      'UPDATE users SET failed_attempts = 0, is_locked = FALSE, locked_at = NULL WHERE id = ?',
      [user.id]
    );

    // Single active session enforcement:
    // Invalidate any existing active sessions for this user within the locked transaction
    const [prevSessionResult] = await connection.query<any>(
      'UPDATE sessions SET is_active = FALSE WHERE user_id = ? AND is_active = TRUE',
      [user.id]
    );
    const invalidatedCount = prevSessionResult?.affectedRows || 0;

    // Generate cryptographically secure random session token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await connection.query(
      `INSERT INTO sessions 
        (user_id, token_hash, ip_address, user_agent, last_activity_at, expires_at, is_active)
       VALUES (?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 1 HOUR), TRUE)`,
      [
        user.id,
        tokenHash,
        req.ip || null,
        req.headers['user-agent']?.slice(0, 255) || null,
      ]
    );

    await connection.commit();

    if (invalidatedCount > 0) {
      await recordAuditLog({
        actorId: user.id,
        action: 'PREVIOUS_SESSION_INVALIDATED',
        targetType: 'USER',
        targetId: String(user.id),
        ipAddress: req.ip || null,
        details: { invalidatedCount },
      });
    }

    const isConnectionSecure = Boolean(req.secure || req.headers['x-forwarded-proto'] === 'https');

    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken, isConnectionSecure);

    res.cookie('kamch_session', rawToken, {
      httpOnly: true,
      secure: isConnectionSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_DURATION_MS,
    });

    await recordAuditLog({
      actorId: user.id,
      action: 'LOGIN_SUCCESS',
      targetType: 'USER',
      targetId: String(user.id),
      ipAddress: req.ip || null,
      details: { role: user.role_code, mustChangePassword: Boolean(user.must_change_password) },
    });

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email || null,
        fullName: user.full_name,
        roleId: user.role_id,
        role: user.role_code,
        roleName: user.role_name,
        mustChangePassword: Boolean(user.must_change_password),
        departmentId: user.department_id || null,
        departmentName: user.department_name || null,
        teacherId: user.teacher_id || null,
        teacherEmployeeCode: user.teacher_employee_code || null,
        teacherCode: user.teacher_code || null,
        teacherDesignation: user.teacher_designation || null,
      },
      csrfToken,
    });
  } catch (err) {
    await connection.rollback();
    console.error('[KAMCH Auth] Login error:', (err as Error).message);
    res.status(500).json({
      error: 'Internal server error during authentication',
      code: 'LOGIN_INTERNAL_ERROR',
    });
  } finally {
    connection.release();
  }
});

/**
 * GET /api/auth/me
 * Returns authenticated user details and flags. Protected by session verification.
 */
authRouter.get('/me', requireAuth, (req: Request, res: Response) => {
  let csrfToken = req.cookies?.kamch_csrf;
  const isSecure = Boolean(req.secure || req.headers['x-forwarded-proto'] === 'https');
  if (!csrfToken || typeof csrfToken !== 'string') {
    csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken, isSecure);
  }

  res.json({
    user: req.user,
    csrfToken,
  });
});

/**
 * POST /api/auth/change-password
 * First-login or user self-service password change:
 * - Requires authentication and CSRF token
 * - Requires current password confirmation
 * - Enforces minimum 8 characters and differs from temporary/current password
 * - Hashes with bcrypt (salt rounds 12)
 * - Clears must_change_password flag
 */
authRouter.post('/change-password', requireAuth, validateCsrf, async (req: Request, res: Response): Promise<void> => {
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword || typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    res.status(400).json({
      error: 'Current password and new password are required',
      code: 'MISSING_FIELDS',
    });
    return;
  }

  if (newPassword.length < 8) {
    res.status(400).json({
      error: 'New password must be at least 8 characters long',
      code: 'PASSWORD_TOO_SHORT',
    });
    return;
  }

  if (currentPassword === newPassword) {
    res.status(400).json({
      error: 'New password must be different from your current password',
      code: 'PASSWORD_UNCHANGED',
    });
    return;
  }

  const userId = req.user!.id;
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.query<any[]>(
      'SELECT id, password_hash FROM users WHERE id = ? LIMIT 1 FOR UPDATE',
      [userId]
    );

    if (!rows || rows.length === 0) {
      await connection.rollback();
      res.status(404).json({
        error: 'User account not found',
        code: 'USER_NOT_FOUND',
      });
      return;
    }

    const isCurrentValid = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!isCurrentValid) {
      await connection.rollback();
      await recordAuditLog({
        actorId: userId,
        action: 'PASSWORD_CHANGE_FAILED',
        targetType: 'USER',
        targetId: String(userId),
        ipAddress: req.ip || null,
        details: { reason: 'incorrect_current_password' },
      });

      res.status(400).json({
        error: 'Current password does not match our records',
        code: 'INVALID_CURRENT_PASSWORD',
      });
      return;
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    await connection.query(
      'UPDATE users SET password_hash = ?, must_change_password = FALSE WHERE id = ?',
      [newHash, userId]
    );

    await connection.commit();

    await recordAuditLog({
      actorId: userId,
      action: 'PASSWORD_CHANGED',
      targetType: 'USER',
      targetId: String(userId),
      ipAddress: req.ip || null,
      details: { mustChangePasswordCleared: true },
    });

    res.json({
      success: true,
      message: 'Password changed successfully. Your account is now fully active.',
    });
  } catch (err) {
    await connection.rollback();
    console.error('[KAMCH Auth] Password change error:', (err as Error).message);
    res.status(500).json({
      error: 'Internal error changing password',
      code: 'PASSWORD_CHANGE_INTERNAL_ERROR',
    });
  } finally {
    connection.release();
  }
});

/**
 * POST /api/auth/logout
 * Terminates session in database, clears HTTP-only cookie, and logs audit record.
 */
authRouter.post('/logout', validateCsrf, async (req: Request, res: Response): Promise<void> => {
  const token = req.cookies?.kamch_session;

  if (token && typeof token === 'string') {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    try {
      const pool = getPool();
      const [rows] = await pool.query<any[]>(
        'SELECT id, user_id FROM sessions WHERE token_hash = ? LIMIT 1',
        [tokenHash]
      );
      if (rows && rows.length > 0) {
        await pool.query('UPDATE sessions SET is_active = FALSE WHERE id = ?', [rows[0].id]);
        await recordAuditLog({
          actorId: rows[0].user_id,
          action: 'LOGOUT',
          targetType: 'SESSION',
          targetId: String(rows[0].id),
          ipAddress: req.ip || null,
        });
      }
    } catch (err) {
      console.warn('[KAMCH Auth] Error during session logout cleanup:', (err as Error).message);
    }
  }

  res.clearCookie('kamch_session', { path: '/' });
  res.clearCookie('kamch_csrf', { path: '/' });

  res.json({
    success: true,
    message: 'Logged out successfully',
  });
});
