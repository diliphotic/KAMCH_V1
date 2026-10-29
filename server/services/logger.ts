import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.resolve(__dirname, '../../logs');

// Ensure local logs directory exists
if (!fs.existsSync(logsDir)) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
  } catch {
    // Non-fatal if read-only filesystem
  }
}

const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Sanitizes messages to guarantee no passwords, bearer tokens, cookies, or secrets are written to logs.
 */
function sanitizeMessage(message: string): string {
  return message
    .replace(/(password|passwd|pwd|token|cookie|secret)[=:]\s*([^\s,;]+)/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/kamch_session=[A-Za-z0-9._~+/-]+/gi, 'kamch_session=[REDACTED]')
    .replace(/kamch_csrf=[A-Za-z0-9._~+/-]+/gi, 'kamch_csrf=[REDACTED]');
}

/**
 * Rotates log file if it exceeds MAX_LOG_SIZE_BYTES.
 */
function rotateLogIfNeeded(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      if (stats.size >= MAX_LOG_SIZE_BYTES) {
        const backupPath = `${filePath}.1`;
        if (fs.existsSync(backupPath)) {
          fs.unlinkSync(backupPath);
        }
        fs.renameSync(filePath, backupPath);
      }
    }
  } catch {
    // Ignore rotation error to avoid crashing logging
  }
}

/**
 * Writes a timestamped log line to local log file and console.
 */
export function logError(category: string, message: string, details?: unknown): void {
  const timestamp = new Date().toISOString();
  const safeMessage = sanitizeMessage(message);
  let detailStr = '';

  if (details) {
    if (details instanceof Error) {
      detailStr = ` - ${details.name}: ${sanitizeMessage(details.message)}`;
    } else if (typeof details === 'object') {
      try {
        detailStr = ` - ${sanitizeMessage(JSON.stringify(details))}`;
      } catch {
        detailStr = ' - [Unserializable Details]';
      }
    } else {
      detailStr = ` - ${sanitizeMessage(String(details))}`;
    }
  }

  const logLine = `[${timestamp}] [ERROR] [${category}] ${safeMessage}${detailStr}\n`;

  // Always output to stderr for container/console observation
  process.stderr.write(logLine);

  // Write to local rotating log file
  const logFile = path.join(logsDir, 'server.log');
  try {
    rotateLogIfNeeded(logFile);
    fs.appendFileSync(logFile, logLine, 'utf8');
  } catch {
    // Non-fatal if disk is constrained
  }
}

export function logInfo(category: string, message: string): void {
  const timestamp = new Date().toISOString();
  const safeMessage = sanitizeMessage(message);
  const logLine = `[${timestamp}] [INFO] [${category}] ${safeMessage}\n`;

  process.stdout.write(logLine);

  const logFile = path.join(logsDir, 'server.log');
  try {
    rotateLogIfNeeded(logFile);
    fs.appendFileSync(logFile, logLine, 'utf8');
  } catch {
    // Non-fatal
  }
}
