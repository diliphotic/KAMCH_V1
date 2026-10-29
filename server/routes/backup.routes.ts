import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { requireAuth, requirePasswordChangeClear, requireRoles } from '../middleware/auth.ts';
import { validateCsrf } from '../middleware/csrf.ts';
import { ROLES } from '../permissions.ts';
import { recordAuditLog } from '../services/audit.ts';
import {
  createDatabaseBackup,
  restoreDatabaseToTest,
  listAvailableBackups,
  getBackupSystemStatus,
} from '../services/backup.service.ts';
import { loadBackupConfig } from '../../scripts/backup/config.ts';

export const backupRouter = Router();

// Restrict entire backup router to SUPER_ADMIN and PRINCIPAL (Requirement 9)
backupRouter.use(requireAuth);
backupRouter.use(requirePasswordChangeClear);
backupRouter.use(requireRoles(ROLES.SUPER_ADMIN, ROLES.PRINCIPAL));

/**
 * GET /api/admin/backups
 * Returns list of verified backup files.
 */
backupRouter.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const backups = listAvailableBackups();
    res.json({
      backups,
      count: backups.length,
    });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to retrieve backup list',
      details: (err as Error).message,
    });
  }
});

/**
 * GET /api/admin/backups/status
 * Returns system readiness, storage metrics, tool paths, and retention configurations.
 */
backupRouter.get('/status', async (_req: Request, res: Response): Promise<void> => {
  try {
    const status = await getBackupSystemStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to retrieve backup status',
      details: (err as Error).message,
    });
  }
});

/**
 * POST /api/admin/backups/run
 * Triggers an immediate database backup on demand.
 */
backupRouter.post('/run', validateCsrf, async (req: Request, res: Response): Promise<void> => {
  try {
    const requestedType = req.body?.type;
    const type = requestedType === 'weekly' ? 'weekly' : 'daily';

    const result = await createDatabaseBackup({
      type,
      triggeredBy: String(req.user?.id || 'ADMIN'),
      isManual: true,
    });

    res.json({
      message: `${type.toUpperCase()} database backup completed successfully`,
      backup: result,
    });
  } catch (err) {
    const errorMsg = (err as Error).message;
    res.status(500).json({
      error: 'Database backup failed',
      details: errorMsg,
    });
  }
});

/**
 * POST /api/admin/backups/test-restore
 * Executes safe restoration test to a separate/test database (Requirement 8).
 */
backupRouter.post('/test-restore', validateCsrf, async (req: Request, res: Response): Promise<void> => {
  try {
    const config = loadBackupConfig();
    const { fileName, targetDatabase, allowOverwriteLive } = req.body || {};

    let targetFilePath: string;

    if (fileName) {
      // Prevent path traversal
      const safeName = path.basename(String(fileName));
      const dailyPath = path.join(config.destinations.internalDir, 'daily', safeName);
      const weeklyPath = path.join(config.destinations.internalDir, 'weekly', safeName);

      if (fs.existsSync(dailyPath)) {
        targetFilePath = dailyPath;
      } else if (fs.existsSync(weeklyPath)) {
        targetFilePath = weeklyPath;
      } else {
        res.status(404).json({
          error: `Backup file '${safeName}' was not found in backup storage`,
        });
        return;
      }
    } else {
      // Pick the latest available backup
      const backups = listAvailableBackups();
      if (backups.length === 0) {
        res.status(404).json({
          error: 'No backups available to restore',
        });
        return;
      }
      targetFilePath = backups[0].filePath;
    }

    const restoreResult = await restoreDatabaseToTest(targetFilePath, {
      targetDatabase: targetDatabase ? String(targetDatabase).trim() : undefined,
      allowOverwriteLive: Boolean(allowOverwriteLive),
      actorId: req.user?.id,
    });

    res.json({
      message: `Test restoration completed and verified successfully`,
      result: restoreResult,
    });
  } catch (err) {
    res.status(500).json({
      error: 'Test restoration failed',
      details: (err as Error).message,
    });
  }
});

/**
 * GET /api/admin/backups/download/:fileName
 * Secure streaming download restricted to authorized administrators (Requirement 9).
 * Path traversal strictly prevented.
 */
backupRouter.get('/download/:fileName', async (req: Request, res: Response): Promise<void> => {
  try {
    const { fileName } = req.params;
    const safeName = path.basename(fileName);

    // Validate safe naming pattern
    if (!/^kamch_erp_[a-zA-Z0-9_.-]+$/.test(safeName) || (!safeName.endsWith('.sql') && !safeName.endsWith('.sha256'))) {
      res.status(400).json({
        error: 'Invalid backup filename requested',
      });
      return;
    }

    const config = loadBackupConfig();
    const dailyPath = path.join(config.destinations.internalDir, 'daily', safeName);
    const weeklyPath = path.join(config.destinations.internalDir, 'weekly', safeName);

    let filePath: string | null = null;
    if (fs.existsSync(dailyPath)) {
      filePath = dailyPath;
    } else if (fs.existsSync(weeklyPath)) {
      filePath = weeklyPath;
    }

    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({
        error: 'Backup file not found',
      });
      return;
    }

    // Record audit log for security compliance
    void recordAuditLog({
      actorId: req.user?.id || null,
      action: 'DATABASE_BACKUP_DOWNLOADED',
      targetType: 'BACKUP_FILE',
      targetId: safeName,
      ipAddress: req.ip || null,
      details: { fileName: safeName },
    });

    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Content-Type', safeName.endsWith('.sha256') ? 'text/plain' : 'application/sql');
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to download backup file',
      details: (err as Error).message,
    });
  }
});
