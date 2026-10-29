import fs from 'fs';

export interface ValidationResult {
  isValid: boolean;
  fileSizeBytes: number;
  tableCount: number;
  foundTables: string[];
  missingExpectedTables: string[];
  hasCompletionMarker: boolean;
  errors: string[];
}

// Expected core tables in kamch_erp
const EXPECTED_CORE_TABLES = [
  'roles',
  'users',
  'sessions',
  'account_requests',
  'audit_logs',
  'students',
  'fee_structures',
  'student_fee_assessments',
  'fee_payments',
  'fee_receipts',
];

/**
 * Validates the internal structure of an uncompressed MySQL dump file.
 * Checks for minimum size, error messages, presence of core tables, and completion marker.
 */
export async function validateSqlDump(filePath: string): Promise<ValidationResult> {
  const errors: string[] = [];

  if (!fs.existsSync(filePath)) {
    return {
      isValid: false,
      fileSizeBytes: 0,
      tableCount: 0,
      foundTables: [],
      missingExpectedTables: EXPECTED_CORE_TABLES,
      hasCompletionMarker: false,
      errors: [`Dump file does not exist: ${filePath}`],
    };
  }

  const stat = fs.statSync(filePath);
  const fileSizeBytes = stat.size;

  if (fileSizeBytes < 100) {
    errors.push(`Dump file is unusually small (${fileSizeBytes} bytes). Likely truncated or empty.`);
  }

  // Read file lines in streaming fashion to handle arbitrary dump sizes without memory issues
  const foundTables: string[] = [];
  let hasCompletionMarker = false;

  const content = fs.readFileSync(filePath, 'utf8');

  // Check for common error strings in the dump output
  const errorPatterns = [
    /mysqldump:\s*Got\s*error/i,
    /ERROR\s+\d+\s+\([A-Z0-9]+\):/i,
    /Access denied for user/i,
    /Unknown database/i,
    /Table.*doesn't exist/i,
  ];

  for (const pattern of errorPatterns) {
    if (pattern.test(content)) {
      errors.push(`Dump contains error indicator matching pattern: ${pattern.source}`);
    }
  }

  // Detect CREATE TABLE statements
  const tableRegex = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`?([a-zA-Z0-9_]+)`?/gi;
  let match: RegExpExecArray | null;
  while ((match = tableRegex.exec(content)) !== null) {
    const tableName = match[1].toLowerCase();
    if (!foundTables.includes(tableName)) {
      foundTables.push(tableName);
    }
  }

  // Check for completion marker at end of dump
  // Standard mysqldump format: "-- Dump completed on YYYY-MM-DD HH:MM:SS"
  const tailChunk = content.slice(-2000);
  if (/-- Dump completed on/i.test(tailChunk) || /Dump completed/i.test(tailChunk)) {
    hasCompletionMarker = true;
  } else {
    errors.push('Missing mysqldump completion marker at end of file. The dump may have been truncated or interrupted.');
  }

  // Verify core tables
  const missingExpectedTables = EXPECTED_CORE_TABLES.filter(
    (tbl) => !foundTables.includes(tbl)
  );

  if (missingExpectedTables.length > 0) {
    errors.push(
      `Dump is missing expected core tables: ${missingExpectedTables.join(', ')} (found ${foundTables.length} tables total).`
    );
  }

  const isValid = errors.length === 0;

  return {
    isValid,
    fileSizeBytes,
    tableCount: foundTables.length,
    foundTables,
    missingExpectedTables,
    hasCompletionMarker,
    errors,
  };
}
