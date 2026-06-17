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

async function runDiscoverSectionsInParallel(sections = []) {
  const results = await Promise.allSettled((sections || []).map(section => Promise.resolve().then(() => section.run())));
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') return;
    const section = sections[index] || {};
    console.error(`Discover row failed: ${section.label || section.gridId || 'unknown section'}`, result.reason);
    if (section.gridId) {
      renderDiscoverGridError(section.gridId, `${section.label || 'This discovery row'} could not load. It will try again automatically later.`);
    }
  });
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
        run: async () => renderFriendWatchingDiscoverCards(await fetchFriendWatchingDiscoverTitles(15), 'discover-friends-watching-grid', { row: true })
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

    await runDiscoverSectionsInParallel(sections);

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

async function hydrateTrendingTvAiringDetails(items = []) {
  const targets = (Array.isArray(items) ? items : [])
    .filter(item => item?.id && item.media_type === 'tv')
    .slice(0, 18);
  if (!targets.length) return items;

  await Promise.allSettled(targets.map(async item => {
    const key = String(item.id);
    let details = discoverTrendingTvDetailsCache.get(key);
    if (!details) {
      const res = await fetchTmdbProxy(`tv/${item.id}`, {});
      if (!res.ok) return;
      details = await res.json();
      discoverTrendingTvDetailsCache.set(key, details);
    }
    if (!details || typeof details !== 'object') return;
    item.last_air_date = details.last_air_date || item.last_air_date || '';
    item.next_episode_to_air = details.next_episode_to_air || item.next_episode_to_air || null;
    item.last_episode_to_air = details.last_episode_to_air || item.last_episode_to_air || null;
    item.status = details.status || item.status || '';
    item.in_production = typeof details.in_production === 'boolean' ? details.in_production : item.in_production;
  }));
  return items;
}

async function fetchTmdbWeeklyTrendingMedia(type = 'tv', options = {}) {
  const finalLimit = Math.max(1, Number(options.limit || 12) || 12);
  /* v571: 'mixed' fetches both movie + tv trending and ranks them together. */
  if (type === 'mixed') {
    const [movieItems, tvItems] = await Promise.all([
      fetchTmdbWeeklyTrendingMedia('movie', options).catch(() => []),
      fetchTmdbWeeklyTrendingMedia('tv', options).catch(() => [])
    ]);
    return [...movieItems, ...tvItems]
      .sort(compareDiscoverCalculatedScoreDesc)
      .slice(0, finalLimit);
  }
  const mediaType = type === 'movie' ? 'movie' : 'tv';
  const path = mediaType === 'movie' ? 'trending/movie/week' : 'trending/tv/week';
  /* v743: cap to 12 final titles, no show-more — fetch only 2 TMDB pages
     (~40 candidates) instead of 5 (~100). Smaller candidate pool means
     fewer OMDb enrichment requests. Final ranking now blends TMDB weekly
     rank, freshness, popularity, confidence, and rating quality. */
  const results = await fetchTmdbPages(path, {}, 2);
  const filtered = results
    .filter(item => {
      const title = mediaType === 'movie' ? (item.title || item.original_title || '') : (item.name || item.original_name || '');
      if (!item?.id || !item?.poster_path || !title) return false;
      /* v742: anime exclusion. Anime category only accepts anime; movie/tv
         categories must NOT include anime (they have their own section). */
      if (type === 'anime' && !isAnimeDiscoverCandidate(item)) return false;
      if (type !== 'anime' && isAnimeDiscoverCandidate(item)) return false;
      return true;
    })
    .slice(0, 30)
    .map((item, index, pool) => ({
      ...item,
      media_type: mediaType,
      __tmdbTrendIndex: index,
      __tmdbTrendTotal: pool.length
    }));
  if (mediaType === 'tv') await hydrateTrendingTvAiringDetails(filtered);
  await window.enrichItemsWithImdbRatings?.(filtered, mediaType);
  const ranked = (window.rankDiscoverTitles || (() => filtered))('trending', filtered, {
    mediaType,
    indexOf: item => Number(item?.__tmdbTrendIndex || 0)
  });
  return ranked
    .map(item => ({
      ...item,
      discoverContext: buildDiscoverTmdbContext('Weekly trending', item)
    }))
    .slice(0, finalLimit);
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

const DISCOVER_RANKING_CACHE_VERSION = 'v222';
const DISCOVER_CATEGORY_FULL_VISIBLE_LIMIT = 15;
const discoverTrendingTvDetailsCache = new Map();

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
  const ratingText = typeof window.formatDisplayTitleRating === 'function'
    ? window.formatDisplayTitleRating(item)
    : (Number(item.imdbRating || 0) > 0 ? (Number(item.imdbRating) / 2).toFixed(1) : '');
  const imdbVotes = Number(item.imdbVotes || 0);
  if (ratingText) parts.push(`${ratingText}/5`);
  if (imdbVotes > 0) parts.push(`${imdbVotes.toLocaleString()} votes`);
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
    .filter(item => hasUsableDiscoverReleaseItem(item) && (isAnimeDiscoverCandidate(item) === (type === 'anime')));
  await window.enrichItemsWithImdbRatings?.(candidates, type);
  const ranked = (window.rankDiscoverTitles || (() => candidates))('new', candidates, { mediaType: type });
  return ranked
    .map(item => ({
      ...item,
      discoverContext: buildDiscoverTmdbContext(`Released ${formatDiscoverReleaseDate(getDiscoverReleaseDate(item))}`, item)
    }))
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
  const fourYearsOutMs = Date.now() + 1460 * 24 * 60 * 60 * 1000;

  /* v10.165: Candidate discovery is now YouTube-driven, not TMDB-driven.
     We pull recent uploads from a whitelist of major studio YouTube
     channels (Marvel, Disney, Sony, Warner, Universal, Paramount,
     Netflix, HBO, A24, etc.), filter to videos whose YouTube title
     contains "trailer" or "teaser", extract the movie/show title,
     match it to TMDB for release-date + poster + metadata, and only
     keep titles not yet released within the next 4 years.

     Why: TMDB's `popularity` score has a tiny user base and is
     structurally biased against trailer-released titles (Avatar Aang
     scored 94.6 popularity with no trailer because fans refresh TMDB
     hunting for news; Spider-Man Brand New Day scored 27.1 despite a
     34M-view trailer because its fans are on YouTube). Studio uploads
     are the ground truth — if Sony Pictures uploaded a Spider-Man:
     Brand New Day trailer, that title belongs in Most Anticipated. */
  let detailed = [];
  let candidateDiscoverySource = 'studio-channels';

  if (typeof window.fetchAnticipatedCandidatesFromStudios === 'function') {
    try {
      const studioCandidates = await window.fetchAnticipatedCandidatesFromStudios({
        perChannelLimit: 50,
        maxReleaseDateMs: fourYearsOutMs
      });
      /* Annotate _mediaType the way the rest of the pipeline expects. */
      detailed = (studioCandidates || []).map(item => ({
        ...item,
        _mediaType: item._mediaType === 'movie' ? 'movie' : 'tv'
      }));
      /* Filter to anime if explicitly requested (TV with animation genre). */
      if (type === 'anime') {
        detailed = detailed.filter(item => Array.isArray(item.genre_ids) && item.genre_ids.includes(16));
      } else if (type === 'movie') {
        detailed = detailed.filter(item => item._mediaType === 'movie');
      } else if (type === 'tv') {
        detailed = detailed.filter(item => item._mediaType === 'tv');
      }
    } catch (e) {
      console.warn('[shelfd hype] studio-channel candidate discovery failed; falling back to TMDB:', e && e.message ? e.message : e);
    }
  }

  /* Safety net — if studio discovery returned nothing (worker
     unreachable, etc.), fall back to the v10.164 TMDB-popularity
     candidate pool so the page still works. Same window. */
  if (!detailed.length) {
    candidateDiscoverySource = 'tmdb-fallback';
    const tomorrow = toDiscoverIsoDate(addDiscoverDays(todayDate, 1));
    const fourYearsOut = toDiscoverIsoDate(addDiscoverDays(todayDate, 1460));
    const requests = [];
    if (type === 'movie' || type === 'mixed') {
      requests.push(fetchTmdbPages('discover/movie', {
        'primary_release_date.gte': tomorrow,
        'primary_release_date.lte': fourYearsOut,
        sort_by: 'popularity.desc',
        include_adult: 'false'
      }, pageCount).then(items => items.map(item => markDiscoverMediaType(item, 'movie'))));
    }
    if (type === 'tv' || type === 'mixed' || type === 'anime') {
      const tvParams = {
        'first_air_date.gte': tomorrow,
        'first_air_date.lte': fourYearsOut,
        sort_by: 'popularity.desc',
        include_adult: 'false'
      };
      if (type === 'anime') tvParams.with_genres = '16';
      requests.push(fetchTmdbPages('discover/tv', tvParams, pageCount)
        .then(items => items.map(item => markDiscoverMediaType(item, 'tv'))));
    }
    const combined = (await Promise.all(requests)).flat();
    const candidates = normalizeDiscoverTypedItems(combined, type)
      .filter(item => hasUsableDiscoverUpcomingItem(item) && (isAnimeDiscoverCandidate(item) === (type === 'anime')));

    /* v10.167: In `mixed` mode, balance the pool 50/50 between movies
       and TV by interleaving the two media-type lists. Previously we
       sorted the combined pool by TMDB popularity, which lets one
       media type dominate when its TMDB popularity is systematically
       higher (Netflix series rank way higher than movies on TMDB
       because Netflix's audience over-indexes there). This guarantees
       at least ~30 movies + 30 TV shows reach the YouTube-hype
       scoring stage even when the YouTube discovery path is quota-
       locked and we fall back to TMDB. */
    let pool;
    if (type === 'mixed') {
      const movies = candidates.filter(c => c._mediaType === 'movie')
        .sort((a, b) => Number(b.popularity || 0) - Number(a.popularity || 0))
        .slice(0, 40);
      const shows = candidates.filter(c => c._mediaType !== 'movie')
        .sort((a, b) => Number(b.popularity || 0) - Number(a.popularity || 0))
        .slice(0, 40);
      pool = [];
      const maxLen = Math.max(movies.length, shows.length);
      for (let i = 0; i < maxLen; i += 1) {
        if (i < movies.length) pool.push(movies[i]);
        if (i < shows.length) pool.push(shows[i]);
      }
      pool = pool.slice(0, 60);
    } else {
      pool = candidates
        .slice()
        .sort((a, b) => Number(b.popularity || 0) - Number(a.popularity || 0))
        .slice(0, 60);
    }
    /* Hydrate with videos for the YouTube hype scorer. */
    detailed = await Promise.all(pool.map(async (candidate) => {
      const detailType = candidate._mediaType === 'movie' ? 'movie' : 'tv';
      try {
        const res = await fetchTmdbProxy(`${detailType}/${candidate.id}`, { append_to_response: 'videos' });
        if (!res.ok) return candidate;
        const d = await res.json();
        return { ...candidate, videos: d.videos || { results: [] }, production_companies: d.production_companies || candidate.production_companies };
      } catch (e) { return candidate; }
    }));
  }

  /* YouTube hype enrichment — async, batched. Returns per-item
     youtubeStats + youtubeScore (0–600) + youtubeScoreNormalized (0–100). */
  let youtubeResults = detailed.map(() => ({ youtubeStats: null, youtubeScore: 0, youtubeScoreNormalized: 0 }));
  if (typeof window.fetchYoutubeHypeForItems === 'function') {
    try {
      youtubeResults = await window.fetchYoutubeHypeForItems(detailed);
    } catch (e) {
      console.warn('[shelfd hype] YouTube enrichment failed; falling back to TMDB-only ranking:', e && e.message ? e.message : e);
    }
  }

  /* Pedigree sub-signals (TMDB-derived). Per project memory the full
     spec includes cast star power and franchise lookup; v1 ships with
     just release proximity + studio prestige to keep latency low.
     Future enhancement: add OMDb-backed franchise signal + TMDB
     person.popularity-summed cast star power. */
  const STUDIO_WHITELIST_HIGH = new Set([
    'Marvel Studios', 'Walt Disney Pictures', 'Pixar', 'Pixar Animation Studios',
    'Studio Ghibli', 'A24', 'Warner Bros. Pictures', 'Warner Bros.',
    'Universal Pictures', 'Paramount Pictures', 'Lucasfilm Ltd.', 'Lucasfilm',
    'DC Studios', 'DC Films', 'Legendary Pictures', 'Legendary Entertainment',
    'Sony Pictures', 'Columbia Pictures', '20th Century Studios', '20th Century Fox',
    'Netflix', 'HBO', 'Apple Studios', 'Apple Original Films', 'Amazon MGM Studios',
    'Bad Robot', 'Blumhouse Productions', 'Annapurna Pictures', 'Focus Features',
    'Searchlight Pictures', 'Bona Film Group', 'CJ Entertainment',
    'Toho Co., Ltd.', 'Toho', 'Madhouse', 'MAPPA', 'WIT Studio',
    'ufotable', 'Bones', 'Production I.G', 'Trigger', 'Kyoto Animation'
  ]);

  function computePedigreeRaw(item) {
    const releaseDate = getDiscoverReleaseDate(item);
    const daysUntilRelease = releaseDate
      ? Math.max(0, (Date.parse(`${String(releaseDate).slice(0, 10)}T00:00:00`) - Date.now()) / (1000 * 60 * 60 * 24))
      : 365;
    const releaseProximity = Math.max(0, 100 * (1 - daysUntilRelease / 365));
    const companies = Array.isArray(item.production_companies) ? item.production_companies : [];
    const hasWhitelistedStudio = companies.some(c => c && STUDIO_WHITELIST_HIGH.has(String(c.name || '').trim()));
    const studioPrestige = hasWhitelistedStudio ? 100 : 0;
    return { releaseProximity, studioPrestige };
  }

  const pedigreeRaw = detailed.map(computePedigreeRaw);

  /* TMDB raw signals */
  const tmdbRaw = detailed.map(item => ({
    logPopularity: Math.log10(Math.max(0, Number(item.popularity || 0)) + 1),
    logVotes: Math.log10(Math.max(0, Number(item.vote_count || 0)) + 1)
  }));

  /* Normalize each sub-signal to 0–100 across the batch. */
  function normalizeBatch(values) {
    let max = 0;
    for (const v of values) {
      const n = Number(v || 0);
      if (Number.isFinite(n) && n > max) max = n;
    }
    if (max <= 0) return values.map(() => 0);
    return values.map(v => (Number(v || 0) / max) * 100);
  }

  const nReleaseProximity = normalizeBatch(pedigreeRaw.map(p => p.releaseProximity));
  const nStudioPrestige = normalizeBatch(pedigreeRaw.map(p => p.studioPrestige));
  const nLogPopularity = normalizeBatch(tmdbRaw.map(t => t.logPopularity));
  const nLogVotes = normalizeBatch(tmdbRaw.map(t => t.logVotes));

  /* Compose Hype Score.
     v10.164: rebalanced weights based on the Spider-Man Brand New Day
     diagnosis. TMDB popularity is structurally biased AGAINST trailer-
     released titles (Avatar Aang scores 94.6 because fans refresh
     TMDB for news; Spider-Man scores 27.1 because its fans are
     watching the trailer on YouTube instead). Dropping the TMDB weight
     to 0 and giving its share to YouTube. Final:

         HYPE = 0.80 × YouTube + 0.20 × Pedigree
  */
  const scored = detailed.map((item, i) => {
    const pedigreeScore = (nReleaseProximity[i] + nStudioPrestige[i]) / 2;
    const tmdbScore = (nLogPopularity[i] + nLogVotes[i]) / 2;
    const youtubeScoreNormalized = Number(youtubeResults[i]?.youtubeScoreNormalized || 0);
    const hypeScore = 0.80 * youtubeScoreNormalized
                    + 0.20 * pedigreeScore;
    return {
      ...item,
      __hypeScore: hypeScore,
      __hypeBreakdown: {
        youtube: youtubeScoreNormalized,
        pedigree: pedigreeScore,
        tmdb: tmdbScore, // tracked for debugging but no longer weighted
        youtubeSource: youtubeResults[i]?.youtubeSource || 'none',
        youtubeStats: youtubeResults[i]?.youtubeStats || null,
        youtubeSubSignals: youtubeResults[i]?.youtubeScoreBreakdown || null,
        pedigreeRaw: pedigreeRaw[i],
        tmdbRaw: tmdbRaw[i]
      },
      calculatedScore: hypeScore
    };
  });

  /* Log discovery source + top 10 so we can verify the new pipeline
     is actually pulling candidates from YouTube studio channels (not
     falling back to TMDB) and which titles are scoring highest. */
  try {
    const top10 = scored
      .slice()
      .sort((a, b) => Number(b.__hypeScore || 0) - Number(a.__hypeScore || 0))
      .slice(0, 10)
      .map(item => ({
        title: item.title || item.name || '?',
        hype: Math.round(item.__hypeScore * 10) / 10,
        yt: Math.round(item.__hypeBreakdown.youtube * 10) / 10,
        ped: Math.round(item.__hypeBreakdown.pedigree * 10) / 10,
        trailerSource: item.__hypeBreakdown.youtubeSource,
        trailerCount: item.__hypeBreakdown.youtubeStats?.trailerCount || 0,
        totalViews: item.__hypeBreakdown.youtubeStats?.totalViews || 0
      }));
    console.info(`[shelfd hype v10.165] Most Anticipated — discovery=${candidateDiscoverySource}, candidates=${detailed.length}, top 10:`, top10);
  } catch (e) {}

  scored.sort((a, b) => Number(b.__hypeScore || 0) - Number(a.__hypeScore || 0));

  return scored
    .map(item => ({
      ...item,
      discoverContext: buildDiscoverTmdbContext(`Releases ${formatDiscoverReleaseDate(getDiscoverReleaseDate(item))}`, item)
    }))
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
  /* v673: Releasing Soon — date closeness + TMDB popularity. IMDb rating is
     not a meaningful signal for unreleased titles. */
  const ranked = (window.rankDiscoverTitles || (() => candidates))('releasingSoon', candidates, { mediaType: type });
  return ranked
    .map(item => ({
      ...item,
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
    (isAnimeDiscoverCandidate(item) === (type === 'anime'))
  );
  await window.enrichItemsWithImdbRatings?.(candidates, type);
  /* v673: Bayesian rating handles low-vote-count fairness inside the
     ranker, so the post-rank quality floor is more permissive. */
  const ranked = (window.rankDiscoverTitles || (() => candidates))('yearsBest', candidates, { mediaType: type });
  return ranked
    .filter(item => Number(item.vote_average || 0) >= 6.0)
    .map(item => ({
      ...item,
      discoverContext: buildDiscoverTmdbContext(`${year} release`, item)
    }))
    .slice(0, DISCOVER_LIMIT);
}

async function fetchDiscoverPopularMedia(mediaType = 'tv', options = {}) {
  const type = getDiscoverMediaQueryType(mediaType);
  const finalLimit = Math.max(1, Number(options.limit || 12) || 12);
  /* v571: combine movie+tv for the unified Movies & TV hub */
  if (type === 'mixed') {
    const [movieItems, tvItems] = await Promise.all([
      fetchDiscoverPopularMedia('movie', options).catch(() => []),
      fetchDiscoverPopularMedia('tv', options).catch(() => [])
    ]);
    return [...movieItems, ...tvItems]
      .sort(compareDiscoverCalculatedScoreDesc)
      .slice(0, finalLimit);
  }
  const isMovie = type === 'movie';
  const path = isMovie ? 'discover/movie' : 'discover/tv';
  /* v741: time-windowed Popular = released in the last 30 days, sorted by
     engagement-sum (in 21-discover-ranking.js scorePopular). The TMDB
     date filter trims the candidate pool to recent releases; the engagement
     sort then surfaces the most-engaged of those. */
  const today = new Date();
  const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fmt = d => d.toISOString().slice(0, 10);
  const params = {
    sort_by: 'popularity.desc',
    include_adult: 'false',
    [isMovie ? 'primary_release_date.gte' : 'first_air_date.gte']: fmt(monthAgo),
    [isMovie ? 'primary_release_date.lte' : 'first_air_date.lte']: fmt(today)
  };
  if (type === 'anime') params.with_genres = '16';
  /* v743: 2 pages instead of 5 — top 12 by imdbVotes still surface from
     the smaller pool, and far fewer OMDb enrichment calls per Discover load. */
  const items = await fetchTmdbPages(path, params, 2);
  const candidates = normalizeDiscoverTypedItems(items, isMovie ? 'movie' : 'tv')
    .filter(item => hasUsableDiscoverReleaseItem(item) && (isAnimeDiscoverCandidate(item) === (type === 'anime')))
    .slice(0, 30);
  await window.enrichItemsWithImdbRatings?.(candidates, type);
  const ranked = (window.rankDiscoverTitles || (() => candidates))('popular', candidates, { mediaType: type });
  return ranked
    .map(item => ({
      ...item,
      discoverContext: buildDiscoverTmdbContext('Popular this month', item)
    }))
    .slice(0, finalLimit);
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
    .filter(item => item.poster_path && getDiscoverSortTitle(item) && item.overview && (isAnimeDiscoverCandidate(item) === (type === 'anime')));
  await window.enrichItemsWithImdbRatings?.(candidates, type);
  /* v673: Top Rated uses Bayesian rating + IMDb log-votes inside the ranker
     so a 9.4 with 1k votes can't beat a 9.1 with 2M votes. */
  const ranked = (window.rankDiscoverTitles || (() => candidates))('topRated', candidates, { mediaType: type });
  return ranked
    .map(item => ({
      ...item,
      discoverContext: buildDiscoverTmdbContext('', item)
    }))
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
    .filter(item => hasUsableDiscoverReleaseItem(item) && !isAnimeDiscoverCandidate(item));
  await window.enrichItemsWithImdbRatings?.(candidates, 'movie');
  /* v673: In Theaters — current release relevance + TMDB popularity dominate.
     v742: anime excluded — anime has its own discover section. */
  const ranked = (window.rankDiscoverTitles || (() => candidates))('inTheaters', candidates, { mediaType: 'movie' });
  return ranked
    .map(item => ({
      ...item,
      discoverContext: `In theaters · Released ${formatDiscoverReleaseDate(getDiscoverReleaseDate(item))}`
    }))
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
  const allGems = normalizeDiscoverTypedItems((await Promise.all(requests)).flat(), type)
    .filter(item => item.poster_path && getDiscoverSortTitle(item) && item.overview && (isAnimeDiscoverCandidate(item) === (type === 'anime')));
  await window.enrichItemsWithImdbRatings?.(allGems, type);
  /* v673: Hidden Gems — Bayesian rating + sweet-spot vote count + inverse
     popularity (run inside the ranker).
     v742: anime exclusion — only anime category accepts anime titles. */
  const ranked = (window.rankDiscoverTitles || (() => allGems))('hiddenGems', allGems, { mediaType: type });
  return ranked
    .map(item => ({
      ...item,
      discoverContext: buildDiscoverTmdbContext('', item)
    }))
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
  if (section === 'movies' && item.status === 'planned') return 'Planning';
  if (item.status === 'watching') return section === 'anime' ? 'Watching anime' : 'Watching';
  if (item.status === 'planned') return 'Planning';
  return item.status ? item.status.charAt(0).toUpperCase() + item.status.slice(1) : 'Planning';
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
    const rowItems = await fetchFriendWatchingDiscoverTitles(15);
    if (mainGrid && isDiscoverFriendWatchingGridVisible()) {
      renderFriendWatchingDiscoverCards(rowItems, 'discover-friends-watching-grid', { row: true });
    }
    if (fullGridVisible) {
      const fullItems = rowItems.length >= 30 ? rowItems : await fetchFriendWatchingDiscoverTitles(30);
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
  if (typeof DISCOVER_FRIENDS_WATCHING_DISABLED !== 'undefined' && DISCOVER_FRIENDS_WATCHING_DISABLED) return;
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
  const itemDate = Date.parse(item.lastEditedAt || item.dateLastEdited || item.dateModified || item.dateAdded || item.updatedAt || 0) || 0;
  const isRecentFinish = status === 'watched' && itemDate > 0 && (Date.now() - itemDate) <= SHELFD_FRIEND_WATCHING_RECENT_FINISH_MS;
  /* v926: section-specific filter rules:
     - shows / anime: only currently-watching titles (status='watching').
       Planned and old watches are excluded so the row reflects what friends
       are actively in the middle of right now.
     - movies: only recently-watched (status='watched' within the recent-
       finish window). Movies don't have an ongoing "watching" phase, so
       recent watches are the equivalent signal.
     'planned' is excluded across all sections. */
  if (section === 'movies') {
    if (!isRecentFinish) return;
  } else {
    // shows / anime
    if (status !== 'watching') return;
  }

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

/* v11.305: "What Your Friends Are Watching" temporarily disabled on the
   Movies/TV Discovery hub. Flip DISCOVER_FRIENDS_WATCHING_DISABLED back to
   false (and remove the display:none on its section in index.html) to restore.
   The DOM row is hidden, the fetch short-circuits (no network), and the
   six-hour refresh / realtime listeners are skipped. */
const DISCOVER_FRIENDS_WATCHING_DISABLED = true;

async function fetchFriendWatchingDiscoverTitles(limit = DISCOVER_LIMIT) {
  if (DISCOVER_FRIENDS_WATCHING_DISABLED) return [];
  discoverFriendWatchingMessage = 'No friend planning titles found yet.';
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
        /* v10.387: section-aware fan-out replaces the legacy single-doc read.
           Returns normalized list-data so we skip the parse step. */
        const listData = await loadWatchlistDataForUid(uid, { sections: ['movies', 'shows', 'anime'] });
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


/* v679: Weighted popularity ranking for the anime "Popular" grid.
   Two signals only: members (heaviest) + score.

   Weights:
     members → 70 %  (audience reach — core "popular" signal)
     score   → 30 %  (quality gate — prevents tracking-only filler)

   Both are min-max normalised within the fetched pool so an outlier
   like One Piece doesn't collapse the relative scale.
*/
function rankAnimeByWeightedPopularity(pool = [], limit = 24) {
  if (!pool.length) return [];
  const WEIGHT_MEMBERS = 0.70;
  const WEIGHT_SCORE   = 0.30;

  const signals = pool.map(a => ({
    item:    a,
    members: Number(a?.members || 0),
    score:   Number(a?.score   || 0)
  }));

  function minMaxNorm(arr, key) {
    const vals = arr.map(s => s[key]);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min;
    if (range === 0) arr.forEach(s => { s[`${key}N`] = 1; });
    else arr.forEach(s => { s[`${key}N`] = (s[key] - min) / range; });
  }
  minMaxNorm(signals, 'members');
  minMaxNorm(signals, 'score');

  return signals
    .map(s => ({
      item:      s.item,
      composite: s.membersN * WEIGHT_MEMBERS
               + s.scoreN   * WEIGHT_SCORE
    }))
    .sort((a, b) => b.composite - a.composite)
    .slice(0, limit)
    .map(s => s.item);
}

async function fetchAnimeDiscoverTitles(kind) {
  /* v654: Every anime Discover row is now backed by Jikan (api.jikan.moe).
     TMDB is no longer consulted for anime listings. Mapping each Jikan
     response into a TMDB-compatible shape (mapItem) keeps the existing
     card renderers untouched. */
  const J = window.JikanAnime;
  if (!J) return [];
  let raw = [];
  try {
    if (kind === 'new') {
      raw = await J.seasonNow(DISCOVER_LIMIT);
    } else if (kind === 'anticipated') {
      raw = await J.seasonUpcoming(DISCOVER_LIMIT);
    } else if (kind === 'trending') {
      raw = await J.topAnime('airing', 'tv', DISCOVER_LIMIT);
    } else if (kind === 'popular') {
      /* v678: Custom weighted popularity ranking. Members carries the heaviest
         weight because it represents raw audience reach — how many people care
         enough to track this show, regardless of whether they've rated it yet.
         Score and favorites are secondary signals.

         Formula (all signals normalised 0-1 within the fetched pool):
           composite = members   × 0.65
                     + score     × 0.20
                     + favorites × 0.15

         We fetch 3× the display limit so the re-ranking has enough depth
         to surface genuinely popular titles that Jikan's own popularity rank
         might not surface at position N. */
      const pool = await J.topAnime('bypopularity', 'tv', DISCOVER_LIMIT * 3);
      raw = rankAnimeByWeightedPopularity(pool || [], DISCOVER_LIMIT);
    } else if (kind === 'rated') {
      raw = await J.topAnime('', 'tv', DISCOVER_LIMIT);  /* default = top by score */
    } else if (kind === 'years-best') {
      /* Approximation: top airing or recently completed, then filter to current year */
      const thisYear = new Date().getFullYear();
      const top = await J.topAnime('', 'tv', DISCOVER_LIMIT * 2);
      raw = (top || []).filter(a => Number(a?.year || 0) === thisYear).slice(0, DISCOVER_LIMIT);
      if (!raw.length) raw = top.slice(0, DISCOVER_LIMIT);
    } else {
      raw = await J.topAnime('bypopularity', 'tv', DISCOVER_LIMIT);
    }
  } catch (e) {
    console.warn('[Jikan] anime discover row failed:', kind, e);
    return [];
  }
  return (raw || []).map(J.mapItem).filter(Boolean);
}

async function loadAnimeDiscover(force = false) {
  if (animeDiscoverLoading || (animeDiscoverLoaded && !force && isDiscoverMemoryFresh(animeDiscoverLoadedAt))) return;
  animeDiscoverLoading = true;
  renderAnimeDiscoverLoading();
  try {
    /* v11.312: Seasonal Anime is the default subtab. When it's active, apply
       its UI state (body class + season buttons/labels) and load it FIRST so
       the visible grid fills quickly; the Top Anime rows below still preload
       so the Top tab is ready when the user switches to it. */
    if (activeAnimeSubtab === 'seasonal') {
      document.body.classList.add('anime-subtab-seasonal');
      document.querySelectorAll('.anime-discover-subtab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.animeSubtab === 'seasonal');
      });
      if (!activeAnimeSeasonalSeason) {
        const current = getCurrentAnimeSeason();
        activeAnimeSeasonalYear = current.year;
        activeAnimeSeasonalSeason = current.season;
        updateAnimeSeasonalSeasonLabels(current.year);
      } else {
        updateAnimeSeasonalSeasonLabels(activeAnimeSeasonalYear);
      }
      syncAnimeSeasonalActiveButtons();
      try { await loadAnimeSeasonal(); } catch (e) { console.error('Anime seasonal default load failed:', e); }
    }
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

/* v732: TMDB person search — used by the search page's Actors filter chip. */
async function fetchTmdbPersonSearchResults(query) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return [];
  try {
    const res = await fetchTmdbProxy('search/person', { query: cleanQuery, include_adult: 'false', page: '1' });
    if (!res.ok) return [];
    const json = await res.json();
    const results = Array.isArray(json?.results) ? json.results : [];
    /* Filter out people without a name AND without a photo — they're useless
       to display. Sort by TMDB popularity (their primary search relevance
       signal for people). */
    return results
      .filter(p => p && p.id && p.name)
      .sort((a, b) => Number(b.popularity || 0) - Number(a.popularity || 0));
  } catch (e) {
    return [];
  }
}
window.fetchTmdbPersonSearchResults = fetchTmdbPersonSearchResults;

function collectDiscoverUniversalTmdbDetailAliases(item = {}, details = {}) {
  const aliases = [];
  collectDiscoverUniversalAliasValues([
    item.title,
    item.name,
    item.original_title,
    item.original_name,
    details.title,
    details.name,
    details.original_title,
    details.original_name,
    details.alternative_titles?.titles,
    details.alternative_titles?.results,
    details.translations?.translations
  ], aliases);
  const canonicalKeys = new Set([
    normalizeDiscoverUniversalRankText(item.title || item.name || ''),
    normalizeDiscoverUniversalRankText(item.original_title || item.original_name || '')
  ].filter(Boolean));
  const seen = new Set();
  return aliases.filter(value => {
    const key = normalizeDiscoverUniversalRankText(value);
    if (!key || canonicalKeys.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function hydrateDiscoverUniversalTmdbAliases(items = []) {
  const candidates = (Array.isArray(items) ? items : [])
    .filter(item => item && item.id && (item.media_type === 'movie' || item.media_type === 'tv'))
    .slice(0, 8);
  if (!candidates.length) return;
  await Promise.allSettled(candidates.map(async item => {
    const type = item.media_type;
    const res = await fetchTmdbProxy(`${type}/${item.id}`, { append_to_response: 'alternative_titles,translations' });
    if (!res.ok) return;
    const details = await res.json().catch(() => null);
    if (!details) return;
    const aliases = collectDiscoverUniversalTmdbDetailAliases(item, details);
    if (aliases.length) item.__shelfdAliases = aliases;
    if (!item.overview && details.overview) item.overview = details.overview;
    if (!item.release_date && details.release_date) item.release_date = details.release_date;
    if (!item.first_air_date && details.first_air_date) item.first_air_date = details.first_air_date;
    if (!item.vote_count && details.vote_count) item.vote_count = details.vote_count;
    if (!item.popularity && details.popularity) item.popularity = details.popularity;
  }));
}

async function fetchTmdbSearchResults(query, options = {}) {
  /* v739: `strictPrefix` (default true) drops every result that doesn't
     prefix-match the query — useful for the discover hub where the user
     expects laser-focus on what they typed. The bottom-nav search page
     calls this with strictPrefix=false because it has its own relevance
     scoring + popularity boost and needs the wider result pool so popular
     titles like "Marvel's Spider-Man" aren't pre-filtered out before they
     can be ranked. */
  const strictPrefix = options.strictPrefix !== false;
  const queryVariants = strictPrefix ? [String(query || '').trim()] : getDiscoverUniversalSearchQueryVariants(query);
  const searchRequests = [];
  queryVariants.forEach((searchQuery, variantIndex) => {
    const pageCount = strictPrefix || variantIndex === 0 ? DISCOVER_PAGE_COUNT : 1;
    for (let page = 1; page <= pageCount; page += 1) {
      searchRequests.push({ searchQuery, page });
    }
  });
  const settled = await Promise.allSettled(searchRequests.map(async ({ searchQuery, page }) => {
    const res = await fetchTmdbProxy('search/multi', { query: searchQuery, page: String(page) });
    if (!res.ok) throw new Error(`TMDB search request failed: ${res.status}`);
    const json = await res.json();
    return (json.results || []).map(item => ({ ...item, __shelfdSearchQueryVariant: searchQuery }));
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
  const filtered = strictPrefix ? preferDiscoverUniversalPrefixMatches(items, query) : items;
  /* v740: when !strictPrefix (search page), sort by raw popularity so the
     20-item slice downstream doesn't kill popular partial-matches. The
     search page does its own normalize-relevance + popularity ranking;
     this just guarantees popular items aren't pre-filtered to oblivion. */
  /* v934: always use the unified scorer (text match → recency → popularity).
     The old !strictPrefix branch sorted by raw vote_count + popularity first,
     which bypassed recency entirely and buried new releases. */
  const ranked = filtered
    .sort((a, b) => {
      const scoreCompare = scoreDiscoverUniversalTmdbResult(b, query) - scoreDiscoverUniversalTmdbResult(a, query);
      if (scoreCompare) return scoreCompare;
      return String((a.title || a.name || '')).localeCompare(String(b.title || b.name || ''), undefined, { sensitivity: 'base' });
    })
    .slice(0, strictPrefix ? DISCOVER_LIMIT : 160);
  if (!strictPrefix) {
    await hydrateDiscoverUniversalTmdbAliases(ranked);
    ranked.sort((a, b) => {
      const scoreCompare = scoreDiscoverUniversalTmdbResult(b, query) - scoreDiscoverUniversalTmdbResult(a, query);
      if (scoreCompare) return scoreCompare;
      return String((a.title || a.name || '')).localeCompare(String(b.title || b.name || ''), undefined, { sensitivity: 'base' });
    });
  }
  return ranked;
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
  grid.innerHTML = '<div class="discover-message">Searching anime on MyAnimeList...</div>';
  try {
    /* v654: Anime search now goes exclusively through Jikan (api.jikan.moe).
       TMDB is no longer consulted for anime discovery. The result objects
       are mapped to a TMDB-compatible shape so the existing renderer keeps
       working — see js/20-jikan-anime.js. */
    const raw = await window.JikanAnime?.searchAnime(query, 24);
    const items = (raw || []).map(window.JikanAnime?.mapItem).filter(Boolean);
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

async function fetchRawgSearchResults(query, options = {}) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return [];
  /* v930: IGDB is now primary, RAWG is fallback. fetchMergedGameSearchResults
     (in 07-add-shelf-import-search.js) runs both in parallel, dedupes by name
     (IGDB wins), and ranks by: text-match > popularity > recency. The old
     multi-page RAWG approach is replaced — IGDB has better coverage of recent
     and niche titles (e.g. MLB The Show 2026). */
  if (typeof window.fetchMergedGameSearchResults === 'function') {
    const limit = options.strictPrefix !== false ? DISCOVER_LIMIT : 100;
    const merged = await window.fetchMergedGameSearchResults(cleanQuery, limit);
    return merged.map(item => ({
      ...item,
      calculatedScore: item._score || 0,
      discoverContext: buildGameDiscoverContext(item)
    }));
  }
  /* Legacy fallback if helper not loaded yet */
  const settled = await Promise.allSettled([
    fetchRawgPages({ search: cleanQuery }, DISCOVER_PAGE_COUNT, 90),
    fetchRawgPages({ search: cleanQuery, search_precise: 'true' }, 2, 60)
  ]);
  return mergeDiscoverUniversalSearchItems(
    settled.filter(r => r.status === 'fulfilled').map(r => r.value || [])
  ).slice(0, DISCOVER_LIMIT);
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
let discoverUniversalSearchSource = 'movie';
let discoverUniversalSearchTimer = null;
let discoverUniversalSearchToken = 0;
let discoverUniversalSearchFilterState = null;
let shelfdSearchFilterState = null;
let discoverUniversalSearchDefaultLoading = false;
const DISCOVER_UNIVERSAL_SEARCH_DEBOUNCE_MS = 90;
const DISCOVER_UNIVERSAL_SEARCH_DEFAULT_LIMIT = 21;

function normalizeDiscoverUniversalSearchSource(source = '') {
  const key = String(source || '').trim().toLowerCase();
  if (!key || key === 'all' || key === 'all-media' || key === 'all_media' || key === 'tmdb') return 'all';
  if (key === 'gaming' || key === 'games' || key === 'game' || key === 'rawg') return 'rawg';
  if (key === 'anime') return 'anime';
  if (key === 'music') return 'music';
  if (key === 'actor' || key === 'actors' || key === 'person' || key === 'people') return 'person';
  if (key === 'movies' || key === 'movie') return 'movie';
  if (key === 'tv' || key === 'shows' || key === 'show') return 'tv';
  return 'all';
}

function getDiscoverUniversalSearchPlaceholder(source = discoverUniversalSearchSource) {
  if (source === 'all') return 'Search everything';
  if (source === 'rawg') return 'Search games';
  if (source === 'anime') return 'Search anime';
  if (source === 'music') return 'Search music';
  if (source === 'person') return 'Search actors';
  if (source === 'movie') return 'Search movies';
  if (source === 'tv') return 'Search TV shows';
  return 'Search everything';
}

function getDiscoverUniversalSearchFilterGridId(source = discoverUniversalSearchSource) {
  const normalized = normalizeDiscoverUniversalSearchSource(source);
  if (normalized === 'movie') return 'discover-movie-universal-search-grid';
  if (normalized === 'tv') return 'discover-tv-universal-search-grid';
  if (normalized === 'anime') return 'anime-discover-universal-search-grid';
  return '';
}

function isDiscoverUniversalSearchFilterable(source = discoverUniversalSearchSource) {
  return ['movie', 'tv'].includes(normalizeDiscoverUniversalSearchSource(source));
}

function getDefaultDiscoverUniversalSearchSource() {
  return 'movie';
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
  const filterable = isDiscoverUniversalSearchFilterable();
  const count = filterable ? getDiscoverUniversalSearchFilterCount() : 0;
  if (btn) {
    btn.style.display = filterable ? 'inline-flex' : 'none';
    btn.classList.toggle('has-active-filter', !!count);
    btn.setAttribute('aria-label', count ? `Filter Discovery search. ${count} active` : 'Filter Discovery search');
    const label = btn.querySelector('.discover-universal-search-filter-label');
    if (label) label.textContent = count ? `Filter ${count}` : 'Filter';
  }
  document.querySelectorAll('#discover-search-preset-stack .shelfd-search-preset-filter-btn').forEach(presetBtn => {
    presetBtn.style.display = filterable ? 'inline-flex' : 'none';
    presetBtn.classList.toggle('has-active-filter', !!count);
    presetBtn.setAttribute('aria-label', count ? `Filter Discovery search. ${count} active` : 'Filter Discovery search');
    const presetLabel = presetBtn.querySelector('span');
    if (presetLabel) presetLabel.textContent = count ? `Filter ${count}` : 'Filter';
  });
  if (typeof window.updateShelfdSearchFilterButtonState === 'function') {
    try { window.updateShelfdSearchFilterButtonState(); } catch (_) {}
  }
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
        <button class="discover-universal-search-tab" type="button" data-discover-search-source="movie" onclick="switchDiscoverUniversalSearchSource('movie')">Movies</button>
        <button class="discover-universal-search-tab" type="button" data-discover-search-source="tv" onclick="switchDiscoverUniversalSearchSource('tv')">TV Shows</button>
        <button class="discover-universal-search-tab" type="button" data-discover-search-source="anime" onclick="switchDiscoverUniversalSearchSource('anime')">Anime</button>
        <button class="discover-universal-search-tab" type="button" data-discover-search-source="rawg" onclick="switchDiscoverUniversalSearchSource('rawg')">Games</button>
        <button class="discover-universal-search-tab" type="button" data-discover-search-source="music" onclick="switchDiscoverUniversalSearchSource('music')">Music</button>
      </div>
      <div class="discover-universal-search-divider" aria-hidden="true"></div>
      <div class="discover-universal-search-body">
        <div id="discover-universal-search-grid" class="discover-grid"></div>
      </div>
    </div>`;
  overlay.addEventListener('click', event => {
    if (event.target === overlay) return;
  });
  document.body.appendChild(overlay);
  const searchGrid = overlay.querySelector('#discover-universal-search-grid');
  if (searchGrid) {
    searchGrid.addEventListener('click', event => {
      if (event.target?.closest?.('.shelfd-search-row')) {
        closeDiscoverUniversalSearch(true);
      }
    }, true);
  }
  attachDiscoverUniversalSearchSwipeHandlers(overlay);
  return overlay;
}


let discoverUniversalSearchSwipeState = null;

/* v10.215: pull-down anywhere on the universal search page to dismiss it.
   Previously only the notch + header acted as drag handles. Now the whole
   panel is a drag surface, but we stay scroll-aware:
     - drags starting in the scrollable body only activate when body.scrollTop
       is at the top AND the user is pulling DOWN. otherwise the native body
       scroll handles it (so users can still scroll results normally).
     - drags starting on notch/header/tabs/subtitle/divider activate immediately
       (no scroll under those zones, so no conflict).
     - vertical-vs-horizontal gate prevents activating during horizontal swipes
       (tab scrolling, future swipe gestures, etc).
   Activation thresholds are small (4px from handles, 8px from body) so it
   feels immediate without firing on accidental taps. Close threshold matches
   prior behavior: 86px distance OR >0.55 px/ms velocity, with an animated
   snap-back via the existing .discover-universal-search-swipe-cancel class. */
function attachDiscoverUniversalSearchSwipeHandlers(overlay) {
  if (!overlay || overlay.dataset.swipeReady === '1') return;
  /* v10.920: Discovery top-search is a full navigation page now. Keep
     explicit back/close controls, but remove pull-down dismissal so the
     page and every preset subpage cannot be accidentally swiped away. */
  overlay.dataset.swipeReady = '1';
  overlay.dataset.swipeDismiss = 'disabled';
  discoverUniversalSearchSwipeState = null;
  overlay.classList.remove('discover-universal-search-dragging', 'discover-universal-search-swipe-cancel');
  overlay.style.transform = '';
  return;
  /* Legacy pull-down dismiss wiring kept below as reference only. */
  /* eslint-disable no-unreachable */
  overlay.dataset.swipeReady = '1';
  const panel = overlay.querySelector('.discover-universal-search-panel');
  const body = overlay.querySelector('.discover-universal-search-body');
  if (!panel) return;

  function startedInScrollableBody(target) {
    return !!(body && target && body.contains(target));
  }
  function bodyScrolledToTop() {
    return !body || body.scrollTop <= 0;
  }

  const startSwipe = (point, target) => {
    if (!overlay.classList.contains('open')) return;
    discoverUniversalSearchSwipeState = {
      startY: point.clientY,
      startX: point.clientX,
      currentY: point.clientY,
      startTime: performance.now(),
      active: false,
      fromBody: startedInScrollableBody(target)
    };
  };
  const moveSwipe = event => {
    const state = discoverUniversalSearchSwipeState;
    if (!state) return;
    const point = event.touches ? event.touches[0] : event;
    if (!point) return;
    const dy = point.clientY - state.startY;
    const dx = Math.abs(point.clientX - state.startX);
    state.currentY = point.clientY;

    if (!state.active) {
      // gate: must be downward and primarily vertical
      if (dy <= 0 || dx > Math.abs(dy)) return;
      if (state.fromBody) {
        // only steal touch from body scroll once the body is at top and the
        // user has clearly committed to pulling down (not just a small jitter
        // while reading results)
        if (!bodyScrolledToTop() || dy < 8) return;
      } else {
        if (dy < 4) return;
      }
      state.active = true;
      overlay.classList.add('discover-universal-search-dragging');
    }

    // active drag: block native scroll/refresh, translate the overlay
    event.preventDefault?.();
    const drag = Math.max(0, dy);
    overlay.style.transform = `translate3d(0, ${Math.round(drag)}px, 0)`;
  };
  const endSwipe = () => {
    const state = discoverUniversalSearchSwipeState;
    if (!state) return;
    const wasActive = state.active;
    const dy = Math.max(0, state.currentY - state.startY);
    const elapsed = Math.max(1, performance.now() - state.startTime);
    const velocity = dy / elapsed;
    discoverUniversalSearchSwipeState = null;
    if (!wasActive) {
      overlay.classList.remove('discover-universal-search-dragging');
      return;
    }
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

  panel.addEventListener('touchstart', event => {
    const point = event.touches?.[0];
    if (!point) return;
    startSwipe(point, event.target);
  }, { passive: true });
  panel.addEventListener('touchmove', moveSwipe, { passive: false });
  panel.addEventListener('touchend', endSwipe, { passive: true });
  panel.addEventListener('touchcancel', endSwipe, { passive: true });
  panel.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse') return;
    startSwipe(event, event.target);
  }, { passive: true });
  panel.addEventListener('pointermove', event => {
    if (event.pointerType === 'mouse') return;
    moveSwipe(event);
  }, { passive: false });
  panel.addEventListener('pointerup', event => {
    if (event.pointerType === 'mouse') return;
    endSwipe();
  }, { passive: true });
  panel.addEventListener('pointercancel', event => {
    if (event.pointerType === 'mouse') return;
    endSwipe();
  }, { passive: true });
}

function setDiscoverUniversalSearchSource(source = 'tmdb') {
  const nextSource = normalizeDiscoverUniversalSearchSource(source);
  if (nextSource !== discoverUniversalSearchSource) {
    discoverCategoryFilterPendingApply = false;
  }
  discoverUniversalSearchSource = nextSource;
  const overlay = ensureDiscoverUniversalSearchOverlay();
  overlay.querySelectorAll('.discover-universal-search-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.discoverSearchSource === discoverUniversalSearchSource);
  });
  overlay.querySelector('.discover-universal-search-tab.active')?.scrollIntoView?.({
    behavior: 'smooth',
    block: 'nearest',
    inline: 'center'
  });
  const input = document.getElementById('discover-universal-search-input');
  if (input) input.placeholder = getDiscoverUniversalSearchPlaceholder(discoverUniversalSearchSource);
  ensureDiscoverUniversalSearchFilterState();
  syncDiscoverUniversalSearchFilterContext();
}

function openDiscoverUniversalSearch(source = '') {
  const overlay = ensureDiscoverUniversalSearchOverlay();
  setDiscoverUniversalSearchSource(source || getDefaultDiscoverUniversalSearchSource());
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
    renderDiscoverUniversalSearchPresetHub();
  }
}

function closeDiscoverUniversalSearch(immediate = false) {
  const overlay = document.getElementById('discover-universal-search-overlay');
  if (!overlay) return;
  if (typeof window.closeDiscoverSearchPresetHub === 'function') {
    window.closeDiscoverSearchPresetHub();
  }
  discoverUniversalSearchSwipeState = null;
  discoverCategoryFilterPendingApply = false;
  overlay.classList.remove('open', 'discover-universal-search-dragging', 'discover-universal-search-swipe-cancel');
  overlay.style.transform = '';
  overlay.style.opacity = '';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.dataset.uiPattern = 'ShelfLine Filter UI';
  document.body.classList.remove('discover-universal-search-open');
  if (immediate) {
    overlay.style.display = 'none';
    return;
  }
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
  if (grid) renderDiscoverUniversalSearchPresetHub();
  if (input) input.focus({ preventScroll: true });
}

function switchDiscoverUniversalSearchSource(source = 'movie') {
  setDiscoverUniversalSearchSource(source);
  const input = document.getElementById('discover-universal-search-input');
  const query = String(input?.value || '').trim();
  if (query) runDiscoverUniversalSearch(query);
  else renderDiscoverUniversalSearchPresetHub();
}

window.getDiscoverUniversalSearchSource = function() {
  return discoverUniversalSearchSource;
};

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

function isDiscoverUniversalRomanizedNearMatch(a = '', b = '') {
  const ak = getDiscoverUniversalCompactTitleKey(a);
  const bk = getDiscoverUniversalCompactTitleKey(b);
  if (!ak || !bk || ak === bk) return false;
  const shorter = ak.length <= bk.length ? ak : bk;
  const longer = ak.length <= bk.length ? bk : ak;
  if (shorter.length < 3 || !longer.startsWith(shorter)) return false;
  const tail = longer.slice(shorter.length);
  return tail.length > 0 && tail.length <= 2 && /^[aeiouy]+$/.test(tail);
}

function getDiscoverUniversalSearchQueryVariants(query = '') {
  const raw = String(query || '').trim();
  const normalized = normalizeDiscoverUniversalRankText(raw);
  const compact = getDiscoverUniversalCompactTitleKey(raw);

  /* v11.638: punctuation-insensitive + word-split-tolerant variant fan-out.
     The bottom-nav search page sends every variant to TMDB in parallel and
     dedupes the union, then re-ranks with its own compact-key scorer. The
     external API (not our matcher) is what fails on punctuation/spacing
     mismatches: e.g. "avengers dooms day" returns 0 from TMDB while
     "avengers doomsday" returns the film. Our ranker already nails it once
     the title is in the candidate set — it just never gets a candidate. So
     we widen what we ask the API for. A miss costs one empty page; a hit
     surfaces titles the user could otherwise never reach. */
  const ordered = [raw];

  /* (A) Punctuation-normalized spelling — colons/semicolons/dashes/slashes →
     space, apostrophes deleted (so "assassin's" → "assassins"). Covers the
     ": ; - '" cases the user shouldn't have to type. */
  const punct = raw
    .toLowerCase()
    .replace(/[‘’ʼ']/g, '')
    .replace(/[:;\-_.,/\\!?&()\[\]{}|"–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = punct.split(' ').filter(Boolean);

  /* (B, weighted) Adjacent-token-join spellings — fuse each neighboring pair
     so a stray space inside a compound word still matches: "dooms day" →
     "doomsday", "spider man" → "spiderman", "wall e" → "walle". Only for
     2–4 token queries to avoid combinatorial blow-up (max 3 extra spellings).
     Inserted right after raw so the fix-bearing variants win priority within
     the 6-variant cap. */
  if (tokens.length >= 2 && tokens.length <= 4) {
    for (let i = 0; i < tokens.length - 1; i += 1) {
      ordered.push(
        tokens.slice(0, i)
          .concat(tokens[i] + tokens[i + 1])
          .concat(tokens.slice(i + 2))
          .join(' ')
      );
    }
  }

  /* (A) punctuation-normalized spelling, appended after the join variants. */
  if (punct) ordered.push(punct);

  /* Existing anime vowel-suffix variants — single short token only
     (e.g. "naruto" → "narutou"). Unchanged behavior. */
  if (
    compact
    && compact.length >= 3
    && compact.length <= 14
    && /^[a-z0-9]+$/.test(compact)
    && !normalized.includes(' ')
  ) {
    ['u', 'o', 'a', 'e', 'i'].forEach(suffix => {
      if (!compact.endsWith(suffix)) ordered.push(compact + suffix);
    });
  }

  /* Case-insensitive dedupe, preserve order (raw stays first → gets the
     multi-page fetch), cap at 6 parallel spellings. */
  const seen = new Set();
  const out = [];
  ordered.forEach(v => {
    const value = String(v || '').trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return;
    seen.add(key);
    out.push(value);
  });
  return out.slice(0, 6);
}

function collectDiscoverUniversalAliasValues(value, out) {
  if (!value || !out) return;
  if (Array.isArray(value)) {
    value.forEach(v => collectDiscoverUniversalAliasValues(v, out));
    return;
  }
  if (typeof value === 'object') {
    [
      value.title,
      value.name,
      value.english,
      value.english_title,
      value.romaji,
      value.romanized,
      value.original_title,
      value.original_name,
      value.data?.title,
      value.data?.name,
      value.data?.english_title
    ].forEach(v => collectDiscoverUniversalAliasValues(v, out));
    return;
  }
  const s = String(value || '').trim();
  if (s) out.push(s);
}

function getDiscoverUniversalTitleCandidates(item = {}) {
  const candidates = [
    item.title,
    item.name,
    item.original_title,
    item.original_name,
    item.english_title,
    item.title_english,
    item.romajiTitle,
    item.romanizedTitle,
    item.slug ? String(item.slug).replace(/-/g, ' ') : ''
  ];
  collectDiscoverUniversalAliasValues(item.__shelfdAliases, candidates);
  collectDiscoverUniversalAliasValues(item.alternative_titles?.titles, candidates);
  collectDiscoverUniversalAliasValues(item.alternative_titles?.results, candidates);
  collectDiscoverUniversalAliasValues(item.translations?.translations, candidates);
  const seen = new Set();
  return candidates
    .map(value => String(value || '').trim())
    .filter(value => {
      if (!value) return false;
      const key = normalizeDiscoverUniversalRankText(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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
  else if (isDiscoverUniversalRomanizedNearMatch(query, title)) score += 965000 + (compactQ.length * 9000);
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
  /* v934: ranking order — text match → release date → popularity
     (matches the game search formula so all media behaves consistently).
     Previously popularity dominated (votes × 520) and recency (max 120)
     was drowned out, so old mega-popular titles always beat new releases
     on the same query. */
  const textScore = getDiscoverUniversalBestTitleMatchScore(query, item);
  if (textScore <= 0) return 0;

  // Tier 2 — recency (0-1000; same scale as game scorer)
  const releaseDate = item.release_date || item.first_air_date || '';
  const year = Number(String(releaseDate).slice(0, 4));
  const currentYear = new Date().getFullYear();
  const recencyScore = (Number.isFinite(year) && year > 1900)
    ? Math.max(0, 1000 - (currentYear - year) * 40)
    : 0;

  // Tier 3 — popularity (0-10 log-scale tiebreaker)
  const votes = Number(item.vote_count || 0);
  const popularity = Number(item.popularity || 0);
  const popScore = Math.min(10, Math.log10(votes + popularity + 1) * 2);

  return textScore * 10000 + recencyScore + popScore;
}

function scoreDiscoverUniversalGameResult(item = {}, query = '') {
  const textScore = getDiscoverUniversalBestTitleMatchScore(query, item);
  if (textScore <= 0) return 0;
  const added = Number(item.added || 0);
  const ratings = Number(item.ratings_count || item.reviews_count || 0);
  const rating = Number(item.rating || 0);
  const metacritic = Number(item.metacritic || 0);
  const releasedYear = Number(String(item.released || '').slice(0, 4));
  const recency = Number.isFinite(releasedYear) && releasedYear > 0 ? Math.max(0, Math.min(80, releasedYear - 1990)) : 0;
  return textScore
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
  /* v654: getTmdbImageUrl passes through full https URLs unchanged so Jikan posters work. */
  const poster = getTmdbImageUrl(item.poster_path, 'w342');
  const overview = item.overview || '';
  const section = itemType === 'movie' ? 'movies' : 'shows';
  const titleAttr = escAttr(title);
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
    genreNames: getDiscoverGenreNames(item, itemType),
    /* v654: forward Jikan markers so the profile-open path knows to use Jikan. */
    __jikan: !!item.__jikan,
    __mal_id: item.__mal_id || 0
  });
  return `<div class="discover-card discover-universal-search-result-row" data-universal-kind="${escAttr(getDiscoverUniversalMediaLabel('tmdb', item))}">
    <div class="discover-poster" data-poster="${escAttr(poster)}" data-media-type="${itemType}" data-media-id="${item.id}" data-discover-title="${titleAttr}" data-discover-section="${section}" onclick="handleDiscoverPosterClick(event, this, '${itemType}', ${item.id})">
      ${poster ? buildDiscoverPosterMarkup(poster) : ''}${getDiscoverFriendStackMarkup(title, section)}
    </div>
    <div class="discover-card-body" onclick="openDiscoverMediaProfile(event, '${itemType}', ${item.id})">
      <div class="discover-card-info-row">
        <div class="discover-card-info-stack">
          <div class="discover-universal-search-result-type">${escHtml(getDiscoverUniversalMediaLabel('tmdb', item))}</div>
          <button class="discover-card-title discover-title-profile-btn" type="button" onclick="openDiscoverMediaProfile(event, '${itemType}', ${item.id})">${escHtml(title)}${year ? ` (${year})` : ''}</button>
          ${genreLine ? `<div class="discover-card-genre">${escHtml(genreLine)}</div>` : ''}
        </div>
        <button class="discover-close-btn" type="button" onclick="handleDiscoverCloseClick(event, this)">Close</button>
      </div>
      <div class="discover-card-overview">${overview ? escHtml(overview) : ''}</div>
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
  const titleAttr = escAttr(title);
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

function getShelfdUniversalFilterForDiscoverSearch(source = discoverUniversalSearchSource) {
  const normalized = normalizeDiscoverUniversalSearchSource(source);
  if (normalized === 'rawg') return 'game';
  if (normalized === 'person') return 'person';
  return normalized || 'all';
}

function renderDiscoverUniversalEngineRows(rows = [], query = '', grid = null) {
  if (!grid) return;
  if (!rows.length) {
    grid.classList.remove('discover-universal-search-results-list');
    grid.innerHTML = '<div class="discover-universal-search-empty">No matching titles found.</div>';
    return;
  }
  grid.classList.add('discover-universal-search-results-list');
  if (window.ShelfdUniversalSearchEngine?.renderRows) {
    grid.innerHTML = window.ShelfdUniversalSearchEngine.renderRows(rows, query);
  } else {
    grid.innerHTML = '<div class="discover-universal-search-empty">Search results could not render.</div>';
  }
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
    renderDiscoverUniversalSearchPresetHub();
    return;
  }
  if (typeof window.closeDiscoverSearchPresetHub === 'function') {
    window.closeDiscoverSearchPresetHub();
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
    if (window.ShelfdUniversalSearchEngine?.search) {
      const engineFilter = getShelfdUniversalFilterForDiscoverSearch(source);
      const rows = await window.ShelfdUniversalSearchEngine.search(query, engineFilter, {
        limit: Math.max(24, DISCOVER_UNIVERSAL_SEARCH_DEFAULT_LIMIT)
      });
      if (token !== discoverUniversalSearchToken) return;
      renderDiscoverUniversalEngineRows(rows, query, grid);
      return;
    }
    if (source === 'music') {
      grid.innerHTML = '<div class="discover-universal-search-empty">Music search is not connected yet.</div>';
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
    /* v654: anime source uses Jikan exclusively. */
    if (source === 'anime') {
      const raw = await window.JikanAnime?.searchAnime(query, 24);
      const items = (raw || []).map(window.JikanAnime?.mapItem).filter(Boolean);
      if (token !== discoverUniversalSearchToken) return;
      grid.classList.add('discover-universal-search-results-list');
      renderDiscoverCards('tv', items, 'discover-universal-search-grid');
      return;
    }
    let items = await fetchTmdbSearchResults(query);
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

function renderDiscoverUniversalSearchPresetHub() {
  const grid = document.getElementById('discover-universal-search-grid');
  if (!grid) return;
  grid.classList.remove('discover-universal-search-results-list');
  if (typeof window.renderDiscoverSearchPresetHub === 'function') {
    window.renderDiscoverSearchPresetHub();
    return;
  }
  grid.innerHTML = '<div class="discover-universal-search-empty">Search presets could not load.</div>';
}



function getDiscoverUniversalSearchScope(source = discoverUniversalSearchSource) {
  const normalized = normalizeDiscoverUniversalSearchSource(source);
  if (normalized === 'movie') return 'movie';
  if (normalized === 'tv') return 'tv';
  if (normalized === 'anime') return 'anime';
  if (normalized === 'all' || normalized === 'tmdb') return 'mixed';
  return '';
}

async function fetchDiscoverUniversalBestThisYear(source = discoverUniversalSearchSource) {
  const scope = getDiscoverUniversalSearchScope(source);
  if (!scope) return [];
  /* v654: anime "best this year" uses Jikan top-airing filtered to the
     current year. mixed scope skips anime here (anime hub has its own
     surface) — callers can include anime explicitly via scope='anime'. */
  if (scope === 'anime') {
    const J = window.JikanAnime;
    if (!J) return [];
    const thisYear = new Date().getFullYear();
    const top = await J.topAnime('', 'tv', DISCOVER_LIMIT * 2);
    const filtered = (top || []).filter(a => Number(a?.year || 0) === thisYear);
    return filtered.map(J.mapItem).filter(Boolean).slice(0, DISCOVER_LIMIT);
  }
  const items = scope === 'mixed'
    ? [
        ...(await fetchAndRankThisYearsBest('movie')),
        ...(await fetchAndRankThisYearsBest('tv'))
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

function getShelfdSearchFilterGridId(source = 'all') {
  const normalized = normalizeDiscoverUniversalSearchSource(source);
  if (normalized === 'movie') return 'discover-movie-universal-search-grid';
  if (normalized === 'tv') return 'discover-tv-universal-search-grid';
  if (normalized === 'anime') return 'anime-discover-universal-search-grid';
  if (normalized === 'all') return 'discover-universal-search-grid';
  return '';
}

function isShelfdSearchFilterableSource(source = 'all') {
  return !!getShelfdSearchFilterGridId(source);
}

function ensureShelfdSearchFilterState(source = 'all', activate = true) {
  const gridId = getShelfdSearchFilterGridId(source);
  if (!gridId) return null;
  if (!shelfdSearchFilterState || shelfdSearchFilterState.gridId !== gridId) {
    shelfdSearchFilterState = {
      mode: 'shelfd-search',
      gridId,
      sortKey: 'default',
      newReleaseCountryCode: '',
      newReleaseRange: discoverNewReleaseRange,
      filters: shelfdSearchFilterState?.filters || getEmptyDiscoverCategoryFilters(),
      overrideItems: null,
      overrideRenderer: null,
      overrideType: null
    };
  }
  if (activate) discoverCategoryFullState = shelfdSearchFilterState;
  return shelfdSearchFilterState;
}

window.openShelfdSearchFilterSheet = function(source = 'all') {
  if (!ensureShelfdSearchFilterState(source)) return;
  openDiscoverCategoryFilterSheet();
};

window.getShelfdSearchFilterCount = function(source = 'all') {
  const state = ensureShelfdSearchFilterState(source, false);
  if (!state) return 0;
  const filters = state.filters || getEmptyDiscoverCategoryFilters();
  return Object.keys(DISCOVER_CATEGORY_FILTER_GROUPS).reduce((sum, key) => sum + (filters[key]?.length || 0), 0);
};

window.isShelfdSearchFilterableSource = isShelfdSearchFilterableSource;

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
  /* v10.290: track when RAWG returns a hard failure (401 = quota exceeded,
     5xx = service down) so we can fall back to IGDB. */
  let rawgFailed = false;
  const settled = await Promise.allSettled(pages.map(async page => {
    const res = await fetchRawgProxy('games', { page_size: '40', ...params, page: String(page) });
    if (!res.ok) {
      if (res.status === 401 || res.status === 429 || res.status >= 500) rawgFailed = true;
      throw new Error(`RAWG discovery request failed: ${res.status}`);
    }
    const json = await res.json();
    return json.results || [];
  }));
  const results = settled
    .filter(result => result.status === 'fulfilled')
    .flatMap(result => result.value);
  const seen = new Set();
  const deduped = results.filter(item => {
    if (!item || !item.id || !item.name || !item.background_image || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, limit);
  /* v10.290: if RAWG totally failed (quota / outage), fall through to IGDB.
     Caller passes in the original params so we can map them to IGDB's
     preset/from/to query format. */
  if (deduped.length === 0 && rawgFailed) {
    try {
      const igdbResults = await fetchIgdbGamesFallback(params, limit);
      if (igdbResults.length) return igdbResults;
    } catch (e) {
      console.warn('[games] IGDB fallback failed:', e && e.message ? e.message : e);
    }
  }
  return deduped;
}

/* v10.290: IGDB fallback. The worker has /api/igdb/discover-games already
   built (worker.js:639). It accepts ?preset=popular|rated|upcoming&from&to&limit
   and returns games shaped identically to RAWG results (id, name, released,
   background_image, genres[], platforms[], rating, ratings_count, etc).
   We map RAWG-style params to IGDB-style preset:
     ordering: '-added' / no dates → popular
     ordering: '-rating' or metacritic= → rated
     dates with future from → upcoming
     dates with year start → popular w/ from-to
*/
async function fetchIgdbGamesFallback(params = {}, limit = DISCOVER_LIMIT) {
  const ordering = String(params.ordering || '').trim();
  const dates = String(params.dates || '').trim();
  const metacritic = String(params.metacritic || '').trim();
  let preset = 'popular';
  if (metacritic || ordering === '-rating' || ordering === '-metacritic') preset = 'rated';
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  let from = '';
  let to = '';
  if (dates && dates.includes(',')) {
    const [a, b] = dates.split(',');
    if (a && /^\d{4}-\d{2}-\d{2}$/.test(a)) from = a;
    if (b && /^\d{4}-\d{2}-\d{2}$/.test(b)) to = b;
    if (from && from > todayStr) preset = 'upcoming';
  }
  const url = new URL('/api/igdb/discover-games', window.location.origin);
  url.searchParams.set('preset', preset);
  url.searchParams.set('limit', String(Math.min(100, Math.max(20, limit))));
  if (from) url.searchParams.set('from', from);
  if (to) url.searchParams.set('to', to);
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const json = await res.json();
  return Array.isArray(json?.results) ? json.results : [];
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
  return '/default-avatar.svg#' + encodeURIComponent(user.name || 'Friend') + '&background=1e2028&color=60a5fa';
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
    if (normalized === 'planned') return 'Planning';
    if (normalized === 'competitive') return 'Competitive';
  }
  if (normalized === 'watching') return 'Watching';
  if (normalized === 'planned') return 'Planning';
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
        /* v10.387: section-aware fan-out for friend data; user doc fetch
           runs in parallel as before. */
        const [userSnap, listData] = await Promise.all([
          db.collection('users').doc(uid).get(),
          loadWatchlistDataForUid(uid, { sections: ['shows', 'movies', 'anime', 'games'] })
        ]);
        const user = userSnap.exists ? userSnap.data() : usersMap[uid] || {};
        if (userSnap.exists) usersMap[uid] = { ...user, uid };
        return {
          uid,
          name: user.name || 'Friend',
          photo: user.photo || '',
          listData: normalizeListData({
            shows: listData.shows || [],
            movies: listData.movies || [],
            anime: listData.anime || [],
            games: listData.games || []
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
    /* v11.417: show the @USERNAME, not the display name. */
    const nameHtml = (typeof renderActivityCardUsernameHTML === 'function')
      ? renderActivityCardUsernameHTML(friend, 'Friend')
      : renderDisplayNameHTML(friend, 'Friend');
    return `<div class="discover-friends-modal-row">
      <img class="discover-friends-modal-avatar" src="${escAttr(getDiscoverAvatarUrl(friend))}" alt="${escAttr(friend.name || 'Friend')}" loading="lazy">
      <div>
        <div class="discover-friends-modal-name">${nameHtml}</div>
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
      </div>
      <button class="discover-friends-modal-close" type="button" onclick="closeDiscoverFriendsModal()" aria-label="Close">×</button>
    </div>
    <div class="discover-friends-modal-rule">Icons appear when this title is in a friend’s Watching or Planning. For games, icons appear when the game is in Playing or Planning.</div>
    <div class="discover-friends-modal-list">${rows}</div>
  </div>`;
  document.body.appendChild(overlay);
  document.addEventListener('keydown', handleDiscoverFriendsModalEsc);
  requestAnimationFrame(() => overlay.classList.add('open'));
}

function getDiscoverGenreNames(item, itemType) {
  const out = [];
  const seen = new Set();
  const push = value => {
    const clean = String(value == null ? '' : (value.name || value)).trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  };
  if (Array.isArray(item?.imdbGenres) && item.imdbGenres.length) {
    item.imdbGenres.forEach(push);
  }
  if (!out.length && item?.imdbGenre) {
    String(item.imdbGenre)
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
      .forEach(push);
  }
  if (Array.isArray(item?.genreNames) && item.genreNames.length) {
    item.genreNames.forEach(push);
  }
  if (!out.length && Array.isArray(item?.genres) && item.genres.length) {
    item.genres.forEach(push);
  }
  const genreMap = itemType === 'movie' ? DISCOVER_MOVIE_GENRE_MAP : DISCOVER_TV_GENRE_MAP;
  if (!out.length && Array.isArray(item?.genre_ids)) {
    item.genre_ids.forEach(id => push(genreMap[id]));
  }
  return out;
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
  openDiscoverMediaProfile(event, type, id, poster, getDiscoverMediaProfileOpenOptionsForElement(poster));
}

function getDiscoverMediaProfileOpenOptionsForElement(element) {
  const node = element?.closest?.('#discover-category-full-page, .discover-category-full-grid');
  return node ? { sourceContext: 'discovery-view-all', openAboveViewAll: true } : null;
}

function openDiscoverViewAllMediaProfile(event, type, id, element = null) {
  const origin = element || event?.currentTarget || event?.target || null;
  return openDiscoverMediaProfile(event, type, id, origin, { sourceContext: 'discovery-view-all', openAboveViewAll: true });
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
  if (shouldReturnToFilmographyFromMediaProfile(reasonOrOptions)) {
    returnToFilmographyFromMediaProfile();
    return;
  }
  /* v10.488: pop the media-profile back-stack on user-initiated closes.
     If there's a previous title queued (because the user came here via
     a "More Like This" tap), tear down the current overlay and reopen
     that previous title — restoring scroll position. The
     `_internalReplace` flag tells us this close came from
     openDiscoverMediaProfile's own teardown (we're swapping to a new
     title), so we skip the pop in that case. */
  const isInternalReplace = reasonOrOptions === '_internalReplace';
  const stack = Array.isArray(window.discoverMediaProfileBackStack)
    ? window.discoverMediaProfileBackStack
    : null;
  if (!isInternalReplace && stack && stack.length > 0) {
    const previous = stack.pop();
    destroyDiscoverHeroTrailerPreview(overlay);
    activeDiscoverMediaProfileState = null;
    document.removeEventListener('keydown', handleDiscoverMediaProfileEsc);
    /* Hard-remove so we don't run the close animation — restore should
       feel snappy, not animated. */
    try { overlay.remove(); } catch (_) {}
    document.body.classList.remove('discover-media-profile-open', 'game-media-profile-open', 'discover-view-all-profile-open');
    if (typeof openDiscoverMediaProfile === 'function') {
      Promise.resolve(openDiscoverMediaProfile(null, previous.type, previous.id, null, { _restoringFromStack: true })).then(() => {
        if (!previous.scrollTop) return;
        setTimeout(() => {
          const newOverlay = document.getElementById('discover-media-profile');
          const page = newOverlay?.querySelector?.('.discover-media-page') || newOverlay;
          if (page) page.scrollTop = previous.scrollTop;
        }, 240);
      }).catch(() => {});
    }
    return;
  }
  /* Normal close — clear any lingering stack so a fresh session starts
     empty (covers the case where the user navigated to Discovery via
     bottom-nav while the stack still had entries). */
  if (!isInternalReplace && stack) stack.length = 0;
  destroyDiscoverHeroTrailerPreview(overlay);
  activeDiscoverMediaProfileState = null;
  document.removeEventListener('keydown', handleDiscoverMediaProfileEsc);
  closeMediaProfileOverlay(overlay, () => {
    document.body.classList.remove('discover-media-profile-open', 'game-media-profile-open', 'discover-view-all-profile-open');
    finishSharedMediaRouteAfterClose();
  }, reasonOrOptions);
}

function handleDiscoverMediaProfileEsc(event) {
  if (event.key === 'Escape') closeDiscoverMediaProfile('escape');
}

function getDiscoverMediaTitle(item, type) {
  /* v11.383: title source follows the item's own anime flags only — not the
     persisted activeDiscoveryHub global (which would swap a normal TV title for
     a Jikan/romaji title whenever the Anime hub was last open). */
  if (type === 'tv' && isAnimeTitleContext(item, '')) {
    return getAnimeDisplayTitle(item, getAnimeTitleDisplayMode()) || item?.title || item?.name || 'TV Show';
  }
  return item?.title || item?.name || (type === 'tv' ? 'TV Show' : 'Movie');
}

function getDiscoverMediaDate(item, type) {
  return item?.release_date || item?.first_air_date || '';
}

function isDiscoverMediaReleased(item = {}, type = '') {
  const rawDate = String(getDiscoverMediaDate(item, type) || item?.released || '').trim();
  if (!rawDate) return true;
  const releaseDate = new Date(`${rawDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(releaseDate.getTime())) return true;
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return releaseDate.getTime() <= today.getTime();
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

function isDiscoverMovieTvTitleCardGrid(gridId = '', itemType = '') {
  const type = String(itemType || '').toLowerCase();
  if (type !== 'movie' && type !== 'tv') return false;
  const sourceGridId = String(
    gridId === 'discover-category-full-grid'
      ? (discoverCategoryFullState?.gridId || document.getElementById(gridId)?.dataset?.sourceGridId || '')
      : gridId
  );
  return sourceGridId.startsWith('discover-movie-') || sourceGridId.startsWith('discover-tv-');
}

function getDiscoverTitleCardPosterUrl(item = {}, itemType = '', gridId = '') {
  /* v10.62: was 'original' for movie/TV horizontal rows + full category grids
     — that's the un-resized source (often 1500–2000px wide for a 120–200px
     tile on mobile). 'w500' is 2× the largest mobile rendered size, perfect
     for retina, and roughly 1/8 the file size. Verified visually unchanged. */
  const posterSize = isDiscoverMovieTvTitleCardGrid(gridId, itemType) ? 'w500' : 'w342';
  return getTmdbImageUrl(item.poster_path, posterSize);
}

function getDiscoverMediaPoster(item) {
  /* v10.62: w780 -> w500. The poster is rendered at ~140×210px on the media
     profile hero card and the universal-search seed; w500 covers retina @2x. */
  if (item?.poster_path) return getTmdbImageUrl(item.poster_path, 'w500');
  if (item?.poster) return item.poster;
  return '';
}

function getDiscoverMediaBackdrop(item) {
  /* v10.62: w1280 -> w780. iPhone viewports are 390–430px wide; w780 covers
     retina @2x without paying for a 1280px decode every time you open a
     media profile. Major image-decode reduction on entry. */
  if (item?.backdrop_path) return getTmdbImageUrl(item.backdrop_path, 'w780');
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

let activeDiscoverHeroTrailerPreviewCleanup = null;
let activeDiscoverHeroTrailerExpansionState = null;
let discoverYoutubeIframeApiPromise = null;

const DISCOVER_HERO_TRAILER_SNAP_MS = 600;

function easeOutDiscoverHeroTrailerProgress(t = 0) {
  const x = Math.max(0, Math.min(1, Number(t) || 0));
  return 1 - Math.pow(1 - x, 3);
}

function getDiscoverTrailerViewportSize() {
  const visualViewport = window.visualViewport;
  const width = Math.max(1, Math.round(visualViewport?.width || window.innerWidth || document.documentElement.clientWidth || 360));
  const height = Math.max(1, Math.round(visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 740));
  if (document.documentElement.classList.contains('shelfd-phone-landscape-lock') && width > height) {
    return { width: height, height: width };
  }
  return { width, height };
}

function getDiscoverHeroTrailerPreviewElement(overlay = document.getElementById('discover-media-profile')) {
  return overlay?.querySelector?.('[data-discover-hero-trailer-preview]') || null;
}

function hasDiscoverHeroTrailerPreview(overlay = document.getElementById('discover-media-profile')) {
  const preview = getDiscoverHeroTrailerPreviewElement(overlay);
  return !!(preview && String(preview.dataset?.trailerKey || '').trim());
}

function shouldWarmDiscoverHeroTrailerHandoff(overlay = document.getElementById('discover-media-profile')) {
  if (!overlay) return false;
  const state = (typeof activeDiscoverMediaProfileState !== 'undefined') ? activeDiscoverMediaProfileState : null;
  const details = state?.details || {};
  return !!(
    details?.isAnime ||
    details?.mediaCategory === 'anime' ||
    details?.librarySection === 'anime' ||
    details?.mal_id ||
    details?.malId ||
    details?.jikanId
  );
}

function warmDiscoverHeroTrailerPlayerBeforeHandoff(overlay = document.getElementById('discover-media-profile')) {
  const preview = getDiscoverHeroTrailerPreviewElement(overlay);
  if (!preview) return Promise.resolve(null);
  if (preview._discoverTrailerPlayer) return Promise.resolve(preview._discoverTrailerPlayer);
  if (preview._discoverTrailerPlayerWarmPromise) return preview._discoverTrailerPlayerWarmPromise;
  if (preview._discoverTrailerWarmIdleId || preview._discoverTrailerWarmTimer) return Promise.resolve(null);

  const runWarmup = () => {
    if (!preview.isConnected || !overlay?.isConnected) return Promise.resolve(null);
    const warmPromise = ensureDiscoverHeroTrailerPlayer(overlay);
    preview._discoverTrailerPlayerWarmPromise = warmPromise;
    return warmPromise.finally(() => {
      if (preview._discoverTrailerPlayerWarmPromise === warmPromise) {
        preview._discoverTrailerPlayerWarmPromise = null;
      }
    });
  };

  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    preview._discoverTrailerWarmIdleId = window.requestIdleCallback(() => {
      preview._discoverTrailerWarmIdleId = 0;
      runWarmup();
    }, { timeout: 700 });
    return Promise.resolve(null);
  }

  preview._discoverTrailerWarmTimer = window.setTimeout(() => {
    preview._discoverTrailerWarmTimer = 0;
    runWarmup();
  }, 80);
  return Promise.resolve(null);
}

function clearDiscoverHeroTrailerExpansionVars(preview) {
  if (!preview) return;
  [
    '--media-profile-trailer-x',
    '--media-profile-trailer-y',
    '--media-profile-trailer-scale-x',
    '--media-profile-trailer-scale-y',
    '--media-profile-trailer-media-x',
    '--media-profile-trailer-media-y',
    '--media-profile-trailer-media-scale-x',
    '--media-profile-trailer-media-scale-y',
    '--media-profile-trailer-start-width',
    '--media-profile-trailer-start-height',
    '--media-profile-trailer-left',
    '--media-profile-trailer-top',
    '--media-profile-trailer-width',
    '--media-profile-trailer-height',
    '--media-profile-trailer-radius',
    '--media-profile-trailer-overlay-opacity',
    '--media-profile-trailer-content-opacity',
    '--media-profile-trailer-iframe-scale',
    '--media-profile-trailer-thumb-scale',
    '--media-profile-trailer-frame-opacity',
    '--media-profile-trailer-progress-fill'
  ].forEach(name => preview.style.removeProperty(name));
  preview.style.transition = '';
  preview.style.willChange = '';
}

function clearDiscoverHeroTrailerOverlayVars(overlay) {
  if (!overlay) return;
  [
    '--media-profile-trailer-page-opacity',
    '--media-profile-trailer-page-y',
    '--media-profile-trailer-controls-opacity'
  ].forEach(name => overlay.style.removeProperty(name));
}

function cancelDiscoverHeroTrailerProgressAnimation() {
  const state = activeDiscoverHeroTrailerExpansionState;
  if (!state?.animationFrameId) return;
  cancelAnimationFrame(state.animationFrameId);
  state.animationFrameId = 0;
}

function resetDiscoverHeroTrailerExpansionState(overlay = document.getElementById('discover-media-profile')) {
  const preview = getDiscoverHeroTrailerPreviewElement(overlay);
  cancelDiscoverHeroTrailerProgressAnimation();
  stopDiscoverHeroTrailerProgressLoop(preview);
  overlay?.classList?.remove('media-profile-trailer-expanding', 'media-profile-trailer-fullscreen', 'media-profile-trailer-collapsing', 'media-profile-trailer-gesture', 'media-profile-trailer-animating', 'media-profile-trailer-controls-hidden', 'media-profile-trailer-aspect-preserve', 'media-profile-trailer-landscape', 'media-profile-trailer-letterbox-stable');
  document.body.classList.remove('media-profile-trailer-fullscreen-active', 'media-profile-trailer-transition-active', 'media-profile-trailer-landscape-active');
  clearDiscoverHeroTrailerExpansionVars(preview);
  clearDiscoverHeroTrailerOverlayVars(overlay);
  activeDiscoverHeroTrailerExpansionState = null;
}

function measureDiscoverHeroTrailerStartRect(overlay, preview) {
  const state = activeDiscoverHeroTrailerExpansionState;
  if (state?.overlay === overlay && state?.preview === preview && state?.startRect) return state.startRect;
  const rect = preview.getBoundingClientRect();
  return {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height))
  };
}

function getActiveDiscoverHeroTrailerViewport(state = activeDiscoverHeroTrailerExpansionState) {
  return state?.viewport || getDiscoverTrailerViewportSize();
}

function getDiscoverHeroTrailerSourceAspect(overlay, startRect) {
  if (overlay?.classList?.contains('game-media-profile-overlay')) return 16 / 9;
  return Math.max(0.01, (startRect?.width || 16) / Math.max(1, startRect?.height || 9));
}

function beginDiscoverHeroTrailerExpansion(overlay = document.getElementById('discover-media-profile')) {
  const preview = getDiscoverHeroTrailerPreviewElement(overlay);
  if (!overlay || !preview || !hasDiscoverHeroTrailerPreview(overlay)) return null;
  const startRect = measureDiscoverHeroTrailerStartRect(overlay, preview);
  const viewport = getDiscoverTrailerViewportSize();
  cancelDiscoverHeroTrailerProgressAnimation();
  preview.style.setProperty('--media-profile-trailer-start-width', `${startRect.width.toFixed(2)}px`);
  preview.style.setProperty('--media-profile-trailer-start-height', `${startRect.height.toFixed(2)}px`);
  activeDiscoverHeroTrailerExpansionState = {
    overlay,
    preview,
    startRect,
    viewport,
    direction: activeDiscoverHeroTrailerExpansionState?.direction || 'expand',
    progress: Math.max(0, Math.min(1, activeDiscoverHeroTrailerExpansionState?.progress || 0)),
    animationFrameId: 0
  };
  preview.style.transition = 'none';
  preview.style.willChange = 'transform, border-radius';
  overlay.classList.add('media-profile-trailer-expanding');
  document.body.classList.add('media-profile-trailer-transition-active');
  applyDiscoverHeroTrailerExpansionProgress(overlay, activeDiscoverHeroTrailerExpansionState.progress);
  return activeDiscoverHeroTrailerExpansionState;
}

function getDiscoverHeroTrailerPageOpacity(progress, direction = 'expand') {
  if (direction === 'collapse') {
    return Math.pow(Math.max(0, 1 - progress), 0.52);
  }
  return Math.max(0, 1 - Math.min(1, progress * 1.5));
}

function getDiscoverHeroTrailerPageMoveProgress(progress, direction = 'expand') {
  if (direction === 'collapse') return Math.pow(progress, 1.32);
  return Math.pow(progress, 0.9);
}

function applyDiscoverHeroTrailerExpansionProgress(overlay = document.getElementById('discover-media-profile'), rawProgress = 0) {
  const preview = getDiscoverHeroTrailerPreviewElement(overlay);
  if (!overlay || !preview) return 0;
  let state = activeDiscoverHeroTrailerExpansionState;
  if (!state || state.overlay !== overlay || state.preview !== preview) state = beginDiscoverHeroTrailerExpansion(overlay);
  if (!state) return 0;
  const viewport = getActiveDiscoverHeroTrailerViewport(state);
  const progress = Math.max(0, Math.min(1, Number(rawProgress) || 0));
  state.progress = progress;
  const direction = state.direction || (overlay.classList.contains('media-profile-trailer-collapsing') ? 'collapse' : 'expand');
  const ease = progress;
  const pageOpacity = getDiscoverHeroTrailerPageOpacity(progress, direction);
  const pageMoveProgress = getDiscoverHeroTrailerPageMoveProgress(progress, direction);
  const start = state.startRect;
  const x = start.left * (1 - ease);
  const y = start.top * (1 - ease);
  const width = start.width + (viewport.width - start.width) * ease;
  const height = start.height + (viewport.height - start.height) * ease;
  const scaleX = width / Math.max(1, start.width);
  const scaleY = height / Math.max(1, start.height);
  if (overlay.classList.contains('media-profile-trailer-aspect-preserve')) {
    const sourceAspect = getDiscoverHeroTrailerSourceAspect(overlay, start);
    const containerAspect = width / Math.max(1, height);
    const mediaWidth = containerAspect > sourceAspect ? height * sourceAspect : width;
    const mediaHeight = mediaWidth / sourceAspect;
    const mediaX = ((width - mediaWidth) / 2) / Math.max(0.001, scaleX);
    const mediaY = ((height - mediaHeight) / 2) / Math.max(0.001, scaleY);
    const mediaScaleX = mediaWidth / Math.max(1, start.width * scaleX);
    const mediaScaleY = mediaHeight / Math.max(1, start.height * scaleY);
    preview.style.setProperty('--media-profile-trailer-media-x', `${mediaX.toFixed(2)}px`);
    preview.style.setProperty('--media-profile-trailer-media-y', `${mediaY.toFixed(2)}px`);
    preview.style.setProperty('--media-profile-trailer-media-scale-x', `${mediaScaleX.toFixed(5)}`);
    preview.style.setProperty('--media-profile-trailer-media-scale-y', `${mediaScaleY.toFixed(5)}`);
  }
  preview.style.setProperty('--media-profile-trailer-x', `${x.toFixed(2)}px`);
  preview.style.setProperty('--media-profile-trailer-y', `${y.toFixed(2)}px`);
  preview.style.setProperty('--media-profile-trailer-scale-x', `${scaleX.toFixed(5)}`);
  preview.style.setProperty('--media-profile-trailer-scale-y', `${scaleY.toFixed(5)}`);
  preview.style.setProperty('--media-profile-trailer-radius', `${Math.max(0, 12 * (1 - ease)).toFixed(2)}px`);
  preview.style.setProperty('--media-profile-trailer-overlay-opacity', `${Math.max(0, 1 - ease).toFixed(3)}`);
  preview.style.setProperty('--media-profile-trailer-content-opacity', `${pageOpacity.toFixed(3)}`);
  preview.style.setProperty('--media-profile-trailer-iframe-scale', `${(1.22 - 0.22 * ease).toFixed(3)}`);
  preview.style.setProperty('--media-profile-trailer-thumb-scale', `${(1.12 - 0.12 * ease).toFixed(3)}`);
  preview.style.setProperty('--media-profile-trailer-frame-opacity', `${(0.94 + 0.06 * ease).toFixed(3)}`);
  overlay.style.setProperty('--media-profile-trailer-page-opacity', `${pageOpacity.toFixed(3)}`);
  overlay.style.setProperty('--media-profile-trailer-page-y', `${(viewport.height * 0.38 * pageMoveProgress).toFixed(2)}px`);
  return progress;
}

function finishDiscoverHeroTrailerExpansion(overlay = document.getElementById('discover-media-profile')) {
  const preview = getDiscoverHeroTrailerPreviewElement(overlay);
  if (!overlay || !preview) return false;
  cancelDiscoverHeroTrailerProgressAnimation();
  const keepAspectHandoffStable = shouldWarmDiscoverHeroTrailerHandoff(overlay);
  const classesToRemove = ['media-profile-trailer-expanding', 'media-profile-trailer-collapsing', 'media-profile-trailer-gesture', 'media-profile-trailer-animating'];
  if (!keepAspectHandoffStable) classesToRemove.push('media-profile-trailer-aspect-preserve');
  overlay.classList.remove(...classesToRemove);
  overlay.classList.toggle('media-profile-trailer-letterbox-stable', keepAspectHandoffStable);
  overlay.classList.add('media-profile-trailer-fullscreen');
  document.body.classList.remove('media-profile-trailer-transition-active');
  document.body.classList.add('media-profile-trailer-fullscreen-active');
  if (activeDiscoverHeroTrailerExpansionState) activeDiscoverHeroTrailerExpansionState.direction = 'expand';
  applyDiscoverHeroTrailerExpansionProgress(overlay, 1);
  setDiscoverHeroTrailerControlsVisible(overlay, true);
  if (shouldWarmDiscoverHeroTrailerHandoff(overlay)) {
    const playerPromise = preview._discoverTrailerPlayerWarmPromise || ensureDiscoverHeroTrailerPlayer(overlay);
    Promise.resolve(playerPromise).then(() => {
      if (isDiscoverHeroTrailerFullscreen(overlay)) {
        startDiscoverHeroTrailerProgressLoop(preview);
      }
    }).catch(() => {});
  } else {
    ensureDiscoverHeroTrailerPlayer(overlay);
    startDiscoverHeroTrailerProgressLoop(preview);
  }
  preview.style.transition = '';
  return true;
}

function animateDiscoverHeroTrailerExpansionTo(overlay, targetProgress, done) {
  const preview = getDiscoverHeroTrailerPreviewElement(overlay);
  const state = activeDiscoverHeroTrailerExpansionState || beginDiscoverHeroTrailerExpansion(overlay);
  if (!preview || !state) return false;
  cancelDiscoverHeroTrailerProgressAnimation();
  const from = Math.max(0, Math.min(1, Number(state.progress) || 0));
  const to = Math.max(0, Math.min(1, Number(targetProgress) || 0));
  const distance = Math.abs(to - from);
  const duration = Math.max(220, Math.min(DISCOVER_HERO_TRAILER_SNAP_MS, DISCOVER_HERO_TRAILER_SNAP_MS * distance));
  const startedAt = performance.now();
  state.direction = to < from ? 'collapse' : 'expand';
  preview.style.transition = 'none';
  overlay.classList.add('media-profile-trailer-animating');
  document.body.classList.add('media-profile-trailer-transition-active');
  const step = (now) => {
    const elapsed = Math.max(0, now - startedAt);
    const eased = easeOutDiscoverHeroTrailerProgress(elapsed / duration);
    const next = from + ((to - from) * eased);
    applyDiscoverHeroTrailerExpansionProgress(overlay, next);
    if (elapsed < duration) {
      state.animationFrameId = requestAnimationFrame(step);
      return;
    }
    state.animationFrameId = 0;
    applyDiscoverHeroTrailerExpansionProgress(overlay, to);
    overlay.classList.remove('media-profile-trailer-animating');
    document.body.classList.remove('media-profile-trailer-transition-active');
    preview.style.transition = '';
    if (typeof done === 'function') done();
  };
  state.animationFrameId = requestAnimationFrame(step);
  return true;
}

function expandDiscoverHeroTrailerPreview(overlay = document.getElementById('discover-media-profile'), options = {}) {
  if (!hasDiscoverHeroTrailerPreview(overlay)) return false;
  if (overlay?.classList?.contains('media-profile-trailer-fullscreen')) return true;
  overlay?.classList?.add('media-profile-trailer-aspect-preserve');
  const state = beginDiscoverHeroTrailerExpansion(overlay);
  if (state) state.direction = 'expand';
  if (options.immediate) {
    applyDiscoverHeroTrailerExpansionProgress(overlay, 1);
    finishDiscoverHeroTrailerExpansion(overlay);
    return true;
  }
  return animateDiscoverHeroTrailerExpansionTo(overlay, 1, () => finishDiscoverHeroTrailerExpansion(overlay));
}

function cancelDiscoverHeroTrailerExpansion(overlay = document.getElementById('discover-media-profile')) {
  const preview = getDiscoverHeroTrailerPreviewElement(overlay);
  if (!preview || !activeDiscoverHeroTrailerExpansionState) {
    resetDiscoverHeroTrailerExpansionState(overlay);
    return;
  }
  closeDiscoverHeroTrailerLandscapeMode(overlay, { refresh: false });
  overlay?.classList?.remove('media-profile-trailer-fullscreen', 'media-profile-trailer-expanding');
  overlay?.classList?.add('media-profile-trailer-collapsing');
  activeDiscoverHeroTrailerExpansionState.direction = 'collapse';
  animateDiscoverHeroTrailerExpansionTo(overlay, 0, () => resetDiscoverHeroTrailerExpansionState(overlay));
}

function collapseDiscoverHeroTrailerPreview(overlay = document.getElementById('discover-media-profile'), options = {}) {
  if (!overlay?.classList?.contains('media-profile-trailer-fullscreen') && !overlay?.classList?.contains('media-profile-trailer-collapsing')) return false;
  closeDiscoverHeroTrailerLandscapeMode(overlay, { refresh: false });
  stopDiscoverHeroTrailerProgressLoop(getDiscoverHeroTrailerPreviewElement(overlay));
  overlay.classList.remove('media-profile-trailer-fullscreen', 'media-profile-trailer-expanding');
  overlay.classList.add('media-profile-trailer-collapsing', 'media-profile-trailer-aspect-preserve');
  document.body.classList.remove('media-profile-trailer-fullscreen-active');
  document.body.classList.add('media-profile-trailer-transition-active');
  if (activeDiscoverHeroTrailerExpansionState) activeDiscoverHeroTrailerExpansionState.direction = 'collapse';
  if (options.immediate) {
    resetDiscoverHeroTrailerExpansionState(overlay);
    return true;
  }
  return animateDiscoverHeroTrailerExpansionTo(overlay, 0, () => resetDiscoverHeroTrailerExpansionState(overlay));
}

function restoreDiscoverHeroTrailerFullscreen(overlay = document.getElementById('discover-media-profile')) {
  if (!hasDiscoverHeroTrailerPreview(overlay)) return false;
  overlay?.classList?.add('media-profile-trailer-expanding');
  if (activeDiscoverHeroTrailerExpansionState) activeDiscoverHeroTrailerExpansionState.direction = 'expand';
  return animateDiscoverHeroTrailerExpansionTo(overlay, 1, () => finishDiscoverHeroTrailerExpansion(overlay));
}

function isDiscoverHeroTrailerFullscreen(overlay = document.getElementById('discover-media-profile')) {
  return !!overlay?.classList?.contains('media-profile-trailer-fullscreen');
}

function isDiscoverHeroTrailerLandscape(overlay = document.getElementById('discover-media-profile')) {
  return !!overlay?.classList?.contains('media-profile-trailer-landscape');
}

function closeDiscoverHeroTrailerLandscapeMode(overlay = document.getElementById('discover-media-profile'), options = {}) {
  if (!isDiscoverHeroTrailerLandscape(overlay)) return false;
  overlay.classList.remove('media-profile-trailer-landscape');
  document.body.classList.remove('media-profile-trailer-landscape-active');
  overlay.querySelectorAll?.('.discover-media-hero-preview-native-fullscreen')?.forEach(button => {
    button.setAttribute('aria-label', 'Open landscape trailer');
  });
  setDiscoverHeroTrailerControlsVisible(overlay, true);
  if (options.refresh !== false) refreshDiscoverHeroTrailerFullscreenLayout();
  return true;
}

function setDiscoverHeroTrailerControlsVisible(overlay = document.getElementById('discover-media-profile'), visible = true) {
  if (!isDiscoverHeroTrailerFullscreen(overlay)) return;
  overlay.classList.toggle('media-profile-trailer-controls-hidden', !visible);
  overlay.style.setProperty('--media-profile-trailer-controls-opacity', visible ? '1' : '0');
}

function toggleDiscoverHeroTrailerControls(overlay = document.getElementById('discover-media-profile')) {
  if (!isDiscoverHeroTrailerFullscreen(overlay)) return;
  setDiscoverHeroTrailerControlsVisible(overlay, overlay.classList.contains('media-profile-trailer-controls-hidden'));
}

function handleDiscoverMediaProfileBack(event) {
  const overlay = document.getElementById('discover-media-profile');
  if (isDiscoverHeroTrailerLandscape(overlay)) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    collapseDiscoverHeroTrailerPreview(overlay);
    return false;
  }
  if (isDiscoverHeroTrailerFullscreen(overlay)) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    collapseDiscoverHeroTrailerPreview(overlay);
    return false;
  }
  if (overlay?.classList?.contains('game-media-profile-overlay') && typeof closeGameMediaProfile === 'function') {
    closeGameMediaProfile('back');
  } else {
    closeDiscoverMediaProfile('back');
  }
  return false;
}
window.handleDiscoverMediaProfileBack = handleDiscoverMediaProfileBack;

function refreshDiscoverHeroTrailerFullscreenLayout() {
  const overlay = document.getElementById('discover-media-profile');
  if (!isDiscoverHeroTrailerFullscreen(overlay)) return;
  if (activeDiscoverHeroTrailerExpansionState?.overlay === overlay) {
    activeDiscoverHeroTrailerExpansionState.viewport = getDiscoverTrailerViewportSize();
  }
  applyDiscoverHeroTrailerExpansionProgress(overlay, 1);
}

window.addEventListener('resize', refreshDiscoverHeroTrailerFullscreenLayout, { passive: true });
window.visualViewport?.addEventListener?.('resize', refreshDiscoverHeroTrailerFullscreenLayout, { passive: true });

function loadDiscoverYoutubeIframeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (discoverYoutubeIframeApiPromise) return discoverYoutubeIframeApiPromise;
  discoverYoutubeIframeApiPromise = new Promise((resolve) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function onDiscoverYouTubeIframeApiReady() {
      if (typeof previousReady === 'function') {
        try { previousReady(); } catch (error) { console.warn('Previous YouTube iframe ready handler failed:', error); }
      }
      resolve(window.YT);
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      document.head.appendChild(tag);
    }
  });
  return discoverYoutubeIframeApiPromise;
}

function getDiscoverHeroTrailerIframe(overlay = document.getElementById('discover-media-profile')) {
  return overlay?.querySelector?.('[data-discover-trailer-preview-frame] iframe') || null;
}

function sendDiscoverHeroTrailerCommand(iframe, command, args = []) {
  if (!iframe?.contentWindow || !command) return false;
  try {
    iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: command, args }), '*');
    return true;
  } catch (error) {
    console.warn('Discover trailer command failed:', command, error);
    return false;
  }
}

function formatDiscoverTrailerTime(seconds = 0) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function updateDiscoverHeroTrailerPlayButton(preview, playing = true) {
  const button = preview?.querySelector?.('[data-discover-trailer-play]');
  if (!button) return;
  button.dataset.playing = playing ? 'true' : 'false';
  button.setAttribute('aria-label', playing ? 'Pause trailer' : 'Play trailer');
  button.innerHTML = playing
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7Z"/></svg>';
}

function updateDiscoverHeroTrailerProgress(preview) {
  const player = preview?._discoverTrailerPlayer;
  if (!player || typeof player.getCurrentTime !== 'function' || typeof player.getDuration !== 'function') return;
  let current = 0;
  let duration = 0;
  try {
    current = Number(player.getCurrentTime() || 0);
    duration = Number(player.getDuration() || 0);
  } catch (error) {
    return;
  }
  const range = preview.querySelector('[data-discover-trailer-scrub]');
  const time = preview.querySelector('[data-discover-trailer-time]');
  const pct = duration > 0 ? Math.max(0, Math.min(1, current / duration)) : 0;
  if (range && range.dataset.scrubbing !== 'true') range.value = String(Math.round(pct * 1000));
  if (time) time.textContent = duration > 0 ? `${formatDiscoverTrailerTime(current)} / ${formatDiscoverTrailerTime(duration)}` : formatDiscoverTrailerTime(current);
  preview.style.setProperty('--media-profile-trailer-progress-fill', `${(pct * 100).toFixed(2)}%`);
}

function startDiscoverHeroTrailerProgressLoop(preview) {
  if (!preview || preview._discoverTrailerProgressTimer) return;
  updateDiscoverHeroTrailerProgress(preview);
  preview._discoverTrailerProgressTimer = window.setInterval(() => updateDiscoverHeroTrailerProgress(preview), 350);
}

function stopDiscoverHeroTrailerProgressLoop(preview) {
  if (!preview?._discoverTrailerProgressTimer) return;
  window.clearInterval(preview._discoverTrailerProgressTimer);
  preview._discoverTrailerProgressTimer = null;
}

function ensureDiscoverHeroTrailerPlayer(overlay = document.getElementById('discover-media-profile')) {
  const preview = getDiscoverHeroTrailerPreviewElement(overlay);
  const iframe = getDiscoverHeroTrailerIframe(overlay);
  if (!preview || !iframe) return Promise.resolve(null);
  if (preview._discoverTrailerPlayer) return Promise.resolve(preview._discoverTrailerPlayer);
  if (!iframe.id) iframe.id = `discover-hero-trailer-player-${Date.now()}-${Math.round(Math.random() * 100000)}`;
  return loadDiscoverYoutubeIframeApi().then((YT) => {
    if (!YT?.Player || preview._discoverTrailerPlayer || !iframe.isConnected) return preview._discoverTrailerPlayer || null;
    preview._discoverTrailerPlayer = new YT.Player(iframe.id, {
      events: {
        onReady: () => {
          updateDiscoverHeroTrailerProgress(preview);
          updateDiscoverHeroTrailerPlayButton(preview, true);
        },
        onStateChange: (event) => {
          const playing = Number(event?.data) === 1;
          const pausedOrEnded = Number(event?.data) === 2 || Number(event?.data) === 0;
          if (playing || pausedOrEnded) updateDiscoverHeroTrailerPlayButton(preview, playing);
          updateDiscoverHeroTrailerProgress(preview);
        }
      }
    });
    return preview._discoverTrailerPlayer;
  }).catch((error) => {
    console.warn('Discover trailer player controls unavailable:', error);
    return null;
  });
}

function getDiscoverHeroTrailerThumbnail(key = '') {
  const safeKey = String(key || '').trim();
  return safeKey ? `https://i.ytimg.com/vi/${encodeURIComponent(safeKey)}/hqdefault.jpg` : '';
}

function destroyDiscoverHeroTrailerPreview(overlay = document.getElementById('discover-media-profile')) {
  resetDiscoverHeroTrailerExpansionState(overlay);
  if (typeof activeDiscoverHeroTrailerPreviewCleanup === 'function') {
    try {
      activeDiscoverHeroTrailerPreviewCleanup();
    } catch (error) {
      console.warn('Discover hero trailer preview cleanup skipped:', error);
    }
  }
  activeDiscoverHeroTrailerPreviewCleanup = null;
  const preview = overlay?.querySelector?.('[data-discover-hero-trailer-preview]');
  if (!preview) return;
  if (preview._discoverTrailerWarmTimer) {
    window.clearTimeout(preview._discoverTrailerWarmTimer);
    preview._discoverTrailerWarmTimer = 0;
  }
  if (preview._discoverTrailerWarmIdleId && typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(preview._discoverTrailerWarmIdleId);
    preview._discoverTrailerWarmIdleId = 0;
  }
  preview._discoverTrailerPlayerWarmPromise = null;
  preview.classList.remove('is-loading', 'is-ready');
  const frame = preview.querySelector('[data-discover-trailer-preview-frame]');
  if (frame) frame.replaceChildren();
  preview.style.removeProperty('--discover-trailer-preview-bottom');
}

function bindDiscoverHeroTrailerPreviewBounds(overlay = document.getElementById('discover-media-profile')) {
  return () => {};
}

function shouldAutoplayDiscoverHeroTrailerPreview() {
  try {
    return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (error) {
    return true;
  }
}

function openDiscoverHeroTrailer(event, button) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const trigger = button?.closest?.('[data-discover-hero-trailer-preview]') || button;
  const trailerKey = String(trigger?.dataset?.trailerKey || '').trim();
  const trailerTitle = String(trigger?.dataset?.trailerTitle || '').trim();
  if (!trailerKey) return;
  const overlay = document.getElementById('discover-media-profile');
  if (isDiscoverHeroTrailerFullscreen(overlay)) {
    if (!event?.target?.closest?.('[data-discover-trailer-control], .discover-media-back, .discover-media-hero-preview-sound')) {
      toggleDiscoverHeroTrailerControls(overlay);
    }
    return;
  }
  if (expandDiscoverHeroTrailerPreview(overlay)) return;
  if (typeof window.showTrailerModal === 'function') {
    window.showTrailerModal(trailerKey, trailerTitle);
    return;
  }
  if (typeof showTrailerModal === 'function') {
    showTrailerModal(trailerKey, trailerTitle);
    return;
  }
  window.open(`https://www.youtube.com/watch?v=${encodeURIComponent(trailerKey)}`, '_blank', 'noopener');
}
window.openDiscoverHeroTrailer = openDiscoverHeroTrailer;

function hydrateDiscoverHeroTrailerPreview(overlay = document.getElementById('discover-media-profile')) {
  destroyDiscoverHeroTrailerPreview(overlay);
  const preview = overlay?.querySelector?.('[data-discover-hero-trailer-preview]');
  const frame = preview?.querySelector?.('[data-discover-trailer-preview-frame]');
  const trailerKey = String(preview?.dataset?.trailerKey || '').trim();
  if (!preview || !frame || !trailerKey) return;
  const releaseBounds = bindDiscoverHeroTrailerPreviewBounds(overlay);
  if (!shouldAutoplayDiscoverHeroTrailerPreview()) {
    activeDiscoverHeroTrailerPreviewCleanup = () => {
      releaseBounds();
      if (preview.isConnected) preview.classList.remove('is-loading', 'is-ready');
    };
    return;
  }
  preview.classList.add('is-loading');
  const iframe = document.createElement('iframe');
  const params = new URLSearchParams({
    autoplay: '1',
    mute: '1',
    controls: '0',
    disablekb: '1',
    fs: '1',
    playsinline: '1',
    rel: '0',
    modestbranding: '1',
    iv_load_policy: '3',
    loop: '1',
    playlist: trailerKey,
    enablejsapi: '1',
    origin: window.location.origin
  });
  iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(trailerKey)}?${params.toString()}`;
  iframe.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
  iframe.allowFullscreen = true;
  iframe.setAttribute('allowfullscreen', '');
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  iframe.tabIndex = -1;
  iframe.title = '';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.onload = () => {
    if (!preview.isConnected) return;
    preview.classList.remove('is-loading');
    preview.classList.add('is-ready');
    if (shouldWarmDiscoverHeroTrailerHandoff(overlay)) {
      warmDiscoverHeroTrailerPlayerBeforeHandoff(overlay);
    } else {
      ensureDiscoverHeroTrailerPlayer(overlay);
    }
  };
  frame.appendChild(iframe);
  if (shouldWarmDiscoverHeroTrailerHandoff(overlay)) {
    warmDiscoverHeroTrailerPlayerBeforeHandoff(overlay);
  }
  activeDiscoverHeroTrailerPreviewCleanup = () => {
    releaseBounds();
    stopDiscoverHeroTrailerProgressLoop(preview);
    if (preview._discoverTrailerWarmTimer) {
      window.clearTimeout(preview._discoverTrailerWarmTimer);
      preview._discoverTrailerWarmTimer = 0;
    }
    if (preview._discoverTrailerWarmIdleId && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(preview._discoverTrailerWarmIdleId);
      preview._discoverTrailerWarmIdleId = 0;
    }
    preview._discoverTrailerPlayerWarmPromise = null;
    iframe.onload = null;
    preview._discoverTrailerPlayer = null;
    try { iframe.src = 'about:blank'; } catch (error) { /* noop */ }
    frame.replaceChildren();
    if (preview.isConnected) preview.classList.remove('is-loading', 'is-ready');
  };
}

function renderDiscoverHeroTrailerPreview(trailer, title = '') {
  const trailerKey = String(trailer?.key || '').trim();
  if (!trailerKey) return '';
  const thumb = getDiscoverHeroTrailerThumbnail(trailerKey);
  return `<div class="discover-media-hero-preview" role="button" tabindex="0" data-discover-hero-trailer-preview data-trailer-key="${escAttr(trailerKey)}" data-trailer-title="${escAttr(title)}" onclick="openDiscoverHeroTrailer(event, this)" onkeydown="handleDiscoverHeroTrailerPreviewKeydown(event, this)" aria-label="${escAttr(`Expand trailer for ${title || 'this title'}`)}">
    <span class="discover-media-hero-preview-media">
      ${thumb ? `<span class="discover-media-hero-preview-thumb" style="background-image:url('${escAttr(thumb)}')"></span>` : ''}
      <span class="discover-media-hero-preview-frame" data-discover-trailer-preview-frame></span>
    </span>
    <span class="discover-media-hero-preview-controls" data-discover-trailer-controls onclick="event.stopPropagation()">
      <button class="discover-media-hero-preview-play" type="button" data-discover-trailer-control data-discover-trailer-play data-playing="true" onclick="toggleDiscoverHeroTrailerPlayback(event, this)" aria-label="Pause trailer">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>
      </button>
      <span class="discover-media-hero-preview-scrub-wrap" data-discover-trailer-control>
        <input class="discover-media-hero-preview-scrub" type="range" min="0" max="1000" value="0" step="1" data-discover-trailer-scrub onpointerdown="beginDiscoverHeroTrailerScrub(event, this)" oninput="scrubDiscoverHeroTrailer(event, this)" onchange="scrubDiscoverHeroTrailer(event, this, true)" onpointerup="endDiscoverHeroTrailerScrub(event, this)" aria-label="Trailer progress">
      </span>
      <span class="discover-media-hero-preview-time" data-discover-trailer-time>0:00</span>
      <button class="discover-media-hero-preview-native-fullscreen" type="button" data-discover-trailer-control onclick="openDiscoverHeroTrailerNativeFullscreen(event, this)" aria-label="Open landscape trailer">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/></svg>
      </button>
    </span>
  </div>`;
}

function handleDiscoverHeroTrailerPreviewKeydown(event, preview) {
  if (event?.key !== 'Enter' && event?.key !== ' ') return;
  event.preventDefault();
  openDiscoverHeroTrailer(event, preview);
}
window.handleDiscoverHeroTrailerPreviewKeydown = handleDiscoverHeroTrailerPreviewKeydown;

function renderDiscoverHeroTrailerPreviewCta(trailer, title = '') {
  const trailerKey = String(trailer?.key || '').trim();
  if (!trailerKey) return '';
  /* v10.122: button text changed from "Full Screen" → "Trailer". Same
     click behavior (still opens the fullscreen trailer player); just a
     friendlier label paired with the new sound-toggle button rendered
     directly below it. */
  return `<button class="discover-media-hero-preview-cta" type="button" data-trailer-key="${escAttr(trailerKey)}" data-trailer-title="${escAttr(title)}" onclick="openDiscoverHeroTrailer(event, this)" aria-label="${escAttr(`Open full screen trailer for ${title || 'this title'}`)}">Trailer</button>`;
}

/* v10.122: Inline sound toggle for the FPMP hero trailer preview.

   Renders a circular icon-only button directly below the "Trailer" CTA.
   The inline YouTube iframe always starts muted on every FPMP open
   (autoplay-mute is required by browsers, and we never persist the
   unmuted state across profile opens). Tapping the button posts the
   YouTube IFrame API `mute` / `unMute` command to the embed via
   postMessage; the embed loads with enablejsapi=1 (see
   hydrateDiscoverHeroTrailerPreview), so the command takes effect
   without needing a full YT.Player instance. */
function renderDiscoverHeroTrailerSoundToggle(trailer) {
  const trailerKey = String(trailer?.key || '').trim();
  if (!trailerKey) return '';
  return `<button class="discover-media-hero-preview-sound" type="button" data-sound-state="muted" onclick="toggleDiscoverHeroTrailerSound(event, this)" aria-label="Unmute trailer audio" aria-pressed="false">
    <svg class="discover-media-hero-preview-sound-icon discover-media-hero-preview-sound-icon-muted" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.17v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9zM12 4 9.91 6.09 12 8.18z"/>
    </svg>
    <svg class="discover-media-hero-preview-sound-icon discover-media-hero-preview-sound-icon-unmuted" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 9v6h4l5 5V4L7 9zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
    </svg>
  </button>`;
}

function toggleDiscoverHeroTrailerSound(event, btn) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if (!btn) return;
  const overlay = btn.closest('.discover-media-profile-overlay');
  const iframe = overlay?.querySelector?.('[data-discover-trailer-preview-frame] iframe');
  if (!iframe || !iframe.contentWindow) return;
  const wasMuted = btn.dataset.soundState !== 'unmuted';
  const func = wasMuted ? 'unMute' : 'mute';
  try {
    iframe.contentWindow.postMessage(
      JSON.stringify({ event: 'command', func, args: [] }),
      '*'
    );
  } catch (error) {
    return;
  }
  const nextState = wasMuted ? 'unmuted' : 'muted';
  btn.dataset.soundState = nextState;
  btn.setAttribute('aria-label', wasMuted ? 'Mute trailer audio' : 'Unmute trailer audio');
  btn.setAttribute('aria-pressed', wasMuted ? 'true' : 'false');
}
window.toggleDiscoverHeroTrailerSound = toggleDiscoverHeroTrailerSound;

function toggleDiscoverHeroTrailerPlayback(event, btn) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const overlay = btn?.closest?.('.discover-media-profile-overlay, .game-media-profile-overlay');
  const preview = getDiscoverHeroTrailerPreviewElement(overlay);
  const iframe = getDiscoverHeroTrailerIframe(overlay);
  if (!preview || !iframe) return;
  const isPlaying = btn.dataset.playing !== 'false';
  const command = isPlaying ? 'pauseVideo' : 'playVideo';
  sendDiscoverHeroTrailerCommand(iframe, command);
  ensureDiscoverHeroTrailerPlayer(overlay).then((player) => {
    try {
      if (player && typeof player[command] === 'function') player[command]();
    } catch (error) { /* postMessage fallback already sent */ }
    updateDiscoverHeroTrailerPlayButton(preview, !isPlaying);
    updateDiscoverHeroTrailerProgress(preview);
  });
}
window.toggleDiscoverHeroTrailerPlayback = toggleDiscoverHeroTrailerPlayback;

function beginDiscoverHeroTrailerScrub(event, input) {
  event?.stopPropagation?.();
  if (input) input.dataset.scrubbing = 'true';
}
window.beginDiscoverHeroTrailerScrub = beginDiscoverHeroTrailerScrub;

function scrubDiscoverHeroTrailer(event, input, commit = false) {
  event?.stopPropagation?.();
  const overlay = input?.closest?.('.discover-media-profile-overlay, .game-media-profile-overlay');
  const preview = getDiscoverHeroTrailerPreviewElement(overlay);
  if (!input || !preview) return;
  const pct = Math.max(0, Math.min(1, Number(input.value || 0) / 1000));
  preview.style.setProperty('--media-profile-trailer-progress-fill', `${(pct * 100).toFixed(2)}%`);
  const player = preview._discoverTrailerPlayer;
  if (!player || typeof player.getDuration !== 'function' || typeof player.seekTo !== 'function') return;
  let duration = 0;
  try { duration = Number(player.getDuration() || 0); } catch (error) { duration = 0; }
  if (duration <= 0) return;
  const target = duration * pct;
  const time = preview.querySelector('[data-discover-trailer-time]');
  if (time) time.textContent = `${formatDiscoverTrailerTime(target)} / ${formatDiscoverTrailerTime(duration)}`;
  try { player.seekTo(target, !!commit); } catch (error) { /* noop */ }
}
window.scrubDiscoverHeroTrailer = scrubDiscoverHeroTrailer;

function endDiscoverHeroTrailerScrub(event, input) {
  event?.stopPropagation?.();
  if (!input) return;
  scrubDiscoverHeroTrailer(event, input, true);
  input.dataset.scrubbing = 'false';
}
window.endDiscoverHeroTrailerScrub = endDiscoverHeroTrailerScrub;

async function openDiscoverHeroTrailerNativeFullscreen(event, btn) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const overlay = btn?.closest?.('.discover-media-profile-overlay, .game-media-profile-overlay');
  const preview = getDiscoverHeroTrailerPreviewElement(overlay);
  if (!overlay || !preview) return;
  if (!isDiscoverHeroTrailerFullscreen(overlay)) expandDiscoverHeroTrailerPreview(overlay, { immediate: true });
  if (isDiscoverHeroTrailerLandscape(overlay)) {
    closeDiscoverHeroTrailerLandscapeMode(overlay);
    btn?.setAttribute?.('aria-label', 'Open landscape trailer');
    return;
  }
  overlay.classList.add('media-profile-trailer-landscape');
  document.body.classList.add('media-profile-trailer-landscape-active');
  setDiscoverHeroTrailerControlsVisible(overlay, true);
  btn?.setAttribute?.('aria-label', 'Exit landscape trailer');
  ensureDiscoverHeroTrailerPlayer(overlay);
  startDiscoverHeroTrailerProgressLoop(preview);
}
window.openDiscoverHeroTrailerNativeFullscreen = openDiscoverHeroTrailerNativeFullscreen;

function getCountryDisplayName(value = '') {
  const clean = String(value || '').trim();
  if (!clean) return '';
  const lower = clean.toLowerCase();
  if (lower === 'united states of america' || lower === 'united states' || lower === 'usa' || lower === 'u.s.a.' || lower === 'us' || lower === 'u.s.') {
    return 'United States';
  }
  if (!/^[a-z]{2}$/i.test(clean)) return clean;
  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
    const display = displayNames.of(clean.toUpperCase()) || clean.toUpperCase();
    return String(display || '').trim().toLowerCase() === 'united states of america' ? 'United States' : display;
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
  /* v11.089: release date is cyan only while still upcoming (not yet out),
     white once released. */
  const isUpcoming = !isDiscoverMediaReleased(details, type);
  if (type === 'movie') {
    const runtime = formatDiscoverMediaRuntime(details.runtime);
    if (runtime) facts.push({ label: 'Runtime', value: runtime, priority: true, kind: 'runtime' });
    if (date) facts.push({ label: 'Released', value: date, priority: true, kind: 'release-date', upcoming: isUpcoming });
    if (country) facts.push({ label: 'Country', value: country, kind: 'country' });
    if (details.status) facts.push({ label: 'Status', value: details.status, kind: 'status' });
    const budget = formatDiscoverMediaMoney(details.budget);
    if (budget) facts.push({ label: 'Budget', value: budget, kind: 'budget' });
    const revenue = formatDiscoverMediaMoney(details.revenue);
    if (revenue) facts.push({ label: 'Box Office', value: revenue, kind: 'box-office' });
    /* v11.015: Members = total IMDb vote count, sourced STRICTLY from
       OMDb (`details.imdbVotes`). The previous v11.014 fallback to
       `details.vote_count` was the bug — `vote_count` is TMDB's
       internal vote count (often <10K for popular shows), which
       caused "Members 5,000" on titles that have 500K+ IMDb votes.
       Per user spec: OMDb/IMDb is the only acceptable source. If
       OMDb enrichment didn't deliver, the fact is omitted entirely
       — better to hide it than to show TMDB's wrong number. */
    const movieMembers = Number(details.imdbVotes || 0);
    if (movieMembers > 0) {
      facts.push({ label: 'Members', value: movieMembers.toLocaleString('en-US'), kind: 'members' });
    }
  } else {
    /* v11.091: anime season/episode counts render WHITE (not the gold primary
       style) and carry kind hooks so the real series totals (assembled from
       Jikan across all seasons) can patch them after load. TV keeps gold. */
    const isAnimeProfile = !!(details.isAnime || details.mediaCategory === 'anime');
    if (details.number_of_seasons) facts.push({ label: 'Seasons', value: String(details.number_of_seasons), priority: !isAnimeProfile, kind: 'seasons' });
    if (details.number_of_episodes) {
      /* v11.398: show the count of episodes that are CURRENTLY OUT, not the full
         confirmed total (which includes unaired upcoming seasons). */
      const airedEps = (typeof computeShelfdAiredEpisodeCount === 'function') ? computeShelfdAiredEpisodeCount(details) : 0;
      const epValue = airedEps > 0 ? airedEps : Number(details.number_of_episodes || 0);
      facts.push({ label: 'Episodes', value: String(epValue), priority: !isAnimeProfile, kind: 'episodes' });
    }
    /* v676: MyAnimeList Members count — only present for Jikan-sourced
       anime (mapJikanFullToTmdbDetails sets `details.malMembers`).
       v11.015: for TMDB-sourced TV that LACKS malMembers, fall back to
       `details.imdbVotes` (populated by OMDb enrichment). TMDB's
       `vote_count` is NEVER used as a Members source per user spec
       (v11.014 mistakenly fell back to it — see fix block above). */
    if (Number(details.malMembers) > 0) {
      facts.push({
        label: 'Members',
        value: Number(details.malMembers).toLocaleString('en-US'),
        priority: true,
        kind: 'members'
      });
    } else if (Number(details.imdbVotes || 0) > 0) {
      facts.push({
        label: 'Members',
        value: Number(details.imdbVotes).toLocaleString('en-US'),
        priority: true,
        kind: 'members'
      });
    }
    if (date) facts.push({ label: 'First Aired', value: date, kind: 'first-aired', upcoming: isUpcoming });
    if (country) facts.push({ label: 'Country', value: country, kind: 'country' });
    if (details.status) facts.push({ label: 'Status', value: details.status, kind: 'status' });
    if (details.type) facts.push({ label: 'Type', value: details.type, kind: 'type' });
  }
  /* v676: bumped 6 → 7 so anime can fit Members alongside the other six.
     v11.014: still 7 — Members slot is now used by movies + TV too. */
  return facts.slice(0, 7);
}

function getDiscoverMediaFactClass(fact = {}) {
  return [
    fact.priority ? 'primary' : '',
    fact.kind ? `discover-media-fact-${String(fact.kind).replace(/[^a-z0-9_-]+/gi, '-').toLowerCase()}` : '',
    fact.upcoming ? 'upcoming' : ''
  ].filter(Boolean).join(' ');
}

function getDiscoverSimilarType(item, fallbackType) {
  return item?.media_type === 'movie' || item?.media_type === 'tv' ? item.media_type : fallbackType;
}


const deepSeekMoreLikeThisCache = new Map();
const shelfdMoreLikeThisDetailCache = new Map();

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

function normalizeMoreLikeThisSignal(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getMoreLikeThisYearValue(item = {}, type = '') {
  const raw = type === 'game'
    ? (item.released || item.year || '')
    : (item.release_date || item.first_air_date || item.year || '');
  return Number(String(raw || '').slice(0, 4)) || 0;
}

function getMoreLikeThisNameSet(values = []) {
  const out = new Set();
  (Array.isArray(values) ? values : [values]).forEach(value => {
    if (!value) return;
    if (typeof value === 'object') {
      [
        value.id,
        value.name,
        value.title,
        value.slug,
        value.platform?.name,
        value.company?.name,
        value.person?.name
      ].forEach(v => {
        const key = normalizeMoreLikeThisSignal(v);
        if (key) out.add(key);
      });
      return;
    }
    const key = normalizeMoreLikeThisSignal(value);
    if (key) out.add(key);
  });
  return out;
}

function getMoreLikeThisGenreSet(item = {}) {
  const out = new Set();
  (Array.isArray(item.genres) ? item.genres : []).forEach(genre => {
    const id = String(genre?.id || genre?.mal_id || '').trim();
    const name = normalizeMoreLikeThisSignal(genre?.name || genre);
    if (id) out.add(`id:${id}`);
    if (name) out.add(name);
  });
  (Array.isArray(item.genre_ids) ? item.genre_ids : []).forEach(id => {
    const clean = String(id || '').trim();
    if (clean) out.add(`id:${clean}`);
  });
  return out;
}

function getMoreLikeThisKeywordSet(item = {}, type = '') {
  const source = type === 'game'
    ? [item.tags, item.themes]
    : [item.keywords?.keywords, item.keywords?.results, item.tags, item.themes, item.demographics];
  const out = new Set();
  source.forEach(list => {
    (Array.isArray(list) ? list : []).forEach(entry => {
      const id = String(entry?.id || entry?.mal_id || '').trim();
      const name = normalizeMoreLikeThisSignal(entry?.name || entry);
      if (id) out.add(`id:${id}`);
      if (name) out.add(name);
    });
  });
  return out;
}

function getMoreLikeThisPeopleStudioSet(item = {}, type = '') {
  const out = new Set();
  const add = value => {
    const key = normalizeMoreLikeThisSignal(value);
    if (key) out.add(key);
  };
  if (type === 'game') {
    ['developers', 'publishers', 'stores'].forEach(key => {
      (Array.isArray(item[key]) ? item[key] : []).forEach(entry => add(entry?.name || entry));
    });
    return out;
  }
  (Array.isArray(item.created_by) ? item.created_by : []).forEach(person => add(person?.name || person));
  (Array.isArray(item.production_companies) ? item.production_companies : []).forEach(company => add(company?.name || company));
  (Array.isArray(item.networks) ? item.networks : []).forEach(network => add(network?.name || network));
  const crew = Array.isArray(item.credits?.crew) ? item.credits.crew : [];
  crew.forEach(person => {
    const job = String(person?.job || '').toLowerCase();
    if (job === 'director' || job === 'showrunner' || job === 'creator' || job === 'writer' || job === 'screenplay') {
      add(person?.name);
    }
  });
  const cast = Array.isArray(item.credits?.cast) ? item.credits.cast : [];
  cast.slice(0, 12).forEach(person => add(person?.name));
  const characterCast = Array.isArray(item.credits?.characters) ? item.credits.characters : [];
  characterCast.slice(0, 12).forEach(person => add(person?.name));
  (Array.isArray(item.studios) ? item.studios : []).forEach(studio => add(studio?.name || studio));
  (Array.isArray(item.producers) ? item.producers : []).forEach(producer => add(producer?.name || producer));
  return out;
}

function getMoreLikeThisPlatformSet(item = {}) {
  const out = new Set();
  [
    item.platforms,
    item.parent_platforms
  ].forEach(list => {
    (Array.isArray(list) ? list : []).forEach(entry => {
      const name = entry?.platform?.name || entry?.name || entry;
      const key = normalizeMoreLikeThisSignal(name);
      if (key) out.add(key);
    });
  });
  return out;
}

function getMoreLikeThisFranchiseScore(source = {}, candidate = {}, type = '') {
  const sourceTitle = normalizeMoreLikeThisComparableTitle(type === 'game' ? getGameTitleValue(source) : getDiscoverMediaTitle(source, type));
  const candidateTitle = normalizeMoreLikeThisComparableTitle(candidate.title || candidate.name || '');
  if (!sourceTitle || !candidateTitle || sourceTitle === candidateTitle) return 0;
  const sourceCollection = source.belongs_to_collection;
  const candidateCollection = candidate.belongs_to_collection;
  const sourceCollectionId = String(sourceCollection?.id || '').trim();
  const candidateCollectionId = String(candidateCollection?.id || '').trim();
  if (sourceCollectionId && candidateCollectionId && sourceCollectionId === candidateCollectionId) return 1;
  const sourceCollectionName = normalizeMoreLikeThisComparableTitle(sourceCollection?.name || '');
  const candidateCollectionName = normalizeMoreLikeThisComparableTitle(candidateCollection?.name || '');
  if (sourceCollectionName && candidateCollectionName && sourceCollectionName === candidateCollectionName) return 0.9;
  const sourceWords = sourceTitle.split(' ').filter(word => word.length > 3);
  const candidateWords = candidateTitle.split(' ').filter(word => word.length > 3);
  const overlap = sourceWords.filter(word => candidateWords.includes(word)).length;
  if (overlap >= 2) return 0.55;
  if (overlap >= 1 && (sourceTitle.includes(candidateTitle) || candidateTitle.includes(sourceTitle))) return 0.45;
  return 0;
}

function getMoreLikeThisSetOverlapScore(a = new Set(), b = new Set()) {
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  a.forEach(value => { if (b.has(value)) overlap += 1; });
  return overlap / Math.max(1, Math.min(a.size, b.size));
}

function getMoreLikeThisReleaseEraScore(source = {}, candidate = {}, type = '') {
  const sourceYear = getMoreLikeThisYearValue(source, type);
  const candidateYear = getMoreLikeThisYearValue(candidate, type);
  if (!sourceYear || !candidateYear) return 0;
  const diff = Math.abs(sourceYear - candidateYear);
  if (diff <= 2) return 1;
  if (diff <= 5) return 0.82;
  if (diff <= 10) return 0.58;
  if (diff <= 20) return 0.28;
  return 0;
}

function getMoreLikeThisRatingQualityScore(item = {}, type = '') {
  const rating = Number(type === 'game' ? (item.metacritic ? item.metacritic / 10 : item.rating * 2) : (item.vote_average || item.score || 0));
  const votes = Number(type === 'game'
    ? (item.ratings_count || item.added || item.total_rating_count || 0)
    : (item.vote_count || item.scored_by || item.members || 0));
  const ratingN = Math.max(0, Math.min(1, rating / 10));
  const voteN = Math.max(0, Math.min(1, Math.log10(Math.max(1, votes + 1)) / 6));
  return (ratingN * 0.72) + (voteN * 0.28);
}

function getMoreLikeThisPopularityScore(item = {}, type = '') {
  const raw = type === 'game'
    ? (Number(item.added || 0) + Number(item.ratings_count || 0) + Number(item.metacritic || 0))
    : (Number(item.popularity || 0) + Number(item.vote_count || 0) + Number(item.members || 0));
  return Math.max(0, Math.min(1, Math.log10(Math.max(1, raw + 1)) / 7));
}

function getMoreLikeThisMetadataScore(item = {}, type = '') {
  let score = 0;
  if (getDatabaseMoreLikeThisImage(item, type)) score += 0.32;
  if (getMoreLikeThisYearValue(item, type)) score += 0.18;
  if (String(item.overview || item.description_raw || item.description || item.synopsis || '').trim().length > 20) score += 0.20;
  if (String(item.id || item.rawgId || item.mal_id || '').trim()) score += 0.15;
  if (getMoreLikeThisGenreSet(item).size) score += 0.15;
  return Math.min(1, score);
}

function getMoreLikeThisProviderScore(item = {}) {
  const source = String(item.__shelfdMoreLikeThisSource || '').toLowerCase();
  const index = Number(item.__shelfdMoreLikeThisIndex || 0);
  const rankScore = Math.max(0, 1 - (index / 28));
  if (source === 'recommendations') return 0.72 + (rankScore * 0.28);
  if (source === 'similar') return 0.54 + (rankScore * 0.24);
  if (source === 'rawg') return 0.58 + (rankScore * 0.24);
  if (source === 'jikan') return 0.68 + (rankScore * 0.24);
  return 0.44 + (rankScore * 0.18);
}

function getMoreLikeThisSignals(item = {}, type = '') {
  return {
    genres: getMoreLikeThisGenreSet(item),
    keywords: getMoreLikeThisKeywordSet(item, type),
    peopleStudios: getMoreLikeThisPeopleStudioSet(item, type),
    platforms: type === 'game' ? getMoreLikeThisPlatformSet(item) : new Set()
  };
}

function scoreMoreLikeThisCandidate(sourceDetails = {}, candidate = {}, mediaType = 'movie') {
  const type = mediaType === 'game' ? 'game' : (mediaType === 'tv' ? 'tv' : 'movie');
  const raw = candidate.raw || candidate;
  const sourceSignals = getMoreLikeThisSignals(sourceDetails, type);
  const candidateSignals = getMoreLikeThisSignals(raw, type);
  const providerRecommendationScore = getMoreLikeThisProviderScore(raw);
  const genreOverlapScore = getMoreLikeThisSetOverlapScore(sourceSignals.genres, candidateSignals.genres);
  const keywordTagOverlapScore = getMoreLikeThisSetOverlapScore(sourceSignals.keywords, candidateSignals.keywords);
  const peopleStudioCreatorOverlapScore = getMoreLikeThisSetOverlapScore(sourceSignals.peopleStudios, candidateSignals.peopleStudios);
  const platformOverlapScore = type === 'game' ? getMoreLikeThisSetOverlapScore(sourceSignals.platforms, candidateSignals.platforms) : 0;
  const franchiseCollectionScore = getMoreLikeThisFranchiseScore(sourceDetails, raw, type);
  const releaseEraScore = getMoreLikeThisReleaseEraScore(sourceDetails, raw, type);
  const ratingQualityScore = getMoreLikeThisRatingQualityScore(raw, type);
  const popularityConfidenceScore = getMoreLikeThisPopularityScore(raw, type);
  const metadataCompletenessScore = getMoreLikeThisMetadataScore(raw, type);

  const weights = type === 'game'
    ? {
        provider: 0.14, genre: 0.20, keyword: 0.24, people: 0.13, franchise: 0.10,
        era: 0.05, rating: 0.06, popularity: 0.04, metadata: 0.02, platform: 0.02
      }
    : {
        provider: 0.16, genre: 0.22, keyword: 0.18, people: 0.15, franchise: 0.10,
        era: 0.07, rating: 0.06, popularity: 0.04, metadata: 0.02, platform: 0
      };

  const score = (
    providerRecommendationScore * weights.provider +
    genreOverlapScore * weights.genre +
    keywordTagOverlapScore * weights.keyword +
    peopleStudioCreatorOverlapScore * weights.people +
    franchiseCollectionScore * weights.franchise +
    releaseEraScore * weights.era +
    ratingQualityScore * weights.rating +
    popularityConfidenceScore * weights.popularity +
    metadataCompletenessScore * weights.metadata +
    platformOverlapScore * weights.platform
  ) * 100;

  const reasons = [];
  if (franchiseCollectionScore >= 0.5) reasons.push('same franchise');
  if (genreOverlapScore >= 0.4) reasons.push('similar genre');
  if (keywordTagOverlapScore >= 0.35) reasons.push(type === 'game' ? 'similar tags' : 'similar themes');
  if (peopleStudioCreatorOverlapScore >= 0.25) reasons.push(type === 'game' ? 'same developer/publisher' : 'shared creator/cast/studio');
  if (!reasons.length && providerRecommendationScore > 0.6) reasons.push('fans also like this');

  return {
    score: Number(score.toFixed(4)),
    breakdown: {
      providerRecommendationScore,
      genreOverlapScore,
      keywordTagOverlapScore,
      peopleStudioCreatorOverlapScore,
      franchiseCollectionScore,
      releaseEraScore,
      ratingQualityScore,
      popularityConfidenceScore,
      metadataCompletenessScore,
      platformOverlapScore
    },
    reason: reasons.slice(0, 2).join(' / ')
  };
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
      source: item?.__jikan ? 'jikan' : (itemType === 'game' ? 'rawg' : 'tmdb'),
      raw: item
    };
  }).filter(Boolean);
}

async function hydrateMoreLikeThisTmdbCandidateDetails(type = 'movie', candidates = []) {
  const hydrateType = type === 'tv' ? 'tv' : 'movie';
  const targets = (Array.isArray(candidates) ? candidates : [])
    .filter(item => item?.id && item.type === hydrateType && item.source !== 'jikan')
    .slice(0, 12);
  if (!targets.length) return candidates;
  await Promise.allSettled(targets.map(async candidate => {
    const key = `${hydrateType}:${candidate.id}`;
    let details = shelfdMoreLikeThisDetailCache.get(key);
    if (!details) {
      const res = await fetchTmdbProxy(`${hydrateType}/${candidate.id}`, { append_to_response: 'credits,keywords' });
      if (!res.ok) return;
      details = await res.json();
      shelfdMoreLikeThisDetailCache.set(key, details);
    }
    candidate.raw = { ...(candidate.raw || {}), ...(details || {}), media_type: hydrateType };
    candidate.image = getDatabaseMoreLikeThisImage(candidate.raw, candidate.type) || candidate.image;
    candidate.year = String(candidate.raw.release_date || candidate.raw.first_air_date || candidate.year || '').slice(0, 4);
  }));
  return candidates;
}

function rankMoreLikeThisCandidates(type = 'movie', details = {}, candidates = []) {
  const scoreType = type === 'game' ? 'game' : (type === 'tv' ? 'tv' : 'movie');
  return (Array.isArray(candidates) ? candidates : [])
    .map(candidate => {
      const scored = scoreMoreLikeThisCandidate(details, candidate, scoreType);
      return {
        ...candidate,
        reason: scored.reason || candidate.reason || '',
        similarityScore: scored.score,
        similarityBreakdown: scored.breakdown
      };
    })
    .sort((a, b) => {
      const scoreCompare = Number(b.similarityScore || 0) - Number(a.similarityScore || 0);
      if (scoreCompare) return scoreCompare;
      const providerCompare = getMoreLikeThisProviderScore(b.raw || b) - getMoreLikeThisProviderScore(a.raw || a);
      if (providerCompare) return providerCompare;
      return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
    })
    .slice(0, 10);
}

/* v11.134: RAWG's fixed genre list uses slugs that don't always equal the
   display name (RPG → role-playing-games-rpg, Simulator/Simulation →
   simulation, etc.). Game profile details only retain genre/tag NAMES, so we
   map names → slugs here. Unknown names fall through to generic hyphenation,
   which is exactly how RAWG tag slugs are formed (e.g. "Open World" →
   "open-world"). */
const RAWG_GENRE_SLUG_BY_NAME = {
  'action': 'action', 'indie': 'indie', 'adventure': 'adventure',
  'rpg': 'role-playing-games-rpg', 'role-playing': 'role-playing-games-rpg',
  'role-playing games (rpg)': 'role-playing-games-rpg', 'strategy': 'strategy',
  'shooter': 'shooter', 'casual': 'casual', 'simulation': 'simulation',
  'simulator': 'simulation', 'puzzle': 'puzzle', 'arcade': 'arcade',
  'platformer': 'platformer', 'racing': 'racing',
  'massively multiplayer': 'massively-multiplayer', 'sports': 'sports',
  'fighting': 'fighting', 'family': 'family', 'board games': 'board-games',
  'educational': 'educational', 'card': 'card'
};
function slugifyRawgName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function toRawgGenreSlug(g) {
  if (g && g.slug) return g.slug;
  const name = String((g && (g.name || g)) || '').trim().toLowerCase();
  if (!name) return '';
  return RAWG_GENRE_SLUG_BY_NAME[name] || slugifyRawgName(name);
}
function toRawgTagSlug(t) {
  if (t && t.slug) return t.slug;
  return slugifyRawgName(t && (t.name || t));
}

async function fetchSourceFallbackMoreLikeThis(type, details = {}) {
  const context = getDeepSeekMoreLikeThisContext(type, details);
  const fallbackType = type === 'game' ? 'game' : (type === 'tv' ? 'tv' : 'movie');
  const cacheKey = getDeepSeekMoreLikeThisCacheKey(type, details);
  if (deepSeekMoreLikeThisCache.has(cacheKey)) return deepSeekMoreLikeThisCache.get(cacheKey);
  let recommendations = [];

  if (type === 'game') {
    /* v11.134: game details store genres/tags BY NAME only (the RAWG `.slug`
       is dropped when the profile detail object is built), so the old
       `g.slug` reads were always empty — the genre/tag "more like this" query
       never ran and we fell straight to a title search, which returns only the
       game itself for niche titles → "could not load". Derive RAWG slugs from
       the names instead (with a fixed map for the genres whose slug differs
       from the name, e.g. RPG / Simulation / Massively Multiplayer), and add a
       fallback chain so we always try the broadest query that still returns
       results before giving up. */
    const genreSlugs = (details.genres || []).map(toRawgGenreSlug).filter(Boolean).slice(0, 3).join(',');
    const tagSlugs = (details.tags || []).map(toRawgTagSlug).filter(Boolean).slice(0, 4).join(',');
    const runRawgGamesQuery = async (extra = {}) => {
      const res = await fetchRawgProxy('games', { page_size: 32, ordering: '-metacritic', ...extra });
      if (!res.ok) throw new Error(`RAWG more-like-this failed: ${res.status}`);
      const json = await res.json();
      return (json.results || []).map((item, index) => ({
        ...item,
        __shelfdMoreLikeThisSource: 'rawg',
        __shelfdMoreLikeThisIndex: index
      }));
    };
    const rankRawg = rawResults => rankMoreLikeThisCandidates(
      'game',
      details,
      normalizeSourceMoreLikeThisItems(rawResults, 'game', context.title)
    );
    // 1) genres + tags (most relevant). 2) genres only. 3) tags only. 4) title search.
    if (genreSlugs || tagSlugs) {
      const primary = {};
      if (genreSlugs) primary.genres = genreSlugs;
      if (tagSlugs) primary.tags = tagSlugs;
      recommendations = rankRawg(await runRawgGamesQuery(primary));
      if (!recommendations.length && genreSlugs && tagSlugs) {
        recommendations = rankRawg(await runRawgGamesQuery({ genres: genreSlugs }));
      }
      if (!recommendations.length && tagSlugs && !genreSlugs) {
        recommendations = rankRawg(await runRawgGamesQuery({ tags: tagSlugs }));
      }
    }
    if (!recommendations.length && context.title) {
      recommendations = rankRawg(await runRawgGamesQuery({ search: context.title }));
    }
  } else {
    const id = details.id || details.tmdbId;
    const embeddedSimilar = details.similar?.results || [];
    let sourceItems = [];
    const isJikanAnimeSource = !!(details.__jikan || String(id || '').startsWith('mal:'));
    if (id && !isJikanAnimeSource) {
      const [recommendationsRes, similarRes] = await Promise.allSettled([
        fetchTmdbProxy(`${type}/${id}/recommendations`, { page: 1 }),
        fetchTmdbProxy(`${type}/${id}/similar`, { page: 1 })
      ]);
      for (const [sourceName, settled] of [['recommendations', recommendationsRes], ['similar', similarRes]]) {
        if (settled.status !== 'fulfilled' || !settled.value?.ok) continue;
        const json = await settled.value.json();
        sourceItems = sourceItems.concat((json.results || []).map((item, index) => ({
          ...item,
          __shelfdMoreLikeThisSource: sourceName,
          __shelfdMoreLikeThisIndex: index
        })));
      }
    }
    if (!sourceItems.length && embeddedSimilar.length) {
      sourceItems = embeddedSimilar.map((item, index) => ({
        ...item,
        __shelfdMoreLikeThisSource: item.__jikan ? 'jikan' : 'similar',
        __shelfdMoreLikeThisIndex: index
      }));
    }
    recommendations = normalizeSourceMoreLikeThisItems(sourceItems, fallbackType, context.title);
    if (recommendations.length && !isJikanAnimeSource) {
      await hydrateMoreLikeThisTmdbCandidateDetails(fallbackType, recommendations);
    }
    recommendations = rankMoreLikeThisCandidates(fallbackType, details, recommendations);
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

function getMoreLikeThisDisplayRating(item = {}) {
  const raw = item.raw || item;
  if (typeof window.formatDisplayTitleRating === 'function') {
    const display = window.formatDisplayTitleRating(raw);
    if (display) return display;
  }
  const type = normalizeDeepSeekMoreLikeThisType(item.type || raw.media_type || raw.type, 'movie');
  const source = String(item.source || raw.source || '').toLowerCase();
  let value = 0;
  let sourceHint = '';
  if (type === 'game') {
    if (Number(raw.metacritic || 0) > 0) {
      value = Number(raw.metacritic || 0);
      sourceHint = 'metacritic';
    } else {
      value = Number(raw.rating || item.rating || 0);
      sourceHint = 'rawg';
    }
  } else if (source === 'jikan' || raw.__jikan) {
    value = Number(raw.score || raw.vote_average || item.score || 0);
    sourceHint = 'jikan';
  } else {
    value = Number(raw.imdbRating || raw.vote_average || raw.voteAverage || item.vote_average || 0);
    sourceHint = raw.imdbRating ? 'imdb' : 'tmdb';
  }
  const normalized = typeof window.normalizeFetchedRatingToFiveStar === 'function'
    ? window.normalizeFetchedRatingToFiveStar(value, sourceHint)
    : (value > 5 ? value / 2 : value);
  return normalized > 0 ? normalized.toFixed(1) : '';
}

/* v11.407: up to 3 display genre names for a More Like This card. Handles every
   source shape: TMDB-hydrated details + Jikan/MAL + RAWG games carry
   `raw.genres` [{name}]; un-hydrated TMDB recommendation/similar rows only carry
   `raw.genre_ids` [Number] -> map through the movie/tv genre tables. */
function getMoreLikeThisCardGenreNames(item = {}) {
  const raw = (item && item.raw) || item || {};
  const out = [];
  const seen = new Set();
  const push = name => {
    const clean = String(name == null ? '' : (name.name || name)).trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  };
  (Array.isArray(raw.genres) ? raw.genres : []).forEach(push);
  if (!out.length && Array.isArray(raw.genre_ids)) {
    const map = (item.type === 'tv') ? DISCOVER_TV_GENRE_MAP : DISCOVER_MOVIE_GENRE_MAP;
    raw.genre_ids.forEach(id => push(map[id]));
  }
  return out.slice(0, 3);
}

function renderDeepSeekMoreLikeThisCards(recommendations = []) {
  return recommendations.map(item => {
    const year = item.year || '';
    const type = normalizeDeepSeekMoreLikeThisType(item.type);
    const rating = getMoreLikeThisDisplayRating(item);
    const genreNames = getMoreLikeThisCardGenreNames(item);
    const initial = (item.title || '?').trim().charAt(0).toUpperCase() || '?';
    const imageHtml = item.image
      ? `<img src="${escAttr(item.image)}" alt="" loading="lazy" decoding="async">`
      : `<div class="discover-ai-similar-placeholder">${escHtml(initial)}</div>`;
    /* v11.407: REBUILT metadata block. The old markup used a bare <span> (title)
       + <small> with nested rating <span>s — and the broad rule
       `.discover-media-similar-card span { display:block }` (file 16) forced the
       ★ and the rating onto separate lines with multi-line gaps. Per the
       rebuild-over-override rule, the metadata is now a clean <div> structure
       with dedicated .mlt-* classes (the old span/small rules no longer match,
       so no cascade fight, no !important):
         line 1  .mlt-title   — title, white 100%
         line 2  .mlt-rating  — ★ rating on ONE line (gold star, white number)
         line 3  .mlt-genres  — up to 3 genres, white 72%
       Styling lives in 06-profile.css (scoped to .discover-ai-more-section). */
    const ratingHtml = rating
      ? `<div class="mlt-rating"><span class="mlt-star" aria-hidden="true">★</span><span class="mlt-rating-value">${escHtml(rating)}</span></div>`
      : '';
    const genresHtml = genreNames.length
      ? `<div class="mlt-genres">${escHtml(genreNames.join('  '))}</div>`
      : '';
    return `<button class="discover-media-similar-card discover-ai-similar-card discover-db-similar-card mlt-card" type="button" data-ai-title="${escAttr(item.title)}" data-ai-year="${escAttr(year)}" data-ai-type="${escAttr(type)}" data-source-id="${escAttr(item.id || '')}" data-source-kind="${escAttr(item.source || (type === 'game' ? 'rawg' : 'tmdb'))}" data-source-image="${escAttr(item.image || '')}" onclick="openDeepSeekMoreLikeThisProfile(event, this)">${imageHtml}<div class="mlt-meta"><div class="mlt-title">${escHtml(item.title)}</div>${ratingHtml}${genresHtml}</div></button>`;
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
  const sourceKind = button?.dataset?.sourceKind || '';
  const sourceImage = button?.dataset?.sourceImage || '';
  if (!title) return;
  try {
    button?.classList?.add('resolving');
    if (sourceKind === 'jikan' && sourceId && typeof openJikanAnimeProfile === 'function') {
      openJikanAnimeProfile(event, sourceId);
      return;
    }
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
  const duplicateProbe = section === 'anime' ? { ...(details || {}), title } : title;
  const added = isDuplicateTitle(duplicateProbe, section);
  /* v10.123: FPMP add button shortened to a bare "+" when unadded.
     v10.125: added state shows just a "✓" instead of "Watched" /
     "Watchlist" / etc.
     v10.129: replaced the Unicode "✓" (U+2713) — which renders thick
     and blocky in DM Sans at weight 950, reading as cartoony — with a
     stroked SVG checkmark. Round line caps + a 2.4px stroke give a
     much cleaner, sleeker glyph that matches the share button's SVG
     idiom. The unadded "+" keeps the text glyph since it already
     reads cleanly at the 32px font-size. */
  /* v10.129: SVG checkmark for the added state (sleeker than the
     Unicode glyph rendered at DM Sans 950).
     v10.131: matched the same stroked-SVG idiom for the unadded "+"
     state — the text "+" at DM Sans 950 / 32px was reading too thick
     and bold. The new SVG plus uses a 2.2px round-cap stroke so it
     looks lighter and more refined while pairing visually with the
     checkmark above. */
  const checkSvg = `<svg class="discover-media-add-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4 4 10-10"/></svg>`;
  const plusSvg = `<svg class="discover-media-add-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`;
  const labelHtml = added ? checkSvg : plusSvg;
  return `<button class="discover-media-add-floating${added ? ' added' : ''}" type="button" data-discover-type="${escAttr(type)}" data-discover-id="${escAttr(String(id || ''))}" data-discover-section="${escAttr(section)}" data-discover-title="${escAttr(title)}" data-discover-poster="${escAttr(poster)}" ${added ? `title="Manage this title in your library"` : ''}>${labelHtml}</button>`;
}

function getShareableMediaKind(type = 'movie', details = {}) {
  if (type === 'game') return 'game';
  if (type === 'tv' && (details?.mediaCategory === 'anime' || details?.librarySection === 'anime' || details?.isAnime)) return 'anime';
  return type === 'tv' ? 'tv' : 'movie';
}

function buildMediaProfileShareUrl(kind = 'movie', id = '') {
  const safeKind = ['movie', 'tv', 'anime', 'game'].includes(String(kind)) ? String(kind) : 'movie';
  const safeId = encodeURIComponent(String(id || '').trim());
  const shareOrigin = window.SHELFD_SHARE_ORIGIN || 'https://myshelfd.com';
  return `${shareOrigin}/media/${safeKind}/${safeId}`;
}

function getMediaProfileShareIconSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M12 2v13"/><path d="m16 6-4-4-4 4"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/></svg>`;
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

/* v11.676: human label for the share sheet's preview subtitle (e.g. "Movie"). */
function mediaShareTypeLabel(kind = '') {
  switch (String(kind || '').toLowerCase()) {
    case 'tv': return 'TV Series';
    case 'anime': return 'Anime';
    case 'game': return 'Game';
    default: return 'Movie';
  }
}

/* v11.676: native "Share to…" for a media profile, driven by a meta object so it
   works from the shared Instagram-style news sheet (js/44 passes its state.meta).
   Mirrors the legacy shareMediaProfileAnywhere() navigator.share/clipboard logic
   but payload-based (no dependence on the old overlay's dataset). */
async function shelfdShareMediaProfileNative(meta = {}) {
  const url = String((meta && meta.url) || '').trim();
  if (!url) return;
  const title = String((meta && meta.title) || '').trim();
  const poster = String((meta && meta.image) || '').trim();
  const userName = (typeof getDisplayName === 'function' && typeof userProfile !== 'undefined' && userProfile)
    ? getDisplayName(userProfile, '')
    : (currentUser?.displayName || '');
  const shareTitle = title ? `${title} on Shelfd` : 'Shelfd';
  const shareText = userName && title
    ? `${userName} shared ${title} on Shelfd.`
    : title ? `Check out ${title} on Shelfd.` : '';
  const urlObj = new URL(url, window.location.origin);
  if (title) urlObj.searchParams.set('title', title);
  if (/^https?:\/\//i.test(poster)) urlObj.searchParams.set('poster', poster);
  if (userName) urlObj.searchParams.set('user', userName);
  const shareUrl = urlObj.toString();
  try {
    if (navigator.share) { await navigator.share({ title: shareTitle, text: shareText, url: shareUrl }); return; }
  } catch (e) { if (e?.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(shareUrl); if (typeof showToast === 'function') showToast('Link copied'); }
  catch (e) { if (typeof showToast === 'function') showToast('Could not copy link'); }
}
window.shelfdShareMediaProfileNative = shelfdShareMediaProfileNative;

function renderMediaProfileShareButton(kind = 'movie', id = '', title = '', poster = '') {
  if (!id) return '';
  /* v10.998: share button payload moved from inline `onclick` string
     args to data-* attributes. The previous version interpolated
     `title` and `poster` into a JS-string-quoted onclick:
       onclick="openMediaProfileShareMenu(event, 'movie', 'id', 'TITLE', 'POSTER')"
     `escAttr` correctly encoded `'` as `&#39;` for the HTML attribute,
     but when the browser parsed the attribute back into JS, the
     entity decoded to a real `'` mid-string — turning any title
     with an apostrophe ("Mary's Story", "It's a Wonderful Life",
     "Don't Look Up", etc.) into a SyntaxError that silently dropped
     the click handler. data-* attributes are HTML-safe and read at
     call time via event.currentTarget.dataset → no JS-string
     interpolation, no apostrophe hazard. */
  return `<button class="discover-media-share-floating" type="button"`
    + ` data-share-kind="${escAttr(kind)}"`
    + ` data-share-id="${escAttr(String(id || ''))}"`
    + ` data-share-title="${escAttr(title || '')}"`
    + ` data-share-poster="${escAttr(poster || '')}"`
    + ` onclick="openMediaProfileShareMenu(event)"`
    + ` aria-label="Share this media profile" title="Share">`
    + getMediaProfileShareIconSvg()
    + `</button>`;
}

function renderMediaProfileTopActions(shareHtml = '', addHtml = '', trailerCtaHtml = '', soundToggleHtml = '') {
  /* v10.127: top-right action row turned into a vertical stack.
     v10.128: the first row pairs [Trailer][+] horizontally — the
     Trailer pill sits to the LEFT of the "+" circle as a sub-flex row
     within the column. Stack now reads:
       Row 1:  Trailer  +     (horizontal pair, right-aligned)
       Row 2:  Share
       Row 3:  Mute
     Source order inside the top sub-row is trailer-then-add so the
     pill paints first (left) and the circle second (right). */
  const topRow = (trailerCtaHtml || addHtml)
    ? `<div class="discover-media-action-top-row">${trailerCtaHtml || ''}${addHtml || ''}</div>`
    : '';
  const content = `${topRow}${shareHtml || ''}${soundToggleHtml || ''}`.trim();
  return content ? `<div class="discover-media-action-row">${content}</div>` : '';
}

function closeMediaProfileShareMenu() {
  const overlay = document.getElementById('media-profile-share-menu');
  if (!overlay) return;
  overlay.classList.remove('open');
  /* v10.726: bumped 180ms → 420ms so the overlay element isn't removed
     mid-slide. The new modal slides DOWN to translateY(100vh) over 400ms
     when `.open` is removed (see media-share-sheet transition in CSS),
     so we keep the DOM element alive until the slide finishes. */
  window.setTimeout(() => overlay.remove(), 420);
}

function openMediaProfileShareMenu(event, kind = '', id = '', title = '', poster = '') {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  /* v10.998: prefer data-* attributes on the button (apostrophe-safe).
     Falls back to positional args so any legacy callers that still pass
     them keep working (e.g. an external script invoking this directly). */
  const btn = event?.currentTarget;
  if (btn && btn.dataset) {
    if (!kind && btn.dataset.shareKind) kind = btn.dataset.shareKind;
    if (!id && btn.dataset.shareId) id = btn.dataset.shareId;
    if (!title && btn.dataset.shareTitle) title = btn.dataset.shareTitle;
    if (!poster && btn.dataset.sharePoster) poster = btn.dataset.sharePoster;
  }
  if (!kind) kind = 'movie';
  const payload = getMediaProfileSharePayload(kind, id, title, poster);
  if (!payload.id) return;
  /* v11.676: the Full Page Media Profile share button now opens the SAME
     Instagram-style share sheet as News Feed cards (window.openShelfdNewsShareSheet,
     js/44). We reuse that one component and only swap the CONTENT — media title,
     poster, type label, the /media/{kind}/{id} deep link, and a media DM payload.
     No second FPMP sheet. The legacy 2-choice sheet below is kept ONLY as a
     fallback for the (unexpected) case where js/44 isn't loaded. */
  if (typeof window.openShelfdNewsShareSheet === 'function') {
    window.openShelfdNewsShareSheet({
      shareKind: 'media',
      url: payload.url,
      title: payload.title,
      image: payload.poster,
      source: mediaShareTypeLabel(payload.kind),
      mediaKind: payload.kind,
      mediaId: payload.id
    });
    return;
  }
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
      <button type="button" class="media-share-choice" onclick="openScreenListShareFlow()"><span>Share in Shelfd</span><em>${currentUser ? 'Send to a friend or message thread' : 'Sign in required'}</em></button>
      <button type="button" class="media-share-choice" onclick="shareMediaProfileAnywhere()"><span>Share Anywhere</span><em>Text, copy link, or share outside Shelfd</em></button>
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

  /* v10.725: media profile shares are not review shares. Keep the
     sharer's display name for the preview description, but reserve
     "review" wording for /review/{postId} links only. */
  const userName = (typeof getDisplayName === 'function' && userProfile)
    ? getDisplayName(userProfile, '')
    : (currentUser?.displayName || '');

  const shareTitle = payload.title ? `${payload.title} on Shelfd` : 'Shelfd';
  const shareText = userName && payload.title
    ? `${userName} shared ${payload.title} on Shelfd.`
    : payload.title ? `Check out ${payload.title} on Shelfd.` : '';

  const urlObj = new URL(payload.url, window.location.origin);
  if (payload.title) urlObj.searchParams.set('title', payload.title);
  /* Always set poster when available — the Worker uses it as og:image.
     Without it the preview falls back to the generic app image. */
  if (/^https?:\/\//i.test(payload.poster)) urlObj.searchParams.set('poster', payload.poster);
  if (userName) urlObj.searchParams.set('user', userName);
  const shareUrl = urlObj.toString();

  try {
    if (navigator.share) {
      await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
      closeMediaProfileShareMenu();
      return;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(shareUrl);
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

/* v11.655: extract a YouTube video id from a shared-article id/url so video
   shares play INLINE in the DM chat (instead of opening the article reader). */
function dmYouTubeVideoId(url) {
  const u = String(url || '');
  const m = u.match(/[?&]v=([a-zA-Z0-9_-]{6,})/) ||
            u.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/) ||
            u.match(/youtube(?:-nocookie)?\.com\/(?:embed|shorts|v)\/([a-zA-Z0-9_-]{6,})/);
  return m ? m[1] : '';
}
function playDmInlineVideo(event, el) {
  if (event && event.preventDefault) event.preventDefault();
  if (event && event.stopPropagation) event.stopPropagation();
  try {
    const card = el.closest('.dm-shared-video-card');
    const vid = card ? card.getAttribute('data-dm-video-id') : '';
    if (!vid || el.querySelector('iframe')) return false;
    const src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(vid) + '?autoplay=1&playsinline=1&rel=0&modestbranding=1';
    el.classList.add('is-playing');
    el.innerHTML = '<iframe src="' + escAttr(src) + '" title="Video" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen playsinline></iframe>';
  } catch (e) {}
  return false;
}
window.playDmInlineVideo = playDmInlineVideo;

function renderDirectMessageShareCard(message = {}) {
  const media = normalizeSharedMediaPayload(message.shareMedia);
  if (!media || !media.url) return '';
  if (media.kind === 'article') {
    /* v11.655: a shared YouTube card is a TRAILER — render it as a video card
       that plays INLINE in the chat on tap (the article id carries the youtube
       url). Falls back to the reader-link card for real articles. */
    const dmVid = dmYouTubeVideoId(media.videoId || media.id || '') || dmYouTubeVideoId(media.id || '');
    if (dmVid) {
      const thumb = media.poster || ('https://i.ytimg.com/vi/' + dmVid + '/hqdefault.jpg');
      return `<div class="dm-shared-media-card dm-shared-video-card" data-dm-video-id="${escAttr(dmVid)}">
        <div class="dm-video-thumb" role="button" tabindex="0" aria-label="Play video" onclick="return playDmInlineVideo(event, this)">
          <img src="${escAttr(thumb)}" alt="" loading="lazy">
          <span class="dm-video-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg></span>
        </div>
        <span class="dm-video-meta"><strong>${escHtml(media.title || 'Video')}</strong><em>${media.source ? escHtml(media.source) : 'Video'}</em></span>
      </div>`;
    }
    /* v11.626: news article card → opens the in-app reader. The deep link goes
       ONLY into href + data-* (safe attribute context); the click handler reads
       it off the element. We do NOT interpolate the free-form url into the
       onclick JS-string, which would be XSS-injectable on a tampered message. */
    return `<a class="dm-shared-media-card dm-shared-article-card" href="${escAttr(media.url)}" data-article-deeplink="${escAttr(media.url)}" onclick="return openSharedNewsArticleFromDm(event, this)" title="Open article">
      ${media.poster ? `<img src="${escAttr(media.poster)}" alt="" loading="lazy">` : ''}
      <span><strong>${escHtml(media.title || 'Article')}</strong><em>${media.source ? escHtml(media.source) : 'Article'}</em></span>
    </a>`;
  }
  return `<a class="dm-shared-media-card" href="${escAttr(media.url)}" data-share-title="${escAttr(media.title || '')}" onclick="return openSharedMediaProfileLink(event, '${escAttr(media.url)}')" title="Open media profile">
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
  const lastMessage = photoMedia?.imageData ? 'Photo' : normalizedShareMedia ? (normalizedShareMedia.kind === 'article' ? 'Shared an article' : 'Shared media') : message.text;
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
  const visibleThread = typeof mergeDirectMessageThreadIntoState === 'function'
    ? (mergeDirectMessageThreadIntoState(nextThread) || nextThread)
    : nextThread;
  if (typeof mergeDirectMessageThreadIntoState !== 'function') dmThreadMap[threadId] = visibleThread;
  renderDirectMessagesView();
  try {
    await mirrorDirectMessageThreadToParticipants(visibleThread);
    /* v10.465: DM push notifications. After the thread mirror lands in
       Firestore, fire an APNs push to every recipient via the Cloudflare
       Worker. Fire-and-forget; failures are non-fatal and never block the
       UI. DMs intentionally DO NOT write to the `notifications`
       subcollection — the chat thread itself is the in-app surface — so
       this is a direct /api/push/send call, separate from the
       createActivityNotification() pipeline used by likes / comments /
       friend events. */
    try {
      const senderProfileLocal = (typeof userProfile === 'object' && userProfile) ? userProfile : {};
      const senderUserMapLocal = (typeof usersMap === 'object' && usersMap && usersMap[currentUser.uid]) ? usersMap[currentUser.uid] : {};
      const senderName = String(
        senderProfileLocal.name ||
        senderProfileLocal.displayName ||
        senderUserMapLocal.name ||
        senderUserMapLocal.customName ||
        currentUser.displayName ||
        'Someone'
      ).trim() || 'Someone';
      const isGroupThread = isDirectMessageGroupThread(visibleThread);
      const bodyText = photoMedia?.imageData
        ? 'Sent a photo'
        : normalizedShareMedia
          ? (normalizedShareMedia.title ? `Shared: ${normalizedShareMedia.title}` : 'Shared media')
          : String(message.text || '').trim();
      const pushTitle = isGroupThread
        ? (getDirectMessageThreadTitle(visibleThread) || 'New message')
        : senderName;
      const pushBody = isGroupThread
        ? (bodyText ? `${senderName}: ${bodyText}` : `${senderName} sent a message`)
        : (bodyText || 'New message');
      const notificationId = `direct_message:${threadId}:${messageId}`;
      unreadUids.forEach(recipientUid => {
        const target = String(recipientUid || '').trim();
        if (!target || target === currentUser.uid) return;
        Promise.resolve(
          typeof window.isShelfdNotificationTypeEnabledForRecipient === 'function'
            ? window.isShelfdNotificationTypeEnabledForRecipient(target, 'direct_message')
            : true
        ).then(allowed => {
          if (allowed === false) return;
          fetch('/api/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'omit',
            cache: 'no-store',
            body: JSON.stringify({
              recipientUid: target,
              notificationId,
              title: pushTitle,
              body: pushBody,
              data: {
                notificationId,
                type: 'direct_message',
                threadId,
                messageId,
                isGroup: isGroupThread ? '1' : '0'
              }
            })
          }).catch(() => {});
        }).catch(() => {});
      });
    } catch (_) { /* push is fire-and-forget; swallow any pre-fetch errors */ }
    return true;
  }
  catch(error) {
    console.error('appendDirectMessageToThread failed:', error);
    const currentThread = dmThreadMap[threadId] || thread;
    const remainingMessages = (currentThread.messages || [])
      .filter(item => {
        if (typeof getDirectMessageMessageKey === 'function') {
          return getDirectMessageMessageKey(item) !== messageId;
        }
        return item?.id !== messageId;
      });
    dmThreadMap[threadId] = normalizeDirectMessageThread({
      ...currentThread,
      messages: remainingMessages,
      lastMessage: getDirectMessageLastPreviewFromMessages(remainingMessages, thread.lastMessage || ''),
      lastMessageFromUid: remainingMessages.length
        ? (remainingMessages[remainingMessages.length - 1].fromUid || '')
        : (thread.lastMessageFromUid || ''),
      lastMessageAtMs: remainingMessages.length
        ? (typeof getDirectMessageMessageTime === 'function'
            ? getDirectMessageMessageTime(remainingMessages[remainingMessages.length - 1])
            : Number(remainingMessages[remainingMessages.length - 1].createdAtMs || Date.now()))
        : (thread.lastMessageAtMs || Date.now()),
      unreadUids: thread.unreadUids || [],
      updatedAtMs: Date.now()
    });
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

function bindDiscoverMediaProfileSwipeBack(overlay) {
  const page = overlay?.querySelector?.('.discover-media-page');
  if (!page || page.dataset.swipeBackBound === 'true') return;
  page.dataset.swipeBackBound = 'true';

  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let lastTime = 0;
  let velocityX = 0;
  let velocityY = 0;
  let viewportW = 0;
  let viewportH = 0;
  let canSwipeBack = false;
  let canPullDown = false;
  let canTrailerExpand = false;
  let canTrailerCollapse = false;
  let gestureMode = '';
  let activePointerId = null;
  let rafId = 0;
  let pendingX = 0;
  let pendingY = 0;
  let pendingProgress = 0;

  const shouldIgnoreLegacyTouchEvent = (event) => {
    return !!window.PointerEvent && String(event?.type || '').startsWith('touch');
  };

  const getGesturePoint = (event) => {
    const coalesced = typeof event?.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : null;
    if (coalesced?.length) return coalesced[coalesced.length - 1];
    return event?.touches?.[0] || event?.changedTouches?.[0] || event;
  };

  const renderGestureFrame = () => {
    rafId = 0;
    if (gestureMode === 'swipe-back') {
      page.style.transform = `translate3d(${pendingX}px, 0, 0)`;
      overlay.style.background = `rgba(5, 4, 13, ${Math.max(0, 0.18 - pendingProgress * 0.18)})`;
      return;
    }
    if (gestureMode === 'pull-down') {
      /* v652: scale() is removed from the pull-down transform.
         Combination of translate3d + scale on the parent page caused
         iOS Safari to drop the poster <img> mid-gesture. Pure
         translate3d preserves the GPU layer cleanly and the poster
         stays visible the whole way down. The 2.5% shrink was a
         minor visual flourish — losing it is worth the bug fix.
         Swipe-back (left → right) is unchanged. Tap-back is unchanged. */
      page.style.transform = `translate3d(0, ${pendingY}px, 0)`;
      overlay.style.background = `rgba(5, 4, 13, ${Math.max(0.08, 0.22 - pendingProgress * 0.16)})`;
      return;
    }
    if (gestureMode === 'trailer-expand' || gestureMode === 'trailer-collapse') {
      applyDiscoverHeroTrailerExpansionProgress(overlay, pendingProgress);
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
    velocityX = 0;
    velocityY = 0;
    canTrailerExpand = false;
    canTrailerCollapse = false;
    page.classList.remove('media-profile-swipe-dragging', 'media-profile-pull-dragging');
    overlay.classList.remove('media-profile-swipe-revealing', 'media-profile-trailer-gesture');
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

  const preparePullDownHeroClose = () => {
    clearGestureFrame();
    gestureMode = '';
    pendingY = 0;
    pendingProgress = 0;
    page.classList.remove('media-profile-pull-dragging');
    page.style.transition = '';
    page.style.transform = '';
    page.style.willChange = '';
    page.style.touchAction = '';
    page.style.boxShadow = '';
    page.style.borderRadius = '';
    overlay.style.transition = '';
    overlay.style.background = '';
  };

  const shouldReturnToPreviousTitleProfile = () => {
    return activeDiscoverMediaProfileState?.view === 'person'
      && !!activeDiscoverMediaProfileState?.previous?.details;
  };

  const shouldReturnToFilmographyPage = () => {
    return !!activeDiscoverMediaProfileState?.filmographyReturn;
  };

  const returnToPreviousTitleProfileFromGesture = () => {
    resetGestureStyles();
    document.body.classList.remove('media-profile-swipe-reveal-active');
    backToDiscoverTitleProfile();
  };

  const returnToFilmographyPageFromGesture = () => {
    resetGestureStyles();
    document.body.classList.remove('media-profile-swipe-reveal-active');
    returnToFilmographyFromMediaProfile();
  };

  const armGesture = (mode) => {
    if (gestureMode === mode) return;
    gestureMode = mode;
    if (mode === 'trailer-expand' || mode === 'trailer-collapse') {
      if (mode === 'trailer-collapse' && isDiscoverHeroTrailerLandscape(overlay)) {
        closeDiscoverHeroTrailerLandscapeMode(overlay, { refresh: false });
      }
      const trailerState = beginDiscoverHeroTrailerExpansion(overlay);
      if (trailerState) trailerState.direction = mode === 'trailer-collapse' ? 'collapse' : 'expand';
      overlay.classList.add('media-profile-trailer-aspect-preserve');
      if (mode === 'trailer-collapse') {
        overlay.classList.remove('media-profile-trailer-fullscreen', 'media-profile-trailer-expanding');
        overlay.classList.add('media-profile-trailer-collapsing');
        document.body.classList.remove('media-profile-trailer-fullscreen-active');
        document.body.classList.add('media-profile-trailer-transition-active');
        stopDiscoverHeroTrailerProgressLoop(getDiscoverHeroTrailerPreviewElement(overlay));
      }
      overlay.classList.add('media-profile-trailer-gesture');
      page.style.transition = 'none';
      page.style.touchAction = 'none';
      return;
    }
    page.style.transition = 'none';
    overlay.style.transition = 'none';
    page.style.willChange = 'transform';
    /* v650: backface-visibility: hidden on the gesture page combined with
       transform: scale() during pull-down causes the poster <img> to flicker
       and sometimes disappear entirely on iOS Safari. Removing it has no
       effect on the gesture itself (will-change: transform already gives
       us the GPU layer) but keeps the poster reliably visible. */
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
    if (shouldReturnToFilmographyPage()) {
      returnToFilmographyPageFromGesture();
      return;
    }
    if (shouldReturnToPreviousTitleProfile()) {
      returnToPreviousTitleProfileFromGesture();
      return;
    }
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
    if (shouldIgnoreLegacyTouchEvent(event)) return;
    const point = getGesturePoint(event);
    if (!point) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.touches && event.touches.length !== 1) return;
    const eventTarget = event.target?.closest ? event.target : null;
    const trailerPreviewTarget = eventTarget?.closest('[data-discover-hero-trailer-preview]');
    const trailerAvailable = hasDiscoverHeroTrailerPreview(overlay);
    const trailerFullscreen = isDiscoverHeroTrailerFullscreen(overlay);
    const trailerControlTarget = eventTarget?.closest('[data-discover-trailer-control]');
    const trailerDirectControlTarget = eventTarget?.closest('button, input, textarea, select');
    if (trailerControlTarget && (!trailerFullscreen || trailerDirectControlTarget)) return;
    const interactiveTarget = eventTarget?.closest('.discover-media-back, .discover-media-cast, .discover-media-similar, .discover-media-library-dock, .discover-media-add-floating, button, a, input, textarea, select');
    if (interactiveTarget && !trailerPreviewTarget) return;
    startX = point.clientX;
    startY = point.clientY;
    lastX = startX;
    lastY = startY;
    lastTime = performance.now();
    velocityX = 0;
    velocityY = 0;
    const trailerViewport = getDiscoverTrailerViewportSize();
    viewportW = trailerViewport.width;
    viewportH = trailerViewport.height;
    const startsInTrailerArea = !!trailerPreviewTarget
      || !!eventTarget?.closest('.discover-media-hero')
      || startY <= Math.min(viewportH * 0.42, 360);
    canSwipeBack = startX <= 48;
    canTrailerCollapse = trailerAvailable && trailerFullscreen;
    canTrailerExpand = trailerAvailable && !trailerFullscreen && page.scrollTop <= 2 && startsInTrailerArea;
    canPullDown = page.scrollTop <= 2 && !canTrailerExpand && !canTrailerCollapse;
    gestureMode = '';
    activePointerId = event.pointerId ?? null;
  };

  const handleGestureMove = (event) => {
    if (shouldIgnoreLegacyTouchEvent(event)) return;
    if (!canSwipeBack && !canPullDown && !canTrailerExpand && !canTrailerCollapse) return;
    const point = getGesturePoint(event);
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
      } else if (canTrailerCollapse && dy < -8 && absDy > absDx * 1.12) {
        armGesture('trailer-collapse');
        try { page.setPointerCapture?.(event.pointerId); } catch (e) {}
      } else if (canTrailerExpand && page.scrollTop <= 2 && dy > 4 && absDy > absDx * 1.08) {
        armGesture('trailer-expand');
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

    const now = performance.now();
    const dt = Math.max(1, now - lastTime);
    velocityX = (point.clientX - lastX) / dt;
    velocityY = (point.clientY - lastY) / dt;
    lastX = point.clientX;
    lastY = point.clientY;
    lastTime = now;

    if (gestureMode === 'swipe-back') {
      if (event.cancelable) event.preventDefault();
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
      return;
    }

    if (gestureMode === 'trailer-expand') {
      if (event.cancelable) event.preventDefault();
      pendingProgress = Math.min(1, Math.max(0, dy) / Math.max(1, viewportH * 0.34));
      requestGestureFrame();
      return;
    }

    if (gestureMode === 'trailer-collapse') {
      if (event.cancelable) event.preventDefault();
      pendingProgress = 1 - Math.min(1, Math.max(0, -dy) / Math.max(1, viewportH * 0.32));
      requestGestureFrame();
    }
  };

  const handleGestureEnd = (event) => {
    if (shouldIgnoreLegacyTouchEvent(event)) return;
    if (!canSwipeBack && !canPullDown && !canTrailerExpand && !canTrailerCollapse && !gestureMode) return;
    const point = getGesturePoint(event);
    const dx = point ? point.clientX - startX : pendingX;
    const dy = point ? point.clientY - startY : pendingY;
    const mode = gestureMode;
    canSwipeBack = false;
    canPullDown = false;
    canTrailerExpand = false;
    canTrailerCollapse = false;
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
        if (shouldReturnToFilmographyPage()) {
          returnToFilmographyPageFromGesture();
          return;
        }
        if (shouldReturnToPreviousTitleProfile()) {
          returnToPreviousTitleProfileFromGesture();
          return;
        }
        preparePullDownHeroClose();
        if (overlay.classList.contains('game-media-profile-overlay')) closeGameMediaProfile({ reason: 'pull-down', heroClose: true });
        else closeDiscoverMediaProfile({ reason: 'pull-down', heroClose: true });
      } else {
        snapBack();
      }
      return;
    }

    if (mode === 'trailer-expand') {
      const shouldExpand = pendingProgress >= 0.58 || (dy > viewportH * 0.26 && dy > Math.abs(dx) * 1.1);
      overlay.classList.remove('media-profile-trailer-gesture');
      if (shouldExpand) expandDiscoverHeroTrailerPreview(overlay);
      else cancelDiscoverHeroTrailerExpansion(overlay);
      resetGestureStyles();
      return;
    }

    if (mode === 'trailer-collapse') {
      const shouldCollapse = pendingProgress <= 0.78 || velocityY < -0.42 || (-dy > viewportH * 0.14 && Math.abs(dy) > Math.abs(dx));
      overlay.classList.remove('media-profile-trailer-gesture');
      if (shouldCollapse) collapseDiscoverHeroTrailerPreview(overlay);
      else restoreDiscoverHeroTrailerFullscreen(overlay);
      resetGestureStyles();
      return;
    }

    resetGestureStyles();
  };

  const handleGestureCancel = (event) => {
    if (shouldIgnoreLegacyTouchEvent(event)) return;
    resetGestureStyles();
  };

  page.addEventListener('pointerdown', handleGestureStart, { passive: true });
  page.addEventListener('pointermove', handleGestureMove, { passive: false });
  page.addEventListener('pointerup', handleGestureEnd, { passive: true });
  page.addEventListener('pointercancel', handleGestureCancel, { passive: true });

  // iOS Safari fallback for older WebKit behavior.
  page.addEventListener('touchstart', handleGestureStart, { passive: true });
  page.addEventListener('touchmove', handleGestureMove, { passive: false });
  page.addEventListener('touchend', handleGestureEnd, { passive: true });
  page.addEventListener('touchcancel', handleGestureCancel, { passive: true });
}

/* v10.784: renderDiscoverMediaLibraryRatingStars + updateDiscoverMediaLibraryStars
   removed. The dock no longer has a rating row — Watched goes straight
   to openShelfLogComposer which has its own rating UI. These helpers
   were dock-specific (no callers outside this file). */

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
  const discoverSection = String(btn.dataset.discoverSection || '').trim().toLowerCase();
  if (isGame && !isAdded) {
    openGameDiscoverAddSheetFromButton(btn);
    return;
  }
  const ratingSection = getRatingSectionForDiscoverType(type);
  const mediaLabel = type === 'tv' ? 'series' : isGame ? 'game' : 'movie';
  const statusChoices = discoverSection === 'movies'
    ? [
        { status: 'planned', label: 'Planning', detail: 'Save for later', className: 'planned' },
        { status: 'watched', label: 'Watched', detail: 'Write a review', className: 'watched' }
      ]
    : [
        { status: 'watching', label: 'Watching', detail: 'In progress', className: 'watching' },
        { status: 'planned', label: 'Planning', detail: 'Save for later', className: 'planned' },
        { status: 'watched', label: 'Watched', detail: 'Write a review', className: 'watched' }
      ];
  const dock = document.createElement('div');
  dock.className = 'discover-media-library-dock';
  dock.innerHTML = `
    <div class="discover-media-library-glow" aria-hidden="true"></div>
    <div class="discover-media-library-preview">
      <div class="discover-media-library-thumb">${poster ? `<img src="${escAttr(poster)}" alt="" decoding="async">` : ''}</div>
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
      <!-- v10.784: rating row removed. Watched now goes STRAIGHT to the
           full-page write-a-review composer (openShelfLogComposer) which
           has its own rating slider, review textarea, date, tags, etc.
           No need for an intermediate dock-level rating step. -->
      <div class="discover-media-library-actions discover-media-library-actions-triple">
        ${statusChoices.map(choice => `
        <button class="discover-media-library-choice ${escAttr(choice.className)}" type="button" data-status="${escAttr(choice.status)}">
          <span>${escHtml(choice.label)}</span>
          <small>${escHtml(choice.detail)}</small>
        </button>`).join('')}
      </div>
    `}
    <button class="discover-media-library-close" type="button" aria-label="Close add panel">×</button>
  `;
  overlay.appendChild(dock);
  requestAnimationFrame(() => dock.classList.add('open'));

  /* v10.779: addFromDock now accepts the full status set (planned, watching,
     watched). Watching is the "in progress" middle state — no rating prompt,
     just save and close. The activity-feed post prompt (promptPost) is
     EXPLICITLY DISABLED on every flow from this dock per user request —
     the modal that used to appear after a Watched save is gone. */
  const savedLabelFor = (status, rating) => {
    if (status === 'planned') return 'Saved to Planning';
    if (status === 'watching') return 'Marked Watching';
    if (status === 'watched') {
      return rating
        ? `Rated ${formatRatingValueForSection(rating, ratingSection, true)}`
        : 'Marked Watched';
    }
    return 'Saved';
  };
  /* v10.784: simplified — no rating UI in the dock anymore. The flow
     splits cleanly by status:
       • planned / watching → save + show success checkmark + close dock
         (the existing "Added to your library" toast from addDiscoveryTitle
         provides the user-visible confirmation)
       • watched → save with rating=0, close dock, slide-open the
         full-page WRITE-A-REVIEW composer (openShelfLogComposer) where
         the user picks their rating, writes their review, picks date,
         adds tags, etc. */
  /* v11.060: OPTIMISTIC confirmation. Previously the dock was held in the
     semi-transparent ".saving" state (opacity:0.82, pointer-events:none) for
     the FULL duration of addDiscoveryTitle — which for a game is TWO
     sequential network round-trips (RAWG details fetch + Firestore write),
     ~3-4s. That read as a frozen modal. Now we paint the success checkmark
     INSTANTLY and let the persist finish in the background. addDiscoveryTitle
     still owns the success/error toast, so a rare background failure is
     surfaced there. The "watched" defensive-fallback path still awaits because
     it needs the saved item id to open the review composer. */
  const renderDockSaved = (status) => {
    dock.classList.remove('saving');
    dock.classList.add('saved');
    const savedLabel = savedLabelFor(status, 0);
    dock.innerHTML = `
      <div class="discover-media-library-glow" aria-hidden="true"></div>
      <div class="discover-media-library-success-mark">✓</div>
      <div class="discover-media-library-success-title">${escHtml(savedLabel)}</div>
      <div class="discover-media-library-success-sub">${escHtml(title)} is in your library.</div>
    `;
  };
  const addFromDock = async (status) => {
    if (!type || !id || btn.disabled) return;
    if (dock.dataset.saving === 'true') return;
    dock.dataset.saving = 'true';
    // Paint success immediately — no semi-transparent freeze.
    renderDockSaved(status);
    const savePromise = addDiscoveryTitle(type, id, btn, status, '+', 0, { promptPost: false });
    if (status === 'watched') {
      // Defensive fallback (composer entry point missing): we need the saved
      // item id to open the review composer, so await the persist here.
      let result = null;
      try { result = await savePromise; }
      catch (e) { console.warn('[v11.060] watched dock add failed:', e); }
      const shouldOpenComposer = !!(result && result.ok && result.item && result.item.id);
      const composerItemId = shouldOpenComposer ? String(result.item.id || '').trim() : '';
      const composerSection = shouldOpenComposer ? String(result.section || '').trim() : '';
      if (shouldOpenComposer && composerItemId && typeof window.openShelfLogComposer === 'function') {
        window.setTimeout(() => {
          closeDiscoverMediaLibraryDock();
          try { window.openShelfLogComposer(composerItemId, composerSection); }
          catch (e) { console.warn('[v10.784] openShelfLogComposer failed:', e); }
        }, 360);
      } else {
        window.setTimeout(closeDiscoverMediaLibraryDock, 760);
      }
    } else {
      // planned / watching: persist in the background, close on the same cadence.
      savePromise.catch(e => console.warn('[v11.060] background dock add failed:', e));
      window.setTimeout(closeDiscoverMediaLibraryDock, 760);
    }
  };

  const removeFromDock = async () => {
    if (btn.disabled) return;
    if (dock.dataset.saving === 'true') return;
    dock.dataset.saving = 'true';
    // v11.060: optimistic — paint the "Removed" state instantly instead of
    // holding the semi-transparent ".saving" freeze through the Firestore write.
    dock.classList.remove('saving');
    dock.classList.add('saved');
    dock.innerHTML = `
      <div class="discover-media-library-glow" aria-hidden="true"></div>
      <div class="discover-media-library-success-mark remove">−</div>
      <div class="discover-media-library-success-title">Removed</div>
      <div class="discover-media-library-success-sub">${escHtml(title)} left your library.</div>
    `;
    Promise.resolve(removeDiscoveryTitle(btn)).catch(e => console.warn('[v11.060] background dock remove failed:', e));
    window.setTimeout(closeDiscoverMediaLibraryDock, 720);
  };

  dock.querySelector('.discover-media-library-close')?.addEventListener('click', closeDiscoverMediaLibraryDock);
  dock.querySelector('.discover-media-library-choice.remove')?.addEventListener('click', removeFromDock);
  /* v10.788: Planning + Watching still go through addFromDock (save +
     success checkmark + toast). Watched takes a NEW path: open the
     write-a-review composer in DRAFT mode INSTANTLY (no addDiscoveryTitle
     await, no semi-transparent saving overlay). The library add only
     happens when the user confirms Save inside the composer. Cancel
     leaves the library untouched.
     The dock closes immediately on Watched tap so the user goes
     straight from FPMP -> review composer with no intermediate state. */
  dock.querySelector('.discover-media-library-choice.planned')?.addEventListener('click', () => addFromDock('planned'));
  dock.querySelector('.discover-media-library-choice.watching')?.addEventListener('click', () => addFromDock('watching'));
  dock.querySelector('.discover-media-library-choice.watched')?.addEventListener('click', () => {
    if (typeof window.openShelfLogComposerForNewMedia !== 'function') {
      // Defensive fallback: if the composer entry point isn't loaded for
      // any reason, degrade to the prior flow (full add + composer open).
      addFromDock('watched');
      return;
    }
    closeDiscoverMediaLibraryDock();
    try { window.openShelfLogComposerForNewMedia(type, id, btn); }
    catch (e) { console.warn('[v10.788] openShelfLogComposerForNewMedia failed:', e); }
  });
}

/* v10.784: bindDiscoverMediaLibraryStarScrub removed. The dock no longer
   has stars — Watched goes straight to openShelfLogComposer which has
   its own rating slider (with its own scrub handlers in 06-mylists-render-episodes-ratings.js). */

function bindDiscoverMediaProfileActions(overlay) {
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
      if (!type || !id || addButton.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      showDiscoverMediaLibraryDock(addButton);
    });
  }
}

let activeDiscoverMediaProfileState = null;

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

/* v734: "Most Known For" representativeness score.
   Goal: pick the 3 titles MOST associated with this actor in the public
   imagination. Not just popular, not just well-rated — the intersection.

   Inputs (all available on the TMDB combined_credits.cast entries):
     - popularity        : how much current attention the title gets
     - vote_count        : mass-awareness signal (how many people have rated it)
     - vote_average      : quality / how-well-it-landed signal
     - order             : the actor's billing order on this title (lower = lead)
     - release year      : recency tie-breaker; classics shouldn't dominate but
                           a single recent role shouldn't alone override a long
                           catalog of acclaimed work either

   Each component is normalized inside the candidate pool so a quiet career
   doesn't get crushed by a single blockbuster outlier. Final score is a
   weighted sum, billing-order applies a multiplicative boost (lead role
   counts more than 14th-billed). */
function buildPersonCreditPoolStats(items = []) {
  let maxPop = 0;
  let maxLogVotes = 0;
  items.forEach(item => {
    const pop = Number(item.popularity || 0);
    const votes = Math.max(0, Number(item.vote_count || 0));
    const lv = votes > 0 ? Math.log10(votes + 1) : 0;
    if (pop > maxPop) maxPop = pop;
    if (lv > maxLogVotes) maxLogVotes = lv;
  });
  return { maxPop: maxPop || 1, maxLogVotes: maxLogVotes || 1 };
}

function getPersonCreditYear(item = {}) {
  const raw = item?.release_date || item?.first_air_date || '';
  const y = parseInt(String(raw).slice(0, 4), 10);
  return Number.isFinite(y) && y >= 1900 ? y : 0;
}

function scorePersonMostKnownForCredit(item, stats) {
  const popularity = Number(item.popularity || 0);
  const voteCount = Math.max(0, Number(item.vote_count || 0));
  const voteAvg = Number(item.vote_average || 0);
  const order = Number.isFinite(Number(item.order)) ? Number(item.order) : 99;

  const popN = popularity / Math.max(1, stats.maxPop);
  const logVotes = voteCount > 0 ? Math.log10(voteCount + 1) : 0;
  const votesN = logVotes / Math.max(1, stats.maxLogVotes);
  const ratingN = Math.max(0, Math.min(1, voteAvg / 10));

  /* Billing-order multiplier: 1.0 for lead/co-lead, gracefully decays as the
     actor sits further down the cast list. A 14th-billed role on a megahit
     shouldn't out-rank their lead role on a hit. */
  const billingMultiplier = order <= 1 ? 1.20
    : order <= 3 ? 1.10
    : order <= 5 ? 1.00
    : order <= 10 ? 0.85
    : 0.65;

  /* Recency lift — small. The point is to break ties, not to overrule
     decades of an actor's defining work. */
  const year = getPersonCreditYear(item);
  const yearsAgo = year ? (new Date().getUTCFullYear() - year) : 50;
  const recencyN = Math.max(0, 1 - Math.min(yearsAgo, 30) / 30);

  /* Weights chosen to surface "mass-awareness × quality" (the actual
     definition of "what they're known for") rather than raw popularity
     spikes. */
  return (
    popN * 0.30 +
    votesN * 0.40 +
    ratingN * 0.20 +
    recencyN * 0.10
  ) * billingMultiplier;
}

function getDiscoverPersonMostKnownFor(details = {}) {
  const candidates = (details.combined_credits?.cast || [])
    .filter(item => item && (item.poster_path || item.backdrop_path) && (item.title || item.name) && Number(item.vote_count || 0) > 0);
  if (!candidates.length) return [];
  const stats = buildPersonCreditPoolStats(candidates);
  return candidates
    .slice()
    .sort((a, b) => scorePersonMostKnownForCredit(b, stats) - scorePersonMostKnownForCredit(a, stats))
    .slice(0, 3);
}

/* v734: Filmography preview list — recent → oldest, capped at 9 for the
   inline section. Full filmography (everything, paginated) lives in the
   slide-in page opened from the section header. */
function getDiscoverPersonFilmographyAll(details = {}) {
  return (details.combined_credits?.cast || [])
    .filter(item => item && (item.poster_path || item.backdrop_path) && (item.title || item.name))
    .slice()
    .sort((a, b) => getPersonCreditYear(b) - getPersonCreditYear(a));
}

function getDiscoverPersonFilmographyPreview(details = {}) {
  return getDiscoverPersonFilmographyAll(details).slice(0, 9);
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

/* v733: Heart-favorite button for the person profile (top-right corner).
   Shares the .cast-fav-btn class so 22-favorite-people.js's delegated click
   handler picks it up automatically. The --profile modifier scales it up and
   positions it absolute in the top-right. */
function renderPersonProfileFavoriteHeart(person = {}) {
  const id = person?.id;
  if (!id) return '';
  const name = String(person?.name || '');
  const profilePath = String(person?.profile_path || '');
  const dept = String(person?.known_for_department || '').toLowerCase();
  const role = dept.includes('direct') ? 'director' : 'actor';
  const isFav = typeof window.shelfdIsFavoritePerson === 'function'
    ? window.shelfdIsFavoritePerson(id)
    : false;
  return `<span class="cast-fav-btn cast-fav-btn--profile${isFav ? ' is-favorite' : ''}"
      aria-label="Favorite ${escAttr(name)}"
      aria-pressed="${isFav ? 'true' : 'false'}"
      data-person-id="${escAttr(id)}"
      data-person-name="${escAttr(name)}"
      data-person-photo="${escAttr(profilePath)}"
      data-person-role="${escAttr(role)}">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21s-7.5-4.6-9.6-9.4C1.1 8 3.4 4.5 6.8 4.5c2.1 0 3.9 1.2 5.2 3 1.3-1.8 3.1-3 5.2-3 3.4 0 5.7 3.5 4.4 7.1C19.5 16.4 12 21 12 21z"/>
      </svg>
    </span>`;
}

function renderDiscoverPersonProfileShell(person = {}) {
  const name = person.name || 'Cast Profile';
  const photo = getTmdbImageUrl(person.profile_path || person.photo || person.profilePhoto || '', 'w500');
  return `<section class="discover-media-page discover-person-page" role="dialog" aria-modal="true" aria-label="${escAttr(name)} details">
    <button class="discover-media-back discover-media-back--icon" type="button" onclick="backToDiscoverTitleProfile()" aria-label="Back"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg></button>
    ${renderPersonProfileFavoriteHeart(person)}
    <div class="discover-media-hero discover-person-hero" style="${photo ? `background-image:url('${escAttr(photo)}')` : ''}">
      <div class="discover-media-hero-shade"></div>
      <div class="discover-media-hero-content">
        <div class="discover-media-hero-top">
          <div class="discover-media-poster discover-person-poster">${photo ? `<img src="${escAttr(photo)}" alt="" decoding="async">` : ''}</div>
          <div class="discover-media-hero-main">
            <div class="discover-media-kicker">Cast Profile</div>
            <h2>${escHtml(name)}</h2>
          </div>
        </div>
      </div>
    </div>
    <div class="discover-media-body">
      <div class="discover-media-loading">Building this cast profile...</div>
    </div>
  </section>`;
}

function getDiscoverPersonCreditMediaType(item = {}) {
  return String(item?.media_type || '').toLowerCase() === 'tv' ? 'tv' : 'movie';
}

function getDiscoverPersonCreditLookupKey(item = {}) {
  const id = String(item?.id || item?.tmdbId || '').trim();
  if (!id) return '';
  return `${getDiscoverPersonCreditMediaType(item)}:${id}`;
}

function formatDiscoverPersonCreditImdbRating(item = {}) {
  if (typeof window.formatDisplayTitleRating === 'function') return window.formatDisplayTitleRating(item);
  const rating = Number(item?.imdbRating || 0);
  const normalized = typeof window.normalizeFetchedRatingToFiveStar === 'function'
    ? window.normalizeFetchedRatingToFiveStar(rating, 'imdb')
    : (rating > 0 ? rating / 2 : 0);
  return normalized > 0 ? normalized.toFixed(1) : '';
}

function renderDiscoverPersonCreditCard(item = {}, options = {}) {
  const itemType = getDiscoverSimilarType(item, getDiscoverPersonCreditMediaType(item));
  const itemTitle = item.title || item.name || 'Untitled';
  const year = (item.release_date || item.first_air_date || '').slice(0, 4);
  const roleMeta = getDiscoverPersonCreditRoleMeta(item);
  const hasRole = !!getDiscoverPersonCreditRole(item);
  const showImdbRating = !!options.showImdbRating;
  const creditKey = getDiscoverPersonCreditLookupKey(item);
  const imdbRating = formatDiscoverPersonCreditImdbRating(item);
  const ratingHtml = showImdbRating
    ? `<div class="discover-person-credit-rating${imdbRating ? ' is-ready' : ''}" data-person-credit-rating ${imdbRating ? '' : 'hidden'}><span class="discover-person-credit-rating-star" aria-hidden="true">★</span><span data-person-credit-rating-value>${escHtml(imdbRating)}</span></div>`
    : '';
  /* v10.62: added loading="lazy" decoding="async" — person credit grids render
     many cards at once; native browser lazy means off-screen cards never decode
     their poster until scrolled into view. Big win on long filmographies. */
  return `<button class="discover-media-similar-card discover-person-credit-card${showImdbRating ? ' discover-person-credit-card-filmography' : ''}" type="button" data-person-credit-key="${escAttr(creditKey)}" onclick="openDiscoverMediaProfile(event, '${itemType}', ${item.id})"><img src="${getTmdbImageUrl(item.poster_path || item.backdrop_path, 'w342')}" alt="" loading="lazy" decoding="async"><span class="discover-person-credit-title">${escHtml(itemTitle)}</span>${ratingHtml}<small class="discover-person-credit-role" data-person-role-missing="${hasRole ? '0' : '1'}" data-media-title="${escAttr(itemTitle)}" data-media-type="${escAttr(itemType)}" data-media-year="${escAttr(year)}">${escHtml(roleMeta)}</small></button>`;
}

function renderDiscoverPersonProfileDetails(details = {}) {
  const name = details.name || 'Cast Profile';
  /* v10.62: w780 -> w500. Rendered at ~140×210px hero card and the same image
     is reused for the small poster thumbnail. w500 is the right size for both. */
  const photo = getTmdbImageUrl(details.profile_path, 'w500');
  const department = details.known_for_department || '';
  const birthday = formatDiscoverMediaDate(details.birthday);
  const age = calculateDiscoverPersonAge(details.birthday, details.deathday);
  const birthplace = details.place_of_birth || '';
  const biography = String(details.biography || 'No biography is available yet.').trim();
  const mostKnownFor = getDiscoverPersonMostKnownFor(details);
  /* v734: filmography preview = 9 most-recent credits. Tapping the heading
     opens the full-page filmography view (every credit, paginated). */
  const filmographyPreview = getDiscoverPersonFilmographyPreview(details);
  const personId = details?.id;
  const genderLabel = Number(details.gender) === 1 ? 'Actress Profile' : (Number(details.gender) === 2 ? 'Actor Profile' : 'Performer Profile');
  const movieTvDesktopSource = !!details.__desktopMovieTvSource;

  return `<section class="discover-media-page discover-person-page${movieTvDesktopSource ? ' discover-person-page-desktop-cinema' : ''}" role="dialog" aria-modal="true" aria-label="${escAttr(name)} details">
    <button class="discover-media-back discover-media-back--icon" type="button" onclick="backToDiscoverTitleProfile()" aria-label="Back"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg></button>
    ${renderPersonProfileFavoriteHeart(details)}
    <div class="discover-media-hero discover-person-hero" style="${photo ? `background-image:url('${escAttr(photo)}')` : ''}">
      <!-- v10.62: hero uses background-image (kept — converting to <img> would
           require layout changes); the URL is now w500 (was w780), cutting the
           hero decode cost by ~60% on a person profile open. -->
      <div class="discover-media-hero-shade"></div>
      <div class="discover-media-hero-content">
        <div class="discover-media-hero-top">
          <div class="discover-media-poster discover-person-poster">${photo ? `<img src="${escAttr(photo)}" alt="" decoding="async">` : ''}</div>
          <div class="discover-media-hero-main">
            <div class="discover-media-kicker">${escHtml(genderLabel)}</div>
            <h2>${escHtml(name)}</h2>
            ${department ? `<div class="discover-media-tagline">${escHtml(department)}</div>` : ''}
          </div>
        </div>
        <p>${escHtml(biography)}</p>
      </div>
    </div>
    <div class="discover-media-body${movieTvDesktopSource ? ' discover-person-body-desktop-cinema' : ''}">
      <div class="discover-media-facts discover-person-bio-facts discover-person-overview-panel">
        ${age ? `<div class="primary"><strong data-person-bio-fact="age">${escHtml(age)}</strong><span>Age</span></div>` : `<div class="primary"><strong data-person-bio-fact="age">Checking...</strong><span>Age</span></div>`}
        ${birthday ? `<div><strong data-person-bio-fact="birthdate">${escHtml(birthday)}</strong><span>Birthdate</span></div>` : `<div><strong data-person-bio-fact="birthdate">Checking...</strong><span>Birthdate</span></div>`}
        <div><strong data-person-bio-fact="height">Checking...</strong><span>Height</span></div>
        <div><strong data-person-bio-fact="weight">Checking...</strong><span>Weight</span></div>
        <div><strong data-person-bio-fact="birthName">Checking...</strong><span>Birth Name</span></div>
        <div><strong data-person-bio-fact="nameTheyUse">${escHtml(name)}</strong><span>Name They Use</span></div>
        ${birthplace ? `<div><strong>${escHtml(birthplace)}</strong><span>Birthplace</span></div>` : ''}
        ${department ? `<div><strong>${escHtml(department)}</strong><span>Department</span></div>` : ''}
      </div>
      ${mostKnownFor.length ? `<div class="discover-media-section discover-person-most-known discover-person-section-card"><h3>Most Known For</h3><div class="discover-media-similar">${mostKnownFor.map(renderDiscoverPersonCreditCard).join('')}</div></div>` : ''}
      ${filmographyPreview.length ? `<div class="discover-media-section discover-person-filmography discover-person-section-card">
        <button class="discover-person-filmography-header" type="button" onclick="handlePersonFilmographyHeaderClick(event, '${escAttr(personId)}')" aria-label="Open full filmography">
          <h3>Filmography</h3>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <div class="discover-media-similar">${filmographyPreview.map(item => renderDiscoverPersonCreditCard(item, { showImdbRating: true })).join('')}</div>
      </div>` : ''}
    </div>
  </section>`;
}

/* v734: Filmography full-page overlay.
   Slides in from the right covering the person profile. Lists every credit,
   recent → oldest, with filter chips (All / Movies / TV) and a 3-column
   grid. Initial render shows 21 cards; "Load More" appends 9 at a time.
   Each card progressively enriches with OMDb metadata (IMDb rating, runtime,
   content rating).

   The filmography state is kept in module-scope so Load More can keep
   appending without re-fetching anything; OMDb enrichment fires only for the
   visible chunk. */
const FILMOGRAPHY_INITIAL_COUNT = 21;
const FILMOGRAPHY_LOAD_STEP = 9;
const FILMOGRAPHY_SORT_OPTIONS = [
  { key: 'recent', label: 'Most Recent', defaultDirection: 'desc' },
  { key: 'metascore', label: 'Meta Score', defaultDirection: 'desc', needsImdb: true },
  { key: 'imdb', label: 'IMDb Rating', defaultDirection: 'desc', needsImdb: true },
  { key: 'user', label: 'Your Rating', defaultDirection: 'desc' },
  { key: 'votes', label: 'Number of Ratings', defaultDirection: 'desc', needsImdb: true }
];
let filmographyPageState = null;

function filmographyMatchesFilter(item, filter) {
  if (!filter || filter === 'all') return true;
  const t = String(item?.media_type || '').toLowerCase();
  if (filter === 'movie') return t === 'movie';
  if (filter === 'tv') return t === 'tv';
  return true;
}

function renderFilmographyCard(item) {
  const mediaType = getDiscoverPersonCreditMediaType(item);
  const creditKey = getDiscoverPersonCreditLookupKey(item);
  const title = item?.title || item?.name || 'Untitled';
  const poster = item?.poster_path ? getTmdbImageUrl(item.poster_path, 'w342') : '';
  const character = String(getDiscoverPersonCreditRole(item) || '').trim();
  const year = (item?.release_date || item?.first_air_date || '').slice(0, 4);
  /* IMDb rating + runtime + content rating come from OMDb enrichment. While
     loading they show a quiet placeholder, replaced in-place when data lands. */
  const ratingText = formatDiscoverPersonCreditImdbRating(item) || '—';
  const runtime = String(item?.imdbRuntime || '').trim();
  const contentRating = String(item?.imdbRated || '').trim();
  const metaParts = [year, contentRating, runtime].filter(Boolean);
  const metaText = metaParts.length ? metaParts.join(' · ') : ' ';
  return `<button class="filmography-card" type="button" data-tmdb-id="${escAttr(item?.id || '')}" data-media-type="${escAttr(mediaType)}" data-credit-key="${escAttr(creditKey)}" onclick="openFilmographyMediaProfile(event, '${escAttr(creditKey)}')">
    <div class="filmography-card-poster">${poster ? `<img src="${escAttr(poster)}" alt="" loading="lazy" decoding="async">` : ''}</div>
    <div class="filmography-card-title">${escHtml(title)}</div>
    <div class="filmography-card-rating"><span aria-hidden="true">★</span><span data-card-imdb-rating>${escHtml(ratingText)}</span></div>
    <div class="filmography-card-meta" data-card-meta>${escHtml(metaText)}</div>
    <div class="filmography-card-character">${character ? `as ${escHtml(character)}` : ' '}</div>
  </button>`;
}

function getFilmographySortOption(sortKey = 'recent') {
  return FILMOGRAPHY_SORT_OPTIONS.find(option => option.key === sortKey) || FILMOGRAPHY_SORT_OPTIONS[0];
}

function parseFilmographySortNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const clean = String(value || '').trim();
  if (!clean || clean.toUpperCase() === 'N/A') return 0;
  const n = Number(clean.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function getFilmographyReleaseSortValue(item = {}) {
  const date = String(item.release_date || item.first_air_date || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const time = new Date(`${date}T00:00:00Z`).getTime();
    if (Number.isFinite(time)) return time;
  }
  const year = getPersonCreditYear(item);
  return year > 0 ? Date.UTC(year, 0, 1) : 0;
}

function getFilmographyImdbVoteCount(item = {}) {
  return parseFilmographySortNumber(item.imdbVotesNumber || item.imdbVotes || item.imdbVotesText);
}

function getFilmographyMetascore(item = {}) {
  return parseFilmographySortNumber(item.imdbMetascore || item.metascore || item.Metascore);
}

function getFilmographyUserRating(item = {}) {
  if (typeof data === 'undefined' || !data) return 0;
  const mediaType = getDiscoverPersonCreditMediaType(item);
  const sections = mediaType === 'movie' ? ['movies'] : ['shows', 'anime'];
  const titleKeys = getDuplicateTitleKeys(item);
  const tmdbId = String(item.id || item.tmdbId || item.tmdb_id || '').trim();
  for (const section of sections) {
    const entries = Array.isArray(data[section]) ? data[section] : [];
    for (const entry of entries) {
      if (!entry) continue;
      const entryTmdbId = String(entry.tmdbId || entry.tmdb_id || entry.mediaId || '').trim();
      const tmdbMatch = tmdbId && entryTmdbId && tmdbId === entryTmdbId;
      const titleMatch = titleKeys.size && [...getDuplicateTitleKeys(entry)].some(key => titleKeys.has(key));
      if (tmdbMatch || titleMatch) {
        const rating = Number(entry.rating || 0);
        if (rating > 0) return rating;
      }
    }
  }
  return 0;
}

function getFilmographySortValue(item = {}, sortKey = 'recent') {
  if (sortKey === 'recent') return getFilmographyReleaseSortValue(item);
  if (sortKey === 'metascore') return getFilmographyMetascore(item);
  if (sortKey === 'imdb') return Number(item.imdbRating || 0);
  if (sortKey === 'user') return getFilmographyUserRating(item);
  if (sortKey === 'votes') return getFilmographyImdbVoteCount(item);
  return getFilmographyReleaseSortValue(item);
}

function sortFilmographyCredits(items = [], state = filmographyPageState) {
  const sortKey = state?.sortKey || 'recent';
  const direction = state?.sortDirection === 'asc' ? 'asc' : 'desc';
  const sign = direction === 'asc' ? 1 : -1;
  return (Array.isArray(items) ? items.slice() : []).sort((a, b) => {
    const av = getFilmographySortValue(a, sortKey);
    const bv = getFilmographySortValue(b, sortKey);
    const aValid = Number.isFinite(av) && av > 0;
    const bValid = Number.isFinite(bv) && bv > 0;
    if (aValid !== bValid) return aValid ? -1 : 1;
    if (aValid && bValid && av !== bv) return (av - bv) * sign;
    const dateCompare = getFilmographyReleaseSortValue(b) - getFilmographyReleaseSortValue(a);
    if (dateCompare) return dateCompare;
    return String(a?.title || a?.name || '').localeCompare(String(b?.title || b?.name || ''));
  });
}

function getSortedFilmographyCredits(state = filmographyPageState) {
  if (!state) return [];
  const filtered = state.allCredits.filter(item => filmographyMatchesFilter(item, state.filter || 'all'));
  return sortFilmographyCredits(filtered, state);
}

function renderFilmographySortControls(state) {
  const activeOption = getFilmographySortOption(state?.sortKey || 'recent');
  const direction = state?.sortDirection === 'asc' ? 'asc' : 'desc';
  const menuOpen = !!state?.sortMenuOpen;
  return `<div class="filmography-sort-wrap">
    <button class="filmography-sort-trigger" type="button" aria-expanded="${menuOpen ? 'true' : 'false'}" onclick="toggleFilmographySortMenu()">
      <span>Sort: ${escHtml(activeOption.label)}</span><em>${direction === 'asc' ? '↑' : '↓'}</em>
    </button>
    ${menuOpen ? `<div class="filmography-sort-menu" role="menu" aria-label="Sort filmography">
      ${FILMOGRAPHY_SORT_OPTIONS.map(option => {
        const active = option.key === activeOption.key;
        const optionDirection = active ? direction : option.defaultDirection;
        return `<button class="filmography-sort-option${active ? ' active' : ''}" type="button" role="menuitem" onclick="setFilmographySort('${escAttr(option.key)}')">
          <span>${escHtml(option.label)}</span>${active ? `<em>${direction === 'asc' ? 'Ascending' : 'Descending'}</em><b aria-hidden="true">${optionDirection === 'asc' ? '↑' : '↓'}</b>` : ''}
        </button>`;
      }).join('')}
    </div>` : ''}
  </div>`;
}

function renderFilmographyPageMarkup(state) {
  const filter = state.filter || 'all';
  const filtered = getSortedFilmographyCredits(state);
  const visible = filtered.slice(0, state.visibleCount);
  const hasMore = filtered.length > visible.length;
  return `<section class="filmography-page" role="dialog" aria-modal="true" aria-label="${escAttr(state.personName || 'Filmography')}">
    <div class="filmography-page-header">
      <button class="discover-media-back filmography-page-back" type="button" onclick="closePersonFilmographyPage()">Back</button>
      <h2 class="filmography-page-title">${escHtml(state.personName || 'Filmography')}</h2>
    </div>
    <div class="filmography-page-chips" role="tablist" aria-label="Filter filmography by media type">
      <button type="button" class="filmography-chip${filter === 'all' ? ' active' : ''}" data-filmography-filter="all" role="tab" aria-selected="${filter === 'all' ? 'true' : 'false'}">All</button>
      <button type="button" class="filmography-chip${filter === 'movie' ? ' active' : ''}" data-filmography-filter="movie" role="tab" aria-selected="${filter === 'movie' ? 'true' : 'false'}">Movies</button>
      <button type="button" class="filmography-chip${filter === 'tv' ? ' active' : ''}" data-filmography-filter="tv" role="tab" aria-selected="${filter === 'tv' ? 'true' : 'false'}">TV</button>
    </div>
    ${renderFilmographySortControls(state)}
    <div class="filmography-page-body">
      ${visible.length
        ? `<div class="filmography-grid">${visible.map(renderFilmographyCard).join('')}</div>`
        : `<div class="discover-message">No credits in this category.</div>`}
      ${hasMore ? `<button class="filmography-load-more" type="button" onclick="loadMoreFilmographyItems()">Load More</button>` : ''}
    </div>
  </section>`;
}

function getFilmographyPageBody(overlay = document.getElementById('filmography-page-overlay')) {
  return overlay?.querySelector?.('.filmography-page-body') || null;
}

function getFilmographyPageScrollTop() {
  return Number(getFilmographyPageBody()?.scrollTop || 0);
}

function restoreFilmographyPageScroll(scrollTop = 0) {
  const body = getFilmographyPageBody();
  if (!body) return;
  body.scrollTop = Math.max(0, Number(scrollTop || 0));
}

function restoreFilmographyPageScrollStable(scrollTop = 0, frames = 4) {
  const top = Math.max(0, Number(scrollTop || 0));
  restoreFilmographyPageScroll(top);
  let remaining = Math.max(0, Number(frames || 0));
  const tick = () => {
    if (!remaining || !document.getElementById('filmography-page-overlay')) return;
    remaining -= 1;
    restoreFilmographyPageScroll(top);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function getFilmographyCreditByKey(creditKey = '') {
  if (!filmographyPageState || !creditKey) return null;
  return filmographyPageState.allCredits.find(item => getDiscoverPersonCreditLookupKey(item) === creditKey) || null;
}

function shouldReturnToFilmographyFromMediaProfile(reasonOrOptions = null) {
  if (!activeDiscoverMediaProfileState?.filmographyReturn) return false;
  if (typeof reasonOrOptions === 'string') return ['back', 'escape', 'pull-down'].includes(reasonOrOptions);
  if (reasonOrOptions && typeof reasonOrOptions === 'object') {
    return ['back', 'escape', 'pull-down'].includes(String(reasonOrOptions.reason || ''));
  }
  return false;
}

function returnToFilmographyFromMediaProfile() {
  const overlay = document.getElementById('discover-media-profile');
  const returnState = activeDiscoverMediaProfileState?.filmographyReturn || null;
  const previousState = returnState?.previousState || null;
  destroyDiscoverHeroTrailerPreview(overlay);
  document.body.classList.remove('filmography-title-profile-open', 'media-profile-swipe-reveal-active');
  if (overlay && previousState?.view === 'person' && previousState.details) {
    activeDiscoverMediaProfileState = previousState;
    overlay.innerHTML = renderDiscoverPersonProfileDetails(previousState.details);
    bindDiscoverMediaProfileSwipeBack(overlay);
    hydrateDiscoverPersonBioFacts(previousState.details);
    hydrateDiscoverPersonRoleFallbacks(previousState.details);
    hydrateDiscoverPersonFilmographyRatings(previousState.details);
  } else if (overlay && previousState?.view === 'title' && previousState.details && (previousState.type === 'movie' || previousState.type === 'tv')) {
    activeDiscoverMediaProfileState = previousState;
    overlay.innerHTML = renderDiscoverMediaProfileDetails(previousState.type, previousState.details, previousState.id);
    bindDiscoverMediaProfileActions(overlay);
    hydrateDiscoverHeroTrailerPreview(overlay);
    hydrateDeepSeekMoreLikeThis(previousState.type, previousState.details);
    hydrateDiscoverProviderLogoFallbacks();
  } else {
    activeDiscoverMediaProfileState = previousState || null;
  }
  document.body.classList.add('filmography-page-open');
  restoreFilmographyPageScrollStable(returnState?.scrollTop || filmographyPageState?.scrollTop || 0);
}

function openFilmographyMediaProfile(event, creditKey = '') {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  event?.stopImmediatePropagation?.();
  const item = getFilmographyCreditByKey(String(creditKey || ''));
  const mediaType = getDiscoverPersonCreditMediaType(item || {});
  const tmdbId = item?.id || item?.tmdbId || item?.tmdb_id || 0;
  if (!item || !tmdbId || (mediaType !== 'movie' && mediaType !== 'tv')) return;
  const scrollTop = getFilmographyPageScrollTop();
  filmographyPageState.scrollTop = scrollTop;
  discoverMediaProfileSeeds.set(getDiscoverMediaProfileKey(mediaType, tmdbId), {
    ...item,
    media_type: mediaType,
    poster_path: item.poster_path || '',
    backdrop_path: item.backdrop_path || ''
  });
  openDiscoverMediaProfile(event, mediaType, tmdbId, event?.currentTarget || event?.target, {
    fromFilmography: true,
    filmographyScrollTop: scrollTop,
    previousState: activeDiscoverMediaProfileState ? { ...activeDiscoverMediaProfileState } : null
  });
}

async function openPersonFilmographyPage(personIdRaw) {
  const personId = String(personIdRaw || '').trim();
  if (!personId) return;

  /* Reuse the cached person details if the profile already opened; else fetch. */
  let details = activeDiscoverMediaProfileState?.view === 'person'
    && String(activeDiscoverMediaProfileState.personId) === personId
    ? activeDiscoverMediaProfileState.details
    : null;

  if (!details) {
    try {
      const res = await fetchTmdbProxy(`person/${personId}`, { append_to_response: 'combined_credits' });
      if (res.ok) details = await res.json();
    } catch (e) { /* fall through with empty details */ }
  }

  const allCredits = getDiscoverPersonFilmographyAll(details || {});

  filmographyPageState = {
    personId,
    personName: details?.name || 'Filmography',
    allCredits,
    filter: 'all',
    sortKey: 'recent',
    sortDirection: 'desc',
    sortMenuOpen: false,
    visibleCount: FILMOGRAPHY_INITIAL_COUNT,
    enriched: new Set()
  };

  let overlay = document.getElementById('filmography-page-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'filmography-page-overlay';
    overlay.className = 'filmography-page-overlay';
    /* Set initial offscreen transform inline so the very first paint shows
       it offscreen, then the .open class can transition it in. Without this
       a freshly-created element can sometimes paint at translateX(0) before
       the CSS transform from the class kicks in. */
    overlay.style.transform = 'translateX(100%)';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = renderFilmographyPageMarkup(filmographyPageState);
  document.body.classList.add('filmography-page-open');
  bindFilmographyPageActions(overlay);
  /* Force reflow so the next style change is treated as a transition,
     not as initial styles. Reading offsetWidth is the canonical pattern. */
  void overlay.offsetWidth;
  /* Clear inline transform so the .open class's CSS transform takes effect. */
  overlay.style.transform = '';
  overlay.classList.add('open');
  enrichVisibleFilmographyCards();
  document.addEventListener('keydown', handleFilmographyEsc);
}

function handlePersonFilmographyHeaderClick(event, personIdRaw) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  event?.stopImmediatePropagation?.();
  openPersonFilmographyPage(personIdRaw);
}

function bindFilmographyPageActions(overlay) {
  if (!overlay) return;
  overlay.querySelectorAll('.filmography-chip[data-filmography-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!filmographyPageState) return;
      filmographyPageState.filter = btn.getAttribute('data-filmography-filter') || 'all';
      filmographyPageState.visibleCount = FILMOGRAPHY_INITIAL_COUNT;
      filmographyPageState.sortMenuOpen = false;
      overlay.innerHTML = renderFilmographyPageMarkup(filmographyPageState);
      bindFilmographyPageActions(overlay);
      const body = overlay.querySelector('.filmography-page-body');
      if (body) body.scrollTop = 0;
      enrichVisibleFilmographyCards();
    });
  });
}

function rerenderFilmographyPage({ scrollTop = true } = {}) {
  const overlay = document.getElementById('filmography-page-overlay');
  if (!overlay || !filmographyPageState) return;
  overlay.innerHTML = renderFilmographyPageMarkup(filmographyPageState);
  bindFilmographyPageActions(overlay);
  const body = overlay.querySelector('.filmography-page-body');
  if (scrollTop && body) body.scrollTop = 0;
  enrichVisibleFilmographyCards();
}

function toggleFilmographySortMenu() {
  if (!filmographyPageState) return;
  filmographyPageState.sortMenuOpen = !filmographyPageState.sortMenuOpen;
  rerenderFilmographyPage({ scrollTop: false });
}

function setFilmographySort(sortKey = 'recent') {
  if (!filmographyPageState) return;
  const option = getFilmographySortOption(sortKey);
  if (filmographyPageState.sortKey === option.key) {
    filmographyPageState.sortDirection = filmographyPageState.sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    filmographyPageState.sortKey = option.key;
    filmographyPageState.sortDirection = option.defaultDirection || 'desc';
  }
  filmographyPageState.visibleCount = FILMOGRAPHY_INITIAL_COUNT;
  filmographyPageState.sortMenuOpen = true;
  rerenderFilmographyPage();
  ensureFilmographySortData(option.key);
}

function loadMoreFilmographyItems() {
  if (!filmographyPageState) return;
  filmographyPageState.visibleCount += FILMOGRAPHY_LOAD_STEP;
  const overlay = document.getElementById('filmography-page-overlay');
  if (!overlay) return;
  overlay.innerHTML = renderFilmographyPageMarkup(filmographyPageState);
  bindFilmographyPageActions(overlay);
  enrichVisibleFilmographyCards();
}

/* Progressive OMDb enrichment for the visible card window. Items already
   enriched in a previous pass are skipped via the `enriched` Set. After
   enrichment the rating + meta line of each card is patched in place. */
async function enrichVisibleFilmographyCards() {
  if (!filmographyPageState || typeof window.enrichItemsWithImdbRatings !== 'function') return;
  const filtered = getSortedFilmographyCredits(filmographyPageState);
  const visible = filtered.slice(0, filmographyPageState.visibleCount);
  const toEnrich = getUnenrichedFilmographyItems(visible);
  if (!toEnrich.length) {
    patchFilmographyCardEnrichment(visible);
    return;
  }
  try {
    await window.enrichItemsWithImdbRatings(toEnrich);
  } catch (e) { /* ignore — cards keep placeholder text */ }
  patchFilmographyCardEnrichment(visible);
}

function getUnenrichedFilmographyItems(items = []) {
  if (!filmographyPageState) return [];
  return (Array.isArray(items) ? items : []).filter(item => {
    const key = `${item.media_type || 'movie'}:${item.id}`;
    if (filmographyPageState.enriched.has(key)) return false;
    filmographyPageState.enriched.add(key);
    return true;
  });
}

async function ensureFilmographySortData(sortKey = '') {
  if (!filmographyPageState || typeof window.enrichItemsWithImdbRatings !== 'function') return;
  const option = getFilmographySortOption(sortKey);
  if (!option.needsImdb) return;
  const requestedKey = option.key;
  const requestedDirection = filmographyPageState.sortDirection;
  const filtered = filmographyPageState.allCredits.filter(item =>
    filmographyMatchesFilter(item, filmographyPageState.filter));
  const toEnrich = filtered.filter(item => getFilmographySortValue(item, option.key) <= 0);
  if (!toEnrich.length) return;
  try {
    await window.enrichItemsWithImdbRatings(toEnrich);
  } catch (e) { /* fail soft: missing sort data stays at the end */ }
  if (!filmographyPageState || filmographyPageState.sortKey !== requestedKey || filmographyPageState.sortDirection !== requestedDirection) return;
  rerenderFilmographyPage({ scrollTop: false });
}

function patchFilmographyCardEnrichment(items = []) {
  const overlay = document.getElementById('filmography-page-overlay');
  if (!overlay) return;
  items.forEach(item => {
    const creditKey = getDiscoverPersonCreditLookupKey(item);
    if (!creditKey) return;
    const card = overlay.querySelector(`.filmography-card[data-credit-key="${CSS.escape(creditKey)}"]`);
    if (!card) return;
    const ratingEl = card.querySelector('[data-card-imdb-rating]');
    const metaEl = card.querySelector('[data-card-meta]');
    const r = Number(item.imdbRating || 0);
    if (ratingEl) ratingEl.textContent = r > 0 ? r.toFixed(1) : '—';
    const year = (item.release_date || item.first_air_date || '').slice(0, 4);
    const contentRating = String(item.imdbRated || '').trim();
    const runtime = String(item.imdbRuntime || '').trim();
    const metaParts = [year, contentRating, runtime].filter(Boolean);
    if (metaEl) metaEl.textContent = metaParts.join(' · ') || ' ';
  });
}

function closePersonFilmographyPage() {
  const overlay = document.getElementById('filmography-page-overlay');
  if (overlay) {
    overlay.classList.remove('open');
    setTimeout(() => {
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 280);
  }
  document.body.classList.remove('filmography-page-open');
  document.removeEventListener('keydown', handleFilmographyEsc);
  filmographyPageState = null;
}

function handleFilmographyEsc(event) {
  if (document.body.classList.contains('filmography-title-profile-open')) return;
  if (event.key === 'Escape') closePersonFilmographyPage();
}

window.openPersonFilmographyPage = openPersonFilmographyPage;
window.handlePersonFilmographyHeaderClick = handlePersonFilmographyHeaderClick;
window.closePersonFilmographyPage = closePersonFilmographyPage;
window.loadMoreFilmographyItems = loadMoreFilmographyItems;
window.toggleFilmographySortMenu = toggleFilmographySortMenu;
window.setFilmographySort = setFilmographySort;
window.openFilmographyMediaProfile = openFilmographyMediaProfile;

/* =============================================================================
   v10.115: Full-page cast view for a media profile.

   Mirrors the filmography-page-overlay slide-in pattern: lifts cast from
   the currently-open media profile's cached details (TMDB
   `details.credits.cast`, which Jikan-mapped anime also conform to), and
   renders the entire cast in a scrollable grid. Cards reuse the existing
   `renderDiscoverCastCard` markup, so tap behavior (open actor profile)
   is identical to the inline cast row.

   No new data fetch — the cast is already attached to the profile
   details when the title page was loaded.
   ========================================================================== */
function getActiveMediaCastList() {
  const details = activeDiscoverMediaProfileState?.details || null;
  const cast = (details?.credits?.cast || []).filter(person => person?.name);
  return cast;
}

function getActiveMediaProfileTitle() {
  const details = activeDiscoverMediaProfileState?.details || null;
  if (!details) return 'Cast';
  const type = activeDiscoverMediaProfileState?.type || 'movie';
  if (typeof getDiscoverMediaTitle === 'function') {
    return getDiscoverMediaTitle(details, type) || 'Cast';
  }
  return details.title || details.name || 'Cast';
}

function renderMediaCastPageMarkup(state) {
  const title = state?.title || 'Cast';
  const cast = Array.isArray(state?.cast) ? state.cast : [];
  const totalLabel = cast.length ? `${cast.length} ${cast.length === 1 ? 'actor' : 'actors'}` : '';
  return `<section class="media-cast-page" role="dialog" aria-modal="true" aria-label="${escAttr(title)} cast">
    <div class="media-cast-page-header">
      <button class="discover-media-back media-cast-page-back" type="button" onclick="closeMediaCastPage()">Back</button>
      <h2 class="media-cast-page-title">${escHtml(title)}</h2>
      ${totalLabel ? `<div class="media-cast-page-subtitle">${escHtml(totalLabel)}</div>` : ''}
    </div>
    <div class="media-cast-page-body">
      ${cast.length
        ? `<div class="media-cast-grid">${cast.map(person => renderDiscoverCastCard(person)).join('')}</div>`
        : `<div class="discover-message">No cast information available.</div>`}
    </div>
  </section>`;
}

function openMediaCastPage() {
  const cast = getActiveMediaCastList();
  if (!cast.length) return;
  const title = getActiveMediaProfileTitle();
  let overlay = document.getElementById('media-cast-page-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'media-cast-page-overlay';
    overlay.className = 'media-cast-page-overlay';
    /* Same initial-offscreen pattern as the filmography page so the
       very first paint sits offscreen and the .open class transitions
       it in cleanly. */
    overlay.style.transform = 'translateX(100%)';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = renderMediaCastPageMarkup({ title, cast });
  document.body.classList.add('media-cast-page-open');
  void overlay.offsetWidth;
  overlay.style.transform = '';
  overlay.classList.add('open');
  document.addEventListener('keydown', handleMediaCastPageEsc);
}

function closeMediaCastPage() {
  const overlay = document.getElementById('media-cast-page-overlay');
  if (overlay) {
    overlay.classList.remove('open');
    setTimeout(() => {
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 280);
  }
  document.body.classList.remove('media-cast-page-open');
  document.removeEventListener('keydown', handleMediaCastPageEsc);
}

function handleMediaCastPageEsc(event) {
  if (event.key === 'Escape') closeMediaCastPage();
}

window.openMediaCastPage = openMediaCastPage;
window.closeMediaCastPage = closeMediaCastPage;

/* =============================================================================
   v10.117: Full-page Characters view for an anime media profile.

   Mirrors the Cast page (.media-cast-page-overlay) one-to-one in lifecycle
   and animation. Cards reuse the .discover-media-cast-card markup with a
   .discover-media-character-card modifier so layout/sizing stays
   consistent — but with no heart-favorite button and no tap-to-open
   behavior (characters are not navigable entities in-app).

   Data source: details.credits.characters (Jikan-mapped). No fetch.
   ========================================================================== */
function getActiveMediaCharactersList() {
  const details = activeDiscoverMediaProfileState?.details || null;
  const list = (details?.credits?.characters || []).filter(ch => ch?.name);
  return list;
}

function renderMediaCharactersPageMarkup(state) {
  const title = state?.title || 'Characters';
  const list = Array.isArray(state?.characters) ? state.characters : [];
  const totalLabel = list.length ? `${list.length} ${list.length === 1 ? 'character' : 'characters'}` : '';
  return `<section class="media-cast-page media-characters-page" role="dialog" aria-modal="true" aria-label="${escAttr(title)} characters">
    <div class="media-cast-page-header">
      <button class="discover-media-back media-cast-page-back" type="button" onclick="closeMediaCharactersPage()">Back</button>
      <h2 class="media-cast-page-title">${escHtml(title)}</h2>
      ${totalLabel ? `<div class="media-cast-page-subtitle">${escHtml(totalLabel)}</div>` : ''}
    </div>
    <div class="media-cast-page-body">
      ${list.length
        ? `<div class="media-cast-grid">${list.map(renderAnimeCharacterCard).join('')}</div>`
        : `<div class="discover-message">No character information available.</div>`}
    </div>
  </section>`;
}

function openMediaCharactersPage() {
  const characters = getActiveMediaCharactersList();
  if (!characters.length) return;
  const title = getActiveMediaProfileTitle();
  let overlay = document.getElementById('media-characters-page-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'media-characters-page-overlay';
    overlay.className = 'media-cast-page-overlay media-characters-page-overlay';
    /* Initial offscreen transform so the very first paint sits offscreen
       and the .open class transitions it in cleanly. Same pattern as the
       cast and filmography pages. */
    overlay.style.transform = 'translateX(100%)';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = renderMediaCharactersPageMarkup({ title, characters });
  document.body.classList.add('media-cast-page-open');
  void overlay.offsetWidth;
  overlay.style.transform = '';
  overlay.classList.add('open');
  document.addEventListener('keydown', handleMediaCharactersPageEsc);
}

function closeMediaCharactersPage() {
  const overlay = document.getElementById('media-characters-page-overlay');
  if (overlay) {
    overlay.classList.remove('open');
    setTimeout(() => {
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 280);
  }
  /* If the cast overlay isn't open either, clear the shared body class.
     The cast page also adds .media-cast-page-open, so we only remove
     when both are gone. */
  if (!document.getElementById('media-cast-page-overlay')) {
    document.body.classList.remove('media-cast-page-open');
  }
  document.removeEventListener('keydown', handleMediaCharactersPageEsc);
}

function handleMediaCharactersPageEsc(event) {
  if (event.key === 'Escape') closeMediaCharactersPage();
}

window.openMediaCharactersPage = openMediaCharactersPage;
window.closeMediaCharactersPage = closeMediaCharactersPage;

async function hydrateDiscoverPersonFilmographyRatings(details = {}) {
  if (typeof window.enrichItemsWithImdbRatings !== 'function') return;
  const previewItems = getDiscoverPersonFilmographyPreview(details);
  if (!previewItems.length) return;
  try {
    await window.enrichItemsWithImdbRatings(previewItems);
  } catch (e) { /* fail soft: keep layout, omit IMDb rating text */ }
  patchDiscoverPersonFilmographyRatings(previewItems);
}

function patchDiscoverPersonFilmographyRatings(items = []) {
  const overlay = document.getElementById('discover-media-profile');
  if (!overlay) return;
  items.forEach(item => {
    const creditKey = getDiscoverPersonCreditLookupKey(item);
    if (!creditKey) return;
    const card = overlay.querySelector(`.discover-person-filmography .discover-person-credit-card[data-person-credit-key="${CSS.escape(creditKey)}"]`);
    if (!card) return;
    const ratingWrap = card.querySelector('[data-person-credit-rating]');
    const ratingValue = card.querySelector('[data-person-credit-rating-value]');
    if (!ratingWrap || !ratingValue) return;
    const imdbRating = formatDiscoverPersonCreditImdbRating(item);
    if (imdbRating) {
      ratingValue.textContent = imdbRating;
      ratingWrap.hidden = false;
      ratingWrap.classList.add('is-ready');
    } else {
      ratingValue.textContent = '';
      ratingWrap.hidden = true;
      ratingWrap.classList.remove('is-ready');
    }
  });
}

function getDiscoverMediaProfilePage(overlay = document.getElementById('discover-media-profile')) {
  return overlay?.querySelector?.('.discover-media-page') || null;
}

function getDiscoverMediaProfileScrollTop(overlay = document.getElementById('discover-media-profile')) {
  const page = getDiscoverMediaProfilePage(overlay);
  return page ? Number(page.scrollTop || 0) : 0;
}

function restoreDiscoverMediaProfileScroll(overlay, scrollTop = 0) {
  const page = getDiscoverMediaProfilePage(overlay);
  if (!page) return;
  page.scrollTop = Math.max(0, Number(scrollTop || 0));
}

function restoreDiscoverMediaProfileScrollStable(overlay, scrollTop = 0, frames = 4) {
  const top = Math.max(0, Number(scrollTop || 0));
  restoreDiscoverMediaProfileScroll(overlay, top);
  let remaining = Math.max(0, Number(frames || 0));
  const tick = () => {
    if (!remaining || !document.body.contains(overlay)) return;
    remaining -= 1;
    restoreDiscoverMediaProfileScroll(overlay, top);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function getDiscoverPersonHeroOriginElement(trigger = null) {
  const node = trigger?.nodeType === 1 ? trigger : trigger?.target || null;
  const card = node?.closest?.('.discover-media-cast-card');
  return card?.querySelector?.('.discover-media-cast-photo img')
    || card?.querySelector?.('.discover-media-cast-photo')
    || null;
}

function getDiscoverPersonHeroTargetElement(overlay = document.getElementById('discover-media-profile')) {
  return overlay?.querySelector?.('.discover-person-poster img')
    || overlay?.querySelector?.('.discover-person-poster')
    || null;
}

function getDiscoverPersonSeedFromTrigger(trigger = null, personId = '') {
  const node = trigger?.nodeType === 1 ? trigger : trigger?.target || null;
  const card = node?.closest?.('.discover-media-cast-card');
  if (!card) return { id: personId };
  return {
    id: personId || card.dataset.personId || '',
    name: card.dataset.personName || '',
    profile_path: card.dataset.personPhoto || '',
    known_for_department: card.dataset.personRole || ''
  };
}

function getDiscoverPersonReturnTargetElement(personId = '', overlay = document.getElementById('discover-media-profile')) {
  const id = String(personId || '').trim();
  if (!id || !overlay) return null;
  const card = overlay.querySelector(`.discover-media-cast-card[data-person-id="${CSS.escape(id)}"]`);
  return card?.querySelector?.('.discover-media-cast-photo img')
    || card?.querySelector?.('.discover-media-cast-photo')
    || null;
}

function createDiscoverPersonHeroPortal(sourceElement = null) {
  if (!sourceElement || typeof createMediaProfilePosterClosePortal !== 'function' || typeof getMediaProfileOriginRect !== 'function') {
    return null;
  }
  /* v11.334: the rect read was OUTSIDE the try — if getMediaProfileOriginRect
     threw, the exception propagated all the way out of openDiscoverPersonProfile
     BEFORE the actor section was injected, so the profile never opened
     ("nothing happens"). The portal is only a cosmetic open animation, so a
     failure here must NEVER abort the open. Wrap the whole body. */
  try {
    const sourceRect = getMediaProfileOriginRect(sourceElement);
    if (!sourceRect) return null;
    const portal = createMediaProfilePosterClosePortal(sourceElement, sourceRect, sourceElement, sourceRect);
    return portal ? { portal, sourceRect } : null;
  } catch (error) {
    return null;
  }
}

function animateDiscoverPersonHeroPortal(portalInfo = null, targetElement = null, done = null) {
  const portal = portalInfo?.portal || null;
  const sourceRect = portalInfo?.sourceRect || null;
  if (!portal || !sourceRect || !targetElement || typeof getMediaProfileOriginRect !== 'function' || typeof getMediaProfileRectTransform !== 'function') {
    portal?.remove?.();
    if (typeof done === 'function') done();
    return;
  }
  const targetRect = getMediaProfileOriginRect(targetElement);
  if (!targetRect || typeof portal.animate !== 'function') {
    portal.remove();
    if (typeof done === 'function') done();
    return;
  }
  const originalTargetVisibility = targetElement.style.visibility;
  targetElement.style.visibility = 'hidden';
  const restore = () => {
    if (targetElement?.isConnected) targetElement.style.visibility = originalTargetVisibility;
    portal.remove();
    if (typeof done === 'function') done();
  };
  const duration = typeof MEDIA_PROFILE_HERO_DURATION_MS === 'number' ? MEDIA_PROFILE_HERO_DURATION_MS : 400;
  const easing = typeof MEDIA_PROFILE_HERO_EASING === 'string' ? MEDIA_PROFILE_HERO_EASING : 'cubic-bezier(0.4, 0, 0.2, 1)';
  const animation = portal.animate([
    {
      transform: 'translate3d(0, 0, 0) scale(1, 1)',
      opacity: 1,
      boxShadow: '0 18px 48px rgba(0,0,0,0.45)'
    },
    {
      transform: getMediaProfileRectTransform(sourceRect, targetRect),
      opacity: 1,
      boxShadow: '0 0 0 rgba(0,0,0,0)'
    }
  ], {
    duration,
    easing,
    fill: 'both'
  });
  if (typeof finishMediaProfileHeroAnimation === 'function') finishMediaProfileHeroAnimation(animation, restore);
  else {
    animation.onfinish = restore;
    animation.oncancel = restore;
    setTimeout(restore, duration + 80);
  }
}

function finishDiscoverPersonProfileRender(overlay, details, openingPortalInfo = null) {
  if (!overlay || !document.getElementById('discover-media-profile')) {
    openingPortalInfo?.portal?.remove?.();
    return;
  }
  /* v11.193: the layered open (openDiscoverPersonProfile) preserves the
     PREVIOUS media profile as `.discover-back-underlay` (z-index 1) so the
     swipe-back reveals THAT title, not the discovery page two levels down.
     The old `overlay.innerHTML = …` here wiped BOTH sections — destroying the
     underlay before the user could ever swipe, so the reveal showed discovery.
     Fix: when an underlay exists, swap ONLY the active actor section (keeping
     the underlay sibling + its scroll position intact). First-open / fallback
     path (no underlay) keeps the original full innerHTML replace. */
  const underlay = overlay.querySelector(':scope > .discover-back-underlay');
  if (underlay) {
    const oldActor = overlay.querySelector(':scope > .discover-person-active-section')
      || overlay.querySelector(':scope > section:not(.discover-back-underlay)');
    const template = document.createElement('template');
    template.innerHTML = renderDiscoverPersonProfileDetails(details);
    const newActor = template.content.firstElementChild;
    if (newActor) {
      /* Re-apply the same overlay-section wrapper the shell used so the new
         section sits on top of the underlay identically. */
      newActor.classList.add('discover-person-active-section');
      newActor.style.position = 'absolute';
      newActor.style.inset = '0';
      newActor.style.zIndex = '2';
      newActor.style.backgroundColor = '#0E0E0E';
      if (oldActor && oldActor.parentNode === overlay) overlay.replaceChild(newActor, oldActor);
      else overlay.appendChild(newActor);
    }
  } else {
    overlay.innerHTML = renderDiscoverPersonProfileDetails(details);
  }
  bindDiscoverMediaProfileSwipeBack(overlay);
  hydrateDiscoverPersonBioFacts(details);
  hydrateDiscoverPersonRoleFallbacks(details);
  hydrateDiscoverPersonFilmographyRatings(details);
  const target = getDiscoverPersonHeroTargetElement(overlay);
  if (openingPortalInfo && target) {
    requestAnimationFrame(() => animateDiscoverPersonHeroPortal(openingPortalInfo, target));
  } else {
    openingPortalInfo?.portal?.remove?.();
  }
}

async function openDiscoverPersonProfile(event, personId) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if (!personId) return;
  const trigger = event?.currentTarget || event?.target || null;
  const personSeed = getDiscoverPersonSeedFromTrigger(trigger, personId);
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
  if (previousState) {
    previousState.mediaProfileScrollTop = getDiscoverMediaProfileScrollTop(overlay);
    previousState.personHeroOriginId = String(personId);
  }
  const movieTvDesktopSource = !!(previousState && (previousState.type === 'movie' || previousState.type === 'tv') && !previousState.details?.isAnime);
  /* v11.334: the open animation portal + trailer teardown are cosmetic — guard
     them so a throw here can never abort the open before the actor section is
     injected (this was the desktop "clicking a cast card does nothing" bug). */
  let openingPortalInfo = null;
  try {
    openingPortalInfo = createDiscoverPersonHeroPortal(getDiscoverPersonHeroOriginElement(trigger));
  } catch (_) { openingPortalInfo = null; }
  try { destroyDiscoverHeroTrailerPreview(overlay); } catch (_) {}
  /* v10.491: LAYERED open. Instead of replacing `overlay.innerHTML` (which
     destroys the previous media-profile content and forces backToDiscoverTitleProfile
     to re-render from scratch with a hero-zoom transition), we PRESERVE
     the previous section as an absolutely-positioned underlay (z-index 1)
     and APPEND the new actor section on top (z-index 2). This way:

       • The actor section is the innermost page-sized positioned
         ancestor of its back button — the swipe-back generic fallback
         (31-edge-swipe-back.js) drags THE ACTOR SECTION, and the media
         profile underneath is revealed naturally during the drag.
       • backToDiscoverTitleProfile just slides the actor section off
         to the right and removes it. The underlay is already in place
         with the correct scroll position — no re-render, no hero zoom.

     Only fires when `hadOverlay` is true (the user came from an existing
     media-profile overlay). First-time opens keep the standard
     innerHTML-replace flow. */
  let personSectionInjected = false;
  if (hadOverlay) {
    const previousSection = overlay.firstElementChild;
    if (previousSection) {
      previousSection.classList.add('discover-back-underlay');
      previousSection.style.position = 'absolute';
      previousSection.style.inset = '0';
      previousSection.style.zIndex = '1';
      /* The previous section's own scroll behavior is preserved (it
         already has overflow-y: auto from its base styling). Set
         scrollTop now so when the actor section slides off, the user
         sees the media profile already at the right vertical position. */
      try { previousSection.scrollTop = previousState?.mediaProfileScrollTop || 0; } catch (_) {}
    }
    /* Build the new actor section as a DOM element (not innerHTML
       replace) so we can append it as a sibling on top of the underlay. */
    const template = document.createElement('template');
    template.innerHTML = renderDiscoverPersonProfileShell(personSeed);
    const personSection = template.content.firstElementChild;
    if (personSection) {
      personSection.classList.add('discover-person-active-section');
      personSection.style.position = 'absolute';
      personSection.style.inset = '0';
      personSection.style.zIndex = '2';
      personSection.style.backgroundColor = '#0E0E0E';
      overlay.appendChild(personSection);
      personSectionInjected = true;
    }
  }
  if (!personSectionInjected) {
    /* Fallback / first-open path: standard innerHTML replace. No
       underlay because there's nothing previous to preserve. */
    overlay.innerHTML = renderDiscoverPersonProfileShell(personSeed);
  }
  bindDiscoverMediaProfileSwipeBack(overlay);
  /* v10.489: Slide-in-from-right animation for actor/actress profiles.
     v10.491: scoped to the new actor section (via
     `.discover-person-active-section`) so the underlay underneath
     doesn't get the same animation applied. */
  if (hadOverlay) {
    overlay.classList.add('discover-person-entering');
    setTimeout(() => {
      try { overlay.classList.remove('discover-person-entering'); } catch (_) {}
    }, 360);
  }
  const shellHeroTarget = getDiscoverPersonHeroTargetElement(overlay);
  if (openingPortalInfo && shellHeroTarget) {
    requestAnimationFrame(() => animateDiscoverPersonHeroPortal(openingPortalInfo, shellHeroTarget));
  } else {
    openingPortalInfo?.portal?.remove?.();
  }
  try {
    const res = await fetchTmdbProxy(`person/${personId}`, { append_to_response: 'combined_credits,external_ids' });
    if (!res.ok) throw new Error(`TMDB person request failed: ${res.status}`);
    const details = await res.json();
    details.__desktopMovieTvSource = movieTvDesktopSource;
    activeDiscoverMediaProfileState = {
      view: 'person',
      personId: String(personId),
      previous: previousState,
      details
    };
    if (!document.getElementById('discover-media-profile')) return;
    finishDiscoverPersonProfileRender(overlay, details, null);
  } catch (error) {
    console.error('Discover person profile failed:', error);
    openingPortalInfo?.portal?.remove?.();
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
  destroyDiscoverHeroTrailerPreview(overlay);

  /* v10.491: Rewritten to remove the hero-zoom portal animation and
     replace it with a clean slide-off-right. Pairs with the layered
     open in openDiscoverPersonProfile — the previous media profile is
     already rendered as an underlay (`.discover-back-underlay`,
     z-index 1) and the actor profile sits on top
     (`.discover-person-active-section`, z-index 2). All we have to do
     is slide the actor section off to the right, then remove it. The
     underlay is already at the correct scroll position. */

  const actorSection = overlay.querySelector(':scope > .discover-person-active-section')
    || overlay.querySelector(':scope > section:not(.discover-back-underlay)')
    || overlay.lastElementChild;
  const underlay = overlay.querySelector(':scope > .discover-back-underlay');

  /* Cleanup helper — used by both the button-click and swipe-back paths. */
  const finishCleanup = () => {
    try { if (actorSection && actorSection.parentNode === overlay) actorSection.remove(); } catch (_) {}
    if (underlay) {
      const savedScroll = (() => {
        try { return underlay.scrollTop || (previousState.mediaProfileScrollTop || 0); } catch (_) { return previousState.mediaProfileScrollTop || 0; }
      })();
      try {
        underlay.classList.remove('discover-back-underlay');
        underlay.style.position = '';
        underlay.style.inset = '';
        underlay.style.zIndex = '';
        underlay.style.overflowY = '';
      } catch (_) {}
      requestAnimationFrame(() => {
        try {
          underlay.scrollTop = savedScroll;
          restoreDiscoverMediaProfileScrollStable(overlay, savedScroll, 2);
        } catch (_) {}
      });
    } else {
      /* No underlay (fallback case — actor profile was opened via a
         path that didn't preserve previous content). Re-render the
         media profile from scratch. */
      overlay.innerHTML = renderDiscoverMediaProfileDetails(previousState.type, previousState.details, previousState.id);
      bindDiscoverMediaProfileActions(overlay);
      hydrateDiscoverHeroTrailerPreview(overlay);
      hydrateDeepSeekMoreLikeThis(previousState.type, previousState.details);
      hydrateDiscoverProviderLogoFallbacks();
      restoreDiscoverMediaProfileScrollStable(overlay, previousState.mediaProfileScrollTop || 0);
      requestAnimationFrame(() => {
        restoreDiscoverMediaProfileScrollStable(overlay, previousState.mediaProfileScrollTop || 0, 2);
      });
    }
    activeDiscoverMediaProfileState = previousState;
  };

  if (!actorSection) {
    finishCleanup();
    return;
  }

  /* Detect if the swipe-back gesture (31-edge-swipe-back.js generic
     fallback) already translated the actor section off-screen. If so,
     skip the second animation and just clean up immediately. */
  const currentTransform = actorSection.style.transform || '';
  const alreadyTranslated = /translate3?d?\(.*[1-9]/.test(currentTransform);
  if (alreadyTranslated) {
    finishCleanup();
    return;
  }

  /* Animate the actor section sliding off to the right. The underlay
     is already visible behind it and at the correct scroll position,
     so the user sees the media profile being revealed. */
  actorSection.style.willChange = 'transform';
  actorSection.style.transition = 'transform 340ms cubic-bezier(0.22, 1, 0.36, 1)';
  requestAnimationFrame(() => {
    try { actorSection.style.transform = 'translate3d(100%, 0, 0)'; } catch (_) {}
  });
  setTimeout(finishCleanup, 360);
}

function renderDiscoverMediaProfileShell(seed, type, id) {
  const title = getDiscoverMediaTitle(seed, type);
  const poster = getDiscoverMediaPoster(seed);
  const backdrop = getDiscoverMediaBackdrop(seed);
  const year = getDiscoverMediaDate(seed, type).slice(0, 4);
  return `<section class="discover-media-page" role="dialog" aria-modal="true" aria-label="${escAttr(title)} details">
    <button class="discover-media-back" type="button" onclick="return handleDiscoverMediaProfileBack(event)">Back</button>
    ${renderMediaProfileTopActions(renderMediaProfileShareButton(getShareableMediaKind(type, seed), id, title, poster), renderDiscoverMediaProfileAddButton(type, id, seed))}
    <div class="discover-media-hero" style="${backdrop ? `background-image:url('${escAttr(backdrop)}')` : ''}">
      <!-- v10.62: hero backdrop now w780 (was w1280) — same visual, ~40% smaller decode. -->
      <div class="discover-media-hero-shade"></div>
      <div class="discover-media-hero-content">
        <div class="discover-media-poster">${poster ? `<img src="${escAttr(poster)}" alt="" decoding="async">` : ''}</div>
        <div class="discover-media-kicker">${type === 'tv' ? 'Series Profile' : 'Movie Profile'}${year ? ` · ${escHtml(year)}` : ''}</div>
        <h2>${escHtml(title)}</h2>
        <p class="discover-media-synopsis" onclick="this.classList.toggle('expanded')">${escHtml(seed?.overview || 'Loading the details for this title...')}</p>
      </div>
    </div>
    <div class="discover-media-body">
      <div class="discover-media-loading discover-media-loading-spinner" role="status" aria-label="Loading title details"><span aria-hidden="true"></span></div>
    </div>
  </section>`;
}

/* v10.115: cast preview shown on the media profile is capped at 18 — any
   overflow is reached via the "Show All" button, which opens a full-page
   cast view (.media-cast-page-overlay) that lists the entire TMDB cast
   from `details.credits.cast` (Jikan-mapped anime details follow the
   same shape). Actor cards in the full-cast page are still the same
   `renderDiscoverCastCard` markup, so tapping an actor opens the
   existing person profile via `handleDiscoverCastCardClick`. */
const animeMediaTrailerCache = new Map();
const ANIME_TRAILER_FETCH_TIMEOUT_MS = 9000;
const ANIME_TRAILER_CHANNEL_KEYWORDS = [
  'official', 'crunchyroll', 'netflix anime', 'aniplex', 'toho animation',
  'kadokawa', 'pony canyon', 'vizmedia', 'viz media', 'anime select',
  'bandai namco', 'avex pictures', 'mappa channel', 'toei animation',
  'tms anime', 'gkids', 'sentai', 'hidive', 'funimation'
];
const ANIME_TRAILER_BAD_TITLE_PATTERN = /\b(reaction|review|explained|analysis|amv|ost|soundtrack|opening|ending|op\b|ed\b|full episode|episode\s+\d+|clip|scene|fight scene|dub clip|sub clip|recap)\b/i;
const ANIME_TRAILER_GOOD_TITLE_PATTERN = /\b(official\s+trailer|main\s+trailer|final\s+trailer|teaser\s+trailer|trailer|official\s+pv|pv\b|promotional\s+video|announcement)\b/i;

function normalizeAnimeTrailerText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getAnimeTrailerTitleCandidates(details = {}) {
  const titles = [
    getDiscoverMediaTitle(details, 'tv'),
    details.title_english,
    details.englishTitle,
    details.title,
    details.name,
    details.original_name,
    details.original_title,
    details.title_japanese,
    details.titleVariants?.english,
    details.titleVariants?.romaji,
    details.titleVariants?.japanese
  ];
  const seen = new Set();
  return titles
    .map(value => String(value || '').trim())
    .filter(value => {
      const key = normalizeAnimeTrailerText(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function animeTrailerTitleMatches(details = {}, videoTitle = '') {
  const video = normalizeAnimeTrailerText(videoTitle);
  if (!video) return false;
  return getAnimeTrailerTitleCandidates(details).some(title => {
    const normalized = normalizeAnimeTrailerText(title);
    if (!normalized) return false;
    if (video.includes(normalized)) return true;
    const tokens = normalized.split(' ').filter(token => token.length > 2);
    if (!tokens.length) return false;
    const matched = tokens.filter(token => video.includes(token)).length;
    return matched >= Math.min(tokens.length, Math.max(2, Math.ceil(tokens.length * 0.6)));
  });
}

function animeTrailerChannelLooksOfficial(channelTitle = '') {
  const channel = normalizeAnimeTrailerText(channelTitle);
  if (!channel) return false;
  return ANIME_TRAILER_CHANNEL_KEYWORDS.some(keyword => channel.includes(normalizeAnimeTrailerText(keyword)));
}

function scoreAnimeTrailerCandidate(details = {}, item = {}) {
  const videoId = String(item.videoId || item.id?.videoId || '').trim();
  const title = String(item.title || '').trim();
  if (!videoId || !title) return -Infinity;
  if (ANIME_TRAILER_BAD_TITLE_PATTERN.test(title)) return -Infinity;
  if (!animeTrailerTitleMatches(details, title)) return -Infinity;
  let score = 0;
  if (ANIME_TRAILER_GOOD_TITLE_PATTERN.test(title)) score += 80;
  if (/\bofficial\b/i.test(title)) score += 24;
  if (/\b(main|final|teaser|pv|promotional|announcement)\b/i.test(title)) score += 12;
  if (animeTrailerChannelLooksOfficial(item.channelTitle || '')) score += 44;
  const year = String(details.first_air_date || details.release_date || details.year || details.malYear || '').slice(0, 4);
  if (year && String(title).includes(year)) score += 8;
  const publishedAt = Date.parse(item.publishedAt || item.published_at || item.snippet?.publishedAt || 0) || 0;
  if (publishedAt) score += Math.min(12, Math.max(0, (publishedAt - Date.UTC(2010, 0, 1)) / (365 * 24 * 60 * 60 * 1000)));
  return score;
}

function getAnimeTrailerSearchQueries(details = {}) {
  const titles = getAnimeTrailerTitleCandidates(details).slice(0, 3);
  const year = String(details.first_air_date || details.release_date || details.year || details.malYear || '').slice(0, 4);
  const queries = [];
  titles.forEach(title => {
    queries.push(`${title}${year ? ` ${year}` : ''} official anime trailer`);
    queries.push(`${title} official PV anime`);
  });
  return [...new Set(queries)].slice(0, 5);
}

async function fetchAnimeYoutubeSearch(query = '') {
  const clean = String(query || '').trim();
  if (!clean) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANIME_TRAILER_FETCH_TIMEOUT_MS);
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

async function attachAnimeMediaProfileTrailer(details = {}, id = '') {
  const isAnimeProfile = typeof isAnimeMediaProfile === 'function'
    ? isAnimeMediaProfile('tv', details)
    : !!(details?.mediaCategory === 'anime' || details?.librarySection === 'anime' || details?.isAnime);
  if (!details || !isAnimeProfile) return details;
  if (getDiscoverMediaTrailer(details.videos)) return details;
  const cacheKey = String(id || details.animeIdentityKey || details.malId || details.mal_id || details.__mal_id || getDiscoverMediaTitle(details, 'tv') || '').toLowerCase();
  if (cacheKey && animeMediaTrailerCache.has(cacheKey)) {
    const cached = animeMediaTrailerCache.get(cacheKey);
    if (!cached) return details;
    return {
      ...details,
      animeTrailer: cached,
      videos: { ...(details.videos || {}), results: [...(details.videos?.results || []), cached] }
    };
  }
  let best = null;
  let bestScore = -Infinity;
  for (const query of getAnimeTrailerSearchQueries(details)) {
    const results = await fetchAnimeYoutubeSearch(query);
    for (const item of results) {
      const score = scoreAnimeTrailerCandidate(details, item);
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
    if (bestScore >= 120) break;
  }
  const trailer = best && bestScore > 0
    ? {
        id: `anime-youtube-${String(best.videoId || best.id?.videoId || '').trim()}`,
        key: String(best.videoId || best.id?.videoId || '').trim(),
        site: 'YouTube',
        type: 'Trailer',
        official: animeTrailerChannelLooksOfficial(best.channelTitle || '') || /\bofficial\b/i.test(best.title || ''),
        name: best.title || `${getDiscoverMediaTitle(details, 'tv')} trailer`,
        published_at: best.publishedAt || best.published_at || best.snippet?.publishedAt || ''
      }
    : null;
  if (cacheKey) animeMediaTrailerCache.set(cacheKey, trailer);
  if (!trailer) return details;
  return {
    ...details,
    animeTrailer: trailer,
    videos: { ...(details.videos || {}), results: [...(details.videos?.results || []), trailer] }
  };
}

const MEDIA_CAST_PREVIEW_LIMIT = 18;
/* v10.117: Characters preview limit for anime profiles. Mirrors the cast
   row's 18-card preview so the layout stays balanced; the full character
   list is reachable via the section's own Show All button. */
const MEDIA_CHARACTERS_PREVIEW_LIMIT = 18;

/* v10.117: Character card for anime media profiles. Reuses the
   .discover-media-cast-card class so it inherits the responsive sizing
   from the existing cast row, with a .is-character modifier for the
   visual tweaks (no heart, no person-profile navigation — characters
   don't have profile pages in-app). */
function renderAnimeCharacterCard(character = {}) {
  const name = String(character?.name || '');
  const role = String(character?.role || '').trim();
  const image = String(character?.image || character?.profile_path || '');
  return `<div class="discover-media-cast-card discover-media-character-card" data-character-id="${escAttr(String(character?.id || ''))}">
    <div class="discover-media-cast-photo">${image ? `<img src="${escAttr(image)}" alt="" loading="lazy" decoding="async">` : ''}</div>
    <strong>${escHtml(name)}</strong>
    <span>${escHtml(role)}</span>
  </div>`;
}

/* v730: Cast card with a heart-favorite button anchored to the bottom-right
   of the photo. The inline onclick early-returns when the click came from a
   heart so we DON'T navigate to the person profile on a heart tap.
   22-favorite-people.js handles the actual toggle via delegated listener. */
function handleDiscoverCastCardClick(event, personId) {
  if (event?.target?.closest?.('.cast-fav-btn')) return;
  openDiscoverPersonProfile(event, personId);
}
function renderDiscoverCastCard(person) {
  const id = person?.id;
  const name = String(person?.name || '');
  const character = String(person?.character || '');
  const profilePath = String(person?.profile_path || '');
  const photo = profilePath ? getTmdbImageUrl(profilePath, 'w342') : '';
  const isFav = typeof window.shelfdIsFavoritePerson === 'function'
    ? window.shelfdIsFavoritePerson(id)
    : false;
  const heartHtml = `<span class="cast-fav-btn${isFav ? ' is-favorite' : ''}"
      aria-label="Favorite ${escAttr(name)}"
      aria-pressed="${isFav ? 'true' : 'false'}"
      data-person-id="${escAttr(id)}"
      data-person-name="${escAttr(name)}"
      data-person-photo="${escAttr(profilePath)}"
      data-person-role="actor">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21s-7.5-4.6-9.6-9.4C1.1 8 3.4 4.5 6.8 4.5c2.1 0 3.9 1.2 5.2 3 1.3-1.8 3.1-3 5.2-3 3.4 0 5.7 3.5 4.4 7.1C19.5 16.4 12 21 12 21z"/>
      </svg>
    </span>`;
  /* v10.62: lazy + decoding on cast photos — cast list typically has 8–20 cards
     per media profile and most are off-screen until you scroll the section. */
  return `<button class="discover-media-cast-card" type="button" data-person-id="${escAttr(String(id || ''))}" onclick="handleDiscoverCastCardClick(event, ${id})">
    <div class="discover-media-cast-photo">${photo ? `<img src="${escAttr(photo)}" alt="" loading="lazy" decoding="async">` : ''}${heartHtml}</div>
    <strong>${escHtml(name)}</strong>
    <span>${escHtml(character)}</span>
  </button>`;
}
window.handleDiscoverCastCardClick = handleDiscoverCastCardClick;

const universalMediaReviewsTargets = new Map();
const UNIVERSAL_MEDIA_REVIEWS_MIN_COUNT = 15;

function normalizeUniversalReviewKind(value = '') {
  const key = String(value || '').toLowerCase();
  if (key === 'movie' || key === 'movies') return 'movies';
  if (key === 'tv' || key === 'show' || key === 'shows' || key === 'series') return 'shows';
  if (key === 'anime') return 'anime';
  if (key === 'game' || key === 'games') return 'games';
  return key;
}

function normalizeUniversalReviewText(value = '') {
  return String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
}

function getUniversalMediaReviewTarget(type = '', details = {}, id = '') {
  const isGame = type === 'game';
  const isAnime = !!(details?.__jikan || details?.__mal_id || details?.mal_id || details?.malId);
  const kind = isGame ? 'games' : (isAnime ? 'anime' : (type === 'movie' ? 'movies' : 'shows'));
  const title = isGame
    ? (typeof getGameTitleValue === 'function' ? getGameTitleValue(details) : (details?.name || details?.title || ''))
    : getDiscoverMediaTitle(details, type);
  const poster = isGame
    ? (typeof getGameMediaImage === 'function' ? getGameMediaImage(details) : (details?.cover || details?.poster || details?.background_image || ''))
    : getDiscoverMediaPoster(details);
  const year = String(isGame ? (details?.released || details?.year || '') : getDiscoverMediaDate(details, type)).slice(0, 4);
  const tmdbId = !isGame
    ? (isAnime ? String(details?.tmdbId || details?.tmdb_id || details?.__tmdb_id || '').trim() : String(details?.id || id || details?.tmdbId || '').trim())
    : '';
  const malId = isAnime ? String(details?.__mal_id || details?.mal_id || details?.malId || details?.id || id || '').trim() : '';
  const rawgId = isGame ? String((typeof getGameRawgIdValue === 'function' ? getGameRawgIdValue(details) : '') || details?.rawgId || id || '').trim() : '';
  const imdbId = !isGame && !isAnime ? String(details?.external_ids?.imdb_id || details?.imdb_id || details?.imdbId || '').trim() : '';
  const originalLanguage = !isGame ? String(details?.original_language || details?.originalLanguage || '').trim() : '';
  const targetItem = {
    id: String(id || details?.id || ''),
    title,
    year,
    cover: poster,
    mediaCategory: kind,
    librarySection: kind,
    tmdbId,
    malId,
    rawgId,
    imdbId
  };
  let mediaKey = '';
  try {
    if (typeof getMediaKey === 'function') mediaKey = getMediaKey(targetItem) || '';
  } catch (_) {}
  const primaryReviewId = isAnime ? (malId || tmdbId) : (tmdbId || malId);
  const key = [kind, primaryReviewId || rawgId || mediaKey || normalizeUniversalReviewText(title)].filter(Boolean).join(':');
  return { key, type, kind, title, poster, year, tmdbId, malId, rawgId, imdbId, originalLanguage, mediaKey };
}

function renderUniversalMediaReviewsButton(type = '', details = {}, id = '') {
  const target = getUniversalMediaReviewTarget(type, details, id);
  if (!target.title && !target.tmdbId && !target.malId && !target.rawgId) return '';
  universalMediaReviewsTargets.set(target.key, target);
  return `<div class="discover-media-section discover-media-section-user-reviews">
    <button class="media-profile-user-reviews-button" type="button" data-universal-review-key="${escAttr(target.key)}" onclick="openUniversalMediaReviewsPage(event, this)">
      <span>Reviews</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
    </button>
  </div>`;
}
window.renderUniversalMediaReviewsButton = renderUniversalMediaReviewsButton;

function getUniversalReviewPostText(post = {}) {
  return String(post.reviewText || post.content?.text || post.content?.body || post.text || '').trim();
}

function getUniversalReviewPostDate(post = {}) {
  const t = getUniversalReviewPostTime(post);
  if (!t) return '';
  try {
    const date = new Date(t);
    if (Number.isFinite(date.getTime())) {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    }
  } catch (_) {}
  return '';
}

function getUniversalReviewPostTime(post = {}) {
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

function getUniversalReviewCachedUser(uid = '') {
  const cleanUid = String(uid || '').trim();
  if (!cleanUid) return {};
  let profile = {};
  try {
    if (typeof window !== 'undefined' && window.usersMap && window.usersMap[cleanUid]) {
      profile = { ...profile, ...window.usersMap[cleanUid] };
    }
  } catch (_) {}
  try {
    if (typeof usersMap === 'object' && usersMap && usersMap[cleanUid]) {
      profile = { ...profile, ...usersMap[cleanUid] };
    }
  } catch (_) {}
  return profile;
}

function cacheUniversalReviewUser(uid = '', profile = {}) {
  const cleanUid = String(uid || '').trim();
  if (!cleanUid || !profile || typeof profile !== 'object') return;
  const next = { ...profile, uid: profile.uid || cleanUid };
  try {
    if (typeof usersMap === 'object' && usersMap) {
      usersMap[cleanUid] = { ...(usersMap[cleanUid] || {}), ...next };
    }
  } catch (_) {}
  try {
    if (typeof window !== 'undefined') {
      if (!window.usersMap) window.usersMap = {};
      window.usersMap[cleanUid] = { ...(window.usersMap[cleanUid] || {}), ...next };
    }
  } catch (_) {}
}

function hasUniversalReviewUserIdentity(profile = {}) {
  return !!(
    profile.name ||
    profile.customName ||
    profile.displayName ||
    profile.usernameHandle ||
    profile.userHandle ||
    profile.username ||
    profile.handle ||
    profile.photo ||
    profile.customPhoto ||
    profile.photoURL
  );
}

async function hydrateUniversalReviewAuthors(posts = []) {
  if (typeof db === 'undefined' || !db?.collection) return;
  const uids = [...new Set((Array.isArray(posts) ? posts : [])
    .map(post => String(post?.uid || post?.userId || post?.authorUid || '').trim())
    .filter(Boolean)
  )];
  const missing = uids.filter(uid => !hasUniversalReviewUserIdentity(getUniversalReviewCachedUser(uid))).slice(0, 32);
  if (!missing.length) return;
  await Promise.all(missing.map(async uid => {
    try {
      const snap = await db.collection('users').doc(uid).get();
      if (!snap?.exists) return;
      cacheUniversalReviewUser(uid, snap.data() || {});
    } catch (_) {}
  }));
}

function getUniversalReviewAuthor(post = {}) {
  const uid = String(post.uid || post.userId || post.authorUid || '');
  const map = uid ? getUniversalReviewCachedUser(uid) : {};
  /* v11.460: your OWN review wasn't in usersMap, so it fell back to "Shelfd User"
     with no photo. Pull from the signed-in profile for own posts, and show the
     real @username (handle) like the rest of the app. */
  const isMe = !!(typeof currentUser !== 'undefined' && currentUser && uid && uid === currentUser.uid);
  const own = isMe ? ((typeof userProfile !== 'undefined' && userProfile) ? userProfile : {}) : {};
  const postProfile = {
    name: post.name || post.authorName || '',
    customName: post.customName || '',
    displayName: post.displayName || '',
    usernameHandle: post.usernameHandle || post.userHandle || post.username || post.handle || '',
    userHandle: post.userHandle || post.usernameHandle || post.username || post.handle || '',
    username: post.username || post.usernameHandle || post.userHandle || post.handle || '',
    photo: post.photo || post.authorPhoto || post.photoURL || '',
    customPhoto: post.customPhoto || '',
    photoURL: post.photoURL || ''
  };
  const src = { ...postProfile, ...map, ...own };
  let handle = (typeof getShelfdUsernameHandle === 'function') ? (getShelfdUsernameHandle(src) || '') : '';
  if (!handle && typeof getProfileSocialUserHandle === 'function') handle = getProfileSocialUserHandle(src) || '';
  if (!handle) handle = src.usernameHandle || src.userHandle || src.username || src.handle || '';
  handle = String(handle || '').replace(/^@+/, '').trim();
  const display = src.name || src.customName || src.displayName || post.name || post.displayName || post.authorName || '';
  const name = handle ? ('@' + handle) : (display || 'Shelfd User');
  const photo = src.photo || src.customPhoto || src.photoURL || post.photo || post.authorPhoto || post.photoURL
    || (isMe && typeof currentUser !== 'undefined' && currentUser ? (currentUser.photoURL || '') : '') || '';
  return { name, photo };
}

function universalReviewPostMatchesTarget(post = {}, target = {}) {
  if (!post || !target) return false;
  if (post.type !== 'media-review' && post.eventType !== 'review') return false;
  if (!getUniversalReviewPostText(post)) return false;
  const item = post.item || {};
  const targetKind = normalizeUniversalReviewKind(target.kind);
  const itemKind = normalizeUniversalReviewKind(item.librarySection || item.mediaCategory || post.mediaCategory || post.section || '');
  if (targetKind && itemKind && targetKind !== itemKind) return false;
  if (target.mediaKey && String(post.mediaKey || '') === String(target.mediaKey)) return true;
  if (target.tmdbId && String(item.tmdbId || item.tmdb_id || '') === String(target.tmdbId)) return true;
  if (target.malId && String(item.malId || item.mal_id || item.__mal_id || '') === String(target.malId)) return true;
  if (target.rawgId && String(item.rawgId || item.rawg_id || item.id || '') === String(target.rawgId)) return true;
  const targetTitle = normalizeUniversalReviewText(target.title);
  const itemTitle = normalizeUniversalReviewText(item.title || post.title || '');
  if (!targetTitle || !itemTitle || targetTitle !== itemTitle) return false;
  const targetYear = String(target.year || '').slice(0, 4);
  const itemYear = String(item.year || item.releaseYear || post.year || '').slice(0, 4);
  return !targetYear || !itemYear || targetYear === itemYear;
}

async function fetchUniversalMediaReviewPosts(target = {}) {
  const localPosts = Array.isArray(window.feedPosts) ? window.feedPosts : [];
  let posts = localPosts.filter(post => universalReviewPostMatchesTarget(post, target));
  if (typeof db !== 'undefined' && db?.collection) {
    try {
      const snap = await db.collection('feed').orderBy('timestamp', 'desc').limit(220).get();
      snap.forEach(doc => {
        const data = doc.data() || {};
        posts.push({ postId: data.postId || doc.id, ...data });
      });
    } catch (error) {
      console.warn('Universal media reviews fetch failed:', error);
    }
  }
  return dedupeUniversalMediaReviewPosts(posts.filter(post => universalReviewPostMatchesTarget(post, target)), target);
}

function getUniversalReviewPostId(post = {}) {
  return String(post.postId || post.id || post.reviewActivityId || '').trim();
}

function getUniversalReviewPostMediaIdentity(post = {}, target = {}) {
  const item = post.item || {};
  return String(
    post.mediaKey ||
    item.mediaKey ||
    item.tmdbId ||
    item.tmdb_id ||
    item.malId ||
    item.mal_id ||
    item.__mal_id ||
    item.rawgId ||
    item.rawg_id ||
    target.key ||
    normalizeUniversalReviewText(item.title || post.title || target.title || '')
  ).trim().toLowerCase();
}

function dedupeUniversalMediaReviewPosts(posts = [], target = {}) {
  const byPostId = new Map();
  posts.forEach((post, index) => {
    const id = getUniversalReviewPostId(post) || `${post.uid || ''}:${getUniversalReviewPostText(post)}:${index}`;
    const existing = byPostId.get(id);
    if (!existing || getUniversalReviewPostTime(post) >= getUniversalReviewPostTime(existing)) {
      byPostId.set(id, post);
    }
  });
  const ordered = [...byPostId.values()].sort((a, b) => getUniversalReviewPostTime(b) - getUniversalReviewPostTime(a));
  const byReviewerAndMedia = new Map();
  ordered.forEach(post => {
    const uid = String(post.uid || post.userId || post.authorUid || '').trim();
    const mediaIdentity = getUniversalReviewPostMediaIdentity(post, target) || String(target.key || '').trim().toLowerCase();
    const id = getUniversalReviewPostId(post);
    const key = uid && mediaIdentity ? `${uid}|${mediaIdentity}` : `post:${id || getUniversalReviewPostText(post)}`;
    if (!byReviewerAndMedia.has(key)) byReviewerAndMedia.set(key, post);
  });
  return [...byReviewerAndMedia.values()].sort((a, b) => getUniversalReviewPostTime(b) - getUniversalReviewPostTime(a));
}

function renderUniversalMediaReviewRow(post = {}, target = {}) {
  const author = getUniversalReviewAuthor(post);
  const text = getUniversalReviewPostText(post);
  const date = getUniversalReviewPostDate(post);
  const item = post.item || {};
  const rating = Number(item.rating || post.rating || 0);
  const section = item.librarySection || item.mediaCategory || target.kind || '';
  /* v11.460: just the number (no "/5") so it matches the external-source review
     rows — ★ + value, champagne gold. */
  const ratingText = rating > 0 && typeof formatRatingValueForSection === 'function'
    ? formatRatingValueForSection(rating, section, false)
    : (rating > 0 ? String(rating) : '');
  const postId = String(post.postId || post.id || post.reviewActivityId || '').trim();
  const openAttr = postId ? ` onclick="openUniversalMediaReviewPost(event,'${escAttr(postId)}','${escAttr(section)}')"` : '';
  return `<article class="universal-media-review-row"${openAttr}>
    <div class="universal-media-review-avatar"><img src="${escAttr(author.photo || '/default-avatar.svg')}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='/default-avatar.svg'"></div>
    <div class="universal-media-review-copy">
      <div class="universal-media-review-meta">
        <strong>${escHtml(author.name)}</strong>
        ${date ? `<span>${escHtml(date)}</span>` : ''}
        ${ratingText ? `<em><span aria-hidden="true">★</span>${escHtml(ratingText)}</em>` : ''}
      </div>
      <p>${escHtml(text)}</p>
    </div>
  </article>`;
}

/* =============================================================================
   v11.443 — External anime reviews from MyAnimeList (via the Jikan data layer)
   shown inside the same "User Reviews" page. MAL scores are out of 10, so they're
   divided by 2 for Shelfd's 5-star scale. Spoiler-flagged reviews are filtered out
   so the page never spoils the anime; each row links to the full review on MAL.
   Fetched on demand (only when the user opens User Reviews for an anime title).
   ========================================================================== */
function formatMalScoreOutOfFive(score10) {
  const v = Number(score10) || 0;
  if (v <= 0) return '';
  const five = Math.round((v / 2) * 10) / 10;       // /10 → /5, one decimal
  const s = five.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;     // 5.0 → "5", 4.5 → "4.5"
}
function formatJikanReviewDate(value = '') {
  try {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    }
  } catch (_) {}
  return '';
}
async function fetchJikanAnimeReviews(malId, limit = 30) {
  const id = String(malId || '').trim();
  if (!id || !window.JikanAnime || typeof window.JikanAnime.request !== 'function') return [];
  /* v11.527: pull deeper than the old 3-page cap so the spoiler filter does
     not leave the Reviews page with only a couple of rows. */
  const all = [];
  for (let page = 1; page <= 10; page++) {
    try {
      const json = await window.JikanAnime.request(`anime/${encodeURIComponent(id)}/reviews`, { page, preliminary: true });
      const list = Array.isArray(json?.data) ? json.data : [];
      all.push(...list);
      const usable = all.filter(r => r && !r.is_spoiler && String(r.review || '').trim()).length;
      if (usable >= limit) break;
      if (!json?.pagination?.has_next_page) break;
    } catch (e) {
      console.warn('Jikan anime reviews fetch failed (page ' + page + '):', e);
      break;
    }
  }
  const seen = new Set();
  return all
    .filter(r => r && !r.is_spoiler && String(r.review || '').trim())
    .filter(r => { const k = String(r.mal_id || r.url || ''); if (!k || seen.has(k)) return !k; seen.add(k); return true; })
    .sort((a, b) => (Number(b?.reactions?.overall) || 0) - (Number(a?.reactions?.overall) || 0))
    .slice(0, limit);
}
/* v11.450: one shared external-review row (MAL/Jikan, TMDB, …). The full text is
   rendered; CSS clamps it to 9 lines and the inline "Read full review" button
   expands it in place (never leaves the app). */
function renderExternalReviewRow(name, photo, rawText, ratingText, date) {
  const nm = (String(name || '').trim()) || 'User';
  const text = String(rawText || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return `<article class="universal-media-review-row universal-media-review-row-external">
    <div class="universal-media-review-avatar"><img src="${escAttr(photo || '/default-avatar.svg')}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='/default-avatar.svg'"></div>
    <div class="universal-media-review-copy">
      <div class="universal-media-review-meta">
        <strong>${escHtml(nm)}</strong>
        ${date ? `<span>${escHtml(date)}</span>` : ''}
        ${ratingText ? `<em><span aria-hidden="true">★</span>${escHtml(ratingText)}</em>` : ''}
      </div>
      <p>${escHtml(text)}</p>
      <button class="universal-media-review-expand" type="button" onclick="toggleJikanReviewExpand(event)">Read full review</button>
    </div>
  </article>`;
}
function renderJikanAnimeReviewRow(review = {}) {
  const user = review.user || {};
  const name = user.username || 'MAL User';
  const photo = user?.images?.jpg?.image_url || user?.images?.webp?.image_url || '';
  return renderExternalReviewRow(name, photo, review.review, formatMalScoreOutOfFive(review.score), formatJikanReviewDate(review.date));
}
/* TMDB avatar paths can be a TMDB image path (/abc.jpg) OR a full URL prefixed
   with a stray leading slash (/https://gravatar…). Normalise both forms. */
function tmdbReviewAvatarUrl(path) {
  const p = String(path || '').trim();
  if (!p) return '';
  if (/^\/https?:\/\//i.test(p)) return p.slice(1);
  if (/^https?:\/\//i.test(p)) return p;
  return `https://image.tmdb.org/t/p/w185${p}`;
}
function renderTmdbReviewRow(review = {}) {
  const ad = review.author_details || {};
  const name = ad.username || review.author || ad.name || 'TMDB User';
  const ratingText = Number(ad.rating) > 0 ? formatMalScoreOutOfFive(ad.rating) : '';  // TMDB /10 → /5
  return renderExternalReviewRow(name, tmdbReviewAvatarUrl(ad.avatar_path), review.content, ratingText, formatJikanReviewDate(review.created_at));
}
function renderImdbReviewRow(review = {}) {
  const rating = Number(review.rating || 0);
  const ratingText = rating > 0 ? formatMalScoreOutOfFive(rating) : '';
  const title = String(review.title || '').trim();
  const text = [title, review.text || review.review || review.content || ''].filter(Boolean).join('\n\n');
  return renderExternalReviewRow(review.author || 'IMDb User', '', text, ratingText, formatJikanReviewDate(review.date));
}
async function fetchImdbMediaReviews(target = {}, limit = UNIVERSAL_MEDIA_REVIEWS_MIN_COUNT) {
  const kind = normalizeUniversalReviewKind(target.kind);
  if (kind !== 'movies' && kind !== 'shows') return [];
  if (!target.tmdbId && !target.imdbId && !target.title) return [];
  const params = new URLSearchParams();
  params.set('type', kind === 'movies' ? 'movie' : 'tv');
  params.set('limit', String(Math.max(1, Math.min(30, Number(limit) || UNIVERSAL_MEDIA_REVIEWS_MIN_COUNT))));
  if (target.tmdbId) params.set('tmdbId', String(target.tmdbId));
  if (target.imdbId) params.set('imdbId', String(target.imdbId));
  if (target.title) params.set('title', String(target.title));
  if (target.year) params.set('year', String(target.year));
  try {
    const res = await fetch(`/api/imdb/reviews?${params.toString()}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(json?.reviews)) return [];
    return json.reviews;
  } catch (e) {
    console.warn('IMDb reviews fetch failed:', e);
    return [];
  }
}
async function fetchTmdbMediaReviews(tmdbId, kind, limit = 30, options = {}) {
  const id = String(tmdbId || '').trim();
  if (!id || typeof fetchTmdbProxy !== 'function') return [];
  const path = (kind === 'movies' || kind === 'movie') ? 'movie' : 'tv';
  const all = [];
  const originalLanguage = String(options.originalLanguage || options.language || '').trim().toLowerCase();
  const languages = Array.from(new Set([
    originalLanguage && originalLanguage !== 'en' ? originalLanguage : '',
    '',
    'en-US'
  ].filter(value => value || value === '')));
  for (const language of languages) {
    for (let page = 1; page <= 10; page++) {
      try {
        const params = { page };
        if (language) params.language = language;
        const res = await fetchTmdbProxy(`${path}/${encodeURIComponent(id)}/reviews`, params);
        const json = await res.json();
        const list = Array.isArray(json?.results) ? json.results : [];
        all.push(...list);
        const usable = all.filter(r => String(r?.content || '').trim()).length;
        if (usable >= limit) break;
        if (page >= (Number(json?.total_pages) || 1)) break;
      } catch (e) {
        console.warn('TMDB reviews fetch failed (page ' + page + '):', e);
        break;
      }
    }
    if (all.filter(r => String(r?.content || '').trim()).length >= limit) break;
  }
  const seen = new Set();
  return all.filter(r => {
    if (!String(r?.content || '').trim()) return false;
    const k = String(r?.id || '');
    if (k && seen.has(k)) return false;
    if (k) seen.add(k);
    return true;
  }).slice(0, limit);
}
/* v11.527: shared external review fill helpers for IMDb, Jikan, and TMDB. */
function getExternalReviewText(review = {}) {
  return String(review.text || review.review || review.content || review.body || '').trim();
}

function getExternalReviewAuthor(review = {}) {
  return String(
    review.author ||
    review.username ||
    review.user?.username ||
    review.author_details?.username ||
    review.author_details?.name ||
    ''
  ).trim();
}

function getExternalReviewSignature(review = {}, source = '') {
  const textKey = normalizeUniversalReviewText(getExternalReviewText(review)).slice(0, 220);
  if (textKey.length >= 20) return `text:${textKey}`;
  const id = String(review.id || review.mal_id || review.url || '').trim();
  const authorKey = normalizeUniversalReviewText(getExternalReviewAuthor(review)).slice(0, 60);
  return `${source}:${id || authorKey || Math.random().toString(36).slice(2)}`;
}

function appendExternalReviewRows(rows, seen, reviews, renderer, source, maxRows) {
  if (!Array.isArray(reviews) || typeof renderer !== 'function') return;
  for (const review of reviews) {
    if (rows.length >= maxRows) break;
    if (!getExternalReviewText(review)) continue;
    const key = getExternalReviewSignature(review, source);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(renderer(review));
  }
}

async function fetchUniversalExternalReviewRows(target = {}, existingCount = 0) {
  const needed = Math.max(UNIVERSAL_MEDIA_REVIEWS_MIN_COUNT - (Number(existingCount) || 0), 0);
  if (!needed) return { html: '', count: 0 };
  const kind = normalizeUniversalReviewKind(target.kind);
  const primaryLimit = Math.max(UNIVERSAL_MEDIA_REVIEWS_MIN_COUNT, needed);
  const rows = [];
  const seen = new Set();

  if (kind === 'anime') {
    if (target.malId) {
      appendExternalReviewRows(rows, seen, await fetchJikanAnimeReviews(target.malId, primaryLimit), renderJikanAnimeReviewRow, 'jikan', needed);
    }
    if (rows.length < needed && target.tmdbId) {
      const tmdbFallbackKind = normalizeUniversalReviewKind(target.type) === 'movies' ? 'movies' : 'shows';
      appendExternalReviewRows(rows, seen, await fetchTmdbMediaReviews(target.tmdbId, tmdbFallbackKind, Math.max(needed - rows.length, UNIVERSAL_MEDIA_REVIEWS_MIN_COUNT), { originalLanguage: target.originalLanguage }), renderTmdbReviewRow, 'tmdb', needed);
    }
  } else if (kind === 'movies' || kind === 'shows') {
    appendExternalReviewRows(rows, seen, await fetchImdbMediaReviews(target, primaryLimit), renderImdbReviewRow, 'imdb', needed);
    if (rows.length < needed && target.tmdbId) {
      appendExternalReviewRows(rows, seen, await fetchTmdbMediaReviews(target.tmdbId, kind, Math.max(needed - rows.length, UNIVERSAL_MEDIA_REVIEWS_MIN_COUNT), { originalLanguage: target.originalLanguage }), renderTmdbReviewRow, 'tmdb', needed);
    }
  }

  return { html: rows.join(''), count: rows.length };
}

function toggleJikanReviewExpand(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const btn = event?.currentTarget;
  const row = btn?.closest?.('.universal-media-review-row-external');
  if (!row) return;
  const expanded = row.classList.toggle('expanded');
  btn.textContent = expanded ? 'Show less' : 'Read full review';
}
window.toggleJikanReviewExpand = toggleJikanReviewExpand;
/* Only reveal the expander when the 9-line clamp actually hides content. */
function setupJikanReviewExpandToggles(listEl) {
  if (!listEl) return;
  listEl.querySelectorAll('.universal-media-review-row-external').forEach(row => {
    const p = row.querySelector('.universal-media-review-copy p');
    if (p && (p.scrollHeight - p.clientHeight) > 4) row.classList.add('has-overflow');
  });
}

function renderUniversalMediaReviewsShell(target = {}) {
  const poster = target.poster || '';
  return `<section class="universal-media-reviews-page" role="dialog" aria-modal="true" aria-label="${escAttr(target.title || 'Reviews')}">
    <header class="universal-media-reviews-topbar">
      <button class="universal-media-reviews-back" type="button" onclick="closeUniversalMediaReviewsPage()" aria-label="Back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
      <span>Reviews</span>
      <button class="universal-media-reviews-close" type="button" onclick="closeUniversalMediaReviewsPage()" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    </header>
    <main class="universal-media-reviews-content">
      <section class="universal-media-reviews-hero">
        ${poster ? `<img src="${escAttr(poster)}" alt="" loading="lazy" decoding="async">` : ''}
        <div>
          <h2>${escHtml(target.title || 'Reviews')}</h2>
          ${target.year ? `<span>${escHtml(target.year)}</span>` : ''}
        </div>
      </section>
      <section class="universal-media-reviews-list" data-universal-review-list>
        <div class="universal-media-review-empty">Loading reviews...</div>
      </section>
    </main>
  </section>`;
}

async function openUniversalMediaReviewsPage(event, trigger) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const key = String(trigger?.dataset?.universalReviewKey || '').trim();
  const target = universalMediaReviewsTargets.get(key);
  if (!target) return;
  closeUniversalMediaReviewsPage(true);
  const overlay = document.createElement('div');
  overlay.id = 'universal-media-reviews-overlay';
  overlay.className = 'universal-media-reviews-overlay';
  overlay.innerHTML = renderUniversalMediaReviewsShell(target);
  document.body.appendChild(overlay);
  document.body.classList.add('universal-media-reviews-open');
  requestAnimationFrame(() => overlay.classList.add('open'));
  const list = overlay.querySelector('[data-universal-review-list]');
  /* v11.526: fill to at least 15 total reviews when source data is available.
     Shelfd reviews load first so external providers only fetch the gap;
     anime uses Jikan first; movies/shows use IMDb first; TMDB fills gaps. */
  const posts = await fetchUniversalMediaReviewPosts(target);
  await hydrateUniversalReviewAuthors(posts);
  const externalRows = await fetchUniversalExternalReviewRows(target, posts.length);
  if (!document.body.contains(overlay) || !list) return;
  const shelfdHtml = posts.map(post => renderUniversalMediaReviewRow(post, target)).join('');
  list.innerHTML = (shelfdHtml + externalRows.html) || '<div class="universal-media-review-empty">No user reviews yet.</div>';
  if (externalRows.count) requestAnimationFrame(() => setupJikanReviewExpandToggles(list));
}

function openUniversalMediaReviewPost(event, postId = '', section = '') {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if (postId && typeof openFullPageMediaReview === 'function') {
    openFullPageMediaReview(postId, section || activeSection);
  }
}

function closeUniversalMediaReviewsPage(immediate = false) {
  const overlay = document.getElementById('universal-media-reviews-overlay');
  if (!overlay) return;
  const finish = () => {
    overlay.remove();
    document.body.classList.remove('universal-media-reviews-open');
  };
  if (immediate) {
    finish();
    return;
  }
  overlay.classList.remove('open');
  setTimeout(finish, 280);
}

window.openUniversalMediaReviewsPage = openUniversalMediaReviewsPage;
window.closeUniversalMediaReviewsPage = closeUniversalMediaReviewsPage;
window.openUniversalMediaReviewPost = openUniversalMediaReviewPost;

function renderDiscoverMediaProfileDetails(type, details, id) {
  const title = getDiscoverMediaTitle(details, type);
  const poster = getDiscoverMediaPoster(details);
  const backdrop = getDiscoverMediaBackdrop(details);
  const year = getDiscoverMediaDate(details, type).slice(0, 4);
  const genres = getDiscoverGenreNames(details, type).slice(0, 4);
  const facts = getDiscoverMediaFacts(type, details);
  const showHeroRating = isDiscoverMediaReleased(details, type);
  const score = showHeroRating && typeof window.formatDisplayTitleRating === 'function'
    ? window.formatDisplayTitleRating(details)
    : (showHeroRating && Number(details.imdbRating || 0) > 0 ? (Number(details.imdbRating) / 2).toFixed(1) : '');
  const tagline = String(details.tagline || '').trim();
  const overview = details.overview || 'No overview is available yet.';
  /* v10.115: cast preview = first 18 actors. Full cast lives on a
     dedicated full-page view opened via the "Show All" button (only
     rendered when there's more cast beyond the 18 in the preview). */
  const castAll = (details.credits?.cast || []).filter(person => person?.name);
  const cast = castAll.slice(0, MEDIA_CAST_PREVIEW_LIMIT);
  const castHasMore = castAll.length > cast.length;
  /* v10.117: Characters row — anime-only (only Jikan-mapped profiles
     populate details.credits.characters). Same 18-preview + Show All
     pattern as the Cast row above. Falls through silently for non-anime
     profiles where credits.characters is absent. */
  const charactersAll = (details.credits?.characters || []).filter(ch => ch?.name);
  const charactersPreview = charactersAll.slice(0, MEDIA_CHARACTERS_PREVIEW_LIMIT);
  const charactersHasMore = charactersAll.length > charactersPreview.length;
  const creators = type === 'tv'
    ? (details.created_by || []).map(person => person.name).filter(Boolean).slice(0, 3)
    : getDiscoverMediaCrew(details.credits, ['Director']);
  const writers = type === 'movie' ? getDiscoverMediaCrew(details.credits, ['Writer', 'Screenplay', 'Story']) : [];
  const trailer = getDiscoverMediaTrailer(details.videos);
  const companies = (details.production_companies || []).map(company => company.name).filter(Boolean).slice(0, 2);
  const networks = (details.networks || []).map(network => network.name).filter(Boolean).slice(0, 2);
  const isDesktopTitleProfile = type === 'movie' || type === 'tv';
  /* v11.452: tag the anime profile root so its section-header typography can be
     scoped to anime only (movies/TV/games keep their existing headers). */
  const isAnimeProfile = typeof isAnimeMediaProfile === 'function'
    ? isAnimeMediaProfile(type, details)
    : !!(details?.__jikan || details?.__mal_id || details?.mal_id || details?.malId || details?.isAnime || details?.mediaCategory === 'anime');

  /* v10.525: remove the top-right "Trailer" CTA. The hero trailer
     preview remains tappable/expandable; only the extra top action
     button is gone. */
  return `<section class="discover-media-page${isAnimeProfile ? ' discover-media-page-anime' : ''}${isDesktopTitleProfile ? ` discover-standard-title-page discover-desktop-title-page discover-standard-title-page-${type}` : ''}" role="dialog" aria-modal="true" aria-label="${escAttr(title)} details">
    <button class="discover-media-back" type="button" onclick="return handleDiscoverMediaProfileBack(event)">Back</button>
    ${renderMediaProfileTopActions(renderMediaProfileShareButton(getShareableMediaKind(type, details), id, title, poster), renderDiscoverMediaProfileAddButton(type, id, details), '', renderDiscoverHeroTrailerSoundToggle(trailer))}
    <div class="discover-media-hero${trailer ? ' has-trailer-preview' : ''}" style="${backdrop ? `background-image:url('${escAttr(backdrop)}')` : ''}">
      ${renderDiscoverHeroTrailerPreview(trailer, title)}
      <div class="discover-media-hero-shade"></div>
      <div class="discover-media-hero-content">
        <div class="discover-media-hero-top">
          <div class="discover-media-poster">${poster ? `<img src="${escAttr(poster)}" alt="" decoding="async">` : ''}</div>
          <div class="discover-media-hero-main">
            <div class="discover-media-kicker">${type === 'tv' ? 'Series Profile' : 'Movie Profile'}${year ? ` · ${escHtml(year)}` : ''}</div>
            <h2>${escHtml(title)}</h2>
            ${tagline ? `<div class="discover-media-tagline">${escHtml(tagline)}</div>` : ''}
            ${score ? `<div class="discover-media-score discover-media-score-hero"><span class="discover-media-score-star" aria-hidden="true">★</span><span class="discover-media-score-value">${escHtml(score)}</span></div>` : ''}
          </div>
        </div>
        <p class="discover-media-synopsis" onclick="this.classList.toggle('expanded')">${escHtml(overview)}</p>
        ${genres.length ? `<div class="discover-media-chips">${genres.map(name => `<span>${escHtml(name)}</span>`).join('')}</div>` : ''}
        ${renderMediaProfileFloatingExports(type, details)}
        ${renderDiscoverWhereToWatchInline(details)}
      </div>
    </div>
    <div class="discover-media-body${isDesktopTitleProfile ? ' discover-media-body-cinema' : ''}">
      ${/* v11.016: Episode & Season Details entry moved to the FIRST
            position in the body so it sits right under the hero's
            "Where to Watch" row (which ends the hero copy). Previously
            it sat after the facts grid + before cast. */ ''}
      ${type === 'tv' ? renderDiscoverMediaSeasonsEntry(details, id) : ''}
      ${(facts.length || creators.length || writers.length || companies.length || networks.length) ? `<div class="discover-media-detail-grid">
        ${(facts.length || creators.length || writers.length || companies.length || networks.length) ? `<div class="discover-media-detail-stack">
          ${facts.length ? `<div class="discover-media-facts">${facts.map(fact => `<div class="${getDiscoverMediaFactClass(fact)}"><strong>${escHtml(fact.value)}</strong><span>${escHtml(fact.label)}</span></div>`).join('')}</div>` : ''}
          ${(creators.length || writers.length || companies.length || networks.length) ? `<div class="discover-media-credits">
            ${creators.length ? `<div><span>${type === 'tv' ? 'Created By' : 'Directed By'}</span><strong>${escHtml(creators.join(', '))}</strong></div>` : ''}
            ${writers.length ? `<div><span>Written By</span><strong>${escHtml(writers.join(', '))}</strong></div>` : ''}
            ${companies.length || networks.length ? `<div><span>${type === 'tv' ? 'Network' : 'Studio'}</span><strong>${escHtml((networks.length ? networks : companies).join(', '))}</strong></div>` : ''}
          </div>` : ''}
        </div>` : ''}
      </div>` : ''}
      ${cast.length ? `<div class="discover-media-section discover-media-section-cast">${castHasMore ? `<h3 class="media-profile-section-title-link" role="button" tabindex="0" onclick="openMediaCastPage()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openMediaCastPage();}">Cast<span class="media-profile-section-count" aria-hidden="true">${escHtml(castAll.length)}</span></h3>` : `<h3>Cast</h3>`}<div class="discover-media-cast">${cast.map(person => renderDiscoverCastCard(person)).join('')}</div></div>` : ''}
      ${renderUniversalMediaReviewsButton(type, details, id)}
      ${charactersPreview.length ? `<div class="discover-media-section discover-media-section-characters">${charactersHasMore ? `<h3 class="media-profile-section-title-link media-profile-section-title-link-anime" role="button" tabindex="0" onclick="openMediaCharactersPage()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openMediaCharactersPage();}">Characters<span class="media-profile-section-count" aria-hidden="true">${escHtml(charactersAll.length)}</span></h3>` : `<h3>Characters</h3>`}<div class="discover-media-cast discover-media-characters">${charactersPreview.map(renderAnimeCharacterCard).join('')}</div></div>` : ''}
      ${renderDeepSeekMoreLikeThisSection(type, details)}
    </div>
  </section>`;
}

/* v11.061: TMDB's series-level `credits.cast` is often a tiny, main-billing
   slice — some shows surface only ~9 people. The COMPLETE recurring cast lives
   in TMDB's `aggregate_credits` endpoint, which aggregates cast across every
   season/episode. For TV we now request aggregate_credits and fold it into
   `details.credits.cast`, normalized to the exact shape the cast cards /
   18-card preview / "Show All" page / keyword extraction already consume.
   Movies have no aggregate_credits endpoint and their credits.cast is already
   the full billed cast, so they are left untouched. */
function mergeFullTvCastFromAggregateCredits(details, type) {
  if (!details || type !== 'tv') return details;
  const agg = Array.isArray(details.aggregate_credits?.cast) ? details.aggregate_credits.cast : [];
  if (!agg.length) return details;
  const normalized = agg
    .filter(person => person && person.name)
    .map(person => {
      const roleNames = Array.isArray(person.roles)
        ? [...new Set(person.roles.map(r => String(r?.character || '').trim()).filter(Boolean))]
        : [];
      return {
        id: person.id,
        name: person.name,
        character: roleNames.join(' / '),
        profile_path: person.profile_path || '',
        order: typeof person.order === 'number' ? person.order : 9999,
        total_episode_count: Number(person.total_episode_count || 0) || 0
      };
    })
    .sort((a, b) => (a.order - b.order) || (b.total_episode_count - a.total_episode_count));
  details.credits = (details.credits && typeof details.credits === 'object') ? details.credits : {};
  const currentCount = Array.isArray(details.credits.cast) ? details.credits.cast.length : 0;
  // Never shrink the cast — only adopt aggregate_credits when it's more complete.
  if (normalized.length > currentCount) details.credits.cast = normalized;
  return details;
}

/* =============================================================================
   v11.084: Trailer Views metric for Movie / TV full-page media profiles.

   After the profile renders, fetch the aggregated official-trailer view total
   from the worker (/api/youtube/trailer-views — key stays server-side, result
   edge-cached 48h) and inject a clean "Trailer Views · 18.4M" tile into the
   existing facts grid. Non-blocking: the profile is already on screen; this
   only ADDS a tile if reliable data exists. If the worker can't find a
   trustworthy official trailer it returns ok:false and we render nothing —
   never "0 views" or a placeholder.

   Scoped to real Movie/TV TMDB profiles only. Anime (isAnime / mal: ids) and
   every other section are intentionally excluded. */
const mediaProfileTrailerViewsCache = new Map();

async function hydrateMediaProfileTrailerViews(overlay, type, id, details) {
  try {
    if (!overlay || (type !== 'movie' && type !== 'tv')) return;
    const isAnime = !!(details?.isAnime || details?.mediaCategory === 'anime');
    /* Anime is Jikan-sourced (id like "mal:1234", no TMDB id) — resolve trailer
       views by title+year instead of a TMDB id. Movies/TV use their TMDB id. */
    const realTmdbId = String(details?.tmdbId || '').replace(/[^0-9]/g, '')
      || (String(id).startsWith('mal:') ? '' : String(id || '').replace(/[^0-9]/g, ''));
    const malId = String(details?.malId || details?.mal_id || (String(id).startsWith('mal:') ? String(id).slice(4) : '')).replace(/[^0-9]/g, '');
    const title = getDiscoverMediaTitle(details, type) || '';
    const year = getDiscoverMediaDate(details, type).slice(0, 4);
    /* Need a TMDB id (movies/TV) OR a title (anime / search fallback). */
    if (!realTmdbId && !title) return;

    const cacheKey = realTmdbId ? `tv:${realTmdbId}` : (malId ? `mal:${malId}` : `q:${type}:${title}:${year}`);
    let data = mediaProfileTrailerViewsCache.get(cacheKey);
    if (!data) {
      const imdbId = String(details?.imdbId || details?.external_ids?.imdb_id || details?.imdb_id || '').trim();
      const params = new URLSearchParams({ mediaType: type });
      if (realTmdbId && !isAnime) params.set('tmdbId', realTmdbId);
      if (imdbId && !isAnime) params.set('imdbId', imdbId);
      if (title) params.set('title', title);
      if (year) params.set('year', year);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const res = await fetch(`/api/youtube/trailer-views?${params.toString()}`, { signal: controller.signal });
        data = res.ok ? await res.json() : { ok: false };
      } catch (e) {
        data = { ok: false };
      } finally {
        clearTimeout(timer);
      }
      mediaProfileTrailerViewsCache.set(cacheKey, data);
    }

    if (!data || !data.ok || !data.displayViews) return;

    /* Guard against a stale async response landing on a different profile. */
    if (document.getElementById('discover-media-profile') !== overlay) return;
    if (!document.body.contains(overlay)) return;
    if (activeDiscoverMediaProfileState?.id !== id || activeDiscoverMediaProfileState?.type !== type) return;

    const facts = overlay.querySelector('.discover-media-facts');
    if (!facts || facts.querySelector('.discover-media-fact-trailer-views')) return;

    const tile = document.createElement('div');
    tile.className = 'discover-media-fact-trailer-views';
    const value = document.createElement('strong');
    value.textContent = data.displayViews;
    const label = document.createElement('span');
    label.textContent = 'Views';
    tile.appendChild(value);
    tile.appendChild(label);
    facts.appendChild(tile);
  } catch (e) {
    /* Trailer views are a nice-to-have — never let a failure here affect the
       profile. Stay quiet in production. */
  }
}

async function openDiscoverMediaProfile(event, type, id, transitionOrigin = null, options = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if ((type !== 'movie' && type !== 'tv') || !id) return;
  const fromFilmography = !!options?.fromFilmography;
  const fromDiscoverViewAll = !!options?.openAboveViewAll || options?.sourceContext === 'discovery-view-all';
  const fromMyListEpisodePage = !!options?.openAboveMyListEpisodePage || options?.sourceContext === 'mylist-episode-page';
  const filmographyReturn = fromFilmography ? {
    previousState: options?.previousState || (activeDiscoverMediaProfileState ? { ...activeDiscoverMediaProfileState } : null),
    scrollTop: Number(options?.filmographyScrollTop || filmographyPageState?.scrollTop || 0)
  } : null;
  const key = getDiscoverMediaProfileKey(type, id);
  const seed = discoverMediaProfileSeeds.get(key) || {};
  /* v654: If the seed for this id is Jikan-sourced (anime from Discover/
     search), reroute to the Jikan profile path instead of fetching TMDB. */
  if (seed && seed.__jikan && seed.__mal_id) {
    return openJikanAnimeProfile(event, seed.__mal_id, transitionOrigin);
  }
  let overlay = null;
  if (fromFilmography) {
    overlay = document.getElementById('discover-media-profile');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'discover-media-profile';
      document.body.appendChild(overlay);
    }
    destroyDiscoverHeroTrailerPreview(overlay);
    overlay.className = 'discover-media-profile-overlay';
    if (isActivityMediaProfileOrigin(transitionOrigin)) overlay.classList.add('activity-origin-media-profile');
    if (fromDiscoverViewAll) overlay.classList.add('discover-media-profile-from-view-all');
    if (fromMyListEpisodePage) overlay.classList.add('discover-media-profile-from-mylist-episode');
    overlay.innerHTML = renderDiscoverMediaProfileShell(seed, type, id);
    bindDiscoverMediaProfileActions(overlay);
    document.body.classList.add('discover-media-profile-open', 'filmography-title-profile-open');
    if (fromDiscoverViewAll) document.body.classList.add('discover-view-all-profile-open');
    document.addEventListener('keydown', handleDiscoverMediaProfileEsc);
    overlay.classList.add('open');
    activeDiscoverMediaProfileState = {
      view: 'title',
      type,
      id,
      details: seed,
      filmographyReturn,
      fromDiscoverViewAll,
      fromMyListEpisodePage
    };
  } else {
    /* v10.488: media-profile → media-profile back-stack.
       When the user opens a NEW title from "More Like This" (or any
       other source that lands here while an existing media profile is
       already open), push the current title onto a stack so a
       subsequent swipe-back restores it instead of jumping all the way
       back to Discovery. The stack lives in
       `discoverMediaProfileBackStack`, declared near the close handler.
       Skip the push when the in-progress open IS itself a restore
       triggered by closeDiscoverMediaProfile (signalled via the
       `_restoringFromStack` option) so popping stays linear. */
    const isRestoreOpen = !!(options && options._restoringFromStack);
    if (!isRestoreOpen && activeDiscoverMediaProfileState
        && activeDiscoverMediaProfileState.type
        && activeDiscoverMediaProfileState.id) {
      try {
        const currentOverlay = document.getElementById('discover-media-profile');
        const scrollSurface = currentOverlay?.querySelector?.('.discover-media-page')
          || currentOverlay;
        const scrollTop = scrollSurface?.scrollTop || 0;
        if (!Array.isArray(window.discoverMediaProfileBackStack)) {
          window.discoverMediaProfileBackStack = [];
        }
        window.discoverMediaProfileBackStack.push({
          type: activeDiscoverMediaProfileState.type,
          id: activeDiscoverMediaProfileState.id,
          scrollTop
        });
      } catch (_) {}
    }
    closeDiscoverMediaProfile('_internalReplace');
    overlay = document.createElement('div');
    overlay.id = 'discover-media-profile';
    overlay.className = 'discover-media-profile-overlay';
    if (isActivityMediaProfileOrigin(transitionOrigin)) overlay.classList.add('activity-origin-media-profile');
    if (fromDiscoverViewAll) overlay.classList.add('discover-media-profile-from-view-all');
    if (fromMyListEpisodePage) overlay.classList.add('discover-media-profile-from-mylist-episode');
    overlay.innerHTML = renderDiscoverMediaProfileShell(seed, type, id);
    bindDiscoverMediaProfileActions(overlay);
    document.body.appendChild(overlay);
    document.body.classList.add('discover-media-profile-open');
    if (fromDiscoverViewAll) document.body.classList.add('discover-view-all-profile-open');
    document.addEventListener('keydown', handleDiscoverMediaProfileEsc);
    revealMediaProfileOverlay(overlay, transitionOrigin, event);
  }
  try {
    let details = discoverMediaProfileCache.get(key);
    if (!details) {
      const res = await fetchTmdbProxy(`${type}/${id}`, {
        append_to_response: type === 'tv'
          ? 'aggregate_credits,credits,videos,similar,external_ids,keywords'
          : 'credits,videos,similar,external_ids,keywords'
      });
      if (!res.ok) throw new Error(`TMDB detail request failed: ${res.status}`);
      details = await res.json();
      mergeFullTvCastFromAggregateCredits(details, type);
      discoverMediaProfileCache.set(key, details);
    }
    /* v671: resolve IMDb rating + votes from OMDb so the hero score reflects
       IMDb instead of TMDB. Cached client-side for 7 days, server-side for 7
       days, so subsequent opens are instant.
       v11.015: gate widened to also re-fetch when imdbVotes is missing/0
       even if imdbRating is already cached. Catches the bug where a
       legacy cached `details` had rating but no votes — the previous
       gate skipped re-enrichment, leaving Members empty, which then
       (in v11.014) wrongly fell back to TMDB's vote_count.
       Also logs a console.warn when OMDb returns no votes so the next
       diagnostic test reveals whether OMDb itself is the failure point
       (vs. the gate / parsing). */
    const needsImdbEnrichment = isDiscoverMediaReleased(details, type)
      && (!details.imdbRating || !Number(details.imdbVotes || 0))
      && (typeof window.getImdbRatingViaBatch === 'function' || typeof window.getImdbRatingForMedia === 'function');
    if (needsImdbEnrichment) {
      try {
        const imdbId = details.external_ids?.imdb_id || details.imdbID || '';
        const titleForLookup = type === 'movie'
          ? (details.title || details.original_title || '')
          : (details.name || details.original_name || '');
        const yearForLookup = (details.release_date || details.first_air_date || '').slice(0, 4);
        /* v11.083: resolve through the BATCH/exact-IMDb-ID path (same as the
           discovery rails + 5am cron) so the profile's rating + Members match
           the card exactly. Falls back to the single endpoint only if the batch
           helper is unavailable. */
        const ratingArgs = { tmdbId: id, imdbId, type, title: titleForLookup, year: yearForLookup };
        const imdbInfo = (typeof window.getImdbRatingViaBatch === 'function')
          ? await window.getImdbRatingViaBatch(ratingArgs)
          : await window.getImdbRatingForMedia(ratingArgs);
        if (imdbInfo && imdbInfo.ok) {
          details.imdbRating = imdbInfo.imdbRating;
          details.imdbVotes = imdbInfo.imdbVotesNumber;
          details.imdbVotesText = imdbInfo.imdbVotes;
          details.imdbId = imdbInfo.imdbId;
          if (imdbInfo.genre) {
            details.imdbGenre = String(imdbInfo.genre);
            details.imdbGenres = String(imdbInfo.genre)
              .split(',')
              .map(value => value.trim())
              .filter(Boolean);
            details.imdbPrimaryGenre = details.imdbGenres[0] || '';
          }
          /* Overwrite TMDB rating fields so anything reading vote_average
             on this details object now sees IMDb. */
          details.vote_average = imdbInfo.imdbRating;
          details.vote_count = imdbInfo.imdbVotesNumber;
          details.ratingSource = imdbInfo.ratingSource || 'omdb_imdb_id';
          details.ratingProvider = imdbInfo.ratingProvider || 'OMDb';
          discoverMediaProfileCache.set(key, details);
          if (!Number(imdbInfo.imdbVotesNumber || 0)) {
            try { console.warn('[v11.015] OMDb returned 0 imdbVotes for', titleForLookup, '— Members fact will be hidden. Raw imdbVotes string:', imdbInfo.imdbVotes); } catch (_) {}
          }
        } else {
          try { console.warn('[v11.015] OMDb enrichment returned not-ok for', titleForLookup, imdbInfo); } catch (_) {}
        }
      } catch (e) {
        try { console.warn('[v11.015] OMDb enrichment threw:', e && e.message || e); } catch (_) {}
      }
    }
    const watchProviderDisplay = details.watchProviderDisplay || await fetchDiscoverWatchProviderDisplay(type, id, { ...seed, ...details });
    if (watchProviderDisplay) {
      details.watchProviderDisplay = watchProviderDisplay;
      discoverMediaProfileCache.set(key, details);
    }
    if (!document.getElementById('discover-media-profile')) return;
    let mergedDetails = { ...seed, ...details, watchProviderDisplay };
    /* v11.383: classify anime from the ITEM itself, NEVER from the global
       activeDiscoveryHub. That global is persisted UI state — if the Anime hub
       was the last hub viewed, opening ANY TMDB tv title here (e.g. Severance,
       reached from search / activity / "more like this") used to force
       isAnime=true. hydrateAnimeTitleVariants would then fuzzy-search Jikan by
       the title, match an unrelated MAL entry, overwrite the title (e.g. with a
       donghua) and stamp a MyAnimeList badge. Genuine anime is still caught by
       detectAnimeFromMetadata (animation genre + JP/region signal) or by
       explicit Jikan/MAL markers; anime opened from the Anime hub reroutes to
       openJikanAnimeProfile upstream and never reaches this TMDB path. */
    const profileIsAnime =
      detectAnimeFromMetadata({
        genreNames: getDiscoverGenreNames(mergedDetails, 'tv'),
        originalTitle: mergedDetails.original_name || '',
        originalLanguage: mergedDetails.original_language || '',
        originCountries: Array.isArray(mergedDetails.origin_country) ? mergedDetails.origin_country : []
      }) ||
      !!mergedDetails.__jikan ||
      !!(mergedDetails.__mal_id || mergedDetails.mal_id || mergedDetails.malId) ||
      mergedDetails.mediaCategory === 'anime' ||
      mergedDetails.librarySection === 'anime' ||
      mergedDetails.isAnime === true ||
      String(id || '').startsWith('mal:');
    if (type === 'tv' && profileIsAnime) {
      mergedDetails.mediaCategory = 'anime';
      mergedDetails.librarySection = 'anime';
      mergedDetails.isAnime = true;
      /* v677: also re-run hydrate when malMembers isn't set yet — the
         hydrate call now writes Jikan community stats (members, favorites,
         score, rank, popularity) onto the merged details so the Members
         fact renders for TMDB-sourced anime profiles, not just Jikan ones. */
      const needsTitleVariants = !mergedDetails.titleVariants?.romaji || !mergedDetails.titleVariants?.japanese;
      const needsMalStats = !Number(mergedDetails.malMembers || 0);
      if (needsTitleVariants || needsMalStats) {
        await hydrateAnimeTitleVariants(mergedDetails);
      }
      const animeTrailerDetails = await attachAnimeMediaProfileTrailer(mergedDetails, id);
      if (animeTrailerDetails !== mergedDetails) {
        mergedDetails = animeTrailerDetails;
        discoverMediaProfileCache.set(key, mergedDetails);
      }
    }
    repairLibraryItemCoverFromProfile(seed, mergedDetails);
    activeDiscoverMediaProfileState = {
      view: 'title',
      type,
      id,
      details: mergedDetails,
      fromDiscoverViewAll,
      fromMyListEpisodePage,
      ...(filmographyReturn ? { filmographyReturn } : {})
    };
    if (typeof waitForMediaProfileHeroReveal === 'function') {
      await waitForMediaProfileHeroReveal(overlay);
    }
    if (!document.getElementById('discover-media-profile') || !document.body.contains(overlay)) return;
    destroyDiscoverHeroTrailerPreview(overlay);
    overlay.innerHTML = renderDiscoverMediaProfileDetails(type, mergedDetails, id);
    bindDiscoverMediaProfileActions(overlay);
    hydrateDiscoverHeroTrailerPreview(overlay);
    hydrateDeepSeekMoreLikeThis(type, mergedDetails);
    hydrateDiscoverProviderLogoFallbacks();
    hydrateMediaProfileTrailerViews(overlay, type, id, mergedDetails);
  } catch (e) {
    console.error('Discover media profile failed:', e);
    const body = overlay.querySelector('.discover-media-body');
    if (body) body.innerHTML = '<div class="discover-media-loading">Could not load this title page. Try again in a moment.</div>';
  }
}

/* =============================================================================
   v654: openJikanAnimeProfile — opens an anime profile sourced exclusively
   from Jikan (api.jikan.moe). Fetches /anime/{mal_id}/full + /characters
   + /recommendations in parallel (rate-limited via the Jikan service queue),
   maps the response to a TMDB-compatible shape, and feeds it through the
   existing renderDiscoverMediaProfileDetails renderer.

   The profile is keyed under type='tv' with id=`mal:${mal_id}` so it doesn't
   collide with TMDB-keyed profiles in the cache.
   ========================================================================== */
async function openJikanAnimeProfile(event, malId, transitionOrigin = null, options = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const id = String(malId || '').trim();
  if (!id) return;
  const J = window.JikanAnime;
  if (!J) {
    console.error('JikanAnime service unavailable');
    return;
  }
  const profileType = 'tv';
  const profileId = `mal:${id}`;
  const key = getDiscoverMediaProfileKey(profileType, profileId);
  const seed = discoverMediaProfileSeeds.get(key) || {};
  closeDiscoverMediaProfile();
  const overlay = document.createElement('div');
  overlay.id = 'discover-media-profile';
  overlay.className = 'discover-media-profile-overlay';
  if (isActivityMediaProfileOrigin(transitionOrigin)) overlay.classList.add('activity-origin-media-profile');
  if (options?.openAboveMyListEpisodePage || options?.sourceContext === 'mylist-episode-page') {
    overlay.classList.add('discover-media-profile-from-mylist-episode');
  }
  overlay.innerHTML = renderDiscoverMediaProfileShell(seed, profileType, profileId);
  bindDiscoverMediaProfileActions(overlay);
  document.body.appendChild(overlay);
  document.body.classList.add('discover-media-profile-open');
  document.addEventListener('keydown', handleDiscoverMediaProfileEsc);
  revealMediaProfileOverlay(overlay, transitionOrigin, event);
  try {
    let mergedDetails = discoverMediaProfileCache.get(key);
    if (!mergedDetails) {
      /* v10.116: fetch a deeper cast slice from Jikan (60, up from 12) so
         the media profile's 18-card preview can actually hit overflow and
         the Show All button appears for Jikan-routed anime profiles too.
         Jikan returns the full character list paginated; 60 covers the
         main + supporting cast for virtually every series without any
         extra API calls (still one /characters request). */
      const [j, characters, recs] = await Promise.all([
        J.animeFull(id),
        J.animeCharacters(id, 60),
        J.animeRecommendations(id, 8)
      ]);
      if (!j) throw new Error('Jikan returned no data for ' + id);
      mergedDetails = J.mapFullDetails(j, characters || [], recs || []);
      mergedDetails.mediaCategory = 'anime';
      mergedDetails.librarySection = 'anime';
      mergedDetails.isAnime = true;
      mergedDetails = await attachAnimeMediaProfileTrailer(mergedDetails, profileId);
      discoverMediaProfileCache.set(key, mergedDetails);
    } else {
      const animeTrailerDetails = await attachAnimeMediaProfileTrailer(mergedDetails, profileId);
      if (animeTrailerDetails !== mergedDetails) {
        mergedDetails = animeTrailerDetails;
        discoverMediaProfileCache.set(key, mergedDetails);
      }
    }
    if (typeof window.repairLibraryAnimeItemFromJikanProfile === 'function') {
      window.repairLibraryAnimeItemFromJikanProfile(seed, mergedDetails);
    }
    if (!document.getElementById('discover-media-profile')) return;
    activeDiscoverMediaProfileState = {
      view: 'title',
      type: profileType,
      id: profileId,
      details: mergedDetails
    };
    destroyDiscoverHeroTrailerPreview(overlay);
    overlay.innerHTML = renderDiscoverMediaProfileDetails(profileType, mergedDetails, profileId);
    bindDiscoverMediaProfileActions(overlay);
    hydrateDiscoverHeroTrailerPreview(overlay);
    hydrateDiscoverProviderLogoFallbacks();
    hydrateMediaProfileTrailerViews(overlay, profileType, profileId, mergedDetails);
    /* v11.091: "More Like This" was never hydrated on Jikan anime profiles, so
       it sat on "Loading source matches…". Run it (uses Jikan recommendations
       from details.similar.results). Also patch the season/episode totals. */
    hydrateDeepSeekMoreLikeThis(profileType, mergedDetails);
    hydrateAnimeSeriesCounts(overlay, profileId, mergedDetails);
  } catch (e) {
    console.error('Jikan anime profile failed:', e);
    const body = overlay.querySelector('.discover-media-body');
    if (body) body.innerHTML = '<div class="discover-media-loading">Could not load this anime page. Try again in a moment.</div>';
  }
}
window.openJikanAnimeProfile = openJikanAnimeProfile;

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

const musicDiscoverProfileSeeds = new Map();
const MUSIC_DISCOVER_SHOW_ALL_BATCH_SIZE = 24;
const MUSIC_DISCOVER_SHOW_ALL_CHART_LIMIT = 100;
const musicDiscoverShowAllCache = new Map();
let musicDiscoverShowAllState = null;
let musicDiscoverShowAllHistoryActive = false;

function getMusicDiscoveryGrids() {
  return [
    document.getElementById('discover-music-popular-week-grid'),
    document.getElementById('discover-music-new-week-grid')
  ].filter(Boolean);
}

function renderMusicDiscoverLoading() {
  getMusicDiscoveryGrids().forEach(grid => {
    grid.innerHTML = '<div class="discover-message">Loading music discovery...</div>';
  });
}

function renderMusicDiscoverError(message = 'Music Discovery could not load. It will try again automatically later.') {
  const html = `<div class="discover-message">${escHtml(message)}</div>`;
  getMusicDiscoveryGrids().forEach(grid => { grid.innerHTML = html; });
}

function formatMusicDiscoveryDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMusicDiscoveryWeekWindow(now = new Date()) {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  const day = base.getDay();
  const daysSinceFriday = (day + 2) % 7;
  const start = new Date(base);
  start.setDate(base.getDate() - daysSinceFriday);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end, startIso: formatMusicDiscoveryDate(start), endIso: formatMusicDiscoveryDate(end) };
}

function formatMusicDiscoveryWeekLabel(range = getMusicDiscoveryWeekWindow()) {
  const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  return `${formatter.format(range.start)} - ${formatter.format(range.end)}`;
}

function normalizeMusicDiscoveryKey(value = '') {
  return String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function normalizeDeezerAlbumForDiscover(album = {}, fallback = {}) {
  const artist = album.artist || fallback.artist || {};
  const title = String(album.title || fallback.title || '').trim();
  const artistName = String(artist.name || fallback.artistName || '').trim();
  const deezerId = String(album.id || fallback.deezerId || '').trim();
  if (!title) return null;
  return {
    id: deezerId ? `deezer-${deezerId}` : `music-${normalizeMusicDiscoveryKey(`${title}-${artistName}`)}`,
    deezerId,
    title,
    artist: artistName,
    year: String(album.release_date || fallback.releaseDate || '').slice(0, 4),
    releaseDate: String(album.release_date || fallback.releaseDate || '').slice(0, 10),
    poster: album.cover_big || album.cover_xl || album.cover_medium || album.cover || fallback.poster || '',
    cover: album.cover_big || album.cover_xl || album.cover_medium || album.cover || fallback.poster || '',
    type: fallback.type || album.record_type || 'Album',
    source: 'deezer'
  };
}

function normalizeMusicBrainzReleaseForDiscover(release = {}) {
  const title = String(release.title || '').trim();
  const artistName = (Array.isArray(release['artist-credit']) ? release['artist-credit'] : [])
    .map(row => row?.artist?.name || row?.name || '')
    .filter(Boolean)
    .join(', ');
  const id = String(release.id || '').trim();
  if (!title || !id) return null;
  const groupType = String(release['release-group']?.['primary-type'] || release['primary-type'] || '').trim();
  return {
    id: `mbid-${id}`,
    mbid: id,
    title,
    artist: artistName,
    year: String(release.date || '').slice(0, 4),
    releaseDate: String(release.date || '').slice(0, 10),
    poster: '',
    cover: '',
    type: groupType || 'Release',
    source: 'musicbrainz'
  };
}

async function enrichMusicDiscoverAlbumCover(item = {}) {
  if (!item?.title || item.deezerId) return item;
  const q = [item.artist, item.title].filter(Boolean).join(' ');
  if (!q) return item;
  try {
    const res = await fetch(`/api/deezer/search/album?q=${encodeURIComponent(q)}&limit=1`);
    if (!res.ok) return item;
    const json = await res.json();
    const hit = Array.isArray(json?.data) ? json.data[0] : null;
    if (!hit) return item;
    const normalized = normalizeDeezerAlbumForDiscover(hit, {
      title: item.title,
      artistName: item.artist,
      releaseDate: item.releaseDate,
      type: item.type
    });
    return normalized ? { ...item, ...normalized, mbid: item.mbid || normalized.mbid || '' } : item;
  } catch (_) {
    return item;
  }
}

function dedupeMusicDiscoverItems(items = []) {
  const seen = new Set();
  return (items || []).filter(item => {
    const key = getMusicDiscoverStableKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getMusicDiscoverStableKey(item = {}) {
  const deezerId = String(item.deezerId || '').trim();
  if (deezerId) return `deezer-${deezerId}`;
  const mbid = String(item.mbid || '').trim();
  if (mbid) return `mbid-${mbid}`;
  return normalizeMusicDiscoveryKey(`${item.title || ''}-${item.artist || ''}`);
}

function getMusicDiscoverShowAllConfig(sectionKey = '') {
  const range = getMusicDiscoveryWeekWindow();
  const configs = {
    'popular-week': {
      key: 'popular-week',
      title: 'Popular This Week',
      cacheKey: `music-show-all:popular-week:${DISCOVER_RANKING_CACHE_VERSION}:${range.startIso}:${range.endIso}`,
      fetchBatch: fetchMusicPopularThisWeekBatch
    },
    'new-week': {
      key: 'new-week',
      title: 'New This Week',
      cacheKey: `music-show-all:new-week:${DISCOVER_RANKING_CACHE_VERSION}:${range.startIso}:${range.endIso}`,
      fetchBatch: fetchMusicNewThisWeekBatch
    }
  };
  return configs[sectionKey] || null;
}

async function fetchMusicPopularThisWeekBatch(offset = 0, limit = MUSIC_DISCOVER_SHOW_ALL_BATCH_SIZE) {
  const res = await fetch(`/api/deezer/chart/0?limit=${MUSIC_DISCOVER_SHOW_ALL_CHART_LIMIT}`);
  if (!res.ok) throw new Error(`Deezer chart failed: ${res.status}`);
  const json = await res.json();
  const albumRows = Array.isArray(json?.albums?.data) ? json.albums.data : [];
  const trackRows = Array.isArray(json?.tracks?.data) ? json.tracks.data : [];
  const fromAlbums = albumRows.map(album => normalizeDeezerAlbumForDiscover(album, { type: 'Album' })).filter(Boolean);
  const fromTracks = trackRows.map(track => normalizeDeezerAlbumForDiscover(track.album || {}, {
    title: track.album?.title || track.title || '',
    artistName: track.artist?.name || '',
    type: track.album?.title ? 'Album' : 'Single'
  })).filter(Boolean);
  return dedupeMusicDiscoverItems([...fromAlbums, ...fromTracks]).slice(offset, offset + limit);
}

async function fetchMusicPopularThisWeek() {
  return fetchMusicPopularThisWeekBatch(0, 18);
}

async function fetchMusicNewThisWeekBatch(offset = 0, limit = MUSIC_DISCOVER_SHOW_ALL_BATCH_SIZE) {
  const range = getMusicDiscoveryWeekWindow();
  const query = `date:[${range.startIso} TO ${range.endIso}] AND status:official`;
  const requestLimit = Math.max(limit * 2, limit);
  const res = await fetch(`/api/musicbrainz/search?type=release&q=${encodeURIComponent(query)}&limit=${requestLimit}&offset=${Math.max(0, Number(offset) || 0)}&sort=date`);
  if (!res.ok) throw new Error(`MusicBrainz releases failed: ${res.status}`);
  const json = await res.json();
  const releases = Array.isArray(json?.releases) ? json.releases : [];
  const normalized = releases
    .filter(release => {
      const primaryType = String(release?.['release-group']?.['primary-type'] || release?.['primary-type'] || '').toLowerCase();
      return !primaryType || primaryType === 'album' || primaryType === 'single';
    })
    .map(normalizeMusicBrainzReleaseForDiscover)
    .filter(Boolean)
    .sort((a, b) => String(b.releaseDate || '').localeCompare(String(a.releaseDate || '')));
  const deduped = dedupeMusicDiscoverItems(normalized).slice(0, limit);
  const enriched = await Promise.all(deduped.map(enrichMusicDiscoverAlbumCover));
  return dedupeMusicDiscoverItems(enriched).slice(0, limit);
}

async function fetchMusicNewThisWeek() {
  return fetchMusicNewThisWeekBatch(0, 18);
}

function openMusicDiscoverProfile(key = '') {
  const item = musicDiscoverProfileSeeds.get(String(key || ''));
  if (!item) return;
  if (typeof window.openMusicAlbumProfile === 'function') {
    window.openMusicAlbumProfile(item);
  }
}
window.openMusicDiscoverProfile = openMusicDiscoverProfile;

function getOrCreateMusicDiscoverShowAllPage() {
  let page = document.getElementById('music-discover-show-all-page');
  if (page) return page;
  page = document.createElement('section');
  page.id = 'music-discover-show-all-page';
  page.className = 'music-discover-show-all-page';
  page.style.display = 'none';
  page.setAttribute('aria-hidden', 'true');
  page.innerHTML = `
    <div class="music-discover-show-all-shell">
      <header class="music-discover-show-all-topbar">
        <button class="music-discover-show-all-back" type="button" onclick="closeMusicDiscoverShowAll()" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <h2 id="music-discover-show-all-title">Music</h2>
        <span class="music-discover-show-all-spacer" aria-hidden="true"></span>
      </header>
      <div class="music-discover-show-all-grid" id="music-discover-show-all-grid"></div>
      <div class="music-discover-show-all-loader" id="music-discover-show-all-loader" hidden>
        <span aria-hidden="true"></span>
      </div>
    </div>`;
  page.addEventListener('scroll', handleMusicDiscoverShowAllScroll, { passive: true });
  document.body.appendChild(page);
  return page;
}

function getMusicDiscoverShowAllCache(sectionKey = '') {
  const config = getMusicDiscoverShowAllConfig(sectionKey);
  if (!config) return null;
  if (!musicDiscoverShowAllCache.has(config.cacheKey)) {
    musicDiscoverShowAllCache.set(config.cacheKey, {
      sectionKey,
      items: [],
      offset: 0,
      done: false,
      loadedKeys: new Set()
    });
  }
  return musicDiscoverShowAllCache.get(config.cacheKey);
}

function setMusicDiscoverShowAllLoading(isLoading = false) {
  const loader = document.getElementById('music-discover-show-all-loader');
  if (loader) loader.hidden = !isLoading;
}

function renderMusicDiscoverShowAllGrid() {
  if (!musicDiscoverShowAllState) return;
  const grid = document.getElementById('music-discover-show-all-grid');
  if (!grid) return;
  const items = musicDiscoverShowAllState.items || [];
  if (!items.length && musicDiscoverShowAllState.done) {
    grid.innerHTML = '<div class="discover-message music-discover-show-all-empty">No music found for this section.</div>';
    return;
  }
  grid.innerHTML = items.map(item => {
    const key = String(item.id || item.deezerId || item.mbid || getMusicDiscoverStableKey(item));
    musicDiscoverProfileSeeds.set(key, item);
    const poster = item.poster || item.cover || '';
    const title = item.title || 'Untitled';
    const artist = item.artist || 'Unknown Artist';
    return `<button class="music-discover-show-all-item" type="button" onclick="openMusicDiscoverProfile('${escAttr(key)}')" aria-label="${escAttr(`${title} by ${artist}`)}">
      <span class="music-discover-show-all-cover${poster ? '' : ' no-img'}" ${poster ? `style="background-image:url('${escAttr(poster)}')"` : ''}>${poster ? '' : '<span aria-hidden="true">♪</span>'}</span>
      <span class="music-discover-show-all-name">${escHtml(title)}</span>
      <span class="music-discover-show-all-artist">${escHtml(artist)}</span>
    </button>`;
  }).join('');
}

async function loadMoreMusicDiscoverShowAll(force = false) {
  if (!musicDiscoverShowAllState || musicDiscoverShowAllState.loading || (musicDiscoverShowAllState.done && !force)) return;
  const config = getMusicDiscoverShowAllConfig(musicDiscoverShowAllState.sectionKey);
  if (!config) return;
  musicDiscoverShowAllState.loading = true;
  setMusicDiscoverShowAllLoading(true);
  try {
    if (force) {
      musicDiscoverShowAllState.items = [];
      musicDiscoverShowAllState.offset = 0;
      musicDiscoverShowAllState.done = false;
      musicDiscoverShowAllState.loadedKeys = new Set();
      renderMusicDiscoverShowAllGrid();
    }
    const batch = await config.fetchBatch(musicDiscoverShowAllState.offset, MUSIC_DISCOVER_SHOW_ALL_BATCH_SIZE);
    const nextItems = [];
    (Array.isArray(batch) ? batch : []).forEach(item => {
      const key = getMusicDiscoverStableKey(item);
      if (!key || musicDiscoverShowAllState.loadedKeys.has(key)) return;
      musicDiscoverShowAllState.loadedKeys.add(key);
      nextItems.push(item);
    });
    musicDiscoverShowAllState.offset += MUSIC_DISCOVER_SHOW_ALL_BATCH_SIZE;
    musicDiscoverShowAllState.items.push(...nextItems);
    if (nextItems.length < MUSIC_DISCOVER_SHOW_ALL_BATCH_SIZE) musicDiscoverShowAllState.done = true;
    renderMusicDiscoverShowAllGrid();
  } catch (error) {
    console.error('Music Show All load failed:', error);
    const grid = document.getElementById('music-discover-show-all-grid');
    if (grid && !musicDiscoverShowAllState.items.length) {
      grid.innerHTML = '<div class="discover-message music-discover-show-all-empty">This music section could not load.</div>';
    }
    musicDiscoverShowAllState.done = true;
  } finally {
    musicDiscoverShowAllState.loading = false;
    setMusicDiscoverShowAllLoading(false);
  }
}

function handleMusicDiscoverShowAllScroll() {
  const page = document.getElementById('music-discover-show-all-page');
  if (!page || page.style.display === 'none' || !musicDiscoverShowAllState) return;
  if (page.scrollTop + page.clientHeight >= page.scrollHeight - 520) {
    loadMoreMusicDiscoverShowAll(false);
  }
}

async function openMusicDiscoverShowAll(sectionKey = '') {
  const config = getMusicDiscoverShowAllConfig(sectionKey);
  if (!config) return;
  const page = getOrCreateMusicDiscoverShowAllPage();
  const title = document.getElementById('music-discover-show-all-title');
  if (title) title.textContent = config.title;
  const cache = getMusicDiscoverShowAllCache(sectionKey);
  musicDiscoverShowAllState = cache;
  page.dataset.returnScrollY = String(window.scrollY || window.pageYOffset || 0);
  page.classList.remove('is-open');
  page.style.display = 'block';
  page.setAttribute('aria-hidden', 'false');
  page.scrollTop = 0;
  document.body.classList.add('music-discover-show-all-open');
  requestAnimationFrame(() => requestAnimationFrame(() => page.classList.add('is-open')));
  if (window.history?.pushState && !window.history.state?.screenListMusicShowAll) {
    window.history.pushState({ screenListMusicShowAll: sectionKey }, '', window.location.href);
    musicDiscoverShowAllHistoryActive = true;
  }
  renderMusicDiscoverShowAllGrid();
  if (!musicDiscoverShowAllState.items.length) await loadMoreMusicDiscoverShowAll(true);
}
window.openMusicDiscoverShowAll = openMusicDiscoverShowAll;

function closeMusicDiscoverShowAll(options = {}) {
  const page = document.getElementById('music-discover-show-all-page');
  if (!options.fromPopState && musicDiscoverShowAllHistoryActive && window.history?.state?.screenListMusicShowAll) {
    musicDiscoverShowAllHistoryActive = false;
    window.history.back();
    return;
  }
  const returnScrollY = Number(page?.dataset?.returnScrollY || 0);
  if (page) {
    page.classList.remove('is-open');
    page.setAttribute('aria-hidden', 'true');
    setTimeout(() => { if (page) page.style.display = 'none'; }, 580);
  }
  musicDiscoverShowAllState = null;
  musicDiscoverShowAllHistoryActive = false;
  document.body.classList.remove('music-discover-show-all-open');
  window.requestAnimationFrame(() => window.scrollTo({ top: returnScrollY, behavior: 'auto' }));
}
window.closeMusicDiscoverShowAll = closeMusicDiscoverShowAll;

window.addEventListener('popstate', () => {
  const page = document.getElementById('music-discover-show-all-page');
  if (page && page.style.display !== 'none') {
    closeMusicDiscoverShowAll({ fromPopState: true });
  }
});

function renderMusicDiscoverCards(items = [], gridId = '') {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  if (!items.length) {
    grid.innerHTML = '<div class="discover-message">No music found for this week.</div>';
    return;
  }
  grid.dataset.expanded = 'false';
  delete grid.dataset.visibleCount;
  grid.innerHTML = items.map(item => {
    const key = String(item.id || item.deezerId || item.mbid || normalizeMusicDiscoveryKey(`${item.title}-${item.artist}`));
    musicDiscoverProfileSeeds.set(key, item);
    const poster = item.poster || item.cover || '';
    const title = item.title || 'Untitled';
    const artist = item.artist || 'Unknown Artist';
    const meta = [item.type || 'Release', item.releaseDate || item.year || ''].filter(Boolean).join(' · ');
    return `<div class="discover-card music-discover-card">
      <div class="discover-poster music-discover-cover${poster ? '' : ' no-img'}" data-poster="${escAttr(poster)}" ${poster ? `style="background-image:url('${escAttr(poster)}')"` : ''} onclick="openMusicDiscoverProfile('${escAttr(key)}')"></div>
      <div class="discover-card-body music-discover-card-body" onclick="handleDiscoverCardBodyTap(event, this)">
        <div class="discover-card-info-row">
          <div class="discover-card-info-stack">
            <button class="discover-card-title discover-title-profile-btn music-discover-title" type="button" onclick="openMusicDiscoverProfile('${escAttr(key)}')">${escHtml(title)}</button>
            <div class="discover-card-genre music-discover-artist">${escHtml(artist)}</div>
            ${meta ? `<div class="discover-card-meta music-discover-meta">${escHtml(meta)}</div>` : ''}
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
  requestAnimationFrame(() => setupDiscoverSectionLimit(grid));
}

function syncMusicDiscoverWeekLabels() {
  const range = getMusicDiscoveryWeekWindow();
  const label = formatMusicDiscoveryWeekLabel(range);
  const popular = document.getElementById('music-discover-popular-week-desc');
  const newest = document.getElementById('music-discover-new-week-desc');
  if (popular) popular.textContent = `Albums and singles with the strongest current listening signal this week (${label}).`;
  if (newest) newest.textContent = `Albums and singles released during this Friday-to-Friday week (${label}).`;
}

async function loadMusicDiscover(force = false) {
  if (musicDiscoverLoading || (musicDiscoverLoaded && !force && isDiscoverMemoryFresh(musicDiscoverLoadedAt))) {
    syncMusicDiscoverWeekLabels();
    return;
  }
  musicDiscoverLoading = true;
  syncMusicDiscoverWeekLabels();
  renderMusicDiscoverLoading();
  try {
    const range = getMusicDiscoveryWeekWindow();
    await runDiscoverSectionsInParallel([
      {
        label: 'Popular This Week',
        gridId: 'discover-music-popular-week-grid',
        run: () => renderDiscoverCachedRow({
          cacheKey: `music:popular-week:${DISCOVER_RANKING_CACHE_VERSION}:${range.startIso}:${range.endIso}`,
          fetcher: fetchMusicPopularThisWeek,
          render: items => renderMusicDiscoverCards(items, 'discover-music-popular-week-grid'),
          force
        })
      },
      {
        label: 'New This Week',
        gridId: 'discover-music-new-week-grid',
        run: () => renderDiscoverCachedRow({
          cacheKey: `music:new-week:${DISCOVER_RANKING_CACHE_VERSION}:${range.startIso}:${range.endIso}`,
          fetcher: fetchMusicNewThisWeek,
          render: items => renderMusicDiscoverCards(items, 'discover-music-new-week-grid'),
          force
        })
      }
    ]);
    musicDiscoverLoaded = true;
    musicDiscoverLoadedAt = Date.now();
  } catch (e) {
    console.error('Music Discovery load failed:', e);
    renderMusicDiscoverError();
  } finally {
    musicDiscoverLoading = false;
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
const DISCOVER_CATEGORY_FILTER_VERSION = 'v293-filter-load-more';

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
let discoverCategoryFilterPendingApply = false;

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

function getDiscoverCategoryFullSourceGridId(gridId = '') {
  return gridId === 'discover-category-full-grid'
    ? (discoverCategoryFullState?.gridId || document.getElementById(gridId)?.dataset?.sourceGridId || '')
    : gridId;
}

function shouldHideDiscoverViewAllAddButton(gridId = '') {
  if (gridId === 'discover-universal-search-grid') return true;
  if (gridId !== 'discover-category-full-grid') return false;
  const sourceGridId = getDiscoverCategoryFullSourceGridId(gridId);
  return sourceGridId.startsWith('discover-movie-') || sourceGridId.startsWith('discover-tv-');
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

function renderDiscoverCategoryFilterCloseButton(label = 'Close filter') {
  return `<button class="discover-category-filter-done discover-category-filter-close-x" type="button" onclick="closeDiscoverCategoryFilterSheet()" aria-label="${escAttr(label)}">&times;</button>`;
}

function isDiscoverSearchFilterApplyFlow() {
  return discoverCategoryFullState?.mode === 'universal-search'
    || discoverCategoryFullState?.mode === 'add-shelf'
    || discoverCategoryFullState?.mode === 'shelfd-search';
}

function getDiscoverCategoryFilterKickerText() {
  const mode = discoverCategoryFullState?.mode || '';
  if (mode === 'universal-search' || mode === 'shelfd-search') return 'Search';
  if (mode === 'add-shelf') return 'Add To Shelf';
  return 'View All';
}

function markDiscoverCategoryFiltersPendingApply() {
  if (!isDiscoverSearchFilterApplyFlow()) return;
  discoverCategoryFilterPendingApply = true;
}

function renderDiscoverCategoryApplyFilterBar() {
  if (!isDiscoverSearchFilterApplyFlow()) return '';
  const count = getDiscoverCategoryFilterCount();
  const showApply = discoverCategoryFilterPendingApply || count > 0;
  if (!showApply) return '';
  return `<div class="discover-category-filter-apply-spacer" aria-hidden="true"></div>
  <div class="discover-category-filter-apply-bar">
    <button class="discover-category-filter-apply-btn" type="button" onclick="applyDiscoverCategoryFiltersFromSheet()">Apply and Search</button>
  </div>`;
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
      <div><div class="discover-category-filter-kicker">${escHtml(getDiscoverCategoryFilterKickerText())}</div><h3>Filter</h3></div>
      ${renderDiscoverCategoryFilterCloseButton()}
    </div>
    <div class="discover-category-filter-rule"></div>
    <div class="discover-category-filter-list">${rows}</div>
    ${activeCount ? `<button class="discover-category-filter-clear-inline" type="button" onclick="clearDiscoverCategoryFilters()">Clear ${activeCount} filter${activeCount === 1 ? '' : 's'}</button>` : ''}
    ${renderDiscoverCategoryApplyFilterBar()}
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
      <button class="discover-category-filter-back" type="button" onclick="openDiscoverCategoryFilterPanel('main', 'back')" aria-label="Back">${getDiscoverCategoryBackChevronIconMarkup()}</button>
      <h3>${escHtml(group.pluralLabel || group.label)}</h3>
      ${renderDiscoverCategoryFilterCloseButton(`Close ${group.pluralLabel || group.label} filter`)}
    </div>
    <div class="discover-category-filter-rule"></div>
    <div class="discover-category-filter-list">${rows || '<div class="discover-category-filter-empty">No filters available.</div>'}</div>
    ${renderDiscoverCategoryApplyFilterBar()}
  </div>`;
}

function renderDiscoverCategoryYearFilterPanel(decadeStart = 2020) {
  const start = Number(decadeStart || 2020);
  const decade = DISCOVER_CATEGORY_DECADE_FILTERS.find(item => Number(item.start) === start) || DISCOVER_CATEGORY_DECADE_FILTERS[0];
  const selected = new Set(getDiscoverCategoryFilters().year || []);
  const years = DISCOVER_CATEGORY_YEAR_FILTERS.filter(item => item.decadeStart === decade.start);
  const availableYears = years.filter(item => !isDiscoverCategoryYearDisabled(item.year));
  const allAvailableSelected = availableYears.length > 0 && availableYears.every(item => selected.has(String(item.key)));
  const anyAvailableSelected = availableYears.some(item => selected.has(String(item.key)));
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
      <button class="discover-category-filter-back" type="button" onclick="openDiscoverCategoryFilterPanel('year', 'back')" aria-label="Back">${getDiscoverCategoryBackChevronIconMarkup()}</button>
      <h3>${escHtml(decade.label)}</h3>
      ${renderDiscoverCategoryFilterCloseButton(`Close ${decade.label} filter`)}
    </div>
    <div class="discover-category-filter-rule"></div>
    <div class="discover-category-filter-decade-actions">
      <button class="discover-category-filter-select-all${allAvailableSelected ? ' selected' : ''}" type="button" onclick="selectAllDiscoverCategoryDecadeYears('${escAttr(String(decade.start))}')">Select All</button>
      <button class="discover-category-filter-select-all discover-category-filter-deselect-all${anyAvailableSelected ? ' selected' : ''}" type="button" onclick="deselectAllDiscoverCategoryDecadeYears('${escAttr(String(decade.start))}')">Deselect All</button>
    </div>
    <div class="discover-category-filter-list">${rows}</div>
    ${renderDiscoverCategoryApplyFilterBar()}
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
      <div><div class="discover-category-filter-kicker">${escHtml(getDiscoverCategoryFilterKickerText())}</div><h3>Sort</h3></div>
      ${renderDiscoverCategoryFilterCloseButton('Close sort')}
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
        <button class="discover-category-full-back" type="button" onclick="closeDiscoverCategoryFullPage()" aria-label="Back">${getDiscoverCategoryBackChevronIconMarkup()}</button>
        <div class="discover-title discover-category-full-inline-title" id="discover-category-full-title">Discover</div>
        <button class="discover-category-filter-btn" id="discover-category-filter-btn" type="button" onclick="openDiscoverCategoryFilterSheet()" aria-label="Sort and filter this category" title="Sort and filter">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="M7 12h10"></path><path d="M10 17h4"></path></svg>
        </button>
      </div>
      <div class="discover-category-sort-row" id="discover-category-sort-row" aria-label="Sort category"></div>
      <div class="discover-category-sort-row discover-category-release-row" id="discover-category-release-row" aria-label="Release range"></div>
      <div class="discover-category-sort-row discover-category-country-row" id="discover-category-country-row" aria-label="Country new releases"></div>
      <div class="discover-grid discover-category-full-grid" id="discover-category-full-grid"><div class="discover-message">Loading...</div></div>
    </div>`;
  document.body.appendChild(page);
  bindDiscoverCategoryFullSwipeBack(page);
  return page;
}

function getDiscoverCategoryBackChevronIconMarkup() {
  return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 5.5 8.5 12l6 6.5"></path></svg>';
}

function isDiscoverCategoryFullFastTransitionGrid(gridId = '') {
  const id = String(gridId || '').trim();
  return /^discover-(movie|tv)-/.test(id) || /^games-discover-/.test(id);
}

function isDiscoverMovieOrTvCategoryFullCard(gridId = '', itemType = '') {
  return String(gridId || '').trim() === 'discover-category-full-grid'
    && (itemType === 'movie' || itemType === 'tv');
}

function shouldAlwaysShowDiscoverCategoryRatingStar(gridId = '') {
  const id = String(gridId || '').trim();
  return id === 'discover-category-full-grid'
    || /^discover-(movie|tv)-/.test(id);
}

function buildDiscoverCategoryRatingHtml(ratingText = '', options = {}) {
  const text = String(ratingText || '').trim();
  const alwaysShowStar = !!options.alwaysShowStar;
  if (!text && !alwaysShowStar) return '';
  return `<div class="dc-rating${text ? '' : ' dc-rating--empty'}"><span class="dc-rating-star" aria-hidden="true">★</span>${text}</div>`;
}

/* v11.118: left-edge swipe-back for the full "Show All" category page — same
   gesture feel as the media-profile back-swipe (bindDiscoverMediaProfileSwipeBack):
   48px left-edge hit zone, 14px engage (horizontal beats vertical ×1.35),
   commit at 34% width OR 58px + >0.75px/ms flick, dismiss
   cubic-bezier(0.18,0.92,0.18,1) / snap-back cubic-bezier(0.2,1,0.3,1), the page
   flies off to 105vw then closes after 230ms. Adapted selectors + close callback
   only; thresholds/easing/timings are identical per the canonical reference. */
function bindDiscoverCategoryFullSwipeBack(page) {
  if (!page || page.dataset.swipeBackBound === 'true') return;
  page.dataset.swipeBackBound = 'true';
  let startX = 0, startY = 0, lastX = 0, lastTime = 0, velocityX = 0;
  let viewportW = 0, canSwipeBack = false, armed = false, activePointerId = null, rafId = 0, pendingX = 0;

  const ignoreLegacyTouch = (e) => !!window.PointerEvent && String(e?.type || '').startsWith('touch');
  const renderFrame = () => { rafId = 0; page.style.transform = `translate3d(${pendingX}px, 0, 0)`; };
  const requestFrame = () => { if (!rafId) rafId = requestAnimationFrame(renderFrame); };
  const clearInlineStyles = () => {
    page.style.transition = '';
    page.style.transform = '';
    page.style.willChange = '';
    page.style.touchAction = '';
    page.style.boxShadow = '';
    page.style.borderTopLeftRadius = '';
    page.style.borderBottomLeftRadius = '';
  };
  const reset = () => {
    if (rafId) cancelAnimationFrame(rafId); rafId = 0;
    armed = false; canSwipeBack = false; activePointerId = null; pendingX = 0; velocityX = 0;
    clearInlineStyles();
  };
  const commitClose = () => {
    if (rafId) cancelAnimationFrame(rafId); rafId = 0;
    const closeMs = page.classList.contains('discover-category-full-page--360ms') ? 360 : 220;
    page.style.transition = `transform ${closeMs}ms cubic-bezier(0.18, 0.92, 0.18, 1), box-shadow ${closeMs}ms ease`;
    page.style.willChange = 'transform';
    page.style.transform = 'translate3d(105vw, 0, 0)';
    /* Leave it parked off-screen; the standard close hides it (display:none),
       and the next open resets the inline transform — avoids any snap-back flash. */
    window.setTimeout(() => { try { closeDiscoverCategoryFullPage(); } catch (_) {} }, Math.max(230, closeMs - 10));
  };
  const snapBack = () => {
    if (rafId) cancelAnimationFrame(rafId); rafId = 0;
    page.style.transition = 'transform 0.22s cubic-bezier(0.2, 1, 0.3, 1), box-shadow 0.22s ease';
    page.style.transform = 'translate3d(0, 0, 0)';
    page.style.boxShadow = '';
    page.style.borderTopLeftRadius = '';
    page.style.borderBottomLeftRadius = '';
    window.setTimeout(reset, 230);
  };

  const onDown = (e) => {
    if (ignoreLegacyTouch(e)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (typeof e.clientX !== 'number') return;
    startX = e.clientX; startY = e.clientY; lastX = startX; lastTime = performance.now(); velocityX = 0;
    viewportW = window.innerWidth || document.documentElement.clientWidth || 0;
    canSwipeBack = startX <= 48;
    armed = false;
    activePointerId = e.pointerId ?? null;
  };
  const onMove = (e) => {
    if (ignoreLegacyTouch(e) || !canSwipeBack) return;
    if (activePointerId !== null && e.pointerId !== undefined && e.pointerId !== activePointerId) return;
    const dx = e.clientX - startX, dy = e.clientY - startY, absDx = Math.abs(dx), absDy = Math.abs(dy);
    if (!armed) {
      if (dx > 14 && absDx > absDy * 1.35) {
        armed = true;
        page.style.transition = 'none';
        page.style.willChange = 'transform';
        page.style.touchAction = 'none';
        page.style.boxShadow = '-18px 0 42px rgba(0,0,0,0.28)';
        page.style.borderTopLeftRadius = '18px';
        page.style.borderBottomLeftRadius = '18px';
        try { page.setPointerCapture?.(e.pointerId); } catch (_) {}
      } else if (absDy > absDx * 1.15) { canSwipeBack = false; return; }
      else return;
    }
    const now = performance.now(); const dt = Math.max(1, now - lastTime);
    velocityX = (e.clientX - lastX) / dt; lastX = e.clientX; lastTime = now;
    if (e.cancelable) e.preventDefault();
    pendingX = Math.max(0, Math.min(viewportW, dx));
    requestFrame();
  };
  const onUp = (e) => {
    if (ignoreLegacyTouch(e)) return;
    if (!armed) { canSwipeBack = false; return; }
    const dx = (typeof e.clientX === 'number') ? (e.clientX - startX) : pendingX;
    canSwipeBack = false;
    try { if (activePointerId !== null) page.releasePointerCapture?.(activePointerId); } catch (_) {}
    activePointerId = null;
    const shouldClose = dx >= viewportW * 0.34 || (dx > 58 && velocityX > 0.75);
    if (shouldClose) commitClose(); else snapBack();
  };

  page.addEventListener('pointerdown', onDown, { passive: true });
  page.addEventListener('pointermove', onMove, { passive: false });
  page.addEventListener('pointerup', onUp, { passive: true });
  page.addEventListener('pointercancel', reset, { passive: true });
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
  markDiscoverCategoryFiltersPendingApply();
  refreshDiscoverCategoryFilterSheet('none');
  updateDiscoverCategoryFilterButtonState();
  updateDiscoverUniversalSearchFilterButtonState();
  if (isDiscoverSearchFilterApplyFlow()) return;
  await loadDiscoverFullFilteredItems(true);
  closeDiscoverCategoryFilterSheet();
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
  markDiscoverCategoryFiltersPendingApply();
  refreshDiscoverCategoryFilterSheet('none');
  updateDiscoverCategoryFilterButtonState();
  updateDiscoverUniversalSearchFilterButtonState();
  if (isDiscoverSearchFilterApplyFlow()) return;
  await loadDiscoverFullFilteredItems(true);
  closeDiscoverCategoryFilterSheet();
}

async function deselectAllDiscoverCategoryDecadeYears(decadeStart = 2020) {
  if (!discoverCategoryFullState) return;
  const start = Number(decadeStart || 0);
  const decade = DISCOVER_CATEGORY_DECADE_FILTERS.find(item => Number(item.start) === start);
  if (!decade) return;
  const filters = getDiscoverCategoryFilters();
  const removeKeys = new Set(DISCOVER_CATEGORY_YEAR_FILTERS
    .filter(item => item.decadeStart === decade.start && !isDiscoverCategoryYearDisabled(item.year))
    .map(item => String(item.key)));
  filters.year = (filters.year || []).filter(value => !removeKeys.has(String(value)));
  markDiscoverCategoryFiltersPendingApply();
  refreshDiscoverCategoryFilterSheet('none');
  updateDiscoverCategoryFilterButtonState();
  updateDiscoverUniversalSearchFilterButtonState();
  if (isDiscoverSearchFilterApplyFlow()) return;
  await loadDiscoverFullFilteredItems(true);
  closeDiscoverCategoryFilterSheet();
}

async function clearDiscoverCategoryFilters() {
  if (!discoverCategoryFullState) return;
  discoverCategoryFullState.filters = getEmptyDiscoverCategoryFilters();
  discoverCategoryFullState.overrideItems = null;
  discoverCategoryFullState.overrideRenderer = null;
  discoverCategoryFullState.overrideType = null;
  markDiscoverCategoryFiltersPendingApply();
  refreshDiscoverCategoryFilterSheet('none');
  updateDiscoverCategoryFilterButtonState();
  updateDiscoverUniversalSearchFilterButtonState();
  if (isDiscoverSearchFilterApplyFlow()) return;
  renderDiscoverCategoryFullGrid();
}

async function applyDiscoverCategoryFiltersFromSheet() {
  if (!discoverCategoryFullState) return;
  discoverCategoryFilterPendingApply = false;
  updateDiscoverCategoryFilterButtonState();
  updateDiscoverUniversalSearchFilterButtonState();
  /* v11.217: Add-to-Shelf (+) page reuses this filter sheet via a bucket with
     mode:'add-shelf'. Route apply to the add-shelf browse renderer. */
  if (discoverCategoryFullState.mode === 'add-shelf') {
    if (typeof window.applyAddShelfDiscoveryFilters === 'function') {
      await window.applyAddShelfDiscoveryFilters();
    }
    closeDiscoverCategoryFilterSheet();
    return;
  }
  if (discoverCategoryFullState.mode === 'shelfd-search') {
    closeDiscoverCategoryFilterSheet();
    if (typeof window.applyShelfdSearchDiscoveryFilters === 'function') {
      requestAnimationFrame(() => {
        try { window.applyShelfdSearchDiscoveryFilters(); } catch (error) { console.error('Shelfd search filter apply failed:', error); }
      });
    }
    return;
  }
  if (isDiscoverSearchFilterApplyFlow()) {
    await loadDiscoverUniversalSearchFilteredItems(true);
  } else {
    await loadDiscoverFullFilteredItems(true);
  }
  closeDiscoverCategoryFilterSheet();
}

function setDiscoverFullCategorySortFromSheet(sortKey = 'default') {
  setDiscoverCategorySort(sortKey);
  updateDiscoverCategoryFilterButtonState();
  updateDiscoverUniversalSearchFilterButtonState();
  closeDiscoverCategoryFilterSheet();
}

async function setDiscoverFullCategoryRangeFromSheet(range = 'week') {
  await setDiscoverFullNewReleaseRange(range);
  updateDiscoverCategoryFilterButtonState();
  updateDiscoverUniversalSearchFilterButtonState();
  closeDiscoverCategoryFilterSheet();
}

async function setDiscoverFullCategoryCountryFromSheet(code = '') {
  await setDiscoverNewReleaseCountry(code);
  updateDiscoverCategoryFilterButtonState();
  updateDiscoverUniversalSearchFilterButtonState();
  closeDiscoverCategoryFilterSheet();
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

const DISCOVER_JIKAN_GENRE_BY_TMDB_ID = {
  28: 1,      // Action
  12: 2,      // Adventure
  35: 4,      // Comedy
  18: 8,      // Drama
  14: 10,     // Fantasy
  27: 14,     // Horror
  10402: 19,  // Music
  9648: 7,    // Mystery
  10749: 22,  // Romance
  878: 24     // Sci-Fi
};

function getDiscoverAnimeSelectedJikanGenreIds() {
  return (getDiscoverCategoryFilters().genre || [])
    .map(value => findDiscoverCategoryFilterItem('genre', value))
    .filter(item => item && !item.contentType)
    .map(item => {
      const id = Number(item.id || 0);
      if (id === 16) return 0; // Animation is implied for anime.
      return DISCOVER_JIKAN_GENRE_BY_TMDB_ID[id] || 0;
    })
    .filter(Boolean);
}

function hasUnsupportedDiscoverAnimeGenreFilter() {
  return (getDiscoverCategoryFilters().genre || [])
    .map(value => findDiscoverCategoryFilterItem('genre', value))
    .filter(item => item && !item.contentType)
    .some(item => {
      const id = Number(item.id || 0);
      return id !== 16 && !DISCOVER_JIKAN_GENRE_BY_TMDB_ID[id];
    });
}

function getDiscoverAnimeSelectedJikanTypes() {
  const selectedTypes = (getDiscoverCategoryFilters().genre || [])
    .map(value => findDiscoverCategoryFilterItem('genre', value))
    .filter(item => item?.contentType)
    .map(item => item.contentType);
  if (selectedTypes.includes('movie') && !selectedTypes.includes('tv')) return ['movie'];
  if (selectedTypes.includes('tv') && !selectedTypes.includes('movie')) return ['tv'];
  return ['tv'];
}

function getDiscoverAnimeYearFilters() {
  const filters = getDiscoverCategoryFilters();
  return (filters.year || [])
    .map(value => DISCOVER_CATEGORY_YEAR_FILTERS.find(item => String(item.key) === String(value))
      || DISCOVER_CATEGORY_DECADE_FILTERS.find(item => String(item.key) === String(value)))
    .filter(item => item && !isDiscoverCategoryYearDisabled(Number(item.year || item.start || 0)));
}

function shouldDiscoverAnimeFiltersReturnEmpty() {
  const filters = getDiscoverCategoryFilters();
  const countries = (filters.country || []).map(value => String(value || '').trim().toUpperCase()).filter(Boolean);
  const languages = (filters.language || []).map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
  const services = (filters.service || []).map(value => String(value || '').trim()).filter(Boolean);
  if (countries.length && !countries.includes('JP')) return true;
  if (languages.length && !languages.includes('ja')) return true;
  if (services.length) return true; // Jikan does not expose streaming-provider availability.
  return hasUnsupportedDiscoverAnimeGenreFilter();
}

async function fetchDiscoverFilteredAnimeItemsFromJikan(query = '', options = {}) {
  const J = window.JikanAnime;
  if (!J?.request || !J?.mapItem) return [];
  if (shouldDiscoverAnimeFiltersReturnEmpty()) return [];

  const pageCount = Math.max(1, Number(options.pageCount || 1) || 1);
  const maxResults = Math.max(1, Number(options.maxResults || DISCOVER_CATEGORY_FILTER_LIMIT) || DISCOVER_CATEGORY_FILTER_LIMIT);
  const q = String(query || '').trim();
  const genreIds = getDiscoverAnimeSelectedJikanGenreIds();
  const yearFilters = getDiscoverAnimeYearFilters();
  const yearRequests = yearFilters.length ? yearFilters : [null];
  const types = getDiscoverAnimeSelectedJikanTypes();
  const requestGroups = [];

  types.forEach(type => {
    yearRequests.forEach(yearFilter => {
      for (let page = 1; page <= pageCount; page += 1) {
        const params = {
          sfw: true,
          limit: 25,
          page,
          type,
          order_by: 'members',
          sort: 'desc',
          ...(q ? { q } : {}),
          ...(genreIds.length ? { genres: Array.from(new Set(genreIds)).join(',') } : {})
        };
        if (yearFilter) {
          const start = Number(yearFilter.year || yearFilter.start || yearFilter.key || 0);
          const end = Number(yearFilter.end || start);
          if (start) {
            params.start_date = `${start}-01-01`;
            params.end_date = `${end || start}-12-31`;
          }
        }
        requestGroups.push(
          J.request('anime', params)
            .then(json => Array.isArray(json?.data) ? json.data : [])
            .catch(error => {
              console.warn('[Jikan] filtered anime request failed:', params, error);
              return [];
            })
        );
      }
    });
  });

  const raw = (await Promise.all(requestGroups)).flat();
  const seen = new Set();
  const mapped = raw
    .map(J.mapItem)
    .filter(Boolean)
    .filter(item => {
      const key = String(item.__mal_id || item.malId || item.id || '');
      if (!key || seen.has(key) || !item.poster_path) return false;
      seen.add(key);
      return true;
    });

  return mapped
    .sort((a, b) => {
      const membersA = Number(a.__jikanRaw?.members || 0);
      const membersB = Number(b.__jikanRaw?.members || 0);
      if (membersB !== membersA) return membersB - membersA;
      const scoreA = Number(a.__jikanRaw?.score || a.vote_average || 0);
      const scoreB = Number(b.__jikanRaw?.score || b.vote_average || 0);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return String(a.name || a.title || '').localeCompare(String(b.name || b.title || ''));
    })
    .slice(0, maxResults);
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
  const year = String(getDiscoverReleaseDate(item) || '').slice(0, 4);
  const ratingText = typeof window.formatDisplayTitleRating === 'function'
    ? window.formatDisplayTitleRating(item)
    : (Number(item.imdbRating || 0) > 0 ? (Number(item.imdbRating) / 2).toFixed(1) : '');
  const imdbVotes = Number(item.imdbVotes || 0);
  return [year, ratingText ? `${ratingText}/5` : '', imdbVotes ? `${imdbVotes.toLocaleString()} votes` : '']
    .filter(Boolean)
    .join(' · ');
}

async function fetchDiscoverFilteredMediaItems(query = '', options = {}) {
  if (!discoverCategoryFullState) return [];
  const baseScope = getDiscoverCategoryMediaScope(discoverCategoryFullState.gridId);
  if (!baseScope) return [];
  if (baseScope === 'anime') return fetchDiscoverFilteredAnimeItemsFromJikan(query, options);
  const pageCount = Math.max(1, Number(options.pageCount || DISCOVER_CATEGORY_FILTER_PAGE_COUNT) || DISCOVER_CATEGORY_FILTER_PAGE_COUNT);
  const maxResults = Math.max(1, Number(options.maxResults || DISCOVER_CATEGORY_FILTER_LIMIT) || DISCOVER_CATEGORY_FILTER_LIMIT);
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
        fetchTmdbPages(path, params, pageCount)
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
    .filter(item => isAnimeDiscoverCandidate(item) === (baseScope === 'anime'));
  await window.enrichItemsWithImdbRatings?.(candidates, baseScope);
  /* v673: full-grid filtered view uses the 'popular' formula by default. */
  const ranked = (window.rankDiscoverTitles || (() => candidates))('popular', candidates, {
    mediaType: baseScope === 'anime' ? 'anime' : (mediaTypes[0] || 'tv')
  });
  return ranked
    .map(item => ({
      ...item,
      discoverContext: getDiscoverFilteredContextLine(item)
    }))
    .slice(0, maxResults);
}

window.fetchDiscoverFilteredMediaItems = fetchDiscoverFilteredMediaItems;

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

async function loadDiscoverFullPresetItemsForGrid(gridId = '', force = false) {
  if (!discoverCategoryFullState) return false;
  const fullLimit = DISCOVER_CATEGORY_FULL_VISIBLE_LIMIT;
  const presetFetchers = {
    'discover-movie-trending-grid': () => fetchTmdbWeeklyTrendingMedia('movie', { limit: fullLimit }),
    'discover-tv-trending-grid': () => fetchTmdbWeeklyTrendingMedia('tv', { limit: fullLimit }),
    'discover-movie-popular-grid': () => fetchDiscoverPopularMedia('movie', { limit: fullLimit }),
    'discover-tv-popular-grid': () => fetchDiscoverPopularMedia('tv', { limit: fullLimit })
  };
  const fetcher = presetFetchers[gridId];
  if (!fetcher) return false;
  const cacheKey = `media:full-view-all:${gridId}:${DISCOVER_RANKING_CACHE_VERSION}:${fullLimit}`;
  try {
    const items = await loadDiscoverCachedData(cacheKey, fetcher, force);
    discoverCategoryFullState.overrideItems = Array.isArray(items) ? items : [];
    discoverCategoryFullState.overrideRenderer = 'ranked';
    discoverCategoryFullState.overrideType = gridId.startsWith('discover-movie-') ? 'movie' : 'tv';
    return true;
  } catch (error) {
    console.warn('Discover full preset refresh failed; using row cache:', gridId, error);
    return false;
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
  const items = sortDiscoverFullPageItems(sourceItems, discoverCategoryFullState.sortKey, discoverCategoryFullState.gridId).slice(0, DISCOVER_CATEGORY_FULL_VISIBLE_LIMIT);
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
  /* v11.118: clear any leftover swipe-back inline transform so a page parked
     off-screen from a prior swipe-dismiss opens cleanly. */
  page.style.transition = '';
  page.style.transform = '';
  page.style.willChange = '';
  page.style.boxShadow = '';
  page.style.borderTopLeftRadius = '';
  page.style.borderBottomLeftRadius = '';
  /* v11.849: the category page element is REUSED across opens (hidden, never
     removed). Any inline scroll-blocker left behind by an interrupted swipe-back
     or competing gesture (overflow:hidden / touch-action:none / pointer-events)
     persists and silently freezes scrolling until a full reload — the reported
     "category page won't scroll, and reopening doesn't fix it" bug. So FORCE the
     scrollable defaults on every open, overriding whatever got stuck. */
  try {
    const csBefore = getComputedStyle(page);
    if (csBefore.overflowY === 'hidden' || csBefore.touchAction === 'none'
        || page.style.overflow === 'hidden' || csBefore.pointerEvents === 'none') {
      const frozen = {
        inlineOverflow: page.style.overflow || '(none)',
        inlineTouchAction: page.style.touchAction || '(none)',
        computedOverflowY: csBefore.overflowY,
        computedTouchAction: csBefore.touchAction,
        computedPointerEvents: csBefore.pointerEvents,
        ts: Date.now()
      };
      window.__shelfdDiscoverScrollFreeze = frozen;
      console.warn('[shelfd] Discover category page opened in a non-scrollable state — clearing stuck lock:', frozen);
    }
  } catch (_) {}
  page.style.overflow = '';
  page.style.overflowY = 'auto';
  page.style.touchAction = '';
  page.style.pointerEvents = '';
  page.style.removeProperty('overscroll-behavior');
  /* v11.117: hide the top-right sort/filter button on the Movies & TV show-all
     pages per request (anime/games keep it). The page element is reused across
     opens, so set this every open. Markup is left intact for easy restore. */
  const isMovieOrTvGrid = /^discover-(movie|tv)-/.test(gridId);
  const useFastTransition = isDiscoverCategoryFullFastTransitionGrid(gridId);
  const filterBtn = document.getElementById('discover-category-filter-btn');
  if (filterBtn) filterBtn.style.display = isMovieOrTvGrid ? 'none' : '';
  page.classList.toggle('discover-category-full-page--360ms', useFastTransition);
  const title = getDiscoverCategoryTitleText(gridId);
  const titleEl = document.getElementById('discover-category-full-title');
  const grid = document.getElementById('discover-category-full-grid');
  page.dataset.returnScrollY = String(window.scrollY || window.pageYOffset || 0);
  /* Slide in from the right like a normal iOS forward page, then add .is-open
     after two rAFs so the scoped transform transition fires cleanly. */
  page.classList.remove('is-open');
  page.style.display = 'block';
  requestAnimationFrame(() => requestAnimationFrame(() => page.classList.add('is-open')));
  if (window.history?.pushState && !window.history.state?.screenListDiscoverCategory) {
    window.history.pushState({ screenListDiscoverCategory: gridId }, '', window.location.href);
    discoverCategoryFullHistoryActive = true;
  }
  page.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  if (titleEl) titleEl.textContent = title;
  if (grid) grid.innerHTML = '<div class="discover-message">Loading category...</div>';
  discoverCategoryFullState = { gridId, sortKey: getDiscoverFullPageDefaultSort(gridId), newReleaseCountryCode: '', newReleaseRange: discoverNewReleaseRange, filters: getEmptyDiscoverCategoryFilters(), overrideItems: null, overrideRenderer: null, overrideType: null };
  renderDiscoverCategorySortControls();
	  try {
	    const stored = await ensureDiscoverCategoryData(gridId);
	    if (!stored?.items?.length) throw new Error('No category data loaded');
	    await loadDiscoverFullPresetItemsForGrid(gridId, false);
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
  const closeDelayMs = page?.classList.contains('discover-category-full-page--360ms') ? 380 : 580;
  /* Removing .is-open slides the page back out to the right. */
  if (page) {
    page.classList.remove('is-open');
    setTimeout(() => { if (page) page.style.display = 'none'; }, closeDelayMs);
  }
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
  const hideAddButton = shouldHideDiscoverViewAllAddButton(resolvedGridId);
  const alwaysShowRatingStar = shouldAlwaysShowDiscoverCategoryRatingStar(resolvedGridId);
  grid.dataset.expanded = 'false';
  delete grid.dataset.visibleCount;
  grid.innerHTML = items.map(item => {
    const itemType = type === 'mixed' ? (item.media_type || 'movie') : type;
    const isMovieOrTvFullPage = isDiscoverMovieOrTvCategoryFullCard(resolvedGridId, itemType);
    const title = item.title || item.name || '';
    const displayGenreLine = getDiscoverGenreNames(item, itemType).slice(0, 2).join(' · ');
    /* v654: getTmdbImageUrl handles full https URLs (Jikan-sourced) and TMDB paths. */
    const poster = getDiscoverTitleCardPosterUrl(item, itemType, resolvedGridId);
    const overview = item.overview || '';
    const section = itemType === 'movie' ? 'movies' : 'shows';
    const alreadyAdded = isDuplicateTitle(title, section);
    const titleAttr = escAttr(title);
    const addClick = `openDiscoveryAddModal('${itemType}', ${item.id}, this)`;
    const removeClick = `removeDiscoveryTitle(this)`;
	    const displayRating = typeof window.formatDisplayTitleRating === 'function'
	      ? window.formatDisplayTitleRating(item)
	      : (Number(item.imdbRating || 0) > 0 ? (Number(item.imdbRating) / 2).toFixed(1) : '');
	    const openProfileClick = hideAddButton
	      ? `openDiscoverViewAllMediaProfile(event, '${itemType}', ${item.id}, this)`
	      : `openDiscoverMediaProfile(event, '${itemType}', ${item.id})`;
	    const bodyClick = hideAddButton
	      ? openProfileClick
	      : 'handleDiscoverCardBodyTap(event, this)';
    /* v568: rating first, then title, then genre, then date (date-grids only) */
    const ratingHtml = displayRating
      ? `<div class="dc-rating"><span class="dc-rating-star" aria-hidden="true">★</span>${displayRating}</div>`
      : '';
    const releaseLine = isMovieOrTvFullPage
      ? getDiscoverCardReleaseLine(item)
      : (showDateLine ? getDiscoverCardReleaseLine(item) : '');
    const categoryRatingHtml = buildDiscoverCategoryRatingHtml(displayRating, { alwaysShowStar: alwaysShowRatingStar });
    setDiscoverMediaProfileSeed(itemType, item.id, {
      title, name: title, overview, poster,
      poster_path: item.poster_path || '',
      backdrop_path: item.backdrop_path || '',
      release_date: item.release_date || '',
      first_air_date: item.first_air_date || '',
      vote_average: item.vote_average || '',
      vote_count: item.vote_count || '',
      genreNames: getDiscoverGenreNames(item, itemType),
      /* v654: forward Jikan markers so profile-open routes correctly. */
      __jikan: !!item.__jikan,
      __mal_id: item.__mal_id || 0
    });
    return `<div class="discover-card" data-media-type="${itemType}">
      <div class="discover-poster" data-poster="${escAttr(poster)}" data-media-type="${itemType}" data-media-id="${item.id}" data-discover-title="${titleAttr}" data-discover-section="${section}" data-hovering="0" data-pinned="0" data-long-press-triggered="0" onclick="handleDiscoverPosterClick(event, this, '${itemType}', ${item.id})" onpointerdown="startDiscoverPosterPress(event, this, '${itemType}', ${item.id})" onpointermove="moveDiscoverPosterPress(event)" onpointerup="stopDiscoverPosterPress()" onpointercancel="clearDiscoverCardPressTimer()" onpointerleave="clearDiscoverCardPressTimer()">
        ${buildDiscoverPosterMarkup(poster)}${getDiscoverExpandIconMarkup({ dataset: { mediaType: itemType, mediaId: String(item.id) } })}${getDiscoverPosterTooltipMarkup()}${getDiscoverFriendStackMarkup(title, section)}
      </div>
	      <div class="discover-card-body" onclick="${bodyClick}">
        <div class="discover-card-info-row">
          <div class="discover-card-info-stack">
            ${categoryRatingHtml || ratingHtml}
            <button class="discover-card-title discover-title-profile-btn" type="button" onclick="${openProfileClick}">${escHtml(title)}</button>
            ${displayGenreLine ? `<div class="discover-card-genre">${escHtml(displayGenreLine)}</div>` : ''}
            ${releaseLine ? `<div class="dc-release-line">${escHtml(releaseLine)}</div>` : ''}
          </div>
          <button class="discover-close-btn" type="button" onclick="handleDiscoverCloseClick(event, this)">Close</button>
        </div>
        ${hideAddButton ? '' : `<button class="discover-add-btn${alreadyAdded ? ' added' : ''}" data-discover-type="${itemType}" data-discover-id="${item.id}" data-discover-section="${section}" data-discover-title="${titleAttr}" title="${alreadyAdded ? 'Click to remove from your library' : ''}" onclick="${alreadyAdded ? removeClick : addClick}">${alreadyAdded ? getDiscoverLibraryButtonText(title, section) : '+ Add to Library'}</button>`}
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

  const hideAddButton = shouldHideDiscoverViewAllAddButton(gridId);
  const alwaysShowRatingStar = shouldAlwaysShowDiscoverCategoryRatingStar(gridId);
  grid.dataset.expanded = 'false';
  delete grid.dataset.visibleCount;
  grid.innerHTML = items.map((item, index) => {
    const rank = index + 1;
    const itemType = item.media_type || type;
    const isMovieOrTvFullPage = isDiscoverMovieOrTvCategoryFullCard(gridId, itemType);
    const title = item.title || item.name || '';
    const year = (item.release_date || item.first_air_date || '').slice(0, 4);
    const genreLine = getDiscoverGenreNames(item, itemType).slice(0, 2).join(' · ');
    const releaseLine = getDiscoverCardReleaseLine(item);
    const displayRating = typeof window.formatDisplayTitleRating === 'function'
      ? window.formatDisplayTitleRating(item)
      : (Number(item.imdbRating || 0) > 0 ? (Number(item.imdbRating) / 2).toFixed(1) : '');
    const ratingHtml = displayRating
      ? `<div class="dc-rating"><span class="dc-rating-star" aria-hidden="true">★</span>${displayRating}</div>`
      : '';
    const categoryRatingHtml = buildDiscoverCategoryRatingHtml(displayRating, { alwaysShowStar: alwaysShowRatingStar });
    /* v654: getTmdbImageUrl handles full https URLs (Jikan-sourced) and TMDB paths. */
    const poster = getDiscoverTitleCardPosterUrl(item, itemType, gridId);
    const overview = item.overview || '';
    const section = itemType === 'movie' ? 'movies' : 'shows';
    const alreadyAdded = isDuplicateTitle(title, section);
	    const titleAttr = escAttr(title);
	    const addClick = `openDiscoveryAddModal('${itemType}', ${item.id}, this)`;
	    const removeClick = `removeDiscoveryTitle(this)`;
	    const openProfileClick = hideAddButton
	      ? `openDiscoverViewAllMediaProfile(event, '${itemType}', ${item.id}, this)`
	      : `openDiscoverMediaProfile(event, '${itemType}', ${item.id})`;
	    const bodyClick = hideAddButton ? openProfileClick : '';

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
	      <div class="discover-card-body discover-country-card-body"${bodyClick ? ` onclick="${bodyClick}"` : ''}>
        ${isMovieOrTvFullPage ? `<div class="discover-card-info-stack">
            ${categoryRatingHtml || ratingHtml}
          <button class="discover-card-title discover-title-profile-btn discover-country-title" type="button" onclick="${openProfileClick}">${escHtml(title)}</button>
          ${genreLine ? `<div class="discover-card-genre">${escHtml(genreLine)}</div>` : ''}
          ${releaseLine ? `<div class="dc-release-line">${escHtml(releaseLine)}</div>` : ''}
        </div>` : `<button class="discover-card-title discover-title-profile-btn discover-country-title" type="button" onclick="${openProfileClick}">${escHtml(title)}${year ? ` (${year})` : ''}</button>`}
        ${hideAddButton ? '' : `<button class="discover-add-btn${alreadyAdded ? ' added' : ''}" data-discover-type="${itemType}" data-discover-id="${item.id}" data-discover-section="${section}" data-discover-title="${titleAttr}" title="${alreadyAdded ? 'Click to remove from your library' : ''}" onclick="${alreadyAdded ? removeClick : addClick}">${alreadyAdded ? getDiscoverLibraryButtonText(title, section) : '+ Add to Library'}</button>`}
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

  /* v743: Trending + Popular cap at 12 titles with no show-more option.
     Hide the section's expand button. Other categories keep show-more. */
  const NO_EXPAND_GRIDS = new Set([
    'discover-movie-trending-grid',
    'discover-tv-trending-grid',
    'discover-movie-popular-grid',
    'discover-tv-popular-grid'
  ]);
  if (NO_EXPAND_GRIDS.has(gridId)) {
    const expandBtn = getDiscoverExpandButton(grid);
    if (expandBtn) expandBtn.style.display = 'none';
  }

  if (!items.length) {
    grid.innerHTML = '<div class="discover-message">No titles found for this category.</div>';
    return;
  }

  const sourceGridId = gridId === 'discover-category-full-grid' ? (discoverCategoryFullState?.gridId || grid?.dataset?.sourceGridId || gridId) : gridId;
  const isNewReleaseGrid = isDiscoverGridNewRelease(sourceGridId);
  const isDateOnlyGrid = isNewReleaseGrid || isDiscoverGridUpcoming(sourceGridId);
  const hideAddButton = shouldHideDiscoverViewAllAddButton(gridId);
  const alwaysShowRatingStar = shouldAlwaysShowDiscoverCategoryRatingStar(gridId);
  grid.dataset.expanded = 'false';
  delete grid.dataset.visibleCount;
  grid.innerHTML = items.map((item, index) => {
    const rank = index + 1;
    const rankHtml = isDateOnlyGrid ? '' : `<div class="discover-rank">#${rank}</div>`;
    const itemType = item.media_type || type;
    const isMovieOrTvFullPage = isDiscoverMovieOrTvCategoryFullCard(gridId, itemType);
    const title = item.title || item.name || '';
    const year = (item.release_date || item.first_air_date || '').slice(0, 4);
    const genreLine = isNewReleaseGrid ? '' : getDiscoverGenreNames(item, itemType).slice(0, 2).join(' · ');
    const displayGenreLine = isMovieOrTvFullPage
      ? getDiscoverGenreNames(item, itemType).slice(0, 2).join(' · ')
      : genreLine;
    /* v654: getTmdbImageUrl handles full https URLs (Jikan-sourced) and TMDB paths. */
    const poster = getDiscoverTitleCardPosterUrl(item, itemType, gridId);
    const overview = item.overview || '';
    const section = itemType === 'movie' ? 'movies' : 'shows';
    const releaseLine = formatDiscoverReleaseCardDate(getDiscoverReleaseDate(item));
    const alreadyAdded = isDuplicateTitle(title, section);
    const titleAttr = escAttr(title);
    const addClick = `openDiscoveryAddModal('${itemType}', ${item.id}, this)`;
    const removeClick = `removeDiscoveryTitle(this)`;
	    const cardClass = isNewReleaseGrid ? 'discover-card discover-new-release-card' : 'discover-card';
	    const openProfileClick = hideAddButton
	      ? `openDiscoverViewAllMediaProfile(event, '${itemType}', ${item.id}, this)`
	      : `openDiscoverMediaProfile(event, '${itemType}', ${item.id})`;
	    const bodyClick = hideAddButton
	      ? openProfileClick
	      : 'handleDiscoverCardBodyTap(event, this)';
    const metaHtml = isNewReleaseGrid
      ? `<div class="discover-card-meta discover-new-release-date">Released: ${escHtml(releaseLine || formatDiscoverReleaseDate(getDiscoverReleaseDate(item)))}</div>`
      : '';
    const cardRating = typeof window.formatDisplayTitleRating === 'function'
      ? window.formatDisplayTitleRating(item)
      : (Number(item.imdbRating || 0) > 0 ? (Number(item.imdbRating) / 2).toFixed(1) : '');
    /* v568: rating line first, then title, then genre, date only for new-release / upcoming grids */
    const ratingHtmlRanked = cardRating
      ? `<div class="dc-rating"><span class="dc-rating-star" aria-hidden="true">★</span>${cardRating}</div>`
      : '';
    const cardReleaseLine = isMovieOrTvFullPage
      ? getDiscoverCardReleaseLine(item)
      : (isDateOnlyGrid ? getDiscoverCardReleaseLine(item) : '');
    const categoryRatingHtml = buildDiscoverCategoryRatingHtml(cardRating, { alwaysShowStar: alwaysShowRatingStar });

    setDiscoverMediaProfileSeed(itemType, item.id, {
      title, name: title, overview, poster,
      poster_path: item.poster_path || '',
      backdrop_path: item.backdrop_path || '',
      release_date: item.release_date || '',
      first_air_date: item.first_air_date || '',
      vote_average: item.vote_average || '',
      vote_count: item.vote_count || '',
      genreNames: getDiscoverGenreNames(item, itemType),
      /* v654: forward Jikan markers so profile-open routes correctly. */
      __jikan: !!item.__jikan,
      __mal_id: item.__mal_id || 0
    });

    return `<div class="${cardClass}" data-media-type="${itemType}">
      ${rankHtml}
      <div class="discover-poster" data-poster="${escAttr(poster)}" data-media-type="${itemType}" data-media-id="${item.id}" data-discover-title="${titleAttr}" data-discover-section="${section}" data-hovering="0" data-pinned="0" data-long-press-triggered="0" onclick="handleDiscoverPosterClick(event, this, '${itemType}', ${item.id})" onpointerdown="startDiscoverPosterPress(event, this, '${itemType}', ${item.id})" onpointermove="moveDiscoverPosterPress(event)" onpointerup="stopDiscoverPosterPress()" onpointercancel="clearDiscoverCardPressTimer()" onpointerleave="clearDiscoverCardPressTimer()">
        ${buildDiscoverPosterMarkup(poster)}${getDiscoverExpandIconMarkup({ dataset: { mediaType: itemType, mediaId: String(item.id) } })}${getDiscoverPosterTooltipMarkup()}${getDiscoverFriendStackMarkup(title, section)}
      </div>
	      <div class="discover-card-body" onclick="${bodyClick}">
        <div class="discover-card-info-row">
          <div class="discover-card-info-stack">
            ${categoryRatingHtml || ratingHtmlRanked}
            <button class="discover-card-title discover-title-profile-btn" type="button" onclick="${openProfileClick}">${escHtml(title)}</button>
            ${displayGenreLine ? `<div class="discover-card-genre">${escHtml(displayGenreLine)}</div>` : ''}
            ${cardReleaseLine ? `<div class="dc-release-line">${escHtml(cardReleaseLine)}</div>` : ''}
          </div>
          <button class="discover-close-btn" type="button" onclick="handleDiscoverCloseClick(event, this)">Close</button>
        </div>
        ${hideAddButton ? '' : `<button class="discover-add-btn${alreadyAdded ? ' added' : ''}" data-discover-type="${itemType}" data-discover-id="${item.id}" data-discover-section="${section}" data-discover-title="${titleAttr}" title="${alreadyAdded ? 'Click to remove from your library' : ''}" onclick="${alreadyAdded ? removeClick : addClick}">${alreadyAdded ? getDiscoverLibraryButtonText(title, section) : '+ Add to Library'}</button>`}
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
    syncDiscoverFriendsWatchingDesktopArrow(grid);
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

  if (gridId === 'discover-friends-watching-grid' && options.row) {
    bindDiscoverFriendsWatchingDesktopScroll(grid);
  }

  requestAnimationFrame(() => {
    if (!options.skipLimit && !options.row && !options.fullPage) setupDiscoverSectionLimit(grid);
    if (gridId === 'discover-friends-watching-grid' && options.row) {
      syncDiscoverFriendsWatchingDesktopArrow(grid);
    }
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

function isDesktopBrowserDiscoverSurface() {
  return !!window.matchMedia?.('(min-width: 701px) and (hover: hover) and (pointer: fine) and (not (display-mode: standalone))')?.matches;
}

function syncDiscoverFriendsWatchingDesktopArrow(grid) {
  const nextBtn = document.getElementById('discover-friends-watching-next');
  if (!grid || !nextBtn) return;
  const canAdvance = isDesktopBrowserDiscoverSurface()
    && grid.scrollWidth > grid.clientWidth + 12
    && grid.scrollLeft < (grid.scrollWidth - grid.clientWidth - 12);
  nextBtn.hidden = !canAdvance;
  nextBtn.disabled = !canAdvance;
}

function bindDiscoverFriendsWatchingDesktopScroll(grid) {
  if (!grid) return;
  if (grid.dataset.desktopArrowBound === '1') {
    syncDiscoverFriendsWatchingDesktopArrow(grid);
    return;
  }
  grid.dataset.desktopArrowBound = '1';
  grid.addEventListener('scroll', () => syncDiscoverFriendsWatchingDesktopArrow(grid), { passive: true });
  grid.addEventListener('wheel', event => {
    if (!isDesktopBrowserDiscoverSurface()) return;
    if (grid.scrollWidth <= grid.clientWidth + 12) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    grid.scrollLeft += event.deltaY;
  }, { passive: false });
  if (!window.__discoverFriendsWatchingResizeBound) {
    window.__discoverFriendsWatchingResizeBound = true;
    window.addEventListener('resize', () => {
      const currentGrid = document.getElementById('discover-friends-watching-grid');
      if (currentGrid) syncDiscoverFriendsWatchingDesktopArrow(currentGrid);
    });
  }
  syncDiscoverFriendsWatchingDesktopArrow(grid);
}

function scrollDiscoverFriendsWatchingRow(direction = 1) {
  const grid = document.getElementById('discover-friends-watching-grid');
  if (!grid) return;
  const step = Math.max(260, Math.round(grid.clientWidth * 0.76)) * (Number(direction) < 0 ? -1 : 1);
  grid.scrollBy({ left: step, behavior: 'smooth' });
  window.setTimeout(() => syncDiscoverFriendsWatchingDesktopArrow(grid), 220);
}
window.scrollDiscoverFriendsWatchingRow = scrollDiscoverFriendsWatchingRow;

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
        <div class="discover-subtitle">Shows &amp; anime your friends are actively watching · movies they recently finished.</div>
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
    const items = await fetchFriendWatchingDiscoverTitles(30);
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

/* =========================================================================
   v699: Steam review data for Discover > Games cards (Row 4).

   Root-cause fix: RAWG's /games list endpoint returns stores[].store.id
   but does NOT include stores[].url (the actual store page URL). The Steam
   App ID therefore cannot be extracted from the list item alone.

   Two-step lazy resolution per card:
     1. GET /api/rawg/games/{rawgId}/stores  →  stores[].url  →  Steam App ID
     2. GET /api/steam/appreviews/{steamId}  →  query_summary →  review text

   Both calls are cached in-memory for 24 h so revisiting the page or
   expanding a grid doesn't re-fetch.
   ========================================================================= */
const _steamRevCache    = new Map();  /* steamAppId → { text, ts } */
const _rawgStoreCache   = new Map();  /* rawgId     → steamAppId (or '') */
const _steamRevFetching = new Set();
const _rawgStoreFetching= new Set();
const _STEAM_REV_TTL    = 86_400_000; /* 24 h */

function _fmtReviewCount(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `${+(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000)     return `${Math.round(v / 1_000)}K`;
  return String(v);
}

/** Fetch Steam App ID for a RAWG game via /games/{id}/stores endpoint. */
async function _resolveRawgSteamId(rawgId) {
  const id = String(rawgId || '').trim();
  if (!id) return '';
  if (_rawgStoreCache.has(id)) return _rawgStoreCache.get(id);
  if (_rawgStoreFetching.has(id)) return '';
  _rawgStoreFetching.add(id);
  try {
    const res  = await fetch(`/api/rawg/games/${encodeURIComponent(id)}/stores`);
    if (!res.ok) { _rawgStoreFetching.delete(id); return ''; }
    const data = await res.json();
    const results = Array.isArray(data.results) ? data.results : [];
    /* store_id 1 = Steam in RAWG's taxonomy. */
    const steamEntry = results.find(r => r.store_id === 1);
    const url   = String(steamEntry?.url || '');
    const match = url.match(/\/app\/(\d+)/);
    const steamId = match ? match[1] : '';
    _rawgStoreCache.set(id, steamId);
    _rawgStoreFetching.delete(id);
    return steamId;
  } catch (_) {
    _rawgStoreFetching.delete(id);
    return '';
  }
}

/** Fetch Steam review summary. */
async function _fetchSteamReview(steamId) {
  const id = String(steamId || '').trim();
  if (!id || !/^\d+$/.test(id)) return null;
  const cached = _steamRevCache.get(id);
  if (cached && Date.now() - cached.ts < _STEAM_REV_TTL) return cached;
  if (_steamRevFetching.has(id)) return null;
  _steamRevFetching.add(id);
  try {
    const res  = await fetch(`/api/steam/appreviews/${encodeURIComponent(id)}`);
    if (!res.ok) { _steamRevFetching.delete(id); return null; }
    const data = await res.json();
    const qs   = data?.query_summary;
    if (!qs) { _steamRevFetching.delete(id); return null; }
    const pos   = Number(qs.total_positive || 0);
    const neg   = Number(qs.total_negative || 0);
    const total = Number(qs.total_reviews  || 0) || (pos + neg);
    if (!total) { _steamRevFetching.delete(id); return null; }
    const pct  = Math.round((pos / total) * 100);
    const desc = String(qs.review_score_desc || '').trim();
    if (!desc) { _steamRevFetching.delete(id); return null; }
    const result = {
      text: `${desc} · ${pct}% · ${_fmtReviewCount(total)} reviews`,
      ts: Date.now()
    };
    _steamRevCache.set(id, result);
    _steamRevFetching.delete(id);
    return result;
  } catch (_) {
    _steamRevFetching.delete(id);
    return null;
  }
}

function _backfillSteamReviews(grid, items) {
  if (!grid || !Array.isArray(items)) return;
  items.forEach((item, idx) => {
    /* Stagger 180 ms per card — two async calls each (RAWG stores + Steam reviews),
       so slightly more generous spacing than the old single-call version. */
    setTimeout(async () => {
      const rawgId  = String(item?.id || '');
      if (!rawgId) return;
      const steamId = await _resolveRawgSteamId(rawgId);
      if (!steamId) return;
      const rev = await _fetchSteamReview(steamId);
      if (!rev) return;
      const poster = grid.querySelector(`.discover-poster[data-rawg-id="${CSS.escape(rawgId)}"]`);
      const card   = poster?.closest('.games-discover-card');
      const el     = card?.querySelector('.games-dc-rating');
      if (!el) return;
      el.textContent = rev.text;
      el.classList.add('games-dc-rating--live');
    }, idx * 180);
  });
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
  grid.innerHTML = items.map((item, index) => {
    const title = item.name || '';
    const year = (item.released || '').slice(0, 4);
    const poster = typeof getScreenListDisplayGameCover === 'function' ? getScreenListDisplayGameCover(item) : (typeof getScreenListPreferredGameCover === 'function' ? getScreenListPreferredGameCover(item) : '');
    const genres = (item.genres || []).map(g => g.name).slice(0, 3).join(', ');
    const platforms = (item.platforms || []).map(p => p.platform?.name).filter(Boolean).slice(0, 3).join(', ');
    const overview = genres || platforms || 'Game';
    const itemSource = String(item.source || '').trim().toLowerCase() || 'rawg';
    const rawgId = itemSource === 'rawg'
      ? String(item.rawgId || item.rawg_id || item.id || '').trim()
      : String(item.rawgId || item.rawg_id || '').trim();
    const igdbId = String(item.igdbId || item.igdb_id || (itemSource === 'igdb' ? item.sourceId || String(item.id || '').replace(/^igdb:/i, '') : '') || '').trim();
    const gameKey = rawgId || (igdbId ? `igdb:${igdbId}` : `game:${gridId}:${index}:${title}`);
    const seed = {
      id: gameKey,
      gameIdentityKey: gameKey,
      sourceId: item.sourceId || (itemSource === 'igdb' ? igdbId : rawgId),
      rawgId,
      igdbId,
      rawgSlug: item.slug || '',
      igdbSlug: item.igdbSlug || (itemSource === 'igdb' ? item.slug || '' : ''),
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
      ratings_count: item.ratings_count || item.reviews_count || 0,
      source: itemSource
    };
    if (typeof attachShelfdGameIdentityLock === 'function' && typeof createShelfdGameIdentityLock === 'function') {
      attachShelfdGameIdentityLock(seed, createShelfdGameIdentityLock(seed, '1 discovery games result rendered'));
    }
    if (typeof traceShelfdGameIdentity === 'function') traceShelfdGameIdentity('1 game search result object rendered', seed, { gridId, index });
    setGameMediaProfileSeed(gameKey, seed);
    if (rawgId) setGameMediaProfileSeed(rawgId, seed);
    const titleAttr = escAttr(title);
    const gameKeyAttr = escAttr(gameKey);
    const rawgAttr = escAttr(rawgId);
    const igdbAttr = escAttr(igdbId);
    /* v696: Restructured game card — 5-row info block below the poster.
       Row 1: title  2: year  3: genres (max 3)  4: Steam reviews  5: Add btn */
    return `<div class="discover-card games-discover-card">
      <div class="discover-poster${poster ? '' : ' no-img screenlist-game-cover-pending'}" data-poster="${escAttr(poster)}" data-media-type="game" data-media-id="${gameKeyAttr}" data-game-identity-key="${gameKeyAttr}" data-discover-title="${titleAttr}" data-discover-section="games" data-game-title="${titleAttr}" data-rawg-id="${rawgAttr}" data-igdb-id="${igdbAttr}" ${poster ? `style="background-image:url('${escAttr(poster)}')"` : ''} onclick="openGameMediaProfile(event, '${gameKeyAttr}', getGameMediaProfileSeed('${gameKeyAttr}'), this)">${getDiscoverFriendStackMarkup(title, 'games')}</div>
      <div class="discover-card-body games-dc-body">
        <button class="games-dc-title" type="button" onclick="openGameMediaProfile(event, '${gameKeyAttr}', getGameMediaProfileSeed('${gameKeyAttr}'), this)">${escHtml(title)}</button>
        <div class="games-dc-year">${escHtml(year || '—')}</div>
        <div class="games-dc-genres">${escHtml(genres || '—')}</div>
        <div class="games-dc-rating"></div>
        <div class="games-dc-spacer"></div>
      </div>
    </div>`;
  }).join('');
  requestAnimationFrame(() => {
    setupDiscoverSectionLimit(grid);
    refreshDiscoverFriendStacks();
  });
  // v697: Lazy-fetch Steam review summaries for Row 4 (staggered 120ms/card).
  setTimeout(() => _backfillSteamReviews(grid, items), 400);
  // Lazy-fetch IGDB portrait covers for discovery game cards
  setTimeout(() => {
    backfillIgdbDiscoverGameCovers(grid)
      .then(() => scheduleDiscoverMainPosterPreload('games-cover-backfill'))
      .catch(() => {});
  }, 120);
}

let discoverHubPrewarmTimer = null;
let discoverHubPrewarmToken = 0;
const DISCOVER_MAIN_POSTER_CACHE = 'screenlist-discover-posters-v1';
const DISCOVER_POSTER_PREFETCH_PER_GRID = 8;
const DISCOVER_POSTER_PREFETCH_MAX = 144;
const DISCOVER_POSTER_PREFETCH_CONCURRENCY = 2;
const DISCOVER_POSTER_PREFETCH_BATCH_SIZE = 10;
const DISCOVER_POSTER_PREFETCH_BATCH_PAUSE_MS = 220;
const DISCOVER_POSTER_MEMORY_WARM_LIMIT = 18;
let discoverPosterPreloadTimer = null;
let discoverPosterPreloadRunning = false;
const discoverPosterPreloadSeen = new Set();

function getDiscoverPosterUrlFromElement(el) {
  if (!el) return '';
  let url = el.dataset?.poster || '';
  if (!url) {
    const bg = el.style?.backgroundImage || '';
    const match = bg.match(/url\((['"]?)(.*?)\1\)/i);
    url = match ? match[2] : '';
  }
  if (!url || url === 'none') return '';
  try {
    const resolved = new URL(url, window.location.href);
    if (!/^https?:$/.test(resolved.protocol)) return '';
    return resolved.href;
  } catch (e) {
    return '';
  }
}

function collectDiscoverMainPosterUrls() {
  const grids = typeof getAllDiscoverGrids === 'function' ? getAllDiscoverGrids() : [];
  const priorityUrls = [];
  const backgroundUrls = [];
  const seen = new Set();
  grids.forEach(grid => {
    if (!grid) return;
    let gridCount = 0;
    const posters = Array.from(grid.querySelectorAll('.discover-poster[data-poster], .discover-poster[style*="background-image"], .discover-poster img[src]'));
    for (const poster of posters) {
      if (gridCount >= DISCOVER_POSTER_PREFETCH_PER_GRID || urls.length >= DISCOVER_POSTER_PREFETCH_MAX) break;
      const url = getDiscoverPosterUrlFromElement(poster.matches('img') ? poster : poster);
      const imgUrl = poster.matches('img') ? poster.src : '';
      const finalUrl = url || imgUrl;
      if (!finalUrl || seen.has(finalUrl)) continue;
      seen.add(finalUrl);
      const rect = typeof poster.getBoundingClientRect === 'function' ? poster.getBoundingClientRect() : null;
      const nearViewport = rect && rect.bottom >= -600 && rect.top <= (window.innerHeight || 0) + 1200;
      (nearViewport ? priorityUrls : backgroundUrls).push(finalUrl);
      gridCount += 1;
    }
  });
  return priorityUrls.concat(backgroundUrls).slice(0, DISCOVER_POSTER_PREFETCH_MAX);
}

function warmDiscoverPosterInMemory(url) {
  try {
    const img = new Image();
    img.decoding = 'async';
    img.loading = 'eager';
    img.src = url;
  } catch (e) {}
}

async function pruneDiscoverPosterCache(cache) {
  try {
    const keys = await cache.keys();
    if (keys.length <= DISCOVER_POSTER_PREFETCH_MAX) return;
    await Promise.all(keys.slice(0, keys.length - DISCOVER_POSTER_PREFETCH_MAX).map(key => cache.delete(key)));
  } catch (e) {}
}

async function persistDiscoverPosterUrls(urls) {
  if (!urls.length || !('caches' in window)) return;
  const cache = await caches.open(DISCOVER_MAIN_POSTER_CACHE);
  let cursor = 0;
  let processedSincePause = 0;
  const pause = () => new Promise(resolve => setTimeout(resolve, DISCOVER_POSTER_PREFETCH_BATCH_PAUSE_MS));
  async function worker() {
    while (cursor < urls.length) {
      const url = urls[cursor++];
      if (!url || discoverPosterPreloadSeen.has(url)) continue;
      discoverPosterPreloadSeen.add(url);
      try {
        const cached = await cache.match(url);
        if (cached) continue;
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
      } catch (e) {
        discoverPosterPreloadSeen.delete(url);
      }
      processedSincePause += 1;
      if (processedSincePause >= DISCOVER_POSTER_PREFETCH_BATCH_SIZE) {
        processedSincePause = 0;
        await pause();
      }
    }
  }
  const workers = Array.from({ length: Math.min(DISCOVER_POSTER_PREFETCH_CONCURRENCY, urls.length) }, () => worker());
  await Promise.all(workers);
  await pruneDiscoverPosterCache(cache);
}

function scheduleDiscoverMainPosterPreload(reason = 'discover-prewarm') {
  if (discoverPosterPreloadTimer) {
    clearTimeout(discoverPosterPreloadTimer);
    discoverPosterPreloadTimer = null;
  }
  discoverPosterPreloadTimer = setTimeout(() => {
    discoverPosterPreloadTimer = null;
    const run = async () => {
      if (discoverPosterPreloadRunning || document.hidden) return;
      if (document.body?.classList.contains('main-nav-switching')) {
        scheduleDiscoverMainPosterPreload(`${reason}-after-nav`);
        return;
      }
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (connection?.saveData) return;
      const urls = collectDiscoverMainPosterUrls();
      if (!urls.length) return;
      discoverPosterPreloadRunning = true;
      urls.slice(0, DISCOVER_POSTER_MEMORY_WARM_LIMIT).forEach(warmDiscoverPosterInMemory);
      try {
        await persistDiscoverPosterUrls(urls);
      } catch (error) {
        console.warn('Discover poster prewarm skipped:', reason, error);
      } finally {
        discoverPosterPreloadRunning = false;
      }
    };
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => { run().catch(() => {}); }, { timeout: 1600 });
      return;
    }
    run().catch(() => {});
  }, 350);
}

function scheduleDiscoverHubPrewarm(activeHub = 'tv') {
  if (discoverHubPrewarmTimer) {
    clearTimeout(discoverHubPrewarmTimer);
    discoverHubPrewarmTimer = null;
  }
  const token = ++discoverHubPrewarmToken;
  const run = async () => {
    if (token !== discoverHubPrewarmToken || document.hidden) return;
    if (document.body?.classList.contains('main-nav-switching')) {
      setTimeout(() => scheduleDiscoverHubPrewarm(activeHub), 520);
      return;
    }
    try {
      if (activeHub !== 'gaming' && !gamesDiscoverLoaded && !gamesDiscoverLoading) {
        await loadGamesDiscover(false);
      }
      if (token !== discoverHubPrewarmToken || document.hidden) return;
      if (activeHub !== 'tv' && !discoverLoaded && !discoverLoading) {
        await loadDiscover(false);
      }
      if (token !== discoverHubPrewarmToken || document.hidden) return;
      if (activeHub !== 'anime' && !animeDiscoverLoaded && !animeDiscoverLoading && typeof loadAnimeDiscover === 'function') {
        await loadAnimeDiscover(false);
      }
      if (token !== discoverHubPrewarmToken || document.hidden) return;
      if (activeHub !== 'music' && !musicDiscoverLoaded && !musicDiscoverLoading && typeof loadMusicDiscover === 'function') {
        await loadMusicDiscover(false);
      }
      scheduleDiscoverMainPosterPreload('hub-prewarm');
    } catch (error) {
      console.warn('Discover hub prewarm skipped:', error);
    }
  };
  discoverHubPrewarmTimer = setTimeout(() => {
    discoverHubPrewarmTimer = null;
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => { run().catch(() => {}); }, { timeout: 1400 });
      return;
    }
    run().catch(() => {});
  }, 900);
}

(function initDiscoverHubBackgroundPrewarm() {
  if (window.__screenListDiscoverHubBackgroundPrewarmReady) return;
  window.__screenListDiscoverHubBackgroundPrewarmReady = true;
  const start = () => {
    if (document.hidden) return;
    scheduleDiscoverHubPrewarm('background');
  };
  if (document.readyState === 'complete') {
    setTimeout(start, 2400);
  } else {
    window.addEventListener('load', () => setTimeout(start, 2400), { once: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (!discoverLoaded || !gamesDiscoverLoaded || !animeDiscoverLoaded || !musicDiscoverLoaded)) {
      setTimeout(start, 900);
    }
  });
})();

// Fetch and apply IGDB/Twitch portrait covers to discovery game card posters.
// No single global lock: each grid can repair its own cards so concurrent discovery rows do not skip each other.
const IGDB_DISCOVER_COVER_IN_FLIGHT = new Set();
const IGDB_DISCOVER_COVER_CONCURRENCY = 4;
async function backfillIgdbDiscoverGameCovers(grid) {
  const posters = Array.from(grid ? grid.querySelectorAll('.discover-poster[data-media-type="game"]') : []);
  let cursor = 0;
  async function hydratePosterWorker() {
    while (cursor < posters.length) {
      const poster = posters[cursor++];
      if (!poster) continue;
      const title = poster.dataset.discoverTitle || poster.dataset.gameTitle || '';
      const rawgId = poster.dataset.rawgId || '';
      const gameKey = poster.dataset.gameIdentityKey || poster.dataset.mediaId || rawgId || (poster.dataset.igdbId ? `igdb:${poster.dataset.igdbId}` : '');
      if (!title) continue;
      const key = `${gameKey || rawgId}|${title.toLowerCase()}`;
      if (IGDB_DISCOVER_COVER_IN_FLIGHT.has(key)) continue;
      IGDB_DISCOVER_COVER_IN_FLIGHT.add(key);
      try {
        const seed = gameKey && typeof getGameMediaProfileSeed === 'function' ? getGameMediaProfileSeed(gameKey, {}) : {};
        const payload = { ...seed, title, name: seed.name || title, rawgId, id: gameKey || rawgId };
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
        if (cover?.coverUrl && gameKey && typeof setGameMediaProfileSeed === 'function') {
          const existing = getGameMediaProfileSeed(gameKey, {}) || {};
          let updated = { ...existing, title, name: existing.name || title, rawgId, id: gameKey, igdbCoverUrl: cover.coverUrl, cover: cover.coverUrl, poster: cover.coverUrl, image: cover.coverUrl, background_image: cover.coverUrl };
          if (typeof mergeShelfdGameIdentityLockedItem === 'function') updated = mergeShelfdGameIdentityLockedItem(existing, updated, 'discover-card-igdb-cover-backfill');
          setGameMediaProfileSeed(gameKey, updated);
          if (rawgId) setGameMediaProfileSeed(rawgId, updated);
        }
      } catch (e) { /* silent */ }
      finally { IGDB_DISCOVER_COVER_IN_FLIGHT.delete(key); }
    }
  }
  const workerCount = Math.min(IGDB_DISCOVER_COVER_CONCURRENCY, posters.length || 0);
  if (!workerCount) return;
  await Promise.all(Array.from({ length: workerCount }, () => hydratePosterWorker()));
}

const DISCOVER_INITIAL_VISIBLE_COUNT = 9;
const DISCOVER_SHOW_MORE_STEP = 9;

function isDesktopBrowserDiscoverPreviewLayout() {
  return window.matchMedia('(min-width: 701px)').matches
    && window.matchMedia('(hover: hover)').matches
    && window.matchMedia('(pointer: fine)').matches
    && !window.matchMedia('(display-mode: standalone)').matches;
}

function isStandardDiscoverPreviewGrid(grid) {
  if (!grid || !grid.classList?.contains('discover-grid')) return false;
  if (grid.classList.contains('discover-friends-row')) return false;
  if (grid.classList.contains('discover-category-full-grid')) return false;
  if (grid.id === 'discover-universal-search-grid') return false;
  return !!grid.closest('.discover-section');
}

function getDiscoverPreviewVisibleCount(grid) {
  if (!isStandardDiscoverPreviewGrid(grid)) return DISCOVER_INITIAL_VISIBLE_COUNT;
  return isDesktopBrowserDiscoverPreviewLayout() ? 8 : 6;
}

function getDiscoverPreviewShowMoreStep(grid) {
  return getDiscoverPreviewVisibleCount(grid);
}

function setupDiscoverSectionLimit(grid) {
  if (!grid) return;
  const cards = Array.from(grid.querySelectorAll('.discover-card'));
  if (grid.classList.contains('discover-category-full-grid')) {
    grid.dataset.visibleCount = String(cards.length);
    cards.forEach(card => card.classList.remove('discover-hidden'));
    return;
  }
  const limit = getDiscoverPreviewVisibleCount(grid);
  let visibleCount = Number.parseInt(grid.dataset.visibleCount || '', 10);
  if (!Number.isFinite(visibleCount)) visibleCount = limit;
  visibleCount = Math.min(cards.length, Math.max(limit, visibleCount));
  grid.dataset.visibleCount = String(visibleCount);
  cards.forEach((card, index) => {
    card.classList.toggle('discover-hidden', index >= visibleCount);
  });
  // Bottom expand button removed — View All is accessible via the category header title link.
}

function jumpToDiscoverSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* =============================================================================
   v680: Seasonal Anime sub-page (mirrors MyAnimeList's /anime/season UI).

   Layout:
     [ Top Anime | Seasonal Anime ]   ← discover-hub-toggle subtabs
     ─────────────── only when Seasonal is active ───────────────
     [ Winter YYYY | Spring YYYY | Summer YYYY | Fall YYYY ]
     [ All | TV | ONA | OVA | MOVIE | SPECIAL ]
     <single grid sorted by Jikan `members` desc>

   Data flow:
     - Jikan endpoint: GET /seasons/{year}/{season}, paginated 25/page.
     - We fetch up to 4 pages (~100 items) per season, cache by year+season.
     - Sorting: 100% by `members` (descending) per spec — no score blending.
     - Type filter: client-side `.filter()` on cached data; switching the
       type filter doesn't refetch.

   Caching:
     animeSeasonalCache → Map<`${year}:${season}`, rawJikanItems[]>
     (kept across the page lifetime; page refresh clears it via Jikan's
     internal URL-keyed cache anyway.)
   ========================================================================== */

let activeAnimeSubtab        = 'seasonal';   /* v11.312: Seasonal Anime is the default subtab. */
let activeAnimeSeasonalSeason = '';     /* set on first Seasonal click */
let activeAnimeSeasonalYear  = 0;
let activeAnimeSeasonalType  = 'all';
const animeSeasonalCache     = new Map();
let animeSeasonalRequestToken = 0;

function getCurrentAnimeSeason() {
  /* Northern-hemisphere broadcasting calendar (matches MyAnimeList's binning):
       Jan–Mar = winter | Apr–Jun = spring | Jul–Sep = summer | Oct–Dec = fall */
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  let season;
  if (month <= 3)       season = 'winter';
  else if (month <= 6)  season = 'spring';
  else if (month <= 9)  season = 'summer';
  else                  season = 'fall';
  return { year, season };
}

function _capSeason(s) { return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1); }

function updateAnimeSeasonalSeasonLabels(year) {
  const labels = { winter: 'Winter', spring: 'Spring', summer: 'Summer', fall: 'Fall' };
  document.querySelectorAll('.anime-discover-season-btn').forEach(b => {
    const s = b.dataset.season;
    if (s && labels[s]) b.textContent = `${labels[s]} ${year}`;
  });
}

function syncAnimeSeasonalActiveButtons() {
  document.querySelectorAll('.anime-discover-season-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.season === activeAnimeSeasonalSeason);
  });
  document.querySelectorAll('.anime-discover-type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === activeAnimeSeasonalType);
  });
}

async function switchAnimeDiscoverSubtab(tab) {
  if (tab !== 'top' && tab !== 'seasonal') return;
  if (activeAnimeSubtab === tab) return;
  activeAnimeSubtab = tab;
  document.querySelectorAll('.anime-discover-subtab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.animeSubtab === tab);
  });
  document.body.classList.toggle('anime-subtab-seasonal', tab === 'seasonal');
  if (tab === 'seasonal') {
    if (!activeAnimeSeasonalSeason) {
      const { year, season } = getCurrentAnimeSeason();
      activeAnimeSeasonalYear  = year;
      activeAnimeSeasonalSeason = season;
      updateAnimeSeasonalSeasonLabels(year);
    } else {
      updateAnimeSeasonalSeasonLabels(activeAnimeSeasonalYear);
    }
    syncAnimeSeasonalActiveButtons();
    await loadAnimeSeasonal();
  }
}
window.switchAnimeDiscoverSubtab = switchAnimeDiscoverSubtab;

async function switchAnimeSeason(season) {
  if (!['winter', 'spring', 'summer', 'fall'].includes(season)) return;
  if (activeAnimeSeasonalSeason === season) return;
  activeAnimeSeasonalSeason = season;
  syncAnimeSeasonalActiveButtons();
  await loadAnimeSeasonal();
}
window.switchAnimeSeason = switchAnimeSeason;

function switchAnimeSeasonType(type) {
  if (!['all', 'tv', 'ona', 'ova', 'movie', 'special'].includes(type)) return;
  if (activeAnimeSeasonalType === type) return;
  activeAnimeSeasonalType = type;
  syncAnimeSeasonalActiveButtons();
  /* Type filter is client-side over the same cached pool — no refetch. */
  renderAnimeSeasonalFromCache();
}
window.switchAnimeSeasonType = switchAnimeSeasonType;

/* v682: localStorage persistence for seasonal anime data.
   Two-tier cache: in-memory Map (instant within a session) +
   localStorage (survives page refreshes, with TTL).

   TTL strategy:
     Current season  → 6 h  (scores / member counts update as shows air)
     Past seasons    → 7 d  (stable — no new episodes, ranks barely move)

   Storage key: "shelfd:seasonal:{year}:{season}"
   We only persist the fields the renderer actually needs, keeping the
   payload small (≈ 200-350 bytes / item → ~25 KB for 100 items). */
const _SEAS_STORE_PREFIX     = 'shelfd:seasonal:';
const _SEAS_TTL_CURRENT_MS   = 6  * 60 * 60 * 1000;   /* 6 hours  */
const _SEAS_TTL_PAST_MS      = 7  * 24 * 60 * 60 * 1000; /* 7 days   */

function _seasIsCurrent(year, season) {
  const cur = getCurrentAnimeSeason();
  return year === cur.year && season === cur.season;
}

function _seasSlimItem(item) {
  /* Trim to only what renderAnimeSeasonalCards uses. */
  return {
    mal_id: item.mal_id,
    title: item.title,
    title_english: item.title_english || '',
    images: {
      jpg: {
        large_image_url: item.images?.jpg?.large_image_url || '',
        image_url:       item.images?.jpg?.image_url       || ''
      }
    },
    score:    item.score    || 0,
    members:  item.members  || 0,
    episodes: item.episodes || 0,
    duration: item.duration || '',
    type:     item.type     || '',
    aired:    { from: item.aired?.from || '' },
    status:   item.status   || '',
    /* v683: genres needed for the rating-row genre chips. */
    genres: (item.genres || []).slice(0, 5).map(g => ({ name: String(g.name || '') }))
  };
}

function _seasWriteStore(year, season, items) {
  try {
    const key     = `${_SEAS_STORE_PREFIX}${year}:${season}`;
    const payload = JSON.stringify({ ts: Date.now(), data: items.map(_seasSlimItem) });
    localStorage.setItem(key, payload);
  } catch (e) {
    /* Quota exceeded or private-browsing — silently skip. */
    console.warn('[Seasonal cache] write failed:', e?.message || e);
  }
}

function _seasReadStore(year, season) {
  try {
    const key = `${_SEAS_STORE_PREFIX}${year}:${season}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (!Array.isArray(data) || !ts) return null;
    const ttl = _seasIsCurrent(year, season) ? _SEAS_TTL_CURRENT_MS : _SEAS_TTL_PAST_MS;
    if (Date.now() - ts > ttl) {
      localStorage.removeItem(key);
      return null;
    }
    return data;   /* already slimmed + sorted when written */
  } catch (e) {
    return null;
  }
}

async function loadAnimeSeasonal() {
  const J = window.JikanAnime;
  const grid    = document.getElementById('anime-discover-seasonal-grid');
  const titleEl = document.getElementById('anime-seasonal-section-title');
  if (!grid || !J) return;

  const year     = activeAnimeSeasonalYear;
  const season   = activeAnimeSeasonalSeason;
  const cacheKey = `${year}:${season}`;
  const myToken  = ++animeSeasonalRequestToken;

  if (titleEl) titleEl.textContent = `${_capSeason(season)} ${year}`;

  if (!animeSeasonalCache.has(cacheKey)) {
    /* ── Level 1: check localStorage ── */
    const stored = _seasReadStore(year, season);
    if (stored) {
      animeSeasonalCache.set(cacheKey, stored);
    } else {
      /* ── Level 2: fetch from Jikan ── */
      grid.innerHTML = '<div class="discover-message">Loading seasonal anime…</div>';
      try {
        const all = [];
        for (let page = 1; page <= 4; page++) {
          const data = await J.request(
            `seasons/${encodeURIComponent(year)}/${encodeURIComponent(season)}`,
            { page }
          );
          if (myToken !== animeSeasonalRequestToken) return;
          const items = Array.isArray(data?.data) ? data.data : [];
          if (!items.length) break;
          all.push(...items);
          if (!data?.pagination?.has_next_page) break;
        }
        all.sort((a, b) => Number(b?.members || 0) - Number(a?.members || 0));
        animeSeasonalCache.set(cacheKey, all);
        /* Persist to localStorage so the next visit skips the Jikan fetch. */
        _seasWriteStore(year, season, all);
      } catch (e) {
        console.error('Seasonal anime fetch failed:', e);
        if (myToken === animeSeasonalRequestToken) {
          grid.innerHTML = '<div class="discover-message">Could not load seasonal anime. Try again later.</div>';
        }
        return;
      }
    }
  }

  if (myToken !== animeSeasonalRequestToken) return;
  renderAnimeSeasonalFromCache();
}
window.loadAnimeSeasonal = loadAnimeSeasonal;

function renderAnimeSeasonalFromCache() {
  const cacheKey = `${activeAnimeSeasonalYear}:${activeAnimeSeasonalSeason}`;
  const all = animeSeasonalCache.get(cacheKey) || [];
  const wanted = activeAnimeSeasonalType;
  const filtered = wanted === 'all'
    ? all
    : all.filter(a => String(a?.type || '').toUpperCase() === wanted.toUpperCase());
  /* v681: use custom renderer — not the standard discover-card renderer. */
  renderAnimeSeasonalCards(filtered);
}

/* =============================================================================
   v681: Custom card renderer for the Seasonal Anime grid.

   Card layout (each card):
     ┌──────────────────────────────┐
     │   poster image               │
     │   ─── overlay at bottom ─── │
     │   Apr 6, 2026 | 12 eps, 23m  │
     └──────────────────────────────┘
     ★ 8.54
     Title Name Here
     1,234,567 members
     [+ Add to Library]

   Pagination: 18 shown initially; "Load More" reveals 6 at a time.
   Opening the card (poster click or title click) calls openJikanAnimeProfile.
   "Add to Library" opens the shelf modal and pre-selects via selectJikanAnime.
   ============================================================================= */

const ANIME_SEASONAL_INITIAL  = 18;
const ANIME_SEASONAL_LOAD_STEP = 6;

function _seasEscape(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function _seasFormatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${M[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
function _seasFormatDuration(dur) {
  const m = String(dur || '').match(/(\d+)\s*min/i);
  return m ? `${m[1]} min` : '';
}
function _seasMetaLine(item) {
  const airDate = _seasFormatDate(item?.aired?.from);
  const eps = Number(item?.episodes || 0);
  const dur = _seasFormatDuration(item?.duration || '');
  const epStr = eps > 0
    ? (dur ? `${eps} eps, ${dur}` : `${eps} eps`)
    : (dur || '');
  return [airDate, epStr].filter(Boolean).join(' | ');
}

/* =============================================================================
   v689: Seasonal Anime "Add to Library" bottom sheet.

   Design goals:
   • Slides up 75 % of viewport height with a spring-curve transition.
   • Shows ONLY: anime poster + title, "Where do you want it?", status buttons.
     No search bar. No toggle filters. Clean, one-tap.
   • Material is centered vertically inside the sheet.
   • Matches the app's dark-mode colour palette (#181c20, purple accents).

   The structure / pattern here is intentionally reusable for other surfaces
   (e.g. My Lists title cards, full-page media profile, etc.) in the future.
   ============================================================================= */

function _getSeasCachedItem(malId) {
  /* Look up a slim cached item from any loaded season. */
  const id = Number(malId);
  for (const items of animeSeasonalCache.values()) {
    const found = (items || []).find(a => Number(a?.mal_id) === id);
    if (found) return found;
  }
  return null;
}

function _buildSelectedTmdbFromSeasItem(item) {
  /* Build window.selectedTmdb synchronously from a cached slim item.
     submitModal() will use selectedTmdb.librarySection to target the
     correct list, so activeSection doesn't need to change. */
  if (!item) return false;
  const title    = item.title_english || item.title || '';
  const cover    = item.images?.jpg?.large_image_url || item.images?.jpg?.image_url || '';
  const gnNames  = (item.genres || []).map(g => String(g.name || '')).filter(Boolean);
  const year     = String(item.year || (item.aired?.from || '').slice(0, 4) || '');
  const totalEps = Number(item.episodes || 0);
  window.selectedTmdb = {
    title, cover,
    genre: gnNames.join(', '), genreNames: gnNames, year,
    tmdbId: '', malId: String(item.mal_id || ''),
    mal_id: String(item.mal_id || ''),
    animeIdentityKey: item.mal_id ? `mal:${item.mal_id}` : '',
    malUrl: item.url || (item.mal_id ? `https://myanimelist.net/anime/${item.mal_id}` : ''),
    jikanUrl: item.url || (item.mal_id ? `https://myanimelist.net/anime/${item.mal_id}` : ''),
    url: item.url || (item.mal_id ? `https://myanimelist.net/anime/${item.mal_id}` : ''),
    source: 'myanimelist',
    originalTitle: '', originalLanguage: 'ja', originCountries: ['JP'],
    mediaCategory: 'anime', librarySection: 'anime', isAnime: true,
    totalEpisodes: totalEps, seasons: 1,
    episodes: totalEps > 0
      ? Array.from({ length: totalEps }, (_, i) => ({
          number: i+1, seasonNum: 1, seasonName: '', epNum: i+1, title: '', cover
        }))
      : [],
    animeSeasonItems: [],
    titleVariants: { english: title, romaji: item.title || title, japanese: '' },
    englishTitle: title, romajiTitle: item.title || title, japaneseTitle: ''
  };
  if (typeof applyJikanCanonicalAnimeFields === 'function') {
    applyJikanCanonicalAnimeFields(window.selectedTmdb, item, { overwrite: true });
  }
  return true;
}

function openSeasonalAddSheet(malId) {
  const id = Number(malId);
  /* Remove any stale sheet. */
  document.getElementById('sas-backdrop')?.remove();
  document.getElementById('sas-sheet')?.remove();
  /* Grab cached data for instant preview. */
  const item  = _getSeasCachedItem(id);
  const title = item ? (item.title_english || item.title || '') : '';
  const poster = item ? (item.images?.jpg?.large_image_url || item.images?.jpg?.image_url || '') : '';
  const year   = item ? (item.aired?.from || '').slice(0, 4) : '';
  const type   = item?.type || '';
  const meta   = [year, type].filter(Boolean).join(' · ');
  /* Pre-build selectedTmdb so status picks are instant. */
  _buildSelectedTmdbFromSeasItem(item);
  /* Backdrop */
  const bd = document.createElement('div');
  bd.id = 'sas-backdrop'; bd.className = 'sas-backdrop';
  bd.onclick = closeSeasonalAddSheet;
  document.body.appendChild(bd);
  /* Sheet */
  const sheet = document.createElement('div');
  sheet.id = 'sas-sheet'; sheet.className = 'sas-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Add to library');
  sheet.innerHTML = `
    <div class="sas-handle" aria-hidden="true"></div>
    <div class="sas-body">
      <div class="sas-anime-row">
        ${poster
          ? `<img class="sas-poster" src="${_seasEscape(poster)}" alt="${_seasEscape(title)}" referrerpolicy="no-referrer">`
          : '<div class="sas-poster-placeholder"></div>'}
        <div class="sas-anime-info">
          <div class="sas-title">${_seasEscape(title)}</div>
          ${meta ? `<div class="sas-meta">${_seasEscape(meta)}</div>` : ''}
        </div>
      </div>
      <div class="sas-prompt">Where do you want it?</div>
      <div class="sas-statuses">
        <button class="sas-status-btn" type="button" onclick="pickSeasonalStatus('watching')">Watching</button>
        <button class="sas-status-btn" type="button" onclick="pickSeasonalStatus('planned')">Planning</button>
        <button class="sas-status-btn" type="button" onclick="pickSeasonalStatus('watched')">Watched</button>
      </div>
    </div>`;
  document.body.appendChild(sheet);
  /* Spring animation in — two rAFs so the browser paints before transition fires. */
  requestAnimationFrame(() => {
    bd.classList.add('sas-bd-open');
    requestAnimationFrame(() => sheet.classList.add('sas-sheet-open'));
  });
}
window.openSeasonalAddSheet = openSeasonalAddSheet;

async function pickSeasonalStatus(status) {
  if (!window.selectedTmdb) { closeSeasonalAddSheet(); return; }
  closeSeasonalAddSheet();
  /* v691: pin activeSection='anime' so submitModal's validation runs against
     MODAL_STATUS_OPTIONS['anime'] and targetSection resolves to 'anime'.
     Restored in finally so discover-page global state is untouched. */
  const prevSection = window.activeSection;
  window.activeSection = 'anime';
  try {
    if (typeof submitModal === 'function') {
      const result = await submitModal(status);
      if (result?.ok) {
        if (typeof playLibraryAddPopSound === 'function') playLibraryAddPopSound();
        if (typeof showToast === 'function') showToast(result.message || 'Added to your shelf!');
      } else if (!result?.duplicate) {
        if (typeof showToast === 'function') showToast('Could not add this title. Try again.');
      }
    }
  } catch (e) {
    console.error('[SeasonalAddSheet] save failed:', e);
    if (typeof showToast === 'function') showToast('Could not add this title. Try again.');
  } finally {
    window.activeSection = prevSection;
  }
}
window.pickSeasonalStatus = pickSeasonalStatus;

function closeSeasonalAddSheet() {
  const sheet = document.getElementById('sas-sheet');
  const bd    = document.getElementById('sas-backdrop');
  if (sheet) sheet.classList.remove('sas-sheet-open');
  if (bd)    bd.classList.remove('sas-bd-open');
  setTimeout(() => { sheet?.remove(); bd?.remove(); }, 340);
}
window.closeSeasonalAddSheet = closeSeasonalAddSheet;

function addSeasonalAnimeToLibrary(malId) {
  openSeasonalAddSheet(Number(malId));
}
window.addSeasonalAnimeToLibrary = addSeasonalAnimeToLibrary;

/* =============================================================================
   v700: Discover > Games "Add to Library" bottom sheet.
   v705: Two-level status flow.
     Level 1 — Playing / Backlog / Played / Wishlist.
     Level 2 (when Playing is tapped) — Single Player / Live Games.
   Section routing now relies on `var activeSection` (fixed in v705) so
   `window.activeSection = 'games'` actually updates the binding submitModal
   reads, ensuring saves land in the games section instead of TV shows.
   ============================================================================= */
function openGameDiscoverAddSheetFromButton(btn) {
  if (!btn) return;
  const id = btn.dataset.discoverId || btn.dataset.gameIdentityKey || btn.dataset.rawgId || (btn.dataset.igdbId ? `igdb:${btn.dataset.igdbId}` : '');
  const seed = typeof getGameMediaProfileSeed === 'function' ? (getGameMediaProfileSeed(id) || {}) : {};
  openGameDiscoverAddSheet(id, btn.dataset.discoverTitle || seed.title || seed.name || '', btn.dataset.discoverPoster || seed.cover || seed.poster || '', seed);
}
window.openGameDiscoverAddSheetFromButton = openGameDiscoverAddSheetFromButton;

function openGameDiscoverAddSheet(rawgId, title, poster, seedOverride = null) {
  const id = String(rawgId || '').trim();
  /* v10.78: invalidate any stale snapshot left over from a previous Add to
     Shelf flow that was closed without confirming. Without this, the next
     `submitModal` call would prefer `addShelfModalSelectionState.item`
     (stale title) over the freshly-set `window.selectedTmdb` below and save
     the WRONG game. Only the snapshot is cleared; `selectedTmdb` is set on
     the very next line, and the DOM/modal state is untouched. */
  if (typeof window.clearAddShelfModalSelectionStateSnapshot === 'function') {
    window.clearAddShelfModalSelectionStateSnapshot();
  }
  /* Pre-build selectedTmdb from the clicked canonical seed so the save is instant. */
  let seed = seedOverride && typeof seedOverride === 'object' ? { ...seedOverride } : {};
  const storedSeed = typeof getGameMediaProfileSeed === 'function'
    ? (getGameMediaProfileSeed(id) || {})
    : {};
  if (!seed.title && !seed.name) seed = { ...storedSeed, ...seed };
  const rawgIdValue = typeof getShelfdGameIdentityRawgId === 'function' ? getShelfdGameIdentityRawgId(seed) : String(seed.rawgId || (/^\d+$/.test(id) ? id : '') || '');
  const igdbIdValue = typeof getShelfdGameIdentityIgdbId === 'function' ? getShelfdGameIdentityIgdbId(seed) : String(seed.igdbId || (id.match(/^igdb:(\d+)$/i)?.[1] || '') || '');
  const resolvedTitle  = String(seed.title || seed.name || title || '');
  const resolvedPoster = String(seed.poster || seed.cover || seed.background_image || seed.igdbCoverUrl || poster || '');
  const genreNames     = (Array.isArray(seed.genres) ? seed.genres : []).map(g => String(g?.name || '')).filter(Boolean);
  const year           = String(seed.released || '').slice(0, 4);
  window.selectedTmdb = {
    title: resolvedTitle,
    name: resolvedTitle,
    cover: resolvedPoster,
    poster: resolvedPoster,
    image: resolvedPoster,
    background_image: resolvedPoster,
    igdbCoverUrl: seed.igdbCoverUrl || '',
    genre: genreNames.join(', '),
    genreNames,
    year,
    tmdbId: '',
    rawgId: rawgIdValue,
    igdbId: igdbIdValue,
    sourceId: seed.sourceId || igdbIdValue || rawgIdValue,
    gameIdentityKey: seed.gameIdentityKey || seed.shelfdGameIdentityLock?.key || id,
    rawgSlug: rawgIdValue ? (seed.rawgSlug || seed.slug || '') : '',
    igdbSlug: seed.igdbSlug || (!rawgIdValue ? seed.slug || '' : ''),
    backloggdSlug: seed.backloggdSlug || '',
    metacriticSlug: seed.metacriticSlug || '',
    metacritic: seed.metacritic || '',
    source: seed.source || (igdbIdValue && !rawgIdValue ? 'igdb' : 'rawg'),
    platforms: (Array.isArray(seed.platforms) ? seed.platforms : [])
      .map(p => typeof p === 'string' ? p : (p?.platform?.name || p?.name || '')).filter(Boolean).join(', '),
    mediaCategory: 'games',
    librarySection: 'games',
    isAnime: false
  };
  const lock = seed.shelfdGameIdentityLock || (typeof createShelfdGameIdentityLock === 'function' ? createShelfdGameIdentityLock(window.selectedTmdb, '2 discovery game result tapped') : null);
  if (typeof attachShelfdGameIdentityLock === 'function') attachShelfdGameIdentityLock(window.selectedTmdb, lock);
  if (typeof traceShelfdGameIdentity === 'function') {
    traceShelfdGameIdentity('2 game result tapped/add sheet opened', window.selectedTmdb, { routeId: id });
    traceShelfdGameIdentity('3 selected/current game stored', window.selectedTmdb, { routeId: id });
  }
  /* Stash the header bits so we can re-render the body when switching levels. */
  window._gameAddSheetCtx = { title: resolvedTitle, poster: resolvedPoster, year };
  /* Remove any stale sheet. */
  document.getElementById('sas-backdrop')?.remove();
  document.getElementById('sas-sheet')?.remove();
  const bd = document.createElement('div');
  bd.id = 'sas-backdrop'; bd.className = 'sas-backdrop';
  bd.onclick = _closeGameDiscoverSheet;
  document.body.appendChild(bd);
  const sheet = document.createElement('div');
  sheet.id = 'sas-sheet'; sheet.className = 'sas-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Add game to library');
  sheet.innerHTML = _buildGameAddSheetBody('top');
  document.body.appendChild(sheet);
  requestAnimationFrame(() => {
    bd.classList.add('sas-bd-open');
    requestAnimationFrame(() => sheet.classList.add('sas-sheet-open'));
  });
}
window.openGameDiscoverAddSheet = openGameDiscoverAddSheet;

function _buildGameAddSheetBody(level) {
  const ctx = window._gameAddSheetCtx || {};
  const meta = [ctx.year].filter(Boolean).join(' · ');
  const headerRow = `
    <div class="sas-anime-row">
      ${ctx.poster
        ? `<img class="sas-poster" src="${_seasEscape(ctx.poster)}" alt="${_seasEscape(ctx.title)}" referrerpolicy="no-referrer">`
        : '<div class="sas-poster-placeholder"></div>'}
      <div class="sas-anime-info">
        <div class="sas-title">${_seasEscape(ctx.title || '')}</div>
        ${meta ? `<div class="sas-meta">${_seasEscape(meta)}</div>` : ''}
      </div>
    </div>`;
  if (level === 'playing') {
    return `
      <div class="sas-handle" aria-hidden="true"></div>
      <div class="sas-body">
        ${headerRow}
        <div class="sas-prompt">
          <button type="button" class="sas-back-btn" aria-label="Back" onclick="_renderGameAddSheetLevel('top')">‹</button>
          <span>What kind of playthrough?</span>
        </div>
        <div class="sas-statuses">
          <button class="sas-status-btn" type="button" onclick="pickGameDiscoverStatus('competitive')">Competitive</button>
          <button class="sas-status-btn" type="button" onclick="pickGameDiscoverStatus('live')">Live Games</button>
          <button class="sas-status-btn" type="button" onclick="pickGameDiscoverStatus('watching')">Single Player</button>
        </div>
      </div>`;
  }
  return `
    <div class="sas-handle" aria-hidden="true"></div>
    <div class="sas-body">
      ${headerRow}
      <div class="sas-prompt">Where do you want it?</div>
      <div class="sas-statuses">
        <button class="sas-status-btn" type="button" onclick="_renderGameAddSheetLevel('playing')">Playing</button>
        <button class="sas-status-btn" type="button" onclick="pickGameDiscoverStatus('planned')">Planning</button>
        <button class="sas-status-btn" type="button" onclick="pickGameDiscoverStatus('watched')">Played</button>
        <button class="sas-status-btn" type="button" onclick="pickGameDiscoverStatus('wishlist')">Wishlist</button>
      </div>
    </div>`;
}

function _renderGameAddSheetLevel(level) {
  const sheet = document.getElementById('sas-sheet');
  if (!sheet) return;
  sheet.innerHTML = _buildGameAddSheetBody(level);
}
window._renderGameAddSheetLevel = _renderGameAddSheetLevel;

async function pickGameDiscoverStatus(status) {
  if (!window.selectedTmdb) { _closeGameDiscoverSheet(); return; }
  /* v10.78: snapshot the selected game LOCALLY before close — so any other
     code that runs synchronously between here and submitModal cannot mutate
     the global `window.selectedTmdb` out from under us. The snapshot is
     passed explicitly as `itemOverride` to submitModal, which is documented
     as the highest-priority source-of-truth. This is the canonical fix for
     the Tony-Hawk-saved-as-Burrito-Bison identity-swap bug. */
  const lockedGame = typeof cloneShelfdGameIdentityValue === 'function'
    ? cloneShelfdGameIdentityValue(window.selectedTmdb)
    : { ...window.selectedTmdb };
  if (typeof attachShelfdGameIdentityLock === 'function') {
    attachShelfdGameIdentityLock(lockedGame, lockedGame.shelfdGameIdentityLock || (typeof createShelfdGameIdentityLock === 'function' ? createShelfdGameIdentityLock(lockedGame, '6 game rating/status flow') : null));
  }
  if (typeof traceShelfdGameIdentity === 'function') traceShelfdGameIdentity('6 game rating/status flow', lockedGame, { status });
  if (typeof assertShelfdGameIdentity === 'function' && !assertShelfdGameIdentity('before game discover submitModal', lockedGame)) return;
  _closeGameDiscoverSheet();
  const prev = window.activeSection;
  /* v705: with `var activeSection`, this assignment now actually updates the
     binding that submitModal reads from across files. */
  window.activeSection = 'games';
  try {
    if (typeof submitModal === 'function') {
      const result = await submitModal(status, 0, lockedGame);
      if (result?.ok) {
        if (typeof playLibraryAddPopSound === 'function') playLibraryAddPopSound();
        if (typeof showToast === 'function') showToast(result.message || 'Added to your shelf!');
      } else if (!result?.duplicate) {
        if (typeof showToast === 'function') showToast('Could not add this game. Try again.');
      }
    }
  } catch (e) {
    console.error('[GameAddSheet] save failed:', e);
    if (typeof showToast === 'function') showToast('Could not add this game. Try again.');
  } finally {
    window.activeSection = prev;
  }
}
window.pickGameDiscoverStatus = pickGameDiscoverStatus;

function _closeGameDiscoverSheet() {
  const sheet = document.getElementById('sas-sheet');
  const bd    = document.getElementById('sas-backdrop');
  if (sheet) sheet.classList.remove('sas-sheet-open');
  if (bd)    bd.classList.remove('sas-bd-open');
  setTimeout(() => { sheet?.remove(); bd?.remove(); }, 340);
}
window._closeGameDiscoverSheet = _closeGameDiscoverSheet;

function animeSeasonalLoadMore() {
  const grid = document.getElementById('anime-discover-seasonal-grid');
  if (!grid) return;
  const hidden = Array.from(grid.querySelectorAll('.asc-hidden'));
  hidden.slice(0, ANIME_SEASONAL_LOAD_STEP).forEach(el => el.classList.remove('asc-hidden'));
  if (grid.querySelectorAll('.asc-hidden').length === 0) {
    const wrap = document.getElementById('anime-seasonal-load-more-wrap');
    if (wrap) wrap.innerHTML = '';
  }
}
window.animeSeasonalLoadMore = animeSeasonalLoadMore;

function renderAnimeSeasonalCards(rawItems) {
  const grid = document.getElementById('anime-discover-seasonal-grid');
  if (!grid) return;

  if (!rawItems || !rawItems.length) {
    grid.innerHTML = '<div class="discover-message">No anime found for this season / filter.</div>';
    const w = document.getElementById('anime-seasonal-load-more-wrap');
    if (w) w.innerHTML = '';
    return;
  }

  grid.innerHTML = rawItems.map((item, idx) => {
    const malId    = Number(item.mal_id || 0);
    const title    = item.title_english || item.title || '';
    const poster   = item.images?.jpg?.large_image_url || item.images?.jpg?.image_url || '';
    const score    = Number(item.score || 0);
    const members  = Number(item.members || 0);
    const metaLine = _seasMetaLine(item);
    /* v11.447: MAL scores are out of 10 — show them on Shelfd's 5-star scale. */
    const scoreStr = score > 0 ? `★ ${formatMalScoreOutOfFive(score)}` : '★ N/A';
    const membersStr = members > 0 ? Number(members).toLocaleString('en-US') + ' members' : '';
    const hiddenClass = idx >= ANIME_SEASONAL_INITIAL ? ' asc-hidden' : '';

    /* v683: up to 3 genre chips from Jikan, displayed right of the rating. */
    const genreChips = (Array.isArray(item.genres) ? item.genres : [])
      .slice(0, 3)
      .map(g => `<span class="anime-seasonal-genre-chip">${_seasEscape(String(g.name || ''))}</span>`)
      .join('');

    return `<div class="anime-seasonal-card${hiddenClass}" data-mal-id="${malId}">
      <!-- v686: meta header + genre chips both sit above the poster -->
      ${metaLine ? `<div class="anime-seasonal-card-header">${_seasEscape(metaLine)}</div>` : ''}
      ${genreChips ? `<div class="anime-seasonal-card-genres anime-seasonal-card-genres--header">${genreChips}</div>` : ''}
      <div class="anime-seasonal-card-poster" onclick="openJikanAnimeProfile(event,${malId})">
        ${poster
          ? `<img src="${_seasEscape(poster)}" alt="${_seasEscape(title)}" loading="lazy" referrerpolicy="no-referrer">`
          : '<div class="anime-seasonal-card-poster-placeholder"></div>'}
      </div>
      <div class="anime-seasonal-card-info">
        <button class="anime-seasonal-card-title-btn" type="button" onclick="openJikanAnimeProfile(event,${malId})">${_seasEscape(title)}</button>
        <div class="anime-seasonal-card-rating-members-row">
          <div class="anime-seasonal-card-rating">${scoreStr}</div>
          ${membersStr ? `<div class="anime-seasonal-card-members">${_seasEscape(membersStr)}</div>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  /* Inject / update the Load More wrapper after the grid. */
  let wrap = document.getElementById('anime-seasonal-load-more-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'anime-seasonal-load-more-wrap';
    wrap.className = 'anime-seasonal-load-more-wrap';
    grid.insertAdjacentElement('afterend', wrap);
  }
  wrap.innerHTML = rawItems.length > ANIME_SEASONAL_INITIAL
    ? `<button class="anime-seasonal-load-more-btn" type="button" onclick="animeSeasonalLoadMore()">Load More</button>`
    : '';
}

/* =============================================================================
   v11.014 — MEDIA PROFILE → EPISODE & SEASON DETAILS PAGE
   ----------------------------------------------------------------------------
   New surface on the full-page media profile (TV shows + anime only) that
   lets a viewer browse every season and every episode WITHOUT having to
   add the title to their library first.

   Entry point: `.discover-media-seasons-entry` button rendered above the
   cast section. Tap → `openDiscoverSeasonsPage(type, id)` slides a
   `#discover-seasons-page` overlay in from the right (450ms,
   cubic-bezier(0.18, 0.92, 0.18, 1) — ProMotion-safe transform+opacity).

   Data source — Phase 1 (this version):
   - Season list: `details.seasons[]` from the already-cached TMDB
     `/tv/{id}` response (poster, name, air_date, episode_count,
     season_number, overview).
   - Per-season episode list: lazy-fetched via
     `/api/tmdb/tv/{id}/season/{season_number}` on first expand.
   - Per-episode rating: TMDB `vote_average` (out of 10). Cached.
   - Per-season aggregate rating: average of `vote_average` across
     episodes (excludes zeros / unaired).

   Phase 2 (deferred — separate version): replace TMDB per-episode
   ratings with OMDb's `imdbRating` per episode via a new
   `/api/imdb/season` worker endpoint that proxies
   `https://www.omdbapi.com/?i={imdbId}&Season={n}`. The per-episode
   rendering is already keyed on `vote_average` so swapping the source
   is a one-line change once the endpoint exists.
   ========================================================================== */

const DISCOVER_SEASONS_PAGE_OPEN_MS = 450;
const DISCOVER_SEASONS_PAGE_CLOSE_MS = 360;
const discoverSeasonsEpisodesCache = new Map(); /* key: `${tvId}:${seasonNumber}` → episodes[] */
let activeDiscoverSeasonsState = null;
let discoverSeasonsOpenFrameA = 0;
let discoverSeasonsOpenFrameB = 0;
let discoverSeasonsCloseTimer = 0;

function resetDiscoverSeasonsOverlayTimers() {
  if (discoverSeasonsOpenFrameA) {
    try { cancelAnimationFrame(discoverSeasonsOpenFrameA); } catch (_) {}
    discoverSeasonsOpenFrameA = 0;
  }
  if (discoverSeasonsOpenFrameB) {
    try { cancelAnimationFrame(discoverSeasonsOpenFrameB); } catch (_) {}
    discoverSeasonsOpenFrameB = 0;
  }
  if (discoverSeasonsCloseTimer) {
    try { clearTimeout(discoverSeasonsCloseTimer); } catch (_) {}
    discoverSeasonsCloseTimer = 0;
  }
}

function renderDiscoverMediaSeasonsEntry(details = {}, id = '') {
  const seasonsCount = Number(details?.number_of_seasons || (Array.isArray(details?.seasons) ? details.seasons.filter(s => Number(s?.season_number || 0) > 0).length : 0)) || 0;
  const episodesCount = Number(details?.number_of_episodes || 0) || 0;
  const meta = [
    seasonsCount ? `${seasonsCount} ${seasonsCount === 1 ? 'season' : 'seasons'}` : '',
    episodesCount ? `${episodesCount} ${episodesCount === 1 ? 'episode' : 'episodes'}` : ''
  ].filter(Boolean).join(' · ');
  return `<button class="discover-media-section discover-media-section-button discover-media-seasons-entry" type="button" onclick="event.stopPropagation();openDiscoverSeasonsPage('tv','${escAttr(String(id || ''))}')" aria-label="Open episode and season details">
    <div class="discover-media-seasons-entry-copy">
      <h3>Episode &amp; Season Details</h3>
      ${meta ? `<span class="discover-media-seasons-entry-meta">${escHtml(meta)}</span>` : ''}
    </div>
    <svg class="discover-media-seasons-entry-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 4.5 13 10l-5.5 5.5"/></svg>
  </button>`;
}

function getDiscoverSeasonsCachedDetails(id) {
  const key = getDiscoverMediaProfileKey('tv', id);
  return discoverMediaProfileCache.get(key) || null;
}

function getDiscoverSeasonsList(details = {}) {
  const all = Array.isArray(details?.seasons) ? details.seasons : [];
  /* Skip the TMDB "Specials" season (season_number 0) by default — most
     users care about main seasons first. Could surface later via a
     "Show specials" toggle if requested. */
  return all
    .filter(s => Number(s?.season_number || 0) > 0)
    .sort((a, b) => Number(a.season_number || 0) - Number(b.season_number || 0));
}

function formatDiscoverSeasonDate(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const d = new Date(raw + (raw.length === 10 ? 'T00:00:00' : ''));
  if (Number.isNaN(d.getTime())) return raw;
  try {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (_) { return raw; }
}

/* v11.016: app-wide rating display is 5-star. IMDb / TMDB ratings
   come through on a 10-star scale, so divide in half for display.
   Returned string is one-decimal: "4.3", "5.0", etc. Returns "" when
   the input is missing/zero so callers can hide the chip. */
function formatDiscoverSeasonRating(value) {
  const n = Number(value || 0);
  if (!(n > 0)) return '';
  return (n / 2).toFixed(1);
}

function computeSeasonAverageRating(episodes = []) {
  const rated = (Array.isArray(episodes) ? episodes : [])
    .map(ep => Number(ep?.vote_average || 0))
    .filter(v => v > 0);
  if (!rated.length) return 0;
  const sum = rated.reduce((a, b) => a + b, 0);
  /* Returns the raw 10-scale average — formatDiscoverSeasonRating
     does the /2 conversion for display. Callers that consume the
     numeric value (e.g. future sort) get the un-halved scale. */
  return sum / rated.length;
}

function getDiscoverSeasonPosterUrl(season = {}) {
  const path = String(season?.poster_path || '').trim();
  if (!path) return '';
  /* v11.091: Jikan supplies full https poster URLs (anime seasons) — pass
     them through unchanged; only TMDB relative paths get the image host. */
  if (/^https?:\/\//i.test(path)) return path;
  return `https://image.tmdb.org/t/p/w342${path}`;
}

/* v11.094: fetch per-episode synopsis + still image for an anime season from
   OMDb/IMDb (the worker resolves the series IMDb id by title, lists the season,
   and pulls each episode's Plot + Poster). Returns [] on any miss so the rows
   still render (title + air date) without synopsis/still. */
async function fetchOmdbAnimeEpisodeData(seriesTitle = '', seasonNum = 0, year = '') {
  const title = String(seriesTitle || '').trim();
  if (!title || !(Number(seasonNum) > 0)) return [];
  try {
    const params = new URLSearchParams({ title, season: String(seasonNum) });
    if (year) params.set('year', year);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let data = null;
    try {
      const res = await fetch(`/api/omdb/anime-episodes?${params.toString()}`, { signal: controller.signal });
      if (res.ok) data = await res.json();
    } finally {
      clearTimeout(timer);
    }
    return data && data.ok && Array.isArray(data.episodes) ? data.episodes : [];
  } catch (_) {
    return [];
  }
}

function getDiscoverEpisodeStillUrl(episode = {}) {
  const path = String(episode?.still_path || '').trim();
  if (!path) return '';
  /* v11.094: OMDb episode posters (anime) are full https URLs — pass through. */
  if (/^https?:\/\//i.test(path)) return path;
  return `https://image.tmdb.org/t/p/w300${path}`;
}

function renderDiscoverSeasonsPageShell(details = {}, id = '') {
  const title = getDiscoverMediaTitle(details, 'tv') || 'Series';
  const isAnime = String(id).startsWith('mal:') || details.isAnime || details.mediaCategory === 'anime';
  const seasons = getDiscoverSeasonsList(details);
  /* Anime seasons are assembled from Jikan after the page opens (relation
     walk) — show a loader instead of an empty state while that resolves. */
  const seasonsHtml = seasons.length
    ? seasons.map(s => renderDiscoverSeasonCard(s, id)).join('')
    : (isAnime
        ? '<div class="discover-season-loading" data-anime-seasons-loading><span aria-hidden="true"></span></div>'
        : '<div class="discover-seasons-empty">No season data available.</div>');
  return `<section class="discover-seasons-page-inner" role="dialog" aria-modal="true" aria-label="${escAttr(title)} episode and season details">
    <header class="discover-seasons-page-topbar">
      <button class="discover-seasons-page-back" type="button" onclick="event.stopPropagation();closeDiscoverSeasonsPage()" aria-label="Back">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4.5 3.5 10 9 15.5"/><path d="M16.5 10H4"/></svg>
      </button>
      <div class="discover-seasons-page-titles">
        <div class="discover-seasons-page-kicker">Episode &amp; Season Details</div>
        <div class="discover-seasons-page-title">${escHtml(title)}</div>
      </div>
    </header>
    <div class="discover-seasons-page-scroll">
      <div class="discover-seasons-list">${seasonsHtml}</div>
    </div>
  </section>`;
}

function renderDiscoverSeasonCard(season = {}, tvId = '') {
  const num = Number(season?.season_number || 0);
  const name = String(season?.name || `Season ${num}`).trim();
  const poster = getDiscoverSeasonPosterUrl(season);
  const air = formatDiscoverSeasonDate(season?.air_date || '');
  const epCount = Number(season?.episode_count || 0);
  const overview = String(season?.overview || '').trim();
  /* v11.017: NEVER preview TMDB `vote_average` on the season chip. The
     app's ratings rail is OMDb/IMDb only — TMDB scores have been the
     source of historical drift complaints (e.g. Members showing 5K vs
     527K). Always render the pending placeholder, then patch from OMDb
     once the season's per-episode IMDb ratings resolve. */
  return `<article class="discover-season-card" data-tv-id="${escAttr(tvId)}" data-season-num="${num}"${season.__malId ? ` data-mal-id="${escAttr(String(season.__malId))}"` : ''}>
    <button class="discover-season-card-head" type="button" aria-expanded="false" onclick="event.stopPropagation();toggleDiscoverSeasonCard(this)">
      <div class="discover-season-poster${poster ? '' : ' no-img'}" ${poster ? `style="background-image:url('${escAttr(poster)}')"` : ''} aria-hidden="true"></div>
      <div class="discover-season-meta">
        <div class="discover-season-name">${escHtml(name)}</div>
        <div class="discover-season-sub">
          ${air ? `<span>${escHtml(air)}</span>` : ''}
          ${epCount ? `<span>${epCount} ${epCount === 1 ? 'episode' : 'episodes'}</span>` : ''}
          <span class="discover-season-rating discover-season-rating-pending" data-season-rating-pending>★ —</span>
        </div>
      </div>
      <svg class="discover-season-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8.5 10 12.5l4-4"/></svg>
    </button>
    ${overview ? `<div class="discover-season-overview">${escHtml(overview)}</div>` : ''}
    <div class="discover-season-episodes"><div class="discover-season-episodes-inner"><div class="discover-season-episodes-pad" data-episodes-container></div></div></div>
  </article>`;
}

function renderDiscoverEpisodeRow(episode = {}) {
  const num = Number(episode?.episode_number || 0);
  const name = String(episode?.name || `Episode ${num}`).trim();
  const air = formatDiscoverSeasonDate(episode?.air_date || '');
  const runtime = Number(episode?.runtime || 0);
  const overview = String(episode?.overview || '').trim();
  const still = getDiscoverEpisodeStillUrl(episode);
  /* v11.017: render a PENDING rating chip on every row (data-episode-num
     on the row + data-episode-rating-chip on the span). After the
     season's OMDb fetch lands, `patchDiscoverEpisodeRowsWithOmdb` walks
     each row by episode-number and either fills the chip with the
     IMDb-via-OMDb rating (÷ 2 for the app's 5-star scale) or removes
     the chip if OMDb has no rating for that episode. TMDB
     `vote_average` is NEVER rendered — IMDb is the single rating
     source per the project's standing rule. */
  const ratingHtml = `<span class="discover-episode-rating discover-episode-rating-pending" data-episode-rating-chip>★ —</span>`;
  const metaParts = [
    air ? air : '',
    runtime ? `${runtime}m` : ''
  ].filter(Boolean).join(' · ');
  return `<div class="discover-episode-row" data-episode-num="${num}">
    <div class="discover-episode-still${still ? '' : ' no-img'}" ${still ? `style="background-image:url('${escAttr(still)}')"` : ''} aria-hidden="true"></div>
    <div class="discover-episode-copy">
      <div class="discover-episode-headline">
        <span class="discover-episode-num">${num}</span>
        <span class="discover-episode-name">${escHtml(name)}</span>
          ${ratingHtml}
      </div>
      ${metaParts ? `<div class="discover-episode-meta">${escHtml(metaParts)}</div>` : ''}
      ${overview ? `<div class="discover-episode-overview">${escHtml(overview)}</div>` : ''}
    </div>
  </div>`;
}

/* v11.017: per-tvId+season cache of the OMDb season payload so a second
   open of the same card is instant. Mirrors the existing
   `discoverSeasonsEpisodesCache` (TMDB) — separate keyspace because
   they're independent network calls and may invalidate at different
   cadences. */
const discoverSeasonsOmdbCache = new Map();
const discoverSeasonsOmdbInflight = new Map();

async function fetchDiscoverSeasonOmdbRatings(imdbShowId, seasonNum) {
  if (!imdbShowId || !(seasonNum > 0)) return null;
  const key = `${imdbShowId}:${seasonNum}`;
  if (discoverSeasonsOmdbCache.has(key)) return discoverSeasonsOmdbCache.get(key);
  if (discoverSeasonsOmdbInflight.has(key)) return discoverSeasonsOmdbInflight.get(key);
  const promise = (async () => {
    try {
      const url = `/api/omdb/season?imdbId=${encodeURIComponent(imdbShowId)}&season=${encodeURIComponent(seasonNum)}`;
      const res = await fetch(url);
      if (!res.ok) {
        console.warn('[v11.017] OMDb season fetch returned', res.status, 'for', key);
        return null;
      }
      const data = await res.json();
      if (!data || data.ok === false) {
        console.warn('[v11.017] OMDb season fetch not-ok for', key, data?.error || '');
        return null;
      }
      discoverSeasonsOmdbCache.set(key, data);
      return data;
    } catch (e) {
      console.warn('[v11.017] OMDb season fetch threw for', key, e);
      return null;
    } finally {
      discoverSeasonsOmdbInflight.delete(key);
    }
  })();
  discoverSeasonsOmdbInflight.set(key, promise);
  return promise;
}

/* Walk the just-rendered episode rows inside `container` and patch each
   chip from the OMDb season payload. Builds a Map for O(1) lookup so a
   30-episode season is still one pass. Rows without an OMDb rating
   drop the chip entirely (no fake placeholder kept). */
function patchDiscoverEpisodeRowsWithOmdb(container, omdb) {
  if (!container || !omdb || !Array.isArray(omdb.episodes)) return;
  const byNum = new Map();
  for (const ep of omdb.episodes) {
    if (ep && ep.episode > 0) byNum.set(ep.episode, ep);
  }
  const rows = container.querySelectorAll('.discover-episode-row[data-episode-num]');
  rows.forEach(row => {
    const n = Number(row.getAttribute('data-episode-num') || 0);
    const chip = row.querySelector('[data-episode-rating-chip]');
    if (!chip) return;
    const ep = byNum.get(n);
    const rating = Number(ep?.imdbRating || 0);
    if (rating > 0) {
      chip.textContent = `★ ${(rating / 2).toFixed(1)}`;
      chip.classList.remove('discover-episode-rating-pending');
    } else {
      chip.remove();
    }
  });
}

function patchDiscoverSeasonChipWithOmdb(card, omdb) {
  if (!card || !omdb) return;
  const chip = card.querySelector('[data-season-rating-pending]');
  if (!chip) return;
  const avgTen = Number(omdb.seasonAverage || 0);
  if (avgTen > 0) {
    chip.textContent = `★ ${(avgTen / 2).toFixed(1)}`;
    chip.classList.remove('discover-season-rating-pending');
    chip.removeAttribute('data-season-rating-pending');
  } else {
    chip.remove();
  }
}

/* v11.018: gradually pull the just-expanded season card up so its TOP
   edge lands right below the page header.

   Coordinate-space note (this is what v11.016 got wrong): the header
   (`.discover-seasons-page-topbar`) is a flex SIBLING that lives OUTSIDE
   `.discover-seasons-page-scroll` — the scroller's own top edge is
   already flush beneath the header. So the scroll target is simply the
   card's offset within the scroller (minus an 8px breathing gap). The
   old code subtracted the header height a second time, which under-
   scrolled and left the card sitting too low.

   The card-top target is stable from frame 0 of the expand (the card's
   top doesn't move — only its height below grows), so a single rAF read
   is accurate and we don't have to wait for the unfold to finish.
   `behavior: 'smooth'` gives the gradual glide (WKWebView honors it at
   120Hz on ProMotion). */
function scrollDiscoverSeasonCardIntoView(card) {
  if (!card) return;
  const scroller = card.closest('.discover-seasons-page-scroll');
  if (!scroller) return;
  requestAnimationFrame(() => {
    const scrollerRect = scroller.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    /* Card top relative to the scroller's current scrollTop. */
    const cardOffsetWithinScroller = (cardRect.top - scrollerRect.top) + scroller.scrollTop;
    /* 8px breathing gap below the header. */
    const target = Math.max(0, cardOffsetWithinScroller - 8);
    if (Math.abs(target - scroller.scrollTop) < 2) return;
    try {
      scroller.scrollTo({ top: target, behavior: 'smooth' });
    } catch {
      scroller.scrollTop = target;
    }
  });
}

async function toggleDiscoverSeasonCard(button) {
  const card = button?.closest?.('.discover-season-card');
  if (!card) return;
  const expanded = button.getAttribute('aria-expanded') === 'true';
  const container = card.querySelector('[data-episodes-container]');
  if (!container) return;
  if (expanded) {
    /* v11.016: smooth COLLAPSE — drop `.is-expanded` and let the CSS
       `grid-template-rows: 1fr → 0fr` transition (300ms, ProMotion-
       friendly cubic-bezier(0.16, 1, 0.3, 1)) carry the close. No
       `[hidden]` toggle because that would `display:none` mid-flight
       and kill the animation. */
    button.setAttribute('aria-expanded', 'false');
    card.classList.remove('is-expanded');
    return;
  }
  button.setAttribute('aria-expanded', 'true');
  card.classList.add('is-expanded');
  /* v11.016: auto-pull the expanded card to just below the sticky
     topbar so users who tap a card mid-list don't have to scroll to
     see the freshly revealed episodes. */
  scrollDiscoverSeasonCardIntoView(card);
  const tvId = card.getAttribute('data-tv-id') || '';
  const seasonNum = Number(card.getAttribute('data-season-num') || 0);
  if (!tvId || !seasonNum) return;

  /* v11.090: anime season — episode list from Jikan (per this season's own
     mal_id), kept SEPARATE from every other season.
     v11.094: per-episode SYNOPSIS + STILL image are pulled from OMDb/IMDb
     (Jikan exposes neither) and merged in by episode number. */
  const animeMalId = card.getAttribute('data-mal-id') || '';
  if (animeMalId) {
    const animeCacheKey = `mal:${animeMalId}`;
    let animeEps = discoverSeasonsEpisodesCache.get(animeCacheKey);
    if (!animeEps) {
      container.innerHTML = '<div class="discover-season-loading"><span aria-hidden="true"></span></div>';
      try {
        const seriesDetails = activeDiscoverMediaProfileState?.details || {};
        const seriesTitle = getDiscoverMediaTitle(seriesDetails, 'tv') || '';
        const seriesYear = getDiscoverMediaDate(seriesDetails, 'tv').slice(0, 4);
        const [raw, omdbEps] = await Promise.all([
          (window.JikanAnime && window.JikanAnime.animeEpisodes(animeMalId)) || [],
          fetchOmdbAnimeEpisodeData(seriesTitle, seasonNum, seriesYear)
        ]);
        const omdbByNum = {};
        (omdbEps || []).forEach(e => { const n = Number(e.episode) || 0; if (n) omdbByNum[n] = e; });
        animeEps = (raw || []).map(ep => {
          const n = Number(ep.number) || 0;
          const o = omdbByNum[n] || {};
          return {
            episode_number: n,
            name: ep.title || o.title || `Episode ${n}`,
            air_date: String(ep.aired || '').slice(0, 10) || o.released || '',
            runtime: 0,
            overview: o.plot || '',
            still_path: o.poster || ''
          };
        });
        /* If Jikan had no episode list but OMDb did, build rows from OMDb. */
        if (!animeEps.length && Array.isArray(omdbEps) && omdbEps.length) {
          animeEps = omdbEps.map(o => ({
            episode_number: Number(o.episode) || 0,
            name: o.title || `Episode ${o.episode}`,
            air_date: o.released || '',
            runtime: 0,
            overview: o.plot || '',
            still_path: o.poster || ''
          }));
        }
        discoverSeasonsEpisodesCache.set(animeCacheKey, animeEps);
      } catch (e) {
        container.innerHTML = '<div class="discover-season-error">Could not load episodes. Try again later.</div>';
        return;
      }
    }
    container.innerHTML = animeEps.length
      ? animeEps.map(renderDiscoverEpisodeRow).join('')
      : '<div class="discover-season-empty">No episode data available for this season.</div>';
    return;
  }

  const cacheKey = `${tvId}:${seasonNum}`;
  let episodes = discoverSeasonsEpisodesCache.get(cacheKey);
  if (!episodes) {
    container.innerHTML = '<div class="discover-season-loading"><span aria-hidden="true"></span></div>';
    try {
      const res = await fetchTmdbProxy(`tv/${encodeURIComponent(tvId)}/season/${seasonNum}`);
      if (!res.ok) throw new Error(`TMDB season fetch failed: ${res.status}`);
      const data = await res.json();
      episodes = Array.isArray(data?.episodes) ? data.episodes : [];
      discoverSeasonsEpisodesCache.set(cacheKey, episodes);
    } catch (e) {
      container.innerHTML = '<div class="discover-season-error">Could not load episodes. Try again later.</div>';
      console.warn('[v11.014] season fetch failed:', e);
      return;
    }
  }
  if (!episodes.length) {
    container.innerHTML = '<div class="discover-season-empty">No episode data available for this season.</div>';
    return;
  }
  container.innerHTML = episodes.map(renderDiscoverEpisodeRow).join('');
  /* v11.017: fetch IMDb-via-OMDb ratings for every episode in one
     call, then patch each row + the season-card head chip. Show-level
     IMDb id lives on the cached details payload (set when the discover
     media profile loaded). If the show has no IMDb id, all chips stay
     in their pending state and then drop themselves below. */
  const details = getDiscoverSeasonsCachedDetails(tvId);
  const imdbShowId = String(details?.external_ids?.imdb_id || details?.imdb_id || '').trim();
  if (imdbShowId) {
    const omdb = await fetchDiscoverSeasonOmdbRatings(imdbShowId, seasonNum);
    if (omdb) {
      patchDiscoverEpisodeRowsWithOmdb(container, omdb);
      patchDiscoverSeasonChipWithOmdb(card, omdb);
    } else {
      /* OMDb failed/empty — drop all pending chips so users don't see
         dangling "★ —" placeholders forever. */
      container.querySelectorAll('[data-episode-rating-chip]').forEach(el => el.remove());
      card.querySelector('[data-season-rating-pending]')?.remove();
    }
  } else {
    console.warn('[v11.017] No IMDb id on show details — dropping pending rating chips for', tvId);
    container.querySelectorAll('[data-episode-rating-chip]').forEach(el => el.remove());
    card.querySelector('[data-season-rating-pending]')?.remove();
  }
}

/* v11.214: block iOS double-tap-zoom + pinch-zoom on the Episode & Season
   Details overlay. Mirrors installMyListGameProfileZoomGuards — the CSS
   touch-action:manipulation approach didn't take in this WKWebView. */
function installDiscoverSeasonsZoomGuards(overlay) {
  if (!overlay || overlay.__shelfdSeasonsZoomGuards) return;
  overlay.__shelfdSeasonsZoomGuards = true;
  let lastTouchEnd = 0;
  overlay.addEventListener('touchend', event => {
    const now = Date.now();
    /* Exempt form fields so long-press / paste / selection still work. */
    const onField = event.target?.closest?.('input, textarea, select, [contenteditable]');
    if (now - lastTouchEnd <= 320 && !onField) {
      event.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });
  overlay.addEventListener('gesturestart', event => {
    event.preventDefault();
  }, { passive: false });
}

function openDiscoverSeasonsPage(type, id) {
  if (type !== 'tv' || !id) return;
  const details = getDiscoverSeasonsCachedDetails(id);
  if (!details) return;
  closeDiscoverSeasonsPage({ instant: true });
  resetDiscoverSeasonsOverlayTimers();
  const overlay = document.createElement('div');
  overlay.id = 'discover-seasons-page';
  overlay.className = 'discover-seasons-page';
  overlay.dataset.tvId = String(id);
  overlay.dataset.phase = 'opening';
  overlay.innerHTML = renderDiscoverSeasonsPageShell(details, id);
  document.body.appendChild(overlay);
  document.body.classList.add('discover-seasons-page-open');
  /* v11.214: JS double-tap-zoom guard. `touch-action: manipulation` (v11.213)
     alone did NOT stop double-tap zoom in this WKWebView (the app viewport meta
     has no user-scalable=no / maximum-scale=1), so we replicate the proven
     overlay guard used by the game profile (installMyListGameProfileZoomGuards):
     swallow the second tap of a <=320ms double-tap and preventDefault the
     pinch `gesturestart`. Form fields are exempt so iOS paste/selection still
     works. */
  installDiscoverSeasonsZoomGuards(overlay);
  /* Slide-in animation: start off-screen-right → translate3d(0). Uses
     two rAFs so the initial transform is committed before the
     transition kicks in (avoids a snap on first paint). */
  overlay.style.transform = 'translate3d(100%, 0, 0)';
  overlay.style.opacity = '0';
  overlay.style.transition = 'none';
  void overlay.offsetWidth;
  discoverSeasonsOpenFrameA = requestAnimationFrame(() => {
    discoverSeasonsOpenFrameA = 0;
    discoverSeasonsOpenFrameB = requestAnimationFrame(() => {
      discoverSeasonsOpenFrameB = 0;
      if (!document.body.contains(overlay)) return;
      if (overlay.dataset.phase === 'closing') return;
      overlay.dataset.phase = 'open';
      overlay.style.transition = `transform ${DISCOVER_SEASONS_PAGE_OPEN_MS}ms cubic-bezier(0.18, 0.92, 0.18, 1), opacity 220ms ease`;
      overlay.style.transform = 'translate3d(0, 0, 0)';
      overlay.style.opacity = '1';
    });
  });
  activeDiscoverSeasonsState = { tvId: id, openedAt: Date.now() };
  const isAnime = String(id).startsWith('mal:') || details.isAnime || details.mediaCategory === 'anime';
  if (isAnime) {
    /* Assemble seasons from Jikan (relation walk) and render them — kept as
       SEPARATE seasons, each lazy-loading its own episodes from Jikan. */
    hydrateDiscoverAnimeSeasonsPage(overlay, id, details);
  } else {
    /* v11.017: prefetch OMDb season ratings for every season card so the
       `★ —` placeholder gets replaced with the real IMDb-derived chip
       even before the user expands the card. */
    prefetchDiscoverSeasonChipsInBackground(overlay, id);
  }
}

/* v11.091: patch an anime profile's Seasons / Episodes facts + the
   "Episode & Season Details" meta with the SERIES totals (summed across all
   Jikan seasons), since a single Jikan entry only knows its own season's
   numbers (e.g. JJK reported "1 season / 24 episodes" instead of 3 / ~59). */
async function hydrateAnimeSeriesCounts(overlay, id, details) {
  try {
    const J = window.JikanAnime;
    if (!J || typeof J.getSeriesSeasons !== 'function' || !overlay || !details) return;
    const malId = String(details.malId || details.mal_id || (String(id).startsWith('mal:') ? String(id).slice(4) : '')).replace(/[^0-9]/g, '');
    if (!malId) return;
    let seasons = [];
    try { seasons = await J.getSeriesSeasons(malId); } catch (_) {}
    if (!Array.isArray(seasons) || !seasons.length) return;
    const totalSeasons = seasons.length;
    const totalEpisodes = seasons.reduce((sum, s) => sum + (Number(s.episodes || 0) || 0), 0);
    /* Only patch if still on the same profile. */
    if (document.getElementById('discover-media-profile') !== overlay || !document.body.contains(overlay)) return;
    if (activeDiscoverMediaProfileState && activeDiscoverMediaProfileState.id !== id) return;
    const seasonsStrong = overlay.querySelector('.discover-media-fact-seasons strong');
    if (seasonsStrong && totalSeasons > 0) seasonsStrong.textContent = String(totalSeasons);
    const epsStrong = overlay.querySelector('.discover-media-fact-episodes strong');
    if (epsStrong && totalEpisodes > 0) epsStrong.textContent = String(totalEpisodes);
    const meta = overlay.querySelector('.discover-media-seasons-entry-meta');
    if (meta) {
      const parts = [];
      if (totalSeasons > 0) parts.push(`${totalSeasons} ${totalSeasons === 1 ? 'season' : 'seasons'}`);
      if (totalEpisodes > 0) parts.push(`${totalEpisodes} ${totalEpisodes === 1 ? 'episode' : 'episodes'}`);
      if (parts.length) meta.textContent = parts.join(' · ');
    }
    /* Persist on the cached details so re-renders keep the right totals. */
    details.number_of_seasons = totalSeasons;
    details.number_of_episodes = totalEpisodes;
  } catch (_) {}
}

/* v11.090: build the anime "Episode & Season Details" list from Jikan. Each
   related TV/ONA entry is rendered as its own SEPARATE season card (never
   merged into one long list); episodes lazy-load per card from Jikan. */
async function hydrateDiscoverAnimeSeasonsPage(overlay, id, details) {
  const J = window.JikanAnime;
  const listEl = overlay && overlay.querySelector('.discover-seasons-list');
  if (!J || typeof J.getSeriesSeasons !== 'function' || !listEl) return;
  const malId = String(details.malId || details.mal_id || (String(id).startsWith('mal:') ? String(id).slice(4) : '')).replace(/[^0-9]/g, '');
  if (!malId) { listEl.innerHTML = '<div class="discover-seasons-empty">No season data available.</div>'; return; }
  let seasons = [];
  try { seasons = await J.getSeriesSeasons(malId); } catch (_) {}
  if (!document.body.contains(listEl)) return;       /* page closed mid-load */
  if (!seasons.length) {
    try { const basic = await J.getAnimeBasic(malId); if (basic) seasons = [basic]; } catch (_) {}
  }
  if (!document.body.contains(listEl)) return;
  if (!seasons.length) { listEl.innerHTML = '<div class="discover-seasons-empty">No season data available.</div>'; return; }
  listEl.innerHTML = seasons.map((s, i) => renderDiscoverSeasonCard({
    season_number: i + 1,
    name: s.title || `Season ${i + 1}`,
    episode_count: Number(s.episodes || 0) || 0,
    air_date: s.airedFrom || (s.year ? `${s.year}-01-01` : ''),
    poster_path: s.image || '',
    __malId: s.malId
  }, id)).join('');
}
window.openDiscoverSeasonsPage = openDiscoverSeasonsPage;
window.toggleDiscoverSeasonCard = toggleDiscoverSeasonCard;

async function prefetchDiscoverSeasonChipsInBackground(overlay, tvId) {
  if (!overlay || !tvId) return;
  const details = getDiscoverSeasonsCachedDetails(tvId);
  const imdbShowId = String(details?.external_ids?.imdb_id || details?.imdb_id || '').trim();
  if (!imdbShowId) return;
  const cards = Array.from(overlay.querySelectorAll('.discover-season-card[data-season-num]'));
  for (const card of cards) {
    /* Bail if the user closed the page mid-loop. */
    if (!document.body.contains(card)) return;
    const seasonNum = Number(card.getAttribute('data-season-num') || 0);
    if (!(seasonNum > 0)) continue;
    /* Don't re-patch a card that's already been expanded (its chip is
       already filled, possibly with a fresher value from the cache). */
    if (!card.querySelector('[data-season-rating-pending]')) continue;
    try {
      const omdb = await fetchDiscoverSeasonOmdbRatings(imdbShowId, seasonNum);
      if (omdb) patchDiscoverSeasonChipWithOmdb(card, omdb);
    } catch (_) { /* swallow — chip stays pending */ }
    /* 60ms stagger — keeps the worker happy without a noticeable delay
       on the user side (the chips fill in left-to-right). */
    await new Promise(r => setTimeout(r, 60));
  }
}

function closeDiscoverSeasonsPage(options = {}) {
  const overlay = document.getElementById('discover-seasons-page');
  resetDiscoverSeasonsOverlayTimers();
  if (!overlay) {
    document.body.classList.remove('discover-seasons-page-open');
    activeDiscoverSeasonsState = null;
    return;
  }
  const phase = String(overlay.dataset.phase || '');
  if (options && options.instant || phase === 'opening') {
    overlay.remove();
    document.body.classList.remove('discover-seasons-page-open');
    activeDiscoverSeasonsState = null;
    return;
  }
  if (phase === 'closing') return;
  overlay.dataset.phase = 'closing';
  overlay.style.pointerEvents = 'none';
  overlay.style.transition = `transform ${DISCOVER_SEASONS_PAGE_CLOSE_MS}ms cubic-bezier(0.40, 0, 1, 0.80), opacity 220ms ease`;
  overlay.style.transform = 'translate3d(100%, 0, 0)';
  overlay.style.opacity = '0';
  discoverSeasonsCloseTimer = window.setTimeout(() => {
    discoverSeasonsCloseTimer = 0;
    overlay.remove();
    document.body.classList.remove('discover-seasons-page-open');
    activeDiscoverSeasonsState = null;
  }, DISCOVER_SEASONS_PAGE_CLOSE_MS + 20);
}
window.closeDiscoverSeasonsPage = closeDiscoverSeasonsPage;

let discoverResizeTimer = null;
