import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { getPool } from '../db.ts';
import { requireAuth, requirePasswordChangeClear, requireRoles } from '../middleware/auth.ts';
import { validateCsrf } from '../middleware/csrf.ts';
import { recordAuditLog } from '../services/audit.ts';
import {
  ROLES,
  ASSIGNABLE_ACCOUNT_ROLES,
  NON_LOGIN_ROLES,
  USER_MANAGEMENT_ROLES,
} from '../permissions.ts';

export const userRouter = Router();

const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

function isEffectivelyLocked(isLocked: any, lockedAt: any): boolean {
  if (!isLocked) return false;
  if (!lockedAt) return false;
  return Date.now() - new Date(lockedAt).getTime() < LOCKOUT_DURATION_MS;
}

function sanitizeAuditDetails(details: any): any {
  if (!details) return null;
  let parsed = details;
  if (typeof details === 'string') {
    try {
      parsed = JSON.parse(details);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (/password|hash|token|secret|cookie/i.test(k)) continue;
    copy[k] = v;
  }
  return copy;
}

// Apply session authentication and mandatory password-change clearance to all user routes
userRouter.use(requireAuth);
userRouter.use(requirePasswordChangeClear);

/**
 * GET /api/users/roles
 * Returns supported login account roles for creation/assignment and directory filtering.
 * - Excludes STUDENT and FACULTY (institutional records only, no login in this phase).
 * - Excludes SUPER_ADMIN from assignable roles (provisioned only via db:init).
 * - Includes SUPER_ADMIN in filterRoles ONLY when requester is SUPER_ADMIN.
 */
userRouter.get(
  '/roles',
  requireRoles(...USER_MANAGEMENT_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const pool = getPool();
      const isSuperAdmin = req.user!.role === ROLES.SUPER_ADMIN;

      const [rows] = await pool.query<any[]>(
        'SELECT id, code, name, description FROM roles ORDER BY id ASC'
      );

      const assignableRoles = rows.filter((r) =>
        ASSIGNABLE_ACCOUNT_ROLES.includes(r.code)
      );
      const filterRoles = isSuperAdmin
        ? rows.filter(
            (r) =>
              r.code === ROLES.SUPER_ADMIN || ASSIGNABLE_ACCOUNT_ROLES.includes(r.code)
          )
        : assignableRoles;

      res.json({
        roles: assignableRoles,
        assignableRoles,
        filterRoles,
      });
    } catch (err) {
      console.error('[KAMCH Users] Error fetching roles:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve roles', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * GET /api/users/departments
 * Returns institutional departments.
 * - Accessible to SUPER_ADMIN, PRINCIPAL, SECRETARY (includes active assigned department account summary)
 * - Accessible to OFFICE / STAFF (returns department metadata only for teacher record dropdowns)
 */
userRouter.get(
  '/departments',
  requireRoles(ROLES.SUPER_ADMIN, ROLES.PRINCIPAL, ROLES.SECRETARY, ROLES.OFFICE, ROLES.STAFF),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const pool = getPool();
      const canManageUsers = USER_MANAGEMENT_ROLES.includes(req.user!.role);

      const [rows] = await pool.query<any[]>(
        `SELECT 
          d.id,
          d.code,
          d.name,
          d.description,
          d.is_active,
          (SELECT COUNT(*) FROM teachers t WHERE t.department_id = d.id AND t.status = 'ACTIVE') AS teacher_count,
          u.id AS assigned_user_id,
          u.username AS assigned_username,
          u.full_name AS assigned_full_name,
          u.email AS assigned_email,
          u.is_suspended AS assigned_is_suspended,
          u.is_locked AS assigned_is_locked,
          u.locked_at AS assigned_locked_at,
          u.must_change_password AS assigned_must_change_password
         FROM departments d
         LEFT JOIN users u ON u.department_id = d.id AND u.is_deactivated = FALSE
         ORDER BY d.name ASC`
      );

      res.json({
        departments: rows.map((d) => ({
          id: d.id,
          code: d.code,
          name: d.name,
          description: d.description || '',
          isActive: Boolean(d.is_active),
          teacherCount: Number(d.teacher_count || 0),
          assignedAccount:
            canManageUsers && d.assigned_user_id
              ? {
                  id: d.assigned_user_id,
                  username: d.assigned_username,
                  fullName: d.assigned_full_name,
                  email: d.assigned_email || null,
                  isSuspended: Boolean(d.assigned_is_suspended),
                  isLocked: isEffectivelyLocked(d.assigned_is_locked, d.assigned_locked_at),
                  mustChangePassword: Boolean(d.assigned_must_change_password),
                }
              : null,
        })),
      });
    } catch (err) {
      console.error('[KAMCH Users] Error fetching departments:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve departments', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * GET /api/users/available-teachers
 * Returns institutional teachers for linking to user accounts.
 * Accessible to authorized administrators (Super Admin, Principal, Secretary).
 */
userRouter.get(
  '/available-teachers',
  requireRoles(...USER_MANAGEMENT_ROLES),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const pool = getPool();
      const [rows] = await pool.query<any[]>(
        `SELECT 
          t.id,
          t.employee_code,
          t.teacher_code,
          t.teacher_code_status,
          t.registration_number,
          t.full_name,
          t.designation,
          t.department_id,
          d.name AS department_name,
          d.code AS department_code,
          t.contact_email,
          t.contact_phone,
          u.id AS linked_user_id,
          u.username AS linked_username
         FROM teachers t
         LEFT JOIN departments d ON t.department_id = d.id
         LEFT JOIN users u ON u.teacher_id = t.id AND u.is_deactivated = FALSE
         WHERE t.status = 'ACTIVE'
         ORDER BY t.full_name ASC`
      );

      res.json({
        teachers: rows.map((t) => ({
          id: t.id,
          employeeCode: t.employee_code || '',
          teacherCode: t.teacher_code || '',
          teacherCodeStatus: t.teacher_code_status || 'NOT_PROVIDED',
          registrationNumber: t.registration_number || '',
          fullName: t.full_name,
          designation: t.designation,
          departmentId: t.department_id,
          departmentName: t.department_name || '',
          departmentCode: t.department_code || '',
          contactEmail: t.contact_email || '',
          contactPhone: t.contact_phone || '',
          isLinked: Boolean(t.linked_user_id),
          linkedUserId: t.linked_user_id || null,
          linkedUsername: t.linked_username || null,
        })),
      });
    } catch (err) {
      console.error('[KAMCH Users] Error fetching available teachers:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve teachers list', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * GET /api/users/teachers
 * Alias for available teachers list for frontend notification recipient components.
 */
userRouter.get(
  '/teachers',
  requireRoles(...USER_MANAGEMENT_ROLES, ROLES.PRINCIPAL, ROLES.SUPER_ADMIN),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const pool = getPool();
      const [rows] = await pool.query<any[]>(
        `SELECT 
          t.id,
          t.employee_code,
          t.teacher_code,
          t.teacher_code_status,
          t.registration_number,
          t.full_name,
          t.designation,
          t.department_id,
          d.name AS department_name,
          d.code AS department_code,
          t.contact_email,
          t.contact_phone,
          u.id AS linked_user_id,
          u.username AS linked_username
         FROM teachers t
         LEFT JOIN departments d ON t.department_id = d.id
         LEFT JOIN users u ON u.teacher_id = t.id AND u.is_deactivated = FALSE
         WHERE t.status = 'ACTIVE'
         ORDER BY t.full_name ASC`
      );

      res.json({
        teachers: rows.map((t) => ({
          id: t.id,
          employeeCode: t.employee_code || '',
          teacherCode: t.teacher_code || '',
          teacherCodeStatus: t.teacher_code_status || 'NOT_PROVIDED',
          registrationNumber: t.registration_number || '',
          fullName: t.full_name,
          designation: t.designation,
          departmentId: t.department_id,
          departmentName: t.department_name || '',
          departmentCode: t.department_code || '',
          contactEmail: t.contact_email || '',
          contactPhone: t.contact_phone || '',
          isLinked: Boolean(t.linked_user_id),
          linkedUserId: t.linked_user_id || null,
          linkedUsername: t.linked_username || null,
        })),
      });
    } catch (err) {
      console.error('[KAMCH Users] Error fetching teachers alias:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve teachers list', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * POST /api/users/departments
 * Super Admin creates an institutional department.
 */
userRouter.post(
  '/departments',
  requireRoles(ROLES.SUPER_ADMIN),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const { code, name, description } = req.body || {};

    if (!code || !name || !String(code).trim() || !String(name).trim()) {
      res.status(400).json({
        error: 'Department code and name are required',
        code: 'MISSING_FIELDS',
      });
      return;
    }

    const cleanCode = String(code)
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '_');
    const cleanName = String(name).trim();
    const cleanDesc = description ? String(description).trim() : null;

    if (cleanCode.length < 2 || cleanCode.length > 50) {
      res.status(400).json({
        error: 'Department code must be between 2 and 50 characters',
        code: 'INVALID_CODE',
      });
      return;
    }

    try {
      const pool = getPool();
      const [existing] = await pool.query<any[]>(
        'SELECT id FROM departments WHERE code = ? LIMIT 1',
        [cleanCode]
      );
      if (existing && existing.length > 0) {
        res.status(409).json({
          error: 'A department with this code already exists',
          code: 'DUPLICATE_CODE',
        });
        return;
      }

      const [result] = await pool.query<any>(
        'INSERT INTO departments (code, name, description, is_active) VALUES (?, ?, ?, TRUE)',
        [cleanCode, cleanName, cleanDesc]
      );

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'DEPARTMENT_CREATED',
        targetType: 'DEPARTMENT',
        targetId: String(result.insertId),
        ipAddress: req.ip || null,
        details: { code: cleanCode, name: cleanName, description: cleanDesc },
      });

      res.status(201).json({
        success: true,
        department: {
          id: result.insertId,
          code: cleanCode,
          name: cleanName,
          description: cleanDesc,
          isActive: true,
        },
      });
    } catch (err) {
      console.error('[KAMCH Users] Error creating department:', (err as Error).message);
      res.status(500).json({ error: 'Failed to create department', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * PUT /api/users/departments/:id
 * Super Admin updates an institutional department (name, code, description, and active/deactive status).
 */
userRouter.put(
  '/departments/:id',
  requireRoles(ROLES.SUPER_ADMIN),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const deptId = parseInt(req.params.id, 10);
    const { code, name, description, isActive } = req.body || {};

    if (!deptId || isNaN(deptId)) {
      res.status(400).json({ error: 'Invalid department ID', code: 'INVALID_ID' });
      return;
    }
    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'Department name is required', code: 'MISSING_FIELDS' });
      return;
    }

    const cleanName = String(name).trim();
    const cleanDesc = description ? String(description).trim() : null;
    const nextActive = isActive !== undefined ? Boolean(isActive) : true;

    try {
      const pool = getPool();
      const [rows] = await pool.query<any[]>(
        'SELECT id, code, name, description, is_active FROM departments WHERE id = ? LIMIT 1',
        [deptId]
      );
      if (!rows || rows.length === 0) {
        res.status(404).json({ error: 'Department not found', code: 'NOT_FOUND' });
        return;
      }

      const existingDept = rows[0];
      const nextCode = code
        ? String(code).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_')
        : existingDept.code;

      if (nextCode !== existingDept.code) {
        const [dup] = await pool.query<any[]>(
          'SELECT id FROM departments WHERE code = ? AND id != ? LIMIT 1',
          [nextCode, deptId]
        );
        if (dup && dup.length > 0) {
          res.status(409).json({
            error: 'Another department already uses this code',
            code: 'DUPLICATE_CODE',
          });
          return;
        }
      }

      await pool.query(
        'UPDATE departments SET code = ?, name = ?, description = ?, is_active = ? WHERE id = ?',
        [nextCode, cleanName, cleanDesc, nextActive, deptId]
      );

      await recordAuditLog({
        actorId: req.user!.id,
        action: nextActive !== Boolean(existingDept.is_active) ? (nextActive ? 'DEPARTMENT_ACTIVATED' : 'DEPARTMENT_DEACTIVATED') : 'DEPARTMENT_UPDATED',
        targetType: 'DEPARTMENT',
        targetId: String(deptId),
        ipAddress: req.ip || null,
        details: {
          before: { code: existingDept.code, name: existingDept.name, description: existingDept.description, isActive: Boolean(existingDept.is_active) },
          after: { code: nextCode, name: cleanName, description: cleanDesc, isActive: nextActive },
        },
      });

      res.json({
        success: true,
        department: { id: deptId, code: nextCode, name: cleanName, description: cleanDesc, isActive: nextActive },
      });
    } catch (err) {
      console.error('[KAMCH Users] Error updating department:', (err as Error).message);
      res.status(500).json({ error: 'Failed to update department', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * GET /api/users/audit-logs
 * Returns security and account-management audit logs.
 * - Super Admin sees full institutional audit logs.
 * - Principal and Secretary see account-management logs strictly excluding any Super Admin actor or target.
 */
userRouter.get(
  '/audit-logs',
  requireRoles(...USER_MANAGEMENT_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const actionFilter = typeof req.query.action === 'string' ? req.query.action.trim() : '';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 50));
    const isSuperAdmin = req.user!.role === ROLES.SUPER_ADMIN;

    try {
      const pool = getPool();
      const whereClauses: string[] = [];
      const params: any[] = [];

      if (!isSuperAdmin) {
        whereClauses.push("(actor_role.code IS NULL OR actor_role.code != 'SUPER_ADMIN')");
        whereClauses.push(
          "NOT (al.target_type = 'USER' AND al.target_id IN (SELECT CAST(u2.id AS CHAR) FROM users u2 JOIN roles r2 ON u2.role_id = r2.id WHERE r2.code = 'SUPER_ADMIN'))"
        );
      }

      if (actionFilter && actionFilter !== 'ALL') {
        whereClauses.push('al.action = ?');
        params.push(actionFilter);
      }

      if (search) {
        whereClauses.push(
          '(al.action LIKE ? OR actor.username LIKE ? OR actor.full_name LIKE ?)'
        );
        const pat = `%${search}%`;
        params.push(pat, pat, pat);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      const [rows] = await pool.query<any[]>(
        `SELECT 
          al.id,
          al.actor_id,
          actor.username AS actor_username,
          actor.full_name AS actor_full_name,
          actor_role.code AS actor_role_code,
          al.action,
          al.target_type,
          al.target_id,
          al.ip_address,
          al.details,
          al.created_at
         FROM audit_logs al
         LEFT JOIN users actor ON al.actor_id = actor.id
         LEFT JOIN roles actor_role ON actor.role_id = actor_role.id
         ${whereSql}
         ORDER BY al.id DESC
         LIMIT ?`,
        [...params, limit]
      );

      res.json({
        logs: rows.map((row) => ({
          id: row.id,
          actorId: row.actor_id,
          actorUsername: row.actor_username || null,
          actorFullName: row.actor_full_name || 'System',
          action: row.action,
          targetType: row.target_type,
          targetId: row.target_id,
          ipAddress: row.ip_address,
          details: sanitizeAuditDetails(row.details),
          createdAt: row.created_at,
        })),
      });
    } catch (err) {
      console.error('[KAMCH Users] Error fetching audit logs:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve audit logs', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * GET /api/users
 * Lists and searches institutional accounts with pagination and filtering.
 * STRICT SECURITY: Principal and Secretary NEVER see the Super Admin account.
 */
userRouter.get(
  '/',
  requireRoles(...USER_MANAGEMENT_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const roleFilter = typeof req.query.role === 'string' ? req.query.role.trim() : '';
    const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const offset = (page - 1) * limit;
    const isSuperAdmin = req.user!.role === ROLES.SUPER_ADMIN;

    try {
      const pool = getPool();
      const whereClauses: string[] = [];
      const queryParams: any[] = [];

      // STRICT PROTECTION: Non-Super-Admin never sees Super Admin
      if (!isSuperAdmin) {
        whereClauses.push("r.code != 'SUPER_ADMIN'");
      }

      if (search) {
        whereClauses.push('(u.username LIKE ? OR u.email LIKE ? OR u.full_name LIKE ?)');
        const searchPattern = `%${search}%`;
        queryParams.push(searchPattern, searchPattern, searchPattern);
      }

      if (roleFilter && roleFilter !== 'ALL') {
        if (!isSuperAdmin && roleFilter === ROLES.SUPER_ADMIN) {
          // Return empty set if non-Super-Admin attempts to filter by SUPER_ADMIN
          res.json({
            users: [],
            pagination: { total: 0, page, limit, totalPages: 1 },
          });
          return;
        }
        whereClauses.push('r.code = ?');
        queryParams.push(roleFilter);
      }

      if (statusFilter === 'DEACTIVATED') {
        whereClauses.push('u.is_deactivated = TRUE');
      } else if (statusFilter === 'LOCKED') {
        whereClauses.push(
          'u.is_locked = TRUE AND u.locked_at IS NOT NULL AND u.locked_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE) AND u.is_deactivated = FALSE'
        );
      } else if (statusFilter === 'SUSPENDED') {
        whereClauses.push('u.is_suspended = TRUE AND u.is_deactivated = FALSE');
      } else if (statusFilter === 'ACTIVE') {
        whereClauses.push(
          '(u.is_locked = FALSE OR u.locked_at IS NULL OR u.locked_at <= DATE_SUB(NOW(), INTERVAL 30 MINUTE)) AND u.is_suspended = FALSE AND u.is_deactivated = FALSE'
        );
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      const [countRows] = await pool.query<any[]>(
        `SELECT COUNT(*) AS total 
         FROM users u 
         JOIN roles r ON u.role_id = r.id 
         ${whereSql}`,
        queryParams
      );
      const total = Number(countRows[0]?.total || 0);

      const [rows] = await pool.query<any[]>(
        `SELECT 
          u.id, 
          u.username, 
          u.email, 
          u.full_name, 
          u.role_id, 
          r.code AS role_code, 
          r.name AS role_name,
          u.department_id,
          d.name AS department_name,
          d.code AS department_code,
          u.teacher_id,
          t.full_name AS teacher_name,
          t.employee_code AS teacher_employee_code,
          t.teacher_code AS teacher_code,
          t.designation AS teacher_designation,
          u.must_change_password, 
          u.failed_attempts, 
          u.is_locked, 
          u.locked_at, 
          u.is_suspended, 
          u.suspended_at, 
          u.suspension_reason,
          u.is_deactivated,
          u.deactivated_at,
          u.deactivation_reason,
          u.created_by,
          creator.username AS created_by_username,
          creator_role.code AS created_by_role_code,
          u.created_at, 
          u.updated_at
         FROM users u
         JOIN roles r ON u.role_id = r.id
         LEFT JOIN departments d ON u.department_id = d.id
         LEFT JOIN teachers t ON u.teacher_id = t.id
         LEFT JOIN users creator ON u.created_by = creator.id
         LEFT JOIN roles creator_role ON creator.role_id = creator_role.id
         ${whereSql}
         ORDER BY u.id DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limit, offset]
      );

      res.json({
        users: rows.map((u) => {
          const lockedNow = isEffectivelyLocked(u.is_locked, u.locked_at);
          // Hide Super Admin username in createdBy field for non-Super-Admin viewers
          const safeCreatedBy =
            !isSuperAdmin && u.created_by_role_code === ROLES.SUPER_ADMIN
              ? 'System Administration'
              : u.created_by_username || null;

          return {
            id: u.id,
            username: u.username,
            email: u.email || null,
            fullName: u.full_name,
            roleId: u.role_id,
            role: u.role_code,
            roleName: u.role_name,
            departmentId: u.department_id || null,
            departmentName: u.department_name || null,
            departmentCode: u.department_code || null,
            teacherId: u.teacher_id || null,
            teacherName: u.teacher_name || null,
            teacherEmployeeCode: u.teacher_employee_code || null,
            teacherCode: u.teacher_code || null,
            teacherDesignation: u.teacher_designation || null,
            mustChangePassword: Boolean(u.must_change_password),
            failedAttempts: lockedNow ? Number(u.failed_attempts || 0) : 0,
            isLocked: lockedNow,
            lockedAt: lockedNow ? u.locked_at : null,
            isSuspended: Boolean(u.is_suspended),
            suspendedAt: u.suspended_at,
            suspensionReason: u.suspension_reason || null,
            isDeactivated: Boolean(u.is_deactivated),
            deactivatedAt: u.deactivated_at,
            deactivationReason: u.deactivation_reason || null,
            createdBy: safeCreatedBy,
            createdAt: u.created_at,
            updatedAt: u.updated_at,
          };
        }),
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    } catch (err) {
      console.error('[KAMCH Users] Error listing accounts:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve accounts', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * GET /api/users/:id/audit-logs
 * Per-account audit history.
 * Protected against Super Admin exposure to Principal / Secretary.
 */
userRouter.get(
  '/:id/audit-logs',
  requireRoles(...USER_MANAGEMENT_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const targetId = parseInt(req.params.id, 10);
    if (!targetId || isNaN(targetId)) {
      res.status(400).json({ error: 'Invalid user ID', code: 'INVALID_ID' });
      return;
    }

    const isSuperAdmin = req.user!.role === ROLES.SUPER_ADMIN;

    try {
      const pool = getPool();
      const [userRows] = await pool.query<any[]>(
        `SELECT u.id, r.code AS role_code
         FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE u.id = ? LIMIT 1`,
        [targetId]
      );

      if (!userRows || userRows.length === 0) {
        res.status(404).json({ error: 'User account not found', code: 'USER_NOT_FOUND' });
        return;
      }

      if (userRows[0].role_code === ROLES.SUPER_ADMIN && !isSuperAdmin) {
        await recordAuditLog({
          actorId: req.user!.id,
          action: 'UNAUTHORIZED_SUPERADMIN_ACCESS_ATTEMPT',
          targetType: 'USER',
          targetId: String(targetId),
          ipAddress: req.ip || null,
          details: { endpoint: 'GET /api/users/:id/audit-logs' },
        });
        res.status(403).json({
          error: 'Access denied: insufficient permissions',
          code: 'FORBIDDEN',
        });
        return;
      }

      const [rows] = await pool.query<any[]>(
        `SELECT 
          al.id,
          al.actor_id,
          actor.username AS actor_username,
          actor.full_name AS actor_full_name,
          actor_role.code AS actor_role_code,
          al.action,
          al.target_type,
          al.target_id,
          al.ip_address,
          al.details,
          al.created_at
         FROM audit_logs al
         LEFT JOIN users actor ON al.actor_id = actor.id
         LEFT JOIN roles actor_role ON actor.role_id = actor_role.id
         WHERE ((al.target_type = 'USER' AND al.target_id = ?) OR al.actor_id = ?)
         ${!isSuperAdmin ? "AND (actor_role.code IS NULL OR actor_role.code != 'SUPER_ADMIN')" : ''}
         ORDER BY al.id DESC
         LIMIT ?`,
        [String(targetId), targetId, 40]
      );

      res.json({
        logs: rows.map((row) => ({
          id: row.id,
          actorId: row.actor_id,
          actorUsername: row.actor_username || null,
          actorFullName: row.actor_full_name || 'System',
          action: row.action,
          targetType: row.target_type,
          targetId: row.target_id,
          ipAddress: row.ip_address,
          details: sanitizeAuditDetails(row.details),
          createdAt: row.created_at,
        })),
      });
    } catch (err) {
      console.error('[KAMCH Users] Error fetching user history:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve account history', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * GET /api/users/:id
 * Retrieves details for a specific user.
 * STRICT SECURITY: Principal and Secretary cannot access Super Admin account details.
 */
userRouter.get(
  '/:id',
  requireRoles(...USER_MANAGEMENT_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const targetId = parseInt(req.params.id, 10);
    if (!targetId || isNaN(targetId)) {
      res.status(400).json({ error: 'Invalid user ID', code: 'INVALID_ID' });
      return;
    }

    try {
      const pool = getPool();
      const [rows] = await pool.query<any[]>(
        `SELECT 
          u.id, 
          u.username, 
          u.email, 
          u.full_name, 
          u.role_id, 
          r.code AS role_code, 
          r.name AS role_name,
          u.department_id,
          d.name AS department_name,
          u.teacher_id,
          t.full_name AS teacher_name,
          t.employee_code AS teacher_employee_code,
          t.teacher_code AS teacher_code,
          t.designation AS teacher_designation,
          u.must_change_password, 
          u.failed_attempts, 
          u.is_locked, 
          u.locked_at, 
          u.is_suspended, 
          u.suspended_at, 
          u.suspension_reason,
          u.is_deactivated,
          u.deactivated_at,
          u.deactivation_reason,
          u.created_at, 
          u.updated_at
         FROM users u
         JOIN roles r ON u.role_id = r.id
         LEFT JOIN departments d ON u.department_id = d.id
         LEFT JOIN teachers t ON u.teacher_id = t.id
         WHERE u.id = ? LIMIT 1`,
        [targetId]
      );

      if (!rows || rows.length === 0) {
        res.status(404).json({ error: 'User account not found', code: 'USER_NOT_FOUND' });
        return;
      }

      const targetUser = rows[0];

      if (targetUser.role_code === ROLES.SUPER_ADMIN && req.user!.role !== ROLES.SUPER_ADMIN) {
        await recordAuditLog({
          actorId: req.user!.id,
          action: 'UNAUTHORIZED_SUPERADMIN_ACCESS_ATTEMPT',
          targetType: 'USER',
          targetId: String(targetId),
          ipAddress: req.ip || null,
          details: { endpoint: 'GET /api/users/:id' },
        });
        res.status(403).json({
          error: 'Access denied: insufficient permissions',
          code: 'FORBIDDEN',
        });
        return;
      }

      const lockedNow = isEffectivelyLocked(targetUser.is_locked, targetUser.locked_at);

      res.json({
        user: {
          id: targetUser.id,
          username: targetUser.username,
          email: targetUser.email || null,
          fullName: targetUser.full_name,
          roleId: targetUser.role_id,
          role: targetUser.role_code,
          roleName: targetUser.role_name,
          departmentId: targetUser.department_id || null,
          departmentName: targetUser.department_name || null,
          teacherId: targetUser.teacher_id || null,
          teacherName: targetUser.teacher_name || null,
          teacherEmployeeCode: targetUser.teacher_employee_code || null,
          teacherCode: targetUser.teacher_code || null,
          teacherDesignation: targetUser.teacher_designation || null,
          mustChangePassword: Boolean(targetUser.must_change_password),
          failedAttempts: lockedNow ? Number(targetUser.failed_attempts || 0) : 0,
          isLocked: lockedNow,
          lockedAt: lockedNow ? targetUser.locked_at : null,
          isSuspended: Boolean(targetUser.is_suspended),
          suspendedAt: targetUser.suspended_at,
          suspensionReason: targetUser.suspension_reason || null,
          isDeactivated: Boolean(targetUser.is_deactivated),
          deactivatedAt: targetUser.deactivated_at,
          deactivationReason: targetUser.deactivation_reason || null,
          createdAt: targetUser.created_at,
          updatedAt: targetUser.updated_at,
        },
      });
    } catch (err) {
      console.error('[KAMCH Users] Error fetching user:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve account details', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * POST /api/users
 * Super Admin, Principal, and Secretary create a user account directly.
 * - Email is optional, validated and checked for uniqueness when provided.
 * - Rejects STUDENT and FACULTY login accounts in this phase.
 * - Rejects creating additional SUPER_ADMIN accounts via User Management.
 * - Enforces one active shared account per department for DEPARTMENT role.
 * - Newly created accounts require mandatory password change at first login.
 */
userRouter.post(
  '/',
  requireRoles(...USER_MANAGEMENT_ROLES),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const {
      username,
      email,
      fullName,
      roleId,
      departmentId,
      teacherId,
      initialPassword,
      confirmPassword,
      activateImmediately,
    } = req.body || {};

    if (!username || !fullName || !roleId || !initialPassword || !confirmPassword) {
      res.status(400).json({
        error: 'Full name, username, role, and temporary password are required',
        code: 'MISSING_FIELDS',
      });
      return;
    }

    const cleanUsername = String(username).trim();
    const rawEmail = email !== undefined && email !== null ? String(email).trim().toLowerCase() : '';
    const cleanEmail: string | null = rawEmail !== '' ? rawEmail : null;
    const cleanFullName = String(fullName).trim();
    const parsedRoleId = Number(roleId);
    const parsedDeptId = departmentId ? Number(departmentId) : null;
    const parsedTeacherId = teacherId !== null && teacherId !== undefined && teacherId !== '' ? Number(teacherId) : null;
    const isActiveOnCreate = activateImmediately === undefined ? true : Boolean(activateImmediately);

    if (cleanUsername.length < 3 || cleanUsername.length > 50 || /\s/.test(cleanUsername)) {
      res.status(400).json({
        error: 'Username must be between 3 and 50 characters and contain no spaces',
        code: 'INVALID_USERNAME',
      });
      return;
    }

    if (cleanEmail !== null) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleanEmail)) {
        res.status(400).json({
          error: 'Please enter a valid email address or leave email blank',
          code: 'INVALID_EMAIL',
        });
        return;
      }
      if (cleanEmail === cleanUsername.toLowerCase()) {
        // Allowed for same user, no conflict with self
      }
    }

    if (String(initialPassword).length < 8) {
      res.status(400).json({
        error: 'Temporary password must be at least 8 characters long',
        code: 'PASSWORD_TOO_SHORT',
      });
      return;
    }

    if (initialPassword !== confirmPassword) {
      res.status(400).json({
        error: 'Initial password and confirmation password do not match',
        code: 'PASSWORD_MISMATCH',
      });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Verify role exists
      const [roleRows] = await connection.query<any[]>(
        'SELECT id, code, name FROM roles WHERE id = ? LIMIT 1',
        [parsedRoleId]
      );

      if (!roleRows || roleRows.length === 0) {
        await connection.rollback();
        res.status(400).json({ error: 'Selected institutional role is invalid', code: 'INVALID_ROLE' });
        return;
      }

      const targetRole = roleRows[0];

      // Block non-login roles (e.g. Student) in this phase
      if (NON_LOGIN_ROLES.includes(targetRole.code)) {
        await connection.rollback();
        res.status(400).json({
          error: 'Student login accounts are not permitted in this phase. Manage them as institutional records instead.',
          code: 'ROLE_LOGIN_DISABLED',
        });
        return;
      }

      // Block creating another Super Admin through User Management
      if (targetRole.code === ROLES.SUPER_ADMIN) {
        await connection.rollback();
        await recordAuditLog({
          actorId: req.user!.id,
          action: 'UNAUTHORIZED_SUPERADMIN_CREATION_ATTEMPT',
          targetType: 'ROLE',
          targetId: ROLES.SUPER_ADMIN,
          ipAddress: req.ip || null,
        });
        res.status(403).json({
          error: 'Security policy: Additional Super Administrator accounts cannot be created through User Management',
          code: 'FORBIDDEN_SUPERADMIN_CREATION',
        });
        return;
      }

      // Ensure role is one of the canonical assignable account roles
      if (!ASSIGNABLE_ACCOUNT_ROLES.includes(targetRole.code)) {
        await connection.rollback();
        res.status(400).json({
          error: 'Selected role cannot be assigned to new login accounts',
          code: 'INVALID_ROLE',
        });
        return;
      }

      let finalDeptId: number | null = null;
      let finalTeacherId: number | null = null;
      let assignedDeptName: string | null = null;
      let linkedTeacherName: string | null = null;

      // Department association rules
      if (targetRole.code === ROLES.DEPARTMENT) {
        if (!parsedDeptId || isNaN(parsedDeptId)) {
          await connection.rollback();
          res.status(400).json({
            error: 'Department selection is required for a Department Account',
            code: 'DEPARTMENT_REQUIRED',
          });
          return;
        }

        const [deptRows] = await connection.query<any[]>(
          'SELECT id, name FROM departments WHERE id = ? LIMIT 1',
          [parsedDeptId]
        );
        if (!deptRows || deptRows.length === 0) {
          await connection.rollback();
          res.status(400).json({
            error: 'Selected department does not exist',
            code: 'INVALID_DEPARTMENT',
          });
          return;
        }
        assignedDeptName = deptRows[0].name;

        // Enforce one active/non-deactivated shared account per department
        const [existingDeptAcc] = await connection.query<any[]>(
          'SELECT id, username FROM users WHERE department_id = ? AND is_deactivated = FALSE LIMIT 1 FOR UPDATE',
          [parsedDeptId]
        );
        if (existingDeptAcc && existingDeptAcc.length > 0) {
          await connection.rollback();
          res.status(409).json({
            error: `Department '${assignedDeptName}' already has an assigned account (${existingDeptAcc[0].username}). Manage or deactivate that account before assigning a replacement.`,
            code: 'DEPARTMENT_ACCOUNT_EXISTS',
          });
          return;
        }

        finalDeptId = parsedDeptId;
      } else if (targetRole.code === ROLES.FACULTY) {
        // Individual Teacher Account linkage rules
        if (!parsedTeacherId || isNaN(parsedTeacherId)) {
          await connection.rollback();
          res.status(400).json({
            error: 'An institutional teacher record must be selected for an individual Faculty account',
            code: 'TEACHER_REQUIRED',
          });
          return;
        }

        const [teacherRows] = await connection.query<any[]>(
          `SELECT t.id, t.full_name, t.department_id, d.name AS department_name
           FROM teachers t
           LEFT JOIN departments d ON t.department_id = d.id
           WHERE t.id = ? AND t.status = 'ACTIVE' LIMIT 1`,
          [parsedTeacherId]
        );
        if (!teacherRows || teacherRows.length === 0) {
          await connection.rollback();
          res.status(400).json({
            error: 'Selected teacher record does not exist or is inactive',
            code: 'INVALID_TEACHER',
          });
          return;
        }

        const teacherRecord = teacherRows[0];
        linkedTeacherName = teacherRecord.full_name;

        // Enforce one active account per individual teacher record
        const [existingTeacherAcc] = await connection.query<any[]>(
          'SELECT id, username FROM users WHERE teacher_id = ? AND is_deactivated = FALSE LIMIT 1 FOR UPDATE',
          [parsedTeacherId]
        );
        if (existingTeacherAcc && existingTeacherAcc.length > 0) {
          await connection.rollback();
          res.status(409).json({
            error: `Teacher '${linkedTeacherName}' already has an assigned account (${existingTeacherAcc[0].username}).`,
            code: 'TEACHER_ACCOUNT_EXISTS',
          });
          return;
        }

        finalTeacherId = parsedTeacherId;
        finalDeptId = teacherRecord.department_id ? Number(teacherRecord.department_id) : null;
        assignedDeptName = teacherRecord.department_name || null;
      }

      // Check unambiguous uniqueness across username and email
      const checkParams = cleanEmail
        ? [cleanUsername.toLowerCase(), cleanUsername.toLowerCase(), cleanEmail, cleanEmail]
        : [cleanUsername.toLowerCase(), cleanUsername.toLowerCase()];
      const checkSql = cleanEmail
        ? `SELECT id, username, email FROM users
           WHERE LOWER(username) = ? OR (email IS NOT NULL AND LOWER(email) = ?)
              OR LOWER(username) = ? OR (email IS NOT NULL AND LOWER(email) = ?)
           LIMIT 1 FOR UPDATE`
        : `SELECT id, username, email FROM users
           WHERE LOWER(username) = ? OR (email IS NOT NULL AND LOWER(email) = ?)
           LIMIT 1 FOR UPDATE`;

      const [existing] = await connection.query<any[]>(checkSql, checkParams);

      if (existing && existing.length > 0) {
        await connection.rollback();
        const conflict = existing[0];
        const isUsernameConflict =
          conflict.username.toLowerCase() === cleanUsername.toLowerCase() ||
          (conflict.email && conflict.email.toLowerCase() === cleanUsername.toLowerCase());
        res.status(409).json({
          error: isUsernameConflict
            ? 'Username is already registered in the system'
            : 'Email address is already registered to another account',
          code: 'DUPLICATE_USER',
        });
        return;
      }

      const passwordHash = await bcrypt.hash(String(initialPassword), 12);

      const [insertResult] = await connection.query<any>(
        `INSERT INTO users 
          (username, email, password_hash, role_id, department_id, teacher_id, full_name, must_change_password, failed_attempts, is_locked, is_suspended, suspended_at, is_deactivated, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, 0, FALSE, ?, ${!isActiveOnCreate ? 'NOW()' : 'NULL'}, FALSE, ?)`,
        [
          cleanUsername,
          cleanEmail,
          passwordHash,
          parsedRoleId,
          finalDeptId,
          finalTeacherId,
          cleanFullName,
          !isActiveOnCreate,
          req.user!.id,
        ]
      );

      const newUserId = insertResult.insertId;

      await connection.commit();

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'USER_CREATED',
        targetType: 'USER',
        targetId: String(newUserId),
        ipAddress: req.ip || null,
        details: {
          username: cleanUsername,
          email: cleanEmail,
          role: targetRole.code,
          departmentId: finalDeptId,
          departmentName: assignedDeptName,
          teacherId: finalTeacherId,
          teacherName: linkedTeacherName,
          fullName: cleanFullName,
          activatedImmediately: isActiveOnCreate,
        },
      });

      res.status(201).json({
        success: true,
        message: isActiveOnCreate
          ? `Account created and activated for ${cleanFullName}. User must change password upon first login.`
          : `Account created in suspended state for ${cleanFullName}. Reactivate when ready for first login.`,
        user: {
          id: newUserId,
          username: cleanUsername,
          email: cleanEmail,
          fullName: cleanFullName,
          role: targetRole.code,
          roleName: targetRole.name,
          departmentId: finalDeptId,
          departmentName: assignedDeptName,
          teacherId: finalTeacherId,
          teacherName: linkedTeacherName,
          mustChangePassword: true,
          isSuspended: !isActiveOnCreate,
        },
      });
    } catch (err) {
      await connection.rollback();
      console.error('[KAMCH Users] Error creating user:', (err as Error).message);
      res.status(500).json({ error: 'Failed to create user account', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

/**
 * PUT /api/users/:id
 * Edit account details (full name, optional email, role, department).
 * STRICT GUARDS:
 * - Principal and Secretary cannot modify Super Admin accounts or elevate users to Super Admin.
 * - Users cannot change their own role.
 * - Role/department changes invalidate active sessions so updated permissions take effect immediately.
 */
userRouter.put(
  '/:id',
  requireRoles(...USER_MANAGEMENT_ROLES),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const targetId = parseInt(req.params.id, 10);
    const { fullName, email, roleId, departmentId, teacherId } = req.body || {};

    if (!targetId || isNaN(targetId)) {
      res.status(400).json({ error: 'Invalid user ID', code: 'INVALID_ID' });
      return;
    }

    if (!fullName || !String(fullName).trim() || !roleId) {
      res.status(400).json({ error: 'Full name and role are required', code: 'MISSING_FIELDS' });
      return;
    }

    const cleanFullName = String(fullName).trim();
    const rawEmail = email !== undefined && email !== null ? String(email).trim().toLowerCase() : '';
    const cleanEmail: string | null = rawEmail !== '' ? rawEmail : null;
    const parsedRoleId = Number(roleId);
    const parsedDeptId = departmentId ? Number(departmentId) : null;
    const parsedTeacherId = teacherId !== null && teacherId !== undefined && teacherId !== '' ? Number(teacherId) : null;

    if (cleanEmail !== null) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleanEmail)) {
        res.status(400).json({
          error: 'Please enter a valid email address or leave email blank',
          code: 'INVALID_EMAIL',
        });
        return;
      }
    }

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [targetRows] = await connection.query<any[]>(
        `SELECT u.id, u.username, u.email, u.full_name, u.role_id, r.code AS role_code, u.department_id, u.teacher_id, u.is_deactivated
         FROM users u 
         JOIN roles r ON u.role_id = r.id 
         WHERE u.id = ? LIMIT 1 FOR UPDATE`,
        [targetId]
      );

      if (!targetRows || targetRows.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: 'User account not found', code: 'USER_NOT_FOUND' });
        return;
      }

      const targetUser = targetRows[0];

      // Protection: Non-Super-Admin cannot modify Super Admin
      if (targetUser.role_code === ROLES.SUPER_ADMIN && req.user!.role !== ROLES.SUPER_ADMIN) {
        await connection.rollback();
        await recordAuditLog({
          actorId: req.user!.id,
          action: 'UNAUTHORIZED_SUPERADMIN_MODIFY_ATTEMPT',
          targetType: 'USER',
          targetId: String(targetId),
          ipAddress: req.ip || null,
        });
        res.status(403).json({
          error: 'Access denied: insufficient permissions',
          code: 'FORBIDDEN',
        });
        return;
      }

      // Protection: Users cannot change their own role
      if (targetId === req.user!.id && Number(targetUser.role_id) !== parsedRoleId) {
        await connection.rollback();
        res.status(403).json({
          error: 'Security policy: You cannot change your own role',
          code: 'CANNOT_CHANGE_OWN_ROLE',
        });
        return;
      }

      // Protection: Super Admin role cannot be stripped from a Super Admin account
      if (targetUser.role_code === ROLES.SUPER_ADMIN && Number(targetUser.role_id) !== parsedRoleId) {
        await connection.rollback();
        res.status(403).json({
          error: 'Security policy: Super Administrator role cannot be reassigned',
          code: 'SUPERADMIN_ROLE_PROTECTED',
        });
        return;
      }

      const [roleRows] = await connection.query<any[]>(
        'SELECT id, code, name FROM roles WHERE id = ? LIMIT 1',
        [parsedRoleId]
      );

      if (!roleRows || roleRows.length === 0) {
        await connection.rollback();
        res.status(400).json({ error: 'Invalid institutional role', code: 'INVALID_ROLE' });
        return;
      }

      const newRole = roleRows[0];

      // Block elevating any other account to Super Admin
      if (newRole.code === ROLES.SUPER_ADMIN && targetUser.role_code !== ROLES.SUPER_ADMIN) {
        await connection.rollback();
        res.status(403).json({
          error: 'Security policy: Cannot elevate an account to Super Administrator',
          code: 'FORBIDDEN_SUPERADMIN_ASSIGNMENT',
        });
        return;
      }

      // Block non-login roles (e.g. Student) when changing role
      if (NON_LOGIN_ROLES.includes(newRole.code)) {
        await connection.rollback();
        res.status(400).json({
          error: 'Student login accounts are not permitted in this phase',
          code: 'ROLE_LOGIN_DISABLED',
        });
        return;
      }

      if (
        newRole.code !== ROLES.SUPER_ADMIN &&
        !ASSIGNABLE_ACCOUNT_ROLES.includes(newRole.code)
      ) {
        await connection.rollback();
        res.status(400).json({
          error: 'Selected role cannot be assigned to login accounts',
          code: 'INVALID_ROLE',
        });
        return;
      }

      let finalDeptId: number | null = null;
      let finalTeacherId: number | null = null;
      let linkedTeacherName: string | null = null;

      // Enforce rules for DEPARTMENT role
      if (newRole.code === ROLES.DEPARTMENT) {
        if (!parsedDeptId || isNaN(parsedDeptId)) {
          await connection.rollback();
          res.status(400).json({
            error: 'Department selection is required for a Department Account',
            code: 'DEPARTMENT_REQUIRED',
          });
          return;
        }
        const [deptRows] = await connection.query<any[]>(
          'SELECT id, name FROM departments WHERE id = ? LIMIT 1',
          [parsedDeptId]
        );
        if (!deptRows || deptRows.length === 0) {
          await connection.rollback();
          res.status(400).json({
            error: 'Selected department does not exist',
            code: 'INVALID_DEPARTMENT',
          });
          return;
        }

        if (!targetUser.is_deactivated) {
          const [existingDeptAcc] = await connection.query<any[]>(
            'SELECT id, username FROM users WHERE department_id = ? AND is_deactivated = FALSE AND id != ? LIMIT 1 FOR UPDATE',
            [parsedDeptId, targetId]
          );
          if (existingDeptAcc && existingDeptAcc.length > 0) {
            await connection.rollback();
            res.status(409).json({
              error: `Department '${deptRows[0].name}' already has an active assigned account (${existingDeptAcc[0].username}).`,
              code: 'DEPARTMENT_ACCOUNT_EXISTS',
            });
            return;
          }
        }
        finalDeptId = parsedDeptId;
      } else if (newRole.code === ROLES.FACULTY) {
        // Enforce rules for FACULTY role
        const effectiveTeacherId = parsedTeacherId !== null ? parsedTeacherId : targetUser.teacher_id;
        if (!effectiveTeacherId || isNaN(effectiveTeacherId)) {
          await connection.rollback();
          res.status(400).json({
            error: 'An institutional teacher record must be selected for an individual Faculty account',
            code: 'TEACHER_REQUIRED',
          });
          return;
        }

        const [teacherRows] = await connection.query<any[]>(
          `SELECT t.id, t.full_name, t.department_id, d.name AS department_name
           FROM teachers t
           LEFT JOIN departments d ON t.department_id = d.id
           WHERE t.id = ? AND t.status = 'ACTIVE' LIMIT 1`,
          [effectiveTeacherId]
        );
        if (!teacherRows || teacherRows.length === 0) {
          await connection.rollback();
          res.status(400).json({
            error: 'Selected teacher record does not exist or is inactive',
            code: 'INVALID_TEACHER',
          });
          return;
        }

        const teacherRecord = teacherRows[0];
        linkedTeacherName = teacherRecord.full_name;

        if (!targetUser.is_deactivated) {
          const [existingTeacherAcc] = await connection.query<any[]>(
            'SELECT id, username FROM users WHERE teacher_id = ? AND is_deactivated = FALSE AND id != ? LIMIT 1 FOR UPDATE',
            [effectiveTeacherId, targetId]
          );
          if (existingTeacherAcc && existingTeacherAcc.length > 0) {
            await connection.rollback();
            res.status(409).json({
              error: `Teacher '${linkedTeacherName}' already has an assigned account (${existingTeacherAcc[0].username}).`,
              code: 'TEACHER_ACCOUNT_EXISTS',
            });
            return;
          }
        }

        finalTeacherId = effectiveTeacherId;
        finalDeptId = teacherRecord.department_id ? Number(teacherRecord.department_id) : null;
      }

      // Check unambiguous email uniqueness if non-null email provided
      if (cleanEmail !== null) {
        const [emailConflict] = await connection.query<any[]>(
          `SELECT id FROM users
           WHERE (LOWER(username) = ? OR (email IS NOT NULL AND LOWER(email) = ?))
             AND id != ?
           LIMIT 1`,
          [cleanEmail, cleanEmail, targetId]
        );
        if (emailConflict && emailConflict.length > 0) {
          await connection.rollback();
          res.status(409).json({
            error: 'This email is already registered to another account',
            code: 'DUPLICATE_EMAIL',
          });
          return;
        }
      }

      await connection.query(
        'UPDATE users SET full_name = ?, email = ?, role_id = ?, department_id = ?, teacher_id = ? WHERE id = ?',
        [cleanFullName, cleanEmail, parsedRoleId, finalDeptId, finalTeacherId, targetId]
      );

      const roleChanged = targetUser.role_code !== newRole.code;
      const deptChanged = (targetUser.department_id || null) !== finalDeptId;
      const teacherChanged = (targetUser.teacher_id || null) !== finalTeacherId;

      // If role, department, or teacher linkage changed, invalidate active sessions so boundaries apply cleanly
      let sessionsInvalidated = 0;
      if ((roleChanged || deptChanged || teacherChanged) && targetId !== req.user!.id) {
        const [sessRes] = await connection.query<any>(
          'UPDATE sessions SET is_active = FALSE WHERE user_id = ? AND is_active = TRUE',
          [targetId]
        );
        sessionsInvalidated = sessRes?.affectedRows || 0;
      }

      await connection.commit();

      await recordAuditLog({
        actorId: req.user!.id,
        action: roleChanged ? 'USER_ROLE_CHANGED' : 'USER_UPDATED',
        targetType: 'USER',
        targetId: String(targetId),
        ipAddress: req.ip || null,
        details: {
          before: {
            fullName: targetUser.full_name,
            email: targetUser.email || null,
            role: targetUser.role_code,
            departmentId: targetUser.department_id || null,
            teacherId: targetUser.teacher_id || null,
          },
          after: {
            fullName: cleanFullName,
            email: cleanEmail,
            role: newRole.code,
            departmentId: finalDeptId,
            teacherId: finalTeacherId,
            teacherName: linkedTeacherName,
          },
          sessionsInvalidated,
        },
      });

      res.json({
        success: true,
        message: `Account details for ${cleanFullName} updated successfully.`,
        user: {
          id: targetId,
          username: targetUser.username,
          email: cleanEmail,
          fullName: cleanFullName,
          role: newRole.code,
          roleName: newRole.name,
          departmentId: finalDeptId,
          teacherId: finalTeacherId,
          teacherName: linkedTeacherName,
        },
      });
    } catch (err) {
      await connection.rollback();
      console.error('[KAMCH Users] Error updating user:', (err as Error).message);
      res.status(500).json({ error: 'Failed to update account details', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

/**
 * POST /api/users/:id/link-teacher
 * Authorized administrator links or updates an individual teacher record for an account.
 */
userRouter.post(
  '/:id/link-teacher',
  requireRoles(...USER_MANAGEMENT_ROLES),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const targetId = parseInt(req.params.id, 10);
    const { teacherId } = req.body || {};

    if (!targetId || isNaN(targetId)) {
      res.status(400).json({ error: 'Invalid user ID', code: 'INVALID_ID' });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [targetRows] = await connection.query<any[]>(
        `SELECT u.id, u.username, u.full_name, u.role_id, r.code AS role_code, u.department_id, u.teacher_id, u.is_deactivated
         FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE u.id = ? LIMIT 1 FOR UPDATE`,
        [targetId]
      );

      if (!targetRows || targetRows.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: 'User account not found', code: 'USER_NOT_FOUND' });
        return;
      }

      const targetUser = targetRows[0];

      if (targetUser.role_code === ROLES.SUPER_ADMIN && req.user!.role !== ROLES.SUPER_ADMIN) {
        await connection.rollback();
        res.status(403).json({ error: 'Access denied: insufficient permissions', code: 'FORBIDDEN' });
        return;
      }

      const parsedTeacherId =
        teacherId !== null && teacherId !== undefined && teacherId !== '' ? Number(teacherId) : null;

      let nextDeptId = targetUser.department_id;
      let teacherInfo: any = null;

      if (parsedTeacherId !== null) {
        if (isNaN(parsedTeacherId)) {
          await connection.rollback();
          res.status(400).json({ error: 'Invalid teacher ID', code: 'INVALID_TEACHER_ID' });
          return;
        }

        const [tRows] = await connection.query<any[]>(
          `SELECT t.id, t.full_name, t.department_id, t.employee_code, t.teacher_code
           FROM teachers t
           WHERE t.id = ? AND t.status = 'ACTIVE' LIMIT 1`,
          [parsedTeacherId]
        );

        if (!tRows || tRows.length === 0) {
          await connection.rollback();
          res.status(400).json({ error: 'Teacher record not found or inactive', code: 'INVALID_TEACHER' });
          return;
        }

        teacherInfo = tRows[0];

        // Check if teacher is already linked to another active account
        const [conflict] = await connection.query<any[]>(
          'SELECT id, username FROM users WHERE teacher_id = ? AND is_deactivated = FALSE AND id != ? LIMIT 1 FOR UPDATE',
          [parsedTeacherId, targetId]
        );

        if (conflict && conflict.length > 0) {
          await connection.rollback();
          res.status(409).json({
            error: `Teacher '${teacherInfo.full_name}' is already linked to account '${conflict[0].username}'`,
            code: 'TEACHER_ALREADY_LINKED',
          });
          return;
        }

        nextDeptId = teacherInfo.department_id ? Number(teacherInfo.department_id) : nextDeptId;
      }

      await connection.query(
        'UPDATE users SET teacher_id = ?, department_id = ? WHERE id = ?',
        [parsedTeacherId, nextDeptId, targetId]
      );

      // Invalidate active sessions of target user so new linked profile is immediately visible
      await connection.query(
        'UPDATE sessions SET is_active = FALSE WHERE user_id = ? AND is_active = TRUE',
        [targetId]
      );

      await connection.commit();

      await recordAuditLog({
        actorId: req.user!.id,
        action: parsedTeacherId ? 'TEACHER_ACCOUNT_LINKED' : 'TEACHER_ACCOUNT_UNLINKED',
        targetType: 'USER',
        targetId: String(targetId),
        ipAddress: req.ip || null,
        details: {
          previousTeacherId: targetUser.teacher_id || null,
          newTeacherId: parsedTeacherId,
          teacherName: teacherInfo ? teacherInfo.full_name : null,
        },
      });

      res.json({
        success: true,
        message: parsedTeacherId
          ? `Successfully linked teacher '${teacherInfo.full_name}' to account '${targetUser.username}'`
          : `Teacher linkage removed from account '${targetUser.username}'`,
        user: {
          id: targetId,
          username: targetUser.username,
          teacherId: parsedTeacherId,
          teacherName: teacherInfo ? teacherInfo.full_name : null,
          departmentId: nextDeptId,
        },
      });
    } catch (err) {
      await connection.rollback();
      console.error('[KAMCH Users] Error linking teacher:', (err as Error).message);
      res.status(500).json({ error: 'Failed to link teacher record', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

/**
 * PATCH /api/users/:id/suspend
 * Suspends an account and terminates all active sessions immediately.
 */
userRouter.patch(
  '/:id/suspend',
  requireRoles(...USER_MANAGEMENT_ROLES),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const targetId = parseInt(req.params.id, 10);
    const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 255) : null;

    if (!targetId || isNaN(targetId)) {
      res.status(400).json({ error: 'Invalid user ID', code: 'INVALID_ID' });
      return;
    }

    if (targetId === req.user!.id) {
      res.status(400).json({ error: 'You cannot suspend your own account', code: 'SELF_ACTION_DENIED' });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query<any[]>(
        `SELECT u.id, u.username, u.full_name, u.is_suspended, r.code AS role_code 
         FROM users u 
         JOIN roles r ON u.role_id = r.id 
         WHERE u.id = ? LIMIT 1 FOR UPDATE`,
        [targetId]
      );

      if (!rows || rows.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: 'User account not found', code: 'USER_NOT_FOUND' });
        return;
      }

      const targetUser = rows[0];

      if (targetUser.role_code === ROLES.SUPER_ADMIN && req.user!.role !== ROLES.SUPER_ADMIN) {
        await connection.rollback();
        await recordAuditLog({
          actorId: req.user!.id,
          action: 'UNAUTHORIZED_SUPERADMIN_MODIFY_ATTEMPT',
          targetType: 'USER',
          targetId: String(targetId),
          ipAddress: req.ip || null,
          details: { attemptedAction: 'SUSPEND' },
        });
        res.status(403).json({
          error: 'Access denied: insufficient permissions',
          code: 'FORBIDDEN',
        });
        return;
      }

      // Protect last active Super Admin
      if (targetUser.role_code === ROLES.SUPER_ADMIN) {
        const [adminCountRows] = await connection.query<any[]>(
          `SELECT COUNT(*) AS active_admins 
           FROM users u 
           JOIN roles r ON u.role_id = r.id 
           WHERE r.code = 'SUPER_ADMIN' AND u.is_deactivated = FALSE AND u.is_suspended = FALSE AND u.id != ?`,
          [targetId]
        );
        if (!adminCountRows || Number(adminCountRows[0].active_admins) === 0) {
          await connection.rollback();
          res.status(400).json({
            error: 'Cannot suspend the last active Super Administrator account',
            code: 'LAST_ADMIN_PROTECTED',
          });
          return;
        }
      }

      await connection.query(
        'UPDATE users SET is_suspended = TRUE, suspended_at = NOW(), suspension_reason = ? WHERE id = ?',
        [reason, targetId]
      );

      const [sessionResult] = await connection.query<any>(
        'UPDATE sessions SET is_active = FALSE WHERE user_id = ? AND is_active = TRUE',
        [targetId]
      );

      await connection.commit();

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'ACCOUNT_SUSPENDED',
        targetType: 'USER',
        targetId: String(targetId),
        ipAddress: req.ip || null,
        details: {
          targetUsername: targetUser.username,
          role: targetUser.role_code,
          reason,
          sessionsTerminated: sessionResult?.affectedRows || 0,
        },
      });

      res.json({
        success: true,
        message: `Account for ${targetUser.full_name} (${targetUser.username}) has been suspended and active sessions terminated.`,
      });
    } catch (err) {
      await connection.rollback();
      console.error('[KAMCH Users] Error suspending user:', (err as Error).message);
      res.status(500).json({ error: 'Failed to suspend account', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

/**
 * PATCH /api/users/:id/reactivate
 * Reactivates a suspended or deactivated account while preserving historical activity
 * and any outstanding must_change_password requirement.
 */
userRouter.patch(
  '/:id/reactivate',
  requireRoles(...USER_MANAGEMENT_ROLES),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const targetId = parseInt(req.params.id, 10);
    if (!targetId || isNaN(targetId)) {
      res.status(400).json({ error: 'Invalid user ID', code: 'INVALID_ID' });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query<any[]>(
        `SELECT u.id, u.username, u.full_name, u.department_id, u.is_suspended, u.is_deactivated, u.must_change_password, r.code AS role_code 
         FROM users u 
         JOIN roles r ON u.role_id = r.id 
         WHERE u.id = ? LIMIT 1 FOR UPDATE`,
        [targetId]
      );

      if (!rows || rows.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: 'User account not found', code: 'USER_NOT_FOUND' });
        return;
      }

      const targetUser = rows[0];

      if (targetUser.role_code === ROLES.SUPER_ADMIN && req.user!.role !== ROLES.SUPER_ADMIN) {
        await connection.rollback();
        await recordAuditLog({
          actorId: req.user!.id,
          action: 'UNAUTHORIZED_SUPERADMIN_MODIFY_ATTEMPT',
          targetType: 'USER',
          targetId: String(targetId),
          ipAddress: req.ip || null,
          details: { attemptedAction: 'REACTIVATE' },
        });
        res.status(403).json({
          error: 'Access denied: insufficient permissions',
          code: 'FORBIDDEN',
        });
        return;
      }

      // If reactivating a deactivated DEPARTMENT account, verify no other active account took the department
      if (targetUser.role_code === ROLES.DEPARTMENT && targetUser.department_id && targetUser.is_deactivated) {
        const [conflictRows] = await connection.query<any[]>(
          'SELECT id, username FROM users WHERE department_id = ? AND is_deactivated = FALSE AND id != ? LIMIT 1 FOR UPDATE',
          [targetUser.department_id, targetId]
        );
        if (conflictRows && conflictRows.length > 0) {
          await connection.rollback();
          res.status(409).json({
            error: `Cannot reactivate: this department already has an active assigned account (${conflictRows[0].username}).`,
            code: 'DEPARTMENT_ACCOUNT_EXISTS',
          });
          return;
        }
      }

      await connection.query(
        'UPDATE users SET is_suspended = FALSE, suspended_at = NULL, suspension_reason = NULL, is_deactivated = FALSE, deactivated_at = NULL, deactivation_reason = NULL WHERE id = ?',
        [targetId]
      );

      await connection.commit();

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'ACCOUNT_REACTIVATED',
        targetType: 'USER',
        targetId: String(targetId),
        ipAddress: req.ip || null,
        details: {
          targetUsername: targetUser.username,
          role: targetUser.role_code,
          wasSuspended: Boolean(targetUser.is_suspended),
          wasDeactivated: Boolean(targetUser.is_deactivated),
          mustChangePasswordPreserved: Boolean(targetUser.must_change_password),
        },
      });

      res.json({
        success: true,
        message: `Account for ${targetUser.full_name} has been reactivated.`,
      });
    } catch (err) {
      await connection.rollback();
      console.error('[KAMCH Users] Error reactivating user:', (err as Error).message);
      res.status(500).json({ error: 'Failed to reactivate account', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

/**
 * PATCH /api/users/:id/deactivate
 * Deactivates an account while preserving historical references (fees, payments, receipts, audits).
 * Terminates all active sessions immediately.
 */
userRouter.patch(
  '/:id/deactivate',
  requireRoles(...USER_MANAGEMENT_ROLES),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const targetId = parseInt(req.params.id, 10);
    const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 255) : null;

    if (!targetId || isNaN(targetId)) {
      res.status(400).json({ error: 'Invalid user ID', code: 'INVALID_ID' });
      return;
    }

    if (targetId === req.user!.id) {
      res.status(400).json({ error: 'You cannot deactivate your own account', code: 'SELF_ACTION_DENIED' });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query<any[]>(
        `SELECT u.id, u.username, u.full_name, r.code AS role_code 
         FROM users u 
         JOIN roles r ON u.role_id = r.id 
         WHERE u.id = ? LIMIT 1 FOR UPDATE`,
        [targetId]
      );

      if (!rows || rows.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: 'User account not found', code: 'USER_NOT_FOUND' });
        return;
      }

      const targetUser = rows[0];

      if (targetUser.role_code === ROLES.SUPER_ADMIN && req.user!.role !== ROLES.SUPER_ADMIN) {
        await connection.rollback();
        await recordAuditLog({
          actorId: req.user!.id,
          action: 'UNAUTHORIZED_SUPERADMIN_MODIFY_ATTEMPT',
          targetType: 'USER',
          targetId: String(targetId),
          ipAddress: req.ip || null,
          details: { attemptedAction: 'DEACTIVATE' },
        });
        res.status(403).json({
          error: 'Access denied: insufficient permissions',
          code: 'FORBIDDEN',
        });
        return;
      }

      if (targetUser.role_code === ROLES.SUPER_ADMIN) {
        const [adminCountRows] = await connection.query<any[]>(
          `SELECT COUNT(*) AS active_admins 
           FROM users u 
           JOIN roles r ON u.role_id = r.id 
           WHERE r.code = 'SUPER_ADMIN' AND u.is_deactivated = FALSE AND u.is_suspended = FALSE AND u.id != ?`,
          [targetId]
        );
        if (!adminCountRows || Number(adminCountRows[0].active_admins) === 0) {
          await connection.rollback();
          res.status(400).json({
            error: 'Cannot deactivate the last functional Super Administrator account',
            code: 'LAST_ADMIN_PROTECTED',
          });
          return;
        }
      }

      await connection.query(
        'UPDATE users SET is_deactivated = TRUE, deactivated_at = NOW(), deactivation_reason = ? WHERE id = ?',
        [reason, targetId]
      );

      const [sessionResult] = await connection.query<any>(
        'UPDATE sessions SET is_active = FALSE WHERE user_id = ? AND is_active = TRUE',
        [targetId]
      );

      await connection.commit();

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'ACCOUNT_DEACTIVATED',
        targetType: 'USER',
        targetId: String(targetId),
        ipAddress: req.ip || null,
        details: {
          targetUsername: targetUser.username,
          role: targetUser.role_code,
          reason,
          sessionsTerminated: sessionResult?.affectedRows || 0,
        },
      });

      res.json({
        success: true,
        message: `Account for ${targetUser.full_name} (${targetUser.username}) has been deactivated. Historical records remain preserved.`,
      });
    } catch (err) {
      await connection.rollback();
      console.error('[KAMCH Users] Error deactivating user:', (err as Error).message);
      res.status(500).json({ error: 'Failed to deactivate account', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

/**
 * PATCH /api/users/:id/unlock
 * Super Admin unlocks a temporarily locked account early (Note: 30-min lockouts also expire automatically).
 */
userRouter.patch(
  '/:id/unlock',
  requireRoles(ROLES.SUPER_ADMIN),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const targetId = parseInt(req.params.id, 10);
    if (!targetId || isNaN(targetId)) {
      res.status(400).json({ error: 'Invalid user ID', code: 'INVALID_ID' });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query<any[]>(
        `SELECT u.id, u.username, u.full_name, r.code AS role_code 
         FROM users u 
         JOIN roles r ON u.role_id = r.id 
         WHERE u.id = ? LIMIT 1 FOR UPDATE`,
        [targetId]
      );

      if (!rows || rows.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: 'User account not found', code: 'USER_NOT_FOUND' });
        return;
      }

      const targetUser = rows[0];

      await connection.query(
        'UPDATE users SET is_locked = FALSE, locked_at = NULL, failed_attempts = 0 WHERE id = ?',
        [targetId]
      );

      await connection.commit();

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'ACCOUNT_UNLOCKED',
        targetType: 'USER',
        targetId: String(targetId),
        ipAddress: req.ip || null,
        details: { targetUsername: targetUser.username },
      });

      res.json({
        success: true,
        message: `Account for ${targetUser.full_name} (${targetUser.username}) unlocked and failure counter reset.`,
      });
    } catch (err) {
      await connection.rollback();
      console.error('[KAMCH Users] Error unlocking user:', (err as Error).message);
      res.status(500).json({ error: 'Failed to unlock account', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

/**
 * POST /api/users/:id/reset-password
 * Super Admin, Principal, or Secretary resets another user's password:
 * - Sets a new temporary password hashed with bcrypt
 * - Sets must_change_password = TRUE
 * - Invalidates all active sessions for the target user
 * - Never logs or reveals any password
 * - Principal and Secretary cannot reset Super Admin password
 */
userRouter.post(
  '/:id/reset-password',
  requireRoles(...USER_MANAGEMENT_ROLES),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const targetId = parseInt(req.params.id, 10);
    const { temporaryPassword, confirmPassword } = req.body || {};

    if (!targetId || isNaN(targetId)) {
      res.status(400).json({ error: 'Invalid user ID', code: 'INVALID_ID' });
      return;
    }

    if (!temporaryPassword || String(temporaryPassword).length < 8) {
      res.status(400).json({
        error: 'Temporary password must be at least 8 characters long',
        code: 'PASSWORD_TOO_SHORT',
      });
      return;
    }

    if (temporaryPassword !== confirmPassword) {
      res.status(400).json({
        error: 'Temporary password and confirmation password do not match',
        code: 'PASSWORD_MISMATCH',
      });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query<any[]>(
        `SELECT u.id, u.username, u.full_name, r.code AS role_code 
         FROM users u 
         JOIN roles r ON u.role_id = r.id 
         WHERE u.id = ? LIMIT 1 FOR UPDATE`,
        [targetId]
      );

      if (!rows || rows.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: 'User account not found', code: 'USER_NOT_FOUND' });
        return;
      }

      const targetUser = rows[0];

      if (targetUser.role_code === ROLES.SUPER_ADMIN && req.user!.role !== ROLES.SUPER_ADMIN) {
        await connection.rollback();
        await recordAuditLog({
          actorId: req.user!.id,
          action: 'UNAUTHORIZED_SUPERADMIN_MODIFY_ATTEMPT',
          targetType: 'USER',
          targetId: String(targetId),
          ipAddress: req.ip || null,
          details: { attemptedAction: 'RESET_PASSWORD' },
        });
        res.status(403).json({
          error: 'Access denied: insufficient permissions',
          code: 'FORBIDDEN',
        });
        return;
      }

      const newHash = await bcrypt.hash(String(temporaryPassword), 12);

      await connection.query(
        'UPDATE users SET password_hash = ?, must_change_password = TRUE, failed_attempts = 0, is_locked = FALSE, locked_at = NULL WHERE id = ?',
        [newHash, targetId]
      );

      const [sessionResult] = await connection.query<any>(
        'UPDATE sessions SET is_active = FALSE WHERE user_id = ? AND is_active = TRUE',
        [targetId]
      );

      await connection.commit();

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'PASSWORD_RESET_BY_ADMIN',
        targetType: 'USER',
        targetId: String(targetId),
        ipAddress: req.ip || null,
        details: {
          targetUsername: targetUser.username,
          role: targetUser.role_code,
          sessionsTerminated: sessionResult?.affectedRows || 0,
        },
      });

      res.json({
        success: true,
        message: `Password reset successfully for ${targetUser.full_name}. Target user will be required to change this password upon next sign in, and active sessions have been invalidated.`,
      });
    } catch (err) {
      await connection.rollback();
      console.error('[KAMCH Users] Error resetting user password:', (err as Error).message);
      res.status(500).json({ error: 'Failed to reset password', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);
