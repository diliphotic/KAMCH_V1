import fs from 'fs';
import path from 'path';

export interface LockInfo {
  pid: number;
  timestamp: string;
  hostname: string;
}

const STALE_LOCK_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

export class BackupLockManager {
  private lockFilePath: string;
  private acquired: boolean = false;

  constructor(lockDirectory: string) {
    this.lockFilePath = path.join(lockDirectory, 'backup.lock');
  }

  /**
   * Attempts to acquire exclusive backup lock.
   * Returns true if lock acquired, false if an active backup is currently running.
   */
  public acquire(): { acquired: boolean; reason?: string } {
    try {
      if (fs.existsSync(this.lockFilePath)) {
        let lockContent: LockInfo | null = null;
        try {
          const raw = fs.readFileSync(this.lockFilePath, 'utf8');
          lockContent = JSON.parse(raw);
        } catch {
          // If unparseable, we treat it based on file mtime
        }

        const stats = fs.statSync(this.lockFilePath);
        const lockAgeMs = Date.now() - stats.mtimeMs;

        if (lockAgeMs < STALE_LOCK_THRESHOLD_MS) {
          const runningPid = lockContent?.pid ? ` (PID: ${lockContent.pid})` : '';
          return {
            acquired: false,
            reason: `Another backup operation is currently in progress${runningPid}, initiated at ${lockContent?.timestamp || stats.mtime.toISOString()}.`,
          };
        }

        // Stale lock detected
        console.warn(
          `[KAMCH Backup Lock] Warning: Stale backup lock detected (age: ${Math.round(lockAgeMs / 60000)} minutes). Overriding stale lock from prior interrupted run.`
        );
        fs.unlinkSync(this.lockFilePath);
      }

      // Ensure directory exists
      const dir = path.dirname(this.lockFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const lockData: LockInfo = {
        pid: process.pid,
        timestamp: new Date().toISOString(),
        hostname: process.env.COMPUTERNAME || process.env.HOSTNAME || 'localhost',
      };

      // Write atomically with exclusive flag
      fs.writeFileSync(this.lockFilePath, JSON.stringify(lockData, null, 2), { flag: 'wx' });
      this.acquired = true;

      return { acquired: true };
    } catch (err) {
      return {
        acquired: false,
        reason: `Failed to create lockfile: ${(err as Error).message}`,
      };
    }
  }

  /**
   * Releases the lock.
   */
  public release(): void {
    if (this.acquired && fs.existsSync(this.lockFilePath)) {
      try {
        fs.unlinkSync(this.lockFilePath);
      } catch (err) {
        console.warn('[KAMCH Backup Lock] Warning: Could not remove lock file:', (err as Error).message);
      } finally {
        this.acquired = false;
      }
    }
  }
}
