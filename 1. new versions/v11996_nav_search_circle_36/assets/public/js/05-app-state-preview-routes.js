/* v705: changed `let` to `var` so cross-file `window.activeSection = ...`
   actually mutates this binding. With `let` at script-top-level, the binding
   lives in the module record but does NOT become a property of `window`,
   which broke the Discover>Games add sheet (saves were routing to TV shows
   because submitModal still saw activeSection='shows'). Same fix as v691
   applied to selectedTmdb. */
var activeSection = "shows";
var activeTab = "watching";

/* v11.245: restore the dev "Non-Pro View" simulation flag (set via the hammer
   tool) so it survives reloads and is applied app-wide before any list renders. */
try {
  if (localStorage.getItem('shelfd:simulate-nonpro') === '1') {
    window.__shelfdSimulateNonPro = true;
    if (document.body) document.body.classList.add('shelfd-simulate-nonpro');
    else document.addEventListener('DOMContentLoaded', () => document.body.classList.add('shelfd-simulate-nonpro'));
  }
} catch (_) {}
let activeDiscoveryHub = "movies";
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
const WISHLIST_PRIORITY_SECTIONS = new Set(['games']);
const SORT_OPTIONS = [
  { key: 'recently-added',    label: 'Recently Added' },
  { key: 'title-az',          label: 'Title A–Z' },
  { key: 'rating-high',       label: 'Highest Rated' },
  { key: 'rating-low',        label: 'Lowest Rated' },
  /* v11.565: 'Newest Release' + 'Oldest Release' merged into one 'Year' option
     that tap-toggles direction (newest↔oldest), like the music 'Year' sort. */
  { key: 'release-year',      label: 'Year' },
  { key: 'custom',            label: 'Custom Order' },
];

/* v10.259: music-only sort options — three keys with revolving tap-toggle
   direction. Tap once: ascending. Tap again: descending. Tap again: asc.
   No explicit asc/desc row needed; the option itself carries an arrow that
   flips on re-tap. */
const MUSIC_SORT_OPTIONS = [
  { key: 'release-year',   label: 'Year' },
  { key: 'title-az',       label: 'Title' },
  { key: 'artist-az',      label: 'Artist' },
  /* v10.261: two more music sort keys. Defaults wired per-tab below. */
  { key: 'recently-added', label: 'Date Added' },
  { key: 'last-edited',    label: 'Recently Edited' },
  { key: 'music-total-rating',          label: 'Total Rating' },
  /* v11.244: `pro: true` marks Pro-member-only music sort filters. They stay
     visible in the menu with a lock glyph, but are gated from being applied
     for non-Pro members (see toggleSortDropdown + setSortOrder). */
  { key: 'music-rated-tracks',          label: 'Rated Tracks Count', pro: true },
  { key: 'music-unrated-tracks',        label: 'Unrated Tracks Count', pro: true },
  { key: 'music-total-favorites',       label: 'Total Favorites', pro: true },
  { key: 'music-average-favorites',     label: 'Average Favorites', pro: true },
  { key: 'music-favorite-progress',     label: 'Favorite Progress', pro: true },
  { key: 'music-play-count-average',    label: 'Play Count Average', pro: true },
  { key: 'music-play-count-median',     label: 'Play Count Median', pro: true },
  { key: 'music-skip-count',            label: 'Skip Count', pro: true },
  { key: 'music-skip-count-average',    label: 'Skip Count Average', pro: true },
  { key: 'music-bitrate-average',       label: 'Bitrate Average', pro: true },
  { key: 'music-size-per-minute',       label: 'Size Per Minute', pro: true },
  { key: 'music-time-spent-listening',  label: 'Time Spent Listening', pro: true },
  { key: 'music-item-count',            label: 'Item Count' },
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
  /* v10.259: music section uses its own three-option list. */
  if (section === 'music') return [...MUSIC_SORT_OPTIONS];
  const base = section === 'games' ? GAME_SORT_OPTIONS : SORT_OPTIONS;
  let next = [...base];
  if (WATCHLIST_PRIORITY_SECTIONS.has(section) && activeTab === 'planned' && !next.some(option => option.key === 'watchlist-priority')) {
    next.unshift({ key: 'watchlist-priority', label: 'Priority' });
  }
  if (WISHLIST_PRIORITY_SECTIONS.has(section) && activeTab === 'wishlist' && !next.some(option => option.key === 'watchlist-priority')) {
    next.unshift({ key: 'watchlist-priority', label: 'Priority' });
  }
  if (!LAST_EDITED_SORT_SECTIONS.has(section) || section === 'games') return next;
  if (next.some(option => option.key === 'last-edited')) return next;
  const insertAt = Math.max(1, next.findIndex(option => option.key === 'title-az'));
  next.splice(insertAt, 0, { key: 'last-edited', label: 'Last Edited' });
  return next;
}
/* v11.565 / v11.580: ALL shelf categories use the music-style revolving tap-toggle
   sort. Tapping a sort option applies it in its default direction; tapping the SAME
   option again flips asc↔desc, shown by an arrow on the active option. The separate
   Asc/Desc button is removed everywhere (v11.580 extended this from
   music/movies/shows/anime to every section, including games). */
function isTapToggleSortSection(section = activeSection) {
  return true;
}
function getDefaultSortDirectionFor(sortKey = getActiveSortKey()) {
  switch (sortKey) {
    case 'watchlist-priority':
    case 'title-az':
    case 'rating-low':
    case 'release-oldest':
    case 'avg-play-time':
    case 'avg-finish-time':
    /* v10.259: music sort defaults all open ascending per spec. */
    case 'release-year':
    case 'artist-az':
      return 'asc';
    default:
      return 'desc';
  }
}
/* v11.566: the direction a sort OPENS in on first selection / as a tab default.
   For most keys this equals the semantic anchor (getDefaultSortDirectionFor), but
   'release-year' opens NEWEST-first (desc) even though its comparator's natural
   (asc) output is oldest-first — release dates read better newest→oldest. This is
   what makes the Watched/Listened/Played default land on newest-first. The anchor
   getDefaultSortDirectionFor('release-year') stays 'asc' so the flip pass in
   applySortOrder reverses the oldest-first comparator into newest-first. */
function getOpeningSortDirectionFor(sortKey = getActiveSortKey()) {
  if (sortKey === 'release-year') return 'desc';
  return getDefaultSortDirectionFor(sortKey);
}
function getActiveSortDirection(stateKey = getSortStateKey(), sortKey = getActiveSortKey()) {
  return normalizeSortDirection(sessionSortDirectionState[stateKey] || getOpeningSortDirectionFor(sortKey));
}
function toggleSortDirection(event = null) {
  event?.stopPropagation?.();
  const stateKey = getSortStateKey();
  const current = getActiveSortDirection(stateKey, getActiveSortKey());
  sessionSortDirectionState[stateKey] = current === 'asc' ? 'desc' : 'asc';
  clearLastEditedResortHold(stateKey);
  render();
  closeSortDropdown();
  toggleSortDropdown(null);
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

function getMusicTrackStableKey(track, idx) {
  if (!track || typeof track !== 'object') return `idx:${idx}`;
  const dzId = String(track.deezerId || track.id || '').trim();
  if (dzId) return `dz:${dzId}`;
  const num = String(track.number || (idx + 1)).trim();
  const title = String(track.title || '').trim().toLowerCase();
  if (title) return `t:${num}::${title}`;
  return `idx:${idx}`;
}

function getNumericValueFromObject(source = {}, keys = []) {
  if (!source || typeof source !== 'object') return 0;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const clean = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
      if (clean) {
        const parsed = Number(clean[0]);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
  }
  return 0;
}

function hasNumericValueInObject(source = {}, keys = []) {
  if (!source || typeof source !== 'object') return false;
  return keys.some(key => {
    if (!Object.prototype.hasOwnProperty.call(source, key)) return false;
    const value = source[key];
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string') return /-?\d+(?:\.\d+)?/.test(value.replace(/,/g, ''));
    return false;
  });
}

function normalizeMusicDurationMs(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 10000 ? n : n * 1000;
}

function medianNumber(values = []) {
  const nums = values.map(Number).filter(n => Number.isFinite(n));
  if (!nums.length) return 0;
  nums.sort((a, b) => a - b);
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function getMusicTrackRatingValue(item = {}, track = {}, idx = 0) {
  const byKey = item && typeof item.trackRatingsByKey === 'object' && item.trackRatingsByKey !== null
    ? item.trackRatingsByKey
    : null;
  if (byKey) {
    const key = getMusicTrackStableKey(track, idx);
    if (Object.prototype.hasOwnProperty.call(byKey, key)) {
      const value = Number(byKey[key] || 0);
      if (Number.isFinite(value)) return Math.max(0, value);
    }
  }
  if (Array.isArray(item?.trackRatings)) {
    const value = Number(item.trackRatings[idx] || 0);
    if (Number.isFinite(value)) return Math.max(0, value);
  }
  return getNumericValueFromObject(track, ['rating', 'trackRating', 'userRating']);
}

function getMusicTrackFavoriteValue(item = {}, track = {}, idx = 0) {
  const byKey = item && typeof item.trackFavoritesByKey === 'object' && item.trackFavoritesByKey !== null
    ? item.trackFavoritesByKey
    : null;
  if (byKey) {
    const key = getMusicTrackStableKey(track, idx);
    if (byKey[key] === true) return 1;
    if (byKey[key] === false) return 0;
  }
  if (Array.isArray(item?.trackFavorites)) {
    if (item.trackFavorites[idx] === true) return 1;
    if (item.trackFavorites[idx] === false) return 0;
  }
  if (getMusicTrackRatingValue(item, track, idx) > 0) return 1;
  return getNumericValueFromObject(track, ['favorite', 'favoriteCount', 'favorites', 'favCount']) > 0 ? 1 : 0;
}

function getMusicTrackMetric(track = {}, keys = []) {
  return getNumericValueFromObject(track, keys);
}

function getMusicItemStats(item = {}) {
  const tracks = Array.isArray(item?.tracks) ? item.tracks : [];
  const itemCount = tracks.length || getNumericValueFromObject(item, ['itemCount', 'trackCount', 'tracksCount', 'nb_tracks', 'totalTracks']);
  const totalRatingKeys = ['totalRating', 'total_rating', 'ratingTotal'];
  const ratedTracksKeys = ['ratedTracksCount', 'ratedTrackCount', 'ratedTracks'];
  const totalFavoritesKeys = ['totalFavorites', 'favoriteCount', 'favoritesCount', 'favorites'];
  const totalPlayCountKeys = ['totalPlayCount', 'playCountTotal', 'playCount'];
  const totalSkipCountKeys = ['totalSkipCount', 'skipCountTotal', 'skipCount'];
  const totalSizeKeys = ['totalSizeBytes', 'sizeBytes', 'fileSizeBytes', 'bytes'];
  const timeSpentKeys = ['timeSpentListeningMs', 'listeningTimeMs', 'totalListeningMs'];
  const hasTotalRating = hasNumericValueInObject(item, totalRatingKeys);
  const hasRatedTracks = hasNumericValueInObject(item, ratedTracksKeys);
  const hasTotalFavorites = hasNumericValueInObject(item, totalFavoritesKeys);
  const hasTotalPlayCount = hasNumericValueInObject(item, totalPlayCountKeys);
  const hasTotalSkipCount = hasNumericValueInObject(item, totalSkipCountKeys);
  const hasTotalSizeBytes = hasNumericValueInObject(item, totalSizeKeys);
  const hasRuntime = hasNumericValueInObject(item, ['runtimeMs', 'durationMs', 'duration', 'length']);
  const hasTimeSpentListening = hasNumericValueInObject(item, timeSpentKeys);
  let totalRating = getNumericValueFromObject(item, totalRatingKeys);
  let ratedTracks = getNumericValueFromObject(item, ratedTracksKeys);
  let totalFavorites = getNumericValueFromObject(item, totalFavoritesKeys);
  let totalPlayCount = getNumericValueFromObject(item, totalPlayCountKeys);
  let totalSkipCount = getNumericValueFromObject(item, totalSkipCountKeys);
  let totalBitrate = 0;
  let bitrateCount = 0;
  let totalSizeBytes = getNumericValueFromObject(item, totalSizeKeys);
  let totalDurationMs = normalizeMusicDurationMs(item.runtimeMs || item.durationMs || item.duration || item.length || 0);
  let timeSpentListeningMs = getNumericValueFromObject(item, timeSpentKeys);
  const playCounts = [];

  tracks.forEach((track, idx) => {
    const rating = getMusicTrackRatingValue(item, track, idx);
    if (!hasTotalRating) totalRating += rating;
    if (!hasRatedTracks && rating > 0) ratedTracks += 1;
    if (!hasTotalFavorites) totalFavorites += getMusicTrackFavoriteValue(item, track, idx);

    const playCount = getMusicTrackMetric(track, ['playCount', 'play_count', 'plays', 'listenCount', 'listen_count', 'listens', 'timesPlayed']);
    playCounts.push(playCount);
    if (!hasTotalPlayCount) totalPlayCount += playCount;

    const skipCount = getMusicTrackMetric(track, ['skipCount', 'skip_count', 'skips', 'timesSkipped']);
    if (!hasTotalSkipCount) totalSkipCount += skipCount;

    const bitrate = getMusicTrackMetric(track, ['bitrate', 'bitRate', 'bitrateKbps', 'audioBitrate']);
    if (bitrate > 0) { totalBitrate += bitrate; bitrateCount += 1; }

    const size = getMusicTrackMetric(track, ['sizeBytes', 'fileSizeBytes', 'bytes', 'fileSize', 'size']);
    if (!hasTotalSizeBytes) totalSizeBytes += size;

    const durationMs = normalizeMusicDurationMs(track.durationMs || track.length || track.duration || 0);
    if (!hasRuntime) totalDurationMs += durationMs;
    if (!hasTimeSpentListening) timeSpentListeningMs += durationMs * playCount;
  });

  const safeCount = Math.max(0, Number(itemCount || tracks.length || 0));
  const unratedTracks = Math.max(0, safeCount - ratedTracks);
  const averageFavorites = safeCount ? totalFavorites / safeCount : 0;
  const favoriteProgress = safeCount ? (totalFavorites / safeCount) * 100 : 0;
  const playCountAverage = safeCount ? totalPlayCount / safeCount : 0;
  const skipCountAverage = safeCount ? totalSkipCount / safeCount : 0;
  const bitrateAverage = bitrateCount ? totalBitrate / bitrateCount : getNumericValueFromObject(item, ['bitrateAverage', 'averageBitrate']);
  const minutes = totalDurationMs > 0 ? totalDurationMs / 60000 : 0;

  return {
    totalRating,
    ratedTracks,
    unratedTracks,
    totalFavorites,
    averageFavorites,
    favoriteProgress,
    playCountAverage,
    playCountMedian: medianNumber(playCounts),
    skipCount: totalSkipCount,
    skipCountAverage,
    bitrateAverage,
    sizePerMinute: minutes ? totalSizeBytes / minutes : 0,
    timeSpentListening: timeSpentListeningMs,
    itemCount: safeCount
  };
}

function getMusicSortMetric(item = {}, sortKey = '') {
  const stats = getMusicItemStats(item);
  switch (sortKey) {
    case 'music-total-rating': return stats.totalRating;
    case 'music-rated-tracks': return stats.ratedTracks;
    case 'music-unrated-tracks': return stats.unratedTracks;
    case 'music-total-favorites': return stats.totalFavorites;
    case 'music-average-favorites': return stats.averageFavorites;
    case 'music-favorite-progress': return stats.favoriteProgress;
    case 'music-play-count-average': return stats.playCountAverage;
    case 'music-play-count-median': return stats.playCountMedian;
    case 'music-skip-count': return stats.skipCount;
    case 'music-skip-count-average': return stats.skipCountAverage;
    case 'music-bitrate-average': return stats.bitrateAverage;
    case 'music-size-per-minute': return stats.sizePerMinute;
    case 'music-time-spent-listening': return stats.timeSpentListening;
    case 'music-item-count': return stats.itemCount;
    default: return 0;
  }
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
  // v10.438: switched the default for both Playing tabs from `live-recent-hybrid`
  // to `last-edited` per spec. The hybrid sort is still available manually via
  // the dropdown (its key remains valid in `applySortOrder`), but the surface
  // now opens to "most recently touched first" by default — matching the
  // shows/anime watching default and read as a more predictable starting
  // order across the Playing tabs.
  if (normalizedSection === 'games' && (normalizedTab === 'watching' || normalizedTab === 'live')) {
    return 'last-edited';
  }
  if ((normalizedSection === 'shows' || normalizedSection === 'anime') && normalizedTab === 'watching') {
    return 'last-edited';
  }
  if (WATCHLIST_PRIORITY_SECTIONS.has(normalizedSection) && normalizedTab === 'planned') {
    return 'watchlist-priority';
  }
  if (WISHLIST_PRIORITY_SECTIONS.has(normalizedSection) && normalizedTab === 'wishlist') {
    return 'watchlist-priority';
  }
  /* v10.259 / v10.261: music per-tab defaults.
     - Planned     → "Date Added"      (recently-added, desc → newest first)
     - In Rotation → "Recently Edited" (last-edited, desc → most recent first)
     - Listened    → "Year"            (release-year, newest → oldest)  // v11.566
     - Fallback    → "Year". */
  if (normalizedSection === 'music') {
    if (normalizedTab === 'planned') return 'recently-added';
    if (normalizedTab === 'watching') return 'last-edited';
    /* v11.566: Listened defaults to Release Date, newest → oldest. */
    if (normalizedTab === 'watched') return 'release-year';
    return 'release-year';
  }
  /* v690: Watched (shows/movies/anime) and Played (games) used to default to
     last-edited (most-recently-touched first).
     v11.566: per spec, Watched / Played now default to Release Date, newest →
     oldest. Games use 'release-newest' (their Release Date key, comparator is
     already newest-first); movies/shows/anime use 'release-year' (opens desc via
     getOpeningSortDirectionFor → newest-first). Applied to own- and
     friend-profile views. Manual sort picks still override this default. */
  if (normalizedTab === 'watched') {
    return normalizedSection === 'games' ? 'release-newest' : 'release-year';
  }
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
  /* v10.259: music section uses a revolving tap-toggle. Tapping the same
     option again flips the direction (asc ↔ desc) and re-opens the dropdown
     so the user can keep tapping. Switching to a different option resets
     direction to ascending. */
  const isMusic = activeSection === 'music';
  /* v11.565: movies / shows / anime now use the same revolving tap-toggle as
     music — re-tapping the active option flips asc↔desc. 'custom' is exempt
     (manual drag order, no direction). */
  const isTapToggle = isTapToggleSortSection();
  if (isTapToggle && key !== 'custom' && previousKey === key) {
    const currentDir = getActiveSortDirection(stateKey, key);
    sessionSortDirectionState[stateKey] = currentDir === 'asc' ? 'desc' : 'asc';
    clearLastEditedResortHold(stateKey);
    render();
    /* Re-render the dropdown so the arrow next to the active option flips. */
    closeSortDropdown();
    toggleSortDropdown(null);
    return;
  }
  sessionSortState[stateKey] = key;
  if (previousKey !== key) {
    /* On music, force asc on new selection so first tap always reads "asc". */
    sessionSortDirectionState[stateKey] = isMusic ? 'asc' : getOpeningSortDirectionFor(key);
  }
  clearLastEditedResortHold(stateKey);
  if (key === 'custom' && !sessionCustomOrder[stateKey]) {
    const visibleData = getVisibleListData();
    const items = (visibleData[activeSection] || []).filter(i => {
      if (typeof itemMatchesActiveListStatus === 'function') return itemMatchesActiveListStatus(i);
      return i.status === activeTab;
    });
    sessionCustomOrder[stateKey] = applySortOrder(items, getDefaultSortKeyFor(), stateKey).map(getSortItemKey);
  }
  render();
  /* v10.641: Keep the sort popup open after choosing any sort option.
     Users close it by tapping outside the popup. Re-render so the active
     state/arrow updates after the list refresh. */
  closeSortDropdown();
  toggleSortDropdown(null);
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
    /* v10.259: music year sort. Ascending (default) = oldest first; the
       direction-flip pass below reverses for descending. Pulls year from
       item.year first, then releaseDate as fallback. */
    case 'release-year':
      arr.sort((a, b) => {
        const ay = parseInt(a.year || (a.releaseDate ? String(a.releaseDate).slice(0,4) : 0), 10) || 0;
        const by = parseInt(b.year || (b.releaseDate ? String(b.releaseDate).slice(0,4) : 0), 10) || 0;
        return ay - by;
      });
      break;
    /* v10.259: artist A–Z sort (music only). */
    case 'artist-az':
      arr.sort((a, b) => String(a.artist || '').localeCompare(String(b.artist || ''), undefined, { sensitivity: 'base' }));
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
    case 'music-total-rating':
    case 'music-rated-tracks':
    case 'music-unrated-tracks':
    case 'music-total-favorites':
    case 'music-average-favorites':
    case 'music-favorite-progress':
    case 'music-play-count-average':
    case 'music-play-count-median':
    case 'music-skip-count':
    case 'music-skip-count-average':
    case 'music-bitrate-average':
    case 'music-size-per-minute':
    case 'music-time-spent-listening':
    case 'music-item-count':
      arr.sort((a, b) => {
        const diff = getMusicSortMetric(b, sortKey) - getMusicSortMetric(a, sortKey);
        if (diff) return diff;
        return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
      });
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

/* v11.244: Pro-membership gate. No Pro tier ships yet, so this returns false
   for everyone — the locked filters show a lock glyph for all users until Pro
   exists. The creator/dev account is treated as Pro so testing isn't blocked.
   When the real Pro system lands, wire the actual entitlement check here. */
function isShelfdProMember() {
  try {
    /* v11.245: dev "Non-Pro View" simulation (hammer tool) forces non-Pro
       even on the creator account, so the dev can see exactly what a non-Pro
       member sees app-wide. */
    if (window.__shelfdSimulateNonPro === true
        || (document.body && document.body.classList.contains('shelfd-simulate-nonpro'))) {
      return false;
    }
    if (window.__shelfdIsPro === true) return true;
    const activeUser = {
      ...(typeof userProfile !== 'undefined' && userProfile ? userProfile : {}),
      ...(typeof currentUser !== 'undefined' && currentUser ? currentUser : {}),
      ...(window.__shelfdUser || {})
    };
    const uid = String(activeUser.uid || '').trim();
    if (uid === 'KihPpiqSsFMpn5Tee4xZWFWapg62') return true; /* creator/dev */
    if (typeof isCreativeTeamUser === 'function' && isCreativeTeamUser(activeUser)) return true;
  } catch (_) {}
  return false;
}

function handleShelfdProLockedFilter(opt) {
  /* Lightweight feedback when a non-Pro taps a locked filter. */
  try { if (navigator && navigator.vibrate) navigator.vibrate(12); } catch (_) {}
  try {
    if (typeof showToast === 'function') {
      showToast('Pro filter — available with Shelfd Pro');
    } else if (typeof window.showShelfdToast === 'function') {
      window.showShelfdToast('Pro filter — available with Shelfd Pro');
    }
  } catch (_) {}
}

function closeSortDropdown() {
  const m = document.getElementById('sort-dropdown-menu');
  if (!m) return;
  /* v11.241: play the close animation, then remove — matches the cogwheel
     popover. Guard against double-close (id cleared so it can't re-trigger). */
  if (m.dataset.closing === '1') return;
  m.dataset.closing = '1';
  m.id = '';
  m.classList.add('closing');
  setTimeout(() => { try { m.remove(); } catch (_) {} }, 160);
}

function toggleSortDropdown(e) {
  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
  const existing = document.getElementById('sort-dropdown-menu');
  if (existing) { closeSortDropdown(); return; }
  const btn = document.getElementById('sort-dropdown-btn');
  if (!btn) return;
  const activeSortKey = getActiveSortKey();
  const activeDirection = getActiveSortDirection(getSortStateKey(), activeSortKey);
  const isMusic = activeSection === 'music';
  /* v11.565: movies / shows / anime share the music tap-toggle UI. */
  const isTapToggle = isTapToggleSortSection();
  const menu = document.createElement('div');
  menu.id = 'sort-dropdown-menu';
  menu.className = 'sort-dropdown-menu' + (isMusic ? ' sort-dropdown-menu--music' : '') + (isTapToggle ? ' sort-dropdown-menu--toggle' : '');
  menu.addEventListener('click', event => event.stopPropagation());
  /* v10.259 / v11.565: tap-toggle sections (music + movies/shows/anime) have no
     separate Asc/Desc toggle — each option carries the current direction arrow
     when active, and tapping the same option flips it. */
  if (!isTapToggle) {
    const directionBtn = document.createElement('button');
    directionBtn.className = 'sort-direction-toggle';
    directionBtn.type = 'button';
    directionBtn.innerHTML = `<span>${activeDirection === 'asc' ? 'Ascending' : 'Descending'}</span><strong>${activeDirection === 'asc' ? '↑' : '↓'}</strong>`;
    directionBtn.onclick = toggleSortDirection;
    menu.appendChild(directionBtn);
  }
  const sortOptions = getSortOptionsForSection(activeSection);
  const isPro = isShelfdProMember();
  sortOptions.forEach(opt => {
    /* v11.244: Pro-only music filters stay visible but locked for non-Pro
     members — a lock glyph is shown and tapping them is gated. */
    const locked = !!opt.pro && !isPro;
    const el = document.createElement('button');
    el.className = 'sort-dropdown-item' + (opt.key === activeSortKey ? ' active' : '') + (locked ? ' sort-dropdown-item-locked' : '');
    const lockHtml = locked
      ? '<span class="sort-dropdown-lock" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></span>'
      : '';
    if (isTapToggle && opt.key === activeSortKey && !locked && opt.key !== 'custom') {
      /* v11.565: --has-arrow hides the active checkmark so only the direction
         arrow shows. 'custom' is excluded (no direction) and keeps its checkmark. */
      el.classList.add('sort-dropdown-item--has-arrow');
      el.innerHTML = `<span>${opt.label}</span><span class="sort-dropdown-arrow" aria-hidden="true">${activeDirection === 'asc' ? '↑' : '↓'}</span>`;
    } else {
      el.innerHTML = `<span>${opt.label}</span>${lockHtml}`;
    }
    if (locked) {
      el.setAttribute('aria-disabled', 'true');
      el.onclick = (ev) => { ev.stopPropagation(); if (typeof handleShelfdProLockedFilter === 'function') handleShelfdProLockedFilter(opt); };
    } else {
      el.onclick = () => setSortOrder(opt.key);
    }
    menu.appendChild(el);
  });
  document.body.appendChild(menu);
  const rect = btn.getBoundingClientRect();
  menu.style.top = (rect.bottom + window.scrollY + 4) + 'px';
  /* v11.242: nudge the menu ~14px further left so it clears the filter/sort
     button when it opens (was aligning flush to the button's right edge). */
  const rightOffset = window.innerWidth - rect.right + 14;
  menu.style.right = rightOffset + 'px';
  /* v10.259: on music, dropdown stays open across taps (revolving toggle).
     The outside-click handler still closes it when the user taps elsewhere. */
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
let activeActivitySubTab = 'news';   // v11.671: News Feed is the Activity tab's home/default
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
    photo: '/default-avatar.svg#Lena+Knox&background=1e2028&color=60a5fa',
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
    photo: '/default-avatar.svg#Marcus+Vale&background=2a1f5e&color=f8fafc',
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
    photo: '/default-avatar.svg#Yara+Bloom&background=111827&color=93c5fd',
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
      <img src="${escAttr(viewingUser.photo || '/default-avatar.svg#' + encodeURIComponent(viewingUser.name) + '&background=1e2028&color=60a5fa')}" class="viewing-user-avatar" alt="">
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

    activeDiscoveryHub = normalizeDiscoveryHub(activeDiscoveryHub || 'movies');
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
      <img src="${escAttr(viewingUser.photo || '/default-avatar.svg#' + encodeURIComponent(viewingUser.name) + '&background=1e2028&color=60a5fa')}" class="viewing-user-avatar" alt="">
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
    photo: '/default-avatar.svg#Preview+User&background=1c1535&color=a78bfa',
    bio: 'Testing ScreenList in preview mode. Build your shelves, rate titles, pin favorites, and customize your profile.',
    pinnedFavorites: {
      overallMedia: [
        { id: '569094', source: 'tmdb', type: 'movie', title: 'Spider-Man: Across the Spider-Verse', image: 'https://image.tmdb.org/t/p/w500/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg', rating: '★ 4.5/5', meta: '2023 · Movie' },
        { id: '1399', source: 'tmdb', type: 'tv', title: 'Game of Thrones', image: 'https://image.tmdb.org/t/p/w500/u3bZgnGQ9T01sWNhyveQz0wH0Hl.jpg', rating: '★ 4.5/5', meta: '2011 · TV / Anime' },
        { id: '209867', source: 'tmdb', type: 'tv', title: 'Frieren: Beyond Journey’s End', image: 'https://image.tmdb.org/t/p/w500/dqZENchTd7lp5zht7BdlqM7RBhN.jpg', rating: '★ 4.5/5', meta: '2023 · TV / Anime' }
      ],
      movies: [{ id: '569094', source: 'tmdb', type: 'movie', title: 'Spider-Man: Across the Spider-Verse', image: 'https://image.tmdb.org/t/p/w500/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg', rating: '★ 4.5/5', meta: '2023' }, {}, {}],
      shows: [{ id: '1399', source: 'tmdb', type: 'tv', title: 'Game of Thrones', image: 'https://image.tmdb.org/t/p/w500/u3bZgnGQ9T01sWNhyveQz0wH0Hl.jpg', rating: '★ 4.5/5', meta: '2011' }, {}, {}],
      anime: [{ id: '209867', source: 'tmdb', type: 'tv', title: 'Frieren: Beyond Journey’s End', image: 'https://image.tmdb.org/t/p/w500/dqZENchTd7lp5zht7BdlqM7RBhN.jpg', rating: '★ 4.5/5', meta: '2023' }, {}, {}],
      games: [{ id: '3498', source: 'rawg', type: 'game', title: 'Grand Theft Auto V', image: 'https://media.rawg.io/media/games/20a/20aa03a18ad10d5f05a16bc6ce0bb570.jpg', rating: '★ 5/5', meta: '2013' }, {}, {}],
      singlePlayerGames: [{ id: '3498', source: 'rawg', type: 'game', title: 'Grand Theft Auto V', image: 'https://media.rawg.io/media/games/20a/20aa03a18ad10d5f05a16bc6ce0bb570.jpg', rating: '★ 5/5', meta: '2013' }, {}, {}],
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
  /* v11.991: carry the shared TITLE + POSTER query params on the route so the
     opener can resolve non-numeric game ids (igdb:/steam:) by name. */
  let title = '';
  let poster = '';
  try {
    const sp = new URL(String(window.location.href)).searchParams;
    title = String(sp.get('title') || '').trim();
    poster = String(sp.get('poster') || '').trim();
  } catch (_) {}
  return { kind: match[1].toLowerCase(), id: decodeURIComponent(match[2] || '').trim(), title, poster };
}

function parseScreenListReviewRoute(urlLike = window.location) {
  try {
    const nextUrl = typeof urlLike === 'string' ? new URL(urlLike, window.location.origin) : urlLike;
    const pathname = String(nextUrl?.pathname || '');
    const hash = String(nextUrl?.hash || '');
    const pathMatch = pathname.match(/^\/review\/([^/?#]+)/i);
    const hashMatch = hash.match(/^#review\/([^/?#]+)/i);
    const match = pathMatch || hashMatch;
    if (!match) return null;
    return {
      postId: decodeURIComponent(match[1] || '').trim(),
      section: String(nextUrl?.searchParams?.get?.('section') || '').trim()
    };
  } catch (error) {
    return null;
  }
}

function parseScreenListFeedPostRoute(urlLike = window.location) {
  try {
    const nextUrl = typeof urlLike === 'string' ? new URL(urlLike, window.location.origin) : urlLike;
    const pathname = String(nextUrl?.pathname || '');
    const hash = String(nextUrl?.hash || '');
    const pathMatch = pathname.match(/^\/post\/([^/?#]+)/i);
    const hashMatch = hash.match(/^#post\/([^/?#]+)/i);
    const match = pathMatch || hashMatch;
    if (!match) return null;
    return {
      postId: decodeURIComponent(match[1] || '').trim()
    };
  } catch (error) {
    return null;
  }
}
window.parseScreenListFeedPostRoute = parseScreenListFeedPostRoute;

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
  /* v11.626: news ARTICLE shares. Unlike media (movie/tv/anime/game, which
     rebuild their url from kind+id), an article carries its own /article/{token}
     deep link + source. Validated to an http(s) url; the reader re-validates on
     open. Branch first so the media path below never sees it. */
  if (String(payload.kind || '').toLowerCase() === 'article') {
    const articleUrl = String(payload.url || '').trim();
    if (!/^https?:\/\//i.test(articleUrl)) return null;
    return {
      kind: 'article',
      id: String(payload.id || '').trim() || articleUrl,
      title: String(payload.title || '').trim() || 'Article',
      poster: String(payload.poster || '').trim(),
      url: articleUrl,
      source: String(payload.source || '').trim()
    };
  }
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
      /* v11.581: carry the shared title (from the DM card's data-share-title) so a
         GAME with no numeric RAWG id can resolve by NAME instead of opening empty. */
      const shareTitle = String(
        event?.currentTarget?.dataset?.shareTitle
        || (event?.target?.closest && event.target.closest('[data-share-title]')?.dataset?.shareTitle)
        || ''
      ).trim();
      openSharedMediaProfileRoute(route, { title: shareTitle });
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

async function openSharedMediaProfileRoute(route = parseScreenListMediaRoute(), opts = {}) {
  const diag = window.__shelfdDeepLinkDiag || function(){};
  diag('openSharedMediaProfileRoute entry — route=' + JSON.stringify(route));
  if (!route?.id || screenListMediaRouteOpening) {
    diag('bail — no id or already opening (opening=' + screenListMediaRouteOpening + ')', 'err');
    return false;
  }
  screenListMediaRouteOpening = true;
  screenListSharedMediaRouteActive = false;
  prepareSharedMediaRouteView();
  diag('prepareSharedMediaRouteView done');
  try {
    if (route.kind === 'game') {
      diag('opening as GAME');
      if (typeof setGameMediaProfileSeed !== 'function') { diag('setGameMediaProfileSeed undefined', 'err'); throw new Error('setGameMediaProfileSeed undefined'); }
      if (typeof openGameMediaProfile !== 'function') { diag('openGameMediaProfile undefined', 'err'); throw new Error('openGameMediaProfile undefined'); }
      /* v11.581: Steam/IGDB games have no numeric RAWG id, so a shared game link can
         carry a non-numeric id (igdb:/identity key) that openGameMediaProfile can't
         fetch — it rendered an empty "Game Profile". When the id isn't numeric, pass
         the shared TITLE so resolveRawgIdForGameSeed finds the real RAWG id by name. */
      const numericRawg = /^\d+$/.test(String(route.id || '')) ? String(route.id) : '';
      const sharedGameTitle = String(opts.title || route.title || '').trim();
      const sharedGamePoster = String(opts.poster || route.poster || '').trim();
      /* v11.991: seed the title (so resolveRawgIdForGameSeed can find the RAWG
         id by name for non-numeric igdb:/steam: ids) AND the poster (so the hero
         shows immediately and the profile is never blank, even if RAWG has no
         match for the title). */
      const gameSeed = { rawgId: numericRawg, title: sharedGameTitle, name: sharedGameTitle };
      if (/^https?:\/\//i.test(sharedGamePoster)) {
        gameSeed.cover = sharedGamePoster;
        gameSeed.poster = sharedGamePoster;
        gameSeed.background_image = sharedGamePoster;
      }
      diag('GAME id=' + route.id + ' numericRawg=' + (numericRawg || '(none)') + ' title=' + (gameSeed.title || '(none)'));
      setGameMediaProfileSeed(route.id, gameSeed);
      await openGameMediaProfile(null, numericRawg, gameSeed);
    } else {
      const tmdbType = route.kind === 'movie' ? 'movie' : 'tv';
      diag('opening as ' + tmdbType.toUpperCase() + ' (kind=' + route.kind + ')');
      if (typeof setDiscoverMediaProfileSeed !== 'function') { diag('setDiscoverMediaProfileSeed undefined', 'err'); throw new Error('setDiscoverMediaProfileSeed undefined'); }
      if (typeof openDiscoverMediaProfile !== 'function') { diag('openDiscoverMediaProfile undefined', 'err'); throw new Error('openDiscoverMediaProfile undefined'); }
      const seed = route.kind === 'anime' ? { mediaCategory: 'anime', librarySection: 'anime', isAnime: true } : {};
      setDiscoverMediaProfileSeed(tmdbType, route.id, seed);
      diag('setDiscoverMediaProfileSeed done — calling openDiscoverMediaProfile…');
      await openDiscoverMediaProfile(null, tmdbType, route.id);
      diag('openDiscoverMediaProfile returned', 'ok');
    }
    screenListSharedMediaRouteActive = true;
    return true;
  } catch (e) {
    console.error('Shared media route failed:', e);
    diag('THREW: ' + (e && e.message || e), 'err');
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
  if (typeof parseScreenListAlbumRoute === 'function' && parseScreenListAlbumRoute()) {
    openSharedAlbumRoute();
    return;
  }
  if (typeof parseScreenListGameProfileRoute === 'function' && parseScreenListGameProfileRoute() && typeof openSharedGameProfileRoute === 'function') {
    openSharedGameProfileRoute();
    return;
  }
  if (typeof parseScreenListNewsArticleRoute === 'function') {
    const newsArticleRoute = parseScreenListNewsArticleRoute();
    if (newsArticleRoute && newsArticleRoute.url) {
      if (typeof openSharedNewsArticleRoute === 'function') {
        openSharedNewsArticleRoute(newsArticleRoute);
      } else {
        window.addEventListener('load', () => {
          if (typeof openSharedNewsArticleRoute === 'function') openSharedNewsArticleRoute(newsArticleRoute);
        }, { once: true });
      }
      return;
    }
  }
  const feedPostRoute = parseScreenListFeedPostRoute();
  if (feedPostRoute?.postId) {
    if (typeof openSharedFeedPostRoute === 'function') {
      openSharedFeedPostRoute(feedPostRoute);
    } else {
      window.addEventListener('load', () => {
        if (typeof openSharedFeedPostRoute === 'function') openSharedFeedPostRoute(feedPostRoute);
      }, { once: true });
    }
    return;
  }
  const reviewRoute = parseScreenListReviewRoute();
  if (reviewRoute?.postId) {
    if (typeof openSharedMediaReviewRoute === 'function') {
      openSharedMediaReviewRoute(reviewRoute);
    } else {
      window.addEventListener('load', () => {
        if (typeof openSharedMediaReviewRoute === 'function') openSharedMediaReviewRoute(reviewRoute);
      }, { once: true });
    }
    return;
  }
  if (typeof parseScreenListProfileRoute === 'function') {
    const profileRoute = parseScreenListProfileRoute();
    if (profileRoute?.uid && (profileRoute.section || window.location.pathname.startsWith('/profile-card/') || window.location.pathname.startsWith('/profile/'))) {
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
        <img src="${user.photo || '/default-avatar.svg#' + encodeURIComponent(user.name || 'Preview User') + '&background=1e2028&color=60a5fa'}" class="viewing-user-avatar" alt="">
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

/* v10.547: Universal Link / deep-link handler for Capacitor iOS.
   When the app is opened via a myshelfd.com share link (tapped in
   iMessage, WhatsApp, Safari, etc.), Capacitor fires 'appUrlOpen'.
   We parse the path and open the correct media profile or album page
   directly — the user lands right inside the app on the right screen.

   IMPORTANT — Xcode side also required (one-time, cannot web-deploy):
     1. Xcode → Signing & Capabilities → "+ Capability" → Associated Domains
     2. Add: applinks:myshelfd.com  and  applinks:myscreenlist.com
   Without those entitlements iOS will open the link in Safari instead. */
(function initCapacitorUniversalLinkHandler() {
  /* v11.007: visible diagnostic banners removed (they were temporary —
     v11.005/v11.006 confirmed the @capacitor/app plugin was missing in
     the iOS shell). The fix is native-side: `npm install @capacitor/app
     && npx cap sync ios` then re-archive. Once the plugin is installed,
     the existing `appUrlOpen` listener below will fire normally and
     deep-link handoff works.
     A no-op `__shelfdDeepLinkDiag` is kept so any leftover calls in
     dependent code don't throw. console.info still logs each step for
     Safari Web Inspector debugging. */
  function __shelfdDeepLinkDiag(msg, kind) {
    try { console.info('[deep-link]', kind ? '[' + kind + ']' : '', msg); } catch (_) {}
  }
  window.__shelfdDeepLinkDiag = __shelfdDeepLinkDiag;

  function handleAppUrlOpen(event) {
    const rawUrl = event && (event.url || event.detail?.url);
    __shelfdDeepLinkDiag('appUrlOpen fired: ' + (rawUrl || '(empty)'));
    if (!rawUrl) return;
    try {
      const parsed = new URL(String(rawUrl));
      __shelfdDeepLinkDiag('parsed pathname: ' + parsed.pathname);

      /* /auth/verify - Firebase email verification continue URL.
         This path is intentionally a Universal Link so iOS returns the user
         to the installed app after Firebase confirms the email in Safari. */
      if (parsed.pathname === '/auth/verify') {
        try { window.history.replaceState({}, '', parsed.pathname + parsed.search + parsed.hash); } catch (_) {}
        let verifyReturnAttempts = 0;
        const finishVerifyReturn = () => {
          if (typeof window.handleShelfdVerificationReturn === 'function') {
            window.handleShelfdVerificationReturn();
            return;
          }
          verifyReturnAttempts += 1;
          if (verifyReturnAttempts <= 20) {
            setTimeout(finishVerifyReturn, 100);
          }
        };
        if (document.readyState === 'complete') finishVerifyReturn();
        else window.addEventListener('load', finishVerifyReturn, { once: true });
        return;
      }

      /* /media/{kind}/{id} — movie / tv / anime / game profile */
      const mediaMatch = parsed.pathname.match(/^\/media\/(movie|tv|anime|game)\/([^/?#]+)/i);
      if (mediaMatch) {
        const route = {
          kind: mediaMatch[1].toLowerCase(),
          id: decodeURIComponent(mediaMatch[2] || '').trim()
        };
        /* v11.991: forward the shared TITLE + POSTER query params to the opener.
           Game share links for IGDB/Steam titles carry a non-numeric id
           (e.g. igdb:362044) with no RAWG id — without the title the game
           profile cannot resolve and renders a blank "Game Profile". */
        const mediaOpts = {
          title: String(parsed.searchParams.get('title') || '').trim(),
          poster: String(parsed.searchParams.get('poster') || '').trim()
        };
        __shelfdDeepLinkDiag('matched /media route: ' + route.kind + ' / ' + route.id + ' title=' + (mediaOpts.title || '(none)'));
        const fireRoute = () => {
          if (typeof openSharedMediaProfileRoute !== 'function') {
            __shelfdDeepLinkDiag('openSharedMediaProfileRoute NOT defined yet', 'err');
            return;
          }
          __shelfdDeepLinkDiag('calling openSharedMediaProfileRoute()…');
          Promise.resolve(openSharedMediaProfileRoute(route, mediaOpts))
            .then(ok => __shelfdDeepLinkDiag('openSharedMediaProfileRoute → ' + (ok ? 'OK' : 'FAIL/false'), ok ? 'ok' : 'err'))
            .catch(err => __shelfdDeepLinkDiag('openSharedMediaProfileRoute threw: ' + (err && err.message || err), 'err'));
        };
        if (route.id) {
          if (document.readyState === 'complete') fireRoute();
          else window.addEventListener('load', fireRoute, { once: true });
        }
        return;
      }

      /* /album/{ownerUid}/{albumKey} — shared album shelf page */
      const albumRoute = typeof parseScreenListAlbumRoute === 'function' ? parseScreenListAlbumRoute(parsed) : null;
      if (albumRoute?.ownerUid && albumRoute?.albumKey && typeof openSharedAlbumRoute === 'function') {
        if (document.readyState === 'complete') {
          openSharedAlbumRoute(albumRoute);
        } else {
          window.addEventListener('load', () => openSharedAlbumRoute(albumRoute), { once: true });
        }
        return;
      }

      /* /game-profile/{ownerUid}/{itemId} — shared competitive game profile */
      const gameProfileRoute = typeof parseScreenListGameProfileRoute === 'function' ? parseScreenListGameProfileRoute(parsed) : null;
      if (gameProfileRoute?.itemId && typeof openSharedGameProfileRoute === 'function') {
        if (document.readyState === 'complete') {
          openSharedGameProfileRoute(gameProfileRoute);
        } else {
          window.addEventListener('load', () => openSharedGameProfileRoute(gameProfileRoute), { once: true });
        }
        return;
      }

      /* /article/{base64url(articleUrl)} — shared news article → in-app reader */
      const newsArticleRoute = typeof parseScreenListNewsArticleRoute === 'function' ? parseScreenListNewsArticleRoute(parsed) : null;
      if (newsArticleRoute?.url && typeof openSharedNewsArticleRoute === 'function') {
        if (document.readyState === 'complete') {
          openSharedNewsArticleRoute(newsArticleRoute);
        } else {
          window.addEventListener('load', () => openSharedNewsArticleRoute(newsArticleRoute), { once: true });
        }
        return;
      }

      /* /review/{postId} — shared full-page user review */
      const feedPostRoute = parseScreenListFeedPostRoute(parsed);
      if (feedPostRoute?.postId) {
        const opener = () => {
          if (typeof openSharedFeedPostRoute === 'function') openSharedFeedPostRoute(feedPostRoute);
        };
        if (document.readyState === 'complete') opener();
        else window.addEventListener('load', opener, { once: true });
        return;
      }

      const reviewRoute = parseScreenListReviewRoute(parsed);
      if (reviewRoute?.postId) {
        const opener = () => {
          if (typeof openSharedMediaReviewRoute === 'function') openSharedMediaReviewRoute(reviewRoute);
        };
        if (document.readyState === 'complete') opener();
        else window.addEventListener('load', opener, { once: true });
        return;
      }

      /* /profile/{uid}, /profile-card/{uid}/{section}/{rank}, or legacy ?profile={uid} */
      const profileRoute = typeof parseScreenListProfileRoute === 'function' ? parseScreenListProfileRoute(parsed) : null;
      if (profileRoute?.uid && typeof openProfileRouteDirect === 'function') {
        if (document.readyState === 'complete') {
          openProfileRouteDirect(profileRoute);
        } else {
          window.addEventListener('load', () => openProfileRouteDirect(profileRoute), { once: true });
        }
        return;
      }
    } catch (e) {
      try { console.warn('[universalLink] parse failed:', e); } catch (_) {}
    }
  }

  function wireCapacitorListener() {
    /* v11.006: persistent boot-time diagnostic — fires regardless of
       whether appUrlOpen later fires. Lets us see EXACTLY which part
       of the native bridge is missing on this build. Stays visible
       ~10s so the user has time to screenshot. */
    try {
      const Cap = window.Capacitor;
      const hasCap = !!Cap;
      const hasIsNative = hasCap && typeof Cap.isNativePlatform === 'function';
      const isNative = hasIsNative ? Cap.isNativePlatform() : null;
      const platform = (hasCap && typeof Cap.getPlatform === 'function') ? Cap.getPlatform() : '(no getPlatform)';
      const plugins = hasCap && Cap.Plugins ? Object.keys(Cap.Plugins) : [];
      const AppPlugin = Cap && Cap.Plugins && Cap.Plugins.App;
      const hasAppListener = !!(AppPlugin && typeof AppPlugin.addListener === 'function');
      const hasGetLaunchUrl = !!(AppPlugin && typeof AppPlugin.getLaunchUrl === 'function');
      __shelfdDeepLinkDiag('Capacitor: ' + (hasCap ? 'yes' : 'NO') + ' | native: ' + isNative + ' | platform: ' + platform);
      __shelfdDeepLinkDiag('Plugins available: ' + (plugins.length ? plugins.join(',') : '(none)'));
      __shelfdDeepLinkDiag('App.addListener: ' + (hasAppListener ? 'yes' : 'NO') + ' | App.getLaunchUrl: ' + (hasGetLaunchUrl ? 'yes' : 'NO'));

      if (!Cap) return;
      /* Modern Capacitor: Capacitor.Plugins.App.addListener */
      if (hasAppListener) {
        AppPlugin.addListener('appUrlOpen', handleAppUrlOpen);
        __shelfdDeepLinkDiag('addListener("appUrlOpen") bound', 'ok');
        if (hasGetLaunchUrl) {
          try {
            AppPlugin.getLaunchUrl().then(result => {
              const launchUrl = result && result.url;
              __shelfdDeepLinkDiag('getLaunchUrl resolved: ' + (launchUrl || '(null)'), launchUrl ? 'ok' : null);
              if (launchUrl) handleAppUrlOpen(result);
            }).catch(err => {
              __shelfdDeepLinkDiag('getLaunchUrl rejected: ' + (err && err.message || err), 'err');
            });
          } catch (e) {
            __shelfdDeepLinkDiag('getLaunchUrl threw sync: ' + (e && e.message || e), 'err');
          }
        }
        return;
      }
      /* Fallback: some builds expose window.Capacitor.addListener directly */
      if (typeof Cap.addListener === 'function') {
        Cap.addListener('appUrlOpen', handleAppUrlOpen);
        __shelfdDeepLinkDiag('Cap.addListener fallback bound', 'ok');
      } else {
        __shelfdDeepLinkDiag('NO App plugin AND no Cap.addListener — native side missing the App plugin', 'err');
      }
    } catch (e) {
      __shelfdDeepLinkDiag('wireCapacitorListener threw: ' + (e && e.message || e), 'err');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireCapacitorListener);
  } else {
    wireCapacitorListener();
  }
})();

/* v11.003: BOOT-TIME URL FALLBACK for shared media-profile links.

   Bug: tapping a shared `https://myshelfd.com/media/tv/{tmdb_id}` link
   from outside Shelfd opened the iOS app (so Universal Links is wired
   correctly in Xcode) but did NOT deep-link to the actual title —
   the user landed on home. Repro: shared Widow's Bay, tapped the
   link, app opened on its home screen instead of the show profile.

   Root cause analysis:
   - The only path that deep-linked was the Capacitor `appUrlOpen` /
     `getLaunchUrl()` flow.
   - When that flow fires too early (before
     `openDiscoverMediaProfile` is hydrated), the call inside
     `openSharedMediaProfileRoute` throws, gets caught, surfaces a
     toast, and silently returns — nothing else retries.
   - The previously-defined `syncSignedOutRoute()` helper was never
     called from anywhere, so there was no boot-time URL backstop.

   Fix: poll `window.location.pathname` at boot (and again after
   `load`) for the `/media/{kind}/{id}` pattern. When the URL
   matches, wait — with retry — for `openDiscoverMediaProfile` (or
   `openGameMediaProfile` for game routes) to be defined, then fire
   `openSharedMediaProfileRoute`. Up to ~10s of retries at 250ms
   intervals covers slow cold-start cases on iOS. Idempotent —
   guarded by `screenListMediaRouteOpening` so it won't double-fire
   if the Capacitor handler already opened the route. */
(function bootResolveSharedMediaRouteFromUrl() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__shelfdBootMediaRouteFallbackBound) return;
  window.__shelfdBootMediaRouteFallbackBound = true;

  let bootAttempts = 0;
  const MAX_ATTEMPTS = 40; /* 40 × 250ms = 10s window */
  let scheduled = false;

  function readMediaRouteFromUrl() {
    try {
      const path = String(window.location.pathname || '');
      const hash = String(window.location.hash || '');
      const pathMatch = path.match(/^\/media\/(movie|tv|anime|game)\/([^/?#]+)/i);
      const hashMatch = hash.match(/^#media\/(movie|tv|anime|game)\/([^/?#]+)/i);
      const match = pathMatch || hashMatch;
      if (!match) return null;
      /* v11.991: carry the shared TITLE + POSTER so non-numeric game ids
         (igdb:/steam:) can still resolve a profile on cold launch. */
      let title = '';
      let poster = '';
      try {
        const sp = new URL(String(window.location.href)).searchParams;
        title = String(sp.get('title') || '').trim();
        poster = String(sp.get('poster') || '').trim();
      } catch (_) {}
      return { kind: match[1].toLowerCase(), id: decodeURIComponent(match[2] || '').trim(), title, poster };
    } catch (_) { return null; }
  }

  function dependenciesReady(route) {
    if (!route) return false;
    if (typeof window.openSharedMediaProfileRoute !== 'function'
        && typeof openSharedMediaProfileRoute !== 'function') return false;
    if (route.kind === 'game') {
      return typeof window.openGameMediaProfile === 'function'
          || typeof openGameMediaProfile === 'function';
    }
    return typeof window.openDiscoverMediaProfile === 'function'
        || typeof openDiscoverMediaProfile === 'function';
  }

  function tryResolveSharedMediaRoute() {
    scheduled = false;
    const route = readMediaRouteFromUrl();
    if (!route?.id) return;
    if (window.__screenListSharedMediaRouteResolved) return;
    /* DOM-presence guard: if a media profile overlay is already on
       screen, the Capacitor `appUrlOpen` path got there first — don't
       open again. (`screenListMediaRouteOpening` is module-scoped
       `let` and not on window, so we can't read it directly from this
       IIFE; the DOM check is the reliable observable signal.) */
    if (document.getElementById('discover-media-profile')
        || document.querySelector('.game-media-profile-overlay')) {
      window.__screenListSharedMediaRouteResolved = true;
      return;
    }
    if (!dependenciesReady(route)) {
      bootAttempts += 1;
      if (bootAttempts > MAX_ATTEMPTS) {
        try { console.warn('[v11.003] shared media route fallback gave up — dependencies never loaded', route); } catch (_) {}
        return;
      }
      scheduleRetry();
      return;
    }
    try {
      const fn = window.openSharedMediaProfileRoute || openSharedMediaProfileRoute;
      Promise.resolve(fn(route, { title: route.title || '', poster: route.poster || '' })).then(ok => {
        if (ok) window.__screenListSharedMediaRouteResolved = true;
      }).catch(err => {
        try { console.warn('[v11.003] openSharedMediaProfileRoute fallback threw:', err); } catch (_) {}
      });
    } catch (err) {
      try { console.warn('[v11.003] shared media route fallback hard-threw:', err); } catch (_) {}
    }
  }

  function scheduleRetry() {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(tryResolveSharedMediaRoute, 250);
  }

  /* Kick off as soon as DOM is parseable so we start the retry clock
     immediately on cold boot. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryResolveSharedMediaRoute, { once: true });
  } else {
    tryResolveSharedMediaRoute();
  }
  /* Second pass after full `load` event — by then nearly all script
     modules are guaranteed to be hydrated, so this catches any case
     the early retry exhausted before the deps were ready. */
  window.addEventListener('load', () => {
    bootAttempts = 0; /* reset for the post-load attempt window */
    tryResolveSharedMediaRoute();
  }, { once: true });
})();
