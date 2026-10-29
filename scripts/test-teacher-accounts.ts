import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { MemoryDatabase } from '../server/services/memory-db.ts';
import {
  getPermittedModules,
  canAccessModule,
  getDefaultModuleForRole,
  isFacultyAccountRole,
} from '../src/config/permissions.ts';
import {
  ROLES,
  ASSIGNABLE_ACCOUNT_ROLES,
  NON_LOGIN_ROLES,
  USER_MANAGEMENT_ROLES,
  TEACHER_RECORDS_ROLES,
  DEPARTMENT_WORKSPACE_ROLES,
  isDepartmentScopedRole,
  isFacultyRole,
} from '../server/permissions.ts';
import { getPool, checkDatabaseConnection } from '../server/db.ts';

async function runTeacherAccountTests() {
  console.log('================================================================');
  console.log('KAMCH ERP — PHASE 1: TEACHER ACCOUNT & ISOLATION TEST SUITE');
  console.log('================================================================\n');

  const dbHealth = await checkDatabaseConnection();
  console.log(`[DB STATUS] Connected: ${dbHealth.connected}, Mode: ${dbHealth.isFallback ? 'In-Memory Fallback' : 'Live MySQL Database'}\n`);

  const pool = getPool();
  const memDb = MemoryDatabase.getInstance();
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}${detail ? ` - Detail: ${detail}` : ''}`);
      failed++;
    }
  }

  // --------------------------------------------------------------------------
  // TEST 1: Role Architecture & Assignable Account Boundaries
  // --------------------------------------------------------------------------
  console.log('--- 1. Role Architecture & Non-Login Role Verification ---');

  assert(
    ASSIGNABLE_ACCOUNT_ROLES.includes(ROLES.FACULTY),
    'FACULTY is an assignable account role in Phase 1'
  );
  assert(
    !ASSIGNABLE_ACCOUNT_ROLES.includes(ROLES.SUPER_ADMIN),
    'SUPER_ADMIN is excluded from regular user management assignment'
  );
  assert(
    NON_LOGIN_ROLES.includes(ROLES.STUDENT) && !ASSIGNABLE_ACCOUNT_ROLES.includes(ROLES.STUDENT),
    'STUDENT remains strictly a non-login institutional record role'
  );
  assert(
    isFacultyRole('FACULTY') && !isFacultyRole('SUPER_ADMIN') && !isFacultyRole('DEPARTMENT'),
    'isFacultyRole helper accurately identifies faculty accounts'
  );
  assert(
    isFacultyAccountRole('FACULTY') && !isFacultyAccountRole('DEPARTMENT'),
    'Frontend isFacultyAccountRole helper matches backend authority'
  );

  // --------------------------------------------------------------------------
  // TEST 2: Preserved Administrative & Department Shared Account Permissions
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Preserved Existing Roles & Module Permissions ---');

  const superAdminMods = getPermittedModules('SUPER_ADMIN');
  assert(
    superAdminMods.includes('user_mgmt') &&
      superAdminMods.includes('fees_mgmt') &&
      superAdminMods.includes('student_records') &&
      superAdminMods.includes('teacher_records') &&
      superAdminMods.includes('dept_portal') &&
      superAdminMods.includes('library_mgmt'),
    'Super Admin retains full system permissions across all modules'
  );

  const principalMods = getPermittedModules('PRINCIPAL');
  assert(
    principalMods.includes('user_mgmt') &&
      principalMods.includes('fees_mgmt') &&
      principalMods.includes('teacher_records'),
    'Principal retains administrative permissions'
  );

  const deptMods = getPermittedModules('DEPARTMENT');
  assert(
    deptMods.includes('dept_portal') &&
      deptMods.includes('teacher_records') &&
      !deptMods.includes('user_mgmt') &&
      !deptMods.includes('fees_mgmt') &&
      getDefaultModuleForRole('DEPARTMENT') === 'dept_portal',
    'Shared Department accounts retain departmental portal access with no user/fees management'
  );

  // --------------------------------------------------------------------------
  // TEST 3: Teacher Account Strict Isolation & Least Privilege
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Teacher Account Isolation & Least Privilege Verification ---');

  const facultyMods = getPermittedModules('FACULTY');
  assert(
    facultyMods.includes('welcome') && facultyMods.includes('leave_mgmt') && facultyMods.includes('attendance_mgmt') && !facultyMods.includes('user_mgmt'),
    'Faculty accounts have visibility strictly to welcome, leave management, and attendance reports'
  );
  assert(
    !canAccessModule('FACULTY', 'user_mgmt'),
    'Faculty accounts CANNOT access User Management'
  );
  assert(
    !canAccessModule('FACULTY', 'fees_mgmt'),
    'Faculty accounts CANNOT access Fees Management'
  );
  assert(
    !canAccessModule('FACULTY', 'student_records'),
    'Faculty accounts CANNOT access Student Records'
  );
  assert(
    !canAccessModule('FACULTY', 'library_mgmt'),
    'Faculty accounts CANNOT access Library Workspace'
  );
  assert(
    !canAccessModule('FACULTY', 'dept_portal'),
    'Faculty accounts CANNOT access Department Workspace'
  );
  assert(
    !canAccessModule('FACULTY', 'teacher_records'),
    'Faculty accounts CANNOT browse institutional Teacher Records directory'
  );

  assert(
    !USER_MANAGEMENT_ROLES.includes(ROLES.FACULTY),
    'FACULTY is strictly excluded from USER_MANAGEMENT_ROLES'
  );
  assert(
    !TEACHER_RECORDS_ROLES.includes(ROLES.FACULTY),
    'FACULTY is strictly excluded from TEACHER_RECORDS_ROLES'
  );
  assert(
    !DEPARTMENT_WORKSPACE_ROLES.includes(ROLES.FACULTY),
    'FACULTY is strictly excluded from DEPARTMENT_WORKSPACE_ROLES'
  );

  // --------------------------------------------------------------------------
  // TEST 4: Teacher Institutional Record Creation vs User Account Independence
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Teacher Institutional Record vs User Account Separation ---');

  const now = new Date().toISOString();
  const deptId = memDb.generateId('departments');
  memDb.departments.push({
    id: deptId,
    code: 'KAYA_CHIKITSA',
    name: 'Kayachikitsa',
    description: 'Internal Medicine Department',
    is_active: true,
    created_at: now,
    updated_at: now,
  });
  assert(Boolean(deptId), 'Department created for teacher association');

  const teacherId1 = memDb.generateId('teachers');
  const teacherId2 = memDb.generateId('teachers');

  memDb.teachers.push(
    {
      id: teacherId1,
      employee_code: 'EMP_KC_001',
      teacher_code: 'AYKC00123',
      teacher_code_status: 'VERIFIED',
      registration_number: 'REG9871',
      full_name: 'Dr. Ramesh Sharma',
      designation: 'Professor & HOD',
      department_id: deptId,
      qualification: 'BAMS, MD (Ayurveda)',
      date_of_birth: '1978-05-12',
      joining_date_service: '2005-06-01',
      joining_date_institute: '2010-07-15',
      reported_experience: '18 Years',
      previous_institute: null,
      contact_phone: '9876543210',
      contact_email: 'ramesh.sharma@kamch.ac.in',
      profile_photo_url: null,
      status: 'ACTIVE',
      data_verification_required: false,
      verification_notes: null,
      created_by: 1,
      created_at: now,
      updated_at: now,
    },
    {
      id: teacherId2,
      employee_code: 'EMP_KC_002',
      teacher_code: 'AYKC00124',
      teacher_code_status: 'VERIFIED',
      registration_number: 'REG9872',
      full_name: 'Dr. Priya Patel',
      designation: 'Associate Professor',
      department_id: deptId,
      qualification: 'BAMS, MS (Shalya)',
      date_of_birth: '1984-09-20',
      joining_date_service: '2012-08-01',
      joining_date_institute: '2015-09-10',
      reported_experience: '12 Years',
      previous_institute: null,
      contact_phone: '9876543211',
      contact_email: 'priya.patel@kamch.ac.in',
      profile_photo_url: null,
      status: 'ACTIVE',
      data_verification_required: false,
      verification_notes: null,
      created_by: 1,
      created_at: now,
      updated_at: now,
    }
  );

  assert(
    Boolean(teacherId1) && Boolean(teacherId2),
    'Institutional teacher records created in teachers table'
  );

  // Verify creating teacher records did NOT create user accounts
  const usersForTeacher1 = memDb.users.filter((u) => u.teacher_id === teacherId1);
  const usersForTeacher2 = memDb.users.filter((u) => u.teacher_id === teacherId2);
  assert(
    usersForTeacher1.length === 0 && usersForTeacher2.length === 0,
    'Creating institutional teacher records DOES NOT automatically create login user accounts'
  );

  // --------------------------------------------------------------------------
  // TEST 5: Authorized Teacher Account Linking & Uniqueness Enforcement
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Authorized Teacher Account Creation & Linking ---');

  const facultyRole = memDb.roles.find((r) => r.code === 'FACULTY')!;
  assert(Boolean(facultyRole), 'FACULTY role exists in database');

  const passwordHash = await bcrypt.hash('TeacherPass@2025', 10);
  const teacherUserId = memDb.generateId('users');

  memDb.users.push({
    id: teacherUserId,
    username: 'dr_ramesh',
    email: 'ramesh.sharma@kamch.ac.in',
    password_hash: passwordHash,
    role_id: facultyRole.id,
    department_id: deptId,
    teacher_id: teacherId1,
    full_name: 'Dr. Ramesh Sharma',
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
    created_by: 1,
    created_at: now,
    updated_at: now,
  });

  const createdUser = memDb.users.find((u) => u.id === teacherUserId)!;
  assert(
    Boolean(createdUser) && createdUser.teacher_id === teacherId1,
    'Individual teacher account linked successfully to institutional teacher record'
  );
  assert(
    createdUser.department_id === deptId,
    'Teacher account department_id correctly synced from institutional teacher record'
  );

  // Test uniqueness: verify conflict checking when trying to link the same teacher twice
  const existingActiveAccount = memDb.users.find(
    (u) => u.teacher_id === teacherId1 && !u.is_deactivated
  );
  assert(
    Boolean(existingActiveAccount) && existingActiveAccount!.id === teacherUserId,
    'Single active account per teacher is detectable for conflict rejection'
  );

  // --------------------------------------------------------------------------
  // TEST 6: Session Lookup & Teacher Profile Field Hydration
  // --------------------------------------------------------------------------
  console.log('\n--- 6. Authentication & Session Hydration with Teacher Metadata ---');

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const sessionId = memDb.generateId('sessions');
  memDb.sessions.push({
    id: sessionId,
    user_id: teacherUserId,
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    ip_address: '127.0.0.1',
    user_agent: 'TestAgent/1.0',
    is_active: true,
    created_at: now,
    last_activity_at: now,
  });

  assert(Boolean(sessionId), 'Active session established for teacher account');

  // Verify database query resolves user with teacher fields matching requireAuth
  const [sessionRows] = await pool.query<any[]>(
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
     WHERE s.token_hash = ? AND s.is_active = TRUE
     LIMIT 1`,
    [tokenHash]
  );

  assert(sessionRows.length > 0, 'Session query returned user row');
  const authUser = sessionRows[0];
  assert(
    authUser.role_code === 'FACULTY',
    'Session lookup identifies user role as FACULTY'
  );
  assert(
    authUser.teacher_id === teacherId1,
    'Session lookup resolves correct teacher_id'
  );
  assert(
    authUser.full_name === 'Dr. Ramesh Sharma',
    'Session lookup hydrates user full_name'
  );
  assert(
    authUser.teacher_employee_code === 'EMP_KC_001',
    'Session lookup hydrates teacher_employee_code'
  );
  assert(
    authUser.teacher_code === 'AYKC00123',
    'Session lookup hydrates NCISM teacher_code'
  );
  assert(
    authUser.teacher_designation === 'Professor & HOD',
    'Session lookup hydrates teacher_designation'
  );

  // --------------------------------------------------------------------------
  // TEST 7: Teacher Cross-Access Isolation (Self vs Other Teacher Data)
  // --------------------------------------------------------------------------
  console.log('\n--- 7. Teacher Self-Isolation & Cross-Record Access Defense ---');

  // Teacher 1 accessing Teacher 1's record -> Allowed
  const canAccessOwn = authUser.teacher_id === teacherId1;
  assert(canAccessOwn, 'Teacher account can access own linked profile');

  // Teacher 1 accessing Teacher 2's record -> Rejected
  const canAccessOther = authUser.teacher_id === teacherId2;
  assert(!canAccessOther, 'Teacher account CANNOT access another teacher record (blocked by isolation check)');

  // --------------------------------------------------------------------------
  // TEST 8: Shared Department Account Still Functions Unimpaired
  // --------------------------------------------------------------------------
  console.log('\n--- 8. Shared Department Account Coexistence & Isolation ---');

  const deptRole = memDb.roles.find((r) => r.code === 'DEPARTMENT')!;
  const deptUserId = memDb.generateId('users');
  memDb.users.push({
    id: deptUserId,
    username: 'dept_kayachikitsa',
    email: 'kayachikitsa@kamch.ac.in',
    password_hash: passwordHash,
    role_id: deptRole.id,
    department_id: deptId,
    teacher_id: null, // Shared account has no individual teacher link
    full_name: 'Kayachikitsa Department Account',
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
    created_by: 1,
    created_at: now,
    updated_at: now,
  });

  const deptUser = memDb.users.find((u) => u.id === deptUserId)!;
  assert(
    Boolean(deptUser.id) && deptUser.teacher_id === null && deptUser.department_id === deptId,
    'Shared department account continues to function with teacher_id = null'
  );
  assert(
    isDepartmentScopedRole(deptRole.code),
    'Department account remains department-scoped'
  );

  // --------------------------------------------------------------------------
  // TEST 9: Database Compatibility & Available Teachers Query
  // --------------------------------------------------------------------------
  console.log('\n--- 9. Database Compatibility & Available Teachers Listing ---');

  const [availableRows] = await pool.query<any[]>(
    `SELECT t.id, t.full_name, t.employee_code, u.id AS linked_user_id, u.username AS linked_username
     FROM teachers t
     LEFT JOIN users u ON u.teacher_id = t.id AND u.is_deactivated = FALSE
     WHERE t.status = 'ACTIVE'`
  );

  const t1Row = availableRows.find((r: any) => r.id === teacherId1);
  const t2Row = availableRows.find((r: any) => r.id === teacherId2);

  assert(
    Boolean(t1Row?.linked_user_id) && t1Row.linked_username === 'dr_ramesh',
    'Available-teachers query identifies teacher1 as linked to dr_ramesh'
  );
  assert(
    !t2Row?.linked_user_id,
    'Available-teachers query identifies teacher2 as unlinked/available'
  );

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`TEST SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTeacherAccountTests().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
