import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import '../../server/env.ts';
import { getDatabaseEnvConfig } from '../../server/env.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const projectRoot = path.resolve(__dirname, '..', '..');

export interface BackupConfig {
  db: {
    host: string;
    port: number;
    user: string;
    password?: string;
    database: string;
    testDatabase: string;
  };
  destinations: {
    internalDir: string;
    usbDir?: string;
  };
  tools: {
    mysqldumpPath?: string;
    mysqlPath?: string;
  };
  retention: {
    dailyDays: number;
    weeklyWeeks: number;
  };
  schedule: {
    autoDaily: boolean;
    scheduleHour: number;
  };
}

/**
 * Searches for a binary in standard installation paths and system PATH.
 */
function resolveBinaryPath(envOverride: string | undefined, binaryName: string): string | undefined {
  if (envOverride && fs.existsSync(envOverride)) {
    return path.resolve(envOverride);
  }

  const isWindows = process.platform === 'win32';
  const executableName = isWindows ? `${binaryName}.exe` : binaryName;

  // Standard Windows and Linux installation locations
  const candidatePaths = isWindows
    ? [
        `C:\\xampp\\mysql\\bin\\${executableName}`,
        `D:\\xampp\\mysql\\bin\\${executableName}`,
        `C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\${executableName}`,
        `C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\${executableName}`,
        `C:\\Program Files\\MySQL\\MySQL Server 5.7\\bin\\${executableName}`,
        `C:\\Program Files\\MariaDB\\bin\\${executableName}`,
        `C:\\laragon\\bin\\mysql\\bin\\${executableName}`,
      ]
    : [
        `/usr/bin/${executableName}`,
        `/usr/local/bin/${executableName}`,
        `/opt/homebrew/bin/${executableName}`,
        `/usr/local/mysql/bin/${executableName}`,
        `/usr/lib/mariadb/bin/${executableName}`,
      ];

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Check system PATH
  const pathEnv = process.env.PATH || '';
  const pathSeparator = isWindows ? ';' : ':';
  const directories = pathEnv.split(pathSeparator);

  for (const dir of directories) {
    if (!dir) continue;
    const fullPath = path.join(dir.trim(), executableName);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  return undefined;
}

/**
 * Loads and returns the validated backup configuration.
 */
export function loadBackupConfig(): BackupConfig {
  const dbEnv = getDatabaseEnvConfig();

  // Internal backup directory: default to C:\KAMCH-Backups on Windows, or ./backups/internal in dev/linux
  const isWindows = process.platform === 'win32';
  const defaultInternal = isWindows
    ? 'C:\\KAMCH-Backups'
    : path.resolve(projectRoot, 'backups', 'internal');

  const internalDir = process.env.BACKUP_INTERNAL_DIR
    ? path.resolve(process.env.BACKUP_INTERNAL_DIR.trim())
    : defaultInternal;

  // External USB directory (optional / operator configured)
  const rawUsb = process.env.BACKUP_USB_DIR?.trim();
  const usbDir = rawUsb && rawUsb.length > 0 ? path.resolve(rawUsb) : undefined;

  // Resolve mysqldump and mysql tools
  const mysqldumpPath = resolveBinaryPath(process.env.MYSQLDUMP_PATH?.trim(), 'mysqldump');
  const mysqlPath = resolveBinaryPath(process.env.MYSQL_PATH?.trim(), 'mysql');

  const database = dbEnv.database || 'kamch_erp';
  const testDatabase = process.env.DB_TEST_NAME?.trim() || `${database}_test`;

  return {
    db: {
      host: dbEnv.host || '127.0.0.1',
      port: dbEnv.port || 3306,
      user: dbEnv.user || 'root',
      password: dbEnv.password,
      database,
      testDatabase,
    },
    destinations: {
      internalDir,
      usbDir,
    },
    tools: {
      mysqldumpPath,
      mysqlPath,
    },
    retention: {
      dailyDays: Math.max(1, Number(process.env.BACKUP_RETENTION_DAILY_DAYS) || 7),
      weeklyWeeks: Math.max(1, Number(process.env.BACKUP_RETENTION_WEEKLY_WEEKS) || 12),
    },
    schedule: {
      autoDaily: process.env.BACKUP_AUTO_DAILY !== 'false',
      scheduleHour: Number.isInteger(Number(process.env.BACKUP_SCHEDULE_HOUR))
        ? Number(process.env.BACKUP_SCHEDULE_HOUR)
        : 2, // 2:00 AM default
    },
  };
}
