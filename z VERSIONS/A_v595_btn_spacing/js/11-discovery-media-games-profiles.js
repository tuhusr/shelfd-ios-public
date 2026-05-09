function renderGamesDiscoverLoading() {
  getGamesDiscoverGrids().forEach(grid => {
    const button = getDiscoverExpandButton(grid);
    if (button) button.style.display = 'none';
    grid.innerHTML = '<div class="discover-message">Loading game discovery titles...</div>';
  });
}

function renderGamesDiscoverError(message) {
  const html = `<div class="discover-message">${escHtml(message)}</div>`;
  getGamesDiscoverGrids().forEach(grid => {
    const button = getDiscoverExpandButton(grid);
    if (button) button.style.display = 'none';
    grid.innerHTML = html;
  });
}

function renderDiscoverGridError(gridId, message = 'This discovery row could not load. It will try again automatically later.') {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  const button = getDiscoverExpandButton(grid);
  if (button) button.style.display = 'none';
  grid.innerHTML = `<div class="discover-message">${escHtml(message)}</div>`;
}

function isDiscoverMemoryFresh(lastLoadedAt) {
  return lastLoadedAt && Date.now() - lastLoadedAt < DISCOVER_CACHE_TTL_MS;
}

function getDiscoverCacheKey(key) {
  return DISCOVER_CACHE_PREFIX + key;
}

function readDiscoverCacheEntry(key, allowStale = false) {
  try {
    const raw = localStorage.getItem(getDiscoverCacheKey(key));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || !entry.savedAt || !('data' in entry)) return null;
    if (!allowStale && Date.now() - Number(entry.savedAt) > DISCOVER_CACHE_TTL_MS) return null;
    return entry.data;
  } catch (e) {
    console.warn('Discover cache read failed:', key, e);
    return null;
  }
}

function writeDiscoverCacheEntry(key, data) {
  try {
    localStorage.setItem(getDiscoverCacheKey(key), JSON.stringify({
      savedAt: Date.now(),
      data
    }));
  } catch (e) {
    console.warn('Discover cache write failed:', key, e);
  }
}

async function loadDiscoverCachedData(key, fetcher, force = false) {
  if (!force) {
    const cached = readDiscoverCacheEntry(key);
    if (cached) return cached;
  }

  try {
    const fresh = await fetcher();
    writeDiscoverCacheEntry(key, fresh);
    return fresh;
  } catch (e) {
    const stale = readDiscoverCacheEntry(key, true);
    if (stale) {
      console.warn('Using stale Discover cache after fetch failed:', key, e);
      return stale;
    }
    throw e;
  }
}

async function renderDiscoverCachedRow({ cacheKey, fetcher, render, force = false }) {
  const data = await loadDiscoverCachedData(cacheKey, fetcher, force);
  render(data);
}

async function fetchDiscoverMediaRank(section, fallbackFetcher = null) {
  const res = await fetch(`/api/rank/media?section=${encodeURIComponent(section)}&period=week`, { cache: 'no-store' });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  if (res.ok && payload?.ok && Array.isArray(payload.rankings)) return payload.rankings;
  if (fallbackFetcher) {
    console.warn(`Trakt-first Discover ranking failed for ${section}; using existing fallback.`, payload?.error || res.status);
    return fallbackFetcher();
  }
  throw new Error(payload?.error || `Discover ranking request failed (${res.status})`);
}

/* v571: Movies & TV combined hub — client-side filter pill state.
   Values: 'all' | 'movie' | 'tv'. Persists in localStorage so the user's
   preference survives reloads. */
let discoverMixedFilter = (() => {
  try { return localStorage.getItem('shelfd-discover-mixed-filter') || 'all'; } catch (e) { return 'all'; }
})();

function setDiscoverMixedFilter(value = 'all') {
  const v = (value === 'movie' || value === 'tv') ? value : 'all';
  discoverMixedFilter = v;
  try { localStorage.setItem('shelfd-discover-mixed-filter', v); } catch (e) {}
  document.querySelectorAll('.discover-mixed-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.discoverFilter === v);
    btn.setAttribute('aria-pressed', btn.dataset.discoverFilter === v ? 'true' : 'false');
  });
  applyDiscoverMixedFilter();
}

function applyDiscoverMixedFilter() {
  const v = discoverMixedFilter || 'all';
  const root = document.getElementById('discover-view');
  if (!root) return;
  root.classList.toggle('discover-filter-all',   v === 'all');
  root.classList.toggle('discover-filter-movie', v === 'movie');
  root.classList.toggle('discover-filter-tv',    v === 'tv');
}

async function loadDiscover(force = false) {
  if (discoverLoading) return;
  if (discoverLoaded && !force && isDiscoverMemoryFresh(discoverLoadedAt)) {
    syncDiscoverMediaTabSections();
    ensureDiscoverFriendWatchingRefreshSystem();
    return;
  }

  discoverLoading = true;
  renderDiscoverLoading();

  try {
    syncDiscoverReleaseFilterButtons();
    syncDiscoverMediaTabSections();

    /* v572: Movies & TV — same tab, separate section per type, ordered:
       Friends → New Releases (M+TV) → In Theaters → Trending (M+TV) →
       Most Anticipated (M+TV) → Popular (M+TV) → Releasing Soon (M+TV) →
       This Year's Best (M+TV) → Top Rated All Time (M+TV) */
    const sections = [
      {
        label: 'What Your Friends Are Watching',
        gridId: 'discover-friends-watching-grid',
        run: async () => renderFriendWatchingDiscoverCards(await fetchFriendWatchingDiscoverTitles(DISCOVER_LIMIT), 'discover-friends-watching-grid', { row: true })
      },
      {
        label: 'Newest Releases Movies',
        gridId: 'discover-movie-new-releases-grid',
        run: () => renderDiscoverCachedRow({
          cacheKey: `media:movie-date-new-releases:${DISCOVER_RANKING_CACHE_VERSION}:${discoverNewReleaseRange}:${DISCOVER_RELEASE_REGION}:all`,
          fetcher: () => fetchNewReleasesByDate(discoverNewReleaseRange, DISCOVER_LIMIT, DISCOVER_PAGE_COUNT, 'movie'),
          render: items => renderRankedDiscoverCards('movie', items, 'discover-movie-new-releases-grid'),
          force
        })
      },
      {
        label: 'Newest Releases TV Shows',
        gridId: 'discover-tv-new-releases-grid',
        run: () => renderDiscoverCachedRow({
          cacheKey: `media:tv-date-new-releases:${DISCOVER_RANKING_CACHE_VERSION}:${discoverNewReleaseRange}:${DISCOVER_RELEASE_REGION}:all`,
          fetcher: () => fetchNewReleasesByDate(discoverNewReleaseRange, DISCOVER_LIMIT, DISCOVER_PAGE_COUNT, 'tv'),
          render: items => renderRankedDiscoverCards('tv', items, 'discover-tv-new-releases-grid'),
          force
        })
      },
      {
        label: 'In Theaters',
        gridId: 'discover-movie-in-theaters-grid',
        run: () => renderDiscoverCachedRow({
          cacheKey: `media:movie-in-theaters:${DISCOVER_RANKING_CACHE_VERSION}`,
          fetcher: () => fetchInTheatersMovies(DISCOVER_LIMIT),
          render: items => renderRankedDiscoverCards('movie', items, 'discover-movie-in-theaters-grid'),
          force
        })
      },
      {
        label: 'Trending Movies',
        gridId: 'discover-movie-trending-grid',
        run: () => renderDiscoverCachedRow({
          cacheKey: `media:tmdb-weekly-trending-movies:${DISCOVER_RANKING_CACHE_VERSION}`,
          fetcher: () => fetchTmdbWeeklyTrendingMedia('movie'),
          render: items => renderRankedDiscoverCards('movie', items, 'discover-movie-trending-grid'),
          force
        })
      },
      {
        label: 'Trending TV Shows',
        gridId: 'discover-tv-trending-grid',
        run: () => renderDiscoverCachedRow({
          cacheKey: `media:tmdb-weekly-trending-tv:${DISCOVER_RANKING_CACHE_VERSION}`,
          fetcher: () => fetchTmdbWeeklyTrendingMedia('tv'),
          render: items => renderRankedDiscoverCards('tv', items, 'discover-tv-trending-grid'),
          force
        })
      },
      {
        label: 'Most Anticipated Movies',
        gridId: 'discover-movie-anticipated-grid',
        run: () => renderDiscoverCachedRow({
          cacheKey: `media:movie-anticipated:${DISCOVER_RANKING_CACHE_VERSION}`,
          fetcher: () => fetchAndRankAnticipated(DISCOVER_LIMIT, DISCOVER_PAGE_COUNT, 'movie'),
          render: items => renderRankedDiscoverCards('movie', items, 'discover-movie-anticipated-grid'),
          force
        })
      },
      {
        label: 'Most Anticipated TV Shows',
        gridId: 'discover-tv-anticipated-grid',
        run: () => renderDiscoverCachedRow({
          cacheKey: `media:tv-anticipated:${DISCOVER_RANKING_CACHE_VERSION}`,
          fetcher: () => fetchAndRankAnticipated(DISCOVER_LIMIT, DISCOVER_PAGE_COUNT, 'tv'),
          render: items => renderRankedDiscoverCards('tv', items, 'discover-tv-anticipated-grid'),
          force
        })
      },
      {
        label: 'Popular Movies',
        gridId: 'discover-movie-popular-grid',
        run: () => renderDiscoverCachedRow({
          cacheKey: `media:movie-popular:${DISCOVER_RANKING_CACHE_VERSION}`,
          fetcher: () => fetchDiscoverPopularMedia('movie'),
          render: items => renderRankedDiscoverCards('movie', items, 'discover-movie-popular-grid'),
          force
        })
      },
      {
        label: 'Popular TV Shows',
        gridId: 'discover-tv-popular-grid',
        run: () => renderDiscoverCachedRow({
          cacheKey: `media:tv-popular:${DISCOVER_RANKING_CACHE_VERSION}`,
          fetcher: () => fetchDiscoverPopularMedia('tv'),
          render: items => renderRankedDiscoverCards('tv', items, 'discover-tv-popular-grid'),
          force
        })
      },
      {
        label: 'Releasing Soon Movies',
        gridId: 'discover-movie-releasing-soon-grid',
        run: () => renderDiscoverCachedRow({
          cacheKey: `media:movie-date-releasing-soon:${DISCOVER_RANKING_CACHE_VERSION}`,
          fetcher: () => fetchReleasingSoonByDate(DISCOVER_LIMIT, DISCOVER_PAGE_COUNT, 'movie'),
          render: items => renderRankedDiscoverCards('movie', items, 'discover-movie-releasing-soon-grid'),
          force
        })
      },
      {
        label: 'Releasing Soon TV Shows',
        gridId: 'discover-tv-releasing-soon-grid',
        run: () => renderDiscoverCachedRow({
          cacheKey: `media:tv-date-releasing-soon:${DISCOVER_RANKING_CACHE_VERSION}`,
          fetcher: () => fetchReleasingSoonByDate(DISCOVER_LIMIT, DISCOVER_PAGE_COUNT, 'tv'),
          render: items => renderRankedDiscoverCards('tv', items, 'discover-tv-releasing-soon-grid'),
          force
        })
      },
      {
        label: "This Year's Best Movies",
        gridId: 'discover-movie-years-best-grid',
        run: () => renderDiscoverCachedRow({
          cacheKey: `media:movie-years-best:${DISCOVER_RANKING_CACHE_VERSION}`,
          fetcher: () => fetchAndRankThisYearsBest('movie'),
          render: items => renderRankedDiscoverCards('movie', items, 'discover-movie-years-best-grid'),
          force
        })
      },
      {
        label: "This Year's Best TV Shows",
        gridId: 'discover-tv-years-best-grid',
        run: () => renderDiscoverCachedRow({
          cacheKey: `media:tv-years-best:${DISCOVER_RANKING_CACHE_VERSION}`,
          fetcher: () => fetchAndRankThisYearsBest('tv'),
          render: items => renderRankedDiscoverCards('tv', items, 'discover-tv-years-best-grid'),
          force
        })
      },
      {
        label: 'Top Rated Movies (All Time)',
        gridId: 'discover-movie-top-rated-grid',
        run: () => renderDiscoverCachedRow({
          cacheKey: `media:movie-top-rated:${DISCOVER_RANKING_CACHE_VERSION}`,
          fetcher: () => fetchDiscoverTopRatedMedia('movie'),
          render: items => renderRankedDiscoverCards('movie', items, 'discover-movie-top-rated-grid'),
          force
        })
      },
      {
        label: 'Top Rated TV Shows (All Time)',
        gridId: 'discover-tv-top-rated-grid',
        run: () => renderDiscoverCachedRow({
          cacheKey: `media:tv-top-rated:${DISCOVER_RANKING_CACHE_VERSION}`,
          fetcher: () => fetchDiscoverTopRatedMedia('tv'),
          render: items => renderRankedDiscoverCards('tv', items, 'discover-tv-top-rated-grid'),
          force
        })
      }
    ];

    for (const section of sections) {
      try {
        await section.run();
      } catch (e) {
        console.error(`Discover row failed: ${section.label}`, e);
        renderDiscoverGridError(section.gridId, `${section.label} could not load. It will try again automatically later.`);
      }
    }

    discoverLoaded = true;
    discoverLoadedAt = Date.now();
    syncDiscoverMediaTabSections();
    ensureDiscoverFriendWatchingRefreshSystem();
  } catch(e) {
    console.error("Discover load failed:", e);
    renderDiscoverError("Discovery could not load. It will try again automatically later.");
  } finally {
    discoverLoading = false;
  }
}

function renderAnimeDiscoverLoading() {
  getAnimeDiscoverGrids().forEach(grid => {
    const button = getDiscoverExpandButton(grid);
    if (button) button.style.display = 'none';
    grid.innerHTML = '<div class="discover-message">Loading anime discovery titles...</div>';
  });
}

function renderAnimeDiscoverError(message) {
  const html = `<div class="discover-message">${escHtml(message)}</div>`;
  getAnimeDiscoverGrids().forEach(grid => {
    const button = getDiscoverExpandButton(grid);
    if (button) button.style.display = 'none';
    grid.innerHTML = html;
  });
}

function sleepScreenList(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchTmdbPages(path, params = {}, pageCount = DISCOVER_PAGE_COUNT) {
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
  const results = [];

  for (const page of pages) {
    let res = await fetchTmdbProxy(path, { ...params, page: String(page) });
    if (res.status === 429) {
      await sleepScreenList(850);
      res = await fetchTmdbProxy(path, { ...params, page: String(page) });
    }

    if (!res.ok) {
      console.warn(`TMDB discover request failed: ${path} page ${page} (${res.status})`);
      continue;
    }

    try {
      const json = await res.json();
      results.push(...(json.results || []));
    } catch (e) {
      console.warn(`TMDB discover JSON parse failed: ${path} page ${page}`, e);
    }
  }

  const seen = new Set();
  const filtered = results.filter(item => {
    const key = `${item.media_type || path}:${item.id}`;
    if (!item.poster_path || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (!filtered.length) throw new Error(`TMDB discover request returned no usable results: ${path}`);
  return filtered;
}

async function fetchTmdbWeeklyTrendingMedia(type = 'tv') {
  /* v571: 'mixed' fetches both movie + tv trending and ranks them together. */
  if (type === 'mixed') {
    const [movieItems, tvItems] = await Promise.all([
      fetchTmdbWeeklyTrendingMedia('movie').catch(() => []),
      fetchTmdbWeeklyTrendingMedia('tv').catch(() => [])
    ]);
    return [...movieItems, ...tvItems]
      .sort(compareDiscoverCalculatedScoreDesc)
      .slice(0, DISCOVER_LIMIT);
  }
  const mediaType = type === 'movie' ? 'movie' : 'tv';
  const path = mediaType === 'movie' ? 'trending/movie/week' : 'trending/tv/week';
  const results = await fetchTmdbPages(path, {}, DISCOVER_PAGE_COUNT);
  const filtered = results
    .filter(item => {
      const title = mediaType === 'movie' ? (item.title || item.original_title || '') : (item.name || item.original_name || '');
      if (!item?.id || !item?.poster_path || !title) return false;
      if (type === 'anime' && !isAnimeDiscoverCandidate(item)) return false;
      return true;
    })
    .map(item => ({
      ...item,
      media_type: mediaType
    }))
    .slice(0, Math.max(DISCOVER_LIMIT * 2, 24));
  return filtered
    .map((item, index) => ({
      ...item,
      calculatedScore: scoreDiscoverTmdbItem(filtered, item, 'trending', type, index, filtered.length),
      discoverContext: buildDiscoverTmdbContext('TMDB weekly trending', item)
    }))
    .sort(compareDiscoverCalculatedScoreDesc)
    .slice(0, DISCOVER_LIMIT);
}

async function fetchAndRankTrendingMovies() {
  return fetchTmdbWeeklyTrendingMedia('movie');
}

async function fetchAndRankTrendingShows() {
  return fetchTmdbWeeklyTrendingMedia('tv');
}

function toDiscoverIsoDate(date) {
  return date.toISOString().split('T')[0];
}

function addDiscoverDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getDiscoverReleaseDate(item = {}) {
  return item.release_date || item.first_air_date || '';
}

function formatDiscoverReleaseDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function getDiscoverOrdinalSuffix(day) {
  const value = Math.abs(Number(day || 0));
  const teen = value % 100;
  if (teen >= 11 && teen <= 13) return 'th';
  const last = value % 10;
  if (last === 1) return 'st';
  if (last === 2) return 'nd';
  if (last === 3) return 'rd';
  return 'th';
}

function formatDiscoverReleaseCardDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  const month = date.toLocaleDateString(undefined, { month: 'long' });
  const day = date.getDate();
  const year = String(date.getFullYear()).slice(-2);
  return `${month} ${day}${getDiscoverOrdinalSuffix(day)} ${year}'`;
}

/* v567: "Released April 30th" / "Releasing May 15th" for the card body. */
function getDiscoverCardReleaseLine(item = {}) {
  const raw = getDiscoverReleaseDate(item);
  if (!raw) return '';
  const date = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  const month = date.toLocaleString('en-US', { month: 'long' });
  const day = date.getDate();
  const ord = getDiscoverOrdinalSuffix(day);
  const label = date <= new Date() ? 'Released' : 'Releasing';
  return `${label} ${month} ${day}${ord}`;
}

function scoreDiscoverQuality(item = {}) {
  const voteAvg = Number(item.vote_average || 0);
  const voteCount = Number(item.vote_count || 0);
  return voteAvg * Math.sqrt(Math.max(0, voteCount));
}


function getDiscoverCountryLabel(code = discoverCountryCode) {
  const match = DISCOVER_COUNTRY_OPTIONS.find(item => item.code === code);
  return match ? match.label : code;
}

function syncDiscoverCountryControls() {
  document.querySelectorAll('.discover-filter-btn[data-country-code]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.countryCode === discoverCountryCode);
  });
  document.querySelectorAll('.discover-filter-btn[data-country-media-type]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.countryMediaType === discoverCountryMediaType);
  });
  const title = document.getElementById('discover-country-dynamic-title');
  if (title) title.textContent = `Top From ${getDiscoverCountryLabel()}`;
}

async function changeDiscoverCountry(code) {
  const valid = DISCOVER_COUNTRY_OPTIONS.some(item => item.code === code);
  const nextCode = valid ? code : 'US';
  if (discoverCountryCode === nextCode) return;
  discoverCountryCode = nextCode;
  syncDiscoverCountryControls();
  await loadDiscoverCountryRankings(false);
}

async function changeDiscoverCountryMediaType(type) {
  const nextType = type === 'movie' ? 'movie' : 'tv';
  if (discoverCountryMediaType === nextType) return;
  discoverCountryMediaType = nextType;
  syncDiscoverCountryControls();
  await loadDiscoverCountryRankings(false);
}

async function fetchCountryRankings() {
  const res = await fetch(`/api/rank/country?country=${encodeURIComponent(discoverCountryCode)}&type=${encodeURIComponent(discoverCountryMediaType)}&period=week`, {
    cache: 'no-store'
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch (e) {
    payload = null;
  }
  if (!res.ok || !payload?.ok) {
    throw new Error(payload?.error || `Country ranking request failed (${res.status})`);
  }
  return payload;
}

function renderDiscoverCountryRankings(payload = {}) {
  const grid = document.getElementById('discover-country-grid');
  const context = document.getElementById('discover-country-context');
  if (!grid) return;
  const countryLabel = payload.countryLabel || getDiscoverCountryLabel();
  const typeLabel = discoverCountryMediaType === 'movie' ? 'Movies' : 'TV Shows';
  const rankings = Array.isArray(payload.rankings) ? payload.rankings : [];
  if (context) {
    const traktPart = payload.sources?.trakt?.matched
      ? ` · ${payload.sources.trakt.matched} Trakt watcher matches`
      : '';
    context.textContent = `${typeLabel} from ${countryLabel}, ranked Trakt-first from weekly watched/trending activity, then matched to TMDB for origin and display${traktPart}.`;
  }
  renderCountryDiscoverCards(discoverCountryMediaType, rankings, 'discover-country-grid');
}

async function loadDiscoverCountryRankings(force = false) {
  syncDiscoverCountryControls();
  const grid = document.getElementById('discover-country-grid');
  const button = getDiscoverExpandButton(grid);
  if (button) button.style.display = 'none';
  if (grid) grid.innerHTML = `<div class="discover-message">Loading top ${discoverCountryMediaType === 'movie' ? 'movies' : 'shows'} from ${escHtml(getDiscoverCountryLabel())}...</div>`;
  try {
    await renderDiscoverCachedRow({
      cacheKey: `country-origin:${discoverCountryCode}:${discoverCountryMediaType}`,
      fetcher: fetchCountryRankings,
      render: renderDiscoverCountryRankings,
      force
    });
  } catch (e) {
    console.error('Country origin rankings failed:', e);
    renderDiscoverGridError('discover-country-grid', 'Country origin rankings could not load. It will try again automatically later.');
  }
}

function syncDiscoverReleaseFilterButtons() {
  document.querySelectorAll('.discover-filter-btn[data-release-range]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.releaseRange === discoverNewReleaseRange);
  });
}

async function changeDiscoverReleaseRange(range) {
  const nextRange = range === 'month' ? 'month' : 'week';
  if (discoverNewReleaseRange === nextRange) return;
  discoverNewReleaseRange = nextRange;
  syncDiscoverReleaseFilterButtons();
  const configs = [
    { gridId: 'discover-tv-new-releases-grid', type: 'tv', label: 'TV new releases' },
    { gridId: 'discover-movie-new-releases-grid', type: 'movie', label: 'movie new releases' }
  ];
  await Promise.all(configs.map(async config => {
    const grid = document.getElementById(config.gridId);
    const button = getDiscoverExpandButton(grid);
    if (button) button.style.display = 'none';
    if (grid) grid.innerHTML = '<div class="discover-message">Loading new releases...</div>';
    try {
      await renderDiscoverCachedRow({
        cacheKey: `media:${config.type}-date-new-releases:${DISCOVER_RANKING_CACHE_VERSION}:${discoverNewReleaseRange}:${DISCOVER_RELEASE_REGION}:all`,
        fetcher: () => fetchNewReleasesByDate(discoverNewReleaseRange, DISCOVER_LIMIT, DISCOVER_PAGE_COUNT, config.type),
        render: items => renderRankedDiscoverCards(config.type === 'movie' ? 'movie' : 'tv', items, config.gridId),
        force: true
      });
    } catch (e) {
      console.error(`New release filter failed for ${config.label}:`, e);
      if (grid) grid.innerHTML = '<div class="discover-message">New releases could not load. It will try again automatically later.</div>';
    }
  }));
}

function getDiscoverSortTitle(item = {}) {
  return String(item.title || item.name || '').trim();
}

function getDiscoverDateTime(item = {}) {
  const value = getDiscoverReleaseDate(item) || item.released || '';
  const time = Date.parse(`${value}T00:00:00`);
  return Number.isFinite(time) ? time : 0;
}

function hasUsableDiscoverReleaseItem(item = {}) {
  const dateTime = getDiscoverDateTime(item);
  return !!(
    item &&
    item.poster_path &&
    getDiscoverSortTitle(item) &&
    item.overview &&
    dateTime &&
    dateTime <= Date.now()
  );
}

function hasUsableDiscoverUpcomingItem(item = {}) {
  const dateTime = getDiscoverDateTime(item);
  return !!(
    item &&
    item.poster_path &&
    getDiscoverSortTitle(item) &&
    item.overview &&
    dateTime &&
    dateTime > Date.now()
  );
}

function compareDiscoverTitleAsc(a = {}, b = {}) {
  return getDiscoverSortTitle(a).localeCompare(getDiscoverSortTitle(b), undefined, { sensitivity: 'base' });
}

function compareDiscoverPopularityDesc(a = {}, b = {}) {
  return Number(b.popularity || b.added || 0) - Number(a.popularity || a.added || 0);
}

function compareDiscoverReleaseDateDesc(a = {}, b = {}) {
  const dateCompare = getDiscoverDateTime(b) - getDiscoverDateTime(a);
  if (dateCompare) return dateCompare;
  const popularityCompare = compareDiscoverPopularityDesc(a, b);
  if (popularityCompare) return popularityCompare;
  return compareDiscoverTitleAsc(a, b);
}

function compareDiscoverReleaseDateAsc(a = {}, b = {}) {
  const dateCompare = getDiscoverDateTime(a) - getDiscoverDateTime(b);
  if (dateCompare) return dateCompare;
  const popularityCompare = compareDiscoverPopularityDesc(a, b);
  if (popularityCompare) return popularityCompare;
  return compareDiscoverTitleAsc(a, b);
}

const DISCOVER_RANKING_CACHE_VERSION = 'v217';

function clampDiscoverUnit(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, num));
}

function getDiscoverLogNormalizer(items = [], getter = value => value) {
  const maxValue = Math.max(
    1,
    ...(items || []).map(item => Math.log10(Math.max(0, Number(getter(item)) || 0) + 1))
  );
  return maxValue > 0 ? maxValue : 1;
}

function getDiscoverPoolPopularityScore(items = [], item = {}) {
  const maxLog = getDiscoverLogNormalizer(items, entry => entry.popularity || 0);
  return clampDiscoverUnit(Math.log10(Math.max(0, Number(item.popularity || 0)) + 1) / maxLog);
}

function getDiscoverPoolVoteConfidence(items = [], item = {}) {
  const maxLog = getDiscoverLogNormalizer(items, entry => entry.vote_count || 0);
  return clampDiscoverUnit(Math.log10(Math.max(0, Number(item.vote_count || 0)) + 1) / maxLog);
}

function getDiscoverDaysAgo(item = {}) {
  const dateTime = getDiscoverDateTime(item);
  if (!dateTime) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - dateTime) / 86400000);
}

function getDiscoverDaysUntil(item = {}) {
  const dateTime = getDiscoverDateTime(item);
  if (!dateTime) return Number.POSITIVE_INFINITY;
  return Math.max(0, (dateTime - Date.now()) / 86400000);
}

function getDiscoverPastRecencyScore(item = {}, windowDays = 35) {
  const daysAgo = getDiscoverDaysAgo(item);
  if (!Number.isFinite(daysAgo)) return 0;
  return clampDiscoverUnit(1 - (Math.min(daysAgo, windowDays) / Math.max(1, windowDays)));
}

function getDiscoverFreshnessScore(item = {}, horizonDays = 1460) {
  const daysAgo = getDiscoverDaysAgo(item);
  if (!Number.isFinite(daysAgo)) return 0;
  return clampDiscoverUnit(1 - (Math.min(daysAgo, horizonDays) / Math.max(1, horizonDays)));
}

function getDiscoverUpcomingSoonnessScore(item = {}, windowDays = 90) {
  const daysUntil = getDiscoverDaysUntil(item);
  if (!Number.isFinite(daysUntil)) return 0;
  const adjusted = Math.max(0, daysUntil - 1);
  return clampDiscoverUnit(1 - (Math.min(adjusted, windowDays) / Math.max(1, windowDays)));
}

function getDiscoverMidpointSignal(value, target = 0.42, width = 0.34) {
  return clampDiscoverUnit(1 - (Math.abs(Number(value || 0) - target) / Math.max(0.01, width)));
}

function getDiscoverTmdbMinVotes(sectionKey = 'popular', mediaType = 'tv') {
  const type = mediaType === 'anime' ? 'anime' : (mediaType === 'movie' ? 'movie' : 'tv');
  const map = {
    movie: { new: 80, upcoming: 25, yearsBest: 220, popular: 260, topRated: 700, trending: 180, hidden: 120, inTheaters: 200 },
    tv: { new: 50, upcoming: 20, yearsBest: 140, popular: 130, topRated: 320, trending: 100, hidden: 70, inTheaters: 140 },
    anime: { new: 35, upcoming: 18, yearsBest: 60, popular: 85, topRated: 110, trending: 55, hidden: 40, inTheaters: 80 }
  };
  return map[type]?.[sectionKey] || 120;
}

function getDiscoverWeightedRatingNormalized(items = [], item = {}, sectionKey = 'popular', mediaType = 'tv') {
  return clampDiscoverUnit(
    getDiscoverWeightedRatingScore(items, item, getDiscoverTmdbMinVotes(sectionKey, mediaType)) / 10
  );
}

function compareDiscoverCalculatedScoreDesc(a = {}, b = {}) {
  const scoreCompare = Number(b.calculatedScore || 0) - Number(a.calculatedScore || 0);
  if (scoreCompare) return scoreCompare;
  const voteCompare = Number(b.vote_count || 0) - Number(a.vote_count || 0);
  if (voteCompare) return voteCompare;
  const ratingCompare = Number(b.vote_average || 0) - Number(a.vote_average || 0);
  if (ratingCompare) return ratingCompare;
  const popularityCompare = Number(b.popularity || 0) - Number(a.popularity || 0);
  if (popularityCompare) return popularityCompare;
  return compareDiscoverTitleAsc(a, b);
}

function buildDiscoverTmdbContext(prefix = '', item = {}) {
  const parts = [];
  if (prefix) parts.push(prefix);
  if (Number(item.vote_average || 0) > 0) parts.push(`${Number(item.vote_average).toFixed(1)} TMDB`);
  if (Number(item.vote_count || 0) > 0) parts.push(`${Number(item.vote_count).toLocaleString()} votes`);
  return parts.join(' · ');
}

function scoreDiscoverTmdbItem(items = [], item = {}, sectionKey = 'popular', mediaType = 'tv', index = 0, total = 1) {
  const type = mediaType === 'anime' ? 'anime' : (mediaType === 'movie' ? 'movie' : 'tv');
  const popularity = getDiscoverPoolPopularityScore(items, item);
  const confidence = getDiscoverPoolVoteConfidence(items, item);
  const quality = getDiscoverWeightedRatingNormalized(items, item, sectionKey, type);
  const freshness = getDiscoverFreshnessScore(item, type === 'movie' ? 1460 : 1095);
  const releaseRecency = getDiscoverPastRecencyScore(item, type === 'movie' ? 28 : (type === 'anime' ? 42 : 35));
  const upcomingSoonness = getDiscoverUpcomingSoonnessScore(item, 90);
  const rankPosition = total > 1 ? clampDiscoverUnit(1 - (index / Math.max(1, total - 1))) : 1;
  const obscurity = 1 - ((popularity * 0.55) + (confidence * 0.45));
  const gemBalance = getDiscoverMidpointSignal((popularity * 0.45) + (confidence * 0.55), type === 'movie' ? 0.46 : 0.40, 0.34);

  if (sectionKey === 'new') {
    if (type === 'anime') return (releaseRecency * 0.52 + quality * 0.25 + popularity * 0.13 + confidence * 0.10) * 100;
    return (releaseRecency * 0.58 + popularity * 0.17 + quality * 0.18 + confidence * 0.07) * 100;
  }
  if (sectionKey === 'upcoming') {
    return (upcomingSoonness * 0.62 + popularity * 0.25 + quality * 0.09 + confidence * 0.04) * 100;
  }
  if (sectionKey === 'yearsBest') {
    if (type === 'anime') return (quality * 0.66 + confidence * 0.16 + popularity * 0.06 + freshness * 0.12) * 100;
    return (quality * 0.62 + confidence * 0.18 + popularity * 0.10 + freshness * 0.10) * 100;
  }
  if (sectionKey === 'topRated') {
    if (type === 'anime') return (quality * 0.74 + confidence * 0.14 + popularity * 0.04 + freshness * 0.08) * 100;
    return (quality * 0.72 + confidence * 0.16 + popularity * 0.07 + freshness * 0.05) * 100;
  }
  if (sectionKey === 'trending') {
    if (type === 'anime') return (rankPosition * 0.38 + quality * 0.24 + freshness * 0.16 + popularity * 0.12 + confidence * 0.10) * 100;
    return (rankPosition * 0.44 + quality * 0.20 + popularity * 0.16 + freshness * 0.12 + confidence * 0.08) * 100;
  }
  if (sectionKey === 'hiddenGems') {
    return (quality * 0.50 + gemBalance * 0.18 + obscurity * 0.18 + freshness * 0.14) * 100;
  }
  if (sectionKey === 'inTheaters') {
    return (releaseRecency * 0.32 + popularity * 0.34 + quality * 0.24 + confidence * 0.10) * 100;
  }
  if (type === 'anime') {
    return (popularity * 0.40 + quality * 0.28 + freshness * 0.20 + confidence * 0.12) * 100;
  }
  return (popularity * 0.50 + quality * 0.24 + freshness * 0.15 + confidence * 0.11) * 100;
}


function getDiscoverMediaQueryType(mediaType = 'mixed') {
  if (mediaType === 'movie' || mediaType === 'movies') return 'movie';
  if (mediaType === 'tv' || mediaType === 'shows') return 'tv';
  if (mediaType === 'anime') return 'anime';
  return 'mixed';
}

function getDiscoverNewReleaseCountryOptions() {
  return [
    { code: '', label: 'US Releases' },
    ...DISCOVER_COUNTRY_OPTIONS
  ];
}

function getValidDiscoverNewReleaseCountry(code = '') {
  const clean = String(code || '').trim().toUpperCase();
  return DISCOVER_COUNTRY_OPTIONS.some(option => option.code === clean) ? clean : '';
}

function getDiscoverNewReleaseMediaTypeForGrid(gridId = '') {
  if (gridId === 'discover-movie-new-releases-grid') return 'movie';
  if (gridId === 'discover-tv-new-releases-grid') return 'tv';
  if (gridId === 'anime-discover-new-grid') return 'anime';
  return '';
}

function isDiscoverGridCountryFilterableNewRelease(gridId = '') {
  return !!getDiscoverNewReleaseMediaTypeForGrid(gridId);
}

function markDiscoverMediaType(item = {}, mediaType = 'tv') {
  const type = mediaType === 'movie' ? 'movie' : 'tv';
  return { ...item, media_type: type };
}

function normalizeDiscoverTypedItems(items = [], mediaType = 'mixed') {
  const type = getDiscoverMediaQueryType(mediaType);
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map(item => {
      const itemType = type === 'mixed'
        ? (item.media_type === 'movie' ? 'movie' : 'tv')
        : (type === 'movie' ? 'movie' : 'tv');
      return { ...item, media_type: itemType };
    })
    .filter(item => {
      const key = `${item.media_type}:${item.id}`;
      if (!item?.id || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function isDiscoverGridNewRelease(gridId = '') {
  return [
    'discover-tv-new-releases-grid',
    'discover-movie-new-releases-grid',
    'anime-discover-new-grid',
    'discover-games-new-releases-grid',
    'discover-new-releases-grid'
  ].includes(gridId);
}

function isDiscoverGridUpcoming(gridId = '') {
  return [
    'discover-tv-releasing-soon-grid',
    'discover-movie-releasing-soon-grid',
    'discover-releasing-soon-grid',
    'discover-games-anticipated-grid',
    /* v570: new "Anticipated" category for TV, movies, anime */
    'discover-tv-anticipated-grid',
    'discover-movie-anticipated-grid',
    'anime-discover-anticipated-grid'
  ].includes(gridId);
}

async function fetchNewReleasesByDate(range = 'week', limit = DISCOVER_LIMIT, pageCount = DISCOVER_PAGE_COUNT, mediaType = 'mixed', options = {}) {
  const type = getDiscoverMediaQueryType(mediaType);
  const today = new Date().toISOString().split('T')[0];
  const dayWindow = range === 'month' ? 30 : 7;
  const startDate = new Date(Date.now() - dayWindow * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const releaseRegion = String(options.releaseRegion || DISCOVER_RELEASE_REGION || 'US').trim().toUpperCase();
  const originCountry = getValidDiscoverNewReleaseCountry(options.originCountry || '');

  const requests = [];
  if (type === 'movie' || type === 'mixed') {
    const movieParams = {
      'primary_release_date.gte': startDate,
      'primary_release_date.lte': today,
      sort_by: 'primary_release_date.desc',
      region: releaseRegion
    };
    if (originCountry) movieParams.with_origin_country = originCountry;
    requests.push(fetchTmdbPages('discover/movie', movieParams, pageCount).then(items => items.map(item => markDiscoverMediaType(item, 'movie'))));
  }
  if (type === 'tv' || type === 'mixed' || type === 'anime') {
    const params = {
      'first_air_date.gte': startDate,
      'first_air_date.lte': today,
      sort_by: 'first_air_date.desc',
      watch_region: releaseRegion,
      with_watch_monetization_types: 'flatrate|free|ads|rent|buy',
      timezone: 'America/New_York'
    };
    if (originCountry) params.with_origin_country = originCountry;
    if (type === 'anime') params.with_genres = '16';
    requests.push(fetchTmdbPages('discover/tv', params, pageCount).then(items => items.map(item => markDiscoverMediaType(item, 'tv'))));
  }

  const combined = (await Promise.all(requests)).flat();
  const candidates = normalizeDiscoverTypedItems(combined, type)
    .filter(item => hasUsableDiscoverReleaseItem(item) && (type !== 'anime' || isAnimeDiscoverCandidate(item)));
  return candidates
    .map(item => ({
      ...item,
      calculatedScore: scoreDiscoverTmdbItem(candidates, item, 'new', type),
      discoverContext: buildDiscoverTmdbContext(`Released ${formatDiscoverReleaseDate(getDiscoverReleaseDate(item))}`, item)
    }))
    .sort(compareDiscoverCalculatedScoreDesc)
    .slice(0, limit);
}

/* v570: "Anticipated" category — most-hyped upcoming releases.
   Different from "Releasing Soon" (which is purely date-sorted) — this
   is the genuine buzz pile: titles people are searching for, talking
   about, and rating sight-unseen. We blend TMDB's real-time popularity
   score (the canonical hype signal) with log-scaled vote count
   (mass-awareness signal) so something like Spider-Man: Brand New Day
   or the Mandalorian movie outranks generic-but-imminent releases. */
async function fetchAndRankAnticipated(limit = DISCOVER_LIMIT, pageCount = DISCOVER_PAGE_COUNT, mediaType = 'mixed') {
  const type = getDiscoverMediaQueryType(mediaType);
  const todayDate = new Date();
  const tomorrow = toDiscoverIsoDate(addDiscoverDays(todayDate, 1));
  const oneYearOut = toDiscoverIsoDate(addDiscoverDays(todayDate, 365));
  const requests = [];

  if (type === 'movie' || type === 'mixed') {
    requests.push(fetchTmdbPages('discover/movie', {
      'primary_release_date.gte': tomorrow,
      'primary_release_date.lte': oneYearOut,
      sort_by: 'popularity.desc',
      include_adult: 'false'
    }, pageCount).then(items => items.map(item => markDiscoverMediaType(item, 'movie'))));
  }
  if (type === 'tv' || type === 'mixed' || type === 'anime') {
    const tvParams = {
      'first_air_date.gte': tomorrow,
      'first_air_date.lte': oneYearOut,
      sort_by: 'popularity.desc',
      include_adult: 'false'
    };
    if (type === 'anime') tvParams.with_genres = '16';
    requests.push(fetchTmdbPages('discover/tv', tvParams, pageCount)
      .then(items => items.map(item => markDiscoverMediaType(item, 'tv'))));
  }

  const combined = (await Promise.all(requests)).flat();
  const candidates = normalizeDiscoverTypedItems(combined, type)
    .filter(item => hasUsableDiscoverUpcomingItem(item) && (type !== 'anime' || isAnimeDiscoverCandidate(item)));

  return candidates
    .map(item => {
      const popularity = Number(item.popularity || 0);
      const voteCount = Number(item.vote_count || 0);
      // Hype = popularity score boosted by awareness (vote count signals
      // people are already engaging — early ratings, watchlist adds, buzz).
      const hypeScore = popularity * (1 + Math.log10(voteCount + 1) * 0.45);
      return {
        ...item,
        calculatedScore: hypeScore,
        discoverContext: buildDiscoverTmdbContext(`Releases ${formatDiscoverReleaseDate(getDiscoverReleaseDate(item))}`, item)
      };
    })
    .sort(compareDiscoverCalculatedScoreDesc)
    .slice(0, limit);
}

async function fetchReleasingSoonByDate(limit = DISCOVER_LIMIT, pageCount = DISCOVER_PAGE_COUNT, mediaType = 'mixed') {
  const type = getDiscoverMediaQueryType(mediaType);
  const todayDate = new Date();
  const tomorrow = toDiscoverIsoDate(addDiscoverDays(todayDate, 1));
  const ninetyDaysOut = toDiscoverIsoDate(addDiscoverDays(todayDate, 90));
  const requests = [];

  if (type === 'movie' || type === 'mixed') {
    requests.push(fetchTmdbPages('discover/movie', {
      'primary_release_date.gte': tomorrow,
      'primary_release_date.lte': ninetyDaysOut,
      sort_by: 'primary_release_date.asc',
      region: 'US'
    }, pageCount).then(items => items.map(item => markDiscoverMediaType(item, 'movie'))));
  }
  if (type === 'tv' || type === 'mixed') {
    requests.push(fetchTmdbPages('discover/tv', {
      'first_air_date.gte': tomorrow,
      'first_air_date.lte': ninetyDaysOut,
      sort_by: 'first_air_date.asc'
    }, pageCount).then(items => items.map(item => markDiscoverMediaType(item, 'tv'))));
  }

  const combined = (await Promise.all(requests)).flat();
  const candidates = normalizeDiscoverTypedItems(combined, type)
    .filter(hasUsableDiscoverUpcomingItem);
  return candidates
    .map(item => ({
      ...item,
      calculatedScore: scoreDiscoverTmdbItem(candidates, item, 'upcoming', type),
      discoverContext: buildDiscoverTmdbContext(`Releases ${formatDiscoverReleaseDate(getDiscoverReleaseDate(item))}`, item)
    }))
    .sort(compareDiscoverCalculatedScoreDesc)
    .slice(0, limit);
}

function getDiscoverThisYearBestDate(item = {}) {
  return getDiscoverReleaseDate(item) || '';
}

function isDiscoverThisYearBestCandidate(item = {}, targetYear = new Date().getFullYear()) {
  const releaseDate = getDiscoverThisYearBestDate(item);
  const rating = Number(item.vote_average || 0);
  const votes = Number(item.vote_count || 0);
  return !!(
    item &&
    item.poster_path &&
    getDiscoverSortTitle(item) &&
    item.overview &&
    releaseDate &&
    String(releaseDate).slice(0, 4) === String(targetYear) &&
    rating > 0 &&
    votes > 0
  );
}

function getDiscoverWeightedRatingScore(items = [], item = {}, minVotes = 150) {
  const rated = items
    .map(entry => Number(entry.vote_average || 0))
    .filter(value => Number.isFinite(value) && value > 0);
  const categoryAverage = rated.length
    ? rated.reduce((sum, value) => sum + value, 0) / rated.length
    : 6.5;
  const rating = Number(item.vote_average || 0);
  const votes = Number(item.vote_count || 0);
  return (votes / (votes + minVotes)) * rating + (minVotes / (votes + minVotes)) * categoryAverage;
}

function compareDiscoverThisYearBest(a = {}, b = {}) {
  const scoreCompare = Number(b.calculatedScore || 0) - Number(a.calculatedScore || 0);
  if (scoreCompare) return scoreCompare;
  const voteCompare = Number(b.vote_count || 0) - Number(a.vote_count || 0);
  if (voteCompare) return voteCompare;
  const ratingCompare = Number(b.vote_average || 0) - Number(a.vote_average || 0);
  if (ratingCompare) return ratingCompare;
  return compareDiscoverTitleAsc(a, b);
}

async function fetchAndRankThisYearsBest(mediaType = 'mixed') {
  const type = getDiscoverMediaQueryType(mediaType);
  const year = new Date().getFullYear();
  const start = `${year}-01-01`;
  const today = toDiscoverIsoDate(new Date());
  const requests = [];

  if (type === 'movie' || type === 'mixed') {
    requests.push(fetchTmdbPages('discover/movie', {
      'primary_release_date.gte': start,
      'primary_release_date.lte': today,
      'vote_count.gte': '75',
      sort_by: 'vote_count.desc',
      region: 'US'
    }, DISCOVER_PAGE_COUNT).then(items => items.map(item => markDiscoverMediaType(item, 'movie'))));
  }
  if (type === 'tv' || type === 'mixed' || type === 'anime') {
    const params = {
      'first_air_date.gte': start,
      'first_air_date.lte': today,
      'vote_count.gte': type === 'anime' ? '30' : '50',
      sort_by: 'vote_count.desc'
    };
    if (type === 'anime') params.with_genres = '16';
    requests.push(fetchTmdbPages('discover/tv', params, type === 'anime' ? 2 : DISCOVER_PAGE_COUNT).then(items => items.map(item => markDiscoverMediaType(item, 'tv'))));
  }

  const combined = normalizeDiscoverTypedItems((await Promise.all(requests)).flat(), type);
  const candidates = combined.filter(item =>
    isDiscoverThisYearBestCandidate(item, year) &&
    (type !== 'anime' || isAnimeDiscoverCandidate(item))
  );
  return candidates.map(item => {
    const rating = Number(item.vote_average || 0);
    const votes = Number(item.vote_count || 0);
    return {
      ...item,
      calculatedScore: scoreDiscoverTmdbItem(candidates, item, 'yearsBest', type),
      discoverContext: `${year} release · ${rating.toFixed(1)} TMDB · ${votes.toLocaleString()} votes`
    };
  })
    .filter(item => Number(item.vote_average || 0) >= 6.5)
    .sort(compareDiscoverCalculatedScoreDesc)
    .slice(0, DISCOVER_LIMIT);
}

async function fetchDiscoverPopularMedia(mediaType = 'tv') {
  const type = getDiscoverMediaQueryType(mediaType);
  /* v571: combine movie+tv for the unified Movies & TV hub */
  if (type === 'mixed') {
    const [movieItems, tvItems] = await Promise.all([
      fetchDiscoverPopularMedia('movie').catch(() => []),
      fetchDiscoverPopularMedia('tv').catch(() => [])
    ]);
    return [...movieItems, ...tvItems]
      .sort(compareDiscoverCalculatedScoreDesc)
      .slice(0, DISCOVER_LIMIT);
  }
  const isMovie = type === 'movie';
  const path = isMovie ? 'discover/movie' : 'discover/tv';
  const params = {
    sort_by: 'popularity.desc',
    include_adult: 'false'
  };
  if (type === 'anime') params.with_genres = '16';
  const items = await fetchTmdbPages(path, params, DISCOVER_PAGE_COUNT);
  const candidates = normalizeDiscoverTypedItems(items, isMovie ? 'movie' : 'tv')
    .filter(item => hasUsableDiscoverReleaseItem(item) && (type !== 'anime' || isAnimeDiscoverCandidate(item)));
  return candidates
    .map(item => ({
      ...item,
      calculatedScore: scoreDiscoverTmdbItem(candidates, item, 'popular', type),
      discoverContext: buildDiscoverTmdbContext('TMDB popularity', item)
    }))
    .sort(compareDiscoverCalculatedScoreDesc)
    .slice(0, DISCOVER_LIMIT);
}

async function fetchDiscoverTopRatedMedia(mediaType = 'tv') {
  const type = getDiscoverMediaQueryType(mediaType);
  /* v571: combine movie+tv for the unified Movies & TV hub */
  if (type === 'mixed') {
    const [movieItems, tvItems] = await Promise.all([
      fetchDiscoverTopRatedMedia('movie').catch(() => []),
      fetchDiscoverTopRatedMedia('tv').catch(() => [])
    ]);
    return [...movieItems, ...tvItems]
      .sort(compareDiscoverCalculatedScoreDesc)
      .slice(0, DISCOVER_LIMIT);
  }
  const isMovie = type === 'movie';
  const path = isMovie ? 'discover/movie' : 'discover/tv';
  const params = {
    'vote_average.gte': isMovie ? '7.0' : '7.5',
    'vote_count.gte': type === 'anime' ? '40' : (isMovie ? '500' : '250'),
    sort_by: 'vote_average.desc',
    include_adult: 'false'
  };
  if (type === 'anime') params.with_genres = '16';
  const items = await fetchTmdbPages(path, params, DISCOVER_PAGE_COUNT);
  const candidates = normalizeDiscoverTypedItems(items, isMovie ? 'movie' : 'tv')
    .filter(item => item.poster_path && getDiscoverSortTitle(item) && item.overview && (type !== 'anime' || isAnimeDiscoverCandidate(item)));
  return candidates
    .map(item => {
      const rating = Number(item.vote_average || 0);
      const votes = Number(item.vote_count || 0);
      return {
        ...item,
        calculatedScore: scoreDiscoverTmdbItem(candidates, item, 'topRated', type),
        discoverContext: `${rating.toFixed(1)} TMDB · ${votes.toLocaleString()} votes`
      };
    })
    .sort(compareDiscoverCalculatedScoreDesc)
    .slice(0, DISCOVER_LIMIT);
}

function scoreDiscoverInTheaters(items = [], item = {}) {
  return scoreDiscoverTmdbItem(items, item, 'inTheaters', 'movie');
}

async function fetchInTheatersMovies(limit = DISCOVER_LIMIT) {
  const items = await fetchTmdbPages('movie/now_playing', {
    region: 'US',
    language: 'en-US'
  }, DISCOVER_PAGE_COUNT);
  const candidates = normalizeDiscoverTypedItems(items, 'movie')
    .filter(item => hasUsableDiscoverReleaseItem(item));
  return candidates.map(item => ({
    ...item,
    calculatedScore: scoreDiscoverInTheaters(candidates, item),
    discoverContext: `In theaters · Released ${formatDiscoverReleaseDate(getDiscoverReleaseDate(item))}`
  }))
    .sort((a, b) => {
      const scoreCompare = Number(b.calculatedScore || 0) - Number(a.calculatedScore || 0);
      if (scoreCompare) return scoreCompare;
      const popularityCompare = compareDiscoverPopularityDesc(a, b);
      if (popularityCompare) return popularityCompare;
      return compareDiscoverReleaseDateDesc(a, b);
    })
    .slice(0, limit);
}

async function fetchAndRankHiddenGems(mediaType = 'mixed') {
  const type = getDiscoverMediaQueryType(mediaType);
  const requests = [];
  if (type === 'movie' || type === 'mixed') {
    requests.push(fetchTmdbPages('discover/movie', {
      'vote_average.gte': '7.5',
      'vote_count.gte': '100',
      'vote_count.lte': '2000',
      sort_by: 'vote_average.desc'
    }, DISCOVER_PAGE_COUNT).then(items => items.map(item => markDiscoverMediaType(item, 'movie'))));
  }
  if (type === 'tv' || type === 'mixed') {
    requests.push(fetchTmdbPages('discover/tv', {
      'vote_average.gte': '8.0',
      'vote_count.gte': '50',
      'vote_count.lte': '1000',
      sort_by: 'vote_average.desc'
    }, DISCOVER_PAGE_COUNT).then(items => items.map(item => markDiscoverMediaType(item, 'tv'))));
  }
  const allGems = normalizeDiscoverTypedItems((await Promise.all(requests)).flat(), type);
  return allGems
    .map(item => ({
      ...item,
      calculatedScore: scoreDiscoverTmdbItem(allGems, item, 'hiddenGems', type),
      discoverContext: `${Number(item.vote_average || 0).toFixed(1)} TMDB · ${Number(item.vote_count || 0).toLocaleString()} votes`
    }))
    .filter(item => item.poster_path && getDiscoverSortTitle(item) && item.overview)
    .sort(compareDiscoverCalculatedScoreDesc)
    .slice(0, DISCOVER_LIMIT);
}

function parseDiscoverFriendWatchlistDoc(docData = {}) {
  const parsed = {};
  ['movies', 'shows', 'anime'].forEach(section => {
    try {
      parsed[section] = docData[section] ? JSON.parse(docData[section]) : [];
    } catch (e) {
      parsed[section] = [];
    }
  });
  return parsed;
}

function getDiscoverFriendSourceUsers() {
  if (isPreviewMode()) {
    return PREVIEW_COMMUNITY_USERS.map(user => ({ ...user, uid: user.uid || user.name }));
  }
  return friends.map(uid => ({ ...(usersMap[uid] || {}), uid })).filter(user => user.uid);
}

function getFriendWatchlistStatusLabel(item = {}, section = '') {
  if (section === 'movies' && item.status === 'planned') return 'Watchlist';
  if (item.status === 'watching') return section === 'anime' ? 'Watching anime' : 'Watching';
  if (item.status === 'planned') return 'Watchlist';
  return item.status ? item.status.charAt(0).toUpperCase() + item.status.slice(1) : 'Watchlist';
}


const DISCOVER_FRIEND_WATCHING_REFRESH_MS = 6 * 60 * 60 * 1000;
let discoverFriendWatchingRefreshTimer = null;
let discoverFriendWatchingRefreshInFlight = false;
let discoverFriendWatchingRefreshDebounce = null;
let discoverFriendWatchingRealtimeKey = '';
let discoverFriendWatchingRealtimeUnsubs = [];

function isDiscoverFriendWatchingGridVisible() {
  const grid = document.getElementById('discover-friends-watching-grid');
  if (!grid) return false;
  const section = grid.closest('.discover-media-tab-section');
  return !section || section.style.display !== 'none';
}

function cleanupDiscoverFriendWatchingRealtime() {
  discoverFriendWatchingRealtimeUnsubs.forEach(unsub => {
    try { if (typeof unsub === 'function') unsub(); } catch (e) {}
  });
  discoverFriendWatchingRealtimeUnsubs = [];
  discoverFriendWatchingRealtimeKey = '';
}

function scheduleDiscoverFriendWatchingRefresh(delayMs = 500) {
  clearTimeout(discoverFriendWatchingRefreshDebounce);
  discoverFriendWatchingRefreshDebounce = setTimeout(() => {
    refreshDiscoverFriendWatchingDisplays({ reason: 'scheduled' });
  }, Math.max(0, delayMs));
}

async function refreshDiscoverFriendWatchingDisplays(options = {}) {
  if (discoverFriendWatchingRefreshInFlight) return;
  if (isPreviewMode?.()) return;
  const mainGrid = document.getElementById('discover-friends-watching-grid');
  const fullPage = document.getElementById('discover-friends-full-page');
  const fullGridVisible = fullPage && fullPage.style.display !== 'none';
  if (!mainGrid && !fullGridVisible) return;

  discoverFriendWatchingRefreshInFlight = true;
  try {
    const rowItems = await fetchFriendWatchingDiscoverTitles(DISCOVER_LIMIT);
    if (mainGrid && isDiscoverFriendWatchingGridVisible()) {
      renderFriendWatchingDiscoverCards(rowItems, 'discover-friends-watching-grid', { row: true });
    }
    if (fullGridVisible) {
      const fullItems = rowItems.length >= 120 ? rowItems : await fetchFriendWatchingDiscoverTitles(120);
      renderFriendWatchingDiscoverCards(fullItems, 'discover-friends-full-grid', { fullPage: true, skipLimit: true });
    }
  } catch (e) {
    console.warn('Friend watching refresh failed:', e);
  } finally {
    discoverFriendWatchingRefreshInFlight = false;
  }
}

function ensureDiscoverFriendWatchingRealtime() {
  if (isPreviewMode?.() || !currentUser || !Array.isArray(friends) || !friends.length || typeof db === 'undefined') {
    cleanupDiscoverFriendWatchingRealtime();
    return;
  }
  const key = friends.map(uid => String(uid || '').trim()).filter(Boolean).sort().join('|');
  if (!key || key === discoverFriendWatchingRealtimeKey) return;
  cleanupDiscoverFriendWatchingRealtime();
  discoverFriendWatchingRealtimeKey = key;
  discoverFriendWatchingRealtimeUnsubs = key.split('|').map(uid => {
    try {
      return db.collection('watchlist').doc(uid).onSnapshot(() => {
        scheduleDiscoverFriendWatchingRefresh(650);
      }, error => console.warn('Friend watching realtime listener failed:', error));
    } catch (e) {
      console.warn('Friend watching realtime listener setup failed:', e);
      return null;
    }
  }).filter(Boolean);
}

function ensureDiscoverFriendWatchingRefreshSystem() {
  if (!discoverFriendWatchingRefreshTimer) {
    discoverFriendWatchingRefreshTimer = setInterval(() => {
      refreshDiscoverFriendWatchingDisplays({ reason: 'six-hour-refresh' });
    }, DISCOVER_FRIEND_WATCHING_REFRESH_MS);
  }
  ensureDiscoverFriendWatchingRealtime();
}

// v435: helper — pull the best progress signal off a watchlist item so the
// Discover row can show "Season 2, 30/40" for ongoing watches and "Just finished"
// for items that just moved Watching → Watched within the last 7 days.
const SHELFD_FRIEND_WATCHING_RECENT_FINISH_MS = 7 * 24 * 60 * 60 * 1000;
function _shelfdComputeFriendWatchingProgress(item = {}, section = '') {
  const status = String(item.status || '').toLowerCase();
  const episodes = Array.isArray(item.episodes) ? item.episodes : [];
  const watchedFromList = episodes.length ? episodes.filter(ep => ep && ep.watched).length : 0;
  const totalFromList = episodes.length;
  const total = Number(item.totalEps || item.totalEpisodes || totalFromList || 0);
  const watchedCount = Math.max(
    Number(item.currentEp || item.currentEpisode || 0),
    watchedFromList,
    status === 'watched' ? total : 0
  );
  const seasonNum = Number(
    item.currentSeason
      || item.currentSeasonNum
      || (Array.isArray(episodes) && episodes[Math.max(0, watchedCount - 1)]?.seasonNum)
      || 0
  );
  return { status, total, watchedCount, seasonNum };
}

function addFriendWatchingCandidate(grouped, item = {}, section = '', friend = {}) {
  const title = (item.title || item.name || '').trim();
  if (!title || !item.cover) return;
  const status = String(item.status || '').toLowerCase();
  // v435: include 'watched' too, but only for very-recent finishes (≤7 days). That
  // way a fresh Watching → Watched transition pops to the top of the row, while
  // someone's old watched library doesn't flood the section.
  const itemDate = Date.parse(item.lastEditedAt || item.dateLastEdited || item.dateModified || item.dateAdded || item.updatedAt || 0) || 0;
  const isRecentFinish = status === 'watched' && itemDate > 0 && (Date.now() - itemDate) <= SHELFD_FRIEND_WATCHING_RECENT_FINISH_MS;
  if (!['watching', 'planned'].includes(status) && !isRecentFinish) return;

  const key = `${section}:${title.toLowerCase()}`;
  const friendName = getDisplayName(friend, 'Friend');
  const friendProfile = {
    uid: friend.uid || friendName,
    name: friendName,
    photo: friend.photo || friend.photoURL || friend.avatar || ''
  };
  const existing = grouped.get(key) || {
    id: item.tmdbId || item.id || key,
    tmdbId: item.tmdbId || '',
    title,
    cover: item.cover,
    genre: item.genre || '',
    overview: item.overview || item.notes || '',
    section,
    friendNames: [],
    friendProfiles: [],
    friendStatuses: [],
    rating: Number(item.rating || 0),
    dateValue: 0,
    latestActivityDate: 0,
    latestActivityFriend: null,
    latestActivityStatus: '',
    latestActivityProgress: null,
    count: 0
  };
  if (!existing.friendNames.includes(friendName)) existing.friendNames.push(friendName);
  if (!existing.friendProfiles.some(profile => String(profile.uid || profile.name) === String(friendProfile.uid || friendProfile.name))) {
    existing.friendProfiles.push(friendProfile);
  }
  const statusLabel = getFriendWatchlistStatusLabel(item, section);
  if (!existing.friendStatuses.includes(statusLabel)) existing.friendStatuses.push(statusLabel);
  existing.count += 1;
  existing.rating = Math.max(existing.rating || 0, Number(item.rating || 0));
  // Track latest activity at the friend level so ordering reflects "who just
  // bumped this title" rather than just "any modification ever".
  if (itemDate > existing.latestActivityDate) {
    existing.latestActivityDate = itemDate;
    existing.latestActivityFriend = friendProfile;
    existing.latestActivityStatus = status;
    existing.latestActivityProgress = _shelfdComputeFriendWatchingProgress(item, section);
  }
  existing.dateValue = Math.max(existing.dateValue || 0, itemDate);
  grouped.set(key, existing);
}

async function fetchFriendWatchingDiscoverTitles(limit = DISCOVER_LIMIT) {
  discoverFriendWatchingMessage = 'No friend watchlist titles found yet.';
  if (!isPreviewMode() && (!currentUser || !friends.length)) {
    discoverFriendWatchingMessage = 'Add friends to see what they are watching and saving.';
    return [];
  }

  const friendUsers = getDiscoverFriendSourceUsers();
  const grouped = new Map();

  if (isPreviewMode()) {
    friendUsers.forEach(friend => {
      const listData = friend.listData || {};
      ['movies', 'shows', 'anime'].forEach(section => {
        (listData[section] || []).forEach(item => addFriendWatchingCandidate(grouped, item, section, friend));
      });
    });
  } else {
    await primeFriendProfiles();
    await Promise.all(friends.map(async uid => {
      const friend = { ...(usersMap[uid] || {}), uid };
      try {
        const snap = await db.collection('watchlist').doc(uid).get();
        if (!snap.exists) return;
        const listData = parseDiscoverFriendWatchlistDoc(snap.data() || {});
        ['movies', 'shows', 'anime'].forEach(section => {
          (listData[section] || []).forEach(item => addFriendWatchingCandidate(grouped, item, section, friend));
        });
      } catch (e) {
        console.warn('Friend watchlist discover fetch failed:', e);
      }
    }));
  }

  // v435: ordering is now activity-recency first, count + rating only as tiebreakers.
  // A friend bumping an episode (5→6) updates lastEditedAt/dateModified, which sets
  // latestActivityDate, which puts that title at the front of the row.
  return Array.from(grouped.values())
    .map(item => {
      const recencyMs = item.latestActivityDate || item.dateValue || 0;
      return {
        ...item,
        calculatedScore: recencyMs,
        secondaryScore: (item.count * 12) + Number(item.rating || 0) * 1.4,
        discoverContext: `${item.friendNames.join(', ')} · ${item.friendStatuses.join(' / ')}`
      };
    })
    .sort((a, b) => {
      if (b.calculatedScore !== a.calculatedScore) return b.calculatedScore - a.calculatedScore;
      return b.secondaryScore - a.secondaryScore;
    })
    .slice(0, limit || 999);
}


async function fetchAnimeDiscoverTitles(kind) {
  if (kind === 'new') {
    return fetchNewReleasesByDate('month', DISCOVER_LIMIT, DISCOVER_PAGE_COUNT, 'anime');
  }
  if (kind === 'years-best') {
    return fetchAndRankThisYearsBest('anime');
  }
  if (kind === 'rated') {
    return fetchDiscoverTopRatedMedia('anime');
  }
  if (kind === 'trending') {
    return fetchTmdbWeeklyTrendingMedia('anime');
  }
  if (kind === 'popular') {
    return fetchDiscoverPopularMedia('anime');
  }
  if (kind === 'anticipated') {
    return fetchAndRankAnticipated(DISCOVER_LIMIT, DISCOVER_PAGE_COUNT, 'anime');
  }
  return fetchDiscoverPopularMedia('anime');
}

async function loadAnimeDiscover(force = false) {
  if (animeDiscoverLoading || (animeDiscoverLoaded && !force && isDiscoverMemoryFresh(animeDiscoverLoadedAt))) return;
  animeDiscoverLoading = true;
  renderAnimeDiscoverLoading();
  try {
    const sections = [
      ['new', 'anime-discover-new-grid'],
      ['years-best', 'anime-discover-years-best-grid'],
      ['popular', 'anime-discover-popular-grid'],
      ['rated', 'anime-discover-rated-grid'],
      ['trending', 'anime-discover-trending-grid'],
      ['anticipated', 'anime-discover-anticipated-grid']
    ];

    for (const [kind, gridId] of sections) {
      try {
        await renderDiscoverCachedRow({
          cacheKey: `anime:${kind}:${DISCOVER_RANKING_CACHE_VERSION}`,
          fetcher: () => fetchAnimeDiscoverTitles(kind),
          render: items => renderDiscoverCards('tv', items, gridId),
          force
        });
      } catch (e) {
        console.error(`Anime discover ${kind} row failed:`, e);
        renderDiscoverGridError(gridId, 'Anime titles could not load. It will try again automatically later.');
      }
    }

    animeDiscoverLoaded = true;
    animeDiscoverLoadedAt = Date.now();
  } catch (e) {
    console.error('Anime discover load failed:', e);
    renderAnimeDiscoverError('Anime discovery could not load. It will try again automatically later.');
  } finally {
    animeDiscoverLoading = false;
  }
}

async function fetchStreamingTitles() {
  const [movies, tv] = await Promise.all([
    fetchTmdbPages('discover/movie', {
      sort_by: 'popularity.desc',
      watch_region: DISCOVER_STREAMING_REGION,
      with_watch_monetization_types: 'flatrate'
    }, DISCOVER_PAGE_COUNT),
    fetchTmdbPages('discover/tv', {
      sort_by: 'popularity.desc',
      watch_region: DISCOVER_STREAMING_REGION,
      with_watch_monetization_types: 'flatrate'
    }, DISCOVER_PAGE_COUNT)
  ]);
  return movies.map(item => ({ ...item, media_type: 'movie' }))
    .concat(tv.map(item => ({ ...item, media_type: 'tv' })))
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    .slice(0, DISCOVER_LIMIT);
}

function handleDiscoverSearchKey(event, source) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  if (source === 'rawg') searchGamesDiscoverDatabase();
  else if (source === 'anime') searchAnimeDiscoverDatabase();
  else searchDiscoverDatabase();
}

const discoverSearchTimers = { tmdb: null, anime: null, rawg: null };
const discoverSearchRequestTokens = { tmdb: 0, anime: 0, rawg: 0 };
const DISCOVER_SEARCH_DEBOUNCE_MS = 180;

function handleDiscoverSearchInput(source, value) {
  if (discoverSearchTimers[source]) {
    clearTimeout(discoverSearchTimers[source]);
    discoverSearchTimers[source] = null;
  }

  const query = String(value || '').trim();
  if (!query) {
    discoverSearchRequestTokens[source] += 1;
    clearDiscoverDatabaseSearch(source);
    return;
  }

  discoverSearchTimers[source] = setTimeout(() => {
    discoverSearchTimers[source] = null;
    if (source === 'rawg') searchGamesDiscoverDatabase();
    else if (source === 'anime') searchAnimeDiscoverDatabase();
    else searchDiscoverDatabase();
  }, DISCOVER_SEARCH_DEBOUNCE_MS);
}

function setDiscoverSearchSection(source, visible) {
  const id = source === 'rawg'
    ? 'games-discover-search-section'
    : source === 'anime'
      ? 'anime-discover-search-section'
      : 'discover-search-section';
  const section = document.getElementById(id);
  if (!section) return;
  section.classList.toggle('active', visible);
  section.style.display = visible ? 'block' : 'none';
}

function clearDiscoverDatabaseSearch(source) {
  const isRawg = source === 'rawg';
  const isAnime = source === 'anime';
  const input = document.getElementById(
    isRawg ? 'games-discover-search-input' : isAnime ? 'anime-discover-search-input' : 'discover-search-input'
  );
  const grid = document.getElementById(
    isRawg ? 'discover-games-search-grid' : isAnime ? 'anime-discover-search-grid' : 'discover-search-grid'
  );
  const button = grid ? getDiscoverExpandButton(grid) : null;
  if (input) input.value = '';
  if (grid) {
    grid.innerHTML = '';
    grid.dataset.expanded = 'false';
    delete grid.dataset.visibleCount;
  }
  if (button) button.style.display = 'none';
  setDiscoverSearchSection(source, false);
}

async function fetchTmdbSearchResults(query) {
  const pages = Array.from({ length: DISCOVER_PAGE_COUNT }, (_, i) => i + 1);
  const settled = await Promise.allSettled(pages.map(async page => {
    const res = await fetchTmdbProxy('search/multi', { query, page: String(page) });
    if (!res.ok) throw new Error(`TMDB search request failed: ${res.status}`);
    const json = await res.json();
    return json.results || [];
  }));
  const seen = new Set();
  const items = settled
    .filter(result => result.status === 'fulfilled')
    .flatMap(result => result.value)
    .filter(item => {
      const type = item.media_type;
      const key = `${type}:${item.id}`;
      if ((type !== 'movie' && type !== 'tv') || !item.poster_path || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return preferDiscoverUniversalPrefixMatches(items, query)
    .sort((a, b) => {
      const scoreCompare = scoreDiscoverUniversalTmdbResult(b, query) - scoreDiscoverUniversalTmdbResult(a, query);
      if (scoreCompare) return scoreCompare;
      return String((a.title || a.name || '')).localeCompare(String(b.title || b.name || ''), undefined, { sensitivity: 'base' });
    })
    .slice(0, DISCOVER_LIMIT);
}

async function searchDiscoverDatabase() {
  const input = document.getElementById('discover-search-input');
  const grid = document.getElementById('discover-search-grid');
  if (!input || !grid) return;
  const query = input.value.trim();
  if (!query) return clearDiscoverDatabaseSearch('tmdb');
  const requestToken = ++discoverSearchRequestTokens.tmdb;
  setDiscoverSearchSection('tmdb', true);
  const button = getDiscoverExpandButton(grid);
  if (button) button.style.display = 'none';
  grid.innerHTML = '<div class="discover-message">Searching TMDB...</div>';
  try {
    const items = await fetchTmdbSearchResults(query);
    if (requestToken !== discoverSearchRequestTokens.tmdb || input.value.trim() !== query) return;
    renderDiscoverCards('mixed', items, 'discover-search-grid');
  } catch(e) {
    if (requestToken !== discoverSearchRequestTokens.tmdb) return;
    console.error('TMDB search failed:', e);
    grid.innerHTML = '<div class="discover-message">Search failed. Try again.</div>';
  }
}

async function searchAnimeDiscoverDatabase() {
  const input = document.getElementById('anime-discover-search-input');
  const grid = document.getElementById('anime-discover-search-grid');
  if (!input || !grid) return;
  const query = input.value.trim();
  if (!query) return clearDiscoverDatabaseSearch('anime');
  const requestToken = ++discoverSearchRequestTokens.anime;
  setDiscoverSearchSection('anime', true);
  const button = getDiscoverExpandButton(grid);
  if (button) button.style.display = 'none';
  grid.innerHTML = '<div class="discover-message">Searching anime titles...</div>';
  try {
    const items = (await fetchTmdbSearchResults(query)).filter(isAnimeDiscoverCandidate);
    if (requestToken !== discoverSearchRequestTokens.anime || input.value.trim() !== query) return;
    renderDiscoverCards('tv', items, 'anime-discover-search-grid');
  } catch (e) {
    if (requestToken !== discoverSearchRequestTokens.anime) return;
    console.error('Anime discover search failed:', e);
    grid.innerHTML = '<div class="discover-message">Search failed. Try again.</div>';
  }
}

function mergeDiscoverUniversalSearchItems(groups = []) {
  const seen = new Set();
  return groups.flat().filter(item => {
    const key = String(item?.id || item?.slug || item?.name || '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchRawgSearchResults(query) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return [];
  const settled = await Promise.allSettled([
    fetchRawgPages({ search: cleanQuery }, DISCOVER_PAGE_COUNT, 90),
    fetchRawgPages({ search: cleanQuery, search_precise: 'true' }, 2, 60),
    fetchRawgPages({ search: cleanQuery, search_exact: 'true' }, 1, 40),
    fetchRawgPages({ search: cleanQuery, ordering: '-added' }, 2, 60)
  ]);
  const pool = mergeDiscoverUniversalSearchItems(
    settled.filter(result => result.status === 'fulfilled').map(result => result.value || [])
  );
  const rankedPool = pool
    .map(item => ({
      ...item,
      calculatedScore: scoreDiscoverUniversalGameResult(item, cleanQuery),
      discoverContext: buildGameDiscoverContext(item)
    }))
    .sort((a, b) => {
      const scoreCompare = Number(b.calculatedScore || 0) - Number(a.calculatedScore || 0);
      if (scoreCompare) return scoreCompare;
      const addedCompare = gameAddedCount(b) - gameAddedCount(a);
      if (addedCompare) return addedCompare;
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
    });
  return preferDiscoverUniversalPrefixMatches(rankedPool, cleanQuery).slice(0, DISCOVER_LIMIT);
}

async function searchGamesDiscoverDatabase() {
  const input = document.getElementById('games-discover-search-input');
  const grid = document.getElementById('discover-games-search-grid');
  if (!input || !grid) return;
  const query = input.value.trim();
  if (!query) return clearDiscoverDatabaseSearch('rawg');
  const requestToken = ++discoverSearchRequestTokens.rawg;
  setDiscoverSearchSection('rawg', true);
  const button = getDiscoverExpandButton(grid);
  if (button) button.style.display = 'none';
  grid.innerHTML = '<div class="discover-message">Searching RAWG...</div>';
  try {
    const items = await fetchRawgSearchResults(query);
    if (requestToken !== discoverSearchRequestTokens.rawg || input.value.trim() !== query) return;
    renderGamesDiscoverCards(items, 'discover-games-search-grid');
  } catch(e) {
    if (requestToken !== discoverSearchRequestTokens.rawg) return;
    console.error('RAWG search failed:', e);
    grid.innerHTML = '<div class="discover-message">Search failed. Try again.</div>';
  }
}


// v277: Mobile/PWA universal Discovery search. Restores the header search button with a real fullscreen search overlay.
let discoverUniversalSearchSource = 'tmdb';
let discoverUniversalSearchTimer = null;
let discoverUniversalSearchToken = 0;
let discoverUniversalSearchFilterState = null;
let discoverUniversalSearchDefaultLoading = false;
const DISCOVER_UNIVERSAL_SEARCH_DEBOUNCE_MS = 90;
const DISCOVER_UNIVERSAL_SEARCH_DEFAULT_LIMIT = 21;

function normalizeDiscoverUniversalSearchSource(source = '') {
  const key = String(source || '').trim().toLowerCase();
  if (!key || key === 'all' || key === 'all-media' || key === 'all_media' || key === 'tmdb') return 'tmdb';
  if (key === 'gaming' || key === 'games' || key === 'game' || key === 'rawg') return 'rawg';
  if (key === 'anime') return 'anime';
  if (key === 'movies' || key === 'movie') return 'movie';
  if (key === 'tv' || key === 'shows' || key === 'show') return 'tv';
  return 'tmdb';
}

function getDiscoverUniversalSearchPlaceholder(source = discoverUniversalSearchSource) {
  if (source === 'rawg') return 'Search games';
  if (source === 'anime') return 'Search anime';
  if (source === 'movie') return 'Search movies';
  if (source === 'tv') return 'Search TV shows';
  return 'Search all media';
}

function getDiscoverUniversalSearchFilterGridId(source = discoverUniversalSearchSource) {
  const normalized = normalizeDiscoverUniversalSearchSource(source);
  if (normalized === 'movie') return 'discover-movie-universal-search-grid';
  if (normalized === 'tv') return 'discover-tv-universal-search-grid';
  if (normalized === 'anime') return 'anime-discover-universal-search-grid';
  if (normalized === 'tmdb') return 'discover-universal-search-grid';
  return '';
}

function isDiscoverUniversalSearchFilterable(source = discoverUniversalSearchSource) {
  return ['tmdb', 'movie', 'tv', 'anime'].includes(normalizeDiscoverUniversalSearchSource(source));
}

function ensureDiscoverUniversalSearchFilterState() {
  const gridId = getDiscoverUniversalSearchFilterGridId();
  if (!discoverUniversalSearchFilterState || discoverUniversalSearchFilterState.gridId !== gridId) {
    discoverUniversalSearchFilterState = {
      mode: 'universal-search',
      gridId,
      sortKey: 'default',
      newReleaseCountryCode: '',
      newReleaseRange: discoverNewReleaseRange,
      filters: discoverUniversalSearchFilterState?.filters || getEmptyDiscoverCategoryFilters(),
      overrideItems: null,
      overrideRenderer: null,
      overrideType: null
    };
  }
  return discoverUniversalSearchFilterState;
}

function getDiscoverUniversalSearchFilterCount() {
  const state = ensureDiscoverUniversalSearchFilterState();
  const filters = state.filters || getEmptyDiscoverCategoryFilters();
  return Object.keys(DISCOVER_CATEGORY_FILTER_GROUPS).reduce((sum, key) => sum + (filters[key]?.length || 0), 0);
}

function updateDiscoverUniversalSearchFilterButtonState() {
  const btn = document.getElementById('discover-universal-search-filter-btn');
  if (!btn) return;
  const filterable = isDiscoverUniversalSearchFilterable();
  const count = filterable ? getDiscoverUniversalSearchFilterCount() : 0;
  btn.style.display = filterable ? 'inline-flex' : 'none';
  btn.classList.toggle('has-active-filter', !!count);
  btn.setAttribute('aria-label', count ? `Filter Discovery search. ${count} active` : 'Filter Discovery search');
  const label = btn.querySelector('.discover-universal-search-filter-label');
  if (label) label.textContent = count ? `Filter ${count}` : 'Filter';
}

function syncDiscoverUniversalSearchFilterContext() {
  if (!isDiscoverUniversalSearchFilterable()) {
    updateDiscoverUniversalSearchFilterButtonState();
    return null;
  }
  const state = ensureDiscoverUniversalSearchFilterState();
  state.gridId = getDiscoverUniversalSearchFilterGridId();
  state.mode = 'universal-search';
  discoverCategoryFullState = state;
  updateDiscoverUniversalSearchFilterButtonState();
  return state;
}

function ensureDiscoverUniversalSearchOverlay() {
  let overlay = document.getElementById('discover-universal-search-overlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'discover-universal-search-overlay';
  overlay.className = 'discover-universal-search-overlay shelfline-filter-ui discover-universal-search-shelfline';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.dataset.uiPattern = 'ShelfLine Filter UI';
  overlay.innerHTML = `
    <div class="discover-universal-search-panel" role="dialog" aria-modal="true" aria-label="Search Discovery">
      <button class="discover-universal-search-notch" type="button" onclick="closeDiscoverUniversalSearch()" aria-label="Close search"></button>
      <div class="discover-universal-search-titlebar">
        <button class="discover-universal-search-back" type="button" onclick="closeDiscoverUniversalSearch()" aria-label="Close search">←</button>
        <div class="discover-universal-search-title">Search</div>
        <button id="discover-universal-search-clear" class="discover-universal-search-clear" type="button" onclick="clearDiscoverUniversalSearch()" aria-label="Clear search" style="display:none;">×</button>
      </div>
      <div class="discover-universal-search-header">
        <input id="discover-universal-search-input" class="discover-universal-search-input" type="search" inputmode="search" autocomplete="off" spellcheck="false" placeholder="Search Discovery" oninput="queueDiscoverUniversalSearch(this.value)" onkeydown="handleDiscoverUniversalSearchKey(event)">
        <button id="discover-universal-search-filter-btn" class="discover-category-filter-btn discover-universal-search-filter-btn" type="button" onclick="openDiscoverUniversalSearchFilterSheet()" aria-label="Filter Discovery search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <span class="discover-universal-search-filter-label">Filter</span>
        </button>
      </div>
      <div class="discover-universal-search-subtitle">Search across Discovery without leaving this page.</div>
      <div class="discover-universal-search-tabs" aria-label="Discovery search categories">
        <button class="discover-universal-search-tab" type="button" data-discover-search-source="tmdb" onclick="switchDiscoverUniversalSearchSource('tmdb')">All Media</button>
        <button class="discover-universal-search-tab" type="button" data-discover-search-source="movie" onclick="switchDiscoverUniversalSearchSource('movie')">Movies</button>
        <button class="discover-universal-search-tab" type="button" data-discover-search-source="tv" onclick="switchDiscoverUniversalSearchSource('tv')">TV Shows</button>
        <button class="discover-universal-search-tab" type="button" data-discover-search-source="anime" onclick="switchDiscoverUniversalSearchSource('anime')">Anime</button>
        <button class="discover-universal-search-tab" type="button" data-discover-search-source="rawg" onclick="switchDiscoverUniversalSearchSource('rawg')">Games</button>
      </div>
      <div class="discover-universal-search-divider" aria-hidden="true"></div>
      <div class="discover-universal-search-body">
        <div id="discover-universal-search-grid" class="discover-grid"></div>
      </div>
    </div>`;
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeDiscoverUniversalSearch();
  });
  document.body.appendChild(overlay);
  attachDiscoverUniversalSearchSwipeHandlers(overlay);
  return overlay;
}


let discoverUniversalSearchSwipeState = null;

function attachDiscoverUniversalSearchSwipeHandlers(overlay) {
  if (!overlay || overlay.dataset.swipeReady === '1') return;
  overlay.dataset.swipeReady = '1';
  const dragZones = overlay.querySelectorAll('.discover-universal-search-notch, .discover-universal-search-header');
  const startSwipe = event => {
    if (!overlay.classList.contains('open')) return;
    const point = event.touches ? event.touches[0] : event;
    if (!point) return;
    discoverUniversalSearchSwipeState = {
      startY: point.clientY,
      currentY: point.clientY,
      startTime: performance.now()
    };
    overlay.classList.add('discover-universal-search-dragging');
  };
  const moveSwipe = event => {
    if (!discoverUniversalSearchSwipeState) return;
    const point = event.touches ? event.touches[0] : event;
    if (!point) return;
    const dy = Math.max(0, point.clientY - discoverUniversalSearchSwipeState.startY);
    discoverUniversalSearchSwipeState.currentY = point.clientY;
    if (dy > 2) event.preventDefault?.();
    overlay.style.transform = `translate3d(0, ${Math.round(dy)}px, 0)`;
  };
  const endSwipe = () => {
    if (!discoverUniversalSearchSwipeState) return;
    const dy = Math.max(0, discoverUniversalSearchSwipeState.currentY - discoverUniversalSearchSwipeState.startY);
    const elapsed = Math.max(1, performance.now() - discoverUniversalSearchSwipeState.startTime);
    const velocity = dy / elapsed;
    discoverUniversalSearchSwipeState = null;
    overlay.classList.remove('discover-universal-search-dragging');
    if (dy > 86 || velocity > 0.55) {
      overlay.style.transform = '';
      closeDiscoverUniversalSearch();
      return;
    }
    overlay.classList.add('discover-universal-search-swipe-cancel');
    overlay.style.transform = '';
    setTimeout(() => overlay.classList.remove('discover-universal-search-swipe-cancel'), 310);
  };
  dragZones.forEach(zone => {
    zone.addEventListener('touchstart', startSwipe, { passive: true });
    zone.addEventListener('touchmove', moveSwipe, { passive: false });
    zone.addEventListener('touchend', endSwipe, { passive: true });
    zone.addEventListener('touchcancel', endSwipe, { passive: true });
    zone.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse') return;
      startSwipe(event);
    }, { passive: true });
    zone.addEventListener('pointermove', event => {
      if (event.pointerType === 'mouse') return;
      moveSwipe(event);
    }, { passive: false });
    zone.addEventListener('pointerup', event => {
      if (event.pointerType === 'mouse') return;
      endSwipe(event);
    }, { passive: true });
    zone.addEventListener('pointercancel', event => {
      if (event.pointerType === 'mouse') return;
      endSwipe(event);
    }, { passive: true });
  });
}

function setDiscoverUniversalSearchSource(source = 'tmdb') {
  discoverUniversalSearchSource = normalizeDiscoverUniversalSearchSource(source);
  const overlay = ensureDiscoverUniversalSearchOverlay();
  overlay.querySelectorAll('.discover-universal-search-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.discoverSearchSource === discoverUniversalSearchSource);
  });
  const input = document.getElementById('discover-universal-search-input');
  if (input) input.placeholder = getDiscoverUniversalSearchPlaceholder(discoverUniversalSearchSource);
  ensureDiscoverUniversalSearchFilterState();
  syncDiscoverUniversalSearchFilterContext();
}

function openDiscoverUniversalSearch(source = 'tmdb') {
  const overlay = ensureDiscoverUniversalSearchOverlay();
  setDiscoverUniversalSearchSource(source || 'tmdb');
  overlay.style.display = 'flex';
  overlay.style.transform = '';
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('discover-universal-search-open');
  requestAnimationFrame(() => overlay.classList.add('open'));
  const input = document.getElementById('discover-universal-search-input');
  if (input) {
    input.placeholder = getDiscoverUniversalSearchPlaceholder(discoverUniversalSearchSource);
    setTimeout(() => input.focus({ preventScroll: true }), 80);
  }
  const grid = document.getElementById('discover-universal-search-grid');
  syncDiscoverUniversalSearchFilterContext();
  if (grid && !String(input?.value || '').trim()) {
    renderDiscoverUniversalSearchDefault(true);
  }
}

function closeDiscoverUniversalSearch() {
  const overlay = document.getElementById('discover-universal-search-overlay');
  if (!overlay) return;
  discoverUniversalSearchSwipeState = null;
  overlay.classList.remove('open', 'discover-universal-search-dragging', 'discover-universal-search-swipe-cancel');
  overlay.style.transform = '';
  overlay.style.opacity = '';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.dataset.uiPattern = 'ShelfLine Filter UI';
  document.body.classList.remove('discover-universal-search-open');
  setTimeout(() => {
    if (!overlay.classList.contains('open')) overlay.style.display = 'none';
  }, 320);
}

function clearDiscoverUniversalSearch() {
  discoverUniversalSearchToken += 1;
  if (discoverUniversalSearchTimer) {
    clearTimeout(discoverUniversalSearchTimer);
    discoverUniversalSearchTimer = null;
  }
  const input = document.getElementById('discover-universal-search-input');
  const clearBtn = document.getElementById('discover-universal-search-clear');
  const grid = document.getElementById('discover-universal-search-grid');
  if (input) input.value = '';
  if (clearBtn) clearBtn.style.display = 'none';
  if (grid) renderDiscoverUniversalSearchDefault(true);
  if (input) input.focus({ preventScroll: true });
}

function switchDiscoverUniversalSearchSource(source = 'tmdb') {
  setDiscoverUniversalSearchSource(source);
  const input = document.getElementById('discover-universal-search-input');
  const query = String(input?.value || '').trim();
  if (query) runDiscoverUniversalSearch(query);
  else renderDiscoverUniversalSearchDefault(true);
}

function handleDiscoverUniversalSearchKey(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeDiscoverUniversalSearch();
    return;
  }
  if (event.key !== 'Enter') return;
  event.preventDefault();
  runDiscoverUniversalSearch(event.target?.value || '');
}

function queueDiscoverUniversalSearch(value = '') {
  const clearBtn = document.getElementById('discover-universal-search-clear');
  if (clearBtn) clearBtn.style.display = String(value || '').trim() ? 'flex' : 'none';
  if (discoverUniversalSearchTimer) clearTimeout(discoverUniversalSearchTimer);
  discoverUniversalSearchTimer = setTimeout(() => {
    discoverUniversalSearchTimer = null;
    runDiscoverUniversalSearch(value);
  }, DISCOVER_UNIVERSAL_SEARCH_DEBOUNCE_MS);
}

function normalizeDiscoverUniversalRankText(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getDiscoverUniversalCompactTitleKey(value = '') {
  return normalizeDiscoverUniversalRankText(value).replace(/[^a-z0-9]/g, '');
}

function getDiscoverUniversalTitleCandidates(item = {}) {
  return [
    item.title,
    item.name,
    item.original_title,
    item.original_name,
    item.slug ? String(item.slug).replace(/-/g, ' ') : ''
  ].map(value => String(value || '').trim()).filter(Boolean);
}

function getDiscoverUniversalTitleMatchScore(query = '', title = '') {
  const q = normalizeDiscoverUniversalRankText(query);
  const t = normalizeDiscoverUniversalRankText(title);
  const compactQ = getDiscoverUniversalCompactTitleKey(query);
  const compactT = getDiscoverUniversalCompactTitleKey(title);
  if (!q || !t || !compactQ || !compactT) return 0;

  const tokens = q.split(' ').filter(Boolean);
  const titleTokens = t.split(' ').filter(Boolean);
  let score = 0;

  if (compactT === compactQ) score += 1000000;
  else if (compactT.startsWith(compactQ)) score += 900000 + (compactQ.length * 9000);
  else if (t === q) score += 820000;
  else if (t.startsWith(q)) score += 760000 + (q.length * 5500);
  else if (t.includes(q)) score += 260000 + (q.length * 1800);

  if (tokens.length) {
    const leadingMatches = tokens.reduce((count, token, index) => {
      return count + (titleTokens[index] && titleTokens[index].startsWith(token) ? 1 : 0);
    }, 0);
    const matchedTokens = tokens.filter(token => titleTokens.some(titleToken => titleToken.startsWith(token) || titleToken.includes(token))).length;
    score += (leadingMatches / tokens.length) * 145000;
    score += (matchedTokens / tokens.length) * 50000;
    if (tokens.length > 1 && leadingMatches === tokens.length) score += 125000;
    if (tokens.length > 1 && matchedTokens === tokens.length) score += 45000;
  }

  return score;
}

function getDiscoverUniversalBestTitleMatchScore(query = '', item = {}) {
  return Math.max(0, ...getDiscoverUniversalTitleCandidates(item).map(title => getDiscoverUniversalTitleMatchScore(query, title)));
}

function isDiscoverUniversalPrefixTitleMatch(query = '', item = {}) {
  const compactQ = getDiscoverUniversalCompactTitleKey(query);
  const spacedQ = normalizeDiscoverUniversalRankText(query);
  if (!compactQ || !spacedQ) return false;
  return getDiscoverUniversalTitleCandidates(item).some(title => {
    const compactT = getDiscoverUniversalCompactTitleKey(title);
    const spacedT = normalizeDiscoverUniversalRankText(title);
    return compactT.startsWith(compactQ) || spacedT.startsWith(spacedQ);
  });
}

function preferDiscoverUniversalPrefixMatches(rows = [], query = '') {
  const prefixRows = rows.filter(row => isDiscoverUniversalPrefixTitleMatch(query, row.item || row));
  return prefixRows.length ? prefixRows : rows;
}

function scoreDiscoverUniversalTmdbResult(item = {}, query = '') {
  const title = item.title || item.name || item.original_title || item.original_name || '';
  const popularity = Number(item.popularity || 0);
  const votes = Number(item.vote_count || 0);
  const rating = Number(item.vote_average || 0);
  const releaseDate = item.release_date || item.first_air_date || '';
  const year = Number(String(releaseDate).slice(0, 4));
  const recency = Number.isFinite(year) && year > 0 ? Math.max(0, Math.min(120, year - 1980)) : 0;
  return getDiscoverUniversalBestTitleMatchScore(query, item)
    + (popularity * 18)
    + (Math.log10(votes + 1) * 520)
    + (rating * 42)
    + recency;
}

function scoreDiscoverUniversalGameResult(item = {}, query = '') {
  const title = item.name || '';
  const added = Number(item.added || 0);
  const ratings = Number(item.ratings_count || item.reviews_count || 0);
  const rating = Number(item.rating || 0);
  const metacritic = Number(item.metacritic || 0);
  const releasedYear = Number(String(item.released || '').slice(0, 4));
  const recency = Number.isFinite(releasedYear) && releasedYear > 0 ? Math.max(0, Math.min(80, releasedYear - 1990)) : 0;
  return getDiscoverUniversalBestTitleMatchScore(query, item)
    + (Math.log10(added + 1) * 420)
    + (Math.log10(ratings + 1) * 420)
    + (rating * 120)
    + (metacritic * 4)
    + recency;
}

function getDiscoverUniversalMediaLabel(kind = 'tmdb', item = {}) {
  if (kind === 'game') return 'Game';
  if (isAnimeDiscoverCandidate(item)) return 'Anime';
  return item.media_type === 'movie' ? 'Movie' : 'TV Show';
}

function buildDiscoverUniversalTmdbRow(row = {}) {
  const item = row.item || {};
  const itemType = item.media_type || 'movie';
  const title = item.title || item.name || '';
  const year = (item.release_date || item.first_air_date || '').slice(0, 4);
  const genreLine = getDiscoverGenreNames(item, itemType).slice(0, 2).join(' · ');
  const poster = item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : '';
  const overview = item.overview || '';
  const section = itemType === 'movie' ? 'movies' : 'shows';
  const alreadyAdded = isDuplicateTitle(title, section);
  const titleAttr = escAttr(title);
  const addClick = `openDiscoveryAddModal('${itemType}', ${item.id}, this)`;
  const removeClick = `removeDiscoveryTitle(this)`;
  setDiscoverMediaProfileSeed(itemType, item.id, {
    title,
    name: title,
    overview,
    poster,
    poster_path: item.poster_path || '',
    backdrop_path: item.backdrop_path || '',
    release_date: item.release_date || '',
    first_air_date: item.first_air_date || '',
    vote_average: item.vote_average || '',
    vote_count: item.vote_count || '',
    genreNames: getDiscoverGenreNames(item, itemType)
  });
  return `<div class="discover-card discover-universal-search-result-row" data-universal-kind="${escAttr(getDiscoverUniversalMediaLabel('tmdb', item))}">
    <div class="discover-poster" data-poster="${escAttr(poster)}" data-media-type="${itemType}" data-media-id="${item.id}" data-discover-title="${titleAttr}" data-discover-section="${section}" onclick="handleDiscoverPosterClick(event, this, '${itemType}', ${item.id})">
      ${poster ? buildDiscoverPosterMarkup(poster) : ''}${getDiscoverFriendStackMarkup(title, section)}
    </div>
    <div class="discover-card-body" onclick="handleDiscoverCardBodyTap(event, this)">
      <div class="discover-card-info-row">
        <div class="discover-card-info-stack">
          <div class="discover-universal-search-result-type">${escHtml(getDiscoverUniversalMediaLabel('tmdb', item))}</div>
          <button class="discover-card-title discover-title-profile-btn" type="button" onclick="openDiscoverMediaProfile(event, '${itemType}', ${item.id})">${escHtml(title)}${year ? ` (${year})` : ''}</button>
          ${genreLine ? `<div class="discover-card-genre">${escHtml(genreLine)}</div>` : ''}
        </div>
        <button class="discover-close-btn" type="button" onclick="handleDiscoverCloseClick(event, this)">Close</button>
      </div>
      <div class="discover-card-overview">${overview ? escHtml(overview) : ''}</div>
      <button class="discover-add-btn${alreadyAdded ? ' added' : ''}" data-discover-type="${itemType}" data-discover-id="${item.id}" data-discover-section="${section}" data-discover-title="${titleAttr}" title="${alreadyAdded ? 'Click to remove from your library' : ''}" onclick="${alreadyAdded ? removeClick : addClick}">${alreadyAdded ? getDiscoverLibraryButtonText(title, section) : '+ Add to Library'}</button>
    </div>
  </div>`;
}

function buildDiscoverUniversalGameRow(row = {}) {
  const item = row.item || {};
  const title = item.name || '';
  const year = (item.released || '').slice(0, 4);
  const poster = typeof getScreenListDisplayGameCover === 'function' ? getScreenListDisplayGameCover(item) : (typeof getScreenListPreferredGameCover === 'function' ? getScreenListPreferredGameCover(item) : '');
  const genres = (item.genres || []).map(g => g.name).slice(0, 3).join(', ');
  const platforms = (item.platforms || []).map(p => p.platform?.name).filter(Boolean).slice(0, 3).join(', ');
  const overview = genres || platforms || 'Game';
  const seed = {
    rawgId: String(item.id || ''),
    rawgSlug: item.slug || '',
    backloggdSlug: item.slug || '',
    metacriticSlug: item.slug || '',
    title,
    name: title,
    released: item.released || '',
    background_image: poster,
    cover: poster,
    poster,
    image: poster,
    igdbCoverUrl: item.igdbCoverUrl || '',
    genres: item.genres || [],
    platforms: item.platforms || [],
    metacritic: item.metacritic || '',
    rating: item.rating || '',
    ratings_count: item.ratings_count || item.reviews_count || 0
  };
  setGameMediaProfileSeed(item.id, seed);
  const alreadyAdded = isDuplicateTitle(title, 'games');
  const titleAttr = escAttr(title);
  const addClick = `openDiscoveryAddModal('game', ${item.id}, this)`;
  const removeClick = `removeDiscoveryTitle(this)`;
  return `<div class="discover-card games-discover-card discover-universal-search-result-row" data-universal-kind="Game">
    <div class="discover-poster${poster ? '' : ' no-img screenlist-game-cover-pending'}" data-poster="${escAttr(poster)}" data-media-type="game" data-media-id="${escAttr(String(item.id || ''))}" data-discover-title="${titleAttr}" data-discover-section="games" data-game-title="${titleAttr}" data-rawg-id="${escAttr(String(item.id || ''))}" ${poster ? `style="background-image:url('${escAttr(poster)}')"` : ''} onclick="openGameMediaProfile(event, '${escAttr(String(item.id || ''))}', getGameMediaProfileSeed('${escAttr(String(item.id || ''))}'), this)">${getDiscoverFriendStackMarkup(title, 'games')}</div>
    <div class="discover-card-body">
      <div class="discover-card-title-row">
        <div class="discover-card-info-stack">
          <div class="discover-universal-search-result-type">Game</div>
          <button class="discover-card-title discover-title-profile-btn game-title-profile-btn" type="button" onclick="openGameMediaProfile(event, ${item.id}, getGameMediaProfileSeed(${item.id}), this)">${escHtml(title)}${year ? ` (${year})` : ''}</button>
          <div class="discover-card-genre">${escHtml(overview)}</div>
        </div>
        ${renderBackloggdGameIcon(seed, 'game-discover-backloggd-icon')}
      </div>
      <button class="discover-add-btn${alreadyAdded ? ' added' : ''}" data-discover-type="game" data-discover-id="${item.id}" data-discover-section="games" data-discover-title="${titleAttr}" title="${alreadyAdded ? 'Click to remove from your library' : ''}" onclick="${alreadyAdded ? removeClick : addClick}">${alreadyAdded ? getDiscoverLibraryButtonText(title, 'games') : '+ Add to Library'}</button>
    </div>
  </div>`;
}

function renderDiscoverUniversalSearchRows(rows = [], grid = null) {
  if (!grid) return;
  if (!rows.length) {
    grid.classList.remove('discover-universal-search-results-list');
    grid.innerHTML = '<div class="discover-universal-search-empty">No matching titles found.</div>';
    return;
  }
  grid.classList.add('discover-universal-search-results-list');
  grid.innerHTML = rows.map(row => row.kind === 'game' ? buildDiscoverUniversalGameRow(row) : buildDiscoverUniversalTmdbRow(row)).join('');
  requestAnimationFrame(refreshDiscoverFriendStacks);
  setTimeout(() => backfillIgdbDiscoverGameCovers(grid), 240);
}

async function runDiscoverUniversalAllMediaSearch(query = '', grid = null, token = discoverUniversalSearchToken) {
  if (!grid) return;
  const [tmdbItems, rawgItems] = await Promise.allSettled([
    fetchTmdbSearchResults(query),
    fetchRawgSearchResults(query)
  ]);
  if (token !== discoverUniversalSearchToken) return;
  const mediaItems = tmdbItems.status === 'fulfilled' ? tmdbItems.value : [];
  const gameItems = rawgItems.status === 'fulfilled' ? rawgItems.value : [];
  const rows = preferDiscoverUniversalPrefixMatches([
    ...mediaItems.map(item => ({ kind: 'tmdb', item, score: scoreDiscoverUniversalTmdbResult(item, query) })),
    ...gameItems.map(item => ({ kind: 'game', item, score: scoreDiscoverUniversalGameResult(item, query) }))
  ].filter(row => Number(row.score || 0) > 0), query)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, Math.max(DISCOVER_LIMIT, 18));
  renderDiscoverUniversalSearchRows(rows, grid);
}

async function runDiscoverUniversalSearch(value = '') {
  const query = String(value || '').trim();
  const grid = document.getElementById('discover-universal-search-grid');
  if (!grid) return;
  const token = ++discoverUniversalSearchToken;
  if (!query) {
    await renderDiscoverUniversalSearchDefault(true);
    return;
  }
  const source = discoverUniversalSearchSource;
  syncDiscoverUniversalSearchFilterContext();
  grid.classList.remove('discover-universal-search-results-list');
  grid.innerHTML = '<div class="discover-message">Searching...</div>';
  try {
    if (source !== 'rawg' && isDiscoverUniversalSearchFilterable(source) && getDiscoverUniversalSearchFilterCount()) {
      const filteredItems = await fetchDiscoverFilteredMediaItems();
      if (token !== discoverUniversalSearchToken) return;
      const rows = preferDiscoverUniversalPrefixMatches(
        filteredItems.map(item => ({ kind: 'tmdb', item, score: scoreDiscoverUniversalTmdbResult(item, query) }))
          .filter(row => Number(row.score || 0) > 0),
        query
      ).sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, DISCOVER_UNIVERSAL_SEARCH_DEFAULT_LIMIT);
      renderDiscoverUniversalSearchRows(rows, grid);
      return;
    }
    if (source === 'rawg') {
      const items = await fetchRawgSearchResults(query);
      if (token !== discoverUniversalSearchToken) return;
      grid.classList.add('discover-universal-search-results-list');
      renderGamesDiscoverCards(items, 'discover-universal-search-grid');
      return;
    }
    if (source === 'tmdb') {
      await runDiscoverUniversalAllMediaSearch(query, grid, token);
      return;
    }
    let items = await fetchTmdbSearchResults(query);
    if (source === 'anime') items = items.filter(isAnimeDiscoverCandidate);
    if (source === 'movie') items = items.filter(item => item.media_type === 'movie');
    if (source === 'tv') items = items.filter(item => item.media_type === 'tv');
    if (token !== discoverUniversalSearchToken) return;
    grid.classList.add('discover-universal-search-results-list');
    renderDiscoverCards(source === 'movie' ? 'movie' : source === 'tv' || source === 'anime' ? 'tv' : 'mixed', items, 'discover-universal-search-grid');
  } catch (error) {
    if (token !== discoverUniversalSearchToken) return;
    console.error('Universal Discovery search failed:', error);
    grid.innerHTML = '<div class="discover-message">Search failed. Try again.</div>';
  }
}



function getDiscoverUniversalSearchScope(source = discoverUniversalSearchSource) {
  const normalized = normalizeDiscoverUniversalSearchSource(source);
  if (normalized === 'movie') return 'movie';
  if (normalized === 'tv') return 'tv';
  if (normalized === 'anime') return 'anime';
  if (normalized === 'tmdb') return 'mixed';
  return '';
}

async function fetchDiscoverUniversalBestThisYear(source = discoverUniversalSearchSource) {
  const scope = getDiscoverUniversalSearchScope(source);
  if (!scope) return [];
  const items = scope === 'mixed'
    ? [
        ...(await fetchAndRankThisYearsBest('movie')),
        ...(await fetchAndRankThisYearsBest('tv')),
        ...(await fetchAndRankThisYearsBest('anime'))
      ]
    : await fetchAndRankThisYearsBest(scope);
  const normalized = normalizeDiscoverTypedItems(items, scope === 'mixed' ? 'mixed' : (scope === 'movie' ? 'movie' : 'tv'))
    .filter(item => item?.poster_path && getDiscoverSortTitle(item));
  return normalized
    .map(item => ({
      ...item,
      calculatedScore: Number(item.calculatedScore || 0) || scoreDiscoverTmdbItem(normalized, item, 'yearsBest', scope === 'anime' ? 'anime' : (item.media_type || scope)),
      discoverContext: item.discoverContext || getDiscoverFilteredContextLine(item)
    }))
    .sort(compareDiscoverCalculatedScoreDesc)
    .slice(0, DISCOVER_UNIVERSAL_SEARCH_DEFAULT_LIMIT);
}


function rankDiscoverUniversalRawgGames(items = [], kind = 'trending') {
  return (Array.isArray(items) ? items : [])
    .map(item => ({
      ...item,
      calculatedScore: scoreGameDiscoverItem(items, item, kind),
      discoverContext: item.discoverContext || buildGameDiscoverContext(item, 'Past 2 years')
    }))
    .sort((a, b) => {
      const scoreCompare = Number(b.calculatedScore || 0) - Number(a.calculatedScore || 0);
      if (scoreCompare) return scoreCompare;
      const addedCompare = gameAddedCount(b) - gameAddedCount(a);
      if (addedCompare) return addedCompare;
      const ratingCompare = Number(b.rating || 0) - Number(a.rating || 0);
      if (ratingCompare) return ratingCompare;
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
    })
    .slice(0, DISCOVER_UNIVERSAL_SEARCH_DEFAULT_LIMIT);
}

function isRawgGameReleasedWithinPastTwoYears(item = {}, startDate = null, endDate = null) {
  const releasedAt = Date.parse(`${item.released || ''}T00:00:00`);
  if (!Number.isFinite(releasedAt)) return false;
  const start = startDate instanceof Date ? startDate.getTime() : 0;
  const end = endDate instanceof Date ? endDate.getTime() : Date.now();
  return releasedAt >= start && releasedAt <= end;
}

async function fetchDiscoverUniversalTopRawgGamesPastTwoYears() {
  const today = new Date();
  const past = new Date(today);
  past.setFullYear(today.getFullYear() - 2);
  const startString = getRawgDateString(past);
  const endString = getRawgDateString(today);
  let pool = await fetchRawgPages({
    dates: `${startString},${endString}`,
    ordering: '-added'
  }, 5, 220);
  let filtered = pool.filter(item => isRawgGameReleasedWithinPastTwoYears(item, past, today));
  let ranked = rankDiscoverUniversalRawgGames(filtered, 'trending');
  if (ranked.length >= Math.min(12, DISCOVER_UNIVERSAL_SEARCH_DEFAULT_LIMIT)) return ranked;

  pool = await fetchRawgPages({
    dates: `${startString},${endString}`,
    ordering: '-rating'
  }, 5, 180);
  filtered = pool.filter(item => isRawgGameReleasedWithinPastTwoYears(item, past, today));
  ranked = rankDiscoverUniversalRawgGames(filtered, 'years-best');
  if (ranked.length) return ranked;

  pool = await fetchRawgPages({
    dates: `${startString},${endString}`,
    ordering: '-metacritic'
  }, 4, 140);
  return rankDiscoverUniversalRawgGames(pool.filter(item => isRawgGameReleasedWithinPastTwoYears(item, past, today)), 'rated');
}

async function renderDiscoverUniversalSearchDefault(force = false) {
  const grid = document.getElementById('discover-universal-search-grid');
  if (!grid || discoverUniversalSearchDefaultLoading) return;
  const source = discoverUniversalSearchSource;
  const filterable = isDiscoverUniversalSearchFilterable(source);
  syncDiscoverUniversalSearchFilterContext();
  if (source === 'rawg') {
    discoverUniversalSearchDefaultLoading = true;
    grid.classList.remove('discover-universal-search-results-list');
    grid.innerHTML = '<div class="discover-message">Loading top games from the past 2 years...</div>';
    try {
      const cacheKey = `universal-rawg-games-past-2-years:${DISCOVER_CATEGORY_FILTER_VERSION}:${new Date().getFullYear()}:${new Date().getMonth()}`;
      const items = await loadDiscoverCachedData(cacheKey, fetchDiscoverUniversalTopRawgGamesPastTwoYears, force);
      const rows = (items || []).map(item => ({ kind: 'game', item, score: Number(item.calculatedScore || 0) }));
      renderDiscoverUniversalSearchRows(rows, grid);
      if (!rows.length) grid.innerHTML = '<div class="discover-universal-search-empty">No top games found for the past 2 years.</div>';
    } catch (error) {
      console.error('Universal Discovery game defaults failed:', error);
      grid.innerHTML = '<div class="discover-message">Top games could not load. Try search.</div>';
    } finally {
      discoverUniversalSearchDefaultLoading = false;
    }
    return;
  }
  if (filterable && getDiscoverUniversalSearchFilterCount()) {
    await loadDiscoverUniversalSearchFilteredItems(force);
    return;
  }
  discoverUniversalSearchDefaultLoading = true;
  grid.classList.remove('discover-universal-search-results-list');
  grid.innerHTML = '<div class="discover-message">Loading this year’s best media...</div>';
  try {
    const cacheKey = `universal-best-year:${DISCOVER_CATEGORY_FILTER_VERSION}:${source}:${new Date().getFullYear()}`;
    const items = await loadDiscoverCachedData(cacheKey, () => fetchDiscoverUniversalBestThisYear(source), force);
    const rows = (items || []).map(item => ({ kind: 'tmdb', item, score: Number(item.calculatedScore || 0) }));
    renderDiscoverUniversalSearchRows(rows, grid);
    if (!rows.length) grid.innerHTML = '<div class="discover-universal-search-empty">No best-of-year titles found yet.</div>';
  } catch (error) {
    console.error('Universal Discovery default titles failed:', error);
    grid.innerHTML = '<div class="discover-message">This year’s best titles could not load. Try search.</div>';
  } finally {
    discoverUniversalSearchDefaultLoading = false;
  }
}

function openDiscoverUniversalSearchFilterSheet() {
  if (!isDiscoverUniversalSearchFilterable()) return;
  syncDiscoverUniversalSearchFilterContext();
  openDiscoverCategoryFilterSheet();
}

async function loadDiscoverUniversalSearchFilteredItems(force = false) {
  const grid = document.getElementById('discover-universal-search-grid');
  if (!grid || !isDiscoverUniversalSearchFilterable()) return;
  syncDiscoverUniversalSearchFilterContext();
  if (!hasDiscoverCategoryMediaFilters()) {
    renderDiscoverUniversalSearchDefault(force);
    return;
  }
  grid.classList.remove('discover-universal-search-results-list');
  grid.innerHTML = '<div class="discover-message">Loading filtered titles...</div>';
  try {
    const cacheKey = `universal-search-filters:${DISCOVER_CATEGORY_FILTER_VERSION}:${discoverUniversalSearchSource}:${JSON.stringify(getDiscoverCategoryFilters())}`;
    const items = await loadDiscoverCachedData(cacheKey, fetchDiscoverFilteredMediaItems, force);
    const rows = (items || []).map(item => ({ kind: 'tmdb', item, score: Number(item.calculatedScore || 0) }));
    renderDiscoverUniversalSearchRows(rows, grid);
    if (!rows.length) grid.innerHTML = '<div class="discover-universal-search-empty">No titles found for these filters.</div>';
  } catch (error) {
    console.error('Universal Discovery filtered titles failed:', error);
    grid.innerHTML = '<div class="discover-message">Filtered titles could not load. Try a lighter filter set.</div>';
  }
}

function getRawgDateString(date) {
  return date.toISOString().slice(0, 10);
}

async function fetchRawgPages(params = {}, pageCount = DISCOVER_PAGE_COUNT, limit = DISCOVER_LIMIT) {
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
  const settled = await Promise.allSettled(pages.map(async page => {
    const res = await fetchRawgProxy('games', { page_size: '40', ...params, page: String(page) });
    if (!res.ok) throw new Error(`RAWG discovery request failed: ${res.status}`);
    const json = await res.json();
    return json.results || [];
  }));
  const results = settled
    .filter(result => result.status === 'fulfilled')
    .flatMap(result => result.value);
  const seen = new Set();
  return results.filter(item => {
    if (!item || !item.id || !item.name || !item.background_image || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, limit);
}

function gameRatingCount(item) {
  return Number(item.ratings_count || item.reviews_count || 0);
}

function gameAddedCount(item) {
  return Number(item.added || 0);
}

function gameMajorPlatformScore(item) {
  const major = ['pc', 'playstation', 'xbox', 'nintendo'];
  const names = (item.platforms || []).map(p => (p.platform?.name || '').toLowerCase());
  return names.filter(name => major.some(platform => name.includes(platform))).length;
}

function getGameReleaseTime(item = {}) {
  const time = Date.parse(`${item.released || ''}T00:00:00`);
  return Number.isFinite(time) ? time : 0;
}

function getGameDaysAgo(item = {}) {
  const time = getGameReleaseTime(item);
  if (!time) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - time) / 86400000);
}

function getGameDaysUntil(item = {}) {
  const time = getGameReleaseTime(item);
  if (!time) return Number.POSITIVE_INFINITY;
  return Math.max(0, (time - Date.now()) / 86400000);
}

function getGameLogNormalizer(items = [], getter = value => value) {
  const maxValue = Math.max(
    1,
    ...(items || []).map(item => Math.log10(Math.max(0, Number(getter(item)) || 0) + 1))
  );
  return maxValue > 0 ? maxValue : 1;
}

function getGameNormalizedAdded(items = [], item = {}) {
  const maxLog = getGameLogNormalizer(items, entry => gameAddedCount(entry));
  return clampDiscoverUnit(Math.log10(Math.max(0, gameAddedCount(item)) + 1) / maxLog);
}

function getGameNormalizedRatingCount(items = [], item = {}) {
  const maxLog = getGameLogNormalizer(items, entry => gameRatingCount(entry));
  return clampDiscoverUnit(Math.log10(Math.max(0, gameRatingCount(item)) + 1) / maxLog);
}

function getGameRatingNormalized(item = {}) {
  return clampDiscoverUnit(Number(item.rating || 0) / 5);
}

function getGameMetacriticNormalized(item = {}) {
  return clampDiscoverUnit(Number(item.metacritic || 0) / 100);
}

function getGamePlatformReachScore(item = {}) {
  return clampDiscoverUnit(gameMajorPlatformScore(item) / 4);
}

function getGameRecentReleaseScore(item = {}, windowDays = 60) {
  const daysAgo = getGameDaysAgo(item);
  if (!Number.isFinite(daysAgo)) return 0;
  return clampDiscoverUnit(1 - (Math.min(daysAgo, windowDays) / Math.max(1, windowDays)));
}

function getGameFreshnessScore(item = {}, horizonDays = 1825) {
  const daysAgo = getGameDaysAgo(item);
  if (!Number.isFinite(daysAgo)) return 0;
  return clampDiscoverUnit(1 - (Math.min(daysAgo, horizonDays) / Math.max(1, horizonDays)));
}

function getGameUpcomingSoonnessScore(item = {}, windowDays = 730) {
  const daysUntil = getGameDaysUntil(item);
  if (!Number.isFinite(daysUntil)) return 0;
  const adjusted = Math.max(0, daysUntil - 1);
  return clampDiscoverUnit(1 - (Math.min(adjusted, windowDays) / Math.max(1, windowDays)));
}

function getGameTaxonomySet(item = {}) {
  const values = [];
  (item.genres || []).forEach(entry => {
    values.push(String(entry?.slug || '').toLowerCase());
    values.push(String(entry?.name || '').toLowerCase());
  });
  (item.tags || []).forEach(entry => {
    values.push(String(entry?.slug || '').toLowerCase());
    values.push(String(entry?.name || '').toLowerCase());
  });
  return new Set(values.filter(Boolean));
}

function getGameKeywordScore(item = {}, keywords = []) {
  const taxonomy = getGameTaxonomySet(item);
  if (!taxonomy.size || !keywords.length) return 0;
  let matches = 0;
  keywords.forEach(keyword => {
    const normalized = String(keyword || '').toLowerCase();
    if (!normalized) return;
    const hit = [...taxonomy].some(value => value === normalized || value.includes(normalized) || normalized.includes(value));
    if (hit) matches += 1;
  });
  return clampDiscoverUnit(matches / keywords.length);
}

function getGameWeightedQualityScore(items = [], item = {}) {
  const rating = getGameRatingNormalized(item);
  const metacritic = getGameMetacriticNormalized(item);
  const confidence = getGameNormalizedRatingCount(items, item);
  return (rating * 0.44) + (metacritic * 0.38) + (confidence * 0.18);
}

function scoreGameDiscoverItem(items = [], item = {}, kind = 'popular') {
  const added = getGameNormalizedAdded(items, item);
  const confidence = getGameNormalizedRatingCount(items, item);
  const quality = getGameWeightedQualityScore(items, item);
  const platformReach = getGamePlatformReachScore(item);
  const freshness = getGameFreshnessScore(item, 1825);
  const recentRelease = getGameRecentReleaseScore(item, 75);
  const upcomingSoonness = getGameUpcomingSoonnessScore(item, 730);
  const storyScore = getGameKeywordScore(item, ['story-rich', 'narrative', 'singleplayer', 'open-world', 'role-playing-games-rpg', 'adventure']);
  const multiplayerScore = getGameKeywordScore(item, ['multiplayer', 'co-op', 'online-co-op', 'pvp', 'competitive', 'party']);
  const mainstreamBlend = (added * 0.65) + (confidence * 0.35);
  const gemBalance = getDiscoverMidpointSignal(mainstreamBlend, 0.34, 0.30);
  const obscurity = 1 - mainstreamBlend;

  if (kind === 'new-releases') return (recentRelease * 0.54 + quality * 0.20 + added * 0.18 + confidence * 0.08) * 100;
  if (kind === 'years-best') return (quality * 0.64 + confidence * 0.14 + added * 0.12 + freshness * 0.10) * 100;
  if (kind === 'trending') return (recentRelease * 0.26 + added * 0.24 + quality * 0.22 + confidence * 0.18 + platformReach * 0.10) * 100;
  if (kind === 'anticipated') return (upcomingSoonness * 0.24 + added * 0.46 + platformReach * 0.18 + quality * 0.12) * 100;
  if (kind === 'rated') return (quality * 0.74 + confidence * 0.14 + added * 0.08 + platformReach * 0.04) * 100;
  if (kind === 'story') return (quality * 0.44 + storyScore * 0.24 + added * 0.14 + confidence * 0.10 + freshness * 0.08) * 100;
  if (kind === 'multiplayer') return (quality * 0.37 + multiplayerScore * 0.28 + added * 0.17 + confidence * 0.10 + freshness * 0.08) * 100;
  if (kind === 'hidden') return (quality * 0.48 + gemBalance * 0.20 + obscurity * 0.16 + freshness * 0.16) * 100;
  return (added * 0.43 + quality * 0.31 + confidence * 0.16 + platformReach * 0.10) * 100;
}

function buildGameDiscoverContext(item = {}, prefix = '') {
  const parts = [];
  if (prefix) parts.push(prefix);
  if (Number(item.rating || 0) > 0) parts.push(`${Number(item.rating || 0).toFixed(1)} RAWG`);
  if (Number(item.metacritic || 0) > 0) parts.push(`${Number(item.metacritic || 0)} Metacritic`);
  if (gameRatingCount(item) > 0) parts.push(`${gameRatingCount(item).toLocaleString()} ratings`);
  return parts.join(' · ');
}


function compareGameReleaseDateDesc(a = {}, b = {}) {
  const aDate = getGameReleaseTime(a);
  const bDate = getGameReleaseTime(b);
  if (bDate !== aDate) return bDate - aDate;
  const addedCompare = gameAddedCount(b) - gameAddedCount(a);
  if (addedCompare) return addedCompare;
  return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
}

function gameWeightedYearScore(items = [], item = {}) {
  return scoreGameDiscoverItem(items, item, 'years-best');
}

function rankGames(items, kind) {
  return (items || [])
    .map(item => {
      let prefix = '';
      if (kind === 'new-releases' && item.released) prefix = `Released ${formatDiscoverReleaseDate(item.released)}`;
      else if (kind === 'anticipated' && item.released) prefix = `Releases ${formatDiscoverReleaseDate(item.released)}`;
      return {
        ...item,
        calculatedScore: scoreGameDiscoverItem(items, item, kind),
        discoverContext: buildGameDiscoverContext(item, prefix)
      };
    })
    .sort((a, b) => {
      const scoreCompare = Number(b.calculatedScore || 0) - Number(a.calculatedScore || 0);
      if (scoreCompare) return scoreCompare;
      const addedCompare = gameAddedCount(b) - gameAddedCount(a);
      if (addedCompare) return addedCompare;
      const ratingCompare = Number(b.rating || 0) - Number(a.rating || 0);
      if (ratingCompare) return ratingCompare;
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
    })
    .slice(0, DISCOVER_LIMIT);
}

async function fetchGamesDiscoverTitles(kind) {
  if (kind === 'trending') {
    const today = new Date();
    const past = new Date();
    past.setMonth(today.getMonth() - 18);
    let pool = await fetchRawgPages({
      dates: `${getRawgDateString(past)},${getRawgDateString(today)}`,
      ordering: '-added'
    }, DISCOVER_PAGE_COUNT, 120);
    let ranked = rankGames(pool.filter(item => Number(item.rating || 0) >= 3.4 || gameRatingCount(item) >= 75), 'trending');
    if (ranked.length) return ranked;
    pool = await fetchRawgPages({ dates: `${getRawgDateString(past)},${getRawgDateString(today)}`, ordering: '-metacritic' }, 3, 80);
    return rankGames(pool, 'trending');
  }
  if (kind === 'new-releases') {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const startString = getRawgDateString(start);
    const endString = getRawgDateString(end);
    let pool = await fetchRawgPages({
      dates: `${startString},${endString}`,
      ordering: '-released'
    }, DISCOVER_PAGE_COUNT, 160);
    return rankGames(pool.filter(item => {
      if (!item.released) return false;
      const releaseDate = new Date(`${item.released}T00:00:00`);
      return releaseDate >= new Date(`${startString}T00:00:00`) && releaseDate <= new Date(`${endString}T23:59:59`) && releaseDate <= today;
    }), 'new-releases');
  }
  if (kind === 'years-best') {
    const year = new Date().getFullYear();
    const startString = `${year}-01-01`;
    const todayString = getRawgDateString(new Date());
    let pool = await fetchRawgPages({
      dates: `${startString},${todayString}`,
      ordering: '-rating'
    }, DISCOVER_PAGE_COUNT, 180);
    let ranked = rankGames(pool.filter(item => {
      const releaseYear = String(item.released || '').slice(0, 4);
      return releaseYear === String(year) && Number(item.rating || 0) > 0 && gameRatingCount(item) > 0;
    }), 'years-best');
    if (ranked.length) return ranked;
    pool = await fetchRawgPages({ dates: `${startString},${todayString}`, ordering: '-metacritic' }, 3, 120);
    return rankGames(pool.filter(item => String(item.released || '').slice(0, 4) === String(year)), 'years-best');
  }
  if (kind === 'anticipated') {
    const today = new Date();
    const future = new Date();
    future.setFullYear(today.getFullYear() + 2);
    const todayString = getRawgDateString(today);
    const futureString = getRawgDateString(future);
    const pool = await fetchRawgPages({
      dates: `${todayString},${futureString}`,
      ordering: '-added'
    }, DISCOVER_PAGE_COUNT, 180);
    return rankGames(pool.filter(item => {
      if (!item.released) return false;
      const releaseDate = new Date(`${item.released}T00:00:00`);
      return releaseDate >= new Date(`${todayString}T00:00:00`) && releaseDate <= new Date(`${futureString}T23:59:59`);
    }), 'anticipated');
  }
  if (kind === 'rated') {
    let pool = await fetchRawgPages({ ordering: '-rating', metacritic: '75,100' }, DISCOVER_PAGE_COUNT, 160);
    let ranked = rankGames(pool.filter(item => Number(item.rating || 0) >= 4 && gameRatingCount(item) >= 75), 'rated');
    if (ranked.length) return ranked;
    pool = await fetchRawgPages({ ordering: '-metacritic' }, 3, 100);
    return rankGames(pool.filter(item => gameRatingCount(item) >= 25 || Number(item.metacritic || 0) >= 75), 'rated');
  }
  if (kind === 'story') {
    let pool = await fetchRawgPages({
      ordering: '-added',
      genres: 'action,adventure,role-playing-games-rpg',
      tags: 'open-world,story-rich,singleplayer'
    }, DISCOVER_PAGE_COUNT, 160);
    let ranked = rankGames(pool.filter(item => Number(item.rating || 0) >= 3.5 || gameRatingCount(item) >= 100), 'story');
    if (ranked.length) return ranked;
    pool = await fetchRawgPages({ ordering: '-added', genres: 'adventure,role-playing-games-rpg' }, 3, 100);
    return rankGames(pool, 'story');
  }
  if (kind === 'multiplayer') {
    let pool = await fetchRawgPages({
      ordering: '-added',
      tags: 'multiplayer,co-op,online-co-op,pvp,competitive,party'
    }, DISCOVER_PAGE_COUNT, 160);
    let ranked = rankGames(pool.filter(item => gameRatingCount(item) >= 50 || gameAddedCount(item) >= 1000), 'multiplayer');
    if (ranked.length) return ranked;
    pool = await fetchRawgPages({ ordering: '-added', tags: 'multiplayer' }, 3, 100);
    return rankGames(pool, 'multiplayer');
  }
  if (kind === 'hidden') {
    const pool = await fetchRawgPages({ ordering: '-rating' }, DISCOVER_PAGE_COUNT, 200);
    const strict = rankGames(pool.filter(item => {
      const rating = Number(item.rating || 0);
      const ratingCount = gameRatingCount(item);
      const added = gameAddedCount(item);
      return rating >= 3.7 && ratingCount >= 35 && added <= 22000;
    }), 'hidden');
    if (strict.length) return strict;
    return rankGames(pool.filter(item => Number(item.rating || 0) >= 3.5 && gameAddedCount(item) <= 50000), 'hidden');
  }
  return rankGames(await fetchRawgPages({ ordering: '-added' }, DISCOVER_PAGE_COUNT, 120), 'popular');
}

function renderGamesDiscoverSectionError(gridId) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  const button = getDiscoverExpandButton(grid);
  if (button) button.style.display = 'none';
  grid.innerHTML = '<div class="discover-message">This section could not load. Other sections are still available.</div>';
}

const discoverTrailerCache = new Map();
const discoverMediaProfileCache = new Map();
const discoverMediaProfileSeeds = new Map();
let activeDiscoverPinnedCard = null;
let discoverCardPressTimer = null;
let discoverCardPressPoster = null;
let discoverCardPressStartX = 0;
let discoverCardPressStartY = 0;
const discoverCardLongPressMs = 560;
const discoverCardPressMoveThreshold = 12;
const DISCOVER_MOVIE_GENRE_MAP = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi',
  10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western'
};
const DISCOVER_TV_GENRE_MAP = {
  10759: 'Action', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary',
  18: 'Drama', 10751: 'Family', 10762: 'Kids', 9648: 'Mystery', 10763: 'News',
  10764: 'Reality', 10765: 'Sci-Fi', 10766: 'Soap', 10767: 'Talk', 10768: 'War'
};

function getDiscoverTrailerCacheKey(type, id) {
  return `${type}-${id}`;
}

function scoreDiscoverTrailer(video) {
  const kind = String(video?.type || '').toLowerCase();
  if (video?.site !== 'YouTube' || !video?.key) return -1;
  if (video?.official && kind === 'trailer') return 400;
  if (kind === 'trailer') return 300;
  if (kind === 'teaser') return 200;
  return 100;
}

function pickBestDiscoverTrailer(videos) {
  const sorted = (videos || [])
    .filter(video => video?.site === 'YouTube' && video?.key)
    .sort((a, b) => {
      const scoreDiff = scoreDiscoverTrailer(b) - scoreDiscoverTrailer(a);
      if (scoreDiff !== 0) return scoreDiff;
      const aDate = Date.parse(a?.published_at || 0) || 0;
      const bDate = Date.parse(b?.published_at || 0) || 0;
      return bDate - aDate;
    });
  return sorted[0] || null;
}

async function fetchDiscoverTrailerKey(type, id) {
  const cacheKey = getDiscoverTrailerCacheKey(type, id);
  if (discoverTrailerCache.has(cacheKey)) return discoverTrailerCache.get(cacheKey);
  if (!id || (type !== 'movie' && type !== 'tv')) {
    discoverTrailerCache.set(cacheKey, null);
    return null;
  }
  try {
    const res = await fetchTmdbProxy(`${type}/${id}/videos`);
    if (!res.ok) throw new Error(`TMDB videos request failed: ${res.status}`);
    const json = await res.json();
    const trailerKey = pickBestDiscoverTrailer(json.results || [])?.key || null;
    discoverTrailerCache.set(cacheKey, trailerKey);
    return trailerKey;
  } catch (e) {
    console.error('Discover trailer fetch failed:', e);
    discoverTrailerCache.set(cacheKey, null);
    return null;
  }
}

function buildDiscoverPosterMarkup(poster) {
  return `<div class="discover-poster-media" style="background-image:url('${poster}')"></div>`;
}

function getDiscoverExpandIconMarkup(container) {
  if (!container || !container.dataset.mediaType || !container.dataset.mediaId) return '';
  return `<button class="discover-expand-icon" type="button" aria-label="Preview trailer" onclick="handleDiscoverExpandIconClick(event, this, '${container.dataset.mediaType}', ${container.dataset.mediaId})"><span></span><span></span><span></span><span></span></button>`;
}

function getDiscoverPosterTooltipMarkup() {
  return `<div class="discover-poster-tooltip">Click poster to open profile</div>`;
}


let discoverFriendSocialCache = null;
let discoverFriendSocialCacheKey = '';
let discoverFriendSocialPromise = null;

function normalizeDiscoverSocialTitle(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getDiscoverSocialSections(section) {
  if (section === 'shows') return ['shows', 'anime'];
  return [section].filter(Boolean);
}

function getDiscoverAvatarUrl(user = {}) {
  if (user.photo) return user.photo;
  return 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.name || 'Friend') + '&background=1e2028&color=60a5fa';
}

function parseDiscoverFriendListField(raw) {
  try { return raw ? JSON.parse(raw) : []; } catch(e) { return []; }
}

function isDiscoverFriendTriggerStatus(item, section) {
  const status = String(item?.status || '').toLowerCase();
  return status === 'watching' || status === 'planned';
}

function getDiscoverFriendMatch(friend, normalizedTitle, section) {
  const sections = getDiscoverSocialSections(section);
  for (const listSection of sections) {
    const match = (friend.listData?.[listSection] || []).find(item =>
      normalizeDiscoverSocialTitle(item.title) === normalizedTitle &&
      isDiscoverFriendTriggerStatus(item, section)
    );
    if (match) return { item: match, listSection };
  }
  return null;
}

function getDiscoverSocialStatusLabel(status, section) {
  const normalized = String(status || '').toLowerCase();
  if (section === 'games') {
    if (normalized === 'live') return 'Live Games';
    if (normalized === 'watching') return 'Playing';
    if (normalized === 'planned') return 'Backlog';
  }
  if (normalized === 'watching') return 'Watching';
  if (normalized === 'planned') return 'Watchlist';
  return '';
}

function getDiscoverFriendStackFromContainer(container) {
  return getDiscoverFriendStackMarkup(container?.dataset?.discoverTitle || '', container?.dataset?.discoverSection || '');
}

function getDiscoverFriendMatches(title, section) {
  const normalizedTitle = normalizeDiscoverSocialTitle(title);
  if (!normalizedTitle) return [];
  const source = discoverFriendSocialCache || (isPreviewMode() ? PREVIEW_COMMUNITY_USERS.map(user => ({
    uid: user.uid,
    name: user.name,
    photo: user.photo,
    listData: cloneListData(user.listData || {})
  })) : []);

  return source.map(friend => {
    const match = getDiscoverFriendMatch(friend, normalizedTitle, section);
    return match ? { ...friend, discoverMatchItem: match.item, discoverMatchSection: match.listSection } : null;
  }).filter(Boolean);
}

function getDiscoverFriendStackMarkup(title, section) {
  const titleAttr = escAttr(title);
  const sectionAttr = escAttr(section);
  const matches = getDiscoverFriendMatches(title, section);
  if (!matches.length) {
    return `<div class="discover-friend-stack" data-discover-title="${titleAttr}" data-discover-section="${sectionAttr}" aria-hidden="true"></div>`;
  }

  const visible = matches.slice(0, 3);
  const extra = matches.length - visible.length;
  const names = matches.map(friend => friend.name || 'Friend');
  const label = names.length === 1 ? `${names[0]} added this` : `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''} added this`;
  const avatars = visible.map(friend => `<img class="discover-friend-avatar" src="${escAttr(getDiscoverAvatarUrl(friend))}" alt="" loading="lazy">`).join('');
  const count = extra > 0 ? `<span class="discover-friend-count">+${extra}</span>` : '';
  return `<div class="discover-friend-stack has-friends" data-discover-title="${titleAttr}" data-discover-section="${sectionAttr}" title="${escAttr(label)}" aria-label="${escAttr(label)}" role="button" tabindex="0" onclick="openDiscoverFriendsModal(event, this)" onkeydown="handleDiscoverFriendStackKeydown(event, this)" onpointerdown="event.stopPropagation()">${avatars}${count}</div>`;
}

async function loadDiscoverFriendSocialCache(force = false) {
  const cacheKey = isPreviewMode()
    ? 'preview'
    : currentUser
      ? friends.slice().sort().join('|')
      : 'signed-out';

  if (!force && discoverFriendSocialCache && discoverFriendSocialCacheKey === cacheKey) return discoverFriendSocialCache;
  if (!force && discoverFriendSocialPromise && discoverFriendSocialCacheKey === cacheKey) return discoverFriendSocialPromise;

  discoverFriendSocialCacheKey = cacheKey;
  discoverFriendSocialPromise = (async () => {
    if (isPreviewMode()) {
      discoverFriendSocialCache = PREVIEW_COMMUNITY_USERS.map(user => ({
        uid: user.uid,
        name: user.name,
        photo: user.photo,
        listData: cloneListData(user.listData || {})
      }));
      return discoverFriendSocialCache;
    }

    if (!currentUser || !friends.length) {
      discoverFriendSocialCache = [];
      return discoverFriendSocialCache;
    }

    const rows = await Promise.all(friends.map(async uid => {
      try {
        const [userSnap, listSnap] = await Promise.all([
          db.collection('users').doc(uid).get(),
          db.collection('watchlist').doc(uid).get()
        ]);
        const user = userSnap.exists ? userSnap.data() : usersMap[uid] || {};
        if (userSnap.exists) usersMap[uid] = { ...user, uid };
        const list = listSnap.exists ? listSnap.data() : {};
        return {
          uid,
          name: user.name || 'Friend',
          photo: user.photo || '',
          listData: normalizeListData({
            shows: parseDiscoverFriendListField(list.shows),
            movies: parseDiscoverFriendListField(list.movies),
            anime: parseDiscoverFriendListField(list.anime),
            games: parseDiscoverFriendListField(list.games)
          })
        };
      } catch(e) {
        return null;
      }
    }));

    discoverFriendSocialCache = rows.filter(Boolean);
    return discoverFriendSocialCache;
  })();

  try {
    return await discoverFriendSocialPromise;
  } finally {
    discoverFriendSocialPromise = null;
  }
}

function refreshDiscoverFriendStacks(force = false) {
  const stacks = document.querySelectorAll('.discover-friend-stack');
  if (!stacks.length) return;
  loadDiscoverFriendSocialCache(force).then(() => {
    document.querySelectorAll('.discover-friend-stack').forEach(stack => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = getDiscoverFriendStackMarkup(stack.dataset.discoverTitle || '', stack.dataset.discoverSection || '');
      if (wrapper.firstElementChild) stack.replaceWith(wrapper.firstElementChild);
    });
  }).catch(e => console.error('Discover friend avatars failed:', e));
}

function isDiscoverMobileViewport() {
  return window.matchMedia && window.matchMedia('(max-width: 600px)').matches;
}

function getDiscoverMediaProfileKey(type, id) {
  return `${type}-${id}`;
}

function setDiscoverMediaProfileSeed(type, id, seed) {
  discoverMediaProfileSeeds.set(getDiscoverMediaProfileKey(type, id), seed);
}

function handleDiscoverFriendStackKeydown(event, stack) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  openDiscoverFriendsModal(event, stack);
}

function closeDiscoverFriendsModal() {
  const overlay = document.getElementById('discover-friends-modal-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  document.removeEventListener('keydown', handleDiscoverFriendsModalEsc);
  setTimeout(() => overlay.remove(), 260);
}

function handleDiscoverFriendsModalEsc(event) {
  if (event.key === 'Escape') closeDiscoverFriendsModal();
}

function openDiscoverFriendsModal(event, stack) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (!stack || !isDiscoverMobileViewport()) return;

  const title = stack.dataset.discoverTitle || '';
  const section = stack.dataset.discoverSection || '';
  const matches = getDiscoverFriendMatches(title, section);
  if (!matches.length) return;

  const titleText = title ? escHtml(title) : 'this title';
  const rows = matches.map(friend => {
    const statusLabel = getDiscoverSocialStatusLabel(friend.discoverMatchItem?.status, section);
    return `<div class="discover-friends-modal-row">
      <img class="discover-friends-modal-avatar" src="${escAttr(getDiscoverAvatarUrl(friend))}" alt="${escAttr(friend.name || 'Friend')}" loading="lazy">
      <div>
        <div class="discover-friends-modal-name">${renderDisplayNameHTML(friend, 'Friend')}</div>
        ${statusLabel ? `<div class="discover-friends-modal-status">${escHtml(statusLabel)}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  closeDiscoverFriendsModal();
  const overlay = document.createElement('div');
  overlay.id = 'discover-friends-modal-overlay';
  overlay.className = 'discover-friends-modal-overlay';
  overlay.onclick = e => { if (e.target === overlay) closeDiscoverFriendsModal(); };
  overlay.innerHTML = `<div class="discover-friends-modal" role="dialog" aria-modal="true" aria-label="Friends who added ${escAttr(title)}">
    <div class="discover-friends-modal-head">
      <div>
        <div class="discover-friends-modal-title">Friends on ${titleText}</div>
        <div class="discover-friends-modal-subtitle">${matches.length} friend${matches.length === 1 ? '' : 's'} triggered this poster icon.</div>
      </div>
      <button class="discover-friends-modal-close" type="button" onclick="closeDiscoverFriendsModal()" aria-label="Close">×</button>
    </div>
    <div class="discover-friends-modal-rule">Icons appear when this title is in a friend’s Watching or Watchlist. For games, icons appear when the game is in Playing or Backlog.</div>
    <div class="discover-friends-modal-list">${rows}</div>
  </div>`;
  document.body.appendChild(overlay);
  document.addEventListener('keydown', handleDiscoverFriendsModalEsc);
  requestAnimationFrame(() => overlay.classList.add('open'));
}

function getDiscoverGenreNames(item, itemType) {
  if (Array.isArray(item?.genreNames) && item.genreNames.length) {
    return item.genreNames.map(name => String(name || '').trim()).filter(Boolean);
  }
  const genreMap = itemType === 'movie' ? DISCOVER_MOVIE_GENRE_MAP : DISCOVER_TV_GENRE_MAP;
  if (!Array.isArray(item?.genre_ids)) return [];
  return item.genre_ids.map(id => genreMap[id]).filter(Boolean);
}

function getDiscoverPosterContainer(cardOrPoster) {
  if (!cardOrPoster) return null;
  if (cardOrPoster.classList?.contains('discover-poster')) return cardOrPoster;
  return cardOrPoster.querySelector('.discover-poster');
}

function isMobileDiscoverLayout() {
  return window.matchMedia('(max-width: 700px), (hover: none) and (pointer: coarse)').matches;
}

function updateMobileDiscoverAlignment(card) {
  if (!card) return;
  card.classList.remove('mobile-expanded-left', 'mobile-expanded-right');
  card.style.removeProperty('--discover-mobile-shift-x');
  if (!isMobileDiscoverLayout() || !card.classList.contains('discover-card-expanded')) return;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const cardRect = card.getBoundingClientRect();
  const expandedWidth = Math.min(viewportWidth - 24, 520);
  const viewportCenter = viewportWidth / 2;
  const cardCenter = cardRect.left + (cardRect.width / 2);
  const baseLeft = cardCenter - (expandedWidth / 2);
  const baseRight = cardCenter + (expandedWidth / 2);
  const minShift = 12 - baseLeft;
  const maxShift = (viewportWidth - 12) - baseRight;
  const idealShift = viewportCenter - cardCenter;
  const clampedShift = Math.max(minShift, Math.min(maxShift, idealShift));
  card.style.setProperty('--discover-mobile-shift-x', `${clampedShift}px`);
  card.classList.add(cardCenter < viewportCenter ? 'mobile-expanded-left' : 'mobile-expanded-right');
}

function resetDiscoverPoster(cardOrPoster) {
  const container = getDiscoverPosterContainer(cardOrPoster);
  if (!container) return;
  const poster = container.dataset.poster || '';
  container.classList.remove('trailer-active');
  container.innerHTML = `${buildDiscoverPosterMarkup(poster)}${getDiscoverExpandIconMarkup(container)}${getDiscoverPosterTooltipMarkup()}${getDiscoverFriendStackFromContainer(container)}`;
}

function activateDiscoverTrailer(cardOrPoster, trailerKey) {
  const container = getDiscoverPosterContainer(cardOrPoster);
  if (!container || !trailerKey) return;
  const poster = container.dataset.poster || '';
  const isMobile = isMobileDiscoverLayout();
  const src = `https://www.youtube.com/embed/${trailerKey}?autoplay=${isMobile ? '0' : '1'}&mute=${isMobile ? '0' : '1'}&controls=1&playsinline=1&rel=0&modestbranding=1&enablejsapi=1`;
  container.innerHTML = `
    ${buildDiscoverPosterMarkup(poster)}
    ${getDiscoverExpandIconMarkup(container)}
    ${getDiscoverPosterTooltipMarkup()}
    ${getDiscoverFriendStackFromContainer(container)}
    <iframe class="discover-poster-video" src="${src}" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
  `;
  requestAnimationFrame(() => container.classList.add('trailer-active'));
}

function closePinnedDiscoverCard(card = activeDiscoverPinnedCard) {
  if (!card) return;
  const poster = getDiscoverPosterContainer(card);
  if (poster) {
    poster.dataset.hovering = '0';
    poster.dataset.pinned = '0';
  }
  card.classList.remove('discover-card-expanded');
  card.classList.remove('mobile-expanded-left', 'mobile-expanded-right');
  card.style.removeProperty('--discover-mobile-shift-x');
  resetDiscoverPoster(card);
  if (activeDiscoverPinnedCard === card) activeDiscoverPinnedCard = null;
}

async function handleDiscoverCardHover(card, type, id) {
  const container = getDiscoverPosterContainer(card);
  if (!container || container.dataset.hovering === '0') return;
  const trailerKey = await fetchDiscoverTrailerKey(type, id);
  if (container.dataset.hovering === '0' || !trailerKey) return;
  activateDiscoverTrailer(card, trailerKey);
}

function startDiscoverCardHover(card, type, id, force = false) {
  if (!card || (type !== 'movie' && type !== 'tv')) return;
  if (isMobileDiscoverLayout() && !force) return;
  const container = getDiscoverPosterContainer(card);
  if (!container) return;
  container.dataset.hovering = '1';
  card.classList.add('discover-card-expanded');
  updateMobileDiscoverAlignment(card);
  handleDiscoverCardHover(card, type, id);
}

function stopDiscoverCardHover(card, force = false) {
  const container = getDiscoverPosterContainer(card);
  if (!container) return;
  if (isMobileDiscoverLayout() && !force) return;
  if (container.dataset.pinned === '1') return;
  container.dataset.hovering = '0';
  if (card) card.classList.remove('discover-card-expanded');
  resetDiscoverPoster(card);
}

function toggleDiscoverCardPin(event, card, type, id) {
  if (!card || (type !== 'movie' && type !== 'tv')) return;
  if (event?.target?.closest('.discover-add-btn, button, a')) return;
  const container = getDiscoverPosterContainer(card);
  if (!container) return;
  const isPinned = container.dataset.pinned === '1';
  if (isPinned) {
    closePinnedDiscoverCard(card);
    return;
  }
  if (activeDiscoverPinnedCard && activeDiscoverPinnedCard !== card) {
    closePinnedDiscoverCard(activeDiscoverPinnedCard);
  }
  activeDiscoverPinnedCard = card;
  container.dataset.pinned = '1';
  startDiscoverCardHover(card, type, id, true);
}

function clearDiscoverCardPressTimer() {
  if (discoverCardPressTimer) {
    clearTimeout(discoverCardPressTimer);
    discoverCardPressTimer = null;
  }
  if (discoverCardPressPoster) {
    discoverCardPressPoster.dataset.longPressTriggered = '0';
    discoverCardPressPoster = null;
  }
  discoverCardPressStartX = 0;
  discoverCardPressStartY = 0;
}

function startDiscoverPosterPress(event, poster, type, id) {
  if (!poster || (event?.pointerType !== 'touch' && event?.pointerType !== 'pen')) return;
  clearDiscoverCardPressTimer();
  poster.dataset.longPressTriggered = '0';
  discoverCardPressPoster = poster;
  discoverCardPressStartX = event.clientX || 0;
  discoverCardPressStartY = event.clientY || 0;
  discoverCardPressTimer = setTimeout(() => {
    if (!discoverCardPressPoster) return;
    discoverCardPressPoster.dataset.longPressTriggered = '1';
    const card = discoverCardPressPoster.closest('.discover-card');
    toggleDiscoverCardPin(null, card, type, id);
  }, discoverCardLongPressMs);
}

function stopDiscoverPosterPress() {
  if (!discoverCardPressTimer) return;
  clearTimeout(discoverCardPressTimer);
  discoverCardPressTimer = null;
  discoverCardPressStartX = 0;
  discoverCardPressStartY = 0;
  if (discoverCardPressPoster?.dataset.longPressTriggered !== '1') {
    discoverCardPressPoster = null;
  }
}

function moveDiscoverPosterPress(event) {
  if (!discoverCardPressTimer) return;
  const deltaX = Math.abs((event?.clientX || 0) - discoverCardPressStartX);
  const deltaY = Math.abs((event?.clientY || 0) - discoverCardPressStartY);
  if (deltaX > discoverCardPressMoveThreshold || deltaY > discoverCardPressMoveThreshold) {
    clearDiscoverCardPressTimer();
  }
}

function handleDiscoverPosterClick(event, poster, type, id) {
  if (!poster || (type !== 'movie' && type !== 'tv') || !id) return;
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if (poster.dataset.longPressTriggered === '1') {
    poster.dataset.longPressTriggered = '0';
    return;
  }
  openDiscoverMediaProfile(event, type, id, poster);
}

function handleDiscoverCardClick(event, card, type, id) {
  if (!card || (type !== 'movie' && type !== 'tv')) return;
  if (isMobileDiscoverLayout()) return;
  if (event?.target?.closest('.discover-add-btn, button, a, .discover-poster')) return;
  toggleDiscoverCardPin(event, card, type, id);
}

function handleDiscoverCardBodyTap(event, body) {
  if (!body || !isMobileDiscoverLayout()) return;
  const card = body.closest('.discover-card');
  if (!card?.classList.contains('discover-card-expanded')) return;
  if (event?.target?.closest('button, a, iframe, .discover-poster-video, .discover-add-btn, [role="button"]')) return;
  closePinnedDiscoverCard(card);
}

function handleDiscoverCloseClick(event, button) {
  event?.stopPropagation?.();
  const card = button?.closest('.discover-card');
  if (!card) return;
  closePinnedDiscoverCard(card);
}

function handleDiscoverExpandIconClick(event, button, type, id) {
  event?.stopPropagation?.();
  if (!isMobileDiscoverLayout()) return;
  const card = button?.closest('.discover-card');
  if (!card) return;
  toggleDiscoverCardPin(null, card, type, id);
}

function closeDiscoverMediaProfile(reasonOrOptions = null) {
  const overlay = document.getElementById('discover-media-profile');
  if (!overlay) return;
  activeDiscoverMediaProfileState = null;
  document.removeEventListener('keydown', handleDiscoverMediaProfileEsc);
  closeMediaProfileOverlay(overlay, () => {
    document.body.classList.remove('discover-media-profile-open', 'game-media-profile-open');
    finishSharedMediaRouteAfterClose();
  }, reasonOrOptions);
}

function handleDiscoverMediaProfileEsc(event) {
  if (event.key === 'Escape') closeDiscoverMediaProfile('escape');
}

function getDiscoverMediaTitle(item, type) {
  if (type === 'tv' && (isAnimeTitleContext(item, '') || activeDiscoveryHub === 'anime')) {
    return getAnimeDisplayTitle(item, getAnimeTitleDisplayMode()) || item?.title || item?.name || 'TV Show';
  }
  return item?.title || item?.name || (type === 'tv' ? 'TV Show' : 'Movie');
}

function getDiscoverMediaDate(item, type) {
  return item?.release_date || item?.first_air_date || '';
}

function formatDiscoverMediaDate(dateString) {
  if (!dateString) return '';
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDiscoverMediaRuntime(minutes) {
  const total = Number(minutes || 0);
  if (!total) return '';
  const hrs = Math.floor(total / 60);
  const mins = total % 60;
  if (!hrs) return `${mins}m`;
  return `${hrs}h ${mins ? `${mins}m` : ''}`.trim();
}

function formatDiscoverMediaMoney(value) {
  const amount = Number(value || 0);
  if (!amount) return '';
  if (amount >= 1000000000) return `$${(amount / 1000000000).toFixed(1)}B`;
  if (amount >= 1000000) return `$${Math.round(amount / 1000000).toLocaleString('en-US')}M`;
  return `$${amount.toLocaleString('en-US')}`;
}

function getTmdbImageUrl(path, size = 'w780') {
  if (!path) return '';
  const value = String(path || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `https://image.tmdb.org/t/p/${size}${value.startsWith('/') ? value : `/${value}`}`;
}

function getDiscoverMediaPoster(item) {
  if (item?.poster_path) return getTmdbImageUrl(item.poster_path, 'w780');
  if (item?.poster) return item.poster;
  return '';
}

function getDiscoverMediaBackdrop(item) {
  if (item?.backdrop_path) return getTmdbImageUrl(item.backdrop_path, 'w1280');
  if (item?.backdrop) return item.backdrop;
  return getDiscoverMediaPoster(item);
}

function getDiscoverMediaCrew(credits, jobNames) {
  const jobs = new Set(jobNames);
  return (credits?.crew || [])
    .filter(person => jobs.has(person.job))
    .map(person => person.name)
    .filter(Boolean)
    .slice(0, 3);
}

function getDiscoverMediaTrailer(videos) {
  return pickBestDiscoverTrailer(videos?.results || videos || []);
}

function getCountryDisplayName(value = '') {
  const clean = String(value || '').trim();
  if (!clean) return '';
  if (!/^[a-z]{2}$/i.test(clean)) return clean;
  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
    return displayNames.of(clean.toUpperCase()) || clean.toUpperCase();
  } catch (error) {
    return clean.toUpperCase();
  }
}

function getDiscoverMediaCountryText(details = {}) {
  const names = [];
  const add = value => {
    const name = getCountryDisplayName(value);
    if (name && !names.some(existing => existing.toLowerCase() === name.toLowerCase())) names.push(name);
  };
  (Array.isArray(details.production_countries) ? details.production_countries : []).forEach(country => add(country?.name || country?.iso_3166_1 || country));
  (Array.isArray(details.origin_country) ? details.origin_country : []).forEach(add);
  (Array.isArray(details.originCountries) ? details.originCountries : []).forEach(add);
  return names.slice(0, 3).join(', ');
}

function getDiscoverMediaFacts(type, details) {
  const facts = [];
  const date = formatDiscoverMediaDate(getDiscoverMediaDate(details, type));
  const country = getDiscoverMediaCountryText(details);
  if (type === 'movie') {
    const runtime = formatDiscoverMediaRuntime(details.runtime);
    if (runtime) facts.push({ label: 'Runtime', value: runtime, priority: true });
    if (date) facts.push({ label: 'Released', value: date, priority: true });
    if (country) facts.push({ label: 'Country', value: country });
    if (details.status) facts.push({ label: 'Status', value: details.status });
    const budget = formatDiscoverMediaMoney(details.budget);
    if (budget) facts.push({ label: 'Budget', value: budget });
    const revenue = formatDiscoverMediaMoney(details.revenue);
    if (revenue) facts.push({ label: 'Box Office', value: revenue });
  } else {
    if (details.number_of_seasons) facts.push({ label: 'Seasons', value: String(details.number_of_seasons), priority: true });
    if (details.number_of_episodes) facts.push({ label: 'Episodes', value: String(details.number_of_episodes), priority: true });
    if (date) facts.push({ label: 'First Aired', value: date });
    if (country) facts.push({ label: 'Country', value: country });
    if (details.status) facts.push({ label: 'Status', value: details.status });
    if (details.type) facts.push({ label: 'Type', value: details.type });
  }
  return facts.slice(0, 6);
}

function getDiscoverSimilarMeta(item) {
  const year = (item?.release_date || item?.first_air_date || '').slice(0, 4);
  const score = item?.vote_average ? Number(item.vote_average).toFixed(1) : '';
  return [year, score ? `${score} TMDB` : ''].filter(Boolean).join(' · ');
}

function getDiscoverSimilarType(item, fallbackType) {
  return item?.media_type === 'movie' || item?.media_type === 'tv' ? item.media_type : fallbackType;
}


const deepSeekMoreLikeThisCache = new Map();

function getDeepSeekMoreLikeThisCacheKey(type, details = {}) {
  const title = type === 'game' ? getGameTitleValue(details) : getDiscoverMediaTitle(details, type);
  const year = type === 'game'
    ? String(details.released || details.year || '').slice(0, 4)
    : getDiscoverMediaDate(details, type).slice(0, 4);
  return `${type}:${String(title || '').toLowerCase()}:${year}`;
}

function normalizeDeepSeekMoreLikeThisType(value, fallbackType = 'movie') {
  const type = String(value || '').trim().toLowerCase();
  if (type.includes('game')) return 'game';
  if (type.includes('tv') || type.includes('show') || type.includes('series') || type.includes('anime')) return 'tv';
  if (type.includes('movie') || type.includes('film')) return 'movie';
  return fallbackType === 'game' ? 'game' : (fallbackType === 'tv' ? 'tv' : 'movie');
}

function getOwnLibraryTitleSet() {
  const source = ownDataCache || data || getEmptyListData();
  const titles = [];
  SCREENLIST_SECTIONS.forEach(section => {
    (source?.[section] || []).forEach(item => {
      const title = String(item?.title || item?.name || '').trim();
      if (title) titles.push(title.toLowerCase());
    });
  });
  return new Set(titles);
}

function getOwnLibraryTitlesForPrompt(limit = 80) {
  const source = ownDataCache || data || getEmptyListData();
  const titles = [];
  SCREENLIST_SECTIONS.forEach(section => {
    (source?.[section] || []).forEach(item => {
      const title = String(item?.title || item?.name || '').trim();
      if (title && !titles.includes(title)) titles.push(title);
    });
  });
  return titles.slice(0, limit);
}

function getDeepSeekMoreLikeThisContext(type, details = {}) {
  const isGame = type === 'game';
  const title = isGame ? getGameTitleValue(details) : getDiscoverMediaTitle(details, type);
  const year = isGame
    ? String(details.released || details.year || '').slice(0, 4)
    : getDiscoverMediaDate(details, type).slice(0, 4);
  const normalizedType = isGame
    ? 'game'
    : (type === 'movie' ? 'movie' : (details.mediaCategory === 'anime' || details.isAnime ? 'anime' : 'show'));
  const genres = isGame
    ? (details.genres || []).map(g => g.name || g).filter(Boolean)
    : (details.genres || []).map(g => g.name || g).filter(Boolean);
  const keywordSource = isGame
    ? (details.tags || [])
    : (details.keywords?.keywords || details.keywords?.results || []);
  const keywords = keywordSource.map(item => item.name || item).filter(Boolean).slice(0, 18);
  const overview = isGame
    ? String(details.description_raw || details.description || '').replace(/<[^>]*>/g, '')
    : String(details.overview || '');
  const extraFields = [];
  if (isGame) {
    const platforms = (details.platforms || []).map(p => p.platform?.name || p.name).filter(Boolean).slice(0, 6);
    const developers = (details.developers || []).map(dev => dev.name).filter(Boolean).slice(0, 4);
    const publishers = (details.publishers || []).map(pub => pub.name).filter(Boolean).slice(0, 4);
    if (platforms.length) extraFields.push(`Platforms: ${platforms.join(', ')}`);
    if (developers.length) extraFields.push(`Developers: ${developers.join(', ')}`);
    if (publishers.length) extraFields.push(`Publishers: ${publishers.join(', ')}`);
  } else {
    const creators = type === 'tv'
      ? (details.created_by || []).map(person => person.name).filter(Boolean).slice(0, 4)
      : getDiscoverMediaCrew(details.credits, ['Director']);
    if (creators.length) extraFields.push(`${type === 'tv' ? 'Created by' : 'Directed by'}: ${creators.join(', ')}`);
    if (details.tagline) extraFields.push(`Tagline: ${details.tagline}`);
  }
  return { title, year, type: normalizedType, genres, keywords, overview, extraFields };
}

function parseDeepSeekJsonMaybe(value) {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  let text = value.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(text); } catch(e) {}
  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    try { return JSON.parse(text.slice(arrayStart, arrayEnd + 1)); } catch(e) {}
  }
  const objectStart = text.indexOf('{');
  const objectEnd = text.lastIndexOf('}');
  if (objectStart !== -1 && objectEnd > objectStart) {
    try { return JSON.parse(text.slice(objectStart, objectEnd + 1)); } catch(e) {}
  }
  return null;
}

function normalizeMoreLikeThisComparableTitle(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDeepSeekMoreLikeThisResponse(raw, fallbackType = 'movie', sourceTitle = '') {
  const parsed = parseDeepSeekJsonMaybe(raw);
  const content = parsed?.choices?.[0]?.message?.content || parsed?.message?.content || parsed?.content || parsed?.text || parsed?.answer;
  if (content && typeof content === 'string') return normalizeDeepSeekMoreLikeThisResponse(content, fallbackType, sourceTitle);
  const possible = parsed?.recommendations || parsed?.results || parsed?.items || parsed?.titles || parsed?.data || parsed?.result || parsed;
  if (typeof possible === 'string') return normalizeDeepSeekMoreLikeThisResponse(possible, fallbackType, sourceTitle);
  const arr = Array.isArray(possible) ? possible : [];
  const ownTitles = getOwnLibraryTitleSet();
  const seen = new Set();
  const sourceNorm = normalizeMoreLikeThisComparableTitle(sourceTitle);
  return arr.map(item => {
    const title = String(item?.title || item?.name || '').trim();
    if (!title) return null;
    const normalizedTitle = title.toLowerCase();
    const comparableTitle = normalizeMoreLikeThisComparableTitle(title);
    if (!comparableTitle || comparableTitle === sourceNorm || normalizedTitle === sourceNorm || ownTitles.has(normalizedTitle) || seen.has(comparableTitle)) return null;
    seen.add(comparableTitle);
    return {
      title,
      year: String(item?.year || item?.releaseYear || item?.release_year || '').slice(0, 4),
      type: normalizeDeepSeekMoreLikeThisType(item?.type || item?.media_type, fallbackType),
      reason: String(item?.reason || item?.matchReason || item?.why || '').trim()
    };
  }).filter(Boolean).slice(0, 10);
}

function getDatabaseMoreLikeThisReason(item = {}, fallbackType = 'movie') {
  if (item.reason) return String(item.reason).trim();
  const rating = Number(item.vote_average || item.metacritic || 0);
  if (fallbackType === 'game') {
    const genres = (item.genres || []).map(g => g.name || g).filter(Boolean).slice(0, 2);
    return genres.length
      ? `Shares ${genres.join(' / ')} appeal and similar player discovery signals.`
      : 'Shares similar player appeal and discovery signals.';
  }
  const scoreText = rating ? ` with a strong ${fallbackType === 'tv' ? 'TV' : 'movie'} discovery score` : '';
  return `Recommended by the source database as a similar title${scoreText}.`;
}

function getDatabaseMoreLikeThisImage(item = {}, fallbackType = 'movie') {
  if (fallbackType === 'game') return typeof getScreenListDisplayGameCover === 'function' ? getScreenListDisplayGameCover(item) : (typeof getScreenListPreferredGameCover === 'function' ? getScreenListPreferredGameCover(item) : '');
  if (item.poster_path) return getTmdbImageUrl(item.poster_path, 'w500');
  if (item.backdrop_path) return getTmdbImageUrl(item.backdrop_path, 'w780');
  return item.poster || item.image || item.backdrop || '';
}

function normalizeSourceMoreLikeThisItems(items = [], fallbackType = 'movie', sourceTitle = '') {
  const ownTitles = getOwnLibraryTitleSet();
  const seen = new Set();
  const sourceNorm = normalizeMoreLikeThisComparableTitle(sourceTitle);
  return (items || []).map(item => {
    const itemType = normalizeDeepSeekMoreLikeThisType(item?.type || item?.media_type || fallbackType, fallbackType);
    const title = String(item?.title || item?.name || '').trim();
    if (!title) return null;
    const normalizedTitle = title.toLowerCase();
    const comparableTitle = normalizeMoreLikeThisComparableTitle(title);
    const itemId = String(item?.id || item?.rawgId || '').trim();
    if (!comparableTitle || comparableTitle === sourceNorm || ownTitles.has(normalizedTitle) || seen.has(`${itemType}:${comparableTitle}`)) return null;
    seen.add(`${itemType}:${comparableTitle}`);
    const year = String(item?.release_date || item?.first_air_date || item?.released || item?.year || '').slice(0, 4);
    return {
      id: itemId,
      title,
      year,
      type: itemType,
      image: getDatabaseMoreLikeThisImage(item, itemType),
      reason: getDatabaseMoreLikeThisReason(item, itemType),
      source: itemType === 'game' ? 'rawg' : 'tmdb',
      raw: item
    };
  }).filter(Boolean).slice(0, 10);
}

async function fetchSourceFallbackMoreLikeThis(type, details = {}) {
  const context = getDeepSeekMoreLikeThisContext(type, details);
  const fallbackType = type === 'game' ? 'game' : (type === 'tv' ? 'tv' : 'movie');
  const cacheKey = getDeepSeekMoreLikeThisCacheKey(type, details);
  if (deepSeekMoreLikeThisCache.has(cacheKey)) return deepSeekMoreLikeThisCache.get(cacheKey);
  let recommendations = [];

  if (type === 'game') {
    const genreSlugs = (details.genres || []).map(g => g.slug).filter(Boolean).slice(0, 3).join(',');
    const tagSlugs = (details.tags || []).map(tag => tag.slug).filter(Boolean).slice(0, 4).join(',');
    const params = { page_size: 20, ordering: '-metacritic' };
    if (genreSlugs) params.genres = genreSlugs;
    if (tagSlugs) params.tags = tagSlugs;
    if (!genreSlugs && !tagSlugs && context.title) params.search = context.title;
    const res = await fetchRawgProxy('games', params);
    if (!res.ok) throw new Error(`RAWG more-like-this failed: ${res.status}`);
    const json = await res.json();
    recommendations = normalizeSourceMoreLikeThisItems(json.results || [], 'game', context.title);
  } else {
    const id = details.id || details.tmdbId;
    const embeddedSimilar = details.similar?.results || [];
    let sourceItems = [];
    if (id) {
      const [recommendationsRes, similarRes] = await Promise.allSettled([
        fetchTmdbProxy(`${type}/${id}/recommendations`, { page: 1 }),
        fetchTmdbProxy(`${type}/${id}/similar`, { page: 1 })
      ]);
      for (const settled of [recommendationsRes, similarRes]) {
        if (settled.status !== 'fulfilled' || !settled.value?.ok) continue;
        const json = await settled.value.json();
        sourceItems = sourceItems.concat(json.results || []);
      }
    }
    if (!sourceItems.length && embeddedSimilar.length) sourceItems = embeddedSimilar;
    recommendations = normalizeSourceMoreLikeThisItems(sourceItems, fallbackType, context.title);
  }

  deepSeekMoreLikeThisCache.set(cacheKey, recommendations);
  return recommendations;
}

async function fetchDeepSeekMoreLikeThis(type, details = {}) {
  return fetchSourceFallbackMoreLikeThis(type, details);
}

function renderDeepSeekMoreLikeThisSection(type, details = {}) {
  const key = getDeepSeekMoreLikeThisCacheKey(type, details);
  return `<div class="discover-media-section discover-ai-more-section" data-ai-more-like-this-section="${escAttr(key)}"><h3>More Like This</h3><div class="discover-media-similar discover-ai-more-list" data-ai-more-like-this-list="${escAttr(key)}"><div class="discover-ai-more-loading">Loading source matches...</div></div></div>`;
}

function renderDeepSeekMoreLikeThisCards(recommendations = []) {
  return recommendations.map(item => {
    const year = item.year || '';
    const type = normalizeDeepSeekMoreLikeThisType(item.type);
    const typeLabel = type === 'tv' ? 'TV' : (type === 'game' ? 'Game' : 'Movie');
    const initial = (item.title || '?').trim().charAt(0).toUpperCase() || '?';
    const meta = [year, typeLabel].filter(Boolean).join(' · ');
    const imageHtml = item.image
      ? `<img src="${escAttr(item.image)}" alt="" loading="lazy" decoding="async">`
      : `<div class="discover-ai-similar-placeholder">${escHtml(initial)}</div>`;
    return `<button class="discover-media-similar-card discover-ai-similar-card discover-db-similar-card" type="button" data-ai-title="${escAttr(item.title)}" data-ai-year="${escAttr(year)}" data-ai-type="${escAttr(type)}" data-source-id="${escAttr(item.id || '')}" data-source-kind="${escAttr(item.source || (type === 'game' ? 'rawg' : 'tmdb'))}" data-source-image="${escAttr(item.image || '')}" onclick="openDeepSeekMoreLikeThisProfile(event, this)">${imageHtml}<span>${escHtml(item.title)}</span><small>${escHtml(meta)}${item.reason ? `<br>${escHtml(item.reason)}` : ''}</small></button>`;
  }).join('');
}

async function hydrateDeepSeekMoreLikeThis(type, details = {}) {
  const overlay = document.getElementById('discover-media-profile');
  const key = getDeepSeekMoreLikeThisCacheKey(type, details);
  const list = overlay?.querySelector?.('[data-ai-more-like-this-list]');
  if (!list || list.dataset.aiMoreLikeThisList !== key) return;
  let recommendations = [];
  try {
    recommendations = await fetchSourceFallbackMoreLikeThis(type, details);
  } catch (error) {
    console.error('Database more-like-this failed:', error);
  }
  const currentOverlay = document.getElementById('discover-media-profile');
  const currentList = currentOverlay?.querySelector?.('[data-ai-more-like-this-list]');
  if (!currentList || currentList.dataset.aiMoreLikeThisList !== key) return;
  if (recommendations.length) {
    currentList.innerHTML = renderDeepSeekMoreLikeThisCards(recommendations);
  } else {
    currentList.innerHTML = '<div class="discover-ai-more-loading">More Like This could not load from the source database right now.</div>';
  }
}

function pickDeepSeekResolvedMediaResult(results = [], title = '', year = '') {
  const normTitle = String(title || '').trim().toLowerCase();
  const exact = results.find(item => String(item.title || item.name || '').trim().toLowerCase() === normTitle && (!year || String(item.release_date || item.first_air_date || '').slice(0, 4) === String(year)));
  if (exact) return exact;
  const sameYear = year ? results.find(item => String(item.release_date || item.first_air_date || '').slice(0, 4) === String(year)) : null;
  return sameYear || results[0] || null;
}

async function openDeepSeekMoreLikeThisProfile(event, button) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const title = button?.dataset?.aiTitle || '';
  const year = button?.dataset?.aiYear || '';
  const type = normalizeDeepSeekMoreLikeThisType(button?.dataset?.aiType || 'movie');
  const sourceId = button?.dataset?.sourceId || '';
  const sourceImage = button?.dataset?.sourceImage || '';
  if (!title) return;
  try {
    button?.classList?.add('resolving');
    if (type === 'game') {
      if (sourceId) {
        setGameMediaProfileSeed(sourceId, { id: sourceId, rawgId: sourceId, title, name: title, released: year ? `${year}-01-01` : '', background_image: sourceImage });
        openGameMediaProfile(event, String(sourceId), getGameMediaProfileSeed(sourceId));
        return;
      }
      const res = await fetchRawgProxy('games', { search: title, page_size: 5 });
      if (!res.ok) throw new Error(`RAWG recommendation resolve failed: ${res.status}`);
      const json = await res.json();
      const results = json?.results || [];
      const picked = year
        ? (results.find(item => String(item.released || '').slice(0, 4) === year) || results[0])
        : results[0];
      if (!picked?.id) throw new Error('No RAWG recommendation match found');
      setGameMediaProfileSeed(picked.id, {
        ...picked,
        title: picked.name || title,
        rawgId: String(picked.id),
        released: picked.released || year,
        background_image: picked.background_image || ''
      });
      openGameMediaProfile(event, String(picked.id), getGameMediaProfileSeed(picked.id));
      return;
    }
    if (sourceId) {
      setDiscoverMediaProfileSeed(type, sourceId, {
        id: sourceId,
        title,
        name: title,
        poster: sourceImage,
        release_date: type === 'movie' && year ? `${year}-01-01` : '',
        first_air_date: type === 'tv' && year ? `${year}-01-01` : ''
      });
      openDiscoverMediaProfile(event, type, sourceId);
      return;
    }
    const params = { query: title };
    if (year) params[type === 'movie' ? 'primary_release_year' : 'first_air_date_year'] = year;
    let res = await fetchTmdbProxy(`search/${type}`, params);
    if (!res.ok) throw new Error(`TMDB recommendation resolve failed: ${res.status}`);
    let json = await res.json();
    let results = json?.results || [];
    if (!results.length && year) {
      res = await fetchTmdbProxy(`search/${type}`, { query: title });
      json = await res.json();
      results = json?.results || [];
    }
    const picked = pickDeepSeekResolvedMediaResult(results, title, year);
    if (!picked?.id) throw new Error('No TMDB recommendation match found');
    setDiscoverMediaProfileSeed(type, picked.id, {
      ...picked,
      title: picked.title || picked.name || title,
      name: picked.name || picked.title || title,
      release_date: picked.release_date || (type === 'movie' ? `${year}-01-01` : ''),
      first_air_date: picked.first_air_date || (type === 'tv' ? `${year}-01-01` : '')
    });
    openDiscoverMediaProfile(event, type, picked.id);
  } catch (error) {
    console.error('More Like This profile open failed:', error);
    if (typeof showToast === 'function') showToast('Could not open that recommendation yet');
  } finally {
    button?.classList?.remove('resolving');
  }
}

function getDiscoverMediaProfileSection(type, details = null) {
  if (type === 'movie') return 'movies';
  if (details) return resolveShowSection(details, details.mediaCategory || 'shows');
  return 'shows';
}

function renderDiscoverMediaProfileAddButton(type, id, details) {
  if (!currentUser && !isPreviewMode()) return '';
  const title = getDiscoverMediaTitle(details, type);
  const section = getDiscoverMediaProfileSection(type, details);
  const poster = getDiscoverMediaPoster(details);
  const added = isDuplicateTitle(title, section);
  const label = added ? getDiscoverLibraryButtonText(title, section) : '+ Add to Library';
  return `<button class="discover-media-add-floating${added ? ' added' : ''}" type="button" data-discover-type="${escAttr(type)}" data-discover-id="${escAttr(String(id || ''))}" data-discover-section="${escAttr(section)}" data-discover-title="${escAttr(title)}" data-discover-poster="${escAttr(poster)}" ${added ? `title="Manage this title in your library"` : ''}>${escHtml(label)}</button>`;
}

function getShareableMediaKind(type = 'movie', details = {}) {
  if (type === 'game') return 'game';
  if (type === 'tv' && (details?.mediaCategory === 'anime' || details?.librarySection === 'anime' || details?.isAnime)) return 'anime';
  return type === 'tv' ? 'tv' : 'movie';
}

function buildMediaProfileShareUrl(kind = 'movie', id = '') {
  const safeKind = ['movie', 'tv', 'anime', 'game'].includes(String(kind)) ? String(kind) : 'movie';
  const safeId = encodeURIComponent(String(id || '').trim());
  return `${window.location.origin}/media/${safeKind}/${safeId}`;
}

function getMediaProfileShareIconSvg() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.4 10.8 15.6 6M8.4 13.2l7.2 4.8"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="5" r="2.6"/><circle cx="18" cy="19" r="2.6"/></svg>`;
}

function getMediaProfileSharePayload(kind = 'movie', id = '', title = '', poster = '') {
  const safeKind = ['movie', 'tv', 'anime', 'game'].includes(String(kind)) ? String(kind) : 'movie';
  const safeId = String(id || '').trim();
  return normalizeSharedMediaPayload({
    kind: safeKind,
    id: safeId,
    title,
    poster,
    url: buildMediaProfileShareUrl(safeKind, safeId)
  });
}

function renderMediaProfileShareButton(kind = 'movie', id = '', title = '', poster = '') {
  if (!id) return '';
  return `<button class="discover-media-share-floating" type="button" onclick="openMediaProfileShareMenu(event, '${escAttr(kind)}', '${escAttr(String(id || ''))}', '${escAttr(title || '')}', '${escAttr(poster || '')}')" aria-label="Share this media profile" title="Share">${getMediaProfileShareIconSvg()}</button>`;
}

function renderMediaProfileTopActions(shareHtml = '', addHtml = '') {
  const content = `${shareHtml || ''}${addHtml || ''}`.trim();
  return content ? `<div class="discover-media-action-row">${content}</div>` : '';
}

function closeMediaProfileShareMenu() {
  const overlay = document.getElementById('media-profile-share-menu');
  if (!overlay) return;
  overlay.classList.remove('open');
  window.setTimeout(() => overlay.remove(), 180);
}

function openMediaProfileShareMenu(event, kind = 'movie', id = '', title = '', poster = '') {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const payload = getMediaProfileSharePayload(kind, id, title, poster);
  if (!payload.id) return;
  closeMediaProfileShareMenu();
  const overlay = document.createElement('div');
  overlay.id = 'media-profile-share-menu';
  overlay.className = 'media-share-overlay';
  overlay.dataset.kind = payload.kind;
  overlay.dataset.id = payload.id;
  overlay.dataset.title = payload.title;
  overlay.dataset.poster = payload.poster;
  overlay.dataset.url = payload.url;
  overlay.innerHTML = `
    <div class="media-share-sheet" role="dialog" aria-modal="true" aria-label="Share media profile">
      <div class="media-share-handle" aria-hidden="true"></div>
      <div class="media-share-head">
        <div><span>Share</span><strong>${escHtml(payload.title)}</strong></div>
        <button type="button" class="media-share-close" onclick="closeMediaProfileShareMenu()" aria-label="Close">×</button>
      </div>
      <button type="button" class="media-share-choice" onclick="openScreenListShareFlow()"><span>Share in ScreenList</span><em>${currentUser ? 'Send to a friend or message thread' : 'Sign in required'}</em></button>
      <button type="button" class="media-share-choice" onclick="shareMediaProfileAnywhere()"><span>Share Anywhere</span><em>Text, copy link, or share outside ScreenList</em></button>
      <div id="media-share-screenlist-panel" class="media-share-screenlist-panel" hidden></div>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeMediaProfileShareMenu(); });
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
}

function getActiveMediaSharePayload() {
  const overlay = document.getElementById('media-profile-share-menu');
  if (!overlay) return null;
  return getMediaProfileSharePayload(overlay.dataset.kind, overlay.dataset.id, overlay.dataset.title, overlay.dataset.poster);
}

async function shareMediaProfileAnywhere() {
  const payload = getActiveMediaSharePayload();
  if (!payload) return;
  const shareTitle = payload.title ? `${payload.title} on ScreenList` : 'ScreenList media profile';
  try {
    if (navigator.share) {
      await navigator.share({ title: shareTitle, url: payload.url });
      closeMediaProfileShareMenu();
      return;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(payload.url);
    closeMediaProfileShareMenu();
    showToast('Link copied');
  } catch (e) {
    showToast('Could not copy link');
  }
}

function getScreenListShareCandidates(query = '') {
  const q = String(query || '').trim().toLowerCase();
  const byUid = new Map();
  const addUser = (user = {}) => {
    if (!user?.uid || user.uid === currentUser?.uid) return;
    const name = getDisplayName(user, 'User');
    if (q && !String(name || '').toLowerCase().includes(q)) return;
    byUid.set(user.uid, { ...(byUid.get(user.uid) || {}), ...user, name });
  };
  (friends || []).forEach(uid => addUser({ ...(usersMap[uid] || {}), uid }));
  Object.values(dmThreadMap || {}).forEach(thread => {
    const uid = getDirectMessageOtherUid(thread);
    if (uid) addUser({ ...(usersMap[uid] || getDirectMessageOtherProfile(thread)), uid });
  });
  return [...byUid.values()].sort((a, b) => getDisplayName(a, 'User').localeCompare(getDisplayName(b, 'User')));
}

function renderScreenListSharePicker(query = '') {
  const panel = document.getElementById('media-share-screenlist-panel');
  if (!panel) return;
  if (!currentUser) {
    panel.hidden = false;
    panel.innerHTML = `<div class="media-share-empty">Sign in to share inside ScreenList.</div>`;
    return;
  }
  const candidates = getScreenListShareCandidates(query);
  panel.hidden = false;
  panel.innerHTML = `
    <input class="media-share-search" type="text" value="${escAttr(query)}" placeholder="Search friends or chats" oninput="renderScreenListSharePicker(this.value)">
    <textarea class="media-share-note" id="media-share-note" maxlength="240" placeholder="Add a short message"></textarea>
    <div class="media-share-users">
      ${candidates.length ? candidates.map(user => `
        <button type="button" class="media-share-user" onclick="sendMediaProfileShareToUser('${escAttr(user.uid)}')">
          <img src="${escAttr(getDirectMessageAvatar(user))}" alt="" loading="lazy">
          <span>${renderDisplayNameHTML(user, 'User')}</span>
        </button>`).join('') : '<div class="media-share-empty">No friends or chats found.</div>'}
    </div>`;
  const input = panel.querySelector('.media-share-search');
  if (input) {
    const len = input.value.length;
    input.focus({ preventScroll: true });
    try { input.setSelectionRange(len, len); } catch(e) {}
  }
}

function openScreenListShareFlow() {
  renderScreenListSharePicker('');
}

function renderDirectMessageShareCard(message = {}) {
  const media = normalizeSharedMediaPayload(message.shareMedia);
  if (!media || !media.url) return '';
  return `<a class="dm-shared-media-card" href="${escAttr(media.url)}" onclick="return openSharedMediaProfileLink(event, '${escAttr(media.url)}')" title="Open media profile">
    ${media.poster ? `<img src="${escAttr(media.poster)}" alt="" loading="lazy">` : ''}
    <span><strong>${escHtml(media.title || 'Media profile')}</strong><em>Open media profile</em></span>
  </a>`;
}

async function appendDirectMessageToThread(threadId = '', text = '', shareMedia = null, photoMedia = null) {
  const thread = dmThreadMap[threadId];
  const cleanText = String(text || '').trim();
  const normalizedShareMedia = normalizeSharedMediaPayload(shareMedia);
  if ((!cleanText && !normalizedShareMedia && !photoMedia) || !currentUser || !thread) return false;
  const now = Date.now();
  const messageId = `msg_${currentUser.uid}_${now}`;
  const message = {
    id: messageId,
    fromUid: currentUser.uid,
    createdAtMs: now,
    isEncrypted: false,
    text: cleanText.slice(0, 1000),
    shareMedia: normalizedShareMedia || null,
    imageData: photoMedia?.imageData || '',
    imageName: photoMedia?.name || ''
  };
  const lastMessage = photoMedia?.imageData ? 'Photo' : normalizedShareMedia ? 'Shared media' : message.text;
  const unreadUids = isDirectMessageGroupThread(thread)
    ? (thread.participantUids || []).filter(uid => uid && uid !== currentUser.uid)
    : [getDirectMessageOtherUid(thread)].filter(Boolean);
  const nextThread = normalizeDirectMessageThread({
    ...thread,
    messages: [...(thread.messages || []), message].filter(msg => !isDirectMessageEncryptedRecord(msg)).slice(-80),
    lastMessage,
    lastMessageFromUid: currentUser.uid,
    lastMessageAtMs: now,
    unreadUids,
    updatedAtMs: now
  });
  dmThreadMap[threadId] = nextThread;
  renderDirectMessagesView();
  try { await mirrorDirectMessageThreadToParticipants(nextThread); return true; }
  catch(error) {
    console.error('appendDirectMessageToThread failed:', error);
    dmThreadMap[threadId] = thread;
    renderDirectMessagesView();
    const message = error?.message || error?.code || 'Could not send message';
    showToast(`Could not send: ${message}`);
    return false;
  }
}
async function sendMediaProfileShareToUser(uid = '') {
  const payload = getActiveMediaSharePayload();
  if (!currentUser || !payload || !uid) return;
  const note = String(document.getElementById('media-share-note')?.value || '').trim();
  const thread = await openOrCreateDirectMessageThreadForUser(uid);
  if (!thread?.id) return;
  const sent = await appendDirectMessageToThread(thread.id, note || `Check this out: ${payload.title}`, payload);
  if (sent) { closeMediaProfileShareMenu(); showToast('Shared in ScreenList'); }
}

function closeDiscoverMediaLibraryDock() {
  document.querySelector('.discover-media-library-dock')?.remove();
}

function removeMediaProfileSwipeRevealUnderlay(overlay = document.getElementById('discover-media-profile')) {
  overlay?.querySelector?.('.screenlist-media-swipe-underlay')?.remove();
  overlay?.classList?.remove('media-profile-swipe-revealing');
  document.body.classList.remove('media-profile-swipe-reveal-active');
}

function createMediaProfileSwipeRevealUnderlay(overlay) {
  if (!overlay) return null;
  let underlay = overlay.querySelector('.screenlist-media-swipe-underlay');
  if (!underlay) {
    underlay = document.createElement('div');
    underlay.className = 'screenlist-media-swipe-underlay';
    underlay.setAttribute('aria-hidden', 'true');

    const content = document.createElement('div');
    content.className = 'screenlist-media-swipe-underlay-content';
    const scrollY = window.scrollY || window.pageYOffset || 0;
    content.style.transform = `translate3d(0, ${-scrollY}px, 0)`;

    const app = document.getElementById('app-container');
    const appClone = app ? app.cloneNode(true) : null;
    if (appClone) {
      appClone.id = 'screenlist-swipe-underlay-app';
      appClone.querySelectorAll('[id]').forEach((node, index) => {
        node.id = `screenlist-swipe-underlay-${index}-${node.id}`;
      });
      appClone.querySelectorAll('script').forEach(node => node.remove());
      appClone.style.display = app.style.display || 'block';
      appClone.style.pointerEvents = 'none';
      content.appendChild(appClone);
    }

    const nav = document.getElementById('mobile-bottom-nav');
    if (nav && !content.querySelector('.mobile-bottom-nav')) {
      const navClone = nav.cloneNode(true);
      navClone.id = 'screenlist-swipe-underlay-bottom-nav';
      navClone.querySelectorAll('[id]').forEach((node, index) => {
        node.id = `screenlist-swipe-underlay-nav-${index}-${node.id}`;
      });
      navClone.style.pointerEvents = 'none';
      content.appendChild(navClone);
    }

    underlay.appendChild(content);
    overlay.insertBefore(underlay, overlay.firstChild);
  }

  overlay.classList.add('media-profile-swipe-revealing');
  document.body.classList.add('media-profile-swipe-reveal-active');
  return underlay;
}

function bindDiscoverMediaProfileSwipeBack(overlay) {
  const page = overlay?.querySelector?.('.discover-media-page');
  if (!page || page.dataset.swipeBackBound === 'true') return;
  page.dataset.swipeBackBound = 'true';

  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastTime = 0;
  let velocityX = 0;
  let viewportW = 0;
  let viewportH = 0;
  let canSwipeBack = false;
  let canPullDown = false;
  let gestureMode = '';
  let activePointerId = null;
  let rafId = 0;
  let pendingX = 0;
  let pendingY = 0;
  let pendingProgress = 0;

  const renderGestureFrame = () => {
    rafId = 0;
    if (gestureMode === 'swipe-back') {
      page.style.transform = `translate3d(${pendingX}px, 0, 0)`;
      overlay.style.background = `rgba(5, 4, 13, ${Math.max(0, 0.18 - pendingProgress * 0.18)})`;
      return;
    }
    if (gestureMode === 'pull-down') {
      page.style.transform = `translate3d(0, ${pendingY}px, 0) scale(${1 - pendingProgress * 0.025})`;
      overlay.style.background = `rgba(5, 4, 13, ${Math.max(0.08, 0.22 - pendingProgress * 0.16)})`;
    }
  };

  const requestGestureFrame = () => {
    if (!rafId) rafId = requestAnimationFrame(renderGestureFrame);
  };

  const clearGestureFrame = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  };

  const resetGestureStyles = () => {
    clearGestureFrame();
    gestureMode = '';
    pendingX = 0;
    pendingY = 0;
    pendingProgress = 0;
    activePointerId = null;
    page.classList.remove('media-profile-swipe-dragging', 'media-profile-pull-dragging');
    overlay.classList.remove('media-profile-swipe-revealing');
    document.body.classList.remove('media-profile-swipe-reveal-active');
    page.style.transition = '';
    page.style.transform = '';
    page.style.willChange = '';
    page.style.backfaceVisibility = '';
    page.style.webkitBackfaceVisibility = '';
    page.style.touchAction = '';
    page.style.boxShadow = '';
    page.style.borderRadius = '';
    page.style.borderTopLeftRadius = '';
    page.style.borderBottomLeftRadius = '';
    page.style.overflow = '';
    overlay.style.transition = '';
    overlay.style.background = '';
    overlay.style.opacity = '';
  };

  const armGesture = (mode) => {
    if (gestureMode === mode) return;
    gestureMode = mode;
    page.style.transition = 'none';
    overlay.style.transition = 'none';
    page.style.willChange = 'transform';
    page.style.backfaceVisibility = 'hidden';
    page.style.webkitBackfaceVisibility = 'hidden';
    page.style.touchAction = mode === 'swipe-back' ? 'none' : 'pan-x';
    page.style.transform = 'translate3d(0, 0, 0)';
    if (mode === 'swipe-back') {
      page.classList.add('media-profile-swipe-dragging');
      overlay.classList.add('media-profile-swipe-revealing');
      document.body.classList.add('media-profile-swipe-reveal-active');
      page.style.boxShadow = '-18px 0 42px rgba(0,0,0,0.28)';
      page.style.borderTopLeftRadius = '18px';
      page.style.borderBottomLeftRadius = '18px';
      page.style.overflow = 'hidden';
      overlay.style.background = 'rgba(5, 4, 13, 0.18)';
    } else {
      page.classList.add('media-profile-pull-dragging');
      page.style.borderRadius = '14px 14px 0 0';
      page.style.boxShadow = '0 18px 42px rgba(0,0,0,0.28)';
      overlay.style.background = 'rgba(5, 4, 13, 0.22)';
    }
  };

  const closeFromSwipe = () => {
    clearGestureFrame();
    page.style.transition = 'transform 0.22s cubic-bezier(0.18, 0.92, 0.18, 1), box-shadow 0.22s ease, border-radius 0.22s ease';
    overlay.style.transition = 'background 0.22s ease';
    page.style.willChange = 'transform';
    page.style.transform = 'translate3d(105vw, 0, 0)';
    page.style.boxShadow = '-20px 0 44px rgba(0,0,0,0.12)';
    page.style.borderTopLeftRadius = '30px';
    page.style.borderBottomLeftRadius = '30px';
    overlay.style.background = 'transparent';
    window.setTimeout(() => {
      closeMediaProfileOverlayImmediately(overlay, () => {
        document.body.classList.remove('discover-media-profile-open', 'game-media-profile-open', 'media-profile-swipe-reveal-active');
      });
    }, 230);
  };

  const snapBack = () => {
    clearGestureFrame();
    page.style.transition = 'transform 0.22s cubic-bezier(0.2, 1, 0.3, 1), box-shadow 0.22s ease, border-radius 0.22s ease';
    overlay.style.transition = 'background 0.22s ease, opacity 0.22s ease';
    page.style.transform = 'translate3d(0, 0, 0)';
    page.style.boxShadow = '';
    page.style.borderRadius = '';
    page.style.borderTopLeftRadius = '';
    page.style.borderBottomLeftRadius = '';
    overlay.style.background = '';
    window.setTimeout(resetGestureStyles, 230);
  };

  const handleGestureStart = (event) => {
    const point = event.touches?.[0] || event;
    if (!point) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.touches && event.touches.length !== 1) return;
    if (event.target.closest('.discover-media-back, .discover-media-cast, .discover-media-similar, .discover-media-library-dock, .discover-media-add-floating, button, a, input, textarea, select')) return;
    startX = point.clientX;
    startY = point.clientY;
    lastX = startX;
    lastTime = performance.now();
    velocityX = 0;
    viewportW = window.innerWidth || 360;
    viewportH = window.innerHeight || 740;
    canSwipeBack = startX <= 48;
    canPullDown = page.scrollTop <= 2;
    gestureMode = '';
    activePointerId = event.pointerId ?? null;
  };

  const handleGestureMove = (event) => {
    if (!canSwipeBack && !canPullDown) return;
    const point = event.touches?.[0] || event;
    if (!point) return;
    if (activePointerId !== null && event.pointerId !== undefined && event.pointerId !== activePointerId) return;

    const dx = point.clientX - startX;
    const dy = point.clientY - startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (!gestureMode) {
      if (canSwipeBack && dx > 14 && absDx > absDy * 1.35) {
        armGesture('swipe-back');
        try { page.setPointerCapture?.(event.pointerId); } catch (e) {}
      } else if (canPullDown && page.scrollTop <= 2 && dy > 18 && absDy > absDx * 1.25) {
        armGesture('pull-down');
      } else if (absDy > absDx * 1.15) {
        canSwipeBack = false;
        return;
      } else {
        return;
      }
    }

    if (gestureMode === 'swipe-back') {
      if (event.cancelable) event.preventDefault();
      const now = performance.now();
      const dt = Math.max(1, now - lastTime);
      velocityX = (point.clientX - lastX) / dt;
      lastX = point.clientX;
      lastTime = now;
      pendingX = Math.max(0, Math.min(viewportW, dx));
      pendingProgress = Math.min(1, pendingX / Math.max(1, viewportW));
      requestGestureFrame();
      return;
    }

    if (gestureMode === 'pull-down') {
      if (event.cancelable) event.preventDefault();
      pendingY = Math.max(0, Math.min(viewportH, dy)) * 0.72;
      pendingProgress = Math.min(1, pendingY / Math.max(1, viewportH * 0.36));
      requestGestureFrame();
    }
  };

  const handleGestureEnd = (event) => {
    if (!canSwipeBack && !canPullDown && !gestureMode) return;
    const point = event.changedTouches?.[0] || event;
    const dx = point ? point.clientX - startX : pendingX;
    const dy = point ? point.clientY - startY : pendingY;
    const mode = gestureMode;
    canSwipeBack = false;
    canPullDown = false;
    try { if (activePointerId !== null) page.releasePointerCapture?.(activePointerId); } catch (e) {}
    activePointerId = null;

    if (mode === 'swipe-back') {
      const shouldClose = dx >= viewportW * 0.34 || (dx > 58 && velocityX > 0.75);
      if (shouldClose) closeFromSwipe();
      else snapBack();
      return;
    }

    if (mode === 'pull-down') {
      if (dy > 92 && dy > Math.abs(dx) * 1.22) {
        clearGestureFrame();
        if (overlay.classList.contains('game-media-profile-overlay')) closeGameMediaProfile('pull-down');
        else closeDiscoverMediaProfile('pull-down');
      } else {
        snapBack();
      }
      return;
    }

    resetGestureStyles();
  };

  page.addEventListener('pointerdown', handleGestureStart, { passive: true });
  page.addEventListener('pointermove', handleGestureMove, { passive: false });
  page.addEventListener('pointerup', handleGestureEnd, { passive: true });
  page.addEventListener('pointercancel', resetGestureStyles, { passive: true });

  // iOS Safari fallback for older WebKit behavior.
  page.addEventListener('touchstart', handleGestureStart, { passive: true });
  page.addEventListener('touchmove', handleGestureMove, { passive: false });
  page.addEventListener('touchend', handleGestureEnd, { passive: true });
  page.addEventListener('touchcancel', resetGestureStyles, { passive: true });
}

function renderDiscoverMediaLibraryRatingStars(score = 0, section = '') {
  const stepCount = getRatingStepCountForSection(section);
  let stars = '';
  if (stepCount === 5) {
    for (let star = 1; star <= 5; star++) {
      const leftVal = star * 2 - 1;
      const rightVal = star * 2;
      stars += `<button class="star-btn half-step left discover-media-library-star${leftVal <= score ? ' lit' : ''}" type="button" data-rating="${leftVal}" aria-label="Rate ${formatRatingValueForSection(leftVal, section, true)}">★</button>`;
      stars += `<button class="star-btn half-step right discover-media-library-star${rightVal <= score ? ' lit' : ''}" type="button" data-rating="${rightVal}" aria-label="Rate ${formatRatingValueForSection(rightVal, section, true)}">★</button>`;
    }
  } else {
    for (let i = 1; i <= 10; i++) {
      stars += `<button class="star-btn discover-media-library-star${i <= score ? ' lit' : ''}" type="button" data-rating="${i}" aria-label="Rate ${i} out of 10">★</button>`;
    }
  }
  return stars;
}

function updateDiscoverMediaLibraryStars(container, rating, pop = false) {
  if (!container) return;
  const section = container.dataset.section || activeSection;
  container.querySelectorAll('.discover-media-library-star').forEach((star, index) => {
    const lit = Number(star.dataset.rating || index + 1) <= rating;
    star.classList.toggle('lit', lit);
    star.style.color = lit ? '#f59e0b' : '#443d60';
    star.style.transform = lit && pop ? 'scale(1.2)' : 'scale(1)';
  });
  const value = container.closest('.discover-media-library-rating')?.querySelector('.discover-media-library-rating-value');
  if (value) value.textContent = rating > 0 ? formatRatingValueForSection(rating, section, true) : 'Tap a star';
}

function showDiscoverMediaLibraryDock(btn) {
  if (!btn || btn.disabled) return;
  closeDiscoverMediaLibraryDock();
  const overlay = document.getElementById('discover-media-profile');
  if (!overlay) return;
  const type = btn.dataset.discoverType;
  const id = btn.dataset.discoverId;
  const title = btn.dataset.discoverTitle || 'this title';
  const poster = btn.dataset.discoverPoster || '';
  const isAdded = btn.classList.contains('added');
  const isGame = type === 'game';
  const ratingSection = getRatingSectionForDiscoverType(type);
  const mediaLabel = type === 'tv' ? 'series' : isGame ? 'game' : 'movie';
  const dock = document.createElement('div');
  dock.className = 'discover-media-library-dock';
  dock.innerHTML = `
    <div class="discover-media-library-glow" aria-hidden="true"></div>
    <div class="discover-media-library-preview">
      <div class="discover-media-library-thumb">${poster ? `<img src="${escAttr(poster)}" alt="">` : ''}</div>
      <div>
        <div class="discover-media-library-eyebrow">${isAdded ? 'In your library' : `Save ${escHtml(mediaLabel)}`}</div>
        <div class="discover-media-library-title">${escHtml(title)}</div>
      </div>
    </div>
    ${isAdded ? `
      <div class="discover-media-library-added-note">Already tucked into your ScreenList. Want to pull it back out?</div>
      <div class="discover-media-library-actions single">
        <button class="discover-media-library-choice remove" type="button">
          <span>Remove from Library</span>
          <small>Undo this save</small>
        </button>
      </div>
    ` : `
      <div class="discover-media-library-actions">
        <button class="discover-media-library-choice planned" type="button" data-status="planned">
          <span>${isGame ? 'Backlog' : 'Watchlist'}</span>
          <small>Save for later</small>
        </button>
        <button class="discover-media-library-choice watched" type="button" data-status="watched">
          <span>${isGame ? 'Played' : 'Watched'}</span>
          <small>Add a rating</small>
        </button>
      </div>
      <div class="discover-media-library-rating" hidden>
        <div class="discover-media-library-rating-top">
          <span>How did it hit?</span>
          <strong class="discover-media-library-rating-value">Tap a star</strong>
        </div>
        <div class="stars discover-media-library-stars${isFivePointRatingSection(ratingSection) ? ' rating-scale-five' : ''}" data-section="${escAttr(ratingSection)}" style="--star-size:18px;">${renderDiscoverMediaLibraryRatingStars(0, ratingSection)}</div>
        <button class="discover-media-library-skip" type="button">Skip rating</button>
      </div>
    `}
    <button class="discover-media-library-close" type="button" aria-label="Close add panel">×</button>
  `;
  overlay.appendChild(dock);
  requestAnimationFrame(() => dock.classList.add('open'));

  const addFromDock = async (status, rating = 0) => {
    if (!type || !id || btn.disabled) return;
    if (dock.dataset.saving === 'true') return;
    dock.dataset.saving = 'true';
    if (status === 'watched' && rating > 0) {
      const starsContainer = dock.querySelector('.discover-media-library-stars');
      updateDiscoverMediaLibraryStars(starsContainer, rating, false);
      const animationMs = playDiscoveryModalRatingAnimation(rating, starsContainer);
      await new Promise(resolve => window.setTimeout(resolve, Math.max(animationMs, 760)));
    }
    dock.classList.add('saving');
    await addDiscoveryTitle(type, id, btn, status, '+ Add to Library', rating, { postPromptDelayMs: 820 });
    dock.classList.remove('saving');
    dock.classList.add('saved');
    const savedLabel = status === 'watched'
      ? (rating ? `Rated ${formatRatingValueForSection(rating, ratingSection, true)}` : (isGame ? 'Marked Played' : 'Marked Watched'))
      : (isGame ? 'Saved to Backlog' : 'Saved to Watchlist');
    dock.innerHTML = `
      <div class="discover-media-library-glow" aria-hidden="true"></div>
      <div class="discover-media-library-success-mark">✓</div>
      <div class="discover-media-library-success-title">${escHtml(savedLabel)}</div>
      <div class="discover-media-library-success-sub">${escHtml(title)} is in your library.</div>
    `;
    window.setTimeout(closeDiscoverMediaLibraryDock, 760);
  };

  const removeFromDock = async () => {
    if (btn.disabled) return;
    if (dock.dataset.saving === 'true') return;
    dock.dataset.saving = 'true';
    dock.classList.add('saving');
    await removeDiscoveryTitle(btn);
    dock.classList.remove('saving');
    dock.classList.add('saved');
    dock.innerHTML = `
      <div class="discover-media-library-glow" aria-hidden="true"></div>
      <div class="discover-media-library-success-mark remove">−</div>
      <div class="discover-media-library-success-title">Removed</div>
      <div class="discover-media-library-success-sub">${escHtml(title)} left your library.</div>
    `;
    window.setTimeout(closeDiscoverMediaLibraryDock, 720);
  };

  dock.querySelector('.discover-media-library-close')?.addEventListener('click', closeDiscoverMediaLibraryDock);
  dock.querySelector('.discover-media-library-choice.remove')?.addEventListener('click', removeFromDock);
  dock.querySelector('.discover-media-library-choice.planned')?.addEventListener('click', () => addFromDock('planned', 0));
  dock.querySelector('.discover-media-library-choice.watched')?.addEventListener('click', () => {
    dock.querySelector('.discover-media-library-rating')?.removeAttribute('hidden');
    dock.classList.add('rating-open');
    bindDiscoverMediaLibraryStarScrub(dock, addFromDock);
  });
  dock.querySelector('.discover-media-library-skip')?.addEventListener('click', () => addFromDock('watched', 0));
}

function bindDiscoverMediaLibraryStarScrub(dock, addFromDock) {
  const container = dock?.querySelector?.('.discover-media-library-stars');
  if (!container || container.dataset.bound === 'true') return;
  container.dataset.bound = 'true';
  container.dataset.scrubbing = 'false';
  container.dataset.scrubVal = '0';

  const getRatingFromX = (clientX) => {
    const stars = [...container.querySelectorAll('.discover-media-library-star')];
    let val = 0;
    stars.forEach((star, index) => {
      if (clientX >= star.getBoundingClientRect().left) val = index + 1;
    });
    return Math.max(1, Math.min(10, val));
  };

  container.querySelectorAll('.discover-media-library-star').forEach(star => {
    star.addEventListener('mouseenter', () => {
      updateDiscoverMediaLibraryStars(container, Number(star.dataset.rating || 0), true);
    });
    star.addEventListener('mouseleave', () => {
      updateDiscoverMediaLibraryStars(container, Number(container.dataset.scrubVal || 0), false);
    });
    star.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (container.dataset.justScrubbed === 'true') return;
      if (container.dataset.scrubbing === 'true') return;
      const rating = Number(star.dataset.rating || 0);
      container.dataset.scrubVal = String(rating);
      updateDiscoverMediaLibraryStars(container, rating, true);
      window.setTimeout(() => addFromDock('watched', rating), 140);
    });
  });

  container.addEventListener('touchstart', (event) => {
    const touch = event.touches[0];
    container.dataset.touchStartX = String(touch.clientX);
    container.dataset.touchStartY = String(touch.clientY);
    container.dataset.scrubbing = 'false';
    container.dataset.scrubVal = '0';
  }, { passive: true });

  container.addEventListener('touchmove', (event) => {
    const touch = event.touches[0];
    const dx = Math.abs(touch.clientX - parseFloat(container.dataset.touchStartX || 0));
    const dy = Math.abs(touch.clientY - parseFloat(container.dataset.touchStartY || 0));
    if (container.dataset.scrubbing !== 'true') {
      if (dx < 10 || dy > dx) return;
    }
    container.dataset.scrubbing = 'true';
    event.preventDefault();
    const rating = getRatingFromX(touch.clientX);
    container.dataset.scrubVal = String(rating);
    updateDiscoverMediaLibraryStars(container, rating, true);
  }, { passive: false });

  container.addEventListener('touchend', (event) => {
    if (container.dataset.scrubbing !== 'true') return;
    event.preventDefault();
    const rating = Number(container.dataset.scrubVal || 0);
    container.dataset.scrubbing = 'false';
    container.dataset.justScrubbed = 'true';
    window.setTimeout(() => {
      container.dataset.justScrubbed = 'false';
    }, 220);
    if (rating > 0) addFromDock('watched', rating);
  }, { passive: false });
}

function bindDiscoverMediaProfileActions(overlay) {
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
    const type = addButton.dataset.discoverType;
    const id = addButton.dataset.discoverId;
    if (!type || !id || addButton.disabled) return;
    showDiscoverMediaLibraryDock(addButton);
  });
}

let activeDiscoverMediaProfileState = null;

function getDiscoverPersonKnownFor(details = {}) {
  return (details.combined_credits?.cast || [])
    .filter(item => item && (item.poster_path || item.backdrop_path) && (item.title || item.name))
    .sort((a, b) => Number(b.popularity || 0) - Number(a.popularity || 0))
    .slice(0, 8);
}

function getDiscoverPersonCreditRole(item = {}) {
  const direct = String(item.character || '').trim();
  if (direct) return direct;
  if (Array.isArray(item.roles)) {
    return item.roles
      .map(role => String(role?.character || '').trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(', ');
  }
  return '';
}

function getDiscoverPersonCreditRoleMeta(item = {}) {
  const role = getDiscoverPersonCreditRole(item);
  const year = (item?.release_date || item?.first_air_date || '').slice(0, 4);
  if (role) return [`as ${role}`, year].filter(Boolean).join(' · ');
  return year ? `Role being checked · ${year}` : 'Role being checked';
}


function calculateDiscoverPersonAge(birthday = '', deathday = '') {
  if (!birthday) return '';
  const birth = new Date(`${birthday}T00:00:00`);
  const end = deathday ? new Date(`${deathday}T00:00:00`) : new Date();
  if (Number.isNaN(birth.getTime()) || Number.isNaN(end.getTime())) return '';
  let age = end.getFullYear() - birth.getFullYear();
  const monthDelta = end.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && end.getDate() < birth.getDate())) age -= 1;
  return age > 0 ? String(age) : '';
}

function getDiscoverPersonCreditFameScore(item = {}) {
  const popularity = Number(item.popularity || 0);
  const votes = Math.min(Number(item.vote_count || 0), 20000) / 250;
  const rating = Number(item.vote_average || 0) * 1.5;
  const orderBoost = Number.isFinite(Number(item.order)) && Number(item.order) <= 5 ? 10 : 0;
  return popularity + votes + rating + orderBoost;
}

function getDiscoverPersonMostKnownFor(details = {}) {
  return (details.combined_credits?.cast || [])
    .filter(item => item && (item.poster_path || item.backdrop_path) && (item.title || item.name))
    .sort((a, b) => getDiscoverPersonCreditFameScore(b) - getDiscoverPersonCreditFameScore(a))
    .slice(0, 6);
}

function normalizeDeepSeekPersonBioFactsResponse(raw) {
  const parsed = parseDeepSeekJsonMaybe(raw) || raw;
  const content = parsed?.choices?.[0]?.message?.content || parsed?.message?.content || parsed?.content || parsed?.text || parsed?.answer;
  if (content && typeof content === 'string') return normalizeDeepSeekPersonBioFactsResponse(content);
  const source = parsed?.result || parsed?.data || parsed || {};
  const mostKnownForRaw = source.mostKnownFor || source.most_known_for || source.knownFor || source.known_for || [];
  const mostKnownFor = (Array.isArray(mostKnownForRaw) ? mostKnownForRaw : String(mostKnownForRaw || '').split(','))
    .map(item => typeof item === 'string' ? item.trim() : String(item?.title || item?.name || '').trim())
    .filter(Boolean)
    .slice(0, 8);
  return {
    age: String(source.age || '').trim(),
    birthdate: String(source.birthdate || source.birthDate || source.birthday || '').trim(),
    height: String(source.height || '').trim(),
    weight: String(source.weight || '').trim(),
    birthName: String(source.birthName || source.birth_name || '').trim(),
    nameTheyUse: String(source.nameTheyUse || source.name_they_use || source.stageName || source.professionalName || '').trim(),
    mostKnownFor
  };
}

async function fetchDeepSeekPersonBioFacts(details = {}) {
  const name = details.name || '';
  if (!name) return {};
  const credits = getDiscoverPersonMostKnownFor(details)
    .map(item => item.title || item.name)
    .filter(Boolean)
    .slice(0, 8)
    .join(', ');
  const prompt = [
    'Return valid JSON only.',
    'Find public biographical facts for this actor/actress/performer. Use reliable public sources in your knowledge/search if available.',
    'Use exactly this shape: {"age":"","birthdate":"","height":"","weight":"","birthName":"","nameTheyUse":"","mostKnownFor":["Title"]}.',
    'Only fill height, weight, and birthName when confident. If not confident, use an empty string.',
    'For mostKnownFor, include the media titles this person is most universally known for, not every credit.',
    `Person: ${name}`,
    details.birthday ? `TMDB birthday: ${details.birthday}` : '',
    details.place_of_birth ? `TMDB birthplace: ${details.place_of_birth}` : '',
    credits ? `TMDB top credits: ${credits}` : ''
  ].filter(Boolean).join('\n');
  const res = await fetchDeepSeekImportMatch({
    systemPrompt: 'Return valid JSON only for public actor/actress bio facts.',
    userPrompt: prompt,
    temperature: 0
  });
  if (!res.ok) throw new Error(`Workers AI person bio request failed: ${res.status}`);
  return normalizeDeepSeekPersonBioFactsResponse(await res.json());
}

function hydrateDiscoverPersonBioFacts(details = {}) {
  fetchDeepSeekPersonBioFacts(details).then(facts => {
    const overlay = document.getElementById('discover-media-profile');
    if (!overlay) return;
    const setFact = (key, value) => {
      const el = overlay.querySelector(`[data-person-bio-fact="${key}"]`);
      if (el && value) el.textContent = value;
      else if (el && el.dataset.keepChecking !== '1') el.textContent = 'Unavailable';
    };
    setFact('height', facts.height);
    setFact('weight', facts.weight);
    setFact('birthName', facts.birthName);
    setFact('nameTheyUse', facts.nameTheyUse || details.name || '');
    if (!details.birthday) setFact('birthdate', facts.birthdate);
    const age = calculateDiscoverPersonAge(details.birthday || facts.birthdate, details.deathday) || facts.age;
    setFact('age', age);
    const mostKnownEl = overlay.querySelector('[data-person-most-known-ai]');
    if (mostKnownEl) mostKnownEl.remove();
  }).catch(error => {
    console.error('Workers AI person bio facts failed:', error);
    const overlay = document.getElementById('discover-media-profile');
    if (!overlay) return;
    ['height', 'weight', 'birthName'].forEach(key => {
      const el = overlay.querySelector(`[data-person-bio-fact="${key}"]`);
      if (el) el.textContent = 'Unavailable';
    });
    const mostKnownEl = overlay.querySelector('[data-person-most-known-ai]');
    if (mostKnownEl) mostKnownEl.remove();
  });
}

function normalizeDeepSeekPersonRoleResponse(json) {
  if (!json) return '';
  if (typeof json === 'string') {
    try { return normalizeDeepSeekPersonRoleResponse(JSON.parse(json)); } catch(e) { return json.trim(); }
  }
  const candidates = [
    json.character,
    json.role,
    json.answer,
    json.result?.character,
    json.result?.role,
    json.result?.answer,
    json.data?.character,
    json.data?.role
  ];
  return String(candidates.find(value => String(value || '').trim()) || '').trim();
}

async function fetchDeepSeekPersonRole(personName, mediaTitle, mediaType = '') {
  const prompt = [
    'Return valid json only.',
    'Find the character or role this actor/actress played in this media title.',
    'Use exactly this shape: {"character":"Character Name"}',
    'If you are not confident, return {"character":""}.',
    `Person: ${personName}`,
    `Media: ${mediaTitle}`,
    mediaType ? `Type: ${mediaType}` : ''
  ].filter(Boolean).join('\n');
  const res = await fetchDeepSeekImportMatch({
    systemPrompt: 'Return valid json only for actor/actress role lookup.',
    userPrompt: prompt,
    temperature: 0
  });
  if (!res.ok) throw new Error(`Workers AI role request failed: ${res.status}`);
  return normalizeDeepSeekPersonRoleResponse(await res.json());
}

async function hydrateDiscoverPersonRoleFallbacks(details = {}) {
  const personName = details.name || '';
  if (!personName) return;
  const overlay = document.getElementById('discover-media-profile');
  if (!overlay) return;
  const missingRoleEls = [...overlay.querySelectorAll('[data-person-role-missing="1"]')].slice(0, 8);
  for (const el of missingRoleEls) {
    const mediaTitle = el.dataset.mediaTitle || '';
    if (!mediaTitle) continue;
    try {
      const role = await fetchDeepSeekPersonRole(personName, mediaTitle, el.dataset.mediaType || '');
      const year = el.dataset.mediaYear || '';
      el.textContent = role ? [`as ${role}`, year].filter(Boolean).join(' · ') : (year ? `Role unavailable · ${year}` : 'Role unavailable');
      el.dataset.personRoleMissing = '0';
    } catch (error) {
      console.error('Workers AI actor role fallback failed:', error);
      const year = el.dataset.mediaYear || '';
      el.textContent = year ? `Role unavailable · ${year}` : 'Role unavailable';
    }
  }
}

function renderDiscoverPersonProfileShell(person = {}) {
  const name = person.name || 'Cast Profile';
  return `<section class="discover-media-page discover-person-page" role="dialog" aria-modal="true" aria-label="${escAttr(name)} details">
    <button class="discover-media-back" type="button" onclick="backToDiscoverTitleProfile()">Back</button>
    <div class="discover-media-body">
      <div class="discover-media-loading">Building this cast profile...</div>
    </div>
  </section>`;
}

function renderDiscoverPersonCreditCard(item = {}) {
  const itemType = getDiscoverSimilarType(item, item.media_type === 'tv' ? 'tv' : 'movie');
  const itemTitle = item.title || item.name || 'Untitled';
  const year = (item.release_date || item.first_air_date || '').slice(0, 4);
  const roleMeta = getDiscoverPersonCreditRoleMeta(item);
  const hasRole = !!getDiscoverPersonCreditRole(item);
  return `<button class="discover-media-similar-card discover-person-credit-card" type="button" onclick="openDiscoverMediaProfile(event, '${itemType}', ${item.id})"><img src="${getTmdbImageUrl(item.poster_path || item.backdrop_path, 'w342')}" alt=""><span class="discover-person-credit-title">${escHtml(itemTitle)}</span><small class="discover-person-credit-role" data-person-role-missing="${hasRole ? '0' : '1'}" data-media-title="${escAttr(itemTitle)}" data-media-type="${escAttr(itemType)}" data-media-year="${escAttr(year)}">${escHtml(roleMeta)}</small></button>`;
}

function renderDiscoverPersonProfileDetails(details = {}) {
  const name = details.name || 'Cast Profile';
  const photo = details.profile_path ? `https://image.tmdb.org/t/p/w780${details.profile_path}` : '';
  const department = details.known_for_department || '';
  const birthday = formatDiscoverMediaDate(details.birthday);
  const age = calculateDiscoverPersonAge(details.birthday, details.deathday);
  const birthplace = details.place_of_birth || '';
  const biography = String(details.biography || 'No biography is available yet.').trim();
  const credits = getDiscoverPersonKnownFor(details);
  const mostKnownFor = getDiscoverPersonMostKnownFor(details);
  const mostKnownIds = new Set(mostKnownFor.map(item => `${item.media_type || ''}:${item.id}`));
  const appearedCredits = credits.filter(item => !mostKnownIds.has(`${item.media_type || ''}:${item.id}`));
  const shownAppearedCredits = appearedCredits.length ? appearedCredits : credits;
  const genderLabel = Number(details.gender) === 1 ? 'Actress Profile' : (Number(details.gender) === 2 ? 'Actor Profile' : 'Performer Profile');

  return `<section class="discover-media-page discover-person-page" role="dialog" aria-modal="true" aria-label="${escAttr(name)} details">
    <button class="discover-media-back" type="button" onclick="backToDiscoverTitleProfile()">Back</button>
    <div class="discover-media-hero discover-person-hero" style="${photo ? `background-image:url('${escAttr(photo)}')` : ''}">
      <div class="discover-media-hero-shade"></div>
      <div class="discover-media-hero-content">
        <div class="discover-media-hero-top">
          <div class="discover-media-poster discover-person-poster">${photo ? `<img src="${escAttr(photo)}" alt="">` : ''}</div>
          <div class="discover-media-hero-main">
            <div class="discover-media-kicker">${escHtml(genderLabel)}</div>
            <h2>${escHtml(name)}</h2>
            ${department ? `<div class="discover-media-tagline">${escHtml(department)}</div>` : ''}
          </div>
        </div>
        <p>${escHtml(biography)}</p>
      </div>
    </div>
    <div class="discover-media-body">
      <div class="discover-media-facts discover-person-bio-facts">
        ${age ? `<div class="primary"><strong data-person-bio-fact="age">${escHtml(age)}</strong><span>Age</span></div>` : `<div class="primary"><strong data-person-bio-fact="age">Checking...</strong><span>Age</span></div>`}
        ${birthday ? `<div><strong data-person-bio-fact="birthdate">${escHtml(birthday)}</strong><span>Birthdate</span></div>` : `<div><strong data-person-bio-fact="birthdate">Checking...</strong><span>Birthdate</span></div>`}
        <div><strong data-person-bio-fact="height">Checking...</strong><span>Height</span></div>
        <div><strong data-person-bio-fact="weight">Checking...</strong><span>Weight</span></div>
        <div><strong data-person-bio-fact="birthName">Checking...</strong><span>Birth Name</span></div>
        <div><strong data-person-bio-fact="nameTheyUse">${escHtml(name)}</strong><span>Name They Use</span></div>
        ${birthplace ? `<div><strong>${escHtml(birthplace)}</strong><span>Birthplace</span></div>` : ''}
        ${department ? `<div><strong>${escHtml(department)}</strong><span>Department</span></div>` : ''}
      </div>
      ${mostKnownFor.length ? `<div class="discover-media-section discover-person-most-known"><h3>Most Known For</h3><div class="discover-media-similar">${mostKnownFor.map(renderDiscoverPersonCreditCard).join('')}</div></div>` : ''}
      ${shownAppearedCredits.length ? `<div class="discover-media-section"><h3>Media They Appeared In</h3><div class="discover-media-similar">${shownAppearedCredits.map(renderDiscoverPersonCreditCard).join('')}</div></div>` : ''}
    </div>
  </section>`;
}

async function openDiscoverPersonProfile(event, personId) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if (!personId) return;
  let overlay = document.getElementById('discover-media-profile');
  const hadOverlay = !!overlay;
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'discover-media-profile';
    overlay.className = 'discover-media-profile-overlay';
    document.body.appendChild(overlay);
    document.body.classList.add('discover-media-profile-open');
    document.addEventListener('keydown', handleDiscoverMediaProfileEsc);
    requestAnimationFrame(() => overlay.classList.add('open'));
  }
  const previousState = hadOverlay && activeDiscoverMediaProfileState ? { ...activeDiscoverMediaProfileState } : null;
  overlay.scrollTop = 0;
  overlay.innerHTML = renderDiscoverPersonProfileShell({});
  try {
    const res = await fetchTmdbProxy(`person/${personId}`, { append_to_response: 'combined_credits,external_ids' });
    if (!res.ok) throw new Error(`TMDB person request failed: ${res.status}`);
    const details = await res.json();
    activeDiscoverMediaProfileState = {
      view: 'person',
      personId: String(personId),
      previous: previousState,
      details
    };
    if (!document.getElementById('discover-media-profile')) return;
    overlay.innerHTML = renderDiscoverPersonProfileDetails(details);
    bindDiscoverMediaProfileSwipeBack(overlay);
    hydrateDiscoverPersonBioFacts(details);
    hydrateDiscoverPersonRoleFallbacks(details);
  } catch (error) {
    console.error('Discover person profile failed:', error);
    if (!document.getElementById('discover-media-profile')) return;
    overlay.innerHTML = `<section class="discover-media-page discover-person-page" role="dialog" aria-modal="true" aria-label="Cast details">
      <button class="discover-media-back" type="button" onclick="backToDiscoverTitleProfile()">Back</button>
      <div class="discover-media-body"><div class="discover-media-loading">Could not load this cast profile. Try again in a moment.</div></div>
    </section>`;
    activeDiscoverMediaProfileState = {
      view: 'person',
      personId: String(personId),
      previous: previousState
    };
  }
}

function backToDiscoverTitleProfile() {
  const overlay = document.getElementById('discover-media-profile');
  const previousState = activeDiscoverMediaProfileState?.previous;
  if (!overlay || !previousState?.details || previousState.type !== 'movie' && previousState.type !== 'tv') {
    closeDiscoverMediaProfile();
    return;
  }
  activeDiscoverMediaProfileState = previousState;
  overlay.scrollTop = 0;
  overlay.innerHTML = renderDiscoverMediaProfileDetails(previousState.type, previousState.details, previousState.id);
  bindDiscoverMediaProfileActions(overlay);
  hydrateDeepSeekMoreLikeThis(previousState.type, previousState.details);
  hydrateDiscoverProviderLogoFallbacks();
}

function renderDiscoverMediaProfileShell(seed, type, id) {
  const title = getDiscoverMediaTitle(seed, type);
  const poster = getDiscoverMediaPoster(seed);
  const backdrop = getDiscoverMediaBackdrop(seed);
  const year = getDiscoverMediaDate(seed, type).slice(0, 4);
  return `<section class="discover-media-page" role="dialog" aria-modal="true" aria-label="${escAttr(title)} details">
    <button class="discover-media-back" type="button" onclick="closeDiscoverMediaProfile('back')">Back</button>
    ${renderMediaProfileTopActions(renderMediaProfileShareButton(getShareableMediaKind(type, seed), id, title, poster), renderDiscoverMediaProfileAddButton(type, id, seed))}
    <div class="discover-media-hero" style="${backdrop ? `background-image:url('${escAttr(backdrop)}')` : ''}">
      <div class="discover-media-hero-shade"></div>
      <div class="discover-media-hero-content">
        <div class="discover-media-poster">${poster ? `<img src="${escAttr(poster)}" alt="">` : ''}</div>
        <div class="discover-media-kicker">${type === 'tv' ? 'Series Profile' : 'Movie Profile'}${year ? ` · ${escHtml(year)}` : ''}</div>
        <h2>${escHtml(title)}</h2>
        <p>${escHtml(seed?.overview || 'Loading the details for this title...')}</p>
      </div>
    </div>
    <div class="discover-media-body">
      <div class="discover-media-loading">Building this title page...</div>
    </div>
  </section>`;
}

function renderDiscoverMediaProfileDetails(type, details, id) {
  const title = getDiscoverMediaTitle(details, type);
  const poster = getDiscoverMediaPoster(details);
  const backdrop = getDiscoverMediaBackdrop(details);
  const year = getDiscoverMediaDate(details, type).slice(0, 4);
  const genres = (details.genres || []).map(g => g.name).filter(Boolean).slice(0, 4);
  const facts = getDiscoverMediaFacts(type, details);
  const score = details.vote_average ? Number(details.vote_average).toFixed(1) : 'N/A';
  const tagline = String(details.tagline || '').trim();
  const overview = details.overview || 'No overview is available yet.';
  const cast = (details.credits?.cast || []).filter(person => person?.name).slice(0, 8);
  const creators = type === 'tv'
    ? (details.created_by || []).map(person => person.name).filter(Boolean).slice(0, 3)
    : getDiscoverMediaCrew(details.credits, ['Director']);
  const writers = type === 'movie' ? getDiscoverMediaCrew(details.credits, ['Writer', 'Screenplay', 'Story']) : [];
  const trailer = getDiscoverMediaTrailer(details.videos);
  const similar = (details.similar?.results || []).filter(item => item?.poster_path).slice(0, 8);
  const companies = (details.production_companies || []).map(company => company.name).filter(Boolean).slice(0, 2);
  const networks = (details.networks || []).map(network => network.name).filter(Boolean).slice(0, 2);

  return `<section class="discover-media-page" role="dialog" aria-modal="true" aria-label="${escAttr(title)} details">
    <button class="discover-media-back" type="button" onclick="closeDiscoverMediaProfile('back')">Back</button>
    ${renderMediaProfileTopActions(renderMediaProfileShareButton(getShareableMediaKind(type, details), id, title, poster), renderDiscoverMediaProfileAddButton(type, id, details))}
    <div class="discover-media-hero" style="${backdrop ? `background-image:url('${escAttr(backdrop)}')` : ''}">
      <div class="discover-media-hero-shade"></div>
      <div class="discover-media-hero-content">
        <div class="discover-media-hero-top">
          <div class="discover-media-poster">${poster ? `<img src="${escAttr(poster)}" alt="">` : ''}</div>
          <div class="discover-media-hero-main">
            <div class="discover-media-kicker">${type === 'tv' ? 'Series Profile' : 'Movie Profile'}${year ? ` · ${escHtml(year)}` : ''}</div>
            <h2>${escHtml(title)}</h2>
            ${tagline ? `<div class="discover-media-tagline">${escHtml(tagline)}</div>` : ''}
            <div class="discover-media-score discover-media-score-hero"><span class="discover-media-score-star" aria-hidden="true">★</span><span class="discover-media-score-value">${escHtml(score)}</span></div>
          </div>
        </div>
        <p>${escHtml(overview)}</p>
        ${genres.length ? `<div class="discover-media-chips">${genres.map(name => `<span>${escHtml(name)}</span>`).join('')}</div>` : ''}
        ${renderMediaProfileFloatingExports(type, details)}
        ${renderDiscoverWhereToWatchInline(details)}
      </div>
    </div>
    <div class="discover-media-body">
      ${facts.length ? `<div class="discover-media-facts">${facts.map(fact => `<div class="${fact.priority ? 'primary' : ''}"><strong>${escHtml(fact.value)}</strong><span>${escHtml(fact.label)}</span></div>`).join('')}</div>` : ''}
      ${(creators.length || writers.length || companies.length || networks.length) ? `<div class="discover-media-credits">
        ${creators.length ? `<div><span>${type === 'tv' ? 'Created By' : 'Directed By'}</span><strong>${escHtml(creators.join(', '))}</strong></div>` : ''}
        ${writers.length ? `<div><span>Written By</span><strong>${escHtml(writers.join(', '))}</strong></div>` : ''}
        ${companies.length || networks.length ? `<div><span>${type === 'tv' ? 'Network' : 'Studio'}</span><strong>${escHtml((networks.length ? networks : companies).join(', '))}</strong></div>` : ''}
      </div>` : ''}
      ${trailer ? `<div class="discover-media-trailer"><iframe src="https://www.youtube.com/embed/${escAttr(trailer.key)}?controls=1&playsinline=1&rel=0&modestbranding=1" allow="encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>` : ''}
      ${cast.length ? `<div class="discover-media-section"><h3>Cast</h3><div class="discover-media-cast">${cast.map(person => `<button class="discover-media-cast-card" type="button" onclick="openDiscoverPersonProfile(event, ${person.id})"><div class="discover-media-cast-photo">${person.profile_path ? `<img src="https://image.tmdb.org/t/p/w342${escAttr(person.profile_path)}" alt="">` : ''}</div><strong>${escHtml(person.name)}</strong><span>${escHtml(person.character || '')}</span></button>`).join('')}</div></div>` : ''}
      ${renderDeepSeekMoreLikeThisSection(type, details)}
    </div>
  </section>`;
}

async function openDiscoverMediaProfile(event, type, id, transitionOrigin = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if ((type !== 'movie' && type !== 'tv') || !id) return;
  const key = getDiscoverMediaProfileKey(type, id);
  const seed = discoverMediaProfileSeeds.get(key) || {};
  closeDiscoverMediaProfile();
  const overlay = document.createElement('div');
  overlay.id = 'discover-media-profile';
  overlay.className = 'discover-media-profile-overlay';
  if (isActivityMediaProfileOrigin(transitionOrigin)) overlay.classList.add('activity-origin-media-profile');
  overlay.innerHTML = renderDiscoverMediaProfileShell(seed, type, id);
  bindDiscoverMediaProfileActions(overlay);
  document.body.appendChild(overlay);
  document.body.classList.add('discover-media-profile-open');
  document.addEventListener('keydown', handleDiscoverMediaProfileEsc);
  revealMediaProfileOverlay(overlay, transitionOrigin, event);
  try {
    let details = discoverMediaProfileCache.get(key);
    if (!details) {
      const res = await fetchTmdbProxy(`${type}/${id}`, {
        append_to_response: 'credits,videos,similar,external_ids,keywords'
      });
      if (!res.ok) throw new Error(`TMDB detail request failed: ${res.status}`);
      details = await res.json();
      discoverMediaProfileCache.set(key, details);
    }
    const watchProviderDisplay = details.watchProviderDisplay || await fetchDiscoverWatchProviderDisplay(type, id, { ...seed, ...details });
    if (watchProviderDisplay) {
      details.watchProviderDisplay = watchProviderDisplay;
      discoverMediaProfileCache.set(key, details);
    }
    if (!document.getElementById('discover-media-profile')) return;
    const mergedDetails = { ...seed, ...details, watchProviderDisplay };
    if (type === 'tv' && (activeDiscoveryHub === 'anime' || detectAnimeFromMetadata({
      genreNames: (mergedDetails.genres || []).map(g => g.name).filter(Boolean),
      originalTitle: mergedDetails.original_name || '',
      originalLanguage: mergedDetails.original_language || '',
      originCountries: Array.isArray(mergedDetails.origin_country) ? mergedDetails.origin_country : []
    }))) {
      mergedDetails.mediaCategory = 'anime';
      mergedDetails.librarySection = 'anime';
      mergedDetails.isAnime = true;
      if (!mergedDetails.titleVariants?.romaji || !mergedDetails.titleVariants?.japanese) {
        await hydrateAnimeTitleVariants(mergedDetails);
      }
    }
    repairLibraryItemCoverFromProfile(seed, mergedDetails);
    activeDiscoverMediaProfileState = {
      view: 'title',
      type,
      id,
      details: mergedDetails
    };
    overlay.innerHTML = renderDiscoverMediaProfileDetails(type, mergedDetails, id);
    bindDiscoverMediaProfileActions(overlay);
    hydrateDeepSeekMoreLikeThis(type, mergedDetails);
    hydrateDiscoverProviderLogoFallbacks();
  } catch (e) {
    console.error('Discover media profile failed:', e);
    const body = overlay.querySelector('.discover-media-body');
    if (body) body.innerHTML = '<div class="discover-media-loading">Could not load this title page. Try again in a moment.</div>';
  }
}

async function loadGamesDiscoverSection(kind, gridId, force = false) {
  try {
    await renderDiscoverCachedRow({
      cacheKey: `games:${kind}:${DISCOVER_RANKING_CACHE_VERSION}`,
      fetcher: () => fetchGamesDiscoverTitles(kind),
      render: items => renderGamesDiscoverCards(items, gridId),
      force
    });
  } catch(e) {
    console.error(`Games Discovery ${kind} load failed:`, e);
    renderGamesDiscoverSectionError(gridId);
  }
}

async function loadGamesDiscover(force = false) {
  if (gamesDiscoverLoading || (gamesDiscoverLoaded && !force && isDiscoverMemoryFresh(gamesDiscoverLoadedAt))) return;
  gamesDiscoverLoading = true;
  renderGamesDiscoverLoading();
  try {
    const sections = [
      ['new-releases', 'discover-games-new-releases-grid'],
      ['years-best', 'discover-games-years-best-grid'],
      ['popular', 'discover-games-popular-grid'],
      ['rated', 'discover-games-rated-grid'],
      ['trending', 'discover-games-trending-grid'],
      ['anticipated', 'discover-games-anticipated-grid'],
      ['story', 'discover-games-story-grid'],
      ['multiplayer', 'discover-games-multiplayer-grid'],
      ['hidden', 'discover-games-hidden-grid']
    ];
    await Promise.all(sections.map(([kind, gridId]) => loadGamesDiscoverSection(kind, gridId, force)));
    gamesDiscoverLoaded = true;
    gamesDiscoverLoadedAt = Date.now();
  } catch(e) {
    console.error("Games Discovery load failed:", e);
    renderGamesDiscoverError("Games Discovery could not load. It will try again automatically later.");
  } finally {
    gamesDiscoverLoading = false;
  }
}

const DISCOVER_FULL_CATEGORY_GRID_IDS = [
  'discover-tv-new-releases-grid',
  'discover-tv-years-best-grid',
  'discover-tv-popular-grid',
  'discover-tv-top-rated-grid',
  'discover-tv-trending-grid',
  'discover-tv-anticipated-grid',
  'discover-tv-releasing-soon-grid',
  'discover-tv-hidden-gems-grid',
  'discover-movie-new-releases-grid',
  'discover-movie-in-theaters-grid',
  'discover-movie-years-best-grid',
  'discover-movie-popular-grid',
  'discover-movie-top-rated-grid',
  'discover-movie-trending-grid',
  'discover-movie-anticipated-grid',
  'discover-movie-releasing-soon-grid',
  'discover-movie-hidden-gems-grid',
  'anime-discover-new-grid',
  'anime-discover-years-best-grid',
  'anime-discover-popular-grid',
  'anime-discover-rated-grid',
  'anime-discover-trending-grid',
  'anime-discover-anticipated-grid',
  'discover-games-new-releases-grid',
  'discover-games-years-best-grid',
  'discover-games-popular-grid',
  'discover-games-rated-grid',
  'discover-games-trending-grid',
  'discover-games-anticipated-grid',
  'discover-games-story-grid',
  'discover-games-multiplayer-grid',
  'discover-games-hidden-grid'
];

const discoverCategoryDataStore = {};
let discoverCategoryFullState = null;
let discoverCategoryFullHistoryActive = false;


const DISCOVER_CATEGORY_FILTER_LIMIT = 21;
const DISCOVER_CATEGORY_FILTER_PAGE_COUNT = 3;
const DISCOVER_CATEGORY_FILTER_VERSION = 'v291-filter-scroll-preserve';

// ShelfLine Filter UI: Shelfd's clean Letterboxd-inspired list-panel system.
// Reuse this pattern when a feature needs flat text rows, semi-soft dividers,
// checkmarks for selected rows, and right-to-left drill-down panels without heavy gradients/pills.
const SHELFLINE_FILTER_UI_PATTERN = {
  name: 'ShelfLine Filter UI',
  intent: 'Clean Letterboxd-style filtering/search surfaces for Shelfd.',
  traits: [
    'flat dark/light surface',
    'text-first rows',
    'semi-soft divider lines',
    'minimal checkmarks',
    'right-to-left panel drilldown',
    'no heavy bubbles, capsules, or decorative gradients'
  ]
};
window.SHELFD_UI_PATTERNS = window.SHELFD_UI_PATTERNS || {};
window.SHELFD_UI_PATTERNS.SHELF_LINE_FILTER_UI = SHELFLINE_FILTER_UI_PATTERN;

let discoverCategoryFilterPanelKey = 'main';
let discoverCategoryFilterScrollMemory = {};

const DISCOVER_CATEGORY_DECADE_FILTERS = Array.from({ length: 16 }, (_, index) => {
  const start = 2020 - (index * 10);
  return { key: `decade:${start}`, label: `${start}s`, start, end: start + 9 };
});
const DISCOVER_CATEGORY_YEAR_FILTERS = DISCOVER_CATEGORY_DECADE_FILTERS.flatMap(decade =>
  Array.from({ length: 10 }, (_, offset) => {
    const year = decade.start + offset;
    return { key: String(year), label: String(year), year, decadeStart: decade.start };
  })
);
function isDiscoverCategoryYearDisabled(year) {
  const currentYear = new Date().getFullYear();
  return Number(year || 0) > currentYear;
}

const DISCOVER_CATEGORY_GENRE_FILTERS = [
  { key: 'genre:28', label: 'Action', id: 28 },
  { key: 'genre:12', label: 'Adventure', id: 12 },
  { key: 'genre:16', label: 'Animation', id: 16 },
  { key: 'genre:35', label: 'Comedy', id: 35 },
  { key: 'genre:80', label: 'Crime', id: 80 },
  { key: 'genre:99', label: 'Documentary', id: 99 },
  { key: 'genre:18', label: 'Drama', id: 18 },
  { key: 'genre:10751', label: 'Family', id: 10751 },
  { key: 'genre:14', label: 'Fantasy', id: 14 },
  { key: 'genre:36', label: 'History', id: 36 },
  { key: 'genre:27', label: 'Horror', id: 27 },
  { key: 'genre:10402', label: 'Music', id: 10402 },
  { key: 'type:movie', label: 'Movie', contentType: 'movie' },
  { key: 'genre:9648', label: 'Mystery', id: 9648 },
  { key: 'genre:10749', label: 'Romance', id: 10749 },
  { key: 'genre:878', label: 'Science Fiction', id: 878 },
  { key: 'type:tv', label: 'TV', contentType: 'tv' },
  { key: 'genre:53', label: 'Thriller', id: 53 },
  { key: 'genre:10752', label: 'War', id: 10752 },
  { key: 'genre:37', label: 'Western', id: 37 }
];

const DISCOVER_CATEGORY_COUNTRY_FILTERS = [
  { key: 'AU', label: 'Australia' },
  { key: 'BR', label: 'Brazil' },
  { key: 'CA', label: 'Canada' },
  { key: 'CN', label: 'China' },
  { key: 'FR', label: 'France' },
  { key: 'DE', label: 'Germany' },
  { key: 'HK', label: 'Hong Kong' },
  { key: 'IN', label: 'India' },
  { key: 'IE', label: 'Ireland' },
  { key: 'IT', label: 'Italy' },
  { key: 'JP', label: 'Japan' },
  { key: 'MX', label: 'Mexico' },
  { key: 'NG', label: 'Nigeria' },
  { key: 'RU', label: 'Russia' },
  { key: 'KR', label: 'South Korea' },
  { key: 'ES', label: 'Spain' },
  { key: 'SE', label: 'Sweden' },
  { key: 'TH', label: 'Thailand' },
  { key: 'TR', label: 'Turkey' },
  { key: 'GB', label: 'United Kingdom' },
  { key: 'US', label: 'United States' }
];

const DISCOVER_CATEGORY_LANGUAGE_FILTERS = [
  { key: 'ar', label: 'Arabic' },
  { key: 'cn', label: 'Cantonese' },
  { key: 'zh', label: 'Chinese' },
  { key: 'en', label: 'English' },
  { key: 'fr', label: 'French' },
  { key: 'de', label: 'German' },
  { key: 'hi', label: 'Hindi' },
  { key: 'id', label: 'Indonesian' },
  { key: 'it', label: 'Italian' },
  { key: 'ja', label: 'Japanese' },
  { key: 'ko', label: 'Korean' },
  { key: 'ms', label: 'Malay' },
  { key: 'pt', label: 'Portuguese' },
  { key: 'ru', label: 'Russian' },
  { key: 'es', label: 'Spanish' },
  { key: 'sv', label: 'Swedish' },
  { key: 'tl', label: 'Tagalog' },
  { key: 'ta', label: 'Tamil' },
  { key: 'te', label: 'Telugu' },
  { key: 'th', label: 'Thai' },
  { key: 'tr', label: 'Turkish' }
];

const DISCOVER_CATEGORY_SERVICE_FILTERS = [
  { key: '350', label: 'Apple TV', providerId: 350, icon: '' },
  { key: '337', label: 'Disney Plus', providerId: 337, icon: 'D+' },
  { key: '1899', label: 'HBO Max', providerId: 1899, icon: 'MAX' },
  { key: '15', label: 'Hulu', providerId: 15, icon: 'HU' },
  { key: '8', label: 'Netflix', providerId: 8, icon: 'N' },
  { key: '531', label: 'Paramount Plus', providerId: 531, icon: 'P+' },
  { key: '386', label: 'Peacock', providerId: 386, icon: 'PC' },
  { key: '300', label: 'Pluto TV', providerId: 300, icon: 'PL' },
  { key: '9', label: 'Prime Video', providerId: 9, icon: 'PV' },
  { key: '43', label: 'Starz', providerId: 43, icon: 'SZ' }
];

const DISCOVER_CATEGORY_FILTER_GROUPS = {
  year: { label: 'Year', pluralLabel: 'Years', items: DISCOVER_CATEGORY_DECADE_FILTERS },
  genre: { label: 'Genre', pluralLabel: 'Genres', items: DISCOVER_CATEGORY_GENRE_FILTERS },
  country: { label: 'Country', pluralLabel: 'Countries', items: DISCOVER_CATEGORY_COUNTRY_FILTERS },
  language: { label: 'Language', pluralLabel: 'Languages', items: DISCOVER_CATEGORY_LANGUAGE_FILTERS },
  service: { label: 'Service', pluralLabel: 'Services', items: DISCOVER_CATEGORY_SERVICE_FILTERS }
};

function getDiscoverCategoryMediaScope(gridId = '') {
  if (gridId === 'discover-universal-search-grid') return 'mixed';
  if (gridId.startsWith('discover-movie-')) return 'movie';
  if (gridId.startsWith('discover-tv-')) return 'tv';
  if (gridId.startsWith('anime-discover-')) return 'anime';
  return '';
}

function isDiscoverCategoryMediaFilterable(gridId = '') {
  return !!getDiscoverCategoryMediaScope(gridId);
}

function getEmptyDiscoverCategoryFilters() {
  return { year: [], genre: [], country: [], language: [], service: [] };
}

function getDiscoverCategoryFilters() {
  if (!discoverCategoryFullState) return getEmptyDiscoverCategoryFilters();
  if (!discoverCategoryFullState.filters) discoverCategoryFullState.filters = getEmptyDiscoverCategoryFilters();
  Object.keys(DISCOVER_CATEGORY_FILTER_GROUPS).forEach(key => {
    if (!Array.isArray(discoverCategoryFullState.filters[key])) discoverCategoryFullState.filters[key] = [];
  });
  return discoverCategoryFullState.filters;
}

function hasDiscoverCategoryMediaFilters() {
  const filters = getDiscoverCategoryFilters();
  return Object.keys(DISCOVER_CATEGORY_FILTER_GROUPS).some(key => filters[key]?.length);
}

function getDiscoverCategoryFilterCount() {
  const filters = getDiscoverCategoryFilters();
  return Object.keys(DISCOVER_CATEGORY_FILTER_GROUPS).reduce((sum, key) => sum + (filters[key]?.length || 0), 0);
}

function findDiscoverCategoryFilterItem(groupKey = '', value = '') {
  if (groupKey === 'year') {
    return DISCOVER_CATEGORY_YEAR_FILTERS.find(item => String(item.key) === String(value))
      || DISCOVER_CATEGORY_DECADE_FILTERS.find(item => String(item.key) === String(value));
  }
  return (DISCOVER_CATEGORY_FILTER_GROUPS[groupKey]?.items || []).find(item => String(item.key) === String(value));
}

function getDiscoverCategoryFilterSummary(groupKey = '') {
  const filters = getDiscoverCategoryFilters();
  const values = filters[groupKey] || [];
  if (!values.length) return '';
  const labels = values.map(value => findDiscoverCategoryFilterItem(groupKey, value)?.label || value).filter(Boolean);
  if (labels.length <= 2) return labels.join(', ');
  return `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`;
}

function renderDiscoverCategoryFilterCheck(isSelected = false) {
  return `<strong class="discover-category-filter-check" aria-hidden="true">${isSelected ? '✓' : ''}</strong>`;
}

function renderDiscoverCategoryMainFilterPanel() {
  const activeCount = getDiscoverCategoryFilterCount();
  const groupKeys = ['year', 'genre', 'country', 'language', 'service'];
  const rows = groupKeys.map(key => {
    const group = DISCOVER_CATEGORY_FILTER_GROUPS[key];
    const count = getDiscoverCategoryFilters()[key]?.length || 0;
    const summary = getDiscoverCategoryFilterSummary(key);
    return `<button class="discover-category-filter-row discover-category-filter-root-row${count ? ' selected' : ''}" type="button" onclick="openDiscoverCategoryFilterPanel('${escAttr(key)}')">
      <span>${escHtml(group.label)}</span>
      <strong>${summary ? escHtml(summary) : ''}</strong>
      <em>›</em>
    </button>`;
  }).join('');
  return `<div class="discover-category-filter-panel discover-category-filter-panel-main" data-filter-panel="main">
    <div class="discover-category-filter-header discover-category-filter-header-flat">
      <div><div class="discover-category-filter-kicker">${discoverCategoryFullState?.mode === 'universal-search' ? 'Search' : 'View All'}</div><h3>Filter</h3></div>
      <button class="discover-category-filter-done" type="button" onclick="closeDiscoverCategoryFilterSheet()">Done</button>
    </div>
    <div class="discover-category-filter-rule"></div>
    <div class="discover-category-filter-list">${rows}</div>
    ${activeCount ? `<button class="discover-category-filter-clear-inline" type="button" onclick="clearDiscoverCategoryFilters()">Clear ${activeCount} filter${activeCount === 1 ? '' : 's'}</button>` : ''}
  </div>`;
}

function renderDiscoverCategoryOptionFilterPanel(groupKey = '') {
  const group = DISCOVER_CATEGORY_FILTER_GROUPS[groupKey] || DISCOVER_CATEGORY_FILTER_GROUPS.year;
  const selected = new Set(getDiscoverCategoryFilters()[groupKey] || []);
  let rows = '';
  if (groupKey === 'year') {
    rows = DISCOVER_CATEGORY_DECADE_FILTERS.map(item => {
      const selectedYears = DISCOVER_CATEGORY_YEAR_FILTERS
        .filter(yearItem => yearItem.decadeStart === item.start && selected.has(String(yearItem.key)));
      const summary = selectedYears.length ? `${selectedYears.length} selected` : '';
      return `<button class="discover-category-filter-row discover-category-filter-root-row discover-category-filter-decade-row${selectedYears.length ? ' selected' : ''}" type="button" onclick="openDiscoverCategoryFilterPanel('year-decade:${escAttr(String(item.start))}')">
        <span>${escHtml(item.label)}</span>
        <strong>${escHtml(summary)}</strong>
        <em>›</em>
      </button>`;
    }).join('');
  } else {
    rows = (group.items || []).map(item => {
      const isSelected = selected.has(String(item.key));
      const iconHtml = groupKey === 'service'
        ? `<span class="discover-category-filter-service-icon">${escHtml(item.icon || item.label.slice(0, 2))}</span>`
        : '';
      return `<button class="discover-category-filter-row discover-category-filter-option${isSelected ? ' selected' : ''}" type="button" onclick="toggleDiscoverCategoryFilterOption('${escAttr(groupKey)}','${escAttr(String(item.key))}')">
        <span>${iconHtml}${escHtml(item.label)}</span>
        ${renderDiscoverCategoryFilterCheck(isSelected)}
      </button>`;
    }).join('');
  }
  return `<div class="discover-category-filter-panel discover-category-filter-panel-sub" data-filter-panel="${escAttr(groupKey)}">
    <div class="discover-category-filter-panel-top discover-category-filter-header-flat">
      <button class="discover-category-filter-back" type="button" onclick="openDiscoverCategoryFilterPanel('main', 'back')" aria-label="Back">←</button>
      <h3>${escHtml(group.pluralLabel || group.label)}</h3>
      <button class="discover-category-filter-done" type="button" onclick="closeDiscoverCategoryFilterSheet()">Done</button>
    </div>
    <div class="discover-category-filter-rule"></div>
    <div class="discover-category-filter-list">${rows || '<div class="discover-category-filter-empty">No filters available.</div>'}</div>
  </div>`;
}

function renderDiscoverCategoryYearFilterPanel(decadeStart = 2020) {
  const start = Number(decadeStart || 2020);
  const decade = DISCOVER_CATEGORY_DECADE_FILTERS.find(item => Number(item.start) === start) || DISCOVER_CATEGORY_DECADE_FILTERS[0];
  const selected = new Set(getDiscoverCategoryFilters().year || []);
  const years = DISCOVER_CATEGORY_YEAR_FILTERS.filter(item => item.decadeStart === decade.start);
  const availableYears = years.filter(item => !isDiscoverCategoryYearDisabled(item.year));
  const allAvailableSelected = availableYears.length > 0 && availableYears.every(item => selected.has(String(item.key)));
  const rows = years.map(item => {
    const disabled = isDiscoverCategoryYearDisabled(item.year);
    const isSelected = selected.has(String(item.key));
    const click = disabled ? '' : ` onclick="toggleDiscoverCategoryFilterOption('year','${escAttr(String(item.key))}')"`;
    return `<button class="discover-category-filter-row discover-category-filter-option discover-category-filter-year-row${isSelected ? ' selected' : ''}${disabled ? ' disabled' : ''}" type="button"${disabled ? ' disabled aria-disabled="true"' : ''}${click}>
      <span>${escHtml(item.label)}</span>
      ${disabled ? '<strong>Unavailable</strong>' : renderDiscoverCategoryFilterCheck(isSelected)}
    </button>`;
  }).join('');
  return `<div class="discover-category-filter-panel discover-category-filter-panel-sub" data-filter-panel="year-decade:${escAttr(String(decade.start))}">
    <div class="discover-category-filter-panel-top discover-category-filter-header-flat">
      <button class="discover-category-filter-back" type="button" onclick="openDiscoverCategoryFilterPanel('year', 'back')" aria-label="Back">←</button>
      <h3>${escHtml(decade.label)}</h3>
      <button class="discover-category-filter-done" type="button" onclick="closeDiscoverCategoryFilterSheet()">Done</button>
    </div>
    <div class="discover-category-filter-rule"></div>
    <button class="discover-category-filter-select-all${allAvailableSelected ? ' selected' : ''}" type="button" onclick="selectAllDiscoverCategoryDecadeYears('${escAttr(String(decade.start))}')">Select All</button>
    <div class="discover-category-filter-list">${rows}</div>
  </div>`;
}

function renderDiscoverCategorySimpleFilterSheet() {
  if (!discoverCategoryFullState) return '';
  const gridId = discoverCategoryFullState.gridId || '';
  const sortOptions = getDiscoverFullPageSortOptions(gridId);
  const currentSort = discoverCategoryFullState.sortKey || getDiscoverFullPageDefaultSort(gridId);
  const sortHtml = sortOptions.map(option => `<button class="discover-category-filter-row discover-category-filter-option${option.key === currentSort ? ' selected' : ''}" type="button" onclick="setDiscoverFullCategorySortFromSheet('${escAttr(option.key)}')"><span>${escHtml(option.label)}</span>${renderDiscoverCategoryFilterCheck(option.key === currentSort)}</button>`).join('');
  return `<div class="discover-category-filter-panel" data-filter-panel="simple">
    <div class="discover-category-filter-header discover-category-filter-header-flat">
      <div><div class="discover-category-filter-kicker">${discoverCategoryFullState?.mode === 'universal-search' ? 'Search' : 'View All'}</div><h3>Sort</h3></div>
      <button class="discover-category-filter-done" type="button" onclick="closeDiscoverCategoryFilterSheet()">Done</button>
    </div>
    <div class="discover-category-filter-rule"></div>
    <div class="discover-category-filter-list">${sortHtml}</div>
  </div>`;
}

function storeDiscoverCategoryData(gridId, type, items, renderer) {
  if (!gridId || !DISCOVER_FULL_CATEGORY_GRID_IDS.includes(gridId)) return;
  discoverCategoryDataStore[gridId] = {
    gridId,
    type,
    renderer,
    items: Array.isArray(items) ? items.slice() : [],
    savedAt: Date.now()
  };
}

function getDiscoverCategoryTitleText(gridId = '') {
  const grid = document.getElementById(gridId);
  const section = grid?.closest?.('.discover-section');
  const title = section?.querySelector?.('.discover-section-title');
  return (title?.textContent || '').replace(/View all$/i, '').trim() || 'Discover';
}

function getDiscoverFullPageSortOptions(gridId = '') {
  return [
    { key: 'default', label: 'Default' },
    { key: 'newest', label: 'Newest Release' },
    { key: 'popular', label: 'Popular' },
    { key: 'rated', label: 'Highest Rated' },
    { key: 'reviewed', label: 'Most Reviewed' },
    { key: 'az', label: 'A-Z' }
  ];
}

function getDiscoverFullPageDefaultSort(gridId = '') {
  return 'default';
}

function getDiscoverFullItemDate(item = {}) {
  const value = getDiscoverReleaseDate(item) || item.released || '';
  const time = Date.parse(`${value}T00:00:00`);
  return Number.isFinite(time) ? time : 0;
}

function getDiscoverFullItemPopularity(item = {}) {
  return Number(item.popularity || item.added || item.ratings_count || item.reviews_count || item.traktActivity || 0);
}

function normalizeDiscoverSortNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeDiscoverRatingForSort(value, scaleHint = '') {
  const num = normalizeDiscoverSortNumber(value, 0);
  if (num <= 0) return 0;
  if (scaleHint === 'metacritic') return Math.min(10, num / 10);
  if (num <= 5) return num * 2;
  if (num <= 10) return num;
  if (num <= 100) return num / 10;
  return 0;
}

function getDiscoverFullItemRating(item = {}) {
  if (item.vote_average !== undefined && item.vote_average !== null && item.vote_average !== '') {
    return normalizeDiscoverRatingForSort(item.vote_average, 'ten');
  }
  if (item.rating !== undefined && item.rating !== null && item.rating !== '') {
    return normalizeDiscoverRatingForSort(item.rating, 'rating');
  }
  if (item.score !== undefined && item.score !== null && item.score !== '') {
    return normalizeDiscoverRatingForSort(item.score, 'score');
  }
  if (item.metacritic !== undefined && item.metacritic !== null && item.metacritic !== '') {
    return normalizeDiscoverRatingForSort(item.metacritic, 'metacritic');
  }
  return 0;
}

function getDiscoverFullItemVoteCount(item = {}) {
  return Math.max(0,
    normalizeDiscoverSortNumber(item.vote_count, 0),
    normalizeDiscoverSortNumber(item.ratings_count, 0),
    normalizeDiscoverSortNumber(item.reviews_count, 0),
    normalizeDiscoverSortNumber(item.review_count, 0),
    normalizeDiscoverSortNumber(item.rating_count, 0),
    normalizeDiscoverSortNumber(item.metacritic_count, 0)
  );
}

function getDiscoverHighestRatedMinimumVotes(item = {}, gridId = '') {
  const id = String(gridId || discoverCategoryFullState?.gridId || '');
  const type = String(item.media_type || item.mediaType || item.type || '').toLowerCase();
  if (id.startsWith('discover-movie-') || type === 'movie') return 100;
  if (id.startsWith('discover-tv-') || type === 'tv' || type === 'show') return 75;
  if (id.startsWith('anime-discover-') || type === 'anime') return 50;
  if (id.startsWith('discover-games-') || type === 'game' || type === 'games') return 50;
  return 75;
}

function getDiscoverHighestRatedAverageRating(items = []) {
  const ratings = (Array.isArray(items) ? items : [])
    .map(item => getDiscoverFullItemRating(item))
    .filter(rating => Number.isFinite(rating) && rating > 0);
  if (!ratings.length) return 0;
  return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
}

function getDiscoverHighestRatedWeightedScore(item = {}, items = [], gridId = '') {
  const rating = getDiscoverFullItemRating(item);
  if (!Number.isFinite(rating) || rating <= 0) return 0;
  const votes = getDiscoverFullItemVoteCount(item);
  const m = getDiscoverHighestRatedMinimumVotes(item, gridId);
  const c = getDiscoverHighestRatedAverageRating(items);
  return (votes / (votes + m)) * rating + (m / (votes + m)) * c;
}

function sortDiscoverFullPageItems(items = [], sortKey = 'default', gridId = '') {
  const copy = Array.isArray(items) ? items.slice() : [];
  if (sortKey === 'default') return copy;
  return copy.sort((a, b) => {
    if (sortKey === 'newest') {
      const dateCompare = getDiscoverFullItemDate(b) - getDiscoverFullItemDate(a);
      if (dateCompare) return dateCompare;
      const popularCompare = getDiscoverFullItemPopularity(b) - getDiscoverFullItemPopularity(a);
      if (popularCompare) return popularCompare;
      return compareDiscoverTitleAsc(a, b);
    }
    if (sortKey === 'rated') {
      const ratingScoreA = getDiscoverHighestRatedWeightedScore(a, copy, gridId);
      const ratingScoreB = getDiscoverHighestRatedWeightedScore(b, copy, gridId);
      const ratingScoreCompare = ratingScoreB - ratingScoreA;
      if (ratingScoreCompare) return ratingScoreCompare;
      const voteCompare = getDiscoverFullItemVoteCount(b) - getDiscoverFullItemVoteCount(a);
      if (voteCompare) return voteCompare;
      const ratingCompare = getDiscoverFullItemRating(b) - getDiscoverFullItemRating(a);
      if (ratingCompare) return ratingCompare;
      return compareDiscoverTitleAsc(a, b);
    }
    if (sortKey === 'reviewed') {
      const voteCompare = getDiscoverFullItemVoteCount(b) - getDiscoverFullItemVoteCount(a);
      if (voteCompare) return voteCompare;
      const ratingCompare = getDiscoverFullItemRating(b) - getDiscoverFullItemRating(a);
      if (ratingCompare) return ratingCompare;
      return compareDiscoverTitleAsc(a, b);
    }
    if (sortKey === 'az') return compareDiscoverTitleAsc(a, b);
    const popularCompare = getDiscoverFullItemPopularity(b) - getDiscoverFullItemPopularity(a);
    if (popularCompare) return popularCompare;
    return compareDiscoverTitleAsc(a, b);
  });
}

function getOrCreateDiscoverCategoryFullPage() {
  let page = document.getElementById('discover-category-full-page');
  if (page) return page;
  page = document.createElement('div');
  page.id = 'discover-category-full-page';
  page.className = 'discover-category-full-page';
  page.style.display = 'none';
  page.innerHTML = `
    <div class="discover-category-full-shell">
      <div class="discover-category-full-topbar">
        <button class="discover-category-full-back" type="button" onclick="closeDiscoverCategoryFullPage()" aria-label="Back">←</button>
        <button class="discover-category-filter-btn" id="discover-category-filter-btn" type="button" onclick="openDiscoverCategoryFilterSheet()" aria-label="Sort and filter this category" title="Sort and filter">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="M7 12h10"></path><path d="M10 17h4"></path></svg>
        </button>
      </div>
      <div class="discover-category-full-head">
        <div class="discover-title" id="discover-category-full-title">Discover</div>
        <div class="discover-subtitle" id="discover-category-full-subtitle">Full category view</div>
      </div>
      <div class="discover-category-sort-row" id="discover-category-sort-row" aria-label="Sort category"></div>
      <div class="discover-category-sort-row discover-category-release-row" id="discover-category-release-row" aria-label="Release range"></div>
      <div class="discover-category-sort-row discover-category-country-row" id="discover-category-country-row" aria-label="Country new releases"></div>
      <div class="discover-grid discover-category-full-grid" id="discover-category-full-grid"><div class="discover-message">Loading...</div></div>
    </div>`;
  document.body.appendChild(page);
  return page;
}

function getDiscoverCategoryActiveFilterText() {
  if (!discoverCategoryFullState) return '';
  if (isDiscoverCategoryMediaFilterable(discoverCategoryFullState.gridId)) {
    const count = getDiscoverCategoryFilterCount();
    return count ? `${count} active filter${count === 1 ? '' : 's'}` : '';
  }
  const sortOptions = getDiscoverFullPageSortOptions(discoverCategoryFullState.gridId);
  const defaultSort = getDiscoverFullPageDefaultSort(discoverCategoryFullState.gridId);
  const sortKey = discoverCategoryFullState.sortKey || defaultSort;
  const sortLabel = sortOptions.find(option => option.key === sortKey)?.label || 'Default';
  return sortKey !== defaultSort ? sortLabel : '';
}

function updateDiscoverCategoryFilterButtonState() {
  const btn = document.getElementById('discover-category-filter-btn');
  if (!btn) return;
  const activeText = getDiscoverCategoryActiveFilterText();
  btn.classList.toggle('has-active-filter', !!activeText);
  btn.setAttribute('aria-label', activeText ? `Filter this category. Active: ${activeText}` : 'Filter this category');
}

function renderDiscoverCategoryFilterSheet() {
  if (!discoverCategoryFullState) return '';
  if (!isDiscoverCategoryMediaFilterable(discoverCategoryFullState.gridId)) return renderDiscoverCategorySimpleFilterSheet();
  if (discoverCategoryFilterPanelKey === 'main') return renderDiscoverCategoryMainFilterPanel();
  if (String(discoverCategoryFilterPanelKey).startsWith('year-decade:')) {
    return renderDiscoverCategoryYearFilterPanel(String(discoverCategoryFilterPanelKey).split(':')[1]);
  }
  return renderDiscoverCategoryOptionFilterPanel(discoverCategoryFilterPanelKey);
}

function openDiscoverCategoryFilterSheet() {
  if (!discoverCategoryFullState) return;
  closeDiscoverCategoryFilterSheet({ immediate: true });
  discoverCategoryFilterPanelKey = 'main';
  discoverCategoryFilterScrollMemory = {};
  const sheet = document.createElement('div');
  sheet.id = 'discover-category-filter-sheet';
  sheet.className = 'discover-category-filter-sheet discover-category-filter-sheet-letterboxd';
  sheet.style.display = 'block';
  sheet.innerHTML = `<button class="discover-category-filter-scrim" type="button" onclick="closeDiscoverCategoryFilterSheet()" aria-label="Close filter"></button><div class="discover-category-filter-drawer"><div class="discover-category-filter-track">${renderDiscoverCategoryFilterSheet()}</div></div>`;
  document.body.appendChild(sheet);
  document.body.classList.add('discover-category-filter-open');
  requestAnimationFrame(() => sheet.classList.add('open'));
}

function closeDiscoverCategoryFilterSheet(options = {}) {
  const sheet = document.getElementById('discover-category-filter-sheet');
  document.body.classList.remove('discover-category-filter-open');
  if (!sheet) return;
  if (options.immediate) {
    sheet.remove();
    return;
  }
  sheet.classList.remove('open');
  setTimeout(() => sheet.remove(), 240);
}

function getDiscoverCategoryFilterScrollKey(panelKey = discoverCategoryFilterPanelKey) {
  const mode = discoverCategoryFullState?.mode || 'view-all';
  const gridId = discoverCategoryFullState?.gridId || '';
  return `${mode}:${gridId}:${String(panelKey || 'main')}`;
}

function rememberDiscoverCategoryFilterScroll(panelKey = discoverCategoryFilterPanelKey) {
  const sheet = document.getElementById('discover-category-filter-sheet');
  const panel = sheet?.querySelector('.discover-category-filter-panel');
  if (!panel) return;
  discoverCategoryFilterScrollMemory[getDiscoverCategoryFilterScrollKey(panelKey)] = panel.scrollTop || 0;
}

function restoreDiscoverCategoryFilterScroll(panelKey = discoverCategoryFilterPanelKey, direction = 'none') {
  if (direction && direction !== 'none') return;
  const sheet = document.getElementById('discover-category-filter-sheet');
  const panel = sheet?.querySelector('.discover-category-filter-panel');
  if (!panel) return;
  const nextTop = discoverCategoryFilterScrollMemory[getDiscoverCategoryFilterScrollKey(panelKey)] || 0;
  requestAnimationFrame(() => {
    const activePanel = document.getElementById('discover-category-filter-sheet')?.querySelector('.discover-category-filter-panel');
    if (activePanel) activePanel.scrollTop = nextTop;
  });
}

function refreshDiscoverCategoryFilterSheet(direction = 'none') {
  const sheet = document.getElementById('discover-category-filter-sheet');
  if (!sheet || !discoverCategoryFullState) return;
  const track = sheet.querySelector('.discover-category-filter-track');
  if (!track) return;
  rememberDiscoverCategoryFilterScroll();
  track.classList.remove('filter-slide-in', 'filter-slide-back');
  track.innerHTML = renderDiscoverCategoryFilterSheet();
  restoreDiscoverCategoryFilterScroll(discoverCategoryFilterPanelKey, direction);
  if (direction && direction !== 'none') {
    track.classList.add(direction === 'back' ? 'filter-slide-back' : 'filter-slide-in');
    setTimeout(() => track.classList.remove('filter-slide-in', 'filter-slide-back'), 260);
  }
}

function openDiscoverCategoryFilterPanel(panelKey = 'main', direction = 'in') {
  if (!discoverCategoryFullState || !isDiscoverCategoryMediaFilterable(discoverCategoryFullState.gridId)) return;
  rememberDiscoverCategoryFilterScroll();
  const cleanPanelKey = String(panelKey || 'main');
  const isYearDecadePanel = cleanPanelKey.startsWith('year-decade:');
  discoverCategoryFilterPanelKey = (DISCOVER_CATEGORY_FILTER_GROUPS[cleanPanelKey] || cleanPanelKey === 'main' || isYearDecadePanel) ? cleanPanelKey : 'main';
  refreshDiscoverCategoryFilterSheet(direction);
}

async function toggleDiscoverCategoryFilterOption(groupKey = '', value = '') {
  if (!discoverCategoryFullState || !DISCOVER_CATEGORY_FILTER_GROUPS[groupKey]) return;
  const filters = getDiscoverCategoryFilters();
  const values = new Set(filters[groupKey] || []);
  const cleanValue = String(value || '');
  if (groupKey === 'year' && isDiscoverCategoryYearDisabled(Number(cleanValue))) return;
  if (values.has(cleanValue)) values.delete(cleanValue);
  else values.add(cleanValue);
  filters[groupKey] = Array.from(values);
  refreshDiscoverCategoryFilterSheet('none');
  updateDiscoverCategoryFilterButtonState();
  updateDiscoverUniversalSearchFilterButtonState();
  if (discoverCategoryFullState?.mode === 'universal-search') await loadDiscoverUniversalSearchFilteredItems(true);
  else await loadDiscoverFullFilteredItems(true);
  restoreDiscoverCategoryFilterScroll(discoverCategoryFilterPanelKey, 'none');
}

async function selectAllDiscoverCategoryDecadeYears(decadeStart = 2020) {
  if (!discoverCategoryFullState) return;
  const start = Number(decadeStart || 0);
  const decade = DISCOVER_CATEGORY_DECADE_FILTERS.find(item => Number(item.start) === start);
  if (!decade) return;
  const filters = getDiscoverCategoryFilters();
  const values = new Set(filters.year || []);
  DISCOVER_CATEGORY_YEAR_FILTERS
    .filter(item => item.decadeStart === decade.start && !isDiscoverCategoryYearDisabled(item.year))
    .forEach(item => values.add(String(item.key)));
  filters.year = Array.from(values);
  refreshDiscoverCategoryFilterSheet('none');
  updateDiscoverCategoryFilterButtonState();
  updateDiscoverUniversalSearchFilterButtonState();
  if (discoverCategoryFullState?.mode === 'universal-search') await loadDiscoverUniversalSearchFilteredItems(true);
  else await loadDiscoverFullFilteredItems(true);
  restoreDiscoverCategoryFilterScroll(discoverCategoryFilterPanelKey, 'none');
}

async function clearDiscoverCategoryFilters() {
  if (!discoverCategoryFullState) return;
  discoverCategoryFullState.filters = getEmptyDiscoverCategoryFilters();
  discoverCategoryFullState.overrideItems = null;
  discoverCategoryFullState.overrideRenderer = null;
  discoverCategoryFullState.overrideType = null;
  refreshDiscoverCategoryFilterSheet('none');
  updateDiscoverCategoryFilterButtonState();
  updateDiscoverUniversalSearchFilterButtonState();
  if (discoverCategoryFullState?.mode === 'universal-search') await renderDiscoverUniversalSearchDefault(true);
  else renderDiscoverCategoryFullGrid();
}

function setDiscoverFullCategorySortFromSheet(sortKey = 'default') {
  setDiscoverCategorySort(sortKey);
  refreshDiscoverCategoryFilterSheet();
}

async function setDiscoverFullCategoryRangeFromSheet(range = 'week') {
  await setDiscoverFullNewReleaseRange(range);
  refreshDiscoverCategoryFilterSheet();
}

async function setDiscoverFullCategoryCountryFromSheet(code = '') {
  await setDiscoverNewReleaseCountry(code);
  refreshDiscoverCategoryFilterSheet();
}

function getDiscoverFilterSelectedGenreIds() {
  const selected = getDiscoverCategoryFilters().genre || [];
  return selected
    .map(value => findDiscoverCategoryFilterItem('genre', value))
    .filter(item => item && Number.isFinite(Number(item.id)))
    .map(item => String(item.id));
}

function getDiscoverFilterSelectedContentTypes(defaultScope = '') {
  const selected = getDiscoverCategoryFilters().genre || [];
  const explicit = selected
    .map(value => findDiscoverCategoryFilterItem('genre', value))
    .filter(item => item?.contentType)
    .map(item => item.contentType);
  if (defaultScope === 'anime') return ['tv'];
  if (explicit.length) return Array.from(new Set(explicit));
  if (defaultScope === 'mixed') return ['movie', 'tv'];
  return defaultScope === 'movie' ? ['movie'] : ['tv'];
}

function buildDiscoverFilteredRequestParams(mediaType = 'tv', yearFilter = null) {
  const filters = getDiscoverCategoryFilters();
  const genreIds = getDiscoverFilterSelectedGenreIds();
  const countryCodes = (filters.country || []).map(value => String(value || '').trim().toUpperCase()).filter(Boolean);
  const languageCodes = (filters.language || []).map(value => String(value || '').trim()).filter(Boolean);
  const serviceIds = (filters.service || []).map(value => String(value || '').trim()).filter(Boolean);
  const params = {
    sort_by: 'popularity.desc',
    include_adult: 'false',
    'vote_count.gte': mediaType === 'movie' ? '20' : '10',
    watch_region: 'US'
  };
  if (yearFilter) {
    let start = Number(yearFilter.year || yearFilter.start || yearFilter.key || 0);
    let end = Number(yearFilter.end || start);
    if (String(yearFilter.key || '').startsWith('decade:')) {
      start = Number(yearFilter.start || 0);
      end = Number(yearFilter.end || start + 9);
    }
    if (start) {
      const dateField = mediaType === 'movie' ? 'primary_release_date' : 'first_air_date';
      params[`${dateField}.gte`] = `${start}-01-01`;
      params[`${dateField}.lte`] = `${end}-12-31`;
    }
  }
  if (genreIds.length) params.with_genres = genreIds.join('|');
  if (countryCodes.length) params.with_origin_country = countryCodes.join('|');
  if (languageCodes.length) params.with_original_language = languageCodes.join('|');
  if (serviceIds.length) {
    params.with_watch_providers = serviceIds.join('|');
    params.with_watch_monetization_types = 'flatrate|free|ads|rent|buy';
  }
  return params;
}

function getDiscoverFilteredContextLine(item = {}) {
  const rating = Number(item.vote_average || 0);
  const votes = Number(item.vote_count || 0);
  const year = String(getDiscoverReleaseDate(item) || '').slice(0, 4);
  return [year, rating ? `${rating.toFixed(1)} TMDB` : '', votes ? `${votes.toLocaleString()} votes` : '']
    .filter(Boolean)
    .join(' · ');
}

async function fetchDiscoverFilteredMediaItems() {
  if (!discoverCategoryFullState) return [];
  const baseScope = getDiscoverCategoryMediaScope(discoverCategoryFullState.gridId);
  if (!baseScope) return [];
  const filters = getDiscoverCategoryFilters();
  const yearFilters = (filters.year || [])
    .map(value => DISCOVER_CATEGORY_YEAR_FILTERS.find(item => String(item.key) === String(value))
      || DISCOVER_CATEGORY_DECADE_FILTERS.find(item => String(item.key) === String(value)))
    .filter(item => item && !isDiscoverCategoryYearDisabled(Number(item.year || 0)));
  const yearRequests = yearFilters.length ? yearFilters : [null];
  const mediaTypes = getDiscoverFilterSelectedContentTypes(baseScope);
  const requestGroups = [];
  mediaTypes.forEach(mediaType => {
    yearRequests.forEach(yearFilter => {
      const path = mediaType === 'movie' ? 'discover/movie' : 'discover/tv';
      const params = buildDiscoverFilteredRequestParams(mediaType, yearFilter);
      if (baseScope === 'anime' && !params.with_genres) params.with_genres = '16';
      requestGroups.push(
        fetchTmdbPages(path, params, DISCOVER_CATEGORY_FILTER_PAGE_COUNT)
          .then(items => items.map(item => ({
            ...markDiscoverMediaType(item, mediaType),
            discoverContext: getDiscoverFilteredContextLine(item)
          })))
          .catch(error => {
            console.warn('Discover filtered request failed:', path, params, error);
            return [];
          })
      );
    });
  });
  const combined = normalizeDiscoverTypedItems((await Promise.all(requestGroups)).flat(), mediaTypes.length > 1 ? 'mixed' : mediaTypes[0]);
  const candidates = combined
    .filter(item => item?.poster_path && getDiscoverSortTitle(item) && item.overview)
    .filter(item => baseScope !== 'anime' || isAnimeDiscoverCandidate(item));
  return candidates
    .map(item => ({
      ...item,
      calculatedScore: scoreDiscoverTmdbItem(candidates, item, 'popular', baseScope === 'anime' ? 'anime' : (item.media_type || mediaTypes[0] || 'tv')),
      discoverContext: item.discoverContext || getDiscoverFilteredContextLine(item)
    }))
    .sort(compareDiscoverCalculatedScoreDesc)
    .slice(0, DISCOVER_CATEGORY_FILTER_LIMIT);
}

async function loadDiscoverFullFilteredItems(force = false) {
  if (!discoverCategoryFullState || !isDiscoverCategoryMediaFilterable(discoverCategoryFullState.gridId)) return;
  if (!hasDiscoverCategoryMediaFilters()) {
    discoverCategoryFullState.overrideItems = null;
    discoverCategoryFullState.overrideRenderer = null;
    discoverCategoryFullState.overrideType = null;
    renderDiscoverCategoryFullGrid();
    return;
  }
  const grid = document.getElementById('discover-category-full-grid');
  if (grid) grid.innerHTML = '<div class="discover-message">Loading filtered titles...</div>';
  try {
    const cacheKey = `full-filters:${DISCOVER_CATEGORY_FILTER_VERSION}:${discoverCategoryFullState.gridId}:${JSON.stringify(getDiscoverCategoryFilters())}`;
    const items = await loadDiscoverCachedData(cacheKey, fetchDiscoverFilteredMediaItems, force);
    discoverCategoryFullState.overrideItems = Array.isArray(items) ? items : [];
    const scope = getDiscoverCategoryMediaScope(discoverCategoryFullState.gridId);
    discoverCategoryFullState.overrideRenderer = scope === 'anime' ? 'cards' : 'ranked';
    discoverCategoryFullState.overrideType = scope === 'movie' ? 'movie' : (scope === 'anime' ? 'tv' : 'tv');
    renderDiscoverCategoryFullGrid();
    if (!items?.length && grid) grid.innerHTML = '<div class="discover-message">No titles found for these filters.</div>';
  } catch (error) {
    console.error('Discover filtered titles failed:', error);
    if (grid) grid.innerHTML = '<div class="discover-message">Filtered titles could not load. Try a lighter filter set.</div>';
  }
}

function renderDiscoverCategorySortControls() {
  const sortRow = document.getElementById('discover-category-sort-row');
  const releaseRow = document.getElementById('discover-category-release-row');
  const countryRow = document.getElementById('discover-category-country-row');
  if (!sortRow || !discoverCategoryFullState) return;
  if (isDiscoverCategoryMediaFilterable(discoverCategoryFullState.gridId)) {
    sortRow.style.display = 'none';
    if (releaseRow) { releaseRow.style.display = 'none'; releaseRow.innerHTML = ''; }
    if (countryRow) { countryRow.style.display = 'none'; countryRow.innerHTML = ''; }
    updateDiscoverCategoryFilterButtonState();
    return;
  }
  const options = getDiscoverFullPageSortOptions(discoverCategoryFullState.gridId);
  sortRow.style.display = '';
  sortRow.innerHTML = options.map(option => `<button class="discover-category-sort-btn${option.key === discoverCategoryFullState.sortKey ? ' active' : ''}" type="button" onclick="setDiscoverCategorySort('${escAttr(option.key)}')">${escHtml(option.label)}</button>`).join('');
  const isNewRelease = isDiscoverGridCountryFilterableNewRelease(discoverCategoryFullState.gridId);
  if (releaseRow) {
    releaseRow.style.display = isNewRelease ? '' : 'none';
    releaseRow.innerHTML = isNewRelease
      ? ['week', 'month'].map(range => `<button class="discover-category-sort-btn${range === (discoverCategoryFullState.newReleaseRange || discoverNewReleaseRange) ? ' active' : ''}" type="button" onclick="setDiscoverFullNewReleaseRange('${range}')">Show This ${range === 'week' ? 'Week' : 'Month'}</button>`).join('')
      : '';
  }
  if (countryRow) {
    countryRow.style.display = isNewRelease ? '' : 'none';
    countryRow.innerHTML = isNewRelease
      ? getDiscoverNewReleaseCountryOptions().map(option => `<button class="discover-category-sort-btn${option.code === (discoverCategoryFullState.newReleaseCountryCode || '') ? ' active' : ''}" type="button" onclick="setDiscoverNewReleaseCountry('${escAttr(option.code)}')">${escHtml(option.label)}</button>`).join('')
      : '';
  }
  updateDiscoverCategoryFilterButtonState();
}

function renderDiscoverCategoryFullGrid() {
  if (!discoverCategoryFullState) return;
  const stored = discoverCategoryDataStore[discoverCategoryFullState.gridId];
  const grid = document.getElementById('discover-category-full-grid');
  if (!grid || !stored) return;
  const sourceItems = Array.isArray(discoverCategoryFullState.overrideItems) ? discoverCategoryFullState.overrideItems : stored.items;
  const items = sortDiscoverFullPageItems(sourceItems, discoverCategoryFullState.sortKey, discoverCategoryFullState.gridId);
  grid.dataset.sourceGridId = discoverCategoryFullState.gridId || '';
  const renderer = discoverCategoryFullState.overrideRenderer || stored.renderer;
  const type = discoverCategoryFullState.overrideType || stored.type || 'mixed';
  if (renderer === 'games') renderGamesDiscoverCards(items, 'discover-category-full-grid');
  else if (renderer === 'country') renderCountryDiscoverCards(type || 'tv', items, 'discover-category-full-grid');
  else if (renderer === 'cards') renderDiscoverCards(type || 'mixed', items, 'discover-category-full-grid');
  else renderRankedDiscoverCards(type || 'mixed', items, 'discover-category-full-grid');
}

function setDiscoverCategorySort(sortKey = 'popular') {
  if (!discoverCategoryFullState) return;
  const allowed = getDiscoverFullPageSortOptions(discoverCategoryFullState.gridId).map(option => option.key);
  discoverCategoryFullState.sortKey = allowed.includes(sortKey) ? sortKey : getDiscoverFullPageDefaultSort(discoverCategoryFullState.gridId);
  renderDiscoverCategorySortControls();
  renderDiscoverCategoryFullGrid();
}

async function ensureDiscoverCategoryData(gridId = '') {
  if (discoverCategoryDataStore[gridId]?.items?.length) return discoverCategoryDataStore[gridId];
  if (gridId.startsWith('anime-discover-')) await loadAnimeDiscover(false);
  else if (gridId.startsWith('discover-games-')) await loadGamesDiscover(false);
  else await loadDiscover(false);
  return discoverCategoryDataStore[gridId] || null;
}

async function loadDiscoverFullNewReleaseItems(force = false) {
  if (!discoverCategoryFullState || !isDiscoverGridCountryFilterableNewRelease(discoverCategoryFullState.gridId)) return;
  const grid = document.getElementById('discover-category-full-grid');
  if (grid) grid.innerHTML = '<div class="discover-message">Loading new releases...</div>';
  try {
    const mediaType = getDiscoverNewReleaseMediaTypeForGrid(discoverCategoryFullState.gridId);
    const range = discoverCategoryFullState.newReleaseRange || discoverNewReleaseRange;
    const countryCode = discoverCategoryFullState.newReleaseCountryCode || '';
    const items = await loadDiscoverCachedData(
      `media:${mediaType}-date-new-releases:${DISCOVER_RANKING_CACHE_VERSION}:${range}:${DISCOVER_RELEASE_REGION}:${countryCode || 'all'}:full`,
      () => fetchNewReleasesByDate(range, DISCOVER_FULL_NEW_RELEASE_LIMIT, DISCOVER_FULL_NEW_RELEASE_PAGE_COUNT, mediaType, {
        releaseRegion: DISCOVER_RELEASE_REGION,
        originCountry: countryCode
      }),
      force
    );
    discoverCategoryFullState.overrideItems = Array.isArray(items) ? items : [];
    discoverCategoryFullState.overrideRenderer = mediaType === 'anime' ? 'cards' : 'ranked';
    discoverCategoryFullState.overrideType = mediaType === 'movie' ? 'movie' : 'tv';
    renderDiscoverCategoryFullGrid();
  } catch (error) {
    console.error('Discover full new releases failed:', error);
    if (grid) grid.innerHTML = '<div class="discover-message">New releases could not load. It will try again automatically later.</div>';
  }
}

async function setDiscoverNewReleaseCountry(code = '') {
  if (!discoverCategoryFullState || !isDiscoverGridCountryFilterableNewRelease(discoverCategoryFullState.gridId)) return;
  const nextCode = getValidDiscoverNewReleaseCountry(code);
  if ((discoverCategoryFullState.newReleaseCountryCode || '') === nextCode && Array.isArray(discoverCategoryFullState.overrideItems)) return;
  discoverCategoryFullState.newReleaseCountryCode = nextCode;
  discoverCategoryFullState.overrideItems = null;
  renderDiscoverCategorySortControls();
  await loadDiscoverFullNewReleaseItems(false);
}

async function setDiscoverFullNewReleaseRange(range = 'week') {
  if (!discoverCategoryFullState || !isDiscoverGridCountryFilterableNewRelease(discoverCategoryFullState.gridId)) return;
  const nextRange = range === 'month' ? 'month' : 'week';
  if ((discoverCategoryFullState.newReleaseRange || discoverNewReleaseRange) === nextRange && Array.isArray(discoverCategoryFullState.overrideItems)) return;
  discoverCategoryFullState.newReleaseRange = nextRange;
  discoverCategoryFullState.overrideItems = null;
  renderDiscoverCategorySortControls();
  await loadDiscoverFullNewReleaseItems(false);
}

async function openDiscoverCategoryFullPage(gridId = '') {
  if (!DISCOVER_FULL_CATEGORY_GRID_IDS.includes(gridId)) return;
  const page = getOrCreateDiscoverCategoryFullPage();
  const title = getDiscoverCategoryTitleText(gridId);
  const titleEl = document.getElementById('discover-category-full-title');
  const subtitleEl = document.getElementById('discover-category-full-subtitle');
  const grid = document.getElementById('discover-category-full-grid');
  page.dataset.returnScrollY = String(window.scrollY || window.pageYOffset || 0);
  page.style.display = 'block';
  if (window.history?.pushState && !window.history.state?.screenListDiscoverCategory) {
    window.history.pushState({ screenListDiscoverCategory: gridId }, '', window.location.href);
    discoverCategoryFullHistoryActive = true;
  }
  page.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  if (titleEl) titleEl.textContent = title;
  if (subtitleEl) subtitleEl.textContent = isDiscoverCategoryMediaFilterable(gridId)
    ? 'Filter by year, genre, country, language, and service.'
    : 'View all and sort this category.';
  if (grid) grid.innerHTML = '<div class="discover-message">Loading category...</div>';
  discoverCategoryFullState = { gridId, sortKey: getDiscoverFullPageDefaultSort(gridId), newReleaseCountryCode: '', newReleaseRange: discoverNewReleaseRange, filters: getEmptyDiscoverCategoryFilters(), overrideItems: null, overrideRenderer: null, overrideType: null };
  renderDiscoverCategorySortControls();
  try {
    const stored = await ensureDiscoverCategoryData(gridId);
    if (!stored?.items?.length) throw new Error('No category data loaded');
    renderDiscoverCategoryFullGrid();
  } catch (e) {
    console.error('Discover category full page failed:', gridId, e);
    if (grid) grid.innerHTML = '<div class="discover-message">This category could not load.</div>';
  }
}

function closeDiscoverCategoryFullPage(options = {}) {
  const page = document.getElementById('discover-category-full-page');
  if (!options.fromPopState && discoverCategoryFullHistoryActive && window.history?.state?.screenListDiscoverCategory) {
    discoverCategoryFullHistoryActive = false;
    window.history.back();
    return;
  }
  const returnScrollY = Number(page?.dataset?.returnScrollY || 0);
  closeDiscoverCategoryFilterSheet({ immediate: true });
  if (page) page.style.display = 'none';
  discoverCategoryFullState = null;
  discoverCategoryFullHistoryActive = false;
  document.body.style.overflow = '';
  window.requestAnimationFrame(() => window.scrollTo({ top: returnScrollY, behavior: 'auto' }));
}

window.addEventListener('popstate', () => {
  const page = document.getElementById('discover-category-full-page');
  if (page && page.style.display !== 'none') {
    closeDiscoverCategoryFullPage({ fromPopState: true });
  }
});

function initDiscoverCategoryTitleLinks() {
  DISCOVER_FULL_CATEGORY_GRID_IDS.forEach(gridId => {
    const grid = document.getElementById(gridId);
    const section = grid?.closest?.('.discover-section');
    const title = section?.querySelector?.('.discover-section-title');
    if (!title || title.dataset.discoverFullReady === '1') return;
    title.dataset.discoverFullReady = '1';
    title.classList.add('discover-category-title-clickable');
    if (title.tagName !== 'BUTTON') {
      title.setAttribute('role', 'button');
      title.setAttribute('tabindex', '0');
    }
    title.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openDiscoverCategoryFullPage(gridId);
    });
    title.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openDiscoverCategoryFullPage(gridId);
    });
  });
}

(function initDiscoverCategoryTitleLinksWhenReady() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDiscoverCategoryTitleLinks, { once: true });
  } else {
    initDiscoverCategoryTitleLinks();
  }
})();

function sanitizeDiscoverCardContextLine(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  return /\bTMDB\b/i.test(text) || /\bvotes?\b/i.test(text) ? '' : text;
}

function renderDiscoverCards(type, items, gridId) {
  const resolvedGridId = gridId || (type === 'movie' ? 'discover-movie-popular-grid' : 'discover-tv-popular-grid');
  storeDiscoverCategoryData(resolvedGridId, type, items, 'cards');
  const grid = document.getElementById(resolvedGridId);
  if (!grid) return;
  if (!items.length) {
    grid.innerHTML = '<div class="discover-message">No discovery titles found.</div>';
    return;
  }
  const showDateLine = isDiscoverGridNewRelease(resolvedGridId) || isDiscoverGridUpcoming(resolvedGridId);
  grid.dataset.expanded = 'false';
  delete grid.dataset.visibleCount;
  grid.innerHTML = items.map(item => {
    const itemType = type === 'mixed' ? (item.media_type || 'movie') : type;
    const title = item.title || item.name || '';
    const genreLine = getDiscoverGenreNames(item, itemType).slice(0, 2).join(' · ');
    const poster = `https://image.tmdb.org/t/p/w342${item.poster_path}`;
    const overview = item.overview || '';
    const section = itemType === 'movie' ? 'movies' : 'shows';
    const alreadyAdded = isDuplicateTitle(title, section);
    const titleAttr = escAttr(title);
    const addClick = `openDiscoveryAddModal('${itemType}', ${item.id}, this)`;
    const removeClick = `removeDiscoveryTitle(this)`;
    const tmdbRating = Number(item.vote_average || 0);
    /* v568: rating first, then title, then genre, then date (date-grids only) */
    const ratingHtml = tmdbRating > 0
      ? `<div class="dc-rating"><span class="dc-rating-star" aria-hidden="true">★</span>${tmdbRating.toFixed(1)}</div>`
      : '';
    const releaseLine = showDateLine ? getDiscoverCardReleaseLine(item) : '';
    setDiscoverMediaProfileSeed(itemType, item.id, {
      title, name: title, overview, poster,
      poster_path: item.poster_path || '',
      backdrop_path: item.backdrop_path || '',
      release_date: item.release_date || '',
      first_air_date: item.first_air_date || '',
      vote_average: item.vote_average || '',
      vote_count: item.vote_count || '',
      genreNames: getDiscoverGenreNames(item, itemType)
    });
    return `<div class="discover-card" data-media-type="${itemType}">
      <div class="discover-poster" data-poster="${escAttr(poster)}" data-media-type="${itemType}" data-media-id="${item.id}" data-discover-title="${titleAttr}" data-discover-section="${section}" data-hovering="0" data-pinned="0" data-long-press-triggered="0" onclick="handleDiscoverPosterClick(event, this, '${itemType}', ${item.id})" onpointerdown="startDiscoverPosterPress(event, this, '${itemType}', ${item.id})" onpointermove="moveDiscoverPosterPress(event)" onpointerup="stopDiscoverPosterPress()" onpointercancel="clearDiscoverCardPressTimer()" onpointerleave="clearDiscoverCardPressTimer()">
        ${buildDiscoverPosterMarkup(poster)}${getDiscoverExpandIconMarkup({ dataset: { mediaType: itemType, mediaId: String(item.id) } })}${getDiscoverPosterTooltipMarkup()}${getDiscoverFriendStackMarkup(title, section)}
      </div>
      <div class="discover-card-body" onclick="handleDiscoverCardBodyTap(event, this)">
        <div class="discover-card-info-row">
          <div class="discover-card-info-stack">
            ${ratingHtml}
            <button class="discover-card-title discover-title-profile-btn" type="button" onclick="openDiscoverMediaProfile(event, '${itemType}', ${item.id})">${escHtml(title)}</button>
            ${genreLine ? `<div class="discover-card-genre">${escHtml(genreLine)}</div>` : ''}
            ${releaseLine ? `<div class="dc-release-line">${escHtml(releaseLine)}</div>` : ''}
          </div>
          <button class="discover-close-btn" type="button" onclick="handleDiscoverCloseClick(event, this)">Close</button>
        </div>
        <button class="discover-add-btn${alreadyAdded ? ' added' : ''}" data-discover-type="${itemType}" data-discover-id="${item.id}" data-discover-section="${section}" data-discover-title="${titleAttr}" title="${alreadyAdded ? 'Click to remove from your library' : ''}" onclick="${alreadyAdded ? removeClick : addClick}">${alreadyAdded ? getDiscoverLibraryButtonText(title, section) : '+ Add to Library'}</button>
      </div>
    </div>`;
  }).join('');
  requestAnimationFrame(() => {
    setupDiscoverSectionLimit(grid);
    refreshDiscoverFriendStacks();
    if (typeof applyDiscoverMixedFilter === 'function') applyDiscoverMixedFilter();
  });
}

function renderCountryDiscoverCards(type, items, gridId) {
  storeDiscoverCategoryData(gridId, type, items, 'country');
  const grid = document.getElementById(gridId);
  if (!grid) return;

  if (!items.length) {
    grid.innerHTML = '<div class="discover-message">No titles found for this country.</div>';
    return;
  }

  grid.dataset.expanded = 'false';
  delete grid.dataset.visibleCount;
  grid.innerHTML = items.map((item, index) => {
    const rank = index + 1;
    const itemType = item.media_type || type;
    const title = item.title || item.name || '';
    const year = (item.release_date || item.first_air_date || '').slice(0, 4);
    const poster = `https://image.tmdb.org/t/p/w342${item.poster_path}`;
    const overview = item.overview || '';
    const section = itemType === 'movie' ? 'movies' : 'shows';
    const alreadyAdded = isDuplicateTitle(title, section);
    const titleAttr = escAttr(title);
    const addClick = `openDiscoveryAddModal('${itemType}', ${item.id}, this)`;
    const removeClick = `removeDiscoveryTitle(this)`;

    setDiscoverMediaProfileSeed(itemType, item.id, {
      title,
      name: title,
      overview,
      poster,
      poster_path: item.poster_path || '',
      backdrop_path: item.backdrop_path || '',
      release_date: item.release_date || '',
      first_air_date: item.first_air_date || '',
      vote_average: item.vote_average || '',
      vote_count: item.vote_count || '',
      genreNames: getDiscoverGenreNames(item, itemType)
    });

    return `<div class="discover-card discover-country-card">
      <div class="discover-rank">#${rank}</div>
      <div class="discover-poster" data-poster="${escAttr(poster)}" data-media-type="${itemType}" data-media-id="${item.id}" data-discover-title="${titleAttr}" data-discover-section="${section}" data-hovering="0" data-pinned="0" data-long-press-triggered="0" onclick="handleDiscoverPosterClick(event, this, '${itemType}', ${item.id})" onpointerdown="startDiscoverPosterPress(event, this, '${itemType}', ${item.id})" onpointermove="moveDiscoverPosterPress(event)" onpointerup="stopDiscoverPosterPress()" onpointercancel="clearDiscoverCardPressTimer()" onpointerleave="clearDiscoverCardPressTimer()">
        ${buildDiscoverPosterMarkup(poster)}${getDiscoverExpandIconMarkup({ dataset: { mediaType: itemType, mediaId: String(item.id) } })}${getDiscoverPosterTooltipMarkup()}${getDiscoverFriendStackMarkup(title, section)}
      </div>
      <div class="discover-card-body discover-country-card-body">
        <button class="discover-card-title discover-title-profile-btn discover-country-title" type="button" onclick="openDiscoverMediaProfile(event, '${itemType}', ${item.id})">${escHtml(title)}${year ? ` (${year})` : ''}</button>
        <button class="discover-add-btn${alreadyAdded ? ' added' : ''}" data-discover-type="${itemType}" data-discover-id="${item.id}" data-discover-section="${section}" data-discover-title="${titleAttr}" title="${alreadyAdded ? 'Click to remove from your library' : ''}" onclick="${alreadyAdded ? removeClick : addClick}">${alreadyAdded ? getDiscoverLibraryButtonText(title, section) : '+ Add to Library'}</button>
      </div>
    </div>`;
  }).join('');

  requestAnimationFrame(() => {
    setupDiscoverSectionLimit(grid);
    refreshDiscoverFriendStacks();
  });
}

function renderRankedDiscoverCards(type, items, gridId) {
  storeDiscoverCategoryData(gridId, type, items, 'ranked');
  const grid = document.getElementById(gridId);
  if (!grid) return;

  if (!items.length) {
    grid.innerHTML = '<div class="discover-message">No titles found for this category.</div>';
    return;
  }

  const sourceGridId = gridId === 'discover-category-full-grid' ? (discoverCategoryFullState?.gridId || grid?.dataset?.sourceGridId || gridId) : gridId;
  const isNewReleaseGrid = isDiscoverGridNewRelease(sourceGridId);
  const isDateOnlyGrid = isNewReleaseGrid || isDiscoverGridUpcoming(sourceGridId);
  grid.dataset.expanded = 'false';
  delete grid.dataset.visibleCount;
  grid.innerHTML = items.map((item, index) => {
    const rank = index + 1;
    const rankHtml = isDateOnlyGrid ? '' : `<div class="discover-rank">#${rank}</div>`;
    const itemType = item.media_type || type;
    const title = item.title || item.name || '';
    const year = (item.release_date || item.first_air_date || '').slice(0, 4);
    const genreLine = isNewReleaseGrid ? '' : getDiscoverGenreNames(item, itemType).slice(0, 2).join(' · ');
    const poster = `https://image.tmdb.org/t/p/w342${item.poster_path}`;
    const overview = item.overview || '';
    const contextLine = isNewReleaseGrid ? '' : sanitizeDiscoverCardContextLine(item.discoverContext || item.sourceLabel || '');
    const section = itemType === 'movie' ? 'movies' : 'shows';
    const releaseLine = formatDiscoverReleaseCardDate(getDiscoverReleaseDate(item));
    const alreadyAdded = isDuplicateTitle(title, section);
    const titleAttr = escAttr(title);
    const addClick = `openDiscoveryAddModal('${itemType}', ${item.id}, this)`;
    const removeClick = `removeDiscoveryTitle(this)`;
    const cardClass = isNewReleaseGrid ? 'discover-card discover-new-release-card' : 'discover-card';
    const metaHtml = isNewReleaseGrid
      ? `<div class="discover-card-meta discover-new-release-date">Released: ${escHtml(releaseLine || formatDiscoverReleaseDate(getDiscoverReleaseDate(item)))}</div>`
      : '';
    const tmdbRating = Number(item.vote_average || 0);
    /* v568: rating line first, then title, then genre, date only for new-release / upcoming grids */
    const ratingHtmlRanked = tmdbRating > 0
      ? `<div class="dc-rating"><span class="dc-rating-star" aria-hidden="true">★</span>${tmdbRating.toFixed(1)}</div>`
      : '';
    const cardReleaseLine = isDateOnlyGrid ? getDiscoverCardReleaseLine(item) : '';

    setDiscoverMediaProfileSeed(itemType, item.id, {
      title, name: title, overview, poster,
      poster_path: item.poster_path || '',
      backdrop_path: item.backdrop_path || '',
      release_date: item.release_date || '',
      first_air_date: item.first_air_date || '',
      vote_average: item.vote_average || '',
      vote_count: item.vote_count || '',
      genreNames: getDiscoverGenreNames(item, itemType)
    });

    return `<div class="${cardClass}" data-media-type="${itemType}">
      ${rankHtml}
      <div class="discover-poster" data-poster="${escAttr(poster)}" data-media-type="${itemType}" data-media-id="${item.id}" data-discover-title="${titleAttr}" data-discover-section="${section}" data-hovering="0" data-pinned="0" data-long-press-triggered="0" onclick="handleDiscoverPosterClick(event, this, '${itemType}', ${item.id})" onpointerdown="startDiscoverPosterPress(event, this, '${itemType}', ${item.id})" onpointermove="moveDiscoverPosterPress(event)" onpointerup="stopDiscoverPosterPress()" onpointercancel="clearDiscoverCardPressTimer()" onpointerleave="clearDiscoverCardPressTimer()">
        ${buildDiscoverPosterMarkup(poster)}${getDiscoverExpandIconMarkup({ dataset: { mediaType: itemType, mediaId: String(item.id) } })}${getDiscoverPosterTooltipMarkup()}${getDiscoverFriendStackMarkup(title, section)}
      </div>
      <div class="discover-card-body" onclick="handleDiscoverCardBodyTap(event, this)">
        <div class="discover-card-info-row">
          <div class="discover-card-info-stack">
            ${ratingHtmlRanked}
            <button class="discover-card-title discover-title-profile-btn" type="button" onclick="openDiscoverMediaProfile(event, '${itemType}', ${item.id})">${escHtml(title)}</button>
            ${genreLine ? `<div class="discover-card-genre">${escHtml(genreLine)}</div>` : ''}
            ${cardReleaseLine ? `<div class="dc-release-line">${escHtml(cardReleaseLine)}</div>` : ''}
          </div>
          <button class="discover-close-btn" type="button" onclick="handleDiscoverCloseClick(event, this)">Close</button>
        </div>
        <button class="discover-add-btn${alreadyAdded ? ' added' : ''}" data-discover-type="${itemType}" data-discover-id="${item.id}" data-discover-section="${section}" data-discover-title="${titleAttr}" title="${alreadyAdded ? 'Click to remove from your library' : ''}" onclick="${alreadyAdded ? removeClick : addClick}">${alreadyAdded ? getDiscoverLibraryButtonText(title, section) : '+ Add to Library'}</button>
      </div>
    </div>`;
  }).join('');

  requestAnimationFrame(() => {
    setupDiscoverSectionLimit(grid);
    refreshDiscoverFriendStacks();
    if (typeof applyDiscoverMixedFilter === 'function') applyDiscoverMixedFilter();
  });
}

async function openFriendWatchingMediaProfile(event, poster) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if (!poster) return;
  const section = String(poster.dataset.discoverSection || '').trim();
  const title = String(poster.dataset.discoverTitle || '').trim();
  const cover = String(poster.dataset.poster || '').trim();
  const rawId = String(poster.dataset.mediaId || '').trim();
  const type = section === 'movies' ? 'movie' : 'tv';
  if (!title || (type !== 'movie' && type !== 'tv')) return;

  const seed = {
    title,
    name: title,
    poster: cover,
    cover,
    mediaCategory: section,
    librarySection: section,
    isAnime: section === 'anime'
  };

  if (/^\d+$/.test(rawId)) {
    setDiscoverMediaProfileSeed(type, rawId, seed);
    openDiscoverMediaProfile(event, type, rawId, poster);
    return;
  }

  try {
    const params = { query: title };
    const res = await fetchTmdbProxy(`search/${type}`, params);
    if (!res.ok) throw new Error(`Friend watching profile search failed: ${res.status}`);
    const json = await res.json();
    const results = json?.results || [];
    const picked = results.find(item => item?.poster_path) || results[0];
    if (!picked?.id) throw new Error('No TMDB match found');
    setDiscoverMediaProfileSeed(type, picked.id, {
      ...seed,
      ...picked,
      title: picked.title || picked.name || title,
      name: picked.name || picked.title || title
    });
    openDiscoverMediaProfile(event, type, picked.id, poster);
  } catch (error) {
    console.error('Friend watching profile open failed:', error);
    if (typeof showToast === 'function') showToast('Could not open this friend title yet');
  }
}

function renderFriendWatchingDiscoverCards(items, gridId, options = {}) {
  const grid = document.getElementById(gridId);
  if (!grid) return;

  if (!items.length) {
    grid.innerHTML = `<div class="discover-message">${escHtml(discoverFriendWatchingMessage)}</div>`;
    const button = getDiscoverExpandButton(grid);
    if (button) button.style.display = 'none';
    return;
  }

  grid.dataset.expanded = 'false';
  delete grid.dataset.visibleCount;
  grid.classList.toggle('discover-friends-row', !!options.row);
  grid.classList.toggle('discover-friends-full-grid', !!options.fullPage);
  const expandButton = getDiscoverExpandButton(grid);
  if (expandButton && options.row) {
    expandButton.style.display = '';
    expandButton.textContent = 'View all';
    expandButton.classList.remove('is-collapsing');
  }
  grid.innerHTML = items.map(item => {
    const title = item.title || '';
    const sectionLabel = item.section === 'anime' ? 'Anime' : item.section === 'movies' ? 'Movie' : 'TV Show';
    // v435: progress/status line — built from the friend who most recently
    // updated this title (latestActivityFriend / latestActivityProgress / latestActivityStatus).
    // - watched within 7d → "Just finished"
    // - watching shows/anime with episode data → "Season 2, 30/40"
    // - watching with no episode data → fall back to "Watching"
    // - planned → fall back to existing aggregated friendStatuses join
    const progress = item.latestActivityProgress || null;
    const latestStatus = String(item.latestActivityStatus || '').toLowerCase();
    let progressLine = '';
    if (latestStatus === 'watched') {
      progressLine = 'Just finished';
    } else if (latestStatus === 'watching' && progress && (item.section === 'shows' || item.section === 'anime')) {
      const total = Number(progress.total || 0);
      const watched = Number(progress.watchedCount || 0);
      const seasonNum = Number(progress.seasonNum || 0);
      const seasonPart = seasonNum > 0 ? `Season ${seasonNum}` : 'Watching';
      const epPart = total > 0 ? `${watched}/${total}` : (watched > 0 ? `Episode ${watched}` : '');
      progressLine = epPart ? `${seasonPart}, ${epPart}` : seasonPart;
    } else if (latestStatus === 'watching') {
      progressLine = 'Watching';
    } else {
      progressLine = (item.friendStatuses || []).join(' / ');
    }
    const primaryFriend = item.latestActivityFriend || (item.friendProfiles || [])[0] || { name: (item.friendNames || [])[0] || 'Friend', photo: '' };
    const extraFriends = Math.max(0, (item.friendNames || []).length - 1);
    const friendName = primaryFriend.name || 'Friend';
    const friendUid = primaryFriend.uid || '';
    const avatar = getDiscoverAvatarUrl(primaryFriend);
    const friendClick = friendUid ? ` onclick="openDiscoverFriendProfileFromCard(event, '${escAttr(friendUid)}')"` : '';
    return `<div class="discover-card discover-friend-watch-card">
      <div class="discover-poster" data-poster="${escAttr(item.cover || '')}" data-media-type="${item.section === 'movies' ? 'movie' : 'tv'}" data-media-id="${escAttr(String(item.id || item.tmdbId || ''))}" data-discover-title="${escAttr(title)}" data-discover-section="${escAttr(item.section || '')}" onclick="openFriendWatchingMediaProfile(event, this)">
        ${buildDiscoverPosterMarkup(item.cover || '')}
      </div>
      <div class="discover-card-body">
        <div class="discover-card-info-row">
          <div class="discover-card-info-stack">
            <div class="discover-card-title discover-friend-watch-title">${escHtml(title)}</div>
            <div class="discover-card-meta discover-friend-watch-meta">${escHtml(sectionLabel)}</div>
            ${progressLine ? `<div class="discover-card-meta discover-friend-watch-progress">${escHtml(progressLine)}</div>` : ''}
          </div>
        </div>
        <div class="discover-friend-card-user">
          <img class="discover-friend-card-avatar${friendUid ? ' clickable' : ''}" src="${escAttr(avatar)}" alt="${escAttr(friendName)}" loading="lazy"${friendClick}>
          <div class="discover-friend-card-name">${escHtml(friendName)}${extraFriends ? ` +${extraFriends}` : ''}</div>
        </div>
      </div>
    </div>`;
  }).join('');

  requestAnimationFrame(() => {
    if (!options.skipLimit && !options.row && !options.fullPage) setupDiscoverSectionLimit(grid);
  });
}

function openDiscoverFriendProfileFromCard(event, uid) {
  if (event) event.stopPropagation();
  if (!uid) return;
  const page = document.getElementById('discover-friends-full-page');
  if (page && page.style.display !== 'none') page.style.display = 'none';
  document.body.style.overflow = '';
  openUserProfile(uid);
}

function getOrCreateDiscoverFriendsFullPage() {
  let page = document.getElementById('discover-friends-full-page');
  if (page) return page;
  page = document.createElement('div');
  page.id = 'discover-friends-full-page';
  page.className = 'discover-friends-full-page';
  page.style.display = 'none';
  page.innerHTML = `
    <div class="discover-friends-full-shell">
      <button class="discover-friends-full-back" type="button" onclick="closeDiscoverFriendsWatchingPage()">Back</button>
      <div class="discover-friends-full-head">
        <div class="discover-title">What Your Friends Are Watching</div>
        <div class="discover-subtitle">All friend watching and watchlist titles, ranked by friend activity.</div>
      </div>
      <div class="discover-grid discover-friends-full-grid" id="discover-friends-full-grid"><div class="discover-message">Loading...</div></div>
    </div>`;
  document.body.appendChild(page);
  return page;
}

async function openDiscoverFriendsWatchingPage() {
  ensureDiscoverFriendWatchingRefreshSystem();
  const page = getOrCreateDiscoverFriendsFullPage();
  const grid = page.querySelector('#discover-friends-full-grid');
  page.dataset.returnScrollY = String(window.scrollY || window.pageYOffset || 0);
  page.style.display = 'block';
  page.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  if (grid) grid.innerHTML = '<div class="discover-message">Loading friend titles...</div>';
  try {
    const items = await fetchFriendWatchingDiscoverTitles(120);
    renderFriendWatchingDiscoverCards(items, 'discover-friends-full-grid', { fullPage: true, skipLimit: true });
  } catch (e) {
    console.error('Full friend watching page failed:', e);
    if (grid) grid.innerHTML = '<div class="discover-message">Friend watching titles could not load.</div>';
  }
}

function closeDiscoverFriendsWatchingPage() {
  const page = document.getElementById('discover-friends-full-page');
  const returnScrollY = Number(page?.dataset?.returnScrollY || 0);
  if (page) page.style.display = 'none';
  document.body.style.overflow = '';
  window.requestAnimationFrame(() => window.scrollTo({ top: returnScrollY, behavior: 'auto' }));
}

function renderGamesDiscoverCards(items, gridId) {
  storeDiscoverCategoryData(gridId, 'game', items, 'games');
  const grid = document.getElementById(gridId);
  if (!grid) return;
  if (!items.length) {
    grid.innerHTML = '<div class="discover-message">No game discovery titles found.</div>';
    return;
  }
  grid.dataset.expanded = 'false';
  delete grid.dataset.visibleCount;
  grid.innerHTML = items.map(item => {
    const title = item.name || '';
    const year = (item.released || '').slice(0, 4);
    const poster = typeof getScreenListDisplayGameCover === 'function' ? getScreenListDisplayGameCover(item) : (typeof getScreenListPreferredGameCover === 'function' ? getScreenListPreferredGameCover(item) : '');
    const genres = (item.genres || []).map(g => g.name).slice(0, 3).join(', ');
    const platforms = (item.platforms || []).map(p => p.platform?.name).filter(Boolean).slice(0, 3).join(', ');
    const overview = genres || platforms || 'Game';
    const seed = {
      rawgId: String(item.id || ''),
      rawgSlug: item.slug || '',
      backloggdSlug: item.slug || '',
      metacriticSlug: item.slug || '',
      title,
      name: title,
      released: item.released || '',
      background_image: poster,
      cover: poster,
      poster,
      image: poster,
      igdbCoverUrl: item.igdbCoverUrl || '',
      genres: item.genres || [],
      platforms: item.platforms || [],
      metacritic: item.metacritic || '',
      rating: item.rating || '',
      ratings_count: item.ratings_count || item.reviews_count || 0
    };
    setGameMediaProfileSeed(item.id, seed);
    const alreadyAdded = isDuplicateTitle(title, 'games');
    const titleAttr = escAttr(title);
    const addClick = `openDiscoveryAddModal('game', ${item.id}, this)`;
    const removeClick = `removeDiscoveryTitle(this)`;
    return `<div class="discover-card games-discover-card">
      <div class="discover-poster${poster ? '' : ' no-img screenlist-game-cover-pending'}" data-poster="${escAttr(poster)}" data-media-type="game" data-media-id="${escAttr(String(item.id || ''))}" data-discover-title="${titleAttr}" data-discover-section="games" data-game-title="${titleAttr}" data-rawg-id="${escAttr(String(item.id || ''))}" ${poster ? `style="background-image:url('${escAttr(poster)}')"` : ''} onclick="openGameMediaProfile(event, '${escAttr(String(item.id || ''))}', getGameMediaProfileSeed('${escAttr(String(item.id || ''))}'), this)">${getDiscoverFriendStackMarkup(title, 'games')}</div>
      <div class="discover-card-body">
        <div class="discover-card-title-row">
          <button class="discover-card-title discover-title-profile-btn game-title-profile-btn" type="button" onclick="openGameMediaProfile(event, ${item.id}, getGameMediaProfileSeed(${item.id}), this)">${escHtml(title)}${year ? ` (${year})` : ''}</button>
          ${renderBackloggdGameIcon(seed, 'game-discover-backloggd-icon')}
        </div>
        <div class="discover-card-overview">${escHtml(overview)}</div>
        <button class="discover-add-btn${alreadyAdded ? ' added' : ''}" data-discover-type="game" data-discover-id="${item.id}" data-discover-section="games" data-discover-title="${titleAttr}" title="${alreadyAdded ? 'Click to remove from your library' : ''}" onclick="${alreadyAdded ? removeClick : addClick}">${alreadyAdded ? getDiscoverLibraryButtonText(title, 'games') : '+ Add to Library'}</button>
      </div>
    </div>`;
  }).join('');
  requestAnimationFrame(() => {
    setupDiscoverSectionLimit(grid);
    refreshDiscoverFriendStacks();
  });
  // Lazy-fetch IGDB portrait covers for discovery game cards
  setTimeout(() => backfillIgdbDiscoverGameCovers(grid), 600);
}

// Fetch and apply IGDB/Twitch portrait covers to discovery game card posters.
// No single global lock: each grid can repair its own cards so concurrent discovery rows do not skip each other.
const IGDB_DISCOVER_COVER_IN_FLIGHT = new Set();
async function backfillIgdbDiscoverGameCovers(grid) {
  const posters = Array.from(grid ? grid.querySelectorAll('.discover-poster[data-media-type="game"]') : []);
  for (const poster of posters) {
    const title = poster.dataset.discoverTitle || poster.dataset.gameTitle || '';
    const rawgId = poster.dataset.rawgId || poster.dataset.mediaId || '';
    if (!title) continue;
    const key = `${rawgId}|${title.toLowerCase()}`;
    if (IGDB_DISCOVER_COVER_IN_FLIGHT.has(key)) continue;
    IGDB_DISCOVER_COVER_IN_FLIGHT.add(key);
    try {
      const seed = rawgId && typeof getGameMediaProfileSeed === 'function' ? getGameMediaProfileSeed(rawgId, {}) : {};
      const payload = { ...seed, title, name: seed.name || title, rawgId, id: rawgId };
      let cover = null;
      if (typeof forceHydrateScreenListGamePosterElement === 'function') {
        cover = await forceHydrateScreenListGamePosterElement(poster, payload);
      } else {
        const params = new URLSearchParams({ title, force: '1', strict: '1', t: String(Date.now()) });
        const res = await fetch('/api/igdb/cover?' + params.toString(), { cache: 'no-store' });
        const data = res.ok ? await res.json() : null;
        if (data?.ok && data.coverUrl) {
          poster.style.backgroundImage = `url('${data.coverUrl}')`;
          poster.style.backgroundPosition = 'top center';
          poster.dataset.igdbCoverApplied = '1';
          cover = data;
        }
      }
      if (cover?.coverUrl && rawgId && typeof setGameMediaProfileSeed === 'function') {
        const existing = getGameMediaProfileSeed(rawgId, {}) || {};
        setGameMediaProfileSeed(rawgId, { ...existing, title, name: existing.name || title, rawgId, id: rawgId, igdbCoverUrl: cover.coverUrl, cover: cover.coverUrl, poster: cover.coverUrl, image: cover.coverUrl, background_image: cover.coverUrl });
      }
    } catch (e) { /* silent */ }
    finally { IGDB_DISCOVER_COVER_IN_FLIGHT.delete(key); }
    await new Promise(r => setTimeout(r, 220));
  }
}

const DISCOVER_INITIAL_VISIBLE_COUNT = 6;
const DISCOVER_SHOW_MORE_STEP = 6;

function setupDiscoverSectionLimit(grid) {
  if (!grid) return;
  const cards = Array.from(grid.querySelectorAll('.discover-card'));
  const button = getDiscoverExpandButton(grid);
  if (!button) return;
  const limit = DISCOVER_INITIAL_VISIBLE_COUNT;
  let visibleCount = Number.parseInt(grid.dataset.visibleCount || '', 10);
  if (!Number.isFinite(visibleCount)) visibleCount = limit;
  visibleCount = Math.min(cards.length, Math.max(limit, visibleCount));
  grid.dataset.visibleCount = String(visibleCount);
  cards.forEach((card, index) => {
    card.classList.toggle('discover-hidden', index >= visibleCount);
  });
  button.style.display = cards.length > limit ? '' : 'none';
  const isAtEnd = cards.length > limit && visibleCount >= cards.length;
  button.textContent = isAtEnd ? 'Show less' : 'View all';
  button.classList.toggle('is-collapsing', isAtEnd);
}

function toggleDiscoverSection(gridId) {
  if (gridId === 'discover-friends-watching-grid') {
    openDiscoverFriendsWatchingPage();
    return;
  }
  // v549: View all always navigates to the full category page when supported,
  // matching the behavior of the section-title link.
  if (typeof DISCOVER_FULL_CATEGORY_GRID_IDS !== 'undefined'
    && Array.isArray(DISCOVER_FULL_CATEGORY_GRID_IDS)
    && DISCOVER_FULL_CATEGORY_GRID_IDS.includes(gridId)) {
    openDiscoverCategoryFullPage(gridId);
    return;
  }
  if (isDiscoverGridCountryFilterableNewRelease(gridId)) {
    openDiscoverCategoryFullPage(gridId);
    return;
  }
  // Fallback: legacy inline expand for grids without a full-page view
  const grid = document.getElementById(gridId);
  if (!grid) return;
  const limit = DISCOVER_INITIAL_VISIBLE_COUNT;
  const cards = Array.from(grid.querySelectorAll('.discover-card'));
  const current = Number.parseInt(grid.dataset.visibleCount || '', 10);
  const visibleCount = Number.isFinite(current) ? current : limit;
  const nextVisibleCount = visibleCount >= cards.length ? limit : visibleCount + DISCOVER_SHOW_MORE_STEP;
  grid.dataset.visibleCount = String(nextVisibleCount);
  setupDiscoverSectionLimit(grid);
  if (nextVisibleCount === limit) {
    grid.closest('.discover-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function jumpToDiscoverSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let discoverResizeTimer = null;
