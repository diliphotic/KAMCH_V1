// ==============================================================================
// KAMCH ERP — Service Worker (PWA Shell & Secure Web Push Notifications)
// Security Guarantees:
// 1. NEVER caches API responses, student data, fees, marks, or credentials.
// 2. Network-first strategy for app navigation to prevent stale version lock-in.
// 3. Clear institutional offline messaging rather than showing stale records.
// 4. Standard Web Push API event handling.
// ==============================================================================

const CACHE_NAME = 'kamch-erp-shell-v2';

const STATIC_SHELL_ASSETS = [
  '/',
  '/manifest.json',
  '/assets/kamch-logo.png',
  '/assets/kamch-logo.svg',
  '/assets/pwa-192x192.png',
  '/assets/pwa-512x512.png',
  '/assets/apple-touch-icon.png',
];

const OFFLINE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Offline — KAMCH ERP</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #FAF9F5;
      color: #1c1917;
      margin: 0;
      padding: 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      box-sizing: border-box;
      text-align: center;
    }
    .card {
      background: #ffffff;
      border: 1px solid #e7e5e4;
      border-top: 4px solid #4B2E2E;
      border-radius: 12px;
      padding: 32px 24px;
      max-width: 440px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.06);
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 600;
      color: #78350f;
      background: #fef3c7;
      border-radius: 9999px;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 18px;
      color: #4B2E2E;
      margin: 0 0 12px;
      font-weight: 700;
    }
    p {
      font-size: 13px;
      color: #57534e;
      line-height: 1.5;
      margin: 0 0 20px;
    }
    .btn {
      display: inline-block;
      background: #4B2E2E;
      color: #FAF9F5;
      padding: 8px 18px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      text-decoration: none;
      border: none;
      cursor: pointer;
    }
    .btn:hover {
      background: #382222;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Connection Required</div>
    <h1>Institutional Data Protection</h1>
    <p>You are currently offline. For academic integrity and privacy, KAMCH ERP does not store live student records, internal marks, fees, or session tokens offline.</p>
    <p>Please reconnect to the institutional network or internet to continue.</p>
    <button class="btn" onclick="window.location.reload()">Retry Connection</button>
  </div>
</body>
</html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_SHELL_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. STRICT PRIVACY: NEVER cache, intercept or store any API or authentication call
  if (
    url.pathname.startsWith('/api') ||
    url.pathname.includes('/api/') ||
    event.request.method !== 'GET'
  ) {
    return;
  }

  // 2. Navigation Requests: Network-first to ensure users never run a stale app version
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cachedShell = await caches.match('/');
        if (cachedShell) {
          return cachedShell;
        }
        return new Response(OFFLINE_HTML, {
          status: 503,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      })
    );
    return;
  }

  // 3. Static Assets: Network-first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Cache valid static responses (fonts, images, scripts)
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          (url.pathname.startsWith('/assets/') || url.pathname.endsWith('.svg') || url.pathname.endsWith('.png'))
        ) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        return new Response('Offline resource unavailable', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain' },
        });
      })
  );
});

// ==============================================================================
// WEB PUSH NOTIFICATIONS
// ==============================================================================

self.addEventListener('push', (event) => {
  let payload = {
    title: 'KAMCH ERP Notification',
    body: 'You have a new update from Krishna Ayurvedic Medical College & Hospital.',
    url: '/',
  };

  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload.body = event.data.text() || payload.body;
    }
  }

  const notificationOptions = {
    body: payload.body,
    icon: '/assets/pwa-192x192.png',
    badge: '/assets/pwa-192x192.png',
    data: {
      url: payload.url || '/',
      timestamp: Date.now(),
    },
    tag: payload.tag || 'kamch-erp-notification',
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, notificationOptions)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
