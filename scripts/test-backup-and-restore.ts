import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import '../server/env.ts';
import { loadBackupConfig } from './backup/config.ts';
import { BackupLockManager } from './backup/lock.ts';
import { validateSqlDump } from './backup/validator.ts';
import { calculateSha256, verifyChecksum, formatBytes } from './backup/crypto-utils.ts';
import {
  pruneOldBackups,
  createDatabaseBackup,
  restoreDatabaseToTest,
  listAvailableBackups,
  getBackupSystemStatus,
} from '../server/services/backup.service.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testTempDir = path.resolve(__dirname, '..', 'backups', 'test_scratch');

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${testName}`);
  } else {
    console.error(`  [FAIL] ${testName} ${detail ? `(${detail})` : ''}`);
    throw new Error(`Assertion failed: ${testName}`);
  }
}

async function runTests() {
  console.log(`\n======================================================`);
  console.log(` KAMCH ERP — Task 1: Backup & Restoration Verification `);
  console.log(`======================================================\n`);

  if (!fs.existsSync(testTempDir)) {
    fs.mkdirSync(testTempDir, { recursive: true });
  }

  // TEST SUITE 1: Configuration & Directory Isolation
  console.log(`Suite 1: Configuration & Security Isolation`);
  const config = loadBackupConfig();
  assert(
    !config.destinations.internalDir.includes('public') &&
      !config.destinations.internalDir.includes('dist'),
    'Backup directory is located outside public web directories (Requirement 5)'
  );
  assert(
    config.db.testDatabase !== config.db.database,
    `Test restore database (${config.db.testDatabase}) is distinct from live database (${config.db.database}) (Requirement 8)`
  );
  assert(
    config.retention.dailyDays >= 1 && config.retention.weeklyWeeks >= 1,
    `Configurable daily (${config.retention.dailyDays}d) and weekly (${config.retention.weeklyWeeks}w) retention configured (Requirement 6)`
  );

  // TEST SUITE 2: Exclusive Concurrency Lock Manager
  console.log(`\nSuite 2: Exclusive Concurrency Lock Manager (Requirement 11)`);
  const lockManager1 = new BackupLockManager(testTempDir);
  const lock1 = lockManager1.acquire();
  assert(lock1.acquired === true, 'Lock successfully acquired for primary process');

  const lockManager2 = new BackupLockManager(testTempDir);
  const lock2 = lockManager2.acquire();
  assert(
    lock2.acquired === false,
    'Concurrent lock acquisition correctly blocked while backup is in progress'
  );

  lockManager1.release();
  const lock3 = lockManager2.acquire();
  assert(lock3.acquired === true, 'Lock acquisition succeeds after previous lock is released');
  lockManager2.release();

  // TEST SUITE 3: SQL Dump Validator (Requirement 4 & 11)
  console.log(`\nSuite 3: SQL Dump Validator & Integrity Checker`);
  // 3a: Valid mock dump
  const validDumpFile = path.join(testTempDir, 'valid_test_dump.sql');
  const validSql = `
-- KAMCH ERP Automated Database Dump
-- Target Database: kamch_erp
SET NAMES utf8mb4;
CREATE TABLE \`roles\` (\`id\` int PRIMARY KEY);
CREATE TABLE \`users\` (\`id\` int PRIMARY KEY);
CREATE TABLE \`sessions\` (\`id\` int PRIMARY KEY);
CREATE TABLE \`account_requests\` (\`id\` int PRIMARY KEY);
CREATE TABLE \`audit_logs\` (\`id\` bigint PRIMARY KEY);
CREATE TABLE \`students\` (\`id\` int PRIMARY KEY);
CREATE TABLE \`fee_structures\` (\`id\` int PRIMARY KEY);
CREATE TABLE \`student_fee_assessments\` (\`id\` int PRIMARY KEY);
CREATE TABLE \`fee_payments\` (\`id\` int PRIMARY KEY);
CREATE TABLE \`fee_receipts\` (\`id\` int PRIMARY KEY);
-- Dump completed on 2026-10-29 02:00:00
`;
  fs.writeFileSync(validDumpFile, validSql, 'utf8');

  const validResult = await validateSqlDump(validDumpFile);
  assert(validResult.isValid === true, 'Valid SQL dump with core tables & completion marker passes validation');
  assert(validResult.missingExpectedTables.length === 0, 'All expected core tables identified in dump');
  assert(validResult.hasCompletionMarker === true, 'Completion marker correctly recognized');

  // 3b: Corrupted / Error Dump
  const errorDumpFile = path.join(testTempDir, 'error_test_dump.sql');
  const errorSql = `
mysqldump: Got error: 1045: Access denied for user 'root'@'localhost'
`;
  fs.writeFileSync(errorDumpFile, errorSql, 'utf8');
  const errorResult = await validateSqlDump(errorDumpFile);
  assert(errorResult.isValid === false, 'Corrupted dump with MySQL errors is correctly rejected');

  // 3c: Incomplete dump missing completion marker and core tables
  const incompleteDumpFile = path.join(testTempDir, 'incomplete_test_dump.sql');
  fs.writeFileSync(incompleteDumpFile, 'CREATE TABLE `roles` (`id` int);', 'utf8');
  const incompleteResult = await validateSqlDump(incompleteDumpFile);
  assert(incompleteResult.isValid === false, 'Truncated dump missing completion marker is correctly rejected');
  assert(incompleteResult.missingExpectedTables.includes('users'), 'Missing core tables correctly detected');

  // TEST SUITE 4: SHA-256 Checksum Calculation & Tamper Verification
  console.log(`\nSuite 4: SHA-256 Checksum & Verification (Requirement 4 & 7)`);
  const checksum = await calculateSha256(validDumpFile);
  assert(typeof checksum === 'string' && checksum.length === 64, 'SHA-256 checksum calculated successfully');
  const matchOriginal = await verifyChecksum(validDumpFile, checksum);
  assert(matchOriginal === true, 'SHA-256 checksum verification matches');

  const mismatchCheck = await verifyChecksum(validDumpFile, '0000000000000000000000000000000000000000000000000000000000000000');
  assert(mismatchCheck === false, 'Tampered/altered checksum is correctly rejected');

  // TEST SUITE 5: Retention Policy Pruning & "Never Delete Only Usable Backup"
  console.log(`\nSuite 5: Retention Policy & Safety Guarantee (Requirement 6)`);
  const retentionTestDir = path.join(testTempDir, 'retention_test');
  if (fs.existsSync(retentionTestDir)) {
    fs.rmSync(retentionTestDir, { recursive: true, force: true });
  }
  fs.mkdirSync(retentionTestDir, { recursive: true });

  // 5a: Only 1 backup exists -> MUST NEVER BE DELETED
  const singleFile = path.join(retentionTestDir, 'kamch_erp_daily_20261020_000000.sql');
  fs.writeFileSync(singleFile, 'MOCK BACKUP CONTENT 1', 'utf8');
  const pruneSingle = pruneOldBackups(retentionTestDir, 0, 'kamch_erp_daily'); // Even with maxRetain = 0
  assert(pruneSingle.pruned.length === 0, 'Single remaining backup is NEVER deleted (Requirement 6)');
  assert(fs.existsSync(singleFile), 'Sole existing backup file remains intact on disk');

  // 5b: Multiple backups exceed retention limit
  const file2 = path.join(retentionTestDir, 'kamch_erp_daily_20261021_000000.sql');
  const file3 = path.join(retentionTestDir, 'kamch_erp_daily_20261022_000000.sql');
  const file4 = path.join(retentionTestDir, 'kamch_erp_daily_20261023_000000.sql');
  fs.writeFileSync(file2, 'MOCK BACKUP CONTENT 2', 'utf8');
  fs.writeFileSync(file3, 'MOCK BACKUP CONTENT 3', 'utf8');
  fs.writeFileSync(file4, 'MOCK BACKUP CONTENT 4', 'utf8');

  // Wait a millisecond to ensure mtime difference
  const pruneMulti = pruneOldBackups(retentionTestDir, 2, 'kamch_erp_daily');
  assert(pruneMulti.retained.length === 2, 'Retains requested number of newest backups (2)');
  assert(pruneMulti.pruned.length === 2, 'Prunes older backups exceeding configured retention limit');

  // TEST SUITE 6: Non-Silent Failure in In-Memory / Unconnected Mode (Requirement 12)
  console.log(`\nSuite 6: Honest Database Connection Handling (Requirement 12)`);
  let caughtFallbackError = false;
  try {
    // In this development/container environment without live MySQL host configured,
    // calling createDatabaseBackup MUST NOT pretend it dumped MySQL.
    await createDatabaseBackup({ type: 'daily' });
  } catch (err) {
    caughtFallbackError = true;
    const msg = (err as Error).message;
    assert(
      msg.includes('fallback') || msg.includes('not connected') || msg.includes('Real MySQL'),
      'createDatabaseBackup rejected non-connected database with honest error (Requirement 12)',
      msg
    );
  }
  assert(caughtFallbackError === true, 'Backup fails honestly and refuses to forge in-memory backup');

  // TEST SUITE 7: Restoration Safety Guard Against Live Database Overwrite (Requirement 8)
  console.log(`\nSuite 7: Safe Restoration & Overwrite Protection (Requirement 8)`);
  let caughtLiveOverwriteError = false;
  try {
    await restoreDatabaseToTest(validDumpFile, {
      targetDatabase: config.db.database, // Attempting to target live database without explicit override
      allowOverwriteLive: false,
    });
  } catch (err) {
    caughtLiveOverwriteError = true;
    const msg = (err as Error).message;
    assert(
      msg.includes('prohibited') || msg.includes('Safety Violation') || msg.includes('test database'),
      'Restoration strictly blocks direct overwriting of live production database',
      msg
    );
  }
  assert(caughtLiveOverwriteError === true, 'Direct live database overwrite is safely prevented');

  // Clean up test scratch directory
  try {
    fs.rmSync(testTempDir, { recursive: true, force: true });
  } catch {
    // Non-fatal
  }

  console.log(`\n------------------------------------------------------`);
  console.log(` SUMMARY: ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
  console.log(`------------------------------------------------------\n`);
}

runTests().catch((err) => {
  console.error('\nTest suite failed with unexpected error:', err);
  process.exit(1);
});
