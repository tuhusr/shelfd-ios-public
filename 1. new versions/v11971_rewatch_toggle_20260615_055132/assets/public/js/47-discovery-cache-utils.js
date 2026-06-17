/* =============================================================
   47-discovery-cache-utils.js
   Shared Discovery memory/localStorage cache helpers and parallel-row
   runner extracted from 11-discovery-media-games-profiles.js.
   Loaded after 08-discovery-state.js and before 11.
   ============================================================= */

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