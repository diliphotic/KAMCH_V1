import mysql, { Pool, PoolOptions } from 'mysql2/promise';
import { getDatabaseEnvConfig, envDiagnostics, DatabaseEnvConfig } from './env.ts';
import { HybridQueryHandler } from './services/db-proxy.ts';
import { MemoryDatabase } from './services/memory-db.ts';

export interface DatabaseHealthStatus {
  connected: boolean;
  code?: string;
  latencyMs?: number;
  diagnosticNote?: string;
  isFallback?: boolean;
}

let activePool: Pool | null = null;
let activeConfig: DatabaseEnvConfig | null = null;
let isFallbackActive = false;
const hybridHandler = new HybridQueryHandler();

let fallbackTxQueue: Promise<void> = Promise.resolve();

/**
 * Creates a synthetic connection object mimicking mysql2 PoolConnection for in-memory fallback,
 * including genuine serialized transaction isolation (matching InnoDB FOR UPDATE locks)
 * and state snapshotting for atomic ROLLBACK support.
 */
function createFallbackConnection(): any {
  let txSnapshot: string | null = null;
  let releaseLock: (() => void) | null = null;

  const unlock = () => {
    if (releaseLock) {
      const fn = releaseLock;
      releaseLock = null;
      fn();
    }
  };

  return {
    query: async (sql: string, params?: any[]) => {
      return hybridHandler.executeQuery(sql, params);
    },
    beginTransaction: async () => {
      const prev = fallbackTxQueue;
      let nextUnlock!: () => void;
      fallbackTxQueue = new Promise<void>((resolve) => {
        nextUnlock = resolve;
      });
      await prev;
      releaseLock = nextUnlock;
      txSnapshot = MemoryDatabase.getInstance().createSnapshot();
    },
    commit: async () => {
      txSnapshot = null;
      unlock();
    },
    rollback: async () => {
      if (txSnapshot !== null) {
        MemoryDatabase.getInstance().restoreSnapshot(txSnapshot);
        txSnapshot = null;
      }
      unlock();
    },
    release: () => {
      txSnapshot = null;
      unlock();
    },
  };
}

/**
 * Initializes or retrieves the singleton MySQL connection pool.
 * When MySQL connection is unavailable, seamlessly returns fallback pool proxy.
 */
export function getPool(): Pool {
  if (isFallbackActive) {
    return {
      query: async (sql: string, params?: any[]) => {
        return hybridHandler.executeQuery(sql, params);
      },
      getConnection: async () => {
        return createFallbackConnection();
      },
    } as unknown as Pool;
  }

  const dbConfig = getDatabaseEnvConfig();
  if (!dbConfig.isHostExplicit || !dbConfig.isDatabaseExplicit) {
    isFallbackActive = true;
    return {
      query: async (sql: string, params?: any[]) => {
        return hybridHandler.executeQuery(sql, params);
      },
      getConnection: async () => {
        return createFallbackConnection();
      },
    } as unknown as Pool;
  }

  if (activePool) {
    return activePool;
  }

  const poolOptions: PoolOptions = {
    host: dbConfig.host || '127.0.0.1',
    port: dbConfig.port || 3306,
    user: dbConfig.user || '',
    password: dbConfig.password !== undefined ? dbConfig.password : '',
    database: dbConfig.database || '',
    waitForConnections: true,
    connectionLimit: dbConfig.connectionLimit,
    maxIdle: 10,
    idleTimeout: 60000,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  };

  activePool = mysql.createPool(poolOptions);
  return activePool;
}

// Export pool proxy so existing and future modules can use `pool.query()` directly
export const pool: Pool = new Proxy({} as Pool, {
  get(_target, prop) {
    const targetPool = getPool();
    const value = (targetPool as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === 'function' ? value.bind(targetPool) : value;
  },
});

/**
 * Performs a harmless verification query (SELECT 1 AS connected).
 * Records rich, safe diagnostic logging on the server console on failure
 * while never exposing passwords, credentials, or connection strings.
 */
export async function checkDatabaseConnection(): Promise<DatabaseHealthStatus> {
  const startTime = Date.now();
  const dbConfig = getDatabaseEnvConfig();

  // If database configuration is not explicitly provided, use in-memory fallback silently
  if (!dbConfig.isHostExplicit || !dbConfig.isDatabaseExplicit) {
    isFallbackActive = true;
    return {
      connected: false,
      code: 'STANDALONE_FALLBACK',
      latencyMs: 0,
      diagnosticNote: 'No explicit MySQL configuration provided. Operating in robust in-memory standalone mode.',
      isFallback: true,
    };
  }

  const hasPassword = Boolean(dbConfig.password && dbConfig.password.length > 0);
  const passwordLength = dbConfig.password !== undefined ? dbConfig.password.length : 0;

  try {
    const currentPool = getPool();
    const connection = await currentPool.getConnection();

    try {
      await connection.query('SELECT 1 AS connected');
      const latencyMs = Date.now() - startTime;
      isFallbackActive = false;
      return { connected: true, latencyMs, isFallback: false };
    } finally {
      connection.release();
    }
  } catch (err: unknown) {
    const error = err as {
      code?: string;
      errno?: number;
      sqlState?: string;
      sqlMessage?: string;
      message?: string;
    };

    const errorCode = error.code || 'CONNECTION_FAILED';
    const latencyMs = Date.now() - startTime;

    console.warn(
      `[KAMCH ERP Database] Connection verification failed:
  Error Code    : ${errorCode} (errno: ${error.errno ?? 'N/A'}, sqlState: ${error.sqlState ?? 'N/A'})
  Server Message: ${error.sqlMessage || error.message || 'No specific SQL error message'}
  Target Config : user='${dbConfig.user ?? '<UNSET>'}', host='${dbConfig.host ?? '<UNSET>'}', port=${dbConfig.port}, database='${dbConfig.database ?? '<UNSET>'}'
  Password State: ${hasPassword ? `Password provided (${passwordLength} chars)` : dbConfig.isPasswordDefined ? 'Blank/empty password' : 'Password not defined in .env'}
  .env Location : ${envDiagnostics.envPath} (file exists: ${envDiagnostics.envExists})
  Loaded Keys   : [${envDiagnostics.loadedKeys.join(', ')}]
  Action Taken  : Activated resilient in-memory database fallback for preview execution.`
    );

    // Activate fallback mode so preview UI and tests run reliably
    isFallbackActive = true;

    return {
      connected: false,
      code: errorCode,
      latencyMs,
      diagnosticNote: error.sqlMessage || error.message,
      isFallback: true,
    };
  }
}

export function getActivePersistenceMode(): {
  mode: 'MYSQL_PERSISTENT' | 'IN_MEMORY_PREVIEW_FALLBACK';
  isFallback: boolean;
  databaseConfigured: boolean;
  targetDatabase?: string;
} {
  const dbConfig = getDatabaseEnvConfig();
  const databaseConfigured = Boolean(dbConfig.isHostExplicit && dbConfig.isDatabaseExplicit);
  return {
    mode: !isFallbackActive && databaseConfigured ? 'MYSQL_PERSISTENT' : 'IN_MEMORY_PREVIEW_FALLBACK',
    isFallback: isFallbackActive || !databaseConfigured,
    databaseConfigured,
    targetDatabase: dbConfig.database,
  };
}

