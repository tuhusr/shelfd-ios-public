/* =============================================================================
   18-search-page.js  (v628)
   Full-page search hub: movies, TV, anime, games.
   - Debounced query (200ms)
   - Filter chips (All / Movies / TV / Anime / Games)
   - Recent searches (localStorage, last 6)
   - Trending strip on empty state (TMDB weekly)
   - Browse cards seed a query for each media type
   - Result rows match Shelfd visual language; click opens existing media
     profile via openDiscoverMediaProfile / openGameMediaProfile.
   - All animations transform+opacity only (120Hz friendly).
   ========================================================================== */
(function() {
  'use strict';

  const RECENTS_KEY = 'shelfd:search:recent:v1';
  const RECENTS_MAX = 6;
  const DEBOUNCE_MS = 220;
  const SEARCH_LIMIT = 24;

  let activeFilter = 'all';
  let activeQuery = '';
  let queryToken = 0;
  let debounceTimer = 0;
  let trendingLoaded = false;
  let pageInitialized = false;
  let lastResultRows = [];

  /* ---------- DOM helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escHtml(s) { return escAttr(s); }

  /* ---------- Recent searches ---------- */
  function loadRecents() {
    try {
      const raw = localStorage.getItem(RECENTS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.slice(0, RECENTS_MAX) : [];
    } catch (_) { return []; }
  }
  function saveRecents(list) {
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, RECENTS_MAX))); } catch (_) {}
  }
  function pushRecent(query) {
    const q = String(query || '').trim();
    if (!q) return;
    const cur = loadRecents().filter(x => x.toLowerCase() !== q.toLowerCase());
    cur.unshift(q);
    saveRecents(cur);
  }
  function clearRecents() {
    saveRecents([]);
    renderRecents();
  }
  function renderRecents() {
    const section = $('shelfd-search-recent-section');
    const list = $('shelfd-search-recent-list');
    if (!section || !list) return;
    const recents = loadRecents();
    if (!recents.length) { section.hidden = true; return; }
    section.hidden = false;
    list.innerHTML = recents.map(q => `
      <button type="button" class="shelfd-search-recent-chip" data-recent-query="${escAttr(q)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
        <span>${escHtml(q)}</span>
      </button>
    `).join('');
  }

  /* ---------- Image helpers ---------- */
  function tmdbPoster(path, size = 'w342') {
    if (!path) return '';
    /* v654: Jikan-sourced anime items store full https URLs in poster_path —
       pass those through unchanged. TMDB items still get the path prefix. */
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return `https://image.tmdb.org/t/p/${size}${path}`;
  }
  function gamePoster(item) {
    return item?.background_image || item?.cover || '';
  }

  /* ---------- Item normalizer for unified row rendering ----------
     v654: also handles Jikan-shaped items (passed in alongside TMDB items
     via runSearch). Jikan items carry `__jikan: true` and `__mal_id`.
     v736: every row now also carries `popularity` — a comparable number
     across sources used as the secondary sort key after prefix-match. */
  function normalizeTmdbItem(item) {
    const isJikan = !!item.__jikan;
    const isMovie = item.media_type === 'movie';
    const title = isMovie ? (item.title || item.original_title || '') : (item.name || item.original_name || '');
    const date = isMovie ? (item.release_date || '') : (item.first_air_date || '');
    const year = (date || '').slice(0, 4);
    const isAnime = isJikan
      || (!isMovie && (typeof window.isAnimeDiscoverCandidate === 'function' ? window.isAnimeDiscoverCandidate(item) : false));
    const kind = isAnime ? 'anime' : (isMovie ? 'movie' : 'tv');
    const rating = Number(item.vote_average || 0);
    /* v736: popularity signal.
       - Jikan: `members` (MAL trackers) is the strongest popularity proxy.
         Falls back to `favorites`, then to inverse `popularity` (which is
         a rank — lower is better, so we invert it).
       - TMDB: `popularity` reflects views + recent activity. `vote_count`
         is added as a tie-breaker so high-volume titles surface first. */
    let popularity = 0;
    if (isJikan) {
      /* Jikan / anime — untouched per user direction. */
      const members = Number(item.members || 0);
      const favorites = Number(item.favorites || 0);
      const popRank = Number(item.popularity || 0);
      popularity = members || favorites || (popRank > 0 ? 1_000_000 / popRank : 0);
    } else {
      /* v738: movies / TV popularity = pure flat sum of engagement counts.
         No multipliers, no rating values, no trending fields. Each term is
         "a person took an action" — IMDb users who rated + TMDB users who
         rated. imdbVotes is set by enrichItemsWithImdbRatings (OMDb call
         already running upstream); falls back to 0 if not enriched yet. */
      const imdbVotes = Number(item.imdbVotes || 0);
      const voteCount = Number(item.vote_count || 0);
      popularity = imdbVotes + voteCount;
    }
    return {
      key: isJikan ? `mal:${item.__mal_id || item.id}` : `tmdb:${item.media_type}:${item.id}`,
      kind,
      tmdbType: isMovie ? 'movie' : 'tv',
      id: item.id,
      title,
      year,
      rating: rating > 0 ? rating.toFixed(1) : '',
      popularity,
      poster: tmdbPoster(item.poster_path),
      overview: String(item.overview || '').trim(),
      isJikan,
      malId: isJikan ? (item.__mal_id || item.id) : 0,
      raw: item
    };
  }
  function normalizeGameItem(item) {
    const year = (item.released || '').slice(0, 4);
    const rating = Number(item.rating || 0);
    /* v738: games popularity = pure flat sum of every engagement count
       RAWG returns. Each term is "a person took an action" with the game.
         - added         : users who added it to any list
         - ratings_count : users who rated it
         - reviews_count : users who wrote a review (highest-effort signal)
       No multipliers, no rating values. */
    const added = Number(item.added || 0);
    const ratingsCount = Number(item.ratings_count || 0);
    const reviewsCount = Number(item.reviews_count || 0);
    const popularity = added + ratingsCount + reviewsCount;
    return {
      key: `game:${item.id}`,
      kind: 'game',
      id: item.id,
      title: item.name || '',
      year,
      rating: rating > 0 ? rating.toFixed(1) : '',
      popularity,
      poster: gamePoster(item),
      overview: '',
      raw: item
    };
  }

  /* v732: Person row normalizer for the Actors filter chip. */
  function normalizePersonItem(item) {
    const dept = String(item?.known_for_department || '').trim();
    /* Map TMDB dept strings to a clean role label. */
    const roleLabel = dept === 'Acting' ? 'Actor'
      : dept === 'Directing' ? 'Director'
      : dept === 'Writing' ? 'Writer'
      : dept === 'Production' ? 'Producer'
      : (dept || 'Person');
    /* Known-for blurb: top 3 titles they're recognized for. */
    const known = Array.isArray(item.known_for) ? item.known_for : [];
    const knownTitles = known
      .map(k => k?.title || k?.name || '')
      .filter(Boolean)
      .slice(0, 3);
    const popularity = Number(item.popularity || 0);
    return {
      key: `person:${item.id}`,
      kind: 'person',
      id: item.id,
      title: item.name || '',
      year: '',
      rating: popularity > 0 ? popularity.toFixed(1) : '',
      popularity,
      poster: item.profile_path ? tmdbPoster(item.profile_path, 'w185') : '',
      overview: '',
      role: roleLabel,
      knownFor: knownTitles.join(', '),
      raw: item
    };
  }

  /* ---------- Search ---------- */
  async function runSearch(rawQuery) {
    const query = String(rawQuery || '').trim();
    activeQuery = query;
    const myToken = ++queryToken;

    const empty = $('shelfd-search-empty');
    const results = $('shelfd-search-results');
    const status = $('shelfd-search-status');
    if (!empty || !results || !status) return;

    if (!query) {
      results.hidden = true; results.innerHTML = '';
      status.hidden = true; status.innerHTML = '';
      empty.hidden = false;
      renderRecents();
      ensureTrending();
      return;
    }

    empty.hidden = true;
    results.hidden = true;
    status.hidden = false;
    status.innerHTML = renderSkeletonRows(5);

    let tmdbItems = [];
    let gameItems = [];
    let jikanItems = [];
    let personItems = [];
    try {
      const tasks = [];
      /* v654: anime filter no longer pulls TMDB. Only the 'all' tab and the
         non-anime TMDB filters touch TMDB. Anime is fetched from Jikan in
         parallel for both 'all' and 'anime'.
         v732: 'person' is its own filter — Actors chip — and only pulls TMDB
         search/person. The 'all' tab does NOT include people (would dilute
         media results); switch to the chip explicitly to find people. */
      const wantTmdb = activeFilter === 'all' || activeFilter === 'movie' || activeFilter === 'tv';
      const wantJikanAnime = activeFilter === 'all' || activeFilter === 'anime';
      const wantGames = activeFilter === 'all' || activeFilter === 'game';
      const wantPeople = activeFilter === 'person';

      if (wantTmdb && typeof window.fetchTmdbSearchResults === 'function') {
        /* v739: strictPrefix:false → don't drop non-prefix-matching items.
           The page has its own normalized relevance + popularity ranker. */
        tasks.push(window.fetchTmdbSearchResults(query, { strictPrefix: false }).then(arr => { tmdbItems = Array.isArray(arr) ? arr : []; }).catch(() => {}));
      }
      if (wantJikanAnime && window.JikanAnime?.searchAnime) {
        tasks.push(window.JikanAnime.searchAnime(query, 12).then(arr => {
          jikanItems = (arr || []).map(window.JikanAnime.mapItem).filter(Boolean);
        }).catch(() => {}));
      }
      if (wantGames && typeof window.fetchRawgSearchResults === 'function') {
        /* v739: strictPrefix:false — see TMDB note above. */
        tasks.push(window.fetchRawgSearchResults(query, { strictPrefix: false }).then(arr => { gameItems = Array.isArray(arr) ? arr : []; }).catch(() => {}));
      }
      if (wantPeople && typeof window.fetchTmdbPersonSearchResults === 'function') {
        tasks.push(window.fetchTmdbPersonSearchResults(query).then(arr => { personItems = Array.isArray(arr) ? arr : []; }).catch(() => {}));
      }
      await Promise.all(tasks);
    } catch (_) { /* swallowed; will show no-results */ }

    if (myToken !== queryToken) return;

    /* v671: Enrich movie/TV results with IMDb rating before normalizing so
       r.rating reflects IMDb (display + sort by IMDb rating). Games keep
       RAWG's own rating. */
    if (typeof window.enrichItemsWithImdbRatings === 'function' && tmdbItems.length) {
      try { await window.enrichItemsWithImdbRatings(tmdbItems); } catch (e) { /* fall through with TMDB */ }
      if (myToken !== queryToken) return;
    }

    /* v654: Filter out anime from TMDB results so we don't double-list when
       'all' is active (Jikan handles anime exclusively). */
    const dropAnimeFromTmdb = (arr) => arr.filter(x =>
      !(typeof window.isAnimeDiscoverCandidate === 'function' && window.isAnimeDiscoverCandidate(x))
    );

    /* Apply filter */
    let rows = [];
    if (activeFilter === 'all') {
      rows = [
        ...dropAnimeFromTmdb(tmdbItems).map(normalizeTmdbItem),
        ...jikanItems.map(normalizeTmdbItem),  /* same shape — just routes id/poster from Jikan */
        ...gameItems.map(normalizeGameItem)
      ];
    } else if (activeFilter === 'movie') {
      rows = tmdbItems.filter(x => x.media_type === 'movie').map(normalizeTmdbItem);
    } else if (activeFilter === 'tv') {
      rows = dropAnimeFromTmdb(tmdbItems).filter(x => x.media_type === 'tv').map(normalizeTmdbItem);
    } else if (activeFilter === 'anime') {
      rows = jikanItems.map(normalizeTmdbItem);
    } else if (activeFilter === 'game') {
      rows = gameItems.map(normalizeGameItem);
    } else if (activeFilter === 'person') {
      rows = personItems.map(normalizePersonItem);
    }

    /* v737: Sort = letter-for-letter relevance + popularity boost.
       Two real bugs were demoting popular titles:
         1. "spiderman" wasn't matching "Spider-Man" because the hyphen
            broke the prefix check. Fix: normalize both query and title
            (strip hyphens/colons/apostrophes/accents/punctuation).
         2. Popularity was only used as a within-tier tie-breaker, so an
            obscure title that happened to spell its name as an exact
            match always beat a hugely popular partial match. Fix: bake
            a logarithmic popularity boost (up to +500) into the score,
            so e.g. an obscure game scored 1000 + 30 = 1030 loses to
            "Marvel's Spider-Man" scored 600 + 480 = 1080. */
    function normalizeMatchText(s) {
      return String(s || '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')   /* strip accents     */
        .replace(/[-_:.,/'"!?&()\[\]]/g, ' ')                /* punctuation→space */
        .replace(/\s+/g, ' ').trim();
    }
    const qN = normalizeMatchText(query);
    const qNoSpace = qN.replace(/\s+/g, '');
    const qWords = qN.split(' ').filter(Boolean);
    function relevanceScore(title) {
      const t = normalizeMatchText(title);
      if (!t || !qN) return 0;
      const tNoSpace = t.replace(/\s+/g, '');
      /* "spiderman" vs "spider man" should both match Spider-Man → compare
         space-collapsed forms first, then the spaced forms. */
      if (t === qN || tNoSpace === qNoSpace) return 1000;        // exact
      if (t.startsWith(qN) || tNoSpace.startsWith(qNoSpace)) return 800; // prefix
      const tWords = t.split(' ').filter(Boolean);
      if (qWords.length && qWords.every(qw => tWords.some(tw => tw.startsWith(qw)))) return 600;
      if (t.includes(' ' + qN)) return 500;                       // word-boundary substring
      if (t.includes(qN) || tNoSpace.includes(qNoSpace)) return 300; // substring anywhere
      if (qWords.length && qWords.every(qw => t.includes(qw))) return 100;
      return 0;
    }
    /* v740: heavier popularity boost. The relevance tier gap between an
       exact match (1000) and a word-prefix match (600) is 400 — and a
       low-popularity exact-match (e.g. obscure indie titled "Spiderman")
       must lose to a hugely popular partial-match (e.g. Marvel's
       Spider-Man with 50K+ adds / 600K+ IMDb votes). Multiplier 200 with
       a 900 cap means: ~50K engagement → +940 → wins by ~140 over an
       exact match with ~50 engagement (boost ~340). */
    function popularityBoost(p) {
      const n = Math.max(0, Number(p) || 0);
      if (!n) return 0;
      return Math.min(900, Math.log10(n + 1) * 200);
    }
    rows.sort((a, b) => {
      const as = relevanceScore(a.title) + popularityBoost(a.popularity);
      const bs = relevanceScore(b.title) + popularityBoost(b.popularity);
      if (as !== bs) return bs - as;
      const ar = parseFloat(a.rating || '0') || 0;
      const br = parseFloat(b.rating || '0') || 0;
      if (ar !== br) return br - ar;
      const ay = parseInt(a.year || '0', 10) || 0;
      const by = parseInt(b.year || '0', 10) || 0;
      if (ay !== by) return by - ay;                              // newer wins
      return (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });
    });
    rows = rows.slice(0, SEARCH_LIMIT);
    lastResultRows = rows;

    if (!rows.length) {
      status.hidden = false;
      status.innerHTML = `
        <div class="shelfd-search-noresults">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <strong>No results for &ldquo;${escHtml(query)}&rdquo;</strong>
          <p>Try a shorter title, a different spelling, or another category.</p>
        </div>`;
      results.hidden = true; results.innerHTML = '';
      return;
    }

    status.hidden = true; status.innerHTML = '';
    results.hidden = false;
    results.innerHTML = rows.map((r, i) => renderResultRow(r, i)).join('');
    /* v651: kick off the lazy credits backfill in parallel for all rows. */
    backfillResultCredits(rows, myToken);
  }

  function renderResultRow(r, index) {
    /* v651: 3-line layout —
        1. title
        2. year · media type (combined with dot separator)
        3. directed by [Name] (or "Created by" for TV/anime, "Developed by"
           for games). The credit name is fetched lazily after render
           and patched into the DOM via [data-row-cred-key].
    */
    /* v654: Jikan-sourced anime rows route to the Jikan profile path.
       v732: person rows route to the existing TMDB person profile. */
    const handler = r.kind === 'game'
      ? `handleSearchPageGameClick(event, '${escAttr(r.id)}')`
      : r.kind === 'person'
        ? `handleSearchPagePersonClick(event, '${escAttr(r.id)}')`
        : (r.isJikan
          ? `handleSearchPageJikanClick(event, '${escAttr(r.malId)}')`
          : `handleSearchPageMediaClick(event, '${escAttr(r.tmdbType)}', '${escAttr(r.id)}')`);
    const typeLabel = r.kind === 'movie' ? 'Movie'
      : r.kind === 'tv' ? 'TV Show'
      : r.kind === 'anime' ? 'Anime'
      : r.kind === 'game' ? 'Game'
      : r.kind === 'person' ? (r.role || 'Actor')
      : '';
    /* People show "Actor · Known for: …" instead of "Year · Type". */
    const metaText = r.kind === 'person'
      ? typeLabel
      : [r.year, typeLabel].filter(Boolean).join(' · ');
    const yearTypeHtml = metaText
      ? `<span class="shelfd-search-row-meta">${escHtml(metaText)}</span>`
      : '';
    /* Person rows show "Known for: A, B, C" instead of the lazy credits line. */
    let credHtml = '';
    if (r.kind === 'person') {
      credHtml = r.knownFor
        ? `<span class="shelfd-search-row-credit"><span class="shelfd-search-row-credit-prefix">Known for </span><span class="shelfd-search-row-credit-name">${escHtml(r.knownFor)}</span></span>`
        : '';
    } else {
      const credPrefix = r.kind === 'movie' ? 'Directed by'
        : (r.kind === 'tv' || r.kind === 'anime') ? 'Created by'
        : r.kind === 'game' ? 'Developed by'
        : '';
      credHtml = credPrefix
        ? `<span class="shelfd-search-row-credit" data-row-cred-key="${escAttr(r.key)}"><span class="shelfd-search-row-credit-prefix">${escHtml(credPrefix)} </span><span class="shelfd-search-row-credit-name">&hellip;</span></span>`
        : '';
    }
    const posterClass = r.kind === 'person'
      ? 'shelfd-search-row-poster shelfd-search-row-poster--person'
      : 'shelfd-search-row-poster';
    const posterHtml = r.poster
      ? `<img class="${posterClass}" src="${escAttr(r.poster)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
      : `<div class="${posterClass} shelfd-search-row-poster--placeholder" aria-hidden="true"></div>`;
    /* Stagger up to 8 rows. After that they appear instantly to keep scrolling responsive. */
    const delayMs = Math.min(index, 7) * 28;
    return `
      <button type="button" class="shelfd-search-row" style="--shelfd-row-delay:${delayMs}ms" onclick="${handler}" data-row-kind="${escAttr(r.kind)}">
        ${posterHtml}
        <span class="shelfd-search-row-body">
          <span class="shelfd-search-row-title">${escHtml(r.title)}</span>
          ${yearTypeHtml}
          ${credHtml}
        </span>
        <span class="shelfd-search-row-chevron" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </span>
      </button>`;
  }

  /* v651: Lazy credits fetcher — populates the "Directed by / Created by /
     Developed by [Name]" line after each result row is rendered. Cached so
     re-searching the same query doesn't refetch. */
  const creditsCache = new Map();
  async function fetchCreditFor(r) {
    if (!r || !r.key) return '';
    if (creditsCache.has(r.key)) return creditsCache.get(r.key);
    let name = '';
    try {
      /* v654: Jikan-sourced anime rows pull "Created by" from the studio
         (Jikan doesn't have a director field for most TV anime). */
      if (r.isJikan && r.malId && window.JikanAnime?.animeFull) {
        const j = await window.JikanAnime.animeFull(r.malId);
        if (j) {
          name = (Array.isArray(j.studios) ? j.studios : [])[0]?.name
              || (Array.isArray(j.producers) ? j.producers : [])[0]?.name
              || '';
        }
      } else if (r.kind === 'movie' || r.kind === 'tv' || r.kind === 'anime') {
        const tmdbType = r.tmdbType || (r.kind === 'movie' ? 'movie' : 'tv');
        const url = `/api/tmdb/${tmdbType}/${encodeURIComponent(r.id)}?append_to_response=credits`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (tmdbType === 'movie') {
            const dir = (data.credits?.crew || []).find(c => c.job === 'Director');
            name = dir?.name || '';
          } else {
            name = (data.created_by || [])[0]?.name || '';
            if (!name) {
              const dir = (data.credits?.crew || []).find(c => c.job === 'Director');
              name = dir?.name || '';
            }
          }
        }
      } else if (r.kind === 'game') {
        const res = await fetch(`/api/rawg/games/${encodeURIComponent(r.id)}`);
        if (res.ok) {
          const data = await res.json();
          name = (data.developers || [])[0]?.name
              || (data.publishers || [])[0]?.name
              || '';
        }
      }
    } catch (e) {
      /* swallow — empty name just means we won't fill the line */
    }
    creditsCache.set(r.key, name);
    return name;
  }
  function backfillResultCredits(rows = [], forToken = 0) {
    rows.forEach(r => {
      /* v732: person rows already render their own "Known for" line —
         no async credit lookup needed. */
      if (r.kind === 'person') return;
      fetchCreditFor(r).then(name => {
        /* Stop applying if a newer search has started */
        if (forToken !== queryToken) return;
        if (!name) {
          /* No data — collapse the placeholder line so the row doesn't
             show a stray dash. */
          const wrap = document.querySelector(`[data-row-cred-key="${CSS.escape(String(r.key))}"]`);
          if (wrap) wrap.style.display = 'none';
          return;
        }
        const el = document.querySelector(`[data-row-cred-key="${CSS.escape(String(r.key))}"] .shelfd-search-row-credit-name`);
        if (el) el.textContent = name;
      }).catch(() => {});
    });
  }

  function renderSkeletonRows(n) {
    return `<div class="shelfd-search-skeleton-list">${
      Array.from({ length: n }, () => `
        <div class="shelfd-search-skeleton-row">
          <div class="shelfd-search-skeleton-poster"></div>
          <div class="shelfd-search-skeleton-body">
            <div class="shelfd-search-skeleton-line shelfd-search-skeleton-line--title"></div>
            <div class="shelfd-search-skeleton-line shelfd-search-skeleton-line--meta"></div>
          </div>
        </div>`).join('')
    }</div>`;
  }

  /* ---------- Trending strip on empty state ---------- */
  async function ensureTrending() {
    if (trendingLoaded) return;
    if (typeof window.fetchTmdbWeeklyTrendingMedia !== 'function') return;
    const row = $('shelfd-search-trending-row');
    if (!row) return;
    row.innerHTML = `<div class="shelfd-search-trending-skeleton"></div><div class="shelfd-search-trending-skeleton"></div><div class="shelfd-search-trending-skeleton"></div><div class="shelfd-search-trending-skeleton"></div>`;
    try {
      const items = await window.fetchTmdbWeeklyTrendingMedia('mixed');
      const list = (Array.isArray(items) ? items : []).slice(0, 12);
      if (!list.length) { row.innerHTML = ''; return; }
      row.innerHTML = list.map(item => {
        const isMovie = item.media_type === 'movie';
        const title = isMovie ? (item.title || item.original_title || '') : (item.name || item.original_name || '');
        const poster = tmdbPoster(item.poster_path, 'w342');
        const tmdbType = isMovie ? 'movie' : 'tv';
        return `
          <button type="button" class="shelfd-search-trending-card" onclick="handleSearchPageMediaClick(event, '${escAttr(tmdbType)}', '${escAttr(item.id)}')" title="${escAttr(title)}">
            ${poster ? `<img src="${escAttr(poster)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : `<div class="shelfd-search-trending-card-placeholder"></div>`}
            <span>${escHtml(title)}</span>
          </button>`;
      }).join('');
      trendingLoaded = true;
    } catch (_) {
      row.innerHTML = '';
    }
  }

  /* ---------- Filter chips ---------- */
  function setActiveFilter(filter) {
    activeFilter = filter;
    document.querySelectorAll('.shelfd-search-chip').forEach(btn => {
      const isActive = btn.getAttribute('data-search-filter') === filter;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    if (activeQuery) runSearch(activeQuery);
  }

  /* ---------- Public click handlers (wired into onclick attrs above) ----------
     v647: We DON'T close the search overlay when opening a media profile.
     The media profile (z-index 3100) stacks above the search overlay
     (z-index 2100), so closing the media profile reveals the search results
     underneath — preserving the user's query and scroll position. */
  window.handleSearchPageMediaClick = function(event, type, id) {
    pushRecent(activeQuery);
    if (typeof window.openDiscoverMediaProfile === 'function') {
      try {
        window.openDiscoverMediaProfile(event, type, id);
      } catch (e) { console.error('Open media profile failed:', e); }
    }
  };
  window.handleSearchPageGameClick = function(event, id) {
    pushRecent(activeQuery);
    if (typeof window.openGameMediaProfile === 'function') {
      try {
        window.openGameMediaProfile(event, id);
      } catch (e) { console.error('Open game profile failed:', e); }
    }
  };
  /* v654: Jikan-sourced anime row click → Jikan profile (mal_id). */
  window.handleSearchPageJikanClick = function(event, malId) {
    pushRecent(activeQuery);
    if (typeof window.openJikanAnimeProfile === 'function') {
      try {
        window.openJikanAnimeProfile(event, malId);
      } catch (e) { console.error('Open Jikan anime profile failed:', e); }
    }
  };
  /* v732: Actors filter row click → existing TMDB person profile. */
  window.handleSearchPagePersonClick = function(event, personId) {
    pushRecent(activeQuery);
    if (typeof window.openDiscoverPersonProfile === 'function') {
      try {
        window.openDiscoverPersonProfile(event, personId);
      } catch (e) { console.error('Open person profile failed:', e); }
    }
  };

  /* v647: Smart back button — sequential history-style behavior.
       State A: empty query, on the empty/browse view → close the search page
       State B: query active, results showing → clear the query (return to A)
       (State C, with media profile on top, is handled by the media profile's
        own back button — closing it reveals search underneath, in State B.) */
  window.handleSearchBack = function() {
    const input = document.getElementById('shelfd-search-input');
    const clearBtn = document.getElementById('shelfd-search-clear-btn');
    const hasQuery = !!(input && input.value && input.value.trim().length);
    if (hasQuery) {
      /* State B → State A */
      if (input) input.value = '';
      if (clearBtn) clearBtn.hidden = true;
      runSearch('');
      /* Blur so the chips hide too */
      try { input && input.blur(); } catch (_) {}
      return;
    }
    /* State A → close search page */
    if (typeof window.closeSearchPage === 'function') window.closeSearchPage();
  };

  /* ---------- Initial wiring (idempotent) ---------- */
  function initSearchPage() {
    if (pageInitialized) return;
    const input = $('shelfd-search-input');
    const clearBtn = $('shelfd-search-clear-btn');
    const inputWrap = document.querySelector('.shelfd-search-input-wrap');
    const recentList = $('shelfd-search-recent-list');
    const recentClear = $('shelfd-search-clear-recents');
    const chipsRow = document.querySelector('.shelfd-search-chips');
    const browseGrid = document.querySelector('.shelfd-search-browse-grid');
    if (!input) return;
    pageInitialized = true;

    /* iOS PWA fix: the wrap was previously a <label>, but iOS suppresses the
       keyboard when a <label> contains both an <input> and a <button>. We use
       a <div> now and forward taps on the icon padding directly to the input
       inside the user-gesture call stack. */
    if (inputWrap) {
      inputWrap.addEventListener('pointerdown', (e) => {
        if (e.target === input || (e.target instanceof Element && e.target.closest('.shelfd-search-clear-btn'))) return;
        /* focus synchronously inside the gesture so iOS shows the keyboard */
        try { input.focus({ preventScroll: false }); } catch (_) { input.focus(); }
      });
      /* Pointer events isn't supported on every iOS version — also catch click. */
      inputWrap.addEventListener('click', (e) => {
        if (e.target === input || (e.target instanceof Element && e.target.closest('.shelfd-search-clear-btn'))) return;
        try { input.focus({ preventScroll: false }); } catch (_) { input.focus(); }
      });
    }

    /* v646: filter chips hidden until the user focuses the search composer.
       Stays visible while there's a query in the box; disappears again once
       the box is blurred AND empty. */
    const chipsRow2 = document.querySelector('.shelfd-search-chips');
    function updateChipsVisibility() {
      if (!chipsRow2) return;
      const focused = document.activeElement === input;
      const hasQuery = !!(input.value && input.value.trim().length);
      if (focused || hasQuery) chipsRow2.classList.add('shelfd-search-chips--visible');
      else chipsRow2.classList.remove('shelfd-search-chips--visible');
    }
    input.addEventListener('focus', updateChipsVisibility);
    input.addEventListener('blur', updateChipsVisibility);
    input.addEventListener('input', updateChipsVisibility);
    /* Sync once on init in case input has a stored value */
    updateChipsVisibility();

    const onInput = () => {
      const v = input.value;
      if (clearBtn) clearBtn.hidden = !v;
      clearTimeout(debounceTimer);
      const q = v.trim();
      if (!q) { runSearch(''); return; }
      debounceTimer = setTimeout(() => runSearch(q), DEBOUNCE_MS);
    };
    input.addEventListener('input', onInput);
    input.addEventListener('search', onInput); /* iOS clear-button event */
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(debounceTimer);
        const q = input.value.trim();
        if (q) { pushRecent(q); runSearch(q); input.blur(); }
      } else if (e.key === 'Escape') {
        if (input.value) { input.value = ''; onInput(); }
        else if (typeof window.closeSearchPage === 'function') window.closeSearchPage();
      }
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        input.value = '';
        clearBtn.hidden = true;
        runSearch('');
        /* Refocus so users can keep typing */
        requestAnimationFrame(() => input.focus());
      });
    }

    if (chipsRow) {
      chipsRow.addEventListener('click', (e) => {
        const target = e.target.closest('.shelfd-search-chip');
        if (!target) return;
        const filter = target.getAttribute('data-search-filter') || 'all';
        setActiveFilter(filter);
      });
    }

    if (browseGrid) {
      browseGrid.addEventListener('click', (e) => {
        const target = e.target.closest('.shelfd-search-browse-card');
        if (!target) return;
        const type = target.getAttribute('data-browse-type') || '';
        const filterMap = { movie: 'movie', tv: 'tv', anime: 'anime', game: 'game' };
        const filter = filterMap[type] || 'all';
        setActiveFilter(filter);
        /* If the user hasn't typed anything, focus the input to invite typing */
        requestAnimationFrame(() => input.focus());
      });
    }

    if (recentList) {
      recentList.addEventListener('click', (e) => {
        const target = e.target.closest('[data-recent-query]');
        if (!target) return;
        const q = target.getAttribute('data-recent-query') || '';
        input.value = q;
        if (clearBtn) clearBtn.hidden = !q;
        runSearch(q);
      });
    }
    if (recentClear) recentClear.addEventListener('click', clearRecents);

    /* Initial render */
    renderRecents();
  }

  /* Auto-focus input when page opens. We hook into the existing openSearchPage. */
  function patchOpenSearchPage() {
    const original = window.openSearchPage;
    if (typeof original !== 'function' || original.__shelfdSearchPatched) return;
    const wrapped = function() {
      original.apply(this, arguments);
      initSearchPage();
      ensureTrending();
      const input = $('shelfd-search-input');
      /* Focus on next-frame so the slide-up animation isn't interrupted by keyboard rise */
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (input) {
          /* Don't auto-focus on coarse-pointer devices to avoid keyboard popping unsolicited.
             Users tap the input themselves on mobile. */
          if (!matchMedia('(pointer: coarse)').matches) input.focus();
        }
      }));
    };
    wrapped.__shelfdSearchPatched = true;
    window.openSearchPage = wrapped;
  }

  /* Init on DOM ready, then patch openSearchPage once it exists. */
  function start() {
    initSearchPage();
    patchOpenSearchPage();
    /* If the patch happens before openSearchPage is defined, retry until it is. */
    let tries = 0;
    const tick = () => {
      if (typeof window.openSearchPage === 'function' && !window.openSearchPage.__shelfdSearchPatched) {
        patchOpenSearchPage();
      }
      if (++tries < 40 && (!window.openSearchPage || !window.openSearchPage.__shelfdSearchPatched)) {
        setTimeout(tick, 100);
      }
    };
    tick();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

})();
