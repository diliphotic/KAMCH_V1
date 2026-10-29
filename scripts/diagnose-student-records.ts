import '../server/env.ts';
import { envDiagnostics } from '../server/env.ts';
import { checkDatabaseConnection, getPool } from '../server/db.ts';
import {
  computeCourseDurationStatus,
  toIsoDateOnly,
} from '../server/services/student-progression.ts';

/**
 * Read-Only Student Registry & Admission-Date Diagnostic Script
 *
 * Inspects the existing MySQL/MariaDB `students` table WITHOUT modifying,
 * merging, deleting, or overwriting any student, fee, payment, or receipt data.
 *
 * Usage on local Windows/XAMPP:
 *   npm run db:diagnose-students
 */
async function runStudentRegistryDiagnostics(): Promise<void> {
  console.log('==================================================================');
  console.log('KAMCH ERP — READ-ONLY STUDENT REGISTRY & ADMISSION DATE DIAGNOSTIC');
  console.log('==================================================================');
  console.log(
    `Environment file: ${envDiagnostics.envPath} (exists: ${envDiagnostics.envExists})\n`
  );

  const health = await checkDatabaseConnection();
  if (!health.connected) {
    console.error(
      `[ABORTED] Live MySQL/MariaDB database is not reachable (${health.code || 'UNKNOWN'}` +
        `${health.diagnosticNote ? ` — ${health.diagnosticNote}` : ''}).\n` +
        `Ensure XAMPP MySQL is running and DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, and DB_NAME in .env are configured.`
    );
    process.exit(1);
  }

  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    let maxCourseDurationYears = 9;
    try {
      const [settingRows] = await connection.query<any[]>(
        `SELECT setting_value FROM institutional_settings WHERE setting_key = 'MAX_COURSE_DURATION_YEARS' LIMIT 1`
      );
      const parsed = Number(settingRows?.[0]?.setting_value);
      if (Number.isFinite(parsed) && parsed > 0) {
        maxCourseDurationYears = parsed;
      }
    } catch {
      // Fallback to 9 years if institutional_settings table is not yet migrated
    }

    const [rows] = await connection.query<any[]>(
      `SELECT s.*,
              cs.is_legacy_minimal AS scheme_is_legacy
       FROM students s
       LEFT JOIN curriculum_schemes cs ON s.scheme_id = cs.id
       ORDER BY s.id ASC`
    );

    const students = rows || [];
    console.log(`Total student records inspected (read-only): ${students.length}`);
    console.log(`Configured maximum course duration review threshold: ${maxCourseDurationYears} years\n`);

    // 1. Potential Duplicate Student Check
    const potentialDuplicates: Array<{
      studentA: string;
      studentB: string;
      reasons: string[];
    }> = [];

    for (let i = 0; i < students.length; i++) {
      for (let j = i + 1; j < students.length; j++) {
        const a = students[i];
        const b = students[j];
        const reasons: string[] = [];

        const aName = String(a.full_name || '').trim().toLowerCase().replace(/\s+/g, ' ');
        const bName = String(b.full_name || '').trim().toLowerCase().replace(/\s+/g, ' ');
        const aDob = toIsoDateOnly(a.date_of_birth);
        const bDob = toIsoDateOnly(b.date_of_birth);
        const aPhone = String(a.contact_phone || '').replace(/\D/g, '');
        const bPhone = String(b.contact_phone || '').replace(/\D/g, '');
        const aUni = String(a.permanent_university_number || '').trim().toUpperCase();
        const bUni = String(b.permanent_university_number || '').trim().toUpperCase();
        const aNeet = String(a.neet_roll_number || '').trim().toUpperCase();
        const bNeet = String(b.neet_roll_number || '').trim().toUpperCase();
        const aKea = String(a.kea_acknowledgement_no || '').trim().toUpperCase();
        const bKea = String(b.kea_acknowledgement_no || '').trim().toUpperCase();

        if (aUni && bUni && aUni === bUni) reasons.push(`Same RGUHS No. (${aUni})`);
        if (aNeet && bNeet && aNeet === bNeet) reasons.push(`Same NEET Roll (${aNeet})`);
        if (aKea && bKea && aKea === bKea) reasons.push(`Same KEA Ack (${aKea})`);
        if (aName && bName && aName === bName && aDob && bDob && aDob === bDob) {
          reasons.push(`Same Name + DOB (${aDob})`);
        } else if (aName && bName && aName === bName && aPhone.length >= 10 && aPhone === bPhone) {
          reasons.push(`Same Name + Phone (${a.contact_phone})`);
        } else if (
          aName &&
          bName &&
          aName === bName &&
          Number(a.admission_year) === Number(b.admission_year)
        ) {
          reasons.push(`Same Name + Admission Year (${a.admission_year})`);
        }

        if (reasons.length > 0) {
          potentialDuplicates.push({
            studentA: `#${a.id} [${a.student_id_number}] ${a.full_name}`,
            studentB: `#${b.id} [${b.student_id_number}] ${b.full_name}`,
            reasons,
          });
        }
      }
    }

    console.log(`--- 1. Potential Duplicate Student Records (${potentialDuplicates.length}) ---`);
    if (potentialDuplicates.length === 0) {
      console.log('None detected.');
    } else {
      for (const dup of potentialDuplicates) {
        console.log(`  * ${dup.studentA}  <-->  ${dup.studentB}`);
        console.log(`    Reason(s): ${dup.reasons.join('; ')}`);
      }
    }

    // 2. Admission Date & Course-Duration Verification Check
    const admissionDateIssues: Array<{
      summary: string;
      rawValue: string;
      note: string;
    }> = [];

    for (const r of students) {
      if (Boolean(r.scheme_is_legacy)) continue;
      const check = computeCourseDurationStatus(
        r.admission_date,
        r.admission_year ? Number(r.admission_year) : null,
        maxCourseDurationYears,
        undefined,
        {
          dateOfBirth: r.date_of_birth,
          admissionStatus: r.admission_status ? String(r.admission_status) : null,
        }
      );
      if (
        check.requiresVerification ||
        (Boolean(r.course_duration_flag) && !check.exceedsLimit)
      ) {
        const rawStr =
          r.admission_date === null || r.admission_date === undefined
            ? 'NULL'
            : r.admission_date instanceof Date
            ? toIsoDateOnly(r.admission_date) || String(r.admission_date)
            : String(r.admission_date);
        admissionDateIssues.push({
          summary: `#${r.id} [${r.student_id_number}] ${r.full_name} (admission_year=${r.admission_year}, status=${r.admission_status || 'PROVISIONAL'})`,
          rawValue: rawStr,
          note:
            check.verificationReason ||
            'Stored course_duration_flag=1 does not match verified elapsed duration.',
        });
      }
    }

    console.log(
      `\n--- 2. Records Requiring Official Admission Date Verification (${admissionDateIssues.length}) ---`
    );
    if (admissionDateIssues.length === 0) {
      console.log('None detected. All non-legacy student records have verified admission dates.');
    } else {
      for (const iss of admissionDateIssues) {
        console.log(`  * ${iss.summary}`);
        console.log(`    Current admission_date: ${iss.rawValue}`);
        console.log(`    Finding: ${iss.note}`);
      }
    }

    console.log(
      '\n[READ-ONLY COMPLETE] Zero records were modified, deleted, merged, or overwritten.'
    );
  } finally {
    connection.release();
    await pool.end().catch(() => {});
  }
}

runStudentRegistryDiagnostics().catch((err) => {
  console.error('[FATAL] Diagnostic script failed:', err);
  process.exit(1);
});
