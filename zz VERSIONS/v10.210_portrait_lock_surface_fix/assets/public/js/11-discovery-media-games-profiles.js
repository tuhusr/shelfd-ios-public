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
  /* v743: cap to 12 final titles, no show-more — fetch only 2 TMDB pages
     (~40 candidates) instead of 5 (~100). Smaller candidate pool means
     fewer OMDb enrichment requests. Top 12 by imdbVotes still surface. */
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
    .map(item => ({
      ...item,
      media_type: mediaType
    }))
    .slice(0, 30);
  await window.enrichItemsWithImdbRatings?.(filtered, mediaType);
  const ranked = (window.rankDiscoverTitles || (() => filtered))('trending', filtered, {
    mediaType
  });
  return ranked
    .map(item => ({
      ...item,
      discoverContext: buildDiscoverTmdbContext('Weekly trending', item)
    }))
    .slice(0, 12);
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

const DISCOVER_RANKING_CACHE_VERSION = 'v219';

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
    : (Number(item.imdbRating || 0) > 0 ? Number(item.imdbRating).toFixed(1) : '');
  const imdbVotes = Number(item.imdbVotes || 0);
  if (ratingText) parts.push(`${ratingText} IMDb`);
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
    .slice(0, 12);
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

async function fetchTmdbSearchResults(query, options = {}) {
  /* v739: `strictPrefix` (default true) drops every result that doesn't
     prefix-match the query — useful for the discover hub where the user
     expects laser-focus on what they typed. The bottom-nav search page
     calls this with strictPrefix=false because it has its own relevance
     scoring + popularity boost and needs the wider result pool so popular
     titles like "Marvel's Spider-Man" aren't pre-filtered out before they
     can be ranked. */
  const strictPrefix = options.strictPrefix !== false;
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
  const filtered = strictPrefix ? preferDiscoverUniversalPrefixMatches(items, query) : items;
  /* v740: when !strictPrefix (search page), sort by raw popularity so the
     20-item slice downstream doesn't kill popular partial-matches. The
     search page does its own normalize-relevance + popularity ranking;
     this just guarantees popular items aren't pre-filtered to oblivion. */
  /* v934: always use the unified scorer (text match → recency → popularity).
     The old !strictPrefix branch sorted by raw vote_count + popularity first,
     which bypassed recency entirely and buried new releases. */
  return filtered
    .sort((a, b) => {
      const scoreCompare = scoreDiscoverUniversalTmdbResult(b, query) - scoreDiscoverUniversalTmdbResult(a, query);
      if (scoreCompare) return scoreCompare;
      return String((a.title || a.name || '')).localeCompare(String(b.title || b.name || ''), undefined, { sensitivity: 'base' });
    })
    .slice(0, strictPrefix ? DISCOVER_LIMIT : 100);
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
let discoverUniversalSearchDefaultLoading = false;
const DISCOVER_UNIVERSAL_SEARCH_DEBOUNCE_MS = 90;
const DISCOVER_UNIVERSAL_SEARCH_DEFAULT_LIMIT = 21;

function normalizeDiscoverUniversalSearchSource(source = '') {
  const key = String(source || '').trim().toLowerCase();
  if (!key || key === 'all' || key === 'all-media' || key === 'all_media' || key === 'tmdb') return 'movie';
  if (key === 'gaming' || key === 'games' || key === 'game' || key === 'rawg') return 'rawg';
  if (key === 'anime') return 'anime';
  if (key === 'music') return 'music';
  if (key === 'movies' || key === 'movie') return 'movie';
  if (key === 'tv' || key === 'shows' || key === 'show') return 'tv';
  return 'movie';
}

function getDiscoverUniversalSearchPlaceholder(source = discoverUniversalSearchSource) {
  if (source === 'rawg') return 'Search games';
  if (source === 'anime') return 'Search anime';
  if (source === 'music') return 'Search music';
  if (source === 'movie') return 'Search movies';
  if (source === 'tv') return 'Search TV shows';
  return 'Search movies';
}

function getDiscoverUniversalSearchFilterGridId(source = discoverUniversalSearchSource) {
  const normalized = normalizeDiscoverUniversalSearchSource(source);
  if (normalized === 'movie') return 'discover-movie-universal-search-grid';
  if (normalized === 'tv') return 'discover-tv-universal-search-grid';
  if (normalized === 'anime') return 'anime-discover-universal-search-grid';
  return '';
}

function isDiscoverUniversalSearchFilterable(source = discoverUniversalSearchSource) {
  return ['movie', 'tv', 'anime'].includes(normalizeDiscoverUniversalSearchSource(source));
}

function getDefaultDiscoverUniversalSearchSource() {
  if (activeDiscoveryHub === 'anime') return 'anime';
  if (activeDiscoveryHub === 'gaming') return 'rawg';
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

function closeDiscoverUniversalSearch() {
  const overlay = document.getElementById('discover-universal-search-overlay');
  if (!overlay) return;
  if (typeof window.closeDiscoverSearchPresetHub === 'function') {
    window.closeDiscoverSearchPresetHub();
  }
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
    genreNames: getDiscoverGenreNames(item, itemType),
    /* v654: forward Jikan markers so the profile-open path knows to use Jikan. */
    __jikan: !!item.__jikan,
    __mal_id: item.__mal_id || 0
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
    if (source === 'music') {
      grid.innerHTML = '<div class="discover-universal-search-empty">Music search is not connected yet.</div>';
      return;
    }
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
  if (normalized === 'tmdb') return 'mixed';
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
    if (normalized === 'planned') return 'Backloggd';
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
    <div class="discover-friends-modal-rule">Icons appear when this title is in a friend’s Watching or Watchlist. For games, icons appear when the game is in Playing or Backloggd.</div>
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
  destroyDiscoverHeroTrailerPreview(overlay);
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
  overlay?.classList?.remove('media-profile-trailer-expanding', 'media-profile-trailer-fullscreen', 'media-profile-trailer-collapsing', 'media-profile-trailer-gesture', 'media-profile-trailer-animating', 'media-profile-trailer-controls-hidden', 'media-profile-trailer-aspect-preserve', 'media-profile-trailer-landscape');
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
    const sourceAspect = Math.max(0.01, start.width / Math.max(1, start.height));
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
  overlay.classList.remove('media-profile-trailer-expanding', 'media-profile-trailer-collapsing', 'media-profile-trailer-gesture', 'media-profile-trailer-animating', 'media-profile-trailer-aspect-preserve');
  overlay.classList.add('media-profile-trailer-fullscreen');
  document.body.classList.remove('media-profile-trailer-transition-active');
  document.body.classList.add('media-profile-trailer-fullscreen-active');
  if (activeDiscoverHeroTrailerExpansionState) activeDiscoverHeroTrailerExpansionState.direction = 'expand';
  applyDiscoverHeroTrailerExpansionProgress(overlay, 1);
  setDiscoverHeroTrailerControlsVisible(overlay, true);
  ensureDiscoverHeroTrailerPlayer(overlay);
  startDiscoverHeroTrailerProgressLoop(preview);
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
  closeDiscoverHeroTrailerLandscapeMode(overlay);
  overlay?.classList?.remove('media-profile-trailer-fullscreen', 'media-profile-trailer-expanding');
  overlay?.classList?.add('media-profile-trailer-collapsing');
  activeDiscoverHeroTrailerExpansionState.direction = 'collapse';
  animateDiscoverHeroTrailerExpansionTo(overlay, 0, () => resetDiscoverHeroTrailerExpansionState(overlay));
}

function collapseDiscoverHeroTrailerPreview(overlay = document.getElementById('discover-media-profile'), options = {}) {
  if (!overlay?.classList?.contains('media-profile-trailer-fullscreen') && !overlay?.classList?.contains('media-profile-trailer-collapsing')) return false;
  closeDiscoverHeroTrailerLandscapeMode(overlay);
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

function closeDiscoverHeroTrailerLandscapeMode(overlay = document.getElementById('discover-media-profile')) {
  if (!isDiscoverHeroTrailerLandscape(overlay)) return false;
  overlay.classList.remove('media-profile-trailer-landscape');
  document.body.classList.remove('media-profile-trailer-landscape-active');
  overlay.querySelectorAll?.('.discover-media-hero-preview-native-fullscreen')?.forEach(button => {
    button.setAttribute('aria-label', 'Open landscape trailer');
  });
  setDiscoverHeroTrailerControlsVisible(overlay, true);
  refreshDiscoverHeroTrailerFullscreenLayout();
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
    closeDiscoverHeroTrailerLandscapeMode(overlay);
    return false;
  }
  if (isDiscoverHeroTrailerFullscreen(overlay)) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    collapseDiscoverHeroTrailerPreview(overlay);
    return false;
  }
  closeDiscoverMediaProfile('back');
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
    ensureDiscoverHeroTrailerPlayer(overlay);
  };
  frame.appendChild(iframe);
  activeDiscoverHeroTrailerPreviewCleanup = () => {
    releaseBounds();
    stopDiscoverHeroTrailerProgressLoop(preview);
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
    /* v676: MyAnimeList Members count — only present for Jikan-sourced
       anime (mapJikanFullToTmdbDetails sets `details.malMembers`).
       Formatted with comma separators e.g. 4,033,081. */
    if (Number(details.malMembers) > 0) {
      facts.push({
        label: 'Members',
        value: Number(details.malMembers).toLocaleString('en-US'),
        priority: true
      });
    }
    if (date) facts.push({ label: 'First Aired', value: date });
    if (country) facts.push({ label: 'Country', value: country });
    if (details.status) facts.push({ label: 'Status', value: details.status });
    if (details.type) facts.push({ label: 'Type', value: details.type });
  }
  /* v676: bumped 6 → 7 so anime can fit Members alongside the other six. */
  return facts.slice(0, 7);
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
  const shareTitle = payload.title ? `${payload.title} on Shelfd` : 'Shelfd';
  const urlObj = new URL(payload.url, window.location.origin);
  if (payload.title) urlObj.searchParams.set('title', payload.title);
  if (/^https?:\/\//i.test(payload.poster)) urlObj.searchParams.set('poster', payload.poster);
  const shareUrl = urlObj.toString();
  try {
    if (navigator.share) {
      await navigator.share({ title: shareTitle, url: shareUrl });
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
    if (eventTarget?.closest('[data-discover-trailer-control]')) return;
    const trailerPreviewTarget = eventTarget?.closest('[data-discover-hero-trailer-preview]');
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
    const trailerAvailable = hasDiscoverHeroTrailerPreview(overlay);
    const trailerFullscreen = isDiscoverHeroTrailerFullscreen(overlay);
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
      <div class="discover-media-library-actions">
        <button class="discover-media-library-choice planned" type="button" data-status="planned">
          <span>${isGame ? 'Backloggd' : 'Watchlist'}</span>
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
    /* v10.123: revert-text for the FPMP button is now "+" so a cancelled
       or failed add restores the same bare "+" label the button starts
       with (was "+ Add to Library"). */
    await addDiscoveryTitle(type, id, btn, status, '+', rating, { postPromptDelayMs: 820 });
    dock.classList.remove('saving');
    dock.classList.add('saved');
    const savedLabel = status === 'watched'
      ? (rating ? `Rated ${formatRatingValueForSection(rating, ratingSection, true)}` : (isGame ? 'Marked Played' : 'Marked Watched'))
      : (isGame ? 'Saved to Backloggd' : 'Saved to Watchlist');
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
    <button class="discover-media-back" type="button" onclick="backToDiscoverTitleProfile()">Back</button>
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
  const rating = Number(item?.imdbRating || 0);
  return rating > 0 ? rating.toFixed(1) : '';
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
    <button class="discover-media-back" type="button" onclick="backToDiscoverTitleProfile()">Back</button>
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
  const imdbRating = Number(item?.imdbRating || 0);
  const ratingText = imdbRating > 0 ? imdbRating.toFixed(1) : '—';
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
  const sourceRect = getMediaProfileOriginRect(sourceElement);
  if (!sourceRect) return null;
  try {
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
  overlay.innerHTML = renderDiscoverPersonProfileDetails(details);
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
  const openingPortalInfo = createDiscoverPersonHeroPortal(getDiscoverPersonHeroOriginElement(trigger));
  destroyDiscoverHeroTrailerPreview(overlay);
  overlay.innerHTML = renderDiscoverPersonProfileShell(personSeed);
  bindDiscoverMediaProfileSwipeBack(overlay);
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
  const closingPortalInfo = createDiscoverPersonHeroPortal(getDiscoverPersonHeroTargetElement(overlay));
  activeDiscoverMediaProfileState = previousState;
  overlay.innerHTML = renderDiscoverMediaProfileDetails(previousState.type, previousState.details, previousState.id);
  bindDiscoverMediaProfileActions(overlay);
  hydrateDiscoverHeroTrailerPreview(overlay);
  hydrateDeepSeekMoreLikeThis(previousState.type, previousState.details);
  hydrateDiscoverProviderLogoFallbacks();
  restoreDiscoverMediaProfileScrollStable(overlay, previousState.mediaProfileScrollTop || 0);
  requestAnimationFrame(() => {
    restoreDiscoverMediaProfileScrollStable(overlay, previousState.mediaProfileScrollTop || 0);
    const target = getDiscoverPersonReturnTargetElement(previousState.personHeroOriginId, overlay);
    animateDiscoverPersonHeroPortal(closingPortalInfo, target, () => {
      restoreDiscoverMediaProfileScrollStable(overlay, previousState.mediaProfileScrollTop || 0, 2);
    });
  });
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

function renderDiscoverMediaProfileDetails(type, details, id) {
  const title = getDiscoverMediaTitle(details, type);
  const poster = getDiscoverMediaPoster(details);
  const backdrop = getDiscoverMediaBackdrop(details);
  const year = getDiscoverMediaDate(details, type).slice(0, 4);
  const genres = (details.genres || []).map(g => g.name).filter(Boolean).slice(0, 4);
  const facts = getDiscoverMediaFacts(type, details);
  const score = typeof window.formatDisplayTitleRating === 'function'
    ? window.formatDisplayTitleRating(details)
    : (Number(details.imdbRating || 0) > 0 ? Number(details.imdbRating).toFixed(1) : '');
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

  /* v10.127: Trailer CTA + sound toggle moved into the top-right
     action row so they share the same right-aligned column.
     v10.128: Trailer CTA passed as its own arg so the action-row
     builder can pair it horizontally with the "+" button (row 1),
     while Share (row 2) and Mute toggle (row 3) stay as solo rows. */
  return `<section class="discover-media-page${isDesktopTitleProfile ? ' discover-standard-title-page discover-desktop-title-page' : ''}" role="dialog" aria-modal="true" aria-label="${escAttr(title)} details">
    <button class="discover-media-back" type="button" onclick="closeDiscoverMediaProfile('back')">Back</button>
    ${renderMediaProfileTopActions(renderMediaProfileShareButton(getShareableMediaKind(type, details), id, title, poster), renderDiscoverMediaProfileAddButton(type, id, details), renderDiscoverHeroTrailerPreviewCta(trailer, title), renderDiscoverHeroTrailerSoundToggle(trailer))}
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
      ${(facts.length || creators.length || writers.length || companies.length || networks.length) ? `<div class="discover-media-detail-grid">
        ${(facts.length || creators.length || writers.length || companies.length || networks.length) ? `<div class="discover-media-detail-stack">
          ${facts.length ? `<div class="discover-media-facts">${facts.map(fact => `<div class="${fact.priority ? 'primary' : ''}"><strong>${escHtml(fact.value)}</strong><span>${escHtml(fact.label)}</span></div>`).join('')}</div>` : ''}
          ${(creators.length || writers.length || companies.length || networks.length) ? `<div class="discover-media-credits">
            ${creators.length ? `<div><span>${type === 'tv' ? 'Created By' : 'Directed By'}</span><strong>${escHtml(creators.join(', '))}</strong></div>` : ''}
            ${writers.length ? `<div><span>Written By</span><strong>${escHtml(writers.join(', '))}</strong></div>` : ''}
            ${companies.length || networks.length ? `<div><span>${type === 'tv' ? 'Network' : 'Studio'}</span><strong>${escHtml((networks.length ? networks : companies).join(', '))}</strong></div>` : ''}
          </div>` : ''}
        </div>` : ''}
      </div>` : ''}
      ${cast.length ? `<div class="discover-media-section discover-media-section-cast"><h3>Cast</h3><div class="discover-media-cast">${cast.map(person => renderDiscoverCastCard(person)).join('')}</div>${castHasMore ? `<button class="media-cast-show-all" type="button" onclick="openMediaCastPage()">Show All<span class="media-cast-show-all-count" aria-hidden="true">${escHtml(castAll.length)}</span></button>` : ''}</div>` : ''}
      ${charactersPreview.length ? `<div class="discover-media-section discover-media-section-characters"><h3>Characters</h3><div class="discover-media-cast discover-media-characters">${charactersPreview.map(renderAnimeCharacterCard).join('')}</div>${charactersHasMore ? `<button class="media-cast-show-all media-characters-show-all" type="button" onclick="openMediaCharactersPage()">Show All<span class="media-cast-show-all-count" aria-hidden="true">${escHtml(charactersAll.length)}</span></button>` : ''}</div>` : ''}
      ${renderDeepSeekMoreLikeThisSection(type, details)}
    </div>
  </section>`;
}

async function openDiscoverMediaProfile(event, type, id, transitionOrigin = null, options = null) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if ((type !== 'movie' && type !== 'tv') || !id) return;
  const fromFilmography = !!options?.fromFilmography;
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
    overlay.innerHTML = renderDiscoverMediaProfileShell(seed, type, id);
    bindDiscoverMediaProfileActions(overlay);
    document.body.classList.add('discover-media-profile-open', 'filmography-title-profile-open');
    document.addEventListener('keydown', handleDiscoverMediaProfileEsc);
    overlay.classList.add('open');
    activeDiscoverMediaProfileState = {
      view: 'title',
      type,
      id,
      details: seed,
      filmographyReturn
    };
  } else {
    closeDiscoverMediaProfile();
    overlay = document.createElement('div');
    overlay.id = 'discover-media-profile';
    overlay.className = 'discover-media-profile-overlay';
    if (isActivityMediaProfileOrigin(transitionOrigin)) overlay.classList.add('activity-origin-media-profile');
    overlay.innerHTML = renderDiscoverMediaProfileShell(seed, type, id);
    bindDiscoverMediaProfileActions(overlay);
    document.body.appendChild(overlay);
    document.body.classList.add('discover-media-profile-open');
    document.addEventListener('keydown', handleDiscoverMediaProfileEsc);
    revealMediaProfileOverlay(overlay, transitionOrigin, event);
  }
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
    /* v671: resolve IMDb rating + votes from OMDb so the hero score reflects
       IMDb instead of TMDB. Cached client-side for 7 days, server-side for 7
       days, so subsequent opens are instant. */
    if (!details.imdbRating && typeof window.getImdbRatingForMedia === 'function') {
      try {
        const imdbId = details.external_ids?.imdb_id || details.imdbID || '';
        const titleForLookup = type === 'movie'
          ? (details.title || details.original_title || '')
          : (details.name || details.original_name || '');
        const yearForLookup = (details.release_date || details.first_air_date || '').slice(0, 4);
        const imdbInfo = await window.getImdbRatingForMedia({
          tmdbId: id,
          imdbId,
          type,
          title: titleForLookup,
          year: yearForLookup
        });
        if (imdbInfo && imdbInfo.ok) {
          details.imdbRating = imdbInfo.imdbRating;
          details.imdbVotes = imdbInfo.imdbVotesNumber;
          details.imdbVotesText = imdbInfo.imdbVotes;
          details.imdbId = imdbInfo.imdbId;
          /* Overwrite TMDB rating fields so anything reading vote_average
             on this details object now sees IMDb. */
          details.vote_average = imdbInfo.imdbRating;
          details.vote_count = imdbInfo.imdbVotesNumber;
          details.ratingSource = 'imdb';
          discoverMediaProfileCache.set(key, details);
        }
      } catch (e) { /* silent — leave IMDb score hidden if lookup fails */ }
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
      /* v677: also re-run hydrate when malMembers isn't set yet — the
         hydrate call now writes Jikan community stats (members, favorites,
         score, rank, popularity) onto the merged details so the Members
         fact renders for TMDB-sourced anime profiles, not just Jikan ones. */
      const needsTitleVariants = !mergedDetails.titleVariants?.romaji || !mergedDetails.titleVariants?.japanese;
      const needsMalStats = !Number(mergedDetails.malMembers || 0);
      if (needsTitleVariants || needsMalStats) {
        await hydrateAnimeTitleVariants(mergedDetails);
      }
    }
    repairLibraryItemCoverFromProfile(seed, mergedDetails);
    activeDiscoverMediaProfileState = {
      view: 'title',
      type,
      id,
      details: mergedDetails,
      ...(filmographyReturn ? { filmographyReturn } : {})
    };
    destroyDiscoverHeroTrailerPreview(overlay);
    overlay.innerHTML = renderDiscoverMediaProfileDetails(type, mergedDetails, id);
    bindDiscoverMediaProfileActions(overlay);
    hydrateDiscoverHeroTrailerPreview(overlay);
    hydrateDeepSeekMoreLikeThis(type, mergedDetails);
    hydrateDiscoverProviderLogoFallbacks();
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
async function openJikanAnimeProfile(event, malId, transitionOrigin = null) {
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
      discoverMediaProfileCache.set(key, mergedDetails);
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
  if (discoverCategoryFullState?.mode === 'universal-search') {
    const query = String(document.getElementById('discover-universal-search-input')?.value || '').trim();
    if (query) await runDiscoverUniversalSearch(query);
    else renderDiscoverUniversalSearchPresetHub();
  }
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
  const year = String(getDiscoverReleaseDate(item) || '').slice(0, 4);
  const ratingText = typeof window.formatDisplayTitleRating === 'function'
    ? window.formatDisplayTitleRating(item)
    : (Number(item.imdbRating || 0) > 0 ? Number(item.imdbRating).toFixed(1) : '');
  const imdbVotes = Number(item.imdbVotes || 0);
  return [year, ratingText ? `${ratingText} IMDb` : '', imdbVotes ? `${imdbVotes.toLocaleString()} votes` : '']
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
  const items = sortDiscoverFullPageItems(sourceItems, discoverCategoryFullState.sortKey, discoverCategoryFullState.gridId).slice(0, 12);
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
  /* v704: slide-in from left — show as block first (starts at translateX(-100%)),
     then two rAFs later add .is-open to trigger the 600ms spring transition. */
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
  /* v704: slide back to the left before hiding. */
  if (page) {
    page.classList.remove('is-open');
    /* Hide after the slide-out completes (600ms + tiny buffer). */
    setTimeout(() => { if (page) page.style.display = 'none'; }, 580);
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
  grid.dataset.expanded = 'false';
  delete grid.dataset.visibleCount;
  grid.innerHTML = items.map(item => {
    const itemType = type === 'mixed' ? (item.media_type || 'movie') : type;
    const title = item.title || item.name || '';
    const genreLine = getDiscoverGenreNames(item, itemType).slice(0, 2).join(' · ');
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
      : (Number(item.imdbRating || 0) > 0 ? Number(item.imdbRating).toFixed(1) : '');
    /* v568: rating first, then title, then genre, then date (date-grids only) */
    const ratingHtml = displayRating
      ? `<div class="dc-rating"><span class="dc-rating-star" aria-hidden="true">★</span>${displayRating}</div>`
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
      genreNames: getDiscoverGenreNames(item, itemType),
      /* v654: forward Jikan markers so profile-open routes correctly. */
      __jikan: !!item.__jikan,
      __mal_id: item.__mal_id || 0
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
    /* v654: getTmdbImageUrl handles full https URLs (Jikan-sourced) and TMDB paths. */
    const poster = getDiscoverTitleCardPosterUrl(item, itemType, gridId);
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
  grid.dataset.expanded = 'false';
  delete grid.dataset.visibleCount;
  grid.innerHTML = items.map((item, index) => {
    const rank = index + 1;
    const rankHtml = isDateOnlyGrid ? '' : `<div class="discover-rank">#${rank}</div>`;
    const itemType = item.media_type || type;
    const title = item.title || item.name || '';
    const year = (item.release_date || item.first_air_date || '').slice(0, 4);
    const genreLine = isNewReleaseGrid ? '' : getDiscoverGenreNames(item, itemType).slice(0, 2).join(' · ');
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
    const metaHtml = isNewReleaseGrid
      ? `<div class="discover-card-meta discover-new-release-date">Released: ${escHtml(releaseLine || formatDiscoverReleaseDate(getDiscoverReleaseDate(item)))}</div>`
      : '';
    const cardRating = typeof window.formatDisplayTitleRating === 'function'
      ? window.formatDisplayTitleRating(item)
      : (Number(item.imdbRating || 0) > 0 ? Number(item.imdbRating).toFixed(1) : '');
    /* v568: rating line first, then title, then genre, date only for new-release / upcoming grids */
    const ratingHtmlRanked = cardRating
      ? `<div class="dc-rating"><span class="dc-rating-star" aria-hidden="true">★</span>${cardRating}</div>`
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
    const alreadyAdded = isDuplicateTitle(title, 'games');
    const titleAttr = escAttr(title);
    const removeClick = `removeDiscoveryTitle(this)`;
    /* v700: Add button now opens the same spring bottom-sheet as seasonal
       anime (game-specific statuses). removeDiscoveryTitle for already-added. */
    const addClick = `openGameDiscoverAddSheetFromButton(this)`;
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
        <button class="discover-add-btn games-dc-add-btn${alreadyAdded ? ' added' : ''}" data-discover-type="game" data-discover-id="${gameKeyAttr}" data-discover-section="games" data-discover-title="${titleAttr}" data-discover-poster="${escAttr(poster)}" data-game-identity-key="${gameKeyAttr}" data-rawg-id="${rawgAttr}" data-igdb-id="${igdbAttr}" title="${alreadyAdded ? 'Click to remove from your library' : ''}" onclick="event.stopPropagation();${alreadyAdded ? removeClick : addClick}">${alreadyAdded ? getDiscoverLibraryButtonText(title, 'games') : '+ Add to Library'}</button>
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
    if (!document.hidden && (!discoverLoaded || !gamesDiscoverLoaded || !animeDiscoverLoaded)) {
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
  const button = getDiscoverExpandButton(grid);
  if (!button) return;
  const limit = getDiscoverPreviewVisibleCount(grid);
  let visibleCount = Number.parseInt(grid.dataset.visibleCount || '', 10);
  if (!Number.isFinite(visibleCount)) visibleCount = limit;
  visibleCount = Math.min(cards.length, Math.max(limit, visibleCount));
  grid.dataset.visibleCount = String(visibleCount);
  cards.forEach((card, index) => {
    card.classList.toggle('discover-hidden', index >= visibleCount);
  });
  // Bottom expand button removed — View All is accessible via the category header title link.
  button.style.display = 'none';
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
  const limit = getDiscoverPreviewVisibleCount(grid);
  const step = getDiscoverPreviewShowMoreStep(grid);
  const cards = Array.from(grid.querySelectorAll('.discover-card'));
  const current = Number.parseInt(grid.dataset.visibleCount || '', 10);
  const visibleCount = Number.isFinite(current) ? current : limit;
  const nextVisibleCount = visibleCount >= cards.length ? limit : visibleCount + step;
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

let activeAnimeSubtab        = 'top';
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
        <button class="sas-status-btn" type="button" onclick="pickSeasonalStatus('planned')">Watchlist</button>
        <button class="sas-status-btn" type="button" onclick="pickSeasonalStatus('watched')">Watched</button>
        <button class="sas-status-btn" type="button" onclick="pickSeasonalStatus('paused')">Paused</button>
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
          <button class="sas-status-btn" type="button" onclick="pickGameDiscoverStatus('watching')">Single Player</button>
          <button class="sas-status-btn" type="button" onclick="pickGameDiscoverStatus('live')">Live Games</button>
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
        <button class="sas-status-btn" type="button" onclick="pickGameDiscoverStatus('planned')">Backloggd</button>
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

  /* Hide the generic "Show more" expand button for this section. */
  const oldBtn = document.querySelector('#anime-discover-seasonal-section .discover-expand-btn');
  if (oldBtn) oldBtn.style.display = 'none';

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
    const scoreStr = score > 0 ? `★ ${score.toFixed(2)}` : '★ N/A';
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
        <button class="anime-seasonal-card-add-btn" type="button" onclick="event.stopPropagation();addSeasonalAnimeToLibrary(${malId})">+ Add to Library</button>
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

let discoverResizeTimer = null;
