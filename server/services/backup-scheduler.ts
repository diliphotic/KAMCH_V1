import { loadBackupConfig } from '../../scripts/backup/config.ts';
import { createDatabaseBackup, listAvailableBackups } from './backup.service.ts';
import { getActivePersistenceMode, checkDatabaseConnection } from '../db.ts';
import { logInfo, logError } from './logger.ts';

let schedulerInterval: NodeJS.Timeout | null = null;
let lastBackupRunDate: string | null = null;

/**
 * Initializes and starts the automated server-side recurring backup scheduler.
 * Runs strictly server-side (Requirement 3).
 */
export function initBackupScheduler(): void {
  const config = loadBackupConfig();

  if (!config.schedule.autoDaily) {
    logInfo('BACKUP_SCHEDULER', 'Automated daily backup scheduler is disabled via BACKUP_AUTO_DAILY=false');
    return;
  }

  logInfo(
    'BACKUP_SCHEDULER',
    `Initializing recurring backup scheduler (Target Hour: ${config.schedule.scheduleHour}:00, Retention: ${config.retention.dailyDays} days daily / ${config.retention.weeklyWeeks} weeks weekly)`
  );

  // Check every 15 minutes
  const CHECK_INTERVAL_MS = 15 * 60 * 1000;

  const runScheduledCheck = async () => {
    try {
      const persistence = getActivePersistenceMode();
      if (persistence.isFallback || !persistence.databaseConfigured) {
        // Dormant in preview fallback mode (Requirement 12)
        return;
      }

      const now = new Date();
      const currentHour = now.getHours();
      const todayDateStr = now.toISOString().slice(0, 10);

      // Check if scheduled hour has arrived and hasn't already run today
      if (currentHour === config.schedule.scheduleHour && lastBackupRunDate !== todayDateStr) {
        // Also check on-disk files to avoid duplicate if server restarted
        const backups = listAvailableBackups();
        const ranTodayOnDisk = backups.some((b) => b.createdAt.startsWith(todayDateStr));

        if (!ranTodayOnDisk) {
          logInfo('BACKUP_SCHEDULER', `Scheduled backup triggered at ${now.toISOString()}`);

          // Sunday is day 0 -> treat Sunday backup as weekly backup
          const isSunday = now.getDay() === 0;
          const backupType = isSunday ? 'weekly' : 'daily';

          await createDatabaseBackup({
            type: backupType,
            triggeredBy: 'SCHEDULER',
          });

          lastBackupRunDate = todayDateStr;
        } else {
          lastBackupRunDate = todayDateStr;
        }
      }
    } catch (err) {
      logError('BACKUP_SCHEDULER', 'Scheduled backup execution encountered an issue', err);
    }
  };

  // Run initial check after a brief 1-minute delay after server startup
  setTimeout(() => {
    void runScheduledCheck();
  }, 60 * 1000);

  schedulerInterval = setInterval(() => {
    void runScheduledCheck();
  }, CHECK_INTERVAL_MS);

  // Unref interval so it doesn't prevent graceful server shutdown
  if (schedulerInterval.unref) {
    schedulerInterval.unref();
  }
}

/**
 * Stops the scheduler (e.g. for testing or shutdown).
 */
export function stopBackupScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
