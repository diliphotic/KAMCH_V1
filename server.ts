import './server/env.ts';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import { checkDatabaseConnection, getPool, getActivePersistenceMode } from './server/db.ts';
import { runAdditiveMigrations } from './server/db/migrate.ts';
import { authRouter } from './server/routes/auth.routes.ts';
import { userRouter } from './server/routes/user.routes.ts';
import { feesRouter } from './server/routes/fees.routes.ts';
import { recordsRouter } from './server/routes/records.routes.ts';
import { internalAssessmentRouter } from './server/routes/internal-assessment.routes.ts';
import { universityExamsRouter } from './server/routes/university-exams.routes.ts';
import { libraryRouter } from './server/routes/library.routes.ts';
import { leaveRouter } from './server/routes/leave.routes.ts';
import { attendanceRouter } from './server/routes/attendance.routes.ts';
import { notificationsRouter } from './server/routes/notifications.routes.ts';
import { requireAuth, requirePasswordChangeClear, requireRoles } from './server/middleware/auth.ts';
import { FEES_AND_STUDENTS_ROLES } from './server/permissions.ts';
import { logInfo, logError } from './server/services/logger.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Validate environment configuration
function validateEnvironment(): { port: number; isProduction: boolean } {
  const rawPort = process.env.PORT;
  let port = 3000;

  if (rawPort !== undefined && rawPort.trim() !== '') {
    const parsedPort = Number(rawPort);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      throw new Error(
        `[KAMCH ERP Configuration Error] Invalid PORT environment variable: "${rawPort}". Expected a positive integer between 1 and 65535.`
      );
    }
    port = parsedPort;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  return { port, isProduction };
}

const { port: PORT, isProduction } = validateEnvironment();

async function startServer() {
  const app = express();

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use(cookieParser());

  // Base Foundation Health & Architecture API endpoint (public, unauthenticated)
  app.get('/api/foundation', (_req, res) => {
    const persistence = getActivePersistenceMode();
    res.json({
      status: 'active',
      system: 'KAMCH ERP Foundation',
      institution: 'Krishna Ayurvedic Medical College and Hospital',
      database: 'MySQL (Target Architecture for future modules)',
      runtime: 'Node.js + Express',
      frontend: 'React 19 + TypeScript + Tailwind CSS',
      phase: 'Phase 1: Foundation Baseline',
      environment: {
        nodeEnv: isProduction ? 'production' : 'development',
        port: PORT,
        dbConfigured: Boolean(process.env.DB_HOST && process.env.DB_NAME),
        persistenceMode: persistence.mode,
      },
    });
  });

  // MySQL Database Verification endpoint (performs real harmless ping query without exposing credentials)
  app.get('/api/health/database', async (_req, res) => {
    try {
      const dbStatus = await checkDatabaseConnection();
      const persistence = getActivePersistenceMode();
      if (dbStatus.connected) {
        return res.status(200).json({
          status: 'connected',
          database: 'MySQL',
          targetDatabase: process.env.DB_NAME || 'kamch_erp',
          latencyMs: dbStatus.latencyMs,
          persistenceMode: persistence.mode,
          verifiedAt: new Date().toISOString(),
        });
      } else {
        return res.status(503).json({
          status: 'disconnected',
          database: 'MySQL',
          targetDatabase: process.env.DB_NAME || 'kamch_erp',
          code: dbStatus.code,
          persistenceMode: persistence.mode,
          message: dbStatus.diagnosticNote || 'Database connection failed. Operating in in-memory fallback mode.',
          verifiedAt: new Date().toISOString(),
        });
      }
    } catch {
      return res.status(500).json({
        status: 'error',
        database: 'MySQL',
        message: 'Internal error checking database connectivity.',
        verifiedAt: new Date().toISOString(),
      });
    }
  });

  // Mount Institutional Module Routers
  app.use('/api/auth', authRouter);
  app.use('/api/users', userRouter);

  // Aliases for legacy/convenience routes used across leave & notification components
  app.get('/api/departments', requireAuth, requirePasswordChangeClear, (req, res, next) => {
    req.url = '/departments';
    userRouter(req, res, next);
  });
  app.get('/api/user/teachers', requireAuth, requirePasswordChangeClear, (req, res, next) => {
    req.url = '/available-teachers';
    userRouter(req, res, next);
  });
  // Enforce Fees role boundary at mount level (blocks DEPARTMENT, LIBRARY, STUDENT, FACULTY, HOD across all /api/fees/* endpoints while preserving fees.routes.ts untouched)
  app.use(
    '/api/fees',
    requireAuth,
    requirePasswordChangeClear,
    requireRoles(...FEES_AND_STUDENTS_ROLES),
    feesRouter
  );
  app.use('/api/internal-assessment', internalAssessmentRouter);
  app.use('/api/university-exams', universityExamsRouter);
  app.use('/api/library', libraryRouter);
  app.use('/api/leave', leaveRouter);
  app.use('/api/attendance', attendanceRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api', recordsRouter);

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve static production build
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    const startupMsg = `Institutional Server running at http://localhost:${PORT} (Node: ${process.version}, PID: ${process.pid})`;
    console.log(`[KAMCH ERP] ${startupMsg}`);
    logInfo('STARTUP', startupMsg);

    // Non-blocking database connection verification & safe additive migration check on startup
    checkDatabaseConnection()
      .then(async (status) => {
        if (status.connected) {
          const dbMsg = `MySQL connection verified successfully (latency: ${status.latencyMs}ms).`;
          console.log(`[KAMCH ERP Database] ${dbMsg}`);
          logInfo('DATABASE', dbMsg);

          // Apply safe, idempotent additive migrations on connected MySQL database
          const pool = getPool();
          const conn = await pool.getConnection();
          try {
            await runAdditiveMigrations(conn);
          } catch (migErr) {
            logError('MIGRATION', 'Additive migration check encountered an issue', migErr);
          } finally {
            conn.release();
          }
        } else {
          const dbWarn = `MySQL service not reachable (${status.code || 'UNKNOWN'}). Server operational in standalone mode. Note: ${status.diagnosticNote || 'Check MySQL service'}`;
          console.warn(`[KAMCH ERP Database] ${dbWarn}`);
          logError('DATABASE', dbWarn);
        }
      })
      .catch((err) => {
        const errStr = (err as Error).message;
        console.warn('[KAMCH ERP Database] Startup connection check encountered error:', errStr);
        logError('DATABASE', 'Startup connection check encountered error', err);
      });
  });
}

// Global unhandled error logging
process.on('unhandledRejection', (reason) => {
  logError('UNHANDLED_REJECTION', 'Unhandled promise rejection in server process', reason);
});

process.on('uncaughtException', (err) => {
  logError('UNCAUGHT_EXCEPTION', 'Uncaught exception in server process', err);
  process.exit(1);
});

startServer().catch((err) => {
  console.error('[KAMCH ERP] Server failed to start:', err);
  logError('STARTUP_FAILED', 'Server failed to start during initialization', err);
  process.exit(1);
});
