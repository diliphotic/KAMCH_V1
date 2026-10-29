import { getPool } from '../db.ts';

export interface AuditLogOptions {
  actorId?: number | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  ipAddress?: string | null;
  details?: Record<string, unknown> | null;
}

/**
 * Records an immutable security or account-management audit log.
 * Never throws to the caller: failures are safely logged server-side
 * to prevent accidental denial-of-service while keeping secrets out of logs.
 */
export async function recordAuditLog({
  actorId = null,
  action,
  targetType = null,
  targetId = null,
  ipAddress = null,
  details = null,
}: AuditLogOptions): Promise<void> {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO audit_logs (actor_id, action, target_type, target_id, ip_address, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        actorId,
        action,
        targetType,
        targetId,
        ipAddress,
        details ? JSON.stringify(details) : null,
      ]
    );
  } catch (err) {
    console.warn('[KAMCH Audit] Failed to write audit record:', (err as Error).message);
  }
}
