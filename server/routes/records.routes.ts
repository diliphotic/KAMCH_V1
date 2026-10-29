import { Router, Request, Response } from 'express';
import { getPool } from '../db.ts';
import { requireAuth, requirePasswordChangeClear, requireRoles } from '../middleware/auth.ts';
import { validateCsrf } from '../middleware/csrf.ts';
import { recordAuditLog } from '../services/audit.ts';
import { toIsoDateOnly } from '../services/student-progression.ts';
import {
  TEACHER_RECORDS_ROLES,
  DEPARTMENT_WORKSPACE_ROLES,
  LIBRARY_WORKSPACE_ROLES,
  isDepartmentScopedRole,
  isFacultyRole,
} from '../permissions.ts';
import { studentsRouter } from './students.routes.ts';

export const recordsRouter = Router();

recordsRouter.use(requireAuth);
recordsRouter.use(requirePasswordChangeClear);

const VALID_TEACHER_CODE_STATUSES = [
  'VERIFIED',
  'APPLIED',
  'NOT_PROVIDED',
  'REQUIRES_VERIFICATION',
] as const;

function parseOptionalIsoDateInput(
  raw: unknown,
  fieldLabel: string
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { ok: true, value: null };
  }
  const iso = toIsoDateOnly(String(raw).trim());
  if (!iso) {
    return {
      ok: false,
      error: `${fieldLabel} must be a valid calendar date in YYYY-MM-DD format`,
    };
  }
  return { ok: true, value: iso };
}

function mapTeacherRowToApi(t: any) {
  return {
    id: t.id,
    employeeCode: t.employee_code || '',
    teacherCode: t.teacher_code || '',
    teacherCodeStatus:
      t.teacher_code_status || (t.teacher_code ? 'VERIFIED' : 'NOT_PROVIDED'),
    registrationNumber: t.registration_number || '',
    fullName: t.full_name,
    designation: t.designation,
    departmentId: t.department_id,
    departmentName: t.department_name || '',
    departmentCode: t.department_code || '',
    qualification: t.qualification || '',
    dateOfBirth: toIsoDateOnly(t.date_of_birth) || '',
    joiningDateService: toIsoDateOnly(t.joining_date_service) || '',
    joiningDateInstitute: toIsoDateOnly(t.joining_date_institute) || '',
    reportedExperience: t.reported_experience || '',
    previousInstitute: t.previous_institute || '',
    contactPhone: t.contact_phone || '',
    contactEmail: t.contact_email || '',
    profilePhotoUrl: t.profile_photo_url || '',
    status: t.status,
    dataVerificationRequired: Boolean(t.data_verification_required),
    verificationNotes: t.verification_notes || '',
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

// ============================================================================
// 1. DEPARTMENT WORKSPACE & SERVER-SIDE DEPARTMENT ISOLATION
// ============================================================================

/**
 * GET /api/departments/my-workspace
 * Returns the authenticated Department account's assigned department workspace,
 * or all departments summary for Super Admin / Principal / Secretary.
 */
recordsRouter.get(
  '/departments/my-workspace',
  requireRoles(...DEPARTMENT_WORKSPACE_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const user = req.user!;
    const pool = getPool();

    try {
      if (isDepartmentScopedRole(user.role)) {
        if (!user.departmentId) {
          res.status(403).json({
            error: 'No department is associated with this account',
            code: 'NO_ASSIGNED_DEPARTMENT',
          });
          return;
        }

        const [deptRows] = await pool.query<any[]>(
          'SELECT id, code, name, description, created_at, updated_at FROM departments WHERE id = ? LIMIT 1',
          [user.departmentId]
        );
        if (!deptRows || deptRows.length === 0) {
          res.status(404).json({ error: 'Assigned department not found', code: 'NOT_FOUND' });
          return;
        }

        const [teachers] = await pool.query<any[]>(
          `SELECT t.id, t.employee_code, t.teacher_code, t.teacher_code_status, t.registration_number,
                  t.full_name, t.designation, t.department_id, t.qualification,
                  t.contact_phone, t.contact_email, t.status, t.data_verification_required
           FROM teachers t
           WHERE t.department_id = ?
           ORDER BY t.id DESC`,
          [user.departmentId]
        );

        res.json({
          department: deptRows[0],
          teachers: teachers.map((t) => ({
            id: t.id,
            employeeCode: t.employee_code || '',
            teacherCode: t.teacher_code || '',
            teacherCodeStatus:
              t.teacher_code_status || (t.teacher_code ? 'VERIFIED' : 'NOT_PROVIDED'),
            registrationNumber: t.registration_number || '',
            fullName: t.full_name,
            designation: t.designation,
            departmentId: t.department_id,
            qualification: t.qualification || '',
            contactPhone: t.contact_phone || '',
            contactEmail: t.contact_email || '',
            status: t.status,
            dataVerificationRequired: Boolean(t.data_verification_required),
          })),
        });
        return;
      }

      // Super Admin / Principal / Secretary can inspect departments list
      const [depts] = await pool.query<any[]>(
        'SELECT id, code, name, description FROM departments ORDER BY name ASC'
      );
      res.json({ departments: depts });
    } catch (err) {
      console.error('[KAMCH Department Workspace] Error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to load department workspace', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * GET /api/departments/:id/workspace
 * Enforces strict server-side department isolation:
 * A Department account can ONLY access its own assigned department ID.
 */
recordsRouter.get(
  '/departments/:id/workspace',
  requireRoles(...DEPARTMENT_WORKSPACE_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const requestedDeptId = parseInt(req.params.id, 10);
    if (!requestedDeptId || isNaN(requestedDeptId)) {
      res.status(400).json({ error: 'Invalid department ID', code: 'INVALID_ID' });
      return;
    }

    const user = req.user!;

    // STRICT SERVER-SIDE ISOLATION: Never trust department ID from frontend for department accounts
    if (isDepartmentScopedRole(user.role)) {
      if (!user.departmentId || Number(user.departmentId) !== requestedDeptId) {
        await recordAuditLog({
          actorId: user.id,
          action: 'UNAUTHORIZED_DEPARTMENT_ACCESS',
          targetType: 'DEPARTMENT',
          targetId: String(requestedDeptId),
          ipAddress: req.ip || null,
          details: {
            assignedDepartmentId: user.departmentId || null,
            requestedDepartmentId: requestedDeptId,
          },
        });
        res.status(403).json({
          error: 'Access denied: department accounts can only access their own assigned department',
          code: 'DEPARTMENT_ISOLATION_VIOLATION',
        });
        return;
      }
    }

    try {
      const pool = getPool();
      const [deptRows] = await pool.query<any[]>(
        'SELECT id, code, name, description, created_at, updated_at FROM departments WHERE id = ? LIMIT 1',
        [requestedDeptId]
      );

      if (!deptRows || deptRows.length === 0) {
        res.status(404).json({ error: 'Department not found', code: 'NOT_FOUND' });
        return;
      }

      const [teachers] = await pool.query<any[]>(
        `SELECT t.id, t.employee_code, t.teacher_code, t.teacher_code_status, t.registration_number,
                t.full_name, t.designation, t.department_id, t.qualification,
                t.contact_phone, t.contact_email, t.status, t.data_verification_required
         FROM teachers t
         WHERE t.department_id = ?
         ORDER BY t.id DESC`,
        [requestedDeptId]
      );

      res.json({
        department: deptRows[0],
        teachers: teachers.map((t) => ({
          id: t.id,
          employeeCode: t.employee_code || '',
          teacherCode: t.teacher_code || '',
          teacherCodeStatus:
            t.teacher_code_status || (t.teacher_code ? 'VERIFIED' : 'NOT_PROVIDED'),
          registrationNumber: t.registration_number || '',
          fullName: t.full_name,
          designation: t.designation,
          departmentId: t.department_id,
          qualification: t.qualification || '',
          contactPhone: t.contact_phone || '',
          contactEmail: t.contact_email || '',
          status: t.status,
          dataVerificationRequired: Boolean(t.data_verification_required),
        })),
      });
    } catch (err) {
      console.error('[KAMCH Department Workspace] Error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to load department details', code: 'DATABASE_ERROR' });
    }
  }
);

// ============================================================================
// 2. TEACHER / FACULTY RECORDS (Non-Login Institutional Records)
// ============================================================================

/**
 * GET /api/teachers
 * Lists teacher institutional records.
 * - Super Admin, Principal, Secretary, Office: all departments (filterable).
 * - Department account: strictly scoped to req.user.departmentId; rejects cross-department parameter tampering.
 */
recordsRouter.get(
  '/teachers',
  requireRoles(...TEACHER_RECORDS_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const user = req.user!;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const verificationFilter =
      typeof req.query.verificationRequired === 'string'
        ? req.query.verificationRequired.trim().toLowerCase()
        : '';
    const rawDeptParam = req.query.departmentId ? Number(req.query.departmentId) : null;

    if (isDepartmentScopedRole(user.role)) {
      if (!user.departmentId) {
        res.status(403).json({
          error: 'No department is associated with this account',
          code: 'NO_ASSIGNED_DEPARTMENT',
        });
        return;
      }
      if (rawDeptParam !== null && rawDeptParam !== Number(user.departmentId)) {
        await recordAuditLog({
          actorId: user.id,
          action: 'UNAUTHORIZED_DEPARTMENT_ACCESS',
          targetType: 'TEACHERS',
          targetId: String(rawDeptParam),
          ipAddress: req.ip || null,
          details: {
            assignedDepartmentId: user.departmentId,
            requestedDepartmentId: rawDeptParam,
          },
        });
        res.status(403).json({
          error: 'Access denied: cannot view teacher records belonging to another department',
          code: 'DEPARTMENT_ISOLATION_VIOLATION',
        });
        return;
      }
    }

    try {
      const pool = getPool();
      const whereClauses: string[] = [];
      const params: any[] = [];

      const effectiveDeptId = isDepartmentScopedRole(user.role)
        ? Number(user.departmentId)
        : rawDeptParam;

      if (effectiveDeptId && !isNaN(effectiveDeptId)) {
        whereClauses.push('t.department_id = ?');
        params.push(effectiveDeptId);
      }

      if (search) {
        whereClauses.push(
          '(t.employee_code LIKE ? OR t.teacher_code LIKE ? OR t.registration_number LIKE ? OR t.full_name LIKE ? OR t.designation LIKE ?)'
        );
        const pat = `%${search}%`;
        params.push(pat, pat, pat, pat, pat);
      }

      if (statusFilter && ['ACTIVE', 'INACTIVE'].includes(statusFilter)) {
        whereClauses.push('t.status = ?');
        params.push(statusFilter);
      }

      if (verificationFilter === 'true' || verificationFilter === 'false') {
        whereClauses.push('t.data_verification_required = ?');
        params.push(verificationFilter === 'true');
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

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
          t.qualification,
          t.date_of_birth,
          t.joining_date_service,
          t.joining_date_institute,
          t.reported_experience,
          t.previous_institute,
          t.contact_phone,
          t.contact_email,
          t.profile_photo_url,
          t.status,
          t.data_verification_required,
          t.verification_notes,
          t.created_at,
          t.updated_at
         FROM teachers t
         LEFT JOIN departments d ON t.department_id = d.id
         ${whereSql}
         ORDER BY t.id DESC`,
        params
      );

      res.json({
        teachers: rows.map(mapTeacherRowToApi),
      });
    } catch (err) {
      console.error('[KAMCH Teachers] Error listing teacher records:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve teacher records', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * POST /api/teachers
 * Creates a teacher institutional record.
 * NEVER creates a user login account or password.
 * Keeps `teacherCode` (NCISM) and `registrationNumber` (Council Reg. No.) strictly separate,
 * and allows `employeeCode` to remain null when not assigned.
 */
recordsRouter.post(
  '/teachers',
  requireRoles(...TEACHER_RECORDS_ROLES),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const user = req.user!;
    const {
      employeeCode,
      teacherCode,
      teacherCodeStatus,
      registrationNumber,
      fullName,
      designation,
      departmentId,
      qualification,
      dateOfBirth,
      joiningDateService,
      joiningDateInstitute,
      reportedExperience,
      previousInstitute,
      contactPhone,
      contactEmail,
      profilePhotoUrl,
      dataVerificationRequired,
      verificationNotes,
    } = req.body || {};

    if (!fullName || !String(fullName).trim() || !designation || !String(designation).trim()) {
      res.status(400).json({
        error: 'Full name and designation are required',
        code: 'MISSING_FIELDS',
      });
      return;
    }

    let targetDeptId = departmentId ? Number(departmentId) : null;

    if (isDepartmentScopedRole(user.role)) {
      if (!user.departmentId) {
        res.status(403).json({
          error: 'No department is associated with this account',
          code: 'NO_ASSIGNED_DEPARTMENT',
        });
        return;
      }
      if (targetDeptId !== null && targetDeptId !== Number(user.departmentId)) {
        await recordAuditLog({
          actorId: user.id,
          action: 'UNAUTHORIZED_DEPARTMENT_ACCESS',
          targetType: 'TEACHERS',
          targetId: String(targetDeptId),
          ipAddress: req.ip || null,
          details: {
            attemptedAction: 'CREATE_TEACHER_OTHER_DEPARTMENT',
            assignedDepartmentId: user.departmentId,
            requestedDepartmentId: targetDeptId,
          },
        });
        res.status(403).json({
          error: 'Access denied: department accounts can only add teacher records to their own department',
          code: 'DEPARTMENT_ISOLATION_VIOLATION',
        });
        return;
      }
      targetDeptId = Number(user.departmentId);
    }

    if (!targetDeptId || isNaN(targetDeptId)) {
      res.status(400).json({
        error: 'Assigned department is required for teacher records',
        code: 'DEPARTMENT_REQUIRED',
      });
      return;
    }

    const dobCheck = parseOptionalIsoDateInput(dateOfBirth, 'Date of birth');
    if (!dobCheck.ok) {
      res.status(400).json({ error: dobCheck.error, code: 'INVALID_DATE' });
      return;
    }
    const serviceDateCheck = parseOptionalIsoDateInput(joiningDateService, 'Joining date of service');
    if (!serviceDateCheck.ok) {
      res.status(400).json({ error: serviceDateCheck.error, code: 'INVALID_DATE' });
      return;
    }
    const instDateCheck = parseOptionalIsoDateInput(joiningDateInstitute, 'Joining date at institute');
    if (!instDateCheck.ok) {
      res.status(400).json({ error: instDateCheck.error, code: 'INVALID_DATE' });
      return;
    }

    const cleanEmpCode =
      employeeCode && String(employeeCode).trim()
        ? String(employeeCode).trim().toUpperCase()
        : null;
    const cleanTeacherCode =
      teacherCode && String(teacherCode).trim()
        ? String(teacherCode).trim().toUpperCase()
        : null;
    const cleanTcStatus =
      teacherCodeStatus && VALID_TEACHER_CODE_STATUSES.includes(teacherCodeStatus)
        ? teacherCodeStatus
        : cleanTeacherCode
        ? 'VERIFIED'
        : 'NOT_PROVIDED';
    const cleanRegNo =
      registrationNumber && String(registrationNumber).trim()
        ? String(registrationNumber).trim()
        : null;
    const cleanName = String(fullName).trim();
    const cleanDesignation = String(designation).trim();
    const cleanQual = qualification && String(qualification).trim() ? String(qualification).trim() : null;
    const cleanExp =
      reportedExperience && String(reportedExperience).trim()
        ? String(reportedExperience).trim()
        : null;
    const cleanPrevInst =
      previousInstitute && String(previousInstitute).trim()
        ? String(previousInstitute).trim()
        : null;
    const cleanPhone = contactPhone && String(contactPhone).trim() ? String(contactPhone).trim() : null;
    const cleanEmail =
      contactEmail && String(contactEmail).trim()
        ? String(contactEmail).trim().toLowerCase()
        : null;
    const cleanPhotoUrl =
      profilePhotoUrl && String(profilePhotoUrl).trim() ? String(profilePhotoUrl).trim() : null;
    const cleanVerifReq = Boolean(dataVerificationRequired);
    const cleanVerifNotes =
      verificationNotes && String(verificationNotes).trim()
        ? String(verificationNotes).trim()
        : null;

    try {
      const pool = getPool();

      const [deptRows] = await pool.query<any[]>(
        'SELECT id, name, code FROM departments WHERE id = ? LIMIT 1',
        [targetDeptId]
      );
      if (!deptRows || deptRows.length === 0) {
        res.status(400).json({ error: 'Selected department does not exist', code: 'INVALID_DEPARTMENT' });
        return;
      }

      if (cleanEmpCode) {
        const [dupEmp] = await pool.query<any[]>(
          'SELECT id FROM teachers WHERE employee_code = ? LIMIT 1',
          [cleanEmpCode]
        );
        if (dupEmp && dupEmp.length > 0) {
          res.status(409).json({
            error: `Teacher employee code '${cleanEmpCode}' is already registered`,
            code: 'DUPLICATE_TEACHER',
          });
          return;
        }
      }

      if (cleanTeacherCode) {
        const [dupTc] = await pool.query<any[]>(
          'SELECT id FROM teachers WHERE teacher_code = ? LIMIT 1',
          [cleanTeacherCode]
        );
        if (dupTc && dupTc.length > 0) {
          res.status(409).json({
            error: `NCISM teacher code '${cleanTeacherCode}' is already registered`,
            code: 'DUPLICATE_TEACHER_CODE',
          });
          return;
        }
      }

      const [result] = await pool.query<any>(
        `INSERT INTO teachers (
          employee_code,
          teacher_code,
          teacher_code_status,
          registration_number,
          full_name,
          designation,
          department_id,
          qualification,
          date_of_birth,
          joining_date_service,
          joining_date_institute,
          reported_experience,
          previous_institute,
          contact_phone,
          contact_email,
          profile_photo_url,
          status,
          data_verification_required,
          verification_notes,
          created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
        [
          cleanEmpCode,
          cleanTeacherCode,
          cleanTcStatus,
          cleanRegNo,
          cleanName,
          cleanDesignation,
          targetDeptId,
          cleanQual,
          dobCheck.value,
          serviceDateCheck.value,
          instDateCheck.value,
          cleanExp,
          cleanPrevInst,
          cleanPhone,
          cleanEmail,
          cleanPhotoUrl,
          cleanVerifReq,
          cleanVerifNotes,
          user.id,
        ]
      );

      await recordAuditLog({
        actorId: user.id,
        action: 'TEACHER_RECORD_CREATED',
        targetType: 'TEACHER',
        targetId: String(result.insertId),
        ipAddress: req.ip || null,
        details: {
          employeeCode: cleanEmpCode,
          teacherCode: cleanTeacherCode,
          teacherCodeStatus: cleanTcStatus,
          registrationNumber: cleanRegNo,
          fullName: cleanName,
          designation: cleanDesignation,
          departmentId: targetDeptId,
          departmentName: deptRows[0].name,
        },
      });

      res.status(201).json({
        success: true,
        message: `Teacher record saved for ${cleanName}. (Institutional record only; no login account created.)`,
        teacher: {
          id: result.insertId,
          employeeCode: cleanEmpCode || '',
          teacherCode: cleanTeacherCode || '',
          teacherCodeStatus: cleanTcStatus,
          registrationNumber: cleanRegNo || '',
          fullName: cleanName,
          designation: cleanDesignation,
          departmentId: targetDeptId,
          departmentName: deptRows[0].name,
          departmentCode: deptRows[0].code || '',
          qualification: cleanQual || '',
          dateOfBirth: dobCheck.value || '',
          joiningDateService: serviceDateCheck.value || '',
          joiningDateInstitute: instDateCheck.value || '',
          reportedExperience: cleanExp || '',
          previousInstitute: cleanPrevInst || '',
          contactPhone: cleanPhone || '',
          contactEmail: cleanEmail || '',
          profilePhotoUrl: cleanPhotoUrl || '',
          status: 'ACTIVE',
          dataVerificationRequired: cleanVerifReq,
          verificationNotes: cleanVerifNotes || '',
        },
      });
    } catch (err) {
      console.error('[KAMCH Teachers] Error creating teacher record:', (err as Error).message);
      res.status(500).json({ error: 'Failed to create teacher record', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * GET /api/teachers/my-profile
 * Returns the authenticated user's own linked teacher record.
 * Accessible to any authenticated account with a linked teacher (e.g. FACULTY).
 */
recordsRouter.get(
  '/teachers/my-profile',
  async (req: Request, res: Response): Promise<void> => {
    const user = req.user!;
    if (!user.teacherId) {
      res.status(404).json({
        error: 'No institutional teacher record is linked to this account',
        code: 'NO_LINKED_TEACHER',
      });
      return;
    }

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
          t.qualification,
          t.date_of_birth,
          t.joining_date_service,
          t.joining_date_institute,
          t.reported_experience,
          t.previous_institute,
          t.contact_phone,
          t.contact_email,
          t.profile_photo_url,
          t.status,
          t.data_verification_required,
          t.verification_notes,
          t.created_at,
          t.updated_at
         FROM teachers t
         LEFT JOIN departments d ON t.department_id = d.id
         WHERE t.id = ? LIMIT 1`,
        [user.teacherId]
      );

      if (!rows || rows.length === 0) {
        res.status(404).json({
          error: 'Linked teacher record was not found',
          code: 'TEACHER_NOT_FOUND',
        });
        return;
      }

      res.json({ teacher: mapTeacherRowToApi(rows[0]) });
    } catch (err) {
      console.error('[KAMCH Teachers] Error fetching teacher profile:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve teacher profile', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * GET /api/teachers/:id
 * Retrieves details for a specific teacher record.
 * - Allowed for TEACHER_RECORDS_ROLES (Super Admin, Principal, Secretary, Office, Staff, Department, HOD).
 *   Department accounts are strictly isolated to their own department.
 * - Allowed for FACULTY role ONLY IF the requested ID equals their own linked teacherId.
 *   Faculty accounts attempting to access another teacher's record are strictly rejected with 403 TEACHER_ISOLATION_VIOLATION.
 */
recordsRouter.get(
  '/teachers/:id',
  async (req: Request, res: Response): Promise<void> => {
    const teacherId = parseInt(req.params.id, 10);
    if (!teacherId || isNaN(teacherId)) {
      res.status(400).json({ error: 'Invalid teacher record ID', code: 'INVALID_ID' });
      return;
    }

    const user = req.user!;

    // Faculty isolation check
    if (isFacultyRole(user.role)) {
      if (!user.teacherId || Number(user.teacherId) !== teacherId) {
        await recordAuditLog({
          actorId: user.id,
          action: 'UNAUTHORIZED_TEACHER_ACCESS',
          targetType: 'TEACHER',
          targetId: String(teacherId),
          ipAddress: req.ip || null,
          details: {
            assignedTeacherId: user.teacherId || null,
            requestedTeacherId: teacherId,
          },
        });
        res.status(403).json({
          error: 'Access denied: faculty accounts can only access their own linked teacher record',
          code: 'TEACHER_ISOLATION_VIOLATION',
        });
        return;
      }
    } else if (!TEACHER_RECORDS_ROLES.includes(user.role)) {
      res.status(403).json({
        error: 'Access denied: insufficient permissions',
        code: 'FORBIDDEN',
      });
      return;
    }

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
          t.qualification,
          t.date_of_birth,
          t.joining_date_service,
          t.joining_date_institute,
          t.reported_experience,
          t.previous_institute,
          t.contact_phone,
          t.contact_email,
          t.profile_photo_url,
          t.status,
          t.data_verification_required,
          t.verification_notes,
          t.created_at,
          t.updated_at
         FROM teachers t
         LEFT JOIN departments d ON t.department_id = d.id
         WHERE t.id = ? LIMIT 1`,
        [teacherId]
      );

      if (!rows || rows.length === 0) {
        res.status(404).json({ error: 'Teacher record not found', code: 'NOT_FOUND' });
        return;
      }

      const teacher = rows[0];

      // Department isolation check for department-scoped accounts
      if (isDepartmentScopedRole(user.role)) {
        if (!user.departmentId || Number(teacher.department_id) !== Number(user.departmentId)) {
          await recordAuditLog({
            actorId: user.id,
            action: 'UNAUTHORIZED_DEPARTMENT_ACCESS',
            targetType: 'TEACHER',
            targetId: String(teacherId),
            ipAddress: req.ip || null,
            details: {
              assignedDepartmentId: user.departmentId || null,
              recordDepartmentId: teacher.department_id,
            },
          });
          res.status(403).json({
            error: 'Access denied: cannot view teacher records belonging to another department',
            code: 'DEPARTMENT_ISOLATION_VIOLATION',
          });
          return;
        }
      }

      res.json({ teacher: mapTeacherRowToApi(teacher) });
    } catch (err) {
      console.error('[KAMCH Teachers] Error fetching teacher record:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve teacher record', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * PUT /api/teachers/:id
 * Updates a teacher institutional record.
 * Enforces server-side department isolation for Department accounts and preserves
 * any unspecified fields without overwriting them.
 */
recordsRouter.put(
  '/teachers/:id',
  requireRoles(...TEACHER_RECORDS_ROLES),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const teacherId = parseInt(req.params.id, 10);
    if (!teacherId || isNaN(teacherId)) {
      res.status(400).json({ error: 'Invalid teacher record ID', code: 'INVALID_ID' });
      return;
    }

    const user = req.user!;
    const {
      employeeCode,
      teacherCode,
      teacherCodeStatus,
      registrationNumber,
      fullName,
      designation,
      departmentId,
      qualification,
      dateOfBirth,
      joiningDateService,
      joiningDateInstitute,
      reportedExperience,
      previousInstitute,
      contactPhone,
      contactEmail,
      profilePhotoUrl,
      status,
      dataVerificationRequired,
      verificationNotes,
    } = req.body || {};

    if (!fullName || !String(fullName).trim() || !designation || !String(designation).trim()) {
      res.status(400).json({
        error: 'Full name and designation are required',
        code: 'MISSING_FIELDS',
      });
      return;
    }

    try {
      const pool = getPool();
      const [rows] = await pool.query<any[]>(
        'SELECT * FROM teachers WHERE id = ? LIMIT 1',
        [teacherId]
      );
      if (!rows || rows.length === 0) {
        res.status(404).json({ error: 'Teacher record not found', code: 'NOT_FOUND' });
        return;
      }

      const existing = rows[0];

      // Department account isolation check
      if (isDepartmentScopedRole(user.role)) {
        if (
          !user.departmentId ||
          Number(existing.department_id) !== Number(user.departmentId) ||
          (departmentId !== undefined && Number(departmentId) !== Number(user.departmentId))
        ) {
          await recordAuditLog({
            actorId: user.id,
            action: 'UNAUTHORIZED_DEPARTMENT_ACCESS',
            targetType: 'TEACHER',
            targetId: String(teacherId),
            ipAddress: req.ip || null,
            details: {
              attemptedAction: 'UPDATE_TEACHER_OTHER_DEPARTMENT',
              assignedDepartmentId: user.departmentId || null,
              recordDepartmentId: existing.department_id,
            },
          });
          res.status(403).json({
            error: 'Access denied: department accounts can only modify teacher records in their own department',
            code: 'DEPARTMENT_ISOLATION_VIOLATION',
          });
          return;
        }
      }

      const nextDeptId = isDepartmentScopedRole(user.role)
        ? Number(user.departmentId)
        : departmentId
        ? Number(departmentId)
        : Number(existing.department_id);

      const [deptRows] = await pool.query<any[]>(
        'SELECT id, name FROM departments WHERE id = ? LIMIT 1',
        [nextDeptId]
      );
      if (!deptRows || deptRows.length === 0) {
        res.status(400).json({ error: 'Selected department does not exist', code: 'INVALID_DEPARTMENT' });
        return;
      }

      const nextEmpCode =
        employeeCode !== undefined
          ? employeeCode && String(employeeCode).trim()
            ? String(employeeCode).trim().toUpperCase()
            : null
          : existing.employee_code ?? null;

      const nextTeacherCode =
        teacherCode !== undefined
          ? teacherCode && String(teacherCode).trim()
            ? String(teacherCode).trim().toUpperCase()
            : null
          : existing.teacher_code ?? null;

      if (nextEmpCode && nextEmpCode !== (existing.employee_code || '').toUpperCase()) {
        const [dupEmp] = await pool.query<any[]>(
          'SELECT id FROM teachers WHERE employee_code = ? AND id != ? LIMIT 1',
          [nextEmpCode, teacherId]
        );
        if (dupEmp && dupEmp.length > 0) {
          res.status(409).json({
            error: `Employee code '${nextEmpCode}' is already assigned to another teacher record`,
            code: 'DUPLICATE_TEACHER',
          });
          return;
        }
      }

      if (nextTeacherCode && nextTeacherCode !== (existing.teacher_code || '').toUpperCase()) {
        const [dupTc] = await pool.query<any[]>(
          'SELECT id FROM teachers WHERE teacher_code = ? AND id != ? LIMIT 1',
          [nextTeacherCode, teacherId]
        );
        if (dupTc && dupTc.length > 0) {
          res.status(409).json({
            error: `NCISM teacher code '${nextTeacherCode}' is already assigned to another teacher record`,
            code: 'DUPLICATE_TEACHER_CODE',
          });
          return;
        }
      }

      let nextDob = toIsoDateOnly(existing.date_of_birth);
      if (dateOfBirth !== undefined) {
        const chk = parseOptionalIsoDateInput(dateOfBirth, 'Date of birth');
        if (!chk.ok) {
          res.status(400).json({ error: chk.error, code: 'INVALID_DATE' });
          return;
        }
        nextDob = chk.value;
      }

      let nextServiceDate = toIsoDateOnly(existing.joining_date_service);
      if (joiningDateService !== undefined) {
        const chk = parseOptionalIsoDateInput(joiningDateService, 'Joining date of service');
        if (!chk.ok) {
          res.status(400).json({ error: chk.error, code: 'INVALID_DATE' });
          return;
        }
        nextServiceDate = chk.value;
      }

      let nextInstDate = toIsoDateOnly(existing.joining_date_institute);
      if (joiningDateInstitute !== undefined) {
        const chk = parseOptionalIsoDateInput(joiningDateInstitute, 'Joining date at institute');
        if (!chk.ok) {
          res.status(400).json({ error: chk.error, code: 'INVALID_DATE' });
          return;
        }
        nextInstDate = chk.value;
      }

      const nextTcStatus =
        teacherCodeStatus !== undefined && VALID_TEACHER_CODE_STATUSES.includes(teacherCodeStatus)
          ? teacherCodeStatus
          : teacherCode !== undefined
          ? nextTeacherCode
            ? 'VERIFIED'
            : 'NOT_PROVIDED'
          : existing.teacher_code_status || (nextTeacherCode ? 'VERIFIED' : 'NOT_PROVIDED');

      const nextRegNo =
        registrationNumber !== undefined
          ? registrationNumber && String(registrationNumber).trim()
            ? String(registrationNumber).trim()
            : null
          : existing.registration_number ?? null;

      const cleanName = String(fullName).trim();
      const cleanDesignation = String(designation).trim();
      const cleanQual =
        qualification !== undefined
          ? qualification && String(qualification).trim()
            ? String(qualification).trim()
            : null
          : existing.qualification;
      const cleanExp =
        reportedExperience !== undefined
          ? reportedExperience && String(reportedExperience).trim()
            ? String(reportedExperience).trim()
            : null
          : existing.reported_experience ?? null;
      const cleanPrevInst =
        previousInstitute !== undefined
          ? previousInstitute && String(previousInstitute).trim()
            ? String(previousInstitute).trim()
            : null
          : existing.previous_institute ?? null;
      const cleanPhone =
        contactPhone !== undefined
          ? contactPhone && String(contactPhone).trim()
            ? String(contactPhone).trim()
            : null
          : existing.contact_phone;
      const cleanEmail =
        contactEmail !== undefined
          ? contactEmail && String(contactEmail).trim()
            ? String(contactEmail).trim().toLowerCase()
            : null
          : existing.contact_email;
      const cleanPhotoUrl =
        profilePhotoUrl !== undefined
          ? profilePhotoUrl && String(profilePhotoUrl).trim()
            ? String(profilePhotoUrl).trim()
            : null
          : existing.profile_photo_url ?? null;
      const cleanStatus =
        status && ['ACTIVE', 'INACTIVE'].includes(status) ? status : existing.status;
      const cleanVerifReq =
        dataVerificationRequired !== undefined
          ? Boolean(dataVerificationRequired)
          : Boolean(existing.data_verification_required);
      const cleanVerifNotes =
        verificationNotes !== undefined
          ? verificationNotes && String(verificationNotes).trim()
            ? String(verificationNotes).trim()
            : null
          : existing.verification_notes ?? null;

      await pool.query(
        `UPDATE teachers
         SET employee_code = ?,
             teacher_code = ?,
             teacher_code_status = ?,
             registration_number = ?,
             full_name = ?,
             designation = ?,
             department_id = ?,
             qualification = ?,
             date_of_birth = ?,
             joining_date_service = ?,
             joining_date_institute = ?,
             reported_experience = ?,
             previous_institute = ?,
             contact_phone = ?,
             contact_email = ?,
             profile_photo_url = ?,
             status = ?,
             data_verification_required = ?,
             verification_notes = ?
         WHERE id = ?`,
        [
          nextEmpCode,
          nextTeacherCode,
          nextTcStatus,
          nextRegNo,
          cleanName,
          cleanDesignation,
          nextDeptId,
          cleanQual,
          nextDob,
          nextServiceDate,
          nextInstDate,
          cleanExp,
          cleanPrevInst,
          cleanPhone,
          cleanEmail,
          cleanPhotoUrl,
          cleanStatus,
          cleanVerifReq,
          cleanVerifNotes,
          teacherId,
        ]
      );

      await recordAuditLog({
        actorId: user.id,
        action: 'TEACHER_RECORD_UPDATED',
        targetType: 'TEACHER',
        targetId: String(teacherId),
        ipAddress: req.ip || null,
        details: {
          before: {
            employeeCode: existing.employee_code || null,
            teacherCode: existing.teacher_code || null,
            registrationNumber: existing.registration_number || null,
            fullName: existing.full_name,
            designation: existing.designation,
            departmentId: existing.department_id,
            status: existing.status,
            dataVerificationRequired: Boolean(existing.data_verification_required),
          },
          after: {
            employeeCode: nextEmpCode,
            teacherCode: nextTeacherCode,
            registrationNumber: nextRegNo,
            fullName: cleanName,
            designation: cleanDesignation,
            departmentId: nextDeptId,
            status: cleanStatus,
            dataVerificationRequired: cleanVerifReq,
          },
        },
      });

      res.json({
        success: true,
        message: `Teacher record for ${cleanName} updated successfully.`,
      });
    } catch (err) {
      console.error('[KAMCH Teachers] Error updating teacher record:', (err as Error).message);
      res.status(500).json({ error: 'Failed to update teacher record', code: 'DATABASE_ERROR' });
    }
  }
);

// ============================================================================
// 3. CENTRAL STUDENT MANAGEMENT MODULE (Mounted at /api/students)
// ============================================================================

recordsRouter.use('/students', studentsRouter);

// ============================================================================
// 4. LIBRARY WORKSPACE (Role-Restricted Endpoint)
// ============================================================================

/**
 * GET /api/library/workspace
 * Accessible ONLY to Library Staff, Super Admin, Principal, and Secretary.
 * Office and Department accounts are strictly rejected with HTTP 403.
 */
recordsRouter.get(
  '/library/workspace',
  requireRoles(...LIBRARY_WORKSPACE_ROLES),
  (req: Request, res: Response) => {
    res.json({
      module: 'LIBRARY',
      status: 'active',
      operator: {
        id: req.user!.id,
        username: req.user!.username,
        fullName: req.user!.fullName,
        role: req.user!.role,
        roleName: req.user!.roleName,
      },
    });
  }
);
