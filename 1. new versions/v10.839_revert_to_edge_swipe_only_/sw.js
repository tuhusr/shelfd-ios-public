/* v981: CACHE still changes on meaningful deploys so open clients can detect
   the new service worker, but activation no longer navigates/reloads clients.
   The page runtime shows a non-blocking "reopen app" notice instead so users
   can keep writing and saving data. */
const CACHE = 'shelfd-v10-838-dm-dismiss-animation-fix';
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
  /* v10.696: HASHED/VERSIONED URLS ARE IMMUTABLE — every <link>/<script>
     in index.html has a `?v=<version>_<description>` cache-bust. The query
     string IS the version hash, so the content at that exact URL never
     changes. Treat as cache-first (falls through to cacheFirstStatic in
     the fetch handler below). Saves multiple seconds on warm reload/PWA
     navigation because we stop re-fetching JS/CSS that hasn't changed.
     The deploy notice path in 00-live-update-pwa.js still polls /index.html
     (unversioned, network-first) so version bumps are detected without
     auto-refreshing the open app. */
  if (url.search && url.search.indexOf('v=') !== -1) return false;
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
    /* Do not navigate clients here. Open pages must remain alive across
       deploys so in-progress user edits can continue saving to Firestore. */
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
