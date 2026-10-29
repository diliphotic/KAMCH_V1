// KAMCH ERP — Lightweight PWA Service Worker for App Installation
// Strictly passes all API and authentication requests directly to the network.
// Does NOT cache sensitive student, financial, or session credentials.

const CACHE_NAME = 'kamch-erp-shell-v1';
const STATIC_SHELL_ASSETS = [
  '/',
  '/assets/kamch-logo.png',
  '/assets/kamch-logo.svg',
  '/manifest.json'
];

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

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // NEVER cache or intercept API requests, authentication, fees or CSRF calls
  if (url.pathname.includes('/api/') || url.pathname.startsWith('/api') || event.request.method !== 'GET') {
    return;
  }

  // Network-first strategy for app navigation to ensure latest ERP code
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cachedResponse = await caches.match(event.request);
      if (cachedResponse) {
        return cachedResponse;
      }
      return new Response('Network error or offline', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'text/plain' },
      });
    })
  );
});
