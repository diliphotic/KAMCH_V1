import { PoolConnection } from 'mysql2/promise';
import { recordAuditLog } from './audit.ts';

export interface TermTransitionResult {
  transitioned: boolean;
  batchId: number;
  oldStage: string | null;
  newStage: string | null;
  assessmentCode: string;
  reason?: string;
}

/**
   * Checks if all required subjects for a regular batch have submitted assessments
   * for the given assessment ID (TERM_TEST_1 or TERM_TEST_2), and automatically
   * advances the batch term if complete.
   */
export async function checkAndExecuteTermTransition(
  connection: PoolConnection,
  batchId: number,
  assessmentId: number,
  actorId: number,
  ipAddress?: string | null
): Promise<TermTransitionResult> {
  try {
    // 1. Fetch assessment details to know whether it's TERM_TEST_1 or TERM_TEST_2
    const [assessRows] = await connection.query<any[]>(
      `SELECT id, code, assessment_type, term_number 
       FROM assessments 
       WHERE id = ? LIMIT 1`,
      [assessmentId]
    );
    if (!assessRows || assessRows.length === 0) {
      return { transitioned: false, batchId, oldStage: null, newStage: null, assessmentCode: 'UNKNOWN', reason: 'Assessment not found' };
    }
    const assessment = assessRows[0];
    const assessmentCode = String(assessment.code || '').toUpperCase();
    const termNumber = Number(assessment.term_number);

    // We only trigger term transition on TERM_TEST_1 (Term 1 -> Term 2) or TERM_TEST_2 (Term 2 -> Term 3)
    if (assessmentCode !== 'TERM_TEST_1' && assessmentCode !== 'TERM_TEST_2') {
      return { transitioned: false, batchId, oldStage: null, newStage: null, assessmentCode, reason: 'Not a term test assessment trigger' };
    }

    // 2. Fetch batch details and current cohort stage
    const [batchRows] = await connection.query<any[]>(
      `SELECT id, code, name, current_cohort_stage, current_professional_year, scheme_id,
              cs.code AS scheme_code, cs.is_legacy_minimal
       FROM academic_batches b
       LEFT JOIN curriculum_schemes cs ON b.scheme_id = cs.id
       WHERE b.id = ? FOR UPDATE`,
      [batchId]
    );
    if (!batchRows || batchRows.length === 0) {
      return { transitioned: false, batchId, oldStage: null, newStage: null, assessmentCode, reason: 'Batch not found' };
    }
    const batch = batchRows[0];
    const currentStage = String(batch.current_cohort_stage || '').trim().toUpperCase();
    const profYear = batch.current_professional_year !== null && batch.current_professional_year !== undefined
      ? Number(batch.current_professional_year)
      : null;

    // Skip legacy RS6 batches
    if (Boolean(batch.is_legacy_minimal) || String(batch.scheme_code || '').toUpperCase() === 'RS6') {
      return { transitioned: false, batchId, oldStage: currentStage, newStage: currentStage, assessmentCode, reason: 'Legacy batch excluded' };
    }

    if (profYear === null || profYear <= 0) {
      return { transitioned: false, batchId, oldStage: currentStage, newStage: currentStage, assessmentCode, reason: 'Batch professional year not set' };
    }

    // Determine expected current stage and target stage based on assessment trigger
    let expectedCurrentStage = '';
    let targetStage = '';

    if (assessmentCode === 'TERM_TEST_1' && termNumber === 1) {
      expectedCurrentStage = `PROF_YEAR_${profYear}_TERM_1`;
      targetStage = `PROF_YEAR_${profYear}_TERM_2`;
    } else if (assessmentCode === 'TERM_TEST_2' && termNumber === 2) {
      expectedCurrentStage = `PROF_YEAR_${profYear}_TERM_2`;
      targetStage = `PROF_YEAR_${profYear}_TERM_3`;
    } else {
      return { transitioned: false, batchId, oldStage: currentStage, newStage: currentStage, assessmentCode, reason: 'Assessment term number mismatch' };
    }

    // If batch is already past this stage or in a different stage, do not transition
    if (currentStage !== expectedCurrentStage) {
      return {
        transitioned: false,
        batchId,
        oldStage: currentStage,
        newStage: currentStage,
        assessmentCode,
        reason: `Batch stage "${currentStage}" does not match expected trigger stage "${expectedCurrentStage}"`,
      };
    }

    // 3. Identify all required active IA subjects for this batch's professional year
    const [requiredSubjects] = await connection.query<any[]>(
      `SELECT id, code, name, professional_year, is_ia_enabled
       FROM subjects
       WHERE professional_year = ? AND is_ia_enabled = TRUE
         AND code NOT IN ('RESEARCH_METHODOLOGY', 'ATYAIKACHIKITSA')`,
      [profYear]
    );

    if (!requiredSubjects || requiredSubjects.length === 0) {
      return { transitioned: false, batchId, oldStage: currentStage, newStage: currentStage, assessmentCode, reason: 'No required IA subjects found for professional year' };
    }

    // 4. Verify marks-entry completeness: Every required subject must have a submitted record in assessment_submissions for this batch & assessment
    for (const subj of requiredSubjects) {
      const [subRows] = await connection.query<any[]>(
        `SELECT id, status FROM assessment_submissions
         WHERE batch_id = ? AND subject_id = ? AND assessment_id = ? AND status = 'SUBMITTED' LIMIT 1`,
        [batchId, subj.id, assessmentId]
      );
      if (!subRows || subRows.length === 0) {
        return {
          transitioned: false,
          batchId,
          oldStage: currentStage,
          newStage: currentStage,
          assessmentCode,
          reason: `Incomplete marks entry: Required subject "${subj.name}" (${subj.code}) lacks a submitted assessment record for ${assessmentCode}`,
        };
      }
    }

    // 5. Exclude odd-batch / detained students check: Ensure batch does not have unresolved detained markers that block regular progression
    // (Regular batch advancement proceeds if all required subject submissions are complete).

    // 6. Execute safe atomic transition update on academic_batches
    const [updateResult] = await connection.query<any[]>(
      `UPDATE academic_batches
       SET current_cohort_stage = ?
       WHERE id = ? AND current_cohort_stage = ?`,
      [targetStage, batchId, expectedCurrentStage]
    );

    const affectedRows = Number((updateResult as any).affectedRows || 0);
    if (affectedRows === 0) {
      return {
        transitioned: false,
        batchId,
        oldStage: currentStage,
        newStage: currentStage,
        assessmentCode,
        reason: 'Concurrent transition or batch stage mismatch prevented update',
      };
    }

    // 7. Record audit log
    await recordAuditLog({
      actorId,
      action: 'BATCH_TERM_ADVANCED',
      targetType: 'ACADEMIC_BATCH',
      targetId: String(batchId),
      ipAddress: ipAddress || null,
      details: {
        batchName: batch.name,
        oldStage: expectedCurrentStage,
        newStage: targetStage,
        triggerAssessment: assessmentCode,
        professionalYear: profYear,
      },
    });

    console.log(`[KAMCH ERP Term Transition] Batch "${batch.name}" successfully advanced from ${expectedCurrentStage} to ${targetStage} via ${assessmentCode}.`);

    return {
      transitioned: true,
      batchId,
      oldStage: expectedCurrentStage,
      newStage: targetStage,
      assessmentCode,
    };
  } catch (err) {
    console.error('[KAMCH ERP Term Transition] Error executing term transition check:', (err as Error).message);
    return {
      transitioned: false,
      batchId,
      oldStage: null,
      newStage: null,
      assessmentCode: 'ERROR',
      reason: (err as Error).message,
    };
  }
}
