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
    return `https://image.tmdb.org/t/p/${size}${path}`;
  }
  function gamePoster(item) {
    return item?.background_image || item?.cover || '';
  }

  /* ---------- Item normalizer for unified row rendering ---------- */
  function normalizeTmdbItem(item) {
    const isMovie = item.media_type === 'movie';
    const title = isMovie ? (item.title || item.original_title || '') : (item.name || item.original_name || '');
    const date = isMovie ? (item.release_date || '') : (item.first_air_date || '');
    const year = (date || '').slice(0, 4);
    const isAnime = !isMovie && (typeof window.isAnimeDiscoverCandidate === 'function' ? window.isAnimeDiscoverCandidate(item) : false);
    const kind = isAnime ? 'anime' : (isMovie ? 'movie' : 'tv');
    const rating = Number(item.vote_average || 0);
    return {
      key: `tmdb:${item.media_type}:${item.id}`,
      kind,
      tmdbType: isMovie ? 'movie' : 'tv',
      id: item.id,
      title,
      year,
      rating: rating > 0 ? rating.toFixed(1) : '',
      poster: tmdbPoster(item.poster_path),
      overview: String(item.overview || '').trim(),
      raw: item
    };
  }
  function normalizeGameItem(item) {
    const year = (item.released || '').slice(0, 4);
    const rating = Number(item.rating || 0);
    return {
      key: `game:${item.id}`,
      kind: 'game',
      id: item.id,
      title: item.name || '',
      year,
      rating: rating > 0 ? rating.toFixed(1) : '',
      poster: gamePoster(item),
      overview: '',
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
    try {
      const tasks = [];
      const wantTmdb = activeFilter === 'all' || activeFilter === 'movie' || activeFilter === 'tv' || activeFilter === 'anime';
      const wantGames = activeFilter === 'all' || activeFilter === 'game';

      if (wantTmdb && typeof window.fetchTmdbSearchResults === 'function') {
        tasks.push(window.fetchTmdbSearchResults(query).then(arr => { tmdbItems = Array.isArray(arr) ? arr : []; }).catch(() => {}));
      }
      if (wantGames && typeof window.fetchRawgSearchResults === 'function') {
        tasks.push(window.fetchRawgSearchResults(query).then(arr => { gameItems = Array.isArray(arr) ? arr : []; }).catch(() => {}));
      }
      await Promise.all(tasks);
    } catch (_) { /* swallowed; will show no-results */ }

    if (myToken !== queryToken) return;

    /* Apply filter */
    let rows = [];
    if (activeFilter === 'all') {
      rows = [...tmdbItems.map(normalizeTmdbItem), ...gameItems.map(normalizeGameItem)];
    } else if (activeFilter === 'movie') {
      rows = tmdbItems.filter(x => x.media_type === 'movie').map(normalizeTmdbItem);
    } else if (activeFilter === 'tv') {
      rows = tmdbItems.filter(x => x.media_type === 'tv' && !(typeof window.isAnimeDiscoverCandidate === 'function' && window.isAnimeDiscoverCandidate(x))).map(normalizeTmdbItem);
    } else if (activeFilter === 'anime') {
      rows = tmdbItems.filter(x => typeof window.isAnimeDiscoverCandidate === 'function' && window.isAnimeDiscoverCandidate(x)).map(normalizeTmdbItem);
    } else if (activeFilter === 'game') {
      rows = gameItems.map(normalizeGameItem);
    }

    /* Sort: prefix match first, then rating, then title */
    const ql = query.toLowerCase();
    rows.sort((a, b) => {
      const ap = (a.title || '').toLowerCase().startsWith(ql) ? 1 : 0;
      const bp = (b.title || '').toLowerCase().startsWith(ql) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      const ar = parseFloat(a.rating || '0') || 0;
      const br = parseFloat(b.rating || '0') || 0;
      if (ar !== br) return br - ar;
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
  }

  function renderResultRow(r, index) {
    const handler = r.kind === 'game'
      ? `handleSearchPageGameClick(event, '${escAttr(r.id)}')`
      : `handleSearchPageMediaClick(event, '${escAttr(r.tmdbType)}', '${escAttr(r.id)}')`;
    const meta = [
      r.kind === 'movie' ? 'Movie' : r.kind === 'tv' ? 'TV' : r.kind === 'anime' ? 'Anime' : r.kind === 'game' ? 'Game' : '',
      r.year || ''
    ].filter(Boolean).join(' · ');
    const ratingHtml = r.rating ? `<span class="shelfd-search-row-rating"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z"/></svg>${escHtml(r.rating)}</span>` : '';
    const overviewHtml = r.overview ? `<p class="shelfd-search-row-overview">${escHtml(r.overview)}</p>` : '';
    const posterHtml = r.poster
      ? `<img class="shelfd-search-row-poster" src="${escAttr(r.poster)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
      : `<div class="shelfd-search-row-poster shelfd-search-row-poster--placeholder" aria-hidden="true"></div>`;
    /* Stagger up to 8 rows. After that they appear instantly to keep scrolling responsive. */
    const delayMs = Math.min(index, 7) * 28;
    return `
      <button type="button" class="shelfd-search-row" style="--shelfd-row-delay:${delayMs}ms" onclick="${handler}" data-row-kind="${escAttr(r.kind)}">
        ${posterHtml}
        <span class="shelfd-search-row-body">
          <span class="shelfd-search-row-title">${escHtml(r.title)}</span>
          <span class="shelfd-search-row-meta">${escHtml(meta)}${ratingHtml}</span>
          ${overviewHtml}
        </span>
        <span class="shelfd-search-row-chevron" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </span>
      </button>`;
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

  /* ---------- Public click handlers (wired into onclick attrs above) ---------- */
  window.handleSearchPageMediaClick = function(event, type, id) {
    pushRecent(activeQuery);
    /* Remember query for the close-then-restore — we leave it as-is */
    if (typeof window.openDiscoverMediaProfile === 'function') {
      try {
        /* Close the search overlay so the media profile sits over the actual app */
        if (typeof window.closeSearchPage === 'function') window.closeSearchPage();
        window.openDiscoverMediaProfile(event, type, id);
      } catch (e) { console.error('Open media profile failed:', e); }
    }
  };
  window.handleSearchPageGameClick = function(event, id) {
    pushRecent(activeQuery);
    if (typeof window.openGameMediaProfile === 'function') {
      try {
        if (typeof window.closeSearchPage === 'function') window.closeSearchPage();
        window.openGameMediaProfile(event, id);
      } catch (e) { console.error('Open game profile failed:', e); }
    }
  };

  /* ---------- Initial wiring (idempotent) ---------- */
  function initSearchPage() {
    if (pageInitialized) return;
    const input = $('shelfd-search-input');
    const clearBtn = $('shelfd-search-clear-btn');
    const recentList = $('shelfd-search-recent-list');
    const recentClear = $('shelfd-search-clear-recents');
    const chipsRow = document.querySelector('.shelfd-search-chips');
    const browseGrid = document.querySelector('.shelfd-search-browse-grid');
    if (!input) return;
    pageInitialized = true;

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
