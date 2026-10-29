import { MemoryDatabase } from './memory-db.ts';
import { handleStudentModuleQuery } from './student-db-proxy.ts';
import { handleInternalAssessmentQuery } from './ia-db-proxy.ts';
import { handleUniversityExamQuery } from './univ-exam-db-proxy.ts';
import { handleLibraryQuery } from './library-db-proxy.ts';
import { handleLeaveQuery } from './leave-db-proxy.ts';
import { handleNotificationsQuery } from './notifications-db-proxy.ts';
import { handleAttendanceQuery } from './attendance-db-proxy.ts';

/**
 * Handles query execution against the in-memory fallback database when local MySQL is unreachable.
 */
export class HybridQueryHandler {
  private memDb = MemoryDatabase.getInstance();

  async executeQuery(sql: string, params: any[] = []): Promise<[any, any]> {
    const trimmed = sql.trim();
    const upper = trimmed.toUpperCase();

    // 1. Connection check & schema metadata inspection
    if (upper.startsWith('SELECT 1')) {
      return [[{ connected: 1 }], []];
    }

    if (upper.includes('FROM INFORMATION_SCHEMA.COLUMNS')) {
      const tableName = String(params[0] || '').toLowerCase();
      if (tableName === 'teachers') {
        const cols = [
          'id',
          'employee_code',
          'teacher_code',
          'teacher_code_status',
          'registration_number',
          'full_name',
          'designation',
          'department_id',
          'qualification',
          'date_of_birth',
          'joining_date_service',
          'joining_date_institute',
          'reported_experience',
          'previous_institute',
          'contact_phone',
          'contact_email',
          'profile_photo_url',
          'status',
          'data_verification_required',
          'verification_notes',
          'raw_source_snapshot',
          'created_by',
          'created_at',
          'updated_at',
        ];
        if (params[1]) {
          const targetCol = String(params[1]).toLowerCase();
          const exists = cols.includes(targetCol);
          if (upper.includes('COUNT(*)')) {
            return [[{ cnt: exists ? 1 : 0 }], []];
          }
          return [exists ? [{ COLUMN_NAME: targetCol }] : [], []];
        }
        return [cols.map((c) => ({ COLUMN_NAME: c, IS_NULLABLE: c === 'full_name' || c === 'designation' || c === 'department_id' ? 'NO' : 'YES' })), []];
      }
      if (tableName === 'departments') {
        const cols = ['id', 'code', 'name', 'description', 'is_active', 'created_at', 'updated_at'];
        return [cols.map((c) => ({ COLUMN_NAME: c })), []];
      }
      if (tableName === 'users') {
        const cols = [
          'id', 'username', 'email', 'password_hash', 'role_id',
          'department_id', 'teacher_id', 'full_name', 'must_change_password',
          'failed_attempts', 'is_locked', 'locked_at', 'is_suspended',
          'suspended_at', 'suspension_reason', 'is_deactivated',
          'deactivated_at', 'deactivation_reason', 'created_by',
          'created_at', 'updated_at',
        ];
        if (params[1]) {
          const targetCol = String(params[1]).toLowerCase();
          const exists = cols.includes(targetCol);
          if (upper.includes('COUNT(*)')) {
            return [[{ cnt: exists ? 1 : 0 }], []];
          }
          return [exists ? [{ COLUMN_NAME: targetCol }] : [], []];
        }
        return [cols.map((c) => ({ COLUMN_NAME: c })), []];
      }
      return [[], []];
    }

    if (upper.includes('FROM INFORMATION_SCHEMA.TABLES')) {
      const tableName = String(params[0] || '').toLowerCase();
      const knownTables = new Set([
        'roles',
        'users',
        'sessions',
        'account_requests',
        'audit_logs',
        'departments',
        'teachers',
        'students',
        'fee_structures',
        'service_enrollments',
        'student_fee_assessments',
        'fee_concessions',
        'fee_payments',
        'fee_receipts',
        'curriculum_schemes',
        'academic_batches',
        'student_roll_sequences',
        'student_identifier_history',
        'student_documents',
        'student_progression_events',
        'institutional_settings',
        'institutional_setting_history',
        'student_internships',
        'student_internship_extensions',
        'subjects',
        'assessments',
        'subject_assessment_config',
        'student_assessment_marks',
        'assessment_submissions',
        'student_term_test_conversions',
        'student_ia_calculations',
        'student_final_ia_approvals',
        'student_final_ia_history',
        'university_subjects',
        'student_university_exam_attempts',
      ]);
      const exists = knownTables.has(tableName);
      if (upper.includes('COUNT(*)')) {
        return [[{ cnt: exists ? 1 : 0 }], []];
      }
      return [exists ? [{ TABLE_NAME: tableName }] : [], []];
    }

    // 1b. Internal Assessment module tables & tagged queries (`/* IA:... */`)
    const iaModuleResult = handleInternalAssessmentQuery(this.memDb, sql, params);
    if (iaModuleResult !== null) {
      return iaModuleResult;
    }

    // 1c. Student Management module tables & tagged queries
    const studentModuleResult = handleStudentModuleQuery(this.memDb, sql, params);
    if (studentModuleResult !== null) {
      return studentModuleResult;
    }

    // 1d. University Examinations module queries
    const univExamResult = handleUniversityExamQuery(this.memDb, sql, params);
    if (univExamResult !== null) {
      return univExamResult;
    }

    // 1e. Library Management module queries
    const libraryResult = handleLibraryQuery(this.memDb, sql, params);
    if (libraryResult !== null) {
      return libraryResult;
    }

    // 1f. Leave Management module queries
    const leaveResult = handleLeaveQuery(this.memDb, sql, params);
    if (leaveResult !== null) {
      return leaveResult;
    }

    // 1g. Notifications module queries
    const notifResult = handleNotificationsQuery(this.memDb, sql, params);
    if (notifResult !== null) {
      return notifResult;
    }

    // 1h. Monthly Attendance module queries
    const attendanceResult = handleAttendanceQuery(this.memDb, sql, params);
    if (attendanceResult !== null) {
      return attendanceResult;
    }

    // 2. Roles queries
    if (upper.includes('FROM ROLES') || upper.includes('FROM `ROLES`')) {
      if (
        (upper.startsWith('SELECT ID FROM ROLES WHERE CODE =') ||
          upper.startsWith('SELECT ID FROM `ROLES` WHERE CODE =') ||
          upper.includes('FROM ROLES WHERE CODE = ?')) &&
        !upper.includes('JOIN ROLES')
      ) {
        const code = String(params[0]);
        const role = this.memDb.roles.find((r) => r.code === code);
        return [role ? [role] : [], []];
      }
      if (upper.includes('WHERE ID = ?') && !upper.includes('JOIN ROLES')) {
        const roleId = Number(params[0]);
        const role = this.memDb.roles.find((r) => r.id === roleId);
        return [role ? [role] : [], []];
      }
      if (!upper.includes('JOIN ROLES')) {
        return [[...this.memDb.roles], []];
      }
    }

    // 2b. Departments queries (before users/teachers when primary FROM is departments)
    if (
      upper.includes('FROM DEPARTMENTS') ||
      upper.includes('FROM `DEPARTMENTS`')
    ) {
      if (upper.includes('WHERE D.ID = ?') || upper.includes('WHERE ID = ?')) {
        const deptId = Number(params[0]);
        const dept = this.memDb.departments.find((d) => d.id === deptId);
        if (!dept) return [[], []];
        const assigned = this.memDb.users.find(
          (u) => u.department_id === dept.id && !u.is_deactivated
        );
        return [
          [
            {
              ...dept,
              assigned_user_id: assigned?.id || null,
              assigned_username: assigned?.username || null,
              assigned_full_name: assigned?.full_name || null,
              assigned_email: assigned?.email || null,
              assigned_is_suspended: assigned?.is_suspended || false,
              assigned_is_locked: assigned?.is_locked || false,
              assigned_locked_at: assigned?.locked_at || null,
              assigned_must_change_password: assigned?.must_change_password || false,
            },
          ],
          [],
        ];
      }
      if (upper.includes('WHERE CODE = ?')) {
        const code = String(params[0]).toUpperCase();
        if (upper.includes('AND ID != ?')) {
          const excludeId = Number(params[1]);
          const dept = this.memDb.departments.find(
            (d) => d.code.toUpperCase() === code && d.id !== excludeId
          );
          return [dept ? [dept] : [], []];
        }
        const dept = this.memDb.departments.find((d) => d.code.toUpperCase() === code);
        return [dept ? [dept] : [], []];
      }

      const sorted = [...this.memDb.departments].sort((a, b) => a.name.localeCompare(b.name));
      const enriched = sorted.map((dept) => {
        const assigned = this.memDb.users.find(
          (u) => u.department_id === dept.id && !u.is_deactivated
        );
        const teacherCount = this.memDb.teachers.filter(
          (t) => t.department_id === dept.id && t.status === 'ACTIVE'
        ).length;
        return {
          ...dept,
          teacher_count: teacherCount,
          assigned_user_id: assigned?.id || null,
          assigned_username: assigned?.username || null,
          assigned_full_name: assigned?.full_name || null,
          assigned_email: assigned?.email || null,
          assigned_is_suspended: assigned?.is_suspended || false,
          assigned_is_locked: assigned?.is_locked || false,
          assigned_locked_at: assigned?.locked_at || null,
          assigned_must_change_password: assigned?.must_change_password || false,
        };
      });
      return [enriched, []];
    }

    if (upper.startsWith('INSERT INTO DEPARTMENTS') || upper.startsWith('INSERT INTO `DEPARTMENTS`')) {
      const id = this.memDb.generateId('departments');
      const now = new Date().toISOString();
      const isActive =
        upper.includes('IS_ACTIVE') && params.length >= 4
          ? Boolean(params[3])
          : true;
      this.memDb.departments.push({
        id,
        code: String(params[0]),
        name: String(params[1]),
        description: params[2] ?? null,
        is_active: isActive,
        created_at: now,
        updated_at: now,
      });
      return [{ insertId: id, affectedRows: 1 }, []];
    }

    if (upper.startsWith('UPDATE DEPARTMENTS') || upper.startsWith('UPDATE `DEPARTMENTS`')) {
      const targetId = Number(params[params.length - 1]);
      const dept = this.memDb.departments.find((d) => d.id === targetId);
      if (dept) {
        if (upper.includes('CODE = ?') && upper.includes('IS_ACTIVE = ?')) {
          dept.code = String(params[0]);
          dept.name = String(params[1]);
          dept.description = params[2] ?? null;
          dept.is_active = Boolean(params[3]);
        } else if (upper.includes('CODE = ?')) {
          dept.code = String(params[0]);
          dept.name = String(params[1]);
          dept.description = params[2] ?? null;
        } else if (upper.includes('IS_ACTIVE = ?') && params.length === 2) {
          dept.is_active = Boolean(params[0]);
        } else {
          dept.name = String(params[0]);
          dept.description = params[1] ?? null;
          if (upper.includes('IS_ACTIVE = ?') && params.length >= 4) {
            dept.is_active = Boolean(params[2]);
          }
        }
        dept.updated_at = new Date().toISOString();
        return [{ affectedRows: 1 }, []];
      }
      return [{ affectedRows: 0 }, []];
    }

    // 2c. Teachers institutional records queries
    if (upper.includes('FROM TEACHERS') || upper.includes('FROM `TEACHERS`')) {
      if (upper.includes('WHERE EMPLOYEE_CODE = ?')) {
        const code = String(params[0]).toUpperCase();
        const excludeId = upper.includes('AND ID != ?') ? Number(params[1]) : null;
        const found = this.memDb.teachers.filter(
          (t) =>
            t.employee_code !== null &&
            t.employee_code !== undefined &&
            t.employee_code.toUpperCase() === code &&
            (excludeId === null || t.id !== excludeId)
        );
        return [found, []];
      }
      if (upper.includes('WHERE TEACHER_CODE = ?')) {
        const code = String(params[0]).toUpperCase();
        const excludeId = upper.includes('AND ID != ?') ? Number(params[1]) : null;
        const found = this.memDb.teachers.filter(
          (t) =>
            t.teacher_code !== null &&
            t.teacher_code !== undefined &&
            t.teacher_code.toUpperCase() === code &&
            (excludeId === null || t.id !== excludeId)
        );
        return [found, []];
      }
      if (upper.includes('WHERE T.ID = ?') || upper.includes('WHERE ID = ?')) {
        const id = Number(params[0]);
        const teacher = this.memDb.teachers.find((t) => t.id === id);
        if (!teacher) return [[], []];
        const dept = this.memDb.departments.find((d) => d.id === teacher.department_id);
        return [
          [
            {
              ...teacher,
              department_name: dept?.name || '',
              department_code: dept?.code || '',
            },
          ],
          [],
        ];
      }

      let list = this.memDb.teachers.map((t) => {
        const dept = this.memDb.departments.find((d) => d.id === t.department_id);
        const linkedUser = this.memDb.users.find((u) => u.teacher_id === t.id && !u.is_deactivated);
        return {
          ...t,
          department_name: dept?.name || '',
          department_code: dept?.code || '',
          linked_user_id: linkedUser?.id || null,
          linked_username: linkedUser?.username || null,
        };
      });

      let pIdx = 0;
      if (upper.includes('T.DEPARTMENT_ID = ?') || upper.includes('WHERE DEPARTMENT_ID = ?')) {
        const deptId = Number(params[pIdx++]);
        list = list.filter((t) => t.department_id === deptId);
      }
      const likeCount = (upper.match(/LIKE \?/g) || []).length;
      if (likeCount > 0) {
        const pattern = String(params[pIdx] || '').slice(1, -1).toLowerCase();
        pIdx += likeCount;
        list = list.filter(
          (t) =>
            (t.employee_code && t.employee_code.toLowerCase().includes(pattern)) ||
            (t.teacher_code && t.teacher_code.toLowerCase().includes(pattern)) ||
            (t.registration_number && t.registration_number.toLowerCase().includes(pattern)) ||
            t.full_name.toLowerCase().includes(pattern) ||
            t.designation.toLowerCase().includes(pattern)
        );
      }
      if (upper.includes('T.STATUS = ?')) {
        const st = String(params[pIdx++]);
        list = list.filter((t) => t.status === st);
      }
      if (upper.includes('T.DATA_VERIFICATION_REQUIRED = ?')) {
        const reqFlag = Boolean(params[pIdx++]);
        list = list.filter((t) => Boolean(t.data_verification_required) === reqFlag);
      }

      if (upper.includes('ORDER BY T.ID ASC') || upper.includes('ORDER BY ID ASC')) {
        list.sort((a, b) => a.id - b.id);
      } else {
        list.sort((a, b) => b.id - a.id);
      }
      return [list, []];
    }

    if (upper.startsWith('INSERT INTO TEACHERS') || upper.startsWith('INSERT INTO `TEACHERS`')) {
      const id = this.memDb.generateId('teachers');
      const now = new Date().toISOString();
      const colMatch = trimmed.match(/INSERT\s+INTO\s+`?teachers`?\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]+)\)/i);
      const record: any = {
        id,
        employee_code: null,
        teacher_code: null,
        teacher_code_status: 'NOT_PROVIDED',
        registration_number: null,
        full_name: '',
        designation: '',
        department_id: 0,
        qualification: null,
        date_of_birth: null,
        joining_date_service: null,
        joining_date_institute: null,
        reported_experience: null,
        previous_institute: null,
        contact_phone: null,
        contact_email: null,
        profile_photo_url: null,
        status: 'ACTIVE',
        data_verification_required: false,
        verification_notes: null,
        raw_source_snapshot: null,
        created_by: null,
        created_at: now,
        updated_at: now,
      };

      if (colMatch) {
        const cols = colMatch[1].split(',').map((c) => c.replace(/`/g, '').trim().toLowerCase());
        const valTokens = colMatch[2].split(',').map((v) => v.trim());
        let pCursor = 0;
        for (let i = 0; i < cols.length; i++) {
          const col = cols[i];
          const tok = valTokens[i] || '?';
          let val: any;
          if (tok === '?') {
            val = params[pCursor++];
          } else if (/^'.*'$/.test(tok)) {
            val = tok.slice(1, -1);
          } else if (tok.toUpperCase() === 'NULL') {
            val = null;
          } else if (tok.toUpperCase() === 'TRUE') {
            val = true;
          } else if (tok.toUpperCase() === 'FALSE') {
            val = false;
          } else {
            val = params[pCursor++];
          }
          if (col === 'department_id') {
            record[col] = Number(val);
          } else if (col === 'created_by') {
            record[col] = val !== undefined && val !== null ? Number(val) : null;
          } else if (col === 'data_verification_required') {
            record[col] = Boolean(val);
          } else if (col === 'raw_source_snapshot' && typeof val === 'string') {
            try {
              record[col] = JSON.parse(val);
            } catch {
              record[col] = val;
            }
          } else {
            record[col] = val ?? null;
          }
        }
      } else {
        record.employee_code = params[0] ?? null;
        record.full_name = String(params[1] || '');
        record.designation = String(params[2] || '');
        record.department_id = Number(params[3]);
        record.qualification = params[4] ?? null;
        record.contact_phone = params[5] ?? null;
        record.contact_email = params[6] ?? null;
        record.created_by = params[7] !== undefined && params[7] !== null ? Number(params[7]) : null;
      }

      if (record.employee_code) {
        const dupEmp = this.memDb.teachers.find(
          (t) => t.employee_code && t.employee_code.toUpperCase() === String(record.employee_code).toUpperCase()
        );
        if (dupEmp) {
          const err: any = new Error(`Duplicate entry '${record.employee_code}' for key 'employee_code'`);
          err.code = 'ER_DUP_ENTRY';
          throw err;
        }
      }
      if (record.teacher_code) {
        const dupTc = this.memDb.teachers.find(
          (t) => t.teacher_code && t.teacher_code.toUpperCase() === String(record.teacher_code).toUpperCase()
        );
        if (dupTc) {
          const err: any = new Error(`Duplicate entry '${record.teacher_code}' for key 'uq_teachers_teacher_code'`);
          err.code = 'ER_DUP_ENTRY';
          throw err;
        }
      }

      this.memDb.teachers.push(record);
      return [{ insertId: id, affectedRows: 1 }, []];
    }

    if (upper.startsWith('UPDATE TEACHERS') || upper.startsWith('UPDATE `TEACHERS`')) {
      const targetId = Number(params[params.length - 1]);
      const t: any = this.memDb.teachers.find((item) => item.id === targetId);
      if (t) {
        const setMatch = trimmed.match(/UPDATE\s+`?teachers`?\s+SET\s+([\s\S]+?)\s+WHERE\s+`?id`?\s*=\s*\?/i);
        if (setMatch) {
          const assignments = setMatch[1].split(',').map((s) => s.trim());
          let pCursor = 0;
          for (const assign of assignments) {
            const eqIdx = assign.indexOf('=');
            if (eqIdx === -1) continue;
            const col = assign.slice(0, eqIdx).replace(/`/g, '').trim().toLowerCase();
            const rhs = assign.slice(eqIdx + 1).trim();
            if (rhs === '?') {
              const val = params[pCursor++];
              if (col === 'department_id') {
                t[col] = Number(val);
              } else if (col === 'data_verification_required') {
                t[col] = Boolean(val);
              } else {
                t[col] = val ?? null;
              }
            }
          }
        } else {
          t.full_name = String(params[0]);
          t.designation = String(params[1]);
          t.department_id = Number(params[2]);
          t.qualification = params[3] ?? null;
          t.contact_phone = params[4] ?? null;
          t.contact_email = params[5] ?? null;
          t.status = params[6] || 'ACTIVE';
        }
        t.updated_at = new Date().toISOString();
        return [{ affectedRows: 1 }, []];
      }
      return [{ affectedRows: 0 }, []];
    }

    // 3. Sessions queries (must precede FROM USERS because session query joins users)
    if (upper.includes('FROM SESSIONS') || upper.includes('FROM `SESSIONS`')) {
      if (upper.includes('TOKEN_HASH = ?')) {
        const tokenHash = String(params[0]);
        const session = this.memDb.sessions.find((s) => s.token_hash === tokenHash);
        if (!session) return [[], []];
        const newerActive = this.memDb.sessions.filter(
          (s2) => s2.user_id === session.user_id && s2.is_active && s2.id > session.id
        ).length;
        const user = this.memDb.users.find((u) => u.id === session.user_id);
        if (!user) return [[], []];
        const role = this.memDb.roles.find((r) => r.id === user.role_id);
        const dept = user.department_id
          ? this.memDb.departments.find((d) => d.id === user.department_id)
          : null;
        const teacher = user.teacher_id
          ? this.memDb.teachers.find((t) => t.id === user.teacher_id)
          : null;
        return [
          [
            {
              session_id: session.id,
              user_id: user.id,
              last_activity_at: session.last_activity_at,
              expires_at: session.expires_at,
              is_active: session.is_active,
              newer_active_sessions: newerActive,
              id: session.id,
              username: user.username,
              email: user.email,
              full_name: user.full_name,
              role_id: user.role_id,
              department_id: user.department_id || null,
              department_name: dept?.name || null,
              teacher_id: user.teacher_id || null,
              teacher_employee_code: teacher?.employee_code || null,
              teacher_code: teacher?.teacher_code || null,
              teacher_designation: teacher?.designation || null,
              must_change_password: user.must_change_password,
              is_locked: user.is_locked,
              locked_at: user.locked_at,
              is_suspended: user.is_suspended,
              is_deactivated: user.is_deactivated,
              role_code: role?.code || '',
              role_name: role?.name || '',
            },
          ],
          [],
        ];
      }
    }

    if (upper.startsWith('UPDATE SESSIONS') || upper.startsWith('UPDATE `SESSIONS`')) {
      if (upper.includes('IS_ACTIVE = FALSE WHERE USER_ID = ?')) {
        const userId = Number(params[0]);
        let affected = 0;
        this.memDb.sessions.forEach((s) => {
          if (s.user_id === userId && s.is_active) {
            s.is_active = false;
            affected++;
          }
        });
        return [{ affectedRows: affected }, []];
      }
      if (upper.includes('IS_ACTIVE = FALSE WHERE ID = ?')) {
        const sessionId = Number(params[0]);
        const session = this.memDb.sessions.find((s) => s.id === sessionId);
        if (session) {
          session.is_active = false;
          return [{ affectedRows: 1 }, []];
        }
        return [{ affectedRows: 0 }, []];
      }
      if (upper.includes('LAST_ACTIVITY_AT = NOW()')) {
        const sessionIdOrHash = params[0];
        const session =
          typeof sessionIdOrHash === 'number'
            ? this.memDb.sessions.find((s) => s.id === sessionIdOrHash)
            : this.memDb.sessions.find(
                (s) => s.id === Number(sessionIdOrHash) || s.token_hash === sessionIdOrHash
              );
        if (session) {
          session.last_activity_at = new Date().toISOString();
          session.expires_at = new Date(Date.now() + 3600000).toISOString();
          return [{ affectedRows: 1 }, []];
        }
      }
      return [{ affectedRows: 0 }, []];
    }

    if (upper.startsWith('INSERT INTO SESSIONS') || upper.startsWith('INSERT INTO `SESSIONS`')) {
      const id = this.memDb.generateId('sessions');
      this.memDb.sessions.push({
        id,
        user_id: Number(params[0]),
        token_hash: String(params[1]),
        ip_address: params[2] ?? null,
        user_agent: params[3] ?? null,
        last_activity_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        is_active: true,
        created_at: new Date().toISOString(),
      });
      return [{ insertId: id, affectedRows: 1 }, []];
    }

    // 4. Audit Logs queries (must precede FROM USERS because audit_logs query LEFT JOINs users)
    if (upper.includes('FROM AUDIT_LOGS') || upper.includes('FROM `AUDIT_LOGS`')) {
      let logs = this.memDb.auditLogs.map((log) => {
        const actor = log.actor_id ? this.memDb.users.find((u) => u.id === log.actor_id) : null;
        const actorRole = actor ? this.memDb.roles.find((r) => r.id === actor.role_id) : null;
        return {
          ...log,
          actor_username: actor?.username || null,
          actor_full_name: actor?.full_name || null,
          actor_role_code: actorRole?.code || null,
        };
      });

      if (upper.includes("ACTOR_ROLE.CODE != 'SUPER_ADMIN'") || upper.includes('EXCLUDE_SUPER_ADMIN')) {
        const superAdminIds = new Set(
          this.memDb.users
            .filter((u) => {
              const r = this.memDb.roles.find((rl) => rl.id === u.role_id);
              return r?.code === 'SUPER_ADMIN';
            })
            .map((u) => String(u.id))
        );
        logs = logs.filter(
          (l) =>
            l.actor_role_code !== 'SUPER_ADMIN' &&
            !(l.target_type === 'USER' && l.target_id && superAdminIds.has(String(l.target_id)))
        );
      }

      if (upper.includes("(AL.TARGET_TYPE = 'USER' AND AL.TARGET_ID = ?) OR AL.ACTOR_ID = ?")) {
        const targetIdStr = String(params[0]);
        const targetIdNum = Number(params[1]);
        logs = logs.filter(
          (l) => (l.target_type === 'USER' && String(l.target_id) === targetIdStr) || l.actor_id === targetIdNum
        );
      } else {
        let pIdx = 0;
        if (upper.includes('AL.ACTION = ?')) {
          const act = String(params[pIdx++]);
          logs = logs.filter((l) => l.action === act);
        }
        if (upper.includes('AL.ACTION LIKE ?')) {
          const pat = String(params[pIdx]).slice(1, -1).toLowerCase();
          pIdx += 3;
          logs = logs.filter(
            (l) =>
              l.action.toLowerCase().includes(pat) ||
              (l.actor_username && l.actor_username.toLowerCase().includes(pat)) ||
              (l.actor_full_name && l.actor_full_name.toLowerCase().includes(pat))
          );
        }
      }

      logs.sort((a, b) => b.id - a.id);
      const limitParam = typeof params[params.length - 1] === 'number' ? params[params.length - 1] : 50;
      return [logs.slice(0, limitParam), []];
    }

    if (upper.startsWith('INSERT INTO AUDIT_LOGS') || upper.startsWith('INSERT INTO `AUDIT_LOGS`')) {
      const id = this.memDb.generateId('auditLogs');
      this.memDb.auditLogs.push({
        id,
        actor_id: params[0] ?? null,
        action: String(params[1]),
        target_type: params[2] ?? null,
        target_id: params[3] !== undefined && params[3] !== null ? String(params[3]) : null,
        ip_address: params[4] ?? null,
        details: params[5]
          ? JSON.parse(typeof params[5] === 'string' ? params[5] : JSON.stringify(params[5]))
          : null,
        created_at: new Date().toISOString(),
      });
      return [{ insertId: id, affectedRows: 1 }, []];
    }

    // 5. User queries (only when primary table is USERS, not JOIN users from fees/students/etc.)
    if (
      upper.startsWith('INSERT INTO USERS') ||
      upper.startsWith('INSERT INTO `USERS`')
    ) {
      const id = this.memDb.generateId('users');
      const now = new Date().toISOString();
      const colMatch = trimmed.match(/INSERT\s+INTO\s+`?users`?\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]+)\)/i);
      const newUser: any = {
        id,
        username: '',
        email: null,
        password_hash: '',
        role_id: 1,
        department_id: null,
        teacher_id: null,
        full_name: '',
        must_change_password: true,
        failed_attempts: 0,
        is_locked: false,
        locked_at: null,
        is_suspended: false,
        suspended_at: null,
        suspension_reason: null,
        is_deactivated: false,
        deactivated_at: null,
        deactivation_reason: null,
        created_by: null,
        created_at: now,
        updated_at: now,
      };

      if (colMatch) {
        const cols = colMatch[1].split(',').map((c) => c.replace(/`/g, '').trim().toLowerCase());
        const valTokens = colMatch[2].split(',').map((v) => v.trim());
        let pCursor = 0;
        for (let i = 0; i < cols.length; i++) {
          const col = cols[i];
          const tok = valTokens[i] || '?';
          let val: any;
          if (tok === '?') {
            val = params[pCursor++];
          } else if (/^'.*'$/.test(tok)) {
            val = tok.slice(1, -1);
          } else if (tok.toUpperCase() === 'NULL') {
            val = null;
          } else if (tok.toUpperCase() === 'TRUE') {
            val = true;
          } else if (tok.toUpperCase() === 'FALSE') {
            val = false;
          } else {
            val = params[pCursor++];
          }
          if (col === 'id') {
            newUser[col] = Number(val);
          } else if (col === 'role_id' || col === 'department_id' || col === 'teacher_id' || col === 'created_by') {
            newUser[col] = val !== undefined && val !== null ? Number(val) : null;
          } else {
            newUser[col] = val ?? null;
          }
        }
      } else {
        newUser.username = String(params[0]);
        newUser.email = params[1] ?? null;
        newUser.password_hash = String(params[2]);
        newUser.role_id = Number(params[3]);
        newUser.full_name = String(params[4]);
      }

      this.memDb.users.push(newUser);
      return [{ insertId: id, affectedRows: 1 }, []];
    }

    if (upper.startsWith('UPDATE USERS') || upper.startsWith('UPDATE `USERS`')) {
      const targetId = Number(params[params.length - 1]);
      const user = this.memDb.users.find((u) => u.id === targetId);
      if (user) {
        if (upper.includes('PASSWORD_HASH = ?, MUST_CHANGE_PASSWORD = FALSE')) {
          user.password_hash = String(params[0]);
          user.must_change_password = false;
        } else if (upper.includes('PASSWORD_HASH = ?, MUST_CHANGE_PASSWORD = TRUE')) {
          user.password_hash = String(params[0]);
          user.must_change_password = true;
          user.failed_attempts = 0;
          user.is_locked = false;
          user.locked_at = null;
        } else if (upper.includes('FAILED_ATTEMPTS = ?, IS_LOCKED = TRUE')) {
          user.failed_attempts = Number(params[0]);
          user.is_locked = true;
          user.locked_at = new Date().toISOString();
        } else if (upper.includes('FAILED_ATTEMPTS = 0, IS_LOCKED = FALSE')) {
          user.failed_attempts = 0;
          user.is_locked = false;
          user.locked_at = null;
        } else if (upper.includes('IS_LOCKED = FALSE, LOCKED_AT = NULL, FAILED_ATTEMPTS = 0')) {
          user.is_locked = false;
          user.locked_at = null;
          user.failed_attempts = 0;
        } else if (upper.includes('FAILED_ATTEMPTS = ?')) {
          user.failed_attempts = Number(params[0]);
        } else if (upper.includes('IS_SUSPENDED = TRUE')) {
          user.is_suspended = true;
          user.suspended_at = new Date().toISOString();
          if (upper.includes('SUSPENSION_REASON = ?')) {
            user.suspension_reason = params[0] ?? null;
          }
        } else if (upper.includes('IS_SUSPENDED = FALSE')) {
          user.is_suspended = false;
          user.suspended_at = null;
          user.suspension_reason = null;
          user.is_deactivated = false;
          user.deactivated_at = null;
          user.deactivation_reason = null;
        } else if (upper.includes('IS_DEACTIVATED = TRUE')) {
          user.is_deactivated = true;
          user.deactivated_at = new Date().toISOString();
          if (upper.includes('DEACTIVATION_REASON = ?')) {
            user.deactivation_reason = params[0] ?? null;
          }
        } else if (upper.includes('FULL_NAME = ?, EMAIL = ?, ROLE_ID = ?')) {
          user.full_name = String(params[0]);
          user.email = params[1] !== undefined && params[1] !== null && String(params[1]).trim() !== '' ? String(params[1]) : null;
          user.role_id = Number(params[2]);
          user.department_id = params[3] !== null && params[3] !== undefined ? Number(params[3]) : null;
          if (upper.includes('TEACHER_ID = ?')) {
            user.teacher_id = params[4] !== null && params[4] !== undefined ? Number(params[4]) : null;
          }
        } else if (upper.includes('TEACHER_ID = ? WHERE ID = ?')) {
          user.teacher_id = params[0] !== null && params[0] !== undefined ? Number(params[0]) : null;
        }
        user.updated_at = new Date().toISOString();
        return [{ affectedRows: 1 }, []];
      }
      return [{ affectedRows: 0 }, []];
    }

    if (
      (upper.includes('FROM USERS') || upper.includes('FROM `USERS`')) &&
      !upper.includes('FROM STUDENT_FEE_ASSESSMENTS') &&
      !upper.includes('FROM SERVICE_ENROLLMENTS') &&
      !upper.includes('FROM FEE_CONCESSIONS') &&
      !upper.includes('FROM FEE_PAYMENTS') &&
      !upper.includes('FROM FEE_RECEIPTS')
    ) {
      // Active Super Admin count check
      if (upper.includes('COUNT(*) AS ACTIVE_ADMINS')) {
        const excludeId = Number(params[0]);
        const superAdminRole = this.memDb.roles.find((r) => r.code === 'SUPER_ADMIN');
        const activeAdmins = this.memDb.users.filter(
          (u) =>
            u.role_id === superAdminRole?.id &&
            !u.is_deactivated &&
            !u.is_suspended &&
            u.id !== excludeId
        ).length;
        return [[{ active_admins: activeAdmins }], []];
      }

      // Check existing user by role_id (init.ts check)
      if (upper.includes('WHERE ROLE_ID = ?')) {
        const rId = Number(params[0]);
        const found = this.memDb.users.filter((u) => u.role_id === rId);
        return [found, []];
      }

      // Check department assignment uniqueness
      if (upper.includes('WHERE DEPARTMENT_ID = ? AND IS_DEACTIVATED = FALSE')) {
        const deptId = Number(params[0]);
        const excludeId = upper.includes('AND ID != ?') ? Number(params[1]) : -1;
        const found = this.memDb.users.filter(
          (u) => u.department_id === deptId && !u.is_deactivated && u.id !== excludeId
        );
        return [found, []];
      }

      // Check teacher assignment lookup
      if (upper.includes('WHERE TEACHER_ID = ?')) {
        const teacherId = Number(params[0]);
        const excludeId = upper.includes('AND ID != ?') ? Number(params[1]) : -1;
        const found = this.memDb.users.filter(
          (u) => u.teacher_id === teacherId && (excludeId === -1 || u.id !== excludeId) && (!upper.includes('IS_DEACTIVATED = FALSE') || !u.is_deactivated)
        );
        return [found, []];
      }

      if (upper.includes('WHERE TEACHER_ID IN')) {
        let targetTeacherIds = params;
        if (!targetTeacherIds || targetTeacherIds.length === 0) {
          const match = sql.match(/IN\s*\(([^)]+)\)/i);
          if (match) {
            targetTeacherIds = match[1].split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
          }
        }
        const found = this.memDb.users.filter((u) => u.teacher_id !== null && targetTeacherIds.includes(u.teacher_id) && !u.is_deactivated);
        return [found, []];
      }

      // Check single user by ID
      if (upper.includes('WHERE U.ID = ?') || upper.includes('WHERE ID = ?')) {
        const targetId = Number(params[0]);
        const user = this.memDb.users.find((u) => u.id === targetId);
        if (!user) return [[], []];
        const role = this.memDb.roles.find((r) => r.id === user.role_id);
        const dept = user.department_id
          ? this.memDb.departments.find((d) => d.id === user.department_id)
          : null;
        const teacher = user.teacher_id
          ? this.memDb.teachers.find((t) => t.id === user.teacher_id)
          : null;
        return [
          [
            {
              ...user,
              role_code: role?.code || '',
              role_name: role?.name || '',
              department_name: dept?.name || null,
              department_code: dept?.code || null,
              teacher_name: teacher?.full_name || null,
              teacher_employee_code: teacher?.employee_code || null,
              teacher_code: teacher?.teacher_code || null,
              teacher_designation: teacher?.designation || null,
            },
          ],
          [],
        ];
      }

      // Unambiguous identity conflict check on create / edit
      if (upper.includes('LOWER(USERNAME) = ?')) {
        const excludeId = upper.includes('ID != ?') ? Number(params[params.length - 1]) : -1;
        const identifiers = params
          .slice(0, upper.includes('ID != ?') ? params.length - 1 : params.length)
          .filter((p) => typeof p === 'string' && p.trim() !== '')
          .map((p) => String(p).toLowerCase());

        const conflicts = this.memDb.users.filter((u) => {
          if (u.id === excludeId) return false;
          const uName = u.username.toLowerCase();
          const uEmail = u.email ? u.email.toLowerCase() : null;
          return identifiers.includes(uName) || (uEmail !== null && identifiers.includes(uEmail));
        });
        return [conflicts, []];
      }

      // Login lookup by username or non-null email
      if (
        upper.includes('WHERE U.USERNAME = ?') ||
        upper.includes('WHERE USERNAME = ?') ||
        upper.includes('WHERE EMAIL = ?')
      ) {
        if (upper.includes('WHERE EMAIL = ? AND ID != ?')) {
          const emailTarget = String(params[0]).toLowerCase();
          const excludeId = Number(params[1]);
          const found = this.memDb.users.filter(
            (u) => u.email && u.email.toLowerCase() === emailTarget && u.id !== excludeId
          );
          return [found, []];
        }
        const p1 = String(params[0]).toLowerCase();
        const p2 = params[1] !== undefined && params[1] !== null ? String(params[1]).toLowerCase() : p1;
        const user = this.memDb.users.find(
          (u) =>
            u.username.toLowerCase() === p1 ||
            (u.email !== null && u.email.toLowerCase() === p2)
        );
        if (!user) return [[], []];
        const role = this.memDb.roles.find((r) => r.id === user.role_id);
        const dept = user.department_id
          ? this.memDb.departments.find((d) => d.id === user.department_id)
          : null;
        const teacher = user.teacher_id
          ? this.memDb.teachers.find((t) => t.id === user.teacher_id)
          : null;
        return [
          [
            {
              ...user,
              role_code: role?.code || '',
              role_name: role?.name || '',
              department_name: dept?.name || null,
              department_code: dept?.code || null,
              teacher_name: teacher?.full_name || null,
              teacher_employee_code: teacher?.employee_code || null,
              teacher_code: teacher?.teacher_code || null,
              teacher_designation: teacher?.designation || null,
            },
          ],
          [],
        ];
      }

      // Directory list / count
      let list = this.memDb.users.map((u) => {
        const role = this.memDb.roles.find((r) => r.id === u.role_id);
        const dept = u.department_id
          ? this.memDb.departments.find((d) => d.id === u.department_id)
          : null;
        const teacher = u.teacher_id
          ? this.memDb.teachers.find((t) => t.id === u.teacher_id)
          : null;
        const creator = u.created_by
          ? this.memDb.users.find((c) => c.id === u.created_by)
          : null;
        return {
          ...u,
          role_code: role?.code || '',
          role_name: role?.name || '',
          department_name: dept?.name || null,
          department_code: dept?.code || null,
          teacher_name: teacher?.full_name || null,
          teacher_employee_code: teacher?.employee_code || null,
          teacher_code: teacher?.teacher_code || null,
          teacher_designation: teacher?.designation || null,
          created_by_username: creator?.username || null,
        };
      });

      if (upper.includes("R.CODE != 'SUPER_ADMIN'") || upper.includes('R.CODE != ?')) {
        list = list.filter((u) => u.role_code !== 'SUPER_ADMIN');
      }

      const searchParam = params.find(
        (p) => typeof p === 'string' && p.startsWith('%') && p.endsWith('%')
      );
      if (searchParam) {
        const rawSearch = searchParam.slice(1, -1).toLowerCase();
        list = list.filter(
          (u) =>
            u.username.toLowerCase().includes(rawSearch) ||
            (u.email && u.email.toLowerCase().includes(rawSearch)) ||
            u.full_name.toLowerCase().includes(rawSearch)
        );
      }

      const roleFilterParam = params.find(
        (p) =>
          typeof p === 'string' &&
          [
            'SUPER_ADMIN',
            'PRINCIPAL',
            'SECRETARY',
            'OFFICE',
            'STAFF',
            'HOD',
            'FACULTY',
            'LIBRARY',
            'DEPARTMENT',
          ].includes(p)
      );
      if (roleFilterParam) {
        list = list.filter((u) => u.role_code === roleFilterParam);
      }

      const LOCKOUT_MS = 30 * 60 * 1000;
      const isCurrentlyLocked = (u: any) =>
        Boolean(
          u.is_locked &&
            u.locked_at &&
            Date.now() - new Date(u.locked_at).getTime() < LOCKOUT_MS
        );

      if (upper.includes('U.IS_DEACTIVATED = TRUE')) {
        list = list.filter((u) => u.is_deactivated);
      } else if (upper.includes('U.IS_LOCKED = TRUE')) {
        list = list.filter((u) => isCurrentlyLocked(u) && !u.is_deactivated);
      } else if (upper.includes('U.IS_SUSPENDED = TRUE')) {
        list = list.filter((u) => u.is_suspended && !u.is_deactivated);
      } else if (upper.includes('U.IS_SUSPENDED = FALSE AND U.IS_DEACTIVATED = FALSE')) {
        list = list.filter((u) => !isCurrentlyLocked(u) && !u.is_suspended && !u.is_deactivated);
      }

      if (upper.includes('COUNT(*)')) {
        return [[{ total: list.length }], []];
      }

      list.sort((a, b) => b.id - a.id);
      const limitParam =
        typeof params[params.length - 2] === 'number' ? params[params.length - 2] : 20;
      const offsetParam =
        typeof params[params.length - 1] === 'number' ? params[params.length - 1] : 0;
      return [list.slice(offsetParam, offsetParam + limitParam), []];
    }

    // 6. Fee Structures queries
    if (upper.includes('FROM FEE_STRUCTURES') || upper.includes('FROM `FEE_STRUCTURES`')) {
      if (
        upper.includes('WHERE ACADEMIC_YEAR = ? AND ADMISSION_CATEGORY = ?') ||
        upper.includes("WHERE ACADEMIC_YEAR = '2026-2027' AND ADMISSION_CATEGORY = ?") ||
        upper.includes('WHERE `ACADEMIC_YEAR` = ? AND `ADMISSION_CATEGORY` = ?')
      ) {
        if (upper.includes("ACADEMIC_YEAR = '2026-2027'")) {
          const cat = params[0];
          const found = this.memDb.feeStructures.filter(
            (fs) => fs.academic_year === '2026-2027' && fs.admission_category === cat
          );
          return [found, []];
        }
        const year = params[0];
        const cat = params[1];
        const studyYear = params[2] !== undefined ? parseInt(params[2], 10) : 1;
        const found = this.memDb.feeStructures.filter(
          (fs) =>
            fs.academic_year === year &&
            fs.admission_category === cat &&
            (Number(fs.year_of_study) === studyYear || upper.includes('LIMIT 1'))
        );
        return [found, []];
      }
      const academicYear =
        params.find((p) => typeof p === 'string' && p.includes('-')) || '2026-2027';
      const rows = this.memDb.feeStructures.filter((fs) => fs.academic_year === academicYear);
      return [rows, []];
    }

    if (
      upper.startsWith('INSERT INTO FEE_STRUCTURES') ||
      upper.startsWith('INSERT INTO `FEE_STRUCTURES`')
    ) {
      const id = this.memDb.generateId('feeStructures');
      this.memDb.feeStructures.push({
        id,
        academic_year: params[0],
        admission_category: params[1],
        year_of_study: params[2] || 1,
        college_fee: parseFloat(params[3]),
        development_fee: parseFloat(params[4]),
        mess_fee: parseFloat(params[5] || 30000),
        hostel_fee: parseFloat(params[6] || 30000),
        total_annual_fee: parseFloat(params[7]),
        description: params[8] || '',
        is_active: params[9] !== undefined ? Boolean(params[9]) : true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return [{ insertId: id, affectedRows: 1 }, []];
    }

    if (
      upper.startsWith('UPDATE FEE_STRUCTURES') ||
      upper.startsWith('UPDATE `FEE_STRUCTURES`')
    ) {
      const structureId = params[params.length - 1];
      const structure = this.memDb.feeStructures.find((fs) => fs.id === structureId);
      if (structure) {
        if (upper.includes('ACADEMIC_YEAR = ?')) {
          structure.academic_year = params[0];
          structure.admission_category = params[1];
          structure.year_of_study = params[2];
          structure.college_fee = parseFloat(params[3]);
          structure.development_fee = parseFloat(params[4]);
          structure.mess_fee = parseFloat(params[5]);
          structure.hostel_fee = parseFloat(params[6]);
          structure.total_annual_fee = parseFloat(params[7]);
          structure.description = params[8];
          structure.is_active = Boolean(params[9]);
        } else {
          structure.college_fee = parseFloat(params[0]);
          structure.development_fee = parseFloat(params[1]);
          structure.mess_fee = parseFloat(params[2]);
          structure.hostel_fee = parseFloat(params[3]);
          structure.total_annual_fee = parseFloat(params[4]);
          structure.description = params[5];
          structure.is_active = Boolean(params[6]);
        }
        structure.updated_at = new Date().toISOString();
        return [{ affectedRows: 1 }, []];
      }
      return [{ affectedRows: 0 }, []];
    }

    // 7. Students queries
    if (upper.startsWith('UPDATE STUDENTS') || upper.startsWith('UPDATE `STUDENTS`')) {
      const studentId = Number(params[params.length - 1]);
      const st = this.memDb.students.find((s) => s.id === studentId);
      if (st) {
        if (upper.includes('MESS_ENROLLED = TRUE')) {
          st.mess_enrolled = true;
        } else if (upper.includes('MESS_ENROLLED = FALSE')) {
          st.mess_enrolled = false;
        } else if (upper.includes('HOSTEL_ENROLLED = TRUE')) {
          st.hostel_enrolled = true;
        } else if (upper.includes('HOSTEL_ENROLLED = FALSE')) {
          st.hostel_enrolled = false;
        } else if (upper.includes('FULL_NAME = ?')) {
          st.full_name = String(params[0]);
          st.admission_category = params[1];
          st.admission_year = Number(params[2]);
          st.current_year_of_study = Number(params[3]);
          st.contact_phone = params[4] ?? null;
          st.contact_email = params[5] ?? null;
          st.status = params[6] || 'ACTIVE';
        }
        st.updated_at = new Date().toISOString();
        return [{ affectedRows: 1 }, []];
      }
      return [{ affectedRows: 0 }, []];
    }

    if (upper.includes('FROM STUDENTS') || upper.includes('FROM `STUDENTS`')) {
      if (upper.includes('WHERE STUDENT_ID_NUMBER = ?')) {
        const studentIdNumber = String(params[0]).toUpperCase();
        const found = this.memDb.students.filter(
          (s) => s.student_id_number.toUpperCase() === studentIdNumber
        );
        return [found, []];
      }
      if (upper.includes('WHERE S.ID = ?') || upper.includes('WHERE ID = ?')) {
        const studentId = parseInt(params[0], 10);
        const student = this.memDb.students.find((s) => s.id === studentId);
        return [student ? [student] : [], []];
      }
      if (upper.includes('COUNT(*) AS STUDENT_COUNT')) {
        return [
          [
            {
              student_count: this.memDb.students.filter((s) => s.status === 'ACTIVE').length,
            },
          ],
          [],
        ];
      }

      let list = [...this.memDb.students];
      const searchParam = params.find(
        (p) => typeof p === 'string' && p.startsWith('%') && p.endsWith('%')
      );
      if (searchParam) {
        const pat = searchParam.slice(1, -1).toLowerCase();
        list = list.filter(
          (s) =>
            s.student_id_number.toLowerCase().includes(pat) ||
            (s.temporary_roll_number && s.temporary_roll_number.toLowerCase().includes(pat)) ||
            (s.permanent_university_number && s.permanent_university_number.toLowerCase().includes(pat)) ||
            s.full_name.toLowerCase().includes(pat)
        );
      }
      const catParam = params.find(
        (p) =>
          typeof p === 'string' &&
          ['GOVERNMENT', 'MANAGEMENT_PRIVATE', 'NRI'].includes(p)
      );
      if (catParam) {
        list = list.filter((s) => s.admission_category === catParam);
      }

      const results = list
        .sort((a, b) => b.id - a.id)
        .map((s) => {
          const assessment = this.memDb.assessments.find((a) => a.student_id === s.id);
          const payments = this.memDb.payments.filter(
            (p) => p.student_id === s.id && p.status === 'VERIFIED'
          );
          const pendingPayments = this.memDb.payments.filter(
            (p) => p.student_id === s.id && p.status === 'PENDING_VERIFICATION'
          );
          const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
          const totalPending = pendingPayments.reduce((sum, p) => sum + p.amount, 0);

          return {
            id: s.id,
            student_id_number: s.student_id_number,
            temporary_roll_number: s.temporary_roll_number || s.student_id_number,
            permanent_university_number: s.permanent_university_number || null,
            university_reg_status: s.university_reg_status || 'NOT_ENTERED',
            full_name: s.full_name,
            admission_category: s.admission_category,
            admission_year: s.admission_year,
            current_year_of_study: s.current_year_of_study,
            is_kea_eligible: s.is_kea_eligible,
            kea_acknowledgement_no: s.kea_acknowledgement_no,
            mess_enrolled: s.mess_enrolled,
            hostel_enrolled: s.hostel_enrolled,
            contact_phone: s.contact_phone,
            contact_email: s.contact_email,
            status: s.status,
            created_at: s.created_at,
            updated_at: s.updated_at,
            current_assessment_id: assessment?.id || null,
            academic_year: assessment?.academic_year || '2026-2027',
            is_kea_exception_applied: assessment?.is_kea_exception_applied || false,
            kea_exception_reason: assessment?.kea_exception_reason || null,
            assessed_college_fee: assessment?.assessed_college_fee || 0,
            assessed_development_fee: assessment?.assessed_development_fee || 0,
            assessed_mess_fee: assessment?.assessed_mess_fee || 0,
            assessed_hostel_fee: assessment?.assessed_hostel_fee || 0,
            total_assessed_fee: assessment?.total_assessed_fee || 0,
            concession_total: assessment?.concession_total || 0,
            revised_payable: assessment?.revised_payable || 0,
            total_paid: totalPaid,
            total_pending: totalPending,
          };
        });
      return [results, []];
    }

    if (upper.startsWith('INSERT INTO STUDENTS') || upper.startsWith('INSERT INTO `STUDENTS`')) {
      const id = this.memDb.generateId('students');
      this.memDb.students.push({
        id,
        student_id_number: params[0],
        temporary_roll_number: params[0],
        permanent_university_number: null,
        university_reg_status: 'NOT_ENTERED',
        full_name: params[1],
        admission_category: params[2],
        admission_year: params[3],
        current_year_of_study: params[4],
        is_kea_eligible: Boolean(params[5]),
        kea_acknowledgement_no: params[6] || null,
        mess_enrolled: Boolean(params[7]),
        hostel_enrolled: Boolean(params[8]),
        contact_phone: params[9] || null,
        contact_email: params[10] || null,
        administrative_status: 'ACTIVE',
        admission_status: 'CONFIRMED',
        progression_status: 'REGULAR_ACTIVE',
        detention_stage: 0,
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return [{ insertId: id, affectedRows: 1 }, []];
    }

    // 8. Assessments queries
    if (
      upper.includes('FROM STUDENT_FEE_ASSESSMENTS') ||
      upper.includes('FROM `STUDENT_FEE_ASSESSMENTS`')
    ) {
      if (upper.includes('SUM(TOTAL_ASSESSED_FEE)') || upper.includes('SUM(REVISED_PAYABLE)')) {
        const total = this.memDb.assessments.reduce(
          (sum, a) => sum + (a.revised_payable || a.total_assessed_fee),
          0
        );
        return [[{ total_assessed: total }], []];
      }
      if (upper.includes('WHERE STUDENT_ID = ?') || upper.includes('WHERE SFA.STUDENT_ID = ?')) {
        const studentId = parseInt(params[0], 10);
        const list = this.memDb.assessments
          .filter((a) => a.student_id === studentId)
          .map((a) => {
            const user = this.memDb.users.find((u) => u.id === a.assessed_by);
            return {
              ...a,
              assessor_name: user?.full_name || 'System Assessor',
            };
          });
        return [list, []];
      }
      if (upper.includes('WHERE ID = ?') || upper.includes('WHERE SFA.ID = ?')) {
        const assessmentId = parseInt(params[0], 10);
        const a = this.memDb.assessments.find((item) => item.id === assessmentId);
        if (!a) return [[], []];
        const s = this.memDb.students.find((st) => st.id === a.student_id);
        return [
          [
            {
              ...a,
              student_id_number: s?.student_id_number,
              full_name: s?.full_name,
              admission_category: s?.admission_category || a.admission_category,
            },
          ],
          [],
        ];
      }
    }

    if (
      upper.startsWith('INSERT INTO STUDENT_FEE_ASSESSMENTS') ||
      upper.startsWith('INSERT INTO `STUDENT_FEE_ASSESSMENTS`')
    ) {
      const id = this.memDb.generateId('assessments');
      const hasExplicitAcademicYearLiteral = upper.includes("'2026-2027'");
      if (hasExplicitAcademicYearLiteral) {
        // VALUES (?, '2026-2027', ?, ?, FALSE, NULL, ?, ?, ?, ?, ?, 0.00, ?, 'Initial Assessment', ?)
        this.memDb.assessments.push({
          id,
          student_id: Number(params[0]),
          academic_year: '2026-2027',
          year_of_study: Number(params[1]),
          admission_category: params[2],
          is_kea_exception_applied: false,
          kea_exception_reason: null,
          assessed_college_fee: parseFloat(params[3]),
          assessed_development_fee: parseFloat(params[4]),
          assessed_mess_fee: parseFloat(params[5] || 0),
          assessed_hostel_fee: parseFloat(params[6] || 0),
          total_assessed_fee: parseFloat(params[7]),
          concession_total: 0,
          revised_payable: parseFloat(params[8]),
          notes: 'Initial Assessment',
          assessed_by: Number(params[9]),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      } else {
        this.memDb.assessments.push({
          id,
          student_id: params[0],
          academic_year: params[1],
          year_of_study: params[2],
          admission_category: params[3],
          is_kea_exception_applied: Boolean(params[4]),
          kea_exception_reason: params[5] || null,
          assessed_college_fee: parseFloat(params[6]),
          assessed_development_fee: parseFloat(params[7]),
          assessed_mess_fee: parseFloat(params[8] || 0),
          assessed_hostel_fee: parseFloat(params[9] || 0),
          total_assessed_fee: parseFloat(params[10]),
          concession_total: parseFloat(params[11] || 0),
          revised_payable: parseFloat(params[12] || params[10]),
          notes: params[13] || null,
          assessed_by: params[14],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      return [{ insertId: id, affectedRows: 1 }, []];
    }

    if (
      upper.startsWith('UPDATE STUDENT_FEE_ASSESSMENTS') ||
      upper.startsWith('UPDATE `STUDENT_FEE_ASSESSMENTS`')
    ) {
      const assessmentId = params[params.length - 1];
      const a = this.memDb.assessments.find((item) => item.id === assessmentId);
      if (a) {
        if (upper.includes('ASSESSED_COLLEGE_FEE = ?')) {
          a.assessed_college_fee = parseFloat(params[0]);
          a.assessed_development_fee = parseFloat(params[1]);
          a.total_assessed_fee = parseFloat(params[2]);
          a.revised_payable = parseFloat(params[3]);
          if (params[4]) a.notes = params[4];
        } else if (upper.includes('CONCESSION_TOTAL = ?')) {
          a.concession_total = parseFloat(params[0]);
          a.revised_payable = parseFloat(params[1]);
        } else if (upper.includes('ASSESSED_MESS_FEE = ?')) {
          a.assessed_mess_fee = parseFloat(params[0]);
          a.assessed_hostel_fee = parseFloat(params[1]);
          a.total_assessed_fee = parseFloat(params[2]);
          a.revised_payable = parseFloat(params[3]);
        }
        a.updated_at = new Date().toISOString();
        return [{ affectedRows: 1 }, []];
      }
      return [{ affectedRows: 0 }, []];
    }

    // 9. Service Enrollments queries
    if (
      upper.includes('FROM SERVICE_ENROLLMENTS') ||
      upper.includes('FROM `SERVICE_ENROLLMENTS`')
    ) {
      const studentId = parseInt(params[0], 10);
      const list = this.memDb.serviceEnrollments
        .filter((se) => se.student_id === studentId)
        .map((se) => {
          const user = this.memDb.users.find((u) => u.id === se.created_by);
          return {
            ...se,
            creator_name: user?.full_name || 'Staff',
          };
        });
      return [list, []];
    }

    if (
      upper.startsWith('INSERT INTO SERVICE_ENROLLMENTS') ||
      upper.startsWith('INSERT INTO `SERVICE_ENROLLMENTS`')
    ) {
      const id = this.memDb.generateId('serviceEnrollments');
      if (upper.includes("'MESS'") || upper.includes("'HOSTEL'")) {
        const svcType = upper.includes("'MESS'") ? 'MESS' : 'HOSTEL';
        this.memDb.serviceEnrollments.push({
          id,
          student_id: Number(params[0]),
          service_type: svcType,
          start_date: params[1],
          end_date: null,
          annual_fee: parseFloat(params[2]),
          status: 'ACTIVE',
          created_by: Number(params[3]),
          notes: 'Enrolled at admission',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      } else {
        this.memDb.serviceEnrollments.push({
          id,
          student_id: Number(params[0]),
          service_type: params[1],
          start_date: params[2],
          end_date: null,
          annual_fee: parseFloat(params[3]),
          status: 'ACTIVE',
          created_by: Number(params[4]),
          notes: params[5] || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      return [{ insertId: id, affectedRows: 1 }, []];
    }

    if (
      upper.startsWith('UPDATE SERVICE_ENROLLMENTS') ||
      upper.startsWith('UPDATE `SERVICE_ENROLLMENTS`')
    ) {
      const studentId = Number(params[2]);
      const svcType = params[3];
      let affected = 0;
      this.memDb.serviceEnrollments.forEach((se) => {
        if (se.student_id === studentId && se.service_type === svcType && se.status === 'ACTIVE') {
          se.end_date = params[0];
          se.status = 'COMPLETED';
          se.notes = `${se.notes || ''} [Completed: ${params[1]}]`.trim();
          se.updated_at = new Date().toISOString();
          affected++;
        }
      });
      return [{ affectedRows: affected }, []];
    }

    // 10. Fee Concessions queries
    if (upper.includes('FROM FEE_CONCESSIONS') || upper.includes('FROM `FEE_CONCESSIONS`')) {
      const studentId = parseInt(params[0], 10);
      const list = this.memDb.concessions
        .filter((c) => c.student_id === studentId)
        .map((c) => {
          const user = this.memDb.users.find((u) => u.id === c.authorized_by);
          return {
            ...c,
            authorizer_name: user?.full_name || 'Authorized Officer',
          };
        });
      return [list, []];
    }

    if (
      upper.startsWith('INSERT INTO FEE_CONCESSIONS') ||
      upper.startsWith('INSERT INTO `FEE_CONCESSIONS`')
    ) {
      const id = this.memDb.generateId('concessions');
      this.memDb.concessions.push({
        id,
        student_id: params[0],
        assessment_id: params[1],
        fee_component: params[2],
        concession_type: params[3],
        value: parseFloat(params[4]),
        calculated_reduction: parseFloat(params[5]),
        reason: params[6],
        authorized_by: params[7],
        created_at: new Date().toISOString(),
      });
      return [{ insertId: id, affectedRows: 1 }, []];
    }

    // 11. Receipts queries (before payments when primary FROM is fee_receipts)
    if (upper.includes('FROM FEE_RECEIPTS') || upper.includes('FROM `FEE_RECEIPTS`')) {
      if (upper.includes('WHERE FR.ID = ?') || upper.includes('WHERE ID = ?')) {
        const receiptId = parseInt(params[0], 10);
        const r = this.memDb.receipts.find((item) => item.id === receiptId);
        if (!r) return [[], []];
        const p = this.memDb.payments.find((pay) => pay.id === r.payment_id);
        const s = this.memDb.students.find((st) => st.id === r.student_id);
        const a = p ? this.memDb.assessments.find((as) => as.id === p.assessment_id) : null;
        const requester = this.memDb.users.find((u) => u.id === r.requested_by);
        const reviewer = r.reviewed_by ? this.memDb.users.find((u) => u.id === r.reviewed_by) : null;
        const reviewerRole = reviewer ? this.memDb.roles.find((rl) => rl.id === reviewer.role_id) : null;
        return [
          [
            {
              ...r,
              payment_reference: p?.payment_reference,
              paid_amount: p?.amount || r.amount,
              payment_method: p?.payment_method,
              payment_destination: p?.destination,
              student_tx_ref: p?.student_tx_ref,
              passbook_tx_ref: p?.passbook_tx_ref,
              bank_name: p?.bank_name,
              payment_date: p?.payment_date,
              student_id_number: s?.student_id_number,
              student_name: s?.full_name,
              admission_category: s?.admission_category,
              admission_year: s?.admission_year,
              current_year_of_study: s?.current_year_of_study,
              assessed_college_fee: a?.assessed_college_fee || 0,
              assessed_development_fee: a?.assessed_development_fee || 0,
              assessed_mess_fee: a?.assessed_mess_fee || 0,
              assessed_hostel_fee: a?.assessed_hostel_fee || 0,
              total_assessed_fee: a?.total_assessed_fee || 0,
              concession_total: a?.concession_total || 0,
              revised_payable: a?.revised_payable || 0,
              is_kea_exception_applied: a?.is_kea_exception_applied || false,
              kea_exception_reason: a?.kea_exception_reason || null,
              requested_by_name: requester?.full_name || 'Accounts Staff',
              reviewed_by_name: reviewer?.full_name || null,
              reviewed_by_role: reviewerRole?.name || null,
            },
          ],
          [],
        ];
      }
      if (upper.includes('WHERE PAYMENT_ID = ?') || upper.includes('WHERE FR.PAYMENT_ID = ?')) {
        const paymentId = parseInt(params[0], 10);
        const r = this.memDb.receipts.find((item) => item.payment_id === paymentId);
        return [r ? [r] : [], []];
      }
      return [this.memDb.receipts, []];
    }

    if (upper.startsWith('INSERT INTO FEE_RECEIPTS') || upper.startsWith('INSERT INTO `FEE_RECEIPTS`')) {
      const id = this.memDb.generateId('receipts');
      this.memDb.receipts.push({
        id,
        payment_id: params[0],
        student_id: params[1],
        receipt_number: params[2],
        receipt_type: params[3] || 'FINAL_COLLEGE_RECEIPT',
        destination: params[4] || 'COLLEGE_ACCOUNT',
        amount: parseFloat(params[5] || 0),
        requested_by: params[6],
        status: 'APPROVED',
        reviewed_by: params[7] || null,
        reviewed_at: new Date().toISOString(),
        rejection_reason: null,
        issued_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });
      return [{ insertId: id, affectedRows: 1 }, []];
    }

    if (upper.startsWith('UPDATE FEE_RECEIPTS') || upper.startsWith('UPDATE `FEE_RECEIPTS`')) {
      const paymentId = Number(params[params.length - 1]);
      const r = this.memDb.receipts.find((item) => item.payment_id === paymentId || item.id === paymentId);
      if (r) {
        if (upper.includes("RECEIPT_TYPE = 'FINAL_COLLEGE_RECEIPT'")) {
          r.receipt_number = params[0];
          r.receipt_type = 'FINAL_COLLEGE_RECEIPT';
          r.status = 'APPROVED';
          r.reviewed_by = params[1];
          r.reviewed_at = new Date().toISOString();
        } else if (upper.includes("STATUS = 'REJECTED'")) {
          r.status = 'REJECTED';
          r.rejection_reason = params[0];
          if (params.length > 2) r.reviewed_by = params[1];
          r.reviewed_at = new Date().toISOString();
        }
        return [{ affectedRows: 1 }, []];
      }
      return [{ affectedRows: 0 }, []];
    }

    // 12. Payments queries
    if (upper.includes('FROM FEE_PAYMENTS') || upper.includes('FROM `FEE_PAYMENTS`')) {
      if (upper.includes("STATUS = 'PENDING_VERIFICATION'") && upper.includes('COUNT(*) AS PENDING_COUNT')) {
        const list = this.memDb.payments.filter((p) => p.status === 'PENDING_VERIFICATION');
        const total = list.reduce((sum, p) => sum + p.amount, 0);
        return [[{ total_pending: total, pending_count: list.length }], []];
      }
      if (upper.includes('SUM(AMOUNT)')) {
        const verifiedOnly = upper.includes("STATUS = 'VERIFIED'") || upper.includes("STATUS = 'RECORDED'");
        let list = this.memDb.payments.filter((p) => (verifiedOnly ? p.status === 'VERIFIED' : true));
        if (upper.includes('WHERE STUDENT_ID = ?') || upper.includes('WHERE FP.STUDENT_ID = ?')) {
          const studentId = parseInt(params[0], 10);
          list = list.filter((p) => p.student_id === studentId);
        }
        const total = list.reduce((sum, p) => sum + p.amount, 0);
        return [[{ total_collected: total, total_paid: total }], []];
      }
      if (upper.includes('WHERE STUDENT_ID = ?') || upper.includes('WHERE FP.STUDENT_ID = ?')) {
        const studentId = parseInt(params[0], 10);
        const list = this.memDb.payments
          .filter((p) => p.student_id === studentId)
          .map((p) => {
            const recorder = this.memDb.users.find((u) => u.id === p.recorded_by);
            const verifier = p.verified_by ? this.memDb.users.find((u) => u.id === p.verified_by) : null;
            const reverser = p.reversed_by ? this.memDb.users.find((u) => u.id === p.reversed_by) : null;
            const receipt = this.memDb.receipts.find((r) => r.payment_id === p.id);
            return {
              ...p,
              recorder_name: recorder?.full_name || 'Accounts Staff',
              verifier_name: verifier?.full_name || null,
              reverser_name: reverser?.full_name || null,
              receipt_id: receipt?.id || null,
              receipt_number: receipt?.receipt_number || null,
              receipt_type: receipt?.receipt_type || null,
              receipt_status: receipt?.status || null,
            };
          });
        return [list, []];
      }
      if (upper.includes('WHERE ID = ?') || upper.includes('WHERE FP.ID = ?')) {
        const paymentId = parseInt(params[0], 10);
        const p = this.memDb.payments.find((item) => item.id === paymentId);
        return [p ? [p] : [], []];
      }
      if (upper.includes('STUDENT_TX_REF = ?')) {
        const txRef = String(params[0]).trim();
        const existing = this.memDb.payments.filter(
          (p) =>
            p.student_tx_ref &&
            p.student_tx_ref.toLowerCase() === txRef.toLowerCase() &&
            p.status !== 'REVERSED'
        );
        return [existing, []];
      }
      return [
        this.memDb.payments.map((p) => {
          const s = this.memDb.students.find((st) => st.id === p.student_id);
          const recorder = this.memDb.users.find((u) => u.id === p.recorded_by);
          const verifier = p.verified_by ? this.memDb.users.find((u) => u.id === p.verified_by) : null;
          const receipt = this.memDb.receipts.find((r) => r.payment_id === p.id);
          return {
            ...p,
            student_id_number: s?.student_id_number || '',
            student_name: s?.full_name || '',
            admission_category: s?.admission_category || '',
            recorder_name: recorder?.full_name || 'Accounts Staff',
            verifier_name: verifier?.full_name || null,
            receipt_number: receipt?.receipt_number || null,
            receipt_type: receipt?.receipt_type || null,
          };
        }),
        [],
      ];
    }

    if (upper.startsWith('INSERT INTO FEE_PAYMENTS') || upper.startsWith('INSERT INTO `FEE_PAYMENTS`')) {
      const id = this.memDb.generateId('payments');
      this.memDb.payments.push({
        id,
        assessment_id: params[0],
        student_id: params[1],
        payment_reference: params[2],
        amount: parseFloat(params[3]),
        destination: params[4] || 'COLLEGE_ACCOUNT',
        payment_method: params[5] || 'CASH',
        bank_transaction_ref: params[6] || null,
        student_tx_ref: params[7] || null,
        passbook_tx_ref: null,
        bank_name: params[8] || null,
        payment_date: params[9],
        recorded_by: params[10],
        notes: params[11] || null,
        status: params[12] || 'VERIFIED',
        verified_by: params[13] || null,
        verified_at: params[14] || null,
        rejection_reason: null,
        reversal_reason: null,
        reversed_by: null,
        reversed_at: null,
        created_at: new Date().toISOString(),
      });
      return [{ insertId: id, affectedRows: 1 }, []];
    }

    if (upper.startsWith('UPDATE FEE_PAYMENTS') || upper.startsWith('UPDATE `FEE_PAYMENTS`')) {
      const paymentId = params[params.length - 1];
      const p = this.memDb.payments.find((item) => item.id === paymentId);
      if (p) {
        if (upper.includes("STATUS = 'VERIFIED'") || upper.includes('PASSBOOK_TX_REF = ?')) {
          p.status = 'VERIFIED';
          p.passbook_tx_ref = params[0];
          p.verified_by = params[1];
          p.verified_at = new Date().toISOString();
        } else if (upper.includes("STATUS = 'REJECTED'") || upper.includes('REJECTION_REASON = ?')) {
          p.status = 'REJECTED';
          p.rejection_reason = params[0];
          p.verified_by = params[1];
          p.verified_at = new Date().toISOString();
        } else if (upper.includes("STATUS = 'REVERSED'") || upper.includes('REVERSAL_REASON = ?')) {
          p.status = 'REVERSED';
          p.reversal_reason = params[0];
          p.reversed_by = params[1];
          p.reversed_at = new Date().toISOString();
        }
        return [{ affectedRows: 1 }, []];
      }
      return [{ affectedRows: 0 }, []];
    }

    return [[], []];
  }
}
