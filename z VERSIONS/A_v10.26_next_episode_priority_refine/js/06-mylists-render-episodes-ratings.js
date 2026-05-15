window.__SHELFD_MYLIST_PATCH_VERSION = 'v399-game-status-scroll-toggle-gray';
window.__SHELFD_MYLIST_SWIPE_REMOVED = true;
window.__SHELFD_MYLIST_RENDER_RECOVERY = true;
window.__SHELFD_MYLIST_CONTROLS_STAR_CACHE_BUSTER = true;
let activeGamePlayingFilter = 'live';

function normalizeMyListPosterUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('//')) return `https:${raw}`;
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
  const statuses = [activeTab, 'watching', 'planned', 'watched', 'paused', 'wishlist', 'live', 'competitive', 'dropped']
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

function isGamesPlayingMergedView(section = activeSection, tab = activeTab) {
  return section === 'games' && tab === 'watching';
}

function normalizeGamePlayingFilter(value = '') {
  if (value === 'watching') return 'watching';
  if (value === 'competitive') return 'competitive';
  return 'live';
}

function isCompetitiveGameItem(item = {}) {
  const trackerUrl = normalizeScreenListGameTrackerUrl(
    item.gameTrackerUrl ||
    item.gameStatsUrl ||
    item.trackerStatsUrl ||
    item.trackerUrl ||
    item.statsUrl ||
    ''
  );
  return item.status === 'competitive' || (item.status === 'live' && !!trackerUrl);
}

function getGamePlayingVisibleStatuses() {
  if (!isGamesPlayingMergedView()) return [activeTab];
  const activeFilter = normalizeGamePlayingFilter(activeGamePlayingFilter);
  if (String(searchQuery || '').trim()) {
    return activeFilter === 'competitive'
      ? ['competitive', 'live']
      : activeFilter === 'watching'
        ? ['watching']
        : ['watching', 'live', 'competitive'];
  }
  return activeFilter === 'competitive' ? ['competitive', 'live'] : [activeFilter];
}

function itemMatchesActiveListStatus(item = {}) {
  if (isGamesPlayingMergedView()) {
    if (!getGamePlayingVisibleStatuses().includes(item.status)) return false;
    return normalizeGamePlayingFilter(activeGamePlayingFilter) === 'competitive'
      ? isCompetitiveGameItem(item)
      : normalizeGamePlayingFilter(activeGamePlayingFilter) === 'live'
        ? !isCompetitiveGameItem(item)
        : true;
  }
  return item.status === activeTab;
}

function switchGamePlayingFilter(filter = 'live') {
  activeGamePlayingFilter = normalizeGamePlayingFilter(filter);
  closeSortDropdown();
  render();
}

function renderGamePlayingSubfilter(items = []) {
  const toolbar = document.getElementById('mylist-toolbar');
  const stage = document.getElementById('mylist-stage');
  if (!toolbar && !stage) return;
  let wrap = document.getElementById('games-playing-subfilter');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'games-playing-subfilter';
    wrap.className = 'games-playing-subfilter';
    if (stage) {
      // v429: subfilter lives inside the pager stage so its appearance/disappearance
      // becomes part of the horizontal slide instead of shifting layout above the
      // stage and visually expanding the toolbar/Add-to-Shelf row.
      stage.insertBefore(wrap, stage.firstChild);
    } else {
      toolbar.insertAdjacentElement('afterend', wrap);
    }
  } else if (stage && wrap.parentElement !== stage) {
    // Migrate any existing subfilter (created before v429) into the stage.
    stage.insertBefore(wrap, stage.firstChild);
  }

  const visible = isGamesPlayingMergedView();
  wrap.style.display = visible ? '' : 'none';
  if (!visible) return;

  activeGamePlayingFilter = normalizeGamePlayingFilter(activeGamePlayingFilter);
  const singleCount = items.filter(i => i.status === 'watching').length;
  const competitiveCount = items.filter(isCompetitiveGameItem).length;
  const liveCount = items.filter(i => i.status === 'live' && !isCompetitiveGameItem(i)).length;
  const searchActive = !!String(searchQuery || '').trim();
  wrap.classList.toggle('search-active', searchActive);
  wrap.innerHTML = `
    <div class="games-playing-subfilter-card" role="group" aria-label="Playing game type">
      <button class="games-playing-toggle${activeGamePlayingFilter === 'watching' ? ' active' : ''}" type="button" onclick="switchGamePlayingFilter('watching')">
        <span>Single Player</span><small aria-hidden="${activeGamePlayingFilter === 'watching' ? 'false' : 'true'}">${singleCount}</small>
      </button>
      <button class="games-playing-toggle${activeGamePlayingFilter === 'live' ? ' active' : ''}" type="button" onclick="switchGamePlayingFilter('live')">
        <span>Live Games</span><small aria-hidden="${activeGamePlayingFilter === 'live' ? 'false' : 'true'}">${liveCount}</small>
      </button>
      <button class="games-playing-toggle${activeGamePlayingFilter === 'competitive' ? ' active' : ''}" type="button" onclick="switchGamePlayingFilter('competitive')">
        <span>Competitive</span><small aria-hidden="${activeGamePlayingFilter === 'competitive' ? 'false' : 'true'}">${competitiveCount}</small>
      </button>
    </div>
  `;
}

function ensureGameWishlistStatusTab() {
  if (document.getElementById('count-wishlist')) return;
  const tabs = document.querySelector('#mylist-toolbar .tabs');
  if (!tabs) return;
  const button = document.createElement('button');
  button.className = 'tab-btn';
  button.dataset.tab = 'wishlist';
  button.type = 'button';
  button.style.display = 'none';
  button.onclick = () => switchTab('wishlist');
  button.innerHTML = 'Wishlist<span class="tab-count" id="count-wishlist">0</span>';
  const watchedBtn = tabs.querySelector('.tab-btn[data-tab="watched"]');
  if (watchedBtn && watchedBtn.nextSibling) tabs.insertBefore(button, watchedBtn.nextSibling);
  else tabs.appendChild(button);
}
// Load from Firestore
async function load() {
  if (!DOC_REF) return;
  try {
    data = await loadWatchlistDataFromDocRef(DOC_REF);
    if (listDataItemCount(data) === 0) {
      const backup = readOwnLocalBackup(data);
      if (backup) data = await writeOwnDataDirect(backup);
    }
    data = await autoSortAnimeBuckets(data, true);
    ownDataCache = cloneListData(data);
    activeSection = "shows";
    activeTab = "watching";
  } catch(e) {
    console.error("Load failed:", e);
    // Fallback to localStorage
    try {
      const backup = readOwnLocalBackup();
      if (backup) data = backup;
      activeSection = "shows";
      activeTab = "watching";
      ownDataCache = cloneListData(data);
    } catch(e2) {}
  }
}

// Save to Firestore (debounced)
function save() {
  if (!DOC_REF || viewingUser) return;
  const safeData = compactImportedAnimeForStorage(data);
  data = cloneListData(safeData);
  ownDataCache = cloneListData(safeData);
  // Save to localStorage as backup.
  // v843: iOS PWA has a ~5MB localStorage limit. Once exceeded — which
  // happens easily with a fully imported library — `setItem` throws
  // `QuotaExceededError`. Previously this propagated up out of `save()`
  // and aborted callers mid-flow (most visibly: the card-comment composer
  // never ran `closeCardCommentComposer()` so the modal stayed stuck on
  // screen, and the debounced Firestore write below never even queued).
  // Firestore is the source of truth — localStorage is only a fast-restore
  // cache — so a localStorage failure must NEVER block the Firestore write.
  try {
    localStorage.setItem("watchlist-tracker-data", JSON.stringify(safeData));
    if (currentUser) localStorage.setItem("screenlist-own-data-backup-" + currentUser.uid, JSON.stringify(safeData));
  } catch (lsErr) {
    console.warn('[v843] localStorage backup write failed (probably QuotaExceededError):', lsErr && lsErr.name, lsErr && lsErr.message);
  }
  // Debounce Firestore writes
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    saveTimeout = null;
    try {
      await persistOwnDataToFirestore(safeData);
      if (currentUser?.uid === CREATOR_PUBLIC_UID) {
        await syncCreatorPublicProfileMirror(currentUser, userProfile, safeData);
      }
    } catch(e) {
      console.error("Save failed:", e);
      const message = typeof formatOwnDataSaveError === 'function'
        ? formatOwnDataSaveError(e, safeData)
        : 'Save failed. Your library may be too large or offline. Try again.';
      showToast(message);
    }
  }, 500);
}

// Render
function render() {
  ensureGameWishlistStatusTab();
  ensureActiveSectionVisible();
  renderMyListEditControls();
  const visibleData = getVisibleListData();
  const items = Array.isArray(visibleData[activeSection]) ? visibleData[activeSection] : [];
  activeTab = normalizeVisibleMyListStatusTab(activeTab, activeSection);
  const stateKey = getSortStateKey();
  const activeSortKey = getActiveSortKey();
  const baseFiltered = items
    .filter(itemMatchesActiveListStatus)
    .filter(i => !searchQuery || (i.title || '').toLowerCase().includes(searchQuery.toLowerCase()));
  const filtered = applySortOrder(baseFiltered, activeSortKey, stateKey);

  const isPreview = document.body.classList.contains('preview-mode');
  const previewCap = 2;
  const previewCount = getPreviewItemCount();


  document.getElementById("shows-count").textContent = visibleData.shows.length;
  document.getElementById("anime-count").textContent = visibleData.anime.length;
  document.getElementById("movies-count").textContent = visibleData.movies.length;
  document.getElementById("games-count").textContent = visibleData.games.length;
  const mangaCountEl = document.getElementById("manga-count");
  const booksCountEl = document.getElementById("books-count");
  if (mangaCountEl) mangaCountEl.textContent = (visibleData.manga || []).length;
  if (booksCountEl) booksCountEl.textContent = (visibleData.books || []).length;
  ['shows-count','anime-count','movies-count','games-count','manga-count','books-count'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // Tab counts
  const gamesPlayingCount = items.filter(i => i.status === "watching").length;
  const gamesLiveCount = items.filter(i => i.status === "live" && !isCompetitiveGameItem(i)).length;
  const gamesCompetitiveCount = items.filter(isCompetitiveGameItem).length;
  document.getElementById("count-live").textContent = gamesLiveCount;
  document.getElementById("count-watching").textContent = activeSection === 'games'
    ? gamesPlayingCount + gamesLiveCount + gamesCompetitiveCount
    : gamesPlayingCount;
  document.getElementById("count-planned").textContent = items.filter(i => i.status === "planned").length;
  document.getElementById("count-watched").textContent = items.filter(i => i.status === "watched").length;
  const wishlistCountEl = document.getElementById("count-wishlist");
  if (wishlistCountEl) wishlistCountEl.textContent = items.filter(i => i.status === "wishlist").length;
  document.getElementById("count-paused").textContent = items.filter(i => i.status === "paused").length;
  const droppedCountEl = document.getElementById("count-dropped");
  if (droppedCountEl) droppedCountEl.textContent = items.filter(i => i.status === "dropped").length;

  // Add button label
  document.getElementById("add-btn").textContent = '+ Add to Shelf';
  renderGamePlayingSubfilter(items);

  // Section buttons
  document.querySelectorAll(".section-btn").forEach(b => {
    const section = b.dataset.section;
    const visible = isSectionVisibleInMyLists(section);
    b.hidden = !visible;
    b.setAttribute('aria-hidden', visible ? 'false' : 'true');
    b.classList.toggle('screenlist-hidden-list-tab', !visible);
    b.style.display = visible ? "" : "none";
    b.classList.toggle("active", visible && section === activeSection);
  });
  // Tab buttons
  document.querySelectorAll(".tab-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === activeTab);
    if (b.dataset.tab === "dropped") {
      b.style.display = "none";
    }

    if (b.dataset.tab === "live") {
      b.style.display = "none";
      b.classList.remove("active");
    }
    if (b.dataset.tab === "paused") {
      b.style.display = activeSection === "games" ? "none" : "";
    }
    if (b.dataset.tab === "wishlist") {
      b.style.display = activeSection === "games" ? "" : "none";
      b.childNodes[0].textContent = "Wishlist";
    }
    if (b.dataset.tab === "watching") {
      b.style.display = activeSection === "movies" ? "none" : "";
      b.childNodes[0].textContent = activeSection === "games" ? "Playing" : isReadingSection(activeSection) ? "Reading" : "Watching";
    }
    if (b.dataset.tab === "planned") {
      b.childNodes[0].textContent = activeSection === "games" ? "Backloggd" : isReadingSection(activeSection) ? "TBR" : "Watchlist";
    }
    if (b.dataset.tab === "watched") {
      b.childNodes[0].textContent = activeSection === "games" ? "Played" : isReadingSection(activeSection) ? "Read" : "Watched";
    }
  });
  requestAnimationFrame(() => updateSlidingPills());
  if (typeof initMyListInteractionFallbacks === 'function') initMyListInteractionFallbacks();
  if (typeof removeMyListSwipeArtifacts === 'function') removeMyListSwipeArtifacts();
  // Lazy-backfill IGDB portrait covers for existing games that only have the RAWG landscape image
  if (activeSection === 'games') setTimeout(backfillIgdbGameCovers, 800);
  const grid = document.getElementById("cards-grid");
  const empty = document.getElementById("empty-state");
  const emptySub = empty.querySelector(".empty-sub");
  const emptyCta = document.getElementById("empty-cta");

  // Inject / update sort button
  let sortBtn = document.getElementById('sort-dropdown-btn');
  if (!sortBtn) {
    sortBtn = document.createElement('button');
    sortBtn.id = 'sort-dropdown-btn';
    sortBtn.className = 'btn-secondary sort-btn';
    sortBtn.onclick = toggleSortDropdown;
    const toolbarRight = document.querySelector('.toolbar-right');
    if (toolbarRight) toolbarRight.insertBefore(sortBtn, toolbarRight.firstChild);
  }
  const isDefaultSort = activeSortKey === getDefaultSortKeyFor();
  const sortOptions = typeof getSortOptionsForSection === 'function' ? getSortOptionsForSection(activeSection) : SORT_OPTIONS;
  const sortLabel = sortOptions.find(o => o.key === activeSortKey)?.label || 'Sort';
  sortBtn.title = sortLabel;
  sortBtn.innerHTML = `<span class="sort-btn-icon${isDefaultSort ? '' : ' sort-active'}">⇅</span><span class="sort-btn-label">${isDefaultSort ? '' : sortLabel}</span>`;

  if (filtered.length === 0) {
    grid.innerHTML = "";
    renderMyListLoadMoreControl(0, 0);
    empty.style.display = "block";
    const emptyIcon = document.getElementById("empty-icon");
    if (emptyIcon) {
      emptyIcon.textContent = '';
      emptyIcon.style.display = 'none';
    }
    const statusLabel = activeTab === "planned" ? "planned" : activeTab;
    const sectionLabel = getSectionLabel(activeSection);
    const emptyText = isGamesPlayingMergedView()
      ? (searchQuery
          ? 'No matching games yet'
          : activeGamePlayingFilter === 'competitive'
            ? 'No competitive games yet'
          : activeGamePlayingFilter === 'watching'
            ? 'No single-player games yet'
            : 'No live games yet')
      : activeSection === 'games' && activeTab === 'planned'
        ? 'No backlog games yet'
        : activeSection === 'games' && activeTab === 'watched'
          ? 'No played games yet'
          : activeSection === 'games' && activeTab === 'wishlist'
            ? 'No wishlist games yet'
            : `No ${statusLabel} ${sectionLabel} yet`;
    document.getElementById("empty-text").textContent = emptyText;
    if (emptySub) {
      emptySub.textContent = searchQuery
        ? "No matches for your search. Try a shorter title or clear the search field."
        : viewingUser
          ? "This list is quiet in this section right now."
          : "Start building this shelf with something you want to track.";
    }
    if (emptyCta) {
      emptyCta.style.display = (!viewingUser && !searchQuery) ? "" : "none";
      emptyCta.textContent = `Add your first ${getSectionLabel(activeSection, true)}`;
    }
    return;
  }

  empty.style.display = "none";
  const hiddenEmptyIcon = document.getElementById("empty-icon");
  if (hiddenEmptyIcon) hiddenEmptyIcon.style.display = "none";
  const renderLimitKey = getMyListRenderLimitKey(activeSortKey);
  const visibleLimit = getMyListVisibleLimit(renderLimitKey, filtered.length);
  const visibleFiltered = filtered.slice(0, visibleLimit);

  if (activeSortKey === 'custom') {
    grid.innerHTML = visibleFiltered.map(item => renderCard(item, true)).join("");
  } else {
    grid.innerHTML = visibleFiltered.map(item => renderCard(item)).join("");
  }
  if (typeof rememberRenderedSortOrder === 'function') rememberRenderedSortOrder(stateKey, filtered);
  renderMyListLoadMoreControl(visibleFiltered.length, filtered.length, renderLimitKey);

  refreshVisibleCommentCounts();

  // Restore open episode lists and seasons
  Object.keys(openStates).forEach(key => {
    if (!openStates[key]) return;
    if (key.startsWith('ep-')) {
      const id = key.slice(3);
      const list = document.getElementById('ep-list-' + id);
      const arrow = document.getElementById('ep-arrow-' + id);
      const label = document.getElementById('ep-label-' + id);
      if (list) { setEpisodesExpanded(list, true, true); }
      if (arrow) { arrow.classList.add('open'); }
      if (label) { label.textContent = 'Hide Episodes'; }
    } else if (key.startsWith('s-')) {
      const el = document.getElementById('s-eps-' + key.slice(2));
      const arrow = document.getElementById('s-arrow-' + key.slice(2));
      if (el) { el.style.display = 'block'; }
      if (arrow) { arrow.classList.add('open'); }
    }
  });
  scheduleMyListPosterPreload('mylist-render');
}

function renderStars(rating, itemId, prefix, size) {
  size = size || 14;
  const section = activeSection;
  return buildRatingStarsMarkup(rating, itemId, prefix, size, section, !viewingUser);
}


const SCREENLIST_GAME_PLATFORM_OPTIONS = [
  'PC',
  'Steam',
  'Steam Deck',
  'PS5',
  'PS4',
  'Xbox Series X|S',
  'Xbox One',
  'Nintendo Switch',
  'Mobile',
  'Other'
];
const SCREENLIST_STEAM_LIBRARY_STATS_URL = 'https://steamcommunity.com/my/games/?tab=all';
let screenlistGameDetailsOpenState = {};
let screenlistGameDetailsEditState = {};
let screenlistGameDetailsDraftState = {};
let screenlistGameDetailsPlatformMenuState = {};

function syncScreenListGameDetailGlobals() {
  if (typeof window === 'undefined') return;
  window.screenlistGameDetailsOpenState = screenlistGameDetailsOpenState;
  window.screenlistGameDetailsEditState = screenlistGameDetailsEditState;
  window.screenlistGameDetailsDraftState = screenlistGameDetailsDraftState;
  window.screenlistGameDetailsPlatformMenuState = screenlistGameDetailsPlatformMenuState;
  if (!('__lastGameDetailsSaveDebug' in window)) window.__lastGameDetailsSaveDebug = null;
}
syncScreenListGameDetailGlobals();

function clampScreenListGameHoursText(value = '') {
  let clean = String(value ?? '').replace(/[^0-9.]/g, '');
  const dotIndex = clean.indexOf('.');
  if (dotIndex !== -1) {
    clean = clean.slice(0, dotIndex + 1) + clean.slice(dotIndex + 1).replace(/\./g, '');
  }
  if (clean.startsWith('.')) clean = '0' + clean;
  return clean.slice(0, 5);
}

function normalizeScreenListGameHours(value) {
  const raw = clampScreenListGameHoursText(value).trim();
  if (!raw) return '';
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n === 0) return '0';
  return String(Math.round(n * 10) / 10);
}

function normalizeScreenListGameTrackerUrl(value = '') {
  const clean = String(value || '').trim();
  if (!clean) return '';
  if (/^(https?:|mailto:)/i.test(clean)) return clean;
  return `https://${clean}`;
}

function normalizeScreenListGamePlatform(value = '') {
  const clean = String(value || '').trim();
  return SCREENLIST_GAME_PLATFORM_OPTIONS.includes(clean) ? clean : '';
}

function getScreenListGameTrackerIconSvg() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 18.5h16"/><path d="M7 16V9"/><path d="M12 16V5.5"/><path d="M17 16v-3.5"/></svg>`;
}

function getScreenListSteamIconSvg() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4.5 14.2 8.1 15.7"/><path d="M8.1 15.7a2.8 2.8 0 1 0 2.2-2.3"/><path d="M14.4 8.9a3.3 3.3 0 1 0 3.3-3.3 3.3 3.3 0 0 0-3.3 3.3Z"/><path d="M10.4 13.5 15.2 10"/><path d="M3 10.8a9 9 0 1 0 2.2-5.9"/></svg>`;
}

function getScreenListGamePencilSvg() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4.5 19.5l4.2-.9L18.8 8.5 15.5 5.2 5.4 15.3l-.9 4.2Z"/><path d="M14.4 6.3l3.3 3.3"/></svg>`;
}

function getScreenListGameDetailValuesFromItem(item = {}) {
  return {
    platform: normalizeScreenListGamePlatform(
      item.gamePlatform ||
      item.gamePlayedPlatform ||
      item.playedPlatform ||
      item.platformPlayed ||
      item.userPlatform ||
      ''
    ),
    hours: normalizeScreenListGameHours(
      item.gameHoursPlayed ??
      item.gameHours ??
      item.hoursPlayed ??
      item.playtimeHours ??
      item.currentHours ??
      ''
    ),
    tracker: normalizeScreenListGameTrackerUrl(
      item.gameTrackerUrl ||
      item.gameStatsUrl ||
      item.trackerStatsUrl ||
      item.trackerUrl ||
      item.statsUrl ||
      ''
    )
  };
}

function getScreenListGameStableKey(item = {}) {
  return String(
    item?.id ||
    item?.rawgId ||
    item?.metacriticSlug ||
    item?.rawgSlug ||
    item?.backloggdSlug ||
    item?.title ||
    ''
  ).trim();
}

function getScreenListGameById(id = '') {
  const key = String(id || '').trim();
  if (!key || !Array.isArray(data?.games)) return { item: null, index: -1 };
  const index = data.games.findIndex(entry =>
    String(entry?.id || '') === key ||
    getScreenListGameStableKey(entry) === key
  );
  return { item: index >= 0 ? data.games[index] : null, index };
}

function getGameDetailsDraftValues(id = '', item = {}) {
  const key = String(id || '').trim();
  const fallback = getScreenListGameDetailValuesFromItem(item || {});
  const draft = key ? screenlistGameDetailsDraftState[key] : null;
  return {
    platform: normalizeScreenListGamePlatform(draft?.platform ?? fallback.platform),
    hours: normalizeScreenListGameHours(draft?.hours ?? fallback.hours),
    tracker: normalizeScreenListGameTrackerUrl(draft?.tracker ?? fallback.tracker)
  };
}

function getGameDetailsPanelById(id = '') {
  const key = String(id || '').trim();
  if (!key) return null;
  return document.getElementById(`game-details-${key}`) ||
    document.querySelector(`.game-details-panel[data-game-details-id="${CSS.escape(key)}"]`);
}

function getGameDetailsDraftBase(id = '') {
  const key = String(id || '').trim();
  const { item } = getScreenListGameById(key);
  return getGameDetailsDraftValues(key, item || {});
}

function setGameDetailsDraft(id = '', field = '', value = '') {
  const key = String(id || '').trim();
  const cleanField = String(field || '').trim();
  if (!key || !cleanField) return null;
  const base = screenlistGameDetailsDraftState[key] || getGameDetailsDraftBase(key);
  const next = { ...base };
  if (cleanField === 'platform') next.platform = normalizeScreenListGamePlatform(value);
  if (cleanField === 'hours') next.hours = normalizeScreenListGameHours(value);
  if (cleanField === 'tracker') next.tracker = normalizeScreenListGameTrackerUrl(value);
  screenlistGameDetailsDraftState[key] = next;
  syncScreenListGameDetailGlobals();
  return next;
}

function handleGameDetailsHoursInput(id = '', inputEl = null) {
  if (!inputEl) return;
  const clean = clampScreenListGameHoursText(inputEl.value);
  if (inputEl.value !== clean) inputEl.value = clean;
  setGameDetailsDraft(id || inputEl.dataset?.gameDetailsId, 'hours', clean);
}

function toggleGameDetailsPlatformMenu(id = '', event = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const key = String(id || event?.currentTarget?.dataset?.gameDetailsId || event?.target?.closest?.('[data-game-details-id]')?.dataset?.gameDetailsId || '').trim();
  if (!key) return;
  const next = !screenlistGameDetailsPlatformMenuState[key];
  screenlistGameDetailsPlatformMenuState = {};
  screenlistGameDetailsPlatformMenuState[key] = next;
  syncScreenListGameDetailGlobals();
  document.querySelectorAll('.game-platform-options.open').forEach(el => {
    const optionKey = String(el.dataset.gameDetailsId || '').trim();
    if (optionKey !== key) el.classList.remove('open');
  });
  const menu = document.getElementById(`game-platform-options-${key}`);
  const trigger = document.getElementById(`game-platform-trigger-${key}`);
  if (menu) menu.classList.toggle('open', next);
  if (trigger) trigger.setAttribute('aria-expanded', next ? 'true' : 'false');
}

function selectGameDetailsPlatform(id = '', value = '', event = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const optionEl = event?.target?.closest?.('[data-game-platform-option]');
  const key = String(id || optionEl?.dataset?.gameDetailsId || '').trim();
  if (!key) return;
  const clean = normalizeScreenListGamePlatform(value || optionEl?.dataset?.value || '');
  setGameDetailsDraft(key, 'platform', clean);
  screenlistGameDetailsPlatformMenuState[key] = false;
  syncScreenListGameDetailGlobals();
  const box = document.getElementById(`game-platform-select-${key}`);
  const hidden = document.getElementById(`game-platform-value-${key}`);
  const label = document.getElementById(`game-platform-label-${key}`);
  const menu = document.getElementById(`game-platform-options-${key}`);
  const trigger = document.getElementById(`game-platform-trigger-${key}`);
  if (box) box.dataset.value = clean;
  if (hidden) hidden.value = clean;
  if (label) {
    label.textContent = clean || 'Select platform';
    label.classList.toggle('placeholder', !clean);
  }
  if (menu) {
    menu.classList.remove('open');
    menu.querySelectorAll('.game-platform-option').forEach(btn => {
      btn.classList.toggle('selected', String(btn.dataset.value || '') === clean);
    });
  }
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

function getGameDetailsSelectorById(id = '', field = '') {
  const key = String(id || '').trim();
  const cleanField = String(field || '').trim();
  if (!key || !cleanField) return null;
  if (cleanField === 'platform') {
    return document.getElementById(`game-platform-value-${key}`) ||
      document.getElementById(`game-platform-select-${key}`);
  }
  const direct = document.getElementById(`game-${cleanField === 'tracker' ? 'tracker' : cleanField}-${key}`);
  if (direct) return direct;
  const matches = Array.from(document.querySelectorAll(`[data-game-detail-field="${cleanField}"]`));
  return matches.find(el =>
    String(el?.dataset?.gameDetailsId || el?.closest?.('.game-details-panel')?.dataset?.gameDetailsId || '').trim() === key
  ) || null;
}

function collectGameDetailsInputValues(id = '', panel = null) {
  const key = String(id || panel?.dataset?.gameDetailsId || '').trim();
  const root = panel || getGameDetailsPanelById(key);
  const { item } = getScreenListGameById(key);
  const draft = getGameDetailsDraftValues(key, item || {});
  const hiddenPlatform = document.getElementById(`game-platform-value-${key}`);
  const platformBox = root?.querySelector?.('[data-game-detail-field="platform"]') || getGameDetailsSelectorById(key, 'platform');
  const hoursEl = root?.querySelector?.('[data-game-detail-field="hours"]') || getGameDetailsSelectorById(key, 'hours');
  const trackerEl = root?.querySelector?.('[data-game-detail-field="tracker"]') || getGameDetailsSelectorById(key, 'tracker');
  const rawPlatform = hiddenPlatform?.value || platformBox?.dataset?.value || platformBox?.value || draft.platform;
  const rawHours = (hoursEl && 'value' in hoursEl) ? hoursEl.value : draft.hours;
  const rawTracker = (trackerEl && 'value' in trackerEl) ? trackerEl.value : draft.tracker;
  const values = {
    platform: normalizeScreenListGamePlatform(rawPlatform),
    hours: normalizeScreenListGameHours(rawHours),
    tracker: normalizeScreenListGameTrackerUrl(rawTracker)
  };
  screenlistGameDetailsDraftState[key] = values;
  syncScreenListGameDetailGlobals();
  return values;
}

function initScreenListGameDetailsDelegatedHandlers() {
  if (typeof document === 'undefined' || window.__screenListGameDetailsDelegatedV277) return;
  window.__screenListGameDetailsDelegatedV277 = true;

  document.addEventListener('click', event => {
    const platformOption = event.target?.closest?.('[data-game-platform-option]');
    if (platformOption) {
      selectGameDetailsPlatform(platformOption.dataset.gameDetailsId || '', platformOption.dataset.value || '', event);
      return;
    }

    const platformTrigger = event.target?.closest?.('[data-game-platform-trigger]');
    if (platformTrigger) {
      toggleGameDetailsPlatformMenu(platformTrigger.dataset.gameDetailsId || '', event);
      return;
    }

    const saveBtn = event.target?.closest?.('[data-game-details-save]');
    if (saveBtn) {
      event.preventDefault();
      event.stopPropagation();
      saveGameDetailsEdit(saveBtn.dataset.gameDetailsId || '', saveBtn, event);
      return;
    }
  }, true);

  const syncField = event => {
    const fieldEl = event.target?.closest?.('[data-game-detail-field]');
    if (!fieldEl) return;
    const id = String(fieldEl.dataset.gameDetailsId || fieldEl.closest?.('.game-details-panel')?.dataset?.gameDetailsId || '').trim();
    const field = String(fieldEl.dataset.gameDetailField || '').trim();
    if (!id || !field) return;
    if (field === 'hours') handleGameDetailsHoursInput(id, fieldEl);
    if (field === 'tracker') setGameDetailsDraft(id, 'tracker', fieldEl.value);
  };

  document.addEventListener('input', syncField, true);
  document.addEventListener('change', syncField, true);
  document.addEventListener('blur', syncField, true);
}
initScreenListGameDetailsDelegatedHandlers();

async function persistOwnListDataImmediate(nextData = null) {
  const safeData = cloneListData(nextData || data);
  data = cloneListData(safeData);
  ownDataCache = cloneListData(safeData);
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  if (currentUser) localStorage.setItem('screenlist-own-data-backup-' + currentUser.uid, JSON.stringify(safeData));
  localStorage.setItem('watchlist-tracker-data', JSON.stringify(safeData));
  if (typeof writeOwnDataDirect === 'function') {
    await writeOwnDataDirect(safeData);
  } else if (DOC_REF) {
    await persistOwnDataToFirestore(safeData);
  } else {
    save();
  }
  return safeData;
}

function renderGameDetailsExpandButton(item = {}) {
  const id = String(item.id || '') || getScreenListGameStableKey(item);
  const isOpen = !!screenlistGameDetailsOpenState[id] || !!screenlistGameDetailsEditState[id];
  return `<button id="game-details-toggle-${escAttr(id)}" class="game-details-expand-btn${isOpen ? ' open' : ''}" type="button" onclick="event.stopPropagation();toggleGameDetailsPanel('${escAttr(id)}')" aria-expanded="${isOpen ? 'true' : 'false'}">
    <span>${isOpen ? 'Hide Info' : 'More Info'}</span>
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M5 7.5 10 12l5-4.5"/></svg>
  </button>`;
}

function renderGamePlatformOptionButtons(id = '', selected = '') {
  return SCREENLIST_GAME_PLATFORM_OPTIONS.map(option => `
    <button class="game-platform-option${option === selected ? ' selected' : ''}" type="button" data-game-platform-option="true" data-game-details-id="${escAttr(id)}" data-value="${escAttr(option)}">${escHtml(option)}</button>
  `).join('');
}

function renderGameDetailsPanel(item = {}) {
  // Use stable key so games loaded before the id-backfill fix also work
  const id = String(item.id || '') || getScreenListGameStableKey(item);
  const isOpen = !!screenlistGameDetailsOpenState[id] || !!screenlistGameDetailsEditState[id];
  const isEditing = !!screenlistGameDetailsEditState[id] && !viewingUser;
  const saved = getScreenListGameDetailValuesFromItem(item);
  const draft = getGameDetailsDraftValues(id, item);
  const values = isEditing ? draft : saved;
  const platform = values.platform;
  const hours = values.hours;
  const trackerUrl = values.tracker;
  const platformText = platform || 'Platform not added';
  const hoursText = hours !== '' ? `${hours}h played` : 'Hours not added';
  const trackerDisplay = trackerUrl
    ? `<a class="game-details-tracker-link game-details-tracker-icon-only" href="${escAttr(trackerUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" aria-label="Open Tracker/Stats">${getScreenListGameTrackerIconSvg()}</a>`
    : `<span class="game-details-muted">—</span>`;

  const readHtml = `
    <div class="game-details-read-row">
      <span class="game-details-label">Platform</span>
      <strong>${escHtml(platformText)}</strong>
    </div>
    <div class="game-details-read-row">
      <span class="game-details-label">Hours</span>
      <strong>${escHtml(hoursText)}</strong>
    </div>
    <div class="game-details-read-row">
      <span class="game-details-label">Tracker/Stats</span>
      ${trackerDisplay}
    </div>`;

  const menuOpen = !!screenlistGameDetailsPlatformMenuState[id];
  const editHtml = `
    <div class="game-details-edit-grid">
      <div class="game-details-field game-details-platform-field">
        <span>Platform</span>
        <div id="game-platform-select-${escAttr(id)}" class="game-platform-select" data-game-details-id="${escAttr(id)}" data-game-detail-field="platform" data-value="${escAttr(platform)}">
          <input id="game-platform-value-${escAttr(id)}" data-game-details-id="${escAttr(id)}" data-game-detail-field="platform" type="hidden" value="${escAttr(platform)}">
          <button id="game-platform-trigger-${escAttr(id)}" class="game-platform-select-btn" type="button" data-game-platform-trigger="true" data-game-details-id="${escAttr(id)}" aria-expanded="${menuOpen ? 'true' : 'false'}">
            <span id="game-platform-label-${escAttr(id)}" class="${platform ? '' : 'placeholder'}">${escHtml(platform || 'Select platform')}</span>
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M5 7.5 10 12l5-4.5"/></svg>
          </button>
          <div id="game-platform-options-${escAttr(id)}" class="game-platform-options${menuOpen ? ' open' : ''}" data-game-details-id="${escAttr(id)}">
            ${renderGamePlatformOptionButtons(id, platform)}
          </div>
        </div>
      </div>
      <label class="game-details-field"><span class="game-details-field-head"><span>Hours played</span><a class="game-details-steam-link" href="${SCREENLIST_STEAM_LIBRARY_STATS_URL}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${getScreenListSteamIconSvg()}<span>Steam export</span></a></span><input id="game-hours-${escAttr(id)}" data-game-details-id="${escAttr(id)}" data-game-detail-field="hours" type="text" inputmode="decimal" maxlength="5" value="${escAttr(hours)}" placeholder="0" oninput="handleGameDetailsHoursInput('${escAttr(id)}',this)" onchange="handleGameDetailsHoursInput('${escAttr(id)}',this)" onblur="handleGameDetailsHoursInput('${escAttr(id)}',this)"></label>
      <label class="game-details-field game-details-field-wide"><span>Tracker / Stats URL</span><input id="game-tracker-${escAttr(id)}" data-game-details-id="${escAttr(id)}" data-game-detail-field="tracker" type="url" value="${escAttr(trackerUrl)}" placeholder="https://..." oninput="setGameDetailsDraft('${escAttr(id)}','tracker',this.value)" onchange="setGameDetailsDraft('${escAttr(id)}','tracker',this.value)" onblur="setGameDetailsDraft('${escAttr(id)}','tracker',this.value)"></label>
    </div>
    <div class="game-details-edit-actions">
      <button class="game-details-cancel-btn" type="button" onclick="event.stopPropagation();cancelGameDetailsEdit('${escAttr(id)}')">Cancel</button>
      <button class="game-details-save-btn" type="button" data-game-details-save="true" data-game-details-id="${escAttr(id)}" onclick="event.stopPropagation();event.preventDefault();saveGameDetailsEdit('${escAttr(id)}',this,event)">Save</button>
    </div>`;

  return `<div class="game-details-panel${isOpen ? ' open' : ''}${isEditing ? ' editing' : ''}" id="game-details-${escAttr(id)}" data-game-details-id="${escAttr(id)}">
    <div class="game-details-inner">
      ${isEditing ? editHtml : readHtml}
    </div>
  </div>`;
}

function syncGameDetailsPanelDomState(id = '') {
  const key = String(id || '').trim();
  if (!key) return false;
  const panel = document.getElementById(`game-details-${key}`);
  const toggle = document.getElementById(`game-details-toggle-${key}`);
  if (!panel || !toggle) return false;
  const isOpen = !!screenlistGameDetailsOpenState[key] || !!screenlistGameDetailsEditState[key];
  panel.classList.toggle('open', isOpen);
  panel.classList.toggle('editing', !!screenlistGameDetailsEditState[key] && !viewingUser);
  toggle.classList.toggle('open', isOpen);
  toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  const label = toggle.querySelector('span');
  if (label) label.textContent = isOpen ? 'Hide Info' : 'Expand Info';
  return true;
}

function toggleGameDetailsPanel(id = '') {
  if (activeSection !== 'games') return;
  const key = String(id || '').trim();
  if (!key) return;
  const wasEditing = !!screenlistGameDetailsEditState[key];
  const next = !(screenlistGameDetailsOpenState[key] || screenlistGameDetailsEditState[key]);
  screenlistGameDetailsOpenState[key] = next;
  if (!next) {
    screenlistGameDetailsEditState[key] = false;
    screenlistGameDetailsPlatformMenuState[key] = false;
    delete screenlistGameDetailsDraftState[key];
  }
  syncScreenListGameDetailGlobals();
  if (wasEditing || !syncGameDetailsPanelDomState(key)) render();
}

function openGameDetailsEdit(id = '') {
  if (activeSection !== 'games' || viewingUser) return;
  const key = String(id || '').trim();
  if (!key) return;
  const { item } = getScreenListGameById(key);
  screenlistGameDetailsDraftState[key] = getScreenListGameDetailValuesFromItem(item || {});
  screenlistGameDetailsOpenState[key] = true;
  screenlistGameDetailsEditState[key] = true;
  screenlistGameDetailsPlatformMenuState[key] = false;
  syncScreenListGameDetailGlobals();
  render();
}

// Game status expandable single-pill selector
function toggleGameStatusSelector(itemId, event) {
  event?.stopPropagation?.();
  const wrap = document.getElementById('game-status-selector-' + itemId);
  if (!wrap) return;
  const willExpand = !wrap.classList.contains('expanded');
  document.querySelectorAll('.game-status-selector.expanded').forEach(el => el.classList.remove('expanded'));
  if (willExpand) wrap.classList.add('expanded');
}
function changeGameStatusFromSelector(itemId, newStatus, event) {
  event?.stopPropagation?.();
  const wrap = document.getElementById('game-status-selector-' + itemId);
  if (wrap) wrap.classList.remove('expanded');
  changeStatus(itemId, newStatus);
}
(function initGameStatusSelectorHandlers() {
  if (window.__shelfdGameStatusSelectorInit) return;
  window.__shelfdGameStatusSelectorInit = true;
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.game-status-selector')) {
      document.querySelectorAll('.game-status-selector.expanded').forEach(el => el.classList.remove('expanded'));
    }
    // Close game card comment dropdowns when clicking outside
    if (!e.target.closest('.game-card-comment-drop') && !e.target.closest('.comments-btn')) {
      document.querySelectorAll('.game-card-comment-drop.open').forEach(el => el.classList.remove('open'));
    }
  }, false);
})();

// v318: Game card inline comment dropdown functions
function toggleGameCardComments(itemId, mediaKey, triggerEl, event) {
  event && event.stopPropagation && event.stopPropagation();
  const drop = document.getElementById('game-card-comments-' + itemId);
  if (!drop) return;
  const isOpen = drop.classList.contains('open');
  // Close all open dropdowns first
  document.querySelectorAll('.game-card-comment-drop.open').forEach(el => el.classList.remove('open'));
  if (!isOpen) {
    drop.classList.add('open');
    loadGameCardComments(itemId, mediaKey);
  }
}

async function loadGameCardComments(itemId, mediaKey) {
  const listEl = document.getElementById('game-card-comment-list-' + itemId);
  if (!listEl) return;
  listEl.innerHTML = '<div class="game-card-comment-empty">Loading...</div>';
  try {
    if (typeof db === 'undefined' || !db || !mediaKey) {
      listEl.innerHTML = '<div class="game-card-comment-empty">No comments yet.</div>';
      return;
    }
    const snap = await db.collection('comments').doc(mediaKey).get();
    const allComments = snap.exists && Array.isArray(snap.data() && snap.data().comments) ? snap.data().comments : [];
    // Show comments visible to current user (friends-scoped + own, and global)
    const visible = currentUser
      ? allComments.filter(function(c) {
          const scope = c.scope || 'global';
          if (scope === 'friends') return c.uid === currentUser.uid || (Array.isArray(friends) && friends.includes(c.uid));
          return true;
        })
      : allComments.filter(function(c) { return (c.scope || 'global') !== 'friends'; });
    renderGameCardCommentsList(listEl, visible);
    if (typeof setCachedCommentCount === 'function') setCachedCommentCount(mediaKey, allComments.length);
    if (typeof updateCommentCountBadges === 'function') updateCommentCountBadges(mediaKey, allComments.length);
  } catch (err) {
    console.error('Game card comments load failed:', err);
    listEl.innerHTML = '<div class="game-card-comment-empty">Could not load comments.</div>';
  }
}

function renderGameCardCommentsList(listEl, comments) {
  if (!comments || !comments.length) {
    listEl.innerHTML = '<div class="game-card-comment-empty">No comments yet.</div>';
    return;
  }
  listEl.innerHTML = comments.map(function(c) {
    const name = typeof escHtml === 'function' ? escHtml(c.name || 'User') : (c.name || 'User');
    const text = typeof escHtml === 'function' ? escHtml(c.text || '') : (c.text || '');
    const fallbackAvatar = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(c.name || '?') + '&background=1e2028&color=60a5fa&size=32';
    const photo = c.photo || fallbackAvatar;
    return '<div class="game-card-comment-item">'
      + '<img class="game-card-comment-avatar" src="' + photo + '" alt="" onerror="this.src=\'' + fallbackAvatar + '\'">'
      + '<div class="game-card-comment-body">'
      + '<div class="game-card-comment-name">' + name + '</div>'
      + '<div class="game-card-comment-text">' + text + '</div>'
      + '</div></div>';
  }).join('');
}

async function postGameCardComment(itemId, mediaKey, btnEl) {
  const ta = document.getElementById('game-card-comment-ta-' + itemId);
  if (!ta || !currentUser || typeof db === 'undefined' || !db || !mediaKey) return;
  const text = (ta.value || '').trim();
  if (!text) return;
  btnEl.disabled = true;
  try {
    const name = (typeof userProfile !== 'undefined' && userProfile && userProfile.name) || (currentUser.displayName) || 'User';
    const photo = (typeof userProfile !== 'undefined' && userProfile && userProfile.photo) || currentUser.photoURL || '';
    const newComment = {
      id: 'gc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      uid: currentUser.uid,
      name: name,
      photo: photo,
      text: text,
      timestamp: Date.now(),
      scope: 'friends'
    };
    await db.collection('comments').doc(mediaKey).set(
      { comments: firebase.firestore.FieldValue.arrayUnion(newComment) },
      { merge: true }
    );
    const record = findOwnLibraryItemRecord(itemId, 'games');
    if (record.item && typeof markOwnItemLastEdited === 'function') {
      markOwnItemLastEdited(record.item, record.section || 'games');
      save();
    }
    ta.value = '';
    await loadGameCardComments(itemId, mediaKey);
  } catch (err) {
    console.error('Post game card comment failed:', err);
    if (typeof showToast === 'function') showToast('Could not post comment. Try again.');
  } finally {
    btnEl.disabled = false;
  }
}

function cancelGameDetailsEdit(id = '') {
  const key = String(id || '').trim();
  if (!key) return;
  delete screenlistGameDetailsDraftState[key];
  screenlistGameDetailsPlatformMenuState[key] = false;
  screenlistGameDetailsEditState[key] = false;
  screenlistGameDetailsOpenState[key] = false;
  syncScreenListGameDetailGlobals();
  render();
}

async function saveGameDetailsEdit(id = '', triggerEl = null, event = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if (viewingUser) return false;

  const button = triggerEl?.closest?.('[data-game-details-save]') || (triggerEl && typeof triggerEl === 'object' ? triggerEl : null);
  if (button?.dataset?.saving === 'true') return false;

  const panelFromButton = button?.closest?.('.game-details-panel') || triggerEl?.closest?.('.game-details-panel') || null;
  const key = String(id || button?.dataset?.gameDetailsId || panelFromButton?.dataset?.gameDetailsId || '').trim();
  if (!key) return false;

  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    try { document.activeElement.blur(); } catch (error) {}
  }

  const panel = panelFromButton || getGameDetailsPanelById(key);
  const itemLookup = getScreenListGameById(key);
  const values = collectGameDetailsInputValues(key, panel);

  if (typeof window !== 'undefined') {
    window.__lastGameDetailsSaveDebug = {
      at: Date.now(),
      version: 'v277-real-save-rebuild',
      key,
      panelFound: !!panel,
      values: { ...values },
      draft: { ...(screenlistGameDetailsDraftState[key] || {}) },
      itemFound: itemLookup.index >= 0,
      itemIndex: itemLookup.index
    };
  }

  if (itemLookup.index < 0) {
    if (typeof showToast === 'function') showToast('Could not save game details. Try again.');
    return false;
  }

  if (button) {
    button.dataset.saving = 'true';
    button.disabled = true;
    button.dataset.originalText = button.dataset.originalText || button.textContent || 'Save';
    button.textContent = 'Saving';
  }

  const nextData = typeof cloneListData === 'function'
    ? cloneListData(data)
    : JSON.parse(JSON.stringify(data || getEmptyListData()));
  if (!Array.isArray(nextData.games)) nextData.games = [];

  const nextIndex = nextData.games.findIndex(entry =>
    String(entry?.id || '') === key || getScreenListGameStableKey(entry) === key
  );

  if (nextIndex < 0) {
    if (button) {
      button.disabled = false;
      button.dataset.saving = 'false';
      button.textContent = button.dataset.originalText || 'Save';
    }
    if (typeof showToast === 'function') showToast('Could not save game details. Try again.');
    return false;
  }

  const modifiedAt = new Date().toISOString();
  nextData.games[nextIndex] = {
    ...nextData.games[nextIndex],
    gamePlatform: values.platform,
    gamePlayedPlatform: values.platform,
    playedPlatform: values.platform,
    platformPlayed: values.platform,
    userPlatform: values.platform,
    gameHoursPlayed: values.hours,
    gameHours: values.hours,
    hoursPlayed: values.hours,
    playtimeHours: values.hours,
    currentHours: values.hours,
    gameTrackerUrl: values.tracker,
    gameStatsUrl: values.tracker,
    trackerStatsUrl: values.tracker,
    trackerUrl: values.tracker,
    statsUrl: values.tracker,
    dateModified: modifiedAt
  };

  const normalizedData = typeof normalizeListData === 'function' ? normalizeListData(nextData) : nextData;
  data = normalizedData;
  ownDataCache = typeof cloneListData === 'function' ? cloneListData(normalizedData) : JSON.parse(JSON.stringify(normalizedData));

  screenlistGameDetailsOpenState[key] = false;
  screenlistGameDetailsEditState[key] = false;
  screenlistGameDetailsPlatformMenuState[key] = false;
  delete screenlistGameDetailsDraftState[key];
  syncScreenListGameDetailGlobals();

  if (typeof window !== 'undefined' && window.__lastGameDetailsSaveDebug) {
    window.__lastGameDetailsSaveDebug.afterPatch = getScreenListGameDetailValuesFromItem(data.games?.find(entry => String(entry?.id || '') === key) || {});
    window.__lastGameDetailsSaveDebug.localDataPatched = true;
  }

  try {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    localStorage.setItem('watchlist-tracker-data', JSON.stringify(data));
    if (currentUser) localStorage.setItem('screenlist-own-data-backup-' + currentUser.uid, JSON.stringify(data));

    if (DOC_REF) {
      await persistOwnDataToFirestore(compactImportedAnimeForStorage(data));
    }

    if (currentUser?.uid === CREATOR_PUBLIC_UID && typeof syncCreatorPublicProfileMirror === 'function') {
      syncCreatorPublicProfileMirror(currentUser, userProfile, data).catch(error => console.warn('Creator mirror sync failed after game details save:', error));
    }

    if (typeof window !== 'undefined' && window.__lastGameDetailsSaveDebug) {
      window.__lastGameDetailsSaveDebug.firestoreWriteComplete = true;
    }

    render();
    if (typeof showToast === 'function') showToast('Game details saved');
    return true;
  } catch (error) {
    console.error('Game details save failed:', error);
    screenlistGameDetailsDraftState[key] = values;
    screenlistGameDetailsOpenState[key] = true;
    screenlistGameDetailsEditState[key] = true;
    syncScreenListGameDetailGlobals();
    if (typeof window !== 'undefined' && window.__lastGameDetailsSaveDebug) {
      window.__lastGameDetailsSaveDebug.error = error?.message || String(error);
    }
    render();
    if (typeof showToast === 'function') showToast('Could not save game details. Try again.');
    return false;
  } finally {
    if (button) {
      button.disabled = false;
      button.dataset.saving = 'false';
      button.textContent = button.dataset.originalText || 'Save';
    }
  }
}


// v401: My Lists media card display refinements and upcoming Watchlist release dates.
const SCREENLIST_UPCOMING_RELEASE_LOOKUP_INFLIGHT = new Set();
const SCREENLIST_UPCOMING_RELEASE_LOOKUP_DONE = new Set();

function isScreenListMovieTvAnimeSection(section = activeSection) {
  return section === 'movies' || section === 'shows' || section === 'anime';
}

function isScreenListTvAnimeWatchingCard(section = activeSection, item = {}) {
  return (section === 'shows' || section === 'anime') && String(item?.status || '') === 'watching';
}

function shouldHideMyListCardGenre(section = activeSection, item = {}) {
  return isScreenListTvAnimeWatchingCard(section, item);
}

function shouldHideMyListCommentButton(section = activeSection, item = {}) {
  return isScreenListMovieTvAnimeSection(section) && String(item?.status || '') === 'planned';
}

function getMyListAnimeExportUrl(item = {}) {
  const malId = String(item?.malId || item?.mal_id || '').trim();
  if (malId) return `https://myanimelist.net/anime/${encodeURIComponent(malId)}`;
  const title = getDisplayTitleForItem(item, 'anime') || item?.title || item?.name || '';
  return title ? `https://myanimelist.net/search/all?q=${encodeURIComponent(title)}` : 'https://myanimelist.net/';
}

function getMyListExternalBadgeConfig(item = {}, section = activeSection) {
  if ((section === 'movies' || section === 'shows') && item?.imdbId) {
    return { label: 'IMDb', url: `https://www.imdb.com/title/${encodeURIComponent(String(item.imdbId))}` };
  }
  if (section === 'anime') {
    return { label: 'MyAnimeList', url: getMyListAnimeExportUrl(item) };
  }
  return null;
}

function renderMyListBottomExternalBadge(item = {}, section = activeSection) {
  const config = getMyListExternalBadgeConfig(item, section);
  if (!config?.url || !config?.label) return '';
  return `<a class="mylist-bottom-export-badge ${section === 'anime' ? 'mal-export-badge' : 'imdb-export-badge'}" href="${escAttr(config.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" aria-label="Open ${escAttr(config.label)}"><span>${escHtml(config.label)}</span></a>`;
}

function canUseWatchlistPriority(item = {}, section = activeSection, tab = activeTab) {
  return !viewingUser
    && tab === 'planned'
    && (section === 'movies' || section === 'shows' || section === 'anime')
    && String(item?.status || '') === 'planned';
}

function getWatchlistPriorityValue(item = {}) {
  const value = Number(item?.watchPriority || 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : '';
}

function normalizeWatchlistPriorityValue(value = '') {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.floor(parsed)) : 0;
}

function renderWatchlistPriorityControl(item = {}, section = activeSection) {
  if (!canUseWatchlistPriority(item, section, activeTab)) return '';
  const value = getWatchlistPriorityValue(item);
  return `<label class="watchlist-priority-slot" onclick="event.stopPropagation()">
    <span>Priority</span>
    <input class="watchlist-priority-input" type="number" inputmode="numeric" pattern="[0-9]*" min="1" step="1" value="${escAttr(value)}" placeholder="-" aria-label="Watchlist priority for ${escAttr(item.title || 'this title')}" data-mylist-action="watch-priority" data-mylist-item-id="${escAttr(item.id)}" oninput="event.stopPropagation()" onchange="event.stopPropagation();setWatchlistPriority('${escAttr(item.id)}', this.value)">
  </label>`;
}

function parseScreenListDateMs(value = '') {
  const clean = String(value || '').trim();
  if (!clean) return 0;
  const direct = Date.parse(clean);
  if (Number.isFinite(direct)) return direct;
  const year = clean.match(/^(18|19|20)\d{2}$/)?.[0];
  return year ? Date.parse(`${year}-01-01T00:00:00`) : 0;
}

function isScreenListFutureReleaseDate(value = '') {
  const ms = parseScreenListDateMs(value);
  if (!ms) return false;
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return ms >= todayStart;
}

function formatScreenListReleaseDateLabel(value = '') {
  const ms = parseScreenListDateMs(value);
  if (!ms) return '';
  const date = new Date(ms);
  try {
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  } catch (e) {
    return String(value || '').trim();
  }
}

function parseScreenListDateOnly(value = '') {
  const clean = String(value || '').trim();
  if (!clean) return null;
  const ymd = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) {
    const year = Number(ymd[1]);
    const month = Number(ymd[2]);
    const day = Number(ymd[3]);
    if (year && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(year, month - 1, day);
    }
  }
  const parsed = new Date(clean);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function getScreenListTodayStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function isScreenListDateToday(value = '') {
  const date = parseScreenListDateOnly(value);
  return !!date && date.getTime() === getScreenListTodayStart();
}

function isScreenListDateTodayOrFuture(value = '') {
  const date = parseScreenListDateOnly(value);
  return !!date && date.getTime() >= getScreenListTodayStart();
}

function formatMyListNextEpisodeDate(value = '') {
  const date = parseScreenListDateOnly(value);
  if (!date) return '';
  try {
    return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
  } catch (e) {
    const clean = String(value || '').trim();
    const m = clean.match(/^\d{4}-(\d{2})-(\d{2})/);
    return m ? `${Number(m[1])}/${Number(m[2])}` : clean;
  }
}

function normalizeMyListTmdbNextEpisodeMetadata(details = {}) {
  const ep = details?.next_episode_to_air || details?.nextEpisodeToAir || null;
  const airDate = String(
    ep?.air_date ||
    ep?.airDate ||
    details?.nextEpisodeAirDate ||
    ''
  ).trim();
  if (!airDate) return null;
  return {
    airDate,
    episode: {
      id: ep?.id || '',
      name: ep?.name || '',
      air_date: airDate,
      airDate,
      season_number: ep?.season_number || ep?.seasonNumber || '',
      seasonNum: ep?.season_number || ep?.seasonNumber || '',
      episode_number: ep?.episode_number || ep?.episodeNumber || '',
      epNum: ep?.episode_number || ep?.episodeNumber || ''
    }
  };
}

function getMyListNextEpisodeAirDate(item = {}) {
  const candidates = [
    item?.nextEpisodeAirDate,
    item?.next_episode_to_air?.air_date,
    item?.next_episode_to_air?.airDate,
    item?.nextEpisodeToAir?.air_date,
    item?.nextEpisodeToAir?.airDate,
    item?.nextEpisode?.airDate,
    item?.nextEpisode?.air_date
  ];
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value) return value;
  }
  const datedEpisodes = (Array.isArray(item?.episodes) ? item.episodes : [])
    .map(ep => String(ep?.airDate || ep?.air_date || ep?.releaseDate || '').trim())
    .filter(Boolean)
    .filter(isScreenListDateTodayOrFuture)
    .sort((a, b) => (parseScreenListDateOnly(a)?.getTime() || 0) - (parseScreenListDateOnly(b)?.getTime() || 0));
  return datedEpisodes[0] || '';
}

function getMyListNextEpisodeLabel(item = {}, section = activeSection) {
  if (section !== 'shows' && section !== 'anime') return '';
  const airDate = getMyListNextEpisodeAirDate(item);
  if (!isScreenListDateTodayOrFuture(airDate)) return '';
  if (isScreenListDateToday(airDate)) return 'NEW EPISODE OUT';
  const labelDate = formatMyListNextEpisodeDate(airDate);
  return labelDate ? `Next episode airing ${labelDate}` : '';
}

function renderMyListNextEpisodeHtml(item = {}, section = activeSection) {
  const label = getMyListNextEpisodeLabel(item, section);
  if (!label) return '';
  const isNew = label === 'NEW EPISODE OUT';
  return `<div class="card-next-episode${isNew ? ' is-new' : ''}">${escHtml(label)}</div>`;
}

function renderMyListNextEpisodeActionHtml(item = {}, section = activeSection, tab = activeTab) {
  if (tab !== 'watching') return '';
  if (section !== 'shows' && section !== 'anime') return '';
  return renderMyListNextEpisodeHtml(item, section);
}

function getScreenListKnownReleaseDate(item = {}) {
  const candidates = [
    item?.releaseDate,
    item?.upcomingReleaseDate,
    item?.firstAirDate,
    item?.airDate,
    item?.release_date,
    item?.first_air_date,
    item?.premiered,
    item?.premiereDate,
    item?.airedFrom,
    item?.aired?.from
  ];
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value) return value;
  }
  return '';
}

function getMyListUpcomingReleaseLabel(item = {}, section = activeSection) {
  if (!isScreenListMovieTvAnimeSection(section) || String(item?.status || '') !== 'planned') return '';
  const value = getScreenListKnownReleaseDate(item);
  if (!isScreenListFutureReleaseDate(value)) return '';
  const labelDate = formatScreenListReleaseDateLabel(value);
  return labelDate ? `Releases ${labelDate}` : '';
}

// v434: theatrical window heuristic — a movie released within ~10 weeks is treated
// as "currently in theaters". This is a pragmatic proxy because TMDB's
// `release_dates` endpoint per-territory is heavier and we want one cheap call.
const SHELFD_THEATRICAL_WINDOW_MS = 75 * 24 * 60 * 60 * 1000;
const SHELFD_WATCHLIST_PROVIDER_LOOKUP_INFLIGHT = new Set();
const SHELFD_WATCHLIST_PROVIDER_LOOKUP_DONE = new Set();
const SHELFD_NEXT_EPISODE_LOOKUP_INFLIGHT = new Set();
const SHELFD_NEXT_EPISODE_LOOKUP_DONE = new Set();

function getMyListWatchListAvailabilityState(item = {}, section = activeSection) {
  // v435: streaming-aware decision tree.
  //   'unreleased'  — date is in the future ⇒ show release date
  //   'in-theaters' — MOVIE released in the last ~75d AND no streaming provider
  //                   yet known. As soon as TMDB tells us a flatrate/free/ads
  //                   provider exists, the title flips to 'released' so the card
  //                   shows "Where to watch:" instead of "In theaters". This is
  //                   what was breaking Roommates — providers existed (Netflix)
  //                   but the date-only window kept saying "In theaters".
  //   'released'    — anything past release that isn't currently theatrical.
  //   'unknown'     — no usable release date yet (hydration still pending).
  // TV / anime never enter 'in-theaters'.
  if (!isScreenListMovieTvAnimeSection(section) || String(item?.status || '') !== 'planned') {
    return { state: 'unknown', date: '', providers: [] };
  }
  const dateStr = getScreenListKnownReleaseDate(item);
  const dateMs = parseScreenListDateMs(dateStr);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (!dateMs) return { state: 'unknown', date: '', providers: [] };
  if (dateMs >= todayStart) return { state: 'unreleased', date: dateStr, providers: [] };

  const providers = Array.isArray(item?.watchProviders) ? item.watchProviders : [];
  const hasSubscriptionProvider = providers.some(p => p && ['flatrate', 'free', 'ads'].includes(String(p.source || '')));

  if (section === 'movies' && (Date.now() - dateMs) <= SHELFD_THEATRICAL_WINDOW_MS && !hasSubscriptionProvider) {
    return { state: 'in-theaters', date: dateStr, providers: [] };
  }
  return { state: 'released', date: dateStr, providers };
}

function renderMyListWatchListProviderLogo(provider = {}) {
  const name = String(provider?.provider_name || provider?.name || provider?.label || '').trim();
  const logoUrl = typeof getMediaProviderLogoUrl === 'function' ? getMediaProviderLogoUrl(provider) : '';
  const initial = (name || '?').charAt(0).toUpperCase();
  return `<span class="mylist-availability-provider" title="${escAttr(name)}" aria-label="${escAttr(name)}">${
    logoUrl
      ? `<img src="${escAttr(logoUrl)}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="mylist-availability-provider-fallback" style="display:none">${escHtml(initial)}</span>`
      : `<span class="mylist-availability-provider-fallback">${escHtml(initial)}</span>`
  }</span>`;
}

function renderMyListWatchListAvailabilityHtml(item = {}, section = activeSection) {
  const avail = getMyListWatchListAvailabilityState(item, section);
  if (avail.state === 'unreleased') {
    const label = formatScreenListReleaseDateLabel(avail.date) || avail.date || '';
    return label ? `<div class="card-availability-line mylist-availability-release-date">${escHtml(label)}</div>` : '';
  }
  if (avail.state === 'in-theaters') {
    return `<div class="card-availability-line mylist-availability-in-theaters">In theaters</div>`;
  }
  if (avail.state === 'released') {
    if (!avail.providers.length) return '';
    const logos = avail.providers.slice(0, 3).map(renderMyListWatchListProviderLogo).join('');
    return `<div class="card-availability-line mylist-availability-where-to-watch"><span class="mylist-availability-where-text">Where to watch:</span><span class="mylist-availability-providers">${logos}</span></div>`;
  }
  return '';
}

async function fetchMyListWatchProviders(item = {}, section = activeSection) {
  // Pull TMDB's /watch/providers and pick up to 3 providers, prioritising
  // subscription (flatrate) > free > ads, falling back to rent/buy. Region
  // defaults to US to match the existing discovery pipeline.
  const tmdbId = String(item?.tmdbId || item?.tmdb_id || '').trim();
  if (!tmdbId) return null;
  const type = section === 'movies' ? 'movie' : 'tv';
  try {
    const res = await fetchTmdbProxy(`${type}/${encodeURIComponent(tmdbId)}/watch/providers`);
    const json = res.ok ? await res.json() : null;
    const region = json?.results?.US || null;
    if (!region) return [];
    const seen = new Set();
    const ordered = [];
    const pushBucket = (bucketKey) => {
      const arr = Array.isArray(region[bucketKey]) ? region[bucketKey] : [];
      for (const p of arr) {
        const id = String(p?.provider_id || p?.providerId || p?.provider_name || '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ordered.push({
          provider_id: p.provider_id || p.providerId || '',
          provider_name: String(p.provider_name || p.name || '').trim(),
          logo_path: typeof p.logo_path === 'string' ? p.logo_path : '',
          source: bucketKey
        });
        if (ordered.length >= 3) return true;
      }
      return ordered.length >= 3;
    };
    if (pushBucket('flatrate')) return ordered;
    if (pushBucket('free')) return ordered;
    if (pushBucket('ads')) return ordered;
    if (pushBucket('rent')) return ordered;
    pushBucket('buy');
    return ordered;
  } catch (error) {
    console.warn('Watchlist watch-provider lookup failed:', error);
    return null;
  }
}

function setScreenListItemUpcomingReleaseDate(item = {}, section = activeSection, dateValue = '') {
  const value = String(dateValue || '').trim();
  if (!item || !value) return false;
  const changed = item.releaseDate !== value || item.upcomingReleaseDate !== value;
  item.releaseDate = value;
  item.upcomingReleaseDate = value;
  item.releaseDateHydratedAt = new Date().toISOString();
  if (section === 'movies') item.release_date = value;
  if (section === 'shows' || section === 'anime') item.first_air_date = value;
  return changed;
}

function updateMyListUpcomingReleaseDateElement(item = {}, section = activeSection) {
  // v434: drives the full Watch List availability line — release date / "In theaters"
  // / "Where to watch:" + provider logos.
  // v778: unreleased titles now show their release date in the action-row span
  // (.card-upcoming-release-label). This function keeps that span up to date when
  // hydration refreshes the date, and removes it when the title transitions to
  // released/in-theaters so the availability line takes over.
  const cardSelector = `#card-${CSS.escape(String(item?.id || ''))}`;
  const actionRowSpan = document.querySelector(`${cardSelector} .card-upcoming-release-label`);
  if (actionRowSpan) actionRowSpan.remove();

  const html = renderMyListWatchListAvailabilityHtml(item, section);
  let node = document.querySelector(`${cardSelector} .card-availability-line`);
  if (!html) {
    if (node) node.remove();
    // Also strip any legacy v429-and-older markup that might still be in the DOM.
    document.querySelectorAll(`${cardSelector} .mylist-upcoming-release-date`).forEach(el => el.remove());
    return;
  }
  // Build a detached element from the freshly-rendered HTML and either replace
  // the existing one in place or insert a new one above the status pills.
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const next = tmp.firstElementChild;
  if (!next) return;
  if (node) {
    node.replaceWith(next);
    return;
  }
  // Remove any legacy markup before inserting the new line.
  document.querySelectorAll(`${cardSelector} .mylist-upcoming-release-date`).forEach(el => {
    if (!el.classList.contains('card-availability-line')) el.remove();
  });
  const info = document.querySelector(`${cardSelector} .card-info`);
  const status = document.querySelector(`${cardSelector} .status-pills`);
  if (!info) return;
  if (status && status.parentNode === info) info.insertBefore(next, status);
  else info.appendChild(next);
}

async function fetchMyListTmdbReleaseDate(item = {}, section = activeSection) {
  const mediaType = section === 'movies' ? 'movie' : 'tv';
  let tmdbId = String(item?.tmdbId || item?.tmdb_id || '').trim();
  if (!tmdbId && item?.title) {
    try {
      const params = { query: item.title, include_adult: false };
      const year = String(item.year || '').match(/^(18|19|20)\d{2}$/)?.[0] || '';
      if (year) {
        if (mediaType === 'movie') params.primary_release_year = year;
        else params.first_air_date_year = year;
      }
      const searchRes = await fetchTmdbProxy(`search/${mediaType}`, params);
      const searchJson = searchRes.ok ? await searchRes.json() : null;
      const results = Array.isArray(searchJson?.results) ? searchJson.results : [];
      const match = results.find(row => year && String((row.release_date || row.first_air_date || '').slice(0, 4)) === year) || results[0];
      if (match?.id) {
        tmdbId = String(match.id);
        item.tmdbId = tmdbId;
      }
    } catch (e) {}
  }
  if (!tmdbId) return '';
  try {
    const detailRes = await fetchTmdbProxy(`${mediaType}/${encodeURIComponent(tmdbId)}`);
    const detailJson = detailRes.ok ? await detailRes.json() : null;
    return String(detailJson?.release_date || detailJson?.first_air_date || '').trim();
  } catch (e) {
    return '';
  }
}

async function fetchMyListJikanReleaseDate(item = {}) {
  const malId = String(item?.malId || item?.mal_id || '').trim();
  if (!malId) return '';
  try {
    const res = await fetch(`https://api.jikan.moe/v4/anime/${encodeURIComponent(malId)}/full`, { cache: 'force-cache' });
    const json = res.ok ? await res.json() : null;
    return String(json?.data?.aired?.from || '').trim().slice(0, 10);
  } catch (e) {
    return '';
  }
}

async function fetchMyListTvMazeReleaseDate(item = {}) {
  const title = String(item?.title || item?.name || '').trim();
  if (!title) return '';
  try {
    const res = await fetch(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(title)}`, { cache: 'force-cache' });
    const json = res.ok ? await res.json() : null;
    return String(json?.premiered || '').trim();
  } catch (e) {
    return '';
  }
}

async function resolveMyListTmdbTvId(item = {}) {
  let tmdbId = String(item?.tmdbId || item?.tmdb_id || '').trim();
  if (tmdbId) return tmdbId;
  const title = String(item?.title || item?.name || '').trim();
  if (!title) return '';
  try {
    const params = { query: title, include_adult: false };
    const year = String(item.year || item.first_air_date || item.firstAirDate || '').match(/^(18|19|20)\d{2}/)?.[0] || '';
    if (year) params.first_air_date_year = year;
    const searchRes = await fetchTmdbProxy('search/tv', params);
    const searchJson = searchRes.ok ? await searchRes.json() : null;
    const results = Array.isArray(searchJson?.results) ? searchJson.results : [];
    const match = results.find(row => year && String((row.first_air_date || '').slice(0, 4)) === year) || results[0];
    if (match?.id) {
      tmdbId = String(match.id);
      item.tmdbId = tmdbId;
      return tmdbId;
    }
  } catch (e) {}
  return '';
}

async function fetchMyListNextEpisodeMetadata(item = {}, section = activeSection) {
  if (section !== 'shows' && section !== 'anime') return null;
  const tmdbId = await resolveMyListTmdbTvId(item);
  if (!tmdbId) return null;
  try {
    const detailRes = await fetchTmdbProxy(`tv/${encodeURIComponent(tmdbId)}`);
    const detailJson = detailRes.ok ? await detailRes.json() : null;
    return normalizeMyListTmdbNextEpisodeMetadata(detailJson);
  } catch (e) {
    return null;
  }
}

function setMyListNextEpisodeMetadata(item = {}, metadata = null) {
  if (!item || !metadata?.airDate) return false;
  const airDate = String(metadata.airDate || '').trim();
  const episode = metadata.episode || {};
  const previous = String(item.nextEpisodeAirDate || item.next_episode_to_air?.air_date || '').trim();
  item.nextEpisodeAirDate = airDate;
  item.next_episode_to_air = {
    ...(item.next_episode_to_air || {}),
    ...episode,
    air_date: airDate,
    airDate
  };
  item.nextEpisodeHydratedAt = new Date().toISOString();
  return previous !== airDate;
}

function updateMyListNextEpisodeElement(item = {}, section = activeSection) {
  const cardId = String(item?.id || '');
  if (!cardId) return;
  const cardSelector = `#card-${CSS.escape(cardId)}`;
  const card = document.querySelector(cardSelector);
  if (!card) return;
  const existing = card.querySelector('.card-next-episode');
  const html = renderMyListNextEpisodeActionHtml(item, section, activeTab);
  if (!html) {
    if (existing) existing.remove();
    return;
  }
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const node = tmp.firstElementChild;
  if (!node) return;
  if (existing) {
    existing.replaceWith(node);
    return;
  }
  const actionRow = card.querySelector('.card-action-row');
  const footerActions = actionRow?.querySelector('.card-footer-actions');
  if (!actionRow) return;
  actionRow.classList.add('has-next-episode');
  if (footerActions?.parentNode === actionRow) actionRow.insertBefore(node, footerActions);
  else actionRow.prepend(node);
}

function queueMyListNextEpisodeHydration(item = {}, section = activeSection) {
  if (section !== 'shows' && section !== 'anime') return;
  const known = getMyListNextEpisodeAirDate(item);
  if (known) {
    updateMyListNextEpisodeElement(item, section);
    return;
  }
  if (!item?.tmdbId && !item?.title) return;
  const key = `${section}:${item?.id || ''}:${item?.tmdbId || ''}:${item?.title || ''}`;
  if (SHELFD_NEXT_EPISODE_LOOKUP_INFLIGHT.has(key) || SHELFD_NEXT_EPISODE_LOOKUP_DONE.has(key)) return;
  SHELFD_NEXT_EPISODE_LOOKUP_INFLIGHT.add(key);
  setTimeout(async () => {
    try {
      const metadata = await fetchMyListNextEpisodeMetadata(item, section);
      if (metadata?.airDate) {
        const changed = setMyListNextEpisodeMetadata(item, metadata);
        updateMyListNextEpisodeElement(item, section);
        if (changed && currentUser && !viewingUser) save();
      }
      SHELFD_NEXT_EPISODE_LOOKUP_DONE.add(key);
    } catch (error) {
      console.warn('Next episode hydration failed:', error);
    } finally {
      SHELFD_NEXT_EPISODE_LOOKUP_INFLIGHT.delete(key);
    }
  }, 0);
}

async function fetchMyListUpcomingReleaseDate(item = {}, section = activeSection) {
  let dateValue = await fetchMyListTmdbReleaseDate(item, section);
  if (!dateValue && section === 'anime') dateValue = await fetchMyListJikanReleaseDate(item);
  if (!dateValue && (section === 'shows' || section === 'anime')) dateValue = await fetchMyListTvMazeReleaseDate(item);
  return String(dateValue || '').trim();
}

function queueMyListUpcomingReleaseDateHydration(item = {}, section = activeSection) {
  // v434: now drives the full Watch List availability hydration — release date AND
  // (when released-non-theatrical) up to 3 watch providers. Only marks the
  // date-lookup DONE on success so a transient TMDB failure doesn't permanently
  // leave a card without a release date (this was the Spider-Man: Brand New Day
  // symptom — once the first attempt was marked DONE the card never retried).
  if (!isScreenListMovieTvAnimeSection(section) || String(item?.status || '') !== 'planned') return;

  const dateKey = `${section}:${item?.id || ''}:${item?.tmdbId || ''}:${item?.title || ''}`;
  const providerKey = `${section}:${item?.id || ''}:${item?.tmdbId || ''}:providers`;
  const known = getScreenListKnownReleaseDate(item);
  let datePromise = null;

  if (known) {
    // Date already known — render whatever state it implies right now.
    updateMyListUpcomingReleaseDateElement(item, section);
    SCREENLIST_UPCOMING_RELEASE_LOOKUP_DONE.add(dateKey);
  } else if (!SCREENLIST_UPCOMING_RELEASE_LOOKUP_INFLIGHT.has(dateKey) && !SCREENLIST_UPCOMING_RELEASE_LOOKUP_DONE.has(dateKey)) {
    SCREENLIST_UPCOMING_RELEASE_LOOKUP_INFLIGHT.add(dateKey);
    datePromise = (async () => {
      try {
        const dateValue = await fetchMyListUpcomingReleaseDate(item, section);
        if (dateValue) {
          const changed = setScreenListItemUpcomingReleaseDate(item, section, dateValue);
          updateMyListUpcomingReleaseDateElement(item, section);
          if (changed && currentUser && !viewingUser) save();
          SCREENLIST_UPCOMING_RELEASE_LOOKUP_DONE.add(dateKey);
        }
      } catch (error) {
        console.warn('Watchlist release-date hydration failed:', error);
        // Intentionally NOT adding to DONE on failure — let the next render retry.
      } finally {
        SCREENLIST_UPCOMING_RELEASE_LOOKUP_INFLIGHT.delete(dateKey);
      }
    })();
    setTimeout(() => datePromise, 0);
  }

  // Provider hydration — fires for both 'released' AND 'in-theaters' titles. The
  // in-theaters case still needs to query TMDB so a movie that's in theaters but
  // also already streaming (Roommates / Netflix simultaneous release) flips to
  // 'released' once the streaming providers come back.
  const tryHydrateProviders = async () => {
    if (!isScreenListMovieTvAnimeSection(section) || String(item?.status || '') !== 'planned') return;
    const state = getMyListWatchListAvailabilityState(item, section).state;
    if (state !== 'released' && state !== 'in-theaters') return;
    if (Array.isArray(item.watchProviders)) {
      updateMyListUpcomingReleaseDateElement(item, section);
      return;
    }
    if (SHELFD_WATCHLIST_PROVIDER_LOOKUP_INFLIGHT.has(providerKey) || SHELFD_WATCHLIST_PROVIDER_LOOKUP_DONE.has(providerKey)) return;
    SHELFD_WATCHLIST_PROVIDER_LOOKUP_INFLIGHT.add(providerKey);
    try {
      const providers = await fetchMyListWatchProviders(item, section);
      if (Array.isArray(providers)) {
        item.watchProviders = providers;
        item.watchProvidersHydratedAt = new Date().toISOString();
        updateMyListUpcomingReleaseDateElement(item, section);
        if (providers.length && currentUser && !viewingUser) save();
        SHELFD_WATCHLIST_PROVIDER_LOOKUP_DONE.add(providerKey);
      }
    } catch (error) {
      console.warn('Watchlist watch-provider hydration failed:', error);
      // Don't mark DONE on error so a future render can retry.
    } finally {
      SHELFD_WATCHLIST_PROVIDER_LOOKUP_INFLIGHT.delete(providerKey);
    }
  };

  if (datePromise) {
    setTimeout(() => { datePromise.then(tryHydrateProviders); }, 120);
  } else {
    setTimeout(tryHydrateProviders, 120);
  }
}

function renderCard(item, isDraggable) {
  const type = isShowSection(activeSection) ? "show" : activeSection === "movies" ? "movie" : activeSection === "games" ? "game" : "reading";
  const mediaKey = getMediaKey(item);
  const commentCount = isPreviewMode() && !currentUser
    ? getPreviewCommentsForMedia(mediaKey).length
    : getCachedCommentCount(mediaKey);
  const isGameCard = activeSection === 'games';
  const cardCoverSrc = isGameCard && typeof getScreenListDisplayGameCover === 'function'
    ? getScreenListDisplayGameCover(item)
    : normalizeMyListPosterUrl(item.cover || '');
  const coverStyle = cardCoverSrc
    ? `background-image:url('${cardCoverSrc}');background-size:cover;background-position:top center;`
    : "";
  const coverPosterAttr = cardCoverSrc ? `data-poster="${escAttr(cardCoverSrc)}"` : '';
  const coverClass = cardCoverSrc ? "card-cover" : (isGameCard ? "card-cover no-img screenlist-game-cover-pending" : "card-cover no-img");
  const emoji = getSectionIcon(activeSection);
  const friendAlreadyAdded = viewingUser && myData ? isDuplicateTitleInList(item.title, activeSection, myData) : false;
  const itemSectionAttr = escAttr(activeSection);
  const itemIdAttr = escAttr(item.id);
  // Stable key for game details panel — falls back to rawgId/slug/title for legacy entries without item.id
  const gameDetailsKey = isGameCard ? escAttr(String(item.id || '') || getScreenListGameStableKey(item)) : itemIdAttr;
  const displayTitle = getDisplayTitleForItem(item, activeSection) || item.title || '';
  if (activeSection === 'anime') {
    queueAnimeTitleVariantHydration(item, activeSection);
    queueMissingMalPosterHydration(item, activeSection);
  }
  if (activeSection === 'shows' || activeSection === 'anime') queueMyListNextEpisodeHydration(item, activeSection);
  const canOpenProfile = canOpenLibraryMediaProfile(activeSection);
  const canOpenTrackerBreakdown = isGameCard
    && typeof hasScreenListTrackerBreakdownForItem === 'function'
    && hasScreenListTrackerBreakdownForItem(item);
  const gameTitleMarkup = isGameCard
    ? `<button class="card-title-profile-btn game-title-profile-btn" type="button" data-library-item-id="${itemIdAttr}" data-library-section="${itemSectionAttr}" onclick="${canOpenTrackerBreakdown ? `openTrackerStatsPage(event,'${itemIdAttr}')` : `openGameMediaProfileFromLibrary(event,'${itemIdAttr}','${itemSectionAttr}')`}">${escHtml(displayTitle)}</button>`
    : canOpenProfile
      ? `<button class="card-title-profile-btn media-title-profile-btn" type="button" data-library-item-id="${itemIdAttr}" data-library-section="${itemSectionAttr}" onclick="openLibraryMediaProfile(event,'${itemIdAttr}','${itemSectionAttr}')">${escHtml(displayTitle)}</button>`
      : `<span>${escHtml(displayTitle)}</span>`;
  const coverProfileAttrs = canOpenProfile ? `data-library-item-id="${itemIdAttr}" data-library-section="${itemSectionAttr}" role="button" tabindex="0" aria-label="Open ${escAttr(displayTitle)} profile"` : '';
  const coverProfileClass = canOpenProfile ? ' card-cover-profile-btn' : '';
  if (activeTab === 'planned' && isScreenListMovieTvAnimeSection(activeSection)) queueMyListUpcomingReleaseDateHydration(item, activeSection);
  let releaseLabelForActionRow = '';
  if (activeTab === 'planned') {
    if (isGameCard) {
      const gameDate = String(item?.releaseDate || item?.released || item?.release_date || '').trim();
      if (gameDate && typeof isScreenListFutureReleaseDate === 'function' && isScreenListFutureReleaseDate(gameDate)) {
        const formatted = typeof formatScreenListReleaseDateLabel === 'function'
          ? formatScreenListReleaseDateLabel(gameDate) : gameDate;
        releaseLabelForActionRow = formatted ? `Releases ${formatted}` : '';
      }
    }
  }
  const bottomExternalBadgeHtml = renderMyListBottomExternalBadge(item, activeSection);
  const watchlistPriorityHtml = renderWatchlistPriorityControl(item, activeSection);
  const nextEpisodeActionHtml = renderMyListNextEpisodeActionHtml(item, activeSection, activeTab);
  const showCommentButton = !shouldHideMyListCommentButton(activeSection, item);

  let watchedCount = 0, totalEps = 0, progress = 0;
  if (type === "show") {
    const compactProgress = getCompactEpisodeStats(item);
    totalEps = compactProgress.total;
    watchedCount = compactProgress.watched;
    progress = compactProgress.percent;
  }

  const statusConfigs = getMyListStatusButtonConfigs(activeSection);
  // v319: all cards use the expandable single-pill pop-out status selector
  const currentStatusCfg = statusConfigs.find(c => c.status === item.status);
  const currentStatusLabel = currentStatusCfg?.label || (item.status || 'Status');
  const statusSelectorHtml = `<div class="game-status-selector" id="game-status-selector-${escAttr(item.id)}">
    <button class="status-pill ${item.status ? item.status + '-active' : ''} game-status-current-pill" type="button" data-status="${escAttr(item.status || '')}" onclick="event.stopPropagation();toggleGameStatusSelector('${escAttr(item.id)}',event)">${escHtml(currentStatusLabel)}</button>
    <div class="game-status-options">
      ${statusConfigs.filter(c => c.status !== item.status).map(c => `<button class="status-pill" type="button" data-status="${escAttr(c.status)}" onclick="event.stopPropagation();changeGameStatusFromSelector('${escAttr(item.id)}','${escAttr(c.status)}',event)">${escHtml(c.label)}</button>`).join('')}
    </div>
  </div>`;

  let episodeToggleButton = "";
  let episodeSection = "";
  // v451: Show Episodes button parity for Anime ──────────────────────────────
  // MAL-imported anime keep totalEpisodes/currentEp but compact `episodes` to []
  // for storage; the button used to disappear because the old gate only checked
  // `episodes.length`. Now we also accept anime that have totalEpisodes > 0 and
  // render synthetic episode rows on demand (see getRenderableEpisodes /
  // hydrateAnimeEpisodesIfSynthetic below). TV Shows path is unchanged.
  const animeHasTrackingMetadata = activeSection === 'anime' && Number(item.totalEpisodes || item.totalEps || 0) > 0;
  const hasFullEpisodeRows = type === "show" && (
    (Array.isArray(item.episodes) && item.episodes.length > 0) || animeHasTrackingMetadata
  );
  if (hasFullEpisodeRows) {
    episodeToggleButton = `
      <button type="button" class="ep-toggle-bar card-footer-btn" onclick="toggleEpisodes('${item.id}')">
        <span id="ep-label-${item.id}">Episodes</span>
        <span class="ep-arrow" id="ep-arrow-${item.id}">&#9662;</span>
      </button>
    `;
    episodeSection = `
      <div class="ep-list" id="ep-list-${item.id}">
        <div class="ep-list-inner">
        ${!viewingUser ? `<div class="ep-actions">
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn-secondary btn-sm" data-mylist-action="mark-all-eps" data-mylist-item-id="${item.id}" data-mylist-mark-value="true" onclick="markAllEps('${item.id}',true)">Mark All Watched</button>
            <button type="button" class="btn-secondary btn-sm" data-mylist-action="mark-all-eps" data-mylist-item-id="${item.id}" data-mylist-mark-value="false" onclick="markAllEps('${item.id}',false)">Clear All</button>
          </div>
          <div class="edit-ep-row" id="edit-ep-${item.id}">
            <button type="button" class="edit-ep-link" onclick="showEditEp('${item.id}')">Edit episode count</button>
          </div>
        </div>` : ''}
        <div class="ep-scroll">
          ${renderEpisodeList(item)}
        </div>
        </div>
      </div>
    `;
  }

  // Inline game stats for card display
  const _igs = isGameCard ? getScreenListGameDetailValuesFromItem(item) : null;
  const gameStatHours = _igs ? (_igs.hours ? _igs.hours + 'h' : '—') : '';
  const gameStatPlatform = _igs ? (_igs.platform || '—') : '';
  const gameStatTracker = _igs ? _igs.tracker : '';
  const competitiveStatsHtml = isGameCard && typeof renderScreenListCompetitiveStatsCardHtml === 'function'
    ? renderScreenListCompetitiveStatsCardHtml(item)
    : '';
  const gameStatsHtml = isGameCard ? `<div class="game-card-stats-inline">
    <div class="game-card-stat-row"><span class="game-card-stat-label">Hours played:</span><span class="game-card-stat-val">${escHtml(gameStatHours)}</span></div>
    <div class="game-card-stat-row"><span class="game-card-stat-label">Platform:</span><span class="game-card-stat-val">${escHtml(gameStatPlatform)}</span></div>
    <div class="game-card-stat-row"><span class="game-card-stat-label">Tracker/Stats:</span>${gameStatTracker ? `<a class="game-card-tracker-icon-link" href="${escAttr(gameStatTracker)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" aria-label="Open Tracker/Stats">${getScreenListGameTrackerIconSvg()}</a>` : '<span class="game-card-stat-val">—</span>'}</div>
  </div>` : '';

  // v318: game cards get inline comment dropdown; other cards navigate to comments page
  const commentsOnclick = isGameCard
    ? `toggleGameCardComments('${escAttr(item.id)}','${escAttr(mediaKey)}',this,event)`
    : `openCommentsPage('${item.id}', this)`;
  // v318: game card inline comment dropdown HTML
  const gameCommentDropHtml = isGameCard ? `<div class="game-card-comment-drop" id="game-card-comments-${escAttr(item.id)}">
    <div class="game-card-comment-list" id="game-card-comment-list-${escAttr(item.id)}"></div>
    ${!viewingUser && currentUser ? `<div class="game-card-comment-input-row">
      <textarea class="game-card-comment-textarea" id="game-card-comment-ta-${escAttr(item.id)}" placeholder="Write a comment..." rows="1" onclick="event.stopPropagation()" oninput="event.stopPropagation()"></textarea>
      <button class="game-card-comment-post-btn" type="button" onclick="event.stopPropagation();postGameCardComment('${escAttr(item.id)}','${escAttr(mediaKey)}',this)">Post</button>
    </div>` : ''}
  </div>` : '';

  const dragAttrs = isDraggable
    ? `draggable="true" ondragstart="onCardDragStart(event,'${item.id}')" ondragover="onCardDragOver(event)" ondragleave="onCardDragLeave(event)" ondrop="onCardDrop(event,'${item.id}')"`
    : '';
  return `
    <div class="card ${type === "show" ? "show-card" : ""}${isGameCard ? " game-library-card" : ""} ${viewingUser ? "friend-view-card" : ""}${isDraggable ? ' card-draggable' : ''}" id="card-${item.id}" ${isGameCard ? `onclick="handleScreenListGameCardSurfaceClick(event,'${itemIdAttr}')"` : ''} ${dragAttrs}>
      <div class="card-header">
        <div class="${coverClass}${coverProfileClass}" style="${coverStyle}" ${coverPosterAttr} ${coverProfileAttrs}>
          ${!cardCoverSrc ? (isGameCard ? `<span>${SCREENLIST_GAME_COVER_PLACEHOLDER_TEXT}</span>` : emoji) : ''}
        </div>
        <div class="card-info">
          <div class="card-title-row">
            <div class="card-title">${gameTitleMarkup}</div>
            ${!viewingUser ? `<button class="delete-btn" onclick="deleteItem(event,'${item.id}')" title="Delete">×</button>` : (currentUser ? `<button class="friend-card-add-btn${friendAlreadyAdded ? ' added' : ''}" data-friend-item-id="${escHtml(item.id)}" onclick="event.stopPropagation();openFriendAddModal(this.dataset.friendItemId, this)" title="Add to my list">+</button>` : '')}
          </div>
          ${gameStatsHtml}
          ${competitiveStatsHtml}
          ${(activeTab === 'planned' && isScreenListMovieTvAnimeSection(activeSection) && item.year) ? `<div class="card-year mylist-watchlist-year">${escHtml(String(item.year).slice(0, 4))}</div>` : ''}
          ${(!shouldHideMyListCardGenre(activeSection, item) && item.genre) ? `<div class="card-genre">${escHtml(item.genre)}</div>` : ''}
          ${(() => {
            if (activeTab !== 'planned') return '';
            if (!isScreenListMovieTvAnimeSection(activeSection)) return '';
            return renderMyListWatchListAvailabilityHtml(item, activeSection);
          })()}
          ${!viewingUser ? `<div class="status-pills status-pills-selector-wrap" id="status-pills-${item.id}">${statusSelectorHtml}</div>` : ''}
          ${type === "show" ? (item.status === 'planned' ? `
            <div class="progress-area">
              <div class="progress-meta"><span id="progress-count-${item.id}">${totalEps > 0 ? `${totalEps} episodes` : 'Episodes TBD'}</span></div>
            </div>
          ` : `
            <div class="progress-area">
              <div class="progress-meta"><span id="progress-count-${item.id}">${watchedCount}/${totalEps} episodes</span><span id="progress-percent-${item.id}">${Math.round(progress)}%</span></div>
              <div class="progress-bar"><div class="progress-fill" id="progress-fill-${item.id}" style="width:${progress}%"></div></div>
            </div>
          `) : ''}
          ${item.status !== 'planned' ? `<div class="rating-area">
            <div class="rating-label">Rating</div>
            ${renderStars(item.rating || 0, item.id, 'overall', 16)}
          </div>` : ''}
          ${buildCardCommentBodyHtml(item)}
        </div>
      </div>
      <div class="card-action-row${bottomExternalBadgeHtml ? ' has-bottom-export' : ''}${watchlistPriorityHtml ? ' has-watch-priority' : ''}${nextEpisodeActionHtml ? ' has-next-episode' : ''}">
        ${nextEpisodeActionHtml}
        ${bottomExternalBadgeHtml ? `<div class="mylist-card-bottom-export">${bottomExternalBadgeHtml}</div>` : ''}
        ${watchlistPriorityHtml}
        <div class="card-footer-actions">
          ${releaseLabelForActionRow ? `<span class="card-upcoming-release-label">${escHtml(releaseLabelForActionRow)}</span>` : ''}
          ${showCommentButton ? `<button class="comments-btn" onclick="event.stopPropagation();${commentsOnclick}">
            <span class="comments-btn-label">Comments (<span class="comment-count" data-media-key="${escAttr(mediaKey)}">${commentCount}</span>)</span>
          </button>` : ''}
        </div>
        <div class="card-right-controls">
          ${episodeToggleButton}
          ${renderWatchTogetherCardControl(item, activeSection)}
          ${buildCardCommentAddBtnHtml(item)}
        </div>
      </div>
      ${gameCommentDropHtml}
      ${isGameCard ? renderGameDetailsPanel(item) : ''}
      ${item.shelfdActivityNote ? `<div class="card-activity-note" data-card-activity-note>${escHtml(item.shelfdActivityNote)}</div>` : ''}
      ${episodeSection}
      ${isGameCard && !viewingUser && !screenlistGameDetailsEditState[gameDetailsKey] ? `<button class="game-card-edit-btn" type="button" onclick="event.stopPropagation();openGameDetailsEdit('${gameDetailsKey}')" aria-label="Edit game details">${getScreenListGamePencilSvg()}</button>` : ''}
    </div>
  `;
}

function cleanSeasonDisplayName(rawName = '', seasonNum = '') {
  let name = String(rawName || '').trim();
  const num = String(seasonNum || '').trim();
  if (!name || !num || name === num || new RegExp(`^season\s*${num}$`, 'i').test(name)) return '';
  name = name
    .replace(new RegExp(`^season\s*${num}\s*[-:—–]?\s*`, 'i'), '')
    .replace(new RegExp(`^.*?season\s*${num}\s*[-:—–]?\s*`, 'i'), '')
    .trim();
  if (!name || name === num || new RegExp(`^season\s*${num}$`, 'i').test(name)) return '';
  return name;
}

function getSeasonDisplayNameForEpisodes(item = {}, seasonNum = '', seasonEpisodes = []) {
  const num = String(seasonNum || '').trim();
  const candidates = [];
  if (item.seasonNames) {
    candidates.push(item.seasonNames[num], item.seasonNames[Number(num)]);
  }
  if (item.seasonTitles) {
    candidates.push(item.seasonTitles[num], item.seasonTitles[Number(num)]);
  }
  if (Array.isArray(item.seasonsInfo)) {
    const found = item.seasonsInfo.find(s => String(s?.seasonNum || s?.season_number || s?.number || '') === num);
    candidates.push(found?.name, found?.title);
  }
  if (Array.isArray(item.animeSeasonItems)) {
    const found = item.animeSeasonItems.find(s => String(s?.seasonNum || s?.season_number || s?.number || '') === num);
    candidates.push(found?.name, found?.title);
  }
  const epWithName = seasonEpisodes.find(ep => ep && (ep.seasonName || ep.seasonTitle));
  candidates.push(epWithName?.seasonName, epWithName?.seasonTitle);
  for (const candidate of candidates) {
    const cleaned = cleanSeasonDisplayName(candidate, num);
    if (cleaned) return cleaned;
  }
  return '';
}


const seasonPosterHydrationInFlight = new Set();

function getSeasonInfoForEpisodes(item = {}, seasonNum = '') {
  const num = String(seasonNum || '').trim();
  const pools = [item.seasonsInfo, item.animeSeasonItems].filter(Array.isArray);
  for (const pool of pools) {
    const found = pool.find(s => String(s?.seasonNum || s?.season_number || s?.number || '') === num);
    if (found) return found;
  }
  return null;
}

function normalizeSeasonPosterUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(data:|blob:)/i.test(raw)) return raw;
  return normalizeMyListPosterUrl(raw);
}

function getSeasonPosterForEpisodes(item = {}, seasonNum = '', seasonEpisodes = []) {
  const num = String(seasonNum || '').trim();
  const info = getSeasonInfoForEpisodes(item, num) || {};
  const posterMaps = [item.seasonPosters, item.seasonPosterMap, item.seasonCovers].filter(Boolean);
  const mapped = posterMaps.flatMap(map => [map?.[num], map?.[Number(num)]]);
  const epWithCover = (seasonEpisodes || []).find(ep => ep && (ep.cover || ep.seasonCover || ep.poster));
  const candidates = [
    ...mapped,
    info.cover,
    info.poster,
    info.posterUrl,
    info.poster_path,
    info.image,
    epWithCover?.cover,
    epWithCover?.seasonCover,
    epWithCover?.poster
  ];
  for (const candidate of candidates) {
    const poster = normalizeSeasonPosterUrl(candidate);
    if (poster) return poster;
  }
  return '';
}

function getSeasonYearForEpisodes(item = {}, seasonNum = '') {
  const info = getSeasonInfoForEpisodes(item, seasonNum) || {};
  const value = String(info.airDate || info.air_date || info.releaseDate || '').trim();
  const year = value.match(/^(18|19|20)\d{2}/)?.[0] || '';
  return year;
}

function upsertSeasonInfo(item = {}, seasonNum = '', patch = {}) {
  if (!item || !seasonNum) return;
  item.seasonsInfo = Array.isArray(item.seasonsInfo) ? item.seasonsInfo : [];
  const num = Number(seasonNum);
  const key = String(seasonNum);
  let existing = item.seasonsInfo.find(s => String(s?.seasonNum || s?.season_number || s?.number || '') === key);
  if (!existing) {
    existing = { seasonNum: num, season_number: num };
    item.seasonsInfo.push(existing);
  }
  Object.assign(existing, patch, { seasonNum: num, season_number: num });
}

function updateSeasonPosterElement(item = {}, seasonNum = '') {
  const seasonEpisodes = (item.episodes || []).filter(ep => String(ep.seasonNum || '') === String(seasonNum || ''));
  const poster = getSeasonPosterForEpisodes(item, seasonNum, seasonEpisodes);
  const itemKey = String(item.id || '');
  const seasonKey = String(seasonNum || '');
  const nodes = Array.from(document.querySelectorAll('[data-season-poster-item][data-season-poster-num]'))
    .filter(node => node.dataset.seasonPosterItem === itemKey && node.dataset.seasonPosterNum === seasonKey);
  nodes.forEach(node => {
    node.classList.toggle('season-poster-empty', !poster);
    if (poster) node.style.backgroundImage = `url("${poster.replace(/"/g, '%22')}")`;
    else node.style.backgroundImage = '';
  });
}

async function hydrateMissingSeasonPosters(itemId = '', section = activeSection) {
  if (!isShowSection(section) || !currentUser || viewingUser) return;
  const list = Array.isArray(data?.[section]) ? data[section] : [];
  const item = list.find(row => String(row.id || '') === String(itemId || ''));
  const tmdbId = String(item?.tmdbId || '').trim();
  const episodes = Array.isArray(item?.episodes) ? item.episodes : [];
  if (!item || !tmdbId || !episodes.length) return;
  const seasonNums = [...new Set(episodes.map(ep => Number(ep.seasonNum || 0)).filter(num => num > 0))];
  if (!seasonNums.length) return;
  const needsPoster = seasonNums.some(num => !getSeasonPosterForEpisodes(item, num, episodes.filter(ep => Number(ep.seasonNum || 0) === num)));
  if (!needsPoster) return;
  const key = `${section}:${item.id}:${tmdbId}`;
  if (seasonPosterHydrationInFlight.has(key)) return;
  seasonPosterHydrationInFlight.add(key);
  try {
    let detailSeasons = [];
    try {
      const detailRes = await fetchTmdbProxy(`tv/${encodeURIComponent(tmdbId)}`);
      const detailData = await detailRes.json();
      detailSeasons = Array.isArray(detailData?.seasons) ? detailData.seasons : [];
    } catch (error) {}
    let changed = false;
    for (const seasonNum of seasonNums) {
      const seasonEpisodes = episodes.filter(ep => Number(ep.seasonNum || 0) === seasonNum);
      if (getSeasonPosterForEpisodes(item, seasonNum, seasonEpisodes)) continue;
      const meta = detailSeasons.find(s => Number(s?.season_number || 0) === seasonNum) || {};
      let poster = normalizeSeasonPosterUrl(meta.poster_path || meta.cover || '');
      let name = meta.name || '';
      let airDate = meta.air_date || '';
      if (!poster) {
        try {
          const seasonRes = await fetchTmdbProxy(`tv/${encodeURIComponent(tmdbId)}/season/${seasonNum}`);
          const seasonData = await seasonRes.json();
          poster = normalizeSeasonPosterUrl(seasonData?.poster_path || '');
          name = seasonData?.name || name;
          airDate = seasonData?.air_date || airDate;
        } catch (error) {}
      }
      if (!poster) continue;
      upsertSeasonInfo(item, seasonNum, {
        name: name || `Season ${seasonNum}`,
        title: name || `Season ${seasonNum}`,
        cover: poster,
        airDate,
        episodeCount: seasonEpisodes.length
      });
      seasonEpisodes.forEach(ep => {
        if (!ep.cover) ep.cover = poster;
      });
      updateSeasonPosterElement(item, seasonNum);
      changed = true;
    }
    if (changed) save();
  } catch (error) {
    console.warn('Season poster hydration failed:', error);
  } finally {
    seasonPosterHydrationInFlight.delete(key);
  }
}

// v451: Anime synthetic-episode helpers ────────────────────────────────────
// MAL-imported anime have `episodes = []` but keep `totalEpisodes` and
// `currentEp`. To restore the Show Episodes dropdown for those titles without
// touching storage on render, generate a transient synthetic episode list (the
// first N episodes pre-marked watched based on currentEp). On any per-episode
// interaction the synthetic list is materialised into `item.episodes` (see
// hydrateAnimeEpisodesIfSynthetic) and the bulkImportCompact opt-out is set so
// compactImportedAnimeForStorage no longer strips the rows.
function getRenderableEpisodes(item) {
  const eps = Array.isArray(item?.episodes) ? item.episodes : [];
  if (eps.length > 0) return eps;
  if (activeSection !== 'anime') return eps;
  const total = Number(item?.totalEpisodes || item?.totalEps || 0);
  if (!total) return eps;
  const watched = Math.max(0, Math.min(total, Number(item.currentEp || item.watchedEpisodes || 0)));
  const synthetic = [];
  for (let i = 1; i <= total; i++) {
    synthetic.push({
      id: item.id + '-ep-' + i,
      number: i,
      title: '',
      watched: i <= watched,
      rating: 0,
      _synthetic: true,
    });
  }
  return synthetic;
}

function hydrateAnimeEpisodesIfSynthetic(item) {
  if (!item) return false;
  if (Array.isArray(item.episodes) && item.episodes.length > 0) return false;
  const total = Number(item.totalEpisodes || item.totalEps || 0);
  if (!total) return false;
  const watched = Math.max(0, Math.min(total, Number(item.currentEp || item.watchedEpisodes || 0)));
  const list = [];
  for (let i = 1; i <= total; i++) {
    list.push({
      id: item.id + '-ep-' + i,
      number: i,
      title: '',
      watched: i <= watched,
      rating: 0,
    });
  }
  item.episodes = list;
  item.totalEpisodes = total;
  item.totalEps = total;
  item.preserveEpisodes = true;
  item.bulkImportCompact = false;
  return true;
}

/* v799: Lazy Jikan-backed episode-title hydration for MAL-imported anime.
   Existing MAL items have no per-episode titles — getRenderableEpisodes()
   synthesises numbered episodes only, which read as "broken/number-only"
   data in Show Episodes. This function fetches the real episode list from
   Jikan (/anime/{mal_id}/episodes) and merges titles into the item, then
   re-renders the open episode list. Idempotent per session via
   _jikanEpisodesHydratedAt; respects per-episode watched/rating state. */
const screenListJikanEpisodeHydrationInflight = new Set();
async function hydrateAnimeEpisodeTitlesFromJikan(item, options = {}) {
  if (!item || typeof item !== 'object') return false;
  const section = item.librarySection || item.mediaCategory || activeSection;
  if (section !== 'anime') return false;
  const malId = String(item.malId || item.mal_id || '').trim();
  if (!malId) return false;
  if (!options.force && item._jikanEpisodesHydratedAt) return false;
  if (screenListJikanEpisodeHydrationInflight.has(malId + ':' + item.id)) return false;
  if (!window.JikanAnime || typeof window.JikanAnime.animeEpisodes !== 'function') return false;
  screenListJikanEpisodeHydrationInflight.add(malId + ':' + item.id);
  try {
    const jikanEps = await window.JikanAnime.animeEpisodes(malId);
    if (!Array.isArray(jikanEps) || !jikanEps.length) return false;
    const titleByNum = new Map();
    let maxEpNum = 0;
    jikanEps.forEach(ep => {
      const n = Number(ep?.number || 0);
      if (!n) return;
      if (n > maxEpNum) maxEpNum = n;
      const title = String(ep?.title || ep?.titleRomanji || ep?.titleJapanese || '').trim();
      if (title) titleByNum.set(n, title);
    });
    if (!maxEpNum) return false;

    // If item has no totalEpisodes (older import), derive from Jikan.
    const currentTotal = Number(item.totalEpisodes || item.totalEps || 0);
    if (!currentTotal) {
      item.totalEpisodes = maxEpNum;
      item.totalEps = maxEpNum;
    }

    // Materialise synthetic list if not already (so titles persist).
    if (!Array.isArray(item.episodes) || item.episodes.length === 0) {
      hydrateAnimeEpisodesIfSynthetic(item);
    }
    const list = Array.isArray(item.episodes) ? item.episodes : [];
    let changed = false;
    list.forEach(ep => {
      if (!ep || typeof ep !== 'object') return;
      const n = Number(ep.number || ep.epNum || 0);
      if (!n) return;
      const next = titleByNum.get(n);
      if (next && !String(ep.title || '').trim()) {
        ep.title = next;
        changed = true;
      }
    });
    if (!changed) return false;

    item.preserveEpisodes = true;
    item.bulkImportCompact = false;
    item._jikanEpisodesHydratedAt = new Date().toISOString();

    // Re-render the open episode list so titles appear immediately.
    const epScroll = document.querySelector('#ep-list-' + item.id + ' .ep-scroll');
    if (epScroll) epScroll.innerHTML = renderEpisodeList(item);

    // Persist to storage (non-blocking).
    try {
      if (typeof save === 'function' && currentUser && !viewingUser) save();
    } catch (e) { /* ignore */ }
    return true;
  } catch (error) {
    console.warn('[v799] Jikan episode hydration failed:', error);
    return false;
  } finally {
    screenListJikanEpisodeHydrationInflight.delete(malId + ':' + item.id);
  }
}

function renderEpisodeList(item) {
  const eps = getRenderableEpisodes(item);
  const hasSeasons = eps.some(e => e.seasonNum);
  if (!hasSeasons || new Set(eps.map(e => e.seasonNum)).size <= 1) {
    // No season data or single season: flat list
    return eps.map(ep => renderSingleEp(item.id, ep)).join("");
  }
  // Group by season
  const seasons = {};
  eps.forEach(ep => {
    const s = ep.seasonNum || 1;
    if (!seasons[s]) seasons[s] = [];
    seasons[s].push(ep);
  });
  return Object.keys(seasons).sort((a,b) => a - b).map(sNum => {
    const sEps = seasons[sNum];
    const sWatched = sEps.filter(e => e.watched).length;
    const seasonName = getSeasonDisplayNameForEpisodes(item, sNum, sEps);
    const seasonPoster = getSeasonPosterForEpisodes(item, sNum, sEps);
    const seasonYear = getSeasonYearForEpisodes(item, sNum);
    const seasonRating = item.seasonRatings && item.seasonRatings[sNum];
    return `<div class="season-block">
      <div class="season-header" onclick="toggleSeason('${item.id}',${sNum})">
        <div class="season-poster${seasonPoster ? '' : ' season-poster-empty'}" data-season-poster-item="${escAttr(item.id)}" data-season-poster-num="${escAttr(sNum)}" ${seasonPoster ? `style="background-image:url(&quot;${escAttr(seasonPoster)}&quot;)"` : ''} aria-hidden="true"></div>
        <div class="season-header-left">
          <div class="season-title-line">
            <span class="season-arrow" id="s-arrow-${item.id}-${sNum}">▼</span>
            <span class="season-title">Season ${sNum}${seasonName ? `: ${escHtml(seasonName)}` : ''}</span>
            ${seasonYear ? `<span class="season-year">${escHtml(seasonYear)}</span>` : ''}
          </div>
          <span class="season-progress" id="season-progress-${item.id}-${sNum}">(${sWatched}/${sEps.length})</span>
          ${seasonRating ? `<span class="season-rating-chip">★ ${formatRatingValueForSection(seasonRating, activeSection)}</span>` : ''}
        </div>
        ${!viewingUser ? `<div class="season-header-right"><span class="season-card-kicker">Episodes</span><button type="button" class="edit-ep-link season-mark-btn" data-mylist-action="mark-season-eps" data-mylist-item-id="${item.id}" data-mylist-season-num="${sNum}" data-mylist-mark-value="${sWatched < sEps.length}" onclick="event.stopPropagation();markSeasonEps('${item.id}',${sNum},${sWatched < sEps.length})">
          ${sWatched < sEps.length ? 'Mark all' : 'Clear all'}
        </button></div>` : ''}
      </div>
      <div class="season-body" id="s-eps-${item.id}-${sNum}" style="display:none">
        <div class="season-rating-bar">
          <span class="season-rating-label">Season Rating</span>
          ${renderStars((item.seasonRatings && item.seasonRatings[sNum]) || 0, item.id, 'season:' + sNum, 14)}
        </div>
        <div class="season-eps">
          ${sEps.map(ep => renderSingleEp(item.id, ep)).join("")}
        </div>
      </div>
    </div>`;
  }).join("");
}

function renderSingleEp(itemId, ep) {
  if (!ep.id) ep.id = itemId + '-ep-' + (ep.seasonNum ? ep.seasonNum + '-' : '') + (ep.epNum || ep.number || Math.random().toString(36).slice(2, 7));
  const r = ep.rating || 0;
  if (viewingUser) {
    return `<div class="ep-row ${ep.watched ? 'watched-ep' : ''}">
      <div class="ep-left">
        <span class="ep-check ${ep.watched ? 'checked' : ''}" style="cursor:default;">
          ${ep.watched ? '✓' : ''}
        </span>
        <span class="ep-name">${ep.epNum || ep.number}${ep.title ? '. ' + escHtml(ep.title) : ''}</span>
      </div>
      <span class="ep-rating-btn ${r ? 'has-rating' : ''}" style="cursor:default;">
        ★${r ? ' ' + formatRatingValueForSection(r, activeSection) : ''}
      </span>
    </div>`;
  }
  return `<div class="ep-row ${ep.watched ? 'watched-ep' : ''}" id="ep-row-${ep.id}">
    <div class="ep-left">
      <button type="button" class="ep-check ${ep.watched ? 'checked' : ''}" data-mylist-action="toggle-ep" data-mylist-item-id="${itemId}" data-mylist-episode-id="${ep.id}" onclick="toggleEp('${itemId}','${ep.id}')">
        ${ep.watched ? '✓' : ''}
      </button>
      <span class="ep-name">${ep.epNum || ep.number}${ep.title ? '. ' + escHtml(ep.title) : ''}</span>
    </div>
    <button type="button" class="ep-rating-btn ${r ? 'has-rating' : ''}" onclick="event.stopPropagation();openEpRating('${itemId}','${ep.id}')">
      ★${r ? ' ' + formatRatingValueForSection(r, activeSection) : ''}
    </button>
  </div>`;
}

// Episode rating popup
let activePopup = null;

function buildPopupRatingButtons(currentRating, itemId, epId, section) {
  const stepCount = getRatingStepCountForSection(section);
  const classes = ['stars', 'ep-rating-popup-stars'];
  if (stepCount === 5) classes.push('rating-scale-five');
  let html = `<div class="${classes.join(' ')}" data-section="${section}" style="--star-size:16px;">`;
  if (stepCount === 5) {
    for (let star = 1; star <= 5; star++) {
      const leftVal = star * 2 - 1;
      const rightVal = star * 2;
      html += `<button class="star-btn half-step left ${leftVal <= currentRating ? 'lit' : ''}" data-star="${leftVal}" onclick="event.stopPropagation();rateEpPopup('${itemId}','${epId}',${leftVal})" onmouseenter="hoverStars(this,${leftVal})" onmouseleave="unhoverStars(this,${currentRating})">★</button>`;
      html += `<button class="star-btn half-step right ${rightVal <= currentRating ? 'lit' : ''}" data-star="${rightVal}" onclick="event.stopPropagation();rateEpPopup('${itemId}','${epId}',${rightVal})" onmouseenter="hoverStars(this,${rightVal})" onmouseleave="unhoverStars(this,${currentRating})">★</button>`;
    }
  } else {
    for (let s = 1; s <= 10; s++) {
      html += `<button class="star-btn ${s <= currentRating ? 'lit' : ''}" data-star="${s}" onclick="event.stopPropagation();rateEpPopup('${itemId}','${epId}',${s})" onmouseenter="hoverStars(this,${s})" onmouseleave="unhoverStars(this,${currentRating})">★</button>`;
    }
  }
  if (currentRating > 0) html += `<span class="star-label">${formatRatingValueForSection(currentRating, section)}</span>`;
  html += `</div>`;
  return html;
}

function openEpRating(itemId, epId) {
  closeEpRating();
  const row = document.getElementById('ep-row-' + epId);
  if (!row) return;
  const item = data[activeSection].find(i => i.id === itemId);
  const ep = item ? (item.episodes || []).find(e => e.id === epId) : null;
  const currentRating = ep ? (ep.rating || 0) : 0;
  const popup = document.createElement('div');
  popup.className = 'ep-rating-popup';
  popup.id = 'ep-rating-popup';
  popup.dataset.itemId = itemId;
  popup.dataset.epId = epId;
  popup.dataset.hovered = '0';
  popup.dataset.section = activeSection;
  let html = buildPopupRatingButtons(currentRating, itemId, epId, activeSection);
  if (currentRating > 0) {
    html += `<button style="background:none;border:none;color:#7a6f99;font-size:11px;cursor:pointer;margin-left:4px;" onclick="event.stopPropagation();rateEpPopup('${itemId}','${epId}',0)">✕</button>`;
  }
  popup.innerHTML = html;
  // Touch scrub support
  popup.addEventListener('touchmove', function(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (el && el.dataset && el.dataset.star) {
      const val = parseInt(el.dataset.star);
      popup.dataset.hovered = val;
      popup.querySelectorAll('.star-btn').forEach((b, i) => {
        b.style.color = (i + 1) <= val ? '#f59e0b' : '#443d60';
        b.style.transform = (i + 1) <= val ? 'scale(1.2)' : 'scale(1)';
      });
    }
  }, { passive: false });
  popup.addEventListener('touchend', function(e) {
    const val = parseInt(popup.dataset.hovered);
    if (val > 0) {
      rateEpPopup(popup.dataset.itemId, popup.dataset.epId, val);
    }
  });
  row.appendChild(popup);
  activePopup = popup;
  setTimeout(() => document.addEventListener('click', closeEpRating, { once: true }), 10);
}

function closeEpRating() {
  const popup = document.getElementById('ep-rating-popup');
  if (popup) popup.remove();
  activePopup = null;
}

function rateEpPopup(itemId, epId, score) {
  const item = data[activeSection].find(i => i.id === itemId);
  if (!item) return;
  // v451: materialise synthetic anime episodes so a star rating sticks.
  if (typeof hydrateAnimeEpisodesIfSynthetic === 'function') hydrateAnimeEpisodesIfSynthetic(item);
  const ep = (item.episodes || []).find(e => e.id === epId);
  if (!ep) return;
  preserveEpisodeScroll(itemId, () => {
    ep.rating = (ep.rating === score && score !== 0) ? 0 : score;
    /* v554: track the most recent episode rating on the item so the
       activity feed's merged "watched + rated" card can show it as
       "EP rated ★ N" without ambiguity. Cleared when score becomes 0. */
    if (Number(ep.rating) > 0) {
      item.lastEpisodeRatingValue = Number(ep.rating);
      item.lastEpisodeRatingAt = new Date().toISOString();
      item.lastEpisodeRatingEpId = String(epId || '');
    }
    if (typeof markOwnItemLastEdited === 'function') markOwnItemLastEdited(item, activeSection);
    closeEpRating();
    save(); render();
  });
  // Confirmation animation on the episode's rating button — single shadow, GPU-friendly
  if (score > 0) {
    const t = Math.pow(score / 10, 1.3);
    const peakScale = 1.25 + t * 0.5;
    const glow = 5 + t * 13;
    const glowAlpha = 0.55 + t * 0.45;
    const glowR = Math.round(251 - t * 15);
    const glowG = Math.round(191 - t * 119);
    const glowB = Math.round(36 + t * 117);
    const peakFilter = `drop-shadow(0 0 ${glow}px rgba(${glowR},${glowG},${glowB},${glowAlpha}))`;

    requestAnimationFrame(() => {
      const row = document.getElementById('ep-row-' + epId);
      const btn = row && row.querySelector('.ep-rating-btn');
      if (!btn) return;
      btn.style.willChange = 'transform, filter';
      const anim = btn.animate([
        { transform: 'scale(1)', filter: 'none' },
        { transform: `scale(${peakScale})`, filter: peakFilter, offset: 0.4 },
        { transform: 'scale(1)', filter: 'none' }
      ], { duration: 400 + t * 220, easing: 'ease-out' });
      anim.onfinish = () => { btn.style.willChange = ''; };
      if (score === 10) spawnPerfectBurst(btn);
    });
  }
}

// v446: helpers for focused-season mode ──────────────────────────────────────
// When a season opens, we switch the dropdown into a "focused" state so only
// the selected season is visible and only its episode list scrolls.
// Other season blocks are kept in layout (opacity:0, not display:none) to
// prevent the ResizeObserver from triggering a card-height change / shake.
function shelfdEnterSeasonFocusMode(itemId, sNum, epScroll, seasonBlock) {
  if (!epScroll || !seasonBlock) return;
  // Snap the scroll precisely so the season header is flush at the top of
  // ep-scroll before we hand control to the flex layout below.
  const header = seasonBlock.querySelector('.season-header');
  if (header) {
    const delta = header.getBoundingClientRect().top - epScroll.getBoundingClientRect().top;
    if (Math.abs(delta) > 1) epScroll.scrollTop = Math.max(0, epScroll.scrollTop + delta);
  }
  epScroll.classList.add('ep-season-focused');
  epScroll.dataset.shelfdFocusedSeason = String(sNum);
  seasonBlock.classList.add('ep-season-active-block');
  // v450: switch the .ep-list to a fixed-height flex host so the .season-eps
  // inside has a real bounded scroll context. Disable the ResizeObserver while
  // focused — the flex layout owns the height, the observer would fight it.
  const epList = document.getElementById('ep-list-' + itemId);
  if (epList) {
    if (epList._episodesResizeObserver) {
      try { epList._episodesResizeObserver.disconnect(); } catch (e) {}
      epList._episodesResizeObserver = null;
    }
    epList.classList.add('ep-list-focused-host');
    // Use a stable pixel height matching the flex host height in CSS.
    epList.style.height = '460px';
  }
}

function shelfdExitSeasonFocusMode(itemId) {
  const epScroll = document.querySelector('#ep-list-' + itemId + ' .ep-scroll');
  if (!epScroll) return;
  const stableScrollTop = epScroll.scrollTop;
  epScroll.classList.remove('ep-season-focused');
  delete epScroll.dataset.shelfdFocusedSeason;
  document.querySelectorAll('#ep-list-' + itemId + ' .season-block.ep-season-active-block')
    .forEach(b => b.classList.remove('ep-season-active-block'));
  // v450: tear down the focused-host flex layout and restore the natural
  // height/ResizeObserver so the season list returns to normal scroll.
  const epList = document.getElementById('ep-list-' + itemId);
  if (epList) {
    epList.classList.remove('ep-list-focused-host');
    if (epList.classList.contains('open')) {
      const inner = epList.querySelector('.ep-list-inner');
      if (inner) {
        // Snap height to current natural content (no transition) so the card
        // doesn't shake while leaving focus mode.
        const prevTransition = epList.style.transition;
        epList.style.transition = 'none';
        epList.style.height = inner.scrollHeight + 'px';
        void epList.offsetHeight;
        epList.style.transition = prevTransition;
        // Re-install the resize-follower so future season opens behave normally.
        if (typeof ResizeObserver !== 'undefined') {
          const ro = new ResizeObserver(() => {
            if (!epList.classList.contains('open')) return;
            const t = epList.style.transition;
            epList.style.transition = 'none';
            epList.style.height = inner.scrollHeight + 'px';
            void epList.offsetHeight;
            epList.style.transition = t;
          });
          ro.observe(inner);
          epList._episodesResizeObserver = ro;
        }
      }
    }
  }
  requestAnimationFrame(() => {
    if (epScroll) epScroll.scrollTop = stableScrollTop;
  });
}

function toggleSeason(itemId, sNum) {
  const el = document.getElementById('s-eps-' + itemId + '-' + sNum);
  const arrow = document.getElementById('s-arrow-' + itemId + '-' + sNum);
  if (!el) return;
  const open = el.style.display !== 'none';

  if (!open) {
    // ── Opening ───────────────────────────────────────────────────────────────
    el.style.display = 'block';
    arrow.classList.add('open');
    openStates['s-' + itemId + '-' + sNum] = true;
    // Scroll selected season to the top of ep-scroll, then enter focus mode.
    requestAnimationFrame(() => {
      const epScroll = document.querySelector('#ep-list-' + itemId + ' .ep-scroll');
      const seasonBlock = el.parentElement;
      const header = seasonBlock ? seasonBlock.querySelector('.season-header') : null;
      if (!epScroll || !header) return;
      const delta = header.getBoundingClientRect().top - epScroll.getBoundingClientRect().top;
      const target = Math.max(0, epScroll.scrollTop + delta);
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        epScroll.scrollTop = target;
        shelfdEnterSeasonFocusMode(itemId, sNum, epScroll, seasonBlock);
        return;
      }
      epScroll.scrollTo({ top: target, behavior: 'smooth' });
      // Enter focus mode after the smooth scroll has settled (~380 ms is a safe
      // upper bound for iOS 'smooth' scroll; we use a rAF-double-tick at ~350 ms
      // to minimise the perceivable flash before other seasons fade out).
      setTimeout(() => {
        if (!openStates['s-' + itemId + '-' + sNum] || el.style.display === 'none') return;
        shelfdEnterSeasonFocusMode(itemId, sNum, epScroll, seasonBlock);
      }, 350);
    });
  } else {
    // ── Closing ───────────────────────────────────────────────────────────────
    shelfdExitSeasonFocusMode(itemId);
    el.style.display = 'none';
    arrow.classList.remove('open');
    openStates['s-' + itemId + '-' + sNum] = false;
  }
}

function markSeasonEps(itemId, sNum, val) {
  const item = data[activeSection].find(i => i.id === itemId);
  if (!item) return;
  preserveViewport(() => {
    preserveEpisodeScroll(itemId, () => {
      const affectedEpisodes = item.episodes.filter(e => e.seasonNum === sNum);
      item.episodes.forEach(e => { if (e.seasonNum === sNum) e.watched = val; });
      if (val) {
        markEpisodeWatchActivity(item, activeSection, { count: affectedEpisodes.length, label: `season ${sNum} watched` });
        // v553: a fully-marked season triggers the season-finished signal
        maybeMarkScreenListSeasonFinished(item, activeSection, sNum);
      }
      const statusChangedNow = applyScreenListEpisodeStatusOrDefer(item);
      if (typeof markOwnItemLastEdited === 'function') markOwnItemLastEdited(item, activeSection);
      else touchItem(item);
      save();
      if (statusChangedNow && !itemMatchesCurrentView(item)) {
        render();
        return;
      }
      item.episodes.forEach(ep => {
        if (ep.seasonNum === sNum) updateEpisodeRowState(ep);
      });
      updateCardProgressUI(item);
      updateSeasonProgressUI(item, sNum);
      updateSeasonActionLabelUI(item, sNum);
      updateStatusPillsUI(item);
    });
  });
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
function escAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function slugifyExternalGameTitle(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getGameTitleValue(gameLike = null) {
  return gameLike?.title || gameLike?.name || '';
}

function getGameSlugValue(gameLike = null) {
  return gameLike?.backloggdSlug
    || gameLike?.rawgSlug
    || gameLike?.slug
    || gameLike?.metacriticSlug
    || slugifyExternalGameTitle(getGameTitleValue(gameLike));
}

function getGameRawgIdValue(gameLike = null) {
  if (!gameLike) return '';
  if (gameLike.rawgId) return String(gameLike.rawgId);
  if (gameLike.rawg_id) return String(gameLike.rawg_id);
  if (gameLike.source === 'rawg' && gameLike.sourceId) return String(gameLike.sourceId);
  const idText = String(gameLike.id || '');
  const rawgMatch = idText.match(/(?:^|-rawg-)(\d+)(?:$|[^0-9])/);
  if (rawgMatch) return rawgMatch[1];
  return '';
}

function getBackloggdGameUrl(gameLike = null) {
  const slug = getGameSlugValue(gameLike);
  return slug ? `https://www.backloggd.com/games/${encodeURIComponent(slug)}/` : 'https://www.backloggd.com/';
}

function getMetacriticGameUrl(gameLike = null) {
  if (gameLike?.metacritic_url) return gameLike.metacritic_url;
  const slug = getGameSlugValue(gameLike);
  return slug
    ? `https://www.metacritic.com/game/${encodeURIComponent(slug)}/`
    : `https://www.metacritic.com/search/${encodeURIComponent(getGameTitleValue(gameLike))}/`;
}

function getHowLongToBeatGameUrl(gameLike = null) {
  return `https://howlongtobeat.com/?q=${encodeURIComponent(getGameTitleValue(gameLike))}`;
}

function getSteamGameUrl(gameLike = null) {
  if (gameLike?.steamUrl) return gameLike.steamUrl;
  const stores = Array.isArray(gameLike?.stores) ? gameLike.stores : [];
  const steamStore = stores.find(entry => {
    const name = String(entry?.store?.name || entry?.store?.slug || entry?.name || entry?.slug || '').toLowerCase();
    return name.includes('steam');
  });
  if (steamStore?.url) return steamStore.url;
  if (steamStore?.store?.domain) return `https://${steamStore.store.domain}`;
  return `https://store.steampowered.com/search/?term=${encodeURIComponent(getGameTitleValue(gameLike))}`;
}

const GAME_EXTERNAL_ICON_ASSETS = {
  backloggd: 'https://www.backloggd.com/favicon.ico',
  metacritic: 'https://www.metacritic.com/favicon.ico',
  hltb: 'https://howlongtobeat.com/favicon.ico',
  steam: 'https://store.steampowered.com/favicon.ico'
};

function getGameExternalIconSrc(key) {
  return GAME_EXTERNAL_ICON_ASSETS[key] || '';
}

function renderGameExternalIcon(iconKey, title, url, extraClass = '') {
  if (!url) return '';
  const iconSrc = getGameExternalIconSrc(iconKey);
  return `<a class="game-external-icon ${extraClass}" href="${escAttr(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="${escAttr(title)}" aria-label="${escAttr(title)}">${iconSrc ? `<img src="${escAttr(iconSrc)}" alt="" loading="lazy">` : ''}</a>`;
}

function renderBackloggdGameIcon(gameLike = null, extraClass = '') {
  return renderGameExternalIcon('backloggd', 'Open on Backloggd', getBackloggdGameUrl(gameLike), `game-backloggd-icon ${extraClass}`.trim());
}

function renderMetacriticGameIcon(gameLike = null, extraClass = '') {
  return renderGameExternalIcon('metacritic', 'Open on Metacritic', getMetacriticGameUrl(gameLike), `game-metacritic-icon ${extraClass}`.trim());
}

const gameMediaProfileCache = new Map();
const gameMediaProfileSeeds = new Map();

function setGameMediaProfileSeed(rawgId, seed) {
  if (!rawgId || !seed) return;
  gameMediaProfileSeeds.set(String(rawgId), { ...seed, rawgId: String(rawgId) });
}

function getGameMediaProfileSeed(rawgId, fallback = null) {
  return fallback || gameMediaProfileSeeds.get(String(rawgId || '')) || {};
}

const MEDIA_PROFILE_HERO_DURATION_MS = 400;
const MEDIA_PROFILE_HERO_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

function getMediaProfilePosterOriginElement(candidate = null) {
  if (!candidate) return null;
  const node = candidate.nodeType === 1 ? candidate : candidate.parentElement;
  if (!node || typeof node.closest !== 'function') return null;

  const discoverCard = node.closest('.discover-card');
  if (discoverCard) return discoverCard.querySelector('.discover-poster') || discoverCard;

  const libraryCard = node.closest('.card');
  if (libraryCard) return libraryCard.querySelector('.card-cover-profile-btn, .card-cover') || libraryCard;

  const activityPoster = node.closest('.activity-poster-col, .activity-poster-placeholder');
  if (activityPoster) return activityPoster;

  const favoritePoster = node.closest('.profile-fav-poster-card, .profile-db-openable');
  if (favoritePoster) return favoritePoster;

  const similarCard = node.closest('.discover-media-similar-card, .discover-ai-similar-card, .discover-person-credit-card');
  if (similarCard) return similarCard.querySelector('img') || similarCard;

  const directPoster = node.closest('.discover-poster, .card-cover-profile-btn, .card-cover, .discover-media-poster, .game-media-poster');
  return directPoster || null;
}

function getMediaProfileOriginRect(originElement = null) {
  if (!originElement || typeof originElement.getBoundingClientRect !== 'function') return null;
  const rect = originElement.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    centerX: rect.left + rect.width / 2,
    centerY: rect.top + rect.height / 2
  };
}

function getMediaProfileHeroTransformFromRect(rect) {
  const vw = window.innerWidth || document.documentElement.clientWidth || 1;
  const vh = window.innerHeight || document.documentElement.clientHeight || 1;
  const centerX = Math.max(0, Math.min(vw, rect.centerX));
  const centerY = Math.max(0, Math.min(vh, rect.centerY));
  const moveX = centerX - vw / 2;
  const moveY = centerY - vh / 2;
  const scaleX = Math.max(0.018, rect.width / vw);
  const scaleY = Math.max(0.018, rect.height / vh);
  return `translate3d(${moveX}px, ${moveY}px, 0) scale(${scaleX}, ${scaleY})`;
}

function canUseMediaProfileHeroAnimation(overlay, originRect) {
  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return !!overlay && !!originRect && !prefersReduced && typeof document.createElement('div').animate === 'function';
}

function cleanupMediaProfilePosterHero() {
  document.querySelectorAll('.screenlist-poster-hero-portal, .screenlist-poster-close-portal').forEach(hero => hero.remove());
}

function getMediaProfileVisiblePosterElement(overlay) {
  if (!overlay || typeof overlay.querySelector !== 'function') return null;
  return overlay.querySelector('.discover-media-poster img, .game-media-poster img') ||
    overlay.querySelector('.discover-media-poster, .game-media-poster');
}

function getMediaProfilePosterImageSrc(posterElement = null) {
  if (!posterElement) return '';
  if (posterElement.dataset?.poster) return posterElement.dataset.poster;
  const image = posterElement.tagName === 'IMG' ? posterElement : posterElement.querySelector?.('img');
  if (image) return image.currentSrc || image.src || image.getAttribute('src') || '';

  const candidates = [
    posterElement,
    ...(posterElement.querySelectorAll ? [...posterElement.querySelectorAll('.discover-poster-media, .card-cover, .card-cover-profile-btn, [style*=background-image]')] : [])
  ];
  for (const candidate of candidates) {
    const background = window.getComputedStyle(candidate).backgroundImage || '';
    const match = background.match(/url\(["']?(.+?)["']?\)/);
    if (match && match[1]) return match[1];
  }
  return '';
}

function getMediaProfilePosterObjectFit(posterElement = null) {
  const image = posterElement?.tagName === 'IMG' ? posterElement : posterElement?.querySelector?.('img');
  if (!image) return 'cover';
  return window.getComputedStyle(image).objectFit || 'cover';
}

function getMediaProfilePosterObjectPosition(posterElement = null) {
  const image = posterElement?.tagName === 'IMG' ? posterElement : posterElement?.querySelector?.('img');
  if (!image) return 'center';
  return window.getComputedStyle(image).objectPosition || 'center';
}

function createMediaProfilePosterClosePortal(posterElement, posterRect, targetElement = null, targetRect = null) {
  if (!posterElement || !posterRect) return null;
  const hero = document.createElement('div');
  hero.className = 'screenlist-poster-close-portal';
  const computed = window.getComputedStyle(posterElement);
  const targetComputed = targetElement ? window.getComputedStyle(targetElement) : null;
  hero.style.left = `${posterRect.left}px`;
  hero.style.top = `${posterRect.top}px`;
  hero.style.width = `${posterRect.width}px`;
  hero.style.height = `${posterRect.height}px`;
  hero.style.borderRadius = computed.borderRadius || '10px';
  hero.dataset.finalBorderRadius = targetComputed?.borderRadius || computed.borderRadius || '10px';

  // Use the visible full-screen poster as the animation source first.
  // The destination card can be offscreen, hidden, lazy-painted, or lower-res during reverse hero close.
  // Keeping the same src as a CSS background prevents the temporary portal from flashing black while the IMG paints.
  const posterSrc = getMediaProfilePosterImageSrc(posterElement);
  const targetSrc = getMediaProfilePosterImageSrc(targetElement);
  const src = posterSrc || targetSrc;
  const fitSource = posterSrc ? posterElement : targetElement || posterElement;
  if (src) {
    hero.style.backgroundImage = `url("${String(src).replace(/"/g, '\"')}")`;
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.loading = 'eager';
    img.decoding = 'sync';
    img.fetchPriority = 'high';
    img.style.objectFit = getMediaProfilePosterObjectFit(fitSource) || 'cover';
    img.style.objectPosition = getMediaProfilePosterObjectPosition(fitSource) || 'center';
    hero.appendChild(img);
  } else {
    const backgroundSource = posterElement || targetElement;
    const background = window.getComputedStyle(backgroundSource).backgroundImage;
    if (background && background !== 'none') hero.style.backgroundImage = background;
  }

  document.body.appendChild(hero);
  return hero;
}

function getMediaProfileRectTransform(fromRect, toRect) {
  if (!fromRect || !toRect || !fromRect.width || !fromRect.height) return 'translate3d(0, 0, 0) scale(1, 1)';
  const tx = toRect.left - fromRect.left;
  const ty = toRect.top - fromRect.top;
  const sx = Math.max(0.018, toRect.width / fromRect.width);
  const sy = Math.max(0.018, toRect.height / fromRect.height);
  return `translate3d(${tx}px, ${ty}px, 0) scale(${sx}, ${sy})`;
}

function clearMediaProfileHeroInlineState(overlay) {
  if (!overlay) return;
  overlay.style.transform = '';
  overlay.style.transformOrigin = '';
  overlay.style.transition = '';
  overlay.style.willChange = '';
  overlay.style.opacity = '';
  overlay.style.visibility = '';
  overlay.style.pointerEvents = '';
  overlay.style.backfaceVisibility = '';
  overlay.style.webkitBackfaceVisibility = '';
  overlay.classList.remove('media-profile-hero-animating', 'media-profile-reveal-hold', 'media-profile-hero-closing', 'media-profile-poster-only-closing');
}

function prepareMediaProfileOverlayForHero(overlay, transform) {
  overlay.classList.add('screenlist-top-level-portal', 'media-profile-hero-animating', 'open');
  overlay.classList.remove('media-profile-reveal-hold');
  overlay.style.transformOrigin = '50% 50%';
  overlay.style.transform = transform;
  overlay.style.transition = 'none';
  overlay.style.opacity = '1';
  overlay.style.visibility = 'visible';
  overlay.style.pointerEvents = 'auto';
  overlay.style.willChange = 'transform';
  overlay.style.backfaceVisibility = 'hidden';
  overlay.style.webkitBackfaceVisibility = 'hidden';
}

function finishMediaProfileHeroAnimation(animation, done) {
  let finished = false;
  const complete = () => {
    if (finished) return;
    finished = true;
    if (typeof done === 'function') done();
  };
  animation.onfinish = complete;
  animation.oncancel = complete;
  setTimeout(complete, MEDIA_PROFILE_HERO_DURATION_MS + 80);
}

function animateMediaProfileOverlayTransform(overlay, fromTransform, toTransform, done) {
  if (!overlay || typeof overlay.animate !== 'function') {
    if (typeof done === 'function') done();
    return;
  }

  prepareMediaProfileOverlayForHero(overlay, fromTransform);
  overlay.getBoundingClientRect();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!document.body.contains(overlay)) return;
      const animation = overlay.animate([
        { transform: fromTransform },
        { transform: toTransform }
      ], {
        duration: MEDIA_PROFILE_HERO_DURATION_MS,
        easing: MEDIA_PROFILE_HERO_EASING,
        fill: 'both'
      });
      finishMediaProfileHeroAnimation(animation, done);
    });
  });
}

function revealMediaProfileOverlay(overlay, transitionOrigin = null, triggerEvent = null) {
  const originElement = getMediaProfilePosterOriginElement(transitionOrigin || triggerEvent?.currentTarget || triggerEvent?.target);
  const originRect = getMediaProfileOriginRect(originElement);

  if (!canUseMediaProfileHeroAnimation(overlay, originRect)) {
    requestAnimationFrame(() => overlay?.classList.add('open'));
    return;
  }

  cleanupMediaProfilePosterHero();
  overlay.__screenListHeroOriginElement = originElement;
  overlay.__screenListHeroOriginRect = originRect;

  const startTransform = getMediaProfileHeroTransformFromRect(originRect);
  const endTransform = 'translate3d(0, 0, 0) scale(1, 1)';

  animateMediaProfileOverlayTransform(overlay, startTransform, endTransform, () => {
    if (!document.body.contains(overlay)) return;
    overlay.classList.add('open');
    clearMediaProfileHeroInlineState(overlay);
  });
}

function shouldUsePosterHeroClose(reasonOrOptions = null) {
  if (typeof reasonOrOptions === 'string') return reasonOrOptions === 'back' || reasonOrOptions === 'pull-down';
  if (reasonOrOptions && typeof reasonOrOptions === 'object') {
    return reasonOrOptions.hero === true || reasonOrOptions.heroClose === true || reasonOrOptions.reason === 'back' || reasonOrOptions.reason === 'pull-down';
  }
  return false;
}

function closeMediaProfileOverlayImmediately(overlay, afterRemove = null) {
  if (!overlay) return;
  const wasSwipeReveal = overlay.classList.contains('media-profile-swipe-revealing') || document.body.classList.contains('media-profile-swipe-reveal-active');
  if (wasSwipeReveal) {
    if (typeof afterRemove === 'function') afterRemove();
    cleanupMediaProfilePosterHero();
    clearMediaProfileHeroInlineState(overlay);
    overlay.classList.remove('open');
    overlay.remove();
    document.body.classList.remove('media-profile-swipe-reveal-active');
    return;
  }
  removeMediaProfileSwipeRevealUnderlay(overlay);
  cleanupMediaProfilePosterHero();
  clearMediaProfileHeroInlineState(overlay);
  overlay.classList.remove('open');
  overlay.remove();
  if (typeof afterRemove === 'function') afterRemove();
}

function closeMediaProfileOverlayWithPosterHero(overlay, afterRemove = null) {
  if (!overlay) return;
  removeMediaProfileSwipeRevealUnderlay(overlay);
  const originElement = overlay.__screenListHeroOriginElement || null;
  const liveOriginRect = getMediaProfileOriginRect(originElement);
  const originRect = liveOriginRect || overlay.__screenListHeroOriginRect;
  const posterElement = getMediaProfileVisiblePosterElement(overlay);
  const posterRect = getMediaProfileOriginRect(posterElement);

  if (!canUseMediaProfileHeroAnimation(overlay, originRect) || !posterElement || !posterRect) {
    overlay.classList.remove('open');
    setTimeout(() => {
      overlay.remove();
      if (typeof afterRemove === 'function') afterRemove();
    }, 180);
    return;
  }

  cleanupMediaProfilePosterHero();
  const posterHero = createMediaProfilePosterClosePortal(posterElement, posterRect, originElement, originRect);
  if (!posterHero) {
    closeMediaProfileOverlayImmediately(overlay, afterRemove);
    return;
  }

  const originalPosterVisibility = posterElement.style.visibility;
  const originalOriginVisibility = originElement?.style?.visibility || '';
  const originalOriginPointerEvents = originElement?.style?.pointerEvents || '';
  posterElement.style.visibility = 'hidden';
  if (originElement && document.body.contains(originElement)) {
    originElement.style.visibility = 'hidden';
    originElement.style.pointerEvents = 'none';
  }
  overlay.classList.add('media-profile-poster-only-closing');
  overlay.style.pointerEvents = 'none';
  overlay.style.willChange = 'opacity';
  posterHero.getBoundingClientRect();

  const restoreOriginPoster = () => {
    if (posterElement) posterElement.style.visibility = originalPosterVisibility;
    if (originElement && document.body.contains(originElement)) {
      originElement.style.visibility = originalOriginVisibility;
      originElement.style.pointerEvents = originalOriginPointerEvents;
    }
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!document.body.contains(overlay) || !document.body.contains(posterHero)) return;
      const finalBorderRadius = posterHero.dataset.finalBorderRadius || posterHero.style.borderRadius || '10px';
      const posterAnimation = posterHero.animate([
        {
          transform: 'translate3d(0, 0, 0) scale(1, 1)',
          opacity: 1,
          borderRadius: posterHero.style.borderRadius || '10px',
          boxShadow: '0 18px 48px rgba(0,0,0,0.45)'
        },
        {
          transform: getMediaProfileRectTransform(posterRect, originRect),
          opacity: 1,
          borderRadius: finalBorderRadius,
          boxShadow: '0 0 0 rgba(0,0,0,0)'
        }
      ], {
        duration: MEDIA_PROFILE_HERO_DURATION_MS,
        easing: MEDIA_PROFILE_HERO_EASING,
        fill: 'both'
      });
      const overlayFade = overlay.animate([
        { opacity: 1 },
        { opacity: 0 }
      ], {
        duration: Math.min(220, MEDIA_PROFILE_HERO_DURATION_MS),
        easing: MEDIA_PROFILE_HERO_EASING,
        fill: 'both'
      });
      finishMediaProfileHeroAnimation(posterAnimation, () => {
        overlayFade.cancel?.();
        posterHero.style.transform = 'none';
        posterHero.style.left = `${originRect.left}px`;
        posterHero.style.top = `${originRect.top}px`;
        posterHero.style.width = `${originRect.width}px`;
        posterHero.style.height = `${originRect.height}px`;
        posterHero.style.borderRadius = finalBorderRadius;
        posterHero.style.boxShadow = 'none';
        clearMediaProfileHeroInlineState(overlay);
        overlay.classList.remove('open');
        overlay.remove();
        if (typeof afterRemove === 'function') afterRemove();
        requestAnimationFrame(() => {
          restoreOriginPoster();
          requestAnimationFrame(() => {
            requestAnimationFrame(() => posterHero.remove());
          });
        });
      });
    });
  });
}

function closeMediaProfileOverlay(overlay, afterRemove = null, reasonOrOptions = null) {
  if (shouldUsePosterHeroClose(reasonOrOptions)) {
    closeMediaProfileOverlayWithPosterHero(overlay, afterRemove);
    return;
  }
  closeMediaProfileOverlayImmediately(overlay, afterRemove);
}

function closeGameMediaProfile(reasonOrOptions = null) {
  closeDiscoverMediaLibraryDock();
  const overlay = document.getElementById('discover-media-profile');
  if (!overlay) return;
  document.removeEventListener('keydown', handleGameMediaProfileEsc);
  closeMediaProfileOverlay(overlay, () => {
    document.body.classList.remove('discover-media-profile-open', 'game-media-profile-open');
    finishSharedMediaRouteAfterClose();
  }, reasonOrOptions);
}

function handleGameMediaProfileEsc(event) {
  if (event.key === 'Escape') closeGameMediaProfile('escape');
}

function getGameMediaImage(gameLike = null) {
  return typeof getScreenListPreferredGameCover === 'function'
    ? getScreenListPreferredGameCover(gameLike || {})
    : (gameLike?.igdbCoverUrl || gameLike?.cover || gameLike?.poster || gameLike?.image || gameLike?.background_image || '');
}

function formatGameReleaseDate(value) {
  return formatDiscoverMediaDate(value);
}

function renderGameMediaProfileAddButton(rawgId, details) {
  if (!currentUser && !isPreviewMode()) return '';
  const title = getGameTitleValue(details);
  const poster = getGameMediaImage(details);
  const added = isDuplicateTitle(title, 'games');
  const label = added ? getDiscoverLibraryButtonText(title, 'games') : '+ Add to Library';
  return `<button class="discover-media-add-floating${added ? ' added' : ''}" type="button" data-discover-type="game" data-discover-id="${escAttr(String(rawgId || getGameRawgIdValue(details) || ''))}" data-discover-section="games" data-discover-title="${escAttr(title)}" data-discover-poster="${escAttr(poster)}" ${added ? `title="Manage this game in your library"` : ''}>${escHtml(label)}</button>`;
}

function renderGameMediaProfileShell(seed, rawgId = '') {
  const title = getGameTitleValue(seed) || 'Game Profile';
  const poster = getGameMediaImage(seed);
  const year = String(seed?.released || seed?.year || '').slice(0, 4);
  const overview = seed?.description_raw || seed?.description || 'Loading this game profile...';
  const genres = (seed?.genres || []).map(g => g?.name).filter(Boolean).slice(0, 4);
  return `<section class="discover-media-page game-media-page discover-desktop-title-page" role="dialog" aria-modal="true" aria-label="${escAttr(title)} details">
    <button class="discover-media-back" type="button" onclick="closeGameMediaProfile('back')">Back</button>
    ${renderMediaProfileTopActions(renderMediaProfileShareButton('game', rawgId || getGameRawgIdValue(seed), title, poster), `${rawgId ? renderGameMediaProfileAddButton(rawgId, seed) : ''}${currentUser && !viewingUser ? `<button class="discover-media-add-floating screenlist-game-profile-cover-btn" type="button" onclick="event.preventDefault();event.stopPropagation();openScreenListGameCoverPickerForSeed('${escAttr(String(rawgId || getGameRawgIdValue(seed) || ''))}','${escAttr(title)}')">Change Cover</button>` : ''}`)}
    <div class="discover-media-hero game-media-hero" style="${poster ? `background-image:url('${escAttr(poster)}')` : ''}">
      <div class="discover-media-hero-shade"></div>
      <div class="discover-media-hero-content">
        <div class="discover-media-hero-top">
          <div class="discover-media-poster game-media-poster${poster ? '' : ' screenlist-game-cover-pending'}">${poster ? `<img src="${escAttr(poster)}" alt="">` : `<span>${SCREENLIST_GAME_COVER_PLACEHOLDER_TEXT}</span>`}</div>
          <div class="discover-media-hero-main">
            <div class="discover-media-kicker">Game Profile${year ? ` · ${escHtml(year)}` : ''}</div>
            <h2>${escHtml(title)}</h2>
          </div>
        </div>
        <p class="discover-media-synopsis">${escHtml(overview)}</p>
        ${genres.length ? `<div class="discover-media-chips">${genres.map(name => `<span>${escHtml(name)}</span>`).join('')}</div>` : ''}
        ${renderGameProfileFloatingExports(seed)}
      </div>
    </div>
    <div class="discover-media-body discover-media-body-cinema">
      <div class="discover-media-loading">Building this game page...</div>
    </div>
  </section>`;
}

function getGameMediaFacts(details = {}) {
  const facts = [];
  const releaseDate = formatGameReleaseDate(details.released);
  const platforms = Array.isArray(details.platforms)
    ? details.platforms.map(p => p.platform?.name || p.name).filter(Boolean).slice(0, 3).join(', ')
    : String(details.platforms || '').trim();
  const developers = (details.developers || []).map(dev => dev.name).filter(Boolean).slice(0, 2).join(', ');
  const publishers = (details.publishers || []).map(pub => pub.name).filter(Boolean).slice(0, 2).join(', ');
  if (releaseDate) facts.push({ label: 'Released', value: releaseDate, priority: true });
  if (platforms) facts.push({ label: 'Platforms', value: platforms, priority: true });
  if (details.playtime) facts.push({ label: 'Avg Playtime', value: `${details.playtime}h` });
  if (details.metacritic) facts.push({ label: 'Metacritic', value: String(details.metacritic) });
  if (developers) facts.push({ label: 'Developer', value: developers });
  if (publishers) facts.push({ label: 'Publisher', value: publishers });
  if (details.esrb_rating?.name) facts.push({ label: 'ESRB', value: details.esrb_rating.name });
  return facts.slice(0, 8);
}

function getGameMetacriticScore(details = {}) {
  const candidates = [
    details.metacritic,
    details.metacriticScore,
    details.metacritic_score
  ];
  for (const value of candidates) {
    const score = Number(value);
    if (Number.isFinite(score) && score > 0) return Math.round(score);
  }
  return null;
}

function getGameMediaCredits(details = {}) {
  const rows = [];
  const developers = (details.developers || []).map(dev => dev.name).filter(Boolean).slice(0, 3);
  const publishers = (details.publishers || []).map(pub => pub.name).filter(Boolean).slice(0, 3);
  const website = String(details.website || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (developers.length) rows.push({ label: 'Developed By', value: developers.join(', ') });
  if (publishers.length) rows.push({ label: 'Published By', value: publishers.join(', ') });
  if (website) rows.push({ label: 'Official Site', value: website });
  return rows;
}

function getGameMediaTrailer(details = {}) {
  const clip = details?.clip || {};
  const directCandidates = [
    clip.clip,
    clip.video,
    clip?.clips?.full,
    clip?.clips?.max,
    clip?.clips?.['640'],
    clip?.clips?.['320']
  ];
  const url = directCandidates.find(value => typeof value === 'string' && /^https?:\/\//i.test(value));
  if (!url) return null;
  return {
    url,
    poster: typeof clip.preview === 'string' ? clip.preview : ''
  };
}

function renderExternalLinkLabelWithLogo(title, logoUrl = '') {
  return `<small class="game-media-external-link-label"><span>${escHtml(title)}</span></small>`;
}

function renderGameMediaExternalLinks(details = {}) {
  const links = [
    { key: 'backloggd', title: 'Backloggd', url: getBackloggdGameUrl(details), className: 'backloggd' },
    { key: 'metacritic', title: 'Metacritic', url: getMetacriticGameUrl(details), className: 'metacritic' },
    { key: 'hltb', title: 'HowLongToBeat', url: getHowLongToBeatGameUrl(details), className: 'hltb' },
    { key: 'steam', title: 'Steam', url: getSteamGameUrl(details), className: 'steam' }
  ];
  return `<div class="game-media-external-links" aria-label="Game external links">
    ${links.map(link => {
      const iconSrc = getGameExternalIconSrc(link.key);
      return `<a class="game-media-external-link ${link.className}" href="${escAttr(link.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" aria-label="${escAttr(link.title)}" title="${escAttr(link.title)}"><span class="game-media-external-link-icon">${iconSrc ? `<img src="${escAttr(iconSrc)}" alt="" loading="lazy">` : ''}</span>${renderExternalLinkLabelWithLogo(link.title, iconSrc)}</a>`;
    }).join('')}
  </div>`;
}

function getImdbMediaUrl(details = {}) {
  const imdbId = details.imdb_id || details.external_ids?.imdb_id || '';
  return imdbId ? `https://www.imdb.com/title/${imdbId}/` : 'https://www.imdb.com/';
}

function getMyAnimeListUrl(details = {}) {
  // MyAnimeList doesn't have a direct TMDB->MAL mapping, so we'll search by title
  const title = details.title || details.name || '';
  return title ? `https://myanimelist.net/search/all?q=${encodeURIComponent(title)}` : 'https://myanimelist.net/';
}

function renderMediaExternalLinks(type, details = {}) {
  return renderMediaProfileFloatingExports(type, details);
}

const PROFILE_EXPORT_LOGO_ASSETS = {
  imdb: 'https://www.google.com/s2/favicons?domain=imdb.com&sz=128',
  letterboxd: 'https://www.google.com/s2/favicons?domain=letterboxd.com&sz=128',
  myanimelist: 'https://www.google.com/s2/favicons?domain=myanimelist.net&sz=128',
  steam: 'https://www.google.com/s2/favicons?domain=store.steampowered.com&sz=128',
  backloggd: 'https://www.google.com/s2/favicons?domain=backloggd.com&sz=128',
  metacritic: 'https://www.google.com/s2/favicons?domain=metacritic.com&sz=128',
  hltb: 'https://www.google.com/s2/favicons?domain=howlongtobeat.com&sz=128'
};

function renderProfileFloatingExportLinks(links = [], label = 'Export links') {
  const safeLinks = links.filter(link => link?.url && link?.title);
  if (!safeLinks.length) return '';
  return `<nav class="media-profile-floating-exports" aria-label="${escAttr(label)}">
    ${safeLinks.map(link => `<a class="media-profile-floating-export ${escAttr(link.className || link.key || '')}" href="${escAttr(link.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" aria-label="Open ${escAttr(link.title)}" title="Open ${escAttr(link.title)}"><span class="media-profile-floating-export-icon">${link.logo ? `<img src="${escAttr(link.logo)}" alt="" loading="lazy" decoding="async">` : ''}</span><small>${escHtml(link.title)}</small></a>`).join('')}
  </nav>`;
}

function isAnimeMediaProfile(type, details = {}) {
  if (details?.mediaCategory === 'anime' || details?.librarySection === 'anime' || details?.isAnime) return true;
  if (activeDiscoveryHub === 'anime' && type === 'tv') return true;
  return type === 'tv' && isAnimeDiscoverCandidate(details);
}

function renderMediaProfileFloatingExports(type, details = {}) {
  if (isAnimeMediaProfile(type, details)) {
    return renderProfileFloatingExportLinks([
      { key: 'myanimelist', title: 'MyAnimeList', url: getMyAnimeListUrl(details), className: 'myanimelist', logo: PROFILE_EXPORT_LOGO_ASSETS.myanimelist },
      { key: 'imdb', title: 'IMDb', url: getImdbMediaUrl(details), className: 'imdb', logo: PROFILE_EXPORT_LOGO_ASSETS.imdb }
    ], 'Anime export links');
  }

  return renderProfileFloatingExportLinks([
    { key: 'imdb', title: 'IMDb', url: getImdbMediaUrl(details), className: 'imdb', logo: PROFILE_EXPORT_LOGO_ASSETS.imdb }
  ], `${type === 'tv' ? 'TV show' : 'Movie'} export links`);
}

function renderGameProfileFloatingExports(details = {}) {
  return renderProfileFloatingExportLinks([
    { key: 'steam', title: 'Steam', url: getSteamGameUrl(details), className: 'steam', logo: PROFILE_EXPORT_LOGO_ASSETS.steam },
    { key: 'backloggd', title: 'Backloggd', url: getBackloggdGameUrl(details), className: 'backloggd', logo: PROFILE_EXPORT_LOGO_ASSETS.backloggd },
    { key: 'metacritic', title: 'Metacritic', url: getMetacriticGameUrl(details), className: 'metacritic', logo: PROFILE_EXPORT_LOGO_ASSETS.metacritic },
    { key: 'hltb', title: 'HowLongToBeat', url: getHowLongToBeatGameUrl(details), className: 'hltb', logo: PROFILE_EXPORT_LOGO_ASSETS.hltb }
  ], 'Game export links');
}

const mediaProviderLogoCache = new Map();
const MEDIA_PROVIDER_DOMAIN_MAP = {
  'netflix': 'netflix.com',
  'hulu': 'hulu.com',
  'disney plus': 'disneyplus.com',
  'disney+': 'disneyplus.com',
  'max': 'max.com',
  'hbo max': 'max.com',
  'prime video': 'primevideo.com',
  'amazon prime video': 'primevideo.com',
  'amazon video': 'amazon.com',
  'apple tv': 'tv.apple.com',
  'apple tv+': 'tv.apple.com',
  'paramount plus': 'paramountplus.com',
  'paramount+': 'paramountplus.com',
  'peacock': 'peacocktv.com',
  'crunchyroll': 'crunchyroll.com',
  'youtube': 'youtube.com',
  'youtube premium': 'youtube.com',
  'tubi': 'tubitv.com',
  'pluto tv': 'pluto.tv',
  'roku channel': 'therokuchannel.roku.com',
  'the roku channel': 'therokuchannel.roku.com',
  'starz': 'starz.com',
  'showtime': 'showtime.com',
  'fandango at home': 'fandangoathome.com',
  'vudu': 'vudu.com',
  'mubi': 'mubi.com',
  'criterion channel': 'criterionchannel.com',
  'the criterion channel': 'criterionchannel.com',
  'kanopy': 'kanopy.com',
  'hoopla': 'hoopladigital.com'
};

function normalizeProviderName(value = '') {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeMediaProviderLogoUrl(provider = {}) {
  if (!provider || typeof provider !== 'object') return '';
  const direct = String(provider.logoUrl || provider.logo_url || provider.iconUrl || provider.icon_url || provider.logo || provider.icon || '').trim();
  if (/^https?:\/\//i.test(direct)) return direct;
  const logoPath = String(provider.logo_path || provider.logoPath || '').trim();
  if (/^https?:\/\//i.test(logoPath)) return logoPath;
  if (logoPath) return `https://image.tmdb.org/t/p/w92${logoPath.startsWith('/') ? logoPath : `/${logoPath}`}`;
  return '';
}

function getMediaProviderDomain(provider = {}) {
  const rawDomain = String(provider.domain || provider.websiteDomain || provider.website_domain || '').trim();
  if (rawDomain) return rawDomain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const name = normalizeProviderName(provider.provider_name || provider.name || provider.label || '');
  return MEDIA_PROVIDER_DOMAIN_MAP[name] || '';
}

function getMediaProviderFallbackIconUrl(provider = {}) {
  const domain = getMediaProviderDomain(provider);
  return domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64` : '';
}

function getMediaProviderLogoUrl(provider = {}) {
  return normalizeMediaProviderLogoUrl(provider) || getMediaProviderFallbackIconUrl(provider);
}

function renderProviderNameWithTrailingLogo(provider = {}, className = '') {
  const providerObj = typeof provider === 'object' && provider ? provider : { provider_name: String(provider || '') };
  const name = String(providerObj.provider_name || providerObj.name || providerObj.label || '').trim();
  if (!name) return '';
  const logo = getMediaProviderLogoUrl(providerObj);
  const missing = logo ? '0' : '1';
  return `<span class="discover-provider-name-with-logo ${className}" data-provider-logo-missing="${missing}" data-provider-name="${escAttr(name)}"><span class="discover-provider-name-text">${escHtml(name)}</span><span class="discover-provider-trailing-logo">${logo ? `<img src="${escAttr(logo)}" alt="" loading="lazy">` : ''}</span></span>`;
}

function normalizeDeepSeekProviderLogoResponse(json) {
  if (!json) return '';
  if (typeof json === 'string') {
    try { return normalizeDeepSeekProviderLogoResponse(JSON.parse(json)); } catch(e) { return /^https?:\/\//i.test(json.trim()) ? json.trim() : ''; }
  }
  const content = json?.choices?.[0]?.message?.content || json?.message?.content || json?.content || json?.text || json?.answer;
  if (content && typeof content === 'string') return normalizeDeepSeekProviderLogoResponse(content);
  const direct = json.logoUrl || json.logo_url || json.iconUrl || json.icon_url || json.logo || json.icon || json.result?.logoUrl || json.data?.logoUrl;
  if (/^https?:\/\//i.test(String(direct || '').trim())) return String(direct).trim();
  const domain = String(json.domain || json.websiteDomain || json.website_domain || json.result?.domain || json.data?.domain || '').trim();
  return domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, ''))}&sz=64` : '';
}

async function fetchDeepSeekProviderLogo(providerName = '') {
  const cleanName = String(providerName || '').trim();
  if (!cleanName) return '';
  const cacheKey = cleanName.toLowerCase();
  if (mediaProviderLogoCache.has(cacheKey)) return mediaProviderLogoCache.get(cacheKey);
  const prompt = [
    'Return valid json only.',
    'Find the official high-quality website/app icon or logo URL for this streaming app, media website, or digital storefront.',
    'Prefer official CDN/app-store/brand assets over low-resolution favicons.',
    'Use exactly this shape: {"logoUrl":"https://...","domain":"official-domain.com"}',
    'If you cannot verify a logo URL, return the official domain only.',
    `Name: ${cleanName}`
  ].join('\n');
  const res = await fetchDeepSeekImportMatch({
    systemPrompt: 'Return valid json only for official app/site logo lookup.',
    userPrompt: prompt,
    temperature: 0
  });
  if (!res.ok) throw new Error(`Workers AI provider logo request failed: ${res.status}`);
  const logoUrl = normalizeDeepSeekProviderLogoResponse(await res.json());
  mediaProviderLogoCache.set(cacheKey, logoUrl);
  return logoUrl;
}

async function hydrateDiscoverProviderLogoFallbacks() {
  const overlay = document.getElementById('discover-media-profile');
  if (!overlay) return;
  const missing = [...overlay.querySelectorAll('[data-provider-logo-missing="1"]')].slice(0, 8);
  for (const el of missing) {
    const name = el.dataset.providerName || '';
    if (!name) continue;
    try {
      const logoUrl = await fetchDeepSeekProviderLogo(name);
      if (!logoUrl) continue;
      const slot = el.querySelector('.discover-provider-trailing-logo');
      if (slot) slot.innerHTML = `<img src="${escAttr(logoUrl)}" alt="" loading="lazy">`;
      el.dataset.providerLogoMissing = '0';
    } catch (error) {
      console.error('Workers AI provider logo fallback failed:', error);
    }
  }
}

function getDiscoverWatchProviderRegion(details = {}) {
  const display = details?.watchProviderDisplay;
  if (display?.regionCode && Array.isArray(display.rows) && display.rows.length) {
    return { code: display.regionCode, data: display.rows };
  }
  const results = details?.watchProvidersResults || details?.['watch/providers']?.results || details?.watch_providers?.results || {};
  if (results.US) return { code: 'US', data: results.US };
  const fallback = Object.entries(results).find(([, region]) => {
    return region && ['flatrate', 'free', 'ads', 'rent', 'buy'].some(key => Array.isArray(region[key]) && region[key].length);
  });
  return fallback ? { code: fallback[0], data: fallback[1] } : null;
}

function getDiscoverWatchProviderRows(details = {}) {
  const region = getDiscoverWatchProviderRegion(details);
  if (!region?.data) return [];
  if (Array.isArray(region.data)) return region.data;
  /* v649: Rent + Buy options removed from media profile per spec —
     too much clutter. Streaming-only (Stream / Free / With Ads). */
  const defs = [
    { key: 'flatrate', label: 'Stream' },
    { key: 'free', label: 'Free' },
    { key: 'ads', label: 'With Ads' }
  ];
  return defs.map(def => {
    const seen = new Set();
    const providers = (region.data[def.key] || []).filter(provider => {
      const providerId = String(provider?.provider_id || '');
      if (!providerId || seen.has(providerId)) return false;
      seen.add(providerId);
      return provider?.provider_name;
    }).slice(0, 6);
    return {
      key: def.key,
      label: def.label,
      providers
    };
  }).filter(row => row.providers.length);
}

function renderDiscoverWhereToWatch(details = {}) {
  const region = getDiscoverWatchProviderRegion(details);
  const rows = getDiscoverWatchProviderRows(details);
  if (!region || !rows.length) return '';
  const regionLabel = region.code === 'US' ? 'United States' : region.code;
  return `<div class="discover-media-watch">
    <div class="discover-media-watch-head">
      <strong>Where to Watch</strong>
      <span>${escHtml(regionLabel)}</span>
    </div>
    <div class="discover-media-watch-stack">
      ${rows.map(row => `<div class="discover-media-watch-row">
        <div class="discover-media-watch-label">${escHtml(row.label)}</div>
        ${row.text ? `<div class="discover-media-watch-text">${escHtml(row.text)}</div>` : `<div class="discover-media-watch-providers">
          ${row.providers.map(provider => `<div class="discover-media-watch-provider" title="${escAttr(provider.provider_name)}" aria-label="${escAttr(provider.provider_name)}">
            ${renderProviderNameWithTrailingLogo(provider, 'discover-media-watch-provider-name')}
          </div>`).join('')}
        </div>`}
      </div>`).join('')}
    </div>
  </div>`;
}

function renderDiscoverWhereToWatchInline(details = {}) {
  const region = getDiscoverWatchProviderRegion(details);
  const rows = getDiscoverWatchProviderRows(details);
  if (!region || !rows.length) return '';
  const regionLabel = region.code === 'US' ? 'United States' : region.code;
  return `<div class="discover-media-watch-inline">
    <div class="discover-media-watch-inline-head">
      <strong>Where to Watch</strong>
      <span>${escHtml(regionLabel)}</span>
    </div>
    <div class="discover-media-watch-inline-rows">
      ${rows.map(row => {
        const value = row.text
          ? escHtml(row.text)
          : row.providers.map(provider => renderProviderNameWithTrailingLogo(provider, 'discover-media-watch-inline-provider')).filter(Boolean).join('');
        return `<div class="discover-media-watch-inline-row"><span>${escHtml(row.label)}:</span> <span class="discover-media-watch-inline-provider-list">${value}</span></div>`;
      }).join('')}
    </div>
  </div>`;
}

function normalizeDiscoverWatchProviderDisplay(payload = {}) {
  const regionCode = String(payload.region || payload.regionCode || '').trim().toUpperCase() || 'US';
  const rows = Array.isArray(payload.rows) ? payload.rows.map(row => {
    const label = String(row?.label || '').trim();
    const text = String(row?.text || row?.value || '').trim();
    const providers = Array.isArray(row?.providers) ? row.providers.map(provider => {
      if (provider && typeof provider === 'object') {
        const providerName = String(provider.provider_name || provider.name || '').trim();
        if (!providerName) return null;
        return {
          provider_name: providerName,
          logo_path: typeof provider.logo_path === 'string' ? provider.logo_path : (typeof provider.logoPath === 'string' ? provider.logoPath : ''),
          logoUrl: typeof provider.logoUrl === 'string' ? provider.logoUrl : (typeof provider.logo_url === 'string' ? provider.logo_url : ''),
          iconUrl: typeof provider.iconUrl === 'string' ? provider.iconUrl : (typeof provider.icon_url === 'string' ? provider.icon_url : ''),
          domain: typeof provider.domain === 'string' ? provider.domain : (typeof provider.websiteDomain === 'string' ? provider.websiteDomain : ''),
          source: typeof provider.source === 'string' ? provider.source : ''
        };
      }
      const providerName = String(provider || '').trim();
      return providerName ? { provider_name: providerName, logo_path: '', source: '' } : null;
    }).filter(Boolean) : [];
    if (!label) return null;
    if (providers.length) return { label, providers };
    if (text) return { label, text, providers: [] };
    return null;
  }).filter(Boolean) : [];
  return rows.length ? { regionCode, rows } : null;
}

async function fetchDiscoverWatchProviderDisplay(type, id, details = {}) {
  try {
    const res = await fetchTmdbProxy(`${type}/${id}/watch/providers`);
    if (res.ok) {
      const json = await res.json();
      const normalized = normalizeDiscoverWatchProviderDisplay({ region: 'US', rows: getDiscoverWatchProviderRows({ watchProvidersResults: json.results || {} }) });
      if (normalized?.rows?.length) return normalized;
    }
  } catch (error) {
    console.error('TMDB watch providers failed:', error);
  }

  const title = getDiscoverMediaTitle(details, type);
  const year = getDiscoverMediaDate(details, type).slice(0, 4);
  if (!title) return null;

  try {
    const prompt = [
      'Return valid json only.',
      'Find current United States where-to-watch availability for this title.',
      'If it is only playing in movie theaters and not on streaming/rent/buy yet, return an In Theaters row.',
      'If you are not confident, return {"region":"US","rows":[]}.',
      'Use exactly this shape:',
      '{"region":"US","rows":[{"label":"Stream","providers":[{"name":"Netflix","logoUrl":"https://...","domain":"netflix.com"}]},{"label":"Rent","providers":[{"name":"Apple TV","logoUrl":"https://...","domain":"tv.apple.com"}]}]}',
      'For theatrical-only titles, use exactly:',
      '{"region":"US","rows":[{"label":"In Theaters","text":"In Theaters"}]}',
      'For app/provider rows, include the official logoUrl when confidently available, otherwise include the official domain.',
      `Title: ${title}`,
      year ? `Year: ${year}` : '',
      `Type: ${type === 'tv' ? 'TV series' : 'Movie'}`
    ].filter(Boolean).join('\n');
    const res = await fetchDeepSeekImportMatch({
      systemPrompt: 'Return valid json only for where to watch lookup.',
      userPrompt: prompt,
      temperature: 0
    });
    if (!res.ok) throw new Error(`Workers AI provider request failed: ${res.status}`);
    const json = await res.json();
    return normalizeDiscoverWatchProviderDisplay(json);
  } catch (error) {
    console.error('Workers AI watch providers failed:', error);
    return null;
  }
}

function renderGameMediaProfileDetails(details, rawgId = '') {
  const title = getGameTitleValue(details) || 'Game Profile';
  const poster = getGameMediaImage(details);
  const year = String(details.released || '').slice(0, 4);
  const overview = String(details.description_raw || details.description || 'No overview is available yet.').replace(/<[^>]*>/g, '');
  const genres = (details.genres || []).map(g => g.name).filter(Boolean).slice(0, 4);
  const facts = getGameMediaFacts(details);
  const metacriticScore = getGameMetacriticScore(details);
  const score = metacriticScore !== null ? String(metacriticScore) : 'N/A';
  const trailer = getGameMediaTrailer(details);
  const screenshots = (details.screenshots?.results || details.short_screenshots || []).filter(img => img?.image).slice(0, 8);
  return `<section class="discover-media-page game-media-page" role="dialog" aria-modal="true" aria-label="${escAttr(title)} details">
    <button class="discover-media-back" type="button" onclick="closeGameMediaProfile('back')">Back</button>
    ${renderMediaProfileTopActions(renderMediaProfileShareButton('game', rawgId || getGameRawgIdValue(details), title, poster), `${renderGameMediaProfileAddButton(rawgId || getGameRawgIdValue(details), details)}${currentUser && !viewingUser ? `<button class="discover-media-add-floating screenlist-game-profile-cover-btn" type="button" onclick="event.preventDefault();event.stopPropagation();openScreenListGameCoverPickerForSeed('${escAttr(String(rawgId || getGameRawgIdValue(details) || ''))}','${escAttr(title)}')">Change Cover</button>` : ''}`)}
    <div class="discover-media-hero game-media-hero" style="${poster ? `background-image:url('${escAttr(poster)}')` : ''}">
      <div class="discover-media-hero-shade"></div>
      <div class="discover-media-hero-content">
        <div class="discover-media-poster game-media-poster${poster ? '' : ' screenlist-game-cover-pending'}">${poster ? `<img src="${escAttr(poster)}" alt="">` : `<span>${SCREENLIST_GAME_COVER_PLACEHOLDER_TEXT}</span>`}</div>
        <div class="discover-media-kicker">Game Profile${year ? ` · ${escHtml(year)}` : ''}</div>
        <h2>${escHtml(title)}</h2>
        <p>${escHtml(overview)}</p>
        ${genres.length ? `<div class="discover-media-chips">${genres.map(name => `<span>${escHtml(name)}</span>`).join('')}</div>` : ''}
        ${renderGameProfileFloatingExports(details)}
      </div>
    </div>
    <div class="discover-media-body">
      <div class="discover-media-score-row">
        <div class="discover-media-score"><span class="discover-media-score-star" aria-hidden="true">★</span><span class="discover-media-score-value">${escHtml(score)}</span></div>
      </div>
      ${facts.length ? `<div class="discover-media-facts">${facts.map(fact => `<div class="${fact.priority ? 'primary' : ''}"><strong>${escHtml(fact.value)}</strong><span>${escHtml(fact.label)}</span></div>`).join('')}</div>` : ''}
      ${trailer ? `<div class="discover-media-trailer"><video controls playsinline preload="metadata" ${trailer.poster ? `poster="${escAttr(trailer.poster)}"` : ''}><source src="${escAttr(trailer.url)}"></video></div>` : ''}
      ${screenshots.length ? `<div class="discover-media-section"><h3>Screenshots</h3><div class="discover-media-similar game-media-screenshots">${screenshots.map(img => `<a class="discover-media-similar-card" href="${escAttr(img.image)}" target="_blank" rel="noopener"><img src="${escAttr(img.image)}" alt=""><span>Screenshot</span></a>`).join('')}</div></div>` : ''}
      ${renderDeepSeekMoreLikeThisSection('game', details)}
    </div>
  </section>`;
}

function getGameMediaCredits(details = {}) {
  const rows = [];
  const developers = (details.developers || []).map(dev => dev.name).filter(Boolean).slice(0, 3);
  const publishers = (details.publishers || []).map(pub => pub.name).filter(Boolean).slice(0, 3);
  const website = String(details.website || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (developers.length) rows.push({ label: 'Developed By', value: developers.join(', ') });
  if (publishers.length) rows.push({ label: 'Published By', value: publishers.join(', ') });
  if (website) rows.push({ label: 'Official Site', value: website });
  return rows;
}

function renderGameMediaProfileShellModern(seed, rawgId = '') {
  const title = getGameTitleValue(seed) || 'Game Profile';
  const poster = getGameMediaImage(seed);
  const year = String(seed?.released || seed?.year || '').slice(0, 4);
  const overview = seed?.description_raw || seed?.description || 'Loading this game profile...';
  const genres = (seed?.genres || []).map(g => g?.name).filter(Boolean).slice(0, 4);
  return `<section class="discover-media-page game-media-page discover-desktop-title-page" role="dialog" aria-modal="true" aria-label="${escAttr(title)} details">
    <button class="discover-media-back" type="button" onclick="closeGameMediaProfile('back')">Back</button>
    ${renderMediaProfileTopActions(renderMediaProfileShareButton('game', rawgId || getGameRawgIdValue(seed), title, poster), `${rawgId ? renderGameMediaProfileAddButton(rawgId, seed) : ''}${currentUser && !viewingUser ? `<button class="discover-media-add-floating screenlist-game-profile-cover-btn" type="button" onclick="event.preventDefault();event.stopPropagation();openScreenListGameCoverPickerForSeed('${escAttr(String(rawgId || getGameRawgIdValue(seed) || ''))}','${escAttr(title)}')">Change Cover</button>` : ''}`)}
    <div class="discover-media-hero game-media-hero" style="${poster ? `background-image:url('${escAttr(poster)}')` : ''}">
      <div class="discover-media-hero-shade"></div>
      <div class="discover-media-hero-content">
        <div class="discover-media-hero-top">
          <div class="discover-media-poster game-media-poster${poster ? '' : ' screenlist-game-cover-pending'}">${poster ? `<img src="${escAttr(poster)}" alt="">` : `<span>${SCREENLIST_GAME_COVER_PLACEHOLDER_TEXT}</span>`}</div>
          <div class="discover-media-hero-main">
            <div class="discover-media-kicker">Game Profile${year ? ` · ${escHtml(year)}` : ''}</div>
            <h2>${escHtml(title)}</h2>
          </div>
        </div>
        <p class="discover-media-synopsis">${escHtml(overview)}</p>
        ${genres.length ? `<div class="discover-media-chips">${genres.map(name => `<span>${escHtml(name)}</span>`).join('')}</div>` : ''}
        ${renderGameProfileFloatingExports(seed)}
      </div>
    </div>
    <div class="discover-media-body discover-media-body-cinema">
      <div class="discover-media-loading">Building this game page...</div>
    </div>
  </section>`;
}

function renderGameMediaProfileDetailsModern(details, rawgId = '') {
  const title = getGameTitleValue(details) || 'Game Profile';
  const poster = getGameMediaImage(details);
  const year = String(details.released || '').slice(0, 4);
  const overview = String(details.description_raw || details.description || 'No overview is available yet.').replace(/<[^>]*>/g, '');
  const genres = (details.genres || []).map(g => g.name).filter(Boolean).slice(0, 4);
  const facts = getGameMediaFacts(details);
  const credits = getGameMediaCredits(details);
  const metacriticScore = getGameMetacriticScore(details);
  const score = metacriticScore !== null ? String(metacriticScore) : 'N/A';
  const trailer = getGameMediaTrailer(details);
  const screenshots = (details.screenshots?.results || details.short_screenshots || []).filter(img => img?.image).slice(0, 8);
  return `<section class="discover-media-page game-media-page discover-desktop-title-page" role="dialog" aria-modal="true" aria-label="${escAttr(title)} details">
    <button class="discover-media-back" type="button" onclick="closeGameMediaProfile('back')">Back</button>
    ${renderMediaProfileTopActions(renderMediaProfileShareButton('game', rawgId || getGameRawgIdValue(details), title, poster), `${renderGameMediaProfileAddButton(rawgId || getGameRawgIdValue(details), details)}${currentUser && !viewingUser ? `<button class="discover-media-add-floating screenlist-game-profile-cover-btn" type="button" onclick="event.preventDefault();event.stopPropagation();openScreenListGameCoverPickerForSeed('${escAttr(String(rawgId || getGameRawgIdValue(details) || ''))}','${escAttr(title)}')">Change Cover</button>` : ''}`)}
    <div class="discover-media-hero game-media-hero" style="${poster ? `background-image:url('${escAttr(poster)}')` : ''}">
      <div class="discover-media-hero-shade"></div>
      <div class="discover-media-hero-content">
        <div class="discover-media-hero-top">
          <div class="discover-media-poster game-media-poster${poster ? '' : ' screenlist-game-cover-pending'}">${poster ? `<img src="${escAttr(poster)}" alt="">` : `<span>${SCREENLIST_GAME_COVER_PLACEHOLDER_TEXT}</span>`}</div>
          <div class="discover-media-hero-main">
            <div class="discover-media-kicker">Game Profile${year ? ` · ${escHtml(year)}` : ''}</div>
            <h2>${escHtml(title)}</h2>
            <div class="discover-media-score discover-media-score-hero"><span class="discover-media-score-star" aria-hidden="true">★</span><span class="discover-media-score-value">${escHtml(score)}</span></div>
          </div>
        </div>
        <p class="discover-media-synopsis" onclick="this.classList.toggle('expanded')">${escHtml(overview)}</p>
        ${genres.length ? `<div class="discover-media-chips">${genres.map(name => `<span>${escHtml(name)}</span>`).join('')}</div>` : ''}
        ${renderGameProfileFloatingExports(details)}
      </div>
    </div>
    <div class="discover-media-body discover-media-body-cinema">
      ${(facts.length || credits.length || trailer) ? `<div class="discover-media-detail-grid${trailer ? ' has-trailer' : ''}">
        ${(facts.length || credits.length) ? `<div class="discover-media-detail-stack">
          ${facts.length ? `<div class="discover-media-facts">${facts.map(fact => `<div class="${fact.priority ? 'primary' : ''}"><strong>${escHtml(fact.value)}</strong><span>${escHtml(fact.label)}</span></div>`).join('')}</div>` : ''}
          ${credits.length ? `<div class="discover-media-credits">${credits.map(row => `<div><span>${escHtml(row.label)}</span><strong>${escHtml(row.value)}</strong></div>`).join('')}</div>` : ''}
        </div>` : ''}
        ${trailer ? `<div class="discover-media-trailer discover-media-trailer-panel"><video controls playsinline preload="metadata" ${trailer.poster ? `poster="${escAttr(trailer.poster)}"` : ''}><source src="${escAttr(trailer.url)}"></video></div>` : ''}
      </div>` : ''}
      ${screenshots.length ? `<div class="discover-media-section discover-media-section-cast"><h3>Screenshots</h3><div class="discover-media-similar game-media-screenshots">${screenshots.map(img => `<a class="discover-media-similar-card" href="${escAttr(img.image)}" target="_blank" rel="noopener"><img src="${escAttr(img.image)}" alt=""><span>Screenshot</span></a>`).join('')}</div></div>` : ''}
      ${renderDeepSeekMoreLikeThisSection('game', details)}
    </div>
  </section>`;
}

function bindGameMediaProfileActions(overlay) {
  const addButton = overlay?.querySelector?.('.discover-media-add-floating');
  bindDiscoverMediaProfileSwipeBack(overlay);
  if (!addButton) return;
  if (!overlay.dataset.libraryDockOutsideBound) {
    overlay.dataset.libraryDockOutsideBound = 'true';
    overlay.addEventListener('click', (event) => {
      const dock = overlay.querySelector('.discover-media-library-dock');
      if (!dock) return;
      if (dock.contains(event.target) || event.target.closest('.discover-media-add-floating')) return;
      closeDiscoverMediaLibraryDock();
    });
  }
  addButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (!addButton.dataset.discoverId || addButton.disabled) return;
    showDiscoverMediaLibraryDock(addButton);
  });
}

async function resolveRawgIdForGameSeed(seed = {}) {
  const directId = getGameRawgIdValue(seed);
  if (directId) return directId;
  const title = getGameTitleValue(seed);
  if (!title) return '';
  const res = await fetchRawgProxy('games', { search: title, search_precise: 'true', page_size: 5 });
  if (!res.ok) throw new Error(`RAWG search failed: ${res.status}`);
  const json = await res.json();
  const results = Array.isArray(json?.results) ? json.results : [];
  const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
  const wanted = normalize(title);
  const exact = results.find(item => normalize(item?.name) === wanted);
  return (exact || results[0])?.id ? String((exact || results[0]).id) : '';
}

async function openGameMediaProfile(event, rawgId = '', seedOverride = null, transitionOrigin = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const initialSeed = getGameMediaProfileSeed(rawgId, seedOverride);
  closeGameMediaProfile();
  const overlay = document.createElement('div');
  overlay.id = 'discover-media-profile';
  overlay.className = 'discover-media-profile-overlay game-media-profile-overlay';
  if (transitionOrigin && typeof transitionOrigin.closest === 'function' && transitionOrigin.closest('.activity-poster-col, .activity-poster-placeholder')) {
    overlay.classList.add('activity-origin-media-profile');
  }
  overlay.innerHTML = renderGameMediaProfileShellModern(initialSeed, rawgId);
  bindGameMediaProfileActions(overlay);
  document.body.appendChild(overlay);
  document.body.classList.add('discover-media-profile-open', 'game-media-profile-open');
  document.addEventListener('keydown', handleGameMediaProfileEsc);
  revealMediaProfileOverlay(overlay, transitionOrigin, event);

  try {
    const resolvedId = rawgId || await resolveRawgIdForGameSeed(initialSeed);
    if (!resolvedId) {
      if (!document.getElementById('discover-media-profile')) return;
      const mergedGameDetails = await ensureScreenListIgdbCoverOnGameDetails({ ...initialSeed, rawgId: '' });
      overlay.innerHTML = renderGameMediaProfileDetailsModern(mergedGameDetails, '');
      bindGameMediaProfileActions(overlay);
      hydrateDeepSeekMoreLikeThis('game', mergedGameDetails);
      return;
    }
    let details = gameMediaProfileCache.get(String(resolvedId));
    if (!details) {
      const [detailsRes, shotsRes] = await Promise.all([
        fetchRawgProxy(`games/${resolvedId}`),
        fetchRawgProxy(`games/${resolvedId}/screenshots`)
      ]);
      if (!detailsRes.ok) throw new Error(`RAWG details request failed: ${detailsRes.status}`);
      details = await detailsRes.json();
      if (shotsRes.ok) {
        details.screenshots = await shotsRes.json();
      }
      details.rawgId = String(resolvedId);
      gameMediaProfileCache.set(String(resolvedId), details);
    }
    if (!document.getElementById('discover-media-profile')) return;
    const mergedGameDetails = await ensureScreenListIgdbCoverOnGameDetails({ ...initialSeed, ...details, rawgId: String(resolvedId) });
    overlay.innerHTML = renderGameMediaProfileDetailsModern(mergedGameDetails, String(resolvedId));
    bindGameMediaProfileActions(overlay);
    hydrateDeepSeekMoreLikeThis('game', mergedGameDetails);
  } catch (e) {
    console.error('Game media profile failed:', e);
    if (!document.getElementById('discover-media-profile')) return;
    const mergedGameDetails = await ensureScreenListIgdbCoverOnGameDetails({ ...initialSeed, rawgId: rawgId || getGameRawgIdValue(initialSeed) });
    overlay.innerHTML = renderGameMediaProfileDetailsModern(mergedGameDetails, rawgId || getGameRawgIdValue(initialSeed));
    bindGameMediaProfileActions(overlay);
    hydrateDeepSeekMoreLikeThis('game', mergedGameDetails);
  }
}

function openGameMediaProfileFromLibrary(event, itemId, sectionOverride = 'games') {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const visibleData = getVisibleListData();
  const item = (visibleData.games || []).find(game => String(game.id) === String(itemId));
  if (!item) return;
  const rawgId = getGameRawgIdValue(item);
  openGameMediaProfile(event, rawgId, item);
}

async function openLibraryMediaProfile(event, itemId, sectionOverride = '') {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const section = sectionOverride || activeSection;
  if (section === 'games') return openGameMediaProfileFromLibrary(event, itemId, section);
  if (!canOpenLibraryMediaProfile(section)) return;

  const visibleData = getVisibleListData();
  const item = (visibleData[section] || []).find(entry => String(entry.id) === String(itemId));
  if (!item) return;

  const type = section === 'movies' ? 'movie' : 'tv';
  let tmdbId = String(item.tmdbId || item.tmdb_id || '').trim();

  if (!tmdbId && item.title) {
    try {
      const queryParams = { query: item.title };
      if (item.year) {
        if (type === 'movie') queryParams.primary_release_year = item.year;
        else queryParams.first_air_date_year = item.year;
      }
      const res = await fetchTmdbProxy(`search/${type}`, queryParams);
      if (res.ok) {
        const json = await res.json();
        const results = json.results || [];
        const yearMatch = item.year
          ? results.find(result => String((result.release_date || result.first_air_date || '').slice(0, 4)) === String(item.year))
          : null;
        const match = yearMatch || results[0];
        if (match?.id) {
          tmdbId = String(match.id);
          item.tmdbId = tmdbId;
          if (!viewingUser && section === activeSection) save();
        }
      }
    } catch (error) {
      console.error('Library media profile TMDB lookup failed:', error);
    }
  }

  if (!tmdbId) {
    showToast('Could not open this title profile right now.');
    return;
  }

  setDiscoverMediaProfileSeed(type, tmdbId, {
    title: item.title || '',
    name: item.title || '',
    overview: item.overview || '',
    poster: item.cover || '',
    release_date: type === 'movie' && item.year ? `${item.year}-01-01` : '',
    first_air_date: type === 'tv' && item.year ? `${item.year}-01-01` : '',
    genreNames: item.genreNames || String(item.genre || '').split(',').map(name => name.trim()).filter(Boolean),
    mediaCategory: item.mediaCategory || section,
    librarySection: item.librarySection || section,
    isAnime: section === 'anime' || item.isAnime === true,
    originalTitle: item.originalTitle || '',
    originalLanguage: item.originalLanguage || '',
    originCountries: Array.isArray(item.originCountries) ? item.originCountries : [],
    titleVariants: item.titleVariants || null,
    englishTitle: item.englishTitle || '',
    romajiTitle: item.romajiTitle || '',
    japaneseTitle: item.japaneseTitle || '',
    tmdbSeasonNumber: item.tmdbSeasonNumber || '',
    libraryItemId: item.id || itemId,
    librarySource: viewingUser ? 'friend' : 'own'
  });

  openDiscoverMediaProfile(event, type, tmdbId);
}


function handleLibraryTitleProfileClick(event) {
  const button = event?.target?.closest?.('.media-title-profile-btn[data-library-item-id], .game-title-profile-btn[data-library-item-id], .card-cover-profile-btn[data-library-item-id]');
  if (!button) return;
  const itemId = button.dataset.libraryItemId || '';
  const section = button.dataset.librarySection || '';
  if (!itemId) return;
  event.preventDefault?.();
  event.stopPropagation?.();
  event.stopImmediatePropagation?.();
  if (section === 'games') openGameMediaProfileFromLibrary(event, itemId, section);
  else if (canOpenLibraryMediaProfile(section)) openLibraryMediaProfile(event, itemId, section);
}

function handleLibraryPosterProfileKeydown(event) {
  if (event?.key !== 'Enter' && event?.key !== ' ') return;
  const cover = event?.target?.closest?.('.card-cover-profile-btn[data-library-item-id]');
  if (!cover) return;
  handleLibraryTitleProfileClick(event);
}

if (!window.__screenListLibraryTitleProfileDelegateBound) {
  window.__screenListLibraryTitleProfileDelegateBound = true;
  document.addEventListener('click', handleLibraryTitleProfileClick, true);
  document.addEventListener('keydown', handleLibraryPosterProfileKeydown, true);
}

function getLetterboxdDirectUrl(item) {
  if (!item || !item.tmdbId) return '';
  return `https://letterboxd.com/tmdb/${item.tmdbId}`;
}

async function backfillLetterboxdForItem(item) {
  if (!item || activeSection !== 'movies' || item.tmdbId || !item.title) return false;
  try {
    const res = await fetchTmdbProxy('search/movie', { query: item.title });
    const json = await res.json();
    const results = json.results || [];
    let match = null;
    if (item.year) {
      match = results.find(r => ((r.release_date || '').slice(0, 4) === String(item.year)));
    }
    if (!match) match = results[0];
    if (!match || !match.id) return false;
    item.tmdbId = String(match.id);
    save();
    return true;
  } catch (e) {
    console.error('Letterboxd backfill failed:', e);
    return false;
  }
}

async function openLetterboxd(itemId) {
  const visibleData = getVisibleListData();
  const item = (visibleData[activeSection] || []).find(i => i.id === itemId);
  if (!item) return;

  if (activeSection !== 'movies') {
    showToast("OOPS! Letterboxd does not have this title");
    return;
  }

  if (!item.tmdbId) {
    const ok = await backfillLetterboxdForItem(item);
    if (!ok || !item.tmdbId) {
      showToast("OOPS! Letterboxd does not have this title");
      return;
    }
    render();
  }

  window.open(getLetterboxdDirectUrl(item), '_blank', 'noopener');
}

function showToast(message, options = {}) {
  const existing = document.querySelector('.app-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'app-toast';
  if (message === "OOPS! Letterboxd does not have this title" || message === "this title is already added to your library silly!") toast.classList.add('letterboxd-error');
  if (options.className) toast.classList.add(...String(options.className).split(/\s+/).filter(Boolean));
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 240);
  }, Number(options.durationMs || 1500));
}

function showDmE2eeMissingKeyWarningToast() {
  const existing = document.querySelector('.app-toast, .dm-e2ee-key-warning-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'dm-e2ee-key-warning-toast';
  toast.textContent = DM_E2EE_MISSING_KEY_TOAST;
  toast.setAttribute('role', 'alert');
  Object.assign(toast.style, {
    position: 'fixed',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -46%)',
    zIndex: '2147483647',
    width: 'min(90vw, 430px)',
    padding: '18px 20px',
    borderRadius: '16px',
    background: 'linear-gradient(135deg, #991b1b, #dc2626)',
    border: '1px solid rgba(255,255,255,0.28)',
    color: '#ffffff',
    fontSize: '15px',
    fontWeight: '900',
    lineHeight: '1.35',
    textAlign: 'center',
    boxShadow: '0 22px 60px rgba(127,29,29,0.5), 0 0 0 1px rgba(255,255,255,0.08) inset',
    textShadow: '0 1px 2px rgba(69,10,10,0.72)',
    opacity: '0',
    pointerEvents: 'none',
    transition: 'opacity 180ms ease, transform 180ms ease'
  });
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translate(-50%, -50%)';
  });
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translate(-50%, -54%)';
    setTimeout(() => toast.remove(), 260);
  }, 6000);
}

function showDmE2eeOwnKeyRequiredToast(text = DM_E2EE_OWN_KEY_TOAST) {
  const existing = document.querySelector('.app-toast, .dm-e2ee-key-warning-toast, .dm-e2ee-own-key-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'dm-e2ee-own-key-toast';
  toast.setAttribute('role', 'alertdialog');
  Object.assign(toast.style, {
    position: 'fixed',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -46%)',
    zIndex: '2147483647',
    width: 'min(92vw, 460px)',
    padding: '46px 22px 22px',
    borderRadius: '16px',
    background: 'linear-gradient(135deg, #991b1b, #dc2626)',
    border: '1px solid rgba(255,255,255,0.28)',
    color: '#ffffff',
    fontSize: '15px',
    fontWeight: '900',
    lineHeight: '1.42',
    textAlign: 'center',
    whiteSpace: 'pre-line',
    boxShadow: '0 22px 60px rgba(127,29,29,0.5), 0 0 0 1px rgba(255,255,255,0.08) inset',
    textShadow: '0 1px 2px rgba(69,10,10,0.72)',
    opacity: '0',
    transition: 'opacity 180ms ease, transform 180ms ease'
  });

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'EXIT';
  close.setAttribute('aria-label', 'Close encryption warning');
  Object.assign(close.style, {
    position: 'absolute',
    top: '10px',
    left: '10px',
    minWidth: '58px',
    height: '28px',
    border: '1px solid rgba(255,255,255,0.34)',
    borderRadius: '999px',
    background: 'linear-gradient(135deg, #06b6d4, #0891b2)',
    color: '#ffffff',
    fontSize: '11px',
    fontWeight: '900',
    letterSpacing: '0',
    cursor: 'pointer',
    boxShadow: '0 8px 18px rgba(6,182,212,0.34)'
  });
  close.onclick = () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translate(-50%, -54%)';
    setTimeout(() => toast.remove(), 240);
  };

  const message = document.createElement('div');
  message.textContent = text || DM_E2EE_OWN_KEY_TOAST;
  toast.appendChild(close);
  toast.appendChild(message);
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translate(-50%, -50%)';
  });
}

let screenListAddAudioContext = null;
function getScreenListAddAudioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!screenListAddAudioContext) screenListAddAudioContext = new AudioCtx();
  return screenListAddAudioContext;
}

function armScreenListAddSound() {
  const ctx = getScreenListAddAudioContext();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

document.addEventListener('pointerdown', armScreenListAddSound, { passive: true });

function playLibraryAddPopSound() {
  try {
    const ctx = getScreenListAddAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.055, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    gain.connect(ctx.destination);

    const pop = ctx.createOscillator();
    pop.type = 'triangle';
    pop.frequency.setValueAtTime(520, now);
    pop.frequency.exponentialRampToValueAtTime(920, now + 0.08);
    pop.connect(gain);
    pop.start(now);
    pop.stop(now + 0.16);

    const shineGain = ctx.createGain();
    shineGain.gain.setValueAtTime(0.0001, now);
    shineGain.gain.exponentialRampToValueAtTime(0.025, now + 0.026);
    shineGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    shineGain.connect(ctx.destination);
    const shine = ctx.createOscillator();
    shine.type = 'sine';
    shine.frequency.setValueAtTime(1240, now + 0.018);
    shine.frequency.exponentialRampToValueAtTime(1640, now + 0.11);
    shine.connect(shineGain);
    shine.start(now + 0.018);
    shine.stop(now + 0.19);
  } catch (e) {}
}

function clearListSearch() {
  searchQuery = "";
  const input = document.querySelector(".search-input");
  if (input) input.value = "";
}

function chooseInitialListView(listData) {
  const sectionOrder = ["movies", "shows", "anime", "games", "manga", "books"].filter(section => isSectionVisibleInMyLists(section));
  const statusOrderBySection = SCREENLIST_VISIBLE_STATUS_TABS_BY_SECTION;

  for (const section of sectionOrder) {
    const statuses = statusOrderBySection[section];
    const items = Array.isArray(listData[section]) ? listData[section] : [];
    if (section === 'games' && items.some(item => item.status === 'watching' || item.status === 'live' || item.status === 'competitive')) {
      return { section, tab: 'watching' };
    }
    for (const status of statuses) {
      if (items.some(item => item.status === status)) {
        return { section, tab: status };
      }
    }
  }
  return { section: "movies", tab: "planned" };
}

// 120Hz frame-locked no-effect page jumps for internal mobile page switches.
// This intentionally does not fade, slide, scale, or blur anything; it only aligns the DOM swap to high-refresh frames.
const SCREENLIST_INTERNAL_PAGE_JUMP_FPS = 120;
const SCREENLIST_INTERNAL_PAGE_JUMP_FRAME_MS = 1000 / SCREENLIST_INTERNAL_PAGE_JUMP_FPS;
const SCREENLIST_INTERNAL_PAGE_JUMP_MS = 90;
const SCREENLIST_MYLIST_PAGE_JUMP_MS = 300;
let myListInternalPageJumpToken = 0;

function isScreenListMobileInternalJumpLayout() {
  return window.matchMedia && window.matchMedia('(max-width: 700px), (hover: none) and (pointer: coarse)').matches;
}

function runScreenListFrameLockedJump(callback, shouldCancel = () => false, durationMs = SCREENLIST_INTERNAL_PAGE_JUMP_MS) {
  const run = () => {
    if (shouldCancel()) return;
    try { callback(); } catch (error) { console.error('ScreenList frame-locked page jump failed:', error); }
  };

  if (!isScreenListMobileInternalJumpLayout() || document.hidden) {
    run();
    return;
  }

  const duration = Math.max(SCREENLIST_INTERNAL_PAGE_JUMP_FRAME_MS, Number(durationMs) || SCREENLIST_INTERNAL_PAGE_JUMP_MS);
  const targetFrameCount = Math.max(1, Math.round(duration / SCREENLIST_INTERNAL_PAGE_JUMP_FRAME_MS));
  const start = performance.now();
  let hasRun = false;
  let lastFrame = -1;

  function tick(now) {
    if (shouldCancel()) return;
    const elapsed = Math.max(0, now - start);
    const frame = Math.min(targetFrameCount, Math.floor(elapsed / SCREENLIST_INTERNAL_PAGE_JUMP_FRAME_MS));
    if (frame !== lastFrame) {
      lastFrame = frame;
      if (!hasRun) {
        hasRun = true;
        run();
      }
    }
    if (elapsed < duration) {
      requestAnimationFrame(tick);
    } else if (!hasRun) {
      hasRun = true;
      run();
    }
  }

  requestAnimationFrame(tick);
}

function runMyListInternalPageJump(callback) {
  const token = ++myListInternalPageJumpToken;
  runScreenListFrameLockedJump(callback, () => token !== myListInternalPageJumpToken, SCREENLIST_MYLIST_PAGE_JUMP_MS);
}

// v427: click-driven horizontal pager between My Lists categories.
// No touch-swipe; only triggered by switchSection() button clicks.
const SHELFD_MYLIST_PAGER_ORDER = ['games', 'anime', 'manga', 'books', 'movies', 'shows'];
let _shelfdMyListPagerActive = false;

function getShelfdVisibleMyListPagerOrder() {
  return SHELFD_MYLIST_PAGER_ORDER.filter(section => {
    try { return isSectionVisibleInMyLists(section); } catch (e) { return true; }
  });
}

function getShelfdMyListSectionLabel(section = '') {
  if (typeof getSectionLabel === 'function') {
    try {
      const label = getSectionLabel(section);
      if (label) return label;
    } catch (e) {}
  }
  const labels = { games: 'Games', anime: 'Anime', manga: 'Manga', books: 'Books', movies: 'Movies', shows: 'TV Shows' };
  return labels[section] || section;
}

function runMyListSectionPagerTransition(prevSection, nextSection, switchCallback) {
  const stage = document.getElementById('mylist-stage');
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (!stage || reduceMotion || _shelfdMyListPagerActive) {
    if (typeof switchCallback === 'function') switchCallback();
    return;
  }
  const order = getShelfdVisibleMyListPagerOrder();
  const prevIdx = order.indexOf(prevSection);
  const nextIdx = order.indexOf(nextSection);
  if (prevIdx < 0 || nextIdx < 0 || prevIdx === nextIdx) {
    if (typeof switchCallback === 'function') switchCallback();
    return;
  }

  const startIdx = Math.min(prevIdx, nextIdx);
  const endIdx = Math.max(prevIdx, nextIdx);
  const totalPanels = endIdx - startIdx + 1;
  const prevPanelOffset = prevIdx - startIdx;
  const nextPanelOffset = nextIdx - startIdx;
  const absDist = Math.abs(nextIdx - prevIdx);

  _shelfdMyListPagerActive = true;

  const sanitizeSnapshot = (clone) => {
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    clone.querySelectorAll('input,button,select,textarea').forEach(el => {
      try {
        el.setAttribute('disabled', 'disabled');
        el.setAttribute('tabindex', '-1');
        if (el.tagName === 'INPUT') el.setAttribute('readonly', 'readonly');
      } catch (e) {}
    });
    clone.querySelectorAll('[onclick],[onchange],[oninput],[onsubmit]').forEach(el => {
      try {
        el.removeAttribute('onclick');
        el.removeAttribute('onchange');
        el.removeAttribute('oninput');
        el.removeAttribute('onsubmit');
      } catch (e) {}
    });
    clone.style.pointerEvents = 'none';
  };

  const prevStageHeight = Math.max(stage.offsetHeight, 1);
  const prevSnapshot = stage.cloneNode(true);
  sanitizeSnapshot(prevSnapshot);

  if (typeof switchCallback === 'function') switchCallback();

  const nextSnapshot = stage.cloneNode(true);
  sanitizeSnapshot(nextSnapshot);

  // v429: take the taller of prev/next so neither snapshot gets clipped during
  // the slide if one section has a games-playing-subfilter and the other does not.
  const stageHeight = Math.max(prevStageHeight, stage.offsetHeight, 1);

  const overlay = document.createElement('div');
  overlay.className = 'mylist-pager-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.height = stageHeight + 'px';

  const track = document.createElement('div');
  track.className = 'mylist-pager-track';

  for (let i = startIdx; i <= endIdx; i++) {
    const section = order[i];
    const panel = document.createElement('div');
    panel.className = 'mylist-pager-panel';
    if (i === prevIdx) {
      panel.classList.add('mylist-pager-panel-prev');
      panel.appendChild(prevSnapshot);
    } else if (i === nextIdx) {
      panel.classList.add('mylist-pager-panel-next');
      panel.appendChild(nextSnapshot);
    } else {
      panel.classList.add('mylist-pager-panel-label');
      const label = document.createElement('div');
      label.className = 'mylist-pager-panel-label-text';
      label.textContent = getShelfdMyListSectionLabel(section);
      panel.appendChild(label);
    }
    track.appendChild(panel);
  }

  overlay.appendChild(track);
  Array.from(stage.children).forEach(child => {
    child.dataset._shelfdPagerVisibility = child.style.visibility || '';
    child.style.visibility = 'hidden';
  });
  stage.appendChild(overlay);

  track.style.transition = 'none';
  track.style.transform = `translate3d(${-(prevPanelOffset * 100)}%, 0, 0)`;
  void track.offsetWidth;

  const duration = Math.max(280, Math.min(540, 280 + 70 * (absDist - 1)));

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    Array.from(stage.children).forEach(child => {
      if (child === overlay) return;
      child.style.visibility = child.dataset._shelfdPagerVisibility || '';
      delete child.dataset._shelfdPagerVisibility;
    });
    overlay.remove();
    _shelfdMyListPagerActive = false;
  };

  requestAnimationFrame(() => {
    track.style.transition = `transform ${duration}ms cubic-bezier(.22, 1, .36, 1)`;
    track.style.transform = `translate3d(${-(nextPanelOffset * 100)}%, 0, 0)`;
    track.addEventListener('transitionend', function onEnd(e) {
      if (e.propertyName !== 'transform') return;
      track.removeEventListener('transitionend', onEnd);
      cleanup();
    });
    setTimeout(cleanup, duration + 220);
  });
}

// Actions
function switchSection(s) {
  if (typeof clearLastEditedResortHold === 'function') clearLastEditedResortHold();
  if (!isSectionVisibleInMyLists(s)) return;
  if (activeSection === s) return;
  if (_shelfdMyListPagerActive) return;
  const prevSection = activeSection;
  closeSortDropdown();
  runMyListSectionPagerTransition(prevSection, s, () => {
    activeSection = s;
    activeTab = getDefaultTabForSection(s);
    if (s === 'games') activeGamePlayingFilter = 'live';
    render();
    persistUiState();
    updateSlidingPills();
  });
}
function switchTab(t) {
  if (typeof clearLastEditedResortHold === 'function') clearLastEditedResortHold();
  if (!isVisibleMyListStatusTab(t, activeSection)) return;
  const nextTab = activeSection === 'games' && t === 'live' ? 'watching' : t;
  if (activeTab === nextTab && !(activeSection === 'games' && t === 'live')) return;
  activeTab = nextTab;
  if (activeSection === 'games' && (t === 'watching' || t === 'live')) activeGamePlayingFilter = 'live';
  closeSortDropdown();
  runMyListInternalPageJump(() => {
    render();
    persistUiState();
    requestAnimationFrame(() => updateSlidingPills());
  });
}

// ── My Lists swipe-between-status-tabs removed ────────────────────────────────
// V300: Status-page swiping is fully disabled for mobile/PWA. Previous swipe
// handlers/rails could intercept title-card taps, episode checks, status buttons,
// and star ratings. Status changes now happen only through visible buttons/tabs.
let _sw = null;
let _swPillLock = false;

function removeMyListSwipeArtifacts() {
  document.querySelectorAll('.mylist-edge-swipe-rail, #_swipe_out').forEach(el => el.remove());
  document.body.classList.remove('mylist-status-swipe-active');
}

function initMyListInteractionFallbacks() {
  if (window.__shelfdMyListActionFallbacksV301) return;
  window.__shelfdMyListActionFallbacksV301 = true;
  document.addEventListener('click', handleMyListClickActionFallback, true);
}

function handleMyListClickActionFallback(event) {
  const target = event.target;
  if (!target || !target.closest) return;
  if (!target.closest('#mylist-view')) return;

  const starBtn = target.closest('.stars[data-item-id][data-prefix] .star-btn[data-star]');
  if (starBtn) {
    const stars = starBtn.closest('.stars[data-item-id][data-prefix]');
    const itemId = stars?.dataset?.itemId || '';
    const prefix = stars?.dataset?.prefix || '';
    const score = Number(starBtn.dataset.star || 0);
    if (itemId && prefix && score > 0 && !viewingUser) {
      event.preventDefault();
      event.stopImmediatePropagation();
      rate(itemId, prefix, score);
    }
    return;
  }

  const button = target.closest('[data-mylist-action]');
  /* v745 DIAGNOSTIC + FIX:
     The user reports episode toggles are completely dead for TV/anime in
     MyList. To both diagnose AND fix in one ship, this handler now:
       (a) logs every relevant decision point to console with the
           [ep-toggle-diag v745] prefix so we can see exactly what's
           happening in DevTools, and
       (b) ONLY bails on viewingUser/disabled — we no longer require a
           data-mylist-item-id (some templates may set it via dataset that
           doesn't survive a re-render); we fall back to closest('.card')
           if needed. */
  if (!button) return;
  const action = button.dataset.mylistAction || '';
  if (action === 'toggle-ep') {
    const epId = button.dataset.mylistEpisodeId || '';
    let itemId = button.dataset.mylistItemId || '';
    if (!itemId) {
      const card = button.closest('.card[id^="card-"]');
      if (card) itemId = card.id.slice(5);
    }
    console.log('[ep-toggle-diag v745] click captured', {
      itemId,
      epId,
      activeSection: typeof activeSection !== 'undefined' ? activeSection : '(undef)',
      viewingUser: !!viewingUser,
      buttonDisabled: button.disabled,
      hasToggleEp: typeof toggleEp === 'function'
    });
    if (button.disabled || viewingUser) {
      console.log('[ep-toggle-diag v745] bailed: disabled or viewingUser');
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!itemId || !epId) {
      console.log('[ep-toggle-diag v745] bailed: missing itemId or epId');
      return;
    }
    try {
      toggleEp(itemId, epId);
      console.log('[ep-toggle-diag v745] toggleEp returned OK');
    } catch (err) {
      console.error('[ep-toggle-diag v745] toggleEp threw:', err);
    }
    return;
  }
  if (button.disabled || viewingUser) return;
  const itemId = button.dataset.mylistItemId || '';
  if (!action || !itemId) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  if (action === 'status') {
    const status = button.dataset.mylistStatus || button.dataset.status || '';
    if (status) changeStatus(itemId, status);
    return;
  }

  if (action === 'mark-all-eps') {
    markAllEps(itemId, button.dataset.mylistMarkValue === 'true');
    return;
  }

  if (action === 'mark-season-eps') {
    const seasonNum = Number(button.dataset.mylistSeasonNum || 0);
    markSeasonEps(itemId, seasonNum, button.dataset.mylistMarkValue === 'true');
  }
}

function positionSlidingPill(container, activeBtn, pillClass) {
  if (!container || !activeBtn) return;
  let pill = container.querySelector('.' + pillClass);
  const isNew = !pill;
  if (!pill) {
    pill = document.createElement('span');
    pill.className = pillClass + ' pill-init';
    container.appendChild(pill);
  }
  const x = activeBtn.offsetLeft;
  const y = activeBtn.offsetTop;
  const w = activeBtn.offsetWidth;
  const h = activeBtn.offsetHeight;
  // Underline mode: 3px line pinned to the bottom of the button.
  // v597: pill is 70% of button width (30% shorter), centred under the label.
  const UNDERLINE_H = 3;
  const pillW = Math.round(w * 0.70);
  const pillX = x + Math.round((w - pillW) / 2);
  pill.style.width = pillW + 'px';
  pill.style.height = UNDERLINE_H + 'px';
  pill.style.transform = 'translate3d(' + pillX + 'px,' + (y + h - UNDERLINE_H) + 'px,0)';
  if (isNew) {
    // Two rAFs: first commits the paint, second enables spring transition
    requestAnimationFrame(() => requestAnimationFrame(() => pill.classList.remove('pill-init')));
  }
}

function updateSlidingPills() {
  if (_swPillLock) return; // swipe is driving the pill manually — don't interfere
  const sectionToggle = document.querySelector('#mylist-view #mylist-header .section-toggle');
  const activeSecBtn = sectionToggle && sectionToggle.querySelector('.section-btn.active');
  if (sectionToggle && activeSecBtn) positionSlidingPill(sectionToggle, activeSecBtn, 'section-sliding-pill');

  const tabsContainer = document.querySelector('#mylist-view #mylist-toolbar .tabs');
  const activeTabBtn = tabsContainer && tabsContainer.querySelector('.tab-btn.active');
  if (tabsContainer && activeTabBtn) positionSlidingPill(tabsContainer, activeTabBtn, 'tab-sliding-pill');
}


// Backfill IGDB/Twitch portrait covers for game items.
// Global rule: every game poster treats IGDB/Twitch portrait art as the source of truth.
// RAWG, Steam, TMDB-style, or generic images are temporary fallbacks only.
let _igdbBackfillRunning = false;
const SCREENLIST_IGDB_COVER_LOOKUP_CACHE = new Map();
const SCREENLIST_IGDB_COVER_FAILURE_CACHE = new Map();
const SCREENLIST_GAME_COVER_PLACEHOLDER_TEXT = 'Shelfd';
function isScreenListIgdbCoverUrl(value = '') {
  return /images\.igdb\.com\/igdb\/image\/upload/i.test(String(value || ''));
}
function isScreenListAllowedGameCoverUrl(value = '') {
  return /^(https?:|data:image\/)/i.test(String(value || '').trim());
}
function isScreenListSteamGameItem(item = {}) {
  return !!(item && (String(item.source || '').trim().toLowerCase() === 'steam' || String(item.steamAppId || '').trim()));
}
function getScreenListGameCoverMapStorageKey() {
  return currentUser?.uid ? `screenlist-user-selected-game-covers-${currentUser.uid}` : 'screenlist-user-selected-game-covers-guest';
}
function normalizeScreenListGameCoverKey(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .trim();
}
function getScreenListGameCoverMapKeys(item = {}) {
  const keys = [
    item?.steamAppId ? `steam:${String(item.steamAppId).trim()}` : '',
    item?.appId ? `steam:${String(item.appId).trim()}` : '',
    item?.rawgId ? `rawg:${String(item.rawgId).trim()}` : '',
    item?.id ? `rawg:${String(item.id).trim()}` : '',
    item?.title ? `title:${normalizeScreenListGameCoverKey(item.title)}` : '',
    item?.name ? `title:${normalizeScreenListGameCoverKey(item.name)}` : ''
  ].filter(Boolean);
  return [...new Set(keys)];
}
function readScreenListGameCoverMap() {
  try {
    const raw = localStorage.getItem(getScreenListGameCoverMapStorageKey());
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}
function writeScreenListGameCoverMap(map = {}) {
  try { localStorage.setItem(getScreenListGameCoverMapStorageKey(), JSON.stringify(map || {})); } catch (error) {}
}
function rememberScreenListUserSelectedGameCover(item = {}, coverUrl = '') {
  const cleanCover = String(coverUrl || '').trim();
  if (!cleanCover || !isScreenListAllowedGameCoverUrl(cleanCover)) return;
  const map = readScreenListGameCoverMap();
  getScreenListGameCoverMapKeys(item).forEach(key => { map[key] = cleanCover; });
  writeScreenListGameCoverMap(map);
}
function getScreenListUserSelectedGameCover(item = {}) {
  const direct = String(item?.userSelectedGameCover || item?.customCover || item?.selectedCover || '').trim();
  if (direct && isScreenListAllowedGameCoverUrl(direct)) return direct;
  const map = readScreenListGameCoverMap();
  for (const key of getScreenListGameCoverMapKeys(item)) {
    const mapped = String(map[key] || '').trim();
    if (mapped && isScreenListAllowedGameCoverUrl(mapped)) return mapped;
  }
  return '';
}
function getScreenListPreferredGameCover(item = {}) {
  if (!item || typeof item !== 'object') return '';
  const userSelected = getScreenListUserSelectedGameCover(item);
  if (userSelected) return userSelected;
  const candidates = [item.igdbCoverUrl, item.cover, item.poster, item.image, item.background_image, item.backgroundImage]
    .map(value => String(value || '').trim())
    .filter(Boolean);
  // v411 hard rule: user-selected IGDB/Twitch cover wins first, then confirmed IGDB/Twitch.
  // Steam, RAWG, TMDB, and other saved fallback images are never returned as final game posters.
  return candidates.find(isScreenListIgdbCoverUrl) || '';
}
function getScreenListNonIgdbGameFallbackCover(item = {}) {
  if (!item || typeof item !== 'object') return '';
  return [item.cover, item.poster, item.image, item.background_image, item.backgroundImage]
    .map(value => String(value || '').trim())
    .find(value => value && !isScreenListIgdbCoverUrl(value)) || '';
}
function getScreenListDisplayGameCover(item = {}) {
  // v412: display order is user-selected/IGDB first, then a visual fallback while IGDB repairs.
  // The fallback is visual only; IGDB repair still keeps running and overwrites it once resolved.
  return getScreenListPreferredGameCover(item) || getScreenListNonIgdbGameFallbackCover(item) || '';
}
function getScreenListGameCoverLookupTitle(item = {}) {
  return String(item?.title || item?.name || item?.gameTitle || '').trim();
}
function getScreenListGameCoverLookupKey(item = {}) {
  return [
    String(item?.steamAppId || item?.appId || '').trim(),
    String(item?.rawgId || item?.id || '').trim(),
    getScreenListGameCoverLookupTitle(item).toLowerCase()
  ].join('|');
}
function shouldForceIgdbCoverBackfill(item = {}) {
  if (!item || !getScreenListGameCoverLookupTitle(item)) return false;
  return !isScreenListIgdbCoverUrl(getScreenListPreferredGameCover(item));
}
async function fetchScreenListIgdbCoverForGame(item = {}) {
  const title = getScreenListGameCoverLookupTitle(item);
  if (!title) return null;
  const cacheKey = getScreenListGameCoverLookupKey(item);
  if (SCREENLIST_IGDB_COVER_LOOKUP_CACHE.has(cacheKey)) return SCREENLIST_IGDB_COVER_LOOKUP_CACHE.get(cacheKey);
  const failedAt = SCREENLIST_IGDB_COVER_FAILURE_CACHE.get(cacheKey) || 0;
  if (failedAt && Date.now() - failedAt < 90 * 1000) return null;
  try {
    const igdbParams = new URLSearchParams({ title, force: '1', strict: '1', t: String(Date.now()) });
    const steamAppId = String(item.steamAppId || item.appId || '').trim();
    const rawgId = String(item.rawgId || item.id || '').trim();
    if (steamAppId) igdbParams.set('steamAppId', steamAppId);
    if (rawgId) igdbParams.set('rawgId', rawgId);
    const res = await fetch('/api/igdb/cover?' + igdbParams.toString(), { cache: 'no-store' });
    const json = res.ok ? await res.json() : null;
    const payload = json?.ok && json.coverUrl && isScreenListIgdbCoverUrl(json.coverUrl) ? json : null;
    if (payload) {
      SCREENLIST_IGDB_COVER_LOOKUP_CACHE.set(cacheKey, payload);
      SCREENLIST_IGDB_COVER_FAILURE_CACHE.delete(cacheKey);
    } else {
      SCREENLIST_IGDB_COVER_FAILURE_CACHE.set(cacheKey, Date.now());
    }
    return payload;
  } catch (error) {
    console.warn('IGDB/Twitch game cover lookup failed:', title, error);
    SCREENLIST_IGDB_COVER_FAILURE_CACHE.set(cacheKey, Date.now());
    return null;
  }
}
function applyScreenListIgdbCoverToGameItem(item = {}, cover = {}) {
  const coverUrl = String(cover?.coverUrl || '').trim();
  if (!item || !coverUrl || !isScreenListIgdbCoverUrl(coverUrl)) return false;
  const changed = item.igdbCoverUrl !== coverUrl || item.cover !== coverUrl || item.background_image !== coverUrl;
  item.igdbCoverUrl = coverUrl;
  item.cover = coverUrl;
  item.poster = coverUrl;
  item.image = coverUrl;
  item.background_image = coverUrl;
  item.coverProvider = 'igdb';
  item.coverSource = 'igdb';
  item.igdbMatchedName = cover.matchedName || item.igdbMatchedName || '';
  item.igdbSlug = cover.slug || item.igdbSlug || '';
  item.igdbCoverUpdatedAt = new Date().toISOString();
  return changed;
}
function applyScreenListUserSelectedGameCoverToItem(item = {}, cover = {}) {
  const coverUrl = String(cover?.coverUrl || cover?.url || '').trim();
  if (!item || !coverUrl || !isScreenListAllowedGameCoverUrl(coverUrl)) return false;
  const changed = item.userSelectedGameCover !== coverUrl || item.cover !== coverUrl;
  item.userSelectedGameCover = coverUrl;
  item.customCover = coverUrl;
  item.selectedCover = coverUrl;
  item.igdbCoverUrl = coverUrl;
  item.cover = coverUrl;
  item.poster = coverUrl;
  item.image = coverUrl;
  item.background_image = coverUrl;
  const selectedSource = isScreenListIgdbCoverUrl(coverUrl) ? 'user-selected-igdb' : 'user-selected-fallback';
  item.coverProvider = selectedSource;
  item.coverSource = selectedSource;
  item.coverLocked = true;
  item.igdbMatchedName = cover.matchedName || cover.name || item.igdbMatchedName || '';
  item.igdbSlug = cover.slug || item.igdbSlug || '';
  item.userSelectedCoverUpdatedAt = new Date().toISOString();
  rememberScreenListUserSelectedGameCover(item, coverUrl);
  return changed;
}
function updateScreenListGamePosterElement(posterEl, coverUrl = '') {
  if (!posterEl || !coverUrl || !isScreenListAllowedGameCoverUrl(coverUrl)) return;
  const img = posterEl.matches?.('img') ? posterEl : posterEl.querySelector?.('img');
  if (img) {
    img.src = coverUrl;
    img.setAttribute('src', coverUrl);
  }
  if (!posterEl.matches?.('img')) {
    posterEl.style.backgroundImage = `url('${coverUrl}')`;
    posterEl.style.backgroundSize = 'cover';
    posterEl.style.backgroundPosition = 'top center';
    posterEl.classList.remove('no-img', 'screenlist-game-cover-pending');
  }
  posterEl.dataset.igdbCoverApplied = '1';
  posterEl.dataset.poster = coverUrl;
  if (typeof scheduleMyListPosterPreload === 'function') scheduleMyListPosterPreload('game-cover-update');
}
async function forceHydrateScreenListGamePosterElement(posterEl, gameLike = {}) {
  if (!posterEl) return null;
  const title = getScreenListGameCoverLookupTitle(gameLike) || posterEl.dataset?.discoverTitle || posterEl.dataset?.gameTitle || '';
  if (!title) return null;
  const payload = {
    ...gameLike,
    title,
    name: gameLike.name || title,
    rawgId: gameLike.rawgId || posterEl.dataset?.mediaId || posterEl.dataset?.rawgId || '',
    id: gameLike.id || posterEl.dataset?.mediaId || posterEl.dataset?.rawgId || '',
    steamAppId: gameLike.steamAppId || posterEl.dataset?.steamAppId || ''
  };
  const cover = await fetchScreenListIgdbCoverForGame(payload);
  if (!cover?.coverUrl || !isScreenListIgdbCoverUrl(cover.coverUrl)) return null;
  applyScreenListIgdbCoverToGameItem(payload, cover);
  updateScreenListGamePosterElement(posterEl, cover.coverUrl);
  const rawgId = String(payload.rawgId || payload.id || '').trim();
  if (rawgId && typeof setGameMediaProfileSeed === 'function') {
    const existing = getGameMediaProfileSeed(rawgId, {}) || {};
    setGameMediaProfileSeed(rawgId, { ...existing, ...payload, igdbCoverUrl: cover.coverUrl, cover: cover.coverUrl, poster: cover.coverUrl, image: cover.coverUrl, background_image: cover.coverUrl });
  }
  return cover;
}
async function ensureScreenListIgdbCoverOnGameDetails(details = {}) {
  const cover = await fetchScreenListIgdbCoverForGame(details);
  if (cover?.coverUrl && isScreenListIgdbCoverUrl(cover.coverUrl)) {
    applyScreenListIgdbCoverToGameItem(details, cover);
    const rawgId = String(details.rawgId || details.id || '').trim();
    if (rawgId) {
      const existing = getGameMediaProfileSeed(rawgId, {}) || {};
      setGameMediaProfileSeed(rawgId, { ...existing, ...details });
    }
  }
  return details;
}
async function backfillIgdbGameCovers() {
  if (_igdbBackfillRunning) return;
  if (activeSection !== 'games') return;
  if (typeof data === 'undefined' || !Array.isArray(data.games)) return;

  const missing = data.games.filter(shouldForceIgdbCoverBackfill);
  if (!missing.length) return;

  _igdbBackfillRunning = true;
  try {
    for (const item of missing) {
      try {
        const json = await fetchScreenListIgdbCoverForGame(item);
        if (!json?.coverUrl) continue;

        // Write to live data
        applyScreenListIgdbCoverToGameItem(item, json);

        // Update the DOM card directly without a full re-render
        const coverEl = document.querySelector(`#card-${CSS.escape(item.id)} .card-cover`);
        if (coverEl) {
          coverEl.style.backgroundImage = `url('${json.coverUrl}')`;
          coverEl.style.backgroundSize = 'cover';
          coverEl.style.backgroundPosition = 'top center';
          coverEl.classList.remove('no-img');
        }

        // Persist to Firebase
        if (typeof writeOwnDataDirect === 'function') {
          const targetData = ownDataCache
            ? cloneListData(ownDataCache)
            : (typeof loadOwnDataFromFirestore === 'function' ? await loadOwnDataFromFirestore() : cloneListData(data));
          if (targetData && Array.isArray(targetData.games)) {
            const idx = targetData.games.findIndex(g => g.id === item.id);
            if (idx !== -1) {
              applyScreenListIgdbCoverToGameItem(targetData.games[idx], json);
              await writeOwnDataDirect(targetData);
              ownDataCache = cloneListData(targetData);
            }
          }
        }

        // Small delay between requests to stay within IGDB rate limits (4 req/s)
        await new Promise(r => setTimeout(r, 280));
      } catch (e) { /* silent */ }
    }
  } finally {
    _igdbBackfillRunning = false;
  }
}


// v411: user-selected game cover picker. User-selected IGDB/Twitch covers override every automatic source.
let screenListGameCoverPickerContext = null;
let screenListGameCoverPickerSearchSeq = 0;
let screenListGameCoverPickerResults = [];

function getScreenListGameItemById(itemId = '') {
  const list = Array.isArray(data?.games) ? data.games : [];
  return list.find(item => String(item.id || '') === String(itemId || '')) || null;
}
function findScreenListGameItemForSeed(rawgId = '', title = '') {
  const list = Array.isArray(data?.games) ? data.games : [];
  const cleanRawg = String(rawgId || '').trim();
  const cleanTitle = normalizeScreenListGameCoverKey(title || '');
  return list.find(item => cleanRawg && String(item.rawgId || item.id || '') === cleanRawg)
    || list.find(item => cleanTitle && normalizeScreenListGameCoverKey(item.title || item.name || '') === cleanTitle)
    || null;
}
function ensureScreenListGameCoverPicker() {
  let overlay = document.getElementById('screenlist-game-cover-picker');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'screenlist-game-cover-picker';
  overlay.className = 'screenlist-game-cover-picker';
  overlay.innerHTML = `
    <div class="screenlist-game-cover-picker-sheet" role="dialog" aria-modal="true" aria-label="Choose game cover">
      <div class="screenlist-game-cover-picker-head">
        <button type="button" class="screenlist-game-cover-picker-back" onclick="closeScreenListGameCoverPicker()">Back</button>
        <div class="screenlist-game-cover-picker-title-wrap">
          <strong>Choose Cover</strong>
          <span id="screenlist-game-cover-picker-title"></span>
        </div>
      </div>
      <div class="screenlist-game-cover-picker-search">
        <input id="screenlist-game-cover-picker-input" type="search" placeholder="Automatic cover search" autocomplete="off" readonly aria-readonly="true">
        <button type="button" onclick="searchScreenListGameCoverPicker()">Refresh</button>
      </div>
      <div class="screenlist-game-cover-picker-status" id="screenlist-game-cover-picker-status">Loading cover choices...</div>
      <div class="screenlist-game-cover-picker-grid" id="screenlist-game-cover-picker-grid"></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeScreenListGameCoverPicker();
  });
  const input = overlay.querySelector('#screenlist-game-cover-picker-input');
  if (input) {
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        searchScreenListGameCoverPicker();
      }
    });
  }
  return overlay;
}
function openScreenListGameCoverPickerForItem(itemId = '') {
  const item = getScreenListGameItemById(itemId);
  if (!item) return;
  openScreenListGameCoverPicker({ itemId: String(item.id || ''), rawgId: String(item.rawgId || item.id || ''), steamAppId: String(item.steamAppId || item.appId || ''), title: item.title || item.name || '', item });
}
function openScreenListGameCoverPickerForSeed(rawgId = '', title = '') {
  const item = findScreenListGameItemForSeed(rawgId, title);
  openScreenListGameCoverPicker({ itemId: String(item?.id || ''), rawgId: String(rawgId || item?.rawgId || item?.id || ''), steamAppId: String(item?.steamAppId || item?.appId || ''), title: title || item?.title || item?.name || '', item });
}
function openScreenListGameCoverPicker(context = {}) {
  if (!currentUser || viewingUser) return;
  const overlay = ensureScreenListGameCoverPicker();
  const title = String(context.title || context.item?.title || context.item?.name || '').trim();
  screenListGameCoverPickerContext = { ...context, title };
  document.body.classList.add('screenlist-game-cover-picker-open');
  overlay.classList.add('open');
  const titleEl = overlay.querySelector('#screenlist-game-cover-picker-title');
  const input = overlay.querySelector('#screenlist-game-cover-picker-input');
  if (titleEl) titleEl.textContent = title;
  if (input) input.value = title ? `${title} official cover` : '';
  loadScreenListGameCoverPickerResults(title);
}
function closeScreenListGameCoverPicker() {
  const overlay = document.getElementById('screenlist-game-cover-picker');
  if (overlay) overlay.classList.remove('open');
  document.body.classList.remove('screenlist-game-cover-picker-open');
  screenListGameCoverPickerContext = null;
  screenListGameCoverPickerResults = [];
}
function setScreenListGameCoverPickerStatus(message = '') {
  const status = document.getElementById('screenlist-game-cover-picker-status');
  if (status) status.textContent = message;
}
function renderScreenListGameCoverPickerResults(groups = []) {
  const grid = document.getElementById('screenlist-game-cover-picker-grid');
  if (!grid) return;
  const safeGroups = Array.isArray(groups)
    ? groups.map(group => ({
      ...group,
      results: Array.isArray(group?.results) ? group.results.filter(row => row?.coverUrl && isScreenListAllowedGameCoverUrl(row.coverUrl)) : []
    })).filter(group => group.results.length || group.keepEmpty)
    : [];
  if (!safeGroups.length) {
    grid.innerHTML = '';
    screenListGameCoverPickerResults = [];
    setScreenListGameCoverPickerStatus('No cover choices loaded yet.');
    return;
  }
  screenListGameCoverPickerResults = [];
  setScreenListGameCoverPickerStatus('IGDB covers load first. Web cover results appear below automatically.');
  grid.innerHTML = safeGroups.map(group => {
    const cards = group.results.length ? group.results.map(result => {
      const index = screenListGameCoverPickerResults.push(result) - 1;
      const label = result.name || result.matchedName || `${group.title} cover`;
      const meta = [result.provider, result.source].filter(Boolean).join(' | ');
      return `
        <button type="button" class="screenlist-game-cover-choice" onclick="selectScreenListGameCoverChoice(${index})" data-cover-index="${index}">
          <img src="${escAttr(result.coverUrl)}" alt="${escAttr(label)}" loading="lazy">
          <span>${escHtml(label)}</span>
          <small>${escHtml(meta || group.title)}</small>
        </button>
      `;
    }).join('') : `<div class="screenlist-game-cover-empty">${escHtml(group.emptyMessage || 'No cover results found for this source.')}</div>`;
    return `
      <section class="screenlist-game-cover-group">
        <div class="screenlist-game-cover-group-head">
          <span>${escHtml(group.title || 'Covers')}</span>
        </div>
        ${group.description ? `<p class="screenlist-game-cover-group-copy">${escHtml(group.description)}</p>` : ''}
        <div class="screenlist-game-cover-choice-grid">${cards}</div>
      </section>
    `;
  }).join('');
}
async function readScreenListCoverPickerJson(response) {
  if (!response) return null;
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}
async function loadScreenListGameCoverPickerResults(query = '') {
  const context = screenListGameCoverPickerContext || {};
  const cleanQuery = String(query || context.title || '').trim();
  if (!cleanQuery) return;
  const seq = ++screenListGameCoverPickerSearchSeq;
  setScreenListGameCoverPickerStatus('Loading IGDB and web cover choices...');
  const grid = document.getElementById('screenlist-game-cover-picker-grid');
  if (grid) grid.innerHTML = '';
  screenListGameCoverPickerResults = [];
  try {
    const params = new URLSearchParams({ title: cleanQuery, force: '1', t: String(Date.now()) });
    const steamAppId = String(context.steamAppId || context.item?.steamAppId || context.item?.appId || '').trim();
    if (steamAppId) params.set('steamAppId', steamAppId);
    const webParams = new URLSearchParams({ title: cleanQuery, limit: '6', force: '1', t: String(Date.now()) });
    const [igdbFetch, webFetch] = await Promise.allSettled([
      fetch('/api/igdb/covers?' + params.toString(), { cache: 'no-store' }),
      fetch('/api/game/web-covers?' + webParams.toString(), { cache: 'no-store' })
    ]);
    const igdbRes = igdbFetch.status === 'fulfilled' ? igdbFetch.value : null;
    const webRes = webFetch.status === 'fulfilled' ? webFetch.value : null;
    const json = await readScreenListCoverPickerJson(igdbRes);
    const webJson = await readScreenListCoverPickerJson(webRes);
    if (seq !== screenListGameCoverPickerSearchSeq) return;
    const igdbResults = Array.isArray(json?.results) ? json.results.filter(row => row?.coverUrl && isScreenListAllowedGameCoverUrl(row.coverUrl)) : [];
    const fallbackCover = getScreenListNonIgdbGameFallbackCover(context.item || context || {});
    const otherSourceResults = [];
    if (fallbackCover && !igdbResults.some(row => String(row.coverUrl || '') === fallbackCover)) {
      otherSourceResults.push({ name: 'Current cover', matchedName: context.title || cleanQuery, coverUrl: fallbackCover, source: 'Current Cover', provider: 'Current Cover', matchMethod: 'current_fallback' });
    }
    const webResults = Array.isArray(webJson?.results) ? webJson.results.filter(row => row?.coverUrl && isScreenListAllowedGameCoverUrl(row.coverUrl)).slice(0, 6) : [];
    const webEmptyMessage = webJson?.error
      ? `Web cover search did not return usable images: ${webJson.error}`
      : webFetch.status === 'rejected'
        ? 'Web cover search could not be reached. Existing cover choices are still available.'
      : 'No Tavily web cover results found for this title yet.';
    renderScreenListGameCoverPickerResults([
      { title: 'IGDB / Twitch Covers', description: 'Primary database cover matches for this game.', results: igdbResults },
      { title: 'Other Sources', description: 'Existing non-IGDB fallback covers already tied to this title.', results: otherSourceResults },
      { title: 'Web Cover Results', description: 'Top automatic web image matches for "game title official cover".', results: webResults, keepEmpty: true, emptyMessage: webEmptyMessage }
    ]);
  } catch (error) {
    console.warn('Game cover picker search failed:', error);
    if (seq !== screenListGameCoverPickerSearchSeq) return;
    const fallbackCover = getScreenListNonIgdbGameFallbackCover(context.item || context || {});
    if (fallbackCover) {
      renderScreenListGameCoverPickerResults([
        { title: 'Other Sources', description: 'Existing non-IGDB fallback covers already tied to this title.', results: [{ name: 'Current cover', matchedName: context.title || cleanQuery, coverUrl: fallbackCover, source: 'Current Cover', provider: 'Current Cover', matchMethod: 'current_fallback' }] }
      ]);
      setScreenListGameCoverPickerStatus('Live cover search failed, but the current saved cover is still available.');
    } else {
      setScreenListGameCoverPickerStatus('Cover search failed. Try refresh again in a moment.');
    }
  }
}
function searchScreenListGameCoverPicker() {
  loadScreenListGameCoverPickerResults(screenListGameCoverPickerContext?.title || '');
}
function getScreenListGameCoverPickerResults() {
  return Array.isArray(screenListGameCoverPickerResults) ? screenListGameCoverPickerResults : [];
}
async function selectScreenListGameCoverChoice(index = 0) {
  const results = getScreenListGameCoverPickerResults();
  const choice = results[Number(index) || 0];
  const coverUrl = String(choice?.coverUrl || '').trim();
  if (!coverUrl || !isScreenListAllowedGameCoverUrl(coverUrl)) return;
  const context = screenListGameCoverPickerContext || {};
  const item = context.itemId ? getScreenListGameItemById(context.itemId) : findScreenListGameItemForSeed(context.rawgId, context.title);
  const coverPayload = { ...choice, coverUrl, matchedName: choice.name || choice.matchedName || '' };
  if (item) {
    applyScreenListUserSelectedGameCoverToItem(item, coverPayload);
    rememberScreenListUserSelectedGameCover(item, coverUrl);
    save();
  } else {
    rememberScreenListUserSelectedGameCover({ title: context.title, rawgId: context.rawgId, steamAppId: context.steamAppId }, coverUrl);
  }
  updateScreenListVisibleGameCoverAfterSelection(item || context, coverUrl);
  closeScreenListGameCoverPicker();
  if (typeof showToast === 'function') showToast('Game cover updated');
}
function updateScreenListVisibleGameCoverAfterSelection(itemLike = {}, coverUrl = '') {
  if (!coverUrl || !isScreenListAllowedGameCoverUrl(coverUrl)) return;
  const itemId = String(itemLike?.id || itemLike?.itemId || '').trim();
  if (itemId) {
    const coverEl = document.querySelector(`#card-${CSS.escape(itemId)} .card-cover`);
    if (coverEl) {
      coverEl.style.backgroundImage = `url('${coverUrl}')`;
      coverEl.style.backgroundSize = 'cover';
      coverEl.style.backgroundPosition = 'top center';
      coverEl.classList.remove('no-img', 'screenlist-game-cover-pending');
      coverEl.textContent = '';
    }
  }
  const titleKey = normalizeScreenListGameCoverKey(itemLike?.title || itemLike?.name || screenListGameCoverPickerContext?.title || '');
  document.querySelectorAll('[data-game-title], [data-discover-title]').forEach(node => {
    const nodeTitle = normalizeScreenListGameCoverKey(node.dataset.gameTitle || node.dataset.discoverTitle || '');
    if (titleKey && nodeTitle && titleKey === nodeTitle) updateScreenListGamePosterElement(node, coverUrl);
  });
  document.querySelectorAll('.game-media-poster, .game-media-hero').forEach(node => updateScreenListGamePosterElement(node, coverUrl));
  const rawgId = String(itemLike?.rawgId || itemLike?.id || screenListGameCoverPickerContext?.rawgId || '').trim();
  if (rawgId && typeof setGameMediaProfileSeed === 'function') {
    const existing = getGameMediaProfileSeed(rawgId, {}) || {};
    setGameMediaProfileSeed(rawgId, { ...existing, ...itemLike, userSelectedGameCover: coverUrl, igdbCoverUrl: coverUrl, cover: coverUrl, poster: coverUrl, image: coverUrl, background_image: coverUrl, coverSource: isScreenListIgdbCoverUrl(coverUrl) ? 'user-selected-igdb' : 'user-selected-fallback', coverLocked: true });
  }
}


if (typeof window !== 'undefined') {
  window.openScreenListGameCoverPickerForItem = openScreenListGameCoverPickerForItem;
  window.openScreenListGameCoverPickerForSeed = openScreenListGameCoverPickerForSeed;
  window.openScreenListGameCoverPicker = openScreenListGameCoverPicker;
  window.closeScreenListGameCoverPicker = closeScreenListGameCoverPicker;
  window.searchScreenListGameCoverPicker = searchScreenListGameCoverPicker;
  window.selectScreenListGameCoverChoice = selectScreenListGameCoverChoice;
}

async function goToDefaultMyListsPage() {
  try {
    if (typeof isDirectMessagesPageOpen === 'function' && isDirectMessagesPageOpen()) {
      closeDirectMessagesPage(true);
    }
  } catch (error) {
    console.warn('Default My Lists shortcut skipped DM close:', error);
  }

  try {
    const mediaOverlay = document.getElementById('discover-media-profile');
    if (mediaOverlay && typeof closeMediaProfileOverlayImmediately === 'function') {
      closeMediaProfileOverlayImmediately(mediaOverlay);
    }
  } catch (error) {
    console.warn('Default My Lists shortcut skipped media profile close:', error);
  }

  try {
    if (document.body.classList.contains('profile-active') && typeof closeProfile === 'function') {
      closeProfile();
    }
  } catch (error) {
    console.warn('Default My Lists shortcut skipped profile close:', error);
  }

  closeSortDropdown();
  if (typeof clearListSearch === 'function') clearListSearch();
  activeSection = 'shows';
  activeTab = 'watching';
  activeGamePlayingFilter = 'live';
  if (viewingUser && typeof backToMyList === 'function') {
    await backToMyList('mylist');
    activeSection = 'shows';
    activeTab = 'watching';
    activeGamePlayingFilter = 'live';
  }
  setBottomNavVisibility(true);
  syncMainNavButtons('mylist');
  setMainNavVisibility('mylist');
  render();
  persistUiState();

  const myListView = document.getElementById('mylist-view');
  if (myListView && typeof myListView.scrollTo === 'function') myListView.scrollTo({ top: 0, behavior: 'auto' });
  window.scrollTo({ top: 0, behavior: 'auto' });
}
function onSearch(q) {
  if (typeof clearLastEditedResortHold === 'function') clearLastEditedResortHold();
  searchQuery = q;
  render();
}

function findOwnLibraryItemRecord(id = '', sectionHint = '') {
  const key = String(id || '').trim();
  if (!key || !data) return { item: null, index: -1, section: '', items: null };
  const candidates = [];
  const hint = String(sectionHint || '').trim();
  if (hint) candidates.push(hint);
  if (activeSection && !candidates.includes(activeSection)) candidates.push(activeSection);
  (SCREENLIST_SECTIONS || []).forEach(section => {
    if (!candidates.includes(section)) candidates.push(section);
  });
  for (const section of candidates) {
    const items = Array.isArray(data[section]) ? data[section] : [];
    const index = items.findIndex(entry =>
      String(entry?.id || '') === key ||
      (section === 'games' && getScreenListGameStableKey(entry) === key)
    );
    if (index >= 0) {
      return { item: items[index], index, section, items };
    }
  }
  return { item: null, index: -1, section: '', items: null };
}

function applyMyListStatusChange(id, status, rating = null, sectionHint = '') {
  const record = findOwnLibraryItemRecord(id, sectionHint);
  const item = record.item;
  if (!item || !record.section) return null;
  const validStatuses = getMyListStatusButtonConfigs(record.section).map(entry => entry.status);
  if (!validStatuses.includes(status)) return null;
  item.status = status;
  const hasRatingEdit = rating !== null && rating !== undefined && Number(rating || 0) > 0;
  if (hasRatingEdit) {
    item.rating = Number(rating || 0);
  }
  if (hasRatingEdit && typeof markOwnItemLastEdited === 'function') markOwnItemLastEdited(item, record.section);
  else touchItem(item);
  if (isShowSection(record.section)) {
    const total = Number(item.totalEps || item.totalEpisodes || item.episodes?.length || 0);
    if (Array.isArray(item.episodes) && item.episodes.length) {
      if (status === "watched") item.episodes.forEach(e => e.watched = true);
      if (status === "planned") item.episodes.forEach(e => e.watched = false);
      item.currentEp = item.episodes.filter(e => e && e.watched).length;
      item.totalEpisodes = item.episodes.length;
      item.totalEps = item.episodes.length;
    } else {
      if (status === "watched") item.currentEp = total;
      if (status === "planned") item.currentEp = 0;
    }
  }
  save();
  render();
  return item;
}

function changeStatus(id, status) {
  const record = findOwnLibraryItemRecord(id, activeSection);
  const item = record.item;
  if (!item || !record.section) return;
  const validStatuses = getMyListStatusButtonConfigs(record.section).map(entry => entry.status);
  if (!validStatuses.includes(status)) return;
  const wasCompleted = item.status === "watched";
  if (status === "watched" && !wasCompleted && typeof openScreenListCompletionRatingPrompt === 'function') {
    openScreenListCompletionRatingPrompt({
      item: { ...item },
      section: record.section,
      status,
      initialRating: Number(item.rating || 0),
      source: 'my-list-status',
      onApply: async (rating) => {
        const updated = applyMyListStatusChange(id, status, rating, record.section);
        return {
          ok: !!updated,
          item: updated ? { ...updated } : item,
          section: record.section,
          status,
          rating: Number(rating || updated?.rating || 0) || 0
        };
      }
    });
    return;
  }
  applyMyListStatusChange(id, status, null, record.section);
}

function removeWatchTogetherGroupFromLocalState(groupId = '') {
  if (!groupId) return;
  watchTogetherGroups = watchTogetherGroups.filter(group => group && group.id !== groupId);
  watchTogetherIncomingRequests = watchTogetherIncomingRequests.filter(group => group && group.id !== groupId);
  watchTogetherOutgoingRequests = watchTogetherOutgoingRequests.filter(group => group && group.id !== groupId);
  watchTogetherIncomingRequestIds = watchTogetherIncomingRequestIds.filter(id => id !== groupId);
  watchTogetherOutgoingRequestIds = watchTogetherOutgoingRequestIds.filter(id => id !== groupId);
  watchTogetherApprovedRequestIds = watchTogetherApprovedRequestIds.filter(id => id !== groupId);
  delete watchTogetherIncomingRequestPayloadMap[groupId];
  delete watchTogetherOutgoingRequestPayloadMap[groupId];
  delete watchTogetherApprovedRequestPayloadMap[groupId];
}

function getWatchTogetherGroupParticipantUids(group = {}) {
  return [...new Set([
    group.ownerUid,
    ...(Array.isArray(group.participantUids) ? group.participantUids : []),
    ...(Array.isArray(group.pendingUids) ? group.pendingUids : []),
    ...(Array.isArray(group.approvedUids) ? group.approvedUids : []),
    ...(Array.isArray(group.rejectedUids) ? group.rejectedUids : [])
  ].filter(Boolean))];
}

function getWatchTogetherGroupsTouchingItemForCurrentUser(item = {}, section = activeSection) {
  if (!currentUser || !canUseWatchTogetherSection(section)) return [];
  const allGroups = mergeWatchTogetherGroupsById(
    watchTogetherGroups,
    getWatchTogetherMirroredPayloadGroups()
  );
  return allGroups.filter(group => {
    if (!group || !group.id || !watchTogetherGroupMatchesItem(group, item, section)) return false;
    const touchedUids = getWatchTogetherGroupParticipantUids(group);
    return group.ownerUid === currentUser.uid || touchedUids.includes(currentUser.uid);
  });
}

async function clearWatchTogetherGroupEverywhere(group = {}) {
  const groupId = group.id || '';
  if (!groupId) return;
  const uids = getWatchTogetherGroupParticipantUids(group);
  await Promise.all(uids.flatMap(uid => [
    clearWatchTogetherRequestMirror(uid, 'incoming', groupId),
    clearWatchTogetherRequestMirror(uid, 'outgoing', groupId),
    clearWatchTogetherApprovedMirror(uid, groupId)
  ]));
  removeWatchTogetherGroupFromLocalState(groupId);
}

async function detachCurrentUserFromWatchTogetherGroup(group = {}) {
  if (!currentUser || !group?.id) return;
  const groupId = group.id;
  if (group.ownerUid === currentUser.uid) {
    await clearWatchTogetherGroupEverywhere(group);
    return;
  }

  const uid = currentUser.uid;
  const pendingUids = Array.isArray(group.pendingUids) ? group.pendingUids.filter(Boolean) : [];
  const approvedUids = Array.isArray(group.approvedUids) ? group.approvedUids.filter(Boolean) : [];
  const remainingPending = pendingUids.filter(memberUid => memberUid !== uid);
  const remainingApproved = approvedUids.filter(memberUid => memberUid !== uid);
  const remainingParticipants = (Array.isArray(group.participantUids) ? group.participantUids : []).filter(memberUid => memberUid !== uid);
  const hasApprovedPartner = remainingApproved.some(memberUid => memberUid && memberUid !== group.ownerUid);
  const hasPendingPartner = remainingPending.length > 0;

  if (!hasApprovedPartner && !hasPendingPartner) {
    await clearWatchTogetherGroupEverywhere(group);
    return;
  }

  const nextStatus = hasPendingPartner ? 'pending' : 'approved';
  const updatedGroup = {
    ...group,
    pendingUids: remainingPending,
    approvedUids: remainingApproved,
    participantUids: remainingParticipants,
    status: nextStatus,
    updatedAtMs: Date.now()
  };

  const writes = [
    clearWatchTogetherRequestMirror(uid, 'incoming', groupId),
    clearWatchTogetherRequestMirror(uid, 'outgoing', groupId),
    clearWatchTogetherApprovedMirror(uid, groupId)
  ];

  if (remainingPending.length) {
    writes.push(setWatchTogetherRequestMirror(group.ownerUid, 'outgoing', groupId, updatedGroup, { includeInRequestList: true }));
    writes.push(...remainingPending.map(memberUid => setWatchTogetherRequestMirror(memberUid, 'incoming', groupId, updatedGroup)));
  } else {
    writes.push(clearWatchTogetherRequestMirror(group.ownerUid, 'outgoing', groupId));
  }
  writes.push(...remainingApproved.map(memberUid => setWatchTogetherApprovedMirror(memberUid, groupId, updatedGroup)));

  await Promise.all(writes);
  removeWatchTogetherGroupFromLocalState(groupId);
}

async function cleanupWatchTogetherForDeletedItem(item = {}, section = activeSection) {
  if (!currentUser || !item || !canUseWatchTogetherSection(section)) return;
  const groups = getWatchTogetherGroupsTouchingItemForCurrentUser(item, section);
  if (!groups.length) return;
  await Promise.all(groups.map(group => detachCurrentUserFromWatchTogetherGroup(group)));
  watchTogetherAverageCache = {};
  updateRequestsBadges();
  if (activeFriendsTab === 'activity' && isWatchActivitySubTab()) renderActiveWatchActivitySubTab(true);
}

function resetDeleteButton(btn) {
  if (!btn) return;
  btn.dataset.confirmDelete = '';
  btn.textContent = '×';
  btn.style.color = '#5c5278';
  btn.style.fontSize = '16px';
  btn.title = 'Delete';
}

function deleteItem(eventOrId, maybeId) {
  const clickEvent = maybeId !== undefined ? eventOrId : window.event;
  const id = String(maybeId !== undefined ? maybeId : eventOrId);
  const btn = clickEvent?.currentTarget || clickEvent?.target;
  clickEvent?.stopPropagation?.();
  if (!id || viewingUser) return;

  if (btn && btn.dataset.confirmDelete !== id) {
    btn.dataset.confirmDelete = id;
    btn.textContent = '✓';
    btn.style.color = '#ef4444';
    btn.style.fontSize = '14px';
    btn.title = 'Tap again to confirm';
    setTimeout(() => {
      if (btn.dataset.confirmDelete === id) resetDeleteButton(btn);
    }, 1500);
    return;
  }

  const sectionAtDelete = activeSection;
  const deletedItem = (data[sectionAtDelete] || []).find(item => String(item.id) === id);
  data[sectionAtDelete] = (data[sectionAtDelete] || []).filter(item => String(item.id) !== id);
  save();
  render();

  if (deletedItem) {
    cleanupWatchTogetherForDeletedItem(deletedItem, sectionAtDelete).catch(error => {
      console.warn('Shared Watch cleanup after library delete failed:', error);
      showToast('Removed from library. Shared Watch cleanup will retry when you reopen.');
    });
  }
}

function updateSeasonRatingUI(item = {}, seasonNum = '', section = activeSection) {
  if (!item?.id || !seasonNum) return;
  const prefix = `season:${seasonNum}`;
  const rating = Number((item.seasonRatings && item.seasonRatings[seasonNum]) || 0);
  const tmp = document.createElement('div');
  tmp.innerHTML = buildRatingStarsMarkup(rating, item.id, prefix, 14, section, !viewingUser);
  const replacement = tmp.firstElementChild;
  if (replacement) {
    document.querySelectorAll('.stars[data-item-id][data-prefix]').forEach(node => {
      if (node.dataset.itemId === String(item.id) && node.dataset.prefix === prefix) {
        node.replaceWith(replacement.cloneNode(true));
      }
    });
  }

  const seasonBody = document.getElementById(`s-eps-${item.id}-${seasonNum}`);
  const seasonBlock = seasonBody ? seasonBody.closest('.season-block') : null;
  const headerLeft = seasonBlock ? seasonBlock.querySelector('.season-header-left') : null;
  if (!headerLeft) return;
  let chip = headerLeft.querySelector('.season-rating-chip');
  if (rating > 0) {
    if (!chip) {
      chip = document.createElement('span');
      chip.className = 'season-rating-chip';
      const progress = headerLeft.querySelector('.season-progress');
      if (progress && progress.parentNode === headerLeft) progress.insertAdjacentElement('afterend', chip);
      else headerLeft.appendChild(chip);
    }
    chip.textContent = `★ ${formatRatingValueForSection(rating, section)}`;
  } else if (chip) {
    chip.remove();
  }
}

function applyWatchlistPriorityDomino(section = activeSection, targetItem = {}, targetPriority = 0) {
  if (!targetItem) return;
  const now = new Date().toISOString();
  const plannedItems = (Array.isArray(data?.[section]) ? data[section] : [])
    .filter(item => item && String(item.status || '') === 'planned');
  const markEdited = (item) => {
    item.lastEditedAt = now;
    item.dateLastEdited = now;
  };
  if (!targetPriority) {
    delete targetItem.watchPriority;
    delete targetItem.watchlistPriority;
    markEdited(targetItem);
    return;
  }

  const targetKey = typeof getSortItemKey === 'function'
    ? getSortItemKey(targetItem)
    : String(targetItem.id || targetItem.title || '');
  const occupied = new Set([targetPriority]);
  const placements = [{ item: targetItem, priority: targetPriority }];
  plannedItems
    .filter(item => item !== targetItem)
    .map((item, index) => ({
      item,
      index,
      key: typeof getSortItemKey === 'function' ? getSortItemKey(item) : String(item.id || item.title || ''),
      priority: normalizeWatchlistPriorityValue(item.watchPriority || item.watchlistPriority)
    }))
    .filter(entry => entry.priority > 0 && entry.key !== targetKey)
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      const aAdded = Date.parse(a.item.dateAdded || a.item.createdAt || '') || 0;
      const bAdded = Date.parse(b.item.dateAdded || b.item.createdAt || '') || 0;
      if (aAdded !== bAdded) return bAdded - aAdded;
      return a.index - b.index;
    })
    .forEach(entry => {
      let nextPriority = entry.priority;
      while (occupied.has(nextPriority)) nextPriority += 1;
      occupied.add(nextPriority);
      placements.push({ item: entry.item, priority: nextPriority });
    });

  placements.forEach(({ item, priority }) => {
    item.watchPriority = priority;
    delete item.watchlistPriority;
    markEdited(item);
  });
}

function setWatchlistPriority(itemId = '', rawValue = '') {
  if (viewingUser) return;
  const record = findOwnLibraryItemRecord(itemId, activeSection);
  const item = record.item;
  const section = record.section || activeSection;
  if (!item || !canUseWatchlistPriority(item, section, activeTab)) return;
  applyWatchlistPriorityDomino(section, item, normalizeWatchlistPriorityValue(rawValue));
  save();
  if (getActiveSortKey() === 'watchlist-priority') {
    if (typeof clearLastEditedResortHold === 'function') clearLastEditedResortHold(getSortStateKey(section, activeTab));
  }
  render();
}

let _lastRate = { key: null, time: 0 };
// v436: rating-edit activity guard.
// Each time the user rates a title we now decide whether this is a FIRST-TIME
// rating (0 → non-zero) or an EDIT (non-zero → different value). Only first-time
// ratings update dateModified, because dateModified is the timestamp that drives
// 'rated' activity events in processUserItems / buildFriendWatchlistDiffEvents.
// Rating edits still update lastEditedAt (for Last-Edited sort) but do NOT touch
// dateModified, so they are invisible to the activity pipeline.
function _shelfdMarkRatingEdit(item, section) {
  const now = new Date().toISOString();
  item.lastEditedAt = now;
  item.dateLastEdited = now;
  item.shelfdRatingEditedAt = now;
  // Intentionally NOT setting item.dateModified — that field is used by
  // processUserItems to detect changes that should appear in the Activity Feed.
  // v441: activate the sort hold so the card doesn't jump position. This path
  // bypasses markOwnItemLastEdited (to protect dateModified), so we set the hold
  // directly here.
  if (typeof sessionLastEditedResortHold !== 'undefined' && typeof getSortStateKey === 'function') {
    sessionLastEditedResortHold[getSortStateKey()] = true;
  }
}

function rate(itemId, prefix, score) {
  // Debounce: ignore identical rate within 350ms (prevents touch+click double-fire from toggling off)
  const key = itemId + '|' + prefix + '|' + score;
  const now = Date.now();
  if (_lastRate.key === key && now - _lastRate.time < 350) return;
  _lastRate = { key, time: now };

  const record = findOwnLibraryItemRecord(itemId, activeSection);
  const item = record.item;
  if (!item) return;
  const section = record.section || activeSection;

  // Capture the pre-change rating so we can classify first-time vs edit below.
  const prevOverallRating = prefix === 'overall' ? Number(item.rating || 0) : null;
  let inlineSeasonRatingNum = '';

  if (prefix === "overall") {
    item.rating = item.rating === score ? 0 : score;
    /* v560: timestamp the show-rating change so the activity processor
       can fire a 'rated' activity ONLY when the show rating actually
       changed (instead of any time dateModified updates). */
    if (Number(item.rating) > 0) {
      item.lastShowRatingAt = new Date().toISOString();
    }
  } else if (prefix.startsWith("season:")) {
    const sNum = parseInt(prefix.slice(7));
    if (!item.seasonRatings) item.seasonRatings = {};
    item.seasonRatings[sNum] = (item.seasonRatings[sNum] === score) ? 0 : score;
    inlineSeasonRatingNum = String(sNum);
    /* v560: track most-recent season rating so the activity feed can fire
       a SEPARATE 'season-rated' activity card (not mergeable). */
    if (Number(item.seasonRatings[sNum]) > 0) {
      item.lastSeasonRatingValue = Number(item.seasonRatings[sNum]);
      item.lastSeasonRatingNum = String(sNum);
      item.lastSeasonRatingAt = new Date().toISOString();
    }
  } else if (prefix.startsWith("ep:")) {
    const epId = prefix.slice(3);
    const ep = (item.episodes || []).find(e => e.id === epId);
    if (ep) ep.rating = ep.rating === score ? 0 : score;
    /* v557: track the most recent episode rating on the item so the
       activity feed's merged "watched + rated" card shows
       "EP rated ★ {value}" rather than the show's rating. Mirrors the
       tracking that rateEpPopup writes. */
    if (ep && Number(ep.rating) > 0) {
      item.lastEpisodeRatingValue = Number(ep.rating);
      item.lastEpisodeRatingAt = new Date().toISOString();
      item.lastEpisodeRatingEpId = String(epId || '');
    }
  }

  const newOverallRating = prefix === 'overall' ? Number(item.rating || 0) : null;
  const isFirstTimeRating = prefix === 'overall' && prevOverallRating === 0 && newOverallRating > 0;
  const isRatingEdit      = prefix === 'overall' && prevOverallRating > 0 && newOverallRating > 0;

  if (isFirstTimeRating) {
    // First-time: normal edit tracking — updates dateModified so activity fires.
    item.shelfdRatingFirstSetAt = item.shelfdRatingFirstSetAt || new Date().toISOString();
    if (typeof markOwnItemLastEdited === 'function') markOwnItemLastEdited(item, section);
    else touchItem(item);
  } else if (isRatingEdit) {
    // Edit existing rating: update lastEditedAt only — do NOT touch dateModified.
    _shelfdMarkRatingEdit(item, section);
  } else {
    // Season/episode sub-rating or toggle-to-zero: behave like an edit (no new activity).
    if (typeof markOwnItemLastEdited === 'function') markOwnItemLastEdited(item, section);
    else touchItem(item);
  }

  save();
  if (inlineSeasonRatingNum) updateSeasonRatingUI(item, inlineSeasonRatingNum, section);
  else render();
  if (score > 0) playRatingAnimation(itemId, prefix);

  // v442: defer the "Rating updated privately" toast until AFTER the star animation
  // finishes. The toast was previously appended synchronously, which forced a paint
  // / reflow at the same instant playRatingAnimation queued its first frame and
  // visibly hitched the star animation on mobile/PWA. We now wait long enough for
  // the longest possible per-star animation to complete (stagger * (N-1) + duration
  // ≈ 9 * 70 + 620 = ~1.25s upper bound; we cap at ~900ms because the visible
  // intensity peak lands well before the final tail). Toast is canceled if the user
  // immediately edits again — showRatingEditPrivateToast already removes the prior
  // toast/timer in that case.
  if (isRatingEdit) {
    if (typeof _shelfdRatingEditDeferredTimer !== 'undefined' && _shelfdRatingEditDeferredTimer) {
      clearTimeout(_shelfdRatingEditDeferredTimer);
    }
    _shelfdRatingEditDeferredTimer = setTimeout(() => {
      _shelfdRatingEditDeferredTimer = null;
      showRatingEditPrivateToast(item, section, newOverallRating);
    }, 900);
  }
}
let _shelfdRatingEditDeferredTimer = null;

// v436: shown after an existing (non-first-time) rating is edited. Keeps the
// change private but offers a one-tap "Post update" to share it if wanted.
let _shelfdRatingEditToastItem = null;
let _shelfdRatingEditToastTimer = null;
function showRatingEditPrivateToast(item, section, newRating) {
  const existing = document.getElementById('shelfd-rating-edit-toast');
  if (existing) existing.remove();
  if (_shelfdRatingEditToastTimer) { clearTimeout(_shelfdRatingEditToastTimer); _shelfdRatingEditToastTimer = null; }
  _shelfdRatingEditToastItem = { item: { ...item }, section, newRating };
  const toast = document.createElement('div');
  toast.id = 'shelfd-rating-edit-toast';
  toast.className = 'app-toast shelfd-rating-edit-toast';
  toast.setAttribute('role', 'status');
  toast.innerHTML = `<span class="shelfd-rating-edit-toast-msg">Rating updated privately</span><button class="shelfd-rating-edit-toast-post-btn" type="button" onclick="shelfdPostRatingEditUpdate()">Post update</button>`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  _shelfdRatingEditToastTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => { toast.remove(); _shelfdRatingEditToastItem = null; }, 240);
    _shelfdRatingEditToastTimer = null;
  }, 4500);
}

function shelfdPostRatingEditUpdate() {
  const stored = _shelfdRatingEditToastItem;
  const toast = document.getElementById('shelfd-rating-edit-toast');
  if (toast) { toast.classList.remove('show'); setTimeout(() => toast.remove(), 240); }
  if (_shelfdRatingEditToastTimer) { clearTimeout(_shelfdRatingEditToastTimer); _shelfdRatingEditToastTimer = null; }
  _shelfdRatingEditToastItem = null;
  if (!stored || typeof openScreenListActivityPostPromptForRatingEdit !== 'function') return;
  openScreenListActivityPostPromptForRatingEdit(stored.item, stored.section, stored.newRating);
}

function playRatingAnimation(itemId, prefix) {
  // Look up the actual score from the data so animation intensity matches
  const record = findOwnLibraryItemRecord(itemId, activeSection);
  const item = record.item;
  if (!item) return;
  let score = 0;
  if (prefix === 'overall') score = item.rating || 0;
  else if (prefix.startsWith('season:')) {
    const sNum = parseInt(prefix.slice(7));
    score = (item.seasonRatings && item.seasonRatings[sNum]) || 0;
  }
  if (score < 1) return;

  // Map score (1-10) to 0-1 intensity, ramps faster at top
  const t = Math.pow(score / 10, 1.3);
  const peakScale = 1.3 + t * 0.7;       // 1.34 → 2.0
  const midScale  = 1.05 + t * 0.18;
  const glow      = 5 + t * 16;          // 5.5 → 21px
  const glowAlpha = 0.5 + t * 0.5;       // 0.53 → 1.0
  const stagger   = (0.07 - t * 0.04) * 1000;
  const duration  = 380 + t * 240;
  const isPerfect = score === 10;

  // ONE drop-shadow only — color shifts toward magenta at high scores instead of stacking shadows
  // (multiple drop-shadows are GPU-expensive and cause the stutter you saw)
  const glowR = Math.round(251 - t * 15);  // 251 → 236
  const glowG = Math.round(191 - t * 119); // 191 → 72
  const glowB = Math.round(36 + t * 117);  // 36 → 153
  const peakFilter = `drop-shadow(0 0 ${glow}px rgba(${glowR},${glowG},${glowB},${glowAlpha}))`;

  requestAnimationFrame(() => {
    const containers = document.querySelectorAll('.stars');
    containers.forEach(c => {
      if (c.dataset.itemId !== itemId || c.dataset.prefix !== prefix) return;
      const lit = [...c.querySelectorAll('.star-btn.lit')];

      // CSS class animation — reliable on all browsers including mobile/PWA
      lit.forEach((star, i) => {
        star.classList.remove('star-pop');
        void star.offsetWidth; // force reflow to restart animation
        setTimeout(() => star.classList.add('star-pop'), i * stagger);
        setTimeout(() => star.classList.remove('star-pop'), i * stagger + 500);
      });
      const label = c.querySelector('.star-label');
      if (label) {
        label.classList.remove('label-pop');
        void label.offsetWidth;
        setTimeout(() => { label.classList.add('label-pop'); setTimeout(() => label.classList.remove('label-pop'), 520); }, 100);
      }

      // Web Animations API for intensity-scaled glow (progressive enhancement)
      if (typeof Element.prototype.animate === 'function') {
        lit.forEach((star, i) => {
          star.animate([
            { transform: 'scale(1)', filter: 'none' },
            { transform: `scale(${peakScale})`, filter: peakFilter, offset: 0.3 },
            { transform: `scale(${midScale})`, filter: 'none', offset: 0.6 },
            { transform: 'scale(1)', filter: 'none' }
          ], { duration, delay: i * stagger, easing: 'ease-out', fill: 'none' });
        });
        if (label) {
          label.animate([
            { transform: 'scale(1)', color: '' },
            { transform: `scale(${1.15 + t * 0.35})`, color: '#fbbf24', offset: 0.4 },
            { transform: 'scale(1)', color: '' }
          ], { duration: 500 + t * 180, delay: 100 + t * 70, easing: 'ease-out' });
        }
      }

      if (isPerfect) spawnPerfectBurst(c);
    });
  });
}

function spawnPerfectBurst(container) {
  const burst = document.createElement('div');
  burst.style.cssText = `
    position:absolute; inset:-10px; border-radius:8px; pointer-events:none;
    background: radial-gradient(circle, rgba(251,191,36,0.45), rgba(236,72,153,0.2) 50%, transparent 70%);
    z-index:0;
  `;
  const oldPos = getComputedStyle(container).position;
  if (oldPos === 'static') container.style.position = 'relative';
  container.appendChild(burst);
  burst.animate([
    { opacity: 0, transform: 'scale(0.6)' },
    { opacity: 1, transform: 'scale(1.1)', offset: 0.3 },
    { opacity: 0, transform: 'scale(1.6)' }
  ], { duration: 700, easing: 'ease-out' }).onfinish = () => burst.remove();
}

function hoverStars(btn, val) {
  const container = btn.parentElement;
  const section = container?.dataset?.section || container?.closest?.('#ep-rating-popup')?.dataset?.section || activeSection;
  container.querySelectorAll('.star-btn').forEach((b, i) => {
    b.style.color = (i + 1) <= val ? '#f59e0b' : '#443d60';
    b.style.transform = (i + 1) <= val ? 'scale(1.2)' : 'scale(1)';
  });
  let label = container.querySelector('.star-label');
  if (!label) {
    label = document.createElement('span');
    label.className = 'star-label';
    container.appendChild(label);
  }
  label.textContent = formatRatingValueForSection(val, section);
}
function unhoverStars(btn, rating) {
  const container = btn.parentElement;
  const section = container?.dataset?.section || container?.closest?.('#ep-rating-popup')?.dataset?.section || activeSection;
  container.querySelectorAll('.star-btn').forEach((b, i) => {
    b.style.color = (i + 1) <= rating ? '#f59e0b' : '#443d60';
    b.style.transform = 'scale(1)';
  });
  const label = container.querySelector('.star-label');
  if (label) label.textContent = rating > 0 ? formatRatingValueForSection(rating, section) : '';
}

// Touch scrub for overall + season star ratings
function starsTouchStart(e) {
  const c = e.currentTarget;
  c.dataset.touchStartX = e.touches[0].clientX;
  c.dataset.touchStartY = e.touches[0].clientY;
  c.dataset.scrubVal = '0';
  c.dataset.scrubbing = 'false';
}
function starsTouchMove(e) {
  const c = e.currentTarget;
  const section = c?.dataset?.section || activeSection;
  const touch = e.touches[0];
  const dx = Math.abs(touch.clientX - parseFloat(c.dataset.touchStartX || 0));
  const dy = Math.abs(touch.clientY - parseFloat(c.dataset.touchStartY || 0));
  // Need at least 10px of horizontal-dominant motion before locking in scrub mode
  // (prevents tap jitter from being misread as a scrub)
  if (c.dataset.scrubbing !== 'true') {
    if (dx < 10 || dy > dx) return;
  }
  c.dataset.scrubbing = 'true';
  e.preventDefault();
  const stars = [...c.querySelectorAll('.star-btn')];
  let val = 0;
  stars.forEach((btn, i) => {
    if (touch.clientX >= btn.getBoundingClientRect().left) val = i + 1;
  });
  if (val >= 1) {
    c.dataset.scrubVal = val;
    stars.forEach((b, i) => {
      b.style.color = (i + 1) <= val ? '#f59e0b' : '#443d60';
      b.style.transform = (i + 1) <= val ? 'scale(1.2)' : 'scale(1)';
    });
    let label = c.querySelector('.star-label');
    if (!label) {
      label = document.createElement('span');
      label.className = 'star-label';
      c.appendChild(label);
    }
    label.textContent = formatRatingValueForSection(val, section);
  }
}
function starsTouchEnd(e) {
  const c = e.currentTarget;
  if (c.dataset.scrubbing !== 'true') return;
  const val = parseInt(c.dataset.scrubVal || 0);
  if (val > 0) {
    e.preventDefault();
    rate(c.dataset.itemId, c.dataset.prefix, val);
  }
  c.dataset.scrubVal = '0';
  c.dataset.scrubbing = 'false';
}

function setEpisodesExpanded(list, shouldOpen, immediate) {
  // v444: redesigned to eliminate the residual card shake.
  //
  // KEY CHANGES vs v443:
  //  1. We no longer swap the final pixel-height to `auto` on open — that swap
  //     could land on a different rounded pixel value than the animated value
  //     (auto resolves slightly differently in mobile browsers), producing the
  //     1-px end-of-animation flicker users perceived as "shake". Instead we
  //     install a ResizeObserver on the inner content so the list height
  //     follows any later inner growth (e.g. season open) WITHOUT relying on
  //     `auto`. The observer is removed on close.
  //  2. For close, we measure scrollHeight FIRST, set it as concrete pixel
  //     height, then remove `.open` class, all in the same frame, then animate
  //     to 0 in the NEXT frame. This guarantees the transition has a concrete
  //     start value (no `auto → 0` jump) and a concrete end value.
  //  3. The CSS animation is now ONLY height — the transform: translateY shake
  //     contributor is gone (see CSS).
  if (!list) return;
  if (list._episodesTransitionHandler) {
    list.removeEventListener('transitionend', list._episodesTransitionHandler);
    list._episodesTransitionHandler = null;
  }
  if (list._episodesResizeObserver) {
    try { list._episodesResizeObserver.disconnect(); } catch (e) {}
    list._episodesResizeObserver = null;
  }

  const measureContentHeight = () => {
    const content = list.querySelector('.ep-list-inner');
    return content ? content.scrollHeight : list.scrollHeight;
  };

  const installFollowResizer = () => {
    const content = list.querySelector('.ep-list-inner');
    if (!content || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (!list.classList.contains('open')) return;
      // No transition — just resize to match content (used when seasons open
      // inside the dropdown after the main expand animation completes).
      const prevTransition = list.style.transition;
      list.style.transition = 'none';
      list.style.height = content.scrollHeight + 'px';
      // Force reflow then restore transition for any future animated change.
      void list.offsetHeight;
      list.style.transition = prevTransition;
    });
    ro.observe(content);
    list._episodesResizeObserver = ro;
  };

  const attachEndHandler = (onComplete) => {
    const onEnd = (e) => {
      if (e.propertyName !== 'height') return;
      list.removeEventListener('transitionend', onEnd);
      list._episodesTransitionHandler = null;
      if (typeof onComplete === 'function') onComplete();
    };
    list._episodesTransitionHandler = onEnd;
    list.addEventListener('transitionend', onEnd);
  };

  if (shouldOpen) {
    list.classList.add('open');
    if (immediate) {
      list.style.height = measureContentHeight() + 'px';
      installFollowResizer();
      return;
    }
    list.style.height = '0px';
    requestAnimationFrame(() => {
      const target = measureContentHeight();
      list.style.height = target + 'px';
      attachEndHandler(() => installFollowResizer());
    });
  } else {
    if (immediate) {
      list.classList.remove('open');
      list.style.height = '0px';
      return;
    }
    // Concrete start value for the close transition (was previously `auto`).
    list.style.height = list.scrollHeight + 'px';
    list.classList.remove('open');
    requestAnimationFrame(() => {
      list.style.height = '0px';
      attachEndHandler();
    });
  }
}

const screenListPendingEpisodeStatusByKey = {};

function getScreenListEpisodeEditKey(itemId, section = activeSection) {
  return `${section}:${itemId}`;
}

function getScreenListEpisodeDerivedStatus(item = {}) {
  const episodes = Array.isArray(item.episodes) ? item.episodes : [];
  if (!episodes.length) return item.status || 'planned';
  const allWatched = episodes.every(e => e && e.watched);
  const anyWatched = episodes.some(e => e && e.watched);
  if (allWatched) return 'watched';
  if (anyWatched) return 'watching';
  return 'planned';
}

function syncScreenListEpisodeProgressFields(item = {}) {
  const episodes = Array.isArray(item.episodes) ? item.episodes : [];
  if (!episodes.length) return;
  item.currentEp = episodes.filter(e => e && e.watched).length;
  item.totalEpisodes = episodes.length;
  item.totalEps = episodes.length;
}

function isScreenListEpisodeEditorOpen(itemId = '') {
  const list = document.getElementById('ep-list-' + itemId);
  return !!(list && list.classList.contains('open'));
}

function applyScreenListEpisodeStatusOrDefer(item = {}, section = activeSection) {
  if (!item || !item.id) return false;
  syncScreenListEpisodeProgressFields(item);
  const nextStatus = getScreenListEpisodeDerivedStatus(item);
  const key = getScreenListEpisodeEditKey(item.id, section);
  if (isScreenListEpisodeEditorOpen(item.id)) {
    if (nextStatus === item.status) delete screenListPendingEpisodeStatusByKey[key];
    else screenListPendingEpisodeStatusByKey[key] = nextStatus;
    return false;
  }
  delete screenListPendingEpisodeStatusByKey[key];
  if (nextStatus === item.status) return false;
  item.status = nextStatus;
  return true;
}

function flushScreenListDeferredEpisodeStatus(itemId = '', section = activeSection) {
  const item = (data[section] || []).find(i => i.id === itemId);
  if (!item) return;
  const key = getScreenListEpisodeEditKey(itemId, section);
  if (!Object.prototype.hasOwnProperty.call(screenListPendingEpisodeStatusByKey, key)) return;
  const nextStatus = screenListPendingEpisodeStatusByKey[key] || getScreenListEpisodeDerivedStatus(item);
  delete screenListPendingEpisodeStatusByKey[key];
  syncScreenListEpisodeProgressFields(item);
  if (nextStatus !== item.status) {
    item.status = nextStatus;
    touchItem(item);
    save();
    render();
    return;
  }
  updateStatusPillsUI(item);
}

function toggleEpisodes(id) {
  const list = document.getElementById('ep-list-' + id);
  const arrow = document.getElementById('ep-arrow-' + id);
  const label = document.getElementById('ep-label-' + id);
  if (!list) return;
  const open = list.classList.contains('open');
  setEpisodesExpanded(list, !open, false);
  arrow.classList.toggle('open', !open);
  label.textContent = 'Episodes';
  openStates['ep-' + id] = !open;
  if (!open) {
    hydrateMissingSeasonPosters(id, activeSection);
    // v799: For anime, kick off Jikan episode-title hydration so
    // MAL-imported items get real episode titles instead of just numbers.
    if (activeSection === 'anime') {
      const animeItem = (data.anime || []).find(i => i?.id === id);
      if (animeItem && (animeItem.malId || animeItem.mal_id)) {
        hydrateAnimeEpisodeTitlesFromJikan(animeItem);
      }
    }
    // v443 Issue 2: scroll the title card near the top of the viewport so
    // the episode dropdown has room to expand without the user having to scroll.
    // v444: skip the scroll entirely when the card is already at/near the safe
    // top — that no-op scrollTo could still trigger a tiny scroll-anchor
    // adjustment that competed with the dropdown's height transition.
    requestAnimationFrame(() => {
      const card = document.getElementById('card-' + id);
      if (!card) return;
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        // Only scroll if not already in safe zone (reduced-motion users get an
        // instant snap rather than a smooth scroll).
        const HEADER_OFFSET = 72;
        const distance = card.getBoundingClientRect().top - HEADER_OFFSET;
        if (Math.abs(distance) > 6) card.scrollIntoView({ block: 'start' });
        return;
      }
      const HEADER_OFFSET = 72;
      const distance = card.getBoundingClientRect().top - HEADER_OFFSET;
      // Skip if the card is already inside a small dead-band around the safe
      // top — saves a redundant scrollTo and keeps the dropdown animation
      // free of any scroll-anchor side effects.
      if (Math.abs(distance) < 8) return;
      const top = card.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    });
  }
  if (open) {
    // Closing the entire episode panel — clean up any active season focus state
    // so it doesn't persist if the user reopens Show Episodes later.
    shelfdExitSeasonFocusMode(id);
    const section = activeSection;
    window.setTimeout(() => flushScreenListDeferredEpisodeStatus(id, section), 380);
  }
}

function preserveEpisodeScroll(itemId, action) {
  const scrollEl = document.querySelector(`#ep-list-${itemId} .ep-scroll`);
  const scrollTop = scrollEl ? scrollEl.scrollTop : 0;
  action();
  requestAnimationFrame(() => {
    const nextScrollEl = document.querySelector(`#ep-list-${itemId} .ep-scroll`);
    if (nextScrollEl) nextScrollEl.scrollTop = scrollTop;
  });
}

function preserveViewport(action) {
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  action();
  requestAnimationFrame(() => {
    window.scrollTo({ left: scrollX, top: scrollY, behavior: 'auto' });
  });
}

function itemMatchesCurrentView(item) {
  return itemMatchesActiveListStatus(item) &&
    (!searchQuery || (item.title || '').toLowerCase().includes(searchQuery.toLowerCase()));
}

function getEpisodeProgress(item) {
  return getCompactEpisodeStats(item);
}

function updateEpisodeRowState(ep) {
  const row = document.getElementById('ep-row-' + ep.id);
  if (!row) return;
  row.classList.toggle('watched-ep', !!ep.watched);
  const check = row.querySelector('.ep-check');
  if (!check) return;
  check.classList.toggle('checked', !!ep.watched);
  check.innerHTML = ep.watched ? '&#10003;' : '';
}

function updateCardProgressUI(item) {
  const progress = getEpisodeProgress(item);
  const countEl = document.getElementById('progress-count-' + item.id);
  const percentEl = document.getElementById('progress-percent-' + item.id);
  const fillEl = document.getElementById('progress-fill-' + item.id);
  if (countEl) countEl.textContent = `${progress.watched}/${progress.total} episodes`;
  if (percentEl) percentEl.textContent = `${progress.percent}%`;
  if (fillEl) fillEl.style.width = `${progress.percent}%`;
}

function updateSeasonProgressUI(item, seasonNum) {
  if (!seasonNum) return;
  const seasonEpisodes = (item.episodes || []).filter(e => e.seasonNum === seasonNum);
  const seasonProgressEl = document.getElementById(`season-progress-${item.id}-${seasonNum}`);
  if (!seasonProgressEl) return;
  const watched = seasonEpisodes.filter(e => e.watched).length;
  seasonProgressEl.textContent = `(${watched}/${seasonEpisodes.length})`;
}

function updateStatusPillsUI(item) {
  const statusPills = document.querySelectorAll(`#status-pills-${item.id} .status-pill`);
  statusPills.forEach(btn => {
    const isActive = btn.dataset.status === item.status;
    ['live-active', 'competitive-active', 'watching-active', 'planned-active', 'watched-active', 'paused-active', 'dropped-active', 'wishlist-active']
      .forEach(cls => btn.classList.remove(cls));
    if (isActive) btn.classList.add(`${item.status}-active`);
  });
}

function updateSeasonActionLabelUI(item, seasonNum) {
  if (!seasonNum) return;
  const seasonEpisodes = (item.episodes || []).filter(e => e.seasonNum === seasonNum);
  const seasonWrap = document.getElementById(`s-eps-${item.id}-${seasonNum}`)?.closest('.season-block');
  const actionBtn = seasonWrap ? seasonWrap.querySelector('.edit-ep-link') : null;
  if (!actionBtn) return;
  const watched = seasonEpisodes.filter(e => e.watched).length;
  actionBtn.textContent = watched < seasonEpisodes.length ? 'Mark all' : 'Clear all';
}

function spawnEpisodeBurst(row) {
  const check = row.querySelector('.ep-check');
  if (!check) return;
  const burst = document.createElement('div');
  burst.className = 'episode-burst';
  const rowRect = row.getBoundingClientRect();
  const checkRect = check.getBoundingClientRect();
  burst.style.left = `${checkRect.left - rowRect.left + checkRect.width / 2}px`;
  burst.style.top = `${checkRect.top - rowRect.top + checkRect.height / 2}px`;
  row.appendChild(burst);
  burst.animate([
    { opacity: 0, transform: 'scale(0.35)' },
    { opacity: 1, transform: 'scale(1.12)', offset: 0.22 },
    { opacity: 0, transform: 'scale(1.9)' }
  ], {
    duration: 620,
    easing: 'cubic-bezier(0.16, 1, 0.3, 1)'
  }).onfinish = () => burst.remove();
}

function animateEpisodeWatchSweep(epId) {
  requestAnimationFrame(() => {
    const row = document.getElementById('ep-row-' + epId);
    if (!row) return;
    row.classList.remove('episode-watch-enter');
    row.classList.remove('episode-watch-sweep');
    row.classList.remove('episode-watch-impact');
    row.classList.remove('episode-watch-glow');
    void row.offsetWidth;
    row.classList.add('episode-watch-enter');
    row.classList.add('episode-watch-sweep');
    row.classList.add('episode-watch-impact');
    row.classList.add('episode-watch-glow');

    row.querySelectorAll('.episode-fill-layer').forEach(layer => layer.remove());
    const fillLayer = document.createElement('div');
    fillLayer.className = 'episode-fill-layer';
    row.appendChild(fillLayer);

    spawnEpisodeBurst(row);

    const fillAnim = fillLayer.animate([
      { clipPath: 'inset(0 99% 0 0 round 4px)' },
      { clipPath: 'inset(0 84% 0 0 round 4px)', offset: 0.16 },
      { clipPath: 'inset(0 66% 0 0 round 4px)', offset: 0.32 },
      { clipPath: 'inset(0 48% 0 0 round 4px)', offset: 0.48 },
      { clipPath: 'inset(0 29% 0 0 round 4px)', offset: 0.64 },
      { clipPath: 'inset(0 12% 0 0 round 4px)', offset: 0.8 },
      { clipPath: 'inset(0 3% 0 0 round 4px)', offset: 0.92 },
      { clipPath: 'inset(0 0 0 0 round 4px)' }
    ], {
      duration: 1120,
      easing: 'linear',
      fill: 'forwards'
    });

    fillAnim.onfinish = () => {
      fillLayer.remove();
      row.classList.remove('episode-watch-sweep');
      row.classList.remove('episode-watch-enter');
      row.classList.remove('episode-watch-impact');
      row.classList.remove('episode-watch-glow');
    };
  });
}


function markEpisodeWatchActivity(item, section = activeSection, details = {}) {
  if (!item || (section !== 'shows' && section !== 'anime')) return;
  const now = new Date().toISOString();
  const count = Math.max(1, Number(details.count || 1));
  item.lastEpisodeActivityAt = now;
  item.lastEpisodeActivityCount = count;
  item.lastEpisodeActivityLabel = String(details.label || (count === 1 ? 'episode watched' : `${count} episodes watched`));
  /* v728: store explicit episode number + season so the activity card
     can render "Watched Episode X" without parsing the label string. */
  if (details.epNum !== undefined && details.epNum !== null && String(details.epNum).trim()) {
    item.lastEpisodeActivityNum = String(details.epNum).trim();
  } else if (count === 1) {
    /* clear stale single-episode pointer when this isn't a single-ep watch */
    delete item.lastEpisodeActivityNum;
  } else {
    delete item.lastEpisodeActivityNum;
  }
  if (details.season !== undefined && details.season !== null && String(details.season).trim()) {
    item.lastEpisodeActivitySeason = String(details.season).trim();
  }
}

/* v553: detect season completion. After an episode is marked watched,
   check if EVERY episode of that season is now watched, and if the
   season wasn't already finished, record a season-finished activity. */
function maybeMarkScreenListSeasonFinished(item, section, seasonNum) {
  if (!item || (section !== 'shows' && section !== 'anime')) return;
  const num = String(seasonNum || '').trim();
  if (!num) return;
  const eps = (Array.isArray(item.episodes) ? item.episodes : []).filter(ep => String(ep?.seasonNum || '') === num);
  if (!eps.length) return;
  const allWatched = eps.every(ep => !!ep?.watched);
  if (!allWatched) return;
  const finishedKey = `${num}`;
  const prior = String(item.lastSeasonFinishedKey || '').trim();
  if (prior === finishedKey) return; // already recorded this exact season finish
  item.lastSeasonFinishedAt = new Date().toISOString();
  item.lastSeasonFinishedNum = num;
  item.lastSeasonFinishedKey = finishedKey;
}

function toggleEp(itemId, epId) {
  const item = data[activeSection].find(i => i.id === itemId);
  if (!item) return;
  // v451: anime synthetic episodes need to be materialised before per-episode
  // state can be saved.
  if (typeof hydrateAnimeEpisodesIfSynthetic === 'function') hydrateAnimeEpisodesIfSynthetic(item);
  let ep = item.episodes.find(e => e.id === epId);
  if (!ep && epId) ep = item.episodes.find(e => (itemId + '-ep-' + (e.seasonNum ? e.seasonNum + '-' : '') + (e.epNum || e.number)) === epId);
  if (!ep) return;
  let becameWatched = false;
  preserveEpisodeScroll(itemId, () => {
    ep.watched = !ep.watched;
    becameWatched = ep.watched;
    if (becameWatched) {
      markEpisodeWatchActivity(item, activeSection, {
        count: 1,
        label: ep.title || ep.name || 'episode watched',
        epNum: ep.epNum || ep.number || ep.episodeNumber || '',
        season: ep.seasonNum || ''
      });
      // v553: also check if this episode just completed its season
      maybeMarkScreenListSeasonFinished(item, activeSection, ep.seasonNum);
    }
    const statusChangedNow = applyScreenListEpisodeStatusOrDefer(item);
    if (typeof markOwnItemLastEdited === 'function') markOwnItemLastEdited(item, activeSection);
    else touchItem(item);
    save();
    if (statusChangedNow && !itemMatchesCurrentView(item)) {
      render();
      return;
    }
    updateEpisodeRowState(ep);
    updateCardProgressUI(item);
    updateSeasonProgressUI(item, ep.seasonNum);
    updateStatusPillsUI(item);
  });
  if (becameWatched) animateEpisodeWatchSweep(epId);
}

function markAllEps(id, val) {
  const item = data[activeSection].find(i => i.id === id);
  if (!item) return;
  // v451: materialise synthetic anime episodes so the per-episode flags persist.
  if (typeof hydrateAnimeEpisodesIfSynthetic === 'function') hydrateAnimeEpisodesIfSynthetic(item);
  preserveViewport(() => {
    preserveEpisodeScroll(id, () => {
      const affectedEpisodes = item.episodes.length;
      item.episodes.forEach(e => e.watched = val);
      if (val) {
        markEpisodeWatchActivity(item, activeSection, { count: affectedEpisodes, label: 'all episodes watched' });
        // v553: mark each season finished
        new Set(item.episodes.map(ep => ep.seasonNum).filter(Boolean)).forEach(sn => {
          maybeMarkScreenListSeasonFinished(item, activeSection, sn);
        });
      }
      const statusChangedNow = applyScreenListEpisodeStatusOrDefer(item);
      if (typeof markOwnItemLastEdited === 'function') markOwnItemLastEdited(item, activeSection);
      else touchItem(item);
      save();
      if (statusChangedNow && !itemMatchesCurrentView(item)) {
        render();
        return;
      }
      item.episodes.forEach(updateEpisodeRowState);
      updateCardProgressUI(item);
      new Set(item.episodes.map(ep => ep.seasonNum).filter(Boolean)).forEach(seasonNum => {
        updateSeasonProgressUI(item, seasonNum);
        updateSeasonActionLabelUI(item, seasonNum);
      });
      updateStatusPillsUI(item);
    });
  });
}

function showEditEp(id) {
  const item = data[activeSection].find(i => i.id === id);
  if (!item) return;
  const el = document.getElementById('edit-ep-' + id);
  el.innerHTML = `
    <input type="number" min="1" value="${item.episodes.length}" style="width:60px;padding:4px 8px;font-size:12px;background:#0c0a1d;border:1px solid #2a2248;border-radius:4px;color:#e8e3f3;outline:none;" id="ep-count-inp-${id}">
    <button class="btn-primary btn-sm" onclick="saveEpCount('${id}')">Save</button>
    <button class="btn-secondary btn-sm" onclick="render()">Cancel</button>
  `;
}

function saveEpCount(id) {
  const item = data[activeSection].find(i => i.id === id);
  if (!item) return;
  const count = Math.max(1, parseInt(document.getElementById('ep-count-inp-' + id).value) || 1);
  const curr = item.episodes;
  preserveEpisodeScroll(id, () => {
    if (count > curr.length) {
      for (let i = curr.length; i < count; i++) {
        curr.push({ id: id + '-ep-' + (i+1), number: i+1, title: '', watched: false, rating: 0 });
      }
    } else {
      item.episodes = curr.slice(0, count);
    }
    item.totalEpisodes = count;
    save(); render();
  });
}

/* =============================================================================
   v692: My Lists inline library search — toggled by the magnifying-glass
   button in the toolbar. Shows a full-width search row below the status tabs.
   Clears the active search query and re-renders when closed.
   ============================================================================= */
let _mylistSearchOpen = false;
function toggleMyListSearch() {
  const row   = document.getElementById('mylist-search-row');
  const input = document.getElementById('mylist-search-input-inline');
  const btn   = document.getElementById('mylist-search-toggle-btn');
  if (!row) return;
  _mylistSearchOpen = !_mylistSearchOpen;
  row.hidden = !_mylistSearchOpen;
  if (btn) btn.classList.toggle('mylist-search-toggle-active', _mylistSearchOpen);
  if (_mylistSearchOpen) {
    /* Focus with rAF so iOS keyboard appears inside the gesture chain. */
    requestAnimationFrame(() => { try { input?.focus({ preventScroll: false }); } catch (_) { input?.focus(); } });
  } else {
    /* Clear search state when closing. */
    if (input) input.value = '';
    onSearch('');
  }
}
window.toggleMyListSearch = toggleMyListSearch;


/* ===========================================================================
   v800: Title-card comment feature
   - Per-library-item personal comment shown directly on completed title cards
   - Stored as item.cardComment = { text, createdAt, updatedAt, linkedActivityId }
   - Shown in the action row, far-left, separate from buttons
   - Owner can add/edit/delete via a small modal
   - When created, also creates a linked feed post (type: 'card-comment')
   - Editing the card comment also updates the linked feed post
   - Deleting removes both the field and the linked feed post
   =========================================================================== */
/* v846: tightened from 600 → 30 chars. Title-card comment now lives
   inline within the action row (far left) and must fit alongside the
   Comments button and the right-controls cluster on mobile widths. */
const SCREENLIST_CARD_COMMENT_MAX = 30;

function isScreenListCompletedTabForCardComment() {
  return activeTab === 'watched';
}

function shouldShowCardCommentFeatureFor(item) {
  if (!item) return false;
  if (!isScreenListCompletedTabForCardComment()) return false;
  if (viewingUser && !item.cardComment?.text) return false;
  return true;
}

function getCardCommentText(item) {
  return String(item?.cardComment?.text || '').trim();
}

// v803: split into two render helpers.
//   buildCardCommentAddBtnHtml — + button in card-right-controls (far right of action row)
//   buildCardCommentBodyHtml   — flat text floated on the card body above the action row
function buildCardCommentAddBtnHtml(item) {
  if (!item) return '';
  if (!shouldShowCardCommentFeatureFor(item)) return '';
  if (viewingUser) return '';
  const text = getCardCommentText(item);
  if (text) return ''; // comment posted — body text shown instead, no + button
  const itemIdAttr = escAttr(item.id);
  return '<button class="card-comment-add-btn" type="button" onclick="event.stopPropagation();openCardCommentComposer(\'' + itemIdAttr + '\')" aria-label="Add a comment about this title" title="Add a comment"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>';
}

function buildCardCommentBodyHtml(item) {
  if (!item) return '';
  if (!shouldShowCardCommentFeatureFor(item)) return '';
  const text = getCardCommentText(item);
  if (!text) return '';
  const itemIdAttr = escAttr(item.id);
  const isOwner = !viewingUser;
  if (isOwner) {
    /* v817: the owner-edit affordance is now a real <button type="button">
       instead of a div + role=button + tabindex=0. The old div pattern
       caused two iOS-Safari problems that surfaced as "tap scrolls the
       page to the bottom and the modal does not open":
         1. tabindex=0 on a div makes it focusable, and iOS's "scroll
            focusable into view" behavior could intercept the tap.
         2. The inner <span> often became event.target, and Safari's
            click-on-non-button-element handling didn't always bubble
            cleanly to our inline onclick — so the tap fell through to
            the page-level click default (which, on a long list,
            scrolls).
       A native <button> handles clicks reliably across mobile/PWA.
       preventDefault() is added defensively (button type="button" has
       no default action, but we want to be sure no UA's quirky focus
       behavior kicks in). pointer-events on .card-comment-body-text is
       set to none in CSS so clicks always target the button itself. */
    return (
      '<button type="button" class="card-comment-body card-comment-body--owner" ' +
        'onclick="event.preventDefault();event.stopPropagation();openCardCommentComposer(\'' + itemIdAttr + '\')" ' +
        'aria-label="Edit your comment" ' +
        'data-card-comment-id="' + itemIdAttr + '">' +
        '<span class="card-comment-body-text">' + escHtml(text) + '</span>' +
      '</button>'
    );
  }
  return '<div class="card-comment-body" data-card-comment-id="' + itemIdAttr + '"><span class="card-comment-body-text">' + escHtml(text) + '</span></div>';
}

// Legacy stub — no longer called from template but kept to avoid any stale references
function buildCardCommentSlotHtml(item) { return ''; }

function openCardCommentComposer(itemId) {
  const item = (data[activeSection] || []).find(i => i?.id === itemId);
  if (!item) return;
  if (viewingUser) return;
  const existingText = getCardCommentText(item);
  closeCardCommentComposer();
  const overlay = document.createElement('div');
  overlay.className = 'card-comment-composer-overlay';
  overlay.id = 'card-comment-composer-overlay';
  const titleAttr = escAttr(item.title || 'this title');
  const headerLabel = existingText ? 'Edit comment' : 'Add a comment';
  const saveLabel = existingText ? 'Save' : 'Post';
  // v802: do NOT attach the backdrop's close handler inline — the synthetic
  // "ghost click" fired by mobile browsers ~300ms after touchend would hit
  // the backdrop (which just covered the tapped point) and instantly close
  // the modal. Bind the backdrop close handler via JS AFTER a delay safely
  // past the ghost-click window. Same for the bare close/cancel buttons —
  // they stay inline because the user explicitly tapped them after the
  // ghost-click window, so they're safe.
  overlay.innerHTML =
    '<div class="card-comment-composer-backdrop" data-card-comment-backdrop></div>' +
    '<div class="card-comment-composer-sheet" role="dialog" aria-modal="true" aria-labelledby="card-comment-composer-title">' +
      '<div class="card-comment-composer-handle" aria-hidden="true"></div>' +
      '<div class="card-comment-composer-header">' +
        '<h2 id="card-comment-composer-title">' + headerLabel + '</h2>' +
        '<button class="card-comment-composer-close" type="button" data-card-comment-close aria-label="Close">×</button>' +
      '</div>' +
      '<div class="card-comment-composer-subtitle">' + escHtml(item.title || 'Untitled') + '</div>' +
      '<textarea class="card-comment-composer-input" id="card-comment-composer-input" rows="5" maxlength="' + SCREENLIST_CARD_COMMENT_MAX + '" placeholder="Share what you thought of ' + titleAttr + '">' + escHtml(existingText) + '</textarea>' +
      '<div class="card-comment-composer-foot">' +
        '<span class="card-comment-composer-counter" id="card-comment-composer-counter">' + existingText.length + '/' + SCREENLIST_CARD_COMMENT_MAX + '</span>' +
        '<div class="card-comment-composer-actions">' +
          '<button class="btn-secondary card-comment-composer-cancel" type="button" data-card-comment-cancel>Cancel</button>' +
          '<button class="btn-primary card-comment-composer-save" type="button" id="card-comment-composer-save" data-card-comment-save data-card-comment-item-id="' + escAttr(itemId) + '">' + saveLabel + '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  // v802: gate close handlers until ghost-click window passes. Save/Cancel/Close
  // buttons stay disabled-via-no-handler for 350ms so a stray late-firing click
  // on the spot where the plus button was can't auto-close.
  setTimeout(() => {
    const liveOverlay = document.getElementById('card-comment-composer-overlay');
    if (!liveOverlay) return;
    const backdrop = liveOverlay.querySelector('[data-card-comment-backdrop]');
    const sheet = liveOverlay.querySelector('.card-comment-composer-sheet');
    const closeBtn = liveOverlay.querySelector('[data-card-comment-close]');
    const cancelBtn = liveOverlay.querySelector('[data-card-comment-cancel]');
    const saveBtn = liveOverlay.querySelector('[data-card-comment-save]');
    // v838: backdrop close fires ONLY when the actual click target is the
    // backdrop itself — not when the click target is anywhere inside the
    // sheet. Prevents the "tap textarea, modal vanishes" bug where iOS
    // mis-routed a textarea tap to the backdrop via the compositor.
    if (backdrop) backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeCardCommentComposer();
    });
    // v838: belt-and-suspenders — stop click events that started anywhere
    // inside the sheet (textarea, buttons, header text) from bubbling out.
    // Even if the browser routes a child click back to the overlay level,
    // it can't reach a sibling backdrop's handler.
    if (sheet) sheet.addEventListener('click', (e) => e.stopPropagation());
    if (closeBtn) closeBtn.addEventListener('click', closeCardCommentComposer);
    if (cancelBtn) cancelBtn.addEventListener('click', closeCardCommentComposer);
    if (saveBtn) saveBtn.addEventListener('click', () => {
      const targetItemId = saveBtn.getAttribute('data-card-comment-item-id') || '';
      if (targetItemId) saveCardCommentFromComposer(targetItemId);
    });
  }, 350);
  const ta = document.getElementById('card-comment-composer-input');
  const counter = document.getElementById('card-comment-composer-counter');
  if (ta) {
    /* v817: do NOT auto-focus the textarea immediately. On iOS Safari
       (browser + PWA), focusing an input inside a just-appended position:fixed
       modal that's still mid-fade-in causes the page to scroll trying to
       "bring the focused element into view" — which lands at the bottom
       of the document because the overlay was just appended to <body>.
       Defer the focus until well after the open animation has completed
       and the modal sheet is at its final transform/opacity, then use
       preventScroll so even the focus itself can't move the page. */
    setTimeout(() => {
      try {
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(ta.value.length, ta.value.length);
      } catch (_) {
        try { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } catch (__) {}
      }
    }, 360);
    ta.addEventListener('input', () => {
      if (counter) counter.textContent = ta.value.length + '/' + SCREENLIST_CARD_COMMENT_MAX;
    });
  }
  /* v841: visualViewport handler — height-only, top stays pinned.
     The v802-original handler set BOTH top and height from vv, and the
     `top: vv.offsetTop` write was what pushed the modal off-screen on
     iOS PWA (v839 ripped the whole thing out for that reason). But with
     no resize at all, the modal stays centered in the FULL layout
     viewport — so when the keyboard appears, the bottom half of the
     sheet (where the Save button lives) is behind the keyboard and the
     user can't tap it. Shrinking ONLY the overlay's height while leaving
     top pinned at 0 keeps the modal in the visible area without
     re-introducing the off-screen bug. The sheet also gets a clamped
     max-height so it fits above the keyboard. */
  const _vvHandler = () => {
    const vv = window.visualViewport;
    if (!vv || !vv.height) return;
    const el = document.getElementById('card-comment-composer-overlay');
    if (!el) return;
    /* Anchored at top:0, height matches the visible viewport above the
       keyboard. NEVER write `top: vv.offsetTop` here — that's the iOS
       PWA off-screen bug. */
    el.style.top = '0';
    el.style.bottom = 'auto';
    el.style.height = vv.height + 'px';
    /* Make sure the sheet fits — leave some padding above/below. */
    const sheet = el.querySelector('.card-comment-composer-sheet');
    if (sheet) sheet.style.maxHeight = Math.max(220, vv.height - 40) + 'px';
  };
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', _vvHandler);
    window.visualViewport.addEventListener('scroll', _vvHandler);
    overlay._vvHandler = _vvHandler;
    /* Run once on open in case the keyboard is already up (rare, but
       harmless on first paint). */
    _vvHandler();
  }
}

function closeCardCommentComposer() {
  const overlay = document.getElementById('card-comment-composer-overlay');
  if (!overlay) return;
  overlay.classList.remove('is-open');
  /* v841: detach the height-only visualViewport handler so it doesn't
     leak listeners after the modal is gone. */
  if (window.visualViewport && overlay._vvHandler) {
    window.visualViewport.removeEventListener('resize', overlay._vvHandler);
    window.visualViewport.removeEventListener('scroll', overlay._vvHandler);
  }
  setTimeout(() => { try { overlay.remove(); } catch (e) {} }, 220);
}

async function saveCardCommentFromComposer(itemId) {
  const item = (data[activeSection] || []).find(i => i?.id === itemId);
  if (!item) { closeCardCommentComposer(); return; }
  const ta = document.getElementById('card-comment-composer-input');
  const text = String(ta?.value || '').trim().slice(0, SCREENLIST_CARD_COMMENT_MAX);
  if (!text) {
    if (item.cardComment?.text) {
      await deleteCardCommentInternal(item, { skipConfirm: true });
    }
    closeCardCommentComposer();
    render();
    return;
  }
  const now = new Date().toISOString();
  const isEdit = !!item.cardComment?.text;
  item.cardComment = {
    ...(item.cardComment || {}),
    text,
    createdAt: item.cardComment?.createdAt || now,
    updatedAt: now,
    linkedActivityId: item.cardComment?.linkedActivityId || null
  };
  if (typeof markOwnItemLastEdited === 'function') markOwnItemLastEdited(item, activeSection);
  else if (typeof touchItem === 'function') touchItem(item);
  /* v843: ALWAYS close the modal FIRST, before any operation that could
     throw. Previously the order was save() → close() → render(), but if
     save() threw (e.g., localStorage QuotaExceededError on iOS PWA's 5MB
     storage cap, see save() above), close() never ran and the modal sat
     visibly stuck open even though item.cardComment had already been
     updated in memory. Now close happens immediately so the UX is correct
     regardless of any downstream failure. Every subsequent step is also
     wrapped in try/catch so a failure in one (save / render / activity
     sync) can't take down the others. */
  closeCardCommentComposer();
  try { save(); }
  catch (saveErr) {
    console.error('[v843] save() threw inside saveCardCommentFromComposer:', saveErr);
    if (typeof showToast === 'function') showToast('Saved locally — cloud sync will retry.');
  }
  try { render(); } catch (renderErr) { console.warn('[v843] render() threw:', renderErr); }
  try {
    if (isEdit && item.cardComment.linkedActivityId) {
      await updateLinkedCardCommentFeedPost(item);
    } else {
      const postId = await createLinkedCardCommentFeedPost(item);
      if (postId) {
        item.cardComment.linkedActivityId = postId;
        try { save(); } catch (saveErr2) { console.warn('[v843] second save() threw:', saveErr2); }
        try { render(); } catch (renderErr2) { console.warn('[v843] second render() threw:', renderErr2); }
      }
    }
  } catch (error) {
    console.warn('[v800] card-comment activity sync failed:', error);
  }
  if (typeof showToast === 'function') showToast(isEdit ? 'Comment updated' : 'Comment posted');
}

function confirmDeleteCardComment(itemId) {
  const item = (data[activeSection] || []).find(i => i?.id === itemId);
  if (!item || !item.cardComment?.text) return;
  if (viewingUser) return;
  const ok = window.confirm('Delete this comment? This will also remove the linked Activity Feed post.');
  if (!ok) return;
  deleteCardCommentInternal(item).then(() => render());
}

async function deleteCardCommentInternal(item, options = {}) {
  if (!item) return;
  const linkedId = item.cardComment?.linkedActivityId || null;
  delete item.cardComment;
  if (typeof markOwnItemLastEdited === 'function') markOwnItemLastEdited(item, activeSection);
  else if (typeof touchItem === 'function') touchItem(item);
  save();
  if (linkedId) {
    try { await deleteLinkedCardCommentFeedPost(linkedId); }
    catch (error) { console.warn('[v800] card-comment feed delete failed:', error); }
  }
  if (!options.skipConfirm && typeof showToast === 'function') showToast('Comment deleted');
}

async function createLinkedCardCommentFeedPost(item) {
  if (!currentUser || typeof db === 'undefined') return '';
  const postId = (crypto && typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : ('post-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  const timestamp = Date.now();
  const section = item.librarySection || item.mediaCategory || activeSection;
  const text = String(item.cardComment?.text || '');
  const feedPost = {
    postId,
    uid: currentUser.uid,
    timestamp,
    type: 'card-comment',
    eventType: 'card-comment',
    visibility: 'friends',
    likes: [],
    replies: [],
    content: { text, headline: 'Commented ' + (item.title || '') },
    item: {
      id: item.id,
      title: item.title || '',
      cover: item.cover || '',
      year: item.year || '',
      librarySection: section,
      mediaCategory: section,
      tmdbId: item.tmdbId || '',
      malId: item.malId || '',
      rawgId: item.rawgId || '',
      rating: item.rating || 0
    },
    mediaKey: typeof getMediaKey === 'function' ? getMediaKey(item) : '',
    commentText: text,
    cardCommentSourceItemId: item.id
  };
  try {
    await db.collection('feed').doc(postId).set(feedPost);
    if (Array.isArray(window.feedPosts)) window.feedPosts.unshift(feedPost);
    return postId;
  } catch (error) {
    console.warn('[v800] createLinkedCardCommentFeedPost failed:', error);
    return '';
  }
}

async function updateLinkedCardCommentFeedPost(item) {
  if (!currentUser || typeof db === 'undefined') return false;
  const postId = item.cardComment?.linkedActivityId;
  if (!postId) return false;
  const newText = String(item.cardComment?.text || '');
  try {
    const merge = {
      commentText: newText,
      content: { text: newText },
      timestamp: Date.now(),
      editedAt: Date.now()
    };
    await db.collection('feed').doc(postId).set(merge, { merge: true });
    if (Array.isArray(window.feedPosts)) {
      const idx = window.feedPosts.findIndex(p => p?.postId === postId);
      if (idx >= 0) {
        const existingContent = window.feedPosts[idx].content || {};
        window.feedPosts[idx] = {
          ...window.feedPosts[idx],
          commentText: newText,
          content: { ...existingContent, text: newText },
          editedAt: Date.now()
        };
      }
    }
    return true;
  } catch (error) {
    console.warn('[v800] updateLinkedCardCommentFeedPost failed:', error);
    return false;
  }
}

async function deleteLinkedCardCommentFeedPost(postId) {
  if (!currentUser || typeof db === 'undefined' || !postId) return false;
  try {
    await db.collection('feed').doc(postId).delete();
    if (Array.isArray(window.feedPosts)) {
      window.feedPosts = window.feedPosts.filter(p => p?.postId !== postId);
    }
    return true;
  } catch (error) {
    console.warn('[v800] deleteLinkedCardCommentFeedPost failed:', error);
    return false;
  }
}

window.openCardCommentComposer = openCardCommentComposer;
window.closeCardCommentComposer = closeCardCommentComposer;
window.saveCardCommentFromComposer = saveCardCommentFromComposer;
window.confirmDeleteCardComment = confirmDeleteCardComment;
