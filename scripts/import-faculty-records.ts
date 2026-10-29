import path from 'path';
import { fileURLToPath } from 'url';
import '../server/env.ts';
import { envDiagnostics } from '../server/env.ts';
import { checkDatabaseConnection, getPool } from '../server/db.ts';
import {
  DEFAULT_FACULTY_SOURCE_PATH,
  FacultyImportSummaryReport,
  runFacultyImportWorkflow,
} from '../server/services/faculty-import.ts';

function parseCliArgs(argv: string[]): {
  mode: 'DRY_RUN' | 'APPLY';
  sourceFilePath: string;
} {
  let mode: 'DRY_RUN' | 'APPLY' = 'DRY_RUN';
  let sourceFilePath = DEFAULT_FACULTY_SOURCE_PATH;

  for (const arg of argv) {
    if (arg === '--apply') {
      mode = 'APPLY';
    } else if (arg === '--dry-run') {
      mode = 'DRY_RUN';
    } else if (arg.startsWith('--source=')) {
      sourceFilePath = path.resolve(process.cwd(), arg.slice('--source='.length));
    }
  }

  return { mode, sourceFilePath };
}

export function printFacultyImportReport(report: FacultyImportSummaryReport): void {
  const banner =
    report.mode === 'DRY_RUN'
      ? 'KAMCH ERP — FACULTY IMPORT DRY-RUN (ZERO DATABASE WRITES)'
      : 'KAMCH ERP — FACULTY IMPORT EXECUTION REPORT';

  console.log('========================================================================');
  console.log(banner);
  console.log('========================================================================');
  console.log(`Mode                          : ${report.mode}`);
  console.log(`Reference Date                : ${report.referenceDate}`);
  console.log(`Existing DB Departments       : ${report.existingDatabaseCounts.departmentsCount}`);
  console.log(`Existing DB Teachers          : ${report.existingDatabaseCounts.teachersCount}`);
  console.log(
    `Schema Migration Ready        : ${
      report.schemaStatus.migrationReady
        ? 'YES (teacher_records_v1 columns present)'
        : `NO — run "npm run db:migrate" before applying import`
    }`
  );
  if (!report.schemaStatus.migrationReady && report.schemaStatus.missingTeacherColumns.length > 0) {
    console.log(
      `Pending 'teachers' Columns    : ${report.schemaStatus.missingTeacherColumns.join(', ')}`
    );
  }

  console.log('\n--- 1. Source Document Summary ---');
  console.log(`Total Faculty Parsed          : ${report.sourceSummary.totalParsedRecords}`);
  console.log(`Total Source Departments      : ${report.sourceSummary.totalSourceDepartments}`);
  console.log(`Clean Records (No Flags)      : ${report.sourceSummary.cleanRecordsCount}`);
  console.log(`Flagged for Verification      : ${report.sourceSummary.flaggedForVerificationCount}`);
  console.log(
    `Internal Source Duplicates    : ${report.sourceSummary.sourceInternalDuplicatesCount}`
  );
  if (report.sourceSummary.ignoredTrailingNoiseLines > 0) {
    console.log(
      `Trailing Noise Lines Ignored  : ${report.sourceSummary.ignoredTrailingNoiseLines}`
    );
  }

  console.log('\n--- 2. Department Resolution Plan ---');
  for (const dept of report.departmentResolutions) {
    if (dept.status === 'REUSE_EXISTING') {
      console.log(
        `  [REUSE]     ${dept.sourceDepartmentName} -> Existing #${dept.departmentId} '${dept.matchedDepartment.name}' (${dept.matchedDepartment.code})`
      );
    } else if (dept.status === 'CREATE_NEW') {
      console.log(
        `  [${report.mode === 'DRY_RUN' ? 'WOULD CREATE' : 'CREATED'}] ${dept.sourceDepartmentName} -> Code '${dept.proposedCode}'`
      );
    } else {
      console.log(
        `  [AMBIGUOUS] ${dept.sourceDepartmentName} -> ${dept.reason}`
      );
    }
  }

  const conflicts = report.recordPlans.filter(
    (p) =>
      p.disposition === 'SKIPPED_POTENTIAL_DUPLICATE' ||
      p.disposition === 'SKIPPED_AMBIGUOUS_DEPARTMENT' ||
      p.disposition === 'SKIPPED_INTERNAL_SOURCE_DUPLICATE'
  );
  console.log(`\n--- 3. Duplicate / Ambiguous Skips (${conflicts.length}) ---`);
  if (conflicts.length === 0) {
    console.log('  None.');
  } else {
    for (const c of conflicts) {
      console.log(
        `  [${c.disposition}] #${c.record.sourceIndex} ${c.record.fullName} (${c.record.departmentSourceName}): ${c.reason}`
      );
    }
  }

  const flagged = report.recordPlans.filter((p) => p.record.dataVerificationRequired);
  console.log(`\n--- 4. Records Flagged for Manual Verification (${flagged.length}) ---`);
  if (flagged.length === 0) {
    console.log('  None.');
  } else {
    for (const item of flagged) {
      const r = item.record;
      console.log(
        `  • #${r.sourceIndex} ${r.fullName} [${r.departmentSourceName}] (Teacher Code: ${
          r.teacherCode || r.teacherCodeStatus
        }, Reg. No: ${r.registrationNumber || 'NULL'})`
      );
      for (const fl of r.verificationFlags) {
        console.log(`      - [${fl.code}] ${fl.message}`);
      }
    }
  }

  console.log('\n--- 5. Overall Import Disposition Summary ---');
  console.log(
    `  ${report.mode === 'DRY_RUN' ? 'Ready to Insert' : 'Inserted'}              : ${
      report.counts.readyOrInserted
    }`
  );
  console.log(`  Skipped (Already Imported)    : ${report.counts.skippedIdempotent}`);
  console.log(`  Skipped (Potential Duplicate) : ${report.counts.skippedPotentialDuplicate}`);
  console.log(`  Skipped (Ambiguous Dept)      : ${report.counts.skippedAmbiguousDepartment}`);
  console.log(
    `  Departments ${report.mode === 'DRY_RUN' ? 'to Create' : 'Created'}        : ${
      report.counts.departmentsCreated
    }`
  );
  console.log(`  Departments Reused            : ${report.counts.departmentsReused}`);
  console.log(`  Departments Ambiguous         : ${report.counts.departmentsAmbiguous}`);
  console.log('========================================================================');
}

async function main(): Promise<void> {
  const { mode, sourceFilePath } = parseCliArgs(process.argv.slice(2));

  console.log(
    `[KAMCH Faculty Import] Environment file: ${envDiagnostics.envPath} (exists: ${envDiagnostics.envExists})`
  );
  console.log(`[KAMCH Faculty Import] Source file: ${sourceFilePath}`);

  const health = await checkDatabaseConnection();
  if (!health.connected) {
    console.error(
      `[KAMCH Faculty Import] Aborted: Live MySQL/MariaDB database is not reachable (${
        health.code || 'UNKNOWN'
      }${health.diagnosticNote ? ` — ${health.diagnosticNote}` : ''}).\n` +
        `Ensure local XAMPP MySQL is running and DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, and DB_NAME in .env are configured.`
    );
    process.exit(1);
  }

  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    const report = await runFacultyImportWorkflow({
      connection,
      mode,
      sourceFilePath,
    });
    printFacultyImportReport(report);
  } finally {
    connection.release();
    if (typeof (pool as unknown as { end?: () => Promise<void> }).end === 'function') {
      await pool.end().catch(() => {});
    }
  }
}

const __filename = fileURLToPath(import.meta.url);
const isDirectCliRun =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]).toLowerCase() === path.resolve(__filename).toLowerCase();

if (isDirectCliRun) {
  main().catch((err) => {
    console.error('[KAMCH Faculty Import] Fatal error:', (err as Error).message || err);
    process.exit(1);
  });
}
