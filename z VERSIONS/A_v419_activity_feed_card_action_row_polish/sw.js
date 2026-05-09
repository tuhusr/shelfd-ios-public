const CACHE = 'shelfd-v419-activity-feed-card-action-row-polish';

const STATIC_CACHE_PATHS = [
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/app-icon-1024.png',
  '/favicon.ico',
  '/icon-32.png',
];

function isAlwaysFreshAsset(url) {
  return url.pathname === '/'
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('.js')
    || url.pathname.endsWith('.css')
    || url.pathname.endsWith('.json')
    || url.pathname.endsWith('.webmanifest')
    || url.pathname === '/script.js'
    || url.pathname === '/sw.js';
}

async function fetchFresh(request) {
  return fetch(request, {
    cache: 'no-store'
  });
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(STATIC_CACHE_PATHS)).catch(() => {})
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key !== CACHE && /^shelfd-/i.test(key))
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate' || isAlwaysFreshAsset(url)) {
    event.respondWith(fetchFresh(request));
    return;
  }

  event.respondWith(cacheFirstStatic(request));
});
