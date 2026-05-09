/* =============================================================================
   20-imdb-ratings.js  (v673)
   Client-side IMDb rating layer for movies + TV shows.
   - Replaces TMDB vote_average / vote_count with IMDb imdbRating / imdbVotes
     while PRESERVING the originals as item.tmdbVoteAverage / tmdbVoteCount so
     ranking helpers can use both signals.
   - In-memory Map cache + localStorage persistence with split TTLs:
       - hits cached for 7 days
       - misses cached briefly (6h) to avoid retry spam
   - Source-agnostic helper boundary: enrichWithImdbData(item) /
     enrichItemsWithImdbRatings(items) — implementation here is OMDb but the
     caller doesn't care. Replacing OMDb with a local IMDb dataset later means
     swapping fetchBatchFromServer / the worker route, nothing else.
   - Batch endpoint (/api/imdb/rating-batch) for bulk discover rails.
   - Single endpoint (/api/imdb/rating) for media profile pages.
   ========================================================================== */
(function() {
  'use strict';

  const LS_PREFIX = 'shelfd:imdb-rating:v2:';
  const TTL_HIT_MS = 7 * 24 * 60 * 60 * 1000;     /* 7 days for successful lookups */
  const TTL_MISS_MS = 6 * 60 * 60 * 1000;          /* 6 hours for failed lookups   */
  const memCache = new Map();
  const inflight = new Map();

  function getCacheKey(tmdbId, type) {
    const t = String(type || '').toLowerCase() === 'movie' ? 'movie' : 'tv';
    return `${t}:${String(tmdbId || '').trim()}`;
  }

  function ttlForEntry(entry) {
    return entry && entry.data && entry.data.ok === false ? TTL_MISS_MS : TTL_HIT_MS;
  }

  function readCache(tmdbId, type) {
    const key = getCacheKey(tmdbId, type);
    if (key.endsWith(':')) return null;
    const mem = memCache.get(key);
    if (mem && Date.now() - mem.savedAt < ttlForEntry(mem)) return mem.data;
    try {
      const raw = localStorage.getItem(LS_PREFIX + key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (!entry || !entry.savedAt || !entry.data) return null;
      if (Date.now() - Number(entry.savedAt) > ttlForEntry(entry)) return null;
      memCache.set(key, entry);
      return entry.data;
    } catch (e) { return null; }
  }

  function writeCache(tmdbId, type, data) {
    const key = getCacheKey(tmdbId, type);
    if (key.endsWith(':')) return;
    const entry = { savedAt: Date.now(), data };
    memCache.set(key, entry);
    try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(entry)); } catch (e) { /* quota */ }
  }

  function parseImdbVotes(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const clean = String(value || '').replace(/[^0-9]/g, '');
    if (!clean) return 0;
    const n = Number(clean);
    return Number.isFinite(n) ? n : 0;
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
      item.ratingSource = 'imdb';
      item.ratingFetchedAt = Number(rating.ratingFetchedAt) || Date.now();

      /* Overwrite TMDB fields so existing display code uses IMDb. */
      item.vote_average = r;
      item.vote_count = v;
    }
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
      const cached = readCache(ref.tmdbId, type);
      if (cached && cached.ok) {
        applyRatingToItem(item, cached);
      } else if (cached && cached.ok === false) {
        /* known-miss within TTL — skip the network. */
      } else {
        const title = String(item.title || item.name || item.original_title || item.original_name || '').trim();
        const date = String(item.release_date || item.first_air_date || '').trim();
        const year = date.slice(0, 4);
        needFetch.push({ item, tmdbId: ref.tmdbId, type, title, year, imdbId: item.imdbId || '' });
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
      chunk.forEach(({ item, tmdbId, type }) => {
        const r = ratings[tmdbId];
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

  /* Public: single-item lookup for media profile / hero score. */
  async function getImdbRatingForMedia({ tmdbId, imdbId, type, title, year } = {}) {
    const t = String(type || '').toLowerCase() === 'movie' ? 'movie' : 'tv';
    if (tmdbId) {
      const cached = readCache(tmdbId, t);
      if (cached && cached.ok) return cached;
    }
    try {
      const params = new URLSearchParams();
      params.set('type', t);
      if (tmdbId) params.set('tmdbId', String(tmdbId));
      if (imdbId) params.set('imdbId', String(imdbId));
      const res = await fetch(`/api/imdb/rating?${params.toString()}`);
      if (!res.ok) return null;
      const json = await res.json();
      if (!json || !json.ok) return null;
      const result = {
        ok: true,
        imdbRating: Number(json.imdbRating) || 0,
        imdbVotes: json.imdbVotes || '',
        imdbVotesNumber: parseImdbVotes(json.imdbVotes),
        imdbId: json.imdbId || imdbId || '',
        title: json.title || title || '',
        year: json.year || year || '',
        ratingSource: 'imdb',
        ratingFetchedAt: Date.now()
      };
      if (tmdbId) writeCache(tmdbId, t, result);
      return result;
    } catch (e) {
      console.warn('IMDb single fetch failed:', e);
      return null;
    }
  }

  /* Source-agnostic future-friendly alias — if OMDb is later swapped for a
     local IMDb dataset, callers using getImdbRatingData(imdbId) keep working. */
  async function getImdbRatingData(imdbId, fallback = {}) {
    return getImdbRatingForMedia({ ...fallback, imdbId });
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
  window.getImdbRatingData = getImdbRatingData;
  window.formatImdbRating = formatImdbRating;
  window.formatImdbVotes = formatImdbVotes;
  window.parseImdbVotes = parseImdbVotes;
})();
