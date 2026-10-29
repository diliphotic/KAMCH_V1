import { Router, Request, Response } from 'express';
import { getPool } from '../db.ts';
import { requireAuth, requirePasswordChangeClear, requireRoles } from '../middleware/auth.ts';
import { validateCsrf } from '../middleware/csrf.ts';
import { recordAuditLog } from '../services/audit.ts';
import {
  ROLES,
  FEES_AND_STUDENTS_ROLES,
  USER_MANAGEMENT_ROLES,
  isOfficeScopedRole,
} from '../permissions.ts';
import {
  evaluateProgressionProposal,
  computeCourseDurationStatus,
  toIsoDateOnly,
  STUDENT_CSV_HEADERS,
  parseCsvContent,
  serializeCsv,
  SubjectResultInput,
  SchemeConfig,
  BatchConfigNode,
} from '../services/student-progression.ts';

export const studentsRouter = Router();

studentsRouter.use(requireAuth);
studentsRouter.use(requirePasswordChangeClear);
studentsRouter.use(requireRoles(...FEES_AND_STUDENTS_ROLES));

const VALID_QUOTAS = ['GOVERNMENT', 'MANAGEMENT_PRIVATE', 'NRI'] as const;
const VALID_GENDERS = ['MALE', 'FEMALE', 'OTHER', 'NOT_SPECIFIED'] as const;
const VALID_ADMISSION_STATUSES = ['APPLIED', 'PROVISIONAL', 'CONFIRMED', 'CANCELLED'] as const;
const VALID_ADMIN_STATUSES = [
  'ADMISSION_PENDING',
  'ACTIVE',
  'DISCONTINUED',
  'CANCELLED',
  'COMPLETED',
] as const;
const VALID_BATCH_ADM_STATUSES = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CLOSED_LEGACY'] as const;
const VALID_DOC_RECEIVED = ['PENDING', 'RECEIVED', 'NOT_APPLICABLE', 'RETURNED_ORIGINAL'] as const;
const VALID_DOC_VERIF = ['UNVERIFIED', 'VERIFIED', 'DISCREPANCY'] as const;

function cleanStr(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s === '' ? null : s;
}

function normalizeDateStr(val: unknown): string | null {
  return toIsoDateOnly(val);
}

function mapAdminToLegacyStatus(
  adminStatus: string
): 'ACTIVE' | 'PASSED_OUT' | 'SUSPENDED' {
  if (adminStatus === 'COMPLETED') return 'PASSED_OUT';
  if (adminStatus === 'DISCONTINUED' || adminStatus === 'CANCELLED') return 'SUSPENDED';
  return 'ACTIVE';
}

function mapLegacyToAdminStatus(
  legacyStatus: string
): 'ACTIVE' | 'COMPLETED' | 'DISCONTINUED' {
  if (legacyStatus === 'PASSED_OUT') return 'COMPLETED';
  if (legacyStatus === 'SUSPENDED') return 'DISCONTINUED';
  return 'ACTIVE';
}

function maskActorName(
  actorName: string | null | undefined,
  actorRole: string | null | undefined,
  viewerRole: string
): string | null {
  if (!actorName && !actorRole) return null;
  if (actorRole === ROLES.SUPER_ADMIN && viewerRole !== ROLES.SUPER_ADMIN) {
    return 'System Administration';
  }
  return actorName || actorRole || null;
}

function maskActorRole(
  actorRole: string | null | undefined,
  viewerRole: string
): string | null {
  if (!actorRole) return null;
  if (actorRole === ROLES.SUPER_ADMIN && viewerRole !== ROLES.SUPER_ADMIN) {
    return 'ADMINISTRATION';
  }
  return actorRole;
}

function addDaysToIsoDate(dateStr: string | null, days: number): string | null {
  if (!dateStr) return null;
  const base = new Date(`${dateStr}T00:00:00Z`);
  if (isNaN(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + Math.max(0, days - 1));
  return base.toISOString().slice(0, 10);
}

async function getMaxCourseDurationYears(connOrPool: any): Promise<{
  maxYears: number;
  effectiveDate: string;
  updatedReason: string | null;
}> {
  const [rows] = await connOrPool.query(
    'SELECT setting_key, setting_value, effective_date, updated_reason FROM institutional_settings WHERE setting_key = ? LIMIT 1',
    ['MAX_COURSE_DURATION_YEARS']
  );
  if (rows && rows.length > 0) {
    const parsed = parseInt(String(rows[0].setting_value), 10);
    return {
      maxYears: !isNaN(parsed) && parsed > 0 ? parsed : 9,
      effectiveDate: toIsoDateOnly(rows[0].effective_date) || '2021-09-01',
      updatedReason: rows[0].updated_reason || null,
    };
  }
  return { maxYears: 9, effectiveDate: '2021-09-01', updatedReason: null };
}

/**
 * Generates a guaranteed-unique server-side temporary roll number (`KAMCH-YYYY-NNNN`)
 * inside an active database transaction using row-level sequence locking.
 */
async function allocateTemporaryRollNumber(
  connection: any,
  admissionYear: number
): Promise<string> {
  const safeYear =
    Number.isInteger(admissionYear) && admissionYear >= 1990 && admissionYear <= 2100
      ? admissionYear
      : new Date().getFullYear();

  await connection.query(
    `INSERT INTO student_roll_sequences (admission_year, last_seq)
     VALUES (?, 0)
     ON DUPLICATE KEY UPDATE admission_year = admission_year`,
    [safeYear]
  );

  const [seqRows] = await connection.query(
    'SELECT last_seq FROM student_roll_sequences WHERE admission_year = ? FOR UPDATE',
    [safeYear]
  );

  let nextSeq = (seqRows && seqRows[0] ? Number(seqRows[0].last_seq) : 0) + 1;
  let candidate = `KAMCH-${safeYear}-${String(nextSeq).padStart(4, '0')}`;

  // Guard against any pre-existing historical or imported collision
  for (let guard = 0; guard < 1000; guard++) {
    const [conflicts] = await connection.query(
      `/* SM:CHECK_IDENTIFIER_CONFLICT */
       SELECT id FROM students
       WHERE (student_id_number = ? OR temporary_roll_number = ? OR permanent_university_number = ?)
         AND id != ?
       LIMIT 1`,
      [candidate, candidate, candidate, -1]
    );
    if (!conflicts || conflicts.length === 0) {
      break;
    }
    nextSeq++;
    candidate = `KAMCH-${safeYear}-${String(nextSeq).padStart(4, '0')}`;
  }

  await connection.query(
    'UPDATE student_roll_sequences SET last_seq = ? WHERE admission_year = ?',
    [nextSeq, safeYear]
  );

  return candidate;
}

interface DuplicateCandidateMatch {
  studentId: number;
  studentIdNumber: string;
  fullName: string;
  matchType: 'HARD_IDENTIFIER' | 'POTENTIAL_PROFILE_MATCH';
  reason: string;
}

function findDuplicateCandidatesInList(
  existingRows: any[],
  candidate: {
    excludeStudentId?: number;
    permanentUniversityNumber?: string | null;
    neetRollNumber?: string | null;
    keaAcknowledgementNo?: string | null;
    fullName: string;
    dateOfBirth?: string | null;
    fatherName?: string | null;
    contactPhone?: string | null;
    admissionYear?: number | null;
  }
): DuplicateCandidateMatch[] {
  const matches: DuplicateCandidateMatch[] = [];
  const normName = candidate.fullName.trim().toLowerCase().replace(/\s+/g, ' ');
  const normPerm = candidate.permanentUniversityNumber?.trim().toUpperCase() || null;
  const normNeet = candidate.neetRollNumber?.trim().toUpperCase() || null;
  const normKea = candidate.keaAcknowledgementNo?.trim().toUpperCase() || null;
  const normDob = normalizeDateStr(candidate.dateOfBirth);
  const normFather = candidate.fatherName?.trim().toLowerCase().replace(/\s+/g, ' ') || null;
  const normPhone = candidate.contactPhone?.replace(/\D/g, '') || null;

  for (const row of existingRows) {
    if (candidate.excludeStudentId && Number(row.id) === Number(candidate.excludeStudentId)) {
      continue;
    }

    if (
      normPerm &&
      ((row.permanent_university_number &&
        String(row.permanent_university_number).toUpperCase() === normPerm) ||
        String(row.student_id_number).toUpperCase() === normPerm)
    ) {
      matches.push({
        studentId: row.id,
        studentIdNumber: row.student_id_number,
        fullName: row.full_name,
        matchType: 'HARD_IDENTIFIER',
        reason: `Permanent university registration number '${normPerm}' is already assigned to ${row.full_name} (${row.student_id_number}).`,
      });
      continue;
    }

    if (
      normNeet &&
      row.neet_roll_number &&
      String(row.neet_roll_number).trim().toUpperCase() === normNeet
    ) {
      matches.push({
        studentId: row.id,
        studentIdNumber: row.student_id_number,
        fullName: row.full_name,
        matchType: 'HARD_IDENTIFIER',
        reason: `NEET Roll Number '${normNeet}' is already linked to ${row.full_name} (${row.student_id_number}).`,
      });
      continue;
    }

    if (
      normKea &&
      row.kea_acknowledgement_no &&
      String(row.kea_acknowledgement_no).trim().toUpperCase() === normKea
    ) {
      matches.push({
        studentId: row.id,
        studentIdNumber: row.student_id_number,
        fullName: row.full_name,
        matchType: 'HARD_IDENTIFIER',
        reason: `KEA Acknowledgement Number '${normKea}' is already linked to ${row.full_name} (${row.student_id_number}).`,
      });
      continue;
    }

    const rowName = String(row.full_name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const rowDob = normalizeDateStr(row.date_of_birth);
    const rowFather = row.father_name
      ? String(row.father_name).trim().toLowerCase().replace(/\s+/g, ' ')
      : null;
    const rowPhone = row.contact_phone ? String(row.contact_phone).replace(/\D/g, '') : null;

    if (rowName === normName && normDob && rowDob === normDob) {
      if (!normFather || !rowFather || normFather === rowFather) {
        matches.push({
          studentId: row.id,
          studentIdNumber: row.student_id_number,
          fullName: row.full_name,
          matchType: 'POTENTIAL_PROFILE_MATCH',
          reason: `Matching student name ('${row.full_name}') and date of birth (${normDob}) already exists under ${row.student_id_number}.`,
        });
        continue;
      }
    }

    if (
      rowName === normName &&
      normPhone &&
      normPhone.length >= 10 &&
      rowPhone === normPhone &&
      candidate.admissionYear &&
      Number(row.admission_year) === Number(candidate.admissionYear)
    ) {
      matches.push({
        studentId: row.id,
        studentIdNumber: row.student_id_number,
        fullName: row.full_name,
        matchType: 'POTENTIAL_PROFILE_MATCH',
        reason: `Matching student name ('${row.full_name}'), phone, and admission year (${candidate.admissionYear}) already exists under ${row.student_id_number}.`,
      });
    }
  }

  return matches;
}

async function initializeStudentFeeAssessment(
  connection: any,
  params: {
    studentId: number;
    yearOfStudy: number;
    admissionQuota: 'GOVERNMENT' | 'MANAGEMENT_PRIVATE' | 'NRI';
    actorId: number;
  }
): Promise<void> {
  const [structRows] = await connection.query(
    `SELECT college_fee, development_fee
     FROM fee_structures
     WHERE academic_year = '2026-2027' AND admission_category = ?
     LIMIT 1`,
    [params.admissionQuota]
  );

  let collegeFee = 75750.0;
  let devFee = 50000.0;
  if (structRows && structRows.length > 0) {
    collegeFee = parseFloat(structRows[0].college_fee);
    devFee = parseFloat(structRows[0].development_fee);
  } else if (params.admissionQuota === 'MANAGEMENT_PRIVATE') {
    collegeFee = 400000.0;
    devFee = 0.0;
  } else if (params.admissionQuota === 'NRI') {
    collegeFee = 600000.0;
    devFee = 0.0;
  }

  const totalAssessed = collegeFee + devFee;

  await connection.query(
    `INSERT INTO student_fee_assessments
      (student_id, academic_year, year_of_study, admission_category, is_kea_exception_applied, kea_exception_reason, assessed_college_fee, assessed_development_fee, assessed_mess_fee, assessed_hostel_fee, total_assessed_fee, concession_total, revised_payable, notes, assessed_by)
     VALUES (?, '2026-2027', ?, ?, FALSE, NULL, ?, ?, ?, ?, ?, 0.00, ?, 'Initial Assessment', ?)`,
    [
      params.studentId,
      params.yearOfStudy,
      params.admissionQuota,
      collegeFee,
      devFee,
      0.0,
      0.0,
      totalAssessed,
      totalAssessed,
      params.actorId,
    ]
  );
}

function formatStudentSummaryRow(
  row: any,
  maxCourseDurationYears: number,
  selectedBatchId?: number | null
) {
  const isoDob = toIsoDateOnly(row.date_of_birth);
  const durationStatus = computeCourseDurationStatus(
    Number(row.admission_year),
    row.admission_date,
    maxCourseDurationYears,
    null,
    {
      dateOfBirth: row.date_of_birth,
      admissionStatus: row.admission_status,
    }
  );

  let classroomMapping = row.classroom_mapping;
  if (typeof classroomMapping === 'string') {
    try {
      classroomMapping = JSON.parse(classroomMapping);
    } catch {
      classroomMapping = null;
    }
  }

  let batchRelationship:
    | 'NOT_FILTERED'
    | 'ORIGINAL_AND_CURRENT'
    | 'PLACED_HERE_FROM_SENIOR'
    | 'ORIGINAL_PLACED_IN_JUNIOR' = 'NOT_FILTERED';
  let batchRelationshipLabel = row.current_placement_batch_name || row.original_batch_name || `Intake ${row.admission_year}`;

  if (selectedBatchId) {
    const isOrig = Number(row.original_batch_id) === Number(selectedBatchId);
    const isCurr = Number(row.current_placement_batch_id) === Number(selectedBatchId);
    if (isOrig && isCurr) {
      batchRelationship = 'ORIGINAL_AND_CURRENT';
      batchRelationshipLabel = 'Original & Current Cohort';
    } else if (isCurr && !isOrig) {
      batchRelationship = 'PLACED_HERE_FROM_SENIOR';
      batchRelationshipLabel = `Placed Here (Original: ${row.original_batch_name || 'Prior Batch'})`;
    } else if (isOrig && !isCurr) {
      batchRelationship = 'ORIGINAL_PLACED_IN_JUNIOR';
      batchRelationshipLabel = `Original Cohort (Currently in: ${row.current_placement_batch_name || 'Other Cohort'})`;
    }
  } else if (
    row.original_batch_id &&
    row.current_placement_batch_id &&
    Number(row.original_batch_id) !== Number(row.current_placement_batch_id)
  ) {
    batchRelationship = 'PLACED_HERE_FROM_SENIOR';
    batchRelationshipLabel = `Current: ${row.current_placement_batch_name} · Orig: ${row.original_batch_name}`;
  }

  return {
    id: row.id,
    studentIdNumber: row.student_id_number,
    temporaryRollNumber: row.temporary_roll_number || row.student_id_number,
    permanentUniversityNumber: row.permanent_university_number || null,
    universityRegStatus: row.university_reg_status || 'NOT_ENTERED',
    fullName: row.full_name,
    universityRecordedName: row.university_recorded_name || null,
    dateOfBirth: isoDob,
    gender: row.gender || null,
    contactPhone: row.contact_phone || '',
    contactEmail: row.contact_email || '',
    fatherName: row.father_name || null,
    schemeId: row.scheme_id || null,
    schemeCode: row.scheme_code || null,
    schemeName: row.scheme_name || null,
    isLegacyMinimal: Boolean(row.is_legacy_minimal),
    originalBatchId: row.original_batch_id || null,
    originalBatchCode: row.original_batch_code || null,
    originalBatchName: row.original_batch_name || null,
    currentPlacementBatchId: row.current_placement_batch_id || null,
    currentPlacementBatchCode: row.current_placement_batch_code || null,
    currentPlacementBatchName: row.current_placement_batch_name || null,
    batchRelationship,
    batchRelationshipLabel,
    admissionAcademicYear: row.admission_academic_year || null,
    admissionYear: Number(row.admission_year),
    admissionDate: durationStatus.normalizedAdmissionDate,
    // Preserve both admissionQuota and legacy admissionCategory for backward compatibility
    admissionQuota: row.admission_category,
    admissionCategory: row.admission_category,
    seatCategory: row.seat_category || null,
    reservationDetails: row.reservation_details || null,
    neetRollNumber: row.neet_roll_number || null,
    keaAcknowledgementNo: row.kea_acknowledgement_no || null,
    admissionStatus: row.admission_status || 'PROVISIONAL',
    administrativeStatus: row.administrative_status || 'ACTIVE',
    status: row.status || 'ACTIVE',
    currentYearOfStudy: Number(row.current_year_of_study || 1),
    detentionStage: Number(row.detention_stage || 0),
    progressionStatus: row.progression_status || 'REGULAR_ACTIVE',
    classroomMapping: classroomMapping || null,
    outstandingBacklogsCount: Number(row.outstanding_backlogs_count || 0),
    supplementaryDueCycle: row.supplementary_due_cycle || null,
    rs6InternshipCompleted:
      row.rs6_internship_completed === null || row.rs6_internship_completed === undefined
        ? null
        : Boolean(row.rs6_internship_completed),
    rs6AcademicSummary: row.rs6_academic_summary || null,
    messEnrolled: Boolean(row.mess_enrolled),
    hostelEnrolled: Boolean(row.hostel_enrolled),
    courseDurationFlag: durationStatus.exceedsLimit,
    approachingCourseDurationLimit: durationStatus.approachingLimit,
    elapsedYearsFromAdmission: durationStatus.elapsedYears,
    admissionDateRequiresVerification: durationStatus.requiresVerification,
    admissionDateVerificationNote: durationStatus.verificationReason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================================
// 1. CURRICULUM SCHEMES & ACADEMIC BATCHES CONFIGURATION (Sections 5 & 6)
// ============================================================================

studentsRouter.get('/schemes', async (_req: Request, res: Response): Promise<void> => {
  try {
    const pool = getPool();
    const [rows] = await pool.query<any[]>(
      'SELECT * FROM curriculum_schemes ORDER BY id ASC'
    );
    res.json({
      schemes: rows.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        courseName: s.course_name,
        isLegacyMinimal: Boolean(s.is_legacy_minimal),
        professionalYearsCount: Number(s.professional_years_count),
        regularPassMaxFailedForProvisional: Number(s.regular_pass_max_failed_for_provisional),
        allowProvisionalPromotion: Boolean(s.allow_provisional_promotion),
        passingCriteriaVerified: Boolean(s.passing_criteria_verified),
        supplementaryCycleMonths: Number(s.supplementary_cycle_months),
        defaultInternshipDays: Number(s.default_internship_days),
        isActive: Boolean(s.is_active),
        notes: s.notes || null,
      })),
    });
  } catch (err) {
    console.error('[KAMCH Students] Error listing curriculum schemes:', (err as Error).message);
    res.status(500).json({ error: 'Failed to retrieve curriculum schemes', code: 'DATABASE_ERROR' });
  }
});

studentsRouter.post(
  '/schemes',
  requireRoles(...USER_MANAGEMENT_ROLES),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const {
      code,
      name,
      courseName,
      isLegacyMinimal,
      professionalYearsCount,
      regularPassMaxFailedForProvisional,
      allowProvisionalPromotion,
      passingCriteriaVerified,
      supplementaryCycleMonths,
      defaultInternshipDays,
      isActive,
      notes,
    } = req.body || {};

    const cleanCode = cleanStr(code)?.toUpperCase();
    const cleanName = cleanStr(name);
    if (!cleanCode || !cleanName) {
      res.status(400).json({ error: 'Scheme code and name are required', code: 'MISSING_FIELDS' });
      return;
    }

    try {
      const pool = getPool();
      const [dup] = await pool.query<any[]>(
        'SELECT id FROM curriculum_schemes WHERE code = ?',
        [cleanCode]
      );
      if (dup && dup.length > 0) {
        res.status(409).json({
          error: `Curriculum scheme '${cleanCode}' already exists`,
          code: 'DUPLICATE_SCHEME',
        });
        return;
      }

      const [result] = await pool.query<any>(
        `INSERT INTO curriculum_schemes
          (code, name, course_name, is_legacy_minimal, professional_years_count, regular_pass_max_failed_for_provisional, allow_provisional_promotion, passing_criteria_verified, passing_rule_config, supplementary_cycle_months, default_internship_days, is_active, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          cleanCode,
          cleanName,
          cleanStr(courseName) || 'BAMS',
          Boolean(isLegacyMinimal),
          Number(professionalYearsCount ?? 3),
          Number(regularPassMaxFailedForProvisional ?? 2),
          allowProvisionalPromotion !== undefined ? Boolean(allowProvisionalPromotion) : true,
          passingCriteriaVerified !== undefined ? Boolean(passingCriteriaVerified) : false,
          null,
          Number(supplementaryCycleMonths ?? 6),
          Number(defaultInternshipDays ?? 365),
          isActive !== undefined ? Boolean(isActive) : true,
          cleanStr(notes),
        ]
      );

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'CURRICULUM_SCHEME_CREATED',
        targetType: 'CURRICULUM_SCHEME',
        targetId: String(result.insertId),
        ipAddress: req.ip || null,
        details: { code: cleanCode, name: cleanName },
      });

      res.status(201).json({
        success: true,
        message: `Curriculum scheme '${cleanName}' (${cleanCode}) created.`,
        schemeId: result.insertId,
      });
    } catch (err) {
      console.error('[KAMCH Students] Error creating scheme:', (err as Error).message);
      res.status(500).json({ error: 'Failed to create curriculum scheme', code: 'DATABASE_ERROR' });
    }
  }
);

studentsRouter.put(
  '/schemes/:schemeId',
  requireRoles(...USER_MANAGEMENT_ROLES),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const schemeId = parseInt(req.params.schemeId, 10);
    if (!schemeId || isNaN(schemeId)) {
      res.status(400).json({ error: 'Invalid scheme ID', code: 'INVALID_ID' });
      return;
    }

    try {
      const pool = getPool();
      const [rows] = await pool.query<any[]>(
        'SELECT * FROM curriculum_schemes WHERE id = ?',
        [schemeId]
      );
      if (!rows || rows.length === 0) {
        res.status(404).json({ error: 'Curriculum scheme not found', code: 'NOT_FOUND' });
        return;
      }
      const existing = rows[0];
      const b = req.body || {};

      const nextName = cleanStr(b.name) || existing.name;
      const nextCourse = cleanStr(b.courseName) || existing.course_name;
      const nextProfYears =
        b.professionalYearsCount !== undefined
          ? Number(b.professionalYearsCount)
          : Number(existing.professional_years_count);
      const nextMaxFailed =
        b.regularPassMaxFailedForProvisional !== undefined
          ? Number(b.regularPassMaxFailedForProvisional)
          : Number(existing.regular_pass_max_failed_for_provisional);
      const nextAllowProv =
        b.allowProvisionalPromotion !== undefined
          ? Boolean(b.allowProvisionalPromotion)
          : Boolean(existing.allow_provisional_promotion);
      const nextVerified =
        b.passingCriteriaVerified !== undefined
          ? Boolean(b.passingCriteriaVerified)
          : Boolean(existing.passing_criteria_verified);
      const nextSuppMonths =
        b.supplementaryCycleMonths !== undefined
          ? Number(b.supplementaryCycleMonths)
          : Number(existing.supplementary_cycle_months);
      const nextInternDays =
        b.defaultInternshipDays !== undefined
          ? Number(b.defaultInternshipDays)
          : Number(existing.default_internship_days);
      const nextActive =
        b.isActive !== undefined ? Boolean(b.isActive) : Boolean(existing.is_active);
      const nextNotes = b.notes !== undefined ? cleanStr(b.notes) : existing.notes;

      await pool.query(
        `UPDATE curriculum_schemes
         SET name = ?, course_name = ?, professional_years_count = ?, regular_pass_max_failed_for_provisional = ?,
             allow_provisional_promotion = ?, passing_criteria_verified = ?, supplementary_cycle_months = ?,
             default_internship_days = ?, is_active = ?, notes = ?
         WHERE id = ?`,
        [
          nextName,
          nextCourse,
          nextProfYears,
          nextMaxFailed,
          nextAllowProv,
          nextVerified,
          nextSuppMonths,
          nextInternDays,
          nextActive,
          nextNotes,
          schemeId,
        ]
      );

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'CURRICULUM_SCHEME_UPDATED',
        targetType: 'CURRICULUM_SCHEME',
        targetId: String(schemeId),
        ipAddress: req.ip || null,
        details: { code: existing.code, passingCriteriaVerified: nextVerified, isActive: nextActive },
      });

      res.json({ success: true, message: `Curriculum scheme '${nextName}' updated.` });
    } catch (err) {
      console.error('[KAMCH Students] Error updating scheme:', (err as Error).message);
      res.status(500).json({ error: 'Failed to update curriculum scheme', code: 'DATABASE_ERROR' });
    }
  }
);

studentsRouter.get('/batches', async (_req: Request, res: Response): Promise<void> => {
  try {
    const pool = getPool();
    const [rows] = await pool.query<any[]>(
      `SELECT
        b.*,
        cs.code AS scheme_code,
        cs.name AS scheme_name,
        cs.is_legacy_minimal,
        jb.code AS junior_batch_code,
        jb.name AS junior_batch_name,
        (SELECT COUNT(*) FROM students s1 WHERE s1.original_batch_id = b.id) AS original_student_count,
        (SELECT COUNT(*) FROM students s2 WHERE s2.current_placement_batch_id = b.id) AS current_placement_count,
        (SELECT COUNT(*) FROM students s3 WHERE s3.current_placement_batch_id = b.id AND s3.original_batch_id IS NOT NULL AND s3.original_batch_id != b.id) AS detained_placed_here_count
       FROM academic_batches b
       LEFT JOIN curriculum_schemes cs ON cs.id = b.scheme_id
       LEFT JOIN academic_batches jb ON jb.id = b.junior_batch_id
       ORDER BY b.display_order ASC, b.id ASC`
    );

    res.json({
      batches: rows.map((b) => ({
        id: b.id,
        code: b.code,
        name: b.name,
        admissionAcademicYear: b.admission_academic_year,
        admissionYearStart: b.admission_year_start ? Number(b.admission_year_start) : null,
        courseName: b.course_name,
        schemeId: Number(b.scheme_id),
        schemeCode: b.scheme_code || 'RS7',
        schemeName: b.scheme_name || '',
        isLegacyMinimal: Boolean(b.is_legacy_minimal),
        currentCohortStage: b.current_cohort_stage,
        currentProfessionalYear:
          b.current_professional_year !== null && b.current_professional_year !== undefined
            ? Number(b.current_professional_year)
            : null,
        juniorBatchId: b.junior_batch_id ? Number(b.junior_batch_id) : null,
        juniorBatchCode: b.junior_batch_code || null,
        juniorBatchName: b.junior_batch_name || null,
        admissionStatus: b.admission_status,
        isActive: Boolean(b.is_active),
        displayOrder: Number(b.display_order ?? 0),
        notes: b.notes || null,
        originalStudentCount: Number(b.original_student_count || 0),
        currentPlacementCount: Number(b.current_placement_count || 0),
        detainedPlacedHereCount: Number(b.detained_placed_here_count || 0),
      })),
    });
  } catch (err) {
    console.error('[KAMCH Students] Error listing batches:', (err as Error).message);
    res.status(500).json({ error: 'Failed to retrieve academic batches', code: 'DATABASE_ERROR' });
  }
});

async function validateBatchPlacementConfig(
  pool: any,
  input: {
    schemeId: number;
    rawCohortStage: string | null;
    rawProfYear: unknown;
    defaultStage?: string;
  }
): Promise<
  | {
      ok: true;
      normalizedStage: string;
      normalizedProfYear: number | null;
      schemeCode: string;
    }
  | { ok: false; code: string; error: string }
> {
  const [schemeRows] = await pool.query('SELECT * FROM curriculum_schemes WHERE id = ?', [
    input.schemeId,
  ]);
  if (!schemeRows || schemeRows.length === 0) {
    return {
      ok: false,
      code: 'INVALID_SCHEME',
      error: 'Selected curriculum scheme does not exist.',
    };
  }
  const scheme = schemeRows[0];
  const schemeCode = String(scheme.code || '').toUpperCase();
  const isLegacyScheme = Boolean(scheme.is_legacy_minimal || schemeCode === 'RS6');
  const maxProfYears = Math.max(1, Number(scheme.professional_years_count || 3));

  const stage = (input.rawCohortStage || input.defaultStage || 'PROF_YEAR_1_TERM_1')
    .trim()
    .toUpperCase();

  const parsedProfYear =
    input.rawProfYear !== null &&
    input.rawProfYear !== undefined &&
    String(input.rawProfYear).trim() !== ''
      ? Number(input.rawProfYear)
      : null;

  if (
    parsedProfYear !== null &&
    (!Number.isInteger(parsedProfYear) || parsedProfYear < 1 || parsedProfYear > maxProfYears)
  ) {
    return {
      ok: false,
      code: 'INVALID_PROFESSIONAL_YEAR',
      error: `Professional year for scheme ${schemeCode} must be between 1 and ${maxProfYears}.`,
    };
  }

  if (stage === 'LEGACY_COHORT') {
    if (!isLegacyScheme) {
      return {
        ok: false,
        code: 'SCHEME_STAGE_MISMATCH',
        error: `Legacy RS6 cohort stage cannot be assigned to a ${schemeCode} batch.`,
      };
    }
    return {
      ok: true,
      normalizedStage: 'LEGACY_COHORT',
      normalizedProfYear: parsedProfYear,
      schemeCode,
    };
  }

  if (stage === 'INTERNSHIP') {
    if (parsedProfYear !== null) {
      return {
        ok: false,
        code: 'STAGE_YEAR_MISMATCH',
        error: 'Compulsory internship batches cannot have an active professional year assigned.',
      };
    }
    return {
      ok: true,
      normalizedStage: 'INTERNSHIP',
      normalizedProfYear: null,
      schemeCode,
    };
  }

  if (stage === 'ADMISSION_IN_PROGRESS') {
    return {
      ok: true,
      normalizedStage: 'ADMISSION_IN_PROGRESS',
      normalizedProfYear: parsedProfYear,
      schemeCode,
    };
  }

  const termMatch = stage.match(/^PROF_YEAR_(\d+)_TERM_([123])$/);
  if (termMatch) {
    const stageYear = Number(termMatch[1]);
    if (stageYear < 1 || stageYear > maxProfYears) {
      return {
        ok: false,
        code: 'INVALID_PROFESSIONAL_YEAR',
        error: `Stage '${stage}' exceeds maximum professional year (${maxProfYears}) for scheme ${schemeCode}.`,
      };
    }
    if (parsedProfYear !== null && parsedProfYear !== stageYear) {
      return {
        ok: false,
        code: 'STAGE_YEAR_MISMATCH',
        error: `Selected term stage (${stage}) does not match current professional year (${parsedProfYear}).`,
      };
    }
    return {
      ok: true,
      normalizedStage: stage,
      normalizedProfYear: stageYear,
      schemeCode,
    };
  }

  const legacyProfMatch = stage.match(/^PROF_YEAR_(\d+)(?:_(?:JUNIOR|SENIOR))?$/);
  if (legacyProfMatch) {
    const stageYear = Number(legacyProfMatch[1]);
    if (stageYear < 1 || stageYear > maxProfYears) {
      return {
        ok: false,
        code: 'INVALID_PROFESSIONAL_YEAR',
        error: `Stage '${stage}' exceeds maximum professional year (${maxProfYears}) for scheme ${schemeCode}.`,
      };
    }
    if (parsedProfYear !== null && parsedProfYear !== stageYear) {
      return {
        ok: false,
        code: 'STAGE_YEAR_MISMATCH',
        error: `Cohort stage (${stage}) does not match current professional year (${parsedProfYear}).`,
      };
    }
    return {
      ok: true,
      normalizedStage: stage,
      normalizedProfYear: stageYear,
      schemeCode,
    };
  }

  return {
    ok: false,
    code: 'INVALID_COHORT_STAGE',
    error: `Unsupported cohort placement stage '${stage}'. Expected Term 1–3 within an applicable professional year, Admission in Progress, or Internship.`,
  };
}

studentsRouter.post(
  '/batches',
  requireRoles(...USER_MANAGEMENT_ROLES),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const b = req.body || {};
    const cleanCode = cleanStr(b.code)?.toUpperCase().replace(/\s+/g, '_');
    const cleanName = cleanStr(b.name);
    const cleanAcadYear = cleanStr(b.admissionAcademicYear);
    const schemeId = Number(b.schemeId);

    if (!cleanCode || !cleanName || !cleanAcadYear || !schemeId) {
      res.status(400).json({
        error: 'Batch code, batch name, admission academic year, and curriculum scheme are required',
        code: 'MISSING_FIELDS',
      });
      return;
    }

    // Prevent activating an unnamed placeholder batch prematurely
    const isActivating = Boolean(b.isActive);
    if (isActivating && /not assigned|unnamed|pending/i.test(cleanName)) {
      res.status(400).json({
        error: 'Assign an official batch name before marking a new intake batch as active.',
        code: 'PREMATURE_BATCH_ACTIVATION',
      });
      return;
    }

    try {
      const pool = getPool();
      const [dup] = await pool.query<any[]>(
        'SELECT id FROM academic_batches WHERE code = ?',
        [cleanCode]
      );
      if (dup && dup.length > 0) {
        res.status(409).json({
          error: `Batch code '${cleanCode}' already exists`,
          code: 'DUPLICATE_BATCH_CODE',
        });
        return;
      }

      const placementCheck = await validateBatchPlacementConfig(pool, {
        schemeId,
        rawCohortStage: cleanStr(b.currentCohortStage),
        rawProfYear: b.currentProfessionalYear,
        defaultStage: 'PROF_YEAR_1_TERM_1',
      });
      if (!placementCheck.ok) {
        res.status(400).json({ error: placementCheck.error, code: placementCheck.code });
        return;
      }

      const admStatus = VALID_BATCH_ADM_STATUSES.includes(b.admissionStatus)
        ? b.admissionStatus
        : 'IN_PROGRESS';

      const [result] = await pool.query<any>(
        `INSERT INTO academic_batches
          (code, name, admission_academic_year, admission_year_start, course_name, scheme_id, current_cohort_stage, current_professional_year, junior_batch_id, admission_status, is_active, display_order, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          cleanCode,
          cleanName,
          cleanAcadYear,
          b.admissionYearStart ? Number(b.admissionYearStart) : null,
          cleanStr(b.courseName) || 'BAMS',
          schemeId,
          placementCheck.normalizedStage,
          placementCheck.normalizedProfYear,
          b.juniorBatchId ? Number(b.juniorBatchId) : null,
          admStatus,
          isActivating,
          Number(b.displayOrder ?? 100),
          cleanStr(b.notes),
          req.user!.id,
        ]
      );

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'ACADEMIC_BATCH_CREATED',
        targetType: 'ACADEMIC_BATCH',
        targetId: String(result.insertId),
        ipAddress: req.ip || null,
        details: {
          code: cleanCode,
          name: cleanName,
          admissionAcademicYear: cleanAcadYear,
          schemeId,
          currentCohortStage: placementCheck.normalizedStage,
          currentProfessionalYear: placementCheck.normalizedProfYear,
          isActive: isActivating,
        },
      });

      res.status(201).json({
        success: true,
        message: `Academic batch '${cleanName}' created.`,
        batchId: result.insertId,
      });
    } catch (err) {
      console.error('[KAMCH Students] Error creating batch:', (err as Error).message);
      res.status(500).json({ error: 'Failed to create academic batch', code: 'DATABASE_ERROR' });
    }
  }
);

studentsRouter.put(
  '/batches/:batchId',
  requireRoles(...USER_MANAGEMENT_ROLES),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const batchId = parseInt(req.params.batchId, 10);
    if (!batchId || isNaN(batchId)) {
      res.status(400).json({ error: 'Invalid batch ID', code: 'INVALID_ID' });
      return;
    }

    try {
      const pool = getPool();
      const [rows] = await pool.query<any[]>(
        'SELECT * FROM academic_batches b WHERE b.id = ?',
        [batchId]
      );
      if (!rows || rows.length === 0) {
        res.status(404).json({ error: 'Academic batch not found', code: 'NOT_FOUND' });
        return;
      }
      const existing = rows[0];
      const b = req.body || {};

      const nextName = cleanStr(b.name) || existing.name;
      const nextAcadYear = cleanStr(b.admissionAcademicYear) || existing.admission_academic_year;
      const nextYearStart =
        b.admissionYearStart !== undefined
          ? b.admissionYearStart
            ? Number(b.admissionYearStart)
            : null
          : existing.admission_year_start;
      const nextSchemeId = b.schemeId ? Number(b.schemeId) : Number(existing.scheme_id);
      const rawStage = cleanStr(b.currentCohortStage) || existing.current_cohort_stage;
      const rawProfYear =
        b.currentProfessionalYear !== undefined
          ? b.currentProfessionalYear
          : existing.current_professional_year;

      const placementCheck = await validateBatchPlacementConfig(pool, {
        schemeId: nextSchemeId,
        rawCohortStage: rawStage,
        rawProfYear,
        defaultStage: existing.current_cohort_stage,
      });
      if (!placementCheck.ok) {
        res.status(400).json({ error: placementCheck.error, code: placementCheck.code });
        return;
      }
      const nextStage = placementCheck.normalizedStage;
      const nextProfYear = placementCheck.normalizedProfYear;

      const nextJuniorId =
        b.juniorBatchId !== undefined
          ? b.juniorBatchId
            ? Number(b.juniorBatchId)
            : null
          : existing.junior_batch_id;
      const nextAdmStatus = VALID_BATCH_ADM_STATUSES.includes(b.admissionStatus)
        ? b.admissionStatus
        : existing.admission_status;
      const nextActive =
        b.isActive !== undefined ? Boolean(b.isActive) : Boolean(existing.is_active);
      const nextOrder =
        b.displayOrder !== undefined ? Number(b.displayOrder) : Number(existing.display_order);
      const nextNotes = b.notes !== undefined ? cleanStr(b.notes) : existing.notes;

      if (nextJuniorId && Number(nextJuniorId) === batchId) {
        res.status(400).json({
          error: 'A batch cannot reference itself as its junior cohort',
          code: 'SELF_JUNIOR_BATCH_INVALID',
        });
        return;
      }

      if (nextActive && /not assigned|unnamed/i.test(nextName)) {
        res.status(400).json({
          error: 'Assign the official batch name before activating an intake batch.',
          code: 'PREMATURE_BATCH_ACTIVATION',
        });
        return;
      }

      await pool.query(
        `UPDATE academic_batches
         SET name = ?, admission_academic_year = ?, admission_year_start = ?, scheme_id = ?,
             current_cohort_stage = ?, current_professional_year = ?, junior_batch_id = ?,
             admission_status = ?, is_active = ?, display_order = ?, notes = ?
         WHERE id = ?`,
        [
          nextName,
          nextAcadYear,
          nextYearStart,
          nextSchemeId,
          nextStage,
          nextProfYear,
          nextJuniorId,
          nextAdmStatus,
          nextActive,
          nextOrder,
          nextNotes,
          batchId,
        ]
      );

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'ACADEMIC_BATCH_UPDATED',
        targetType: 'ACADEMIC_BATCH',
        targetId: String(batchId),
        ipAddress: req.ip || null,
        details: {
          before: {
            name: existing.name,
            stage: existing.current_cohort_stage,
            professionalYear: existing.current_professional_year,
            isActive: existing.is_active,
            juniorBatchId: existing.junior_batch_id,
          },
          after: {
            name: nextName,
            stage: nextStage,
            professionalYear: nextProfYear,
            isActive: nextActive,
            juniorBatchId: nextJuniorId,
          },
        },
      });

      res.json({ success: true, message: `Academic batch '${nextName}' updated.` });
    } catch (err) {
      console.error('[KAMCH Students] Error updating batch:', (err as Error).message);
      res.status(500).json({ error: 'Failed to update academic batch', code: 'DATABASE_ERROR' });
    }
  }
);

// ============================================================================
// 2. CONFIGURABLE MAXIMUM COURSE DURATION — PRINCIPAL ONLY (Section 13)
// ============================================================================

studentsRouter.get(
  '/settings/course-duration',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const pool = getPool();
      const viewerRole = req.user!.role;
      const [settingRows] = await pool.query<any[]>(
        `SELECT s.*, u.full_name AS updated_by_name, r.code AS updated_by_role
         FROM institutional_settings s
         LEFT JOIN users u ON u.id = s.updated_by
         LEFT JOIN roles r ON r.id = u.role_id
         WHERE s.setting_key = ?
         LIMIT 1`,
        ['MAX_COURSE_DURATION_YEARS']
      );

      const [historyRows] = await pool.query<any[]>(
        `SELECT h.*, u.full_name AS authorizer_name, u.username AS authorizer_username, r.code AS authorizer_role
         FROM institutional_setting_history h
         LEFT JOIN users u ON u.id = h.authorized_by
         LEFT JOIN roles r ON r.id = u.role_id
         WHERE h.setting_key = ?
         ORDER BY h.id DESC`,
        ['MAX_COURSE_DURATION_YEARS']
      );

      const current = settingRows && settingRows[0] ? settingRows[0] : null;
      const maxYears = current ? parseInt(String(current.setting_value), 10) || 9 : 9;

      res.json({
        settingKey: 'MAX_COURSE_DURATION_YEARS',
        maxCourseDurationYears: maxYears,
        effectiveDate: toIsoDateOnly(current?.effective_date) || '2021-09-01',
        updatedReason: current?.updated_reason || null,
        updatedBy: maskActorName(current?.updated_by_name, current?.updated_by_role, viewerRole),
        updatedAt: current?.updated_at || null,
        canModify: viewerRole === ROLES.PRINCIPAL,
        history: (historyRows || []).map((h) => ({
          id: h.id,
          previousValue: Number(h.previous_value),
          newValue: Number(h.new_value),
          effectiveDate: toIsoDateOnly(h.effective_date) || '',
          reason: h.reason,
          authorizedBy: maskActorName(h.authorizer_name, h.authorizer_role, viewerRole),
          createdAt: h.created_at,
        })),
      });
    } catch (err) {
      console.error('[KAMCH Students] Error reading course duration setting:', (err as Error).message);
      res.status(500).json({ error: 'Failed to retrieve course duration setting', code: 'DATABASE_ERROR' });
    }
  }
);

studentsRouter.put(
  '/settings/course-duration',
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const user = req.user!;
    // Section 13: Strictly Principal-only
    if (user.role !== ROLES.PRINCIPAL) {
      await recordAuditLog({
        actorId: user.id,
        action: 'UNAUTHORIZED_COURSE_DURATION_CHANGE_ATTEMPT',
        targetType: 'INSTITUTIONAL_SETTING',
        targetId: 'MAX_COURSE_DURATION_YEARS',
        ipAddress: req.ip || null,
        details: { attemptedByRole: user.role },
      });
      res.status(403).json({
        error: 'Only the Principal is authorized to change the maximum course duration setting.',
        code: 'PRINCIPAL_AUTHORIZATION_REQUIRED',
      });
      return;
    }

    const { maxCourseDurationYears, effectiveDate, reason } = req.body || {};
    const nextYears = parseInt(String(maxCourseDurationYears), 10);
    const cleanEffDate = normalizeDateStr(effectiveDate);
    const cleanReason = cleanStr(reason);

    if (isNaN(nextYears) || nextYears < 4 || nextYears > 20) {
      res.status(400).json({
        error: 'Maximum course duration must be a valid integer between 4 and 20 years',
        code: 'INVALID_DURATION_YEARS',
      });
      return;
    }
    if (!cleanEffDate || !cleanReason) {
      res.status(400).json({
        error: 'Effective date and official reason are mandatory to change maximum course duration',
        code: 'MISSING_FIELDS',
      });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const currentCfg = await getMaxCourseDurationYears(connection);
      const prevVal = String(currentCfg.maxYears);
      const newVal = String(nextYears);

      await connection.query(
        `UPDATE institutional_settings
         SET setting_value = ?, effective_date = ?, updated_by = ?, updated_reason = ?
         WHERE setting_key = ?`,
        [newVal, cleanEffDate, user.id, cleanReason, 'MAX_COURSE_DURATION_YEARS']
      );

      await connection.query(
        `INSERT INTO institutional_setting_history
          (setting_key, previous_value, new_value, effective_date, reason, authorized_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['MAX_COURSE_DURATION_YEARS', prevVal, newVal, cleanEffDate, cleanReason, user.id]
      );

      await connection.commit();

      await recordAuditLog({
        actorId: user.id,
        action: 'MAX_COURSE_DURATION_UPDATED',
        targetType: 'INSTITUTIONAL_SETTING',
        targetId: 'MAX_COURSE_DURATION_YEARS',
        ipAddress: req.ip || null,
        details: {
          previousValue: prevVal,
          newValue: newVal,
          effectiveDate: cleanEffDate,
          reason: cleanReason,
        },
      });

      res.json({
        success: true,
        message: `Maximum course duration updated from ${prevVal} years to ${newVal} years (effective ${cleanEffDate}).`,
        maxCourseDurationYears: nextYears,
      });
    } catch (err) {
      await connection.rollback();
      console.error('[KAMCH Students] Error updating course duration:', (err as Error).message);
      res.status(500).json({ error: 'Failed to update maximum course duration', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

// ============================================================================
// 3. CSV TEMPLATE, IMPORT PREVIEW, ATOMIC COMMIT & EXPORT (Section 10)
// ============================================================================

studentsRouter.get('/import/template', (_req: Request, res: Response): void => {
  const csv = serializeCsv([...STUDENT_CSV_HEADERS], []);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="kamch_student_import_template.csv"'
  );
  res.send(csv);
});

interface EvaluatedCsvRow {
  rowNumber: number;
  fullName: string;
  batchCode: string;
  batchName: string | null;
  admissionQuota: string;
  seatCategory: string | null;
  admissionYear: number;
  dateOfBirth: string | null;
  contactPhone: string | null;
  permanentUniversityNumber: string | null;
  temporaryRollAction: string;
  universityRegAction: string;
  errors: string[];
  warnings: string[];
  normalizedPayload: Record<string, any> | null;
}

async function validateCsvImportRows(
  connOrPool: any,
  csvContent: string,
  defaultBatchId?: number | null
): Promise<{
  headers: string[];
  headerErrors: string[];
  rows: EvaluatedCsvRow[];
  validCount: number;
  errorCount: number;
}> {
  const parsed = parseCsvContent(csvContent || '');
  const headerErrors: string[] = [];

  if (parsed.headers.length === 0) {
    return {
      headers: [],
      headerErrors: ['CSV file is empty or missing column headers.'],
      rows: [],
      validCount: 0,
      errorCount: 1,
    };
  }

  if (!parsed.headers.includes('full_name')) {
    headerErrors.push("Missing required column header 'full_name'.");
  }
  if (!parsed.headers.includes('admission_quota') && !parsed.headers.includes('admission_category')) {
    headerErrors.push("Missing required column header 'admission_quota'.");
  }

  const [batches] = await connOrPool.query(
    `SELECT b.*, cs.code AS scheme_code, cs.is_legacy_minimal
     FROM academic_batches b
     LEFT JOIN curriculum_schemes cs ON cs.id = b.scheme_id`
  );
  const [existingStudents] = await connOrPool.query(
    '/* SM:CHECK_DUPLICATE_CANDIDATE */ SELECT * FROM students'
  );

  const batchByCode = new Map<string, any>();
  const batchById = new Map<number, any>();
  for (const b of batches || []) {
    batchByCode.set(String(b.code).toUpperCase(), b);
    batchById.set(Number(b.id), b);
  }

  const seenPermUniv = new Set<string>();
  const seenNeet = new Set<string>();
  const seenKea = new Set<string>();
  const seenNameDob = new Set<string>();

  const evaluatedRows: EvaluatedCsvRow[] = [];

  for (let idx = 0; idx < parsed.rows.length; idx++) {
    const raw = parsed.rows[idx];
    const rowNumber = idx + 2; // 1-indexed including header row
    const errors: string[] = [];
    const warnings: string[] = [];

    const fullName = cleanStr(raw.full_name) || '';
    const batchCodeInput = cleanStr(raw.batch_code)?.toUpperCase() || '';
    const quotaInput = (
      cleanStr(raw.admission_quota) ||
      cleanStr(raw.admission_category) ||
      ''
    ).toUpperCase();
    const dobRaw = cleanStr(raw.date_of_birth);
    const dob = normalizeDateStr(dobRaw);
    const admDateRaw = cleanStr(raw.admission_date);
    const admDate = normalizeDateStr(admDateRaw);
    const genderRaw = cleanStr(raw.gender)?.toUpperCase() || null;
    const phone = cleanStr(raw.contact_phone);
    const email = cleanStr(raw.contact_email)?.toLowerCase() || null;
    const permUniv = cleanStr(raw.permanent_university_number)?.toUpperCase() || null;
    const neetRoll = cleanStr(raw.neet_roll_number)?.toUpperCase() || null;
    const keaAck = cleanStr(raw.kea_acknowledgement_no)?.toUpperCase() || null;
    const admStatusRaw = (cleanStr(raw.admission_status) || 'PROVISIONAL').toUpperCase();

    if (!fullName) {
      errors.push('Full name is required.');
    }

    let resolvedBatch: any = null;
    if (batchCodeInput) {
      resolvedBatch = batchByCode.get(batchCodeInput) || null;
      if (!resolvedBatch) {
        errors.push(`Unknown batch_code '${batchCodeInput}'.`);
      }
    } else if (defaultBatchId) {
      resolvedBatch = batchById.get(Number(defaultBatchId)) || null;
      if (!resolvedBatch) {
        errors.push('Selected default batch does not exist.');
      }
    } else {
      errors.push("Missing 'batch_code' (and no default batch selected).");
    }

    if (resolvedBatch && !resolvedBatch.is_active) {
      errors.push(
        `Batch '${resolvedBatch.name}' (${resolvedBatch.code}) is not active yet. Activate & name the batch before importing students.`
      );
    }

    if (!VALID_QUOTAS.includes(quotaInput as any)) {
      errors.push(
        `Invalid admission_quota '${quotaInput || '(empty)'}'. Must be GOVERNMENT, MANAGEMENT_PRIVATE, or NRI.`
      );
    }

    if (dobRaw && !dob) {
      errors.push(`Invalid date_of_birth '${dobRaw}'. Expected YYYY-MM-DD.`);
    }
    if (admDateRaw && !admDate) {
      errors.push(`Invalid admission_date '${admDateRaw}'. Expected YYYY-MM-DD.`);
    }
    if (genderRaw && !VALID_GENDERS.includes(genderRaw as any)) {
      errors.push(
        `Invalid gender '${genderRaw}'. Allowed: MALE, FEMALE, OTHER, NOT_SPECIFIED.`
      );
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push(`Invalid contact_email '${email}'.`);
    }
    if (!VALID_ADMISSION_STATUSES.includes(admStatusRaw as any)) {
      errors.push(
        `Invalid admission_status '${admStatusRaw}'. Allowed: APPLIED, PROVISIONAL, CONFIRMED, CANCELLED.`
      );
    }

    const admAcadYear =
      cleanStr(raw.admission_academic_year) ||
      resolvedBatch?.admission_academic_year ||
      `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`;
    const yearMatch = String(admAcadYear).match(/\b(19\d{2}|20\d{2})\b/);
    const admYear = resolvedBatch?.admission_year_start
      ? Number(resolvedBatch.admission_year_start)
      : yearMatch
      ? Number(yearMatch[1])
      : new Date().getFullYear();

    // Intra-file duplicate checks
    if (permUniv) {
      if (seenPermUniv.has(permUniv)) {
        errors.push(
          `Duplicate permanent_university_number '${permUniv}' appears multiple times in this CSV.`
        );
      }
      seenPermUniv.add(permUniv);
    }
    if (neetRoll) {
      if (seenNeet.has(neetRoll)) {
        errors.push(`Duplicate neet_roll_number '${neetRoll}' appears multiple times in this CSV.`);
      }
      seenNeet.add(neetRoll);
    }
    if (keaAck) {
      if (seenKea.has(keaAck)) {
        errors.push(
          `Duplicate kea_acknowledgement_no '${keaAck}' appears multiple times in this CSV.`
        );
      }
      seenKea.add(keaAck);
    }
    if (fullName && dob) {
      const key = `${fullName.toLowerCase()}|${dob}|${(cleanStr(raw.father_name) || '').toLowerCase()}`;
      if (seenNameDob.has(key)) {
        errors.push(
          `Duplicate student row in CSV matching name '${fullName}' and DOB '${dob}'.`
        );
      }
      seenNameDob.add(key);
    }

    // Database duplicate checks
    if (fullName) {
      const dbDups = findDuplicateCandidatesInList(existingStudents || [], {
        permanentUniversityNumber: permUniv,
        neetRollNumber: neetRoll,
        keaAcknowledgementNo: keaAck,
        fullName,
        dateOfBirth: dob,
        fatherName: cleanStr(raw.father_name),
        contactPhone: phone,
        admissionYear: admYear,
      });
      for (const dup of dbDups) {
        errors.push(dup.reason);
      }
    }

    if (permUniv) {
      const [idConflicts] = await connOrPool.query(
        `/* SM:CHECK_IDENTIFIER_CONFLICT */
         SELECT id FROM students
         WHERE (student_id_number = ? OR temporary_roll_number = ? OR permanent_university_number = ?)
           AND id != ?
         LIMIT 1`,
        [permUniv, permUniv, permUniv, -1]
      );
      if (idConflicts && idConflicts.length > 0 && !errors.some((e) => e.includes(permUniv))) {
        errors.push(`University registration number '${permUniv}' conflicts with an existing identifier.`);
      }
      warnings.push(
        `University number '${permUniv}' will be saved as PENDING_VERIFICATION until explicitly verified.`
      );
    }

    evaluatedRows.push({
      rowNumber,
      fullName: fullName || '(Missing Name)',
      batchCode: resolvedBatch?.code || batchCodeInput || '—',
      batchName: resolvedBatch?.name || null,
      admissionQuota: quotaInput || '—',
      seatCategory: cleanStr(raw.seat_category),
      admissionYear: admYear,
      dateOfBirth: dob,
      contactPhone: phone,
      permanentUniversityNumber: permUniv,
      temporaryRollAction: `Server will generate KAMCH-${admYear}-NNNN`,
      universityRegAction: permUniv
        ? 'Recorded as PENDING_VERIFICATION (never auto-verified)'
        : 'Left blank (NOT_ENTERED — never fabricated)',
      errors,
      warnings,
      normalizedPayload:
        errors.length === 0 && headerErrors.length === 0 && resolvedBatch
          ? {
              resolvedBatch,
              fullName,
              universityRecordedName: cleanStr(raw.university_recorded_name),
              dateOfBirth: dob,
              gender: genderRaw,
              nationality: cleanStr(raw.nationality) || 'Indian',
              contactPhone: phone,
              contactEmail: email,
              fatherName: cleanStr(raw.father_name),
              fatherPhone: cleanStr(raw.father_phone),
              motherName: cleanStr(raw.mother_name),
              motherPhone: cleanStr(raw.mother_phone),
              emergencyContactName: cleanStr(raw.emergency_contact_name),
              emergencyContactRelationship: cleanStr(raw.emergency_contact_relationship),
              emergencyContactPhone: cleanStr(raw.emergency_contact_phone),
              admissionAcademicYear: admAcadYear,
              admissionYear: admYear,
              admissionDate: admDate,
              admissionQuota: quotaInput as 'GOVERNMENT' | 'MANAGEMENT_PRIVATE' | 'NRI',
              seatCategory: cleanStr(raw.seat_category),
              reservationDetails: cleanStr(raw.reservation_details),
              neetRollNumber: neetRoll,
              neetScore: cleanStr(raw.neet_score),
              keaAcknowledgementNo: keaAck,
              admissionOrderRef: cleanStr(raw.admission_order_ref),
              admissionStatus: admStatusRaw,
              qualifyingExam: cleanStr(raw.qualifying_exam),
              qualifyingBoard: cleanStr(raw.qualifying_board),
              qualifyingYear: cleanStr(raw.qualifying_year)
                ? parseInt(String(raw.qualifying_year), 10) || null
                : null,
              qualifyingMarksPercentage: cleanStr(raw.qualifying_marks_percentage),
              state: cleanStr(raw.state),
              district: cleanStr(raw.district),
              cityTown: cleanStr(raw.city_town),
              pinCode: cleanStr(raw.pin_code),
              permanentAddress: cleanStr(raw.permanent_address),
              permanentUniversityNumber: permUniv,
            }
          : null,
    });
  }

  if (parsed.rows.length === 0 && headerErrors.length === 0) {
    headerErrors.push('CSV contains headers only and zero student data rows.');
  }

  const validCount = evaluatedRows.filter((r) => r.errors.length === 0).length;
  const errorCount = headerErrors.length + evaluatedRows.filter((r) => r.errors.length > 0).length;

  return {
    headers: parsed.headers,
    headerErrors,
    rows: evaluatedRows,
    validCount,
    errorCount,
  };
}

studentsRouter.post(
  '/import/preview',
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const { csvContent, defaultBatchId } = req.body || {};
    if (typeof csvContent !== 'string') {
      res.status(400).json({ error: 'csvContent string is required', code: 'MISSING_CSV' });
      return;
    }

    try {
      const pool = getPool();
      const preview = await validateCsvImportRows(
        pool,
        csvContent,
        defaultBatchId ? Number(defaultBatchId) : null
      );

      res.json({
        canCommit: preview.errorCount === 0 && preview.validCount > 0,
        totalRows: preview.rows.length,
        validCount: preview.validCount,
        errorCount: preview.errorCount,
        headerErrors: preview.headerErrors,
        rows: preview.rows.map(({ normalizedPayload: _np, ...rest }) => rest),
      });
    } catch (err) {
      console.error('[KAMCH Students] CSV preview error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to validate CSV import preview', code: 'PREVIEW_ERROR' });
    }
  }
);

studentsRouter.post(
  '/import/commit',
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const { csvContent, defaultBatchId } = req.body || {};
    if (typeof csvContent !== 'string') {
      res.status(400).json({ error: 'csvContent string is required', code: 'MISSING_CSV' });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();
    const user = req.user!;

    try {
      await connection.beginTransaction();

      const validation = await validateCsvImportRows(
        connection,
        csvContent,
        defaultBatchId ? Number(defaultBatchId) : null
      );

      if (validation.errorCount > 0 || validation.validCount === 0) {
        await connection.rollback();
        res.status(400).json({
          error:
            'CSV import aborted: one or more rows failed validation. Zero records were written to the database.',
          code: 'CSV_VALIDATION_FAILED',
          headerErrors: validation.headerErrors,
          rows: validation.rows.map(({ normalizedPayload: _np, ...rest }) => rest),
        });
        return;
      }

      const durationCfg = await getMaxCourseDurationYears(connection);
      const createdStudents: Array<{
        id: number;
        temporaryRollNumber: string;
        fullName: string;
        batchCode: string;
      }> = [];

      for (const row of validation.rows) {
        const p = row.normalizedPayload!;
        const batch = p.resolvedBatch;
        const isLegacy = Boolean(batch.is_legacy_minimal);
        const tempRoll = await allocateTemporaryRollNumber(connection, p.admissionYear);
        const univStatus = p.permanentUniversityNumber ? 'PENDING_VERIFICATION' : 'NOT_ENTERED';
        const yearOfStudy = batch.current_professional_year
          ? Number(batch.current_professional_year)
          : 1;
        const durationCheck = computeCourseDurationStatus(
          p.admissionYear,
          p.admissionDate,
          durationCfg.maxYears,
          null,
          {
            dateOfBirth: p.dateOfBirth,
            admissionStatus: p.admissionStatus,
          }
        );

        const defaultMapping = {
          mode: 'STANDARD_COHORT',
          term1: {
            batchId: batch.id,
            batchCode: batch.code,
            batchName: batch.name,
            relationship: 'ORIGINAL_COHORT',
          },
          term2: {
            batchId: batch.id,
            batchCode: batch.code,
            batchName: batch.name,
            relationship: 'ORIGINAL_COHORT',
          },
          term3: {
            batchId: batch.id,
            batchCode: batch.code,
            batchName: batch.name,
            relationship: 'ORIGINAL_COHORT',
          },
          summary: `All terms (1, 2, 3) with ${batch.name}`,
        };

        const adminStatus =
          p.admissionStatus === 'CANCELLED'
            ? 'CANCELLED'
            : p.admissionStatus === 'APPLIED'
            ? 'ADMISSION_PENDING'
            : 'ACTIVE';
        const legacyStatus = mapAdminToLegacyStatus(adminStatus);

        const [insRes] = await connection.query<any>(
          `/* SM:INSERT_STUDENT */
           INSERT INTO students (
             student_id_number, temporary_roll_number, permanent_university_number, university_reg_status,
             full_name, university_recorded_name, date_of_birth, gender, nationality,
             contact_phone, contact_email, current_address, permanent_address,
             state, district, city_town, pin_code, profile_remarks,
             father_name, father_phone, mother_name, mother_phone,
             guardian_name, guardian_relationship, guardian_phone,
             emergency_contact_name, emergency_contact_relationship, emergency_contact_phone, parent_guardian_address,
             scheme_id, original_batch_id, current_placement_batch_id,
             admission_academic_year, admission_year, admission_date,
             admission_category, seat_category, reservation_details,
             is_kea_eligible, kea_acknowledgement_no, neet_roll_number, neet_score, application_identifier,
             qualifying_exam, qualifying_board, qualifying_year, qualifying_marks_percentage,
             admission_order_ref, admission_status, confirmation_date, admission_remarks,
             current_year_of_study, detention_stage, progression_status, classroom_mapping,
             rs6_internship_completed, rs6_academic_summary,
             administrative_status, administrative_status_reason, status,
             course_duration_flag, mess_enrolled, hostel_enrolled
           ) VALUES (
             ?, ?, ?, ?,
             ?, ?, ?, ?, ?,
             ?, ?, ?, ?,
             ?, ?, ?, ?, ?,
             ?, ?, ?, ?,
             ?, ?, ?,
             ?, ?, ?, ?,
             ?, ?, ?,
             ?, ?, ?,
             ?, ?, ?,
             ?, ?, ?, ?, ?,
             ?, ?, ?, ?,
             ?, ?, ?, ?,
             ?, ?, ?, ?,
             ?, ?,
             ?, ?, ?,
             ?, ?, ?
           )`,
          [
            tempRoll,
            tempRoll,
            p.permanentUniversityNumber,
            univStatus,
            p.fullName,
            p.universityRecordedName,
            p.dateOfBirth,
            p.gender,
            p.nationality,
            p.contactPhone,
            p.contactEmail,
            p.permanentAddress,
            p.permanentAddress,
            p.state,
            p.district,
            p.cityTown,
            p.pinCode,
            null,
            p.fatherName,
            p.fatherPhone,
            p.motherName,
            p.motherPhone,
            null,
            null,
            null,
            p.emergencyContactName,
            p.emergencyContactRelationship,
            p.emergencyContactPhone,
            null,
            batch.scheme_id,
            batch.id,
            batch.id,
            p.admissionAcademicYear,
            p.admissionYear,
            p.admissionDate,
            p.admissionQuota,
            p.seatCategory,
            p.reservationDetails,
            Boolean(p.keaAcknowledgementNo),
            p.keaAcknowledgementNo,
            p.neetRollNumber,
            p.neetScore,
            null,
            p.qualifyingExam,
            p.qualifyingBoard,
            p.qualifyingYear,
            p.qualifyingMarksPercentage,
            p.admissionOrderRef,
            p.admissionStatus,
            p.admissionStatus === 'CONFIRMED' ? p.admissionDate : null,
            null,
            yearOfStudy,
            0,
            isLegacy ? 'LEGACY_RS6_SUMMARY' : 'REGULAR_ACTIVE',
            isLegacy ? null : JSON.stringify(defaultMapping),
            isLegacy ? false : null,
            null,
            adminStatus,
            null,
            legacyStatus,
            durationCheck.exceedsLimit,
            false,
            false,
          ]
        );

        const newStudentId = insRes.insertId;

        await connection.query(
          `INSERT INTO student_identifier_history
            (student_id, identifier_type, previous_identifier, new_identifier, verification_status, reason, actor_id, verified_by, verified_at)
           VALUES (?, 'TEMPORARY_ROLL_GENERATED', NULL, ?, 'VERIFIED', 'Generated automatically during CSV student import', ?, ?, NOW())`,
          [newStudentId, tempRoll, user.id, user.id]
        );

        if (p.permanentUniversityNumber) {
          await connection.query(
            `INSERT INTO student_identifier_history
              (student_id, identifier_type, previous_identifier, new_identifier, verification_status, reason, actor_id, verified_by, verified_at)
             VALUES (?, 'PERMANENT_UNIVERSITY_ENTERED', ?, ?, 'PENDING_VERIFICATION', 'Supplied in CSV import; awaiting verification', ?, NULL, NULL)`,
            [newStudentId, tempRoll, p.permanentUniversityNumber, user.id]
          );
        }

        await connection.query(
          `INSERT INTO student_progression_events (
             student_id, scheme_id, event_type, exam_session_ref, exam_attempt_type,
             evaluated_professional_year, previous_professional_year, proposed_professional_year,
             previous_placement_batch_id, proposed_placement_batch_id,
             previous_detention_stage, proposed_detention_stage,
             subjects_evaluated_count, subjects_passed, subjects_outstanding,
             placement_rule_applied, proposed_status, workflow_state,
             review_issue_explanation, classroom_mapping, supplementary_cycle_note,
             max_duration_years_snapshot, exceeds_max_duration_flag,
             entered_by, confirmed_by, confirmed_at, effective_date, reason_or_remarks
           ) VALUES (?, ?, ?, NULL, 'NOT_APPLICABLE', ?, NULL, ?, NULL, ?, 0, 0, 0, NULL, NULL, ?, ?, 'CONFIRMED', NULL, ?, NULL, ?, ?, ?, ?, NOW(), ?, ?)`,
          [
            newStudentId,
            batch.scheme_id,
            isLegacy ? 'LEGACY_RS6_RECORD' : 'INITIAL_ENROLLMENT',
            yearOfStudy,
            yearOfStudy,
            batch.id,
            isLegacy ? 'RS6_INITIAL_IMPORT' : 'INITIAL_BATCH_ADMISSION',
            isLegacy ? 'LEGACY_RS6_SUMMARY' : 'REGULAR_ACTIVE',
            isLegacy ? null : JSON.stringify(defaultMapping),
            durationCfg.maxYears,
            durationCheck.exceedsLimit,
            user.id,
            user.id,
            p.admissionDate || new Date().toISOString().slice(0, 10),
            'Imported via verified CSV batch upload',
          ]
        );

        if (!isLegacy && adminStatus !== 'CANCELLED') {
          await initializeStudentFeeAssessment(connection, {
            studentId: newStudentId,
            yearOfStudy,
            admissionQuota: p.admissionQuota,
            actorId: user.id,
          });
        }

        createdStudents.push({
          id: newStudentId,
          temporaryRollNumber: tempRoll,
          fullName: p.fullName,
          batchCode: batch.code,
        });
      }

      await connection.commit();

      await recordAuditLog({
        actorId: user.id,
        action: 'STUDENT_CSV_IMPORT_COMMITTED',
        targetType: 'STUDENT_BATCH_IMPORT',
        targetId: String(createdStudents.length),
        ipAddress: req.ip || null,
        details: {
          importedCount: createdStudents.length,
          sampleRollNumbers: createdStudents.slice(0, 10).map((s) => s.temporaryRollNumber),
        },
      });

      res.status(201).json({
        success: true,
        message: `Successfully imported ${createdStudents.length} student record(s) with server-generated temporary roll numbers.`,
        importedCount: createdStudents.length,
        students: createdStudents,
      });
    } catch (err) {
      await connection.rollback();
      console.error('[KAMCH Students] CSV commit error:', (err as Error).message);
      res.status(500).json({
        error: 'CSV import transaction rolled back due to an unexpected error.',
        code: 'IMPORT_TRANSACTION_FAILED',
      });
    } finally {
      connection.release();
    }
  }
);

// Helper to fetch and filter student rows identically for GET /api/students and GET /api/students/export/csv
async function queryFilteredStudentList(pool: any, query: Record<string, any>) {
  const durationCfg = await getMaxCourseDurationYears(pool);

  const [rows] = await pool.query(
    `/* SM:LIST_STUDENTS */
     SELECT
       s.*,
       cs.code AS scheme_code,
       cs.name AS scheme_name,
       cs.is_legacy_minimal,
       ob.code AS original_batch_code,
       ob.name AS original_batch_name,
       cb.code AS current_placement_batch_code,
       cb.name AS current_placement_batch_name,
       uv.full_name AS university_verifier_name,
       uvr.code AS university_verifier_role,
       (SELECT GROUP_CONCAT(CONCAT_WS('|', sih.previous_identifier, sih.new_identifier) SEPARATOR '|')
        FROM student_identifier_history sih
        WHERE sih.student_id = s.id) AS historical_identifiers_concat
     FROM students s
     LEFT JOIN curriculum_schemes cs ON cs.id = s.scheme_id
     LEFT JOIN academic_batches ob ON ob.id = s.original_batch_id
     LEFT JOIN academic_batches cb ON cb.id = s.current_placement_batch_id
     LEFT JOIN users uv ON uv.id = s.university_reg_verified_by
     LEFT JOIN roles uvr ON uvr.id = uv.role_id
     ORDER BY s.id DESC`
  );

  const batchId = query.batchId ? parseInt(String(query.batchId), 10) : null;
  const batchScope = String(query.batchScope || 'BOTH').toUpperCase();
  const schemeId = query.schemeId ? parseInt(String(query.schemeId), 10) : null;
  const quotaFilter = cleanStr(query.quota || query.category)?.toUpperCase() || null;
  const seatCatFilter = cleanStr(query.seatCategory)?.toLowerCase() || null;
  const admStatusFilter = cleanStr(query.admissionStatus)?.toUpperCase() || null;
  const adminStatusFilter = cleanStr(query.administrativeStatus)?.toUpperCase() || null;
  const progStatusFilter = cleanStr(query.progressionStatus)?.toUpperCase() || null;
  const univRegFilter = cleanStr(query.universityRegStatus)?.toUpperCase() || null;
  const yearFilter = query.yearOfStudy ? parseInt(String(query.yearOfStudy), 10) : null;
  const durationExceededOnly = String(query.courseDurationExceeded || '') === 'true';
  const search = cleanStr(query.search)?.toLowerCase() || '';

  const filtered = (rows || [])
    .map((r: any) => formatStudentSummaryRow(r, durationCfg.maxYears, batchId))
    .filter((st: any, idx: number) => {
      const rawRow = rows[idx];

      if (batchId && !isNaN(batchId)) {
        const isOrig = Number(st.originalBatchId) === batchId;
        const isCurr = Number(st.currentPlacementBatchId) === batchId;
        if (batchScope === 'ORIGINAL' && !isOrig) return false;
        if (batchScope === 'CURRENT' && !isCurr) return false;
        if (batchScope === 'DETAINED_IN' && !(isCurr && !isOrig)) return false;
        if (batchScope === 'DETAINED_OUT' && !(isOrig && !isCurr)) return false;
        if (batchScope === 'BOTH' && !(isOrig || isCurr)) return false;
      }

      if (schemeId && !isNaN(schemeId) && Number(st.schemeId) !== schemeId) {
        return false;
      }

      if (quotaFilter && st.admissionQuota !== quotaFilter) {
        return false;
      }

      if (
        seatCatFilter &&
        (!st.seatCategory || !String(st.seatCategory).toLowerCase().includes(seatCatFilter))
      ) {
        return false;
      }

      if (admStatusFilter && st.admissionStatus !== admStatusFilter) {
        return false;
      }

      if (adminStatusFilter && st.administrativeStatus !== adminStatusFilter) {
        return false;
      }

      if (progStatusFilter && st.progressionStatus !== progStatusFilter) {
        return false;
      }

      if (univRegFilter && st.universityRegStatus !== univRegFilter) {
        return false;
      }

      if (yearFilter && !isNaN(yearFilter) && Number(st.currentYearOfStudy) !== yearFilter) {
        return false;
      }

      if (durationExceededOnly && !st.courseDurationFlag) {
        return false;
      }

      if (search) {
        const haystack = [
          st.fullName,
          st.universityRecordedName,
          st.studentIdNumber,
          st.temporaryRollNumber,
          st.permanentUniversityNumber,
          rawRow.historical_identifiers_concat,
          st.contactPhone,
          st.contactEmail,
          st.neetRollNumber,
          st.keaAcknowledgementNo,
          st.originalBatchName,
          st.currentPlacementBatchName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        if (!haystack.includes(search)) {
          return false;
        }
      }

      return true;
    });

  return { students: filtered, maxCourseDurationYears: durationCfg.maxYears };
}

studentsRouter.get('/export/csv', async (req: Request, res: Response): Promise<void> => {
  try {
    const pool = getPool();
    const { students } = await queryFilteredStudentList(pool, req.query as Record<string, any>);

    const exportHeaders = [
      'active_student_id',
      'temporary_roll_number',
      'permanent_university_number',
      'university_reg_status',
      'full_name',
      'university_recorded_name',
      'scheme_code',
      'original_batch',
      'current_placement_batch',
      'batch_relationship',
      'professional_year',
      'detention_stage',
      'progression_status',
      'classroom_routing_summary',
      'admission_academic_year',
      'admission_date',
      'admission_quota',
      'seat_category',
      'admission_status',
      'administrative_status',
      'contact_phone',
      'contact_email',
      'father_name',
      'course_duration_elapsed_years',
      'course_duration_review_flag',
    ];

    const exportRows = students.map((s: any) => ({
      active_student_id: s.studentIdNumber,
      temporary_roll_number: s.temporaryRollNumber,
      permanent_university_number: s.permanentUniversityNumber || '',
      university_reg_status: s.universityRegStatus,
      full_name: s.fullName,
      university_recorded_name: s.universityRecordedName || '',
      scheme_code: s.schemeCode || '',
      original_batch: s.originalBatchName || '',
      current_placement_batch: s.currentPlacementBatchName || '',
      batch_relationship: s.batchRelationshipLabel || '',
      professional_year: s.isLegacyMinimal ? 'Legacy RS6' : s.currentYearOfStudy,
      detention_stage: s.detentionStage,
      progression_status: s.progressionStatus,
      classroom_routing_summary: s.classroomMapping?.summary || '',
      admission_academic_year: s.admissionAcademicYear || String(s.admissionYear),
      admission_date: s.admissionDate || '',
      admission_quota: s.admissionQuota,
      seat_category: s.seatCategory || '',
      admission_status: s.admissionStatus,
      administrative_status: s.administrativeStatus,
      contact_phone: s.contactPhone || '',
      contact_email: s.contactEmail || '',
      father_name: s.fatherName || '',
      course_duration_elapsed_years:
        s.admissionDateRequiresVerification || s.elapsedYearsFromAdmission === null
          ? 'Admission date requires verification'
          : s.elapsedYearsFromAdmission,
      course_duration_review_flag: s.admissionDateRequiresVerification
        ? 'ADMISSION_DATE_REQUIRES_VERIFICATION'
        : s.courseDurationFlag
        ? 'REVIEW_REQUIRED'
        : 'WITHIN_LIMIT',
    }));

    const csv = serializeCsv(exportHeaders, exportRows);

    await recordAuditLog({
      actorId: req.user!.id,
      action: 'STUDENT_CSV_EXPORTED',
      targetType: 'STUDENT_EXPORT',
      targetId: String(exportRows.length),
      ipAddress: req.ip || null,
      details: { exportedCount: exportRows.length, filters: req.query },
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="kamch_students_export_${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.send(csv);
  } catch (err) {
    console.error('[KAMCH Students] CSV export error:', (err as Error).message);
    res.status(500).json({ error: 'Failed to export student CSV', code: 'EXPORT_ERROR' });
  }
});

// ============================================================================
// 4. STUDENT LISTING, DUPLICATE CHECK & MANUAL REGISTRATION (Sections 4–9)
// ============================================================================

studentsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const pool = getPool();
    const { students, maxCourseDurationYears } = await queryFilteredStudentList(
      pool,
      req.query as Record<string, any>
    );

    res.json({
      students,
      totalCount: students.length,
      maxCourseDurationYears,
    });
  } catch (err) {
    console.error('[KAMCH Students] Error listing student records:', (err as Error).message);
    res.status(500).json({ error: 'Failed to retrieve student records', code: 'DATABASE_ERROR' });
  }
});

studentsRouter.post(
  '/',
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const b = req.body || {};
    const user = req.user!;

    const fullName = cleanStr(b.fullName);
    const rawQuota = cleanStr(b.admissionQuota || b.admissionCategory)?.toUpperCase();

    if (!fullName) {
      res.status(400).json({ error: 'Student Full Name is required', code: 'MISSING_FIELDS' });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Resolve batch & scheme
      let selectedBatch: any = null;
      let selectedScheme: any = null;

      if (b.originalBatchId) {
        const [batchRows] = await connection.query<any[]>(
          `SELECT b.*, cs.code AS scheme_code, cs.is_legacy_minimal
           FROM academic_batches b
           LEFT JOIN curriculum_schemes cs ON cs.id = b.scheme_id
           WHERE b.id = ?
           LIMIT 1`,
          [Number(b.originalBatchId)]
        );
        if (!batchRows || batchRows.length === 0) {
          await connection.rollback();
          res.status(400).json({
            error: 'Selected original admission batch does not exist',
            code: 'INVALID_BATCH',
          });
          return;
        }
        selectedBatch = batchRows[0];
        if (!selectedBatch.is_active) {
          await connection.rollback();
          res.status(400).json({
            error: `Batch '${selectedBatch.name}' is not active yet. Assign its official batch name and activate it before registering students into it.`,
            code: 'INACTIVE_BATCH_PLACEMENT',
          });
          return;
        }
      }

      if (selectedBatch) {
        const [sRows] = await connection.query<any[]>(
          'SELECT * FROM curriculum_schemes WHERE id = ?',
          [selectedBatch.scheme_id]
        );
        selectedScheme = sRows && sRows[0] ? sRows[0] : null;
      } else if (b.schemeId) {
        const [sRows] = await connection.query<any[]>(
          'SELECT * FROM curriculum_schemes WHERE id = ?',
          [Number(b.schemeId)]
        );
        selectedScheme = sRows && sRows[0] ? sRows[0] : null;
      } else {
        const [sRows] = await connection.query<any[]>(
          'SELECT * FROM curriculum_schemes WHERE code = ?',
          ['RS7']
        );
        selectedScheme = sRows && sRows[0] ? sRows[0] : null;
      }

      const isLegacyRs6 = Boolean(selectedScheme?.is_legacy_minimal);

      const admissionQuota = (
        rawQuota && VALID_QUOTAS.includes(rawQuota as any)
          ? rawQuota
          : isLegacyRs6
          ? 'GOVERNMENT'
          : null
      ) as 'GOVERNMENT' | 'MANAGEMENT_PRIVATE' | 'NRI' | null;

      if (!admissionQuota) {
        await connection.rollback();
        res.status(400).json({
          error: 'Valid Admission Quota (GOVERNMENT, MANAGEMENT_PRIVATE, or NRI) is required',
          code: 'INVALID_CATEGORY',
        });
        return;
      }

      const admYearInput = b.admissionYear ? parseInt(String(b.admissionYear), 10) : null;
      const admYear =
        admYearInput && !isNaN(admYearInput)
          ? admYearInput
          : selectedBatch?.admission_year_start
          ? Number(selectedBatch.admission_year_start)
          : new Date().getFullYear();

      const admAcadYear =
        cleanStr(b.admissionAcademicYear) ||
        selectedBatch?.admission_academic_year ||
        `${admYear}-${admYear + 1}`;

      const dob = normalizeDateStr(b.dateOfBirth);
      if (b.dateOfBirth && !dob) {
        await connection.rollback();
        res.status(400).json({
          error: 'Invalid Date of Birth format (expected YYYY-MM-DD)',
          code: 'INVALID_DOB',
        });
        return;
      }

      const admDate = normalizeDateStr(b.admissionDate);
      if (b.admissionDate && cleanStr(b.admissionDate) && !admDate) {
        await connection.rollback();
        res.status(400).json({
          error: 'Invalid Official Admission Date format (expected YYYY-MM-DD)',
          code: 'INVALID_ADMISSION_DATE',
        });
        return;
      }
      const confDate = normalizeDateStr(b.confirmationDate);
      const email = cleanStr(b.contactEmail)?.toLowerCase() || null;
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        await connection.rollback();
        res.status(400).json({
          error: 'Invalid contact email format',
          code: 'INVALID_EMAIL',
        });
        return;
      }

      const permUnivInput = cleanStr(b.permanentUniversityNumber)?.toUpperCase() || null;
      const verifyPermNow = Boolean(b.verifyUniversityNumberNow && permUnivInput);

      if (permUnivInput) {
        const [permConflicts] = await connection.query<any[]>(
          `/* SM:CHECK_IDENTIFIER_CONFLICT */
           SELECT id FROM students
           WHERE (student_id_number = ? OR temporary_roll_number = ? OR permanent_university_number = ?)
             AND id != ?
           LIMIT 1`,
          [permUnivInput, permUnivInput, permUnivInput, -1]
        );
        if (permConflicts && permConflicts.length > 0) {
          await connection.rollback();
          res.status(409).json({
            error: `Permanent university registration number '${permUnivInput}' is already assigned to another student.`,
            code: 'DUPLICATE_UNIVERSITY_NUMBER',
          });
          return;
        }
      }

      // Duplicate candidate detection
      const [allExisting] = await connection.query<any[]>(
        '/* SM:CHECK_DUPLICATE_CANDIDATE */ SELECT * FROM students'
      );
      const dupCandidates = findDuplicateCandidatesInList(allExisting || [], {
        permanentUniversityNumber: permUnivInput,
        neetRollNumber: cleanStr(b.neetRollNumber),
        keaAcknowledgementNo: cleanStr(b.keaAcknowledgementNo),
        fullName,
        dateOfBirth: dob,
        fatherName: cleanStr(b.fatherName),
        contactPhone: cleanStr(b.contactPhone),
        admissionYear: admYear,
      });

      const hardDup = dupCandidates.find((d) => d.matchType === 'HARD_IDENTIFIER');
      if (hardDup) {
        await connection.rollback();
        res.status(409).json({
          error: hardDup.reason,
          code: 'DUPLICATE_STUDENT_IDENTIFIER',
          duplicateCandidates: dupCandidates,
        });
        return;
      }

      if (
        dupCandidates.length > 0 &&
        !(Boolean(b.allowDuplicateOverride) && cleanStr(b.duplicateOverrideReason))
      ) {
        await connection.rollback();
        res.status(409).json({
          error: dupCandidates[0].reason,
          code: 'POTENTIAL_DUPLICATE_STUDENT',
          duplicateCandidates: dupCandidates,
        });
        return;
      }

      // Server-side temporary roll number generation (never relies on client input)
      const temporaryRollNumber = await allocateTemporaryRollNumber(connection, admYear);
      const activeStudentIdNumber = verifyPermNow && permUnivInput ? permUnivInput : temporaryRollNumber;
      const univRegStatus = !permUnivInput
        ? 'NOT_ENTERED'
        : verifyPermNow
        ? 'VERIFIED'
        : 'PENDING_VERIFICATION';

      const placementBatchId = b.currentPlacementBatchId
        ? Number(b.currentPlacementBatchId)
        : selectedBatch?.id || null;

      const yearOfStudy = b.currentYearOfStudy
        ? parseInt(String(b.currentYearOfStudy), 10) || 1
        : selectedBatch?.current_professional_year
        ? Number(selectedBatch.current_professional_year)
        : 1;

      const admStatus = VALID_ADMISSION_STATUSES.includes(b.admissionStatus)
        ? b.admissionStatus
        : 'PROVISIONAL';

      const adminStatus = VALID_ADMIN_STATUSES.includes(b.administrativeStatus)
        ? b.administrativeStatus
        : admStatus === 'CANCELLED'
        ? 'CANCELLED'
        : isLegacyRs6 && Boolean(b.rs6InternshipCompleted)
        ? 'COMPLETED'
        : 'ACTIVE';

      const legacyStatus = mapAdminToLegacyStatus(adminStatus);

      const durationCfg = await getMaxCourseDurationYears(connection);
      const durationCheck = computeCourseDurationStatus(
        admYear,
        admDate,
        durationCfg.maxYears,
        null,
        {
          dateOfBirth: dob,
          admissionStatus: admStatus,
        }
      );

      const defaultMapping =
        !isLegacyRs6 && selectedBatch
          ? {
              mode: 'STANDARD_COHORT',
              term1: {
                batchId: selectedBatch.id,
                batchCode: selectedBatch.code,
                batchName: selectedBatch.name,
                relationship: 'ORIGINAL_COHORT',
              },
              term2: {
                batchId: selectedBatch.id,
                batchCode: selectedBatch.code,
                batchName: selectedBatch.name,
                relationship: 'ORIGINAL_COHORT',
              },
              term3: {
                batchId: selectedBatch.id,
                batchCode: selectedBatch.code,
                batchName: selectedBatch.name,
                relationship: 'ORIGINAL_COHORT',
              },
              summary: `All terms (1, 2, 3) with ${selectedBatch.name}`,
            }
          : null;

      const genderVal =
        b.gender && VALID_GENDERS.includes(String(b.gender).toUpperCase() as any)
          ? String(b.gender).toUpperCase()
          : null;

      const [insRes] = await connection.query<any>(
        `/* SM:INSERT_STUDENT */
         INSERT INTO students (
           student_id_number, temporary_roll_number, permanent_university_number, university_reg_status,
           full_name, university_recorded_name, date_of_birth, gender, nationality,
           contact_phone, contact_email, current_address, permanent_address,
           state, district, city_town, pin_code, profile_remarks,
           father_name, father_phone, mother_name, mother_phone,
           guardian_name, guardian_relationship, guardian_phone,
           emergency_contact_name, emergency_contact_relationship, emergency_contact_phone, parent_guardian_address,
           scheme_id, original_batch_id, current_placement_batch_id,
           admission_academic_year, admission_year, admission_date,
           admission_category, seat_category, reservation_details,
           is_kea_eligible, kea_acknowledgement_no, neet_roll_number, neet_score, application_identifier,
           qualifying_exam, qualifying_board, qualifying_year, qualifying_marks_percentage,
           admission_order_ref, admission_status, confirmation_date, admission_remarks,
           current_year_of_study, detention_stage, progression_status, classroom_mapping,
           rs6_internship_completed, rs6_academic_summary,
           administrative_status, administrative_status_reason, status,
           course_duration_flag, mess_enrolled, hostel_enrolled
         ) VALUES (
           ?, ?, ?, ?,
           ?, ?, ?, ?, ?,
           ?, ?, ?, ?,
           ?, ?, ?, ?, ?,
           ?, ?, ?, ?,
           ?, ?, ?,
           ?, ?, ?, ?,
           ?, ?, ?,
           ?, ?, ?,
           ?, ?, ?,
           ?, ?, ?, ?, ?,
           ?, ?, ?, ?,
           ?, ?, ?, ?,
           ?, ?, ?, ?,
           ?, ?,
           ?, ?, ?,
           ?, ?, ?
         )`,
        [
          activeStudentIdNumber,
          temporaryRollNumber,
          permUnivInput,
          univRegStatus,
          fullName,
          cleanStr(b.universityRecordedName),
          dob,
          genderVal,
          cleanStr(b.nationality) || 'Indian',
          cleanStr(b.contactPhone),
          email,
          cleanStr(b.currentAddress),
          cleanStr(b.permanentAddress),
          cleanStr(b.state),
          cleanStr(b.district),
          cleanStr(b.cityTown),
          cleanStr(b.pinCode),
          cleanStr(b.profileRemarks),
          cleanStr(b.fatherName),
          cleanStr(b.fatherPhone),
          cleanStr(b.motherName),
          cleanStr(b.motherPhone),
          cleanStr(b.guardianName),
          cleanStr(b.guardianRelationship),
          cleanStr(b.guardianPhone),
          cleanStr(b.emergencyContactName),
          cleanStr(b.emergencyContactRelationship),
          cleanStr(b.emergencyContactPhone),
          cleanStr(b.parentGuardianAddress),
          selectedScheme?.id || null,
          selectedBatch?.id || null,
          placementBatchId,
          admAcadYear,
          admYear,
          admDate,
          admissionQuota,
          cleanStr(b.seatCategory),
          cleanStr(b.reservationDetails),
          Boolean(b.isKeaEligible || b.keaAcknowledgementNo),
          cleanStr(b.keaAcknowledgementNo)?.toUpperCase() || null,
          cleanStr(b.neetRollNumber)?.toUpperCase() || null,
          cleanStr(b.neetScore),
          cleanStr(b.applicationIdentifier),
          cleanStr(b.qualifyingExam),
          cleanStr(b.qualifyingBoard),
          b.qualifyingYear ? parseInt(String(b.qualifyingYear), 10) || null : null,
          cleanStr(b.qualifyingMarksPercentage),
          cleanStr(b.admissionOrderRef),
          admStatus,
          confDate,
          cleanStr(b.admissionRemarks),
          yearOfStudy,
          0,
          isLegacyRs6 ? 'LEGACY_RS6_SUMMARY' : 'REGULAR_ACTIVE',
          defaultMapping ? JSON.stringify(defaultMapping) : null,
          isLegacyRs6 ? Boolean(b.rs6InternshipCompleted) : null,
          isLegacyRs6 ? cleanStr(b.rs6AcademicSummary) : null,
          adminStatus,
          cleanStr(b.administrativeStatusReason),
          legacyStatus,
          durationCheck.exceedsLimit,
          false,
          false,
        ]
      );

      const studentId = insRes.insertId;

      if (verifyPermNow && permUnivInput) {
        await connection.query(
          `/* SM:UPDATE_UNIVERSITY_NUMBER */
           UPDATE students
           SET student_id_number = ?, permanent_university_number = ?, university_reg_status = ?,
               university_reg_verified_by = ?, university_reg_verified_at = ?
           WHERE id = ?`,
          [permUnivInput, permUnivInput, 'VERIFIED', user.id, new Date().toISOString(), studentId]
        );
      }

      // Record temporary roll number generation in identifier history
      await connection.query(
        `INSERT INTO student_identifier_history
          (student_id, identifier_type, previous_identifier, new_identifier, verification_status, reason, actor_id, verified_by, verified_at)
         VALUES (?, 'TEMPORARY_ROLL_GENERATED', NULL, ?, 'VERIFIED', 'Server-generated temporary roll number at registration', ?, ?, NOW())`,
        [studentId, temporaryRollNumber, user.id, user.id]
      );

      if (permUnivInput) {
        await connection.query(
          `INSERT INTO student_identifier_history
            (student_id, identifier_type, previous_identifier, new_identifier, verification_status, reason, actor_id, verified_by, verified_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            studentId,
            verifyPermNow ? 'PERMANENT_UNIVERSITY_VERIFIED' : 'PERMANENT_UNIVERSITY_ENTERED',
            temporaryRollNumber,
            permUnivInput,
            verifyPermNow ? 'VERIFIED' : 'PENDING_VERIFICATION',
            verifyPermNow
              ? 'Permanent university registration number entered and verified during registration'
              : 'Permanent university registration number recorded pending verification',
            user.id,
            verifyPermNow ? user.id : null,
            verifyPermNow ? new Date().toISOString() : null,
          ]
        );
      }

      // Append initial progression enrollment event
      await connection.query(
        `INSERT INTO student_progression_events (
           student_id, scheme_id, event_type, exam_session_ref, exam_attempt_type,
           evaluated_professional_year, previous_professional_year, proposed_professional_year,
           previous_placement_batch_id, proposed_placement_batch_id,
           previous_detention_stage, proposed_detention_stage,
           subjects_evaluated_count, subjects_passed, subjects_outstanding,
           placement_rule_applied, proposed_status, workflow_state,
           review_issue_explanation, classroom_mapping, supplementary_cycle_note,
           max_duration_years_snapshot, exceeds_max_duration_flag,
           entered_by, confirmed_by, confirmed_at, effective_date, reason_or_remarks
         ) VALUES (?, ?, ?, NULL, 'NOT_APPLICABLE', ?, NULL, ?, NULL, ?, 0, 0, 0, NULL, NULL, ?, ?, 'CONFIRMED', NULL, ?, NULL, ?, ?, ?, ?, NOW(), ?, ?)`,
        [
          studentId,
          selectedScheme?.id || null,
          isLegacyRs6 ? 'LEGACY_RS6_RECORD' : 'INITIAL_ENROLLMENT',
          yearOfStudy,
          yearOfStudy,
          placementBatchId,
          isLegacyRs6 ? 'RS6_LEGACY_ENTRY' : 'INITIAL_ADMISSION_ENROLLMENT',
          isLegacyRs6 ? 'LEGACY_RS6_SUMMARY' : 'REGULAR_ACTIVE',
          defaultMapping ? JSON.stringify(defaultMapping) : null,
          durationCfg.maxYears,
          durationCheck.exceedsLimit,
          user.id,
          user.id,
          admDate || new Date().toISOString().slice(0, 10),
          isLegacyRs6
            ? cleanStr(b.rs6AcademicSummary) || 'RS6 legacy minimal record registered'
            : 'Initial student registration',
        ]
      );

      // If placed into an internship cohort (e.g. Mrutyunjaya), initialize internship record automatically
      if (!isLegacyRs6 && selectedBatch?.current_cohort_stage === 'INTERNSHIP') {
        await connection.query(
          `INSERT INTO student_internships
            (student_id, start_date, base_required_days, approved_extension_days, adjusted_required_days, credited_days_completed, attendance_source, attendance_reconciliation_status, last_attendance_sync_ref, expected_completion_date, internship_status, completion_remarks, created_by)
           VALUES (?, NULL, 365, 0, 365, 0, 'PENDING_ATTENDANCE_MODULE', 'UNAVAILABLE_PENDING_INTEGRATION', NULL, NULL, 'ELIGIBLE', 'Initialized from Internship cohort enrollment', ?)`,
          [studentId, user.id]
        );
      }

      // Initialize linked fee assessment for active non-RS6 students (preserving seamless Fees Management integration)
      const shouldInitFees =
        (!isLegacyRs6 || Boolean(b.initializeFeeAssessment)) && adminStatus !== 'CANCELLED';
      if (shouldInitFees) {
        await initializeStudentFeeAssessment(connection, {
          studentId,
          yearOfStudy,
          admissionQuota,
          actorId: user.id,
        });
      }

      await connection.commit();

      await recordAuditLog({
        actorId: user.id,
        action: 'STUDENT_RECORD_CREATED',
        targetType: 'STUDENT',
        targetId: String(studentId),
        ipAddress: req.ip || null,
        details: {
          studentIdNumber: activeStudentIdNumber,
          temporaryRollNumber,
          permanentUniversityNumber: permUnivInput,
          fullName,
          admissionQuota,
          seatCategory: cleanStr(b.seatCategory),
          originalBatchId: selectedBatch?.id || null,
          originalBatchName: selectedBatch?.name || null,
          schemeCode: selectedScheme?.code || null,
          duplicateOverrideReason: cleanStr(b.duplicateOverrideReason),
        },
      });

      res.status(201).json({
        success: true,
        message: `Student '${fullName}' registered with roll number ${activeStudentIdNumber}.`,
        student: {
          id: studentId,
          studentIdNumber: activeStudentIdNumber,
          temporaryRollNumber,
          permanentUniversityNumber: permUnivInput,
          universityRegStatus: univRegStatus,
          fullName,
          schemeId: selectedScheme?.id || null,
          schemeCode: selectedScheme?.code || null,
          isLegacyMinimal: isLegacyRs6,
          rs6InternshipCompleted: isLegacyRs6 ? Boolean(b.rs6InternshipCompleted) : null,
          admissionQuota,
          admissionCategory: admissionQuota,
          seatCategory: cleanStr(b.seatCategory),
          admissionYear: admYear,
          currentYearOfStudy: yearOfStudy,
          originalBatchId: selectedBatch?.id || null,
          currentPlacementBatchId: placementBatchId,
          administrativeStatus: adminStatus,
          status: legacyStatus,
          courseDurationFlag: durationCheck.exceedsLimit,
          elapsedYearsFromAdmission: durationCheck.elapsedYears,
          admissionDateRequiresVerification: durationCheck.requiresVerification,
          admissionDateVerificationNote: durationCheck.verificationReason,
        },
      });
    } catch (err) {
      await connection.rollback();
      console.error('[KAMCH Students] Error creating student record:', (err as Error).message);
      res.status(500).json({ error: 'Failed to create student record', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

// ============================================================================
// 4B. READ-ONLY REGISTRY DIAGNOSTICS (DUPLICATE & ADMISSION DATE AUDIT)
// ============================================================================

studentsRouter.get('/registry-diagnostics', async (_req: Request, res: Response): Promise<void> => {
  try {
    const pool = getPool();
    const durationCfg = await getMaxCourseDurationYears(pool);

    const [studentRows] = await pool.query<any[]>(
      '/* SM:CHECK_DUPLICATE_CANDIDATE */ SELECT * FROM students'
    );

    const rows = [...(studentRows || [])].sort((a, b) => Number(a.id) - Number(b.id));

    // Read-only pairwise check for potential duplicate student rows (NEVER modifies or merges rows)
    const potentialDuplicates: Array<{
      studentAId: number;
      studentAIdNumber: string;
      studentAName: string;
      studentBId: number;
      studentBIdNumber: string;
      studentBName: string;
      matchType: 'EXACT_IDENTIFIER_MATCH' | 'NAME_DOB_MATCH' | 'NAME_PHONE_MATCH' | 'NAME_ADMISSION_YEAR_MATCH';
      reasons: string[];
    }> = [];

    for (let i = 0; i < rows.length; i++) {
      const a = rows[i];
      const nameA = String(a.full_name || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const dobA = toIsoDateOnly(a.date_of_birth);
      const phoneA = a.contact_phone ? String(a.contact_phone).replace(/\D/g, '') : '';
      const permA = a.permanent_university_number
        ? String(a.permanent_university_number).trim().toUpperCase()
        : '';
      const neetA = a.neet_roll_number ? String(a.neet_roll_number).trim().toUpperCase() : '';
      const keaA = a.kea_acknowledgement_no
        ? String(a.kea_acknowledgement_no).trim().toUpperCase()
        : '';

      for (let j = i + 1; j < rows.length; j++) {
        const b = rows[j];
        const nameB = String(b.full_name || '').trim().toLowerCase().replace(/\s+/g, ' ');
        const dobB = toIsoDateOnly(b.date_of_birth);
        const phoneB = b.contact_phone ? String(b.contact_phone).replace(/\D/g, '') : '';
        const permB = b.permanent_university_number
          ? String(b.permanent_university_number).trim().toUpperCase()
          : '';
        const neetB = b.neet_roll_number ? String(b.neet_roll_number).trim().toUpperCase() : '';
        const keaB = b.kea_acknowledgement_no
          ? String(b.kea_acknowledgement_no).trim().toUpperCase()
          : '';

        const reasons: string[] = [];
        let matchType:
          | 'EXACT_IDENTIFIER_MATCH'
          | 'NAME_DOB_MATCH'
          | 'NAME_PHONE_MATCH'
          | 'NAME_ADMISSION_YEAR_MATCH'
          | null = null;

        if (
          (permA && permA === permB) ||
          (neetA && neetA === neetB) ||
          (keaA && keaA === keaB)
        ) {
          matchType = 'EXACT_IDENTIFIER_MATCH';
          reasons.push(
            `Shared official registration/NEET/KEA identifier between ${a.student_id_number} and ${b.student_id_number}`
          );
        }

        if (nameA && nameA === nameB && dobA && dobA === dobB) {
          matchType = matchType || 'NAME_DOB_MATCH';
          reasons.push(`Matching full name ('${a.full_name}') and date of birth (${dobA})`);
        } else if (nameA && nameA === nameB && phoneA.length >= 10 && phoneA === phoneB) {
          matchType = matchType || 'NAME_PHONE_MATCH';
          reasons.push(`Matching full name ('${a.full_name}') and contact phone`);
        } else if (
          nameA &&
          nameA === nameB &&
          Number(a.admission_year) === Number(b.admission_year)
        ) {
          matchType = matchType || 'NAME_ADMISSION_YEAR_MATCH';
          reasons.push(
            `Matching full name ('${a.full_name}') and admission year (${a.admission_year})`
          );
        }

        if (matchType && reasons.length > 0) {
          potentialDuplicates.push({
            studentAId: Number(a.id),
            studentAIdNumber: a.student_id_number,
            studentAName: a.full_name,
            studentBId: Number(b.id),
            studentBIdNumber: b.student_id_number,
            studentBName: b.full_name,
            matchType,
            reasons,
          });
        }
      }
    }

    // Read-only audit of null, malformed, or unverified admission_date values & stale course_duration_flag columns
    const admissionDateIssues: Array<{
      studentId: number;
      studentIdNumber: string;
      fullName: string;
      admissionYear: number;
      admissionStatus: string;
      rawAdmissionDate: string | null;
      normalizedAdmissionDate: string | null;
      dateOfBirth: string | null;
      storedCourseDurationFlag: boolean;
      requiresVerification: boolean;
      verificationNote: string;
    }> = [];

    for (const r of rows) {
      const check = computeCourseDurationStatus(
        Number(r.admission_year),
        r.admission_date,
        durationCfg.maxYears,
        null,
        {
          dateOfBirth: r.date_of_birth,
          admissionStatus: r.admission_status,
        }
      );
      const staleDbFlag = Boolean(r.course_duration_flag) !== check.exceedsLimit;
      if (check.requiresVerification || staleDbFlag) {
        admissionDateIssues.push({
          studentId: Number(r.id),
          studentIdNumber: r.student_id_number,
          fullName: r.full_name,
          admissionYear: Number(r.admission_year),
          admissionStatus: r.admission_status || 'ADMITTED_CONFIRMED',
          rawAdmissionDate:
            r.admission_date === null || r.admission_date === undefined
              ? null
              : r.admission_date instanceof Date
              ? r.admission_date.toISOString()
              : String(r.admission_date),
          normalizedAdmissionDate: check.normalizedAdmissionDate,
          dateOfBirth: toIsoDateOnly(r.date_of_birth),
          storedCourseDurationFlag: Boolean(r.course_duration_flag),
          requiresVerification: check.requiresVerification,
          verificationNote:
            check.verificationReason ||
            'Stored course_duration_flag column differed from live verified admission-date calculation.',
        });
      }
    }

    res.json({
      totalStudents: rows.length,
      totalStudentsInspected: rows.length,
      maxCourseDurationYears: durationCfg.maxYears,
      potentialDuplicatesCount: potentialDuplicates.length,
      potentialDuplicates,
      admissionDateIssuesCount: admissionDateIssues.length,
      admissionDateIssues,
      note: 'Read-only diagnostic report. No student, fee assessment, payment, or receipt records were modified or merged automatically.',
    });
  } catch (err) {
    console.error('[KAMCH Students] Error running registry diagnostics:', (err as Error).message);
    res.status(500).json({ error: 'Failed to inspect student registry diagnostics', code: 'DATABASE_ERROR' });
  }
});

// ============================================================================
// 5. FULL STUDENT PROFILE, EDITING & HARD-DELETE PROTECTION (Sections 8 & 9)
// ============================================================================

studentsRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const studentId = parseInt(req.params.id, 10);
  if (!studentId || isNaN(studentId)) {
    res.status(400).json({ error: 'Invalid student ID', code: 'INVALID_ID' });
    return;
  }

  try {
    const pool = getPool();
    const viewerRole = req.user!.role;
    const durationCfg = await getMaxCourseDurationYears(pool);

    const [studentRows] = await pool.query<any[]>(
      `/* SM:GET_STUDENT_DETAIL */
       SELECT
         s.*,
         cs.code AS scheme_code,
         cs.name AS scheme_name,
         cs.is_legacy_minimal,
         ob.code AS original_batch_code,
         ob.name AS original_batch_name,
         cb.code AS current_placement_batch_code,
         cb.name AS current_placement_batch_name,
         uv.full_name AS university_verifier_name,
         uvr.code AS university_verifier_role
       FROM students s
       LEFT JOIN curriculum_schemes cs ON cs.id = s.scheme_id
       LEFT JOIN academic_batches ob ON ob.id = s.original_batch_id
       LEFT JOIN academic_batches cb ON cb.id = s.current_placement_batch_id
       LEFT JOIN users uv ON uv.id = s.university_reg_verified_by
       LEFT JOIN roles uvr ON uvr.id = uv.role_id
       WHERE s.id = ?
       LIMIT 1`,
      [studentId]
    );

    if (!studentRows || studentRows.length === 0) {
      res.status(404).json({ error: 'Student record not found', code: 'STUDENT_NOT_FOUND' });
      return;
    }

    const row = studentRows[0];
    const summary = formatStudentSummaryRow(row, durationCfg.maxYears);

    // Identifier history
    const [idHistRows] = await pool.query<any[]>(
      `SELECT sih.*,
              ua.full_name AS actor_name, ra.code AS actor_role,
              uv.full_name AS verifier_name, rv.code AS verifier_role
       FROM student_identifier_history sih
       LEFT JOIN users ua ON ua.id = sih.actor_id
       LEFT JOIN roles ra ON ra.id = ua.role_id
       LEFT JOIN users uv ON uv.id = sih.verified_by
       LEFT JOIN roles rv ON rv.id = uv.role_id
       WHERE sih.student_id = ?
       ORDER BY sih.id DESC`,
      [studentId]
    );

    // Documents metadata
    const [docRows] = await pool.query<any[]>(
      `SELECT sd.*, uv.full_name AS verifier_name, rv.code AS verifier_role
       FROM student_documents sd
       LEFT JOIN users uv ON uv.id = sd.verified_by
       LEFT JOIN roles rv ON rv.id = uv.role_id
       WHERE sd.student_id = ?
       ORDER BY sd.id ASC`,
      [studentId]
    );

    // Progression events (append-only history)
    const [progRows] = await pool.query<any[]>(
      `SELECT spe.*,
              ue.full_name AS entered_by_name, re.code AS entered_by_role,
              uc.full_name AS confirmed_by_name, rc.code AS confirmed_by_role,
              pb.name AS previous_batch_name,
              nb.name AS proposed_batch_name
       FROM student_progression_events spe
       LEFT JOIN users ue ON ue.id = spe.entered_by
       LEFT JOIN roles re ON re.id = ue.role_id
       LEFT JOIN users uc ON uc.id = spe.confirmed_by
       LEFT JOIN roles rc ON rc.id = uc.role_id
       LEFT JOIN academic_batches pb ON pb.id = spe.previous_placement_batch_id
       LEFT JOIN academic_batches nb ON nb.id = spe.proposed_placement_batch_id
       WHERE spe.student_id = ?
       ORDER BY spe.id DESC`,
      [studentId]
    );

    // Internship & extensions
    const [internRows] = await pool.query<any[]>(
      `SELECT si.*, uv.full_name AS verifier_name, rv.code AS verifier_role
       FROM student_internships si
       LEFT JOIN users uv ON uv.id = si.completion_verified_by
       LEFT JOIN roles rv ON rv.id = uv.role_id
       WHERE si.student_id = ?
       LIMIT 1`,
      [studentId]
    );

    const [internExtRows] = await pool.query<any[]>(
      `SELECT sie.*, ua.full_name AS authorizer_name, ra.code AS authorizer_role
       FROM student_internship_extensions sie
       LEFT JOIN users ua ON ua.id = sie.authorized_by
       LEFT JOIN roles ra ON ra.id = ua.role_id
       WHERE sie.student_id = ?
       ORDER BY sie.id DESC`,
      [studentId]
    );

    // Live read-only Fees Management summary (reusing exact Fees tables without duplicating logic)
    const [assessments] = await pool.query<any[]>(
      `SELECT sfa.*, u.full_name AS assessor_name
       FROM student_fee_assessments sfa
       LEFT JOIN users u ON u.id = sfa.assessed_by
       WHERE sfa.student_id = ?
       ORDER BY sfa.id DESC`,
      [studentId]
    );

    const [concessions] = await pool.query<any[]>(
      `SELECT fc.*, u.full_name AS authorizer_name
       FROM fee_concessions fc
       LEFT JOIN users u ON u.id = fc.authorized_by
       WHERE fc.student_id = ?
       ORDER BY fc.id DESC`,
      [studentId]
    );

    const [payments] = await pool.query<any[]>(
      `SELECT fp.*,
              fr.id AS receipt_id,
              fr.receipt_number,
              fr.receipt_type,
              fr.status AS receipt_status
       FROM fee_payments fp
       LEFT JOIN fee_receipts fr ON fr.payment_id = fp.id
       WHERE fp.student_id = ?
       ORDER BY fp.id DESC`,
      [studentId]
    );

    const [serviceEnrollments] = await pool.query<any[]>(
      `SELECT se.*
       FROM service_enrollments se
       WHERE se.student_id = ?
       ORDER BY se.id DESC`,
      [studentId]
    );

    // Student Audit History (with Super Admin masking)
    const [auditRows] = await pool.query<any[]>(
      `/* SM:STUDENT_AUDIT_LOGS */
       SELECT al.*, u.username AS actor_username, u.full_name AS actor_full_name, r.code AS actor_role_code
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_id
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE al.target_type = 'STUDENT' AND al.target_id = ?
       ORDER BY al.id DESC
       LIMIT 100`,
      [String(studentId)]
    );

    const latestAssessment = assessments && assessments[0] ? assessments[0] : null;
    const totalAssessed = latestAssessment ? Number(latestAssessment.total_assessed_fee || 0) : 0;
    const totalConcession = latestAssessment ? Number(latestAssessment.concession_total || 0) : 0;
    const revisedPayable = latestAssessment ? Number(latestAssessment.revised_payable || 0) : 0;

    const verifiedPaid = (payments || [])
      .filter((p: any) => p.status === 'VERIFIED')
      .reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
    const pendingBankAmount = (payments || [])
      .filter((p: any) => p.status === 'PENDING_VERIFICATION')
      .reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
    const pendingTransfersCount = (payments || []).filter(
      (p: any) => p.status === 'PENDING_VERIFICATION'
    ).length;
    const outstandingBalance = Math.max(0, revisedPayable - verifiedPaid);

    const parseJsonCol = (v: any) => {
      if (!v) return null;
      if (typeof v === 'string') {
        try {
          return JSON.parse(v);
        } catch {
          return v;
        }
      }
      return v;
    };

    const internRec = internRows && internRows[0] ? internRows[0] : null;

    res.json({
      student: {
        ...summary,
        nationality: row.nationality || 'Indian',
        currentAddress: row.current_address || '',
        permanentAddress: row.permanent_address || '',
        state: row.state || '',
        district: row.district || '',
        cityTown: row.city_town || '',
        pinCode: row.pin_code || '',
        profileRemarks: row.profile_remarks || '',
        fatherPhone: row.father_phone || '',
        motherName: row.mother_name || '',
        motherPhone: row.mother_phone || '',
        guardianName: row.guardian_name || '',
        guardianRelationship: row.guardian_relationship || '',
        guardianPhone: row.guardian_phone || '',
        emergencyContactName: row.emergency_contact_name || '',
        emergencyContactRelationship: row.emergency_contact_relationship || '',
        emergencyContactPhone: row.emergency_contact_phone || '',
        parentGuardianAddress: row.parent_guardian_address || '',
        isKeaEligible: Boolean(row.is_kea_eligible),
        neetScore: row.neet_score || '',
        applicationIdentifier: row.application_identifier || '',
        qualifyingExam: row.qualifying_exam || '',
        qualifyingBoard: row.qualifying_board || '',
        qualifyingYear: row.qualifying_year ? Number(row.qualifying_year) : null,
        qualifyingMarksPercentage: row.qualifying_marks_percentage || '',
        admissionOrderRef: row.admission_order_ref || '',
        confirmationDate: toIsoDateOnly(row.confirmation_date),
        admissionRemarks: row.admission_remarks || '',
        administrativeStatusReason: row.administrative_status_reason || '',
        universityRegVerifiedBy: maskActorName(
          row.university_verifier_name,
          row.university_verifier_role,
          viewerRole
        ),
        universityRegVerifiedAt: row.university_reg_verified_at || null,
        maxCourseDurationYears: durationCfg.maxYears,
      },
      identifierHistory: (idHistRows || []).map((h: any) => ({
        id: h.id,
        identifierType: h.identifier_type,
        previousIdentifier: h.previous_identifier || null,
        newIdentifier: h.new_identifier,
        verificationStatus: h.verification_status,
        reason: h.reason,
        actorName: maskActorName(h.actor_name, h.actor_role, viewerRole),
        verifierName: maskActorName(h.verifier_name, h.verifier_role, viewerRole),
        verifiedAt: h.verified_at || null,
        createdAt: h.created_at,
      })),
      documents: (docRows || []).map((d: any) => ({
        id: d.id,
        documentType: d.document_type,
        documentLabel: d.document_label || '',
        referenceNumber: d.reference_number || '',
        issueDate: toIsoDateOnly(d.issue_date),
        receivedStatus: d.received_status,
        verificationStatus: d.verification_status,
        verifierName: maskActorName(d.verifier_name, d.verifier_role, viewerRole),
        verifiedAt: d.verified_at || null,
        remarks: d.remarks || '',
        updatedAt: d.updated_at,
      })),
      progressionHistory: (progRows || []).map((e: any) => ({
        id: e.id,
        eventType: e.event_type,
        examSessionRef: e.exam_session_ref || null,
        examAttemptType: e.exam_attempt_type,
        evaluatedProfessionalYear: e.evaluated_professional_year,
        previousProfessionalYear: e.previous_professional_year,
        proposedProfessionalYear: e.proposed_professional_year,
        previousPlacementBatchId: e.previous_placement_batch_id,
        previousBatchName: e.previous_batch_name || null,
        proposedPlacementBatchId: e.proposed_placement_batch_id,
        proposedBatchName: e.proposed_batch_name || null,
        previousDetentionStage: Number(e.previous_detention_stage || 0),
        proposedDetentionStage: Number(e.proposed_detention_stage || 0),
        subjectsEvaluatedCount: Number(e.subjects_evaluated_count || 0),
        subjectsPassed: parseJsonCol(e.subjects_passed) || [],
        subjectsOutstanding: parseJsonCol(e.subjects_outstanding) || [],
        placementRuleApplied: e.placement_rule_applied,
        proposedStatus: e.proposed_status,
        workflowState: e.workflow_state,
        reviewIssueExplanation: e.review_issue_explanation || null,
        classroomMapping: parseJsonCol(e.classroom_mapping),
        supplementaryCycleNote: e.supplementary_cycle_note || null,
        maxDurationYearsSnapshot: Number(e.max_duration_years_snapshot || 9),
        exceedsMaxDurationFlag: Boolean(e.exceeds_max_duration_flag),
        enteredByName: maskActorName(e.entered_by_name, e.entered_by_role, viewerRole),
        confirmedByName: maskActorName(e.confirmed_by_name, e.confirmed_by_role, viewerRole),
        confirmedAt: e.confirmed_at || null,
        effectiveDate: toIsoDateOnly(e.effective_date),
        reasonOrRemarks: e.reason_or_remarks || null,
        createdAt: e.created_at,
      })),
      internship: internRec
        ? {
            id: internRec.id,
            startDate: toIsoDateOnly(internRec.start_date),
            baseRequiredDays: Number(internRec.base_required_days || 365),
            approvedExtensionDays: Number(internRec.approved_extension_days || 0),
            adjustedRequiredDays: Number(internRec.adjusted_required_days || 365),
            creditedDaysCompleted: Number(internRec.credited_days_completed || 0),
            remainingCreditedDays: Math.max(
              0,
              Number(internRec.adjusted_required_days || 365) -
                Number(internRec.credited_days_completed || 0)
            ),
            attendanceSource: internRec.attendance_source,
            attendanceReconciliationStatus: internRec.attendance_reconciliation_status,
            lastAttendanceSyncRef: internRec.last_attendance_sync_ref || null,
            expectedCompletionDate: toIsoDateOnly(internRec.expected_completion_date),
            internshipStatus: internRec.internship_status,
            completionVerifiedBy: maskActorName(
              internRec.verifier_name,
              internRec.verifier_role,
              viewerRole
            ),
            completionVerifiedAt: internRec.completion_verified_at || null,
            actualCompletionDate: toIsoDateOnly(internRec.actual_completion_date),
            completionRemarks: internRec.completion_remarks || null,
            extensions: (internExtRows || []).map((ext: any) => ({
              id: ext.id,
              additionalDays: Number(ext.additional_days),
              previousRequiredTotal: Number(ext.previous_required_total),
              newRequiredTotal: Number(ext.new_required_total),
              reason: ext.reason,
              authorizedBy: maskActorName(ext.authorizer_name, ext.authorizer_role, viewerRole),
              authorizedAt: ext.authorized_at,
            })),
          }
        : null,
      feesSummary: {
        hasAssessment: Boolean(latestAssessment),
        academicYear: latestAssessment?.academic_year || null,
        yearOfStudy: latestAssessment?.year_of_study || null,
        assessedCollegeFee: latestAssessment ? Number(latestAssessment.assessed_college_fee || 0) : 0,
        assessedDevelopmentFee: latestAssessment
          ? Number(latestAssessment.assessed_development_fee || 0)
          : 0,
        assessedMessFee: latestAssessment ? Number(latestAssessment.assessed_mess_fee || 0) : 0,
        assessedHostelFee: latestAssessment ? Number(latestAssessment.assessed_hostel_fee || 0) : 0,
        totalAssessedFee: totalAssessed,
        concessionTotal: totalConcession,
        revisedPayable,
        totalVerifiedPaid: verifiedPaid,
        pendingBankVerificationAmount: pendingBankAmount,
        pendingBankTransfersCount: pendingTransfersCount,
        outstandingBalance,
        isKeaExceptionApplied: Boolean(latestAssessment?.is_kea_exception_applied),
        concessionsCount: (concessions || []).length,
        serviceEnrollments: (serviceEnrollments || []).map((se: any) => ({
          id: se.id,
          serviceType: se.service_type,
          startDate: toIsoDateOnly(se.start_date),
          endDate: toIsoDateOnly(se.end_date),
          annualFee: Number(se.annual_fee || 0),
          status: se.status,
        })),
        recentPayments: (payments || []).slice(0, 15).map((p: any) => ({
          id: p.id,
          paymentReference: p.payment_reference,
          amount: Number(p.amount || 0),
          destination: p.destination,
          paymentMethod: p.payment_method,
          paymentDate: toIsoDateOnly(p.payment_date),
          status: p.status,
          receiptId: p.receipt_id || null,
          receiptNumber: p.receipt_number || null,
          receiptType: p.receipt_type || null,
          receiptStatus: p.receipt_status || null,
        })),
      },
      auditHistory: (auditRows || []).map((al: any) => ({
        id: al.id,
        action: al.action,
        actorName: maskActorName(al.actor_full_name, al.actor_role_code, viewerRole),
        actorRole: maskActorRole(al.actor_role_code, viewerRole),
        details: parseJsonCol(al.details),
        createdAt: al.created_at,
      })),
    });
  } catch (err) {
    console.error('[KAMCH Students] Error loading student profile:', (err as Error).message);
    res.status(500).json({ error: 'Failed to retrieve student profile', code: 'DATABASE_ERROR' });
  }
});

studentsRouter.put(
  '/:id',
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const studentId = parseInt(req.params.id, 10);
    if (!studentId || isNaN(studentId)) {
      res.status(400).json({ error: 'Invalid student ID', code: 'INVALID_ID' });
      return;
    }

    const user = req.user!;
    const b = req.body || {};
    const cleanName = cleanStr(b.fullName);

    if (!cleanName) {
      res.status(400).json({ error: 'Student full name is required', code: 'MISSING_FIELDS' });
      return;
    }

    try {
      const pool = getPool();
      const [rows] = await pool.query<any[]>(
        '/* SM:GET_STUDENT_DETAIL */ SELECT * FROM students WHERE id = ? LIMIT 1',
        [studentId]
      );
      if (!rows || rows.length === 0) {
        res.status(404).json({ error: 'Student record not found', code: 'STUDENT_NOT_FOUND' });
        return;
      }

      const existing = rows[0];
      const requestedQuota = cleanStr(b.admissionQuota || b.admissionCategory)?.toUpperCase();

      // Preserve strict Fees Management governance: Office cannot alter registered student's admission quota/category
      if (
        requestedQuota &&
        requestedQuota !== existing.admission_category &&
        isOfficeScopedRole(user.role)
      ) {
        res.status(403).json({
          error: 'Office members cannot alter a registered student admission quota / seat category',
          code: 'FORBIDDEN_CATEGORY_CHANGE',
        });
        return;
      }

      const nextQuota =
        requestedQuota && VALID_QUOTAS.includes(requestedQuota as any)
          ? requestedQuota
          : existing.admission_category;

      let nextAdminStatus = existing.administrative_status || 'ACTIVE';
      if (b.administrativeStatus && VALID_ADMIN_STATUSES.includes(b.administrativeStatus)) {
        nextAdminStatus = b.administrativeStatus;
      } else if (b.status && ['ACTIVE', 'PASSED_OUT', 'SUSPENDED'].includes(b.status)) {
        nextAdminStatus = mapLegacyToAdminStatus(b.status);
      }

      const statusReason =
        b.administrativeStatusReason !== undefined
          ? cleanStr(b.administrativeStatusReason)
          : existing.administrative_status_reason;

      // Require reason when moving to DISCONTINUED or CANCELLED
      if (
        ['DISCONTINUED', 'CANCELLED'].includes(nextAdminStatus) &&
        nextAdminStatus !== existing.administrative_status &&
        !cleanStr(b.administrativeStatusReason || b.changeReason)
      ) {
        res.status(400).json({
          error: `An official reason is required to change administrative status to ${nextAdminStatus}.`,
          code: 'REASON_REQUIRED_FOR_STATUS_CHANGE',
        });
        return;
      }

      const nextLegacyStatus = mapAdminToLegacyStatus(nextAdminStatus);
      const nextOrigBatchId =
        b.originalBatchId !== undefined
          ? b.originalBatchId
            ? Number(b.originalBatchId)
            : null
          : existing.original_batch_id;
      const nextPlacementBatchId =
        b.currentPlacementBatchId !== undefined
          ? b.currentPlacementBatchId
            ? Number(b.currentPlacementBatchId)
            : null
          : existing.current_placement_batch_id;

      if (nextPlacementBatchId) {
        const [batchRows] = await pool.query<any[]>(
          'SELECT * FROM academic_batches b WHERE b.id = ?',
          [nextPlacementBatchId]
        );
        if (!batchRows || batchRows.length === 0) {
          res.status(400).json({ error: 'Selected placement batch does not exist', code: 'INVALID_BATCH' });
          return;
        }
        if (!batchRows[0].is_active && Number(nextPlacementBatchId) !== Number(existing.current_placement_batch_id)) {
          res.status(400).json({
            error: `Cannot place student into inactive batch '${batchRows[0].name}'.`,
            code: 'INACTIVE_BATCH_PLACEMENT',
          });
          return;
        }
      }

      const nextAdmYear = b.admissionYear
        ? parseInt(String(b.admissionYear), 10) || Number(existing.admission_year)
        : Number(existing.admission_year);
      if (b.admissionDate !== undefined && cleanStr(b.admissionDate) && !normalizeDateStr(b.admissionDate)) {
        res.status(400).json({
          error: 'Invalid Official Admission Date format (expected YYYY-MM-DD)',
          code: 'INVALID_ADMISSION_DATE',
        });
        return;
      }
      const nextAdmDate =
        b.admissionDate !== undefined
          ? normalizeDateStr(b.admissionDate)
          : toIsoDateOnly(existing.admission_date);

      const pickField = (key: string, dbCol: string) =>
        b[key] !== undefined ? cleanStr(b[key]) : existing[dbCol] ?? null;

      if (b.dateOfBirth !== undefined && cleanStr(b.dateOfBirth) && !normalizeDateStr(b.dateOfBirth)) {
        res.status(400).json({
          error: 'Invalid Date of Birth format (expected YYYY-MM-DD)',
          code: 'INVALID_DOB',
        });
        return;
      }
      const nextDob =
        b.dateOfBirth !== undefined
          ? normalizeDateStr(b.dateOfBirth)
          : toIsoDateOnly(existing.date_of_birth);

      const nextGender =
        b.gender !== undefined
          ? b.gender && VALID_GENDERS.includes(String(b.gender).toUpperCase() as any)
            ? String(b.gender).toUpperCase()
            : null
          : existing.gender ?? null;

      const nextEmail =
        b.contactEmail !== undefined
          ? cleanStr(b.contactEmail)?.toLowerCase() || null
          : existing.contact_email ?? null;

      const nextSchemeId =
        b.schemeId !== undefined
          ? b.schemeId
            ? Number(b.schemeId)
            : null
          : existing.scheme_id ?? null;

      const nextAdmStatus =
        b.admissionStatus && VALID_ADMISSION_STATUSES.includes(b.admissionStatus)
          ? b.admissionStatus
          : existing.admission_status || 'PROVISIONAL';

      const durationCfg = await getMaxCourseDurationYears(pool);
      const durationCheck = computeCourseDurationStatus(
        nextAdmYear,
        nextAdmDate,
        durationCfg.maxYears,
        null,
        {
          dateOfBirth: nextDob,
          admissionStatus: nextAdmStatus,
        }
      );

      const nextConfDate =
        b.confirmationDate !== undefined
          ? normalizeDateStr(b.confirmationDate)
          : toIsoDateOnly(existing.confirmation_date);

      const nextStudyYear = b.currentYearOfStudy
        ? parseInt(String(b.currentYearOfStudy), 10) || Number(existing.current_year_of_study)
        : Number(existing.current_year_of_study || 1);

      const nextRs6Intern =
        b.rs6InternshipCompleted !== undefined
          ? b.rs6InternshipCompleted === null
            ? null
            : Boolean(b.rs6InternshipCompleted)
          : existing.rs6_internship_completed ?? null;

      await pool.query(
        `/* SM:UPDATE_STUDENT_PROFILE */
         UPDATE students SET
           full_name = ?, university_recorded_name = ?, date_of_birth = ?, gender = ?, nationality = ?,
           contact_phone = ?, contact_email = ?, current_address = ?, permanent_address = ?,
           state = ?, district = ?, city_town = ?, pin_code = ?, profile_remarks = ?,
           father_name = ?, father_phone = ?, mother_name = ?, mother_phone = ?,
           guardian_name = ?, guardian_relationship = ?, guardian_phone = ?,
           emergency_contact_name = ?, emergency_contact_relationship = ?, emergency_contact_phone = ?, parent_guardian_address = ?,
           scheme_id = ?, original_batch_id = ?, current_placement_batch_id = ?,
           admission_academic_year = ?, admission_year = ?, admission_date = ?,
           admission_category = ?, seat_category = ?, reservation_details = ?,
           is_kea_eligible = ?, kea_acknowledgement_no = ?, neet_roll_number = ?, neet_score = ?, application_identifier = ?,
           qualifying_exam = ?, qualifying_board = ?, qualifying_year = ?, qualifying_marks_percentage = ?,
           admission_order_ref = ?, admission_status = ?, confirmation_date = ?, admission_remarks = ?,
           current_year_of_study = ?, rs6_internship_completed = ?, rs6_academic_summary = ?,
           administrative_status = ?, administrative_status_reason = ?, status = ?, course_duration_flag = ?
         WHERE id = ?`,
        [
          cleanName,
          pickField('universityRecordedName', 'university_recorded_name'),
          nextDob,
          nextGender,
          pickField('nationality', 'nationality') || 'Indian',
          pickField('contactPhone', 'contact_phone'),
          nextEmail,
          pickField('currentAddress', 'current_address'),
          pickField('permanentAddress', 'permanent_address'),
          pickField('state', 'state'),
          pickField('district', 'district'),
          pickField('cityTown', 'city_town'),
          pickField('pinCode', 'pin_code'),
          pickField('profileRemarks', 'profile_remarks'),
          pickField('fatherName', 'father_name'),
          pickField('fatherPhone', 'father_phone'),
          pickField('motherName', 'mother_name'),
          pickField('motherPhone', 'mother_phone'),
          pickField('guardianName', 'guardian_name'),
          pickField('guardianRelationship', 'guardian_relationship'),
          pickField('guardianPhone', 'guardian_phone'),
          pickField('emergencyContactName', 'emergency_contact_name'),
          pickField('emergencyContactRelationship', 'emergency_contact_relationship'),
          pickField('emergencyContactPhone', 'emergency_contact_phone'),
          pickField('parentGuardianAddress', 'parent_guardian_address'),
          nextSchemeId,
          nextOrigBatchId,
          nextPlacementBatchId,
          pickField('admissionAcademicYear', 'admission_academic_year'),
          nextAdmYear,
          nextAdmDate,
          nextQuota,
          pickField('seatCategory', 'seat_category'),
          pickField('reservationDetails', 'reservation_details'),
          b.isKeaEligible !== undefined ? Boolean(b.isKeaEligible) : Boolean(existing.is_kea_eligible),
          pickField('keaAcknowledgementNo', 'kea_acknowledgement_no'),
          pickField('neetRollNumber', 'neet_roll_number'),
          pickField('neetScore', 'neet_score'),
          pickField('applicationIdentifier', 'application_identifier'),
          pickField('qualifyingExam', 'qualifying_exam'),
          pickField('qualifyingBoard', 'qualifying_board'),
          b.qualifyingYear !== undefined
            ? b.qualifyingYear
              ? parseInt(String(b.qualifyingYear), 10) || null
              : null
            : existing.qualifying_year ?? null,
          pickField('qualifyingMarksPercentage', 'qualifying_marks_percentage'),
          pickField('admissionOrderRef', 'admission_order_ref'),
          nextAdmStatus,
          nextConfDate,
          pickField('admissionRemarks', 'admission_remarks'),
          nextStudyYear,
          nextRs6Intern,
          pickField('rs6AcademicSummary', 'rs6_academic_summary'),
          nextAdminStatus,
          statusReason || cleanStr(b.changeReason) || null,
          nextLegacyStatus,
          durationCheck.exceedsLimit,
          studentId,
        ]
      );

      await recordAuditLog({
        actorId: user.id,
        action: 'STUDENT_RECORD_UPDATED',
        targetType: 'STUDENT',
        targetId: String(studentId),
        ipAddress: req.ip || null,
        details: {
          studentIdNumber: existing.student_id_number,
          changeReason: cleanStr(b.changeReason || b.administrativeStatusReason),
          before: {
            fullName: existing.full_name,
            admissionQuota: existing.admission_category,
            seatCategory: existing.seat_category,
            originalBatchId: existing.original_batch_id,
            currentPlacementBatchId: existing.current_placement_batch_id,
            administrativeStatus: existing.administrative_status,
            rs6InternshipCompleted: existing.rs6_internship_completed,
          },
          after: {
            fullName: cleanName,
            admissionQuota: nextQuota,
            seatCategory: pickField('seatCategory', 'seat_category'),
            originalBatchId: nextOrigBatchId,
            currentPlacementBatchId: nextPlacementBatchId,
            administrativeStatus: nextAdminStatus,
            rs6InternshipCompleted: nextRs6Intern,
          },
        },
      });

      res.json({
        success: true,
        message: `Student profile updated for ${cleanName}.`,
      });
    } catch (err) {
      console.error('[KAMCH Students] Error updating student profile:', (err as Error).message);
      res.status(500).json({ error: 'Failed to update student profile', code: 'DATABASE_ERROR' });
    }
  }
);

studentsRouter.delete('/:id', validateCsrf, async (req: Request, res: Response): Promise<void> => {
  await recordAuditLog({
    actorId: req.user!.id,
    action: 'BLOCKED_STUDENT_HARD_DELETE_ATTEMPT',
    targetType: 'STUDENT',
    targetId: String(req.params.id),
    ipAddress: req.ip || null,
    details: { note: 'Hard deletion of student records is prohibited to preserve financial & academic audit integrity.' },
  });
  res.status(403).json({
    error:
      'Hard deletion of student records is disabled to preserve historical, academic, and fee receipt integrity. Use DISCONTINUED or CANCELLED administrative status instead.',
    code: 'HARD_DELETE_PROHIBITED',
  });
});

// ============================================================================
// 6. PERMANENT UNIVERSITY REGISTRATION NUMBER LIFECYCLE (Section 4)
// ============================================================================

studentsRouter.post(
  '/:id/university-number',
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const studentId = parseInt(req.params.id, 10);
    if (!studentId || isNaN(studentId)) {
      res.status(400).json({ error: 'Invalid student ID', code: 'INVALID_ID' });
      return;
    }

    const { permanentUniversityNumber, verifyNow, reason } = req.body || {};
    const cleanPerm = cleanStr(permanentUniversityNumber)?.toUpperCase();
    const cleanReason =
      cleanStr(reason) || 'Official RGUHS university registration number recorded';

    if (!cleanPerm || cleanPerm.length < 4) {
      res.status(400).json({
        error: 'A valid permanent university registration number is required',
        code: 'INVALID_UNIVERSITY_NUMBER',
      });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();
    const user = req.user!;

    try {
      await connection.beginTransaction();

      const [stRows] = await connection.query<any[]>(
        '/* SM:GET_STUDENT_DETAIL */ SELECT * FROM students WHERE id = ? LIMIT 1',
        [studentId]
      );
      if (!stRows || stRows.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: 'Student not found', code: 'STUDENT_NOT_FOUND' });
        return;
      }
      const existing = stRows[0];

      // Require explicit correction reason if overwriting an already verified university number
      if (
        existing.university_reg_status === 'VERIFIED' &&
        existing.permanent_university_number &&
        existing.permanent_university_number !== cleanPerm &&
        !cleanStr(reason)
      ) {
        await connection.rollback();
        res.status(400).json({
          error: 'A mandatory reason is required to correct an already verified university registration number.',
          code: 'CORRECTION_REASON_REQUIRED',
        });
        return;
      }

      const [conflicts] = await connection.query<any[]>(
        `/* SM:CHECK_IDENTIFIER_CONFLICT */
         SELECT id FROM students
         WHERE (student_id_number = ? OR temporary_roll_number = ? OR permanent_university_number = ?)
           AND id != ?
         LIMIT 1`,
        [cleanPerm, cleanPerm, cleanPerm, studentId]
      );
      if (conflicts && conflicts.length > 0) {
        await connection.rollback();
        res.status(409).json({
          error: `University registration number '${cleanPerm}' is already assigned to another student record.`,
          code: 'DUPLICATE_UNIVERSITY_NUMBER',
        });
        return;
      }

      const shouldVerify = Boolean(verifyNow);
      const nextStatus = shouldVerify ? 'VERIFIED' : 'PENDING_VERIFICATION';
      // Section 4: Replace temporary roll number as active displayed ID ONLY when verified, while preserving temporary_roll_number in history & on record
      const nextActiveDisplayedId = shouldVerify
        ? cleanPerm
        : existing.university_reg_status === 'VERIFIED'
        ? existing.temporary_roll_number || existing.student_id_number
        : existing.student_id_number;

      const verifiedAt = shouldVerify ? new Date().toISOString() : null;
      const verifiedBy = shouldVerify ? user.id : null;

      await connection.query(
        `/* SM:UPDATE_UNIVERSITY_NUMBER */
         UPDATE students
         SET student_id_number = ?, permanent_university_number = ?, university_reg_status = ?,
             university_reg_verified_by = ?, university_reg_verified_at = ?
         WHERE id = ?`,
        [nextActiveDisplayedId, cleanPerm, nextStatus, verifiedBy, verifiedAt, studentId]
      );

      const histType =
        existing.permanent_university_number && existing.permanent_university_number !== cleanPerm
          ? 'IDENTIFIER_CORRECTION'
          : shouldVerify
          ? 'PERMANENT_UNIVERSITY_VERIFIED'
          : 'PERMANENT_UNIVERSITY_ENTERED';

      await connection.query(
        `INSERT INTO student_identifier_history
          (student_id, identifier_type, previous_identifier, new_identifier, verification_status, reason, actor_id, verified_by, verified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          studentId,
          histType,
          existing.student_id_number,
          cleanPerm,
          shouldVerify ? 'VERIFIED' : 'PENDING_VERIFICATION',
          cleanReason,
          user.id,
          verifiedBy,
          verifiedAt,
        ]
      );

      await connection.commit();

      await recordAuditLog({
        actorId: user.id,
        action: shouldVerify
          ? 'UNIVERSITY_REGISTRATION_NUMBER_VERIFIED'
          : 'UNIVERSITY_REGISTRATION_NUMBER_ENTERED',
        targetType: 'STUDENT',
        targetId: String(studentId),
        ipAddress: req.ip || null,
        details: {
          temporaryRollNumber: existing.temporary_roll_number,
          previousActiveId: existing.student_id_number,
          permanentUniversityNumber: cleanPerm,
          newActiveId: nextActiveDisplayedId,
          verificationStatus: nextStatus,
          reason: cleanReason,
        },
      });

      res.json({
        success: true,
        message: shouldVerify
          ? `Permanent university number '${cleanPerm}' verified and activated as primary student identifier. Temporary roll '${existing.temporary_roll_number}' preserved in history.`
          : `Permanent university number '${cleanPerm}' saved as Pending Verification. Temporary roll '${existing.student_id_number}' remains active until verified.`,
        studentIdNumber: nextActiveDisplayedId,
        permanentUniversityNumber: cleanPerm,
        universityRegStatus: nextStatus,
      });
    } catch (err) {
      await connection.rollback();
      console.error('[KAMCH Students] Error updating university number:', (err as Error).message);
      res.status(500).json({ error: 'Failed to update university registration number', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

studentsRouter.patch(
  '/:id/university-number/verify',
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const studentId = parseInt(req.params.id, 10);
    if (!studentId || isNaN(studentId)) {
      res.status(400).json({ error: 'Invalid student ID', code: 'INVALID_ID' });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();
    const user = req.user!;
    const cleanReason =
      cleanStr(req.body?.reason) || 'Verified against official RGUHS university registration allotment';

    try {
      await connection.beginTransaction();

      const [stRows] = await connection.query<any[]>(
        '/* SM:GET_STUDENT_DETAIL */ SELECT * FROM students WHERE id = ? LIMIT 1',
        [studentId]
      );
      if (!stRows || stRows.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: 'Student not found', code: 'STUDENT_NOT_FOUND' });
        return;
      }
      const existing = stRows[0];

      if (!existing.permanent_university_number) {
        await connection.rollback();
        res.status(400).json({
          error: 'No permanent university registration number has been entered for this student yet.',
          code: 'NO_UNIVERSITY_NUMBER_TO_VERIFY',
        });
        return;
      }

      const permNo = String(existing.permanent_university_number).toUpperCase();
      const verifiedAt = new Date().toISOString();

      await connection.query(
        `/* SM:UPDATE_UNIVERSITY_NUMBER */
         UPDATE students
         SET student_id_number = ?, permanent_university_number = ?, university_reg_status = ?,
             university_reg_verified_by = ?, university_reg_verified_at = ?
         WHERE id = ?`,
        [permNo, permNo, 'VERIFIED', user.id, verifiedAt, studentId]
      );

      await connection.query(
        `INSERT INTO student_identifier_history
          (student_id, identifier_type, previous_identifier, new_identifier, verification_status, reason, actor_id, verified_by, verified_at)
         VALUES (?, 'PERMANENT_UNIVERSITY_VERIFIED', ?, ?, 'VERIFIED', ?, ?, ?, ?)`,
        [
          studentId,
          existing.temporary_roll_number || existing.student_id_number,
          permNo,
          cleanReason,
          user.id,
          user.id,
          verifiedAt,
        ]
      );

      await connection.commit();

      await recordAuditLog({
        actorId: user.id,
        action: 'UNIVERSITY_REGISTRATION_NUMBER_VERIFIED',
        targetType: 'STUDENT',
        targetId: String(studentId),
        ipAddress: req.ip || null,
        details: {
          temporaryRollNumber: existing.temporary_roll_number,
          verifiedUniversityNumber: permNo,
          reason: cleanReason,
        },
      });

      res.json({
        success: true,
        message: `University registration number '${permNo}' verified and activated as primary displayed identifier.`,
        studentIdNumber: permNo,
        universityRegStatus: 'VERIFIED',
      });
    } catch (err) {
      await connection.rollback();
      console.error('[KAMCH Students] Error verifying university number:', (err as Error).message);
      res.status(500).json({ error: 'Failed to verify university number', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

// ============================================================================
// 7. DOCUMENT METADATA REGISTRY — NO FILE/PHOTO UPLOADS (Section 8E)
// ============================================================================

studentsRouter.post(
  '/:id/documents',
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const studentId = parseInt(req.params.id, 10);
    if (!studentId || isNaN(studentId)) {
      res.status(400).json({ error: 'Invalid student ID', code: 'INVALID_ID' });
      return;
    }

    const b = req.body || {};
    const docType = cleanStr(b.documentType)?.toUpperCase();
    if (!docType) {
      res.status(400).json({ error: 'Document type is required', code: 'MISSING_FIELDS' });
      return;
    }

    const receivedStatus = VALID_DOC_RECEIVED.includes(b.receivedStatus)
      ? b.receivedStatus
      : 'PENDING';
    const verifStatus = VALID_DOC_VERIF.includes(b.verificationStatus)
      ? b.verificationStatus
      : 'UNVERIFIED';
    const isVerified = verifStatus === 'VERIFIED';
    const nowIso = new Date().toISOString();

    try {
      const pool = getPool();
      const [result] = await pool.query<any>(
        `INSERT INTO student_documents
          (student_id, document_type, document_label, reference_number, issue_date, received_status, verification_status, verified_by, verified_at, remarks, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          studentId,
          docType,
          cleanStr(b.documentLabel),
          cleanStr(b.referenceNumber),
          normalizeDateStr(b.issueDate),
          receivedStatus,
          verifStatus,
          isVerified ? req.user!.id : null,
          isVerified ? nowIso : null,
          cleanStr(b.remarks),
          req.user!.id,
        ]
      );

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'STUDENT_DOCUMENT_METADATA_ADDED',
        targetType: 'STUDENT',
        targetId: String(studentId),
        ipAddress: req.ip || null,
        details: {
          documentId: result.insertId,
          documentType: docType,
          receivedStatus,
          verificationStatus: verifStatus,
        },
      });

      res.status(201).json({
        success: true,
        message: `Document metadata ('${b.documentLabel || docType}') recorded.`,
        documentId: result.insertId,
      });
    } catch (err) {
      console.error('[KAMCH Students] Error adding document metadata:', (err as Error).message);
      res.status(500).json({ error: 'Failed to add document metadata', code: 'DATABASE_ERROR' });
    }
  }
);

studentsRouter.put(
  '/:id/documents/:docId',
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const studentId = parseInt(req.params.id, 10);
    const docId = parseInt(req.params.docId, 10);
    if (!studentId || !docId) {
      res.status(400).json({ error: 'Invalid student or document ID', code: 'INVALID_ID' });
      return;
    }

    try {
      const pool = getPool();
      const [rows] = await pool.query<any[]>(
        'SELECT * FROM student_documents WHERE id = ? AND student_id = ?',
        [docId, studentId]
      );
      if (!rows || rows.length === 0) {
        res.status(404).json({ error: 'Document metadata record not found', code: 'NOT_FOUND' });
        return;
      }
      const existing = rows[0];
      const b = req.body || {};

      const nextType = cleanStr(b.documentType)?.toUpperCase() || existing.document_type;
      const nextLabel = b.documentLabel !== undefined ? cleanStr(b.documentLabel) : existing.document_label;
      const nextRef = b.referenceNumber !== undefined ? cleanStr(b.referenceNumber) : existing.reference_number;
      const nextIssue =
        b.issueDate !== undefined
          ? normalizeDateStr(b.issueDate)
          : toIsoDateOnly(existing.issue_date);
      const nextRecv = VALID_DOC_RECEIVED.includes(b.receivedStatus)
        ? b.receivedStatus
        : existing.received_status;
      const nextVerif = VALID_DOC_VERIF.includes(b.verificationStatus)
        ? b.verificationStatus
        : existing.verification_status;
      const nextRemarks = b.remarks !== undefined ? cleanStr(b.remarks) : existing.remarks;

      const verifiedBy =
        nextVerif === 'VERIFIED'
          ? existing.verified_by || req.user!.id
          : null;
      const verifiedAt =
        nextVerif === 'VERIFIED'
          ? existing.verified_at || new Date().toISOString()
          : null;

      await pool.query(
        `UPDATE student_documents
         SET document_type = ?, document_label = ?, reference_number = ?, issue_date = ?,
             received_status = ?, verification_status = ?, verified_by = ?, verified_at = ?,
             remarks = ?, updated_by = ?
         WHERE id = ? AND student_id = ?`,
        [
          nextType,
          nextLabel,
          nextRef,
          nextIssue,
          nextRecv,
          nextVerif,
          verifiedBy,
          verifiedAt,
          nextRemarks,
          req.user!.id,
          docId,
          studentId,
        ]
      );

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'STUDENT_DOCUMENT_METADATA_UPDATED',
        targetType: 'STUDENT',
        targetId: String(studentId),
        ipAddress: req.ip || null,
        details: {
          documentId: docId,
          documentType: nextType,
          receivedStatus: nextRecv,
          verificationStatus: nextVerif,
        },
      });

      res.json({ success: true, message: 'Document verification metadata updated.' });
    } catch (err) {
      console.error('[KAMCH Students] Error updating document metadata:', (err as Error).message);
      res.status(500).json({ error: 'Failed to update document metadata', code: 'DATABASE_ERROR' });
    }
  }
);

// ============================================================================
// 8. ACADEMIC PROGRESSION & DETENTION PLACEMENT ENGINE (Sections 11 & 12)
// ============================================================================

studentsRouter.post(
  '/:id/progression/evaluate',
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const studentId = parseInt(req.params.id, 10);
    if (!studentId || isNaN(studentId)) {
      res.status(400).json({ error: 'Invalid student ID', code: 'INVALID_ID' });
      return;
    }

    const b = req.body || {};
    const examAttemptType =
      b.examAttemptType === 'SUPPLEMENTARY' ? 'SUPPLEMENTARY' : 'REGULAR';
    const subjects = (Array.isArray(b.subjects) ? b.subjects : []) as SubjectResultInput[];

    const pool = getPool();
    const connection = await pool.getConnection();
    const user = req.user!;

    try {
      await connection.beginTransaction();

      const [stRows] = await connection.query<any[]>(
        '/* SM:GET_STUDENT_DETAIL */ SELECT * FROM students WHERE id = ? LIMIT 1',
        [studentId]
      );
      if (!stRows || stRows.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: 'Student not found', code: 'STUDENT_NOT_FOUND' });
        return;
      }
      const st = stRows[0];

      let scheme: SchemeConfig | null = null;
      if (st.scheme_id) {
        const [scRows] = await connection.query<any[]>(
          'SELECT * FROM curriculum_schemes WHERE id = ?',
          [st.scheme_id]
        );
        if (scRows && scRows[0]) {
          scheme = {
            id: Number(scRows[0].id),
            code: scRows[0].code,
            name: scRows[0].name,
            is_legacy_minimal: Boolean(scRows[0].is_legacy_minimal),
            professional_years_count: Number(scRows[0].professional_years_count),
            regular_pass_max_failed_for_provisional: Number(
              scRows[0].regular_pass_max_failed_for_provisional
            ),
            allow_provisional_promotion: Boolean(scRows[0].allow_provisional_promotion),
            passing_criteria_verified: Boolean(scRows[0].passing_criteria_verified),
            supplementary_cycle_months: Number(scRows[0].supplementary_cycle_months),
          };
        }
      }

      const [batchRows] = await connection.query<any[]>(
        'SELECT * FROM academic_batches ORDER BY display_order ASC'
      );
      const batchNodes: BatchConfigNode[] = (batchRows || []).map((br: any) => ({
        id: Number(br.id),
        code: br.code,
        name: br.name,
        junior_batch_id: br.junior_batch_id ? Number(br.junior_batch_id) : null,
        current_professional_year:
          br.current_professional_year !== null && br.current_professional_year !== undefined
            ? Number(br.current_professional_year)
            : null,
        current_cohort_stage: br.current_cohort_stage,
      }));

      const durationCfg = await getMaxCourseDurationYears(connection);
      const effectiveDate =
        normalizeDateStr(b.effectiveDate) || new Date().toISOString().slice(0, 10);

      const proposal = evaluateProgressionProposal({
        student: {
          id: Number(st.id),
          admission_year: Number(st.admission_year),
          admission_date: st.admission_date,
          date_of_birth: st.date_of_birth,
          admission_status: st.admission_status,
          current_year_of_study: Number(st.current_year_of_study || 1),
          original_batch_id: st.original_batch_id ? Number(st.original_batch_id) : null,
          current_placement_batch_id: st.current_placement_batch_id
            ? Number(st.current_placement_batch_id)
            : null,
          detention_stage: Number(st.detention_stage || 0),
          progression_status: st.progression_status || 'REGULAR_ACTIVE',
          outstanding_backlogs_count: Number(st.outstanding_backlogs_count || 0),
        },
        scheme,
        batches: batchNodes,
        examSessionRef: cleanStr(b.examSessionRef) || '',
        examAttemptType,
        evaluatedProfessionalYear: b.evaluatedProfessionalYear
          ? Number(b.evaluatedProfessionalYear)
          : Number(st.current_year_of_study || 1),
        subjects,
        priorUnresolvedSubjects: Array.isArray(b.priorUnresolvedSubjects)
          ? b.priorUnresolvedSubjects
          : [],
        maxCourseDurationYears: durationCfg.maxYears,
        effectiveDate,
      });

      const [evRes] = await connection.query<any>(
        `INSERT INTO student_progression_events (
           student_id, scheme_id, event_type, exam_session_ref, exam_attempt_type,
           evaluated_professional_year, previous_professional_year, proposed_professional_year,
           previous_placement_batch_id, proposed_placement_batch_id,
           previous_detention_stage, proposed_detention_stage,
           subjects_evaluated_count, subjects_passed, subjects_outstanding,
           placement_rule_applied, proposed_status, workflow_state,
           review_issue_explanation, classroom_mapping, supplementary_cycle_note,
           max_duration_years_snapshot, exceeds_max_duration_flag,
           entered_by, confirmed_by, confirmed_at, effective_date, reason_or_remarks
         ) VALUES (?, ?, 'PROPOSED_RESULT_OUTCOME', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
        [
          studentId,
          scheme?.id || null,
          cleanStr(b.examSessionRef),
          examAttemptType,
          b.evaluatedProfessionalYear
            ? Number(b.evaluatedProfessionalYear)
            : Number(st.current_year_of_study || 1),
          proposal.previousProfessionalYear,
          proposal.proposedProfessionalYear,
          proposal.previousPlacementBatchId,
          proposal.proposedPlacementBatchId,
          proposal.previousDetentionStage,
          proposal.proposedDetentionStage,
          proposal.subjectsEvaluatedCount,
          JSON.stringify(proposal.subjectsPassed),
          JSON.stringify(proposal.subjectsOutstanding),
          proposal.placementRuleApplied,
          proposal.proposedStatus,
          proposal.workflowState,
          proposal.reviewIssueExplanation,
          proposal.classroomMapping ? JSON.stringify(proposal.classroomMapping) : null,
          proposal.supplementaryCycleNote,
          proposal.maxDurationYearsSnapshot,
          proposal.exceedsMaxDurationFlag,
          user.id,
          effectiveDate,
          cleanStr(b.remarks),
        ]
      );

      if (proposal.workflowState === 'PENDING_OFFICE_REVIEW') {
        await connection.query(
          `/* SM:FLAG_STUDENT_PENDING_REVIEW */
           UPDATE students
           SET progression_status = 'PENDING_OFFICE_REVIEW', course_duration_flag = ?
           WHERE id = ?`,
          [proposal.exceedsMaxDurationFlag, studentId]
        );
      }

      await connection.commit();

      await recordAuditLog({
        actorId: user.id,
        action:
          proposal.workflowState === 'PENDING_OFFICE_REVIEW'
            ? 'STUDENT_PROGRESSION_FLAGGED_FOR_OFFICE_REVIEW'
            : 'STUDENT_PROGRESSION_PROPOSED',
        targetType: 'STUDENT',
        targetId: String(studentId),
        ipAddress: req.ip || null,
        details: {
          eventId: evRes.insertId,
          examSessionRef: cleanStr(b.examSessionRef),
          examAttemptType,
          placementRuleApplied: proposal.placementRuleApplied,
          proposedStatus: proposal.proposedStatus,
          workflowState: proposal.workflowState,
          reviewIssueExplanation: proposal.reviewIssueExplanation,
        },
      });

      res.status(201).json({
        success: true,
        eventId: evRes.insertId,
        proposal,
        message:
          proposal.workflowState === 'PENDING_OFFICE_REVIEW'
            ? `Result evaluation flagged for Office review: ${proposal.reviewIssueExplanation}`
            : `Proposed progression outcome (${proposal.proposedStatus}) recorded. Confirm after official result verification.`,
      });
    } catch (err) {
      await connection.rollback();
      console.error('[KAMCH Students] Error evaluating progression:', (err as Error).message);
      res.status(500).json({ error: 'Failed to evaluate academic progression', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

studentsRouter.post(
  '/:id/progression/:eventId/confirm',
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const studentId = parseInt(req.params.id, 10);
    const eventId = parseInt(req.params.eventId, 10);
    if (!studentId || !eventId) {
      res.status(400).json({ error: 'Invalid student or progression event ID', code: 'INVALID_ID' });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();
    const user = req.user!;
    const remarks = cleanStr(req.body?.remarks);

    try {
      await connection.beginTransaction();

      const [evRows] = await connection.query<any[]>(
        'SELECT * FROM student_progression_events WHERE id = ? AND student_id = ?',
        [eventId, studentId]
      );
      if (!evRows || evRows.length === 0) {
        await connection.rollback();
        res.status(404).json({ error: 'Progression event not found', code: 'EVENT_NOT_FOUND' });
        return;
      }
      const ev = evRows[0];

      if (ev.workflow_state === 'CONFIRMED') {
        await connection.rollback();
        res.status(400).json({
          error: 'This progression event has already been confirmed.',
          code: 'ALREADY_CONFIRMED',
        });
        return;
      }

      if (ev.workflow_state === 'PENDING_OFFICE_REVIEW') {
        await connection.rollback();
        res.status(400).json({
          error:
            'Events flagged as PENDING_OFFICE_REVIEW cannot be confirmed directly without resolving the flagged issue via a documented Office review resolution.',
          code: 'REQUIRES_OFFICE_REVIEW_RESOLUTION',
        });
        return;
      }

      await connection.query(
        `UPDATE student_progression_events
         SET workflow_state = 'CONFIRMED', confirmed_by = ?, confirmed_at = NOW(),
             reason_or_remarks = COALESCE(?, reason_or_remarks)
         WHERE id = ?`,
        [user.id, remarks, eventId]
      );

      let outstandingArr = ev.subjects_outstanding;
      if (typeof outstandingArr === 'string') {
        try {
          outstandingArr = JSON.parse(outstandingArr);
        } catch {
          outstandingArr = [];
        }
      }
      const backlogCount = Array.isArray(outstandingArr) ? outstandingArr.length : 0;

      const classroomJson =
        ev.classroom_mapping && typeof ev.classroom_mapping !== 'string'
          ? JSON.stringify(ev.classroom_mapping)
          : ev.classroom_mapping || null;

      await connection.query(
        `/* SM:UPDATE_STUDENT_PROGRESSION */
         UPDATE students
         SET current_year_of_study = ?, current_placement_batch_id = ?, detention_stage = ?,
             progression_status = ?, classroom_mapping = ?, outstanding_backlogs_count = ?,
             supplementary_due_cycle = ?, course_duration_flag = ?
         WHERE id = ?`,
        [
          Number(ev.proposed_professional_year || 1),
          ev.proposed_placement_batch_id || null,
          Number(ev.proposed_detention_stage || 0),
          ev.proposed_status,
          classroomJson,
          backlogCount,
          backlogCount > 0 ? '6_MONTH_CYCLE' : null,
          Boolean(ev.exceeds_max_duration_flag),
          studentId,
        ]
      );

      if (ev.proposed_status === 'ELIGIBLE_FOR_INTERNSHIP') {
        await connection.query(
          `INSERT INTO student_internships
            (student_id, start_date, base_required_days, approved_extension_days, adjusted_required_days, credited_days_completed, attendance_source, attendance_reconciliation_status, last_attendance_sync_ref, expected_completion_date, internship_status, completion_remarks, created_by)
           VALUES (?, NULL, 365, 0, 365, 0, 'PENDING_ATTENDANCE_MODULE', 'UNAVAILABLE_PENDING_INTEGRATION', NULL, NULL, 'ELIGIBLE', 'Eligible upon clearing final professional year', ?)`,
          [studentId, user.id]
        );
      }

      await connection.commit();

      await recordAuditLog({
        actorId: user.id,
        action: 'STUDENT_PROGRESSION_CONFIRMED',
        targetType: 'STUDENT',
        targetId: String(studentId),
        ipAddress: req.ip || null,
        details: {
          eventId,
          proposedStatus: ev.proposed_status,
          proposedProfessionalYear: ev.proposed_professional_year,
          proposedPlacementBatchId: ev.proposed_placement_batch_id,
          proposedDetentionStage: ev.proposed_detention_stage,
          remarks,
        },
      });

      res.json({
        success: true,
        message: `Academic progression confirmed (${ev.proposed_status}).`,
      });
    } catch (err) {
      await connection.rollback();
      console.error('[KAMCH Students] Error confirming progression:', (err as Error).message);
      res.status(500).json({ error: 'Failed to confirm progression event', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

studentsRouter.post(
  '/:id/progression/:eventId/resolve-review',
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const studentId = parseInt(req.params.id, 10);
    const eventId = parseInt(req.params.eventId, 10);
    if (!studentId || !eventId) {
      res.status(400).json({ error: 'Invalid student or event ID', code: 'INVALID_ID' });
      return;
    }

    const b = req.body || {};
    const reason = cleanStr(b.reason);
    const resolvedStatus = cleanStr(b.resolvedStatus);

    if (!reason || !resolvedStatus) {
      res.status(400).json({
        error:
          'Both a resolved progression status and a documented Office correction reason are mandatory.',
        code: 'MISSING_REASON_OR_STATUS',
      });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();
    const user = req.user!;

    try {
      await connection.beginTransaction();

      const [stRows] = await connection.query<any[]>(
        '/* SM:GET_STUDENT_DETAIL */ SELECT * FROM students WHERE id = ? LIMIT 1',
        [studentId]
      );
      const [evRows] = await connection.query<any[]>(
        'SELECT * FROM student_progression_events WHERE id = ? AND student_id = ?',
        [eventId, studentId]
      );
      if (!stRows?.length || !evRows?.length) {
        await connection.rollback();
        res.status(404).json({ error: 'Student or progression event not found', code: 'NOT_FOUND' });
        return;
      }

      const st = stRows[0];
      const origEv = evRows[0];
      const durationCfg = await getMaxCourseDurationYears(connection);
      const durationCheck = computeCourseDurationStatus(
        Number(st.admission_year),
        st.admission_date,
        durationCfg.maxYears,
        null,
        {
          dateOfBirth: st.date_of_birth,
          admissionStatus: st.admission_status,
        }
      );

      // Supersede prior pending event without deleting or overwriting its original record
      await connection.query(
        "UPDATE student_progression_events SET workflow_state = 'SUPERSEDED' WHERE id = ?",
        [eventId]
      );

      const nextProfYear = b.proposedProfessionalYear
        ? Number(b.proposedProfessionalYear)
        : Number(origEv.proposed_professional_year || st.current_year_of_study || 1);
      const nextBatchId =
        b.proposedPlacementBatchId !== undefined
          ? b.proposedPlacementBatchId
            ? Number(b.proposedPlacementBatchId)
            : null
          : origEv.proposed_placement_batch_id ?? st.current_placement_batch_id ?? null;
      const nextDetentionStage =
        b.proposedDetentionStage !== undefined
          ? Number(b.proposedDetentionStage)
          : Number(origEv.proposed_detention_stage ?? st.detention_stage ?? 0);

      let resolvedMapping = b.classroomMapping ?? origEv.classroom_mapping ?? st.classroom_mapping ?? null;
      if (resolvedMapping && typeof resolvedMapping !== 'string') {
        resolvedMapping = JSON.stringify(resolvedMapping);
      }

      const [corrRes] = await connection.query<any>(
        `INSERT INTO student_progression_events (
           student_id, scheme_id, event_type, exam_session_ref, exam_attempt_type,
           evaluated_professional_year, previous_professional_year, proposed_professional_year,
           previous_placement_batch_id, proposed_placement_batch_id,
           previous_detention_stage, proposed_detention_stage,
           subjects_evaluated_count, subjects_passed, subjects_outstanding,
           placement_rule_applied, proposed_status, workflow_state,
           review_issue_explanation, classroom_mapping, supplementary_cycle_note,
           max_duration_years_snapshot, exceeds_max_duration_flag,
           entered_by, confirmed_by, confirmed_at, effective_date, reason_or_remarks
         ) VALUES (?, ?, 'DOCUMENTED_OFFICE_CORRECTION', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DOCUMENTED_OFFICE_REVIEW_RESOLUTION', ?, 'CONFIRMED', ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)`,
        [
          studentId,
          st.scheme_id || null,
          origEv.exam_session_ref,
          origEv.exam_attempt_type || 'NOT_APPLICABLE',
          origEv.evaluated_professional_year,
          Number(st.current_year_of_study || 1),
          nextProfYear,
          st.current_placement_batch_id || null,
          nextBatchId,
          Number(st.detention_stage || 0),
          nextDetentionStage,
          Number(origEv.subjects_evaluated_count || 0),
          origEv.subjects_passed
            ? typeof origEv.subjects_passed === 'string'
              ? origEv.subjects_passed
              : JSON.stringify(origEv.subjects_passed)
            : null,
          origEv.subjects_outstanding
            ? typeof origEv.subjects_outstanding === 'string'
              ? origEv.subjects_outstanding
              : JSON.stringify(origEv.subjects_outstanding)
            : null,
          resolvedStatus,
          `Resolved prior review event #${eventId}`,
          resolvedMapping,
          origEv.supplementary_cycle_note || null,
          durationCfg.maxYears,
          durationCheck.exceedsLimit,
          user.id,
          user.id,
          normalizeDateStr(b.effectiveDate) || new Date().toISOString().slice(0, 10),
          reason,
        ]
      );

      await connection.query(
        `/* SM:UPDATE_STUDENT_PROGRESSION */
         UPDATE students
         SET current_year_of_study = ?, current_placement_batch_id = ?, detention_stage = ?,
             progression_status = ?, classroom_mapping = ?, outstanding_backlogs_count = ?,
             supplementary_due_cycle = ?, course_duration_flag = ?
         WHERE id = ?`,
        [
          nextProfYear,
          nextBatchId,
          nextDetentionStage,
          resolvedStatus,
          resolvedMapping,
          Number(b.outstandingBacklogsCount ?? 0),
          Number(b.outstandingBacklogsCount ?? 0) > 0 ? '6_MONTH_CYCLE' : null,
          durationCheck.exceedsLimit,
          studentId,
        ]
      );

      if (resolvedStatus === 'ELIGIBLE_FOR_INTERNSHIP') {
        await connection.query(
          `INSERT INTO student_internships
            (student_id, start_date, base_required_days, approved_extension_days, adjusted_required_days, credited_days_completed, attendance_source, attendance_reconciliation_status, last_attendance_sync_ref, expected_completion_date, internship_status, completion_remarks, created_by)
           VALUES (?, NULL, 365, 0, 365, 0, 'PENDING_ATTENDANCE_MODULE', 'UNAVAILABLE_PENDING_INTEGRATION', NULL, NULL, 'ELIGIBLE', 'Eligible via documented Office progression resolution', ?)`,
          [studentId, user.id]
        );
      }

      await connection.commit();

      await recordAuditLog({
        actorId: user.id,
        action: 'STUDENT_PROGRESSION_REVIEW_RESOLVED',
        targetType: 'STUDENT',
        targetId: String(studentId),
        ipAddress: req.ip || null,
        details: {
          supersededEventId: eventId,
          correctionEventId: corrRes.insertId,
          resolvedStatus,
          nextProfYear,
          nextBatchId,
          nextDetentionStage,
          reason,
        },
      });

      res.json({
        success: true,
        correctionEventId: corrRes.insertId,
        message: `Office review resolved with documented correction (${resolvedStatus}). Original event #${eventId} preserved in history.`,
      });
    } catch (err) {
      await connection.rollback();
      console.error('[KAMCH Students] Error resolving progression review:', (err as Error).message);
      res.status(500).json({ error: 'Failed to resolve progression review', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

// ============================================================================
// 9. INTERNSHIP MANAGEMENT & PRINCIPAL EXTENSION CONTROLS (Section 14)
// ============================================================================

studentsRouter.post(
  '/:id/internship/initialize',
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const studentId = parseInt(req.params.id, 10);
    if (!studentId || isNaN(studentId)) {
      res.status(400).json({ error: 'Invalid student ID', code: 'INVALID_ID' });
      return;
    }

    const startDate = normalizeDateStr(req.body?.startDate);
    const remarks = cleanStr(req.body?.remarks);
    const user = req.user!;

    try {
      const pool = getPool();
      const [stRows] = await pool.query<any[]>(
        `/* SM:GET_STUDENT_DETAIL */
         SELECT s.*, cs.is_legacy_minimal, cb.current_cohort_stage
         FROM students s
         LEFT JOIN curriculum_schemes cs ON cs.id = s.scheme_id
         LEFT JOIN academic_batches cb ON cb.id = s.current_placement_batch_id
         WHERE s.id = ? LIMIT 1`,
        [studentId]
      );
      if (!stRows || stRows.length === 0) {
        res.status(404).json({ error: 'Student not found', code: 'STUDENT_NOT_FOUND' });
        return;
      }
      const st = stRows[0];

      if (st.is_legacy_minimal) {
        res.status(400).json({
          error:
            'RS6 legacy minimal records track 1-year internship completion via the RS6 summary toggle rather than the RS7 365-day internship ledger.',
          code: 'RS6_USES_SUMMARY_INTERNSHIP_FIELD',
        });
        return;
      }

      const [existingRows] = await pool.query<any[]>(
        'SELECT * FROM student_internships WHERE student_id = ? LIMIT 1',
        [studentId]
      );

      if (!existingRows || existingRows.length === 0) {
        const expectedDate = addDaysToIsoDate(startDate, 365);
        const status = startDate ? 'IN_PROGRESS' : 'ELIGIBLE';
        await pool.query(
          `INSERT INTO student_internships
            (student_id, start_date, base_required_days, approved_extension_days, adjusted_required_days, credited_days_completed, attendance_source, attendance_reconciliation_status, last_attendance_sync_ref, expected_completion_date, internship_status, completion_remarks, created_by)
           VALUES (?, ?, 365, 0, 365, 0, 'PENDING_ATTENDANCE_MODULE', 'UNAVAILABLE_PENDING_INTEGRATION', NULL, ?, ?, ?, ?)`,
          [studentId, startDate, expectedDate, status, remarks, user.id]
        );
      } else {
        const cur = existingRows[0];
        const expectedDate = addDaysToIsoDate(
          startDate || toIsoDateOnly(cur.start_date),
          Number(cur.adjusted_required_days || 365)
        );
        const nextStatus =
          cur.internship_status === 'COMPLETED'
            ? 'COMPLETED'
            : Number(cur.approved_extension_days) > 0 && startDate
            ? 'EXTENDED'
            : startDate
            ? 'IN_PROGRESS'
            : cur.internship_status;

        await pool.query(
          `/* SM:UPDATE_INTERNSHIP_START */
           UPDATE student_internships
           SET start_date = ?, expected_completion_date = ?, internship_status = ?, completion_remarks = ?
           WHERE student_id = ?`,
          [startDate, expectedDate, nextStatus, remarks, studentId]
        );
      }

      await recordAuditLog({
        actorId: user.id,
        action: 'STUDENT_INTERNSHIP_UPDATED',
        targetType: 'STUDENT',
        targetId: String(studentId),
        ipAddress: req.ip || null,
        details: { startDate, remarks },
      });

      res.json({
        success: true,
        message: startDate
          ? `Internship schedule updated (Start Date: ${startDate}).`
          : 'Internship eligibility record initialized (365 credited days required).',
      });
    } catch (err) {
      console.error('[KAMCH Students] Error updating internship:', (err as Error).message);
      res.status(500).json({ error: 'Failed to update internship schedule', code: 'DATABASE_ERROR' });
    }
  }
);

studentsRouter.post(
  '/:id/internship/extensions',
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const studentId = parseInt(req.params.id, 10);
    const user = req.user!;

    // Section 14: Strictly Principal-only
    if (user.role !== ROLES.PRINCIPAL) {
      await recordAuditLog({
        actorId: user.id,
        action: 'UNAUTHORIZED_INTERNSHIP_EXTENSION_ATTEMPT',
        targetType: 'STUDENT',
        targetId: String(studentId),
        ipAddress: req.ip || null,
        details: { attemptedByRole: user.role },
      });
      res.status(403).json({
        error: 'Only the Principal is authorized to approve internship extensions.',
        code: 'PRINCIPAL_AUTHORIZATION_REQUIRED',
      });
      return;
    }

    const additionalDays = parseInt(String(req.body?.additionalDays), 10);
    const reason = cleanStr(req.body?.reason);

    if (isNaN(additionalDays) || additionalDays <= 0 || additionalDays > 730) {
      res.status(400).json({
        error: 'Additional internship days must be a positive integer (1–730)',
        code: 'INVALID_EXTENSION_DAYS',
      });
      return;
    }
    if (!reason) {
      res.status(400).json({
        error: 'A mandatory official reason is required to extend internship duration',
        code: 'REASON_REQUIRED',
      });
      return;
    }

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [internRows] = await connection.query<any[]>(
        'SELECT * FROM student_internships WHERE student_id = ? LIMIT 1',
        [studentId]
      );
      if (!internRows || internRows.length === 0) {
        await connection.rollback();
        res.status(400).json({
          error: 'Initialize the student internship record before recording an extension.',
          code: 'INTERNSHIP_NOT_INITIALIZED',
        });
        return;
      }

      const intern = internRows[0];
      const prevApproved = Number(intern.approved_extension_days || 0);
      const prevTotal = Number(intern.adjusted_required_days || 365);
      const newApproved = prevApproved + additionalDays;
      const newTotal = Number(intern.base_required_days || 365) + newApproved;
      const startStr = toIsoDateOnly(intern.start_date);
      const newExpectedEnd = addDaysToIsoDate(startStr, newTotal);
      const nextStatus = intern.start_date ? 'EXTENDED' : intern.internship_status;

      await connection.query(
        `/* SM:UPDATE_INTERNSHIP_EXTENSION */
         UPDATE student_internships
         SET approved_extension_days = ?, adjusted_required_days = ?,
             expected_completion_date = ?, internship_status = ?
         WHERE id = ?`,
        [newApproved, newTotal, newExpectedEnd, nextStatus, intern.id]
      );

      await connection.query(
        `INSERT INTO student_internship_extensions
          (internship_id, student_id, additional_days, previous_required_total, new_required_total, reason, authorized_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [intern.id, studentId, additionalDays, prevTotal, newTotal, reason, user.id]
      );

      await connection.commit();

      await recordAuditLog({
        actorId: user.id,
        action: 'STUDENT_INTERNSHIP_EXTENSION_APPROVED',
        targetType: 'STUDENT',
        targetId: String(studentId),
        ipAddress: req.ip || null,
        details: {
          additionalDays,
          previousRequiredTotal: prevTotal,
          newRequiredTotal: newTotal,
          reason,
        },
      });

      res.status(201).json({
        success: true,
        message: `Principal approved +${additionalDays} internship day(s). Adjusted required total is now ${newTotal} credited days.`,
        adjustedRequiredDays: newTotal,
        approvedExtensionDays: newApproved,
        expectedCompletionDate: newExpectedEnd,
      });
    } catch (err) {
      await connection.rollback();
      console.error('[KAMCH Students] Error adding internship extension:', (err as Error).message);
      res.status(500).json({ error: 'Failed to record internship extension', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

/**
 * Integration boundary endpoint for Attendance & Biometric Reconciliation summary.
 * Does NOT implement daily biometric capture; records verified reconciled credited days
 * from the Attendance/Biometric reconciliation process.
 */
studentsRouter.post(
  '/:id/internship/attendance-sync',
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const studentId = parseInt(req.params.id, 10);
    const b = req.body || {};
    const creditedDays = parseInt(String(b.creditedDaysCompleted ?? 0), 10);
    const validSources = [
      'PENDING_ATTENDANCE_MODULE',
      'VERIFIED_BIOMETRIC_SYNC',
      'VERIFIED_ATTENDANCE_LEDGER',
    ];
    const validReconcil = [
      'UNAVAILABLE_PENDING_INTEGRATION',
      'RECONCILED',
      'DISCREPANCY_REVIEW',
    ];

    if (isNaN(creditedDays) || creditedDays < 0) {
      res.status(400).json({ error: 'Credited days must be >= 0', code: 'INVALID_CREDITED_DAYS' });
      return;
    }

    const source = validSources.includes(b.attendanceSource)
      ? b.attendanceSource
      : 'PENDING_ATTENDANCE_MODULE';
    const reconcil = validReconcil.includes(b.attendanceReconciliationStatus)
      ? b.attendanceReconciliationStatus
      : 'UNAVAILABLE_PENDING_INTEGRATION';
    const syncRef = cleanStr(b.syncReference);

    try {
      const pool = getPool();
      const [internRows] = await pool.query<any[]>(
        'SELECT * FROM student_internships WHERE student_id = ? LIMIT 1',
        [studentId]
      );
      if (!internRows || internRows.length === 0) {
        res.status(404).json({ error: 'Internship record not found', code: 'NOT_FOUND' });
        return;
      }

      await pool.query(
        `/* SM:UPDATE_INTERNSHIP_ATTENDANCE */
         UPDATE student_internships
         SET credited_days_completed = ?, attendance_source = ?,
             attendance_reconciliation_status = ?, last_attendance_sync_ref = ?
         WHERE id = ?`,
        [creditedDays, source, reconcil, syncRef, internRows[0].id]
      );

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'STUDENT_INTERNSHIP_ATTENDANCE_BOUNDARY_SYNCED',
        targetType: 'STUDENT',
        targetId: String(studentId),
        ipAddress: req.ip || null,
        details: {
          creditedDaysCompleted: creditedDays,
          attendanceSource: source,
          attendanceReconciliationStatus: reconcil,
          syncReference: syncRef,
        },
      });

      res.json({
        success: true,
        message: 'Internship attendance reconciliation summary updated.',
      });
    } catch (err) {
      console.error('[KAMCH Students] Error syncing internship attendance:', (err as Error).message);
      res.status(500).json({ error: 'Failed to update attendance summary', code: 'DATABASE_ERROR' });
    }
  }
);

studentsRouter.post(
  '/:id/internship/complete',
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const studentId = parseInt(req.params.id, 10);
    const actualCompletionDate =
      normalizeDateStr(req.body?.actualCompletionDate) || new Date().toISOString().slice(0, 10);
    const remarks = cleanStr(req.body?.remarks);
    const user = req.user!;

    try {
      const pool = getPool();
      const [internRows] = await pool.query<any[]>(
        'SELECT * FROM student_internships WHERE student_id = ? LIMIT 1',
        [studentId]
      );
      if (!internRows || internRows.length === 0) {
        res.status(404).json({ error: 'Internship record not found', code: 'NOT_FOUND' });
        return;
      }

      const intern = internRows[0];

      // Section 14 Strict Completion Guard 1: Attendance & Biometric verification must be available and reconciled
      if (
        intern.attendance_source === 'PENDING_ATTENDANCE_MODULE' ||
        intern.attendance_reconciliation_status !== 'RECONCILED'
      ) {
        res.status(400).json({
          error:
            'Internship cannot be marked complete until verified biometric/attendance reconciliation data is available and marked RECONCILED.',
          code: 'ATTENDANCE_VERIFICATION_UNAVAILABLE',
        });
        return;
      }

      // Section 14 Strict Completion Guard 2: Credited days must meet or exceed adjusted required days (365 + extensions)
      const credited = Number(intern.credited_days_completed || 0);
      const required = Number(intern.adjusted_required_days || 365);
      if (credited < required) {
        res.status(400).json({
          error: `Internship cannot be marked complete: student has ${credited} verified credited days, which is less than the required ${required} days.`,
          code: 'INSUFFICIENT_CREDITED_DAYS',
        });
        return;
      }

      await pool.query(
        `/* SM:COMPLETE_INTERNSHIP */
         UPDATE student_internships
         SET internship_status = 'COMPLETED', completion_verified_by = ?,
             completion_verified_at = NOW(), actual_completion_date = ?, completion_remarks = ?
         WHERE id = ?`,
        [user.id, actualCompletionDate, remarks, intern.id]
      );

      await recordAuditLog({
        actorId: user.id,
        action: 'STUDENT_INTERNSHIP_COMPLETED',
        targetType: 'STUDENT',
        targetId: String(studentId),
        ipAddress: req.ip || null,
        details: {
          creditedDaysCompleted: credited,
          adjustedRequiredDays: required,
          actualCompletionDate,
          attendanceSource: intern.attendance_source,
          remarks,
        },
      });

      res.json({
        success: true,
        message: `Internship completion verified (${credited}/${required} credited days).`,
      });
    } catch (err) {
      console.error('[KAMCH Students] Error completing internship:', (err as Error).message);
      res.status(500).json({ error: 'Failed to mark internship complete', code: 'DATABASE_ERROR' });
    }
  }
);
