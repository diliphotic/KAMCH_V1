import crypto from 'crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import { checkDatabaseConnection } from '../server/db.ts';
import { authRouter } from '../server/routes/auth.routes.ts';
import { userRouter } from '../server/routes/user.routes.ts';
import { feesRouter } from '../server/routes/fees.routes.ts';
import { recordsRouter } from '../server/routes/records.routes.ts';
import { requireAuth, requirePasswordChangeClear, requireRoles } from '../server/middleware/auth.ts';
import { FEES_AND_STUDENTS_ROLES } from '../server/permissions.ts';
import { MemoryDatabase } from '../server/services/memory-db.ts';

function genSecret(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}!9`;
}

function extractCookies(res: Response): { session: string; csrf: string } {
  const getSetCookie = (res.headers as any).getSetCookie;
  const rawList: string[] = typeof getSetCookie === 'function'
    ? getSetCookie.call(res.headers)
    : (res.headers.get('set-cookie') || '').split(/,(?=\s*kamch_)/);

  let session = '';
  let csrf = '';
  for (const item of rawList) {
    const pair = item.split(';')[0].trim();
    if (pair.startsWith('kamch_session=')) session = pair;
    if (pair.startsWith('kamch_csrf=')) csrf = pair.replace('kamch_csrf=', '');
  }
  return { session, csrf };
}

function makeHeaders(sessionCookie: string, csrfToken: string) {
  return {
    'Content-Type': 'application/json',
    Cookie: `${sessionCookie}; kamch_csrf=${csrfToken}`,
    'X-CSRF-Token': csrfToken,
  };
}

async function runApiIntegrationTests() {
  console.log('====================================================');
  console.log('KAMCH ERP — FULL API SECURITY & INTEGRATION SUITE');
  console.log('====================================================\n');

  await checkDatabaseConnection();

  const memDb = MemoryDatabase.getInstance();
  const initialAdminTempPwd = genSecret('InitSA');
  const superAdminPermPwd = genSecret('PermSA');

  // Provision initial Super Admin using ephemeral runtime password (no hardcoded credentials)
  memDb.provisionInitialSuperAdmin({
    username: 'superadmin',
    email: 'admin@kamch.ac.in',
    password: initialAdminTempPwd,
    mustChangePassword: true,
  });

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  app.use('/api/users', userRouter);
  app.use(
    '/api/fees',
    requireAuth,
    requirePasswordChangeClear,
    requireRoles(...FEES_AND_STUDENTS_ROLES),
    feesRouter
  );
  app.use('/api', recordsRouter);

  const server = app.listen(0);
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

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

  try {
    // =========================================================================
    // 1. First-Login Password Requirement on Initial Super Admin
    // =========================================================================
    console.log('--- 1. Initial Login & Mandatory First-Login Password Change ---');
    const saFirstLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernameOrEmail: 'superadmin', password: initialAdminTempPwd }),
    });
    const saFirstCookies = extractCookies(saFirstLogin);
    const saFirstData = await saFirstLogin.json();
    assert(saFirstLogin.status === 200, 'Super Admin initial login succeeds');
    assert(saFirstData.user?.mustChangePassword === true, 'Initial Super Admin requires password change');

    let saHeaders = makeHeaders(saFirstCookies.session, saFirstData.csrfToken);

    const blockedBeforePwdChange = await fetch(`${baseUrl}/api/users`, { headers: saHeaders });
    const blockedBeforeData = await blockedBeforePwdChange.json();
    assert(
      blockedBeforePwdChange.status === 403 && blockedBeforeData.code === 'PASSWORD_CHANGE_REQUIRED',
      'Protected API /api/users is blocked before mandatory password change'
    );

    const saPwdChange = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        currentPassword: initialAdminTempPwd,
        newPassword: superAdminPermPwd,
      }),
    });
    assert(saPwdChange.status === 200, 'Mandatory password change succeeds and clears flag');

    // Verify email login also works for Super Admin
    const saEmailLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernameOrEmail: 'admin@kamch.ac.in', password: superAdminPermPwd }),
    });
    const saCookies = extractCookies(saEmailLogin);
    const saData = await saEmailLogin.json();
    assert(saEmailLogin.status === 200 && saData.user?.mustChangePassword === false, 'Login via registered email succeeds');

    // Verify previous session (saFirstCookies) was invalidated by single-session policy
    const oldSessionCheck = await fetch(`${baseUrl}/api/auth/me`, { headers: saHeaders });
    assert(oldSessionCheck.status === 401, 'Previous session is invalidated after new login on another browser/device');

    saHeaders = makeHeaders(saCookies.session, saData.csrfToken);

    // =========================================================================
    // 2. Roles Lookup, Department Creation & Account Creation Rules
    // =========================================================================
    console.log('\n--- 2. Departments & Account Creation across Roles ---');
    const rolesRes = await fetch(`${baseUrl}/api/users/roles`, { headers: saHeaders });
    const rolesData = await rolesRes.json();
    const roleMap = new Map<string, number>();
    for (const r of rolesData.assignableRoles) {
      roleMap.set(r.code, r.id);
    }
    assert(
      !roleMap.has('STUDENT') && !roleMap.has('FACULTY') && !roleMap.has('SUPER_ADMIN'),
      'Assignable roles exclude STUDENT, FACULTY, and SUPER_ADMIN'
    );

    // Super Admin creates two departments
    const dept1Res = await fetch(`${baseUrl}/api/users/departments`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({ code: 'KAYACHIKITSA', name: 'Kayachikitsa', description: 'Internal Medicine' }),
    });
    const dept1Data = await dept1Res.json();
    const dept1Id = dept1Data.department?.id;
    assert(dept1Res.status === 201 && Boolean(dept1Id), 'Super Admin creates Department #1 (Kayachikitsa)');

    const dept2Res = await fetch(`${baseUrl}/api/users/departments`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({ code: 'SHALYA', name: 'Shalya Tantra', description: 'Surgery' }),
    });
    const dept2Data = await dept2Res.json();
    const dept2Id = dept2Data.department?.id;
    assert(dept2Res.status === 201 && Boolean(dept2Id), 'Super Admin creates Department #2 (Shalya Tantra)');

    // Reject creating STUDENT or FACULTY login accounts
    const studentRoleRow = memDb.roles.find((r) => r.code === 'STUDENT')!;
    const facultyRoleRow = memDb.roles.find((r) => r.code === 'FACULTY')!;
    const superAdminRoleRow = memDb.roles.find((r) => r.code === 'SUPER_ADMIN')!;

    const studentAccAttempt = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        username: 'student_login_try',
        fullName: 'Student Test',
        roleId: studentRoleRow.id,
        initialPassword: genSecret('Stu'),
        confirmPassword: 'mismatch_ignored_after',
      }),
    });
    assert(studentAccAttempt.status === 400, 'Rejects Student login account creation');

    const pwdFac = genSecret('Fac');
    const facultyAccAttempt = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        username: 'faculty_login_try',
        fullName: 'Faculty Test',
        roleId: facultyRoleRow.id,
        initialPassword: pwdFac,
        confirmPassword: pwdFac,
      }),
    });
    const facErr = await facultyAccAttempt.json();
    assert(
      facultyAccAttempt.status === 400 && facErr.code === 'ROLE_LOGIN_DISABLED',
      'Rejects Faculty login account creation with ROLE_LOGIN_DISABLED'
    );

    const pwdSa2 = genSecret('SA2');
    const secondSaAttempt = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        username: 'second_superadmin',
        fullName: 'Second Admin',
        roleId: superAdminRoleRow.id,
        initialPassword: pwdSa2,
        confirmPassword: pwdSa2,
      }),
    });
    assert(secondSaAttempt.status === 403, 'Blocks creating a second Super Admin through User Management');

    // Super Admin creates Principal, Secretary, Library, and Department #1 shared account (with optional blank email!)
    const principalTempPwd = genSecret('PrinTemp');
    const principalPermPwd = genSecret('PrinPerm');
    const createPrincipal = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        username: 'principal_user',
        email: 'principal@kamch.ac.in',
        fullName: 'College Principal',
        roleId: roleMap.get('PRINCIPAL'),
        initialPassword: principalTempPwd,
        confirmPassword: principalTempPwd,
      }),
    });
    assert(createPrincipal.status === 201, 'Super Admin creates Principal account');

    // Duplicate username & duplicate email checks
    const dupUserRes = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        username: 'principal_user',
        email: 'unique@kamch.ac.in',
        fullName: 'Dup User',
        roleId: roleMap.get('OFFICE'),
        initialPassword: principalTempPwd,
        confirmPassword: principalTempPwd,
      }),
    });
    assert(dupUserRes.status === 409, 'Duplicate username is rejected with HTTP 409');

    const dupEmailRes = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        username: 'unique_user',
        email: 'principal@kamch.ac.in',
        fullName: 'Dup Email',
        roleId: roleMap.get('OFFICE'),
        initialPassword: principalTempPwd,
        confirmPassword: principalTempPwd,
      }),
    });
    assert(dupEmailRes.status === 409, 'Duplicate email identifier is rejected with HTTP 409');

    const secretaryTempPwd = genSecret('SecTemp');
    const secretaryPermPwd = genSecret('SecPerm');
    const createSecretary = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        username: 'secretary_user',
        email: 'secretary@kamch.ac.in',
        fullName: 'College Secretary',
        roleId: roleMap.get('SECRETARY'),
        initialPassword: secretaryTempPwd,
        confirmPassword: secretaryTempPwd,
      }),
    });
    assert(createSecretary.status === 201, 'Super Admin creates Secretary account');

    // Create Department #1 shared account WITHOUT email (optional email test)
    const dept1TempPwd = genSecret('Dept1Temp');
    const dept1PermPwd = genSecret('Dept1Perm');
    const createDept1Acc = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        username: 'dept_kaya',
        email: '',
        fullName: 'Kayachikitsa Shared Account',
        roleId: roleMap.get('DEPARTMENT'),
        departmentId: dept1Id,
        initialPassword: dept1TempPwd,
        confirmPassword: dept1TempPwd,
      }),
    });
    assert(createDept1Acc.status === 201, 'Super Admin assigns shared Department account without requiring email');

    // Enforce 1 active account per department
    const dupDeptAcc = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        username: 'dept_kaya_second',
        fullName: 'Duplicate Dept Account',
        roleId: roleMap.get('DEPARTMENT'),
        departmentId: dept1Id,
        initialPassword: dept1TempPwd,
        confirmPassword: dept1TempPwd,
      }),
    });
    assert(dupDeptAcc.status === 409, 'Rejects assigning a second active account to the same department (HTTP 409)');

    // =========================================================================
    // 3. Principal & Secretary Capabilities + Super Admin Invisibility/Protection
    // =========================================================================
    console.log('\n--- 3. Principal & Secretary Permissions and Super Admin Protection ---');
    // Activate Principal (login + mandatory password change)
    const pLogin1 = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernameOrEmail: 'principal_user', password: principalTempPwd }),
    });
    const pC1 = extractCookies(pLogin1);
    const pD1 = await pLogin1.json();
    let principalHeaders = makeHeaders(pC1.session, pD1.csrfToken);
    await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: principalHeaders,
      body: JSON.stringify({ currentPassword: principalTempPwd, newPassword: principalPermPwd }),
    });

    // Principal creates an Office account
    const officeTempPwd = genSecret('OffTemp');
    const officePermPwd = genSecret('OffPerm');
    const pCreateOffice = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: principalHeaders,
      body: JSON.stringify({
        username: 'office_member',
        email: 'office@kamch.ac.in',
        fullName: 'Accounts Office Clerk',
        roleId: roleMap.get('OFFICE'),
        initialPassword: officeTempPwd,
        confirmPassword: officeTempPwd,
      }),
    });
    const officeAccData = await pCreateOffice.json();
    const officeUserId = officeAccData.user?.id;
    assert(pCreateOffice.status === 201, 'Principal creates allowed Office account');

    // Activate Secretary & create Library account
    const sLogin1 = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernameOrEmail: 'secretary_user', password: secretaryTempPwd }),
    });
    const sC1 = extractCookies(sLogin1);
    const sD1 = await sLogin1.json();
    let secretaryHeaders = makeHeaders(sC1.session, sD1.csrfToken);
    await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: secretaryHeaders,
      body: JSON.stringify({ currentPassword: secretaryTempPwd, newPassword: secretaryPermPwd }),
    });

    const libTempPwd = genSecret('LibTemp');
    const libPermPwd = genSecret('LibPerm');
    const sCreateLib = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: secretaryHeaders,
      body: JSON.stringify({
        username: 'library_staff',
        fullName: 'Central Librarian',
        roleId: roleMap.get('LIBRARY'),
        initialPassword: libTempPwd,
        confirmPassword: libTempPwd,
      }),
    });
    assert(sCreateLib.status === 201, 'Secretary creates allowed Library account');

    // Super Admin invisibility to Principal and Secretary
    const saList = await (await fetch(`${baseUrl}/api/users`, { headers: saHeaders })).json();
    const pList = await (await fetch(`${baseUrl}/api/users`, { headers: principalHeaders })).json();
    const sList = await (await fetch(`${baseUrl}/api/users`, { headers: secretaryHeaders })).json();

    assert(saList.users.some((u: any) => u.role === 'SUPER_ADMIN'), 'Super Admin sees Super Admin in directory');
    assert(!pList.users.some((u: any) => u.role === 'SUPER_ADMIN'), 'Principal NEVER sees Super Admin in directory');
    assert(!sList.users.some((u: any) => u.role === 'SUPER_ADMIN'), 'Secretary NEVER sees Super Admin in directory');

    // Direct API manipulation attempts against Super Admin (ID 1) by Principal & Secretary
    for (const [label, hdrs] of [['Principal', principalHeaders], ['Secretary', secretaryHeaders]] as const) {
      const getSa = await fetch(`${baseUrl}/api/users/1`, { headers: hdrs });
      const putSa = await fetch(`${baseUrl}/api/users/1`, {
        method: 'PUT',
        headers: hdrs,
        body: JSON.stringify({ fullName: 'Hacked', roleId: roleMap.get('OFFICE') }),
      });
      const suspSa = await fetch(`${baseUrl}/api/users/1/suspend`, { method: 'PATCH', headers: hdrs });
      const deactSa = await fetch(`${baseUrl}/api/users/1/deactivate`, { method: 'PATCH', headers: hdrs });
      const rstSa = await fetch(`${baseUrl}/api/users/1/reset-password`, {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({ temporaryPassword: 'NewPassword123', confirmPassword: 'NewPassword123' }),
      });
      assert(
        getSa.status === 403 &&
          putSa.status === 403 &&
          suspSa.status === 403 &&
          deactSa.status === 403 &&
          rstSa.status === 403,
        `${label} cannot view, edit, suspend, deactivate, or reset Super Admin by direct ID`
      );
    }

    // Self-role-elevation / self-role-change prevention
    const principalSelfId = pD1.user.id;
    const selfRoleChange = await fetch(`${baseUrl}/api/users/${principalSelfId}`, {
      method: 'PUT',
      headers: principalHeaders,
      body: JSON.stringify({ fullName: 'College Principal', roleId: roleMap.get('OFFICE') }),
    });
    assert(selfRoleChange.status === 403, 'Users cannot change their own role');

    // =========================================================================
    // 4. Office, Library, and Department Server-Side Isolation & Record Boundaries
    // =========================================================================
    console.log('\n--- 4. Office, Library & Department Isolation + Student/Teacher Boundaries ---');
    // Activate Office, Library, and Department #1 accounts
    const offLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernameOrEmail: 'office_member', password: officeTempPwd }),
    });
    const offC = extractCookies(offLogin);
    const offD = await offLogin.json();
    let officeHeaders = makeHeaders(offC.session, offD.csrfToken);
    await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({ currentPassword: officeTempPwd, newPassword: officePermPwd }),
    });

    const libLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernameOrEmail: 'library_staff', password: libTempPwd }),
    });
    const libC = extractCookies(libLogin);
    const libD = await libLogin.json();
    const libHeaders = makeHeaders(libC.session, libD.csrfToken);
    await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: libHeaders,
      body: JSON.stringify({ currentPassword: libTempPwd, newPassword: libPermPwd }),
    });

    const deptLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernameOrEmail: 'dept_kaya', password: dept1TempPwd }),
    });
    const deptC = extractCookies(deptLogin);
    const deptD = await deptLogin.json();
    const deptHeaders = makeHeaders(deptC.session, deptD.csrfToken);
    await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: deptHeaders,
      body: JSON.stringify({ currentPassword: dept1TempPwd, newPassword: dept1PermPwd }),
    });

    // Office, Library, Department blocked from User Management
    assert((await fetch(`${baseUrl}/api/users`, { headers: officeHeaders })).status === 403, 'Office blocked from /api/users (403)');
    assert((await fetch(`${baseUrl}/api/users`, { headers: libHeaders })).status === 403, 'Library blocked from /api/users (403)');
    assert((await fetch(`${baseUrl}/api/users`, { headers: deptHeaders })).status === 403, 'Department blocked from /api/users (403)');

    // Library & Department blocked from Fees & Student Records
    assert((await fetch(`${baseUrl}/api/fees/stats`, { headers: libHeaders })).status === 403, 'Library blocked from /api/fees/stats (403)');
    assert((await fetch(`${baseUrl}/api/fees/structures`, { headers: libHeaders })).status === 403, 'Library blocked from /api/fees/structures (403)');
    assert((await fetch(`${baseUrl}/api/students`, { headers: libHeaders })).status === 403, 'Library blocked from /api/students (403)');
    assert((await fetch(`${baseUrl}/api/teachers`, { headers: libHeaders })).status === 403, 'Library blocked from /api/teachers (403)');
    assert((await fetch(`${baseUrl}/api/library/workspace`, { headers: libHeaders })).status === 200, 'Library allowed on /api/library/workspace (200)');

    assert((await fetch(`${baseUrl}/api/fees/stats`, { headers: deptHeaders })).status === 403, 'Department blocked from /api/fees/stats (403)');
    assert((await fetch(`${baseUrl}/api/students`, { headers: deptHeaders })).status === 403, 'Department blocked from /api/students (403)');
    assert((await fetch(`${baseUrl}/api/library/workspace`, { headers: deptHeaders })).status === 403, 'Department blocked from /api/library/workspace (403)');
    assert((await fetch(`${baseUrl}/api/library/workspace`, { headers: officeHeaders })).status === 403, 'Office blocked from /api/library/workspace (403)');

    // Department Isolation on Workspaces & Teacher Records
    const ownDeptWs = await fetch(`${baseUrl}/api/departments/${dept1Id}/workspace`, { headers: deptHeaders });
    const otherDeptWs = await fetch(`${baseUrl}/api/departments/${dept2Id}/workspace`, { headers: deptHeaders });
    assert(ownDeptWs.status === 200, 'Department #1 account accesses its own department workspace');
    assert(otherDeptWs.status === 403, 'Department #1 account is blocked from Department #2 workspace (403)');

    const otherDeptTeachersGet = await fetch(`${baseUrl}/api/teachers?departmentId=${dept2Id}`, { headers: deptHeaders });
    assert(otherDeptTeachersGet.status === 403, 'Department #1 account cannot query Department #2 teachers via parameter tampering');

    const otherDeptTeacherCreate = await fetch(`${baseUrl}/api/teachers`, {
      method: 'POST',
      headers: deptHeaders,
      body: JSON.stringify({
        employeeCode: 'TCH-CROSS',
        fullName: 'Cross Dept Attempt',
        designation: 'Lecturer',
        departmentId: dept2Id,
      }),
    });
    assert(otherDeptTeacherCreate.status === 403, 'Department #1 account cannot add teacher to Department #2');

    // Add Teacher in Dept #1 by Dept #1 account & Teacher in Dept #2 by Office
    const userCountBeforeTeacher = memDb.users.length;
    const dept1TeacherRes = await fetch(`${baseUrl}/api/teachers`, {
      method: 'POST',
      headers: deptHeaders,
      body: JSON.stringify({
        employeeCode: 'TCH-KAYA-01',
        fullName: 'Dr. Meera Kulkarni',
        designation: 'Professor',
        qualification: 'BAMS, MD',
      }),
    });
    assert(dept1TeacherRes.status === 201, 'Department #1 account creates teacher record in its own department');
    assert(memDb.users.length === userCountBeforeTeacher, 'Teacher record creation NEVER creates a login account');

    const dept2TeacherRes = await fetch(`${baseUrl}/api/teachers`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        employeeCode: 'TCH-SHAL-01',
        fullName: 'Dr. Vivek Deshmukh',
        designation: 'Associate Professor',
        departmentId: dept2Id,
      }),
    });
    const dept2TeacherData = await dept2TeacherRes.json();
    assert(dept2TeacherRes.status === 201, 'Office member creates teacher record in Department #2');

    const crossEditAttempt = await fetch(`${baseUrl}/api/teachers/${dept2TeacherData.teacher.id}`, {
      method: 'PUT',
      headers: deptHeaders,
      body: JSON.stringify({ fullName: 'Tampered Name', designation: 'Professor' }),
    });
    assert(crossEditAttempt.status === 403, 'Department #1 account cannot edit Department #2 teacher record');

    // Shared Student Records & Fees Management Regression
    const userCountBeforeStudent = memDb.users.length;
    const addStudentRes = await fetch(`${baseUrl}/api/students`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        studentIdNumber: 'KAMCH/2026/101',
        fullName: 'Aarav Rao',
        admissionCategory: 'GOVERNMENT',
        admissionYear: '2026',
        currentYearOfStudy: '1',
        contactPhone: '9876543210',
      }),
    });
    const addStudentData = await addStudentRes.json();
    const studentId = addStudentData.student?.id;
    assert(addStudentRes.status === 201 && Boolean(studentId), 'Office registers shared student record');
    assert(memDb.users.length === userCountBeforeStudent, 'Student record registration NEVER creates a login account');

    // Office edits student phone, but cannot alter seat category
    const editStudentOk = await fetch(`${baseUrl}/api/students/${studentId}`, {
      method: 'PUT',
      headers: officeHeaders,
      body: JSON.stringify({
        fullName: 'Aarav N. Rao',
        contactPhone: '9876500000',
      }),
    });
    assert(editStudentOk.status === 200, 'Office edits permitted student details');

    const editStudentCatBlocked = await fetch(`${baseUrl}/api/students/${studentId}`, {
      method: 'PUT',
      headers: officeHeaders,
      body: JSON.stringify({
        fullName: 'Aarav N. Rao',
        admissionCategory: 'NRI',
      }),
    });
    assert(editStudentCatBlocked.status === 403, 'Office cannot alter student seat category');

    // Fees Management regression: Student registered in /api/students appears in /api/fees/students with ₹1,25,750 Government assessment & accepts cash payment
    const feesStudentsRes = await fetch(`${baseUrl}/api/fees/students`, { headers: officeHeaders });
    const feesStudentsData = await feesStudentsRes.json();
    const feeStudent = feesStudentsData.students.find((s: any) => s.id === studentId);
    assert(
      Boolean(feeStudent) && feeStudent.outstandingBalance === 125750,
      'Shared student record is immediately available in Fees Management with accurate assessment (₹1,25,750)'
    );

    const cashPayRes = await fetch(`${baseUrl}/api/fees/payments`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        studentId,
        assessmentId: feeStudent.currentAssessment.id,
        amount: 25750,
        destination: 'COLLEGE_ACCOUNT',
        paymentMethod: 'CASH',
        paymentDate: '2026-10-24',
      }),
    });
    assert(cashPayRes.status === 201, 'Fees Management cash payment & receipt generation works without regression');

    // =========================================================================
    // 5. Password Reset, Suspension, Reactivation & Deactivation Lifecycle
    // =========================================================================
    console.log('\n--- 5. Password Reset, Suspend, Reactivate & Deactivate Lifecycle ---');
    // Admin resets Office user's password -> invalidates Office session
    const resetPwd = genSecret('ResetOff');
    const resetRes = await fetch(`${baseUrl}/api/users/${officeUserId}/reset-password`, {
      method: 'POST',
      headers: principalHeaders,
      body: JSON.stringify({ temporaryPassword: resetPwd, confirmPassword: resetPwd }),
    });
    assert(resetRes.status === 200, 'Principal resets Office user password');

    const officeAfterReset = await fetch(`${baseUrl}/api/fees/stats`, { headers: officeHeaders });
    assert(officeAfterReset.status === 401, 'Password reset immediately invalidates target user active session');

    const offRelogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernameOrEmail: 'office_member', password: resetPwd }),
    });
    const offReloginData = await offRelogin.json();
    const offReloginCookies = extractCookies(offRelogin);
    officeHeaders = makeHeaders(offReloginCookies.session, offReloginData.csrfToken);
    assert(
      offRelogin.status === 200 && offReloginData.user?.mustChangePassword === true,
      'Reset user can sign in with temporary password and must change it'
    );

    // Suspend Office user (while mustChangePassword is still true!)
    const suspendRes = await fetch(`${baseUrl}/api/users/${officeUserId}/suspend`, {
      method: 'PATCH',
      headers: principalHeaders,
      body: JSON.stringify({ reason: 'Audit verification pause' }),
    });
    assert(suspendRes.status === 200, 'Suspending account succeeds');
    assert((await fetch(`${baseUrl}/api/auth/me`, { headers: officeHeaders })).status === 401, 'Suspended session invalidated');

    const suspendedLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernameOrEmail: 'office_member', password: resetPwd }),
    });
    assert(suspendedLogin.status === 403, 'Suspended account cannot authenticate');

    // Reactivate Office user -> preserves mustChangePassword = true!
    const reactivateRes = await fetch(`${baseUrl}/api/users/${officeUserId}/reactivate`, {
      method: 'PATCH',
      headers: principalHeaders,
    });
    assert(reactivateRes.status === 200, 'Reactivating suspended account succeeds');

    const reactivatedLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernameOrEmail: 'office_member', password: resetPwd }),
    });
    const reactivatedData = await reactivatedLogin.json();
    const reactivatedCookies = extractCookies(reactivatedLogin);
    officeHeaders = makeHeaders(reactivatedCookies.session, reactivatedData.csrfToken);
    assert(
      reactivatedLogin.status === 200 && reactivatedData.user?.mustChangePassword === true,
      'Reactivated account restores login eligibility and preserves pending password-change requirement'
    );

    // Deactivate Office user -> prevents login, invalidates session, preserves payments/students/receipts!
    const deactivateRes = await fetch(`${baseUrl}/api/users/${officeUserId}/deactivate`, {
      method: 'PATCH',
      headers: saHeaders,
      body: JSON.stringify({ reason: 'Transferred out' }),
    });
    assert(deactivateRes.status === 200, 'Deactivating account succeeds');

    const deactivatedLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernameOrEmail: 'office_member', password: resetPwd }),
    });
    assert(deactivatedLogin.status === 403, 'Deactivated account cannot authenticate');

    // Verify historical records created by deactivated Office user remain intact
    const ledgerCheck = await fetch(`${baseUrl}/api/fees/students/${studentId}`, { headers: saHeaders });
    const ledgerData = await ledgerCheck.json();
    assert(
      ledgerCheck.status === 200 &&
        ledgerData.payments.length === 1 &&
        ledgerData.summary.outstandingBalance === 100000,
      'Deactivating user preserves student, payment, receipt, and ledger history intact'
    );

    // =========================================================================
    // 6. 6-Attempt 30-Minute Automatic Lockout & Expiry Without Admin Unlock
    // =========================================================================
    console.log('\n--- 6. 6-Attempt Automatic Lockout & 30-Minute Auto-Expiry ---');
    const lockUserPwd = genSecret('LockTest');
    const createLockTarget = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        username: 'lockout_clerk',
        email: 'lockout_clerk@kamch.ac.in',
        fullName: 'Lockout Verification Clerk',
        roleId: roleMap.get('OFFICE'),
        initialPassword: lockUserPwd,
        confirmPassword: lockUserPwd,
      }),
    });
    const lockTargetId = (await createLockTarget.json()).user.id;

    // 5 failed attempts (alternating username and email) -> HTTP 401, not locked yet
    for (let attempt = 1; attempt <= 5; attempt++) {
      const idUsed = attempt % 2 === 0 ? 'lockout_clerk@kamch.ac.in' : 'lockout_clerk';
      const failRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernameOrEmail: idUsed, password: 'WrongPassword!1' }),
      });
      assert(failRes.status === 401, `Failed attempt #${attempt} returns 401 without premature lockout`);
    }

    // 6th failed attempt -> triggers 30-minute lockout
    const sixthRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernameOrEmail: 'lockout_clerk@kamch.ac.in', password: 'WrongPassword!1' }),
    });
    const sixthData = await sixthRes.json();
    assert(
      sixthRes.status === 403 && sixthData.code === 'ACCOUNT_LOCKED',
      '6th consecutive failed attempt triggers 30-minute lockout (403 ACCOUNT_LOCKED)'
    );

    // Valid credentials CANNOT bypass active lockout
    const bypassRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernameOrEmail: 'lockout_clerk', password: lockUserPwd }),
    });
    assert(bypassRes.status === 403, 'Valid credentials do NOT bypass an active 30-minute lockout');

    // Simulate 31 minutes elapsed -> login succeeds automatically without admin unlock
    const memLockUser = memDb.users.find((u) => u.id === lockTargetId)!;
    memLockUser.locked_at = new Date(Date.now() - 31 * 60 * 1000).toISOString();

    const afterExpiryRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernameOrEmail: 'lockout_clerk', password: lockUserPwd }),
    });
    assert(
      afterExpiryRes.status === 200 && memLockUser.failed_attempts === 0 && !memLockUser.is_locked,
      'Login succeeds automatically after 30-minute lockout expires and resets failure counter'
    );

    // Audit Log Secret Sanitization Verification
    const rawAuditDump = JSON.stringify(memDb.auditLogs);
    assert(
      !rawAuditDump.includes(superAdminPermPwd) &&
        !rawAuditDump.includes(principalPermPwd) &&
        !rawAuditDump.includes(resetPwd) &&
        !rawAuditDump.includes('$2b$') &&
        !rawAuditDump.includes('$2a$'),
      'Audit logs contain ZERO plain-text passwords or bcrypt hashes'
    );

    console.log('\n====================================================');
    console.log(`TOTAL API TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log('====================================================');

    server.close();
    if (failed > 0) process.exit(1);
    process.exit(0);
  } catch (err) {
    console.error('Fatal API integration error:', err);
    server.close();
    process.exit(1);
  }
}

runApiIntegrationTests();
