/* =============================================================================
   20-imdb-ratings.js  (v674)
   Client-side IMDb rating layer for movies + TV shows.
   - Replaces TMDB vote_average / vote_count with IMDb imdbRating / imdbVotes
     while PRESERVING the originals as item.tmdbVoteAverage / tmdbVoteCount so
     ranking helpers can use both signals.
   - Recency-aware TTL: new/trending titles refresh in 24h, classics in 30 days.
   - Two-key cache: primary (type, tmdbId), secondary (imdbId). The same
     title hits the same entry no matter which path the lookup came in from.
   - Negative results cached briefly (6h) to avoid retry spam.
   - Source-agnostic helper boundary: enrichWithImdbData(item) /
     enrichItemsWithImdbRatings(items) — implementation here is OMDb but the
     caller doesn't care. Replacing OMDb with a local IMDb dataset later means
     swapping fetchBatchFromServer / the worker route, nothing else.
   - Batch endpoint (/api/imdb/rating-batch) for bulk discover rails.
   - Single endpoint (/api/imdb/rating) for media profile pages.
   ========================================================================== */
(function() {
  'use strict';

  /* v10.985: bump cache namespace so old AI/search fallback estimates cannot
     keep displaying as IMDb ratings after this strict OMDb fix.
     v10.234: bump v8→v9 to flush any wrong-title-match values (e.g. a fuzzy
     OMDb "Obsession" cached at the wrong rating) so the worker's new strict
     title/year validation repopulates clean IMDb ratings on next fetch.
     v10.235: bump v9→v10 to flush stale OMDb-snapshot ratings cached on-device
     for recent releases (e.g. "Obsession" 3.8) so the worker's new live IMDb
     title-page extract repopulates them with the accurate value (4.1). */
  /* v11.135: v11→v12 flushes localStorage entries poisoned by the old batch
     path, which cached OMDb's lagging snapshot for recent releases (e.g.
     "Obsession" 7.6/694 → shown as 3.8) and made the media profile read that
     stale value instead of the accurate live-IMDb number. The batch endpoint now
     reads live IMDb for recent releases too, so fresh entries are correct. */
  const LS_PREFIX = 'shelfd:imdb-rating:v12:';
  const TTL_DEFAULT_MS = 3 * 24 * 60 * 60 * 1000;
  const TTL_MISS_MS = 6 * 60 * 60 * 1000;
  const memCache = new Map();
  const inflight = new Map();

  /* v10.234: gated debug. Off in production. Enable on-device with
     localStorage.setItem('shelfd:imdb-debug','1') (or window.__SHELFD_IMDB_DEBUG=true),
     then watch the console while opening a title to trace source → rating → 5-star. */
  function imdbDebugEnabled() {
    try {
      if (window.__SHELFD_IMDB_DEBUG === true) return true;
      return localStorage.getItem('shelfd:imdb-debug') === '1';
    } catch (_) { return false; }
  }
  function imdbDebugLog(...args) {
    if (imdbDebugEnabled()) { try { console.log('[imdb-debug]', ...args); } catch (_) {} }
  }

  function getCacheKey(tmdbId, type) {
    const t = String(type || '').toLowerCase() === 'movie' ? 'movie' : 'tv';
    return `${t}:${String(tmdbId || '').trim()}`;
  }

  function normalizeImdbTitleId(value) {
    const match = String(value || '').trim().match(/tt\d{7,10}/i);
    return match ? match[0].toLowerCase() : '';
  }

  function getImdbCacheKey(imdbId) {
    return `imdb:${normalizeImdbTitleId(imdbId)}`;
  }

  function getBatchResultKey(tmdbId, type, imdbId = '', fallback = '') {
    const cleanTmdbId = String(tmdbId || '').trim();
    const cleanType = String(type || '').toLowerCase() === 'movie' ? 'movie' : 'tv';
    if (cleanTmdbId) return `${cleanType}:${cleanTmdbId}`;
    const cleanImdbId = normalizeImdbTitleId(imdbId);
    if (cleanImdbId) return `imdb:${cleanImdbId}`;
    return String(fallback || '').trim();
  }

  /* Variable TTL by title recency — matches the worker policy:
       current year + future        → 24h
       last year                    → 3 days
       last 5 years                 → 7 days
       older / classics             → 30 days
       unknown / unparseable        → 7 days (default) */
  function ttlForData(data) {
    if (!data) return TTL_DEFAULT_MS;
    if (data.ok === false) return TTL_MISS_MS;
    const year = parseInt(String(data.year || '').slice(0, 4), 10);
    if (!Number.isFinite(year) || year < 1900) return TTL_DEFAULT_MS;
    const currentYear = new Date().getUTCFullYear();
    if (year >= currentYear) return 12 * 60 * 60 * 1000;
    if (year >= currentYear - 1) return 24 * 60 * 60 * 1000;
    if (year >= currentYear - 5) return TTL_DEFAULT_MS;
    return 14 * 24 * 60 * 60 * 1000;
  }

  function isEntryFresh(entry) {
    if (!entry) return false;
    if (entry.expiresAt) return Date.now() <= entry.expiresAt;
    /* Legacy entries without expiresAt — treat as default TTL. */
    if (entry.savedAt) return Date.now() - Number(entry.savedAt) < TTL_DEFAULT_MS;
    return false;
  }

  function readEntry(key) {
    const mem = memCache.get(key);
    if (mem) {
      if (isEntryFresh(mem)) return mem.data;
      memCache.delete(key);
    }
    try {
      const raw = localStorage.getItem(LS_PREFIX + key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (!entry || !entry.data) return null;
      entry.data = normalizeRatingData(entry.data);
      if (!entry.data) {
        try { localStorage.removeItem(LS_PREFIX + key); } catch (_) {}
        return null;
      }
      if (!isEntryFresh(entry)) {
        try { localStorage.removeItem(LS_PREFIX + key); } catch (_) {}
        return null;
      }
      memCache.set(key, entry);
      return entry.data;
    } catch (e) { return null; }
  }

  function writeEntry(key, entry) {
    if (!key) return;
    memCache.set(key, entry);
    try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(entry)); } catch (e) { /* quota */ }
  }

  function readCache(tmdbId, type) {
    const key = getCacheKey(tmdbId, type);
    if (key.endsWith(':')) return null;
    return readEntry(key);
  }

  function readCacheByImdbId(imdbId) {
    if (!normalizeImdbTitleId(imdbId)) return null;
    return readEntry(getImdbCacheKey(imdbId));
  }

  function writeCache(tmdbId, type, data) {
    const key = getCacheKey(tmdbId, type);
    if (key.endsWith(':')) return;
    const normalized = normalizeRatingData(data) || { ok: false };
    const ttl = ttlForData(normalized);
    const entry = { savedAt: Date.now(), expiresAt: Date.now() + ttl, data: normalized };
    writeEntry(key, entry);
    /* Secondary IMDb-ID-keyed copy so a future direct-imdb lookup hits cache. */
    if (normalized && normalized.imdbId) writeEntry(getImdbCacheKey(normalized.imdbId), entry);
  }

  function writeCacheByImdbId(imdbId, data) {
    const cleanImdbId = normalizeImdbTitleId(imdbId);
    if (!cleanImdbId) return;
    const normalized = normalizeRatingData(data) || { ok: false };
    const ttl = ttlForData(normalized);
    const entry = { savedAt: Date.now(), expiresAt: Date.now() + ttl, data: normalized };
    writeEntry(getImdbCacheKey(cleanImdbId), entry);
  }

  function parseImdbVotes(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const clean = String(value || '').replace(/[^0-9]/g, '');
    if (!clean) return 0;
    const n = Number(clean);
    return Number.isFinite(n) ? n : 0;
  }

  function parseMetascore(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const clean = String(value || '').trim();
    if (!clean || clean.toUpperCase() === 'N/A') return 0;
    const n = Number(clean.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function parseImdbGenreList(value) {
    return String(value || '')
      .split(',')
      .map(part => String(part || '').trim())
      .filter(Boolean);
  }

  function normalizeRatingData(data) {
    if (!data || typeof data !== 'object') return null;
    if (data.ok === false) return { ok: false };
    const imdbRating = Number(data.imdbRating || 0);
    if (!(imdbRating > 0)) return null;
    return {
      ...data,
      ok: true,
      imdbRating,
      imdbVotesNumber: Number(data.imdbVotesNumber) || parseImdbVotes(data.imdbVotes),
      ratingSource: String(data.ratingSource || data.source || data.provider || 'omdb_imdb_id')
    };
  }

  /* Detect a TMDB-shaped item (movie or tv). Returns {tmdbId, type} or null. */
  function getItemRatingKey(item = {}) {
    if (!item || typeof item !== 'object') return null;
    const id = item.id || item.tmdbId || item.tmdb_id;
    if (!id) return null;
    let type = item.media_type || item.tmdbType || item._mediaType || '';
    if (!type) {
      if (item.first_air_date || item.name || item.original_name) type = 'tv';
      else if (item.release_date || item.title || item.original_title) type = 'movie';
    }
    type = String(type || '').toLowerCase();
    if (type !== 'movie' && type !== 'tv') return null;
    return { tmdbId: String(id), type };
  }

  function applyRatingToItem(item, rating) {
    if (!item || !rating || !rating.ok) return;
    const r = Number(rating.imdbRating) || 0;
    const v = Number(rating.imdbVotesNumber) || parseImdbVotes(rating.imdbVotes);
    if (r > 0) {
      /* Preserve TMDB originals BEFORE we overwrite vote_average / vote_count. */
      if (!('tmdbVoteAverage' in item)) item.tmdbVoteAverage = Number(item.vote_average) || 0;
      if (!('tmdbVoteCount' in item)) item.tmdbVoteCount = Number(item.vote_count) || 0;

      item.imdbRating = r;
      item.imdbVotes = v;
      item.imdbLogVotes = v > 0 ? Math.log10(v + 1) : 0;
      item.imdbVotesText = String(rating.imdbVotes || '');
      item.imdbId = rating.imdbId || item.imdbId || '';
      item.ratingSource = String(rating.ratingSource || 'omdb_imdb_id');
      item.ratingProvider = String(rating.provider || rating.source || 'OMDb');
      item.ratingFetchedAt = Number(rating.ratingFetchedAt) || Date.now();

      /* v734: extra metadata used by the filmography card layout. */
      if (rating.runtime) item.imdbRuntime = String(rating.runtime);
      if (rating.rated) item.imdbRated = String(rating.rated);
      if (rating.year) item.imdbYear = String(rating.year);
      if (rating.genre) {
        const imdbGenres = parseImdbGenreList(rating.genre);
        item.imdbGenre = String(rating.genre);
        item.imdbGenres = imdbGenres;
        item.imdbPrimaryGenre = imdbGenres[0] || '';
      }
      const metascore = parseMetascore(rating.metascore || rating.Metascore || rating.imdbMetascore);
      if (metascore > 0) item.imdbMetascore = metascore;

      /* Overwrite TMDB fields so existing display code uses IMDb. */
      item.vote_average = r;
      item.vote_count = v;
    }
  }

  function normalizeFetchedRatingToFiveStar(value, source = '') {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return 0;
    const sourceKey = String(source || '').toLowerCase();
    if (sourceKey.includes('metacritic') || sourceKey.includes('percent')) {
      return Math.max(0, Math.min(5, n / 20));
    }
    if (sourceKey.includes('rawg') || sourceKey.includes('five')) {
      return Math.max(0, Math.min(5, n));
    }
    if (
      sourceKey.includes('imdb')
      || sourceKey.includes('omdb')
      || sourceKey.includes('tmdb')
      || sourceKey.includes('jikan')
      || sourceKey.includes('mal')
      || sourceKey.includes('ten')
    ) {
      return Math.max(0, Math.min(5, n / 2));
    }
    if (n > 10) return Math.max(0, Math.min(5, n / 20));
    if (n > 5) return Math.max(0, Math.min(5, n / 2));
    return Math.max(0, Math.min(5, n));
  }

  function getDisplayTitleRatingValue(item = {}) {
    if (!item || typeof item !== 'object') return 0;
    if (item.__jikan) {
      const animeRating = Number(item.score || item.vote_average || 0);
      return normalizeFetchedRatingToFiveStar(animeRating, 'jikan');
    }
    const ref = getItemRatingKey(item);
    const imdbRating = Number(item.imdbRating || 0);
    if (imdbRating > 0) return normalizeFetchedRatingToFiveStar(imdbRating, item.ratingSource || 'imdb');
    const tmdbRating = Number(item.vote_average || item.voteAverage || 0);
    if (tmdbRating > 0) return normalizeFetchedRatingToFiveStar(tmdbRating, 'tmdb');
    if (!ref) return 0;
    return 0;
  }

  function formatDisplayTitleRating(item = {}) {
    const n = getDisplayTitleRatingValue(item);
    return n > 0 ? n.toFixed(1) : '';
  }

  async function fetchBatchFromServer(items) {
    if (!Array.isArray(items) || !items.length) return {};
    const payload = {
      items: items.map(({ tmdbId, type, title, year, imdbId }) => ({ tmdbId, type, title, year, imdbId }))
    };
    try {
      const res = await fetch('/api/imdb/rating-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        console.warn('IMDb batch endpoint returned', res.status);
        return {};
      }
      const json = await res.json();
      return json && typeof json.ratings === 'object' ? json.ratings : {};
    } catch (e) {
      console.warn('IMDb batch fetch failed:', e);
      return {};
    }
  }

  /* Public: enrich an array of TMDB items with IMDb rating + votes. Mutates
     items in-place. Resolves when ALL items have either been resolved or
     attempted. Items that fail rating lookup keep their original TMDB values. */
  async function enrichItemsWithImdbRatings(items = [], options = {}) {
    if (!Array.isArray(items) || !items.length) return items;
    const typeOverride = options.type || ''; /* 'movie' | 'tv' | '' */

    /* 1. Resolve cached items first (in-place mutation, no network). */
    const needFetch = [];
    items.forEach(item => {
      const ref = getItemRatingKey(item);
      if (!ref) return;
      const type = typeOverride === 'movie' || typeOverride === 'tv' ? typeOverride : ref.type;
      const cachedByImdb = item.imdbId ? readCacheByImdbId(item.imdbId) : null;
      const cached = cachedByImdb || readCache(ref.tmdbId, type);
      if (cached && cached.ok) {
        applyRatingToItem(item, cached);
      } else if (cached && cached.ok === false) {
        /* known-miss within TTL — skip the network. */
      } else {
        const title = String(item.title || item.name || item.original_title || item.original_name || '').trim();
        const date = String(item.release_date || item.first_air_date || '').trim();
        const year = date.slice(0, 4);
        const imdbId = item.imdbId || item.imdb_id || item.external_ids?.imdb_id || '';
        needFetch.push({ item, tmdbId: ref.tmdbId, type, title, year, imdbId });
      }
    });

    if (!needFetch.length) return items;

    /* 2. Batch the rest. Chunk by 25 to keep payloads reasonable. */
    const CHUNK = 25;
    const chunks = [];
    for (let i = 0; i < needFetch.length; i += CHUNK) {
      chunks.push(needFetch.slice(i, i + CHUNK));
    }

    /* Dedupe in-flight requests for identical chunks across concurrent calls. */
    await Promise.all(chunks.map(async chunk => {
      const inflightKey = chunk.map(c => `${c.type}:${c.tmdbId}`).join('|');
      let promise = inflight.get(inflightKey);
      if (!promise) {
        promise = fetchBatchFromServer(chunk).finally(() => inflight.delete(inflightKey));
        inflight.set(inflightKey, promise);
      }
      const ratings = await promise;
      chunk.forEach(({ item, tmdbId, type, imdbId }) => {
        const typedKey = getBatchResultKey(tmdbId, type, imdbId, '');
        const imdbKey = getBatchResultKey('', type, imdbId, '');
        const r = ratings[typedKey] || (imdbKey ? ratings[imdbKey] : null);
        if (r && r.ok) {
          const data = { ...r, ratingFetchedAt: Date.now() };
          writeCache(tmdbId, type, data);
          applyRatingToItem(item, data);
        } else {
          /* Brief negative cache so we don't hammer OMDb on every page. */
          writeCache(tmdbId, type, { ok: false });
        }
      });
    }));

    return items;
  }

  /* Public: single-item enrichment for one TMDB item. Mirror of bulk path. */
  async function enrichWithImdbData(item) {
    if (!item || typeof item !== 'object') return item;
    await enrichItemsWithImdbRatings([item]);
    return item;
  }

  /* Public: single-item lookup for media profile / hero score.
     v11.015: cache hits with `imdbVotesNumber === 0` are treated as
     misses so a previously-cached zero-vote response doesn't
     permanently hide the Members fact on titles that DO have IMDb
     votes (the OMDb API can transiently return missing/N/A vote
     fields). On the re-fetch path, a successful response with a
     real vote count overwrites the bad cache entry. */
  function isUsableImdbCacheEntry(entry) {
    if (!entry || !entry.ok) return false;
    if (Number(entry.imdbVotesNumber || 0) > 0) return true;
    if (typeof entry.imdbVotes === 'string' && parseImdbVotes(entry.imdbVotes) > 0) return true;
    return false;
  }
  async function getImdbRatingForMedia({ tmdbId, imdbId, type, title, year } = {}) {
    const t = String(type || '').toLowerCase() === 'movie' ? 'movie' : 'tv';
    if (imdbId) {
      const cached = readCacheByImdbId(imdbId);
      if (isUsableImdbCacheEntry(cached)) return cached;
    }
    if (tmdbId) {
      const cached = readCache(tmdbId, t);
      if (isUsableImdbCacheEntry(cached)) return cached;
    }
    try {
      const params = new URLSearchParams();
      params.set('type', t);
      if (tmdbId) params.set('tmdbId', String(tmdbId));
      if (imdbId) params.set('imdbId', String(imdbId));
      /* Send title + year only as a strict OMDb title/year fallback when an
         exact IMDb-ID lookup is unavailable. */
      if (title) params.set('title', String(title));
      if (year) params.set('year', String(year));
      const res = await fetch(`/api/imdb/rating?${params.toString()}`);
      if (!res.ok) return null;
      const json = await res.json();
      if (!json || !json.ok) return null;
      const result = {
        ok: true,
        imdbRating: Number(json.imdbRating) || 0,
        imdbVotes: json.imdbVotes || '',
        imdbVotesNumber: parseImdbVotes(json.imdbVotes),
        metascore: json.metascore || json.Metascore || '',
        genre: String(json.genre || json.Genre || '').trim(),
        imdbId: json.imdbId || imdbId || '',
        title: json.title || title || '',
        year: json.year || year || '',
        ratingSource: String(json.ratingSource || json.source || json.provider || 'omdb_imdb_id'),
        ratingProvider: String(json.provider || json.source || 'OMDb'),
        ratingFetchedAt: Date.now()
      };
      if (tmdbId) writeCache(tmdbId, t, result);
      else if (result.imdbId) writeCacheByImdbId(result.imdbId, result);
      return result;
    } catch (e) {
      console.warn('IMDb single fetch failed:', e);
      return null;
    }
  }

  /* v11.083: resolve ONE item through the BATCH endpoint (/api/imdb/rating-batch)
     — the exact-IMDb-ID path the discovery rails + 5am cron use — instead of the
     single /api/imdb/rating endpoint. The single endpoint runs a different
     resolver (live IMDb extract / title fallback) that can land on the wrong
     film for ambiguous titles ("Obsession" 8.2 → 3.8). Routing the full-page
     media profile through this guarantees it matches the discovery card exactly.
     Goes straight to the worker (no client-cache read) so a previously-poisoned
     client cache entry can't be returned; writes the correct value back to the
     shared client cache so every surface converges. */
  async function getImdbRatingViaBatch({ tmdbId, imdbId, type, title, year } = {}) {
    const t = String(type || '').toLowerCase() === 'movie' ? 'movie' : 'tv';
    const item = {
      tmdbId: tmdbId ? String(tmdbId) : '',
      imdbId: imdbId || '',
      type: t,
      title: title || '',
      year: year || ''
    };
    if (!item.tmdbId && !item.imdbId && !item.title) return null;
    const ratings = await fetchBatchFromServer([item]);
    if (!ratings || typeof ratings !== 'object') return null;
    let r = item.tmdbId ? ratings[`${t}:${item.tmdbId}`] : null;
    if (!r && item.imdbId) r = ratings[`imdb:${String(item.imdbId).toLowerCase()}`] || ratings[`imdb:${item.imdbId}`];
    if (!r) { const vals = Object.values(ratings); r = vals.length ? vals[0] : null; }
    if (!r || !r.ok) return null;
    const result = {
      ok: true,
      imdbRating: Number(r.imdbRating) || 0,
      imdbVotes: r.imdbVotes || '',
      imdbVotesNumber: Number(r.imdbVotesNumber) || parseImdbVotes(r.imdbVotes),
      metascore: r.metascore || '',
      genre: String(r.genre || '').trim(),
      imdbId: r.imdbId || imdbId || '',
      title: r.title || title || '',
      year: r.year || year || '',
      ratingSource: String(r.ratingSource || 'omdb_imdb_id'),
      ratingProvider: String(r.provider || 'OMDb'),
      ratingFetchedAt: Date.now()
    };
    if (item.tmdbId) writeCache(item.tmdbId, t, result);
    else if (result.imdbId) writeCacheByImdbId(result.imdbId, result);
    return result;
  }

  /* Source-agnostic future-friendly alias — if OMDb is later swapped for a
     local IMDb dataset, callers using getImdbRatingData(imdbId) keep working. */
  async function getImdbRatingData(imdbId, fallback = {}) {
    return getImdbRatingForMedia({ ...fallback, imdbId });
  }

  /* v10.234: ONE canonical resolver for any media item. Every surface (Discovery
     cards, View All, full profile, More Like This, Search/Add cards, Trending
     inputs) can call this to get a single structured rating object instead of
     poking at item.imdbRating / vote_average directly. Wraps the cache-first
     single lookup and reports exactly how the rating was resolved.

     Returns:
       { source, imdbId, imdbRating10, displayRating5, imdbVotes,
         ratingUpdatedAt, lookupMethod, cacheStatus, fallbackUsed,
         confidence, error } */
  async function resolveImdbRatingForMedia(item = {}) {
    const empty = {
      source: '', imdbId: '', imdbRating10: 0, displayRating5: 0, imdbVotes: 0,
      ratingUpdatedAt: 0, lookupMethod: '', cacheStatus: 'miss',
      fallbackUsed: false, confidence: 'none', error: ''
    };
    if (!item || typeof item !== 'object') return { ...empty, error: 'no-item' };

    const ref = getItemRatingKey(item) || {};
    const tmdbId = ref.tmdbId || String(item.id || item.tmdbId || item.tmdb_id || '');
    const type = ref.type || (String(item.media_type || item.type || '').toLowerCase() === 'movie' ? 'movie' : 'tv');
    const imdbId = item.imdbId || item.imdb_id || (item.external_ids && item.external_ids.imdb_id) || '';
    const title = String(item.title || item.name || item.original_title || item.original_name || '').trim();
    const date = String(item.release_date || item.first_air_date || '').trim();
    const year = String(item.year || date.slice(0, 4) || '').trim();

    /* Cache-first: report whether this was served without a network hit. */
    const preHit = (imdbId ? readCacheByImdbId(imdbId) : null) || (tmdbId ? readCache(tmdbId, type) : null);
    const data = await getImdbRatingForMedia({ tmdbId, imdbId, type, title, year });

    if (!data || !data.ok) {
      const res = { ...empty, imdbId: imdbId || '', error: (data && data.error) || 'unresolved' };
      imdbDebugLog('resolve MISS', { title, tmdbId, type, imdbId, year, error: res.error });
      return res;
    }

    const imdbRating10 = Number(data.imdbRating) || 0;
    const displayRating5 = Number(normalizeFetchedRatingToFiveStar(imdbRating10, data.ratingSource || 'imdb').toFixed(1));
    const source = String(data.ratingSource || data.provider || 'omdb_imdb_id');
    const fallbackUsed = source.includes('title') || source.includes('tavily') || source.includes('ai');
    const res = {
      source,
      imdbId: data.imdbId || imdbId || '',
      imdbRating10,
      displayRating5,
      imdbVotes: Number(data.imdbVotesNumber) || parseImdbVotes(data.imdbVotes),
      ratingUpdatedAt: Number(data.ratingFetchedAt) || Date.now(),
      lookupMethod: source,
      cacheStatus: preHit && preHit.ok ? 'hit' : 'fetched',
      fallbackUsed,
      confidence: source.includes('imdb_id') ? 'high' : (source.includes('title') ? 'medium' : 'low'),
      error: ''
    };
    imdbDebugLog('resolve OK', {
      title, tmdbId, type, imdbId: res.imdbId, year,
      imdbRating10: res.imdbRating10, displayRating5: res.displayRating5,
      source: res.source, cacheStatus: res.cacheStatus, fallbackUsed: res.fallbackUsed
    });
    return res;
  }

  /* Format helpers used by display code. */
  function formatImdbRating(rating) {
    const n = Number(rating || 0);
    return n > 0 ? n.toFixed(1) : '';
  }

  function formatImdbVotes(votes) {
    const n = parseImdbVotes(votes);
    if (!n) return '';
    return n.toLocaleString();
  }

  /* Expose globals — keep API minimal. */
  window.enrichItemsWithImdbRatings = enrichItemsWithImdbRatings;
  window.enrichWithImdbData = enrichWithImdbData;
  window.enrichDiscoverCandidates = enrichItemsWithImdbRatings; /* spec alias */
  window.getImdbRatingForMedia = getImdbRatingForMedia;
  window.getImdbRatingViaBatch = getImdbRatingViaBatch; /* v11.083 exact-path resolver (matches discovery rails) */
  window.resolveImdbRatingForMedia = resolveImdbRatingForMedia; /* v10.234 canonical resolver */
  window.getImdbRatingData = getImdbRatingData;
  window.formatImdbRating = formatImdbRating;
  window.formatImdbVotes = formatImdbVotes;
  window.getDisplayTitleRatingValue = getDisplayTitleRatingValue;
  window.formatDisplayTitleRating = formatDisplayTitleRating;
  window.normalizeFetchedRatingToFiveStar = normalizeFetchedRatingToFiveStar;
  window.parseImdbVotes = parseImdbVotes;
})();
