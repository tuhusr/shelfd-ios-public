const CACHE = 'shelfd-v359-aggressive-refresh';

const PRECACHE = [
  '/',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/site.webmanifest',
];

function isAppShellAsset(url) {
  return url.pathname === '/'
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('.js')
    || url.pathname.endsWith('.css')
    || url.pathname.endsWith('.json')
    || url.pathname.endsWith('.webmanifest')
    || url.pathname === '/script.js'
    || url.pathname === '/sw.js';
}

async function networkFirst(request, fallbackPath = '/') {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.ok) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return caches.match(fallbackPath);
  }
}

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin requests
  if (request.method !== 'GET' || url.origin !== location.origin) return;

  // API calls — always go to the network, never cache
  if (url.pathname.startsWith('/api/')) return;

  // Navigation (HTML pages) — network first, fall back to cached shell
  if (request.mode === 'navigate') {
    e.respondWith(networkFirst(request, '/'));
    return;
  }

  // Core app shell assets — always try network first so PWAs don't get stuck on stale JS/CSS.
  if (isAppShellAsset(url)) {
    e.respondWith(networkFirst(request, '/'));
    return;
  }

  // Other static assets — cache first, then network (cache the response for next time)
  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(request, clone));
        }
        return res;
      });
    })
  );
});
