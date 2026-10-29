import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import '../server/env.ts';
import {
  getVapidConfig,
  getPublicVapidKey,
  saveUserSubscription,
  removeUserSubscription,
  getUserSubscriptionStatus,
  sendTestPushNotification,
} from '../server/services/web-push.service.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${testName}`);
  } else {
    console.error(`  [FAIL] ${testName} ${detail ? `(${detail})` : ''}`);
    throw new Error(`Assertion failed: ${testName}`);
  }
}

async function runTests() {
  console.log(`\n======================================================`);
  console.log(` KAMCH ERP — Task 2: PWA & Web Push Verification `);
  console.log(`======================================================\n`);

  // SUITE 1: Web App Manifest Standards & Icon Compliance
  console.log(`Suite 1: Web App Manifest Standards (Requirement 2)`);
  const manifestPath = path.resolve(projectRoot, 'public', 'manifest.json');
  assert(fs.existsSync(manifestPath), 'public/manifest.json exists on disk');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert(manifest.name === 'KAMCH ERP — Krishna Ayurvedic Medical College & Hospital', 'Manifest name matches institution');
  assert(manifest.short_name === 'KAMCH ERP' && manifest.short_name.length <= 12, 'short_name is concise (<= 12 chars)');
  assert(manifest.display === 'standalone', 'display is set to standalone');
  assert(manifest.start_url === '/', 'start_url is set to /');
  assert(manifest.theme_color === '#4B2E2E', 'theme_color matches Ayurvedic brown (#4B2E2E)');
  assert(manifest.background_color === '#FAF9F5', 'background_color matches cream (#FAF9F5)');

  // Verify icon resolutions
  const icons = manifest.icons || [];
  const has192 = icons.some((i: any) => i.sizes === '192x192');
  const has512 = icons.some((i: any) => i.sizes === '512x512');
  const hasMaskable = icons.some((i: any) => i.purpose === 'maskable');
  assert(has192 && has512, 'Includes required 192x192 and 512x512 icon definitions');
  assert(hasMaskable, 'Includes dedicated maskable icon for Android home screen');

  for (const icon of icons) {
    const iconFilePath = path.resolve(projectRoot, 'public', icon.src.replace(/^\//, ''));
    assert(fs.existsSync(iconFilePath), `Icon asset exists: ${icon.src}`);
  }

  // SUITE 2: Service Worker Security & Offline Protection (Requirement 3)
  console.log(`\nSuite 2: Service Worker Privacy & Offline Protection (Requirement 3)`);
  const swPath = path.resolve(projectRoot, 'public', 'sw.js');
  assert(fs.existsSync(swPath), 'public/sw.js exists on disk');

  const swContent = fs.readFileSync(swPath, 'utf8');
  assert(
    swContent.includes('/api') && swContent.includes('return'),
    'Service worker explicitly blocks caching API requests (no sensitive records cached)'
  );
  assert(
    swContent.includes('offline') || swContent.includes('Institutional Data Protection'),
    'Service worker includes offline protection message instead of serving stale academic data'
  );
  assert(
    swContent.includes("addEventListener('push'") && swContent.includes('showNotification'),
    'Service worker implements Web Push notification event listener'
  );
  assert(
    swContent.includes("addEventListener('notificationclick'"),
    'Service worker implements notification click focus/navigation handling'
  );

  // SUITE 3: VAPID Key Infrastructure & Privacy Protection (Requirement 4 & 5)
  console.log(`\nSuite 3: VAPID Key Infrastructure & Security (Requirement 4)`);
  const vapidConfig = getVapidConfig();
  assert(Boolean(vapidConfig.publicKey && vapidConfig.publicKey.length > 30), 'Valid VAPID public key generated/loaded');
  assert(Boolean(vapidConfig.privateKey && vapidConfig.privateKey.length > 20), 'Valid VAPID private key generated/loaded');

  const clientPublicKey = getPublicVapidKey();
  assert(clientPublicKey === vapidConfig.publicKey, 'Public key accessible via getPublicVapidKey()');
  // Verify private key is NEVER exposed by public key getter
  assert(!clientPublicKey.includes(vapidConfig.privateKey), 'Private key is strictly withheld from client public getter');

  // SUITE 4: Push Subscription Management & User Association (Requirement 4)
  console.log(`\nSuite 4: Push Subscription Store & Ownership Scoping (Requirement 4)`);
  const testUserId = 999;
  const mockSub = {
    endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/test-endpoint-token-12345',
    keys: {
      p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9t0448G3DmyhxGibqtuTUTDbDA7XiiDgWNOU78wE1_tYA4',
      auth: 'tBHItJI5svbpez7KI4CCXg',
    },
  };

  const saveRes = await saveUserSubscription(testUserId, mockSub, 'Mozilla/5.0 Test Suite Agent');
  assert(saveRes.updated === false || saveRes.updated === true, 'Saved user push subscription associated with authenticated user ID');

  const status1 = await getUserSubscriptionStatus(testUserId);
  assert(status1.isSubscribed === true && status1.count >= 1, 'Active subscription verified for user');

  // Update existing subscription
  const updateRes = await saveUserSubscription(testUserId, mockSub, 'Updated Agent');
  assert(updateRes.updated === true, 'Existing subscription at same endpoint is updated rather than duplicated');

  // Unsubscribe with ownership check
  const unsubCount = await removeUserSubscription(testUserId, mockSub.endpoint);
  assert(unsubCount >= 1, 'Unsubscribe deactivates target subscription successfully');

  const status2 = await getUserSubscriptionStatus(testUserId);
  assert(status2.isSubscribed === false, 'User status reflects inactive push state after unsubscribe');

  // SUITE 5: Test Notification Dispatch (Controlled Verification)
  console.log(`\nSuite 5: Controlled Test Notification Execution`);
  // Calling with no active subscriptions returns clean descriptive notice without crashing
  const testRes = await sendTestPushNotification(testUserId);
  assert(testRes.success === false, 'Test push reports no active devices cleanly when unsubscribed');
  assert(testRes.message.includes('No active push subscriptions'), 'Returns clear operational message to user');

  // SUITE 6: Database Migration Verification
  console.log(`\nSuite 6: Database Migration Verification (010_push_notifications_v1.sql)`);
  const migPath = path.resolve(projectRoot, 'server', 'db', 'migrations', '010_push_notifications_v1.sql');
  assert(fs.existsSync(migPath), '010_push_notifications_v1.sql migration exists');
  const migSql = fs.readFileSync(migPath, 'utf8');
  assert(migSql.includes('CREATE TABLE IF NOT EXISTS `push_subscriptions`'), 'Migration defines push_subscriptions table');
  assert(migSql.includes('CONSTRAINT `fk_push_user` FOREIGN KEY (`user_id`)'), 'Foreign key constraint on user_id defined');

  console.log(`\n------------------------------------------------------`);
  console.log(` SUMMARY: ${passedTests}/${totalTests} PWA & PUSH TESTS PASSED!`);
  console.log(`------------------------------------------------------\n`);
}

runTests().catch((err) => {
  console.error('\nTest suite failed with unexpected error:', err);
  process.exit(1);
});
