import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { checkDatabaseConnection, getPool } from '../server/db.ts';
import { MemoryDatabase } from '../server/services/memory-db.ts';
import { authRouter } from '../server/routes/auth.routes.ts';
import { userRouter } from '../server/routes/user.routes.ts';
import { recordsRouter } from '../server/routes/records.routes.ts';
import {
  DEFAULT_FACULTY_SOURCE_PATH,
  REQUIRED_TEACHER_MIGRATION_COLUMNS,
  parseFacultySourceDocument,
  resolveDepartmentMapping,
  createReadOnlyConnectionGuard,
  runFacultyImportWorkflow,
  type SqlConnectionLike,
} from '../server/services/faculty-import.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function genSecret(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}!9`;
}

function extractCookies(res: Response): { session: string; csrf: string } {
  const getSetCookie = (res.headers as any).getSetCookie;
  const rawList: string[] =
    typeof getSetCookie === 'function'
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

async function runFacultyImportTests() {
  console.log('==============================================================');
  console.log('KAMCH ERP — FACULTY PARSER, IMPORT SAFETY & TEACHER RECORDS');
  console.log('==============================================================\n');

  await checkDatabaseConnection();
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

  function resetFacultyAndDeptStore() {
    memDb.teachers = [];
    memDb.departments = [];
    memDb.auditLogs = [];
  }

  resetFacultyAndDeptStore();
  const initialUsersCount = memDb.users.length;

  // =========================================================================
  // 1. PARSER ACCURACY & TRAILING CLIPBOARD NOISE STRIPPING
  // =========================================================================
  console.log('--- 1. Faculty Source Parser & Data Quality Flags ---');

  const seedSourceText = fs.readFileSync(DEFAULT_FACULTY_SOURCE_PATH, 'utf8');
  const parsedSeed = parseFacultySourceDocument(seedSourceText, {
    referenceDate: '2026-05-15',
  });

  assert(
    parsedSeed.records.length === 53,
    'Seed source file parses all 53 faculty records cleanly',
    `Got ${parsedSeed.records.length}`
  );
  assert(
    parsedSeed.departmentsInOrder.length === 14,
    'Seed source file preserves all 14 Ayurvedic departments in order',
    `Got ${parsedSeed.departmentsInOrder.length}`
  );
  assert(
    parsedSeed.sourceInternalDuplicates.length === 0,
    'Zero internal duplicate conflicts across the 53 source faculty records',
    `Got ${parsedSeed.sourceInternalDuplicates.length}`
  );

  // Verify raw paste file with trailing clipboard webpage JSON noise if present
  const rawPastePath = path.resolve(
    __dirname,
    '../public/assets/aistudio/Paste_October_24__2026_-_4_35PM_7d1265f0'
  );
  if (fs.existsSync(rawPastePath)) {
    const rawPasteText = fs.readFileSync(rawPastePath, 'utf8');
    const parsedRaw = parseFacultySourceDocument(rawPasteText, {
      referenceDate: '2026-05-15',
    });
    assert(
      parsedRaw.records.length === 53 && parsedRaw.departmentsInOrder.length === 14,
      'Raw paste file with trailing webpage JSON noise still parses exact 53 faculty & 14 departments',
      `records=${parsedRaw.records.length}, depts=${parsedRaw.departmentsInOrder.length}`
    );
    assert(
      parsedRaw.ignoredTrailingNoiseLines > 0,
      'Parser detects and strips trailing clipboard JSON noise lines safely',
      `ignored=${parsedRaw.ignoredTrailingNoiseLines}`
    );
  }

  // Verify exact per-department counts from source document (sum = 53)
  const expectedDeptCounts: Record<string, number> = {
    'Rasashastra and Bhaishajya Kalpana': 3,
    'Rachana Shareera': 4,
    'Kriya Shareera': 2,
    'Ayurveda Samhita Siddhant': 6,
    'Roga Nidana And Vikriti Vijnana': 3,
    'Dravyaguna Vigyana': 3,
    'Swastha Vritta & Yoga': 3,
    'Agada Tantra': 4,
    'Prasooti Tantra & Striroga': 4,
    Koumarabhritya: 4,
    'Kaya Chikitsa': 5,
    Panchakarma: 4,
    'Shalya Tantra': 4,
    'Shalakya Tantra': 4,
  };
  const actualDeptCounts: Record<string, number> = {};
  for (const r of parsedSeed.records) {
    actualDeptCounts[r.departmentSourceName] =
      (actualDeptCounts[r.departmentSourceName] || 0) + 1;
  }
  assert(
    JSON.stringify(actualDeptCounts) === JSON.stringify(expectedDeptCounts),
    'Department-wise faculty counts match source document (sum = 53)',
    JSON.stringify(actualDeptCounts)
  );

  // Verify non-interchangeability of Teacher Code vs Professional Registration Number + mixed dates
  const drSugate = parsedSeed.records.find((r) =>
    r.fullName.includes('Shridhar Keshav Sugate')
  );
  assert(
    Boolean(
      drSugate &&
        drSugate.dateOfBirth === '1980-06-28' &&
        drSugate.joiningDateInstitute === '2021-03-03' &&
        drSugate.registrationNumber === '20202' &&
        drSugate.teacherCode === 'AYST00719'
    ),
    'Mixed date formats (28-06-1980, 3/3/2021) and distinct Reg. No vs Teacher Code parsed accurately',
    JSON.stringify(drSugate)
  );

  const drHarshal = parsedSeed.records.find((r) => r.fullName.includes('Harshal S Kamate'));
  const drShailendra = parsedSeed.records.find((r) =>
    r.fullName.includes('Shailendra Narendra Chavan')
  );
  assert(
    drHarshal?.joiningDateService === '2014-04-01' &&
      drHarshal?.joiningDateInstitute === '2021-03-04' &&
      drShailendra?.joiningDateService === '2014-04-10' &&
      drShailendra?.joiningDateInstitute === '2021-03-04',
    'Textual month dates ("1 April 2014", "10 April, 2014", "4 March 2021") parse cleanly without timezone drift',
    `Harshal=${drHarshal?.joiningDateService}, Shailendra=${drShailendra?.joiningDateService}`
  );

  // =========================================================================
  // 2. DATA QUALITY & VERIFICATION FLAGS (NEVER SILENTLY CORRECT OR FABRICATE)
  // =========================================================================
  const drAnu = parsedSeed.records.find((r) => r.fullName.includes('Anu Robert'));
  assert(
    Boolean(
      drAnu &&
        drAnu.teacherCode === null &&
        drAnu.teacherCodeStatus === 'APPLIED' &&
        drAnu.registrationNumber === null &&
        drAnu.dataVerificationRequired &&
        drAnu.verificationFlags.some((f) => f.code === 'TEACHER_CODE_APPLIED_PENDING') &&
        drAnu.verificationFlags.some((f) => f.code === 'MISSING_REGISTRATION_NUMBER')
    ),
    'Dr. Anu Robert ("Applied for Teacher Code") keeps teacherCode=null, status=APPLIED, and flags verification',
    JSON.stringify(drAnu?.verificationFlags)
  );

  const mrsSushma = parsedSeed.records.find((r) => r.fullName.includes('Sushma K C'));
  assert(
    Boolean(
      mrsSushma &&
        mrsSushma.registrationNumber === null &&
        mrsSushma.teacherCode === 'AYSN00763' &&
        mrsSushma.reportedExperience === '01 Year 08 Months' &&
        mrsSushma.verificationFlags.some((f) => f.code === 'PLACEHOLDER_REGISTRATION_NUMBER')
    ),
    'Mrs. Sushma K C preserves "--" Reg. No as null, keeps AYSN00763 & verbatim Experience ("01 Year 08 Months"), and flags placeholder',
    JSON.stringify(mrsSushma?.verificationFlags)
  );

  const drShilpa = parsedSeed.records.find((r) => r.fullName.includes('Shilpa Bellannavar'));
  const mrShriprada = parsedSeed.records.find((r) => r.fullName.includes('Shriprada Joshi'));
  assert(
    Boolean(
      drShilpa &&
        drShilpa.registrationNumber === null &&
        drShilpa.joiningDateInstitute === '2026-07-20' &&
        drShilpa.verificationFlags.some((f) => f.code === 'MISSING_REGISTRATION_NUMBER') &&
        drShilpa.verificationFlags.some((f) => f.code === 'SUSPICIOUS_INSTITUTE_JOINING_DATE') &&
        mrShriprada &&
        mrShriprada.registrationNumber === null &&
        mrShriprada.joiningDateInstitute === '2026-07-20' &&
        mrShriprada.verificationFlags.some((f) => f.code === 'SUSPICIOUS_INSTITUTE_JOINING_DATE') &&
        mrShriprada.verificationFlags.some((f) => f.code === 'EXPERIENCE_SERVICE_DATE_DISCREPANCY')
    ),
    'Suspicious 2026 institute joining dates (20/07/2026) and experience discrepancies are preserved verbatim and flagged',
    JSON.stringify({ shilpa: drShilpa?.verificationFlags, shriprada: mrShriprada?.verificationFlags })
  );

  const drSarita = parsedSeed.records.find((r) => r.fullName.includes('Sarita Kamate'));
  assert(
    Boolean(
      drSarita &&
        drSarita.contactEmail === null &&
        drSarita.verificationFlags.some((f) => f.code === 'MISSING_EMAIL')
    ),
    'Dr. Sarita Kamate missing Email ID stays null (never fabricated) and flags MISSING_EMAIL'
  );

  assert(
    Boolean(
      drHarshal &&
        drHarshal.contactPhone === '08180025339' &&
        drHarshal.verificationFlags.some((f) => f.code === 'NON_STANDARD_PHONE_FORMAT')
    ),
    'Dr. Harshal S Kamate 11-digit leading-zero phone ("08180025339") is preserved verbatim and flagged'
  );

  const drSharayu = parsedSeed.records.find((r) => r.fullName.includes('Sharayu Patil'));
  assert(
    Boolean(
      drSharayu &&
        drSharayu.previousInstitute === null &&
        drSharayu.verificationFlags.some((f) => f.code === 'MISSING_PREVIOUS_INSTITUTE')
    ),
    'Dr. Sharayu Patil placeholder Previous Institute ("-------") with prior service date triggers MISSING_PREVIOUS_INSTITUTE flag'
  );

  // Synthetic inverted date & case-insensitive field label alias verification
  const syntheticSample = `Departmental Faculties of Agada Tantra:
Dr. Test Verification
- Name: Dr. Test Verification
- Designation: Assistant Professor
- Qualification: BAMS, MD
- DOB: 10/05/1990
- Reg. No: KA-99999
- Teacher Code: AYAT99999
- Joining of Service: 01/06/2023
- Joining of Institute: 01/01/2022
- Experience: 2 Years
- Name of Previous Institute: Test College
- Email ID: test@example.org
- Phone: 9876543210
`;
  const syntheticParsed = parseFacultySourceDocument(syntheticSample, {
    referenceDate: '2026-05-15',
  });
  assert(
    syntheticParsed.records[0]?.verificationFlags.some(
      (f) => f.code === 'INSTITUTE_BEFORE_SERVICE_DATE'
    ) && syntheticParsed.records[0]?.teacherCode === 'AYAT99999',
    'Inverted dates (Joining of Institute earlier than Joining of Service) trigger INSTITUTE_BEFORE_SERVICE_DATE flag'
  );

  // =========================================================================
  // 3. DEPARTMENT REUSE & AMBIGUITY BLOCKING
  // =========================================================================
  console.log('\n--- 2. Department Reuse & Ambiguity Safety ---');

  const exactReuse = resolveDepartmentMapping('Kaya Chikitsa', [
    { id: 11, code: 'KC_DEPT', name: 'Kaya Chikitsa', description: 'Existing exact name' },
  ]);
  assert(
    exactReuse.status === 'REUSE_EXISTING' && exactReuse.departmentId === 11,
    'Exact department name match reuses existing department row without creating a duplicate'
  );

  const exactCodeReuse = resolveDepartmentMapping('Rasashastra and Bhaishajya Kalpana', [
    { id: 12, code: 'RSBK', name: 'Rasashastra & BK', description: 'Existing exact code' },
  ]);
  assert(
    exactCodeReuse.status === 'REUSE_EXISTING' && exactCodeReuse.departmentId === 12,
    'Exact canonical department code match reuses existing department row safely'
  );

  const ambiguousDept = resolveDepartmentMapping('Kaya Chikitsa', [
    { id: 77, code: 'KAYA', name: 'Kayachikitsa Clinical Wing', description: 'Partial match' },
  ]);
  assert(
    ambiguousDept.status === 'AMBIGUOUS_MANUAL_RESOLUTION_REQUIRED' &&
      ambiguousDept.candidateDepartments.length === 1 &&
      ambiguousDept.candidateDepartments[0].id === 77,
    'Partial/ambiguous existing department match blocks automatic department creation for manual resolution'
  );

  // =========================================================================
  // 4. DRY-RUN ZERO-WRITE GUARANTEE (PRE-MIGRATION & POST-MIGRATION)
  // =========================================================================
  console.log('\n--- 3. Dry-Run Non-Mutation & Pre-Migration Safety ---');

  const rawConn = await pool.getConnection();
  try {
    const { guardedConnection } = createReadOnlyConnectionGuard(rawConn);
    let writeBlocked = false;
    try {
      await guardedConnection.query(
        'INSERT INTO departments (code, name, description) VALUES (?, ?, ?)',
        ['X', 'Blocked', null]
      );
    } catch (err: any) {
      writeBlocked = String(err?.message || '').includes('DRY_RUN_WRITE_VIOLATION');
    }
    let txBlocked = false;
    try {
      await guardedConnection.beginTransaction!();
    } catch (err: any) {
      txBlocked = String(err?.message || '').includes('DRY_RUN_WRITE_VIOLATION');
    }
    assert(
      writeBlocked && txBlocked,
      'createReadOnlyConnectionGuard strictly blocks INSERT/UPDATE/DDL and transactions during dry-run'
    );
  } finally {
    rawConn.release();
  }

  // Simulate pre-migration database (missing the 12 teacher_records_v1 columns)
  const preMigrationMockQueries: string[] = [];
  const preMigrationMockConn: SqlConnectionLike = {
    query: async (sql: string): Promise<[any, any]> => {
      preMigrationMockQueries.push(sql.trim());
      const norm = sql.replace(/\s+/g, ' ').trim().toUpperCase();
      if (norm.includes('INFORMATION_SCHEMA.TABLES')) {
        return [[{ cnt: 1 }], []];
      }
      if (norm.includes('INFORMATION_SCHEMA.COLUMNS')) {
        return [
          [
            'id',
            'employee_code',
            'full_name',
            'designation',
            'department_id',
            'qualification',
            'contact_phone',
            'contact_email',
            'status',
          ].map((c) => ({ COLUMN_NAME: c })),
          [],
        ];
      }
      if (norm.startsWith('SELECT ID, CODE, NAME, DESCRIPTION FROM DEPARTMENTS')) {
        return [[], []];
      }
      if (norm.startsWith('SELECT ') && norm.includes('FROM TEACHERS')) {
        if (norm.includes('TEACHER_CODE') || norm.includes('REGISTRATION_NUMBER')) {
          throw new Error('Selected unmigrated column on pre-migration table!');
        }
        return [[], []];
      }
      throw new Error(`Unexpected query on pre-migration mock: ${sql}`);
    },
  };

  const preMigDryRun = await runFacultyImportWorkflow({
    connection: preMigrationMockConn,
    mode: 'DRY_RUN',
    referenceDate: '2026-05-15',
  });
  assert(
    !preMigDryRun.schemaStatus.migrationReady &&
      preMigDryRun.schemaStatus.missingTeacherColumns.length ===
        REQUIRED_TEACHER_MIGRATION_COLUMNS.length &&
      preMigDryRun.counts.readyOrInserted === 53 &&
      preMigrationMockQueries.every((q) => q.toUpperCase().startsWith('SELECT')),
    'Dry-run works cleanly BEFORE schema migration is applied and executes SELECT queries only'
  );

  let applyBlockedWithoutMigration = false;
  try {
    await runFacultyImportWorkflow({
      connection: preMigrationMockConn,
      mode: 'APPLY',
      referenceDate: '2026-05-15',
    });
  } catch (err: any) {
    applyBlockedWithoutMigration = String(err?.message || '').includes('teacher_records_v1');
  }
  assert(
    applyBlockedWithoutMigration,
    'APPLY mode refuses to run if teacher_records_v1 migration has not been applied first'
  );

  // Run full post-migration DRY_RUN against pool and assert zero state changes
  const dryRunConn = await pool.getConnection();
  try {
    const dryRunReport = await runFacultyImportWorkflow({
      connection: dryRunConn,
      mode: 'DRY_RUN',
      referenceDate: '2026-05-15',
    });
    assert(
      dryRunReport.schemaStatus.migrationReady &&
        dryRunReport.counts.readyOrInserted === 53 &&
        dryRunReport.counts.departmentsCreated === 14 &&
        memDb.departments.length === 0 &&
        memDb.teachers.length === 0 &&
        memDb.auditLogs.length === 0 &&
        memDb.users.length === initialUsersCount,
      'Post-migration DRY_RUN performs zero writes (0 departments, 0 teachers, 0 audit logs, 0 users)'
    );
  } finally {
    dryRunConn.release();
  }

  // =========================================================================
  // 5. DUPLICATE DETECTION & AMBIGUOUS DEPARTMENT SKIPPING (NO AUTO-MERGE/DELETE)
  // =========================================================================
  console.log('\n--- 4. Duplicate Conflict Protection & Ambiguous Department Handling ---');

  // Seed an existing ambiguous department ("Kayachikitsa Wing") and a pre-existing manual teacher
  // who shares Dr. Manjunath S. Gavimath's email/teacherCode (AYRB00276) under a manual HR employee_code.
  const seedConflictConn = await pool.getConnection();
  try {
    const [ambigDeptIns]: any = await seedConflictConn.query(
      'INSERT INTO departments (code, name, description) VALUES (?, ?, ?)',
      ['KAYA_LEGACY', 'Kayachikitsa Wing', 'Legacy manual dept']
    );
    const legacyDeptId = Number(ambigDeptIns.insertId);

    const [manualTeacherIns]: any = await seedConflictConn.query(
      `INSERT INTO teachers (
        employee_code, teacher_code, teacher_code_status, registration_number,
        full_name, designation, department_id, qualification,
        contact_phone, contact_email, status, data_verification_required
      ) VALUES (?, ?, 'VERIFIED', ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', FALSE)`,
      [
        'EMP-MANUAL-001',
        'AYRB00276',
        'MANUAL-REG-999', // Conflicting registration number on existing manual record
        'Dr. Manjunath Gavimath (Manual Entry)',
        'Principal',
        legacyDeptId,
        'BAMS, MD (AYU)',
        '9008312978',
        'drgavimathmg@gmail.com',
      ]
    );
    const manualTeacherId = Number(manualTeacherIns.insertId);

    const conflictApplyReport = await runFacultyImportWorkflow({
      connection: seedConflictConn,
      mode: 'APPLY',
      referenceDate: '2026-05-15',
    });

    // Kaya Chikitsa has 5 faculty -> skipped due to ambiguous department
    // Dr. Manjunath S. Gavimath (RSBK) -> skipped due to potential duplicate conflict with manualTeacherId
    // Remaining 53 - 5 - 1 = 47 faculty inserted across 13 unambiguously resolved departments
    assert(
      conflictApplyReport.counts.skippedAmbiguousDepartment === 5 &&
        conflictApplyReport.counts.skippedPotentialDuplicate === 1 &&
        conflictApplyReport.counts.readyOrInserted === 47,
      'APPLY skips ambiguous-department records (5) and potential duplicates (1) while importing clean records (47)',
      JSON.stringify(conflictApplyReport.counts)
    );

    const preservedManual = memDb.teachers.find((t) => t.id === manualTeacherId);
    assert(
      Boolean(
        preservedManual &&
          preservedManual.employee_code === 'EMP-MANUAL-001' &&
          preservedManual.registration_number === 'MANUAL-REG-999' &&
          preservedManual.full_name === 'Dr. Manjunath Gavimath (Manual Entry)'
      ),
      'Existing potential duplicate teacher record is preserved untouched (never auto-merged or deleted)'
    );
  } finally {
    seedConflictConn.release();
  }

  // =========================================================================
  // 6. FULL CLEAN APPLY, IDEMPOTENCY ON RE-RUN & ZERO TEACHER LOGIN ACCOUNTS
  // =========================================================================
  console.log('\n--- 5. Clean Apply, Idempotency & Zero Login Accounts ---');

  resetFacultyAndDeptStore();
  // Pre-seed 1 exact-matching department to verify mixed REUSE_EXISTING (1) + CREATE_NEW (13)
  const applyConn = await pool.getConnection();
  try {
    await applyConn.query(
      'INSERT INTO departments (code, name, description) VALUES (?, ?, ?)',
      ['PANCHAKARMA', 'Panchakarma', 'Existing Panchakarma Dept']
    );

    const firstApply = await runFacultyImportWorkflow({
      connection: applyConn,
      mode: 'APPLY',
      referenceDate: '2026-05-15',
    });

    assert(
      firstApply.counts.readyOrInserted === 53 &&
        firstApply.counts.departmentsReused === 1 &&
        firstApply.counts.departmentsCreated === 13 &&
        memDb.departments.length === 14 &&
        memDb.teachers.length === 53,
      'First APPLY reuses 1 existing department, creates 13 missing departments, and inserts all 53 faculty records',
      JSON.stringify(firstApply.counts)
    );

    assert(
      memDb.teachers.every((t) => t.employee_code === null),
      'Imported faculty records never fabricate internal employee_code (all 53 have employee_code = null)'
    );

    assert(
      memDb.users.length === initialUsersCount,
      'Faculty import creates zero teacher login accounts in users table'
    );

    const auditLogsAfterFirst = memDb.auditLogs.length;
    assert(
      auditLogsAfterFirst === 1 && memDb.auditLogs[0].action === 'FACULTY_BULK_IMPORT',
      'First APPLY writes a single FACULTY_BULK_IMPORT audit entry',
      JSON.stringify(memDb.auditLogs)
    );

    // Immediate second run must be 100% idempotent (including Dr. Anu Robert where teacherCode is null)
    const secondApply = await runFacultyImportWorkflow({
      connection: applyConn,
      mode: 'APPLY',
      referenceDate: '2026-05-15',
    });

    assert(
      secondApply.counts.readyOrInserted === 0 &&
        secondApply.counts.skippedIdempotent === 53 &&
        secondApply.counts.skippedPotentialDuplicate === 0 &&
        secondApply.counts.departmentsCreated === 0 &&
        memDb.departments.length === 14 &&
        memDb.teachers.length === 53 &&
        memDb.auditLogs.length === auditLogsAfterFirst,
      'Second APPLY is 100% idempotent (53 SKIPPED_IDEMPOTENT, 0 inserts, 0 duplicate departments, 0 extra audit logs)',
      JSON.stringify(secondApply.counts)
    );
  } finally {
    applyConn.release();
  }

  // =========================================================================
  // 7. TEACHER RECORDS & DEPARTMENT WORKSPACE API + RBAC ISOLATION
  // =========================================================================
  console.log('\n--- 6. Teacher Records API, Field Separation & Department Isolation ---');

  const saTempPwd = genSecret('InitSA');
  const saPermPwd = genSecret('PermSA');
  const hodTempPwd = genSecret('InitHOD');
  const hodPermPwd = genSecret('PermHOD');

  memDb.provisionInitialSuperAdmin({
    username: 'faculty_test_sa',
    email: 'faculty.sa@kamch.ac.in',
    password: saTempPwd,
    mustChangePassword: true,
  });

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  app.use('/api/users', userRouter);
  app.use('/api', recordsRouter);

  const server = app.listen(0);
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Login Super Admin & complete forced password change
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernameOrEmail: 'faculty_test_sa', password: saTempPwd }),
    });
    const loginData: any = await loginRes.json();
    const saCookies = extractCookies(loginRes);
    const saHeaders = makeHeaders(saCookies.session, loginData.csrfToken);

    const pwdRes = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({ currentPassword: saTempPwd, newPassword: saPermPwd }),
    });
    assert(pwdRes.status === 200, 'Super Admin authenticated for Teacher Records API checks');

    // 7a. GET /api/teachers returns all 53 imported faculty with distinct teacherCode & registrationNumber
    const allTeachersRes = await fetch(`${baseUrl}/api/teachers`, {
      headers: saHeaders,
    });
    const allTeachersBody: any = await allTeachersRes.json();
    assert(
      allTeachersRes.status === 200 && allTeachersBody.teachers?.length === 53,
      'GET /api/teachers returns all 53 imported faculty records to Super Admin',
      `count=${allTeachersBody.teachers?.length}`
    );

    // 7b. Filter by verificationRequired=true
    const flaggedRes = await fetch(`${baseUrl}/api/teachers?verificationRequired=true`, {
      headers: saHeaders,
    });
    const flaggedBody: any = await flaggedRes.json();
    assert(
      flaggedRes.status === 200 &&
        flaggedBody.teachers.length > 0 &&
        flaggedBody.teachers.every((t: any) => t.dataVerificationRequired === true),
      'GET /api/teachers?verificationRequired=true returns only records flagged for manual verification',
      `flaggedCount=${flaggedBody.teachers?.length}`
    );

    // 7c. Search by NCISM Teacher Code (AYRB00276 -> Dr. Manjunath S. Gavimath, Reg. No 15551)
    const searchCodeRes = await fetch(`${baseUrl}/api/teachers?search=AYRB00276`, {
      headers: saHeaders,
    });
    const searchCodeBody: any = await searchCodeRes.json();
    assert(
      searchCodeRes.status === 200 &&
        searchCodeBody.teachers.length === 1 &&
        searchCodeBody.teachers[0].teacherCode === 'AYRB00276' &&
        searchCodeBody.teachers[0].registrationNumber === '15551' &&
        searchCodeBody.teachers[0].employeeCode === '',
      'Search by NCISM Teacher Code returns exact record with separated registrationNumber ("15551") and blank employeeCode',
      JSON.stringify(searchCodeBody.teachers?.[0])
    );

    // 7d. POST /api/teachers creates a manual faculty record without requiring employeeCode
    const rsbkDept = memDb.departments.find(
      (d) => d.name === 'Rasashastra and Bhaishajya Kalpana'
    )!;
    const panchDept = memDb.departments.find((d) => d.name === 'Panchakarma')!;

    const createManualRes = await fetch(`${baseUrl}/api/teachers`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        teacherCode: 'AYRB99901',
        teacherCodeStatus: 'VERIFIED',
        registrationNumber: 'KA-55110',
        fullName: 'Dr. Manual Faculty Addition',
        designation: 'Assistant Professor',
        departmentId: rsbkDept.id,
        qualification: 'BAMS, MD (RSBK)',
        dateOfBirth: '1991-04-12',
        joiningDateService: '2022-06-01',
        joiningDateInstitute: '2024-01-15',
        reportedExperience: '2 Years 4 Months',
        previousInstitute: 'SDM College of Ayurveda',
        contactPhone: '9845011223',
        contactEmail: 'manual.rsbk@kamch.ac.in',
      }),
    });
    const createManualBody: any = await createManualRes.json();
    assert(
      createManualRes.status === 201 &&
        (createManualBody.id > 0 || createManualBody.teacher?.id > 0),
      'POST /api/teachers supports creating a faculty record with optional employeeCode and separated teacherCode/registrationNumber',
      JSON.stringify(createManualBody)
    );

    // Duplicate teacherCode rejection
    const dupTeacherCodeRes = await fetch(`${baseUrl}/api/teachers`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        teacherCode: 'AYRB99901',
        fullName: 'Dr. Duplicate Code Attempt',
        designation: 'Lecturer',
        departmentId: rsbkDept.id,
      }),
    });
    assert(
      dupTeacherCodeRes.status === 409,
      'POST /api/teachers rejects duplicate NCISM Teacher Code with HTTP 409'
    );

    // 7e. PUT /api/teachers/:id partial update preserves unedited fields & updates verification state
    const anuRow = allTeachersBody.teachers.find((t: any) =>
      t.fullName.includes('Anu Robert')
    );
    const updateAnuRes = await fetch(`${baseUrl}/api/teachers/${anuRow.id}`, {
      method: 'PUT',
      headers: saHeaders,
      body: JSON.stringify({
        fullName: anuRow.fullName,
        designation: anuRow.designation,
        teacherCode: 'AYST08888',
        teacherCodeStatus: 'VERIFIED',
        registrationNumber: 'KL-22687',
        dataVerificationRequired: false,
        verificationNotes: '',
      }),
    });
    assert(
      updateAnuRes.status === 200,
      'PUT /api/teachers/:id updates verified Teacher Code and Registration Number cleanly'
    );

    const checkAnuRes = await fetch(`${baseUrl}/api/teachers?search=AYST08888`, {
      headers: saHeaders,
    });
    const checkAnuBody: any = await checkAnuRes.json();
    assert(
      checkAnuBody.teachers.length === 1 &&
        checkAnuBody.teachers[0].registrationNumber === 'KL-22687' &&
        checkAnuBody.teachers[0].dateOfBirth === '1999-11-06' &&
        checkAnuBody.teachers[0].reportedExperience === '01 Year 05 Months' &&
        checkAnuBody.teachers[0].dataVerificationRequired === false,
      'PUT /api/teachers/:id preserves existing dateOfBirth & reportedExperience when updating identifiers',
      JSON.stringify(checkAnuBody.teachers?.[0])
    );

    // 7f. Department account isolation check
    const rolesRes = await fetch(`${baseUrl}/api/users/roles`, { headers: saHeaders });
    const rolesBody: any = await rolesRes.json();
    const deptRole = rolesBody.assignableRoles.find((r: any) => r.code === 'DEPARTMENT');

    const createHodRes = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        username: 'dept_rsbk_test',
        email: 'dept.rsbk@kamch.ac.in',
        fullName: 'RSBK Department Account',
        roleId: deptRole.id,
        departmentId: rsbkDept.id,
        initialPassword: hodTempPwd,
        confirmPassword: hodTempPwd,
      }),
    });
    assert(
      createHodRes.status === 201,
      'Provisioned DEPARTMENT account assigned to Rasashastra and Bhaishajya Kalpana'
    );

    const hodLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernameOrEmail: 'dept_rsbk_test', password: hodTempPwd }),
    });
    const hodLoginData: any = await hodLoginRes.json();
    const hodCookies = extractCookies(hodLoginRes);
    const hodHeaders = makeHeaders(hodCookies.session, hodLoginData.csrfToken);

    await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: hodHeaders,
      body: JSON.stringify({ currentPassword: hodTempPwd, newPassword: hodPermPwd }),
    });

    const hodTeachersRes = await fetch(`${baseUrl}/api/teachers`, {
      headers: hodHeaders,
    });
    const hodTeachersBody: any = await hodTeachersRes.json();
    assert(
      hodTeachersRes.status === 200 &&
        hodTeachersBody.teachers.length === 4 && // 3 imported RSBK + 1 manual RSBK
        hodTeachersBody.teachers.every((t: any) => t.departmentId === rsbkDept.id),
      'Department isolation enforced: Department account only receives faculty belonging to its assigned department',
      `got=${hodTeachersBody.teachers?.length}`
    );

    const hodCrossDeptPost = await fetch(`${baseUrl}/api/teachers`, {
      method: 'POST',
      headers: hodHeaders,
      body: JSON.stringify({
        fullName: 'Dr. Cross Dept Unauthorized',
        designation: 'Assistant Professor',
        departmentId: panchDept.id,
      }),
    });
    assert(
      hodCrossDeptPost.status === 403,
      'Department account is blocked (HTTP 403) from creating faculty in another department'
    );

    const hodWorkspaceRes = await fetch(`${baseUrl}/api/departments/my-workspace`, {
      headers: hodHeaders,
    });
    const hodWorkspaceBody: any = await hodWorkspaceRes.json();
    assert(
      hodWorkspaceRes.status === 200 &&
        hodWorkspaceBody.teachers?.length === 4 &&
        hodWorkspaceBody.teachers.some(
          (t: any) => t.teacherCode === 'AYRB00276' && t.registrationNumber === '15551'
        ),
      'GET /api/departments/my-workspace exposes separated teacherCode & registrationNumber for assigned department'
    );
  } finally {
    server.close();
    memDb.users = [];
    memDb.sessions = [];
    resetFacultyAndDeptStore();
  }

  console.log('\n==============================================================');
  console.log(`FACULTY IMPORT & TEACHER RECORDS SUITE: ${passed} passed, ${failed} failed`);
  console.log('==============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runFacultyImportTests().catch((err) => {
  console.error('Fatal test failure:', err);
  process.exit(1);
});
