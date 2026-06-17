// Discovery
let discoverLoaded = false;
let discoverLoading = false;
let discoverLoadedAt = 0;
let animeDiscoverLoaded = false;
let animeDiscoverLoading = false;
let animeDiscoverLoadedAt = 0;
let gamesDiscoverLoaded = false;
let gamesDiscoverLoading = false;
let gamesDiscoverLoadedAt = 0;
let musicDiscoverLoaded = false;
let musicDiscoverLoading = false;
let musicDiscoverLoadedAt = 0;
let discoverNewReleaseRange = 'week';
const DISCOVER_RELEASE_REGION = 'US';
const DISCOVER_FULL_NEW_RELEASE_LIMIT = 72;
const DISCOVER_FULL_NEW_RELEASE_PAGE_COUNT = 5;
const DISCOVER_COUNTRY_OPTIONS = [
  { code: 'JP', label: 'Japan' },
  { code: 'KR', label: 'Korea' },
  { code: 'US', label: 'USA' },
  { code: 'GB', label: 'UK' },
  { code: 'FR', label: 'France' },
  { code: 'IN', label: 'India' }
];
let discoverFriendWatchingMessage = 'No friend watchlist titles found yet.';
let friendActivityCache = null;
let friendActivityPromise = null;
const FRIEND_ACTIVITY_CACHE_MS = 120000;
const FRIEND_ACTIVITY_LIVE_MAX = 140;
/* v673: pool size raised from 3 → 5 pages (~100 candidates / category) so
   the central ranker has enough breadth to apply Bayesian scoring + IMDb
   re-ranking without TMDB's stock order dictating the final list. */
const DISCOVER_PAGE_COUNT = 5;
const DISCOVER_LIMIT = 20;
const DISCOVER_STREAMING_REGION = 'US';
const DISCOVER_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DISCOVER_CACHE_PREFIX = 'screenlist-discover-cache-v42:';

function getDiscoverGrids() {
  return [
    document.getElementById('discover-tv-new-releases-grid'),
    document.getElementById('discover-tv-years-best-grid'),
    document.getElementById('discover-tv-popular-grid'),
    document.getElementById('discover-tv-top-rated-grid'),
    document.getElementById('discover-tv-trending-grid'),
    document.getElementById('discover-tv-releasing-soon-grid'),
    document.getElementById('discover-tv-hidden-gems-grid'),
    document.getElementById('discover-friends-watching-grid'),
    document.getElementById('discover-movie-new-releases-grid'),
    document.getElementById('discover-movie-in-theaters-grid'),
    document.getElementById('discover-movie-years-best-grid'),
    document.getElementById('discover-movie-popular-grid'),
    document.getElementById('discover-movie-top-rated-grid'),
    document.getElementById('discover-movie-trending-grid'),
    document.getElementById('discover-movie-releasing-soon-grid'),
    document.getElementById('discover-movie-hidden-gems-grid')
  ].filter(Boolean);
}

function getAnimeDiscoverGrids() {
  return [
    document.getElementById('anime-discover-new-grid'),
    document.getElementById('anime-discover-years-best-grid'),
    document.getElementById('anime-discover-popular-grid'),
    document.getElementById('anime-discover-rated-grid'),
    document.getElementById('anime-discover-trending-grid')
  ].filter(Boolean);
}

function getGamesDiscoverGrids() {
  return [
    document.getElementById('discover-games-new-releases-grid'),
    document.getElementById('discover-games-years-best-grid'),
    document.getElementById('discover-games-popular-grid'),
    document.getElementById('discover-games-rated-grid'),
    document.getElementById('discover-games-trending-grid'),
    document.getElementById('discover-games-anticipated-grid'),
    document.getElementById('discover-games-story-grid'),
    document.getElementById('discover-games-multiplayer-grid'),
    document.getElementById('discover-games-hidden-grid')
  ].filter(Boolean);
}

function getAllDiscoverGrids() {
  return getDiscoverGrids().concat(getAnimeDiscoverGrids(), getGamesDiscoverGrids());
}

function getDiscoverExpandButton(grid) {
  return null;
}

function hideDiscoverExpandButtons() {
}

function renderDiscoverLoading() {
  hideDiscoverExpandButtons();
  const loading = '<div class="discover-message">Loading discovery titles...</div>';
  getDiscoverGrids().forEach(grid => grid.innerHTML = loading);
}

function renderDiscoverError(message) {
  hideDiscoverExpandButtons();
  const html = `<div class="discover-message">${escHtml(message)}</div>`;
  getDiscoverGrids().forEach(grid => grid.innerHTML = html);
}

function relativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}
