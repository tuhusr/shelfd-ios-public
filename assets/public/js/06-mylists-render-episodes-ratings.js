window.__SHELFD_MYLIST_PATCH_VERSION = 'V301-mylist-render-recovery-no-swipe';
window.__SHELFD_MYLIST_SWIPE_REMOVED = true;
window.__SHELFD_MYLIST_RENDER_RECOVERY = true;
window.__SHELFD_MYLIST_CONTROLS_STAR_CACHE_BUSTER = true;
// Load from Firestore
async function load() {
  if (!DOC_REF) return;
  try {
    const snap = await DOC_REF.get();
    if (snap.exists) {
      const d = snap.data();
      data = normalizeListData({
        shows: d.shows ? JSON.parse(d.shows) : [],
        movies: d.movies ? JSON.parse(d.movies) : [],
        anime: d.anime ? JSON.parse(d.anime) : [],
        games: d.games ? JSON.parse(d.games) : [],
        manga: d.manga ? JSON.parse(d.manga) : [],
        books: d.books ? JSON.parse(d.books) : []
      });
    } else {
      data = getEmptyListData();
    }
    data = await autoSortAnimeBuckets(data, true);
    ownDataCache = cloneListData(data);
    activeSection = "shows";
    activeTab = "watching";
  } catch(e) {
    console.error("Load failed:", e);
    // Fallback to localStorage
    try {
      const raw = localStorage.getItem("watchlist-tracker-data");
      if (raw) data = normalizeListData(JSON.parse(raw));
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
  // Save to localStorage as backup
  localStorage.setItem("watchlist-tracker-data", JSON.stringify(safeData));
  if (currentUser) localStorage.setItem("screenlist-own-data-backup-" + currentUser.uid, JSON.stringify(safeData));
  // Debounce Firestore writes
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    try {
      await DOC_REF.set({
        shows: JSON.stringify(safeData.shows),
        movies: JSON.stringify(safeData.movies),
        anime: JSON.stringify(safeData.anime),
        games: JSON.stringify(safeData.games),
        manga: JSON.stringify(safeData.manga),
        books: JSON.stringify(safeData.books),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      if (currentUser?.uid === CREATOR_PUBLIC_UID) {
        await syncCreatorPublicProfileMirror(currentUser, userProfile, safeData);
      }
    } catch(e) {
      console.error("Save failed:", e);
      showToast('Save failed. Your library may be too large or offline. Try again.');
    }
  }, 500);
}

// Render
function render() {
  ensureActiveSectionVisible();
  renderMyListEditControls();
  const visibleData = getVisibleListData();
  const items = Array.isArray(visibleData[activeSection]) ? visibleData[activeSection] : [];
  activeTab = normalizeVisibleMyListStatusTab(activeTab, activeSection);
  const stateKey = getSortStateKey();
  const activeSortKey = getActiveSortKey();
  const baseFiltered = items
    .filter(i => i.status === activeTab)
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
  document.getElementById("count-live").textContent = items.filter(i => i.status === "live").length;
  document.getElementById("count-watching").textContent = items.filter(i => i.status === "watching").length;
  document.getElementById("count-planned").textContent = items.filter(i => i.status === "planned").length;
  document.getElementById("count-watched").textContent = items.filter(i => i.status === "watched").length;
  document.getElementById("count-paused").textContent = items.filter(i => i.status === "paused").length;
  const droppedCountEl = document.getElementById("count-dropped");
  if (droppedCountEl) droppedCountEl.textContent = items.filter(i => i.status === "dropped").length;

  // Add button label
  document.getElementById("add-btn").textContent = '+ Add to Shelf';

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
      b.style.display = activeSection === "games" ? "" : "none";
    }
    if (b.dataset.tab === "paused") {
      b.style.display = activeSection === "games" ? "none" : "";
    }
    if (b.dataset.tab === "watching") {
      b.style.display = activeSection === "movies" ? "none" : "";
      b.childNodes[0].textContent = activeSection === "games" ? "Playing" : isReadingSection(activeSection) ? "Reading" : "Watching";
    }
    if (b.dataset.tab === "planned") {
      b.childNodes[0].textContent = activeSection === "games" ? "Backlog" : isReadingSection(activeSection) ? "TBR" : "Watchlist";
    }
    if (b.dataset.tab === "watched") {
      b.childNodes[0].textContent = activeSection === "games" ? "Played" : isReadingSection(activeSection) ? "Read" : "Watched";
    }
  });
  requestAnimationFrame(() => updateSlidingPills());
  if (typeof initMyListInteractionFallbacks === 'function') initMyListInteractionFallbacks();
  if (typeof removeMyListSwipeArtifacts === 'function') removeMyListSwipeArtifacts();
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
  const sortLabel = SORT_OPTIONS.find(o => o.key === activeSortKey)?.label || 'Sort';
  sortBtn.title = sortLabel;
  sortBtn.innerHTML = `<span class="sort-btn-icon${isDefaultSort ? '' : ' sort-active'}">⇅</span><span class="sort-btn-label">${isDefaultSort ? '' : sortLabel}</span>`;

  if (filtered.length === 0) {
    grid.innerHTML = "";
    empty.style.display = "block";
    document.getElementById("empty-icon").textContent = getSectionIcon(activeSection);
    const statusLabel = activeTab === "planned" ? "planned" : activeTab;
    const sectionLabel = getSectionLabel(activeSection);
    document.getElementById("empty-text").textContent = `No ${statusLabel} ${sectionLabel} yet`;
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

  if (activeSortKey === 'custom') {
    grid.innerHTML = filtered.map(item => renderCard(item, true)).join("");
  } else {
    grid.innerHTML = filtered.map(item => renderCard(item)).join("");
  }

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
    await DOC_REF.set({
      shows: JSON.stringify(safeData.shows || []),
      movies: JSON.stringify(safeData.movies || []),
      anime: JSON.stringify(safeData.anime || []),
      games: JSON.stringify(safeData.games || []),
      manga: JSON.stringify(safeData.manga || []),
      books: JSON.stringify(safeData.books || []),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } else {
    save();
  }
  return safeData;
}

function renderGameDetailsExpandButton(item = {}) {
  const id = String(item.id || '');
  const isOpen = !!screenlistGameDetailsOpenState[id] || !!screenlistGameDetailsEditState[id];
  return `<button id="game-details-toggle-${escAttr(id)}" class="game-details-expand-btn${isOpen ? ' open' : ''}" type="button" onclick="event.stopPropagation();toggleGameDetailsPanel('${escAttr(id)}')" aria-expanded="${isOpen ? 'true' : 'false'}">
    <span>${isOpen ? 'Hide Info' : 'Expand Info'}</span>
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M5 7.5 10 12l5-4.5"/></svg>
  </button>`;
}

function renderGamePlatformOptionButtons(id = '', selected = '') {
  return SCREENLIST_GAME_PLATFORM_OPTIONS.map(option => `
    <button class="game-platform-option${option === selected ? ' selected' : ''}" type="button" data-game-platform-option="true" data-game-details-id="${escAttr(id)}" data-value="${escAttr(option)}">${escHtml(option)}</button>
  `).join('');
}

function renderGameDetailsPanel(item = {}) {
  const id = String(item.id || '');
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
    ? `<a class="game-details-tracker-link" href="${escAttr(trackerUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${getScreenListGameTrackerIconSvg()}<span>Tracker/Stats</span></a>`
    : `<span class="game-details-muted">Tracker/Stats not added</span>`;

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
      <span class="game-details-label">Export</span>
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
      <button class="game-details-save-btn" type="button" data-game-details-save="true" data-game-details-id="${escAttr(id)}">Save</button>
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

function cancelGameDetailsEdit(id = '') {
  const key = String(id || '').trim();
  if (!key) return;
  delete screenlistGameDetailsDraftState[key];
  screenlistGameDetailsPlatformMenuState[key] = false;
  screenlistGameDetailsEditState[key] = false;
  screenlistGameDetailsOpenState[key] = true;
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

  screenlistGameDetailsOpenState[key] = true;
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
      await DOC_REF.set({
        shows: JSON.stringify(data.shows || []),
        movies: JSON.stringify(data.movies || []),
        anime: JSON.stringify(data.anime || []),
        games: JSON.stringify(data.games || []),
        manga: JSON.stringify(data.manga || []),
        books: JSON.stringify(data.books || []),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
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

function renderCard(item, isDraggable) {
  const type = isShowSection(activeSection) ? "show" : activeSection === "movies" ? "movie" : activeSection === "games" ? "game" : "reading";
  const mediaKey = getMediaKey(item);
  const commentCount = isPreviewMode() && !currentUser
    ? getPreviewCommentsForMedia(mediaKey).length
    : getCachedCommentCount(mediaKey);
  const coverStyle = item.cover
    ? `background-image:url('${item.cover}');background-size:cover;background-position:center;`
    : "";
  const coverClass = item.cover ? "card-cover" : "card-cover no-img";
  const emoji = getSectionIcon(activeSection);
  const friendAlreadyAdded = viewingUser && myData ? isDuplicateTitleInList(item.title, activeSection, myData) : false;
  const isGameCard = activeSection === 'games';
  const itemSectionAttr = escAttr(activeSection);
  const itemIdAttr = escAttr(item.id);
  const displayTitle = getDisplayTitleForItem(item, activeSection) || item.title || '';
  if (activeSection === 'anime') {
    queueAnimeTitleVariantHydration(item, activeSection);
    queueMissingMalPosterHydration(item, activeSection);
  }
  const canOpenProfile = canOpenLibraryMediaProfile(activeSection);
  const gameTitleMarkup = isGameCard
    ? `<button class="card-title-profile-btn game-title-profile-btn" type="button" data-library-item-id="${itemIdAttr}" data-library-section="${itemSectionAttr}" onclick="openGameMediaProfileFromLibrary(event,'${itemIdAttr}','${itemSectionAttr}')">${escHtml(displayTitle)}</button>${renderBackloggdGameIcon(item, 'game-card-backloggd-icon')}`
    : canOpenProfile
      ? `<button class="card-title-profile-btn media-title-profile-btn" type="button" data-library-item-id="${itemIdAttr}" data-library-section="${itemSectionAttr}" onclick="openLibraryMediaProfile(event,'${itemIdAttr}','${itemSectionAttr}')">${escHtml(displayTitle)}</button>`
      : `<span>${escHtml(displayTitle)}</span>`;
  const coverProfileAttrs = canOpenProfile ? `data-library-item-id="${itemIdAttr}" data-library-section="${itemSectionAttr}" role="button" tabindex="0" aria-label="Open ${escAttr(displayTitle)} profile"` : '';
  const coverProfileClass = canOpenProfile ? ' card-cover-profile-btn' : '';

  let watchedCount = 0, totalEps = 0, progress = 0;
  if (type === "show") {
    const compactProgress = getCompactEpisodeStats(item);
    totalEps = compactProgress.total;
    watchedCount = compactProgress.watched;
    progress = compactProgress.percent;
  }

  const statusPill = (s, label) => {
    let cls = "status-pill";
    if (item.status === s) cls += ` ${s}-active`;
    return `<button type="button" class="${cls}" data-status="${s}" data-mylist-action="status" data-mylist-item-id="${item.id}" data-mylist-status="${s}" onclick="changeStatus('${item.id}','${s}')">${label}</button>`;
  };
  const statusButtons = getMyListStatusButtonConfigs(activeSection)
    .map(({ status, label }) => statusPill(status, label))
    .join('');

  let episodeToggleButton = "";
  let episodeSection = "";
  const hasFullEpisodeRows = type === "show" && Array.isArray(item.episodes) && item.episodes.length > 0;
  if (hasFullEpisodeRows) {
    episodeToggleButton = `
      <button type="button" class="ep-toggle-bar card-footer-btn" onclick="toggleEpisodes('${item.id}')">
        <span id="ep-label-${item.id}">Show Episodes</span>
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

  const dragAttrs = isDraggable
    ? `draggable="true" ondragstart="onCardDragStart(event,'${item.id}')" ondragover="onCardDragOver(event)" ondragleave="onCardDragLeave(event)" ondrop="onCardDrop(event,'${item.id}')"`
    : '';
  return `
    <div class="card ${type === "show" ? "show-card" : ""}${isGameCard ? " game-library-card" : ""} ${viewingUser ? "friend-view-card" : ""}${isDraggable ? ' card-draggable' : ''}" id="card-${item.id}" ${dragAttrs}>
      <div class="card-header">
        <div class="${coverClass}${coverProfileClass}" style="${coverStyle}" ${coverProfileAttrs}>
          ${!item.cover ? emoji : ''}
        </div>
        <div class="card-info">
          <div class="card-title-row">
            <div class="card-title">${gameTitleMarkup}${item.imdbId ? ` <a href="https://www.imdb.com/title/${item.imdbId}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="display:inline-flex;align-items:center;text-decoration:none;vertical-align:middle;">
            <span class="media-link-badge">IMDb</span>
          </a>` : ''}${activeSection === 'movies' ? `<button class="letterboxd-badge-btn" onclick="event.stopPropagation();openLetterboxd('${item.id}')" title="Letterboxd">
            <span class="letterboxd-badge">
              <svg viewBox="0 0 24 10" aria-hidden="true" fill="none">
                <circle cx="6" cy="5" r="4" fill="#FF8000"></circle>
                <circle cx="12" cy="5" r="4" fill="#00E054"></circle>
                <circle cx="18" cy="5" r="4" fill="#40BCF4"></circle>
              </svg>
            </span>
          </button>` : ''}${activeSection === 'games' ? renderMetacriticGameIcon(item, 'game-card-metacritic-icon') : ''}</div>
            ${!viewingUser ? `<button class="delete-btn" onclick="deleteItem(event,'${item.id}')" title="Delete">×</button>` : (currentUser ? `<button class="friend-card-add-btn${friendAlreadyAdded ? ' added' : ''}" data-friend-item-id="${escHtml(item.id)}" onclick="event.stopPropagation();openFriendAddModal(this.dataset.friendItemId, this)" title="Add to my list">+</button>` : '')}
          </div>
          ${item.genre ? `<div class="card-genre">${escHtml(item.genre)}</div>` : ''}
          ${!viewingUser ? `<div class="status-pills" id="status-pills-${item.id}">${statusButtons}</div>` : ''}
          ${type === "show" ? `
            <div class="progress-area">
              <div class="progress-meta"><span id="progress-count-${item.id}">${watchedCount}/${totalEps} episodes</span><span id="progress-percent-${item.id}">${Math.round(progress)}%</span></div>
              <div class="progress-bar"><div class="progress-fill" id="progress-fill-${item.id}" style="width:${progress}%"></div></div>
            </div>
          ` : ''}
          <div class="rating-area">
            <div class="rating-label">Overall Rating</div>
            ${renderStars(item.rating || 0, item.id, 'overall', 16)}
          </div>
        </div>
      </div>
      <div class="card-action-row">
        <div class="card-footer-actions">
          <button class="comments-btn" onclick="event.stopPropagation();openCommentsPage('${item.id}', this)">
            <span class="comments-btn-label">Comments (<span class="comment-count" data-media-key="${escAttr(mediaKey)}">${commentCount}</span>)</span>
          </button>
          ${isGameCard ? renderGameDetailsExpandButton(item) : ''}
          ${episodeToggleButton}
        </div>
        ${renderWatchTogetherCardControl(item, activeSection)}
      </div>
      ${isGameCard ? renderGameDetailsPanel(item) : ''}
      ${episodeSection}
      ${isGameCard && !viewingUser ? `<button class="game-card-edit-btn" type="button" onclick="event.stopPropagation();openGameDetailsEdit('${itemIdAttr}')" aria-label="Edit game details">${getScreenListGamePencilSvg()}</button>` : ''}
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
  if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  if (raw.startsWith('/')) return `https://image.tmdb.org/t/p/w500${raw}`;
  return raw;
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

function renderEpisodeList(item) {
  const eps = item.episodes || [];
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
      <div class="season-eps" id="s-eps-${item.id}-${sNum}" style="display:none">
        <div style="padding:6px 8px 10px;display:flex;align-items:center;gap:8px;">
          <span style="font-size:11px;color:#7a6f99;">Season Rating</span>
          ${renderStars((item.seasonRatings && item.seasonRatings[sNum]) || 0, item.id, 'season:' + sNum, 13)}
        </div>
        ${sEps.map(ep => renderSingleEp(item.id, ep)).join("")}
      </div>
    </div>`;
  }).join("");
}

function renderSingleEp(itemId, ep) {
  const r = ep.rating || 0;
  if (viewingUser) {
    return `<div class="ep-row ${ep.watched ? 'watched-ep' : ''}">
      <div class="ep-left">
        <span class="ep-check ${ep.watched ? 'checked' : ''}" style="cursor:default;">
          ${ep.watched ? '✓' : ''}
        </span>
        <span class="ep-name">${ep.epNum || ep.number}${ep.title ? ' — ' + escHtml(ep.title) : ''}</span>
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
      <span class="ep-name">${ep.epNum || ep.number}${ep.title ? ' — ' + escHtml(ep.title) : ''}</span>
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
  const ep = (item.episodes || []).find(e => e.id === epId);
  if (!ep) return;
  preserveEpisodeScroll(itemId, () => {
    ep.rating = (ep.rating === score && score !== 0) ? 0 : score;
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

function toggleSeason(itemId, sNum) {
  const el = document.getElementById('s-eps-' + itemId + '-' + sNum);
  const arrow = document.getElementById('s-arrow-' + itemId + '-' + sNum);
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  arrow.classList.toggle('open', !open);
  openStates['s-' + itemId + '-' + sNum] = !open;
}

function markSeasonEps(itemId, sNum, val) {
  const item = data[activeSection].find(i => i.id === itemId);
  if (!item) return;
  preserveViewport(() => {
    preserveEpisodeScroll(itemId, () => {
      item.episodes.forEach(e => { if (e.seasonNum === sNum) e.watched = val; });
      const statusChangedNow = applyScreenListEpisodeStatusOrDefer(item);
      touchItem(item);
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
  return gameLike?.background_image || gameLike?.cover || gameLike?.poster || '';
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
  return `<section class="discover-media-page game-media-page" role="dialog" aria-modal="true" aria-label="${escAttr(title)} details">
    <button class="discover-media-back" type="button" onclick="closeGameMediaProfile('back')">Back</button>
    ${renderMediaProfileTopActions(renderMediaProfileShareButton('game', rawgId || getGameRawgIdValue(seed), title, poster), rawgId ? renderGameMediaProfileAddButton(rawgId, seed) : '')}
    <div class="discover-media-hero game-media-hero" style="${poster ? `background-image:url('${escAttr(poster)}')` : ''}">
      <div class="discover-media-hero-shade"></div>
      <div class="discover-media-hero-content">
        <div class="discover-media-poster game-media-poster">${poster ? `<img src="${escAttr(poster)}" alt="">` : ''}</div>
        <div class="discover-media-kicker">Game Profile${year ? ` · ${escHtml(year)}` : ''}</div>
        <h2>${escHtml(title)}</h2>
        <p>${escHtml(overview)}</p>
      </div>
    </div>
    <div class="discover-media-body">
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

function getLetterboxdMediaUrl(details = {}) {
  const imdbId = details.imdb_id || details.external_ids?.imdb_id || '';
  return imdbId ? `https://letterboxd.com/imdb/${imdbId}/` : 'https://letterboxd.com/';
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
    { key: 'letterboxd', title: 'Letterboxd', url: getLetterboxdMediaUrl(details), className: 'letterboxd', logo: PROFILE_EXPORT_LOGO_ASSETS.letterboxd },
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
  const defs = [
    { key: 'flatrate', label: 'Stream' },
    { key: 'free', label: 'Free' },
    { key: 'ads', label: 'With Ads' },
    { key: 'rent', label: 'Rent' },
    { key: 'buy', label: 'Buy' }
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
    ${renderMediaProfileTopActions(renderMediaProfileShareButton('game', rawgId || getGameRawgIdValue(details), title, poster), renderGameMediaProfileAddButton(rawgId || getGameRawgIdValue(details), details))}
    <div class="discover-media-hero game-media-hero" style="${poster ? `background-image:url('${escAttr(poster)}')` : ''}">
      <div class="discover-media-hero-shade"></div>
      <div class="discover-media-hero-content">
        <div class="discover-media-poster game-media-poster">${poster ? `<img src="${escAttr(poster)}" alt="">` : ''}</div>
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
  const res = await fetchRawgProxy('games', { search: title, page_size: 1 });
  if (!res.ok) throw new Error(`RAWG search failed: ${res.status}`);
  const json = await res.json();
  return json?.results?.[0]?.id ? String(json.results[0].id) : '';
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
  overlay.innerHTML = renderGameMediaProfileShell(initialSeed, rawgId);
  bindGameMediaProfileActions(overlay);
  document.body.appendChild(overlay);
  document.body.classList.add('discover-media-profile-open', 'game-media-profile-open');
  document.addEventListener('keydown', handleGameMediaProfileEsc);
  revealMediaProfileOverlay(overlay, transitionOrigin, event);

  try {
    const resolvedId = rawgId || await resolveRawgIdForGameSeed(initialSeed);
    if (!resolvedId) {
      if (!document.getElementById('discover-media-profile')) return;
      const mergedGameDetails = { ...initialSeed, rawgId: '' };
      overlay.innerHTML = renderGameMediaProfileDetails(mergedGameDetails, '');
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
    const mergedGameDetails = { ...initialSeed, ...details, rawgId: String(resolvedId) };
    overlay.innerHTML = renderGameMediaProfileDetails(mergedGameDetails, String(resolvedId));
    bindGameMediaProfileActions(overlay);
    hydrateDeepSeekMoreLikeThis('game', mergedGameDetails);
  } catch (e) {
    console.error('Game media profile failed:', e);
    if (!document.getElementById('discover-media-profile')) return;
    const mergedGameDetails = { ...initialSeed, rawgId: rawgId || getGameRawgIdValue(initialSeed) };
    overlay.innerHTML = renderGameMediaProfileDetails(mergedGameDetails, rawgId || getGameRawgIdValue(initialSeed));
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

// Actions
function switchSection(s) {
  if (!isSectionVisibleInMyLists(s)) return;
  if (activeSection === s) return;
  activeSection = s;
  activeTab = getDefaultTabForSection(s);
  closeSortDropdown();
  runMyListInternalPageJump(() => {
    render();
    persistUiState();
    requestAnimationFrame(() => updateSlidingPills());
  });
}
function switchTab(t) {
  if (!isVisibleMyListStatusTab(t, activeSection)) return;
  if (activeTab === t) return;
  activeTab = t;
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

function initMyListSwipe() {
  if (typeof initMyListInteractionFallbacks === 'function') initMyListInteractionFallbacks();
  if (typeof removeMyListSwipeArtifacts === 'function') removeMyListSwipeArtifacts();
}

function initMyListEdgeSwipeListeners() {
  window.__shelfdMyListEdgeSwipeV300Disabled = true;
  removeMyListSwipeArtifacts();
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
  if (!button || button.disabled || viewingUser) return;
  const action = button.dataset.mylistAction || '';
  const itemId = button.dataset.mylistItemId || '';
  if (!action || !itemId) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  if (action === 'status') {
    const status = button.dataset.mylistStatus || button.dataset.status || '';
    if (status) changeStatus(itemId, status);
    return;
  }

  if (action === 'toggle-ep') {
    const epId = button.dataset.mylistEpisodeId || '';
    if (epId) toggleEp(itemId, epId);
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

function _swStart() {}
function _swMove() {}
function _swEnd() { removeMyListSwipeArtifacts(); }
function _swCancel() { removeMyListSwipeArtifacts(); }
// ─────────────────────────────────────────────────────────────────────────────

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
  // Width + height set directly (no transition) — only transform animates
  pill.style.width = w + 'px';
  pill.style.height = h + 'px';
  pill.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
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
  if (viewingUser && typeof backToMyList === 'function') {
    await backToMyList('mylist');
    activeSection = 'shows';
    activeTab = 'watching';
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
  searchQuery = q;
  render();
}

function applyMyListStatusChange(id, status, rating = null) {
  const items = data[activeSection];
  const item = items.find(i => i.id === id);
  if (!item) return null;
  item.status = status;
  if (rating !== null && rating !== undefined && Number(rating || 0) > 0) {
    item.rating = Number(rating || 0);
  }
  item.dateModified = new Date().toISOString();
  if (isShowSection(activeSection)) {
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
  const items = data[activeSection];
  const item = items.find(i => i.id === id);
  if (!item) return;
  const validStatuses = getMyListStatusButtonConfigs(activeSection).map(entry => entry.status);
  if (!validStatuses.includes(status)) return;
  const wasCompleted = item.status === "watched";
  if (status === "watched" && !wasCompleted && typeof openScreenListCompletionRatingPrompt === 'function') {
    openScreenListCompletionRatingPrompt({
      item: { ...item },
      section: activeSection,
      status,
      initialRating: Number(item.rating || 0),
      source: 'my-list-status',
      onApply: async (rating) => {
        const updated = applyMyListStatusChange(id, status, rating);
        return {
          ok: !!updated,
          item: updated ? { ...updated } : item,
          section: activeSection,
          status,
          rating: Number(rating || updated?.rating || 0) || 0
        };
      }
    });
    return;
  }
  applyMyListStatusChange(id, status, null);
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

let _lastRate = { key: null, time: 0 };
function rate(itemId, prefix, score) {
  // Debounce: ignore identical rate within 350ms (prevents touch+click double-fire from toggling off)
  const key = itemId + '|' + prefix + '|' + score;
  const now = Date.now();
  if (_lastRate.key === key && now - _lastRate.time < 350) return;
  _lastRate = { key, time: now };

  const items = data[activeSection];
  const item = items.find(i => i.id === itemId);
  if (!item) return;
  if (prefix === "overall") {
    item.rating = item.rating === score ? 0 : score;
  } else if (prefix.startsWith("season:")) {
    const sNum = parseInt(prefix.slice(7));
    if (!item.seasonRatings) item.seasonRatings = {};
    item.seasonRatings[sNum] = (item.seasonRatings[sNum] === score) ? 0 : score;
  } else if (prefix.startsWith("ep:")) {
    const epId = prefix.slice(3);
    const ep = (item.episodes || []).find(e => e.id === epId);
    if (ep) ep.rating = ep.rating === score ? 0 : score;
  }
  touchItem(item);
  save(); render();
  if (score > 0) playRatingAnimation(itemId, prefix);
}

function playRatingAnimation(itemId, prefix) {
  // Look up the actual score from the data so animation intensity matches
  const item = data[activeSection].find(i => i.id === itemId);
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
      lit.forEach((star, i) => {
        // Tell the browser to promote this element to its own GPU layer for the animation
        star.style.willChange = 'transform, filter';
        const anim = star.animate([
          { transform: 'scale(1)', filter: 'none' },
          { transform: `scale(${peakScale})`, filter: peakFilter, offset: 0.3 },
          { transform: `scale(${midScale})`, filter: 'none', offset: 0.6 },
          { transform: 'scale(1)', filter: 'none' }
        ], { duration, delay: i * stagger, easing: 'ease-out', fill: 'none' });
        anim.onfinish = () => { star.style.willChange = ''; };
      });

      const label = c.querySelector('.star-label');
      if (label) {
        label.style.willChange = 'transform, color';
        const lAnim = label.animate([
          { transform: 'scale(1)', color: '' },
          { transform: `scale(${1.15 + t * 0.35})`, color: '#fbbf24', offset: 0.4 },
          { transform: 'scale(1)', color: '' }
        ], { duration: 500 + t * 180, delay: 100 + t * 70, easing: 'ease-out' });
        lAnim.onfinish = () => { label.style.willChange = ''; };
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
  if (!list) return;
  if (list._episodesTransitionHandler) {
    list.removeEventListener('transitionend', list._episodesTransitionHandler);
    list._episodesTransitionHandler = null;
  }

  const startHeight = list.getBoundingClientRect().height;
  const content = list.querySelector('.ep-list-inner');

  if (shouldOpen) {
    list.classList.add('open');
    if (immediate) {
      list.style.height = 'auto';
      return;
    }
    list.style.height = startHeight + 'px';
    const targetHeight = content ? Math.ceil(content.getBoundingClientRect().height) : list.scrollHeight;
    void list.offsetHeight;
    list.style.height = targetHeight + 'px';
  } else {
    list.style.height = startHeight + 'px';
    void list.offsetHeight;
    list.classList.remove('open');
    if (immediate) {
      list.style.height = '0px';
      return;
    }
    list.style.height = '0px';
  }

  const onTransitionEnd = (e) => {
    if (e.propertyName !== 'height') return;
    if (shouldOpen) {
      requestAnimationFrame(() => {
        if (list.classList.contains('open')) list.style.height = 'auto';
      });
    }
    list.removeEventListener('transitionend', onTransitionEnd);
    list._episodesTransitionHandler = null;
  };

  list._episodesTransitionHandler = onTransitionEnd;
  list.addEventListener('transitionend', onTransitionEnd);
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
  label.textContent = open ? 'Show Episodes' : 'Hide Episodes';
  openStates['ep-' + id] = !open;
  if (!open) hydrateMissingSeasonPosters(id, activeSection);
  if (open) {
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
  return item.status === activeTab &&
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
    ['live-active', 'watching-active', 'planned-active', 'watched-active', 'paused-active', 'dropped-active']
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

function toggleEp(itemId, epId) {
  const item = data[activeSection].find(i => i.id === itemId);
  if (!item) return;
  const ep = item.episodes.find(e => e.id === epId);
  if (!ep) return;
  let becameWatched = false;
  preserveEpisodeScroll(itemId, () => {
    ep.watched = !ep.watched;
    becameWatched = ep.watched;
    const statusChangedNow = applyScreenListEpisodeStatusOrDefer(item);
    touchItem(item);
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
  preserveViewport(() => {
    preserveEpisodeScroll(id, () => {
      item.episodes.forEach(e => e.watched = val);
      const statusChangedNow = applyScreenListEpisodeStatusOrDefer(item);
      touchItem(item);
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
