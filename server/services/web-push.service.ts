import webpush from 'web-push';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool } from '../db.ts';
import { logInfo, logError } from './logger.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const devVapidFile = path.resolve(projectRoot, '.vapid-keys.json');

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

let activeVapidConfig: VapidConfig | null = null;

/**
 * Initializes and returns VAPID configuration.
 * Prioritizes environment variables. If missing in development, generates and
 * persists a local development keypair so push testing works out of the box.
 */
export function getVapidConfig(): VapidConfig {
  if (activeVapidConfig) {
    return activeVapidConfig;
  }

  const envPublic = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPrivate = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@kamch.ac.in';

  if (envPublic && envPrivate) {
    activeVapidConfig = {
      publicKey: envPublic,
      privateKey: envPrivate,
      subject,
    };
    webpush.setVapidDetails(subject, envPublic, envPrivate);
    logInfo('PUSH', 'Initialized Web Push with environment VAPID credentials');
    return activeVapidConfig;
  }

  if (process.env.NODE_ENV === 'production') {
    logError(
      'PUSH_CONFIG',
      'WARNING: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not configured in production environment variables. Web Push requires static VAPID keys in production .env for persistent subscriptions across container restarts.'
    );
  }

  // Check if development key file exists
  if (fs.existsSync(devVapidFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(devVapidFile, 'utf8'));
      if (data.publicKey && data.privateKey) {
        activeVapidConfig = {
          publicKey: data.publicKey,
          privateKey: data.privateKey,
          subject,
        };
        webpush.setVapidDetails(subject, data.publicKey, data.privateKey);
        logInfo('PUSH', 'Loaded development VAPID credentials from .vapid-keys.json');
        return activeVapidConfig;
      }
    } catch {
      // Regenerate if malformed
    }
  }

  // Generate new development VAPID pair
  const keys = webpush.generateVAPIDKeys();
  activeVapidConfig = {
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    subject,
  };

  try {
    fs.writeFileSync(devVapidFile, JSON.stringify(activeVapidConfig, null, 2), 'utf8');
  } catch {
    // Non-fatal if filesystem is read-only
  }

  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  logInfo(
    'PUSH',
    'Generated new local development VAPID keypair (For production, configure VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env)'
  );

  return activeVapidConfig;
}

/**
 * Returns the public VAPID key (safe to send to clients).
 * Private key is NEVER exposed to the frontend.
 */
export function getPublicVapidKey(): string {
  const config = getVapidConfig();
  return config.publicKey;
}

export interface ClientPushSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/**
 * Saves or updates a user's Web Push subscription.
 */
export async function saveUserSubscription(
  userId: number,
  subscription: ClientPushSubscription,
  userAgent?: string
): Promise<{ id?: number; updated: boolean }> {
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    throw new Error('Invalid push subscription structure');
  }

  const pool = getPool();

  // Check if subscription with this endpoint already exists for this user
  const [existing] = await pool.query<any[]>(
    'SELECT id FROM push_subscriptions WHERE user_id = ? AND endpoint = ? LIMIT 1',
    [userId, subscription.endpoint]
  );

  if (existing && existing.length > 0) {
    await pool.query(
      `UPDATE push_subscriptions 
       SET p256dh = ?, auth = ?, user_agent = ?, is_active = TRUE, updated_at = NOW() 
       WHERE id = ?`,
      [subscription.keys.p256dh, subscription.keys.auth, userAgent || null, existing[0].id]
    );
    return { id: existing[0].id, updated: true };
  }

  const [insertResult] = await pool.query<any>(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, is_active)
     VALUES (?, ?, ?, ?, ?, TRUE)`,
    [userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, userAgent || null]
  );

  return { id: insertResult?.insertId, updated: false };
}

/**
 * Deactivates a user's subscription, ensuring the user owns the subscription.
 */
export async function removeUserSubscription(userId: number, endpoint?: string): Promise<number> {
  const pool = getPool();

  if (endpoint) {
    const [result] = await pool.query<any>(
      'UPDATE push_subscriptions SET is_active = FALSE WHERE user_id = ? AND endpoint = ?',
      [userId, endpoint]
    );
    return result?.affectedRows || 0;
  }

  const [result] = await pool.query<any>(
    'UPDATE push_subscriptions SET is_active = FALSE WHERE user_id = ?',
    [userId]
  );
  return result?.affectedRows || 0;
}

/**
 * Checks if a user has at least one active push subscription.
 */
export async function getUserSubscriptionStatus(userId: number): Promise<{ isSubscribed: boolean; count: number }> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    'SELECT COUNT(*) as cnt FROM push_subscriptions WHERE user_id = ? AND is_active = TRUE',
    [userId]
  );
  const count = Number(rows?.[0]?.cnt || 0);
  return {
    isSubscribed: count > 0,
    count,
  };
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/**
 * Sends a push notification to all active devices registered to a specific user.
 * Automatically marks expired or invalid subscriptions as inactive.
 */
export async function sendPushNotificationToUser(
  userId: number,
  payload: PushNotificationPayload
): Promise<{ sent: number; failed: number; deactivated: number }> {
  // Ensure VAPID is initialized
  getVapidConfig();

  const pool = getPool();
  const [subscriptions] = await pool.query<any[]>(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? AND is_active = TRUE',
    [userId]
  );

  if (!subscriptions || subscriptions.length === 0) {
    return { sent: 0, failed: 0, deactivated: 0 };
  }

  let sent = 0;
  let failed = 0;
  let deactivated = 0;

  const notificationString = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || '/',
    tag: payload.tag || 'kamch-notification',
  });

  for (const sub of subscriptions) {
    const pushSub = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.p256dh,
        auth: sub.auth,
      },
    };

    try {
      await webpush.sendNotification(pushSub, notificationString);
      sent++;
    } catch (err: any) {
      failed++;
      const statusCode = err?.statusCode;

      // 404 or 410 indicates subscription has expired or unsubscribed on browser side
      if (statusCode === 404 || statusCode === 410) {
        try {
          await pool.query('UPDATE push_subscriptions SET is_active = FALSE WHERE id = ?', [sub.id]);
          deactivated++;
          logInfo('PUSH', `Deactivated expired subscription ID ${sub.id} (HTTP ${statusCode})`);
        } catch {
          // Non-fatal
        }
      } else {
        logError('PUSH_DELIVERY', `Failed to deliver push to subscription ID ${sub.id}`, err);
      }
    }
  }

  return { sent, failed, deactivated };
}

/**
 * Sends a controlled test notification to verify Web Push infrastructure.
 */
export async function sendTestPushNotification(
  userId: number
): Promise<{ success: boolean; sent: number; failed: number; message: string }> {
  const result = await sendPushNotificationToUser(userId, {
    title: 'KAMCH ERP — Push Test',
    body: 'Web Push notifications are active and verified for your institutional account.',
    url: '/',
    tag: 'test-push',
  });

  if (result.sent > 0) {
    return {
      success: true,
      sent: result.sent,
      failed: result.failed,
      message: `Test notification sent successfully to ${result.sent} active device(s).`,
    };
  }

  if (result.failed > 0) {
    return {
      success: false,
      sent: 0,
      failed: result.failed,
      message: `Push service rejected delivery (failed on ${result.failed} endpoint(s)). Subscriptions may have expired.`,
    };
  }

  return {
    success: false,
    sent: 0,
    failed: 0,
    message: 'No active push subscriptions found for this account. Please enable notifications on this device first.',
  };
}
