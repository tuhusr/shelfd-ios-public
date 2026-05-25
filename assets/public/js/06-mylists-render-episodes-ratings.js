window.__SHELFD_MYLIST_PATCH_VERSION = 'v399-game-status-scroll-toggle-gray';
window.__SHELFD_MYLIST_SWIPE_REMOVED = true;
window.__SHELFD_MYLIST_RENDER_RECOVERY = true;
window.__SHELFD_MYLIST_CONTROLS_STAR_CACHE_BUSTER = true;
let activeGamePlayingFilter = 'live';

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

function invalidateActivityFeedAfterLibraryMutation(options = {}) {
  if (typeof friendActivityCache !== 'undefined') friendActivityCache = null;
  if (typeof friendActivityPromise !== 'undefined') friendActivityPromise = null;
  if (options.reloadIfVisible !== false && typeof loadFriendActivity === 'function') {
    loadFriendActivity();
  }
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
  /* v10.261: music search spans both status tabs (Listened + Planned) and
     matches title OR artist. So typing "Drake" while on music returns every
     Drake album regardless of which bucket it's in. Empty query keeps the
     standard tab filter so the per-tab views stay clean. */
  const isMusicSearch = activeSection === 'music' && !!searchQuery;
  const baseFiltered = items
    .filter(i => isMusicSearch ? true : itemMatchesActiveListStatus(i))
    .filter(i => {
      if (!searchQuery) return true;
      const q = String(searchQuery).toLowerCase();
      const title = String(i?.title || '').toLowerCase();
      if (activeSection === 'music') {
        const artist = String(i?.artist || '').toLowerCase();
        return title.includes(q) || artist.includes(q);
      }
      return title.includes(q);
    });
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
  /* v10.69: was 7 separate `items.filter(...).length` passes over the section's
     full item list — for a large library that's ~7N work every render(). One
     reduce gives identical counts in a single pass. `isCompetitiveGameItem`
     remains the canonical "is this 'live' game actually a competitive one"
     check so behavior for the games-playing subfilter stays intact. */
  const counts = items.reduce((acc, item) => {
    const status = item && item.status;
    if (status === 'watching') acc.watching++;
    else if (status === 'live') {
      if (isCompetitiveGameItem(item)) acc.competitive++;
      else acc.live++;
    }
    else if (status === 'competitive') acc.competitive++;
    else if (status === 'planned') acc.planned++;
    else if (status === 'watched') acc.watched++;
    else if (status === 'wishlist') acc.wishlist++;
    else if (status === 'paused') acc.paused++;
    else if (status === 'dropped') acc.dropped++;
    return acc;
  }, { watching: 0, live: 0, competitive: 0, planned: 0, watched: 0, wishlist: 0, paused: 0, dropped: 0 });
  document.getElementById("count-live").textContent = counts.live;
  document.getElementById("count-watching").textContent = activeSection === 'games'
    ? counts.watching + counts.live + counts.competitive
    : counts.watching;
  document.getElementById("count-planned").textContent = counts.planned;
  document.getElementById("count-watched").textContent = counts.watched;
  const wishlistCountEl = document.getElementById("count-wishlist");
  if (wishlistCountEl) wishlistCountEl.textContent = counts.wishlist;
  document.getElementById("count-paused").textContent = counts.paused;
  const droppedCountEl = document.getElementById("count-dropped");
  if (droppedCountEl) droppedCountEl.textContent = counts.dropped;

  // Add-to-Shelf can be hidden from My Lists while the underlying modal stays available elsewhere.
  const addBtn = document.getElementById("add-btn");
  if (addBtn) addBtn.textContent = '+ Add to Shelf';
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
    /* v10.254 / v10.261: music exposes Planned + In Rotation + Listened.
       Other status tabs (paused/wishlist) are hidden under music. */
    if (b.dataset.tab === "paused") {
      b.style.display = (activeSection === "games" || activeSection === "music") ? "none" : "";
    }
    if (b.dataset.tab === "wishlist") {
      b.style.display = activeSection === "games" ? "" : "none";
      b.childNodes[0].textContent = "Wishlist";
    }
    if (b.dataset.tab === "watching") {
      b.style.display = activeSection === "movies" ? "none" : "";
      b.childNodes[0].textContent = activeSection === "games"
        ? "Playing"
        : activeSection === "music"
          ? "In Rotation"
          : isReadingSection(activeSection) ? "Reading" : "Watching";
    }
    if (b.dataset.tab === "planned") {
      b.childNodes[0].textContent = activeSection === "games"
        ? "Backloggd"
        : activeSection === "music"
          ? "Planned"
          : isReadingSection(activeSection) ? "TBR" : "Watchlist";
    }
    if (b.dataset.tab === "watched") {
      b.childNodes[0].textContent = activeSection === "games"
        ? "Played"
        : activeSection === "music"
          ? "Listened"
          : isReadingSection(activeSection) ? "Read" : "Watched";
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
          : "Start from Discover or Search to add titles to your shelf.";
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

function renderStars(rating, itemId, prefix, size, sectionOverride = '') {
  size = size || 14;
  const section = sectionOverride || activeSection;
  return buildRatingStarsMarkup(rating, itemId, prefix, size, section, !viewingUser);
}

/* ============================================================================
   v10.404: RATING BUBBLE — known pattern snapshot.

   Lifted verbatim (markup + CSS pattern + interaction) from the season
   card rating chip at renderMyListEpisodePageSeasonRatingMarkup() / the
   `.mylist-episode-page-season-rating-control` family. Renamed and
   wrapped so it can be hosted on My List title cards in:
     - shows  : watching / watched / paused
     - anime  : watching / watched / paused
     - music  : watching (In Rotation) / watched (Listened)
   Replaces the legacy 10-stars-laid-out widget on those cards. Sits
   bottom-LEFT of the card, aligned with the poster.

   Differences from the season-card version:
     • Chip is at the LEFT edge of its slot, so the stars popout glides
       to the RIGHT (season-card popout glides LEFT because the chip
       sits on the right edge of a season header).
     • Music gets 5 half-step stars (10 half-step buttons) inside the
       popout — preserves the universal "music is 5-star" spec from
       v10.393. TV / anime show the standard 10 full stars.

   The commit path goes through the shared `rate(itemId, 'overall',
   score)` pipeline, same as every other "overall" rating surface — so
   one click here updates `item.rating` once and propagates to the FP
   review, the activity feed, friend visibility, etc. ============================================================================ */
let myListCardExpandedRatingKey = '';

function buildRatingBubbleMarkup(item = {}, section = activeSection, opts = {}) {
  const itemId = String(item?.id || '');
  if (!itemId) return '';
  const rating = Number(item?.rating || 0);
  const interactive = !viewingUser;
  const key = `${itemId}:overall`;
  const isExpanded = myListCardExpandedRatingKey === key;
  /* v10.508: optional "/5" display mode. When `opts.outOfFive` is true the
     collapsed chip always shows the value normalized to a 5-point scale
     with the "/5" suffix (e.g. "4/5", "3.5/5"). Used by the full-page
     album shelf where the rating header is explicitly framed as "Your
     rating ⭐ X/5". The underlying stars + scrub + commit behavior is
     unchanged — this only affects the chip-value text. */
  const outOfFive = !!opts.outOfFive;
  /* v10.407: half-step rendering is now driven by the actual scale
     preference (`isFivePointRatingSection`), not by `section === 'music'`.
     With music defaulting to 10-star, the bubble renders 10 full stars
     for music too. Half-step still works for any section the user has
     manually set to 5-star. */
  const isHalfStep = typeof isFivePointRatingSection === 'function'
    ? isFivePointRatingSection(section)
    : false;
  /* Numeric label: 5-star scale shows half-step (e.g. "3.5"); 10-star
     scale shows the integer (e.g. "7"). Empty = unrated bubble shows
     just the icon.
     v10.508: when outOfFive is requested, always convert to 5-point
     and append "/5" regardless of the section's underlying scale.
     v10.513 BUG FIX: the outOfFive branch was using `rating` directly
     when isHalfStep was true, but the stored rating is ALWAYS on the
     1–10 unit scale (each unit = half-star) regardless of half-step
     mode. So a 4-star rating (stored as 8) was rendering as "8/5"
     instead of "4/5". Always divide by 2 here — the storage→display
     conversion is the same as `formatRatingValueForSection` (line 574
     of 04-shared-utils-data.js). */
  let labelText;
  if (outOfFive) {
    if (rating > 0) {
      const fiveValue = rating / 2;
      const formatted = fiveValue % 1 === 0
        ? String(fiveValue)
        : fiveValue.toFixed(1);
      labelText = `${formatted}/5`;
    } else {
      labelText = '';
    }
  } else {
    labelText = rating > 0
      ? (isHalfStep
          ? (typeof formatRatingValueForSection === 'function'
              ? formatRatingValueForSection(rating, section)
              : String(rating / 2))
          : String(rating))
      : '';
  }
  /* v10.405: stars sit INSIDE the same pill as the chip value — no
     separate popout. The `.rating-bubble-stars-track` is the inline
     expansion slot that goes from max-width:0 (collapsed, hidden) to
     its natural width on `.is-expanded`. Click anywhere on the pill
     that isn't a star = toggle (handled by the outer onclick); clicks
     on individual stars stopPropagation and route to rate(). */
  let starsHtml = '';
  if (isHalfStep) {
    /* v10.510: REBUILT half-step star rendering.
       Old approach (v10.405–v10.509): two side-by-side button glyphs per
       star, clipped via `width: 9-11px; overflow: hidden; text-indent:
       -9 to -11px`. At the original 9px size the visual seam was hidden,
       but at the larger 11px+ size introduced in v10.509 the seam became
       visible — each "star" showed a vertical break running down the
       middle plus subtle glyph misalignment, producing the "doubled"
       look the user reported.
       New approach: SVG-style layering, same pattern used successfully
       by the activity card `renderActivityRatingStar` at
       10-activity-feed.js:4881. Per visual star we render ONE slot
       containing:
         (a) a base ★ glyph (grey, full-width, visible always)
         (b) a fill ★ glyph (gold, full-width, clipped via clip-path
             to the per-slot fill percent — 0% / 50% / 100%)
         (c) two invisible interactive buttons positioned as left/right
             half hit targets, each carrying the data-score the rate()
             pipeline needs.
       Result: clean glyphs with no seams, half-fill is a true CSS clip
       on a single glyph, the bubble scales cleanly at any size.
       Storage and click semantics are UNCHANGED — `data-score` still
       1–10 (half-star units), `rate()` still receives the same values. */
    for (let star = 1; star <= 5; star++) {
      const leftVal = star * 2 - 1;   // 1, 3, 5, 7, 9
      const rightVal = star * 2;      // 2, 4, 6, 8, 10
      let fillPct = 0;
      if (rating >= rightVal) fillPct = 100;
      else if (rating >= leftVal) fillPct = 50;
      const leftLabel = `${leftVal / 2} of 5`;
      const rightLabel = `${rightVal / 2} of 5`;
      if (interactive) {
        starsHtml +=
          `<span class="rating-bubble-star-slot" data-star-index="${star}" style="--star-fill:${fillPct}%">`
          + `<span class="rating-bubble-star-base" aria-hidden="true">&#9733;</span>`
          + `<span class="rating-bubble-star-fill" aria-hidden="true">&#9733;</span>`
          + `<button type="button" class="rating-bubble-star-hit rating-bubble-star-hit-left" data-score="${leftVal}" aria-label="Rate ${leftLabel}" onclick="event.stopPropagation();rateMyListCardRatingBubble('${escAttr(itemId)}','${escAttr(section)}',${leftVal},event)"></button>`
          + `<button type="button" class="rating-bubble-star-hit rating-bubble-star-hit-right" data-score="${rightVal}" aria-label="Rate ${rightLabel}" onclick="event.stopPropagation();rateMyListCardRatingBubble('${escAttr(itemId)}','${escAttr(section)}',${rightVal},event)"></button>`
          + `</span>`;
      } else {
        starsHtml +=
          `<span class="rating-bubble-star-slot" data-star-index="${star}" style="--star-fill:${fillPct}%">`
          + `<span class="rating-bubble-star-base" aria-hidden="true">&#9733;</span>`
          + `<span class="rating-bubble-star-fill" aria-hidden="true">&#9733;</span>`
          + `</span>`;
      }
    }
  } else {
    for (let score = 1; score <= 10; score++) {
      const lit = score <= rating ? ' lit' : '';
      if (interactive) {
        starsHtml += `<button type="button" class="rating-bubble-star${lit}" data-score="${score}" onclick="event.stopPropagation();rateMyListCardRatingBubble('${escAttr(itemId)}','${escAttr(section)}',${score},event)">&#9733;</button>`;
      } else {
        starsHtml += `<span class="rating-bubble-star${lit}">&#9733;</span>`;
      }
    }
  }
  const expandedClass = isExpanded ? ' is-expanded' : '';
  /* v10.407: half-step CSS variant decoupled from "music" identity —
     the rating-bubble--halfstep class fires whenever scale is 5,
     regardless of section. Old `.rating-bubble--music` class still
     emitted as an alias for any external selector / migration. */
  const halfStepClass = isHalfStep ? ' rating-bubble--halfstep rating-bubble--music' : '';
  const ratedClass = rating > 0 ? ' is-rated' : '';
  /* The outer pill IS the toggle button surface. Using a div with
     role="button" (not an actual <button>) so we can nest interactive
     star <button>s inside without invalid-nesting. Pointer-events on
     the stars track are gated to expanded state so clicks pass
     straight through to the outer surface when collapsed. */
  const role = interactive ? 'button' : 'group';
  const tabindex = interactive ? '0' : '-1';
  const toggleHandler = interactive
    ? ` onclick="event.stopPropagation();toggleMyListCardRatingBubble('${escAttr(itemId)}','${escAttr(section)}',event)"`
    : ' aria-disabled="true"';
  /* v10.406: inline touch handlers add horizontal scrub-to-rate on the
     expanded bubble. Same gesture model as the music widget and the
     per-track widget — 18px lock-in, midpoint cross-over. Tap-to-toggle
     still works because the scrub handler only locks in when motion
     exceeds the threshold; below that, the tap routes through to the
     star button or the outer toggle as usual. */
  const touchAttrs = interactive
    ? ' ontouchstart="ratingBubbleTouchStart(event)"'
      + ' ontouchmove="ratingBubbleTouchMove(event)"'
      + ' ontouchend="ratingBubbleTouchEnd(event)"'
      + ' ontouchcancel="ratingBubbleTouchEnd(event)"'
    : '';
  /* v10.508: `data-out-of-five="1"` persists the /5 display mode across
     re-renders. updateOverallRatingUI reads it from the existing node
     and passes `{outOfFive: true}` to the rebuild; the touch-scrub
     handler reads it to format the in-progress preview number with the
     "/5" suffix. */
  const outOfFiveAttr = outOfFive ? ' data-out-of-five="1"' : '';
  return `<div class="rating-bubble${expandedClass}${halfStepClass}${ratedClass}" role="${role}" tabindex="${tabindex}" aria-expanded="${isExpanded ? 'true' : 'false'}" data-item-id="${escAttr(itemId)}" data-section="${escAttr(section)}" data-prefix="overall"${outOfFiveAttr}${toggleHandler}${touchAttrs}>`
    + `<span class="rating-bubble-chip-icon" aria-hidden="true">&#9733;</span>`
    + (labelText ? `<span class="rating-bubble-chip-value">${escHtml(labelText)}</span>` : '')
    + `<div class="rating-bubble-stars-track" aria-hidden="${isExpanded ? 'false' : 'true'}">${starsHtml}</div>`
    + `</div>`;
}

window.toggleMyListCardRatingBubble = function(itemId, section, event) {
  if (event) {
    event.preventDefault?.();
    event.stopPropagation?.();
  }
  const idStr = String(itemId || '');
  const key = `${idStr}:overall`;
  const willOpen = myListCardExpandedRatingKey !== key;
  /* Close every other open bubble first — only one at a time, matches
     the season-card behavior. */
  document.querySelectorAll('.rating-bubble.is-expanded').forEach(node => {
    node.classList.remove('is-expanded');
    const chip = node.querySelector('.rating-bubble-chip');
    if (chip) chip.setAttribute('aria-expanded', 'false');
    const stars = node.querySelector('.rating-bubble-stars');
    if (stars) stars.setAttribute('aria-hidden', 'true');
  });
  if (willOpen) {
    /* v10.441: switched from `querySelector` (singular) to
       `querySelectorAll` so EVERY rating-bubble matching the item
       id toggles at once. The full-page album-details overlay
       re-renders the bubble alongside the underlying MyList title
       card, so the same item id can produce two bubbles in the
       DOM simultaneously. The old `querySelector` returned only
       the FIRST match (usually the title card behind the overlay),
       leaving the album-details bubble visually unresponsive to
       clicks — that's why the user reported "clicking does
       nothing" on the album details page. Toggling all matches
       in lock-step keeps both surfaces in sync regardless of
       which one the user tapped. */
    document.querySelectorAll(`.rating-bubble[data-item-id="${CSS.escape(idStr)}"]`).forEach(target => {
      target.classList.add('is-expanded');
      const chip = target.querySelector('.rating-bubble-chip');
      if (chip) chip.setAttribute('aria-expanded', 'true');
      const stars = target.querySelector('.rating-bubble-stars');
      if (stars) stars.setAttribute('aria-hidden', 'false');
    });
    myListCardExpandedRatingKey = key;
  } else {
    myListCardExpandedRatingKey = '';
  }
};

window.rateMyListCardRatingBubble = function(itemId, section, score, event) {
  if (event) {
    event.preventDefault?.();
    event.stopPropagation?.();
  }
  const idStr = String(itemId || '');
  /* Hand off to the shared overall-rating pipeline. rate() updates
     item.rating, persists, fires activity, calls updateOverallRatingUI
     (which repaints the bubble with new lit state), and fires
     playRatingAnimation (which picks up .rating-bubble-star.lit via the
     v10.404 selector widening below). */
  try { rate(idStr, 'overall', Number(score) || 0); } catch (_) {}
  /* Auto-collapse after the pop animation has had time to play. The
     bubble re-renders during rate() via updateOverallRatingUI; we keep
     myListCardExpandedRatingKey set so the rebuilt bubble retains
     is-expanded for the animation, then clear + collapse after 700ms. */
  setTimeout(() => {
    if (myListCardExpandedRatingKey === `${idStr}:overall`) {
      myListCardExpandedRatingKey = '';
    }
    document.querySelectorAll(`.rating-bubble[data-item-id="${CSS.escape(idStr)}"].is-expanded`).forEach(node => {
      node.classList.remove('is-expanded');
      const chip = node.querySelector('.rating-bubble-chip');
      if (chip) chip.setAttribute('aria-expanded', 'false');
      const stars = node.querySelector('.rating-bubble-stars');
      if (stars) stars.setAttribute('aria-hidden', 'true');
    });
  }, 700);
};

/* v10.406: scrub-to-rate touch handlers for the rating bubble. Only
   active when the bubble is expanded — collapsed-state taps still
   trigger the toggle as normal. Mirrors the music widget's
   musicRatingTouchStart/Move/End and the per-track equivalents:
     • 18px horizontal-dominant motion to lock into scrub mode (slight
       finger wiggle stays a tap)
     • cross-over threshold = midpoint of each star button (so each
       half-step has a "dwell zone" the touch has to commit to)
     • on touchend the value lands via rateMyListCardRatingBubble,
       same commit path as a single-tap-on-a-star, so the auto-
       collapse + animation timing stays consistent. */
/* v10.515: rebuilds the scrub cache from the CURRENT DOM positions.
   Extracted from touchstart so the touchmove handler can refresh it at
   the moment scrub locks in — needed because the cache built at
   touchstart may have captured stale positions if the expand
   transition was still mid-flight (user tapped chip, expanded, and
   started dragging before the stars-track finished sliding out). */
function buildRatingBubbleScrubCache(bubble) {
  const isHalfStepBubble = bubble.classList.contains('rating-bubble--halfstep')
    || bubble.classList.contains('rating-bubble--music');
  const hitSelector = isHalfStepBubble ? '.rating-bubble-star-hit' : '.rating-bubble-star';
  const hits = Array.from(bubble.querySelectorAll(hitSelector));
  const hitMidpoints = hits.map(btn => {
    const r = btn.getBoundingClientRect();
    return r.left + r.width / 2;
  });
  const slots = isHalfStepBubble
    ? Array.from(bubble.querySelectorAll('.rating-bubble-star-slot'))
    : [];
  bubble._scrubCache = {
    isHalfStepBubble,
    hits,
    hitMidpoints,
    slots,
    lastVal: -1
  };
}

window.ratingBubbleTouchStart = function(e) {
  const bubble = e.currentTarget;
  if (!e.touches || !e.touches[0]) return;
  bubble.dataset.touchStartX = String(e.touches[0].clientX);
  bubble.dataset.touchStartY = String(e.touches[0].clientY);
  bubble.dataset.scrubVal = '0';
  bubble.dataset.scrubbing = 'false';
  /* v10.511: cache hit-zone midpoints + slot refs ONCE on touchstart.
     The bubble does not move during a scrub, so layout reads via
     getBoundingClientRect can be done once and reused across every
     touchmove. Previously touchmove ran querySelectorAll + 10x
     getBoundingClientRect per event — at 60Hz that's 600 layout reads
     per second, which was the dominant source of scrub jank on iOS.
     With this cache, touchmove is just an O(n) array scan + one
     setProperty per slot that changed.
     v10.515: cache is also rebuilt at lock-in (see touchmove) to handle
     the case where touchstart captured mid-transition positions. */
  buildRatingBubbleScrubCache(bubble);
};

window.ratingBubbleTouchMove = function(e) {
  const bubble = e.currentTarget;
  const touch = e.touches && e.touches[0];
  if (!touch) return;
  /* Scrub only makes sense on the expanded popout — the collapsed pill
     has no visible stars to drag across. For a collapsed bubble we let
     the gesture fall through so the outer onclick can toggle on tap. */
  if (!bubble.classList.contains('is-expanded')) return;
  const dx = Math.abs(touch.clientX - parseFloat(bubble.dataset.touchStartX || 0));
  const dy = Math.abs(touch.clientY - parseFloat(bubble.dataset.touchStartY || 0));
  if (bubble.dataset.scrubbing !== 'true') {
    /* v10.515: dropped lock-in threshold 18 → 6 so scrub engages almost
       immediately on intentional drag. Taps still work via the inline
       onclick on each `.rating-bubble-star-hit` button (0px movement),
       so a low threshold doesn't compromise tap accuracy. The `dy >
       dx` guard still filters out vertical-dominant gestures (page
       scroll). */
    if (dx < 6 || dy > dx) return;
    /* v10.515: rebuild the cache at the moment scrub locks in. The
       original cache was captured at touchstart, but if the user
       tapped to expand and started dragging before the stars-track's
       max-width transition completed, the cached hit positions are
       from the mid-transition state and won't match the visible star
       positions. Rebuilding at lock-in guarantees the cache reflects
       wherever the stars are NOW. */
    buildRatingBubbleScrubCache(bubble);
  }
  bubble.dataset.scrubbing = 'true';
  e.preventDefault();
  /* v10.511: scrub uses the cache built in touchstart (hits + midpoints
     + slot refs). No DOM queries, no getBoundingClientRect per move.
     Also early-exits when val hasn't changed since the last touchmove,
     skipping all DOM writes for the common case of finger micro-jitter
     within a single slot's half-zone. */
  const cache = bubble._scrubCache;
  if (!cache) return;
  let val = 0;
  for (let i = 0; i < cache.hitMidpoints.length; i++) {
    if (touch.clientX >= cache.hitMidpoints[i]) val = i + 1;
  }
  if (val < 1) return;
  if (val === cache.lastVal) return;
  cache.lastVal = val;
  bubble.dataset.scrubVal = String(val);
  if (cache.isHalfStepBubble) {
    /* Slots are in star-index order (1..5). Per slot, compute its target
       fill from val: above the slot's full-step value → 100, above the
       half-step value → 50, otherwise 0. Single setProperty call per
       slot — no querySelector, no condition checks beyond integer
       comparisons. */
    for (let idx = 0; idx < cache.slots.length; idx++) {
      const starIdx = idx + 1;
      const leftV = starIdx * 2 - 1;
      const rightV = starIdx * 2;
      let pct = 0;
      if (val >= rightV) pct = 100;
      else if (val >= leftV) pct = 50;
      cache.slots[idx].style.setProperty('--star-fill', `${pct}%`);
    }
  } else {
    for (let i = 0; i < cache.hits.length; i++) {
      if (i + 1 <= val) cache.hits[i].classList.add('lit');
      else cache.hits[i].classList.remove('lit');
    }
  }
  /* Live-update the chip value label so the user sees the in-progress
     rating tick during scrub. Half-step bubbles show "X" or "X.X"
     (e.g. "3.5"). When `data-out-of-five="1"` (album shelf header) we
     append "/5". The legacy non-half-step path shows the raw 1-10
     number. `isHalfStepBubble` is read off the cache. */
  const chipValue = bubble.querySelector('.rating-bubble-chip-value');
  let display;
  if (bubble.dataset.outOfFive === '1') {
    const fiveValue = val / 2;
    display = fiveValue % 1 === 0 ? `${fiveValue}/5` : `${fiveValue.toFixed(1)}/5`;
  } else if (cache.isHalfStepBubble) {
    const fiveValue = val / 2;
    display = fiveValue % 1 === 0 ? String(fiveValue) : fiveValue.toFixed(1);
  } else {
    display = String(val);
  }
  if (chipValue) {
    chipValue.textContent = display;
  } else {
    const icon = bubble.querySelector('.rating-bubble-chip-icon');
    if (icon) {
      const span = document.createElement('span');
      span.className = 'rating-bubble-chip-value';
      span.textContent = display;
      icon.insertAdjacentElement('afterend', span);
    }
  }
};

window.ratingBubbleTouchEnd = function(e) {
  const bubble = e.currentTarget;
  /* v10.511: release the cached refs even if scrub never engaged, so a
     plain tap that fell through to onclick doesn't leave a stale cache
     hanging on the element. */
  const wasScrubbing = bubble.dataset.scrubbing === 'true';
  delete bubble._scrubCache;
  if (!wasScrubbing) return;
  bubble.dataset.scrubbing = 'false';
  const val = parseInt(bubble.dataset.scrubVal || '0', 10);
  bubble.dataset.scrubVal = '0';
  if (val < 1) return;
  e.preventDefault();
  const itemId = bubble.getAttribute('data-item-id') || '';
  const section = bubble.getAttribute('data-section') || activeSection;
  if (!itemId) return;
  /* v10.515: SCRUB-COMMIT EXCEPTION — if the scrubbed value lands on
     the rating the item already has, do NOT commit. rate() at line
     9176 toggles the rating to 0 when the new score equals the
     previous score (so a deliberate tap on the lit star can clear).
     But that toggle-off behavior is wrong for SCRUB gestures — a user
     who scrubs through values and happens to release on the current
     rating shouldn't accidentally clear their rating to 0. Only an
     explicit tap-on-current-value (which goes through the inline
     onclick on the star button, NOT through this touchend) should
     clear. Here we look up the item's current rating; if val matches,
     we just close the bubble without re-rating. */
  let item = null;
  try {
    if (typeof getMyListEpisodeInteractionContext === 'function') {
      item = getMyListEpisodeInteractionContext(itemId, section)?.item || null;
    } else if (typeof data === 'object' && data[section]) {
      item = data[section].find(i => i?.id === itemId) || null;
    }
  } catch (_) {}
  const currentRating = Number(item?.rating || 0);
  if (val === currentRating) {
    /* Same-value scrub commit — close the bubble (mirror the auto-
       collapse logic from rateMyListCardRatingBubble) without
       touching the stored rating. */
    setTimeout(() => {
      if (myListCardExpandedRatingKey === `${itemId}:overall`) {
        myListCardExpandedRatingKey = '';
      }
      document.querySelectorAll(`.rating-bubble[data-item-id="${CSS.escape(itemId)}"].is-expanded`).forEach(node => {
        node.classList.remove('is-expanded');
        const chip = node.querySelector('.rating-bubble-chip');
        if (chip) chip.setAttribute('aria-expanded', 'false');
        const stars = node.querySelector('.rating-bubble-stars');
        if (stars) stars.setAttribute('aria-hidden', 'true');
      });
    }, 200);
    return;
  }
  /* Commit through the same path as a click on a star — that runs
     rate() (which fires animation + persist + activity hooks) and
     schedules the 700ms auto-collapse so the bubble closes after the
     pop animation. */
  if (typeof window.rateMyListCardRatingBubble === 'function') {
    window.rateMyListCardRatingBubble(itemId, section, val);
  }
};

/* Outside-click closes any open rating bubble without committing. */
if (typeof window !== 'undefined' && !window.__shelfdRatingBubbleOutsideBound) {
  document.addEventListener('click', (e) => {
    if (!myListCardExpandedRatingKey) return;
    const target = e.target;
    if (!target || target.nodeType !== 1) return;
    if (target.closest && target.closest('.rating-bubble')) return;
    myListCardExpandedRatingKey = '';
    document.querySelectorAll('.rating-bubble.is-expanded').forEach(node => {
      node.classList.remove('is-expanded');
      const chip = node.querySelector('.rating-bubble-chip');
      if (chip) chip.setAttribute('aria-expanded', 'false');
      const stars = node.querySelector('.rating-bubble-stars');
      if (stars) stars.setAttribute('aria-hidden', 'true');
    });
  }, true);
  window.__shelfdRatingBubbleOutsideBound = true;
}

function renderMyListCardOverallRating(item = {}, section = activeSection) {
  /* v10.395: music uses a clean-slate, self-contained widget that does NOT
     share any class names with the global .star-btn rules. Earlier attempts
     (v10.393, v10.394) tried to override the global compact `width: 16px /
     8px !important` styles in 17-auth-flow-setup.css, but those rules use
     `:not(:first-of-type)` which gave them a specificity edge our prefix
     could not beat. Cleanest fix: bypass the shared infrastructure with
     dedicated `.music-rating` markup that's invisible to any other CSS. */
  if (section === 'music') {
    return renderMyListMusicCardOverallRating(item);
  }
  return renderStars(Number(item?.rating || 0), item?.id || '', 'overall', 16, section);
}

/* v10.395 / v10.396: dedicated music rating widget — Musicboard-style
   5-star bar with half-step granularity. Used by the My List title card
   AND the Tracklist full page (album shelf). New class names so global
   `.star-btn` rules can't compress it.

   Save path reuses the shared `rate(itemId, prefix, score)` so item
   updates / activity / save() debounce / firestore writes all flow
   through the same pipeline as every other section. Both surfaces share
   `item.rating` as the single source of truth (1–10 int stored,
   displayed as 0.5 increments out of 5).

   Size is driven by inline CSS variables on the container, so the same
   markup works for the compact 20px title-card widget and the larger
   26px album-page widget without a CSS variant per surface. */
function buildMusicRatingMarkup(rating = 0, itemId = '', prefix = 'overall', size = 20, interactive = true) {
  const cleanRating = Number(rating || 0);
  const halfWidth = Math.max(1, Math.round(size / 2));
  const escapedItemId = (typeof escAttr === 'function') ? escAttr(itemId) : String(itemId);
  const escapedPrefix = (typeof escAttr === 'function') ? escAttr(prefix) : String(prefix);
  const touchAttrs = interactive
    ? ' ontouchstart="musicRatingTouchStart(event)"' +
      ' ontouchmove="musicRatingTouchMove(event)"' +
      ' ontouchend="musicRatingTouchEnd(event)"' +
      ' ontouchcancel="musicRatingTouchEnd(event)"'
    : '';
  /* v10.407: branch on the actual music scale preference. Pre-v10.407
     this widget hardcoded 5-star half-step (10 buttons composing 5
     visible stars via text-indent). Music is now 10-star by default, so
     when scale is 'ten' we render 10 standard full-star buttons. The
     CSS variable approach for star-size still drives sizing for both
     paths. */
  const halfStep = typeof isFivePointRatingSection === 'function'
    ? isFivePointRatingSection('music')
    : false;
  const styleAttr = halfStep
    ? `style="--music-star-size:${size}px;--music-half-width:${halfWidth}px;"`
    : `style="--music-star-size:${size}px;"`;
  const scaleClass = halfStep ? ' music-rating--halfstep' : ' music-rating--ten';
  let html = `<div class="music-rating${scaleClass}" ${styleAttr} data-item-id="${escapedItemId}" data-prefix="${escapedPrefix}" data-section="music"${touchAttrs}>`;
  if (halfStep) {
    for (let star = 1; star <= 5; star++) {
      const leftVal = star * 2 - 1;
      const rightVal = star * 2;
      const leftLit = leftVal <= cleanRating ? ' lit' : '';
      const rightLit = rightVal <= cleanRating ? ' lit' : '';
      if (interactive) {
        html += `<button type="button" class="music-rating-half music-rating-half-left${leftLit}" data-star="${leftVal}"`
          + ` onclick="event.stopPropagation();rate('${escapedItemId}','${escapedPrefix}',${leftVal})"`
          + ` onmouseenter="musicRatingHover(this,${leftVal})" onmouseleave="musicRatingUnhover(this,${cleanRating})">★</button>`;
        html += `<button type="button" class="music-rating-half music-rating-half-right${rightLit}" data-star="${rightVal}"`
          + ` onclick="event.stopPropagation();rate('${escapedItemId}','${escapedPrefix}',${rightVal})"`
          + ` onmouseenter="musicRatingHover(this,${rightVal})" onmouseleave="musicRatingUnhover(this,${cleanRating})">★</button>`;
      } else {
        html += `<span class="music-rating-half music-rating-half-left${leftLit}">★</span>`;
        html += `<span class="music-rating-half music-rating-half-right${rightLit}">★</span>`;
      }
    }
  } else {
    /* 10-star integer path — full-glyph buttons, no half-step trick. */
    for (let score = 1; score <= 10; score++) {
      const lit = score <= cleanRating ? ' lit' : '';
      if (interactive) {
        html += `<button type="button" class="music-rating-full${lit}" data-star="${score}"`
          + ` onclick="event.stopPropagation();rate('${escapedItemId}','${escapedPrefix}',${score})"`
          + ` onmouseenter="musicRatingHover(this,${score})" onmouseleave="musicRatingUnhover(this,${cleanRating})">★</button>`;
      } else {
        html += `<span class="music-rating-full${lit}">★</span>`;
      }
    }
  }
  if (cleanRating > 0) {
    /* v10.407: label respects the actual scale — "3.5" for 5-star
       half-step, "7" for 10-star integer. Delegates to the shared
       formatter so other downstream consumers stay in sync. */
    const label = typeof formatRatingValueForSection === 'function'
      ? formatRatingValueForSection(cleanRating, 'music')
      : (halfStep ? (cleanRating / 2).toFixed(1) : String(cleanRating));
    html += `<span class="music-rating-value">${label}</span>`;
  }
  html += `</div>`;
  return html;
}

function renderMyListMusicCardOverallRating(item = {}) {
  /* v10.403: music title-card stars match the TV-show widget exactly —
     16px glyph + 12px value label (the label override lives in the
     scoped `.music-bottom-rating-slot .music-rating-value` rule in
     01-mylists-cards-episodes.css). */
  return buildMusicRatingMarkup(Number(item?.rating || 0), item?.id || '', 'overall', 16, !viewingUser);
}

/* v10.395: hover preview — paint .lit-hover on every half-step up to and
   including the hovered one. Mirrors hoverStars() behavior. */
function musicRatingHover(target, score) {
  const c = target && target.parentElement;
  if (!c) return;
  /* v10.407: widget can render either `.music-rating-half` (half-step
     scale) or `.music-rating-full` (10-star scale). Both selectors so
     hover preview works for either path. */
  const stars = c.querySelectorAll('.music-rating-half, .music-rating-full');
  stars.forEach((btn, i) => {
    if (i + 1 <= score) btn.classList.add('lit-hover');
    else btn.classList.remove('lit-hover');
  });
}
function musicRatingUnhover(target, currentRating) {
  const c = target && target.parentElement;
  if (!c) return;
  c.querySelectorAll('.music-rating-half, .music-rating-full').forEach(btn => btn.classList.remove('lit-hover'));
}

/* v10.395: horizontal touch-scrub — parallels starsTouchStart/Move/End. */
function musicRatingTouchStart(e) {
  const c = e.currentTarget;
  if (!e.touches || !e.touches[0]) return;
  c.dataset.touchStartX = String(e.touches[0].clientX);
  c.dataset.touchStartY = String(e.touches[0].clientY);
  c.dataset.scrubVal = '0';
  c.dataset.scrubbing = 'false';
}
function musicRatingTouchMove(e) {
  const c = e.currentTarget;
  const touch = e.touches && e.touches[0];
  if (!touch) return;
  const dx = Math.abs(touch.clientX - parseFloat(c.dataset.touchStartX || 0));
  const dy = Math.abs(touch.clientY - parseFloat(c.dataset.touchStartY || 0));
  if (c.dataset.scrubbing !== 'true') {
    /* v10.401: require 18px of horizontal-dominant motion before locking
       into scrub mode (was 10px). Slight wiggle stays a tap so users
       trying to land on a half-rating don't accidentally trigger a scrub
       that overshoots to 5/5. */
    if (dx < 18 || dy > dx) return;
  }
  c.dataset.scrubbing = 'true';
  e.preventDefault();
  /* v10.407: scrub works for either widget variant — half-step or full
     10-star — by selecting both star classes. Same midpoint-cross-over
     logic from v10.401 applies regardless. */
  const stars = Array.from(c.querySelectorAll('.music-rating-half, .music-rating-full'));
  let val = 0;
  stars.forEach((btn, i) => {
    const rect = btn.getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    if (touch.clientX >= midpoint) val = i + 1;
  });
  if (val >= 1) {
    c.dataset.scrubVal = String(val);
    stars.forEach((b, i) => {
      if (i + 1 <= val) b.classList.add('lit-hover');
      else b.classList.remove('lit-hover');
    });
    let label = c.querySelector('.music-rating-value');
    if (!label) {
      label = document.createElement('span');
      label.className = 'music-rating-value';
      c.appendChild(label);
    }
    /* Format using the shared section-aware formatter so the live
       preview matches the post-rate value display. */
    label.textContent = typeof formatRatingValueForSection === 'function'
      ? formatRatingValueForSection(val, 'music')
      : String(val);
  }
}
function musicRatingTouchEnd(e) {
  const c = e.currentTarget;
  if (c.dataset.scrubbing !== 'true') return;
  const val = parseInt(c.dataset.scrubVal || '0', 10);
  c.dataset.scrubVal = '0';
  c.dataset.scrubbing = 'false';
  c.querySelectorAll('.music-rating-half').forEach(b => b.classList.remove('lit-hover'));
  if (val > 0) {
    e.preventDefault();
    rate(c.dataset.itemId, c.dataset.prefix, val);
  }
}

/* Expose for inline handler resolution + cross-file consumers
   (album shelf page in 27-music-album-shelf-page.js uses
   window.buildMusicRatingMarkup). */
if (typeof window !== 'undefined') {
  window.musicRatingHover = musicRatingHover;
  window.musicRatingUnhover = musicRatingUnhover;
  window.musicRatingTouchStart = musicRatingTouchStart;
  window.musicRatingTouchMove = musicRatingTouchMove;
  window.musicRatingTouchEnd = musicRatingTouchEnd;
  window.buildMusicRatingMarkup = buildMusicRatingMarkup;
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

function findMyListGameProfileItem(id = '') {
  const key = String(id || '').trim();
  if (!key) return { item: null, index: -1, source: null };
  const own = getScreenListGameById(key);
  if (own.item) return { ...own, source: data };
  const source = typeof getVisibleListData === 'function' ? getVisibleListData() : data;
  const list = Array.isArray(source?.games) ? source.games : [];
  const index = list.findIndex(entry =>
    String(entry?.id || '') === key ||
    getScreenListGameStableKey(entry) === key
  );
  return { item: index >= 0 ? list[index] : null, index, source };
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

function isMyListCompetitiveGameItem(item = {}) {
  return activeSection === 'games' && String(item?.status || '').toLowerCase() === 'competitive';
}

function getMyListGameProfileStatValue(item = {}, keys = [], fallback = 'X') {
  for (const key of keys) {
    const value = key.split('.').reduce((acc, part) => acc && acc[part], item);
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return fallback;
}

function getMyListGameProfileStats(item = {}) {
  const stats = item?.competitiveStats && typeof item.competitiveStats === 'object' ? item.competitiveStats : {};
  const account = item?.trackerAccount && typeof item.trackerAccount === 'object' ? item.trackerAccount : {};
  return {
    currentRank: getMyListGameProfileStatValue({ ...item, competitiveStats: stats, trackerAccount: account }, ['competitiveStats.currentRank', 'currentRank', 'trackerCurrentRank'], 'Add'),
    peakRank: getMyListGameProfileStatValue({ ...item, competitiveStats: stats, trackerAccount: account }, ['competitiveStats.peakRank', 'peakRank', 'trackerPeakRank'], 'Add'),
    lifetimeKd: getMyListGameProfileStatValue({ ...item, competitiveStats: stats, trackerAccount: account }, ['competitiveStats.lifetimeKd', 'competitiveStats.kd', 'lifetimeKd', 'gameLifetimeKd', 'trackerKd'], 'Add'),
    seasonKd: getMyListGameProfileStatValue({ ...item, competitiveStats: stats, trackerAccount: account }, ['competitiveStats.seasonKd', 'seasonKd', 'gameSeasonKd'], 'Add'),
    trackerUrl: getMyListGameProfileStatValue({ ...item, competitiveStats: stats, trackerAccount: account }, ['competitiveStats.sourceUrl', 'trackerStatsUrl', 'trackerUrl', 'gameTrackerUrl', 'gameStatsUrl', 'statsUrl'], ''),
    highlightsUrl: getMyListGameProfileStatValue(item, ['highlightsUrl', 'gameHighlightsUrl', 'highlightUrl', 'clipsUrl'], '')
  };
}

function getMyListGameProfileGenreText(value = '') {
  if (Array.isArray(value)) return value.filter(Boolean).map(v => String(v).trim()).filter(Boolean).slice(0, 3).join(', ') || 'Competitive';
  const text = String(value || '').trim();
  return text || 'Competitive';
}

function closeMyListGameProfilePage(options = {}) {
  const overlay = document.getElementById('mylist-game-profile-page');
  if (!overlay) {
    document.body.classList.remove('mylist-game-profile-open');
    return;
  }
  overlay.classList.remove('is-open');
  document.body.classList.remove('mylist-game-profile-open');
  setTimeout(() => {
    try { overlay.remove(); } catch (_) {}
  }, options.instant ? 0 : 320);
}
window.closeMyListGameProfilePage = closeMyListGameProfilePage;

function openMyListGameProfileEdit(event = null, itemId = '') {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if (viewingUser) return;
  const key = String(itemId || '').trim();
  if (!key) return;
  if (typeof window.openTrackerLinkModal === 'function') {
    window.openTrackerLinkModal({ itemId: key });
    return;
  }
  if (typeof showToast === 'function') showToast('Edit tools are still loading');
}
window.openMyListGameProfileEdit = openMyListGameProfileEdit;

function openMyListGameProfilePage(itemId = '') {
  const key = String(itemId || '').trim();
  if (!key) return;
  const { item } = findMyListGameProfileItem(key);
  if (!item) return;
  closeMyListGameProfilePage({ instant: true });
  const details = getScreenListGameDetailValuesFromItem(item);
  const stats = getMyListGameProfileStats(item);
  const title = item.title || item.name || 'Untitled';
  const year = item.year || item.releaseYear || item.released?.slice?.(0, 4) || '';
  const poster = typeof getScreenListDisplayGameCover === 'function'
    ? getScreenListDisplayGameCover(item)
    : (item.cover || item.backgroundImage || item.image || '');
  const genre = getMyListGameProfileGenreText(item.genre || item.genres || item.gameGenre || '');
  const platform = details.platform || item.platform || item.gamePlatform || 'X';
  const hours = details.hours ? `${details.hours}h` : 'X';
  const trackerHref = stats.trackerUrl || details.tracker || '';
  const highlightsHref = stats.highlightsUrl || '';
  const overlay = document.createElement('div');
  overlay.id = 'mylist-game-profile-page';
  overlay.className = 'mylist-game-profile-page';
  overlay.dataset.gameProfileItemId = key;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `${title} game profile`);
  overlay.innerHTML = `
    <div class="mylist-game-profile-shell">
      <header class="mylist-game-profile-topbar">
        <button class="mylist-game-profile-back" type="button" onclick="closeMyListGameProfilePage()" aria-label="Back">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18 9 12l6-6"></path></svg>
        </button>
        <span>Game Profile</span>
        ${!viewingUser ? `<button class="mylist-game-profile-edit" type="button" onclick="openMyListGameProfileEdit(event,'${escAttr(key)}')">Edit</button>` : '<span></span>'}
      </header>
      <main class="mylist-game-profile-scroll">
        <section class="mylist-game-profile-summary">
          <div class="mylist-game-profile-identity">
            <div class="mylist-game-profile-kicker">Competitive</div>
            <h1>${escHtml(title)}</h1>
            <div class="mylist-game-profile-meta-row">
              ${year ? `<span>${escHtml(String(year).slice(0, 4))}</span>` : ''}
            </div>
          </div>
          <div class="mylist-game-profile-cover${poster ? '' : ' no-img'}" ${poster ? `style="background-image:url('${escAttr(poster)}')"` : ''}>${poster ? '' : escHtml(title.slice(0, 1).toUpperCase() || 'G')}</div>
          <div class="mylist-game-profile-facts">
            <div><span>Platform</span><strong>${escHtml(platform)}</strong></div>
            <div><span>Hours played</span><strong>${escHtml(hours)}</strong></div>
            <div><span>Genre</span><strong>${escHtml(genre)}</strong></div>
          </div>
        </section>
        <section class="mylist-game-profile-panel" aria-label="Competitive stats">
          <div class="mylist-game-profile-panel-head">
            <span>Competitive Status</span>
          </div>
          <div class="mylist-game-profile-stat-grid">
            <div class="mylist-game-profile-stat"><span>Peak Rank</span><strong>${escHtml(stats.peakRank)}</strong></div>
            <div class="mylist-game-profile-stat"><span>Current Rank</span><strong>${escHtml(stats.currentRank)}</strong></div>
            <div class="mylist-game-profile-stat"><span>Lifetime KD</span><strong>${escHtml(stats.lifetimeKd)}</strong></div>
            <div class="mylist-game-profile-stat"><span>Season KD</span><strong>${escHtml(stats.seasonKd)}</strong></div>
          </div>
        </section>
        <section class="mylist-game-profile-links" aria-label="Links">
          ${trackerHref ? `<a class="mylist-game-profile-link-row" href="${escAttr(trackerHref)}" target="_blank" rel="noopener"><span>Tracker.gg</span><strong>Open</strong></a>` : `<div class="mylist-game-profile-link-row is-disabled"><span>Tracker.gg</span><strong>Not linked</strong></div>`}
          ${highlightsHref ? `<a class="mylist-game-profile-link-row" href="${escAttr(highlightsHref)}" target="_blank" rel="noopener"><span>Highlights</span><strong>Open</strong></a>` : `<div class="mylist-game-profile-link-row is-disabled"><span>Highlights</span><strong>Not linked</strong></div>`}
        </section>
      </main>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.classList.add('mylist-game-profile-open');
  requestAnimationFrame(() => overlay.classList.add('is-open'));
}
window.openMyListGameProfilePage = openMyListGameProfilePage;

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

function isScreenListWatchedMediaCard(section = activeSection, item = {}) {
  return isScreenListMovieTvAnimeSection(section) && String(item?.status || '') === 'watched';
}

function shouldHideMyListCardGenre(section = activeSection, item = {}) {
  /* v10.77: Watched movie/TV/anime cards SHOW genre again (per the standardized
     Watched metadata order: title → year → genre → status → rating → comment).
     Was previously hidden via `isScreenListWatchedMediaCard`. The TV/Anime
     Watching hide stays — that card has its own progress-meta line that
     replaces genre in the layout. */
  return isScreenListTvAnimeWatchingCard(section, item);
}

/* v10.77: cap a comma-separated genre string to the first N entries, trimmed
   and de-blanked. Used to limit Watched movie/TV/anime cards to 2 genres
   without affecting other contexts that still show the full string. */
function formatMyListGenreList(value = '', max = 2) {
  return String(value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, Math.max(0, Number(max) || 0))
    .join(', ');
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
  const normalizedStatus = String(item?.status || '');
  const isPlannedPrioritySection = tab === 'planned'
    && (section === 'movies' || section === 'shows' || section === 'anime')
    && normalizedStatus === 'planned';
  const isWishlistPrioritySection = tab === 'wishlist'
    && section === 'games'
    && normalizedStatus === 'wishlist';
  return !viewingUser
    && (isPlannedPrioritySection || isWishlistPrioritySection);
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
  /* v10.434: "Priority" word removed from the bubble per spec — the
     number alone now reads as the priority rank. The visible label
     `<span>` is gone; aria-label still carries the full "Watchlist
     priority for {title}" string so VoiceOver / screen readers
     announce context. CSS in 01-mylists-cards-episodes.css updates
     the slot's padding + min-width so the bubble shrinks now that
     the word is gone, and bumps the number's font-size to 11px /
     weight 400 per the same spec. */
  const priorityAria = `Watchlist priority for ${item.title || 'this title'}`;
  return `<label class="watchlist-priority-slot" onclick="event.stopPropagation()">
    <input class="watchlist-priority-input" type="number" inputmode="numeric" pattern="[0-9]*" min="1" step="1" value="${escAttr(value)}" placeholder="-" aria-label="${escAttr(priorityAria)}" data-mylist-action="watch-priority" data-mylist-item-id="${escAttr(item.id)}" oninput="event.stopPropagation()" onchange="event.stopPropagation();setWatchlistPriority('${escAttr(item.id)}', this.value)">
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
  /* v10.389: also extract the soonest UPCOMING season premiere from the
     seasons[] array on the same /tv/{id} response. This lets us surface
     "New season airing M/D" on cards whose show is between seasons (no
     next_episode_to_air yet) AND lets us upgrade a season-premiere episode
     to a "NEW SEASON OUT" label when next_episode_to_air.episode_number is
     1 and matches the season's air_date. Season 0 (Specials) is skipped. */
  const seasons = Array.isArray(details?.seasons) ? details.seasons : [];
  const todayStart = getScreenListTodayStart();
  let nextSeason = null;
  for (const s of seasons) {
    const num = Number(s?.season_number || 0);
    if (num < 1) continue;
    const sDate = String(s?.air_date || '').trim();
    if (!sDate) continue;
    const parsed = parseScreenListDateOnly(sDate);
    if (!parsed || parsed.getTime() < todayStart) continue;
    if (!nextSeason || parsed.getTime() < parseScreenListDateOnly(nextSeason.airDate).getTime()) {
      nextSeason = { airDate: sDate, seasonNumber: num, name: String(s?.name || '') };
    }
  }
  /* Nothing to return at all? Bail. The caller treats null as "no update". */
  if (!airDate && !nextSeason) return null;
  /* v10.415: look up the season's TOTAL episode_count for the upcoming
     next_episode_to_air so we can detect when that episode IS the season
     final. TMDB's `/tv/{id}` response includes `seasons[].episode_count`
     for every season. We match by season_number to the next episode's
     season, then carry the count through `setMyListNextEpisodeMetadata`
     onto the item. */
  let seasonEpisodeCount = 0;
  if (ep) {
    const epSeasonNum = Number(ep?.season_number || ep?.seasonNumber || 0);
    if (epSeasonNum >= 1) {
      const matchSeason = seasons.find(s => Number(s?.season_number || 0) === epSeasonNum);
      const count = Number(matchSeason?.episode_count || 0);
      if (count > 0) seasonEpisodeCount = count;
    }
  }
  const result = {
    airDate,
    episode: ep ? {
      id: ep?.id || '',
      name: ep?.name || '',
      air_date: airDate,
      airDate,
      season_number: ep?.season_number || ep?.seasonNumber || '',
      seasonNum: ep?.season_number || ep?.seasonNumber || '',
      episode_number: ep?.episode_number || ep?.episodeNumber || '',
      epNum: ep?.episode_number || ep?.episodeNumber || '',
      /* v10.415: total episode count for THIS episode's season — used
         by getMyListNextEpisodeLabel to detect season finales. */
      seasonEpisodeCount: seasonEpisodeCount
    } : null,
    nextSeasonAirDate: nextSeason?.airDate || '',
    nextSeasonNumber: nextSeason?.seasonNumber || 0,
    nextSeasonName: nextSeason?.name || ''
  };
  return result;
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

/* v10.389: read the cached next-season air date the same way we read the
   episode air date — first the canonical field we persist, then any
   alternates we might receive from imports. */
function getMyListNextSeasonAirDate(item = {}) {
  const candidates = [
    item?.nextSeasonAirDate,
    item?.next_season_to_air?.air_date,
    item?.next_season_to_air?.airDate,
    item?.nextSeason?.airDate,
    item?.nextSeason?.air_date
  ];
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value) return value;
  }
  return '';
}

function getMyListNextSeasonNumber(item = {}) {
  const candidates = [
    item?.nextSeasonNumber,
    item?.next_season_to_air?.season_number,
    item?.next_season_to_air?.seasonNumber,
    item?.nextSeason?.seasonNumber,
    item?.nextSeason?.season_number
  ];
  for (const candidate of candidates) {
    const value = Number(candidate || 0);
    if (value >= 1) return value;
  }
  return 0;
}

/* v10.389 / v10.415: extended to recognize both season premieres AND
   season finales.
   Priority on next_episode_to_air whose date is today/future:
     1. If episode_number === 1 AND air_date matches the known next-
        season air date → SEASON PREMIERE → "NEW SEASON OUT" / "New
        season airing M/D"
     2. Else if episode_number === seasonEpisodeCount (TMDB-supplied
        total for that season) → SEASON FINALE → "SEASON FINAL OUT" /
        "Season final airing M/D"
     3. Else regular episode → "NEW EPISODE OUT" / "Next episode airing
        M/D"
   Falls back to season-level data when no upcoming episode is known. */
function getMyListNextEpisodeLabel(item = {}, section = activeSection) {
  if (section !== 'shows' && section !== 'anime') return '';
  const epDate = getMyListNextEpisodeAirDate(item);
  const seasonDate = getMyListNextSeasonAirDate(item);
  const epNumber = Number(item?.next_episode_to_air?.episode_number || item?.next_episode_to_air?.epNum || 0);
  const seasonEpisodeCount = Number(item?.next_episode_to_air?.seasonEpisodeCount || 0);
  const isSeasonPremiereEpisode = epNumber === 1 && !!seasonDate && epDate === seasonDate;
  /* v10.415: treat this as the season final when TMDB has supplied a
     total episode count for the season AND the upcoming episode is the
     last one (epNumber === seasonEpisodeCount). Premiere check fires
     first so a hypothetical single-episode season (ep 1 of 1) still
     reads as a premiere, which is the more useful framing. */
  const isSeasonFinaleEpisode = !isSeasonPremiereEpisode
    && seasonEpisodeCount > 0
    && epNumber > 0
    && epNumber === seasonEpisodeCount;
  if (isScreenListDateTodayOrFuture(epDate)) {
    if (isScreenListDateToday(epDate)) {
      if (isSeasonPremiereEpisode) return 'NEW SEASON OUT';
      if (isSeasonFinaleEpisode) return 'SEASON FINAL OUT';
      return 'NEW EPISODE OUT';
    }
    const labelDate = formatMyListNextEpisodeDate(epDate);
    if (!labelDate) return '';
    if (isSeasonPremiereEpisode) return `New season airing ${labelDate}`;
    if (isSeasonFinaleEpisode) return `Season final airing ${labelDate}`;
    return `Next episode airing ${labelDate}`;
  }
  /* Episode date missing or in the past — fall back to season-level data
     for shows that are between seasons. */
  if (isScreenListDateTodayOrFuture(seasonDate)) {
    if (isScreenListDateToday(seasonDate)) return 'NEW SEASON OUT';
    const labelDate = formatMyListNextEpisodeDate(seasonDate);
    return labelDate ? `New season airing ${labelDate}` : '';
  }
  return '';
}

function renderMyListNextEpisodeHtml(item = {}, section = activeSection) {
  const label = getMyListNextEpisodeLabel(item, section);
  if (!label) return '';
  /* v10.389 / v10.415: glow on every today-state — episode, season
     premiere, and (new in v10.415) season finale. */
  const isNew = label === 'NEW EPISODE OUT'
    || label === 'NEW SEASON OUT'
    || label === 'SEASON FINAL OUT';
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

function isGamesWishlistStatusCard(item = {}, section = activeSection, tab = activeTab) {
  return section === 'games' && tab === 'wishlist' && String(item?.status || '').trim() === 'wishlist';
}

function getScreenListGameReleasePlatforms(item = {}) {
  const candidates = [
    item?.platforms,
    item?.releasePlatforms,
    item?.platformNames
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const names = candidate
        .map(entry => {
          if (typeof entry === 'string') return entry;
          if (entry && typeof entry === 'object') {
            return entry.platform?.name || entry.name || entry.title || '';
          }
          return '';
        })
        .map(value => String(value || '').trim())
        .filter(Boolean);
      if (names.length) return [...new Set(names)].slice(0, 4).join(', ');
    }
    const text = String(candidate || '').trim();
    if (text) return text;
  }
  return '';
}

function renderGamesWishlistMetadataHtml(item = {}, section = activeSection, tab = activeTab) {
  if (!isGamesWishlistStatusCard(item, section, tab)) return '';
  const lines = [];
  const genre = String(item?.genre || '').trim();
  if (genre) lines.push(`<div class="card-genre games-wishlist-card-genre">${escHtml(genre)}</div>`);
  const platforms = getScreenListGameReleasePlatforms(item);
  if (platforms) lines.push(`<div class="card-genre games-wishlist-card-platforms">${escHtml(platforms)}</div>`);
  const releaseDate = getScreenListKnownReleaseDate(item);
  if (releaseDate && typeof isScreenListFutureReleaseDate === 'function' && isScreenListFutureReleaseDate(releaseDate)) {
    const formatted = typeof formatScreenListReleaseDateLabel === 'function'
      ? formatScreenListReleaseDateLabel(releaseDate)
      : releaseDate;
    if (formatted) lines.push(`<div class="card-genre games-wishlist-card-release">${escHtml(formatted)}</div>`);
  }
  return lines.join('');
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

function renderMyListWatchListMetadataInnerHtml(item = {}, section = activeSection, tab = activeTab) {
  if (tab !== 'planned') return '';
  if (!isScreenListMovieTvAnimeSection(section)) return '';
  const lines = [];
  if (!shouldHideMyListCardGenre(section, item) && item.genre) {
    lines.push(`<div class="card-genre">${escHtml(item.genre)}</div>`);
  }
  const availabilityHtml = renderMyListWatchListAvailabilityHtml(item, section);
  if (availabilityHtml) lines.push(availabilityHtml);
  return lines.join('');
}

function renderMyListWatchListMetadataHtml(item = {}, section = activeSection, tab = activeTab) {
  const inner = renderMyListWatchListMetadataInnerHtml(item, section, tab);
  return inner ? `<div class="watchlist-card-metadata">${inner}</div>` : '';
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

  const metadataSlot = document.querySelector(`${cardSelector} .watchlist-card-metadata`);
  if (metadataSlot) {
    const inner = renderMyListWatchListMetadataInnerHtml(item, section, 'planned');
    if (inner) metadataSlot.innerHTML = inner;
    else metadataSlot.remove();
    document.querySelectorAll(`${cardSelector} .mylist-upcoming-release-date`).forEach(el => el.remove());
    return;
  }

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
  if (!item || !metadata) return false;
  let changed = false;
  /* v10.389: episode block is now optional — show may be between seasons
     so the response carries only season info. */
  const airDate = String(metadata.airDate || '').trim();
  if (airDate) {
    const episode = metadata.episode || {};
    const previous = String(item.nextEpisodeAirDate || item.next_episode_to_air?.air_date || '').trim();
    item.nextEpisodeAirDate = airDate;
    item.next_episode_to_air = {
      ...(item.next_episode_to_air || {}),
      ...episode,
      air_date: airDate,
      airDate
    };
    if (previous !== airDate) changed = true;
  }
  /* v10.389: persist next-season premiere info so we can render
     "New season airing M/D" without hitting TMDB again. */
  if (typeof metadata.nextSeasonAirDate === 'string') {
    const nextSeasonDate = String(metadata.nextSeasonAirDate || '').trim();
    const previousSeasonDate = String(item.nextSeasonAirDate || '').trim();
    const previousSeasonNumber = Number(item.nextSeasonNumber || 0);
    const nextSeasonNumber = Number(metadata.nextSeasonNumber || 0);
    if (nextSeasonDate !== previousSeasonDate || nextSeasonNumber !== previousSeasonNumber) changed = true;
    item.nextSeasonAirDate = nextSeasonDate;
    item.nextSeasonNumber = nextSeasonNumber;
    item.nextSeasonName = String(metadata.nextSeasonName || '');
  }
  item.nextEpisodeHydratedAt = new Date().toISOString();
  return changed;
}

function updateMyListNextEpisodeElement(item = {}, section = activeSection) {
  const cardId = String(item?.id || '');
  if (!cardId) return;
  const cardSelector = `#card-${CSS.escape(cardId)}`;
  const card = document.querySelector(cardSelector);
  if (!card) return;
  const existing = card.querySelector('.card-next-episode');
  const html = renderMyListNextEpisodeActionHtml(item, section, activeTab);
  const inlineSlot = card.querySelector('.tv-show-next-episode-slot');
  if (!html) {
    if (existing) existing.remove();
    if (inlineSlot) inlineSlot.classList.remove('has-next-episode');
    return;
  }
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const node = tmp.firstElementChild;
  if (!node) return;
  if (inlineSlot) {
    inlineSlot.innerHTML = '';
    inlineSlot.appendChild(node);
    inlineSlot.classList.add('has-next-episode');
    card.querySelector('.card-action-row')?.classList.remove('has-next-episode');
    return;
  }
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
  /* v10.389: treat either a known future episode date OR a known future
     season premiere as "already hydrated" so between-season shows don't
     re-fetch on every render. */
  const knownEp = getMyListNextEpisodeAirDate(item);
  const knownSeason = getMyListNextSeasonAirDate(item);
  if ((knownEp && isScreenListDateTodayOrFuture(knownEp)) || (knownSeason && isScreenListDateTodayOrFuture(knownSeason))) {
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
      /* v10.389: accept either episode-level OR season-level data. */
      if (metadata && (metadata.airDate || metadata.nextSeasonAirDate)) {
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
    ? `background-image:url('${cardCoverSrc}');background-size:cover;background-position:${activeSection === 'music' ? 'center center' : 'top center'};`
    : "";
  const coverPosterAttr = cardCoverSrc ? `data-poster="${escAttr(cardCoverSrc)}"` : '';
  /* v10.236: tag music covers so CSS can lock them to a 1:1 square aspect
     ratio everywhere — album art is always square, never portrait. */
  const isMusicCard = activeSection === 'music';
  const musicClass = isMusicCard ? ' card-cover-music' : '';
  const coverClass = (cardCoverSrc ? "card-cover" : (isGameCard ? "card-cover no-img screenlist-game-cover-pending" : "card-cover no-img")) + musicClass;
  const emoji = getSectionIcon(activeSection);
  const friendAlreadyAdded = viewingUser && myData ? isDuplicateTitleInList(item.title, activeSection, myData) : false;
  const itemSectionAttr = escAttr(activeSection);
  const itemIdAttr = escAttr(item.id);
  // Stable key for game details panel — falls back to rawgId/slug/title for legacy entries without item.id
  const gameDetailsKey = isGameCard ? escAttr(String(item.id || '') || getScreenListGameStableKey(item)) : itemIdAttr;
  const displayTitle = getDisplayTitleForItem(item, activeSection) || item.title || '';
  if (activeSection === 'anime') {
    queueAnimeTitleVariantHydration(item, activeSection);
    if (typeof queueAnimeCanonicalIdentityHydration === 'function') queueAnimeCanonicalIdentityHydration(item, activeSection);
    queueMissingMalPosterHydration(item, activeSection);
  }
  if (activeSection === 'shows' || activeSection === 'anime') queueMyListNextEpisodeHydration(item, activeSection);
  const canOpenProfile = canOpenLibraryMediaProfile(activeSection);
  const isGamesWishlistCard = isGamesWishlistStatusCard(item, activeSection, activeTab);
  const isCompetitiveGameCard = isGameCard && !isGamesWishlistCard && String(item?.status || '').toLowerCase() === 'competitive';
  const isGamePlayingOrBacklogCard = isGameCard
    && !isGamesWishlistCard
    && !isCompetitiveGameCard
    && (activeTab === 'watching' || activeTab === 'planned');
  /* v10.426: narrower variant — ONLY the Backloggd (planned) variant of
     the previous "Playing OR Backlog" compact card. Used as the action-
     row gate so the playing variants (Single / Live) get their action
     row back (per spec, the action row should appear at the bottom-left
     for Playing single / live / competitive AND Played, matching the
     music + TV layout). Backloggd is intentionally still excluded —
     the user did NOT include it in the request, and its existing
     compact-card treatment stays untouched. `isGamePlayingOrBacklogCard`
     is preserved as-is because it still drives the cover-only compact
     class, the details-panel gate, and the edit-button gate further
     down — those behaviors are independent of the action row. */
  const isGameBackloggdCard = isGameCard
    && !isGamesWishlistCard
    && !isCompetitiveGameCard
    && activeTab === 'planned';
  const shouldTrimGameActivityMetadata = isGameCard
    && !isGamesWishlistCard
    && !isCompetitiveGameCard
    && ['watching', 'planned', 'watched'].includes(String(activeTab || item?.status || '').toLowerCase());
  const isWatchedShowProgressCard = type === "show"
    && String(item?.status || '').trim() === 'watched'
    && (activeSection === 'shows' || activeSection === 'anime');
  const isInlineProgressPercentCard = type === "show"
    && (activeSection === 'shows' || activeSection === 'anime')
    && ['watching', 'paused'].includes(String(item?.status || '').trim());
  /* v10.430: extended from shows-only to shows + anime so anime
     watching/paused cards inherit the same progress-bar + bottom-left
     rating bubble + inline next-episode slot layout that TV shows
     watching/paused uses. Spec was "exactly the layout of the title
     card on TV shows watching" for anime watching / watched / paused
     — for watched the action-row position is handled via the CSS
     selector extension (see `data-library-section="anime"` rules
     below), so this JS variable only needs to mirror the in-progress
     statuses where shows uses it. */
  const shouldShiftTvShowRatingLayout = (activeSection === 'shows' || activeSection === 'anime')
    && ['watching', 'paused'].includes(String(item?.status || '').trim());
  const shouldHideMyListCardOverallRating = (
      activeTab === 'planned' && (activeSection === 'movies' || activeSection === 'shows' || activeSection === 'anime')
    )
    || (activeSection === 'games' && (activeTab === 'planned' || activeTab === 'wishlist'));
  const canOpenTrackerBreakdown = isGameCard
    && !isGamesWishlistCard
    && typeof hasScreenListTrackerBreakdownForItem === 'function'
    && hasScreenListTrackerBreakdownForItem(item);
  /* v10.397: music titles render as a plain span — no per-title click
     handler. Previously the title was a `.media-title-profile-btn` that
     opened the Full Page Media Review (via openLibraryMediaProfile),
     which conflicted with the user's mental model that the music card
     should route to the tracklist page. Title click now naturally
     bubbles up to the card's `handleMyListCardReviewSurfaceClick`,
     which (also in v10.397) opens the album shelf page for music. */
  const gameTitleMarkup = isGameCard
    ? `<button class="card-title-profile-btn game-title-profile-btn" type="button" data-library-item-id="${itemIdAttr}" data-library-section="${itemSectionAttr}" onclick="${isCompetitiveGameCard ? `event.stopPropagation();openMyListGameProfilePage('${itemIdAttr}')` : (canOpenTrackerBreakdown ? `openTrackerStatsPage(event,'${itemIdAttr}')` : `openGameMediaProfileFromLibrary(event,'${itemIdAttr}','${itemSectionAttr}')`)}">${escHtml(displayTitle)}</button>`
    : activeSection === 'music'
      ? `<span>${escHtml(displayTitle)}</span>`
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
  const watchlistPriorityHtml = isGamesWishlistCard ? '' : renderWatchlistPriorityControl(item, activeSection);
  const gamesWishlistPriorityHtml = isGamesWishlistCard
    ? `<div class="games-wishlist-card-priority">${renderWatchlistPriorityControl(item, activeSection)}</div>`
    : '';
  const nextEpisodeActionHtml = renderMyListNextEpisodeActionHtml(item, activeSection, activeTab);
  const nextEpisodeActionRowHtml = shouldShiftTvShowRatingLayout ? '' : nextEpisodeActionHtml;
  const tvShowNextEpisodeInlineHtml = shouldShiftTvShowRatingLayout
    ? `<div class="tv-show-next-episode-slot${nextEpisodeActionHtml ? ' has-next-episode' : ''}">${nextEpisodeActionHtml}</div>`
    : '';
  /* v10.404 / v10.407: rating BUBBLE replaces the legacy 10-stars-laid-
     out widget on title cards in:
       shows   watching / watched / paused
       anime   watching / watched / paused
       music   watching (In Rotation) / watched (Listened)
       movies  watched                                    (added v10.407)
       games   watching / live / competitive / watched    (added v10.407)
     Bubble lives at bottom-LEFT of the card, aligned with the poster.
     Music + planned stays on the inline widget. Games + planned/wishlist
     stay on their existing widget (no rating shown there per the
     existing shouldHideMyListCardOverallRating gating). */
  const isMusicSection = activeSection === 'music';
  const itemStatus = String(item?.status || '').trim();
  /* v10.530: rating bubble now appears on every active/engaged status
     across all categories, not just the original narrow per-section
     lists. Movies previously only got the bubble on 'watched' — the
     'paused' status was missing, producing the legacy inline rating
     widget on paused movie cards (the issue the user reported).
     Same expansion applied to music ('paused') and games ('paused')
     for consistency — any state where the user has actually engaged
     with the title gets the bubble. The remaining excluded states
     (planned / wishlist / dropped per-category gating below) still
     fall through to the inline widget OR hide the rating entirely
     via `shouldHideMyListCardOverallRating`. */
  const useRatingBubble = !shouldHideMyListCardOverallRating && (
    ((activeSection === 'shows' || activeSection === 'anime') && ['watching', 'watched', 'paused'].includes(itemStatus))
    || (isMusicSection && ['watching', 'watched', 'paused'].includes(itemStatus))
    || (activeSection === 'movies' && ['watched', 'paused'].includes(itemStatus))
    || (activeSection === 'games' && ['watching', 'live', 'competitive', 'watched', 'paused'].includes(itemStatus))
  );
  const overallRatingHtml = shouldHideMyListCardOverallRating
    ? ''
    : (useRatingBubble
        ? buildRatingBubbleMarkup(item, activeSection)
        : `<div class="rating-area">
            <div class="rating-label">Rating</div>
            ${renderMyListCardOverallRating(item, activeSection)}
          </div>`);
  /* v10.393: music cards put the rating at the BOTTOM-LEFT of the card,
     aligned with the album-cover left edge — mirrors the Musicboard
     layout. v10.404: same bottom-left slot pattern now extended to
     bubble-using cards across shows/anime/music+listed-statuses. */
  const inlineOverallRatingHtml = (shouldShiftTvShowRatingLayout || isMusicSection || useRatingBubble) ? '' : overallRatingHtml;
  const bottomLeftOverallRatingHtml = useRatingBubble
    ? `<div class="rating-bubble-bottom-left-slot">${overallRatingHtml}</div>`
    : (shouldShiftTvShowRatingLayout
        ? `<div class="tv-show-bottom-rating-slot">${overallRatingHtml}</div>`
        : (isMusicSection
            ? `<div class="music-bottom-rating-slot">${overallRatingHtml}</div>`
            : ''));
  const showCommentButton = !shouldHideMyListCommentButton(activeSection, item);
  const gamesWishlistMetadataHtml = renderGamesWishlistMetadataHtml(item, activeSection, activeTab);

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
      <button type="button" class="ep-toggle-bar card-footer-btn" onclick="event.stopPropagation();openMyListEpisodePage('${item.id}')">
        <span id="ep-label-${item.id}">Episodes</span>
        <span class="ep-arrow" id="ep-arrow-${item.id}">&#8250;</span>
      </button>
    `;
  }

  // Inline game stats for card display
  const _igs = isGameCard ? getScreenListGameDetailValuesFromItem(item) : null;
  const gameStatHours = _igs ? (_igs.hours ? _igs.hours + 'h' : '—') : '';
  const gameStatPlatform = _igs ? (_igs.platform || '—') : '';
  const gameStatTracker = _igs ? _igs.tracker : '';
  const competitiveStatsHtml = isGameCard && !isGamesWishlistCard && typeof renderScreenListCompetitiveStatsCardHtml === 'function'
    ? renderScreenListCompetitiveStatsCardHtml(item)
    : '';
  /* v10.434: SIMPLIFIED to Hours played only — Platform and
     Tracker/Stats rows removed UNIVERSALLY for every game title
     card (single / live / competitive / played / backloggd; wishlist
     uses its own metadata renderer). Spec was "for all title cards,
     remove platform from the title cards. It should only read the
     title, the status button, the hours played, and then the action
     row." So one stat row remains: Hours played. v10.433's
     competitive-only Hours-row suppression is REVERTED — competitive
     now shows Hours like every other game status. The dedicated
     competitive stats card (`competitiveStatsHtml`) still renders
     separately below for competitive-specific data (rating, peak
     rank, etc.), so context is preserved. */
  const gameStatsHtml = isGameCard && !isGamesWishlistCard ? `<div class="game-card-stats-inline">
    <div class="game-card-stat-row"><span class="game-card-stat-label">Hours played:</span><span class="game-card-stat-val">${escHtml(gameStatHours)}</span></div>
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
  /* v10.488: Movies → Watchlist card layout overhaul. Per user spec:
     1. Drop the year metadata entirely on movies-watchlist cards.
     2. Hoist the status button up to sit directly beneath the title
        (it previously rendered AFTER year + genre + watchlist meta).
     Implemented as a conditional gate + a single statusPillsHtml string
     placed in one of two slots so the status pill's element id stays
     unique (rendering it in both slots would duplicate the id). */
  const isMoviesWatchlistCard = activeSection === 'movies' && activeTab === 'planned';
  /* v10.734: hoist the status pill UP to sit directly beneath the media
     title (with 8px line spacing) on the completed-status tabs for every
     section that the user uses for "I finished this" tracking — Movies →
     Watched, TV/Anime → Watched, Games → Played, Music → Listened. All
     of these use status === 'watched' under the hood (single enum across
     sections), so activeTab === 'watched' is the gate. Color override
     for these pills lives in 01-mylists-cards-episodes.css under the
     `.status-pills--under-title` modifier class added to the wrapper
     below. The existing movies-watchlist gate (planned tab) is preserved
     verbatim. */
  const isCompletedTabHoist = activeTab === 'watched' && (
    isScreenListMovieTvAnimeSection(activeSection)
    || activeSection === 'games'
    || activeSection === 'music'
  );
  const showStatusUnderTitle = isMoviesWatchlistCard || isCompletedTabHoist;
  const statusPillsWrapClass = `status-pills status-pills-selector-wrap${showStatusUnderTitle ? ' status-pills--under-title' : ''}`;
  const statusPillsHtml = !viewingUser ? `<div class="${statusPillsWrapClass}" id="status-pills-${item.id}">${statusSelectorHtml}</div>` : '';
  return `
    <div class="card ${type === "show" ? "show-card" : ""}${isGameCard ? " game-library-card" : ""}${isGamesWishlistCard ? " games-wishlist-card" : ""}${isCompetitiveGameCard ? " game-competitive-card" : ""}${isGamePlayingOrBacklogCard ? " game-playing-backlog-compact-card" : ""}${shouldShiftTvShowRatingLayout ? " tv-show-progress-rating-shift-card" : ""}${useRatingBubble ? " card-uses-rating-bubble" : ""}${isMoviesWatchlistCard ? " movies-watchlist-card" : ""} ${viewingUser ? "friend-view-card" : ""}${isDraggable ? ' card-draggable' : ''}" id="card-${item.id}" data-mylist-review-card data-library-item-id="${itemIdAttr}" data-library-section="${itemSectionAttr}" onclick="handleMyListCardReviewSurfaceClick(event,'${itemIdAttr}','${itemSectionAttr}')" ${dragAttrs}>
      <div class="card-header">
        <div class="${coverClass}${coverProfileClass}" style="${coverStyle}" ${coverPosterAttr} ${coverProfileAttrs}${activeSection === 'music' ? ` onclick="event.stopPropagation();openMyListMusicCoverClick('${itemIdAttr}')"` : ''}>
          ${!cardCoverSrc ? (isGameCard ? `<span>${SCREENLIST_GAME_COVER_PLACEHOLDER_TEXT}</span>` : emoji) : ''}
        </div>
        <div class="card-info${isGamesWishlistCard ? ' games-wishlist-card-info' : ''}">
          <div class="card-title-row">
            <div class="card-title">${gameTitleMarkup}</div>
            ${!viewingUser ? `<button class="delete-btn" onclick="deleteItem(event,'${item.id}')" title="Delete">×</button>` : (currentUser ? `<button class="friend-card-add-btn${friendAlreadyAdded ? ' added' : ''}" data-friend-item-id="${escHtml(item.id)}" onclick="event.stopPropagation();openFriendAddModal(this.dataset.friendItemId, this)" title="Add to my list">+</button>` : '')}
          </div>
          ${showStatusUnderTitle ? statusPillsHtml : ''}
          ${gameStatsHtml}
          ${competitiveStatsHtml}
          ${(((activeTab === 'planned' && isScreenListMovieTvAnimeSection(activeSection) && !isMoviesWatchlistCard)
              /* v10.76: Movies → Watched also shows year between title and genre.
                 v10.77: extended to ALL watched movie/TV/anime cards so the
                 metadata order (title → year → genre → status → rating → comment)
                 is uniform across Movies, TV Shows, and Anime when watched.
                 Games and Movies Watchlist/Paused are still untouched.
                 Same .card-year .mylist-watchlist-year class — its CSS is
                 generic styling (font-size/color/weight), not watchlist-specific.
                 Applies on viewed-user lists too — same renderer, read-only by
                 way of the existing viewingUser-gated chrome elsewhere.
                 v10.231: also show year for music album cards.
                 v10.488: movies-watchlist cards now skip the year per
                 user spec (excluded via `!isMoviesWatchlistCard`). */
              || (activeTab === 'watched' && isScreenListMovieTvAnimeSection(activeSection))
              || activeSection === 'music')
              && item.year) ? `<div class="card-year mylist-watchlist-year">${escHtml(String(item.year).slice(0, 4))}</div>` : ''}
          ${(activeSection === 'music' && item.artist) ? `<div class="card-artist">${escHtml(String(item.artist))}</div>` : ''}
          ${/* v10.434: genre suppressed for ALL game title cards per
                spec ("only read the title, the status button, the
                hours played, and then the action row" — genre not in
                the list). Added `!isGameCard` to the show-genre gate.
                The earlier `shouldTrimGameActivityMetadata` +
                `isCompetitiveGameCard` gates are now redundant for
                games but kept in place because they're cheap and
                document the prior intent. Movies / TV / anime / music
                / books still show genre under their normal rules. */ ''}${activeTab === 'planned' && isScreenListMovieTvAnimeSection(activeSection) ? '' : (!isGameCard && !shouldTrimGameActivityMetadata && !isCompetitiveGameCard && !isGamesWishlistCard && (!shouldHideMyListCardGenre(activeSection, item) && item.genre) ? `<div class="card-genre">${escHtml(isScreenListWatchedMediaCard(activeSection, item) ? formatMyListGenreList(item.genre, 2) : item.genre)}</div>` : '')}
          ${gamesWishlistMetadataHtml}
          ${renderMyListWatchListMetadataHtml(item, activeSection, activeTab)}
          ${!showStatusUnderTitle ? statusPillsHtml : ''}
          ${type === "show" ? (item.status === 'planned' ? `
            <div class="progress-area">
              <div class="progress-meta"><span id="progress-count-${item.id}">${totalEps > 0 ? `${totalEps} episodes` : 'Episodes TBD'}</span></div>
            </div>
          ` : isWatchedShowProgressCard ? `
            <div class="progress-area">
              <div class="progress-meta"><span id="progress-count-${item.id}">${watchedCount}/${totalEps} episodes</span><span id="progress-percent-${item.id}">${Math.round(progress)}%</span></div>
            </div>
          ` : isInlineProgressPercentCard ? `
            <div class="progress-area">
              <div class="progress-meta"><span id="progress-count-${item.id}">${watchedCount}/${totalEps} episodes</span></div>
              <div class="progress-bar-row">
                <div class="progress-bar"><div class="progress-fill" id="progress-fill-${item.id}" style="width:${progress}%"></div></div>
                <span class="progress-percent-inline" id="progress-percent-${item.id}"${totalEps > 0 ? '' : ' hidden'}>${totalEps > 0 ? `${Math.round(progress)}%` : ''}</span>
              </div>
            </div>
          ` : `
            <div class="progress-area">
              <div class="progress-meta"><span id="progress-count-${item.id}">${watchedCount}/${totalEps} episodes</span><span id="progress-percent-${item.id}">${Math.round(progress)}%</span></div>
              <div class="progress-bar"><div class="progress-fill" id="progress-fill-${item.id}" style="width:${progress}%"></div></div>
            </div>
          `) : ''}
          ${tvShowNextEpisodeInlineHtml}
          ${inlineOverallRatingHtml}
          <!-- v10.69: stable slot wrapper around the card comment so partial
               updates from saveCardCommentFromComposer / deleteCardComment can
               swap just this region's innerHTML instead of triggering a full
               grid re-render. Empty inner is fine — no comment = no children. -->
          <div class="card-comment-slot" id="card-comment-slot-${item.id}">${buildCardCommentBodyHtml(item)}</div>
          ${gamesWishlistPriorityHtml}
        </div>
      </div>
      ${!isGameBackloggdCard ? `<div class="card-action-row${bottomExternalBadgeHtml ? ' has-bottom-export' : ''}${watchlistPriorityHtml ? ' has-watch-priority' : ''}${nextEpisodeActionRowHtml ? ' has-next-episode' : ''}">
        ${bottomLeftOverallRatingHtml}
        ${nextEpisodeActionRowHtml}
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
          ${activeSection === 'music' ? `<button class="card-tracklist-btn" type="button" onclick="event.stopPropagation();openMyListAlbumPage('${itemIdAttr}')" aria-label="Open album details">Details</button>` : ''}
          ${buildCardCommentAddBtnHtml(item)}
        </div>
      </div>` : ''}
      ${gameCommentDropHtml}
      ${isGameCard && !isGamesWishlistCard && !isCompetitiveGameCard && !isGamePlayingOrBacklogCard ? renderGameDetailsPanel(item) : ''}
      ${item.shelfdActivityNote ? `<div class="card-activity-note" data-card-activity-note>${escHtml(item.shelfdActivityNote)}</div>` : ''}
      ${episodeSection}
      ${isCompetitiveGameCard ? `<button class="game-card-more-btn" type="button" onclick="event.stopPropagation();openMyListGameProfilePage('${itemIdAttr}')" aria-label="Open game profile">More</button>` : ''}
      ${/* v10.429: pencil edit-button removed per spec. The legacy
            affordance routed through `openGameDetailsEdit()` to expand
            an inline editor on the card, but the surface is going away
            entirely — no icon rendered, and the handler simply won't
            be reachable from MyList anymore. The function definition
            is intentionally left in place (unused) so other code paths
            (e.g. the game profile page) that might still call it don't
            ReferenceError; cleaning it up is a separate sweep. */ ''}
    </div>
  `;
}

function isMyListReviewExcludedTarget(target = null) {
  if (!target?.closest) return false;
  return !!target.closest([
    'button',
    'a',
    'input',
    'select',
    'textarea',
    'label',
    '[contenteditable="true"]',
    '[role="button"]',
    '.card-cover',
    '.card-cover-profile-btn',
    '.rating-area',
    '.stars',
    '.status-pills',
    '.game-status-selector',
    '.game-details-panel',
    '.game-card-comment-drop',
    '.ep-toggle-bar',
    '.ep-list',
    '.comments-btn',
    '.card-comment-add-btn',
    '.card-comment-body--owner',
    '.watch-together-card-control',
    '.watch-together-card-btn',
    '.mylist-card-bottom-export',
    '.watchlist-priority-slot',
    '.tracker-card-strip',
    '.game-card-edit-btn'
  ].join(','));
}

function isMyListGameProfileExcludedTarget(target = null) {
  if (!target?.closest) return false;
  return !!target.closest([
    'button',
    'a',
    'input',
    'select',
    'textarea',
    'label',
    '[contenteditable="true"]',
    '[role="button"]',
    '.card-cover-profile-btn',
    '.rating-area',
    '.stars',
    '.status-pills',
    '.game-status-selector',
    '.game-details-panel',
    '.game-card-comment-drop',
    '.ep-toggle-bar',
    '.ep-list',
    '.comments-btn',
    '.card-comment-add-btn',
    '.card-comment-body--owner',
    '.watch-together-card-control',
    '.watch-together-card-btn',
    '.mylist-card-bottom-export',
    '.watchlist-priority-slot',
    '.tracker-card-strip',
    '.game-card-edit-btn',
    '.game-card-more-btn'
  ].join(','));
}

/* v10.250 / v10.397: tapping the album COVER on a my-list music card
   used to open the Deezer-hydrated Album Profile (a separate full-page
   slide-in). Per v10.397 spec the entire music card — cover, title,
   blank space — now routes to ONE destination: the album shelf page
   (My List Full Page Album Details, opened via openMyListAlbumPage).
   That page already shows the same hero hydration the Deezer profile
   provided plus the editable tracklist + per-track rating widget. */
window.openMyListMusicCoverClick = function(itemId) {
  try {
    if (typeof openMyListAlbumPage === 'function') openMyListAlbumPage(itemId);
  } catch (e) { console.warn('openMyListMusicCoverClick failed:', e); }
};

function handleMyListCardReviewSurfaceClick(event = null, itemId = '', section = activeSection) {
  if (!event) return;
  const cleanSection = String(section || activeSection || '').trim();
  if (cleanSection === 'games' && !isMyListGameProfileExcludedTarget(event.target)) {
    const { item } = findMyListGameProfileItem(itemId);
    if (isMyListCompetitiveGameItem(item)) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openMyListGameProfilePage(itemId);
      return;
    }
  }
  /* v10.397: music card surface routes to the album shelf page (My List
     Full Page Album Details) instead of the Full Page Media Review.
     Tapping the cover, the title text, or the blank space all converge
     here, mirroring the dedicated `Tracklist` button on the action row.
     The action-row buttons (Tracklist, Comments, +) still
     stopPropagation themselves, so their dedicated behaviors win. */
  if (cleanSection === 'music' && !isMyListReviewExcludedTarget(event.target)) {
    event.preventDefault?.();
    event.stopPropagation?.();
    if (typeof openMyListAlbumPage === 'function') openMyListAlbumPage(itemId);
    return;
  }
  if (isMyListReviewExcludedTarget(event.target)) return;
  event.preventDefault?.();
  event.stopPropagation?.();
  openFullPageMediaReview(itemId, section);
}
window.handleMyListCardReviewSurfaceClick = handleMyListCardReviewSurfaceClick;

function findMyListReviewItem(itemId = '', section = activeSection) {
  const cleanId = String(itemId || '').trim();
  const cleanSection = String(section || activeSection || '').trim();
  const source = typeof getVisibleListData === 'function' ? getVisibleListData() : data;
  const list = Array.isArray(source?.[cleanSection]) ? source[cleanSection] : [];
  const item = list.find(row => String(row?.id || '') === cleanId);
  return item ? { item, section: cleanSection } : null;
}

function getMyListReviewFallbackAvatar(name = 'Shelfd User') {
  return 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name || 'Shelfd User') + '&background=1c1535&color=a78bfa';
}

function getMyListReviewAuthor() {
  const profile = viewingUser
    ? { ...(usersMap?.[viewingUser.uid || ''] || {}), ...viewingUser }
    : ((typeof getActiveProfile === 'function' ? getActiveProfile() : null) || userProfile || {});
  const name = profile?.name || profile?.customName || currentUser?.displayName || 'Shelfd User';
  const photo = profile?.photo || profile?.customPhoto || currentUser?.photoURL || getMyListReviewFallbackAvatar(name);
  return { name, photo };
}

function getMyListReviewActionVerb(section = activeSection, item = {}) {
  if (section === 'games') return 'Played';
  if (section === 'music') return 'Listened';
  if (section === 'manga' || section === 'books') return 'Read';
  return 'Watched';
}

function formatMyListReviewDate(value = '') {
  const ms = Date.parse(value || '');
  if (!Number.isFinite(ms) || ms <= 0) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(ms));
  } catch (e) {
    return new Date(ms).toLocaleDateString();
  }
}

function getMyListReviewDateLine(item = {}, section = activeSection) {
  const dateValue = item.dateWatched || item.watchedAt || item.completedAt || item.finishedAt || item.dateModified || item.lastEditedAt || item.dateAdded || item.createdAt || '';
  const formatted = formatMyListReviewDate(dateValue);
  if (!formatted) return `${getMyListReviewActionVerb(section, item)} date not set`;
  return `${getMyListReviewActionVerb(section, item)} ${formatted}`;
}

function getMyListReviewShareText() {
  const overlay = document.getElementById('mylist-media-review-page');
  const title = overlay?.dataset?.reviewTitle || 'Shelfd review';
  const dateLine = overlay?.dataset?.reviewDate || '';
  return [title, dateLine].filter(Boolean).join(' - ');
}

function buildMyListMediaReviewShareUrl(postId = '', section = '') {
  const cleanPostId = String(postId || '').trim();
  if (!cleanPostId) return window.location.href;
  const shareOrigin = window.SHELFD_SHARE_ORIGIN || 'https://myshelfd.com';
  const url = new URL(`/review/${encodeURIComponent(cleanPostId)}`, shareOrigin);
  const cleanSection = String(section || '').trim();
  if (cleanSection) url.searchParams.set('section', cleanSection);
  return url.toString();
}

async function getMyListMediaReviewSharePostId() {
  const overlay = document.getElementById('mylist-media-review-page');
  if (!overlay) return '';
  let postId = String(overlay.dataset.reviewActivityId || '').trim();
  if (postId) return postId;
  if (overlay.dataset.reviewIsOwner === 'true' && typeof resolveMyListMediaReviewReplyTarget === 'function') {
    try {
      const target = await resolveMyListMediaReviewReplyTarget({ createLinkedIfOwner: true });
      postId = String(overlay.dataset.reviewActivityId || target?.cardId || target?.id || '').trim();
      if (postId && !/^activity-interaction-/i.test(postId)) return postId;
    } catch (_) {}
  }
  return '';
}

async function shareMyListMediaReview(event = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const text = getMyListReviewShareText();
  const overlay = document.getElementById('mylist-media-review-page');
  const postId = await getMyListMediaReviewSharePostId();
  const shareUrl = buildMyListMediaReviewShareUrl(postId, overlay?.dataset?.reviewSection || '');
  try {
    if (navigator.share) {
      await navigator.share({ title: text || 'Shelfd review', text, url: shareUrl });
      return;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(`${text}${text ? '\n' : ''}${shareUrl}`);
      if (typeof showToast === 'function') showToast('Review link copied');
    }
  } catch (_) {}
}
window.shareMyListMediaReview = shareMyListMediaReview;

function getMyListReviewText(item = {}) {
  return String(
    item?.reviewText ||
    item?.review ||
    item?.essay ||
    item?.notes ||
    item?.cardComment?.text ||
    ''
  ).trim();
}

/* v10.247: tracklist dropdown for music album reviews. Lives directly under
   the star rating on the FPReview hero. Shows `#` · title · per-track rating
   (when the user rated that track in the my-list album shelf page). Closed
   by default — tap the row to expand. */
function renderMyListReviewTracklistToggle(item = {}) {
  const tracks = Array.isArray(item.tracks) ? item.tracks : [];
  if (tracks.length === 0) return '';
  const favs = Array.isArray(item.trackFavorites) ? item.trackFavorites : [];
  /* v10.253: backward compat — legacy trackRatings > 0 still counts as a
     favorite so users don't lose pre-existing data.
     v10.330: prefer the stable trackFavoritesByKey map written by the
     album shelf page (27-music-album-shelf-page.js). Falls back to the
     legacy array+ratings shapes so older Firestore docs still render. */
  const legacyRatings = Array.isArray(item.trackRatings) ? item.trackRatings : [];
  const byKey = item && typeof item.trackFavoritesByKey === 'object' && item.trackFavoritesByKey !== null
    ? item.trackFavoritesByKey
    : null;
  const stableKey = (track, idx) => {
    if (!track || typeof track !== 'object') return `idx:${idx}`;
    const dzId = String(track.deezerId || track.id || '').trim();
    if (dzId) return `dz:${dzId}`;
    const num = String(track.number || (idx + 1)).trim();
    const ttl = String(track.title || '').trim().toLowerCase();
    if (ttl) return `t:${num}::${ttl}`;
    return `idx:${idx}`;
  };
  const isFav = (idx) => {
    if (byKey) {
      const key = stableKey(tracks[idx], idx);
      if (byKey[key] === true) return true;
      if (byKey[key] === false) return false;
    }
    if (favs[idx] === true) return true;
    if (favs[idx] === false) return false;
    return Number(legacyRatings[idx] || 0) > 0;
  };
  const rows = tracks.map((t, idx) => {
    const num = String(t.number || idx + 1);
    const titleStr = String(t.title || 'Untitled');
    return `
      <li class="mylist-review-tracklist-row">
        <span class="mylist-review-tracklist-num">${escHtml(num)}</span>
        <span class="mylist-review-tracklist-title">${escHtml(titleStr)}</span>
        ${isFav(idx) ? `<span class="mylist-review-tracklist-fav" aria-label="Favorite track">&#9733;</span>` : ''}
      </li>
    `;
  }).join('');
  return `
    <div class="mylist-review-tracklist">
      <button type="button" class="mylist-review-tracklist-toggle" data-tracklist-toggle aria-expanded="false">
        <span>Track list</span>
        <svg class="mylist-review-tracklist-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <ol class="mylist-review-tracklist-list" data-tracklist-list aria-hidden="true">${rows}</ol>
    </div>
  `;
}

function renderMyListReviewRating(item = {}, section = activeSection) {
  const rating = Number(item?.rating || 0);
  if (!rating) return '<div class="mylist-review-rating-empty">No rating yet</div>';
  /* v10.516: full-page review now appends the "/5" suffix to the
     numeric label to match the app-wide 5-star half-step display
     (e.g. "3/5", "3.5/5"). Pulls the numeric value via the standard
     `formatRatingValueForSection` (which already divides the stored
     1–10 by 2 in five-point mode) and appends the suffix here. */
  const numericLabel = typeof formatRatingValueForSection === 'function'
    ? formatRatingValueForSection(rating, section)
    : String(rating / 2);
  const label = `${numericLabel}/5`;
  const stepCount = typeof getRatingStepCountForSection === 'function' ? getRatingStepCountForSection(section) : 10;
  const visualRating = stepCount === 5 ? rating / 2 : rating;
  const filledCount = Math.max(1, Math.min(stepCount, Math.floor(visualRating)));
  const stars = Array.from({ length: filledCount }, () => '<span class="mylist-review-filled-star" aria-hidden="true">&#9733;</span>').join('');
  return `<div class="mylist-review-rating" aria-label="Rated ${escAttr(label)}"><span class="mylist-review-filled-stars">${stars}</span><span class="mylist-review-rating-label">${escHtml(label)}</span></div>`;
}

function openMyListMediaReviewActions(event = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const overlay = document.getElementById('mylist-media-review-page');
  if (!overlay) return;
  if (overlay.dataset.reviewIsOwner !== 'true') return;
  overlay.classList.add('actions-open');
}
window.openMyListMediaReviewActions = openMyListMediaReviewActions;

/* v10.550: Non-owner review top-right — three-dot opens a small sheet
   with "Share review" and "Report review". Reads ownerUid + authorName
   from the overlay dataset so no extra params needed in the onclick. */
function openMyListMediaReviewViewerActions(event = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const overlay = document.getElementById('mylist-media-review-page');
  if (!overlay || overlay.dataset.reviewIsOwner === 'true') return;
  const ownerUid   = overlay.dataset.reviewOwnerUid   || '';
  const itemId     = overlay.dataset.reviewItemId     || '';
  const authorName = overlay.dataset.reviewAuthorName || '';
  const reportLabel = authorName ? `${authorName}'s review` : 'this review';

  if (document.getElementById('mylist-review-viewer-menu')) return;
  const menu = document.createElement('div');
  menu.id = 'mylist-review-viewer-menu';
  menu.className = 'mylist-media-review-viewer-menu';
  menu.innerHTML = `
    <button type="button" data-viewer-menu-share>Share review</button>
    <button type="button" class="is-report" data-viewer-menu-report>Report review</button>
  `;
  const btn = event?.currentTarget || event?.target;
  if (btn) btn.parentNode.appendChild(menu);
  else overlay.querySelector('.mylist-media-review-topbar')?.appendChild(menu);

  menu.querySelector('[data-viewer-menu-share]').addEventListener('click', e => {
    e.stopPropagation();
    menu.remove();
    shareMyListMediaReview(null);
  });
  menu.querySelector('[data-viewer-menu-report]').addEventListener('click', e => {
    e.stopPropagation();
    menu.remove();
    if (typeof window.openReportSheet === 'function') {
      window.openReportSheet('review', ownerUid, itemId, reportLabel);
    }
  });
  /* Dismiss on outside tap */
  setTimeout(() => {
    function onOutside(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', onOutside, true);
        document.removeEventListener('touchstart', onOutside, true);
      }
    }
    document.addEventListener('click', onOutside, true);
    document.addEventListener('touchstart', onOutside, true);
  }, 0);
}
window.openMyListMediaReviewViewerActions = openMyListMediaReviewViewerActions;

function closeMyListMediaReviewActions(event = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const overlay = document.getElementById('mylist-media-review-page');
  if (overlay) overlay.classList.remove('actions-open');
}
window.closeMyListMediaReviewActions = closeMyListMediaReviewActions;

async function handleMyListMediaReviewAction(action = '', event = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const cleanAction = String(action || '').trim().toLowerCase();
  const overlay = document.getElementById('mylist-media-review-page');
  if (overlay?.dataset?.reviewIsOwner !== 'true' && cleanAction !== 'share' && cleanAction !== 'done') return;
  if (cleanAction === 'done') {
    closeMyListMediaReviewActions(event);
    return;
  }
  if (cleanAction === 'share') {
    await shareMyListMediaReview(event);
    closeMyListMediaReviewActions(event);
    return;
  }
  /* v10.220 / v10.242: Edit → re-open the log composer for the same item so
     the owner can update rating / review / tags / etc. Passes the original
     section to openShelfLogComposer so it works even when the user wandered
     into the FPReview from somewhere outside that section. */
  if (cleanAction === 'edit') {
    closeMyListMediaReviewActions(event);
    const itemId = overlay?.dataset?.reviewItemId || '';
    const section = overlay?.dataset?.reviewSection || '';
    closeFullPageMediaReview();
    setTimeout(() => {
      try {
        if (typeof openShelfLogComposer === 'function' && itemId) {
          openShelfLogComposer(itemId, section);
        }
      } catch (_) {}
    }, 320);
    return;
  }
  closeMyListMediaReviewActions(event);
  if (typeof showToast === 'function') showToast(cleanAction === 'delete' ? 'Delete review coming soon' : 'Action coming soon');
}
window.handleMyListMediaReviewAction = handleMyListMediaReviewAction;

function getMyListReviewInlineReplyAuthor() {
  const profile = (typeof usersMap === 'object' && currentUser?.uid && usersMap[currentUser.uid]) || userProfile || currentUser || {};
  const name = profile?.name || profile?.customName || currentUser?.displayName || currentUser?.email || 'User';
  const photo = profile?.photo || profile?.customPhoto || currentUser?.photoURL || '';
  return { name, photo };
}

function getMyListReviewReplyStableId(reply = {}, index = 0) {
  return String(reply.id || reply.replyId || `reply-${reply.uid || 'user'}-${reply.timestamp || index}-${index}`).trim();
}

function getMyListReviewReplyParentId(reply = {}) {
  return String(reply.parentReplyId || reply.parentCommentId || reply.replyToId || '').trim();
}

function formatMyListReviewReplyTime(value = 0) {
  if (typeof relativeTime === 'function') return relativeTime(value);
  const ms = Number(value || 0);
  if (!ms) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(ms));
  } catch (_) { return ''; }
}

function renderMyListMediaReviewReplies(replies = []) {
  const normalized = [...(Array.isArray(replies) ? replies : [])]
    .sort((a, b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0))
    .map((reply, index) => ({ ...reply, id: getMyListReviewReplyStableId(reply, index) }));
  if (!normalized.length) return '<div class="mylist-media-review-replies-empty">No replies yet.</div>';
  const byId = new Map(normalized.map(reply => [String(reply.id || ''), reply]));
  const childrenByParent = new Map();
  const roots = [];
  normalized.forEach(reply => {
    const parentId = getMyListReviewReplyParentId(reply);
    if (parentId && parentId !== reply.id && byId.has(parentId)) {
      if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
      childrenByParent.get(parentId).push(reply);
    } else {
      roots.push(reply);
    }
  });
  const renderReplyNode = (reply, depth = 0, isLast = false) => {
    const profile = (typeof usersMap === 'object' && usersMap?.[reply.uid]) || {};
    const name = profile?.name || profile?.customName || reply.name || 'User';
    const photo = profile?.photo || profile?.customPhoto || reply.photo || '';
    const fallback = getMyListReviewFallbackAvatar(name);
    const time = formatMyListReviewReplyTime(reply.timestamp);
    const childReplies = childrenByParent.get(reply.id) || [];
    const depthValue = Math.min(3, Math.max(0, Number(depth || 0)));
    return `
      <article class="mylist-media-review-reply-item${depthValue ? ' is-child-reply' : ''}" data-review-reply-id="${escAttr(reply.id)}" style="--review-reply-depth:${depthValue}">
        <div class="mylist-media-review-reply-avatar">
          <img src="${escAttr(photo || fallback)}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${escAttr(fallback)}'">
          ${!isLast || childReplies.length ? '<span class="mylist-media-review-reply-line" aria-hidden="true"></span>' : ''}
        </div>
        <div class="mylist-media-review-reply-bubble">
          <div class="mylist-media-review-reply-meta">
            <strong>${renderDisplayNameHTML(profile.uid ? profile : { name }, name, '')}</strong>
            ${time ? `<span>${escHtml(time)}</span>` : ''}
          </div>
          <div class="mylist-media-review-reply-text">${escHtml(reply.text || '')}</div>
          <button class="mylist-media-review-reply-inline" type="button" onclick="openMyListMediaReviewReply(event,'${escAttr(reply.id)}','${escAttr(name)}')">Reply</button>
          ${childReplies.length ? `<div class="mylist-media-review-reply-children">${childReplies.map((child, childIndex) => renderReplyNode(child, depthValue + 1, childIndex === childReplies.length - 1)).join('')}</div>` : ''}
        </div>
      </article>
    `;
  };
  return roots.map((reply, index) => renderReplyNode(reply, 0, index === roots.length - 1)).join('');
}

function getMyListReviewFallbackInteractionDocId(overlay = document.getElementById('mylist-media-review-page')) {
  const ownerUid = String(overlay?.dataset?.reviewOwnerUid || '').trim();
  const section = String(overlay?.dataset?.reviewSection || '').trim();
  const itemId = String(overlay?.dataset?.reviewItemId || '').trim();
  const raw = [ownerUid, section, itemId].filter(Boolean).join('|') || String(overlay?.dataset?.reviewTitle || 'review');
  const hash = typeof screenlistStableHash === 'function'
    ? screenlistStableHash(raw)
    : raw.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 80);
  const stableId = `review-${hash}`;
  return typeof getActivityInteractionMetaDocId === 'function'
    ? getActivityInteractionMetaDocId(stableId)
    : `activity-interaction-${stableId}`;
}

function getMyListReviewTargetItem(overlay = document.getElementById('mylist-media-review-page')) {
  const section = String(overlay?.dataset?.reviewSection || '').trim();
  const itemId = String(overlay?.dataset?.reviewItemId || '').trim();
  if (!section || !itemId) return null;
  const record = findMyListReviewItem(itemId, section);
  return record?.item || null;
}

async function resolveMyListMediaReviewReplyTarget(options = {}) {
  const overlay = document.getElementById('mylist-media-review-page');
  if (!overlay || typeof db === 'undefined') return null;
  const existingDocId = String(overlay.dataset.reviewReplyDocId || '').trim();
  const existingCollection = String(overlay.dataset.reviewReplyCollection || '').trim();
  if (existingDocId && existingCollection) {
    const shouldTryOwnerFeedPost = options.createLinkedIfOwner
      && overlay.dataset.reviewIsOwner === 'true'
      && !String(overlay.dataset.reviewActivityId || '').trim()
      && existingCollection === 'meta';
    if (!shouldTryOwnerFeedPost) {
      return {
        id: existingDocId,
        collection: existingCollection,
        ref: db.collection(existingCollection).doc(existingDocId),
        cardId: overlay.dataset.reviewActivityId || overlay.dataset.reviewInteractionId || existingDocId,
        activity: {
          id: overlay.dataset.reviewActivityId || overlay.dataset.reviewInteractionId || existingDocId,
          uid: overlay.dataset.reviewOwnerUid || '',
          replies: []
        }
      };
    }
    delete overlay.dataset.reviewReplyDocId;
    delete overlay.dataset.reviewReplyCollection;
    delete overlay.dataset.reviewInteractionId;
  }

  let activityId = String(overlay.dataset.reviewActivityId || '').trim();
  if (!activityId && options.createLinkedIfOwner && overlay.dataset.reviewIsOwner === 'true') {
    const item = getMyListReviewTargetItem(overlay);
    if (item && getMyListReviewText(item) && typeof createLinkedMediaReviewFeedPost === 'function') {
      try {
        activityId = await createLinkedMediaReviewFeedPost(item, overlay.dataset.reviewSection || '');
        if (activityId) {
          item.reviewActivityId = activityId;
          overlay.dataset.reviewActivityId = activityId;
          try { save(); } catch (_) {}
        }
      } catch (_) {}
    }
  }
  if (activityId && typeof resolveActivityInteractionTarget === 'function') {
    const target = await resolveActivityInteractionTarget(activityId);
    if (target?.ref) {
      overlay.dataset.reviewReplyDocId = target.interactionDocId || target.id;
      overlay.dataset.reviewReplyCollection = target.collection || 'feed';
      overlay.dataset.reviewInteractionId = target.cardId || target.id || activityId;
      return target;
    }
  }

  const fallbackId = getMyListReviewFallbackInteractionDocId(overlay);
  overlay.dataset.reviewReplyDocId = fallbackId;
  overlay.dataset.reviewReplyCollection = 'meta';
  overlay.dataset.reviewInteractionId = fallbackId;
  return {
    id: fallbackId,
    collection: 'meta',
    ref: db.collection('meta').doc(fallbackId),
    cardId: fallbackId,
    activity: {
      id: fallbackId,
      uid: overlay.dataset.reviewOwnerUid || '',
      type: 'media-review',
      replies: []
    }
  };
}

async function loadMyListMediaReviewReplies() {
  const overlay = document.getElementById('mylist-media-review-page');
  const list = overlay?.querySelector('[data-review-replies-list]');
  if (!overlay || !list) return;
  list.innerHTML = '<div class="mylist-media-review-replies-empty">Loading replies...</div>';
  try {
    const target = await resolveMyListMediaReviewReplyTarget({ createLinkedIfOwner: false });
    if (!target?.ref) {
      list.innerHTML = '<div class="mylist-media-review-replies-empty">No replies yet.</div>';
      return;
    }
    const snap = await target.ref.get();
    if (!snap.exists
        && target.collection === 'meta'
        && overlay.dataset.reviewIsOwner === 'true'
        && !String(overlay.dataset.reviewActivityId || '').trim()) {
      delete overlay.dataset.reviewReplyDocId;
      delete overlay.dataset.reviewReplyCollection;
      delete overlay.dataset.reviewInteractionId;
    }
    const data = snap.exists ? (snap.data() || {}) : {};
    const replies = Array.isArray(data.replies) ? data.replies : [];
    list.innerHTML = renderMyListMediaReviewReplies(replies);
    const countEl = overlay.querySelector('[data-review-reply-count]');
    if (countEl) countEl.textContent = replies.length ? String(replies.length) : '';
    updateActivityReplyCountBadge(target.cardId || target.id, replies.length);
  } catch (error) {
    console.warn('Review inline replies failed to load:', error);
    list.innerHTML = '<div class="mylist-media-review-replies-empty">Could not load replies.</div>';
  }
}

function closeMyListMediaReviewReplyComposer(event = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const overlay = document.getElementById('mylist-media-review-page');
  const composer = overlay?.querySelector('[data-review-reply-composer]');
  const input = overlay?.querySelector('[data-review-reply-input]');
  const btn = overlay?.querySelector('[data-review-reply-post]');
  const context = overlay?.querySelector('[data-review-reply-context]');
  if (input) {
    input.value = '';
    input.style.height = '';
    input.placeholder = 'Write a reply...';
  }
  if (btn) btn.disabled = true;
  if (context) {
    context.hidden = true;
    const name = context.querySelector('[data-review-reply-context-name]');
    if (name) name.textContent = '';
  }
  if (composer) {
    delete composer.dataset.parentReplyId;
    delete composer.dataset.parentReplyName;
    composer.hidden = true;
    const home = overlay?.querySelector('[data-review-reply-composer-home]');
    if (home) home.appendChild(composer);
  }
  overlay?.classList.remove('reply-composer-open');
}
window.closeMyListMediaReviewReplyComposer = closeMyListMediaReviewReplyComposer;

async function submitMyListMediaReviewReply(event = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return false;
  const overlay = document.getElementById('mylist-media-review-page');
  const input = overlay?.querySelector('[data-review-reply-input]');
  const btn = overlay?.querySelector('[data-review-reply-post]');
  const composer = overlay?.querySelector('[data-review-reply-composer]');
  if (!overlay || !input || !btn || !currentUser) return false;
  const text = String(input.value || '').trim();
  if (!text) return false;
  btn.disabled = true;
  btn.textContent = 'Posting...';
  try {
    const replyId = crypto.randomUUID ? crypto.randomUUID() : `reply-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const author = getMyListReviewInlineReplyAuthor();
    const parentReplyId = String(composer?.dataset?.parentReplyId || '').trim();
    const parentReplyName = String(composer?.dataset?.parentReplyName || '').trim();
    const reply = {
      id: replyId,
      uid: currentUser.uid,
      name: author.name,
      photo: author.photo,
      text,
      timestamp: Date.now()
    };
    if (parentReplyId) {
      reply.parentReplyId = parentReplyId;
      if (parentReplyName) reply.parentReplyName = parentReplyName;
    }
    const target = await resolveMyListMediaReviewReplyTarget({ createLinkedIfOwner: true });
    if (!target?.ref) throw new Error('No review reply target');
    await target.ref.set({ replies: firebase.firestore.FieldValue.arrayUnion(reply) }, { merge: true });
    const snap = await target.ref.get();
    const latest = snap.exists ? (snap.data() || {}) : {};
    const replies = Array.isArray(latest.replies) ? latest.replies : [reply];
    const activity = {
      ...(target.activity || {}),
      ...latest,
      id: target.cardId || target.id,
      activityId: target.cardId || target.id,
      originalActivityId: target.cardId || target.id,
      interactionDocId: target.id,
      uid: overlay.dataset.reviewOwnerUid || target.activity?.uid || '',
      replies,
      _collection: target.collection
    };
    const list = overlay.querySelector('[data-review-replies-list]');
    if (list) list.innerHTML = renderMyListMediaReviewReplies(replies);
    const countEl = overlay.querySelector('[data-review-reply-count]');
    if (countEl) countEl.textContent = replies.length ? String(replies.length) : '';
    updateActivityReplyCountBadge(target.cardId || target.id, replies.length);
    if (typeof refreshVisibleActivityInteractionCards === 'function') {
      refreshVisibleActivityInteractionCards(target.cardId || target.id, activity);
    }
    const rawMemory = typeof friendActivityClickTargets !== 'undefined' ? friendActivityClickTargets[target.cardId || target.id] : null;
    if (rawMemory) rawMemory.replies = replies;
    const recipientUid = String(overlay.dataset.reviewOwnerUid || target.activity?.uid || '').trim();
    if (typeof createActivityNotification === 'function' && recipientUid && recipientUid !== currentUser.uid) {
      await createActivityNotification({
        recipientUid,
        type: 'activity_comment',
        targetActivityId: target.cardId || target.id,
        targetKind: target.collection === 'feed' ? 'feed' : 'activity',
        targetCollection: target.collection,
        targetCommentId: replyId,
        parentCommentId: parentReplyId || '',
        activity,
        textSnippet: text
      });
    }
    input.value = '';
    input.style.height = '';
    input.placeholder = 'Write a reply...';
    btn.textContent = 'Post';
    btn.disabled = true;
    const context = overlay.querySelector('[data-review-reply-context]');
    if (context) context.hidden = true;
    if (composer) {
      delete composer.dataset.parentReplyId;
      delete composer.dataset.parentReplyName;
    }
    const home = overlay.querySelector('[data-review-reply-composer-home]');
    if (composer && home) home.appendChild(composer);
    composer?.setAttribute('hidden', '');
    overlay.classList.remove('reply-composer-open');
    return false;
  } catch (error) {
    console.error('Review inline reply failed:', error);
    btn.disabled = false;
    btn.textContent = 'Post';
    if (typeof showToast === 'function') showToast('Could not post reply');
    return false;
  }
}
window.submitMyListMediaReviewReply = submitMyListMediaReviewReply;

function attachMyListMediaReviewReplyComposer(overlay) {
  const input = overlay?.querySelector('[data-review-reply-input]');
  const btn = overlay?.querySelector('[data-review-reply-post]');
  if (!input || !btn) return;
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    btn.disabled = !String(input.value || '').trim();
  });
  input.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submitMyListMediaReviewReply(event);
  });
}

function openMyListMediaReviewReply(event = null, parentReplyId = '', parentReplyName = '') {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const overlay = document.getElementById('mylist-media-review-page');
  const composer = overlay?.querySelector('[data-review-reply-composer]');
  const input = overlay?.querySelector('[data-review-reply-input]');
  if (!composer || !input) return;
  const cleanParentId = String(parentReplyId || '').trim();
  const cleanParentName = String(parentReplyName || '').trim();
  const context = composer.querySelector('[data-review-reply-context]');
  if (cleanParentId) {
    composer.dataset.parentReplyId = cleanParentId;
    composer.dataset.parentReplyName = cleanParentName;
    input.placeholder = cleanParentName ? `Reply to ${cleanParentName}...` : 'Write a reply...';
    if (context) {
      const name = context.querySelector('[data-review-reply-context-name]');
      if (name) name.textContent = cleanParentName || 'comment';
      context.hidden = false;
    }
    const parentArticle = overlay?.querySelector(`[data-review-reply-id="${CSS.escape(cleanParentId)}"]`);
    const bubble = parentArticle?.querySelector(':scope > .mylist-media-review-reply-bubble');
    if (bubble) bubble.appendChild(composer);
  } else {
    delete composer.dataset.parentReplyId;
    delete composer.dataset.parentReplyName;
    input.placeholder = 'Write a reply...';
    if (context) context.hidden = true;
    const home = overlay?.querySelector('[data-review-reply-composer-home]');
    if (home) home.appendChild(composer);
  }
  composer.hidden = false;
  overlay.classList.add('reply-composer-open');
  window.requestAnimationFrame(() => {
    try { composer.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
    setTimeout(() => {
      try { input.focus({ preventScroll: true }); } catch (_) { try { input.focus(); } catch (e) {} }
    }, 80);
  });
}
window.openMyListMediaReviewReply = openMyListMediaReviewReply;

/* v10.225: build a stand-in record from any activity in
   window.friendActivityClickTargets (the activity-feed click lookup). Used as
   the 3rd-tier fallback for completion / watched / played cards so the FPReview
   can render even when there's no media-review feed post and no local item. */
function synthesizeMediaReviewRecordFromActivity(needle = '', section = '') {
  const wanted = String(needle || '').trim();
  if (!wanted) return null;
  /* v10.239: resolve the click-targets map live. The bare module reference
     in 10-activity-feed.js was being reassigned on every render, leaving
     window.friendActivityClickTargets stale. Try the live bare ref first. */
  let targets = null;
  try {
    // eslint-disable-next-line no-new-func
    targets = new Function('try { return typeof friendActivityClickTargets !== "undefined" ? friendActivityClickTargets : null; } catch (_) { return null; }')();
  } catch (_) {}
  if (!targets || typeof targets !== 'object') {
    targets = (typeof window !== 'undefined' && window.friendActivityClickTargets) || {};
  }
  let activity = targets[wanted] || null;
  if (!activity) {
    // Allow lookup by item.id when caller passed an item id rather than the
    // activity id (covers the owner-with-no-local-record edge case).
    for (const key of Object.keys(targets)) {
      const a = targets[key];
      if (a && a.item && a.item.id === wanted) { activity = a; break; }
    }
  }
  if (!activity) return null;
  const item = activity.item || {};
  const itemSection = item.librarySection || item.mediaCategory || section || '';
  /* v10.443: convert activity.timestamp / activity.activityCreatedAt to
     an ISO date so the FPReview date line shows the real activity
     date. Same multi-shape handler as the feed-post version above. */
  const dateIso = (function resolveTimestamp() {
    const t = activity.timestamp || activity.activityCreatedAt || activity.createdAt || activity.eventDate;
    if (!t) return '';
    try {
      if (typeof t === 'object' && typeof t.toDate === 'function') return t.toDate().toISOString();
      if (typeof t === 'number' && Number.isFinite(t)) return new Date(t).toISOString();
      if (typeof t === 'string') {
        const ms = Date.parse(t);
        if (Number.isFinite(ms)) return new Date(ms).toISOString();
      }
    } catch (_) {}
    return '';
  })();
  const synthItem = {
    id: item.id || '',
    title: item.title || '',
    cover: item.cover || '',
    year: item.year || '',
    rating: Number(item.rating || activity.rating || activity.activityRating || 0),
    librarySection: itemSection,
    mediaCategory: itemSection,
    reviewText: '',
    reviewActivityId: activity.postId || activity.activityId || '',
    /* v10.443: pre-populate the date fields the FPReview reader scans
       so non-friend viewers see "Watched / Listened / Played {date}"
       instead of "date not set" when they open the review from a
       feed click. */
    dateWatched: dateIso,
    watchedAt: dateIso,
    completedAt: dateIso,
    dateAdded: dateIso,
    createdAt: dateIso
  };
  const profile = (typeof window !== 'undefined' && window.usersMap && window.usersMap[activity.uid]) || {};
  /* v10.443: expanded fallback chain — checks the activity-baked
     name/photo (always saved when the activity card was created)
     before settling on the generic "Shelfd User" string. */
  const fallbackName = profile?.name
    || profile?.customName
    || profile?.displayName
    || activity.name
    || activity.displayName
    || activity.authorName
    || 'Shelfd User';
  const author = {
    name: fallbackName,
    photo: profile?.photo
      || profile?.customPhoto
      || profile?.photoURL
      || activity.photo
      || activity.authorPhoto
      || activity.photoURL
      || getMyListReviewFallbackAvatar(fallbackName)
  };
  /* v10.443: if usersMap missed this author, fire a one-shot
     background fetch + DOM patch so the FPReview swaps to the real
     profile data once it lands. Same helper as the feed-synth path. */
  if (activity.uid && (!window.usersMap || !window.usersMap[activity.uid])) {
    setTimeout(() => fetchAndPatchMyListReviewAuthor(activity.uid), 0);
  }
  return {
    item: synthItem,
    section: itemSection,
    author,
    posterOverride: synthItem.cover || '',
    reviewTextOverride: '',
    reviewActivityId: synthItem.reviewActivityId || '',
    ownerUid: activity.uid || ''
  };
}

/* v10.220: build a stand-in record from a media-review feed post when the
   live item isn't in the viewer's local data (e.g., the viewer clicked the
   review activity card from the feed and hasn't loaded that friend's list).
   v10.443: cascaded MORE fallback paths for author + date + review-text so
   non-friends / cold-cache viewers see the real post creator instead of
   "Shelfd User". Was: only checked usersMap. Now: usersMap → post.name /
   post.displayName / post.photo (baked into the post at create time on
   some surfaces) → existing fallback. ALSO: derive a watched/listened
   date from `post.timestamp` so the FPReview date line ("Watched Mar 12,
   2024") populates instead of "Watched date not set". Plus a tiny
   trampoline that async-fetches the author's profile from Firestore
   when nothing local matches, then patches the DOM after the page is
   already open so the avatar + name swap in. */
function synthesizeMediaReviewRecordFromFeed(needle = '', section = '') {
  const wanted = String(needle || '').trim();
  if (!wanted) return null;
  const posts = Array.isArray(window.feedPosts) ? window.feedPosts : [];
  // Match by postId first (activity-card click path), then by mediaItemId,
  // then by sourceItemId.
  let post = posts.find(p => p?.postId === wanted && (p?.type === 'media-review' || p?.eventType === 'review'));
  if (!post) post = posts.find(p => p?.type === 'media-review' && (p?.item?.id === wanted || p?.reviewSourceItemId === wanted));
  if (!post) return null;
  const postItem = post.item || {};
  /* v10.443: convert post.timestamp into an ISO date string the existing
     `getMyListReviewDateLine` reader can parse. Handles three shapes:
     Firestore Timestamp (`.toDate()` available), ms-number, ISO string. */
  const dateIso = (function resolveTimestamp() {
    const t = post.timestamp;
    if (!t) return '';
    try {
      if (typeof t === 'object' && typeof t.toDate === 'function') return t.toDate().toISOString();
      if (typeof t === 'number' && Number.isFinite(t)) return new Date(t).toISOString();
      if (typeof t === 'string') {
        const ms = Date.parse(t);
        if (Number.isFinite(ms)) return new Date(ms).toISOString();
      }
    } catch (_) {}
    return '';
  })();
  const item = {
    id: postItem.id || post.reviewSourceItemId || '',
    title: postItem.title || '',
    cover: postItem.cover || '',
    year: postItem.year || '',
    rating: postItem.rating || 0,
    librarySection: postItem.librarySection || section || '',
    mediaCategory: postItem.mediaCategory || section || '',
    reviewText: post.reviewText || post.content?.text || post.content?.body || '',
    reviewActivityId: post.postId || '',
    /* v10.443: populate every date field the reader scans so the
       FPReview's "Watched / Listened / Played {date}" line resolves
       to the post's actual creation date. */
    dateWatched: dateIso,
    watchedAt: dateIso,
    completedAt: dateIso,
    dateAdded: dateIso,
    createdAt: dateIso
  };
  const author = (() => {
    const profile = (window.usersMap && window.usersMap[post.uid]) || {};
    /* v10.443: post-level author info (name/displayName/photo baked
       into the feed doc at write time) is now in the fallback chain
       AHEAD of the generic "Shelfd User" string. */
    const name = profile?.name
      || profile?.customName
      || profile?.displayName
      || post.name
      || post.displayName
      || post.authorName
      || 'Shelfd User';
    const photo = profile?.photo
      || profile?.customPhoto
      || profile?.photoURL
      || post.photo
      || post.authorPhoto
      || post.photoURL
      || getMyListReviewFallbackAvatar(name);
    return { name, photo };
  })();
  /* v10.443: if usersMap had no entry for this author, fire a one-shot
     Firestore fetch in the background and patch the open FPReview
     overlay's avatar + name when it lands. Tolerates a missing db /
     non-Firestore environment via the typeof guards. */
  if (post.uid && (!window.usersMap || !window.usersMap[post.uid])) {
    setTimeout(() => fetchAndPatchMyListReviewAuthor(post.uid), 0);
  }
  return {
    item,
    section: item.librarySection || section || '',
    author,
    posterOverride: item.cover || '',
    reviewTextOverride: item.reviewText || '',
    reviewActivityId: post.postId || '',
    ownerUid: post.uid || ''
  };
}

/* v10.443: one-shot async profile fetch + DOM patch for the FPReview.
   Used when synthesizeMediaReviewRecordFromFeed / FromActivity opens
   the review before usersMap has loaded the author's profile. Fetches
   `users/{uid}`, caches into usersMap, then if the FPReview overlay is
   still open AND still showing the same author, swaps in the real
   name + photo. Silent on any error — the fallback "Shelfd User"
   stays visible if the fetch fails. */
async function fetchAndPatchMyListReviewAuthor(uid) {
  if (!uid || typeof db === 'undefined') return;
  try {
    const snap = await db.collection('users').doc(uid).get();
    if (!snap || !snap.exists) return;
    const profile = { uid, ...(snap.data() || {}) };
    if (!window.usersMap) window.usersMap = {};
    window.usersMap[uid] = { ...(window.usersMap[uid] || {}), ...profile };
    const overlay = document.getElementById('mylist-media-review-page');
    if (!overlay) return;
    if (String(overlay.dataset.reviewOwnerUid || '') !== String(uid)) return;
    const nameEl = overlay.querySelector('.mylist-media-review-author strong');
    const avatarEl = overlay.querySelector('.mylist-media-review-author .mylist-media-review-avatar');
    const resolvedName = profile?.name || profile?.customName || profile?.displayName || '';
    const resolvedPhoto = profile?.photo || profile?.customPhoto || profile?.photoURL || '';
    if (nameEl && resolvedName) nameEl.textContent = resolvedName;
    if (avatarEl && resolvedPhoto) avatarEl.src = resolvedPhoto;
  } catch (_) { /* non-fatal */ }
}
window.fetchAndPatchMyListReviewAuthor = fetchAndPatchMyListReviewAuthor;

/* v10.444: async backstop for review-text. Used when the friend's
   local item has no `reviewText` field set (sync path returned
   empty) but the item carries a `reviewActivityId` pointer. Reads
   `feed/{reviewActivityId}` directly from Firestore — the feed-post
   doc is the authoritative source for the review body — and if a
   non-empty text comes back, injects a `<p>` into the open FPReview
   body. Silent on any failure (permissions, missing doc, network)
   so the empty body just stays as-is. */
async function fetchAndPatchMyListReviewText(activityId) {
  if (!activityId || typeof db === 'undefined') return;
  try {
    const snap = await db.collection('feed').doc(activityId).get();
    if (!snap || !snap.exists) return;
    const post = snap.data() || {};
    const text = String(
      post.reviewText
      || post.content?.text
      || post.content?.body
      || ''
    ).trim();
    if (!text) return;
    const overlay = document.getElementById('mylist-media-review-page');
    if (!overlay) return;
    /* Only patch if the body is still empty — don't overwrite
       something the user might have edited or that synced in
       between the fetch and the response. */
    const body = overlay.querySelector('.mylist-media-review-body');
    if (!body) return;
    let p = body.querySelector('p');
    if (p && String(p.textContent || '').trim()) return; // already filled
    if (!p) {
      p = document.createElement('p');
      body.insertBefore(p, body.firstChild);
    }
    p.textContent = text;
  } catch (_) { /* non-fatal — permissions, missing doc, offline */ }
}
window.fetchAndPatchMyListReviewText = fetchAndPatchMyListReviewText;

function openFullPageMediaReview(itemId = '', section = activeSection) {
  let record = findMyListReviewItem(itemId, section);
  // v10.220: fallback for viewers / activity-feed callers — synthesize a record
  // from a matching media-review feed post when the item isn't in local data.
  if (!record) {
    record = synthesizeMediaReviewRecordFromFeed(itemId, section);
  }
  // v10.225: 3rd fallback for completion cards (watched / played / finished
  // watching) that don't have an associated media-review post — synthesize
  // from the activity in friendActivityClickTargets so non-owners can still
  // jump to the FPReview from the feed.
  if (!record) {
    record = synthesizeMediaReviewRecordFromActivity(itemId, section);
  }
  if (!record) return;
  closeFullPageMediaReview(true);
  const { item } = record;
  const author = record.author || getMyListReviewAuthor();
  const title = (typeof getDisplayTitleForItem === 'function' ? getDisplayTitleForItem(item, record.section) : '') || item.title || 'Untitled';
  const poster = record.posterOverride || (typeof getMyListPosterUrlForItem === 'function' ? getMyListPosterUrlForItem(item, record.section) : (item.cover || ''));
  const fallbackAvatar = getMyListReviewFallbackAvatar(author.name);
  /* v10.444: when the FPReview opens on a record sourced via
     `findMyListReviewItem` (e.g., the viewer is browsing a friend's
     list and tapped a card with `viewingUser` set), the friend's
     item may not carry a `reviewText` field even though they
     actually wrote one — the review body in the feed-post doc is
     the authoritative source on that surface. If the local item
     has no review text, fall through to the feed-post lookup using
     the item id as the needle. `synthesizeMediaReviewRecordFromFeed`
     already knows how to read `post.reviewText || post.content?.text`
     and reuses the same matching rules; we just pull the
     `reviewTextOverride` field off its return record. */
  let reviewText = record.reviewTextOverride || getMyListReviewText(item);
  if (!reviewText && item.id) {
    try {
      const feedRec = synthesizeMediaReviewRecordFromFeed(item.id, record.section);
      if (feedRec && feedRec.reviewTextOverride) {
        reviewText = feedRec.reviewTextOverride;
      }
    } catch (_) { /* non-fatal */ }
  }
  /* v10.444: if STILL no review text after the sync-feed lookup AND the
     item carries a `reviewActivityId` pointer to a feed post, fire a
     one-shot Firestore read against `feed/{reviewActivityId}` after the
     page renders. When the post lands, patch a fresh `<p>` into
     `.mylist-media-review-body`. This handles the common case where
     `window.feedPosts` hasn't loaded the friend's posts yet (e.g.,
     the viewer browsed straight to the friend's list without ever
     scrolling the activity feed). */
  const pendingReviewActivityId = (!reviewText)
    ? String(record.reviewActivityId || item.reviewActivityId || '').trim()
    : '';
  const dateLine = getMyListReviewDateLine(item, record.section);
  const reviewActivityId = record.reviewActivityId || item.reviewActivityId || '';
  const ownerUid = String(record.ownerUid || (viewingUser ? viewingUser.uid : currentUser?.uid) || '').trim();
  const isOwnerReview = !!(currentUser?.uid && ownerUid && String(currentUser.uid) === ownerUid);
  const topRightActionHtml = isOwnerReview
    ? `<button class="mylist-media-review-menu" type="button" onclick="openMyListMediaReviewActions(event)" aria-label="Review options">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
        </button>`
    : `<button class="mylist-media-review-menu" type="button" onclick="openMyListMediaReviewViewerActions(event)" aria-label="More options">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
        </button>`;
  const overlay = document.createElement('div');
  overlay.id = 'mylist-media-review-page';
  overlay.className = 'mylist-media-review-page' + (record.section === 'music' ? ' is-music-review' : '') + (isOwnerReview ? ' is-owner-review' : ' is-viewed-user-review');
  overlay.dataset.reviewTitle = title;
  overlay.dataset.reviewDate = dateLine;
  overlay.dataset.reviewItemId = item.id || '';
  overlay.dataset.reviewSection = record.section || '';
  overlay.dataset.reviewOwnerUid = ownerUid;
  overlay.dataset.reviewIsOwner = isOwnerReview ? 'true' : 'false';
  overlay.dataset.reviewAuthorName = author.name || '';
  if (reviewActivityId) overlay.dataset.reviewActivityId = reviewActivityId;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `${title} review`);
  overlay.innerHTML = `
    <div class="mylist-media-review-shell">
      <header class="mylist-media-review-topbar">
        <button class="mylist-media-review-back" type="button" onclick="closeFullPageMediaReview()" aria-label="Back">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>
        </button>
        <span>Review</span>
        ${topRightActionHtml}
      </header>
      <main class="mylist-media-review-content">
        <section class="mylist-media-review-hero">
          <div class="mylist-media-review-main">
            <div class="mylist-media-review-author">
              <img class="mylist-media-review-avatar" src="${escAttr(author.photo)}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${escAttr(fallbackAvatar)}'">
              <div>
                <strong>${escHtml(author.name)}</strong>
                <span>${escHtml(dateLine)}</span>
              </div>
            </div>
            <h1>${escHtml(title)}</h1>
            ${(record.section === 'music' && item.artist) ? `<div class="mylist-media-review-artist">${escHtml(String(item.artist))}</div>` : ''}
            ${item.year ? `<div class="mylist-media-review-year">${escHtml(String(item.year).slice(0, 4))}</div>` : ''}
            ${renderMyListReviewRating(item, record.section)}
            ${record.section === 'music' ? renderMyListReviewTracklistToggle(item) : ''}
          </div>
          <div class="mylist-media-review-poster${poster ? '' : ' no-img'}" ${poster ? `style="background-image:url('${escAttr(poster)}')"` : ''}>${poster ? '' : escHtml(getSectionIcon(record.section))}</div>
        </section>
        <section class="mylist-media-review-body">
          ${reviewText ? `<p>${escHtml(reviewText)}</p>` : ''}
          <button class="mylist-media-review-reply" type="button" onclick="openMyListMediaReviewReply(event)">Reply</button>
          <section class="mylist-media-review-replies" aria-label="Replies">
            <div data-review-reply-composer-home>
              <form class="mylist-media-review-reply-composer" data-review-reply-composer hidden onsubmit="return submitMyListMediaReviewReply(event)">
                <div class="mylist-media-review-reply-context" data-review-reply-context hidden>
                  <span>Replying to <strong data-review-reply-context-name></strong></span>
                  <button type="button" onclick="closeMyListMediaReviewReplyComposer(event)" aria-label="Cancel specific reply">&times;</button>
                </div>
                <textarea class="mylist-media-review-reply-input" data-review-reply-input rows="1" maxlength="600" placeholder="Write a reply..."></textarea>
                <div class="mylist-media-review-reply-actions">
                  <button class="mylist-media-review-reply-cancel" type="button" onclick="closeMyListMediaReviewReplyComposer(event)">Cancel</button>
                  <button class="mylist-media-review-reply-post" type="submit" data-review-reply-post disabled>Post</button>
                </div>
              </form>
            </div>
            <div class="mylist-media-review-replies-head"><span>Replies</span><span data-review-reply-count></span></div>
            <div class="mylist-media-review-replies-list" data-review-replies-list></div>
          </section>
        </section>
      </main>
    </div>
    ${isOwnerReview ? `<button class="mylist-media-review-action-backdrop" type="button" onclick="closeMyListMediaReviewActions(event)" aria-label="Close review options"></button>
    <section class="mylist-media-review-action-sheet" role="dialog" aria-modal="true" aria-label="Review options">
      <div class="mylist-media-review-action-meta">
        <strong>${escHtml(title)}</strong>
        <span>${escHtml(dateLine)}</span>
      </div>
      <div class="mylist-media-review-action-list">
        <button class="mylist-media-review-action danger" type="button" onclick="handleMyListMediaReviewAction('delete',event)">Delete</button>
        <button class="mylist-media-review-action" type="button" onclick="handleMyListMediaReviewAction('edit',event)">Edit</button>
        <button class="mylist-media-review-action" type="button" onclick="handleMyListMediaReviewAction('share',event)">Share</button>
        <button class="mylist-media-review-action done" type="button" onclick="handleMyListMediaReviewAction('done',event)">Done</button>
      </div>
    </section>` : ''}
  `;
  document.body.appendChild(overlay);
  document.body.classList.add('mylist-media-review-open');
  document.addEventListener('keydown', handleFullPageMediaReviewKeydown);
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  attachMyListMediaReviewReplyComposer(overlay);
  loadMyListMediaReviewReplies();
  /* v10.444: async backstop — if the synchronous review-text lookup
     came up empty and the item still has a reviewActivityId pointer,
     fetch the feed post directly from Firestore and patch the body. */
  if (pendingReviewActivityId) {
    setTimeout(() => fetchAndPatchMyListReviewText(pendingReviewActivityId), 0);
  }

  /* v10.247: wire the tracklist dropdown for music albums. */
  try {
    const toggleBtn = overlay.querySelector('[data-tracklist-toggle]');
    const listEl = overlay.querySelector('[data-tracklist-list]');
    if (toggleBtn && listEl) {
      toggleBtn.addEventListener('click', () => {
        const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
        const next = !expanded;
        toggleBtn.setAttribute('aria-expanded', next ? 'true' : 'false');
        listEl.setAttribute('aria-hidden', next ? 'false' : 'true');
        toggleBtn.classList.toggle('is-open', next);
        listEl.classList.toggle('is-open', next);
      });
    }
  } catch (_) {}
}
window.openFullPageMediaReview = openFullPageMediaReview;

let screenListSharedMediaReviewRouteActive = false;
let screenListMediaReviewRouteOpening = false;

async function loadSharedMediaReviewPost(postId = '') {
  const cleanPostId = String(postId || '').trim();
  if (!cleanPostId) return null;
  if (Array.isArray(window.feedPosts)) {
    const cached = window.feedPosts.find(post => String(post?.postId || post?.id || '') === cleanPostId);
    if (cached) return cached;
  }
  if (typeof db === 'undefined' || !db?.collection) return null;
  try {
    const snap = await db.collection('feed').doc(cleanPostId).get();
    if (!snap?.exists) return null;
    const data = snap.data() || {};
    const post = { ...data, postId: data.postId || cleanPostId, id: data.id || cleanPostId };
    if (!Array.isArray(window.feedPosts)) window.feedPosts = [];
    const existingIndex = window.feedPosts.findIndex(item => String(item?.postId || item?.id || '') === cleanPostId);
    if (existingIndex >= 0) window.feedPosts[existingIndex] = { ...window.feedPosts[existingIndex], ...post };
    else window.feedPosts.unshift(post);
    return post;
  } catch (error) {
    console.warn('[review-route] shared review fetch failed:', error);
    return null;
  }
}

async function openSharedMediaReviewRoute(route = (typeof parseScreenListReviewRoute === 'function' ? parseScreenListReviewRoute() : null)) {
  const postId = String(route?.postId || '').trim();
  if (!postId || screenListMediaReviewRouteOpening) return false;
  screenListMediaReviewRouteOpening = true;
  screenListSharedMediaReviewRouteActive = false;
  if (typeof prepareSharedMediaRouteView === 'function') prepareSharedMediaRouteView();
  try {
    await loadSharedMediaReviewPost(postId);
    openFullPageMediaReview(postId, route?.section || '');
    const opened = !!document.getElementById('mylist-media-review-page');
    if (!opened) throw new Error('Shared review could not be opened');
    screenListSharedMediaReviewRouteActive = true;
    return true;
  } catch (error) {
    console.warn('[review-route] open failed:', error);
    if (typeof showToast === 'function') showToast('Could not open review');
    if (!currentUser && typeof showLandingPage === 'function') showLandingPage();
    return false;
  } finally {
    screenListMediaReviewRouteOpening = false;
  }
}
window.openSharedMediaReviewRoute = openSharedMediaReviewRoute;

function finishSharedMediaReviewRouteAfterClose() {
  if (!screenListSharedMediaReviewRouteActive) return;
  screenListSharedMediaReviewRouteActive = false;
  if (window.location.pathname.startsWith('/review/') || window.location.hash.startsWith('#review/')) {
    try { history.replaceState(null, '', window.location.origin + '/'); } catch (_) {}
  }
  if (!currentUser && typeof showLandingPage === 'function') showLandingPage();
}
window.finishSharedMediaReviewRouteAfterClose = finishSharedMediaReviewRouteAfterClose;

function closeFullPageMediaReview(immediate = false) {
  const overlay = document.getElementById('mylist-media-review-page');
  if (!overlay) return;
  document.removeEventListener('keydown', handleFullPageMediaReviewKeydown);
  document.body.classList.remove('mylist-media-review-open');
  if (immediate === true) {
    overlay.remove();
    return;
  }
  overlay.classList.remove('is-open');
  setTimeout(() => {
    overlay.remove();
    finishSharedMediaReviewRouteAfterClose();
  }, 320);
}
window.closeFullPageMediaReview = closeFullPageMediaReview;

function handleFullPageMediaReviewKeydown(event) {
  if (event?.key !== 'Escape') return;
  const overlay = document.getElementById('mylist-media-review-page');
  if (overlay?.classList.contains('actions-open')) {
    closeMyListMediaReviewActions(event);
    return;
  }
  closeFullPageMediaReview();
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

/* v10.69: builds the inner contents of `.ep-list-inner` — the Mark All / Clear
   All / Edit episode count action row plus the actual episode/season tree.
   Extracted out of renderCard so the same string can be (a) inlined at render
   time for cards whose dropdown is already open, and (b) injected lazily by
   `toggleEpisodes()` on first open for cards that started closed. The shape
   exactly matches the previous inline template — no behavior change. */
function buildEpisodeListInnerHtml(item) {
  if (!item) return '';
  const escapedId = String(item.id);
  const actionsHtml = !viewingUser
    ? `<div class="ep-actions">
        <div style="display:flex;gap:8px;">
          <button type="button" class="btn-secondary btn-sm" data-mylist-action="mark-all-eps" data-mylist-item-id="${escapedId}" data-mylist-mark-value="true" onclick="markAllEps('${escapedId}',true)">Mark All Watched</button>
          <button type="button" class="btn-secondary btn-sm" data-mylist-action="mark-all-eps" data-mylist-item-id="${escapedId}" data-mylist-mark-value="false" onclick="markAllEps('${escapedId}',false)">Clear All</button>
        </div>
        <div class="edit-ep-row" id="edit-ep-${escapedId}">
          <button type="button" class="edit-ep-link" onclick="showEditEp('${escapedId}')">Edit episode count</button>
        </div>
      </div>`
    : '';
  return `${actionsHtml}<div class="ep-scroll">${renderEpisodeList(item)}</div>`;
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

function renderSingleEp(itemId, ep, section = activeSection) {
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
        ★${r ? ' ' + formatRatingValueForSection(r, section) : ''}
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
      ★${r ? ' ' + formatRatingValueForSection(r, section) : ''}
    </button>
  </div>`;
}

const MYLIST_EPISODE_PAGE_OPEN_TRANSITION_MS = 450;
const MYLIST_EPISODE_PAGE_CLOSE_TRANSITION_MS = MYLIST_EPISODE_PAGE_OPEN_TRANSITION_MS + 200;
let myListEpisodePageState = null;
let myListEpisodePageScrollY = 0;
let myListEpisodePageExpandedSeasonRating = '';

function getMyListEpisodePageItem(sectionHint = '') {
  const state = myListEpisodePageState || {};
  const section = sectionHint || state.section || activeSection;
  const itemId = state.itemId || '';
  if (!section || !itemId) return null;
  const items = Array.isArray(data?.[section]) ? data[section] : [];
  return items.find(entry => entry && String(entry.id || '') === String(itemId)) || null;
}

function getMyListEpisodeInteractionContext(itemId = '', sectionHint = '') {
  const key = String(itemId || '').trim();
  if (!key) return { item: null, index: -1, section: '', items: null, isEpisodePage: false };
  const pageSection = String(myListEpisodePageState?.section || '').trim();
  if (isMyListEpisodePageOpen(key) && pageSection) {
    const items = Array.isArray(data?.[pageSection]) ? data[pageSection] : [];
    const index = items.findIndex(entry => entry && String(entry.id || '') === key);
    if (index >= 0) return { item: items[index], index, section: pageSection, items, isEpisodePage: true };
  }
  const record = findOwnLibraryItemRecord(key, sectionHint || activeSection);
  return {
    item: record.item,
    index: record.index,
    section: record.section || sectionHint || activeSection,
    items: record.items,
    isEpisodePage: false
  };
}

function persistMyListEpisodeEdit(item = null, section = activeSection, options = {}) {
  if (!item || viewingUser) return;
  const shouldMarkEdited = options.markEdited !== false;
  if (shouldMarkEdited) {
    if (typeof markOwnItemLastEdited === 'function') markOwnItemLastEdited(item, section);
    else touchItem(item);
  }
  if (isMyListEpisodePageOpen(item.id) && typeof persistOwnListDataImmediate === 'function') {
    persistOwnListDataImmediate().catch(err => {
      console.warn('[shelfd] immediate Full Page Show Details save failed; falling back to debounced save', err);
      save();
    });
    return;
  }
  save();
}

function isMyListEpisodePageOpen(itemId = '') {
  const overlay = document.getElementById('mylist-episode-page-overlay');
  if (!overlay || !myListEpisodePageState?.itemId) return false;
  if (!itemId) return true;
  return String(myListEpisodePageState.itemId) === String(itemId);
}

function clearMyListInlineEpisodeState(itemId = '') {
  if (!itemId) return;
  const list = document.getElementById(`ep-list-${itemId}`);
  const arrow = document.getElementById(`ep-arrow-${itemId}`);
  if (list) {
    list.classList.remove('open');
    list.style.height = '0px';
  }
  if (arrow) arrow.classList.remove('open');
  delete openStates[`ep-${itemId}`];
  Object.keys(openStates).forEach(key => {
    if (key.startsWith(`s-${itemId}-`)) delete openStates[key];
  });
}

function getMyListEpisodeStatusConfig(item = {}, section = activeSection) {
  const configs = getMyListStatusButtonConfigs(section);
  return configs.find(entry => entry.status === item.status) || configs[0] || { status: item.status || '', label: item.status || 'Status' };
}

function getMyListEpisodePagePoster(item = {}, section = activeSection) {
  return getMyListPosterUrlForItem(item, section);
}

function renderMyListEpisodePageStatusMarkup(item = {}, section = activeSection) {
  const config = getMyListEpisodeStatusConfig(item, section);
  const statusClass = config.status ? `${config.status}-active` : '';
  return `<div class="mylist-episode-page-status" data-episode-page-status-item="${escAttr(item.id)}">
    <span class="status-pill mylist-episode-page-status-pill ${statusClass}" data-status-item-id="${escAttr(item.id)}" data-status="${escAttr(config.status || '')}">${escHtml(config.label || 'Status')}</span>
  </div>`;
}

function buildMyListEpisodePageActions(item = {}) {
  if (viewingUser) return '';
  const escapedId = escAttr(String(item.id || ''));
  return `
    <div class="mylist-episode-page-actions">
      <div class="mylist-episode-page-actions-main">
        <button type="button" class="btn-secondary btn-sm" data-mylist-action="mark-all-eps" data-mylist-item-id="${escapedId}" data-mylist-mark-value="true" onclick="markAllEps('${escapedId}',true)">Mark All Watched</button>
        <button type="button" class="btn-secondary btn-sm" data-mylist-action="mark-all-eps" data-mylist-item-id="${escapedId}" data-mylist-mark-value="false" onclick="markAllEps('${escapedId}',false)">Clear All</button>
      </div>
    </div>
  `;
}

function collapseMyListEpisodePageSeasonRatings() {
  myListEpisodePageExpandedSeasonRating = '';
  document.querySelectorAll('.mylist-episode-page-season-rating-control.is-expanded').forEach(control => {
    control.classList.remove('is-expanded');
    const chip = control.querySelector('.mylist-episode-page-season-rating-chip');
    const stars = control.querySelector('.mylist-episode-page-season-rating-stars');
    if (chip) chip.setAttribute('aria-expanded', 'false');
    if (stars) stars.setAttribute('aria-hidden', 'true');
  });
}

function toggleMyListEpisodePageSeasonRating(itemId = '', seasonNum = '', event = null) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (viewingUser) return;
  const key = `${String(itemId || '')}:${String(seasonNum || '')}`;
  const control = document.querySelector(`.mylist-episode-page-season-rating-control[data-rating-key="${CSS.escape(key)}"]`);
  if (!control) return;
  const wasExpanded = control.classList.contains('is-expanded');
  collapseMyListEpisodePageSeasonRatings();
  if (wasExpanded) return;
  myListEpisodePageExpandedSeasonRating = key;
  control.classList.add('is-expanded');
  const chip = control.querySelector('.mylist-episode-page-season-rating-chip');
  const stars = control.querySelector('.mylist-episode-page-season-rating-stars');
  if (chip) chip.setAttribute('aria-expanded', 'true');
  if (stars) stars.setAttribute('aria-hidden', 'false');
}

function rateMyListEpisodePageSeasonRating(itemId = '', seasonNum = '', score = 0, event = null) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (viewingUser) return;
  collapseMyListEpisodePageSeasonRatings();
  rate(itemId, `season:${seasonNum}`, Number(score || 0));
}

function handleMyListEpisodePageSeasonRatingOutsideClick(event) {
  if (!isMyListEpisodePageOpen() || !myListEpisodePageExpandedSeasonRating) return;
  if (event?.target?.closest?.('.mylist-episode-page-season-rating-control')) return;
  collapseMyListEpisodePageSeasonRatings();
}

if (typeof window !== 'undefined' && !window.__shelfdEpisodePageSeasonRatingClickBound) {
  window.__shelfdEpisodePageSeasonRatingClickBound = true;
  document.addEventListener('click', handleMyListEpisodePageSeasonRatingOutsideClick, true);
}

function renderEpisodePageSeasonRatingControl(item = {}, seasonNum = '', rating = 0, section = activeSection) {
  const itemId = String(item.id || '');
  const sNum = String(seasonNum || '');
  const value = Number(rating || 0);
  const label = formatRatingValueForSection(value, section, false, '0');
  const key = `${itemId}:${sNum}`;
  const readonly = viewingUser || !currentUser;
  if (readonly) {
    return `<span class="mylist-episode-page-season-rating-chip is-readonly" aria-label="Season ${escAttr(sNum)} rating ${escAttr(label)}"><span aria-hidden="true">&#9733;</span><span>${escHtml(label)}</span></span>`;
  }
  const stars = Array.from({ length: 10 }, (_, index) => {
    const score = index + 1;
    const lit = score <= value ? ' lit' : '';
    /* v10.509: aria-label adjusted from "out of 10" to "out of 5" with
       half-star value. score is still the underlying 1-10 unit (each
       unit = half-star) because the stored rating model is unchanged. */
    return `<button type="button" class="mylist-episode-page-season-rating-star${lit}" aria-label="Rate season ${escAttr(sNum)} ${(score / 2) % 1 === 0 ? (score / 2) : (score / 2).toFixed(1)} out of 5" onclick="rateMyListEpisodePageSeasonRating('${escAttr(itemId)}','${escAttr(sNum)}',${score},event)">&#9733;</button>`;
  }).join('');
  return `
    <div class="mylist-episode-page-season-rating-control${myListEpisodePageExpandedSeasonRating === key ? ' is-expanded' : ''}" data-rating-key="${escAttr(key)}">
      <div class="mylist-episode-page-season-rating-stars" aria-hidden="${myListEpisodePageExpandedSeasonRating === key ? 'false' : 'true'}">
        ${stars}
      </div>
      <button type="button" class="mylist-episode-page-season-rating-chip" aria-label="Season ${escAttr(sNum)} rating ${escAttr(label)}" aria-expanded="${myListEpisodePageExpandedSeasonRating === key ? 'true' : 'false'}" onclick="toggleMyListEpisodePageSeasonRating('${escAttr(itemId)}','${escAttr(sNum)}',event)">
        <span aria-hidden="true">&#9733;</span>
        <span>${escHtml(label)}</span>
      </button>
    </div>
  `;
}

function renderEpisodePageSeasonList(item = {}) {
  const eps = getRenderableEpisodes(item);
  if (!eps.length) {
    return '<div class="mylist-episode-page-empty">No episode data available.</div>';
  }
  const section = myListEpisodePageState?.section || item.librarySection || item.mediaCategory || activeSection;
  const seasons = {};
  eps.forEach(ep => {
    const s = Number(ep?.seasonNum || 1) || 1;
    if (!seasons[s]) seasons[s] = [];
    seasons[s].push(ep);
  });
  return Object.keys(seasons).sort((a, b) => Number(b) - Number(a)).map(sNum => {
    const sEps = seasons[sNum];
    const sWatched = sEps.filter(ep => ep && ep.watched).length;
    const seasonName = getSeasonDisplayNameForEpisodes(item, sNum, sEps);
    const seasonPoster = getSeasonPosterForEpisodes(item, sNum, sEps);
    const seasonYear = getSeasonYearForEpisodes(item, sNum);
    const seasonRating = Number(item?.seasonRatings?.[sNum] || 0);
    return `
      <section class="season-block mylist-episode-page-season-block">
        <div class="season-header mylist-episode-page-season-header" role="button" tabindex="0" onclick="toggleSeason('${escAttr(item.id)}',${escAttr(sNum)})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleSeason('${escAttr(item.id)}',${escAttr(sNum)})}">
          <div class="season-poster mylist-episode-page-season-poster${seasonPoster ? '' : ' season-poster-empty'}" data-season-poster-item="${escAttr(item.id)}" data-season-poster-num="${escAttr(sNum)}" ${seasonPoster ? `style="background-image:url(&quot;${escAttr(seasonPoster)}&quot;)"` : ''} aria-hidden="true"></div>
          <div class="season-header-left mylist-episode-page-season-copy">
            <div class="season-title-line mylist-episode-page-season-title-line">
              <span class="season-title">Season ${escHtml(String(sNum))}${seasonName ? `: ${escHtml(seasonName)}` : ''}</span>
              ${seasonYear ? `<span class="season-year">${escHtml(seasonYear)}</span>` : ''}
            </div>
            <div class="mylist-episode-page-season-meta">
              <span class="mylist-episode-page-season-count">${escHtml(String(sEps.length))} episodes</span>
              <span class="season-progress" id="season-progress-${escAttr(item.id)}-${escAttr(sNum)}">${escHtml(String(sWatched))}/${escHtml(String(sEps.length))} watched</span>
            </div>
          </div>
          <div class="season-header-right mylist-episode-page-season-controls">
            <div class="mylist-episode-page-season-controls-top">
            ${!viewingUser ? `<button type="button" class="edit-ep-link season-mark-btn" data-mylist-action="mark-season-eps" data-mylist-item-id="${escAttr(item.id)}" data-mylist-season-num="${escAttr(sNum)}" data-mylist-mark-value="${sWatched < sEps.length}" onclick="event.stopPropagation();markSeasonEps('${escAttr(item.id)}',${escAttr(sNum)},${sWatched < sEps.length})">${sWatched < sEps.length ? 'Mark all' : 'Clear all'}</button>` : ''}
            <span class="season-arrow" id="s-arrow-${escAttr(item.id)}-${escAttr(sNum)}">▼</span>
            </div>
            <div class="mylist-episode-page-season-rating-slot" onclick="event.stopPropagation()">
              ${renderEpisodePageSeasonRatingControl(item, sNum, seasonRating, section)}
            </div>
          </div>
        </div>
        <div class="season-body mylist-episode-page-season-body" id="s-eps-${escAttr(item.id)}-${escAttr(sNum)}" style="display:none;height:0px;" aria-hidden="true">
          <div class="season-eps mylist-episode-page-season-eps">
            ${sEps.map(ep => renderSingleEp(item.id, ep, section)).join('')}
          </div>
        </div>
      </section>
    `;
  }).join('');
}

function renderMyListEpisodePageSummary(item = {}, section = activeSection) {
  const poster = getMyListEpisodePagePoster(item, section);
  const displayTitle = getDisplayTitleForItem(item, section) || item.title || 'Untitled';
  const progress = getCompactEpisodeStats(item);
  const showPercent = Number(progress.total || 0) > 0;
  return `
    <section class="mylist-episode-page-summary">
      <div class="mylist-episode-page-summary-poster${poster ? '' : ' no-img'}" ${poster ? `style="background-image:url('${escAttr(poster)}')"` : ''} ${poster ? `data-poster="${escAttr(poster)}"` : ''} aria-hidden="true"></div>
      <div class="mylist-episode-page-summary-main">
        <div class="mylist-episode-page-title">${escHtml(displayTitle)}</div>
        ${renderMyListEpisodePageStatusMarkup(item, section)}
        <div class="progress-area mylist-episode-page-progress-area">
          <div class="progress-meta mylist-episode-page-progress-meta">
            <span id="progress-count-${escAttr(item.id)}">${escHtml(String(progress.watched))}/${escHtml(String(progress.total))} episodes</span>
          </div>
          <div class="progress-bar-row mylist-episode-page-progress-row">
            <div class="progress-bar"><div class="progress-fill" id="progress-fill-${escAttr(item.id)}" style="width:${progress.percent}%"></div></div>
            <span class="progress-percent-inline" id="progress-percent-${escAttr(item.id)}"${showPercent ? '' : ' hidden'}>${showPercent ? `${Math.round(progress.percent)}%` : ''}</span>
          </div>
        </div>
        <div class="rating-area mylist-episode-page-rating-area">
          <div class="rating-label">Rating</div>
          ${renderStars(item.rating || 0, item.id, 'overall', 16, section)}
        </div>
      </div>
    </section>
  `;
}

function renderMyListEpisodePageHtml(item = {}, section = activeSection) {
  return `
    <div class="mylist-episode-page-shell" data-episode-page-item="${escAttr(item.id)}" data-episode-page-section="${escAttr(section)}">
      <div class="mylist-episode-page-topbar">
        <button type="button" class="mylist-episode-page-back" onclick="closeMyListEpisodePage()" aria-label="Back to My Lists">
          <svg class="mylist-episode-page-back-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 4.5 3.5 10 9 15.5"></path>
            <path d="M16.5 10H4"></path>
          </svg>
          <span>Back</span>
        </button>
      </div>
      <div class="mylist-episode-page-scroll">
        ${renderMyListEpisodePageSummary(item, section)}
        ${buildMyListEpisodePageActions(item)}
        <section class="mylist-episode-page-seasons">
          <div class="ep-list open mylist-episode-page-list" id="ep-list-${escAttr(item.id)}">
            <div class="ep-list-inner">
              <div class="ep-scroll mylist-episode-page-season-list">
                ${renderEpisodePageSeasonList(item)}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;
}

function ensureMyListEpisodePageOverlay() {
  let overlay = document.getElementById('mylist-episode-page-overlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'mylist-episode-page-overlay';
  overlay.className = 'mylist-episode-page-overlay';
  overlay.innerHTML = '<div class="mylist-episode-page-surface"></div>';
  document.body.appendChild(overlay);
  return overlay;
}

function lockMyListEpisodePageScroll() {
  if (document.body.classList.contains('mylist-episode-page-open')) return;
  myListEpisodePageScrollY = window.scrollY || window.pageYOffset || 0;
  document.documentElement.classList.add('mylist-episode-page-open');
  document.body.classList.add('mylist-episode-page-open');
  document.body.style.position = 'fixed';
  document.body.style.top = `-${myListEpisodePageScrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.width = '100%';
  document.body.style.overflow = 'hidden';
}

function unlockMyListEpisodePageScroll() {
  if (!document.body.classList.contains('mylist-episode-page-open')) return;
  const state = myListEpisodePageState || {};
  const storedY = myListEpisodePageScrollY || Math.abs(parseInt(document.body.style.top || '0', 10)) || 0;
  document.documentElement.classList.remove('mylist-episode-page-open');
  document.body.classList.remove('mylist-episode-page-open');
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.width = '';
  document.body.style.overflow = '';
  window.scrollTo(0, storedY);
  if (state.originItemId) {
    requestAnimationFrame(() => {
      const card = document.getElementById(`card-${state.originItemId}`);
      if (!card || typeof state.originCardTop !== 'number') return;
      const delta = card.getBoundingClientRect().top - state.originCardTop;
      if (Math.abs(delta) < 4) return;
      window.scrollTo({ top: Math.max(0, window.scrollY + delta), behavior: 'auto' });
    });
  }
  myListEpisodePageScrollY = 0;
}

function restoreMyListEpisodePageSeasonState(itemId = '') {
  Object.keys(openStates).forEach(key => {
    if (!openStates[key] || !key.startsWith(`s-${itemId}-`)) return;
    const body = document.getElementById(`s-eps-${key.slice(2)}`);
    const arrow = document.getElementById(`s-arrow-${key.slice(2)}`);
    const block = body?.closest('.season-block');
    if (body) {
      body.style.display = 'block';
      body.style.height = 'auto';
      body.style.opacity = '1';
      body.style.transform = 'none';
      body.setAttribute('aria-hidden', 'false');
    }
    if (block) block.classList.add('is-open');
    if (arrow) arrow.classList.add('open');
  });
}

function rerenderMyListEpisodePage(options = {}) {
  if (!isMyListEpisodePageOpen()) return;
  const item = getMyListEpisodePageItem();
  const overlay = document.getElementById('mylist-episode-page-overlay');
  const surface = overlay?.querySelector('.mylist-episode-page-surface');
  if (!overlay || !surface || !item) return;
  const scrollEl = overlay.querySelector('.mylist-episode-page-scroll');
  const scrollTop = options.preserveScroll === false ? 0 : (scrollEl?.scrollTop || 0);
  surface.innerHTML = renderMyListEpisodePageHtml(item, myListEpisodePageState.section || activeSection);
  restoreMyListEpisodePageSeasonState(item.id);
  const nextScrollEl = overlay.querySelector('.mylist-episode-page-scroll');
  if (nextScrollEl) nextScrollEl.scrollTop = scrollTop;
  hydrateMissingSeasonPosters(item.id, myListEpisodePageState.section || activeSection);
}

function updateMyListEpisodePageStatusUI(item = {}, section = activeSection) {
  if (!item?.id) return;
  const config = getMyListEpisodeStatusConfig(item, section);
  document.querySelectorAll(`.mylist-episode-page-status-pill[data-status-item-id="${CSS.escape(String(item.id))}"]`).forEach(node => {
    node.textContent = config.label || 'Status';
    node.dataset.status = config.status || '';
    ['live-active', 'competitive-active', 'watching-active', 'planned-active', 'watched-active', 'paused-active', 'dropped-active', 'wishlist-active']
      .forEach(cls => node.classList.remove(cls));
    if (config.status) node.classList.add(`${config.status}-active`);
  });
}

function getEpisodeInteractionScrollContainer(itemId = '') {
  if (isMyListEpisodePageOpen(itemId)) {
    return document.querySelector('#mylist-episode-page-overlay .mylist-episode-page-scroll');
  }
  return document.querySelector(`#ep-list-${itemId} .ep-scroll`);
}

function openMyListEpisodePage(itemId = '', sectionHint = activeSection) {
  const section = sectionHint || activeSection;
  if (!(section === 'shows' || section === 'anime')) return;
  const item = (data?.[section] || []).find(entry => entry && String(entry.id || '') === String(itemId));
  if (!item) return;
  closeEpRating();
  collapseMyListEpisodePageSeasonRatings();
  clearMyListInlineEpisodeState(itemId);
  const originCard = document.getElementById(`card-${itemId}`);
  myListEpisodePageState = {
    itemId: String(itemId),
    section,
    originItemId: String(itemId),
    originCardTop: originCard ? originCard.getBoundingClientRect().top : null
  };
  const overlay = ensureMyListEpisodePageOverlay();
  const surface = overlay.querySelector('.mylist-episode-page-surface');
  if (!surface) return;
  overlay.classList.remove('is-closing');
  overlay.style.setProperty('--mylist-episode-page-motion-ms', `${MYLIST_EPISODE_PAGE_OPEN_TRANSITION_MS}ms`);
  surface.innerHTML = renderMyListEpisodePageHtml(item, section);
  lockMyListEpisodePageScroll();
  hydrateMissingSeasonPosters(itemId, section);
  if (section === 'anime' && item && (item.malId || item.mal_id)) {
    hydrateAnimeEpisodeTitlesFromJikan(item);
  }
  requestAnimationFrame(() => overlay.classList.add('is-open'));
}

function closeMyListEpisodePage() {
  const overlay = document.getElementById('mylist-episode-page-overlay');
  collapseMyListEpisodePageSeasonRatings();
  closeEpRating();
  if (!overlay) {
    myListEpisodePageState = null;
    unlockMyListEpisodePageScroll();
    return;
  }
  const itemId = String(myListEpisodePageState?.itemId || '');
  overlay.classList.add('is-closing');
  overlay.style.setProperty('--mylist-episode-page-motion-ms', `${MYLIST_EPISODE_PAGE_CLOSE_TRANSITION_MS}ms`);
  overlay.classList.remove('is-open');
  window.setTimeout(() => {
    overlay.remove();
    if (itemId) {
      delete openStates[`ep-${itemId}`];
      Object.keys(openStates).forEach(key => {
        if (key.startsWith(`s-${itemId}-`)) delete openStates[key];
      });
    }
    unlockMyListEpisodePageScroll();
    myListEpisodePageState = null;
  }, MYLIST_EPISODE_PAGE_CLOSE_TRANSITION_MS);
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
  if (viewingUser) return;
  closeEpRating();
  const row = document.getElementById('ep-row-' + epId);
  if (!row) return;
  const context = getMyListEpisodeInteractionContext(itemId);
  const item = context.item;
  const section = context.section || activeSection;
  const ep = item ? (item.episodes || []).find(e => e.id === epId) : null;
  const currentRating = ep ? (ep.rating || 0) : 0;
  const popup = document.createElement('div');
  popup.className = 'ep-rating-popup';
  popup.id = 'ep-rating-popup';
  popup.dataset.itemId = itemId;
  popup.dataset.epId = epId;
  popup.dataset.hovered = '0';
  popup.dataset.section = section;
  let html = buildPopupRatingButtons(currentRating, itemId, epId, section);
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
  if (viewingUser) return;
  const context = getMyListEpisodeInteractionContext(itemId);
  const item = context.item;
  const section = context.section || activeSection;
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
    closeEpRating();
    persistMyListEpisodeEdit(item, section);
    if (isMyListEpisodePageOpen(itemId)) rerenderMyListEpisodePage();
    else render();
    const row = document.getElementById('ep-row-' + epId);
    const btn = row ? row.querySelector('.ep-rating-btn') : null;
    if (btn) {
      btn.classList.toggle('has-rating', Number(ep.rating || 0) > 0);
      btn.innerHTML = `&#9733;${Number(ep.rating || 0) > 0 ? ` ${formatRatingValueForSection(ep.rating, section)}` : ''}`;
    }
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

function scrollMyListEpisodePageSeasonIntoView(itemId = '', sNum = '', behavior = 'smooth') {
  const overlay = document.getElementById('mylist-episode-page-overlay');
  const scrollEl = overlay?.querySelector('.mylist-episode-page-scroll');
  const body = document.getElementById('s-eps-' + itemId + '-' + sNum);
  const block = body?.closest('.season-block');
  if (!overlay || !scrollEl || !block) return;
  const scrollRect = scrollEl.getBoundingClientRect();
  const blockRect = block.getBoundingClientRect();
  const topInset = 10;
  const bottomInset = 18;
  const visibleHeight = Math.max(120, scrollEl.clientHeight - topInset - bottomInset);
  const blockHeight = block.offsetHeight || blockRect.height || 0;
  let target;
  if (blockHeight <= visibleHeight) {
    const blockBottom = blockRect.bottom - scrollRect.top;
    const neededBottom = blockBottom - (scrollEl.clientHeight - bottomInset);
    const neededTop = blockRect.top - scrollRect.top - topInset;
    target = scrollEl.scrollTop + (neededBottom > 1 ? neededBottom : neededTop);
  } else {
    target = scrollEl.scrollTop + (blockRect.top - scrollRect.top) - topInset;
  }
  const maxTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
  target = Math.max(0, Math.min(maxTop, target));
  if (Math.abs(target - scrollEl.scrollTop) < 2) return;
  if (behavior === 'auto' || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    scrollEl.scrollTop = target;
    return;
  }
  scrollEl.scrollTo({ top: target, behavior });
}

function toggleSeason(itemId, sNum) {
  const el = document.getElementById('s-eps-' + itemId + '-' + sNum);
  const arrow = document.getElementById('s-arrow-' + itemId + '-' + sNum);
  if (!el) return;
  const isEpisodePage = !!el.closest('#mylist-episode-page-overlay');
  const open = el.style.display !== 'none';

  if (isEpisodePage) {
    const block = el.closest('.season-block');
    if (!open) {
      el.style.display = 'block';
      const contentHeight = el.scrollHeight;
      el.style.overflow = 'hidden';
      el.style.height = '0px';
      el.style.opacity = '0';
      el.style.transform = 'translateY(-8px)';
      el.setAttribute('aria-hidden', 'false');
      if (arrow) arrow.classList.add('open');
      if (block) block.classList.add('is-open');
      openStates['s-' + itemId + '-' + sNum] = true;
      requestAnimationFrame(() => {
        el.style.height = `${contentHeight}px`;
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
        requestAnimationFrame(() => scrollMyListEpisodePageSeasonIntoView(itemId, sNum, 'smooth'));
      });
      const onOpenEnd = (event) => {
        if (event.propertyName !== 'height') return;
        el.removeEventListener('transitionend', onOpenEnd);
        if (!openStates['s-' + itemId + '-' + sNum]) return;
        el.style.height = 'auto';
        el.style.overflow = '';
        scrollMyListEpisodePageSeasonIntoView(itemId, sNum, 'smooth');
      };
      el.addEventListener('transitionend', onOpenEnd);
      return;
    }
    const startHeight = el.scrollHeight;
    el.style.height = `${startHeight}px`;
    el.style.overflow = 'hidden';
    void el.offsetHeight;
    el.style.height = '0px';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-8px)';
    el.setAttribute('aria-hidden', 'true');
    if (arrow) arrow.classList.remove('open');
    if (block) block.classList.remove('is-open');
    openStates['s-' + itemId + '-' + sNum] = false;
    const onCloseEnd = (event) => {
      if (event.propertyName !== 'height') return;
      el.removeEventListener('transitionend', onCloseEnd);
      if (openStates['s-' + itemId + '-' + sNum]) return;
      el.style.display = 'none';
      el.style.overflow = '';
    };
    el.addEventListener('transitionend', onCloseEnd);
    return;
  }

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
  if (viewingUser) return;
  const context = getMyListEpisodeInteractionContext(itemId);
  const item = context.item;
  const section = context.section || activeSection;
  if (!item) return;
  preserveViewport(() => {
    preserveEpisodeScroll(itemId, () => {
      const affectedEpisodes = item.episodes.filter(e => e.seasonNum === sNum);
      item.episodes.forEach(e => { if (e.seasonNum === sNum) e.watched = val; });
      if (val) {
        markEpisodeWatchActivity(item, section, { count: affectedEpisodes.length, label: `season ${sNum} watched` });
        // v553: a fully-marked season triggers the season-finished signal
        maybeMarkScreenListSeasonFinished(item, section, sNum);
      }
      const statusChangedNow = applyScreenListEpisodeStatusOrDefer(item);
      persistMyListEpisodeEdit(item, section);
      if (statusChangedNow && !itemMatchesCurrentView(item)) {
        item.episodes.forEach(ep => {
          if (ep.seasonNum === sNum) updateEpisodeRowState(ep);
        });
        updateCardProgressUI(item);
        updateSeasonProgressUI(item, sNum);
        updateSeasonActionLabelUI(item, sNum);
        updateStatusPillsUI(item);
        render();
        if (isMyListEpisodePageOpen(itemId)) rerenderMyListEpisodePage();
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
  const key = String(rawgId);
  const next = { ...seed, gameIdentityKey: seed.gameIdentityKey || key };
  if (/^\d+$/.test(key) && !next.rawgId) next.rawgId = key;
  gameMediaProfileSeeds.set(key, next);
}

function getGameMediaProfileSeed(rawgId, fallback = null) {
  const stored = gameMediaProfileSeeds.get(String(rawgId || ''));
  if (fallback && typeof fallback === 'object' && Object.keys(fallback).length) return fallback;
  return stored || fallback || {};
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

function createMediaProfileHeroRevealPromise(overlay) {
  if (!overlay) return;
  let resolveReady = null;
  overlay.__screenListHeroReadyPromise = new Promise(resolve => {
    resolveReady = resolve;
  });
  overlay.__screenListHeroReadyResolve = () => {
    if (typeof resolveReady === 'function') resolveReady();
    resolveReady = null;
    overlay.__screenListHeroReadyResolve = null;
  };
}

function resolveMediaProfileHeroRevealPromise(overlay) {
  if (typeof overlay?.__screenListHeroReadyResolve === 'function') {
    overlay.__screenListHeroReadyResolve();
  }
}

function waitForMediaProfileHeroReveal(overlay) {
  return overlay?.__screenListHeroReadyPromise || Promise.resolve();
}
window.waitForMediaProfileHeroReveal = waitForMediaProfileHeroReveal;

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
  createMediaProfileHeroRevealPromise(overlay);

  if (!canUseMediaProfileHeroAnimation(overlay, originRect)) {
    requestAnimationFrame(() => {
      overlay?.classList.add('open');
      resolveMediaProfileHeroRevealPromise(overlay);
    });
    return;
  }

  cleanupMediaProfilePosterHero();
  overlay.__screenListHeroOriginElement = originElement;
  overlay.__screenListHeroOriginRect = originRect;

  const startTransform = getMediaProfileHeroTransformFromRect(originRect);
  const endTransform = 'translate3d(0, 0, 0) scale(1, 1)';

  animateMediaProfileOverlayTransform(overlay, startTransform, endTransform, () => {
    if (!document.body.contains(overlay)) {
      resolveMediaProfileHeroRevealPromise(overlay);
      return;
    }
    overlay.classList.add('open');
    clearMediaProfileHeroInlineState(overlay);
    resolveMediaProfileHeroRevealPromise(overlay);
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
  if (typeof destroyDiscoverHeroTrailerPreview === 'function') {
    try { destroyDiscoverHeroTrailerPreview(overlay); } catch (_) {}
  }
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
  const identityKey = details?.gameIdentityKey || details?.shelfdGameIdentityLock?.key || '';
  const discoverId = String(rawgId || getGameRawgIdValue(details) || identityKey || (details?.igdbId ? `igdb:${details.igdbId}` : '') || '');
  const checkSvg = `<svg class="discover-media-add-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4 4 10-10"/></svg>`;
  const plusSvg = `<svg class="discover-media-add-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`;
  const labelHtml = added ? checkSvg : plusSvg;
  return `<button class="discover-media-add-floating${added ? ' added' : ''}" type="button" data-discover-type="game" data-discover-id="${escAttr(discoverId)}" data-discover-section="games" data-discover-title="${escAttr(title)}" data-discover-poster="${escAttr(poster)}" data-game-identity-key="${escAttr(identityKey || discoverId)}" aria-label="${added ? 'Manage this game in your library' : 'Add this game to your library'}" ${added ? `title="Manage this game in your library"` : ''}>${labelHtml}</button>`;
}

function getGameMediaProfileShareId(details, rawgId = '') {
  const identityKey = details?.gameIdentityKey || details?.shelfdGameIdentityLock?.key || '';
  return String(rawgId || getGameRawgIdValue(details) || identityKey || (details?.igdbId ? `igdb:${details.igdbId}` : '') || '').trim();
}

function renderGameMediaProfileShell(seed, rawgId = '') {
  const title = getGameTitleValue(seed) || 'Game Profile';
  const poster = getGameMediaImage(seed);
  const year = String(seed?.released || seed?.year || '').slice(0, 4);
  const overview = seed?.description_raw || seed?.description || 'Loading this game profile...';
  const genres = (seed?.genres || []).map(g => g?.name).filter(Boolean).slice(0, 4);
  const shareId = getGameMediaProfileShareId(seed, rawgId);
  return `<section class="discover-media-page discover-standard-title-page game-media-page discover-desktop-title-page" role="dialog" aria-modal="true" aria-label="${escAttr(title)} details">
    <button class="discover-media-back" type="button" onclick="return handleDiscoverMediaProfileBack(event)">Back</button>
    ${renderMediaProfileTopActions(renderMediaProfileShareButton('game', shareId, title, poster), `${rawgId ? renderGameMediaProfileAddButton(rawgId, seed) : ''}${currentUser && !viewingUser ? `<button class="discover-media-add-floating screenlist-game-profile-cover-btn" type="button" onclick="event.preventDefault();event.stopPropagation();openScreenListGameCoverPickerForSeed('${escAttr(String(rawgId || getGameRawgIdValue(seed) || ''))}','${escAttr(title)}')">Change Cover</button>` : ''}`)}
    <div class="discover-media-hero game-media-hero" style="${poster ? `background-image:url('${escAttr(poster)}')` : ''}">
      <div class="discover-media-hero-shade"></div>
      <div class="discover-media-hero-content">
        <div class="discover-media-hero-top">
          <div class="discover-media-poster game-media-poster${poster ? '' : ' screenlist-game-cover-pending'}">${poster ? `<img src="${escAttr(poster)}" alt="" decoding="async">` : `<span>${SCREENLIST_GAME_COVER_PLACEHOLDER_TEXT}</span>`}</div>
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

function formatGameMediaProfileFetchedRating(details = {}) {
  const metacriticScore = getGameMetacriticScore(details);
  if (metacriticScore !== null) {
    const normalized = typeof window.normalizeFetchedRatingToFiveStar === 'function'
      ? window.normalizeFetchedRatingToFiveStar(metacriticScore, 'metacritic')
      : metacriticScore / 20;
    return normalized > 0 ? normalized.toFixed(1) : 'N/A';
  }
  const rawgRating = Number(details.rating || 0);
  if (rawgRating > 0) {
    const normalized = typeof window.normalizeFetchedRatingToFiveStar === 'function'
      ? window.normalizeFetchedRatingToFiveStar(rawgRating, 'rawg')
      : rawgRating;
    return normalized > 0 ? normalized.toFixed(1) : 'N/A';
  }
  return 'N/A';
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
  const youtube = details?.gameTrailer || details?.youtubeTrailer || details?.trailer || null;
  const key = String(youtube?.key || youtube?.videoId || youtube?.youtubeId || '').trim();
  if (key) {
    return {
      key,
      site: 'YouTube',
      type: youtube.type || 'Trailer',
      name: youtube.name || youtube.title || `${getGameTitleValue(details)} trailer`
    };
  }
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

const gameMediaTrailerCache = new Map();
const GAME_TRAILER_FETCH_TIMEOUT_MS = 9000;
const GAME_TRAILER_CHANNEL_KEYWORDS = [
  'official', 'playstation', 'xbox', 'nintendo', 'steam', 'epic games',
  'game trailers', 'gamespot trailers', 'ign', 'devolver', 'ubisoft',
  'bethesda', 'ea', 'electronic arts', 'activision', 'blizzard', 'capcom',
  'square enix', 'bandai namco', 'sega', 'atlus', 'konami', 'rockstar',
  '2k', 'riot games', 'marvel games', 'warner bros games', 'wb games',
  'cd projekt', 'fromsoftware', 'kojima productions', 'insomniac games',
  'naughty dog', 'sucker punch', 'santa monica studio', 'bungie', 'valve',
  'mojang', 'epic games', 'netease games', 'hoyoverse', 'pokemon',
  'the pokemon company'
];
const GAME_TRAILER_BAD_TITLE_PATTERN = /\b(review|reaction|walkthrough|lets play|let's play|tips|guide|explained|analysis|mods?|soundtrack|ost|full game|part\s+\d+|mission|boss fight)\b/i;
const GAME_TRAILER_GOOD_TITLE_PATTERN = /\b(official\s+trailer|launch\s+trailer|reveal\s+trailer|announcement\s+trailer|gameplay\s+trailer|story\s+trailer|cinematic\s+trailer|teaser\s+trailer|trailer)\b/i;

function normalizeGameTrailerText(value = '') {
  return String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
}

function gameTrailerTitleMatches(details = {}, videoTitle = '') {
  const title = normalizeGameTrailerText(getGameTitleValue(details));
  const video = normalizeGameTrailerText(videoTitle);
  if (!title || !video) return false;
  const tokens = title.split(' ').filter(token => token.length > 2);
  if (!tokens.length) return video.includes(title);
  const matched = tokens.filter(token => video.includes(token)).length;
  return matched >= Math.min(tokens.length, Math.max(2, Math.ceil(tokens.length * 0.58)));
}

function gameTrailerChannelLooksOfficial(details = {}, channelTitle = '') {
  const channel = normalizeGameTrailerText(channelTitle);
  if (!channel) return false;
  if (GAME_TRAILER_CHANNEL_KEYWORDS.some(keyword => channel.includes(normalizeGameTrailerText(keyword)))) return true;
  const parties = [
    ...(details.developers || []).map(dev => dev?.name),
    ...(details.publishers || []).map(pub => pub?.name),
    getGameTitleValue(details)
  ].map(normalizeGameTrailerText).filter(Boolean);
  return parties.some(name => name.length >= 4 && channel.includes(name));
}

function scoreGameTrailerCandidate(details = {}, item = {}) {
  const videoId = String(item.videoId || item.id?.videoId || '').trim();
  const title = String(item.title || '').trim();
  if (!videoId || !title) return -Infinity;
  if (GAME_TRAILER_BAD_TITLE_PATTERN.test(title)) return -Infinity;
  if (!gameTrailerTitleMatches(details, title)) return -Infinity;
  let score = 0;
  if (GAME_TRAILER_GOOD_TITLE_PATTERN.test(title)) score += 70;
  if (/\bofficial\b/i.test(title)) score += 22;
  if (/\b(launch|reveal|announcement|gameplay|story|cinematic|teaser)\b/i.test(title)) score += 12;
  if (gameTrailerChannelLooksOfficial(details, item.channelTitle || '')) score += 42;
  const year = String(details.released || details.year || '').slice(0, 4);
  if (year && String(title).includes(year)) score += 8;
  return score;
}

function getGameTrailerSearchQueries(details = {}) {
  const title = getGameTitleValue(details);
  if (!title) return [];
  const year = String(details.released || details.year || '').slice(0, 4);
  return [
    `${title}${year ? ` ${year}` : ''} official trailer game`,
    `${title} official launch trailer`,
    `${title} gameplay trailer`
  ];
}

async function fetchGameYoutubeSearch(query = '') {
  const clean = String(query || '').trim();
  if (!clean) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GAME_TRAILER_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(clean)}`, { signal: controller.signal });
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json?.items) ? json.items : [];
  } catch (_) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function resolveGameMediaProfileTrailer(details = {}, rawgId = '') {
  const direct = getGameMediaTrailer(details);
  if (direct?.key) return direct;
  const cacheKey = String(rawgId || getGameRawgIdValue(details) || getGameTitleValue(details) || '').toLowerCase();
  if (cacheKey && gameMediaTrailerCache.has(cacheKey)) return gameMediaTrailerCache.get(cacheKey);
  let best = null;
  let bestScore = -Infinity;
  for (const query of getGameTrailerSearchQueries(details)) {
    const results = await fetchGameYoutubeSearch(query);
    for (const item of results) {
      const score = scoreGameTrailerCandidate(details, item);
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
    if (bestScore >= 120) break;
  }
  const trailer = best && bestScore > 0
    ? {
        key: String(best.videoId || best.id?.videoId || '').trim(),
        site: 'YouTube',
        type: 'Trailer',
        name: best.title || `${getGameTitleValue(details)} trailer`,
        channelTitle: best.channelTitle || ''
      }
    : direct;
  if (cacheKey) gameMediaTrailerCache.set(cacheKey, trailer || null);
  return trailer || null;
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
  const score = formatGameMediaProfileFetchedRating(details);
  const trailer = getGameMediaTrailer(details);
  const heroTrailer = trailer?.key ? trailer : null;
  const directTrailer = trailer?.url && !heroTrailer ? trailer : null;
  const screenshots = (details.screenshots?.results || details.short_screenshots || []).filter(img => img?.image).slice(0, 8);
  const shareId = getGameMediaProfileShareId(details, rawgId);
  return `<section class="discover-media-page discover-standard-title-page game-media-page discover-desktop-title-page" role="dialog" aria-modal="true" aria-label="${escAttr(title)} details">
    <button class="discover-media-back" type="button" onclick="return handleDiscoverMediaProfileBack(event)">Back</button>
    ${renderMediaProfileTopActions(renderMediaProfileShareButton('game', shareId, title, poster), `${renderGameMediaProfileAddButton(rawgId || getGameRawgIdValue(details), details)}${currentUser && !viewingUser ? `<button class="discover-media-add-floating screenlist-game-profile-cover-btn" type="button" onclick="event.preventDefault();event.stopPropagation();openScreenListGameCoverPickerForSeed('${escAttr(String(rawgId || getGameRawgIdValue(details) || ''))}','${escAttr(title)}')">Change Cover</button>` : ''}`, '', (typeof renderDiscoverHeroTrailerSoundToggle === 'function' ? renderDiscoverHeroTrailerSoundToggle(heroTrailer) : ''))}
    <div class="discover-media-hero game-media-hero${heroTrailer ? ' has-trailer-preview' : ''}" style="${poster ? `background-image:url('${escAttr(poster)}')` : ''}">
      ${heroTrailer && typeof renderDiscoverHeroTrailerPreview === 'function' ? renderDiscoverHeroTrailerPreview(heroTrailer, title) : ''}
      <div class="discover-media-hero-shade"></div>
      <div class="discover-media-hero-content">
        <div class="discover-media-poster game-media-poster${poster ? '' : ' screenlist-game-cover-pending'}">${poster ? `<img src="${escAttr(poster)}" alt="" decoding="async">` : `<span>${SCREENLIST_GAME_COVER_PLACEHOLDER_TEXT}</span>`}</div>
        <div class="discover-media-kicker">Game Profile${year ? ` · ${escHtml(year)}` : ''}</div>
        <h2>${escHtml(title)}</h2>
        <p>${escHtml(overview)}</p>
        ${genres.length ? `<div class="discover-media-chips">${genres.map(name => `<span>${escHtml(name)}</span>`).join('')}</div>` : ''}
        ${renderGameProfileFloatingExports(details)}
      </div>
    </div>
    <div class="discover-media-body">
      <div class="discover-media-score-row">
        <div class="discover-media-score"><span class="discover-media-score-star" aria-hidden="true">★</span><span class="discover-media-score-value">${escHtml(score)}</span>${score !== 'N/A' ? '<span class="discover-media-score-denominator">/5</span>' : ''}</div>
      </div>
      ${facts.length ? `<div class="discover-media-facts">${facts.map(fact => `<div class="${fact.priority ? 'primary' : ''}"><strong>${escHtml(fact.value)}</strong><span>${escHtml(fact.label)}</span></div>`).join('')}</div>` : ''}
      ${directTrailer ? `<div class="discover-media-trailer"><video controls playsinline preload="metadata" ${directTrailer.poster ? `poster="${escAttr(directTrailer.poster)}"` : ''}><source src="${escAttr(directTrailer.url)}"></video></div>` : ''}
      ${screenshots.length ? `<div class="discover-media-section"><h3>Screenshots</h3><div class="discover-media-similar game-media-screenshots">${screenshots.map(img => `<a class="discover-media-similar-card" href="${escAttr(img.image)}" target="_blank" rel="noopener"><img src="${escAttr(img.image)}" alt=""><span>Screenshot</span></a>`).join('')}</div></div>` : ''}
      ${typeof window.renderUniversalMediaReviewsButton === 'function' ? window.renderUniversalMediaReviewsButton('game', details, rawgId || getGameRawgIdValue(details)) : ''}
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
  const shareId = getGameMediaProfileShareId(seed, rawgId);
  return `<section class="discover-media-page discover-standard-title-page game-media-page discover-desktop-title-page" role="dialog" aria-modal="true" aria-label="${escAttr(title)} details">
    <button class="discover-media-back" type="button" onclick="return handleDiscoverMediaProfileBack(event)">Back</button>
    ${renderMediaProfileTopActions(renderMediaProfileShareButton('game', shareId, title, poster), `${rawgId ? renderGameMediaProfileAddButton(rawgId, seed) : ''}${currentUser && !viewingUser ? `<button class="discover-media-add-floating screenlist-game-profile-cover-btn" type="button" onclick="event.preventDefault();event.stopPropagation();openScreenListGameCoverPickerForSeed('${escAttr(String(rawgId || getGameRawgIdValue(seed) || ''))}','${escAttr(title)}')">Change Cover</button>` : ''}`)}
    <div class="discover-media-hero game-media-hero" style="${poster ? `background-image:url('${escAttr(poster)}')` : ''}">
      <div class="discover-media-hero-shade"></div>
      <div class="discover-media-hero-content">
        <div class="discover-media-hero-top">
          <div class="discover-media-poster game-media-poster${poster ? '' : ' screenlist-game-cover-pending'}">${poster ? `<img src="${escAttr(poster)}" alt="" decoding="async">` : `<span>${SCREENLIST_GAME_COVER_PLACEHOLDER_TEXT}</span>`}</div>
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
  const score = formatGameMediaProfileFetchedRating(details);
  const trailer = getGameMediaTrailer(details);
  const heroTrailer = trailer?.key ? trailer : null;
  const directTrailer = trailer?.url && !heroTrailer ? trailer : null;
  const screenshots = (details.screenshots?.results || details.short_screenshots || []).filter(img => img?.image).slice(0, 8);
  const shareId = getGameMediaProfileShareId(details, rawgId);
  return `<section class="discover-media-page discover-standard-title-page game-media-page discover-desktop-title-page" role="dialog" aria-modal="true" aria-label="${escAttr(title)} details">
    <button class="discover-media-back" type="button" onclick="return handleDiscoverMediaProfileBack(event)">Back</button>
    ${renderMediaProfileTopActions(renderMediaProfileShareButton('game', shareId, title, poster), `${renderGameMediaProfileAddButton(rawgId || getGameRawgIdValue(details), details)}${currentUser && !viewingUser ? `<button class="discover-media-add-floating screenlist-game-profile-cover-btn" type="button" onclick="event.preventDefault();event.stopPropagation();openScreenListGameCoverPickerForSeed('${escAttr(String(rawgId || getGameRawgIdValue(details) || ''))}','${escAttr(title)}')">Change Cover</button>` : ''}`, '', (typeof renderDiscoverHeroTrailerSoundToggle === 'function' ? renderDiscoverHeroTrailerSoundToggle(heroTrailer) : ''))}
    <div class="discover-media-hero game-media-hero${heroTrailer ? ' has-trailer-preview' : ''}" style="${poster ? `background-image:url('${escAttr(poster)}')` : ''}">
      ${heroTrailer && typeof renderDiscoverHeroTrailerPreview === 'function' ? renderDiscoverHeroTrailerPreview(heroTrailer, title) : ''}
      <div class="discover-media-hero-shade"></div>
      <div class="discover-media-hero-content">
        <div class="discover-media-hero-top">
          <div class="discover-media-poster game-media-poster${poster ? '' : ' screenlist-game-cover-pending'}">${poster ? `<img src="${escAttr(poster)}" alt="" decoding="async">` : `<span>${SCREENLIST_GAME_COVER_PLACEHOLDER_TEXT}</span>`}</div>
          <div class="discover-media-hero-main">
            <div class="discover-media-kicker">Game Profile${year ? ` · ${escHtml(year)}` : ''}</div>
            <h2>${escHtml(title)}</h2>
            <div class="discover-media-score discover-media-score-hero"><span class="discover-media-score-star" aria-hidden="true">★</span><span class="discover-media-score-value">${escHtml(score)}</span>${score !== 'N/A' ? '<span class="discover-media-score-denominator">/5</span>' : ''}</div>
          </div>
        </div>
        <p class="discover-media-synopsis" onclick="this.classList.toggle('expanded')">${escHtml(overview)}</p>
        ${genres.length ? `<div class="discover-media-chips">${genres.map(name => `<span>${escHtml(name)}</span>`).join('')}</div>` : ''}
        ${renderGameProfileFloatingExports(details)}
      </div>
    </div>
    <div class="discover-media-body discover-media-body-cinema">
      ${(facts.length || credits.length || directTrailer) ? `<div class="discover-media-detail-grid${directTrailer ? ' has-trailer' : ''}">
        ${(facts.length || credits.length) ? `<div class="discover-media-detail-stack">
          ${facts.length ? `<div class="discover-media-facts">${facts.map(fact => `<div class="${fact.priority ? 'primary' : ''}"><strong>${escHtml(fact.value)}</strong><span>${escHtml(fact.label)}</span></div>`).join('')}</div>` : ''}
          ${credits.length ? `<div class="discover-media-credits">${credits.map(row => `<div><span>${escHtml(row.label)}</span><strong>${escHtml(row.value)}</strong></div>`).join('')}</div>` : ''}
        </div>` : ''}
        ${directTrailer ? `<div class="discover-media-trailer discover-media-trailer-panel"><video controls playsinline preload="metadata" ${directTrailer.poster ? `poster="${escAttr(directTrailer.poster)}"` : ''}><source src="${escAttr(directTrailer.url)}"></video></div>` : ''}
      </div>` : ''}
      ${screenshots.length ? `<div class="discover-media-section discover-media-section-cast"><h3>Screenshots</h3><div class="discover-media-similar game-media-screenshots">${screenshots.map(img => `<a class="discover-media-similar-card" href="${escAttr(img.image)}" target="_blank" rel="noopener"><img src="${escAttr(img.image)}" alt=""><span>Screenshot</span></a>`).join('')}</div></div>` : ''}
      ${typeof window.renderUniversalMediaReviewsButton === 'function' ? window.renderUniversalMediaReviewsButton('game', details, rawgId || getGameRawgIdValue(details)) : ''}
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

function hydrateGameMediaProfileTrailerPreview(overlay = document.getElementById('discover-media-profile')) {
  if (typeof hydrateDiscoverHeroTrailerPreview !== 'function') return;
  try { hydrateDiscoverHeroTrailerPreview(overlay); } catch (_) {}
}

async function attachGameTrailerToDetails(details = {}, rawgId = '') {
  const next = { ...(details || {}) };
  try {
    const trailer = await resolveGameMediaProfileTrailer(next, rawgId || getGameRawgIdValue(next));
    if (trailer) next.gameTrailer = trailer;
  } catch (_) {}
  return next;
}

async function resolveRawgIdForGameSeed(seed = {}) {
  const directId = getGameRawgIdValue(seed);
  if (directId) return directId;
  if (seed?.shelfdGameIdentityLock || String(seed?.source || '').toLowerCase() === 'igdb' || seed?.igdbId) {
    return '';
  }
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
  let initialSeed = getGameMediaProfileSeed(rawgId, seedOverride);
  if (typeof window !== 'undefined' && typeof window.traceShelfdGameIdentity === 'function') {
    window.traceShelfdGameIdentity('3 selected/current game media', initialSeed, { routeId: rawgId });
  }
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
    if (!resolvedId || !/^\d+$/.test(String(resolvedId))) {
      if (!document.getElementById('discover-media-profile')) return;
      const mergedGameDetails = await attachGameTrailerToDetails(await ensureScreenListIgdbCoverOnGameDetails({ ...initialSeed, rawgId: '' }), '');
      if (typeof window !== 'undefined' && typeof window.traceShelfdGameIdentity === 'function') {
        window.traceShelfdGameIdentity('4 full media profile game object', mergedGameDetails, { routeId: rawgId });
      }
      overlay.innerHTML = renderGameMediaProfileDetailsModern(mergedGameDetails, '');
      bindGameMediaProfileActions(overlay);
      hydrateGameMediaProfileTrailerPreview(overlay);
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
    let detailsInput = { ...initialSeed, ...details, rawgId: String(resolvedId) };
    if (typeof window !== 'undefined' && typeof window.mergeShelfdGameIdentityLockedItem === 'function') {
      detailsInput = window.mergeShelfdGameIdentityLockedItem(initialSeed, { ...details, rawgId: String(resolvedId) }, 'game-media-profile-rawg-details');
    }
    const mergedGameDetails = await attachGameTrailerToDetails(await ensureScreenListIgdbCoverOnGameDetails(detailsInput), String(resolvedId));
    if (typeof window !== 'undefined' && typeof window.traceShelfdGameIdentity === 'function') {
      window.traceShelfdGameIdentity('4 full media profile game object', mergedGameDetails, { routeId: rawgId, resolvedId });
    }
    overlay.innerHTML = renderGameMediaProfileDetailsModern(mergedGameDetails, String(resolvedId));
    bindGameMediaProfileActions(overlay);
    hydrateGameMediaProfileTrailerPreview(overlay);
    hydrateDeepSeekMoreLikeThis('game', mergedGameDetails);
  } catch (e) {
    console.error('Game media profile failed:', e);
    if (!document.getElementById('discover-media-profile')) return;
    const fallbackRawgId = rawgId || getGameRawgIdValue(initialSeed);
    const mergedGameDetails = await attachGameTrailerToDetails(await ensureScreenListIgdbCoverOnGameDetails({ ...initialSeed, rawgId: fallbackRawgId }), fallbackRawgId);
    overlay.innerHTML = renderGameMediaProfileDetailsModern(mergedGameDetails, fallbackRawgId);
    bindGameMediaProfileActions(overlay);
    hydrateGameMediaProfileTrailerPreview(overlay);
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

function getMyListAnimeMalId(item = {}) {
  if (typeof getScreenListAnimeMalId === 'function') return getScreenListAnimeMalId(item);
  if (typeof getAnimeMalIdFromItem === 'function') return getAnimeMalIdFromItem(item);
  const direct = item?.malId || item?.mal_id || item?.__mal_id || item?.external_ids?.mal_id || '';
  if (direct && Number(direct) > 0) return String(Number(direct));
  const url = String(item?.malUrl || item?.jikanUrl || item?.url || item?.sourceUrl || '').trim();
  const match = url.match(/myanimelist\.net\/anime\/(\d+)/i);
  return match ? match[1] : '';
}

function buildLibraryAnimeJikanSeed(item = {}, malId = '') {
  const id = String(malId || getMyListAnimeMalId(item) || '').trim();
  const title = getDisplayTitleForItem(item, 'anime') || item.title || item.name || '';
  return {
    ...item,
    id: id ? `mal:${id}` : item.id,
    title,
    name: title,
    poster: item.cover || item.poster || '',
    poster_path: item.cover || item.poster || '',
    backdrop_path: item.cover || item.poster || '',
    first_air_date: item.year ? `${item.year}-01-01` : '',
    release_date: item.year ? `${item.year}-01-01` : '',
    mediaCategory: 'anime',
    librarySection: 'anime',
    isAnime: true,
    __jikan: !!id,
    __mal_id: id,
    malId: id || item.malId || '',
    mal_id: id || item.mal_id || '',
    libraryItemId: item.id,
    librarySource: viewingUser ? 'friend' : 'own'
  };
}

function repairLibraryAnimeItemFromJikanProfile(seed = {}, details = {}) {
  const itemId = String(seed.libraryItemId || '').trim();
  if (!itemId || !details) return false;
  const source = seed.librarySource === 'friend' ? friendViewData : data;
  const list = source && Array.isArray(source.anime) ? source.anime : [];
  const item = list.find(entry => entry && String(entry.id) === itemId);
  if (!item) return false;
  const before = JSON.stringify(item);
  const fill = (key, value) => {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return;
    if (item[key] === undefined || item[key] === null || item[key] === '' || (Array.isArray(item[key]) && !item[key].length)) item[key] = value;
  };
  const malId = getMyListAnimeMalId(details) || getMyListAnimeMalId(seed);
  fill('malId', malId);
  fill('mal_id', malId);
  fill('animeIdentityKey', malId ? `mal:${malId}` : '');
  fill('malUrl', details.malUrl || details.url || (malId ? `https://myanimelist.net/anime/${malId}` : ''));
  fill('jikanUrl', details.jikanUrl || details.malUrl || details.url || '');
  fill('url', details.url || details.malUrl || '');
  fill('cover', getDiscoverMediaPoster(details) || seed.poster || '');
  fill('genre', (details.genres || []).map(g => g.name).filter(Boolean).join(', '));
  fill('genreNames', (details.genres || []).map(g => g.name).filter(Boolean));
  fill('year', String(details.year || details.first_air_date || '').slice(0, 4));
  fill('source', 'myanimelist');
  fill('mediaCategory', 'anime');
  fill('librarySection', 'anime');
  fill('originalTitle', details.title_japanese || details.original_name || details.original_title || '');
  fill('originalLanguage', 'ja');
  fill('originCountries', ['JP']);
  fill('animeType', details.animeType || details.type || '');
  fill('titleVariants', details.titleVariants || {
    english: details.title_english || details.englishTitle || details.title || details.name || item.title || '',
    romaji: details.romajiTitle || details.title || details.name || item.title || '',
    japanese: details.title_japanese || details.japaneseTitle || ''
  });
  fill('englishTitle', details.title_english || details.englishTitle || details.titleVariants?.english || '');
  fill('romajiTitle', details.romajiTitle || details.titleVariants?.romaji || details.title || details.name || '');
  fill('japaneseTitle', details.title_japanese || details.japaneseTitle || details.titleVariants?.japanese || '');
  fill('totalEpisodes', Number(details.number_of_episodes || details.totalEpisodes || 0) || '');
  fill('totalEps', Number(details.number_of_episodes || details.totalEps || 0) || '');
  fill('malMembers', details.malMembers || '');
  fill('malFavorites', details.malFavorites || '');
  fill('malScoredBy', details.malScoredBy || '');
  fill('malRank', details.malRank || '');
  fill('malPopularity', details.malPopularity || '');
  fill('animeSeasonRelationCount', details.animeSeasonRelationCount || 0);
  fill('animeSeasonGrouping', details.animeSeasonGrouping || 'separate');
  fill('animeSeasonGroupingReliable', details.animeSeasonGroupingReliable === true);
  item.isAnime = true;
  const changed = JSON.stringify(item) !== before;
  if (changed && source === data && currentUser && !viewingUser) {
    writeOwnDataDirect(data).catch(error => console.warn('Anime profile repair save failed:', error));
  }
  return changed;
}
window.repairLibraryAnimeItemFromJikanProfile = repairLibraryAnimeItemFromJikanProfile;

async function hydrateLibraryAnimeIdentityForProfile(item = {}) {
  if (!item || typeof item !== 'object') return '';
  let malId = getMyListAnimeMalId(item);
  if (malId) return malId;
  if (!window.JikanAnime?.animeByIdentity) return '';
  const j = await window.JikanAnime.animeByIdentity(item);
  if (!j?.mal_id) return '';
  if (typeof applyJikanCanonicalAnimeFields === 'function') {
    applyJikanCanonicalAnimeFields(item, j);
  } else {
    item.malId = String(j.mal_id);
    item.mal_id = String(j.mal_id);
    item.malUrl = j.url || `https://myanimelist.net/anime/${j.mal_id}`;
    item.source = item.source || 'myanimelist';
  }
  if (!viewingUser && currentUser) {
    try { await writeOwnDataDirect(data); } catch (error) { console.warn('Anime identity hydration save failed:', error); }
  }
  return String(j.mal_id);
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
  if (section === 'anime') {
    let malId = getMyListAnimeMalId(item);
    if (!malId) {
      try { malId = await hydrateLibraryAnimeIdentityForProfile(item); }
      catch (error) { console.warn('Anime profile identity hydration failed:', error); }
    }
    if (malId && typeof window.openJikanAnimeProfile === 'function') {
      setDiscoverMediaProfileSeed('tv', `mal:${malId}`, buildLibraryAnimeJikanSeed(item, malId));
      return window.openJikanAnimeProfile(event, malId);
    }
  }

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

/* v10.418: actionable post-add popup used after the user adds an item to
   their library FROM Universal Search. Instead of auto-navigating them
   to the My List page (which interrupts the "search → add a bunch" flow
   most users actually want), we leave the search overlay open and float
   a "Go to Shelf" popup over it. The popup auto-fades after 3.3s; if the
   user taps it, we close search + route them straight to the item they
   just added (album page for music, game profile for games, the section
   tab otherwise). */
function isShelfdUniversalSearchOpen() {
  const page = document.getElementById('shelfd-search-page');
  return !!(page && page.classList.contains('is-open'));
}
window.isShelfdUniversalSearchOpen = isShelfdUniversalSearchOpen;

function showShelfdGoToShelfPopup(options = {}) {
  const section = String(options.section || 'music').trim();
  const status = String(options.status || 'watched').trim();
  const itemId = String(options.itemId || '').trim();
  const title = String(options.title || '').trim();
  const messageText = options.message || 'Added to your shelf';

  const existing = document.querySelector('.shelfd-go-to-shelf-popup');
  if (existing) existing.remove();

  const popup = document.createElement('div');
  popup.className = 'shelfd-go-to-shelf-popup';
  popup.setAttribute('role', 'status');
  popup.setAttribute('aria-live', 'polite');
  popup.innerHTML = `
    <span class="shelfd-go-to-shelf-popup-text">${escHtml(messageText)}</span>
    <button type="button" class="shelfd-go-to-shelf-popup-action" data-shelfd-popup-action>Go to Shelf</button>
  `;
  document.body.appendChild(popup);

  let dismissed = false;
  let dismissTimer = null;

  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
    popup.classList.remove('is-open');
    setTimeout(() => { try { popup.remove(); } catch (_) {} }, 260);
  };

  const navigate = () => {
    if (dismissed) return;
    dismissed = true;
    if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
    try { popup.remove(); } catch (_) {}
    /* Close the Universal Search overlay first so the My List page
       beneath is the surface we navigate on. */
    try { if (typeof window.closeSearchPage === 'function') window.closeSearchPage(); } catch (_) {}
    try { if (typeof window.switchMainNav === 'function') window.switchMainNav('mylist'); } catch (_) {}
    try { if (typeof window.switchSection === 'function') window.switchSection(section); } catch (_) {}
    try { if (typeof window.switchTab === 'function') window.switchTab(status); } catch (_) {}
    try { if (typeof window.render === 'function') window.render(); } catch (_) {}
    /* Section-specific deep-link to the exact item the user just added.
       Music has a dedicated album page; games have a profile page. For
       shows/movies/anime we land on the correct section + status tab,
       where the freshly-added card is in the user's list. */
    if (itemId) {
      if (section === 'music' && typeof window.openMyListAlbumPage === 'function') {
        try { window.openMyListAlbumPage(itemId); } catch (_) {}
      } else if (section === 'games' && typeof window.openMyListGameProfilePage === 'function') {
        try { window.openMyListGameProfilePage(itemId); } catch (_) {}
      }
    }
  };

  const actionBtn = popup.querySelector('[data-shelfd-popup-action]');
  if (actionBtn) actionBtn.addEventListener('click', navigate);

  requestAnimationFrame(() => popup.classList.add('is-open'));
  /* User-specified: 3.3 seconds on screen before auto-fade. */
  dismissTimer = setTimeout(dismiss, 3300);
  return { dismiss, navigate };
}
window.showShelfdGoToShelfPopup = showShelfdGoToShelfPopup;

/* v10.761: showDmE2eeMissingKeyWarningToast + showDmE2eeOwnKeyRequiredToast
   removed. Both used the empty-string constants DM_E2EE_MISSING_KEY_TOAST /
   DM_E2EE_OWN_KEY_TOAST from 02-messages-e2ee.js (also removed in v10.761).
   Neither function was called from anywhere — pure dead code from the
   v280 E2EE rip. */

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
  // v10.61: cancel any pending debounced onSearch commit so we don't race
  // a stale value back into searchQuery after a programmatic clear.
  if (_onSearchDebounceTimer) {
    clearTimeout(_onSearchDebounceTimer);
    _onSearchDebounceTimer = null;
  }
  _onSearchPendingValue = "";
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
    /* v10.241: tag <body> with the active section so CSS can hide the status
       toolbar and other per-section chrome (e.g. music has no statuses). */
    try {
      ['movies','shows','anime','games','manga','books','music'].forEach(sec => {
        document.body.classList.toggle('mylist-section-' + sec, sec === s);
      });
    } catch (_) {}
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
  const rawgId = String(payload.rawgId || (/^\d+$/.test(String(payload.id || '')) ? payload.id : '') || '').trim();
  const profileKey = String(payload.gameIdentityKey || payload.id || rawgId || '').trim();
  if ((profileKey || rawgId) && typeof setGameMediaProfileSeed === 'function') {
    const seedKey = profileKey || rawgId;
    const existing = getGameMediaProfileSeed(seedKey, {}) || {};
    let updated = { ...existing, ...payload, rawgId, igdbCoverUrl: cover.coverUrl, cover: cover.coverUrl, poster: cover.coverUrl, image: cover.coverUrl, background_image: cover.coverUrl };
    if (typeof window !== 'undefined' && typeof window.mergeShelfdGameIdentityLockedItem === 'function') {
      updated = window.mergeShelfdGameIdentityLockedItem(existing, updated, 'force-hydrate-game-poster');
    }
    setGameMediaProfileSeed(seedKey, updated);
    if (rawgId && rawgId !== seedKey) setGameMediaProfileSeed(rawgId, updated);
  }
  return cover;
}
async function ensureScreenListIgdbCoverOnGameDetails(details = {}) {
  const cover = await fetchScreenListIgdbCoverForGame(details);
  if (cover?.coverUrl && isScreenListIgdbCoverUrl(cover.coverUrl)) {
    applyScreenListIgdbCoverToGameItem(details, cover);
    const rawgId = String(details.rawgId || (/^\d+$/.test(String(details.id || '')) ? details.id : '') || '').trim();
    const profileKey = String(details.gameIdentityKey || details.id || rawgId || '').trim();
    if (profileKey || rawgId) {
      const seedKey = profileKey || rawgId;
      const existing = getGameMediaProfileSeed(seedKey, {}) || {};
      let updated = { ...existing, ...details, rawgId };
      if (typeof window !== 'undefined' && typeof window.mergeShelfdGameIdentityLockedItem === 'function') {
        updated = window.mergeShelfdGameIdentityLockedItem(existing, updated, 'ensure-igdb-cover-on-game-details');
      }
      setGameMediaProfileSeed(seedKey, updated);
      if (rawgId && rawgId !== seedKey) setGameMediaProfileSeed(rawgId, updated);
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
/* v10.61: search input was firing a full My Lists grid re-render on every
   keystroke (`oninput="onSearch(this.value)"` in index.html). On a large
   library this is a 100KB+ HTML rebuild + reflow per character, which is
   the dominant cause of caret lag while typing in the library search box.

   Fix:
   - During typing, debounce by 160ms — only the LAST keystroke in a burst
     triggers `render()`. The pending query string is still tracked, so the
     UI never goes out of sync.
   - On blur, on clear (X button or empty value), and from `clearListSearch`,
     flush immediately so closing the search bar feels instant.
   - Calling `onSearch('')` (empty value) also flushes immediately so the
     "clear search" path is not delayed.
*/
const ONSEARCH_DEBOUNCE_MS = 160;
let _onSearchDebounceTimer = null;
let _onSearchPendingValue = '';

function _commitOnSearchValue() {
  if (_onSearchDebounceTimer) {
    clearTimeout(_onSearchDebounceTimer);
    _onSearchDebounceTimer = null;
  }
  if (typeof clearLastEditedResortHold === 'function') clearLastEditedResortHold();
  searchQuery = _onSearchPendingValue;
  render();
}

function onSearch(q) {
  _onSearchPendingValue = q;
  // Empty/clear → flush immediately. Closing or clearing the search bar
  // should not feel delayed.
  if (!q) {
    _commitOnSearchValue();
    return;
  }
  if (_onSearchDebounceTimer) clearTimeout(_onSearchDebounceTimer);
  _onSearchDebounceTimer = setTimeout(_commitOnSearchValue, ONSEARCH_DEBOUNCE_MS);
}

function onSearchFlush() {
  // Called from `onblur` on the search input — commit immediately on blur.
  if (_onSearchDebounceTimer) _commitOnSearchValue();
}

if (typeof window !== 'undefined') {
  window.onSearch = onSearch;
  window.onSearchFlush = onSearchFlush;
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
  if (isMyListEpisodePageOpen(id)) rerenderMyListEpisodePage();
  return item;
}

function changeStatus(id, status) {
  const record = findOwnLibraryItemRecord(id, activeSection);
  const item = record.item;
  if (!item || !record.section) return;
  const validStatuses = getMyListStatusButtonConfigs(record.section).map(entry => entry.status);
  if (!validStatuses.includes(status)) return;
  const wasCompleted = item.status === "watched";
  /* v10.704: removed the legacy completion-rating modal entirely
     (`openScreenListCompletionRatingPrompt`). When a user moves an item
     to a completed status (Watched / Played / Listened — all share the
     `watched` enum), commit the status change first, then instantly
     route them to the full-page Shelf Log composer — the same "write
     a review" page that opens when tapping the "+" comment button on
     a card already in the Watched tab. Captures rating + date + review
     text + tags + flags in one cohesive page instead of the cramped
     legacy star-prompt overlay. */
  applyMyListStatusChange(id, status, null, record.section);
  if (status === "watched" && !wasCompleted) {
    try {
      if (typeof openShelfLogComposer === 'function') {
        openShelfLogComposer(id, record.section);
      }
    } catch (e) {
      console.warn('[v10.704] openShelfLogComposer after status change failed:', e);
    }
  }
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

/* v10.69: partial DOM update for the overall (title-level) rating stars.
   Mirrors the pattern of updateSeasonRatingUI below — re-builds JUST the
   `<div class="stars">` block for prefix="overall" and replaces it in place.
   Lets `rate()` skip a full grid render when only the card's own rating
   changed. */
function updateOverallRatingUI(item = {}, section = activeSection) {
  if (!item || !item.id) return;
  /* v10.404: rating BUBBLE on the title card (used by shows/anime/music
     in the watching/watched/paused statuses). Re-render every bubble
     matching this item id so the chip's number label + each star's lit
     state reflect the new rating. We do this BEFORE the section-specific
     branches because a single item can have only ONE rating bubble on
     the title card; everything else (FP review, album shelf, etc.) is
     handled by the .stars / .music-rating branches below. */
  if (typeof buildRatingBubbleMarkup === 'function') {
    const idStr = String(item.id);
    const bubbleNodes = document.querySelectorAll(`.rating-bubble[data-item-id="${CSS.escape(idStr)}"]`);
    const newRating = Number(item.rating || 0);
    bubbleNodes.forEach(node => {
      const cardSection = node.dataset.section || section;
      /* v10.508: preserve the /5 display mode across rebuild. The album-
         shelf "Your rating" bubble carries `data-out-of-five="1"`; we
         pass that through so the re-rendered chip continues to show
         "X/5" instead of falling back to the section default.
         v10.516: when the bubble is EXPANDED (mid-rate-gesture), update
         in-place instead of replaceWith. Tearing down the DOM via
         replaceWith on an expanded bubble destroys any in-flight
         `.star-pop` animation queued by `playRatingAnimation` — that
         was the root cause of the "sometimes the rating bubble's pop
         animation doesn't fire" bug. The post-rate pop animation
         needs the slot elements to persist for ~600ms after the rate
         commits; in-place updates preserve them. Collapsed bubbles
         still use the full replace path since no animation is in
         flight on them. */
      const hasSlotStructure = !!node.querySelector('.rating-bubble-star-slot');
      if (node.classList.contains('is-expanded') && hasSlotStructure) {
        const slots = node.querySelectorAll('.rating-bubble-star-slot');
        slots.forEach((slot, idx) => {
          const starIdx = idx + 1;
          const leftV = starIdx * 2 - 1;
          const rightV = starIdx * 2;
          let pct = 0;
          if (newRating >= rightV) pct = 100;
          else if (newRating >= leftV) pct = 50;
          slot.style.setProperty('--star-fill', `${pct}%`);
        });
        /* Sync the collapsed chip value text + is-rated class so when
           the bubble auto-collapses 700ms later it reflects the new
           rating without another rebuild. */
        const isOutOfFive = node.dataset.outOfFive === '1';
        let labelText = '';
        if (newRating > 0) {
          const fiveValue = newRating / 2;
          const formatted = fiveValue % 1 === 0 ? String(fiveValue) : fiveValue.toFixed(1);
          labelText = isOutOfFive ? `${formatted}/5` : formatted;
        }
        const chipValue = node.querySelector('.rating-bubble-chip-value');
        if (labelText) {
          if (chipValue) {
            chipValue.textContent = labelText;
          } else {
            const icon = node.querySelector('.rating-bubble-chip-icon');
            if (icon) {
              const span = document.createElement('span');
              span.className = 'rating-bubble-chip-value';
              span.textContent = labelText;
              icon.insertAdjacentElement('afterend', span);
            }
          }
        } else if (chipValue) {
          chipValue.remove();
        }
        node.classList.toggle('is-rated', newRating > 0);
        return;
      }
      const opts = node.dataset.outOfFive === '1' ? { outOfFive: true } : undefined;
      const tmp = document.createElement('div');
      tmp.innerHTML = buildRatingBubbleMarkup(item, cardSection, opts);
      const replacement = tmp.firstElementChild;
      if (replacement) node.replaceWith(replacement);
    });
  }
  if (section === 'music') {
    if (typeof buildMusicRatingMarkup !== 'function') return;
    const idStr = String(item.id);
    const currentRating = Number(item.rating || 0);
    document.querySelectorAll('.music-rating[data-item-id][data-prefix="overall"]').forEach(node => {
      if (node.dataset.itemId !== idStr) return;
      /* Preserve each existing widget's size — the title card uses 20px,
         the album shelf page uses ~26px. Read the size off the inline
         CSS variable on the existing container. */
      const styleStr = node.getAttribute('style') || '';
      const m = styleStr.match(/--music-star-size:\s*(\d+(?:\.\d+)?)px/);
      const size = m ? Number(m[1]) : 20;
      const tmp = document.createElement('div');
      tmp.innerHTML = buildMusicRatingMarkup(currentRating, item.id, 'overall', size, !viewingUser);
      const replacement = tmp.firstElementChild;
      if (replacement) node.replaceWith(replacement);
    });
    return;
  }
  if (typeof buildRatingStarsMarkup !== 'function') return;
  const tmp = document.createElement('div');
  tmp.innerHTML = buildRatingStarsMarkup(Number(item.rating || 0), item.id, 'overall', 16, section, !viewingUser);
  const replacement = tmp.firstElementChild;
  if (!replacement) return;
  document.querySelectorAll('.stars[data-item-id][data-prefix="overall"]').forEach(node => {
    if (node.dataset.itemId === String(item.id)) {
      node.replaceWith(replacement.cloneNode(true));
    }
  });
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
  if (seasonBlock?.closest('#mylist-episode-page-overlay')) return;
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
  const priorityStatus = section === 'games' ? 'wishlist' : 'planned';
  const plannedItems = (Array.isArray(data?.[section]) ? data[section] : [])
    .filter(item => item && String(item.status || '') === priorityStatus);
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

function normalizeShelfRatingValue(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(0, Math.min(10, n));
}

function captureShelfRatingChange(item = {}, section = activeSection, change = {}) {
  if (!item || typeof item !== 'object') return;
  const now = new Date().toISOString();
  item.shelfdLastRatingChangeAt = now;
  item.shelfdLastRatingChange = {
    section: String(section || ''),
    prefix: String(change.prefix || ''),
    kind: String(change.kind || ''),
    previousRating: normalizeShelfRatingValue(change.previousRating),
    rating: normalizeShelfRatingValue(change.rating),
    cleared: change.cleared === true,
    changedAt: now
  };
  if (change.seasonNum !== undefined && change.seasonNum !== null && String(change.seasonNum).trim()) {
    item.shelfdLastRatingChange.seasonNum = String(change.seasonNum);
  }
  if (change.episodeId !== undefined && change.episodeId !== null && String(change.episodeId).trim()) {
    item.shelfdLastRatingChange.episodeId = String(change.episodeId);
  }
}

function rate(itemId, prefix, score) {
  // Debounce: ignore identical rate within 350ms (prevents touch+click double-fire from toggling off)
  score = normalizeShelfRatingValue(score);
  if (!score) return;
  const key = itemId + '|' + prefix + '|' + score;
  const now = Date.now();
  if (_lastRate.key === key && now - _lastRate.time < 350) return;
  _lastRate = { key, time: now };

  const record = getMyListEpisodeInteractionContext(itemId, activeSection);
  const item = record.item;
  if (!item) return;
  const section = record.section || activeSection;

  // Capture the pre-change rating so we can classify first-time vs edit below.
  const prevOverallRating = prefix === 'overall' ? Number(item.rating || 0) : null;
  let prevSeasonRating = null;
  let prevEpisodeRating = null;
  let inlineSeasonRatingNum = '';

  if (prefix === "overall") {
    item.rating = prevOverallRating === score ? 0 : score;
  } else if (prefix.startsWith("season:")) {
    const sNum = parseInt(prefix.slice(7));
    if (!item.seasonRatings) item.seasonRatings = {};
    prevSeasonRating = Number(item.seasonRatings[sNum] || 0);
    item.seasonRatings[sNum] = (prevSeasonRating === score) ? 0 : score;
    inlineSeasonRatingNum = String(sNum);
  } else if (prefix.startsWith("ep:")) {
    const epId = prefix.slice(3);
    const ep = (item.episodes || []).find(e => e.id === epId);
    prevEpisodeRating = ep ? Number(ep.rating || 0) : 0;
    if (ep) ep.rating = prevEpisodeRating === score ? 0 : score;
    /* v557: track the most recent episode rating on the item so the
       activity feed's merged "watched + rated" card shows
       "EP rated ★ {value}" rather than the show's rating. Mirrors the
       tracking that rateEpPopup writes. */
  }

  const newOverallRating = prefix === 'overall' ? Number(item.rating || 0) : null;
  const seasonRatingKey = prefix.startsWith("season:") ? parseInt(prefix.slice(7), 10) : null;
  const newSeasonRating = prefix.startsWith("season:")
    ? Number(item.seasonRatings?.[seasonRatingKey] || 0)
    : null;
  const episodeRatingKey = prefix.startsWith("ep:") ? prefix.slice(3) : '';
  const newEpisodeRating = prefix.startsWith("ep:")
    ? Number(((item.episodes || []).find(e => e.id === episodeRatingKey) || {}).rating || 0)
    : null;
  const isFirstTimeRating = prefix === 'overall' && prevOverallRating === 0 && newOverallRating > 0;
  const isRatingEdit = prefix === 'overall' && prevOverallRating > 0 && prevOverallRating !== newOverallRating;
  const isFirstTimeSeasonRating = prefix.startsWith("season:") && prevSeasonRating === 0 && newSeasonRating > 0;
  const isExistingSeasonRatingChange = prefix.startsWith("season:") && prevSeasonRating > 0 && prevSeasonRating !== newSeasonRating;
  const isFirstTimeEpisodeRating = prefix.startsWith("ep:") && prevEpisodeRating === 0 && newEpisodeRating > 0;
  const isExistingEpisodeRatingChange = prefix.startsWith("ep:") && prevEpisodeRating > 0 && prevEpisodeRating !== newEpisodeRating;
  const shouldEmitPublicRatingActivity = isFirstTimeRating || isFirstTimeSeasonRating || isFirstTimeEpisodeRating;
  const shouldKeepRatingChangePrivate = isRatingEdit || isExistingSeasonRatingChange || isExistingEpisodeRatingChange;
  const ratingKind = prefix === 'overall' ? 'overall' : prefix.startsWith('season:') ? 'season' : prefix.startsWith('ep:') ? 'episode' : '';
  const previousRating = prefix === 'overall'
    ? prevOverallRating
    : prefix.startsWith('season:')
      ? prevSeasonRating
      : prefix.startsWith('ep:')
        ? prevEpisodeRating
        : 0;
  const newRating = prefix === 'overall'
    ? newOverallRating
    : prefix.startsWith('season:')
      ? newSeasonRating
      : prefix.startsWith('ep:')
        ? newEpisodeRating
        : 0;
  if (previousRating !== newRating) {
    captureShelfRatingChange(item, section, {
      prefix,
      kind: ratingKind,
      previousRating,
      rating: newRating,
      cleared: previousRating > 0 && newRating === 0,
      seasonNum: seasonRatingKey,
      episodeId: episodeRatingKey
    });
  }

  if (isFirstTimeRating) {
    item.lastShowRatingAt = new Date().toISOString();
  } else if (isFirstTimeSeasonRating) {
    item.lastSeasonRatingValue = Number(item.seasonRatings?.[seasonRatingKey] || 0);
    item.lastSeasonRatingNum = String(seasonRatingKey);
    item.lastSeasonRatingAt = new Date().toISOString();
  } else if (isFirstTimeEpisodeRating) {
    const ep = (item.episodes || []).find(e => e.id === episodeRatingKey);
    item.lastEpisodeRatingValue = Number(ep?.rating || 0);
    item.lastEpisodeRatingAt = new Date().toISOString();
    item.lastEpisodeRatingEpId = String(episodeRatingKey || '');
  }
  if (prefix.startsWith("season:") && newSeasonRating === 0 && String(item.lastSeasonRatingNum || '') === String(seasonRatingKey || '')) {
    item.lastSeasonRatingValue = 0;
  }
  if (prefix.startsWith("ep:") && newEpisodeRating === 0 && String(item.lastEpisodeRatingEpId || '') === String(episodeRatingKey || '')) {
    item.lastEpisodeRatingValue = 0;
  }

  if (shouldEmitPublicRatingActivity) {
    // First-time: normal edit tracking — updates dateModified so activity fires.
    item.shelfdRatingFirstSetAt = item.shelfdRatingFirstSetAt || new Date().toISOString();
    if (typeof markOwnItemLastEdited === 'function') markOwnItemLastEdited(item, section);
    else touchItem(item);
  } else if (shouldKeepRatingChangePrivate) {
    // Edit existing rating: update lastEditedAt only — do NOT touch dateModified.
    _shelfdMarkRatingEdit(item, section);
  } else {
    // Season/episode sub-rating or toggle-to-zero: behave like an edit (no new activity).
    if (typeof markOwnItemLastEdited === 'function') markOwnItemLastEdited(item, section);
    else touchItem(item);
  }

  persistMyListEpisodeEdit(item, section, { markEdited: false });
  /* v10.448: for music section overall ratings, ALSO write to the
     per-album community-ratings collection so cross-user aggregation
     reflects this change. The album-shelf page module exposes the
     persist function at `window.persistAlbumRatingToCommunityDoc`
     (defined in 27-music-album-shelf-page.js). After write, kick
     a fetch-and-patch so any currently-open shelf page repaints
     with the fresh count + average. Tolerates non-music sections
     and non-overall prefixes by gating on both. */
  if (section === 'music' && prefix === 'overall'
      && typeof window.persistAlbumRatingToCommunityDoc === 'function') {
    try {
      window.persistAlbumRatingToCommunityDoc(item, Number(item.rating || 0)).then(() => {
        if (typeof window.fetchAndPatchAlbumCommunityRating === 'function') {
          window.fetchAndPatchAlbumCommunityRating(item, { force: true });
        }
      }).catch(() => {});
    } catch (_) { /* non-fatal */ }
  }
  /* v10.69: partial DOM update for overall + season + episode rating instead
     of a full grid render. Season already had `updateSeasonRatingUI`; we now
     do the same for the title's overall stars. Episode rating (prefix `ep:`)
     only changes a star in the episode list itself, which is unrendered when
     the dropdown is closed — so we just update the row's data and skip the
     full render. `lastEditedAt` is still updated (see above), so on the next
     real render() the card resorts correctly under Last-Edited sort. */
  if (inlineSeasonRatingNum) {
    updateSeasonRatingUI(item, inlineSeasonRatingNum, section);
    if (isMyListEpisodePageOpen(itemId)) rerenderMyListEpisodePage();
  } else if (prefix === 'overall') {
    updateOverallRatingUI(item, section);
    if (isMyListEpisodePageOpen(itemId)) rerenderMyListEpisodePage();
  } else if (prefix.startsWith('ep:')) {
    // The episode rating is rendered inside the (possibly-closed) episode list.
    // If the list is currently open and hydrated, the star row will repaint on
    // its next interaction; for a closed list, the star value lives only in
    // data and renders fresh next time the user opens the dropdown.
  } else {
    render();
  }
  if (newRating > 0) playRatingAnimation(itemId, prefix);

  // v442: defer the "Rating updated privately" toast until AFTER the star animation
  // finishes. The toast was previously appended synchronously, which forced a paint
  // / reflow at the same instant playRatingAnimation queued its first frame and
  // visibly hitched the star animation on mobile/PWA. We now wait long enough for
  // the longest possible per-star animation to complete (stagger * (N-1) + duration
  // ≈ 9 * 70 + 620 = ~1.25s upper bound; we cap at ~900ms because the visible
  // intensity peak lands well before the final tail). Toast is canceled if the user
  // immediately edits again — showRatingEditPrivateToast already removes the prior
  // toast/timer in that case.
  if (isRatingEdit && newOverallRating > 0) {
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
  const record = getMyListEpisodeInteractionContext(itemId, activeSection);
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
    /* v10.395: pick up `.music-rating` containers alongside the legacy
       `.stars` family.
       v10.400: each star in `.music-rating` is composed of TWO
       `.music-rating-half` boxes (left + right halves of one ★ glyph).
       Animating each half independently with a per-element stagger
       made adjacent halves pop at different times AND scale from their
       own centers, pulling apart and exposing inner tips. The fix:
       group lit halves into PAIRS (star units) and apply identical
       timing to both halves of a star. Combined with the CSS
       transform-origin on each half (left half: right center, right
       half: left center — both anchor at the shared boundary), each
       star now scales outward from its true center as one shape. */
    /* v10.404: rating bubble widget is also a container we paint into. */
    const containers = document.querySelectorAll('.stars, .music-rating, .rating-bubble');
    containers.forEach(c => {
      if (c.dataset.itemId !== itemId || c.dataset.prefix !== prefix) return;
      const isMusicWidget = c.classList.contains('music-rating');
      /* v10.407: music widget can now render either half-step (5×2) or
         10-star integer. Only the half-step variant needs pair-grouping
         for the unified star-pop animation. */
      const isHalfStepMusicWidget = isMusicWidget && (
        c.classList.contains('music-rating--halfstep')
        /* Pre-v10.407 widgets without the variant class are always
           half-step (legacy). */
        || (!c.classList.contains('music-rating--ten') && !c.classList.contains('music-rating--halfstep'))
      );
      const isBubble = c.classList.contains('rating-bubble');
      /* v10.407: half-step bubble = `.rating-bubble--halfstep` (the new
         scale-driven class) or the legacy `.rating-bubble--music` alias. */
      const isHalfStepBubble = isBubble && (
        c.classList.contains('rating-bubble--halfstep')
        || c.classList.contains('rating-bubble--music')
      );
      /* v10.515: detect the new v10.510 slot structure (per-star
         `.rating-bubble-star-slot` containers wrapping a base + a
         fill). When present, each lit slot is ONE animation unit —
         the target is the fill child (the gold star glyph). This
         restores the star-pop scale + glow effect on the rebuilt
         rating bubble that was lost when the markup switched away
         from `.rating-bubble-star.lit` pairs. */
      const hasSlotStructure = isBubble && !!c.querySelector('.rating-bubble-star-slot');
      let units;
      if (hasSlotStructure) {
        units = [];
        c.querySelectorAll('.rating-bubble-star-slot').forEach(slot => {
          const fillPct = parseFloat(slot.style.getPropertyValue('--star-fill')) || 0;
          if (fillPct > 0) {
            const fill = slot.querySelector('.rating-bubble-star-fill');
            if (fill) units.push([fill]);
          }
        });
      } else {
        /* v10.407: pick up the new 10-star music widget too (.music-rating-full). */
        const lit = [...c.querySelectorAll('.star-btn.lit, .music-rating-half.lit, .music-rating-full.lit, .rating-bubble-star.lit')];

        /* Build the per-unit animation groups. For half-step variants of
           the music widget: each unit is a pair of adjacent lit halves
           (one star). For everything else (10-star music widget,
           integer rating bubble, .star-btn family): each unit is a
           single element. */
        const groupAsPairs = isHalfStepMusicWidget || isHalfStepBubble;
        units = [];
        if (groupAsPairs) {
          for (let i = 0; i < lit.length; i += 2) {
            const pair = [lit[i]];
            if (lit[i + 1]) pair.push(lit[i + 1]);
            units.push(pair);
          }
        } else {
          lit.forEach(el => units.push([el]));
        }
      }

      // CSS class animation — reliable on all browsers including mobile/PWA
      units.forEach((group, unitIdx) => {
        group.forEach(star => {
          star.classList.remove('star-pop');
          void star.offsetWidth; // force reflow to restart animation
        });
        const delay = unitIdx * stagger;
        setTimeout(() => group.forEach(star => star.classList.add('star-pop')), delay);
        setTimeout(() => group.forEach(star => star.classList.remove('star-pop')), delay + 500);
      });

      const label = c.querySelector('.star-label, .music-rating-value');
      if (label) {
        label.classList.remove('label-pop');
        void label.offsetWidth;
        setTimeout(() => { label.classList.add('label-pop'); setTimeout(() => label.classList.remove('label-pop'), 520); }, 100);
      }

      // Web Animations API for intensity-scaled glow (progressive enhancement).
      // Same per-unit timing rule so both halves of a music star share
      // the exact same `delay` and keyframe schedule.
      if (typeof Element.prototype.animate === 'function') {
        units.forEach((group, unitIdx) => {
          const delay = unitIdx * stagger;
          group.forEach(star => {
            star.animate([
              { transform: 'scale(1)', filter: 'none' },
              { transform: `scale(${peakScale})`, filter: peakFilter, offset: 0.3 },
              { transform: `scale(${midScale})`, filter: 'none', offset: 0.6 },
              { transform: 'scale(1)', filter: 'none' }
            ], { duration, delay, easing: 'ease-out', fill: 'none' });
          });
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
  /* v10.401: tighter scrub thresholds — 18px lock-in (was 10) and
     midpoint cross-over (was left-edge). See musicRatingTouchMove for
     the matching change on the music widget. Keeps every star/half-step
     dwellable so half-ratings don't get skipped by a small finger
     movement. */
  if (c.dataset.scrubbing !== 'true') {
    if (dx < 18 || dy > dx) return;
  }
  c.dataset.scrubbing = 'true';
  e.preventDefault();
  const stars = [...c.querySelectorAll('.star-btn')];
  let val = 0;
  stars.forEach((btn, i) => {
    const rect = btn.getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    if (touch.clientX >= midpoint) val = i + 1;
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
  return !!(list && list.classList.contains('open') && !list.closest('#mylist-episode-page-overlay'));
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
  if (activeSection === 'shows' || activeSection === 'anime') {
    openMyListEpisodePage(id);
    return;
  }
  const list = document.getElementById('ep-list-' + id);
  const arrow = document.getElementById('ep-arrow-' + id);
  const label = document.getElementById('ep-label-' + id);
  if (!list) return;
  const open = list.classList.contains('open');
  /* v10.69: lazy hydration. If this is the FIRST open of a dropdown that
     started empty (placeholder rendered with `data-ep-pending="1"`), build
     the actual inner content NOW — before setEpisodesExpanded reads
     scrollHeight for its open animation. Once hydrated we clear the flag so
     subsequent toggles skip rebuilding. */
  if (!open && list.dataset.epPending === '1') {
    const inner = list.querySelector('.ep-list-inner');
    const item = (data[activeSection] || []).find(i => i && i.id === id);
    if (item && inner) {
      inner.innerHTML = buildEpisodeListInnerHtml(item);
      delete list.dataset.epPending;
    }
  }
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
  const scrollEl = getEpisodeInteractionScrollContainer(itemId);
  const scrollTop = scrollEl ? scrollEl.scrollTop : 0;
  action();
  requestAnimationFrame(() => {
    const nextScrollEl = getEpisodeInteractionScrollContainer(itemId);
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
  /* v10.261: music search spans both Listened + Planned tabs and matches
     title OR artist. Empty query stays bound to the active tab. */
  if (activeSection === 'music' && searchQuery) {
    const q = String(searchQuery).toLowerCase();
    return String(item?.title || '').toLowerCase().includes(q)
        || String(item?.artist || '').toLowerCase().includes(q);
  }
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
  const countId = `progress-count-${item.id}`;
  const percentId = `progress-percent-${item.id}`;
  const fillId = `progress-fill-${item.id}`;
  document.querySelectorAll(`[id="${CSS.escape(countId)}"]`).forEach(node => {
    node.textContent = `${progress.watched}/${progress.total} episodes`;
  });
  document.querySelectorAll(`[id="${CSS.escape(percentId)}"]`).forEach(node => {
    const showPercent = Number(progress.total || 0) > 0;
    node.textContent = showPercent ? `${progress.percent}%` : '';
    node.hidden = !showPercent;
  });
  document.querySelectorAll(`[id="${CSS.escape(fillId)}"]`).forEach(node => {
    node.style.width = `${progress.percent}%`;
  });
}

function updateSeasonProgressUI(item, seasonNum) {
  if (!seasonNum) return;
  const seasonEpisodes = (item.episodes || []).filter(e => e.seasonNum === seasonNum);
  const seasonProgressEl = document.getElementById(`season-progress-${item.id}-${seasonNum}`);
  if (!seasonProgressEl) return;
  const watched = seasonEpisodes.filter(e => e.watched).length;
  seasonProgressEl.textContent = seasonProgressEl.closest('#mylist-episode-page-overlay')
    ? `${watched}/${seasonEpisodes.length} watched`
    : `(${watched}/${seasonEpisodes.length})`;
}

function updateStatusPillsUI(item) {
  const statusPills = document.querySelectorAll(`#status-pills-${item.id} .status-pill`);
  statusPills.forEach(btn => {
    const isActive = btn.dataset.status === item.status;
    ['live-active', 'competitive-active', 'watching-active', 'planned-active', 'watched-active', 'paused-active', 'dropped-active', 'wishlist-active']
      .forEach(cls => btn.classList.remove(cls));
    if (isActive) btn.classList.add(`${item.status}-active`);
  });
  updateMyListEpisodePageStatusUI(item, item.librarySection || item.mediaCategory || activeSection);
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
    const isEpisodePage = !!row.closest('#mylist-episode-page-overlay');
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

    const fillFrames = isEpisodePage
      ? [
          { clipPath: 'inset(0 99% 0 0 round 4px)' },
          { clipPath: 'inset(0 90% 0 0 round 4px)', offset: 0.14 },
          { clipPath: 'inset(0 74% 0 0 round 4px)', offset: 0.3 },
          { clipPath: 'inset(0 55% 0 0 round 4px)', offset: 0.48 },
          { clipPath: 'inset(0 34% 0 0 round 4px)', offset: 0.66 },
          { clipPath: 'inset(0 16% 0 0 round 4px)', offset: 0.82 },
          { clipPath: 'inset(0 4% 0 0 round 4px)', offset: 0.94 },
          { clipPath: 'inset(0 0 0 0 round 4px)' }
        ]
      : [
          { clipPath: 'inset(0 99% 0 0 round 4px)' },
          { clipPath: 'inset(0 84% 0 0 round 4px)', offset: 0.16 },
          { clipPath: 'inset(0 66% 0 0 round 4px)', offset: 0.32 },
          { clipPath: 'inset(0 48% 0 0 round 4px)', offset: 0.48 },
          { clipPath: 'inset(0 29% 0 0 round 4px)', offset: 0.64 },
          { clipPath: 'inset(0 12% 0 0 round 4px)', offset: 0.8 },
          { clipPath: 'inset(0 3% 0 0 round 4px)', offset: 0.92 },
          { clipPath: 'inset(0 0 0 0 round 4px)' }
        ];
    const fillAnim = fillLayer.animate(fillFrames, {
      duration: isEpisodePage ? 1280 : 1120,
      easing: isEpisodePage ? 'cubic-bezier(0.2, 0.82, 0.2, 1)' : 'linear',
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
  if (viewingUser) return;
  const context = getMyListEpisodeInteractionContext(itemId);
  const item = context.item;
  const section = context.section || activeSection;
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
      markEpisodeWatchActivity(item, section, {
        count: 1,
        label: ep.title || ep.name || 'episode watched',
        epNum: ep.epNum || ep.number || ep.episodeNumber || '',
        season: ep.seasonNum || ''
      });
      // v553: also check if this episode just completed its season
      maybeMarkScreenListSeasonFinished(item, section, ep.seasonNum);
    }
    const statusChangedNow = applyScreenListEpisodeStatusOrDefer(item);
    persistMyListEpisodeEdit(item, section);
    if (becameWatched) invalidateActivityFeedAfterLibraryMutation();
    if (statusChangedNow && !itemMatchesCurrentView(item)) {
      updateEpisodeRowState(ep);
      updateCardProgressUI(item);
      updateSeasonProgressUI(item, ep.seasonNum);
      updateStatusPillsUI(item);
      render();
      if (isMyListEpisodePageOpen(itemId)) rerenderMyListEpisodePage();
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
  if (viewingUser) return;
  const context = getMyListEpisodeInteractionContext(id);
  const item = context.item;
  const section = context.section || activeSection;
  if (!item) return;
  // v451: materialise synthetic anime episodes so the per-episode flags persist.
  if (typeof hydrateAnimeEpisodesIfSynthetic === 'function') hydrateAnimeEpisodesIfSynthetic(item);
  preserveViewport(() => {
    preserveEpisodeScroll(id, () => {
      const affectedEpisodes = item.episodes.length;
      item.episodes.forEach(e => e.watched = val);
      if (val) {
        markEpisodeWatchActivity(item, section, { count: affectedEpisodes, label: 'all episodes watched' });
        // v553: mark each season finished
        new Set(item.episodes.map(ep => ep.seasonNum).filter(Boolean)).forEach(sn => {
          maybeMarkScreenListSeasonFinished(item, section, sn);
        });
      }
      const statusChangedNow = applyScreenListEpisodeStatusOrDefer(item);
      persistMyListEpisodeEdit(item, section);
      if (val) invalidateActivityFeedAfterLibraryMutation();
      if (statusChangedNow && !itemMatchesCurrentView(item)) {
        item.episodes.forEach(updateEpisodeRowState);
        updateCardProgressUI(item);
        new Set(item.episodes.map(ep => ep.seasonNum).filter(Boolean)).forEach(seasonNum => {
          updateSeasonProgressUI(item, seasonNum);
          updateSeasonActionLabelUI(item, seasonNum);
        });
        updateStatusPillsUI(item);
        render();
        if (isMyListEpisodePageOpen(id)) rerenderMyListEpisodePage();
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
  if (viewingUser) return;
  const context = getMyListEpisodeInteractionContext(id);
  const item = context.item;
  if (!item) return;
  const cancelAction = isMyListEpisodePageOpen(id) ? `rerenderMyListEpisodePage()` : `render()`;
  const currentCount = Math.max(1, Number(item.totalEpisodes || item.totalEps || item.episodes?.length || 1));
  const el = document.getElementById('edit-ep-' + id);
  el.innerHTML = `
    <input type="number" min="1" value="${currentCount}" style="width:60px;padding:4px 8px;font-size:12px;background:#0c0a1d;border:1px solid #2a2248;border-radius:4px;color:#e8e3f3;outline:none;" id="ep-count-inp-${id}">
    <button class="btn-primary btn-sm" onclick="saveEpCount('${id}')">Save</button>
    <button class="btn-secondary btn-sm" onclick="${cancelAction}">Cancel</button>
  `;
}

function saveEpCount(id) {
  if (viewingUser) return;
  const context = getMyListEpisodeInteractionContext(id);
  const item = context.item;
  const section = context.section || activeSection;
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
    persistMyListEpisodeEdit(item, section);
    render();
    if (isMyListEpisodePageOpen(id)) rerenderMyListEpisodePage();
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
  /* v10.446: items with a saved review (item.reviewText set) ALWAYS
     pass this gate regardless of which tab is active. Without this,
     the layers icon never reached friend's planned / watching /
     paused cards even when the friend had written a review — the
     watched-tab-only gate below blocked it. Now: any item the friend
     (or you) has reviewed shows the FPReview entry icon on whatever
     tab the user is currently browsing on the friend's shelf profile.
     The downstream `buildCardCommentAddBtnHtml` checks
     `hasReview || viewingUser` to decide between the layers icon and
     the legacy `+` add button, so this gate just needs to let the
     function get called.
     v10.447: also pass the gate when `item.reviewActivityId` is set,
     even if `item.reviewText` came down empty (the friend's
     watchlist sync may have missed the text field, but the
     reviewActivityId pointer alone tells us a feed post exists and
     therefore a review exists). The FPReview's async backstop
     (v10.444's `fetchAndPatchMyListReviewText`) will fetch the
     post body when the user actually opens the review. */
  if (String(item?.reviewText || '').trim()) return true;
  if (String(item?.reviewActivityId || '').trim()) return true;
  if (!isScreenListCompletedTabForCardComment()) return false;
  /* v10.444: the viewing-user gate has been removed. Previously this
     returned `false` whenever `viewingUser && !item.cardComment?.text`,
     which blocked the layers icon from surfacing on a friend's title
     card unless they had written a SHORT inline comment — even when
     they had written a full long-form review or had simply rated the
     title. The downstream icon path in `buildCardCommentAddBtnHtml`
     already routes correctly for every viewing-user case (it returns
     the layers icon under `hasReview || viewingUser`), so trusting
     it here makes the entry point appear on every watched card a
     friend has on their list. Owner-side composer behavior is
     unchanged because the owner path doesn't depend on this branch. */
  return true;
}

function getCardCommentText(item) {
  return String(item?.cardComment?.text || '').trim();
}

// v803: split into two render helpers.
//   buildCardCommentAddBtnHtml — + button in card-right-controls (far right of action row)
//   buildCardCommentBodyHtml   — flat text floated on the card body above the action row
// v10.220: once a real review exists (item.reviewText), the title card stays
// clean — owners see nothing extra (no + button, no body comment line); other
// people viewing the list see a layers icon (bottom-right) that opens the
// Full Page Review for that item.
function buildCardCommentAddBtnHtml(item) {
  if (!item) return '';
  if (!shouldShowCardCommentFeatureFor(item)) return '';
  const itemIdAttr = escAttr(item.id);
  const sectionAttr = escAttr(activeSection);
  /* v10.447: `hasReview` now also recognizes the `reviewActivityId`
     pointer. Friend's data sometimes lands with only the activity-id
     populated (the watchlist sync round-trip can drop large text
     fields), so checking only `reviewText` was hiding the icon for
     reviews that DID exist. Either signal is sufficient evidence
     that a review post lives in the feed for this item. */
  const hasReview = !!String(item.reviewText || '').trim()
    || !!String(item.reviewActivityId || '').trim();
  // v10.221: once a review exists, owner and viewer BOTH see the layers icon —
  // clicking it opens the Full Page Review for that title. Owners can edit
  // their review from there via the 3-dot menu.
  // v10.282: viewers ALSO see the layers icon when the friend hasn't written
  // a review yet — the FPReview page still has meaningful content (cover,
  // title, rating, date watched, who rated it) and viewers should be able
  // to open it from a friend's card regardless of whether the friend wrote
  // text. Without this, items the friend rated-only had no viewer entry
  // point into the FPReview.
  if (hasReview || viewingUser) {
    return '<button class="card-review-layers-btn" type="button" onclick="event.stopPropagation();openFullPageMediaReview(\'' + itemIdAttr + '\',\'' + sectionAttr + '\')" aria-label="Open full page review" title="Open full page review"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.25 5.25h11.5A2.25 2.25 0 0 1 20 7.5v6A2.25 2.25 0 0 1 17.75 15.75H10.9L7.25 18.75v-3H6.25A2.25 2.25 0 0 1 4 13.5v-6a2.25 2.25 0 0 1 2.25-2.25Z"/><path d="M8 9.25h8"/><path d="M8 12.25h5.5"/></svg></button>';
  }
  // No review yet AND owner viewing their own list — show the legacy +
  // button (which opens the I-Watched composer for watched/played sections).
  const text = getCardCommentText(item);
  if (text) return ''; // legacy short-comment posted — no + button
  return '<button class="card-comment-add-btn" type="button" onclick="event.stopPropagation();openCardCommentComposer(\'' + itemIdAttr + '\')" aria-label="Add a comment about this title" title="Add a comment"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>';
}

function buildCardCommentBodyHtml(item) {
  if (!item) return '';
  if (!shouldShowCardCommentFeatureFor(item)) return '';
  // v10.220: never render the flat comment line when a real review is posted —
  // the layers icon route on viewer cards covers discovery instead.
  if (String(item.reviewText || '').trim()) return '';
  const text = getCardCommentText(item);
  if (!text) return '';
  const itemIdAttr = escAttr(item.id);
  const isOwner = !viewingUser;
  const isWatchedMediaCard = (activeSection === 'movies' || activeSection === 'shows' || activeSection === 'anime')
    && String(item?.status || '').trim() === 'watched';
  const commentClass = `card-comment-body${isOwner ? ' card-comment-body--owner' : ''}${isWatchedMediaCard ? ' card-comment-body--watched-media' : ''}`;
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
      '<button type="button" class="' + commentClass + '" ' +
        'onclick="event.preventDefault();event.stopPropagation();openCardCommentComposer(\'' + itemIdAttr + '\')" ' +
        'aria-label="Edit your comment" ' +
        'data-card-comment-id="' + itemIdAttr + '">' +
        '<span class="card-comment-body-text">' + escHtml(text) + '</span>' +
      '</button>'
    );
  }
  return '<div class="' + commentClass + '" data-card-comment-id="' + itemIdAttr + '"><span class="card-comment-body-text">' + escHtml(text) + '</span></div>';
}

/* v10.69: partial DOM update for the title-card comment body. Replaces the
   inner contents of the per-card slot wrapper (id="card-comment-slot-{id}").
   Used by saveCardCommentFromComposer / confirmDeleteCardComment so a comment
   post/edit/delete doesn't trigger a full grid render. If the slot doesn't
   exist (card not currently rendered), the call is a safe no-op. */
function updateCardCommentUI(item = {}) {
  if (!item || !item.id) return;
  const slot = document.getElementById('card-comment-slot-' + item.id);
  if (!slot) return;
  slot.innerHTML = buildCardCommentBodyHtml(item);
}

/* =========================================================================
   v10.217: "I Watched..." / "I Played..." intermediate log composer.
   ------------------------------------------------------------------------
   Replaces the old single-line card-comment modal when the user taps the +
   on a Watched (movies/shows/anime) or Played (games) title card.

   Flow: + tap → this composer slides in from the right → user sets rating,
   liked, date, review text, tags, and the three publish toggles → tap Save
   → data persists to the item → composer slides out and the existing
   Full Page Review opens (#mylist-media-review-page) with the freshly
   written review visible.

   Design language follows the Shelfline pattern (dark slate background,
   thin row dividers, lavender accents, green save action, orange heart
   liked state, green half-step stars). Animation is compositor-only
   (transform/opacity), two rAFs to schedule on a 120Hz cadence.

   New per-item fields written here:
     - item.rating           (number, existing field)
     - item.liked            (bool)
     - item.reviewText       (string, longer than cardComment max — feeds
                              into the FPReview text region via the existing
                              getMyListReviewText() fallback chain)
     - item.reviewTags       (string[])
     - item.firstTimeWatch   (bool)
     - item.reviewSpoilerFree(bool)
     - item.reviewRepliesPublic (bool)
     - item.dateWatched      (ISO string)
   ========================================================================= */
const SHELF_LOG_REVIEW_MAX = 4000;
const SHELF_LOG_TAG_MAX_COUNT = 12;
const SHELF_LOG_TAG_MAX_LEN = 28;

function getShelfLogActionVerb(section, item) {
  if (section === 'games') return 'Played';
  if (section === 'music') return 'Listened';
  return 'Watched';
}

function getShelfLogRatingStepCount(section) {
  return typeof getRatingStepCountForSection === 'function'
    ? getRatingStepCountForSection(section)
    : 10;
}

function shouldRouteToShelfLogComposer(section, item) {
  if (!item) return false;
  if (viewingUser) return false;
  // Same gate as the legacy + button (only on the "watched" tab).
  if (!isScreenListCompletedTabForCardComment()) return false;
  return true;
}

function formatShelfLogDateLong(value) {
  const ms = Date.parse(value || '');
  if (!Number.isFinite(ms) || ms <= 0) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    }).format(new Date(ms));
  } catch (e) {
    return new Date(ms).toLocaleDateString();
  }
}

function formatShelfLogDateForInput(value) {
  const ms = Date.parse(value || '');
  const date = Number.isFinite(ms) && ms > 0 ? new Date(ms) : new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

let shelfLogComposerState = null;
/* v10.788: holds a pending draft when the user opens the composer from
   the FPMP Watched flow BEFORE the item is added to their library. The
   media is only persisted when the user taps Save in the composer; if
   they tap Cancel (or background the page), this clears with no library
   add. Shape: { type, tmdbId, fpmpBtn, section, draftItem } */
let shelfLogComposerDraft = null;

/* v10.788: FPMP entry point — opens the write-a-review composer for a
   media item that is NOT yet in the user's library. The library add
   only happens when the user confirms Save inside the composer (see
   saveShelfLogComposer draft-handling branch). Tap-to-open is instant
   because no addDiscoveryTitle await runs here — we synthesize a draft
   item from the FPMP button dataset and hand it to the composer. */
function openShelfLogComposerForNewMedia(type, tmdbId, fpmpBtn) {
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
  if (viewingUser) return;
  const cleanType = String(type || '').toLowerCase();
  const cleanId = String(tmdbId || '').trim();
  if (!cleanType || !cleanId) return;
  const title = fpmpBtn?.dataset?.discoverTitle || '';
  const poster = fpmpBtn?.dataset?.discoverPoster || '';
  const sectionFromType = cleanType === 'movie' ? 'movies'
    : cleanType === 'game' ? 'games'
    : cleanType === 'anime' ? 'anime'
    : 'shows';
  const draftId = 'shelflog-draft-' + Date.now() + '-' + cleanId;
  shelfLogComposerDraft = {
    type: cleanType,
    tmdbId: cleanId,
    fpmpBtn,
    section: sectionFromType,
    draftItem: {
      id: draftId,
      title,
      cover: poster,
      year: '',
      status: 'watched',
      rating: 0,
      dateAdded: new Date().toISOString(),
      mediaCategory: sectionFromType,
      librarySection: sectionFromType,
      episodes: [],
      reviewText: '',
      reviewTags: [],
      cardComment: { text: '' }
    }
  };
  openShelfLogComposer(draftId, sectionFromType);
}
if (typeof window !== 'undefined') {
  window.openShelfLogComposerForNewMedia = openShelfLogComposerForNewMedia;
}

function openShelfLogComposer(itemId, sectionHint = '') {
  /* v10.242: accept an optional section hint so the FPReview Edit action
     can re-open the composer for an item that isn't in the currently
     active section (e.g. user tapped Edit while looking at a music album
     review while their active My Lists section was Movies). Falls back to
     activeSection if no hint provided. */
  let section = sectionHint || activeSection;
  let item = (data[section] || []).find(i => i?.id === itemId);
  if (!item) {
    /* Walk every known section as a last resort so Edit works regardless
       of where the user was navigated from. */
    for (const sec of ["movies", "shows", "anime", "games", "manga", "books", "music"]) {
      const found = (data[sec] || []).find(i => i?.id === itemId);
      if (found) { item = found; section = sec; break; }
    }
  }
  /* v10.788: DRAFT MODE — if the id matches a pending draft (set by
     openShelfLogComposerForNewMedia when the user taps Watched on the
     FPMP), use the in-memory draft item instead of looking in data[].
     The item is NOT yet in the library; only on Save does the actual
     addDiscoveryTitle write happen. Cancel removes the draft entirely. */
  if (!item && shelfLogComposerDraft && shelfLogComposerDraft.draftItem && shelfLogComposerDraft.draftItem.id === itemId) {
    item = shelfLogComposerDraft.draftItem;
    section = shelfLogComposerDraft.section || section;
  }
  if (!item) return;
  if (viewingUser) return;

  closeShelfLogComposer({ instant: true });

  const verb = getShelfLogActionVerb(section, item);
  const title = (typeof getDisplayTitleForItem === 'function' ? getDisplayTitleForItem(item, section) : '') || item.title || 'Untitled';
  const poster = typeof getMyListPosterUrlForItem === 'function' ? getMyListPosterUrlForItem(item, section) : (item.cover || '');
  const year = String(item.year || '').slice(0, 4);
  const stepCount = getShelfLogRatingStepCount(section);
  const initialDateRaw = item.dateWatched || item.watchedAt || item.completedAt || item.finishedAt || item.dateModified || item.dateAdded || new Date().toISOString();
  const initialDate = formatShelfLogDateForInput(initialDateRaw);
  const initialRating = Number(item.rating || 0);
  const initialReview = String(item.reviewText || item.cardComment?.text || '');
  const initialTags = Array.isArray(item.reviewTags) ? item.reviewTags.slice(0) : [];
  const initialFirstTime = item.firstTimeWatch !== false;
  const initialRepliesOpen = item.reviewRepliesPublic !== false;

  shelfLogComposerState = {
    itemId, section,
    rating: initialRating,
    date: initialDate,
    review: initialReview,
    tags: initialTags,
    firstTime: initialFirstTime,
    repliesOpen: initialRepliesOpen,
    stepCount
  };

  const overlay = document.createElement('section');
  overlay.id = 'shelf-log-composer';
  overlay.className = 'shelf-log-composer' + (section === 'music' ? ' is-music-composer' : '');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `${verb} ${title}`);
  // v10.521: REBUILT with the canonical 5-star half-step slot pattern.
  // The v10.520 markup used `.star-btn.half-step.left/right` — the
  // legacy text-indent-based hack that places two ★ glyphs side-by-
  // side and clips each to ~54% width. That hack produces a visible
  // seam at larger glyph sizes (same artifact v10.510 fixed on the
  // title-card bubble). This rebuild uses the same SLOT structure
  // that the title-card bubble uses (one slot per visual star, with
  // a grey base ★ + a gold fill ★ clipped via clip-path to the slot's
  // fill percent, plus two invisible left/right hit buttons). One
  // clean glyph per star, no seams.
  //
  // `data-shelf-log-star` is preserved on the hit buttons so the
  // existing event handlers and state.rating semantics (1-10 half-
  // step units) keep working unchanged. The `--star-fill` CSS variable
  // on each slot is set per-render based on initialRating; the
  // refresh handler below updates the same variable on rating change.
  const computeSlotFillPct = (slotIdx, rating) => {
    const leftV = slotIdx * 2 - 1;
    const rightV = slotIdx * 2;
    if (rating >= rightV) return 100;
    if (rating >= leftV) return 50;
    return 0;
  };
  const starsHtml = (() => {
    const slots = [];
    for (let star = 1; star <= 5; star++) {
      const leftVal = star * 2 - 1;   // 1, 3, 5, 7, 9
      const rightVal = star * 2;      // 2, 4, 6, 8, 10
      const fillPct = computeSlotFillPct(star, initialRating);
      slots.push(
        `<span class="shelf-log-star-slot" data-shelf-log-slot="${star}" style="--star-fill:${fillPct}%">`
          + `<span class="shelf-log-star-base" aria-hidden="true">&#9733;</span>`
          + `<span class="shelf-log-star-fill" aria-hidden="true">&#9733;</span>`
          + `<button type="button" class="shelf-log-star-hit shelf-log-star-hit-left" data-shelf-log-star="${leftVal}" aria-label="Set rating ${leftVal / 2} out of 5"></button>`
          + `<button type="button" class="shelf-log-star-hit shelf-log-star-hit-right" data-shelf-log-star="${rightVal}" aria-label="Set rating ${rightVal / 2} out of 5"></button>`
        + `</span>`
      );
    }
    return slots.join('');
  })();
  const tagsHtml = initialTags.map(t => (
    `<span class="shelf-log-composer-tag">${escHtml(t)}` +
      `<button type="button" class="shelf-log-composer-tag-remove" data-shelf-log-tag-remove="${escAttr(t)}" aria-label="Remove tag">&times;</button>` +
    `</span>`
  )).join('');
  overlay.innerHTML = `
    <div class="shelf-log-composer-shell">
      <header class="shelf-log-composer-topbar">
        <button type="button" class="shelf-log-composer-cancel" data-shelf-log-cancel>Cancel</button>
        <span class="shelf-log-composer-title">I ${escHtml(verb)}...</span>
        <button type="button" class="shelf-log-composer-save" data-shelf-log-save>Save</button>
      </header>
      <div class="shelf-log-composer-meta">
        <div class="shelf-log-composer-poster${poster ? '' : ' no-img'}" ${poster ? `style="background-image:url('${escAttr(poster)}')"` : ''}></div>
        <div class="shelf-log-composer-meta-text">
          <strong class="shelf-log-composer-meta-title">${escHtml(title)}</strong>
          ${year ? `<span class="shelf-log-composer-meta-year">${escHtml(year)}</span>` : ''}
        </div>
      </div>
      <main class="shelf-log-composer-body">
        <button type="button" class="shelf-log-composer-row shelf-log-composer-date-row" data-shelf-log-date-trigger>
          <span class="shelf-log-composer-row-label">Date</span>
          <span class="shelf-log-composer-row-value" data-shelf-log-date-label>${escHtml(formatShelfLogDateLong(initialDateRaw))}</span>
          <input type="date" class="shelf-log-composer-date-input" data-shelf-log-date-input value="${escAttr(initialDate)}" aria-label="Watched date">
        </button>
        <div class="shelf-log-composer-row shelf-log-composer-rate-row">
          <span class="shelf-log-composer-row-label">Rated</span>
          <div class="shelf-log-composer-stars" data-shelf-log-stars role="slider" aria-valuemin="0" aria-valuemax="5" aria-valuenow="${initialRating / 2}" ontouchstart="shelfLogStarsTouchStart(event)" ontouchmove="shelfLogStarsTouchMove(event)" ontouchend="shelfLogStarsTouchEnd(event)" ontouchcancel="shelfLogStarsTouchEnd(event)">${starsHtml}</div>
        </div>
        <div class="shelf-log-composer-row shelf-log-composer-review-row">
          <textarea class="shelf-log-composer-review" data-shelf-log-review rows="6" maxlength="${SHELF_LOG_REVIEW_MAX}" placeholder="Add review...">${escHtml(initialReview)}</textarea>
        </div>
        <div class="shelf-log-composer-row shelf-log-composer-tags-row">
          <div class="shelf-log-composer-tags" data-shelf-log-tags>${tagsHtml}</div>
          <input type="text" class="shelf-log-composer-tag-input" data-shelf-log-tag-input maxlength="${SHELF_LOG_TAG_MAX_LEN}" placeholder="Add tags...">
        </div>
      </main>
      <footer class="shelf-log-composer-foot">
        <button type="button" class="shelf-log-composer-toggle${initialFirstTime ? ' is-on' : ''}" data-shelf-log-toggle="firstTime" aria-pressed="${initialFirstTime ? 'true' : 'false'}">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.5"/></svg>
          <span>First-time watch</span>
        </button>
        <button type="button" class="shelf-log-composer-toggle${initialRepliesOpen ? ' is-on' : ''}" data-shelf-log-toggle="replies" aria-pressed="${initialRepliesOpen ? 'true' : 'false'}">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M8 10c1-1.2 2.4-2 4-2s3 .8 4 2"/><path d="M10 14c.6.6 1.3 1 2 1s1.4-.4 2-1"/></svg>
          <span>Anyone can reply</span>
        </button>
      </footer>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.classList.add('shelf-log-composer-open');
  // Two rAFs: first commits paint, second triggers the CSS transition so the
  // browser can schedule it on a 120Hz cadence (matches the FPReview pattern).
  requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('is-open')));

  attachShelfLogComposerEvents(overlay, item, section);
  refreshShelfLogStarUI(overlay);
}

function refreshShelfLogStarUI(overlay) {
  const state = shelfLogComposerState;
  if (!state || !overlay) return;
  // v10.521: slot-based half-step rendering. Walk each `.shelf-log-star-
  // slot` and set its `--star-fill` CSS variable based on state.rating
  // (1–10 half-step units): rating >= slot's right value → 100%
  // (full star), rating >= slot's left value → 50% (half star),
  // else 0% (empty). The CSS clip-path on `.shelf-log-star-fill`
  // crops the gold glyph to that fill percent.
  overlay.querySelectorAll('.shelf-log-star-slot').forEach(slot => {
    const starIdx = Number(slot.getAttribute('data-shelf-log-slot')) || 0;
    if (!starIdx) return;
    const leftV = starIdx * 2 - 1;
    const rightV = starIdx * 2;
    let pct = 0;
    if (state.rating >= rightV) pct = 100;
    else if (state.rating >= leftV) pct = 50;
    slot.style.setProperty('--star-fill', `${pct}%`);
  });
  const slider = overlay.querySelector('[data-shelf-log-stars]');
  if (slider) slider.setAttribute('aria-valuenow', String(state.rating / 2));
}

/* v10.523: scrub-to-rate touch handlers for the shelf log composer's
   rating row. Same gesture model as the title-card bubble's
   `ratingBubbleTouchStart/Move/End` and the per-track widget's
   `onMylistAlbumTrackRateTouch*` — 6px horizontal-dominant lock-in,
   cache hit-zone midpoints on touchstart (no per-event DOM reads),
   midpoint-crossover for the per-half-step value, update each slot's
   `--star-fill` CSS variable live during scrub, commit on touchend
   through the same path a tap would (so state.rating + the refresh
   re-render + WAAPI pop all stay consistent). The cached hit array
   lives on the row element under `_scrubCache`. */
window.shelfLogStarsTouchStart = function(e) {
  const row = e.currentTarget;
  const t = e.touches && e.touches[0];
  if (!t) return;
  row.dataset.touchStartX = String(t.clientX);
  row.dataset.touchStartY = String(t.clientY);
  row.dataset.scrubVal = '0';
  row.dataset.scrubbing = 'false';
  const hits = Array.from(row.querySelectorAll('[data-shelf-log-star]'));
  const hitMidpoints = hits.map(b => {
    const r = b.getBoundingClientRect();
    return r.left + r.width / 2;
  });
  const slots = Array.from(row.querySelectorAll('.shelf-log-star-slot'));
  row._scrubCache = { hits, hitMidpoints, slots, lastVal: -1 };
};

window.shelfLogStarsTouchMove = function(e) {
  const row = e.currentTarget;
  const t = e.touches && e.touches[0];
  if (!t) return;
  const cache = row._scrubCache;
  if (!cache) return;
  const dx = Math.abs(t.clientX - parseFloat(row.dataset.touchStartX || 0));
  const dy = Math.abs(t.clientY - parseFloat(row.dataset.touchStartY || 0));
  if (row.dataset.scrubbing !== 'true') {
    if (dx < 6 || dy > dx) return;
    /* Rebuild cache at lock-in moment so midpoints reflect any layout
       that may have settled between touchstart and the first move
       past threshold (same pattern as the bubble v10.515). */
    const hits = Array.from(row.querySelectorAll('[data-shelf-log-star]'));
    cache.hits = hits;
    cache.hitMidpoints = hits.map(b => {
      const r = b.getBoundingClientRect();
      return r.left + r.width / 2;
    });
    cache.slots = Array.from(row.querySelectorAll('.shelf-log-star-slot'));
  }
  row.dataset.scrubbing = 'true';
  e.preventDefault();
  let val = 0;
  for (let i = 0; i < cache.hitMidpoints.length; i++) {
    if (t.clientX >= cache.hitMidpoints[i]) val = i + 1;
  }
  if (val < 1) return;
  if (val === cache.lastVal) return;
  cache.lastVal = val;
  row.dataset.scrubVal = String(val);
  /* Live-update each slot's --star-fill so the visual tracks the
     finger one-to-one. Same fill model used by refreshShelfLogStarUI. */
  for (let idx = 0; idx < cache.slots.length; idx++) {
    const starIdx = idx + 1;
    const leftV = starIdx * 2 - 1;
    const rightV = starIdx * 2;
    let pct = 0;
    if (val >= rightV) pct = 100;
    else if (val >= leftV) pct = 50;
    cache.slots[idx].style.setProperty('--star-fill', `${pct}%`);
  }
  const slider = row.getAttribute('role') === 'slider' ? row : null;
  if (slider) slider.setAttribute('aria-valuenow', String(val / 2));
};

window.shelfLogStarsTouchEnd = function(e) {
  const row = e.currentTarget;
  const wasScrubbing = row.dataset.scrubbing === 'true';
  delete row._scrubCache;
  if (!wasScrubbing) return;
  row.dataset.scrubbing = 'false';
  const val = parseInt(row.dataset.scrubVal || '0', 10);
  row.dataset.scrubVal = '0';
  if (val < 1) return;
  e.preventDefault();
  /* Commit through state.rating + refresh, mirroring the click-on-hit
     path. Skip the toggle-off behavior — scrub commits ARE intentional
     (a tap on the current rating still goes through the inline onclick
     on the hit button, which DOES toggle off). */
  const state = shelfLogComposerState;
  if (!state) return;
  state.rating = val;
  const overlay = row.closest('#shelf-log-composer');
  if (overlay) {
    refreshShelfLogStarUI(overlay);
    /* Replay the pop animation on the slots that just became newly lit. */
    const slots = overlay.querySelectorAll('.shelf-log-star-slot');
    slots.forEach((slot, idx) => {
      const starIdx = idx + 1;
      const leftV = starIdx * 2 - 1;
      if (val >= leftV) {
        const fill = slot.querySelector('.shelf-log-star-fill');
        if (fill && typeof fill.animate === 'function') {
          fill.animate([
            { transform: 'scale(1)',    filter: 'brightness(1)' },
            { transform: 'scale(1.55)', filter: 'brightness(1.5) drop-shadow(0 0 8px rgba(230,199,102,0.9))', offset: 0.3 },
            { transform: 'scale(1.1)',  filter: 'brightness(1.15)', offset: 0.6 },
            { transform: 'scale(1)',    filter: 'brightness(1)' }
          ], { duration: 420, delay: 60 + idx * 35, easing: 'ease-out', fill: 'none' });
        }
      }
    });
  }
};

function attachShelfLogComposerEvents(overlay, item, section) {
  const state = shelfLogComposerState;
  if (!state) return;

  // --- Date row: tap anywhere on the row opens the native date picker. ---
  const dateBtn = overlay.querySelector('[data-shelf-log-date-trigger]');
  const dateInput = overlay.querySelector('[data-shelf-log-date-input]');
  const dateLabel = overlay.querySelector('[data-shelf-log-date-label]');
  if (dateBtn && dateInput) {
    dateBtn.addEventListener('click', e => {
      if (e.target && e.target.closest && e.target.closest('[data-shelf-log-date-input]')) return;
      try { dateInput.showPicker?.(); } catch (_) {}
      try { dateInput.focus(); } catch (_) {}
    });
    dateInput.addEventListener('change', () => {
      state.date = dateInput.value || state.date;
      if (dateLabel) dateLabel.textContent = formatShelfLogDateLong(state.date + 'T12:00:00');
    });
  }

  // --- Star rating (5-star half-step, slot pattern). Tap on either
  // half of a star sets the rating to that half-step value (1–10
  // internal). Tapping the currently-selected value clears the rating
  // to 0. Hover preview drives the same --star-fill CSS variable that
  // refreshShelfLogStarUI uses, so the visual feedback matches the
  // post-commit state exactly. ---
  const slots = Array.from(overlay.querySelectorAll('.shelf-log-star-slot'));
  const hitButtons = overlay.querySelectorAll('[data-shelf-log-star]');
  function previewStars(value) {
    slots.forEach(slot => {
      const starIdx = Number(slot.getAttribute('data-shelf-log-slot')) || 0;
      if (!starIdx) return;
      const leftV = starIdx * 2 - 1;
      const rightV = starIdx * 2;
      let pct = 0;
      if (value >= rightV) pct = 100;
      else if (value >= leftV) pct = 50;
      slot.style.setProperty('--star-fill', `${pct}%`);
    });
  }
  hitButtons.forEach(btn => {
    const value = Number(btn.getAttribute('data-shelf-log-star')) || 0;
    btn.addEventListener('mouseenter', () => previewStars(value));
    btn.addEventListener('mouseleave', () => previewStars(state.rating));
    btn.addEventListener('click', () => {
      state.rating = state.rating === value ? 0 : value;
      refreshShelfLogStarUI(overlay);
      // Replay the Shelfd star-pop animation on the slot's fill glyph.
      const slot = btn.closest('.shelf-log-star-slot');
      const fill = slot && slot.querySelector('.shelf-log-star-fill');
      if (fill) {
        fill.classList.remove('star-pop');
        void fill.offsetWidth;
        fill.classList.add('star-pop');
        setTimeout(() => fill.classList.remove('star-pop'), 460);
      }
    });
  });

  // --- Review textarea ---
  const reviewTa = overlay.querySelector('[data-shelf-log-review]');
  if (reviewTa) reviewTa.addEventListener('input', () => { state.review = reviewTa.value; });

  // --- Tag chip input. Enter / comma commits. Backspace on empty pops last. ---
  const tagInput = overlay.querySelector('[data-shelf-log-tag-input]');
  const tagsHost = overlay.querySelector('[data-shelf-log-tags]');
  function rerenderTags() {
    if (!tagsHost) return;
    tagsHost.innerHTML = state.tags.map(t => (
      `<span class="shelf-log-composer-tag">${escHtml(t)}` +
        `<button type="button" class="shelf-log-composer-tag-remove" data-shelf-log-tag-remove="${escAttr(t)}" aria-label="Remove tag">&times;</button>` +
      `</span>`
    )).join('');
    tagsHost.querySelectorAll('[data-shelf-log-tag-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.getAttribute('data-shelf-log-tag-remove') || '';
        state.tags = state.tags.filter(x => x !== t);
        rerenderTags();
      });
    });
  }
  rerenderTags();
  if (tagInput) {
    const commit = () => {
      const v = String(tagInput.value || '').trim().slice(0, SHELF_LOG_TAG_MAX_LEN);
      if (!v) return;
      if (state.tags.includes(v)) { tagInput.value = ''; return; }
      if (state.tags.length >= SHELF_LOG_TAG_MAX_COUNT) { tagInput.value = ''; return; }
      state.tags.push(v);
      tagInput.value = '';
      rerenderTags();
    };
    tagInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Backspace' && !tagInput.value && state.tags.length) {
        state.tags.pop();
        rerenderTags();
      }
    });
    tagInput.addEventListener('blur', commit);
  }

  // --- Publish toggles (First-time watch / Anyone can reply) ---
  overlay.querySelectorAll('[data-shelf-log-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-shelf-log-toggle');
      const newOn = !btn.classList.contains('is-on');
      btn.classList.toggle('is-on', newOn);
      btn.setAttribute('aria-pressed', newOn ? 'true' : 'false');
      if (key === 'firstTime') state.firstTime = newOn;
      else if (key === 'replies') state.repliesOpen = newOn;
    });
  });

  // --- Cancel / Save ---
  const cancelBtn = overlay.querySelector('[data-shelf-log-cancel]');
  const saveBtn = overlay.querySelector('[data-shelf-log-save]');
  if (cancelBtn) cancelBtn.addEventListener('click', () => closeShelfLogComposer());
  if (saveBtn) saveBtn.addEventListener('click', () => saveShelfLogComposer());
}

function closeShelfLogComposer(opts = {}) {
  /* v10.788: always clear shelfLogComposerDraft on close. If save
     ran, it cleared the draft before calling close — this is a no-op.
     If cancel/dismiss closed the composer without saving, this drops
     the draft so the media is never added to the library, matching
     the user's "only added on confirm Save" requirement. */
  shelfLogComposerDraft = null;
  const overlay = document.getElementById('shelf-log-composer');
  if (!overlay) {
    shelfLogComposerState = null;
    document.body.classList.remove('shelf-log-composer-open');
    return;
  }
  if (opts.instant) {
    try { overlay.remove(); } catch (_) {}
    shelfLogComposerState = null;
    document.body.classList.remove('shelf-log-composer-open');
    return;
  }
  overlay.classList.remove('is-open');
  setTimeout(() => {
    try { overlay.remove(); } catch (_) {}
    shelfLogComposerState = null;
    document.body.classList.remove('shelf-log-composer-open');
  }, 320);
}

async function saveShelfLogComposer() {
  const state = shelfLogComposerState;
  if (!state) return;
  /* v10.788: DRAFT-MODE SAVE — if this composer was opened via
     openShelfLogComposerForNewMedia (FPMP Watched flow), the item is NOT
     yet in the library. Save is the moment we actually add it. Run
     addDiscoveryTitle with the user's chosen rating (so the full-page
     write-a-review save is the single transaction that creates the
     entry), then patch state.itemId/section to the real id so the rest
     of the function operates on the now-existing library item. */
  if (shelfLogComposerDraft && shelfLogComposerDraft.draftItem && shelfLogComposerDraft.draftItem.id === state.itemId) {
    const draft = shelfLogComposerDraft;
    const ratingForAdd = Number(state.rating || 0);
    let addResult = null;
    try {
      if (typeof addDiscoveryTitle === 'function') {
        addResult = await addDiscoveryTitle(draft.type, draft.tmdbId, draft.fpmpBtn, 'watched', '+', ratingForAdd, { promptPost: false });
      }
    } catch (e) {
      console.warn('[v10.788] draft-mode addDiscoveryTitle threw:', e);
    }
    if (!addResult || !addResult.ok || !addResult.item || !addResult.item.id) {
      if (typeof showToast === 'function') showToast('Could not save review. Try again.');
      return; // keep composer open so user can retry
    }
    state.itemId = String(addResult.item.id);
    state.section = String(addResult.section || draft.section || state.section);
    shelfLogComposerDraft = null;
  }
  const item = (data[state.section] || []).find(i => i?.id === state.itemId);
  if (!item) { closeShelfLogComposer(); return; }

  const reviewText = String(state.review || '').trim().slice(0, SHELF_LOG_REVIEW_MAX);
  const tags = state.tags.slice(0, SHELF_LOG_TAG_MAX_COUNT);

  const prevRating = Number(item.rating || 0);
  const nextRating = Number(state.rating || 0);
  item.rating = nextRating;
  item.reviewText = reviewText;
  item.reviewTags = tags;
  item.firstTimeWatch = !!state.firstTime;
  item.reviewRepliesPublic = !!state.repliesOpen;
  if (state.date) {
    try { item.dateWatched = new Date(state.date + 'T12:00:00').toISOString(); }
    catch (_) {}
  }
  // v10.220: do NOT mirror into cardComment.text any more — once a real review
  // is posted, the title card surface stays clean (no flat comment line) and
  // owners see no + button, viewers see a layers icon that opens the FPReview.

  if (typeof markOwnItemLastEdited === 'function') markOwnItemLastEdited(item, state.section);
  else if (typeof touchItem === 'function') touchItem(item);

  /* v10.451: keep the title-card rating UI in sync with the review-page
     rating. Before this, saving a review changed `item.rating` in
     memory + Firestore, but the rating bubble / stars on the MyList
     card behind the composer kept showing the OLD value until a full
     `render()` rebuild. Now we explicitly refresh the rating widget
     (same call `rate()` uses after a star click) and — for music
     section overall ratings — also propagate the change to the
     community-ratings doc so total / average aggregates update in
     real time on the album-details page. */
  if (prevRating !== nextRating) {
    try {
      if (typeof updateOverallRatingUI === 'function') {
        updateOverallRatingUI(item, state.section);
      }
    } catch (_) {}
    if (state.section === 'music' && typeof window.persistAlbumRatingToCommunityDoc === 'function') {
      try {
        window.persistAlbumRatingToCommunityDoc(item, nextRating).then(() => {
          if (typeof window.fetchAndPatchAlbumCommunityRating === 'function') {
            window.fetchAndPatchAlbumCommunityRating(item, { force: true });
          }
        }).catch(() => {});
      } catch (_) {}
    }
  }

  const targetItemId = state.itemId;
  const targetSection = state.section;

  closeShelfLogComposer();

  try { save(); }
  catch (e) {
    console.warn('[v10.217] save() threw inside saveShelfLogComposer:', e);
    if (typeof showToast === 'function') showToast('Saved locally — cloud sync will retry.');
  }
  try { updateCardCommentUI(item); } catch (_) {}

  // v10.220: create/update the linked Activity Feed post for this review.
  // Fire and forget — the FPReview opens regardless. The post has its own
  // replies array; the FPReview's Reply button routes there so reply counts
  // stay in sync between the activity card and the review page.
  // v10.705: AFTER the Firestore write resolves, push the new/updated
  // review post into the in-memory friend-activity live stream + bust the
  // friend-activity cache + reload the activity tab if it's visible.
  // Without this, the new card stayed invisible in the user's own activity
  // feed until the next natural refresh — often several seconds or
  // longer. With this, the card appears the instant Firestore acks the
  // write. The FPReview still opens via the setTimeout below regardless.
  try {
    if (reviewText && item.reviewActivityId) {
      updateLinkedMediaReviewFeedPost(item, state.section).then(success => {
        if (success) pushOwnMediaReviewToActivityFeed(item, state.section, item.reviewActivityId, reviewText);
      }).catch(() => {});
    } else if (reviewText) {
      createLinkedMediaReviewFeedPost(item, state.section).then(postId => {
        if (postId) {
          item.reviewActivityId = postId;
          try { save(); } catch (_) {}
          pushOwnMediaReviewToActivityFeed(item, state.section, postId, reviewText);
        }
      }).catch(() => {});
    }
  } catch (_) {}

  if (typeof showToast === 'function') showToast('Review posted');

  // After the slide-out finishes, hand off to the existing Full Page Review.
  setTimeout(() => {
    try { openFullPageMediaReview(targetItemId, targetSection); } catch (_) {}
  }, 340);
}

/* v10.220: media-review feed post helpers. The post is the source of truth
   for replies/likes; FPReview's Reply button delegates to it via the existing
   openActivityReplyPage handler, so the reply count shown on the activity
   card and inside the FPReview stay in sync automatically. */
async function createLinkedMediaReviewFeedPost(item, section) {
  if (!currentUser || typeof db === 'undefined') return '';
  const postId = (crypto && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : ('post-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  const timestamp = Date.now();
  const itemSection = section || item.librarySection || item.mediaCategory || activeSection;
  const reviewText = String(item.reviewText || '').slice(0, SHELF_LOG_REVIEW_MAX);
  const feedPost = {
    postId,
    uid: currentUser.uid,
    timestamp,
    type: 'media-review',
    eventType: 'review',
    visibility: 'friends',
    likes: [],
    replies: [],
    content: { text: reviewText, headline: 'Wrote a review' },
    item: {
      id: item.id,
      title: item.title || '',
      cover: item.cover || '',
      year: item.year || '',
      librarySection: itemSection,
      mediaCategory: itemSection,
      tmdbId: item.tmdbId || '',
      malId: item.malId || '',
      rawgId: item.rawgId || '',
      rating: item.rating || 0
    },
    mediaKey: typeof getMediaKey === 'function' ? getMediaKey(item) : '',
    reviewText,
    reviewSourceItemId: item.id
  };
  try {
    await db.collection('feed').doc(postId).set(feedPost);
    if (Array.isArray(window.feedPosts)) window.feedPosts.unshift(feedPost);
    return postId;
  } catch (error) {
    console.warn('[v10.220] createLinkedMediaReviewFeedPost failed:', error);
    return '';
  }
}

async function updateLinkedMediaReviewFeedPost(item, section) {
  if (!currentUser || typeof db === 'undefined') return false;
  const postId = item.reviewActivityId;
  if (!postId) return false;
  const reviewText = String(item.reviewText || '').slice(0, SHELF_LOG_REVIEW_MAX);
  try {
    const merge = {
      reviewText,
      content: { text: reviewText, headline: 'Wrote a review' },
      'item.rating': Number(item.rating || 0),
      timestamp: Date.now(),
      editedAt: Date.now()
    };
    await db.collection('feed').doc(postId).set(merge, { merge: true });
    if (Array.isArray(window.feedPosts)) {
      const idx = window.feedPosts.findIndex(p => p?.postId === postId);
      if (idx >= 0) {
        const prev = window.feedPosts[idx];
        const prevItem = prev.item || {};
        window.feedPosts[idx] = {
          ...prev,
          reviewText,
          content: { ...(prev.content || {}), text: reviewText, headline: 'Wrote a review' },
          item: { ...prevItem, rating: Number(item.rating || 0) },
          editedAt: Date.now()
        };
      }
    }
    return true;
  } catch (error) {
    console.warn('[v10.220] updateLinkedMediaReviewFeedPost failed:', error);
    return false;
  }
}

/* v10.705: After a write-a-review save, push the resulting feed post into
   the in-memory friend-activity live stream so the user's own activity feed
   reflects it immediately — no Firestore re-fetch round-trip latency before
   the "Played / Watched / Listened to / Finished Watching {title}" card with
   the Full Review button shows up at the top.

   Mirrors the 4-call invalidation pattern used by
   submitScreenListActivityPostPrompt (10-activity-feed.js): build activity
   object → pushFriendActivityLiveEvents → null out friendActivityCache and
   friendActivityPromise → loadActivityTabFeed if the activity tab is
   currently visible.

   Safe-defaults all the way down: every external symbol is feature-detected
   (`typeof === 'function'` / `typeof !== 'undefined'`) so if any of the
   activity-feed helpers haven't loaded yet, the save still completes
   silently and the FPReview still opens. */
function pushOwnMediaReviewToActivityFeed(item, section, postId, reviewText) {
  if (!currentUser || !postId || !item) return;
  try {
    const itemSection = section || item.librarySection || item.mediaCategory || activeSection || '';
    const safeItem = {
      id: item.id,
      title: item.title || '',
      cover: item.cover || '',
      year: item.year || '',
      librarySection: itemSection,
      mediaCategory: itemSection,
      tmdbId: item.tmdbId || '',
      malId: item.malId || '',
      rawgId: item.rawgId || '',
      rating: Number(item.rating || 0)
    };
    const activity = {
      postId,
      uid: currentUser.uid,
      timestamp: Date.now(),
      type: 'media-review',
      eventType: 'review',
      visibility: 'friends',
      likes: [],
      replies: [],
      content: { text: String(reviewText || ''), headline: 'Wrote a review' },
      reviewText: String(reviewText || ''),
      reviewSourceItemId: item.id,
      item: safeItem,
      mediaKey: typeof getMediaKey === 'function' ? getMediaKey(safeItem) : '',
      eventKey: `feed:${postId}`
    };
    if (typeof pushFriendActivityLiveEvents === 'function') {
      pushFriendActivityLiveEvents([activity]);
    }
    try { if (typeof friendActivityCache !== 'undefined') friendActivityCache = null; } catch (_) {}
    try { if (typeof friendActivityPromise !== 'undefined') friendActivityPromise = null; } catch (_) {}
    if (typeof loadActivityTabFeed === 'function'
        && typeof activeFriendsTab !== 'undefined'
        && activeFriendsTab === 'activity') {
      try { loadActivityTabFeed(); } catch (e) { console.warn('[v10.705] loadActivityTabFeed failed:', e); }
    }
  } catch (e) {
    console.warn('[v10.705] pushOwnMediaReviewToActivityFeed failed:', e);
  }
}

window.openShelfLogComposer = openShelfLogComposer;
window.closeShelfLogComposer = closeShelfLogComposer;

function openCardCommentComposer(itemId) {
  const item = (data[activeSection] || []).find(i => i?.id === itemId);
  if (!item) return;
  if (viewingUser) return;
  // v10.217: route watched/played "+" taps through the new log composer page.
  // Falls through to the legacy single-line modal elsewhere.
  if (shouldRouteToShelfLogComposer(activeSection, item)) {
    openShelfLogComposer(itemId);
    return;
  }
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
    /* v10.69: partial update — the only visible card change after a delete is
       the comment slot. Skip full grid render. lastEditedAt still got updated
       (see deleteCardCommentInternal) so a future render() resorts correctly. */
    updateCardCommentUI(item);
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
  /* v10.69: partial update — comment save changes only the per-card slot.
     Was a full grid render(). updateCardCommentUI is a no-op if the slot
     isn't currently mounted, so still safe. */
  try { updateCardCommentUI(item); } catch (uiErr) { console.warn('[v10.69] updateCardCommentUI threw:', uiErr); }
  try {
    if (isEdit && item.cardComment.linkedActivityId) {
      await updateLinkedCardCommentFeedPost(item);
    } else {
      const postId = await createLinkedCardCommentFeedPost(item);
      if (postId) {
        item.cardComment.linkedActivityId = postId;
        try { save(); } catch (saveErr2) { console.warn('[v843] second save() threw:', saveErr2); }
        /* v10.69: linkedActivityId is metadata, not visible on the card —
           no UI update needed here. (Previously this was a 2nd full render.) */
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
  /* v10.69: partial update — comment delete touches only the per-card slot. */
  deleteCardCommentInternal(item).then(() => updateCardCommentUI(item));
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

/* v10.550: Report / flag content sheet — App Store guideline 1.2.0.
   Called from:
     • Full-page review viewer (non-owner three-dot menu)
     • DM thread overflow menu
   Writes a doc to Firestore `reports/{autoId}` and shows a toast.
   contentType: 'review' | 'dm_user'
   targetUid:   uid of the person being reported
   targetId:    itemId (review) or threadId (DM)
   targetLabel: short human-readable label for the sheet title */
window.openReportSheet = function(contentType, targetUid, targetId, targetLabel) {
  if (document.getElementById('shelfd-report-sheet')) return;
  const reasons = ['Spam', 'Offensive content', 'Harassment', 'Other'];
  const sheet = document.createElement('div');
  sheet.id = 'shelfd-report-sheet';
  sheet.className = 'shelfd-report-sheet-overlay';
  sheet.innerHTML = `
    <div class="shelfd-report-sheet-scrim" data-report-dismiss></div>
    <div class="shelfd-report-sheet-panel" role="dialog" aria-modal="true" aria-label="Report content">
      <div class="shelfd-report-sheet-handle" aria-hidden="true"></div>
      <div class="shelfd-report-sheet-title">Report ${escHtml(targetLabel || 'content')}</div>
      <div class="shelfd-report-sheet-sub">What's the issue?</div>
      ${reasons.map(r => `
        <button type="button" class="shelfd-report-sheet-option" data-reason="${escAttr(r)}">${escHtml(r)}</button>
      `).join('')}
      <button type="button" class="shelfd-report-sheet-cancel" data-report-dismiss>Cancel</button>
    </div>
  `;

  function dismiss() {
    sheet.classList.remove('is-open');
    setTimeout(() => { try { sheet.remove(); } catch (_) {} }, 260);
  }

  sheet.querySelectorAll('[data-report-dismiss]').forEach(el => {
    el.addEventListener('click', e => { e.stopPropagation(); dismiss(); });
  });

  sheet.querySelectorAll('[data-reason]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const reason = btn.getAttribute('data-reason');
      dismiss();
      try {
        if (typeof currentUser !== 'undefined' && currentUser && typeof db !== 'undefined' && db) {
          await db.collection('reports').add({
            reportedBy: currentUser.uid,
            reportedUid: String(targetUid || ''),
            contentType: String(contentType || ''),
            contentId: String(targetId || ''),
            reason: reason,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
      } catch (err) {
        console.warn('[report] Firestore write failed:', err);
      }
      if (typeof showToast === 'function') {
        showToast('Report submitted. Thank you.', { durationMs: 3500 });
      }
    });
  });

  document.body.appendChild(sheet);
  requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('is-open')));
};

