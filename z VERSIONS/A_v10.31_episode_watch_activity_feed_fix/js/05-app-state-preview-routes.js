/* v705: changed `let` to `var` so cross-file `window.activeSection = ...`
   actually mutates this binding. With `let` at script-top-level, the binding
   lives in the module record but does NOT become a property of `window`,
   which broke the Discover>Games add sheet (saves were routing to TV shows
   because submitModal still saw activeSection='shows'). Same fix as v691
   applied to selectedTmdb. */
var activeSection = "shows";
var activeTab = "watching";
let activeDiscoveryHub = "tv";
let searchQuery = "";
let openStates = {};
let saveTimeout = null;

// Sort state — session-only (resets on page refresh/leave, never persisted)
let sessionSortState = {};   // { "section:tab": sortKey }
let sessionSortDirectionState = {}; // { "section:tab": 'asc' | 'desc' }
let sessionRenderedSortOrder = {}; // { "section:tab": [id, ...] }
let sessionLastEditedResortHold = {}; // delays Last Edited visual resort until navigation changes
let sessionCustomOrder = {}; // { "section:tab": [id, ...] }
const DEFAULT_SORT = 'recently-added';
const WATCHED_RATING_DEFAULT_SECTIONS = new Set(['movies', 'shows', 'anime']);
const WATCHLIST_PRIORITY_SECTIONS = new Set(['movies', 'shows', 'anime']);
const SORT_OPTIONS = [
  { key: 'recently-added',    label: 'Recently Added' },
  { key: 'title-az',          label: 'Title A–Z' },
  { key: 'rating-high',       label: 'Highest Rated' },
  { key: 'rating-low',        label: 'Lowest Rated' },
  { key: 'release-newest',    label: 'Newest Release' },
  { key: 'release-oldest',    label: 'Oldest Release' },
  { key: 'custom',            label: 'Custom Order' },
];

// v435: Games-only sort options. Removed Popularity, Trending, Avg Play Time,
// Avg Finish Time. Added Total Hours (sorts by user's logged playtime). Renamed
// "When Added" → "Date Added" (key stays `recently-added` for compat).
const GAME_SORT_OPTIONS = [
  { key: 'recently-added',    label: 'Date Added' },
  { key: 'last-edited',       label: 'Last Edited' },
  { key: 'last-played',       label: 'Last Played' },
  { key: 'time-played',       label: 'Time Played' },
  { key: 'total-hours',       label: 'Total Hours' },
  { key: 'rating-high',       label: 'User Rating' },
  { key: 'game-rating',       label: 'Game Rating' },
  { key: 'title-az',          label: 'Game Title' },
  { key: 'release-newest',    label: 'Release Date' },
];

const LAST_EDITED_SORT_SECTIONS = new Set(['games', 'shows', 'anime']);

function normalizeSortDirection(value = '') { return value === 'asc' ? 'asc' : 'desc'; }
function getSortOptionsForSection(section = activeSection) {
  const base = section === 'games' ? GAME_SORT_OPTIONS : SORT_OPTIONS;
  if (!LAST_EDITED_SORT_SECTIONS.has(section) || section === 'games') return base;
  if (base.some(option => option.key === 'last-edited')) return base;
  const next = [...base];
  const insertAt = Math.max(1, next.findIndex(option => option.key === 'title-az'));
  next.splice(insertAt, 0, { key: 'last-edited', label: 'Last Edited' });
  return next;
}
function getDefaultSortDirectionFor(sortKey = getActiveSortKey()) {
  switch (sortKey) {
    case 'watchlist-priority':
    case 'title-az':
    case 'rating-low':
    case 'release-oldest':
    case 'avg-play-time':
    case 'avg-finish-time':
      return 'asc';
    default:
      return 'desc';
  }
}
function getActiveSortDirection(stateKey = getSortStateKey(), sortKey = getActiveSortKey()) {
  return normalizeSortDirection(sessionSortDirectionState[stateKey] || getDefaultSortDirectionFor(sortKey));
}
function toggleSortDirection(event = null) {
  event?.stopPropagation?.();
  const stateKey = getSortStateKey();
  const current = getActiveSortDirection(stateKey, getActiveSortKey());
  sessionSortDirectionState[stateKey] = current === 'asc' ? 'desc' : 'asc';
  clearLastEditedResortHold(stateKey);
  closeSortDropdown();
  render();
}
function getSortItemKey(item = {}) {
  return String(item?.id || (typeof getScreenListGameStableKey === 'function' ? getScreenListGameStableKey(item) : '') || item?.title || '');
}
function rememberRenderedSortOrder(stateKey = getSortStateKey(), items = []) {
  if (!stateKey || !Array.isArray(items)) return;
  sessionRenderedSortOrder[stateKey] = items.map(getSortItemKey).filter(Boolean);
}
function clearLastEditedResortHold(stateKey = '') {
  if (stateKey) delete sessionLastEditedResortHold[stateKey];
  else sessionLastEditedResortHold = {};
}
function getItemLastEditedTime(item = {}) {
  const candidates = [item.lastEditedAt, item.dateLastEdited, item.lastEdited, item.dateModified, item.updatedAt, item.dateAdded];
  for (const value of candidates) {
    if (!value) continue;
    const ms = typeof value === 'number' ? value : new Date(value).getTime();
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return 0;
}
function shouldTrackLastEditedForSection(section = activeSection) {
  return LAST_EDITED_SORT_SECTIONS.has(section);
}
function markOwnItemLastEdited(item = null, section = activeSection) {
  if (!item || !shouldTrackLastEditedForSection(section)) return item;
  const now = new Date().toISOString();
  item.lastEditedAt = now;
  item.dateModified = now;
  const stateKey = getSortStateKey();
  // v441: always hold the current sort order after any in-session edit so the
  // card doesn't jump position immediately. The hold is cleared by switchTab /
  // switchSection so the correct order is restored when the user returns.
  sessionLastEditedResortHold[stateKey] = true;
  return item;
}

function getSortStateKey(section = activeSection, tab = activeTab) { return section + ':' + tab; }
function getDefaultSortKeyFor(section = activeSection, tab = activeTab) {
  const normalizedSection = String(section || '').trim();
  const normalizedTab = String(tab || '').trim();
  // v431: Games → Playing (single-player) and Games → Live Games default to the
  // hybrid sort — top 3 by Steam last-played, then everything else by hours played.
  // (Manual sort selections from the dropdown are still respected — sessionSortState
  // overrides this default.) The hybrid key is intentionally not in GAME_SORT_OPTIONS,
  // so it only ever appears as the default; user-pickable options stay clean.
  if (normalizedSection === 'games' && (normalizedTab === 'watching' || normalizedTab === 'live')) {
    return 'live-recent-hybrid';
  }
  if ((normalizedSection === 'shows' || normalizedSection === 'anime') && normalizedTab === 'watching') {
    return 'last-edited';
  }
  if (WATCHLIST_PRIORITY_SECTIONS.has(normalizedSection) && normalizedTab === 'planned') {
    return 'watchlist-priority';
  }
  /* v690: Watched (shows/movies/anime) and Played (games) default to
     last-edited — most-recently-touched first. "Last edited" falls back
     to dateAdded when no lastEditedAt is set, so it covers "last added"
     as well. Applied to both own-profile and friend-profile views. */
  if (normalizedTab === 'watched') return 'last-edited';
  return DEFAULT_SORT;
}
// v435: stale sort keys (popularity/trending/avg-play-time/avg-finish-time) that
// were selected before they were removed from the Games dropdown should fall back
// to the section default instead of leaving the list unsorted.
const SHELFD_RETIRED_GAME_SORT_KEYS = new Set(['popularity', 'trending', 'avg-play-time', 'avg-finish-time']);
function getActiveSortKey() {
  const stored = sessionSortState[getSortStateKey()];
  if (typeof activeSection !== 'undefined' && activeSection === 'games' && stored && SHELFD_RETIRED_GAME_SORT_KEYS.has(stored)) {
    return getDefaultSortKeyFor();
  }
  return stored || getDefaultSortKeyFor();
}

function setSortOrder(key) {
  const stateKey = getSortStateKey();
  const previousKey = sessionSortState[stateKey] || getDefaultSortKeyFor();
  sessionSortState[stateKey] = key;
  if (previousKey !== key) sessionSortDirectionState[stateKey] = getDefaultSortDirectionFor(key);
  clearLastEditedResortHold(stateKey);
  if (key === 'custom' && !sessionCustomOrder[stateKey]) {
    const visibleData = getVisibleListData();
    const items = (visibleData[activeSection] || []).filter(i => {
      if (typeof itemMatchesActiveListStatus === 'function') return itemMatchesActiveListStatus(i);
      return i.status === activeTab;
    });
    sessionCustomOrder[stateKey] = applySortOrder(items, getDefaultSortKeyFor(), stateKey).map(getSortItemKey);
  }
  closeSortDropdown();
  render();
}

function applySortOrder(items, sortKey, stateKey) {
  const arr = [...items];
  const activeDirection = getActiveSortDirection(stateKey || getSortStateKey(), sortKey);
  const defaultDirection = getDefaultSortDirectionFor(sortKey);

  // v441: apply the hold to ALL sort keys, not just 'last-edited'. This prevents
  // a card from jumping in position the instant a user edits its rating, marks
  // episodes, or changes progress inside the currently visible tab. The hold is
  // activated by markOwnItemLastEdited / _shelfdMarkRatingEdit and is cleared
  // automatically whenever the user switches tab, section, or sort key.
  if (stateKey && sessionLastEditedResortHold[stateKey] && sessionRenderedSortOrder[stateKey]?.length) {
    const order = sessionRenderedSortOrder[stateKey];
    const idx = {};
    order.forEach((id, i) => { idx[id] = i; });
    return arr.sort((a, b) => {
      const ak = getSortItemKey(a);
      const bk = getSortItemKey(b);
      const ai = Object.prototype.hasOwnProperty.call(idx, ak) ? idx[ak] : 99999;
      const bi = Object.prototype.hasOwnProperty.call(idx, bk) ? idx[bk] : 99999;
      if (ai !== bi) return ai - bi;
      return getItemLastEditedTime(b) - getItemLastEditedTime(a);
    });
  }

  switch (sortKey) {
    case 'watchlist-priority': {
      const fallback = [...arr].sort((a, b) => new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0));
      const fallbackIndex = {};
      fallback.forEach((item, index) => { fallbackIndex[getSortItemKey(item)] = index; });
      arr.sort((a, b) => {
        const ap = Number(a.watchPriority || 0);
        const bp = Number(b.watchPriority || 0);
        const ah = Number.isFinite(ap) && ap > 0;
        const bh = Number.isFinite(bp) && bp > 0;
        if (ah && bh && ap !== bp) return ap - bp;
        if (ah !== bh) return ah ? -1 : 1;
        return (fallbackIndex[getSortItemKey(a)] ?? 99999) - (fallbackIndex[getSortItemKey(b)] ?? 99999);
      });
      break;
    }
    case 'recently-added':
      arr.sort((a, b) => new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0));
      break;
    case 'last-edited':
      arr.sort((a, b) => getItemLastEditedTime(b) - getItemLastEditedTime(a));
      break;
    case 'title-az':
      arr.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      break;
    case 'rating-high':
      arr.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      break;
    case 'rating-low':
      arr.sort((a, b) => (a.rating || 0) - (b.rating || 0));
      break;
    case 'release-newest':
      arr.sort((a, b) => (parseInt(b.year) || 0) - (parseInt(a.year) || 0));
      break;
    case 'release-oldest':
      arr.sort((a, b) => (parseInt(a.year) || 0) - (parseInt(b.year) || 0));
      break;
    case 'last-played':
      // v430: also read lastPlayedAt (Steam import sets this from rtime_last_played).
      // Tiebreaker on hours so games with equal/missing dates still sort meaningfully.
      arr.sort((a, b) => {
        const tb = new Date(b.lastPlayed || b.lastPlayedDate || b.lastPlayedAt || 0).getTime() || 0;
        const ta = new Date(a.lastPlayed || a.lastPlayedDate || a.lastPlayedAt || 0).getTime() || 0;
        if (tb !== ta) return tb - ta;
        return (Number(b.hoursPlayed || b.gameHoursPlayed || b.playtimeHours || 0)) -
               (Number(a.hoursPlayed || a.gameHoursPlayed || a.playtimeHours || 0));
      });
      break;
    case 'live-recent-hybrid': {
      // v431: Games → Playing / Live Games default sort. Top 3 are the most recently
      // launched titles (only games WITH a real last-played timestamp qualify); the
      // remainder of the list is sorted by total hours played descending. Titles
      // without any last-played data never push a real recent title out of top 3.
      const withRecent = [];
      const noRecent = [];
      for (const item of arr) {
        const ts = new Date(item.lastPlayed || item.lastPlayedDate || item.lastPlayedAt || 0).getTime() || 0;
        if (ts > 0) withRecent.push({ item, ts });
        else noRecent.push(item);
      }
      withRecent.sort((a, b) => b.ts - a.ts);
      const top = withRecent.slice(0, 3).map(x => x.item);
      const tail = [
        ...withRecent.slice(3).map(x => x.item),
        ...noRecent
      ];
      tail.sort((a, b) =>
        (Number(b.hoursPlayed || b.gameHoursPlayed || b.playtimeHours || 0)) -
        (Number(a.hoursPlayed || a.gameHoursPlayed || a.playtimeHours || 0)));
      return [...top, ...tail];
    }
    case 'time-played':
    case 'total-hours':
      // v435: Total Hours mirrors Time Played — both sort by user playtime desc.
      // Games without recorded hours fall to the back (treated as 0).
      arr.sort((a, b) =>
        (Number(b.hoursPlayed || b.gameHoursPlayed || b.playtimeHours || b.totalHours || b.playtimeForever || 0)) -
        (Number(a.hoursPlayed || a.gameHoursPlayed || a.playtimeHours || a.totalHours || a.playtimeForever || 0)));
      break;
    case 'game-rating':
      arr.sort((a, b) => (Number(b.metacritic || 0)) - (Number(a.metacritic || 0)));
      break;
    case 'popularity':
      arr.sort((a, b) => (Number(b.popularity || b.added || 0)) - (Number(a.popularity || a.added || 0)));
      break;
    case 'trending':
      arr.sort((a, b) => new Date(b.dateModified || b.dateAdded || 0) - new Date(a.dateModified || a.dateAdded || 0));
      break;
    case 'avg-play-time':
      arr.sort((a, b) => (Number(a.avgPlayTime || a.hltbMain || 0)) - (Number(b.avgPlayTime || b.hltbMain || 0)));
      break;
    case 'avg-finish-time':
      arr.sort((a, b) => (Number(a.avgFinishTime || a.hltbCompletionist || 0)) - (Number(b.avgFinishTime || b.hltbCompletionist || 0)));
      break;
    case 'custom': {
      const order = (stateKey && sessionCustomOrder[stateKey]) || [];
      if (!order.length) return arr;
      const idx = {};
      order.forEach((id, i) => { idx[id] = i; });
      return arr.sort((a, b) =>
        (idx[getSortItemKey(a)] !== undefined ? idx[getSortItemKey(a)] : 9999) -
        (idx[getSortItemKey(b)] !== undefined ? idx[getSortItemKey(b)] : 9999));
    }
    default:
      return arr;
  }

  if (sortKey !== 'custom' && activeDirection !== defaultDirection) arr.reverse();
  return arr;
}

function closeSortDropdown() {
  const m = document.getElementById('sort-dropdown-menu');
  if (m) m.remove();
}

function toggleSortDropdown(e) {
  if (e) e.stopPropagation();
  const existing = document.getElementById('sort-dropdown-menu');
  if (existing) { existing.remove(); return; }
  const btn = document.getElementById('sort-dropdown-btn');
  if (!btn) return;
  const activeSortKey = getActiveSortKey();
  const activeDirection = getActiveSortDirection(getSortStateKey(), activeSortKey);
  const menu = document.createElement('div');
  menu.id = 'sort-dropdown-menu';
  menu.className = 'sort-dropdown-menu';
  const directionBtn = document.createElement('button');
  directionBtn.className = 'sort-direction-toggle';
  directionBtn.type = 'button';
  directionBtn.innerHTML = `<span>${activeDirection === 'asc' ? 'Ascending' : 'Descending'}</span><strong>${activeDirection === 'asc' ? '↑' : '↓'}</strong>`;
  directionBtn.onclick = toggleSortDirection;
  menu.appendChild(directionBtn);
  const sortOptions = getSortOptionsForSection(activeSection);
  sortOptions.forEach(opt => {
    const el = document.createElement('button');
    el.className = 'sort-dropdown-item' + (opt.key === activeSortKey ? ' active' : '');
    el.textContent = opt.label;
    el.onclick = () => setSortOrder(opt.key);
    menu.appendChild(el);
  });
  document.body.appendChild(menu);
  const rect = btn.getBoundingClientRect();
  menu.style.top = (rect.bottom + window.scrollY + 4) + 'px';
  const rightOffset = window.innerWidth - rect.right;
  menu.style.right = rightOffset + 'px';
  setTimeout(() => document.addEventListener('click', closeSortDropdown, { once: true }), 0);
}

function touchItem(item) {
  if (item) item.dateModified = new Date().toISOString();
  return item;
}

// Custom order drag-and-drop
let _dragSrcId = null;
function onCardDragStart(e, id) {
  _dragSrcId = id;
  e.dataTransfer.effectAllowed = 'move';
}
function onCardDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const card = e.currentTarget;
  card.classList.add('drag-over');
}
function onCardDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}
function onCardDrop(e, id) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (!_dragSrcId || _dragSrcId === id) return;
  const stateKey = getSortStateKey();
  let order = sessionCustomOrder[stateKey] ? [...sessionCustomOrder[stateKey]] : [];
  const from = order.indexOf(_dragSrcId);
  const to = order.indexOf(id);
  if (from === -1 || to === -1) return;
  order.splice(from, 1);
  order.splice(to, 0, _dragSrcId);
  sessionCustomOrder[stateKey] = order;
  _dragSrcId = null;
  render();
}
let friends = []; // mutually confirmed friends (UIDs)
let incomingRequests = []; // requests they sent me, awaiting my accept
let outgoingRequests = []; // requests I sent, awaiting their accept
let activeFriendsTab = 'activity';
let activeRequestsSubTab = 'friends';
let activeActivitySubTab = 'feed';
let mainNavSwitching = false;
let allUsersCache = []; // search result cache for Find People
let peopleSearchTimeout = null;
let usersMap = {}; // uid -> { name, photo } for safe lookups
let friendProfilesPromise = null;
let friendProfilesPromiseKey = '';
let friendsDataUnsubscribe = null; // realtime listener for friends/requests
let friendsDataLoadedOnce = false;
let friendActivityWatchlistUnsubscribes = [];
let friendActivityCommentsUnsubscribe = null;
let friendActivityLiveKey = '';
let friendActivityUnread = false;
let friendActivityStorySeenAtSnapshot = 0;
let friendActivityRenderTimer = null;
let friendActivityWatchlistState = {};
let friendActivityLiveEvents = [];

function isPreviewMode() {
  return document.body.classList.contains('preview-mode');
}
function getPreviewItemCount() {
  return SCREENLIST_SECTIONS.flatMap(section => data[section] || []).filter(i => (i.title || '').trim() !== '').length;
}
async function primeFriendProfiles(force = false) {
  if (isPreviewMode() || !currentUser || !friends.length) return [];
  const key = friends.slice().sort().join('|');
  const missing = friends.filter(uid => !usersMap[uid] || !usersMap[uid].name);
  if (!force && missing.length === 0) {
    return friends.map(uid => usersMap[uid]).filter(Boolean);
  }
  if (!force && friendProfilesPromise && friendProfilesPromiseKey === key) {
    return friendProfilesPromise;
  }

  friendProfilesPromiseKey = key;
  friendProfilesPromise = Promise.all(friends.map(async uid => {
    if (!force && usersMap[uid] && usersMap[uid].name) return usersMap[uid];
    try {
      const doc = await db.collection("users").doc(uid).get();
      if (!doc.exists) return null;
      const user = { ...doc.data(), uid };
      usersMap[uid] = user;
      return user;
    } catch (e) {
      console.error("Friend profile preload failed:", e);
      return usersMap[uid] || null;
    }
  })).finally(() => {
    friendProfilesPromise = null;
  });

  return friendProfilesPromise;
}

function isDuplicateTitle(title, section, excludeId = null) {
  const normalized = (title || '').trim().toLowerCase();
  if (!normalized) return false;
  return (data[section] || []).some(item =>
    item &&
    item.id !== excludeId &&
    (item.title || '').trim().toLowerCase() === normalized
  );
}

const DEMO_DATA = {
  shows: [
    { id:'d1', title:'Game of Thrones', genre:'Drama, Sci-Fi & Fantasy, Action & Adventure', status:'watching', rating:9, currentEp:3, totalEps:73, imdbId:'tt0944947', cover:'https://image.tmdb.org/t/p/w500/u3bZgnGQ9T01sWNhyveQz0wH0Hl.jpg', episodes:[
      { id:'got-s1e1', season:1, number:1, title:'Winter Is Coming', watched:true, rating:9 },
      { id:'got-s1e2', season:1, number:2, title:'The Kingsroad', watched:true, rating:8 },
      { id:'got-s1e3', season:1, number:3, title:'Lord Snow', watched:true, rating:8 },
      { id:'got-s1e4', season:1, number:4, title:'Cripples, Bastards, and Broken Things', watched:false, rating:0 },
      { id:'got-s1e5', season:1, number:5, title:'The Wolf and the Lion', watched:false, rating:0 }
    ] }
  ],
  anime: [],
  movies: [
    { id:'m1', title:'Spider-Man: Across the Spider-Verse', genre:'Animation, Action, Adventure', status:'planned', rating:9, imdbId:'tt9362722', cover:'https://image.tmdb.org/t/p/w500/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg' }
  ],
  games: [
    { id:'g1', title:'GTA V', genre:'Action, Open World', status:'watching', rating:9, currentEp:45, totalEps:69, cover:'https://images.igdb.com/igdb/image/upload/t_cover_big/co2lbd.jpg', episodes:[] }
  ]
};

const PREVIEW_COMMUNITY_USERS = [
  {
    uid: 'preview-lena',
    name: 'Lena Knox',
    photo: 'https://ui-avatars.com/api/?name=Lena+Knox&background=1e2028&color=60a5fa',
    stats: '12 tracked · Watching 4',
    findStats: 'Public preview profile · Tap to explore',
    listData: {
      shows: [
        { id: 'pl-s1', title: 'Game of Thrones', genre: 'Drama, Sci-Fi & Fantasy', status: 'watching', rating: 10, currentEp: 6, totalEps: 73, imdbId: 'tt0944947', cover: 'https://image.tmdb.org/t/p/w500/u3bZgnGQ9T01sWNhyveQz0wH0Hl.jpg' },
        { id: 'pl-s2', title: 'Severance', genre: 'Drama, Mystery, Sci-Fi & Fantasy', status: 'planned', rating: 0, totalEps: 19, imdbId: 'tt11280740', cover: 'https://image.tmdb.org/t/p/w500/7WTsnHkbA0FaG6R9twfFde0I9hl.jpg' }
      ],
      movies: [
        { id: 'pl-m1', title: 'Dune: Part Two', genre: 'Science Fiction, Adventure', status: 'watched', rating: 9, imdbId: 'tt15239678', cover: 'https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg' }
      ],
      anime: [
        { id: 'pl-a1', title: 'Frieren: Beyond Journey’s End', genre: 'Animation, Drama, Fantasy', status: 'watching', rating: 9, totalEps: 28, imdbId: 'tt22248376', cover: 'https://image.tmdb.org/t/p/w500/dqZENchTd7lp5zht7BdlqM7RBhN.jpg' }
      ],
      games: [
        { id: 'pl-g1', title: 'Hades', genre: 'Roguelike, Action', status: 'watched', rating: 10, cover: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1r7f.jpg', episodes: [] }
      ]
    }
  },
  {
    uid: 'preview-marcus',
    name: 'Marcus Vale',
    photo: 'https://ui-avatars.com/api/?name=Marcus+Vale&background=2a1f5e&color=f8fafc',
    stats: '9 tracked · Rated 7 this month',
    findStats: 'Preview community member · Tap to explore',
    listData: {
      shows: [
        { id: 'pm-s1', title: 'Andor', genre: 'Drama, Sci-Fi & Fantasy', status: 'watched', rating: 9, totalEps: 12, imdbId: 'tt9253284', cover: 'https://image.tmdb.org/t/p/w500/59SVNwLfoMnZPPB6ukW6dlPxAdI.jpg' }
      ],
      movies: [
        { id: 'pm-m1', title: 'Spider-Man: Across the Spider-Verse', genre: 'Animation, Action, Adventure', status: 'planned', rating: 9, imdbId: 'tt9362722', cover: 'https://image.tmdb.org/t/p/w500/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg' }
      ],
      anime: [],
      games: [
        { id: 'pm-g1', title: 'Baldur’s Gate 3', genre: 'RPG, Strategy', status: 'watching', rating: 10, cover: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co670h.jpg', episodes: [] }
      ]
    }
  },
  {
    uid: 'preview-yara',
    name: 'Yara Bloom',
    photo: 'https://ui-avatars.com/api/?name=Yara+Bloom&background=111827&color=93c5fd',
    stats: '14 tracked · Loves anime nights',
    findStats: 'Preview community member · Tap to explore',
    listData: {
      shows: [
        { id: 'py-s1', title: 'The Bear', genre: 'Drama, Comedy', status: 'planned', rating: 0, totalEps: 28, imdbId: 'tt14452776', cover: 'https://image.tmdb.org/t/p/w500/sHFlbKS3WLqMnp9tN5J6Lr3q13Q.jpg' }
      ],
      movies: [
        { id: 'py-m1', title: 'Everything Everywhere All at Once', genre: 'Action, Adventure, Science Fiction', status: 'watched', rating: 10, imdbId: 'tt6710474', cover: 'https://image.tmdb.org/t/p/w500/w3LxiVYdWWRvEVdn5RYq6jIqkb1.jpg' }
      ],
      anime: [
        { id: 'py-a1', title: 'Attack on Titan', genre: 'Animation, Action & Adventure, Sci-Fi & Fantasy', status: 'watched', rating: 10, totalEps: 89, imdbId: 'tt2560140', cover: 'https://image.tmdb.org/t/p/w500/hTP1DtLGFamjfu8WqjnuQdP1n4i.jpg' }
      ],
      games: []
    }
  }
];

const PREVIEW_COMMUNITY_MAP = PREVIEW_COMMUNITY_USERS.reduce((acc, user) => {
  acc[user.uid] = user;
  return acc;
}, {});

const PREVIEW_COMMENT_THREADS = {
  'imdb:tt0944947': [
    {
      id: 'pc-got-1',
      uid: 'preview-lena',
      name: 'Lena Knox',
      photo: PREVIEW_COMMUNITY_MAP['preview-lena'].photo,
      text: 'The first season hooks me every time. The world-building still feels huge on rewatch.',
      timestamp: Date.now() - 1000 * 60 * 18,
      scope: 'global'
    },
    {
      id: 'pc-got-2',
      uid: 'preview-marcus',
      name: 'Marcus Vale',
      photo: PREVIEW_COMMUNITY_MAP['preview-marcus'].photo,
      text: 'Ned carrying the early episodes is unreal. Preview comments are read-only until you sign in.',
      timestamp: Date.now() - 1000 * 60 * 62,
      scope: 'global'
    },
    {
      id: 'pc-got-3',
      uid: 'preview-yara',
      name: 'Yara Bloom',
      photo: PREVIEW_COMMUNITY_MAP['preview-yara'].photo,
      text: 'The score, the tension, and the cliffhangers make this such a good test title for the comments page.',
      timestamp: Date.now() - 1000 * 60 * 140,
      scope: 'global'
    }
  ],
  'imdb:tt9362722': [
    {
      id: 'pc-spider-1',
      uid: 'preview-yara',
      name: 'Yara Bloom',
      photo: PREVIEW_COMMUNITY_MAP['preview-yara'].photo,
      text: 'The art direction alone makes this worth planning a movie night around.',
      timestamp: Date.now() - 1000 * 60 * 95,
      scope: 'global'
    }
  ]
};

function setDefaultMyListsWatchingView() {
  activeSection = "shows";
  activeTab = "watching";
  searchQuery = "";
  viewingUser = null;
  friendViewData = null;
  syncMainNavButtons('mylist');
  setBottomNavVisibility(true);
  setMainNavVisibility('mylist');
}

function showLandingPage() {
  if (window.location.hash === '#creator' || window.location.hash === '#creator-lists') {
    try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) {}
  }
  if (typeof setShelfdGuestBrowsing === 'function') setShelfdGuestBrowsing(false, { persist: false });
  landingPublicProfileActive = false;
  document.body.classList.remove('profile-active', 'landing-public-lists', 'own-profile-active');
  document.body.classList.remove('preview-mode', 'viewing-other-user', 'guest-creator-lists');
  setBottomNavVisibility(false);
  setMainNavVisibility('mylist');
  const profilePage = document.getElementById('profile-page');
  if (profilePage) profilePage.style.display = 'none';
  const login = document.getElementById("login-screen");
  const app = document.getElementById("app-container");
  const headerBtn = document.getElementById('preview-header-signin');
  if (login) login.style.display = "flex";
  if (app) app.style.display = "none";
  if (headerBtn) headerBtn.style.display = 'none';
  initLandingCreatorProfileCard();
  window.scrollTo({ top: 0, behavior: "auto" });
}


function initLandingCreatorProfileCard() {
  const button = document.querySelector('.landing-profile-btn');
  if (!button) return;
  updateLandingCreatorProfileCard(creatorSearchUserCache || getCachedCreatorPublicUser() || null);
  loadCreatorPublicProfileMirror().catch(() => {});
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLandingCreatorProfileCard, { once: true });
} else {
  initLandingCreatorProfileCard();
}

function setLandingCreatorButtonsDisabled(disabled) {
  document.querySelectorAll('[data-landing-creator-action]').forEach(button => {
    button.disabled = !!disabled;
  });
}

function prepareSignedOutCreatorPreview() {
  landingPublicProfileActive = !currentUser;
  document.body.classList.remove('preview-mode');
  const login = document.getElementById('login-screen');
  const app = document.getElementById('app-container');
  if (login) login.style.display = 'none';
  if (app) app.style.display = 'block';
  setBottomNavVisibility(false);
}

function getCreatorPublicProfileFromUser(creator = {}) {
  return normalizeUserProfile({
    ...creator,
    uid: CREATOR_PUBLIC_UID,
    name: creator.name || CREATOR_DEFAULT_NAME,
    photo: creator.photo || creator.customPhoto || '',
    isCreatorAdmin: true,
    isPublic: true
  });
}

async function openLandingCreatorProfile() {
  if (window.location.hash !== '#creator') {
    try { history.replaceState(null, '', window.location.pathname + window.location.search + '#creator'); } catch (e) {}
  }
  setLandingCreatorButtonsDisabled(true);

  try {
    const creator = await loadCreatorSearchUser(true);
    if (!creator?.uid) throw new Error('Creator profile not found for UID ' + CREATOR_PUBLIC_UID);

    if (currentUser) {
      openUserProfile(creator.uid, creator.name || CREATOR_DEFAULT_NAME, creator.photo || '');
      return;
    }

    /* v759 FIX: fetch all profile data while the landing page is still
       visible, then call prepareSignedOutCreatorPreview() only once
       everything is ready. Previously the UI swap happened first and the
       blank app shell was visible during the two subsequent async calls
       (loadCreatorPublicProfileMirrorRaw + loadCreatorPublicListData). */
    const mirrorRaw = await loadCreatorPublicProfileMirrorRaw();
    const resolvedProfile = getCreatorPublicProfileFromUser({ ...(mirrorRaw || {}), ...creator });
    const listData = await loadCreatorPublicListData();

    /* All data loaded — swap UI in one synchronous step. */
    prepareSignedOutCreatorPreview();
    profileReturnTab = 'landing';
    viewingReturnTab = 'landing';
    profileViewingUser = {
      uid: CREATOR_PUBLIC_UID,
      name: creator.name || CREATOR_DEFAULT_NAME,
      photo: creator.photo || creator.customPhoto || '',
      signedOutPublic: true,
      isCreatorAdmin: true
    };
    profileViewingProfile = resolvedProfile;
    profileViewingData = listData;
    openProfilePageShell();
  } catch (e) {
    console.error('Landing creator profile failed:', e);
    landingPublicProfileActive = false;
    showLandingPage();
    showToast('Could not load creator profile');
  } finally {
    setLandingCreatorButtonsDisabled(false);
  }
}

async function openLandingCreatorLists() {
  if (window.location.hash !== '#creator-lists') {
    try { history.replaceState(null, '', window.location.pathname + window.location.search + '#creator-lists'); } catch (e) {}
  }
  setLandingCreatorButtonsDisabled(true);
  try {
    const creator = await loadCreatorSearchUser(true);
    if (!creator?.uid) throw new Error('Creator lists not found for UID ' + CREATOR_PUBLIC_UID);
    await openSignedOutCreatorListsView(creator);
  } catch (e) {
    console.error('Landing creator lists failed:', e);
    landingPublicProfileActive = false;
    showLandingPage();
    showToast('Could not load creator lists');
  } finally {
    setLandingCreatorButtonsDisabled(false);
  }
}

async function openSignedOutCreatorListsView(creator = {}) {
  /* v759 FIX: load ALL data first while the landing page is still visible.
     Previously, prepareSignedOutCreatorPreview() was called at the very
     top which immediately swapped login→app — the app was then visible
     in its blank/empty state for the entire duration of the async fetches
     (loadCreatorPublicListData + autoSortAnimeBuckets). Users saw the
     empty MyList shell (Games, Anime, Manga tabs, "Watching 0" etc.)
     before the real data appeared.

     Fix: complete all network calls first, THEN call
     prepareSignedOutCreatorPreview() so the transition from landing to
     app happens instantly with data already in place. */
  const publicData = await loadCreatorPublicListData();
  const sortedData = await autoSortAnimeBuckets(normalizeListData(publicData), false);

  /* All data is ready — now swap the UI in one synchronous step. */
  prepareSignedOutCreatorPreview();
  profileReturnTab = 'landing';
  viewingReturnTab = 'landing';
  profileViewingUser = null;
  profileViewingProfile = null;
  profileViewingData = null;
  myData = null;
  friendViewData = sortedData;
  viewingUser = {
    uid: CREATOR_PUBLIC_UID,
    name: creator.name || CREATOR_DEFAULT_NAME,
    photo: creator.photo || creator.customPhoto || '',
    signedOutPublic: true,
    isCreatorAdmin: true,
    listTabVisibility: normalizeListTabVisibility(creator.listTabVisibility),
    ratingPreferences: normalizeRatingPreferences(creator.ratingPreferences)
  };
  usersMap[CREATOR_PUBLIC_UID] = { ...(usersMap[CREATOR_PUBLIC_UID] || {}), ...creator, ...viewingUser };
  document.body.classList.remove('profile-active');
  document.body.classList.add('viewing-other-user', 'landing-public-lists');
  setMainNavVisibility('mylist');
  setBottomNavVisibility(false);
  const addBtn = document.getElementById('add-btn');
  const bannerArea = document.getElementById('viewing-banner-area');
  if (addBtn) addBtn.style.display = 'none';
  if (bannerArea) bannerArea.innerHTML = `<div class="viewing-banner friend-list-viewing-banner landing-public-list-banner">
    <div class="viewing-user-profile-center">
      <img src="${escAttr(viewingUser.photo || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(viewingUser.name) + '&background=1e2028&color=60a5fa')}" class="viewing-user-avatar" alt="">
      <div class="viewing-user-name">${renderDisplayNameHTML(viewingUser, CREATOR_DEFAULT_NAME, 'creator-name-soft')}</div>
    </div>
    <div class="viewing-banner-divider" aria-hidden="true"></div>
    <div class="viewing-banner-actions">
      <button class="back-btn profile-view-btn" onclick="openLandingCreatorProfile()">View Profile</button>
    </div>
    <button class="friend-list-floating-back-btn" type="button" onclick="backToMyList()" aria-label="Back">‹</button>
  </div>`;
  clearListSearch();
  const initialView = chooseInitialListView(friendViewData);
  activeSection = initialView.section;
  activeTab = normalizeVisibleMyListStatusTab(initialView.tab, activeSection);
  render();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

let shelfdGuestCreatorContextPromise = null;

async function loadShelfdGuestCreatorContext(force = false) {
  if (!force && shelfdGuestCreatorContextPromise) return shelfdGuestCreatorContextPromise;
  shelfdGuestCreatorContextPromise = (async () => {
    let creator = null;
    try {
      creator = await loadCreatorSearchUser(force);
    } catch (e) {
      console.warn('[shelfd-guest] creator profile lookup failed:', e);
    }
    if (!creator?.uid && typeof getCachedCreatorPublicUser === 'function') {
      try { creator = getCachedCreatorPublicUser(); } catch (e) { creator = null; }
    }
    if (!creator?.uid && typeof buildCreatorShellUser === 'function') creator = buildCreatorShellUser();
    if (!creator?.uid) {
      creator = {
        uid: CREATOR_PUBLIC_UID,
        name: CREATOR_DEFAULT_NAME,
        photo: '',
        customPhoto: '',
        isCreatorAdmin: true,
        isPublic: true
      };
    }

    let publicData = getEmptyListData();
    try {
      publicData = await loadCreatorPublicListData();
    } catch (e) {
      console.warn('[shelfd-guest] creator public list lookup failed:', e);
    }
    const sortedData = await autoSortAnimeBuckets(normalizeListData(publicData), false);
    const creatorUser = {
      ...creator,
      uid: CREATOR_PUBLIC_UID,
      name: creator.name || creator.customName || CREATOR_DEFAULT_NAME,
      photo: creator.photo || creator.customPhoto || '',
      signedOutPublic: true,
      isCreatorAdmin: true,
      isPublic: true,
      listTabVisibility: normalizeListTabVisibility(creator.listTabVisibility),
      ratingPreferences: normalizeRatingPreferences(creator.ratingPreferences)
    };
    return { creator: creatorUser, listData: sortedData };
  })();
  try {
    return await shelfdGuestCreatorContextPromise;
  } finally {
    shelfdGuestCreatorContextPromise = null;
  }
}

async function hydrateShelfdGuestCreatorFriend(force = false) {
  const context = await loadShelfdGuestCreatorContext(force);
  friends = [CREATOR_PUBLIC_UID];
  incomingRequests = [];
  outgoingRequests = [];
  usersMap[CREATOR_PUBLIC_UID] = { ...(usersMap[CREATOR_PUBLIC_UID] || {}), ...context.creator };
  friendProfilesPromise = null;
  friendProfilesPromiseKey = '';
  updateFriendsCountBadge();
  updateRequestsBadges();
  return context;
}

async function continueWithoutSignIn(options = {}) {
  setLandingCreatorButtonsDisabled(true);
  try {
    const context = await hydrateShelfdGuestCreatorFriend(options.force === true);
    if (typeof setShelfdGuestBrowsing === 'function') setShelfdGuestBrowsing(true, { persist: true });
    landingPublicProfileActive = false;
    currentUser = null;
    DOC_REF = null;
    myData = null;
    ownDataCache = null;
    viewingUser = null;
    friendViewData = null;
    profileViewingUser = null;
    profileViewingProfile = null;
    profileViewingData = null;
    data = getEmptyListData();
    userProfile = null;

    document.body.classList.remove('preview-mode', 'profile-active', 'own-profile-active', 'landing-public-lists', 'viewing-other-user', 'guest-creator-lists');
    const login = document.getElementById('login-screen');
    const app = document.getElementById('app-container');
    const inlineSignin = document.getElementById('shelfd-landing-inline-signin');
    if (inlineSignin) inlineSignin.hidden = true;
    if (login) login.style.display = 'none';
    if (app) app.style.display = 'block';

    activeDiscoveryHub = normalizeDiscoveryHub(activeDiscoveryHub || 'tv');
    syncMainNavButtons('discover');
    setBottomNavVisibility(true);
    setMainNavVisibility('discover');
    loadActiveDiscoveryHub();
    friendActivityCache = null;
    friendActivityPromise = null;
    window.scrollTo({ top: 0, behavior: 'auto' });
    return context;
  } catch (e) {
    console.error('[shelfd-guest] continue without sign-in failed:', e);
    if (typeof showToast === 'function') showToast('Could not start guest browsing');
    if (typeof setShelfdGuestBrowsing === 'function') setShelfdGuestBrowsing(false, { persist: false });
    showLandingPage();
    return null;
  } finally {
    setLandingCreatorButtonsDisabled(false);
  }
}

async function openGuestCreatorListsView(options = {}) {
  const returnTab = options.returnTab || (getActiveMainTab ? getActiveMainTab() : 'discover') || 'discover';
  const context = await hydrateShelfdGuestCreatorFriend(options.force === true);
  if (typeof setShelfdGuestBrowsing === 'function') setShelfdGuestBrowsing(true, { persist: true });
  landingPublicProfileActive = false;
  profileReturnTab = returnTab;
  viewingReturnTab = returnTab;
  profileViewingUser = null;
  profileViewingProfile = null;
  profileViewingData = null;
  myData = null;
  friendViewData = cloneListData(context.listData);
  viewingUser = { ...context.creator, guestCreator: true };
  usersMap[CREATOR_PUBLIC_UID] = { ...(usersMap[CREATOR_PUBLIC_UID] || {}), ...viewingUser };
  document.body.classList.remove('profile-active', 'landing-public-lists');
  document.body.classList.add('viewing-other-user', 'guest-creator-lists');
  syncMainNavButtons('mylist');
  setMainNavVisibility('mylist');
  setBottomNavVisibility(true);

  const addBtn = document.getElementById('add-btn');
  const bannerArea = document.getElementById('viewing-banner-area');
  if (addBtn) addBtn.style.display = 'none';
  const backButton = returnTab && returnTab !== 'mylist'
    ? `<button class="friend-list-floating-back-btn" type="button" onclick="backToMyList('${escAttr(returnTab)}')" aria-label="Back">‹</button>`
    : '';
  if (bannerArea) bannerArea.innerHTML = `<div class="viewing-banner friend-list-viewing-banner landing-public-list-banner">
    <div class="viewing-user-profile-center">
      <img src="${escAttr(viewingUser.photo || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(viewingUser.name) + '&background=1e2028&color=60a5fa')}" class="viewing-user-avatar" alt="">
      <div class="viewing-user-name">${renderDisplayNameHTML(viewingUser, CREATOR_DEFAULT_NAME, 'creator-name-soft')}</div>
    </div>
    <div class="viewing-banner-divider" aria-hidden="true"></div>
    <div class="viewing-banner-actions">
      <button class="back-btn profile-view-btn" onclick="openUserProfile('${CREATOR_PUBLIC_UID}')">View Profile</button>
    </div>
    ${backButton}
  </div>`;
  clearListSearch();
  const initialView = chooseInitialListView(friendViewData);
  activeSection = initialView.section;
  activeTab = normalizeVisibleMyListStatusTab(initialView.tab, activeSection);
  render();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

const shelfdGuestContinueQueued = window.__shelfdGuestContinueQueued === true;
window.continueWithoutSignIn = continueWithoutSignIn;
window.openGuestCreatorListsView = openGuestCreatorListsView;
window.hydrateShelfdGuestCreatorFriend = hydrateShelfdGuestCreatorFriend;
window.loadShelfdGuestCreatorContext = loadShelfdGuestCreatorContext;
if (shelfdGuestContinueQueued) {
  window.__shelfdGuestContinueQueued = false;
  requestAnimationFrame(() => continueWithoutSignIn());
}

function enterPreviewMode() {
  document.body.classList.add('preview-mode');
  const login = document.getElementById("login-screen");
  const app = document.getElementById("app-container");
  if (login) login.style.display = "none";
  if (app) app.style.display = "block";
  const headerBtn = document.getElementById('preview-header-signin');
  if (headerBtn) headerBtn.style.display = 'inline-flex';
  viewingUser = null;
  friendViewData = null;
  data = JSON.parse(JSON.stringify(DEMO_DATA));
  ownDataCache = cloneListData(data);
  userProfile = normalizeUserProfile({
    name: 'Preview User',
    photo: 'https://ui-avatars.com/api/?name=Preview+User&background=1c1535&color=a78bfa',
    bio: 'Testing ScreenList in preview mode. Build your shelves, rate titles, pin favorites, and customize your profile.',
    pinnedFavorites: {
      overallMedia: [
        { id: '569094', source: 'tmdb', type: 'movie', title: 'Spider-Man: Across the Spider-Verse', image: 'https://image.tmdb.org/t/p/w500/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg', rating: '★ 9/10', meta: '2023 · Movie' },
        { id: '1399', source: 'tmdb', type: 'tv', title: 'Game of Thrones', image: 'https://image.tmdb.org/t/p/w500/u3bZgnGQ9T01sWNhyveQz0wH0Hl.jpg', rating: '★ 9/10', meta: '2011 · TV / Anime' },
        { id: '209867', source: 'tmdb', type: 'tv', title: 'Frieren: Beyond Journey’s End', image: 'https://image.tmdb.org/t/p/w500/dqZENchTd7lp5zht7BdlqM7RBhN.jpg', rating: '★ 9/10', meta: '2023 · TV / Anime' }
      ],
      movies: [{ id: '569094', source: 'tmdb', type: 'movie', title: 'Spider-Man: Across the Spider-Verse', image: 'https://image.tmdb.org/t/p/w500/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg', rating: '★ 9/10', meta: '2023' }, {}, {}],
      shows: [{ id: '1399', source: 'tmdb', type: 'tv', title: 'Game of Thrones', image: 'https://image.tmdb.org/t/p/w500/u3bZgnGQ9T01sWNhyveQz0wH0Hl.jpg', rating: '★ 9/10', meta: '2011' }, {}, {}],
      anime: [{ id: '209867', source: 'tmdb', type: 'tv', title: 'Frieren: Beyond Journey’s End', image: 'https://image.tmdb.org/t/p/w500/dqZENchTd7lp5zht7BdlqM7RBhN.jpg', rating: '★ 9/10', meta: '2023' }, {}, {}],
      games: [{ id: '3498', source: 'rawg', type: 'game', title: 'Grand Theft Auto V', image: 'https://media.rawg.io/media/games/20a/20aa03a18ad10d5f05a16bc6ce0bb570.jpg', rating: '★ 10/10', meta: '2013' }, {}, {}],
      singlePlayerGames: [{ id: '3498', source: 'rawg', type: 'game', title: 'Grand Theft Auto V', image: 'https://media.rawg.io/media/games/20a/20aa03a18ad10d5f05a16bc6ce0bb570.jpg', rating: '★ 10/10', meta: '2013' }, {}, {}],
      actors: [{ id: '31', source: 'tmdb', type: 'person', title: 'Tom Hanks', image: 'https://image.tmdb.org/t/p/w500/xndWFsBlClOJFRdhSt4NBwiPq2o.jpg', rating: 'Favorite', meta: 'TMDB person' }, {}, {}],
      directors: [{ id: '488', source: 'tmdb', type: 'person', title: 'Steven Spielberg', image: 'https://image.tmdb.org/t/p/w500/tZxcg19YQ3e8fJ0pOs7hjlnmmr6.jpg', rating: 'Favorite', meta: 'TMDB person' }, {}, {}]
    },
    showcaseFavorites: {
      fictionalCharacters: [{ name: 'Miles Morales', image: '', rating: 'Favorite' }, {}, {}],
      musicArtists: [{ name: 'The Weeknd', image: '', rating: 'Favorite' }, {}, {}]
    },
    socialLinks: getDefaultSocialLinks(),
    uid: 'preview-user'
  });
  applyProfile();
  setDefaultMyListsWatchingView();
  render();
  window.scrollTo({ top: 0, behavior: "auto" });
}

function exitPreviewMode() {
  document.body.classList.remove('preview-mode');
  const headerBtn = document.getElementById('preview-header-signin');
  if (headerBtn) headerBtn.style.display = 'none';
  if (window.location.hash === '#preview') {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  if (!currentUser) showLandingPage();
}

let screenListSharedMediaRouteActive = false;
let screenListMediaRouteOpening = false;

function parseScreenListMediaRoute() {
  const pathMatch = window.location.pathname.match(/^\/media\/(movie|tv|anime|game)\/([^/?#]+)/i);
  const hashMatch = window.location.hash.match(/^#media\/(movie|tv|anime|game)\/([^/?#]+)/i);
  const match = pathMatch || hashMatch;
  if (!match) return null;
  return { kind: match[1].toLowerCase(), id: decodeURIComponent(match[2] || '').trim() };
}

function parseSharedMediaUrl(url = '') {
  const raw = String(url || '').trim();
  if (!raw) return null;
  try {
    const nextUrl = new URL(raw, window.location.origin);
    const pathMatch = nextUrl.pathname.match(/^\/media\/(movie|tv|anime|game)\/([^/?#]+)/i);
    const hashMatch = nextUrl.hash.match(/^#media\/(movie|tv|anime|game)\/([^/?#]+)/i);
    const match = pathMatch || hashMatch;
    if (!match) return null;
    return {
      kind: String(match[1] || '').toLowerCase(),
      id: decodeURIComponent(match[2] || '').trim()
    };
  } catch (error) {
    return null;
  }
}

function normalizeSharedMediaPayload(payload = {}) {
  if (!payload || typeof payload !== 'object') return null;
  const parsed = parseSharedMediaUrl(payload.url || '');
  const kind = ['movie', 'tv', 'anime', 'game'].includes(String(payload.kind || parsed?.kind || '').toLowerCase())
    ? String(payload.kind || parsed?.kind || '').toLowerCase()
    : '';
  const id = String(payload.id || parsed?.id || '').trim();
  if (!kind || !id) return null;
  return {
    kind,
    id,
    title: String(payload.title || '').trim() || 'ScreenList title',
    poster: String(payload.poster || '').trim(),
    url: buildMediaProfileShareUrl(kind, id)
  };
}

function openSharedMediaProfileLink(event, url = '') {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const targetUrl = String(url || '').trim();
  if (!targetUrl) return false;
  try {
    const nextUrl = new URL(targetUrl, window.location.origin);
    const sameOrigin = nextUrl.origin === window.location.origin;
    closeDirectMessagesPage(true);
    if (!sameOrigin) {
      window.location.href = nextUrl.toString();
      return false;
    }
    history.pushState({ screenListMediaRoute: true }, '', nextUrl.pathname + nextUrl.search + nextUrl.hash);
    const route = parseScreenListMediaRoute();
    if (route?.id) {
      openSharedMediaProfileRoute(route);
      return false;
    }
  } catch (error) {
    console.error('Shared media link open failed:', error);
  }
  window.location.href = targetUrl;
  return false;
}

function prepareSharedMediaRouteView() {
  document.body.classList.remove('preview-mode');
  const login = document.getElementById('login-screen');
  const app = document.getElementById('app-container');
  if (login) login.style.display = 'none';
  if (app) app.style.display = 'block';
  setBottomNavVisibility(!!currentUser);
  if (!currentUser) setMainNavVisibility('discover');
}

async function openSharedMediaProfileRoute(route = parseScreenListMediaRoute()) {
  if (!route?.id || screenListMediaRouteOpening) return false;
  screenListMediaRouteOpening = true;
  screenListSharedMediaRouteActive = false;
  prepareSharedMediaRouteView();
  try {
    if (route.kind === 'game') {
      setGameMediaProfileSeed(route.id, { rawgId: route.id });
      await openGameMediaProfile(null, route.id, { rawgId: route.id });
    } else {
      const tmdbType = route.kind === 'movie' ? 'movie' : 'tv';
      const seed = route.kind === 'anime' ? { mediaCategory: 'anime', librarySection: 'anime', isAnime: true } : {};
      setDiscoverMediaProfileSeed(tmdbType, route.id, seed);
      await openDiscoverMediaProfile(null, tmdbType, route.id);
    }
    screenListSharedMediaRouteActive = true;
    return true;
  } catch (e) {
    console.error('Shared media route failed:', e);
    showToast('Could not open media profile');
    if (!currentUser) showLandingPage();
    return false;
  } finally {
    screenListMediaRouteOpening = false;
  }
}

function finishSharedMediaRouteAfterClose() {
  if (!screenListSharedMediaRouteActive) return;
  screenListSharedMediaRouteActive = false;
  if (window.location.pathname.startsWith('/media/') || window.location.hash.startsWith('#media/')) {
    try { history.replaceState(null, '', window.location.origin + '/'); } catch (e) {}
  }
  if (!currentUser) showLandingPage();
}

function syncSignedOutRoute() {
  if (!currentUser && typeof isShelfdGuestBrowsing === 'function' && isShelfdGuestBrowsing()) return;
  if (parseScreenListMediaRoute()) {
    openSharedMediaProfileRoute();
    return;
  }
  if (typeof parseScreenListProfileRoute === 'function') {
    const profileRoute = parseScreenListProfileRoute();
    if (profileRoute?.uid && (profileRoute.section || window.location.pathname.startsWith('/profile-card/'))) {
      openProfileRouteDirect(profileRoute);
      return;
    }
  }
  if (currentUser) return;
  if (window.location.hash === '#creator') {
    openLandingCreatorProfile();
    return;
  }
  if (window.location.hash === '#creator-lists') {
    openLandingCreatorLists();
    return;
  }
  showLandingPage();
}

function getPreviewCommunityUser(uid) {
  return PREVIEW_COMMUNITY_MAP[uid] || null;
}

function getPreviewCommentsForMedia(mediaKey) {
  return (PREVIEW_COMMENT_THREADS[mediaKey] || []).map(comment => ({ ...comment }));
}

function renderPreviewCommunityUsers(users, emptyTitle, emptyCopy) {
  const grid = document.getElementById('friends-grid');
  const badge = document.getElementById('friends-count-badge');
  if (!grid || !badge) return;
  if (!users || users.length === 0) {
    badge.textContent = '';
    grid.innerHTML = `<div class="friends-empty" style="grid-column:1/-1;">
      <div class="friends-empty-icon">👥</div>
      <p style="color:#7a6f99;font-size:14px;">${escHtml(emptyTitle)}</p>
      <p class="friends-empty-sub">${escHtml(emptyCopy)}</p>
    </div>`;
    return;
  }
  badge.textContent = '(' + users.length + ')';
  grid.innerHTML = users.map(user => `
    <div class="user-card friend-list-card" style="justify-content:space-between;">
      <div class="friend-card-main" style="display:flex;align-items:center;gap:14px;flex:1;min-width:0;cursor:pointer;" onclick="openPreviewCommunityProfile('${user.uid}')">
        <img class="user-card-avatar" src="${user.photo}" alt="">
        <div class="friend-card-copy" style="min-width:0;">
          <div class="user-card-name">${renderDisplayNameHTML(user, 'Preview User')}</div>
          <div class="user-card-stats">${escHtml(user.stats || user.findStats || 'Preview profile')}</div>
        </div>
      </div>
      <div class="friend-actions-group">
        <button class="friend-action-btn friend-mobile-list-btn" type="button" onclick="event.stopPropagation(); openPreviewCommunityProfile('${user.uid}')">Screen List</button>
        <button class="friend-action-btn friend-profile-btn friend-mobile-profile-btn" type="button" onclick="event.stopPropagation(); openPreviewUserProfile('${user.uid}')">Profile</button>
        <button class="friend-action-btn friend-profile-btn friend-profile-desktop-btn" type="button" onclick="event.stopPropagation(); openPreviewUserProfile('${user.uid}')">Profile</button>
        <button class="friend-action-btn friend-pending-btn" type="button" disabled>Preview</button>
      </div>
    </div>
  `).join('');
}

function openPreviewCommunityProfile(uid) {
  const user = getPreviewCommunityUser(uid);
  if (!user) {
    showToast("Preview profile unavailable");
    return;
  }
  viewingReturnTab = getActiveMainTab ? getActiveMainTab() : 'community';
  viewingUser = {
    uid: user.uid,
    name: user.name,
    photo: user.photo,
    preview: true,
    listTabVisibility: normalizeListTabVisibility(user.listTabVisibility),
    ratingPreferences: normalizeRatingPreferences(user.ratingPreferences)
  };
  friendViewData = cloneListData(user.listData);
  clearListSearch();
  document.body.classList.add('viewing-other-user');
  const communityView = document.getElementById('community-view');
  const myListView = document.getElementById('mylist-view');
  const myListHeader = document.getElementById('mylist-header');
  const addBtn = document.getElementById('add-btn');
  const bannerArea = document.getElementById('viewing-banner-area');
  if (communityView) communityView.style.display = 'none';
  if (myListView) myListView.style.display = 'block';
  if (myListHeader) myListHeader.style.display = 'block';
  if (addBtn) addBtn.style.display = 'none';
  setBottomNavVisibility(true);
  syncMainNavButtons('mylist');
  if (bannerArea) {
    bannerArea.innerHTML = `<div class="viewing-banner friend-list-viewing-banner">
      <div class="viewing-user-profile-center">
        <img src="${user.photo || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.name || 'Preview User') + '&background=1e2028&color=60a5fa'}" class="viewing-user-avatar" alt="">
        <div class="viewing-user-name">${renderDisplayNameHTML(user, 'Preview User', 'creator-name-soft')}</div>
      </div>
      <div class="viewing-banner-divider" aria-hidden="true"></div>
      <div class="viewing-banner-actions">
        <button class="back-btn profile-view-btn" onclick="openPreviewUserProfile('${user.uid}')">View Profile</button>
        <button class="back-btn friend-list-dm-btn" onclick="openDirectMessageFromUser('${user.uid}')">Direct Message</button>
      </div>
      <button class="friend-list-floating-back-btn" type="button" onclick="backToMyList()" aria-label="Back">‹</button>
    </div>`;
  }
  const initialView = chooseInitialListView(friendViewData);
  activeSection = initialView.section;
  activeTab = normalizeVisibleMyListStatusTab(initialView.tab, activeSection);
  render();
}
