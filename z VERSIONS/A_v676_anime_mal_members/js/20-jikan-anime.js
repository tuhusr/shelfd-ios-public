/* =============================================================================
   20-jikan-anime.js  (v654)
   Anime data layer — Jikan API (api.jikan.moe/v4) is the SINGLE source of
   truth for every anime path: search, discover, profile open. TMDB is no
   longer consulted when the section/filter is anime.

   Shape compatibility:
     The downstream renderers (renderDiscoverCards('tv',…),
     renderDiscoverMediaProfileDetails('tv',…), search-page row builder, etc.)
     expect TMDB-shaped objects: { id, name, title, poster_path, backdrop_path,
     first_air_date, vote_average, overview, genres, media_type, ... }

     Rather than rewrite all the renderers, this module produces TMDB-shaped
     objects from Jikan responses (via mapJikanItemToTmdbShape). Posters are
     full URLs from Jikan; tmdbPoster() helpers are patched to pass through
     full https URLs unchanged.

   Rate limiting:
     Jikan = 3 req/s, 60 req/min. We queue requests with a 360ms minimum gap
     and a sliding 60s/60req window. In practice this is plenty.

   Cache:
     In-memory Map keyed by url. Lifetime: session.
   ========================================================================== */

(function() {
  'use strict';

  const JIKAN_BASE = 'https://api.jikan.moe/v4';
  const MIN_REQ_GAP_MS = 360;          // ~2.78 req/s, under 3/s ceiling
  const PER_MINUTE_LIMIT = 55;         // safety margin under 60/min ceiling
  const PER_MINUTE_WINDOW_MS = 60 * 1000;

  /* ---------- in-memory cache + queue ---------- */
  const cache = new Map();
  let queue = Promise.resolve();
  let lastRequestAt = 0;
  const recentRequestTimes = [];

  function _trimRecentWindow() {
    const cutoff = Date.now() - PER_MINUTE_WINDOW_MS;
    while (recentRequestTimes.length && recentRequestTimes[0] < cutoff) {
      recentRequestTimes.shift();
    }
  }

  async function _waitForRateLimitSlot() {
    /* Per-second gap */
    const now = Date.now();
    const gap = now - lastRequestAt;
    if (gap < MIN_REQ_GAP_MS) {
      await new Promise(r => setTimeout(r, MIN_REQ_GAP_MS - gap));
    }
    /* Per-minute window */
    _trimRecentWindow();
    if (recentRequestTimes.length >= PER_MINUTE_LIMIT) {
      const waitMs = PER_MINUTE_WINDOW_MS - (Date.now() - recentRequestTimes[0]) + 50;
      if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
      _trimRecentWindow();
    }
  }

  function _normalizeQueryParams(params = {}) {
    const usp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v == null || v === '') return;
      usp.set(k, String(v));
    });
    return usp.toString();
  }

  async function jikanRequest(path, params = {}, opts = {}) {
    const cleanPath = String(path || '').replace(/^\/+/, '');
    const qs = _normalizeQueryParams(params);
    const url = `${JIKAN_BASE}/${cleanPath}${qs ? `?${qs}` : ''}`;
    if (!opts.bypassCache && cache.has(url)) return cache.get(url);

    /* Serialize through the queue so requests don't hammer Jikan in parallel.
       Each request waits for the previous to clear the rate-limit gate. */
    const result = queue.then(async () => {
      await _waitForRateLimitSlot();
      lastRequestAt = Date.now();
      recentRequestTimes.push(lastRequestAt);
      try {
        const res = await fetch(url, { cache: 'force-cache' });
        if (!res.ok) {
          if (res.status === 429) {
            /* Backoff and one retry */
            await new Promise(r => setTimeout(r, 1500));
            const retry = await fetch(url, { cache: 'force-cache' });
            if (!retry.ok) throw new Error(`Jikan ${retry.status}`);
            const json = await retry.json();
            cache.set(url, json);
            return json;
          }
          throw new Error(`Jikan ${res.status}`);
        }
        const json = await res.json();
        cache.set(url, json);
        return json;
      } catch (e) {
        console.warn('[Jikan]', url, e?.message || e);
        return null;
      }
    });
    queue = result.catch(() => {}); /* keep queue alive on error */
    return result;
  }

  /* ---------- High-level endpoints ---------- */

  async function jikanSearchAnime(query = '', limit = 24) {
    const q = String(query || '').trim();
    if (!q) return [];
    const json = await jikanRequest('anime', { q, limit, sfw: true });
    return Array.isArray(json?.data) ? json.data : [];
  }

  /* Top anime — filter ∈ {'', 'airing', 'upcoming', 'bypopularity', 'favorite'} */
  async function jikanTopAnime(filter = '', type = 'tv', limit = 24, page = 1) {
    const params = { type, limit, page };
    if (filter) params.filter = filter;
    const json = await jikanRequest('top/anime', params);
    return Array.isArray(json?.data) ? json.data : [];
  }

  async function jikanSeasonNow(limit = 24) {
    const json = await jikanRequest('seasons/now', { limit, sfw: true });
    return Array.isArray(json?.data) ? json.data : [];
  }

  async function jikanSeasonUpcoming(limit = 24) {
    const json = await jikanRequest('seasons/upcoming', { limit, sfw: true });
    return Array.isArray(json?.data) ? json.data : [];
  }

  async function jikanAnimeFull(malId) {
    const id = String(malId || '').trim();
    if (!id) return null;
    const json = await jikanRequest(`anime/${encodeURIComponent(id)}/full`);
    return json?.data || null;
  }

  async function jikanAnimeCharacters(malId, limit = 12) {
    const id = String(malId || '').trim();
    if (!id) return [];
    const json = await jikanRequest(`anime/${encodeURIComponent(id)}/characters`);
    const all = Array.isArray(json?.data) ? json.data : [];
    return all.slice(0, limit);
  }

  async function jikanAnimeRecommendations(malId, limit = 8) {
    const id = String(malId || '').trim();
    if (!id) return [];
    const json = await jikanRequest(`anime/${encodeURIComponent(id)}/recommendations`);
    const all = Array.isArray(json?.data) ? json.data : [];
    return all.slice(0, limit).map(r => r?.entry).filter(Boolean);
  }

  /* ---------- Adapter: Jikan anime → TMDB-shaped TV object ----------
     Note: id is the MAL id but we set __jikan and __mal_id flags so
     downstream code can detect Jikan-sourced items. The id itself is
     the mal_id (numeric); we route it through openDiscoverMediaProfile
     and the seed cache distinguishes Jikan items via __jikan flag. */
  function pickJikanPoster(j) {
    const i = j?.images?.jpg || j?.images?.webp || {};
    return i.large_image_url || i.image_url || i.small_image_url || '';
  }
  function pickJikanBackdrop(j) {
    /* Jikan doesn't have a separate backdrop; fall back to large poster. */
    return pickJikanPoster(j);
  }
  function pickJikanYear(j) {
    if (j?.year) return Number(j.year);
    const aired = j?.aired?.from || '';
    return Number((aired || '').slice(0, 4)) || 0;
  }
  function pickJikanFirstAirDate(j) {
    return (j?.aired?.from || '').slice(0, 10);
  }
  function pickJikanScore(j) {
    return Number(j?.score || 0);
  }
  function pickJikanGenres(j) {
    const out = [];
    const seen = new Set();
    const push = (arr) => (Array.isArray(arr) ? arr : []).forEach(g => {
      const key = String(g?.mal_id ?? g?.name ?? '');
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push({ id: Number(g.mal_id) || 0, name: String(g.name || '').trim() });
    });
    push(j?.genres); push(j?.themes); push(j?.demographics);
    return out;
  }

  function mapJikanItemToTmdbShape(j) {
    if (!j) return null;
    const malId = Number(j.mal_id);
    if (!malId) return null;
    const title = j.title_english || j.title || j.title_japanese || '';
    const poster = pickJikanPoster(j);
    return {
      id: malId,
      name: title,
      title: title,
      original_name: j.title_japanese || j.title || '',
      original_title: j.title_japanese || j.title || '',
      overview: String(j.synopsis || '').replace(/\s+\[Written by[^\]]+\]\s*$/i, '').trim(),
      poster_path: poster,                  /* full https URL — tmdbPoster patched to pass through */
      backdrop_path: pickJikanBackdrop(j),  /* full https URL */
      first_air_date: pickJikanFirstAirDate(j),
      release_date: pickJikanFirstAirDate(j),
      vote_average: pickJikanScore(j),
      vote_count: Number(j.scored_by || 0),
      popularity: Number(j.popularity || 0) ? (1 / Number(j.popularity)) : 0,
      media_type: 'tv',
      genre_ids: pickJikanGenres(j).map(g => g.id).filter(Boolean),
      genres: pickJikanGenres(j),
      origin_country: ['JP'],
      original_language: 'ja',
      number_of_episodes: Number(j.episodes || 0),
      number_of_seasons: 1,
      status: j.status || '',
      type: j.type || 'TV',
      __jikan: true,
      __mal_id: malId,
      __jikanRaw: j
    };
  }

  function mapJikanFullToTmdbDetails(j, characters = [], recommendations = []) {
    const base = mapJikanItemToTmdbShape(j);
    if (!base) return null;

    /* Characters → credits.cast (with VAs as crew where available) */
    const cast = characters.map(c => {
      const ch = c?.character || {};
      const va = (Array.isArray(c?.voice_actors) ? c.voice_actors : []).find(v => (v?.language || '').toLowerCase() === 'japanese') || {};
      const profile = ch.images?.jpg?.image_url || '';
      return {
        id: ch.mal_id,
        name: ch.name || '',
        character: va?.person?.name || '',
        profile_path: profile,    /* full https URL */
        order: c?.role === 'Main' ? 0 : 1
      };
    }).filter(p => p.name);

    /* Trailer → videos.results */
    const videos = [];
    const trailerId = j?.trailer?.youtube_id;
    if (trailerId) {
      videos.push({
        id: `jikan-${j.mal_id}-trailer`,
        key: trailerId,
        site: 'YouTube',
        type: 'Trailer',
        official: true
      });
    }

    /* Recommendations → similar.results */
    const similar = recommendations.map(r => ({
      id: Number(r.mal_id) || 0,
      name: r.title || '',
      title: r.title || '',
      poster_path: r?.images?.jpg?.image_url || '',  /* full https URL */
      backdrop_path: r?.images?.jpg?.image_url || '',
      media_type: 'tv',
      __jikan: true,
      __mal_id: Number(r.mal_id) || 0
    })).filter(x => x.id && x.name);

    /* Studios → production_companies (TMDB shape). */
    const studios = (Array.isArray(j?.studios) ? j.studios : []).map(s => ({
      id: s.mal_id,
      name: s.name,
      logo_path: ''
    }));

    /* Producers → networks (rough mapping; Jikan has no concept of network but
       this slot is shown on the profile). */
    const producers = (Array.isArray(j?.producers) ? j.producers : []).map(p => ({
      id: p.mal_id,
      name: p.name,
      logo_path: ''
    }));

    /* Crew — pull "Director" if any character entry has a known role. Most
       Jikan trailers don't include it; default empty so downstream "Created
       By" line falls back to studios. */
    const crew = [];

    /* created_by — use first studio name as a creator surrogate. */
    const created_by = studios.slice(0, 1).map(s => ({
      id: s.id,
      name: s.name,
      profile_path: ''
    }));

    /* Tagline — Jikan doesn't expose this; leave blank. */
    return {
      ...base,
      tagline: '',
      runtime: 0,                           /* Movies-only; Jikan exposes per-episode */
      episode_run_time: parseEpisodeRuntime(j?.duration),
      first_air_date: pickJikanFirstAirDate(j),
      last_air_date: (j?.aired?.to || '').slice(0, 10),
      number_of_episodes: Number(j.episodes || 0),
      number_of_seasons: 1,
      status: j.status || '',
      type: j.type || 'TV',
      production_companies: studios,
      networks: producers,
      created_by,
      credits: { cast, crew },
      videos: { results: videos },
      similar: { results: similar },
      external_ids: {
        imdb_id: '',
        tvdb_id: '',
        mal_id: Number(j.mal_id) || 0
      },
      /* v676: MyAnimeList community stats — surfaced on the profile facts grid. */
      malMembers: Number(j.members || 0),
      malFavorites: Number(j.favorites || 0),
      malScoredBy: Number(j.scored_by || 0),
      malRank: Number(j.rank || 0),
      malPopularity: Number(j.popularity || 0)
    };
  }

  function parseEpisodeRuntime(durationStr = '') {
    /* Jikan duration like "24 min per ep" or "23 min". Returns [N] minutes. */
    const m = String(durationStr || '').match(/(\d+)\s*min/i);
    return m ? [Number(m[1])] : [];
  }

  /* ---------- Public API ---------- */
  window.JikanAnime = {
    request: jikanRequest,
    searchAnime: jikanSearchAnime,
    topAnime: jikanTopAnime,
    seasonNow: jikanSeasonNow,
    seasonUpcoming: jikanSeasonUpcoming,
    animeFull: jikanAnimeFull,
    animeCharacters: jikanAnimeCharacters,
    animeRecommendations: jikanAnimeRecommendations,
    mapItem: mapJikanItemToTmdbShape,
    mapFullDetails: mapJikanFullToTmdbDetails,
    /* Cache helpers (mainly for debugging) */
    _cache: cache,
    _clearCache: () => cache.clear()
  };

  /* ---------- Patch tmdbPoster-style helpers to pass through full URLs ----
     The bottom-nav search page has its own tmdbPoster() helper. We can't
     patch it from here (it's IIFE-scoped), so 18-search-page.js is updated
     directly to handle full URLs. Same for any other inline poster builder.
     This module just exposes a drop-in url builder for code that has access. */
  window.shelfdResolvePosterUrl = function(pathOrUrl, size = 'w342') {
    const v = String(pathOrUrl || '').trim();
    if (!v) return '';
    if (v.startsWith('http://') || v.startsWith('https://')) return v;
    return `https://image.tmdb.org/t/p/${size}${v}`;
  };

})();
