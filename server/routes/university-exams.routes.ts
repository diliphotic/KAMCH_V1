import { Router, Request, Response } from 'express';
import { getPool } from '../db.ts';
import { requireAuth, requirePasswordChangeClear, requireRoles } from '../middleware/auth.ts';
import { validateCsrf } from '../middleware/csrf.ts';
import { recordAuditLog } from '../services/audit.ts';
import { ROLES } from '../permissions.ts';

export const universityExamsRouter = Router();

const OFFICE_EXAM_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.PRINCIPAL,
  ROLES.SECRETARY,
  ROLES.OFFICE,
  ROLES.STAFF,
];

const GENERAL_EXAM_ROLES = [
  ...OFFICE_EXAM_ROLES,
  ROLES.STUDENT,
];

universityExamsRouter.use(requireAuth);
universityExamsRouter.use(requirePasswordChangeClear);

/**
 * GET /api/university-exams/subjects?batchId=<id>
 * Automatically resolves batch's curriculum scheme and professional year on the server,
 * and returns applicable university subjects.
 */
universityExamsRouter.get(
  '/subjects',
  requireRoles(...GENERAL_EXAM_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const batchIdParam = req.query.batchId ? parseInt(String(req.query.batchId), 10) : null;
    if (!batchIdParam || isNaN(batchIdParam)) {
      res.status(400).json({ error: 'Valid batch ID is required', code: 'MISSING_BATCH_ID' });
      return;
    }

    try {
      const pool = getPool();
      const [batchRows] = await pool.query<any[]>(
        `SELECT b.id, b.code, b.name, b.current_professional_year, b.scheme_id,
                cs.code AS scheme_code, cs.is_legacy_minimal
         FROM academic_batches b
         LEFT JOIN curriculum_schemes cs ON b.scheme_id = cs.id
         WHERE b.id = ? LIMIT 1`,
        [batchIdParam]
      );

      if (!batchRows || batchRows.length === 0) {
        res.status(404).json({ error: 'Academic batch not found', code: 'NOT_FOUND' });
        return;
      }

      const batch = batchRows[0];
      let schemeId = Number(batch.scheme_id);
      if (!schemeId || isNaN(schemeId)) {
        const [schemeRows] = await pool.query<any[]>(
          'SELECT id FROM curriculum_schemes WHERE code = ? LIMIT 1',
          [batch.scheme_code || 'RS7']
        );
        if (schemeRows && schemeRows.length > 0) {
          schemeId = Number(schemeRows[0].id);
        }
      }
      const profYear = batch.current_professional_year !== null && batch.current_professional_year !== undefined
        ? Number(batch.current_professional_year)
        : null;

      if (profYear === null || profYear <= 0) {
        res.json({ success: true, professionalYear: null, subjects: [] });
        return;
      }

      let [subjectRows] = await pool.query<any[]>(
        `SELECT id, code, name, professional_year, scheme_id, max_marks, is_active
         FROM university_subjects
         WHERE scheme_id = ? AND professional_year = ? AND is_active = TRUE
         ORDER BY name ASC`,
        [schemeId, profYear]
      );

      if (!subjectRows || subjectRows.length === 0) {
        const [altRows] = await pool.query<any[]>(
          `SELECT id, code, name, professional_year, scheme_id, max_marks, is_active
           FROM university_subjects
           WHERE professional_year = ? AND is_active = TRUE
           ORDER BY name ASC`,
          [profYear]
        );
        if (altRows && altRows.length > 0) {
          subjectRows = altRows;
        }
      }

      res.json({
        success: true,
        batchId: batch.id,
        batchName: batch.name,
        schemeCode: batch.scheme_code || 'RS7',
        professionalYear: profYear,
        subjects: subjectRows.map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          professionalYear: s.professional_year,
          maxMarks: Number(s.max_marks || 100),
        })),
      });
    } catch (err) {
      console.error('[KAMCH Univ Exams] Error fetching university subjects:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve university subjects', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * GET /api/university-exams/results?batchId=<id>
 * Returns students currently placed in the selected batch along with their university exam attempts and finalization status.
 */
universityExamsRouter.get(
  '/results',
  requireRoles(...GENERAL_EXAM_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const batchIdParam = req.query.batchId ? parseInt(String(req.query.batchId), 10) : null;
    if (!batchIdParam || isNaN(batchIdParam)) {
      res.status(400).json({ error: 'Valid batch ID is required', code: 'MISSING_BATCH_ID' });
      return;
    }

    try {
      const pool = getPool();
      const [batchRows] = await pool.query<any[]>(
        `SELECT b.id, b.code, b.name, b.current_professional_year, b.scheme_id,
                cs.code AS scheme_code, cs.is_legacy_minimal
         FROM academic_batches b
         LEFT JOIN curriculum_schemes cs ON b.scheme_id = cs.id
         WHERE b.id = ? LIMIT 1`,
        [batchIdParam]
      );

      if (!batchRows || batchRows.length === 0) {
        res.status(404).json({ error: 'Academic batch not found', code: 'NOT_FOUND' });
        return;
      }
      const batch = batchRows[0];
      const profYear = batch.current_professional_year !== null && batch.current_professional_year !== undefined
        ? Number(batch.current_professional_year)
        : null;

      // If user is student, restrict to own record
      let studentFilterSql = '(s.current_placement_batch_id = ? OR s.original_batch_id = ?)';
      const queryParams: any[] = [batchIdParam, batchIdParam];
      if (req.user!.role === 'STUDENT') {
        studentFilterSql += ' AND s.id = ?';
        queryParams.push(req.user!.id);
      }

      const [students] = await pool.query<any[]>(
        `SELECT s.id, s.student_id_number AS studentIdNumber, s.temporary_roll_number AS temporaryRollNumber,
                s.permanent_university_number AS permanentUniversityNumber, s.full_name AS fullName,
                s.administrative_status AS administrativeStatus,
                s.original_batch_id AS originalBatchId, orig_b.name AS originalBatchName,
                s.current_placement_batch_id AS currentPlacementBatchId,
                s.current_year_of_study AS currentYearOfStudy,
                s.detention_stage AS detentionStage,
                s.progression_status AS progressionStatus,
                s.outstanding_backlogs_count AS outstandingBacklogsCount
         FROM students s
         LEFT JOIN academic_batches orig_b ON s.original_batch_id = orig_b.id
         WHERE ${studentFilterSql} AND s.administrative_status != 'CANCELLED'
         ORDER BY s.full_name ASC`,
        queryParams
      );

      const studentIds = students.map((s) => s.id);
      let attempts: any[] = [];
      if (studentIds.length > 0) {
        const [attemptRows] = await pool.query<any[]>(
          `SELECT suea.id, suea.student_id, suea.subject_id, suea.exam_session_ref,
                  suea.attempt_type, suea.result_status, suea.marks_obtained,
                  suea.failed_subjects_json, suea.office_decision, suea.recorded_at,
                  suea.is_finalized, suea.finalized_by, suea.finalized_at, suea.finalization_remarks,
                  u_fin.full_name AS finalized_by_name,
                  us.code AS subject_code, us.name AS subject_name, us.professional_year
           FROM student_university_exam_attempts suea
           LEFT JOIN university_subjects us ON suea.subject_id = us.id
           LEFT JOIN users u_fin ON suea.finalized_by = u_fin.id
           WHERE suea.student_id IN (?)
           ORDER BY suea.recorded_at DESC`,
          [studentIds]
        );
        attempts = attemptRows;
      }

      const attemptsByStudent = new Map<number, any[]>();
      for (const att of attempts) {
        const sid = Number(att.student_id);
        if (!attemptsByStudent.has(sid)) {
          attemptsByStudent.set(sid, []);
        }
        attemptsByStudent.get(sid)!.push({
          id: att.id,
          subjectId: att.subject_id,
          subjectCode: att.subject_code,
          subjectName: att.subject_name,
          professionalYear: att.professional_year,
          examSessionRef: att.exam_session_ref,
          attemptType: att.attempt_type,
          resultStatus: att.result_status,
          marksObtained: att.marks_obtained !== null ? Number(att.marks_obtained) : null,
          failedSubjects: att.failed_subjects_json ? (typeof att.failed_subjects_json === 'string' ? JSON.parse(att.failed_subjects_json) : att.failed_subjects_json) : [],
          officeDecision: att.office_decision,
          isFinalized: Boolean(att.is_finalized),
          finalizedBy: att.finalized_by || null,
          finalizedByName: att.finalized_by_name || null,
          finalizedAt: att.finalized_at || null,
          finalizationRemarks: att.finalization_remarks || null,
          recordedAt: att.recorded_at,
        });
      }

      res.json({
        success: true,
        batchId: batch.id,
        batchName: batch.name,
        schemeCode: batch.scheme_code || 'RS7',
        professionalYear: profYear,
        students: students.map((s) => ({
          id: s.id,
          studentIdNumber: s.studentIdNumber,
          temporaryRollNumber: s.temporaryRollNumber || s.studentIdNumber,
          permanentUniversityNumber: s.permanentUniversityNumber || null,
          fullName: s.fullName,
          originalBatchId: s.originalBatchId,
          originalBatchName: s.originalBatchName || 'Original Cohort',
          currentPlacementBatchId: s.currentPlacementBatchId,
          currentYearOfStudy: s.currentYearOfStudy,
          detentionStage: s.detentionStage || 0,
          progressionStatus: s.progressionStatus || 'ACTIVE',
          outstandingBacklogsCount: s.outstandingBacklogsCount || 0,
          attempts: attemptsByStudent.get(Number(s.id)) || [],
        })),
      });
    } catch (err) {
      console.error('[KAMCH Univ Exams] Error fetching university exam results:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve university exam results', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * POST /api/university-exams/results
 * Authorized office roles record official university exam results and office decisions.
 */
universityExamsRouter.post(
  '/results',
  requireRoles(...OFFICE_EXAM_ROLES),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const { batchId, studentId, subjectId, examSessionRef, attemptType, resultStatus, marksObtained, failedSubjectIds, officeDecision } = req.body || {};

    const parsedBatch = parseInt(batchId, 10);
    const parsedStudent = parseInt(studentId, 10);
    let parsedSubject = subjectId ? parseInt(subjectId, 10) : 0;
    const cleanSession = String(examSessionRef || '').trim();
    const cleanAttempt = String(attemptType || 'REGULAR').trim().toUpperCase();
    const cleanStatus = String(resultStatus || '').trim().toUpperCase();
    const cleanDecision = String(officeDecision || 'PENDING').trim().toUpperCase();

    if (!parsedBatch || isNaN(parsedBatch) || !parsedStudent || isNaN(parsedStudent) || !cleanSession) {
      res.status(400).json({ error: 'Batch ID, Student ID, and Exam Session Reference are required', code: 'MISSING_FIELDS' });
      return;
    }

    if (!['REGULAR', 'SUPPLEMENTARY'].includes(cleanAttempt)) {
      res.status(400).json({ error: 'Invalid attempt type. Expected REGULAR or SUPPLEMENTARY.', code: 'INVALID_ATTEMPT_TYPE' });
      return;
    }

    if (!['PASS', 'FAIL', 'PENDING', 'WITHHELD'].includes(cleanStatus)) {
      res.status(400).json({ error: 'Invalid result status. Expected PASS, FAIL, PENDING, or WITHHELD.', code: 'INVALID_STATUS' });
      return;
    }

    if (!['PROMOTED', 'DETAINED', 'PENDING'].includes(cleanDecision)) {
      res.status(400).json({ error: 'Invalid office decision. Expected PROMOTED, DETAINED, or PENDING.', code: 'INVALID_DECISION' });
      return;
    }

    // Rule: PENDING or WITHHELD results cannot trigger promotion decisions
    if ((cleanStatus === 'PENDING' || cleanStatus === 'WITHHELD') && cleanDecision === 'PROMOTED') {
      res.status(400).json({ error: 'Pending or Withheld examination results cannot trigger a Promoted office decision.', code: 'INVALID_PROMOTION_DECISION' });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // 1. Verify batch and server-side professional year & scheme resolution
      const [batchRows] = await connection.query<any[]>(
        `SELECT id, current_professional_year, scheme_id FROM academic_batches WHERE id = ? LIMIT 1`,
        [parsedBatch]
      );
      if (!batchRows || batchRows.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: 'Academic batch not found', code: 'NOT_FOUND' });
        return;
      }
      const batch = batchRows[0];
      const batchProfYear = Number(batch.current_professional_year) || 1;
      const batchSchemeId = Number(batch.scheme_id);

      // Auto-resolve first university subject for batch's professional year if none specified
      if (!parsedSubject || isNaN(parsedSubject)) {
        const [firstSubjRows] = await pool.query<any[]>(
          `SELECT id FROM university_subjects
           WHERE (scheme_id = ? OR scheme_id IS NULL) AND professional_year = ? AND is_active = TRUE
           ORDER BY id ASC LIMIT 1`,
          [batchSchemeId, batchProfYear]
        );
        if (firstSubjRows && firstSubjRows.length > 0) {
          parsedSubject = Number(firstSubjRows[0].id);
        }
      }

      // 2. Verify subject belongs to batch's professional year
      const [subjRows] = await connection.query<any[]>(
        `SELECT id, code, name, professional_year, scheme_id FROM university_subjects WHERE id = ? LIMIT 1`,
        [parsedSubject]
      );
      if (!subjRows || subjRows.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: 'University subject not found', code: 'NOT_FOUND' });
        return;
      }
      const subject = subjRows[0];
      if (Number(subject.professional_year) !== batchProfYear) {
        await connection.rollback();
        res.status(400).json({
          error: `Subject "${subject.name}" (Professional Year ${subject.professional_year}) does not match selected batch profile (Professional Year ${batchProfYear}).`,
          code: 'INCOMPATIBLE_SUBJECT_BATCH',
        });
        return;
      }

      // 3. Verify student placement
      const [studentRows] = await connection.query<any[]>(
        `SELECT id, full_name, current_placement_batch_id, original_batch_id FROM students WHERE id = ? LIMIT 1`,
        [parsedStudent]
      );
      if (!studentRows || studentRows.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: 'Student not found', code: 'NOT_FOUND' });
        return;
      }

      const cleanMarks = marksObtained !== undefined && marksObtained !== null && String(marksObtained).trim() !== ''
        ? Number(marksObtained)
        : null;

      const failedJson = Array.isArray(failedSubjectIds) && failedSubjectIds.length > 0
        ? JSON.stringify(failedSubjectIds.map(Number))
        : null;

      // 3. Check if attempt already exists for this student in this session & attempt type
      const [existingAttempts] = await connection.query<any[]>(
        `SELECT id, subject_id, is_finalized FROM student_university_exam_attempts
         WHERE student_id = ? AND exam_session_ref = ? AND attempt_type = ?
         LIMIT 1`,
        [parsedStudent, cleanSession, cleanAttempt]
      );

      if (existingAttempts && existingAttempts.length > 0) {
        if (existingAttempts[0].is_finalized) {
          await connection.rollback();
          res.status(400).json({
            error: 'This examination result is finalized and cannot be modified directly. Use Reopen for Correction with documented justification.',
            code: 'RESULT_ALREADY_FINALIZED',
          });
          return;
        }

        // Update the existing session-level attempt consistently by ID
        await connection.query(
          `UPDATE student_university_exam_attempts
           SET result_status = ?,
               marks_obtained = ?,
               failed_subjects_json = ?,
               office_decision = ?,
               recorded_by = ?,
               recorded_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [
            cleanStatus,
            cleanMarks,
            failedJson,
            cleanDecision,
            req.user!.id,
            existingAttempts[0].id,
          ]
        );
      } else {
        // Insert new session-level attempt with verified subject
        await connection.query(
          `INSERT INTO student_university_exam_attempts
             (student_id, subject_id, exam_session_ref, attempt_type, result_status, marks_obtained, failed_subjects_json, office_decision, recorded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            parsedStudent,
            parsedSubject,
            cleanSession,
            cleanAttempt,
            cleanStatus,
            cleanMarks,
            failedJson,
            cleanDecision,
            req.user!.id,
          ]
        );
      }

      await connection.commit();

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'UNIVERSITY_EXAM_RESULT_RECORDED',
        targetType: 'STUDENT_UNIVERSITY_ATTEMPT',
        targetId: `${parsedStudent}-${parsedSubject}-${cleanSession}-${cleanAttempt}`,
        ipAddress: req.ip || null,
        details: {
          batchId: parsedBatch,
          studentId: parsedStudent,
          subjectId: parsedSubject,
          examSessionRef: cleanSession,
          attemptType: cleanAttempt,
          resultStatus: cleanStatus,
          officeDecision: cleanDecision,
        },
      });

      res.json({
        success: true,
        message: 'Official university examination result and office decision recorded successfully.',
      });
    } catch (err) {
      await connection.rollback();
      console.error('[KAMCH Univ Exams] Error recording university exam result:', (err as Error).message);
      res.status(500).json({ error: 'Failed to record university exam result', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

/**
 * POST /api/university-exams/finalize
 * Authorized office roles review and finalize eligible exam results.
 * Strictly prevents finalizing PENDING or WITHHELD results into passes or failures.
 */
universityExamsRouter.post(
  '/finalize',
  requireRoles(...OFFICE_EXAM_ROLES),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const { batchId, examSessionRef, attemptType, attemptIds, remarks } = req.body || {};
    const parsedBatch = parseInt(batchId, 10);
    const cleanSession = String(examSessionRef || '').trim();
    const cleanAttempt = String(attemptType || 'REGULAR').trim().toUpperCase();
    const cleanRemarks = String(remarks || 'Reviewed and finalized official university examination results.').trim();

    if (!parsedBatch || isNaN(parsedBatch) || !cleanSession) {
      res.status(400).json({ error: 'Valid Batch ID and Exam Session Reference are required', code: 'MISSING_FIELDS' });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      let querySql = `
        SELECT suea.id, suea.student_id, suea.subject_id, suea.result_status, suea.is_finalized,
               s.full_name, us.name AS subject_name
        FROM student_university_exam_attempts suea
        JOIN students s ON suea.student_id = s.id
        LEFT JOIN university_subjects us ON suea.subject_id = us.id
        WHERE (s.current_placement_batch_id = ? OR s.original_batch_id = ?)
          AND suea.exam_session_ref = ?
          AND suea.attempt_type = ?
      `;
      const queryParams: any[] = [parsedBatch, parsedBatch, cleanSession, cleanAttempt];

      if (Array.isArray(attemptIds) && attemptIds.length > 0) {
        querySql += ' AND suea.id IN (?)';
        queryParams.push(attemptIds.map(Number));
      }

      const [attempts] = await connection.query<any[]>(querySql, queryParams);

      if (!attempts || attempts.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: 'No matching examination result records found to finalize.', code: 'NO_ATTEMPTS_FOUND' });
        return;
      }

      // Check: Pending and withheld results must NOT be treated as finalized passes or failures
      const ineligible = attempts.filter((a) => a.result_status === 'PENDING' || a.result_status === 'WITHHELD');
      const alreadyFinalized = attempts.filter((a) => a.is_finalized && (a.result_status === 'PASS' || a.result_status === 'FAIL'));
      const unfinalizedEligible = attempts.filter((a) => !a.is_finalized && (a.result_status === 'PASS' || a.result_status === 'FAIL'));

      if (unfinalizedEligible.length === 0) {
        await connection.rollback();
        if (alreadyFinalized.length > 0) {
          res.json({
            success: true,
            message: 'All eligible PASS and FAIL examination results for this session are already finalized.',
            finalizedCount: 0,
            alreadyFinalizedCount: alreadyFinalized.length,
            ineligibleSkippedCount: ineligible.length,
          });
          return;
        }
        res.status(400).json({
          error: 'Cannot finalize: all selected results are Pending or Withheld. Only verified Pass or Fail records can be finalized.',
          code: 'ALL_RESULTS_PENDING_OR_WITHHELD',
          ineligibleCount: ineligible.length,
        });
        return;
      }

      const eligibleIds = unfinalizedEligible.map((a) => a.id);

      await connection.query(
        `UPDATE student_university_exam_attempts
         SET is_finalized = TRUE, finalized_by = ?, finalized_at = NOW(), finalization_remarks = ?
         WHERE id IN (?)`,
        [req.user!.id, cleanRemarks, eligibleIds]
      );

      await connection.commit();

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'UNIVERSITY_EXAM_RESULTS_FINALIZED',
        targetType: 'UNIVERSITY_EXAMS',
        targetId: `${parsedBatch}-${cleanSession}-${cleanAttempt}`,
        ipAddress: req.ip || null,
        details: {
          batchId: parsedBatch,
          examSessionRef: cleanSession,
          attemptType: cleanAttempt,
          finalizedCount: unfinalizedEligible.length,
          ineligibleSkippedCount: ineligible.length,
          remarks: cleanRemarks,
        },
      });

      res.json({
        success: true,
        message: `Successfully finalized ${unfinalizedEligible.length} examination result records.${
          ineligible.length > 0 ? ` (${ineligible.length} Pending/Withheld records were not finalized)` : ''
        }`,
        finalizedCount: unfinalizedEligible.length,
        ineligibleSkippedCount: ineligible.length,
      });
    } catch (err) {
      await connection.rollback();
      console.error('[KAMCH Univ Exams] Error finalizing university exam results:', (err as Error).message);
      res.status(500).json({ error: 'Failed to finalize university exam results', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

/**
 * POST /api/university-exams/reopen-correction
 * Permitted correction to finalized results (authorized office roles with mandatory justification).
 */
universityExamsRouter.post(
  '/reopen-correction',
  requireRoles(...OFFICE_EXAM_ROLES),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const { attemptId, reason } = req.body || {};
    const parsedId = parseInt(attemptId, 10);
    const cleanReason = String(reason || '').trim();

    if (!parsedId || isNaN(parsedId) || !cleanReason) {
      res.status(400).json({
        error: 'Attempt ID and a documented justification reason are required to reopen a finalized result for correction.',
        code: 'MISSING_REASON',
      });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query<any[]>(
        `SELECT suea.*, s.full_name, us.name AS subject_name
         FROM student_university_exam_attempts suea
         JOIN students s ON suea.student_id = s.id
         JOIN university_subjects us ON suea.subject_id = us.id
         WHERE suea.id = ? LIMIT 1`,
        [parsedId]
      );

      if (!rows || rows.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: 'Exam attempt record not found', code: 'NOT_FOUND' });
        return;
      }

      const existing = rows[0];
      if (!existing.is_finalized) {
        await connection.rollback();
        res.status(400).json({ error: 'This record is not currently finalized.', code: 'NOT_FINALIZED' });
        return;
      }

      const updatedRemarks = `${existing.finalization_remarks ? existing.finalization_remarks + ' | ' : ''}Reopened for correction: ${cleanReason}`;

      await connection.query(
        `UPDATE student_university_exam_attempts
         SET is_finalized = FALSE, finalized_by = NULL, finalized_at = NULL, finalization_remarks = ?
         WHERE id = ?`,
        [updatedRemarks, parsedId]
      );

      await connection.commit();

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'UNIVERSITY_EXAM_RESULT_REOPENED_FOR_CORRECTION',
        targetType: 'STUDENT_UNIVERSITY_ATTEMPT',
        targetId: String(parsedId),
        ipAddress: req.ip || null,
        details: {
          attemptId: parsedId,
          studentName: existing.full_name,
          subjectName: existing.subject_name,
          sessionRef: existing.exam_session_ref,
          reason: cleanReason,
        },
      });

      res.json({
        success: true,
        message: `Examination result for ${existing.full_name} (${existing.subject_name}) reopened for documented correction.`,
      });
    } catch (err) {
      await connection.rollback();
      console.error('[KAMCH Univ Exams] Error reopening exam result for correction:', (err as Error).message);
      res.status(500).json({ error: 'Failed to reopen result for correction', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

/**
 * GET /api/university-exams/promotion-preview?batchId=<id>&examSessionRef=<session>&attemptType=<type>
 * Generates an auditable promotion & placement preview without executing changes.
 */
universityExamsRouter.get(
  '/promotion-preview',
  requireRoles(...GENERAL_EXAM_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const batchIdParam = req.query.batchId ? parseInt(String(req.query.batchId), 10) : null;
    const cleanSession = String(req.query.examSessionRef || '').trim();
    const cleanAttempt = String(req.query.attemptType || 'REGULAR').trim().toUpperCase();

    if (!batchIdParam || isNaN(batchIdParam) || !cleanSession) {
      res.status(400).json({ error: 'Batch ID and Exam Session Reference are required', code: 'MISSING_FIELDS' });
      return;
    }

    try {
      const pool = getPool();

      // 1. Resolve batch, current prof year, and scheme
      const [batchRows] = await pool.query<any[]>(
        `SELECT b.id, b.code, b.name, b.current_professional_year, b.scheme_id, b.junior_batch_id,
                cs.code AS scheme_code, cs.is_legacy_minimal, cs.regular_pass_max_failed_for_provisional,
                cs.allow_provisional_promotion, cs.professional_years_count
         FROM academic_batches b
         LEFT JOIN curriculum_schemes cs ON b.scheme_id = cs.id
         WHERE b.id = ? LIMIT 1`,
        [batchIdParam]
      );

      if (!batchRows || batchRows.length === 0) {
        res.status(404).json({ error: 'Academic batch not found', code: 'NOT_FOUND' });
        return;
      }

      const batch = batchRows[0];
      const profYear = batch.current_professional_year !== null && batch.current_professional_year !== undefined
        ? Number(batch.current_professional_year)
        : 1;
      const schemeId = Number(batch.scheme_id);
      const isLegacy = Boolean(batch.is_legacy_minimal || batch.scheme_code === 'RS6');

      // 2. Fetch all university subjects for this scheme and professional year
      let [allSchemeSubjects] = await pool.query<any[]>(
        `SELECT id, code, name, professional_year FROM university_subjects
         WHERE (scheme_id = ? OR scheme_id IS NULL) AND is_active = TRUE
         ORDER BY name ASC`,
        [schemeId]
      );
      if (!allSchemeSubjects || allSchemeSubjects.length === 0) {
        const [fallbackSubjs] = await pool.query<any[]>(
          `SELECT id, code, name, professional_year FROM university_subjects WHERE is_active = TRUE ORDER BY name ASC`
        );
        allSchemeSubjects = fallbackSubjs || [];
      }
      const reqSubjects = allSchemeSubjects.filter((s) => Number(s.professional_year) === profYear);

      // 3. Fetch junior / next batch name if configured
      let juniorBatchName: string | null = null;
      if (batch.junior_batch_id) {
        const [jbRows] = await pool.query<any[]>(
          `SELECT id, name FROM academic_batches WHERE id = ? LIMIT 1`,
          [batch.junior_batch_id]
        );
        if (jbRows && jbRows.length > 0) {
          juniorBatchName = jbRows[0].name;
        }
      }

      // 4. Fetch students placed in this batch
      const [students] = await pool.query<any[]>(
        `SELECT s.id, s.student_id_number AS studentIdNumber, s.temporary_roll_number AS temporaryRollNumber,
                s.permanent_university_number AS permanentUniversityNumber, s.full_name AS fullName,
                s.original_batch_id AS originalBatchId, orig_b.name AS originalBatchName,
                s.current_placement_batch_id AS currentPlacementBatchId,
                curr_b.name AS currentPlacementBatchName,
                s.current_year_of_study AS currentYearOfStudy,
                s.detention_stage AS detentionStage,
                s.progression_status AS progressionStatus,
                s.outstanding_backlogs_count AS outstandingBacklogsCount
         FROM students s
         LEFT JOIN academic_batches orig_b ON s.original_batch_id = orig_b.id
         LEFT JOIN academic_batches curr_b ON s.current_placement_batch_id = curr_b.id
         WHERE (s.current_placement_batch_id = ? OR s.original_batch_id = ?)
           AND s.administrative_status = 'ACTIVE'
         ORDER BY s.full_name ASC`,
        [batchIdParam, batchIdParam]
      );

      const studentIds = students.map((s) => s.id);
      let attempts: any[] = [];
      if (studentIds.length > 0) {
        const [attRows] = await pool.query<any[]>(
          `SELECT suea.id, suea.student_id, suea.subject_id, suea.exam_session_ref,
                  suea.attempt_type, suea.result_status, suea.marks_obtained,
                  suea.failed_subjects_json, suea.office_decision,
                  suea.is_finalized, suea.finalized_by, suea.finalized_at,
                  us.code AS subject_code, us.name AS subject_name, us.professional_year
           FROM student_university_exam_attempts suea
           LEFT JOIN university_subjects us ON suea.subject_id = us.id
           WHERE suea.student_id IN (?)
             AND suea.exam_session_ref = ?
             AND suea.attempt_type = ?`,
          [studentIds, cleanSession, cleanAttempt]
        );
        attempts = attRows || [];
      }

      // Group attempts by student
      const attemptsByStudent = new Map<number, any[]>();
      for (const a of attempts) {
        const sid = Number(a.student_id);
        if (!attemptsByStudent.has(sid)) {
          attemptsByStudent.set(sid, []);
        }
        attemptsByStudent.get(sid)!.push(a);
      }

      // Build student preview items
      const previewList = [];
      let totalPassed = 0;
      let totalFailedPromoted = 0;
      let totalFailedDetained = 0;
      let totalPendingWithheld = 0;
      let eligibleToConfirmCount = 0;

      for (const st of students) {
        const studentAttempts = attemptsByStudent.get(st.id) || [];

        // Case 1: Entered results have not been finalized yet
        const hasUnfinalized = studentAttempts.length > 0 && studentAttempts.some((a) => !a.is_finalized);
        if (hasUnfinalized) {
          totalPendingWithheld++;
          previewList.push({
            studentId: st.id,
            studentIdNumber: st.studentIdNumber,
            temporaryRollNumber: st.temporaryRollNumber || st.studentIdNumber,
            permanentUniversityNumber: st.permanentUniversityNumber || null,
            fullName: st.fullName,
            originalBatchId: st.originalBatchId,
            originalBatchName: st.originalBatchName || 'Original Cohort',
            currentPlacementBatchId: st.currentPlacementBatchId,
            currentPlacementBatchName: batch.name,
            currentYearOfStudy: st.currentYearOfStudy || profYear,
            schemeCode: batch.scheme_code || 'RS7',
            finalizedResultsCount: studentAttempts.filter((a) => a.is_finalized).length,
            totalRequiredSubjectsCount: reqSubjects.length,
            failedSubjects: [],
            administrativeOutcome: 'PENDING' as const,
            proposedDecision: 'UNFINALIZED_EXAM_RESULTS',
            proposedProfessionalYear: Number(st.currentYearOfStudy || profYear),
            proposedPlacementBatchId: st.currentPlacementBatchId,
            proposedPlacementBatchName: batch.name,
            proposalReason: 'Entered examination results must be officially Reviewed and Finalized in Tab 2 before academic promotion can be confirmed.',
            applicableRule: 'INCOMPLETE_OR_UNFINALIZED_EXAM_RESULTS',
            unverifiedThirdProfRuleNote: null,
            canConfirm: false,
          });
          continue;
        }

        // Case 3: Official result is Withheld or Pending
        const isWithheld = studentAttempts.some((a) => a.result_status === 'WITHHELD');
        const isPending = studentAttempts.some((a) => a.result_status === 'PENDING');
        if (isWithheld || isPending) {
          totalPendingWithheld++;
          previewList.push({
            studentId: st.id,
            studentIdNumber: st.studentIdNumber,
            temporaryRollNumber: st.temporaryRollNumber || st.studentIdNumber,
            permanentUniversityNumber: st.permanentUniversityNumber || null,
            fullName: st.fullName,
            originalBatchId: st.originalBatchId,
            originalBatchName: st.originalBatchName || 'Original Cohort',
            currentPlacementBatchId: st.currentPlacementBatchId,
            currentPlacementBatchName: batch.name,
            currentYearOfStudy: st.currentYearOfStudy || profYear,
            schemeCode: batch.scheme_code || 'RS7',
            finalizedResultsCount: studentAttempts.filter((a) => a.is_finalized).length,
            totalRequiredSubjectsCount: reqSubjects.length,
            failedSubjects: [],
            administrativeOutcome: (isWithheld ? 'WITHHELD' : 'PENDING') as 'WITHHELD' | 'PENDING',
            proposedDecision: 'REMAIN_IN_CURRENT_PLACEMENT',
            proposedProfessionalYear: Number(st.currentYearOfStudy || profYear),
            proposedPlacementBatchId: st.currentPlacementBatchId,
            proposedPlacementBatchName: batch.name,
            proposalReason: isWithheld
              ? 'University result is officially Withheld. Contradictory promotion combinations are strictly prohibited.'
              : 'University result is currently Pending. Final promotion decisions cannot be made until official results are declared and finalized.',
            applicableRule: 'OFFICIAL_RESULT_PENDING_OR_WITHHELD_GUARD',
            unverifiedThirdProfRuleNote: null,
            canConfirm: false,
          });
          continue;
        }

        // Case 4: RS6 legacy scheme guard
        if (isLegacy) {
          totalPendingWithheld++;
          previewList.push({
            studentId: st.id,
            studentIdNumber: st.studentIdNumber,
            temporaryRollNumber: st.temporaryRollNumber || st.studentIdNumber,
            permanentUniversityNumber: st.permanentUniversityNumber || null,
            fullName: st.fullName,
            originalBatchId: st.originalBatchId,
            originalBatchName: st.originalBatchName || 'Original Cohort',
            currentPlacementBatchId: st.currentPlacementBatchId,
            currentPlacementBatchName: batch.name,
            currentYearOfStudy: st.currentYearOfStudy || profYear,
            schemeCode: batch.scheme_code || 'RS6',
            finalizedResultsCount: studentAttempts.filter((a) => a.is_finalized).length,
            totalRequiredSubjectsCount: reqSubjects.length,
            failedSubjects: [],
            administrativeOutcome: 'PENDING' as const,
            proposedDecision: 'RS6_LEGACY_MANUAL_REVIEW',
            proposedProfessionalYear: Number(st.currentYearOfStudy || profYear),
            proposedPlacementBatchId: st.currentPlacementBatchId,
            proposedPlacementBatchName: batch.name,
            proposalReason: 'RS6 legacy records do not automatically apply newer RS7 three-professional-year progression rules. Record verified outcome manually.',
            applicableRule: 'RS6_LEGACY_SCHEME_GUARD',
            unverifiedThirdProfRuleNote: null,
            canConfirm: false,
          });
          continue;
        }

        // Case 5: Finalized RS7 Attempt(s)
        const failedMap = new Map<number, { id: number; code: string; name: string }>();

        for (const a of studentAttempts) {
          if (a.result_status === 'FAIL') {
            let fIds: number[] = [];
            if (a.failed_subjects_json) {
              try {
                const parsed = typeof a.failed_subjects_json === 'string'
                  ? JSON.parse(a.failed_subjects_json)
                  : a.failed_subjects_json;
                if (Array.isArray(parsed)) {
                  fIds = parsed.map(Number).filter((n) => !isNaN(n) && n > 0);
                }
              } catch {
                fIds = [];
              }
            }
            if (fIds.length === 0 && a.subject_id) {
              fIds = [Number(a.subject_id)];
            }
            for (const fid of fIds) {
              const matched = allSchemeSubjects.find((s) => s.id === fid);
              if (matched) {
                failedMap.set(fid, { id: matched.id, code: matched.code, name: matched.name });
              } else {
                failedMap.set(fid, { id: fid, code: `SUBJ-${fid}`, name: a.subject_name || `Subject #${fid}` });
              }
            }
          }
        }

        const failedList = Array.from(failedMap.values());
        let adminOutcome: 'PASSED' | 'FAILED — PROMOTED' | 'FAILED — DETAINED' | 'PENDING' = 'PASSED';
        let proposedDecision = 'PROMOTED_TO_NEXT_PROF_YEAR';
        let proposedProfYear = profYear;
        let proposedBatchId: number | null = st.currentPlacementBatchId || st.originalBatchId || null;
        let proposedBatchName = st.currentPlacementBatchName || st.originalBatchName || batch.name;
        let proposalReason = '';
        let applicableRule = '';
        let unverifiedThirdProfRuleNote: string | null = null;
        let canConfirm = false;

        // Ensure target cohort batch can be identified unambiguously (Requirement 5)
        if (!proposedBatchId) {
          adminOutcome = 'PENDING';
          proposedDecision = 'MANUAL_REVIEW_REQUIRED';
          proposedBatchId = batch.id;
          proposedBatchName = batch.name;
          proposalReason = 'Destination batch cannot be identified unambiguously from student cohort records; manual review required.';
          applicableRule = 'AMBIGUOUS_DESTINATION_BATCH_MANUAL_REVIEW';
          canConfirm = false;
          totalPendingWithheld++;
          previewList.push({
            studentId: st.id,
            studentIdNumber: st.studentIdNumber,
            temporaryRollNumber: st.temporaryRollNumber || st.studentIdNumber,
            permanentUniversityNumber: st.permanentUniversityNumber || null,
            fullName: st.fullName,
            originalBatchId: st.originalBatchId,
            originalBatchName: st.originalBatchName || 'Original Cohort',
            currentPlacementBatchId: st.currentPlacementBatchId,
            currentPlacementBatchName: st.currentPlacementBatchName || batch.name,
            currentYearOfStudy: st.currentYearOfStudy || profYear,
            schemeCode: batch.scheme_code || 'RS7',
            finalizedResultsCount: studentAttempts.filter((a) => a.is_finalized).length,
            totalRequiredSubjectsCount: reqSubjects.length,
            failedSubjects: failedList,
            administrativeOutcome: adminOutcome,
            proposedDecision,
            proposedProfessionalYear: Number(st.currentYearOfStudy || profYear),
            proposedPlacementBatchId: proposedBatchId,
            proposedPlacementBatchName: proposedBatchName,
            proposalReason,
            applicableRule,
            unverifiedThirdProfRuleNote: null,
            canConfirm,
          });
          continue;
        }

        const targetBatchId = proposedBatchId;
        const targetBatchName = proposedBatchName;

        if (failedList.length === 0) {
          adminOutcome = 'PASSED';
          canConfirm = true;
          totalPassed++;

          if (profYear >= 3) {
            proposedDecision = 'ELIGIBLE_FOR_INTERNSHIP';
            proposedProfYear = 3;
            proposedBatchId = targetBatchId;
            proposedBatchName = targetBatchName;
            proposalReason = 'Passed all official university examination subjects in final professional year. Eligible to commence 365-day internship.';
            applicableRule = 'RS7_FINAL_PROF_PASSED_INTERNSHIP_ELIGIBLE';
          } else {
            proposedDecision = 'PROMOTED_TO_NEXT_PROF_YEAR';
            proposedProfYear = profYear + 1;
            proposedBatchId = targetBatchId;
            proposedBatchName = targetBatchName;
            proposalReason = `Passed all official university examination subjects. Normal academic progression to Professional Year ${profYear + 1} within own cohort (${targetBatchName}).`;
            applicableRule = 'RS7_REGULAR_PASSED_NORMAL_PROMOTION';
          }
        } else {
          canConfirm = true;
          if (profYear === 3) {
            adminOutcome = 'FAILED — DETAINED';
            proposedDecision = 'DETAINED_IN_PROF_YEAR_3';
            proposedProfYear = 3;
            proposedBatchId = targetBatchId;
            proposedBatchName = targetBatchName;
            unverifiedThirdProfRuleNote = 'Intended Rule: 3rd Prof requires clearing all subjects (failure in even 1 subject leads to 6 months detention). Note: Official university regulation verification pending.';
            proposalReason = `Failed in ${failedList.map((f) => f.name).join(', ')} (${failedList.length} subject(s)). Retained in 3rd Professional Year pending supplementary clearance before internship eligibility.`;
            applicableRule = 'RS7_PROF_YEAR_3_DETENTION_PENDING_CLEARANCE';
            totalFailedDetained++;
          } else {
            const maxProvisional = Number(batch.regular_pass_max_failed_for_provisional || 2);
            const allowProvisional = Boolean(batch.allow_provisional_promotion);

            if (allowProvisional && failedList.length <= maxProvisional) {
              adminOutcome = 'FAILED — PROMOTED';
              proposedDecision = 'PROVISIONALLY_PROMOTED_WITH_BACKLOGS';
              proposedProfYear = profYear + 1;
              proposedBatchId = targetBatchId;
              proposedBatchName = targetBatchName;
              proposalReason = `Failed in ${failedList.map((f) => f.name).join(', ')} (${failedList.length} subject(s)). RS7 provisional promotion permitted with up to ${maxProvisional} backlogs within own cohort (${targetBatchName}). Backlogs must be cleared in supplementary cycle.`;
              applicableRule = 'RS7_PROVISIONAL_PROMOTION_WITH_BACKLOGS';
              totalFailedPromoted++;
            } else {
              adminOutcome = 'FAILED — DETAINED';
              proposedDecision = 'DETAINED_IN_ODD_BATCH';
              proposedProfYear = profYear;
              proposedBatchId = targetBatchId;
              proposedBatchName = `${targetBatchName} (Odd-Batch / Supplementary)`;
              proposalReason = `Failed in ${failedList.map((f) => f.name).join(', ')} (${failedList.length} subjects). Exceeds permissible provisional promotion backlog threshold (> ${maxProvisional} failed subjects). Detained in odd-batch cycle within own cohort.`;
              applicableRule = 'RS7_EXCEEDS_BACKLOG_LIMIT_DETENTION';
              totalFailedDetained++;
            }
          }
        }

        if (canConfirm) {
          eligibleToConfirmCount++;
        }

        previewList.push({
          studentId: st.id,
          studentIdNumber: st.studentIdNumber,
          temporaryRollNumber: st.temporaryRollNumber || st.studentIdNumber,
          permanentUniversityNumber: st.permanentUniversityNumber || null,
          fullName: st.fullName,
          originalBatchId: st.originalBatchId,
          originalBatchName: st.originalBatchName || 'Original Cohort',
          currentPlacementBatchId: st.currentPlacementBatchId,
          currentPlacementBatchName: st.currentPlacementBatchName || batch.name,
          currentYearOfStudy: st.currentYearOfStudy || profYear,
          schemeCode: batch.scheme_code || 'RS7',
          finalizedResultsCount: studentAttempts.filter((a) => a.is_finalized).length,
          totalRequiredSubjectsCount: reqSubjects.length,
          failedSubjects: failedList,
          administrativeOutcome: adminOutcome,
          proposedDecision,
          proposedProfessionalYear: proposedProfYear,
          proposedPlacementBatchId: proposedBatchId,
          proposedPlacementBatchName: proposedBatchName,
          proposalReason,
          applicableRule,
          unverifiedThirdProfRuleNote,
          canConfirm,
        });
      }

      res.json({
        success: true,
        batchProfile: {
          batchId: batch.id,
          batchName: batch.name,
          professionalYear: profYear,
          schemeCode: batch.scheme_code || 'RS7',
          isLegacy,
          examSessionRef: cleanSession,
          attemptType: cleanAttempt,
        },
        stats: {
          totalStudents: students.length,
          passed: totalPassed,
          failedPromoted: totalFailedPromoted,
          failedDetained: totalFailedDetained,
          pendingOrWithheld: totalPendingWithheld,
          eligibleToConfirm: eligibleToConfirmCount,
        },
        students: previewList,
      });
    } catch (err) {
      console.error('[KAMCH Univ Exams] Error generating promotion preview:', (err as Error).message);
      res.status(500).json({ error: 'Failed to generate promotion preview', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * POST /api/university-exams/confirm-progression
 * Authorized office roles confirm eligible placement changes.
 * Validates finalized state, prevents duplicate confirmations, records progression events, and preserves original admission batch.
 */
universityExamsRouter.post(
  '/confirm-progression',
  requireRoles(...OFFICE_EXAM_ROLES),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const { batchId, examSessionRef, attemptType, confirmations } = req.body || {};
    const parsedBatch = parseInt(batchId, 10);
    const cleanSession = String(examSessionRef || '').trim();
    const cleanAttempt = String(attemptType || 'REGULAR').trim().toUpperCase();

    if (!parsedBatch || isNaN(parsedBatch) || !cleanSession || !Array.isArray(confirmations) || confirmations.length === 0) {
      res.status(400).json({
        error: 'Batch ID, Exam Session Reference, and student confirmations are required.',
        code: 'MISSING_FIELDS',
      });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // 1. Fetch batch
      const [batchRows] = await connection.query<any[]>(
        `SELECT id, name, scheme_id, current_professional_year, current_cohort_stage FROM academic_batches WHERE id = ? LIMIT 1`,
        [parsedBatch]
      );
      if (!batchRows || batchRows.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: 'Batch not found', code: 'NOT_FOUND' });
        return;
      }
      const batch = batchRows[0];

      let confirmedCount = 0;
      const resultsSummary = [];

      for (const item of confirmations) {
        const studentId = parseInt(item.studentId, 10);
        if (!studentId || isNaN(studentId)) continue;

        // Verify student
        const [stRows] = await connection.query<any[]>(
          `SELECT id, student_id_number, full_name, original_batch_id, current_placement_batch_id,
                  current_year_of_study, detention_stage, progression_status
           FROM students WHERE id = ? LIMIT 1`,
          [studentId]
        );
        if (!stRows || stRows.length === 0) continue;
        const student = stRows[0];

        // 2. Re-validate on server: check that student's attempts for this session are FINALIZED and none are PENDING or WITHHELD
        const [studentAttempts] = await connection.query<any[]>(
          `SELECT id, result_status, is_finalized, failed_subjects_json
           FROM student_university_exam_attempts
           WHERE student_id = ? AND exam_session_ref = ? AND attempt_type = ?`,
          [studentId, cleanSession, cleanAttempt]
        );

        if (studentAttempts && studentAttempts.length > 0) {
          const hasPendingOrWithheld = studentAttempts.some(
            (a) => a.result_status === 'PENDING' || a.result_status === 'WITHHELD'
          );
          if (hasPendingOrWithheld) {
            continue; // strictly refuse contradictory combinations
          }

          const hasUnfinalized = studentAttempts.some((a) => !a.is_finalized);
          if (hasUnfinalized) {
            continue; // must be finalized
          }
        }

        // 3. Prevent duplicate processing if confirmation already submitted for this session & attempt
        const [dupEvents] = await connection.query<any[]>(
          `SELECT id FROM student_progression_events
           WHERE student_id = ? AND exam_session_ref = ? AND exam_attempt_type = ? AND workflow_state = 'CONFIRMED'
           LIMIT 1`,
          [studentId, cleanSession, cleanAttempt]
        );
        if (dupEvents && dupEvents.length > 0) {
          resultsSummary.push({
            studentId,
            fullName: student.full_name,
            status: 'ALREADY_CONFIRMED',
            message: 'Progression was already confirmed previously for this examination session.',
          });
          continue;
        }

        const nextProfYear = Number(item.proposedProfessionalYear || student.current_year_of_study || 1);
        const nextBatchId = item.proposedPlacementBatchId ? Number(item.proposedPlacementBatchId) : student.current_placement_batch_id;
        const nextStatus = String(item.proposedDecision || 'CONFIRMED_PROGRESSION');
        const nextDetention = nextStatus.includes('DETAINED')
          ? Number(student.detention_stage || 0) + 1
          : Number(student.detention_stage || 0);

        // Calculate backlogs
        const failedSubjectsCount = studentAttempts.filter((a) => a.result_status === 'FAIL').length;

        // 4. Update student record (ALWAYS PRESERVES original_batch_id)
        await connection.query(
          `/* SM:UPDATE_STUDENT_PROGRESSION */
           UPDATE students
           SET current_year_of_study = ?, current_placement_batch_id = ?,
               detention_stage = ?, progression_status = ?, outstanding_backlogs_count = ?
           WHERE id = ?`,
          [nextProfYear, nextBatchId, nextDetention, nextStatus, failedSubjectsCount, studentId]
        );

        // 5. Insert into student_progression_events
        await connection.query(
          `INSERT INTO student_progression_events (
             student_id, scheme_id, event_type, exam_session_ref, exam_attempt_type,
             evaluated_professional_year, previous_professional_year, proposed_professional_year,
             previous_placement_batch_id, proposed_placement_batch_id,
             previous_detention_stage, proposed_detention_stage,
             subjects_evaluated_count, subjects_passed, subjects_outstanding,
             placement_rule_applied, proposed_status, workflow_state,
             entered_by, confirmed_by, confirmed_at, reason_or_remarks
           ) VALUES (
             ?, ?, 'CONFIRMED_PROGRESSION', ?, ?,
             ?, ?, ?,
             ?, ?,
             ?, ?,
             ?, ?, ?,
             ?, ?, 'CONFIRMED',
             ?, ?, NOW(), ?
           )`,
          [
            studentId,
            batch.scheme_id,
            cleanSession,
            cleanAttempt,
            Number(batch.current_professional_year || 1),
            Number(student.current_year_of_study || 1),
            nextProfYear,
            student.current_placement_batch_id,
            nextBatchId,
            Number(student.detention_stage || 0),
            nextDetention,
            studentAttempts.length,
            JSON.stringify(studentAttempts.filter((a) => a.result_status === 'PASS').map((a) => a.id)),
            JSON.stringify(studentAttempts.filter((a) => a.result_status === 'FAIL').map((a) => a.id)),
            item.applicableRule || 'UNIVERSITY_EXAM_PROGRESSION_CONFIRMED',
            nextStatus,
            req.user!.id,
            req.user!.id,
            item.reason || 'Confirmed university examination progression outcome.',
          ]
        );

        // 6. If eligible for internship, seed internship record
        if (nextStatus === 'ELIGIBLE_FOR_INTERNSHIP') {
          await connection.query(
            `INSERT IGNORE INTO student_internships
              (student_id, start_date, base_required_days, approved_extension_days, adjusted_required_days, credited_days_completed, attendance_source, attendance_reconciliation_status, last_attendance_sync_ref, expected_completion_date, internship_status, completion_remarks, created_by)
             VALUES (?, NULL, 365, 0, 365, 0, 'PENDING_ATTENDANCE_MODULE', 'UNAVAILABLE_PENDING_INTEGRATION', NULL, NULL, 'ELIGIBLE', 'Eligible upon clearing 3rd Professional Year University Exams', ?)`,
            [studentId, req.user!.id]
          );
        }

        // 7. Audit log per student
        await recordAuditLog({
          actorId: req.user!.id,
          action: 'UNIVERSITY_EXAM_PROGRESSION_CONFIRMED',
          targetType: 'STUDENT',
          targetId: String(studentId),
          ipAddress: req.ip || null,
          details: {
            studentId,
            fullName: student.full_name,
            originalBatchId: student.original_batch_id,
            previousPlacementBatchId: student.current_placement_batch_id,
            newPlacementBatchId: nextBatchId,
            previousProfYear: student.current_year_of_study,
            newProfYear: nextProfYear,
            proposedDecision: nextStatus,
            examSessionRef: cleanSession,
            attemptType: cleanAttempt,
          },
        });

        confirmedCount++;
        resultsSummary.push({
          studentId,
          fullName: student.full_name,
          status: 'SUCCESS',
          decision: nextStatus,
        });
      }

      // 8. Update parent academic batch progression stage if promotions confirmed successfully
      if (confirmedCount > 0) {
        const batchProfYear = Number(batch.current_professional_year || 1);
        const nextBatchProfYear = batchProfYear < 3 ? batchProfYear + 1 : 3;
        const nextBatchStage = batchProfYear === 1
          ? 'PROF_YEAR_2_TERM_1'
          : batchProfYear === 2
          ? 'PROF_YEAR_3_TERM_1'
          : 'INTERNSHIP';

        await connection.query(
          `UPDATE academic_batches
           SET current_professional_year = ?, current_cohort_stage = ?
           WHERE id = ?`,
          [nextBatchProfYear, nextBatchStage, parsedBatch]
        );

        await recordAuditLog({
          actorId: req.user!.id,
          action: 'ACADEMIC_BATCH_PROMOTED_VIA_UNIVERSITY_EXAMS',
          targetType: 'ACADEMIC_BATCH',
          targetId: String(parsedBatch),
          ipAddress: req.ip || null,
          details: {
            batchId: parsedBatch,
            batchName: batch.name,
            previousProfessionalYear: batchProfYear,
            newProfessionalYear: nextBatchProfYear,
            previousCohortStage: batch.current_cohort_stage,
            newCohortStage: nextBatchStage,
            confirmedStudentsCount: confirmedCount,
            examSessionRef: cleanSession,
            attemptType: cleanAttempt,
          },
        });
      }

      await connection.commit();

      res.json({
        success: true,
        message: `Successfully confirmed academic progression for ${confirmedCount} student(s).`,
        confirmedCount,
        results: resultsSummary,
      });
    } catch (err) {
      await connection.rollback();
      console.error('[KAMCH Univ Exams] Error confirming progression:', (err as Error).message);
      res.status(500).json({ error: 'Failed to confirm academic progression', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);
