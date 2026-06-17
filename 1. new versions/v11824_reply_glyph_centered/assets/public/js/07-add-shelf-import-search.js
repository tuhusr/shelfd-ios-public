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

function cloneShelfdGameIdentityValue(value) {
  if (!value || typeof value !== 'object') return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return { ...value };
  }
}

function normalizeShelfdGameIdentityText(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[®™©]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim();
}

function getShelfdGameIdentityTitle(item = {}) {
  return String(item?.title || item?.name || item?.gameTitle || '').trim();
}

function getShelfdGameIdentityRawgId(item = {}) {
  if (!item || typeof item !== 'object') return '';
  const source = String(item.source || '').trim().toLowerCase();
  const direct = item.rawgId || item.rawg_id || '';
  if (direct) return String(direct).trim();
  if (source === 'rawg' && item.id && /^\d+$/.test(String(item.id))) return String(item.id).trim();
  if (source === 'rawg' && item.sourceId) return String(item.sourceId).trim();
  return '';
}

function getShelfdGameIdentityIgdbId(item = {}) {
  if (!item || typeof item !== 'object') return '';
  const source = String(item.source || '').trim().toLowerCase();
  const direct = item.igdbId || item.igdb_id || '';
  if (direct) return String(direct).trim();
  if (source === 'igdb' && item.sourceId) return String(item.sourceId).trim();
  if (source === 'igdb' && item.id && /^\d+$/.test(String(item.id))) return String(item.id).trim();
  const key = String(item.gameIdentityKey || item.mediaId || item.id || '').trim();
  const match = key.match(/^igdb:(\d+)$/i);
  return match ? match[1] : '';
}

function getShelfdGameIdentitySlug(item = {}) {
  return String(item?.rawgSlug || item?.igdbSlug || item?.slug || item?.backloggdSlug || item?.metacriticSlug || '').trim();
}

function getShelfdGameIdentityCover(item = {}) {
  return String(item?.igdbCoverUrl || item?.cover || item?.poster || item?.image || item?.background_image || '').trim();
}

function getShelfdGameIdentityYear(item = {}) {
  return String(item?.released || item?.releaseDate || item?.year || '').slice(0, 4);
}

function summarizeShelfdGameIdentity(item = {}) {
  const source = String(item?.source || '').trim().toLowerCase() || (getShelfdGameIdentityIgdbId(item) ? 'igdb' : 'rawg');
  const rawgId = getShelfdGameIdentityRawgId(item);
  const igdbId = getShelfdGameIdentityIgdbId(item);
  const slug = getShelfdGameIdentitySlug(item);
  const key = rawgId ? `rawg:${rawgId}` : igdbId ? `igdb:${igdbId}` : String(item?.gameIdentityKey || item?.mediaId || item?.id || slug || '').trim();
  return {
    title: getShelfdGameIdentityTitle(item),
    normalizedTitle: normalizeShelfdGameIdentityText(getShelfdGameIdentityTitle(item)),
    rawgId,
    igdbId,
    slug,
    source,
    year: getShelfdGameIdentityYear(item),
    cover: getShelfdGameIdentityCover(item),
    platform: Array.isArray(item?.platforms)
      ? item.platforms.map(p => p?.platform?.name || p?.name || p).filter(Boolean).join(', ')
      : String(item?.platforms || '').trim(),
    mediaId: String(item?.gameIdentityKey || item?.mediaId || item?.id || key || '').trim(),
    key
  };
}

function createShelfdGameIdentityLock(item = {}, sourceStep = 'unknown') {
  const summary = summarizeShelfdGameIdentity(item);
  return {
    version: 'v10.80-game-identity-lock',
    createdAt: new Date().toISOString(),
    sourceStep,
    ...summary
  };
}

function attachShelfdGameIdentityLock(item = {}, lock = null) {
  if (!item || typeof item !== 'object') return item;
  const identityLock = lock || item.shelfdGameIdentityLock || createShelfdGameIdentityLock(item);
  item.shelfdGameIdentityLock = cloneShelfdGameIdentityValue(identityLock);
  item.gameIdentityKey = identityLock.key || item.gameIdentityKey || '';
  if (identityLock.rawgId) item.rawgId = identityLock.rawgId;
  if (identityLock.igdbId) item.igdbId = identityLock.igdbId;
  if (identityLock.slug && !item.rawgSlug && !item.igdbSlug && !item.slug) item.rawgSlug = identityLock.slug;
  return item;
}

function isShelfdGameIdentityMatch(lock = null, item = {}) {
  if (!lock || !item || typeof item !== 'object') return true;
  const current = summarizeShelfdGameIdentity(item);
  if (!current.rawgId && !current.igdbId && !current.normalizedTitle && !current.slug) return true;
  if (lock.rawgId || current.rawgId) return !!lock.rawgId && lock.rawgId === current.rawgId;
  if (lock.igdbId || current.igdbId) return !!lock.igdbId && lock.igdbId === current.igdbId;
  if (lock.normalizedTitle && current.normalizedTitle && lock.normalizedTitle !== current.normalizedTitle) return false;
  if (lock.slug && current.slug && normalizeShelfdGameIdentityText(lock.slug) !== normalizeShelfdGameIdentityText(current.slug)) return false;
  return !!(lock.normalizedTitle && current.normalizedTitle && lock.normalizedTitle === current.normalizedTitle);
}

function traceShelfdGameIdentity(step = '', item = {}, extra = {}) {
  try {
    console.debug('[Shelfd game identity]', step, {
      ...summarizeShelfdGameIdentity(item),
      locked: item?.shelfdGameIdentityLock ? { ...item.shelfdGameIdentityLock } : null,
      ...extra
    });
  } catch (_) {}
}

function assertShelfdGameIdentity(step = '', item = {}, options = {}) {
  if (!item || typeof item !== 'object') return true;
  const lock = options.lock || item.shelfdGameIdentityLock || null;
  if (!lock) return true;
  const ok = isShelfdGameIdentityMatch(lock, item);
  if (!ok) {
    console.warn('[Shelfd game identity] blocked mismatched game object', {
      step,
      expected: lock,
      actual: summarizeShelfdGameIdentity(item),
      item
    });
    if (options.toast !== false && typeof showToast === 'function') {
      showToast('Game identity changed before saving. Please tap the game again.');
    }
  } else {
    traceShelfdGameIdentity(step, item);
  }
  return ok;
}

function mergeShelfdGameIdentityLockedItem(base = {}, update = {}, step = 'merge') {
  const lock = base?.shelfdGameIdentityLock || update?.shelfdGameIdentityLock || createShelfdGameIdentityLock(base || update, step);
  const compatible = isShelfdGameIdentityMatch(lock, update || {});
  if (update && Object.keys(update).length && !compatible) {
    console.warn('[Shelfd game identity] ignored mismatched game enrichment', {
      step,
      expected: lock,
      enrichment: summarizeShelfdGameIdentity(update),
      update
    });
    return attachShelfdGameIdentityLock(cloneShelfdGameIdentityValue(base), lock);
  }
  const merged = { ...(base || {}), ...(update || {}) };
  const protectedTitle = lock.title || base?.title || base?.name || merged.title || merged.name || '';
  merged.title = protectedTitle;
  merged.name = protectedTitle;
  if (lock.rawgId) merged.rawgId = lock.rawgId;
  if (lock.igdbId) merged.igdbId = lock.igdbId;
  if (lock.slug) {
    if (lock.source === 'igdb') merged.igdbSlug = lock.slug;
    else merged.rawgSlug = lock.slug;
    merged.slug = merged.slug || lock.slug;
  }
  if (lock.source) merged.source = lock.source;
  if (lock.year && !String(merged.year || '').trim()) merged.year = lock.year;
  if (lock.cover && !getShelfdGameIdentityCover(merged)) {
    merged.cover = lock.cover;
    merged.poster = lock.cover;
    merged.image = lock.cover;
    merged.background_image = lock.cover;
  }
  return attachShelfdGameIdentityLock(merged, lock);
}

window.cloneShelfdGameIdentityValue = cloneShelfdGameIdentityValue;
window.createShelfdGameIdentityLock = createShelfdGameIdentityLock;
window.attachShelfdGameIdentityLock = attachShelfdGameIdentityLock;
window.assertShelfdGameIdentity = assertShelfdGameIdentity;
window.traceShelfdGameIdentity = traceShelfdGameIdentity;
window.mergeShelfdGameIdentityLockedItem = mergeShelfdGameIdentityLockedItem;
window.summarizeShelfdGameIdentity = summarizeShelfdGameIdentity;
window.getShelfdGameIdentityRawgId = getShelfdGameIdentityRawgId;
window.getShelfdGameIdentityIgdbId = getShelfdGameIdentityIgdbId;
window.getShelfdGameIdentityTitle = getShelfdGameIdentityTitle;

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
const animeCanonicalHydrationInFlight = new Set();

function getScreenListAnimeMalId(item = {}) {
  if (typeof getAnimeMalIdFromItem === 'function') return getAnimeMalIdFromItem(item);
  const direct = item?.malId || item?.mal_id || item?.__mal_id || item?.external_ids?.mal_id || '';
  if (direct && Number(direct) > 0) return String(Number(direct));
  const url = String(item?.malUrl || item?.jikanUrl || item?.url || item?.sourceUrl || '').trim();
  const match = url.match(/myanimelist\.net\/anime\/(\d+)/i);
  return match ? match[1] : '';
}

function fillAnimeField(target = {}, key = '', value = '', overwrite = false) {
  if (!target || !key) return false;
  const hasValue = Array.isArray(target[key]) ? target[key].length > 0 : (target[key] !== undefined && target[key] !== null && target[key] !== '');
  const incomingHasValue = Array.isArray(value) ? value.length > 0 : (value !== undefined && value !== null && value !== '');
  if (!incomingHasValue || (hasValue && !overwrite)) return false;
  target[key] = value;
  return true;
}

function applyJikanCanonicalAnimeFields(target = {}, j = {}, options = {}) {
  if (!target || !j) return false;
  const overwrite = options.overwrite === true;
  let changed = false;
  const malId = String(j.mal_id || getScreenListAnimeMalId(j) || '').trim();
  const titleRows = Array.isArray(j.titles) ? j.titles : [];
  const titleByType = type => titleRows.find(row => String(row?.type || '').toLowerCase() === type)?.title || '';
  const title = j.title_english || j.title || j.title_japanese || target.title || target.name || '';
  const romaji = j.title || titleByType('default') || titleByType('romaji') || target.romajiTitle || title;
  const japanese = j.title_japanese || titleByType('japanese') || target.japaneseTitle || '';
  const cover = j.images?.jpg?.large_image_url || j.images?.jpg?.image_url || j.images?.webp?.large_image_url || j.images?.webp?.image_url || '';
  const genreNames = []
    .concat((j.genres || []).map(g => g.name))
    .concat((j.themes || []).map(g => g.name))
    .concat((j.demographics || []).map(g => g.name))
    .filter(Boolean);
  const year = String(j.year || (j.aired?.from || '').slice(0, 4) || '');
  if (malId) {
    changed = fillAnimeField(target, 'malId', malId, overwrite) || changed;
    changed = fillAnimeField(target, 'mal_id', malId, overwrite) || changed;
    changed = fillAnimeField(target, 'animeIdentityKey', `mal:${malId}`, overwrite) || changed;
    changed = fillAnimeField(target, 'sourceId', malId, overwrite) || changed;
  }
  const malUrl = j.url || (malId ? `https://myanimelist.net/anime/${malId}` : '');
  changed = fillAnimeField(target, 'malUrl', malUrl, overwrite) || changed;
  changed = fillAnimeField(target, 'jikanUrl', malUrl, overwrite) || changed;
  changed = fillAnimeField(target, 'url', malUrl, overwrite) || changed;
  changed = fillAnimeField(target, 'title', title, overwrite) || changed;
  changed = fillAnimeField(target, 'name', title, overwrite) || changed;
  changed = fillAnimeField(target, 'cover', cover, overwrite) || changed;
  changed = fillAnimeField(target, 'poster', cover, overwrite) || changed;
  changed = fillAnimeField(target, 'image', cover, overwrite) || changed;
  changed = fillAnimeField(target, 'genreNames', genreNames, overwrite) || changed;
  changed = fillAnimeField(target, 'genre', genreNames.join(', '), overwrite) || changed;
  changed = fillAnimeField(target, 'year', year, overwrite) || changed;
  changed = fillAnimeField(target, 'source', 'myanimelist', overwrite) || changed;
  changed = fillAnimeField(target, 'mediaCategory', 'anime', overwrite) || changed;
  changed = fillAnimeField(target, 'librarySection', 'anime', overwrite) || changed;
  changed = fillAnimeField(target, 'originalTitle', japanese || j.title || '', overwrite) || changed;
  changed = fillAnimeField(target, 'originalLanguage', 'ja', overwrite) || changed;
  changed = fillAnimeField(target, 'originCountries', ['JP'], overwrite) || changed;
  changed = fillAnimeField(target, 'animeType', j.type || '', overwrite) || changed;
  changed = fillAnimeField(target, 'type', j.type || '', overwrite) || changed;
  const variants = normalizeAnimeTitleVariants({
    english: j.title_english || title,
    romaji,
    japanese
  }, title);
  changed = fillAnimeField(target, 'titleVariants', variants, overwrite) || changed;
  changed = fillAnimeField(target, 'englishTitle', variants.english, overwrite) || changed;
  changed = fillAnimeField(target, 'romajiTitle', variants.romaji, overwrite) || changed;
  changed = fillAnimeField(target, 'japaneseTitle', variants.japanese, overwrite) || changed;
  const totalEps = Number(j.episodes || 0);
  if (totalEps) {
    changed = fillAnimeField(target, 'totalEpisodes', totalEps, overwrite) || changed;
    changed = fillAnimeField(target, 'totalEps', totalEps, overwrite) || changed;
  }
  if (Number(j.members || 0) > 0) changed = fillAnimeField(target, 'malMembers', Number(j.members), overwrite) || changed;
  if (Number(j.favorites || 0) > 0) changed = fillAnimeField(target, 'malFavorites', Number(j.favorites), overwrite) || changed;
  if (Number(j.scored_by || 0) > 0) changed = fillAnimeField(target, 'malScoredBy', Number(j.scored_by), overwrite) || changed;
  if (Number(j.score || 0) > 0) changed = fillAnimeField(target, 'malScore', Number(j.score), overwrite) || changed;
  if (Number(j.rank || 0) > 0) changed = fillAnimeField(target, 'malRank', Number(j.rank), overwrite) || changed;
  if (Number(j.popularity || 0) > 0) changed = fillAnimeField(target, 'malPopularity', Number(j.popularity), overwrite) || changed;
  const grouping = window.JikanAnime?.getSeasonGrouping ? window.JikanAnime.getSeasonGrouping(j) : null;
  if (grouping) {
    changed = fillAnimeField(target, 'animeSeasonRelationCount', grouping.count, overwrite) || changed;
    changed = fillAnimeField(target, 'animeSeasonGrouping', grouping.mode, overwrite) || changed;
    changed = fillAnimeField(target, 'animeSeasonGroupingReliable', grouping.reliable, overwrite) || changed;
  }
  target.isAnime = true;
  return changed;
}

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
      popularity: Number(hit.popularity || 0),
      url: hit.url || '',
      title: hit.title || '',
      titleEnglish: hit.title_english || '',
      titleJapanese: hit.title_japanese || '',
      type: hit.type || '',
      episodes: Number(hit.episodes || 0),
      year: Number(hit.year || 0) || Number((hit.aired?.from || '').slice(0, 4)) || 0,
      image: hit.images?.jpg?.large_image_url || hit.images?.jpg?.image_url || ''
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
  if (jikanVariants && Number(jikanVariants.malId) > 0) {
    target.malId = target.malId || String(jikanVariants.malId);
    target.mal_id = target.mal_id || String(jikanVariants.malId);
    target.animeIdentityKey = target.animeIdentityKey || `mal:${jikanVariants.malId}`;
    target.malUrl = target.malUrl || jikanVariants.url || `https://myanimelist.net/anime/${jikanVariants.malId}`;
    target.jikanUrl = target.jikanUrl || target.malUrl;
    if (!target.url || /myanimelist\.net\/anime\//i.test(String(target.url))) target.url = target.malUrl;
    target.source = target.source || 'myanimelist';
    if (Number(jikanVariants.episodes) > 0 && !Number(target.totalEpisodes || target.totalEps || 0)) {
      target.totalEpisodes = Number(jikanVariants.episodes);
      target.totalEps = Number(jikanVariants.episodes);
    }
    if (jikanVariants.type && !target.animeType) target.animeType = jikanVariants.type;
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

function animeNeedsCanonicalIdentityHydration(item = {}) {
  if (!item || typeof item !== 'object') return false;
  if (getScreenListAnimeMalId(item) && item.malUrl && item.titleVariants?.romaji && (item.cover || item.totalEpisodes || item.totalEps)) return false;
  return true;
}

function queueAnimeCanonicalIdentityHydration(item, section = 'anime') {
  if (!item || section !== 'anime' || isViewingOtherProfile?.()) return;
  if (!animeNeedsCanonicalIdentityHydration(item)) return;
  const key = `${item.id || item.title || ''}:${getScreenListAnimeMalId(item) || ''}`;
  if (!key || animeCanonicalHydrationInFlight.has(key)) return;
  if (!window.JikanAnime?.animeByIdentity) return;
  animeCanonicalHydrationInFlight.add(key);
  window.JikanAnime.animeByIdentity(item).then(j => {
    if (j && applyJikanCanonicalAnimeFields(item, j)) {
      if (!viewingUser && activeSection === section) {
        save();
        render();
      }
    }
  }).catch(error => {
    console.warn('Anime canonical identity hydration failed:', error);
  }).finally(() => animeCanonicalHydrationInFlight.delete(key));
}

/* v11.087: REMOVED the anime season-splitting builders
   (formatAnimeSeasonTitle / buildAnimeSeasonLibraryItem / shouldSplitAnimeSeasons
   / buildAnimeSeasonItemsForLibrary). Anime is now treated like TV — saved as
   ONE parent series card with seasons grouped under it (episodes[] + seasonsInfo[]),
   so there is no longer a path that splits a series into a card per season.
   The series-key matchers below remain: they purge any legacy split season
   cards when the parent series is (re)added. */
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

/* v11.090: normalized SERIES base key for anime search dedup — strips season /
   part / cour markers so "Demon Slayer", "Demon Slayer Season 2",
   "Demon Slayer: Hashira Training Arc Part 2" collapse to one series. */
function animeSearchSeriesBaseKey(title = '') {
  let t = String(title || '').toLowerCase().replace(/[’']/g, '');
  const seasonTail = /(\s*[:\-—–]\s*|\s+)(the\s+)?(final\s+season|season\s*\d+|part\s*\d+|cour\s*\d+|\d+(?:st|nd|rd|th)\s+season)\b.*$/i;
  t = t.replace(seasonTail, '');
  return t.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/* Collapse Jikan search hits: keep ONE entry per TV/ONA series (by base key),
   keep movies as distinct titles, and drop recap/PV/music/CM junk. Preserves
   the original (relevance) order. */
function dedupeAnimeSearchHits(hits = []) {
  const out = [];
  const seen = new Set();
  for (const h of (Array.isArray(hits) ? hits : [])) {
    if (!h) continue;
    const fmt = String(h.animeType || h.type || h.__jikanRaw?.type || '').toLowerCase();
    const title = String(h.title || h.name || '');
    if (fmt === 'music' || fmt === 'cm' || fmt === 'pv') continue;
    if (/\b(recap|recaps|preview|teaser\s+pv|special\s+pv|\bpv\b)\b/i.test(title)) continue;
    const isMovie = fmt === 'movie';
    const key = isMovie
      ? 'movie:' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      : 'series:' + animeSearchSeriesBaseKey(title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
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

function getAnimeCanonicalSaveFields(source = {}) {
  const malId = getScreenListAnimeMalId(source);
  const malUrl = source.malUrl || source.jikanUrl || source.url || (malId ? `https://myanimelist.net/anime/${malId}` : '');
  return {
    malId,
    mal_id: malId,
    animeIdentityKey: malId ? `mal:${malId}` : (source.animeIdentityKey || ''),
    malUrl,
    jikanUrl: source.jikanUrl || malUrl,
    url: malUrl || source.url || '',
    sourceId: source.sourceId || malId || '',
    source: source.source || (malId ? 'myanimelist' : ''),
    animeType: source.animeType || source.type || '',
    title_english: source.title_english || source.englishTitle || source.titleVariants?.english || '',
    title_japanese: source.title_japanese || source.japaneseTitle || source.titleVariants?.japanese || '',
    malMembers: source.malMembers || '',
    malFavorites: source.malFavorites || '',
    malScoredBy: source.malScoredBy || '',
    malScore: source.malScore || source.score || '',
    malRank: source.malRank || '',
    malPopularity: source.malPopularity || '',
    animeSeasonRelationCount: source.animeSeasonRelationCount || 0,
    animeSeasonGrouping: source.animeSeasonGrouping || 'separate',
    animeSeasonGroupingReliable: source.animeSeasonGroupingReliable === true
  };
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
let addShelfModalStep = 'search';
let addShelfModalBackHandler = null;
let addShelfModalScrollLockState = null;
let addShelfModalSearchSnapshot = null;
let addShelfModalSelectionState = null;
let addShelfModalTouchGuardCleanup = null;

function findAddShelfModalScrollHost(target) {
  if (!target || !target.closest) return null;
  return target.closest('#modal .add-shelf-step-scroll, #modal #tmdb-results, #modal .shelf-filter-pills, #modal .add-shelf-preset-row');
}

function installAddShelfModalTouchGuard() {
  if (addShelfModalTouchGuardCleanup) return;
  const modal = document.getElementById('modal');
  if (!modal) return;
  let lastTouchY = 0;
  let lastTouchX = 0;
  let activeScrollHost = null;

  const onTouchStart = event => {
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    lastTouchY = touch.clientY;
    lastTouchX = touch.clientX;
    activeScrollHost = findAddShelfModalScrollHost(event.target);
  };

  const onTouchMove = event => {
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    const deltaY = touch.clientY - lastTouchY;
    const deltaX = touch.clientX - lastTouchX;
    const scrollHost = findAddShelfModalScrollHost(event.target) || activeScrollHost;
    if (!scrollHost) {
      event.preventDefault();
      return;
    }
    if (scrollHost.classList && (scrollHost.classList.contains('shelf-filter-pills') || scrollHost.classList.contains('add-shelf-preset-row'))) {
      if (Math.abs(deltaX) >= Math.abs(deltaY)) {
        lastTouchY = touch.clientY;
        lastTouchX = touch.clientX;
        return;
      }
      event.preventDefault();
      return;
    }
    const maxScrollTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
    const canScroll = maxScrollTop > 1;
    if (!canScroll) {
      event.preventDefault();
      return;
    }
    const atTop = scrollHost.scrollTop <= 0;
    const atBottom = scrollHost.scrollTop >= (maxScrollTop - 1);
    const pullingDownAtTop = atTop && deltaY > 0;
    const pushingUpAtBottom = atBottom && deltaY < 0;
    if (pullingDownAtTop || pushingUpAtBottom) {
      event.preventDefault();
      return;
    }
    lastTouchY = touch.clientY;
    lastTouchX = touch.clientX;
  };

  modal.addEventListener('touchstart', onTouchStart, { passive: true });
  modal.addEventListener('touchmove', onTouchMove, { passive: false });
  addShelfModalTouchGuardCleanup = () => {
    modal.removeEventListener('touchstart', onTouchStart);
    modal.removeEventListener('touchmove', onTouchMove);
    activeScrollHost = null;
  };
}

function removeAddShelfModalTouchGuard() {
  if (!addShelfModalTouchGuardCleanup) return;
  addShelfModalTouchGuardCleanup();
  addShelfModalTouchGuardCleanup = null;
}

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
  installAddShelfModalTouchGuard();
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
  removeAddShelfModalTouchGuard();
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

function setAddShelfModalStep(step = 'search') {
  addShelfModalStep = step || 'search';
  const modalCard = document.querySelector('#modal .add-title-modal');
  if (modalCard) modalCard.dataset.addShelfStep = addShelfModalStep;
}

function updateAddShelfModalSelectionLayout(hasSelection = !!selectedTmdb) {
  const modalCard = document.querySelector('#modal .add-title-modal');
  const searchArea = document.getElementById('tmdb-search-area');
  if (modalCard) modalCard.classList.toggle('add-shelf-has-selection', !!hasSelection);
  if (searchArea) searchArea.style.display = hasSelection ? 'none' : '';
  if (!hasSelection) setAddShelfModalStep('search');
}

/* v10.78: focused helper for OTHER flows that need to invalidate the cached
   Add to Shelf modal snapshot WITHOUT clearing `selectedTmdb` or resetting
   the DOM. Specifically, the Discover game add sheet
   (`openGameDiscoverAddSheet` in 11-discovery-...js) sets a fresh
   `window.selectedTmdb` but historically did NOT touch
   `addShelfModalSelectionState`. When the user had previously selected a
   different title in the main Add to Shelf flow and then opened the
   Discover Add sheet, `submitModal` preferred the STALE snapshot in
   `addShelfModalSelectionState.item` over the freshly-set `selectedTmdb`
   and saved the wrong game. This helper lets the Discover flow reset only
   the snapshot. Window-exposed so cross-file callers can use it. */
function clearAddShelfModalSelectionStateSnapshot() {
  addShelfModalSelectionState = null;
}
if (typeof window !== 'undefined') {
  window.clearAddShelfModalSelectionStateSnapshot = clearAddShelfModalSelectionStateSnapshot;
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
  setAddShelfModalStep('search');
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
  /* v11.217: (re)build the Discovery preset row for the + page. */
  if (typeof window.renderAddShelfPresetRow === 'function') window.renderAddShelfPresetRow();
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

function buildAddShelfSelectedHeroMarkup(item = getActiveAddShelfSelectedItem(), options = {}) {
  const activeItem = item || getActiveAddShelfSelectedItem();
  if (!activeItem) return '';
  const { showChangeButton = true } = options || {};
  const title = activeItem.title || activeItem.name || 'Selected title';
  const cover = activeItem.cover || activeItem.igdbCoverUrl || '';
  const { typeLabel, year, detailLines } = buildAddShelfSelectedPreviewDetails(activeItem);
  const chips = [typeLabel, year]
    .filter(Boolean)
    .map(value => `<span class="add-shelf-selected-chip">${escHtml(value)}</span>`)
    .join('');
  const detailMarkup = detailLines
    .map(line => `<div class="add-shelf-selected-line">${escHtml(line)}</div>`)
    .join('');
  const placeholder = escHtml(String(title || '?').trim().charAt(0) || '?');
  return `
    <section class="add-shelf-selected-hero" aria-label="Selected title">
      <div class="add-shelf-selected-poster-wrap${cover ? '' : ' is-empty'}">
        ${cover ? `<img src="${escAttr(cover)}" alt="${escAttr(title)} poster">` : `<span class="add-shelf-selected-placeholder">${placeholder}</span>`}
      </div>
      <div class="add-shelf-selected-info">
        <div class="add-shelf-selected-kicker">Selected title</div>
        <div class="tmdb-selected-title">${escHtml(title)}</div>
        ${chips ? `<div class="add-shelf-selected-chip-row">${chips}</div>` : ''}
        ${detailMarkup ? `<div class="add-shelf-selected-details">${detailMarkup}</div>` : ''}
        ${showChangeButton ? `<button class="tmdb-clear add-shelf-selected-clear" type="button" onclick="clearSelection()">Choose another title</button>` : ''}
      </div>
    </section>
  `;
}

function renderAddShelfStepSurface({
  step = 'status',
  title = 'Add to Shelf',
  subtitle = '',
  bodyHtml = '',
  backAction = 'clearSelection()',
  backLabel = 'Back',
  showBack = true,
  showChangeButton = true,
  panelClass = ''
} = {}) {
  const selectedArea = document.getElementById('tmdb-selected-area');
  const picker = document.getElementById('modal-status-picker');
  const activeItem = getActiveAddShelfSelectedItem();
  if (!selectedArea || !activeItem) return;
  if (picker) {
    picker.style.display = 'none';
    picker.innerHTML = '';
  }
  setAddShelfModalStep(step);
  selectedArea.style.display = 'block';
  selectedArea.innerHTML = `
    <div class="add-shelf-step-shell add-shelf-step-shell--${escAttr(step)}">
      <div class="add-shelf-step-topbar">
        ${showBack ? `<button class="add-shelf-step-back" type="button" onclick="${escAttr(backAction)}">${escHtml(backLabel)}</button>` : '<span class="add-shelf-step-back-spacer" aria-hidden="true"></span>'}
        <div class="add-shelf-step-heading">
          <div class="add-shelf-step-kicker">Add to Shelf</div>
          <div class="add-shelf-step-title">${escHtml(title)}</div>
          ${subtitle ? `<div class="add-shelf-step-subtitle">${escHtml(subtitle)}</div>` : ''}
        </div>
        <span class="add-shelf-step-topbar-spacer" aria-hidden="true"></span>
      </div>
      <div class="add-shelf-step-scroll">
        ${buildAddShelfSelectedHeroMarkup(activeItem, { showChangeButton })}
        <section class="add-shelf-step-panel ${escAttr(panelClass)}">
          ${bodyHtml}
        </section>
      </div>
    </div>
  `;
}

function renderAddShelfSelectedPreview(item = getActiveAddShelfSelectedItem()) {
  const activeItem = item || getActiveAddShelfSelectedItem();
  const selectedArea = document.getElementById("tmdb-selected-area");
  if (!selectedArea || !activeItem) return;
  setAddShelfModalStep('status');
  selectedArea.style.display = "block";
  selectedArea.innerHTML = buildAddShelfSelectedHeroMarkup(activeItem);
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
  if (addShelfSearchFilter === 'books' || addShelfSearchFilter === 'manga') {
    selectManualReadingTitle();
    return;
  }
  /* v11.296: live-search from the VERY FIRST character typed. The old code
     gated fetches behind a 2-character minimum ("Keep typing..."), so a single
     letter never returned results. Each keystroke now resets a short debounce
     and fetches, so results update as the user types every letter. The debounce
     still collapses fast typing into one request to avoid hammering TMDB/RAWG. */
  addTitleLiveSearchTimer = setTimeout(() => doSearch(), 220);
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
  /* v11.217: tab change resets the Discovery preset/filter browse state. */
  if (typeof window.onAddShelfTabChanged === 'function') window.onAddShelfTabChanged(filter);
  const query = (document.getElementById('inp-tmdb-search')?.value || '').trim();
  /* v11.296: re-search from the first character on tab switch (was >= 2). */
  if (query.length >= 1) doSearch();
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

/* v11.297: TMDB search returns only 20 results per page, so to surface up to
   30 titles we fetch the first two pages in parallel and merge them (deduped by
   media-type + id). Out-of-range / failed pages resolve to an empty list, so a
   short result set still works with a single effective page. */
async function fetchTmdbSearchResultsMultiPage(path, params = {}, pages = 2) {
  const requests = [];
  for (let page = 1; page <= pages; page++) {
    requests.push(
      fetchTmdbProxy(path, { ...params, page })
        .then(r => (r.ok ? r.json() : { results: [] }))
        .then(j => (Array.isArray(j.results) ? j.results : []))
        .catch(() => [])
    );
  }
  const pageResults = await Promise.all(requests);
  const seen = new Set();
  const merged = [];
  for (const arr of pageResults) {
    for (const r of arr) {
      const key = `${r.media_type || ''}:${r.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(r);
    }
  }
  return merged;
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
      /* v11.297: two-page fetch → up to 30 results (TMDB caps at 20/page). */
      const results = await fetchTmdbSearchResultsMultiPage('search/multi', { query, include_adult: false });
      if (searchToken && searchToken !== addTitleSearchRequestToken) return;
      hits = results
        .filter(r => (r.media_type === 'movie' || r.media_type === 'tv') && r.poster_path)
        .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
        .slice(0, 30);
    } else if (filter === 'movies') {
      /* v11.297: two-page fetch → up to 30 results (TMDB caps at 20/page). */
      const results = await fetchTmdbSearchResultsMultiPage('search/movie', { query });
      if (searchToken && searchToken !== addTitleSearchRequestToken) return;
      hits = results
        .filter(r => r.poster_path)
        .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
        .slice(0, 30)
        .map(r => ({ ...r, media_type: 'movie' }));
    } else if (filter === 'tv') {
      /* v11.297: two-page fetch → up to 30 results (TMDB caps at 20/page). */
      const results = await fetchTmdbSearchResultsMultiPage('search/tv', { query });
      if (searchToken && searchToken !== addTitleSearchRequestToken) return;
      hits = results
        .filter(r => r.poster_path)
        .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
        .slice(0, 30)
        .map(r => ({ ...r, media_type: 'tv' }));
    } else if (filter === 'anime') {
      /* v654: anime in the Add-to-Shelf modal goes through Jikan only.
         Mapped to a TMDB-compatible shape so the existing result-card
         renderer below still works without further changes.
         v11.090: collapse a series' season entries into ONE result (TV-style)
         and drop non-series junk (recaps / PVs / music) so a search like
         "Jujutsu Kaisen" returns the series once + the movie, not every season. */
      /* v11.298: Jikan's API caps `limit` at 25 — requesting 30 returns an
         HTTP 400 ValidationException, which broke anime search in v11.297. Use
         25 (the max the source allows); season-dedupe collapses these further. */
      const raw = await window.JikanAnime?.searchAnime(query, 25);
      if (searchToken && searchToken !== addTitleSearchRequestToken) return;
      const mapped = (raw || []).map(window.JikanAnime?.mapItem).filter(Boolean);
      hits = dedupeAnimeSearchHits(mapped).slice(0, 30);
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
    const hits = await fetchMergedGameSearchResults(query, 30); /* v11.297: show up to 30 results (was 15) */
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
function normalizeGameSearchText(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
/* v11.300: unicode-aware normalization that KEEPS letters of every script
   (strips only diacritics + punctuation). The ASCII normalizer above DELETES
   non-Latin letters, so a title like "\u041f\u0435\u0442\u044c\u043a\u0430 007: \u0417\u043e\u043b\u043e\u0442\u043e \u043f\u0430\u0440\u0442\u0438\u0438" collapses to
   just "007" and then falsely matches the query "007" as an exact/prefix hit.
   This version preserves the Cyrillic/Japanese/etc. letters so such a title
   correctly scores as a weak "contains" match, not a top-tier exact match. */
function normalizeGameSearchTextUnicode(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function compactGameSearchText(value = '') {
  return normalizeGameSearchText(value).replace(/\s+/g, '');
}
function isGameRomanizedNearVariant(a = '', b = '') {
  const ak = compactGameSearchText(a);
  const bk = compactGameSearchText(b);
  if (!ak || !bk || ak === bk) return false;
  const shorter = ak.length <= bk.length ? ak : bk;
  const longer = ak.length <= bk.length ? bk : ak;
  if (shorter.length < 3 || !longer.startsWith(shorter)) return false;
  const tail = longer.slice(shorter.length);
  return tail.length > 0 && tail.length <= 2 && /^[aeiouy]+$/.test(tail);
}
function gameRomanToInt(value = '') {
  const map = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
  return map[String(value || '').trim().toLowerCase()] || 0;
}
function getGameSearchAcronyms(value = '') {
  const words = normalizeGameSearchText(value).split(' ').filter(Boolean);
  const meaningful = words.filter(w => !_GAME_SEARCH_STOP_WORDS.has(w));
  const source = meaningful.length >= 2 ? meaningful : words;
  if (source.length < 2 || source.length > 7) return [];
  const letters = source.map(w => w.charAt(0)).join('');
  const out = [];
  if (letters.length >= 3 && letters.length <= 7) out.push(letters);
  const roman = gameRomanToInt(source[source.length - 1]);
  if (roman && source.length > 1) {
    const base = source.slice(0, -1).map(w => w.charAt(0)).join('');
    if (base.length >= 2) out.push(base + roman, base + source[source.length - 1]);
  }
  return Array.from(new Set(out));
}
function scoreGameForSearch(item, query) {
  const qU = normalizeGameSearchTextUnicode(query);
  const qA = normalizeGameSearchText(query);
  const qc = compactGameSearchText(query);
  if (!qU) return 0;

  // Separate the PRIMARY title (name + slug) from ALTERNATIVE names. A game
  // whose real title matches what you typed should outrank a game that merely
  // lists your query as one of many aliases — so alt-name matches are capped
  // one tier below primary matches.
  const primaryNames = [item.name, item.slug ? String(item.slug).replace(/-/g, ' ') : '']
    .filter(Boolean);
  const altRaw = Array.isArray(item.alternative_names) ? item.alternative_names
    : Array.isArray(item.alternativeNames) ? item.alternativeNames
    : [];
  const altNames = altRaw.map(alt => alt?.name || alt).filter(Boolean);

  // Strip stop words to get meaningful search tokens; fall back to all
  // tokens if the query is entirely stop words.
  const allWords = qU.split(/\s+/).filter(w => w.length > 0);
  const meaningful = allWords.filter(w => w.length > 2 && !_GAME_SEARCH_STOP_WORDS.has(w));
  const matchWords = meaningful.length > 0 ? meaningful : allWords.filter(w => w.length > 1);

  if (!matchWords.length) return 0;

  /* v11.300: text-match tier for a single candidate name.
       4 = strong PRIMARY match  (exact / starts-with full query / acronym / romanized)
       3 = strong ALT-name match (same tests, but on an alternative name)
       2 = contains ALL query words
       1 = contains SOME query word
       0 = no match
     "exact" and "starts-with full query" share the top tier so that, among all
     the genuinely-relevant titles, the recency-dominant tiebreaker decides the
     order (newest first). Comparisons use the unicode-aware normalizer so a
     non-Latin title can't collapse into a fake exact/prefix match. */
  function gameTextTier(name, isPrimary) {
    const nU = normalizeGameSearchTextUnicode(name);
    if (!nU) return 0;
    const nA = normalizeGameSearchText(name);
    const nc = compactGameSearchText(name);
    const strong = isPrimary ? 4 : 3;
    if (nU === qU) return strong;
    // compact equality only counts when the unicode word-count matches too, so
    // "Петька 007 …" (ascii-compacts to "007") is NOT treated as exact "007".
    if (nc && qc && nc === qc && nU.split(' ').length === qU.split(' ').length) return strong;
    if (isGameRomanizedNearVariant(nA, qA)) return strong;
    if (getGameSearchAcronyms(nA).includes(qc)) return strong;
    if (nU.startsWith(qU + ' ')) return strong;
    if (matchWords.every(w => nU.includes(w))) return 2;
    if (matchWords.some(w => nU.includes(w))) return 1;
    return 0;
  }

  // Tier 1 — text match (dominant; each point = 10 000). Take the best tier
  // across primary names, then across alternative names.
  let textScore = 0;
  for (const name of primaryNames) textScore = Math.max(textScore, gameTextTier(name, true));
  for (const name of altNames) textScore = Math.max(textScore, gameTextTier(name, false));

  if (textScore === 0) return 0; // no match — caller filters this out

  // Tier 2 — recency (DOMINANT within a text-match tier; newer always ranks
  // higher). v11.299: per user preference, recency is the primary ordering
  // inside a match tier. The old formula zeroed out anything released on/before
  // ~1990 (year <= 1990 → 0), so classics fell back to popularity ordering.
  // We now score recency monotonically by year with NO early-zero cutoff and a
  // per-year step (25) larger than the max popularity contribution (10), so
  // EVERY newer release outranks an older one regardless of how popular the
  // older one is. Still far below the text tier (×10000), so relevance wins.
  // e.g. 2026 → 1900, 2020 → 1750, 2010 → 1500, 2000 → 1250, 1990 → 1000.
  const year = Number(String(item.released || '').slice(0, 4)) || 0;
  const recencyScore = year >= 1950 ? Math.max(0, (year - 1950) * 25) : 0;

  // Tier 3 — popularity (0-10) — same-year tiebreak only. Because one year of
  // recency (25) outweighs the entire popularity range (10), popularity only
  // decides ordering between titles sharing the same release year.
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
    id:            `igdb:${g.id}`,
    name:          g.name || '',
    released:      g.released || '',
    background_image: g.cover || '',
    rating:        g.total_rating ? g.total_rating / 20 : 0,
    ratings_count: g.total_rating_count || 0,
    added:         g.total_rating_count || 0,
    hypes:         g.hypes || 0,
    follows:       g.follows || 0,
    rating_count:  g.rating_count || 0,
    aggregated_rating_count: g.aggregated_rating_count || 0,
    total_rating_count: g.total_rating_count || 0,
    platforms:     (g.platforms || []).map(p => ({ platform: { name: p } })),
    genres:        (g.genres    || []).map(n => ({ name: n })),
    themes:        (g.themes    || []).map(n => ({ name: n })),
    /* v10.494: forward alternative_names so the Universal Search
       bucket scorer can match abbreviations / regional titles. */
    alternative_names: Array.isArray(g.alternative_names) ? g.alternative_names.slice() : [],
    slug:          g.slug || '',
    source:        'igdb',
    sourceId:      String(g.id || ''),
    rawgId:        '',
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
  const providerLimit = Math.max(20, Math.min(40, Number(limit) || 20));

  const [igdbSettled, rawgSettled] = await Promise.allSettled([
    fetch(`/api/igdb/search?q=${encodeURIComponent(cleanQuery)}&limit=${providerLimit}`)
      .then(r => r.ok ? r.json() : { ok: false, results: [] })
      .then(j => (j.ok && Array.isArray(j.results) ? j.results : []).map(normaliseIgdbGameToRawg)),
    fetchRawgProxy('games', { search: cleanQuery, page_size: providerLimit, ordering: '-released' })
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
    const typeConfig = getAddShelfResultTypeConfig({ ...r, source: isIgdb ? 'igdb' : 'rawg', rawgId: isIgdb ? '' : r.id }, 'games');
    const badge = `<span class="shelf-result-badge ${typeConfig.badgeClass}">${typeConfig.label}</span>`;
    const meta  = escHtml(buildAddShelfResultMeta({ ...r, source: isIgdb ? 'igdb' : 'rawg', rawgId: isIgdb ? '' : r.id }, platforms, 'games'));
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
      name: title,
      cover,
      igdbCoverUrl: cover,
      genre: genres || platforms || 'Game',
      year,
      status: '',
      rating: 0,
      dateAdded: new Date().toISOString(),
      source: 'igdb',
      rawgId: '',
      igdbId: String(igdbGame.id || ''),
      sourceId: String(igdbGame.id || ''),
      gameIdentityKey: igdbGame.id ? `igdb:${igdbGame.id}` : '',
      rawgSlug: igdbGame.slug || '',
      igdbSlug: igdbGame.slug || '',
      backloggdSlug: igdbGame.slug || '',
      mediaCategory: 'games',
      librarySection: 'games',
      platforms: platforms,
      stores: [],
      metacritic: '',
      metacriticSlug: '',
      overview: igdbGame.summary || ''
    };
    attachShelfdGameIdentityLock(selectedTmdb, createShelfdGameIdentityLock(selectedTmdb, 'add-shelf-search-select-igdb'));
    traceShelfdGameIdentity('2 add-shelf game result selected', selectedTmdb);
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
      name: title,
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
      gameIdentityKey: `rawg:${String(id)}`,
      stores: Array.isArray(d.stores) ? d.stores : [],
      mediaCategory: 'games',
      librarySection: 'games',
      igdbCoverUrl: ''
    };
    attachShelfdGameIdentityLock(selectedTmdb, createShelfdGameIdentityLock(selectedTmdb, 'add-shelf-search-select-rawg'));
    traceShelfdGameIdentity('2 add-shelf game result selected', selectedTmdb);

    // Fetch IGDB portrait cover in background while user picks status
    try {
      const igdbRes = await fetch('/api/igdb/cover?title=' + encodeURIComponent(title));
      if (igdbRes.ok) {
        const igdbData = await igdbRes.json();
        if (igdbData.ok && igdbData.coverUrl) {
          const enriched = mergeShelfdGameIdentityLockedItem(selectedTmdb, { igdbCoverUrl: igdbData.coverUrl, cover: igdbData.coverUrl }, 'add-shelf-search-cover-enrichment');
          if (assertShelfdGameIdentity('add-shelf search cover enrichment', enriched, { toast: false })) selectedTmdb = enriched;
        }
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
            runtime: ep.runtime || 0,
            runtimeMinutes: ep.runtime || 0,
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
    applyJikanCanonicalAnimeFields(selectedTmdb, j, { overwrite: true });

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
  pendingModalStatusSelection = '';
  modalAddSubmitting = false;
  setAddShelfModalSelectionChoice({ status: '', rating: pendingModalRatingSelection });
  const targetSection = resolveAddShelfSelectedSection(getActiveAddShelfSelectedItem());
  const options = MODAL_STATUS_OPTIONS[targetSection] || MODAL_STATUS_OPTIONS.shows;
  renderAddShelfStepSurface({
    step: 'status',
    title: 'Choose shelf',
    subtitle: 'Pick where this title belongs.',
    backAction: 'clearSelection()',
    showChangeButton: true,
    panelClass: 'add-shelf-step-panel--status',
    bodyHtml: `
      <div class="add-shelf-choice-grid">
        ${options.map(o => `<button class="modal-status-btn add-shelf-choice-btn" type="button" onclick="showModalAddConfirmation('${o.status}')">${escHtml(o.label)}</button>`).join('')}
      </div>
    `
  });
  setModalBackBtn(false);
}

function renderModalAddConfirmation(status, backHandler = showModalStatusPicker) {
  const selectedItem = getActiveAddShelfSelectedItem();
  if (!selectedItem) return;
  const targetSection = resolveAddShelfSelectedSection(selectedItem);
  const statusLabel = getAddShelfStatusLabel(status, targetSection);
  const ratingCopy = status === 'watched'
    ? `<div class="modal-status-confirm-copy">Rating <strong>${escHtml(getAddShelfModalRatingValue(pendingModalRatingSelection, targetSection))}</strong></div>`
    : '';
  const confirmCopy = status === 'watched'
    ? `Add this title to <strong>${escHtml(statusLabel)}</strong> with your rating?`
    : `Add this title to <strong>${escHtml(statusLabel)}</strong>?`;
  renderAddShelfStepSurface({
    step: 'confirm',
    title: 'Review',
    subtitle: 'Confirm the destination before saving.',
    backAction: pendingModalStatusSelection === 'watched' ? 'showModalRatingPrompt(pendingModalRatingSelection)' : 'showModalStatusPicker()',
    showChangeButton: false,
    panelClass: 'add-shelf-step-panel--confirm',
    bodyHtml: `
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
    `
  });
  setModalBackBtn(false);
}

function showModalRatingPrompt(selectedRating = pendingModalRatingSelection) {
  const selectedItem = getActiveAddShelfSelectedItem();
  if (!selectedItem) return;
  pendingModalStatusSelection = 'watched';
  modalAddSubmitting = false;
  setAddShelfModalSelectionChoice({ status: 'watched', rating: selectedRating });
  const targetSection = resolveAddShelfSelectedSection(selectedItem);
  const stars = typeof buildStandaloneRatingStarsMarkup === 'function'
    ? buildStandaloneRatingStarsMarkup(Number(selectedRating || 0) || 0, targetSection, 'selectAddShelfModalRating')
    : '';
  renderAddShelfStepSurface({
    step: 'rating',
    title: 'Set your rating',
    subtitle: 'Set it once. The next screen is only a summary.',
    backAction: 'showModalStatusPicker()',
    showChangeButton: false,
    panelClass: 'add-shelf-step-panel--rating',
    bodyHtml: `
      <div class="discover-rating-prompt add-shelf-rating-prompt add-shelf-rating-flow">
        <div class="add-shelf-rating-copy">
          <div class="add-shelf-rating-kicker">Rating</div>
          <div class="add-shelf-rating-readout">${escHtml(selectedItem.title || 'This title')}</div>
          <div class="discover-add-desc add-shelf-rating-desc">Choose a rating or skip it for now.</div>
        </div>
        ${stars}
        <div class="modal-status-confirm-actions add-shelf-rating-actions">
          <button class="btn-secondary modal-status-confirm-back" type="button" onclick="showModalStatusPicker()">Back</button>
          <button class="btn-secondary" type="button" onclick="skipAddShelfModalRating()">Skip</button>
          <button class="btn-primary modal-status-confirm-submit" type="button" onclick="confirmAddShelfModalRating()" ${Number(selectedRating || 0) > 0 ? '' : 'disabled'}>Confirm</button>
        </div>
      </div>
    `
  });
  setModalBackBtn(false);
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
  const selectedArea = document.getElementById('tmdb-selected-area');
  const confirmBtn = selectedArea?.querySelector('.modal-status-confirm-submit');
  const backBtn = selectedArea?.querySelector('.modal-status-confirm-back');
  modalAddSubmitting = true;
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Adding...'; }
  if (backBtn) backBtn.disabled = true;
  /* v10.65: this function previously had a single `try/catch` wrapping
     submitModal() AND all post-save UI calls (toast, success-panel render,
     setTimeout schedule). On older iOS, an unrelated UI throw (most often
     from render() in submitModal — see fix at submitModal:render()) was
     being miscategorized by the catch as a SAVE failure, so the user saw
     "Could not add this title" even though the title was already in their
     library. The next attempt then tripped duplicate-detection and showed
     "this title is already added to your library silly!" — confusing and
     wrong. Fix: split the catch — only `submitModal()` itself is wrapped
     by the outer try. Every UI call after the save runs in its own
     try/catch so a UI hiccup never lies about whether the save worked. */
  let result;
  try {
    const rating = selectedStatus === 'watched'
      ? (Number(addShelfModalSelectionState?.rating ?? pendingModalRatingSelection ?? 0) || 0)
      : 0;
    result = await submitModal(selectedStatus, rating, selectedItem);
  } catch (error) {
    console.error('[v10.65] submitModal threw — actual save failure:', error);
    try { showToast('Could not add this title. Try again.'); } catch (_) {}
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm'; }
    if (backBtn) backBtn.disabled = false;
    modalAddSubmitting = false;
    return;
  }
  if (!result || !result.ok) {
    // submitModal returned a controlled failure (duplicate, signed-out, etc.).
    // It already showed its own toast where appropriate. Just re-enable buttons.
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm'; }
    if (backBtn) backBtn.disabled = false;
    modalAddSubmitting = false;
    return;
  }
  // -- Save succeeded. Below this point, ANY throw is a UI-only problem and
  //    must NOT be reported as "Could not add". Each call is independently
  //    wrapped so one failure cannot cascade.
  try { triggerAddShelfSuccessFeedback(); }
  catch (e) { console.warn('[v10.65] success feedback failed (non-fatal):', e); }
  try { showToast(result.message || 'Added to your library'); }
  catch (e) { console.warn('[v10.65] success toast failed (non-fatal):', e); }
  try {
    renderAddShelfStepSurface({
      step: 'success',
      title: 'Added to library',
      subtitle: 'Your shelf is up to date.',
      showBack: false,
      showChangeButton: false,
      panelClass: 'add-shelf-step-panel--success',
      bodyHtml: `
        <div class="add-shelf-success-panel" role="status" aria-live="polite">
          <div class="add-shelf-success-mark">&#10003;</div>
          <div class="modal-status-confirm-title">Added to library</div>
          <div class="modal-status-confirm-copy">${escHtml(result.item?.title || selectedItem.title || 'This title')} is on your shelf.</div>
        </div>
      `
    });
    setModalBackBtn(false);
  } catch (e) {
    console.warn('[v10.65] success panel render failed (non-fatal):', e);
  }
  /* v10.64: was 620ms — too brief to register as a confirmation. */
  window.setTimeout(() => {
    try {
      restoreAddShelfSearchResults();
      flashAddShelfSearchMessage(result.message || 'Added to library');
    } catch (e) {
      console.warn('[v10.65] modal restore failed (non-fatal):', e);
    }
  }, 1800);
  modalAddSubmitting = false;
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
  document.body.classList.add('add-shelf-modal-open');
  document.getElementById("modal-title").textContent = 'Add to Shelf';
  setAddShelfModalStep('search');
  clearTimeout(addTitleLiveSearchTimer);
  addTitleSearchRequestToken++;
  renderApiKeySection();
  resetAddShelfModalHome();
  updateAddShelfModalSelectionLayout(false);
  lockAddShelfModalBackgroundScroll();
}
function closeModal() {
  document.getElementById("modal").style.display = "none";
  document.body.classList.remove('add-shelf-modal-open');
  resetAddTitleSelection({ clearSearchSnapshot: true });
  setModalBackBtn(false);
  removeAddShelfSearchFlashMessage();
  unlockAddShelfModalBackgroundScroll();
}
function isDuplicateTitle(itemOrTitle, section, excludeId = null) {
  return isDuplicateTitleInList(itemOrTitle, section, data, excludeId);
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

function isDuplicateTitleInList(itemOrTitle, section, sourceData, excludeId = null) {
  if (!sourceData || !Array.isArray(sourceData[section])) return false;
  const wantedMalId = typeof itemOrTitle === 'object' ? getScreenListAnimeMalId(itemOrTitle) : '';
  if (section === 'anime' && wantedMalId) {
    const malMatch = sourceData[section].some(item => item && item.id !== excludeId && getScreenListAnimeMalId(item) === wantedMalId);
    if (malMatch) return true;
  }
  const titleKeys = getDuplicateTitleKeys(itemOrTitle);
  if (!titleKeys.size) return false;
  return sourceData[section].some(item => {
    if (!item || item.id === excludeId) return false;
    const existingKeys = getDuplicateTitleKeys(item);
    return [...titleKeys].some(key => existingKeys.has(key));
  });
}

function findDuplicateImportItemInList(item = {}, entry = {}, section, sourceData, excludeId = null) {
  if (!sourceData || !Array.isArray(sourceData[section])) return null;
  const malId = getScreenListAnimeMalId(item) || getScreenListAnimeMalId(entry);
  if (malId) {
    const malMatch = sourceData[section].find(existing => existing && existing.id !== excludeId && getScreenListAnimeMalId(existing) === malId);
    if (malMatch) return malMatch;
  }
  const appleMusicAlbumId = String(item.appleMusicAlbumId || entry.appleMusicAlbumId || '').trim();
  if (appleMusicAlbumId) {
    const appleMusicMatch = sourceData[section].find(existing => existing && existing.id !== excludeId && String(existing.appleMusicAlbumId || '').trim() === appleMusicAlbumId);
    if (appleMusicMatch) return appleMusicMatch;
  }
  /* v11.569: id-based match (TMDB then IMDb) before the title-key fallback, so a
     bulk import dedupes remakes / same-title films correctly against the library. */
  const tmdbId = String(item.tmdbId || entry.tmdbId || '').trim();
  if (tmdbId) {
    const tmdbMatch = sourceData[section].find(existing => existing && existing.id !== excludeId && String(existing.tmdbId || '').trim() === tmdbId);
    if (tmdbMatch) return tmdbMatch;
  }
  const imdbId = String(item.imdbId || entry.imdbId || '').trim().toLowerCase();
  if (/^tt\d+/.test(imdbId)) {
    const imdbMatch = sourceData[section].find(existing => existing && existing.id !== excludeId && String(existing.imdbId || '').trim().toLowerCase() === imdbId);
    if (imdbMatch) return imdbMatch;
  }
  const titleKeys = getDuplicateTitleKeys(item);
  if (!titleKeys.size) return null;
  return sourceData[section].find(existing => {
    if (!existing || existing.id === excludeId) return false;
    const existingKeys = getDuplicateTitleKeys(existing);
    return [...titleKeys].some(key => existingKeys.has(key));
  }) || null;
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
  fill('mal_id', incoming.mal_id || incoming.malId || entry.malId || '');
  fill('animeIdentityKey', incoming.animeIdentityKey || (incoming.malId || entry.malId ? `mal:${incoming.malId || entry.malId}` : ''));
  fill('malUrl', incoming.malUrl || incoming.url || '');
  fill('jikanUrl', incoming.jikanUrl || incoming.malUrl || incoming.url || '');
  fill('url', incoming.url || incoming.malUrl || '');
  fill('animeType', incoming.animeType || incoming.type || '');
  fill('title_english', incoming.title_english || incoming.englishTitle || '');
  fill('title_japanese', incoming.title_japanese || incoming.japaneseTitle || '');
  fill('genre', incoming.genre || '');
  fill('genreNames', incoming.genreNames || []);
  fill('year', incoming.year || '');
  fill('mediaCategory', incoming.mediaCategory || (section || 'anime'));
  fill('librarySection', incoming.librarySection || (section || 'anime'));
  fill('source', incoming.source || entry.source || '');
  fill('appleMusicAlbumId', incoming.appleMusicAlbumId || entry.appleMusicAlbumId || '');
  fill('appleMusicSongIds', incoming.appleMusicSongIds || entry.appleMusicSongIds || []);
  fill('appleMusicPlayParams', incoming.appleMusicPlayParams || entry.appleMusicPlayParams || null);
  fill('tracks', incoming.tracks || entry.tracks || []);
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
  /* v11.569: Letterboxd "keep mine, fill blanks". Only fills what's empty and
     upgrades planned -> watched (the film is now logged). Never overwrites a
     rating / review / watched status the user already set in Shelfd. */
  if (String(entry.source || incoming.importSource || '').toLowerCase() === 'letterboxd') {
    if (Number(incoming.rating) > 0 && !(Number(existing.rating) > 0)) { existing.rating = Number(incoming.rating); changed = true; }
    const hadReview = !!String(existing.reviewText || '').trim();
    fill('reviewText', incoming.reviewText || entry.reviewText || '');
    if (!hadReview && String(existing.reviewText || '').trim()) {
      /* v11.569: a freshly-imported review stays PRIVATE/title-only so the first
         Reply/edit-save can't silently publish a feed post. Never touched when the
         user already had their own review (hadReview). */
      if (existing.reviewRepliesPublic === undefined) existing.reviewRepliesPublic = false;
      if (!existing.reviewVisibility) existing.reviewVisibility = 'private';
      changed = true;
    }
    fill('dateWatched', incoming.dateWatched || entry.dateWatched || '');
    fill('letterboxdUri', incoming.letterboxdUri || entry.letterboxdUri || '');
    if ((incoming.status === 'watched' || entry.status === 'watched') && existing.status === 'planned') { existing.status = 'watched'; changed = true; }
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

async function submitModal(status, rating = 0, itemOverride = null) {
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return { ok: false };
  /* v10.78: caller-supplied `itemOverride` is the authoritative source when
     present — callers that just set `window.selectedTmdb` (e.g. the Discover
     game add sheet) pass it explicitly to guarantee the snapshot in
     `addShelfModalSelectionState.item` (which may be stale from a prior Add
     to Shelf flow that was closed without confirming) cannot override.
     Identity-guardrail: if the override title disagrees with the cached
     snapshot title, log a warning — this is the exact symptom of an
     identity swap and the warning makes future regressions traceable in
     the console without needing to reproduce the bug. */
  const cachedSnapshot = getActiveAddShelfSelectedItem();
  if (itemOverride && cachedSnapshot && typeof itemOverride === 'object' && typeof cachedSnapshot === 'object'
      && itemOverride.title && cachedSnapshot.title
      && String(itemOverride.title).trim() !== String(cachedSnapshot.title).trim()) {
    console.warn('[v10.78] submitModal itemOverride title differs from cached snapshot — using override.',
      { overrideTitle: itemOverride.title, snapshotTitle: cachedSnapshot.title });
  }
  const selectedItem = itemOverride || cachedSnapshot || selectedTmdb;
  if (!selectedItem) return { ok: false };
  const targetSection = resolveAddShelfSelectedSection(selectedItem);
  if (targetSection === 'games') {
    traceShelfdGameIdentity('5 add-to-library/status selection input', selectedItem, { status, rating });
    if (!assertShelfdGameIdentity('7 before saving game to My Lists', selectedItem)) {
      return { ok: false, identityMismatch: true };
    }
  }
  const validStatuses = (MODAL_STATUS_OPTIONS[targetSection] || []).map(o => o.status);
  if (!validStatuses.includes(status)) status = getDefaultTabForSection(targetSection);
  const targetData = ownDataCache ? cloneListData(ownDataCache) : cloneListData(data);
  targetData[targetSection] = Array.isArray(targetData[targetSection]) ? targetData[targetSection] : [];
  const isAnimeSeriesAdd = targetSection === 'anime' && (selectedItem.isAnime || selectedItem.mediaCategory === 'anime') && selectedItem.tmdbId;
  const cleanedAnimeList = isAnimeSeriesAdd ? removeAnimeSeasonSplitEntries(targetData[targetSection], selectedItem) : targetData[targetSection];
  const removedSplitAnimeEntries = isAnimeSeriesAdd && cleanedAnimeList.length !== targetData[targetSection].length;
  if (isAnimeSeriesAdd) targetData[targetSection] = cleanedAnimeList;

  if (isDuplicateTitleInList(selectedItem, targetSection, targetData)) {
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
  if (targetSection === 'anime') {
    Object.assign(item, getAnimeCanonicalSaveFields(selectedItem));
    item.mediaCategory = 'anime';
    item.librarySection = 'anime';
    item.isAnime = true;
    if (Number(selectedItem.totalEps || selectedItem.totalEpisodes || 0) && !Number(item.totalEpisodes || 0)) {
      item.totalEpisodes = Number(selectedItem.totalEpisodes || selectedItem.totalEps || 0);
      item.totalEps = Number(selectedItem.totalEps || selectedItem.totalEpisodes || 0);
    }
  }
  if (targetSection === 'games') {
    item.name = item.title;
    item.sourceId = selectedItem.sourceId || '';
    item.igdbId = selectedItem.igdbId || '';
    item.igdbSlug = selectedItem.igdbSlug || '';
    item.gameIdentityKey = selectedItem.gameIdentityKey || selectedItem.shelfdGameIdentityLock?.key || '';
    if (selectedItem.shelfdGameIdentityLock) {
      attachShelfdGameIdentityLock(item, selectedItem.shelfdGameIdentityLock);
    } else {
      attachShelfdGameIdentityLock(item, createShelfdGameIdentityLock(item, 'submit-modal-save'));
    }
    if (!assertShelfdGameIdentity('7 save object built for My Lists', item)) {
      return { ok: false, identityMismatch: true };
    }
  }
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
      runtime: ep.runtime || ep.runtimeMinutes || 0,
      runtimeMinutes: ep.runtimeMinutes || ep.runtime || 0,
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
  /* v10.66: in-memory state ALWAYS gets the update first. The two writes below
     (localStorage backup + canonical localStorage, plus background Firestore)
     are persistence steps that can independently fail without invalidating the
     in-memory add. */
  data = cloneListData(safeData);
  ownDataCache = cloneListData(safeData);

  /* v10.66: iOS PWAs have a ~5MB localStorage cap (the codebase already
     acknowledges this — see the v843 comment in 06-mylists-render-...js).
     Once a user's library grows past that ceiling, `localStorage.setItem`
     starts throwing `QuotaExceededError` on every save. Previously that
     throw propagated up through submitModal -> the awaiting confirmModalAdd
     catch, which then showed "Could not add this title" even though the
     item was in `data` and `ownDataCache` already (and the next attempt
     correctly showed "already added" — exactly the symptom the user reported
     on their PWA).
     Fix: wrap each localStorage.setItem independently. If one throws, log
     it, leave the in-memory state intact, and let the Firestore write
     (signed-in users) carry the persistence. Local restore from
     `localStorage` will keep the last-saved snapshot — slightly stale —
     but the user's actual data is safe in Firestore. */
  let localStorageOk = true;
  let localStorageWarned = false;
  const reportLocalStorageWarn = (key, err) => {
    if (localStorageWarned) return;
    localStorageWarned = true;
    const isQuota = err && (err.name === 'QuotaExceededError' || err.code === 22 || /quota/i.test(String(err.message || '')));
    console.warn('[v10.66] localStorage write failed for key=' + key + (isQuota ? ' (QUOTA EXCEEDED — iOS PWA 5MB cap)' : ''), err);
  };
  if (currentUser) {
    try {
      localStorage.setItem('screenlist-own-data-backup-' + currentUser.uid, JSON.stringify(safeData));
    } catch (err) {
      localStorageOk = false;
      reportLocalStorageWarn('screenlist-own-data-backup-' + currentUser.uid, err);
    }
  }
  if (!currentUser) {
    try {
      localStorage.setItem('watchlist-tracker-data', JSON.stringify(safeData));
    } catch (err) {
      localStorageOk = false;
      reportLocalStorageWarn('watchlist-tracker-data', err);
    }
  }

  activeSection = targetSection;
  activeTab = targetSection === 'games' && status === 'live' ? 'watching' : status;

  /* v10.65: wrap render() so a UI render hiccup never lies about the save. */
  try {
    render();
  } catch (renderErr) {
    console.warn('[v10.65] render() threw after Add to Shelf save — title is already persisted in memory:', renderErr);
  }

  // Firestore write happens in the background — doesn't block the modal close.
  // This is the AUTHORITATIVE persistence layer for signed-in users; localStorage
  // is just a fast-reload cache. So we still kick this off even if localStorage
  // failed above.
  if (DOC_REF) {
    persistOwnDataToFirestore(safeData).catch(err => {
      console.error('Background Firestore write failed after shelf add:', err);
      showToast('Saved locally. Cloud sync may be delayed.');
    });
  }

  /* v10.66: if localStorage failed AND there's no Firestore (signed-out user
     with a big local library), surface a non-blocking warning so the user
     knows their library may not survive a PWA restart. The add itself is
     still in-memory for the current session. */
  if (!localStorageOk && !DOC_REF) {
    try { showToast('Saved for this session. Sign in to sync your library.'); } catch (_) {}
  }

  return { ok: true, item: { ...item }, section: targetSection, status, rating: Number(rating || 0) || 0, message: `Added to ${getAddShelfStatusLabel(status, targetSection)}` };
}
