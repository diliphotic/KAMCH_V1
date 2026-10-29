import { Router, Request, Response } from 'express';
import { getPool } from '../db.ts';
import { requireAuth, requirePasswordChangeClear, requireRoles } from '../middleware/auth.ts';
import { validateCsrf } from '../middleware/csrf.ts';
import { recordAuditLog } from '../services/audit.ts';
import { ROLES, isDepartmentScopedRole } from '../permissions.ts';
import {
  validatePatMappingConfig,
  recalculateSubjectBatchIA,
  recalculateAllBatchesForSubject,
  FINAL_IA_REASON_CATEGORIES,
  IaActionError,
  approveStudentFinalIA,
  adjustStudentFinalIA,
} from '../services/ia-calculation.ts';
import { checkAndExecuteTermTransition } from '../services/term-transition.ts';

export const internalAssessmentRouter = Router();

const IA_MODULE_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.PRINCIPAL,
  ROLES.SECRETARY,
  ROLES.OFFICE,
  ROLES.STAFF,
  ROLES.DEPARTMENT,
  ROLES.HOD,
];

const IA_CONFIG_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.PRINCIPAL,
  ROLES.SECRETARY,
  ROLES.OFFICE,
  ROLES.STAFF,
];

internalAssessmentRouter.use(requireAuth);
internalAssessmentRouter.use(requirePasswordChangeClear);
internalAssessmentRouter.use(requireRoles(...IA_MODULE_ROLES));

/**
 * Helper: Enforces strict server-side department isolation for DEPARTMENT/HOD accounts.
 */
function canAccessSubjectForUser(user: Express.Request['user'], subjectDepartmentId: any): boolean {
  if (!user) return false;
  if (!isDepartmentScopedRole(user.role)) return true;
  if (!user.departmentId || !subjectDepartmentId) return false;
  return Number(user.departmentId) === Number(subjectDepartmentId);
}

/**
 * Helper: Checks whether department deactivation blocks new mark entry / submission.
 */
async function checkDepartmentActiveForWrite(
  queryRunner: { query: <T = any>(sql: string, params?: any[]) => Promise<[T, any]> },
  user: Express.Request['user'],
  subjectDepartmentId: any
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (subjectDepartmentId) {
    const [deptRows] = await queryRunner.query<any[]>(
      `/* IA:CHECK_USER_DEPARTMENT_ACTIVE */
       SELECT id, code, name, is_active FROM departments WHERE id = ? LIMIT 1`,
      [Number(subjectDepartmentId)]
    );
    if (deptRows && deptRows.length > 0 && !Boolean(deptRows[0].is_active)) {
      return {
        ok: false,
        error: `Department "${deptRows[0].name}" is currently deactivated. New marks entry and submissions are disabled while historical records remain preserved.`,
      };
    }
  }

  if (user && user.departmentId) {
    const [userDeptRows] = await queryRunner.query<any[]>(
      `/* IA:CHECK_USER_DEPARTMENT_ACTIVE */
       SELECT id, code, name, is_active FROM departments WHERE id = ? LIMIT 1`,
      [Number(user.departmentId)]
    );
    if (userDeptRows && userDeptRows.length > 0 && !Boolean(userDeptRows[0].is_active)) {
      return {
        ok: false,
        error: `Assigned department "${userDeptRows[0].name}" is currently deactivated. New department activity and marks submissions are disabled.`,
      };
    }
  }

  return { ok: true };
}

/**
 * Helper: Validates that selected batch and subject are compatible by curriculum scheme (RS7 vs RS6)
 * and professional year. Uses tagged queries for 100% parity between MySQL and standalone memory mode.
 */
async function validateBatchAndSubjectMatch(
  queryRunner: { query: <T = any>(sql: string, params?: any[]) => Promise<[T, any]> },
  batchId: number,
  subjectId: number,
  options?: {
    preloadedBatch?: any;
    preloadedSubject?: any;
    allowHistoricalReport?: boolean;
  }
): Promise<
  | { ok: true; batch: any; subject: any }
  | { ok: false; statusCode: number; code: string; error: string }
> {
  let batch = options?.preloadedBatch || null;
  if (!batch) {
    const [batchRows] = await queryRunner.query<any[]>(
      `/* IA:GET_BATCH_BY_ID */
       SELECT b.id, b.code, b.name, b.admission_academic_year, b.current_cohort_stage,
              b.current_professional_year, b.is_active, b.scheme_id,
              cs.code AS scheme_code, cs.is_legacy_minimal
       FROM academic_batches b
       LEFT JOIN curriculum_schemes cs ON b.scheme_id = cs.id
       WHERE b.id = ? LIMIT 1`,
      [batchId]
    );
    if (!batchRows || batchRows.length === 0) {
      return {
        ok: false,
        statusCode: 404,
        code: 'NOT_FOUND',
        error: 'Academic batch not found',
      };
    }
    batch = batchRows[0];
  }

  let subject = options?.preloadedSubject || null;
  if (!subject) {
    const [subjRows] = await queryRunner.query<any[]>(
      `/* IA:GET_SUBJECT_BY_ID */
       SELECT s.*, d.name AS department_name, d.code AS department_code, d.is_active AS department_is_active
       FROM subjects s
       LEFT JOIN departments d ON s.department_id = d.id
       WHERE s.id = ? LIMIT 1`,
      [subjectId]
    );
    if (!subjRows || subjRows.length === 0) {
      return {
        ok: false,
        statusCode: 404,
        code: 'NOT_FOUND',
        error: 'Subject not found',
      };
    }
    subject = subjRows[0];
  }

  const batchSchemeCode = String(batch.scheme_code || '').toUpperCase();
  const isLegacyBatch = Boolean(batch.is_legacy_minimal) || batchSchemeCode === 'RS6';
  if (isLegacyBatch) {
    return {
      ok: false,
      statusCode: 400,
      code: 'INCOMPATIBLE_BATCH_SUBJECT',
      error: `Batch "${batch.name}" belongs to legacy curriculum scheme ${batchSchemeCode || 'RS6'} and is isolated from RS7 Internal Assessment subject "${subject.name}".`,
    };
  }

  const batchProfYear =
    batch.current_professional_year !== null &&
    batch.current_professional_year !== undefined &&
    Number(batch.current_professional_year) > 0
      ? Number(batch.current_professional_year)
      : null;
  const subjectProfYear = Number(subject.professional_year);

  if (batchProfYear === null || batchProfYear !== subjectProfYear) {
    if (options?.allowHistoricalReport) {
      const [subHistory] = await queryRunner.query<any[]>(
        `/* IA:LIST_SUBMISSIONS_FOR_BATCH_SUBJECT */
         SELECT sub.id, sub.batch_id, sub.subject_id, sub.assessment_id
         FROM assessment_submissions sub
         WHERE sub.batch_id = ? AND sub.subject_id = ?`,
        [batchId, subjectId]
      );
      const [calcHistory] = await queryRunner.query<any[]>(
        `/* IA:LIST_FINAL_APPROVALS_FOR_BATCH_SUBJECT */
         SELECT sfia.id
         FROM student_final_ia_approvals sfia
         WHERE sfia.batch_id = ? AND sfia.subject_id = ?`,
        [batchId, subjectId]
      );
      if ((subHistory && subHistory.length > 0) || (calcHistory && calcHistory.length > 0)) {
        return { ok: true, batch, subject };
      }
    }

    if (batchProfYear === null) {
      return {
        ok: false,
        statusCode: 400,
        code: 'INCOMPATIBLE_BATCH_SUBJECT',
        error: `Batch "${batch.name}" does not have an active professional year (${batch.current_cohort_stage || 'Internship/Inactive'}) for subject "${subject.name}" (Professional Year ${subjectProfYear}).`,
      };
    }

    return {
      ok: false,
      statusCode: 400,
      code: 'INCOMPATIBLE_BATCH_SUBJECT',
      error: `Subject "${subject.name}" (Professional Year ${subjectProfYear}) is incompatible with batch "${batch.name}" (Current Professional Year ${batchProfYear}).`,
    };
  }

  return { ok: true, batch, subject };
}

function parseJsonSafe(raw: any): any {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * GET /api/internal-assessment/subjects
 * Returns institutional subjects with their IA configuration, verification flags, and PAT mapping.
 * Supports optional `?batchId=<id>` filtering to return only subjects applicable to that batch's
 * curriculum scheme and current professional year.
 * Department accounts only receive subjects assigned to their department.
 */
internalAssessmentRouter.get(
  '/subjects',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const pool = getPool();
      const batchIdParam = req.query.batchId ? parseInt(String(req.query.batchId), 10) : null;

      let filterProfYear: number | null = null;
      let excludeAllForSchemeOrStage = false;

      if (batchIdParam !== null && !isNaN(batchIdParam)) {
        const [batchRows] = await pool.query<any[]>(
          `/* IA:GET_BATCH_BY_ID */
           SELECT b.id, b.code, b.name, b.admission_academic_year, b.current_cohort_stage,
                  b.current_professional_year, b.is_active, b.scheme_id,
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
        const targetBatch = batchRows[0];
        const isLegacy =
          Boolean(targetBatch.is_legacy_minimal) ||
          String(targetBatch.scheme_code || '').toUpperCase() === 'RS6';
        const profYr =
          targetBatch.current_professional_year !== null &&
          targetBatch.current_professional_year !== undefined &&
          Number(targetBatch.current_professional_year) > 0
            ? Number(targetBatch.current_professional_year)
            : null;
        if (isLegacy || profYr === null) {
          excludeAllForSchemeOrStage = true;
        } else {
          filterProfYear = profYr;
        }
      }

      const [rows] = await pool.query<any[]>(
        `/* IA:LIST_SUBJECTS */
         SELECT
           s.id,
           s.code,
           s.name,
           s.professional_year,
           s.department_id,
           d.name AS department_name,
           d.code AS department_code,
           d.is_active AS department_is_active,
           s.max_marks_theory,
           s.max_marks_practical,
           s.ia_maximum,
           s.is_ia_enabled,
           s.ia_calculation_rule,
           s.ia_formula_verified,
           s.pat_mapping_verified,
           s.pat_mapping_config,
           s.notes
         FROM subjects s
         LEFT JOIN departments d ON s.department_id = d.id
         ORDER BY s.professional_year ASC, s.name ASC`
      );

      let visibleRows = isDepartmentScopedRole(req.user!.role)
        ? rows.filter((s) => canAccessSubjectForUser(req.user, s.department_id))
        : rows;

      if (excludeAllForSchemeOrStage) {
        visibleRows = [];
      } else if (filterProfYear !== null) {
        visibleRows = visibleRows.filter(
          (s) => Number(s.professional_year) === Number(filterProfYear)
        );
      }

      res.json({
        success: true,
        subjects: visibleRows.map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          schemeCode: 'RS7',
          professionalYear: s.professional_year,
          departmentId: s.department_id || null,
          departmentName: s.department_name || null,
          departmentCode: s.department_code || null,
          departmentIsActive:
            s.department_is_active !== null && s.department_is_active !== undefined
              ? Boolean(s.department_is_active)
              : null,
          maxMarksTheory: s.max_marks_theory !== null ? Number(s.max_marks_theory) : null,
          maxMarksPractical: s.max_marks_practical !== null ? Number(s.max_marks_practical) : null,
          iaMaximum: Number(s.ia_maximum || 0),
          isIaEnabled: Boolean(s.is_ia_enabled),
          iaCalculationRule: s.ia_calculation_rule || 'STANDARD_PAT_TERM',
          iaFormulaVerified: Boolean(s.ia_formula_verified),
          patMappingVerified: Boolean(s.pat_mapping_verified),
          patMappingConfig: parseJsonSafe(s.pat_mapping_config),
          notes: s.notes || '',
        })),
      });
    } catch (err) {
      console.error('[KAMCH IA] Error fetching subjects:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve subjects', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * PUT /api/internal-assessment/subjects/:id
 * Authorized Office/Admin endpoint to update subject department linkage and/or verified PAT-to-Term (A, B, C) mapping.
 * Preserves curriculum guardrails on Research Methodology and Atyaikachikitsa and triggers automatic IA recalculation.
 */
internalAssessmentRouter.put(
  '/subjects/:id',
  requireRoles(...IA_CONFIG_ROLES),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const subjectId = parseInt(req.params.id, 10);
    if (!subjectId || isNaN(subjectId)) {
      res.status(400).json({ error: 'Valid subject ID is required', code: 'INVALID_ID' });
      return;
    }

    const { departmentId, patMappingVerified, patMappingConfig, notes } = req.body || {};

    try {
      const pool = getPool();
      const [subjRows] = await pool.query<any[]>(
        `/* IA:GET_SUBJECT_BY_ID */
         SELECT s.*, d.name AS department_name, d.code AS department_code, d.is_active AS department_is_active
         FROM subjects s
         LEFT JOIN departments d ON s.department_id = d.id
         WHERE s.id = ? LIMIT 1`,
        [subjectId]
      );

      if (!subjRows || subjRows.length === 0) {
        res.status(404).json({ error: 'Subject not found', code: 'NOT_FOUND' });
        return;
      }
      const existing = subjRows[0];

      // Guardrail: Research Methodology & Atyaikachikitsa cannot have IA or PAT mappings enabled
      if (
        ['RESEARCH_METHODOLOGY', 'ATYAIKACHIKITSA'].includes(existing.code) &&
        (patMappingVerified || patMappingConfig)
      ) {
        res.status(400).json({
          error: `${existing.name} is excluded from Internal Assessment calculation and cannot be assigned a PAT mapping.`,
          code: 'SUBJECT_IA_EXCLUDED',
        });
        return;
      }

      const nextDeptId =
        departmentId === undefined
          ? existing.department_id
          : departmentId === null || departmentId === ''
            ? null
            : parseInt(String(departmentId), 10);

      if (nextDeptId !== null && isNaN(nextDeptId)) {
        res.status(400).json({ error: 'Invalid department ID', code: 'INVALID_DEPARTMENT' });
        return;
      }

      let nextPatVerified =
        patMappingVerified !== undefined
          ? Boolean(patMappingVerified)
          : Boolean(existing.pat_mapping_verified);
      let nextPatConfigObj =
        patMappingConfig !== undefined
          ? patMappingConfig
          : parseJsonSafe(existing.pat_mapping_config);

      if (!nextPatVerified) {
        if (patMappingConfig === null) {
          nextPatConfigObj = null;
        }
      } else {
        const validation = validatePatMappingConfig(nextPatConfigObj);
        if (!validation.valid) {
          res.status(400).json({ error: validation.error, code: 'INVALID_PAT_MAPPING' });
          return;
        }
        nextPatConfigObj = validation.config;
      }

      const nextNotes = notes !== undefined ? (notes ? String(notes).trim() : null) : existing.notes;

      await pool.query(
        `/* IA:UPDATE_SUBJECT_CONFIG */
         UPDATE subjects
         SET department_id = ?, pat_mapping_verified = ?, pat_mapping_config = ?, notes = ?
         WHERE id = ?`,
        [
          nextDeptId,
          nextPatVerified,
          nextPatConfigObj ? JSON.stringify(nextPatConfigObj) : null,
          nextNotes,
          subjectId,
        ]
      );

      // Automatically recalculate IA for all batches with submitted assessments for this subject
      await recalculateAllBatchesForSubject(subjectId);

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'IA_SUBJECT_CONFIGURATION_UPDATED',
        targetType: 'SUBJECT',
        targetId: String(subjectId),
        ipAddress: req.ip || null,
        details: {
          code: existing.code,
          departmentId: nextDeptId,
          patMappingVerified: nextPatVerified,
          patMappingConfig: nextPatConfigObj,
        },
      });

      res.json({
        success: true,
        message: 'Subject configuration updated and applicable IA calculations refreshed.',
      });
    } catch (err) {
      console.error('[KAMCH IA] Error updating subject configuration:', (err as Error).message);
      res.status(500).json({ error: 'Failed to update subject configuration', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * GET /api/internal-assessment/config/:subjectId
 * Returns assessment availability & date configuration for a subject (Step 2A).
 */
internalAssessmentRouter.get(
  '/config/:subjectId',
  async (req: Request, res: Response): Promise<void> => {
    const subjectId = parseInt(req.params.subjectId, 10);
    if (!subjectId || isNaN(subjectId)) {
      res.status(400).json({ error: 'Valid subject ID is required', code: 'INVALID_ID' });
      return;
    }

    try {
      const pool = getPool();
      const [subjRows] = await pool.query<any[]>(
        `/* IA:GET_SUBJECT_BY_ID */
         SELECT s.*, d.name AS department_name, d.code AS department_code, d.is_active AS department_is_active
         FROM subjects s
         LEFT JOIN departments d ON s.department_id = d.id
         WHERE s.id = ? LIMIT 1`,
        [subjectId]
      );
      if (!subjRows || subjRows.length === 0) {
        res.status(404).json({ error: 'Subject not found', code: 'NOT_FOUND' });
        return;
      }
      if (!canAccessSubjectForUser(req.user, subjRows[0].department_id)) {
        res.status(403).json({ error: 'Access denied: subject belongs to another department', code: 'FORBIDDEN' });
        return;
      }

      const [rows] = await pool.query<any[]>(
        `/* IA:GET_SUBJECT_ASSESSMENT_CONFIG */
         SELECT sac.id, sac.subject_id, sac.assessment_id, sac.is_applicable, sac.is_available_for_entry,
                sac.available_from_date, sac.available_to_date, sac.updated_by, sac.updated_at,
                a.code AS assessment_code, a.name AS assessment_name, a.assessment_type, a.term_number,
                a.max_marks_theory, a.max_marks_practical
         FROM subject_assessment_config sac
         JOIN assessments a ON sac.assessment_id = a.id
         WHERE sac.subject_id = ?
         ORDER BY a.term_number ASC, a.id ASC`,
        [subjectId]
      );

      res.json({
        success: true,
        configs: rows.map((r) => ({
          id: r.id,
          subjectId: r.subject_id,
          assessmentId: r.assessment_id,
          assessmentCode: r.assessment_code,
          assessmentName: r.assessment_name,
          assessmentType: r.assessment_type,
          termNumber: r.term_number,
          maxMarksTheory: Number(r.max_marks_theory || 0),
          maxMarksPractical: Number(r.max_marks_practical || 0),
          isApplicable: Boolean(r.is_applicable),
          isAvailableForEntry: Boolean(r.is_available_for_entry),
          availableFromDate: r.available_from_date || null,
          availableToDate: r.available_to_date || null,
        })),
      });
    } catch (err) {
      console.error('[KAMCH IA] Error fetching subject assessment config:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve assessment configuration', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * PUT /api/internal-assessment/config
 * Authorized Office/Admin endpoint to update assessment availability and dates for a subject (Step 2A).
 */
internalAssessmentRouter.put(
  '/config',
  requireRoles(...IA_CONFIG_ROLES),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const { subjectId, configs } = req.body || {};
    const parsedSubject = parseInt(subjectId, 10);

    if (!parsedSubject || isNaN(parsedSubject) || !Array.isArray(configs)) {
      res.status(400).json({ error: 'Subject ID and configs array are required', code: 'MISSING_FIELDS' });
      return;
    }

    try {
      const pool = getPool();
      const [subjRows] = await pool.query<any[]>(
        `/* IA:GET_SUBJECT_BY_ID */
         SELECT s.*, d.name AS department_name, d.code AS department_code, d.is_active AS department_is_active
         FROM subjects s
         LEFT JOIN departments d ON s.department_id = d.id
         WHERE s.id = ? LIMIT 1`,
        [parsedSubject]
      );
      if (!subjRows || subjRows.length === 0) {
        res.status(404).json({ error: 'Subject not found', code: 'NOT_FOUND' });
        return;
      }
      if (['ATYAIKACHIKITSA', 'RESEARCH_METHODOLOGY'].includes(subjRows[0].code)) {
        res.status(400).json({
          error: `${subjRows[0].name} does not use IA assessment structure configuration.`,
          code: 'SUBJECT_IA_EXCLUDED',
        });
        return;
      }

      for (const item of configs) {
        const assessmentId = parseInt(item.assessmentId, 10);
        if (!assessmentId || isNaN(assessmentId)) continue;
        await pool.query(
          `/* IA:UPSERT_SUBJECT_ASSESSMENT_CONFIG */
           INSERT INTO subject_assessment_config
             (subject_id, assessment_id, is_applicable, is_available_for_entry, available_from_date, available_to_date, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             is_applicable = VALUES(is_applicable),
             is_available_for_entry = VALUES(is_available_for_entry),
             available_from_date = VALUES(available_from_date),
             available_to_date = VALUES(available_to_date),
             updated_by = VALUES(updated_by)`,
          [
            parsedSubject,
            assessmentId,
            item.isApplicable !== undefined ? Boolean(item.isApplicable) : true,
            Boolean(item.isAvailableForEntry),
            item.availableFromDate || null,
            item.availableToDate || null,
            req.user!.id,
          ]
        );
      }

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'SUBJECT_ASSESSMENT_CONFIG_UPDATED',
        targetType: 'SUBJECT',
        targetId: String(parsedSubject),
        ipAddress: req.ip || null,
        details: { updatedCount: configs.length },
      });

      res.json({ success: true, message: 'Assessment availability configuration saved.' });
    } catch (err) {
      console.error('[KAMCH IA] Error saving assessment config:', (err as Error).message);
      res.status(500).json({ error: 'Failed to save assessment configuration', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * GET /api/internal-assessment/assessments
 * Returns predefined assessments (PAT 1-9, Term Test 1 & 2; no third term test).
 */
internalAssessmentRouter.get(
  '/assessments',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const pool = getPool();
      const [rows] = await pool.query<any[]>(
        `/* IA:LIST_ASSESSMENTS */
         SELECT id, code, name, assessment_type, term_number, max_marks_theory, max_marks_practical, is_active
         FROM assessments
         ORDER BY term_number ASC, id ASC`
      );

      res.json({
        success: true,
        assessments: rows.map((a) => ({
          id: a.id,
          code: a.code,
          name: a.name,
          assessmentType: a.assessment_type,
          termNumber: a.term_number,
          maxMarksTheory: Number(a.max_marks_theory || 15),
          maxMarksPractical: Number(a.max_marks_practical || 0),
          isActive: Boolean(a.is_active),
        })),
      });
    } catch (err) {
      console.error('[KAMCH IA] Error fetching assessments:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve assessments', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * GET /api/internal-assessment/batches
 * Returns academic batches with curriculum scheme metadata.
 */
internalAssessmentRouter.get(
  '/batches',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const pool = getPool();
      const [rows] = await pool.query<any[]>(
        `/* IA:LIST_BATCHES */
         SELECT b.id, b.code, b.name, b.admission_academic_year, b.current_cohort_stage,
                b.current_professional_year, b.is_active, b.scheme_id,
                cs.code AS scheme_code, cs.is_legacy_minimal
         FROM academic_batches b
         LEFT JOIN curriculum_schemes cs ON b.scheme_id = cs.id
         ORDER BY b.display_order ASC, b.id ASC`
      );

      res.json({
        success: true,
        batches: rows.map((b) => ({
          id: b.id,
          code: b.code,
          name: b.name,
          admissionAcademicYear: b.admission_academic_year,
          currentCohortStage: b.current_cohort_stage,
          currentProfessionalYear: b.current_professional_year,
          isActive: Boolean(b.is_active),
          schemeCode: b.scheme_code || null,
          isLegacyMinimal: Boolean(b.is_legacy_minimal),
        })),
      });
    } catch (err) {
      console.error('[KAMCH IA] Error fetching batches:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve batches', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * GET /api/internal-assessment/marks-entry
 * Returns students in a batch along with any saved draft/submitted marks and submission lock state.
 */
internalAssessmentRouter.get(
  '/marks-entry',
  async (req: Request, res: Response): Promise<void> => {
    const batchId = parseInt(req.query.batchId as string, 10);
    const subjectId = parseInt(req.query.subjectId as string, 10);
    const assessmentId = parseInt(req.query.assessmentId as string, 10);

    if (!batchId || isNaN(batchId) || !subjectId || isNaN(subjectId) || !assessmentId || isNaN(assessmentId)) {
      res.status(400).json({ error: 'Batch ID, Subject ID, and Assessment ID are required', code: 'MISSING_FIELDS' });
      return;
    }

    try {
      const pool = getPool();

      const [subjRows] = await pool.query<any[]>(
        `/* IA:GET_SUBJECT_BY_ID */
         SELECT s.*, d.name AS department_name, d.code AS department_code, d.is_active AS department_is_active
         FROM subjects s
         LEFT JOIN departments d ON s.department_id = d.id
         WHERE s.id = ? LIMIT 1`,
        [subjectId]
      );
      if (!subjRows || subjRows.length === 0) {
        res.status(404).json({ error: 'Subject not found', code: 'NOT_FOUND' });
        return;
      }
      const subject = subjRows[0];

      if (!canAccessSubjectForUser(req.user, subject.department_id)) {
        await recordAuditLog({
          actorId: req.user!.id,
          action: 'UNAUTHORIZED_DEPARTMENT_MARKS_ACCESS',
          targetType: 'SUBJECT',
          targetId: String(subjectId),
          ipAddress: req.ip || null,
        });
        res.status(403).json({ error: 'Access denied: subject belongs to another department', code: 'FORBIDDEN' });
        return;
      }

      const matchCheck = await validateBatchAndSubjectMatch(pool, batchId, subjectId, {
        preloadedSubject: subject,
      });
      if (!matchCheck.ok) {
        res.status(matchCheck.statusCode).json({ error: matchCheck.error, code: matchCheck.code });
        return;
      }

      const [subRows] = await pool.query<any[]>(
        `/* IA:GET_SUBMISSION_STATUS */
         SELECT sub.id, sub.batch_id, sub.subject_id, sub.assessment_id, sub.department_id,
                sub.submitted_by, sub.submitted_at, sub.status,
                u.username AS submitted_by_username, u.full_name AS submitted_by_fullname
         FROM assessment_submissions sub
         LEFT JOIN users u ON sub.submitted_by = u.id
         WHERE sub.batch_id = ? AND sub.subject_id = ? AND sub.assessment_id = ? LIMIT 1`,
        [batchId, subjectId, assessmentId]
      );
      const isSubmitted = Boolean(subRows && subRows.length > 0);
      const submissionInfo = isSubmitted
        ? {
            submittedAt: subRows[0].submitted_at,
            submittedBy: subRows[0].submitted_by_fullname || subRows[0].submitted_by_username || 'Authorized User',
          }
        : null;

      const [students] = await pool.query<any[]>(
        `/* IA:LIST_BATCH_STUDENTS */
         SELECT id, student_id_number AS studentIdNumber, temporary_roll_number AS temporaryRollNumber,
                permanent_university_number AS permanentUniversityNumber, full_name AS fullName,
                administrative_status AS administrativeStatus, scheme_id AS schemeId
         FROM students
         WHERE (current_placement_batch_id = ? OR original_batch_id = ?)
           AND administrative_status != 'CANCELLED'
         ORDER BY full_name ASC`,
        [batchId, batchId]
      );

      const [marksRows] = await pool.query<any[]>(
        `/* IA:LIST_MARKS_FOR_ASSESSMENT */
         SELECT id, student_id, subject_id, assessment_id, batch_id, outcome, theory_marks, practical_marks, is_draft, saved_by, updated_at
         FROM student_assessment_marks
         WHERE batch_id = ? AND subject_id = ? AND assessment_id = ?`,
        [batchId, subjectId, assessmentId]
      );

      const marksMap = new Map<number, any>();
      for (const m of marksRows) {
        marksMap.set(Number(m.student_id), {
          outcome: m.outcome,
          theoryMarks: m.theory_marks !== null && m.theory_marks !== undefined ? Number(m.theory_marks) : null,
          practicalMarks: m.practical_marks !== null && m.practical_marks !== undefined ? Number(m.practical_marks) : null,
          isDraft: Boolean(m.is_draft),
        });
      }

      res.json({
        success: true,
        isSubmitted,
        submissionInfo,
        students: students.map((s) => {
          const existing = marksMap.get(Number(s.id));
          return {
            id: s.id,
            studentIdNumber: s.studentIdNumber,
            temporaryRollNumber: s.temporaryRollNumber || s.studentIdNumber,
            permanentUniversityNumber: s.permanentUniversityNumber || null,
            fullName: s.fullName,
            administrativeStatus: s.administrativeStatus,
            outcome: existing ? existing.outcome : 'MARKS_ENTERED',
            theoryMarks: existing && existing.theoryMarks !== null ? existing.theoryMarks : '',
            practicalMarks: existing && existing.practicalMarks !== null ? existing.practicalMarks : '',
            isDraft: existing ? existing.isDraft : true,
          };
        }),
      });
    } catch (err) {
      console.error('[KAMCH IA] Error fetching marks entry list:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve students and marks', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * POST /api/internal-assessment/marks-entry
 * Saves draft marks for students in a batch for a given subject and assessment.
 * Blocked if assessment is already submitted/locked or if department is deactivated.
 */
internalAssessmentRouter.post(
  '/marks-entry',
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const { batchId, subjectId, assessmentId, entries } = req.body || {};

    const parsedBatch = parseInt(batchId, 10);
    const parsedSubject = parseInt(subjectId, 10);
    const parsedAssessment = parseInt(assessmentId, 10);

    if (
      !parsedBatch ||
      isNaN(parsedBatch) ||
      !parsedSubject ||
      isNaN(parsedSubject) ||
      !parsedAssessment ||
      isNaN(parsedAssessment) ||
      !Array.isArray(entries)
    ) {
      res.status(400).json({
        error: 'Batch ID, Subject ID, Assessment ID, and entries array are required',
        code: 'MISSING_FIELDS',
      });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // 1. Check submission lock
      const [existingSub] = await connection.query<any[]>(
        `/* IA:GET_SUBMISSION_STATUS */
         SELECT sub.id, sub.batch_id, sub.subject_id, sub.assessment_id, sub.department_id,
                sub.submitted_by, sub.submitted_at, sub.status,
                u.username AS submitted_by_username, u.full_name AS submitted_by_fullname
         FROM assessment_submissions sub
         LEFT JOIN users u ON sub.submitted_by = u.id
         WHERE sub.batch_id = ? AND sub.subject_id = ? AND sub.assessment_id = ? LIMIT 1`,
        [parsedBatch, parsedSubject, parsedAssessment]
      );
      if (existingSub && existingSub.length > 0) {
        await connection.rollback();
        res.status(403).json({
          error: 'Assessment is already submitted and locked against further modification',
          code: 'ASSESSMENT_LOCKED',
        });
        return;
      }

      // 2. Verify subject, IA eligibility, department isolation, active department status, and batch match
      const [subjRows] = await connection.query<any[]>(
        `/* IA:GET_SUBJECT_BY_ID */
         SELECT s.*, d.name AS department_name, d.code AS department_code, d.is_active AS department_is_active
         FROM subjects s
         LEFT JOIN departments d ON s.department_id = d.id
         WHERE s.id = ? LIMIT 1`,
        [parsedSubject]
      );
      if (!subjRows || subjRows.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: 'Subject not found', code: 'NOT_FOUND' });
        return;
      }
      const subject = subjRows[0];

      if (!canAccessSubjectForUser(req.user, subject.department_id)) {
        await connection.rollback();
        res.status(403).json({
          error: 'Access denied: subject belongs to another department',
          code: 'FORBIDDEN',
        });
        return;
      }

      const matchCheck = await validateBatchAndSubjectMatch(connection, parsedBatch, parsedSubject, {
        preloadedSubject: subject,
      });
      if (!matchCheck.ok) {
        await connection.rollback();
        res.status(matchCheck.statusCode).json({ error: matchCheck.error, code: matchCheck.code });
        return;
      }

      if (subject.code === 'ATYAIKACHIKITSA' || subject.ia_calculation_rule === 'SUBJECT_ONLY') {
        await connection.rollback();
        res.status(400).json({
          error: 'Atyaikachikitsa is maintained as a subject record only with no IA assessment structure.',
          code: 'SUBJECT_ONLY',
        });
        return;
      }

      const activeCheck = await checkDepartmentActiveForWrite(connection, req.user, subject.department_id);
      if (!activeCheck.ok) {
        await connection.rollback();
        res.status(403).json({ error: activeCheck.error, code: 'DEPARTMENT_INACTIVE' });
        return;
      }

      // 3. Verify assessment type to validate max marks
      const [assessRows] = await connection.query<any[]>(
        `/* IA:GET_ASSESSMENT_BY_ID */
         SELECT id, code, name, assessment_type, term_number, max_marks_theory, max_marks_practical, is_active
         FROM assessments WHERE id = ? LIMIT 1`,
        [parsedAssessment]
      );
      if (!assessRows || assessRows.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: 'Assessment not found', code: 'NOT_FOUND' });
        return;
      }
      const assessment = assessRows[0];
      const isPat = assessment.assessment_type === 'PAT';

      for (const entry of entries) {
        const studentId = parseInt(entry.studentId, 10);
        if (!studentId || isNaN(studentId)) continue;

        const outcome = ['MARKS_ENTERED', 'ABSENT', 'NOT_APPEARED', 'EXEMPTED'].includes(entry.outcome)
          ? entry.outcome
          : 'MARKS_ENTERED';

        let theoryMarks: number | null = null;
        let practicalMarks: number | null = null;

        if (outcome === 'MARKS_ENTERED') {
          if (entry.theoryMarks !== undefined && entry.theoryMarks !== null && String(entry.theoryMarks).trim() !== '') {
            const tm = Number(entry.theoryMarks);
            if (isNaN(tm) || tm < 0) {
              await connection.rollback();
              res.status(400).json({ error: `Invalid theory marks for student ID ${studentId}`, code: 'INVALID_MARKS' });
              return;
            }
            if (isPat && tm > 15) {
              await connection.rollback();
              res.status(400).json({ error: `PAT marks cannot exceed 15 (received ${tm})`, code: 'PAT_MARKS_EXCEEDED' });
              return;
            }
            if (!isPat && tm > 100) {
              await connection.rollback();
              res.status(400).json({ error: `Term test theory marks cannot exceed 100 (received ${tm})`, code: 'THEORY_MARKS_EXCEEDED' });
              return;
            }
            theoryMarks = tm;
          }

          if (!isPat && entry.practicalMarks !== undefined && entry.practicalMarks !== null && String(entry.practicalMarks).trim() !== '') {
            const pm = Number(entry.practicalMarks);
            if (isNaN(pm) || pm < 0 || pm > 100) {
              await connection.rollback();
              res.status(400).json({ error: `Term test practical marks must be between 0 and 100 (received ${pm})`, code: 'INVALID_PRACTICAL_MARKS' });
              return;
            }
            practicalMarks = pm;
          }
        } else if (outcome === 'ABSENT') {
          theoryMarks = 0;
          practicalMarks = 0;
        }

        await connection.query(
          `/* IA:UPSERT_STUDENT_MARK */
           INSERT INTO student_assessment_marks
             (student_id, subject_id, assessment_id, batch_id, outcome, theory_marks, practical_marks, is_draft, saved_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             outcome = VALUES(outcome),
             theory_marks = VALUES(theory_marks),
             practical_marks = VALUES(practical_marks),
             is_draft = VALUES(is_draft),
             saved_by = VALUES(saved_by)`,
          [studentId, parsedSubject, parsedAssessment, parsedBatch, outcome, theoryMarks, practicalMarks, true, req.user!.id]
        );
      }

      await connection.commit();

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'ASSESSMENT_MARKS_DRAFT_SAVED',
        targetType: 'ASSESSMENT_ENTRY',
        targetId: `${parsedBatch}-${parsedSubject}-${parsedAssessment}`,
        ipAddress: req.ip || null,
        details: { batchId: parsedBatch, subjectId: parsedSubject, assessmentId: parsedAssessment, count: entries.length },
      });

      res.json({
        success: true,
        message: 'Assessment marks draft saved successfully',
      });
    } catch (err) {
      await connection.rollback();
      console.error('[KAMCH IA] Error saving marks draft:', (err as Error).message);
      res.status(500).json({ error: 'Failed to save marks draft', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

/**
 * POST /api/internal-assessment/submit-assessment
 * Atomically validates student outcomes and mark bounds, locks marks, records submission,
 * and triggers Step 2D Automatic IA Calculation within the same transaction.
 */
internalAssessmentRouter.post(
  '/submit-assessment',
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const { batchId, subjectId, assessmentId, entries } = req.body || {};

    const parsedBatch = parseInt(batchId, 10);
    const parsedSubject = parseInt(subjectId, 10);
    const parsedAssessment = parseInt(assessmentId, 10);

    if (
      !parsedBatch ||
      isNaN(parsedBatch) ||
      !parsedSubject ||
      isNaN(parsedSubject) ||
      !parsedAssessment ||
      isNaN(parsedAssessment) ||
      !Array.isArray(entries)
    ) {
      res.status(400).json({
        error: 'Batch ID, Subject ID, Assessment ID, and entries array are required',
        code: 'MISSING_FIELDS',
      });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // 1. Prevent duplicate submissions
      const [existingSub] = await connection.query<any[]>(
        `/* IA:GET_SUBMISSION_STATUS */
         SELECT sub.id, sub.batch_id, sub.subject_id, sub.assessment_id, sub.department_id,
                sub.submitted_by, sub.submitted_at, sub.status,
                u.username AS submitted_by_username, u.full_name AS submitted_by_fullname
         FROM assessment_submissions sub
         LEFT JOIN users u ON sub.submitted_by = u.id
         WHERE sub.batch_id = ? AND sub.subject_id = ? AND sub.assessment_id = ? LIMIT 1`,
        [parsedBatch, parsedSubject, parsedAssessment]
      );
      if (existingSub && existingSub.length > 0) {
        await connection.rollback();
        res.status(409).json({
          error: 'Assessment is already submitted and locked against further modification',
          code: 'ALREADY_SUBMITTED',
        });
        return;
      }

      // 2. Verify subject, department isolation, batch compatibility, and active department status
      const [subjRows] = await connection.query<any[]>(
        `/* IA:GET_SUBJECT_BY_ID */
         SELECT s.*, d.name AS department_name, d.code AS department_code, d.is_active AS department_is_active
         FROM subjects s
         LEFT JOIN departments d ON s.department_id = d.id
         WHERE s.id = ? LIMIT 1`,
        [parsedSubject]
      );
      if (!subjRows || subjRows.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: 'Subject not found', code: 'NOT_FOUND' });
        return;
      }
      const subject = subjRows[0];

      if (!canAccessSubjectForUser(req.user, subject.department_id)) {
        await connection.rollback();
        res.status(403).json({
          error: 'Access denied: subject belongs to another department',
          code: 'FORBIDDEN',
        });
        return;
      }

      const matchCheck = await validateBatchAndSubjectMatch(connection, parsedBatch, parsedSubject, {
        preloadedSubject: subject,
      });
      if (!matchCheck.ok) {
        await connection.rollback();
        res.status(matchCheck.statusCode).json({ error: matchCheck.error, code: matchCheck.code });
        return;
      }

      if (subject.code === 'ATYAIKACHIKITSA' || subject.ia_calculation_rule === 'SUBJECT_ONLY') {
        await connection.rollback();
        res.status(400).json({
          error: 'Atyaikachikitsa is maintained as a subject record only with no IA assessment structure.',
          code: 'SUBJECT_ONLY',
        });
        return;
      }

      const activeCheck = await checkDepartmentActiveForWrite(connection, req.user, subject.department_id);
      if (!activeCheck.ok) {
        await connection.rollback();
        res.status(403).json({ error: activeCheck.error, code: 'DEPARTMENT_INACTIVE' });
        return;
      }

      // 3. Verify assessment type
      const [assessRows] = await connection.query<any[]>(
        `/* IA:GET_ASSESSMENT_BY_ID */
         SELECT id, code, name, assessment_type, term_number, max_marks_theory, max_marks_practical, is_active
         FROM assessments WHERE id = ? LIMIT 1`,
        [parsedAssessment]
      );
      if (!assessRows || assessRows.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: 'Assessment not found', code: 'NOT_FOUND' });
        return;
      }
      const assessment = assessRows[0];
      const isPat = assessment.assessment_type === 'PAT';

      // 4. Verify all applicable students in the batch have a recorded outcome
      const [students] = await connection.query<any[]>(
        `/* IA:LIST_BATCH_STUDENTS */
         SELECT id, student_id_number AS studentIdNumber, temporary_roll_number AS temporaryRollNumber,
                permanent_university_number AS permanentUniversityNumber, full_name AS fullName,
                administrative_status AS administrativeStatus, scheme_id AS schemeId
         FROM students
         WHERE (current_placement_batch_id = ? OR original_batch_id = ?)
           AND administrative_status != 'CANCELLED'
         ORDER BY full_name ASC`,
        [parsedBatch, parsedBatch]
      );

      if (!students || students.length === 0) {
        await connection.rollback();
        res.status(400).json({
          error: 'Cannot submit an assessment for a batch with no active students.',
          code: 'EMPTY_BATCH',
        });
        return;
      }

      const entryMap = new Map<number, any>();
      for (const e of entries) {
        entryMap.set(Number(e.studentId), e);
      }

      for (const s of students) {
        const studentEntry = entryMap.get(Number(s.id));
        if (
          !studentEntry ||
          !studentEntry.outcome ||
          !['MARKS_ENTERED', 'ABSENT', 'NOT_APPEARED', 'EXEMPTED'].includes(studentEntry.outcome)
        ) {
          await connection.rollback();
          res.status(400).json({
            error: `Missing outcome for student ${s.fullName || s.id}. Every student must have a recorded outcome before submission.`,
            code: 'INCOMPLETE_ASSESSMENT',
          });
          return;
        }
        if (studentEntry.outcome === 'MARKS_ENTERED') {
          if (
            isPat &&
            (studentEntry.theoryMarks === undefined ||
              studentEntry.theoryMarks === null ||
              String(studentEntry.theoryMarks).trim() === '')
          ) {
            await connection.rollback();
            res.status(400).json({
              error: `Missing PAT marks for student ${s.fullName || s.id}`,
              code: 'MISSING_MARKS',
            });
            return;
          }
          if (
            !isPat &&
            (studentEntry.theoryMarks === undefined ||
              studentEntry.theoryMarks === null ||
              String(studentEntry.theoryMarks).trim() === '' ||
              studentEntry.practicalMarks === undefined ||
              studentEntry.practicalMarks === null ||
              String(studentEntry.practicalMarks).trim() === '')
          ) {
            await connection.rollback();
            res.status(400).json({
              error: `Missing theory or practical marks for student ${s.fullName || s.id}`,
              code: 'MISSING_MARKS',
            });
            return;
          }
        }
      }

      // 5. Save and lock student marks (raw marks preserved unchanged)
      for (const s of students) {
        const entry = entryMap.get(Number(s.id));
        const studentId = Number(s.id);
        const outcome = entry.outcome;
        let theoryMarks: number | null = null;
        let practicalMarks: number | null = null;

        if (outcome === 'MARKS_ENTERED') {
          const tm = Number(entry.theoryMarks);
          if (isNaN(tm) || tm < 0) {
            await connection.rollback();
            res.status(400).json({ error: `Invalid theory marks for student ${s.fullName}`, code: 'INVALID_MARKS' });
            return;
          }
          if (isPat && tm > 15) {
            await connection.rollback();
            res.status(400).json({ error: `PAT marks cannot exceed 15 (received ${tm})`, code: 'PAT_MARKS_EXCEEDED' });
            return;
          }
          if (!isPat && tm > 100) {
            await connection.rollback();
            res.status(400).json({ error: `Term test theory marks cannot exceed 100 (received ${tm})`, code: 'THEORY_MARKS_EXCEEDED' });
            return;
          }
          theoryMarks = tm;

          if (!isPat) {
            const pm = Number(entry.practicalMarks);
            if (isNaN(pm) || pm < 0 || pm > 100) {
              await connection.rollback();
              res.status(400).json({
                error: `Term test practical marks must be between 0 and 100 (received ${pm})`,
                code: 'INVALID_PRACTICAL_MARKS',
              });
              return;
            }
            practicalMarks = pm;
          }
        } else if (outcome === 'ABSENT') {
          theoryMarks = 0;
          practicalMarks = 0;
        }

        await connection.query(
          `/* IA:UPSERT_STUDENT_MARK */
           INSERT INTO student_assessment_marks
             (student_id, subject_id, assessment_id, batch_id, outcome, theory_marks, practical_marks, is_draft, saved_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             outcome = VALUES(outcome),
             theory_marks = VALUES(theory_marks),
             practical_marks = VALUES(practical_marks),
             is_draft = VALUES(is_draft),
             saved_by = VALUES(saved_by)`,
          [studentId, parsedSubject, parsedAssessment, parsedBatch, outcome, theoryMarks, practicalMarks, false, req.user!.id]
        );
      }

      // 6. Insert submission lock record
      await connection.query(
        `/* IA:INSERT_SUBMISSION */
         INSERT INTO assessment_submissions (batch_id, subject_id, assessment_id, department_id, submitted_by, status)
         VALUES (?, ?, ?, ?, ?, 'SUBMITTED')`,
        [parsedBatch, parsedSubject, parsedAssessment, subject.department_id || null, req.user!.id]
      );

      // 7. Automatically compute/refresh Step 2D Term-Test Conversions & Automatic IA Calculation
      const calcSummary = await recalculateSubjectBatchIA(parsedBatch, parsedSubject, connection);

      // 8. Check and execute automatic term transition (Term 1 -> Term 2 or Term 2 -> Term 3) if all required subjects are submitted
      const termTransitionResult = await checkAndExecuteTermTransition(
        connection,
        parsedBatch,
        parsedAssessment,
        req.user!.id,
        req.ip
      );

      await connection.commit();

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'ASSESSMENT_SUBMITTED',
        targetType: 'ASSESSMENT_SUBMISSION',
        targetId: `${parsedBatch}-${parsedSubject}-${parsedAssessment}`,
        ipAddress: req.ip || null,
        details: {
          batchId: parsedBatch,
          subjectId: parsedSubject,
          assessmentId: parsedAssessment,
          assessmentCode: assessment.code,
          studentCount: students.length,
          iaCalculationSummary: calcSummary,
          termTransition: termTransitionResult,
        },
      });

      res.json({
        success: true,
        message: termTransitionResult.transitioned
          ? `Assessment submitted and batch automatically advanced from ${termTransitionResult.oldStage} to ${termTransitionResult.newStage}!`
          : 'Assessment submitted, locked, and automatic IA calculation updated.',
        calculationSummary: calcSummary,
        termTransition: termTransitionResult,
      });
    } catch (err) {
      await connection.rollback();
      console.error('[KAMCH IA] Error submitting assessment:', (err as Error).message);
      res.status(500).json({ error: 'Failed to submit assessment', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

/**
 * GET /api/internal-assessment/calculations
 * Step 2D: Retrieves Automatic IA Calculation results, Term-Test conversions, and explainability breakdown
 * for a given `(batchId, subjectId)`. Enforces server-side department isolation.
 */
internalAssessmentRouter.get(
  '/calculations',
  async (req: Request, res: Response): Promise<void> => {
    const batchId = parseInt(req.query.batchId as string, 10);
    const subjectId = parseInt(req.query.subjectId as string, 10);

    if (!batchId || isNaN(batchId) || !subjectId || isNaN(subjectId)) {
      res.status(400).json({ error: 'Batch ID and Subject ID are required', code: 'MISSING_FIELDS' });
      return;
    }

    try {
      const pool = getPool();
      const [subjRows] = await pool.query<any[]>(
        `/* IA:GET_SUBJECT_BY_ID */
         SELECT s.*, d.name AS department_name, d.code AS department_code, d.is_active AS department_is_active
         FROM subjects s
         LEFT JOIN departments d ON s.department_id = d.id
         WHERE s.id = ? LIMIT 1`,
        [subjectId]
      );
      if (!subjRows || subjRows.length === 0) {
        res.status(404).json({ error: 'Subject not found', code: 'NOT_FOUND' });
        return;
      }
      const subject = subjRows[0];

      if (!canAccessSubjectForUser(req.user, subject.department_id)) {
        await recordAuditLog({
          actorId: req.user!.id,
          action: 'UNAUTHORIZED_DEPARTMENT_IA_CALCULATION_ACCESS',
          targetType: 'SUBJECT',
          targetId: String(subjectId),
          ipAddress: req.ip || null,
        });
        res.status(403).json({ error: 'Access denied: subject belongs to another department', code: 'FORBIDDEN' });
        return;
      }

      const matchCheck = await validateBatchAndSubjectMatch(pool, batchId, subjectId, {
        preloadedSubject: subject,
      });
      if (!matchCheck.ok) {
        res.status(matchCheck.statusCode).json({ error: matchCheck.error, code: matchCheck.code });
        return;
      }
      const batch = matchCheck.batch;

      // Ensure calculation rows reflect current students & submitted assessments deterministically
      const summary = await recalculateSubjectBatchIA(batchId, subjectId);

      const [submissions] = await pool.query<any[]>(
        `/* IA:LIST_SUBMISSIONS_FOR_BATCH_SUBJECT */
         SELECT sub.id, sub.batch_id, sub.subject_id, sub.assessment_id, sub.department_id,
                sub.submitted_by, sub.submitted_at, sub.status,
                a.code AS assessment_code, a.name AS assessment_name, a.assessment_type, a.term_number,
                u.username AS submitted_by_username, u.full_name AS submitted_by_fullname
         FROM assessment_submissions sub
         JOIN assessments a ON sub.assessment_id = a.id
         LEFT JOIN users u ON sub.submitted_by = u.id
         WHERE sub.batch_id = ? AND sub.subject_id = ?
         ORDER BY a.term_number ASC, a.id ASC`,
        [batchId, subjectId]
      );

      const [conversions] = await pool.query<any[]>(
        `/* IA:LIST_TERM_TEST_CONVERSIONS */
         SELECT sttc.*, a.code AS assessment_code, a.name AS assessment_name
         FROM student_term_test_conversions sttc
         JOIN assessments a ON a.id = sttc.assessment_id
         WHERE sttc.batch_id = ? AND sttc.subject_id = ?
         ORDER BY sttc.student_id ASC, sttc.term_number ASC`,
        [batchId, subjectId]
      );

      const [calcRows] = await pool.query<any[]>(
        `/* IA:LIST_STUDENT_IA_CALCULATIONS */
         SELECT siac.*,
                s.student_id_number AS studentIdNumber,
                s.temporary_roll_number AS temporaryRollNumber,
                s.permanent_university_number AS permanentUniversityNumber,
                s.full_name AS fullName,
                s.administrative_status AS administrativeStatus
         FROM student_ia_calculations siac
         JOIN students s ON s.id = siac.student_id
         WHERE siac.batch_id = ? AND siac.subject_id = ?
         ORDER BY s.full_name ASC`,
        [batchId, subjectId]
      );

      const conversionsByStudent = new Map<number, any[]>();
      for (const c of conversions) {
        const sid = Number(c.student_id);
        if (!conversionsByStudent.has(sid)) conversionsByStudent.set(sid, []);
        conversionsByStudent.get(sid)!.push({
          assessmentId: c.assessment_id,
          assessmentCode: c.assessment_code,
          assessmentName: c.assessment_name,
          termNumber: c.term_number,
          outcome: c.outcome,
          rawTheoryMarks: c.raw_theory_marks !== null ? Number(c.raw_theory_marks) : null,
          rawPracticalMarks: c.raw_practical_marks !== null ? Number(c.raw_practical_marks) : null,
          combinedRawMarks: c.combined_raw_marks !== null ? Number(c.combined_raw_marks) : null,
          conversionMaximum: Number(c.conversion_maximum),
          convertedMarks: c.converted_marks !== null ? Number(c.converted_marks) : null,
          conversionStatus: c.conversion_status,
          statusReason: c.status_reason || null,
          calculatedAt: c.calculated_at,
        });
      }

      const numOrNull = (v: any) => (v !== null && v !== undefined ? Number(v) : null);

      res.json({
        success: true,
        subject: {
          id: subject.id,
          code: subject.code,
          name: subject.name,
          professionalYear: subject.professional_year,
          departmentId: subject.department_id || null,
          departmentName: subject.department_name || null,
          iaMaximum: Number(subject.ia_maximum || 0),
          isIaEnabled: Boolean(subject.is_ia_enabled),
          iaCalculationRule: subject.ia_calculation_rule || 'STANDARD_PAT_TERM',
          iaFormulaVerified: Boolean(subject.ia_formula_verified),
          patMappingVerified: Boolean(subject.pat_mapping_verified),
          patMappingConfig: parseJsonSafe(subject.pat_mapping_config),
        },
        batch: {
          id: batch.id,
          code: batch.code,
          name: batch.name,
          admissionAcademicYear: batch.admission_academic_year,
          schemeCode: batch.scheme_code || null,
          isLegacyMinimal: Boolean(batch.is_legacy_minimal),
        },
        summary,
        submittedAssessments: submissions.map((sub) => ({
          assessmentId: sub.assessment_id,
          assessmentCode: sub.assessment_code,
          assessmentName: sub.assessment_name,
          assessmentType: sub.assessment_type,
          termNumber: sub.term_number,
          submittedAt: sub.submitted_at,
          submittedBy: sub.submitted_by_fullname || sub.submitted_by_username || 'Authorized User',
        })),
        calculations: calcRows.map((row) => ({
          studentId: row.student_id,
          studentIdNumber: row.studentIdNumber,
          temporaryRollNumber: row.temporaryRollNumber || row.studentIdNumber,
          permanentUniversityNumber: row.permanentUniversityNumber || null,
          fullName: row.fullName,
          administrativeStatus: row.administrativeStatus,
          schemeCode: row.scheme_code || null,
          iaMaximum: numOrNull(row.ia_maximum),
          term1: {
            A: numOrNull(row.term1_a),
            B: numOrNull(row.term1_b),
            C: numOrNull(row.term1_c),
            D: numOrNull(row.term1_d),
            E: numOrNull(row.term1_e),
            F: numOrNull(row.term1_f),
            H: numOrNull(row.term1_h),
          },
          term2: {
            A: numOrNull(row.term2_a),
            B: numOrNull(row.term2_b),
            C: numOrNull(row.term2_c),
            D: numOrNull(row.term2_d),
            E: numOrNull(row.term2_e),
            F: numOrNull(row.term2_f),
            H: numOrNull(row.term2_h),
          },
          term3: {
            A: numOrNull(row.term3_a),
            B: numOrNull(row.term3_b),
            C: numOrNull(row.term3_c),
            D: numOrNull(row.term3_d),
            E: numOrNull(row.term3_e),
            H: numOrNull(row.term3_h),
          },
          finalAutomaticIa: numOrNull(row.final_automatic_ia),
          termTestConversions: conversionsByStudent.get(Number(row.student_id)) || [],
          sourceAssessments: parseJsonSafe(row.source_assessments),
          calculationStatus: row.calculation_status,
          statusReason: row.status_reason || null,
          calculatedAt: row.calculated_at,
        })),
      });
    } catch (err) {
      console.error('[KAMCH IA] Error retrieving IA calculations:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve IA calculations', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * POST /api/internal-assessment/recalculate
 * Deterministically recomputes Automatic IA and Term-Test conversions from submitted source marks.
 */
internalAssessmentRouter.post(
  '/recalculate',
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const { batchId, subjectId } = req.body || {};
    const parsedBatch = parseInt(batchId, 10);
    const parsedSubject = parseInt(subjectId, 10);

    if (!parsedBatch || isNaN(parsedBatch) || !parsedSubject || isNaN(parsedSubject)) {
      res.status(400).json({ error: 'Batch ID and Subject ID are required', code: 'MISSING_FIELDS' });
      return;
    }

    try {
      const pool = getPool();
      const [subjRows] = await pool.query<any[]>(
        `/* IA:GET_SUBJECT_BY_ID */
         SELECT s.*, d.name AS department_name, d.code AS department_code, d.is_active AS department_is_active
         FROM subjects s
         LEFT JOIN departments d ON s.department_id = d.id
         WHERE s.id = ? LIMIT 1`,
        [parsedSubject]
      );
      if (!subjRows || subjRows.length === 0) {
        res.status(404).json({ error: 'Subject not found', code: 'NOT_FOUND' });
        return;
      }

      if (!canAccessSubjectForUser(req.user, subjRows[0].department_id)) {
        res.status(403).json({ error: 'Access denied: subject belongs to another department', code: 'FORBIDDEN' });
        return;
      }

      const matchCheck = await validateBatchAndSubjectMatch(pool, parsedBatch, parsedSubject, {
        preloadedSubject: subjRows[0],
      });
      if (!matchCheck.ok) {
        res.status(matchCheck.statusCode).json({ error: matchCheck.error, code: matchCheck.code });
        return;
      }

      const summary = await recalculateSubjectBatchIA(parsedBatch, parsedSubject);

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'IA_AUTOMATIC_RECALCULATED',
        targetType: 'SUBJECT_BATCH_IA',
        targetId: `${parsedBatch}-${parsedSubject}`,
        ipAddress: req.ip || null,
        details: summary,
      });

      res.json({
        success: true,
        message: 'Automatic IA calculation refreshed from submitted assessments.',
        summary,
      });
    } catch (err) {
      console.error('[KAMCH IA] Error recalculating IA:', (err as Error).message);
      res.status(500).json({ error: 'Failed to recalculate IA', code: 'DATABASE_ERROR' });
    }
  }
);

// ============================================================================
// STEP 2E: OFFICE REVIEW, FINAL IA APPROVAL & MANUAL ADJUSTMENT ENDPOINTS
// ============================================================================

/**
 * GET /api/internal-assessment/office-review
 * Authorized Office/Admin endpoint to inspect complete per-student raw PAT/Term-Test marks,
 * converted marks, stored Automatic IA breakdown, approved Final IA marks, review flags, and history.
 */
internalAssessmentRouter.get(
  '/office-review',
  requireRoles(...IA_CONFIG_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const batchId = parseInt(req.query.batchId as string, 10);
    const subjectId = parseInt(req.query.subjectId as string, 10);

    if (!batchId || isNaN(batchId) || !subjectId || isNaN(subjectId)) {
      res.status(400).json({ error: 'Batch ID and Subject ID are required', code: 'MISSING_FIELDS' });
      return;
    }

    try {
      const pool = getPool();
      const matchCheck = await validateBatchAndSubjectMatch(pool, batchId, subjectId);
      if (!matchCheck.ok) {
        res.status(matchCheck.statusCode).json({ error: matchCheck.error, code: matchCheck.code });
        return;
      }
      const subject = matchCheck.subject;
      const batch = matchCheck.batch;

      // Refresh calculations deterministically (and apply post-approval review flags if source marks changed)
      const calcSummary = await recalculateSubjectBatchIA(batchId, subjectId);

      const [submittedMarksRows] = await pool.query<any[]>(
        `/* IA:LIST_SUBMITTED_MARKS_FOR_BATCH_SUBJECT */
         SELECT sam.id, sam.student_id, sam.subject_id, sam.assessment_id, sam.batch_id,
                sam.outcome, sam.theory_marks, sam.practical_marks, sam.is_draft,
                a.code AS assessment_code, a.name AS assessment_name, a.assessment_type, a.term_number,
                sub.submitted_at
         FROM student_assessment_marks sam
         JOIN assessment_submissions sub
           ON sub.batch_id = sam.batch_id
          AND sub.subject_id = sam.subject_id
          AND sub.assessment_id = sam.assessment_id
         JOIN assessments a ON a.id = sam.assessment_id
         WHERE sam.batch_id = ? AND sam.subject_id = ? AND sam.is_draft = FALSE`,
        [batchId, subjectId]
      );

      const [conversions] = await pool.query<any[]>(
        `/* IA:LIST_TERM_TEST_CONVERSIONS */
         SELECT sttc.*, a.code AS assessment_code, a.name AS assessment_name
         FROM student_term_test_conversions sttc
         JOIN assessments a ON a.id = sttc.assessment_id
         WHERE sttc.batch_id = ? AND sttc.subject_id = ?
         ORDER BY sttc.student_id ASC, sttc.term_number ASC`,
        [batchId, subjectId]
      );

      const [calcRows] = await pool.query<any[]>(
        `/* IA:LIST_STUDENT_IA_CALCULATIONS */
         SELECT siac.*,
                s.student_id_number AS studentIdNumber,
                s.temporary_roll_number AS temporaryRollNumber,
                s.permanent_university_number AS permanentUniversityNumber,
                s.full_name AS fullName,
                s.administrative_status AS administrativeStatus
         FROM student_ia_calculations siac
         JOIN students s ON s.id = siac.student_id
         WHERE siac.batch_id = ? AND siac.subject_id = ?
         ORDER BY s.full_name ASC`,
        [batchId, subjectId]
      );

      const [approvalRows] = await pool.query<any[]>(
        `/* IA:LIST_FINAL_APPROVALS_FOR_BATCH_SUBJECT */
         SELECT sfia.*, u.username AS approved_by_username, u.full_name AS approved_by_fullname
         FROM student_final_ia_approvals sfia
         LEFT JOIN users u ON u.id = sfia.approved_by
         WHERE sfia.batch_id = ? AND sfia.subject_id = ?`,
        [batchId, subjectId]
      );

      const [historyRows] = await pool.query<any[]>(
        `/* IA:LIST_FINAL_IA_HISTORY */
         SELECT h.*, u.username AS actor_username, u.full_name AS actor_fullname,
                s.full_name AS student_name, s.temporary_roll_number
         FROM student_final_ia_history h
         LEFT JOIN users u ON u.id = h.actor_id
         LEFT JOIN students s ON s.id = h.student_id
         WHERE h.batch_id = ? AND h.subject_id = ?
         ORDER BY h.id DESC`,
        [batchId, subjectId]
      );

      const numOrNull = (v: any) => (v !== null && v !== undefined ? Number(v) : null);

      const rawMarksByStudent = new Map<number, Record<string, any>>();
      for (const m of submittedMarksRows || []) {
        const sid = Number(m.student_id);
        if (!rawMarksByStudent.has(sid)) rawMarksByStudent.set(sid, {});
        rawMarksByStudent.get(sid)![String(m.assessment_code)] = {
          assessmentId: Number(m.assessment_id),
          assessmentCode: String(m.assessment_code),
          assessmentName: String(m.assessment_name),
          assessmentType: m.assessment_type,
          termNumber: Number(m.term_number),
          outcome: m.outcome,
          theoryMarks: numOrNull(m.theory_marks),
          practicalMarks: numOrNull(m.practical_marks),
          submittedAt: m.submitted_at || null,
        };
      }

      const conversionsByStudent = new Map<number, any[]>();
      for (const c of conversions || []) {
        const sid = Number(c.student_id);
        if (!conversionsByStudent.has(sid)) conversionsByStudent.set(sid, []);
        conversionsByStudent.get(sid)!.push({
          assessmentId: c.assessment_id,
          assessmentCode: c.assessment_code,
          assessmentName: c.assessment_name,
          termNumber: Number(c.term_number),
          outcome: c.outcome,
          rawTheoryMarks: numOrNull(c.raw_theory_marks),
          rawPracticalMarks: numOrNull(c.raw_practical_marks),
          combinedRawMarks: numOrNull(c.combined_raw_marks),
          conversionMaximum: Number(c.conversion_maximum),
          convertedMarks: numOrNull(c.converted_marks),
          conversionStatus: c.conversion_status,
          statusReason: c.status_reason || null,
        });
      }

      const approvalByStudent = new Map<number, any>();
      for (const a of approvalRows || []) {
        approvalByStudent.set(Number(a.student_id), {
          id: Number(a.id),
          iaMaximum: Number(a.ia_maximum),
          automaticIaAtApproval: Number(a.automatic_ia_at_approval),
          approvedFinalIa: Number(a.approved_final_ia),
          approvalType: a.approval_type,
          finalStatus: a.final_status,
          requiresOfficeReview: Boolean(a.requires_office_review),
          reviewFlagReason: a.review_flag_reason || null,
          reasonCategory: a.reason_category || null,
          explanation: a.explanation || null,
          approvedById: Number(a.approved_by),
          approvedByName: a.approved_by_fullname || a.approved_by_username || 'Authorized Office User',
          approvedAt: a.approved_at,
          updatedAt: a.updated_at,
        });
      }

      const historyByStudent = new Map<number, any[]>();
      for (const h of historyRows || []) {
        const sid = Number(h.student_id);
        if (!historyByStudent.has(sid)) historyByStudent.set(sid, []);
        historyByStudent.get(sid)!.push({
          id: Number(h.id),
          actionType: h.action_type,
          previousFinalIa: numOrNull(h.previous_final_ia),
          newFinalIa: Number(h.new_final_ia),
          automaticIaValue: numOrNull(h.automatic_ia_value),
          reasonCategory: h.reason_category || null,
          explanation: h.explanation || null,
          actorId: h.actor_id ? Number(h.actor_id) : null,
          actorName: h.actor_fullname || h.actor_username || 'System Recalculation',
          createdAt: h.created_at,
        });
      }

      let approvedCount = 0;
      let adjustedCount = 0;
      let awaitingApprovalCount = 0;
      let requiresReReviewCount = 0;

      const studentsReview = (calcRows || []).map((row) => {
        const sid = Number(row.student_id);
        const calcStatus = row.calculation_status as 'CALCULATED' | 'PENDING' | 'NOT_APPLICABLE';
        const finalAutoIa = numOrNull(row.final_automatic_ia);
        const approval = approvalByStudent.get(sid) || null;
        const canApproveOrAdjust = calcStatus === 'CALCULATED' && finalAutoIa !== null;

        let currentFinalStatus:
          | 'NOT_APPLICABLE'
          | 'PENDING_CALCULATION'
          | 'AWAITING_APPROVAL'
          | 'APPROVED'
          | 'ADJUSTED_APPROVED'
          | 'REQUIRES_REVIEW';
        let officeReviewRequired = false;
        let officeReviewReason: string | null = null;

        if (calcStatus === 'NOT_APPLICABLE') {
          currentFinalStatus = 'NOT_APPLICABLE';
        } else if (approval && approval.requiresOfficeReview) {
          currentFinalStatus = 'REQUIRES_REVIEW';
          officeReviewRequired = true;
          officeReviewReason =
            approval.reviewFlagReason ||
            'Automatic IA changed after prior approval. Office re-review is required.';
          requiresReReviewCount++;
        } else if (approval && approval.approvalType === 'MANUAL_ADJUSTMENT') {
          currentFinalStatus = 'ADJUSTED_APPROVED';
          adjustedCount++;
        } else if (approval) {
          currentFinalStatus = 'APPROVED';
          approvedCount++;
        } else if (canApproveOrAdjust) {
          currentFinalStatus = 'AWAITING_APPROVAL';
          officeReviewRequired = true;
          officeReviewReason = 'Valid Automatic IA calculated and awaiting Office Final IA approval.';
          awaitingApprovalCount++;
        } else {
          currentFinalStatus = 'PENDING_CALCULATION';
        }

        return {
          studentId: sid,
          studentIdNumber: row.studentIdNumber,
          temporaryRollNumber: row.temporaryRollNumber || row.studentIdNumber,
          permanentUniversityNumber: row.permanentUniversityNumber || null,
          fullName: row.fullName,
          administrativeStatus: row.administrativeStatus,
          iaMaximum: numOrNull(row.ia_maximum),
          rawAssessments: rawMarksByStudent.get(sid) || {},
          termTestConversions: conversionsByStudent.get(sid) || [],
          calculation: {
            calculationStatus: calcStatus,
            statusReason: row.status_reason || null,
            finalAutomaticIa: finalAutoIa,
            term1: {
              A: numOrNull(row.term1_a),
              B: numOrNull(row.term1_b),
              C: numOrNull(row.term1_c),
              D: numOrNull(row.term1_d),
              E: numOrNull(row.term1_e),
              F: numOrNull(row.term1_f),
              H: numOrNull(row.term1_h),
            },
            term2: {
              A: numOrNull(row.term2_a),
              B: numOrNull(row.term2_b),
              C: numOrNull(row.term2_c),
              D: numOrNull(row.term2_d),
              E: numOrNull(row.term2_e),
              F: numOrNull(row.term2_f),
              H: numOrNull(row.term2_h),
            },
            term3: {
              A: numOrNull(row.term3_a),
              B: numOrNull(row.term3_b),
              C: numOrNull(row.term3_c),
              D: numOrNull(row.term3_d),
              E: numOrNull(row.term3_e),
              H: numOrNull(row.term3_h),
            },
            sourceAssessments: parseJsonSafe(row.source_assessments),
            calculatedAt: row.calculated_at,
          },
          approval,
          currentFinalStatus,
          officeReviewRequired,
          officeReviewReason,
          canApproveOrAdjust,
          history: historyByStudent.get(sid) || [],
        };
      });

      res.json({
        success: true,
        subject: {
          id: subject.id,
          code: subject.code,
          name: subject.name,
          professionalYear: subject.professional_year,
          departmentId: subject.department_id || null,
          departmentName: subject.department_name || null,
          departmentCode: subject.department_code || null,
          iaMaximum: Number(subject.ia_maximum || 0),
          isIaEnabled: Boolean(subject.is_ia_enabled),
          iaCalculationRule: subject.ia_calculation_rule || 'STANDARD_PAT_TERM',
          iaFormulaVerified: Boolean(subject.ia_formula_verified),
          patMappingVerified: Boolean(subject.pat_mapping_verified),
          patMappingConfig: parseJsonSafe(subject.pat_mapping_config),
        },
        batch: {
          id: batch.id,
          code: batch.code,
          name: batch.name,
          admissionAcademicYear: batch.admission_academic_year,
          currentProfessionalYear: batch.current_professional_year || null,
          schemeCode: batch.scheme_code || null,
          isLegacyMinimal: Boolean(batch.is_legacy_minimal),
        },
        reasonCategories: FINAL_IA_REASON_CATEGORIES,
        reviewSummary: {
          totalStudents: calcSummary.studentCount,
          calculatedCount: calcSummary.calculatedCount,
          pendingCount: calcSummary.pendingCount,
          notApplicableCount: calcSummary.notApplicableCount,
          approvedCount,
          adjustedCount,
          awaitingApprovalCount,
          requiresReReviewCount,
        },
        students: studentsReview,
      });
    } catch (err) {
      console.error('[KAMCH IA] Error retrieving Office IA review data:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve Office IA review data', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * POST /api/internal-assessment/final-approval
 * Approves a student's valid calculated Automatic IA result as their Final IA mark.
 */
internalAssessmentRouter.post(
  '/final-approval',
  requireRoles(...IA_CONFIG_ROLES),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const { batchId, subjectId, studentId } = req.body || {};
    const parsedBatch = parseInt(batchId, 10);
    const parsedSubject = parseInt(subjectId, 10);
    const parsedStudent = parseInt(studentId, 10);

    if (!parsedBatch || isNaN(parsedBatch) || !parsedSubject || isNaN(parsedSubject) || !parsedStudent || isNaN(parsedStudent)) {
      res.status(400).json({ error: 'Batch ID, Subject ID, and Student ID are required', code: 'MISSING_FIELDS' });
      return;
    }

    try {
      const pool = getPool();
      const matchCheck = await validateBatchAndSubjectMatch(pool, parsedBatch, parsedSubject);
      if (!matchCheck.ok) {
        res.status(matchCheck.statusCode).json({ error: matchCheck.error, code: matchCheck.code });
        return;
      }
      const result = await approveStudentFinalIA({
        studentId: parsedStudent,
        batchId: parsedBatch,
        subjectId: parsedSubject,
        actorId: req.user!.id,
        actorRole: req.user!.role,
      });

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'FINAL_IA_APPROVED',
        targetType: 'STUDENT_FINAL_IA',
        targetId: `${parsedBatch}-${parsedSubject}-${parsedStudent}`,
        ipAddress: req.ip || null,
        details: {
          studentId: parsedStudent,
          batchId: parsedBatch,
          subjectId: parsedSubject,
          automaticIaAtApproval: result.automaticIaAtApproval,
          previousFinalIa: result.previousFinalIa,
          approvedFinalIa: result.approvedFinalIa,
        },
      });

      res.json({
        success: true,
        message: 'Final IA mark approved and recorded.',
        approval: result,
      });
    } catch (err) {
      if (err instanceof IaActionError) {
        res.status(err.statusCode).json({ error: err.message, code: err.code });
        return;
      }
      console.error('[KAMCH IA] Error approving Final IA:', (err as Error).message);
      res.status(500).json({ error: 'Failed to approve Final IA mark', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * POST /api/internal-assessment/manual-adjustment
 * Records an authorized manual adjustment to a student's Final IA mark with mandatory category & explanation.
 */
internalAssessmentRouter.post(
  '/manual-adjustment',
  requireRoles(...IA_CONFIG_ROLES),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const { batchId, subjectId, studentId, adjustedFinalIa, reasonCategory, explanation } = req.body || {};
    const parsedBatch = parseInt(batchId, 10);
    const parsedSubject = parseInt(subjectId, 10);
    const parsedStudent = parseInt(studentId, 10);

    if (!parsedBatch || isNaN(parsedBatch) || !parsedSubject || isNaN(parsedSubject) || !parsedStudent || isNaN(parsedStudent)) {
      res.status(400).json({ error: 'Batch ID, Subject ID, and Student ID are required', code: 'MISSING_FIELDS' });
      return;
    }

    try {
      const pool = getPool();
      const matchCheck = await validateBatchAndSubjectMatch(pool, parsedBatch, parsedSubject);
      if (!matchCheck.ok) {
        res.status(matchCheck.statusCode).json({ error: matchCheck.error, code: matchCheck.code });
        return;
      }
      const result = await adjustStudentFinalIA({
        studentId: parsedStudent,
        batchId: parsedBatch,
        subjectId: parsedSubject,
        adjustedFinalIa: adjustedFinalIa !== undefined && adjustedFinalIa !== '' ? Number(adjustedFinalIa) : Number.NaN,
        reasonCategory: String(reasonCategory || ''),
        explanation: String(explanation || ''),
        actorId: req.user!.id,
        actorRole: req.user!.role,
      });

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'FINAL_IA_MANUALLY_ADJUSTED',
        targetType: 'STUDENT_FINAL_IA',
        targetId: `${parsedBatch}-${parsedSubject}-${parsedStudent}`,
        ipAddress: req.ip || null,
        details: {
          studentId: parsedStudent,
          batchId: parsedBatch,
          subjectId: parsedSubject,
          automaticIaAtApproval: result.automaticIaAtApproval,
          previousFinalIa: result.previousFinalIa,
          approvedFinalIa: result.approvedFinalIa,
          reasonCategory: result.reasonCategory,
          explanation: result.explanation,
        },
      });

      res.json({
        success: true,
        message: 'Manual Final IA adjustment saved with audit history.',
        approval: result,
      });
    } catch (err) {
      if (err instanceof IaActionError) {
        res.status(err.statusCode).json({ error: err.message, code: err.code });
        return;
      }
      console.error('[KAMCH IA] Error saving manual Final IA adjustment:', (err as Error).message);
      res.status(500).json({ error: 'Failed to save manual Final IA adjustment', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * GET /api/internal-assessment/final-history
 * Retrieves chronological Final IA approval & manual adjustment history for a batch/subject (or single student).
 */
internalAssessmentRouter.get(
  '/final-history',
  requireRoles(...IA_CONFIG_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const batchId = parseInt(req.query.batchId as string, 10);
    const subjectId = parseInt(req.query.subjectId as string, 10);
    const studentIdRaw = req.query.studentId as string | undefined;
    const studentId = studentIdRaw ? parseInt(studentIdRaw, 10) : null;

    if (!batchId || isNaN(batchId) || !subjectId || isNaN(subjectId)) {
      res.status(400).json({ error: 'Batch ID and Subject ID are required', code: 'MISSING_FIELDS' });
      return;
    }

    try {
      const pool = getPool();
      const matchCheck = await validateBatchAndSubjectMatch(pool, batchId, subjectId, {
        allowHistoricalReport: true,
      });
      if (!matchCheck.ok) {
        res.status(matchCheck.statusCode).json({ error: matchCheck.error, code: matchCheck.code });
        return;
      }
      const params: any[] = [batchId, subjectId];
      let studentClause = '';
      if (studentId && !isNaN(studentId)) {
        studentClause = ' AND h.student_id = ?';
        params.push(studentId);
      }

      const [rows] = await pool.query<any[]>(
        `/* IA:LIST_FINAL_IA_HISTORY */
         SELECT h.*, u.username AS actor_username, u.full_name AS actor_fullname,
                s.full_name AS student_name, s.temporary_roll_number
         FROM student_final_ia_history h
         LEFT JOIN users u ON u.id = h.actor_id
         LEFT JOIN students s ON s.id = h.student_id
         WHERE h.batch_id = ? AND h.subject_id = ?${studentClause}
         ORDER BY h.id DESC`,
        params
      );

      res.json({
        success: true,
        history: (rows || []).map((h) => ({
          id: Number(h.id),
          studentId: Number(h.student_id),
          studentName: h.student_name || '',
          rollNumber: h.temporary_roll_number || '',
          actionType: h.action_type,
          previousFinalIa: h.previous_final_ia !== null ? Number(h.previous_final_ia) : null,
          newFinalIa: Number(h.new_final_ia),
          automaticIaValue: h.automatic_ia_value !== null ? Number(h.automatic_ia_value) : null,
          reasonCategory: h.reason_category || null,
          explanation: h.explanation || null,
          actorId: h.actor_id ? Number(h.actor_id) : null,
          actorName: h.actor_fullname || h.actor_username || 'System Recalculation',
          createdAt: h.created_at,
        })),
      });
    } catch (err) {
      console.error('[KAMCH IA] Error retrieving Final IA history:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve Final IA history', code: 'DATABASE_ERROR' });
    }
  }
);

// ============================================================================
// STEP 2F: REPORT BRANDING, ON-DEMAND REPORTS & EXCEL-COMPATIBLE CSV EXPORTS
// ============================================================================

const DEFAULT_REPORT_BRANDING = {
  collegeName: 'Krishna Ayurvedic Medical College & Hospital',
  subtitle: 'Internal Assessment & Examination Cell',
  logoUrl: '/assets/kamch-logo.png',
};

async function fetchReportBranding(queryRunner: {
  query: <T = any>(sql: string, params?: any[]) => Promise<[T, any]>;
}): Promise<{ collegeName: string; subtitle: string; logoUrl: string }> {
  const [rows] = await queryRunner.query<any[]>(
    `/* IA:GET_REPORT_BRANDING */
     SELECT setting_key, setting_value, updated_at
     FROM institutional_settings
     WHERE setting_key IN ('REPORT_COLLEGE_NAME', 'REPORT_SUBTITLE', 'REPORT_LOGO_URL')`
  );

  const map = new Map<string, string>();
  for (const r of rows || []) {
    if (r?.setting_key) {
      map.set(String(r.setting_key), String(r.setting_value ?? ''));
    }
  }

  return {
    collegeName: map.get('REPORT_COLLEGE_NAME')?.trim() || DEFAULT_REPORT_BRANDING.collegeName,
    subtitle:
      map.has('REPORT_SUBTITLE')
        ? map.get('REPORT_SUBTITLE')!.trim()
        : DEFAULT_REPORT_BRANDING.subtitle,
    logoUrl:
      map.has('REPORT_LOGO_URL')
        ? map.get('REPORT_LOGO_URL')!.trim()
        : DEFAULT_REPORT_BRANDING.logoUrl,
  };
}

function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') {
    return Number.isFinite(val) ? String(val) : '';
  }
  let str = String(val);
  // Protect Excel spreadsheet users against formula injection on text fields
  if (/^[=+\-@]/.test(str) && !/^-[0-9]+(\.[0-9]+)?$/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildExcelCsvContent(rows: Array<Array<unknown>>): string {
  const lines = rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(','));
  // Prepend UTF-8 BOM (\uFEFF) so Microsoft Excel opens UTF-8 characters cleanly
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function sanitizeFilenameToken(raw: string): string {
  return String(raw || 'report')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50) || 'report';
}

function formatIsoDateOnlyDisplay(raw: any): string | null {
  if (!raw) return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  if (!s) return null;
  return s.length >= 10 ? s.slice(0, 10) : s;
}

async function verifyReportScopeAuthorization(opts: {
  req: Request;
  subject: any;
  departmentIdRaw: string | undefined;
  reportKind: 'ASSESSMENT_REPORT' | 'FINAL_IA_REPORT';
}): Promise<
  | { ok: true }
  | { ok: false; statusCode: number; code: string; error: string }
> {
  const { req, subject, departmentIdRaw, reportKind } = opts;
  const user = req.user!;
  const trimmedDeptParam = departmentIdRaw !== undefined ? String(departmentIdRaw).trim() : '';

  if (isDepartmentScopedRole(user.role)) {
    if (!user.departmentId) {
      await recordAuditLog({
        actorId: user.id,
        action: 'UNAUTHORIZED_REPORT_ACCESS_ATTEMPT',
        targetType: reportKind,
        targetId: String(subject.id),
        ipAddress: req.ip || null,
        details: { reason: 'NO_ASSIGNED_DEPARTMENT' },
      });
      return {
        ok: false,
        statusCode: 403,
        code: 'FORBIDDEN',
        error: 'Access denied: your department account has no assigned department.',
      };
    }

    if (
      trimmedDeptParam &&
      (trimmedDeptParam.toUpperCase() === 'UNASSIGNED' ||
        Number(trimmedDeptParam) !== Number(user.departmentId))
    ) {
      await recordAuditLog({
        actorId: user.id,
        action: 'UNAUTHORIZED_REPORT_ACCESS_ATTEMPT',
        targetType: reportKind,
        targetId: String(subject.id),
        ipAddress: req.ip || null,
        details: {
          userDepartmentId: user.departmentId,
          requestedDepartmentId: trimmedDeptParam,
          reason: 'CROSS_DEPARTMENT_PARAMETER',
        },
      });
      return {
        ok: false,
        statusCode: 403,
        code: 'FORBIDDEN_CROSS_DEPARTMENT',
        error: 'Access denied: department accounts cannot access reports belonging to another department.',
      };
    }

    if (!canAccessSubjectForUser(user, subject.department_id)) {
      await recordAuditLog({
        actorId: user.id,
        action: 'UNAUTHORIZED_REPORT_ACCESS_ATTEMPT',
        targetType: reportKind,
        targetId: String(subject.id),
        ipAddress: req.ip || null,
        details: {
          userDepartmentId: user.departmentId,
          subjectDepartmentId: subject.department_id || null,
          reason: 'SUBJECT_CROSS_DEPARTMENT',
        },
      });
      return {
        ok: false,
        statusCode: 403,
        code: 'FORBIDDEN_CROSS_DEPARTMENT',
        error: 'Access denied: subject belongs to another department.',
      };
    }

    return { ok: true };
  }

  // Authorized Office / Admin roles: validate department-to-subject consistency if departmentId was explicitly specified
  if (trimmedDeptParam) {
    if (trimmedDeptParam.toUpperCase() === 'UNASSIGNED') {
      if (subject.department_id !== null && subject.department_id !== undefined) {
        return {
          ok: false,
          statusCode: 400,
          code: 'DEPARTMENT_SUBJECT_MISMATCH',
          error: 'Selected subject is assigned to a department and does not match the Unassigned filter.',
        };
      }
    } else {
      const parsedDeptId = parseInt(trimmedDeptParam, 10);
      if (isNaN(parsedDeptId) || parsedDeptId <= 0) {
        return {
          ok: false,
          statusCode: 400,
          code: 'INVALID_DEPARTMENT',
          error: 'Valid department ID is required.',
        };
      }
      if (Number(subject.department_id) !== parsedDeptId) {
        return {
          ok: false,
          statusCode: 400,
          code: 'DEPARTMENT_SUBJECT_MISMATCH',
          error: 'Selected subject does not belong to the selected department.',
        };
      }
    }
  }

  return { ok: true };
}

/**
 * GET /api/internal-assessment/report-branding
 * Returns institutional college name, subtitle, and logo URL for official printable reports.
 */
internalAssessmentRouter.get(
  '/report-branding',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const pool = getPool();
      const branding = await fetchReportBranding(pool);
      res.json({ success: true, branding });
    } catch (err) {
      console.error('[KAMCH IA] Error fetching report branding:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve report branding', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * PUT /api/internal-assessment/report-branding
 * Allows authorized Office / Admin users to configure report header branding (college name, subtitle, logo URL).
 */
internalAssessmentRouter.put(
  '/report-branding',
  requireRoles(...IA_CONFIG_ROLES),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const { collegeName, subtitle, logoUrl } = req.body || {};
    const cleanCollegeName = String(collegeName ?? '').trim();
    const cleanSubtitle = String(subtitle ?? '').trim();
    const cleanLogoUrl = String(logoUrl ?? '').trim();

    if (!cleanCollegeName || cleanCollegeName.length > 250) {
      res.status(400).json({
        error: 'College name is required and must not exceed 250 characters.',
        code: 'INVALID_COLLEGE_NAME',
      });
      return;
    }

    if (cleanSubtitle.length > 250) {
      res.status(400).json({
        error: 'Report subtitle must not exceed 250 characters.',
        code: 'INVALID_SUBTITLE',
      });
      return;
    }

    if (cleanLogoUrl.length > 450) {
      res.status(400).json({
        error: 'Logo URL must not exceed 450 characters.',
        code: 'INVALID_LOGO_URL',
      });
      return;
    }

    if (
      cleanLogoUrl !== '' &&
      !/^(\/[a-zA-Z0-9_\-./]+|https?:\/\/[^\s]+|data:image\/(png|jpeg|jpg|svg\+xml|webp);base64,[a-zA-Z0-9+/=]+)$/i.test(
        cleanLogoUrl
      )
    ) {
      res.status(400).json({
        error: 'Logo URL must be a valid relative asset path (/assets/...), HTTPS URL, or image data URI.',
        code: 'INVALID_LOGO_URL',
      });
      return;
    }

    try {
      const pool = getPool();
      const effectiveDate = new Date().toISOString().slice(0, 10);
      const entries: Array<[string, string, string]> = [
        ['REPORT_COLLEGE_NAME', cleanCollegeName, 'Updated official report college name'],
        ['REPORT_SUBTITLE', cleanSubtitle, 'Updated official report subtitle'],
        ['REPORT_LOGO_URL', cleanLogoUrl, 'Updated official report logo path'],
      ];

      for (const [key, val, reason] of entries) {
        await pool.query(
          `/* IA:UPSERT_REPORT_BRANDING */
           INSERT INTO institutional_settings (setting_key, setting_value, effective_date, updated_by, updated_reason)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             setting_value = VALUES(setting_value),
             effective_date = VALUES(effective_date),
             updated_by = VALUES(updated_by),
             updated_reason = VALUES(updated_reason)`,
          [key, val, effectiveDate, req.user!.id, reason]
        );
      }

      const branding = await fetchReportBranding(pool);

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'REPORT_BRANDING_UPDATED',
        targetType: 'INSTITUTIONAL_SETTING',
        targetId: 'REPORT_BRANDING',
        ipAddress: req.ip || null,
        details: branding,
      });

      res.json({
        success: true,
        message: 'Report header branding saved.',
        branding,
      });
    } catch (err) {
      console.error('[KAMCH IA] Error updating report branding:', (err as Error).message);
      res.status(500).json({ error: 'Failed to update report branding', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * GET /api/internal-assessment/reports/assessment
 * Generates an on-demand Assessment Report (JSON for screen/print or UTF-8 BOM CSV for Excel).
 * Preserves historical records even when batch or department is inactive.
 */
internalAssessmentRouter.get(
  '/reports/assessment',
  async (req: Request, res: Response): Promise<void> => {
    const batchId = parseInt(req.query.batchId as string, 10);
    const subjectId = parseInt(req.query.subjectId as string, 10);
    const assessmentId = parseInt(req.query.assessmentId as string, 10);
    const departmentIdRaw = req.query.departmentId as string | undefined;
    const format = String(req.query.format || 'json').trim().toLowerCase();

    if (!batchId || isNaN(batchId) || !subjectId || isNaN(subjectId) || !assessmentId || isNaN(assessmentId)) {
      res.status(400).json({
        error: 'Academic Batch, Subject, and Assessment are required to generate an assessment report.',
        code: 'MISSING_FIELDS',
      });
      return;
    }

    try {
      const pool = getPool();

      const [subjRows] = await pool.query<any[]>(
        `/* IA:GET_SUBJECT_BY_ID */
         SELECT s.*, d.name AS department_name, d.code AS department_code, d.is_active AS department_is_active
         FROM subjects s
         LEFT JOIN departments d ON s.department_id = d.id
         WHERE s.id = ? LIMIT 1`,
        [subjectId]
      );
      if (!subjRows || subjRows.length === 0) {
        res.status(404).json({ error: 'Subject not found', code: 'NOT_FOUND' });
        return;
      }
      const subject = subjRows[0];

      const authCheck = await verifyReportScopeAuthorization({
        req,
        subject,
        departmentIdRaw,
        reportKind: 'ASSESSMENT_REPORT',
      });
      if (!authCheck.ok) {
        res.status(authCheck.statusCode).json({ error: authCheck.error, code: authCheck.code });
        return;
      }

      const [batchRows] = await pool.query<any[]>(
        `/* IA:GET_BATCH_BY_ID */
         SELECT b.*, cs.code AS scheme_code, cs.is_legacy_minimal
         FROM academic_batches b
         LEFT JOIN curriculum_schemes cs ON b.scheme_id = cs.id
         WHERE b.id = ? LIMIT 1`,
        [batchId]
      );
      if (!batchRows || batchRows.length === 0) {
        res.status(404).json({ error: 'Academic batch not found', code: 'NOT_FOUND' });
        return;
      }
      const batch = batchRows[0];

      const matchCheck = await validateBatchAndSubjectMatch(pool, batchId, subjectId, {
        preloadedBatch: batch,
        preloadedSubject: subject,
        allowHistoricalReport: true,
      });
      if (!matchCheck.ok) {
        res.status(matchCheck.statusCode).json({ error: matchCheck.error, code: matchCheck.code });
        return;
      }

      const [assessRows] = await pool.query<any[]>(
        `/* IA:GET_ASSESSMENT_BY_ID */
         SELECT * FROM assessments WHERE id = ? LIMIT 1`,
        [assessmentId]
      );
      if (!assessRows || assessRows.length === 0) {
        res.status(404).json({ error: 'Assessment not found', code: 'NOT_FOUND' });
        return;
      }
      const assessment = assessRows[0];

      const [cfgRows] = await pool.query<any[]>(
        `/* IA:GET_SINGLE_SUBJECT_ASSESSMENT_CONFIG */
         SELECT available_from_date, available_to_date, is_applicable, is_available_for_entry
         FROM subject_assessment_config
         WHERE subject_id = ? AND assessment_id = ?
         LIMIT 1`,
        [subjectId, assessmentId]
      );
      const assessCfg = cfgRows && cfgRows.length > 0 ? cfgRows[0] : null;
      const fromDate = formatIsoDateOnlyDisplay(assessCfg?.available_from_date);
      const toDate = formatIsoDateOnlyDisplay(assessCfg?.available_to_date);
      const assessmentDateDisplay =
        fromDate && toDate && fromDate !== toDate
          ? `${fromDate} to ${toDate}`
          : fromDate || toDate || 'Date Not Configured';

      const [subRows] = await pool.query<any[]>(
        `/* IA:GET_SUBMISSION_STATUS */
         SELECT sub.*, u.username AS submitted_by_username, u.full_name AS submitted_by_fullname
         FROM assessment_submissions sub
         LEFT JOIN users u ON sub.submitted_by = u.id
         WHERE sub.batch_id = ? AND sub.subject_id = ? AND sub.assessment_id = ?
         LIMIT 1`,
        [batchId, subjectId, assessmentId]
      );
      const subRow = subRows && subRows.length > 0 ? subRows[0] : null;

      const [studentsRows] = await pool.query<any[]>(
        `/* IA:LIST_BATCH_STUDENTS */
         SELECT
           id,
           student_id_number AS studentIdNumber,
           COALESCE(temporary_roll_number, student_id_number) AS temporaryRollNumber,
           permanent_university_number AS permanentUniversityNumber,
           full_name AS fullName,
           administrative_status AS administrativeStatus,
           scheme_id AS schemeId
         FROM students
         WHERE (current_placement_batch_id = ? OR (current_placement_batch_id IS NULL AND original_batch_id = ?))
           AND COALESCE(administrative_status, 'ACTIVE') <> 'CANCELLED'
         ORDER BY full_name ASC`,
        [batchId, batchId]
      );

      const [marksRows] = await pool.query<any[]>(
        `/* IA:LIST_MARKS_FOR_ASSESSMENT */
         SELECT * FROM student_assessment_marks
         WHERE batch_id = ? AND subject_id = ? AND assessment_id = ?`,
        [batchId, subjectId, assessmentId]
      );

      const marksMap = new Map<number, any>();
      for (const m of marksRows || []) {
        marksMap.set(Number(m.student_id), m);
      }

      const isTermTest = assessment.assessment_type === 'TERM_TEST';
      const maxTheory = Number(assessment.max_marks_theory || (isTermTest ? 100 : 15));
      const maxPractical = Number(assessment.max_marks_practical || (isTermTest ? 100 : 0));

      const isLockedSubmitted = Boolean(subRow && subRow.status === 'SUBMITTED');
      const submissionStatus: 'SUBMITTED' | 'DRAFT_IN_PROGRESS' | 'NOT_STARTED' = isLockedSubmitted
        ? 'SUBMITTED'
        : marksRows && marksRows.length > 0
          ? 'DRAFT_IN_PROGRESS'
          : 'NOT_STARTED';

      const submitterName = subRow
        ? subRow.submitted_by_fullname || subRow.submitted_by_username || `User #${subRow.submitted_by}`
        : null;
      const submittedAt = subRow ? String(subRow.submitted_at) : null;

      let marksEnteredCount = 0;
      let absentCount = 0;
      let notAppearedCount = 0;
      let exemptedCount = 0;
      let notRecordedCount = 0;

      const studentReportRows = (studentsRows || []).map((st: any) => {
        const m = marksMap.get(Number(st.id));
        if (!m) {
          notRecordedCount++;
          return {
            studentId: Number(st.id),
            studentIdNumber: st.studentIdNumber,
            rollNumber: st.temporaryRollNumber || st.studentIdNumber,
            permanentUniversityNumber: st.permanentUniversityNumber || null,
            fullName: st.fullName,
            administrativeStatus: st.administrativeStatus || 'ACTIVE',
            outcome: 'NOT_RECORDED' as const,
            entryState: 'NOT_RECORDED' as const,
            theoryMarks: null as number | null,
            practicalMarks: null as number | null,
            maxMarksTheory: maxTheory,
            maxMarksPractical: isTermTest ? maxPractical : null,
          };
        }

        const outcome = String(m.outcome) as
          | 'MARKS_ENTERED'
          | 'ABSENT'
          | 'NOT_APPEARED'
          | 'EXEMPTED';
        if (outcome === 'MARKS_ENTERED') marksEnteredCount++;
        else if (outcome === 'ABSENT') absentCount++;
        else if (outcome === 'NOT_APPEARED') notAppearedCount++;
        else if (outcome === 'EXEMPTED') exemptedCount++;

        const theoryVal =
          outcome === 'MARKS_ENTERED' && m.theory_marks !== null && m.theory_marks !== undefined
            ? Number(m.theory_marks)
            : null;
        const pracVal =
          isTermTest &&
          outcome === 'MARKS_ENTERED' &&
          m.practical_marks !== null &&
          m.practical_marks !== undefined
            ? Number(m.practical_marks)
            : null;

        return {
          studentId: Number(st.id),
          studentIdNumber: st.studentIdNumber,
          rollNumber: st.temporaryRollNumber || st.studentIdNumber,
          permanentUniversityNumber: st.permanentUniversityNumber || null,
          fullName: st.fullName,
          administrativeStatus: st.administrativeStatus || 'ACTIVE',
          outcome,
          entryState: Boolean(m.is_draft) && !isLockedSubmitted ? ('DRAFT' as const) : ('SUBMITTED' as const),
          theoryMarks: theoryVal,
          practicalMarks: pracVal,
          maxMarksTheory: maxTheory,
          maxMarksPractical: isTermTest ? maxPractical : null,
        };
      });

      const branding = await fetchReportBranding(pool);
      const generatedAt = new Date().toISOString();
      const generatedBy = req.user!.fullName || req.user!.username;

      const reportPayload = {
        reportType: 'ASSESSMENT_REPORT' as const,
        branding,
        generatedAt,
        generatedBy,
        batch: {
          id: Number(batch.id),
          code: batch.code,
          name: batch.name,
          admissionAcademicYear: batch.admission_academic_year,
          currentProfessionalYear:
            batch.current_professional_year !== null && batch.current_professional_year !== undefined
              ? Number(batch.current_professional_year)
              : null,
          currentCohortStage: batch.current_cohort_stage,
          schemeCode: batch.scheme_code || null,
          isActive: Boolean(batch.is_active),
        },
        department: {
          id: subject.department_id ? Number(subject.department_id) : null,
          code: subject.department_code || null,
          name: subject.department_name || 'Unassigned Department',
          isActive:
            subject.department_is_active !== null && subject.department_is_active !== undefined
              ? Boolean(subject.department_is_active)
              : null,
        },
        subject: {
          id: Number(subject.id),
          code: subject.code,
          name: subject.name,
          professionalYear: Number(subject.professional_year),
        },
        assessment: {
          id: Number(assessment.id),
          code: assessment.code,
          name: assessment.name,
          assessmentType: assessment.assessment_type as 'PAT' | 'TERM_TEST' | 'UNIVERSITY_EXAM',
          termNumber: Number(assessment.term_number),
          maxMarksTheory: maxTheory,
          maxMarksPractical: isTermTest ? maxPractical : 0,
          configuredFromDate: fromDate,
          configuredToDate: toDate,
          assessmentDateDisplay,
        },
        submission: {
          status: submissionStatus,
          submittedBy: submitterName,
          submittedAt,
        },
        summary: {
          totalStudents: studentReportRows.length,
          marksEnteredCount,
          absentCount,
          notAppearedCount,
          exemptedCount,
          notRecordedCount,
        },
        students: studentReportRows,
      };

      await recordAuditLog({
        actorId: req.user!.id,
        action: format === 'csv' ? 'ASSESSMENT_REPORT_CSV_EXPORTED' : 'ASSESSMENT_REPORT_GENERATED',
        targetType: 'ASSESSMENT_REPORT',
        targetId: `${batchId}-${subjectId}-${assessmentId}`,
        ipAddress: req.ip || null,
        details: {
          batchId,
          subjectId,
          assessmentId,
          format,
          studentCount: studentReportRows.length,
          submissionStatus,
        },
      });

      if (format === 'csv') {
        const outcomeLabel = (o: string) => {
          switch (o) {
            case 'MARKS_ENTERED':
              return 'Marks Entered';
            case 'ABSENT':
              return 'Absent (0 in Calculation)';
            case 'NOT_APPEARED':
              return 'Not Appeared';
            case 'EXEMPTED':
              return 'Exempted';
            default:
              return 'Not Recorded';
          }
        };

        const submissionStatusLabel =
          submissionStatus === 'SUBMITTED'
            ? 'Submitted & Locked'
            : submissionStatus === 'DRAFT_IN_PROGRESS'
              ? 'Draft (Unsubmitted)'
              : 'Not Started';

        const csvRows: Array<Array<unknown>> = [
          [branding.collegeName],
          [branding.subtitle || 'Internal Assessment Report'],
          ['Report Type', 'Internal Assessment — Assessment Marks Report'],
          [
            'Academic Batch',
            `${reportPayload.batch.name} (${reportPayload.batch.admissionAcademicYear})${
              !reportPayload.batch.isActive ? ' [Inactive / Historical Batch]' : ''
            }`,
          ],
          [
            'Professional Year',
            reportPayload.batch.currentProfessionalYear
              ? `Professional Year ${reportPayload.batch.currentProfessionalYear} (Subject Year ${reportPayload.subject.professionalYear})`
              : `Subject Professional Year ${reportPayload.subject.professionalYear}`,
          ],
          ['Department', reportPayload.department.name],
          ['Subject', `${reportPayload.subject.name} (${reportPayload.subject.code})`],
          ['Assessment', `${reportPayload.assessment.name} (${reportPayload.assessment.code})`],
          ['Assessment Date', reportPayload.assessment.assessmentDateDisplay],
          ['Submission Status', submissionStatusLabel],
          ['Submitted By', reportPayload.submission.submittedBy || 'Not Submitted'],
          ['Submission Timestamp', reportPayload.submission.submittedAt || 'Not Submitted'],
          ['Report Generated At', generatedAt],
          ['Generated By', generatedBy],
          [],
        ];

        if (isTermTest) {
          csvRows.push([
            'Roll Number',
            'University Reg. No.',
            'Student Name',
            'Student Status',
            'Assessment Outcome',
            'Theory Marks',
            'Theory Maximum',
            'Practical Marks',
            'Practical Maximum',
            'Entry State',
          ]);
          for (const st of studentReportRows) {
            csvRows.push([
              st.rollNumber,
              st.permanentUniversityNumber || '',
              st.fullName,
              st.administrativeStatus,
              outcomeLabel(st.outcome),
              st.theoryMarks !== null ? Number(st.theoryMarks.toFixed(2)) : '',
              st.maxMarksTheory,
              st.practicalMarks !== null ? Number(st.practicalMarks.toFixed(2)) : '',
              st.maxMarksPractical ?? 100,
              st.entryState === 'SUBMITTED'
                ? 'Submitted'
                : st.entryState === 'DRAFT'
                  ? 'Draft'
                  : 'Not Recorded',
            ]);
          }
        } else {
          csvRows.push([
            'Roll Number',
            'University Reg. No.',
            'Student Name',
            'Student Status',
            'Assessment Outcome',
            'Marks Obtained',
            'Maximum Marks',
            'Entry State',
          ]);
          for (const st of studentReportRows) {
            csvRows.push([
              st.rollNumber,
              st.permanentUniversityNumber || '',
              st.fullName,
              st.administrativeStatus,
              outcomeLabel(st.outcome),
              st.theoryMarks !== null ? Number(st.theoryMarks.toFixed(2)) : '',
              st.maxMarksTheory,
              st.entryState === 'SUBMITTED'
                ? 'Submitted'
                : st.entryState === 'DRAFT'
                  ? 'Draft'
                  : 'Not Recorded',
            ]);
          }
        }

        const csvString = buildExcelCsvContent(csvRows);
        const filename = `KAMCH_Assessment_Report_${sanitizeFilenameToken(batch.code)}_${sanitizeFilenameToken(
          subject.code
        )}_${sanitizeFilenameToken(assessment.code)}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.status(200).send(csvString);
        return;
      }

      res.json({ success: true, report: reportPayload });
    } catch (err) {
      console.error('[KAMCH IA] Error generating assessment report:', (err as Error).message);
      res.status(500).json({ error: 'Failed to generate assessment report', code: 'DATABASE_ERROR' });
    }
  }
);

/**
 * GET /api/internal-assessment/reports/final-ia
 * Generates an on-demand Final IA Report strictly from stored calculation and office approval records.
 * NEVER recalculates marks independently inside reporting code, and NEVER presents a pending or
 * unapproved result as an approved Final IA mark.
 */
internalAssessmentRouter.get(
  '/reports/final-ia',
  async (req: Request, res: Response): Promise<void> => {
    const batchId = parseInt(req.query.batchId as string, 10);
    const subjectId = parseInt(req.query.subjectId as string, 10);
    const departmentIdRaw = req.query.departmentId as string | undefined;
    const format = String(req.query.format || 'json').trim().toLowerCase();

    if (!batchId || isNaN(batchId) || !subjectId || isNaN(subjectId)) {
      res.status(400).json({
        error: 'Academic Batch and Subject are required to generate a Final IA report.',
        code: 'MISSING_FIELDS',
      });
      return;
    }

    try {
      const pool = getPool();

      const [subjRows] = await pool.query<any[]>(
        `/* IA:GET_SUBJECT_BY_ID */
         SELECT s.*, d.name AS department_name, d.code AS department_code, d.is_active AS department_is_active
         FROM subjects s
         LEFT JOIN departments d ON s.department_id = d.id
         WHERE s.id = ? LIMIT 1`,
        [subjectId]
      );
      if (!subjRows || subjRows.length === 0) {
        res.status(404).json({ error: 'Subject not found', code: 'NOT_FOUND' });
        return;
      }
      const subject = subjRows[0];

      const authCheck = await verifyReportScopeAuthorization({
        req,
        subject,
        departmentIdRaw,
        reportKind: 'FINAL_IA_REPORT',
      });
      if (!authCheck.ok) {
        res.status(authCheck.statusCode).json({ error: authCheck.error, code: authCheck.code });
        return;
      }

      const [batchRows] = await pool.query<any[]>(
        `/* IA:GET_BATCH_BY_ID */
         SELECT b.*, cs.code AS scheme_code, cs.is_legacy_minimal
         FROM academic_batches b
         LEFT JOIN curriculum_schemes cs ON b.scheme_id = cs.id
         WHERE b.id = ? LIMIT 1`,
        [batchId]
      );
      if (!batchRows || batchRows.length === 0) {
        res.status(404).json({ error: 'Academic batch not found', code: 'NOT_FOUND' });
        return;
      }
      const batch = batchRows[0];

      const matchCheck = await validateBatchAndSubjectMatch(pool, batchId, subjectId, {
        preloadedBatch: batch,
        preloadedSubject: subject,
        allowHistoricalReport: true,
      });
      if (!matchCheck.ok) {
        res.status(matchCheck.statusCode).json({ error: matchCheck.error, code: matchCheck.code });
        return;
      }

      // Read-only queries on stored student, calculation, and final approval records (NO formula recalculation here!)
      const [studentsRows] = await pool.query<any[]>(
        `/* IA:LIST_BATCH_STUDENTS */
         SELECT
           id,
           student_id_number AS studentIdNumber,
           COALESCE(temporary_roll_number, student_id_number) AS temporaryRollNumber,
           permanent_university_number AS permanentUniversityNumber,
           full_name AS fullName,
           administrative_status AS administrativeStatus,
           scheme_id AS schemeId
         FROM students
         WHERE (current_placement_batch_id = ? OR (current_placement_batch_id IS NULL AND original_batch_id = ?))
           AND COALESCE(administrative_status, 'ACTIVE') <> 'CANCELLED'
         ORDER BY full_name ASC`,
        [batchId, batchId]
      );

      const [calcRows] = await pool.query<any[]>(
        `/* IA:LIST_STUDENT_IA_CALCULATIONS */
         SELECT c.*, s.student_id_number AS studentIdNumber,
                COALESCE(s.temporary_roll_number, s.student_id_number) AS temporaryRollNumber,
                s.permanent_university_number AS permanentUniversityNumber,
                s.full_name AS fullName,
                COALESCE(s.administrative_status, 'ACTIVE') AS administrativeStatus
         FROM student_ia_calculations c
         JOIN students s ON c.student_id = s.id
         WHERE c.batch_id = ? AND c.subject_id = ?
         ORDER BY s.full_name ASC`,
        [batchId, subjectId]
      );

      const [approvalRows] = await pool.query<any[]>(
        `/* IA:LIST_FINAL_APPROVALS_FOR_BATCH_SUBJECT */
         SELECT a.*, u.username AS approved_by_username, u.full_name AS approved_by_fullname
         FROM student_final_ia_approvals a
         LEFT JOIN users u ON u.id = a.approved_by
         WHERE a.batch_id = ? AND a.subject_id = ?`,
        [batchId, subjectId]
      );

      const calcMap = new Map<number, any>();
      for (const c of calcRows || []) {
        calcMap.set(Number(c.student_id), c);
      }

      const approvalMap = new Map<number, any>();
      for (const a of approvalRows || []) {
        approvalMap.set(Number(a.student_id), a);
      }

      const subjectIsIaApplicable =
        Boolean(subject.is_ia_enabled) &&
        Boolean(subject.ia_formula_verified) &&
        !Boolean(batch.is_legacy_minimal);
      const subjectIaMax = Number(subject.ia_maximum || 0);

      let calculatedCount = 0;
      let pendingCount = 0;
      let notApplicableCount = 0;
      let approvedFinalCount = 0;
      let adjustedFinalCount = 0;
      let awaitingApprovalCount = 0;
      let requiresReviewCount = 0;

      const studentRows = (studentsRows || []).map((st: any) => {
        const sid = Number(st.id);
        const calc = calcMap.get(sid) || null;
        const app = approvalMap.get(sid) || null;

        let calculationStatus: 'CALCULATED' | 'PENDING' | 'NOT_APPLICABLE';
        if (calc) {
          calculationStatus = calc.calculation_status as 'CALCULATED' | 'PENDING' | 'NOT_APPLICABLE';
        } else if (!subjectIsIaApplicable) {
          calculationStatus = 'NOT_APPLICABLE';
        } else {
          calculationStatus = 'PENDING';
        }

        if (calculationStatus === 'CALCULATED') calculatedCount++;
        else if (calculationStatus === 'PENDING') pendingCount++;
        else notApplicableCount++;

        const automaticIa =
          calculationStatus === 'CALCULATED' &&
          calc &&
          calc.final_automatic_ia !== null &&
          calc.final_automatic_ia !== undefined
            ? Number(calc.final_automatic_ia)
            : null;

        const iaMaximum =
          calc && calc.ia_maximum !== null && calc.ia_maximum !== undefined
            ? Number(calc.ia_maximum)
            : subjectIaMax > 0
              ? subjectIaMax
              : null;

        let finalApprovalStatus:
          | 'APPROVED'
          | 'ADJUSTED_APPROVED'
          | 'REQUIRES_REVIEW'
          | 'AWAITING_APPROVAL'
          | 'PENDING_CALCULATION'
          | 'NOT_APPLICABLE';
        let approvedFinalIa: number | null = null;
        let previouslyApprovedFinalIa: number | null = null;
        let reviewRequired = false;
        let statusNote = '';

        if (calculationStatus === 'NOT_APPLICABLE') {
          finalApprovalStatus = 'NOT_APPLICABLE';
          approvedFinalIa = null;
          previouslyApprovedFinalIa = app ? Number(app.approved_final_ia) : null;
          reviewRequired = Boolean(app?.requires_office_review);
          statusNote =
            calc?.status_reason ||
            subject.notes ||
            (batch.is_legacy_minimal
              ? 'Legacy RS6 cohort — automatic IA calculation not applied'
              : 'Not applicable under curriculum rules');
        } else if (app) {
          const flagged = Boolean(app.requires_office_review) || app.final_status === 'REQUIRES_REVIEW';
          previouslyApprovedFinalIa = Number(app.approved_final_ia);
          if (flagged) {
            finalApprovalStatus = 'REQUIRES_REVIEW';
            // Do NOT present a flagged/stale approval as a cleared approved final mark; surface it distinctly
            approvedFinalIa = null;
            reviewRequired = true;
            requiresReviewCount++;
            statusNote =
              app.review_flag_reason ||
              `Previously approved (${Number(app.approved_final_ia).toFixed(2)}); requires office re-review after recalculation`;
          } else {
            finalApprovalStatus = app.final_status as 'APPROVED' | 'ADJUSTED_APPROVED';
            approvedFinalIa = Number(app.approved_final_ia);
            reviewRequired = false;
            if (finalApprovalStatus === 'ADJUSTED_APPROVED') {
              adjustedFinalCount++;
              statusNote = `Manually adjusted (${app.reason_category || 'Authorized'})`;
            } else {
              approvedFinalCount++;
              statusNote = 'Approved as calculated';
            }
          }
        } else if (calculationStatus === 'CALCULATED') {
          finalApprovalStatus = 'AWAITING_APPROVAL';
          approvedFinalIa = null;
          reviewRequired = true;
          awaitingApprovalCount++;
          statusNote = 'Automatic IA calculated; awaiting office approval';
        } else {
          finalApprovalStatus = 'PENDING_CALCULATION';
          approvedFinalIa = null;
          reviewRequired = false;
          statusNote =
            calc?.status_reason ||
            (!subject.pat_mapping_verified
              ? 'Pending verified PAT-to-Term (A, B, C) mapping'
              : 'Pending required assessment submissions or calculation');
        }

        const approvedByName = app
          ? app.approved_by_fullname || app.approved_by_username || `User #${app.approved_by}`
          : null;

        return {
          studentId: sid,
          studentIdNumber: st.studentIdNumber,
          rollNumber: st.temporaryRollNumber || st.studentIdNumber,
          permanentUniversityNumber: st.permanentUniversityNumber || null,
          fullName: st.fullName,
          administrativeStatus: st.administrativeStatus || 'ACTIVE',
          iaMaximum,
          automaticIa,
          calculationStatus,
          approvedFinalIa,
          previouslyApprovedFinalIa,
          finalApprovalStatus,
          reviewRequired,
          statusNote,
          approvedBy: approvedByName,
          approvedAt: app ? String(app.approved_at) : null,
        };
      });

      const branding = await fetchReportBranding(pool);
      const generatedAt = new Date().toISOString();
      const generatedBy = req.user!.fullName || req.user!.username;

      const reportPayload = {
        reportType: 'FINAL_IA_REPORT' as const,
        branding,
        generatedAt,
        generatedBy,
        batch: {
          id: Number(batch.id),
          code: batch.code,
          name: batch.name,
          admissionAcademicYear: batch.admission_academic_year,
          currentProfessionalYear:
            batch.current_professional_year !== null && batch.current_professional_year !== undefined
              ? Number(batch.current_professional_year)
              : null,
          currentCohortStage: batch.current_cohort_stage,
          schemeCode: batch.scheme_code || null,
          isLegacyMinimal: Boolean(batch.is_legacy_minimal),
          isActive: Boolean(batch.is_active),
        },
        department: {
          id: subject.department_id ? Number(subject.department_id) : null,
          code: subject.department_code || null,
          name: subject.department_name || 'Unassigned Department',
          isActive:
            subject.department_is_active !== null && subject.department_is_active !== undefined
              ? Boolean(subject.department_is_active)
              : null,
        },
        subject: {
          id: Number(subject.id),
          code: subject.code,
          name: subject.name,
          professionalYear: Number(subject.professional_year),
          iaMaximum: subjectIaMax > 0 ? subjectIaMax : null,
          isIaEnabled: Boolean(subject.is_ia_enabled),
          iaCalculationRule: subject.ia_calculation_rule || 'STANDARD_PAT_TERM',
          patMappingVerified: Boolean(subject.pat_mapping_verified),
        },
        summary: {
          totalStudents: studentRows.length,
          calculatedCount,
          pendingCount,
          notApplicableCount,
          approvedFinalCount,
          adjustedFinalCount,
          awaitingApprovalCount,
          requiresReviewCount,
        },
        students: studentRows,
      };

      await recordAuditLog({
        actorId: req.user!.id,
        action: format === 'csv' ? 'FINAL_IA_REPORT_CSV_EXPORTED' : 'FINAL_IA_REPORT_GENERATED',
        targetType: 'FINAL_IA_REPORT',
        targetId: `${batchId}-${subjectId}`,
        ipAddress: req.ip || null,
        details: {
          batchId,
          subjectId,
          format,
          studentCount: studentRows.length,
          approvedTotal: approvedFinalCount + adjustedFinalCount,
        },
      });

      if (format === 'csv') {
        const approvalStatusLabel = (s: string) => {
          switch (s) {
            case 'APPROVED':
              return 'Approved (As Calculated)';
            case 'ADJUSTED_APPROVED':
              return 'Approved (Manually Adjusted)';
            case 'REQUIRES_REVIEW':
              return 'Requires Office Re-Review';
            case 'AWAITING_APPROVAL':
              return 'Awaiting Office Approval';
            case 'PENDING_CALCULATION':
              return 'Pending IA Calculation';
            default:
              return 'Not Applicable';
          }
        };

        const csvRows: Array<Array<unknown>> = [
          [branding.collegeName],
          [branding.subtitle || 'Internal Assessment Cell'],
          ['Report Type', 'Final Internal Assessment (IA) Official Report'],
          [
            'Academic Batch',
            `${reportPayload.batch.name} (${reportPayload.batch.admissionAcademicYear})${
              !reportPayload.batch.isActive ? ' [Inactive / Historical Batch]' : ''
            }`,
          ],
          [
            'Professional Year',
            reportPayload.batch.currentProfessionalYear
              ? `Professional Year ${reportPayload.batch.currentProfessionalYear} (Subject Year ${reportPayload.subject.professionalYear})`
              : `Subject Professional Year ${reportPayload.subject.professionalYear}`,
          ],
          ['Curriculum Scheme', reportPayload.batch.schemeCode || 'BAMS'],
          ['Department', reportPayload.department.name],
          ['Subject', `${reportPayload.subject.name} (${reportPayload.subject.code})`],
          [
            'Maximum IA Marks',
            reportPayload.subject.iaMaximum !== null ? reportPayload.subject.iaMaximum : 'Not Applicable',
          ],
          ['Report Generated At', generatedAt],
          ['Generated By', generatedBy],
          [],
          [
            'Roll Number',
            'University Reg. No.',
            'Student Name',
            'Maximum IA Marks',
            'Automatic IA Result',
            'Calculation Status',
            'Approved Final IA Mark',
            'Previously Approved Mark (If Flagged)',
            'Final IA Approval Status',
            'Review Required',
            'Status Note / Pending Reason',
            'Approved By',
            'Approved Timestamp',
          ],
        ];

        for (const st of studentRows) {
          csvRows.push([
            st.rollNumber,
            st.permanentUniversityNumber || '',
            st.fullName,
            st.iaMaximum !== null ? st.iaMaximum : 'N/A',
            st.automaticIa !== null ? Number(st.automaticIa.toFixed(2)) : st.calculationStatus === 'NOT_APPLICABLE' ? 'N/A' : 'Pending',
            st.calculationStatus,
            st.approvedFinalIa !== null ? Number(st.approvedFinalIa.toFixed(2)) : '',
            st.finalApprovalStatus === 'REQUIRES_REVIEW' && st.previouslyApprovedFinalIa !== null
              ? Number(st.previouslyApprovedFinalIa.toFixed(2))
              : '',
            approvalStatusLabel(st.finalApprovalStatus),
            st.reviewRequired ? 'Yes' : 'No',
            st.statusNote,
            st.approvedBy || '',
            st.approvedAt || '',
          ]);
        }

        const csvString = buildExcelCsvContent(csvRows);
        const filename = `KAMCH_Final_IA_Report_${sanitizeFilenameToken(batch.code)}_${sanitizeFilenameToken(
          subject.code
        )}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.status(200).send(csvString);
        return;
      }

      res.json({ success: true, report: reportPayload });
    } catch (err) {
      console.error('[KAMCH IA] Error generating Final IA report:', (err as Error).message);
      res.status(500).json({ error: 'Failed to generate Final IA report', code: 'DATABASE_ERROR' });
    }
  }
);
