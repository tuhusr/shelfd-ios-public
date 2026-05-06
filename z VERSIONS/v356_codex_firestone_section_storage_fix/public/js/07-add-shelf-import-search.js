// TMDB Cover Search
const TMDB_PROXY_BASE = "/api/tmdb";
const RAWG_PROXY_BASE = "/api/rawg";
const SCREENLIST_AI_PROXY_BASE = "/api/ai";
const DEEPSEEK_PROXY_BASE = "/api/deepseek"; // legacy fallback only
let selectedTmdb = null; // holds the selected item data

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
    animeTitleVariantCache.set(cacheKey, variants);
    return variants;
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

window.checkScreenListAI = checkScreenListAI;
window.screenListAiCheck = checkScreenListAI;
window.checkDeepSeekAPI = checkScreenListAI; // legacy console alias
window.deepSeekCheck = checkScreenListAI;

function saveTmdbKey() {
  localStorage.removeItem("tmdb-api-key");
  renderApiKeySection();
}

function clearTmdbKey() {
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
let modalAddSubmitting = false;
let addShelfModalBackHandler = null;

function resetAddTitleSelection() {
  const selectedArea = document.getElementById("tmdb-selected-area");
  selectedTmdb = null;
  pendingModalStatusSelection = '';
  modalAddSubmitting = false;
  if (selectedArea) {
    selectedArea.style.display = "none";
    selectedArea.innerHTML = "";
  }
  hideModalStatusPicker();
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
  resetAddTitleSelection();
  const searchArea = document.getElementById('tmdb-search-area');
  const results = document.getElementById('tmdb-results');
  const input = document.getElementById('inp-tmdb-search');
  if (searchArea) searchArea.style.display = 'block';
  if (results) results.innerHTML = '';
  if (input) input.value = '';
  setAddShelfFilter(getAddShelfDefaultFilter(activeSection));
  setModalBackBtn(false);
  if (input) setTimeout(() => input.focus(), 40);
}

function getAddShelfStatusLabel(status = '', section = activeSection) {
  const option = (MODAL_STATUS_OPTIONS[section] || []).find(entry => entry.status === status);
  return option?.label || getMyListStatusLabel(status, section) || 'Library';
}

function handleAddTitleLiveSearchInput() {
  const input = document.getElementById("inp-tmdb-search");
  const resultsDiv = document.getElementById("tmdb-results");
  const query = (input?.value || '').trim();
  clearTimeout(addTitleLiveSearchTimer);
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
  addShelfSearchFilter = filter;
  document.querySelectorAll('.shelf-filter-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.filter === filter);
  });
  setAddShelfSearchPlaceholder(filter);
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
    } else if (filter === 'tv' || filter === 'anime') {
      const res = await fetchTmdbProxy('search/tv', { query });
      const json = await res.json();
      if (searchToken && searchToken !== addTitleSearchRequestToken) return;
      let tvHits = (json.results || [])
        .filter(r => r.poster_path)
        .sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      if (filter === 'anime') tvHits = tvHits.filter(r => isAnimeDiscoverCandidate(r));
      hits = tvHits.slice(0, 8).map(r => ({ ...r, media_type: 'tv' }));
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
      const poster = `https://image.tmdb.org/t/p/w92${r.poster_path}`;
      const mType = r.media_type || 'tv';
      const typeConfig = getAddShelfResultTypeConfig(r, filter);
      const badge = `<span class="shelf-result-badge ${typeConfig.badgeClass}">${typeConfig.label}</span>`;
      const meta = escHtml(buildAddShelfResultMeta(r, overviewSnippet, filter));
      return `<div class="tmdb-result" onclick="selectTMDB(${r.id}, '${mType}')">
        <img src="${escAttr(poster)}">
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
  if (!title) {
    if (resultsDiv) resultsDiv.innerHTML = `<div class="cover-search-msg">Enter a ${getSectionLabel(activeSection, true)} title first.</div>`;
    return;
  }
  selectedTmdb = {
    title,
    cover: '',
    genre: activeSection === 'manga' ? 'Manga' : 'Book',
    year: '',
    source: 'manual',
    mediaCategory: activeSection,
    librarySection: activeSection,
    episodes: []
  };
  if (resultsDiv) resultsDiv.innerHTML = '';
  const selectedArea = document.getElementById("tmdb-selected-area");
  selectedArea.style.display = "block";
  selectedArea.innerHTML = `<div class="tmdb-selected">
    <div class="tmdb-selected-info">
      <div class="tmdb-selected-title">${escHtml(title)}</div>
      <div class="tmdb-selected-detail">Manual ${escHtml(getAddButtonSectionLabel(activeSection))} entry</div>
      <button class="tmdb-clear" onclick="clearSelection()">Clear selection</button>
    </div>
  </div>`;
  showModalStatusPicker();
  document.getElementById("tmdb-search-area").style.display = "none";
  setModalBackBtn(true);
}

async function searchRAWG(searchToken = 0) {
  const query = document.getElementById("inp-tmdb-search").value.trim();
  if (!query) return;
  const resultsDiv = document.getElementById("tmdb-results");
  resultsDiv.innerHTML = '<div class="cover-search-msg">Searching...</div>';
  try {
    const res = await fetchRawgProxy('games', { search: query, page_size: 6 });
    const json = await res.json();
    if (searchToken && searchToken !== addTitleSearchRequestToken) return;
    const hits = (json.results || []).slice(0, 6);
    if (hits.length === 0) {
      resultsDiv.innerHTML = '<div class="cover-search-msg">No results found. Try a different search.</div>';
      return;
    }
    resultsDiv.innerHTML = '<div class="tmdb-results">' + hits.map(r => {
      const title = escHtml(r.name || '');
      const year = (r.released || '').slice(0, 4);
      const platforms = (r.platforms || []).map(p => p.platform.name).slice(0, 3).join(', ');
      const poster = r.background_image ? r.background_image : '';
      const posterThumb = poster ? `<img src="${poster}" style="width:66px;height:44px;border-radius:4px;object-fit:cover;flex-shrink:0;">` : '';
      const typeConfig = getAddShelfResultTypeConfig({ ...r, source: 'rawg', rawgId: r.id }, 'games');
      const badge = `<span class="shelf-result-badge ${typeConfig.badgeClass}">${typeConfig.label}</span>`;
      const meta = escHtml(buildAddShelfResultMeta({ ...r, source: 'rawg', rawgId: r.id }, platforms, 'games'));
      return `<div class="tmdb-result" onclick="selectRAWG(${r.id})">
        ${posterThumb}
        <div class="tmdb-result-info">
          <div class="tmdb-result-title">${title} ${year ? '(' + year + ')' : ''} ${badge}</div>
          <div class="tmdb-result-meta">${meta}</div>
        </div>
      </div>`;
    }).join("") + '</div>';
  } catch(e) {
    resultsDiv.innerHTML = '<div class="cover-search-msg">Search failed.</div>';
  }
}

async function selectRAWG(id) {
  const resultsDiv = document.getElementById("tmdb-results");
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

    resultsDiv.innerHTML = '';
    const selectedArea = document.getElementById("tmdb-selected-area");
    selectedArea.style.display = "block";
    selectedArea.innerHTML = `<div class="tmdb-selected">
      ${cover ? `<img src="${cover}" style="width:90px;height:60px;border-radius:4px;object-fit:cover;">` : ''}
      <div class="tmdb-selected-info">
        <div class="tmdb-selected-title">${escHtml(title)} ${year ? '(' + year + ')' : ''}</div>
        <div class="tmdb-selected-detail">${escHtml(genres)}</div>
        <div class="tmdb-selected-detail">${escHtml(platforms)}</div>
        <button class="tmdb-clear" onclick="clearSelection()">Clear selection</button>
      </div>
    </div>`;
    showModalStatusPicker();
    document.getElementById("tmdb-search-area").style.display = "none";
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
    const type = isShowSection(activeSection) ? "tv" : "movie";
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
      const poster = `https://image.tmdb.org/t/p/w92${r.poster_path}`;
      return `<div class="tmdb-result" onclick="selectTMDB(${r.id})">
        <img src="${poster}">
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
  const type = knownType || (isShowSection(activeSection) ? "tv" : "movie");
  const resultsDiv = document.getElementById("tmdb-results");
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

    // Show selected preview
    resultsDiv.innerHTML = '';
    const selectedArea = document.getElementById("tmdb-selected-area");
    const coverThumb = d.poster_path ? `https://image.tmdb.org/t/p/w185${d.poster_path}` : '';
    const epInfo = type === "tv" ? `<div class="tmdb-selected-detail">${selectedTmdb.seasons} season${selectedTmdb.seasons > 1 ? 's' : ''} · ${selectedTmdb.totalEpisodes} episodes</div>` : '';
    selectedArea.style.display = "block";
    selectedArea.innerHTML = `<div class="tmdb-selected">
      ${coverThumb ? `<img src="${coverThumb}">` : ''}
      <div class="tmdb-selected-info">
        <div class="tmdb-selected-title">${escHtml(title)} ${year ? '(' + year + ')' : ''}</div>
        <div class="tmdb-selected-detail">${escHtml(genres)}</div>
        ${epInfo}
        <button class="tmdb-clear" onclick="clearSelection()">Clear selection</button>
      </div>
    </div>`;
    showModalStatusPicker();
    document.getElementById("tmdb-search-area").style.display = "none";
    setModalBackBtn(true);
  } catch(e) {
    resultsDiv.innerHTML = '<div class="cover-search-msg">Failed to load details. Try again.</div>';
  }
}

function clearSelection() {
  selectedTmdb = null;
  document.getElementById("tmdb-selected-area").style.display = "none";
  document.getElementById("tmdb-selected-area").innerHTML = "";
  hideModalStatusPicker();
  document.getElementById("tmdb-search-area").style.display = "block";
  setModalBackBtn(false);
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
    { status: 'planned',  label: 'Backlog' },
    { status: 'watched',  label: 'Played' }
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
  const options = MODAL_STATUS_OPTIONS[activeSection] || MODAL_STATUS_OPTIONS.shows;
  picker.innerHTML = `
    <div class="modal-status-label">Where do you want it?</div>
    <div class="modal-status-grid">
      ${options.map(o => `<button class="modal-status-btn" onclick="showModalAddConfirmation('${o.status}')">${escHtml(o.label)}</button>`).join('')}
    </div>
  `;
  picker.style.display = "flex";
  setModalBackBtn(true, clearSelection);
}

function showModalAddConfirmation(status) {
  if (!selectedTmdb) return;
  pendingModalStatusSelection = status;
  modalAddSubmitting = false;
  const picker = document.getElementById('modal-status-picker');
  if (!picker) return;
  if (status === 'watched' && typeof openScreenListCompletionRatingPrompt === 'function') {
    const targetSection = isShowSection(activeSection)
      ? resolveShowSection(selectedTmdb, activeSection)
      : (selectedTmdb.librarySection || selectedTmdb.mediaCategory || activeSection);
    openScreenListCompletionRatingPrompt({
      item: selectedTmdb,
      section: targetSection,
      status,
      source: 'add-shelf-modal',
      onApply: async (rating) => {
        const result = await submitModal('watched', rating);
        if (result?.ok) {
          playLibraryAddPopSound();
          showToast(result.message || 'Added to your library');
          resetAddShelfModalHome();
          closeModal();
        }
        return result;
      }
    });
    return;
  }
  const statusLabel = getAddShelfStatusLabel(status, activeSection);
  picker.innerHTML = `
    <div class="modal-status-label">Confirm add</div>
    <div class="modal-status-confirm">
      <div class="modal-status-confirm-title">${escHtml(selectedTmdb.title || 'This title')}</div>
      <div class="modal-status-confirm-copy">Add this title to <strong>${escHtml(statusLabel)}</strong>?</div>
      <div class="modal-status-confirm-actions">
        <button class="btn-secondary modal-status-confirm-back" onclick="showModalStatusPicker()">Back</button>
        <button class="btn-primary modal-status-confirm-submit" onclick="confirmModalAdd()">Confirm</button>
      </div>
    </div>
  `;
  picker.style.display = 'flex';
  setModalBackBtn(true, showModalStatusPicker);
}

async function confirmModalAdd() {
  if (!selectedTmdb || !pendingModalStatusSelection || modalAddSubmitting) return;
  const picker = document.getElementById('modal-status-picker');
  const confirmBtn = picker?.querySelector('.modal-status-confirm-submit');
  const backBtn = picker?.querySelector('.modal-status-confirm-back');
  modalAddSubmitting = true;
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Adding...'; }
  if (backBtn) backBtn.disabled = true;
  try {
    const result = await submitModal(pendingModalStatusSelection);
    if (!result?.ok) return;
    playLibraryAddPopSound();
    showToast(result.message || 'Added to your library');
    resetAddShelfModalHome();
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
  document.getElementById("modal").style.display = "flex";
  document.getElementById("modal-title").textContent = 'Add to Shelf';
  clearTimeout(addTitleLiveSearchTimer);
  addTitleSearchRequestToken++;
  renderApiKeySection();
  resetAddShelfModalHome();
}
function closeModal() {
  document.getElementById("modal").style.display = "none";
  resetAddTitleSelection();
  setModalBackBtn(false);
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
    if (!existing.bulkImportCompact) { existing.bulkImportCompact = true; changed = true; }
    if (!Array.isArray(existing.episodes) || existing.episodes.length) { existing.episodes = []; changed = true; }
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
  const plannedLabel = isGame ? 'Backlog' : 'Watchlist';
  content.innerHTML = `
    <h3>Add to Library</h3>
    <div class="discover-add-desc">Where you bouta put this?</div>
    <div class="discover-status-options">
      <button class="discover-status-btn watched-option" onclick="confirmFriendAdd('watched')">${watchedLabel}</button>
      <button class="discover-status-btn planned-option" onclick="confirmFriendAdd('planned')">${plannedLabel}</button>
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

async function submitModal(status, rating = 0) {
  if (!selectedTmdb) return { ok: false };
  const validStatuses = (MODAL_STATUS_OPTIONS[activeSection] || []).map(o => o.status);
  if (!validStatuses.includes(status)) status = getDefaultTabForSection(activeSection);
  const targetSection = isShowSection(activeSection)
    ? resolveShowSection(selectedTmdb, activeSection)
    : (selectedTmdb.librarySection || selectedTmdb.mediaCategory || activeSection);
  const targetData = ownDataCache ? cloneListData(ownDataCache) : cloneListData(data);
  targetData[targetSection] = Array.isArray(targetData[targetSection]) ? targetData[targetSection] : [];
  const isAnimeSeriesAdd = targetSection === 'anime' && (selectedTmdb.isAnime || selectedTmdb.mediaCategory === 'anime') && selectedTmdb.tmdbId;
  const cleanedAnimeList = isAnimeSeriesAdd ? removeAnimeSeasonSplitEntries(targetData[targetSection], selectedTmdb) : targetData[targetSection];
  const removedSplitAnimeEntries = isAnimeSeriesAdd && cleanedAnimeList.length !== targetData[targetSection].length;
  if (isAnimeSeriesAdd) targetData[targetSection] = cleanedAnimeList;

  if (isDuplicateTitleInList(selectedTmdb.title, targetSection, targetData)) {
    if (removedSplitAnimeEntries) {
      await writeOwnDataDirect(targetData);
      render();
    }
    showToast("this title is already added to your library silly!");
    return { ok: false, duplicate: true };
  }

  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: selectedTmdb.title,
    cover: selectedTmdb.cover,
    igdbCoverUrl: selectedTmdb.igdbCoverUrl || '',
    genre: selectedTmdb.genre,
    year: selectedTmdb.year || '',
    status,
    rating: Number(rating || 0) || 0,
    dateAdded: new Date().toISOString(),
    imdbId: selectedTmdb.imdbId || '',
    platforms: selectedTmdb.platforms || '',
    metacritic: selectedTmdb.metacritic || '',
    metacriticSlug: selectedTmdb.metacriticSlug || '',
    rawgId: selectedTmdb.rawgId || '',
    rawgSlug: selectedTmdb.rawgSlug || '',
    backloggdSlug: selectedTmdb.backloggdSlug || selectedTmdb.rawgSlug || selectedTmdb.metacriticSlug || '',
    source: selectedTmdb.source || (targetSection === 'games' ? 'rawg' : ''),
    stores: Array.isArray(selectedTmdb.stores) ? selectedTmdb.stores : [],
    tmdbId: selectedTmdb.tmdbId || '',
    mediaCategory: selectedTmdb.mediaCategory || targetSection,
    librarySection: selectedTmdb.librarySection || selectedTmdb.mediaCategory || targetSection,
    originalTitle: selectedTmdb.originalTitle || '',
    originalLanguage: selectedTmdb.originalLanguage || '',
    originCountries: Array.isArray(selectedTmdb.originCountries) ? selectedTmdb.originCountries : [],
    genreNames: Array.isArray(selectedTmdb.genreNames) ? selectedTmdb.genreNames : [],
    isAnime: (selectedTmdb.mediaCategory || '') === 'anime',
    titleVariants: normalizeAnimeTitleVariants(selectedTmdb.titleVariants, selectedTmdb.title || ''),
    englishTitle: selectedTmdb.englishTitle || selectedTmdb.titleVariants?.english || '',
    romajiTitle: selectedTmdb.romajiTitle || selectedTmdb.titleVariants?.romaji || '',
    japaneseTitle: selectedTmdb.japaneseTitle || selectedTmdb.titleVariants?.japanese || '',
  };
  if (isShowSection(activeSection) && selectedTmdb.episodes) {
    item.totalEpisodes = selectedTmdb.totalEpisodes;
    item.episodes = selectedTmdb.episodes.map((ep, i) => ({
      id: item.id + '-ep-' + (i + 1),
      number: ep.number,
      seasonNum: ep.seasonNum,
      seasonName: ep.seasonName || '',
      epNum: ep.epNum,
      title: ep.title,
      cover: ep.cover || '',
      watched: status === 'watched',
      rating: 0,
    }));
    if (Array.isArray(selectedTmdb.animeSeasonItems) && selectedTmdb.animeSeasonItems.length) {
      item.seasonsInfo = selectedTmdb.animeSeasonItems.map(season => ({
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
  activeTab = status;
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
