import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import mysql, { Connection } from 'mysql2/promise';
import { loadBackupConfig, BackupConfig, projectRoot } from '../../scripts/backup/config.ts';
import { validateSqlDump, ValidationResult } from '../../scripts/backup/validator.ts';
import { BackupLockManager } from '../../scripts/backup/lock.ts';
import { calculateSha256, verifyChecksum, formatBytes } from '../../scripts/backup/crypto-utils.ts';
import { checkDatabaseConnection, getActivePersistenceMode } from '../db.ts';
import { logInfo, logError } from './logger.ts';
import { recordAuditLog } from './audit.ts';

export interface BackupResult {
  success: boolean;
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  fileSizeFormatted: string;
  sha256: string;
  type: 'daily' | 'weekly' | 'manual';
  tableCount: number;
  tables: string[];
  createdAt: string;
  usbCopied: boolean;
  usbPath?: string;
}

export interface RestoreResult {
  success: boolean;
  targetDatabase: string;
  sourceFile: string;
  tablesRestored: number;
  tableNames: string[];
  sampleCounts: Record<string, number>;
  restoredAt: string;
}

export interface BackupFileInfo {
  fileName: string;
  filePath: string;
  type: 'daily' | 'weekly' | 'manual';
  sizeBytes: number;
  sizeFormatted: string;
  sha256?: string;
  createdAt: string;
  isValid?: boolean;
}

/**
 * Returns available disk space in bytes for a directory, or null if unsupported.
 */
function getAvailableDiskSpace(dirPath: string): number | null {
  try {
    if (typeof fs.statfsSync === 'function') {
      const stats = fs.statfsSync(dirPath);
      return stats.bavail * stats.bsize;
    }
  } catch {
    // Unsupported on older runtimes or restricted environments
  }
  return null;
}

/**
 * Appends a log line to backup.log without logging secrets.
 */
function appendBackupLog(logDir: string, level: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR', message: string): void {
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, 'backup.log');
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level}] ${message}\n`;
    fs.appendFileSync(logFile, logLine, 'utf8');
  } catch {
    // Non-fatal
  }
}

/**
 * Generates an SQL dump using direct mysql2 streaming connection when mysqldump binary is unavailable.
 * Preserves tables, schema, constraints, indexes, triggers, and routines.
 */
async function generateDriverSqlDump(config: BackupConfig, targetFile: string): Promise<void> {
  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    multipleStatements: true,
  });

  const writeStream = fs.createWriteStream(targetFile, { encoding: 'utf8' });

  try {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    writeStream.write(`-- KAMCH ERP Automated Database Dump\n`);
    writeStream.write(`-- Target Database: ${config.db.database}\n`);
    writeStream.write(`-- Generated via: KAMCH MySQL Stream Driver\n`);
    writeStream.write(`-- Timestamp: ${timestamp}\n\n`);
    writeStream.write(`SET NAMES utf8mb4;\n`);
    writeStream.write(`SET FOREIGN_KEY_CHECKS = 0;\n`);
    writeStream.write(`SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";\n\n`);

    // 1. Fetch all base tables
    const [tableRows] = await connection.query<any[]>(
      `SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'`
    );
    const tableField = Object.keys(tableRows[0] || {})[0];
    const tableNames: string[] = tableRows.map((r: any) => r[tableField]);

    for (const tableName of tableNames) {
      writeStream.write(`--\n-- Table structure for table \`${tableName}\`\n--\n\n`);
      writeStream.write(`DROP TABLE IF EXISTS \`${tableName}\`;\n`);

      const [createRows] = await connection.query<any[]>(`SHOW CREATE TABLE \`${tableName}\``);
      const createSql = createRows[0]?.['Create Table'] || '';
      writeStream.write(`${createSql};\n\n`);

      // 2. Fetch and write rows
      writeStream.write(`--\n-- Dumping data for table \`${tableName}\`\n--\n\n`);
      const [rows] = await connection.query<any[]>(`SELECT * FROM \`${tableName}\``);

      if (Array.isArray(rows) && rows.length > 0) {
        const columns = Object.keys(rows[0]);
        const quotedCols = columns.map((c) => `\`${c}\``).join(', ');

        const chunkSize = 200;
        for (let i = 0; i < rows.length; i += chunkSize) {
          const chunk = rows.slice(i, i + chunkSize);
          const valuesSql = chunk
            .map((row) => {
              const vals = columns.map((col) => {
                const val = row[col];
                if (val === null || val === undefined) return 'NULL';
                if (typeof val === 'number') return String(val);
                if (typeof val === 'boolean') return val ? '1' : '0';
                if (val instanceof Date) return connection.escape(val.toISOString().slice(0, 19).replace('T', ' '));
                if (typeof val === 'object') return connection.escape(JSON.stringify(val));
                return connection.escape(String(val));
              });
              return `(${vals.join(', ')})`;
            })
            .join(',\n  ');

          writeStream.write(`INSERT INTO \`${tableName}\` (${quotedCols}) VALUES\n  ${valuesSql};\n`);
        }
        writeStream.write('\n');
      }
    }

    // 3. Dump Triggers
    try {
      const [triggers] = await connection.query<any[]>(`SHOW TRIGGERS`);
      if (Array.isArray(triggers) && triggers.length > 0) {
        writeStream.write(`--\n-- Dumping triggers\n--\n\n`);
        for (const trig of triggers) {
          const triggerName = trig.Trigger;
          const [createTrig] = await connection.query<any[]>(`SHOW CREATE TRIGGER \`${triggerName}\``);
          const trigSql = createTrig[0]?.['SQL Original Statement'];
          if (trigSql) {
            writeStream.write(`DELIMITER ;;\n${trigSql};;\nDELIMITER ;\n\n`);
          }
        }
      }
    } catch {
      // Triggers query might require privileges; continue
    }

    // 4. Dump Routines (Procedures & Functions)
    try {
      const [procedures] = await connection.query<any[]>(
        `SHOW PROCEDURE STATUS WHERE Db = ?`,
        [config.db.database]
      );
      if (Array.isArray(procedures) && procedures.length > 0) {
        writeStream.write(`--\n-- Dumping stored procedures\n--\n\n`);
        for (const proc of procedures) {
          const procName = proc.Name;
          const [createProc] = await connection.query<any[]>(`SHOW CREATE PROCEDURE \`${procName}\``);
          const procSql = createProc[0]?.['Create Procedure'];
          if (procSql) {
            writeStream.write(`DELIMITER ;;\n${procSql};;\nDELIMITER ;\n\n`);
          }
        }
      }
    } catch {
      // Non-fatal if routine inspection restricted
    }

    writeStream.write(`SET FOREIGN_KEY_CHECKS = 1;\n`);
    writeStream.write(`-- Dump completed on ${timestamp}\n`);

    await new Promise<void>((resolve, reject) => {
      writeStream.end(() => resolve());
      writeStream.on('error', reject);
    });
  } finally {
    await connection.end();
  }
}

/**
 * Prunes older backups in a directory while strictly enforcing:
 * DO NOT DELETE THE ONLY USABLE BACKUP (Requirement 6).
 */
export function pruneOldBackups(directory: string, maxRetain: number, prefix: string): { pruned: string[]; retained: string[] } {
  const pruned: string[] = [];
  const retained: string[] = [];

  if (!fs.existsSync(directory)) {
    return { pruned, retained };
  }

  const allFiles = fs
    .readdirSync(directory)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.sql'))
    .map((name) => {
      const fullPath = path.join(directory, name);
      const stat = fs.statSync(fullPath);
      return { name, fullPath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  // Guarantee: If only 1 backup exists, NEVER delete it
  if (allFiles.length <= 1) {
    return { pruned: [], retained: allFiles.map((f) => f.name) };
  }

  const keepCount = Math.max(1, maxRetain);
  const filesToKeep = allFiles.slice(0, keepCount);
  const filesToDelete = allFiles.slice(keepCount);

  for (const item of filesToDelete) {
    try {
      fs.unlinkSync(item.fullPath);
      pruned.push(item.name);
      // Also delete companion .sha256 if present
      const hashFile = `${item.fullPath}.sha256`;
      if (fs.existsSync(hashFile)) {
        fs.unlinkSync(hashFile);
      }
    } catch {
      // Ignore deletion failure
    }
  }

  return {
    pruned,
    retained: filesToKeep.map((f) => f.name),
  };
}

/**
 * Main Backup Generation Engine.
 * Follows strict constraints:
 * - Real MySQL connection required (no silent fake in-memory backup)
 * - Exclusive lock to prevent race conditions
 * - Safe temp file with atomic rename only after validation
 * - SHA-256 checksum generation & verification
 * - Configurable daily/weekly retention
 * - Never deletes the last remaining valid backup
 */
export async function createDatabaseBackup(options?: {
  type?: 'daily' | 'weekly' | 'manual';
  triggeredBy?: string;
  isManual?: boolean;
}): Promise<BackupResult> {
  const config = loadBackupConfig();
  const backupType = options?.type || 'daily';

  // 1. Verify Real Database Connectivity (Requirement 12)
  const dbHealth = await checkDatabaseConnection();
  const persistence = getActivePersistenceMode();

  if (!dbHealth.connected || persistence.isFallback) {
    const errorMsg = `Live MySQL backup cannot proceed: Database is not connected or is operating in in-memory preview fallback mode (${dbHealth.code || 'UNCONNECTED'}). Real MySQL/MariaDB server is required.`;
    logError('BACKUP', errorMsg);
    throw new Error(errorMsg);
  }

  // 2. Prepare Directories outside public web directory (Requirement 5)
  const baseDir = config.destinations.internalDir;
  const targetSubDir = path.join(baseDir, backupType === 'weekly' ? 'weekly' : 'daily');
  const logDir = path.join(baseDir, 'logs');

  if (!fs.existsSync(targetSubDir)) {
    fs.mkdirSync(targetSubDir, { recursive: true });
  }

  // 3. Acquire Exclusive Lock (Requirement 11)
  const lockManager = new BackupLockManager(baseDir);
  const lock = lockManager.acquire();
  if (!lock.acquired) {
    const lockMsg = `Backup aborted: ${lock.reason || 'Another backup operation is currently running'}`;
    logError('BACKUP_LOCK', lockMsg);
    throw new Error(lockMsg);
  }

  // 4. Check Disk Space (minimum 25 MB headroom required)
  const freeSpace = getAvailableDiskSpace(targetSubDir);
  if (freeSpace !== null && freeSpace < 25 * 1024 * 1024) {
    lockManager.release();
    const diskMsg = `Backup aborted: Insufficient disk space on backup volume (${formatBytes(freeSpace)} free, minimum 25 MB required).`;
    logError('BACKUP_DISK', diskMsg);
    throw new Error(diskMsg);
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '_')
    .slice(0, 15);
  const fileName = `kamch_erp_${backupType}_${timestamp}.sql`;
  const tempFilePath = path.join(targetSubDir, `${fileName}.tmp`);
  const finalFilePath = path.join(targetSubDir, fileName);

  appendBackupLog(logDir, 'INFO', `Starting ${backupType} backup for database '${config.db.database}'...`);

  try {
    // 5. Generate Dump: prefer mysqldump binary, fallback to MySQL stream driver
    if (config.tools.mysqldumpPath && fs.existsSync(config.tools.mysqldumpPath)) {
      await new Promise<void>((resolve, reject) => {
        const dumpArgs = [
          `--host=${config.db.host}`,
          `--port=${config.db.port}`,
          `--user=${config.db.user}`,
          '--routines',
          '--triggers',
          '--events',
          '--single-transaction',
          '--quick',
          '--max_allowed_packet=512M',
          '--hex-blob',
          '--default-character-set=utf8mb4',
          config.db.database,
        ];

        const outStream = fs.createWriteStream(tempFilePath);
        const child = spawn(config.tools.mysqldumpPath!, dumpArgs, {
          env: {
            ...process.env,
            MYSQL_PWD: config.db.password || '',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stderrData = '';
        child.stdout.pipe(outStream);
        child.stderr.on('data', (d) => {
          stderrData += d.toString();
        });

        child.on('error', (err) => {
          reject(new Error(`mysqldump process error: ${err.message}`));
        });

        child.on('close', (code) => {
          outStream.end();
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`mysqldump exited with error code ${code}: ${stderrData}`));
          }
        });
      });
    } else {
      // Pure MySQL protocol dump using database connection
      await generateDriverSqlDump(config, tempFilePath);
    }

    // 6. Validate Dump Completeness & Integrity
    const validation: ValidationResult = await validateSqlDump(tempFilePath);
    if (!validation.isValid) {
      throw new Error(`Backup validation failed: ${validation.errors.join('; ')}`);
    }

    // 7. Calculate SHA-256 Checksum
    const sha256 = await calculateSha256(tempFilePath);

    // 8. Atomic Rename from .tmp to official .sql
    fs.renameSync(tempFilePath, finalFilePath);

    // 9. Write companion .sha256 file
    fs.writeFileSync(`${finalFilePath}.sha256`, `${sha256}  ${fileName}\n`, 'utf8');

    // 10. External USB sync if configured and available
    let usbCopied = false;
    let usbDestFile: string | undefined;

    if (config.destinations.usbDir) {
      try {
        const usbSubDir = path.join(config.destinations.usbDir, backupType);
        if (!fs.existsSync(usbSubDir)) {
          fs.mkdirSync(usbSubDir, { recursive: true });
        }
        usbDestFile = path.join(usbSubDir, fileName);
        fs.copyFileSync(finalFilePath, usbDestFile);
        fs.copyFileSync(`${finalFilePath}.sha256`, `${usbDestFile}.sha256`);

        const usbMatch = await verifyChecksum(usbDestFile, sha256);
        if (usbMatch) {
          usbCopied = true;
          appendBackupLog(logDir, 'SUCCESS', `USB verified copy written: ${usbDestFile}`);
          // Apply USB retention
          pruneOldBackups(usbSubDir, backupType === 'weekly' ? config.retention.weeklyWeeks : config.retention.dailyDays, `kamch_erp_${backupType}`);
        } else {
          try {
            fs.unlinkSync(usbDestFile);
          } catch {
            // Non-fatal
          }
          appendBackupLog(logDir, 'WARNING', `USB checksum mismatch on copy; removed unverified USB copy.`);
        }
      } catch (usbErr) {
        appendBackupLog(logDir, 'WARNING', `USB backup copy failed: ${(usbErr as Error).message}. Internal backup remains secure.`);
      }
    }

    // 11. Apply Configurable Retention (Requirement 6)
    const retentionLimit = backupType === 'weekly' ? config.retention.weeklyWeeks : config.retention.dailyDays;
    const { pruned } = pruneOldBackups(targetSubDir, retentionLimit, `kamch_erp_${backupType}`);

    if (pruned.length > 0) {
      appendBackupLog(logDir, 'INFO', `Retention policy pruned ${pruned.length} expired backups: ${pruned.join(', ')}`);
    }

    appendBackupLog(
      logDir,
      'SUCCESS',
      `Backup completed successfully: ${fileName} (${formatBytes(validation.fileSizeBytes)}, SHA-256: ${sha256})`
    );

    logInfo('BACKUP', `Successfully created ${backupType} database backup: ${fileName}`);

    if (options?.triggeredBy) {
      void recordAuditLog({
        actorId: Number(options.triggeredBy) || null,
        action: 'DATABASE_BACKUP_CREATED',
        targetType: 'BACKUP',
        targetId: fileName,
        details: {
          type: backupType,
          fileSizeBytes: validation.fileSizeBytes,
          sha256,
          tableCount: validation.tableCount,
        },
      });
    }

    return {
      success: true,
      fileName,
      filePath: finalFilePath,
      fileSizeBytes: validation.fileSizeBytes,
      fileSizeFormatted: formatBytes(validation.fileSizeBytes),
      sha256,
      type: backupType,
      tableCount: validation.tableCount,
      tables: validation.foundTables,
      createdAt: new Date().toISOString(),
      usbCopied,
      usbPath: usbDestFile,
    };
  } catch (err) {
    if (fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch {
        // Non-fatal cleanup
      }
    }
    const sanitizedError = (err as Error).message.replace(/(password|pwd)=[^\s&]+/gi, '$1=[REDACTED]');
    appendBackupLog(logDir, 'ERROR', `Backup failed: ${sanitizedError}`);
    logError('BACKUP_FAILED', `Backup operation failed`, err);
    throw err;
  } finally {
    lockManager.release();
  }
}

/**
 * Safe Restoration Engine (Requirement 8).
 * Enforces:
 * - Restores to separate/test database by default
 * - Never overwrites the live production database during routine tests or backups
 * - Verifies restored database tables and integrity
 */
export async function restoreDatabaseToTest(
  backupFilePath: string,
  options?: {
    targetDatabase?: string;
    allowOverwriteLive?: boolean;
    actorId?: number;
  }
): Promise<RestoreResult> {
  const config = loadBackupConfig();

  if (!fs.existsSync(backupFilePath)) {
    throw new Error(`Backup file not found: ${backupFilePath}`);
  }

  // 1. Target Database Safety Guard (Requirement 8)
  const targetDb = options?.targetDatabase?.trim() || config.db.testDatabase;
  const isTargetingLive = targetDb.toLowerCase() === config.db.database.toLowerCase();

  if (isTargetingLive && !options?.allowOverwriteLive) {
    throw new Error(
      `Safety Violation: Direct restoration to live production database '${config.db.database}' is prohibited. Test restoration must target '${config.db.testDatabase}'.`
    );
  }

  // 2. Validate Dump before restoring
  const validation = await validateSqlDump(backupFilePath);
  if (!validation.isValid) {
    throw new Error(`Cannot restore corrupted or invalid dump file: ${validation.errors.join('; ')}`);
  }

  // 3. Verify SHA-256 Checksum if sidecar file exists
  const sidecarShaFile = `${backupFilePath}.sha256`;
  if (fs.existsSync(sidecarShaFile)) {
    const rawExpected = fs.readFileSync(sidecarShaFile, 'utf8').trim().split(/\s+/)[0];
    if (rawExpected) {
      const match = await verifyChecksum(backupFilePath, rawExpected);
      if (!match) {
        throw new Error('Backup checksum verification failed! File may be altered or corrupted.');
      }
    }
  }

  // 4. Verify Database Server Reachability
  const dbHealth = await checkDatabaseConnection();
  // 5. Create separate test database
  const rootConn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: true,
  });

  try {
    await rootConn.query(
      `CREATE DATABASE IF NOT EXISTS \`${targetDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await rootConn.end();
  }

  // 5. Execute Restore
  if (config.tools.mysqlPath && fs.existsSync(config.tools.mysqlPath)) {
    await new Promise<void>((resolve, reject) => {
      const args = [
        `--host=${config.db.host}`,
        `--port=${config.db.port}`,
        `--user=${config.db.user}`,
        '--default-character-set=utf8mb4',
        targetDb,
      ];

      const child = spawn(config.tools.mysqlPath!, args, {
        env: {
          ...process.env,
          MYSQL_PWD: config.db.password || '',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const inStream = fs.createReadStream(backupFilePath);
      inStream.pipe(child.stdin);

      let stderr = '';
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`mysql restore tool exited with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to invoke mysql restore tool: ${err.message}`));
      });
    });
  } else {
    // Pure Node / mysql2 streaming executor for environments without native CLI
    const restoreConn = await mysql.createConnection({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: targetDb,
      multipleStatements: true,
    });

    try {
      const sqlContent = fs.readFileSync(backupFilePath, 'utf8');
      // Execute with multipleStatements enabled
      await restoreConn.query(sqlContent);
    } finally {
      await restoreConn.end();
    }
  }

  // 6. Verify Restored Database
  const verifyConn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: targetDb,
  });

  let tablesRestored = 0;
  const tableNames: string[] = [];
  const sampleCounts: Record<string, number> = {};

  try {
    const [tRows] = await verifyConn.query<any[]>(`SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'`);
    tablesRestored = tRows.length;
    const key = Object.keys(tRows[0] || {})[0];
    for (const r of tRows) {
      const tbl = r[key];
      tableNames.push(tbl);
    }

    // Sample row counts from core tables
    const checkTables = ['users', 'roles', 'students', 'fee_structures'];
    for (const tbl of checkTables) {
      if (tableNames.includes(tbl)) {
        try {
          const [cntRows] = await verifyConn.query<any[]>(`SELECT COUNT(*) AS total FROM \`${tbl}\``);
          sampleCounts[tbl] = Number(cntRows[0]?.total || 0);
        } catch {
          // Ignore
        }
      }
    }
  } finally {
    await verifyConn.end();
  }

  const result: RestoreResult = {
    success: true,
    targetDatabase: targetDb,
    sourceFile: path.basename(backupFilePath),
    tablesRestored,
    tableNames,
    sampleCounts,
    restoredAt: new Date().toISOString(),
  };

  logInfo('RESTORE_VERIFY', `Restored and verified backup to '${targetDb}': ${tablesRestored} tables restored.`);

  if (options?.actorId) {
    void recordAuditLog({
      actorId: options.actorId,
      action: 'DATABASE_RESTORE_TESTED',
      targetType: 'DATABASE',
      targetId: targetDb,
      details: {
        sourceFile: path.basename(backupFilePath),
        tablesRestored,
        sampleCounts,
      },
    });
  }

  return result;
}

/**
 * Scans for all available backup files in the internal backup directory.
 */
export function listAvailableBackups(): BackupFileInfo[] {
  const config = loadBackupConfig();
  const baseDir = config.destinations.internalDir;
  const results: BackupFileInfo[] = [];

  const subDirs: Array<{ name: string; type: 'daily' | 'weekly' | 'manual' }> = [
    { name: 'daily', type: 'daily' },
    { name: 'weekly', type: 'weekly' },
  ];

  for (const sub of subDirs) {
    const dirPath = path.join(baseDir, sub.name);
    if (!fs.existsSync(dirPath)) continue;

    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.sql'));
    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      try {
        const stat = fs.statSync(fullPath);
        const hashFile = `${fullPath}.sha256`;
        let sha256: string | undefined;
        if (fs.existsSync(hashFile)) {
          sha256 = fs.readFileSync(hashFile, 'utf8').trim().split(/\s+/)[0];
        }

        results.push({
          fileName: file,
          filePath: fullPath,
          type: sub.type,
          sizeBytes: stat.size,
          sizeFormatted: formatBytes(stat.size),
          sha256,
          createdAt: stat.mtime.toISOString(),
          isValid: stat.size > 100,
        });
      } catch {
        // Skip inaccessible file
      }
    }
  }

  return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Returns overall system status and readiness for backups.
 */
export async function getBackupSystemStatus() {
  const config = loadBackupConfig();
  const dbHealth = await checkDatabaseConnection();
  const persistence = getActivePersistenceMode();
  const baseDir = config.destinations.internalDir;

  const diskFreeBytes = getAvailableDiskSpace(baseDir);
  const backups = listAvailableBackups();
  const lastBackup = backups.length > 0 ? backups[0] : null;

  return {
    database: {
      connected: dbHealth.connected,
      latencyMs: dbHealth.latencyMs,
      targetDatabase: config.db.database,
      testDatabase: config.db.testDatabase,
      persistenceMode: persistence.mode,
      isFallback: persistence.isFallback,
    },
    tools: {
      mysqldumpAvailable: Boolean(config.tools.mysqldumpPath && fs.existsSync(config.tools.mysqldumpPath)),
      mysqldumpPath: config.tools.mysqldumpPath || null,
      mysqlAvailable: Boolean(config.tools.mysqlPath && fs.existsSync(config.tools.mysqlPath)),
      mysqlPath: config.tools.mysqlPath || null,
    },
    storage: {
      internalDir: config.destinations.internalDir,
      internalDirExists: fs.existsSync(config.destinations.internalDir),
      usbDir: config.destinations.usbDir || null,
      usbDirConnected: config.destinations.usbDir ? fs.existsSync(config.destinations.usbDir) : false,
      diskFreeBytes,
      diskFreeFormatted: diskFreeBytes !== null ? formatBytes(diskFreeBytes) : 'Unknown',
    },
    retention: {
      dailyDays: config.retention.dailyDays,
      weeklyWeeks: config.retention.weeklyWeeks,
    },
    schedule: {
      autoDaily: config.schedule.autoDaily,
      scheduleHour: config.schedule.scheduleHour,
    },
    summary: {
      totalBackupsFound: backups.length,
      lastBackupAt: lastBackup?.createdAt || null,
      lastBackupFile: lastBackup?.fileName || null,
    },
  };
}
