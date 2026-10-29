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
    frequentDays: number;
    dailyDays: number;
    weeklyWeeks: number;
    monthlyMonths: number;
  };
}

/**
 * Searches for a binary in standard XAMPP Windows paths and system PATH.
 */
function resolveBinaryPath(envOverride: string | undefined, binaryName: string): string | undefined {
  if (envOverride && fs.existsSync(envOverride)) {
    return path.resolve(envOverride);
  }

  const isWindows = process.platform === 'win32';
  const executableName = isWindows ? `${binaryName}.exe` : binaryName;

  // Standard Windows XAMPP installation locations
  const candidatePaths = [
    `C:\\xampp\\mysql\\bin\\${executableName}`,
    `D:\\xampp\\mysql\\bin\\${executableName}`,
    `C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\${executableName}`,
    `C:\\Program Files\\MariaDB\\bin\\${executableName}`,
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

  // Internal backup directory: default to C:\KAMCH-Backups on Windows, or ./backups/internal in dev
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

  return {
    db: {
      host: dbEnv.host || '127.0.0.1',
      port: dbEnv.port || 3306,
      user: dbEnv.user || 'root',
      password: dbEnv.password,
      database: dbEnv.database || 'kamch_erp',
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
      frequentDays: Number(process.env.BACKUP_RETENTION_FREQUENT_DAYS) || 7,
      dailyDays: Number(process.env.BACKUP_RETENTION_DAILY_DAYS) || 30,
      weeklyWeeks: Number(process.env.BACKUP_RETENTION_WEEKLY_WEEKS) || 12,
      monthlyMonths: Number(process.env.BACKUP_RETENTION_MONTHLY_MONTHS) || 12,
    },
  };
}
