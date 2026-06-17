window.__SHELFD_MYLIST_PATCH_VERSION = 'v399-game-status-scroll-toggle-gray';
window.__SHELFD_MYLIST_SWIPE_REMOVED = true;
window.__SHELFD_MYLIST_RENDER_RECOVERY = true;
window.__SHELFD_MYLIST_CONTROLS_STAR_CACHE_BUSTER = true;
let activeGamePlayingFilter = 'live';


function isGamesPlayingMergedView(section = activeSection, tab = activeTab) {
  return section === 'games' && tab === 'watching';
}

function normalizeGamePlayingFilter(value = '') {
  if (value === 'watching') return 'watching';
  if (value === 'competitive') return 'competitive';
  if (value === 'party') return 'party';
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
        : activeFilter === 'party'
          ? ['party']
          : ['watching', 'live', 'competitive', 'party'];
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

  const visible = isGamesPlayingMergedView() && !String(searchQuery || '').trim();
  wrap.style.display = visible ? '' : 'none';
  if (!visible) return;

  activeGamePlayingFilter = normalizeGamePlayingFilter(activeGamePlayingFilter);
  const singleCount = items.filter(i => i.status === 'watching').length;
  const competitiveCount = items.filter(isCompetitiveGameItem).length;
  const liveCount = items.filter(i => i.status === 'live' && !isCompetitiveGameItem(i)).length;
  const partyCount = items.filter(i => i.status === 'party').length;
  const searchActive = !!String(searchQuery || '').trim();
  wrap.classList.toggle('search-active', searchActive);

  /* v10.974: left → right order Competitive · Live Games · Single Player.
     v12.024: + Party Games as a fourth playthrough type. */
  const TOGGLES = [
    { key: 'competitive', label: 'Competitive', count: competitiveCount },
    { key: 'live', label: 'Live Games', count: liveCount },
    { key: 'watching', label: 'Single Player', count: singleCount },
    { key: 'party', label: 'Party Games', count: partyCount }
  ];

  /* v10.233: build the bar ONCE, then update it in place. The old code
     re-assigned `wrap.innerHTML` on every switch, which destroyed the DOM
     each time — so the active fill could never animate, it just popped to
     the new tab. Now a single sliding `.games-playing-toggle-indicator`
     persists across renders and glides (transform-only, 120fps) to whatever
     tab is active. */
  let card = wrap.querySelector('.games-playing-subfilter-card');
  const freshBuild = !card;
  if (freshBuild) {
    wrap.innerHTML = `
      <div class="games-playing-subfilter-card" role="group" aria-label="Playing game type">
        <span class="games-playing-toggle-indicator" aria-hidden="true"></span>
        ${TOGGLES.map(t => `
          <button class="games-playing-toggle" type="button" data-playing="${t.key}" onclick="switchGamePlayingFilter('${t.key}')">
            <span>${t.label}</span><small>${t.count}</small>
          </button>`).join('')}
      </div>
    `;
    card = wrap.querySelector('.games-playing-subfilter-card');
  }

  // Update active state + counts in place — no innerHTML wipe.
  TOGGLES.forEach(t => {
    const btn = card.querySelector(`.games-playing-toggle[data-playing="${t.key}"]`);
    if (!btn) return;
    const isActive = t.key === activeGamePlayingFilter;
    btn.classList.toggle('active', isActive);
    const small = btn.querySelector('small');
    if (small) {
      small.textContent = t.count;
      small.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    }
  });

  // Keep the fill aligned across viewport/orientation changes (it's
  // positioned with absolute pixel values). Bound once, repositions silently.
  if (freshBuild && !window.__gamePlayingIndicatorResizeBound) {
    window.__gamePlayingIndicatorResizeBound = true;
    window.addEventListener('resize', () => {
      const c = document.querySelector('#games-playing-subfilter .games-playing-subfilter-card');
      if (c && c.offsetParent !== null) positionGamePlayingIndicator(c, activeGamePlayingFilter, false);
    });
  }

  // Slide the fill indicator to the active tab. Animate only when the bar
  // already existed (a real switch); place instantly on first build.
  positionGamePlayingIndicator(card, activeGamePlayingFilter, !freshBuild);
}

/* v10.233: position the sliding fill under the active toggle. Measures the
   active button's box (handles gaps/padding/any width diff automatically)
   and moves the indicator there. Only `transform` carries a CSS transition,
   so the motion stays GPU-composited and smooth at 120Hz; width/height are
   set instantly (the tabs are equal width, so there's nothing to morph). */
function positionGamePlayingIndicator(card, activeKey, animate) {
  if (!card) return;
  const indicator = card.querySelector('.games-playing-toggle-indicator');
  const btn = card.querySelector(`.games-playing-toggle[data-playing="${activeKey}"]`);
  if (!indicator || !btn) return;
  const place = () => {
    if (!btn.offsetWidth) return; // not laid out yet — skip, a later render retries
    // Measure against the card's padding edge (the indicator's abs-position
    // origin). Subtracting the card border keeps it pixel-exact despite the
    // card's 1px border.
    const cs = getComputedStyle(card);
    const bl = parseFloat(cs.borderLeftWidth) || 0;
    const bt = parseFloat(cs.borderTopWidth) || 0;
    const cardRect = card.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const x = btnRect.left - cardRect.left - bl;
    const y = btnRect.top - cardRect.top - bt;
    if (!animate) indicator.style.transition = 'none';
    indicator.style.width = btnRect.width + 'px';
    indicator.style.height = btnRect.height + 'px';
    indicator.style.transform = `translate(${x}px, ${y}px)`;
    indicator.style.opacity = '1';
    if (!animate) {
      void indicator.offsetWidth; // commit the no-transition placement
      indicator.style.transition = '';
    }
  };
  if (animate) place();
  else requestAnimationFrame(place); // let first-build layout settle, then place silently
}

const MYLIST_GLOBAL_SEARCH_SECTIONS = ['movies', 'shows', 'anime', 'games', 'music'];
const MYLIST_GLOBAL_SEARCH_STATUSES = {
  movies: new Set(['planned', 'watched', 'paused']),
  shows: new Set(['watching', 'planned', 'watched', 'paused']),
  anime: new Set(['watching', 'planned', 'watched', 'paused']),
  games: new Set(['watching', 'live', 'competitive', 'party', 'planned', 'watched', 'wishlist']),
  /* v10.897: music dropped "In Rotation" (storage 'watching'). Only
     Listened + Planned remain. */
  music: new Set(['planned', 'watched'])
};

function getMyListSearchContextSection(trigger = null) {
  const node = trigger || (typeof window !== 'undefined' ? window.event?.target : null);
  return String(node?.closest?.('[data-library-section]')?.dataset?.librarySection || '').trim();
}

function getMyListGlobalSearchText(item = {}, section = '') {
  const fields = [
    item.title,
    item.name,
    item.displayTitle,
    item.originalTitle,
    item.englishTitle,
    item.romajiTitle,
    item.nativeTitle,
    item.artist,
    item.album,
    item.year,
    section
  ];
  if (Array.isArray(item.artists)) fields.push(...item.artists);
  if (Array.isArray(item.genreNames)) fields.push(...item.genreNames);
  if (Array.isArray(item.genres)) fields.push(...item.genres.map(entry => typeof entry === 'string' ? entry : entry?.name));
  if (Array.isArray(item.tracks)) fields.push(...item.tracks.map(track => track?.title || track?.name));
  return fields.filter(Boolean).join(' ').toLowerCase();
}

function collectMyListGlobalSearchResults(source = null, query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const listData = source || (typeof getVisibleListData === 'function' ? getVisibleListData() : data);
  const results = [];
  MYLIST_GLOBAL_SEARCH_SECTIONS.forEach(section => {
    const allowedStatuses = MYLIST_GLOBAL_SEARCH_STATUSES[section];
    const items = Array.isArray(listData?.[section]) ? listData[section] : [];
    items.forEach((item, index) => {
      if (!item || !allowedStatuses?.has(String(item.status || ''))) return;
      if (!getMyListGlobalSearchText(item, section).includes(q)) return;
      results.push({ item, section, status: String(item.status || ''), index });
    });
  });
  return results;
}

function getMyListGlobalSearchRenderTab(entry = {}) {
  const section = entry.section || '';
  const status = entry.status || entry.item?.status || '';
  if (section === 'games' && (status === 'live' || status === 'competitive')) return 'watching';
  return status || 'planned';
}

function sortMyListGlobalSearchResults(entries = [], sortKey = '', stateKey = '') {
  if (!Array.isArray(entries) || entries.length < 2) return entries;
  const key = sortKey === 'custom' ? 'recently-added' : (sortKey || 'recently-added');
  if (typeof applySortOrder !== 'function') return entries;
  const sortable = entries.map((entry, index) => ({
    ...(entry.item || {}),
    __mylistGlobalSearchIndex: index
  }));
  return applySortOrder(sortable, key, stateKey || 'global-search')
    .map(item => entries[item.__mylistGlobalSearchIndex])
    .filter(Boolean);
}

function renderMyListCardForSearchResult(entry = {}) {
  const item = entry.item;
  if (!item) return '';
  const previousSection = activeSection;
  const previousTab = activeTab;
  try {
    activeSection = entry.section || previousSection;
    activeTab = getMyListGlobalSearchRenderTab(entry);
    return renderCard(item);
  } finally {
    activeSection = previousSection;
    activeTab = previousTab;
  }
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
  if (currentUser?.uid && DOC_REF.id !== currentUser.uid) {
    console.warn('[shelfd-auth] corrected stale library doc ref before load', {
      docUid: DOC_REF.id,
      authUid: currentUser.uid
    });
    DOC_REF = db.collection("watchlist").doc(currentUser.uid);
    data = getEmptyListData();
    ownDataCache = null;
  }
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
    if (currentUser) localStorage.setItem("screenlist-own-data-backup-" + currentUser.uid, JSON.stringify(safeData));
    else localStorage.setItem("watchlist-tracker-data", JSON.stringify(safeData));
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
        await syncCreatorPublicProfileMirror(currentUser, userProfile, safeData, { reason: 'debouncedFullLibrarySave' });
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
/* v11.131: status pill text-only treatment is scoped to body.mylist-section-X
   (see 01-mylists-cards-episodes.css). switchSection sets that class, but the
   load() → render() boot path sets `activeSection` directly without toggling
   the body class — so on cold-cache reopen the first paint can show the BASE
   .status-pill (border + transparent fill) instead of the section's text-only
   look. Result: the "Watching" pill renders as a thin outlined oval until the
   user touches a section tab. Syncing the body class at the top of render()
   makes every paint correct regardless of how activeSection was set. */
function syncMyListBodySectionClass() {
  try {
    ['movies','shows','anime','games','manga','books','music'].forEach(sec => {
      document.body.classList.toggle('mylist-section-' + sec, sec === activeSection);
    });
  } catch (_) {}
}

function syncMyListSectionButtonState(sectionOverride = activeSection) {
  document.querySelectorAll(".section-btn").forEach(b => {
    const section = b.dataset.section;
    const visible = isSectionVisibleInMyLists(section);
    const isActive = visible && section === sectionOverride;
    b.hidden = !visible;
    b.setAttribute('aria-hidden', visible ? 'false' : 'true');
    b.setAttribute('aria-selected', isActive ? 'true' : 'false');
    b.classList.toggle('screenlist-hidden-list-tab', !visible);
    b.style.display = visible ? "" : "none";
    b.classList.toggle("active", isActive);
  });
}

/* v11.391: locked "Private account" state shown in the list content area when
   viewing a non-friend's shelf. The banner, category tabs and status tabs stay
   visible (per spec); only the list grid is replaced. */
function renderPrivateShelfLock(grid, empty) {
  if (empty) empty.style.display = 'none';
  try { if (typeof renderMyListLoadMoreControl === 'function') renderMyListLoadMoreControl(0, 0); } catch (_) {}
  if (!grid) return;
  grid.innerHTML = `<div class="shelf-private-lock" role="status" aria-live="polite">
    <span class="shelf-private-lock-glyph" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10.5" rx="2.6"/><path d="M8 10.5V7.2a4 4 0 0 1 8 0v3.3"/></svg>
    </span>
    <div class="shelf-private-lock-title">Private account</div>
    <div class="shelf-private-lock-sub">Follow this account to see their shelf.</div>
  </div>`;
}

/* v11.397: cards HTML for the CURRENT activeSection/activeTab — the same
   filter+sort+limit+renderCard pipeline render() uses for #cards-grid, factored
   out so the status-swipe gesture (js/40) can render the incoming status's cards
   into a transient panel during a swipe. Returns { html, empty }. */
function buildMyListCardsHTMLForActiveTab(maxCards = 0, startIndex = 0) {
  const visibleData = getVisibleListData();
  const items = Array.isArray(visibleData[activeSection]) ? visibleData[activeSection] : [];
  const trimmedSearchQuery = String(searchQuery || '').trim();
  const isGlobalLibrarySearch = !!trimmedSearchQuery;
  const stateKey = getSortStateKey();
  const activeSortKey = getActiveSortKey();
  const baseFiltered = isGlobalLibrarySearch
    ? collectMyListGlobalSearchResults(visibleData, trimmedSearchQuery)
    : items.filter(i => itemMatchesActiveListStatus(i));
  const filtered = isGlobalLibrarySearch
    ? sortMyListGlobalSearchResults(baseFiltered, activeSortKey, stateKey)
    : applySortOrder(baseFiltered, activeSortKey, stateKey);
  if (!filtered.length) return { html: '', empty: true };
  const renderLimitKey = getMyListRenderLimitKey(activeSortKey);
  let visibleLimit = getMyListVisibleLimit(renderLimitKey, filtered.length);
  /* v11.427: the status-swipe preview passes maxCards so it builds ONLY the
     immediately-visible cards (not the full saved limit, which can be 36+ on an
     expanded Watched/Paused tab). Keeps every preview equally light regardless of
     how many items the status holds; the rest are built by render() at commit. */
  if (maxCards > 0) visibleLimit = Math.min(visibleLimit, maxCards);
  const visibleFiltered = filtered.slice(Math.max(0, startIndex), visibleLimit);
  let html;
  if (isGlobalLibrarySearch) html = visibleFiltered.map(entry => renderMyListCardForSearchResult(entry)).join('');
  else if (activeSortKey === 'custom') html = visibleFiltered.map(item => renderCard(item, true)).join('');
  else html = visibleFiltered.map(item => renderCard(item)).join('');
  return { html, empty: false };
}

/* Cards HTML for a specific status tab (temporarily swaps activeTab, restores
   it). Used by the status-swipe gesture to preview the incoming page. */
function buildMyListCardsHTMLForTab(targetTab, maxCards = 0) {
  const savedTab = activeTab;
  activeTab = targetTab;
  try {
    const result = buildMyListCardsHTMLForActiveTab(maxCards);
    return result.empty
      ? '<div class="mylist-status-swipe-empty">Nothing in this list yet.</div>'
      : result.html;
  } catch (e) {
    return '';
  } finally {
    activeTab = savedTab;
  }
}
window.buildMyListCardsHTMLForTab = buildMyListCardsHTMLForTab;

function render() {
  syncMyListBodySectionClass();
  ensureGameWishlistStatusTab();
  ensureActiveSectionVisible();
  renderMyListEditControls();
  const visibleData = getVisibleListData();
  const items = Array.isArray(visibleData[activeSection]) ? visibleData[activeSection] : [];
  activeTab = normalizeVisibleMyListStatusTab(activeTab, activeSection);
  const stateKey = getSortStateKey();
  const activeSortKey = getActiveSortKey();
  const trimmedSearchQuery = String(searchQuery || '').trim();
  const isGlobalLibrarySearch = !!trimmedSearchQuery;
  /* v10.981: non-empty search is global across the Shelfd library. Empty
     search keeps the standard active section/status view clean. */
  const baseFiltered = isGlobalLibrarySearch
    ? collectMyListGlobalSearchResults(visibleData, trimmedSearchQuery)
    : items.filter(i => itemMatchesActiveListStatus(i));
  const filtered = isGlobalLibrarySearch
    ? sortMyListGlobalSearchResults(baseFiltered, activeSortKey, stateKey)
    : applySortOrder(baseFiltered, activeSortKey, stateKey);

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
    else if (status === 'party') acc.party++;
    else if (status === 'planned') acc.planned++;
    else if (status === 'watched') acc.watched++;
    else if (status === 'wishlist') acc.wishlist++;
    else if (status === 'paused') acc.paused++;
    else if (status === 'dropped') acc.dropped++;
    return acc;
  }, { watching: 0, live: 0, competitive: 0, party: 0, planned: 0, watched: 0, wishlist: 0, paused: 0, dropped: 0 });
  document.getElementById("count-live").textContent = counts.live;
  document.getElementById("count-watching").textContent = activeSection === 'games'
    ? counts.watching + counts.live + counts.competitive + counts.party
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
  syncMyListSectionButtonState();
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
    /* v10.897: music now exposes only Planned + Listened (the "In
       Rotation" / storage 'watching' tab was removed). Other status
       tabs (paused/wishlist/watching) are hidden under music. */
    if (b.dataset.tab === "paused") {
      b.style.display = (activeSection === "games" || activeSection === "music") ? "none" : "";
    }
    if (b.dataset.tab === "wishlist") {
      b.style.display = activeSection === "games" ? "" : "none";
      b.childNodes[0].textContent = "Wishlist";
    }
    if (b.dataset.tab === "watching") {
      /* v10.897: hide the 'watching' tab for music too. */
      b.style.display = (activeSection === "movies" || activeSection === "music") ? "none" : "";
      b.childNodes[0].textContent = activeSection === "games"
        ? "Playing"
        : isReadingSection(activeSection) ? "Reading" : "Watching";
    }
    if (b.dataset.tab === "planned") {
      b.childNodes[0].textContent = activeSection === "games"
        ? "Planning"
        : activeSection === "music"
          ? "Planning"
          : isReadingSection(activeSection) ? "TBR" : "Planning";
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
  grid?.classList.toggle('mylist-global-search-results', isGlobalLibrarySearch);

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

  // Inject / update the Steam refresh-sync button (games shelf, own shelf only).
  if (typeof updateSteamSyncToolbarButton === 'function') updateSteamSyncToolbarButton();

  // v11.391: private-account gate — a non-friend never sees the lists; every
  // category and status shows the "Private account" lock instead.
  const shelfLockedPrivate = !!(viewingUser && typeof isShelfUserShelfPrivate === 'function' && isShelfUserShelfPrivate(viewingUser.uid));
  document.body.classList.toggle('shelf-locked-private', shelfLockedPrivate);
  if (shelfLockedPrivate) {
    renderPrivateShelfLock(grid, empty);
    return;
  }

  if (filtered.length === 0) {
    grid.innerHTML = "";
    renderMyListLoadMoreControl(0, 0);
    empty.style.display = "block";
    const emptyIcon = document.getElementById("empty-icon");
    if (emptyIcon) {
      emptyIcon.textContent = '';
      emptyIcon.style.display = 'none';
    }
    const statusLabel = activeTab === "planned" ? "planning" : activeTab;
    const sectionLabel = getSectionLabel(activeSection);
    const emptyText = isGamesPlayingMergedView()
      ? (isGlobalLibrarySearch
          ? 'No matching games yet'
          : activeGamePlayingFilter === 'competitive'
            ? 'No competitive games yet'
          : activeGamePlayingFilter === 'watching'
            ? 'No single-player games yet'
            : 'No live games yet')
      : activeSection === 'games' && activeTab === 'planned'
        ? 'No planning games yet'
        : activeSection === 'games' && activeTab === 'watched'
          ? 'No played games yet'
          : activeSection === 'games' && activeTab === 'wishlist'
            ? 'No wishlist games yet'
            : `No ${statusLabel} ${sectionLabel} yet`;
    document.getElementById("empty-text").textContent = isGlobalLibrarySearch
      ? 'No matching shelf items yet'
      : emptyText;
    if (emptySub) {
      emptySub.textContent = isGlobalLibrarySearch
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
  /* v11.428: a NON-capped render() rebuilds the WHOLE grid, so cancel any pending
     swipe remainder-fill (a full render already has everything → never double-
     append). A CAPPED render (swipe commit) builds only the visible cards now and
     records the remainder to append after the settle (commitMyListStatusSwipeTab). */
  if (_swipeCommitVisibleCap === 0) {
    if (_swipeFillTimer) { clearTimeout(_swipeFillTimer); _swipeFillTimer = null; }
  }
  let buildLimit = visibleLimit;
  if (_swipeCommitVisibleCap > 0 && buildLimit > _swipeCommitVisibleCap) {
    buildLimit = _swipeCommitVisibleCap;
    _swipeRenderFillPending = { startIndex: buildLimit, fullLimit: visibleLimit, total: filtered.length, key: renderLimitKey };
  }
  const visibleFiltered = filtered.slice(0, buildLimit);

  if (isGlobalLibrarySearch) {
    grid.innerHTML = visibleFiltered.map(entry => renderMyListCardForSearchResult(entry)).join("");
  } else if (activeSortKey === 'custom') {
    grid.innerHTML = visibleFiltered.map(item => renderCard(item, true)).join("");
  } else {
    grid.innerHTML = visibleFiltered.map(item => renderCard(item)).join("");
  }
  if (!isGlobalLibrarySearch && typeof rememberRenderedSortOrder === 'function') rememberRenderedSortOrder(stateKey, filtered);
  renderMyListLoadMoreControl(visibleFiltered.length, filtered.length, renderLimitKey);

  /* v11.514: re-assert the dev-only My List light-mode class on #mylist-view
     each render (no-op for non-dev accounts and in dark mode). */
  if (typeof applyMyListThemePilot === 'function') applyMyListThemePilot();

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

  /* v11.088: kick off the Jikan series-root resolver so anime seasons/parts
     group under one parent (MyAnimeList-style). Self-guarded + runs once per
     session; the deferral keeps it off the initial render path. */
  if (typeof resolveAnimeSeriesRootsInBackground === 'function' && !_animeSeriesRootResolveDone) {
    setTimeout(() => { try { resolveAnimeSeriesRootsInBackground(); } catch (_) {} }, 1500);
  }
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
  /* v11.041: allow scrubbing down to 0 (no rating). */
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
  /* v11.041: val 0 is allowed — releasing at 0 clears the rating
     (the same-value guard below still no-ops a 0→0 release). */
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
  /* v11.211: ALWAYS render the value span (empty when unrated) instead of
     only when cleanRating > 0. Previously a 0-rating widget had no
     `.music-rating-value` element, so the first scrub tick CREATED it mid-row
     — adding a whole element and shifting the centered rating portion. With
     the span always present (and given a fixed-width reserved slot in CSS for
     the album-shelf context), scrubbing only changes the digits inside that
     stable slot; the stars never move. */
  const label = cleanRating > 0
    ? (typeof formatRatingValueForSection === 'function'
        ? formatRatingValueForSection(cleanRating, 'music')
        : (halfStep ? (cleanRating / 2).toFixed(1) : String(cleanRating)))
    : '';
  html += `<span class="music-rating-value">${label}</span>`;
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
  /* v11.215: clear any stale cached midpoints so the next scrub rebuilds
     them fresh at lock-in. */
  c._musicScrubMidpoints = null;
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
  const justLockedIn = c.dataset.scrubbing !== 'true';
  c.dataset.scrubbing = 'true';
  /* v11.216: mark scrubbing so the committed `.lit` stars defer to the live
     `.lit-hover` preview (see .music-rating.is-scrubbing CSS) — fixes stars
     staying stuck at the saved rating when scrubbing DOWN. */
  c.classList.add('is-scrubbing');
  e.preventDefault();
  /* v10.407: scrub works for either widget variant — half-step or full
     10-star — by selecting both star classes.
     v11.215: CACHE the star midpoints once at lock-in instead of re-reading
     getBoundingClientRect every move. ROOT-CAUSE FIX for "can't scrub below
     the current rating": the `.music-rating-half` buttons have a sticky
     :hover { transform: scale(1.18) } on iOS touch. Dragging LEFT over the
     already-rated/lit stars hovered+scaled them, which shifted their LIVE
     bounding-rect midpoints leftward — so `touch.clientX >= midpoint` stayed
     true and `val` got pinned at the saved rating, blocking any scrub below
     it. Reading the midpoints ONCE (before hover-scale compounds) makes the
     value track the finger linearly in both directions. Mirrors the cached
     approach the rating-bubble + episode scrub handlers already use. */
  const stars = Array.from(c.querySelectorAll('.music-rating-half, .music-rating-full'));
  if (justLockedIn || !c._musicScrubMidpoints || c._musicScrubMidpoints.length !== stars.length) {
    c._musicScrubMidpoints = stars.map(btn => {
      const rect = btn.getBoundingClientRect();
      return rect.left + rect.width / 2;
    });
  }
  const midpoints = c._musicScrubMidpoints;
  let val = 0;
  for (let i = 0; i < midpoints.length; i++) {
    if (touch.clientX >= midpoints[i]) val = i + 1;
  }
  /* v11.041: allow scrubbing down to 0 (no rating) — clears all
     lit-hover and the preview label reads empty at 0. */
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
  label.textContent = val > 0
    ? (typeof formatRatingValueForSection === 'function' ? formatRatingValueForSection(val, 'music') : String(val))
    : '';
}
function musicRatingTouchEnd(e) {
  const c = e.currentTarget;
  c._musicScrubMidpoints = null; /* v11.215: drop cached midpoints. */
  c.classList.remove('is-scrubbing'); /* v11.216: end scrub-preview mode. */
  if (c.dataset.scrubbing !== 'true') return;
  const val = parseInt(c.dataset.scrubVal || '0', 10);
  c.dataset.scrubVal = '0';
  c.dataset.scrubbing = 'false';
  c.querySelectorAll('.music-rating-half, .music-rating-full').forEach(b => b.classList.remove('lit-hover'));
  /* v11.041: val 0 is allowed — releasing at 0 commits "no rating". */
  e.preventDefault();
  rate(c.dataset.itemId, c.dataset.prefix, val);
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

async function persistOwnListDataImmediate(nextData = null, options = {}) {
  const safeData = typeof compactImportedAnimeForStorage === 'function'
    ? compactImportedAnimeForStorage(nextData || data)
    : cloneListData(nextData || data);
  data = cloneListData(safeData);
  ownDataCache = cloneListData(safeData);
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  const hasDirectWriter = typeof writeOwnDataDirect === 'function';
  if (!hasDirectWriter) {
    try {
      if (typeof writeOwnLocalBackupSafely === 'function') {
        writeOwnLocalBackupSafely(safeData, options.localBackupContext || 'persistOwnListDataImmediate');
      } else if (currentUser) {
        localStorage.setItem('screenlist-own-data-backup-' + currentUser.uid, JSON.stringify(safeData));
      } else {
        localStorage.setItem('watchlist-tracker-data', JSON.stringify(safeData));
      }
    } catch (lsErr) {
      console.warn('[v10.851] local library backup write failed during immediate save:', lsErr && lsErr.name, lsErr && lsErr.message);
    }
  }
  if (hasDirectWriter) {
    await writeOwnDataDirect(safeData, options);
  } else if (DOC_REF) {
    await persistOwnDataToFirestore(safeData, options);
  } else {
    save();
  }
  if (options.verifyGameItem) {
    await verifyShelfLogGameLibraryItemPersisted(options.verifyGameItem, safeData, options);
  }
  return safeData;
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

function isMyListGameProfilePlaceholderValue(value = '') {
  const text = String(value ?? '').trim();
  return !text || text === 'Add' || text === '-';
}

function getMyListGameProfileStats(item = {}) {
  const stats = item?.competitiveStats && typeof item.competitiveStats === 'object' ? item.competitiveStats : {};
  const account = item?.trackerAccount && typeof item.trackerAccount === 'object' ? item.trackerAccount : {};
  return {
    currentRank: getMyListGameProfileStatValue({ ...item, competitiveStats: stats, trackerAccount: account }, ['competitiveStats.currentRank', 'currentRank', 'trackerCurrentRank'], '-'),
    peakRank: getMyListGameProfileStatValue({ ...item, competitiveStats: stats, trackerAccount: account }, ['competitiveStats.peakRank', 'peakRank', 'trackerPeakRank'], '-'),
    lifetimeKd: getMyListGameProfileStatValue({ ...item, competitiveStats: stats, trackerAccount: account }, ['competitiveStats.lifetimeKd', 'competitiveStats.kd', 'lifetimeKd', 'gameLifetimeKd', 'trackerKd'], '-'),
    seasonKd: getMyListGameProfileStatValue({ ...item, competitiveStats: stats, trackerAccount: account }, ['competitiveStats.seasonKd', 'seasonKd', 'gameSeasonKd'], '-'),
    trackerUrl: getMyListGameProfileStatValue({ ...item, competitiveStats: stats, trackerAccount: account }, ['competitiveStats.sourceUrl', 'trackerStatsUrl', 'trackerUrl', 'gameTrackerUrl', 'gameStatsUrl', 'statsUrl'], ''),
    highlightsUrl: getMyListGameProfileStatValue({ ...item, competitiveStats: stats }, ['highlightUrl', 'highlightsUrl', 'gameHighlightsUrl', 'clipsUrl', 'competitiveStats.highlightUrl'], ''),
    highlightClips: getMyListGameProfileHighlightClips(item)
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
  openMyListGameProfilePage(key, { edit: true });
}
window.openMyListGameProfileEdit = openMyListGameProfileEdit;

function getMyListGameProfileTrackerGameOptions(item = {}) {
  const stats = item?.competitiveStats && typeof item.competitiveStats === 'object' ? item.competitiveStats : {};
  const selected = stats.gameSlug || item.trackerGameSlug || '';
  if (typeof window.getScreenListTrackerGameOptionsHtml === 'function') {
    return window.getScreenListTrackerGameOptionsHtml(selected);
  }
  return `<option value="${escAttr(selected || 'valorant')}">${escHtml(selected || 'Valorant')}</option>`;
}

const MYLIST_VALORANT_RANK_OPTIONS = [
  ['Iron 1', 'Iron_1_Rank.png'],
  ['Iron 2', 'Iron_2_Rank.png'],
  ['Iron 3', 'Iron_3_Rank.png'],
  ['Bronze 1', 'Bronze_1_Rank.png'],
  ['Bronze 2', 'Bronze_2_Rank.png'],
  ['Bronze 3', 'Bronze_3_Rank.png'],
  ['Silver 1', 'Silver_1_Rank.png'],
  ['Silver 2', 'Silver_2_Rank.png'],
  ['Silver 3', 'Silver_3_Rank.png'],
  ['Gold 1', 'Gold_1_Rank.png'],
  ['Gold 2', 'Gold_2_Rank.png'],
  ['Gold 3', 'Gold_3_Rank.png'],
  ['Platinum 1', 'Platinum_1_Rank.png'],
  ['Platinum 2', 'Platinum_2_Rank.png'],
  ['Platinum 3', 'Platinum_3_Rank.png'],
  ['Diamond 1', 'Diamond_1_Rank.png'],
  ['Diamond 2', 'Diamond_2_Rank.png'],
  ['Diamond 3', 'Diamond_3_Rank.png'],
  ['Ascendant 1', 'Ascendant_1_Rank.png'],
  ['Ascendant 2', 'Ascendant_2_Rank.png'],
  ['Ascendant 3', 'Ascendant_3_Rank.png'],
  ['Immortal 1', 'Immortal_1_Rank.png'],
  ['Immortal 2', 'Immortal_2_Rank.png'],
  ['Immortal 3', 'Immortal_3_Rank.png'],
  ['Radiant', 'Radiant_Rank.png']
];

const MYLIST_MARVEL_RIVALS_RANK_OPTIONS = [
  ['Bronze', 'rank_badge_01.png'],
  ['Silver', 'rank_badge_02.png'],
  ['Gold', 'rank_badge_03.png'],
  ['Platinum', 'rank_badge_04.png'],
  ['Diamond', 'rank_badge_05.png'],
  ['Grandmaster', 'rank_badge_06.png'],
  ['Celestial', 'rank_badge_07.png'],
  ['Eternal', 'rank_badge_08.png'],
  ['One Above All', 'rank_badge_09.png']
];

/* v11.080: Rainbow Six Siege ranks, lowest → highest. Within each tier the
   divisions go V → IV → III → II → I (file _5 → _1, where _1 is the ★ badge),
   then Champion. Badges live in /assets/r6-ranks. */
const MYLIST_R6_RANK_OPTIONS = [
  ['Copper V', 'copper_5.png'],
  ['Copper IV', 'copper_4.png'],
  ['Copper III', 'copper_3.png'],
  ['Copper II', 'copper_2.png'],
  ['Copper I', 'copper_1.png'],
  ['Bronze V', 'bronze_5.png'],
  ['Bronze IV', 'bronze_4.png'],
  ['Bronze III', 'bronze_3.png'],
  ['Bronze II', 'bronze_2.png'],
  ['Bronze I', 'bronze_1.png'],
  ['Silver V', 'silver_5.png'],
  ['Silver IV', 'silver_4.png'],
  ['Silver III', 'silver_3.png'],
  ['Silver II', 'silver_2.png'],
  ['Silver I', 'silver_1.png'],
  ['Gold V', 'gold_5.png'],
  ['Gold IV', 'gold_4.png'],
  ['Gold III', 'gold_3.png'],
  ['Gold II', 'gold_2.png'],
  ['Gold I', 'gold_1.png'],
  ['Platinum V', 'platinum_5.png'],
  ['Platinum IV', 'platinum_4.png'],
  ['Platinum III', 'platinum_3.png'],
  ['Platinum II', 'platinum_2.png'],
  ['Platinum I', 'platinum_1.png'],
  ['Emerald V', 'emerald_5.png'],
  ['Emerald IV', 'emerald_4.png'],
  ['Emerald III', 'emerald_3.png'],
  ['Emerald II', 'emerald_2.png'],
  ['Emerald I', 'emerald_1.png'],
  ['Diamond V', 'diamond_5.png'],
  ['Diamond IV', 'diamond_4.png'],
  ['Diamond III', 'diamond_3.png'],
  ['Diamond II', 'diamond_2.png'],
  ['Diamond I', 'diamond_1.png'],
  ['Champion', 'champion.png']
];

/* v11.081: Counter-Strike 2 ranks, lowest → highest. Badges in /assets/cs2-ranks. */
const MYLIST_CS2_RANK_OPTIONS = [
  ['Silver I', 'silver_1.png'],
  ['Silver II', 'silver_2.png'],
  ['Silver III', 'silver_3.png'],
  ['Silver IV', 'silver_4.png'],
  ['Silver Elite', 'silver_elite.png'],
  ['Silver Elite Master', 'silver_elite_master.png'],
  ['Gold Nova I', 'gold_nova_1.png'],
  ['Gold Nova II', 'gold_nova_2.png'],
  ['Gold Nova III', 'gold_nova_3.png'],
  ['Gold Nova Master', 'gold_nova_master.png'],
  ['Master Guardian I', 'master_guardian_1.png'],
  ['Master Guardian II', 'master_guardian_2.png'],
  ['Master Guardian Elite', 'master_guardian_elite.png'],
  ['Distinguished Master Guardian', 'distinguished_master_guardian.png'],
  ['Legendary Eagle', 'legendary_eagle.png'],
  ['Legendary Eagle Master', 'legendary_eagle_master.png'],
  ['Supreme Master First Class', 'supreme_master_first_class.png'],
  ['The Global Elite', 'the_global_elite.png']
];

const MYLIST_RANK_PICKER_CONFIGS = {
  valorant: {
    className: 'mylist-valorant-rank-field',
    assetBase: '/assets/valorant-ranks',
    options: MYLIST_VALORANT_RANK_OPTIONS,
    normalize: normalizeMyListValorantRankLabel
  },
  marvel: {
    className: 'mylist-marvel-rivals-rank-field',
    assetBase: '/assets/marvel-rivals-ranks',
    options: MYLIST_MARVEL_RIVALS_RANK_OPTIONS,
    normalize: normalizeMyListMarvelRivalsRankLabel
  },
  r6: {
    className: 'mylist-r6-rank-field',
    assetBase: '/assets/r6-ranks',
    options: MYLIST_R6_RANK_OPTIONS,
    normalize: normalizeMyListR6RankLabel
  },
  cs2: {
    className: 'mylist-cs2-rank-field',
    assetBase: '/assets/cs2-ranks',
    options: MYLIST_CS2_RANK_OPTIONS,
    normalize: normalizeMyListCs2RankLabel
  }
};

function normalizeMyListValorantRankLabel(label = '') {
  const clean = String(label || '').trim().replace(/\s+/g, ' ');
  if (!clean) return '';
  const romanMatch = clean.match(/^([a-z]+)\s+(i{1,3})$/i);
  if (romanMatch) {
    return `${romanMatch[1].charAt(0).toUpperCase()}${romanMatch[1].slice(1).toLowerCase()} ${romanMatch[2].length}`;
  }
  return clean.replace(/\b(iron|bronze|silver|gold|platinum|diamond|ascendant|immortal|radiant)\b/gi, word => (
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ));
}

function normalizeMyListMarvelRivalsRankLabel(label = '') {
  const clean = String(label || '').trim().replace(/\s+/g, ' ');
  if (!clean) return '';
  const lower = clean.toLowerCase().replace(/[-_]+/g, ' ');
  if (lower === 'plat') return 'Platinum';
  if (lower === 'one above all' || lower === 'one above all rank') return 'One Above All';
  return lower.replace(/\b(bronze|silver|gold|platinum|diamond|grandmaster|celestial|eternal|one|above|all)\b/g, word => (
    word.charAt(0).toUpperCase() + word.slice(1)
  ));
}

function normalizeMyListR6RankLabel(label = '') {
  const clean = String(label || '').trim().replace(/\s+/g, ' ');
  if (!clean) return '';
  if (/^champion/i.test(clean)) return 'Champion';
  const m = clean.match(/^(copper|bronze|silver|gold|platinum|emerald|diamond)\s*(v|iv|iii|ii|i|[1-5])$/i);
  if (!m) {
    return clean.replace(/\b(copper|bronze|silver|gold|platinum|emerald|diamond|champion)\b/gi, w => (
      w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    ));
  }
  const tier = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  const numToRoman = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V' };
  let div = m[2].toUpperCase();
  if (numToRoman[div]) div = numToRoman[div];
  return `${tier} ${div}`;
}

function normalizeMyListCs2RankLabel(label = '') {
  const clean = String(label || '').trim().replace(/\s+/g, ' ');
  if (!clean) return '';
  const lower = clean.toLowerCase();
  const exact = MYLIST_CS2_RANK_OPTIONS.find(([name]) => name.toLowerCase() === lower);
  if (exact) return exact[0];
  const squash = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const fuzzy = MYLIST_CS2_RANK_OPTIONS.find(([name]) => squash(name) === squash(clean));
  return fuzzy ? fuzzy[0] : clean;
}

function getMyListRankPickerAsset(kind = '', label = '') {
  const config = MYLIST_RANK_PICKER_CONFIGS[kind];
  if (!config) return '';
  const normalized = config.normalize(label).toLowerCase();
  const match = config.options.find(([name]) => name.toLowerCase() === normalized);
  return match ? `${config.assetBase}/${match[1]}` : '';
}

function normalizeMyListRankPickerValue(kind = '', value = '') {
  const config = MYLIST_RANK_PICKER_CONFIGS[kind];
  if (!config) return String(value || '').trim();
  return config.normalize(value);
}

function getMyListGameProfileRankPickerKind(item = {}) {
  const stats = item?.competitiveStats && typeof item.competitiveStats === 'object' ? item.competitiveStats : {};
  const gameSlug = String(stats.gameSlug || item.trackerGameSlug || '').toLowerCase();
  const title = String(item.title || item.name || '').toLowerCase();
  if (gameSlug === 'valorant' || title.includes('valorant')) return 'valorant';
  if (gameSlug === 'marvel-rivals' || title.includes('marvel rivals')) return 'marvel';
  if (gameSlug === 'rainbow-six-siege' || title.includes('rainbow six siege') || title.includes('rainbow 6 siege')) return 'r6';
  if (gameSlug === 'cs2' || title.includes('counter-strike 2') || title.includes('counter strike 2') || title.includes('cs2') || title.includes('csgo')) return 'cs2';
  return '';
}

function getMyListGameProfileTrackerHomeUrl(item = {}) {
  if (String(item?.status || '').toLowerCase() !== 'competitive') return '';
  if (typeof window.getScreenListTrackerGameHomeUrl !== 'function') return '';
  const stats = item?.competitiveStats && typeof item.competitiveStats === 'object' ? item.competitiveStats : {};
  return window.getScreenListTrackerGameHomeUrl({
    title: item.title || item.name || '',
    name: item.name || item.title || '',
    gameSlug: stats.gameSlug || item.trackerGameSlug || ''
  });
}

function renderMyListRankIconPicker(label = '', field = '', value = '', kind = '') {
  const config = MYLIST_RANK_PICKER_CONFIGS[kind] || MYLIST_RANK_PICKER_CONFIGS.valorant;
  const currentValue = isMyListGameProfilePlaceholderValue(value) ? '' : config.normalize(value);
  const selectedAsset = getMyListRankPickerAsset(kind, currentValue);
  const optionsHtml = config.options.map(([name, file]) => {
    const activeClass = name.toLowerCase() === currentValue.toLowerCase() ? ' active' : '';
    return `
      <button class="mylist-rank-picker-option${activeClass}" type="button" data-rank-value="${escAttr(name)}" onclick="selectMyListRankIconPicker(event,'${escAttr(field)}','${escAttr(name)}','${escAttr(kind)}')">
        <img src="${escAttr(config.assetBase)}/${escAttr(file)}" alt="" loading="lazy">
        <span>${escHtml(name)}</span>
      </button>
    `;
  }).join('');
  return `
    <div class="mylist-game-profile-stat mylist-game-profile-editable-stat mylist-rank-picker-field ${escAttr(config.className)}" data-rank-field="${escAttr(field)}" data-rank-kind="${escAttr(kind)}">
      <span>${escHtml(label)}</span>
      <input data-game-profile-edit-field="${escAttr(field)}" type="hidden" value="${escAttr(currentValue)}">
      <button class="mylist-rank-picker-trigger" type="button" onclick="toggleMyListRankIconPicker(event,'${escAttr(field)}')" aria-haspopup="listbox" aria-expanded="false">
        ${selectedAsset ? `<img src="${escAttr(selectedAsset)}" alt="" aria-hidden="true">` : '<span class="mylist-rank-picker-empty" aria-hidden="true"></span>'}
        <strong>${escHtml(currentValue || 'Select rank')}</strong>
      </button>
      <div class="mylist-rank-picker-menu" role="listbox" aria-label="${escAttr(label)}">
        ${optionsHtml}
      </div>
    </div>
  `;
}

/* v11.076: game-profile edit page — Platform is a fixed dropdown (no free
   text), matching the native Tracker-title <select>. Friendly labels, sorted
   alphabetically. normalizeGameProfilePlatformLabel maps any legacy/free-text
   value (pc, ps5, "Xbox Series X", etc.) to one of the nine options on open. */
const SCREENLIST_GAME_PROFILE_PLATFORM_LIST = ['Android', 'Epic Games', 'iOS', 'Mobile', 'Nintendo Switch', 'PC', 'PlayStation', 'Steam', 'Xbox'];
function normalizeGameProfilePlatformLabel(value = '') {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return '';
  const exact = SCREENLIST_GAME_PROFILE_PLATFORM_LIST.find(p => p.toLowerCase() === v);
  if (exact) return exact;
  if (/playstation|psn|ps[345]/.test(v)) return 'PlayStation';
  if (/xbox|xbl|series\s*[xs]|xbone/.test(v)) return 'Xbox';
  if (/steam/.test(v)) return 'Steam';
  if (/epic/.test(v)) return 'Epic Games';
  if (/switch|nintendo/.test(v)) return 'Nintendo Switch';
  if (/ios|iphone|ipad/.test(v)) return 'iOS';
  if (/android/.test(v)) return 'Android';
  if (/mobile/.test(v)) return 'Mobile';
  if (/\bpc\b|origin|ubi|windows|desktop|battle/.test(v)) return 'PC';
  return '';
}
function getMyListGameProfilePlatformOptions(selected = '') {
  const sel = normalizeGameProfilePlatformLabel(selected);
  const placeholder = `<option value="" disabled${sel ? '' : ' selected'}>Select platform</option>`;
  return placeholder + SCREENLIST_GAME_PROFILE_PLATFORM_LIST.map(name =>
    `<option value="${escAttr(name)}"${name === sel ? ' selected' : ''}>${escHtml(name)}</option>`
  ).join('');
}

/* v11.079: interactive rating in the game-profile hero (replaces the old
   descriptor copy). Always-visible 5-star half-step row in the same visual
   family as the Write-a-Review composer. Tapping the left/right half of a star
   commits the game's overall rating through the shared rate() pipeline (which
   persists + animates), then refreshes this widget in place. */
function renderMyListGameProfileHeroRating(item = {}, itemId = '') {
  const rating = Number(item?.rating || 0);
  const interactive = !viewingUser;
  const valueLabel = rating > 0
    ? `${(rating / 2) % 1 === 0 ? String(rating / 2) : (rating / 2).toFixed(1)} / 5`
    : 'Not rated';
  let slots = '';
  for (let star = 1; star <= 5; star++) {
    const leftVal = star * 2 - 1;
    const rightVal = star * 2;
    let pct = 0;
    if (rating >= rightVal) pct = 100;
    else if (rating >= leftVal) pct = 50;
    const hits = interactive
      ? `<button type="button" class="mylist-game-profile-rating-hit mylist-game-profile-rating-hit-left" aria-label="Rate ${leftVal / 2} of 5" onclick="rateMyListGameProfileHeroRating('${escAttr(itemId)}',${leftVal},event)"></button>`
        + `<button type="button" class="mylist-game-profile-rating-hit mylist-game-profile-rating-hit-right" aria-label="Rate ${rightVal / 2} of 5" onclick="rateMyListGameProfileHeroRating('${escAttr(itemId)}',${rightVal},event)"></button>`
      : '';
    slots += `<span class="mylist-game-profile-rating-slot" data-star-index="${star}" style="--star-fill:${pct}%">`
      + `<span class="mylist-game-profile-rating-base" aria-hidden="true">&#9733;</span>`
      + `<span class="mylist-game-profile-rating-fill" aria-hidden="true">&#9733;</span>`
      + hits
      + `</span>`;
  }
  return `<div class="mylist-game-profile-rating${rating > 0 ? ' is-rated' : ''}${interactive ? '' : ' is-readonly'}" data-game-profile-rating data-item-id="${escAttr(itemId)}" role="group" aria-label="Your rating">
    <div class="mylist-game-profile-rating-stars">${slots}</div>
    <span class="mylist-game-profile-rating-value" data-game-profile-rating-value>${escHtml(valueLabel)}</span>
  </div>`;
}
window.rateMyListGameProfileHeroRating = function(itemId, val, event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if (viewingUser) return;
  const score = Number(val) || 0;
  try { rate(String(itemId || ''), 'overall', score); } catch (_) {}
  const page = document.getElementById('mylist-game-profile-page');
  const wrap = page?.querySelector('[data-game-profile-rating]');
  if (!wrap) return;
  wrap.classList.toggle('is-rated', score > 0);
  wrap.querySelectorAll('.mylist-game-profile-rating-slot').forEach((slot, i) => {
    const star = i + 1;
    let pct = 0;
    if (score >= star * 2) pct = 100;
    else if (score >= star * 2 - 1) pct = 50;
    slot.style.setProperty('--star-fill', pct + '%');
  });
  const valueEl = wrap.querySelector('[data-game-profile-rating-value]');
  if (valueEl) valueEl.textContent = score > 0
    ? `${(score / 2) % 1 === 0 ? String(score / 2) : (score / 2).toFixed(1)} / 5`
    : 'Not rated';
};

function renderMyListGameProfileEditableStat(label = '', field = '', value = '', options = {}) {
  if (options.rankPickerKind) return renderMyListRankIconPicker(label, field, value, options.rankPickerKind);
  return `<label class="mylist-game-profile-stat mylist-game-profile-editable-stat">
    <span>${escHtml(label)}</span>
    <input data-game-profile-edit-field="${escAttr(field)}" type="text" value="${escAttr(isMyListGameProfilePlaceholderValue(value) ? '' : value)}" placeholder="Add">
  </label>`;
}

function closeMyListRankIconPickers(page = null) {
  const root = page || document.getElementById('mylist-game-profile-page');
  if (!root) return;
  root.classList.remove('rank-picker-open');
  root.querySelectorAll('.mylist-rank-picker-field.is-open').forEach(node => {
    node.classList.remove('is-open');
    node.querySelector('.mylist-rank-picker-trigger')?.setAttribute('aria-expanded', 'false');
  });
}

function toggleMyListRankIconPicker(event = null, field = '') {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const page = document.getElementById('mylist-game-profile-page');
  const wrap = page?.querySelector(`.mylist-rank-picker-field[data-rank-field="${CSS.escape(String(field || ''))}"]`);
  if (!wrap) return;
  const willOpen = !wrap.classList.contains('is-open');
  page.classList.remove('rank-picker-open');
  page.querySelectorAll('.mylist-rank-picker-field.is-open').forEach(node => {
    node.classList.remove('is-open');
    node.querySelector('.mylist-rank-picker-trigger')?.setAttribute('aria-expanded', 'false');
  });
  wrap.classList.toggle('is-open', willOpen);
  wrap.querySelector('.mylist-rank-picker-trigger')?.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  if (willOpen) {
    const scroller = page.querySelector('.mylist-game-profile-scroll');
    if (scroller) {
      const targetTop = Math.max(0, wrap.offsetTop - 92);
      try { scroller.scrollTo({ top: targetTop, behavior: 'smooth' }); }
      catch (_) { scroller.scrollTop = targetTop; }
    }
    window.setTimeout(() => {
      if (wrap.classList.contains('is-open')) page.classList.add('rank-picker-open');
    }, 220);
  }
}
window.toggleMyListRankIconPicker = toggleMyListRankIconPicker;
window.toggleMyListValorantRankPicker = toggleMyListRankIconPicker;

function selectMyListRankIconPicker(event = null, field = '', value = '', kind = '') {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const page = document.getElementById('mylist-game-profile-page');
  const wrap = page?.querySelector(`.mylist-rank-picker-field[data-rank-field="${CSS.escape(String(field || ''))}"]`);
  if (!wrap) return;
  const input = wrap.querySelector(`[data-game-profile-edit-field="${CSS.escape(String(field || ''))}"]`);
  const trigger = wrap.querySelector('.mylist-rank-picker-trigger');
  const pickerKind = kind || wrap.dataset.rankKind || 'valorant';
  const normalizedValue = MYLIST_RANK_PICKER_CONFIGS[pickerKind]?.normalize(value) || value;
  const asset = getMyListRankPickerAsset(pickerKind, normalizedValue);
  if (input) input.value = normalizedValue;
  if (trigger) {
    trigger.innerHTML = `${asset ? `<img src="${escAttr(asset)}" alt="" aria-hidden="true">` : '<span class="mylist-rank-picker-empty" aria-hidden="true"></span>'}<strong>${escHtml(normalizedValue || 'Select rank')}</strong>`;
    trigger.setAttribute('aria-expanded', 'false');
  }
  wrap.querySelectorAll('.mylist-rank-picker-option').forEach(option => {
    option.classList.toggle('active', option.dataset.rankValue === normalizedValue);
  });
  wrap.classList.remove('is-open');
  page?.classList.remove('rank-picker-open');
}
window.selectMyListRankIconPicker = selectMyListRankIconPicker;
window.selectMyListValorantRank = selectMyListRankIconPicker;

function renderMyListGameProfileReadStat(label = '', value = '', options = {}) {
  const rankKind = options.rankPickerKind || '';
  const normalizedValue = isMyListGameProfilePlaceholderValue(value) ? '' : normalizeMyListRankPickerValue(rankKind, value);
  const asset = rankKind ? getMyListRankPickerAsset(rankKind, normalizedValue) : '';
  if (rankKind) {
    return `
      <div class="mylist-game-profile-stat mylist-game-profile-rank-stat">
        ${asset && normalizedValue ? `<img class="mylist-game-profile-rank-logo" src="${escAttr(asset)}" alt="" aria-hidden="true">` : '<span class="mylist-game-profile-rank-logo-placeholder" aria-hidden="true"></span>'}
        <strong>${escHtml(normalizedValue || '-')}</strong>
        <span>${escHtml(label)}</span>
      </div>
    `;
  }
  return `<div class="mylist-game-profile-stat"><span>${escHtml(label)}</span><strong>${escHtml(isMyListGameProfilePlaceholderValue(value) ? '-' : value)}</strong></div>`;
}

function renderMyListGameProfileEditableLink(label = '', field = '', value = '', placeholder = 'https://...', openHref = '') {
  /* v11.044: optional inline "Open ↗" quick-link next to the field label
     — opens the source site (e.g. Tracker.gg) in a new tab so the user
     can grab their profile URL, then come back and paste it into this
     field. */
  const openLink = openHref
    ? `<a class="mylist-game-profile-field-open" href="${escAttr(openHref)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Open&nbsp;&#8599;</a>`
    : '';
  return `<label class="mylist-game-profile-link-row mylist-game-profile-editable-link">
    <span class="mylist-game-profile-editable-link-head"><span class="mylist-game-profile-editable-link-label">${escHtml(label)}</span>${openLink}</span>
    <input data-game-profile-edit-field="${escAttr(field)}" type="url" value="${escAttr(value)}" placeholder="${escAttr(placeholder)}" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" inputmode="url">
  </label>`;
}

function getMyListGameProfileStreamableId(url = '') {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/(^|\.)streamable\.com$/i.test(parsed.hostname)) return '';
    const parts = parsed.pathname.split('/').filter(Boolean);
    const id = parts[0] === 'e' ? parts[1] : parts[0];
    return /^[a-z0-9]+$/i.test(id || '') ? id : '';
  } catch (_) {
    const match = raw.match(/streamable\.com\/(?:e\/)?([a-z0-9]+)/i);
    return match ? match[1] : '';
  }
}

/* v11.440: highlight clips are effectively unlimited now (was a hard cap of 12)
   — a game profile can post as many Streamable clips as the user wants. 50 is a
   generous safety ceiling that still keeps the saved Firestore doc tiny. Mirror
   this in js/23 normalizeHighlightClips (the save layer). */
const MYLIST_HIGHLIGHT_MAX_CLIPS = 50;
function normalizeMyListGameProfileHighlightClip(entry = null) {
  let url = '';
  let caption = '';
  if (typeof entry === 'string') {
    url = entry;
  } else if (entry && typeof entry === 'object') {
    url = entry.url || entry.href || entry.link || entry.highlightUrl || '';
    caption = entry.caption || entry.title || entry.note || '';
  }
  url = String(url || '').trim();
  if (url && !/^https?:\/\//i.test(url) && /(^|\.)streamable\.com\//i.test(url)) url = `https://${url.replace(/^\/+/, '')}`;
  caption = String(caption || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  if (!getMyListGameProfileStreamableId(url)) return null;
  return { url, caption };
}

function parseMyListGameProfileHighlightClipsValue(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return [];
  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return dedupeMyListGameProfileHighlightClips(list);
    } catch (_) {}
  }
  return dedupeMyListGameProfileHighlightClips([raw]);
}

function dedupeMyListGameProfileHighlightClips(clips = []) {
  const seen = new Set();
  const out = [];
  clips.forEach(entry => {
    const clip = normalizeMyListGameProfileHighlightClip(entry);
    if (!clip) return;
    const id = getMyListGameProfileStreamableId(clip.url).toLowerCase();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(clip);
  });
  return out.slice(0, MYLIST_HIGHLIGHT_MAX_CLIPS);
}

function getMyListGameProfileHighlightClips(item = {}) {
  const stats = item?.competitiveStats && typeof item.competitiveStats === 'object' ? item.competitiveStats : {};
  const candidates = [];
  ['highlightClips', 'highlights'].forEach(key => {
    if (Array.isArray(item?.[key])) candidates.push(...item[key]);
    if (Array.isArray(stats?.[key])) candidates.push(...stats[key]);
  });
  ['highlightUrl', 'highlightsUrl', 'gameHighlightsUrl', 'clipsUrl'].forEach(key => {
    if (item?.[key]) candidates.push({ url: item[key], caption: item.highlightCaption || item.gameHighlightCaption || '' });
    if (stats?.[key]) candidates.push({ url: stats[key], caption: stats.highlightCaption || '' });
  });
  return dedupeMyListGameProfileHighlightClips(candidates);
}

/* v11.469: ONE source of truth for the "is this Streamable clip already posted?"
   duplicate check shared by the Activity Feed composer AND the game-detail clip
   editor. The authoritative answer is the game's CURRENT highlight reel
   (highlightClips — exactly what the game detail page renders), NOT a separate
   posted-url ledger (highlightFeedPostedUrls) that could go stale after a delete.
   So the instant a highlight is deleted (its clip pulled from highlightClips) the
   same link becomes postable again, while a clip that is still attached keeps its
   duplicate protection. Returns false for non-Streamable / unknown urls. */
function isGameHighlightClipAlreadyPosted(game = {}, url = '') {
  if (typeof getMyListGameProfileStreamableId !== 'function') return false;
  const targetId = getMyListGameProfileStreamableId(url).toLowerCase();
  if (!targetId) return false;
  const liveClips = (typeof getMyListGameProfileHighlightClips === 'function')
    ? getMyListGameProfileHighlightClips(game)
    : [];
  return liveClips.some(c => getMyListGameProfileStreamableId(c && c.url).toLowerCase() === targetId);
}
if (typeof window !== 'undefined') window.isGameHighlightClipAlreadyPosted = isGameHighlightClipAlreadyPosted;

function getMyListGameProfileHighlightClipsFromPage(page = null) {
  const clipsValue = page?.querySelector('[data-game-profile-edit-field="highlightClips"]')?.value || '';
  const parsed = parseMyListGameProfileHighlightClipsValue(clipsValue);
  if (parsed.length) return parsed;
  const legacy = page?.querySelector('[data-game-profile-edit-field="highlightUrl"]')?.value || '';
  return parseMyListGameProfileHighlightClipsValue(legacy);
}

function serializeMyListGameProfileHighlightClips(clips = []) {
  return JSON.stringify(dedupeMyListGameProfileHighlightClips(clips));
}

function renderMyListGameProfileHighlightEmbed(value = '') {
  const clips = Array.isArray(value) ? dedupeMyListGameProfileHighlightClips(value) : parseMyListGameProfileHighlightClipsValue(value);
  if (!clips.length) return '';
  const slides = clips.map((clip, index) => {
    const id = getMyListGameProfileStreamableId(clip.url);
    const src = `https://streamable.com/e/${encodeURIComponent(id)}?loop=1`;
    /* v11.466: EAGER-load the first few clips. The game-profile page is an overlay
       that slides in with a transform; on iOS WKWebView the lazy-load
       IntersectionObserver frequently never fires for an iframe inside that
       animating/transformed overlay, so the highlight rendered as a black box (the
       frame's #000 background) even though the Streamable URL was valid and the
       caption showed. Eager load bypasses the observer entirely so the clip renders
       immediately. Clips past the first few stay lazy (they load on horizontal
       swipe once the overlay has settled, exactly like the working feed embed). */
    const loadingAttr = index < 3 ? '' : ' loading="lazy"';
    return `<article class="mylist-game-profile-highlight-slide" aria-label="Highlight clip ${index + 1} of ${clips.length}">
      <div class="mylist-game-profile-highlight-frame">
        <iframe src="${escAttr(src)}" allow="fullscreen" allowfullscreen${loadingAttr} title="Streamable highlight reel"></iframe>
      </div>
      ${clip.caption ? `<p class="mylist-game-profile-highlight-caption">${escHtml(clip.caption)}</p>` : ''}
    </article>`;
  }).join('');
  return `<section class="mylist-game-profile-highlight-preview" aria-label="Highlight reel">
    <div class="mylist-game-profile-highlight-head">Highlight Reel${clips.length > 1 ? `<span>${clips.length} clips</span>` : ''}</div>
    <div class="mylist-game-profile-highlight-track">${slides}</div>
  </section>`;
}

/* v11.469: when a highlight is deleted (from Activity) or removed (from the editor)
   while the game's profile page is open behind it, swap the on-screen highlight reel
   in place so it reflects the new clip set without a manual reopen. Safe no-op when
   the profile page isn't open, isn't this game, or is in edit mode. */
function refreshOpenGameProfileHighlightReel(gameKey = '', clips = []) {
  try {
    const page = document.getElementById('mylist-game-profile-page');
    if (!page) return;
    const openKey = String(page.dataset?.gameProfileItemId || '').trim();
    if (!openKey || (gameKey && openKey !== String(gameKey).trim())) return;
    if (page.querySelector('[data-game-profile-edit-field]')) return; // editing — leave the editor alone
    const reduced = dedupeMyListGameProfileHighlightClips(clips || []);
    const existing = page.querySelector('.mylist-game-profile-highlight-preview');
    const html = renderMyListGameProfileHighlightEmbed(reduced);
    if (existing) {
      if (html) existing.outerHTML = html;
      else existing.remove();
    } else if (html) {
      const links = page.querySelector('.mylist-game-profile-links');
      if (links) links.insertAdjacentHTML('afterend', html);
    }
  } catch (_) {}
}
if (typeof window !== 'undefined') window.refreshOpenGameProfileHighlightReel = refreshOpenGameProfileHighlightReel;

function renderMyListGameProfileReadLink(label = '', href = '', openHref = '') {
  if (href) {
    return `<a class="mylist-game-profile-link-row" href="${escAttr(href)}" target="_blank" rel="noopener"><span>${escHtml(label)}</span><strong>Open</strong></a>`;
  }
  /* v11.044: when there's no saved profile link yet, still give the user
     a quick way to jump to the source site (Tracker.gg) to grab their
     URL. The open-link sits right after the label; "Not linked" stays on
     the right as the status. */
  const openLink = openHref
    ? `<a class="mylist-game-profile-field-open" href="${escAttr(openHref)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Open&nbsp;&#8599;</a>`
    : '';
  return `<div class="mylist-game-profile-link-row is-disabled${openHref ? ' has-quick-open' : ''}"><span>${escHtml(label)}</span>${openLink}<strong>Not linked</strong></div>`;
}

function renderMyListGameProfileHighlightButton(value = '') {
  const clips = Array.isArray(value) ? dedupeMyListGameProfileHighlightClips(value) : parseMyListGameProfileHighlightClipsValue(value);
  const firstUrl = clips[0]?.url || '';
  const label = clips.length > 1 ? `${clips.length} clips` : (clips.length ? 'Linked' : 'Add Streamable');
  return `<button class="mylist-game-profile-link-row mylist-game-profile-highlight-button" type="button" onclick="openMyListGameProfileHighlightModal(event)">
    <span>Highlight</span>
    <strong>${escHtml(label)}</strong>
  </button>
  <input data-game-profile-edit-field="highlightUrl" type="hidden" value="${escAttr(firstUrl)}">
  <input data-game-profile-edit-field="highlightClips" type="hidden" value="${escAttr(serializeMyListGameProfileHighlightClips(clips))}">`;
}

function closeMyListGameProfileHighlightModal() {
  const modal = document.getElementById('mylist-game-profile-highlight-modal');
  if (!modal) return;
  uninstallMyListGameProfileHighlightViewportSync();
  modal.classList.remove('is-open');
  window.setTimeout(() => modal.remove(), 180);
}
window.closeMyListGameProfileHighlightModal = closeMyListGameProfileHighlightModal;

/* Lifts the highlight bottom-sheet above the iOS keyboard. The sheet sits at
   the bottom of the viewport, so when the keyboard opens it would otherwise be
   covered. Mirror the activity-feed composer pattern: measure the keyboard with
   visualViewport and feed it back as bottom padding on the modal container. */
function syncMyListGameProfileHighlightViewport() {
  const modal = document.getElementById('mylist-game-profile-highlight-modal');
  if (!modal) return;
  const vv = window.visualViewport;
  const offset = vv
    ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
    : 0;
  modal.style.setProperty('--game-profile-highlight-keyboard-offset', `${offset}px`);
}

function installMyListGameProfileHighlightViewportSync() {
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncMyListGameProfileHighlightViewport, { passive: true });
    window.visualViewport.addEventListener('scroll', syncMyListGameProfileHighlightViewport, { passive: true });
  }
  window.addEventListener('resize', syncMyListGameProfileHighlightViewport, { passive: true });
  window.requestAnimationFrame(syncMyListGameProfileHighlightViewport);
}

function uninstallMyListGameProfileHighlightViewportSync() {
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', syncMyListGameProfileHighlightViewport);
    window.visualViewport.removeEventListener('scroll', syncMyListGameProfileHighlightViewport);
  }
  window.removeEventListener('resize', syncMyListGameProfileHighlightViewport);
}

const MYLIST_HIGHLIGHT_APPLIED_CHIP = '<span class="mylist-game-profile-highlight-applied" aria-label="Applied"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>Applied</span>';

/* v11.394: each highlight clip is its OWN entry. An already-posted clip (its url
   is in the item's highlightFeedPostedUrls) renders locked with an "Applied ✓"
   chip; a fresh clip gets its own "Apply Clip" button that saves + posts ONLY
   that clip. This is what stops a second clip from reposting the whole reel. */
/* v11.441: live per-row clip preview inside the highlight editor. As soon as a
   valid Streamable link is pasted (and for an already-saved/applied clip) the row
   shows the embedded clip, so the user can see exactly which clip it is before and
   after applying. */
function renderMyListGameProfileHighlightRowPreviewHtml(url = '') {
  const id = getMyListGameProfileStreamableId(String(url || '').trim());
  if (!id) return '';
  const src = `https://streamable.com/e/${encodeURIComponent(id)}?loop=1`;
  return `<div class="mylist-game-profile-highlight-row-frame"><iframe src="${escAttr(src)}" allow="fullscreen" allowfullscreen loading="lazy" title="Streamable highlight preview"></iframe></div>`;
}

function updateMyListGameProfileHighlightRowPreview(input) {
  const row = input?.closest?.('[data-highlight-editor-row]');
  if (!row) return;
  const preview = row.querySelector('[data-highlight-preview]');
  if (!preview) return;
  const id = getMyListGameProfileStreamableId(String(input.value || '').trim()) || '';
  if (preview.dataset.previewId === id) return;   // same clip id → don't reload the iframe
  preview.dataset.previewId = id;
  preview.innerHTML = id ? renderMyListGameProfileHighlightRowPreviewHtml(input.value) : '';
}
window.updateMyListGameProfileHighlightRowPreview = updateMyListGameProfileHighlightRowPreview;

function renderMyListGameProfileHighlightEditorRows(clips = [], postedUrls = null) {
  const posted = postedUrls instanceof Set ? postedUrls : new Set();
  const list = clips.length ? clips : [{ url: '', caption: '' }];
  return list.map((clip) => {
    const url = String(clip.url || '').trim();
    const applied = !!url && posted.has(url);
    /* v11.440: applied rows are no longer hard-locked — Remove stays available so
       a posted clip can be deleted, and an Edit button re-opens it for changes. */
    const removeHidden = (list.length <= 1 && !url);
    return `
    <div class="mylist-game-profile-highlight-editor-row${applied ? ' is-applied' : ''}" data-highlight-editor-row data-applied="${applied ? '1' : '0'}" data-clip-url="${escAttr(url)}">
      <label class="mylist-game-profile-highlight-input">
        <span>Streamable link</span>
        <input data-highlight-url-input type="url" value="${escAttr(url)}" placeholder="https://streamable.com/0ezn34" autocomplete="off" autocapitalize="none" spellcheck="false" oninput="updateMyListGameProfileHighlightRowPreview(this)"${applied ? ' readonly' : ''}>
      </label>
      <label class="mylist-game-profile-highlight-input">
        <span>Caption</span>
        <input data-highlight-caption-input type="text" value="${escAttr(clip.caption || '')}" placeholder="Add a caption" maxlength="180" autocomplete="off"${applied ? ' readonly' : ''}>
      </label>
      <div class="mylist-game-profile-highlight-row-preview" data-highlight-preview data-preview-id="${escAttr(getMyListGameProfileStreamableId(url) || '')}">${renderMyListGameProfileHighlightRowPreviewHtml(url)}</div>
      <div class="mylist-game-profile-highlight-row-actions">
        ${applied
          ? `${MYLIST_HIGHLIGHT_APPLIED_CHIP}<button class="mylist-game-profile-highlight-edit" type="button" onclick="editMyListGameProfileHighlightRow(event)">Edit</button>`
          : `<button class="mylist-game-profile-highlight-apply-clip" type="button" onclick="applyMyListGameProfileHighlightClip(event)">Apply Clip</button>`}
        <button class="mylist-game-profile-highlight-remove" type="button" onclick="removeMyListGameProfileHighlightRow(event)"${removeHidden ? ' hidden' : ''}>Remove</button>
      </div>
    </div>
  `;
  }).join('');
}

function markMyListGameProfileHighlightRowApplied(row) {
  if (!row) return;
  row.classList.add('is-applied');
  row.dataset.applied = '1';
  row.querySelectorAll('input').forEach(input => { input.readOnly = true; });
  /* v11.440: rebuild the action row to "Applied ✓ · Edit · Remove" so a posted
     clip can be re-opened for editing or deleted (Remove stays visible). */
  const actions = row.querySelector('.mylist-game-profile-highlight-row-actions');
  if (actions) {
    actions.innerHTML = `${MYLIST_HIGHLIGHT_APPLIED_CHIP}<button class="mylist-game-profile-highlight-edit" type="button" onclick="editMyListGameProfileHighlightRow(event)">Edit</button><button class="mylist-game-profile-highlight-remove" type="button" onclick="removeMyListGameProfileHighlightRow(event)">Remove</button>`;
  }
}

/* v11.440: re-open an already-applied/posted clip for editing. Unlocks the inputs
   and swaps the "Applied ✓" chip for an "Update Clip" button. data-clip-url keeps
   the previously-applied url so applyMyListGameProfileHighlightClip can tell a
   caption-only edit (no repost) from a url change (drops the old, posts the new). */
function editMyListGameProfileHighlightRow(event = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const row = event?.currentTarget?.closest?.('[data-highlight-editor-row]');
  if (!row) return;
  row.classList.remove('is-applied');
  row.dataset.applied = '0';
  row.querySelectorAll('input').forEach(input => { input.readOnly = false; });
  const actions = row.querySelector('.mylist-game-profile-highlight-row-actions');
  if (actions) {
    actions.innerHTML = `<button class="mylist-game-profile-highlight-apply-clip" type="button" onclick="applyMyListGameProfileHighlightClip(event)">Update Clip</button><button class="mylist-game-profile-highlight-remove" type="button" onclick="removeMyListGameProfileHighlightRow(event)">Remove</button>`;
  }
  row.querySelector('[data-highlight-url-input]')?.focus?.({ preventScroll: true });
}
window.editMyListGameProfileHighlightRow = editMyListGameProfileHighlightRow;

/* Keep the profile's hidden highlight fields + button label in sync with the
   applied clips, so the main Save persists exactly what's been applied. */
function syncMyListGameProfileHighlightHiddenField(clips = []) {
  const page = document.getElementById('mylist-game-profile-page');
  if (!page) return;
  const normalized = dedupeMyListGameProfileHighlightClips(clips || []);
  const hidden = page.querySelector('[data-game-profile-edit-field="highlightUrl"]');
  const hiddenClips = page.querySelector('[data-game-profile-edit-field="highlightClips"]');
  if (hidden) hidden.value = normalized[0]?.url || '';
  if (hiddenClips) hiddenClips.value = serializeMyListGameProfileHighlightClips(normalized);
  const btnLabel = page.querySelector('.mylist-game-profile-highlight-button strong');
  if (btnLabel) btnLabel.textContent = normalized.length > 1 ? `${normalized.length} clips` : (normalized.length ? 'Linked' : 'Add Streamable');
}

/* Apply (save + post to the activity feed) a SINGLE highlight clip. Independent
   per row, so adding a second clip never touches or reposts the first. */
async function applyMyListGameProfileHighlightClip(event = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const btn = event?.currentTarget;
  const row = btn?.closest?.('[data-highlight-editor-row]');
  if (!row || !btn) return;
  const urlInput = row.querySelector('[data-highlight-url-input]');
  const captionInput = row.querySelector('[data-highlight-caption-input]');
  const clip = normalizeMyListGameProfileHighlightClip({ url: String(urlInput?.value || '').trim(), caption: captionInput?.value || '' });
  if (!clip) {
    if (typeof showToast === 'function') showToast('Paste a valid Streamable link');
    urlInput?.focus?.();
    return;
  }
  const page = document.getElementById('mylist-game-profile-page');
  const key = String(page?.dataset?.gameProfileItemId || '').trim();
  const found = (typeof findMyListGameProfileItem === 'function') ? findMyListGameProfileItem(key) : null;
  const item = found?.item;
  if (!key || !item) {
    if (typeof showToast === 'function') showToast('Game profile not found');
    return;
  }
  const streamId = u => String((typeof getMyListGameProfileStreamableId === 'function' ? getMyListGameProfileStreamableId(u) : u) || '').toLowerCase();
  const newId = streamId(clip.url);
  /* v11.440: this row may be an EDIT of an already-applied clip. data-clip-url is
     its previously-applied url; an unchanged id = caption-only edit (no repost),
     a changed id = the old clip is dropped and the new one is posted. */
  const originalUrl = String(row.dataset.clipUrl || '').trim();
  const captionOnly = !!originalUrl && streamId(originalUrl) === newId;
  /* v11.469: "already posted" now reads the game's live highlight reel (the same
     source the game detail page shows) instead of the standalone posted-url ledger,
     so a deleted/removed clip is never mis-flagged as a duplicate. */
  const alreadyPosted = (typeof isGameHighlightClipAlreadyPosted === 'function')
    && isGameHighlightClipAlreadyPosted(item, clip.url);
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = (alreadyPosted || captionOnly) ? 'Saving…' : 'Applying…';
  try {
    /* Rebuild the saved set from the editor's rows (the source of truth): every
       applied row PLUS this row's new value, deduped. A url change naturally drops
       the old clip because this row's input now holds the new url. */
    const updated = dedupeMyListGameProfileHighlightClips(
      Array.from(document.querySelectorAll('#mylist-game-profile-highlight-list [data-highlight-editor-row]'))
        .map(r => {
          if (r !== row && r.dataset.applied !== '1') return null; // skip other draft rows
          const u = (r === row) ? clip.url : String(r.querySelector('[data-highlight-url-input]')?.value || '').trim();
          const cap = (r === row) ? clip.caption : (r.querySelector('[data-highlight-caption-input]')?.value || '');
          return normalizeMyListGameProfileHighlightClip({ url: u, caption: cap });
        })
        .filter(Boolean)
    );
    /* v11.461: route the feed-post + persist through the shared
       commitGameHighlightClip helper so this editor and the Activity Feed
       composer write the highlight identically. Only a brand-new clip posts to
       the feed; caption-only edits + re-applies don't repost. */
    const { postId } = await commitGameHighlightClip(item, clip, updated, {
      itemId: key,
      section: 'games',
      postToFeed: !alreadyPosted && !captionOnly
    });
    row.dataset.clipUrl = clip.url;
    markMyListGameProfileHighlightRowApplied(row);
    syncMyListGameProfileHighlightHiddenField(updated);
    if (typeof showToast === 'function') showToast(postId ? 'Highlight applied & posted' : (originalUrl ? 'Highlight updated' : 'Highlight saved'));
  } catch (e) {
    console.warn('applyMyListGameProfileHighlightClip failed:', e);
    if (typeof showToast === 'function') showToast('Could not apply this clip. Try again.');
    btn.disabled = false;
    btn.textContent = originalLabel || 'Apply Clip';
  }
}
window.applyMyListGameProfileHighlightClip = applyMyListGameProfileHighlightClip;

function addMyListGameProfileHighlightRow(event = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const list = document.getElementById('mylist-game-profile-highlight-list');
  if (!list) return;
  const count = list.querySelectorAll('[data-highlight-editor-row]').length;
  if (count >= MYLIST_HIGHLIGHT_MAX_CLIPS) {
    if (typeof showToast === 'function') showToast(`You can add up to ${MYLIST_HIGHLIGHT_MAX_CLIPS} highlight clips`);
    return;
  }
  list.insertAdjacentHTML('beforeend', renderMyListGameProfileHighlightEditorRows([{ url: '', caption: '' }]));
  const lastRow = list.querySelector('[data-highlight-editor-row]:last-child');
  const removeBtn = lastRow?.querySelector('.mylist-game-profile-highlight-remove');
  if (removeBtn) removeBtn.hidden = false;
  lastRow?.querySelector('input')?.focus?.({ preventScroll: true });
}
window.addMyListGameProfileHighlightRow = addMyListGameProfileHighlightRow;

function removeMyListGameProfileHighlightRow(event = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const row = event?.currentTarget?.closest?.('[data-highlight-editor-row]');
  const list = document.getElementById('mylist-game-profile-highlight-list');
  if (!row || !list) return;
  /* v11.440: if this row was an applied/posted clip, deleting it must persist the
     new (shorter) set — otherwise the clip would reappear on reopen.
     v11.469: capture the removed clip's url BEFORE we clear the row so the connected
     Activity Feed highlight post can be torn down too (no orphan card / stale ledger). */
  const wasApplied = row.dataset.applied === '1' || !!String(row.dataset.clipUrl || '').trim();
  const removedUrl = String(row.dataset.clipUrl || '').trim();
  const rows = Array.from(list.querySelectorAll('[data-highlight-editor-row]'));
  if (rows.length <= 1) {
    row.querySelector('[data-highlight-url-input]').value = '';
    row.querySelector('[data-highlight-caption-input]').value = '';
    row.classList.remove('is-applied');
    row.dataset.applied = '0';
    row.dataset.clipUrl = '';
    row.querySelectorAll('input').forEach(i => { i.readOnly = false; });
    const actions = row.querySelector('.mylist-game-profile-highlight-row-actions');
    if (actions) actions.innerHTML = `<button class="mylist-game-profile-highlight-apply-clip" type="button" onclick="applyMyListGameProfileHighlightClip(event)">Apply Clip</button><button class="mylist-game-profile-highlight-remove" type="button" onclick="removeMyListGameProfileHighlightRow(event)" hidden>Remove</button>`;
    /* Flash the row red briefly so the user sees the removal clearly */
    row.style.transition = 'background 0.15s ease';
    row.style.background = 'rgba(220,55,55,0.14)';
    window.setTimeout(() => { row.style.background = ''; window.setTimeout(() => { row.style.transition = ''; }, 220); }, 340);
    if (wasApplied) { persistMyListGameProfileHighlightApplied(); cleanupRemovedGameProfileHighlightClip(removedUrl); }
    if (typeof showToast === 'function') showToast('Highlight clip removed');
    return;
  }
  /* Animate the row out before removing it */
  row.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
  row.style.opacity = '0';
  row.style.transform = 'translateX(-10px)';
  window.setTimeout(() => {
    row.remove();
    if (wasApplied) { persistMyListGameProfileHighlightApplied(); cleanupRemovedGameProfileHighlightClip(removedUrl); }
    if (typeof showToast === 'function') showToast('Highlight clip removed');
  }, 200);
}
window.removeMyListGameProfileHighlightRow = removeMyListGameProfileHighlightRow;

/* v11.469 — game-detail side of the bidirectional cleanup. When a clip is removed
   from a game's highlight reel: (1) clear its entry from the live duplicate-check
   ledger so reopening the editor / the Activity composer never mis-flags it, and
   (2) tear down the connected Activity Feed highlight post so no orphan card lingers.
   Both are best-effort + guarded — the clip removal itself already succeeded. */
function cleanupRemovedGameProfileHighlightClip(removedUrl = '') {
  try {
    const url = String(removedUrl || '').trim();
    if (!url || typeof getMyListGameProfileStreamableId !== 'function') return;
    const targetId = getMyListGameProfileStreamableId(url).toLowerCase();
    if (!targetId) return;
    const sameId = u => getMyListGameProfileStreamableId(u).toLowerCase() === targetId;
    const page = document.getElementById('mylist-game-profile-page');
    const key = String(page?.dataset?.gameProfileItemId || '').trim();
    const item = (key && typeof findMyListGameProfileItem === 'function') ? findMyListGameProfileItem(key)?.item : null;
    if (item) {
      if (Array.isArray(item.highlightFeedPostedUrls)) {
        item.highlightFeedPostedUrls = item.highlightFeedPostedUrls.filter(u => !sameId(String(u || '').trim()));
      }
      if (sameId(String(item.highlightFeedPostedUrl || '').trim())) item.highlightFeedPostedUrl = item.highlightFeedPostedUrls?.[0] || '';
    }
    if (typeof window.deleteConnectedHighlightFeedPostForClip === 'function') {
      window.deleteConnectedHighlightFeedPostForClip(url);
    }
  } catch (e) { console.warn('cleanupRemovedGameProfileHighlightClip failed:', e); }
}
window.cleanupRemovedGameProfileHighlightClip = cleanupRemovedGameProfileHighlightClip;

/* v11.440: collect the currently-applied clips straight from the editor rows and
   persist them (used when a posted clip is deleted/edited so the saved reel and
   the activity-feed posted-set stay in sync without a full profile save). */
function collectMyListGameProfileHighlightAppliedClips() {
  const rows = Array.from(document.querySelectorAll('#mylist-game-profile-highlight-list [data-highlight-editor-row]'));
  const clips = [];
  rows.forEach(r => {
    if (r.dataset.applied !== '1') return;
    const url = String(r.querySelector('[data-highlight-url-input]')?.value || '').trim();
    const caption = r.querySelector('[data-highlight-caption-input]')?.value || '';
    const clip = normalizeMyListGameProfileHighlightClip({ url, caption });
    if (clip) clips.push(clip);
  });
  return dedupeMyListGameProfileHighlightClips(clips);
}

async function persistMyListGameProfileHighlightApplied() {
  const page = document.getElementById('mylist-game-profile-page');
  const key = String(page?.dataset?.gameProfileItemId || '').trim();
  const found = (typeof findMyListGameProfileItem === 'function') ? findMyListGameProfileItem(key) : null;
  const item = found?.item;
  const updated = collectMyListGameProfileHighlightAppliedClips();
  syncMyListGameProfileHighlightHiddenField(updated);
  if (key && item && typeof window.saveScreenListCompetitiveProfile === 'function') {
    try {
      await window.saveScreenListCompetitiveProfile({ itemId: key, highlightClips: updated, highlightUrl: updated[0]?.url || '', fetchStats: false, highlightSave: true });
    } catch (e) { console.warn('persistMyListGameProfileHighlightApplied failed:', e); }
  }
}

function openMyListGameProfileHighlightModal(event = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const existing = document.getElementById('mylist-game-profile-highlight-modal');
  if (existing) existing.remove();
  const page = document.getElementById('mylist-game-profile-page');
  const currentClips = getMyListGameProfileHighlightClipsFromPage(page);
  /* v11.394: mark which clips are already applied (posted) so they render as
     locked "Applied ✓" rows instead of an "Apply Clip" button. */
  const key = String(page?.dataset?.gameProfileItemId || '').trim();
  const modalItem = (typeof findMyListGameProfileItem === 'function') ? findMyListGameProfileItem(key)?.item : null;
  const postedUrls = new Set([
    String(modalItem?.highlightFeedPostedUrl || '').trim(),
    ...(Array.isArray(modalItem?.highlightFeedPostedUrls) ? modalItem.highlightFeedPostedUrls.map(u => String(u || '').trim()) : [])
  ].filter(Boolean));
  const modal = document.createElement('div');
  modal.id = 'mylist-game-profile-highlight-modal';
  modal.className = 'mylist-game-profile-highlight-modal';
  modal.innerHTML = `
    <div class="mylist-game-profile-highlight-backdrop" onclick="closeMyListGameProfileHighlightModal()"></div>
    <div class="mylist-game-profile-highlight-sheet" role="dialog" aria-modal="true" aria-label="Add highlight reel">
      <div class="mylist-game-profile-highlight-grabber" aria-hidden="true"></div>
      <h2>Highlight Reel</h2>
      <p>Paste a Streamable link and tap <strong>Apply Clip</strong> to post it. Each clip posts on its own — adding more never reposts the others.</p>
      <div id="mylist-game-profile-highlight-list" class="mylist-game-profile-highlight-list">
        ${renderMyListGameProfileHighlightEditorRows(currentClips, postedUrls)}
      </div>
      <button type="button" class="mylist-game-profile-highlight-add" onclick="addMyListGameProfileHighlightRow(event)">Add another clip</button>
      <div class="mylist-game-profile-highlight-actions">
        <button type="button" class="mylist-game-profile-highlight-secondary" onclick="openMyListGameProfileStreamableUpload(event)">Upload on Streamable</button>
        <button type="button" class="mylist-game-profile-highlight-primary" onclick="closeMyListGameProfileHighlightModal()">Done</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  installMyListGameProfileHighlightViewportSync();
  requestAnimationFrame(() => {
    modal.classList.add('is-open');
    modal.querySelector('[data-highlight-url-input]')?.focus?.({ preventScroll: true });
  });
}
window.openMyListGameProfileHighlightModal = openMyListGameProfileHighlightModal;

function openMyListGameProfileStreamableUpload(event = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  try {
    window.open('https://streamable.com/', '_blank', 'noopener');
  } catch (_) {
    window.location.href = 'https://streamable.com/';
  }
}
window.openMyListGameProfileStreamableUpload = openMyListGameProfileStreamableUpload;

function applyMyListGameProfileHighlightLink(event = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const rows = Array.from(document.querySelectorAll('#mylist-game-profile-highlight-list [data-highlight-editor-row]'));
  const clips = [];
  let invalidInput = null;
  rows.forEach(row => {
    const input = row.querySelector('[data-highlight-url-input]');
    const captionInput = row.querySelector('[data-highlight-caption-input]');
    const value = String(input?.value || '').trim();
    if (!value) return;
    const clip = normalizeMyListGameProfileHighlightClip({
      url: value,
      caption: captionInput?.value || ''
    });
    if (!clip && !invalidInput) invalidInput = input;
    if (clip) clips.push(clip);
  });
  if (invalidInput) {
    if (typeof showToast === 'function') showToast('Paste valid Streamable links');
    invalidInput.focus?.();
    return;
  }
  const normalized = dedupeMyListGameProfileHighlightClips(clips);
  const page = document.getElementById('mylist-game-profile-page');
  const hidden = page?.querySelector('[data-game-profile-edit-field="highlightUrl"]');
  const hiddenClips = page?.querySelector('[data-game-profile-edit-field="highlightClips"]');
  if (hidden) hidden.value = normalized[0]?.url || '';
  if (hiddenClips) hiddenClips.value = serializeMyListGameProfileHighlightClips(normalized);
  const button = page?.querySelector('.mylist-game-profile-highlight-button strong');
  if (button) button.textContent = normalized.length > 1 ? `${normalized.length} clips` : (normalized.length ? 'Linked' : 'Add Streamable');
  closeMyListGameProfileHighlightModal();
}
window.applyMyListGameProfileHighlightLink = applyMyListGameProfileHighlightLink;

function setMyListGameProfileInlineStatus(message = '', kind = '') {
  const status = document.getElementById('mylist-game-profile-edit-status');
  if (!status) return;
  status.textContent = message;
  status.className = ['mylist-game-profile-edit-status', kind ? `is-${kind}` : ''].filter(Boolean).join(' ');
}

function installMyListGameProfileZoomGuards(overlay = null) {
  if (!overlay || overlay.__shelfdGameProfileZoomGuards) return;
  overlay.__shelfdGameProfileZoomGuards = true;
  let lastTouchEnd = 0;
  overlay.addEventListener('touchend', event => {
    const now = Date.now();
    /* v11.044: do NOT swallow the double-tap when it lands on a form
       field — iOS needs that gesture (and long-press) to surface the
       selection / Paste callout. Previously this killed paste in the
       tracker URL + rank/KD edit inputs. Double-tap-zoom is still
       blocked everywhere else on the overlay. */
    const onField = event.target?.closest?.('input, textarea, select, [contenteditable]');
    if (now - lastTouchEnd <= 320 && !onField) {
      event.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });
  overlay.addEventListener('gesturestart', event => {
    event.preventDefault();
  }, { passive: false });
  overlay.addEventListener('click', event => {
    if (event.target?.closest?.('.mylist-rank-picker-field')) return;
    closeMyListRankIconPickers(overlay);
  });
}

async function saveMyListGameProfileInline(event = null, itemId = '') {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if (viewingUser) return;
  const key = String(itemId || '').trim();
  if (!key || typeof window.saveScreenListCompetitiveProfile !== 'function') {
    if (typeof showToast === 'function') showToast('Save tools are still loading');
    return;
  }
  const page = document.getElementById('mylist-game-profile-page');
  const button = page?.querySelector('.mylist-game-profile-edit');
  if (button?.dataset?.saving === 'true') return;
  const fieldValue = field => page?.querySelector(`[data-game-profile-edit-field="${field}"]`)?.value || '';
  if (button) {
    button.dataset.saving = 'true';
    button.disabled = true;
    button.textContent = 'Saving';
  }
  setMyListGameProfileInlineStatus('Saving game profile...', '');
  try {
    const highlightClips = getMyListGameProfileHighlightClipsFromPage(page);
    const firstHighlightUrl = highlightClips[0]?.url || fieldValue('highlightUrl');
    const result = await window.saveScreenListCompetitiveProfile({
      itemId: key,
      gameSlug: fieldValue('gameSlug'),
      platform: fieldValue('platform'),
      hoursPlayed: fieldValue('hours'),
      profileInput: fieldValue('trackerUrl'),
      currentRank: fieldValue('currentRank'),
      peakRank: fieldValue('peakRank'),
      lifetimeKd: fieldValue('lifetimeKd'),
      seasonKd: fieldValue('seasonKd'),
      highlightUrl: firstHighlightUrl,
      highlightClips,
      fetchStats: true,
      forceFetch: true
    });
    setMyListGameProfileInlineStatus('Saving game profile...', '');
    if (typeof render === 'function') render();
    openMyListGameProfilePage(key, { edit: false });
    /* v11.394: highlight reels are NO LONGER posted from the profile Save.
       Each clip is applied + posted individually from the highlight editor via
       its own "Apply Clip" button (applyMyListGameProfileHighlightClip), so
       saving the profile never reposts the whole reel. */
    const unsupported = result?.fetchResult?.unsupported;
    const partial = !!result?.profilePatchError;
    const savedMessage = partial ? 'Game profile saved' : (unsupported ? 'Game profile saved manually' : 'Game profile saved');
    try { triggerShelfdLibraryAddFeedback(); } catch (_) {}
    if (typeof showMyListGameProfileSavedModal === 'function') {
      showMyListGameProfileSavedModal({
        message: savedMessage,
        durationMs: partial ? 2100 : 1700
      });
    } else if (typeof showShelfdAddedToShelfPrompt === 'function') {
      showShelfdAddedToShelfPrompt({
        message: savedMessage,
        durationMs: partial ? 2200 : 1900
      });
    } else if (typeof showToast === 'function') {
      showToast(savedMessage);
    }
  } catch (error) {
    console.warn('Game profile save failed:', error);
    setMyListGameProfileInlineStatus(error?.message || 'Could not save. Try again.', 'error');
  } finally {
    if (button) {
      button.dataset.saving = 'false';
      button.disabled = false;
      button.textContent = 'Save';
    }
  }
}
window.saveMyListGameProfileInline = saveMyListGameProfileInline;

function openMyListGameProfileMediaProfile(event = null, itemId = '') {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const key = String(itemId || '').trim();
  if (!key) return;
  const { item } = findMyListGameProfileItem(key);
  if (!item || typeof openGameMediaProfile !== 'function') return;
  openGameMediaProfile(event, getGameRawgIdValue(item), item, event?.currentTarget || null);
}
window.openMyListGameProfileMediaProfile = openMyListGameProfileMediaProfile;

function openMyListGameProfilePage(itemId = '', options = {}) {
  const key = String(itemId || '').trim();
  if (!key) return;
  const readOnly = !!options.readOnly;
  /* Shared deep-link views pass the competitive snapshot in via options.item
     (reconstructed from the share URL), so they render without the item
     needing to live in the current user's own games list. */
  const item = (options.item && typeof options.item === 'object')
    ? options.item
    : findMyListGameProfileItem(key).item;
  if (!item) return;
  closeMyListGameProfilePage({ instant: true });
  const canEdit = !viewingUser && !readOnly;
  const isEditing = !!options.edit && canEdit;
  /* v11.388: section gating on the game profile page.
       • Competitive stats (peak/current rank, season/lifetime KD) + the
         "Competitive" kicker — ONLY for competitive games (the Competitive tab).
         Shared read-only links are always competitive snapshots.
       • Links (Tracker.gg + Highlights) — shown on EVERY game profile.
       • Achievements — single-player (non-competitive) games; the section
         header is always shown, even when there's nothing to fetch. */
  const isCompetitive = !!readOnly || (typeof isCompetitiveGameItem === 'function'
    ? isCompetitiveGameItem(item)
    : String(item?.status || '').toLowerCase() === 'competitive');
  const isSinglePlayer = !isCompetitive;
  const details = getScreenListGameDetailValuesFromItem(item);
  const stats = getMyListGameProfileStats(item);
  const snapshot = item?.competitiveStats && typeof item.competitiveStats === 'object' ? item.competitiveStats : {};
  const title = item.title || item.name || 'Untitled';
  const year = item.year || item.releaseYear || item.released?.slice?.(0, 4) || '';
  const poster = typeof getScreenListDisplayGameCover === 'function'
    ? getScreenListDisplayGameCover(item)
    : (item.cover || item.backgroundImage || item.image || '');
  const genre = getMyListGameProfileGenreText(item.genre || item.genres || item.gameGenre || '');
  const platform = String(details.platform || item.platform || item.gamePlatform || '').trim();
  const hours = details.hours ? `${details.hours}h` : '';
  const facts = [
    platform ? ['Platform', platform] : null,
    hours ? ['Hours played', hours] : null,
    genre ? ['Genre', genre] : null
  ].filter(Boolean);
  const factsHtml = facts.length
    ? `<div class="mylist-game-profile-facts">${facts.map(([label, value]) => `<div><span>${escHtml(label)}</span><strong>${escHtml(value)}</strong></div>`).join('')}</div>`
    : '';
  /* v11.042: hero meta row shows the release year only — platform and
     genre already live in the facts strip below, so this drops the
     duplicate chips for a cleaner hero. */
  const metaChips = [
    year ? String(year).slice(0, 4) : ''
  ].filter(Boolean);
  const metaChipsHtml = metaChips.length
    ? `<div class="mylist-game-profile-meta-row">${metaChips.map(value => `<span>${escHtml(value)}</span>`).join('')}</div>`
    : '';
  const trackerHref = stats.trackerUrl || details.tracker || '';
  const highlightsHref = stats.highlightsUrl || '';
  const highlightClips = stats.highlightClips?.length ? stats.highlightClips : parseMyListGameProfileHighlightClipsValue(highlightsHref);
  /* v11.044: quick-open target for the Tracker.gg label link — the
     game's Tracker.gg page when supported, else the Tracker.gg home, so
     users can jump out, copy their profile URL, and paste it back. */
  const trackerHomeUrl = (typeof getMyListGameProfileTrackerHomeUrl === 'function'
    ? getMyListGameProfileTrackerHomeUrl(item)
    : '') || 'https://tracker.gg';
  const trackerGameSlug = snapshot.gameSlug || item.trackerGameSlug || 'valorant';
  const trackerPlatform = snapshot.platform || item.gamePlatform || item.platform || platform || 'pc';
  const rankPickerKind = getMyListGameProfileRankPickerKind(item);
  const editStatGrid = `
    ${renderMyListGameProfileEditableStat('Peak Rank', 'peakRank', stats.peakRank, { rankPickerKind })}
    ${renderMyListGameProfileEditableStat('Current Rank', 'currentRank', stats.currentRank, { rankPickerKind })}
    ${renderMyListGameProfileEditableStat('Season KD', 'seasonKd', stats.seasonKd)}
    ${renderMyListGameProfileEditableStat('Lifetime KD', 'lifetimeKd', stats.lifetimeKd)}
  `;
  const readStatGrid = `
    ${renderMyListGameProfileReadStat('Peak Rank', stats.peakRank, { rankPickerKind })}
    ${renderMyListGameProfileReadStat('Current Rank', stats.currentRank, { rankPickerKind })}
    ${renderMyListGameProfileReadStat('Season KD', stats.seasonKd)}
    ${renderMyListGameProfileReadStat('Lifetime KD', stats.lifetimeKd)}
  `;
  const shareOwnerUid = String((readOnly ? options.ownerUid : (currentUser?.uid || '')) || '').trim();
  const shareUrl = buildMyListGameProfileShareUrl(shareOwnerUid, key, item, { title, poster });
  const overlay = document.createElement('div');
  overlay.id = 'mylist-game-profile-page';
  overlay.className = `mylist-game-profile-page${isEditing ? ' is-editing' : ''}`;
  overlay.dataset.gameProfileItemId = key;
  overlay.dataset.shareUrl = shareUrl;
  overlay.dataset.shareTitle = title;
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
        <div class="mylist-game-profile-actions">
          <button class="mylist-game-profile-share" type="button" onclick="shareMyListGameProfile(event)" aria-label="Share game profile" title="Share">${getMyListGameProfileShareIconSvg()}</button>
          ${canEdit ? `<button class="mylist-game-profile-edit" type="button" onclick="${isEditing ? `saveMyListGameProfileInline(event,'${escAttr(key)}')` : `openMyListGameProfileEdit(event,'${escAttr(key)}')`}">${isEditing ? 'Save' : 'Edit'}</button>` : ''}
        </div>
      </header>
      <main class="mylist-game-profile-scroll">
        <section class="mylist-game-profile-hero"${poster ? ` style="--game-profile-cover:url('${escAttr(poster)}')"` : ''}>
          <div class="mylist-game-profile-hero-bg" aria-hidden="true"></div>
          <div class="mylist-game-profile-hero-glow" aria-hidden="true"></div>
          <div class="mylist-game-profile-hero-card">
            <button class="mylist-game-profile-cover${poster ? '' : ' no-img'}" type="button" onclick="openMyListGameProfileMediaProfile(event,'${escAttr(key)}')" aria-label="Open ${escAttr(title)} media profile" ${poster ? `style="background-image:url('${escAttr(poster)}')"` : ''}>${poster ? '' : escHtml(title.slice(0, 1).toUpperCase() || 'G')}</button>
            <div class="mylist-game-profile-identity">
              ${isCompetitive ? `<div class="mylist-game-profile-kicker">Competitive</div>` : ''}
              <h1>${escHtml(title)}</h1>
              ${metaChipsHtml}
              ${renderMyListGameProfileHeroRating(item, key)}
            </div>
          </div>
          ${factsHtml}
        </section>
        ${isEditing && isCompetitive ? `<section class="mylist-game-profile-panel mylist-game-profile-edit-meta" aria-label="Tracker profile">
          <div class="mylist-game-profile-panel-head">
            <span>Profile Setup</span>
            <small>Tracker source and platform</small>
          </div>
          <div class="mylist-game-profile-edit-meta-grid">
            <label><span>Tracker title</span><select data-game-profile-edit-field="gameSlug">${getMyListGameProfileTrackerGameOptions(item)}</select></label>
            <label><span>Platform</span><select data-game-profile-edit-field="platform">${getMyListGameProfilePlatformOptions(trackerPlatform)}</select></label>
            <label><span>Hours played</span><input data-game-profile-edit-field="hours" type="text" inputmode="numeric" value="${escAttr(String(details.hours || ''))}" placeholder="0"></label>
          </div>
        </section>` : ''}
        ${isCompetitive ? `<section class="mylist-game-profile-panel" aria-label="Competitive stats">
          <div class="mylist-game-profile-panel-head">
            <span>Competitive Status</span>
            <small>${isEditing ? 'Tap fields to edit' : 'Peak, current, and KD snapshot'}</small>
          </div>
          <div class="mylist-game-profile-stat-grid">
            ${isEditing ? editStatGrid : readStatGrid}
          </div>
        </section>` : ''}
        ${isSinglePlayer ? `<section class="mylist-game-profile-panel mylist-game-profile-achievements" aria-label="Achievements">
          <div class="mylist-game-profile-panel-head mylist-game-profile-achievements-head" role="button" tabindex="0" aria-expanded="true" onclick="toggleAchievementsCollapse(this)">
            <span>Achievements <svg class="achv-collapse-chevron" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path></svg></span>
            <small>Steam unlock progress</small>
          </div>
          <div class="mylist-game-profile-achievements-body" id="mylist-game-profile-achievements-body">
            <p class="mylist-game-profile-achievements-empty">Checking Steam…</p>
          </div>
        </section>` : ''}
        <section class="mylist-game-profile-panel mylist-game-profile-links" aria-label="Links">
          <div class="mylist-game-profile-panel-head">
            <span>Links</span>
            <small>${isEditing ? 'Paste profile and highlight links' : 'Open connected profile links'}</small>
          </div>
          ${isEditing ? renderMyListGameProfileEditableLink('Tracker.gg', 'trackerUrl', trackerHref, 'Tracker.gg profile URL or handle', trackerHomeUrl) : renderMyListGameProfileReadLink('Tracker.gg', trackerHref, trackerHomeUrl)}
          ${isEditing ? renderMyListGameProfileHighlightButton(highlightClips) : renderMyListGameProfileReadLink('Highlights', highlightsHref)}
          ${isEditing ? `<div id="mylist-game-profile-edit-status" class="mylist-game-profile-edit-status" aria-live="polite"></div>` : ''}
        </section>
        ${!isEditing ? renderMyListGameProfileHighlightEmbed(highlightClips) : ''}
      </main>
    </div>
  `;
  document.body.appendChild(overlay);
  installMyListGameProfileZoomGuards(overlay);
  document.body.classList.add('mylist-game-profile-open');
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  if (isSinglePlayer) hydrateMyListGameProfileAchievements(item);
}
window.openMyListGameProfilePage = openMyListGameProfilePage;

/* Achievements panel body for the single-player game profile page. Mirrors the
   media-profile grid (progress + bar + tiles + rarity) but omits the duplicate
   heading since the panel already has one. */
function renderMyListGameProfileAchievementsBody(data = {}) {
  const list = Array.isArray(data.achievements) ? data.achievements : [];
  if (!list.length) return `<p class="mylist-game-profile-achievements-empty">No achievement progress found for this title yet.</p>`;
  const total = Number(data.total || list.length);
  const unlocked = Number(data.unlocked || 0);
  const percent = Math.max(0, Math.min(100, Number(data.percent || 0)));
  const initial = list.slice(0, STEAM_ACHIEVEMENTS_INITIAL_VISIBLE);
  const rest = list.slice(STEAM_ACHIEVEMENTS_INITIAL_VISIBLE);
  const privateNote = data.private
    ? `<p class="steam-achv-note">Set your Steam profile's game details to <strong>Public</strong> to track your unlocks.</p>`
    : '';
  return `<div class="steam-achv-progress steam-achv-progress-row"><span class="steam-achv-count"><strong>${unlocked.toLocaleString('en-US')}</strong> / ${total.toLocaleString('en-US')}</span><span class="steam-achv-percent">${percent}%</span></div>
    <div class="steam-achv-bar"><span style="width:${percent}%"></span></div>
    ${privateNote}
    <div class="steam-achv-grid">${initial.map(renderSteamAchievementTile).join('')}</div>
    ${rest.length ? `<div class="steam-achv-grid steam-achv-rest" hidden>${rest.map(renderSteamAchievementTile).join('')}</div>
    <button type="button" class="steam-achv-toggle" onclick="expandSteamAchievements(this)">Show all ${total.toLocaleString('en-US')}</button>` : ''}`;
}

/* Always keeps the Achievements panel header visible. Fills the body with the
   user's unlock progress, or a clear empty/placeholder state when there is no
   linked Steam account, no Steam App ID, or no achievements for this title. */
async function hydrateMyListGameProfileAchievements(item = {}) {
  const bodyId = 'mylist-game-profile-achievements-body';
  if (!document.getElementById(bodyId)) return;
  const setBody = (html) => { const el = document.getElementById(bodyId); if (el) el.innerHTML = html; };
  const empty = (msg) => `<p class="mylist-game-profile-achievements-empty">${escHtml(msg)}</p>`;
  const steamId = (typeof getLinkedSteamId === 'function') ? getLinkedSteamId() : String(userProfile?.steamConnection?.steamId || '').trim();
  const appId = (typeof resolveSteamAppIdForGame === 'function')
    ? await resolveSteamAppIdForGame(item, getGameRawgIdValue(item))
    : String(item.steamAppId || item.appId || '').trim();
  if (!document.getElementById(bodyId)) return;
  if (!appId) { setBody(empty('No Steam achievements are available for this title.')); return; }
  if (!steamId) { setBody(empty('Connect your Steam account to track achievements.')); return; }
  try {
    const res = await fetch(`/api/steam/achievements?appid=${encodeURIComponent(appId)}&steamId=${encodeURIComponent(steamId)}`);
    const data = await res.json();
    if (!document.getElementById(bodyId)) return;
    if (data && data.ok && data.hasAchievements && (data.hasPlayerData || data.private)) {
      setBody(renderMyListGameProfileAchievementsBody(data));
    } else if (data && data.ok && !data.hasAchievements) {
      setBody(empty('This title has no Steam achievements.'));
    } else if (data && data.private) {
      setBody(empty('Set your Steam game details to Public to track your unlocks.'));
    } else {
      setBody(empty('No achievement progress found for this title yet.'));
    }
  } catch (_) {
    setBody(empty('Could not load achievements right now.'));
  }
}

/* ---- Shareable competitive game profile -------------------------------------
   The competitive profile (rank, KD, tracker, highlight) is small, non-sensitive
   data, so the whole snapshot rides in the share URL's query params. That keeps
   shared links working for any recipient — signed-in or signed-out — with no
   public Firestore doc and no security-rule dependency. The deep-link viewer
   rebuilds an item object from those params and renders read-only. */
function getMyListGameProfileShareIconSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M12 2v13"/><path d="m16 6-4-4-4 4"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/></svg>`;
}

function buildMyListGameProfileShareUrl(ownerUid = '', itemId = '', item = {}, extra = {}) {
  const shareOrigin = window.SHELFD_SHARE_ORIGIN || 'https://myshelfd.com';
  const safeOwner = encodeURIComponent(String(ownerUid || 'u').trim() || 'u');
  const safeId = encodeURIComponent(String(itemId || '').trim());
  const url = new URL(`/game-profile/${safeOwner}/${safeId}`, shareOrigin);
  const stats = getMyListGameProfileStats(item);
  const details = getScreenListGameDetailValuesFromItem(item);
  const title = String(extra.title || item.title || item.name || '').trim();
  const poster = String(extra.poster || '').trim();
  const year = String(item.year || item.releaseYear || (item.released ? String(item.released).slice(0, 4) : '') || '').trim();
  const genre = getMyListGameProfileGenreText(item.genre || item.genres || item.gameGenre || '');
  const slug = String((item.competitiveStats && item.competitiveStats.gameSlug) || item.trackerGameSlug || '').trim();
  const set = (key, value) => { const v = String(value || '').trim(); if (v && v !== '-') url.searchParams.set(key, v); };
  set('title', title);
  if (/^https?:\/\//i.test(poster)) url.searchParams.set('poster', poster);
  set('year', year);
  set('platform', details.platform);
  set('genre', genre === 'Competitive' ? '' : genre);
  set('hours', details.hours);
  set('currentRank', stats.currentRank);
  set('peakRank', stats.peakRank);
  set('seasonKd', stats.seasonKd);
  set('lifetimeKd', stats.lifetimeKd);
  set('tracker', stats.trackerUrl);
  set('highlight', stats.highlightsUrl);
  set('slug', slug);
  return url.toString();
}

function buildMyListGameProfileItemFromShareParams(itemId = '', params = null) {
  const sp = params instanceof URLSearchParams ? params : new URLSearchParams(params || '');
  const get = key => String(sp.get(key) || '').trim();
  return {
    id: String(itemId || '').trim(),
    title: get('title') || 'Game Profile',
    year: get('year'),
    cover: get('poster'),
    gamePlatform: get('platform'),
    genre: get('genre'),
    gameHoursPlayed: get('hours'),
    trackerGameSlug: get('slug'),
    gameTrackerUrl: get('tracker'),
    highlightUrl: get('highlight'),
    competitiveStats: {
      currentRank: get('currentRank'),
      peakRank: get('peakRank'),
      seasonKd: get('seasonKd'),
      lifetimeKd: get('lifetimeKd'),
      sourceUrl: get('tracker'),
      gameSlug: get('slug')
    }
  };
}

async function copyMyListGameProfileShareLink(text = '') {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {}
  const input = document.createElement('input');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  input.style.pointerEvents = 'none';
  document.body.appendChild(input);
  input.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch (_) { copied = false; }
  input.remove();
  return copied;
}

async function shareMyListGameProfile(event = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const overlay = document.getElementById('mylist-game-profile-page');
  const shareUrl = String(overlay?.dataset?.shareUrl || '').trim();
  if (!shareUrl) return;
  const title = String(overlay?.dataset?.shareTitle || 'Game profile').trim();
  const shareData = {
    title: `${title} on Shelfd`,
    text: `Check out this ${title} profile on Shelfd.`,
    url: shareUrl
  };
  try {
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  const copied = await copyMyListGameProfileShareLink(shareUrl);
  if (typeof showToast === 'function') showToast(copied ? 'Profile link copied' : 'Could not copy profile link');
}
window.shareMyListGameProfile = shareMyListGameProfile;

function parseScreenListGameProfileRoute(urlLike = window.location) {
  try {
    const nextUrl = typeof urlLike === 'string' ? new URL(urlLike, window.location.origin) : urlLike;
    const pathname = String(nextUrl?.pathname || '');
    const hash = String(nextUrl?.hash || '');
    const pathMatch = pathname.match(/^\/game-profile\/([^/?#]+)\/([^/?#]+)/i);
    const hashMatch = hash.match(/^#game-profile\/([^/?#]+)\/([^/?#]+)/i);
    const match = pathMatch || hashMatch;
    if (!match) return null;
    const params = nextUrl?.searchParams instanceof URLSearchParams
      ? nextUrl.searchParams
      : new URL(String(urlLike || window.location.href), window.location.origin).searchParams;
    return {
      ownerUid: decodeURIComponent(match[1] || '').trim(),
      itemId: decodeURIComponent(match[2] || '').trim(),
      params
    };
  } catch (_) {
    return null;
  }
}
window.parseScreenListGameProfileRoute = parseScreenListGameProfileRoute;

let sharedGameProfileRouteOpening = false;
async function openSharedGameProfileRoute(route = parseScreenListGameProfileRoute()) {
  if (!route?.itemId || sharedGameProfileRouteOpening) return false;
  sharedGameProfileRouteOpening = true;
  try {
    if (typeof prepareSharedMediaRouteView === 'function') prepareSharedMediaRouteView();
    const item = buildMyListGameProfileItemFromShareParams(route.itemId, route.params);
    openMyListGameProfilePage(route.itemId, { item, readOnly: true, ownerUid: route.ownerUid });
    return true;
  } catch (e) {
    console.error('Shared game profile route failed:', e);
    if (typeof showToast === 'function') showToast('Could not open game profile');
    if (!currentUser && typeof showLandingPage === 'function') showLandingPage();
    return false;
  } finally {
    sharedGameProfileRouteOpening = false;
  }
}
window.openSharedGameProfileRoute = openSharedGameProfileRoute;

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
  const target = event?.target || null;
  const optionsTray = target?.closest?.('.game-status-options') || null;
  /* v11.203: scroll-aware tap guard. Native horizontal scroll now owns the
     tray (the old custom pointer drag-scroll was removed — it fought iOS
     momentum scrolling and made scrubbing unreliable). To still prevent an
     accidental status change when the user was actually scrubbing, we mark
     the tray `data-scrub-moved="1"` from a pointerdown→pointerup scrollLeft
     delta (see initGameStatusSelectorScrubGuard). If it moved, swallow the
     click. */
  if (optionsTray?.dataset?.scrubMoved === '1') return;
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

/* v11.203: REBUILT status pop-out scrolling.
   The old implementation (initGameStatusSelectorHorizontalDrag) manually set
   `scrollLeft` from pointer deltas and called preventDefault() on a natively-
   scrollable element. On iOS WKWebView that fought the browser's own momentum
   scroll: it needed 6px of travel to even engage, had no inertia, and the
   competing native+manual scroll produced stutter and "no real scrubbing."
   Combined with `scroll-snap` + `scroll-behavior: smooth` (which resisted free
   1:1 scrubbing) and the `max-width` open animation (which gated scrollability
   for 340ms so early touches no-op'd), it felt broken.

   New approach: let NATIVE scroll own it entirely (overflow-x:auto +
   touch-action:pan-x + -webkit-overflow-scrolling:touch in CSS = buttery iOS
   momentum for free). This tiny guard only tracks whether the tray actually
   SCROLLED between pointerdown and the click, so a scrub doesn't accidentally
   fire a status change. No preventDefault, no manual scrollLeft — nothing that
   can fight the native scroller. */
(function initGameStatusSelectorScrubGuard() {
  if (window.__shelfdGameStatusSelectorScrubGuardInit) return;
  window.__shelfdGameStatusSelectorScrubGuardInit = true;

  let watchTray = null;
  let downScrollLeft = 0;

  document.addEventListener('pointerdown', (event) => {
    const tray = event.target?.closest?.('.game-status-selector.expanded .game-status-options');
    if (!tray) { watchTray = null; return; }
    watchTray = tray;
    downScrollLeft = tray.scrollLeft || 0;
    try { tray.dataset.scrubMoved = '0'; } catch (_) {}
    if (tray._scrubResetTimer) { clearTimeout(tray._scrubResetTimer); tray._scrubResetTimer = null; }
  }, { passive: true });

  function settleScrub(event) {
    const tray = watchTray;
    watchTray = null;
    if (!tray) return;
    /* If the tray's scroll position changed at all during the press, the user
       was scrubbing — flag it so the pill's onclick (which fires right after
       pointerup) is swallowed by changeGameStatusFromSelector's guard. Reset
       shortly after so the next genuine tap isn't blocked. */
    const moved = Math.abs((tray.scrollLeft || 0) - downScrollLeft) > 3;
    try { tray.dataset.scrubMoved = moved ? '1' : '0'; } catch (_) {}
    if (moved) {
      tray._scrubResetTimer = setTimeout(() => {
        try { tray.dataset.scrubMoved = '0'; } catch (_) {}
        tray._scrubResetTimer = null;
      }, 120);
    }
  }

  document.addEventListener('pointerup', settleScrub, { passive: true });
  document.addEventListener('pointercancel', settleScrub, { passive: true });
})();

/* v11.411: TAP dispatcher for the status pop-out option pills.
   Problem: trying to scrub the pop-out registered as a button press — the
   <button> pill intercepted the touch, flashed its pushed-in state, and killed
   the native horizontal scroll. Fix: on touch devices the option pills are now
   `pointer-events: none` (see 01-mylists-cards-episodes.css), so they can NEVER
   intercept a drag — the tray scrolls natively every time. That also means a
   genuine tap no longer reaches the pill's own onclick, so we synthesize it
   here: a touch that ENDS without moving past a small slop is a tap → find the
   pill under the lift point (by X column, so the whole tall hit-band counts) and
   fire its click. A touch that moved was a scrub → do nothing (native scroll
   already handled it). Desktop keeps native clicks (pills stay interactive). */
(function initStatusTrayTapDispatch() {
  if (window.__shelfdStatusTrayTapDispatchInit) return;
  window.__shelfdStatusTrayTapDispatchInit = true;
  const TAP_SLOP = 8;
  let tray = null, startX = 0, startY = 0, moved = false;

  document.addEventListener('touchstart', (event) => {
    tray = event.target?.closest?.('.game-status-selector.expanded .game-status-options') || null;
    if (!tray) return;
    const t = event.touches && event.touches[0];
    if (!t) { tray = null; return; }
    startX = t.clientX; startY = t.clientY; moved = false;
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    if (!tray) return;
    const t = event.touches && event.touches[0];
    if (!t) return;
    if (Math.abs(t.clientX - startX) > TAP_SLOP || Math.abs(t.clientY - startY) > TAP_SLOP) moved = true;
  }, { passive: true });

  document.addEventListener('touchend', (event) => {
    const current = tray;
    tray = null;
    if (!current || moved) return;   // moved = scrub; native scroll owned it
    const t = event.changedTouches && event.changedTouches[0];
    if (!t) return;
    const pill = Array.from(current.querySelectorAll('.status-pill')).find(p => {
      const r = p.getBoundingClientRect();
      return t.clientX >= r.left && t.clientX <= r.right;   // X column = whole tall tap band
    });
    if (pill && typeof pill.click === 'function') pill.click();
  }, { passive: true });

  document.addEventListener('touchcancel', () => { tray = null; }, { passive: true });
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
    const fallbackAvatar = '/default-avatar.svg#' + encodeURIComponent(c.name || '?') + '&background=1e2028&color=60a5fa&size=32';
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

  const normalizedData = typeof compactImportedAnimeForStorage === 'function'
    ? compactImportedAnimeForStorage(nextData)
    : (typeof normalizeListData === 'function' ? normalizeListData(nextData) : nextData);
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
    if (typeof writeOwnLocalBackupSafely === 'function') {
      writeOwnLocalBackupSafely(data, 'saveGameDetailsEdit');
    } else if (currentUser) {
      localStorage.setItem('screenlist-own-data-backup-' + currentUser.uid, JSON.stringify(data));
    } else {
      localStorage.setItem('watchlist-tracker-data', JSON.stringify(data));
    }

    if (DOC_REF) {
      await persistOwnDataToFirestore(compactImportedAnimeForStorage(data), { sections: ['games'] });
    }

    if (currentUser?.uid === CREATOR_PUBLIC_UID && typeof syncCreatorPublicProfileMirror === 'function') {
      syncCreatorPublicProfileMirror(currentUser, userProfile, null, {
        clearListData: true,
        includeListData: false,
        reason: 'saveGameDetailsEdit'
      }).catch(error => console.warn('Creator mirror sync failed after game details save:', error));
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

/* v11.509: genres that must never appear on a Shelf card. "Anime" is redundant
   (the whole section is anime) and "Award Winning" is a MAL theme, not a real
   genre. Both are excluded so the card surfaces the actual genres (Horror,
   Mystery, Action, …) instead. Stored normalized (lowercase, non-alphanumerics
   collapsed to single spaces) so "Award-Winning" / "Award Winning" both match.
   Neither string occurs in TMDB's movie/TV genre set, so this is a no-op there. */
const MYLIST_EXCLUDED_CARD_GENRES = new Set(['anime', 'award winning']);
function normalizeMyListGenreKey(genre = '') {
  return String(genre || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function isExcludedMyListCardGenre(genre = '') {
  return MYLIST_EXCLUDED_CARD_GENRES.has(normalizeMyListGenreKey(genre));
}

/* v10.77: cap a comma-separated genre string to the first N entries, trimmed
   and de-blanked. Used to limit Watched movie/TV/anime cards to 2 genres
   without affecting other contexts that still show the full string.
   v11.509: drops the excluded genres above BEFORE the slice, so the next real
   genres are picked up to fill the limit. */
function formatMyListGenreList(value = '', max = 2) {
  return String(value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(g => !isExcludedMyListCardGenre(g))
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

/* v11.398: an episode is "aired" if it has already come out. Confirmed-but-
   unaired episodes from upcoming seasons are excluded from the count + percent
   so the card / detail show what's CURRENTLY out (e.g. House of the Dragon =
   18, not the confirmed 26). Uses the episode's own air date, falling back to
   its season's air date (item.seasonsInfo); undated episodes are treated as
   already aired (legacy data). */
function isScreenListEpisodeAired(ep, item) {
  if (!ep || typeof ep !== 'object') return true;
  const todayStart = getScreenListTodayStart();
  const epDate = String(ep.airDate || ep.air_date || '').trim();
  if (epDate) {
    const parsed = parseScreenListDateOnly(epDate);
    return parsed ? parsed.getTime() <= todayStart : true;
  }
  const seasonNum = Number(ep.seasonNum || ep.season_number || 0);
  const seasons = Array.isArray(item && item.seasonsInfo) ? item.seasonsInfo : [];
  const season = seasons.find(s => Number((s && (s.seasonNum || s.season_number)) || 0) === seasonNum);
  const sDate = String((season && (season.airDate || season.air_date)) || '').trim();
  if (sDate) {
    const sParsed = parseScreenListDateOnly(sDate);
    if (sParsed && sParsed.getTime() > todayStart) return false; // future season → unaired
  }
  return true;
}

/* v11.398: aired-episode count for a TMDB show-details object (the discovery /
   show detail page). Sums episode_count for seasons that have already premiered,
   and for the season currently airing uses next_episode_to_air to count only the
   episodes before it. Returns 0 when there's no usable season data so callers
   can fall back to number_of_episodes. */
function computeShelfdAiredEpisodeCount(details) {
  const seasons = Array.isArray(details && details.seasons) ? details.seasons : [];
  if (!seasons.length) return 0;
  const todayStart = getScreenListTodayStart();
  const nextEp = (details && (details.next_episode_to_air || details.nextEpisodeToAir)) || null;
  const nextEpSeason = nextEp ? Number(nextEp.season_number || nextEp.seasonNumber || 0) : 0;
  const nextEpNum = nextEp ? Number(nextEp.episode_number || nextEp.episodeNumber || 0) : 0;
  let aired = 0;
  let counted = false;
  for (const s of seasons) {
    const num = Number((s && s.season_number) || 0);
    if (num < 1) continue; // skip Specials (season 0)
    const count = Number((s && s.episode_count) || 0);
    const sDate = String((s && s.air_date) || '').trim();
    if (!sDate) { aired += count; counted = true; continue; }
    const parsed = parseScreenListDateOnly(sDate);
    if (!parsed || parsed.getTime() > todayStart) { counted = true; continue; } // future season → excluded
    counted = true;
    if (nextEp && num === nextEpSeason && nextEpNum >= 1) aired += Math.max(0, nextEpNum - 1);
    else aired += count;
  }
  return counted ? aired : 0;
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

/* v11.294: whole-day countdown from today to a date-only value. Both ends are
   normalized to local midnight (parseScreenListDateOnly + getScreenListTodayStart),
   so the difference is an exact integer day count. Returns null on a bad date,
   0 for today, positive for future. Used to render "Next episode in N days"
   instead of a bare M/D date on the My Lists card. */
function getScreenListDaysUntilDate(value = '') {
  const date = parseScreenListDateOnly(value);
  if (!date) return null;
  return Math.round((date.getTime() - getScreenListTodayStart()) / 86400000);
}

/* v11.294: "Next episode in 7 days" / "Next episode in 1 day" countdown copy.
   Only used for regular upcoming episodes — season premieres and finales keep
   their dated labels. Falls back to the dated label if the day count is
   unavailable. */
function formatMyListNextEpisodeCountdownLabel(value = '') {
  const days = getScreenListDaysUntilDate(value);
  if (days == null || days < 1) return '';
  return `Next episode in ${days} ${days === 1 ? 'day' : 'days'}`;
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
  const nextEpisode = item?.next_episode_to_air || item?.nextEpisodeToAir || item?.nextEpisode || {};
  const epNumber = Number(nextEpisode?.episode_number || nextEpisode?.episodeNumber || nextEpisode?.epNum || 0);
  const seasonEpisodeCount = Number(nextEpisode?.seasonEpisodeCount || 0);
  /* v11.294 (supersedes v10.846): episode 1 of ANY season is, by definition, a season premiere, so
     it is the sole reliable signal — the old code ALSO required the season-level
     air_date and season_number to match, but TMDB frequently reports a season's
     `air_date` a few days off from its actual episode-1 air_date. House of the
     Dragon S3 (E1 airing 6/21) was being mislabeled "Next episode airing 6/21"
     because TMDB's S3 season air_date differed from 6/21. We now treat
     epNumber === 1 as a premiere outright, and ALSO catch the case where the
     upcoming episode lands exactly on a known future season-premiere date even
     when the episode number is missing. */
  const epLandsOnKnownSeasonPremiere = !!seasonDate && !!epDate && epDate === seasonDate
    && isScreenListDateTodayOrFuture(seasonDate);
  const isSeasonPremiereEpisode = epNumber === 1 || epLandsOnKnownSeasonPremiere;
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
    /* Season premieres + finales keep their dated copy. */
    if (isSeasonPremiereEpisode) return `New season airing ${labelDate}`;
    if (isSeasonFinaleEpisode) return `Season final airing ${labelDate}`;
    /* v11.294: a plain upcoming episode now reads as a day countdown
       ("Next episode in 7 days") instead of a bare date. Falls back to the
       dated label if the day count can't be computed. */
    const countdownLabel = formatMyListNextEpisodeCountdownLabel(epDate);
    return countdownLabel || `Next episode airing ${labelDate}`;
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
  /* v11.399: the Watchlist "New season airing {date}" label now lives UNDER the
     "Where to watch" line (renderMyListWatchListMetadataInnerHtml), NOT in the
     action row — so the action row keeps its normal position. The action-row
     next-episode label stays a watching-tab feature only. */
  if (tab !== 'watching') return '';
  if (section !== 'shows' && section !== 'anime') return '';
  return renderMyListNextEpisodeHtml(item, section);
}

/* v11.399: the "New season airing {date}" / "NEW SEASON OUT" line shown under
   "Where to watch" on the TV/anime Watchlist. Empty for anything else. */
function renderMyListWatchlistNewSeasonLineHtml(item = {}, section = activeSection) {
  if (section !== 'shows' && section !== 'anime') return '';
  /* v11.415: never show "New season airing" for a show that has NEVER aired its
     FIRST season. An unreleased show with a FUTURE first-air date (e.g. the new
     Harry Potter series premiering 12/24/2026) is showing its FIRST season — not
     a "new" one — and the release-date line already covers it. We read the
     first-air date SPECIFICALLY (not a generic release date, which can hold an
     UPCOMING season's date for shows that have already aired). */
  const firstAir = String(
    item?.firstAirDate || item?.first_air_date || item?.premiered
    || item?.premiereDate || (item?.aired && item.aired.from) || ''
  ).trim();
  if (firstAir) {
    const parsed = parseScreenListDateOnly(firstAir);
    if (parsed && parsed.getTime() > getScreenListTodayStart()) return '';
  }
  const label = getMyListNextEpisodeLabel(item, section);
  if (!label || !(/^New season airing/i.test(label) || label === 'NEW SEASON OUT')) return '';
  return `<div class="card-availability-line mylist-availability-new-season${label === 'NEW SEASON OUT' ? ' is-new' : ''}">${escHtml(label)}</div>`;
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

/* v11.575/578: game release label for shelf cards — mirrors the TV/anime
   treatment. Returns { label, isToday } or null.
     today        -> "Out now"            (isToday: true -> cyan / 500)
     1-7 days out -> "Releases in N days"  (upcoming -> white 90% / 400)
     >7 days out  -> "Releases {date}"     (upcoming -> white 90% / 400)
     already out  -> "Released {date}"     ONLY when opts.includePast is set
                     (the Wishlist passes it so released games still show a date;
                      the Backlog action-row label previews upcoming only -> null)
     no date      -> null */
function getScreenListGameReleaseCountdown(item = {}, opts = {}) {
  const date = String(
    item?.releaseDate || item?.released || item?.release_date
    || (typeof getScreenListKnownReleaseDate === 'function' ? getScreenListKnownReleaseDate(item) : '') || ''
  ).trim();
  const days = date ? getScreenListDaysUntilDate(date) : null;
  /* Full parseable date → live countdown / dated label. */
  if (date && days != null) {
    const formatted = (typeof formatScreenListReleaseDateLabel === 'function') ? formatScreenListReleaseDateLabel(date) : date;
    if (days === 0) return { label: 'Out now', isToday: true };
    if (days >= 1 && days <= 7) return { label: `Releases in ${days} ${days === 1 ? 'day' : 'days'}`, isToday: false };
    if (days > 7) return formatted ? { label: `Releases ${formatted}`, isToday: false } : null;
    return (opts.includePast && formatted) ? { label: `Released ${formatted}`, isToday: false } : null;
  }
  /* v11.579: no full date stored — RAWG games persist only the 4-digit `year`.
     The Wishlist (includePast) falls back to it so EVERY game still shows a
     release date: "Releases {year}" if the year is still ahead, else
     "Released {year}". (Exact month/day would need a metadata fetch.) */
  if (opts.includePast) {
    const year = String(item?.year || '').trim().slice(0, 4);
    if (/^\d{4}$/.test(year)) {
      return Number(year) > new Date().getFullYear()
        ? { label: `Releases ${year}`, isToday: false }
        : { label: `Released ${year}`, isToday: false };
    }
  }
  return null;
}

function renderGamesWishlistMetadataHtml(item = {}, section = activeSection, tab = activeTab) {
  if (!isGamesWishlistStatusCard(item, section, tab)) return '';
  const lines = [];
  /* v11.577: wishlist game card metadata, in order — Release date, then Genre
     (max 3). Platforms dropped per spec (card shows: title, status, release,
     genre, priority). */
  const gameRelease = getScreenListGameReleaseCountdown(item, { includePast: true });
  if (gameRelease && gameRelease.label) {
    lines.push(`<div class="card-genre games-wishlist-card-release${gameRelease.isToday ? ' is-new' : ''}">${escHtml(gameRelease.label)}</div>`);
  }
  const genre = (typeof formatMyListGenreList === 'function')
    ? formatMyListGenreList(item.genre, 3)
    : String(item?.genre || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 3).join(', ');
  if (genre) lines.push(`<div class="card-genre games-wishlist-card-genre">${escHtml(genre)}</div>`);
  return lines.join('');
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
  if (dateMs >= todayStart) {
    /* v11.988: unreleased titles now also surface "Where to watch" — the service
       the title will air on (TV/anime network, or an announced movie streamer),
       hydrated into item.upcomingWhereToWatch. */
    const upcoming = Array.isArray(item?.upcomingWhereToWatch) ? item.upcomingWhereToWatch : [];
    return { state: 'unreleased', date: dateStr, providers: upcoming };
  }

  const providers = Array.isArray(item?.watchProviders) ? item.watchProviders : [];
  const hasSubscriptionProvider = providers.some(p => p && ['flatrate', 'free', 'ads'].includes(String(p.source || '')));

  if (section === 'movies' && (Date.now() - dateMs) <= SHELFD_THEATRICAL_WINDOW_MS && !hasSubscriptionProvider) {
    return { state: 'in-theaters', date: dateStr, providers: [] };
  }
  return { state: 'released', date: dateStr, providers };
}

/* v11.228: collapse the many TMDB provider variants that all represent the
   SAME brand into one key. TMDB returns e.g. "Amazon Prime Video", "Prime Video
   with Ads", "Amazon Video"; "Netflix", "Netflix Standard with Ads"; "Apple TV",
   "Apple TV+", "<x> Apple TV Channel"; "HBO Max", "Max" — each with its own
   provider_id and a near-identical logo. Deduping by provider_id let all the
   variants through, so a card showed 3 Prime logos / 2 Netflix logos. We key by
   a normalized brand instead so only ONE logo per brand is shown. */
function getWatchProviderBrandKey(provider = {}) {
  let n = String(provider?.provider_name || provider?.name || provider?.label || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  // strip pricing/packaging/channel qualifiers that don't change the brand
  n = n
    .replace(/\bwith ads\b/g, '')
    .replace(/\bstandard with ads\b/g, '')
    .replace(/\bamazon channel\b/g, '')
    .replace(/\bapple tv channel\b/g, '')
    .replace(/\bchannel\b/g, '')
    .replace(/\bplus\b/g, '+')
    .replace(/[^a-z0-9+ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // brand aliasing → one canonical token per service family
  if (/\bnetflix\b/.test(n)) return 'netflix';
  if (/\b(amazon )?prime video\b|\bamazon video\b|\bprime\b/.test(n)) return 'prime';
  if (/\bapple tv\b|\bapple\b/.test(n)) return 'apple';
  if (/\bhbo max\b|\bmax\b/.test(n)) return 'max';
  if (/\bdisney\b/.test(n)) return 'disney';
  if (/\bparamount\b/.test(n)) return 'paramount';
  if (/\bpeacock\b/.test(n)) return 'peacock';
  if (/\bhulu\b/.test(n)) return 'hulu';
  if (/\bstarz\b/.test(n)) return 'starz';
  if (/\bmgm\b/.test(n)) return 'mgm';
  if (/\bfubo\b/.test(n)) return 'fubo';
  if (/\bshowtime\b/.test(n)) return 'showtime';
  if (/\bpluto\b/.test(n)) return 'pluto';
  if (/\btubi\b/.test(n)) return 'tubi';
  if (/\bcrunchyroll\b/.test(n)) return 'crunchyroll';
  return n || String(provider?.provider_id || '');
}

/* v11.416: hard blocklist — these "where to watch" providers are removed
   everywhere (watchlist cards + media profile). Spectrum On Demand and Fandango
   At Home are noisy rent/buy storefronts the user never wants listed. */
const SHELFD_BLOCKED_WATCH_PROVIDERS = new Set(['spectrum on demand', 'fandango at home']);
function isBlockedWatchProvider(provider = {}) {
  const n = String(provider?.provider_name || provider?.name || provider?.label || '').trim().toLowerCase();
  return SHELFD_BLOCKED_WATCH_PROVIDERS.has(n);
}

/* v11.416: a streaming brand should appear ONCE across all "Where to Watch"
   rows. TMDB can list the same brand under more than one monetization row
   (e.g. Prime Video under flatrate AND ads → the "two Prime Video" duplicate),
   so we keep only the first occurrence of each brand across the row set. */
function dedupeBrandsAcrossRows(rows = []) {
  const seenBrand = new Set();
  (Array.isArray(rows) ? rows : []).forEach(row => {
    if (!row || !Array.isArray(row.providers)) return;
    row.providers = row.providers.filter(p => {
      const k = getWatchProviderBrandKey(p) || String(p?.provider_id || '');
      if (!k || seenBrand.has(k)) return false;
      seenBrand.add(k);
      return true;
    });
  });
  return (Array.isArray(rows) ? rows : []).filter(row => row && (row.text || (Array.isArray(row.providers) && row.providers.length)));
}

/* Dedupe a provider list down to one entry per brand, preserving order. */
function dedupeWatchProvidersByBrand(providers = [], limit = 3) {
  const seen = new Set();
  const out = [];
  for (const p of (Array.isArray(providers) ? providers : [])) {
    const key = getWatchProviderBrandKey(p);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

/* v11.295: canonical display name per brand key (matches PROVIDER_DEFINITIONS
   labels). TMDB lists pricing/packaging variants as separate providers —
   "Paramount Plus Premium", "Paramount Plus Essential", "Paramount Plus Amazon
   Channel" — which all share one brand key. We collapse them to a single entry
   and relabel it with the clean brand name so the media profile reads
   "Paramount Plus" instead of every packaging tier. */
const WATCH_PROVIDER_BRAND_DISPLAY_NAMES = {
  netflix: 'Netflix',
  prime: 'Prime Video',
  apple: 'Apple TV',
  max: 'HBO Max',
  disney: 'Disney Plus',
  paramount: 'Paramount Plus',
  peacock: 'Peacock',
  hulu: 'Hulu',
  starz: 'Starz',
  mgm: 'MGM Plus',
  fubo: 'Fubo',
  showtime: 'Showtime',
  pluto: 'Pluto TV',
  tubi: 'Tubi',
  crunchyroll: 'Crunchyroll'
};

/* Canonical, packaging-free display name for a provider. Falls back to the raw
   provider name for brands we don't explicitly alias. */
function getWatchProviderDisplayName(provider = {}) {
  const raw = String(provider?.provider_name || provider?.name || provider?.label || '').trim();
  const key = getWatchProviderBrandKey(provider);
  return WATCH_PROVIDER_BRAND_DISPLAY_NAMES[key] || raw;
}

/* v11.295: collapse a provider list to one entry per brand and relabel each
   survivor with its clean brand name. Used by the media-profile "Where to
   Watch" rows so TMDB packaging variants (Premium / Essential / Amazon
   Channel) and AI/cached rows all read as a single canonical brand. */
function cleanWatchProviderEntries(list = [], limit = 6, hiddenNames = null) {
  const seen = new Set();
  const out = [];
  for (const provider of (Array.isArray(list) ? list : [])) {
    const providerName = String(provider?.provider_name || provider?.name || provider?.label || '').trim();
    if (!providerName) continue;
    if (isBlockedWatchProvider(provider)) continue; // v11.416 global blocklist
    if (hiddenNames && hiddenNames.has(providerName.toLowerCase())) continue;
    const brandKey = getWatchProviderBrandKey(provider) || String(provider?.provider_id || '');
    if (!brandKey || seen.has(brandKey)) continue;
    seen.add(brandKey);
    out.push({ ...provider, provider_name: getWatchProviderDisplayName(provider) });
    if (out.length >= limit) break;
  }
  return out;
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
    const dateLine = label ? `<div class="card-availability-line mylist-availability-release-date">${escHtml(label)}</div>` : '';
    /* v11.988: show "Where to watch:" (the service it airs on) ABOVE the release
       date for unreleased titles, mirroring the released-state line. */
    const providers = Array.isArray(avail.providers) ? avail.providers : [];
    if (providers.length) {
      const logos = dedupeWatchProvidersByBrand(providers, 3).map(renderMyListWatchListProviderLogo).join('');
      const watchLine = `<div class="card-availability-line mylist-availability-where-to-watch"><span class="mylist-availability-where-text">Where to watch:</span><span class="mylist-availability-providers">${logos}</span></div>`;
      return watchLine + dateLine;
    }
    return dateLine;
  }
  if (avail.state === 'in-theaters') {
    return `<div class="card-availability-line mylist-availability-in-theaters">In theaters</div>`;
  }
  if (avail.state === 'released') {
    if (!avail.providers.length) return '';
    /* v11.228: dedupe by brand so cached items with multiple TMDB variants
       (e.g. 3 Prime entries) collapse to one logo per service. */
    const logos = dedupeWatchProvidersByBrand(avail.providers, 3).map(renderMyListWatchListProviderLogo).join('');
    return `<div class="card-availability-line mylist-availability-where-to-watch"><span class="mylist-availability-where-text">Where to watch:</span><span class="mylist-availability-providers">${logos}</span></div>`;
  }
  return '';
}

/* v11.503: "Winter 2026" / "Spring 2025" / "Fall 2027" airing-season label for
   anime cards. Prefers an explicit Jikan season (item.season or the raw payload),
   else derives it from the air date's month using MAL's binning
   (Jan–Mar Winter, Apr–Jun Spring, Jul–Sep Summer, Oct–Dec Fall). Returns ''
   when it can't be determined so the caller omits the line. */
function getMyListAnimeSeasonLabel(item = {}) {
  if (!item) return '';
  const raw = item.__jikanRaw || null;
  let season = String(item.season || item.animeSeason || (raw && raw.season) || '').toLowerCase().trim();
  let year = Number(item.seasonYear || item.animeSeasonYear || (raw && raw.year) || 0) || 0;
  if (!season || !year) {
    const dateStr = String(
      item.first_air_date || item.release_date || item.releaseDate ||
      (item.aired && item.aired.from) || (raw && raw.aired && raw.aired.from) || ''
    ).trim();
    const m = dateStr.match(/^(\d{4})-(\d{2})/);
    if (m) {
      if (!year) year = Number(m[1]) || 0;
      if (!season) {
        const month = Number(m[2]) || 0;
        if (month >= 1 && month <= 3) season = 'winter';
        else if (month <= 6) season = 'spring';
        else if (month <= 9) season = 'summer';
        else if (month <= 12) season = 'fall';
      }
    }
  }
  const labels = { winter: 'Winter', spring: 'Spring', summer: 'Summer', fall: 'Fall' };
  if (!season || !year || !labels[season]) return '';
  return `${labels[season]} ${year}`;
}

/* v11.503: "12 episodes" / "1 episode" for anime cards; '' when the count is
   unknown so the line is simply omitted. Handles episodes stored as a number,
   an array (loaded episode list), or the computed totalEps. */
function getMyListAnimeEpisodeCountLabel(item = {}) {
  let n = Number(item && item.number_of_episodes) || 0;
  if (n <= 0 && item && Array.isArray(item.episodes)) n = item.episodes.length;
  if (n <= 0) n = Number(item && item.totalEps) || 0;
  if (n <= 0) n = Number(item && item.episodes) || 0;
  if (n <= 0) return '';
  return `${n} episode${n === 1 ? '' : 's'}`;
}

/* v11.513: anime → Watched metadata block — release season then episode count,
   in that order (no genre / year / progress). Reuses .watchlist-card-metadata so
   the anime `gap` styling applies, and the same season/episode line classes as
   the Watchlist card for consistent type. */
function renderMyListAnimeWatchedMetaHtml(item = {}) {
  const lines = [];
  const seasonLabel = getMyListAnimeSeasonLabel(item);
  if (seasonLabel) lines.push(`<div class="card-anime-season-line">${escHtml(seasonLabel)}</div>`);
  const episodeLabel = getMyListAnimeEpisodeCountLabel(item);
  if (episodeLabel) lines.push(`<div class="card-anime-episode-line">${escHtml(episodeLabel)}</div>`);
  return lines.length ? `<div class="watchlist-card-metadata">${lines.join('')}</div>` : '';
}

function renderMyListWatchListMetadataInnerHtml(item = {}, section = activeSection, tab = activeTab) {
  if (tab !== 'planned') return '';
  if (!isScreenListMovieTvAnimeSection(section)) return '';
  const lines = [];
  /* v11.503: anime → Watchlist metadata, in the spec order:
       release season (e.g. "Winter 2026") → episode count → where to watch.
     No genre line for anime. */
  if (section === 'anime') {
    const seasonLabel = getMyListAnimeSeasonLabel(item);
    if (seasonLabel) lines.push(`<div class="card-anime-season-line">${escHtml(seasonLabel)}</div>`);
    const episodeLabel = getMyListAnimeEpisodeCountLabel(item);
    if (episodeLabel) lines.push(`<div class="card-anime-episode-line">${escHtml(episodeLabel)}</div>`);
    const animeAvailabilityHtml = renderMyListWatchListAvailabilityHtml(item, section);
    if (animeAvailabilityHtml) lines.push(animeAvailabilityHtml);
    return lines.join('');
  }
  /* v10.836: TV Shows → Watchlist drops the genre line so the card reads
     Title → Status → release/availability. Movies watchlist keeps its genre
     line (anime is handled above). */
  const includeGenre = section !== 'shows';
  if (includeGenre && !shouldHideMyListCardGenre(section, item) && item.genre) {
    lines.push(`<div class="card-genre">${escHtml(item.genre)}</div>`);
  }
  const availabilityHtml = renderMyListWatchListAvailabilityHtml(item, section);
  if (availabilityHtml) lines.push(availabilityHtml);
  /* v11.399: "New season airing {date}" sits as its own line directly under
     "Where to watch" for TV/anime on the Watchlist (not in the action row). */
  const newSeasonLine = renderMyListWatchlistNewSeasonLineHtml(item, section);
  if (newSeasonLine) lines.push(newSeasonLine);
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
        if (isBlockedWatchProvider(p)) continue; // v11.416 global blocklist
        /* v11.228: dedupe by normalized BRAND, not provider_id — TMDB gives
           each pricing/channel variant its own id but the same logo. */
        const id = getWatchProviderBrandKey(p);
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
    /* v11.416: STREAMING ONLY. Show subscription/free/ad-supported providers
       (where you actually watch it). Only fall back to rent/buy when there is NO
       streaming option at all — previously a single streamer (e.g. HBO Max on
       House of the Dragon) was padded out to 3 with rent/buy storefronts (Apple
       TV, Fandango At Home), which the user never wants listed. */
    pushBucket('flatrate');
    pushBucket('free');
    pushBucket('ads');
    if (!ordered.length) {
      pushBucket('rent');
      pushBucket('buy');
    }
    return ordered;
  } catch (error) {
    console.warn('Watchlist watch-provider lookup failed:', error);
    return null;
  }
}

/* v11.988: "Where to watch" source for UNRELEASED titles. TMDB /watch/providers is
   usually empty before a title is out, so for TV/anime we use the NETWORK(s) the
   show airs on (known well ahead of release — e.g. the Harry Potter series → HBO
   Max), falling back to any already-announced streaming provider. Movies have no
   network, so we just try watch-providers (often empty pre-release → no line). */
async function fetchMyListUpcomingWhereToWatch(item = {}, section = activeSection) {
  const tmdbId = String(item?.tmdbId || item?.tmdb_id || '').trim();
  if (!tmdbId) return [];
  if (section === 'movies') {
    const providers = await fetchMyListWatchProviders(item, section);
    return Array.isArray(providers) ? providers : [];
  }
  // TV / anime → the network the show will air on.
  try {
    const res = await fetchTmdbProxy(`tv/${encodeURIComponent(tmdbId)}`);
    const json = res.ok ? await res.json() : null;
    const networks = Array.isArray(json?.networks) ? json.networks : [];
    const seen = new Set();
    const out = [];
    for (const n of networks) {
      const name = String(n?.name || '').trim();
      if (!name) continue;
      const provider = { provider_id: n?.id || '', provider_name: name, logo_path: typeof n?.logo_path === 'string' ? n.logo_path : '', source: 'network' };
      if (isBlockedWatchProvider(provider)) continue;
      const key = getWatchProviderBrandKey(provider) || name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(provider);
      /* "What service it's coming out on" is singular — TMDB lists the primary
         network first (e.g. HBO before HBO Max), so one entry keeps it clean and
         avoids two near-identical logos. */
      if (out.length >= 1) break;
    }
    if (out.length) return out;
    // No network listed → fall back to any already-announced streamer.
    const providers = await fetchMyListWatchProviders(item, section);
    return Array.isArray(providers) ? providers : [];
  } catch (error) {
    console.warn('Watchlist upcoming where-to-watch lookup failed:', error);
    return [];
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
  /* v11.988: availability HTML can be MULTIPLE lines now (unreleased shows
     "Where to watch" ABOVE the release date), so insert/replace ALL children. */
  const nextNodes = Array.from(tmp.children);
  if (!nextNodes.length) { if (node) node.remove(); return; }
  if (node) {
    const existingLines = Array.from(document.querySelectorAll(`${cardSelector} .card-availability-line`));
    node.replaceWith(...nextNodes);
    existingLines.forEach(el => { if (el !== node && el.isConnected) el.remove(); });
    return;
  }
  // Remove any legacy markup before inserting the new line.
  document.querySelectorAll(`${cardSelector} .mylist-upcoming-release-date`).forEach(el => {
    if (!el.classList.contains('card-availability-line')) el.remove();
  });
  const info = document.querySelector(`${cardSelector} .card-info`);
  const status = document.querySelector(`${cardSelector} .status-pills`);
  if (!info) return;
  if (section === 'shows' && String(item?.status || '') === 'planned') {
    const wrapper = document.createElement('div');
    wrapper.className = 'watchlist-card-metadata';
    nextNodes.forEach(n => wrapper.appendChild(n));
    const progress = document.querySelector(`${cardSelector} .progress-area`);
    if (progress && progress.parentNode === info) progress.insertAdjacentElement('afterend', wrapper);
    else info.appendChild(wrapper);
    return;
  }
  if (status && status.parentNode === info) nextNodes.forEach(n => info.insertBefore(n, status));
  else nextNodes.forEach(n => info.appendChild(n));
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
  /* v11.398: a finished show that just picked up a CONFIRMED upcoming season
     (with a release date) should leave Watched and sit in the Watchlist, so the
     user is reminded a new season is coming ("New season airing {date}"). Only
     flips a 'watched' item → 'planned'; never the reverse, and only when a
     future season-premiere date is known. */
  if (item.nextSeasonAirDate && String(item.status || '').toLowerCase() === 'watched') {
    const futureSeason = (typeof isScreenListDateTodayOrFuture === 'function')
      ? isScreenListDateTodayOrFuture(item.nextSeasonAirDate)
      : true;
    if (futureSeason) {
      item.status = 'planned';
      changed = true;
    }
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
        const statusBefore = String(item.status || '').toLowerCase();
        const changed = setMyListNextEpisodeMetadata(item, metadata);
        updateMyListNextEpisodeElement(item, section);
        if (changed && currentUser && !viewingUser) save();
        /* v11.398/v11.399: re-render when the confirmed-season auto-move flips a
           show out of Watched (so it lands in the Watchlist), OR when an
           already-planned TV/anime item picks up its season date (so the "New
           season airing {date}" line under Where-to-watch appears). */
        const statusAfter = String(item.status || '').toLowerCase();
        if (changed && !viewingUser && typeof render === 'function'
            && (statusBefore !== statusAfter
                || ((section === 'shows' || section === 'anime') && statusAfter === 'planned'))) {
          render();
        }
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
    /* v11.988: UNRELEASED → hydrate "Where to watch" (the network/streamer it airs
       on) so the line shows above the release date, same as released titles. */
    if (state === 'unreleased') {
      if (Array.isArray(item.upcomingWhereToWatch)) { updateMyListUpcomingReleaseDateElement(item, section); return; }
      const upKey = `${providerKey}:upcoming`;
      if (SHELFD_WATCHLIST_PROVIDER_LOOKUP_INFLIGHT.has(upKey) || SHELFD_WATCHLIST_PROVIDER_LOOKUP_DONE.has(upKey)) return;
      SHELFD_WATCHLIST_PROVIDER_LOOKUP_INFLIGHT.add(upKey);
      try {
        const w2w = await fetchMyListUpcomingWhereToWatch(item, section);
        if (Array.isArray(w2w)) {
          item.upcomingWhereToWatch = w2w;
          updateMyListUpcomingReleaseDateElement(item, section);
          if (w2w.length && currentUser && !viewingUser) save();
          SHELFD_WATCHLIST_PROVIDER_LOOKUP_DONE.add(upKey);
        }
      } catch (error) {
        console.warn('Watchlist upcoming where-to-watch hydration failed:', error);
      } finally {
        SHELFD_WATCHLIST_PROVIDER_LOOKUP_INFLIGHT.delete(upKey);
      }
      return;
    }
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
  /* v10.236: tag music covers so CSS can lock them to a 1:1 square aspect
     ratio everywhere — album art is always square, never portrait. */
  const isMusicCard = activeSection === 'music';
  const musicClass = isMusicCard ? ' card-cover-music' : '';
  /* v11.230: HD poster fix. Non-game covers now render as a real <img> at
     w500 instead of a CSS background-image. WKWebView (iOS) downscales a real
     <img> with proper retina sharpening — backgrounds looked soft at 3x.
     w500 is the right size for a ~100px @3x box: crisper AND lighter than the
     `original` (2000px) the normalizer returns, which was being crushed into
     the small box. Games keep their existing background-image cover pipeline
     (separate IGDB/Twitch backfill) untouched. */
  const cardCoverImgSrc = cardCoverSrc.replace('https://image.tmdb.org/t/p/original', 'https://image.tmdb.org/t/p/w500');
  const useImgCover = !isGameCard && !!cardCoverSrc;
  const coverImgHtml = useImgCover
    ? `<img class="card-cover-img${isMusicCard ? ' card-cover-img-music' : ''}" src="${escAttr(cardCoverImgSrc)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : '';
  /* Games still paint via background-image; non-game now uses the <img> above,
     so we leave the box background empty (no double download). */
  const coverStyle = (cardCoverSrc && isGameCard)
    ? `background-image:url('${cardCoverSrc}');background-size:cover;background-position:top center;`
    : "";
  const coverPosterAttr = cardCoverSrc ? `data-poster="${escAttr(cardCoverSrc)}"` : '';
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
  const itemStatus = String(item?.status || '').trim();
  const isCompetitiveGameCard = isGameCard && !isGamesWishlistCard && itemStatus.toLowerCase() === 'competitive';
  const isGamePlayingProfileCard = isGameCard
    && !isGamesWishlistCard
    && ['watching', 'live', 'competitive', 'party'].includes(itemStatus.toLowerCase());
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
    ? `<button class="card-title-profile-btn game-title-profile-btn" type="button" data-library-item-id="${itemIdAttr}" data-library-section="${itemSectionAttr}" onclick="${isGamePlayingProfileCard ? `event.stopPropagation();openMyListGameProfilePage('${itemIdAttr}')` : (canOpenTrackerBreakdown ? `openTrackerStatsPage(event,'${itemIdAttr}')` : `openGameMediaProfileFromLibrary(event,'${itemIdAttr}','${itemSectionAttr}')`)}">${escHtml(displayTitle)}</button>`
    : activeSection === 'music'
      ? `<span>${escHtml(displayTitle)}</span>`
      : canOpenProfile
        ? `<button class="card-title-profile-btn media-title-profile-btn" type="button" data-library-item-id="${itemIdAttr}" data-library-section="${itemSectionAttr}" onclick="openLibraryMediaProfile(event,'${itemIdAttr}','${itemSectionAttr}')">${escHtml(displayTitle)}</button>`
        : `<span>${escHtml(displayTitle)}</span>`;
  const coverProfileAttrs = canOpenProfile ? `data-library-item-id="${itemIdAttr}" data-library-section="${itemSectionAttr}" role="button" tabindex="0" aria-label="Open ${escAttr(displayTitle)} profile"` : '';
  const coverProfileClass = canOpenProfile ? ' card-cover-profile-btn' : '';
  if (activeTab === 'planned' && isScreenListMovieTvAnimeSection(activeSection)) queueMyListUpcomingReleaseDateHydration(item, activeSection);
  let releaseLabelForActionRow = '';
  let releaseLabelIsToday = false;
  if (activeTab === 'planned' && isGameCard) {
    /* v11.575: >7d = "Releases {date}", 1-7d = "Releases in N days",
       today = "Out now" (cyan). */
    const gameRelease = getScreenListGameReleaseCountdown(item);
    if (gameRelease) {
      releaseLabelForActionRow = gameRelease.label;
      releaseLabelIsToday = gameRelease.isToday;
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
    || (activeSection === 'games' && ['watching', 'live', 'competitive', 'party', 'watched', 'paused'].includes(itemStatus))
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
  // Also show the button for anime with a malId even if totalEpisodes is null —
  // MAL returns null for some airing shows (e.g. "Smoking Behind the Supermarket
  // with You"), so the Jikan fallback inside the episode page can hydrate on open.
  const animeHasTrackingMetadata = activeSection === 'anime' && (
    Number(item.totalEpisodes || item.totalEps || 0) > 0 ||
    !!(item.malId || item.mal_id || item.tmdbId || item.tmdb_id)
  );
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
  /* v10.228: competitive game title cards no longer show the inline
     stats strip (username + current rank + peak rank). Spec: "On the
     title card in the games category, playing competitive ... remove
     those from the title cards." The full breakdown still lives on the
     game profile page (openMyListGameProfilePage) and the Tracker stats
     page. renderScreenListCompetitiveStatsCardHtml is left intact for
     those surfaces; we just stop injecting it into the title card. */
  const competitiveStatsHtml = '';
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
  /* v10.835: TV Shows → Watchlist (planned) gets the same status-pill
     hoist as Movies → Watchlist. Without this the status button rendered
     under year + watchlist-meta, several lines below the title. Reuses
     the existing `.status-pills--under-title` modifier so spacing and
     coloring stay consistent with the movies-watchlist treatment. */
  const isTvShowsWatchlistCard = activeSection === 'shows' && activeTab === 'planned';
  /* v11.503: anime → Watchlist (planned) hoists the status pill under the title
     too, so the card reads Title → Status → release season → episode count →
     where to watch (anime branch of renderMyListWatchListMetadataInnerHtml).
     The bare year line and the bottom "X episodes" progress row are suppressed
     for this card since the season + episode count now live in the metadata block. */
  const isAnimeWatchlistCard = activeSection === 'anime' && activeTab === 'planned';
  /* v11.513: anime → Watched reads Title → Status → season → episode count;
     anime → Paused reads Title → Status → episodes → progress bar. Watched
     already hoists the status pill under the title (isCompletedTabHoist); paused
     is added to showStatusUnderTitle below. */
  const isAnimeWatchedCard = activeSection === 'anime' && activeTab === 'watched';
  const isAnimePausedCard = activeSection === 'anime' && activeTab === 'paused';
  /* v10.841: hoist the status pill directly under the title on EVERY
     TV Shows card (watching / planned / watched / paused), not just
     the watchlist + watched tabs. User spec: "let's make it all 10px
     of space between the title and the status button on every title
     card in the TV's category." That spacing is meaningful only when
     the status pill is the row immediately below the title, so this
     forces the hoist for every shows tab. Companion CSS rule sets
     the 10px gap. */
  const isAnyTvShowsCard = activeSection === 'shows';
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
  const showStatusUnderTitle = isMoviesWatchlistCard || isTvShowsWatchlistCard || isAnyTvShowsCard || isCompletedTabHoist || isAnimeWatchlistCard || isAnimePausedCard;
  const statusPillsWrapClass = `status-pills status-pills-selector-wrap${showStatusUnderTitle ? ' status-pills--under-title' : ''}`;
  const statusPillsHtml = !viewingUser ? `<div class="${statusPillsWrapClass}" id="status-pills-${item.id}">${statusSelectorHtml}</div>` : '';
  const watchlistMetadataHtml = renderMyListWatchListMetadataHtml(item, activeSection, activeTab);
  const animeWatchedMetaHtml = isAnimeWatchedCard ? renderMyListAnimeWatchedMetaHtml(item) : '';
  return `
    <div class="card ${type === "show" ? "show-card" : ""}${isGameCard ? " game-library-card" : ""}${isGamesWishlistCard ? " games-wishlist-card" : ""}${isCompetitiveGameCard ? " game-competitive-card" : ""}${isGamePlayingOrBacklogCard ? " game-playing-backlog-compact-card" : ""}${shouldShiftTvShowRatingLayout ? " tv-show-progress-rating-shift-card" : ""}${useRatingBubble ? " card-uses-rating-bubble" : ""}${isMoviesWatchlistCard ? " movies-watchlist-card" : ""}${isTvShowsWatchlistCard ? " tv-shows-watchlist-card" : ""} ${viewingUser ? "friend-view-card" : ""}${isDraggable ? ' card-draggable' : ''}" id="card-${item.id}" data-mylist-review-card data-library-item-id="${itemIdAttr}" data-library-section="${itemSectionAttr}" onclick="handleMyListCardReviewSurfaceClick(event,'${itemIdAttr}','${itemSectionAttr}')" ${dragAttrs}>
      <div class="card-header">
        <div class="${coverClass}${coverProfileClass}" style="${coverStyle}" ${coverPosterAttr} ${coverProfileAttrs}${activeSection === 'music' ? ` onclick="event.stopPropagation();openMyListMusicCoverClick('${itemIdAttr}')"` : ''}>
          ${coverImgHtml}${!cardCoverSrc ? (isGameCard ? `<span>${SCREENLIST_GAME_COVER_PLACEHOLDER_TEXT}</span>` : emoji) : ''}
        </div>
        <div class="card-info${isGamesWishlistCard ? ' games-wishlist-card-info' : ''}">
          <div class="card-title-row">
            <div class="card-title">${gameTitleMarkup}</div>
            ${!viewingUser ? `<button class="delete-btn" onclick="deleteItem(event,'${item.id}')" title="Delete">×</button>` : ''}
          </div>
          ${showStatusUnderTitle ? statusPillsHtml : ''}
          ${gameStatsHtml}
          ${competitiveStatsHtml}
          ${(activeSection !== 'shows'
              /* v10.840: TV Shows category drops the bare 4-digit year
                 line on EVERY title card (planned, watching, watched,
                 paused). User spec: "remove that from every title card
                 in the TV shows category." Movies/Anime/Music still
                 follow the year rules below. */
              && (((activeTab === 'planned' && isScreenListMovieTvAnimeSection(activeSection) && !isMoviesWatchlistCard && !isAnimeWatchlistCard)
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
              || (activeTab === 'watched' && isScreenListMovieTvAnimeSection(activeSection) && !isAnimeWatchedCard)
              || activeSection === 'music')
              && item.year)) ? `<div class="card-year mylist-watchlist-year">${escHtml(String(item.year).slice(0, 4))}</div>` : ''}
          ${(activeSection === 'music' && item.artist) ? `<div class="card-artist">${escHtml(String(item.artist))}</div>` : ''}
          ${/* v10.434: genre suppressed for ALL game title cards per
                spec ("only read the title, the status button, the
                hours played, and then the action row" — genre not in
                the list). Added `!isGameCard` to the show-genre gate.
                The earlier `shouldTrimGameActivityMetadata` +
                `isCompetitiveGameCard` gates are now redundant for
                games but kept in place because they're cheap and
                document the prior intent. Movies / TV / anime / music
                / books still show genre under their normal rules. */ ''}${activeTab === 'planned' && isScreenListMovieTvAnimeSection(activeSection) ? '' : (!isGameCard && !shouldTrimGameActivityMetadata && !isCompetitiveGameCard && !isGamesWishlistCard && !isAnimeWatchedCard && !isAnimePausedCard && (!shouldHideMyListCardGenre(activeSection, item) && item.genre) ? `<div class="card-genre">${escHtml(isScreenListWatchedMediaCard(activeSection, item) ? formatMyListGenreList(item.genre, 2) : formatMyListGenreList(item.genre, 99))}</div>` : '')}
          ${gamesWishlistMetadataHtml}
          ${isTvShowsWatchlistCard ? '' : watchlistMetadataHtml}
          ${animeWatchedMetaHtml}
          ${!showStatusUnderTitle ? statusPillsHtml : ''}
          ${(type === "show" && !isAnimeWatchlistCard && !isAnimeWatchedCard) ? (item.status === 'planned' ? `
            <div class="progress-area">
              <div class="progress-meta"><span id="progress-count-${item.id}">${totalEps > 0 ? `${totalEps} episodes` : 'Episodes TBD'}</span></div>
            </div>
            ${isTvShowsWatchlistCard ? watchlistMetadataHtml : ''}
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
          ${releaseLabelForActionRow ? `<span class="card-upcoming-release-label${releaseLabelIsToday ? ' is-new' : ''}">${escHtml(releaseLabelForActionRow)}</span>` : ''}
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
      ${isGamePlayingProfileCard ? `<button class="competitive-more-btn" type="button" onclick="event.stopPropagation();openMyListGameProfilePage('${itemIdAttr}')" aria-label="Open game profile">More</button>` : ''}
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
    '.competitive-more-btn'
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
  return '/default-avatar.svg#' + encodeURIComponent(name || 'Shelfd User') + '&background=1c1535&color=a78bfa';
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

function getMyListReviewRatingShareLabel(item = {}, section = activeSection) {
  const rating = Number(item?.rating || 0);
  if (!(rating > 0)) return '';
  const numericLabel = typeof formatRatingValueForSection === 'function'
    ? formatRatingValueForSection(rating, section)
    : String(rating / 2);
  return `${numericLabel}/5`;
}

function buildMyListMediaReviewShareUrl(postId = '', section = '') {
  const cleanPostId = String(postId || '').trim();
  if (!cleanPostId) return window.location.href;
  const overlay = document.getElementById('mylist-media-review-page');
  const shareOrigin = window.SHELFD_SHARE_ORIGIN || 'https://myshelfd.com';
  const url = new URL(`/review/${encodeURIComponent(cleanPostId)}`, shareOrigin);
  const cleanSection = String(section || '').trim();
  if (cleanSection) url.searchParams.set('section', cleanSection);
  const title = String(overlay?.dataset?.reviewTitle || '').trim();
  const user = String(overlay?.dataset?.reviewAuthorName || '').trim();
  const rating = String(overlay?.dataset?.reviewRatingLabel || '').trim();
  const poster = String(overlay?.dataset?.reviewPoster || '').trim();
  const text = String(overlay?.dataset?.reviewText || '').trim();
  if (title) url.searchParams.set('title', title.slice(0, 96));
  if (user) url.searchParams.set('user', user.slice(0, 64));
  if (rating) url.searchParams.set('rating', rating.slice(0, 16));
  if (/^https?:\/\//i.test(poster)) url.searchParams.set('poster', poster);
  if (text) url.searchParams.set('text', text.replace(/\s+/g, ' ').slice(0, 180));
  return url.toString();
}

async function getMyListMediaReviewSharePostId() {
  const overlay = document.getElementById('mylist-media-review-page');
  if (!overlay) return '';
  if (overlay.dataset.reviewRepliesPublic === 'false') return '';
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

function isMyListMediaReviewRepliesEnabled(item = {}, record = {}) {
  if (item?.reviewRepliesPublic === false || record?.reviewRepliesPublic === false) return false;
  if (item?.reviewPrivate === true || record?.reviewPrivate === true) return false;
  const visibility = String(item?.reviewVisibility || record?.reviewVisibility || '').trim().toLowerCase();
  if (visibility === 'private') return false;
  return true;
}

function isOpenMyListMediaReviewReplyEnabled(overlay = document.getElementById('mylist-media-review-page')) {
  return !!overlay && overlay.dataset.reviewRepliesPublic !== 'false';
}

/* v10.247: tracklist dropdown for music album reviews. Lives directly under
   the star rating on the FPReview hero. Shows `#` · title · per-track rating
   (when the user rated that track in the my-list album shelf page). Closed
   by default — tap the row to expand.
   v10.894: now renders the user's per-track rating value next to the star
   (e.g. "★ 4.5") when the track is rated, instead of the bare favorite
   star. Favorited-but-unrated tracks still show a plain star. Tracklist
   was also moved out of the hero's left column at the call site so titles
   can use the full section width (see calling block below). */
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
  const ratingsByKey = item && typeof item.trackRatingsByKey === 'object' && item.trackRatingsByKey !== null
    ? item.trackRatingsByKey
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
  /* v10.894: read the user's per-track rating using the same lookup
     order as 27-music-album-shelf-page.js getTrackRating — stable key
     first (survives reorder), legacy index second. Stored 0–10. */
  const getRatingRaw = (idx) => {
    if (ratingsByKey) {
      const key = stableKey(tracks[idx], idx);
      if (Object.prototype.hasOwnProperty.call(ratingsByKey, key)) {
        const v = Number(ratingsByKey[key] || 0);
        if (v > 0 && v <= 10) return v;
      }
    }
    const v = Number(legacyRatings[idx] || 0);
    if (v > 0 && v <= 10) return v;
    return 0;
  };
  const isHalfStep = typeof isFivePointRatingSection === 'function'
    ? !!isFivePointRatingSection('music')
    : true;
  const formatRating = (raw) => {
    if (!(raw > 0)) return '';
    const display = isHalfStep ? raw / 2 : raw;
    return Number.isInteger(display) ? String(display) : display.toFixed(1);
  };
  const rows = tracks.map((t, idx) => {
    const num = String(t.number || idx + 1);
    const titleStr = String(t.title || 'Untitled');
    const ratingDisplay = formatRating(getRatingRaw(idx));
    let trailing = '';
    if (ratingDisplay) {
      trailing = `<span class="mylist-review-tracklist-rating" aria-label="Rated ${escAttr(ratingDisplay)}"><span class="mylist-review-tracklist-rating-star" aria-hidden="true">&#9733;</span><span class="mylist-review-tracklist-rating-value">${escHtml(ratingDisplay)}</span></span>`;
    } else if (isFav(idx)) {
      trailing = `<span class="mylist-review-tracklist-fav" aria-label="Favorite track">&#9733;</span>`;
    }
    return `
      <li class="mylist-review-tracklist-row">
        <span class="mylist-review-tracklist-num">${escHtml(num)}</span>
        <span class="mylist-review-tracklist-title">${escHtml(titleStr)}</span>
        ${trailing}
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

function cloneMyListMediaReviewDeleteValue(value) {
  if (value === null || typeof value !== 'object') return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return Array.isArray(value) ? value.slice() : { ...value };
  }
}

function restoreMyListMediaReviewDeleteSnapshot(item, snapshot) {
  if (!item || !snapshot) return;
  Object.keys(item).forEach(key => { delete item[key]; });
  Object.assign(item, cloneMyListMediaReviewDeleteValue(snapshot));
}

function findOwnMyListMediaReviewDeleteRecord(itemId = '', section = '', activityId = '') {
  const cleanId = String(itemId || '').trim();
  const cleanSection = String(section || '').trim();
  const cleanActivityId = String(activityId || '').trim();
  if (!cleanId && !cleanActivityId) return null;
  const ownData = (typeof data === 'object' && data) ? data : {};
  const sections = [];
  if (cleanSection) sections.push(cleanSection);
  Object.keys(ownData || {}).forEach(key => {
    if (!sections.includes(key)) sections.push(key);
  });
  for (const key of sections) {
    const list = Array.isArray(ownData?.[key]) ? ownData[key] : [];
    const item = list.find(row => {
      if (!row) return false;
      if (cleanId && String(row.id || '') === cleanId) return true;
      return !!(cleanActivityId && String(row.reviewActivityId || '') === cleanActivityId);
    });
    if (item) return { item, section: key };
  }
  return null;
}

function getMyListMediaReviewDeleteRecord(overlay = document.getElementById('mylist-media-review-page')) {
  if (!overlay) return null;
  const itemId = String(overlay.dataset.reviewItemId || '').trim();
  const section = String(overlay.dataset.reviewSection || '').trim();
  const activityId = String(overlay.dataset.reviewActivityId || '').trim();
  const ownRecord = findOwnMyListMediaReviewDeleteRecord(itemId, section, activityId);
  if (ownRecord) return ownRecord;
  return findMyListReviewItem(itemId, section);
}

function getMyListMediaReviewPostId(post = {}, fallbackId = '') {
  return String(post?.postId || post?.id || fallbackId || '').trim();
}

function getExplicitMyListMediaReviewFeedIds(overlay = document.getElementById('mylist-media-review-page'), item = null) {
  const ids = new Set();
  [
    overlay?.dataset?.reviewActivityId,
    item?.reviewActivityId,
    overlay?.dataset?.reviewInteractionId,
    overlay?.dataset?.reviewReplyCollection === 'feed' ? overlay?.dataset?.reviewReplyDocId : ''
  ].forEach(value => {
    const clean = String(value || '').trim();
    if (clean && !/^activity-interaction-/i.test(clean)) ids.add(clean);
  });
  return Array.from(ids);
}

async function findAllLinkedMediaReviewFeedPostsForDelete(item = null, section = '', overlay = document.getElementById('mylist-media-review-page')) {
  if (!currentUser || typeof db === 'undefined') return [];
  const explicitIds = getExplicitMyListMediaReviewFeedIds(overlay, item);
  const explicitSet = new Set(explicitIds);
  const blockedExplicitIds = new Set();
  const candidates = [];
  const addCandidate = (post = {}, fallbackId = '') => {
    if (!post || typeof post !== 'object') return;
    const id = getMyListMediaReviewPostId(post, fallbackId);
    if (!id) return;
    candidates.push({ ...post, postId: post.postId || id, id: post.id || id });
  };

  if (Array.isArray(window.feedPosts)) {
    window.feedPosts.forEach(post => addCandidate(post));
  }

  await Promise.all(explicitIds.map(async id => {
    try {
      const snap = await db.collection('feed').doc(id).get();
      if (snap?.exists) addCandidate(snap.data() || {}, id);
    } catch (error) {
      console.warn('[review-delete] explicit feed lookup failed:', id, error);
    }
  }));

  try {
    const snap = await db.collection('feed')
      .where('uid', '==', currentUser.uid)
      .orderBy('timestamp', 'desc')
      .limit(240)
      .get();
    snap.forEach(doc => {
      const docData = doc.data() || {};
      addCandidate({ ...docData, postId: docData.postId || doc.id, id: docData.id || doc.id }, doc.id);
    });
  } catch (error) {
    console.warn('[review-delete] linked review feed lookup failed:', error);
  }

  const byId = new Map();
  candidates.forEach((post, index) => {
    const id = getMyListMediaReviewPostId(post, `candidate-${index}`);
    if (!id) return;
    const isExplicit = explicitSet.has(id);
    if (isExplicit && post.uid && String(post.uid) !== String(currentUser.uid)) {
      blockedExplicitIds.add(id);
      return;
    }
    const matchesItem = item && typeof linkedMediaReviewPostMatchesItem === 'function'
      ? linkedMediaReviewPostMatchesItem(post, item, section)
      : false;
    if (!isExplicit && !matchesItem) return;
    const existing = byId.get(id);
    if (!existing || getLinkedMediaReviewPostTime(post) >= getLinkedMediaReviewPostTime(existing)) {
      byId.set(id, post);
    }
  });

  explicitIds.forEach(id => {
    if (!blockedExplicitIds.has(id) && !byId.has(id)) {
      byId.set(id, {
        postId: id,
        id,
        uid: currentUser.uid,
        type: 'media-review',
        eventType: 'review'
      });
    }
  });

  return [...byId.values()].sort((a, b) => getLinkedMediaReviewPostTime(b) - getLinkedMediaReviewPostTime(a));
}

function clearMyListMediaReviewItemFieldsForDelete(item, section = '', overlay = document.getElementById('mylist-media-review-page')) {
  if (!item) return { restore: () => {}, removedFeedPostIds: [] };
  const snapshot = cloneMyListMediaReviewDeleteValue(item);
  const shownText = String(overlay?.dataset?.reviewText || '').trim();
  const primaryTextFields = ['reviewText', 'review', 'essay', 'notes'];
  const hadPrimaryText = primaryTextFields.some(field => String(item?.[field] || '').trim());
  const removedFeedPostIds = [];
  const legacyCardText = String(item?.cardComment?.text || '').trim();
  const legacyCardFeedId = String(item?.cardComment?.linkedActivityId || '').trim();

  [
    'reviewText',
    'review',
    'essay',
    'notes',
    'reviewTags',
    'reviewActivityId',
    'reviewRepliesPublic',
    'reviewVisibility',
    'reviewPrivate',
    'reviewCreatedAt',
    'reviewUpdatedAt',
    'reviewEditedAt',
    'reviewPostedAt',
    'reviewSavedAt',
    'reviewDate',
    'lastReviewedAt',
    'firstTimeWatch'
  ].forEach(field => { delete item[field]; });

  if (legacyCardText && (!hadPrimaryText || (shownText && legacyCardText === shownText))) {
    delete item.cardComment;
    if (legacyCardFeedId) removedFeedPostIds.push(legacyCardFeedId);
  }

  if (typeof markOwnItemLastEdited === 'function') markOwnItemLastEdited(item, section);
  else if (typeof touchItem === 'function') touchItem(item);
  const reviewDeleteActivityAt = item.dateModified || item.lastEditedAt || new Date().toISOString();
  item.lastReviewActivityAt = reviewDeleteActivityAt;
  item.lastReviewActivityKind = 'delete';

  return {
    restore: () => restoreMyListMediaReviewDeleteSnapshot(item, snapshot),
    removedFeedPostIds
  };
}

async function persistMyListMediaReviewItemDelete(section = '') {
  const options = {
    localBackupContext: 'deleteFullPageMediaReview'
  };
  if (section) options.sections = [section];
  if (typeof persistOwnListDataImmediate === 'function') {
    await persistOwnListDataImmediate(data, options);
  } else if (typeof writeOwnDataDirect === 'function') {
    await writeOwnDataDirect(data, options);
  } else {
    save();
  }
}

function getMyListMediaReviewDeleteIds(postIds = [], posts = []) {
  const ids = new Set((postIds || []).map(String).filter(Boolean));
  (posts || []).forEach(post => {
    const fallbackId = getMyListMediaReviewPostId(post);
    if (typeof getScreenListActivityDeleteCandidates === 'function') {
      try {
        getScreenListActivityDeleteCandidates(post, fallbackId).forEach(id => {
          if (id) ids.add(String(id));
        });
        return;
      } catch (_) {}
    }
    if (fallbackId) ids.add(fallbackId);
    if (post?.eventKey) ids.add(String(post.eventKey));
  });
  return Array.from(ids);
}

function purgeMyListMediaReviewDeleteFromMemory(deleteIds = []) {
  const cleanIds = Array.from(new Set((deleteIds || []).map(String).filter(Boolean)));
  if (!cleanIds.length) return;
  const idSet = new Set(cleanIds);
  try {
    if (typeof purgeDeletedActivityFromMemory === 'function') purgeDeletedActivityFromMemory(cleanIds);
  } catch (_) {}
  try {
    if (typeof rememberCurrentUserDeletedActivityIds === 'function') rememberCurrentUserDeletedActivityIds(cleanIds);
  } catch (_) {}
  try {
    if (Array.isArray(window.feedPosts)) {
      window.feedPosts = window.feedPosts.filter(post => {
        const id = getMyListMediaReviewPostId(post);
        return !idSet.has(id) && !(post?.eventKey && idSet.has(String(post.eventKey)));
      });
    }
  } catch (_) {}
  try {
    Object.keys(friendActivityClickTargets || {}).forEach(key => {
      if (idSet.has(String(key))) delete friendActivityClickTargets[key];
    });
  } catch (_) {}
  try {
    document.querySelectorAll('[data-activity-card-id], [data-activity-id], [data-post-id]').forEach(card => {
      const values = [
        card.getAttribute('data-activity-card-id'),
        card.getAttribute('data-activity-id'),
        card.getAttribute('data-post-id')
      ].filter(Boolean);
      if (values.some(value => idSet.has(String(value)))) card.remove();
    });
  } catch (_) {}
  try { if (typeof friendActivityCache !== 'undefined') friendActivityCache = null; } catch (_) {}
  try { if (typeof friendActivityPromise !== 'undefined') friendActivityPromise = null; } catch (_) {}
}

function sanitizeMyListMediaReviewNotificationPart(value = '') {
  if (typeof sanitizeShelfdNotifIdPart === 'function') return sanitizeShelfdNotifIdPart(value);
  const clean = String(value || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return clean ? clean.slice(0, 96) : 'x';
}

async function deleteMyListMediaReviewNotificationDocs(postIds = []) {
  if (!currentUser?.uid || typeof db === 'undefined') return;
  const recipients = [...new Set((Array.isArray(friends) ? friends : [])
    .map(uid => String(uid || '').trim())
    .filter(uid => uid && uid !== currentUser.uid))];
  const cleanPostIds = Array.from(new Set((postIds || []).map(String).filter(Boolean)));
  if (!recipients.length || !cleanPostIds.length) return;
  const actorPart = sanitizeMyListMediaReviewNotificationPart(currentUser.uid);
  const deletes = [];
  cleanPostIds.forEach(postId => {
    const activityPart = sanitizeMyListMediaReviewNotificationPart(postId);
    const docId = `friend_review_posted:${activityPart}:${actorPart}`;
    recipients.forEach(recipientUid => {
      deletes.push(
        db.collection('notifications').doc(recipientUid).collection('items').doc(docId).delete().catch(() => {})
      );
    });
  });
  await Promise.all(deletes);
}

async function deleteMyListMediaReviewReplyMetaDocs(overlay = document.getElementById('mylist-media-review-page')) {
  if (!overlay || typeof db === 'undefined') return;
  const ids = new Set();
  if (String(overlay.dataset.reviewReplyCollection || '') === 'meta') {
    const existingId = String(overlay.dataset.reviewReplyDocId || '').trim();
    if (existingId) ids.add(existingId);
  }
  try {
    const fallbackId = getMyListReviewFallbackInteractionDocId(overlay);
    if (fallbackId) ids.add(fallbackId);
  } catch (_) {}
  await Promise.all(Array.from(ids).map(id => db.collection('meta').doc(id).delete().catch(() => {})));
}

async function deleteMyListMediaReviewFeedPosts(postIds = [], posts = []) {
  if (typeof db === 'undefined') return;
  const cleanPostIds = Array.from(new Set((postIds || []).map(String).filter(Boolean)));
  if (!cleanPostIds.length) return;
  const deleteIds = getMyListMediaReviewDeleteIds(cleanPostIds, posts);
  purgeMyListMediaReviewDeleteFromMemory(deleteIds);

  const results = await Promise.all(cleanPostIds.map(async id => {
    try {
      await db.collection('feed').doc(id).delete();
      return { id, ok: true };
    } catch (error) {
      console.warn('[review-delete] feed delete failed:', id, error);
      return { id, ok: false };
    }
  }));
  await deleteMyListMediaReviewNotificationDocs(cleanPostIds).catch(() => {});
  try {
    if (typeof persistCurrentUserDeletedActivityIds === 'function') {
      await persistCurrentUserDeletedActivityIds(deleteIds);
    }
  } catch (_) {}
  if (results.some(result => !result.ok)) {
    throw new Error('Could not delete every linked review feed post.');
  }
}

async function cleanupPrivateMyListMediaReviewFeedPosts(item = null, section = '', explicitPostId = '') {
  if (!item && !explicitPostId) return;
  try {
    const linkedPosts = await findAllLinkedMediaReviewFeedPostsForDelete(item, section, null);
    const ids = new Set([
      String(explicitPostId || '').trim(),
      ...linkedPosts.map(post => getMyListMediaReviewPostId(post)).filter(Boolean)
    ].filter(Boolean));
    if (!ids.size) return;
    await deleteMyListMediaReviewFeedPosts(Array.from(ids), linkedPosts);
  } catch (error) {
    console.warn('[review-private] linked activity cleanup failed:', error);
  }
}

function showMyListMediaReviewDeletedToast() {
  if (typeof showToast !== 'function') return;
  showToast('Review Deleted', {
    className: 'shelfd-review-deleted-toast',
    durationMs: 1650
  });
}

/* v11.540: the delete-processing spinner overlay was removed — the optimistic
   delete is fast enough that the page-close + "Review Deleted" toast are the only
   acknowledgment needed. (Previously showMyListMediaReviewDeleteOverlay /
   hideMyListMediaReviewDeleteOverlay lived here.) */

async function finalizeMyListMediaReviewDeleteInBackground({
  item = null,
  itemSnapshot = null,
  section = '',
  overlay = null,
  feedPostIds = [],
  restoreItem = null,
  restoreData = null
} = {}) {
  let itemPersisted = false;
  try {
    if (item) {
      await persistMyListMediaReviewItemDelete(section);
      itemPersisted = true;
    }

    const linkedPosts = await findAllLinkedMediaReviewFeedPostsForDelete(itemSnapshot || item, section, overlay);
    const deleteIds = new Set((feedPostIds || []).map(value => String(value || '').trim()).filter(Boolean));
    linkedPosts.forEach(post => {
      const postId = getMyListMediaReviewPostId(post);
      if (postId) deleteIds.add(postId);
    });

    await deleteMyListMediaReviewReplyMetaDocs(overlay);
    if (deleteIds.size) {
      await deleteMyListMediaReviewFeedPosts(Array.from(deleteIds), linkedPosts);
    }
  } catch (error) {
    console.warn('[review-delete] background review cleanup failed:', error);
    if (!itemPersisted) {
      if (typeof restoreData === 'function') {
        try { restoreData(); } catch (_) {}
      } else if (typeof restoreItem === 'function') {
        try { restoreItem(); } catch (_) {}
      }
      try {
        if (typeof render === 'function') render();
      } catch (_) {}
      if (typeof showToast === 'function') showToast('Could not delete review. Try again.');
    }
  }
}

async function deleteMyListMediaReviewEverywhere(event = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const overlay = document.getElementById('mylist-media-review-page');
  if (!overlay || overlay.dataset.reviewIsOwner !== 'true' || !currentUser) return;
  const actionButton = event?.currentTarget || null;
  if (actionButton?.dataset?.deleting === 'true') return;
  const originalButtonText = actionButton?.textContent || 'Delete';
  if (actionButton) {
    actionButton.dataset.deleting = 'true';
    actionButton.disabled = true;
    actionButton.textContent = 'Deleting...';
  }
  closeMyListMediaReviewActions(event);

  let restoreItem = null;
  let restoreData = null;
  try {
    const record = getMyListMediaReviewDeleteRecord(overlay);
    const item = record?.item || null;
    const section = record?.section || overlay.dataset.reviewSection || '';
    const itemSnapshot = item ? cloneMyListMediaReviewDeleteValue(item) : null;
    const feedPostIds = new Set(getExplicitMyListMediaReviewFeedIds(overlay, item));

    if (item) {
      const dataSnapshot = cloneMyListMediaReviewDeleteValue(data);
      restoreData = () => {
        data = cloneMyListMediaReviewDeleteValue(dataSnapshot);
        if (typeof cloneListData === 'function') ownDataCache = cloneListData(data);
      };
      const clearResult = clearMyListMediaReviewItemFieldsForDelete(item, section, overlay);
      restoreItem = clearResult.restore;
      (clearResult.removedFeedPostIds || []).forEach(id => feedPostIds.add(id));
      try { updateCardCommentUI(item); } catch (_) {}
    }

    if (!item && !feedPostIds.size) {
      throw new Error('Review target not found.');
    }

    /* v11.540: optimistic delete — close the page + re-render immediately and run
       the Firestore/feed cleanup in the background. The "Review Deleted" toast is
       the only acknowledgment (the spinner overlay was removed). */
    try { closeFullPageMediaReview(true); } catch (_) {}
    try { if (typeof render === 'function') render(); } catch (_) {}
    showMyListMediaReviewDeletedToast();
    finalizeMyListMediaReviewDeleteInBackground({
      item,
      itemSnapshot,
      section,
      overlay,
      feedPostIds: Array.from(feedPostIds),
      restoreItem,
      restoreData
    });
  } catch (error) {
    console.warn('[review-delete] full-page review delete failed:', error);
    if (typeof restoreData === 'function') {
      try { restoreData(); } catch (_) {}
    } else if (typeof restoreItem === 'function') {
      try { restoreItem(); } catch (_) {}
    }
    if (actionButton) {
      actionButton.disabled = false;
      actionButton.textContent = originalButtonText;
      delete actionButton.dataset.deleting;
    }
    if (typeof showToast === 'function') showToast('Could not delete review. Try again.');
  }
}
window.deleteMyListMediaReviewEverywhere = deleteMyListMediaReviewEverywhere;

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
  if (cleanAction === 'delete') {
    await deleteMyListMediaReviewEverywhere(event);
    return;
  }
  closeMyListMediaReviewActions(event);
  if (typeof showToast === 'function') showToast('Action coming soon');
}
window.handleMyListMediaReviewAction = handleMyListMediaReviewAction;

function getMyListReviewInlineReplyAuthor() {
  const profile = (typeof usersMap === 'object' && currentUser?.uid && usersMap[currentUser.uid]) || userProfile || currentUser || {};
  const name = profile?.name || profile?.customName || currentUser?.displayName || currentUser?.email || 'User';
  const photo = profile?.photo || profile?.customPhoto || currentUser?.photoURL || '';
  /* v11.408: capture the @username handle too, so review replies can display
     the username (not the display name) even if usersMap lacks the record. */
  const username = (typeof getShelfdUsernameHandle === 'function')
    ? (getShelfdUsernameHandle(profile) || getShelfdUsernameHandle(userProfile || {}) || '')
    : '';
  return { name, photo, username };
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
    /* v11.408: show the @USERNAME for review replies, not the display name.
       Merge the reply's stored fields with the live usersMap record so the
       username handle + creator badge resolve from whichever has it. */
    const authorUserLike = profile.uid ? { ...reply, ...profile } : reply;
    const authorHtml = (typeof renderActivityCardUsernameHTML === 'function')
      ? renderActivityCardUsernameHTML(authorUserLike, name, '')
      : renderDisplayNameHTML(authorUserLike, name, '');
    const replyHandle = (typeof getActivityCardUsername === 'function')
      ? getActivityCardUsername(authorUserLike, name)
      : name;
    return `
      <article class="mylist-media-review-reply-item${depthValue ? ' is-child-reply' : ''}" data-review-reply-id="${escAttr(reply.id)}" style="--review-reply-depth:${depthValue}">
        <div class="mylist-media-review-reply-avatar">
          <img src="${escAttr(photo || fallback)}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${escAttr(fallback)}'">
          ${!isLast || childReplies.length ? '<span class="mylist-media-review-reply-line" aria-hidden="true"></span>' : ''}
        </div>
        <div class="mylist-media-review-reply-bubble">
          <div class="mylist-media-review-reply-meta">
            <strong>${authorHtml}</strong>
            ${time ? `<span>${escHtml(time)}</span>` : ''}
          </div>
          <div class="mylist-media-review-reply-text">${escHtml(reply.text || '')}</div>
          <button class="mylist-media-review-reply-inline" type="button" onclick="openMyListMediaReviewReply(event,'${escAttr(reply.id)}','${escAttr(replyHandle)}')">Reply</button>
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
  if (!isOpenMyListMediaReviewReplyEnabled(overlay)) return null;
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
  if (!isOpenMyListMediaReviewReplyEnabled(overlay)) {
    list.innerHTML = '<div class="mylist-media-review-replies-empty mylist-media-review-replies-closed">Replies are off for this review.</div>';
    const countEl = overlay.querySelector('[data-review-reply-count]');
    if (countEl) countEl.textContent = '';
    return;
  }
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
  if (!isOpenMyListMediaReviewReplyEnabled(overlay)) {
    if (typeof showToast === 'function') showToast('Replies are off for this review');
    return false;
  }
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
      username: author.username || '',
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
    /* v11.408: review-reply notifications. TWO recipients can be notified for a
       single reply:
         1) the REVIEW OWNER — for ANY reply posted on their review page, whether
            it's a direct reply to the review or a reply to someone's comment.
         2) the PARENT COMMENT's AUTHOR — when this reply is a reply to their
            comment ("{name} replied to your comment"). This was missing before,
            so replying to a comment never notified that comment's author.
       Both notifications share the same docId base but land in different
       recipients' subcollections, so there's no collision. Self-notifications
       are skipped, and the parent-author notification is skipped when the parent
       author IS the review owner (they already get the owner notification). */
    const reviewOwnerUid = String(overlay.dataset.reviewOwnerUid || target.activity?.uid || '').trim();
    const parentReply = parentReplyId
      ? replies.find(r => String(r.id || r.replyId || '') === parentReplyId)
      : null;
    const parentAuthorUid = parentReply ? String(parentReply.uid || '').trim() : '';
    if (typeof createActivityNotification === 'function') {
      const baseNotif = {
        type: 'activity_comment',
        targetActivityId: target.cardId || target.id,
        targetKind: target.collection === 'feed' ? 'feed' : 'activity',
        targetCollection: target.collection,
        targetCommentId: replyId,
        parentCommentId: parentReplyId || '',
        activity,
        textSnippet: text
      };
      // 1) review owner — every reply on their review page
      if (reviewOwnerUid && reviewOwnerUid !== currentUser.uid) {
        await createActivityNotification({
          ...baseNotif,
          recipientUid: reviewOwnerUid,
          commentContext: (parentReplyId && parentAuthorUid === reviewOwnerUid) ? 'reply' : 'review'
        });
      }
      // 2) parent comment author — someone replied to their comment
      if (parentAuthorUid
          && parentAuthorUid !== currentUser.uid
          && parentAuthorUid !== reviewOwnerUid) {
        await createActivityNotification({
          ...baseNotif,
          recipientUid: parentAuthorUid,
          commentContext: 'reply'
        });
      }
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
  if (!isOpenMyListMediaReviewReplyEnabled(overlay)) {
    if (typeof showToast === 'function') showToast('Replies are off for this review');
    return;
  }
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
  /* v11.396: resolve the review's feed-post id for the heart/like target. The
     local item often doesn't carry `reviewActivityId`, so fall back to the
     matching media-review feed post (same id the activity card likes), which
     keeps the heart's count in sync with the card. */
  let reviewActivityId = String(record.reviewActivityId || item.reviewActivityId || '').trim();
  if (!reviewActivityId && item.id) {
    try {
      const feedRecForId = synthesizeMediaReviewRecordFromFeed(item.id, record.section);
      if (feedRecForId && feedRecForId.reviewActivityId) reviewActivityId = String(feedRecForId.reviewActivityId).trim();
    } catch (_) { /* non-fatal */ }
  }
  const reviewRepliesPublic = isMyListMediaReviewRepliesEnabled(item, record);
  if (!reviewRepliesPublic) reviewActivityId = '';
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
  overlay.className = 'mylist-media-review-page'
    + (record.section === 'music' ? ' is-music-review' : '')
    + (isOwnerReview ? ' is-owner-review' : ' is-viewed-user-review')
    + (reviewRepliesPublic ? '' : ' is-private-review');
  overlay.dataset.reviewTitle = title;
  overlay.dataset.reviewDate = dateLine;
  overlay.dataset.reviewItemId = item.id || '';
  overlay.dataset.reviewSection = record.section || '';
  overlay.dataset.reviewOwnerUid = ownerUid;
  overlay.dataset.reviewIsOwner = isOwnerReview ? 'true' : 'false';
  overlay.dataset.reviewAuthorName = author.name || '';
  overlay.dataset.reviewPoster = poster || '';
  overlay.dataset.reviewRatingLabel = getMyListReviewRatingShareLabel(item, record.section);
  overlay.dataset.reviewText = reviewText || '';
  overlay.dataset.reviewRepliesPublic = reviewRepliesPublic ? 'true' : 'false';
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
          </div>
          <div class="mylist-media-review-poster${poster ? '' : ' no-img'}" ${poster ? `style="background-image:url('${escAttr(poster)}')"` : ''}>${poster ? '' : escHtml(getSectionIcon(record.section))}</div>
        </section>
        ${record.section === 'music' ? renderMyListReviewTracklistToggle(item) : ''}
        <section class="mylist-media-review-body">
          ${reviewText ? `<p>${escHtml(reviewText)}</p>` : ''}
          <div class="mylist-media-review-divider" aria-hidden="true"></div>
          <div class="mylist-media-review-actions"${reviewActivityId ? ` data-activity-card-id="${escAttr(reviewActivityId)}" data-activity-id="${escAttr(reviewActivityId)}" data-post-id="${escAttr(reviewActivityId)}"` : ''}>
            ${reviewRepliesPublic
              ? `<button class="mylist-media-review-reply" type="button" onclick="openMyListMediaReviewReply(event)">Reply</button>`
              : `<span class="mylist-media-review-private-pill">Private review</span>`}
            ${reviewActivityId ? `<button class="mylist-media-review-like" type="button" data-activity-action="like" aria-label="Like review" onclick="event.stopPropagation(); toggleActivityLike('${escAttr(reviewActivityId)}', this)">
              <span class="mylist-media-review-like-icon" data-like-icon-slot>${getScreenListHeartIconSvg(false)}</span>
              <span class="mylist-media-review-like-count" data-activity-like-count>0</span>
            </button>` : ''}
          </div>
          <section class="mylist-media-review-replies${reviewRepliesPublic ? '' : ' is-closed'}" aria-label="Replies">
            <div data-review-reply-composer-home>
              ${reviewRepliesPublic ? `<form class="mylist-media-review-reply-composer" data-review-reply-composer hidden onsubmit="return submitMyListMediaReviewReply(event)">
                <div class="mylist-media-review-reply-context" data-review-reply-context hidden>
                  <span>Replying to <strong data-review-reply-context-name></strong></span>
                  <button type="button" onclick="closeMyListMediaReviewReplyComposer(event)" aria-label="Cancel specific reply">&times;</button>
                </div>
                <textarea class="mylist-media-review-reply-input" data-review-reply-input rows="1" maxlength="600" placeholder="Write a reply..."></textarea>
                <div class="mylist-media-review-reply-actions">
                  <button class="mylist-media-review-reply-cancel" type="button" onclick="closeMyListMediaReviewReplyComposer(event)">Cancel</button>
                  <button class="mylist-media-review-reply-post" type="submit" data-review-reply-post disabled>Post</button>
                </div>
              </form>` : ''}
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
  if (reviewRepliesPublic) attachMyListMediaReviewReplyComposer(overlay);
  loadMyListMediaReviewReplies();
  /* v11.395: hydrate the review's heart with the SHARED like data (same
     feed/{reviewActivityId}.likes the activity card uses), so the count + filled
     state match the card. Liking here updates the card and vice-versa via
     toggleActivityLike → refreshVisibleActivityInteractionCards. */
  if (reviewActivityId && typeof hydrateActivityInteractionCounts === 'function') {
    try { hydrateActivityInteractionCounts(overlay); } catch (_) {}
  }
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
    finishSharedMediaReviewRouteAfterClose();
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

function normalizeEpisodeRuntimeMinutes(value) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const minutes = normalizeEpisodeRuntimeMinutes(entry);
      if (minutes > 0) return minutes;
    }
    return 0;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  }
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const hourMatch = raw.match(/(\d+(?:\.\d+)?)\s*h/i);
  const minMatch = raw.match(/(\d+(?:\.\d+)?)\s*m/i);
  if (hourMatch || minMatch) {
    return Math.round((Number(hourMatch?.[1] || 0) * 60) + Number(minMatch?.[1] || 0));
  }
  const plain = Number(raw);
  return Number.isFinite(plain) && plain > 0 ? Math.round(plain) : 0;
}

function getEpisodeRuntimeMinutes(ep = {}, item = {}) {
  const candidates = [
    ep.runtimeMinutes,
    ep.runtimeMins,
    ep.runtime,
    ep.runTime,
    ep.run_time,
    ep.durationMinutes,
    ep.durationMins,
    ep.duration,
    ep.length,
    ep.episodeRuntime,
    ep.episode_run_time
  ];
  if (item?.isAnime || item?.mediaCategory === 'anime' || item?.librarySection === 'anime') {
    candidates.push(item.episode_run_time, item.episodeRunTime, item.runtimePerEpisode);
  }
  for (const candidate of candidates) {
    const minutes = normalizeEpisodeRuntimeMinutes(candidate);
    if (minutes > 0) return minutes;
  }
  return 0;
}

function formatEpisodeRuntimeLabel(ep = {}, item = {}) {
  const minutes = getEpisodeRuntimeMinutes(ep, item);
  const runtimeText = minutes > 0 ? `${minutes}m` : 'N/A';
  /* v11.011: append "· {release date}" to the runtime label for
     UNRELEASED episodes only. Uses the existing future-episode-lock
     detection that already powers the watch-lock UI (v10.951), so a
     single source of truth: if the episode is locked (air date in the
     future), surface the date next to runtime. Once the air date
     passes, `isScreenListFutureEpisodeLocked` returns false → the
     suffix is naturally omitted on the next render pass, so the date
     "disappears" the moment the episode is released without any
     explicit clean-up code. Same numeric M/D format as the existing
     "Next episode airing 6/21" hero strip for visual consistency. */
  if (typeof isScreenListFutureEpisodeLocked !== 'function') return runtimeText;
  if (!isScreenListFutureEpisodeLocked(item, ep)) return runtimeText;
  const unlockDate = typeof getScreenListEpisodeUnlockDate === 'function'
    ? getScreenListEpisodeUnlockDate(item, ep)
    : '';
  const dateLabel = unlockDate && typeof formatMyListNextEpisodeDate === 'function'
    ? formatMyListNextEpisodeDate(unlockDate)
    : '';
  if (!dateLabel) return runtimeText;
  return `${runtimeText} · ${dateLabel}`;
}

function updateEpisodeRuntimeElements(item = {}) {
  if (!item || !Array.isArray(item.episodes)) return;
  item.episodes.forEach(ep => {
    const epId = String(ep?.id || '');
    if (!epId) return;
    document.querySelectorAll(`[data-episode-runtime-id="${CSS.escape(epId)}"]`).forEach(node => {
      node.textContent = formatEpisodeRuntimeLabel(ep, item);
    });
  });
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
  const needsEpisodeRuntime = seasonNums.some(num => {
    const seasonEpisodes = episodes.filter(ep => Number(ep.seasonNum || 0) === num);
    return seasonEpisodes.some(ep => getEpisodeRuntimeMinutes(ep, item) <= 0);
  });
  if (!needsPoster && !needsEpisodeRuntime) return;
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
      const seasonNeedsPoster = !getSeasonPosterForEpisodes(item, seasonNum, seasonEpisodes);
      const seasonNeedsRuntime = seasonEpisodes.some(ep => getEpisodeRuntimeMinutes(ep, item) <= 0);
      if (!seasonNeedsPoster && !seasonNeedsRuntime) continue;
      const meta = detailSeasons.find(s => Number(s?.season_number || 0) === seasonNum) || {};
      let poster = normalizeSeasonPosterUrl(meta.poster_path || meta.cover || '');
      let name = meta.name || '';
      let airDate = meta.air_date || '';
      let seasonData = null;
      if (!poster || seasonNeedsRuntime) {
        try {
          const seasonRes = await fetchTmdbProxy(`tv/${encodeURIComponent(tmdbId)}/season/${seasonNum}`);
          seasonData = await seasonRes.json();
          poster = normalizeSeasonPosterUrl(seasonData?.poster_path || '');
          name = seasonData?.name || name;
          airDate = seasonData?.air_date || airDate;
        } catch (error) {}
      }
      if (seasonNeedsRuntime && Array.isArray(seasonData?.episodes)) {
        const runtimeByEpNum = new Map();
        seasonData.episodes.forEach(row => {
          const epNum = Number(row?.episode_number || row?.epNum || 0);
          const runtime = normalizeEpisodeRuntimeMinutes(row?.runtime || row?.runtimeMinutes || row?.duration);
          if (epNum > 0 && runtime > 0) runtimeByEpNum.set(epNum, runtime);
        });
        seasonEpisodes.forEach(ep => {
          if (getEpisodeRuntimeMinutes(ep, item) > 0) return;
          const runtime = runtimeByEpNum.get(Number(ep?.epNum || ep?.episode_number || ep?.number || 0));
          if (runtime > 0) {
            ep.runtime = runtime;
            ep.runtimeMinutes = runtime;
            changed = true;
          }
        });
      }
      if (poster && seasonNeedsPoster) {
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
    }
    if (changed) {
      updateEpisodeRuntimeElements(item);
      save();
    }
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

function getScreenListEpisodeSeasonNum(ep = {}) {
  return Number(ep?.seasonNum || ep?.season_number || ep?.seasonNumber || 1) || 1;
}

function getScreenListEpisodeDateValue(ep = {}) {
  const candidates = [
    ep?.airDate,
    ep?.air_date,
    ep?.releaseDate,
    ep?.release_date,
    ep?.firstAirDate,
    ep?.first_air_date,
    ep?.aired,
    ep?.date
  ];
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value && parseScreenListDateOnly(value)) return value;
  }
  return '';
}

function getScreenListSeasonReleaseDate(item = {}, seasonNum = '') {
  const num = String(seasonNum || '').trim();
  const info = getSeasonInfoForEpisodes(item, num) || {};
  const nextSeasonNumber = Number(getMyListNextSeasonNumber(item) || 0);
  const candidates = [
    info.airDate,
    info.air_date,
    info.releaseDate,
    info.release_date,
    info.firstAirDate,
    info.first_air_date,
    info.aired,
    nextSeasonNumber && String(nextSeasonNumber) === num ? getMyListNextSeasonAirDate(item) : '',
    Number(num) === 1 ? (item?.first_air_date || item?.firstAirDate || item?.releaseDate || item?.release_date || item?.airDate) : ''
  ];
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value && parseScreenListDateOnly(value)) return value;
  }
  return '';
}

function getScreenListEpisodeUnlockDate(item = {}, ep = {}) {
  const episodeDate = getScreenListEpisodeDateValue(ep);
  if (episodeDate) return episodeDate;
  return getScreenListSeasonReleaseDate(item, getScreenListEpisodeSeasonNum(ep));
}

function isScreenListFutureEpisodeLocked(item = {}, ep = {}) {
  const unlockDate = getScreenListEpisodeUnlockDate(item, ep);
  const parsed = parseScreenListDateOnly(unlockDate);
  return !!(parsed && parsed.getTime() > getScreenListTodayStart());
}

function getScreenListReleasedEpisodesForMarking(item = {}, episodes = []) {
  return (Array.isArray(episodes) ? episodes : []).filter(ep => ep && !isScreenListFutureEpisodeLocked(item, ep));
}

function showScreenListFutureEpisodeToast(item = {}, episodes = []) {
  const dates = (Array.isArray(episodes) ? episodes : [])
    .map(ep => getScreenListEpisodeUnlockDate(item, ep))
    .filter(Boolean)
    .map(parseScreenListDateOnly)
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());
  const label = dates[0]
    ? (typeof formatMyListNextEpisodeDate === 'function'
      ? formatMyListNextEpisodeDate(dates[0].toISOString().slice(0, 10))
      : dates[0].toLocaleDateString())
    : '';
  const message = label
    ? `Episodes unlock on ${label}.`
    : 'Episodes unlock when the season releases.';
  if (typeof showToast === 'function') showToast(message, { durationMs: 2300 });
}

function buildScreenListEpisodeWatchDisabledAttrs(item = {}, ep = {}) {
  if (ep?.watched || !isScreenListFutureEpisodeLocked(item, ep)) return '';
  const unlockDate = getScreenListEpisodeUnlockDate(item, ep);
  const label = unlockDate && typeof formatMyListNextEpisodeDate === 'function'
    ? formatMyListNextEpisodeDate(unlockDate)
    : unlockDate;
  const title = label ? `Available ${label}` : 'Available when released';
  return ` disabled aria-disabled="true" title="${escAttr(title)}"`;
}

function canMarkAnyScreenListEpisodeWatched(item = {}, episodes = []) {
  return getScreenListReleasedEpisodesForMarking(item, episodes).some(ep => ep && !ep.watched);
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
  const renderableEpisodes = getRenderableEpisodes(item);
  const canMarkReleased = canMarkAnyScreenListEpisodeWatched(item, renderableEpisodes);
  const markAllDisabledAttrs = canMarkReleased ? '' : ' disabled aria-disabled="true" title="Episodes unlock when they release"';
  const actionsHtml = !viewingUser
    ? `<div class="ep-actions">
        <div style="display:flex;gap:8px;">
          <button type="button" class="btn-secondary btn-sm" data-mylist-action="mark-all-eps" data-mylist-item-id="${escapedId}" data-mylist-mark-value="true" onclick="markAllEps('${escapedId}',true)"${markAllDisabledAttrs}>Mark All Watched</button>
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
    return eps.map(ep => renderSingleEp(item.id, ep, activeSection, { item })).join("");
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
    const canMarkSeasonReleased = canMarkAnyScreenListEpisodeWatched(item, sEps);
    const markSeasonDisabledAttrs = (sWatched < sEps.length && !canMarkSeasonReleased)
      ? ' disabled aria-disabled="true" title="Episodes unlock when this season releases"'
      : '';
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
        ${!viewingUser ? `<div class="season-header-right"><span class="season-card-kicker">Episodes</span><button type="button" class="edit-ep-link season-mark-btn" data-mylist-action="mark-season-eps" data-mylist-item-id="${item.id}" data-mylist-season-num="${sNum}" data-mylist-mark-value="${sWatched < sEps.length}" onclick="event.stopPropagation();markSeasonEps('${item.id}',${sNum},${sWatched < sEps.length})"${markSeasonDisabledAttrs}>
          ${sWatched < sEps.length ? 'Mark all' : 'Clear all'}
        </button></div>` : ''}
      </div>
      <div class="season-body" id="s-eps-${item.id}-${sNum}" style="display:none">
        <div class="season-rating-bar">
          <span class="season-rating-label">Season Rating</span>
          ${renderStars((item.seasonRatings && item.seasonRatings[sNum]) || 0, item.id, 'season:' + sNum, 14)}
        </div>
        <div class="season-eps">
          ${sEps.map(ep => renderSingleEp(item.id, ep, activeSection, { item })).join("")}
        </div>
      </div>
    </div>`;
  }).join("");
}

function renderSingleEp(itemId, ep, section = activeSection, options = {}) {
  if (!ep.id) ep.id = itemId + '-ep-' + (ep.seasonNum ? ep.seasonNum + '-' : '') + (ep.epNum || ep.number || Math.random().toString(36).slice(2, 7));
  const r = ep.rating || 0;
  const sourceItem = options.item || getMyListEpisodeInteractionContext(itemId, section)?.item || {};
  const futureLocked = !ep.watched && isScreenListFutureEpisodeLocked(sourceItem, ep);
  const futureLockedClass = futureLocked ? ' future-locked-ep' : '';
  const disabledAttrs = buildScreenListEpisodeWatchDisabledAttrs(sourceItem, ep);
  const showRuntime = options.showRuntime === true;
  const runtimeHtml = showRuntime
    ? `<span class="ep-runtime" data-episode-runtime-id="${escAttr(ep.id)}">${escHtml(formatEpisodeRuntimeLabel(ep, options.item || {}))}</span>`
    : '';
  const titleHtml = `${ep.epNum || ep.number}${ep.title ? '. ' + escHtml(ep.title) : ''}`;
  const titleBlockHtml = showRuntime
    ? `<span class="ep-title-stack"><span class="ep-name">${titleHtml}</span>${runtimeHtml}</span>`
    : `<span class="ep-name">${titleHtml}</span>`;
  /* v11.733: episode rows get a 16:9 still preview on the right (IMDb-style)
     in place of the per-episode "+" review button; the ★ rating button stays.
     v11.739: extended from TV ('shows') to anime — both lazy-load the still
     from TMDB on season expand, with the show poster as the fallback. */
  const isStillEpisodeRow = section === 'shows' || section === 'anime';
  const epStillHtml = isStillEpisodeRow ? buildMyListEpisodeStillHtml(itemId, ep, sourceItem) : '';
  /* v11.734: TV episode cards stack the left column — line 1 is
     "Title · Runtime/date" (inline, dot separator), line 2 is the ★ rating
     button (moved down off the right). The 16:9 still stays on the right. */
  const runtimeLabel = showRuntime ? String(formatEpisodeRuntimeLabel(ep, options.item || {}) || '').trim() : '';
  const tvNameLineHtml = `<span class="ep-name-line"><span class="ep-name">${titleHtml}</span>${runtimeLabel ? `<span class="ep-meta-sep" aria-hidden="true">·</span><span class="ep-runtime" data-episode-runtime-id="${escAttr(ep.id)}">${escHtml(runtimeLabel)}</span>` : ''}</span>`;
  /* v10.999: per-episode review button (the "+" to the LEFT of the
     star rating). Owner sees a "+" plus-icon when no review exists,
     swaps to the chat-bubble-with-lines glyph (same icon as the
     title-card `.card-review-layers-btn`) once `ep.review.text` is
     saved. Friend-view (viewingUser) sees the chat-bubble glyph ONLY
     when a review exists — read-only, tap opens the modal in
     read-only mode. Reviews are persisted to the episode object via
     persistMyListEpisodeEdit and are NOT mirrored to the activity
     feed (per spec — episode reviews stay private to the shelf). */
  const epReviewText = String(ep?.review?.text || '').trim();
  const epReviewIconPlus = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  const epReviewIconBubble = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.25 5.25h11.5A2.25 2.25 0 0 1 20 7.5v6A2.25 2.25 0 0 1 17.75 15.75H10.9L7.25 18.75v-3H6.25A2.25 2.25 0 0 1 4 13.5v-6a2.25 2.25 0 0 1 2.25-2.25Z"/><path d="M8 9.25h8"/><path d="M8 12.25h5.5"/></svg>';
  if (viewingUser) {
    const reviewIndicatorHtml = epReviewText
      ? `<button type="button" class="ep-review-btn has-comment is-readonly" onclick="event.stopPropagation();openEpReviewModal('${itemId}','${ep.id}',true)" aria-label="View this episode's review" title="View review">${epReviewIconBubble}</button>`
      : '';
    if (isStillEpisodeRow) {
      return `<div class="ep-row ep-row-tv ${ep.watched ? 'watched-ep' : ''}">
        <div class="ep-left">
          <span class="ep-check ${ep.watched ? 'checked' : ''}" style="cursor:default;">${ep.watched ? '✓' : ''}</span>
          ${tvNameLineHtml}
        </div>
        <span class="ep-rating-anchor"><span class="ep-rating-btn ${r ? 'has-rating' : ''}" style="cursor:default;">★${r ? ' ' + formatRatingValueForSection(r, section) : ''}</span></span>
        ${epStillHtml}
      </div>`;
    }
    return `<div class="ep-row ${ep.watched ? 'watched-ep' : ''}">
      <div class="ep-left">
        <span class="ep-check ${ep.watched ? 'checked' : ''}" style="cursor:default;">
          ${ep.watched ? '✓' : ''}
        </span>
        ${titleBlockHtml}
      </div>
      ${reviewIndicatorHtml}
      <span class="ep-rating-btn ${r ? 'has-rating' : ''}" style="cursor:default;">
        ★${r ? ' ' + formatRatingValueForSection(r, section) : ''}
      </span>
      ${epStillHtml}
    </div>`;
  }
  /* v11.013: unreleased episodes get the rating star AND the "+" review
     button BOTH disabled — same future-lock that already disables the
     watch toggle (see `disabledAttrs` above). Both buttons re-enable
     automatically once the air date passes (`futureLockedClass` is
     recomputed on every render via `isScreenListFutureEpisodeLocked`). */
  const isFutureLocked = !!futureLockedClass;
  const reviewDisabledAttrs = isFutureLocked ? ' disabled aria-disabled="true" title="Available once this episode airs"' : '';
  const ratingDisabledAttrs = isFutureLocked ? ' disabled aria-disabled="true" title="Available once this episode airs"' : '';
  const reviewOnclick = isFutureLocked ? 'event.stopPropagation()' : `event.stopPropagation();openEpReviewModal('${itemId}','${ep.id}')`;
  const ratingOnclick = isFutureLocked ? 'event.stopPropagation()' : `event.stopPropagation();openEpRating('${itemId}','${ep.id}')`;
  const ownerReviewBtnHtml = `<button type="button" class="ep-review-btn ${epReviewText ? 'has-comment' : ''}${isFutureLocked ? ' is-future-locked' : ''}" onclick="${reviewOnclick}" aria-label="${isFutureLocked ? 'Available once this episode airs' : (epReviewText ? 'Edit this episode review' : 'Write a review about this episode')}"${reviewDisabledAttrs}>${epReviewText ? epReviewIconBubble : epReviewIconPlus}</button>`;
  /* v11.000: data-item-id + data-ep-id are read by the delegated
     long-press handler (`bindEpisodeLongPressReviewHandler`) so a
     ~500ms hold anywhere on the row (outside the buttons) triggers
     haptic + opens the episode review modal. v11.013: the handler
     also reads `.future-locked-ep` on the row and bails if locked. */
  if (isStillEpisodeRow) {
    return `<div class="ep-row ep-row-tv ${ep.watched ? 'watched-ep' : ''}${futureLockedClass}" id="ep-row-${ep.id}" data-item-id="${itemId}" data-ep-id="${ep.id}">
      <div class="ep-left">
        <button type="button" class="ep-check ${ep.watched ? 'checked' : ''}" data-mylist-action="toggle-ep" data-mylist-item-id="${itemId}" data-mylist-episode-id="${ep.id}" onclick="toggleEp('${itemId}','${ep.id}')"${disabledAttrs}>${ep.watched ? '✓' : ''}</button>
        ${tvNameLineHtml}
      </div>
      <span class="ep-rating-anchor"><button type="button" class="ep-rating-btn ${r ? 'has-rating' : ''}${isFutureLocked ? ' is-future-locked' : ''}" onclick="${ratingOnclick}"${ratingDisabledAttrs}>★${r ? ' ' + formatRatingValueForSection(r, section) : ''}</button></span>
      ${epStillHtml}
    </div>`;
  }
  return `<div class="ep-row ${ep.watched ? 'watched-ep' : ''}${futureLockedClass}" id="ep-row-${ep.id}" data-item-id="${itemId}" data-ep-id="${ep.id}">
    <div class="ep-left">
      <button type="button" class="ep-check ${ep.watched ? 'checked' : ''}" data-mylist-action="toggle-ep" data-mylist-item-id="${itemId}" data-mylist-episode-id="${ep.id}" onclick="toggleEp('${itemId}','${ep.id}')"${disabledAttrs}>
        ${ep.watched ? '✓' : ''}
      </button>
      ${titleBlockHtml}
    </div>
    ${ownerReviewBtnHtml}
    <button type="button" class="ep-rating-btn ${r ? 'has-rating' : ''}${isFutureLocked ? ' is-future-locked' : ''}" onclick="${ratingOnclick}"${ratingDisabledAttrs}>
      ★${r ? ' ' + formatRatingValueForSection(r, section) : ''}
    </button>
    ${epStillHtml}
  </div>`;
}

/* ============================================================================
   v11.733 — TV episode 16:9 still previews (IMDb-style)
   ----------------------------------------------------------------------------
   Each TV ('shows') episode row renders a 16:9 still box on the right, built by
   buildMyListEpisodeStillHtml() inside renderSingleEp. Stills are lazy-fetched
   from TMDB (tv/{tmdbId}/season/{n} -> episode.still_path) the first time a
   season is expanded (hooked in toggleSeason), cached per season, then patched
   onto the pending .ep-still boxes by episode number. The show poster is the
   dimmed fallback until/unless a real still lands. TV ONLY for now — anime and
   every other section are untouched (gated on section === 'shows').
   Reuses fetchTmdbProxy + resolveMyListTmdbTvId, already defined in this file.
   ============================================================================ */
const myListEpisodeStillSeasonCache = new Map(); // `${tmdbId}:${seasonNum}` -> { [epNum]: stillUrl }  (TMDB)
/* v11.741: OMDb (IMDb) per-season poster cache — anime backup when TMDB has no
   still (or no tmdb match). Keyed by item so anime without a tmdbId still cache. */
const myListEpisodeStillOmdbCache = new Map();    // `${itemId}:${seasonNum}` -> { [epNum]: posterUrl }
/* v11.741: merged resolved stills (TMDB then OMDb) keyed by item+season so a
   re-render renders the real still directly (survives rating/watched re-renders)
   even for OMDb-sourced anime photos that aren't in the tmdb cache. */
const myListEpisodeStillResolvedCache = new Map(); // `${itemId}:${seasonNum}` -> { [epNum]: url }

function buildMyListTmdbStillUrl(path) {
  const p = String(path || '').trim();
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p;
  return `https://image.tmdb.org/t/p/w300${p}`;
}

function getMyListEpisodeStillFallbackUrl(item) {
  const raw = String(item?.cover || item?.poster || item?.image || item?.posterUrl || '').trim();
  if (!raw) return '';
  const m = raw.match(/^https?:\/\/image\.tmdb\.org\/t\/p\/(?:w\d+|original)(\/.+)$/i);
  if (m && m[1]) return `https://image.tmdb.org/t/p/w300${m[1]}`;
  if (raw.startsWith('/')) return `https://image.tmdb.org/t/p/w300${raw}`;
  return raw;
}

function buildMyListEpisodeStillHtml(itemId, ep, item) {
  const seasonNum = Number(ep?.seasonNum || 1) || 1;
  const epNum = Number(ep?.epNum || ep?.number || 0) || 0;
  /* v11.736/741: if this episode's still is already resolved (from a prior
     TMDB or OMDb fetch), render it IMMEDIATELY and non-pending so a re-render
     — rating, watched toggle, anime season-assembly — doesn't reset the photo
     back to the poster fallback. Keyed by item+season so it covers OMDb anime
     stills too (no tmdbId required). */
  if (epNum) {
    const resolved = myListEpisodeStillResolvedCache.get(`${itemId}:${seasonNum}`);
    const resolvedUrl = resolved && resolved[epNum];
    if (resolvedUrl) {
      return `<div class="ep-still" data-ep-still="1" data-ep-still-item="${escAttr(itemId)}" data-ep-still-season="${escAttr(seasonNum)}" data-ep-still-num="${escAttr(epNum)}" style="background-image:url('${escAttr(resolvedUrl)}')" aria-hidden="true"></div>`;
    }
  }
  const fallback = getMyListEpisodeStillFallbackUrl(item);
  const fallbackStyle = fallback ? ` style="background-image:url('${escAttr(fallback)}')"` : '';
  const fallbackClass = fallback ? ' ep-still-fallback' : '';
  return `<div class="ep-still${fallbackClass}" data-ep-still="1" data-ep-still-pending="1" data-ep-still-item="${escAttr(itemId)}" data-ep-still-season="${escAttr(seasonNum)}" data-ep-still-num="${escAttr(epNum)}"${fallbackStyle} aria-hidden="true"></div>`;
}

async function ensureMyListSeasonStillMap(tmdbId, seasonNum) {
  const key = `${tmdbId}:${seasonNum}`;
  if (myListEpisodeStillSeasonCache.has(key)) return myListEpisodeStillSeasonCache.get(key);
  const map = {};
  try {
    const res = await fetchTmdbProxy(`tv/${encodeURIComponent(tmdbId)}/season/${encodeURIComponent(seasonNum)}`);
    if (res && res.ok) {
      const data = await res.json();
      const eps = Array.isArray(data?.episodes) ? data.episodes : [];
      eps.forEach(ep => {
        const n = Number(ep?.episode_number || 0) || 0;
        const url = buildMyListTmdbStillUrl(ep?.still_path);
        if (n && url) map[n] = url;
      });
    }
  } catch (e) { /* non-fatal — rows keep the poster fallback */ }
  myListEpisodeStillSeasonCache.set(key, map);
  return map;
}

/* v11.741: OMDb (IMDb) per-season still backup for anime. The worker resolves
   the IMDb id from the anime title server-side (/api/omdb/anime-episodes) — more
   reliable for anime than the client's TMDB search/tv — and returns each
   episode's IMDb poster keyed by its per-season episode number. Used only when
   TMDB has no still for an episode (e.g. assembled multi-season anime whose
   Jikan season order doesn't line up with TMDB, or no TMDB match at all). */
async function ensureMyListSeasonStillMapOmdb(item, seasonNum) {
  const itemId = String(item?.id || '');
  const key = `${itemId}:${seasonNum}`;
  if (myListEpisodeStillOmdbCache.has(key)) return myListEpisodeStillOmdbCache.get(key);
  const map = {};
  try {
    const params = new URLSearchParams();
    const imdbId = String(item?.imdbId || item?.imdb_id || '').trim();
    const title = String(item?.title || item?.name || '').trim();
    if (imdbId) params.set('imdbId', imdbId);
    else if (title) params.set('title', title);
    const year = (String(item?.year || '').match(/^(19|20)\d{2}/) || [])[0] || '';
    if (year) params.set('year', year);
    params.set('season', String(seasonNum));
    if (params.has('imdbId') || params.has('title')) {
      const res = await fetch(`/api/omdb/anime-episodes?${params.toString()}`, { cache: 'no-store' });
      if (res && res.ok) {
        const data = await res.json();
        const eps = Array.isArray(data?.episodes) ? data.episodes : [];
        eps.forEach(ep => {
          const n = Number(ep?.episode || 0) || 0;
          const url = String(ep?.poster || '').trim();
          if (n && /^https?:\/\//i.test(url)) map[n] = url;
        });
      }
    }
  } catch (e) { /* non-fatal — rows keep the poster fallback */ }
  myListEpisodeStillOmdbCache.set(key, map);
  return map;
}

async function hydrateMyListEpisodeStills(itemId, sectionHint = '') {
  try {
    const ctx = getMyListEpisodeInteractionContext(itemId, sectionHint);
    const item = ctx && ctx.item;
    const section = (ctx && ctx.section) || sectionHint || activeSection;
    if (!item || (section !== 'shows' && section !== 'anime')) return; // TV + anime
    const pendingFor = () => Array.from(document.querySelectorAll('.ep-still[data-ep-still-pending="1"]'))
      .filter(el => String(el.dataset.epStillItem || '') === String(itemId));
    if (!pendingFor().length) return;
    const isAnime = section === 'anime';
    const tmdbId = await resolveMyListTmdbTvId(item); // '' if no TMDB match (anime falls back to OMDb)
    const seasons = [...new Set(pendingFor().map(el => String(el.dataset.epStillSeason || '1')))];
    for (const s of seasons) {
      const tmdbMap = tmdbId ? await ensureMyListSeasonStillMap(tmdbId, s) : {};
      const seasonPending = pendingFor().filter(el => String(el.dataset.epStillSeason || '') === String(s));
      /* OMDb (IMDb) backup for anime whenever TMDB didn't cover a pending ep. */
      const needsBackup = isAnime && seasonPending.some(el => !tmdbMap[Number(el.dataset.epStillNum)]);
      const omdbMap = needsBackup ? await ensureMyListSeasonStillMapOmdb(item, s) : {};
      const merged = { ...omdbMap, ...tmdbMap }; // TMDB wins; OMDb fills the gaps
      /* persist the merged season map so re-renders render the real still directly */
      const resolvedKey = `${itemId}:${s}`;
      myListEpisodeStillResolvedCache.set(resolvedKey, { ...(myListEpisodeStillResolvedCache.get(resolvedKey) || {}), ...merged });
      seasonPending.forEach(el => {
        const url = merged[Number(el.dataset.epStillNum)];
        if (url) {
          el.style.backgroundImage = `url("${url}")`;
          el.classList.remove('ep-still-fallback');
        }
        el.removeAttribute('data-ep-still-pending');
      });
    }
  } catch (e) { /* non-fatal */ }
}

const MYLIST_EPISODE_PAGE_OPEN_TRANSITION_MS = 450;
const MYLIST_EPISODE_PAGE_CLOSE_TRANSITION_MS = MYLIST_EPISODE_PAGE_OPEN_TRANSITION_MS + 200;
let myListEpisodePageState = null;
let myListEpisodePageScrollY = 0;
let myListEpisodePageExpandedSeasonRating = '';

function getMyListEpisodePageSourceData() {
  return viewingUser && friendViewData ? friendViewData : data;
}

function getMyListEpisodePageSourceItems(section = activeSection) {
  const source = getMyListEpisodePageSourceData();
  return Array.isArray(source?.[section]) ? source[section] : [];
}

function getMyListEpisodePageItem(sectionHint = '') {
  const state = myListEpisodePageState || {};
  const section = sectionHint || state.section || activeSection;
  const itemId = state.itemId || '';
  if (!section || !itemId) return null;
  const items = getMyListEpisodePageSourceItems(section);
  return items.find(entry => entry && String(entry.id || '') === String(itemId)) || null;
}

function getMyListEpisodeInteractionContext(itemId = '', sectionHint = '') {
  const key = String(itemId || '').trim();
  if (!key) return { item: null, index: -1, section: '', items: null, isEpisodePage: false };
  const pageSection = String(myListEpisodePageState?.section || '').trim();
  if (isMyListEpisodePageOpen(key) && pageSection) {
    const items = getMyListEpisodePageSourceItems(pageSection);
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
  const renderableEpisodes = getRenderableEpisodes(item);
  const canMarkReleased = canMarkAnyScreenListEpisodeWatched(item, renderableEpisodes);
  const markAllDisabledAttrs = canMarkReleased ? '' : ' disabled aria-disabled="true" title="Episodes unlock when they release"';
  return `
    <div class="mylist-episode-page-actions">
      <div class="mylist-episode-page-actions-main">
        <button type="button" class="btn-secondary btn-sm" data-mylist-action="mark-all-eps" data-mylist-item-id="${escapedId}" data-mylist-mark-value="true" onclick="markAllEps('${escapedId}',true)"${markAllDisabledAttrs}>Mark All Watched</button>
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

/* v11.026: the season rating popout now reuses the top overall-rating
   widget (`.ep-rating-popup-stars` + `myListOverallRatingTouch*`), so
   the bespoke `.mylist-episode-page-season-rating-star-*` scrub
   handlers + preview/cache/item helpers that lived here have been
   removed — the shared overall handlers commit to the `season:N` rate()
   key via `data-rating-target`. */

function handleMyListEpisodePageSeasonRatingOutsideClick(event) {
  if (!isMyListEpisodePageOpen() || !myListEpisodePageExpandedSeasonRating) return;
  if (event?.target?.closest?.('.mylist-episode-page-season-rating-control')) return;
  collapseMyListEpisodePageSeasonRatings();
}

if (typeof window !== 'undefined' && !window.__shelfdEpisodePageSeasonRatingClickBound) {
  window.__shelfdEpisodePageSeasonRatingClickBound = true;
  document.addEventListener('click', handleMyListEpisodePageSeasonRatingOutsideClick, true);
}

function renderEpisodePageSeasonRatingControl(item = {}, seasonNum = '', rating = 0, section = activeSection, released = true) {
  const itemId = String(item.id || '');
  const sNum = String(seasonNum || '');
  const value = Number(rating || 0);
  const label = formatRatingValueForSection(value, section, false, '0');
  const key = `${itemId}:${sNum}`;
  const readonly = viewingUser || !currentUser;
  if (readonly) {
    return `<span class="mylist-episode-page-season-rating-chip is-readonly" aria-label="Season ${escAttr(sNum)} rating ${escAttr(label)}"><span aria-hidden="true">&#9733;</span><span>${escHtml(label)}</span></span>`;
  }
  /* v11.025: unreleased season → locked, non-interactive chip. No touch
     handlers, no rating hit-targets, no expand toggle — the user
     physically cannot place a rating until at least one episode airs. */
  if (!released) {
    return `<span class="mylist-episode-page-season-rating-chip is-future-locked" aria-disabled="true" title="Available once this season releases" aria-label="Season ${escAttr(sNum)} rating locked until release"><span aria-hidden="true">&#9733;</span><span class="mylist-episode-page-season-rating-chip-value">${escHtml(label)}</span></span>`;
  }
  /* v11.026: render the SAME star widget the top-of-page overall rating
     uses (`.ep-rating-popup-stars` slot family — champagne gold #E6C766,
     slot-based half-step fills, smooth `myListOverallRatingTouch*`
     scrub). The only differences from the hero widget: it lives inside
     the chip's pop-out bubble (positioned by
     `.mylist-episode-page-season-rating-stars`), and it commits to the
     `season:N` rate() key — wired via `data-rating-target` for the scrub
     and per-star onclick → `rateMyListEpisodePageSeasonRating`. */
  const expanded = myListEpisodePageExpandedSeasonRating === key;
  const stepCount = typeof getRatingStepCountForSection === 'function'
    ? getRatingStepCountForSection(section)
    : 10;
  let starsInner = '';
  if (stepCount === 5) {
    for (let star = 1; star <= 5; star++) {
      const leftVal = star * 2 - 1;
      const rightVal = star * 2;
      let pct = 0;
      if (value >= rightVal) pct = 100;
      else if (value >= leftVal) pct = 50;
      const leftLabel = (leftVal / 2).toFixed(1).replace(/\.0$/, '');
      const rightLabel = (rightVal / 2).toFixed(1).replace(/\.0$/, '');
      starsInner += `<span class="ep-rating-star-slot" data-ep-rating-slot="${star}" style="--ep-star-fill:${pct}%">`
        + `<span class="ep-rating-star-base" aria-hidden="true">★</span>`
        + `<span class="ep-rating-star-fill" aria-hidden="true">★</span>`
        + `<button type="button" class="ep-rating-star-hit ep-rating-star-hit-left" data-ep-rating-star="${leftVal}" aria-label="Rate season ${escAttr(sNum)} ${leftLabel} of 5" onclick="event.stopPropagation();rateMyListEpisodePageSeasonRating('${escAttr(itemId)}','${escAttr(sNum)}',${leftVal},event)"></button>`
        + `<button type="button" class="ep-rating-star-hit ep-rating-star-hit-right" data-ep-rating-star="${rightVal}" aria-label="Rate season ${escAttr(sNum)} ${rightLabel} of 5" onclick="event.stopPropagation();rateMyListEpisodePageSeasonRating('${escAttr(itemId)}','${escAttr(sNum)}',${rightVal},event)"></button>`
        + `</span>`;
    }
  } else {
    for (let star = 1; star <= 10; star++) {
      const pct = value >= star ? 100 : 0;
      starsInner += `<span class="ep-rating-star-slot ep-rating-star-slot-ten" data-ep-rating-slot="${star}" style="--ep-star-fill:${pct}%">`
        + `<span class="ep-rating-star-base" aria-hidden="true">★</span>`
        + `<span class="ep-rating-star-fill" aria-hidden="true">★</span>`
        + `<button type="button" class="ep-rating-star-hit ep-rating-star-hit-full" data-ep-rating-star="${star}" aria-label="Rate season ${escAttr(sNum)} ${star} of 10" onclick="event.stopPropagation();rateMyListEpisodePageSeasonRating('${escAttr(itemId)}','${escAttr(sNum)}',${star},event)"></button>`
        + `</span>`;
    }
  }
  const ariaValueNow = stepCount === 5 ? value / 2 : value;
  return `
    <div class="mylist-episode-page-season-rating-control${expanded ? ' is-expanded' : ''}" data-rating-key="${escAttr(key)}" data-item-id="${escAttr(itemId)}" data-season-num="${escAttr(sNum)}" data-section="${escAttr(section)}">
      <div class="mylist-episode-page-season-rating-stars ep-rating-popup-stars" role="slider" data-item-id="${escAttr(itemId)}" data-section="${escAttr(section)}" data-step-count="${stepCount}" data-rating-target="season:${escAttr(sNum)}" aria-hidden="${expanded ? 'false' : 'true'}" aria-valuemin="0" aria-valuemax="${stepCount === 5 ? 5 : 10}" aria-valuenow="${ariaValueNow}" ontouchstart="myListOverallRatingTouchStart(event)" ontouchmove="myListOverallRatingTouchMove(event)" ontouchend="myListOverallRatingTouchEnd(event)" ontouchcancel="myListOverallRatingTouchEnd(event)">
        ${starsInner}
      </div>
      <button type="button" class="mylist-episode-page-season-rating-chip" aria-label="Season ${escAttr(sNum)} rating ${escAttr(label)}" aria-expanded="${expanded ? 'true' : 'false'}" onclick="toggleMyListEpisodePageSeasonRating('${escAttr(itemId)}','${escAttr(sNum)}',event)">
        <span aria-hidden="true">&#9733;</span>
        <span class="mylist-episode-page-season-rating-chip-value">${escHtml(label)}</span>
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
    /* v11.025: a season counts as "released" the moment ANY of its
       episodes has aired. If every episode is still future-locked
       (e.g. HOTD S3 airing 6/21), the season hasn't released and its
       rating control must be locked — you can't rate what you can't
       watch yet. */
    const seasonHasReleasedEpisode = sEps.some(ep => ep && !isScreenListFutureEpisodeLocked(item, ep));
    const canMarkSeasonReleased = canMarkAnyScreenListEpisodeWatched(item, sEps);
    const markSeasonDisabledAttrs = (sWatched < sEps.length && !canMarkSeasonReleased)
      ? ' disabled aria-disabled="true" title="Episodes unlock when this season releases"'
      : '';
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
            ${!viewingUser ? `<button type="button" class="edit-ep-link season-mark-btn" data-mylist-action="mark-season-eps" data-mylist-item-id="${escAttr(item.id)}" data-mylist-season-num="${escAttr(sNum)}" data-mylist-mark-value="${sWatched < sEps.length}" onclick="event.stopPropagation();markSeasonEps('${escAttr(item.id)}',${escAttr(sNum)},${sWatched < sEps.length})"${markSeasonDisabledAttrs}>${sWatched < sEps.length ? 'Mark all' : 'Clear all'}</button>` : ''}
            <span class="season-arrow" id="s-arrow-${escAttr(item.id)}-${escAttr(sNum)}">▼</span>
            </div>
            <div class="mylist-episode-page-season-rating-slot" onclick="event.stopPropagation()">
              ${renderEpisodePageSeasonRatingControl(item, sNum, seasonRating, section, seasonHasReleasedEpisode)}
            </div>
          </div>
        </div>
        <div class="season-body mylist-episode-page-season-body" id="s-eps-${escAttr(item.id)}-${escAttr(sNum)}" style="display:none;height:0px;" aria-hidden="true">
          <div class="season-eps mylist-episode-page-season-eps">
            ${sEps.map(ep => renderSingleEp(item.id, ep, section, { showRuntime: true, item })).join('')}
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
      <button type="button" class="mylist-episode-page-summary-poster${poster ? '' : ' no-img'}" ${poster ? `style="background-image:url('${escAttr(poster)}')"` : ''} ${poster ? `data-poster="${escAttr(poster)}"` : ''} onclick="openMyListEpisodePageMediaProfile(event,'${escAttr(item.id)}','${escAttr(section)}')" aria-label="Open ${escAttr(displayTitle)} media profile"></button>
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
          ${renderMyListEpisodePageOverallRatingStars(item, section)}
        </div>
      </div>
    </section>
  `;
}

/* v11.013: overall show rating widget on the full-page show-details
   hero. Replaces the legacy `.star-btn lit` markup (amber, inline
   color writes, glitchy scrub) with the SLOT-BASED champagne-gold
   pattern used by the full-page review composer + episode rating
   popup. Bigger stars (22px) and label (16px) per spec.
   Markup reuses the v10.997 `.ep-rating-star-slot/-base/-fill/-hit`
   class family so all the CSS (clip-path fills, hit-zone buttons,
   smooth transitions) carries over. The wrapper class
   `.mylist-overall-rating-stars` only overrides --ep-star-size and
   the label font-size. */
function renderMyListEpisodePageOverallRatingStars(item = {}, section = activeSection) {
  const itemId = String(item?.id || '');
  const currentRating = Number(item?.rating || 0);
  const stepCount = typeof getRatingStepCountForSection === 'function'
    ? getRatingStepCountForSection(section)
    : 10;
  const labelText = currentRating > 0 && typeof formatRatingValueForSection === 'function'
    ? formatRatingValueForSection(currentRating, section)
    : '';
  const readonly = !!viewingUser;
  const role = readonly ? '' : 'role="slider"';
  const touchAttrs = readonly ? '' :
    'ontouchstart="myListOverallRatingTouchStart(event)" ontouchmove="myListOverallRatingTouchMove(event)" ontouchend="myListOverallRatingTouchEnd(event)" ontouchcancel="myListOverallRatingTouchEnd(event)"';
  let html = `<div class="ep-rating-popup-stars mylist-overall-rating-stars" ${role} data-item-id="${escAttr(itemId)}" data-section="${escAttr(section)}" data-step-count="${stepCount}" aria-valuemin="0" aria-valuemax="${stepCount === 5 ? 5 : 10}" aria-valuenow="${stepCount === 5 ? currentRating / 2 : currentRating}" ${touchAttrs}>`;
  if (stepCount === 5) {
    for (let star = 1; star <= 5; star++) {
      const leftVal = star * 2 - 1;
      const rightVal = star * 2;
      let pct = 0;
      if (currentRating >= rightVal) pct = 100;
      else if (currentRating >= leftVal) pct = 50;
      html += `<span class="ep-rating-star-slot" data-ep-rating-slot="${star}" style="--ep-star-fill:${pct}%">`
        + `<span class="ep-rating-star-base" aria-hidden="true">★</span>`
        + `<span class="ep-rating-star-fill" aria-hidden="true">★</span>`;
      if (!readonly) {
        html += `<button type="button" class="ep-rating-star-hit ep-rating-star-hit-left"  data-ep-rating-star="${leftVal}"  aria-label="Rate ${(leftVal/2).toFixed(1).replace(/\.0$/,'')} of 5" onclick="event.stopPropagation();rate('${escAttr(itemId)}','overall',${leftVal})"></button>`
            + `<button type="button" class="ep-rating-star-hit ep-rating-star-hit-right" data-ep-rating-star="${rightVal}" aria-label="Rate ${(rightVal/2).toFixed(1).replace(/\.0$/,'')} of 5" onclick="event.stopPropagation();rate('${escAttr(itemId)}','overall',${rightVal})"></button>`;
      }
      html += `</span>`;
    }
  } else {
    for (let star = 1; star <= 10; star++) {
      const pct = currentRating >= star ? 100 : 0;
      html += `<span class="ep-rating-star-slot ep-rating-star-slot-ten" data-ep-rating-slot="${star}" style="--ep-star-fill:${pct}%">`
        + `<span class="ep-rating-star-base" aria-hidden="true">★</span>`
        + `<span class="ep-rating-star-fill" aria-hidden="true">★</span>`;
      if (!readonly) {
        html += `<button type="button" class="ep-rating-star-hit ep-rating-star-hit-full" data-ep-rating-star="${star}" aria-label="Rate ${star} of 10" onclick="event.stopPropagation();rate('${escAttr(itemId)}','overall',${star})"></button>`;
      }
      html += `</span>`;
    }
  }
  if (labelText) html += `<span class="ep-rating-popup-label">${escHtml(labelText)}</span>`;
  html += `</div>`;
  return html;
}

/* v11.013: scrub handlers for the overall show rating widget.
   Clone of the v10.997 `epRatingStarsTouchStart/Move/End` pattern
   with one difference: commits via `rate(itemId, 'overall', val)`
   (the standard show-rating persist path) instead of `rateEpPopup`. */
window.myListOverallRatingTouchStart = function(e) {
  const row = e.currentTarget;
  const t = e.touches && e.touches[0];
  if (!t) return;
  row.dataset.touchStartX = String(t.clientX);
  row.dataset.touchStartY = String(t.clientY);
  row.dataset.scrubVal = '0';
  row.dataset.scrubbing = 'false';
  const hits = Array.from(row.querySelectorAll('[data-ep-rating-star]'));
  const hitMidpoints = hits.map(b => {
    const r = b.getBoundingClientRect();
    return r.left + r.width / 2;
  });
  const slots = Array.from(row.querySelectorAll('.ep-rating-star-slot'));
  row._overallScrubCache = { hits, hitMidpoints, slots, lastVal: -1 };
};
window.myListOverallRatingTouchMove = function(e) {
  const row = e.currentTarget;
  const t = e.touches && e.touches[0];
  if (!t) return;
  const cache = row._overallScrubCache;
  if (!cache) return;
  const dx = Math.abs(t.clientX - parseFloat(row.dataset.touchStartX || 0));
  const dy = Math.abs(t.clientY - parseFloat(row.dataset.touchStartY || 0));
  if (row.dataset.scrubbing !== 'true') {
    if (dx < 6 || dy > dx) return;
    const hits = Array.from(row.querySelectorAll('[data-ep-rating-star]'));
    cache.hits = hits;
    cache.hitMidpoints = hits.map(b => {
      const r = b.getBoundingClientRect();
      return r.left + r.width / 2;
    });
    cache.slots = Array.from(row.querySelectorAll('.ep-rating-star-slot'));
  }
  row.dataset.scrubbing = 'true';
  if (e.cancelable) e.preventDefault();
  let val = 0;
  for (let i = 0; i < cache.hitMidpoints.length; i++) {
    if (t.clientX >= cache.hitMidpoints[i]) val = i + 1;
  }
  /* v11.041: allow scrubbing down to 0 (no rating) — only the
     no-change dedupe remains; val 0 is a valid "clear" preview. */
  if (val === cache.lastVal) return;
  cache.lastVal = val;
  row.dataset.scrubVal = String(val);
  const stepCount = Number(row.dataset.stepCount) || 10;
  for (let idx = 0; idx < cache.slots.length; idx++) {
    const starIdx = idx + 1;
    let pct = 0;
    if (stepCount === 5) {
      const leftV = starIdx * 2 - 1;
      const rightV = starIdx * 2;
      if (val >= rightV) pct = 100;
      else if (val >= leftV) pct = 50;
    } else {
      pct = val >= starIdx ? 100 : 0;
    }
    cache.slots[idx].style.setProperty('--ep-star-fill', `${pct}%`);
  }
  row.setAttribute('aria-valuenow', String(stepCount === 5 ? val / 2 : val));
};
window.myListOverallRatingTouchEnd = function(e) {
  const row = e.currentTarget;
  const wasScrubbing = row.dataset.scrubbing === 'true';
  delete row._overallScrubCache;
  if (!wasScrubbing) return;
  row.dataset.scrubbing = 'false';
  const val = parseInt(row.dataset.scrubVal || '0', 10);
  row.dataset.scrubVal = '0';
  /* v11.041: val 0 is allowed — releasing at 0 commits "no rating". */
  if (e.cancelable) e.preventDefault();
  const itemId = row.dataset.itemId || '';
  if (!itemId || typeof rate !== 'function') return;
  /* v11.026: the SAME widget + scrub handlers now drive both the
     top-of-page overall rating and the per-season rating popout. The
     commit target is read from `data-rating-target` (defaults to
     'overall'); a season target is the `season:N` rate() key. After a
     season commit we collapse the popout so it behaves like a tap-to-
     pick bubble. */
  const target = row.dataset.ratingTarget || 'overall';
  rate(itemId, target, val);
  if (target.indexOf('season:') === 0 && typeof collapseMyListEpisodePageSeasonRatings === 'function') {
    collapseMyListEpisodePageSeasonRatings();
  }
};

function openMyListEpisodePageMediaProfile(event, itemId = '', sectionHint = '') {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const section = sectionHint || myListEpisodePageState?.section || activeSection;
  if (!itemId || !(section === 'shows' || section === 'anime')) return;
  openLibraryMediaProfile(event, itemId, section, {
    sourceContext: 'mylist-episode-page',
    openAboveMyListEpisodePage: true,
    transitionOrigin: event?.currentTarget || null
  });
}
window.openMyListEpisodePageMediaProfile = openMyListEpisodePageMediaProfile;

function renderMyListEpisodePageHtml(item = {}, section = activeSection) {
  return `
    <div class="mylist-episode-page-shell" data-episode-page-item="${escAttr(item.id)}" data-episode-page-section="${escAttr(section)}">
      <div class="mylist-episode-page-topbar">
        <button type="button" class="mylist-episode-page-back" onclick="closeMyListEpisodePage()" aria-label="Back to My Lists">
          <svg class="mylist-episode-page-back-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 4.5 6.5 10 12 15.5"></path>
          </svg>
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
  /* v11.736: re-patch TV episode stills after a re-render (rating, watched
     toggle, etc.) — instant from the per-season cache, and covers any boxes
     that were still pending when the re-render fired. */
  hydrateMyListEpisodeStills(item.id, myListEpisodePageState.section || activeSection);
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

/* v11.093: On-demand full-series assembly for the My Lists episode page.
   A Jikan-added anime only carries its own season's episodes (flat as season 1),
   so the page showed just one season. When the page opens we assemble every
   TV/ONA season from Jikan (preserving watched flags + ratings), populate
   seasonsInfo (incl. season posters), persist, and re-render — so anime sorts
   into Season 1/2/3 exactly like a TV show. Runs reliably on open (no
   background-timing dependency); skips work if the item is already multi-season. */
async function ensureAnimeSeasonsForEpisodePage(item, section) {
  try {
    if (!item || section !== 'anime') return;
    const J = window.JikanAnime;
    const malId = String(item.malId || item.mal_id || '').replace(/[^0-9]/g, '');
    if (!malId) return;
    if (!J || typeof J.getSeriesSeasons !== 'function' || typeof enrichAnimeItemWithSeriesSeasons !== 'function') {
      /* assembler unavailable — at least fill episode titles */
      hydrateAnimeEpisodeTitlesFromJikan(item);
      return;
    }
    /* Already split into multiple seasons? nothing to do. */
    const distinctSeasons = new Set((Array.isArray(item.episodes) ? item.episodes : []).map(ep => Number(ep && ep.seasonNum || 1) || 1));
    if (distinctSeasons.size >= 2) return;

    /* Show a loader in the season list while we assemble. */
    const epListEl = document.getElementById('ep-list-' + item.id);
    const epScroll = epListEl ? epListEl.querySelector('.ep-scroll') : null;
    if (epScroll) epScroll.innerHTML = '<div class="mylist-episode-page-empty">Loading seasons…</div>';

    let did = false;
    try {
      item.animeSeriesEnriched = false;            /* force a fresh assemble */
      did = await enrichAnimeItemWithSeriesSeasons(item, J);
    } catch (_) {}

    /* v11.742: if the season-assembly produced no episodes — e.g. a standalone,
       currently-airing anime whose MAL episode count is null ("Behind the
       Supermarket, Smoking with You.") — fall back to a direct fetch of the
       item's own aired episodes so the page isn't left empty. */
    if (!Array.isArray(item.episodes) || !item.episodes.length) {
      try { await hydrateAnimeEpisodeTitlesFromJikan(item, { force: true }); } catch (_) {}
    }

    /* Bail if the user navigated away from this item meanwhile. */
    if (!myListEpisodePageState || String(myListEpisodePageState.itemId) !== String(item.id)) return;
    const surface = document.querySelector('#mylist-episode-page-overlay .mylist-episode-page-surface');
    if (surface) {
      surface.innerHTML = renderMyListEpisodePageHtml(item, section);
      /* v11.740: the Jikan season-assembly re-render replaces the whole
         surface, which regenerated the episode stills as "pending" without
         re-fetching them — the root cause of watched (single-season) anime
         never showing stills. Re-run the same post-render hydration the
         normal re-render path uses. */
      restoreMyListEpisodePageSeasonState(item.id);
      hydrateMissingSeasonPosters(item.id, section);
      hydrateMyListEpisodeStills(item.id, section);
    }
    if (did) {
      try { if (typeof save === 'function' && currentUser && !viewingUser) save(); } catch (_) {}
    }
  } catch (e) {
    try { console.warn('[v11.093] anime season assembly failed:', e && e.message || e); } catch (_) {}
  }
}

function openMyListEpisodePage(itemId = '', sectionHint = activeSection) {
  const section = sectionHint || activeSection;
  if (!(section === 'shows' || section === 'anime')) return;
  const item = getMyListEpisodePageSourceItems(section).find(entry => entry && String(entry.id || '') === String(itemId));
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
  /* v11.740: hydrate episode stills on OPEN (not only on manual season
     expand) so they pre-load even when a season is restored open. Instant
     once the per-season TMDB cache is warm. */
  hydrateMyListEpisodeStills(itemId, section);
  if (section === 'anime' && item && (item.malId || item.mal_id)) {
    /* v11.093: assemble the full series (all seasons + episodes) from Jikan on
       open, so the episode page shows Season 1/2/3 like a TV show. Falls back
       to title-only hydration if the assembler isn't available. */
    ensureAnimeSeasonsForEpisodePage(item, section);
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

/* v10.997: rewritten to use the slot-based half-step pattern (one slot
   per visual star with a grey base ★ + a champagne-gold #E6C766 fill ★
   clipped to a `--ep-star-fill` percentage). Matches the shelf-log
   composer's star widget visually + behaviorally so the episode
   inline popup feels identical to the full-page Write-a-Review stars.
   Replaces the prior ad-hoc `.star-btn lit` markup that read amber
   #f59e0b and relied on per-event inline color/transform writes
   (which thrashed style and made scrub feel glitchy). */
function buildPopupRatingButtons(currentRating, itemId, epId, section) {
  const stepCount = getRatingStepCountForSection(section);
  let html = `<div class="ep-rating-popup-stars" data-section="${section}" data-step-count="${stepCount}" role="slider" aria-valuemin="0" aria-valuemax="${stepCount === 5 ? 5 : 10}" aria-valuenow="${stepCount === 5 ? currentRating / 2 : currentRating}" ontouchstart="epRatingStarsTouchStart(event)" ontouchmove="epRatingStarsTouchMove(event)" ontouchend="epRatingStarsTouchEnd(event)" ontouchcancel="epRatingStarsTouchEnd(event)">`;
  if (stepCount === 5) {
    /* 5-star half-step: 5 slots, each containing two invisible hit zones
       (left = leftVal, right = rightVal). Slot's --ep-star-fill drives
       the clipped gold ★. */
    for (let star = 1; star <= 5; star++) {
      const leftVal = star * 2 - 1;
      const rightVal = star * 2;
      let pct = 0;
      if (currentRating >= rightVal) pct = 100;
      else if (currentRating >= leftVal) pct = 50;
      html += `<span class="ep-rating-star-slot" data-ep-rating-slot="${star}" style="--ep-star-fill:${pct}%">`
        + `<span class="ep-rating-star-base" aria-hidden="true">★</span>`
        + `<span class="ep-rating-star-fill" aria-hidden="true">★</span>`
        + `<button type="button" class="ep-rating-star-hit ep-rating-star-hit-left"  data-ep-rating-star="${leftVal}"  aria-label="Rate ${(leftVal/2).toFixed(1).replace(/\.0$/,'')} of 5" onclick="event.stopPropagation();rateEpPopup('${itemId}','${epId}',${leftVal})"></button>`
        + `<button type="button" class="ep-rating-star-hit ep-rating-star-hit-right" data-ep-rating-star="${rightVal}" aria-label="Rate ${(rightVal/2).toFixed(1).replace(/\.0$/,'')} of 5" onclick="event.stopPropagation();rateEpPopup('${itemId}','${epId}',${rightVal})"></button>`
        + `</span>`;
    }
  } else {
    /* 10-star integer scale: one slot per star, single hit per slot.
       Slot fill is 0% or 100% — no halves. */
    for (let star = 1; star <= 10; star++) {
      const pct = currentRating >= star ? 100 : 0;
      html += `<span class="ep-rating-star-slot ep-rating-star-slot-ten" data-ep-rating-slot="${star}" style="--ep-star-fill:${pct}%">`
        + `<span class="ep-rating-star-base" aria-hidden="true">★</span>`
        + `<span class="ep-rating-star-fill" aria-hidden="true">★</span>`
        + `<button type="button" class="ep-rating-star-hit ep-rating-star-hit-full" data-ep-rating-star="${star}" aria-label="Rate ${star} of 10" onclick="event.stopPropagation();rateEpPopup('${itemId}','${epId}',${star})"></button>`
        + `</span>`;
    }
  }
  if (currentRating > 0) {
    html += `<span class="ep-rating-popup-label">${formatRatingValueForSection(currentRating, section)}</span>`;
  }
  html += `</div>`;
  return html;
}

/* v10.997: cached-midpoint scrub handlers for the episode rating popup.
   Same pattern as `shelfLogStarsTouchStart/Move/End` — cache hit
   midpoints on touchstart so subsequent moves don't do per-event DOM
   reads, lock the gesture only after 6px horizontal travel dominates
   vertical (prevents accidental scrub on vertical list scroll), update
   each slot's `--ep-star-fill` directly (one CSS variable write per
   slot per crossover), commit on touchend through `rateEpPopup` so
   the same persist path as a tap fires. */
window.epRatingStarsTouchStart = function(e) {
  const row = e.currentTarget;
  const t = e.touches && e.touches[0];
  if (!t) return;
  row.dataset.touchStartX = String(t.clientX);
  row.dataset.touchStartY = String(t.clientY);
  row.dataset.scrubVal = '0';
  row.dataset.scrubbing = 'false';
  const hits = Array.from(row.querySelectorAll('[data-ep-rating-star]'));
  const hitMidpoints = hits.map(b => {
    const r = b.getBoundingClientRect();
    return r.left + r.width / 2;
  });
  const slots = Array.from(row.querySelectorAll('.ep-rating-star-slot'));
  row._epScrubCache = { hits, hitMidpoints, slots, lastVal: -1 };
};
window.epRatingStarsTouchMove = function(e) {
  const row = e.currentTarget;
  const t = e.touches && e.touches[0];
  if (!t) return;
  const cache = row._epScrubCache;
  if (!cache) return;
  const dx = Math.abs(t.clientX - parseFloat(row.dataset.touchStartX || 0));
  const dy = Math.abs(t.clientY - parseFloat(row.dataset.touchStartY || 0));
  if (row.dataset.scrubbing !== 'true') {
    if (dx < 6 || dy > dx) return;
    /* Rebuild midpoints at lock-in moment — layout may have settled
       between touchstart and the first move past the 6px threshold. */
    const hits = Array.from(row.querySelectorAll('[data-ep-rating-star]'));
    cache.hits = hits;
    cache.hitMidpoints = hits.map(b => {
      const r = b.getBoundingClientRect();
      return r.left + r.width / 2;
    });
    cache.slots = Array.from(row.querySelectorAll('.ep-rating-star-slot'));
  }
  row.dataset.scrubbing = 'true';
  if (e.cancelable) e.preventDefault();
  let val = 0;
  for (let i = 0; i < cache.hitMidpoints.length; i++) {
    if (t.clientX >= cache.hitMidpoints[i]) val = i + 1;
  }
  /* v11.041: allow scrubbing down to 0 (no rating) — only the
     no-change dedupe remains; val 0 is a valid "clear" preview. */
  if (val === cache.lastVal) return;
  cache.lastVal = val;
  row.dataset.scrubVal = String(val);
  const stepCount = Number(row.dataset.stepCount) || 5;
  for (let idx = 0; idx < cache.slots.length; idx++) {
    const starIdx = idx + 1;
    let pct = 0;
    if (stepCount === 5) {
      const leftV = starIdx * 2 - 1;
      const rightV = starIdx * 2;
      if (val >= rightV) pct = 100;
      else if (val >= leftV) pct = 50;
    } else {
      pct = val >= starIdx ? 100 : 0;
    }
    cache.slots[idx].style.setProperty('--ep-star-fill', `${pct}%`);
  }
  row.setAttribute('aria-valuenow', String(stepCount === 5 ? val / 2 : val));
  /* v11.071: keep the numeric label to the RIGHT of the stars in sync with the
     live scrub value for the music TRACK rating popup (data-section="music").
     Previously the stars filled during the drag but the number stayed frozen
     until release. Scoped to music so the episode popup — which formats its
     label per-section — is left completely untouched. The label is created on
     demand so scrubbing an UNRATED track up shows the number too. */
  if (row.dataset.section === 'music') {
    let label = row.querySelector('.ep-rating-popup-label');
    if (!label && val > 0) {
      label = document.createElement('span');
      label.className = 'ep-rating-popup-label';
      row.appendChild(label);
    }
    if (label) {
      if (val > 0) {
        const half = val / 2;
        label.textContent = stepCount === 5
          ? (Number.isInteger(half) ? String(half) : half.toFixed(1))
          : String(val);
      } else {
        label.textContent = '';
      }
    }
  }
};
window.epRatingStarsTouchEnd = function(e) {
  const row = e.currentTarget;
  const wasScrubbing = row.dataset.scrubbing === 'true';
  delete row._epScrubCache;
  if (!wasScrubbing) return;
  row.dataset.scrubbing = 'false';
  const val = parseInt(row.dataset.scrubVal || '0', 10);
  row.dataset.scrubVal = '0';
  /* v11.041: val 0 is allowed — releasing at 0 commits "no rating". */
  if (e.cancelable) e.preventDefault();
  const popup = row.closest('#ep-rating-popup');
  if (!popup) return;
  rateEpPopup(popup.dataset.itemId, popup.dataset.epId, val);
};

function openEpRating(itemId, epId) {
  if (viewingUser) return;
  /* v11.738: tapping the ★ toggles its popup. If this episode's popup is
     already open, close it and stop — otherwise the button's onclick just
     tore it down and rebuilt it, so it looked like it never closed. */
  const openPopup = document.getElementById('ep-rating-popup');
  if (openPopup && String(openPopup.dataset.epId || '') === String(epId)) {
    closeEpRating();
    return;
  }
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
  /* v10.997: legacy popup-level `touchmove`/`touchend` listeners removed.
     They wrote per-event `b.style.color` + `b.style.transform` on the
     old `.star-btn` markup (which no longer exists), thrashed style on
     every move, and shipped amber #f59e0b instead of champagne gold.
     The new `ep-rating-popup-stars` element now carries its own
     `ontouchstart/move/end` handlers (epRatingStarsTouchStart/Move/End)
     that use cached hit midpoints + CSS-variable fill updates → smooth
     120Hz scrub matching the shelf-log composer. */
  /* v11.735: anchor the rating popup to the ★ button when present. TV cards
     stack the star on line 2, so the legacy row-right position dropped the
     popup on top of the 16:9 still. The anchor span opens it to the RIGHT of
     the star instead. Falls back to the row for non-TV rows. */
  const ratingMountTarget = row.querySelector('.ep-rating-anchor') || row;
  ratingMountTarget.appendChild(popup);
  activePopup = popup;
  /* v11.001: freeze vertical scroll on the active episode-list scroll
     container while the rating popup is open. Without this, a touch
     that drifts vertically off the small star widget scrolls the page
     out from under the user's finger and makes scrubbing feel broken.
     Works for BOTH surfaces (inline `#ep-list-{itemId} .ep-scroll` and
     the full-page `.mylist-episode-page-scroll`) — the helper picks
     the right container based on whether the episode page is open. */
  lockEpRatingScrollFor(itemId);
  setTimeout(() => document.addEventListener('click', closeEpRating, { once: true }), 10);
}

/* v11.001: scroll-lock helpers for the rating popup. We CAN'T just
   set `overflow: hidden` permanently — the user expects the page to
   scroll normally before and after rating. So we cache the previous
   `overflow-y` on the element's dataset and restore it on close. The
   itemId argument is used at LOCK time to find the right container;
   at UNLOCK time we read it back from the popup's dataset (the popup
   may already be removed by then so we cache on the body). */
function lockEpRatingScrollFor(itemId) {
  const container = getEpisodeInteractionScrollContainer(itemId);
  if (!container) return;
  if (container.dataset.epRatingScrollLocked === '1') return;
  container.dataset.epRatingPrevOverflowY = container.style.overflowY || '';
  container.style.overflowY = 'hidden';
  container.dataset.epRatingScrollLocked = '1';
  /* Stash the element on the body so closeEpRating can find it without
     needing the itemId (the popup may already be gone by then). */
  document.body.__shelfdEpRatingLockedEl = container;
}
function unlockEpRatingScroll() {
  const container = document.body.__shelfdEpRatingLockedEl;
  if (!container) return;
  if (container.dataset.epRatingScrollLocked === '1') {
    container.style.overflowY = container.dataset.epRatingPrevOverflowY || '';
    delete container.dataset.epRatingScrollLocked;
    delete container.dataset.epRatingPrevOverflowY;
  }
  document.body.__shelfdEpRatingLockedEl = null;
}

function closeEpRating() {
  /* v11.001: always release the scroll-lock when the popup closes,
     regardless of whether the popup element is still in the DOM. */
  unlockEpRatingScroll();
  /* v11.738: drop the pending outside-click closer so toggling open/closed
     from the ★ button doesn't accumulate document listeners. */
  document.removeEventListener('click', closeEpRating);
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

/* =============================================================================
   v10.999 — PER-EPISODE REVIEW MINI MODAL
   ----------------------------------------------------------------------------
   The "+" button next to each episode's star rating opens this mini modal
   where the user can write a short review for that specific episode. Save
   path persists `ep.review = { text, createdAt, updatedAt }` on the
   episode object via `persistMyListEpisodeEdit` and DOES NOT mirror to
   the activity feed (per spec — episode reviews are private to the shelf).
   Friend-view (viewingUser) opens in read-only mode showing the saved text
   with no editing UI.
   ========================================================================== */
const EP_REVIEW_MAX = 1200;

function getMyListEpisodeReviewItemAndEp(itemId, epId) {
  const context = getMyListEpisodeInteractionContext(itemId);
  const item = context.item;
  const section = context.section || activeSection;
  if (!item) return { item: null, section, ep: null };
  if (typeof hydrateAnimeEpisodesIfSynthetic === 'function') hydrateAnimeEpisodesIfSynthetic(item);
  const ep = (item.episodes || []).find(e => e.id === epId) || null;
  return { item, section, ep };
}

function closeEpReviewModal() {
  const overlay = document.getElementById('ep-review-modal-overlay');
  if (!overlay) return;
  overlay.classList.remove('is-open');
  setTimeout(() => { try { overlay.remove(); } catch (e) {} }, 220);
}
window.closeEpReviewModal = closeEpReviewModal;

function openEpReviewModal(itemId, epId, forceReadonly = false) {
  const { item, ep } = getMyListEpisodeReviewItemAndEp(itemId, epId);
  if (!item || !ep) return;
  /* viewing other user's list OR explicitly invoked in read-only mode →
     show the review text without editing UI. */
  const readonly = !!viewingUser || !!forceReadonly;
  const existingText = String(ep?.review?.text || '').trim();
  if (readonly && !existingText) return; /* nothing to show */
  closeEpReviewModal();
  closeEpRating(); /* prevent rating popup + review modal overlap */
  const overlay = document.createElement('div');
  overlay.id = 'ep-review-modal-overlay';
  overlay.className = 'ep-review-modal-overlay';
  overlay.dataset.itemId = String(itemId);
  overlay.dataset.epId = String(epId);
  overlay.dataset.readonly = readonly ? '1' : '0';
  const epLabel = `Episode ${escHtml(String(ep.epNum || ep.number || ''))}${ep.title ? ' — ' + escHtml(String(ep.title)) : ''}`;
  const headerLabel = readonly
    ? 'Episode review'
    : (existingText ? 'Edit episode review' : 'Write episode review');
  const titleAttr = escAttr(ep.title || 'this episode');
  const editableHtml = `
        <textarea class="ep-review-modal-input" id="ep-review-modal-input" rows="5" maxlength="${EP_REVIEW_MAX}" placeholder="Share your thoughts on ${titleAttr}">${escHtml(existingText)}</textarea>
        <div class="ep-review-modal-foot">
          <span class="ep-review-modal-counter" id="ep-review-modal-counter">${existingText.length}/${EP_REVIEW_MAX}</span>
          <div class="ep-review-modal-actions">
            ${existingText ? '<button type="button" class="ep-review-modal-delete" data-ep-review-delete>Delete</button>' : ''}
            <button type="button" class="ep-review-modal-cancel" data-ep-review-cancel>Cancel</button>
            <button type="button" class="ep-review-modal-save" data-ep-review-save>${existingText ? 'Save' : 'Post'}</button>
          </div>
        </div>`;
  const readonlyHtml = `
        <div class="ep-review-modal-readonly-text">${escHtml(existingText)}</div>
        <div class="ep-review-modal-foot">
          <span class="ep-review-modal-counter">&nbsp;</span>
          <div class="ep-review-modal-actions">
            <button type="button" class="ep-review-modal-save" data-ep-review-cancel>Done</button>
          </div>
        </div>`;
  overlay.innerHTML = ''
    + '<div class="ep-review-modal-backdrop" data-ep-review-backdrop></div>'
    + '<div class="ep-review-modal-sheet" role="dialog" aria-modal="true" aria-labelledby="ep-review-modal-title">'
    +   '<div class="ep-review-modal-header">'
    +     '<h2 id="ep-review-modal-title">' + headerLabel + '</h2>'
    +     '<button type="button" class="ep-review-modal-close" data-ep-review-cancel aria-label="Close">&times;</button>'
    +   '</div>'
    +   '<div class="ep-review-modal-subtitle">' + epLabel + '</div>'
    +   (readonly ? readonlyHtml : editableHtml)
    + '</div>';
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  /* Ghost-click guard — same pattern as openCardCommentComposer.
     Defer handler wiring by 350ms so a stray late synthetic click on the
     spot where the "+" button was can't auto-close the just-opened modal. */
  setTimeout(() => {
    const live = document.getElementById('ep-review-modal-overlay');
    if (!live) return;
    const backdrop = live.querySelector('[data-ep-review-backdrop]');
    const sheet = live.querySelector('.ep-review-modal-sheet');
    if (backdrop) backdrop.addEventListener('click', e => {
      if (e.target === backdrop) closeEpReviewModal();
    });
    if (sheet) sheet.addEventListener('click', e => e.stopPropagation());
    live.querySelectorAll('[data-ep-review-cancel]').forEach(btn => {
      btn.addEventListener('click', closeEpReviewModal);
    });
    const saveBtn = live.querySelector('[data-ep-review-save]');
    if (saveBtn) saveBtn.addEventListener('click', () => saveEpReviewFromModal());
    const delBtn = live.querySelector('[data-ep-review-delete]');
    if (delBtn) delBtn.addEventListener('click', () => deleteEpReviewFromModal());
  }, 350);
  if (!readonly) {
    const ta = document.getElementById('ep-review-modal-input');
    const counter = document.getElementById('ep-review-modal-counter');
    if (ta) {
      /* Same defer-focus pattern as openCardCommentComposer to avoid
         iOS Safari's "scroll focused element into view" jumping the
         page during the fade-in. */
      setTimeout(() => {
        try {
          ta.focus({ preventScroll: true });
          ta.setSelectionRange(ta.value.length, ta.value.length);
        } catch (_) { try { ta.focus(); } catch (__) {} }
      }, 360);
      ta.addEventListener('input', () => {
        if (counter) counter.textContent = ta.value.length + '/' + EP_REVIEW_MAX;
      });
    }
  }
}
window.openEpReviewModal = openEpReviewModal;

function saveEpReviewFromModal() {
  const overlay = document.getElementById('ep-review-modal-overlay');
  if (!overlay) return;
  if (overlay.dataset.readonly === '1') { closeEpReviewModal(); return; }
  const itemId = overlay.dataset.itemId || '';
  const epId = overlay.dataset.epId || '';
  const ta = document.getElementById('ep-review-modal-input');
  const text = String(ta?.value || '').trim().slice(0, EP_REVIEW_MAX);
  const { item, section, ep } = getMyListEpisodeReviewItemAndEp(itemId, epId);
  if (!item || !ep) { closeEpReviewModal(); return; }
  /* Empty text on save → delete the review (mirrors card-comment behavior). */
  if (!text) {
    if (ep.review?.text) delete ep.review;
    closeEpReviewModal();
    persistMyListEpisodeEdit(item, section);
    refreshEpReviewBtnUI(itemId, epId, '');
    return;
  }
  const now = new Date().toISOString();
  ep.review = {
    ...(ep.review || {}),
    text,
    createdAt: ep.review?.createdAt || now,
    updatedAt: now
  };
  closeEpReviewModal();
  persistMyListEpisodeEdit(item, section);
  refreshEpReviewBtnUI(itemId, epId, text);
  if (typeof showToast === 'function') showToast('Episode review saved');
}

function deleteEpReviewFromModal() {
  const overlay = document.getElementById('ep-review-modal-overlay');
  if (!overlay) return;
  if (overlay.dataset.readonly === '1') return;
  const itemId = overlay.dataset.itemId || '';
  const epId = overlay.dataset.epId || '';
  const { item, section, ep } = getMyListEpisodeReviewItemAndEp(itemId, epId);
  if (!item || !ep) { closeEpReviewModal(); return; }
  delete ep.review;
  closeEpReviewModal();
  persistMyListEpisodeEdit(item, section);
  refreshEpReviewBtnUI(itemId, epId, '');
  if (typeof showToast === 'function') showToast('Episode review deleted');
}

/* Partial DOM update for the episode-row's review button so we don't
   trigger a full grid re-render on every save (the full page Show
   Details page also rerenders, but that's a no-op when this lives
   inside it — the swap stays in sync either way). */
function refreshEpReviewBtnUI(itemId, epId, newText) {
  const row = document.getElementById('ep-row-' + epId);
  if (!row) return;
  const btn = row.querySelector('.ep-review-btn');
  if (!btn) return;
  const hasText = !!String(newText || '').trim();
  btn.classList.toggle('has-comment', hasText);
  btn.setAttribute('aria-label', hasText ? 'Edit this episode review' : 'Write a review about this episode');
  btn.setAttribute('title', hasText ? 'Edit episode review' : 'Write a review about this episode');
  const iconPlus = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  const iconBubble = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.25 5.25h11.5A2.25 2.25 0 0 1 20 7.5v6A2.25 2.25 0 0 1 17.75 15.75H10.9L7.25 18.75v-3H6.25A2.25 2.25 0 0 1 4 13.5v-6a2.25 2.25 0 0 1 2.25-2.25Z"/><path d="M8 9.25h8"/><path d="M8 12.25h5.5"/></svg>';
  btn.innerHTML = hasText ? iconBubble : iconPlus;
}

/* =============================================================================
   v11.000 — LONG-PRESS EPISODE → REVIEW MODAL + HAPTIC
   ----------------------------------------------------------------------------
   Hold any episode row for ~500ms (with finger NOT moving more than 8px)
   to fire a haptic blip and open the per-episode review modal — same modal
   the "+" button opens. Lets users get to the review composer without
   precisely targeting the small + icon.

   Delegation: one document-level touchstart listener finds the closest
   `.ep-row[data-ep-id]`. Cancellation: touchmove > 8px in either axis OR
   touchend before the threshold cancels the press. Buttons inside the row
   (check / rating / review / nested) are excluded via a closest()/dataset
   check so their own taps still fire normally.

   Haptic: Capacitor `Haptics.impact({ style: 'LIGHT' })` on native iOS,
   falls back to `navigator.vibrate(15)` on web. Both paths gated by
   feature-detection so unsupported environments just no-op.

   Owner-only: skipped when `viewingUser` is non-null (friend view has
   nothing to compose). The friend-view review indicator is still tappable
   via its own onclick.
   ========================================================================== */
(function bindEpisodeLongPressReviewHandler() {
  if (typeof document === 'undefined') return;
  if (document.__shelfdEpisodeLongPressBound) return;
  document.__shelfdEpisodeLongPressBound = true;

  const HOLD_MS = 500;
  const MOVE_CANCEL_PX = 8;
  let state = null; /* { timer, startX, startY, itemId, epId, fired } */

  function fireHaptic() {
    try {
      const Haptics = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
      if (Haptics && typeof Haptics.impact === 'function') {
        Haptics.impact({ style: 'LIGHT' }).catch?.(() => {});
        return;
      }
    } catch (_) {}
    try { if (navigator && navigator.vibrate) navigator.vibrate(15); } catch (_) {}
  }

  function cancelPress() {
    if (!state) return;
    if (state.timer) { clearTimeout(state.timer); state.timer = 0; }
    state = null;
  }

  function shouldIgnoreTarget(target) {
    if (!target || !target.closest) return true;
    /* Skip if the touch starts on any interactive element inside the row
       — their own handlers should fire normally without the long-press
       hijacking the gesture. */
    if (target.closest('button, a, input, textarea, select, [role="button"]')) return true;
    /* Skip if we're inside an open rating popup or the review modal
       itself (so a finger holding inside an open popup doesn't queue
       another modal open). */
    if (target.closest('#ep-rating-popup, #ep-review-modal-overlay')) return true;
    return false;
  }

  document.addEventListener('touchstart', (event) => {
    cancelPress();
    if (typeof viewingUser !== 'undefined' && viewingUser) return; /* owner only */
    if (!event.touches || event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (!touch) return;
    const target = event.target;
    if (shouldIgnoreTarget(target)) return;
    const row = target.closest && target.closest('.ep-row[data-ep-id]');
    if (!row) return;
    /* v11.013: skip long-press on future-locked rows — review composer
       must be inaccessible for unreleased episodes (same gate as the
     "+" button itself). */
    if (row.classList && row.classList.contains('future-locked-ep')) return;
    const itemId = row.getAttribute('data-item-id') || '';
    const epId = row.getAttribute('data-ep-id') || '';
    if (!itemId || !epId) return;
    state = {
      startX: touch.clientX,
      startY: touch.clientY,
      itemId,
      epId,
      fired: false,
      timer: 0
    };
    state.timer = window.setTimeout(() => {
      if (!state) return;
      state.fired = true;
      state.timer = 0;
      fireHaptic();
      try { openEpReviewModal(itemId, epId); }
      catch (e) { console.warn('[v11.000] long-press openEpReviewModal failed:', e); }
    }, HOLD_MS);
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    if (!state) return;
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    const dx = Math.abs(touch.clientX - state.startX);
    const dy = Math.abs(touch.clientY - state.startY);
    if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) cancelPress();
  }, { passive: true });

  document.addEventListener('touchend', () => { cancelPress(); }, { passive: true });
  document.addEventListener('touchcancel', () => { cancelPress(); }, { passive: true });
})();

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
  /* v11.733: lazy-load TV episode 16:9 stills the first time a season is
     expanded. TV only ('shows'); fire-and-forget, patches .ep-still boxes
     by episode number once TMDB returns. */
  if (!open) { try { hydrateMyListEpisodeStills(itemId); } catch (_) {} }

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
      const releasedEpisodes = val ? getScreenListReleasedEpisodesForMarking(item, affectedEpisodes) : affectedEpisodes;
      if (val && !releasedEpisodes.length) {
        showScreenListFutureEpisodeToast(item, affectedEpisodes);
        return;
      }
      const newlyWatched = releasedEpisodes.filter(e => !e.watched).length;
      item.episodes.forEach(e => { if (e.seasonNum === sNum && (!val || releasedEpisodes.includes(e))) e.watched = val; });
      if (val) {
        markEpisodeWatchActivity(item, section, { count: Math.max(1, newlyWatched), label: `season ${sNum} watched` });
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
  return typeof getScreenListHighQualityGameCover === 'function'
    ? getScreenListHighQualityGameCover(gameLike || {})
    : typeof getScreenListPreferredGameCover === 'function'
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

function getGameMediaFacts(details = {}) {
  const facts = [];
  const releaseDate = formatGameReleaseDate(details.released);
  const platforms = Array.isArray(details.platforms)
    ? details.platforms.map(p => p.platform?.name || p.name).filter(Boolean).slice(0, 3).join(', ')
    : String(details.platforms || '').trim();
  const developers = (details.developers || []).map(dev => dev.name).filter(Boolean).slice(0, 2).join(', ');
  const publishers = (details.publishers || []).map(pub => pub.name).filter(Boolean).slice(0, 2).join(', ');
  if (releaseDate) facts.push({ label: 'Released', value: releaseDate, priority: true, kind: 'release-date' });
  if (platforms) facts.push({ label: 'Platform', value: platforms, priority: true });
  if (developers) facts.push({ label: 'Developer', value: developers });
  if (details.esrb_rating?.name) facts.push({ label: 'ESRB', value: details.esrb_rating.name });
  if (publishers) facts.push({ label: 'Publisher', value: publishers });
  if (details.metacritic) facts.push({ label: 'Metacritic', value: String(details.metacritic) });
  if (details.playtime) facts.push({ label: 'Avg Playtime', value: `${details.playtime}h` });
  return facts.slice(0, 8);
}

function getGameMediaFactClass(fact = {}) {
  return [
    fact.priority ? 'primary' : '',
    fact.kind ? `discover-media-fact-${String(fact.kind).replace(/[^a-z0-9_-]+/gi, '-').toLowerCase()}` : ''
  ].filter(Boolean).join(' ');
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

function getImdbMediaUrl(details = {}) {
  const imdbId = details.imdb_id || details.external_ids?.imdb_id || '';
  return imdbId ? `https://www.imdb.com/title/${imdbId}/` : 'https://www.imdb.com/';
}

function getMyAnimeListUrl(details = {}) {
  // MyAnimeList doesn't have a direct TMDB->MAL mapping, so we'll search by title
  const title = details.title || details.name || '';
  return title ? `https://myanimelist.net/search/all?q=${encodeURIComponent(title)}` : 'https://myanimelist.net/';
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
  /* v11.383: decide anime from the title's OWN data only. Previously a
     `activeDiscoveryHub === 'anime'` clause here stamped the MyAnimeList export
     badge (and anime treatment) onto any TV profile opened while the Anime hub
     was the last-viewed hub — e.g. Severance. Genuine anime always carries
     mediaCategory/librarySection/isAnime flags (set by the Jikan path and the
     TMDB anime-detection path) or passes isAnimeDiscoverCandidate. */
  if (details?.mediaCategory === 'anime' || details?.librarySection === 'anime' || details?.isAnime) return true;
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
  /* v11.227: was w92 — too low-res for retina/ProMotion; the tiny w92 PNG
     looked soft when scaled into the provider circle. Request `original`
     (TMDB's full-resolution source) so the logo renders crisp at 2x/3x DPR.
     Provider logo files are small (typically <10KB) so the payload cost is
     negligible. TMDB does not offer SVG provider logos, so original PNG is
     the highest-fidelity source available. */
  if (logoPath) return `https://image.tmdb.org/t/p/original${logoPath.startsWith('/') ? logoPath : `/${logoPath}`}`;
  return '';
}

function getMediaProviderDomain(provider = {}) {
  const rawDomain = String(provider.domain || provider.websiteDomain || provider.website_domain || '').trim();
  if (rawDomain) return rawDomain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const name = normalizeProviderName(provider.provider_name || provider.name || provider.label || '');
  return MEDIA_PROVIDER_DOMAIN_MAP[name] || '';
}

/* v11.743: TMDB serves provider logos at only 100x100 even at `original`
   (measured), so the where-to-watch circles looked soft. For the providers
   whose Google app-icon is genuinely higher-res than that 100px (measured
   per-domain), pull the 256px icon instead. Everything else keeps TMDB
   `original` — Netflix (64), Starz/Amazon/Kanopy (48), Roku (32), Hoopla (96)
   have favicons <=100px, so TMDB stays sharper for them. */
const MEDIA_PROVIDER_HIRES_FAVICON_DOMAINS = new Set([
  'showtime.com', 'pluto.tv', 'paramountplus.com', 'max.com', 'criterionchannel.com',
  'vudu.com', 'tv.apple.com', 'tubitv.com', 'mubi.com', 'hulu.com', 'fandangoathome.com',
  'disneyplus.com', 'primevideo.com', 'peacocktv.com', 'youtube.com', 'crunchyroll.com'
]);

function getMediaProviderHiResFaviconUrl(provider = {}) {
  const domain = getMediaProviderDomain(provider);
  if (!domain || !MEDIA_PROVIDER_HIRES_FAVICON_DOMAINS.has(domain)) return '';
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`;
}

function getMediaProviderFallbackIconUrl(provider = {}) {
  const domain = getMediaProviderDomain(provider);
  /* v11.743: 64 -> 256 so providers with no TMDB logo aren't a tiny favicon. */
  return domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256` : '';
}

function getMediaProviderLogoUrl(provider = {}) {
  return getMediaProviderHiResFaviconUrl(provider)
    || normalizeMediaProviderLogoUrl(provider)
    || getMediaProviderFallbackIconUrl(provider);
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
  /* v11.295: already-normalized rows (AI fallback / cached watchProviderDisplay)
     still need brand dedupe + canonical relabeling, in case they were built by
     an older app version or carry packaging variants. */
  if (Array.isArray(region.data)) {
    const aiRows = region.data.map(row => {
      if (!row || typeof row !== 'object') return row;
      if (!Array.isArray(row.providers) || !row.providers.length) return row;
      return { ...row, providers: cleanWatchProviderEntries(row.providers, 6) };
    }).filter(row => row && (row.text || (Array.isArray(row.providers) && row.providers.length)));
    return dedupeBrandsAcrossRows(aiRows); // v11.416: one brand across all rows
  }
  /* v649: Rent + Buy options removed from media profile per spec —
     too much clutter. Streaming-only (Stream / Free / With Ads). */
  const defs = [
    { key: 'flatrate', label: 'Stream' },
    { key: 'free', label: 'Free' },
    { key: 'ads', label: 'With Ads' }
  ];
  const hiddenProviderNames = new Set([
    'hbo max amazon channel',
    'max amazon channel',
    'netflix with standard ads',
    'netflix standard with ads',
    'netflix with ads'
  ]);
  /* v11.295: dedupe by BRAND, not provider_id. TMDB exposes each pricing /
     packaging tier (Paramount Plus Premium, Essential, Amazon Channel…) as a
     distinct provider_id, so id-based dedupe let all of them through. Brand
     keying collapses them to one, and we relabel the survivor with the clean
     brand name ("Paramount Plus") instead of the raw packaging variant. */
  const builtRows = defs.map(def => ({
    key: def.key,
    label: def.label,
    providers: cleanWatchProviderEntries(region.data[def.key] || [], 6, hiddenProviderNames)
  })).filter(row => row.providers.length);
  return dedupeBrandsAcrossRows(builtRows); // v11.416: one brand across all rows (kills the duplicate Prime Video)
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
        return `<div class="discover-media-watch-inline-row discover-media-watch-inline-row-${escAttr(row.key || 'unknown')}"><span class="discover-media-watch-inline-provider-list">${value}</span></div>`;
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
      <div class="discover-media-loading shelfd-shelf-loading" role="status" aria-label="Loading">
        <div class="shelfd-shelf-loader" aria-hidden="true">
          <span class="shelfd-shelf-book"></span>
          <span class="shelfd-shelf-book"></span>
          <span class="shelfd-shelf-book"></span>
          <span class="shelfd-shelf-book"></span>
          <span class="shelfd-shelf-book"></span>
          <span class="shelfd-shelf-plank"></span>
        </div>
      </div>
    </div>
  </section>`;
}

// v11.949: game "Info" section. IGDB (Twitch) is the PRIMARY source, RAWG the
// fallback. Cross-play is not exposed by either API, so it stays blank (never faked).
async function fetchGameInfoFromIgdb(details = {}) {
  const title = getGameTitleValue(details);
  if (!title) return null;
  const params = new URLSearchParams({ title });
  const year = String(details.released || details.year || '').slice(0, 4);
  if (year) params.set('year', year);
  // v11.954: response-shape version — bump when /api/igdb/game-info output changes
  // so the browser HTTP cache doesn't replay a stale-shape response (v3 added the
  // synopsis/summary field).
  params.set('iv', '3');
  try {
    const res = await fetch('/api/igdb/game-info?' + params.toString(), { cache: 'default' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.ok || !data.info) return null;
    return data.info;
  } catch (_) {
    return null;
  }
}

function getGameMediaInfoRows(details = {}) {
  const igdb = (details && details.igdbInfo && typeof details.igdbInfo === 'object') ? details.igdbInfo : {};
  const rawgDevelopers = (details.developers || []).map(d => d.name).filter(Boolean);
  const rawgPublishers = (details.publishers || []).map(p => p.name).filter(Boolean);
  const rawgGenres = (details.genres || []).map(g => g.name).filter(Boolean);
  const rawgEsrb = details.esrb_rating?.name || '';

  // v11.952: prefer IGDB date, else RAWG. If the value is a human label IGDB
  // gives for unreleased games ("Q4 2025", "TBD") that the date formatter can't
  // parse, show it as-is rather than dropping the row.
  const rawReleaseDate = igdb.releaseDate || details.released || '';
  let releaseDate = formatGameReleaseDate(rawReleaseDate);
  if (!releaseDate && rawReleaseDate) releaseDate = String(rawReleaseDate).trim();
  const developers = (igdb.developers && igdb.developers.length) ? igdb.developers : rawgDevelopers;
  const publishers = (igdb.publishers && igdb.publishers.length) ? igdb.publishers : rawgPublishers;
  const genres = (igdb.genres && igdb.genres.length) ? igdb.genres : rawgGenres;
  const gameModes = Array.isArray(igdb.gameModes) ? igdb.gameModes : [];
  const ageRating = igdb.ageRating || rawgEsrb;
  const franchise = igdb.franchise || '';
  const onlineOffline = igdb.onlineOffline || '';
  const crossplay = igdb.crossplay || '';

  const join = (arr, n) => (Array.isArray(arr) ? arr.filter(Boolean).slice(0, n).join(', ') : String(arr || ''));
  const rows = [];
  // v11.953: most fields omit when empty; Release Date ALWAYS shows its
  // subheading ("Unknown" when no date is available). Platforms now live in
  // their own section above the Info section.
  const push = (label, value) => { const v = String(value || '').trim(); if (v) rows.push({ label, value: v }); };
  rows.push({ label: 'Release Date', value: String(releaseDate || '').trim() || 'Unknown' });
  push('Developer', join(developers, 3));
  push('Publisher', join(publishers, 3));
  push('Genre', join(genres, 4));
  push('Game Modes', join(gameModes, 5));
  push('Online / Offline', onlineOffline);
  push('Age Rating', ageRating);
  push('Franchise', franchise);
  push('Cross-Play', crossplay);
  return rows;
}

// v11.953: Platforms get their own horizontal section above Info, each with the
// platform's high-res IGDB logo. IGDB is primary (objects {name, abbr, logo});
// RAWG names are the no-logo fallback.
function cleanGamePlatformName(name = '') {
  return String(name || '').replace(/\s*\(microsoft windows\)/i, '').replace(/\s+/g, ' ').trim();
}

// v11.957: platform icons use the SAME clean brand-logo source as the profile
// export links (Google favicon, full-colour circular brand icon) instead of the
// IGDB wordmark logos. PC maps to the Steam icon per spec.
const GAME_PLATFORM_ICON_DOMAINS = [
  [/playstation|\bps[2345]\b|\bpsvr\b|\bps vr\b|\bvita\b|\bpsp\b/i, 'playstation.com'],
  [/xbox/i, 'xbox.com'],
  [/nintendo|switch|\bwii\b|\b3ds\b|\bnds\b|gamecube/i, 'nintendo.com'],
  [/\bpc\b|microsoft windows|\bwindows\b|steam/i, 'store.steampowered.com'],
  [/\bmac\b|macos|\bos x\b|ios|iphone|ipad/i, 'apple.com'],
  [/android/i, 'android.com'],
  [/linux/i, 'linux.org'],
  [/stadia/i, 'stadia.google.com'],
  [/oculus|meta quest|\bquest\b|\bvr\b/i, 'meta.com'],
  [/epic/i, 'epicgames.com'],
  [/\bgog\b/i, 'gog.com'],
  [/amazon|luna/i, 'amazon.com']
];

function getGamePlatformIconUrl(name = '') {
  const n = String(name || '').toLowerCase();
  for (const [re, domain] of GAME_PLATFORM_ICON_DOMAINS) {
    if (re.test(n)) return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
  }
  return '';
}

function getGamePlatformsList(details = {}) {
  const igdb = (details && details.igdbInfo && typeof details.igdbInfo === 'object') ? details.igdbInfo : {};
  let names = [];
  if (Array.isArray(igdb.platforms) && igdb.platforms.length && typeof igdb.platforms[0] === 'object') {
    names = igdb.platforms.map(p => cleanGamePlatformName(p.name)).filter(Boolean);
  } else {
    names = (Array.isArray(details.platforms) ? details.platforms.map(p => p.platform?.name || p.name) : [])
      .map(cleanGamePlatformName).filter(Boolean);
  }
  return names.map(name => ({ name, logo: getGamePlatformIconUrl(name) }));
}

function renderGamePlatformsSectionHtml(details = {}) {
  const platforms = getGamePlatformsList(details);
  return `<div class="discover-media-section game-platforms-section" id="game-media-platforms-section"${platforms.length ? '' : ' hidden'}>
    <h3>Platforms</h3>
    <div class="game-platforms-row">${platforms.map(p => `<div class="game-platform-chip"><span class="game-platform-name">${escHtml(p.name)}</span>${p.logo ? `<span class="game-platform-logo-wrap"><img class="game-platform-logo" src="${escAttr(p.logo)}" alt="" loading="lazy" decoding="async"></span>` : ''}</div>`).join('')}</div>
  </div>`;
}

function renderGameMediaInfoSectionHtml(details = {}) {
  const rows = getGameMediaInfoRows(details);
  return `<div class="discover-media-section discover-media-section-info" id="game-media-info-section"${rows.length ? '' : ' hidden'}>
    <h3>Info</h3>
    <div class="discover-media-info-grid">${rows.map(r => `<div class="discover-media-info-item"><span>${escHtml(r.label)}</span><strong>${escHtml(r.value)}</strong></div>`).join('')}</div>
  </div>`;
}

async function hydrateGameMediaProfileInfo(overlay, details = {}) {
  try {
    const info = await fetchGameInfoFromIgdb(details);
    if (!info) return;
    details.igdbInfo = info;
    const root = (overlay && overlay.querySelector) ? overlay : document.getElementById('discover-media-profile');
    if (!root || !root.querySelector) return;
    const replaceSection = (id, html) => {
      const section = root.querySelector('#' + id);
      if (!section) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const fresh = tmp.firstElementChild;
      if (fresh) section.replaceWith(fresh);
    };
    replaceSection('game-media-platforms-section', renderGamePlatformsSectionHtml(details));
    replaceSection('game-media-info-section', renderGameMediaInfoSectionHtml(details));
    // v11.964: fill the synopsis from the IGDB summary (or its Steam fallback)
    // once it loads — the initial render often had only the (capped) RAWG source.
    const synopsisEl = root.querySelector('.discover-media-synopsis');
    if (synopsisEl) {
      const text = getGameOverviewText(details);
      if (text && synopsisEl.textContent !== text) synopsisEl.textContent = text;
    }
  } catch (_) {}
}

/* =============================================================================
   v11.956: Official game videos (game media profile).
   Mirrors the News Feed YouTube infra (inline player + likes/comments/views +
   comments bottom sheet) but is fully self-contained — it does NOT touch the
   news feed. Lives between Reviews and More Like This. Tap-to-play inline 16:9,
   max 6 videos, only the comment count is interactive (opens a comments sheet).
   ========================================================================== */
const GV_COMMENT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z"/></svg>';
let _gameVideoActiveMedia = null;
let _gvcState = null;

function formatCompactCountGV(n) {
  const num = Number(n || 0);
  if (!Number.isFinite(num) || num <= 0) return '0';
  if (num >= 1e9) return (num / 1e9).toFixed(num >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(num >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(num >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return String(num);
}

function timeAgoGV(ms) {
  const diff = Date.now() - Number(ms || 0);
  if (!Number.isFinite(diff) || diff < 0) return '';
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24); if (d < 30) return d + 'd ago';
  const mo = Math.floor(d / 30); if (mo < 12) return mo + 'mo ago';
  return Math.floor(mo / 12) + 'y ago';
}

function renderGameVideosSectionHtml() {
  return `<div class="discover-media-section game-videos-section" id="game-media-videos-section" hidden>
    <h3>Videos</h3>
    <div class="game-videos-list" data-game-videos-list></div>
  </div>`;
}

function renderGameVideoCardHtml(v) {
  const vid = String(v.videoId || '').trim();
  const thumb = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
  return `<div class="game-video-card" data-game-video-id="${escAttr(vid)}">
    <div class="game-video-media news-card-media-video" data-game-video-media data-game-video-thumb="${escAttr(thumb)}">
      <button class="game-video-play" type="button" onclick="playGameVideo(this)" style="background-image:url('${escAttr(thumb)}')" aria-label="Play ${escAttr(v.title || 'video')}"><span class="game-video-play-icon" aria-hidden="true"></span></button>
    </div>
    <div class="game-video-title">${escHtml(v.title || '')}</div>
    <div class="game-video-engage" data-game-video-engage data-game-video-id="${escAttr(vid)}"><div class="game-video-stats" data-game-video-stats></div></div>
  </div>`;
}

function restoreGameVideoMedia(media) {
  if (!media) return;
  const thumb = media.getAttribute('data-game-video-thumb') || '';
  media.innerHTML = `<button class="game-video-play" type="button" onclick="playGameVideo(this)" style="background-image:url('${escAttr(thumb)}')" aria-label="Play video"><span class="game-video-play-icon" aria-hidden="true"></span></button>`;
}

function playGameVideo(btn) {
  const media = btn && btn.closest ? btn.closest('[data-game-video-media]') : null;
  const card = btn && btn.closest ? btn.closest('[data-game-video-id]') : null;
  if (!media || !card) return;
  if (_gameVideoActiveMedia && _gameVideoActiveMedia !== media) restoreGameVideoMedia(_gameVideoActiveMedia);
  const vid = encodeURIComponent(card.getAttribute('data-game-video-id') || '');
  const origin = (() => { try { return '&origin=' + encodeURIComponent(location.origin); } catch (_) { return ''; } })();
  const src = `https://www.youtube.com/embed/${vid}?playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&autoplay=1&enablejsapi=1${origin}&controls=1&fs=1`;   // v11.968: youtube.com (not nocookie) so the embed carries trust cookies → no bot wall
  media.innerHTML = `<iframe src="${src}" title="" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen playsinline></iframe>`;
  _gameVideoActiveMedia = media;
}

async function hydrateGameVideoStats(section, videoIds) {
  if (!section || !videoIds.length) return;
  try {
    const res = await fetch('/api/youtube/videos?ids=' + encodeURIComponent(videoIds.join(',')), { headers: { Accept: 'application/json' } });
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !data.ok || !Array.isArray(data.items)) return;
    data.items.forEach(it => {
      const box = section.querySelector(`[data-game-video-engage][data-game-video-id="${it.videoId}"] [data-game-video-stats]`);
      if (!box) return;
      const likes = Number(it.likeCount || 0), views = Number(it.viewCount || 0), comments = Number(it.commentCount || 0);
      const parts = [];
      if (likes > 0) parts.push(`<span class="game-video-stat">${formatCompactCountGV(likes)} likes</span>`);
      parts.push(`<button type="button" class="game-video-stat game-video-commentstat" onclick="openGameVideoCommentsSheet('${escAttr(it.videoId)}')" aria-label="View comments">${GV_COMMENT_SVG}<span>${formatCompactCountGV(comments)}</span></button>`);
      if (views > 0) parts.push(`<span class="game-video-stat">${formatCompactCountGV(views)} views</span>`);
      box.innerHTML = parts.join('');
    });
  } catch (_) {}
}

async function hydrateGameVideos(overlay, details = {}) {
  try {
    const root = (overlay && overlay.querySelector) ? overlay : document.getElementById('discover-media-profile');
    const section = root && root.querySelector ? root.querySelector('#game-media-videos-section') : null;
    if (!section) return;
    const title = getGameTitleValue(details);
    if (!title) return;
    if (!details.igdbInfo) { try { details.igdbInfo = await fetchGameInfoFromIgdb(details); } catch (_) {} }
    const igdb = details.igdbInfo || {};
    const developer = (Array.isArray(igdb.developers) && igdb.developers[0]) || (details.developers && details.developers[0] && details.developers[0].name) || '';
    const publisher = (Array.isArray(igdb.publishers) && igdb.publishers[0]) || (details.publishers && details.publishers[0] && details.publishers[0].name) || '';
    const params = new URLSearchParams({ title });
    if (developer) params.set('developer', developer);
    if (publisher) params.set('publisher', publisher);
    // v11.962: sort version — bump when the worker's video ordering changes so the
    // browser HTTP cache doesn't replay the old (unsorted-by-views) order.
    params.set('sv', '2');
    const res = await fetch('/api/youtube/game-videos?' + params.toString(), { cache: 'default' });
    if (!res.ok) return;
    const data = await res.json();
    const videos = (data && data.ok && Array.isArray(data.videos)) ? data.videos.slice(0, 6) : [];
    if (!videos.length) return;
    const listEl = section.querySelector('[data-game-videos-list]');
    if (!listEl) return;
    listEl.innerHTML = videos.map(renderGameVideoCardHtml).join('');
    section.removeAttribute('hidden');
    hydrateGameVideoStats(section, videos.map(v => v.videoId).filter(Boolean));
  } catch (_) {}
}

/* --- Game video comments bottom sheet (replicates the News Feed sheet) --- */
function openGameVideoCommentsSheet(videoId) {
  closeGameVideoCommentsSheet();
  const vid = String(videoId || '').trim();
  if (!vid) return;
  _gvcState = { videoId: vid, items: [], nextToken: '', loading: false, error: false, disabled: false };
  const root = document.createElement('div');
  root.className = 'gv-comments-root';
  root.id = 'gv-comments-root';
  root.innerHTML = `<div class="gv-comments-backdrop" onclick="closeGameVideoCommentsSheet()"></div>
    <div class="gv-comments-sheet" role="dialog" aria-modal="true" aria-label="Comments">
      <header class="gv-comments-head">
        <span class="gv-comments-grab" aria-hidden="true"></span>
        <h2 class="gv-comments-title">Comments</h2>
        <button type="button" class="gv-comments-close" onclick="closeGameVideoCommentsSheet()" aria-label="Close comments"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </header>
      <div class="gv-comments-body" data-gvc-body></div>
    </div>`;
  document.body.appendChild(root);
  requestAnimationFrame(() => root.classList.add('is-open'));
  attachGvcSwipeDismiss(root);
  loadGameVideoComments(false);
}

function closeGameVideoCommentsSheet() {
  const root = document.getElementById('gv-comments-root');
  _gvcState = null;
  if (!root) return;
  root.classList.remove('is-open');
  setTimeout(() => { try { root.remove(); } catch (_) {} }, 340);
}

async function loadGameVideoComments(more) {
  if (!_gvcState || _gvcState.loading) return;
  if (more && !_gvcState.nextToken) return;
  _gvcState.loading = true;
  renderGvcBody();
  const token = more ? _gvcState.nextToken : '';
  const vid = _gvcState.videoId;
  try {
    const res = await fetch('/api/youtube/comment-sheet?videoId=' + encodeURIComponent(vid) + (token ? '&pageToken=' + encodeURIComponent(token) : ''), { headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => ({}));
    if (!_gvcState || _gvcState.videoId !== vid) return;
    _gvcState.loading = false;
    if (data && data.ok) {
      if (data.commentsDisabled) { _gvcState.disabled = true; renderGvcBody(); return; }
      _gvcState.items = _gvcState.items.concat(Array.isArray(data.items) ? data.items : []);
      _gvcState.nextToken = data.nextPageToken || '';
    } else {
      _gvcState.error = true;
    }
    renderGvcBody();
  } catch (_) {
    if (_gvcState && _gvcState.videoId === vid) { _gvcState.loading = false; _gvcState.error = true; renderGvcBody(); }
  }
}

function gvcRowHtml(c) {
  const name = escHtml(c.author || 'YouTube user');
  const when = c.publishedAt ? timeAgoGV(Date.parse(c.publishedAt)) : '';
  const avatar = (typeof c.avatar === 'string' && /^https:\/\//i.test(c.avatar)) ? c.avatar : '/default-avatar.svg';
  const text = escHtml(c.text || '').replace(/\n/g, '<br>');
  const likes = Number(c.likeCount || 0) > 0
    ? `<span class="gv-comments-rowlikes"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2 21h4V9H2v12zm20-11a2 2 0 0 0-2-2h-6.3l1-4.6.03-.3a1.5 1.5 0 0 0-.44-1.06L13.2 1 6.6 7.6A2 2 0 0 0 6 9v10a2 2 0 0 0 2 2h9a2 2 0 0 0 1.84-1.22l3-7A2 2 0 0 0 22 12v-2z"/></svg>${formatCompactCountGV(c.likeCount)}</span>`
    : '';
  return `<div class="gv-comments-row"><img class="gv-comments-avatar" src="${escAttr(avatar)}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='/default-avatar.svg'"><div class="gv-comments-rowmain"><div class="gv-comments-rowhead"><span class="gv-comments-author">${name}</span>${when ? `<span class="gv-comments-time">${escHtml(when)}</span>` : ''}</div><div class="gv-comments-text">${text}</div>${likes ? `<div class="gv-comments-rowmeta">${likes}</div>` : ''}</div></div>`;
}

function renderGvcBody() {
  const body = document.querySelector('#gv-comments-root [data-gvc-body]');
  if (!body || !_gvcState) return;
  if (_gvcState.disabled) { body.innerHTML = `<div class="gv-comments-empty">Comments are turned off for this video.</div>`; return; }
  let html = _gvcState.items.map(gvcRowHtml).join('');
  if (!_gvcState.items.length) {
    if (_gvcState.loading) html = `<div class="gv-comments-empty">Loading comments…</div>`;
    else if (_gvcState.error) html = `<div class="gv-comments-empty">Couldn't load comments right now.</div>`;
    else html = `<div class="gv-comments-empty">No comments yet.</div>`;
  }
  if (_gvcState.nextToken) html += `<button class="gv-comments-more" type="button" onclick="loadGameVideoComments(true)">${_gvcState.loading ? 'Loading…' : 'Load more'}</button>`;
  body.innerHTML = html;
}

function attachGvcSwipeDismiss(root) {
  const sheet = root.querySelector('.gv-comments-sheet');
  const head = root.querySelector('.gv-comments-head');
  if (!sheet || !head) return;
  let startY = 0, curY = 0, dragging = false;
  head.addEventListener('touchstart', e => {
    if (!e.touches || e.touches.length !== 1) return;
    startY = e.touches[0].clientY; curY = 0; dragging = true;
    sheet.style.transition = 'none';
  }, { passive: true });
  head.addEventListener('touchmove', e => {
    if (!dragging || !e.touches || !e.touches.length) return;
    curY = Math.max(0, e.touches[0].clientY - startY);
    sheet.style.transform = 'translate3d(0,' + curY + 'px,0)';
  }, { passive: true });
  head.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (curY > 110) closeGameVideoCommentsSheet();
  });
}

// v11.964: game synopsis source chain — IGDB summary (primary, incl. the Steam
// store description the worker folds in when IGDB has none) -> RAWG description
// (tertiary) -> placeholder. IGDB info arrives async, so hydrateGameMediaProfileInfo
// re-applies this to the synopsis element once it loads.
function getGameOverviewText(details = {}) {
  const igdbSummary = String((details && details.igdbInfo && details.igdbInfo.summary) || details.summary || '').trim();
  const rawg = String(details.description_raw || details.description || '').replace(/<[^>]*>/g, '').trim();
  return igdbSummary || rawg || 'No overview is available yet.';
}

function renderGameMediaProfileDetailsModern(details, rawgId = '') {
  const title = getGameTitleValue(details) || 'Game Profile';
  const poster = getGameMediaImage(details);
  const year = String(details.released || '').slice(0, 4);
  const overview = getGameOverviewText(details);
  const genres = (details.genres || []).map(g => g.name).filter(Boolean).slice(0, 4);
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
            <div class="discover-media-score discover-media-score-hero"><span class="discover-media-score-star" aria-hidden="true">★</span><span class="discover-media-score-value">${escHtml(score)}</span></div>
          </div>
        </div>
        <p class="discover-media-synopsis" onclick="this.classList.toggle('expanded')">${escHtml(overview)}</p>
        ${genres.length ? `<div class="discover-media-chips">${genres.map(name => `<span>${escHtml(name)}</span>`).join('')}</div>` : ''}
        ${renderGameProfileFloatingExports(details)}
      </div>
    </div>
    <div class="discover-media-body discover-media-body-cinema">
      ${renderGamePlatformsSectionHtml(details)}
      ${renderGameMediaInfoSectionHtml(details)}
      ${directTrailer ? `<div class="discover-media-detail-grid has-trailer"><div class="discover-media-trailer discover-media-trailer-panel"><video controls playsinline preload="metadata" ${directTrailer.poster ? `poster="${escAttr(directTrailer.poster)}"` : ''}><source src="${escAttr(directTrailer.url)}"></video></div></div>` : ''}
      ${screenshots.length ? `<div class="discover-media-section discover-media-section-cast"><h3>Screenshots</h3><div class="discover-media-similar game-media-screenshots">${screenshots.map(img => `<a class="discover-media-similar-card" href="${escAttr(img.image)}" target="_blank" rel="noopener"><img src="${escAttr(img.image)}" alt=""><span>Screenshot</span></a>`).join('')}</div></div>` : ''}
      ${typeof window.renderUniversalMediaReviewsButton === 'function' ? window.renderUniversalMediaReviewsButton('game', details, rawgId || getGameRawgIdValue(details)) : ''}
      ${renderGameVideosSectionHtml()}
      <div class="discover-media-section steam-achievements-section" id="steam-achievements-section" hidden></div>
      ${renderDeepSeekMoreLikeThisSection('game', details)}
    </div>
  </section>`;
}

/* =============================================================================
   Steam achievements — game media profile (v11.385)
   Fills #steam-achievements-section with the signed-in user's unlock progress
   for this Steam title. The worker gates to SINGLE-PLAYER games (returns
   eligible:false for multiplayer-only titles) and never exposes the API key.
   Requires a linked Steam account + a resolvable Steam App ID.
   ========================================================================== */
const STEAM_ACHIEVEMENTS_INITIAL_VISIBLE = 9;  // v11.433: preset to 9 tiles (header collapses the section; "Show all" reveals the rest)

function getLinkedSteamId() {
  try {
    if (typeof getSteamImportConnection === 'function') return String(getSteamImportConnection().steamId || '').trim();
  } catch (_) {}
  return String(userProfile?.steamConnection?.steamId || '').trim();
}

async function resolveSteamAppIdForGame(details = {}, rawgId = '') {
  const direct = String(details.steamAppId || details.appId || '').trim();
  if (/^\d+$/.test(direct)) return direct;
  const id = String(rawgId || getGameRawgIdValue(details) || '').trim();
  if (id && typeof _resolveRawgSteamId === 'function') {
    try { const resolved = String(await _resolveRawgSteamId(id) || '').trim(); if (/^\d+$/.test(resolved)) return resolved; } catch (_) {}
  }
  return '';
}

function formatSteamUnlockDate(epochSeconds = 0) {
  const ms = Number(epochSeconds || 0) * 1000;
  if (!ms) return '';
  try { return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch (_) { return ''; }
}

function formatSteamRarity(percent) {
  const p = Number(percent);
  if (!Number.isFinite(p)) return '';
  return p >= 10 ? `${Math.round(p)}%` : `${p.toFixed(1)}%`;
}

function renderSteamAchievementTile(a = {}) {
  const achieved = !!a.achieved;
  const rarity = (a.globalPercent === null || a.globalPercent === undefined) ? null : Number(a.globalPercent);
  const isRare = rarity !== null && rarity < 10;
  const name = (a.hidden && !achieved) ? 'Hidden achievement' : (a.name || 'Achievement');
  const desc = (a.hidden && !achieved) ? 'Reveal it by unlocking it in-game.' : (a.description || '');
  const metaBits = [];
  if (achieved) {
    const d = formatSteamUnlockDate(a.unlockTime);
    metaBits.push(d ? `Unlocked ${escHtml(d)}` : 'Unlocked');
  } else {
    metaBits.push('Locked');
  }
  if (rarity !== null) metaBits.push(`<span class="steam-achv-rarity${isRare ? ' is-rare' : ''}">${escHtml(formatSteamRarity(rarity))} of players</span>`);
  return `<div class="steam-achv-tile ${achieved ? 'is-unlocked' : 'is-locked'}${isRare ? ' is-rare' : ''}">
    <span class="steam-achv-icon">${a.iconUrl ? `<img src="${escAttr(a.iconUrl)}" alt="" loading="lazy" decoding="async">` : ''}</span>
    <span class="steam-achv-text">
      <span class="steam-achv-name">${escHtml(name)}</span>
      ${desc ? `<span class="steam-achv-desc">${escHtml(desc)}</span>` : ''}
      <span class="steam-achv-meta">${metaBits.join('<span class="steam-achv-dot" aria-hidden="true">·</span>')}</span>
    </span>
  </div>`;
}

function renderSteamAchievementsMarkup(data = {}) {
  const list = Array.isArray(data.achievements) ? data.achievements : [];
  if (!list.length) return '';
  const total = Number(data.total || list.length);
  const unlocked = Number(data.unlocked || 0);
  const percent = Math.max(0, Math.min(100, Number(data.percent || 0)));
  const initial = list.slice(0, STEAM_ACHIEVEMENTS_INITIAL_VISIBLE);
  const rest = list.slice(STEAM_ACHIEVEMENTS_INITIAL_VISIBLE);
  const privateNote = data.private
    ? `<p class="steam-achv-note">Set your Steam profile's game details to <strong>Public</strong> to track your unlocks here.</p>`
    : '';
  return `<div class="steam-achv-head steam-achv-head-toggle" role="button" tabindex="0" aria-expanded="true" onclick="toggleAchievementsCollapse(this)">
      <h3>Achievements <svg class="achv-collapse-chevron" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path></svg></h3>
      <div class="steam-achv-progress"><span class="steam-achv-count"><strong>${unlocked.toLocaleString('en-US')}</strong> / ${total.toLocaleString('en-US')}</span><span class="steam-achv-percent">${percent}%</span></div>
    </div>
    <div class="steam-achv-bar"><span style="width:${percent}%"></span></div>
    ${privateNote}
    <div class="steam-achv-grid">${initial.map(renderSteamAchievementTile).join('')}</div>
    ${rest.length ? `<div class="steam-achv-grid steam-achv-rest" hidden>${rest.map(renderSteamAchievementTile).join('')}</div>
    <button type="button" class="steam-achv-toggle" onclick="expandSteamAchievements(this)">Show all ${total.toLocaleString('en-US')}</button>` : ''}
    <div class="steam-achv-source">Achievements &amp; rarity via Steam</div>`;
}

function expandSteamAchievements(btn) {
  const section = btn?.closest?.('.steam-achievements-section');
  const rest = section?.querySelector?.('.steam-achv-rest');
  if (rest) rest.hidden = false;
  if (btn) btn.remove();
}

/* v11.433: collapse/expand the whole achievements grid from its header. Default
   is expanded (9 tiles preset visible); tapping "Achievements" collapses the
   tiles (header + progress summary stay), tapping again restores them. Works for
   both the My List game profile and the discovery game profile. */
function toggleAchievementsCollapse(headEl) {
  const section = headEl && headEl.closest && headEl.closest('.mylist-game-profile-achievements, .steam-achievements-section');
  if (!section) return;
  const collapsed = section.classList.toggle('achv-collapsed');
  try { headEl.setAttribute('aria-expanded', collapsed ? 'false' : 'true'); } catch (e) {}
}
window.toggleAchievementsCollapse = toggleAchievementsCollapse;

async function hydrateSteamAchievements(details = {}, rawgId = '') {
  const section = document.getElementById('steam-achievements-section');
  if (!section) return;
  const steamId = getLinkedSteamId();
  if (!steamId) { section.hidden = true; return; }
  const appId = await resolveSteamAppIdForGame(details, rawgId);
  if (!appId) { section.hidden = true; return; }
  if (document.getElementById('steam-achievements-section') !== section) return;
  try {
    const res = await fetch(`/api/steam/achievements?appid=${encodeURIComponent(appId)}&steamId=${encodeURIComponent(steamId)}`);
    const data = await res.json();
    const live = document.getElementById('steam-achievements-section');
    if (!live) return;
    // Single-player only, must have achievements, and we must have the user's
    // own data (owned + readable) OR a private profile worth nudging public.
    const show = data && data.ok && data.eligible && data.hasAchievements && (data.hasPlayerData || data.private);
    if (!show) { live.hidden = true; return; }
    live.innerHTML = renderSteamAchievementsMarkup(data);
    live.hidden = false;
  } catch (_) {
    const s = document.getElementById('steam-achievements-section');
    if (s) s.hidden = true;
  }
}

function bindGameMediaProfileActions(overlay) {
  if (!overlay) return;
  bindDiscoverMediaProfileSwipeBack(overlay);
  if (!overlay.dataset.libraryDockOutsideBound) {
    overlay.dataset.libraryDockOutsideBound = 'true';
    overlay.addEventListener('click', (event) => {
      const dock = overlay.querySelector('.discover-media-library-dock');
      if (!dock) return;
      if (dock.contains(event.target) || event.target.closest('.discover-media-add-floating')) return;
      closeDiscoverMediaLibraryDock();
    });
  }
  if (!overlay.dataset.libraryDockTriggerBound) {
    overlay.dataset.libraryDockTriggerBound = 'true';
    overlay.addEventListener('click', (event) => {
      const addButton = event.target?.closest?.('.discover-media-add-floating');
      if (!addButton || !overlay.contains(addButton)) return;
      const type = String(addButton.dataset.discoverType || '').trim();
      const id = String(addButton.dataset.discoverId || '').trim();
      if (type !== 'game' || !id || addButton.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      showDiscoverMediaLibraryDock(addButton);
    });
  }
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
  if (transitionOrigin && typeof transitionOrigin.closest === 'function' && transitionOrigin.closest('.mylist-game-profile-page')) {
    overlay.classList.add('game-media-profile-from-competitive');
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
      hydrateSteamAchievements(mergedGameDetails, getGameRawgIdValue(mergedGameDetails));
      hydrateGameMediaProfileInfo(overlay, mergedGameDetails);
      hydrateGameVideos(overlay, mergedGameDetails);
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
    hydrateSteamAchievements(mergedGameDetails, getGameRawgIdValue(mergedGameDetails));
    hydrateGameMediaProfileInfo(overlay, mergedGameDetails);
    hydrateGameVideos(overlay, mergedGameDetails);
} catch (e) {
    console.error('Game media profile failed:', e);
    if (!document.getElementById('discover-media-profile')) return;
    const fallbackRawgId = rawgId || getGameRawgIdValue(initialSeed);
    const mergedGameDetails = await attachGameTrailerToDetails(await ensureScreenListIgdbCoverOnGameDetails({ ...initialSeed, rawgId: fallbackRawgId }), fallbackRawgId);
    overlay.innerHTML = renderGameMediaProfileDetailsModern(mergedGameDetails, fallbackRawgId);
    bindGameMediaProfileActions(overlay);
    hydrateGameMediaProfileTrailerPreview(overlay);
    hydrateDeepSeekMoreLikeThis('game', mergedGameDetails);
    hydrateSteamAchievements(mergedGameDetails, getGameRawgIdValue(mergedGameDetails));
    hydrateGameMediaProfileInfo(overlay, mergedGameDetails);
    hydrateGameVideos(overlay, mergedGameDetails);
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

async function openLibraryMediaProfile(event, itemId, sectionOverride = '', options = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const section = sectionOverride || activeSection;
  if (section === 'games') return openGameMediaProfileFromLibrary(event, itemId, section);
  if (!canOpenLibraryMediaProfile(section)) return;

  const visibleData = getVisibleListData();
  const item = (visibleData[section] || []).find(entry => String(entry.id) === String(itemId));
  if (!item) return;

  const type = section === 'movies' ? 'movie' : 'tv';
  const profileOptions = options && typeof options === 'object' ? options : null;
  const transitionOrigin = profileOptions?.transitionOrigin || event?.currentTarget || null;
  let tmdbId = String(item.tmdbId || item.tmdb_id || '').trim();
  if (section === 'anime') {
    let malId = getMyListAnimeMalId(item);
    if (!malId) {
      try { malId = await hydrateLibraryAnimeIdentityForProfile(item); }
      catch (error) { console.warn('Anime profile identity hydration failed:', error); }
    }
    if (malId && typeof window.openJikanAnimeProfile === 'function') {
      setDiscoverMediaProfileSeed('tv', `mal:${malId}`, buildLibraryAnimeJikanSeed(item, malId));
      return window.openJikanAnimeProfile(event, malId, transitionOrigin, profileOptions);
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

  openDiscoverMediaProfile(event, type, tmdbId, transitionOrigin, profileOptions);
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

function showShelfdAddedToShelfPrompt(options = {}) {
  const existing = document.querySelector('.shelfd-added-to-shelf-prompt');
  if (existing) existing.remove();
  const prompt = document.createElement('div');
  prompt.className = 'shelfd-added-to-shelf-prompt';
  prompt.setAttribute('role', 'status');
  prompt.setAttribute('aria-live', 'polite');
  prompt.innerHTML = `
    <span class="shelfd-added-to-shelf-prompt-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4 4 10-10"/></svg>
    </span>
    <span class="shelfd-added-to-shelf-prompt-text">${escHtml(options.message || 'Added to shelf')}</span>
  `;
  document.body.appendChild(prompt);
  requestAnimationFrame(() => prompt.classList.add('is-open'));
  setTimeout(() => {
    prompt.classList.remove('is-open');
    setTimeout(() => { try { prompt.remove(); } catch (_) {} }, 240);
  }, Number(options.durationMs || 1900));
}
window.showShelfdAddedToShelfPrompt = showShelfdAddedToShelfPrompt;

function showMyListGameProfileSavedModal(options = {}) {
  const existing = document.querySelector('.mylist-game-profile-saved-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.className = 'mylist-game-profile-saved-modal';
  modal.setAttribute('role', 'status');
  modal.setAttribute('aria-live', 'polite');
  modal.innerHTML = `
    <div class="mylist-game-profile-saved-modal-card">
      <span class="mylist-game-profile-saved-modal-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4 4 10-10"/></svg>
      </span>
      <span>${escHtml(options.message || 'Game profile saved')}</span>
    </div>
  `;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('is-open'));
  setTimeout(() => {
    modal.classList.remove('is-open');
    setTimeout(() => { try { modal.remove(); } catch (_) {} }, 220);
  }, Number(options.durationMs || 1700));
}
window.showMyListGameProfileSavedModal = showMyListGameProfileSavedModal;

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

function triggerShelfdLibraryAddFeedback() {
  try { playLibraryAddPopSound(); } catch (_) {}
  try {
    const Haptics = window.Capacitor?.Plugins?.Haptics;
    if (Haptics?.impact) Haptics.impact({ style: 'LIGHT' }).catch?.(() => {});
    if (Haptics?.notification) {
      window.setTimeout(() => {
        try { Haptics.notification({ type: 'SUCCESS' }).catch?.(() => {}); } catch (_) {}
      }, 42);
    }
  } catch (_) {}
  try {
    if (navigator?.vibrate) navigator.vibrate([12, 24, 18]);
  } catch (_) {}
}
if (typeof window !== 'undefined') window.triggerShelfdLibraryAddFeedback = triggerShelfdLibraryAddFeedback;

function getShelfLogGameVerifyKeys(item = {}) {
  const keys = new Set();
  [
    item.id,
    item.rawgId ? `rawg:${item.rawgId}` : '',
    item.igdbId ? `igdb:${item.igdbId}` : '',
    item.sourceId ? `${item.source || 'source'}:${item.sourceId}` : '',
    item.gameIdentityKey,
    item.shelfdGameIdentityLock?.key
  ].forEach(value => {
    const key = String(value || '').trim().toLowerCase();
    if (key) keys.add(key);
  });
  return keys;
}

function shelfLogGameMatchesPersistedItem(expected = {}, candidate = {}) {
  if (!expected || !candidate) return false;
  const expectedKeys = getShelfLogGameVerifyKeys(expected);
  const candidateKeys = getShelfLogGameVerifyKeys(candidate);
  for (const key of expectedKeys) {
    if (candidateKeys.has(key)) return true;
  }
  const expectedTitle = String(expected.title || expected.name || '').trim().toLowerCase();
  const candidateTitle = String(candidate.title || candidate.name || '').trim().toLowerCase();
  return !!expectedTitle && expectedTitle === candidateTitle;
}

async function readOwnGamesSectionFromFirestoreServer() {
  if (!currentUser?.uid || typeof db === 'undefined' || !db) {
    throw new Error('No signed-in user is available for library save verification.');
  }
  const ref = db.collection('watchlist').doc(currentUser.uid).collection('sections').doc('games');
  const snap = await ref.get({ source: 'server' });
  if (!snap.exists) return [];
  const doc = snap.data() || {};
  return parseWatchlistSectionDocJson(doc.data || '');
}

async function verifyShelfLogGameLibraryItemPersisted(expectedItem = {}, expectedData = null, options = {}) {
  if (!expectedItem || !currentUser?.uid) return true;
  const retryData = expectedData ? cloneListData(expectedData) : null;
  const readAndMatch = async () => {
    const serverGames = await readOwnGamesSectionFromFirestoreServer();
    return serverGames.some(game => shelfLogGameMatchesPersistedItem(expectedItem, game));
  };
  if (await readAndMatch()) return true;
  if (retryData && typeof persistOwnDataToFirestore === 'function') {
    await persistOwnDataToFirestore(retryData, { ...options, verify: false, verifyGameItem: null, sections: ['games'] });
    if (await readAndMatch()) return true;
  }
  throw new Error(`Game library save verification failed for "${expectedItem.title || expectedItem.name || expectedItem.id || 'game'}".`);
}

async function persistShelfLogGameDataServerFirst(nextData = null, expectedItem = null) {
  const safeData = typeof compactImportedAnimeForStorage === 'function'
    ? compactImportedAnimeForStorage(nextData || data)
    : cloneListData(nextData || data);
  if (typeof saveTimeout !== 'undefined' && saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  if (typeof persistOwnDataToFirestore !== 'function') {
    throw new Error('Library save service is not loaded yet.');
  }
  await persistOwnDataToFirestore(safeData, { verify: false, sections: ['games'] });
  if (expectedItem) await verifyShelfLogGameLibraryItemPersisted(expectedItem, safeData, { verify: true });
  data = cloneListData(safeData);
  ownDataCache = cloneListData(safeData);
  try {
    if (currentUser) localStorage.setItem('screenlist-own-data-backup-' + currentUser.uid, JSON.stringify(safeData));
    else localStorage.setItem('watchlist-tracker-data', JSON.stringify(safeData));
  } catch (lsErr) {
    console.warn('[v10.853] local library backup write failed after server-first save:', lsErr && lsErr.name, lsErr && lsErr.message);
  }
  if (currentUser?.uid === CREATOR_PUBLIC_UID && typeof syncCreatorPublicProfileMirror === 'function') {
    Promise.resolve()
      .then(() => syncCreatorPublicProfileMirror(currentUser, userProfile, null, {
        clearListData: true,
        includeListData: false,
        reason: 'persistShelfLogGameDataServerFirst'
      }))
      .catch(mirrorErr => console.warn('[v10.853] creator mirror sync failed after server-first save:', mirrorErr));
  }
  return safeData;
}

function markShelfLogMediaProfileButtonAdded(btn) {
  if (!btn) return;
  if (typeof markDiscoverButtonAdded === 'function') {
    markDiscoverButtonAdded(btn, 'watched');
    return;
  }
  btn.classList.add('added');
  btn.disabled = false;
  btn.innerHTML = `<svg class="discover-media-add-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4 4 10-10"/></svg>`;
  btn.setAttribute('aria-label', 'Manage this title in your library');
  btn.title = 'Manage this title in your library';
}

function markShelfLogNewMediaProfileButtonsAdded(draft = {}, item = {}) {
  const knownIds = new Set([
    draft.tmdbId,
    item.id,
    item.rawgId,
    item.igdbId ? `igdb:${item.igdbId}` : '',
    item.sourceId,
    item.gameIdentityKey
  ].map(value => String(value || '').trim()).filter(Boolean));
  const title = String(item.title || item.name || draft.sourceItem?.title || '').trim().toLowerCase();
  if (draft.fpmpBtn) markShelfLogMediaProfileButtonAdded(draft.fpmpBtn);
  document.querySelectorAll('.discover-media-add-floating').forEach(btn => {
    const btnType = String(btn.dataset.discoverType || '').toLowerCase();
    if (draft.type && btnType && btnType !== String(draft.type).toLowerCase()) return;
    const btnId = String(btn.dataset.discoverId || '').trim();
    const btnTitle = String(btn.dataset.discoverTitle || '').trim().toLowerCase();
    if ((btnId && knownIds.has(btnId)) || (title && btnTitle === title)) {
      markShelfLogMediaProfileButtonAdded(btn);
    }
  });
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
  const input = document.getElementById("mylist-search-input-inline") || document.querySelector(".search-input");
  if (input) input.value = "";
  const row = document.getElementById("mylist-search-row");
  if (row) {
    row.hidden = true;
    row.classList.remove('is-open', 'is-closing');
  }
  const btn = document.getElementById("mylist-search-toggle-btn");
  if (btn) {
    btn.classList.remove('mylist-search-toggle-active');
    btn.setAttribute('aria-expanded', 'false');
  }
  _mylistSearchOpen = false;
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
// v11.062: order MUST mirror the visible tab bar in index.html
// (games · anime · manga · music · movies · shows) so a multi-tab swipe slides
// through the correct real pages in the correct order. Previously this list was
// missing 'music' (so swipes skipped it entirely) and included a non-existent
// 'books' tab. getShelfdVisibleMyListPagerOrder() still filters to whatever the
// user actually has enabled.
const SHELFD_MYLIST_PAGER_ORDER = ['games', 'anime', 'manga', 'music', 'movies', 'shows'];
let _shelfdMyListPagerActive = false;
let _shelfdMyListPagerCancel = null;

function getShelfdVisibleMyListPagerOrder() {
  return SHELFD_MYLIST_PAGER_ORDER.filter(section => {
    try { return isSectionVisibleInMyLists(section); } catch (e) { return true; }
  });
}

function runMyListSectionPagerTransition(prevSection, nextSection, switchCallback) {
  const stage = document.getElementById('mylist-stage');
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (_shelfdMyListPagerActive && typeof _shelfdMyListPagerCancel === 'function') {
    _shelfdMyListPagerCancel();
  }
  if (!stage || reduceMotion) {
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

  /* v11.064: only TWO pages are rendered with real content — the one you're
     leaving (prev, already live = free) and the destination (next, rendered
     once via switchCallback). Sections the swipe merely PASSES OVER are no
     longer rendered at all: rendering up to 4 extra section pages synchronously
     was what delayed the slide from even starting on long cross-category jumps
     (the hitch). Instead each pass-through panel shows a heavily blurred,
     dimmed clone of the current page — at 300ms these flash by too fast to read,
     so a blurred "page whooshing past" is indistinguishable from the real
     thing and costs nothing to produce. */
  const prevStageHeight = Math.max(stage.offsetHeight, 1);
  const prevSnapshot = stage.cloneNode(true);
  sanitizeSnapshot(prevSnapshot);

  if (typeof switchCallback === 'function') switchCallback();

  const nextSnapshot = stage.cloneNode(true);
  sanitizeSnapshot(nextSnapshot);

  // Take the taller of prev/next so neither real page clips during the slide.
  const stageHeight = Math.max(prevStageHeight, stage.offsetHeight, 1);

  const overlay = document.createElement('div');
  overlay.className = 'mylist-pager-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.height = stageHeight + 'px';

  const track = document.createElement('div');
  track.className = 'mylist-pager-track';
  /* v11.063: dark gutter between category pages during the swipe so adjacent
     sections read as distinct cards sliding past instead of one flush sheet.
     The gap shows the app background through the transparent overlay and is
     off-screen when resting on a page. Each slide step is therefore one panel
     (100%) PLUS one gutter, which the transform calc below accounts for so the
     track still lands dead-center on the target panel. */
  const PAGER_GAP_PX = 16.2;
  track.style.gap = PAGER_GAP_PX + 'px';

  for (let i = startIdx; i <= endIdx; i++) {
    const panel = document.createElement('div');
    panel.className = 'mylist-pager-panel';
    if (i === prevIdx) {
      panel.classList.add('mylist-pager-panel-prev');
      panel.appendChild(prevSnapshot);
    } else if (i === nextIdx) {
      panel.classList.add('mylist-pager-panel-next');
      panel.appendChild(nextSnapshot);
    } else {
      // Pass-through page — blurred clone of the current page, never a fresh render().
      panel.classList.add('mylist-pager-panel-mid');
      panel.appendChild(prevSnapshot.cloneNode(true));
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
  track.style.transform = `translate3d(calc(${-prevPanelOffset} * (100% + ${PAGER_GAP_PX}px)), 0, 0)`;
  void track.offsetWidth;

  /* v11.065: flat 450ms slide. */
  const duration = 450;
  /* v11.065: short cross-fade at the END of the slide. The destination panel is
     a frozen clone captured the instant render() finished — before the live
     cards settle their final dimensions — so swapping straight to the live page
     made the card contents visibly "snap"/resize. Instead, when the slide ends
     we reveal the now-settled live page UNDERNEATH the overlay and fade the
     frozen clone out over it, so the handoff is invisible. */
  const FADE_MS = 160;

  let cleaned = false;
  const restoreLiveStage = () => {
    Array.from(stage.children).forEach(child => {
      if (child === overlay) return;
      child.style.visibility = child.dataset._shelfdPagerVisibility || '';
      delete child.dataset._shelfdPagerVisibility;
    });
  };
  _shelfdMyListPagerCancel = () => {
    if (cleaned) return;
    cleaned = true;
    restoreLiveStage();
    try { overlay.remove(); } catch (_) {}
    _shelfdMyListPagerActive = false;
    _shelfdMyListPagerCancel = null;
  };
  const revealAndCleanup = () => {
    if (cleaned) return;
    cleaned = true;
    // Reveal the real (settled) destination page beneath the clone overlay.
    restoreLiveStage();
    // Cross-fade the frozen clone out over the live page to mask the snap.
    let removed = false;
    const finish = () => {
      if (removed) return;
      removed = true;
      overlay.remove();
      _shelfdMyListPagerActive = false;
      _shelfdMyListPagerCancel = null;
    };
    overlay.style.transition = `opacity ${FADE_MS}ms ease`;
    overlay.addEventListener('transitionend', (e) => { if (e.propertyName === 'opacity') finish(); });
    requestAnimationFrame(() => { overlay.style.opacity = '0'; });
    setTimeout(finish, FADE_MS + 140);
  };

  requestAnimationFrame(() => {
    track.style.transition = `transform ${duration}ms cubic-bezier(.22, 1, .36, 1)`;
    track.style.transform = `translate3d(calc(${-nextPanelOffset} * (100% + ${PAGER_GAP_PX}px)), 0, 0)`;
    track.addEventListener('transitionend', function onEnd(e) {
      if (e.propertyName !== 'transform') return;
      track.removeEventListener('transitionend', onEnd);
      revealAndCleanup();
    });
    setTimeout(revealAndCleanup, duration + 220);
  });
}

// Actions
function switchSection(s) {
  if (typeof clearLastEditedResortHold === 'function') clearLastEditedResortHold();
  if (!isSectionVisibleInMyLists(s)) return;
  if (activeSection === s) return;
  const prevSection = activeSection;
  closeSortDropdown();
  activeSection = s;
  activeTab = getDefaultTabForSection(s);
  if (s === 'games') activeGamePlayingFilter = 'live';
  syncMyListSectionButtonState(s);
  requestAnimationFrame(() => updateSlidingPills());
  runMyListSectionPagerTransition(prevSection, s, () => {
    /* v10.241: tag <body> with the active section so CSS can hide the status
       toolbar and other per-section chrome (e.g. music has no statuses). */
    try {
      ['movies','shows','anime','games','manga','books','music'].forEach(sec => {
        document.body.classList.toggle('mylist-section-' + sec, sec === activeSection);
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

/* v11.403: synchronous tab commit used by the status-swipe gesture (js/40).
   switchTab defers its render by a frame-locked page jump, which — combined
   with the swipe dropping its preview layer — flashed the OLD page for a beat
   before the new one rendered. The swipe needs the new content in #cards-grid
   SYNCHRONOUSLY (while it's still translated off-screen, behind the preview) so
   the handoff is seamless. No scroll jump (matches a normal tab tap). */
/* v11.428: append the cards the capped swipe-commit render deferred. Runs AFTER
   the settle, so the heavy part of a big tab (e.g. Watched-50) never lands on the
   animation. Appends [startIndex, fullLimit) to the existing grid (the first N
   are already the adopted, decoded cards) — off-screen + lazy, no flash. */
function fillMyListSwipeRemainder(pending) {
  try {
    if (!pending) return;
    /* never mutate the grid mid-swipe — if another gesture/settle is in flight,
       wait it out and try again (prevents a layout/paint hitch during motion). */
    if (document.body.classList.contains('mylist-status-swiping')) {
      if (_swipeFillTimer) clearTimeout(_swipeFillTimer);
      _swipeFillTimer = setTimeout(function () { _swipeFillTimer = null; fillMyListSwipeRemainder(pending); }, 120);
      return;
    }
    const grid = document.getElementById('cards-grid');
    if (!grid) return;
    // only fill if we're STILL on the exact view the cap was made for
    if (getMyListRenderLimitKey(getActiveSortKey()) !== pending.key) return;
    const built = buildMyListCardsHTMLForActiveTab(pending.fullLimit, pending.startIndex);
    if (built && built.html) grid.insertAdjacentHTML('beforeend', built.html);
    if (typeof renderMyListLoadMoreControl === 'function') {
      renderMyListLoadMoreControl(pending.fullLimit, pending.total, pending.key);
    }
  } catch (e) {}
}

function commitMyListStatusSwipeTab(t, visibleCap) {
  if (typeof clearLastEditedResortHold === 'function') clearLastEditedResortHold();
  if (!isVisibleMyListStatusTab(t, activeSection)) return false;
  const nextTab = activeSection === 'games' && t === 'live' ? 'watching' : t;
  activeTab = nextTab;
  if (activeSection === 'games' && (t === 'watching' || t === 'live')) activeGamePlayingFilter = 'live';
  if (typeof closeSortDropdown === 'function') closeSortDropdown();
  /* render only the visible cards now (light landing); the rest is appended after
     the settle. visibleCap is the preview's visible-card count, from js/40. */
  _swipeCommitVisibleCap = (typeof visibleCap === 'number' && visibleCap > 1) ? Math.floor(visibleCap) : 0;
  _swipeRenderFillPending = null;
  render();
  _swipeCommitVisibleCap = 0;
  const pending = _swipeRenderFillPending;
  _swipeRenderFillPending = null;
  if (pending) {
    if (_swipeFillTimer) clearTimeout(_swipeFillTimer);
    _swipeFillTimer = setTimeout(function () { _swipeFillTimer = null; fillMyListSwipeRemainder(pending); }, 90);
  }
  try { if (typeof persistUiState === 'function') persistUiState(); } catch (e) {}
  requestAnimationFrame(() => { try { if (typeof updateSlidingPills === 'function') updateSlidingPills(); } catch (e) {} });
  return true;
}
window.commitMyListStatusSwipeTab = commitMyListStatusSwipeTab;

// ── My Lists swipe-between-status-tabs removed ────────────────────────────────
// V300: Status-page swiping is fully disabled for mobile/PWA. Previous swipe
// handlers/rails could intercept title-card taps, episode checks, status buttons,
// and star ratings. Status changes now happen only through visible buttons/tabs.
let _swPillLock = false;
/* v11.425: let the status-swipe module (js/40) take over the sliding underline
   during a finger drag / settle without updateSlidingPills snapping it back. */
window.__setMyListSwipePillLock = function (v) { _swPillLock = !!v; };

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
const SCREENLIST_IGDB_PROFILE_COVER_SIZE = 'cover_big_2x';
function isScreenListIgdbCoverUrl(value = '') {
  return /images\.igdb\.com\/igdb\/image\/upload/i.test(String(value || ''));
}
function getScreenListIgdbCoverUrlAtSize(value = '', size = SCREENLIST_IGDB_PROFILE_COVER_SIZE) {
  const clean = String(value || '').trim();
  if (!clean || !isScreenListIgdbCoverUrl(clean)) return clean;
  const cleanSize = String(size || SCREENLIST_IGDB_PROFILE_COVER_SIZE).replace(/^t_/, '').replace(/[^a-z0-9_]+/gi, '') || SCREENLIST_IGDB_PROFILE_COVER_SIZE;
  return clean.replace(/\/t_[^/]+\//i, `/t_${cleanSize}/`);
}
function isScreenListAllowedGameCoverUrl(value = '') {
  return /^(https?:|data:image\/)/i.test(String(value || '').trim());
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
function getScreenListHighQualityGameCover(item = {}) {
  const cover = getScreenListPreferredGameCover(item);
  return isScreenListIgdbCoverUrl(cover) ? getScreenListIgdbCoverUrlAtSize(cover) : cover;
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
  const coverUrl = getScreenListIgdbCoverUrlAtSize(cover?.coverUrl || '');
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
  const incomingCoverUrl = String(cover?.coverUrl || cover?.url || '').trim();
  const coverUrl = isScreenListIgdbCoverUrl(incomingCoverUrl) ? getScreenListIgdbCoverUrlAtSize(incomingCoverUrl) : incomingCoverUrl;
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
  if (isShowSection(record.section) && status === "watched" && Array.isArray(item.episodes) && item.episodes.length) {
    const futureEpisodes = item.episodes.filter(ep => ep && isScreenListFutureEpisodeLocked(item, ep));
    if (futureEpisodes.length) {
      showScreenListFutureEpisodeToast(item, futureEpisodes);
      return null;
    }
  }
  item.status = status;
  const hasRatingEdit = rating !== null && rating !== undefined && Number(rating || 0) > 0;
  if (hasRatingEdit) {
    item.rating = Number(rating || 0);
    /* v11.421: a high in-app rating is the strongest positive signal — the ideal
       moment to ask for an App Store review (gated/throttled inside the module;
       safe no-op on web + until the native plugin ships). */
    if (item.rating >= 4 && window.shelfdReview) {
      try { window.shelfdReview.maybeRequestReview({ source: 'rating' }); } catch (_) {}
    }
  }
  if (hasRatingEdit && typeof markOwnItemLastEdited === 'function') markOwnItemLastEdited(item, record.section);
  else touchItem(item);
  if (isShowSection(record.section)) {
    const total = Number(item.totalEps || item.totalEpisodes || item.episodes?.length || 0);
    if (Array.isArray(item.episodes) && item.episodes.length) {
      if (status === "watched") getScreenListReleasedEpisodesForMarking(item, item.episodes).forEach(e => e.watched = true);
      /* v11.714: moving an episodic title back to Watchlist means "waiting for a
         future season", not "erase watched history". Preserve per-episode state
         for shows/anime so caught-up titles like House of the Dragon can sit in
         Watchlist while keeping completed seasons intact. */
      item.currentEp = item.episodes.filter(e => e && e.watched).length;
      item.totalEpisodes = item.episodes.length;
      item.totalEps = item.episodes.length;
    } else {
      if (status === "watched") item.currentEp = total;
      if (status === "planned") item.currentEp = Math.max(0, Math.min(total || Infinity, Number(item.currentEp || item.watchedEpisodes || 0) || 0));
    }
  }
  save();
  render();
  if (isMyListEpisodePageOpen(id)) rerenderMyListEpisodePage();
  return item;
}

function changeStatus(id, status) {
  const record = findOwnLibraryItemRecord(id, getMyListSearchContextSection() || activeSection);
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
  const changedItem = applyMyListStatusChange(id, status, null, record.section);
  if (!changedItem) return;
  if (status === "watched" && !wasCompleted) {
    try {
      if (typeof openShelfLogComposer === 'function') {
        openShelfLogComposer(id, record.section);
      }
    } catch (e) {
      console.warn('[v10.704] openShelfLogComposer after status change failed:', e);
    }
    /* v11.421: finishing something (Watched / Played / Listened all map to the
       `watched` enum) is a positive moment → consider an App Store review prompt.
       The module waits for a calm screen (so it lands AFTER the review composer
       that just opened, not over it) and skips if the user ends up rating it low.
       Reads item.rating at fire time so it reflects whatever they enter. */
    if (window.shelfdReview) {
      try {
        window.shelfdReview.maybeRequestReview({
          source: 'completion',
          ratingProbe: function () { return Number((item && item.rating) || 0); }
        });
      } catch (_) {}
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

  const sectionAtDelete = getMyListSearchContextSection(btn) || activeSection;
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

  const record = getMyListEpisodeInteractionContext(itemId, getMyListSearchContextSection() || activeSection);
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

  /* v11.473: the post-rating "Rating updated privately" bottom toast (with its
     one-tap "Post update" button) has been REMOVED per product direction — editing
     a rating on any Shelf card now updates silently, with no toast popping up at the
     bottom of the screen. The edit is still kept private (no automatic activity
     post); it simply no longer surfaces a toast. showRatingEditPrivateToast /
     shelfdPostRatingEditUpdate and their timer/state were deleted with it. */
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
  /* v11.041: allow scrubbing down to 0 (no rating) — all stars unlit
     and the preview label reads empty at 0. */
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
  label.textContent = val > 0 ? formatRatingValueForSection(val, section) : '';
}
function starsTouchEnd(e) {
  const c = e.currentTarget;
  if (c.dataset.scrubbing !== 'true') return;
  const val = parseInt(c.dataset.scrubVal || 0);
  /* v11.041: val 0 is allowed — releasing at 0 commits "no rating". */
  e.preventDefault();
  rate(c.dataset.itemId, c.dataset.prefix, val);
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
  const itemId = check.dataset?.mylistItemId || '';
  const item = itemId ? getMyListEpisodeInteractionContext(itemId)?.item : null;
  const locked = !!(item && !ep.watched && isScreenListFutureEpisodeLocked(item, ep));
  row.classList.toggle('future-locked-ep', locked);
  if ('disabled' in check) check.disabled = locked;
  check.setAttribute('aria-disabled', locked ? 'true' : 'false');
  if (locked) {
    const unlockDate = getScreenListEpisodeUnlockDate(item, ep);
    const label = unlockDate && typeof formatMyListNextEpisodeDate === 'function' ? formatMyListNextEpisodeDate(unlockDate) : unlockDate;
    check.setAttribute('title', label ? `Available ${label}` : 'Available when released');
  } else {
    check.removeAttribute('title');
  }
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
  const wantsMark = watched < seasonEpisodes.length;
  const canMarkReleased = canMarkAnyScreenListEpisodeWatched(item, seasonEpisodes);
  actionBtn.textContent = wantsMark ? 'Mark all' : 'Clear all';
  actionBtn.disabled = !!(wantsMark && !canMarkReleased);
  actionBtn.setAttribute('aria-disabled', actionBtn.disabled ? 'true' : 'false');
  if (actionBtn.disabled) actionBtn.setAttribute('title', 'Episodes unlock when this season releases');
  else actionBtn.removeAttribute('title');
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
  if (!ep.watched && isScreenListFutureEpisodeLocked(item, ep)) {
    showScreenListFutureEpisodeToast(item, [ep]);
    return;
  }
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
      const affectedEpisodes = val ? getScreenListReleasedEpisodesForMarking(item, item.episodes) : item.episodes;
      if (val && !affectedEpisodes.length) {
        showScreenListFutureEpisodeToast(item, item.episodes);
        return;
      }
      const newlyWatched = affectedEpisodes.filter(e => !e.watched).length;
      affectedEpisodes.forEach(e => e.watched = val);
      if (val) {
        markEpisodeWatchActivity(item, section, { count: Math.max(1, newlyWatched), label: 'all released episodes watched' });
        // v553: mark each season finished
        new Set(affectedEpisodes.map(ep => ep.seasonNum).filter(Boolean)).forEach(sn => {
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
let _mylistSearchCloseTimer = null;
function ensureMyListSearchComposerPlacement() {
  const row = document.getElementById('mylist-search-row');
  const btn = document.getElementById('mylist-search-toggle-btn');
  const toolbarRight = document.querySelector('#mylist-toolbar .toolbar-right');
  if (!row || !btn || !toolbarRight) return row;
  if (row.parentElement !== toolbarRight || row.nextElementSibling !== btn) {
    toolbarRight.insertBefore(row, btn);
  }
  return row;
}
function toggleMyListSearch() {
  const row   = ensureMyListSearchComposerPlacement();
  const input = document.getElementById('mylist-search-input-inline');
  const btn   = document.getElementById('mylist-search-toggle-btn');
  if (!row) return;
  _mylistSearchOpen = !_mylistSearchOpen;
  if (btn) btn.classList.toggle('mylist-search-toggle-active', _mylistSearchOpen);
  if (btn) btn.setAttribute('aria-expanded', _mylistSearchOpen ? 'true' : 'false');
  window.clearTimeout(_mylistSearchCloseTimer);
  if (_mylistSearchOpen) {
    row.hidden = false;
    row.classList.remove('is-closing');
    requestAnimationFrame(() => row.classList.add('is-open'));
    /* Focus with rAF so iOS keyboard appears inside the gesture chain. */
    requestAnimationFrame(() => { try { input?.focus({ preventScroll: false }); } catch (_) { input?.focus(); } });
  } else {
    row.classList.remove('is-open');
    row.classList.add('is-closing');
    /* Clear search state when closing. */
    if (input) input.value = '';
    onSearch('');
    _mylistSearchCloseTimer = window.setTimeout(() => {
      if (_mylistSearchOpen) return;
      row.hidden = true;
      row.classList.remove('is-closing');
    }, 230);
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

/* v11.971: the bottom-left toggle flips between a first-time watch (eye glyph)
   and a rewatch (circular-replay glyph + centered play triangle). Both the icon
   and the label swap so the state is obvious at a glance. */
const SHELF_LOG_FIRST_TIME_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.5"/></svg>';
const SHELF_LOG_REWATCH_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.6 5 2.6 10 7.6 10"/><path d="M4.7 14.6a8 8 0 1 0 1.8-8.4L2.6 10"/><path d="M10.2 9.2 15.3 12.2 10.2 15.2z" fill="currentColor" stroke="none"/></svg>';

function shelfLogFirstTimeButtonInner(isFirstTime) {
  const glyph = isFirstTime ? SHELF_LOG_FIRST_TIME_GLYPH : SHELF_LOG_REWATCH_GLYPH;
  const label = isFirstTime ? 'First-time watch' : 'Rewatch';
  return `${glyph}<span data-shelf-log-firsttime-label>${label}</span>`;
}

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
let shelfLogComposerSaving = false;
/* v10.788: holds a pending draft when the user opens the composer from
   the FPMP Watched flow BEFORE the item is added to their library. The
   media is only persisted when the user taps Save in the composer; if
   they tap Cancel (or background the page), this clears with no library
   add. Shape: { type, tmdbId, fpmpBtn, section, draftItem } */
let shelfLogComposerDraft = null;

function resolveShelfLogDraftSourceItem(type = '', cleanId = '', fpmpBtn = null) {
  const sourceType = String(type || '').toLowerCase();
  const id = String(cleanId || '').trim();
  const fromSeed = sourceType === 'game' && typeof getGameMediaProfileSeed === 'function'
    ? (getGameMediaProfileSeed(id, {}) || {})
    : {};
  const title = fpmpBtn?.dataset?.discoverTitle || fromSeed.title || fromSeed.name || '';
  const poster = fpmpBtn?.dataset?.discoverPoster || getGameMediaImage(fromSeed) || '';
  if (sourceType !== 'game') return { ...fromSeed, title, name: title, cover: poster, poster };
  const rawgId = typeof getShelfdGameIdentityRawgId === 'function'
    ? getShelfdGameIdentityRawgId({ ...fromSeed, id })
    : String(fromSeed.rawgId || (/^\d+$/.test(id) ? id : '') || '').trim();
  const igdbId = typeof getShelfdGameIdentityIgdbId === 'function'
    ? getShelfdGameIdentityIgdbId({ ...fromSeed, id })
    : String(fromSeed.igdbId || (id.match(/^igdb:(\d+)$/i)?.[1] || '') || '').trim();
  const sourceItem = {
    ...fromSeed,
    id: id || fromSeed.id || rawgId || (igdbId ? `igdb:${igdbId}` : ''),
    title,
    name: title,
    cover: poster,
    poster,
    image: fromSeed.image || poster,
    background_image: fromSeed.background_image || poster,
    rawgId,
    igdbId,
    sourceId: fromSeed.sourceId || igdbId || rawgId,
    source: fromSeed.source || (igdbId && !rawgId ? 'igdb' : 'rawg'),
    gameIdentityKey: fromSeed.gameIdentityKey || fromSeed.shelfdGameIdentityLock?.key || id || rawgId || (igdbId ? `igdb:${igdbId}` : '')
  };
  if (sourceItem.shelfdGameIdentityLock && typeof attachShelfdGameIdentityLock === 'function') {
    attachShelfdGameIdentityLock(sourceItem, sourceItem.shelfdGameIdentityLock);
  } else if (typeof attachShelfdGameIdentityLock === 'function' && typeof createShelfdGameIdentityLock === 'function') {
    attachShelfdGameIdentityLock(sourceItem, createShelfdGameIdentityLock(sourceItem, 'shelf-log-draft-source'));
  }
  return sourceItem;
}

async function addShelfLogGameDraftToLibrary(draft, ratingForAdd = 0, options = {}) {
  const source = draft?.sourceItem || draft?.draftItem || {};
  const title = String(source.title || source.name || draft?.draftItem?.title || '').trim();
  if (!title) return { ok: false, error: 'missing-title' };
  const shouldPersist = options.persist !== false;
  const targetData = ownDataCache ? cloneListData(ownDataCache) : cloneListData(data);
  targetData.games = Array.isArray(targetData.games) ? targetData.games : [];
  const rawgId = typeof getShelfdGameIdentityRawgId === 'function'
    ? getShelfdGameIdentityRawgId(source)
    : String(source.rawgId || '').trim();
  const igdbId = typeof getShelfdGameIdentityIgdbId === 'function'
    ? getShelfdGameIdentityIgdbId(source)
    : String(source.igdbId || '').trim();
  const titleKey = title.toLowerCase().trim();
  const existing = targetData.games.find(game => String(game?.title || game?.name || '').toLowerCase().trim() === titleKey);
  const now = new Date().toISOString();
  const genreNames = Array.isArray(source.genreNames)
    ? source.genreNames
    : (Array.isArray(source.genres) ? source.genres.map(g => g?.name || g).filter(Boolean) : []);
  const platforms = Array.isArray(source.platforms)
    ? source.platforms.map(p => typeof p === 'string' ? p : (p?.platform?.name || p?.name || '')).filter(Boolean).join(', ')
    : String(source.platforms || '').trim();
  const cover = getGameMediaImage(source) || source.cover || source.poster || source.image || source.background_image || '';
  const item = existing || {
    id: `${Date.now()}-${rawgId ? `rawg-${rawgId}` : igdbId ? `igdb-${igdbId}` : 'game'}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    name: title,
    dateAdded: now,
    tmdbId: '',
    mediaCategory: 'games',
    librarySection: 'games',
    episodes: []
  };
  Object.assign(item, {
    title,
    name: title,
    cover,
    poster: cover,
    image: cover,
    background_image: cover,
    igdbCoverUrl: source.igdbCoverUrl || '',
    genre: source.genre || genreNames.join(', '),
    genreNames,
    year: String(source.released || source.year || '').slice(0, 4),
    status: 'watched',
    rating: Number(ratingForAdd || 0) || 0,
    dateAdded: item.dateAdded || now,
    rawgId,
    rawgSlug: source.rawgSlug || source.slug || '',
    igdbId,
    igdbSlug: source.igdbSlug || (!rawgId ? source.slug || '' : ''),
    backloggdSlug: source.backloggdSlug || source.rawgSlug || source.igdbSlug || source.slug || '',
    metacritic: source.metacritic || '',
    metacriticSlug: source.metacriticSlug || '',
    source: source.source || (igdbId && !rawgId ? 'igdb' : 'rawg'),
    sourceId: source.sourceId || igdbId || rawgId,
    gameIdentityKey: source.gameIdentityKey || source.shelfdGameIdentityLock?.key || rawgId || (igdbId ? `igdb:${igdbId}` : item.id),
    platforms,
    stores: Array.isArray(source.stores) ? source.stores : []
  });
  if (source.shelfdGameIdentityLock && typeof attachShelfdGameIdentityLock === 'function') {
    attachShelfdGameIdentityLock(item, source.shelfdGameIdentityLock);
  } else if (typeof attachShelfdGameIdentityLock === 'function' && typeof createShelfdGameIdentityLock === 'function') {
    attachShelfdGameIdentityLock(item, createShelfdGameIdentityLock(item, 'shelf-log-direct-game-save'));
  }
  if (!existing) targetData.games.push(item);
  if (shouldPersist) {
    activeSection = 'games';
    activeTab = 'watched';
    await persistShelfLogGameDataServerFirst(targetData, item);
    try { render(); } catch (renderErr) { console.warn('[v10.853] render after direct game draft save failed:', renderErr); }
  }
  return { ok: true, item, data: targetData, section: 'games', status: 'watched', rating: Number(ratingForAdd || 0) || 0, source: 'shelf-log-direct-game-draft' };
}

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
  const sourceItem = resolveShelfLogDraftSourceItem(cleanType, cleanId, fpmpBtn);
  const title = sourceItem.title || sourceItem.name || '';
  const poster = getGameMediaImage(sourceItem) || sourceItem.cover || sourceItem.poster || '';
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
    sourceItem,
    draftItem: {
      id: draftId,
      title,
      cover: poster,
      year: String(sourceItem.released || sourceItem.year || '').slice(0, 4),
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

  const openingPendingDraft = !!(shelfLogComposerDraft && shelfLogComposerDraft.draftItem && shelfLogComposerDraft.draftItem.id === itemId);
  closeShelfLogComposer({ instant: true, preserveDraft: openingPendingDraft });

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
          ${shelfLogFirstTimeButtonInner(initialFirstTime)}
        </button>
        <button type="button" class="shelf-log-composer-toggle${initialRepliesOpen ? ' is-on' : ' is-private-review'}" data-shelf-log-toggle="replies" aria-pressed="${initialRepliesOpen ? 'true' : 'false'}">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M8 10c1-1.2 2.4-2 4-2s3 .8 4 2"/><path d="M10 14c.6.6 1.3 1 2 1s1.4-.4 2-1"/></svg>
          <span data-shelf-log-replies-label>${initialRepliesOpen ? 'Anyone can reply' : 'Private review'}</span>
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
  /* v11.041: allow scrubbing down to 0 (no rating). */
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
  /* v11.041: val 0 is allowed — releasing at 0 sets no rating. */
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
      if (key === 'firstTime') {
        state.firstTime = newOn;
        /* v11.971: swap the glyph + label between First-time watch and Rewatch. */
        btn.innerHTML = shelfLogFirstTimeButtonInner(newOn);
      } else if (key === 'replies') {
        state.repliesOpen = newOn;
        btn.classList.toggle('is-private-review', !newOn);
        const label = btn.querySelector('[data-shelf-log-replies-label]') || btn.querySelector('span');
        if (label) label.textContent = newOn ? 'Anyone can reply' : 'Private review';
      }
    });
  });

  // --- Cancel / Save ---
  const cancelBtn = overlay.querySelector('[data-shelf-log-cancel]');
  const saveBtn = overlay.querySelector('[data-shelf-log-save]');
  if (cancelBtn) cancelBtn.addEventListener('click', () => closeShelfLogComposer());
  if (saveBtn) saveBtn.addEventListener('click', () => saveShelfLogComposer());
}

function closeShelfLogComposer(opts = {}) {
  /* v11.250: ensure the saving spinner never outlives the composer. */
  if (typeof hideShelfLogSavingOverlay === 'function') hideShelfLogSavingOverlay();
  /* v10.849: clear shelfLogComposerDraft on real close/cancel/save, but
     preserve it during openShelfLogComposer's pre-open cleanup. The draft
     save branch needs that object when the user taps Save; clearing it
     during startup made FPMP Played saves close without adding the game. */
  if (!opts.preserveDraft) shelfLogComposerDraft = null;
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

/* v11.250: center-screen saving spinner. The FPMP "Watched" save path awaits
   addDiscoveryTitle (a TMDB fetch + library add) before any feedback, which
   could leave the screen looking frozen for ~3s. This overlay tells the user
   it's processing. Idempotent show/hide. */
function showShelfLogSavingOverlay() {
  if (document.getElementById('shelf-log-saving-overlay')) return;
  const ov = document.createElement('div');
  ov.id = 'shelf-log-saving-overlay';
  ov.className = 'shelf-log-saving-overlay';
  ov.setAttribute('role', 'status');
  ov.setAttribute('aria-label', 'Saving review');
  ov.innerHTML = '<div class="shelf-log-saving-spinner" aria-hidden="true"></div>';
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add('is-on'));
}
function hideShelfLogSavingOverlay() {
  const ov = document.getElementById('shelf-log-saving-overlay');
  if (!ov) return;
  ov.classList.remove('is-on');
  setTimeout(() => { try { ov.remove(); } catch (_) {} }, 160);
}

async function saveShelfLogComposer() {
  const state = shelfLogComposerState;
  if (!state) return;
  if (shelfLogComposerSaving) return;
  shelfLogComposerSaving = true;
  showShelfLogSavingOverlay();
  const saveBtn = document.getElementById('shelf-log-composer')?.querySelector?.('[data-shelf-log-save]');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.setAttribute('aria-busy', 'true');
  }
  const unlockComposerSave = () => {
    shelfLogComposerSaving = false;
    hideShelfLogSavingOverlay();
    const liveSaveBtn = document.getElementById('shelf-log-composer')?.querySelector?.('[data-shelf-log-save]');
    if (liveSaveBtn) {
      liveSaveBtn.disabled = false;
      liveSaveBtn.removeAttribute('aria-busy');
    }
  };
  let savedFromNewMediaDraft = false;
  let savedNewMediaDraftContext = null;
  let deferredNewMediaDraftData = null;
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
      if (draft.type === 'game') {
        addResult = await addShelfLogGameDraftToLibrary(draft, ratingForAdd, { persist: false });
      } else if (typeof addDiscoveryTitle === 'function') {
        addResult = await addDiscoveryTitle(draft.type, draft.tmdbId, draft.fpmpBtn, 'watched', '+', ratingForAdd, { promptPost: false, successToast: false });
      }
    } catch (e) {
      console.warn('[v10.853] draft-mode library add threw:', e);
    }
    if (!addResult || !addResult.ok || !addResult.item || !addResult.item.id) {
      if (typeof showToast === 'function') showToast('Could not save review. Try again.');
      unlockComposerSave();
      return; // keep composer open so user can retry
    }
    state.itemId = String(addResult.item.id);
    state.section = String(addResult.section || draft.section || state.section);
    if (draft.type === 'game' && addResult.data) deferredNewMediaDraftData = addResult.data;
    savedFromNewMediaDraft = true;
    savedNewMediaDraftContext = { draft, addResult };
    shelfLogComposerDraft = null;
  }
  const composerData = deferredNewMediaDraftData || data;
  let item = (composerData[state.section] || []).find(i => i?.id === state.itemId);
  if (!item) { closeShelfLogComposer(); unlockComposerSave(); return; }

  const reviewText = String(state.review || '').trim().slice(0, SHELF_LOG_REVIEW_MAX);
  const hasWrittenReview = reviewText.length > 0;
  const tags = state.tags.slice(0, SHELF_LOG_TAG_MAX_COUNT);
  const reviewIsPublic = state.repliesOpen !== false;

  const prevRating = Number(item.rating || 0);
  const nextRating = Number(state.rating || 0);
  const previousReviewActivityId = String(item.reviewActivityId || '').trim();
  const ratingOnlySaveAt = !hasWrittenReview ? new Date().toISOString() : '';
  const ratingOnlyActivityAt = (ratingOnlySaveAt && nextRating > 0 && (prevRating !== nextRating || savedFromNewMediaDraft || !String(item.lastShowRatingAt || '').trim()))
    ? ratingOnlySaveAt
    : '';
  item.rating = nextRating;
  item.reviewText = reviewText;
  item.reviewTags = tags;
  item.firstTimeWatch = !!state.firstTime;
  item.reviewRepliesPublic = !!state.repliesOpen;
  if (!hasWrittenReview) {
    delete item.reviewActivityId;
    delete item.reviewVisibility;
    delete item.reviewPrivate;
  } else if (reviewIsPublic) {
    delete item.reviewVisibility;
    delete item.reviewPrivate;
  } else {
    item.reviewVisibility = 'private';
    item.reviewPrivate = true;
    delete item.reviewActivityId;
  }
  if (state.date) {
    try { item.dateWatched = new Date(state.date + 'T12:00:00').toISOString(); }
    catch (_) {}
  }
  // v10.220: do NOT mirror into cardComment.text any more — once a real review
  // is posted, the title card surface stays clean (no flat comment line) and
  // owners see no + button, viewers see a layers icon that opens the FPReview.

  if (ratingOnlyActivityAt) {
    item.lastShowRatingAt = ratingOnlyActivityAt;
    item.shelfdRatingFirstSetAt = item.shelfdRatingFirstSetAt || ratingOnlyActivityAt;
  }
  if (ratingOnlySaveAt) {
    item.lastRatingOnlySaveAt = ratingOnlySaveAt;
  }

  if (typeof markOwnItemLastEdited === 'function') markOwnItemLastEdited(item, state.section);
  else if (typeof touchItem === 'function') touchItem(item);
  if (hasWrittenReview) {
    const reviewActivityAt = item.dateModified || item.lastEditedAt || new Date().toISOString();
    item.reviewUpdatedAt = reviewActivityAt;
    item.reviewEditedAt = reviewActivityAt;
    item.reviewSavedAt = reviewActivityAt;
    item.lastReviewActivityAt = reviewActivityAt;
    item.lastReviewActivityKind = reviewIsPublic ? 'public' : 'private';
  } else {
    delete item.reviewUpdatedAt;
    delete item.reviewEditedAt;
    delete item.reviewSavedAt;
    delete item.lastReviewActivityAt;
    delete item.lastReviewActivityKind;
  }

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

  if (!hasWrittenReview || !reviewIsPublic) {
    await cleanupPrivateMyListMediaReviewFeedPosts(item, state.section, previousReviewActivityId);
  }

  if (savedFromNewMediaDraft) {
    /* v11.213: OPTIMISTIC feedback. The library add already succeeded above
       (addDiscoveryTitle / addShelfLogGameDraftToLibrary resolved `ok` — we
       returned early if it didn't), so the item exists in memory RIGHT NOW.
       Previously the sound/haptic + "Added to shelf library" prompt were
       gated behind a SECOND awaited verified Firestore write (writeOwnDataDirect
       / persistShelfLogGameDataServerFirst) PLUS a 340ms timer — so on a slow
       link the user waited a full network ack + 340ms before any confirmation.
       Now we fire feedback + prompt + close immediately, and run the verified
       persist in the BACKGROUND (fire-and-forget; the existing error toast +
       composer-reopen still fire if it genuinely fails). */
    if (state.section === 'games') {
      activeSection = 'games';
      activeTab = 'watched';
    }
    try { markShelfLogNewMediaProfileButtonsAdded(savedNewMediaDraftContext?.draft || {}, item); } catch (_) {}
    try { triggerShelfdLibraryAddFeedback(); } catch (_) {}
    if (typeof showShelfdAddedToShelfPrompt === 'function') {
      try { showShelfdAddedToShelfPrompt({ message: 'Added to shelf library' }); } catch (_) {}
    } else if (typeof showToast === 'function') {
      showToast('Added to shelf library');
    }
    closeShelfLogComposer();
    /* Background verified persist — does not block the confirmation. */
    const verifiedPersist = (state.section === 'games')
      ? Promise.resolve().then(() => persistShelfLogGameDataServerFirst(deferredNewMediaDraftData || data, item))
      : (typeof writeOwnDataDirect === 'function'
          ? Promise.resolve().then(() => writeOwnDataDirect(data))
          : Promise.resolve().then(() => save()));
    verifiedPersist
      .then(() => {
        /* Re-bind the games item to its persisted copy for any later UI sync. */
        if (state.section === 'games') {
          const persistedItem = (data.games || []).find(game => game?.id === state.itemId);
          if (persistedItem) item = persistedItem;
        }
      })
      .catch((e) => {
        console.error('[v11.213] verified review save failed (background):', e);
        if (typeof showToast === 'function') {
          const message = typeof formatOwnDataSaveError === 'function' && e?.code
            ? formatOwnDataSaveError(e, data)
            : `Could not save review: ${String(e?.message || e || 'Firestore verification failed')}`;
          showToast(message);
        }
      });
  } else {
    closeShelfLogComposer();
    try { save(); }
    catch (e) {
      console.warn('[v10.217] save() threw inside saveShelfLogComposer:', e);
      if (typeof showToast === 'function') showToast('Saved locally — cloud sync will retry.');
    }
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
    const shouldWriteLinkedReviewPost = reviewIsPublic && hasWrittenReview;
    if (shouldWriteLinkedReviewPost && item.reviewActivityId) {
      updateLinkedMediaReviewFeedPost(item, state.section).then(success => {
        if (success) pushOwnMediaReviewToActivityFeed(item, state.section, item.reviewActivityId, reviewText);
      }).catch(() => {});
    } else if (shouldWriteLinkedReviewPost) {
      createOrUpdateLinkedMediaReviewFeedPost(item, state.section).then(result => {
        const postId = String(result?.postId || '').trim();
        if (postId) {
          item.reviewActivityId = postId;
          try { save(); } catch (_) {}
          pushOwnMediaReviewToActivityFeed(item, state.section, postId, reviewText);
          if (!result?.reusedExisting) notifyFriendsOfMediaReviewPost(item, state.section, postId, reviewText);
        }
      }).catch(() => {});
    }
  } catch (_) {}

  /* v11.213: the "Added to shelf library" prompt for the draft path now fires
     optimistically inside the savedFromNewMediaDraft block above (no 340ms
     timer). Only the non-draft "Review posted" toast remains here. */
  if (!savedFromNewMediaDraft && typeof showToast === 'function') {
    showToast(hasWrittenReview ? (reviewIsPublic ? 'Review posted' : 'Review saved') : (nextRating > 0 ? 'Rating saved' : 'Saved'));
  }

  shelfLogComposerSaving = false;

  // After the slide-out finishes, hand off to the existing Full Page Review.
  if (!savedFromNewMediaDraft) {
    setTimeout(() => {
      try { openFullPageMediaReview(targetItemId, targetSection); } catch (_) {}
    }, 340);
  }
}

/* v11.280: create + broadcast an Activity Feed post when a user adds/updates the
   highlight-clip link on their competitive game profile. Modeled on the
   media-review feed post but rendered through the generic `type:'post'` card
   (avatar + name + "headline · time" + poster + body). Writes the feed doc,
   pushes it into the live in-memory feed so it shows immediately, and notifies
   friends via the existing review-notify path. Returns the postId, or '' on no-op. */
async function createGameHighlightFeedPost(item, section, highlightClip) {
  if (!currentUser || typeof db === 'undefined') return '';
  const clip = normalizeMyListGameProfileHighlightClip(highlightClip) || normalizeMyListGameProfileHighlightClip(String(highlightClip || ''));
  const url = String(clip?.url || '').trim();
  if (!url || !item) return '';
  const postId = (crypto && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : ('post-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  const timestamp = Date.now();
  const itemSection = section || item.librarySection || item.mediaCategory || 'games';
  const title = (typeof getScreenListActivityItemTitle === 'function'
    ? getScreenListActivityItemTitle(item)
    : (item.title || item.name || 'a game')) || 'a game';
  const cover = (typeof getScreenListActivityItemCover === 'function'
    ? getScreenListActivityItemCover(item)
    : (item.cover || item.background_image || '')) || '';
  const feedPost = {
    postId,
    uid: currentUser.uid,
    timestamp,
    type: 'highlight',
    eventType: 'highlight',
    visibility: 'friends',
    likes: [],
    replies: [],
    content: { headline: `Shared a highlight from ${title}`, text: clip.caption || url, caption: clip.caption || '' },
    highlightUrl: url,
    highlightCaption: clip.caption || '',
    item: {
      id: item.id,
      title,
      cover,
      poster: cover,
      librarySection: itemSection,
      mediaCategory: itemSection,
      rawgId: item.rawgId || item.rawg_id || ''
    },
    mediaKey: typeof getMediaKey === 'function' ? getMediaKey(item) : ''
  };
  try {
    await db.collection('feed').doc(postId).set(feedPost);
    if (Array.isArray(window.feedPosts)) window.feedPosts.unshift(feedPost);
  } catch (error) {
    console.warn('[v11.280] createGameHighlightFeedPost failed:', error);
    return '';
  }
  /* v11.467: insert the new highlight straight into the Activity Feed so it
     appears INSTANTLY — no Firestore refetch, no skeleton blank. The previous
     code busted the cache then tried to call loadActivityTabFeed() behind a
     `typeof isActivityTabVisible === 'function'` guard, but isActivityTabVisible
     was never defined, so the guard was always false and the visible feed was
     never refreshed — the post only surfaced after the 120s cache expiry or a
     manual refresh. prependActivityFeedHighlightPost updates the authoritative
     cache (deduped by `feed:<postId>`) and re-renders from cache when the feed
     is on-screen. */
  try {
    if (typeof window.prependActivityFeedHighlightPost === 'function') {
      window.prependActivityFeedHighlightPost(feedPost);
    } else if (typeof friendActivityCache !== 'undefined' && friendActivityCache) {
      friendActivityCache.timestamp = 0;
    }
  } catch (_) {}
  /* v11.390: notify friends with a dedicated highlight push ("shared a new
     highlight reel from {game}") instead of reusing the review copy. */
  try {
    if (typeof notifyFriendsOfHighlightPost === 'function') {
      notifyFriendsOfHighlightPost(item, itemSection, postId);
    }
  } catch (_) {}
  return postId;
}

/* v11.461: ONE source of truth for committing a game highlight clip — shared by
   the game-profile "Apply Clip" editor (applyMyListGameProfileHighlightClip) AND
   the Activity Feed "+ -> Highlight Reel" composer (submitActivityHighlightPost).
     1. Posts the single NEW clip to the activity feed (feed collection,
        type:'highlight') when postToFeed is true — so it shows on the Activity Feed.
     2. Tracks the posted url on the item (highlightFeedPostedUrls) so re-applying
        the same clip never reposts / duplicates.
     3. Persists the FULL clip set onto the game via saveScreenListCompetitiveProfile
        — so the clip also shows inside that game's detail / Highlights page.
   Both entry points therefore read/write the EXACT same data; neither creates a
   second disconnected highlight system. Returns { postId, clips }. */
async function commitGameHighlightClip(item, clip, allClips, options = {}) {
  const postToFeed = options.postToFeed !== false;
  const normClip = (typeof normalizeMyListGameProfileHighlightClip === 'function')
    ? normalizeMyListGameProfileHighlightClip(clip)
    : (clip && clip.url ? { url: String(clip.url).trim(), caption: String(clip.caption || '').trim() } : null);
  const existing = (typeof getMyListGameProfileHighlightClips === 'function') ? getMyListGameProfileHighlightClips(item) : [];
  const merged = (Array.isArray(allClips) && allClips.length)
    ? allClips
    : (normClip ? [...existing, normClip] : existing);
  const clips = (typeof dedupeMyListGameProfileHighlightClips === 'function')
    ? dedupeMyListGameProfileHighlightClips(merged)
    : merged;
  if (!item || !normClip) return { postId: '', clips };
  const itemId = String(
    options.itemId
    || (typeof getScreenListGameStableKey === 'function' ? getScreenListGameStableKey(item) : '')
    || item.id
    || ''
  ).trim();
  /* v11.467: the activity-feed post (feed/<postId>) and the game-detail persist
     (the user's games section) are INDEPENDENT documents with no ordering
     dependency, so fire them in PARALLEL instead of awaiting one then the other.
     This ~halves the time the "Posting…" button is held before the modal closes.
     createGameHighlightFeedPost already prepends the card to the feed the instant
     its own write resolves, so the feed updates as soon as the faster write
     finishes — it does not wait on the (often slower) games-section persist. */
  // 1) Activity feed post (one clip).
  const feedPromise = (postToFeed && typeof createGameHighlightFeedPost === 'function')
    ? createGameHighlightFeedPost(item, options.section || 'games', normClip)
    : Promise.resolve('');
  // 2) Persist the full clip set onto the game (Firestore + in-memory data.games).
  const savePromise = (itemId && typeof window.saveScreenListCompetitiveProfile === 'function')
    ? window.saveScreenListCompetitiveProfile({
        itemId,
        highlightClips: clips,
        highlightUrl: clips[0]?.url || '',
        fetchStats: false,
        /* v11.464: this save only attaches a highlight reel. Flag it so the game's
           dateModified bump does NOT spawn a generic "updated <game>" activity card
           in the feed — the Highlight Reel post is the one and only activity.
           v11.467: highlightSave also skips the forced server read-back verify in
           saveScreenListCompetitiveProfile (a full extra round-trip), since a
           highlight-only attach has no rank/profile stats to verify. */
        highlightSave: true
      })
    : (typeof save === 'function' ? (async () => { try { save(); } catch (_) {} })() : Promise.resolve());

  const [postIdResult] = await Promise.all([feedPromise, savePromise]);
  const postId = postIdResult || '';

  /* v11.469: mirror the just-persisted clip set onto the live in-memory item so the
     duplicate check (isGameHighlightClipAlreadyPosted, which reads the game's live
     highlight reel) is accurate immediately — without waiting for a Firestore
     refetch. saveScreenListCompetitiveProfile reassigns the global `data` to a fresh
     clone, so this object can otherwise lag the persisted highlightClips. Runs
     whether or not a feed post was created (a re-applied clip still persists). */
  if (Array.isArray(clips)) {
    item.highlightClips = clips;
    item.highlights = clips;
    item.highlightUrl = clips[0]?.url || item.highlightUrl || '';
  }

  // 3) Remember the posted url so the same clip never reposts (no duplicate posts).
  if (postId) {
    const postedSet = new Set([
      String(item.highlightFeedPostedUrl || '').trim(),
      ...(Array.isArray(item.highlightFeedPostedUrls) ? item.highlightFeedPostedUrls.map(u => String(u || '').trim()) : [])
    ].filter(Boolean));
    postedSet.add(normClip.url);
    item.highlightFeedPostedUrl = normClip.url || item.highlightFeedPostedUrl || '';
    item.highlightFeedPostedUrls = Array.from(postedSet);
  }
  return { postId, clips };
}
window.commitGameHighlightClip = commitGameHighlightClip;

/* v10.220: media-review feed post helpers. The post is the source of truth
   for replies/likes; FPReview's Reply button delegates to it via the existing
   openActivityReplyPage handler, so the reply count shown on the activity
   card and inside the FPReview stay in sync automatically. */
function normalizeLinkedMediaReviewSection(value = '') {
  const key = String(value || '').toLowerCase();
  if (key === 'movie' || key === 'movies') return 'movies';
  if (key === 'tv' || key === 'show' || key === 'shows' || key === 'series') return 'shows';
  if (key === 'anime') return 'anime';
  if (key === 'game' || key === 'games') return 'games';
  if (key === 'album' || key === 'music') return 'music';
  return key;
}

function getLinkedMediaReviewPostTime(post = {}) {
  const candidates = [post.timestamp, post.editedAt, post.updatedAt, post.savedAt, post.createdAt];
  let latest = 0;
  candidates.forEach(value => {
    let ms = 0;
    try {
      if (value && typeof value.toMillis === 'function') ms = Number(value.toMillis()) || 0;
      else if (value && typeof value.toDate === 'function') ms = Number(value.toDate().getTime()) || 0;
      else if (typeof value === 'number') ms = value;
      else if (value) ms = Date.parse(value) || 0;
    } catch (_) {}
    if (ms > latest) latest = ms;
  });
  return latest;
}

function getLinkedMediaReviewItemSnapshot(item = {}, section = '') {
  const itemSection = section || item.librarySection || item.mediaCategory || activeSection;
  return {
    id: item.id,
    title: item.title || item.name || '',
    cover: item.cover || item.poster || item.image || '',
    year: item.year || item.releaseYear || '',
    librarySection: itemSection,
    mediaCategory: itemSection,
    tmdbId: item.tmdbId || item.tmdb_id || '',
    malId: item.malId || item.mal_id || item.__mal_id || '',
    rawgId: item.rawgId || item.rawg_id || '',
    imdbId: item.imdbId || item.imdb_id || '',
    rating: item.rating || 0
  };
}

function getLinkedMediaReviewMediaKey(item = {}, section = '') {
  const snapshot = getLinkedMediaReviewItemSnapshot(item, section);
  try {
    if (typeof getMediaKey === 'function') return String(getMediaKey(snapshot) || '').trim();
  } catch (_) {}
  return '';
}

function normalizeLinkedMediaReviewTitle(value = '') {
  return String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
}

function linkedMediaReviewPostMatchesItem(post = {}, item = {}, section = '') {
  if (!post || !item) return false;
  if (post.type !== 'media-review' && post.eventType !== 'review') return false;
  if (currentUser?.uid && String(post.uid || '') !== String(currentUser.uid)) return false;
  const postId = String(post.postId || post.id || '').trim();
  if (item.reviewActivityId && postId && postId === String(item.reviewActivityId)) return true;
  if (post.reviewSourceItemId && item.id && String(post.reviewSourceItemId) === String(item.id)) return true;

  const postItem = post.item || {};
  const itemSection = normalizeLinkedMediaReviewSection(section || item.librarySection || item.mediaCategory || '');
  const postSection = normalizeLinkedMediaReviewSection(postItem.librarySection || postItem.mediaCategory || post.section || post.mediaCategory || '');
  if (itemSection && postSection && itemSection !== postSection) return false;

  const itemMediaKey = getLinkedMediaReviewMediaKey(item, section);
  const postMediaKey = String(post.mediaKey || postItem.mediaKey || '').trim();
  if (itemMediaKey && postMediaKey && itemMediaKey === postMediaKey) return true;

  const idPairs = [
    [item.tmdbId || item.tmdb_id, postItem.tmdbId || postItem.tmdb_id],
    [item.malId || item.mal_id || item.__mal_id, postItem.malId || postItem.mal_id || postItem.__mal_id],
    [item.rawgId || item.rawg_id, postItem.rawgId || postItem.rawg_id],
    [item.imdbId || item.imdb_id, postItem.imdbId || postItem.imdb_id]
  ];
  if (idPairs.some(([a, b]) => String(a || '').trim() && String(a || '').trim() === String(b || '').trim())) return true;

  const itemTitle = normalizeLinkedMediaReviewTitle(item.title || item.name || '');
  const postTitle = normalizeLinkedMediaReviewTitle(postItem.title || postItem.name || post.title || '');
  if (!itemTitle || !postTitle || itemTitle !== postTitle) return false;
  const itemYear = String(item.year || item.releaseYear || '').slice(0, 4);
  const postYear = String(postItem.year || postItem.releaseYear || post.year || '').slice(0, 4);
  return !itemYear || !postYear || itemYear === postYear;
}

function getLinkedMediaReviewAuthorFields() {
  const mapProfile = (() => {
    try {
      return (typeof usersMap === 'object' && usersMap && currentUser?.uid && usersMap[currentUser.uid]) || {};
    } catch (_) {
      return {};
    }
  })();
  const activeProfile = (typeof getActiveProfile === 'function' ? getActiveProfile() : null) || {};
  const profile = { ...(userProfile || {}), ...activeProfile, ...mapProfile };
  const handle = String(
    (typeof getShelfdUsernameHandle === 'function' ? getShelfdUsernameHandle(profile) : '') ||
    profile.usernameHandle ||
    profile.userHandle ||
    profile.username ||
    profile.handle ||
    ''
  ).trim().replace(/^@+/, '');
  const name = profile.name || profile.customName || profile.displayName || currentUser?.displayName || 'Shelfd User';
  const photo = profile.photo || profile.customPhoto || profile.photoURL || currentUser?.photoURL || '';
  return {
    name,
    displayName: profile.displayName || name,
    photo,
    authorName: name,
    authorPhoto: photo,
    usernameHandle: handle,
    userHandle: handle,
    username: handle,
    usernameHandleLower: handle.toLowerCase()
  };
}

async function findExistingLinkedMediaReviewFeedPost(item, section) {
  if (!currentUser || typeof db === 'undefined' || !item) return null;
  /* v11.539: never resurrect a review the user already deleted. When a review is
     deleted, its feed-post id (and every candidate id) is written into the user's
     PERMANENT activityDeletedIds tombstone, and the feed render filters out any
     activity whose ids intersect that set. The delete is optimistic now, so the
     old feed doc can still be queryable for a moment after delete. If we matched
     it here and reused its id for a brand-new review, that new card would inherit
     the tombstoned id and be filtered out forever — so the user's fresh review
     never appeared in the activity feed. Skip any tombstoned candidate so the
     caller falls through to minting a fresh, un-tombstoned post id. */
  let deletedReviewIds = null;
  try {
    if (typeof getScreenListDeletedActivityIdsForUser === 'function') {
      deletedReviewIds = getScreenListDeletedActivityIdsForUser(
        currentUser.uid,
        (typeof usersMap === 'object' && usersMap && usersMap[currentUser.uid]) ||
        (typeof userProfile !== 'undefined' ? userProfile : null) || {}
      );
    }
  } catch (_) {}
  const isLinkedReviewPostTombstoned = (post) => {
    if (!deletedReviewIds || !deletedReviewIds.size) return false;
    try {
      const fallbackId = getMyListMediaReviewPostId(post);
      const candidateIds = (typeof getScreenListActivityDeleteCandidates === 'function')
        ? getScreenListActivityDeleteCandidates(post, fallbackId)
        : [String(post.postId || post.id || '').trim(), post.eventKey].filter(Boolean);
      return candidateIds.some(id => id && deletedReviewIds.has(String(id)));
    } catch (_) {
      const id = String(post.postId || post.id || '').trim();
      return !!id && deletedReviewIds.has(id);
    }
  };
  const candidates = [];
  if (Array.isArray(window.feedPosts)) {
    candidates.push(...window.feedPosts);
  }
  try {
    const snap = await db.collection('feed')
      .where('uid', '==', currentUser.uid)
      .orderBy('timestamp', 'desc')
      .limit(120)
      .get();
    snap.forEach(doc => {
      const data = doc.data() || {};
      candidates.push({ ...data, postId: data.postId || doc.id, id: data.id || doc.id });
    });
  } catch (error) {
    console.warn('[review] existing linked review lookup failed:', error);
  }
  const byId = new Map();
  candidates.forEach((post, index) => {
    if (isLinkedReviewPostTombstoned(post)) return;
    if (!linkedMediaReviewPostMatchesItem(post, item, section)) return;
    const id = String(post.postId || post.id || `candidate-${index}`).trim();
    const existing = byId.get(id);
    if (!existing || getLinkedMediaReviewPostTime(post) >= getLinkedMediaReviewPostTime(existing)) byId.set(id, post);
  });
  return [...byId.values()].sort((a, b) => getLinkedMediaReviewPostTime(b) - getLinkedMediaReviewPostTime(a))[0] || null;
}

async function createOrUpdateLinkedMediaReviewFeedPost(item, section) {
  if (!currentUser || typeof db === 'undefined') return '';
  if (typeof isMyListMediaReviewRepliesEnabled === 'function' && !isMyListMediaReviewRepliesEnabled(item)) {
    return { postId: '', reusedExisting: false };
  }
  const existing = await findExistingLinkedMediaReviewFeedPost(item, section);
  if (existing) {
    const existingPostId = String(existing.postId || existing.id || '').trim();
    if (existingPostId) {
      item.reviewActivityId = existingPostId;
      const success = await updateLinkedMediaReviewFeedPost(item, section);
      return { postId: success ? existingPostId : '', reusedExisting: true };
    }
  }

  const postId = (crypto && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : ('post-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  const timestamp = Date.now();
  const reviewText = String(item.reviewText || '').slice(0, SHELF_LOG_REVIEW_MAX);
  const itemSnapshot = getLinkedMediaReviewItemSnapshot(item, section);
  const authorFields = getLinkedMediaReviewAuthorFields();
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
    ...authorFields,
    item: itemSnapshot,
    mediaKey: getLinkedMediaReviewMediaKey(item, section),
    reviewText,
    reviewRepliesPublic: item.reviewRepliesPublic !== false,
    reviewVisibility: item.reviewRepliesPublic === false ? 'private' : 'public',
    reviewSourceItemId: item.id
  };
  try {
    await db.collection('feed').doc(postId).set(feedPost);
    if (Array.isArray(window.feedPosts)) window.feedPosts.unshift(feedPost);
    return { postId, reusedExisting: false };
  } catch (error) {
    console.warn('[v10.220] createLinkedMediaReviewFeedPost failed:', error);
    return { postId: '', reusedExisting: false };
  }
}

async function createLinkedMediaReviewFeedPost(item, section) {
  const result = await createOrUpdateLinkedMediaReviewFeedPost(item, section);
  return result?.postId || '';
}

async function updateLinkedMediaReviewFeedPost(item, section) {
  if (!currentUser || typeof db === 'undefined') return false;
  if (typeof isMyListMediaReviewRepliesEnabled === 'function' && !isMyListMediaReviewRepliesEnabled(item)) return false;
  const postId = item.reviewActivityId;
  if (!postId) return false;
  const reviewText = String(item.reviewText || '').slice(0, SHELF_LOG_REVIEW_MAX);
  try {
    const now = Date.now();
    const itemSnapshot = getLinkedMediaReviewItemSnapshot(item, section);
    const authorFields = getLinkedMediaReviewAuthorFields();
    const merge = {
      uid: currentUser.uid,
      type: 'media-review',
      eventType: 'review',
      visibility: 'friends',
      reviewText,
      content: { text: reviewText, headline: 'Wrote a review' },
      ...authorFields,
      item: itemSnapshot,
      mediaKey: getLinkedMediaReviewMediaKey(item, section),
      reviewSourceItemId: item.id,
      reviewRepliesPublic: item.reviewRepliesPublic !== false,
      reviewVisibility: item.reviewRepliesPublic === false ? 'private' : 'public',
      timestamp: now,
      editedAt: now,
      updatedAt: now
    };
    await db.collection('feed').doc(postId).set(merge, { merge: true });
    if (Array.isArray(window.feedPosts)) {
      const idx = window.feedPosts.findIndex(p => String(p?.postId || p?.id || '') === String(postId));
      if (idx >= 0) {
        const prev = window.feedPosts[idx];
        const prevItem = prev.item || {};
        window.feedPosts[idx] = {
          ...prev,
          reviewText,
          content: { ...(prev.content || {}), text: reviewText, headline: 'Wrote a review' },
          ...authorFields,
          item: { ...prevItem, ...itemSnapshot },
          mediaKey: getLinkedMediaReviewMediaKey(item, section),
          reviewSourceItemId: item.id,
          reviewRepliesPublic: item.reviewRepliesPublic !== false,
          reviewVisibility: item.reviewRepliesPublic === false ? 'private' : 'public',
          timestamp: now,
          editedAt: now,
          updatedAt: now
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
  if (typeof isMyListMediaReviewRepliesEnabled === 'function' && !isMyListMediaReviewRepliesEnabled(item)) return;
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

function notifyFriendsOfMediaReviewPost(item, section, postId, reviewText) {
  if (!currentUser || !postId || !item || typeof createActivityNotification !== 'function') return;
  /* v11.605: a "Posted a review of {title}" notification must reflect an ACTUAL
     written review. Rating a title — or moving it into Watched / Played /
     Listened — with NOTHING typed in the review field still creates the
     activity-feed card, but must NOT fire a "posted a review" push/in-app
     notification. Gate strictly on real (non-whitespace) review text. */
  if (!String(reviewText == null ? '' : reviewText).trim()) return;
  if (typeof isMyListMediaReviewRepliesEnabled === 'function' && !isMyListMediaReviewRepliesEnabled(item)) return;
  const recipientUids = [...new Set(Array.isArray(friends) ? friends : [])]
    .map(uid => String(uid || '').trim())
    .filter(uid => uid && uid !== currentUser.uid);
  if (!recipientUids.length) return;
  const itemSection = section || item.librarySection || item.mediaCategory || activeSection || '';
  const mediaTitle = String(
    (typeof getDisplayTitleForItem === 'function' ? getDisplayTitleForItem(item, itemSection) : '')
    || item.title
    || item.name
    || ''
  ).trim();
  const mediaPoster = String(
    (typeof getScreenListActivityItemCover === 'function' ? getScreenListActivityItemCover(item) : '')
    || item.cover
    || item.poster
    || ''
  ).trim();
  const createdAtMs = Date.now();
  recipientUids.forEach(recipientUid => {
    try {
      Promise.resolve(createActivityNotification({
        recipientUid,
        actorUid: currentUser.uid,
        type: 'friend_review_posted',
        targetActivityId: postId,
        targetKind: 'feed',
        targetCollection: 'feed',
        media: {
          mediaTitle,
          mediaPoster
        },
        textSnippet: 'Check out what they thought.',
        createdAtMs
      })).catch(error => {
        console.warn('[review-notifications] friend review notification failed:', error && error.message ? error.message : error);
      });
    } catch (error) {
      console.warn('[review-notifications] friend review notification failed:', error && error.message ? error.message : error);
    }
  });
}

/* v11.390: push + in-app notification to friends when the user shares a new
   highlight reel on their game profile. Mirrors notifyFriendsOfMediaReviewPost
   but uses the dedicated 'friend_highlight_posted' type so the push copy reads
   "shared a new highlight reel from {game}" (createActivityNotification handles
   the /api/push/send fan-out + the in-app notification doc). The activity-feed
   post itself is created separately in createGameHighlightFeedPost. */
function notifyFriendsOfHighlightPost(item, section, postId) {
  if (!currentUser || !postId || !item || typeof createActivityNotification !== 'function') return;
  const recipientUids = [...new Set(Array.isArray(friends) ? friends : [])]
    .map(uid => String(uid || '').trim())
    .filter(uid => uid && uid !== currentUser.uid);
  if (!recipientUids.length) return;
  const itemSection = section || item.librarySection || item.mediaCategory || activeSection || '';
  const mediaTitle = String(
    (typeof getDisplayTitleForItem === 'function' ? getDisplayTitleForItem(item, itemSection) : '')
    || item.title
    || item.name
    || ''
  ).trim();
  const mediaPoster = String(
    (typeof getScreenListActivityItemCover === 'function' ? getScreenListActivityItemCover(item) : '')
    || item.cover
    || item.poster
    || ''
  ).trim();
  const createdAtMs = Date.now();
  recipientUids.forEach(recipientUid => {
    try {
      Promise.resolve(createActivityNotification({
        recipientUid,
        actorUid: currentUser.uid,
        type: 'friend_highlight_posted',
        targetActivityId: postId,
        targetKind: 'feed',
        targetCollection: 'feed',
        media: { mediaTitle, mediaPoster },
        textSnippet: 'Tap to watch.',
        createdAtMs
      })).catch(error => {
        console.warn('[highlight-notifications] friend highlight notification failed:', error && error.message ? error.message : error);
      });
    } catch (error) {
      console.warn('[highlight-notifications] friend highlight notification failed:', error && error.message ? error.message : error);
    }
  });
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

