import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { checkDatabaseConnection, getPool } from '../server/db.ts';
import { authRouter } from '../server/routes/auth.routes.ts';
import { userRouter } from '../server/routes/user.routes.ts';
import { feesRouter } from '../server/routes/fees.routes.ts';
import { recordsRouter } from '../server/routes/records.routes.ts';
import { internalAssessmentRouter } from '../server/routes/internal-assessment.routes.ts';
import { requireAuth, requirePasswordChangeClear, requireRoles } from '../server/middleware/auth.ts';
import { FEES_AND_STUDENTS_ROLES } from '../server/permissions.ts';
import { MemoryDatabase } from '../server/services/memory-db.ts';
import { updateSubmittedMarkThroughAuthorizedProcess } from '../server/services/ia-calculation.ts';

async function createTestSession(userId: number): Promise<{ cookieHeader: string; csrfToken: string }> {
  const pool = getPool();
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const csrfToken = crypto.randomBytes(24).toString('hex');

  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, ip_address, user_agent) VALUES (?, ?, '127.0.0.1', 'Step2F-Verification')`,
    [userId, tokenHash]
  );

  return {
    cookieHeader: `kamch_session=${rawToken}; kamch_csrf=${csrfToken}`,
    csrfToken,
  };
}

async function runFinalVerificationSuite() {
  console.log('=== KAMCH ERP Step 2F: Reports, Exports & 13-Point Combined Module Verification ===\n');

  const dbHealth = await checkDatabaseConnection();
  const dbModeLabel = dbHealth.connected
    ? 'Live MySQL Database'
    : 'In-Memory Relational Database Fallback (MySQL 127.0.0.1:3306 not running in sandbox)';
  console.log(`Database Execution Mode: ${dbModeLabel}\n`);

  const memDb = MemoryDatabase.getInstance();
  const initialSnapshot = memDb.createSnapshot();

  // Mount full Express application matching server.ts
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
  app.use('/api/internal-assessment', internalAssessmentRouter);
  app.use('/api', recordsRouter);

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const apiBase = `http://127.0.0.1:${port}/api`;

  try {
    const pool = getPool();

    // Provision Super Admin, Office Reviewer, and Department Accounts
    const [rolesRows] = await pool.query<any[]>(`SELECT id, code FROM roles`);
    const roleIdByCode = new Map<string, number>(
      rolesRows.map((r: any) => [String(r.code), Number(r.id)])
    );

    const plainPw = 'KamchVerify#2026!';
    const pwHash = bcrypt.hashSync(plainPw, 10);

    const [superAdminIns] = await pool.query<any>(
      `INSERT INTO users (username, email, password_hash, role_id, department_id, full_name, created_by)
       VALUES (?, ?, ?, ?, NULL, ?, NULL)`,
      ['sa_verify_2f', 'sa2f@kamch.ac.in', pwHash, roleIdByCode.get('SUPER_ADMIN'), 'Super Admin Verifier']
    );
    const superAdminId = Number(superAdminIns.insertId);
    await pool.query(`UPDATE users SET password_hash = ?, must_change_password = FALSE WHERE id = ?`, [
      pwHash,
      superAdminId,
    ]);

    const [officeIns] = await pool.query<any>(
      `INSERT INTO users (username, email, password_hash, role_id, department_id, full_name, created_by)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      [
        'office_verify_2f',
        'office2f@kamch.ac.in',
        pwHash,
        roleIdByCode.get('OFFICE'),
        'Office Academic Verifier',
        superAdminId,
      ]
    );
    const officeUserId = Number(officeIns.insertId);
    await pool.query(`UPDATE users SET password_hash = ?, must_change_password = FALSE WHERE id = ?`, [
      pwHash,
      officeUserId,
    ]);

    const saSession = await createTestSession(superAdminId);
    const officeSession = await createTestSession(officeUserId);

    // =========================================================================
    // CHECK 1: Department creation, editing, activation/deactivation & mapping
    // =========================================================================
    const createSamhitaDeptRes = await fetch(`${apiBase}/users/departments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: saSession.cookieHeader,
        'X-CSRF-Token': saSession.csrfToken,
      },
      body: JSON.stringify({
        code: 'SAMHITA_SIDDHANTA',
        name: 'Samhita & Siddhanta',
        description: 'Foundational Samhita Department',
      }),
    });
    assert.equal(createSamhitaDeptRes.status, 201, 'Super Admin should create Samhita department');
    const samhitaDeptId = Number((await createSamhitaDeptRes.json()).department.id);

    const createKayaDeptRes = await fetch(`${apiBase}/users/departments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: saSession.cookieHeader,
        'X-CSRF-Token': saSession.csrfToken,
      },
      body: JSON.stringify({
        code: 'KAYACHIKITSA_DEPT',
        name: 'Kayachikitsa',
        description: 'Clinical Kayachikitsa Department',
      }),
    });
    assert.equal(createKayaDeptRes.status, 201, 'Super Admin should create Kayachikitsa department');
    const kayaDeptId = Number((await createKayaDeptRes.json()).department.id);

    // Edit + deactivate + reactivate check
    const deactRes = await fetch(`${apiBase}/users/departments/${samhitaDeptId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: saSession.cookieHeader,
        'X-CSRF-Token': saSession.csrfToken,
      },
      body: JSON.stringify({
        code: 'SAMHITA_SIDDHANTA',
        name: 'Department of Samhita & Siddhanta',
        description: 'Updated description',
        isActive: false,
      }),
    });
    assert.equal(deactRes.status, 200);
    assert.equal((await deactRes.json()).department.isActive, false);

    const reactRes = await fetch(`${apiBase}/users/departments/${samhitaDeptId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: saSession.cookieHeader,
        'X-CSRF-Token': saSession.csrfToken,
      },
      body: JSON.stringify({
        code: 'SAMHITA_SIDDHANTA',
        name: 'Department of Samhita & Siddhanta',
        description: 'Active Samhita Department',
        isActive: true,
      }),
    });
    assert.equal(reactRes.status, 200);
    assert.equal((await reactRes.json()).department.isActive, true);

    // Map Department Account to Samhita Department
    const [samhitaDeptUserIns] = await pool.query<any>(
      `INSERT INTO users (username, email, password_hash, role_id, department_id, full_name, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        'dept_samhita_2f',
        'samhita_dept@kamch.ac.in',
        pwHash,
        roleIdByCode.get('DEPARTMENT'),
        samhitaDeptId,
        'Samhita Department Coordinator',
        superAdminId,
      ]
    );
    const samhitaDeptUserId = Number(samhitaDeptUserIns.insertId);
    await pool.query(`UPDATE users SET password_hash = ?, must_change_password = FALSE WHERE id = ?`, [
      pwHash,
      samhitaDeptUserId,
    ]);
    const samhitaDeptSession = await createTestSession(samhitaDeptUserId);

    const myWsRes = await fetch(`${apiBase}/departments/my-workspace`, {
      headers: { Cookie: samhitaDeptSession.cookieHeader },
    });
    assert.equal(myWsRes.status, 200);
    const myWsJson = await myWsRes.json();
    assert.equal(Number(myWsJson.department.id), samhitaDeptId);
    console.log('✓ [1/13] Department creation, editing, activation/deactivation & account mapping verified');

    // =========================================================================
    // CHECK 2: Faculty records intact under departments without creating logins
    // =========================================================================
    const [usersBeforeTeacher] = await pool.query<any[]>(`SELECT COUNT(*) AS cnt FROM users`);
    const userCountBefore = Number(usersBeforeTeacher[0].cnt);

    const createTeacherRes = await fetch(`${apiBase}/teachers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: officeSession.cookieHeader,
        'X-CSRF-Token': officeSession.csrfToken,
      },
      body: JSON.stringify({
        teacherCode: 'AYUSH-TC-9901',
        teacherCodeStatus: 'VERIFIED',
        registrationNumber: 'KA-AYU-4455',
        fullName: 'Dr. Madhava Acharya',
        designation: 'Professor',
        departmentId: samhitaDeptId,
        qualification: 'BAMS, MD (Samhita)',
      }),
    });
    assert.equal(createTeacherRes.status, 201, 'Teacher record should be created under department');

    const [usersAfterTeacher] = await pool.query<any[]>(`SELECT COUNT(*) AS cnt FROM users`);
    assert.equal(
      Number(usersAfterTeacher[0].cnt),
      userCountBefore,
      'Creating a faculty/teacher record must NEVER create a login account in users'
    );

    const listTeachersRes = await fetch(`${apiBase}/teachers?departmentId=${samhitaDeptId}`, {
      headers: { Cookie: officeSession.cookieHeader },
    });
    assert.equal(listTeachersRes.status, 200);
    const teachersList = (await listTeachersRes.json()).teachers;
    assert.equal(teachersList.length, 1);
    assert.equal(teachersList[0].teacherCode, 'AYUSH-TC-9901');
    assert.equal(teachersList[0].registrationNumber, 'KA-AYU-4455');
    console.log('✓ [2/13] Faculty records intact under department without creating faculty login accounts');

    // =========================================================================
    // Setup Subjects, Batches, Assessments & Students for IA Checks
    // =========================================================================
    const [batches] = await pool.query<any[]>(
      `/* IA:LIST_BATCHES */
       SELECT b.id, b.code, b.name, b.admission_academic_year, b.current_cohort_stage,
              b.current_professional_year, b.is_active, b.scheme_id,
              cs.code AS scheme_code, cs.is_legacy_minimal
       FROM academic_batches b
       LEFT JOIN curriculum_schemes cs ON b.scheme_id = cs.id`
    );
    const vedangBatch = batches.find((b: any) => b.code === 'VEDANG');
    const agastyaBatch = batches.find((b: any) => b.code === 'AGASTYA');
    const rs6Batch = batches.find((b: any) => b.code === 'RS6_LEGACY');
    assert.ok(vedangBatch, 'Expected VEDANG batch (1st Prof. Year, RS7)');
    assert.ok(agastyaBatch, 'Expected AGASTYA batch (3rd Prof. Year, RS7)');
    assert.ok(rs6Batch, 'Expected RS6_LEGACY batch (RS6)');
    const batchId = Number(vedangBatch.id);
    const agastyaBatchId = Number(agastyaBatch.id);
    const rs6BatchId = Number(rs6Batch.id);

    const [subjects] = await pool.query<any[]>(
      `/* IA:LIST_SUBJECTS */
       SELECT s.*, d.name AS department_name, d.code AS department_code, d.is_active AS department_is_active
       FROM subjects s LEFT JOIN departments d ON s.department_id = d.id`
    );
    const samhita1 = subjects.find((s: any) => s.code === 'SAMHITA_1');
    const kayachikitsa = subjects.find((s: any) => s.code === 'KAYACHIKITSA');
    const panchakarma = subjects.find((s: any) => s.code === 'PANCHAKARMA');
    const researchMeth = subjects.find((s: any) => s.code === 'RESEARCH_METHODOLOGY');
    const atyaika = subjects.find((s: any) => s.code === 'ATYAIKACHIKITSA');
    assert.ok(samhita1 && kayachikitsa && panchakarma && researchMeth && atyaika);

    const [assessments] = await pool.query<any[]>(`/* IA:LIST_ASSESSMENTS */ SELECT * FROM assessments`);
    const assessmentByCode = new Map<string, any>(assessments.map((a: any) => [String(a.code), a]));

    const verifiedMapping = {
      term1: { A: 'PAT_1', B: 'PAT_2', C: 'PAT_3' },
      term2: { A: 'PAT_4', B: 'PAT_5', C: 'PAT_6' },
      term3: { A: 'PAT_7', B: 'PAT_8', C: 'PAT_9' },
    };

    // Link SAMHITA_1 (15 max) to samhitaDeptId, KAYACHIKITSA (30 max) & PANCHAKARMA (unverified PAT) to kayaDeptId
    for (const cfg of [
      { id: samhita1.id, deptId: samhitaDeptId, patVerified: true, patConfig: verifiedMapping },
      { id: kayachikitsa.id, deptId: kayaDeptId, patVerified: true, patConfig: verifiedMapping },
      { id: panchakarma.id, deptId: kayaDeptId, patVerified: false, patConfig: null },
    ]) {
      const res = await fetch(`${apiBase}/internal-assessment/subjects/${cfg.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: officeSession.cookieHeader,
          'X-CSRF-Token': officeSession.csrfToken,
        },
        body: JSON.stringify({
          departmentId: cfg.deptId,
          patMappingVerified: cfg.patVerified,
          patMappingConfig: cfg.patConfig,
        }),
      });
      assert.equal(res.status, 200);
    }

    // Configure assessment availability dates for SAMHITA_1 PAT_1 & TERM_TEST_1
    const pat1Id = Number(assessmentByCode.get('PAT_1').id);
    const tt1Id = Number(assessmentByCode.get('TERM_TEST_1').id);
    const cfgSaveRes = await fetch(`${apiBase}/internal-assessment/config`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: officeSession.cookieHeader,
        'X-CSRF-Token': officeSession.csrfToken,
      },
      body: JSON.stringify({
        subjectId: samhita1.id,
        configs: [
          {
            assessmentId: pat1Id,
            isApplicable: true,
            isAvailableForEntry: true,
            availableFromDate: '2026-08-10',
            availableToDate: '2026-08-12',
          },
          {
            assessmentId: tt1Id,
            isApplicable: true,
            isAvailableForEntry: true,
            availableFromDate: '2026-10-05',
            availableToDate: '2026-10-05',
          },
        ],
      }),
    });
    assert.equal(cfgSaveRes.status, 200);

    // Seed 4 students in VEDANG batch
    const studentDefs = [
      { roll: 'KAMCH-2025-0201', univ: 'UHS25BAMS201', name: 'Ananya Rao' },
      { roll: 'KAMCH-2025-0202', univ: 'UHS25BAMS202', name: 'Bharat Kulkarni' },
      { roll: 'KAMCH-2025-0203', univ: null, name: 'Charvi Hegde' },
      { roll: 'KAMCH-2025-0204', univ: null, name: 'Darshan Shetty' },
    ];
    const studentIds: number[] = [];
    for (const st of studentDefs) {
      const [ins] = await pool.query<any>(
        `INSERT INTO students (student_id_number, full_name, course_name, admission_year, current_year_of_study, admission_quota, contact_phone, contact_email, status)
         VALUES (?, ?, 'BAMS', 2025, 1, 'GOVERNMENT', '9880011223', 'st@kamch.ac.in', 'ACTIVE')`,
        [st.roll, st.name]
      );
      const sid = Number(ins.insertId);
      const memSt = memDb.students.find((x) => x.id === sid);
      if (memSt) {
        memSt.temporary_roll_number = st.roll;
        memSt.permanent_university_number = st.univ;
        memSt.original_batch_id = batchId;
        memSt.current_placement_batch_id = batchId;
        memSt.scheme_id = vedangBatch.scheme_id;
        memSt.administrative_status = 'ACTIVE';
      }
      studentIds.push(sid);
    }
    const [s1, s2, s3, s4] = studentIds;

    // Seed 4 students in AGASTYA batch (3rd Professional Year, RS7) for 3rd-year subject checks
    const agastyaStudentDefs = [
      { roll: 'KAMCH-2022-0301', univ: 'UHS22BAMS301', name: 'Gauri Deshpande' },
      { roll: 'KAMCH-2022-0302', univ: 'UHS22BAMS302', name: 'Harsha Pai' },
      { roll: 'KAMCH-2022-0303', univ: null, name: 'Ishaan Joshi' },
      { roll: 'KAMCH-2022-0304', univ: null, name: 'Janani Bhat' },
    ];
    const agastyaStudentIds: number[] = [];
    for (const st of agastyaStudentDefs) {
      const [ins] = await pool.query<any>(
        `INSERT INTO students (student_id_number, full_name, course_name, admission_year, current_year_of_study, admission_quota, contact_phone, contact_email, status)
         VALUES (?, ?, 'BAMS', 2022, 3, 'GOVERNMENT', '9880011229', 'st3@kamch.ac.in', 'ACTIVE')`,
        [st.roll, st.name]
      );
      const sid = Number(ins.insertId);
      const memSt = memDb.students.find((x) => x.id === sid);
      if (memSt) {
        memSt.temporary_roll_number = st.roll;
        memSt.permanent_university_number = st.univ;
        memSt.original_batch_id = agastyaBatchId;
        memSt.current_placement_batch_id = agastyaBatchId;
        memSt.scheme_id = agastyaBatch.scheme_id;
        memSt.administrative_status = 'ACTIVE';
      }
      agastyaStudentIds.push(sid);
    }
    const [ag1, ag2, ag3, ag4] = agastyaStudentIds;

    // Verify batch-scoped subject list and server-side batch/subject compatibility validation:
    // 1. Vedang (1st Prof. Year, RS7) returns only Year-1 RS7 subjects (never Year-3 subjects)
    const vedangSubjRes = await fetch(
      `${apiBase}/internal-assessment/subjects?batchId=${batchId}`,
      { headers: { Cookie: officeSession.cookieHeader } }
    );
    assert.equal(vedangSubjRes.status, 200);
    const vedangSubjList = (await vedangSubjRes.json()).subjects;
    assert.ok(vedangSubjList.length > 0, 'Vedang should have Year-1 RS7 subjects');
    assert.ok(
      vedangSubjList.every((s: any) => Number(s.professionalYear) === 1 && s.schemeCode === 'RS7'),
      'Vedang subject list must contain exclusively 1st Professional Year RS7 subjects'
    );
    assert.ok(
      !vedangSubjList.some((s: any) => s.code === 'KAYACHIKITSA'),
      '3rd Professional Year subject Kayachikitsa must never appear for 1st-year Vedang batch'
    );

    // 2. Server rejects Vedang (Year 1) + Kayachikitsa (Year 3) with HTTP 400 INCOMPATIBLE_BATCH_SUBJECT
    const mismatchYearRes = await fetch(
      `${apiBase}/internal-assessment/marks-entry?batchId=${batchId}&subjectId=${kayachikitsa.id}&assessmentId=${pat1Id}`,
      { headers: { Cookie: officeSession.cookieHeader } }
    );
    assert.equal(mismatchYearRes.status, 400);
    assert.equal((await mismatchYearRes.json()).code, 'INCOMPATIBLE_BATCH_SUBJECT');

    // 3. Server rejects RS6 Legacy batch + RS7 subject with HTTP 400 INCOMPATIBLE_BATCH_SUBJECT
    const mismatchSchemeRes = await fetch(
      `${apiBase}/internal-assessment/marks-entry?batchId=${rs6BatchId}&subjectId=${samhita1.id}&assessmentId=${pat1Id}`,
      { headers: { Cookie: officeSession.cookieHeader } }
    );
    assert.equal(mismatchSchemeRes.status, 400);
    assert.equal((await mismatchSchemeRes.json()).code, 'INCOMPATIBLE_BATCH_SUBJECT');

    // =========================================================================
    // CHECK 3: Marks draft entry and saving for PATs and term tests
    // =========================================================================
    const patDraftRes = await fetch(`${apiBase}/internal-assessment/marks-entry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: samhitaDeptSession.cookieHeader,
        'X-CSRF-Token': samhitaDeptSession.csrfToken,
      },
      body: JSON.stringify({
        batchId,
        subjectId: samhita1.id,
        assessmentId: pat1Id,
        entries: [
          { studentId: s1, outcome: 'MARKS_ENTERED', theoryMarks: 12, practicalMarks: null },
          { studentId: s2, outcome: 'ABSENT', theoryMarks: null, practicalMarks: null },
          // s3 and s4 intentionally omitted in incomplete draft!
        ],
      }),
    });
    assert.equal(patDraftRes.status, 200, 'Incomplete PAT draft save must succeed');

    const ttDraftRes = await fetch(`${apiBase}/internal-assessment/marks-entry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: samhitaDeptSession.cookieHeader,
        'X-CSRF-Token': samhitaDeptSession.csrfToken,
      },
      body: JSON.stringify({
        batchId,
        subjectId: samhita1.id,
        assessmentId: tt1Id,
        entries: [
          { studentId: s1, outcome: 'MARKS_ENTERED', theoryMarks: 80, practicalMarks: 80 },
        ],
      }),
    });
    assert.equal(ttDraftRes.status, 200, 'Incomplete Term Test draft save must succeed');
    console.log('✓ [3/13] Marks draft entry and partial draft saving for PATs and Term Tests verified');

    // =========================================================================
    // CHECK 4: Submission blocked when any student outcome is missing
    // =========================================================================
    const incompleteSubmitRes = await fetch(`${apiBase}/internal-assessment/submit-assessment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: samhitaDeptSession.cookieHeader,
        'X-CSRF-Token': samhitaDeptSession.csrfToken,
      },
      body: JSON.stringify({
        batchId,
        subjectId: samhita1.id,
        assessmentId: pat1Id,
        entries: [
          { studentId: s1, outcome: 'MARKS_ENTERED', theoryMarks: 12, practicalMarks: null },
          { studentId: s2, outcome: 'ABSENT', theoryMarks: null, practicalMarks: null },
          // s3 & s4 missing!
        ],
      }),
    });
    assert.equal(incompleteSubmitRes.status, 400, 'Submission must be blocked when student outcomes are missing');
    console.log('✓ [4/13] Submission blocked when any student outcome is missing');

    // =========================================================================
    // CHECK 5: Submitted assessment locked for department users
    // =========================================================================
    const validPat1SubmitRes = await fetch(`${apiBase}/internal-assessment/submit-assessment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: samhitaDeptSession.cookieHeader,
        'X-CSRF-Token': samhitaDeptSession.csrfToken,
      },
      body: JSON.stringify({
        batchId,
        subjectId: samhita1.id,
        assessmentId: pat1Id,
        entries: [
          { studentId: s1, outcome: 'MARKS_ENTERED', theoryMarks: 12, practicalMarks: null },
          { studentId: s2, outcome: 'ABSENT', theoryMarks: null, practicalMarks: null },
          { studentId: s3, outcome: 'NOT_APPEARED', theoryMarks: null, practicalMarks: null },
          { studentId: s4, outcome: 'EXEMPTED', theoryMarks: null, practicalMarks: null },
        ],
      }),
    });
    assert.equal(validPat1SubmitRes.status, 200, 'Complete PAT_1 submission should succeed');

    const editLockedDraftAttempt = await fetch(`${apiBase}/internal-assessment/marks-entry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: samhitaDeptSession.cookieHeader,
        'X-CSRF-Token': samhitaDeptSession.csrfToken,
      },
      body: JSON.stringify({
        batchId,
        subjectId: samhita1.id,
        assessmentId: pat1Id,
        entries: [{ studentId: s1, outcome: 'MARKS_ENTERED', theoryMarks: 15, practicalMarks: null }],
      }),
    });
    assert.equal(editLockedDraftAttempt.status, 403, 'Department user must not edit submitted marks');

    const dupSubmitAttempt = await fetch(`${apiBase}/internal-assessment/submit-assessment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: samhitaDeptSession.cookieHeader,
        'X-CSRF-Token': samhitaDeptSession.csrfToken,
      },
      body: JSON.stringify({
        batchId,
        subjectId: samhita1.id,
        assessmentId: pat1Id,
        entries: [
          { studentId: s1, outcome: 'MARKS_ENTERED', theoryMarks: 12, practicalMarks: null },
          { studentId: s2, outcome: 'ABSENT', theoryMarks: null, practicalMarks: null },
          { studentId: s3, outcome: 'NOT_APPEARED', theoryMarks: null, practicalMarks: null },
          { studentId: s4, outcome: 'EXEMPTED', theoryMarks: null, practicalMarks: null },
        ],
      }),
    });
    assert.ok([403, 409].includes(dupSubmitAttempt.status), 'Duplicate submission must be blocked');
    console.log('✓ [5/13] Submitted assessment locked against edits and duplicate submissions');

    // =========================================================================
    // CHECK 6: Cross-department access rejected on the server (including Reports!)
    // =========================================================================
    const crossWsRes = await fetch(`${apiBase}/departments/${kayaDeptId}/workspace`, {
      headers: { Cookie: samhitaDeptSession.cookieHeader },
    });
    assert.equal(crossWsRes.status, 403, 'Cross-department workspace access must be rejected');

    const crossMarksRes = await fetch(
      `${apiBase}/internal-assessment/marks-entry?batchId=${batchId}&subjectId=${kayachikitsa.id}&assessmentId=${pat1Id}`,
      { headers: { Cookie: samhitaDeptSession.cookieHeader } }
    );
    assert.equal(crossMarksRes.status, 403, 'Cross-department marks access must be rejected');

    const crossAssessReportRes = await fetch(
      `${apiBase}/internal-assessment/reports/assessment?batchId=${batchId}&departmentId=${kayaDeptId}&subjectId=${kayachikitsa.id}&assessmentId=${pat1Id}`,
      { headers: { Cookie: samhitaDeptSession.cookieHeader } }
    );
    assert.equal(crossAssessReportRes.status, 403, 'Cross-department Assessment Report must be rejected');

    const crossFinalReportRes = await fetch(
      `${apiBase}/internal-assessment/reports/final-ia?batchId=${batchId}&departmentId=${kayaDeptId}&subjectId=${kayachikitsa.id}`,
      { headers: { Cookie: samhitaDeptSession.cookieHeader } }
    );
    assert.equal(crossFinalReportRes.status, 403, 'Cross-department Final IA Report must be rejected');
    console.log('✓ [6/13] Cross-department workspace, marks, and report access rejected with HTTP 403');

    // =========================================================================
    // CHECK 7: Verified IA calculation for 15-mark and 30-mark subjects
    // =========================================================================
    // Submit remaining assessments for SAMHITA_1 (15 max) and all 11 assessments for KAYACHIKITSA (30 max)
    const remainingCodesSamhita = [
      'PAT_2',
      'PAT_3',
      'PAT_4',
      'PAT_5',
      'PAT_6',
      'PAT_7',
      'PAT_8',
      'PAT_9',
      'TERM_TEST_1',
      'TERM_TEST_2',
    ];
    for (const code of remainingCodesSamhita) {
      const a = assessmentByCode.get(code)!;
      const isTT = a.assessment_type === 'TERM_TEST';
      const subRes = await fetch(`${apiBase}/internal-assessment/submit-assessment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: officeSession.cookieHeader,
          'X-CSRF-Token': officeSession.csrfToken,
        },
        body: JSON.stringify({
          batchId,
          subjectId: samhita1.id,
          assessmentId: a.id,
          entries: [
            { studentId: s1, outcome: 'MARKS_ENTERED', theoryMarks: isTT ? 80 : 12, practicalMarks: isTT ? 80 : null },
            { studentId: s2, outcome: 'MARKS_ENTERED', theoryMarks: isTT ? 60 : 9, practicalMarks: isTT ? 60 : null },
            { studentId: s3, outcome: 'MARKS_ENTERED', theoryMarks: isTT ? 70 : 12, practicalMarks: isTT ? 70 : null },
            { studentId: s4, outcome: 'MARKS_ENTERED', theoryMarks: isTT ? 75 : 12, practicalMarks: isTT ? 75 : null },
          ],
        }),
      });
      assert.equal(subRes.status, 200, `Failed submitting ${code} for SAMHITA_1`);
    }

    // For SAMHITA_1 (max 15):
    // Student 1: all PATs = 12 => D1=D2=D3=12, E1=E2=E3=12; TT1=160/200*15=12, TT2=12 => H1=12, H2=12, H3=12 => Final IA = 12.00
    // Student 2: PAT_1 = ABSENT (0), PAT_2=9, PAT_3=9 => D1=(0+9+9)/3=6, E1=6; TT1=120/200*15=9 => H1=(6+9)/2=7.5
    //            Term 2: PAT4..6=9 => E2=9, TT2=9 => H2=9; Term 3: PAT7..9=9 => H3=9 => Final IA = (7.5 + 9 + 9)/3 = 8.50
    // Student 3: PAT_1 = NOT_APPEARED => PENDING (no invented rule)
    // Student 4: PAT_1 = EXEMPTED => PENDING (no invented rule)
    const calc15Res = await fetch(
      `${apiBase}/internal-assessment/calculations?batchId=${batchId}&subjectId=${samhita1.id}`,
      { headers: { Cookie: officeSession.cookieHeader } }
    );
    assert.equal(calc15Res.status, 200);
    const calc15Json = await calc15Res.json();
    const c15Map = new Map<number, any>(calc15Json.calculations.map((r: any) => [r.studentId, r]));
    assert.equal(c15Map.get(s1).calculationStatus, 'CALCULATED');
    assert.equal(c15Map.get(s1).finalAutomaticIa, 12);
    assert.equal(c15Map.get(s2).calculationStatus, 'CALCULATED');
    assert.equal(c15Map.get(s2).finalAutomaticIa, 8.5);
    assert.equal(c15Map.get(s3).calculationStatus, 'PENDING');
    assert.equal(c15Map.get(s4).calculationStatus, 'PENDING');

    // Verify marks entry and assessment submission never auto-advance a batch's term or professional year
    const [batchesAfterMarks] = await pool.query<any[]>(
      `/* IA:GET_BATCH_BY_ID */
       SELECT b.id, b.current_cohort_stage, b.current_professional_year, cs.code AS scheme_code, cs.is_legacy_minimal
       FROM academic_batches b
       LEFT JOIN curriculum_schemes cs ON b.scheme_id = cs.id
       WHERE b.id = ? LIMIT 1`,
      [batchId]
    );
    assert.equal(
      Number(batchesAfterMarks[0].current_professional_year),
      Number(vedangBatch.current_professional_year),
      'Marks entry/submission must NEVER auto-advance current_professional_year'
    );
    assert.equal(
      String(batchesAfterMarks[0].current_cohort_stage),
      String(vedangBatch.current_cohort_stage),
      'Marks entry/submission must NEVER auto-advance current_cohort_stage'
    );

    // Submit all 11 assessments for KAYACHIKITSA (30 max, 3rd Prof. Year) using AGASTYA batch (3rd Prof. Year, RS7)
    const all11Codes = ['PAT_1', ...remainingCodesSamhita];
    for (const code of all11Codes) {
      const a = assessmentByCode.get(code)!;
      const isTT = a.assessment_type === 'TERM_TEST';
      const subRes = await fetch(`${apiBase}/internal-assessment/submit-assessment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: officeSession.cookieHeader,
          'X-CSRF-Token': officeSession.csrfToken,
        },
        body: JSON.stringify({
          batchId: agastyaBatchId,
          subjectId: kayachikitsa.id,
          assessmentId: a.id,
          entries: [
            { studentId: ag1, outcome: 'MARKS_ENTERED', theoryMarks: isTT ? 80 : 12, practicalMarks: isTT ? 80 : null },
            { studentId: ag2, outcome: 'MARKS_ENTERED', theoryMarks: isTT ? 50 : 9, practicalMarks: isTT ? 50 : null },
            { studentId: ag3, outcome: 'NOT_APPEARED', theoryMarks: null, practicalMarks: null },
            { studentId: ag4, outcome: 'EXEMPTED', theoryMarks: null, practicalMarks: null },
          ],
        }),
      });
      assert.equal(subRes.status, 200);
    }
    // For KAYACHIKITSA (max 30):
    // Student 1: PATs = 12 => D=12 => E=(12/15)*30 = 24; TT=160/200*30 = 24 => H1=24, H2=24, H3=24 => Final IA = 24.00
    // Student 2: PATs = 9 => D=9 => E=(9/15)*30 = 18; TT=100/200*30 = 15 => H1=16.5, H2=16.5, H3=18 => Final IA = (16.5+16.5+18)/3 = 17.00
    const calc30Res = await fetch(
      `${apiBase}/internal-assessment/calculations?batchId=${agastyaBatchId}&subjectId=${kayachikitsa.id}`,
      { headers: { Cookie: officeSession.cookieHeader } }
    );
    assert.equal(calc30Res.status, 200);
    const calc30Json = await calc30Res.json();
    const c30Map = new Map<number, any>(calc30Json.calculations.map((r: any) => [r.studentId, r]));
    assert.equal(c30Map.get(ag1).finalAutomaticIa, 24);
    assert.equal(c30Map.get(ag2).finalAutomaticIa, 17);
    console.log('✓ [7/13] Verified IA calculation formulas for 15-mark (12.00 / 8.50) and 30-mark (24.00 / 17.00) subjects');

    // =========================================================================
    // CHECK 8: Unverified PAT mapping remains pending rather than guessed
    // =========================================================================
    const unverifiedSubRes = await fetch(`${apiBase}/internal-assessment/submit-assessment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: officeSession.cookieHeader,
        'X-CSRF-Token': officeSession.csrfToken,
      },
      body: JSON.stringify({
        batchId: agastyaBatchId,
        subjectId: panchakarma.id,
        assessmentId: pat1Id,
        entries: [
          { studentId: ag1, outcome: 'MARKS_ENTERED', theoryMarks: 14, practicalMarks: null },
          { studentId: ag2, outcome: 'MARKS_ENTERED', theoryMarks: 13, practicalMarks: null },
          { studentId: ag3, outcome: 'MARKS_ENTERED', theoryMarks: 12, practicalMarks: null },
          { studentId: ag4, outcome: 'MARKS_ENTERED', theoryMarks: 11, practicalMarks: null },
        ],
      }),
    });
    assert.equal(unverifiedSubRes.status, 200);

    const calcUnverifiedRes = await fetch(
      `${apiBase}/internal-assessment/calculations?batchId=${agastyaBatchId}&subjectId=${panchakarma.id}`,
      { headers: { Cookie: officeSession.cookieHeader } }
    );
    const calcUnverifiedJson = await calcUnverifiedRes.json();
    for (const row of calcUnverifiedJson.calculations) {
      assert.equal(row.calculationStatus, 'PENDING', 'Unverified PAT mapping must stay PENDING');
      assert.equal(row.finalAutomaticIa, null);
    }
    console.log('✓ [8/13] Unverified PAT mapping remains PENDING rather than guessed');

    // =========================================================================
    // CHECK 9: Research Methodology & Atyaikachikitsa excluded from IA calculation
    // =========================================================================
    for (const excSubj of [researchMeth, atyaika]) {
      const putExcRes = await fetch(`${apiBase}/internal-assessment/subjects/${excSubj.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: officeSession.cookieHeader,
          'X-CSRF-Token': officeSession.csrfToken,
        },
        body: JSON.stringify({
          patMappingVerified: true,
          patMappingConfig: verifiedMapping,
        }),
      });
      assert.equal(putExcRes.status, 400, `${excSubj.code} must reject PAT mapping configuration`);

      const calcExcRes = await fetch(
        `${apiBase}/internal-assessment/calculations?batchId=${agastyaBatchId}&subjectId=${excSubj.id}`,
        { headers: { Cookie: officeSession.cookieHeader } }
      );
      assert.equal(calcExcRes.status, 200);
      const calcExcJson = await calcExcRes.json();
      for (const row of calcExcJson.calculations) {
        assert.equal(row.calculationStatus, 'NOT_APPLICABLE');
        assert.equal(row.finalAutomaticIa, null);
      }
    }
    console.log('✓ [9/13] Research Methodology and Atyaikachikitsa excluded (NOT_APPLICABLE)');

    // =========================================================================
    // CHECK 10: Office approval and manual adjustment history persists
    // =========================================================================
    const approveS1Res = await fetch(`${apiBase}/internal-assessment/final-approval`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: officeSession.cookieHeader,
        'X-CSRF-Token': officeSession.csrfToken,
      },
      body: JSON.stringify({ batchId, subjectId: samhita1.id, studentId: s1 }),
    });
    assert.equal(approveS1Res.status, 200);

    const adjustS2Res = await fetch(`${apiBase}/internal-assessment/manual-adjustment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: officeSession.cookieHeader,
        'X-CSRF-Token': officeSession.csrfToken,
      },
      body: JSON.stringify({
        batchId,
        subjectId: samhita1.id,
        studentId: s2,
        adjustedFinalIa: 10.0,
        reasonCategory: 'ACADEMIC_EXCELLENCE',
        explanation: 'Consistent seminar presentation and clinical Sanskrit recitation distinction.',
      }),
    });
    assert.equal(adjustS2Res.status, 200);

    const histRes = await fetch(
      `${apiBase}/internal-assessment/final-history?batchId=${batchId}&subjectId=${samhita1.id}`,
      { headers: { Cookie: officeSession.cookieHeader } }
    );
    assert.equal(histRes.status, 200);
    const histJson = await histRes.json();
    assert.equal(histJson.history.length, 2, 'Both approval and manual adjustment history rows must persist');
    console.log('✓ [10/13] Office Final IA approval and manual adjustment audit history persisted');

    // =========================================================================
    // CHECK 11: Recalculation preserves approved mark & flags record for review
    // =========================================================================
    await updateSubmittedMarkThroughAuthorizedProcess({
      batchId,
      subjectId: samhita1.id,
      assessmentId: pat1Id,
      studentId: s1,
      outcome: 'MARKS_ENTERED',
      theoryMarks: 15, // Changed from 12 -> 15; new Term 1 D=13, E=13, H1=(13+12)/2=12.5 => new Auto IA = (12.5+12+12)/3 = 12.17
      practicalMarks: null,
      authorizedActorId: officeUserId,
    });

    const reviewAfterRecalcRes = await fetch(
      `${apiBase}/internal-assessment/office-review?batchId=${batchId}&subjectId=${samhita1.id}`,
      { headers: { Cookie: officeSession.cookieHeader } }
    );
    assert.equal(reviewAfterRecalcRes.status, 200);
    const reviewAfterRecalcJson = await reviewAfterRecalcRes.json();
    const s1Review = reviewAfterRecalcJson.students.find((x: any) => x.studentId === s1);
    assert.equal(s1Review.calculation.finalAutomaticIa, 12.17);
    assert.equal(
      s1Review.approval.approvedFinalIa,
      12,
      'Previously approved Final IA mark (12.00) must NOT be silently overwritten'
    );
    assert.equal(s1Review.currentFinalStatus, 'REQUIRES_REVIEW');
    assert.equal(s1Review.officeReviewRequired, true);
    console.log('✓ [11/13] Recalculation preserved approved Final IA mark (12.00) and flagged REQUIRES_REVIEW');

    // =========================================================================
    // CHECK 12: Printable report & Excel CSV export match DB + inactive batch preservation
    // =========================================================================
    // 12a. Update Report Branding via Office User
    const brandingPutRes = await fetch(`${apiBase}/internal-assessment/report-branding`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: officeSession.cookieHeader,
        'X-CSRF-Token': officeSession.csrfToken,
      },
      body: JSON.stringify({
        collegeName: 'Krishna Ayurvedic Medical College & Hospital',
        subtitle: 'Office of the Principal — Internal Assessment Section',
        logoUrl: '/assets/kamch-logo.png',
      }),
    });
    assert.equal(brandingPutRes.status, 200);

    // 12b. Generate Final IA Report (JSON + CSV) while s1 is REQUIRES_REVIEW, s2 is ADJUSTED_APPROVED (10.00), s3 & s4 are PENDING
    // Also approve KAYACHIKITSA ag1 (24.00) while leaving KAYACHIKITSA ag2 (17.00) unapproved (AWAITING_APPROVAL) to verify unapproved != approved!
    await fetch(`${apiBase}/internal-assessment/final-approval`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: officeSession.cookieHeader,
        'X-CSRF-Token': officeSession.csrfToken,
      },
      body: JSON.stringify({ batchId: agastyaBatchId, subjectId: kayachikitsa.id, studentId: ag1 }),
    });

    const finalIaJsonRes = await fetch(
      `${apiBase}/internal-assessment/reports/final-ia?batchId=${batchId}&departmentId=${samhitaDeptId}&subjectId=${samhita1.id}`,
      { headers: { Cookie: officeSession.cookieHeader } }
    );
    assert.equal(finalIaJsonRes.status, 200);
    const finalIaReport = (await finalIaJsonRes.json()).report;
    assert.equal(finalIaReport.branding.subtitle, 'Office of the Principal — Internal Assessment Section');
    const repS1 = finalIaReport.students.find((x: any) => x.studentId === s1);
    const repS2 = finalIaReport.students.find((x: any) => x.studentId === s2);
    const repS3 = finalIaReport.students.find((x: any) => x.studentId === s3);
    assert.equal(repS1.automaticIa, 12.17);
    assert.equal(
      repS1.approvedFinalIa,
      null,
      'Flagged REQUIRES_REVIEW record must not be presented as a cleared approved mark'
    );
    assert.equal(repS1.previouslyApprovedFinalIa, 12);
    assert.equal(repS1.finalApprovalStatus, 'REQUIRES_REVIEW');
    assert.equal(repS1.reviewRequired, true);

    assert.equal(repS2.automaticIa, 8.5);
    assert.equal(repS2.approvedFinalIa, 10);
    assert.equal(repS2.finalApprovalStatus, 'ADJUSTED_APPROVED');
    assert.equal(repS2.reviewRequired, false);

    assert.equal(repS3.automaticIa, null);
    assert.equal(repS3.approvedFinalIa, null);
    assert.equal(repS3.finalApprovalStatus, 'PENDING_CALCULATION');

    // Verify KAYACHIKITSA report: ag1 APPROVED (24), ag2 AWAITING_APPROVAL (automaticIa=17, approvedFinalIa=null!)
    const kayaFinalRes = await fetch(
      `${apiBase}/internal-assessment/reports/final-ia?batchId=${agastyaBatchId}&departmentId=${kayaDeptId}&subjectId=${kayachikitsa.id}`,
      { headers: { Cookie: officeSession.cookieHeader } }
    );
    assert.equal(kayaFinalRes.status, 200);
    const kayaReport = (await kayaFinalRes.json()).report;
    const kayaS1 = kayaReport.students.find((x: any) => x.studentId === ag1);
    const kayaS2 = kayaReport.students.find((x: any) => x.studentId === ag2);
    assert.equal(kayaS1.approvedFinalIa, 24);
    assert.equal(kayaS1.finalApprovalStatus, 'APPROVED');
    assert.equal(kayaS2.automaticIa, 17);
    assert.equal(
      kayaS2.approvedFinalIa,
      null,
      'Unapproved Automatic IA (17.00) must NEVER be presented as an approved Final IA mark'
    );
    assert.equal(kayaS2.finalApprovalStatus, 'AWAITING_APPROVAL');

    // 12c. Verify Assessment Report (JSON + CSV) & Final IA CSV Export
    const assessReportRes = await fetch(
      `${apiBase}/internal-assessment/reports/assessment?batchId=${batchId}&departmentId=${samhitaDeptId}&subjectId=${samhita1.id}&assessmentId=${pat1Id}`,
      { headers: { Cookie: officeSession.cookieHeader } }
    );
    assert.equal(assessReportRes.status, 200);
    const assessReport = (await assessReportRes.json()).report;
    assert.equal(assessReport.submission.status, 'SUBMITTED');
    assert.ok(assessReport.submission.submittedBy);
    assert.equal(assessReport.assessment.assessmentDateDisplay, '2026-08-10 to 2026-08-12');
    assert.equal(assessReport.students.find((x: any) => x.studentId === s1).theoryMarks, 15);
    assert.equal(assessReport.students.find((x: any) => x.studentId === s2).outcome, 'ABSENT');
    assert.equal(assessReport.students.find((x: any) => x.studentId === s3).outcome, 'NOT_APPEARED');
    assert.equal(assessReport.students.find((x: any) => x.studentId === s4).outcome, 'EXEMPTED');

    const assessCsvRes = await fetch(
      `${apiBase}/internal-assessment/reports/assessment?batchId=${batchId}&departmentId=${samhitaDeptId}&subjectId=${samhita1.id}&assessmentId=${pat1Id}&format=csv`,
      { headers: { Cookie: officeSession.cookieHeader } }
    );
    assert.equal(assessCsvRes.status, 200);
    assert.ok((assessCsvRes.headers.get('content-type') || '').includes('text/csv'));
    const assessCsvBytes = new Uint8Array(await assessCsvRes.arrayBuffer());
    assert.ok(
      assessCsvBytes[0] === 0xef && assessCsvBytes[1] === 0xbb && assessCsvBytes[2] === 0xbf,
      'CSV wire payload must start with UTF-8 BOM (0xEF 0xBB 0xBF) for Excel compatibility'
    );
    const assessCsvText = new TextDecoder('utf-8').decode(assessCsvBytes);
    assert.ok(assessCsvText.includes('KAMCH-2025-0201,UHS25BAMS201,Ananya Rao,ACTIVE,Marks Entered,15,15,Submitted'));
    assert.ok(assessCsvText.includes('KAMCH-2025-0202,UHS25BAMS202,Bharat Kulkarni,ACTIVE,Absent (0 in Calculation),,15,Submitted'));

    const finalCsvRes = await fetch(
      `${apiBase}/internal-assessment/reports/final-ia?batchId=${agastyaBatchId}&departmentId=${kayaDeptId}&subjectId=${kayachikitsa.id}&format=csv`,
      { headers: { Cookie: officeSession.cookieHeader } }
    );
    assert.equal(finalCsvRes.status, 200);
    const finalCsvBytes = new Uint8Array(await finalCsvRes.arrayBuffer());
    assert.ok(
      finalCsvBytes[0] === 0xef && finalCsvBytes[1] === 0xbb && finalCsvBytes[2] === 0xbf,
      'Final IA CSV wire payload must start with UTF-8 BOM (0xEF 0xBB 0xBF)'
    );
    const finalCsvText = new TextDecoder('utf-8').decode(finalCsvBytes);
    assert.ok(
      finalCsvText.includes('KAMCH-2022-0301,UHS22BAMS301,Gauri Deshpande,30,24,CALCULATED,24,,Approved (As Calculated),No')
    );
    assert.ok(
      finalCsvText.includes('KAMCH-2022-0302,UHS22BAMS302,Harsha Pai,30,17,CALCULATED,,,Awaiting Office Approval,Yes')
    );

    // 12d. Mark batch inactive & department inactive -> verify historical reports & exports remain preserved!
    const targetMemBatch = memDb.academicBatches.find((b) => b.id === batchId);
    if (targetMemBatch) {
      targetMemBatch.is_active = false;
    } else {
      await pool.query(`UPDATE academic_batches SET is_active = FALSE WHERE id = ?`, [batchId]);
    }
    await fetch(`${apiBase}/users/departments/${samhitaDeptId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: saSession.cookieHeader,
        'X-CSRF-Token': saSession.csrfToken,
      },
      body: JSON.stringify({
        code: 'SAMHITA_SIDDHANTA',
        name: 'Department of Samhita & Siddhanta',
        description: 'Deactivated for historical preservation test',
        isActive: false,
      }),
    });

    const histBatchReportRes = await fetch(
      `${apiBase}/internal-assessment/reports/final-ia?batchId=${batchId}&departmentId=${samhitaDeptId}&subjectId=${samhita1.id}`,
      { headers: { Cookie: officeSession.cookieHeader } }
    );
    assert.equal(histBatchReportRes.status, 200, 'Historical report for inactive batch/dept must succeed');
    const histBatchReport = (await histBatchReportRes.json()).report;
    assert.equal(histBatchReport.batch.isActive, false);
    assert.equal(histBatchReport.department.isActive, false);
    assert.equal(histBatchReport.students.length, 4);
    console.log('✓ [12/13] Printable report model, UTF-8 BOM Excel CSV exports & inactive batch preservation verified');

    // =========================================================================
    // CHECK 13: Existing ERP modules work without regression
    // =========================================================================
    // 13a. Auth Login (also enforces single-active-session invalidation of prior session)
    const loginRes = await fetch(`${apiBase}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernameOrEmail: 'office_verify_2f', password: plainPw }),
    });
    assert.equal(loginRes.status, 200, 'Authentication login endpoint must work');
    const freshOfficeCookieHeader = loginRes.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    assert.ok(freshOfficeCookieHeader.includes('kamch_session='), 'Login must set kamch_session cookie');

    // 13b. User Management
    const usersListRes = await fetch(`${apiBase}/users`, {
      headers: { Cookie: saSession.cookieHeader },
    });
    assert.equal(usersListRes.status, 200, 'User Management directory must work');

    // 13c. Student Management
    const studentsListRes = await fetch(`${apiBase}/students`, {
      headers: { Cookie: freshOfficeCookieHeader },
    });
    assert.equal(studentsListRes.status, 200, 'Student Management directory must work');
    const studentsListJson = await studentsListRes.json();
    assert.equal(studentsListJson.students.length, 8);

    // 13d. Fees Management (accessible to Office; blocked with 403 for Department role)
    const feesOfficeRes = await fetch(`${apiBase}/fees/structures`, {
      headers: { Cookie: freshOfficeCookieHeader },
    });
    assert.equal(feesOfficeRes.status, 200, 'Fees Management structures endpoint must work for Office');

    const feesDeptBlockedRes = await fetch(`${apiBase}/fees/structures`, {
      headers: { Cookie: samhitaDeptSession.cookieHeader },
    });
    assert.equal(feesDeptBlockedRes.status, 403, 'Fees Management must remain blocked for Department accounts');

    // 13e. Teacher / Faculty Records
    const teachersCheckRes = await fetch(`${apiBase}/teachers`, {
      headers: { Cookie: freshOfficeCookieHeader },
    });
    assert.equal(teachersCheckRes.status, 200, 'Teacher/Faculty Records endpoint must work');
    console.log('✓ [13/13] Existing ERP modules (Auth, Users, Students, Fees, Teacher Records) verified with zero regression');

    console.log('\nALL 13 COMBINED DEPARTMENT & INTERNAL ASSESSMENT VERIFICATION CHECKS PASSED!');
  } finally {
    memDb.restoreSnapshot(initialSnapshot);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runFinalVerificationSuite().catch((err) => {
  console.error('\n[STEP 2F FINAL VERIFICATION FAILED]:', err);
  process.exit(1);
});
