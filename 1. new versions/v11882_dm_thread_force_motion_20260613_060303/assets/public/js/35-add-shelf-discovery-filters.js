/* =============================================================================
   Add to Shelf (+) — Discovery preset hub & filters
   File: assets/public/js/35-add-shelf-discovery-filters.js
   v11.219

   Ports the Discovery search PRESET HUB (the vertical drill-down list:
   Release Date, Genre, Country, Language, Service, Most Popular, Highest Rated,
   Most Anticipated, Featured / Official Lists) onto the bottom-nav center (+)
   "Add to Shelf" universal search page, restyled to fit the modal.

     - Same markup/classes as Discovery (.add-to-shelf-search-preset-hub /
       .add-to-shelf-search-preset-row) so it looks identical.
     - Drill rows open the shared Discovery filter sheet to that group.
     - Sort rows fetch + render Discovery-style results into the modal.
     - Tapping a result opens the media profile (and closes the modal).
     - Featured / Official Lists is locked (same as Discovery).
     - Typed "Add to Shelf" search is untouched: clearing the box returns the
       hub; typing replaces it with the normal add-to-shelf results.

   Reuses (global, from 11-discovery-media-games-profiles.js):
     fetchDiscoverFilteredMediaItems, renderDiscoverUniversalSearchRows,
     fetchTmdbPages, normalizeDiscoverTypedItems, isAnimeDiscoverCandidate,
     fetchRawgPages, rankDiscoverUniversalRawgGames, getRawgDateString,
     getEmptyDiscoverCategoryFilters, openDiscoverCategoryFilterSheet,
     openDiscoverCategoryFilterPanel, DISCOVER_CATEGORY_FILTER_GROUPS.

   NOTE (deferred): Music + Actors tabs, and Games genre/country/language/
   service filtering, need their own data engines.
   ============================================================================= */
(function () {
  'use strict';

  var MEDIA_ROWS = [
    { key: 'release',     label: 'Release Date',             type: 'drill'  },
    { key: 'genre',       label: 'Genre',                    type: 'drill'  },
    { key: 'country',     label: 'Country',                  type: 'drill'  },
    { key: 'language',    label: 'Language',                 type: 'drill'  },
    { key: 'service',     label: 'Service',                  type: 'drill'  },
    { key: 'popular',     label: 'Most Popular',             type: 'sort'   },
    { key: 'rated',       label: 'Highest Rated',            type: 'sort'   },
    { key: 'anticipated', label: 'Most Anticipated',         type: 'sort'   },
    { key: 'featured',    label: 'Featured / Official Lists',type: 'locked' }
  ];
  var GAME_ROWS = [
    { key: 'release',     label: 'Release Date',             type: 'sort'   },
    { key: 'popular',     label: 'Most Popular',             type: 'sort'   },
    { key: 'rated',       label: 'Highest Rated',            type: 'sort'   },
    { key: 'anticipated', label: 'Most Anticipated',         type: 'sort'   },
    { key: 'featured',    label: 'Featured / Official Lists',type: 'locked' }
  ];

  var browseToken = 0;
  var activeSortKey = '';
  var browseMode = false;        // true once a preset/filter result list is showing
  var discoverBucket = null;
  var wiredResults = false;
  var wiredInput = false;

  function emptyFilters() {
    return (typeof getEmptyDiscoverCategoryFilters === 'function')
      ? getEmptyDiscoverCategoryFilters()
      : { year: [], genre: [], country: [], language: [], service: [] };
  }
  function currentTab() {
    return (typeof addShelfSearchFilter !== 'undefined' && addShelfSearchFilter) ? addShelfSearchFilter : 'all';
  }
  function rowsForTab(tab) {
    if (tab === 'games') return GAME_ROWS;
    if (tab === 'music' || tab === 'person') return null; /* deferred — no engine */
    return MEDIA_ROWS; /* all / movies / tv / anime */
  }
  function tabScope(tab) {
    if (tab === 'all') return 'mixed';
    if (tab === 'movies') return 'movie';
    if (tab === 'tv') return 'tv';
    if (tab === 'anime') return 'anime';
    return '';
  }
  function tabGridId(tab) {
    /* 'discover-universal-search-grid' → scope 'mixed' in getDiscoverCategoryMediaScope */
    if (tab === 'all') return 'discover-universal-search-grid';
    if (tab === 'movies') return 'discover-movie-addshelf-grid';
    if (tab === 'tv') return 'discover-tv-addshelf-grid';
    if (tab === 'anime') return 'anime-discover-addshelf-grid';
    return '';
  }
  function results() { return document.getElementById('tmdb-results'); }

  function syncDiscoverBucket() {
    var gridId = tabGridId(currentTab());
    if (!gridId) return null;
    if (!discoverBucket || discoverBucket.gridId !== gridId) {
      discoverBucket = {
        mode: 'add-shelf',
        gridId: gridId,
        sortKey: 'default',
        filters: (discoverBucket && discoverBucket.filters) || emptyFilters()
      };
    } else {
      discoverBucket.mode = 'add-shelf';
    }
    try { discoverCategoryFullState = discoverBucket; } catch (e) {}
    return discoverBucket;
  }
  function filterCount() {
    if (!discoverBucket || !discoverBucket.filters) return 0;
    var f = discoverBucket.filters;
    return ['year', 'genre', 'country', 'language', 'service']
      .reduce(function (n, k) { return n + ((f[k] && f[k].length) || 0); }, 0);
  }

  /* ───────── hub markup (mirrors Discovery) ───────── */
  function rowHtml(row) {
    if (row.type === 'locked') {
      return '<button class="add-to-shelf-search-preset-row add-to-shelf-search-preset-row-locked" type="button" disabled aria-disabled="true">' +
        '<span class="add-to-shelf-search-preset-lock" aria-hidden="true">🔒</span>' +
        '<span class="add-to-shelf-search-preset-label">' + row.label + '</span>' +
      '</button>';
    }
    return '<button class="add-to-shelf-search-preset-row" type="button" onclick="handleAddShelfPresetRow(\'' + row.key + '\',\'' + row.type + '\')">' +
      '<span class="add-to-shelf-search-preset-label">' + row.label + '</span>' +
      '<span class="add-to-shelf-search-preset-chevron" aria-hidden="true">›</span>' +
    '</button>';
  }

  function renderHub() {
    var grid = results();
    if (!grid) return;
    browseMode = false;
    activeSortKey = '';
    var rows = rowsForTab(currentTab());
    grid.classList.remove('discover-universal-search-results-list');
    if (!rows) { grid.innerHTML = ''; updateFilterButton(); return; }
    grid.innerHTML = '<div class="add-to-shelf-search-preset-hub add-shelf-preset-hub">' + rows.map(rowHtml).join('') + '</div>';
    updateFilterButton();
  }

  function backBarHtml() {
    return '<button type="button" class="add-shelf-hub-back" onclick="window.addShelfBackToPresets&&window.addShelfBackToPresets()">' +
      '<span aria-hidden="true">‹</span> Filters</button>';
  }

  function updateFilterButton() {
    var btn = document.getElementById('add-shelf-filter-btn');
    if (!btn) return;
    btn.style.display = tabGridId(currentTab()) ? 'inline-flex' : 'none';
    var n = filterCount();
    btn.classList.toggle('has-active-filter', !!n);
    var label = btn.querySelector('.add-shelf-filter-count');
    if (label) label.textContent = n ? String(n) : '';
  }

  /* ───────── fetchers ───────── */
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  async function fetchSortedMedia(scope, sortKey) {
    if (scope === 'mixed') {
      var both = await Promise.all([fetchSortedMediaSingle('movie', sortKey), fetchSortedMediaSingle('tv', sortKey)]);
      var merged = (both[0] || []).concat(both[1] || []);
      merged.sort(function (a, b) { return (Number(b.popularity) || 0) - (Number(a.popularity) || 0); });
      return merged.slice(0, 30);
    }
    return fetchSortedMediaSingle(scope, sortKey);
  }

  async function fetchSortedMediaSingle(scope, sortKey) {
    var isMovie = scope === 'movie';
    var path = isMovie ? 'discover/movie' : 'discover/tv';
    var dateField = isMovie ? 'primary_release_date' : 'first_air_date';
    var today = todayStr();
    var params = { include_adult: 'false', watch_region: 'US', sort_by: 'popularity.desc' };
    if (scope === 'anime') params.with_genres = '16';
    if (sortKey === 'rated') {
      params.sort_by = 'vote_average.desc';
      params['vote_count.gte'] = isMovie ? '300' : '150';
      params[dateField + '.lte'] = today;
    } else if (sortKey === 'newest') {
      params.sort_by = dateField + '.desc';
      params['vote_count.gte'] = '8';
      params[dateField + '.lte'] = today;
    } else if (sortKey === 'anticipated') {
      params.sort_by = 'popularity.desc';
      params[dateField + '.gte'] = today;
    } else {
      params['vote_count.gte'] = isMovie ? '50' : '20';
      params[dateField + '.lte'] = today;
    }
    var items = await fetchTmdbPages(path, params, 2);
    var normalized = normalizeDiscoverTypedItems(items, isMovie ? 'movie' : 'tv')
      .filter(function (it) { return it && it.poster_path; });
    return normalized.filter(function (it) { return isAnimeDiscoverCandidate(it) === (scope === 'anime'); }).slice(0, 30);
  }

  async function fetchSortedGames(sortKey) {
    var today = new Date();
    var params;
    if (sortKey === 'rated') {
      params = { ordering: '-rating' };
    } else if (sortKey === 'newest' || sortKey === 'release') {
      var past = new Date(today); past.setFullYear(today.getFullYear() - 1);
      params = { ordering: '-released', dates: getRawgDateString(past) + ',' + getRawgDateString(today) };
    } else if (sortKey === 'anticipated') {
      var future = new Date(today); future.setFullYear(today.getFullYear() + 2);
      var tmw = new Date(today); tmw.setDate(today.getDate() + 1);
      params = { ordering: '-added', dates: getRawgDateString(tmw) + ',' + getRawgDateString(future) };
    } else {
      params = { ordering: '-added' };
    }
    var pool = await fetchRawgPages(params, 3, 80);
    var ranked = (typeof rankDiscoverUniversalRawgGames === 'function') ? rankDiscoverUniversalRawgGames(pool, 'trending') : pool;
    return (ranked || []).slice(0, 30);
  }

  /* ───────── browse runner ───────── */
  async function runBrowse() {
    var grid = results();
    if (!grid) return;
    var tab = currentTab();
    var token = ++browseToken;
    browseMode = true;
    var input = document.getElementById('inp-tmdb-search');
    if (input) input.value = '';
    grid.classList.remove('discover-universal-search-results-list');
    grid.innerHTML = backBarHtml() + '<div class="cover-search-msg">Loading…</div>';
    try {
      var rows = [];
      if (tab === 'games') {
        var games = await fetchSortedGames(activeSortKey || 'popular');
        if (token !== browseToken) return;
        rows = games.map(function (it) { return { kind: 'game', item: it }; });
      } else {
        var scope = tabScope(tab);
        if (!scope) { renderHub(); return; }
        var items;
        if (filterCount() > 0) { syncDiscoverBucket(); items = await fetchDiscoverFilteredMediaItems(); }
        else { items = await fetchSortedMedia(scope, activeSortKey || 'popular'); }
        if (token !== browseToken) return;
        rows = (items || []).map(function (it) { return { kind: 'tmdb', item: it }; });
      }
      if (token !== browseToken) return;
      if (typeof renderDiscoverUniversalSearchRows === 'function') renderDiscoverUniversalSearchRows(rows, grid);
      if (!rows.length) {
        grid.classList.remove('discover-universal-search-results-list');
        grid.innerHTML = backBarHtml() + '<div class="cover-search-msg">Nothing found for this filter.</div>';
      } else {
        grid.insertAdjacentHTML('afterbegin', backBarHtml());
      }
    } catch (e) {
      if (token !== browseToken) return;
      grid.innerHTML = backBarHtml() + '<div class="cover-search-msg">Could not load. Try again.</div>';
    }
  }

  /* ───────── row + sheet handlers ───────── */
  function openFilterSheet(group) {
    var state = syncDiscoverBucket();
    if (!state) return;
    if (typeof openDiscoverCategoryFilterSheet !== 'function') return;
    openDiscoverCategoryFilterSheet();
    if (group && typeof openDiscoverCategoryFilterPanel === 'function' &&
        typeof DISCOVER_CATEGORY_FILTER_GROUPS !== 'undefined' && DISCOVER_CATEGORY_FILTER_GROUPS[group]) {
      setTimeout(function () { openDiscoverCategoryFilterPanel(group); }, 20);
    }
  }

  function handlePresetRow(key, type) {
    if (type === 'locked') return;
    if (type === 'drill') { openFilterSheet(key === 'release' ? 'year' : key); return; }
    activeSortKey = (key === 'release') ? 'newest' : key;
    runBrowse();
  }

  /* called by the reused filter sheet's "Apply and Search" (mode === 'add-shelf') */
  async function applyFilters() {
    activeSortKey = '';
    updateFilterButton();
    await runBrowse();
  }

  function onTabChanged() {
    activeSortKey = '';
    if (discoverBucket) discoverBucket.filters = emptyFilters();
    var input = document.getElementById('inp-tmdb-search');
    var hasQuery = input && String(input.value || '').trim().length >= 2;
    if (!hasQuery) renderHub();
    else updateFilterButton();
  }

  /* ───────── wiring ───────── */
  function wireResults() {
    if (wiredResults) return;
    var grid = results();
    if (!grid) return;
    wiredResults = true;
    grid.addEventListener('click', function (e) {
      if (!browseMode) return;
      var card = e.target && e.target.closest
        ? e.target.closest('.discover-universal-search-result-row, .discover-card') : null;
      if (!card) return;
      setTimeout(function () { try { if (typeof closeModal === 'function') closeModal(); } catch (_) {} }, 0);
    }, true);
  }

  function wireInput() {
    if (wiredInput) return;
    var input = document.getElementById('inp-tmdb-search');
    if (!input) return;
    wiredInput = true;
    input.addEventListener('input', function () {
      var v = String(input.value || '').trim();
      if (!v) { renderHub(); return; }      /* cleared → bring the hub back */
      if (browseMode) browseMode = false;   /* typing → typed search owns results */
    });
  }

  function init() {
    wireResults();
    wireInput();
    renderHub();
  }

  /* exposed */
  window.handleAddShelfPresetRow      = handlePresetRow;
  window.addShelfBackToPresets        = renderHub;
  window.openAddShelfFilterSheet      = function () { openFilterSheet(); };
  window.renderAddShelfPresetRow      = function () { wireResults(); wireInput(); activeSortKey = ''; if (discoverBucket) discoverBucket.filters = emptyFilters(); renderHub(); };
  window.onAddShelfTabChanged         = onTabChanged;
  window.applyAddShelfDiscoveryFilters = applyFilters;
  window.exitAddShelfBrowseMode       = renderHub;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
