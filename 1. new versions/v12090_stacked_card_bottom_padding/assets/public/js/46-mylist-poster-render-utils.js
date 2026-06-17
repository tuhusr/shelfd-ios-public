/* =============================================================
   46-mylist-poster-render-utils.js
   My List poster preload/cache helpers and incremental render-limit
   controls extracted from 06-mylists-render-episodes-ratings.js.
   Loaded before 06 so the main My List renderer can call these globals.
   ============================================================= */

function normalizeMyListPosterUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('//')) return `https:${raw}`;
  /* v10.235: don't rewrite same-origin worker proxy paths (e.g. MusicBrainz
     cover-art at `/api/musicbrainz/cover-art/...`) — those served the album
     poster URL fine on their own, but the old fallthrough was prepending
     the TMDB image host and turning the URL into a 404. */
  if (raw.startsWith('/api/')) return raw;
  if (raw.startsWith('/')) return `https://image.tmdb.org/t/p/original${raw}`;
  const tmdbMatch = raw.match(/^https?:\/\/image\.tmdb\.org\/t\/p\/(?:w\d+|original)(\/.+)$/i);
  if (tmdbMatch?.[1]) return `https://image.tmdb.org/t/p/original${tmdbMatch[1]}`;
  return raw;
}

const MYLIST_POSTER_CACHE = 'screenlist-mylist-posters-v1';
const MYLIST_POSTER_PREFETCH_MAX = 144;
const MYLIST_POSTER_PREFETCH_CONCURRENCY = 2;
const MYLIST_POSTER_PREFETCH_BATCH_SIZE = 10;
const MYLIST_POSTER_PREFETCH_BATCH_PAUSE_MS = 220;
const MYLIST_POSTER_MEMORY_WARM_LIMIT = 16;
let myListPosterPreloadTimer = null;
let myListPosterPreloadRunning = false;
const myListPosterPreloadSeen = new Set();
const MYLIST_INITIAL_RENDER_LIMIT = 36;
const MYLIST_LOAD_MORE_INCREMENT = 24;
const myListRenderLimits = {};
/* v11.428: deferred-fill state for the status SWIPE commit. At commit we render
   only the visible cards (a fast, flash-free landing — no full-list build spike
   for big tabs like Watched-50 lands on the 360ms settle), then append the rest
   AFTER the settle. Declared up here (before render()) to avoid a TDZ. */
let _swipeCommitVisibleCap = 0;
let _swipeFillTimer = null;
let _swipeRenderFillPending = null;

function getMyListPosterUrlForItem(item = {}, section = activeSection) {
  const isGame = section === 'games';
  const raw = isGame && typeof getScreenListDisplayGameCover === 'function'
    ? getScreenListDisplayGameCover(item)
    : (item.cover || item.poster || item.image || item.background_image || item.backgroundImage || '');
  return normalizeMyListPosterUrl(raw);
}

function addMyListPosterUrl(target, seen, url = '') {
  const clean = String(url || '').trim();
  if (!clean || seen.has(clean) || target.length >= MYLIST_POSTER_PREFETCH_MAX) return;
  try {
    const resolved = new URL(clean, window.location.href);
    if (!/^https?:$/.test(resolved.protocol)) return;
    seen.add(resolved.href);
    target.push(resolved.href);
  } catch (e) {}
}

function collectMyListPosterPreloadUrls() {
  const urls = [];
  const seen = new Set();
  document.querySelectorAll('#cards-grid .card-cover[data-poster]').forEach(node => {
    addMyListPosterUrl(urls, seen, node.dataset.poster || '');
  });

  const source = typeof getVisibleListData === 'function' ? getVisibleListData() : data;
  const sections = [activeSection, 'shows', 'anime', 'movies', 'games', 'manga', 'books']
    .filter((section, index, list) => section && list.indexOf(section) === index);
  const statuses = [activeTab, 'watching', 'planned', 'watched', 'paused', 'wishlist', 'live', 'competitive', 'party', 'dropped']
    .filter((status, index, list) => status && list.indexOf(status) === index);

  sections.forEach(section => {
    const items = Array.isArray(source?.[section]) ? source[section] : [];
    statuses.forEach(status => {
      for (const item of items) {
        if (urls.length >= MYLIST_POSTER_PREFETCH_MAX) return;
        if (status && item?.status !== status) continue;
        addMyListPosterUrl(urls, seen, getMyListPosterUrlForItem(item, section));
      }
    });
  });
  return urls;
}

function warmMyListPosterInMemory(url) {
  try {
    const img = new Image();
    img.decoding = 'async';
    img.loading = 'eager';
    img.src = url;
  } catch (e) {}
}

async function pruneMyListPosterCache(cache) {
  try {
    const keys = await cache.keys();
    if (keys.length <= MYLIST_POSTER_PREFETCH_MAX) return;
    await Promise.all(keys.slice(0, keys.length - MYLIST_POSTER_PREFETCH_MAX).map(key => cache.delete(key)));
  } catch (e) {}
}

async function persistMyListPosterUrls(urls) {
  if (!urls.length || !('caches' in window)) return;
  const cache = await caches.open(MYLIST_POSTER_CACHE);
  let cursor = 0;
  let processedSincePause = 0;
  const pause = () => new Promise(resolve => setTimeout(resolve, MYLIST_POSTER_PREFETCH_BATCH_PAUSE_MS));
  async function worker() {
    while (cursor < urls.length) {
      const url = urls[cursor++];
      if (!url || myListPosterPreloadSeen.has(url)) continue;
      myListPosterPreloadSeen.add(url);
      try {
        const cached = await cache.match(url, { ignoreVary: true });
        if (!cached) {
          const resolved = new URL(url, window.location.href);
          const crossOrigin = resolved.origin !== window.location.origin;
          const response = await fetch(url, {
            mode: crossOrigin ? 'no-cors' : 'cors',
            credentials: crossOrigin ? 'omit' : 'same-origin',
            cache: 'force-cache'
          });
          if (response && (response.ok || response.type === 'opaque')) {
            await cache.put(url, response.clone());
          }
        }
      } catch (e) {
        myListPosterPreloadSeen.delete(url);
      }
      processedSincePause += 1;
      if (processedSincePause >= MYLIST_POSTER_PREFETCH_BATCH_SIZE) {
        processedSincePause = 0;
        await pause();
      }
    }
  }
  const workers = Array.from({ length: Math.min(MYLIST_POSTER_PREFETCH_CONCURRENCY, urls.length) }, () => worker());
  await Promise.all(workers);
  await pruneMyListPosterCache(cache);
}

function scheduleMyListPosterPreload(reason = 'mylist-render') {
  if (myListPosterPreloadTimer) {
    clearTimeout(myListPosterPreloadTimer);
    myListPosterPreloadTimer = null;
  }
  myListPosterPreloadTimer = setTimeout(() => {
    myListPosterPreloadTimer = null;
    const run = async () => {
      if (myListPosterPreloadRunning || document.hidden) return;
      if (document.body?.classList.contains('main-nav-switching')) {
        scheduleMyListPosterPreload(`${reason}-after-nav`);
        return;
      }
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (connection?.saveData) return;
      const urls = collectMyListPosterPreloadUrls();
      if (!urls.length) return;
      myListPosterPreloadRunning = true;
      urls.slice(0, MYLIST_POSTER_MEMORY_WARM_LIMIT).forEach(warmMyListPosterInMemory);
      try {
        await persistMyListPosterUrls(urls);
      } catch (error) {
        console.warn('My List poster preload skipped:', reason, error);
      } finally {
        myListPosterPreloadRunning = false;
      }
    };
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => { run().catch(() => {}); }, { timeout: 1600 });
      return;
    }
    run().catch(() => {});
  }, 320);
}

function getMyListRenderLimitKey(sortKey = '') {
  return [
    viewingUser ? 'friend' : 'own',
    activeSection || '',
    activeTab || '',
    activeSection === 'games' ? normalizeGamePlayingFilter(activeGamePlayingFilter) : '',
    sortKey || (typeof getActiveSortKey === 'function' ? getActiveSortKey() : ''),
    String(searchQuery || '').trim().toLowerCase()
  ].join('|');
}

function getMyListVisibleLimit(key, total = 0) {
  const saved = Number(myListRenderLimits[key] || 0);
  return Math.max(MYLIST_INITIAL_RENDER_LIMIT, Math.min(total, saved || MYLIST_INITIAL_RENDER_LIMIT));
}

function renderMyListLoadMoreControl(showing = 0, total = 0, key = '') {
  let wrap = document.getElementById('mylist-load-more-wrap');
  const grid = document.getElementById('cards-grid');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'mylist-load-more-wrap';
    wrap.className = 'mylist-load-more-wrap';
    if (grid && grid.parentNode) grid.insertAdjacentElement('afterend', wrap);
  }
  if (!wrap) return;
  if (!total || showing >= total) {
    wrap.hidden = true;
    wrap.innerHTML = '';
    return;
  }
  wrap.hidden = false;
  wrap.innerHTML = `
    <button class="mylist-load-more-btn" type="button" data-mylist-limit-key="${escAttr(key)}" onclick="loadMoreMyListCards(this.dataset.mylistLimitKey)">
      Load more
    </button>
  `;
}

function loadMoreMyListCards(key = '') {
  const activeKey = getMyListRenderLimitKey();
  const targetKey = key || activeKey;
  if (targetKey !== activeKey) return;
  const current = Number(myListRenderLimits[targetKey] || MYLIST_INITIAL_RENDER_LIMIT);
  myListRenderLimits[targetKey] = current + MYLIST_LOAD_MORE_INCREMENT;
  render();
  requestAnimationFrame(() => {
    const wrap = document.getElementById('mylist-load-more-wrap');
    if (wrap && !wrap.hidden) wrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}
if (typeof window !== 'undefined') window.loadMoreMyListCards = loadMoreMyListCards;