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

  function normalizeAnimeLookupText(value = '') {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function getJikanMalIdFromValue(source = {}) {
    if (!source || typeof source !== 'object') return '';
    if (typeof window.getAnimeMalIdFromItem === 'function') return window.getAnimeMalIdFromItem(source);
    const direct = source.malId || source.mal_id || source.__mal_id || source.external_ids?.mal_id || '';
    if (direct && Number(direct) > 0) return String(Number(direct));
    const url = String(source.malUrl || source.jikanUrl || source.url || source.sourceUrl || '');
    const match = url.match(/myanimelist\.net\/anime\/(\d+)/i);
    return match ? match[1] : '';
  }

  function getJikanTitleCandidates(source = {}) {
    const titles = [
      source.title,
      source.name,
      source.englishTitle,
      source.title_english,
      source.romajiTitle,
      source.title_japanese,
      source.originalTitle,
      source.original_name,
      source.original_title,
      source.titleVariants?.english,
      source.titleVariants?.romaji,
      source.titleVariants?.japanese
    ];
    const seen = new Set();
    return titles
      .map(value => String(value || '').trim())
      .filter(value => {
        const key = normalizeAnimeLookupText(value);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function getJikanYear(source = {}) {
    return String(source.year || source.malYear || source.aired?.from || source.first_air_date || source.release_date || '').slice(0, 4);
  }

  function isExactJikanTitleMatch(hit = {}, wantedTitle = '') {
    const wanted = normalizeAnimeLookupText(wantedTitle);
    if (!wanted) return false;
    const titles = [hit.title, hit.title_english, hit.title_japanese]
      .concat((Array.isArray(hit.titles) ? hit.titles : []).map(row => row?.title))
      .map(normalizeAnimeLookupText)
      .filter(Boolean);
    return titles.includes(wanted);
  }

  function pickBestJikanIdentitySearchHit(results = [], source = {}) {
    const titles = getJikanTitleCandidates(source);
    const wantedYear = getJikanYear(source);
    const exact = (Array.isArray(results) ? results : []).filter(hit => titles.some(title => isExactJikanTitleMatch(hit, title)));
    if (!exact.length) return null;
    if (wantedYear) {
      const yearMatch = exact.find(hit => String(hit.year || hit.aired?.from || '').slice(0, 4) === wantedYear);
      if (yearMatch) return yearMatch;
    }
    return exact[0];
  }

  async function jikanAnimeByIdentity(source = {}) {
    const malId = getJikanMalIdFromValue(source);
    if (malId) return jikanAnimeFull(malId);
    const titles = getJikanTitleCandidates(source);
    if (!titles.length) return null;
    for (const title of titles.slice(0, 4)) {
      const results = await jikanSearchAnime(title, 8);
      const hit = pickBestJikanIdentitySearchHit(results, source);
      if (hit?.mal_id) return jikanAnimeFull(hit.mal_id);
    }
    return null;
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

  /* v799: Jikan episode list. Paginated (100/page). Returns a flat array of
     { mal_id, episode_id?, number, title, title_japanese, title_romanji, aired,
       score, filler, recap, forum_url } objects. Used to fill in titles for
     MAL-imported anime in My Lists Show Episodes view. */
  async function jikanAnimeEpisodes(malId, options = {}) {
    const id = String(malId || '').trim();
    if (!id) return [];
    const maxPages = Number(options.maxPages || 6); // up to ~600 episodes
    const collected = [];
    let page = 1;
    while (page <= maxPages) {
      const json = await jikanRequest(`anime/${encodeURIComponent(id)}/episodes`, { page });
      const rows = Array.isArray(json?.data) ? json.data : [];
      if (!rows.length) break;
      rows.forEach(row => {
        const num = Number(row?.mal_id || row?.episode || row?.number || 0);
        if (!num) return;
        collected.push({
          number: num,
          title: String(row?.title || '').trim(),
          titleJapanese: String(row?.title_japanese || '').trim(),
          titleRomanji: String(row?.title_romanji || '').trim(),
          aired: row?.aired || ''
        });
      });
      const hasNext = !!(json?.pagination?.has_next_page);
      if (!hasNext) break;
      page += 1;
    }
    return collected;
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

  function countJikanSeasonRelationEntries(j) {
    const relationNames = new Set(['prequel', 'sequel']);
    const relatedIds = new Set();
    (Array.isArray(j?.relations) ? j.relations : []).forEach(rel => {
      const relation = String(rel?.relation || '').trim().toLowerCase();
      if (!relationNames.has(relation)) return;
      (Array.isArray(rel?.entry) ? rel.entry : []).forEach(entry => {
        if (entry?.type && String(entry.type).toLowerCase() !== 'anime') return;
        const id = Number(entry?.mal_id || 0);
        if (id) relatedIds.add(id);
      });
    });
    if (Number(j?.mal_id || 0)) relatedIds.add(Number(j.mal_id));
    return relatedIds.size || 0;
  }

  function getJikanSeasonGrouping(j) {
    const count = countJikanSeasonRelationEntries(j);
    const episodeCount = Number(j?.episodes || 0);
    const startYear = Number(String(j?.aired?.from || j?.year || '').slice(0, 4)) || 0;
    const currentYear = new Date().getFullYear();
    const isLongRunningOngoing = /currently\s+airing/i.test(String(j?.status || ''))
      && startYear > 0
      && currentYear - startYear >= 5;
    if (!count && isLongRunningOngoing) {
      return { count: Math.max(6, currentYear - startYear + 1), mode: 'parent', reliable: false };
    }
    if (!count && episodeCount > 150) {
      return { count: Math.ceil(episodeCount / 24), mode: 'parent', reliable: false };
    }
    if (!count) return { count: 0, mode: 'separate', reliable: false };
    return { count, mode: count > 5 ? 'parent' : 'separate', reliable: true };
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
      title_english: j.title_english || '',
      title_japanese: j.title_japanese || '',
      url: j.url || (malId ? `https://myanimelist.net/anime/${malId}` : ''),
      malUrl: j.url || (malId ? `https://myanimelist.net/anime/${malId}` : ''),
      jikanUrl: j.url || (malId ? `https://myanimelist.net/anime/${malId}` : ''),
      malId: String(malId),
      mal_id: String(malId),
      animeIdentityKey: `mal:${malId}`,
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
      animeType: j.type || 'TV',
      __jikan: true,
      __mal_id: malId,
      __jikanRaw: j
    };
  }

  function mapJikanFullToTmdbDetails(j, characters = [], recommendations = []) {
    const base = mapJikanItemToTmdbShape(j);
    if (!base) return null;

    /* v10.117: Split Jikan characters into two complementary structures so
       the media profile renders the MAL-style two-row layout:
         - credits.cast        = voice actors (Japanese VA where available)
                                  with the character's name as the subtitle
                                  ("playing Coco"). Falls back to character
                                  art when no VA is listed so the row never
                                  collapses into an empty entry.
         - credits.characters  = the character themselves (character art +
                                  character name + role tag like Main /
                                  Supporting). Rendered as the Characters
                                  row below the Cast row on anime profiles.
       Both arrays preserve Jikan's natural Main-first ordering. */
    const cast = characters
      .map((c, idx) => {
        const ch = c?.character || {};
        const vas = Array.isArray(c?.voice_actors) ? c.voice_actors : [];
        const va = vas.find(v => (v?.language || '').toLowerCase() === 'japanese') || vas[0] || null;
        const vaName = va?.person?.name || '';
        const vaPhoto = va?.person?.images?.jpg?.image_url || '';
        const chPhoto = ch.images?.jpg?.image_url || '';
        const photo = vaPhoto || chPhoto;
        const displayName = vaName || ch.name || '';
        if (!displayName) return null;
        return {
          id: va?.person?.mal_id || ch.mal_id || `jikan-cast-${idx}`,
          name: displayName,
          character: vaName ? (ch.name || '') : '',
          profile_path: photo,           /* full https URL — getTmdbImageUrl passes URLs through */
          order: c?.role === 'Main' ? 0 : 1
        };
      })
      .filter(Boolean);

    const charactersList = characters
      .map((c, idx) => {
        const ch = c?.character || {};
        const photo = ch.images?.jpg?.image_url || '';
        const name = ch.name || '';
        if (!name) return null;
        return {
          id: ch.mal_id || `jikan-char-${idx}`,
          name,
          role: c?.role || '',
          image: photo,
          order: c?.role === 'Main' ? 0 : 1
        };
      })
      .filter(Boolean);

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
    const seasonGrouping = getJikanSeasonGrouping(j);
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
      animeType: j.type || 'TV',
      animeSeasonRelationCount: seasonGrouping.count,
      animeSeasonGrouping: seasonGrouping.mode,
      animeSeasonGroupingReliable: seasonGrouping.reliable,
      relations: Array.isArray(j?.relations) ? j.relations : [],
      production_companies: studios,
      networks: producers,
      created_by,
      credits: { cast, crew, characters: charactersList },
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

  /* ---------- v11.088: anime series-root resolution (Jikan-first grouping) ----
     Anime is grouped in My Lists the way TV groups seasons: one parent series
     card with its seasons/parts underneath. The series is identified the
     MyAnimeList way — walk the MAL Prequel chain to the earliest entry so every
     season/part of a series resolves to one stable root mal_id. Jikan is the
     source of truth; a TMDB id is only a fallback when an anime can't be matched
     to MAL. */
  /* Formats we treat as a "season" of a TV-style series. Movies, OVAs, recaps,
     specials, music videos and PVs are NOT seasons — e.g. "Jujutsu Kaisen 0
     Movie" is the prequel film, not season 0, and must stay a separate title. */
  const ANIME_SEASON_FORMATS = new Set(['tv', 'ona']);

  function _relationMalIds(relationsData, relationName) {
    const out = [];
    const arr = Array.isArray(relationsData) ? relationsData : [];
    for (const rel of arr) {
      if (String(rel?.relation || '').trim().toLowerCase() !== relationName) continue;
      (Array.isArray(rel?.entry) ? rel.entry : []).forEach(e => {
        if (e?.type && String(e.type).toLowerCase() !== 'anime') return;
        const id = Number(e?.mal_id || 0);
        if (id) out.push(String(id));
      });
    }
    return out;
  }

  async function jikanAnimeRelations(malId) {
    const id = String(malId || '').replace(/[^0-9]/g, '');
    if (!id) return [];
    const json = await jikanRequest(`anime/${id}/relations`);
    return Array.isArray(json?.data) ? json.data : [];
  }

  /* Light per-anime fetch: format/type, episode count, title, year, poster.
     Used to (a) decide whether a related entry is a TV/ONA "season" and
     (b) supply season-card metadata. Cached by jikanRequest for the session. */
  async function jikanGetAnimeBasic(malId) {
    const id = String(malId || '').replace(/[^0-9]/g, '');
    if (!id) return null;
    const json = await jikanRequest(`anime/${id}`);
    const a = json?.data;
    if (!a || !a.mal_id) return null;
    /* v11.742: currently-airing anime report `episodes: null` on MAL (the final
       count isn't set until the cour finishes), which made season cards and
       series totals show "0 episodes" (e.g. "Behind the Supermarket, Smoking
       with You."). Derive the count from the actual aired-episodes list. Gated
       on `airing` so finished anime keep their single cheap /anime call. */
    let episodes = Number(a.episodes || 0) || 0;
    if (!episodes && a.airing === true) {
      try {
        const aired = await jikanAnimeEpisodes(id, { maxPages: 6 });
        if (Array.isArray(aired) && aired.length) episodes = aired.length;
      } catch (_) {}
      /* v12.020: some currently-airing anime have episodes that HAVE aired but
         MAL hasn't catalogued in /episodes yet, AND report episodes:null — so
         both counts above come back 0 and the show has zero selectable episodes
         (e.g. "Smoking Behind the Supermarket with You"). Estimate the aired
         count from the air-start date at the standard weekly cadence so the user
         still gets selectable rows; the real list overwrites this once MAL
         catalogues it. Capped at 52 and floored at 1; only applies once the
         premiere has actually passed. */
      if (!episodes) {
        const fromMs = a.aired && a.aired.from ? Date.parse(String(a.aired.from)) : NaN;
        if (Number.isFinite(fromMs) && fromMs <= Date.now()) {
          const weeks = Math.floor((Date.now() - fromMs) / (7 * 24 * 60 * 60 * 1000));
          episodes = Math.max(1, Math.min(52, weeks + 1));
        }
      }
    }
    return {
      malId: String(a.mal_id),
      title: a.title_english || a.title || a.title_japanese || '',
      type: String(a.type || '').toLowerCase(),
      episodes,
      year: String(a.year || (a.aired && a.aired.from ? String(a.aired.from).slice(0, 4) : '') || ''),
      airedFrom: a.aired && a.aired.from ? String(a.aired.from) : '',
      image: a.images?.jpg?.large_image_url || a.images?.jpg?.image_url || ''
    };
  }

  async function _isSeasonFormat(malId) {
    const basic = await jikanGetAnimeBasic(malId);
    return !!(basic && ANIME_SEASON_FORMATS.has(basic.type));
  }

  /* Walk Prequel links to the earliest TV/ONA entry. Crucially, only FOLLOW a
     prequel when that prequel is itself a TV/ONA season — so a chain like
     "S1 → (prequel) JJK 0 Movie" stops at S1 and the movie stays separate. */
  async function jikanResolveSeriesRoot(malId, depthCap = 12) {
    let current = String(malId || '').replace(/[^0-9]/g, '');
    if (!current) return '';
    const seen = new Set();
    for (let i = 0; i < depthCap; i++) {
      if (seen.has(current)) break;
      seen.add(current);
      const rels = await jikanAnimeRelations(current);
      let nextRoot = '';
      for (const candidate of _relationMalIds(rels, 'prequel')) {
        if (seen.has(candidate)) continue;
        if (await _isSeasonFormat(candidate)) { nextRoot = candidate; break; }
      }
      if (!nextRoot) break;
      current = nextRoot;
    }
    return current;
  }

  /* Assemble the full ordered season list of a series, the MyAnimeList way:
     resolve the root, then walk the Sequel chain forward collecting TV/ONA
     entries. Each becomes one SEPARATE season (never merged). Returns
     [{ malId, title, episodes, year, image, type }] in air order. */
  async function jikanGetSeriesSeasons(malId, depthCap = 24) {
    const rootId = await jikanResolveSeriesRoot(malId);
    if (!rootId) return [];
    const seasons = [];
    const seen = new Set();
    let current = rootId;
    for (let i = 0; i < depthCap; i++) {
      if (!current || seen.has(current)) break;
      seen.add(current);
      const basic = await jikanGetAnimeBasic(current);
      if (basic && ANIME_SEASON_FORMATS.has(basic.type)) seasons.push(basic);
      const rels = await jikanAnimeRelations(current);
      let nextSeason = '';
      for (const candidate of _relationMalIds(rels, 'sequel')) {
        if (seen.has(candidate)) continue;
        if (await _isSeasonFormat(candidate)) { nextSeason = candidate; break; }
      }
      current = nextSeason;
    }
    return seasons;
  }

  function _normForMalMatch(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /* Conservative TMDB→MAL bridge: only used to give a TMDB-sourced anime a
     mal_id when it has none. Requires an exact normalized-title match; year
     within 1 preferred. Returns '' when not confident (caller then keeps the
     TMDB fallback). */
  async function jikanResolveMalIdByTitle(title, year) {
    const t = String(title || '').trim();
    if (!t) return '';
    const results = await jikanSearchAnime(t, 8);
    if (!Array.isArray(results) || !results.length) return '';
    const target = _normForMalMatch(t);
    const yr = Number(String(year || '').slice(0, 4)) || 0;
    let weak = null;
    for (const r of results) {
      const titleMatch = [r.title_english, r.title, r.title_japanese]
        .map(_normForMalMatch)
        .some(c => c && c === target);
      if (!titleMatch) continue;
      const ry = Number(String(r?.aired?.from || r?.year || '').slice(0, 4)) || 0;
      if (!yr || !ry || Math.abs(ry - yr) <= 1) return String(r.mal_id || '');
      if (!weak) weak = r;
    }
    return weak ? String(weak.mal_id || '') : '';
  }

  /* ---------- Public API ---------- */
  window.JikanAnime = {
    request: jikanRequest,
    searchAnime: jikanSearchAnime,
    topAnime: jikanTopAnime,
    seasonNow: jikanSeasonNow,
    seasonUpcoming: jikanSeasonUpcoming,
    animeFull: jikanAnimeFull,
    animeByIdentity: jikanAnimeByIdentity,
    animeCharacters: jikanAnimeCharacters,
    animeRecommendations: jikanAnimeRecommendations,
    animeEpisodes: jikanAnimeEpisodes,
    mapItem: mapJikanItemToTmdbShape,
    mapFullDetails: mapJikanFullToTmdbDetails,
    getSeasonGrouping: getJikanSeasonGrouping,
    /* v11.088/v11.090: Jikan-first series-root resolution + season assembly. */
    relations: jikanAnimeRelations,
    resolveSeriesRoot: jikanResolveSeriesRoot,
    resolveMalIdByTitle: jikanResolveMalIdByTitle,
    getAnimeBasic: jikanGetAnimeBasic,
    getSeriesSeasons: jikanGetSeriesSeasons,
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
