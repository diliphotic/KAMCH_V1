import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import '../env.ts';
import { getPool, checkDatabaseConnection } from '../db.ts';
import { runAdditiveMigrations } from './migrate.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaPath = path.resolve(__dirname, 'schema.sql');

interface InitOptions {
  superadminPassword?: string;
  superadminUsername?: string;
  superadminEmail?: string;
}

/**
 * Extracts password from command line arguments (--password=xxx) or environment variables.
 */
function getPasswordFromArgsOrEnv(): string | undefined {
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (arg.startsWith('--password=')) {
      return arg.split('=')[1];
    }
  }
  const envPwd = process.env.INITIAL_SUPERADMIN_PASSWORD;
  if (envPwd === 'your_initial_superadmin_password_here') {
    return undefined;
  }
  return envPwd;
}

/**
 * Splits SQL schema file into individual executable statements.
 */
function splitSqlStatements(sqlContent: string): string[] {
  // Remove multi-line comments and single-line comments
  const cleanSql = sqlContent
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')
    .trim();

  return cleanSql
    .split(';')
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt.length > 0);
}

/**
 * Safe, idempotent database schema initialization and Super Admin provisioning.
 */
export async function initializeDatabase(options?: InitOptions): Promise<{ success: boolean; message: string }> {
  console.log('[KAMCH ERP Database] Starting schema initialization...');

  // 1. Verify database pool reachability
  const health = await checkDatabaseConnection();
  if (!health.connected) {
    const errorMsg = `Database is not reachable (${health.code || 'UNKNOWN'}). Ensure MySQL service is running and credentials in .env are correct.`;
    console.error(`[KAMCH ERP Database] Initialization Aborted: ${errorMsg}`);
    return { success: false, message: errorMsg };
  }

  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    // 2. Read schema.sql
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found at ${schemaPath}`);
    }

    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    const statements = splitSqlStatements(schemaSql);

    console.log(`[KAMCH ERP Database] Executing ${statements.length} schema statements...`);

    // Execute each schema statement sequentially
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      try {
        await connection.query(stmt);
      } catch (err) {
        const error = err as { sqlMessage?: string; message?: string };
        throw new Error(`Failed executing schema statement ${i + 1}: ${error.sqlMessage || error.message}`);
      }
    }

    // 2b. Run safe, tracked additive migrations
    await runAdditiveMigrations(connection);

    console.log('[KAMCH ERP Database] Core tables, roles, and additive migrations verified successfully.');

    // 3. Super Admin Account Setup (Idempotent)
    const [superAdminRoleRows] = await connection.query<any[]>(
      'SELECT id FROM roles WHERE code = ? LIMIT 1',
      ['SUPER_ADMIN']
    );

    if (!superAdminRoleRows || superAdminRoleRows.length === 0) {
      throw new Error("Role 'SUPER_ADMIN' not found after schema seeding.");
    }

    const superAdminRoleId = superAdminRoleRows[0].id;

    // Check if any Super Admin account already exists
    const [existingAdminRows] = await connection.query<any[]>(
      'SELECT id, username, email FROM users WHERE role_id = ? LIMIT 1',
      [superAdminRoleId]
    );

    if (existingAdminRows && existingAdminRows.length > 0) {
      console.log(
        `[KAMCH ERP Database] Super Admin account already exists (username: '${existingAdminRows[0].username}'). Existing credentials and password hash preserved.`
      );
    } else {
      // Super Admin does not exist: provision initial account
      const username = options?.superadminUsername || process.env.INITIAL_SUPERADMIN_USERNAME || 'superadmin';
      const email = options?.superadminEmail || process.env.INITIAL_SUPERADMIN_EMAIL || 'admin@kamch.ac.in';
      const initialPassword = options?.superadminPassword || getPasswordFromArgsOrEnv();

      if (!initialPassword || initialPassword.trim().length < 8) {
        const warning =
          `[KAMCH ERP Database] Super Admin account not created: ` +
          `A password of at least 8 characters must be provided via the INITIAL_SUPERADMIN_PASSWORD environment variable or --password argument. ` +
          `Run: npm run db:init -- --password="YourSecurePasswordHere"`;
        console.warn(warning);
        return {
          success: true,
          message: 'Schema initialized. Super Admin creation pending password provision.',
        };
      }

      // Hash password using bcryptjs with cost factor 12
      const saltRounds = 12;
      const passwordHash = await bcrypt.hash(initialPassword.trim(), saltRounds);

      // Insert Super Admin with must_change_password = TRUE
      const [insertResult] = await connection.query<any>(
        `INSERT INTO users 
          (username, email, password_hash, role_id, full_name, must_change_password, failed_attempts, is_locked, is_suspended)
         VALUES (?, ?, ?, ?, ?, TRUE, 0, FALSE, FALSE)`,
        [username.trim(), email.trim(), passwordHash, superAdminRoleId, 'KAMCH System Administrator']
      );

      const newUserId = insertResult.insertId;

      // Log security audit record
      await connection.query(
        `INSERT INTO audit_logs (actor_id, action, target_type, target_id, ip_address, details)
         VALUES (?, 'INITIAL_SUPERADMIN_SEEDED', 'USER', ?, '127.0.0.1', ?)`,
        [
          newUserId,
          String(newUserId),
          JSON.stringify({ username, email, seededAt: new Date().toISOString() }),
        ]
      );

      console.log(
        `[KAMCH ERP Database] Initial Super Admin account created successfully (username: '${username}'). Must change password upon first login.`
      );
    }

    console.log('[KAMCH ERP Database] Database initialization completed successfully.');
    return { success: true, message: 'Database initialized successfully.' };
  } catch (err) {
    const error = err as { sqlMessage?: string; message?: string };
    console.error('[KAMCH ERP Database] Initialization Error:', error.sqlMessage || error.message);
    return { success: false, message: error.sqlMessage || error.message || 'Unknown database initialization error' };
  } finally {
    connection.release();
  }
}

// Allow direct execution via command line: tsx server/db/init.ts
if (process.argv[1] && process.argv[1].endsWith('init.ts')) {
  initializeDatabase()
    .then((result) => {
      if (!result.success) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('[KAMCH ERP Database] Fatal error:', err);
      process.exit(1);
    });
}
