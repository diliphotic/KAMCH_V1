import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { checkDatabaseConnection, getPool } from '../server/db.ts';
import { internalAssessmentRouter } from '../server/routes/internal-assessment.routes.ts';
import { MemoryDatabase } from '../server/services/memory-db.ts';
import {
  recalculateSubjectBatchIA,
  updateSubmittedMarkThroughAuthorizedProcess,
  approveStudentFinalIA,
  adjustStudentFinalIA,
  IaActionError,
} from '../server/services/ia-calculation.ts';

async function createTestSession(userId: number): Promise<{ cookieHeader: string; csrfToken: string }> {
  const pool = getPool();
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const csrfToken = crypto.randomBytes(24).toString('hex');

  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, ip_address, user_agent) VALUES (?, ?, '127.0.0.1', 'Step2E-Verification')`,
    [userId, tokenHash]
  );

  return {
    cookieHeader: `kamch_session=${rawToken}; kamch_csrf=${csrfToken}`,
    csrfToken,
  };
}

async function runStep2ETests() {
  console.log('=== KAMCH ERP Step 2E: Office Review & Final IA Approval Verification Suite ===\n');

  await checkDatabaseConnection();
  const memDb = MemoryDatabase.getInstance();
  const initialSnapshot = memDb.createSnapshot();

  // Mount real Express app with cookieParser + JSON + internalAssessmentRouter
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/internal-assessment', internalAssessmentRouter);

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}/api/internal-assessment`;

  try {
    const pool = getPool();

    // Seed Department, Office User, and Department User
    const [deptIns] = await pool.query<any>(
      `INSERT INTO departments (code, name, description, is_active) VALUES (?, ?, ?, TRUE)`,
      ['SAMHITA_DEPT', 'Department of Samhita & Siddhanta', 'Step 2E Verification Department']
    );
    const deptId = Number(deptIns.insertId);

    const [kayaDeptIns] = await pool.query<any>(
      `INSERT INTO departments (code, name, description, is_active) VALUES (?, ?, ?, TRUE)`,
      ['KAYA_DEPT', 'Department of Kayachikitsa', 'Step 2E 30-Mark Verification Department']
    );
    const kayaDeptId = Number(kayaDeptIns.insertId);

    const [officeRoleRows] = await pool.query<any[]>(`SELECT id FROM roles WHERE code = ?`, ['OFFICE']);
    const [deptRoleRows] = await pool.query<any[]>(`SELECT id FROM roles WHERE code = ?`, ['DEPARTMENT']);
    const officeRoleId = Number(officeRoleRows[0].id);
    const deptRoleId = Number(deptRoleRows[0].id);

    const pwHash = bcrypt.hashSync('VerifyStep2E#2026', 10);

    const [officeUserIns] = await pool.query<any>(
      `INSERT INTO users (username, email, password_hash, role_id, department_id, full_name, created_by)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      ['office_reviewer_2e', 'office2e@kamch.ac.in', pwHash, officeRoleId, null, 'Office IA Reviewer']
    );
    const officeUserId = Number(officeUserIns.insertId);
    await pool.query(`UPDATE users SET password_hash = ?, must_change_password = FALSE WHERE id = ?`, [
      pwHash,
      officeUserId,
    ]);

    const [deptUserIns] = await pool.query<any>(
      `INSERT INTO users (username, email, password_hash, role_id, department_id, full_name, created_by)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      ['samhita_dept_2e', 'samhita2e@kamch.ac.in', pwHash, deptRoleId, deptId, 'Samhita Dept Account']
    );
    const deptUserId = Number(deptUserIns.insertId);
    await pool.query(`UPDATE users SET password_hash = ?, must_change_password = FALSE WHERE id = ?`, [
      pwHash,
      deptUserId,
    ]);

    const officeSession = await createTestSession(officeUserId);
    const deptSession = await createTestSession(deptUserId);

    // Fetch batches, subjects, assessments
    const [batches] = await pool.query<any[]>(
      `/* IA:LIST_BATCHES */
       SELECT b.id, b.code, b.name, b.admission_academic_year, b.current_cohort_stage,
              b.current_professional_year, b.is_active, b.scheme_id,
              cs.code AS scheme_code, cs.is_legacy_minimal
       FROM academic_batches b
       LEFT JOIN curriculum_schemes cs ON b.scheme_id = cs.id
       ORDER BY b.display_order ASC, b.id ASC`
    );
    const vedangBatch = batches.find((b: any) => b.code === 'VEDANG');
    const agastyaBatch = batches.find((b: any) => b.code === 'AGASTYA');
    assert.ok(vedangBatch && agastyaBatch, 'Expected VEDANG and AGASTYA batches');

    const [subjects] = await pool.query<any[]>(
      `/* IA:LIST_SUBJECTS */
       SELECT s.*, d.name AS department_name, d.code AS department_code, d.is_active AS department_is_active
       FROM subjects s LEFT JOIN departments d ON s.department_id = d.id`
    );
    const samhita1 = subjects.find((s: any) => s.code === 'SAMHITA_1');
    const kayachikitsa = subjects.find((s: any) => s.code === 'KAYACHIKITSA');
    const researchMeth = subjects.find((s: any) => s.code === 'RESEARCH_METHODOLOGY');
    assert.ok(samhita1 && kayachikitsa && researchMeth, 'Expected seeded subjects');

    const [assessments] = await pool.query<any[]>(
      `/* IA:LIST_ASSESSMENTS */
       SELECT id, code, name, assessment_type, term_number, max_marks_theory, max_marks_practical, is_active
       FROM assessments ORDER BY term_number ASC, id ASC`
    );

    // Create 2 students in Vedang (1st Prof Year): Student A (complete) and Student B (incomplete / pending)
    const [stAIns] = await pool.query<any>(
      `INSERT INTO students (student_id_number, full_name, admission_category, admission_year, current_year_of_study, is_kea_eligible, kea_acknowledgement_no, mess_enrolled, hostel_enrolled, contact_phone, contact_email)
       VALUES (?, ?, 'GOVERNMENT', 2025, 1, TRUE, NULL, FALSE, FALSE, NULL, NULL)`,
      ['KAMCH-2E-001', 'Aarav Kulkarni']
    );
    const studentAId = Number(stAIns.insertId);

    const [stBIns] = await pool.query<any>(
      `INSERT INTO students (student_id_number, full_name, admission_category, admission_year, current_year_of_study, is_kea_eligible, kea_acknowledgement_no, mess_enrolled, hostel_enrolled, contact_phone, contact_email)
       VALUES (?, ?, 'GOVERNMENT', 2025, 1, TRUE, NULL, FALSE, FALSE, NULL, NULL)`,
      ['KAMCH-2E-002', 'Bhavana Deshmukh']
    );
    const studentBId = Number(stBIns.insertId);

    // Create 1 student in Agastya (3rd Prof Year) for 30-mark Kayachikitsa + Research Methodology checks
    const [stCIns] = await pool.query<any>(
      `INSERT INTO students (student_id_number, full_name, admission_category, admission_year, current_year_of_study, is_kea_eligible, kea_acknowledgement_no, mess_enrolled, hostel_enrolled, contact_phone, contact_email)
       VALUES (?, ?, 'GOVERNMENT', 2022, 3, TRUE, NULL, FALSE, FALSE, NULL, NULL)`,
      ['KAMCH-2E-003', 'Chirag Hegde']
    );
    const studentCId = Number(stCIns.insertId);

    for (const [sid, bid] of [
      [studentAId, vedangBatch.id],
      [studentBId, vedangBatch.id],
      [studentCId, agastyaBatch.id],
    ]) {
      const ms = memDb.students.find((s) => s.id === sid);
      if (ms) {
        ms.original_batch_id = bid;
        ms.current_placement_batch_id = bid;
      } else {
        await pool.query(
          `UPDATE students SET original_batch_id = ?, current_placement_batch_id = ? WHERE id = ?`,
          [bid, bid, sid]
        );
      }
    }

    // Link departments & configure verified PAT mapping on SAMHITA_1 (15 max) and KAYACHIKITSA (30 max)
    const verifiedMapping = {
      term1: { A: 'PAT_1', B: 'PAT_2', C: 'PAT_3' },
      term2: { A: 'PAT_4', B: 'PAT_5', C: 'PAT_6' },
      term3: { A: 'PAT_7', B: 'PAT_8', C: 'PAT_9' },
    };
    await pool.query(
      `/* IA:UPDATE_SUBJECT_CONFIG */ UPDATE subjects SET department_id = ?, pat_mapping_verified = ?, pat_mapping_config = ?, notes = ? WHERE id = ?`,
      [deptId, true, JSON.stringify(verifiedMapping), samhita1.notes, samhita1.id]
    );
    await pool.query(
      `/* IA:UPDATE_SUBJECT_CONFIG */ UPDATE subjects SET department_id = ?, pat_mapping_verified = ?, pat_mapping_config = ?, notes = ? WHERE id = ?`,
      [kayaDeptId, true, JSON.stringify(verifiedMapping), kayachikitsa.notes, kayachikitsa.id]
    );

    // Submit all 11 assessments for Vedang + SAMHITA_1:
    // Student A: all PATs = 12/15, TT1 = 80+80, TT2 = 80+80 => Auto IA = 12.00 (CALCULATED)
    // Student B: PAT_1 = NOT_APPEARED => Auto IA = null (PENDING)
    for (const a of assessments) {
      const isPat = a.assessment_type === 'PAT';
      await pool.query(
        `/* IA:UPSERT_STUDENT_MARK */
         INSERT INTO student_assessment_marks (student_id, subject_id, assessment_id, batch_id, outcome, theory_marks, practical_marks, is_draft, saved_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE outcome = VALUES(outcome), theory_marks = VALUES(theory_marks), practical_marks = VALUES(practical_marks), is_draft = VALUES(is_draft), saved_by = VALUES(saved_by)`,
        [studentAId, samhita1.id, a.id, vedangBatch.id, 'MARKS_ENTERED', isPat ? 12 : 80, isPat ? null : 80, false, deptUserId]
      );

      const stBOutcome = a.code === 'PAT_1' ? 'NOT_APPEARED' : 'MARKS_ENTERED';
      await pool.query(
        `/* IA:UPSERT_STUDENT_MARK */
         INSERT INTO student_assessment_marks (student_id, subject_id, assessment_id, batch_id, outcome, theory_marks, practical_marks, is_draft, saved_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE outcome = VALUES(outcome), theory_marks = VALUES(theory_marks), practical_marks = VALUES(practical_marks), is_draft = VALUES(is_draft), saved_by = VALUES(saved_by)`,
        [
          studentBId,
          samhita1.id,
          a.id,
          vedangBatch.id,
          stBOutcome,
          stBOutcome === 'MARKS_ENTERED' ? (isPat ? 12 : 80) : null,
          stBOutcome === 'MARKS_ENTERED' ? (isPat ? null : 80) : null,
          false,
          deptUserId,
        ]
      );

      await pool.query(
        `/* IA:INSERT_SUBMISSION */ INSERT INTO assessment_submissions (batch_id, subject_id, assessment_id, department_id, submitted_by, status) VALUES (?, ?, ?, ?, ?, 'SUBMITTED')`,
        [vedangBatch.id, samhita1.id, a.id, deptId, deptUserId]
      );
    }

    // Submit all 11 assessments for Agastya + KAYACHIKITSA (30-mark subject) for Student C:
    // PATs = 12/15 => E = 24.00; TT1 = 80+80 => F1 = 24.00; TT2 = 80+80 => F2 = 24.00 => Auto IA = 24.00
    for (const a of assessments) {
      const isPat = a.assessment_type === 'PAT';
      await pool.query(
        `/* IA:UPSERT_STUDENT_MARK */
         INSERT INTO student_assessment_marks (student_id, subject_id, assessment_id, batch_id, outcome, theory_marks, practical_marks, is_draft, saved_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE outcome = VALUES(outcome), theory_marks = VALUES(theory_marks), practical_marks = VALUES(practical_marks), is_draft = VALUES(is_draft), saved_by = VALUES(saved_by)`,
        [studentCId, kayachikitsa.id, a.id, agastyaBatch.id, 'MARKS_ENTERED', isPat ? 12 : 80, isPat ? null : 80, false, officeUserId]
      );
      await pool.query(
        `/* IA:INSERT_SUBMISSION */ INSERT INTO assessment_submissions (batch_id, subject_id, assessment_id, department_id, submitted_by, status) VALUES (?, ?, ?, ?, ?, 'SUBMITTED')`,
        [agastyaBatch.id, kayachikitsa.id, a.id, kayaDeptId, officeUserId]
      );
    }

    await recalculateSubjectBatchIA(vedangBatch.id, samhita1.id);
    await recalculateSubjectBatchIA(agastyaBatch.id, kayachikitsa.id);
    await recalculateSubjectBatchIA(agastyaBatch.id, researchMeth.id);

    // -------------------------------------------------------------------------
    // 1. Office users can view calculated IA results by batch, professional year, department and subject
    // -------------------------------------------------------------------------
    {
      const res = await fetch(
        `${baseUrl}/office-review?batchId=${vedangBatch.id}&subjectId=${samhita1.id}`,
        { headers: { Cookie: officeSession.cookieHeader } }
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.subject.professionalYear, 1);
      assert.equal(body.subject.departmentId, deptId);
      assert.equal(body.batch.id, vedangBatch.id);
      assert.equal(body.students.length, 2);

      const stA = body.students.find((s: any) => s.studentId === studentAId);
      const stB = body.students.find((s: any) => s.studentId === studentBId);
      assert.ok(stA && stB);

      // Verify raw PAT, raw Term Test, converted marks, Automatic IA breakdown, status, and review flags
      assert.equal(stA.rawAssessments.PAT_1.theoryMarks, 12);
      assert.equal(stA.rawAssessments.TERM_TEST_1.theoryMarks, 80);
      assert.equal(stA.rawAssessments.TERM_TEST_1.practicalMarks, 80);
      assert.equal(stA.termTestConversions[0].convertedMarks, 12);
      assert.equal(stA.calculation.calculationStatus, 'CALCULATED');
      assert.equal(stA.calculation.finalAutomaticIa, 12);
      assert.equal(stA.currentFinalStatus, 'AWAITING_APPROVAL');
      assert.equal(stA.officeReviewRequired, true);
      assert.equal(stA.canApproveOrAdjust, true);

      assert.equal(stB.calculation.calculationStatus, 'PENDING');
      assert.equal(stB.calculation.finalAutomaticIa, null);
      assert.equal(stB.currentFinalStatus, 'PENDING_CALCULATION');
      assert.equal(stB.canApproveOrAdjust, false);

      console.log(
        '[PASS] 1. Office user retrieves Office IA Review by batch, professional year, department & subject with raw marks, conversions & breakdown'
      );
    }

    // -------------------------------------------------------------------------
    // 2. Pending or not-applicable calculations cannot be approved
    // -------------------------------------------------------------------------
    {
      // Attempt to approve Student B (PENDING)
      const resPending = await fetch(`${baseUrl}/final-approval`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: officeSession.cookieHeader,
          'X-CSRF-Token': officeSession.csrfToken,
        },
        body: JSON.stringify({
          batchId: vedangBatch.id,
          subjectId: samhita1.id,
          studentId: studentBId,
        }),
      });
      assert.equal(resPending.status, 400);
      const errPending = await resPending.json();
      assert.equal(errPending.code, 'CALCULATION_NOT_APPROVABLE');

      // Attempt to approve Student C on Research Methodology (NOT_APPLICABLE)
      const resNotApp = await fetch(`${baseUrl}/final-approval`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: officeSession.cookieHeader,
          'X-CSRF-Token': officeSession.csrfToken,
        },
        body: JSON.stringify({
          batchId: agastyaBatch.id,
          subjectId: researchMeth.id,
          studentId: studentCId,
        }),
      });
      assert.equal(resNotApp.status, 400);
      const errNotApp = await resNotApp.json();
      assert.equal(errNotApp.code, 'SUBJECT_NOT_ELIGIBLE');

      console.log(
        '[PASS] 2. Pending and Not-Applicable IA records are strictly blocked from Final IA approval'
      );
    }

    // -------------------------------------------------------------------------
    // 3. Valid automatic IA results can be approved
    // -------------------------------------------------------------------------
    {
      const resApprove = await fetch(`${baseUrl}/final-approval`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: officeSession.cookieHeader,
          'X-CSRF-Token': officeSession.csrfToken,
        },
        body: JSON.stringify({
          batchId: vedangBatch.id,
          subjectId: samhita1.id,
          studentId: studentAId,
        }),
      });
      assert.equal(resApprove.status, 200);
      const approvedData = await resApprove.json();
      assert.equal(approvedData.approval.approvedFinalIa, 12);
      assert.equal(approvedData.approval.automaticIaAtApproval, 12);
      assert.equal(approvedData.approval.finalStatus, 'APPROVED');
      assert.equal(approvedData.approval.approvedBy, officeUserId);

      // Verify via GET /office-review
      const checkRes = await fetch(
        `${baseUrl}/office-review?batchId=${vedangBatch.id}&subjectId=${samhita1.id}`,
        { headers: { Cookie: officeSession.cookieHeader } }
      );
      const checkBody = await checkRes.json();
      const stA = checkBody.students.find((s: any) => s.studentId === studentAId);
      assert.equal(stA.approval.approvedFinalIa, 12);
      assert.equal(stA.currentFinalStatus, 'APPROVED');
      assert.equal(stA.officeReviewRequired, false);

      console.log(
        '[PASS] 3. Valid calculated Automatic IA approved and stored separately with approver & timestamp'
      );
    }

    // -------------------------------------------------------------------------
    // 4. Manual adjustments require a reason category and mandatory written explanation
    //    (supporting Academic Excellence AND other legitimate categories)
    // -------------------------------------------------------------------------
    {
      // Missing reasonCategory
      const resMissingCat = await fetch(`${baseUrl}/manual-adjustment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: officeSession.cookieHeader,
          'X-CSRF-Token': officeSession.csrfToken,
        },
        body: JSON.stringify({
          batchId: vedangBatch.id,
          subjectId: samhita1.id,
          studentId: studentAId,
          adjustedFinalIa: 14,
          reasonCategory: '',
          explanation: 'Documented excellence in Samhita recitation.',
        }),
      });
      assert.equal(resMissingCat.status, 400);
      assert.equal((await resMissingCat.json()).code, 'INVALID_REASON_CATEGORY');

      // Missing explanation
      const resMissingExp = await fetch(`${baseUrl}/manual-adjustment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: officeSession.cookieHeader,
          'X-CSRF-Token': officeSession.csrfToken,
        },
        body: JSON.stringify({
          batchId: vedangBatch.id,
          subjectId: samhita1.id,
          studentId: studentAId,
          adjustedFinalIa: 14,
          reasonCategory: 'ACADEMIC_EXCELLENCE',
          explanation: '   ',
        }),
      });
      assert.equal(resMissingExp.status, 400);
      assert.equal((await resMissingExp.json()).code, 'MISSING_EXPLANATION');

      // Succeeds with ACADEMIC_EXCELLENCE + written explanation on Student A (15-mark subject)
      const resAdjExcellence = await fetch(`${baseUrl}/manual-adjustment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: officeSession.cookieHeader,
          'X-CSRF-Token': officeSession.csrfToken,
        },
        body: JSON.stringify({
          batchId: vedangBatch.id,
          subjectId: samhita1.id,
          studentId: studentAId,
          adjustedFinalIa: 14.5,
          reasonCategory: 'ACADEMIC_EXCELLENCE',
          explanation: 'First rank in inter-collegiate Samhita Adhyayana symposium.',
        }),
      });
      assert.equal(resAdjExcellence.status, 200);
      const adjBody = await resAdjExcellence.json();
      assert.equal(adjBody.approval.approvedFinalIa, 14.5);
      assert.equal(adjBody.approval.previousFinalIa, 12);
      assert.equal(adjBody.approval.reasonCategory, 'ACADEMIC_EXCELLENCE');

      // Also succeeds with another legitimate category (INSTITUTIONAL_REPRESENTATION) on Student C (30-mark subject)
      const resAdjOtherCat = await fetch(`${baseUrl}/manual-adjustment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: officeSession.cookieHeader,
          'X-CSRF-Token': officeSession.csrfToken,
        },
        body: JSON.stringify({
          batchId: agastyaBatch.id,
          subjectId: kayachikitsa.id,
          studentId: studentCId,
          adjustedFinalIa: 27,
          reasonCategory: 'INSTITUTIONAL_REPRESENTATION',
          explanation: 'Represented college at University Ayurveda Clinical Conference.',
        }),
      });
      assert.equal(resAdjOtherCat.status, 200);
      assert.equal((await resAdjOtherCat.json()).approval.approvedFinalIa, 27);

      console.log(
        '[PASS] 4. Manual adjustments enforce reason category & mandatory written explanation (Academic Excellence + other legitimate categories)'
      );
    }

    // -------------------------------------------------------------------------
    // 5. Manual adjustments cannot exceed the subject's IA maximum (or be negative)
    // -------------------------------------------------------------------------
    {
      // Exceed 15 on SAMHITA_1 (15-mark max)
      const resOver15 = await fetch(`${baseUrl}/manual-adjustment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: officeSession.cookieHeader,
          'X-CSRF-Token': officeSession.csrfToken,
        },
        body: JSON.stringify({
          batchId: vedangBatch.id,
          subjectId: samhita1.id,
          studentId: studentAId,
          adjustedFinalIa: 15.5,
          reasonCategory: 'ACADEMIC_EXCELLENCE',
          explanation: 'Attempt exceeding 15 max.',
        }),
      });
      assert.equal(resOver15.status, 400);
      assert.equal((await resOver15.json()).code, 'FINAL_MARK_OUT_OF_RANGE');

      // Exceed 30 on KAYACHIKITSA (30-mark max)
      const resOver30 = await fetch(`${baseUrl}/manual-adjustment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: officeSession.cookieHeader,
          'X-CSRF-Token': officeSession.csrfToken,
        },
        body: JSON.stringify({
          batchId: agastyaBatch.id,
          subjectId: kayachikitsa.id,
          studentId: studentCId,
          adjustedFinalIa: 31,
          reasonCategory: 'ACADEMIC_EXCELLENCE',
          explanation: 'Attempt exceeding 30 max.',
        }),
      });
      assert.equal(resOver30.status, 400);
      assert.equal((await resOver30.json()).code, 'FINAL_MARK_OUT_OF_RANGE');

      // Negative mark rejected
      const resNeg = await fetch(`${baseUrl}/manual-adjustment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: officeSession.cookieHeader,
          'X-CSRF-Token': officeSession.csrfToken,
        },
        body: JSON.stringify({
          batchId: vedangBatch.id,
          subjectId: samhita1.id,
          studentId: studentAId,
          adjustedFinalIa: -1,
          reasonCategory: 'OTHER_ACADEMIC_JUSTIFICATION',
          explanation: 'Negative mark test.',
        }),
      });
      assert.equal(resNeg.status, 400);
      assert.equal((await resNeg.json()).code, 'FINAL_MARK_OUT_OF_RANGE');

      console.log(
        '[PASS] 5. Manual adjustments strictly enforce [0, ia_maximum] bounds for both 15-mark and 30-mark subjects'
      );
    }

    // -------------------------------------------------------------------------
    // 6. Automatic IA remains unchanged when a manual adjustment is saved
    // -------------------------------------------------------------------------
    {
      const [calcRows] = await pool.query<any[]>(
        `/* IA:GET_STUDENT_IA_CALCULATION_SINGLE */
         SELECT siac.*, s.student_id_number AS studentIdNumber, s.temporary_roll_number AS temporaryRollNumber,
                s.permanent_university_number AS permanentUniversityNumber, s.full_name AS fullName,
                s.administrative_status AS administrativeStatus
         FROM student_ia_calculations siac
         JOIN students s ON s.id = siac.student_id
         WHERE siac.student_id = ? AND siac.batch_id = ? AND siac.subject_id = ? LIMIT 1`,
        [studentAId, vedangBatch.id, samhita1.id]
      );
      assert.equal(Number(calcRows[0].final_automatic_ia), 12);

      const [appRows] = await pool.query<any[]>(
        `/* IA:GET_FINAL_APPROVAL_FOR_STUDENT */
         SELECT sfia.*, u.username AS approved_by_username, u.full_name AS approved_by_fullname
         FROM student_final_ia_approvals sfia
         LEFT JOIN users u ON u.id = sfia.approved_by
         WHERE sfia.student_id = ? AND sfia.batch_id = ? AND sfia.subject_id = ? LIMIT 1`,
        [studentAId, vedangBatch.id, samhita1.id]
      );
      assert.equal(Number(appRows[0].approved_final_ia), 14.5);
      assert.equal(Number(appRows[0].automatic_ia_at_approval), 12);

      console.log(
        '[PASS] 6. Stored Automatic IA (12.00) remains completely untouched when manual Final IA adjustment (14.50) is saved'
      );
    }

    // -------------------------------------------------------------------------
    // 7. Approval and adjustment history is persisted and visible (+ audit_logs)
    // -------------------------------------------------------------------------
    {
      const histRes = await fetch(
        `${baseUrl}/final-history?batchId=${vedangBatch.id}&subjectId=${samhita1.id}&studentId=${studentAId}`,
        { headers: { Cookie: officeSession.cookieHeader } }
      );
      assert.equal(histRes.status, 200);
      const histData = await histRes.json();
      assert.equal(histData.history.length, 2);
      // Most recent first: MANUAL_ADJUSTMENT (12 -> 14.5), followed by APPROVED_AS_CALCULATED (null -> 12)
      assert.equal(histData.history[0].actionType, 'MANUAL_ADJUSTMENT');
      assert.equal(histData.history[0].previousFinalIa, 12);
      assert.equal(histData.history[0].newFinalIa, 14.5);
      assert.equal(histData.history[0].automaticIaValue, 12);
      assert.equal(histData.history[0].reasonCategory, 'ACADEMIC_EXCELLENCE');
      assert.ok(histData.history[0].explanation.includes('symposium'));

      assert.equal(histData.history[1].actionType, 'APPROVED_AS_CALCULATED');
      assert.equal(histData.history[1].previousFinalIa, null);
      assert.equal(histData.history[1].newFinalIa, 12);

      // Verify general audit_logs service integration
      const [auditRows] = await pool.query<any[]>(
        `SELECT * FROM audit_logs al WHERE al.action = ? LIMIT 10`,
        ['FINAL_IA_MANUALLY_ADJUSTED']
      );
      assert.ok(auditRows.length >= 1, 'Expected FINAL_IA_MANUALLY_ADJUSTED in audit_logs');

      console.log(
        '[PASS] 7. Approval & manual adjustment chronological history and institutional audit_logs are persisted and visible'
      );
    }

    // -------------------------------------------------------------------------
    // 8. Recalculation after a source-mark change flags an already approved record
    //    for office review without silently overwriting the previously approved Final IA
    // -------------------------------------------------------------------------
    {
      const tt1Assess = assessments.find((a: any) => a.code === 'TERM_TEST_1');
      // Authorized source correction changes TT1 from 80+80 (F1=12) to 100+100 (F1=15) => Auto IA becomes 12.50
      await updateSubmittedMarkThroughAuthorizedProcess({
        batchId: vedangBatch.id,
        subjectId: samhita1.id,
        assessmentId: tt1Assess.id,
        studentId: studentAId,
        outcome: 'MARKS_ENTERED',
        theoryMarks: 100,
        practicalMarks: 100,
        authorizedActorId: officeUserId,
      });

      const reviewRes = await fetch(
        `${baseUrl}/office-review?batchId=${vedangBatch.id}&subjectId=${samhita1.id}`,
        { headers: { Cookie: officeSession.cookieHeader } }
      );
      assert.equal(reviewRes.status, 200);
      const reviewBody = await reviewRes.json();
      const stA = reviewBody.students.find((s: any) => s.studentId === studentAId);

      // Updated Automatic IA is 12.50, while previously approved Final IA (14.50) is strictly preserved!
      assert.equal(stA.calculation.finalAutomaticIa, 12.5);
      assert.equal(stA.approval.approvedFinalIa, 14.5);
      assert.equal(stA.approval.automaticIaAtApproval, 12);
      assert.equal(stA.approval.requiresOfficeReview, true);
      assert.equal(stA.currentFinalStatus, 'REQUIRES_REVIEW');
      assert.equal(stA.officeReviewRequired, true);
      assert.equal(reviewBody.reviewSummary.requiresReReviewCount, 1);
      assert.equal(stA.history[0].actionType, 'FLAGGED_FOR_REVIEW_ON_RECALC');

      // Verify office can subsequently re-approve the updated Automatic IA (12.50), clearing the review flag
      const reApproveRes = await fetch(`${baseUrl}/final-approval`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: officeSession.cookieHeader,
          'X-CSRF-Token': officeSession.csrfToken,
        },
        body: JSON.stringify({
          batchId: vedangBatch.id,
          subjectId: samhita1.id,
          studentId: studentAId,
        }),
      });
      assert.equal(reApproveRes.status, 200);
      const reApproved = await reApproveRes.json();
      assert.equal(reApproved.approval.previousFinalIa, 14.5);
      assert.equal(reApproved.approval.approvedFinalIa, 12.5);
      assert.equal(reApproved.approval.automaticIaAtApproval, 12.5);
      assert.equal(reApproved.approval.requiresOfficeReview, false);

      console.log(
        '[PASS] 8. Source-mark recalculation flags existing approval for office review while preserving approved Final IA until explicitly re-reviewed'
      );
    }

    // -------------------------------------------------------------------------
    // 9. Department accounts cannot approve or adjust Final IA marks (HTTP + Service)
    // -------------------------------------------------------------------------
    {
      const deptReviewRes = await fetch(
        `${baseUrl}/office-review?batchId=${vedangBatch.id}&subjectId=${samhita1.id}`,
        { headers: { Cookie: deptSession.cookieHeader } }
      );
      assert.equal(deptReviewRes.status, 403);

      const deptApproveRes = await fetch(`${baseUrl}/final-approval`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: deptSession.cookieHeader,
          'X-CSRF-Token': deptSession.csrfToken,
        },
        body: JSON.stringify({
          batchId: vedangBatch.id,
          subjectId: samhita1.id,
          studentId: studentAId,
        }),
      });
      assert.equal(deptApproveRes.status, 403);

      const deptAdjustRes = await fetch(`${baseUrl}/manual-adjustment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: deptSession.cookieHeader,
          'X-CSRF-Token': deptSession.csrfToken,
        },
        body: JSON.stringify({
          batchId: vedangBatch.id,
          subjectId: samhita1.id,
          studentId: studentAId,
          adjustedFinalIa: 15,
          reasonCategory: 'ACADEMIC_EXCELLENCE',
          explanation: 'Unauthorized department attempt.',
        }),
      });
      assert.equal(deptAdjustRes.status, 403);

      // Direct service-level defense-in-depth check
      await assert.rejects(
        async () => {
          await approveStudentFinalIA({
            studentId: studentAId,
            batchId: vedangBatch.id,
            subjectId: samhita1.id,
            actorId: deptUserId,
            actorRole: 'DEPARTMENT',
          });
        },
        (err: unknown) => err instanceof IaActionError && err.statusCode === 403
      );

      await assert.rejects(
        async () => {
          await adjustStudentFinalIA({
            studentId: studentAId,
            batchId: vedangBatch.id,
            subjectId: samhita1.id,
            adjustedFinalIa: 15,
            reasonCategory: 'ACADEMIC_EXCELLENCE',
            explanation: 'Unauthorized service call.',
            actorId: deptUserId,
            actorRole: 'HOD',
          });
        },
        (err: unknown) => err instanceof IaActionError && err.statusCode === 403
      );

      console.log(
        '[PASS] 9. Department and HOD accounts are strictly blocked (HTTP 403 & service guard) from viewing Office Review or approving/adjusting Final IA'
      );
    }

    console.log('\nALL 9 STEP 2E OFFICE REVIEW & FINAL IA APPROVAL TESTS PASSED SUCCESSFULLY.');
  } finally {
    memDb.restoreSnapshot(initialSnapshot);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runStep2ETests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[FAIL] Step 2E Office IA Approval Test Suite failed:', err);
    process.exit(1);
  });
