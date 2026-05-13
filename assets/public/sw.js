/* v746: bumped CACHE name on every meaningful deploy so the SW bytes
   differ from the old one. That forces the browser/PWA to install the
   NEW service worker, fire `activate`, and `controllerchange` ? which
   the existing live-update handler in 00-live-update-pwa.js (line 195)
   listens for and turns into a graceful splash + reload. Without this
   bump, the SW bytes were byte-identical across deploys, no new install
   happened, and PWAs sat on stale JS until the user manually deleted
   and re-added the home-screen app. */
const CACHE = 'shelfd-v937-mylist-poster-preload-cache';
const DISCOVER_POSTER_CACHE = 'screenlist-discover-posters-v1';
const MYLIST_POSTER_CACHE = 'screenlist-mylist-posters-v1';

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

async function cacheMatchOrNetwork(request) {
  try {
    for (const cacheName of [MYLIST_POSTER_CACHE, DISCOVER_POSTER_CACHE]) {
      const cache = await caches.open(cacheName);
      const cached = await cache.match(request, { ignoreVary: true }) || await cache.match(request.url, { ignoreVary: true });
      if (cached) return cached;
    }
  } catch (e) {}
  return fetch(request);
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
    const stale = keys.filter(key => key !== CACHE && /^shelfd-/i.test(key));
    await Promise.all(stale.map(key => caches.delete(key)));
    await self.clients.claim();
    /* v746: belt-and-suspenders. If at least one stale cache existed, this
       is an UPGRADE (not a first install) ? meaning open PWA windows are
       running JS bytes from the previous deploy. The live-update JS in
       00-live-update-pwa.js (line 195) listens for `controllerchange` and
       reloads via splash, but ANCIENT PWAs that never picked up that
       listener would otherwise stay stuck on stale JS forever.
       Solution: tell every open client to navigate to itself. That's a
       hard SW-driven reload that doesn't depend on the page's loaded JS
       having any update logic at all. Wrapped in try/catch because some
       browsers reject navigate() across origins or for non-top-level
       clients. */
    if (stale.length > 0) {
      try {
        const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        await Promise.all(clientsList.map(client => {
          try { return client.navigate(client.url); } catch (e) { return null; }
        }));
      } catch (e) {
        /* ignore ? controllerchange path will still fire for clients with
           the live-update listener */
      }
    }
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

  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) {
    if (request.destination === 'image') {
      event.respondWith(cacheMatchOrNetwork(request));
    }
    return;
  }
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate' || isAlwaysFreshAsset(url)) {
    event.respondWith(fetchFresh(request));
    return;
  }

  event.respondWith(cacheFirstStatic(request));
});
