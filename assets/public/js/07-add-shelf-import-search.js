// TMDB Cover Search
const TMDB_PROXY_BASE = "/api/tmdb";
const RAWG_PROXY_BASE = "/api/rawg";
const SCREENLIST_AI_PROXY_BASE = "/api/ai";
const DEEPSEEK_PROXY_BASE = "/api/deepseek"; // legacy fallback only
const SCREENLIST_PINNED_GAME_SEARCH_RESULTS = [
  {
    aliases: ['valorant'],
    item: {
      id: 415171,
      rawgId: 415171,
      name: 'Valorant',
      released: '2020-06-02',
      background_image: 'https://images.igdb.com/igdb/image/upload/t_cover_big/cobtjo.jpg',
      rating: 3.75,
      ratings_count: 496,
      added: 496,
      platforms: ['Xbox Series X|S', 'PC (Microsoft Windows)', 'PlayStation 5'].map(name => ({ platform: { name } })),
      genres: ['Shooter', 'Tactical'].map(name => ({ name })),
      slug: 'valorant',
      source: 'igdb',
      igdbId: 126459,
      igdbSlug: 'valorant',
      igdbCover: 'https://images.igdb.com/igdb/image/upload/t_cover_big/cobtjo.jpg',
      overview: 'Valorant is a character-based 5v5 tactical shooter set on the global stage.'
    }
  },
  {
    aliases: ['marvel rivals', 'marvelrivals'],
    item: {
      id: 993875,
      rawgId: 993875,
      name: 'Marvel Rivals',
      released: '2024-12-06',
      background_image: 'https://images.igdb.com/igdb/image/upload/t_cover_big/coc27c.jpg',
      rating: 3.86,
      ratings_count: 328,
      added: 328,
      platforms: ['Xbox Series X|S', 'PlayStation 4', 'Nintendo Switch 2', 'PC (Microsoft Windows)', 'PlayStation 5'].map(name => ({ platform: { name } })),
      genres: ['Shooter'].map(name => ({ name })),
      slug: 'marvel-rivals',
      source: 'igdb',
      igdbId: 294041,
      igdbSlug: 'marvel-rivals',
      igdbCover: 'https://images.igdb.com/igdb/image/upload/t_cover_big/coc27c.jpg',
      overview: 'Marvel Rivals is a super hero team-based PvP shooter developed by NetEase Games.'
    }
  }
];

function normalizeGameSearchKey(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getPinnedGameSearchResults(query = '') {
  const clean = normalizeGameSearchKey(query);
  if (!clean) return [];
  return SCREENLIST_PINNED_GAME_SEARCH_RESULTS
    .filter(row => row.aliases.some(alias => {
      const key = normalizeGameSearchKey(alias);
      return key === clean || key.startsWith(clean) || clean.startsWith(key);
    }))
    .map(row => ({ ...row.item, _pinnedGameSearch: true }));
}
/* v691 fix: var (not let) so window.selectedTmdb and selectedTmdb are the
   same binding — cross-file writes like window.selectedTmdb = {...} from
   11-discovery-media-games-profiles.js (seasonal add sheet) are visible
   to submitModal() which reads the bare `selectedTmdb` name. */
var selectedTmdb = null; // holds the selected item data

function buildProxyUrl(base, path, params = {}) {
  const cleanPath = String(path || '').replace(/^\/+/, '');
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    search.set(key, String(value));
  });
  const query = search.toString();
  return `${base}/${cleanPath}${query ? `?${query}` : ''}`;
}

function fetchTmdbProxy(path, params = {}) {
  return fetch(buildProxyUrl(TMDB_PROXY_BASE, path, params));
}

function fetchRawgProxy(path, params = {}) {
  return fetch(buildProxyUrl(RAWG_PROXY_BASE, path, params));
}

const JIKAN_API_BASE = "https://api.jikan.moe/v4";
const animeTitleVariantCache = new Map();
const animeTitleHydrationInFlight = new Set();

async function fetchAnimeTitleVariantsFromJikan(query = '') {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return null;
  const cacheKey = cleanQuery.toLowerCase();
  if (animeTitleVariantCache.has(cacheKey)) return animeTitleVariantCache.get(cacheKey);
  try {
    const url = `${JIKAN_API_BASE}/anime?q=${encodeURIComponent(cleanQuery)}&limit=1`;
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) return null;
    const json = await res.json();
    const hit = Array.isArray(json?.data) ? json.data[0] : null;
    if (!hit) return null;
    const titleRows = Array.isArray(hit.titles) ? hit.titles : [];
    const titleByType = type => titleRows.find(row => String(row?.type || '').toLowerCase() === type)?.title || '';
    const variants = normalizeAnimeTitleVariants({
      english: hit.title_english || titleByType('english') || cleanQuery,
      romaji: hit.title || titleByType('default') || titleByType('romaji') || cleanQuery,
      japanese: hit.title_japanese || titleByType('japanese') || ''
    }, cleanQuery);
    /* v677: piggyback MyAnimeList community stats on the title-variant
       lookup. Costs zero extra API calls since the same /anime?q= response
       already includes them. The result object now carries `members`,
       `favorites`, `mal_id`, `score`, etc. so any caller can read them. */
    const result = {
      ...variants,
      members: Number(hit.members || 0),
      favorites: Number(hit.favorites || 0),
      scoredBy: Number(hit.scored_by || 0),
      score: Number(hit.score || 0),
      malId: Number(hit.mal_id || 0),
      rank: Number(hit.rank || 0),
      popularity: Number(hit.popularity || 0)
    };
    animeTitleVariantCache.set(cacheKey, result);
    return result;
  } catch (e) {
    console.warn('Anime title variant lookup failed:', e);
    return null;
  }
}

async function hydrateAnimeTitleVariants(target = {}) {
  if (!target || typeof target !== 'object') return target;
  const fallbackTitle = target.title || target.name || '';
  const fallbackVariants = normalizeAnimeTitleVariants({
    english: fallbackTitle,
    romaji: target.romajiTitle || fallbackTitle,
    japanese: target.japaneseTitle || (detectJapaneseScript(target.originalTitle || target.original_name || target.original_title) ? (target.originalTitle || target.original_name || target.original_title) : '')
  }, fallbackTitle);
  const query = fallbackTitle || target.originalTitle || target.original_name || target.original_title || '';
  const jikanVariants = await fetchAnimeTitleVariantsFromJikan(query);
  const variants = normalizeAnimeTitleVariants({
    english: jikanVariants?.english || fallbackVariants.english,
    romaji: jikanVariants?.romaji || fallbackVariants.romaji,
    japanese: jikanVariants?.japanese || fallbackVariants.japanese
  }, fallbackTitle);
  target.titleVariants = variants;
  target.englishTitle = variants.english;
  target.romajiTitle = variants.romaji;
  target.japaneseTitle = variants.japanese;
  /* v677: also forward MAL community stats so the profile renderer can
     show "Members" for TMDB-sourced anime profiles too (not just the
     pure-Jikan path from search/discover). */
  if (jikanVariants && Number(jikanVariants.members) > 0) {
    target.malMembers = Number(jikanVariants.members);
    target.malFavorites = Number(jikanVariants.favorites || 0);
    target.malScoredBy = Number(jikanVariants.scoredBy || 0);
    if (Number(jikanVariants.malId) > 0) target.malId = Number(jikanVariants.malId);
    if (Number(jikanVariants.rank) > 0) target.malRank = Number(jikanVariants.rank);
    if (Number(jikanVariants.popularity) > 0) target.malPopularity = Number(jikanVariants.popularity);
  }
  return target;
}

function queueAnimeTitleVariantHydration(item, section = 'anime') {
  if (!item || section !== 'anime' || isViewingOtherProfile?.()) return;
  const mode = getAnimeTitleDisplayMode();
  if (mode === 'english' && item.titleVariants?.english) return;
  if (item.titleVariants?.romaji && item.titleVariants?.japanese) return;
  const key = `${section}:${item.id || item.title || ''}`;
  if (animeTitleHydrationInFlight.has(key)) return;
  animeTitleHydrationInFlight.add(key);
  hydrateAnimeTitleVariants(item).then(() => {
    animeTitleHydrationInFlight.delete(key);
    if (!viewingUser && activeSection === section) {
      save();
      render();
    }
  }).catch(() => animeTitleHydrationInFlight.delete(key));
}

function formatAnimeSeasonTitle(baseTitle = '', season = {}) {
  const n = Number(season.season_number || season.seasonNum || season.number || 0);
  const rawName = String(season.name || '').trim();
  const genericName = !rawName || /^season\s*\d+$/i.test(rawName) || rawName === String(n);
  const suffix = genericName ? `Season ${n || ''}`.trim() : rawName;
  return suffix ? `${baseTitle} — ${suffix}` : baseTitle;
}

function buildAnimeSeasonLibraryItem(base = {}, season = {}, status = 'watching', rating = 0, index = 0) {
  const baseId = String(base.tmdbId || base.id || Date.now());
  const seasonNum = Number(season.seasonNum || season.season_number || season.number || index + 1);
  const episodes = Array.isArray(season.episodes) ? season.episodes : [];
  const id = `${Date.now()}-${baseId}-s${seasonNum}-${index}`;
  const title = formatAnimeSeasonTitle(base.title || base.name || '', season);
  return {
    id,
    title,
    parentTitle: base.title || base.name || '',
    cover: season.cover || base.cover || '',
    genre: base.genre || '',
    year: String(season.airDate || season.air_date || base.year || '').slice(0, 4),
    status,
    rating,
    dateAdded: new Date().toISOString(),
    imdbId: base.imdbId || '',
    tmdbId: base.tmdbId || '',
    tmdbSeasonNumber: seasonNum,
    mediaCategory: 'anime',
    librarySection: 'anime',
    originalTitle: base.originalTitle || '',
    originalLanguage: base.originalLanguage || '',
    originCountries: Array.isArray(base.originCountries) ? base.originCountries : [],
    genreNames: Array.isArray(base.genreNames) ? base.genreNames : [],
    isAnime: true,
    titleVariants: normalizeAnimeTitleVariants({
      english: formatAnimeSeasonTitle(base.titleVariants?.english || base.englishTitle || base.title || '', season),
      romaji: formatAnimeSeasonTitle(base.titleVariants?.romaji || base.romajiTitle || base.title || '', season),
      japanese: base.titleVariants?.japanese || base.japaneseTitle
        ? formatAnimeSeasonTitle(base.titleVariants?.japanese || base.japaneseTitle, season)
        : ''
    }, title),
    totalEpisodes: episodes.length,
    totalEps: episodes.length,
    currentEp: status === 'watched' ? episodes.length : 0,
    episodes: episodes.map((ep, i) => ({
      id: `${id}-ep-${i + 1}`,
      number: i + 1,
      seasonNum,
      seasonName: season.name || season.seasonName || '',
      epNum: ep.epNum || ep.episode_number || i + 1,
      title: ep.title || ep.name || '',
      watched: status === 'watched',
      rating: 0
    }))
  };
}

function shouldSplitAnimeSeasons(source = {}) {
  // Anime TV titles should stay as one library card.
  // Keep season metadata attached for nested season/episode rendering,
  // but do not split seasons into separate library entries.
  return false;
}

function buildAnimeSeasonItemsForLibrary(source = {}, status = 'watching', rating = 0) {
  if (!shouldSplitAnimeSeasons(source)) return [];
  return source.animeSeasonItems.map((season, index) => buildAnimeSeasonLibraryItem(source, season, status, rating, index));
}

function getAnimeSeriesMatchKey(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\s+[—–-]\s+(season|part)\s*\d+.*$/i, '')
    .replace(/\s*[:|]\s*(season|part)\s*\d+.*$/i, '')
    .replace(/\s+season\s*\d+.*$/i, '')
    .replace(/\s+part\s*\d+.*$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getAnimeSeriesMatchKeys(source = {}) {
  return new Set([
    source.title,
    source.parentTitle,
    source.englishTitle,
    source.romajiTitle,
    source.originalTitle,
    source.titleVariants?.english,
    source.titleVariants?.romaji
  ].map(getAnimeSeriesMatchKey).filter(Boolean));
}

function isAnimeSeasonSplitEntry(entry = {}, source = {}) {
  if (!entry || typeof entry !== 'object') return false;
  const isAnimeEntry = entry.isAnime === true || entry.mediaCategory === 'anime' || entry.librarySection === 'anime';
  if (!isAnimeEntry) return false;
  const hasSeasonSplitMarker = !!(
    entry.tmdbSeasonNumber ||
    entry.parentTitle ||
    /(?:^|\s+[—–-]\s+|\s*:\s*|\s+)season\s*\d+/i.test(entry.title || '') ||
    /(?:^|\s+[—–-]\s+|\s*:\s*|\s+)part\s*\d+/i.test(entry.title || '')
  );
  if (!hasSeasonSplitMarker) return false;
  const sourceTmdbId = String(source.tmdbId || '').trim();
  const entryTmdbId = String(entry.tmdbId || '').trim();
  if (sourceTmdbId && entryTmdbId && sourceTmdbId === entryTmdbId) return true;
  const sourceKeys = getAnimeSeriesMatchKeys(source);
  if (!sourceKeys.size) return false;
  return [entry.parentTitle, entry.title, entry.englishTitle, entry.romajiTitle, entry.originalTitle]
    .map(getAnimeSeriesMatchKey)
    .some(key => key && sourceKeys.has(key));
}

function removeAnimeSeasonSplitEntries(list = [], source = {}) {
  const items = Array.isArray(list) ? list : [];
  return items.filter(entry => !isAnimeSeasonSplitEntry(entry, source));
}

async function postAiImportMatch(endpoint, payload) {
  return fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function fetchDeepSeekImportMatch(payload) {
  const primaryEndpoint = `${SCREENLIST_AI_PROXY_BASE}/import-match`;
  const res = await postAiImportMatch(primaryEndpoint, payload);
  if (res.status !== 404) return res;

  // Legacy fallback so older Worker deploys do not instantly break while the
  // new Workers AI route is being deployed. Remove after /api/ai is live.
  return postAiImportMatch(`${DEEPSEEK_PROXY_BASE}/import-match`, payload);
}

async function checkScreenListAI() {
  const endpoint = `${SCREENLIST_AI_PROXY_BASE}/import-match`;
  const startedAt = performance.now();
  try {
    const res = await postAiImportMatch(endpoint, {
      systemPrompt: 'Return valid JSON only. No markdown.',
      userPrompt: 'Return exactly {"ok":true,"service":"workers-ai"}.',
      temperature: 0
    });
    const elapsedMs = Math.round(performance.now() - startedAt);
    const raw = await res.text();
    let body = raw;
    try { body = JSON.parse(raw); } catch (e) {}
    const result = { ok: res.ok, status: res.status, elapsedMs, endpoint, body };
    console.log('ScreenList Workers AI check:', result);
    if (!res.ok) {
      console.warn('ScreenList Workers AI check failed. 404 = Worker route missing, 401/403 = auth/binding issue, 500 = Worker/AI error.');
    }
    return result;
  } catch (error) {
    const result = { ok: false, status: 0, endpoint, error: error?.message || String(error) };
    console.error('ScreenList Workers AI check failed:', result);
    return result;
  }
}

async function checkDeepSeekAPI() {
  return checkScreenListAI();
}

/* v930: expose game-search helpers to discovery search page */
window.fetchMergedGameSearchResults = fetchMergedGameSearchResults;
window.scoreGameForSearch           = scoreGameForSearch;
window.normaliseIgdbGameToRawg      = normaliseIgdbGameToRawg;
window.checkScreenListAI = checkScreenListAI;
window.screenListAiCheck = checkScreenListAI;
window.checkDeepSeekAPI = checkScreenListAI; // legacy console alias
window.deepSeekCheck = checkScreenListAI;

function saveTmdbKey() {
  localStorage.removeItem("tmdb-api-key");
  renderApiKeySection();
}

function renderApiKeySection() {
  document.getElementById("api-key-section").innerHTML = '';
}

let addTitleLiveSearchTimer = null;
let addTitleSearchRequestToken = 0;
let addShelfSearchFilter = 'all';
let pendingModalStatusSelection = '';
let pendingModalRatingSelection = 0;
let modalAddSubmitting = false;
let addShelfModalBackHandler = null;
let addShelfModalScrollLockState = null;
let addShelfModalSearchSnapshot = null;
let addShelfModalSelectionState = null;

function lockAddShelfModalBackgroundScroll() {
  if (addShelfModalScrollLockState) return;
  const scrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
  const body = document.body;
  const html = document.documentElement;
  addShelfModalScrollLockState = {
    scrollY,
    bodyPosition: body.style.position,
    bodyTop: body.style.top,
    bodyLeft: body.style.left,
    bodyRight: body.style.right,
    bodyWidth: body.style.width,
    bodyOverflow: body.style.overflow,
    bodyTouchAction: body.style.touchAction,
    htmlOverflow: html.style.overflow
  };
  body.style.position = 'fixed';
  body.style.top = `-${scrollY}px`;
  body.style.left = '0';
  body.style.right = '0';
  body.style.width = '100%';
  body.style.overflow = 'hidden';
  body.style.touchAction = 'none';
  html.style.overflow = 'hidden';
  body.classList.add('modal-open');
}

function unlockAddShelfModalBackgroundScroll() {
  const state = addShelfModalScrollLockState;
  if (!state) return;
  addShelfModalScrollLockState = null;
  const body = document.body;
  const html = document.documentElement;
  body.style.position = state.bodyPosition || '';
  body.style.top = state.bodyTop || '';
  body.style.left = state.bodyLeft || '';
  body.style.right = state.bodyRight || '';
  body.style.width = state.bodyWidth || '';
  body.style.overflow = state.bodyOverflow || '';
  body.style.touchAction = state.bodyTouchAction || '';
  html.style.overflow = state.htmlOverflow || '';
  body.classList.remove('modal-open');
  window.scrollTo(0, state.scrollY || 0);
}

function cloneAddShelfModalStateValue(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return typeof value === 'object' ? { ...value } : value;
  }
}

function syncAddShelfFilterUi(filter = addShelfSearchFilter) {
  addShelfSearchFilter = filter;
  document.querySelectorAll('.shelf-filter-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.filter === filter);
  });
  setAddShelfSearchPlaceholder(filter);
}

function captureAddShelfSearchSnapshot() {
  const results = document.getElementById('tmdb-results');
  const input = document.getElementById('inp-tmdb-search');
  return {
    filter: addShelfSearchFilter,
    query: input?.value || '',
    resultsHtml: results?.innerHTML || '',
    resultsScrollTop: results?.scrollTop || 0
  };
}

function rememberAddShelfSelectionState(item = selectedTmdb, searchSnapshot = null) {
  const activeItem = item || selectedTmdb;
  if (!activeItem) return;
  addShelfModalSearchSnapshot = searchSnapshot || captureAddShelfSearchSnapshot();
  addShelfModalSelectionState = {
    item: cloneAddShelfModalStateValue(activeItem),
    status: '',
    rating: 0
  };
}

function getActiveAddShelfSelectedItem() {
  return addShelfModalSelectionState?.item || selectedTmdb || null;
}

function setAddShelfModalSelectionChoice({ status = pendingModalStatusSelection, rating = pendingModalRatingSelection } = {}) {
  const activeItem = getActiveAddShelfSelectedItem();
  if (!activeItem) return;
  if (!addShelfModalSelectionState) {
    addShelfModalSelectionState = {
      item: cloneAddShelfModalStateValue(activeItem),
      status: '',
      rating: 0
    };
  }
  if (typeof status === 'string') addShelfModalSelectionState.status = status;
  if (rating !== undefined) addShelfModalSelectionState.rating = Number(rating || 0) || 0;
}

function removeAddShelfSearchFlashMessage() {
  document.getElementById('add-shelf-search-flash')?.remove();
}

function flashAddShelfSearchMessage(message = 'Added to library') {
  const searchArea = document.getElementById('tmdb-search-area');
  const results = document.getElementById('tmdb-results');
  if (!searchArea || !results) return;
  removeAddShelfSearchFlashMessage();
  const banner = document.createElement('div');
  banner.id = 'add-shelf-search-flash';
  banner.className = 'add-shelf-search-flash';
  banner.textContent = message;
  searchArea.insertBefore(banner, results);
  window.setTimeout(() => {
    banner.classList.add('is-hiding');
    window.setTimeout(() => banner.remove(), 260);
  }, 2200);
}

function updateAddShelfModalSelectionLayout(hasSelection = !!selectedTmdb) {
  const modalCard = document.querySelector('#modal .add-title-modal');
  const searchArea = document.getElementById('tmdb-search-area');
  if (modalCard) modalCard.classList.toggle('add-shelf-has-selection', !!hasSelection);
  if (searchArea) searchArea.style.display = hasSelection ? 'none' : '';
}

function resetAddTitleSelection(options = {}) {
  const { clearSearchSnapshot = false } = options;
  const selectedArea = document.getElementById("tmdb-selected-area");
  selectedTmdb = null;
  addShelfModalSelectionState = null;
  pendingModalStatusSelection = '';
  pendingModalRatingSelection = 0;
  modalAddSubmitting = false;
  if (clearSearchSnapshot) addShelfModalSearchSnapshot = null;
  if (selectedArea) {
    selectedArea.style.display = "none";
    selectedArea.innerHTML = "";
  }
  hideModalStatusPicker();
  updateAddShelfModalSelectionLayout(false);
}

function getAddShelfDefaultFilter(section = activeSection) {
  if (section === 'movies') return 'movies';
  if (section === 'shows') return 'tv';
  if (section === 'anime') return 'anime';
  if (section === 'games') return 'games';
  if (section === 'manga') return 'manga';
  if (section === 'books') return 'books';
  return 'all';
}

function getAddShelfSectionForFilter(filter = addShelfSearchFilter) {
  if (filter === 'movies') return 'movies';
  if (filter === 'tv') return 'shows';
  if (filter === 'anime') return 'anime';
  if (filter === 'games') return 'games';
  if (filter === 'manga') return 'manga';
  if (filter === 'books') return 'books';
  return activeSection;
}

function normalizeAddShelfLibrarySection(section = '') {
  const raw = String(section || '').trim().toLowerCase();
  if (raw === 'movie' || raw === 'movies') return 'movies';
  if (raw === 'tv' || raw === 'show' || raw === 'shows') return 'shows';
  if (raw === 'anime') return 'anime';
  if (raw === 'game' || raw === 'games') return 'games';
  if (raw === 'manga') return 'manga';
  if (raw === 'book' || raw === 'books') return 'books';
  return '';
}

function resolveAddShelfSelectedSection(item = selectedTmdb, fallbackFilter = addShelfSearchFilter) {
  const fromLibrary = normalizeAddShelfLibrarySection(item?.librarySection || item?.mediaCategory || '');
  if (fromLibrary) return fromLibrary;
  const mediaType = String(item?.media_type || item?.mediaType || '').trim().toLowerCase();
  if (mediaType === 'movie') return 'movies';
  if (mediaType === 'tv') return detectAnimeFromMetadata(item || {}) ? 'anime' : 'shows';
  return normalizeAddShelfLibrarySection(getAddShelfSectionForFilter(fallbackFilter)) || activeSection;
}

function getTmdbTypeForAddShelfFilter(filter = addShelfSearchFilter) {
  if (filter === 'tv' || filter === 'anime') return 'tv';
  if (filter === 'movies') return 'movie';
  return isShowSection(activeSection) ? 'tv' : 'movie';
}

function getAddShelfSearchPlaceholder(filter = addShelfSearchFilter) {
  if (filter === 'games') return 'Search games...';
  if (filter === 'anime') return 'Search anime...';
  if (filter === 'movies') return 'Search movies...';
  if (filter === 'tv') return 'Search TV shows...';
  if (filter === 'manga') return 'Search manga...';
  if (filter === 'books') return 'Search books...';
  return 'Search movies, shows, anime, games...';
}

function setAddShelfSearchPlaceholder(filter = addShelfSearchFilter) {
  const input = document.getElementById('inp-tmdb-search');
  if (input) input.placeholder = getAddShelfSearchPlaceholder(filter);
}

function setModalBackBtn(visible, handler = null) {
  const btn = document.getElementById('modal-back-btn');
  if (!btn) return;
  addShelfModalBackHandler = visible ? (handler || clearSelection) : null;
  btn.style.display = visible ? '' : 'none';
}

function handleModalBackButton() {
  if (typeof addShelfModalBackHandler === 'function') addShelfModalBackHandler();
}

function resetAddShelfModalHome() {
  resetAddTitleSelection({ clearSearchSnapshot: true });
  const searchArea = document.getElementById('tmdb-search-area');
  const results = document.getElementById('tmdb-results');
  const input = document.getElementById('inp-tmdb-search');
  removeAddShelfSearchFlashMessage();
  if (searchArea) searchArea.style.display = '';
  if (results) results.innerHTML = '';
  if (input) input.value = '';
  setAddShelfFilter(getAddShelfDefaultFilter(activeSection));
  setModalBackBtn(false);
  if (input) setTimeout(() => input.focus(), 40);
}

function restoreAddShelfSearchResults() {
  resetAddTitleSelection();
  const searchArea = document.getElementById('tmdb-search-area');
  const results = document.getElementById('tmdb-results');
  const input = document.getElementById('inp-tmdb-search');
  const snapshot = addShelfModalSearchSnapshot;
  if (searchArea) searchArea.style.display = '';
  if (snapshot) {
    syncAddShelfFilterUi(snapshot.filter || getAddShelfDefaultFilter(activeSection));
    if (input) input.value = snapshot.query || '';
    if (results) {
      results.innerHTML = snapshot.resultsHtml || '';
      const scrollTop = Number(snapshot.resultsScrollTop || 0);
      requestAnimationFrame(() => { results.scrollTop = scrollTop; });
    }
  }
  setModalBackBtn(false);
}

function triggerAddShelfSuccessFeedback() {
  if (typeof playLibraryAddPopSound === 'function') playLibraryAddPopSound();
  try {
    if (navigator?.vibrate) navigator.vibrate(18);
  } catch (_) {}
}

function getAddShelfModalRatingValue(score = (addShelfModalSelectionState?.rating ?? pendingModalRatingSelection), section = resolveAddShelfSelectedSection(getActiveAddShelfSelectedItem())) {
  const cleanScore = Number(score || 0) || 0;
  if (cleanScore <= 0) return 'No rating';
  if (typeof formatRatingValueForSection === 'function') return formatRatingValueForSection(cleanScore, section, true);
  return `${cleanScore}/10`;
}

function getAddShelfStatusLabel(status = '', section = activeSection) {
  const option = (MODAL_STATUS_OPTIONS[section] || []).find(entry => entry.status === status);
  return option?.label || getMyListStatusLabel(status, section) || 'Library';
}

function buildAddShelfSelectedPreviewDetails(item = getActiveAddShelfSelectedItem()) {
  const activeItem = item || getActiveAddShelfSelectedItem();
  const section = resolveAddShelfSelectedSection(activeItem, addShelfSearchFilter);
  const typeConfig = getAddShelfResultTypeConfig(activeItem || {}, addShelfSearchFilter);
  const year = String(activeItem?.year || '').slice(0, 4);
  const detailLines = [];
  if (activeItem?.genre) detailLines.push(String(activeItem.genre));
  if (section === 'games' && activeItem?.platforms) detailLines.push(String(activeItem.platforms));
  if (isShowSection(section)) {
    const seasons = Number(activeItem?.seasons || activeItem?.animeSeasonItems?.length || 0);
    const episodeTotal = Number(activeItem?.totalEpisodes || activeItem?.episodes?.length || 0);
    if (seasons > 0 && episodeTotal > 0) {
      detailLines.push(`${seasons} season${seasons === 1 ? '' : 's'} - ${episodeTotal} episodes`);
    } else if (episodeTotal > 0) {
      detailLines.push(`${episodeTotal} episode${episodeTotal === 1 ? '' : 's'}`);
    } else {
      detailLines.push('Episode count TBD');
    }
  }
  if (String(activeItem?.source || '') === 'manual') {
    detailLines.push(`Manual ${getAddButtonSectionLabel(section)} entry`);
  }
  return {
    typeLabel: typeConfig?.label || getAddButtonSectionLabel(section),
    year,
    detailLines: detailLines.filter(Boolean)
  };
}

function renderAddShelfSelectedPreview(item = getActiveAddShelfSelectedItem()) {
  const activeItem = item || getActiveAddShelfSelectedItem();
  const selectedArea = document.getElementById("tmdb-selected-area");
  if (!selectedArea || !activeItem) return;
  const title = activeItem.title || activeItem.name || 'Selected title';
  const cover = activeItem.cover || activeItem.igdbCoverUrl || '';
  const { typeLabel, year, detailLines } = buildAddShelfSelectedPreviewDetails(activeItem);
  const chips = [typeLabel, year].filter(Boolean).map(value => `<span class="add-shelf-selected-chip">${escHtml(value)}</span>`).join('');
  const detailMarkup = detailLines.map(line => `<div class="add-shelf-selected-line">${escHtml(line)}</div>`).join('');
  const placeholder = escHtml(String(title || '?').trim().charAt(0) || '?');
  selectedArea.style.display = "block";
  selectedArea.innerHTML = `
    <div class="tmdb-selected add-shelf-selected-card">
      <div class="add-shelf-selected-poster-wrap${cover ? '' : ' is-empty'}">
        ${cover ? `<img src="${escAttr(cover)}" alt="${escAttr(title)} poster">` : `<span class="add-shelf-selected-placeholder">${placeholder}</span>`}
      </div>
      <div class="tmdb-selected-info add-shelf-selected-info">
        <div class="add-shelf-selected-kicker">Selected title</div>
        <div class="tmdb-selected-title">${escHtml(title)}</div>
        ${chips ? `<div class="add-shelf-selected-chip-row">${chips}</div>` : ''}
        ${detailMarkup ? `<div class="add-shelf-selected-details">${detailMarkup}</div>` : ''}
        <button class="tmdb-clear add-shelf-selected-clear" type="button" onclick="clearSelection()">Choose another title</button>
      </div>
    </div>`;
}

function handleAddTitleLiveSearchInput() {
  const input = document.getElementById("inp-tmdb-search");
  const resultsDiv = document.getElementById("tmdb-results");
  const query = (input?.value || '').trim();
  clearTimeout(addTitleLiveSearchTimer);
  removeAddShelfSearchFlashMessage();
  resetAddTitleSelection();
  if (!query) {
    addTitleSearchRequestToken++;
    if (resultsDiv) resultsDiv.innerHTML = "";
    return;
  }
  if (query.length < 2) {
    addTitleSearchRequestToken++;
    if (resultsDiv) resultsDiv.innerHTML = '<div class="cover-search-msg">Keep typing...</div>';
    return;
  }
  if (addShelfSearchFilter === 'books' || addShelfSearchFilter === 'manga') {
    selectManualReadingTitle();
    return;
  }
  addTitleLiveSearchTimer = setTimeout(() => doSearch(), 260);
}

function doSearch() {
  clearTimeout(addTitleLiveSearchTimer);
  const query = (document.getElementById("inp-tmdb-search")?.value || '').trim();
  if (!query) return;
  const token = ++addTitleSearchRequestToken;
  if (addShelfSearchFilter === 'games') searchRAWG(token);
  else if (addShelfSearchFilter === 'books' || addShelfSearchFilter === 'manga') selectManualReadingTitle();
  else searchUniversalShelf(token);
}

function setAddShelfFilter(filter) {
  syncAddShelfFilterUi(filter);
  removeAddShelfSearchFlashMessage();
  const query = (document.getElementById('inp-tmdb-search')?.value || '').trim();
  if (query.length >= 2) doSearch();
  else if (document.getElementById('tmdb-results')) document.getElementById('tmdb-results').innerHTML = '';
}

function getAddShelfResultKind(item = {}, fallbackFilter = addShelfSearchFilter) {
  const mediaType = String(item?.media_type || item?.mediaType || '').trim().toLowerCase();
  const mediaCategory = String(item?.mediaCategory || item?.librarySection || '').trim().toLowerCase();
  const normalizedForAnimeCheck = {
    title: item?.title || item?.name || '',
    originalTitle: item?.original_title || item?.original_name || item?.originalTitle || '',
    originalLanguage: item?.original_language || item?.originalLanguage || '',
    originCountries: Array.isArray(item?.origin_country) ? item.origin_country : (item?.originCountries || []),
    genreNames: Array.isArray(item?.genres) ? item.genres.map(g => g?.name).filter(Boolean) : (Array.isArray(item?.genreNames) ? item.genreNames : []),
    genre: item?.genre || ''
  };
  const isAnimeTitle = mediaCategory === 'anime' || isAnimeDiscoverCandidate(item) || detectAnimeFromMetadata(normalizedForAnimeCheck);

  if (item?.rawgId || String(item?.source || '').trim().toLowerCase() === 'rawg' || fallbackFilter === 'games') return 'game';
  if (mediaCategory === 'manga' || fallbackFilter === 'manga') return 'manga';
  if (mediaCategory === 'books' || fallbackFilter === 'books') return 'book';
  if (mediaType === 'movie' || mediaCategory === 'movies' || fallbackFilter === 'movies') return isAnimeTitle ? 'anime-movie' : 'movie';
  if (mediaType === 'tv' || mediaCategory === 'shows' || mediaCategory === 'anime' || fallbackFilter === 'tv' || fallbackFilter === 'anime') {
    return isAnimeTitle ? 'anime-tv' : 'tv-show';
  }
  return 'title';
}

function getAddShelfResultTypeConfig(item = {}, fallbackFilter = addShelfSearchFilter) {
  const kind = getAddShelfResultKind(item, fallbackFilter);
  const configMap = {
    'movie': { label: 'Movie', badgeClass: 'badge-movie' },
    'tv-show': { label: 'TV Show', badgeClass: 'badge-tv' },
    'anime-tv': { label: 'Anime TV Show', badgeClass: 'badge-anime-tv' },
    'anime-movie': { label: 'Anime Movie', badgeClass: 'badge-anime-movie' },
    'game': { label: 'Game', badgeClass: 'badge-game' },
    'manga': { label: 'Manga', badgeClass: 'badge-manga' },
    'book': { label: 'Book', badgeClass: 'badge-book' },
    'title': { label: 'Title', badgeClass: 'badge-generic' }
  };
  return configMap[kind] || configMap.title;
}

function buildAddShelfResultMeta(item = {}, detail = '', fallbackFilter = addShelfSearchFilter) {
  const typeConfig = getAddShelfResultTypeConfig(item, fallbackFilter);
  const cleanDetail = String(detail || '').trim();
  return cleanDetail ? `${typeConfig.label} · ${cleanDetail}` : typeConfig.label;
}

async function searchUniversalShelf(searchToken = 0) {
  const query = (document.getElementById("inp-tmdb-search")?.value || '').trim();
  if (!query) return;
  const resultsDiv = document.getElementById("tmdb-results");
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '<div class="cover-search-msg">Searching...</div>';
  const filter = addShelfSearchFilter;
  try {
    let hits = [];
    if (filter === 'all') {
      const res = await fetchTmdbProxy('search/multi', { query, include_adult: false });
      const json = await res.json();
      if (searchToken && searchToken !== addTitleSearchRequestToken) return;
      hits = (json.results || [])
        .filter(r => (r.media_type === 'movie' || r.media_type === 'tv') && r.poster_path)
        .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
        .slice(0, 8);
    } else if (filter === 'movies') {
      const res = await fetchTmdbProxy('search/movie', { query });
      const json = await res.json();
      if (searchToken && searchToken !== addTitleSearchRequestToken) return;
      hits = (json.results || [])
        .filter(r => r.poster_path)
        .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
        .slice(0, 8)
        .map(r => ({ ...r, media_type: 'movie' }));
    } else if (filter === 'tv') {
      const res = await fetchTmdbProxy('search/tv', { query });
      const json = await res.json();
      if (searchToken && searchToken !== addTitleSearchRequestToken) return;
      let tvHits = (json.results || [])
        .filter(r => r.poster_path)
        .sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      hits = tvHits.slice(0, 8).map(r => ({ ...r, media_type: 'tv' }));
    } else if (filter === 'anime') {
      /* v654: anime in the Add-to-Shelf modal goes through Jikan only.
         Mapped to a TMDB-compatible shape so the existing result-card
         renderer below still works without further changes. */
      const raw = await window.JikanAnime?.searchAnime(query, 8);
      if (searchToken && searchToken !== addTitleSearchRequestToken) return;
      hits = (raw || []).map(window.JikanAnime?.mapItem).filter(Boolean).slice(0, 8);
    }
    if (hits.length === 0) {
      resultsDiv.innerHTML = '<div class="cover-search-msg">No results found. Try a different search.</div>';
      return;
    }
    resultsDiv.innerHTML = '<div class="tmdb-results">' + hits.map(r => {
      const title = escHtml(r.title || r.name || '');
      const year = (r.release_date || r.first_air_date || '').slice(0, 4);
      const overviewText = String(r.overview || '').trim();
      const overviewSnippet = overviewText ? `${overviewText.slice(0, 80)}${overviewText.length > 80 ? '...' : ''}` : '';
      /* v654: poster_path may be a full https URL (Jikan) or a TMDB path.
         v927: guard against null/undefined poster_path which produced the
         invalid URL "…/w185null" — now returns '' so the onerror hides img. */
      const poster = (typeof r.poster_path === 'string' && /^https?:\/\//.test(r.poster_path))
        ? r.poster_path
        : r.poster_path
          ? `https://image.tmdb.org/t/p/w185${r.poster_path}`
          : '';
      const mType = r.media_type || 'tv';
      const typeConfig = getAddShelfResultTypeConfig(r, filter);
      const badge = `<span class="shelf-result-badge ${typeConfig.badgeClass}">${typeConfig.label}</span>`;
      const meta = escHtml(buildAddShelfResultMeta(r, overviewSnippet, filter));
      /* v654: Jikan-sourced anime items route to selectJikanAnime(mal_id)
         so we don't try to resolve them through TMDB. */
      const onclickAttr = r.__jikan
        ? `selectJikanAnime(${r.__mal_id})`
        : `selectTMDB(${r.id}, '${mType}')`;
      return `<div class="tmdb-result" onclick="${onclickAttr}">
        ${poster ? `<img src="${escAttr(poster)}" loading="lazy" alt="" onerror="this.style.display='none'">` : `<div style="width:44px;height:66px;border-radius:3px;background:rgba(255,255,255,0.06);flex-shrink:0;"></div>`}
        <div class="tmdb-result-info">
          <div class="tmdb-result-title">${title} ${year ? '(' + year + ')' : ''} ${badge}</div>
          <div class="tmdb-result-meta">${meta}</div>
        </div>
      </div>`;
    }).join('') + '</div>';
  } catch(e) {
    if (resultsDiv) resultsDiv.innerHTML = '<div class="cover-search-msg">Search failed. Try again.</div>';
  }
}

function selectManualReadingTitle() {
  const input = document.getElementById("inp-tmdb-search");
  const title = (input?.value || '').trim();
  const resultsDiv = document.getElementById("tmdb-results");
  const targetSection = getAddShelfSectionForFilter(addShelfSearchFilter);
  if (!title) {
    if (resultsDiv) resultsDiv.innerHTML = `<div class="cover-search-msg">Enter a ${getSectionLabel(targetSection, true)} title first.</div>`;
    return;
  }
  selectedTmdb = {
    title,
    cover: '',
    genre: targetSection === 'manga' ? 'Manga' : 'Book',
    year: '',
    source: 'manual',
    mediaCategory: targetSection,
    librarySection: targetSection,
    episodes: []
  };
  rememberAddShelfSelectionState(selectedTmdb);
  renderAddShelfSelectedPreview(selectedTmdb);
  showModalStatusPicker();
  updateAddShelfModalSelectionLayout(true);
  setModalBackBtn(true);
}

async function searchRAWG(searchToken = 0) {
  const query = document.getElementById("inp-tmdb-search").value.trim();
  if (!query) return;
  const resultsDiv = document.getElementById("tmdb-results");
  resultsDiv.innerHTML = '<div class="cover-search-msg">Searching...</div>';
  try {
    /* v930: IGDB is now primary, RAWG is fallback. Both run in parallel,
       merged, deduped, then ranked: text-match > popularity > recency. */
    const hits = await fetchMergedGameSearchResults(query, 15);
    if (searchToken && searchToken !== addTitleSearchRequestToken) return;
    if (hits.length === 0) {
      resultsDiv.innerHTML = '<div class="cover-search-msg">No results found. Try a different search.</div>';
      return;
    }
    resultsDiv.innerHTML = '<div class="tmdb-results">' + buildMergedGameResultsHtml(hits) + '</div>';
  } catch(e) {
    resultsDiv.innerHTML = '<div class="cover-search-msg">Search failed.</div>';
  }
}

/* ═══════════════════════════════════════════════════════════════
   v930: Shared game-search utilities — IGDB primary, RAWG fallback
   ═══════════════════════════════════════════════════════════════ */

/**
 * Score a game result for search ranking.
 * Priority: (1) text match  (2) popularity  (3) newer release date
 * Returns 0 if the item has NO meaningful match — caller must filter these out.
 */
const _GAME_SEARCH_STOP_WORDS = new Set([
  'the','a','an','in','of','and','or','for','to','is','at','by','on',
  'as','it','be','do','so','if','no','up','was','are','with','its','vs'
]);
function scoreGameForSearch(item, query) {
  const name = String(item.name || '').trim().toLowerCase();
  const q    = String(query   || '').trim().toLowerCase();

  // Strip stop words to get meaningful search tokens; fall back to all
  // tokens if the query is entirely stop words.
  const allWords = q.split(/\s+/).filter(w => w.length > 0);
  const meaningful = allWords.filter(w => w.length > 2 && !_GAME_SEARCH_STOP_WORDS.has(w));
  const matchWords = meaningful.length > 0 ? meaningful : allWords.filter(w => w.length > 1);

  if (!matchWords.length) return 0;

  // Tier 1 — text match (dominant; each point = 10 000)
  // Returns 0 when NO meaningful word from the query appears in the title —
  // so "Prince of Persia" gets 0 for query "mlb the show 09" and is excluded.
  let textScore = 0;
  if (name === q) textScore = 4;
  else if (name.startsWith(q)) textScore = 3;
  else if (matchWords.every(w => name.includes(w))) textScore = 2;
  else if (matchWords.some(w => name.includes(w))) textScore = 1;

  if (textScore === 0) return 0; // no match — caller filters this out

  // Tier 2 — recency (0-1000; newer = higher)
  // e.g. 2026 → 1000, 2025 → 960, 2020 → 760, 2010 → 360
  const currentYear = new Date().getFullYear();
  const year = Number(String(item.released || '').slice(0, 4)) || 0;
  const recencyScore = year > 1990 ? Math.max(0, 1000 - (currentYear - year) * 40) : 0;

  // Tier 3 — popularity (0-10)
  const pop = Number(item.total_rating_count || 0)
            + Number(item.ratings_count || 0)
            + Number(item.added || 0) * 0.1;
  const popScore = Math.min(10, Math.log10(Math.max(1, pop + 1)) * 2);

  return textScore * 10000 + recencyScore + popScore;
}

/** Normalise an IGDB game record to the same shape RAWG returns so
 *  both sources can go through the same renderer/ranker. */
function normaliseIgdbGameToRawg(g) {
  return {
    id:            g.id,
    name:          g.name || '',
    released:      g.released || '',
    background_image: g.cover || '',
    rating:        g.total_rating ? g.total_rating / 20 : 0,
    ratings_count: g.total_rating_count || 0,
    added:         g.total_rating_count || 0,
    platforms:     (g.platforms || []).map(p => ({ platform: { name: p } })),
    genres:        (g.genres    || []).map(n => ({ name: n })),
    slug:          g.slug || '',
    source:        'igdb',
    igdbId:        g.id,
    igdbSlug:      g.slug || '',
    igdbCover:     g.cover || '',
    overview:      g.summary || ''
  };
}

/**
 * Fetch from IGDB + RAWG in parallel, merge, dedupe by lowercase name,
 * rank by the 3-tier score, and return up to `limit` results.
 * IGDB is authoritative — its records are listed first in the pool so
 * when deduping a same-name clash the IGDB record wins.
 */
async function fetchMergedGameSearchResults(query, limit = 15) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return [];

  const [igdbSettled, rawgSettled] = await Promise.allSettled([
    fetch(`/api/igdb/search?q=${encodeURIComponent(cleanQuery)}&limit=20`)
      .then(r => r.ok ? r.json() : { ok: false, results: [] })
      .then(j => (j.ok && Array.isArray(j.results) ? j.results : []).map(normaliseIgdbGameToRawg)),
    fetchRawgProxy('games', { search: cleanQuery, page_size: 20, ordering: '-released' })
      .then(r => r.json())
      .then(j => (Array.isArray(j.results) ? j.results : []).map(r => ({ ...r, source: r.source || 'rawg' })))
      .catch(() => [])
  ]);

  const pinnedItems = getPinnedGameSearchResults(cleanQuery);
  const igdbItems = igdbSettled.status === 'fulfilled' ? igdbSettled.value : [];
  const rawgItems = rawgSettled.status === 'fulfilled' ? rawgSettled.value : [];

  // Merge: exact competitive pins first, then IGDB (authoritative), then RAWG extras.
  const seen = new Set();
  const merged = [];
  for (const item of [...pinnedItems, ...igdbItems, ...rawgItems]) {
    const key = String(item.name || '').trim().toLowerCase();
    if (key && !seen.has(key)) { seen.add(key); merged.push(item); }
  }

  return merged
    .map(item => ({ ...item, _score: scoreGameForSearch(item, cleanQuery) }))
    .filter(item => item._score > 0)   /* drop non-matching results */
    .sort((a, b) => Number(!!b._pinnedGameSearch) - Number(!!a._pinnedGameSearch) || b._score - a._score)
    .slice(0, limit);
}

/** Render merged IGDB + RAWG results — routes click to the right handler. */
function buildMergedGameResultsHtml(hits) {
  return hits.map(r => {
    const isIgdb = r.source === 'igdb';
    const title = escHtml(r.name || '');
    const year  = (r.released || '').slice(0, 4);
    const platforms = (r.platforms || []).map(p => typeof p === 'string' ? p : (p?.platform?.name || '')).filter(Boolean).slice(0, 3).join(', ');
    const poster = r.background_image || '';
    const posterThumb = poster
      ? `<img src="${escAttr(poster)}" loading="lazy" alt="" onerror="this.style.display='none'" style="width:44px;height:66px;border-radius:3px;object-fit:cover;flex-shrink:0;">`
      : `<div style="width:44px;height:66px;border-radius:3px;background:rgba(255,255,255,0.06);flex-shrink:0;"></div>`;
    const typeConfig = getAddShelfResultTypeConfig({ ...r, source: 'rawg', rawgId: r.id }, 'games');
    const badge = `<span class="shelf-result-badge ${typeConfig.badgeClass}">${typeConfig.label}</span>`;
    const meta  = escHtml(buildAddShelfResultMeta({ ...r, source: 'rawg', rawgId: r.id }, platforms, 'games'));
    // IGDB items: use selectRAWGFromIGDB; RAWG items: use selectRAWG
    const onclick = isIgdb
      ? `selectRAWGFromIGDB(${JSON.stringify({id:r.igdbId,name:r.name,released:r.released,cover:r.igdbCover||r.background_image||'',slug:r.igdbSlug||r.slug||'',genres:(r.genres||[]).map(g=>typeof g==='string'?g:g.name).filter(Boolean),platforms:(r.platforms||[]).map(p=>typeof p==='string'?p:p?.platform?.name||'').filter(Boolean),summary:r.overview||''}).replace(/"/g,'&quot;')})`
      : `selectRAWG(${r.id})`;
    return `<div class="tmdb-result" onclick="${onclick}">
      ${posterThumb}
      <div class="tmdb-result-info">
        <div class="tmdb-result-title">${title} ${year ? '(' + year + ')' : ''} ${badge}</div>
        <div class="tmdb-result-meta">${meta}</div>
      </div>
    </div>`;
  }).join('');
}

/* legacy helper kept for any direct callers */
function buildRAWGResultsHtml(hits) { return buildMergedGameResultsHtml(hits); }

/* v929: handle selection of an IGDB-sourced game result */
async function selectRAWGFromIGDB(igdbGame) {
  const resultsDiv = document.getElementById("tmdb-results");
  const searchSnapshot = captureAddShelfSearchSnapshot();
  resultsDiv.innerHTML = '<div class="cover-search-msg">Loading details...</div>';
  try {
    const title = igdbGame.name || '';
    const cover = igdbGame.cover || '';
    const genres = Array.isArray(igdbGame.genres) ? igdbGame.genres.join(', ') : '';
    const platforms = Array.isArray(igdbGame.platforms) ? igdbGame.platforms.join(', ') : '';
    const year = (igdbGame.released || '').slice(0, 4);
    selectedTmdb = {
      title,
      cover,
      igdbCoverUrl: cover,
      genre: genres || platforms || 'Game',
      year,
      status: '',
      rating: 0,
      dateAdded: new Date().toISOString(),
      source: 'rawg',
      rawgId: '',
      rawgSlug: igdbGame.slug || '',
      backloggdSlug: igdbGame.slug || '',
      mediaCategory: 'games',
      librarySection: 'games',
      platforms: platforms,
      stores: [],
      metacritic: '',
      metacriticSlug: '',
      overview: igdbGame.summary || ''
    };
    rememberAddShelfSelectionState(selectedTmdb, searchSnapshot);
    renderAddShelfSelectedPreview(selectedTmdb);
    showModalStatusPicker();
    updateAddShelfModalSelectionLayout(true);
    setModalBackBtn(true);
  } catch (e) {
    if (resultsDiv) resultsDiv.innerHTML = '<div class="cover-search-msg">Could not load game details. Try again.</div>';
  }
}

async function selectRAWG(id) {
  const resultsDiv = document.getElementById("tmdb-results");
  const searchSnapshot = captureAddShelfSearchSnapshot();
  resultsDiv.innerHTML = '<div class="cover-search-msg">Loading details...</div>';
  try {
    const res = await fetchRawgProxy(`games/${id}`);
    const d = await res.json();
    const title = d.name || '';
    const cover = d.background_image || '';
    const genres = (d.genres || []).map(g => g.name).join(', ');
    const year = (d.released || '').slice(0, 4);
    const platforms = (d.platforms || []).map(p => p.platform.name).join(', ');

    selectedTmdb = {
      title,
      cover,
      genre: genres,
      year,
      platforms,
      metacritic: d.metacritic || '',
      metacriticSlug: d.slug || '',
      rawgId: String(id),
      rawgSlug: d.slug || '',
      backloggdSlug: d.slug || '',
      source: 'rawg',
      stores: Array.isArray(d.stores) ? d.stores : [],
      mediaCategory: 'games',
      librarySection: 'games',
      igdbCoverUrl: ''
    };

    // Fetch IGDB portrait cover in background while user picks status
    try {
      const igdbRes = await fetch('/api/igdb/cover?title=' + encodeURIComponent(title));
      if (igdbRes.ok) {
        const igdbData = await igdbRes.json();
        if (igdbData.ok && igdbData.coverUrl) selectedTmdb.igdbCoverUrl = igdbData.coverUrl;
      }
    } catch (e) { /* silent — falls back to RAWG landscape cover */ }

    rememberAddShelfSelectionState(selectedTmdb, searchSnapshot);
    renderAddShelfSelectedPreview(selectedTmdb);
    showModalStatusPicker();
    updateAddShelfModalSelectionLayout(true);
    setModalBackBtn(true);
  } catch(e) {
    resultsDiv.innerHTML = '<div class="cover-search-msg">Failed to load details. Try again.</div>';
  }
}

async function searchTMDB(searchToken = 0) {
  const query = document.getElementById("inp-tmdb-search").value.trim();
  if (!query) return;
  const resultsDiv = document.getElementById("tmdb-results");
  resultsDiv.innerHTML = '<div class="cover-search-msg">Searching...</div>';
  try {
    const type = getTmdbTypeForAddShelfFilter();
    const res = await fetchTmdbProxy(`search/${type}`, { query });
    const json = await res.json();
    if (searchToken && searchToken !== addTitleSearchRequestToken) return;
    const hits = (json.results || []).filter(r => r.poster_path).slice(0, 6);
    if (hits.length === 0) {
      resultsDiv.innerHTML = '<div class="cover-search-msg">No results found. Try a different search.</div>';
      return;
    }
    resultsDiv.innerHTML = '<div class="tmdb-results">' + hits.map(r => {
      const title = escHtml(r.title || r.name || '');
      const year = (r.release_date || r.first_air_date || '').slice(0, 4);
      const overview = escHtml((r.overview || '').slice(0, 80)) + (r.overview && r.overview.length > 80 ? '...' : '');
      const poster = r.poster_path ? `https://image.tmdb.org/t/p/w185${r.poster_path}` : '';
      return `<div class="tmdb-result" onclick="selectTMDB(${r.id})">
        ${poster ? `<img src="${poster}" loading="lazy" alt="" onerror="this.style.display='none'">` : `<div style="width:44px;height:66px;border-radius:3px;background:rgba(255,255,255,0.06);flex-shrink:0;"></div>`}
        <div class="tmdb-result-info">
          <div class="tmdb-result-title">${title} ${year ? '(' + year + ')' : ''}</div>
          <div class="tmdb-result-meta">${overview}</div>
        </div>
      </div>`;
    }).join("") + '</div>';
  } catch(e) {
    resultsDiv.innerHTML = '<div class="cover-search-msg">Search failed. Try again.</div>';
  }
}

async function selectTMDB(id, knownType = null) {
  const type = knownType || getTmdbTypeForAddShelfFilter();
  const resultsDiv = document.getElementById("tmdb-results");
  const searchSnapshot = captureAddShelfSearchSnapshot();
  resultsDiv.innerHTML = '<div class="cover-search-msg">Loading details...</div>';
  try {
    const res = await fetchTmdbProxy(`${type}/${id}`);
    const d = await res.json();
    const title = d.title || d.name || '';
    const cover = d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : '';
    const genres = (d.genres || []).map(g => g.name).join(', ');
    const year = (d.release_date || d.first_air_date || '').slice(0, 4);

    const genreNames = (d.genres || []).map(g => g.name).filter(Boolean);
    selectedTmdb = {
      title,
      cover,
      genre: genres,
      genreNames,
      year,
      tmdbId: String(id),
      originalTitle: d.original_name || d.original_title || '',
      originalLanguage: d.original_language || '',
      originCountries: Array.isArray(d.origin_country) ? d.origin_country : []
    };
    if (type === "tv") {
      selectedTmdb.mediaCategory = detectAnimeFromMetadata(selectedTmdb) ? 'anime' : 'shows';
      selectedTmdb.librarySection = selectedTmdb.mediaCategory;
      selectedTmdb.isAnime = selectedTmdb.mediaCategory === 'anime';
      const nextEpisode = typeof normalizeMyListTmdbNextEpisodeMetadata === 'function'
        ? normalizeMyListTmdbNextEpisodeMetadata(d)
        : null;
      if (nextEpisode?.airDate) {
        selectedTmdb.nextEpisodeAirDate = nextEpisode.airDate;
        selectedTmdb.next_episode_to_air = nextEpisode.episode;
      }
    } else {
      selectedTmdb.mediaCategory = 'movies';
      selectedTmdb.librarySection = 'movies';
      selectedTmdb.isAnime = false;
    }

    // Get IMDb ID
    if (type === "movie" && d.imdb_id) {
      selectedTmdb.imdbId = d.imdb_id;
    } else if (type === "tv") {
      try {
        const extRes = await fetchTmdbProxy(`tv/${id}/external_ids`);
        const extData = await extRes.json();
        if (extData.imdb_id) selectedTmdb.imdbId = extData.imdb_id;
      } catch(e) {}
    }

    if (type === "tv") {
      if (selectedTmdb.isAnime) await hydrateAnimeTitleVariants(selectedTmdb);
      // Fetch episodes by season. Anime season metadata stays attached to one series card.
      const seasons = (d.seasons || []).filter(s => s.season_number > 0 && Number(s.episode_count || 0) > 0);
      let allEpisodes = [];
      const animeSeasonItems = [];
      for (const season of seasons) {
        try {
          const sRes = await fetchTmdbProxy(`tv/${id}/season/${season.season_number}`);
          const sData = await sRes.json();
          const seasonStartIndex = allEpisodes.length;
          const seasonDisplayName = sData.name || season.name || '';
          const seasonEpisodes = (sData.episodes || []).map((ep, idx) => ({
            number: seasonStartIndex + idx + 1,
            seasonNum: season.season_number,
            seasonName: seasonDisplayName,
            epNum: ep.episode_number,
            title: ep.name || '',
            airDate: ep.air_date || '',
            air_date: ep.air_date || '',
            cover: (sData.poster_path || season.poster_path) ? `https://image.tmdb.org/t/p/w500${sData.poster_path || season.poster_path}` : '',
          }));
          seasonEpisodes.forEach(ep => allEpisodes.push(ep));
          animeSeasonItems.push({
            seasonNum: season.season_number,
            season_number: season.season_number,
            name: sData.name || season.name || `Season ${season.season_number}`,
            airDate: sData.air_date || season.air_date || '',
            cover: (sData.poster_path || season.poster_path) ? `https://image.tmdb.org/t/p/w500${sData.poster_path || season.poster_path}` : '',
            episodes: seasonEpisodes
          });
        } catch(e) {}
      }
      selectedTmdb.episodes = allEpisodes;
      selectedTmdb.totalEpisodes = allEpisodes.length;
      selectedTmdb.seasons = seasons.length;
      selectedTmdb.animeSeasonItems = animeSeasonItems;
    } else if (selectedTmdb.isAnime) {
      await hydrateAnimeTitleVariants(selectedTmdb);
    }

    rememberAddShelfSelectionState(selectedTmdb, searchSnapshot);
    renderAddShelfSelectedPreview(selectedTmdb);
    showModalStatusPicker();
    updateAddShelfModalSelectionLayout(true);
    setModalBackBtn(true);
  } catch(e) {
    resultsDiv.innerHTML = '<div class="cover-search-msg">Failed to load details. Try again.</div>';
  }
}

/* v654: Add-to-Shelf select path for Jikan-sourced anime (no TMDB).
   Builds the same `selectedTmdb` object the rest of the modal expects,
   sourced entirely from Jikan's /anime/{mal_id}/full response. The
   variable name stays `selectedTmdb` for compatibility — that's just
   the in-memory key the modal reads from. */
async function selectJikanAnime(malId) {
  const id = String(malId || '').trim();
  const resultsDiv = document.getElementById("tmdb-results");
  const searchSnapshot = captureAddShelfSearchSnapshot();
  if (resultsDiv) resultsDiv.innerHTML = '<div class="cover-search-msg">Loading anime details...</div>';
  try {
    const J = window.JikanAnime;
    if (!J) throw new Error('Jikan service unavailable');
    const j = await J.animeFull(id);
    if (!j) throw new Error('Empty Jikan response');
    const title = j.title_english || j.title || j.title_japanese || '';
    const cover = (j.images?.jpg?.large_image_url || j.images?.jpg?.image_url || '');
    const genreNames = []
      .concat((j.genres || []).map(g => g.name))
      .concat((j.themes || []).map(g => g.name))
      .concat((j.demographics || []).map(g => g.name))
      .filter(Boolean);
    const genres = genreNames.join(', ');
    const year = String(j.year || (j.aired?.from || '').slice(0, 4) || '');

    selectedTmdb = {
      title,
      cover,
      genre: genres,
      genreNames,
      year,
      tmdbId: '',                            /* anime sourced via Jikan has no TMDB id */
      malId: String(j.mal_id || id),
      source: 'myanimelist',
      originalTitle: j.title_japanese || j.title || '',
      originalLanguage: 'ja',
      originCountries: ['JP'],
      mediaCategory: 'anime',
      librarySection: 'anime',
      isAnime: true,
      titleVariants: {
        english: j.title_english || title,
        romaji: j.title || title,
        japanese: j.title_japanese || ''
      },
      englishTitle: j.title_english || title,
      romajiTitle: j.title || title,
      japaneseTitle: j.title_japanese || ''
    };

    /* Episode count from Jikan. Synthesize episode rows for the tracker. */
    const totalEps = Number(j.episodes || 0);
    selectedTmdb.totalEpisodes = totalEps;
    selectedTmdb.seasons = 1;
    selectedTmdb.episodes = totalEps > 0
      ? Array.from({ length: totalEps }, (_, idx) => ({
          number: idx + 1,
          seasonNum: 1,
          seasonName: '',
          epNum: idx + 1,
          title: '',
          cover
        }))
      : [];
    selectedTmdb.animeSeasonItems = [];

    rememberAddShelfSelectionState(selectedTmdb, searchSnapshot);
    renderAddShelfSelectedPreview(selectedTmdb);
    showModalStatusPicker();
    updateAddShelfModalSelectionLayout(true);
    setModalBackBtn(true);
  } catch (err) {
    console.error('selectJikanAnime failed:', err);
    if (resultsDiv) resultsDiv.innerHTML = '<div class="cover-search-msg">Failed to load anime details. Try again.</div>';
  }
}

function clearSelection() {
  restoreAddShelfSearchResults();
}

const MODAL_STATUS_OPTIONS = {
  shows: [
    { status: 'watching', label: 'Watching' },
    { status: 'planned',  label: 'Watchlist' },
    { status: 'watched',  label: 'Watched' },
    { status: 'paused',   label: 'Paused' }
  ],
  anime: [
    { status: 'watching', label: 'Watching' },
    { status: 'planned',  label: 'Watchlist' },
    { status: 'watched',  label: 'Watched' },
    { status: 'paused',   label: 'Paused' }
  ],
  movies: [
    { status: 'planned',  label: 'Watchlist' },
    { status: 'watched',  label: 'Watched' },
    { status: 'paused',   label: 'Paused' }
  ],
  games: [
    { status: 'watching', label: 'Playing' },
    { status: 'live',     label: 'Live Games' },
    { status: 'planned',  label: 'Backloggd' },
    { status: 'watched',  label: 'Played' },
    { status: 'wishlist', label: 'Wishlist' }
  ],
  manga: [
    { status: 'watching', label: 'Reading' },
    { status: 'planned',  label: 'TBR' },
    { status: 'watched',  label: 'Read' },
    { status: 'paused',   label: 'Paused' }
  ],
  books: [
    { status: 'watching', label: 'Reading' },
    { status: 'planned',  label: 'TBR' },
    { status: 'watched',  label: 'Read' },
    { status: 'paused',   label: 'Paused' }
  ]
};

function showModalStatusPicker() {
  const picker = document.getElementById("modal-status-picker");
  if (!picker) return;
  pendingModalStatusSelection = '';
  modalAddSubmitting = false;
  setAddShelfModalSelectionChoice({ status: '', rating: pendingModalRatingSelection });
  const targetSection = resolveAddShelfSelectedSection(getActiveAddShelfSelectedItem());
  const options = MODAL_STATUS_OPTIONS[targetSection] || MODAL_STATUS_OPTIONS.shows;
  picker.innerHTML = `
    <div class="modal-status-label">Where do you want it?</div>
    <div class="modal-status-grid">
      ${options.map(o => `<button class="modal-status-btn" type="button" onclick="showModalAddConfirmation('${o.status}')">${escHtml(o.label)}</button>`).join('')}
    </div>
  `;
  picker.style.display = "flex";
  setModalBackBtn(true, clearSelection);
}

function renderModalAddConfirmation(status, backHandler = showModalStatusPicker) {
  const picker = document.getElementById('modal-status-picker');
  const selectedItem = getActiveAddShelfSelectedItem();
  if (!picker || !selectedItem) return;
  const targetSection = resolveAddShelfSelectedSection(selectedItem);
  const statusLabel = getAddShelfStatusLabel(status, targetSection);
  const ratingCopy = status === 'watched'
    ? `<div class="modal-status-confirm-copy">Selected rating: <strong>${escHtml(getAddShelfModalRatingValue(pendingModalRatingSelection, targetSection))}</strong></div>`
    : '';
  const confirmCopy = status === 'watched'
    ? `Add this title to <strong>${escHtml(statusLabel)}</strong> with your rating?`
    : `Add this title to <strong>${escHtml(statusLabel)}</strong>?`;
  picker.innerHTML = `
    <div class="modal-status-label">Confirm add</div>
    <div class="modal-status-confirm add-shelf-confirm-panel">
      <div class="modal-status-confirm-title">Ready to add</div>
      <div class="add-shelf-confirm-summary">
        <span class="add-shelf-confirm-chip">${escHtml(statusLabel)}</span>
        ${status === 'watched' ? `<span class="add-shelf-confirm-chip add-shelf-confirm-chip-rating">${escHtml(getAddShelfModalRatingValue(pendingModalRatingSelection, targetSection))}</span>` : ''}
      </div>
      <div class="add-shelf-confirm-readout">${escHtml(selectedItem.title || 'This title')}</div>
      <div class="modal-status-confirm-copy">${confirmCopy}</div>
      ${ratingCopy}
      <div class="modal-status-confirm-actions">
        <button class="btn-secondary modal-status-confirm-back" type="button" onclick="handleAddShelfConfirmBack()">Back</button>
        <button class="btn-primary modal-status-confirm-submit" type="button" onclick="confirmModalAdd()">Confirm</button>
      </div>
    </div>
  `;
  picker.style.display = 'flex';
  setModalBackBtn(true, backHandler);
}

function showModalRatingPrompt(selectedRating = pendingModalRatingSelection) {
  const selectedItem = getActiveAddShelfSelectedItem();
  if (!selectedItem) return;
  pendingModalStatusSelection = 'watched';
  modalAddSubmitting = false;
  setAddShelfModalSelectionChoice({ status: 'watched', rating: selectedRating });
  const picker = document.getElementById('modal-status-picker');
  if (!picker) return;
  const targetSection = resolveAddShelfSelectedSection(selectedItem);
  const stars = typeof buildStandaloneRatingStarsMarkup === 'function'
    ? buildStandaloneRatingStarsMarkup(Number(selectedRating || 0) || 0, targetSection, 'selectAddShelfModalRating')
    : '';
  picker.innerHTML = `
    <div class="modal-status-label">Rate this title</div>
    <div class="discover-rating-prompt add-shelf-rating-prompt">
      <div class="modal-status-confirm-title">Set your rating</div>
      <div class="add-shelf-confirm-readout">${escHtml(selectedItem.title || 'This title')}</div>
      <div class="discover-add-desc">Choose it once here. The next screen is a read-only confirmation.</div>
      ${stars}
      <div class="modal-status-confirm-actions">
        <button class="btn-secondary modal-status-confirm-back" type="button" onclick="showModalStatusPicker()">Back</button>
        <button class="btn-secondary" type="button" onclick="skipAddShelfModalRating()">Skip</button>
        <button class="btn-primary modal-status-confirm-submit" type="button" onclick="confirmAddShelfModalRating()" ${Number(selectedRating || 0) > 0 ? '' : 'disabled'}>Confirm</button>
      </div>
    </div>
  `;
  picker.style.display = 'flex';
  setModalBackBtn(true, showModalStatusPicker);
}

function selectAddShelfModalRating(score) {
  const cleanScore = Math.max(0, Number(score || 0) || 0);
  pendingModalRatingSelection = cleanScore;
  setAddShelfModalSelectionChoice({ status: 'watched', rating: cleanScore });
  showModalRatingPrompt(cleanScore);
}

function skipAddShelfModalRating() {
  pendingModalRatingSelection = 0;
  setAddShelfModalSelectionChoice({ status: 'watched', rating: 0 });
  renderModalAddConfirmation('watched', showModalRatingPrompt);
}

function confirmAddShelfModalRating() {
  if ((Number(pendingModalRatingSelection || 0) || 0) < 1) {
    showToast('Pick a rating or tap Skip.');
    return;
  }
  renderModalAddConfirmation('watched', showModalRatingPrompt);
}

function handleAddShelfConfirmBack() {
  if (pendingModalStatusSelection === 'watched') {
    showModalRatingPrompt(pendingModalRatingSelection);
    return;
  }
  showModalStatusPicker();
}

function showModalAddConfirmation(status) {
  if (!getActiveAddShelfSelectedItem()) return;
  pendingModalStatusSelection = status;
  if (status !== 'watched') pendingModalRatingSelection = 0;
  modalAddSubmitting = false;
  setAddShelfModalSelectionChoice({ status, rating: status === 'watched' ? pendingModalRatingSelection : 0 });
  if (status === 'watched') {
    showModalRatingPrompt(pendingModalRatingSelection);
    return;
  }
  renderModalAddConfirmation(status, showModalStatusPicker);
}

async function confirmModalAdd() {
  const selectedItem = getActiveAddShelfSelectedItem();
  const selectedStatus = addShelfModalSelectionState?.status || pendingModalStatusSelection;
  if (!selectedItem || !selectedStatus || modalAddSubmitting) return;
  const picker = document.getElementById('modal-status-picker');
  const confirmBtn = picker?.querySelector('.modal-status-confirm-submit');
  const backBtn = picker?.querySelector('.modal-status-confirm-back');
  modalAddSubmitting = true;
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Adding...'; }
  if (backBtn) backBtn.disabled = true;
  try {
    const rating = selectedStatus === 'watched'
      ? (Number(addShelfModalSelectionState?.rating ?? pendingModalRatingSelection ?? 0) || 0)
      : 0;
    const result = await submitModal(selectedStatus, rating, selectedItem);
    if (!result?.ok) {
      if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm'; }
      if (backBtn) backBtn.disabled = false;
      return;
    }
    triggerAddShelfSuccessFeedback();
    showToast(result.message || 'Added to your library');
    restoreAddShelfSearchResults();
    flashAddShelfSearchMessage(result.message || 'Added to library');
  } catch (error) {
    console.error('Add to Shelf confirmation failed:', error);
    showToast('Could not add this title. Try again.');
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm'; }
    if (backBtn) backBtn.disabled = false;
  } finally {
    modalAddSubmitting = false;
  }
}

function hideModalStatusPicker() {
  const picker = document.getElementById("modal-status-picker");
  if (!picker) return;
  picker.style.display = "none";
  picker.innerHTML = "";
}

// Modal
function openModal() {
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
  document.getElementById("modal").style.display = "flex";
  document.getElementById("modal-title").textContent = 'Add to Shelf';
  clearTimeout(addTitleLiveSearchTimer);
  addTitleSearchRequestToken++;
  renderApiKeySection();
  resetAddShelfModalHome();
  updateAddShelfModalSelectionLayout(false);
  lockAddShelfModalBackgroundScroll();
}
function closeModal() {
  document.getElementById("modal").style.display = "none";
  resetAddTitleSelection({ clearSearchSnapshot: true });
  setModalBackBtn(false);
  removeAddShelfSearchFlashMessage();
  unlockAddShelfModalBackgroundScroll();
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


function getDuplicateTitleKeys(itemOrTitle = {}) {
  const values = [];
  if (typeof itemOrTitle === 'string') values.push(itemOrTitle);
  else if (itemOrTitle && typeof itemOrTitle === 'object') {
    values.push(itemOrTitle.title, itemOrTitle.name, itemOrTitle.englishTitle, itemOrTitle.romajiTitle, itemOrTitle.japaneseTitle, itemOrTitle.originalTitle);
    const variants = itemOrTitle.titleVariants || {};
    values.push(variants.english, variants.romaji, variants.japanese);
  }
  return new Set(values.map(value => String(value || '').trim().toLowerCase()).filter(Boolean));
}

function isDuplicateTitleInList(title, section, sourceData, excludeId = null) {
  const titleKeys = getDuplicateTitleKeys(title);
  if (!titleKeys.size || !sourceData || !Array.isArray(sourceData[section])) return false;
  return sourceData[section].some(item => {
    if (!item || item.id === excludeId) return false;
    const existingKeys = getDuplicateTitleKeys(item);
    return [...titleKeys].some(key => existingKeys.has(key));
  });
}

function findDuplicateImportItemInList(item = {}, entry = {}, section, sourceData, excludeId = null) {
  if (!sourceData || !Array.isArray(sourceData[section])) return null;
  const malId = String(item.malId || entry.malId || '').trim();
  if (malId) {
    const malMatch = sourceData[section].find(existing => existing && existing.id !== excludeId && String(existing.malId || '').trim() === malId);
    if (malMatch) return malMatch;
  }
  const titleKeys = getDuplicateTitleKeys(item);
  if (!titleKeys.size) return null;
  return sourceData[section].find(existing => {
    if (!existing || existing.id === excludeId) return false;
    const existingKeys = getDuplicateTitleKeys(existing);
    return [...titleKeys].some(key => existingKeys.has(key));
  }) || null;
}

function isDuplicateImportItemInList(item = {}, entry = {}, section, sourceData, excludeId = null) {
  return !!findDuplicateImportItemInList(item, entry, section, sourceData, excludeId);
}

function repairDuplicateImportItem(existing = {}, incoming = {}, entry = {}, section = '') {
  if (!existing || !incoming) return false;
  let changed = false;
  const fill = (key, value) => {
    if ((existing[key] === undefined || existing[key] === null || existing[key] === '' || (Array.isArray(existing[key]) && existing[key].length === 0)) &&
        value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length)) {
      existing[key] = value;
      changed = true;
    }
  };

  fill('cover', incoming.cover || entry.cover || '');
  fill('malId', incoming.malId || entry.malId || '');
  fill('genre', incoming.genre || '');
  fill('genreNames', incoming.genreNames || []);
  fill('year', incoming.year || '');
  fill('mediaCategory', incoming.mediaCategory || (section || 'anime'));
  fill('librarySection', incoming.librarySection || (section || 'anime'));
  fill('source', incoming.source || entry.source || '');
  fill('steamAppId', incoming.steamAppId || entry.steamAppId || '');
  fill('steamUrl', incoming.steamUrl || entry.steamUrl || '');
  fill('igdbCoverUrl', incoming.igdbCoverUrl || entry.igdbCoverUrl || '');
  fill('coverProvider', incoming.coverProvider || '');
  fill('coverSource', incoming.coverSource || '');
  const existingCoverLocked = !!(existing.coverLocked || String(existing.userSelectedGameCover || '').trim() || String(existing.customCover || '').trim() || String(existing.selectedCover || '').trim());
  if (!existingCoverLocked && incoming.igdbCoverUrl && (!existing.cover || !/images\.igdb\.com\/igdb\/image\/upload/i.test(String(existing.cover || '')))) {
    existing.cover = incoming.igdbCoverUrl;
    changed = true;
  }
  fill('titleVariants', incoming.titleVariants || null);
  fill('englishTitle', incoming.englishTitle || '');
  fill('romajiTitle', incoming.romajiTitle || '');
  fill('japaneseTitle', incoming.japaneseTitle || '');
  fill('originalTitle', incoming.originalTitle || '');
  fill('originalLanguage', incoming.originalLanguage || '');
  fill('originCountries', incoming.originCountries || []);

  const incomingTotal = Number(incoming.totalEps || incoming.totalEpisodes || entry.totalEpisodes || 0);
  if (incomingTotal && !Number(existing.totalEps || existing.totalEpisodes || 0)) {
    existing.totalEps = incomingTotal;
    existing.totalEpisodes = incomingTotal;
    changed = true;
  }
  const existingHours = Number(existing.gameHoursPlayed || existing.gameHours || existing.hoursPlayed || existing.playtimeHours || 0);
  const incomingHours = Number(incoming.gameHoursPlayed || incoming.gameHours || incoming.hoursPlayed || incoming.playtimeHours || entry.playtimeHours || 0);
  if (incomingHours > existingHours) {
    const normalizedHours = String(Math.round(incomingHours * 10) / 10);
    existing.gameHoursPlayed = normalizedHours;
    existing.gameHours = normalizedHours;
    existing.hoursPlayed = normalizedHours;
    existing.playtimeHours = normalizedHours;
    changed = true;
  }
  if (section === 'anime' || String(incoming.source || entry.source || '').toLowerCase() === 'myanimelist') {
    // v451: respect per-item preserveEpisodes opt-out so a re-import doesn't
    // wipe per-episode state the user has already filled in.
    if (existing.preserveEpisodes !== true) {
      if (!existing.bulkImportCompact) { existing.bulkImportCompact = true; changed = true; }
      if (!Array.isArray(existing.episodes) || existing.episodes.length) { existing.episodes = []; changed = true; }
    }
  }
  return changed;
}


function getDiscoverLibraryMatch(title, section, sourceData = null) {
  const normalized = (title || '').trim().toLowerCase();
  const library = sourceData || (viewingUser && myData ? myData : data);
  if (!normalized || !library || !Array.isArray(library[section])) return null;
  return library[section].find(item =>
    item &&
    (item.title || '').trim().toLowerCase() === normalized
  ) || null;
}

function getDiscoverLibraryStatusLabel(status, section) {
  const normalized = String(status || '').trim().toLowerCase();
  const options = (typeof MODAL_STATUS_OPTIONS !== 'undefined' && MODAL_STATUS_OPTIONS[section]) ? MODAL_STATUS_OPTIONS[section] : [];
  const match = options.find(option => option.status === normalized);
  if (match) return match.label;
  if (normalized === 'watched') return 'Watched';
  if (normalized === 'watching') return 'Watching';
  if (normalized === 'planned') return 'Watchlist';
  if (normalized === 'paused') return 'Paused';
  if (normalized === 'dropped') return 'Dropped';
  if (normalized === 'live') return 'Live Games';
  return 'Added';
}

function getDiscoverLibraryButtonText(title, section, fallbackStatus = '') {
  const match = getDiscoverLibraryMatch(title, section);
  return getDiscoverLibraryStatusLabel(fallbackStatus || match?.status || '', section);
}

function sanitizeFriendCopy(source, section, status = 'planned', rating = 0) {
  const item = JSON.parse(JSON.stringify(source || {}));
  const newId = Date.now().toString() + '-friend-' + Math.random().toString(36).slice(2, 7);
  item.id = newId;
  item.status = status;
  item.rating = rating;
  item.dateAdded = new Date().toISOString();
  if (isShowSection(section)) {
    item.seasonRatings = {};
    item.episodes = (item.episodes || []).map((ep, i) => ({
      ...ep,
      id: newId + '-ep-' + (i + 1),
      watched: status === 'watched',
      rating: 0,
    }));
    item.totalEpisodes = item.episodes.length;
    item.totalEps = item.episodes.length;
    item.currentEp = status === 'watched' ? item.episodes.length : 0;
  }
  return item;
}

let pendingFriendAdd = null;

function openFriendAddModal(itemId, btn) {
  if (!viewingUser || !currentUser || !myData || !friendViewData) return;
  const section = activeSection;
  const source = (friendViewData[section] || []).find(item => item.id === itemId);
  if (!source) return;

  if (isDuplicateTitleInList(source.title, section, myData)) {
    showToast("this title is already added to your library silly!");
    if (btn) {
      btn.textContent = '✓';
      btn.classList.add('added');
    }
    return;
  }

  pendingFriendAdd = { itemId, btn };
  renderFriendAddChoice();
  document.getElementById('discover-add-modal').style.display = 'flex';
}

function renderFriendAddChoice() {
  const content = document.getElementById('discover-add-modal-content');
  if (!content || !pendingFriendAdd) return;
  const isGame = activeSection === 'games';
  const watchedLabel = isGame ? 'Played' : 'Watched';
  const plannedLabel = isGame ? 'Backloggd' : 'Watchlist';
  const wishlistButton = isGame ? `<button class="discover-status-btn wishlist-option" onclick="confirmFriendAdd('wishlist')">Wishlist</button>` : '';
  content.innerHTML = `
    <h3>Add to Library</h3>
    <div class="discover-add-desc">Where you bouta put this?</div>
    <div class="discover-status-options">
      <button class="discover-status-btn watched-option" onclick="confirmFriendAdd('watched')">${watchedLabel}</button>
      <button class="discover-status-btn planned-option" onclick="confirmFriendAdd('planned')">${plannedLabel}</button>
      ${wishlistButton}
    </div>
    <div class="modal-actions">
      <button class="btn-secondary discover-cancel-btn" onclick="closeDiscoverAddModal()">Cancel</button>
    </div>
  `;
}

function confirmFriendAdd(status) {
  if (!pendingFriendAdd) return;
  if (status === 'watched') {
    renderFriendRatingPrompt(0);
    return;
  }
  finalizeFriendAdd(status, 0);
}

function renderFriendRatingPrompt(selectedRating = 0) {
  const content = document.getElementById('discover-add-modal-content');
  if (!content || !pendingFriendAdd) return;
  const skipLabel = activeSection === 'games' ? 'completed' : 'watched';
  const stars = buildStandaloneRatingStarsMarkup(selectedRating, activeSection, 'selectFriendRating');
  content.innerHTML = `
    <div class="discover-rating-prompt">
      <h3>Rate this Title</h3>
      <div class="discover-add-desc">Choose a rating, or skip and add it as ${skipLabel}.</div>
      ${stars}
      <div class="modal-actions">
        <button class="btn-secondary" onclick="renderFriendAddChoice()">Back</button>
        <button class="btn-secondary" onclick="finalizeFriendAdd('watched', 0)">Skip</button>
      </div>
    </div>
  `;
}

function selectFriendRating(score) {
  if (!pendingFriendAdd || pendingFriendAdd.ratingLock) return;
  pendingFriendAdd.ratingLock = true;
  const container = document.querySelector('#discover-add-modal .discover-rating-stars');
  if (container) {
    container.dataset.discoverRating = score;
    container.querySelectorAll('.star-btn').forEach((star, index) => {
      const lit = index + 1 <= score;
      star.classList.toggle('lit', lit);
      star.style.color = lit ? '#f59e0b' : '#443d60';
      star.style.transform = 'scale(1)';
    });
    let label = container.querySelector('.star-label');
    if (!label) {
      label = document.createElement('span');
      label.className = 'star-label';
      container.appendChild(label);
    }
    label.textContent = formatRatingValueForSection(score, activeSection);
    const animationMs = playDiscoveryModalRatingAnimation(score, container);
    setTimeout(() => finalizeFriendAdd('watched', score), animationMs);
    return;
  }
  finalizeFriendAdd('watched', score);
}

async function finalizeFriendAdd(status, rating = 0) {
  if (!pendingFriendAdd) return;
  const pending = pendingFriendAdd;
  document.getElementById('discover-add-modal').style.display = 'none';
  pendingFriendAdd = null;
  await addFriendTitleToMyList(pending.itemId, pending.btn, status, rating);
}

async function addFriendTitleToMyList(itemId, btn, status = 'planned', rating = 0) {
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
  if (!viewingUser || !currentUser || !friendViewData) return;
  const section = activeSection;
  const source = (friendViewData[section] || []).find(item => item.id === itemId);
  if (!source) return;

  const targetData = myData ? cloneListData(myData) : (ownDataCache ? cloneListData(ownDataCache) : await loadOwnDataFromFirestore());
  if (isDuplicateTitleInList(source.title, section, targetData)) {
    showToast("this title is already added to your library silly!");
    if (btn) {
      btn.textContent = '✓';
      btn.classList.add('added');
    }
    return;
  }

  const item = sanitizeFriendCopy(source, section, status, rating);
  targetData[section] = Array.isArray(targetData[section]) ? targetData[section] : [];
  targetData[section].push(item);

  if (btn) {
    btn.textContent = '✓';
    btn.classList.add('added');
  }

  try {
    await writeOwnDataDirect(targetData);
    myData = cloneListData(targetData);
    playLibraryAddPopSound();
    showToast("Added to your library");
    const result = { ok: true, item: { ...item }, section, status, rating: Number(rating || 0) || 0, source: 'friend-list-add' };
    if (status === 'watched' && typeof openScreenListActivityPostPrompt === 'function') {
      window.setTimeout(() => openScreenListActivityPostPrompt(result), 120);
    }
    return result;
  } catch(e) {
    console.error("Friend profile add failed:", e);
    if (btn) {
      btn.textContent = '+';
      btn.classList.remove('added');
    }
    showToast("Could not add this title. Try again.");
    return { ok: false };
  }
}

async function submitModal(status, rating = 0, itemOverride = null) {
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return { ok: false };
  const selectedItem = itemOverride || getActiveAddShelfSelectedItem() || selectedTmdb;
  if (!selectedItem) return { ok: false };
  const targetSection = resolveAddShelfSelectedSection(selectedItem);
  const validStatuses = (MODAL_STATUS_OPTIONS[targetSection] || []).map(o => o.status);
  if (!validStatuses.includes(status)) status = getDefaultTabForSection(targetSection);
  const targetData = ownDataCache ? cloneListData(ownDataCache) : cloneListData(data);
  targetData[targetSection] = Array.isArray(targetData[targetSection]) ? targetData[targetSection] : [];
  const isAnimeSeriesAdd = targetSection === 'anime' && (selectedItem.isAnime || selectedItem.mediaCategory === 'anime') && selectedItem.tmdbId;
  const cleanedAnimeList = isAnimeSeriesAdd ? removeAnimeSeasonSplitEntries(targetData[targetSection], selectedItem) : targetData[targetSection];
  const removedSplitAnimeEntries = isAnimeSeriesAdd && cleanedAnimeList.length !== targetData[targetSection].length;
  if (isAnimeSeriesAdd) targetData[targetSection] = cleanedAnimeList;

  if (isDuplicateTitleInList(selectedItem.title, targetSection, targetData)) {
    if (removedSplitAnimeEntries) {
      await writeOwnDataDirect(targetData);
      render();
    }
    showToast("this title is already added to your library silly!");
    return { ok: false, duplicate: true };
  }

  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: selectedItem.title,
    cover: selectedItem.cover,
    igdbCoverUrl: selectedItem.igdbCoverUrl || '',
    genre: selectedItem.genre,
    year: selectedItem.year || '',
    status,
    rating: Number(rating || 0) || 0,
    dateAdded: new Date().toISOString(),
    imdbId: selectedItem.imdbId || '',
    platforms: selectedItem.platforms || '',
    metacritic: selectedItem.metacritic || '',
    metacriticSlug: selectedItem.metacriticSlug || '',
    rawgId: selectedItem.rawgId || '',
    rawgSlug: selectedItem.rawgSlug || '',
    backloggdSlug: selectedItem.backloggdSlug || selectedItem.rawgSlug || selectedItem.metacriticSlug || '',
    source: selectedItem.source || (targetSection === 'games' ? 'rawg' : ''),
    stores: Array.isArray(selectedItem.stores) ? selectedItem.stores : [],
    tmdbId: selectedItem.tmdbId || '',
    mediaCategory: selectedItem.mediaCategory || targetSection,
    librarySection: selectedItem.librarySection || selectedItem.mediaCategory || targetSection,
    originalTitle: selectedItem.originalTitle || '',
    originalLanguage: selectedItem.originalLanguage || '',
    originCountries: Array.isArray(selectedItem.originCountries) ? selectedItem.originCountries : [],
    genreNames: Array.isArray(selectedItem.genreNames) ? selectedItem.genreNames : [],
    isAnime: (selectedItem.mediaCategory || '') === 'anime',
    titleVariants: normalizeAnimeTitleVariants(selectedItem.titleVariants, selectedItem.title || ''),
    englishTitle: selectedItem.englishTitle || selectedItem.titleVariants?.english || '',
    romajiTitle: selectedItem.romajiTitle || selectedItem.titleVariants?.romaji || '',
    japaneseTitle: selectedItem.japaneseTitle || selectedItem.titleVariants?.japanese || '',
    nextEpisodeAirDate: selectedItem.nextEpisodeAirDate || '',
    next_episode_to_air: selectedItem.next_episode_to_air || null,
  };
  if (isShowSection(targetSection) && selectedItem.episodes) {
    item.totalEpisodes = selectedItem.totalEpisodes;
    item.episodes = selectedItem.episodes.map((ep, i) => ({
      id: item.id + '-ep-' + (i + 1),
      number: ep.number,
      seasonNum: ep.seasonNum,
      seasonName: ep.seasonName || '',
      epNum: ep.epNum,
      title: ep.title,
      airDate: ep.airDate || ep.air_date || '',
      air_date: ep.air_date || ep.airDate || '',
      cover: ep.cover || '',
      watched: status === 'watched',
      rating: 0,
    }));
    if (Array.isArray(selectedItem.animeSeasonItems) && selectedItem.animeSeasonItems.length) {
      item.seasonsInfo = selectedItem.animeSeasonItems.map(season => ({
        seasonNum: season.seasonNum || season.season_number || 0,
        season_number: season.season_number || season.seasonNum || 0,
        name: season.name || '',
        title: season.name || '',
        cover: season.cover || '',
        airDate: season.airDate || '',
        episodeCount: Array.isArray(season.episodes) ? season.episodes.length : Number(season.episode_count || 0)
      }));
    }
  }
  targetData[targetSection] = Array.isArray(targetData[targetSection]) ? targetData[targetSection] : [];
  targetData[targetSection].push(item);

  // Optimistic update: apply to memory + localStorage immediately, don't wait for Firestore
  const safeData = (typeof compactImportedAnimeForStorage === 'function') ? compactImportedAnimeForStorage(targetData) : targetData;
  data = cloneListData(safeData);
  ownDataCache = cloneListData(safeData);
  if (currentUser) localStorage.setItem('screenlist-own-data-backup-' + currentUser.uid, JSON.stringify(safeData));
  localStorage.setItem('watchlist-tracker-data', JSON.stringify(safeData));
  activeSection = targetSection;
  activeTab = targetSection === 'games' && status === 'live' ? 'watching' : status;
  render();

  // Firestore write happens in the background — doesn't block the modal close
  if (DOC_REF) {
    persistOwnDataToFirestore(safeData).catch(err => {
      console.error('Background Firestore write failed after shelf add:', err);
      showToast('Saved locally. Cloud sync may be delayed.');
    });
  }

  return { ok: true, item: { ...item }, section: targetSection, status, rating: Number(rating || 0) || 0, message: `Added to ${getAddShelfStatusLabel(status, targetSection)}` };
}
