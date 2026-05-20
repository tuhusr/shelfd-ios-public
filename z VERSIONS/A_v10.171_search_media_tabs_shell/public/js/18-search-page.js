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
  const PRESET_RESULT_LIMIT = 30;
  const PRESET_PAGE_COUNT = 2;
  const PRESET_POPULAR_PAGE_COUNT = 4;

  let activeFilter = 'all';
  let activeQuery = '';
  let queryToken = 0;
  let debounceTimer = 0;
  let pageInitialized = false;
  let lastResultRows = [];
  let presetPanelStack = [];
  let presetResultToken = 0;
  let activeSearchMediaTab = 'movietv';
  let searchMediaSwipeState = null;

  const PRESET_RELEASE_OPTIONS = [
    { key: 'upcoming', label: 'Upcoming', subtitle: 'Unreleased titles ranked by audience activity' },
    ...[2020, 2010, 2000, 1990, 1980, 1970, 1960, 1950, 1940, 1930, 1920, 1910, 1900, 1890, 1880, 1870]
      .map(start => ({ key: `decade:${start}`, label: `${start}s`, subtitle: `${start}-${start + 9}` }))
  ];

  const PRESET_GENRE_OPTIONS = [
    { label: 'Action', id: 28 },
    { label: 'Adventure', id: 12 },
    { label: 'Animation', id: 16 },
    { label: 'Comedy', id: 35 },
    { label: 'Crime', id: 80 },
    { label: 'Documentary', id: 99 },
    { label: 'Drama', id: 18 },
    { label: 'Family', id: 10751 },
    { label: 'Fantasy', id: 14 },
    { label: 'History', id: 36 },
    { label: 'Horror', id: 27 },
    { label: 'Music', id: 10402 },
    { label: 'Mystery', id: 9648 },
    { label: 'Romance', id: 10749 },
    { label: 'Science Fiction', id: 878 },
    { label: 'TV Movie', id: 10770, mediaType: 'movie' },
    { label: 'Thriller', id: 53 },
    { label: 'War', id: 10752 },
    { label: 'Western', id: 37 }
  ];

  const PRESET_SERVICE_OPTIONS = [
    { key: 'any', label: 'Any', providerId: '' },
    { key: 'apple-tv', label: 'Apple TV', providerId: '350' },
    { key: 'crunchyroll', label: 'Crunchyroll', providerId: '283' },
    { key: 'disney-plus', label: 'Disney Plus', providerId: '337' },
    { key: 'hbo-max', label: 'HBO Max', providerId: '1899' },
    { key: 'hulu', label: 'Hulu', providerId: '15' },
    { key: 'netflix', label: 'Netflix', providerId: '8' },
    { key: 'paramount-plus', label: 'Paramount Plus', providerId: '531' },
    { key: 'peacock', label: 'Peacock', providerId: '386' },
    { key: 'prime-video', label: 'Prime Video', providerId: '9' }
  ];
  const SEARCH_MEDIA_TABS = ['movietv', 'anime', 'games', 'music'];

  let premiumPresetNoticeTimer = 0;

  /* ---------- DOM helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escHtml(s) { return escAttr(s); }

  function renderPresetInlineLockIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path></svg>';
  }

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
    const displayRating = typeof window.formatDisplayTitleRating === 'function'
      ? window.formatDisplayTitleRating(item)
      : (Number(item.imdbRating || 0) > 0 ? Number(item.imdbRating).toFixed(1) : '');
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
      rating: displayRating,
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
    const rawgId = String(item.rawgId || item.rawg_id || (item.source === 'rawg' ? item.id : '') || '').trim();
    const profileId = rawgId || String(item.id || '').trim();
    return {
      key: `game:${profileId || item.name}`,
      kind: 'game',
      id: profileId,
      title: item.name || '',
      year,
      rating: rating > 0 ? rating.toFixed(1) : '',
      popularity,
      poster: gamePoster(item),
      overview: '',
      rawgId,
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

  /* ---------- Preset discovery hub ---------- */
  function getSearchMediaPanelContent(key = '') {
    if (key === 'movietv') {
      return `
        <section class="shelfd-search-section shelfd-search-preset-section" id="shelfd-search-preset-section">
          <div class="shelfd-search-preset-list" aria-label="Preset discovery paths">
            ${renderPresetHubButton('release', 'Release Date')}
            ${renderPresetHubButton('genre', 'Genre')}
            ${renderPresetHubButton('country', 'Country')}
            ${renderPresetHubButton('language', 'Language')}
            ${renderPresetHubButton('service', 'Service')}
            ${renderPresetHubButton('popular', 'Most Popular')}
            ${renderPresetHubButton('rated', 'Highest Rated')}
            ${renderPresetHubButton('anticipated', 'Most Anticipated')}
            ${renderPresetHubButton('featured', 'Featured / Official Lists', true)}
          </div>
        </section>
      `;
    }
    return '<div class="shelfd-search-media-panel-blank" aria-hidden="true"></div>';
  }

  function ensureSearchPresetHub() {
    const moviePanel = $('shelfd-search-media-panel-movietv');
    if (!moviePanel || $('shelfd-search-preset-section')) return;
    moviePanel.innerHTML = getSearchMediaPanelContent('movietv');
    SEARCH_MEDIA_TABS.filter(key => key !== 'movietv').forEach((key) => {
      const panel = $(`shelfd-search-media-panel-${key}`);
      if (panel && !panel.innerHTML.trim()) panel.innerHTML = getSearchMediaPanelContent(key);
    });
  }

  function renderPresetHubButton(key, title, locked = false) {
    const titleHtml = locked
      ? `${renderPresetInlineLockIcon()}<span class="shelfd-search-preset-title-text">${escHtml(title)}</span>`
      : escHtml(title);
    return `
      <button type="button" class="shelfd-search-preset-card${locked ? ' is-locked' : ''}" data-preset-root="${escAttr(key)}">
        <span class="shelfd-search-preset-copy">
          <span class="shelfd-search-preset-title${locked ? ' is-lock-title' : ''}">${titleHtml}</span>
        </span>
        <span class="shelfd-search-preset-arrow" aria-hidden="true">&rsaquo;</span>
      </button>`;
  }

  function ensurePresetStack() {
    let stack = $('shelfd-search-preset-stack');
    if (stack) return stack;
    const inner = document.querySelector('.shelfd-search-page-inner') || $('shelfd-search-page');
    if (!inner) return null;
    stack = document.createElement('div');
    stack.id = 'shelfd-search-preset-stack';
    stack.className = 'shelfd-search-preset-stack';
    stack.setAttribute('aria-hidden', 'true');
    inner.appendChild(stack);
    stack.addEventListener('click', handlePresetPanelClick);
    return stack;
  }

  function ensurePremiumPresetNotice() {
    let notice = $('shelfd-search-premium-notice');
    if (notice) return notice;
    const host = $('shelfd-search-page') || document.body;
    if (!host) return null;
    notice = document.createElement('div');
    notice.id = 'shelfd-search-premium-notice';
    notice.className = 'shelfd-search-premium-notice';
    notice.hidden = true;
    notice.innerHTML = `
      <button type="button" class="shelfd-search-premium-notice-backdrop" data-premium-preset-dismiss aria-label="Close premium message">
        <span class="shelfd-search-premium-notice-card" role="alertdialog" aria-modal="true" aria-label="Premium feature">
          <span class="shelfd-search-premium-notice-copy">These is a premium feature, Shelfd Pro is required</span>
        </span>
      </button>`;
    notice.addEventListener('click', (event) => {
      if (event.target.closest('[data-premium-preset-dismiss]')) hidePremiumPresetNotice();
    });
    host.appendChild(notice);
    return notice;
  }

  function hidePremiumPresetNotice() {
    const notice = $('shelfd-search-premium-notice');
    if (premiumPresetNoticeTimer) {
      clearTimeout(premiumPresetNoticeTimer);
      premiumPresetNoticeTimer = 0;
    }
    if (!notice) return;
    notice.classList.remove('is-open');
    setTimeout(() => {
      if (!notice.classList.contains('is-open')) notice.hidden = true;
    }, 180);
  }

  function showPremiumPresetNotice() {
    const notice = ensurePremiumPresetNotice();
    if (!notice) return;
    if (premiumPresetNoticeTimer) clearTimeout(premiumPresetNoticeTimer);
    notice.hidden = false;
    requestAnimationFrame(() => notice.classList.add('is-open'));
    premiumPresetNoticeTimer = setTimeout(() => hidePremiumPresetNotice(), 2200);
  }

  function renderPresetPanelShell({ title, eyebrow = 'Discovery', subtitle = '', body = '', className = '' } = {}) {
    return `
      <div class="shelfd-search-preset-panel-inner ${escAttr(className)}">
        <div class="shelfd-search-preset-panel-topbar">
          <button type="button" class="shelfd-search-preset-back" data-preset-back aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <div class="shelfd-search-preset-panel-heading">
            ${eyebrow ? `<span>${escHtml(eyebrow)}</span>` : ''}
            <strong>${escHtml(title)}</strong>
          </div>
          <span class="shelfd-search-preset-top-spacer" aria-hidden="true"></span>
        </div>
        ${subtitle ? `<p class="shelfd-search-preset-panel-subtitle">${escHtml(subtitle)}</p>` : ''}
        <div class="shelfd-search-preset-panel-body">${body}</div>
      </div>`;
  }

  function openPresetPanel(panel) {
    const stack = ensurePresetStack();
    if (!stack || !panel?.id) return;
    const previous = presetPanelStack[presetPanelStack.length - 1];
    if (previous?.el) previous.el.classList.add('is-under');
    const el = document.createElement('div');
    el.className = 'shelfd-search-preset-panel';
    el.dataset.panelId = panel.id;
    el.innerHTML = panel.html;
    stack.appendChild(el);
    presetPanelStack.push({ id: panel.id, el });
    stack.classList.add('is-open');
    stack.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-active')));
  }

  function closePresetPanel({ immediate = false } = {}) {
    const stack = $('shelfd-search-preset-stack');
    const current = presetPanelStack.pop();
    if (!stack || !current?.el) return false;
    const previous = presetPanelStack[presetPanelStack.length - 1];
    if (previous?.el) previous.el.classList.remove('is-under');
    if (immediate) {
      current.el.remove();
    } else {
      current.el.classList.remove('is-active');
      current.el.classList.add('is-exiting');
      setTimeout(() => current.el.remove(), 310);
    }
    if (!presetPanelStack.length) {
      stack.classList.remove('is-open');
      stack.setAttribute('aria-hidden', 'true');
    }
    return true;
  }

  function closeAllPresetPanels({ immediate = true } = {}) {
    while (presetPanelStack.length) closePresetPanel({ immediate });
    const stack = $('shelfd-search-preset-stack');
    if (stack) {
      stack.classList.remove('is-open');
      stack.setAttribute('aria-hidden', 'true');
      if (immediate) stack.innerHTML = '';
    }
    presetPanelStack = [];
  }

  function setActiveSearchMediaTab(key = 'movietv') {
    const nextKey = SEARCH_MEDIA_TABS.includes(key) ? key : 'movietv';
    activeSearchMediaTab = nextKey;
    const index = Math.max(0, SEARCH_MEDIA_TABS.indexOf(nextKey));
    const track = $('shelfd-search-media-track');
    if (track) {
      track.style.setProperty('--shelfd-search-media-index', String(index));
      track.style.removeProperty('--shelfd-search-media-drag');
    }
    document.querySelectorAll('[data-search-media-tab]').forEach((btn) => {
      const active = String(btn.getAttribute('data-search-media-tab') || '') === nextKey;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.setAttribute('tabindex', active ? '0' : '-1');
    });
    document.querySelectorAll('[data-search-media-panel]').forEach((panel) => {
      const active = String(panel.getAttribute('data-search-media-panel') || '') === nextKey;
      panel.classList.toggle('is-active', active);
      panel.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
  }

  function bindSearchMediaTabs() {
    const shell = $('shelfd-search-media-shell');
    const viewport = $('shelfd-search-media-viewport');
    const track = $('shelfd-search-media-track');
    if (!shell || !viewport || !track || shell.dataset.mediaTabsBound === 'true') return;
    shell.dataset.mediaTabsBound = 'true';

    shell.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-search-media-tab]');
      if (!tab) return;
      setActiveSearchMediaTab(tab.getAttribute('data-search-media-tab') || 'movietv');
    });

    viewport.addEventListener('touchstart', (event) => {
      if (!event.touches || event.touches.length !== 1) return;
      searchMediaSwipeState = {
        startX: event.touches[0].clientX,
        startY: event.touches[0].clientY,
        dragging: false
      };
      track.classList.add('is-swiping');
    }, { passive: true });

    viewport.addEventListener('touchmove', (event) => {
      if (!searchMediaSwipeState || !event.touches || event.touches.length !== 1) return;
      const dx = event.touches[0].clientX - searchMediaSwipeState.startX;
      const dy = event.touches[0].clientY - searchMediaSwipeState.startY;
      if (!searchMediaSwipeState.dragging) {
        if (Math.abs(dx) < 12 || Math.abs(dx) <= Math.abs(dy)) return;
        searchMediaSwipeState.dragging = true;
      }
      const currentIndex = Math.max(0, SEARCH_MEDIA_TABS.indexOf(activeSearchMediaTab));
      const clampedDx = ((currentIndex === 0 && dx > 0) || (currentIndex === SEARCH_MEDIA_TABS.length - 1 && dx < 0))
        ? dx * 0.35
        : dx;
      track.style.setProperty('--shelfd-search-media-drag', `${clampedDx}px`);
    }, { passive: true });

    const endSwipe = () => {
      if (!searchMediaSwipeState) return;
      const currentIndex = Math.max(0, SEARCH_MEDIA_TABS.indexOf(activeSearchMediaTab));
      const dragPx = parseFloat(track.style.getPropertyValue('--shelfd-search-media-drag') || '0') || 0;
      let nextIndex = currentIndex;
      if (searchMediaSwipeState.dragging) {
        if (dragPx <= -56 && currentIndex < SEARCH_MEDIA_TABS.length - 1) nextIndex = currentIndex + 1;
        if (dragPx >= 56 && currentIndex > 0) nextIndex = currentIndex - 1;
      }
      track.classList.remove('is-swiping');
      track.style.removeProperty('--shelfd-search-media-drag');
      searchMediaSwipeState = null;
      setActiveSearchMediaTab(SEARCH_MEDIA_TABS[nextIndex] || 'movietv');
    };

    viewport.addEventListener('touchend', endSwipe, { passive: true });
    viewport.addEventListener('touchcancel', endSwipe, { passive: true });
  }

  function renderOptionList(options = [], attrs = {}) {
    const action = attrs.action || '';
    return `<div class="shelfd-search-preset-options">${
      options.map(option => `
        <button type="button" class="shelfd-search-preset-option${option.disabled ? ' is-disabled' : ''}" ${action ? `data-preset-action="${escAttr(action)}"` : ''} ${option.key ? `data-preset-key="${escAttr(option.key)}"` : ''} ${option.id ? `data-preset-id="${escAttr(option.id)}"` : ''} ${option.providerId !== undefined ? `data-provider-id="${escAttr(option.providerId)}"` : ''} ${option.mediaType ? `data-media-type="${escAttr(option.mediaType)}"` : ''} ${option.disabled ? 'disabled' : ''}>
          <span>
            <strong>${escHtml(option.label)}</strong>
          </span>
          <span class="shelfd-search-preset-option-arrow" aria-hidden="true">&rsaquo;</span>
        </button>`).join('')
    }</div>`;
  }

  function openPresetRoot(key = '') {
    if (key === 'release') {
      openPresetPanel({
        id: 'release',
        html: renderPresetPanelShell({
          title: 'Release Date',
          subtitle: 'Browse upcoming releases or jump into a decade. Results use TMDB discovery lists, then IMDb data is layered in where available.',
          body: renderOptionList(PRESET_RELEASE_OPTIONS, { action: 'release-option' })
        })
      });
      return;
    }
    if (key === 'genre') {
      openPresetPanel({
        id: 'genre',
        html: renderPresetPanelShell({
          title: 'Genre',
          body: `
            ${renderOptionList(PRESET_GENRE_OPTIONS.map(item => ({ ...item, key: item.label.toLowerCase().replace(/\s+/g, '-') })), { action: 'genre-option' })}
          `
        })
      });
      return;
    }
    if (key === 'country' || key === 'language') {
      const title = key === 'country' ? 'Country' : 'Language';
      openPresetPanel({
        id: key,
        html: renderPresetPanelShell({
          title,
          body: `<div class="shelfd-search-preset-flat-note"><strong>${escHtml(title)} browsing is not connected yet.</strong><span>This should reuse the existing Discovery ${escHtml(title.toLowerCase())} filter data once that list is exported to Full Page Search.</span></div>`
        })
      });
      return;
    }
    if (key === 'service') {
      openPresetPanel({
        id: 'service',
        html: renderPresetPanelShell({
          title: 'Service',
          subtitle: 'Browse by TMDB watch-provider availability in the United States. Provider data can be missing for some titles.',
          body: renderOptionList(PRESET_SERVICE_OPTIONS, { action: 'service-option' })
        })
      });
      return;
    }
    if (key === 'featured') {
      showPremiumPresetNotice();
      return;
    }
    const directMap = {
      popular: { title: 'Most Popular', preset: 'popular', subtitle: 'Popular titles ranked by audience interest and engagement.' },
      rated: { title: 'Highest Rated', preset: 'rated', subtitle: 'IMDb-first ratings with vote-volume confidence.' },
      anticipated: { title: 'Most Anticipated', preset: 'anticipated', subtitle: 'Only unreleased titles ranked by hype and popularity.' }
    };
    if (directMap[key]) openPresetResultsPanel(directMap[key]);
  }

  function handlePresetPanelClick(event) {
    const back = event.target.closest('[data-preset-back]');
    if (back) {
      event.preventDefault();
      closePresetPanel();
      return;
    }
    const root = event.target.closest('[data-preset-root]');
    if (root) {
      event.preventDefault();
      openPresetRoot(root.dataset.presetRoot || '');
      return;
    }
    const actionBtn = event.target.closest('[data-preset-action]');
    if (!actionBtn) return;
    event.preventDefault();
    const action = actionBtn.dataset.presetAction || '';
    if (action === 'release-option') {
      const key = actionBtn.dataset.presetKey || '';
      const option = PRESET_RELEASE_OPTIONS.find(item => item.key === key);
      if (!option) return;
      openPresetResultsPanel({
        title: option.label,
        preset: key === 'upcoming' ? 'upcoming' : 'decade',
        decadeStart: key.startsWith('decade:') ? Number(key.split(':')[1]) : 0,
        subtitle: key === 'upcoming' ? 'Upcoming movies, TV, and anime-style titles.' : `Released from ${option.subtitle}.`
      });
    } else if (action === 'genre-option') {
      const genre = PRESET_GENRE_OPTIONS.find(item => String(item.id) === String(actionBtn.dataset.presetId || ''));
      if (!genre) return;
      openPresetResultsPanel({
        title: genre.label,
        preset: 'genre',
        genreId: genre.id,
        mediaType: genre.mediaType || 'mixed',
        subtitle: `${genre.label} titles ranked by engagement.`
      });
    } else if (action === 'service-option') {
      const service = PRESET_SERVICE_OPTIONS.find(item => String(item.key) === String(actionBtn.dataset.presetKey || ''));
      if (!service) return;
      openPresetResultsPanel({
        title: service.label,
        preset: 'service',
        providerId: service.providerId,
        subtitle: service.providerId ? `Available on ${service.label} in the United States.` : 'Popular titles across services.'
      });
    }
  }

  function openPresetResultsPanel(config = {}) {
    const panelId = `results:${config.preset || 'custom'}:${config.title || Date.now()}`;
    openPresetPanel({
      id: panelId,
      html: renderPresetPanelShell({
        title: config.title || 'Results',
        eyebrow: '',
        subtitle: config.subtitle || '',
        className: 'shelfd-search-preset-panel-results',
        body: `<div class="shelfd-search-preset-results" data-preset-results="${escAttr(panelId)}">${renderPresetResultSkeleton()}</div>`
      })
    });
    loadPresetResults(config, panelId);
  }

  function renderPresetResultSkeleton() {
    return `<div class="shelfd-search-preset-grid is-loading">${
      Array.from({ length: 9 }, () => '<div class="shelfd-search-preset-card-skeleton"><span></span><i></i></div>').join('')
    }</div>`;
  }

  function getPresetDate(offsetDays = 0) {
    const date = new Date(Date.now() + offsetDays * 86400000);
    return date.toISOString().slice(0, 10);
  }

  function getPresetMonthsAgoDate(monthsAgo = 0) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setMonth(date.getMonth() - Number(monthsAgo || 0));
    return date.toISOString().slice(0, 10);
  }

  function getPresetStartOfCurrentYear() {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setMonth(0, 1);
    return date.toISOString().slice(0, 10);
  }

  function getPresetImdbMeanRating(items = []) {
    const ratings = (Array.isArray(items) ? items : [])
      .map(item => Number(item.imdbRating || 0))
      .filter(rating => rating > 0);
    if (!ratings.length) return 6.5;
    return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
  }

  function getPresetTopRatedMinVotes(item = {}) {
    const type = String(item.media_type || '').toLowerCase() === 'movie' ? 'movie' : 'tv';
    return type === 'movie' ? 25000 : 15000;
  }

  function getPresetWeightedRatingScore(item = {}, meanRating = 6.5) {
    const rating = Number(item.imdbRating || 0);
    const votes = Number(item.imdbVotes || 0);
    if (!(rating > 0) || !(votes > 0)) return 0;
    const minVotes = getPresetTopRatedMinVotes(item);
    return (votes / (votes + minVotes)) * rating + (minVotes / (votes + minVotes)) * meanRating;
  }

  function normalizePresetGenreName(value = '') {
    const clean = String(value || '').trim().toLowerCase();
    if (!clean) return '';
    if (clean === 'science fiction' || clean === 'sci-fi') return 'sci-fi';
    if (clean === 'tv movie') return 'tv movie';
    return clean;
  }

  function getPresetGenreAliases(label = '') {
    const normalized = normalizePresetGenreName(label);
    if (!normalized) return [];
    if (normalized === 'sci-fi') return ['sci-fi', 'science fiction'];
    return [normalized];
  }

  function getPresetPrimaryGenreWeight(item = {}, genreLabel = '') {
    const aliases = getPresetGenreAliases(genreLabel);
    if (!aliases.length) return 0;
    const primary = normalizePresetGenreName(item.imdbPrimaryGenre || '');
    if (aliases.includes(primary)) return 2;
    const genreList = Array.isArray(item.imdbGenres) ? item.imdbGenres.map(normalizePresetGenreName) : [];
    if (genreList.some(name => aliases.includes(name))) return 1;
    return 0;
  }

  async function fetchPresetTmdbPages(path, params = {}, pageCount = PRESET_PAGE_COUNT) {
    if (typeof window.fetchTmdbPages === 'function') return window.fetchTmdbPages(path, params, pageCount);
    if (typeof window.fetchTmdbProxy === 'function') {
      const results = [];
      for (let page = 1; page <= pageCount; page += 1) {
        const res = await window.fetchTmdbProxy(path, { ...params, page: String(page) });
        if (!res.ok) continue;
        const json = await res.json();
        results.push(...(json.results || []));
      }
      return results.filter(item => item?.id && item?.poster_path);
    }
    return [];
  }

  function markPresetMediaType(item = {}, type = 'tv') {
    return { ...item, media_type: type === 'movie' ? 'movie' : 'tv' };
  }

  function fetchPresetTypedTmdb(path, params = {}, type = 'tv') {
    return fetchPresetTmdbPages(path, params, PRESET_PAGE_COUNT)
      .then(items => items.map(item => markPresetMediaType(item, type)))
      .catch(error => {
        console.warn('Search preset TMDB request failed:', path, params, error);
        return [];
      });
  }

  function getPresetTitle(item = {}) {
    return item.title || item.name || item.original_title || item.original_name || '';
  }

  function getPresetReleaseDate(item = {}) {
    return item.release_date || item.first_air_date || '';
  }

  function normalizePresetMediaItems(items = [], mediaType = 'mixed') {
    const seen = new Set();
    return (Array.isArray(items) ? items : [])
      .filter(item => item?.id && item.poster_path && getPresetTitle(item))
      .map(item => {
        const type = item.media_type === 'movie' ? 'movie' : (mediaType === 'movie' ? 'movie' : 'tv');
        return { ...item, media_type: type };
      })
      .filter(item => {
        const key = `${item.media_type}:${item.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  async function enrichAndRankPresetItems(items = [], category = 'popular', mediaType = 'mixed') {
    const list = normalizePresetMediaItems(items, mediaType).slice(0, 48);
    if (category !== 'anticipated' && category !== 'upcoming' && typeof window.enrichItemsWithImdbRatings === 'function') {
      try { await window.enrichItemsWithImdbRatings(list, mediaType); } catch (_) {}
    }
    if (typeof window.rankDiscoverTitles === 'function') {
      return window.rankDiscoverTitles(category, list, { mediaType }).slice(0, PRESET_RESULT_LIMIT);
    }
    return list.sort((a, b) => Number(b.popularity || 0) - Number(a.popularity || 0)).slice(0, PRESET_RESULT_LIMIT);
  }

  async function fetchPresetDirect(config = {}) {
    const preset = config.preset || '';
    if (preset === 'rated') {
      let ratedCandidates = [];
      if (typeof window.fetchDiscoverTopRatedMedia === 'function') {
        ratedCandidates = await window.fetchDiscoverTopRatedMedia('mixed').catch(() => []);
      }
      ratedCandidates = normalizePresetMediaItems(ratedCandidates, 'mixed').slice(0, 96);

      if (ratedCandidates.length && typeof window.enrichItemsWithImdbRatings === 'function') {
        try { await window.enrichItemsWithImdbRatings(ratedCandidates, { type: '' }); } catch (_) {}
      }

      const meanRating = getPresetImdbMeanRating(ratedCandidates);
      ratedCandidates.sort((a, b) => {
        const aScore = getPresetWeightedRatingScore(a, meanRating);
        const bScore = getPresetWeightedRatingScore(b, meanRating);
        const aHasScore = aScore > 0;
        const bHasScore = bScore > 0;
        if (aHasScore !== bHasScore) return bHasScore ? 1 : -1;
        if (bScore !== aScore) return bScore - aScore;

        const aVotes = Number(a.imdbVotes || 0);
        const bVotes = Number(b.imdbVotes || 0);
        if (bVotes !== aVotes) return bVotes - aVotes;

        const aRating = Number(a.imdbRating || 0);
        const bRating = Number(b.imdbRating || 0);
        if (bRating !== aRating) return bRating - aRating;

        return String(getPresetTitle(a)).localeCompare(String(getPresetTitle(b)));
      });

      return ratedCandidates.slice(0, PRESET_RESULT_LIMIT);
    }
    if ((preset === 'anticipated' || preset === 'upcoming') && typeof window.fetchAndRankAnticipated === 'function') {
      return window.fetchAndRankAnticipated(PRESET_RESULT_LIMIT, PRESET_PAGE_COUNT, 'mixed');
    }

    const requests = [];
    const includeMovie = config.mediaType !== 'tv';
    const includeTv = config.mediaType !== 'movie';
    const baseParams = { sort_by: 'popularity.desc', include_adult: 'false', watch_region: 'US' };

    if (preset === 'popular') {
      const releasedAfter = getPresetMonthsAgoDate(3);
      const releasedBefore = getPresetDate(0);
      if (includeMovie) requests.push(fetchPresetTmdbPages('discover/movie', {
        ...baseParams,
        'primary_release_date.gte': releasedAfter,
        'primary_release_date.lte': releasedBefore
      }, PRESET_POPULAR_PAGE_COUNT).then(items => items.map(item => markPresetMediaType(item, 'movie'))).catch(() => []));
      if (includeTv) requests.push(fetchPresetTmdbPages('discover/tv', {
        ...baseParams,
        'first_air_date.gte': releasedAfter,
        'first_air_date.lte': releasedBefore
      }, PRESET_POPULAR_PAGE_COUNT).then(items => items.map(item => markPresetMediaType(item, 'tv'))).catch(() => []));

      const popularCandidates = normalizePresetMediaItems((await Promise.all(requests)).flat(), 'mixed')
        .filter(item => {
          const releaseDate = getPresetReleaseDate(item);
          if (!releaseDate) return false;
          const releaseMs = Date.parse(`${String(releaseDate).slice(0, 10)}T00:00:00`);
          return Number.isFinite(releaseMs) && releaseMs <= Date.now();
        })
        .slice(0, 96);

      if (popularCandidates.length && typeof window.enrichItemsWithImdbRatings === 'function') {
        try { await window.enrichItemsWithImdbRatings(popularCandidates, { type: '' }); } catch (_) {}
      }

      popularCandidates.sort((a, b) => {
        const aVotes = Number(a.imdbVotes || 0);
        const bVotes = Number(b.imdbVotes || 0);
        const aHasVotes = aVotes > 0;
        const bHasVotes = bVotes > 0;
        if (aHasVotes !== bHasVotes) return bHasVotes ? 1 : -1;
        if (bVotes !== aVotes) return bVotes - aVotes;

        const aRating = Number(a.imdbRating || 0);
        const bRating = Number(b.imdbRating || 0);
        const aHasRating = aRating > 0;
        const bHasRating = bRating > 0;
        if (aHasRating !== bHasRating) return bHasRating ? 1 : -1;
        if (bRating !== aRating) return bRating - aRating;

        const popDelta = Number(b.popularity || 0) - Number(a.popularity || 0);
        if (popDelta) return popDelta;

        const releaseDelta = Date.parse(`${getPresetReleaseDate(b)}T00:00:00`) - Date.parse(`${getPresetReleaseDate(a)}T00:00:00`);
        if (Number.isFinite(releaseDelta) && releaseDelta) return releaseDelta;

        return String(getPresetTitle(a)).localeCompare(String(getPresetTitle(b)));
      });

      return popularCandidates.slice(0, PRESET_RESULT_LIMIT);
    }

    if (preset === 'decade') {
      const start = Number(config.decadeStart || 0);
      const end = start + 9;
      if (includeMovie) requests.push(fetchPresetTypedTmdb('discover/movie', {
        ...baseParams,
        'primary_release_date.gte': `${start}-01-01`,
        'primary_release_date.lte': `${end}-12-31`
      }, 'movie'));
      if (includeTv) requests.push(fetchPresetTypedTmdb('discover/tv', {
        ...baseParams,
        'first_air_date.gte': `${start}-01-01`,
        'first_air_date.lte': `${end}-12-31`
      }, 'tv'));
      return enrichAndRankPresetItems((await Promise.all(requests)).flat(), 'popular', 'mixed');
    }

    if (preset === 'genre') {
      const genreId = String(config.genreId || '');
      const releasedAfter = getPresetStartOfCurrentYear();
      const releasedBefore = getPresetDate(0);
      if (includeMovie) requests.push(fetchPresetTypedTmdb('discover/movie', {
        ...baseParams,
        with_genres: genreId,
        'vote_count.gte': '20',
        'primary_release_date.gte': releasedAfter,
        'primary_release_date.lte': releasedBefore
      }, 'movie'));
      if (includeTv) requests.push(fetchPresetTypedTmdb('discover/tv', {
        ...baseParams,
        with_genres: genreId,
        'vote_count.gte': '10',
        'first_air_date.gte': releasedAfter,
        'first_air_date.lte': releasedBefore
      }, 'tv'));
      const genreCandidates = normalizePresetMediaItems((await Promise.all(requests)).flat(), config.mediaType || 'mixed')
        .filter(item => {
          const releaseDate = getPresetReleaseDate(item);
          if (!releaseDate) return false;
          const releaseMs = Date.parse(`${String(releaseDate).slice(0, 10)}T00:00:00`);
          return Number.isFinite(releaseMs) && releaseMs <= Date.now();
        })
        .slice(0, 96);

      if (genreCandidates.length && typeof window.enrichItemsWithImdbRatings === 'function') {
        try { await window.enrichItemsWithImdbRatings(genreCandidates, { type: '' }); } catch (_) {}
      }

      const requestedGenre = String(config.title || '').trim();
      genreCandidates.sort((a, b) => {
        const aGenreWeight = getPresetPrimaryGenreWeight(a, requestedGenre);
        const bGenreWeight = getPresetPrimaryGenreWeight(b, requestedGenre);
        if (bGenreWeight !== aGenreWeight) return bGenreWeight - aGenreWeight;

        const aVotes = Number(a.imdbVotes || 0);
        const bVotes = Number(b.imdbVotes || 0);
        const aHasVotes = aVotes > 0;
        const bHasVotes = bVotes > 0;
        if (aHasVotes !== bHasVotes) return bHasVotes ? 1 : -1;
        if (bVotes !== aVotes) return bVotes - aVotes;

        const aRating = Number(a.imdbRating || 0);
        const bRating = Number(b.imdbRating || 0);
        const aHasRating = aRating > 0;
        const bHasRating = bRating > 0;
        if (aHasRating !== bHasRating) return bHasRating ? 1 : -1;
        if (bRating !== aRating) return bRating - aRating;

        const popDelta = Number(b.popularity || 0) - Number(a.popularity || 0);
        if (popDelta) return popDelta;

        return String(getPresetTitle(a)).localeCompare(String(getPresetTitle(b)));
      });

      return genreCandidates.slice(0, PRESET_RESULT_LIMIT);
    }

    if (preset === 'service') {
      if (!config.providerId) return fetchPresetDirect({ preset: 'popular' });
      if (includeMovie) requests.push(fetchPresetTypedTmdb('discover/movie', {
        ...baseParams,
        with_watch_providers: String(config.providerId),
        with_watch_monetization_types: 'flatrate|free|ads|rent|buy'
      }, 'movie'));
      if (includeTv) requests.push(fetchPresetTypedTmdb('discover/tv', {
        ...baseParams,
        with_watch_providers: String(config.providerId),
        with_watch_monetization_types: 'flatrate|free|ads|rent|buy'
      }, 'tv'));
      return enrichAndRankPresetItems((await Promise.all(requests)).flat(), 'popular', 'mixed');
    }

    if (preset === 'upcoming' || preset === 'anticipated') {
      const tomorrow = getPresetDate(1);
      const oneYearOut = getPresetDate(365);
      if (includeMovie) requests.push(fetchPresetTypedTmdb('discover/movie', {
        ...baseParams,
        'primary_release_date.gte': tomorrow,
        'primary_release_date.lte': oneYearOut
      }, 'movie'));
      if (includeTv) requests.push(fetchPresetTypedTmdb('discover/tv', {
        ...baseParams,
        'first_air_date.gte': tomorrow,
        'first_air_date.lte': oneYearOut
      }, 'tv'));
      const futureItems = normalizePresetMediaItems((await Promise.all(requests)).flat(), 'mixed')
        .filter(item => Date.parse(`${getPresetReleaseDate(item)}T00:00:00`) > Date.now());
      return enrichAndRankPresetItems(futureItems, 'anticipated', 'mixed');
    }

    const [movies, tv] = await Promise.all([
      fetchPresetTypedTmdb('discover/movie', baseParams, 'movie'),
      fetchPresetTypedTmdb('discover/tv', baseParams, 'tv')
    ]);
    return enrichAndRankPresetItems([...movies, ...tv], preset === 'rated' ? 'topRated' : 'popular', 'mixed');
  }

  async function loadPresetResults(config = {}, panelId = '') {
    const token = ++presetResultToken;
    const selector = `[data-preset-results="${CSS.escape(String(panelId))}"]`;
    const target = () => document.querySelector(selector);
    try {
      const items = await fetchPresetDirect(config);
      if (token !== presetResultToken) return;
      const root = target();
      if (!root) return;
      if (!items?.length) {
        root.innerHTML = `<div class="shelfd-search-preset-empty-state">No titles found for this preset right now.</div>`;
        return;
      }
      root.innerHTML = renderPresetResultGrid(items);
    } catch (error) {
      console.error('Search preset results failed:', config, error);
      const root = target();
      if (root) root.innerHTML = `<div class="shelfd-search-preset-empty-state">This preset could not load. Try again later.</div>`;
    }
  }

  function renderPresetResultGrid(items = []) {
    return `<div class="shelfd-search-preset-grid">${
      items.map(item => renderPresetResultCard(item)).join('')
    }</div>`;
  }

  function renderPresetResultCard(item = {}) {
    const type = item.media_type === 'movie' ? 'movie' : 'tv';
    const title = getPresetTitle(item);
    const poster = tmdbPoster(item.poster_path, 'w342');
    const year = String(getPresetReleaseDate(item) || '').slice(0, 4);
    const rating = typeof window.formatDisplayTitleRating === 'function'
      ? window.formatDisplayTitleRating(item)
      : (Number(item.imdbRating || 0) > 0 ? Number(item.imdbRating).toFixed(1) : '');
    const meta = [year, type === 'movie' ? 'Movie' : 'TV'].filter(Boolean).join(' · ');
    return `
      <button type="button" class="shelfd-search-preset-title-card" onclick="handleSearchPresetMediaClick(event, '${escAttr(type)}', '${escAttr(item.id)}')" title="${escAttr(title)}">
        <span class="shelfd-search-preset-poster">
          ${poster ? `<img src="${escAttr(poster)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}
          ${rating ? `<span class="shelfd-search-preset-rating"><span aria-hidden="true">★</span>${escHtml(rating)}</span>` : ''}
        </span>
        <span class="shelfd-search-preset-card-title">${escHtml(title)}</span>
        ${meta ? `<span class="shelfd-search-preset-card-meta">${escHtml(meta)}</span>` : ''}
      </button>`;
  }

  window.handleSearchPresetMediaClick = function(event, type, id) {
    if (typeof window.openDiscoverMediaProfile === 'function') {
      try { window.openDiscoverMediaProfile(event, type, id, event?.currentTarget || null); }
      catch (e) { console.error('Open preset media profile failed:', e); }
    }
  };

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
       r.rating only reflects OMDb/IMDb. Games keep RAWG's own rating. */
    if (typeof window.enrichItemsWithImdbRatings === 'function' && tmdbItems.length) {
      try { await window.enrichItemsWithImdbRatings(tmdbItems); } catch (e) { /* fail soft: leave rating blank */ }
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
    rows = rows
      .map(row => {
        const textScore = relevanceScore(row.title);
        return { ...row, _searchTextScore: textScore, _searchRankScore: textScore + popularityBoost(row.popularity) };
      })
      .filter(row => row._searchTextScore > 0);

    rows.sort((a, b) => {
      const as = Number(a._searchRankScore || 0);
      const bs = Number(b._searchRankScore || 0);
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
      ? `handleSearchPageGameClick(event, '${escAttr(r.key)}')`
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
  function buildSearchGameProfileSeed(row = {}) {
    const item = row.raw || {};
    const poster = row.poster || gamePoster(item);
    const rawgId = String(row.rawgId || item.rawgId || item.rawg_id || (item.source === 'rawg' ? item.id : '') || '').trim();
    return {
      id: rawgId || String(item.id || row.id || ''),
      rawgId,
      rawgSlug: item.slug || '',
      backloggdSlug: item.slug || '',
      metacriticSlug: item.slug || '',
      title: row.title || item.name || '',
      name: row.title || item.name || '',
      released: item.released || '',
      background_image: poster,
      cover: poster,
      poster,
      image: poster,
      igdbId: item.igdbId || '',
      igdbSlug: item.igdbSlug || '',
      igdbCoverUrl: item.igdbCover || item.igdbCoverUrl || '',
      genres: item.genres || [],
      platforms: item.platforms || [],
      metacritic: item.metacritic || '',
      rating: item.rating || '',
      ratings_count: item.ratings_count || item.reviews_count || 0,
      source: item.source || ''
    };
  }

  window.handleSearchPageGameClick = function(event, keyOrId) {
    pushRecent(activeQuery);
    if (typeof window.openGameMediaProfile === 'function') {
      try {
        const row = lastResultRows.find(result => result.key === keyOrId || String(result.id) === String(keyOrId)) || {};
        const seed = buildSearchGameProfileSeed(row);
        const rawgId = seed.rawgId || '';
        if (rawgId && typeof window.setGameMediaProfileSeed === 'function') {
          window.setGameMediaProfileSeed(rawgId, seed);
        }
        window.openGameMediaProfile(event, rawgId, seed);
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
    if (presetPanelStack.length) {
      closePresetPanel();
      return;
    }
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
    ensureSearchPresetHub();
    const input = $('shelfd-search-input');
    const clearBtn = $('shelfd-search-clear-btn');
    const inputWrap = document.querySelector('.shelfd-search-input-wrap');
    const recentList = $('shelfd-search-recent-list');
    const recentClear = $('shelfd-search-clear-recents');
    const chipsRow = document.querySelector('.shelfd-search-chips');
    const browseGrid = document.querySelector('.shelfd-search-browse-grid');
    const presetSection = $('shelfd-search-preset-section');
    if (!input) return;
    pageInitialized = true;
    bindSearchMediaTabs();
    setActiveSearchMediaTab(activeSearchMediaTab);

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

    if (presetSection) {
      presetSection.addEventListener('click', handlePresetPanelClick);
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

  function patchCloseSearchPage() {
    const original = window.closeSearchPage;
    if (typeof original !== 'function' || original.__shelfdSearchPresetPatched) return;
    const wrapped = function() {
      hidePremiumPresetNotice();
      closeAllPresetPanels({ immediate: true });
      setActiveSearchMediaTab('movietv');
      original.apply(this, arguments);
    };
    wrapped.__shelfdSearchPresetPatched = true;
    window.closeSearchPage = wrapped;
  }

  /* Init on DOM ready, then patch openSearchPage once it exists. */
  function start() {
    initSearchPage();
    patchOpenSearchPage();
    patchCloseSearchPage();
    /* If the patch happens before openSearchPage is defined, retry until it is. */
    let tries = 0;
    const tick = () => {
      if (typeof window.openSearchPage === 'function' && !window.openSearchPage.__shelfdSearchPatched) {
        patchOpenSearchPage();
      }
      if (typeof window.closeSearchPage === 'function' && !window.closeSearchPage.__shelfdSearchPresetPatched) {
        patchCloseSearchPage();
      }
      if (++tries < 40 && ((!window.openSearchPage || !window.openSearchPage.__shelfdSearchPatched) || (!window.closeSearchPage || !window.closeSearchPage.__shelfdSearchPresetPatched))) {
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
