import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getPool } from '../db.ts';
import { requireAuth, requirePasswordChangeClear, requireRoles } from '../middleware/auth.ts';
import { validateCsrf } from '../middleware/csrf.ts';
import { recordAuditLog } from '../services/audit.ts';

export const feesRouter = Router();

// Apply session authentication and password-change clearance across all fees routes
feesRouter.use(requireAuth);
feesRouter.use(requirePasswordChangeClear);

// Section 3: Strictly block departments (HOD, FACULTY, STUDENT) server-side
feesRouter.use((req: Request, res: Response, next) => {
  const role = req.user?.role;
  if (['HOD', 'FACULTY', 'STUDENT'].includes(role || '')) {
    res.status(403).json({
      error: 'Access denied: Department and student roles have no access to the Fees module or financial records.',
      code: 'FORBIDDEN_DEPARTMENT',
    });
    return;
  }
  next();
});

// Helper for converting number to Indian currency words
function numberToIndianWords(amount: number): string {
  const rounded = Math.floor(amount);
  const units = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  if (rounded === 0) return 'Zero Rupees Only';

  function convertTwoDigits(n: number): string {
    if (n < 20) return units[n];
    return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + units[n % 10] : '');
  }

  function convertThreeDigits(n: number): string {
    const hundred = Math.floor(n / 100);
    const rest = n % 100;
    let str = '';
    if (hundred > 0) str += units[hundred] + ' Hundred';
    if (rest > 0) str += (str ? ' and ' : '') + convertTwoDigits(rest);
    return str;
  }

  let words = '';
  const crore = Math.floor(rounded / 10000000);
  const lakh = Math.floor((rounded % 10000000) / 100000);
  const thousand = Math.floor((rounded % 100000) / 1000);
  const remainder = rounded % 1000;

  if (crore > 0) words += convertTwoDigits(crore) + ' Crore ';
  if (lakh > 0) words += convertTwoDigits(lakh) + ' Lakh ';
  if (thousand > 0) words += convertTwoDigits(thousand) + ' Thousand ';
  if (remainder > 0) words += convertThreeDigits(remainder);

  return words.trim() + ' Rupees Only';
}

/**
 * GET /api/fees/structures
 * Returns current fee structures for the given academic year (defaults to 2026-2027).
 */
feesRouter.get('/structures', async (req: Request, res: Response): Promise<void> => {
  const academicYear = typeof req.query.academicYear === 'string' ? req.query.academicYear : '2026-2027';
  try {
    const pool = getPool();
    const [rows] = await pool.query<any[]>(
      `SELECT id, academic_year, admission_category, year_of_study, college_fee, development_fee, mess_fee, hostel_fee, total_annual_fee, description, is_active
       FROM fee_structures
       WHERE academic_year = ?
       ORDER BY admission_category ASC, year_of_study ASC`,
      [academicYear]
    );
    res.json({ feeStructures: rows });
  } catch (err) {
    console.error('[KAMCH Fees] Error fetching fee structures:', (err as Error).message);
    res.status(500).json({ error: 'Failed to retrieve fee structures', code: 'DATABASE_ERROR' });
  }
});

/**
 * POST /api/fees/structures
 * Creates or updates a fee structure.
 * Authorized for: SUPER_ADMIN, PRINCIPAL, SECRETARY.
 * Office/Staff are strictly blocked.
 */
feesRouter.post('/structures', requireRoles('SUPER_ADMIN', 'PRINCIPAL', 'SECRETARY'), validateCsrf, async (req: Request, res: Response): Promise<void> => {
  const {
    id,
    academicYear,
    admissionCategory,
    yearOfStudy,
    collegeFee,
    developmentFee,
    messFee,
    hostelFee,
    description,
    isActive,
    scope, // 'FUTURE_ONLY' | 'SELECTED_BATCH' | 'SELECTED_STUDENTS'
    reason,
    targetStudentIds,
  } = req.body || {};

  const colFee = parseFloat(collegeFee);
  const devFee = parseFloat(developmentFee !== undefined ? developmentFee : 0);
  const mFee = parseFloat(messFee !== undefined ? messFee : 30000);
  const hFee = parseFloat(hostelFee !== undefined ? hostelFee : 30000);

  if (isNaN(colFee) || colFee < 0 || isNaN(devFee) || devFee < 0) {
    res.status(400).json({ error: 'College fee and development fee must be non-negative numbers', code: 'INVALID_AMOUNT' });
    return;
  }

  const targetYear = (academicYear || '2026-2027').trim();
  const targetCat = (admissionCategory || 'GOVERNMENT').trim();
  const targetStudyYear = parseInt(yearOfStudy, 10) || 1;

  if (scope === 'SELECTED_BATCH' || scope === 'SELECTED_STUDENTS') {
    if (!reason || !String(reason).trim()) {
      res.status(400).json({
        error: 'Mandatory institutional reason is required when modifying existing student assessments',
        code: 'REASON_REQUIRED',
      });
      return;
    }
  }

  if (scope === 'SELECTED_STUDENTS') {
    if (!Array.isArray(targetStudentIds) || targetStudentIds.length === 0) {
      res.status(400).json({
        error: 'At least one student must be selected for selective assessment update',
        code: 'STUDENTS_REQUIRED',
      });
      return;
    }
  }

  const totalAnnual = colFee + devFee;
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    let structureId = id ? parseInt(id, 10) : null;

    // If no explicit ID provided (e.g. from Configure New Structure), check if a structure
    // already exists for this academic_year, admission_category, and year_of_study.
    // If so, update it to prevent ER_DUP_ENTRY duplicate key constraint failure.
    if (!structureId) {
      const [existingRows] = await connection.query<any[]>(
        `SELECT id FROM fee_structures WHERE academic_year = ? AND admission_category = ? AND year_of_study = ? LIMIT 1`,
        [targetYear, targetCat, targetStudyYear]
      );
      if (existingRows && existingRows.length > 0) {
        structureId = existingRows[0].id;
      }
    }

    if (structureId) {
      // Update existing fee structure
      await connection.query(
        `UPDATE fee_structures
         SET academic_year = ?, admission_category = ?, year_of_study = ?, college_fee = ?, development_fee = ?, mess_fee = ?, hostel_fee = ?, total_annual_fee = ?, description = ?, is_active = ?, updated_at = NOW()
         WHERE id = ?`,
        [targetYear, targetCat, targetStudyYear, colFee, devFee, mFee, hFee, totalAnnual, description || '', isActive !== false, structureId]
      );
    } else {
      // Insert new structure
      const [insertResult] = await connection.query<any>(
        `INSERT INTO fee_structures
          (academic_year, admission_category, year_of_study, college_fee, development_fee, mess_fee, hostel_fee, total_annual_fee, description, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          targetYear,
          targetCat,
          targetStudyYear,
          colFee,
          devFee,
          mFee,
          hFee,
          totalAnnual,
          description || '',
          isActive !== false,
        ]
      );
      structureId = insertResult.insertId;
    }

    // Historical Protection & Bulk Changes:
    // If scope is 'SELECTED_BATCH' or 'SELECTED_STUDENTS', apply revisions with audit
    let affectedCount = 0;
    if (scope === 'SELECTED_BATCH' && reason) {
      const [studentsToUpdate] = await connection.query<any[]>(
        `SELECT s.id, sfa.id AS assessment_id, sfa.total_assessed_fee, sfa.assessed_mess_fee, sfa.assessed_hostel_fee, sfa.concession_total
         FROM students s
         JOIN student_fee_assessments sfa ON s.id = sfa.student_id AND sfa.academic_year = ?
         WHERE s.admission_category = ?`,
        [targetYear, targetCat]
      );

      for (const st of studentsToUpdate) {
        const newTotal = colFee + devFee + parseFloat(st.assessed_mess_fee || 0) + parseFloat(st.assessed_hostel_fee || 0);
        const concession = parseFloat(st.concession_total || 0);
        const revised = Math.max(0, newTotal - concession);

        await connection.query(
          `UPDATE student_fee_assessments
           SET assessed_college_fee = ?, assessed_development_fee = ?, total_assessed_fee = ?, revised_payable = ?, notes = ?
           WHERE id = ?`,
          [colFee, devFee, newTotal, revised, `Bulk batch update: ${reason.trim()}`, st.assessment_id]
        );
        affectedCount++;
      }
    } else if (scope === 'SELECTED_STUDENTS' && Array.isArray(targetStudentIds) && targetStudentIds.length > 0 && reason) {
      for (const sId of targetStudentIds) {
        const [assessRows] = await connection.query<any[]>(
          `SELECT id, assessed_mess_fee, assessed_hostel_fee, concession_total
           FROM student_fee_assessments
           WHERE student_id = ? AND academic_year = ? LIMIT 1`,
          [sId, targetYear]
        );
        if (assessRows && assessRows.length > 0) {
          const a = assessRows[0];
          const newTotal = colFee + devFee + parseFloat(a.assessed_mess_fee || 0) + parseFloat(a.assessed_hostel_fee || 0);
          const concession = parseFloat(a.concession_total || 0);
          const revised = Math.max(0, newTotal - concession);

          await connection.query(
            `UPDATE student_fee_assessments
             SET assessed_college_fee = ?, assessed_development_fee = ?, total_assessed_fee = ?, revised_payable = ?, notes = ?
             WHERE id = ?`,
            [colFee, devFee, newTotal, revised, `Selective update: ${reason.trim()}`, a.id]
          );
          affectedCount++;
        }
      }
    }

    await recordAuditLog({
      actorId: req.user!.id,
      action: id ? 'FEE_STRUCTURE_UPDATED' : 'FEE_STRUCTURE_CREATED',
      targetType: 'FEE_STRUCTURE',
      targetId: String(structureId),
      ipAddress: req.ip || null,
      details: {
        academicYear: targetYear,
        admissionCategory: targetCat,
        collegeFee: colFee,
        developmentFee: devFee,
        totalAnnual,
        scope: scope || 'FUTURE_ONLY',
        affectedCount,
        reason: reason ? String(reason).trim() : null,
      },
    });

    await connection.commit();

    res.json({
      success: true,
      message: `Fee structure ${id ? 'updated' : 'saved'} successfully. ${affectedCount > 0 ? `${affectedCount} student assessment(s) updated.` : 'Applies to future admissions.'}`,
      structureId,
    });
  } catch (err) {
    await connection.rollback();
    console.error('[KAMCH Fees] Error saving fee structure:', (err as Error).message);
    res.status(500).json({ error: (err as Error).message || 'Failed to save fee structure', code: 'DATABASE_ERROR' });
  } finally {
    connection.release();
  }
});

/**
 * GET /api/fees/stats
 * Overview analytics for assessed, collected, outstanding amounts, and pending bank transfers.
 */
feesRouter.get('/stats', requireRoles('SUPER_ADMIN', 'PRINCIPAL', 'SECRETARY', 'OFFICE', 'STAFF'), async (_req: Request, res: Response): Promise<void> => {
  try {
    const pool = getPool();

    // Total Assessed & Revised Payable
    const [assessedRows] = await pool.query<any[]>(
      'SELECT COALESCE(SUM(revised_payable), COALESCE(SUM(total_assessed_fee), 0)) AS total_assessed FROM student_fee_assessments'
    );
    const totalAssessed = parseFloat(assessedRows[0]?.total_assessed || '0');

    // Total Verified Collected
    const [collectedRows] = await pool.query<any[]>(
      "SELECT COALESCE(SUM(amount), 0) AS total_collected FROM fee_payments WHERE status = 'VERIFIED'"
    );
    const totalCollected = parseFloat(collectedRows[0]?.total_collected || '0');

    // Total Pending Bank Transfers (awaiting verification)
    const [pendingRows] = await pool.query<any[]>(
      "SELECT COALESCE(SUM(amount), 0) AS total_pending, COUNT(*) AS pending_count FROM fee_payments WHERE status = 'PENDING_VERIFICATION'"
    );
    const totalPending = parseFloat(pendingRows[0]?.total_pending || '0');
    const pendingTransfersCount = parseInt(pendingRows[0]?.pending_count || '0', 10);

    // Outstanding Balance is strictly: totalAssessed - totalCollected
    const totalOutstanding = Math.max(0, totalAssessed - totalCollected);

    // Total Students
    const [studentsCountRows] = await pool.query<any[]>(
      "SELECT COUNT(*) AS student_count FROM students WHERE status = 'ACTIVE'"
    );
    const studentCount = parseInt(studentsCountRows[0]?.student_count || '0', 10);

    res.json({
      totalAssessed,
      totalCollected,
      totalPending,
      totalOutstanding,
      pendingTransfersCount,
      studentCount,
      currency: 'INR',
    });
  } catch (err) {
    console.error('[KAMCH Fees] Error fetching fee statistics:', (err as Error).message);
    res.status(500).json({ error: 'Failed to retrieve statistics', code: 'DATABASE_ERROR' });
  }
});

/**
 * GET /api/fees/students
 * Lists students and their fee summaries. Starts EMPTY by specification!
 */
feesRouter.get('/students', requireRoles('SUPER_ADMIN', 'PRINCIPAL', 'SECRETARY', 'OFFICE', 'STAFF'), async (req: Request, res: Response): Promise<void> => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const categoryFilter = typeof req.query.category === 'string' ? req.query.category.trim() : '';

  try {
    const pool = getPool();
    const whereClauses: string[] = [];
    const queryParams: any[] = [];

    if (search) {
      whereClauses.push(
        '(s.student_id_number LIKE ? OR s.temporary_roll_number LIKE ? OR s.permanent_university_number LIKE ? OR s.full_name LIKE ?)'
      );
      const pattern = `%${search}%`;
      queryParams.push(pattern, pattern, pattern, pattern);
    }

    if (categoryFilter && ['GOVERNMENT', 'MANAGEMENT_PRIVATE', 'NRI'].includes(categoryFilter)) {
      whereClauses.push('s.admission_category = ?');
      queryParams.push(categoryFilter);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [rows] = await pool.query<any[]>(
      `SELECT 
        s.id,
        s.student_id_number,
        s.temporary_roll_number,
        s.permanent_university_number,
        s.university_reg_status,
        s.full_name,
        s.admission_category,
        s.admission_year,
        s.current_year_of_study,
        s.is_kea_eligible,
        s.kea_acknowledgement_no,
        s.mess_enrolled,
        s.hostel_enrolled,
        s.status,
        s.created_at,
        sfa.id AS current_assessment_id,
        sfa.academic_year,
        sfa.is_kea_exception_applied,
        sfa.kea_exception_reason,
        sfa.assessed_college_fee,
        sfa.assessed_development_fee,
        sfa.assessed_mess_fee,
        sfa.assessed_hostel_fee,
        sfa.total_assessed_fee,
        sfa.concession_total,
        sfa.revised_payable,
        COALESCE(payments.total_paid, 0) AS total_paid,
        COALESCE(pending.total_pending, 0) AS total_pending
       FROM students s
       LEFT JOIN student_fee_assessments sfa ON s.id = sfa.student_id AND sfa.academic_year = '2026-2027'
       LEFT JOIN (
         SELECT student_id, SUM(amount) AS total_paid
         FROM fee_payments
         WHERE status = 'VERIFIED'
         GROUP BY student_id
       ) payments ON s.id = payments.student_id
       LEFT JOIN (
         SELECT student_id, SUM(amount) AS total_pending
         FROM fee_payments
         WHERE status = 'PENDING_VERIFICATION'
         GROUP BY student_id
       ) pending ON s.id = pending.student_id
       ${whereSql}
       ORDER BY s.id DESC`,
      queryParams
    );

    res.json({
      students: rows.map((r) => {
        const totalAssessed = parseFloat(r.total_assessed_fee || '0');
        const concessionTotal = parseFloat(r.concession_total || '0');
        const revisedPayable = parseFloat(r.revised_payable || String(totalAssessed - concessionTotal));
        const totalPaid = parseFloat(r.total_paid || '0');
        const totalPending = parseFloat(r.total_pending || '0');
        const outstandingBalance = Math.max(0, revisedPayable - totalPaid);

        return {
          id: r.id,
          studentIdNumber: r.student_id_number,
          temporaryRollNumber: r.temporary_roll_number || r.student_id_number,
          permanentUniversityNumber: r.permanent_university_number || null,
          universityRegStatus: r.university_reg_status || 'NOT_ENTERED',
          fullName: r.full_name,
          admissionCategory: r.admission_category,
          admissionYear: r.admission_year,
          currentYearOfStudy: r.current_year_of_study,
          isKeaEligible: Boolean(r.is_kea_eligible),
          keaAcknowledgementNo: r.kea_acknowledgement_no,
          messEnrolled: Boolean(r.mess_enrolled),
          hostelEnrolled: Boolean(r.hostel_enrolled),
          status: r.status,
          currentAssessment: r.current_assessment_id
            ? {
                id: r.current_assessment_id,
                academicYear: r.academic_year,
                isKeaExceptionApplied: Boolean(r.is_kea_exception_applied),
                keaExceptionReason: r.kea_exception_reason,
                assessedCollegeFee: parseFloat(r.assessed_college_fee || '0'),
                assessedDevelopmentFee: parseFloat(r.assessed_development_fee || '0'),
                assessedMessFee: parseFloat(r.assessed_mess_fee || '0'),
                assessedHostelFee: parseFloat(r.assessed_hostel_fee || '0'),
                totalAssessedFee: totalAssessed,
                concessionTotal,
                revisedPayable,
              }
            : null,
          totalPaid,
          totalPending,
          outstandingBalance,
        };
      }),
    });
  } catch (err) {
    console.error('[KAMCH Fees] Error listing students:', (err as Error).message);
    res.status(500).json({ error: 'Failed to retrieve students', code: 'DATABASE_ERROR' });
  }
});

/**
 * POST /api/fees/students
 * Independent student creation in Fees Management is disabled.
 * Student Management (/api/students) is the single source of truth for student registration.
 */
feesRouter.post(
  '/students',
  requireRoles('SUPER_ADMIN', 'PRINCIPAL', 'SECRETARY', 'OFFICE', 'STAFF'),
  validateCsrf,
  async (_req: Request, res: Response): Promise<void> => {
    res.status(400).json({
      error:
        'Student Management is the single source of truth for student registration. Register the student in Student Management first, then select the existing student in Fees Management.',
      code: 'STUDENT_REGISTRATION_MOVED_TO_STUDENT_MANAGEMENT',
    });
  }
);

/**
 * POST /api/fees/students/:id/initialize-assessment
 * Initializes a 2026-2027 fee assessment (and optional initial Mess/Hostel enrollment)
 * strictly for an EXISTING student in the shared `students` registry by stable primary key `id`.
 * Never creates a new student row.
 */
feesRouter.post(
  '/students/:id/initialize-assessment',
  requireRoles('SUPER_ADMIN', 'PRINCIPAL', 'SECRETARY', 'OFFICE', 'STAFF'),
  validateCsrf,
  async (req: Request, res: Response): Promise<void> => {
    const studentId = parseInt(req.params.id, 10);
    if (!studentId || isNaN(studentId)) {
      res.status(400).json({ error: 'Invalid student ID', code: 'INVALID_ID' });
      return;
    }

    const { messEnrolled, hostelEnrolled } = req.body || {};
    const isMess = Boolean(messEnrolled);
    const isHostel = Boolean(hostelEnrolled);

    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [studentRows] = await connection.query<any[]>(
        'SELECT * FROM students WHERE id = ? LIMIT 1',
        [studentId]
      );
      if (!studentRows || studentRows.length === 0) {
        await connection.rollback();
        res.status(404).json({
          error: 'Student record not found in Student Management registry.',
          code: 'STUDENT_NOT_FOUND',
        });
        return;
      }

      const student = studentRows[0];

      const [existingAssessments] = await connection.query<any[]>(
        'SELECT * FROM student_fee_assessments WHERE student_id = ?',
        [studentId]
      );
      const hasCurrentYear = (existingAssessments || []).some(
        (a: any) => String(a.academic_year) === '2026-2027'
      );
      if (hasCurrentYear) {
        await connection.rollback();
        res.status(409).json({
          error: 'An active 2026-2027 fee assessment already exists for this student.',
          code: 'ASSESSMENT_ALREADY_EXISTS',
        });
        return;
      }

      const validCategory = (student.admission_category || 'GOVERNMENT') as
        | 'GOVERNMENT'
        | 'MANAGEMENT_PRIVATE'
        | 'NRI';
      const yearOfStudy = Number(student.current_year_of_study || 1);

      const [structRows] = await connection.query<any[]>(
        `SELECT college_fee, development_fee, mess_fee, hostel_fee, total_annual_fee
         FROM fee_structures
         WHERE academic_year = '2026-2027' AND admission_category = ?
         LIMIT 1`,
        [validCategory]
      );

      let collegeFee = 75750.0;
      let devFee = 50000.0;
      let structMessFee = 30000.0;
      let structHostelFee = 30000.0;

      if (structRows && structRows.length > 0) {
        collegeFee = parseFloat(structRows[0].college_fee);
        devFee = parseFloat(structRows[0].development_fee);
        structMessFee = parseFloat(structRows[0].mess_fee || '30000');
        structHostelFee = parseFloat(structRows[0].hostel_fee || '30000');
      } else if (validCategory === 'MANAGEMENT_PRIVATE') {
        collegeFee = 400000.0;
        devFee = 0.0;
      } else if (validCategory === 'NRI') {
        collegeFee = 600000.0;
        devFee = 0.0;
      }

      const assessedMess = isMess ? structMessFee : 0.0;
      const assessedHostel = isHostel ? structHostelFee : 0.0;
      const totalAssessed = collegeFee + devFee + assessedMess + assessedHostel;

      const [assessmentResult] = await connection.query<any>(
        `INSERT INTO student_fee_assessments 
          (student_id, academic_year, year_of_study, admission_category, is_kea_exception_applied, kea_exception_reason, assessed_college_fee, assessed_development_fee, assessed_mess_fee, assessed_hostel_fee, total_assessed_fee, concession_total, revised_payable, notes, assessed_by)
         VALUES (?, '2026-2027', ?, ?, FALSE, NULL, ?, ?, ?, ?, ?, 0.00, ?, 'Initial Assessment', ?)`,
        [
          studentId,
          yearOfStudy,
          validCategory,
          collegeFee,
          devFee,
          assessedMess,
          assessedHostel,
          totalAssessed,
          totalAssessed,
          req.user!.id,
        ]
      );

      const today = new Date().toISOString().split('T')[0];
      if (isMess) {
        await connection.query('UPDATE students SET mess_enrolled = TRUE WHERE id = ?', [studentId]);
        await connection.query(
          `INSERT INTO service_enrollments (student_id, service_type, start_date, annual_fee, status, created_by, notes)
           VALUES (?, 'MESS', ?, ?, 'ACTIVE', ?, 'Enrolled at fee assessment initialization')`,
          [studentId, today, structMessFee, req.user!.id]
        );
      }
      if (isHostel) {
        await connection.query('UPDATE students SET hostel_enrolled = TRUE WHERE id = ?', [studentId]);
        await connection.query(
          `INSERT INTO service_enrollments (student_id, service_type, start_date, annual_fee, status, created_by, notes)
           VALUES (?, 'HOSTEL', ?, ?, 'ACTIVE', ?, 'Enrolled at fee assessment initialization')`,
          [studentId, today, structHostelFee, req.user!.id]
        );
      }

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'FEE_ASSESSMENT_INITIALIZED_FOR_EXISTING_STUDENT',
        targetType: 'STUDENT',
        targetId: String(studentId),
        ipAddress: req.ip || null,
        details: {
          assessmentId: assessmentResult.insertId,
          studentIdNumber: student.student_id_number,
          fullName: student.full_name,
          category: validCategory,
          totalAssessed,
          isMess,
          isHostel,
        },
      });

      await connection.commit();

      res.status(201).json({
        success: true,
        message: `Fee assessment of ₹${totalAssessed.toLocaleString('en-IN')} initialized for ${student.full_name} (${student.student_id_number}).`,
        assessmentId: assessmentResult.insertId,
        student: {
          id: Number(student.id),
          studentIdNumber: student.student_id_number,
          fullName: student.full_name,
        },
      });
    } catch (err) {
      await connection.rollback();
      console.error('[KAMCH Fees] Error initializing assessment for student:', (err as Error).message);
      res.status(500).json({ error: 'Failed to initialize fee assessment', code: 'DATABASE_ERROR' });
    } finally {
      connection.release();
    }
  }
);

/**
 * GET /api/fees/students/:id
 * Detailed student fee account: full ledger, breakdown, mess/hostel enrollment history, concessions, and payments.
 */
feesRouter.get('/students/:id', requireRoles('SUPER_ADMIN', 'PRINCIPAL', 'SECRETARY', 'OFFICE', 'STAFF'), async (req: Request, res: Response): Promise<void> => {
  const studentId = parseInt(req.params.id, 10);
  if (!studentId || isNaN(studentId)) {
    res.status(400).json({ error: 'Invalid student ID', code: 'INVALID_ID' });
    return;
  }

  try {
    const pool = getPool();

    // 1. Student identity
    const [studentRows] = await pool.query<any[]>(
      'SELECT * FROM students WHERE id = ? LIMIT 1',
      [studentId]
    );

    if (!studentRows || studentRows.length === 0) {
      res.status(404).json({ error: 'Student not found', code: 'STUDENT_NOT_FOUND' });
      return;
    }

    const student = studentRows[0];

    // 2. Assessments
    const [assessments] = await pool.query<any[]>(
      `SELECT sfa.*, u.full_name AS assessor_name 
       FROM student_fee_assessments sfa
       JOIN users u ON sfa.assessed_by = u.id
       WHERE sfa.student_id = ?
       ORDER BY sfa.id DESC`,
      [studentId]
    );

    // 3. Service enrollments (Mess & Hostel history)
    const [serviceRows] = await pool.query<any[]>(
      `SELECT se.*, u.full_name AS creator_name
       FROM service_enrollments se
       JOIN users u ON se.created_by = u.id
       WHERE se.student_id = ?
       ORDER BY se.id DESC`,
      [studentId]
    );

    // 4. Concessions
    const [concessionRows] = await pool.query<any[]>(
      `SELECT fc.*, u.full_name AS authorizer_name
       FROM fee_concessions fc
       JOIN users u ON fc.authorized_by = u.id
       WHERE fc.student_id = ?
       ORDER BY fc.id DESC`,
      [studentId]
    );

    // 5. Payments with Receipts
    const [payments] = await pool.query<any[]>(
      `SELECT 
        fp.*, 
        recorder.full_name AS recorder_name,
        verifier.full_name AS verifier_name,
        reverser.full_name AS reverser_name,
        fr.id AS receipt_id,
        fr.receipt_number,
        fr.receipt_type,
        fr.status AS receipt_status
       FROM fee_payments fp
       JOIN users recorder ON fp.recorded_by = recorder.id
       LEFT JOIN users verifier ON fp.verified_by = verifier.id
       LEFT JOIN users reverser ON fp.reversed_by = reverser.id
       LEFT JOIN fee_receipts fr ON fp.id = fr.payment_id
       WHERE fp.student_id = ?
       ORDER BY fp.id DESC`,
      [studentId]
    );

    const totalAssessed = assessments.reduce((sum, a) => sum + parseFloat(a.total_assessed_fee || '0'), 0);
    const concessionTotal = concessionsCalc(concessionRows);
    const revisedPayable = assessments.reduce((sum, a) => sum + parseFloat(a.revised_payable || a.total_assessed_fee || '0'), 0);

    const verifiedPaid = payments
      .filter((p) => p.status === 'VERIFIED')
      .reduce((sum, p) => sum + parseFloat(p.amount), 0);

    const pendingTransfers = payments
      .filter((p) => p.status === 'PENDING_VERIFICATION')
      .reduce((sum, p) => sum + parseFloat(p.amount), 0);

    const outstandingBalance = Math.max(0, revisedPayable - verifiedPaid);

    res.json({
      student: {
        id: student.id,
        studentIdNumber: student.student_id_number,
        fullName: student.full_name,
        admissionCategory: student.admission_category,
        admissionYear: student.admission_year,
        currentYearOfStudy: student.current_year_of_study,
        isKeaEligible: Boolean(student.is_kea_eligible),
        keaAcknowledgementNo: student.kea_acknowledgement_no,
        messEnrolled: Boolean(student.mess_enrolled),
        hostelEnrolled: Boolean(student.hostel_enrolled),
        contactPhone: student.contact_phone,
        contactEmail: student.contact_email,
        status: student.status,
      },
      assessments: assessments.map((a) => ({
        id: a.id,
        academicYear: a.academic_year,
        yearOfStudy: a.year_of_study,
        admissionCategory: a.admission_category,
        isKeaExceptionApplied: Boolean(a.is_kea_exception_applied),
        keaExceptionReason: a.kea_exception_reason,
        assessedCollegeFee: parseFloat(a.assessed_college_fee || '0'),
        assessedDevelopmentFee: parseFloat(a.assessed_development_fee || '0'),
        assessedMessFee: parseFloat(a.assessed_mess_fee || '0'),
        assessedHostelFee: parseFloat(a.assessed_hostel_fee || '0'),
        totalAssessedFee: parseFloat(a.total_assessed_fee || '0'),
        concessionTotal: parseFloat(a.concession_total || '0'),
        revisedPayable: parseFloat(a.revised_payable || a.total_assessed_fee || '0'),
        notes: a.notes,
        assessorName: a.assessor_name,
        createdAt: a.created_at,
      })),
      serviceEnrollments: serviceRows.map((se) => ({
        id: se.id,
        serviceType: se.service_type,
        startDate: se.start_date,
        endDate: se.end_date,
        annualFee: parseFloat(se.annual_fee || '0'),
        status: se.status,
        notes: se.notes,
        creatorName: se.creator_name,
        createdAt: se.created_at,
      })),
      concessions: concessionRows.map((c) => ({
        id: c.id,
        feeComponent: c.fee_component,
        concessionType: c.concession_type,
        value: parseFloat(c.value || '0'),
        calculatedReduction: parseFloat(c.calculated_reduction || '0'),
        reason: c.reason,
        authorizerName: c.authorizer_name,
        createdAt: c.created_at,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        assessmentId: p.assessment_id,
        paymentReference: p.payment_reference,
        amount: parseFloat(p.amount),
        destination: p.destination || 'COLLEGE_ACCOUNT',
        paymentMethod: p.payment_method,
        studentTxRef: p.student_tx_ref,
        passbookTxRef: p.passbook_tx_ref,
        bankName: p.bank_name,
        paymentDate: p.payment_date,
        recorderName: p.recorder_name,
        verifierName: p.verifier_name,
        reverserName: p.reverser_name,
        notes: p.notes,
        status: p.status,
        rejectionReason: p.rejection_reason,
        reversalReason: p.reversal_reason,
        receipt: p.receipt_id
          ? {
              id: p.receipt_id,
              receiptNumber: p.receipt_number,
              receiptType: p.receipt_type,
              status: p.receipt_status,
            }
          : null,
      })),
      summary: {
        totalAssessed,
        concessionTotal,
        revisedPayable,
        verifiedPaid,
        pendingTransfers,
        outstandingBalance,
      },
    });
  } catch (err) {
    console.error('[KAMCH Fees] Error fetching student fee account:', (err as Error).message);
    res.status(500).json({ error: 'Failed to retrieve fee account details', code: 'DATABASE_ERROR' });
  }
});

function concessionsCalc(rows: any[]): number {
  return rows.reduce((sum, c) => sum + parseFloat(c.calculated_reduction || '0'), 0);
}

/**
 * POST /api/fees/students/:id/services
 * Manage Mess and Hostel Enrollment (Join or Leave).
 * Preserves historical assessments and records.
 */
feesRouter.post('/students/:id/services', requireRoles('SUPER_ADMIN', 'PRINCIPAL', 'SECRETARY', 'OFFICE', 'STAFF'), validateCsrf, async (req: Request, res: Response): Promise<void> => {
  const studentId = parseInt(req.params.id, 10);
  const { serviceType, action, effectiveDate, annualFee, notes } = req.body || {};

  if (!['MESS', 'HOSTEL'].includes(serviceType) || !['JOIN', 'LEAVE'].includes(action)) {
    res.status(400).json({ error: 'Invalid serviceType or action', code: 'INVALID_PARAMETERS' });
    return;
  }

  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [students] = await connection.query<any[]>(
      'SELECT id, mess_enrolled, hostel_enrolled FROM students WHERE id = ? LIMIT 1 FOR UPDATE',
      [studentId]
    );

    if (!students || students.length === 0) {
      await connection.rollback();
      res.status(404).json({ error: 'Student not found', code: 'STUDENT_NOT_FOUND' });
      return;
    }

    const s = students[0];
    const isMess = serviceType === 'MESS';
    const currentFlag = isMess ? Boolean(s.mess_enrolled) : Boolean(s.hostel_enrolled);
    const dateStr = effectiveDate || new Date().toISOString().split('T')[0];

    // Find active assessment
    const [assessments] = await connection.query<any[]>(
      "SELECT * FROM student_fee_assessments WHERE student_id = ? AND academic_year = '2026-2027' LIMIT 1 FOR UPDATE",
      [studentId]
    );

    if (!assessments || assessments.length === 0) {
      await connection.rollback();
      res.status(404).json({ error: 'Active assessment not found for student', code: 'NO_ASSESSMENT' });
      return;
    }

    const a = assessments[0];
    const feeAmount = parseFloat(annualFee || '30000');

    if (action === 'JOIN') {
      if (currentFlag) {
        await connection.rollback();
        res.status(400).json({ error: `Student is already enrolled in ${serviceType}`, code: 'ALREADY_ENROLLED' });
        return;
      }

      // Add enrollment record
      await connection.query(
        `INSERT INTO service_enrollments (student_id, service_type, start_date, annual_fee, status, created_by, notes)
         VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)`,
        [studentId, serviceType, dateStr, feeAmount, req.user!.id, notes || `Enrolled on ${dateStr}`]
      );

      // Update student flag
      const flagCol = isMess ? 'mess_enrolled' : 'hostel_enrolled';
      await connection.query(`UPDATE students SET ${flagCol} = TRUE WHERE id = ?`, [studentId]);

      // Update assessment
      const currentMess = parseFloat(a.assessed_mess_fee || '0');
      const currentHostel = parseFloat(a.assessed_hostel_fee || '0');
      const newMess = isMess ? feeAmount : currentMess;
      const newHostel = !isMess ? feeAmount : currentHostel;
      const newTotal = parseFloat(a.assessed_college_fee) + parseFloat(a.assessed_development_fee) + newMess + newHostel;
      const revised = Math.max(0, newTotal - parseFloat(a.concession_total || '0'));

      await connection.query(
        `UPDATE student_fee_assessments
         SET assessed_mess_fee = ?, assessed_hostel_fee = ?, total_assessed_fee = ?, revised_payable = ?
         WHERE id = ?`,
        [newMess, newHostel, newTotal, revised, a.id]
      );
    } else {
      // LEAVE action
      if (!currentFlag) {
        await connection.rollback();
        res.status(400).json({ error: `Student is not currently enrolled in ${serviceType}`, code: 'NOT_ENROLLED' });
        return;
      }

      // Complete active enrollment record
      await connection.query(
        `UPDATE service_enrollments
         SET end_date = ?, status = 'COMPLETED', notes = CONCAT(COALESCE(notes, ''), ' [Completed: ', ?, ']')
         WHERE student_id = ? AND service_type = ? AND status = 'ACTIVE'`,
        [dateStr, notes || 'Left service', studentId, serviceType]
      );

      // Update student flag
      const flagCol = isMess ? 'mess_enrolled' : 'hostel_enrolled';
      await connection.query(`UPDATE students SET ${flagCol} = FALSE WHERE id = ?`, [studentId]);

      // Preserving historical assessed amounts per Section 7 billing rules
    }

    await recordAuditLog({
      actorId: req.user!.id,
      action: action === 'JOIN' ? 'SERVICE_ENROLLED' : 'SERVICE_LEFT',
      targetType: 'STUDENT',
      targetId: String(studentId),
      ipAddress: req.ip || null,
      details: { serviceType, action, effectiveDate: dateStr, feeAmount },
    });

    await connection.commit();

    res.json({
      success: true,
      message: `Successfully updated ${serviceType} enrollment for student.`,
    });
  } catch (err) {
    await connection.rollback();
    console.error('[KAMCH Fees] Error managing service enrollment:', (err as Error).message);
    res.status(500).json({ error: 'Failed to update service enrollment', code: 'DATABASE_ERROR' });
  } finally {
    connection.release();
  }
});

/**
 * POST /api/fees/concessions
 * Authorized Concession creation: Super Admin & Principal ONLY.
 * Office staff are strictly blocked!
 */
feesRouter.post('/concessions', requireRoles('SUPER_ADMIN', 'PRINCIPAL'), validateCsrf, async (req: Request, res: Response): Promise<void> => {
  const { studentId, assessmentId, concessionType, value, reason, feeComponent } = req.body || {};

  const sId = parseInt(studentId, 10);
  const aId = parseInt(assessmentId, 10);
  const numValue = parseFloat(value);
  const cType = String(concessionType).toUpperCase();
  const validReason = String(reason || '').trim();

  if (!sId || !aId || isNaN(numValue) || numValue <= 0 || !validReason) {
    res.status(400).json({
      error: 'Student, Assessment, positive Concession Value, and mandatory Reason are required.',
      code: 'INVALID_CONCESSION_DATA',
    });
    return;
  }

  if (!['FIXED', 'PERCENTAGE'].includes(cType)) {
    res.status(400).json({ error: 'Concession type must be FIXED or PERCENTAGE', code: 'INVALID_TYPE' });
    return;
  }

  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [assessments] = await connection.query<any[]>(
      'SELECT * FROM student_fee_assessments WHERE id = ? AND student_id = ? LIMIT 1 FOR UPDATE',
      [aId, sId]
    );

    if (!assessments || assessments.length === 0) {
      await connection.rollback();
      res.status(404).json({ error: 'Assessment not found for student', code: 'NO_ASSESSMENT' });
      return;
    }

    const a = assessments[0];
    const totalAssessed = parseFloat(a.total_assessed_fee);
    const existingConcessions = parseFloat(a.concession_total || '0');

    let calculatedReduction = 0;
    if (cType === 'FIXED') {
      calculatedReduction = numValue;
    } else {
      calculatedReduction = (totalAssessed * numValue) / 100;
    }

    const newConcessionTotal = existingConcessions + calculatedReduction;

    // Strict Rule: Non-negative payable validation!
    if (newConcessionTotal > totalAssessed) {
      await connection.rollback();
      res.status(400).json({
        error: `Concession of ₹${calculatedReduction.toLocaleString('en-IN')} would make payable fee negative. Maximum permissible concession is ₹${(totalAssessed - existingConcessions).toLocaleString('en-IN')}.`,
        code: 'EXCEEDS_ASSESSED_FEE',
      });
      return;
    }

    const newRevisedPayable = totalAssessed - newConcessionTotal;

    // Insert into concessions table
    const [concessionResult] = await connection.query<any>(
      `INSERT INTO fee_concessions 
        (student_id, assessment_id, fee_component, concession_type, value, calculated_reduction, reason, authorized_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sId,
        aId,
        feeComponent || 'ALL',
        cType,
        numValue,
        calculatedReduction,
        validReason,
        req.user!.id,
      ]
    );

    // Update assessment
    await connection.query(
      `UPDATE student_fee_assessments
       SET concession_total = ?, revised_payable = ?, notes = CONCAT(COALESCE(notes, ''), ' [Concession applied: ₹', ?, ']')
       WHERE id = ?`,
      [newConcessionTotal, newRevisedPayable, calculatedReduction, aId]
    );

    await recordAuditLog({
      actorId: req.user!.id,
      action: 'FEE_CONCESSION_GRANTED',
      targetType: 'STUDENT',
      targetId: String(sId),
      ipAddress: req.ip || null,
      details: {
        assessmentId: aId,
        concessionId: concessionResult.insertId,
        type: cType,
        value: numValue,
        calculatedReduction,
        reason: validReason,
        originalAssessed: totalAssessed,
        revisedPayable: newRevisedPayable,
      },
    });

    await connection.commit();

    res.status(201).json({
      success: true,
      message: `Concession of ₹${calculatedReduction.toLocaleString('en-IN')} granted. Revised payable: ₹${newRevisedPayable.toLocaleString('en-IN')}.`,
      revisedPayable: newRevisedPayable,
    });
  } catch (err) {
    await connection.rollback();
    console.error('[KAMCH Fees] Error granting concession:', (err as Error).message);
    res.status(500).json({ error: 'Failed to record concession', code: 'DATABASE_ERROR' });
  } finally {
    connection.release();
  }
});

/**
 * POST /api/fees/payments
 * Record payment (College Cash, College Bank Transfer, or Secretary Dev Fee).
 * Cash payments generate immediate receipt and reduce balance.
 * Bank transfers generate Provisional Acknowledgement and remain Pending Verification.
 */
feesRouter.post('/payments', requireRoles('SUPER_ADMIN', 'PRINCIPAL', 'SECRETARY', 'OFFICE', 'STAFF'), validateCsrf, async (req: Request, res: Response): Promise<void> => {
  const {
    studentId,
    assessmentId,
    amount,
    destination, // 'COLLEGE_ACCOUNT' | 'SECRETARY_DEV_ACCOUNT'
    paymentMethod, // 'CASH' | 'BANK_TRANSFER' | 'ONLINE_DEV'
    studentTxRef,
    bankName,
    paymentDate,
    notes,
  } = req.body || {};

  const sId = parseInt(studentId, 10);
  const aId = parseInt(assessmentId, 10);
  const payAmount = parseFloat(amount);
  const targetDestination = (destination === 'SECRETARY_DEV_ACCOUNT' ? 'SECRETARY_DEV_ACCOUNT' : 'COLLEGE_ACCOUNT') as 'COLLEGE_ACCOUNT' | 'SECRETARY_DEV_ACCOUNT';
  const method = String(paymentMethod).toUpperCase() as 'CASH' | 'BANK_TRANSFER' | 'ONLINE_DEV';
  const dateStr = paymentDate || new Date().toISOString().split('T')[0];

  if (!sId || !aId || isNaN(payAmount) || payAmount <= 0) {
    res.status(400).json({ error: 'Valid Student, Assessment, and positive payment amount are required.', code: 'INVALID_AMOUNT' });
    return;
  }

  if (method === 'BANK_TRANSFER' && !studentTxRef) {
    res.status(400).json({ error: 'Student bank transaction reference (UTR / Ref Number) is mandatory for bank transfers.', code: 'MISSING_TX_REF' });
    return;
  }

  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Check student & assessment
    const [assessments] = await connection.query<any[]>(
      `SELECT sfa.*, s.student_id_number, s.full_name, s.admission_category
       FROM student_fee_assessments sfa
       JOIN students s ON sfa.student_id = s.id
       WHERE sfa.id = ? AND sfa.student_id = ? LIMIT 1 FOR UPDATE`,
      [aId, sId]
    );

    if (!assessments || assessments.length === 0) {
      await connection.rollback();
      res.status(404).json({ error: 'Assessment not found', code: 'NO_ASSESSMENT' });
      return;
    }

    const a = assessments[0];
    const revisedPayable = parseFloat(a.revised_payable || a.total_assessed_fee);

    // Calculate existing verified payments
    const [existingPayments] = await connection.query<any[]>(
      "SELECT COALESCE(SUM(amount), 0) AS total_paid FROM fee_payments WHERE student_id = ? AND status = 'VERIFIED'",
      [sId]
    );
    const totalPaid = parseFloat(existingPayments[0]?.total_paid || '0');
    const outstanding = Math.max(0, revisedPayable - totalPaid);

    // Guard against overpayment
    if (payAmount > outstanding) {
      await connection.rollback();
      res.status(400).json({
        error: `Payment amount ₹${payAmount.toLocaleString('en-IN')} exceeds the outstanding balance of ₹${outstanding.toLocaleString('en-IN')}.`,
        code: 'EXCEEDS_BALANCE',
      });
      return;
    }

    // Duplicate transaction reference check for bank transfers
    if (studentTxRef) {
      const [duplicateTx] = await connection.query<any[]>(
        "SELECT id, payment_reference FROM fee_payments WHERE student_tx_ref = ? AND status != 'REVERSED' LIMIT 1",
        [String(studentTxRef).trim()]
      );
      if (duplicateTx && duplicateTx.length > 0) {
        await connection.rollback();
        res.status(409).json({
          error: `Transaction reference '${studentTxRef}' has already been recorded under payment ${duplicateTx[0].payment_reference}.`,
          code: 'DUPLICATE_TX_REF',
        });
        return;
      }
    }

    // Unique payment reference
    const paymentRef = `PAY-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    // Determine initial status & receipt workflow:
    // Cash collections are VERIFIED immediately.
    // Bank transfers are PENDING_VERIFICATION until next-morning passbook check.
    const isPending = method === 'BANK_TRANSFER' || (method === 'ONLINE_DEV' && targetDestination === 'SECRETARY_DEV_ACCOUNT');
    const paymentStatus = isPending ? 'PENDING_VERIFICATION' : 'VERIFIED';

    const [paymentResult] = await connection.query<any>(
      `INSERT INTO fee_payments 
        (assessment_id, student_id, payment_reference, amount, destination, payment_method, bank_transaction_ref, student_tx_ref, bank_name, payment_date, recorded_by, notes, status, verified_by, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        aId,
        sId,
        paymentRef,
        payAmount,
        targetDestination,
        method,
        studentTxRef || null,
        studentTxRef || null,
        bankName || null,
        dateStr,
        req.user!.id,
        notes || null,
        paymentStatus,
        !isPending ? req.user!.id : null,
        !isPending ? new Date().toISOString() : null,
      ]
    );

    const paymentId = paymentResult.insertId;

    // Generate appropriate Receipt
    let receiptType: 'PROVISIONAL_ACKNOWLEDGEMENT' | 'FINAL_COLLEGE_RECEIPT' | 'SECRETARY_DEV_RECEIPT' = 'FINAL_COLLEGE_RECEIPT';
    let receiptPrefix = 'KAMCH/RCP';

    if (isPending) {
      receiptType = 'PROVISIONAL_ACKNOWLEDGEMENT';
      receiptPrefix = 'KAMCH/PRV';
    } else if (targetDestination === 'SECRETARY_DEV_ACCOUNT') {
      receiptType = 'SECRETARY_DEV_RECEIPT';
      receiptPrefix = 'KAMCH/SEC';
    }

    const yearSuffix = new Date().getFullYear();
    const receiptNumber = `${receiptPrefix}/${yearSuffix}/${String(paymentId).padStart(4, '0')}`;

    const [receiptResult] = await connection.query<any>(
      `INSERT INTO fee_receipts 
        (payment_id, student_id, receipt_number, receipt_type, destination, amount, requested_by, status, reviewed_by, reviewed_at, issued_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?, NOW(), NOW())`,
      [
        paymentId,
        sId,
        receiptNumber,
        receiptType,
        targetDestination,
        payAmount,
        req.user!.id,
        !isPending ? req.user!.id : null,
      ]
    );

    await recordAuditLog({
      actorId: req.user!.id,
      action: isPending ? 'BANK_TRANSFER_RECORDED' : 'PAYMENT_COLLECTED',
      targetType: 'PAYMENT',
      targetId: String(paymentId),
      ipAddress: req.ip || null,
      details: {
        paymentRef,
        receiptNumber,
        receiptType,
        amount: payAmount,
        destination: targetDestination,
        method,
        status: paymentStatus,
      },
    });

    await connection.commit();

    res.status(201).json({
      success: true,
      message: isPending
        ? `Bank transfer payment recorded as Pending Verification. Provisional Acknowledgement #${receiptNumber} generated.`
        : `Payment of ₹${payAmount.toLocaleString('en-IN')} confirmed. Receipt #${receiptNumber} generated.`,
      paymentId,
      receiptNumber,
      receiptType,
      status: paymentStatus,
      receiptId: receiptResult.insertId,
    });
  } catch (err) {
    await connection.rollback();
    console.error('[KAMCH Fees] Error recording payment:', (err as Error).message);
    res.status(500).json({ error: 'Failed to record payment', code: 'DATABASE_ERROR' });
  } finally {
    connection.release();
  }
});

/**
 * POST /api/fees/payments/:id/verify
 * Verification / Rejection of College Bank Transfers:
 * - Enter passbook transaction number and verify transfer
 * - OR reject with mandatory reason
 * Verifiers: Super Admin, Principal, Secretary, Office accounts staff
 */
feesRouter.post('/payments/:id/verify', requireRoles('SUPER_ADMIN', 'PRINCIPAL', 'SECRETARY', 'OFFICE', 'STAFF'), validateCsrf, async (req: Request, res: Response): Promise<void> => {
  const paymentId = parseInt(req.params.id, 10);
  const { action, passbookTxRef, rejectionReason } = req.body || {};

  if (!paymentId || isNaN(paymentId)) {
    res.status(400).json({ error: 'Invalid payment ID', code: 'INVALID_ID' });
    return;
  }

  if (!['VERIFY', 'REJECT'].includes(action)) {
    res.status(400).json({ error: 'Action must be VERIFY or REJECT', code: 'INVALID_ACTION' });
    return;
  }

  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [payments] = await connection.query<any[]>(
      'SELECT * FROM fee_payments WHERE id = ? LIMIT 1 FOR UPDATE',
      [paymentId]
    );

    if (!payments || payments.length === 0) {
      await connection.rollback();
      res.status(404).json({ error: 'Payment not found', code: 'PAYMENT_NOT_FOUND' });
      return;
    }

    const p = payments[0];
    if (p.status !== 'PENDING_VERIFICATION') {
      await connection.rollback();
      res.status(400).json({
        error: `Payment is already ${p.status}. Only Pending Verification payments can be verified or rejected.`,
        code: 'INVALID_STATUS',
      });
      return;
    }

    if (action === 'VERIFY') {
      if (!passbookTxRef || String(passbookTxRef).trim() === '') {
        await connection.rollback();
        res.status(400).json({ error: 'Passbook transaction reference is mandatory to verify bank transfer.', code: 'MISSING_PASSBOOK_REF' });
        return;
      }

      const cleanPassbookRef = String(passbookTxRef).trim();

      // Update payment to VERIFIED
      await connection.query(
        `UPDATE fee_payments
         SET status = 'VERIFIED', passbook_tx_ref = ?, verified_by = ?, verified_at = NOW()
         WHERE id = ?`,
        [cleanPassbookRef, req.user!.id, paymentId]
      );

      // Promote provisional receipt to Final College Receipt
      const finalReceiptNumber = `KAMCH/RCP/${new Date().getFullYear()}/${String(paymentId).padStart(4, '0')}`;
      await connection.query(
        `UPDATE fee_receipts
         SET receipt_number = ?, receipt_type = 'FINAL_COLLEGE_RECEIPT', status = 'APPROVED', reviewed_by = ?, reviewed_at = NOW()
         WHERE payment_id = ?`,
        [finalReceiptNumber, req.user!.id, paymentId]
      );

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'BANK_TRANSFER_VERIFIED',
        targetType: 'PAYMENT',
        targetId: String(paymentId),
        ipAddress: req.ip || null,
        details: {
          paymentRef: p.payment_reference,
          studentTxRef: p.student_tx_ref,
          passbookTxRef: cleanPassbookRef,
          finalReceiptNumber,
        },
      });

      await connection.commit();

      res.json({
        success: true,
        message: `Bank transfer verified successfully against passbook reference '${cleanPassbookRef}'. Final Receipt #${finalReceiptNumber} issued.`,
        finalReceiptNumber,
      });
    } else {
      // REJECT action
      if (!rejectionReason || String(rejectionReason).trim() === '') {
        await connection.rollback();
        res.status(400).json({ error: 'Mandatory rejection reason is required.', code: 'MISSING_REJECTION_REASON' });
        return;
      }

      const cleanReason = String(rejectionReason).trim();

      await connection.query(
        `UPDATE fee_payments
         SET status = 'REJECTED', rejection_reason = ?, verified_by = ?, verified_at = NOW()
         WHERE id = ?`,
        [cleanReason, req.user!.id, paymentId]
      );

      await connection.query(
        `UPDATE fee_receipts
         SET status = 'REJECTED', rejection_reason = ?, reviewed_by = ?, reviewed_at = NOW()
         WHERE payment_id = ?`,
        [cleanReason, req.user!.id, paymentId]
      );

      await recordAuditLog({
        actorId: req.user!.id,
        action: 'BANK_TRANSFER_REJECTED',
        targetType: 'PAYMENT',
        targetId: String(paymentId),
        ipAddress: req.ip || null,
        details: {
          paymentRef: p.payment_reference,
          studentTxRef: p.student_tx_ref,
          rejectionReason: cleanReason,
        },
      });

      await connection.commit();

      res.json({
        success: true,
        message: 'Bank transfer payment rejected. Outstanding balance remains unchanged.',
      });
    }
  } catch (err) {
    await connection.rollback();
    console.error('[KAMCH Fees] Error verifying bank transfer:', (err as Error).message);
    res.status(500).json({ error: 'Failed to verify payment', code: 'DATABASE_ERROR' });
  } finally {
    connection.release();
  }
});

/**
 * POST /api/fees/payments/:id/reverse
 * Financial correction / reversal.
 * Restricted to Super Admin and Principal only (and Secretary for development fee payments).
 * Office accounts staff are strictly blocked!
 */
feesRouter.post('/payments/:id/reverse', requireRoles('SUPER_ADMIN', 'PRINCIPAL', 'SECRETARY'), validateCsrf, async (req: Request, res: Response): Promise<void> => {
  const paymentId = parseInt(req.params.id, 10);
  const { reversalReason } = req.body || {};

  if (!paymentId || isNaN(paymentId)) {
    res.status(400).json({ error: 'Invalid payment ID', code: 'INVALID_ID' });
    return;
  }

  const reason = String(reversalReason || '').trim();
  if (!reason) {
    res.status(400).json({ error: 'Mandatory reversal reason is required for financial auditability.', code: 'MISSING_REASON' });
    return;
  }

  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [payments] = await connection.query<any[]>(
      'SELECT * FROM fee_payments WHERE id = ? LIMIT 1 FOR UPDATE',
      [paymentId]
    );

    if (!payments || payments.length === 0) {
      await connection.rollback();
      res.status(404).json({ error: 'Payment not found', code: 'PAYMENT_NOT_FOUND' });
      return;
    }

    const p = payments[0];
    if (p.status === 'REVERSED') {
      await connection.rollback();
      res.status(400).json({ error: 'Payment has already been reversed.', code: 'ALREADY_REVERSED' });
      return;
    }

    // Role check: Secretary can only reverse dev account payments
    if (req.user!.role === 'SECRETARY' && p.destination !== 'SECRETARY_DEV_ACCOUNT') {
      await connection.rollback();
      res.status(403).json({ error: 'Secretary can only reverse development fee payments.', code: 'FORBIDDEN' });
      return;
    }

    // Never delete physically! Update status to REVERSED with audit details
    await connection.query(
      `UPDATE fee_payments
       SET status = 'REVERSED', reversal_reason = ?, reversed_by = ?, reversed_at = NOW()
       WHERE id = ?`,
      [reason, req.user!.id, paymentId]
    );

    // Cancel associated receipt
    await connection.query(
      `UPDATE fee_receipts
       SET status = 'REJECTED', rejection_reason = CONCAT('Payment Reversed: ', ?)
       WHERE payment_id = ?`,
      [reason, paymentId]
    );

    await recordAuditLog({
      actorId: req.user!.id,
      action: 'PAYMENT_REVERSED',
      targetType: 'PAYMENT',
      targetId: String(paymentId),
      ipAddress: req.ip || null,
      details: {
        paymentRef: p.payment_reference,
        amount: parseFloat(p.amount),
        destination: p.destination,
        reversalReason: reason,
      },
    });

    await connection.commit();

    res.json({
      success: true,
      message: `Payment ${p.payment_reference} reversed. Outstanding balance has been recalculated.`,
    });
  } catch (err) {
    await connection.rollback();
    console.error('[KAMCH Fees] Error reversing payment:', (err as Error).message);
    res.status(500).json({ error: 'Failed to reverse payment', code: 'DATABASE_ERROR' });
  } finally {
    connection.release();
  }
});

/**
 * GET /api/fees/receipts/:id
 * Fetches printable receipt details.
 */
feesRouter.get('/receipts/:id', async (req: Request, res: Response): Promise<void> => {
  const receiptId = parseInt(req.params.id, 10);
  if (!receiptId || isNaN(receiptId)) {
    res.status(400).json({ error: 'Invalid receipt ID', code: 'INVALID_ID' });
    return;
  }

  try {
    const pool = getPool();
    const [receipts] = await pool.query<any[]>(
      `SELECT 
        fr.*,
        fp.payment_reference,
        fp.amount AS paid_amount,
        fp.payment_method,
        fp.destination AS payment_destination,
        fp.student_tx_ref,
        fp.passbook_tx_ref,
        fp.bank_name,
        fp.payment_date,
        s.student_id_number,
        s.full_name AS student_name,
        s.admission_category,
        s.admission_year,
        s.current_year_of_study,
        sfa.assessed_college_fee,
        sfa.assessed_development_fee,
        sfa.assessed_mess_fee,
        sfa.assessed_hostel_fee,
        sfa.total_assessed_fee,
        sfa.concession_total,
        sfa.revised_payable,
        sfa.is_kea_exception_applied,
        sfa.kea_exception_reason,
        requester.full_name AS requested_by_name,
        reviewer.full_name AS reviewed_by_name,
        reviewer_role.name AS reviewed_by_role
       FROM fee_receipts fr
       JOIN fee_payments fp ON fr.payment_id = fp.id
       JOIN students s ON fr.student_id = s.id
       JOIN student_fee_assessments sfa ON fp.assessment_id = sfa.id
       JOIN users requester ON fr.requested_by = requester.id
       LEFT JOIN users reviewer ON fr.reviewed_by = reviewer.id
       LEFT JOIN roles reviewer_role ON reviewer.role_id = reviewer_role.id
       WHERE fr.id = ? LIMIT 1`,
      [receiptId]
    );

    if (!receipts || receipts.length === 0) {
      res.status(404).json({ error: 'Receipt not found', code: 'RECEIPT_NOT_FOUND' });
      return;
    }

    const r = receipts[0];
    const amountVal = parseFloat(r.paid_amount || r.amount);

    // Calculate total verified paid so far for balance display
    const [paidRows] = await pool.query<any[]>(
      "SELECT COALESCE(SUM(amount), 0) AS total_paid FROM fee_payments WHERE student_id = ? AND status = 'VERIFIED'",
      [r.student_id]
    );
    const totalPaidSoFar = parseFloat(paidRows[0]?.total_paid || '0');
    const revisedPayable = parseFloat(r.revised_payable || r.total_assessed_fee);
    const remainingBalance = Math.max(0, revisedPayable - totalPaidSoFar);

    res.json({
      receiptNumber: r.receipt_number,
      receiptType: r.receipt_type,
      paymentReference: r.payment_reference,
      destination: r.destination || r.payment_destination,
      issueDate: r.issued_at || r.created_at,
      status: r.status,
      approvedAt: r.reviewed_at,
      approvedBy: r.reviewed_by_name || r.requested_by_name,
      approvedByRole: r.reviewed_by_role || 'Accounts Officer',
      student: {
        idNumber: r.student_id_number,
        name: r.student_name,
        category: r.admission_category,
        academicYear: r.admission_year ? `${r.admission_year}-${r.admission_year + 1}` : '2026-2027',
        yearOfStudy: r.current_year_of_study,
      },
      assessment: {
        collegeFee: parseFloat(r.assessed_college_fee || '0'),
        developmentFee: parseFloat(r.assessed_development_fee || '0'),
        messFee: parseFloat(r.assessed_mess_fee || '0'),
        hostelFee: parseFloat(r.assessed_hostel_fee || '0'),
        totalAssessed: parseFloat(r.total_assessed_fee || '0'),
        concessions: parseFloat(r.concession_total || '0'),
        revisedPayable,
      },
      payment: {
        amount: amountVal,
        amountInWords: numberToIndianWords(amountVal),
        method: r.payment_method,
        studentTxRef: r.student_tx_ref,
        passbookTxRef: r.passbook_tx_ref,
        bankName: r.bank_name,
        paymentDate: r.payment_date,
      },
      totalPaidSoFar,
      remainingBalance,
    });
  } catch (err) {
    console.error('[KAMCH Fees] Error fetching receipt:', (err as Error).message);
    res.status(500).json({ error: 'Failed to retrieve receipt details', code: 'DATABASE_ERROR' });
  }
});

/**
 * GET /api/fees/reports
 * Comprehensive financial report filtering by date range, batch, category, destination, and method.
 */
feesRouter.get('/reports', requireRoles('SUPER_ADMIN', 'PRINCIPAL', 'SECRETARY', 'OFFICE', 'STAFF'), async (req: Request, res: Response): Promise<void> => {
  const { dateFrom, dateTo, destination, method, status, category } = req.query;

  try {
    const pool = getPool();
    const whereClauses: string[] = [];
    const queryParams: any[] = [];

    if (dateFrom && typeof dateFrom === 'string') {
      whereClauses.push('fp.payment_date >= ?');
      queryParams.push(dateFrom);
    }

    if (dateTo && typeof dateTo === 'string') {
      whereClauses.push('fp.payment_date <= ?');
      queryParams.push(dateTo);
    }

    if (destination && typeof destination === 'string' && destination !== 'ALL') {
      whereClauses.push('fp.destination = ?');
      queryParams.push(destination);
    }

    if (method && typeof method === 'string' && method !== 'ALL') {
      whereClauses.push('fp.payment_method = ?');
      queryParams.push(method);
    }

    if (status && typeof status === 'string' && status !== 'ALL') {
      whereClauses.push('fp.status = ?');
      queryParams.push(status);
    }

    if (category && typeof category === 'string' && category !== 'ALL') {
      whereClauses.push('s.admission_category = ?');
      queryParams.push(category);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [rows] = await pool.query<any[]>(
      `SELECT 
        fp.id,
        fp.payment_reference,
        fp.amount,
        fp.destination,
        fp.payment_method,
        fp.student_tx_ref,
        fp.passbook_tx_ref,
        fp.payment_date,
        fp.status,
        s.student_id_number,
        s.full_name AS student_name,
        s.admission_category,
        recorder.full_name AS recorder_name,
        verifier.full_name AS verifier_name,
        fr.receipt_number,
        fr.receipt_type
       FROM fee_payments fp
       JOIN students s ON fp.student_id = s.id
       JOIN users recorder ON fp.recorded_by = recorder.id
       LEFT JOIN users verifier ON fp.verified_by = verifier.id
       LEFT JOIN fee_receipts fr ON fp.id = fr.payment_id
       ${whereSql}
       ORDER BY fp.payment_date DESC, fp.id DESC`,
      queryParams
    );

    const totalAmount = rows
      .filter((r) => r.status === 'VERIFIED')
      .reduce((sum, r) => sum + parseFloat(r.amount), 0);

    const pendingAmount = rows
      .filter((r) => r.status === 'PENDING_VERIFICATION')
      .reduce((sum, r) => sum + parseFloat(r.amount), 0);

    res.json({
      records: rows,
      totalVerified: totalAmount,
      totalPending: pendingAmount,
      count: rows.length,
    });
  } catch (err) {
    console.error('[KAMCH Fees] Error generating reports:', (err as Error).message);
    res.status(500).json({ error: 'Failed to generate financial reports', code: 'DATABASE_ERROR' });
  }
});
