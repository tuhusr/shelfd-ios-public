/* v979: Active duel matchup stage simplified to poster-only layout with animated incoming opponent swaps. */
(function initShelfdMovieRatingDuel() {
  if (window.__shelfdTierListGameV979) return;
  window.__shelfdTierListGameV979 = true;

  let duelScrollY = 0;
  let duelState = null;
  let duelSwapTimer = 0;
  let duelMediaKey = 'movies';
  let duelReadOnlyUser = null;
  let movieDuelVisibleTierList = null;
  let movieDuelVisibleTierActiveId = '';
  let movieDuelVisibleTierMediaKey = duelMediaKey;
  let movieDuelTierVisibleCounts = {};
  let movieDuelTierDragState = null;
  let movieDuelTierDragSuppressClickUntil = 0;
  const movieDuelTierListCache = {};
  const movieDuelTierListSaveQueues = {};
  const MOVIE_DUEL_TIER_STORAGE_PREFIX = 'shelfd-tier-list-cache-v1';
  const duelSelectedItemIds = {};
  const TIER_ROW_INITIAL_LIMIT = 12;
  const TIER_ROW_LOAD_STEP = 12;
  const S_TIER_CAP = 5;
  const TIER_LONG_PRESS_MS = 260;
  /* v10.493: was 8px — too tight, real finger jitter on iPhone was
     canceling the long-press intent before the timer fired. 16px gives
     enough latitude for a stationary "hold" gesture without bleeding
     into a clear horizontal swipe (which is well over 16px in the
     first 260ms). */
  const TIER_LONG_PRESS_MOVE_TOLERANCE = 16;
  const DUEL_SWAP_MS = 240;
  const MOVIE_DUEL_BASE_CLOSE_MS = 180;
  const MOVIE_DUEL_TIER_TRANSITION_MS = 450;

  const MEDIA_CONFIGS = {
    movies: {
      key: 'movies',
      label: 'Movie',
      plural: 'Movies',
      lower: 'movie',
      sourceSection: 'movies',
      profileKey: 'movieRatingTierList',
      tierTitle: 'Movie Tier List',
      emptyLabel: 'watched movies',
      filterItem: item => item?.status === 'watched'
    },
    shows: {
      key: 'shows',
      label: 'TV Show',
      plural: 'TV Shows',
      lower: 'TV show',
      sourceSection: 'shows',
      profileKey: 'tvRatingTierList',
      tierTitle: 'TV Show Tier List',
      emptyLabel: 'watched TV shows',
      filterItem: item => item?.status === 'watched'
    },
    anime: {
      key: 'anime',
      label: 'Anime',
      plural: 'Anime',
      lower: 'anime',
      sourceSection: 'anime',
      profileKey: 'animeRatingTierList',
      tierTitle: 'Anime Tier List',
      emptyLabel: 'watched anime',
      filterItem: item => item?.status === 'watched'
    },
    games: {
      key: 'games',
      label: 'Video Game',
      plural: 'Video Games',
      lower: 'video game',
      sourceSection: 'games',
      profileKey: 'gameRatingTierList',
      tierTitle: 'Video Game Tier List',
      emptyLabel: 'played, live, or competitive games',
      filterItem: item => ['watched', 'played', 'live', 'competitive'].includes(String(item?.status || '').toLowerCase())
    },
    music: {
      key: 'music',
      label: 'Album',
      plural: 'Music',
      lower: 'album',
      sourceSection: 'music',
      profileKey: 'musicRatingTierList',
      tierTitle: 'Music Tier List',
      emptyLabel: 'rated albums',
      /* Music section stores completed/rated items with status='watched'
         per v10.238 — same convention used by movies/shows/anime. */
      filterItem: item => item?.status === 'watched'
    }
  };

  const MEDIA_ORDER = ['movies', 'shows', 'anime', 'games', 'music'];
  duelMediaKey = getDefaultDuelMediaKey();
  movieDuelVisibleTierMediaKey = duelMediaKey;

  const TIER_ROWS = [
    { key: 'S', rating: 10, displayRating: 5, label: 'S Tier', meta: '&#9733; 5' },
    { key: 'A', rating: 9, displayRating: 4, label: 'A Tier', meta: '&#9733; 4' },
    { key: 'B', rating: 8, displayRating: 3, label: 'B Tier', meta: '&#9733; 3' },
    { key: 'C', rating: 7, displayRating: 2, label: 'C Tier', meta: '&#9733; 2' },
    { key: 'D', rating: 6, displayRating: 1, label: 'D Tier', meta: '&#9733; 1' }
  ];
  const LEGACY_TIER_RATINGS = { S: 10, A: 9, B: 8, C: 7, D: 6, E: 5, F: 4 };

  function html(value = '') {
    if (typeof escHtml === 'function') return escHtml(value);
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  }

  function attr(value = '') {
    if (typeof escAttr === 'function') return escAttr(value);
    return html(value);
  }

  function cleanText(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function clampRating(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.max(1, Math.min(10, Math.round(numeric)));
  }

  function getTierKeyForRating(value) {
    const rating = clampRating(value);
    if (rating >= 10) return 'S';
    if (rating >= 9) return 'A';
    if (rating >= 8) return 'B';
    if (rating >= 7) return 'C';
    return 'D';
  }

  function getTierRowByKey(tierKey = '') {
    const key = cleanText(tierKey).toUpperCase();
    return TIER_ROWS.find(tier => tier.key === key) || null;
  }

  function getTierDisplayRating(tierKey = '', fallbackRating = 0) {
    const row = getTierRowByKey(tierKey);
    if (!row) return clampRating(fallbackRating);
    return row.rating;
  }

  function getTierStarRating(value = 0) {
    if (!clampRating(value)) return 0;
    const row = getTierRowByKey(getTierKeyForRating(value));
    return row?.displayRating || 1;
  }

  function getMediaConfig(mediaKey = duelMediaKey) {
    return MEDIA_CONFIGS[mediaKey] || MEDIA_CONFIGS.movies;
  }

  function isMovieDuelReadOnly() {
    return !!duelReadOnlyUser;
  }

  function getTierListProfileSource() {
    return duelReadOnlyUser?.profileData || duelReadOnlyUser || userProfile || null;
  }

  function getTierListCacheKey(mediaKey = duelMediaKey) {
    return getMediaConfig(mediaKey).key;
  }

  function cloneTierListPayload(payload = null) {
    if (!payload || typeof payload !== 'object') return null;
    try {
      return JSON.parse(JSON.stringify(payload));
    } catch (error) {
      return null;
    }
  }

  function getTierListStorageOwnerId() {
    return cleanText(currentUser?.uid || userProfile?.uid || '');
  }

  function getTierListStorageKey(mediaKey = duelMediaKey) {
    const ownerId = getTierListStorageOwnerId();
    if (!ownerId) return '';
    return `${MOVIE_DUEL_TIER_STORAGE_PREFIX}:${ownerId}:${getTierListCacheKey(mediaKey)}`;
  }

  function readPersistedTierList(mediaKey = duelMediaKey) {
    const storageKey = getTierListStorageKey(mediaKey);
    if (!storageKey || typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function writePersistedTierList(mediaKey = duelMediaKey, payload = null) {
    const storageKey = getTierListStorageKey(mediaKey);
    if (!storageKey || typeof localStorage === 'undefined') return;
    try {
      if (payload && typeof payload === 'object') {
        localStorage.setItem(storageKey, JSON.stringify(payload));
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch (error) {}
  }

  function getTierListUpdatedAt(raw = null) {
    const iso = cleanText(raw?.updatedAt || '');
    return iso ? (Date.parse(iso) || 0) : 0;
  }

  function pickLatestTierListSource(cached = null, saved = null) {
    if (!cached) return saved || null;
    if (!saved) return cached;
    return getTierListUpdatedAt(cached) >= getTierListUpdatedAt(saved) ? cached : saved;
  }

  function readCachedTierList(mediaKey = duelMediaKey) {
    const key = getTierListCacheKey(mediaKey);
    if (movieDuelTierListCache[key]) return cloneTierListPayload(movieDuelTierListCache[key]);
    const persisted = readPersistedTierList(mediaKey);
    if (!persisted) return null;
    movieDuelTierListCache[key] = cloneTierListPayload(persisted);
    return cloneTierListPayload(persisted);
  }

  function writeCachedTierList(mediaKey = duelMediaKey, payload = null) {
    const key = getTierListCacheKey(mediaKey);
    const cloned = cloneTierListPayload(payload);
    if (cloned) movieDuelTierListCache[key] = cloned;
    else delete movieDuelTierListCache[key];
    writePersistedTierList(mediaKey, cloned);
    return cloned ? normalizeSavedTierList(cloned, mediaKey) : null;
  }

  function getDefaultDuelMediaKey() {
    const current = cleanText(typeof activeSection !== 'undefined' ? activeSection : '').toLowerCase();
    return MEDIA_CONFIGS[current] ? current : 'movies';
  }

  function getDuelListData() {
    return typeof getVisibleListData === 'function' ? getVisibleListData() : data;
  }

  function getTierItemId(item = {}) {
    return cleanText(item.id || item.tmdbId || item.imdbId || item.malId || item.mal_id || item.rawgId || item.igdbId || item.slug || item.title || item.name || '');
  }

  function getDuelTitle(item = {}, mediaKey = duelMediaKey) {
    const config = getMediaConfig(mediaKey);
    if (typeof getDisplayTitleForItem === 'function') {
      return cleanText(getDisplayTitleForItem(item, config.sourceSection));
    }
    return cleanText(item.title || item.name || 'Untitled');
  }

  function getDuelPoster(item = {}, mediaKey = duelMediaKey) {
    const config = getMediaConfig(mediaKey);
    if (typeof getMyListPosterUrlForItem === 'function') return getMyListPosterUrlForItem(item, config.sourceSection);
    return cleanText(item.cover || item.poster || item.image || item.background_image || item.backgroundImage || '');
  }

  function getDuelItems(mediaKey = duelMediaKey) {
    if (viewingUser || isMovieDuelReadOnly()) return [];
    const config = getMediaConfig(mediaKey);
    const source = getDuelListData();
    const items = Array.isArray(source?.[config.sourceSection]) ? source[config.sourceSection] : [];
    return items.filter(item => item && config.filterItem(item));
  }

  function getDuelItemRating(item = {}) {
    return clampRating(item.__duelRating ?? item.rating);
  }

  function makeTierEntry(item = {}, mediaKey = duelMediaKey, ratingOverride = null) {
    const rating = clampRating(ratingOverride ?? item.__duelRating ?? item.rating);
    return {
      id: getTierItemId(item),
      title: getDuelTitle(item, mediaKey) || 'Untitled',
      poster: getDuelPoster(item, mediaKey),
      rating,
      tier: getTierKeyForRating(rating),
      mediaKey: getMediaConfig(mediaKey).key,
      updatedAt: new Date().toISOString()
    };
  }

  function getEmptyTierList() {
    return TIER_ROWS.reduce((acc, tier) => {
      acc[tier.key] = [];
      return acc;
    }, {});
  }

  function normalizeSavedTierList(raw = null, mediaKey = duelMediaKey) {
    const config = getMediaConfig(mediaKey);
    const next = getEmptyTierList();
    const source = raw && typeof raw === 'object'
      ? (raw.tiers && typeof raw.tiers === 'object' ? raw.tiers : raw)
      : {};
    const sourceTierKeys = Array.from(new Set([
      ...TIER_ROWS.map(tier => tier.key),
      ...Object.keys(LEGACY_TIER_RATINGS),
      ...Object.keys(source)
    ]));
    sourceTierKeys.forEach(sourceTierKey => {
      const legacyKey = cleanText(sourceTierKey).toUpperCase();
      const entries = Array.isArray(source[sourceTierKey]) ? source[sourceTierKey] : [];
      entries
        .map(entry => {
          const rating = clampRating(entry?.rating || LEGACY_TIER_RATINGS[legacyKey] || 0);
          const tierKey = getTierKeyForRating(rating);
          return {
            id: cleanText(entry?.id || entry?.tmdbId || entry?.malId || entry?.rawgId || entry?.title || ''),
            title: cleanText(entry?.title || 'Untitled'),
            poster: cleanText(entry?.poster || entry?.cover || entry?.image || ''),
            rating: getTierDisplayRating(tierKey, rating),
            tier: tierKey,
            mediaKey: cleanText(entry?.mediaKey || config.key),
            updatedAt: cleanText(entry?.updatedAt || '')
          };
        })
        .filter(entry => entry.id || entry.title)
        .forEach(entry => {
          if (!Array.isArray(next[entry.tier])) next[entry.tier] = [];
          next[entry.tier].push(entry);
        });
    });
    return next;
  }

  function seedTierListFromLibrary(mediaKey = duelMediaKey, tierList = null) {
    const next = normalizeSavedTierList(tierList, mediaKey);
    const seen = new Set();
    const existingEntries = new Map();
    TIER_ROWS.forEach(tier => {
      next[tier.key].forEach((entry, index) => {
        const key = entry.id || entry.title.toLowerCase();
        if (!key) return;
        entry.__tierOrder = index;
        seen.add(key);
        existingEntries.set(key, entry);
      });
    });
    getDuelItems(mediaKey).forEach(item => {
      const rating = clampRating(item.rating);
      if (!rating) return;
      const entry = makeTierEntry(item, mediaKey, rating);
      const key = entry.id || entry.title.toLowerCase();
      if (!key) return;
      const savedEntry = existingEntries.get(key);
      if (savedEntry) {
        if (!savedEntry.poster && entry.poster) savedEntry.poster = entry.poster;
        if ((!savedEntry.title || savedEntry.title === 'Untitled') && entry.title) savedEntry.title = entry.title;
        if (!savedEntry.rating && entry.rating) savedEntry.rating = entry.rating;
        return;
      }
      if (seen.has(key)) return;
      next[entry.tier].push(entry);
      seen.add(key);
    });
    return next;
  }

  function getSavedTierList(mediaKey = duelMediaKey) {
    const config = getMediaConfig(mediaKey);
    const profileSource = getTierListProfileSource();
    const savedTierList = profileSource?.[config.profileKey];
    const cachedTierList = !isMovieDuelReadOnly() ? readCachedTierList(mediaKey) : null;
    const activeTierList = !isMovieDuelReadOnly()
      ? pickLatestTierListSource(cachedTierList, savedTierList)
      : savedTierList;
    if (!isMovieDuelReadOnly() && activeTierList && activeTierList === savedTierList) {
      writeCachedTierList(mediaKey, activeTierList);
    }
    return isMovieDuelReadOnly()
      ? normalizeSavedTierList(activeTierList, mediaKey)
      : seedTierListFromLibrary(mediaKey, activeTierList);
  }

  function getTierEntryMap(mediaKey = duelMediaKey) {
    const map = new Map();
    const tierList = getSavedTierList(mediaKey);
    TIER_ROWS.forEach(tier => {
      (tierList[tier.key] || []).forEach((entry, index) => {
        const key = cleanText(entry.id || entry.title || '');
        if (!key) return;
        map.set(key, { ...entry, __tierOrder: index });
      });
    });
    return map;
  }

  function getDuelItemsForSession(mediaKey = duelMediaKey) {
    const savedEntries = getTierEntryMap(mediaKey);
    return getDuelItems(mediaKey).map(item => {
      const key = getTierItemId(item);
      const saved = savedEntries.get(key);
      return {
        ...item,
        __duelRating: clampRating(saved?.rating || item.rating),
        __tierOrder: Number.isFinite(saved?.__tierOrder) ? saved.__tierOrder : 9999
      };
    });
  }

  function buildDuelComparisonQueue(itemsByBand = {}, occupiedBands = [], baseBand = 0, targetItem = null, mediaKey = duelMediaKey) {
    const queue = [];
    const startBand = getFirstComparisonBand(baseBand, occupiedBands);
    if (!startBand) return { queue, terminalWinBand: Math.max(1, Math.min(10, baseBand || 1)) };
    let band = startBand;
    while (band) {
      const bandState = getBandState(targetItem, itemsByBand, band, mediaKey);
      if (bandState.currentOpponent) {
        queue.push({
          band,
          tierKey: getTierKeyForRating(band),
          opponents: bandState.opponents
        });
      }
      band = getNextOccupiedBand(band, occupiedBands);
    }
    const highestComparedBand = queue.length ? Number(queue[queue.length - 1].band || 0) : Number(baseBand || 0);
    return {
      queue,
      terminalWinBand: highestComparedBand >= 10 ? 10 : Math.min(10, highestComparedBand + 1)
    };
  }

  function setDuelQueuePosition(session, queueIndex = 0, opponentIndex = 0) {
    if (!session) return false;
    const queueEntry = Array.isArray(session.comparisonQueue) ? session.comparisonQueue[queueIndex] : null;
    const opponents = Array.isArray(queueEntry?.opponents) ? queueEntry.opponents : [];
    const currentOpponent = opponents[opponentIndex] || null;
    if (!queueEntry || !currentOpponent) return false;
    session.currentQueueIndex = queueIndex;
    session.currentBand = Number(queueEntry.band || 0);
    session.currentTierKey = cleanText(queueEntry.tierKey || getTierKeyForRating(queueEntry.band)).toUpperCase();
    session.currentBandOpponents = opponents;
    session.currentOpponentIndex = opponentIndex;
    session.currentOpponent = currentOpponent;
    return true;
  }

  function makeSessionOpponentFromTierEntry(entry = {}, fallbackItem = null, mediaKey = duelMediaKey) {
    const config = getMediaConfig(mediaKey);
    const legacyTierKey = cleanText(entry.tier).toUpperCase();
    const entryRating = clampRating(entry.rating || fallbackItem?.rating || LEGACY_TIER_RATINGS[legacyTierKey] || 0);
    const entryTier = getTierKeyForRating(entryRating);
    const normalizedEntry = {
      ...entry,
      id: cleanText(entry.id || fallbackItem?.id || ''),
      title: cleanText(entry.title || getDuelTitle(fallbackItem || {}, mediaKey) || 'Untitled'),
      poster: cleanText(entry.poster || getDuelPoster(fallbackItem || {}, mediaKey) || ''),
      rating: getTierDisplayRating(entryTier, entryRating),
      tier: entryTier,
      mediaKey: config.key
    };
    const base = fallbackItem ? { ...fallbackItem } : {};
    return {
      ...base,
      id: normalizedEntry.id,
      title: normalizedEntry.title,
      cover: normalizedEntry.poster || base.cover || '',
      poster: normalizedEntry.poster || base.poster || '',
      mediaCategory: base.mediaCategory || config.sourceSection,
      librarySection: base.librarySection || config.sourceSection,
      __duelRating: normalizedEntry.rating,
      __tierOrder: Number.isFinite(entry.__tierOrder) ? entry.__tierOrder : (Number.isFinite(base.__tierOrder) ? base.__tierOrder : 9999)
    };
  }

  function removeTierEntryEverywhere(tierList, targetId = '') {
    const cleanId = cleanText(targetId);
    TIER_ROWS.forEach(tier => {
      tierList[tier.key] = (tierList[tier.key] || []).filter(entry => cleanText(entry.id || '') !== cleanId);
    });
  }

  function insertTierEntryAfter(tierList, targetEntry, anchorEntry = null) {
    if (!targetEntry?.id) return tierList;
    const tierKey = getTierKeyForRating(targetEntry.rating);
    if (!Array.isArray(tierList[tierKey])) tierList[tierKey] = [];
    removeTierEntryEverywhere(tierList, targetEntry.id);
    const row = tierList[tierKey];
    const anchorId = cleanText(anchorEntry?.id || '');
    let anchorIndex = anchorId ? row.findIndex(entry => cleanText(entry.id || '') === anchorId) : -1;
    if (anchorEntry?.id && anchorIndex < 0) {
      row.push(anchorEntry);
      anchorIndex = row.length - 1;
    }
    if (anchorIndex >= 0) {
      row.splice(anchorIndex + 1, 0, targetEntry);
    } else if (tierKey === 'S') {
      row.unshift(targetEntry);
    } else {
      row.push(targetEntry);
    }
    return tierList;
  }

  function insertTierEntryAtStart(tierList, targetEntry) {
    if (!targetEntry?.id) return tierList;
    const tierKey = getTierKeyForRating(targetEntry.rating);
    if (!Array.isArray(tierList[tierKey])) tierList[tierKey] = [];
    removeTierEntryEverywhere(tierList, targetEntry.id);
    tierList[tierKey].unshift(targetEntry);
    return tierList;
  }

  function enforceSTierCap(tierList) {
    const sRow = Array.isArray(tierList?.S) ? tierList.S : [];
    if (sRow.length <= S_TIER_CAP) return null;
    const displacedEntry = sRow.pop();
    if (!displacedEntry?.id) return null;
    const demotedEntry = {
      ...displacedEntry,
      rating: 9,
      tier: 'A',
      updatedAt: new Date().toISOString()
    };
    insertTierEntryAtStart(tierList, demotedEntry);
    return demotedEntry;
  }

  async function saveTierList(mediaKey = duelMediaKey, tierList = null) {
    const config = getMediaConfig(mediaKey);
    const normalized = normalizeSavedTierList(tierList, mediaKey);
    const payload = {
      version: 2,
      mediaType: config.key,
      updatedAt: new Date().toISOString(),
      tiers: normalized
    };
    writeCachedTierList(mediaKey, payload);
    if (!userProfile) userProfile = {};
    userProfile[config.profileKey] = payload;
    if (currentUser?.uid) {
      usersMap[currentUser.uid] = {
        ...(usersMap[currentUser.uid] || {}),
        uid: currentUser.uid,
        [config.profileKey]: payload
      };
    }

    const cacheKey = getTierListCacheKey(mediaKey);
    const persist = async () => {
      if ((typeof isPreviewMode === 'function' && isPreviewMode()) || !currentUser) return true;
      if (typeof saveProfileSettingsPatch === 'function') {
        const saved = await saveProfileSettingsPatch({ [config.profileKey]: payload });
        if (saved === false) throw new Error(`Could not sync ${config.tierTitle}.`);
        return true;
      }
      if (typeof db !== 'undefined' && db?.collection && currentUser?.uid) {
        await db.collection('users').doc(currentUser.uid).set({
          [config.profileKey]: payload,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return true;
      }
      throw new Error('No profile save path is available.');
    };

    const previousSave = movieDuelTierListSaveQueues[cacheKey] || Promise.resolve();
    const nextSave = previousSave.catch(() => {}).then(persist);
    const queuedSave = nextSave
      .catch(() => {})
      .finally(() => {
        if (movieDuelTierListSaveQueues[cacheKey] === queuedSave) delete movieDuelTierListSaveQueues[cacheKey];
      });
    movieDuelTierListSaveQueues[cacheKey] = queuedSave;
    await nextSave;
    return payload;
  }

  function sortItemsForDuel(items = []) {
    return [...items].sort((a, b) => {
      const orderA = Number.isFinite(a?.__tierOrder) ? a.__tierOrder : 9999;
      const orderB = Number.isFinite(b?.__tierOrder) ? b.__tierOrder : 9999;
      if (orderA !== orderB) return orderA - orderB;
      const titleCompare = cleanText(a?.title || a?.name || '').localeCompare(cleanText(b?.title || b?.name || ''), undefined, { sensitivity: 'base' });
      if (titleCompare !== 0) return titleCompare;
      return cleanText(String(a?.id || '')).localeCompare(cleanText(String(b?.id || '')), undefined, { sensitivity: 'base' });
    });
  }

  /* v10.80: Fisher-Yates shuffle for Rating Game opponent randomization.
     Opponents must NOT follow tier order, rating order, alphabetical order,
     added order, or current list order. We still draw from the same rating
     band (so the climbing/placement logic stays intact), but the order
     within the band is fully randomized so the player can't predict which
     opponent will come up next. */
  function shuffleArrayForDuel(items = []) {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function getOccupiedBands(itemsByBand = {}) {
    return Array.from({ length: 10 }, (_, idx) => idx + 1).filter(band => Array.isArray(itemsByBand[band]) && itemsByBand[band].length);
  }

  function getNearestOccupiedBand(occupiedBands = [], preferred = 6) {
    if (!occupiedBands.length) return 0;
    let best = occupiedBands[0];
    let bestDistance = Math.abs(best - preferred);
    occupiedBands.forEach(band => {
      const distance = Math.abs(band - preferred);
      if (distance < bestDistance || (distance === bestDistance && band > best)) {
        best = band;
        bestDistance = distance;
      }
    });
    return best;
  }

  function getFirstComparisonBand(baseBand, occupiedBands = []) {
    if (!occupiedBands.length) return 0;
    const higherOrEqual = occupiedBands.find(band => band >= baseBand);
    if (higherOrEqual) return higherOrEqual;
    return occupiedBands[occupiedBands.length - 1] || 0;
  }

  function getNextOccupiedBand(currentBand, occupiedBands = []) {
    return occupiedBands.find(band => band > currentBand) || 0;
  }

  function getOpponentsForBand(targetItem, itemsByBand = {}, band = 0, mediaKey = duelMediaKey) {
    const targetId = getTierItemId(targetItem);
    /* v10.80: Randomize opponent order. We still pull from the same rating
       band so the climbing/inference logic stays intact, but the order
       within the band is fully shuffled (Fisher-Yates) — opponents must NOT
       follow tier order, rating order, alphabetical, added, or current-list
       order. The .filter() afterwards is identity-preserving (only removes
       the target), so randomness is fully preserved. */
    const pool = (itemsByBand[band] || []).filter(item => getTierItemId(item) !== targetId);
    return shuffleArrayForDuel(pool);
  }

  function getBandState(targetItem, itemsByBand = {}, band = 0, mediaKey = duelMediaKey) {
    const opponents = getOpponentsForBand(targetItem, itemsByBand, band, mediaKey);
    return {
      band,
      opponents,
      opponentIndex: 0,
      currentOpponent: opponents[0] || null
    };
  }

  function getDuelTargetById(itemId = '', mediaKey = duelMediaKey) {
    const cleanId = cleanText(itemId);
    return getDuelItemsForSession(mediaKey).find(item => getTierItemId(item) === cleanId) || null;
  }

  function getItemsGroupedByRatingForPicker(mediaKey = duelMediaKey) {
    const grouped = new Map();
    for (let rating = 10; rating >= 1; rating -= 1) grouped.set(rating, []);
    sortItemsForDuel(getDuelItemsForSession(mediaKey)).forEach(item => {
      const rating = getDuelItemRating(item) || 0;
      const key = rating > 0 ? rating : 0;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item);
    });
    return Array.from(grouped.entries())
      .filter(([, items]) => items.length)
      .sort(([a], [b]) => b - a);
  }

  function renderMediaTabs(context = 'launcher') {
    const tabLabel = context === 'tier' ? 'Tier list category' : 'Game category';
    return `
      <div class="movie-duel-media-tabs movie-duel-media-tabs-${attr(context)}" role="tablist" aria-label="${attr(tabLabel)}">
        ${MEDIA_ORDER.map(key => {
          const config = getMediaConfig(key);
          const label = context === 'tier' ? config.plural : config.label;
          return `
            <button type="button" class="movie-duel-media-tab${key === duelMediaKey ? ' active' : ''}" role="tab" aria-selected="${key === duelMediaKey ? 'true' : 'false'}" onclick="switchMovieRatingDuelMedia('${attr(key)}','${attr(context)}')">
              ${html(label)}
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderPickerPosterButton(item = {}, mediaKey = duelMediaKey) {
    const poster = getDuelPoster(item, mediaKey);
    const title = getDuelTitle(item, mediaKey) || 'Untitled';
    const itemId = getTierItemId(item);
    return `
      <button type="button" class="movie-duel-picker-poster-btn" data-movie-duel-id="${attr(itemId)}" onclick="selectMovieRatingDuelMovie(this.dataset.movieDuelId)">
        <span class="movie-duel-picker-poster-frame">
          ${poster ? `<img src="${attr(poster)}" alt="${attr(title)}" loading="lazy" decoding="async">` : `<span class="movie-duel-picker-poster-fallback">${html(title.charAt(0).toUpperCase() || '?')}</span>`}
        </span>
      </button>
    `;
  }

  function renderMovieDuelPickerPage() {
    const overlay = document.getElementById('movie-rating-duel-overlay');
    if (!overlay) return;
    const config = getMediaConfig(duelMediaKey);
    overlay.classList.remove('has-tier-result');
    overlay.classList.add('has-movie-picker');
    overlay.classList.remove('has-active-round');
    const groups = getItemsGroupedByRatingForPicker(duelMediaKey);
    overlay.querySelector('.movie-duel-sheet').innerHTML = `
      <div class="movie-duel-header movie-duel-picker-header">
        <div>
          <div class="movie-duel-kicker">Choose a ${html(config.lower)}</div>
          <h2>Choose a ${html(config.lower)}</h2>
        </div>
        <button type="button" class="movie-duel-close" onclick="openMovieRatingDuelLauncher(false)" aria-label="Back">&#8592;</button>
      </div>
      <div class="movie-duel-picker-page">
        ${groups.length ? groups.map(([rating, items]) => `
          <section class="movie-duel-picker-rating-section">
            <div class="movie-duel-picker-rating-rule">
              <span>${html(rating ? `${rating}/10` : 'Unrated')}</span>
            </div>
            <div class="movie-duel-picker-grid">
              ${items.map(item => renderPickerPosterButton(item, duelMediaKey)).join('')}
            </div>
          </section>
        `).join('') : `<div class="movie-duel-empty-state">No ${html(config.emptyLabel)} available yet.</div>`}
      </div>
    `;
  }

  function buildDuelSession(itemId = '', mediaKey = duelMediaKey) {
    const config = getMediaConfig(mediaKey);
    const targetItem = getDuelTargetById(itemId, mediaKey);
    if (!targetItem) {
      throw new Error(`Choose a ${config.lower} first.`);
    }
    const items = getDuelItemsForSession(mediaKey);
    const targetId = getTierItemId(targetItem);
    const ratedOpponents = items.filter(item => getTierItemId(item) !== targetId && getDuelItemRating(item) > 0);
    if (ratedOpponents.length < 1) {
      throw new Error(`You need at least one other rated ${config.emptyLabel} to play this game.`);
    }

    const itemsByBand = {};
    for (let band = 1; band <= 10; band += 1) itemsByBand[band] = [];
    ratedOpponents.forEach(item => {
      itemsByBand[getDuelItemRating(item)].push(item);
    });

    const occupiedBands = getOccupiedBands(itemsByBand);
    const savedRating = getDuelItemRating(targetItem);
    const baseBand = savedRating || getNearestOccupiedBand(occupiedBands, 6) || 6;
    const comparisonPlan = buildDuelComparisonQueue(itemsByBand, occupiedBands, baseBand, targetItem, mediaKey);
    if (!comparisonPlan.queue.length) {
      throw new Error(`Not enough rated ${config.emptyLabel} to build matchup rounds right now.`);
    }
    const session = {
      mediaKey,
      targetItem,
      itemsByBand,
      occupiedBands,
      baseBand,
      comparisonQueue: comparisonPlan.queue,
      currentQueueIndex: 0,
      currentTierKey: '',
      currentBand: 0,
      currentBandOpponents: [],
      currentOpponentIndex: 0,
      currentOpponent: null,
      terminalWinBand: comparisonPlan.terminalWinBand,
      savedRating,
      rounds: [],
      finalTierList: null
    };
    if (!setDuelQueuePosition(session, 0, 0)) {
      throw new Error(`Not enough rated ${config.emptyLabel} to build matchup rounds right now.`);
    }
    return session;
  }

  function buildTierListClickDuelSession(itemId = '', mediaKey = duelMediaKey) {
    const config = getMediaConfig(mediaKey);
    const cleanId = cleanText(itemId);
    const tierList = normalizeSavedTierList(getSavedTierList(mediaKey), mediaKey);
    const libraryItems = getDuelItemsForSession(mediaKey);
    const libraryMap = new Map(libraryItems.map(item => [getTierItemId(item), item]));
    let targetEntry = null;
    let targetTierIndex = -1;

    TIER_ROWS.forEach((tier, tierIndex) => {
      if (targetEntry) return;
      const row = tierList[tier.key] || [];
      const entryIndex = row.findIndex(entry => cleanText(entry.id || '') === cleanId);
      if (entryIndex >= 0) {
        targetEntry = { ...row[entryIndex], __tierOrder: entryIndex, tier: tier.key };
        targetTierIndex = tierIndex;
      }
    });

    if (!targetEntry || targetTierIndex < 0) {
      throw new Error(`Could not find that ${config.lower} in this tier list.`);
    }

    const targetFallbackItem = libraryMap.get(cleanId) || null;
    const targetItem = makeSessionOpponentFromTierEntry(targetEntry, targetFallbackItem, mediaKey);
    const comparisonQueue = [];

    for (let tierIndex = targetTierIndex; tierIndex >= 0; tierIndex -= 1) {
      const tier = TIER_ROWS[tierIndex];
      const row = Array.isArray(tierList[tier.key]) ? tierList[tier.key] : [];
      /* v10.80: Randomize opponent order within the tier. We previously
         used .reverse() (newest-first), which is a predictable order.
         Shuffle so opponents in the same tier appear in random order each
         run — opponents must NOT follow tier order, rating order,
         alphabetical, added, or current-list order. */
      const opponents = shuffleArrayForDuel(
        row
          .map((entry, entryIndex) => ({ ...entry, __tierOrder: entryIndex, tier: tier.key }))
          .filter(entry => cleanText(entry.id || '') !== cleanId)
      )
        .map(entry => makeSessionOpponentFromTierEntry(entry, libraryMap.get(cleanText(entry.id || '')) || null, mediaKey));
      if (!opponents.length) continue;
      comparisonQueue.push({
        band: getTierDisplayRating(tier.key, targetEntry.rating || tier.rating),
        tierKey: tier.key,
        opponents
      });
    }

    if (!comparisonQueue.length) {
      throw new Error(`You need at least one other ranked ${config.lower} in this tier list to play from here.`);
    }

    const highestComparedTier = getTierRowByKey(comparisonQueue[comparisonQueue.length - 1].tierKey);
    const highestComparedBand = getTierDisplayRating(highestComparedTier?.key || '', highestComparedTier?.rating || 0);
    const session = {
      mediaKey,
      targetItem,
      itemsByBand: null,
      occupiedBands: [],
      baseBand: getTierDisplayRating(targetEntry.tier, targetEntry.rating || 0),
      comparisonQueue,
      currentQueueIndex: 0,
      currentTierKey: '',
      currentBand: 0,
      currentBandOpponents: [],
      currentOpponentIndex: 0,
      currentOpponent: null,
      terminalWinBand: highestComparedBand >= 10 ? 10 : Math.min(10, highestComparedBand + 1),
      savedRating: clampRating(targetEntry.rating || targetItem.__duelRating || 0),
      rounds: [],
      finalTierList: null
    };
    if (!setDuelQueuePosition(session, 0, 0)) {
      throw new Error(`You need at least one other ranked ${config.lower} in this tier list to play from here.`);
    }
    return session;
  }

  function lockMovieDuelScroll() {
    if (document.body.classList.contains('movie-rating-duel-open')) return;
    duelScrollY = window.scrollY || window.pageYOffset || 0;
    document.documentElement.classList.add('movie-rating-duel-open');
    document.body.classList.add('movie-rating-duel-open');
    document.body.style.position = 'fixed';
    document.body.style.top = `-${duelScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
  }

  function unlockMovieDuelScroll() {
    if (!document.body.classList.contains('movie-rating-duel-open')) return;
    const y = duelScrollY || Math.abs(parseInt(document.body.style.top || '0', 10)) || 0;
    document.documentElement.classList.remove('movie-rating-duel-open');
    document.body.classList.remove('movie-rating-duel-open');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    document.body.style.overflow = '';
    window.scrollTo(0, y);
    duelScrollY = 0;
  }

  function getLauncherBodyHtml(message = '') {
    const config = getMediaConfig(duelMediaKey);
    const selectedId = cleanText(duelSelectedItemIds[duelMediaKey] || '');
    const selectedItem = getDuelTargetById(selectedId, duelMediaKey);
    const selectedPoster = selectedItem ? getDuelPoster(selectedItem, duelMediaKey) : '';
    return `
      <div class="movie-duel-header">
        <div>
          <div class="movie-duel-kicker">Private Game</div>
          <h2>Tier List Game</h2>
          <p>Choose a category, pick one title, then test how high it climbs. Results save only to that category tier list.</p>
        </div>
        <button type="button" class="movie-duel-close" onclick="closeMovieRatingDuel()" aria-label="Close">&times;</button>
      </div>
      <div class="movie-duel-launcher">
        ${renderMediaTabs('launcher')}
        <input id="movie-duel-select" type="hidden" value="${attr(selectedId)}">
        <button type="button" class="movie-duel-picker-open-btn" onclick="openMovieRatingDuelPicker()">
          ${selectedItem ? `
            <span class="movie-duel-picker-selected-poster">
              ${selectedPoster ? `<img src="${attr(selectedPoster)}" alt="${attr(getDuelTitle(selectedItem, duelMediaKey))}" loading="eager" decoding="async">` : `<span>${html((getDuelTitle(selectedItem, duelMediaKey) || '?').charAt(0).toUpperCase())}</span>`}
            </span>
            <span class="movie-duel-picker-selected-copy">
              <strong>${html(getDuelTitle(selectedItem, duelMediaKey) || 'Untitled')}</strong>
              <em>${html(getDuelItemRating(selectedItem) ? `${getDuelItemRating(selectedItem)}/10` : 'Unrated')}</em>
            </span>
          ` : `<span class="movie-duel-picker-open-placeholder">Choose a ${html(config.lower)}</span>`}
        </button>
        <div id="movie-duel-status" class="movie-duel-status${message ? ' is-visible' : ''}">${html(message)}</div>
        <div class="movie-duel-actions">
          <button type="button" class="movie-duel-secondary" onclick="closeMovieRatingDuel()">Cancel</button>
          <button type="button" class="movie-duel-primary" onclick="startMovieRatingDuel()">Start Game</button>
        </div>
        <button type="button" class="movie-duel-tier-direct-btn" onclick="openMovieRatingDuelTierListPage()">Go to tier list</button>
      </div>
    `;
  }

  function renderOptionCard(item = {}, role = 'target') {
    const mediaKey = duelState?.mediaKey || duelMediaKey;
    const poster = getDuelPoster(item, mediaKey);
    const title = getDuelTitle(item, mediaKey) || 'Untitled';
    return `
      <button type="button" class="movie-duel-option movie-duel-option-${attr(role)}" onclick="chooseMovieRatingDuelWinner('${attr(role)}')" aria-label="${attr(`Choose ${title}`)}" title="${attr(title)}">
        <span class="movie-duel-option-poster-wrap">
          ${poster ? `<img class="movie-duel-option-poster" src="${attr(poster)}" alt="${attr(title)}" loading="eager" decoding="async">` : `<span class="movie-duel-option-poster movie-duel-option-poster-fallback">${html(title.charAt(0).toUpperCase() || '?')}</span>`}
        </span>
      </button>
    `;
  }

  function buildDuelOptionElement(item = {}, role = 'target') {
    const template = document.createElement('template');
    template.innerHTML = renderOptionCard(item, role).trim();
    return template.content.firstElementChild;
  }

  function setDuelStageDisabled(disabled = false) {
    const stage = document.getElementById('movie-duel-versus');
    if (!stage) return;
    stage.querySelectorAll('.movie-duel-option').forEach(button => {
      button.disabled = !!disabled;
    });
  }

  function updateDuelRoundHeader(roundCount = 1, label = 'Movie') {
    const kicker = document.getElementById('movie-duel-round-kicker');
    if (kicker) kicker.textContent = `Round ${roundCount} - ${label}`;
  }

  function syncDuelTargetCard() {
    const targetSlot = document.querySelector('#movie-duel-versus .movie-duel-slot-target');
    if (!targetSlot || !duelState?.targetItem) return;
    const currentId = cleanText(targetSlot.firstElementChild?.dataset?.entryId || '');
    const nextId = getTierItemId(duelState.targetItem);
    if (currentId === nextId) return;
    const targetEl = buildDuelOptionElement(duelState.targetItem, 'target');
    targetEl.dataset.entryId = nextId;
    targetSlot.replaceChildren(targetEl);
  }

  function swapDuelOpponentCard() {
    const overlay = document.getElementById('movie-rating-duel-overlay');
    const opponentSlot = document.querySelector('#movie-duel-versus .movie-duel-slot-opponent');
    if (!overlay || !opponentSlot || !duelState?.currentOpponent) return;
    const incomingId = getTierItemId(duelState.currentOpponent);
    const currentEl = opponentSlot.querySelector('.movie-duel-option-opponent');
    if (!currentEl) {
      const freshEl = buildDuelOptionElement(duelState.currentOpponent, 'opponent');
      freshEl.dataset.entryId = incomingId;
      opponentSlot.replaceChildren(freshEl);
      return;
    }
    if (cleanText(currentEl.dataset.entryId || '') === incomingId) return;
    window.clearTimeout(duelSwapTimer);
    const incomingEl = buildDuelOptionElement(duelState.currentOpponent, 'opponent');
    incomingEl.dataset.entryId = incomingId;
    incomingEl.classList.add('is-entering');
    currentEl.classList.add('is-leaving');
    overlay.classList.add('is-animating-duel');
    duelState.isAnimating = true;
    setDuelStageDisabled(true);
    opponentSlot.appendChild(incomingEl);
    requestAnimationFrame(() => {
      incomingEl.classList.add('is-entering-active');
    });
    duelSwapTimer = window.setTimeout(() => {
      currentEl.remove();
      incomingEl.classList.remove('is-entering', 'is-entering-active');
      overlay.classList.remove('is-animating-duel');
      duelState.isAnimating = false;
      setDuelStageDisabled(false);
    }, DUEL_SWAP_MS);
  }

  function renderDuelRound(animateOpponent = false) {
    const overlay = document.getElementById('movie-rating-duel-overlay');
    if (!overlay || !duelState?.targetItem || !duelState?.currentOpponent) return;
    const config = getMediaConfig(duelState.mediaKey);
    overlay.classList.remove('has-tier-list-page');
    overlay.classList.remove('has-tier-result');
    overlay.classList.remove('has-movie-picker');
    overlay.classList.add('has-active-round');
    const roundCount = duelState.rounds.length + 1;
    const sheet = overlay.querySelector('.movie-duel-sheet');
    const stage = sheet?.querySelector('#movie-duel-versus');
    if (!stage || !animateOpponent) {
      window.clearTimeout(duelSwapTimer);
      sheet.innerHTML = `
        <div class="movie-duel-header">
          <div>
            <div id="movie-duel-round-kicker" class="movie-duel-kicker">Round ${html(roundCount)} - ${html(config.label)}</div>
            <h2>One stays forever, one gets removed from existance, Which one will you chose?</h2>
          </div>
          <button type="button" class="movie-duel-close" onclick="closeMovieRatingDuel()" aria-label="Close">&times;</button>
        </div>
        <div id="movie-duel-versus" class="movie-duel-versus">
          <div class="movie-duel-slot movie-duel-slot-target"></div>
          <div class="movie-duel-slot movie-duel-slot-opponent"></div>
        </div>
        <div class="movie-duel-footnote">
          Pick the title you would place higher in your personal ranking.
        </div>
      `;
      syncDuelTargetCard();
      const opponentSlot = sheet.querySelector('.movie-duel-slot-opponent');
      if (opponentSlot) {
        const opponentEl = buildDuelOptionElement(duelState.currentOpponent, 'opponent');
        opponentEl.dataset.entryId = getTierItemId(duelState.currentOpponent);
        opponentSlot.replaceChildren(opponentEl);
      }
      return;
    }
    updateDuelRoundHeader(roundCount, config.label);
    syncDuelTargetCard();
    swapDuelOpponentCard();
  }

  function renderTierPoster(entry = {}) {
    const poster = cleanText(entry.poster || '');
    const title = cleanText(entry.title || 'Untitled');
    const entryId = cleanText(entry.id || '');
    const clickable = !!entryId && !isMovieDuelReadOnly();
    return `
      <button type="button" class="movie-duel-tier-poster${clickable ? ' is-clickable' : ''}" data-movie-duel-tier-poster data-movie-duel-tier-entry-id="${attr(entryId)}" title="${attr(title)}" ${clickable ? `onclick="startMovieRatingDuelFromTierList('${attr(entryId)}')"` : 'disabled'} aria-label="${attr(`Play tier list game for ${title}`)}">
        ${poster ? `<img src="${attr(poster)}" alt="${attr(title)}" loading="lazy" decoding="async" fetchpriority="low">` : `<span>${html(title.charAt(0).toUpperCase() || '?')}</span>`}
      </button>
    `;
  }

  function getTierVisibleCount(tierKey = '', total = 0) {
    if (!total) return 0;
    const stored = Number(movieDuelTierVisibleCounts[tierKey] || 0);
    const count = stored > 0 ? stored : TIER_ROW_INITIAL_LIMIT;
    return Math.min(total, Math.max(TIER_ROW_INITIAL_LIMIT, count));
  }

  function renderMovieDuelTierList(tierList = null, activeId = '', options = {}) {
    const mediaKey = options.mediaKey || duelMediaKey;
    const normalized = normalizeSavedTierList(tierList, mediaKey);
    const cleanActiveId = cleanText(activeId);
    if (!options.preserveVisibleCounts) movieDuelTierVisibleCounts = {};
    movieDuelVisibleTierList = normalized;
    movieDuelVisibleTierActiveId = cleanActiveId;
    movieDuelVisibleTierMediaKey = mediaKey;
    /* v10.493: stamp the mediaKey on the board so per-media-kind CSS
       (music = 1:1 + 1px corners; games = 5:6.38; rest = 2:3) can
       target without the renderer caring about poster geometry. */
    return `
      <div class="movie-duel-tier-board movie-duel-tier-board--${attr(mediaKey)}" data-movie-duel-media-key="${attr(mediaKey)}">
        ${TIER_ROWS.map(tier => {
          const entries = normalized[tier.key] || [];
          const activeIndex = entries.findIndex(entry => cleanText(entry.id) === cleanActiveId);
          const visibleCount = getTierVisibleCount(tier.key, entries.length);
          const firstEntries = entries.slice(0, visibleCount);
          const activeEntry = activeIndex >= visibleCount ? entries[activeIndex] : null;
          const visibleEntries = activeEntry ? [...firstEntries, activeEntry] : firstEntries;
          const hasMore = visibleCount < entries.length;
          return `
            <section class="movie-duel-tier-row movie-duel-tier-${attr(tier.key.toLowerCase())}" data-movie-duel-tier-key="${attr(tier.key)}">
              <div class="movie-duel-tier-label">
                <strong>${html(tier.key)}</strong>
                <span>${tier.meta}</span>
              </div>
              <div class="movie-duel-tier-scroll-wrap" data-movie-duel-tier-row="${attr(tier.key)}">
                <div class="movie-duel-tier-scroll" data-movie-duel-tier-scroll="${attr(tier.key)}" aria-label="${attr(tier.label)}">
                ${visibleEntries.length ? visibleEntries.map(entry => `
                  <div class="movie-duel-tier-item${cleanText(entry.id) === cleanActiveId ? ' is-new' : ''}" data-movie-duel-tier-item="${attr(cleanText(entry.id || ''))}" data-movie-duel-tier-key="${attr(tier.key)}">
                    ${renderTierPoster(entry)}
                  </div>
                `).join('') : `<div class="movie-duel-tier-empty">No titles yet</div>`}
                ${hasMore ? `<button type="button" class="movie-duel-tier-load-more" onclick="loadMoreMovieRatingDuelTier('${attr(tier.key)}')">Load More</button>` : ''}
                </div>
              </div>
            </section>
          `;
        }).join('')}
      </div>
    `;
  }

  function loadMoreMovieRatingDuelTier(tierKey = '') {
    const key = cleanText(tierKey).toUpperCase();
    const normalized = normalizeSavedTierList(movieDuelVisibleTierList, movieDuelVisibleTierMediaKey);
    const total = normalized[key]?.length || 0;
    if (!total) return;
    const current = Number(movieDuelTierVisibleCounts[key] || TIER_ROW_INITIAL_LIMIT);
    movieDuelTierVisibleCounts[key] = Math.min(total, Math.max(TIER_ROW_INITIAL_LIMIT, current) + TIER_ROW_LOAD_STEP);
    const board = document.querySelector('#movie-rating-duel-overlay .movie-duel-tier-board');
    if (!board) return;
    board.outerHTML = renderMovieDuelTierList(normalized, movieDuelVisibleTierActiveId, { mediaKey: movieDuelVisibleTierMediaKey, preserveVisibleCounts: true });
  }

  function getMovieDuelTierScrollFromPoint(clientX = 0, clientY = 0) {
    const direct = document.elementFromPoint(clientX, clientY)?.closest?.('[data-movie-duel-tier-scroll]');
    if (direct) return direct;
    const rows = Array.from(document.querySelectorAll('#movie-rating-duel-overlay [data-movie-duel-tier-scroll]'));
    if (!rows.length) return null;
    let best = null;
    let bestDistance = Infinity;
    rows.forEach(row => {
      const rect = row.getBoundingClientRect();
      const yDistance = clientY < rect.top ? rect.top - clientY : (clientY > rect.bottom ? clientY - rect.bottom : 0);
      const xDistance = clientX < rect.left ? rect.left - clientX : (clientX > rect.right ? clientX - rect.right : 0);
      const distance = yDistance * 2 + xDistance;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = row;
      }
    });
    return best;
  }

  function placeMovieDuelTierDragPlaceholder(scrollEl, clientX = 0) {
    if (!movieDuelTierDragState?.placeholder || !scrollEl) return;
    const placeholder = movieDuelTierDragState.placeholder;
    const empty = scrollEl.querySelector('.movie-duel-tier-empty');
    const items = Array.from(scrollEl.querySelectorAll('.movie-duel-tier-item'))
      .filter(item => item !== placeholder && !item.classList.contains('is-drag-source'));
    let beforeNode = null;
    for (const item of items) {
      const rect = item.getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) {
        beforeNode = item;
        break;
      }
    }
    if (empty) empty.classList.add('is-hidden-by-drag');
    if (beforeNode) scrollEl.insertBefore(placeholder, beforeNode);
    else {
      const loadMore = scrollEl.querySelector('.movie-duel-tier-load-more');
      scrollEl.insertBefore(placeholder, loadMore || empty || null);
    }
    movieDuelTierDragState.targetTierKey = cleanText(scrollEl.dataset.movieDuelTierScroll || '').toUpperCase();
  }

  function autoScrollMovieDuelTierRow(scrollEl, clientX = 0) {
    if (!scrollEl) return;
    const rect = scrollEl.getBoundingClientRect();
    const edge = 46;
    let delta = 0;
    if (clientX < rect.left + edge) delta = -12;
    else if (clientX > rect.right - edge) delta = 12;
    if (delta) scrollEl.scrollLeft += delta;
  }

  function setMovieDuelTierGhostPosition(clientX = 0, clientY = 0) {
    const state = movieDuelTierDragState;
    if (!state?.ghost) return;
    state.lastX = clientX;
    state.lastY = clientY;
    if (state.raf) return;
    state.raf = requestAnimationFrame(() => {
      state.raf = 0;
      const x = state.lastX - state.offsetX;
      const y = state.lastY - state.offsetY;
      state.ghost.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1.045)`;
    });
  }

  function startMovieDuelTierLongPressDrag(event) {
    const state = movieDuelTierDragState;
    if (!state || state.dragging || isMovieDuelReadOnly()) return;
    const itemEl = state.itemEl;
    const posterEl = state.posterEl;
    const rect = itemEl.getBoundingClientRect();
    state.dragging = true;
    state.offsetX = state.startX - rect.left;
    state.offsetY = state.startY - rect.top;
    movieDuelTierDragSuppressClickUntil = Date.now() + 900;
    const placeholder = document.createElement('div');
    placeholder.className = 'movie-duel-tier-item movie-duel-tier-drag-placeholder';
    placeholder.dataset.movieDuelTierItem = state.entryId;
    placeholder.dataset.movieDuelTierKey = state.tierKey;
    placeholder.style.width = `${rect.width}px`;
    placeholder.style.height = `${rect.height}px`;
    itemEl.parentNode.insertBefore(placeholder, itemEl.nextSibling);
    const ghost = itemEl.cloneNode(true);
    ghost.classList.remove('is-new');
    ghost.classList.add('movie-duel-tier-drag-ghost');
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0) scale(1.045)`;
    document.body.appendChild(ghost);
    itemEl.classList.add('is-drag-source');
    posterEl.classList.add('is-dragging-source');
    document.body.classList.add('movie-duel-tier-dragging');
    const scrollEl = itemEl.closest('[data-movie-duel-tier-scroll]');
    if (scrollEl) placeMovieDuelTierDragPlaceholder(scrollEl, state.startX);
    state.placeholder = placeholder;
    state.ghost = ghost;
    setMovieDuelTierGhostPosition(state.startX, state.startY);
    /* v10.493: Capture the pointer to OUR handler so pointermove keeps
       firing even if the finger drifts off the original poster (e.g.
       onto another row, onto the body, off the edge). Without capture
       iOS can hand the gesture back to native scroll mid-drag,
       causing the "scrolling vs dragging fight" the user described.
       The capture is released on pointerup / pointercancel. */
    try {
      if (state.pointerId !== undefined && posterEl.setPointerCapture) {
        posterEl.setPointerCapture(state.pointerId);
        state.capturedOn = posterEl;
      }
    } catch (_) {}
    if (navigator.vibrate) {
      try { navigator.vibrate(8); } catch (_) {}
    }
    event?.preventDefault?.();
  }

  function cancelMovieDuelTierDrag() {
    const state = movieDuelTierDragState;
    if (!state) return;
    window.clearTimeout(state.timer);
    if (state.raf) cancelAnimationFrame(state.raf);
    state.itemEl?.classList.remove('is-drag-source');
    state.posterEl?.classList.remove('is-dragging-source');
    state.placeholder?.remove();
    state.ghost?.remove();
    document.querySelectorAll('.movie-duel-tier-empty.is-hidden-by-drag').forEach(node => node.classList.remove('is-hidden-by-drag'));
    document.body.classList.remove('movie-duel-tier-dragging');
    /* v10.493: release the pointer capture set in startMovieDuelTierLongPressDrag. */
    try {
      if (state.capturedOn && state.pointerId !== undefined && state.capturedOn.releasePointerCapture) {
        state.capturedOn.releasePointerCapture(state.pointerId);
      }
    } catch (_) {}
    movieDuelTierDragState = null;
  }

  function getMovieDuelTierPlaceholderIndex(targetTierKey = '', rowOverride = null) {
    const state = movieDuelTierDragState;
    const placeholder = state?.placeholder;
    if (!placeholder || !targetTierKey) return 0;
    const scrollEl = placeholder.closest('[data-movie-duel-tier-scroll]');
    if (!scrollEl) return 0;
    const before = [];
    Array.from(scrollEl.children).some(child => {
      if (child === placeholder) return true;
      if (child.classList?.contains('movie-duel-tier-item') && !child.classList.contains('is-drag-source')) {
        const id = cleanText(child.dataset.movieDuelTierItem || '');
        if (id) before.push(id);
      }
      return false;
    });
    const row = Array.isArray(rowOverride)
      ? rowOverride
      : (Array.isArray(movieDuelVisibleTierList?.[targetTierKey]) ? movieDuelVisibleTierList[targetTierKey] : []);
    if (!before.length) return 0;
    const lastId = before[before.length - 1];
    const index = row.findIndex(entry => cleanText(entry?.id || '') === lastId);
    return index >= 0 ? index + 1 : before.length;
  }

  function commitMovieDuelTierDrop() {
    const state = movieDuelTierDragState;
    if (!state?.dragging) {
      cancelMovieDuelTierDrag();
      return;
    }
    const mediaKey = movieDuelVisibleTierMediaKey || duelMediaKey;
    const targetTierKey = cleanText(state.targetTierKey || state.tierKey).toUpperCase();
    const sourceTierKey = cleanText(state.tierKey || '').toUpperCase();
    const entryId = cleanText(state.entryId || '');
    const tierList = normalizeSavedTierList(movieDuelVisibleTierList, mediaKey);
    let movedEntry = null;
    TIER_ROWS.forEach(tier => {
      const row = Array.isArray(tierList[tier.key]) ? tierList[tier.key] : [];
      const index = row.findIndex(entry => cleanText(entry?.id || '') === entryId);
      if (index >= 0) {
        movedEntry = row.splice(index, 1)[0];
      }
    });
    if (!movedEntry || !targetTierKey || !tierList[targetTierKey]) {
      cancelMovieDuelTierDrag();
      return;
    }
    const targetIndex = Math.max(0, Math.min(getMovieDuelTierPlaceholderIndex(targetTierKey, tierList[targetTierKey]), tierList[targetTierKey].length));
    movedEntry = {
      ...movedEntry,
      tier: targetTierKey,
      rating: getTierDisplayRating(targetTierKey, movedEntry.rating),
      updatedAt: new Date().toISOString()
    };
    tierList[targetTierKey].splice(targetIndex, 0, movedEntry);
    movieDuelVisibleTierList = normalizeSavedTierList(tierList, mediaKey);
    movieDuelTierVisibleCounts[targetTierKey] = Math.max(Number(movieDuelTierVisibleCounts[targetTierKey] || TIER_ROW_INITIAL_LIMIT), targetIndex + 1);
    if (sourceTierKey) {
      movieDuelTierVisibleCounts[sourceTierKey] = Math.max(Number(movieDuelTierVisibleCounts[sourceTierKey] || TIER_ROW_INITIAL_LIMIT), TIER_ROW_INITIAL_LIMIT);
    }
    cancelMovieDuelTierDrag();
    const board = document.querySelector('#movie-rating-duel-overlay .movie-duel-tier-board');
    if (board) {
      board.outerHTML = renderMovieDuelTierList(movieDuelVisibleTierList, entryId, { mediaKey, preserveVisibleCounts: true });
    }
    saveTierList(mediaKey, movieDuelVisibleTierList).catch(error => {
      console.warn('Tier list reorder save failed:', error);
      if (typeof showToast === 'function') showToast('Could not save tier order');
    });
  }

  function onMovieDuelTierPointerDown(event) {
    if (movieDuelTierDragState || isMovieDuelReadOnly()) return;
    if (event.button !== undefined && event.button !== 0) return;
    const posterEl = event.target?.closest?.('[data-movie-duel-tier-poster]');
    const itemEl = posterEl?.closest?.('.movie-duel-tier-item');
    const scrollEl = itemEl?.closest?.('[data-movie-duel-tier-scroll]');
    const overlay = posterEl?.closest?.('#movie-rating-duel-overlay.has-tier-list-page');
    if (!posterEl || !itemEl || !scrollEl || !overlay) return;
    const entryId = cleanText(itemEl.dataset.movieDuelTierItem || posterEl.dataset.movieDuelTierEntryId || '');
    const tierKey = cleanText(itemEl.dataset.movieDuelTierKey || scrollEl.dataset.movieDuelTierScroll || '').toUpperCase();
    if (!entryId || !tierKey) return;
    movieDuelTierDragState = {
      pointerId: event.pointerId,
      posterEl,
      itemEl,
      entryId,
      tierKey,
      targetTierKey: tierKey,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      dragging: false,
      timer: window.setTimeout(() => startMovieDuelTierLongPressDrag(event), TIER_LONG_PRESS_MS)
    };
  }

  function onMovieDuelTierPointerMove(event) {
    const state = movieDuelTierDragState;
    if (!state || (state.pointerId !== undefined && event.pointerId !== state.pointerId)) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.dragging) {
      if (Math.hypot(dx, dy) > TIER_LONG_PRESS_MOVE_TOLERANCE) cancelMovieDuelTierDrag();
      return;
    }
    event.preventDefault();
    const scrollEl = getMovieDuelTierScrollFromPoint(event.clientX, event.clientY);
    if (scrollEl) {
      placeMovieDuelTierDragPlaceholder(scrollEl, event.clientX);
      autoScrollMovieDuelTierRow(scrollEl, event.clientX);
    }
    setMovieDuelTierGhostPosition(event.clientX, event.clientY);
  }

  function onMovieDuelTierPointerUp(event) {
    const state = movieDuelTierDragState;
    if (!state || (state.pointerId !== undefined && event.pointerId !== state.pointerId)) return;
    window.clearTimeout(state.timer);
    if (state.dragging) {
      event.preventDefault();
      commitMovieDuelTierDrop();
      return;
    }
    movieDuelTierDragState = null;
  }

  function onMovieDuelTierClickCapture(event) {
    if (Date.now() > movieDuelTierDragSuppressClickUntil) return;
    if (!event.target?.closest?.('[data-movie-duel-tier-poster]')) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  function onMovieDuelTierContextMenu(event) {
    if (!event.target?.closest?.('[data-movie-duel-tier-poster]')) return;
    if (movieDuelTierDragState?.dragging || movieDuelTierDragState) {
      event.preventDefault();
    }
  }

  document.addEventListener('pointerdown', onMovieDuelTierPointerDown, true);
  document.addEventListener('pointermove', onMovieDuelTierPointerMove, { capture: true, passive: false });
  document.addEventListener('pointerup', onMovieDuelTierPointerUp, true);
  document.addEventListener('pointercancel', cancelMovieDuelTierDrag, true);
  document.addEventListener('click', onMovieDuelTierClickCapture, true);
  document.addEventListener('contextmenu', onMovieDuelTierContextMenu, true);

  function getMovieDuelRecapCopy(listRating = 0, tierRating = 0) {
    const listScore = getTierStarRating(listRating || 0);
    const tierScore = getTierStarRating(tierRating || 0);
    if (listScore === tierScore) {
      return `
        <div class="movie-duel-recap-line movie-duel-recap-line-align">
          Wow your heart and mind were aligned,
        </div>
        <div class="movie-duel-recap-line movie-duel-recap-line-align">
          you gave it a ${html(listScore)}/5 in your list and a ${html(tierScore)}/5 here!
        </div>
      `;
    }
    return `
      <div class="movie-duel-recap-line">
        You rated this a ${html(listScore)}/5 in your lists..
      </div>
      <div class="movie-duel-recap-line movie-duel-recap-line-heart">
        But your heart gave it a ${html(tierScore)}/5 here <span aria-hidden="true">&#10084;</span>
      </div>
    `;
  }

  function returnToMovieRatingDuelTierList() {
    renderTierListPage();
    requestAnimationFrame(() => ensureMovieDuelOverlay().classList.add('is-open'));
  }

  function renderResult(resultBand, defeatedBand, tierList = null, resultMeta = null) {
    const overlay = document.getElementById('movie-rating-duel-overlay');
    if (!overlay || !duelState?.targetItem) return;
    const mediaKey = duelState.mediaKey || duelMediaKey;
    const config = getMediaConfig(mediaKey);
    overlay.classList.remove('has-tier-list-page');
    overlay.classList.add('has-tier-result');
    overlay.classList.remove('has-active-round');
    const title = getDuelTitle(duelState.targetItem, mediaKey) || 'This title';
    const poster = getDuelPoster(duelState.targetItem, mediaKey);
    const listRating = clampRating(duelState.savedRating || duelState.targetItem?.rating || 0);
    const tierRating = clampRating(resultBand || 0);
    const resultStarRating = getTierStarRating(resultBand || 0);
    let summary = 'It cleared every matchup in this run.';
    if (resultMeta?.type === 'promotion-blocked') {
      summary = `It cleared the ${getTierKeyForRating(resultMeta.retainedBand)} tier but could not break into the ${getTierKeyForRating(resultMeta.blockedBand)} tier, so it now leads ${getTierKeyForRating(resultMeta.retainedBand)}.`;
    } else if (defeatedBand) {
      summary = `It landed in the ${getTierKeyForRating(resultBand)} tier, directly behind the ${getTierStarRating(defeatedBand)}/5 title that stopped it.`;
    }

    /* v10.80: When the suggested tier differs from the saved Tier List
       placement (or the title isn't on the saved list yet), render a
       confirmation prompt instead of an auto-saved "Finish". The
       suggested placement does NOT touch the saved Tier List until
       the user taps "Update Tier List". */
    const requiresUserConfirmation = !!resultMeta?.requiresUserConfirmation;
    const hadPreviousEntry = !!resultMeta?.hadPreviousEntry;
    const previousTierKey = cleanText(resultMeta?.previousTier || '').toUpperCase();
    const newTierKey = cleanText(resultMeta?.newTier || getTierKeyForRating(resultBand)).toUpperCase();
    const noteCopy = requiresUserConfirmation
      ? `Not saved to your ${html(config.tierTitle.toLowerCase())} yet. Choose below. Nothing changed in My Lists.`
      : `Saved to your separate ${html(config.tierTitle.toLowerCase())}. Nothing changed in My Lists.`;
    const promptCopy = hadPreviousEntry
      ? `This title is currently in the ${html(previousTierKey)} tier on your saved ${html(config.tierTitle.toLowerCase())}. The Rating Game suggests moving it to the ${html(newTierKey)} tier.`
      : `This title isn't on your saved ${html(config.tierTitle.toLowerCase())} yet. The Rating Game suggests placing it in the ${html(newTierKey)} tier.`;
    const actionsHtml = requiresUserConfirmation
      ? `
        <div class="movie-duel-confirm-prompt">
          <div class="movie-duel-confirm-title">Do you want to update this title's ranking on your Tier List?</div>
          <div class="movie-duel-confirm-copy">${promptCopy}</div>
        </div>
        <div class="movie-duel-actions movie-duel-actions-result movie-duel-actions-confirm">
          <button type="button" class="movie-duel-primary" onclick="confirmMovieRatingDuelTierUpdate()">Update Tier List</button>
          <button type="button" class="movie-duel-secondary" onclick="keepMovieRatingDuelCurrentRanking()">Keep Current Ranking</button>
        </div>
      `
      : `
        <div class="movie-duel-actions movie-duel-actions-result">
          <button type="button" class="movie-duel-primary" onclick="returnToMovieRatingDuelTierList()">Finish</button>
        </div>
      `;

    overlay.querySelector('.movie-duel-sheet').innerHTML = `
      <div class="movie-duel-header">
        <div>
          <div class="movie-duel-kicker">Result - ${html(config.label)}</div>
          <h2>${html(title)}</h2>
          <p>${html(summary)}</p>
        </div>
        <button type="button" class="movie-duel-close" onclick="returnToMovieRatingDuelTierList()" aria-label="Close">&times;</button>
      </div>
      <div class="movie-duel-result-card">
        <div class="movie-duel-result-media">
          <div class="movie-duel-result-poster">
            ${poster ? `<img src="${attr(poster)}" alt="${attr(title)}" loading="eager" decoding="async">` : `<span>${html(title.charAt(0).toUpperCase() || '?')}</span>`}
          </div>
          <div class="movie-duel-result-title">${html(title)}</div>
        </div>
        <div class="movie-duel-result-label">Your tier-list rating for this ${html(config.lower)} is a</div>
        <div class="movie-duel-result-score">${html(resultStarRating)}</div>
        <div class="movie-duel-result-recap">
          ${getMovieDuelRecapCopy(listRating, tierRating)}
        </div>
        <div class="movie-duel-result-note">${noteCopy}</div>
      </div>
      ${actionsHtml}
    `;
  }

  function renderTierListPage() {
    const overlay = ensureMovieDuelOverlay();
    const config = getMediaConfig(duelMediaKey);
    const readOnly = isMovieDuelReadOnly();
    const viewingName = cleanText(duelReadOnlyUser?.name || duelReadOnlyUser?.displayName || '') || config.label;
    duelState = null;
    overlay.classList.add('has-tier-result');
    overlay.classList.add('has-tier-list-page');
    overlay.classList.remove('has-movie-picker');
    overlay.classList.remove('has-active-round');
    overlay.querySelector('.movie-duel-sheet').innerHTML = `
      <div class="movie-duel-header">
        <div>
          <div class="movie-duel-kicker">${readOnly ? 'Friend Tier List' : 'Saved Tier List'}</div>
          <h2>${html(config.tierTitle)}</h2>
        </div>
        <button type="button" class="movie-duel-close" onclick="closeMovieRatingDuel()" aria-label="Close">&times;</button>
      </div>
      ${renderMediaTabs('tier')}
      <div class="movie-duel-tier-page-body">
        <div class="movie-duel-tier-page-scroll">
          ${renderMovieDuelTierList(getSavedTierList(duelMediaKey), '', { mediaKey: duelMediaKey })}
        </div>
      </div>
    `;
  }

  function setMovieDuelStatus(message = '') {
    const status = document.getElementById('movie-duel-status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-visible', !!message);
  }

  function ensureMovieDuelOverlay() {
    let overlay = document.getElementById('movie-rating-duel-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'movie-rating-duel-overlay';
    overlay.className = 'movie-duel-overlay';
    overlay.innerHTML = `
      <div class="movie-duel-backdrop" data-movie-duel-close="1"></div>
      <div class="movie-duel-sheet"></div>
    `;
    overlay.addEventListener('click', event => {
      if (event.target?.closest?.('[data-movie-duel-close]')) closeMovieRatingDuel();
    });
    document.body.appendChild(overlay);
    return overlay;
  }

  function openMovieRatingDuelLauncher(resetToActiveSection = true) {
    if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
    if (viewingUser) {
      if (typeof showToast === 'function') showToast('Open your own My Lists to play this game');
      return;
    }
    duelReadOnlyUser = null;
    if (resetToActiveSection) duelMediaKey = getDefaultDuelMediaKey();
    duelState = null;
    const overlay = ensureMovieDuelOverlay();
    overlay.classList.remove('is-closing-tier-list');
    overlay.classList.remove('has-tier-list-page');
    overlay.classList.remove('has-tier-result');
    overlay.classList.remove('has-movie-picker');
    overlay.classList.remove('has-active-round');
    overlay.querySelector('.movie-duel-sheet').innerHTML = getLauncherBodyHtml('');
    lockMovieDuelScroll();
    requestAnimationFrame(() => overlay.classList.add('is-open'));
  }

  function openMovieRatingDuelPicker() {
    const config = getMediaConfig(duelMediaKey);
    if (!getDuelItems(duelMediaKey).length) {
      setMovieDuelStatus(`No ${config.emptyLabel} available yet.`);
      return;
    }
    const overlay = ensureMovieDuelOverlay();
    overlay.classList.remove('is-closing-tier-list');
    overlay.classList.remove('has-tier-list-page');
    lockMovieDuelScroll();
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    renderMovieDuelPickerPage();
  }

  function openMovieRatingDuelTierListPage() {
    if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
    if (viewingUser) {
      if (typeof showToast === 'function') showToast('Open your own My Lists to view this tier list');
      return;
    }
    duelReadOnlyUser = null;
    duelMediaKey = MEDIA_CONFIGS[duelMediaKey] ? duelMediaKey : getDefaultDuelMediaKey();
    const overlay = ensureMovieDuelOverlay();
    overlay.classList.remove('is-closing-tier-list');
    renderTierListPage();
    lockMovieDuelScroll();
    requestAnimationFrame(() => overlay.classList.add('is-open'));
  }

  async function refreshViewingUserTierListProfile() {
    const uid = cleanText(viewingUser?.uid || '');
    if (!uid || typeof db === 'undefined' || !db?.collection) return viewingUser || null;
    try {
      const userDoc = await db.collection('users').doc(uid).get();
      if (!userDoc.exists) return viewingUser || null;
      const latestProfile = { ...(userDoc.data() || {}), uid };
      usersMap[uid] = { ...(usersMap[uid] || {}), ...latestProfile, uid };
      const nextViewingUser = {
        ...(viewingUser || {}),
        ...latestProfile,
        uid,
        profileData: latestProfile
      };
      viewingUser = nextViewingUser;
      return nextViewingUser;
    } catch (error) {
      console.warn('Tier list viewer refresh failed:', error);
      return viewingUser || null;
    }
  }

  async function openViewingUserTierListPage(mediaKey = '') {
    if (!viewingUser) return;
    duelReadOnlyUser = await refreshViewingUserTierListProfile() || viewingUser;
    duelMediaKey = MEDIA_CONFIGS[mediaKey] ? mediaKey : getDefaultDuelMediaKey();
    const overlay = ensureMovieDuelOverlay();
    overlay.classList.remove('is-closing-tier-list');
    renderTierListPage();
    lockMovieDuelScroll();
    requestAnimationFrame(() => overlay.classList.add('is-open'));
  }

  function switchMovieRatingDuelMedia(mediaKey = 'movies', context = 'launcher') {
    duelMediaKey = MEDIA_CONFIGS[mediaKey] ? mediaKey : 'movies';
    if (context === 'tier') {
      renderTierListPage();
      return;
    }
    const overlay = ensureMovieDuelOverlay();
    overlay.classList.remove('has-tier-list-page');
    overlay.classList.remove('has-tier-result');
    overlay.classList.remove('has-movie-picker');
    overlay.classList.remove('has-active-round');
    overlay.querySelector('.movie-duel-sheet').innerHTML = getLauncherBodyHtml('');
  }

  function selectMovieRatingDuelMovie(itemId = '') {
    duelSelectedItemIds[duelMediaKey] = cleanText(itemId);
    const overlay = ensureMovieDuelOverlay();
    overlay.classList.remove('has-tier-list-page');
    overlay.classList.remove('has-movie-picker');
    overlay.classList.remove('has-active-round');
    overlay.querySelector('.movie-duel-sheet').innerHTML = getLauncherBodyHtml('');
  }

  function closeMovieRatingDuel() {
    const overlay = document.getElementById('movie-rating-duel-overlay');
    window.clearTimeout(duelSwapTimer);
    cancelMovieDuelTierDrag();
    duelState = null;
    duelReadOnlyUser = null;
    if (!overlay) {
      unlockMovieDuelScroll();
      return;
    }
    const closingTierList = overlay.classList.contains('has-tier-list-page');
    if (closingTierList) overlay.classList.add('is-closing-tier-list');
    else overlay.classList.remove('has-tier-list-page');
    overlay.classList.remove('is-open');
    window.setTimeout(() => {
      overlay.remove();
      unlockMovieDuelScroll();
    }, closingTierList ? MOVIE_DUEL_TIER_TRANSITION_MS : MOVIE_DUEL_BASE_CLOSE_MS);
  }

  function startMovieRatingDuel() {
    const config = getMediaConfig(duelMediaKey);
    const selectedId = cleanText(duelSelectedItemIds[duelMediaKey] || document.getElementById('movie-duel-select')?.value || '');
    if (!selectedId) {
      setMovieDuelStatus(`Choose a ${config.lower} first.`);
      return;
    }
    try {
      duelState = buildDuelSession(selectedId, duelMediaKey);
      renderDuelRound(false);
    } catch (error) {
      setMovieDuelStatus(error?.message || 'Could not start this matchup game.');
    }
  }

  function startMovieRatingDuelFromTierList(itemId = '') {
    const config = getMediaConfig(duelMediaKey);
    const selectedId = cleanText(itemId);
    if (!selectedId) return;
    try {
      duelSelectedItemIds[duelMediaKey] = selectedId;
      duelState = buildTierListClickDuelSession(selectedId, duelMediaKey);
      renderDuelRound(false);
    } catch (error) {
      if (typeof showToast === 'function') showToast(error?.message || `Could not start this ${config.lower} matchup.`);
    }
  }

  async function finishMovieRatingDuel(resultBand, defeatedBand = 0, anchorItem = null, options = {}) {
    if (!duelState?.targetItem) return;
    const mediaKey = duelState.mediaKey || duelMediaKey;
    const finalBand = Math.max(1, Math.min(10, Number(resultBand || 0) || 1));
    const tierList = getSavedTierList(mediaKey);
    const targetEntry = makeTierEntry(duelState.targetItem, mediaKey, finalBand);
    const anchorEntry = anchorItem ? makeTierEntry(anchorItem, mediaKey, finalBand) : null;

    /* v10.80: Capture the target's existing tier placement BEFORE we
       mutate the working tier list. We need this to compare the
       suggested result against the saved placement and decide whether
       to write silently or defer the write behind a user confirmation
       prompt. */
    const targetId = cleanText(targetEntry.id || '');
    let previousTier = '';
    let hadPreviousEntry = false;
    TIER_ROWS.forEach(tier => {
      if (hadPreviousEntry) return;
      const row = Array.isArray(tierList[tier.key]) ? tierList[tier.key] : [];
      if (row.some(entry => cleanText(entry?.id || '') === targetId)) {
        previousTier = tier.key;
        hadPreviousEntry = true;
      }
    });

    if (options?.placement === 'start') {
      insertTierEntryAtStart(tierList, targetEntry);
    } else {
      insertTierEntryAfter(tierList, targetEntry, anchorEntry);
    }
    const displacedFromS = finalBand === 10 ? enforceSTierCap(tierList) : null;
    const newTier = getTierKeyForRating(finalBand);

    /* v10.80: Do NOT auto-overwrite the saved Tier List when the
       suggested tier differs from the saved one (or when the title
       isn't on the saved list yet). The new placement becomes a
       *suggestion* the user has to accept via "Update Tier List".
       If the suggested tier matches the saved tier, save silently —
       there's nothing meaningful for the user to decide. */
    const tiersMatch = hadPreviousEntry && previousTier === newTier;
    const requiresUserConfirmation = !tiersMatch;

    duelState.finalTierList = tierList;
    duelState.pendingTierList = requiresUserConfirmation ? tierList : null;
    duelState.pendingResultBand = finalBand;
    duelState.pendingDefeatedBand = defeatedBand;
    duelState.pendingMediaKey = mediaKey;

    const meta = {
      ...(options || {}),
      displacedFromS,
      previousTier,
      hadPreviousEntry,
      newTier,
      requiresUserConfirmation
    };

    if (!requiresUserConfirmation) {
      const savePromise = saveTierList(mediaKey, tierList);
      renderResult(finalBand, defeatedBand, tierList, meta);
      try {
        await savePromise;
      } catch (error) {
        console.warn('Tier list save failed:', error);
        if (typeof showToast === 'function') showToast('Tier list saved locally, but sync failed');
      }
      return;
    }

    /* v10.80: Suggested placement differs from saved — render the
       result with a confirmation prompt and let the user decide. No
       write happens until they tap "Update Tier List". */
    renderResult(finalBand, defeatedBand, tierList, meta);
  }

  /* v10.80: User accepted the Rating Game suggestion — commit the
     pending tier list to storage. */
  async function confirmMovieRatingDuelTierUpdate() {
    if (!duelState) {
      returnToMovieRatingDuelTierList();
      return;
    }
    const pending = duelState.pendingTierList;
    const mediaKey = duelState.pendingMediaKey || duelState.mediaKey || duelMediaKey;
    duelState.pendingTierList = null;
    if (!pending) {
      returnToMovieRatingDuelTierList();
      return;
    }
    try {
      await saveTierList(mediaKey, pending);
      if (typeof showToast === 'function') showToast('Tier list updated');
    } catch (error) {
      console.warn('Tier list save failed:', error);
      if (typeof showToast === 'function') showToast('Tier list saved locally, but sync failed');
    }
    returnToMovieRatingDuelTierList();
  }

  /* v10.80: User declined the Rating Game suggestion — discard the
     pending placement and leave the saved Tier List exactly as it
     was. */
  function keepMovieRatingDuelCurrentRanking() {
    if (duelState) {
      duelState.pendingTierList = null;
      duelState.finalTierList = null;
    }
    returnToMovieRatingDuelTierList();
  }

  function chooseMovieRatingDuelWinner(choice = '') {
    if (!duelState?.targetItem || !duelState?.currentOpponent || duelState?.isAnimating) return;
    const targetWon = choice === 'target';
    const mediaKey = duelState.mediaKey || duelMediaKey;
    duelState.rounds.push({
      band: duelState.currentBand,
      winner: targetWon ? getTierItemId(duelState.targetItem) : getTierItemId(duelState.currentOpponent),
      loser: targetWon ? getTierItemId(duelState.currentOpponent) : getTierItemId(duelState.targetItem)
    });

    if (!targetWon) {
      const previousQueue = Array.isArray(duelState.comparisonQueue) && duelState.currentQueueIndex > 0
        ? duelState.comparisonQueue[duelState.currentQueueIndex - 1]
        : null;
      const blockedOnTierEntry = !!(previousQueue?.band && Number(duelState.currentOpponentIndex || 0) === 0);
      if (blockedOnTierEntry) {
        finishMovieRatingDuel(previousQueue.band, duelState.currentBand, null, {
          placement: 'start',
          type: 'promotion-blocked',
          retainedBand: previousQueue.band,
          blockedBand: duelState.currentBand
        });
      } else {
        finishMovieRatingDuel(duelState.currentBand, duelState.currentBand, duelState.currentOpponent);
      }
      return;
    }

    const nextOpponentIndex = Number(duelState.currentOpponentIndex || 0) + 1;
    const currentBandOpponents = Array.isArray(duelState.currentBandOpponents) ? duelState.currentBandOpponents : [];
    if (nextOpponentIndex < currentBandOpponents.length) {
      duelState.currentOpponentIndex = nextOpponentIndex;
      duelState.currentOpponent = currentBandOpponents[nextOpponentIndex] || null;
      renderDuelRound(true);
      return;
    }

    const nextQueueIndex = Number(duelState.currentQueueIndex || 0) + 1;
    if (!setDuelQueuePosition(duelState, nextQueueIndex, 0)) {
      finishMovieRatingDuel(duelState.terminalWinBand || duelState.currentBand || duelState.savedRating || 1, 0, null);
      return;
    }
    renderDuelRound(true);
  }

  window.openMovieRatingDuelLauncher = openMovieRatingDuelLauncher;
  window.openMovieRatingDuelPicker = openMovieRatingDuelPicker;
  window.openMovieRatingDuelTierListPage = openMovieRatingDuelTierListPage;
  window.returnToMovieRatingDuelTierList = returnToMovieRatingDuelTierList;
  window.switchMovieRatingDuelMedia = switchMovieRatingDuelMedia;
  window.selectMovieRatingDuelMovie = selectMovieRatingDuelMovie;
  window.closeMovieRatingDuel = closeMovieRatingDuel;
  window.startMovieRatingDuel = startMovieRatingDuel;
  window.startMovieRatingDuelFromTierList = startMovieRatingDuelFromTierList;
  window.chooseMovieRatingDuelWinner = chooseMovieRatingDuelWinner;
  window.loadMoreMovieRatingDuelTier = loadMoreMovieRatingDuelTier;
  window.openViewingUserTierListPage = openViewingUserTierListPage;
  /* v10.80: confirmation prompt handlers for the Rating Game result
     screen — wired to the new "Update Tier List" / "Keep Current
     Ranking" buttons in renderResult. */
  window.confirmMovieRatingDuelTierUpdate = confirmMovieRatingDuelTierUpdate;
  window.keepMovieRatingDuelCurrentRanking = keepMovieRatingDuelCurrentRanking;
})();
