import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
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
import { deriveProgressionViewState } from '../src/components/students/progressionViewModel.ts';

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

async function loginAndSetupPassword(
  baseUrl: string,
  username: string,
  tempPassword: string,
  permPassword: string
) {
  const firstLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernameOrEmail: username, password: tempPassword }),
  });
  const firstData = await firstLogin.json();
  const firstCookies = extractCookies(firstLogin);
  const headers = makeHeaders(firstCookies.session, firstData.csrfToken);

  if (firstData.user?.mustChangePassword) {
    const changeRes = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        currentPassword: tempPassword,
        newPassword: permPassword,
      }),
    });
    if (changeRes.status !== 200) {
      throw new Error(`Password setup failed for ${username}`);
    }
  }
  return headers;
}

async function runStudentManagementTests() {
  console.log('==============================================================');
  console.log('KAMCH ERP — STUDENT MANAGEMENT MODULE COMPREHENSIVE TEST SUITE');
  console.log('==============================================================\n');

  await checkDatabaseConnection();

  const memDb = MemoryDatabase.getInstance();
  const saTempPwd = genSecret('SATemp');
  const saPermPwd = genSecret('SAPerm');

  memDb.provisionInitialSuperAdmin({
    username: 'superadmin',
    email: 'admin@kamch.ac.in',
    password: saTempPwd,
    mustChangePassword: true,
  });

  const app = express();
  app.use(express.json({ limit: '5mb' }));
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
      console.error(`[FAIL] ${testName}${detail ? ` — ${detail}` : ''}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------------------
    // 1. Additive Migration Artifacts & Idempotency Guard Check
    // -------------------------------------------------------------------------
    console.log('--- 1. Migration Artifacts & Additive Schema Safety ---');
    const sqlPath = path.resolve(process.cwd(), 'server/db/migrations/student_management_v1.sql');
    const migrateTsPath = path.resolve(process.cwd(), 'server/db/migrate.ts');
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8');
    const migrateTsContent = fs.readFileSync(migrateTsPath, 'utf-8');

    const normalizedSql = sqlContent.replace(/`/g, '');
    assert(
      normalizedSql.includes('CREATE TABLE IF NOT EXISTS curriculum_schemes') &&
        normalizedSql.includes('CREATE TABLE IF NOT EXISTS academic_batches') &&
        normalizedSql.includes('CREATE TABLE IF NOT EXISTS student_roll_sequences') &&
        normalizedSql.includes('CREATE TABLE IF NOT EXISTS student_identifier_history') &&
        normalizedSql.includes('CREATE TABLE IF NOT EXISTS student_progression_events') &&
        normalizedSql.includes('CREATE TABLE IF NOT EXISTS student_internships') &&
        !/^\s*(DROP\s+TABLE|TRUNCATE)/im.test(normalizedSql),
      'Migration SQL defines all additive Student Management tables with zero DROP/TRUNCATE statements'
    );
    assert(
      migrateTsContent.includes('student_management_v1') &&
        migrateTsContent.includes('columnExists') &&
        migrateTsContent.includes('indexExists'),
      'TypeScript migration runner uses idempotent INFORMATION_SCHEMA checks for MariaDB/MySQL compatibility'
    );

    // -------------------------------------------------------------------------
    // Setup Role Accounts (Super Admin, Principal, Secretary, Office, Dept, Library)
    // -------------------------------------------------------------------------
    const saHeaders = await loginAndSetupPassword(baseUrl, 'superadmin', saTempPwd, saPermPwd);

    const rolesRes = await fetch(`${baseUrl}/api/users/roles`, { headers: saHeaders });
    const rolesData = await rolesRes.json();
    const roleMap = new Map<string, number>();
    for (const r of rolesData.assignableRoles) {
      roleMap.set(r.code, r.id);
    }

    const deptRes = await fetch(`${baseUrl}/api/users/departments`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({ code: 'DRAVYAGUNA', name: 'Dravyaguna', description: 'Pharmacology' }),
    });
    const deptId = (await deptRes.json()).department.id;

    async function createRoleUser(username: string, roleCode: string, departmentId?: number) {
      const tPwd = genSecret(`T_${username}`);
      const pPwd = genSecret(`P_${username}`);
      const res = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: saHeaders,
        body: JSON.stringify({
          username,
          fullName: `${username} Official`,
          roleId: roleMap.get(roleCode),
          departmentId: departmentId || null,
          initialPassword: tPwd,
          confirmPassword: tPwd,
        }),
      });
      if (res.status !== 201) {
        throw new Error(`Failed creating ${username}: ${await res.text()}`);
      }
      return loginAndSetupPassword(baseUrl, username, tPwd, pPwd);
    }

    const principalHeaders = await createRoleUser('principal_sm', 'PRINCIPAL');
    const secretaryHeaders = await createRoleUser('secretary_sm', 'SECRETARY');
    const officeHeaders = await createRoleUser('office_sm', 'OFFICE');
    const deptHeaders = await createRoleUser('dept_sm', 'DEPARTMENT', deptId);
    const libraryHeaders = await createRoleUser('library_sm', 'LIBRARY');

    // -------------------------------------------------------------------------
    // 2. Role Access Boundaries & Hard Delete Protection
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Role Access Boundaries & Non-Destructive Guards ---');
    const deptBlocked = await fetch(`${baseUrl}/api/students`, { headers: deptHeaders });
    assert(deptBlocked.status === 403, 'Department shared account is blocked (403) from Student Management API');

    const libBlocked = await fetch(`${baseUrl}/api/students`, { headers: libraryHeaders });
    assert(libBlocked.status === 403, 'Library account is blocked (403) from Student Management API');

    // -------------------------------------------------------------------------
    // 3. Seeded Curriculum Schemes, Batches & Inactive Batch Guard
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Curriculum Schemes, Batches & Inactive Intake Guard ---');
    const schemesRes = await fetch(`${baseUrl}/api/students/schemes`, { headers: officeHeaders });
    const schemesData = await schemesRes.json();
    const rs6Scheme = schemesData.schemes.find((s: any) => s.code === 'RS6');
    const rs7Scheme = schemesData.schemes.find((s: any) => s.code === 'RS7');
    assert(
      schemesRes.status === 200 && Boolean(rs6Scheme?.isLegacyMinimal) && Boolean(rs7Scheme && !rs7Scheme.isLegacyMinimal),
      'Curriculum schemes RS6 (legacy minimal) and RS7 (3-prof-year NCISM) are seeded and accessible'
    );

    // Ensure RS7 passingCriteriaVerified is enabled by Principal so subject-level progression proposals run
    if (!rs7Scheme.passingCriteriaVerified) {
      const verifySchemeRes = await fetch(`${baseUrl}/api/students/schemes/${rs7Scheme.id}`, {
        method: 'PUT',
        headers: principalHeaders,
        body: JSON.stringify({ passingCriteriaVerified: true }),
      });
      assert(verifySchemeRes.status === 200, 'Principal marks RS7 passing criteria verified for progression evaluation');
    }

    const batchesRes = await fetch(`${baseUrl}/api/students/batches`, { headers: officeHeaders });
    const batchesData = await batchesRes.json();
    const batchByCode = new Map<string, any>();
    for (const b of batchesData.batches) {
      batchByCode.set(b.code, b);
    }
    assert(
      (batchByCode.has('RS6_LEGACY') || batchByCode.has('RS6')) &&
        batchByCode.has('MRUTYUNJAYA') &&
        batchByCode.has('AGASTYA') &&
        batchByCode.has('DAKSHA') &&
        batchByCode.has('AGNIVESH') &&
        batchByCode.has('VEDANG') &&
        batchByCode.has('NEW_INTAKE_PENDING'),
      'All official KAMCH batches (RS6, Mrutyunjaya, Agastya, Daksha, Agnivesh, Vedang, and inactive New Intake placeholder) exist'
    );

    const pendingBatch = batchByCode.get('NEW_INTAKE_PENDING');
    assert(pendingBatch.isActive === false, 'New Intake placeholder batch starts inactive');

    // Attempt to register student into inactive batch -> blocked
    const regInactiveRes = await fetch(`${baseUrl}/api/students`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        fullName: 'Premature Applicant',
        originalBatchId: pendingBatch.id,
        admissionCategory: 'GOVERNMENT',
        admissionYear: 2026,
      }),
    });
    const regInactiveErr = await regInactiveRes.json();
    assert(
      regInactiveRes.status === 400 && regInactiveErr.code === 'INACTIVE_BATCH_PLACEMENT',
      'Blocks premature student registration into inactive placeholder batch'
    );

    // Attempt to activate placeholder batch without renaming -> blocked
    const activateUnassignedRes = await fetch(`${baseUrl}/api/students/batches/${pendingBatch.id}`, {
      method: 'PUT',
      headers: principalHeaders,
      body: JSON.stringify({ isActive: true }),
    });
    const activateUnassignedErr = await activateUnassignedRes.json();
    assert(
      activateUnassignedRes.status === 400 && activateUnassignedErr.code === 'PREMATURE_BATCH_ACTIVATION',
      'Blocks activating New Intake batch before official batch name is assigned'
    );

    // -------------------------------------------------------------------------
    // 4. Manual Registration, Server-Side Unique Temporary Roll Numbers & Concurrency
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Manual Registration, Unique Temporary Roll Sequence & Concurrency ---');
    const userCountBefore = memDb.users.length;
    const agastyaBatch = batchByCode.get('AGASTYA');
    const dakshaBatch = batchByCode.get('DAKSHA');
    const agniveshBatch = batchByCode.get('AGNIVESH');
    const mrutyunjayaBatch = batchByCode.get('MRUTYUNJAYA');
    const rs6Batch = batchByCode.get('RS6_LEGACY') || batchByCode.get('RS6');

    // Concurrent registrations in same admission year must produce unique sequential KAMCH-YYYY-NNNN roll numbers
    const [conc1Res, conc2Res, conc3Res] = await Promise.all([
      fetch(`${baseUrl}/api/students`, {
        method: 'POST',
        headers: officeHeaders,
        body: JSON.stringify({
          studentIdNumber: 'CLIENT-FAKE-001', // Must be ignored in favor of server sequence
          fullName: 'Ananya Kulkarni',
          gender: 'FEMALE',
          dateOfBirth: '2005-04-12',
          contactPhone: '9845011101',
          contactEmail: 'ananya.k@kamch.edu.in',
          fatherName: 'Raghavendra Kulkarni',
          motherName: 'Suma Kulkarni',
          fatherPhone: '9845099901',
          emergencyContactName: 'Raghavendra Kulkarni',
          emergencyContactRelationship: 'Father',
          emergencyContactPhone: '9845099901',
          admissionQuota: 'GOVERNMENT',
          seatCategory: '2A',
          admissionYear: 2024,
          admissionDate: '2024-09-10',
          originalBatchId: agastyaBatch.id,
          currentYearOfStudy: 1,
        }),
      }),
      fetch(`${baseUrl}/api/students`, {
        method: 'POST',
        headers: officeHeaders,
        body: JSON.stringify({
          fullName: 'Siddharth Deshpande',
          gender: 'MALE',
          dateOfBirth: '2005-07-19',
          contactPhone: '9845011102',
          admissionQuota: 'MANAGEMENT_PRIVATE',
          seatCategory: 'GM',
          admissionYear: 2024,
          originalBatchId: agastyaBatch.id,
          currentYearOfStudy: 1,
        }),
      }),
      fetch(`${baseUrl}/api/students`, {
        method: 'POST',
        headers: secretaryHeaders,
        body: JSON.stringify({
          fullName: 'Meera Hegde',
          gender: 'FEMALE',
          dateOfBirth: '2005-11-03',
          contactPhone: '9845011103',
          admissionQuota: 'NRI',
          seatCategory: 'NRI_GENERAL',
          admissionYear: 2024,
          originalBatchId: agastyaBatch.id,
          currentYearOfStudy: 1,
        }),
      }),
    ]);

    const s1 = (await conc1Res.json()).student;
    const s2 = (await conc2Res.json()).student;
    const s3 = (await conc3Res.json()).student;

    const generatedRolls = new Set([s1.temporaryRollNumber, s2.temporaryRollNumber, s3.temporaryRollNumber]);
    assert(
      conc1Res.status === 201 &&
        conc2Res.status === 201 &&
        conc3Res.status === 201 &&
        generatedRolls.size === 3 &&
        /^KAMCH-2024-\d{4}$/.test(s1.temporaryRollNumber) &&
        s1.studentIdNumber === s1.temporaryRollNumber,
      `Concurrent registrations generated 3 distinct server-side KAMCH-2024-NNNN roll numbers (${Array.from(generatedRolls).join(', ')}) and ignored client roll input`
    );
    assert(memDb.users.length === userCountBefore, 'Student registration never creates a user login account');

    // Hard delete blocked
    const hardDelRes = await fetch(`${baseUrl}/api/students/${s1.id}`, {
      method: 'DELETE',
      headers: saHeaders,
    });
    assert(hardDelRes.status === 403, 'Hard deletion DELETE /api/students/:id is blocked (403) even for Super Admin');

    // -------------------------------------------------------------------------
    // 5. Admission Quota vs Seat Category Separation & Governance
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Admission Quota vs Seat Category Separation ---');
    assert(
      s1.admissionQuota === 'GOVERNMENT' && s1.seatCategory === '2A',
      'Admission Quota (GOVERNMENT) and Seat Category (2A) are stored and returned as distinct fields'
    );

    // Office can update Seat Category or phone, but is blocked (403) from changing Admission Quota
    const officeSeatCatUpdate = await fetch(`${baseUrl}/api/students/${s1.id}`, {
      method: 'PUT',
      headers: officeHeaders,
      body: JSON.stringify({ fullName: s1.fullName, seatCategory: '3B', contactPhone: '9845011199' }),
    });
    assert(officeSeatCatUpdate.status === 200, 'Office can update Seat Category and contact phone');

    const officeQuotaBlocked = await fetch(`${baseUrl}/api/students/${s1.id}`, {
      method: 'PUT',
      headers: officeHeaders,
      body: JSON.stringify({ fullName: s1.fullName, admissionCategory: 'MANAGEMENT_PRIVATE' }),
    });
    assert(
      officeQuotaBlocked.status === 403,
      'Office is blocked (403 FORBIDDEN_CATEGORY_CHANGE) from altering registered Admission Quota'
    );

    // -------------------------------------------------------------------------
    // 6. Duplicate Candidate Warning & Documented Override
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Duplicate Candidate Detection & Override ---');
    const dupCandidateRes = await fetch(`${baseUrl}/api/students`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        fullName: 'Ananya Kulkarni',
        dateOfBirth: '2005-04-12',
        admissionQuota: 'GOVERNMENT',
        admissionYear: 2024,
        originalBatchId: agastyaBatch.id,
      }),
    });
    const dupCandidateData = await dupCandidateRes.json();
    assert(
      dupCandidateRes.status === 409 &&
        dupCandidateData.code === 'POTENTIAL_DUPLICATE_STUDENT' &&
        dupCandidateData.duplicateCandidates?.length >= 1,
      'Detects potential duplicate student candidate (matching name + DOB) and returns 409 warning'
    );

    const dupOverrideWithoutReason = await fetch(`${baseUrl}/api/students`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        fullName: 'Ananya Kulkarni',
        dateOfBirth: '2005-04-12',
        admissionQuota: 'GOVERNMENT',
        admissionYear: 2024,
        originalBatchId: agastyaBatch.id,
        allowDuplicateOverride: true,
        duplicateOverrideReason: '',
      }),
    });
    assert(dupOverrideWithoutReason.status === 409, 'Duplicate override is rejected unless documented reason is provided');

    // -------------------------------------------------------------------------
    // 7. Permanent RGUHS University Number Lifecycle & Fees Preservation
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Permanent University Registration Number & Fees Linkage ---');
    // Record a fee payment BEFORE university number replacement to verify FK stability
    const feesListBefore = await (await fetch(`${baseUrl}/api/fees/students`, { headers: officeHeaders })).json();
    const feeTarget = feesListBefore.students.find((st: any) => st.id === s1.id);
    assert(Boolean(feeTarget?.currentAssessment?.id), 'Registered RS7 student automatically receives initial fee assessment');

    const feePayRes = await fetch(`${baseUrl}/api/fees/payments`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        studentId: s1.id,
        assessmentId: feeTarget.currentAssessment.id,
        amount: 45000,
        destination: 'COLLEGE_ACCOUNT',
        paymentMethod: 'CASH',
        paymentDate: '2026-10-24',
      }),
    });
    assert(feePayRes.status === 201, 'Cash payment recorded against student before university number verification');

    const formerTempRoll = s1.temporaryRollNumber;

    // Enter RGUHS number (unverified) -> active studentIdNumber remains temporary roll number!
    const enterUniRes = await fetch(`${baseUrl}/api/students/${s1.id}/university-number`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        permanentUniversityNumber: '24A001234',
        verifyNow: false,
        reason: 'Received RGUHS provisional allotment list',
      }),
    });
    const afterEnterData = await enterUniRes.json();
    assert(
      enterUniRes.status === 200 &&
        afterEnterData.universityRegStatus === 'PENDING_VERIFICATION' &&
        afterEnterData.studentIdNumber === formerTempRoll,
      'Entering unverified RGUHS number keeps temporary roll number as active displayed ID until verified'
    );

    // Duplicate RGUHS number on another student -> blocked 409
    const dupUniRes = await fetch(`${baseUrl}/api/students/${s2.id}/university-number`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        permanentUniversityNumber: '24A001234',
      }),
    });
    assert(dupUniRes.status === 409, 'Blocks assigning duplicate RGUHS university registration number to another student');

    // Verify RGUHS number -> promotes 24A001234 to active student_id_number and preserves former temporary roll in history
    const verifyUniRes = await fetch(`${baseUrl}/api/students/${s1.id}/university-number/verify`, {
      method: 'PATCH',
      headers: principalHeaders,
      body: JSON.stringify({ reason: 'Verified against official RGUHS eligibility ledger' }),
    });
    const verifyUniData = await verifyUniRes.json();
    const afterVerifyProfile = await (
      await fetch(`${baseUrl}/api/students/${s1.id}`, { headers: officeHeaders })
    ).json();
    assert(
      verifyUniRes.status === 200 &&
        verifyUniData.universityRegStatus === 'VERIFIED' &&
        afterVerifyProfile.student.studentIdNumber === '24A001234' &&
        afterVerifyProfile.student.temporaryRollNumber === formerTempRoll &&
        afterVerifyProfile.identifierHistory.length >= 2,
      'Verifying RGUHS number promotes it to active studentIdNumber while preserving temporaryRollNumber and identifier history'
    );

    // Searchable by BOTH verified RGUHS number and former temporary roll number
    const searchByRguhs = await (
      await fetch(`${baseUrl}/api/students?search=24A001234`, { headers: officeHeaders })
    ).json();
    const searchByFormerTemp = await (
      await fetch(`${baseUrl}/api/students?search=${encodeURIComponent(formerTempRoll)}`, { headers: officeHeaders })
    ).json();
    assert(
      searchByRguhs.students.some((st: any) => st.id === s1.id) &&
        searchByFormerTemp.students.some((st: any) => st.id === s1.id),
      'Student remains searchable by BOTH current RGUHS university number and former temporary roll number'
    );

    // Check Fees summary in Student Profile reflects exact ₹45,000 paid and ₹80,750 balance without breaking FK
    assert(
      afterVerifyProfile.feesSummary.totalVerifiedPaid === 45000 &&
        afterVerifyProfile.feesSummary.outstandingBalance === 80750 &&
        afterVerifyProfile.feesSummary.recentPayments.length === 1,
      'Fees Management ledger & Student Profile read-only Fees Summary remain intact after university number replacement'
    );

    // -------------------------------------------------------------------------
    // 8. RS6 Legacy Minimal Handling & Guard Against RS7 Automatic Progression
    // -------------------------------------------------------------------------
    console.log('\n--- 8. RS6 Legacy Batch Minimal Profile & Progression Guard ---');
    const rs6RegRes = await fetch(`${baseUrl}/api/students`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        fullName: 'Dr. Rameshwar Bhat (RS6 Cohort)',
        originalBatchId: rs6Batch.id,
        admissionQuota: 'GOVERNMENT',
        admissionYear: 2019,
        rs6AcademicSummary: 'Completed Final Year BAMS under RS6 regulation',
        rs6InternshipCompleted: false,
      }),
    });
    const rs6Student = (await rs6RegRes.json()).student;
    assert(
      rs6RegRes.status === 201 && rs6Student.isLegacyMinimal === true && rs6Student.rs6InternshipCompleted === false,
      'RS6 student registered with minimal legacy profile without requiring full RS7 parent/address fields'
    );

    // Update RS6 1-year internship completion boolean
    const rs6UpdateRes = await fetch(`${baseUrl}/api/students/${rs6Student.id}`, {
      method: 'PUT',
      headers: officeHeaders,
      body: JSON.stringify({
        fullName: 'Dr. Rameshwar Bhat (RS6 Cohort)',
        rs6InternshipCompleted: true,
        rs6AcademicSummary: 'Completed Final Year BAMS & 1-Year Compulsory Rotatory Internship (RS6)',
      }),
    });
    const rs6DetailAfter = await (
      await fetch(`${baseUrl}/api/students/${rs6Student.id}`, { headers: officeHeaders })
    ).json();
    assert(
      rs6UpdateRes.status === 200 && rs6DetailAfter.student.rs6InternshipCompleted === true,
      'RS6 minimal record allows recording 1-year internship completion boolean'
    );

    // Guard: RS7 automatic progression engine does NOT automatically promote RS6 legacy students
    const rs6ProgAttempt = await fetch(`${baseUrl}/api/students/${rs6Student.id}/progression/evaluate`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        examSessionRef: 'RS6 Legacy Check',
        examAttemptType: 'REGULAR',
        evaluatedProfessionalYear: 1,
        subjects: [{ subjectCode: 'PADARTHA', subjectName: 'Padartha Vigyana', overallResult: 'PASS' }],
      }),
    });
    const rs6ProgData = await rs6ProgAttempt.json();
    assert(
      rs6ProgData.proposal?.placementRuleApplied === 'RS6_LEGACY_SCHEME_GUARD' &&
        rs6ProgData.proposal?.workflowState === 'PENDING_OFFICE_REVIEW',
      'Guards RS6 legacy students from automatic RS7 3-professional-year progression rules'
    );

    // -------------------------------------------------------------------------
    // 9. Document Metadata Checklist (No File/Photo Uploads)
    // -------------------------------------------------------------------------
    console.log('\n--- 9. Admission Document Checklist Metadata ---');
    const addDocRes = await fetch(`${baseUrl}/api/students/${s1.id}/documents`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        documentType: 'NEET_SCORECARD',
        documentLabel: 'NEET UG Rank Card',
        referenceNumber: 'NEET-2024-889120',
        receivedStatus: 'RECEIVED',
        verificationStatus: 'VERIFIED',
        issueDate: '2024-06-05',
        remarks: 'Original verified at admission desk',
      }),
    });
    assert(addDocRes.status === 201, 'Records structured admission document metadata without file/photo upload');

    // -------------------------------------------------------------------------
    // 10. CSV Template, Preview Validation, Cancel, Atomic Rollback & Commit, Export
    // -------------------------------------------------------------------------
    console.log('\n--- 10. CSV Bulk Import (Preview, Cancel, Atomic Rollback, Commit) & Export ---');
    const tplRes = await fetch(`${baseUrl}/api/students/import/template`, { headers: officeHeaders });
    const tplText = await tplRes.text();
    assert(
      tplRes.status === 200 &&
        tplText.includes('full_name') &&
        tplText.includes('admission_quota') &&
        tplText.includes('seat_category'),
      'Downloads official Student CSV import template'
    );

    const countBeforePreview = memDb.students.length;
    const validAndInvalidCsv = [
      'full_name,gender,date_of_birth,contact_phone,contact_email,admission_quota,seat_category,admission_academic_year,batch_code,permanent_university_number',
      'Kavya Nair,FEMALE,2006-02-14,9900112233,kavya@kamch.edu.in,GOVERNMENT,GM,2025-2026,AGNIVESH,',
      'Invalid Row Student,MALE,2006-05-10,9900112244,bad@kamch.edu.in,INVALID_QUOTA,GM,2025-2026,UNKNOWN_BATCH,',
    ].join('\n');

    const previewRes = await fetch(`${baseUrl}/api/students/import/preview`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({ csvContent: validAndInvalidCsv }),
    });
    const previewData = await previewRes.json();
    assert(
      previewRes.status === 200 &&
        previewData.validCount === 1 &&
        previewData.errorCount >= 1 &&
        previewData.canCommit === false &&
        memDb.students.length === countBeforePreview,
      'CSV preview reports row-level validation errors accurately and writes ZERO database records (safe cancel)'
    );

    // Attempt atomic commit with mixed valid + invalid row -> must reject & write ZERO partial rows!
    const failedCommitRes = await fetch(`${baseUrl}/api/students/import/commit`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({ csvContent: validAndInvalidCsv }),
    });
    assert(
      failedCommitRes.status === 400 && memDb.students.length === countBeforePreview,
      'CSV commit with an invalid row aborts atomically with ZERO partial student rows written'
    );

    // Intra-CSV duplicate university registration number -> rejected with zero partial writes
    const collidingUniCsv = [
      'full_name,gender,date_of_birth,contact_phone,admission_quota,seat_category,admission_academic_year,batch_code,permanent_university_number',
      'Rohit Menon,MALE,2006-01-11,9900221101,GOVERNMENT,GM,2025-2026,AGNIVESH,25A99001',
      'Nikhil Verma,MALE,2006-03-22,9900221102,GOVERNMENT,GM,2025-2026,AGNIVESH,25A99001',
    ].join('\n');
    const collidingCommitRes = await fetch(`${baseUrl}/api/students/import/commit`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({ csvContent: collidingUniCsv }),
    });
    assert(
      collidingCommitRes.status === 400 && memDb.students.length === countBeforePreview,
      'Duplicate university number inside CSV batch is rejected with zero partial writes'
    );

    // Valid multi-row CSV import (with blank permanent_university_number to prove no fake university number is fabricated)
    const validCsv = [
      'full_name,gender,date_of_birth,contact_phone,contact_email,admission_quota,seat_category,admission_academic_year,batch_code,permanent_university_number',
      'Kavya Nair,FEMALE,2006-02-14,9900112233,kavya@kamch.edu.in,GOVERNMENT,GM,2025-2026,AGNIVESH,',
      'Pranav Hegde,MALE,2006-08-21,9900112234,pranav@kamch.edu.in,MANAGEMENT_PRIVATE,3A,2025-2026,VEDANG,25A77889',
    ].join('\n');

    const commitRes = await fetch(`${baseUrl}/api/students/import/commit`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({ csvContent: validCsv }),
    });
    const commitData = await commitRes.json();
    assert(
      commitRes.status === 201 && commitData.importedCount === 2,
      'Valid CSV bulk import commits all rows atomically'
    );

    const kavyaRow = memDb.students.find((st) => st.full_name === 'Kavya Nair')!;
    const pranavRow = memDb.students.find((st) => st.full_name === 'Pranav Hegde')!;
    assert(
      kavyaRow.permanent_university_number === null &&
        kavyaRow.university_reg_status === 'NOT_ENTERED' &&
        /^KAMCH-\d{4}-\d{4}$/.test(String(kavyaRow.temporary_roll_number || '')) &&
        pranavRow.permanent_university_number === '25A77889' &&
        pranavRow.university_reg_status === 'PENDING_VERIFICATION' &&
        pranavRow.student_id_number === pranavRow.temporary_roll_number,
      'CSV import generates temporary roll numbers, never fabricates missing university numbers, and keeps imported unverified university numbers pending verification'
    );

    // CSV Export respecting batch filter
    const exportCsvRes = await fetch(
      `${baseUrl}/api/students/export/csv?batchId=${agniveshBatch.id}&batchScope=ORIGINAL`,
      { headers: officeHeaders }
    );
    const exportCsvText = await exportCsvRes.text();
    assert(
      exportCsvRes.status === 200 &&
        exportCsvText.includes('Kavya Nair') &&
        !exportCsvText.includes('Pranav Hegde'),
      'CSV export respects active batch filter accurately'
    );

    // -------------------------------------------------------------------------
    // 11. Academic Progression Engine — Subject-Level Aggregation & All Rules
    // -------------------------------------------------------------------------
    console.log('\n--- 11. Academic Progression Engine (Rules 1–6, Split-Term & Pending Review) ---');

    // A) Subject-level failure aggregation test on Student s2 (Siddharth Deshpande, Year 1 Agastya):
    // Failing Paper 1 + Paper 2 + Practical of ONE subject (RACHANA) = 1 failed subject (NOT 3!)
    // -> Should propose PROVISIONALLY_PROMOTED_WITH_BACKLOGS, NOT detention!
    const multiPaperEvalRes = await fetch(`${baseUrl}/api/students/${s2.id}/progression/evaluate`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        examAttemptType: 'REGULAR',
        evaluatedProfessionalYear: 1,
        examSessionRef: 'RGUHS Nov 2025 Regular',
        subjects: [
          { subjectCode: 'SAMHITA_1', subjectName: 'Samhita Adhyayana I', overallResult: 'PASS' },
          {
            subjectCode: 'PADARTHA',
            subjectName: 'Padartha Vigyana',
            papers: [
              { paperCode: 'P1', status: 'PASS' },
              { paperCode: 'P2', status: 'PASS' },
            ],
          },
          { subjectCode: 'KRIYA', subjectName: 'Kriya Sharira', overallResult: 'PASS' },
          {
            subjectCode: 'RACHANA',
            subjectName: 'Rachana Sharira',
            practicalStatus: 'FAIL',
            papers: [
              { paperCode: 'PAPER_1', status: 'FAIL' },
              { paperCode: 'PAPER_2', status: 'FAIL' },
            ],
          },
        ],
      }),
    });
    const multiPaperData = await multiPaperEvalRes.json();
    assert(
      multiPaperEvalRes.status === 201 &&
        multiPaperData.proposal.subjectsOutstanding.length === 1 &&
        multiPaperData.proposal.proposedStatus === 'PROVISIONALLY_PROMOTED_WITH_BACKLOGS' &&
        multiPaperData.proposal.proposedProfessionalYear === 2,
      'Failing multiple papers/practicals of the SAME subject counts as 1 failed subject (proposes Provisional Promotion with Backlogs, not Detention)'
    );

    // Confirm provisional promotion for s2 -> moves to Year 2 with 1 active backlog
    const confirmS2Promo = await fetch(
      `${baseUrl}/api/students/${s2.id}/progression/${multiPaperData.eventId}/confirm`,
      {
        method: 'POST',
        headers: principalHeaders,
        body: JSON.stringify({ remarks: 'Confirmed provisional promotion to II Prof BAMS with Rachana backlog' }),
      }
    );
    const s2DetailAfterPromo = await (
      await fetch(`${baseUrl}/api/students/${s2.id}`, { headers: officeHeaders })
    ).json();
    assert(
      confirmS2Promo.status === 200 &&
        s2DetailAfterPromo.student.currentYearOfStudy === 2 &&
        s2DetailAfterPromo.student.progressionStatus === 'PROVISIONALLY_PROMOTED_WITH_BACKLOGS' &&
        s2DetailAfterPromo.student.outstandingBacklogsCount === 1,
      'Confirming Rule 2 updates student to Year 2 PROVISIONALLY_PROMOTED_WITH_BACKLOGS with outstandingBacklogsCount = 1'
    );

    // B) Detention Lifecycle on Student s3 (Meera Hegde, Original Batch = AGASTYA -> Junior = DAKSHA -> Next Junior = AGNIVESH):
    // Step B1: Regular Exam with 3 failed subjects -> Stage 1 Detention (DETAINED_ODD_BATCH)
    const stage1EvalRes = await fetch(`${baseUrl}/api/students/${s3.id}/progression/evaluate`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        examAttemptType: 'REGULAR',
        evaluatedProfessionalYear: 1,
        examSessionRef: 'RGUHS Nov 2025 Regular',
        subjects: [
          { subjectCode: 'PADARTHA', subjectName: 'Padartha Vigyana', overallResult: 'FAIL' },
          { subjectCode: 'KRIYA', subjectName: 'Kriya Sharira', overallResult: 'FAIL' },
          { subjectCode: 'RACHANA', subjectName: 'Rachana Sharira', overallResult: 'FAIL' },
          { subjectCode: 'SAMHITA_1', subjectName: 'Samhita Adhyayana I', overallResult: 'PASS' },
        ],
      }),
    });
    const stage1Data = await stage1EvalRes.json();
    assert(
      stage1EvalRes.status === 201 &&
        stage1Data.proposal.subjectsOutstanding.length === 3 &&
        stage1Data.proposal.proposedStatus === 'DETAINED_ODD_BATCH' &&
        stage1Data.proposal.proposedDetentionStage === 1,
      'Rule 3: Regular exam with 3 failed subjects proposes Stage 1 Detention (DETAINED_ODD_BATCH)'
    );

    const stage1ConfirmRes = await fetch(
      `${baseUrl}/api/students/${s3.id}/progression/${stage1Data.eventId}/confirm`,
      {
        method: 'POST',
        headers: principalHeaders,
        body: JSON.stringify({ remarks: 'Confirmed Stage 1 odd-batch detention' }),
      }
    );
    const s3AfterStage1 = await (
      await fetch(`${baseUrl}/api/students/${s3.id}`, { headers: officeHeaders })
    ).json();
    assert(
      stage1ConfirmRes.status === 200 &&
        s3AfterStage1.student.detentionStage === 1 &&
        s3AfterStage1.student.progressionStatus === 'DETAINED_ODD_BATCH',
      'Confirmed Stage 1 Detention sets detentionStage = 1 and DETAINED_ODD_BATCH'
    );

    // Step B2: Supplementary Exam failure while in Stage 1 -> Stage 2 Double Detention (DOUBLE_DETAINED_SPLIT_TERM)
    // with Split-Term routing: Term 1 = immediate junior batch (DAKSHA), Terms 2 & 3 = original batch (AGASTYA)
    const stage2EvalRes = await fetch(`${baseUrl}/api/students/${s3.id}/progression/evaluate`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        examAttemptType: 'SUPPLEMENTARY',
        evaluatedProfessionalYear: 1,
        examSessionRef: 'RGUHS May 2026 Supplementary',
        subjects: [
          { subjectCode: 'PADARTHA', subjectName: 'Padartha Vigyana', overallResult: 'PASS' },
          { subjectCode: 'KRIYA', subjectName: 'Kriya Sharira', overallResult: 'PASS' },
          { subjectCode: 'RACHANA', subjectName: 'Rachana Sharira', overallResult: 'FAIL' },
        ],
      }),
    });
    const stage2Data = await stage2EvalRes.json();
    assert(
      stage2EvalRes.status === 201 &&
        stage2Data.proposal.proposedDetentionStage === 2 &&
        stage2Data.proposal.proposedStatus === 'DOUBLE_DETAINED_SPLIT_TERM' &&
        stage2Data.proposal.proposedPlacementBatchId === dakshaBatch.id &&
        stage2Data.proposal.classroomMapping?.mode === 'SPLIT_TERM' &&
        stage2Data.proposal.classroomMapping?.term1?.batchId === dakshaBatch.id &&
        stage2Data.proposal.classroomMapping?.term2?.batchId === agastyaBatch.id &&
        stage2Data.proposal.classroomMapping?.term3?.batchId === agastyaBatch.id,
      'Rule 4 & 5: Supplementary failure in Stage 1 proposes Stage 2 Double Detention with Split-Term mapping (Term 1 = Daksha, Terms 2 & 3 = Agastya)'
    );

    const stage2ConfirmRes = await fetch(
      `${baseUrl}/api/students/${s3.id}/progression/${stage2Data.eventId}/confirm`,
      {
        method: 'POST',
        headers: principalHeaders,
        body: JSON.stringify({ remarks: 'Confirmed Stage 2 split-term placement' }),
      }
    );
    const s3AfterStage2 = await (
      await fetch(`${baseUrl}/api/students/${s3.id}`, { headers: officeHeaders })
    ).json();
    assert(
      stage2ConfirmRes.status === 200 &&
        s3AfterStage2.student.originalBatchId === agastyaBatch.id &&
        s3AfterStage2.student.currentPlacementBatchId === dakshaBatch.id &&
        s3AfterStage2.student.classroomMapping?.mode === 'SPLIT_TERM' &&
        s3AfterStage2.student.classroomMapping?.term1?.batchId === dakshaBatch.id &&
        s3AfterStage2.student.classroomMapping?.term2?.batchId === agastyaBatch.id &&
        s3AfterStage2.student.classroomMapping?.term3?.batchId === agastyaBatch.id,
      'Stage 2 confirmation preserves Original Batch (Agastya) while routing Current Placement & Term 1 to Daksha and Terms 2 & 3 to Agastya'
    );

    // Verify Batch Cohort Filtering (`BOTH`, `DETAINED_OUT`, `DETAINED_IN`)
    const agastyaBoth = await (
      await fetch(`${baseUrl}/api/students?batchId=${agastyaBatch.id}&batchScope=BOTH`, { headers: officeHeaders })
    ).json();
    const s3InAgastya = agastyaBoth.students.find((st: any) => st.id === s3.id);

    const dakshaBoth = await (
      await fetch(`${baseUrl}/api/students?batchId=${dakshaBatch.id}&batchScope=BOTH`, { headers: officeHeaders })
    ).json();
    const s3InDaksha = dakshaBoth.students.find((st: any) => st.id === s3.id);

    assert(
      s3InAgastya?.batchRelationship === 'ORIGINAL_PLACED_IN_JUNIOR' &&
        s3InDaksha?.batchRelationship === 'PLACED_HERE_FROM_SENIOR',
      'Detained student appears in BOTH original cohort (Agastya) and current placement cohort (Daksha) with explicit relationship labels'
    );

    // Step B3: Subsequent Supplementary failure while in Stage 2 -> Stage 3 Detention (JUNIOR_TIMELINE_PLACEMENT)
    // placed in subsequent junior batch (AGNIVESH) for ALL terms (no split-term mapping!)
    const stage3EvalRes = await fetch(`${baseUrl}/api/students/${s3.id}/progression/evaluate`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        examAttemptType: 'SUPPLEMENTARY',
        evaluatedProfessionalYear: 1,
        examSessionRef: 'RGUHS Nov 2026 Supplementary',
        subjects: [{ subjectCode: 'RACHANA', subjectName: 'Rachana Sharira', overallResult: 'FAIL' }],
      }),
    });
    const stage3Data = await stage3EvalRes.json();
    assert(
      stage3EvalRes.status === 201 &&
        stage3Data.proposal.proposedDetentionStage === 3 &&
        stage3Data.proposal.proposedStatus === 'JUNIOR_TIMELINE_PLACEMENT' &&
        stage3Data.proposal.proposedPlacementBatchId === agniveshBatch.id &&
        stage3Data.proposal.classroomMapping?.mode === 'FULL_JUNIOR_COHORT' &&
        stage3Data.proposal.classroomMapping?.term1?.batchId === agniveshBatch.id &&
        stage3Data.proposal.classroomMapping?.term2?.batchId === agniveshBatch.id &&
        stage3Data.proposal.classroomMapping?.term3?.batchId === agniveshBatch.id,
      'Rule 6: Subsequent supplementary failure in Stage 2 proposes Stage 3 Detention in subsequent junior cohort (Agnivesh) for ALL terms without split-term mapping'
    );

    const stage3ConfirmRes = await fetch(
      `${baseUrl}/api/students/${s3.id}/progression/${stage3Data.eventId}/confirm`,
      {
        method: 'POST',
        headers: principalHeaders,
        body: JSON.stringify({ remarks: 'Confirmed Stage 3 full placement into Agnivesh cohort' }),
      }
    );
    const s3AfterStage3 = await (
      await fetch(`${baseUrl}/api/students/${s3.id}`, { headers: officeHeaders })
    ).json();
    assert(
      stage3ConfirmRes.status === 200 &&
        s3AfterStage3.student.originalBatchId === agastyaBatch.id &&
        s3AfterStage3.student.currentPlacementBatchId === agniveshBatch.id &&
        s3AfterStage3.student.classroomMapping?.mode === 'FULL_JUNIOR_COHORT' &&
        s3AfterStage3.progressionHistory.length >= 4, // INITIAL_ENROLLMENT + 3 confirmed exams
      'Stage 3 confirmation updates placement to Agnivesh for all terms and preserves full append-only progression history'
    );

    // C) Incomplete / Conflicting Result -> PENDING_OFFICE_REVIEW + Documented Office Correction
    const incompleteEvalRes = await fetch(`${baseUrl}/api/students/${s1.id}/progression/evaluate`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        examAttemptType: 'REGULAR',
        evaluatedProfessionalYear: 1,
        examSessionRef: 'RGUHS Nov 2025 Regular',
        subjects: [
          { subjectCode: 'PADARTHA', subjectName: 'Padartha Vigyana', overallResult: 'PASS' },
          { subjectCode: 'KRIYA', subjectName: 'Kriya Sharira', overallResult: 'INCOMPLETE' },
        ],
      }),
    });
    const incompleteData = await incompleteEvalRes.json();
    assert(
      incompleteEvalRes.status === 201 &&
        incompleteData.proposal.workflowState === 'PENDING_OFFICE_REVIEW' &&
        incompleteData.proposal.proposedStatus === 'PENDING_OFFICE_REVIEW',
      'Incomplete university subject result is flagged as PENDING_OFFICE_REVIEW'
    );

    // Direct confirmation on PENDING_OFFICE_REVIEW must be blocked -> requires resolve-review with documented reason
    const directConfirmBlocked = await fetch(
      `${baseUrl}/api/students/${s1.id}/progression/${incompleteData.eventId}/confirm`,
      {
        method: 'POST',
        headers: principalHeaders,
        body: JSON.stringify({ remarks: 'Try direct confirm' }),
      }
    );
    assert(directConfirmBlocked.status === 400, 'Blocks confirming a PENDING_OFFICE_REVIEW event without documented resolution');

    const resolveWithoutReason = await fetch(
      `${baseUrl}/api/students/${s1.id}/progression/${incompleteData.eventId}/resolve-review`,
      {
        method: 'POST',
        headers: officeHeaders,
        body: JSON.stringify({
          resolvedStatus: 'PASSED_AND_PROMOTED',
          proposedProfessionalYear: 2,
          reason: '',
        }),
      }
    );
    assert(resolveWithoutReason.status === 400, 'Office review resolution requires a non-empty documented reason');

    const resolveOk = await fetch(
      `${baseUrl}/api/students/${s1.id}/progression/${incompleteData.eventId}/resolve-review`,
      {
        method: 'POST',
        headers: officeHeaders,
        body: JSON.stringify({
          resolvedStatus: 'PASSED_AND_PROMOTED',
          proposedProfessionalYear: 2,
          proposedDetentionStage: 0,
          outstandingBacklogsCount: 0,
          reason: 'RGUHS released withheld Kriya Sharira mark sheet — student passed all subjects',
        }),
      }
    );
    const s1AfterResolve = await (
      await fetch(`${baseUrl}/api/students/${s1.id}`, { headers: officeHeaders })
    ).json();
    const supersededOriginal = s1AfterResolve.progressionHistory.find((e: any) => e.id === incompleteData.eventId);
    assert(
      resolveOk.status === 200 &&
        s1AfterResolve.student.currentYearOfStudy === 2 &&
        s1AfterResolve.student.progressionStatus === 'PASSED_AND_PROMOTED' &&
        supersededOriginal?.workflowState === 'SUPERSEDED',
      'Documented Office resolution supersedes original review event without deleting it and promotes student to Year 2'
    );

    // -------------------------------------------------------------------------
    // 12. Configurable Maximum Course Duration Governance (Principal-Only)
    // -------------------------------------------------------------------------
    console.log('\n--- 12. Principal-Only Maximum Course Duration Governance ---');
    const getDurationRes = await fetch(`${baseUrl}/api/students/settings/course-duration`, { headers: officeHeaders });
    const getDurationData = await getDurationRes.json();
    assert(
      getDurationRes.status === 200 && getDurationData.maxCourseDurationYears === 9,
      'Initial maximum course duration is seeded to 9 years'
    );

    // Office and Super Admin must be blocked (403 PRINCIPAL_AUTHORIZATION_REQUIRED) from changing Max Course Duration
    const officeDurBlocked = await fetch(`${baseUrl}/api/students/settings/course-duration`, {
      method: 'PUT',
      headers: officeHeaders,
      body: JSON.stringify({ maxCourseDurationYears: 10, effectiveDate: '2026-10-24', reason: 'Attempt by Office' }),
    });
    const saDurBlocked = await fetch(`${baseUrl}/api/students/settings/course-duration`, {
      method: 'PUT',
      headers: saHeaders,
      body: JSON.stringify({ maxCourseDurationYears: 10, effectiveDate: '2026-10-24', reason: 'Attempt by Super Admin' }),
    });
    assert(
      officeDurBlocked.status === 403 && saDurBlocked.status === 403,
      'Only Principal can modify MAX_COURSE_DURATION_YEARS (Office and Super Admin receive 403)'
    );

    const prinDurUpdate = await fetch(`${baseUrl}/api/students/settings/course-duration`, {
      method: 'PUT',
      headers: principalHeaders,
      body: JSON.stringify({
        maxCourseDurationYears: 8,
        effectiveDate: '2026-10-24',
        reason: 'NCISM revised maximum course completion window circular',
      }),
    });
    const durAfterUpdate = await (
      await fetch(`${baseUrl}/api/students/settings/course-duration`, { headers: principalHeaders })
    ).json();
    assert(
      prinDurUpdate.status === 200 &&
        durAfterUpdate.maxCourseDurationYears === 8 &&
        durAfterUpdate.history.length >= 1,
      'Principal updates MAX_COURSE_DURATION_YEARS with mandatory effective date, reason, and history audit trail'
    );

    // Register a senior cohort student admitted >8 years ago -> flagged for course duration review, NOT auto-expelled!
    const seniorStudentRes = await fetch(`${baseUrl}/api/students`, {
      method: 'POST',
      headers: principalHeaders,
      body: JSON.stringify({
        fullName: 'Vikramaditya Kulkarni',
        originalBatchId: mrutyunjayaBatch.id,
        admissionQuota: 'GOVERNMENT',
        admissionYear: 2017,
        admissionDate: '2017-08-01',
        currentYearOfStudy: 3,
      }),
    });
    const seniorStudent = (await seniorStudentRes.json()).student;
    assert(
      seniorStudentRes.status === 201 &&
        seniorStudent.courseDurationFlag === true &&
        seniorStudent.administrativeStatus === 'ACTIVE',
      'Student exceeding maximum course duration is flagged for administrative review and NEVER automatically expelled'
    );

    // Restore 9 years as Principal
    await fetch(`${baseUrl}/api/students/settings/course-duration`, {
      method: 'PUT',
      headers: principalHeaders,
      body: JSON.stringify({
        maxCourseDurationYears: 9,
        effectiveDate: '2026-10-25',
        reason: 'Restored 9-year baseline policy after verification test',
      }),
    });

    // -------------------------------------------------------------------------
    // 13. Final Prof Year Promotion -> Internship Eligibility, Extensions & Strict Completion Guard
    // -------------------------------------------------------------------------
    console.log('\n--- 13. Internship Management (365 Days, Principal Extensions & Attendance Guard) ---');
    // Register a Final Year (Prof Year 3) student in Mrutyunjaya (admitted 2021, within 9-year limit)
    const internCandidateRes = await fetch(`${baseUrl}/api/students`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        fullName: 'Dr. Bhavana Shetty',
        originalBatchId: mrutyunjayaBatch.id,
        admissionQuota: 'GOVERNMENT',
        admissionYear: 2021,
        admissionDate: '2021-10-01',
        currentYearOfStudy: 3,
      }),
    });
    const internCandidate = (await internCandidateRes.json()).student;

    // Evaluate Regular Final Year (Prof Year 3) with 0 failed subjects -> ELIGIBLE_FOR_INTERNSHIP
    const finalYrEvalRes = await fetch(`${baseUrl}/api/students/${internCandidate.id}/progression/evaluate`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        examAttemptType: 'REGULAR',
        evaluatedProfessionalYear: 3,
        examSessionRef: 'RGUHS Final Prof Regular 2026',
        subjects: [
          { subjectCode: 'KAYACHIKITSA', subjectName: 'Kayachikitsa', overallResult: 'PASS' },
          { subjectCode: 'SHALYA', subjectName: 'Shalya Tantra', overallResult: 'PASS' },
          { subjectCode: 'SHALAKYA', subjectName: 'Shalakya Tantra', overallResult: 'PASS' },
          { subjectCode: 'PRASUTI', subjectName: 'Prasuti & Stri Roga', overallResult: 'PASS' },
          { subjectCode: 'KAUMARABHRITYA', subjectName: 'Kaumarabhritya', overallResult: 'PASS' },
        ],
      }),
    });
    const finalYrData = await finalYrEvalRes.json();
    assert(
      finalYrEvalRes.status === 201 && finalYrData.proposal.proposedStatus === 'ELIGIBLE_FOR_INTERNSHIP',
      'Rule 1 (Final Prof Year): Passing all 3rd Prof subjects proposes ELIGIBLE_FOR_INTERNSHIP'
    );

    const finalYrConfirm = await fetch(
      `${baseUrl}/api/students/${internCandidate.id}/progression/${finalYrData.eventId}/confirm`,
      {
        method: 'POST',
        headers: principalHeaders,
        body: JSON.stringify({ remarks: 'Cleared Final BAMS; eligible for 1-year compulsory rotatory internship' }),
      }
    );
    const afterFinalConfirm = await (
      await fetch(`${baseUrl}/api/students/${internCandidate.id}`, { headers: officeHeaders })
    ).json();
    assert(
      finalYrConfirm.status === 200 &&
        afterFinalConfirm.internship?.baseRequiredDays === 365 &&
        afterFinalConfirm.internship?.adjustedRequiredDays === 365 &&
        afterFinalConfirm.internship?.attendanceSource === 'PENDING_ATTENDANCE_MODULE',
      'Confirming Final Prof pass initializes student_internships with 365 base required days and PENDING_ATTENDANCE_MODULE verification status'
    );

    // Non-Principal blocked from approving internship extension
    const officeExtBlocked = await fetch(`${baseUrl}/api/students/${internCandidate.id}/internship/extensions`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({ additionalDays: 30, reason: 'Office try' }),
    });
    assert(officeExtBlocked.status === 403, 'Non-Principal roles are blocked (403) from approving internship extensions');

    // Principal approves +30 extension days -> adjustedRequiredDays becomes 395
    const prinExtRes = await fetch(`${baseUrl}/api/students/${internCandidate.id}/internship/extensions`, {
      method: 'POST',
      headers: principalHeaders,
      body: JSON.stringify({
        additionalDays: 30,
        reason: 'Medical leave deficit in Shalya Tantra posting — 30 additional days required',
      }),
    });
    const afterExtProfile = await (
      await fetch(`${baseUrl}/api/students/${internCandidate.id}`, { headers: officeHeaders })
    ).json();
    assert(
      prinExtRes.status === 201 &&
        afterExtProfile.internship.approvedExtensionDays === 30 &&
        afterExtProfile.internship.adjustedRequiredDays === 395 &&
        afterExtProfile.internship.extensions.length === 1,
      'Principal-approved 30-day internship extension updates adjustedRequiredDays to 395 and logs extension history'
    );

    // Guard 1: Attempt internship completion while attendance/biometric status is PENDING_ATTENDANCE_MODULE -> blocked 400
    const completeBlockedPendingAtt = await fetch(`${baseUrl}/api/students/${internCandidate.id}/internship/complete`, {
      method: 'POST',
      headers: principalHeaders,
      body: JSON.stringify({ remarks: 'Premature completion check' }),
    });
    const blockedPendingErr = await completeBlockedPendingAtt.json();
    assert(
      completeBlockedPendingAtt.status === 400 && blockedPendingErr.code === 'ATTENDANCE_VERIFICATION_UNAVAILABLE',
      'Blocks internship completion while attendance/biometric verification is PENDING_ATTENDANCE_MODULE'
    );

    // Sync reconciled attendance with 365 days (< 395 adjusted required days) -> completion still blocked!
    await fetch(`${baseUrl}/api/students/${internCandidate.id}/internship/attendance-sync`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        creditedDaysCompleted: 365,
        attendanceSource: 'VERIFIED_BIOMETRIC_SYNC',
        attendanceReconciliationStatus: 'RECONCILED',
        syncReference: 'BIO-REC-2027-08',
      }),
    });

    const completeBlockedInsufficientDays = await fetch(
      `${baseUrl}/api/students/${internCandidate.id}/internship/complete`,
      {
        method: 'POST',
        headers: principalHeaders,
        body: JSON.stringify({ remarks: 'Check at 365 days' }),
      }
    );
    const insufficientDaysErr = await completeBlockedInsufficientDays.json();
    assert(
      completeBlockedInsufficientDays.status === 400 && insufficientDaysErr.code === 'INSUFFICIENT_CREDITED_DAYS',
      'Blocks internship completion when reconciled credited days (365) < adjusted required days (395)'
    );

    // Sync reconciled attendance to 395 days -> completion succeeds!
    await fetch(`${baseUrl}/api/students/${internCandidate.id}/internship/attendance-sync`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        creditedDaysCompleted: 395,
        attendanceSource: 'VERIFIED_BIOMETRIC_SYNC',
        attendanceReconciliationStatus: 'RECONCILED',
        syncReference: 'BIO-REC-2027-09',
      }),
    });

    const completeSuccessRes = await fetch(`${baseUrl}/api/students/${internCandidate.id}/internship/complete`, {
      method: 'POST',
      headers: principalHeaders,
      body: JSON.stringify({
        actualCompletionDate: '2027-09-30',
        remarks: 'All 395 required rotatory internship days verified with biometric & department postings',
      }),
    });
    const completedProfile = await (
      await fetch(`${baseUrl}/api/students/${internCandidate.id}`, { headers: officeHeaders })
    ).json();
    assert(
      completeSuccessRes.status === 200 && completedProfile.internship.internshipStatus === 'COMPLETED',
      'Internship completion succeeds once attendance is RECONCILED and credited days >= 395'
    );

    // -------------------------------------------------------------------------
    // 14. Super Admin Actor Masking in Student Audit Trail
    // -------------------------------------------------------------------------
    console.log('\n--- 14. Super Admin Identity Masking in Student Profile ---');
    await fetch(`${baseUrl}/api/students/${s1.id}`, {
      method: 'PUT',
      headers: saHeaders,
      body: JSON.stringify({ fullName: s1.fullName, profileRemarks: 'Verified archival folder label' }),
    });

    const s1ViewedByOffice = await (
      await fetch(`${baseUrl}/api/students/${s1.id}`, { headers: officeHeaders })
    ).json();
    const s1ViewedBySa = await (
      await fetch(`${baseUrl}/api/students/${s1.id}`, { headers: saHeaders })
    ).json();

    const dumpedOfficeView = JSON.stringify(s1ViewedByOffice.auditHistory);
    assert(
      !dumpedOfficeView.includes('superadmin') &&
        !dumpedOfficeView.includes('SUPER_ADMIN') &&
        dumpedOfficeView.includes('System Administration') &&
        JSON.stringify(s1ViewedBySa.auditHistory).includes('SUPER_ADMIN'),
      'Super Admin identity is masked as "System Administration" for non-Super-Admin viewers while visible to Super Admin'
    );

    // -------------------------------------------------------------------------
    // 15. Registry Integration, 24.92-Yr Date Bug Regression & Read-Only Diagnostics
    // -------------------------------------------------------------------------
    console.log('\n--- 15. Single-Source Registry Guard, 24.92-Yr Date Fix & Diagnostics ---');

    // A) Independent student creation via POST /api/fees/students is disabled
    const countBeforeFeePost = memDb.students.length;
    const blockedFeeCreateRes = await fetch(`${baseUrl}/api/fees/students`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        studentIdNumber: 'KAMCH/2026/999',
        fullName: 'Duplicate Fee Student',
        admissionCategory: 'GOVERNMENT',
        admissionYear: 2026,
      }),
    });
    const blockedFeeCreateData = await blockedFeeCreateRes.json();
    assert(
      blockedFeeCreateRes.status === 400 &&
        blockedFeeCreateData.code === 'STUDENT_REGISTRATION_MOVED_TO_STUDENT_MANAGEMENT' &&
        memDb.students.length === countBeforeFeePost,
      'POST /api/fees/students blocks independent duplicate student creation and preserves Student Management as single source of truth'
    );

    // B) Fees Management search finds student by former temporary roll number even after RGUHS verification
    const feeSearchByTempRes = await fetch(
      `${baseUrl}/api/fees/students?search=${encodeURIComponent(s1.temporaryRollNumber)}`,
      { headers: officeHeaders }
    );
    const feeSearchByTempData = await feeSearchByTempRes.json();
    assert(
      feeSearchByTempRes.status === 200 &&
        feeSearchByTempData.students.some((row: any) => row.id === s1.id),
      'GET /api/fees/students finds RGUHS-verified student by former temporary roll number using shared students.id'
    );

    // C) Initialize 2026-2027 Fee Assessment for an existing unassessed Student Management record (RS6 student)
    const initAssmRes = await fetch(
      `${baseUrl}/api/fees/students/${rs6Student.id}/initialize-assessment`,
      {
        method: 'POST',
        headers: officeHeaders,
        body: JSON.stringify({}),
      }
    );
    const initAssmData = await initAssmRes.json();
    assert(
      initAssmRes.status === 201 &&
        initAssmData.student.id === rs6Student.id &&
        memDb.students.length === countBeforeFeePost,
      'POST /api/fees/students/:id/initialize-assessment initializes fee assessment on existing students.id without creating duplicate student'
    );

    // D) Exact "24.92 yrs" bug regression: mysql2 returns DATE columns as JS Date instances at local midnight.
    // Previously String(new Date(2025, 10, 22)).slice(0, 10) produced "Sat Nov 22", which V8 parsed as 2001-11-22 (~24.92 yrs!).
    const s2MemRow = memDb.students.find((row) => row.id === s2.id)!;
    (s2MemRow as any).admission_date = new Date(2024, 9, 15); // Oct 15, 2024 as a JS Date instance (matches s2 admission_year=2024)
    const s2DateObjProfile = await (
      await fetch(`${baseUrl}/api/students/${s2.id}`, { headers: officeHeaders })
    ).json();
    assert(
      s2DateObjProfile.student.admissionDate === '2024-10-15' &&
        s2DateObjProfile.student.admissionDateRequiresVerification === false &&
        s2DateObjProfile.student.courseDurationFlag === false &&
        typeof s2DateObjProfile.student.elapsedYearsFromAdmission === 'number' &&
        s2DateObjProfile.student.elapsedYearsFromAdmission < 4,
      'JS Date object in students.admission_date serializes to YYYY-MM-DD (2024-10-15) and never truncates to "Sat Nov 22" / 24.92 yrs'
    );

    // E) Null, malformed ("Sat Nov 22"), or DOB-substituted admission_date withholds duration flag and requires verification
    (s2MemRow as any).admission_date = null;
    (s2MemRow as any).course_duration_flag = true; // Simulate stale flag from earlier bug
    const s2NullDateProfile = await (
      await fetch(`${baseUrl}/api/students/${s2.id}`, { headers: officeHeaders })
    ).json();
    assert(
      s2NullDateProfile.student.admissionDate === null &&
        s2NullDateProfile.student.admissionDateRequiresVerification === true &&
        s2NullDateProfile.student.elapsedYearsFromAdmission === null &&
        s2NullDateProfile.student.courseDurationFlag === false,
      'Null admission_date reports admissionDateRequiresVerification=true, elapsedYears=null, and clears false courseDurationFlag'
    );

    (s2MemRow as any).admission_date = 'Sat Nov 22';
    const s2CorruptDateProfile = await (
      await fetch(`${baseUrl}/api/students/${s2.id}`, { headers: officeHeaders })
    ).json();
    assert(
      s2CorruptDateProfile.student.admissionDateRequiresVerification === true &&
        s2CorruptDateProfile.student.elapsedYearsFromAdmission === null &&
        s2CorruptDateProfile.student.courseDurationFlag === false,
      'Malformed yearless date string ("Sat Nov 22") is rejected as unverified instead of defaulting to year 2001 (24.92 yrs)'
    );

    // F) Read-only GET /api/students/registry-diagnostics reports potential duplicates & unverified dates without modifying rows
    // Register a documented-override twin name+DOB so potentialDuplicates detection is verified end-to-end
    const twinRes = await fetch(`${baseUrl}/api/students`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        fullName: 'Ananya Kulkarni',
        dateOfBirth: '2005-04-12',
        admissionQuota: 'GOVERNMENT',
        admissionYear: 2024,
        admissionDate: '2024-09-12',
        originalBatchId: agastyaBatch.id,
        allowDuplicateOverride: true,
        duplicateOverrideReason: 'Verified namesake twin in intake for read-only duplicate audit test',
      }),
    });
    assert(twinRes.status === 201, 'Documented duplicate override registers distinct record with audit trail');
    const countBeforeDiag = memDb.students.length;

    const diagRes = await fetch(`${baseUrl}/api/students/registry-diagnostics`, {
      headers: officeHeaders,
    });
    const diagData = await diagRes.json();
    assert(
      diagRes.status === 200 &&
        diagData.potentialDuplicatesCount >= 1 &&
        diagData.admissionDateIssuesCount >= 1 &&
        memDb.students.length === countBeforeDiag,
      'GET /api/students/registry-diagnostics reports potential duplicates and admission-date issues without modifying any record'
    );

    // -------------------------------------------------------------------------
    // 16. Simplified Academic Progression UI — Acceptance Tests 1–6
    // -------------------------------------------------------------------------
    console.log('\n--- 16. Simplified Academic Progression UI — Acceptance Tests 1–6 ---');

    // Restore s2 valid admission_date after Section 15 date-corruption tests
    (s2MemRow as any).admission_date = '2024-10-15';
    (s2MemRow as any).course_duration_flag = false;

    // Acceptance Test 1: Regular student, zero backlogs, no detention -> minimal compact view
    const regStudentProfile = await (
      await fetch(`${baseUrl}/api/students/${kavyaRow.id}`, { headers: officeHeaders })
    ).json();
    const regView = deriveProgressionViewState(
      regStudentProfile.student,
      regStudentProfile.progressionHistory
    );
    assert(
      regStudentProfile.student.progressionStatus === 'REGULAR_ACTIVE' &&
        regView.showOriginalBatch === false &&
        regView.showDetentionStage === false &&
        regView.showSplitTermCards === false &&
        regView.showRoutingMode === false &&
        regView.showOutstandingSubjects === false &&
        regView.showPendingReviewSection === false &&
        regView.showProgressionHistory === false,
      'Acceptance Test 1: Regular student (0 backlogs, no detention) shows compact view without split-term cards, detention stage, routing mode, 0-backlog panel, or redundant enrollment history'
    );

    // Acceptance Test 2 & 3: First Detention vs Verified Double Detention with Split-Term Mapping
    const uiDetStudentRes = await fetch(`${baseUrl}/api/students`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        fullName: 'Vikramaditya Rao',
        dateOfBirth: '2005-07-19',
        admissionQuota: 'GOVERNMENT',
        admissionYear: 2024,
        admissionDate: '2024-09-18',
        originalBatchId: agastyaBatch.id,
      }),
    });
    const uiDetStudent = (await uiDetStudentRes.json()).student;

    const uiStage1Eval = await (
      await fetch(`${baseUrl}/api/students/${uiDetStudent.id}/progression/evaluate`, {
        method: 'POST',
        headers: officeHeaders,
        body: JSON.stringify({
          examAttemptType: 'REGULAR',
          evaluatedProfessionalYear: 1,
          examSessionRef: 'RGUHS Nov 2025 Regular',
          subjects: [
            { subjectCode: 'PADARTHA', subjectName: 'Padartha Vigyana', overallResult: 'FAIL' },
            { subjectCode: 'KRIYA', subjectName: 'Kriya Sharira', overallResult: 'FAIL' },
            { subjectCode: 'RACHANA', subjectName: 'Rachana Sharira', overallResult: 'FAIL' },
          ],
        }),
      })
    ).json();
    await fetch(
      `${baseUrl}/api/students/${uiDetStudent.id}/progression/${uiStage1Eval.eventId}/confirm`,
      {
        method: 'POST',
        headers: principalHeaders,
        body: JSON.stringify({ remarks: 'Confirmed Stage 1 detention' }),
      }
    );
    const uiStage1Profile = await (
      await fetch(`${baseUrl}/api/students/${uiDetStudent.id}`, { headers: officeHeaders })
    ).json();
    const stage1View = deriveProgressionViewState(
      uiStage1Profile.student,
      uiStage1Profile.progressionHistory
    );
    assert(
      stage1View.showDetentionStage === true &&
        stage1View.showOriginalBatch === true &&
        stage1View.showRoutingMode === true &&
        stage1View.showSplitTermCards === false &&
        stage1View.showOutstandingSubjects === true &&
        stage1View.outstandingSubjects.length === 3 &&
        stage1View.showProgressionHistory === true,
      'Acceptance Test 2: Student with first detention shows detention stage, original/current batch, odd-batch routing, and outstanding subjects without split-term Term 1/2/3 cards'
    );

    const uiStage2Eval = await (
      await fetch(`${baseUrl}/api/students/${uiDetStudent.id}/progression/evaluate`, {
        method: 'POST',
        headers: officeHeaders,
        body: JSON.stringify({
          examAttemptType: 'SUPPLEMENTARY',
          evaluatedProfessionalYear: 1,
          examSessionRef: 'RGUHS May 2026 Supplementary',
          subjects: [
            { subjectCode: 'PADARTHA', subjectName: 'Padartha Vigyana', overallResult: 'PASS' },
            { subjectCode: 'KRIYA', subjectName: 'Kriya Sharira', overallResult: 'PASS' },
            { subjectCode: 'RACHANA', subjectName: 'Rachana Sharira', overallResult: 'FAIL' },
          ],
        }),
      })
    ).json();
    await fetch(
      `${baseUrl}/api/students/${uiDetStudent.id}/progression/${uiStage2Eval.eventId}/confirm`,
      {
        method: 'POST',
        headers: principalHeaders,
        body: JSON.stringify({ remarks: 'Confirmed Stage 2 split-term detention' }),
      }
    );
    const uiStage2Profile = await (
      await fetch(`${baseUrl}/api/students/${uiDetStudent.id}`, { headers: officeHeaders })
    ).json();
    const stage2View = deriveProgressionViewState(
      uiStage2Profile.student,
      uiStage2Profile.progressionHistory
    );
    assert(
      stage2View.showDetentionStage === true &&
        stage2View.showOriginalBatch === true &&
        stage2View.showSplitTermCards === true &&
        stage2View.showRoutingMode === true &&
        stage2View.showOutstandingSubjects === true &&
        stage2View.outstandingSubjects.length === 1,
      'Acceptance Test 3: Student with verified double detention and split-term mapping displays Term 1/2/3 cohort cards'
    );

    // Acceptance Test 4: Student with backlogs (Provisionally Promoted, zero detention)
    const backlogProfile = await (
      await fetch(`${baseUrl}/api/students/${s2.id}`, { headers: officeHeaders })
    ).json();
    const backlogView = deriveProgressionViewState(
      backlogProfile.student,
      backlogProfile.progressionHistory
    );
    assert(
      backlogView.showOutstandingSubjects === true &&
        backlogView.outstandingSubjects.length === 1 &&
        backlogView.outstandingSubjects[0].code === 'RACHANA' &&
        backlogView.showDetentionStage === false &&
        backlogView.showSplitTermCards === false &&
        backlogView.showRoutingMode === false,
      'Acceptance Test 4: Student with backlogs shows outstanding subjects while hiding detention and split-term panels'
    );

    // Acceptance Test 5: Student pending Office review -> shows ONLY relevant review status without irrelevant panels
    const uiRevStudentRes = await fetch(`${baseUrl}/api/students`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        fullName: 'Nandini Deshmukh',
        dateOfBirth: '2006-01-25',
        admissionQuota: 'GOVERNMENT',
        admissionYear: 2025,
        admissionDate: '2025-09-20',
        originalBatchId: agniveshBatch.id,
      }),
    });
    const uiRevStudent = (await uiRevStudentRes.json()).student;
    await fetch(`${baseUrl}/api/students/${uiRevStudent.id}/progression/evaluate`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        examAttemptType: 'REGULAR',
        evaluatedProfessionalYear: 1,
        examSessionRef: 'RGUHS Nov 2026 Regular',
        subjects: [
          { subjectCode: 'PADARTHA', subjectName: 'Padartha Vigyana', overallResult: 'INCOMPLETE' },
        ],
      }),
    });
    const uiRevProfile = await (
      await fetch(`${baseUrl}/api/students/${uiRevStudent.id}`, { headers: officeHeaders })
    ).json();
    const revView = deriveProgressionViewState(
      uiRevProfile.student,
      uiRevProfile.progressionHistory
    );
    assert(
      revView.isPendingOfficeReview === true &&
        revView.showPendingReviewSection === true &&
        revView.pendingReviewEvents.length === 1 &&
        revView.showDetentionStage === false &&
        revView.showSplitTermCards === false &&
        revView.showRoutingMode === false &&
        revView.showOutstandingSubjects === false,
      'Acceptance Test 5: Student pending Office review shows specific pending review status without unrelated detention or split-term panels'
    );

    // Acceptance Test 6: Existing progression history and role permissions remain intact
    const s3FinalProfile = await (
      await fetch(`${baseUrl}/api/students/${s3.id}`, { headers: officeHeaders })
    ).json();
    const s3FinalView = deriveProgressionViewState(
      s3FinalProfile.student,
      s3FinalProfile.progressionHistory
    );
    const libBlockedProfile = await fetch(`${baseUrl}/api/students/${s3.id}`, {
      headers: libraryHeaders,
    });
    assert(
      s3FinalProfile.progressionHistory.length === 4 &&
        s3FinalView.showProgressionHistory === true &&
        s3FinalView.historyEvents.length === 3 &&
        libBlockedProfile.status === 403,
      'Acceptance Test 6: Full progression history in DB/API and role permissions remain completely intact'
    );

    // -------------------------------------------------------------------------
    // 17. Dynamic Term 1 / Term 2 / Term 3 Academic Placement Across All Years
    // -------------------------------------------------------------------------
    console.log('\n--- 17. Dynamic Term 1–3 Academic Placement & Scheme/Year Validation ---');
    const createDynBatchRes = await fetch(`${baseUrl}/api/students/batches`, {
      method: 'POST',
      headers: principalHeaders,
      body: JSON.stringify({
        code: 'DYN_PLACEMENT_TEST',
        name: 'Bhaskara Test',
        admissionAcademicYear: '2026-2027',
        admissionYearStart: 2026,
        schemeId: rs7Scheme.id,
        currentCohortStage: 'PROF_YEAR_1_TERM_1',
        currentProfessionalYear: 1,
        admissionStatus: 'OPEN',
        isActive: true,
        displayOrder: 99,
      }),
    });
    const createdDynBatchData = await createDynBatchRes.json();
    const dynBatchId = Number(createdDynBatchData.batchId);
    const listAfterCreate = await (
      await fetch(`${baseUrl}/api/students/batches`, { headers: principalHeaders })
    ).json();
    const createdDynBatch = listAfterCreate.batches.find((b: any) => b.id === dynBatchId);
    assert(
      createDynBatchRes.status === 201 &&
        Boolean(createdDynBatch) &&
        createdDynBatch.currentCohortStage === 'PROF_YEAR_1_TERM_1' &&
        createdDynBatch.currentProfessionalYear === 1,
      'Creates RS7 batch in 1st Professional Year, Term 1 without fixed junior/senior assumption'
    );

    // Progress through Term 3 of 2nd Prof preserving original batch identity
    const updY2T3Res = await fetch(`${baseUrl}/api/students/batches/${dynBatchId}`, {
      method: 'PUT',
      headers: principalHeaders,
      body: JSON.stringify({
        name: 'Bhaskara Test',
        admissionAcademicYear: '2026-2027',
        admissionYearStart: 2026,
        schemeId: rs7Scheme.id,
        currentCohortStage: 'PROF_YEAR_2_TERM_3',
        currentProfessionalYear: 2,
        admissionStatus: 'COMPLETED',
        isActive: true,
        displayOrder: 99,
      }),
    });
    const listAfterUpd = await (
      await fetch(`${baseUrl}/api/students/batches`, { headers: principalHeaders })
    ).json();
    const updatedDynBatch = listAfterUpd.batches.find((b: any) => b.id === dynBatchId);
    assert(
      updY2T3Res.status === 200 &&
        Boolean(updatedDynBatch) &&
        updatedDynBatch.code === 'DYN_PLACEMENT_TEST' &&
        updatedDynBatch.admissionAcademicYear === '2026-2027' &&
        updatedDynBatch.currentProfessionalYear === 2 &&
        updatedDynBatch.currentCohortStage === 'PROF_YEAR_2_TERM_3',
      'Updates batch to 2nd Prof. Year, Term 3 while preserving original admission batch identity and academic year'
    );

    // Reject mismatched stage year vs currentProfessionalYear
    const badStageYearRes = await fetch(`${baseUrl}/api/students/batches/${dynBatchId}`, {
      method: 'PUT',
      headers: principalHeaders,
      body: JSON.stringify({
        name: 'Bhaskara Test',
        admissionAcademicYear: '2026-2027',
        admissionYearStart: 2026,
        schemeId: rs7Scheme.id,
        currentCohortStage: 'PROF_YEAR_3_TERM_1',
        currentProfessionalYear: 2,
        admissionStatus: 'COMPLETED',
        isActive: true,
      }),
    });
    assert(
      badStageYearRes.status === 400,
      'Rejects mismatched term stage (PROF_YEAR_3_TERM_1) against currentProfessionalYear (2)'
    );

    // Reject out-of-bounds professional year (Year 4 on 3-year RS7 scheme)
    const badSchemeYearRes = await fetch(`${baseUrl}/api/students/batches/${dynBatchId}`, {
      method: 'PUT',
      headers: principalHeaders,
      body: JSON.stringify({
        name: 'Bhaskara Test',
        admissionAcademicYear: '2026-2027',
        admissionYearStart: 2026,
        schemeId: rs7Scheme.id,
        currentCohortStage: 'PROF_YEAR_4_TERM_1',
        currentProfessionalYear: 4,
        admissionStatus: 'COMPLETED',
        isActive: true,
      }),
    });
    assert(
      badSchemeYearRes.status === 400,
      'Rejects Professional Year 4 on 3-year RS7 scheme'
    );

    // Reject RS6 stage on RS7 batch
    const badRs6StageOnRs7Res = await fetch(`${baseUrl}/api/students/batches/${dynBatchId}`, {
      method: 'PUT',
      headers: principalHeaders,
      body: JSON.stringify({
        name: 'Bhaskara Test',
        admissionAcademicYear: '2026-2027',
        admissionYearStart: 2026,
        schemeId: rs7Scheme.id,
        currentCohortStage: 'LEGACY_COHORT',
        currentProfessionalYear: null,
        admissionStatus: 'COMPLETED',
        isActive: true,
      }),
    });
    assert(
      badRs6StageOnRs7Res.status === 400,
      'Rejects RS6 legacy stage (LEGACY_COHORT) on RS7 curriculum batch'
    );

    console.log('\n==============================================================');
    console.log(`STUDENT MANAGEMENT TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log('==============================================================');

    server.close();
    if (failed > 0) process.exit(1);
    process.exit(0);
  } catch (err) {
    console.error('Fatal Student Management test error:', err);
    server.close();
    process.exit(1);
  }
}

runStudentManagementTests();
