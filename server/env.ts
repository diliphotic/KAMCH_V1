import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root is one level up from server/
export const projectRoot = path.resolve(__dirname, '..');
export const envPath = path.resolve(projectRoot, '.env');

export interface EnvDiagnostics {
  envPath: string;
  envExists: boolean;
  loadedKeys: string[];
}

/**
 * Robustly parses .env file content handling UTF-8, UTF-8 with BOM,
 * and Windows PowerShell UTF-16 LE redirections.
 */
function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    const buffer = fs.readFileSync(filePath);
    let content: string;

    // Detect UTF-16 LE (common in Windows PowerShell redirection)
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
      content = buffer.toString('utf16le');
    } else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
      content = buffer.swap16().toString('utf16le');
    } else {
      content = buffer.toString('utf8');
    }

    // Strip UTF-8 BOM if present
    if (content.charCodeAt(0) === 0xfeff) {
      content = content.slice(1);
    }

    return dotenv.parse(content);
  } catch (err) {
    console.warn('[KAMCH ERP Config] Failed to read .env file:', (err as Error).message);
    return {};
  }
}

// Load and inject project-root .env into process.env before anything else
export function loadProjectEnv(): EnvDiagnostics {
  const envExists = fs.existsSync(envPath);
  const parsed = parseEnvFile(envPath);
  const loadedKeys: string[] = [];

  for (const [key, value] of Object.entries(parsed)) {
    // Inject parsed values into process.env if not already set or override from file
    process.env[key] = value;
    loadedKeys.push(key);
  }

  return {
    envPath,
    envExists,
    loadedKeys,
  };
}

// Immediate eager load upon module evaluation
export const envDiagnostics = loadProjectEnv();

export interface DatabaseEnvConfig {
  host: string | undefined;
  port: number;
  user: string | undefined;
  password: string | undefined;
  database: string | undefined;
  connectionLimit: number;
  isHostExplicit: boolean;
  isUserExplicit: boolean;
  isPasswordDefined: boolean;
  isDatabaseExplicit: boolean;
}

/**
 * Reads database credentials strictly from environment without silent substitution.
 */
export function getDatabaseEnvConfig(): DatabaseEnvConfig {
  const host = process.env.DB_HOST?.trim();
  const rawPort = process.env.DB_PORT?.trim();
  const port = rawPort && !isNaN(Number(rawPort)) ? Number(rawPort) : 3306;
  const user = process.env.DB_USER?.trim();
  const password = process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : undefined;
  const database = process.env.DB_NAME?.trim();
  const rawLimit = process.env.DB_CONNECTION_LIMIT?.trim();
  const connectionLimit = rawLimit && !isNaN(Number(rawLimit)) ? Number(rawLimit) : 10;

  return {
    host,
    port,
    user,
    password,
    database,
    connectionLimit,
    isHostExplicit: Boolean(host),
    isUserExplicit: Boolean(user),
    isPasswordDefined: process.env.DB_PASSWORD !== undefined,
    isDatabaseExplicit: Boolean(database),
  };
}
