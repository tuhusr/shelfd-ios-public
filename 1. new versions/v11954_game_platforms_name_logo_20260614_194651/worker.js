import { Resvg } from "@cf-wasm/resvg";

const TMDB_ORIGIN = "https://api.themoviedb.org/3/";
const RAWG_ORIGIN = "https://api.rawg.io/api/";
const TRAKT_ORIGIN = "https://api.trakt.tv";
const STEAM_API_ORIGIN = "https://api.steampowered.com";
const STEAM_OPENID_ORIGIN = "https://steamcommunity.com";
const OMDB_ORIGIN = "https://www.omdbapi.com/";
const TAVILY_ORIGIN = "https://api.tavily.com/";
const IGDB_ORIGIN = "https://api.igdb.com/v4/";
const TWITCH_TOKEN_ORIGIN = "https://id.twitch.tv/oauth2/token";
const MUSICBRAINZ_ORIGIN = "https://musicbrainz.org/ws/2/";
const COVER_ART_ARCHIVE_ORIGIN = "https://coverartarchive.org/";
/* v10.248: Deezer Simple API — no key, no auth, 50 req/5s/IP. Used as the
   primary music metadata source (search, albums, artists, tracklists) because
   it returns real cover art, official tracklists with durations + features,
   and popularity-ranked results. MusicBrainz is kept around as fallback for
   anything Deezer can't resolve. */
const DEEZER_ORIGIN = "https://api.deezer.com/";
const SCREENLIST_DEEZER_CACHE_TTL_SECONDS = 60 * 60 * 24; // 24h: Deezer metadata is stable
// v11.067: Apple Music + Spotify exact-album links resolved via song.link/Odesli.
// Album→service links never change, so cache for 30 days to stay well under the
// resolver's rate limit.
const SONGLINK_ORIGIN = "https://api.song.link/v1-alpha.1/links";
const SCREENLIST_MUSIC_LINKS_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
const YOUTUBE_ORIGIN = "https://www.googleapis.com/youtube/v3/";
const YOUTUBE_ENV_NAMES = ["YOUTUBE_API_KEY", "YT_KEY", "YOUTUBE_KEY"];
const SCREENLIST_YOUTUBE_CACHE_TTL_SECONDS = 60 * 60 * 6;
/* v11.084: the Trailer Views metric on Movie/TV profiles caches its final
   aggregated total for 48h. Trailer view counts move slowly and the number
   is only a "how much attention has this gotten" signal, so 48h is a fair
   tradeoff between freshness and YouTube quota (esp. the 100-unit search
   fallback, which we never want to fire more than ~once per title per 2 days). */
const SCREENLIST_TRAILER_VIEWS_CACHE_TTL_SECONDS = 60 * 60 * 48;
/* Bump this whenever the trusted-channel list or scoring/filter logic changes,
   so stale cached totals (and negative no-match results) are flushed instead
   of lingering for the 48h TTL. v2: + aggregators (Moviefone/KinoCheck) +
   sum-all + Star Wars official channel. */
const SCREENLIST_TRAILER_VIEWS_CACHE_VERSION = "v3";
const SCREENLIST_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const SCREENLIST_AI_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
const SCREENLIST_API_CACHE_TTL_SECONDS = 60 * 60 * 6;
const SCREENLIST_MUSICBRAINZ_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;
const SCREENLIST_RANK_CACHE_TTL_SECONDS = 60 * 60 * 24;
const SCREENLIST_IMDB_RATING_CACHE_TTL_SECONDS = 60 * 60 * 24 * 3;
/* v10.234: bump v4→v5 to flush wrong-title-match entries (e.g. a fuzzy OMDb
   "Obsession" match cached at the wrong rating) so the new strict title/year
   validation below repopulates every cache key with the correct IMDb rating.
   v10.235: bump v5→v6 to flush stale OMDb-snapshot ratings cached for recent
   releases (e.g. "Obsession" 7.6) so the new live IMDb-page extract repopulates
   them with the accurate live number (8.2). */
const SCREENLIST_IMDB_RATING_CACHE_VERSION = "v6";
const SCREENLIST_IMDB_REVIEWS_CACHE_TTL_SECONDS = 60 * 60 * 12;
const SCREENLIST_IMDB_REVIEWS_CACHE_VERSION = "v1";
const SCREENLIST_TAVILY_RATING_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
const TRAKT_ENV_NAMES = ["TRAKT_CLIENT_ID", "TRAKT_API_KEY", "TRAKT_KEY", "TRAKT_CLIENT_KEY"];
const STEAM_ENV_NAMES = ["STEAM_API_KEY", "STEAM_KEY", "STEAM_WEB_API_KEY"];
const OMDB_ENV_NAMES = ["OMDB_API_KEY", "OMDB_KEY", "IMDB_RATINGS_KEY", "IMDB_KEY"];
const TAVILY_ENV_NAMES = ["TAVILY_API_KEY", "TAVILY_KEY"];
const IGDB_CLIENT_ID_ENV_NAMES = ["IGDB_CLIENT_ID", "TWITCH_CLIENT_ID"];
const IGDB_CLIENT_SECRET_ENV_NAMES = ["IGDB_CLIENT_SECRET", "TWITCH_CLIENT_SECRET"];
const APPLE_MUSIC_TEAM_ID_ENV_NAMES = ["APPLE_MUSIC_TEAM_ID", "APPLE_TEAM_ID"];
const APPLE_MUSIC_KEY_ID_ENV_NAMES = ["APPLE_MUSIC_KEY_ID", "MUSICKIT_KEY_ID"];
const APPLE_MUSIC_PRIVATE_KEY_ENV_NAMES = ["APPLE_MUSIC_PRIVATE_KEY", "MUSICKIT_PRIVATE_KEY"];
const APPLE_MUSIC_TOKEN_TTL_SECONDS = 60 * 60 * 12;
let igdbAccessTokenCache = { token: "", expiresAt: 0 };
let appleMusicDeveloperTokenCache = { token: "", expiresAtMs: 0, expSec: 0 };
let shelfdOgFontPromise = null;
let shelfdOgFallbackFontPromise = null;

function getEnvString(env, name) {
  const value = env && env[name];
  return typeof value === "string" ? value.trim() : "";
}

function getTraktClientConfig(env) {
  for (const name of TRAKT_ENV_NAMES) {
    const value = getEnvString(env, name);
    if (value) return { name, value };
  }
  return { name: "", value: "" };
}

function getTraktPublicStatus(env) {
  const config = getTraktClientConfig(env);
  return {
    configured: !!config.value,
    envName: config.name || "",
    acceptedEnvNames: TRAKT_ENV_NAMES
  };
}

function getTraktConfigError(env) {
  const status = getTraktPublicStatus(env);
  if (status.configured) return "";
  return `Trakt API key is not configured. Add your Trakt OAuth app Client ID as a Cloudflare Worker secret named ${TRAKT_ENV_NAMES[0]}. Also accepted: ${TRAKT_ENV_NAMES.slice(1).join(", ")}.`;
}

function getSteamApiConfig(env) {
  for (const name of STEAM_ENV_NAMES) {
    const value = getEnvString(env, name);
    if (value) return { name, value };
  }
  return { name: "", value: "" };
}

function getSteamPublicStatus(env) {
  const config = getSteamApiConfig(env);
  return {
    configured: !!config.value,
    envName: config.name || "",
    acceptedEnvNames: STEAM_ENV_NAMES
  };
}

function getSteamConfigError(env) {
  const status = getSteamPublicStatus(env);
  if (status.configured) return "";
  return `Steam API key is not configured. Add it as a Cloudflare Worker secret named ${STEAM_ENV_NAMES[0]}. Also accepted: ${STEAM_ENV_NAMES.slice(1).join(", ")}.`;
}

/* v10.152: YouTube Data API v3 config — used by the new
   /api/youtube/videos and /api/youtube/comments endpoints that power
   the Most Anticipated hype-score pipeline. Key stored as a Cloudflare
   Worker secret (YOUTUBE_API_KEY). Same lookup-by-env-name-list
   pattern as OMDb/TMDB/Trakt above. */
function getYoutubeClientConfig(env) {
  for (const name of YOUTUBE_ENV_NAMES) {
    const value = getEnvString(env, name);
    if (value) return { name, value };
  }
  return { name: "", value: "" };
}

function getYoutubePublicStatus(env) {
  const config = getYoutubeClientConfig(env);
  return {
    configured: !!config.value,
    envName: config.name || "",
    acceptedEnvNames: YOUTUBE_ENV_NAMES
  };
}

function getOmdbClientConfig(env) {
  for (const name of OMDB_ENV_NAMES) {
    const value = getEnvString(env, name);
    if (value) return { name, value };
  }
  return { name: "", value: "" };
}

function getOmdbPublicStatus(env) {
  const config = getOmdbClientConfig(env);
  return {
    configured: !!config.value,
    envName: config.name || "",
    acceptedEnvNames: OMDB_ENV_NAMES
  };
}

function getOmdbConfigError(env) {
  const status = getOmdbPublicStatus(env);
  if (status.configured) return "";
  return `IMDb rating lookup is not configured. Add an OMDb API key as a Cloudflare Worker secret named ${OMDB_ENV_NAMES[0]}. Also accepted: ${OMDB_ENV_NAMES.slice(1).join(", ")}.`;
}

function getTavilyClientConfig(env) {
  for (const name of TAVILY_ENV_NAMES) {
    const value = getEnvString(env, name);
    if (value) return { name, value };
  }
  return { name: "", value: "" };
}

function getTavilyPublicStatus(env) {
  const config = getTavilyClientConfig(env);
  return {
    configured: !!config.value,
    envName: config.name || "",
    acceptedEnvNames: TAVILY_ENV_NAMES
  };
}

function getTavilyConfigError(env) {
  const status = getTavilyPublicStatus(env);
  if (status.configured) return "";
  return `Tavily search is not configured. Add your Tavily API key as a Cloudflare Worker secret named ${TAVILY_ENV_NAMES[0]}. Also accepted: ${TAVILY_ENV_NAMES.slice(1).join(", ")}.`;
}

function getIgdbClientConfig(env) {
  const clientIdName = IGDB_CLIENT_ID_ENV_NAMES.find(name => getEnvString(env, name));
  const clientSecretName = IGDB_CLIENT_SECRET_ENV_NAMES.find(name => getEnvString(env, name));
  return {
    clientIdName: clientIdName || "",
    clientId: clientIdName ? getEnvString(env, clientIdName) : "",
    clientSecretName: clientSecretName || "",
    clientSecret: clientSecretName ? getEnvString(env, clientSecretName) : ""
  };
}

function getIgdbPublicStatus(env) {
  const config = getIgdbClientConfig(env);
  return {
    configured: !!(config.clientId && config.clientSecret),
    clientIdEnvName: config.clientIdName || "",
    clientSecretEnvName: config.clientSecretName || "",
    acceptedClientIdEnvNames: IGDB_CLIENT_ID_ENV_NAMES,
    acceptedClientSecretEnvNames: IGDB_CLIENT_SECRET_ENV_NAMES
  };
}

function getIgdbConfigError(env) {
  const status = getIgdbPublicStatus(env);
  if (status.configured) return "";
  return `IGDB/Twitch cover lookup is not configured. Add Cloudflare Worker secrets named ${IGDB_CLIENT_ID_ENV_NAMES[0]} and ${IGDB_CLIENT_SECRET_ENV_NAMES[0]}.`;
}

function getMusicBrainzUserAgent(env) {
  return getEnvString(env, "MUSICBRAINZ_USER_AGENT")
    || "Shelfd/10.137 (https://www.myshelfd.com)";
}

function getMusicBrainzPublicStatus(env) {
  return {
    configured: true,
    authRequired: false,
    userAgentConfigured: !!getEnvString(env, "MUSICBRAINZ_USER_AGENT"),
    userAgentEnvName: "MUSICBRAINZ_USER_AGENT",
    rateLimit: "Design client calls around MusicBrainz public API etiquette: cache responses and avoid bursts; 1 request/second is the safest target."
  };
}

function normalizeMusicBrainzEntityType(value = "") {
  const clean = String(value || "").trim().toLowerCase().replace(/_/g, "-");
  const aliases = {
    album: "release",
    albums: "release",
    artist: "artist",
    artists: "artist",
    track: "recording",
    tracks: "recording",
    song: "recording",
    songs: "recording",
    recording: "recording",
    recordings: "recording",
    release: "release",
    releases: "release",
    "release-group": "release-group",
    "release-groups": "release-group",
    label: "label",
    labels: "label",
    work: "work",
    works: "work",
    area: "area",
    areas: "area",
    event: "event",
    events: "event",
    genre: "genre",
    genres: "genre",
    instrument: "instrument",
    instruments: "instrument",
    place: "place",
    places: "place",
    series: "series",
    url: "url",
    urls: "url"
  };
  return aliases[clean] || "";
}

function buildMusicBrainzHeaders(env) {
  return {
    "Accept": "application/json",
    "User-Agent": getMusicBrainzUserAgent(env)
  };
}

function escapeIgdbSearchString(value = "") {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').trim();
}

function normalizeIgdbGameTitle(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[®™©]/g, "")
    .replace(/\b(game of the year|goty|deluxe|ultimate|complete|definitive|enhanced|remastered|remake|standard|edition|bundle)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreIgdbCoverCandidate(game = {}, requestedTitle = "") {
  const requested = normalizeIgdbGameTitle(requestedTitle);
  const candidate = normalizeIgdbGameTitle(game.name || "");
  if (!requested || !candidate) return 0;
  if (candidate === requested) return 100;
  if (candidate.startsWith(requested) || requested.startsWith(candidate)) return 80;
  const requestedWords = new Set(requested.split(" ").filter(Boolean));
  const candidateWords = new Set(candidate.split(" ").filter(Boolean));
  const overlap = [...requestedWords].filter(word => candidateWords.has(word)).length;
  return overlap ? 40 + overlap * 6 : 0;
}

function selectBestIgdbCoverCandidate(games = [], requestedTitle = "") {
  const ranked = (Array.isArray(games) ? games : [])
    .filter(game => game?.cover?.image_id)
    .map(game => ({ game, score: scoreIgdbCoverCandidate(game, requestedTitle) }))
    .filter(row => row.score >= 45)
    .sort((a, b) => b.score - a.score || Number(b.game.total_rating || b.game.rating || 0) - Number(a.game.total_rating || a.game.rating || 0));
  return ranked[0]?.game || null;
}
function buildIgdbGameTitleQueries(title = "") {
  const clean = String(title || "").trim();
  const noParens = clean.replace(/\([^)]*\)/g, "").trim();
  const noYear = noParens.replace(/(19|20)\d{2}/g, "").replace(/\s+/g, " ").trim();
  const beforeDash = clean.replace(/\s*[-:–—]\s*.*/, "").trim();
  const normalized = normalizeIgdbGameTitle(clean);
  const normalizedNoYear = normalizeIgdbGameTitle(noYear);
  const variants = [
    clean,
    noParens,
    noYear,
    beforeDash,
    normalized,
    normalizedNoYear
  ].filter(Boolean);
  return [...new Set(variants.map(value => String(value || "").trim()).filter(Boolean))];
}

const IGDB_COVER_IMAGE_SIZE = "cover_big_2x";

function buildIgdbCoverUrl(imageId = "", size = IGDB_COVER_IMAGE_SIZE) {
  const clean = String(imageId || "").trim();
  const cleanSize = String(size || IGDB_COVER_IMAGE_SIZE).replace(/^t_/, "").replace(/[^a-z0-9_]+/gi, "") || IGDB_COVER_IMAGE_SIZE;
  return clean ? `https://images.igdb.com/igdb/image/upload/t_${cleanSize}/${clean}.jpg` : "";
}

// v11.953: platform logos are PNGs (transparent) — keep .png, not .jpg.
function buildIgdbLogoUrl(imageId = "") {
  const clean = String(imageId || "").trim();
  return clean ? `https://images.igdb.com/igdb/image/upload/t_logo_med/${clean}.png` : "";
}

async function fetchIgdbAccessToken(env, timeoutMs = 8000) {
  const config = getIgdbClientConfig(env);
  if (!config.clientId || !config.clientSecret) {
    return { ok: false, status: 500, error: getIgdbConfigError(env), igdb: getIgdbPublicStatus(env) };
  }

  if (igdbAccessTokenCache.token && Date.now() < igdbAccessTokenCache.expiresAt) {
    return { ok: true, token: igdbAccessTokenCache.token, cached: true, igdb: getIgdbPublicStatus(env) };
  }

  const url = new URL(TWITCH_TOKEN_ORIGIN);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("client_secret", config.clientSecret);
  url.searchParams.set("grant_type", "client_credentials");
  const result = await fetchJsonWithTimeout(url.toString(), { method: "POST" }, timeoutMs);
  const token = String(result.data?.access_token || "").trim();
  const expiresIn = Math.max(600, Number(result.data?.expires_in || 3600));
  if (!result.ok || !token) {
    return {
      ok: false,
      status: result.status || 502,
      error: result.error || "Twitch access token request failed.",
      igdb: getIgdbPublicStatus(env)
    };
  }
  igdbAccessTokenCache = { token, expiresAt: Date.now() + Math.max(60, expiresIn - 120) * 1000 };
  return { ok: true, token, cached: false, igdb: getIgdbPublicStatus(env) };
}

async function fetchIgdbGameCoverBySteamAppId(env, steamAppId = "", token = "", timeoutMs = 9000) {
  const cleanSteamAppId = String(steamAppId || "").trim();
  if (!cleanSteamAppId || !token) return null;
  const config = getIgdbClientConfig(env);
  const body = [
    "fields game.name, game.slug, game.cover.image_id, game.first_release_date, game.total_rating, game.rating, uid, external_game_source;",
    `where uid = "${escapeIgdbSearchString(cleanSteamAppId)}" & external_game_source = 1;`,
    "limit 5;"
  ].join("\n");

  const result = await fetchJsonWithTimeout(new URL("external_games", IGDB_ORIGIN).toString(), {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "text/plain",
      "Client-ID": config.clientId,
      "Authorization": `Bearer ${token}`
    },
    body
  }, timeoutMs);

  const externalRows = Array.isArray(result.data) ? result.data : [];
  const games = externalRows.map(row => row?.game).filter(game => game?.cover?.image_id);
  const selected = games.sort((a, b) => Number(b.total_rating || b.rating || 0) - Number(a.total_rating || a.rating || 0))[0] || null;
  const coverUrl = buildIgdbCoverUrl(selected?.cover?.image_id || "");
  if (!result.ok || !selected || !coverUrl) return null;

  return {
    ok: true,
    status: result.status || 200,
    matchedName: selected.name || "",
    slug: selected.slug || "",
    imageId: selected.cover?.image_id || "",
    coverUrl,
    matchMethod: "steam_app_id"
  };
}

async function fetchIgdbGameCover(env, payload = {}, timeoutMs = 9000) {
  const title = String(payload.title || payload.name || "").trim();
  const steamAppId = String(payload.steamAppId || payload.appId || "").trim();
  if (!title && !steamAppId) return { ok: false, status: 400, error: "Missing game title or Steam App ID.", steamAppId, igdb: getIgdbPublicStatus(env) };

  const tokenResult = await fetchIgdbAccessToken(env, timeoutMs);
  if (!tokenResult.ok) return tokenResult;

  const steamMatch = steamAppId ? await fetchIgdbGameCoverBySteamAppId(env, steamAppId, tokenResult.token, timeoutMs) : null;
  if (steamMatch?.coverUrl) {
    return {
      ...steamMatch,
      title,
      steamAppId,
      source: "IGDB",
      provider: "Twitch/IGDB",
      igdb: getIgdbPublicStatus(env)
    };
  }

  if (!title) return { ok: false, status: 404, error: "IGDB cover was not found from Steam App ID.", steamAppId, igdb: getIgdbPublicStatus(env) };

  const config = getIgdbClientConfig(env);
  const allCandidates = [];
  let lastResult = null;
  for (const queryTitle of buildIgdbGameTitleQueries(title)) {
    const body = [
      `search "${escapeIgdbSearchString(queryTitle)}";`,
      "fields name, slug, cover.image_id, first_release_date, total_rating, rating;",
      "where cover != null;",
      "limit 20;"
    ].join("\n");

    const result = await fetchJsonWithTimeout(new URL("games", IGDB_ORIGIN).toString(), {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "text/plain",
        "Client-ID": config.clientId,
        "Authorization": `Bearer ${tokenResult.token}`
      },
      body
    }, timeoutMs);
    lastResult = result;
    const games = Array.isArray(result.data) ? result.data : [];
    allCandidates.push(...games);
    const selectedForQuery = selectBestIgdbCoverCandidate(games, queryTitle);
    const coverForQuery = buildIgdbCoverUrl(selectedForQuery?.cover?.image_id || "");
    if (result.ok && selectedForQuery && coverForQuery) {
      return {
        ok: true,
        status: result.status || 200,
        title,
        steamAppId,
        matchedName: selectedForQuery.name || "",
        slug: selectedForQuery.slug || "",
        imageId: selectedForQuery.cover?.image_id || "",
        coverUrl: coverForQuery,
        matchMethod: queryTitle === title ? "title_search" : "title_variant_search",
        source: "IGDB",
        provider: "Twitch/IGDB",
        igdb: getIgdbPublicStatus(env)
      };
    }
  }

  const selected = selectBestIgdbCoverCandidate(allCandidates, title);
  const coverUrl = buildIgdbCoverUrl(selected?.cover?.image_id || "");
  if (selected && coverUrl) {
    return {
      ok: true,
      status: lastResult?.status || 200,
      title,
      steamAppId,
      matchedName: selected.name || "",
      slug: selected.slug || "",
      imageId: selected.cover?.image_id || "",
      coverUrl,
      matchMethod: "merged_title_search",
      source: "IGDB",
      provider: "Twitch/IGDB",
      igdb: getIgdbPublicStatus(env)
    };
  }

  return {
    ok: false,
    status: lastResult?.status || 404,
    error: lastResult?.error || "IGDB cover was not found.",
    title,
    steamAppId,
    candidates: allCandidates.slice(0, 8).map(game => ({ name: game.name || "", slug: game.slug || "" })),
    igdb: getIgdbPublicStatus(env)
  };
}


async function fetchIgdbGameCoverCandidates(env, payload = {}, timeoutMs = 9000) {
  const title = String(payload.title || payload.name || "").trim();
  const steamAppId = String(payload.steamAppId || payload.appId || "").trim();
  if (!title && !steamAppId) return { ok: false, status: 400, error: "Missing game title or Steam App ID.", results: [], igdb: getIgdbPublicStatus(env) };

  const tokenResult = await fetchIgdbAccessToken(env, timeoutMs);
  if (!tokenResult.ok) return { ...tokenResult, results: [] };

  const config = getIgdbClientConfig(env);
  const rows = [];
  const seen = new Set();
  function pushGame(game = {}, matchMethod = "title_search") {
    const imageId = String(game?.cover?.image_id || "").trim();
    const coverUrl = buildIgdbCoverUrl(imageId);
    const id = String(game?.id || game?.game?.id || game?.slug || game?.name || coverUrl || "").trim();
    if (!coverUrl || seen.has(id + coverUrl)) return;
    seen.add(id + coverUrl);
    rows.push({
      id: game.id || null,
      name: game.name || "",
      matchedName: game.name || "",
      slug: game.slug || "",
      imageId,
      coverUrl,
      firstReleaseDate: game.first_release_date || null,
      rating: Number(game.total_rating || game.rating || 0) || 0,
      score: scoreIgdbCoverCandidate(game, title),
      matchMethod,
      source: "IGDB",
      provider: "Twitch/IGDB"
    });
  }

  if (steamAppId) {
    const body = [
      "fields game.id, game.name, game.slug, game.cover.image_id, game.first_release_date, game.total_rating, game.rating, uid, external_game_source;",
      `where uid = "${escapeIgdbSearchString(steamAppId)}" & external_game_source = 1;`,
      "limit 10;"
    ].join("\n");
    const steamResult = await fetchJsonWithTimeout(new URL("external_games", IGDB_ORIGIN).toString(), {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "text/plain",
        "Client-ID": config.clientId,
        "Authorization": `Bearer ${tokenResult.token}`
      },
      body
    }, timeoutMs);
    (Array.isArray(steamResult.data) ? steamResult.data : []).forEach(row => pushGame(row?.game, "steam_app_id"));
  }

  for (const queryTitle of buildIgdbGameTitleQueries(title)) {
    const body = [
      `search "${escapeIgdbSearchString(queryTitle)}";`,
      "fields id, name, slug, cover.image_id, first_release_date, total_rating, rating;",
      "where cover != null;",
      "limit 25;"
    ].join("\n");
    const result = await fetchJsonWithTimeout(new URL("games", IGDB_ORIGIN).toString(), {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "text/plain",
        "Client-ID": config.clientId,
        "Authorization": `Bearer ${tokenResult.token}`
      },
      body
    }, timeoutMs);
    (Array.isArray(result.data) ? result.data : []).forEach(game => pushGame(game, queryTitle === title ? "title_search" : "title_variant_search"));
  }

  const results = rows
    .sort((a, b) => (b.matchMethod === "steam_app_id" ? 25 : 0) - (a.matchMethod === "steam_app_id" ? 25 : 0) || b.score - a.score || b.rating - a.rating)
    .slice(0, 30);
  return {
    ok: !!results.length,
    status: results.length ? 200 : 404,
    title,
    steamAppId,
    results,
    error: results.length ? "" : "No IGDB/Twitch covers found.",
    igdb: getIgdbPublicStatus(env)
  };
}

async function runIgdbCoversEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  const title = url.searchParams.get("title") || url.searchParams.get("name") || "";
  const steamAppId = url.searchParams.get("steamAppId") || url.searchParams.get("appId") || "";
  if (!String(title || steamAppId || "").trim()) return jsonResponse({ ok: false, error: "Missing title or Steam App ID.", results: [] }, 400);
  const cacheKey = new Request(`${url.origin}/__screenlist_igdb_covers/v413-hd-picker/${encodeURIComponent(String(title).trim().toLowerCase())}/${encodeURIComponent(String(steamAppId).trim())}`, { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached && url.searchParams.get("force") !== "1") {
    const headers = new Headers(cached.headers);
    headers.set("x-screenlist-igdb-covers-cache", "HIT");
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }
  const result = await fetchIgdbGameCoverCandidates(env, { title, steamAppId });
  const response = jsonResponse(result, result.ok ? 200 : (result.status || 502), {
    "Cache-Control": result.ok ? "public, max-age=2592000" : "no-store",
    "x-screenlist-igdb-covers-cache": "MISS"
  });
  if (result.ok && ctx?.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

/* v928: IGDB game search — used as fallback when RAWG misses recent titles */
async function runIgdbSearchEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  const query = String(url.searchParams.get("q") || url.searchParams.get("query") || "").trim();
  const limit = Math.min(20, Math.max(1, Number(url.searchParams.get("limit") || 15)));
  if (!query) return jsonResponse({ ok: false, error: "Missing query." }, 400);

  /* v11.298: edge-cache IGDB search like RAWG/TMDB already are. The endpoint
     was previously uncached, so every keystroke in the Add-to-Shelf "Games"
     tab paid a full ~1s IGDB round-trip (incl. the Twitch token check). Caching
     by normalized query+limit makes repeated/prefix queries near-instant. */
  const cacheKey = new Request(`${url.origin}/__shelfd_igdb_search/v1/${encodeURIComponent(query.toLowerCase())}/${limit}`, { method: "GET" });
  if (url.searchParams.get("force") !== "1") {
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("x-shelfd-igdb-search-cache", "HIT");
      return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
    }
  }

  const tokenResult = await fetchIgdbAccessToken(env);
  if (!tokenResult.ok) return jsonResponse(tokenResult, tokenResult.status || 502);

  const config = getIgdbClientConfig(env);
  const escaped = escapeIgdbSearchString(query);
  /* v10.494: request `alternative_names.name` so the Universal Search
     bucket scorer can match queries like "GTA" against alias entries
     such as "GTA V", "GTA5", etc. that IGDB exposes per game. */
  const body = [
    "fields name, alternative_names.name, first_release_date, cover.image_id, genres.name, themes.name, platforms.name, summary, slug, total_rating, total_rating_count, rating, rating_count, aggregated_rating, aggregated_rating_count, hypes, follows;",
    `search "${escaped}";`,
    `limit ${limit};`
  ].join("\n");

  const result = await fetchJsonWithTimeout(new URL("games", IGDB_ORIGIN).toString(), {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "text/plain",
      "Client-ID": config.clientId,
      "Authorization": `Bearer ${tokenResult.token}`
    },
    body
  }, 9000);

  if (!result.ok) return jsonResponse({ ok: false, error: result.error || "IGDB search failed." }, 502);

  const games = (Array.isArray(result.data) ? result.data : []).map(g => ({
    id: g.id,
    name: g.name || "",
    slug: g.slug || "",
    released: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : "",
    cover: g.cover?.image_id ? buildIgdbCoverUrl(g.cover.image_id) : "",
    genres: (g.genres || []).map(x => x.name).filter(Boolean),
    themes: (g.themes || []).map(x => x.name).filter(Boolean),
    platforms: (g.platforms || []).map(x => x.name).filter(Boolean),
    /* v10.494: pass alternative_names through as a flat array of strings */
    alternative_names: (g.alternative_names || []).map(a => a?.name).filter(Boolean),
    summary: g.summary || "",
    total_rating: g.total_rating || 0,
    total_rating_count: g.total_rating_count || 0,
    rating: g.rating || 0,
    rating_count: g.rating_count || 0,
    aggregated_rating: g.aggregated_rating || 0,
    aggregated_rating_count: g.aggregated_rating_count || 0,
    hypes: g.hypes || 0,
    follows: g.follows || 0,
    source: "igdb"
  }));

  const response = jsonResponse({ ok: true, results: games }, 200, {
    "Cache-Control": "public, max-age=86400",
    "x-shelfd-igdb-search-cache": "MISS"
  });
  if (ctx?.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

/* v11.949: rich game "Info" fields for the game media profile. IGDB is the
   PRIMARY source (Twitch-authed); the client falls back to RAWG fields when a
   value is missing. Cross-play is intentionally NOT derived — IGDB/RAWG do not
   expose it, so it is left blank rather than faked. */
const IGDB_ESRB_RATING_LABELS = { 6: "Rating Pending", 7: "Early Childhood", 8: "Everyone", 9: "Everyone 10+", 10: "Teen", 11: "Mature 17+", 12: "Adults Only 18+" };
const IGDB_PEGI_RATING_LABELS = { 1: "PEGI 3", 2: "PEGI 7", 3: "PEGI 12", 4: "PEGI 16", 5: "PEGI 18" };

function selectBestIgdbInfoCandidate(games = [], requestedTitle = "", year = "") {
  const wantYear = Number(String(year || "").slice(0, 4)) || 0;
  const ranked = (Array.isArray(games) ? games : [])
    .map(game => {
      let score = scoreIgdbCoverCandidate(game, requestedTitle);
      if (wantYear && game.first_release_date) {
        const gy = new Date(game.first_release_date * 1000).getUTCFullYear();
        if (gy === wantYear) score += 12;
        else if (Math.abs(gy - wantYear) === 1) score += 4;
      }
      score += Math.min(8, Number(game.total_rating_count || 0) / 50);
      return { game, score };
    })
    .filter(row => row.score >= 40)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.game || null;
}

function normalizeIgdbGameInfo(game) {
  if (!game) return null;
  const companies = Array.isArray(game.involved_companies) ? game.involved_companies : [];
  const developers = [...new Set(companies.filter(c => c.developer).map(c => c.company?.name).filter(Boolean))];
  const publishers = [...new Set(companies.filter(c => c.publisher).map(c => c.company?.name).filter(Boolean))];
  const genres = (game.genres || []).map(g => g.name).filter(Boolean);
  const gameModes = (game.game_modes || []).map(m => m.name).filter(Boolean);
  const platforms = (game.platforms || []).map(p => ({
    name: p.name || "",
    abbr: p.abbreviation || "",
    logo: p.platform_logo?.image_id ? buildIgdbLogoUrl(p.platform_logo.image_id) : ""
  })).filter(p => p.name);
  const franchise = (Array.isArray(game.franchises) && game.franchises[0]?.name) || game.collection?.name || "";
  let ageRating = "";
  const ratings = Array.isArray(game.age_ratings) ? game.age_ratings : [];
  const esrb = ratings.find(r => r.category === 1 && IGDB_ESRB_RATING_LABELS[r.rating]);
  const pegi = ratings.find(r => r.category === 2 && IGDB_PEGI_RATING_LABELS[r.rating]);
  if (esrb) ageRating = IGDB_ESRB_RATING_LABELS[esrb.rating];
  else if (pegi) ageRating = IGDB_PEGI_RATING_LABELS[pegi.rating];
  const mm = Array.isArray(game.multiplayer_modes) ? game.multiplayer_modes : [];
  const modeNames = gameModes.map(m => String(m).toLowerCase());
  const online = modeNames.some(m => /multiplayer|mmo|battle royale|online/.test(m)) || mm.some(m => m.onlinecoop || Number(m.onlinemax || 0) > 1);
  const offline = modeNames.some(m => /single player|split screen/.test(m)) || mm.some(m => m.offlinecoop || m.splitscreen || m.campaigncoop || Number(m.offlinemax || 0) > 1);
  let onlineOffline = "";
  if (online && offline) onlineOffline = "Online, Offline";
  else if (online) onlineOffline = "Online";
  else if (offline) onlineOffline = "Offline";
  // v11.952: release date. Prefer first_release_date; for unreleased/TBA games
  // (no first_release_date) fall back to the release_dates array — the earliest
  // exact date, else the human label IGDB provides ("Q4 2025", "2025", "TBD").
  let releaseDate = "";
  if (game.first_release_date) {
    releaseDate = new Date(game.first_release_date * 1000).toISOString().slice(0, 10);
  } else if (Array.isArray(game.release_dates) && game.release_dates.length) {
    const dated = game.release_dates.filter(r => r && r.date).sort((a, b) => a.date - b.date);
    if (dated.length) {
      releaseDate = new Date(dated[0].date * 1000).toISOString().slice(0, 10);
    } else {
      const human = game.release_dates.map(r => String((r && r.human) || "").trim()).filter(Boolean);
      releaseDate = human[0] || "";
    }
  }
  return {
    releaseDate,
    developers, publishers, genres, gameModes, platforms,
    franchise, ageRating, onlineOffline,
    crossplay: ""
  };
}

async function runIgdbGameInfoEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  const title = String(url.searchParams.get("title") || url.searchParams.get("name") || "").trim();
  const year = String(url.searchParams.get("year") || "").trim();
  if (!title) return jsonResponse({ ok: false, error: "Missing title." }, 400);

  const cacheKey = new Request(`${url.origin}/__shelfd_igdb_game_info/v2-platform-logos/${encodeURIComponent(title.toLowerCase())}/${encodeURIComponent(year)}`, { method: "GET" });
  if (url.searchParams.get("force") !== "1") {
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("x-shelfd-igdb-info-cache", "HIT");
      return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
    }
  }

  const tokenResult = await fetchIgdbAccessToken(env);
  if (!tokenResult.ok) return jsonResponse(tokenResult, tokenResult.status || 502);
  const config = getIgdbClientConfig(env);
  const escaped = escapeIgdbSearchString(title);
  const body = [
    "fields name, slug, first_release_date, release_dates.human, release_dates.date, total_rating_count, involved_companies.company.name, involved_companies.developer, involved_companies.publisher, genres.name, game_modes.name, age_ratings.category, age_ratings.rating, franchises.name, collection.name, platforms.name, platforms.abbreviation, platforms.platform_logo.image_id, multiplayer_modes.onlinecoop, multiplayer_modes.offlinecoop, multiplayer_modes.splitscreen, multiplayer_modes.campaigncoop, multiplayer_modes.onlinemax, multiplayer_modes.offlinemax, similar_games.name, similar_games.cover.image_id, similar_games.first_release_date, similar_games.total_rating, similar_games.genres.name;",
    `search "${escaped}";`,
    "limit 15;"
  ].join("\n");

  const result = await fetchJsonWithTimeout(new URL("games", IGDB_ORIGIN).toString(), {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "text/plain",
      "Client-ID": config.clientId,
      "Authorization": `Bearer ${tokenResult.token}`
    },
    body
  }, 9000);

  if (!result.ok) return jsonResponse({ ok: false, error: result.error || "IGDB game info failed." }, 502);

  const best = selectBestIgdbInfoCandidate(result.data, title, year);
  const info = normalizeIgdbGameInfo(best);
  const similarGames = (Array.isArray(best?.similar_games) ? best.similar_games : [])
    .map(g => ({
      id: g.id,
      title: g.name || "",
      year: g.first_release_date ? String(new Date(g.first_release_date * 1000).getUTCFullYear()) : "",
      image: g.cover?.image_id ? buildIgdbCoverUrl(g.cover.image_id) : "",
      rating: Number(g.total_rating || 0),
      genres: (g.genres || []).map(x => x.name).filter(Boolean)
    }))
    .filter(g => g.title)
    .slice(0, 12);
  const response = jsonResponse({ ok: true, matched: !!best, igdbId: best?.id || null, igdbName: best?.name || "", info, similarGames }, 200, {
    "Cache-Control": "public, max-age=86400",
    "x-shelfd-igdb-info-cache": "MISS"
  });
  if (ctx?.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

function parseIgdbNumberList(value = "") {
  return String(value || "")
    .split(",")
    .map(part => Number(String(part || "").trim()))
    .filter(value => Number.isFinite(value) && value > 0);
}

function appendIgdbWhereClause(parts = [], clause = "") {
  const clean = String(clause || "").trim();
  if (clean) parts.push(clean);
}

async function runIgdbDiscoverGamesEndpoint(request, env) {
  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 60)));
  const preset = String(url.searchParams.get("preset") || "popular").trim().toLowerCase();
  const genreIds = parseIgdbNumberList(url.searchParams.get("genreIds"));
  const themeIds = parseIgdbNumberList(url.searchParams.get("themeIds"));
  const platformIds = parseIgdbNumberList(url.searchParams.get("platformIds"));
  const fromDate = String(url.searchParams.get("from") || "").trim();
  const toDate = String(url.searchParams.get("to") || "").trim();

  const tokenResult = await fetchIgdbAccessToken(env);
  if (!tokenResult.ok) return jsonResponse(tokenResult, tokenResult.status || 502);

  const whereParts = [];
  appendIgdbWhereClause(whereParts, "name != null");
  if (genreIds.length) appendIgdbWhereClause(whereParts, `genres = (${genreIds.join(",")})`);
  if (themeIds.length) appendIgdbWhereClause(whereParts, `themes = (${themeIds.join(",")})`);
  if (platformIds.length) appendIgdbWhereClause(whereParts, `platforms = (${platformIds.join(",")})`);
  if (fromDate && /^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
    const fromEpoch = Math.floor(Date.parse(`${fromDate}T00:00:00Z`) / 1000);
    if (Number.isFinite(fromEpoch)) appendIgdbWhereClause(whereParts, `first_release_date >= ${fromEpoch}`);
  }
  if (toDate && /^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    const toEpoch = Math.floor(Date.parse(`${toDate}T23:59:59Z`) / 1000);
    if (Number.isFinite(toEpoch)) appendIgdbWhereClause(whereParts, `first_release_date <= ${toEpoch}`);
  }
  if (preset === "upcoming" || preset === "anticipated") {
    appendIgdbWhereClause(whereParts, `first_release_date > ${Math.floor(Date.now() / 1000)}`);
  }

  const sort = (preset === "upcoming" || preset === "anticipated")
    ? "sort hypes desc;"
    : preset === "rated"
      ? "sort total_rating desc;"
      : "sort total_rating_count desc;";

  const config = getIgdbClientConfig(env);
  const body = [
    "fields name, slug, first_release_date, cover.image_id, genres.name, themes.name, platforms.name, summary, total_rating, total_rating_count, rating, rating_count, aggregated_rating, aggregated_rating_count, hypes, follows;",
    whereParts.length ? `where ${whereParts.join(" & ")};` : "",
    sort,
    `limit ${limit};`
  ].filter(Boolean).join("\n");

  const result = await fetchJsonWithTimeout(new URL("games", IGDB_ORIGIN).toString(), {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "text/plain",
      "Client-ID": config.clientId,
      "Authorization": `Bearer ${tokenResult.token}`
    },
    body
  }, 9000);

  if (!result.ok) return jsonResponse({ ok: false, error: result.error || "IGDB discover failed." }, 502);

  const games = (Array.isArray(result.data) ? result.data : []).map(g => ({
    id: `igdb:${g.id}`,
    sourceId: String(g.id || ""),
    igdbId: String(g.id || ""),
    name: g.name || "",
    slug: g.slug || "",
    igdbSlug: g.slug || "",
    released: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : "",
    background_image: g.cover?.image_id ? buildIgdbCoverUrl(g.cover.image_id) : "",
    cover: g.cover?.image_id ? buildIgdbCoverUrl(g.cover.image_id) : "",
    igdbCover: g.cover?.image_id ? buildIgdbCoverUrl(g.cover.image_id) : "",
    genres: (g.genres || []).map(x => ({ name: x.name })).filter(x => x.name),
    themes: (g.themes || []).map(x => ({ name: x.name })).filter(x => x.name),
    platforms: (g.platforms || []).map(x => ({ platform: { name: x.name } })).filter(x => x.platform.name),
    summary: g.summary || "",
    overview: g.summary || "",
    total_rating: g.total_rating || 0,
    total_rating_count: g.total_rating_count || 0,
    rating: g.rating ? Number(g.rating) / 20 : (g.total_rating ? Number(g.total_rating) / 20 : 0),
    rating_count: g.rating_count || 0,
    aggregated_rating: g.aggregated_rating || 0,
    aggregated_rating_count: g.aggregated_rating_count || 0,
    hypes: g.hypes || 0,
    follows: g.follows || 0,
    source: "igdb",
    kind: "game"
  }));

  return jsonResponse({ ok: true, results: games });
}

async function runIgdbCoverEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  const title = url.searchParams.get("title") || url.searchParams.get("name") || "";
  const steamAppId = url.searchParams.get("steamAppId") || url.searchParams.get("appId") || "";
  if (!String(title || "").trim()) return jsonResponse({ ok: false, error: "Missing title." }, 400);

  const cacheKey = new Request(`${url.origin}/__screenlist_igdb_cover/v413-hd-fallback-safe-cover/${encodeURIComponent(String(title).trim().toLowerCase())}/${encodeURIComponent(String(steamAppId).trim())}`, { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("x-screenlist-igdb-cache", "HIT");
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }

  const result = await fetchIgdbGameCover(env, { title, steamAppId });
  const response = jsonResponse(result, result.ok ? 200 : (result.status || 502), {
    "Cache-Control": result.ok ? "public, max-age=2592000" : "no-store",
    "x-screenlist-igdb-cache": "MISS"
  });
  if (result.ok && ctx?.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

function normalizeGameWebCoverQuery(title = "") {
  const cleanTitle = String(title || "").trim();
  return cleanTitle ? `${cleanTitle} official cover` : "";
}

function normalizeGameWebCoverProvider(hostname = "") {
  const cleanHost = String(hostname || "").trim().toLowerCase().replace(/^www\./, "");
  if (!cleanHost) return "Web";
  return cleanHost
    .split(".")
    .filter(Boolean)
    .slice(-2)
    .join(".");
}

function normalizeTavilyImageCandidate(item = {}, fallbackSource = {}) {
  if (typeof item === "string") {
    const coverUrl = String(item).trim();
    return coverUrl ? { coverUrl, title: fallbackSource.title || "", sourceUrl: fallbackSource.url || "", provider: fallbackSource.provider || "" } : null;
  }
  const coverUrl = String(item?.url || item?.image_url || item?.imageUrl || item?.src || item?.content_url || item?.contentUrl || item?.thumbnail_url || item?.thumbnailUrl || "").trim();
  if (!coverUrl) return null;
  return {
    coverUrl,
    title: String(item?.title || item?.description || item?.alt || fallbackSource.title || "").trim(),
    sourceUrl: String(item?.source_url || item?.sourceUrl || item?.source || fallbackSource.url || "").trim(),
    provider: String(item?.provider || fallbackSource.provider || "").trim()
  };
}

async function fetchTavilyGameWebCoverCandidates(env, payload = {}, timeoutMs = 9000) {
  const config = getTavilyClientConfig(env);
  if (!config.value) {
    return { ok: false, status: 500, error: getTavilyConfigError(env), results: [], tavily: getTavilyPublicStatus(env), query: "" };
  }

  const title = String(payload.title || payload.name || "").trim();
  const limit = Math.max(1, Math.min(12, Number(payload.limit || 6) || 6));
  const query = normalizeGameWebCoverQuery(title);
  if (!query) {
    return { ok: false, status: 400, error: "Missing game title for web cover search.", results: [], tavily: getTavilyPublicStatus(env), query: "" };
  }

  const body = JSON.stringify({
    query,
    topic: "general",
    search_depth: "basic",
    max_results: limit,
    include_images: true,
    include_image_descriptions: false
  });

  const result = await fetchJsonWithTimeout(new URL("search", TAVILY_ORIGIN).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.value}`
    },
    body
  }, timeoutMs);
  const data = result.data && typeof result.data === "object" ? result.data : {};

  if (!result.ok) {
    return {
      ok: false,
      status: result.status || 502,
      error: result.error || data?.error || "Tavily web cover search failed.",
      title,
      query,
      results: [],
      tavily: getTavilyPublicStatus(env)
    };
  }

  const rawResults = Array.isArray(data.results) ? data.results : [];
  const rawImages = Array.isArray(data.images) ? data.images : [];
  const seen = new Set();
  const rows = [];

  function pushCandidate(candidate = {}, source = {}) {
    const normalized = normalizeTavilyImageCandidate(candidate, source);
    const coverUrl = String(normalized?.coverUrl || "").trim();
    if (!/^https?:\/\//i.test(coverUrl)) return;
    if (seen.has(coverUrl)) return;
    seen.add(coverUrl);
    const sourceUrl = String(normalized?.sourceUrl || source.url || "").trim();
    const sourceHost = sourceUrl ? (() => {
      try { return new URL(sourceUrl).hostname || ""; } catch (error) { return ""; }
    })() : "";
    rows.push({
      id: coverUrl,
      name: String(normalized?.title || source.title || title || "Web cover").trim(),
      matchedName: title,
      coverUrl,
      previewUrl: coverUrl,
      sourceUrl,
      source: "Web",
      provider: String(normalized?.provider || normalizeGameWebCoverProvider(sourceHost)).trim() || "Web",
      matchMethod: "tavily_image_search"
    });
  }

  rawImages.forEach(image => pushCandidate(image, {}));
  rawResults.forEach(entry => {
    let provider = "";
    if (entry?.url) {
      try {
        provider = normalizeGameWebCoverProvider(new URL(entry.url).hostname || "");
      } catch (error) {
        provider = "";
      }
    }
    const source = {
      url: String(entry?.url || "").trim(),
      title: String(entry?.title || "").trim(),
      provider
    };
    const entryImages = Array.isArray(entry?.images) ? entry.images : [];
    entryImages.forEach(image => pushCandidate(image, source));
  });

  const results = rows.slice(0, limit);
  return {
    ok: !!results.length,
    status: results.length ? 200 : 404,
    error: results.length ? "" : "No web cover results found.",
    title,
    query,
    results,
    tavily: getTavilyPublicStatus(env)
  };
}

// v465: Tavily image search endpoint dedicated to the Profile → Top 3
// Fictional Characters editor. Returns up to 9 web image candidates that the
// user can tap to set as their character poster. The Tavily API key is read
// from a Cloudflare Worker secret (same secret as game web covers); it never
// leaves the server.
async function fetchTavilyCharacterImageCandidates(env, payload = {}, timeoutMs = 9000) {
  const config = getTavilyClientConfig(env);
  if (!config.value) {
    return { ok: false, status: 500, error: getTavilyConfigError(env), results: [], tavily: getTavilyPublicStatus(env), query: "" };
  }
  const rawQuery = String(payload.query || payload.q || payload.title || "").trim();
  const limit = Math.max(1, Math.min(12, Number(payload.limit || 9) || 9));
  if (!rawQuery) {
    return { ok: false, status: 400, error: "Missing search query.", results: [], tavily: getTavilyPublicStatus(env), query: "" };
  }
  // Append context terms to bias Tavily toward portrait/poster-style imagery
  // unless the caller already provided strong qualifiers.
  const looksQualified = /\b(poster|portrait|character|art|wallpaper|fanart|render)\b/i.test(rawQuery);
  const query = looksQualified ? rawQuery : `${rawQuery} fictional character portrait poster`;

  const body = JSON.stringify({
    query,
    topic: "general",
    search_depth: "basic",
    max_results: limit,
    include_images: true,
    include_image_descriptions: false
  });

  const result = await fetchJsonWithTimeout(new URL("search", TAVILY_ORIGIN).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.value}`
    },
    body
  }, timeoutMs);
  const data = result.data && typeof result.data === "object" ? result.data : {};

  if (!result.ok) {
    return {
      ok: false,
      status: result.status || 502,
      error: result.error || data?.error || "Tavily image search failed.",
      query,
      results: [],
      tavily: getTavilyPublicStatus(env)
    };
  }

  const rawResults = Array.isArray(data.results) ? data.results : [];
  const rawImages = Array.isArray(data.images) ? data.images : [];
  const seen = new Set();
  const rows = [];

  function pushCandidate(candidate = {}, source = {}) {
    const normalized = normalizeTavilyImageCandidate(candidate, source);
    const imageUrl = String(normalized?.coverUrl || "").trim();
    if (!/^https?:\/\//i.test(imageUrl)) return;
    if (seen.has(imageUrl)) return;
    seen.add(imageUrl);
    rows.push({
      id: imageUrl,
      imageUrl,
      previewUrl: imageUrl,
      title: String(normalized?.title || source.title || rawQuery || "").trim(),
      sourceUrl: String(normalized?.sourceUrl || source.url || "").trim()
    });
  }

  rawImages.forEach(image => pushCandidate(image, {}));
  rawResults.forEach(entry => {
    const source = {
      url: String(entry?.url || "").trim(),
      title: String(entry?.title || "").trim()
    };
    const entryImages = Array.isArray(entry?.images) ? entry.images : [];
    entryImages.forEach(image => pushCandidate(image, source));
  });

  const results = rows.slice(0, limit);
  return {
    ok: !!results.length,
    status: results.length ? 200 : 404,
    error: results.length ? "" : "No image results found.",
    query,
    results,
    tavily: getTavilyPublicStatus(env)
  };
}

async function runTavilyCharacterImageSearchEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  let payload = {};
  if (request.method === "POST") {
    try { payload = await request.json(); } catch (e) { payload = {}; }
  } else {
    payload = {
      query: url.searchParams.get("q") || url.searchParams.get("query") || "",
      limit: url.searchParams.get("limit") || ""
    };
  }
  const query = String(payload.query || "").trim();
  const limit = Math.max(1, Math.min(12, Number(payload.limit || 9) || 9));
  if (!query) return jsonResponse({ ok: false, error: "Missing search query.", results: [] }, 400);

  const cacheKey = new Request(
    `${url.origin}/__screenlist_character_image_search/v465/${encodeURIComponent(query.toLowerCase())}/${limit}`,
    { method: "GET" }
  );
  const cached = await caches.default.match(cacheKey);
  if (cached && url.searchParams.get("force") !== "1") {
    const headers = new Headers(cached.headers);
    headers.set("x-screenlist-character-image-cache", "HIT");
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }

  const result = await fetchTavilyCharacterImageCandidates(env, { query, limit });
  const response = jsonResponse(result, result.ok ? 200 : (result.status || 502), {
    "Cache-Control": result.ok ? "public, max-age=3600" : "no-store",
    "x-screenlist-character-image-cache": "MISS"
  });
  if (result.ok && ctx?.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

async function runGameWebCoversEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  const title = url.searchParams.get("title") || url.searchParams.get("name") || "";
  const limit = Math.max(1, Math.min(12, Number(url.searchParams.get("limit") || 6) || 6));
  if (!String(title || "").trim()) return jsonResponse({ ok: false, error: "Missing title.", results: [] }, 400);

  const cacheKey = new Request(`${url.origin}/__screenlist_game_web_covers/v414/${encodeURIComponent(String(title).trim().toLowerCase())}/${limit}`, { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached && url.searchParams.get("force") !== "1") {
    const headers = new Headers(cached.headers);
    headers.set("x-screenlist-web-covers-cache", "HIT");
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }

  const result = await fetchTavilyGameWebCoverCandidates(env, { title, limit });
  const response = jsonResponse(result, result.ok ? 200 : (result.status || 502), {
    "Cache-Control": result.ok ? "public, max-age=86400" : "no-store",
    "x-screenlist-web-covers-cache": "MISS"
  });
  if (result.ok && ctx?.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

function getRatingResolveSources(env) {
  return {
    tmdb: { configured: !!env.TMDB_KEY },
    imdb: getOmdbPublicStatus(env),
    ai: { configured: !!env.myscreenlistAi },
    tavily: getTavilyPublicStatus(env)
  };
}

function normalizeImdbTitleId(value = "") {
  const match = String(value || "").trim().match(/tt\d{7,10}/i);
  return match ? match[0].toLowerCase() : "";
}

function normalizeImdbMediaType(value = "") {
  return String(value || "").trim().toLowerCase() === "movie" ? "movie" : "tv";
}

function normalizeOmdbRating(value) {
  const rating = Number(String(value || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(rating) && rating > 0 ? Math.min(10, rating) : 0;
}

async function fetchTmdbExternalImdbId(env, type = "tv", tmdbId = "", timeoutMs = 6500) {
  const cleanTmdbId = String(tmdbId || "").trim();
  if (!cleanTmdbId) return "";
  const mediaType = normalizeImdbMediaType(type);
  const path = `${mediaType}/${encodeURIComponent(cleanTmdbId)}/external_ids`;
  const external = await fetchTmdbJson(env, path, { language: "en-US" }, timeoutMs);
  return normalizeImdbTitleId(external?.data?.imdb_id || "");
}

async function fetchOmdbImdbRating(env, imdbId = "", timeoutMs = 6500) {
  const config = getOmdbClientConfig(env);
  const cleanImdbId = normalizeImdbTitleId(imdbId);
  if (!config.value) {
    return { ok: false, status: 500, error: getOmdbConfigError(env), omdb: getOmdbPublicStatus(env) };
  }
  if (!cleanImdbId) {
    return { ok: false, status: 400, error: "Missing IMDb title id.", omdb: getOmdbPublicStatus(env) };
  }

  const url = new URL(OMDB_ORIGIN);
  url.searchParams.set("i", cleanImdbId);
  url.searchParams.set("apikey", config.value);
  url.searchParams.set("plot", "short");
  url.searchParams.set("r", "json");

  const result = await fetchJsonWithTimeout(url, {}, timeoutMs);
  const data = result.data && typeof result.data === "object" ? result.data : {};
  const rating = normalizeOmdbRating(data.imdbRating);

  if (!result.ok || data.Response === "False" || !rating) {
    return {
      ok: false,
      status: result.status || 502,
      error: data.Error || result.error || "IMDb rating was not found.",
      imdbId: cleanImdbId,
      omdb: getOmdbPublicStatus(env)
    };
  }

  return {
    ok: true,
    status: result.status,
    imdbId: cleanImdbId,
    imdbRating: rating,
    imdbVotes: data.imdbVotes || "",
    title: data.Title || "",
    year: data.Year || "",
    /* v734: extra OMDb fields used by the filmography page card layout. */
    runtime: data.Runtime || "",
    rated: data.Rated || "",
    metascore: data.Metascore || "",
    genre: data.Genre || "",
    plot: data.Plot || "",
    source: "IMDb",
    provider: "OMDb",
    lookup: "imdb_id",
    omdb: getOmdbPublicStatus(env)
  };
}


/* v10.234: Strict OMDb title/year match validation. OMDb's `t=` parameter does
   a FUZZY best-match, so a common title like "Obsession" can resolve to a
   different film/series than the one the user is viewing — silently caching the
   wrong IMDb rating (the "8.2 shows as 3.8" root cause). We only accept a
   title/year fallback whose normalized title matches the requested title and
   whose year is within tolerance. An exact IMDb-ID lookup is always preferred
   and never passes through this gate. */
function normalizeTitleForOmdbMatch(value = "") {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")   /* strip diacritics */
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")       /* punctuation → space */
    .replace(/\b(?:the|a|an)\b/g, " ") /* drop leading articles anywhere */
    .replace(/\s+/g, " ")
    .trim();
}

function omdbYearMatches(requestedYear = "", returnedYear = "") {
  const reqY = parseInt(String(requestedYear || "").slice(0, 4), 10);
  if (!Number.isFinite(reqY) || reqY < 1900) return true; /* no usable requested year → don't gate on year */
  const years = String(returnedYear || "").match(/\d{4}/g);
  if (!years || !years.length) return true; /* OMDb returned no parseable year → rely on the title gate */
  const start = parseInt(years[0], 10);
  const end = years.length > 1 ? parseInt(years[1], 10) : start;
  if (Number.isFinite(start) && Number.isFinite(end) && reqY >= start - 2 && reqY <= end + 2) return true;
  return Number.isFinite(start) && Math.abs(start - reqY) <= 2;
}

function omdbTitleResultMatches(requestedTitle = "", returnedTitle = "", requestedYear = "", returnedYear = "") {
  const a = normalizeTitleForOmdbMatch(requestedTitle);
  const b = normalizeTitleForOmdbMatch(returnedTitle);
  if (!a || !b) return false;
  /* exact, or one is a whole-word prefix of the other (handles subtitle drift
     like "Dune" vs "Dune Part Two" being kept separate but "Office" vs
     "The Office" matching after article-stripping). */
  const titleOk = a === b || b.startsWith(a + " ") || a.startsWith(b + " ");
  if (!titleOk) return false;
  return omdbYearMatches(requestedYear, returnedYear);
}

async function fetchOmdbTitleRating(env, title = "", type = "tv", year = "", timeoutMs = 6500) {
  const config = getOmdbClientConfig(env);
  const cleanTitle = String(title || "").trim();
  const cleanType = normalizeImdbMediaType(type) === "movie" ? "movie" : "series";
  const cleanYear = String(year || "").trim().match(/^(18|19|20)\d{2}$/)?.[0] || "";

  if (!config.value) {
    return { ok: false, status: 500, error: getOmdbConfigError(env), omdb: getOmdbPublicStatus(env) };
  }
  if (!cleanTitle) {
    return { ok: false, status: 400, error: "Missing title for IMDb rating lookup.", omdb: getOmdbPublicStatus(env) };
  }

  const url = new URL(OMDB_ORIGIN);
  url.searchParams.set("t", cleanTitle);
  url.searchParams.set("type", cleanType);
  if (cleanYear) url.searchParams.set("y", cleanYear);
  url.searchParams.set("apikey", config.value);
  url.searchParams.set("plot", "short");
  url.searchParams.set("r", "json");

  const result = await fetchJsonWithTimeout(url, {}, timeoutMs);
  const data = result.data && typeof result.data === "object" ? result.data : {};
  const rating = normalizeOmdbRating(data.imdbRating);

  if (!result.ok || data.Response === "False" || !rating) {
    return {
      ok: false,
      status: result.status || 502,
      error: data.Error || result.error || "IMDb title rating was not found.",
      title: cleanTitle,
      year: cleanYear,
      omdb: getOmdbPublicStatus(env)
    };
  }

  /* v10.234: validate the fuzzy `t=` match before trusting it. If OMDb returned
     a different title/year than requested, reject it (ok:false) so the wrong
     rating is NEVER cached or shown. The resolver then keeps last-good cache or
     falls through cleanly rather than poisoning the entry. */
  if (!omdbTitleResultMatches(cleanTitle, data.Title || "", cleanYear, data.Year || "")) {
    return {
      ok: false,
      status: result.status || 200,
      error: `OMDb title fallback rejected: returned "${data.Title || ""}" (${data.Year || "?"}) ≠ requested "${cleanTitle}" (${cleanYear || "?"}).`,
      title: cleanTitle,
      year: cleanYear,
      rejectedTitle: data.Title || "",
      rejectedYear: data.Year || "",
      rejectedImdbId: normalizeImdbTitleId(data.imdbID || ""),
      validation: "title_year_mismatch",
      omdb: getOmdbPublicStatus(env)
    };
  }

  return {
    ok: true,
    status: result.status,
    imdbId: normalizeImdbTitleId(data.imdbID || ""),
    imdbRating: rating,
    imdbVotes: data.imdbVotes || "",
    title: data.Title || cleanTitle,
    year: data.Year || cleanYear,
    runtime: data.Runtime || "",
    rated: data.Rated || "",
    metascore: data.Metascore || "",
    genre: data.Genre || "",
    plot: data.Plot || "",
    source: "IMDb",
    provider: "OMDb",
    lookup: "title",
    omdb: getOmdbPublicStatus(env)
  };
}

async function fetchOmdbTitleImdbId(env, title = "", type = "tv", year = "", timeoutMs = 6500) {
  const config = getOmdbClientConfig(env);
  const cleanTitle = String(title || "").trim();
  const cleanType = normalizeImdbMediaType(type) === "movie" ? "movie" : "series";
  const cleanYear = String(year || "").trim().match(/^(18|19|20)\d{2}$/)?.[0] || "";

  if (!config.value) {
    return { ok: false, status: 500, error: getOmdbConfigError(env), omdb: getOmdbPublicStatus(env) };
  }
  if (!cleanTitle) {
    return { ok: false, status: 400, error: "Missing title for OMDb IMDb ID lookup.", omdb: getOmdbPublicStatus(env) };
  }

  const url = new URL(OMDB_ORIGIN);
  url.searchParams.set("t", cleanTitle);
  url.searchParams.set("type", cleanType);
  if (cleanYear) url.searchParams.set("y", cleanYear);
  url.searchParams.set("apikey", config.value);
  url.searchParams.set("plot", "short");
  url.searchParams.set("r", "json");

  const result = await fetchJsonWithTimeout(url, {}, timeoutMs);
  const data = result.data && typeof result.data === "object" ? result.data : {};
  const imdbId = normalizeImdbTitleId(data.imdbID || "");

  if (!result.ok || data.Response === "False" || !imdbId) {
    return {
      ok: false,
      status: result.status || 502,
      error: data.Error || result.error || "OMDb did not return an IMDb title ID.",
      title: cleanTitle,
      year: cleanYear,
      omdb: getOmdbPublicStatus(env)
    };
  }

  if (!omdbTitleResultMatches(cleanTitle, data.Title || "", cleanYear, data.Year || "")) {
    return {
      ok: false,
      status: result.status || 200,
      error: `OMDb title fallback rejected: returned "${data.Title || ""}" (${data.Year || "?"}) != requested "${cleanTitle}" (${cleanYear || "?"}).`,
      title: cleanTitle,
      year: cleanYear,
      rejectedTitle: data.Title || "",
      rejectedYear: data.Year || "",
      rejectedImdbId: imdbId,
      validation: "title_year_mismatch",
      omdb: getOmdbPublicStatus(env)
    };
  }

  return {
    ok: true,
    status: result.status,
    imdbId,
    title: data.Title || cleanTitle,
    year: data.Year || cleanYear,
    provider: "OMDb",
    lookup: "title_imdb_id",
    omdb: getOmdbPublicStatus(env)
  };
}

function normalizeAiRatingConfidence(value = "") {
  const clean = String(value || "").trim().toLowerCase();
  return ["high", "medium", "low"].includes(clean) ? clean : "low";
}

function parseAiRatingResult(body = {}, fallback = {}) {
  const source = body && typeof body === "object" ? body : {};
  const rawRating = source.rating ?? source.imdbRating ?? source.score ?? source.value ?? "";
  const rating = normalizeOmdbRating(rawRating);
  if (!rating) {
    return {
      ok: false,
      source: "ai_fallback",
      error: "AI did not return a usable 0-10 rating.",
      title: String(source.title || fallback.title || "").trim(),
      type: normalizeImdbMediaType(source.type || fallback.type || "tv"),
      year: String(source.year || fallback.year || "").trim(),
      confidence: normalizeAiRatingConfidence(source.confidence)
    };
  }
  return {
    ok: true,
    source: "ai_fallback",
    provider: "Cloudflare Workers AI",
    imdbRating: rating,
    aiRating: rating,
    rating,
    title: String(source.title || fallback.title || "").trim(),
    type: normalizeImdbMediaType(source.type || fallback.type || "tv"),
    year: String(source.year || fallback.year || "").trim(),
    confidence: normalizeAiRatingConfidence(source.confidence),
    note: String(source.note || source.reason || "AI fallback estimate; verify against IMDb/OMDb when available.").trim()
  };
}

async function fetchAiRatingFallback(env, payload = {}) {
  if (!env.myscreenlistAi || typeof env.myscreenlistAi.run !== "function") {
    return {
      ok: false,
      source: "ai_fallback",
      error: "Workers AI binding missing. Add binding name: myscreenlistAi."
    };
  }

  const title = String(payload.title || "").trim();
  const type = normalizeImdbMediaType(payload.type || "tv");
  const year = String(payload.year || "").trim().match(/^(18|19|20)\d{2}$/)?.[0] || "";
  if (!title) return { ok: false, source: "ai_fallback", error: "Missing title for AI rating fallback." };

  const systemPrompt = [
    "You are a fallback media-rating resolver for Shelfd.",
    "Return valid JSON only. No markdown.",
    "Estimate the current IMDb-style 0-10 rating for the requested movie or TV series.",
    "Prefer the series/movie rating, not an episode rating, season rating, critic rating, or article/list rating.",
    "If you are uncertain, still return your best estimate and set confidence to low.",
    "JSON shape: {\"ok\":true,\"title\":string,\"type\":\"movie\"|\"tv\",\"year\":string,\"rating\":number,\"confidence\":\"high\"|\"medium\"|\"low\",\"note\":string}."
  ].join(" ");
  const userPrompt = JSON.stringify({ title, type, year, requestedSource: "IMDb rating", fallbackMode: true });

  try {
    const aiResult = await runWorkersAi(env, SCREENLIST_AI_MODEL, systemPrompt, userPrompt, 0.15, 300);
    const text = cleanAiJsonText(extractAiText(aiResult));
    let parsed = {};
    try { parsed = JSON.parse(text); }
    catch (error) { parsed = { rating: text, note: "AI returned non-JSON text." }; }
    return parseAiRatingResult(parsed, { title, type, year });
  } catch (error) {
    return {
      ok: false,
      source: "ai_fallback",
      error: errorMessage(error),
      title,
      type,
      year,
      confidence: "low"
    };
  }
}

async function resolveScreenListRating(payload = {}, env, ctx, options = {}) {
  const type = normalizeImdbMediaType(payload.type || "tv");
  const tmdbId = String(payload.tmdbId || payload.id || "").trim();
  let imdbId = normalizeImdbTitleId(payload.imdbId || "");
  const title = String(payload.title || payload.name || "").trim();
  const year = String(payload.year || "").trim().match(/^(18|19|20)\d{2}$/)?.[0] || "";
  const attempts = [];

  let triedTavilySearchAi = false;
  if (options.preferAi && options.allowAi !== false && (title || imdbId)) {
    triedTavilySearchAi = true;
    const tavilyAi = await fetchTavilySearchAiRating(env, { title, type, year, imdbId });
    attempts.push({
      step: "tavily_search_ai_primary",
      ok: !!tavilyAi.ok,
      confidence: tavilyAi.confidence || "low",
      evidenceIndex: tavilyAi.evidenceIndex ?? null,
      sourceUrl: tavilyAi.sourceUrl || "",
      error: tavilyAi.error || ""
    });
    if (tavilyAi.ok) {
      return {
        ...tavilyAi,
        ok: true,
        type,
        tmdbId,
        imdbId,
        requestedTitle: title,
        requestedYear: year,
        ratingSource: tavilyAi.ratingSource || "tavily_search_ai",
        attempts,
        sources: getRatingResolveSources(env)
      };
    }
  }

  if (!imdbId && tmdbId) {
    try {
      imdbId = await fetchTmdbExternalImdbId(env, type, tmdbId, 6500);
      attempts.push({ step: "tmdb_external_ids", ok: !!imdbId, imdbId });
    } catch (error) {
      attempts.push({ step: "tmdb_external_ids", ok: false, error: errorMessage(error) });
    }
  }

  /* v10.235: live IMDb-page supplement for RECENT releases. OMDb's licensed
     snapshot lags live IMDb badly on fresh titles — e.g. "Obsession" (2026)
     read 7.6/694 votes from OMDb while imdb.com already showed 8.2/38K+. For
     titles released this year or last year, read the rating straight off the
     live IMDb title page via Tavily extract and prefer it over the stale OMDb
     snapshot. This is NOT an AI estimate — it is the literal number on
     imdb.com/title/<id>/ — so it is a legitimate IMDb rating for the public
     endpoint. Older titles skip this (their OMDb data is stable) to bound cost. */
  if (options.allowLiveImdbExtract && imdbId && isRecentImdbReleaseYear(year)) {
    const liveExtract = await fetchTavilyImdbTitleExtract(env, imdbId);
    attempts.push({
      step: "tavily_imdb_extract_recent",
      ok: !!(liveExtract.ok && Number.isFinite(liveExtract.rating)),
      rating: Number.isFinite(liveExtract.rating) ? liveExtract.rating : null,
      votes: liveExtract.votes ?? null,
      error: liveExtract.error || ""
    });
    if (liveExtract.ok && Number.isFinite(liveExtract.rating)) {
      return {
        ok: true,
        source: "tavily_imdb_extract",
        provider: "Tavily Extract (live IMDb title page)",
        imdbRating: liveExtract.rating,
        rating: liveExtract.rating,
        imdbVotes: liveExtract.votes ?? null,
        title,
        type,
        tmdbId,
        imdbId,
        year,
        requestedTitle: title,
        requestedYear: year,
        confidence: "high",
        sourceUrl: liveExtract.url,
        ratingSource: "tavily_imdb_extract",
        note: "Read live from the IMDb title page via Tavily extract (recent release; OMDb snapshot lags).",
        attempts,
        sources: getRatingResolveSources(env)
      };
    }
  }

  if (imdbId) {
    const imdb = await fetchOmdbImdbRating(env, imdbId, 6500);
    attempts.push({ step: "omdb_imdb_id", ok: !!imdb.ok, imdbId, error: imdb.error || "" });
    if (imdb.ok) {
      return {
        ...imdb,
        ok: true,
        type,
        tmdbId,
        requestedTitle: title,
        requestedYear: year,
        ratingSource: "omdb_imdb_id",
        attempts,
        sources: getRatingResolveSources(env)
      };
    }
  }

  if (title) {
    const titleLookup = await fetchOmdbTitleRating(env, title, type, year, 6500);
    attempts.push({ step: "omdb_title_year", ok: !!titleLookup.ok, error: titleLookup.error || "" });
    if (titleLookup.ok) {
      return {
        ...titleLookup,
        ok: true,
        type,
        tmdbId,
        requestedTitle: title,
        requestedYear: year,
        ratingSource: "omdb_title_year",
        attempts,
        sources: getRatingResolveSources(env)
      };
    }
  }

  if (options.allowAi !== false && title) {
    if (!triedTavilySearchAi) {
      const tavilyAi = await fetchTavilySearchAiRating(env, { title, type, year, imdbId });
      attempts.push({
        step: "tavily_search_ai_fallback",
        ok: !!tavilyAi.ok,
        confidence: tavilyAi.confidence || "low",
        evidenceIndex: tavilyAi.evidenceIndex ?? null,
        sourceUrl: tavilyAi.sourceUrl || "",
        error: tavilyAi.error || ""
      });
      if (tavilyAi.ok) {
        return {
          ...tavilyAi,
          ok: true,
          type,
          tmdbId,
          imdbId,
          requestedTitle: title,
          requestedYear: year,
          ratingSource: tavilyAi.ratingSource || "tavily_search_ai",
          attempts,
          sources: getRatingResolveSources(env)
        };
      }
    }

    const ai = await fetchAiRatingFallback(env, { title, type, year });
    attempts.push({ step: "ai_memory_fallback", ok: !!ai.ok, confidence: ai.confidence || "low", error: ai.error || "" });
    if (ai.ok) {
      return {
        ...ai,
        ok: true,
        type,
        tmdbId,
        imdbId,
        requestedTitle: title,
        requestedYear: year,
        ratingSource: "ai_memory_fallback",
        attempts,
        sources: getRatingResolveSources(env)
      };
    }
  }

  return {
    ok: false,
    type,
    tmdbId,
    imdbId,
    requestedTitle: title,
    requestedYear: year,
    error: options.allowAi === false
      ? "Rating could not be resolved through TMDB external IDs and OMDb."
      : "Rating could not be resolved through Tavily search AI, TMDB/OMDb, or AI memory fallback.",
    attempts,
    sources: getRatingResolveSources(env)
  };
}

async function readRatingResolvePayload(request) {
  const url = new URL(request.url);
  if (request.method === "POST") {
    try {
      const body = await request.json();
      if (body && typeof body === "object") return body;
    } catch (error) {}
  }
  return {
    type: url.searchParams.get("type"),
    tmdbId: url.searchParams.get("tmdbId") || url.searchParams.get("id"),
    imdbId: url.searchParams.get("imdbId"),
    title: url.searchParams.get("title") || url.searchParams.get("name"),
    year: url.searchParams.get("year"),
    preferAi: url.searchParams.get("preferAi") === "1" || url.searchParams.get("displaySource") === "ai_first"
  };
}

async function runRatingResolveEndpoint(request, env, ctx) {
  const payload = await readRatingResolvePayload(request);
  const type = normalizeImdbMediaType(payload.type || "tv");
  const tmdbId = String(payload.tmdbId || payload.id || "").trim();
  const imdbId = normalizeImdbTitleId(payload.imdbId || "");
  const title = String(payload.title || payload.name || "").trim();
  const year = String(payload.year || "").trim().match(/^(18|19|20)\d{2}$/)?.[0] || "";
  const preferAi = payload.preferAi === true || payload.preferAi === "1" || String(payload.displaySource || "").trim() === "ai_first";
  if (!tmdbId && !imdbId && !title) {
    return jsonResponse({ ok: false, error: "Missing tmdbId, imdbId, or title." }, 400);
  }

  const url = new URL(request.url);
  const cacheKey = new Request(`${url.origin}/__screenlist_rating_resolve/v5/${preferAi ? "ai-first" : "api-first"}/${type}/${tmdbId || "no-tmdb"}/${imdbId || "no-imdb"}/${encodeURIComponent(title || "no-title")}/${year || "no-year"}`, { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("x-screenlist-rating-cache", "HIT");
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }

  const result = await resolveScreenListRating({ type, tmdbId, imdbId, title, year }, env, ctx, { allowAi: true, preferAi });
  const status = result.ok ? 200 : 502;
  const ttl = String(result.ratingSource || "") === "tavily_search_ai" ? SCREENLIST_TAVILY_RATING_CACHE_TTL_SECONDS : SCREENLIST_IMDB_RATING_CACHE_TTL_SECONDS;
  const response = jsonResponse(result, status, {
    "Cache-Control": `public, max-age=${ttl}`,
    "x-screenlist-rating-cache": "MISS"
  });
  if (result.ok && ctx?.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

async function runAiRatingTestEndpoint(request, env, ctx) {
  const payload = await readRatingResolvePayload(request);
  const title = String(payload.title || payload.name || "").trim();
  const type = normalizeImdbMediaType(payload.type || "tv");
  const year = String(payload.year || "").trim().match(/^(18|19|20)\d{2}$/)?.[0] || "";
  if (!title) return jsonResponse({ ok: false, error: "Missing title." }, 400);
  const result = await fetchAiRatingFallback(env, { title, type, year });
  return jsonResponse({ ...result, testMode: true }, result.ok ? 200 : 502, {
    "Cache-Control": "no-store"
  });
}

function normalizeTavilyEvidenceText(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

function isTavilyImdbTitleEvidence(item = {}) {
  return /imdb\.com\/title\/tt\d+/i.test(String(item.url || ""));
}

function isTavilyEpisodeEvidence(item = {}) {
  const text = [item.title, item.url, item.content].map(value => String(value || "")).join(" ");
  return /\bTV Episode\b/i.test(text) || /episode\s+\d+/i.test(text);
}

function isTavilyRatingsPageEvidence(item = {}) {
  return /imdb\.com\/title\/tt\d+\/ratings\/?/i.test(String(item.url || ""));
}

function selectPreferredTavilyRatingEvidence(evidence = [], type = "tv") {
  const mediaType = normalizeImdbMediaType(type);
  const items = Array.isArray(evidence) ? evidence.filter(isTavilyImdbTitleEvidence) : [];
  const nonEpisode = items.filter(item => !isTavilyEpisodeEvidence(item));
  if (!nonEpisode.length) return null;

  if (mediaType === "tv") {
    return nonEpisode.find(item => isTavilyRatingsPageEvidence(item) && /\bTV Series\b/i.test(String(item.title || "")))
      || nonEpisode.find(item => /\bTV Series\b/i.test(String(item.title || "")))
      || nonEpisode.find(isTavilyRatingsPageEvidence)
      || nonEpisode[0]
      || null;
  }

  return nonEpisode.find(item => isTavilyRatingsPageEvidence(item) && !/\bTV Series\b/i.test(String(item.title || "")))
    || nonEpisode.find(item => !/\bTV Series\b/i.test(String(item.title || "")))
    || nonEpisode.find(isTavilyRatingsPageEvidence)
    || nonEpisode[0]
    || null;
}

function buildTavilyRatingSearchQuery(title = "", type = "tv", year = "") {
  const cleanTitle = String(title || "").trim();
  const cleanYear = String(year || "").trim();
  const mediaLabel = normalizeImdbMediaType(type) === "movie" ? "movie" : "TV series";
  return [`"${cleanTitle}"`, cleanYear, mediaLabel, "IMDb rating"].filter(Boolean).join(" ");
}

async function fetchTavilyRatingEvidence(env, payload = {}, timeoutMs = 9000) {
  const config = getTavilyClientConfig(env);
  const title = String(payload.title || "").trim();
  const type = normalizeImdbMediaType(payload.type || "tv");
  const year = String(payload.year || "").trim().match(/^(18|19|20)\d{2}$/)?.[0] || "";

  if (!config.value) {
    return { ok: false, error: getTavilyConfigError(env), tavily: getTavilyPublicStatus(env) };
  }
  if (!title) {
    return { ok: false, error: "Missing title for Tavily rating search.", tavily: getTavilyPublicStatus(env) };
  }

  const query = buildTavilyRatingSearchQuery(title, type, year);
  /* v10.235: deeper search so the LIVE IMDb title page (with the current
     rating + vote count) actually surfaces and its text is readable. The old
     basic/6-result/no-content config let stale IMDb *news articles* win — e.g.
     "Obsession" (2026) read 7.6 from a release-week article while the live
     IMDb title page already showed 8.2. advanced depth + raw page content +
     more results + an imdb.com domain bias fixes that. */
  const result = await fetchJsonWithTimeout(new URL("search", TAVILY_ORIGIN), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.value}`
    },
    body: JSON.stringify({
      query,
      search_depth: "advanced",
      topic: "general",
      include_answer: true,
      include_raw_content: true,
      include_domains: ["imdb.com", "m.imdb.com"],
      max_results: 10
    })
  }, timeoutMs);

  const data = result.data && typeof result.data === "object" ? result.data : {};
  const evidence = Array.isArray(data.results) ? data.results.slice(0, 10).map((item, index) => ({
    index,
    title: String(item?.title || "").trim(),
    url: String(item?.url || "").trim(),
    content: normalizeTavilyEvidenceText(item?.content || item?.raw_content || ""),
    score: Number.isFinite(Number(item?.score)) ? Number(item.score) : null
  })).filter(item => item.title || item.url || item.content) : [];
  const answer = normalizeTavilyEvidenceText(data.answer || "");

  if (!result.ok || (!answer && !evidence.length)) {
    return {
      ok: false,
      status: result.status || 502,
      error: result.error || data.error || "Tavily search returned no usable rating evidence.",
      query,
      answer,
      evidence,
      tavily: getTavilyPublicStatus(env)
    };
  }

  return {
    ok: true,
    status: result.status || 200,
    query,
    answer,
    evidence,
    responseTime: data.response_time || null,
    tavily: getTavilyPublicStatus(env)
  };
}

/* v10.235: turn IMDb-style vote strings ("38K", "38,392", "1.2M") into a
   plain integer count. */
function parseImdbVoteCount(raw = "") {
  const text = String(raw || "").trim();
  if (!text) return null;
  const match = text.match(/([\d][\d.,]*)\s*([KMB])?/i);
  if (!match) return null;
  let n = parseFloat(match[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const suffix = (match[2] || "").toUpperCase();
  if (suffix === "K") n *= 1e3;
  else if (suffix === "M") n *= 1e6;
  else if (suffix === "B") n *= 1e9;
  return Math.round(n);
}

/* v10.235: pull the LIVE IMDb rating (and vote count when present) out of the
   text of an IMDb title page. Tries JSON-LD aggregateRating first (gold
   standard when the raw HTML survives extraction), then the visible
   "IMDb RATING 8.2/10 38K" widget text. Returns null when no 0-10 rating is
   found so callers can fall back cleanly. */
function parseImdbRatingFromText(text = "") {
  const raw = String(text || "");
  if (!raw) return null;
  let rating = null;
  let votes = null;

  const ldValue = raw.match(/"ratingValue"\s*:\s*"?(\d{1,2}(?:\.\d+)?)"?/i);
  if (ldValue) {
    const v = parseFloat(ldValue[1]);
    if (Number.isFinite(v) && v >= 0 && v <= 10) rating = v;
  }
  const ldCount = raw.match(/"ratingCount"\s*:\s*"?(\d[\d,]*)"?/i);
  if (ldCount) votes = parseImdbVoteCount(ldCount[1]);

  if (rating === null) {
    const collapsed = raw.replace(/\s+/g, " ");
    const widget = collapsed.match(/IMDb\s*RATING\b[^\d]{0,30}((?:10(?:\.0)?)|\d(?:\.\d)?)\s*\/\s*10\s*([\d.,]+\s*[KMB]?)?/i);
    if (widget) {
      const v = parseFloat(widget[1]);
      if (Number.isFinite(v) && v >= 0 && v <= 10) rating = v;
      if (votes === null && widget[2]) votes = parseImdbVoteCount(widget[2]);
    }
  }

  if (rating === null) return null;
  return { rating: Number(rating.toFixed(1)), votes };
}

/* v10.235: read the LIVE IMDb title page directly through Tavily's /extract
   API when we already know the exact IMDb ID. This is deterministic — Tavily
   (an approved 3rd-party API, not us) fetches imdb.com/title/<id>/ and returns
   its content, and we read the current rating straight off that page. No fuzzy
   search, no AI guess, no stale release-week news article. This is the path
   that makes fresh titles (e.g. "Obsession" 2026: live IMDb 8.2 vs a stale
   OMDb snapshot of 7.6) read correctly. */
async function fetchTavilyImdbTitleExtract(env, imdbId = "", timeoutMs = 9000) {
  const config = getTavilyClientConfig(env);
  const id = normalizeImdbTitleId(imdbId);
  if (!config.value) return { ok: false, error: getTavilyConfigError(env), tavily: getTavilyPublicStatus(env) };
  if (!id) return { ok: false, error: "Missing IMDb ID for Tavily title extract.", tavily: getTavilyPublicStatus(env) };

  const titleUrl = `https://www.imdb.com/title/${id}/`;
  const result = await fetchJsonWithTimeout(new URL("extract", TAVILY_ORIGIN), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.value}`
    },
    body: JSON.stringify({ urls: [titleUrl], extract_depth: "advanced", include_images: false })
  }, timeoutMs);

  const data = result.data && typeof result.data === "object" ? result.data : {};
  const first = Array.isArray(data.results) && data.results.length ? data.results[0] : null;
  const rawContent = first ? String(first.raw_content || first.content || "") : "";
  if (!result.ok || !rawContent) {
    return {
      ok: false,
      status: result.status || 502,
      error: result.error || data.error || (Array.isArray(data.failed_results) && data.failed_results.length ? "Tavily could not extract the IMDb title page." : "Tavily extract returned no content."),
      url: titleUrl,
      tavily: getTavilyPublicStatus(env)
    };
  }

  const parsed = parseImdbRatingFromText(rawContent);
  return {
    ok: !!(parsed && Number.isFinite(parsed.rating)),
    url: titleUrl,
    rating: parsed ? parsed.rating : null,
    votes: parsed ? (parsed.votes ?? null) : null,
    content: normalizeTavilyEvidenceText(rawContent),
    rawLength: rawContent.length,
    tavily: getTavilyPublicStatus(env)
  };
}

function normalizeImdbReviewLimit(value = 15) {
  const n = parseInt(String(value || ""), 10);
  if (!Number.isFinite(n)) return 15;
  return Math.max(1, Math.min(30, n));
}

function hashStringBase36(value = "") {
  let hash = 5381;
  const text = String(value || "");
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function decodeBasicHtmlEntities(value = "") {
  const named = {
    amp: "&",
    apos: "'",
    aacute: "á",
    agrave: "à",
    eacute: "é",
    egrave: "è",
    iacute: "í",
    igrave: "ì",
    ntilde: "ñ",
    oacute: "ó",
    ograve: "ò",
    uacute: "ú",
    ugrave: "ù",
    copy: "©",
    hellip: "…",
    gt: ">",
    lt: "<",
    mdash: "—",
    nbsp: " ",
    ndash: "–",
    quot: "\""
  };
  named.lsquo = "‘";
  named.rsquo = "’";
  named.ldquo = "“";
  named.rdquo = "”";
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/&([a-z]+);/gi, (_, name) => named[String(name || "").toLowerCase()] || `&${name};`);
}

function cleanImdbReviewText(value = "", maxLength = 1400) {
  return decodeBasicHtmlEntities(String(value || ""))
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

function normalizeImdbReviewRating(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.min(10, Math.round(value * 10) / 10) : 0;
  }
  const raw = String(value || "").trim();
  const match = raw.match(/(\d{1,2}(?:\.\d+)?)\s*(?:\/|out of)\s*10/i) || raw.match(/^(\d{1,2}(?:\.\d+)?)$/);
  if (!match) return 0;
  const rating = parseFloat(match[1]);
  return Number.isFinite(rating) && rating > 0 ? Math.min(10, Math.round(rating * 10) / 10) : 0;
}

function parseEscapedJsonText(value = "") {
  const raw = String(value || "");
  try {
    return JSON.parse(`"${raw.replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`);
  } catch (error) {
    return raw
      .replace(/\\"/g, "\"")
      .replace(/\\\//g, "/")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\n")
      .replace(/\\t/g, " ");
  }
}

function normalizeImdbReviewObject(item = {}, index = 0, sourceUrl = "") {
  if (!item || typeof item !== "object") return null;
  const text = cleanImdbReviewText(
    item.text || item.review || item.reviewText || item.reviewBody || item.body || item.content || "",
    1400
  );
  if (text.length < 25) return null;
  const title = cleanImdbReviewText(item.title || item.headline || item.summary || "", 140);
  const author = cleanImdbReviewText(item.author || item.username || item.user || item.name || "", 80) || "IMDb User";
  const date = cleanImdbReviewText(item.date || item.reviewDate || item.createdAt || item.created_at || "", 80);
  const rating = normalizeImdbReviewRating(item.rating ?? item.score ?? item.ratingText ?? item.userRating);
  const id = String(item.id || item.reviewId || item.url || "").trim()
    || `imdb-review-${hashStringBase36(`${author}|${title}|${text.slice(0, 220)}`)}-${index}`;
  return {
    id,
    source: "imdb",
    provider: "IMDb",
    title,
    author,
    date,
    rating,
    ratingText: rating ? `${rating}/10` : "",
    text,
    url: String(item.url || sourceUrl || "").trim()
  };
}

function dedupeImdbReviews(reviews = [], limit = 15) {
  const seen = new Set();
  const out = [];
  for (const review of Array.isArray(reviews) ? reviews : []) {
    const normalized = normalizeImdbReviewObject(review, out.length, review?.url || "");
    if (!normalized) continue;
    const textKey = normalizeTitleForOmdbMatch(normalized.text).slice(0, 180);
    if (textKey.length < 18) continue;
    const authorKey = normalizeTitleForOmdbMatch(normalized.author).slice(0, 60);
    const key = `${authorKey}:${textKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

async function resolveImdbReviewsTitleId(env, payload = {}) {
  const type = normalizeImdbMediaType(payload.type || "tv");
  const tmdbId = String(payload.tmdbId || payload.id || "").trim();
  const title = String(payload.title || payload.name || "").trim();
  const year = String(payload.year || "").trim().match(/^(18|19|20)\d{2}$/)?.[0] || "";
  let imdbId = normalizeImdbTitleId(payload.imdbId || "");
  const attempts = [];

  if (imdbId) {
    attempts.push({ step: "request_imdb_id", ok: true, imdbId });
    return { ok: true, type, tmdbId, title, year, imdbId, attempts };
  }

  if (title) {
    try {
      const omdb = await fetchOmdbTitleImdbId(env, title, type, year, 6500);
      imdbId = normalizeImdbTitleId(omdb.imdbId || "");
      attempts.push({ step: "omdb_title_imdb_id", ok: !!(omdb.ok && imdbId), imdbId, error: omdb.error || "" });
    } catch (error) {
      attempts.push({ step: "omdb_title_imdb_id", ok: false, error: errorMessage(error) });
    }
  }

  if (!imdbId && tmdbId) {
    try {
      imdbId = await fetchTmdbExternalImdbId(env, type, tmdbId, 6500);
      attempts.push({ step: "tmdb_external_ids", ok: !!imdbId, imdbId });
    } catch (error) {
      attempts.push({ step: "tmdb_external_ids", ok: false, error: errorMessage(error) });
    }
  }

  return { ok: !!imdbId, type, tmdbId, title, year, imdbId, attempts };
}

async function fetchTavilyImdbReviewsExtract(env, imdbId = "", timeoutMs = 15000) {
  const config = getTavilyClientConfig(env);
  const id = normalizeImdbTitleId(imdbId);
  if (!config.value) return { ok: false, error: getTavilyConfigError(env), tavily: getTavilyPublicStatus(env) };
  if (!id) return { ok: false, error: "Missing IMDb ID for Tavily reviews extract.", tavily: getTavilyPublicStatus(env) };

  const urls = [
    `https://www.imdb.com/title/${id}/reviews/`,
    `https://www.imdb.com/title/${id}/reviews/?sort=helpfulnessScore&dir=desc&ratingFilter=0`,
    `https://m.imdb.com/title/${id}/reviews/`
  ];
  let lastFailure = null;

  function tavilyExtractFailureMessage(data, result) {
    const failed = Array.isArray(data?.failed_results) && data.failed_results.length ? data.failed_results[0] : null;
    const detail = failed?.error ||
      failed?.message ||
      data?.error ||
      data?.message ||
      data?.detail ||
      result?.error ||
      "Tavily extract returned no review content.";
    if (detail && typeof detail === "object") {
      try { return JSON.stringify(detail).slice(0, 500); }
      catch (error) { return "Tavily extract failed with an object error payload."; }
    }
    return String(detail || "Tavily extract returned no review content.").trim();
  }

  for (const reviewsUrl of urls) {
    for (const depth of ["advanced", "basic"]) {
      const result = await fetchJsonWithTimeout(new URL("extract", TAVILY_ORIGIN), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.value}`
        },
        body: JSON.stringify({ urls: [reviewsUrl], extract_depth: depth, include_images: false, format: "text", timeout: Math.max(1, Math.min(60, Math.ceil(timeoutMs / 1000))) })
      }, timeoutMs);

      const data = result.data && typeof result.data === "object" ? result.data : {};
      const first = Array.isArray(data.results) && data.results.length ? data.results[0] : null;
      const rawContent = first ? String(first.raw_content || first.content || "") : "";
      if (result.ok && rawContent) {
        return {
          ok: true,
          url: reviewsUrl,
          extractDepth: depth,
          content: rawContent,
          rawLength: rawContent.length,
          tavily: getTavilyPublicStatus(env)
        };
      }
      lastFailure = {
        status: result.status || 502,
        error: tavilyExtractFailureMessage(data, result),
        url: reviewsUrl,
        extractDepth: depth
      };
      if (/usage limit|rate limit|quota|upgrade your plan/i.test(lastFailure.error || "")) {
        return {
          ok: false,
          status: lastFailure.status,
          error: lastFailure.error,
          url: lastFailure.url,
          extractDepth: lastFailure.extractDepth,
          tavily: getTavilyPublicStatus(env)
        };
      }
    }
  }

  return {
    ok: false,
    status: lastFailure?.status || 502,
    error: lastFailure?.error || "Tavily extract returned no review content.",
    url: lastFailure?.url || urls[0],
    extractDepth: lastFailure?.extractDepth || "",
    tavily: getTavilyPublicStatus(env)
  };
}

async function extractImdbReviewsWithAi(env, rawContent = "", payload = {}, limit = 15, sourceUrl = "") {
  if (!env.myscreenlistAi || typeof env.myscreenlistAi.run !== "function") {
    return { ok: false, reviews: [], error: "Workers AI binding missing. Add binding name: myscreenlistAi." };
  }
  const cleanLimit = normalizeImdbReviewLimit(limit);
  const sourceText = String(rawContent || "").slice(0, 30000);
  if (!sourceText.trim()) return { ok: false, reviews: [], error: "Missing IMDb review source text." };

  const systemPrompt = [
    "You extract IMDb user reviews for Shelfd.",
    "Return valid JSON only. No markdown.",
    "Use ONLY the provided Tavily-extracted IMDb reviews page text.",
    "Do not summarize, invent, or use model memory.",
    "Extract up to the requested limit of real user reviews.",
    "Each review text must be the actual user review body from the source; truncate any one body at 900 characters.",
    "Skip navigation text, critic summaries, plot summaries, ads, sign-in prompts, spoiler warnings without review text, and duplicate reviews.",
    "JSON shape: {\"ok\":true,\"reviews\":[{\"title\":string,\"author\":string,\"date\":string,\"rating\":number|null,\"text\":string,\"url\":string}]}."
  ].join(" ");
  const userPrompt = JSON.stringify({
    requestedTitle: payload.title || "",
    requestedType: normalizeImdbMediaType(payload.type || "tv"),
    requestedYear: payload.year || "",
    imdbId: payload.imdbId || "",
    sourceUrl,
    limit: cleanLimit,
    sourceText
  });

  try {
    const aiResult = await runWorkersAi(env, SCREENLIST_AI_MODEL, systemPrompt, userPrompt, 0.02, 2600);
    const text = cleanAiJsonText(extractAiText(aiResult));
    let parsed = {};
    try { parsed = JSON.parse(text); }
    catch (error) { parsed = { ok: false, reviews: [], error: "AI returned non-JSON text.", rawText: text }; }
    const rawReviews = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.reviews) ? parsed.reviews : (Array.isArray(parsed.items) ? parsed.items : []));
    const reviews = dedupeImdbReviews(rawReviews.map((review, index) => ({ ...review, url: review.url || sourceUrl })), cleanLimit);
    return {
      ok: reviews.length > 0,
      reviews,
      provider: "Cloudflare Workers AI",
      error: reviews.length ? "" : (parsed.error || parsed.note || "AI did not extract IMDb reviews.")
    };
  } catch (error) {
    return { ok: false, reviews: [], error: errorMessage(error) };
  }
}

function parseImdbReviewsFromJsonLikeText(rawContent = "", limit = 15, sourceUrl = "") {
  const text = String(rawContent || "");
  const reviews = [];
  const patterns = [
    /"reviewBody"\s*:\s*"((?:\\.|[^"\\]){40,5000})"/gi,
    /"reviewText"\s*:\s*"((?:\\.|[^"\\]){40,5000})"/gi,
    /"originalText"\s*:\s*"((?:\\.|[^"\\]){40,5000})"/gi,
    /"plainText"\s*:\s*"((?:\\.|[^"\\]){40,5000})"/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) && reviews.length < limit) {
      const body = cleanImdbReviewText(parseEscapedJsonText(match[1]), 1400);
      if (body.length < 40) continue;
      reviews.push({
        author: "IMDb User",
        text: body,
        url: sourceUrl
      });
    }
    if (reviews.length >= limit) break;
  }

  return dedupeImdbReviews(reviews, limit);
}

function parseImdbReviewsFromLooseText(rawContent = "", limit = 15, sourceUrl = "") {
  const lines = String(rawContent || "")
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map(line => cleanImdbReviewText(line, 1600))
    .filter(Boolean);
  const reviews = [];
  let pendingTitle = "";
  let pendingRating = 0;
  let pendingDate = "";
  let pendingAuthor = "";

  for (let i = 0; i < lines.length && reviews.length < limit; i++) {
    const line = lines[i];
    const rating = normalizeImdbReviewRating(line);
    if (rating) {
      pendingRating = rating;
      continue;
    }
    if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}\s+[a-z]+|\d{4}-\d{2}-\d{2})/i.test(line) && line.length <= 80) {
      pendingDate = line;
      continue;
    }
    if (/^[a-z0-9_.-]{3,40}$/i.test(line) && !/\s/.test(line)) {
      pendingAuthor = line;
      continue;
    }
    if (line.length >= 8 && line.length <= 120 && !/[.!?]\s+\S/.test(line)) {
      pendingTitle = line;
      continue;
    }
    if (line.length >= 85 && !/^(user reviews|review this title|sign in|sort by|filter by|imdb)/i.test(line)) {
      reviews.push({
        title: pendingTitle,
        author: pendingAuthor || "IMDb User",
        date: pendingDate,
        rating: pendingRating || 0,
        text: line,
        url: sourceUrl
      });
      pendingTitle = "";
      pendingRating = 0;
      pendingDate = "";
      pendingAuthor = "";
    }
  }

  return dedupeImdbReviews(reviews, limit);
}

function parseFallbackImdbReviews(rawContent = "", limit = 15, sourceUrl = "") {
  const jsonReviews = parseImdbReviewsFromJsonLikeText(rawContent, limit, sourceUrl);
  if (jsonReviews.length >= limit) return jsonReviews;
  return dedupeImdbReviews([
    ...jsonReviews,
    ...parseImdbReviewsFromLooseText(rawContent, limit, sourceUrl)
  ], limit);
}

function buildImdbReviewsCacheKey(originUrl, payload = {}) {
  const type = normalizeImdbMediaType(payload.type || "tv");
  const tmdbId = String(payload.tmdbId || payload.id || "").trim();
  const imdbId = normalizeImdbTitleId(payload.imdbId || "");
  const title = String(payload.title || payload.name || "").trim().toLowerCase();
  const year = String(payload.year || "").trim().match(/^(18|19|20)\d{2}$/)?.[0] || "";
  const limit = normalizeImdbReviewLimit(payload.limit);
  const lookup = imdbId
    || (tmdbId ? `tmdb-${tmdbId}` : `title-${encodeURIComponent(`${title}-${year || "no-year"}`).slice(0, 150)}`);
  return new Request(`${originUrl.origin}/__screenlist_imdb_reviews/${SCREENLIST_IMDB_REVIEWS_CACHE_VERSION}/${type}/${lookup}/${limit}`, { method: "GET" });
}

async function runImdbReviewsEndpoint(request, env, ctx) {
  if (request.method !== "GET") {
    return jsonResponse({ ok: false, error: "GET required.", reviews: [] }, 405);
  }

  const url = new URL(request.url);
  const type = normalizeImdbMediaType(url.searchParams.get("type"));
  const tmdbId = String(url.searchParams.get("tmdbId") || url.searchParams.get("id") || "").trim();
  const imdbId = normalizeImdbTitleId(url.searchParams.get("imdbId") || "");
  const title = String(url.searchParams.get("title") || "").trim();
  const year = String(url.searchParams.get("year") || "").trim().match(/^(18|19|20)\d{2}$/)?.[0] || "";
  const limit = normalizeImdbReviewLimit(url.searchParams.get("limit") || 15);

  if (!imdbId && !tmdbId && !title) {
    return jsonResponse({ ok: false, error: "Missing tmdbId, imdbId, or title.", reviews: [] }, 400);
  }

  const cacheKey = buildImdbReviewsCacheKey(url, { type, tmdbId, imdbId, title, year, limit });
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("x-screenlist-imdb-reviews-cache", "HIT");
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }

  const resolved = await resolveImdbReviewsTitleId(env, { type, tmdbId, imdbId, title, year });
  if (!resolved.imdbId) {
    return jsonResponse({
      ok: false,
      error: "Could not resolve an IMDb ID for reviews.",
      source: "imdb",
      type,
      tmdbId,
      imdbId: "",
      title,
      year,
      reviews: [],
      attempts: resolved.attempts || [],
      sources: {
        omdb: getOmdbPublicStatus(env),
        tmdb: { configured: !!env.TMDB_KEY },
        tavily: getTavilyPublicStatus(env),
        ai: { configured: !!env.myscreenlistAi }
      }
    }, 200, { "Cache-Control": "no-store" });
  }

  const extract = await fetchTavilyImdbReviewsExtract(env, resolved.imdbId);
  if (!extract.ok) {
    return jsonResponse({
      ok: false,
      error: extract.error || "IMDb reviews extract failed.",
      source: "imdb",
      type,
      tmdbId,
      imdbId: resolved.imdbId,
      title,
      year,
      reviews: [],
      attempts: resolved.attempts || [],
      sourceUrl: extract.url || "",
      extractDepth: extract.extractDepth || "",
      tavily: extract.tavily || getTavilyPublicStatus(env)
    }, extract.status && extract.status >= 400 && extract.status < 600 ? extract.status : 502, { "Cache-Control": "no-store" });
  }

  const ai = await extractImdbReviewsWithAi(env, extract.content, { type, tmdbId, imdbId: resolved.imdbId, title, year }, limit, extract.url);
  const fallback = ai.reviews.length < limit ? parseFallbackImdbReviews(extract.content, limit, extract.url) : [];
  const reviews = dedupeImdbReviews([
    ...ai.reviews,
    ...fallback
  ], limit);

  const body = {
    ok: reviews.length > 0,
    source: "imdb",
    provider: "IMDb via Tavily Extract",
    type,
    tmdbId,
    imdbId: resolved.imdbId,
    title,
    year,
    sourceUrl: extract.url,
    count: reviews.length,
    reviews,
    attempts: resolved.attempts || [],
    extractor: {
      ai: !!ai.ok,
      aiError: ai.ok ? "" : (ai.error || "")
    },
    sources: {
      omdb: getOmdbPublicStatus(env),
      tmdb: { configured: !!env.TMDB_KEY },
      tavily: getTavilyPublicStatus(env),
      ai: { configured: !!env.myscreenlistAi }
    }
  };
  const response = jsonResponse(body, 200, {
    "Cache-Control": reviews.length ? `public, max-age=${SCREENLIST_IMDB_REVIEWS_CACHE_TTL_SECONDS}` : "no-store",
    "x-screenlist-imdb-reviews-cache": "MISS"
  });

  if (reviews.length && ctx?.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

function parseTavilyAiRatingResult(body = {}, fallback = {}) {
  const source = body && typeof body === "object" ? body : {};
  const explicitlyOk = source.ok === true || String(source.ok || "").toLowerCase() === "true";
  const rating = normalizeOmdbRating(source.rating ?? source.imdbRating ?? source.score ?? source.value ?? "");
  const type = normalizeImdbMediaType(source.type || fallback.type || "tv");
  const evidenceIndex = Number.isFinite(Number(source.evidenceIndex)) ? Number(source.evidenceIndex) : null;
  const evidence = Array.isArray(fallback.evidence) ? fallback.evidence : [];
  const matchedEvidence = evidenceIndex !== null ? evidence.find(item => Number(item.index) === evidenceIndex) : null;
  const preferredEvidence = selectPreferredTavilyRatingEvidence(evidence, type);
  const pickedEvidence = matchedEvidence || evidence.find(item => String(item.url || "").trim() === String(source.sourceUrl || source.url || "").trim()) || null;
  const pickedEpisode = !!pickedEvidence && isTavilyEpisodeEvidence(pickedEvidence);

  let finalEvidence = pickedEvidence;
  if (preferredEvidence && (!finalEvidence || pickedEpisode || type === "tv")) {
    finalEvidence = preferredEvidence;
  }
  if (type === "tv" && pickedEpisode && !preferredEvidence) {
    return {
      ok: false,
      source: "tavily_search_ai",
      error: "AI selected an episode rating, not the overall TV series IMDb rating.",
      title: String(source.title || fallback.title || "").trim(),
      type,
      year: String(fallback.year || source.year || "").trim(),
      confidence: "low"
    };
  }

  const sourceUrl = String(finalEvidence?.url || source.sourceUrl || source.url || "").trim();
  const finalEvidenceIndex = Number.isFinite(Number(finalEvidence?.index)) ? Number(finalEvidence.index) : evidenceIndex;

  if (!explicitlyOk || !rating) {
    return {
      ok: false,
      source: "tavily_search_ai",
      error: String(source.error || source.note || "AI could not extract a verified IMDb rating from Tavily evidence.").trim(),
      title: String(source.title || fallback.title || "").trim(),
      type,
      year: String(fallback.year || source.year || "").trim(),
      confidence: normalizeAiRatingConfidence(source.confidence)
    };
  }

  if (!sourceUrl || (type === "tv" && finalEvidence && isTavilyEpisodeEvidence(finalEvidence))) {
    return {
      ok: false,
      source: "tavily_search_ai",
      error: "No acceptable overall IMDb title evidence was found for this rating.",
      title: String(source.title || fallback.title || "").trim(),
      type,
      year: String(fallback.year || source.year || "").trim(),
      confidence: "low"
    };
  }

  return {
    ok: true,
    source: "tavily_search_ai",
    provider: "Tavily Search + Cloudflare Workers AI",
    imdbRating: rating,
    aiRating: rating,
    rating,
    title: String(source.title || fallback.title || "").trim(),
    type,
    year: String(fallback.year || source.year || "").trim(),
    confidence: normalizeAiRatingConfidence(source.confidence),
    sourceUrl,
    evidenceIndex: finalEvidenceIndex,
    evidenceTitle: String(finalEvidence?.title || "").trim(),
    note: String(source.note || "AI extracted this rating from Tavily search evidence.").trim()
  };
}

async function extractRatingFromTavilyEvidence(env, payload = {}, tavilyResult = {}) {
  if (!env.myscreenlistAi || typeof env.myscreenlistAi.run !== "function") {
    return { ok: false, source: "tavily_search_ai", error: "Workers AI binding missing. Add binding name: myscreenlistAi." };
  }

  const title = String(payload.title || "").trim();
  const type = normalizeImdbMediaType(payload.type || "tv");
  const year = String(payload.year || "").trim().match(/^(18|19|20)\d{2}$/)?.[0] || "";
  const evidence = Array.isArray(tavilyResult.evidence) ? tavilyResult.evidence : [];
  const preferredEvidence = selectPreferredTavilyRatingEvidence(evidence, type);
  const evidenceText = evidence.map(item => [
    `Evidence ${item.index}:`,
    `title=${item.title}`,
    `url=${item.url}`,
    `snippet=${item.content}`
  ].join("\n")).join("\n\n");

  const systemPrompt = [
    "You extract IMDb ratings from live search evidence for Shelfd.",
    "Return valid JSON only. No markdown.",
    "Use ONLY the provided Tavily answer and evidence snippets.",
    "Do not use your model memory and do not guess.",
    "Return the overall movie or TV series IMDb rating only, not an episode rating, critic score, Rotten Tomatoes score, TMDB score, Metacritic score, or list ranking.",
    "For TV series, do not select evidence whose title says TV Episode. Prefer the IMDb TV Series ratings page when available.",
    "If a preferredEvidenceIndex is provided, use that sourceUrl/evidenceIndex unless it clearly conflicts with the rating evidence.",
    "If the evidence does not clearly support an IMDb-style 0-10 rating for the requested title/type/year, return ok:false.",
    "JSON shape: {\"ok\":boolean,\"title\":string,\"type\":\"movie\"|\"tv\",\"year\":string,\"rating\":number|null,\"confidence\":\"high\"|\"medium\"|\"low\",\"sourceUrl\":string,\"evidenceIndex\":number|null,\"note\":string}."
  ].join(" ");
  const userPrompt = JSON.stringify({
    requestedTitle: title,
    requestedType: type,
    requestedYear: year,
    requestedRating: "IMDb 0-10 title rating",
    tavilyQuery: tavilyResult.query || "",
    tavilyAnswer: tavilyResult.answer || "",
    preferredEvidenceIndex: Number.isFinite(Number(preferredEvidence?.index)) ? Number(preferredEvidence.index) : null,
    preferredEvidenceUrl: preferredEvidence?.url || "",
    evidence: evidenceText
  });

  try {
    const aiResult = await runWorkersAi(env, SCREENLIST_AI_MODEL, systemPrompt, userPrompt, 0.05, 420);
    const text = cleanAiJsonText(extractAiText(aiResult));
    let parsed = {};
    try { parsed = JSON.parse(text); }
    catch (error) { parsed = { ok: false, note: "AI returned non-JSON text.", rawText: text }; }
    return parseTavilyAiRatingResult(parsed, { title, type, year, evidence });
  } catch (error) {
    return {
      ok: false,
      source: "tavily_search_ai",
      error: errorMessage(error),
      title,
      type,
      year,
      confidence: "low"
    };
  }
}

async function fetchTavilySearchAiRating(env, payload = {}) {
  const title = String(payload.title || payload.name || "").trim();
  const type = normalizeImdbMediaType(payload.type || "tv");
  const year = String(payload.year || "").trim().match(/^(18|19|20)\d{2}$/)?.[0] || "";
  const imdbId = normalizeImdbTitleId(payload.imdbId || "");
  if (!title && !imdbId) {
    return { ok: false, source: "tavily_search_ai", error: "Missing title for Tavily rating search.", title, type, year, confidence: "low" };
  }

  /* v10.235: with the exact IMDb ID in hand, read the live title page directly
     via Tavily extract. Deterministic and stale-proof — preferred over the
     fuzzy search+AI flow below. */
  if (imdbId) {
    const extract = await fetchTavilyImdbTitleExtract(env, imdbId);
    if (extract.ok && Number.isFinite(extract.rating)) {
      return {
        ok: true,
        source: "tavily_imdb_extract",
        provider: "Tavily Extract (live IMDb title page)",
        imdbRating: extract.rating,
        aiRating: extract.rating,
        rating: extract.rating,
        imdbVotes: extract.votes ?? null,
        title,
        type,
        year,
        confidence: "high",
        sourceUrl: extract.url,
        evidenceIndex: 0,
        evidenceTitle: title,
        ratingSource: "tavily_imdb_extract",
        note: "Read live from the IMDb title page via Tavily extract.",
        imdbId,
        tavily: extract.tavily || getTavilyPublicStatus(env)
      };
    }
  }

  if (!title) {
    return { ok: false, source: "tavily_search_ai", error: "Tavily extract found no rating and no title to search.", title, type, year, confidence: "low" };
  }

  const tavily = await fetchTavilyRatingEvidence(env, { title, type, year });
  if (!tavily.ok) {
    return {
      ok: false,
      source: "tavily_search_ai",
      error: tavily.error || "Tavily search failed.",
      title,
      type,
      year,
      confidence: "low",
      tavily: tavily.tavily || getTavilyPublicStatus(env),
      query: tavily.query || ""
    };
  }

  const ai = await extractRatingFromTavilyEvidence(env, { title, type, year }, tavily);
  return {
    ...ai,
    ok: !!ai.ok,
    ratingSource: ai.ok ? "tavily_search_ai" : "tavily_search_no_verified_rating",
    title: ai.title || title,
    type,
    year,
    query: tavily.query,
    tavilyAnswer: tavily.answer,
    tavily: tavily.tavily
  };
}

async function runAiRatingSearchTestEndpoint(request, env, ctx) {
  const payload = await readRatingResolvePayload(request);
  const title = String(payload.title || payload.name || "").trim();
  const type = normalizeImdbMediaType(payload.type || "tv");
  const year = String(payload.year || "").trim().match(/^(18|19|20)\d{2}$/)?.[0] || "";
  if (!title) return jsonResponse({ ok: false, error: "Missing title." }, 400);

  const tavily = await fetchTavilyRatingEvidence(env, { title, type, year });
  if (!tavily.ok) {
    return jsonResponse({
      ok: false,
      source: "tavily_search_ai",
      error: tavily.error,
      title,
      type,
      year,
      tavily: tavily.tavily || getTavilyPublicStatus(env),
      evidence: tavily.evidence || [],
      testMode: true
    }, tavily.status && tavily.status >= 400 && tavily.status < 600 ? tavily.status : 502, {
      "Cache-Control": "no-store"
    });
  }

  const ai = await extractRatingFromTavilyEvidence(env, { title, type, year }, tavily);
  return jsonResponse({
    ...ai,
    ok: !!ai.ok,
    ratingSource: ai.ok ? "tavily_search_ai" : "tavily_search_no_verified_rating",
    requestedTitle: title,
    requestedType: type,
    requestedYear: year,
    tavily: tavily.tavily,
    query: tavily.query,
    tavilyAnswer: tavily.answer,
    evidence: tavily.evidence,
    testMode: true
  }, ai.ok ? 200 : 502, {
    "Cache-Control": "no-store"
  });
}

async function runImdbRatingEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  const type = normalizeImdbMediaType(url.searchParams.get("type"));
  const tmdbId = String(url.searchParams.get("tmdbId") || url.searchParams.get("id") || "").trim();
  let imdbId = normalizeImdbTitleId(url.searchParams.get("imdbId") || "");
  /* Title + year are only fallback selectors for OMDb title/year lookup.
     The public IMDb endpoint must not cache AI/search estimates as IMDb. */
  const title = String(url.searchParams.get("title") || "").trim();
  const year = String(url.searchParams.get("year") || "").trim().match(/^(18|19|20)\d{2}$/)?.[0] || "";

  if (!imdbId && !tmdbId && !title) {
    return jsonResponse({ ok: false, error: "Missing tmdbId, imdbId, or title." }, 400);
  }

  const lookupCachePart = imdbId || (title ? `title-${encodeURIComponent(`${title.toLowerCase()}-${year || "no-year"}`).slice(0, 140)}` : "lookup");
  const cacheKey = new Request(`${url.origin}/__screenlist_imdb_rating/${SCREENLIST_IMDB_RATING_CACHE_VERSION}/${type}/${tmdbId || "no-tmdb"}/${lookupCachePart}`, { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("x-screenlist-imdb-cache", "HIT");
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }

  /* v10.72: route through the proper fallback resolver instead of calling
     `fetchOmdbImdbRating` bare. Previously, when OMDb returned 401 ("Request
     limit reached!"), this endpoint propagated `ok:false` and the client UI
     showed no IMDb rating at all. The resolver tries (in order):
       1. TMDB external_ids → IMDb ID lookup
       2. OMDb-by-imdbId   (the old bare path)
       3. OMDb-by-title+year
       4. Tavily search-AI (web → IMDb number)
       5. Workers-AI memory fallback (estimate)
     Steps 4+5 keep the IMDb-style rating flowing when OMDb is unavailable.
     Source is recorded on the response (`ratingSource`) so the client never
     conflates a TMDB vote_average with an IMDb rating. */
  /* v10.985 override: allowAi is false below, so the app-visible IMDb
     endpoint now accepts only OMDb IMDb-ID/title-year responses.
     v10.235: allowLiveImdbExtract is true — for RECENT releases only, read the
     live IMDb title page directly (Tavily extract) and prefer it over OMDb's
     lagging snapshot. This is the real imdb.com number, not an AI estimate, so
     it is safe to surface on the public IMDb endpoint. */
  const rating = await resolveScreenListRating(
    { type, tmdbId, imdbId, title, year },
    env,
    ctx,
    { allowAi: false, allowLiveImdbExtract: true }
  );

  /* Preserve the imdbId the resolver actually settled on so the response
     payload + cache key still reflect it for debugging. */
  if (rating && rating.imdbId) imdbId = normalizeImdbTitleId(rating.imdbId) || imdbId;

  const status = rating.ok ? 200 : (rating.status >= 400 && rating.status < 600 ? rating.status : 502);
  /* v674: same recency-aware TTL as the batch endpoint. */
  const ttl = rating.ok ? getImdbCacheTtlSeconds(rating.year) : 60 * 30;
  const response = jsonResponse({
    ...rating,
    type,
    tmdbId,
    imdbId,
    sources: {
      tmdb: { configured: !!env.TMDB_KEY },
      imdb: getOmdbPublicStatus(env)
    }
  }, status, {
    "Cache-Control": `public, max-age=${ttl}`,
    "x-screenlist-imdb-cache": "MISS"
  });

  if (rating.ok && ctx?.waitUntil) {
    ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
    ctx.waitUntil(writeImdbRatingCacheEntries(ctx, url, {
      ...rating,
      type,
      tmdbId,
      imdbId
    }));
  }
  return response;
}

/* =============================================================================
   v10.152: YouTube Data API endpoints — drive the Most Anticipated hype score.

   /api/youtube/videos?ids=id1,id2,...
     Batch-fetches statistics + snippet for up to 50 YouTube video IDs.
     Returns a clean array of { videoId, channelId, channelTitle, title,
     publishedAt, viewCount, likeCount, commentCount }. 1 quota unit per call.

   /api/youtube/comments?videoId=ID
     Fetches the top 100 top-level comment threads (ordered by relevance,
     i.e. by like count). Returns { items: [{ commentId, likeCount,
     replyCount }], totalCommentLikes }. 1 quota unit per call.

   Both cached at the Cloudflare edge for 6 hours per response (trailer view
   counts move slowly enough that 6h is a fair tradeoff between freshness
   and quota usage). Errors fall through with empty payloads — never block
   the ranking pipeline.
   ============================================================================= */
async function runYoutubeVideosEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  const rawIds = String(url.searchParams.get("ids") || "").trim();
  if (!rawIds) return jsonResponse({ ok: false, error: "Missing ids parameter." }, 400);

  const config = getYoutubeClientConfig(env);
  if (!config.value) {
    return jsonResponse({
      ok: false,
      error: `YouTube API key is not configured. Add it as a Cloudflare Worker secret named ${YOUTUBE_ENV_NAMES[0]}.`,
      youtube: getYoutubePublicStatus(env)
    }, 500);
  }

  const idList = rawIds.split(",").map(id => id.trim()).filter(Boolean).slice(0, 50);
  if (!idList.length) return jsonResponse({ ok: false, error: "No valid video IDs." }, 400);

  /* Sort the IDs for a stable cache key so two requests with the same IDs
     in different order hit the same cache entry. */
  const cacheKey = new Request(`${url.origin}/__screenlist_youtube_videos/v1/${idList.slice().sort().join(",")}`, { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("x-screenlist-youtube-cache", "HIT");
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }

  const ytUrl = new URL(`${YOUTUBE_ORIGIN}videos`);
  ytUrl.searchParams.set("part", "statistics,snippet");
  ytUrl.searchParams.set("id", idList.join(","));
  ytUrl.searchParams.set("key", config.value);

  const result = await fetchJsonWithTimeout(ytUrl, {}, 8000);
  const data = result.data && typeof result.data === "object" ? result.data : {};

  if (!result.ok) {
    return jsonResponse({
      ok: false,
      error: (data && data.error && data.error.message) || result.error || "YouTube videos request failed.",
      status: result.status,
      youtube: getYoutubePublicStatus(env)
    }, result.status >= 400 && result.status < 600 ? result.status : 502);
  }

  const items = Array.isArray(data.items) ? data.items.map(item => {
    const stats = (item && item.statistics) || {};
    const snip = (item && item.snippet) || {};
    return {
      videoId: item.id || "",
      channelId: snip.channelId || "",
      channelTitle: snip.channelTitle || "",
      title: snip.title || "",
      publishedAt: snip.publishedAt || "",
      viewCount: Number(stats.viewCount || 0),
      likeCount: Number(stats.likeCount || 0),
      commentCount: Number(stats.commentCount || 0)
    };
  }) : [];

  const response = jsonResponse({
    ok: true,
    items,
    requested: idList.length,
    returned: items.length
  }, 200, {
    "Cache-Control": `public, max-age=${SCREENLIST_YOUTUBE_CACHE_TTL_SECONDS}`,
    "x-screenlist-youtube-cache": "MISS"
  });

  if (ctx && ctx.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

/* v10.164: YouTube search fallback for titles where TMDB has wrong/
   missing trailer IDs (e.g. The Odyssey was tagged with War of the
   Worlds' YouTube key, Avatar Aang has zero trailers cataloged, etc.).
   100 quota units per call — expensive — so it's gated client-side
   and cached at the edge for 24 hours. Returns top 10 search results
   with channelTitle so the client can filter to studio channels. */
async function runYoutubeSearchEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  const query = String(url.searchParams.get("q") || "").trim();
  if (!query) return jsonResponse({ ok: false, error: "Missing q parameter." }, 400);

  const config = getYoutubeClientConfig(env);
  if (!config.value) {
    return jsonResponse({
      ok: false,
      error: `YouTube API key is not configured. Add it as a Cloudflare Worker secret named ${YOUTUBE_ENV_NAMES[0]}.`,
      youtube: getYoutubePublicStatus(env)
    }, 500);
  }

  const SEARCH_CACHE_TTL = 60 * 60 * 24;
  const cacheKey = new Request(`${url.origin}/__screenlist_youtube_search/v1/${encodeURIComponent(query.toLowerCase())}`, { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("x-screenlist-youtube-cache", "HIT");
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }

  const ytUrl = new URL(`${YOUTUBE_ORIGIN}search`);
  ytUrl.searchParams.set("part", "snippet");
  ytUrl.searchParams.set("q", query);
  ytUrl.searchParams.set("type", "video");
  ytUrl.searchParams.set("maxResults", "10");
  ytUrl.searchParams.set("order", "relevance");
  ytUrl.searchParams.set("safeSearch", "moderate");
  ytUrl.searchParams.set("key", config.value);

  const result = await fetchJsonWithTimeout(ytUrl, {}, 8000);
  const data = result.data && typeof result.data === "object" ? result.data : {};

  if (!result.ok) {
    return jsonResponse({
      ok: false,
      error: (data && data.error && data.error.message) || result.error || "YouTube search request failed.",
      status: result.status,
      youtube: getYoutubePublicStatus(env)
    }, result.status >= 400 && result.status < 600 ? result.status : 502);
  }

  const items = Array.isArray(data.items) ? data.items.map(item => {
    const id = item && item.id;
    const snip = (item && item.snippet) || {};
    return {
      videoId: id && id.videoId ? id.videoId : "",
      channelId: snip.channelId || "",
      channelTitle: snip.channelTitle || "",
      title: snip.title || "",
      publishedAt: snip.publishedAt || ""
    };
  }).filter(v => v.videoId) : [];

  const response = jsonResponse({
    ok: true,
    items,
    query
  }, 200, {
    "Cache-Control": `public, max-age=${SEARCH_CACHE_TTL}`,
    "x-screenlist-youtube-cache": "MISS"
  });

  if (ctx && ctx.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

/* v10.165: Recent uploads from a specific YouTube channel.
   Uses the channel's "uploads" playlist (UU{rest} when the channel ID
   is UC{rest}) which is 1 quota unit per call — 100× cheaper than
   `search.list?channelId=...` (100 units). For 20+ studio channels this
   is ~20 units total per refresh. Returns the most recent N videos
   with title + publishedAt + channelTitle so the client can extract
   the movie/show title and match it to TMDB for metadata. */
async function runYoutubeChannelUploadsEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  const channelId = String(url.searchParams.get("channelId") || "").trim();
  if (!channelId) return jsonResponse({ ok: false, error: "Missing channelId parameter." }, 400);
  if (!/^UC[A-Za-z0-9_-]{16,30}$/.test(channelId)) {
    return jsonResponse({ ok: false, error: "channelId must be a YouTube channel ID starting with UC." }, 400);
  }
  const maxResults = Math.min(50, Math.max(1, Number(url.searchParams.get("maxResults") || 50)));

  const config = getYoutubeClientConfig(env);
  if (!config.value) {
    return jsonResponse({
      ok: false,
      error: `YouTube API key is not configured. Add it as a Cloudflare Worker secret named ${YOUTUBE_ENV_NAMES[0]}.`,
      youtube: getYoutubePublicStatus(env)
    }, 500);
  }

  /* The uploads playlist for any channel UCxxx is UUxxx. Stable trick
     since YouTube launched — saves the cost of a separate channel.list
     call to discover the uploads playlist ID. */
  const uploadsPlaylistId = `UU${channelId.slice(2)}`;

  /* v10.167: TTL 6h → 24h. Once per UTC day per studio channel is
     plenty of refresh — studios upload 1-3 trailers per day max, and
     we already cap at 50 most recent. Longer TTL means we burn quota
     for a channel's uploads at most once every 24 hours regardless
     of how many users open Most Anticipated. */
  const CHANNEL_UPLOADS_CACHE_TTL = 60 * 60 * 24;
  const cacheKey = new Request(`${url.origin}/__screenlist_youtube_channel_uploads/v1/${channelId}/${maxResults}`, { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("x-screenlist-youtube-cache", "HIT");
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }

  const ytUrl = new URL(`${YOUTUBE_ORIGIN}playlistItems`);
  ytUrl.searchParams.set("part", "snippet");
  ytUrl.searchParams.set("playlistId", uploadsPlaylistId);
  ytUrl.searchParams.set("maxResults", String(maxResults));
  ytUrl.searchParams.set("key", config.value);

  const result = await fetchJsonWithTimeout(ytUrl, {}, 8000);
  const data = result.data && typeof result.data === "object" ? result.data : {};

  if (!result.ok) {
    return jsonResponse({
      ok: false,
      error: (data && data.error && data.error.message) || result.error || "YouTube channel uploads request failed.",
      status: result.status,
      youtube: getYoutubePublicStatus(env)
    }, result.status >= 400 && result.status < 600 ? result.status : 502);
  }

  const items = Array.isArray(data.items) ? data.items.map(item => {
    const snip = (item && item.snippet) || {};
    const resourceId = snip.resourceId || {};
    return {
      videoId: resourceId.videoId || "",
      channelId: snip.channelId || channelId,
      channelTitle: snip.channelTitle || "",
      title: snip.title || "",
      publishedAt: snip.publishedAt || ""
    };
  }).filter(v => v.videoId) : [];

  const response = jsonResponse({
    ok: true,
    items,
    channelId,
    count: items.length
  }, 200, {
    "Cache-Control": `public, max-age=${CHANNEL_UPLOADS_CACHE_TTL}`,
    "x-screenlist-youtube-cache": "MISS"
  });

  if (ctx && ctx.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

/* v11.672: SAFE YouTube Data API diagnostic — GET /api/youtube/diag
   Confirms (a) the YOUTUBE_API_KEY secret is set on the Worker and (b) the
   Worker can actually reach googleapis.com/youtube AND the key is valid, by
   doing one server-side channels.list (1 quota unit) against a known channel.
   The key NEVER appears in the response: we return only the secret NAME, an
   ok/exists/succeeded flag set, the HTTP status, and (on success) the public
   channel title + id. Any error text is key-scrubbed defensively. Defaults to
   the Marvel Rivals channel; override with ?channelId=UC... or ?handle=Name.
   Exists purely to debug the Worker-side path the news collector relies on —
   safe to delete once the Data API ingestion is confirmed healthy. */
async function runYoutubeDiagnosticEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  const handle = String(url.searchParams.get("handle") || "").trim();
  const channelIdParam = String(url.searchParams.get("channelId") || "").trim();
  const channelId = /^UC[A-Za-z0-9_-]{16,30}$/.test(channelIdParam)
    ? channelIdParam
    : "UCWzmOSSiSPbVnVu3ZAyDx2w"; // Marvel Rivals (known-good test channel)

  const config = getYoutubeClientConfig(env);
  const out = {
    ok: false,
    secretExists: !!config.value,
    envName: config.name || "",            // NAME only — never the key value
    acceptedEnvNames: YOUTUBE_ENV_NAMES,
    fetchSucceeded: false,
    httpStatus: 0,
    channelTitle: "",
    channelId: "",
    testedVia: handle ? `forHandle=${handle}` : `id=${channelId}`,
    error: ""
  };
  const safeHeaders = { "Cache-Control": "no-store", "x-screenlist-youtube-cache": "BYPASS-DIAG" };
  // Defensive: strip the key from any surfaced text (Google never echoes it).
  const scrub = (s) => config.value ? String(s || "").split(config.value).join("[redacted]") : String(s || "");

  if (!config.value) {
    out.error = `YouTube API key secret is not set on the Worker. Add it as a Cloudflare Worker secret named ${YOUTUBE_ENV_NAMES[0]}.`;
    return jsonResponse(out, 200, safeHeaders);
  }

  /* ?collector=1 — run the EXACT news collector the 2-hourly refresh uses
     (collectYouTubeApiItems → collectYouTubeApiChannel, one playlistItems call
     per channel) and report per-source item COUNTS only — never titles/content.
     This is the direct, KV-cycle-independent test of whether the 5 first-party
     game channels actually ingest from inside the Worker. */
  if (url.searchParams.get("collector") === "1") {
    let items = [];
    let collectorError = "";
    try { items = await collectYouTubeApiItems(env); }
    catch (e) { collectorError = scrub(errorMessage(e)); }
    const bySource = {};
    for (const it of (Array.isArray(items) ? items : [])) {
      const s = (it && it.source) || "?";
      bySource[s] = (bySource[s] || 0) + 1;
    }
    return jsonResponse({
      ok: (Array.isArray(items) ? items.length : 0) > 0,
      mode: "collector",
      secretExists: true,
      envName: config.name || "",
      expectedChannels: NEWS_YT_API_CHANNELS.map(c => c.source),
      collectorItemCount: Array.isArray(items) ? items.length : 0,
      bySource,
      error: collectorError
    }, 200, safeHeaders);
  }

  /* ?refreshcache=1 — run refreshYouTubeApiCache in THIS (fresh-budget) invocation
     to (re)populate the KV YT cache that collectNewsItems merges from. Also used to
     bootstrap the cache right after deploy so videos appear without waiting for the
     30-minute cron. Reports the count written + what's now cached. */
  if (url.searchParams.get("refreshcache") === "1") {
    const result = await refreshYouTubeApiCache(env);
    const cached = await readYouTubeApiCacheItems(env);
    const bySource = {};
    for (const it of cached) { const s = (it && it.source) || "?"; bySource[s] = (bySource[s] || 0) + 1; }
    return jsonResponse({
      ok: !!result.ok, mode: "refreshcache",
      written: result.count || 0, refreshError: result.error || "",
      cachedNow: cached.length, bySource
    }, 200, safeHeaders);
  }

  /* ?pipeline=1 — reproduce the EXACT collectNewsItems pipeline (RSS + the YT
     Data API collector run CONCURRENTLY in one Promise.all, then the real
     filterNewsEligibleItems + dedupeNewsItems) and report how many YT-channel
     items survive each stage. This isolates whether the videos are lost at
     COLLECTION (concurrency starving the fetches), at the ELIGIBILITY filter,
     or at DEDUP — the three server-side stages between the collector and the
     stored games list. Counts only; no titles beyond a tiny debug sample. */
  if (url.searchParams.get("pipeline") === "1") {
    const ytSet = new Set(NEWS_YT_API_CHANNELS.map(c => c.source));
    const countYt = (arr) => (Array.isArray(arr) ? arr : []).filter(it => it && ytSet.has(it.source)).length;
    /* Run the REAL pipeline (collectNewsItems = RSS + providers, THEN the
       sequential YT collector, then filter + dedup) and report how many YT-channel
       videos survive into the merged set + the games subset. Post-v11.674-fix this
       should be ~70 in games, not 0. */
    const merged = await collectNewsItems(env);
    const gamesAfter = (Array.isArray(merged) ? merged : []).filter(it => it && it.category === "games");
    const bySourceYtGames = {};
    for (const it of gamesAfter) { if (ytSet.has(it.source)) bySourceYtGames[it.source] = (bySourceYtGames[it.source] || 0) + 1; }
    return jsonResponse({
      ok: countYt(gamesAfter) > 0,
      mode: "pipeline",
      mergedTotal: Array.isArray(merged) ? merged.length : 0,
      gamesTotal: gamesAfter.length,
      ytInMerged: countYt(merged),
      ytInGames: countYt(gamesAfter),
      bySourceYtGames,
      ytGamesSample: gamesAfter.filter(it => ytSet.has(it.source)).slice(0, 4).map(it => ({
        source: it.source, title: String(it.title || "").slice(0, 48), publishedAt: it.publishedAt, hasImage: !!it.image, id: it.id
      }))
    }, 200, safeHeaders);
  }

  /* ?pipeline=2 — run the RSS storm FIRST, then probe each YT channel
     SEQUENTIALLY with full per-fetch status. Tells us the exact failure mode of
     a googleapis fetch made later in a request that already did ~50 subrequests:
     if status=0/timeout → connection/subrequest-budget exhaustion; if 403/429 →
     quota; if 200 → the problem is only the collector's internal 5-way Promise.all. */
  if (url.searchParams.get("pipeline") === "2") {
    const rss = await collectRssItems().catch(() => []);
    const probes = [];
    for (const ch of NEWS_YT_API_CHANNELS) {
      const u2 = new URL(`${YOUTUBE_ORIGIN}playlistItems`);
      u2.searchParams.set("part", "snippet");
      u2.searchParams.set("playlistId", `UU${ch.channelId.slice(2)}`);
      u2.searchParams.set("maxResults", "5");
      u2.searchParams.set("key", config.value);
      const r = await fetchJsonWithTimeout(u2, {}, 12000);
      probes.push({
        source: ch.source, status: r.status, ok: r.ok,
        items: (r.data && r.data.items && r.data.items.length) || 0,
        error: scrub(r.error || (r.data && r.data.error && r.data.error.message) || "")
      });
    }
    return jsonResponse({ ok: true, mode: "pipeline2", rssCount: Array.isArray(rss) ? rss.length : 0, probesAfterRss: probes }, 200, safeHeaders);
  }

  const ytUrl = new URL(`${YOUTUBE_ORIGIN}channels`);
  ytUrl.searchParams.set("part", "snippet");
  if (handle) ytUrl.searchParams.set("forHandle", handle);
  else ytUrl.searchParams.set("id", channelId);
  ytUrl.searchParams.set("key", config.value);

  const result = await fetchJsonWithTimeout(ytUrl, {}, 8000);
  const data = (result.data && typeof result.data === "object") ? result.data : {};
  out.httpStatus = result.status;

  if (!result.ok) {
    out.error = scrub((data.error && data.error.message) || result.error || "YouTube request failed.");
    return jsonResponse(out, 200, safeHeaders);
  }

  out.fetchSucceeded = true;
  const first = Array.isArray(data.items) && data.items[0] ? data.items[0] : null;
  if (!first) {
    out.error = "Request succeeded (HTTP 200) but no channel matched the test query.";
    return jsonResponse(out, 200, safeHeaders);
  }

  out.ok = true;
  out.channelTitle = (first.snippet && first.snippet.title) || "";
  out.channelId = first.id || channelId;
  /* v11.725: also surface the channel AVATAR (its actual high-res profile picture)
     so outlet logos can use the real channel image, not a favicon. */
  const thumbs = (first.snippet && first.snippet.thumbnails) || {};
  out.channelAvatar = (thumbs.high || thumbs.medium || thumbs.default || {}).url || "";
  return jsonResponse(out, 200, safeHeaders);
}

async function runYoutubeCommentsEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  const videoId = String(url.searchParams.get("videoId") || "").trim();
  if (!videoId) return jsonResponse({ ok: false, error: "Missing videoId." }, 400);

  const config = getYoutubeClientConfig(env);
  if (!config.value) {
    return jsonResponse({
      ok: false,
      error: `YouTube API key is not configured. Add it as a Cloudflare Worker secret named ${YOUTUBE_ENV_NAMES[0]}.`,
      youtube: getYoutubePublicStatus(env)
    }, 500);
  }

  const cacheKey = new Request(`${url.origin}/__screenlist_youtube_comments/v1/${videoId}`, { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("x-screenlist-youtube-cache", "HIT");
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }

  const ytUrl = new URL(`${YOUTUBE_ORIGIN}commentThreads`);
  ytUrl.searchParams.set("part", "snippet");
  ytUrl.searchParams.set("videoId", videoId);
  ytUrl.searchParams.set("order", "relevance");
  ytUrl.searchParams.set("maxResults", "100");
  ytUrl.searchParams.set("key", config.value);

  const result = await fetchJsonWithTimeout(ytUrl, {}, 8000);
  const data = result.data && typeof result.data === "object" ? result.data : {};

  /* Comments-disabled trailers return 403. Treat as zero comment-likes,
     not an error — we don't want to fail the whole hype query just
     because one trailer disabled comments. */
  if (!result.ok) {
    const errors = (data && data.error && Array.isArray(data.error.errors)) ? data.error.errors : [];
    const isCommentsDisabled = errors.some(e => e && (e.reason === "commentsDisabled" || e.reason === "forbidden"));
    if (isCommentsDisabled || result.status === 403) {
      const emptyResponse = jsonResponse({
        ok: true,
        items: [],
        totalCommentLikes: 0,
        threadCount: 0,
        commentsDisabled: true
      }, 200, {
        "Cache-Control": `public, max-age=${SCREENLIST_YOUTUBE_CACHE_TTL_SECONDS}`,
        "x-screenlist-youtube-cache": "MISS-DISABLED"
      });
      if (ctx && ctx.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, emptyResponse.clone()));
      return emptyResponse;
    }
    return jsonResponse({
      ok: false,
      error: (data && data.error && data.error.message) || result.error || "YouTube comments request failed.",
      status: result.status,
      youtube: getYoutubePublicStatus(env)
    }, result.status >= 400 && result.status < 600 ? result.status : 502);
  }

  const threads = Array.isArray(data.items) ? data.items : [];
  let totalCommentLikes = 0;
  const items = threads.map(thread => {
    const snip = (thread && thread.snippet) || {};
    const topComment = (snip.topLevelComment && snip.topLevelComment.snippet) || {};
    const likeCount = Number(topComment.likeCount || 0);
    totalCommentLikes += likeCount;
    return {
      commentId: thread.id || "",
      likeCount,
      replyCount: Number(snip.totalReplyCount || 0)
    };
  });

  const response = jsonResponse({
    ok: true,
    items,
    totalCommentLikes,
    threadCount: items.length
  }, 200, {
    "Cache-Control": `public, max-age=${SCREENLIST_YOUTUBE_CACHE_TTL_SECONDS}`,
    "x-screenlist-youtube-cache": "MISS"
  });

  if (ctx && ctx.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

/* =============================================================================
   v11.756: YouTube COMMENTS SHEET endpoint for the News Feed.

     GET /api/youtube/comment-sheet?videoId=ID[&pageToken=TOKEN]

   Powers the tap-to-open comments sheet on inline News Feed video cards. This
   is SEPARATE from /api/youtube/comments (which only counts likes for the hype
   score) — this one returns full, display-ready comment rows with author,
   avatar, text, like count and timestamp, plus a nextPageToken for "Load more".

   - textFormat=plainText so YouTube returns plain comment text (no HTML); we
     additionally strip any stray tags server-side, and the client escapes again.
   - 20 top (relevance-ordered) comments per page.
   - Comments-disabled videos return { ok:true, items:[], commentsDisabled:true }.
   - Quota / rate-limit errors return ok:false WITHOUT caching, so the client can
     retry. The key never leaves the worker.
   - Cached briefly at the edge (10 min) per videoId+pageToken — top comments
     move fast, but 10 min collapses repeated opens of one video to zero quota.
   ============================================================================= */
function stripCommentHtmlSafe(s) {
  return String(s == null ? "" : s)
    .replace(/<br\s*\/?>/gi, "\n")          // keep line breaks
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")                // drop every other tag
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function runYoutubeCommentSheetEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  const videoId = String(url.searchParams.get("videoId") || "").trim();
  const pageToken = String(url.searchParams.get("pageToken") || "").trim();
  if (!videoId || !/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
    return jsonResponse({ ok: false, error: "Missing or invalid videoId." }, 400);
  }
  /* YouTube comment page tokens are long (~420 chars) opaque base64url-ish
     strings. Bound the length (DoS) and charset (no whitespace/markup), but
     stay permissive — the token is otherwise opaque to us. */
  if (pageToken && (pageToken.length > 4000 || !/^[A-Za-z0-9._\-=%+/]+$/.test(pageToken))) {
    return jsonResponse({ ok: false, error: "Invalid pageToken." }, 400);
  }

  const config = getYoutubeClientConfig(env);
  if (!config.value) {
    return jsonResponse({
      ok: false,
      error: `YouTube API key is not configured. Add it as a Cloudflare Worker secret named ${YOUTUBE_ENV_NAMES[0]}.`,
      youtube: getYoutubePublicStatus(env)
    }, 500);
  }

  const cacheKey = new Request(`${url.origin}/__screenlist_youtube_comment_sheet/v1/${videoId}/${pageToken ? encodeURIComponent(pageToken) : "first"}`, { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("x-screenlist-youtube-cache", "HIT");
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }

  const ytUrl = new URL(`${YOUTUBE_ORIGIN}commentThreads`);
  ytUrl.searchParams.set("part", "snippet");
  ytUrl.searchParams.set("videoId", videoId);
  ytUrl.searchParams.set("order", "relevance");
  ytUrl.searchParams.set("maxResults", "20");
  ytUrl.searchParams.set("textFormat", "plainText");
  if (pageToken) ytUrl.searchParams.set("pageToken", pageToken);
  ytUrl.searchParams.set("key", config.value);

  const result = await fetchJsonWithTimeout(ytUrl, {}, 8000);
  const data = result.data && typeof result.data === "object" ? result.data : {};

  if (!result.ok) {
    const errors = (data && data.error && Array.isArray(data.error.errors)) ? data.error.errors : [];
    const reasons = errors.map(e => (e && e.reason) || "").join(",");
    const isQuota = /quota|rateLimit|dailyLimit|userRateLimit/i.test(reasons) || result.status === 429;
    const isDisabled = /commentsDisabled/i.test(reasons) || (result.status === 403 && !isQuota);
    if (isDisabled) {
      const emptyResponse = jsonResponse({
        ok: true, items: [], nextPageToken: "", commentsDisabled: true, totalResults: 0
      }, 200, {
        "Cache-Control": "public, max-age=600",
        "x-screenlist-youtube-cache": "MISS-DISABLED"
      });
      if (ctx && ctx.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, emptyResponse.clone()));
      return emptyResponse;
    }
    /* DON'T cache errors — let the client retry. */
    return jsonResponse({
      ok: false,
      error: (data && data.error && data.error.message) || result.error || "YouTube comments request failed.",
      quota: isQuota,
      status: result.status
    }, isQuota ? 429 : (result.status >= 400 && result.status < 600 ? result.status : 502));
  }

  const threads = Array.isArray(data.items) ? data.items : [];
  const items = [];
  for (const thread of threads) {
    const snip = (thread && thread.snippet) || {};
    const top = (snip.topLevelComment && snip.topLevelComment.snippet) || {};
    const text = stripCommentHtmlSafe(top.textOriginal || top.textDisplay || "");
    if (!text) continue;                                  // drop blank / unusable rows
    items.push({
      author: String(top.authorDisplayName || "").slice(0, 80),
      avatar: (typeof top.authorProfileImageUrl === "string" && /^https:\/\//i.test(top.authorProfileImageUrl)) ? top.authorProfileImageUrl : "",
      text: text.slice(0, 2000),
      likeCount: Number(top.likeCount || 0),
      publishedAt: top.publishedAt || top.updatedAt || "",
      replyCount: Number(snip.totalReplyCount || 0)
    });
  }

  const response = jsonResponse({
    ok: true,
    items,
    nextPageToken: data.nextPageToken || "",
    commentsDisabled: false,
    totalResults: (data.pageInfo && data.pageInfo.totalResults) || items.length
  }, 200, {
    "Cache-Control": "public, max-age=600",
    "x-screenlist-youtube-cache": "MISS"
  });

  if (ctx && ctx.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

/* =============================================================================
   v11.084: Trailer Views pipeline for Movie / TV full-page media profiles.

     GET /api/youtube/trailer-views?mediaType=movie&tmdbId=123
         &imdbId=tt123&title=Title&year=2024[&debug=1]

   Resolves a title's OFFICIAL trailer videos, sums their YouTube view counts,
   and returns a single clean total ("18.4M") for display on the media profile.
   The entire pipeline runs server-side so the YouTube key never reaches the
   client, and the final aggregated number is edge-cached for 48h so opening a
   profile costs no quota on a warm cache.

   Accuracy model — we never blindly trust the first YouTube hit:
     1. Candidate discovery
          a. TMDB videos for the tmdbId → YouTube Trailer/Teaser keys whose
             name passes the real-trailer regex (drops micro-clips / quote
             cards). These come pre-tagged official=true by TMDB.
          b. Fallback (only if a yields nothing usable): YouTube search
             `"{title}" official trailer {year}` — 100 quota units, so it's
             gated behind a cold cache + an empty TMDB pass.
     2. videos.list stats (views + channel + snippet) for the candidate IDs.
     3. Per-candidate hard filters + scoring:
          - trusted channel REQUIRED (verified channelId = strong, or a
            specific studio/network keyword in the channelTitle = medium).
            channelTrust 0 → rejected outright. No fan uploads.
          - title must read like an official trailer/teaser.
          - title must NOT contain reaction / review / fan / clip / etc.
          - token overlap with the real media title (kills same-name wrong
            titles, e.g. a 2010 "It" vs the 2017 film).
          - publish year near the release window → soft confidence bonus.
     4. Sum the top 5 accepted candidates by views (dedup by id).
     5. Confidence high/medium; if nothing trusted survives → ok:false so the
        client shows NOTHING (never "0 views" / placeholder).

   NOTE on data-source priority: OMDb/IMDb remains the authority for ratings,
   votes and audience-confidence numbers everywhere else in the app. This
   endpoint only owns trailer VIEW COUNTS, for which YouTube is the source of
   truth. TMDB is used here purely for metadata (trailer keys + IMDb id), never
   for any rating/vote/popularity number. */

/* Verified studio / network YouTube channel IDs (channel names change, IDs
   don't). Seeded from the production-verified set in 22-youtube-hype.js. To
   trust a new channel, append its UC… id here — keyword matching below covers
   the rest. */
const TRAILER_TRUSTED_CHANNEL_IDS = new Set([
  "UCvC4D8onUfXzvjTOM-dBfEA", // Marvel Entertainment
  "UCuaFvcY4MhZY3U43mMt1dYQ", // Walt Disney Studios
  "UCz97F7dMxBNOfGYu3rx8aCw", // Sony Pictures Entertainment
  "UCjmJDM5pRKbUlVIzDYYWb6g", // Warner Bros. Pictures
  "UCq0OueAsdxH6b8nyAspwViw", // Universal Pictures
  "UCF9imwPMSGz4Vq1NiTWCC7g", // Paramount Pictures
  "UC2-BeLxzUBSs0uSrmzWhJuQ", // 20th Century Studios
  "UCqzPxvUEXkkPNvqamPj1WoQ", // Lucasfilm
  "UCZGYJFUizSax-yElQaFDp5Q", // Star Wars (official brand channel — posts its own trailers, not Lucasfilm/Disney)
  "UCWMpkGv8Mn80SLrqwx9irPg", // A24
  "UCJ6nMHaJPZvsJ-HmUmj1SeA", // Lionsgate Movies
  "UCQTpc7T1ROvvWxgQrZBHy9w", // Searchlight Pictures
  "UCpzAU99GghOI2_xCBdSFFwQ", // Focus Features
  "UC4ywBfPnGEsiH4tnTwLZHmw", // MGM Studios
  "UCdh4kZ-OxLAKMl4uvOg9hyA", // Blumhouse
  "UCsCk62yLn7v97p7CYNkadKw", // Legendary
  "UCWOA1ZGywLbqmigxE4Qlvuw", // Netflix
  "UCVTQuK2CaWaTgSsoNkn5AiQ", // HBO Max
  "UC1Myj674wRVXB9I4c6Hm5zA", // Apple TV
  "UCQJWtTnAHhEG5w4uN0udnUQ", // Amazon Prime Video
  "UC58SPyofXXqxg0u2nT91WeQ", // Disney+
  "UCNN9XQv0nVfumIuLuB4Yj-A", // Max
  "UCqqHJ1XLcgaT2nPMC6kJ-FA", // Peacock
  "UCMmaBzfCCwZ2KqaBJjkj0fw", // Hulu
  "UCi8e0iOVk1fEOogdfu4YgfA", // Rotten Tomatoes Trailers
  // v11.089: anime trailer channels (anime "Views" — Jikan-sourced titles).
  "UC6pGDc4bFGD1_36IKv3FnYg", // Crunchyroll
  "UCwVgVTLNxd-S6h0LXqfhJsg", // Aniplex of America
  "UCgF6X5wWXl1Lcb4FQRPHB6w", // TOHO animation
]);

/* Specific brand tokens — a channelTitle containing one of these is trusted as
   official/studio (medium trust). Deliberately excludes ultra-generic words
   like "official"/"pictures"/"films"/"trailers" that fan/aggregator channels
   also use — accuracy over coverage. */
const TRAILER_STUDIO_KEYWORDS = [
  "marvel", "walt disney", "disney studios", "pixar", "warner bros", "wb pictures",
  "sony pictures", "universal pictures", "paramount", "netflix", "a24", "lucasfilm",
  "20th century", "20thcentury", "hbo", "apple tv", "amazon mgm", "amazon prime",
  "prime video", "lionsgate", "searchlight", "focus features", "columbia pictures",
  "legendary", "blumhouse", "screen gems", "illumination", "dreamworks",
  "rotten tomatoes", "ign movie", "fx networks", "showtime", "neon",
  "amc", "starz", "peacock", "hulu",
  /* v11.089: anime distributors (Jikan-sourced anime trailers). */
  "crunchyroll", "aniplex", "toho animation", "funimation", "muse asia", "ani-one", "medialink",
  /* v11.085: trusted trailer aggregators. Matched by name so every KinoCheck
     sub-channel (International / .com / Indie / Horror) and Moviefone qualify.
     These mirror official trailers, which is exactly the coverage we want for
     indie / foreign / smaller titles whose distributor never uploaded to a big
     studio channel. Per spec, all accepted trailer views are summed into the
     total (no cap), so a title carried only by aggregators still gets a number. */
  "moviefone", "kinocheck"
];

/* Title must read like a trailer/teaser. */
const TRAILER_NAME_INCLUDE_PATTERN = /\b(trailer|teaser|first\s+look)\b/i;
/* Strong "official trailer" wording (extra confidence). */
const TRAILER_NAME_OFFICIAL_PATTERN = /\b(official\s+trailer|final\s+trailer|main\s+trailer|official\s+teaser|teaser\s+trailer|red\s+band\s+trailer)\b/i;
/* Hard-reject wording — contains "trailer" but isn't one. */
const TRAILER_NAME_EXCLUDE_PATTERN = /\b(reaction|review|breakdown|ending\s+explained|explained|fan[\s-]?(made|trailer|edit|cut)|concept(\s+trailer)?|tribute|clip|scene|interview|behind\s+the\s+scenes|making\s+of|soundtrack|music\s+video|recap|parody|honest\s+trailer|hisheh?e?|how\s+it\s+should\s+have\s+ended|commentary|easter\s+eggs|things\s+you\s+missed)\b/i;

function trailerChannelTrustLevel(channelId = "", channelTitle = "") {
  if (channelId && TRAILER_TRUSTED_CHANNEL_IDS.has(channelId)) return 2;
  const t = String(channelTitle || "").toLowerCase();
  if (t && TRAILER_STUDIO_KEYWORDS.some(kw => t.includes(kw))) return 1;
  return 0;
}

function normalizeTrailerMatchText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* Fraction of the media title's significant tokens that appear in the video
   title. Short stop-words are ignored so "The Batman" still matches cleanly. */
function trailerTitleOverlap(mediaTitle = "", videoTitle = "") {
  const STOP = new Set(["the", "a", "an", "of", "and", "to", "in", "part"]);
  const mediaTokens = normalizeTrailerMatchText(mediaTitle).split(" ").filter(w => w && !STOP.has(w));
  if (!mediaTokens.length) return 0;
  const videoTokens = new Set(normalizeTrailerMatchText(videoTitle).split(" ").filter(Boolean));
  let hit = 0;
  for (const tok of mediaTokens) if (videoTokens.has(tok)) hit += 1;
  return hit / mediaTokens.length;
}

function formatTrailerViews(views) {
  const n = Number(views || 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(Math.round(n));
}

/* Pull official YouTube trailer keys out of a TMDB videos.results array,
   name-filtered to drop micro-clips. Mirrors the strict filter in
   22-youtube-hype.js so both pipelines agree on what a "real trailer" is. */
function extractTmdbTrailerKeys(videosResults = []) {
  const out = [];
  const seen = new Set();
  for (const v of (Array.isArray(videosResults) ? videosResults : [])) {
    if (!v || v.site !== "YouTube") continue;
    if (v.official === false) continue;
    const type = String(v.type || "").toLowerCase();
    if (type !== "trailer" && type !== "teaser") continue;
    const name = String(v.name || "");
    if (!TRAILER_NAME_INCLUDE_PATTERN.test(name)) continue;
    const key = String(v.key || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/* Batched videos.list (statistics + snippet) for up to 50 ids per call. */
async function fetchYoutubeVideoStatsForTrailers(env, videoIds = []) {
  const ids = [...new Set((videoIds || []).filter(Boolean))].slice(0, 50);
  if (!ids.length) return [];
  const config = getYoutubeClientConfig(env);
  if (!config.value) return [];
  const ytUrl = new URL(`${YOUTUBE_ORIGIN}videos`);
  ytUrl.searchParams.set("part", "statistics,snippet");
  ytUrl.searchParams.set("id", ids.join(","));
  ytUrl.searchParams.set("key", config.value);
  const result = await fetchJsonWithTimeout(ytUrl.toString(), {}, 8000);
  const data = result.data && typeof result.data === "object" ? result.data : {};
  if (!result.ok || !Array.isArray(data.items)) return [];
  return data.items.map(item => {
    const stats = (item && item.statistics) || {};
    const snip = (item && item.snippet) || {};
    return {
      videoId: item.id || "",
      channelId: snip.channelId || "",
      channelTitle: snip.channelTitle || "",
      title: snip.title || "",
      publishedAt: snip.publishedAt || "",
      viewCount: Number(stats.viewCount || 0)
    };
  }).filter(v => v.videoId);
}

/* YouTube search fallback (100 quota units) — returns up to 10 candidate ids. */
async function searchYoutubeTrailerCandidates(env, query = "") {
  const q = String(query || "").trim();
  if (!q) return [];
  const config = getYoutubeClientConfig(env);
  if (!config.value) return [];
  const ytUrl = new URL(`${YOUTUBE_ORIGIN}search`);
  ytUrl.searchParams.set("part", "snippet");
  ytUrl.searchParams.set("q", q);
  ytUrl.searchParams.set("type", "video");
  ytUrl.searchParams.set("maxResults", "10");
  ytUrl.searchParams.set("order", "relevance");
  ytUrl.searchParams.set("safeSearch", "moderate");
  ytUrl.searchParams.set("key", config.value);
  const result = await fetchJsonWithTimeout(ytUrl.toString(), {}, 8000);
  const data = result.data && typeof result.data === "object" ? result.data : {};
  if (!result.ok || !Array.isArray(data.items)) return [];
  return data.items.map(it => (it && it.id && it.id.videoId) ? it.id.videoId : "").filter(Boolean);
}

async function runYoutubeTrailerViewsEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  const mediaTypeRaw = String(url.searchParams.get("mediaType") || "").trim().toLowerCase();
  const mediaType = mediaTypeRaw === "movie" ? "movie" : (mediaTypeRaw === "tv" ? "tv" : "");
  const tmdbId = String(url.searchParams.get("tmdbId") || "").trim().replace(/[^0-9]/g, "");
  let imdbId = String(url.searchParams.get("imdbId") || "").trim();
  const title = String(url.searchParams.get("title") || "").trim();
  const year = String(url.searchParams.get("year") || "").trim().slice(0, 4);
  const debug = url.searchParams.get("debug") === "1";

  if (!mediaType) {
    return jsonResponse({ ok: false, reason: "invalid_media_type", error: "mediaType must be movie or tv." }, 400);
  }
  if (!tmdbId && !title) {
    return jsonResponse({ ok: false, reason: "missing_identifiers", error: "Provide tmdbId or title." }, 400);
  }

  const config = getYoutubeClientConfig(env);
  if (!config.value) {
    return jsonResponse({
      ok: false,
      reason: "youtube_not_configured",
      error: `YouTube API key is not configured. Add it as a Cloudflare Worker secret named ${YOUTUBE_ENV_NAMES[0]}.`,
      youtube: getYoutubePublicStatus(env)
    }, 500);
  }

  /* Cache key: media type + most stable identifier available. Debug runs
     bypass the cache entirely so they always reflect live data and never
     pollute the production payload. */
  const cacheId = tmdbId
    ? `tmdb:${tmdbId}`
    : `tt:${normalizeTrailerMatchText(title).replace(/\s+/g, "-")}-${year || "x"}`;
  const cacheKey = new Request(`${url.origin}/__screenlist_youtube_trailer_views/${SCREENLIST_TRAILER_VIEWS_CACHE_VERSION}/${mediaType}/${cacheId}`, { method: "GET" });
  if (!debug) {
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("x-screenlist-youtube-cache", "HIT");
      return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
    }
  }

  const debugInfo = debug ? { mediaType, tmdbId, title, year, queries: [], candidates: [], rejected: [] } : null;

  /* ---- Step 1a: TMDB videos → trailer keys + IMDb id (metadata only) ---- */
  let tmdbTitle = title;
  let tmdbYear = year;
  let candidateIds = [];
  let usedSource = "";
  if (tmdbId) {
    const tmdbRes = await fetchTmdbJson(env, `${mediaType}/${tmdbId}`, { append_to_response: "videos,external_ids" });
    const tmdb = tmdbRes.ok && tmdbRes.data && typeof tmdbRes.data === "object" ? tmdbRes.data : null;
    if (tmdb) {
      if (!imdbId) imdbId = String(tmdb.external_ids?.imdb_id || tmdb.imdb_id || "").trim();
      if (!tmdbTitle) tmdbTitle = String(tmdb.title || tmdb.name || "").trim();
      if (!tmdbYear) tmdbYear = String(tmdb.release_date || tmdb.first_air_date || "").slice(0, 4);
      const keys = extractTmdbTrailerKeys(tmdb.videos?.results);
      if (keys.length) {
        candidateIds = keys;
        usedSource = "tmdb-videos";
      }
      if (debugInfo) debugInfo.tmdbTrailerKeys = keys;
    } else if (debugInfo) {
      debugInfo.tmdbError = tmdbRes.error || `status ${tmdbRes.status}`;
    }
  }

  /* ---- Step 1b: YouTube search fallback (only when TMDB gave nothing) ---- */
  let searchUsed = false;
  if (!candidateIds.length) {
    const queryTitle = tmdbTitle || title;
    if (queryTitle) {
      const q = `${queryTitle} official trailer${tmdbYear ? ` ${tmdbYear}` : ""}`;
      if (debugInfo) debugInfo.queries.push(q);
      candidateIds = await searchYoutubeTrailerCandidates(env, q);
      searchUsed = true;
      usedSource = candidateIds.length ? "youtube-search" : "";
    }
  }

  if (!candidateIds.length) {
    const payload = { ok: false, reason: "no_reliable_trailer_match", source: "youtube", videosUsed: 0 };
    if (debugInfo) payload.debug = debugInfo;
    return finalizeTrailerViewsResponse(payload, cacheKey, ctx, debug, false);
  }

  /* ---- Step 2: stats for candidates ---- */
  const stats = await fetchYoutubeVideoStatsForTrailers(env, candidateIds);

  /* ---- Step 3: filter + score ---- */
  const matchTitle = tmdbTitle || title;
  const releaseYearNum = Number(tmdbYear || year || 0);
  const accepted = [];
  for (const s of stats) {
    const channelTrust = trailerChannelTrustLevel(s.channelId, s.channelTitle);
    const vidTitle = s.title || "";
    const includeOk = TRAILER_NAME_INCLUDE_PATTERN.test(vidTitle);
    const excluded = TRAILER_NAME_EXCLUDE_PATTERN.test(vidTitle);
    const overlap = trailerTitleOverlap(matchTitle, vidTitle);
    const isOfficialWording = TRAILER_NAME_OFFICIAL_PATTERN.test(vidTitle);
    const publishedYear = s.publishedAt ? Number(String(s.publishedAt).slice(0, 4)) : 0;
    const yearNear = !!(releaseYearNum && publishedYear && publishedYear >= releaseYearNum - 2 && publishedYear <= releaseYearNum + 1);

    let reject = "";
    if (channelTrust === 0) reject = "untrusted_channel";
    else if (!includeOk) reject = "title_not_trailer";
    else if (excluded) reject = "excluded_keyword";
    else if (overlap < 0.5) reject = "title_mismatch";

    let score = 0;
    if (!reject) {
      score += channelTrust === 2 ? 40 : 20;
      score += isOfficialWording ? 20 : 10;
      score += Math.round(overlap * 30);
      if (yearNear) score += 10;
      if (score < 50) reject = "low_score";
    }

    if (debugInfo) {
      const row = { videoId: s.videoId, channelTitle: s.channelTitle, channelId: s.channelId, title: vidTitle, views: s.viewCount, channelTrust, overlap: Number(overlap.toFixed(2)), score, yearNear };
      if (reject) { row.reason = reject; debugInfo.rejected.push(row); }
      else debugInfo.candidates.push(row);
    }

    if (!reject) accepted.push({ ...s, channelTrust, overlap, isOfficialWording, score });
  }

  if (!accepted.length) {
    const payload = { ok: false, reason: "no_reliable_trailer_match", source: "youtube", videosUsed: 0 };
    if (debugInfo) payload.debug = debugInfo;
    return finalizeTrailerViewsResponse(payload, cacheKey, ctx, debug, true);
  }

  /* ---- Step 4: dedupe by video id, sum ALL accepted trailers ---- */
  /* v11.085: per user spec, every trusted/official trailer + teaser found for
     the title is summed into one total (no top-N cap). Dedupe is by YouTube
     video id only, so the SAME upload is never double-counted, but distinct
     official trailers/teasers + trusted-aggregator mirrors all contribute. */
  const byId = new Map();
  for (const a of accepted) if (!byId.has(a.videoId)) byId.set(a.videoId, a);
  const ranked = [...byId.values()].sort((x, y) => Number(y.viewCount || 0) - Number(x.viewCount || 0));
  const totalViews = ranked.reduce((sum, v) => sum + Number(v.viewCount || 0), 0);

  /* ---- Step 5: confidence ---- */
  const hasStrong = ranked.some(v => v.channelTrust === 2 && v.overlap >= 0.6 && v.isOfficialWording);
  const confidence = hasStrong ? "high" : "medium";

  if (totalViews <= 0) {
    const payload = { ok: false, reason: "no_reliable_trailer_match", source: "youtube", videosUsed: 0 };
    if (debugInfo) payload.debug = debugInfo;
    return finalizeTrailerViewsResponse(payload, cacheKey, ctx, debug, true);
  }

  const payload = {
    ok: true,
    totalViews,
    displayViews: formatTrailerViews(totalViews),
    videosUsed: ranked.length,
    source: searchUsed && usedSource === "youtube-search" ? "youtube-search" : "youtube",
    resolvedVia: usedSource || "youtube",
    confidence,
    updatedAt: new Date().toISOString(),
    videos: ranked.slice(0, 12).map(v => ({ videoId: v.videoId, channelTitle: v.channelTitle, title: v.title, views: v.viewCount }))
  };
  if (debugInfo) payload.debug = debugInfo;
  return finalizeTrailerViewsResponse(payload, cacheKey, ctx, debug, true);
}

/* Shared response writer for the trailer-views endpoint. Both ok and
   not-reliable results are cached (negative caching stops us re-searching a
   title that has no trustworthy trailer every 48h), except in debug mode. */
function finalizeTrailerViewsResponse(payload, cacheKey, ctx, debug, cacheable) {
  const response = jsonResponse(payload, 200, {
    "Cache-Control": debug ? "no-store" : `public, max-age=${SCREENLIST_TRAILER_VIEWS_CACHE_TTL_SECONDS}`,
    "x-screenlist-youtube-cache": debug ? "BYPASS-DEBUG" : "MISS"
  });
  if (!debug && cacheable && ctx && ctx.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

/* v11.017: Fetch a TV season's per-episode IMDb ratings via OMDb in ONE
   request. OMDb `?i={imdbId}&Season={n}` returns:
     { Title, Season, totalSeasons, Episodes: [{ Title, Released, Episode,
       imdbRating, imdbID }] }
   We normalize the Episode list into `{ episode, imdbRating, imdbId,
   released }` and compute a simple-mean season average. Per-episode
   `imdbVotes` is NOT in the season list — only the per-title lookup
   returns votes. We accept that trade-off: one network call patches an
   entire season; the season-card chip + each episode-row chip get the
   correct IMDb 10-scale ratings, which the client divides by 2 for the
   app's 5-star scale. */
async function fetchOmdbSeasonEpisodes(env, imdbId = "", season = 0, timeoutMs = 6500) {
  const config = getOmdbClientConfig(env);
  const cleanImdbId = normalizeImdbTitleId(imdbId);
  const seasonNum = Number(season || 0);
  if (!config.value) {
    return { ok: false, status: 500, error: getOmdbConfigError(env), omdb: getOmdbPublicStatus(env) };
  }
  if (!cleanImdbId) {
    return { ok: false, status: 400, error: "Missing IMDb title id.", omdb: getOmdbPublicStatus(env) };
  }
  if (!(seasonNum > 0)) {
    return { ok: false, status: 400, error: "Season number must be a positive integer.", omdb: getOmdbPublicStatus(env) };
  }
  const url = new URL(OMDB_ORIGIN);
  url.searchParams.set("i", cleanImdbId);
  url.searchParams.set("Season", String(seasonNum));
  url.searchParams.set("apikey", config.value);
  url.searchParams.set("r", "json");
  const result = await fetchJsonWithTimeout(url, {}, timeoutMs);
  const data = result.data && typeof result.data === "object" ? result.data : {};
  if (!result.ok || data.Response === "False") {
    return {
      ok: false,
      status: result.status || 502,
      error: data.Error || result.error || "OMDb season lookup failed.",
      imdbId: cleanImdbId,
      season: seasonNum,
      omdb: getOmdbPublicStatus(env)
    };
  }
  const rawEpisodes = Array.isArray(data.Episodes) ? data.Episodes : [];
  const episodes = rawEpisodes.map(ep => {
    const epNum = Number(String(ep?.Episode || "").trim());
    const rating = normalizeOmdbRating(ep?.imdbRating);
    return {
      episode: Number.isFinite(epNum) ? epNum : 0,
      imdbRating: rating || "",
      imdbId: normalizeImdbTitleId(ep?.imdbID || "") || "",
      released: String(ep?.Released || "").trim(),
      title: String(ep?.Title || "").trim()
    };
  }).filter(e => e.episode > 0);
  const ratedValues = episodes
    .map(e => Number(e.imdbRating || 0))
    .filter(v => v > 0);
  const seasonAverage = ratedValues.length
    ? Number((ratedValues.reduce((a, b) => a + b, 0) / ratedValues.length).toFixed(2))
    : 0;
  return {
    ok: true,
    status: result.status,
    imdbId: cleanImdbId,
    season: seasonNum,
    totalSeasons: Number(String(data.totalSeasons || "0").trim()) || 0,
    title: String(data.Title || "").trim(),
    episodes,
    seasonAverage,
    seasonRatedCount: ratedValues.length,
    provider: "OMDb",
    source: "IMDb",
    omdb: getOmdbPublicStatus(env)
  };
}

/* v11.094: anime episode synopsis + still images via OMDb/IMDb. Jikan's
   episode list has titles + air dates but no plot or still image, so anime
   episode rows looked bare next to TV (which gets stills + overviews from
   TMDB). OMDb fills the gap: resolve the series IMDb id (by title if not
   supplied), list the season's episodes, then fetch each episode's Plot +
   Poster. Cached 30 days — episode plots/images are static. */
async function resolveOmdbSeriesImdbId(env, title = "", year = "") {
  const config = getOmdbClientConfig(env);
  if (!config.value || !title) return "";
  const url = new URL(OMDB_ORIGIN);
  url.searchParams.set("t", title);
  url.searchParams.set("type", "series");
  if (year) url.searchParams.set("y", String(year));
  url.searchParams.set("apikey", config.value);
  url.searchParams.set("r", "json");
  const result = await fetchJsonWithTimeout(url, {}, 6500);
  const data = result.data && typeof result.data === "object" ? result.data : {};
  if (!result.ok || data.Response === "False") return "";
  return normalizeImdbTitleId(data.imdbID || "");
}

async function fetchOmdbEpisodeDetail(env, episodeImdbId = "", timeoutMs = 6500) {
  const config = getOmdbClientConfig(env);
  const id = normalizeImdbTitleId(episodeImdbId);
  if (!config.value || !id) return null;
  const url = new URL(OMDB_ORIGIN);
  url.searchParams.set("i", id);
  url.searchParams.set("plot", "full");
  url.searchParams.set("apikey", config.value);
  url.searchParams.set("r", "json");
  const result = await fetchJsonWithTimeout(url, {}, timeoutMs);
  const data = result.data && typeof result.data === "object" ? result.data : {};
  if (!result.ok || data.Response === "False") return null;
  const plot = String(data.Plot || "").trim();
  const poster = String(data.Poster || "").trim();
  return {
    plot: plot && plot !== "N/A" ? plot : "",
    poster: poster && poster !== "N/A" ? poster : ""
  };
}

async function runOmdbAnimeEpisodesEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  const title = String(url.searchParams.get("title") || "").trim();
  const year = String(url.searchParams.get("year") || "").trim().slice(0, 4);
  const season = Number(url.searchParams.get("season") || 0);
  let imdbId = normalizeImdbTitleId(url.searchParams.get("imdbId") || "");
  if (!(season > 0)) return jsonResponse({ ok: false, error: "Missing or invalid season." }, 400);
  if (!imdbId && !title) return jsonResponse({ ok: false, error: "Provide imdbId or title." }, 400);

  const config = getOmdbClientConfig(env);
  if (!config.value) return jsonResponse({ ok: false, error: getOmdbConfigError(env), omdb: getOmdbPublicStatus(env) }, 500);

  const cacheId = imdbId
    ? imdbId
    : `t:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${year || "x"}`;
  const cacheKey = new Request(`${url.origin}/__screenlist_omdb_anime_episodes/v1/${cacheId}/${season}`, { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("x-screenlist-omdb-anime-cache", "HIT");
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }

  if (!imdbId) imdbId = await resolveOmdbSeriesImdbId(env, title, year);
  if (!imdbId) {
    /* No IMDb match — cache the negative for a day so we don't re-search. */
    return jsonResponse({ ok: false, reason: "no_imdb_match", season, episodes: [] }, 200, { "Cache-Control": "public, max-age=86400" });
  }

  const seasonData = await fetchOmdbSeasonEpisodes(env, imdbId, season);
  if (!seasonData.ok || !Array.isArray(seasonData.episodes) || !seasonData.episodes.length) {
    return jsonResponse({ ok: false, reason: "no_season_data", imdbId, season, episodes: [] }, 200, { "Cache-Control": "public, max-age=86400" });
  }

  /* Per-episode Plot + Poster, concurrency-capped so we stay friendly to OMDb. */
  const eps = seasonData.episodes;
  const CONCURRENCY = 6;
  const merged = [];
  for (let i = 0; i < eps.length; i += CONCURRENCY) {
    const chunk = eps.slice(i, i + CONCURRENCY);
    const details = await Promise.all(chunk.map(e => e.imdbId ? fetchOmdbEpisodeDetail(env, e.imdbId).catch(() => null) : Promise.resolve(null)));
    chunk.forEach((e, idx) => {
      const d = details[idx] || {};
      merged.push({
        episode: e.episode,
        title: e.title || "",
        rating: e.imdbRating || "",
        released: e.released || "",
        plot: d.plot || "",
        poster: d.poster || ""
      });
    });
  }

  const payload = { ok: true, imdbId, season, episodes: merged, provider: "OMDb", source: "IMDb" };
  const response = jsonResponse(payload, 200, {
    "Cache-Control": `public, max-age=${60 * 60 * 24 * 30}`,
    "x-screenlist-omdb-anime-cache": "MISS"
  });
  if (ctx && ctx.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

async function runOmdbSeasonEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  const imdbId = normalizeImdbTitleId(url.searchParams.get("imdbId") || "");
  const season = Number(url.searchParams.get("season") || 0);
  if (!imdbId) return jsonResponse({ ok: false, error: "Missing imdbId." }, 400);
  if (!(season > 0)) return jsonResponse({ ok: false, error: "Missing or invalid season." }, 400);
  /* Cache per imdbId+season. Ratings drift slowly post-release, so a
     longer TTL is fine; we still hard-cap at 7 days to pick up newly
     released episodes within the season's airing window. */
  const cacheKey = new Request(`${url.origin}/__screenlist_omdb_season/v1/${imdbId}/${season}`, { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("x-screenlist-omdb-season-cache", "HIT");
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }
  const data = await fetchOmdbSeasonEpisodes(env, imdbId, season);
  const status = data.ok ? 200 : (data.status >= 400 && data.status < 600 ? data.status : 502);
  /* Shorter TTL while episodes are still releasing this week, longer
     after the season has fully aired. Simple heuristic: if any episode
     is from the last 14 days, 6h cache; otherwise 7 days. */
  let ttl = 60 * 60 * 24 * 7;
  if (data.ok) {
    const now = Date.now();
    const fortnightAgo = now - 14 * 24 * 60 * 60 * 1000;
    const stillAiring = (data.episodes || []).some(ep => {
      const t = Date.parse(ep.released || "");
      return Number.isFinite(t) && t >= fortnightAgo && t <= now + 24 * 60 * 60 * 1000;
    });
    if (stillAiring) ttl = 60 * 60 * 6;
  } else {
    ttl = 60 * 5;
  }
  const response = jsonResponse(data, status, {
    "Cache-Control": `public, max-age=${ttl}`,
    "x-screenlist-omdb-season-cache": "MISS"
  });
  if (data.ok && ctx?.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

/* v671: Parse OMDb's "imdbVotes" string ("828,114") into a number. */
function parseImdbVotesNumber(value = "") {
  const clean = String(value || "").replace(/[^0-9]/g, "");
  if (!clean) return 0;
  const n = Number(clean);
  return Number.isFinite(n) ? n : 0;
}

/* v674: Variable cache TTL based on title recency. New/trending titles
   churn fast (rating + vote-count drift daily during release week), so
   keep them fresh; older titles barely move and can be cached aggressively.
        current year + future        → 24h
        last year                    → 3 days
        last 5 years                 → 7 days
        older / classics             → 30 days
        unknown / unparseable        → 7 days (default) */
/* v10.235: a title counts as a "recent release" (OMDb-snapshot-lag risk) when
   it came out this year or last year. Used to gate the live IMDb-page extract
   so we only spend a Tavily extract where OMDb is actually likely to be stale. */
function isRecentImdbReleaseYear(year) {
  const y = parseInt(String(year || "").trim().slice(0, 4), 10);
  if (!Number.isFinite(y) || y < 1900) return false;
  const currentYear = new Date().getUTCFullYear();
  return y >= currentYear - 1;
}

function getImdbCacheTtlSeconds(year) {
  const y = parseInt(String(year || "").trim().slice(0, 4), 10);
  if (!Number.isFinite(y) || y < 1900) return SCREENLIST_IMDB_RATING_CACHE_TTL_SECONDS;
  const currentYear = new Date().getUTCFullYear();
  if (y >= currentYear) return 60 * 60 * 12;
  if (y >= currentYear - 1) return 60 * 60 * 24;
  if (y >= currentYear - 5) return SCREENLIST_IMDB_RATING_CACHE_TTL_SECONDS;
  return 60 * 60 * 24 * 14;
}

/* v671: Single-item rating fetcher used by the batch endpoint. Hits the
   per-item Cloudflare cache (same key as /api/imdb/rating) so an item that's
   already been resolved once is served from cache here too. Returns a small
   object — not a Response. */
function buildSingleImdbRatingCacheKey(originUrl, type = "tv", tmdbId = "", imdbId = "") {
  return new Request(
    `${originUrl.origin}/__screenlist_imdb_rating/${SCREENLIST_IMDB_RATING_CACHE_VERSION}/${normalizeImdbMediaType(type)}/${String(tmdbId || "").trim() || "no-tmdb"}/${normalizeImdbTitleId(imdbId || "") || "lookup"}`,
    { method: "GET" }
  );
}

async function writeImdbRatingCacheEntries(ctx, originUrl, payload = {}) {
  if (!ctx?.waitUntil || !payload?.ok) return;
  const type = normalizeImdbMediaType(payload.type);
  const tmdbId = String(payload.tmdbId || "").trim();
  const imdbId = normalizeImdbTitleId(payload.imdbId || "");
  const ttl = getImdbCacheTtlSeconds(payload.year);
  const response = new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${ttl}`
    }
  });
  const writes = [];
  if (tmdbId) {
    writes.push(caches.default.put(
      new Request(`${originUrl.origin}/__screenlist_imdb_rating_batch/${SCREENLIST_IMDB_RATING_CACHE_VERSION}/${type}/${tmdbId}`, { method: "GET" }),
      response.clone()
    ));
    writes.push(caches.default.put(buildSingleImdbRatingCacheKey(originUrl, type, tmdbId, ""), response.clone()));
  }
  if (imdbId) {
    writes.push(caches.default.put(
      new Request(`${originUrl.origin}/__screenlist_imdb_rating_batch/${SCREENLIST_IMDB_RATING_CACHE_VERSION}/by-imdb/${imdbId}`, { method: "GET" }),
      response.clone()
    ));
    writes.push(caches.default.put(buildSingleImdbRatingCacheKey(originUrl, type, tmdbId, imdbId), response.clone()));
    writes.push(caches.default.put(buildSingleImdbRatingCacheKey(originUrl, type, "", imdbId), response.clone()));
  }
  if (writes.length) ctx.waitUntil(Promise.allSettled(writes));
}

async function getCachedImdbRatingForItem(env, ctx, originUrl, item = {}, options = {}) {
  const type = normalizeImdbMediaType(item.type);
  const tmdbId = String(item.tmdbId || item.id || "").trim();
  let imdbId = normalizeImdbTitleId(item.imdbId || "");
  const title = String(item.title || item.name || "").trim();
  const year = String(item.year || "").trim().match(/^(18|19|20)\d{2}$/)?.[0] || "";
  const force = options.force === true || options.refresh === true;

  if (!tmdbId && !imdbId && !title) {
    return { ok: false, error: "Missing tmdbId, imdbId, or title.", tmdbId, imdbId, type };
  }

  /* v674: Two-step cache lookup so the same title hits the same entry no
     matter which discover rail it came from.
        1. Check the imdbId-keyed cache if we already have an imdbId.
        2. Otherwise fall back to the (type, tmdbId) key.
     After OMDb resolves we write under BOTH keys so a future direct-imdbId
     lookup (e.g. from the media profile) finds the same entry. */
  const tmdbCacheKey = new Request(
    `${originUrl.origin}/__screenlist_imdb_rating_batch/${SCREENLIST_IMDB_RATING_CACHE_VERSION}/${type}/${tmdbId || "no-tmdb"}`,
    { method: "GET" }
  );
  function imdbCacheKey(id) {
    return new Request(`${originUrl.origin}/__screenlist_imdb_rating_batch/${SCREENLIST_IMDB_RATING_CACHE_VERSION}/by-imdb/${id}`, { method: "GET" });
  }

  async function tryCache(key) {
    try {
      const cached = await caches.default.match(key);
      if (cached) {
        const data = await cached.json();
        return { ...data, cache: "HIT" };
      }
    } catch (e) { /* fall through */ }
    return null;
  }

  if (!force) {
    if (imdbId) {
      const imdbHit = await tryCache(imdbCacheKey(imdbId));
      if (imdbHit) return imdbHit;
    }
    const tmdbHit = await tryCache(tmdbCacheKey);
    if (tmdbHit) return tmdbHit;
  }

  if (!imdbId && tmdbId) {
    try { imdbId = await fetchTmdbExternalImdbId(env, type, tmdbId, 6500); } catch (e) {}
    /* Now that we resolved imdbId, check the imdbId-keyed cache before
       hitting OMDb — another rail may have already populated it. */
    if (!force && imdbId) {
      const imdbHit = await tryCache(imdbCacheKey(imdbId));
      if (imdbHit) return imdbHit;
    }
  }

  /* v11.135: RECENT releases (this/last year) read the LIVE IMDb title page via
     Tavily extract here too — not just on the single /api/imdb/rating endpoint.
     Root cause of the "Obsession shows 3.8 / wrong votes" bug: OMDb's licensed
     snapshot lags live IMDb on fresh titles (e.g. 7.6/694 vs the real 8.2/39K),
     and the batch path wrote that stale value into BOTH the edge cache and the
     client localStorage cache. The media profile then read the poisoned cache
     entry instead of ever calling the accurate single endpoint — so it showed
     3.8 (7.6/2) forever.
       The v11.049 concern (a "Newest Releases" row firing ~60 Tavily /extract
     calls and blowing Cloudflare's subrequest limit) is handled by a per-REQUEST
     budget (`options.liveExtractBudget`): only the first N recent-release items
     in a batch do the live extract; the rest fall back to OMDb. Because every
     successful extract is cached (edge + client) under both the tmdb and imdb
     keys, repeated loads converge to all-accurate within a couple of passes
     without ever exceeding the budget on a single request. Older titles skip the
     extract entirely (their OMDb snapshot is stable). */
  let rating = { ok: false };
  const budget = options.liveExtractBudget;
  const canLiveExtract = imdbId
    && isRecentImdbReleaseYear(year)
    && (!budget || budget.remaining > 0);
  if (canLiveExtract) {
    if (budget) budget.remaining -= 1;
    const liveExtract = await fetchTavilyImdbTitleExtract(env, imdbId);
    if (liveExtract.ok && Number.isFinite(liveExtract.rating)) {
      rating = {
        ok: true,
        imdbRating: liveExtract.rating,
        imdbVotes: liveExtract.votes ?? "",
        imdbId,
        title,
        year,
        ratingSource: "tavily_imdb_extract",
        provider: "Tavily Extract (live IMDb title page)",
        lookup: "imdb"
      };
    }
  }
  if (!rating.ok) {
    rating = imdbId ? await fetchOmdbImdbRating(env, imdbId, 6500) : { ok: false };
  }
  if (!rating.ok && title) {
    rating = await fetchOmdbTitleRating(env, title, type, year, 6500);
  }

  const imdbVotesNumber = parseImdbVotesNumber(rating.imdbVotes);
  const payload = {
    ok: !!rating.ok,
    type,
    tmdbId,
    imdbId: rating.imdbId || imdbId || "",
    imdbRating: rating.imdbRating || 0,
    imdbVotes: rating.imdbVotes || "",
    imdbVotesNumber,
    imdbLogVotes: imdbVotesNumber > 0 ? Math.log10(imdbVotesNumber + 1) : 0,
    title: rating.title || title || "",
    year: rating.year || year || "",
    /* v734: extra metadata shipped to the client filmography card layout. */
    runtime: rating.runtime || "",
    rated: rating.rated || "",
    metascore: rating.metascore || "",
    genre: rating.genre || "",
    plot: rating.plot || "",
    ratingSource: rating.ok ? (rating.ratingSource || (rating.lookup === "title" ? "omdb_title_year" : "omdb_imdb_id")) : "",
    provider: rating.provider || "",
    ratingFetchedAt: Date.now(),
    error: rating.ok ? "" : (rating.error || "Rating not found.")
  };

  if (payload.ok) await writeImdbRatingCacheEntries(ctx, originUrl, payload);

  return { ...payload, cache: "MISS" };
}

/* v671: Batch endpoint — POST {items: [{tmdbId, imdbId, type, title, year}]}.
   Returns {ratings: {[tmdbId|imdbId]: {imdbRating, imdbVotes, imdbVotesNumber, ok}}}
   Concurrency capped to 8 in-flight to avoid hammering OMDb. Per-item 7-day
   Cloudflare cache + this routing endpoint means subsequent calls for the
   same items are served from cache. */
function getImdbBatchResultKey(item = {}, index = 0) {
  const type = normalizeImdbMediaType(item.type);
  const tmdbId = String(item.tmdbId || item.id || "").trim();
  if (tmdbId) return `${type}:${tmdbId}`;
  const imdbId = normalizeImdbTitleId(item.imdbId || "");
  if (imdbId) return `imdb:${imdbId}`;
  return `idx:${index}`;
}

async function runImdbRatingBatchEndpoint(request, env, ctx) {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "POST required." }, 405);
  }
  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const items = Array.isArray(body?.items) ? body.items.slice(0, 50) : [];
  if (!items.length) return jsonResponse({ ok: false, error: "Missing items array." }, 400);

  const url = new URL(request.url);
  const ratings = {};
  const legacyKeyCounts = new Map();
  items.forEach((item, index) => {
    const legacyKey = String(item?.tmdbId || item?.id || item?.imdbId || `idx:${index}`);
    legacyKeyCounts.set(legacyKey, Number(legacyKeyCounts.get(legacyKey) || 0) + 1);
  });
  /* v673: OMDb fair-use guidance suggests modest concurrency. 4 in flight at
     once is the sweet spot — fast enough to clear a 25-item batch in ~3 hops
     and gentle on the upstream. */
  const concurrency = 4;
  /* v11.135: per-REQUEST live-IMDb-extract budget. Recent-release items read the
     live IMDb title page via Tavily for the ACCURATE rating (vs OMDb's lagging
     snapshot that produced the wrong "Obsession 3.8" value), but only up to this
     many per request so a single discovery row can't blow Cloudflare's
     subrequest limit (the v11.049 failure mode). Cached results converge to
     all-accurate over repeated loads without exceeding the cap on any one call. */
  const liveExtractBudget = { remaining: 8 };
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      const item = items[i] || {};
      const result = await getCachedImdbRatingForItem(env, ctx, url, item, { liveExtractBudget });
      const typedKey = getImdbBatchResultKey(item, i);
      const legacyKey = String(item.tmdbId || item.id || item.imdbId || `idx:${i}`);
      ratings[typedKey] = result;
      if (legacyKey && (legacyKey.startsWith("idx:") || legacyKeyCounts.get(legacyKey) === 1)) {
        ratings[legacyKey] = result;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));

  return jsonResponse({
    ok: true,
    count: items.length,
    ratings,
    sources: { imdb: getOmdbPublicStatus(env) }
  }, 200, {
    "Cache-Control": "no-store"
  });
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

function cleanAiJsonText(value = "") {
  return String(value || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function extractAiText(result) {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";
  return result.response ||
    result.result?.response ||
    result.content ||
    result.text ||
    result.choices?.[0]?.message?.content ||
    result.choices?.[0]?.text ||
    "";
}

async function sha256Hex(value) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function runWorkersAi(env, model, systemPrompt, userPrompt, temperature, maxTokens) {
  try {
    return await env.myscreenlistAi.run(model, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature,
      max_tokens: maxTokens
    });
  } catch (chatError) {
    return env.myscreenlistAi.run(model, {
      prompt: `${systemPrompt}\n\n${userPrompt}`,
      temperature,
      max_tokens: maxTokens
    });
  }
}

async function runScreenListAi(request, env, ctx) {
  if (!env.myscreenlistAi || typeof env.myscreenlistAi.run !== "function") {
    return jsonResponse({
      ok: false,
      error: "Workers AI binding missing. Add binding name: myscreenlistAi, type: Workers AI, value: Workers AI Catalog."
    }, 500);
  }

  let payload = {};
  try {
    payload = await request.json();
  } catch (error) {
    return jsonResponse({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const systemPrompt = String(payload.systemPrompt || "Return valid JSON only. No markdown.").trim();
  const userPrompt = String(payload.userPrompt || payload.prompt || "").trim();
  if (!userPrompt) return jsonResponse({ ok: false, error: "Missing userPrompt." }, 400);

  const model = String(payload.model || SCREENLIST_AI_MODEL);
  const temperature = typeof payload.temperature === "number" ? payload.temperature : 0.25;
  const maxTokens = Number.isFinite(Number(payload.max_tokens || payload.maxTokens))
    ? Math.max(64, Math.min(2048, Number(payload.max_tokens || payload.maxTokens)))
    : 1200;

  const cacheBody = JSON.stringify({ model, systemPrompt, userPrompt, temperature, maxTokens });
  const cacheKey = new Request(`${new URL(request.url).origin}/__screenlist_ai_cache/${await sha256Hex(cacheBody)}`, { method: "GET" });

  if (payload.cache !== false) {
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      const response = new Response(cached.body, cached);
      response.headers.set("x-screenlist-ai-cache", "HIT");
      return response;
    }
  }

  try {
    const aiResult = await runWorkersAi(env, model, systemPrompt, userPrompt, temperature, maxTokens);
    const text = cleanAiJsonText(extractAiText(aiResult));
    let body;
    try {
      body = JSON.parse(text);
    } catch (error) {
      body = { content: text, raw: aiResult };
    }

    const response = jsonResponse(body, 200, {
      "Cache-Control": `public, max-age=${SCREENLIST_AI_CACHE_TTL_SECONDS}`,
      "x-screenlist-ai-cache": "MISS"
    });

    if (payload.cache !== false && ctx?.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: error && error.message ? error.message : String(error)
    }, 500);
  }
}

const VISITOR_COOKIE = "msl_vid";
const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const STEAM_STATE_COOKIE = "shelfd_steam_state";
const STEAM_STATE_COOKIE_MAX_AGE = 60 * 10;

function readCookie(request, name) {
  const cookieHeader = request.headers.get("cookie") || "";
  const cookies = cookieHeader.split(/;\s*/);
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

function isHtmlNavigationRequest(request, url) {
  if (request.method !== "GET") return false;
  if (url.pathname.startsWith("/api/")) return false;
  if (/\.[a-z0-9]+$/i.test(url.pathname)) return false;
  const destination = request.headers.get("sec-fetch-dest");
  if (destination === "document") return true;
  const accept = request.headers.get("accept") || "";
  return accept.includes("text/html");
}

function escapeHtmlMeta(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isProfileCardSharePath(url) {
  return /^\/profile-card\/[^/]+\/[^/]+\/[1-3]\/?$/i.test(url.pathname);
}

function isProfileSharePath(url) {
  return /^\/profile\/[^/]+\/?$/i.test(url.pathname);
}

function cleanSharePreviewParam(value = "", fallback = "") {
  const text = String(value || "").trim();
  return text ? text.slice(0, 96) : fallback;
}

function getProfileShareMeta(url) {
  const pathMatch = url.pathname.match(/^\/profile\/([^/?#]+)\/?$/i);
  const uid = decodeURIComponent(pathMatch?.[1] || url.searchParams.get("profile") || "").trim();
  const handle = cleanSharePreviewParam(url.searchParams.get("handle") || "", "");
  const name = cleanSharePreviewParam(url.searchParams.get("name") || "", "Shelfd User");
  const label = handle ? handle.replace(/^@+/, "").toLowerCase() : name;
  const hours = cleanSharePreviewParam(url.searchParams.get("hours") || "", "0h");
  const avg = cleanSharePreviewParam(url.searchParams.get("avg") || "", "N/A");
  const photo = url.searchParams.get("photo") || "";
  const imageUrl = new URL("/profile-og.svg", url.origin);
  if (uid) imageUrl.searchParams.set("uid", uid);
  imageUrl.searchParams.set("handle", label);
  imageUrl.searchParams.set("name", name);
  imageUrl.searchParams.set("hours", hours);
  imageUrl.searchParams.set("avg", avg);
  if (/^https?:\/\//i.test(photo)) imageUrl.searchParams.set("photo", photo);
  return {
    title: `${label} on Shelfd`,
    description: `${hours} watched · ${avg} average rating`,
    url: url.toString(),
    image: imageUrl.toString()
  };
}

function getProfileCardShareMeta(url) {
  const pathMatch = url.pathname.match(/^\/profile-card\/([^/]+)\/([^/]+)\/([1-3])\/?$/i);
  const rank = Number(pathMatch?.[3] || url.searchParams.get("rank") || 1);
  const title = url.searchParams.get("cardTitle") || "ScreenList Top 3";
  const profileName = url.searchParams.get("profileName") || "ScreenList User";
  const label = url.searchParams.get("label") || "Top 3";
  const cardImage = url.searchParams.get("cardImage") || "";
  const shareImg = url.searchParams.get("shareImg") || "";
  const shareTitle = `${profileName}'s ${label}`;
  const shareDescription = `${profileName}'s top picks on Shelfd.`;
  let image;
  if (/^https?:\/\//i.test(shareImg)) {
    image = shareImg;
  } else if (/^https?:\/\//i.test(cardImage)) {
    image = cardImage;
  } else {
    image = new URL("/og-image-v216.png", url.origin).toString();
  }
  return {
    title: shareTitle,
    description: shareDescription,
    url: url.toString(),
    image
  };
}

function replaceMetaTag(html, attribute, key, content) {
  const escaped = escapeHtmlMeta(content);
  const pattern = new RegExp(`<meta\\s+${attribute}="${key}"\\s+content="[^"]*"\\s*\\/?>`, "i");
  const replacement = `<meta ${attribute}="${key}" content="${escaped}">`;
  return pattern.test(html) ? html.replace(pattern, replacement) : html.replace("</head>", `${replacement}\n</head>`);
}

function removeMetaTag(html, attribute, key) {
  const pattern = new RegExp(`<meta\\s+${attribute}="${key}"\\s+content="[^"]*"\\s*\\/?>\\s*`, "ig");
  return html.replace(pattern, "");
}

async function serveProfileCardShareHtml(request, env, url) {
  const indexUrl = new URL("/index.html", url.origin);
  const assetResponse = await env.ASSETS.fetch(new Request(indexUrl.toString(), { method: "GET" }));
  let html = await assetResponse.text();
  if (!html || html.length < 100) {
    return new Response(`<!DOCTYPE html><html><head><title>Shelfd</title></head><body>Asset fetch returned ${html?.length || 0} bytes</body></html>`, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  }
  const meta = getProfileCardShareMeta(url);
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtmlMeta(meta.title)}</title>`);
  html = replaceMetaTag(html, "property", "og:title", meta.title);
  html = replaceMetaTag(html, "property", "og:description", meta.description);
  html = replaceMetaTag(html, "property", "og:url", meta.url);
  html = removeMetaTag(html, "property", "og:image:width");
  html = removeMetaTag(html, "property", "og:image:height");
  html = replaceMetaTag(html, "property", "og:image", meta.image);
  html = replaceMetaTag(html, "property", "og:image:alt", meta.title);
  html = replaceMetaTag(html, "name", "twitter:title", meta.title);
  html = replaceMetaTag(html, "name", "twitter:description", meta.description);
  html = replaceMetaTag(html, "name", "twitter:image", meta.image);
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0"
    }
  });
}

async function serveProfileShareHtml(request, env, url) {
  const indexUrl = new URL("/index.html", url.origin);
  const assetResponse = await env.ASSETS.fetch(new Request(indexUrl.toString(), { method: "GET" }));
  let html = await assetResponse.text();
  const meta = getProfileShareMeta(url);
  if (!html || html.length < 100) html = `<!DOCTYPE html><html><head><title>${escapeHtmlMeta(meta.title)}</title></head><body></body></html>`;
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtmlMeta(meta.title)}</title>`);
  html = replaceMetaTag(html, "property", "og:title", meta.title);
  html = replaceMetaTag(html, "property", "og:description", meta.description);
  html = replaceMetaTag(html, "property", "og:url", meta.url);
  html = replaceMetaTag(html, "property", "og:type", "profile");
  html = removeMetaTag(html, "property", "og:image:width");
  html = removeMetaTag(html, "property", "og:image:height");
  html = replaceMetaTag(html, "property", "og:image", meta.image);
  html = replaceMetaTag(html, "property", "og:image:alt", meta.title);
  html = replaceMetaTag(html, "name", "twitter:card", "summary_large_image");
  html = replaceMetaTag(html, "name", "twitter:title", meta.title);
  html = replaceMetaTag(html, "name", "twitter:description", meta.description);
  html = replaceMetaTag(html, "name", "twitter:image", meta.image);
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0"
    }
  });
}

function isMediaSharePath(url) {
  return /^\/media\/(movie|tv|anime|game)\/[^/]+\/?$/i.test(url.pathname);
}

function isAlbumSharePath(url) {
  return /^\/album\/[^/]+\/[^/]+\/?$/i.test(url.pathname);
}

function isGameProfileSharePath(url) {
  return /^\/game-profile\/[^/]+\/[^/]+\/?$/i.test(url.pathname);
}

function isReviewSharePath(url) {
  return /^\/review\/[^/]+\/?$/i.test(url.pathname);
}

function getReviewShareMeta(url) {
  const title = cleanSharePreviewParam(url.searchParams.get("title") || "", "Shelfd Review");
  const user = cleanSharePreviewParam(url.searchParams.get("user") || "", "");
  const rating = cleanSharePreviewParam(url.searchParams.get("rating") || "", "");
  const section = cleanSharePreviewParam(url.searchParams.get("section") || "", "review");
  const text = String(url.searchParams.get("text") || "").replace(/\s+/g, " ").trim().slice(0, 180);
  const poster = url.searchParams.get("poster") || "";
  const shareTitle = user ? `${user}'s review of ${title}` : `Review of ${title}`;
  const shareDescription = [
    rating ? `Rated ${rating}` : "",
    text ? `"${text}"` : "Open this review in Shelfd."
  ].filter(Boolean).join(" • ");
  const imageUrl = new URL("/review-og.svg", url.origin);
  imageUrl.searchParams.set("title", title);
  if (user) imageUrl.searchParams.set("user", user);
  if (rating) imageUrl.searchParams.set("rating", rating);
  if (section) imageUrl.searchParams.set("section", section);
  if (text) imageUrl.searchParams.set("text", text);
  if (/^https?:\/\//i.test(poster)) imageUrl.searchParams.set("poster", poster);
  return {
    title: shareTitle,
    description: shareDescription,
    url: url.toString(),
    image: imageUrl.toString()
  };
}

async function serveMediaShareHtml(request, env, url) {
  const title = url.searchParams.get("title") || "Shelfd";
  const poster = url.searchParams.get("poster") || "";
  const user = url.searchParams.get("user") || "";
  /* v10.725: /media links are full-page media profiles, not reviews.
     Keep review wording exclusive to /review/{postId} links. */
  const shareTitle = title ? `${title} on Shelfd` : "Shelfd";
  const shareDescription = user && title
    ? `${user} shared ${title} on Shelfd.`
    : title ? `Check out ${title} on Shelfd.` : "Track your shows, movies, anime, and games.";
  const image = /^https?:\/\//i.test(poster) ? poster : new URL("/og-image-v216.png", url.origin).toString();
  const indexUrl = new URL("/index.html", url.origin);
  const assetResponse = await env.ASSETS.fetch(new Request(indexUrl.toString(), { method: "GET" }));
  let html = await assetResponse.text();
  if (!html || html.length < 100) html = `<!DOCTYPE html><html><head><title>${escapeHtmlMeta(shareTitle)}</title></head><body></body></html>`;
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtmlMeta(shareTitle)}</title>`);
  html = replaceMetaTag(html, "property", "og:title", shareTitle);
  html = replaceMetaTag(html, "property", "og:description", shareDescription);
  html = replaceMetaTag(html, "property", "og:url", url.toString());
  html = removeMetaTag(html, "property", "og:image:width");
  html = removeMetaTag(html, "property", "og:image:height");
  html = replaceMetaTag(html, "property", "og:image", image);
  html = replaceMetaTag(html, "property", "og:image:alt", shareTitle);
  html = replaceMetaTag(html, "name", "twitter:title", shareTitle);
  html = replaceMetaTag(html, "name", "twitter:description", shareDescription);
  html = replaceMetaTag(html, "name", "twitter:image", image);
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, no-cache, must-revalidate, max-age=0" }
  });
}

async function serveReviewShareHtml(request, env, url) {
  const meta = getReviewShareMeta(url);
  const indexUrl = new URL("/index.html", url.origin);
  const assetResponse = await env.ASSETS.fetch(new Request(indexUrl.toString(), { method: "GET" }));
  let html = await assetResponse.text();
  if (!html || html.length < 100) html = `<!DOCTYPE html><html><head><title>${escapeHtmlMeta(meta.title)}</title></head><body></body></html>`;
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtmlMeta(meta.title)}</title>`);
  html = replaceMetaTag(html, "property", "og:title", meta.title);
  html = replaceMetaTag(html, "property", "og:description", meta.description);
  html = replaceMetaTag(html, "property", "og:url", meta.url);
  html = replaceMetaTag(html, "property", "og:type", "article");
  html = removeMetaTag(html, "property", "og:image:width");
  html = removeMetaTag(html, "property", "og:image:height");
  html = replaceMetaTag(html, "property", "og:image", meta.image);
  html = replaceMetaTag(html, "property", "og:image:alt", meta.title);
  html = replaceMetaTag(html, "name", "twitter:card", "summary_large_image");
  html = replaceMetaTag(html, "name", "twitter:title", meta.title);
  html = replaceMetaTag(html, "name", "twitter:description", meta.description);
  html = replaceMetaTag(html, "name", "twitter:image", meta.image);
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, no-cache, must-revalidate, max-age=0" }
  });
}

/* v11.607: news-article share link — /article/{base64url(articleUrl)} with the
   article's display meta in the query (title/source/image/category). The path
   segment carries the canonical article URL so the in-app reader can open the
   EXACT story; the query meta drives the link-preview card. og:image is the
   publisher's own hero image (already a raster PNG/JPEG — iMessage refuses SVG),
   so no rasterizing is needed. */
function isNewsArticleSharePath(url) {
  return /^\/article\/[^/]+\/?$/i.test(url.pathname);
}

async function serveNewsArticleShareHtml(request, env, url) {
  const title = cleanSharePreviewParam(url.searchParams.get("title") || "", "Shelfd News");
  const source = cleanSharePreviewParam(url.searchParams.get("source") || "", "");
  const image = url.searchParams.get("image") || "";
  const shareTitle = title || "Shelfd News";
  const shareDescription = source ? `${source} · Read it in Shelfd` : "Read this story in Shelfd.";
  const ogImage = /^https?:\/\//i.test(image) ? image : new URL("/og-image-v216.png", url.origin).toString();
  const indexUrl = new URL("/index.html", url.origin);
  const assetResponse = await env.ASSETS.fetch(new Request(indexUrl.toString(), { method: "GET" }));
  let html = await assetResponse.text();
  if (!html || html.length < 100) html = `<!DOCTYPE html><html><head><title>${escapeHtmlMeta(shareTitle)}</title></head><body></body></html>`;
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtmlMeta(shareTitle)}</title>`);
  html = replaceMetaTag(html, "property", "og:title", shareTitle);
  html = replaceMetaTag(html, "property", "og:description", shareDescription);
  html = replaceMetaTag(html, "property", "og:url", url.toString());
  html = replaceMetaTag(html, "property", "og:type", "article");
  html = removeMetaTag(html, "property", "og:image:width");
  html = removeMetaTag(html, "property", "og:image:height");
  html = replaceMetaTag(html, "property", "og:image", ogImage);
  html = replaceMetaTag(html, "property", "og:image:alt", shareTitle);
  html = replaceMetaTag(html, "name", "twitter:card", "summary_large_image");
  html = replaceMetaTag(html, "name", "twitter:title", shareTitle);
  html = replaceMetaTag(html, "name", "twitter:description", shareDescription);
  html = replaceMetaTag(html, "name", "twitter:image", ogImage);
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, no-cache, must-revalidate, max-age=0" }
  });
}

async function serveAlbumShareHtml(request, env, url) {
  const title = url.searchParams.get("title") || "Album";
  const artist = url.searchParams.get("artist") || "";
  const poster = url.searchParams.get("poster") || "";
  const shareTitle = artist ? `${title} by ${artist} on Shelfd` : `${title} on Shelfd`;
  const shareDescription = artist ? `Check out ${title} by ${artist} on Shelfd.` : `Check out ${title} on Shelfd.`;
  /* v11.072: render the composed 1200x1200 album card (cover + title + artist +
     year + sharer's avatar/username/rating) as a PNG, mirroring the in-app
     full-page album details. Falls back to the bare cover if rasterizing fails
     (handled inside serveAlbumProfileOgPng). */
  const ogImage = new URL("/album-profile-og.png", url.origin);
  ["title", "artist", "year", "poster", "deezerId", "username", "rating"].forEach(key => {
    const value = url.searchParams.get(key);
    if (value) ogImage.searchParams.set(key, value);
  });
  const image = ogImage.toString();
  const indexUrl = new URL("/index.html", url.origin);
  const assetResponse = await env.ASSETS.fetch(new Request(indexUrl.toString(), { method: "GET" }));
  let html = await assetResponse.text();
  if (!html || html.length < 100) html = `<!DOCTYPE html><html><head><title>${escapeHtmlMeta(shareTitle)}</title></head><body></body></html>`;
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtmlMeta(shareTitle)}</title>`);
  html = replaceMetaTag(html, "property", "og:title", shareTitle);
  html = replaceMetaTag(html, "property", "og:description", shareDescription);
  html = replaceMetaTag(html, "property", "og:url", url.toString());
  html = replaceMetaTag(html, "property", "og:image", image);
  html = replaceMetaTag(html, "property", "og:image:type", "image/png");
  html = replaceMetaTag(html, "property", "og:image:width", "1200");
  html = replaceMetaTag(html, "property", "og:image:height", "1200");
  html = replaceMetaTag(html, "property", "og:image:alt", shareTitle);
  html = replaceMetaTag(html, "name", "twitter:card", "summary_large_image");
  html = replaceMetaTag(html, "name", "twitter:title", shareTitle);
  html = replaceMetaTag(html, "name", "twitter:description", shareDescription);
  html = replaceMetaTag(html, "name", "twitter:image", image);
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, no-cache, must-revalidate, max-age=0" }
  });
}

async function serveGameProfileShareHtml(request, env, url) {
  const title = url.searchParams.get("title") || "Game Profile";
  const rank = url.searchParams.get("currentRank") || url.searchParams.get("peakRank") || "";
  const shareTitle = `${title} on Shelfd`;
  const shareDescription = rank
    ? `${title} competitive profile on Shelfd — ${rank}.`
    : `Check out this ${title} competitive profile on Shelfd.`;
  /* Render the share-card preview (cover + ranks + KD) as a PNG rather than the
     bare cover, so the link preview mirrors the in-app competitive profile.
     PNG (not SVG) because iMessage/LinkPresentation won't rasterize SVG. */
  const ogImage = new URL("/game-profile-og.png", url.origin);
  ["title", "poster", "year", "genre", "platform", "currentRank", "peakRank", "seasonKd", "lifetimeKd"].forEach(key => {
    const value = url.searchParams.get(key);
    if (value) ogImage.searchParams.set(key, value);
  });
  const image = ogImage.toString();
  const indexUrl = new URL("/index.html", url.origin);
  const assetResponse = await env.ASSETS.fetch(new Request(indexUrl.toString(), { method: "GET" }));
  let html = await assetResponse.text();
  if (!html || html.length < 100) html = `<!DOCTYPE html><html><head><title>${escapeHtmlMeta(shareTitle)}</title></head><body></body></html>`;
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtmlMeta(shareTitle)}</title>`);
  html = replaceMetaTag(html, "property", "og:title", shareTitle);
  html = replaceMetaTag(html, "property", "og:description", shareDescription);
  html = replaceMetaTag(html, "property", "og:url", url.toString());
  html = replaceMetaTag(html, "property", "og:image", image);
  html = replaceMetaTag(html, "property", "og:image:type", "image/png");
  html = replaceMetaTag(html, "property", "og:image:width", "1200");
  html = replaceMetaTag(html, "property", "og:image:height", "630");
  html = replaceMetaTag(html, "property", "og:image:alt", shareTitle);
  html = replaceMetaTag(html, "name", "twitter:card", "summary_large_image");
  html = replaceMetaTag(html, "name", "twitter:title", shareTitle);
  html = replaceMetaTag(html, "name", "twitter:description", shareDescription);
  html = replaceMetaTag(html, "name", "twitter:image", image);
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, no-cache, must-revalidate, max-age=0" }
  });
}

function serveProfileCardOgSvg(url) {
  const title = escapeHtmlMeta(url.searchParams.get("title") || "ScreenList Top 3");
  const profileName = escapeHtmlMeta(url.searchParams.get("profileName") || "ScreenList User");
  const label = escapeHtmlMeta(url.searchParams.get("label") || "Top 3");
  const rank = escapeHtmlMeta(url.searchParams.get("rank") || "1");
  const image = url.searchParams.get("image") || "";
  const safeImage = /^https?:\/\//i.test(image) ? escapeHtmlMeta(image) : "";
  const poster = safeImage
    ? `<image href="${safeImage}" x="82" y="82" width="360" height="466" preserveAspectRatio="xMidYMid slice" clip-path="url(#posterClip)"/>`
    : `<rect x="82" y="82" width="360" height="466" rx="28" fill="#2a1f5e"/><text x="262" y="336" fill="#8f7fd0" font-size="112" font-weight="300" text-anchor="middle">${rank}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#2a1f5e"/>
      <stop offset="0.55" stop-color="#151025"/>
      <stop offset="1" stop-color="#090712"/>
    </linearGradient>
    <clipPath id="posterClip"><rect x="82" y="82" width="360" height="466" rx="28"/></clipPath>
  </defs>
  <rect width="1200" height="630" fill="#120d22"/>
  <rect x="36" y="36" width="1128" height="558" rx="44" fill="url(#bg)" stroke="#C9A84C" stroke-opacity="0.72" stroke-width="4"/>
  ${poster}
  <text x="498" y="158" fill="#ffffff" font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="34" font-weight="300">${profileName}'s ${label}</text>
  <text x="498" y="240" fill="#ffffff" font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="66" font-weight="600">#${rank}</text>
  <foreignObject x="498" y="270" width="590" height="180">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fff;font-size:54px;font-weight:600;line-height:1.08;overflow:hidden;">${title}</div>
  </foreignObject>
  <text x="498" y="530" fill="#C9A84C" font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="30" font-weight="300">ScreenList Top 3 Card</text>
</svg>`;
  return new Response(svg, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300"
    }
  });
}

function buildVisitorCookie(visitorId) {
  return `${VISITOR_COOKIE}=${visitorId}; Max-Age=${VISITOR_COOKIE_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function buildSteamStateCookie(state) {
  return `${STEAM_STATE_COOKIE}=${state}; Max-Age=${STEAM_STATE_COOKIE_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function clearSteamStateCookie() {
  return `${STEAM_STATE_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

async function registerVisitor(request, env) {
  if (!env || !env.VISITOR_COUNTER) return "";
  const existingVisitorId = readCookie(request, VISITOR_COOKIE);
  const visitorId = existingVisitorId || crypto.randomUUID();
  const stub = env.VISITOR_COUNTER.get(env.VISITOR_COUNTER.idFromName("global"));
  await stub.fetch("https://visitor-counter.internal/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ visitorId })
  });
  return existingVisitorId ? "" : buildVisitorCookie(visitorId);
}

async function fetchVisitorStats(env) {
  if (!env || !env.VISITOR_COUNTER) {
    return Response.json({ totalVisitors: 0, visitorCounterEnabled: false }, { headers: { "Cache-Control": "no-store" } });
  }
  const stub = env.VISITOR_COUNTER.get(env.VISITOR_COUNTER.idFromName("global"));
  return stub.fetch("https://visitor-counter.internal/stats");
}

function withAppendedCookie(response, cookieHeader) {
  if (!cookieHeader) return response;
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", cookieHeader);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function withHtmlNoStoreHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function buildUpstreamUrl(origin, pathSuffix, originalUrl, authParam, authValue) {
  const upstream = new URL(pathSuffix.replace(/^\/+/, ""), origin);
  const sourceParams = new URL(originalUrl).searchParams;
  sourceParams.forEach((value, key) => {
    if (key !== authParam) upstream.searchParams.set(key, value);
  });
  upstream.searchParams.set(authParam, authValue);
  return upstream;
}

function buildProxyRequest(request, upstreamUrl) {
  const headers = new Headers(request.headers);
  headers.delete("host");
  const init = {
    method: request.method,
    headers,
    redirect: "follow"
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }
  return new Request(upstreamUrl, init);
}


function errorMessage(error) {
  return error && error.message ? error.message : String(error || "Unknown error");
}

async function fetchJsonWithTimeout(url, init = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    let body = null;
    try {
      body = await res.json();
    } catch (jsonError) {
      body = await res.text().catch(() => "");
    }
    return {
      ok: res.ok,
      status: res.status,
      data: body,
      error: res.ok ? "" : `Request failed with status ${res.status}.`
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error?.name === "AbortError" || errorMessage(error) === "timeout"
        ? "Request timed out."
        : errorMessage(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextWithTimeout(url, init = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text().catch(() => "");
    return {
      ok: res.ok,
      status: res.status,
      data: text,
      error: res.ok ? "" : `Request failed with status ${res.status}.`
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: "",
      error: error?.name === "AbortError" || errorMessage(error) === "timeout"
        ? "Request timed out."
        : errorMessage(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeSteamId(value = "") {
  const match = String(value || "").trim().match(/(\d{17})/);
  return match ? match[1] : "";
}

function extractSteamIdFromClaimedId(value = "") {
  const clean = String(value || "").trim();
  const match = clean.match(/steamcommunity\.com\/openid\/id\/(\d{17})/i);
  return match ? match[1] : normalizeSteamId(clean);
}

function buildSteamStoreUrl(appId = "") {
  const cleanAppId = String(appId || "").trim();
  return cleanAppId ? `https://store.steampowered.com/app/${encodeURIComponent(cleanAppId)}/` : "";
}

function buildSteamCommunityAssetUrl(appId = "", hash = "") {
  const cleanAppId = String(appId || "").trim();
  const cleanHash = String(hash || "").trim();
  if (!cleanAppId || !cleanHash) return "";
  return `https://media.steampowered.com/steamcommunity/public/images/apps/${encodeURIComponent(cleanAppId)}/${encodeURIComponent(cleanHash)}.jpg`;
}

function normalizeSteamLastPlayed(value = 0) {
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  return new Date(seconds * 1000).toISOString();
}

function buildSteamCallbackUrl(url, state = "") {
  const callbackUrl = new URL("/api/steam/callback", url.origin);
  callbackUrl.searchParams.set("state", state);
  return callbackUrl.toString();
}

function buildSteamAppRedirectUrl(url, params = {}) {
  const redirectUrl = new URL("/", url.origin);
  redirectUrl.searchParams.set("steam_import", "1");
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      redirectUrl.searchParams.set(key, String(value));
    }
  });
  return redirectUrl.toString();
}

function buildRedirectResponse(location, cookieHeader = "") {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  if (cookieHeader) headers.append("Set-Cookie", cookieHeader);
  return new Response(null, { status: 302, headers });
}

async function fetchSteamJson(env, path, params = {}, timeoutMs = 8000) {
  const config = getSteamApiConfig(env);
  if (!config.value) {
    return { ok: false, status: 500, data: null, error: getSteamConfigError(env), steam: getSteamPublicStatus(env) };
  }
  const url = new URL(path.replace(/^\/+/, ""), STEAM_API_ORIGIN + "/");
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  url.searchParams.set("key", config.value);
  url.searchParams.set("format", "json");
  const result = await fetchJsonWithTimeout(url.toString(), { headers: { Accept: "application/json" } }, timeoutMs);
  if (!result.ok && result.status !== 0 && !result.error) result.error = `Steam request failed with status ${result.status}.`;
  result.steam = getSteamPublicStatus(env);
  return result;
}

async function fetchSteamPlayerSummary(env, steamId = "", timeoutMs = 8000) {
  const cleanSteamId = normalizeSteamId(steamId);
  if (!cleanSteamId) return { ok: false, status: 400, data: null, error: "Missing SteamID." };
  const result = await fetchSteamJson(env, "/ISteamUser/GetPlayerSummaries/v0002/", { steamids: cleanSteamId }, timeoutMs);
  if (!result.ok) return result;
  const players = result.data?.response?.players;
  const player = Array.isArray(players) ? players[0] || null : null;
  return {
    ok: !!player,
    status: player ? 200 : 404,
    data: player,
    error: player ? "" : "Steam profile was not found.",
    steam: result.steam
  };
}

async function fetchSteamOwnedGames(env, steamId = "", timeoutMs = 10000) {
  const cleanSteamId = normalizeSteamId(steamId);
  if (!cleanSteamId) return { ok: false, status: 400, data: null, error: "Missing SteamID." };
  const result = await fetchSteamJson(env, "/IPlayerService/GetOwnedGames/v0001/", {
    steamid: cleanSteamId,
    include_appinfo: 1,
    include_played_free_games: 1,
    appids_filter: ""
  }, timeoutMs);
  if (!result.ok) return result;
  const response = result.data?.response || {};
  const games = Array.isArray(response.games) ? response.games : [];
  return {
    ok: true,
    status: 200,
    data: {
      game_count: Number(response.game_count || games.length || 0),
      games
    },
    error: "",
    steam: result.steam
  };
}

async function verifySteamOpenIdResponse(requestUrl) {
  const verifyParams = new URLSearchParams();
  for (const [key, value] of requestUrl.searchParams.entries()) {
    if (key.startsWith("openid.")) verifyParams.set(key, value);
  }
  verifyParams.set("openid.mode", "check_authentication");
  const result = await fetchTextWithTimeout(`${STEAM_OPENID_ORIGIN}/openid/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: verifyParams.toString()
  }, 9000);
  const body = String(result.data || "");
  return {
    ok: result.ok && /is_valid\s*:\s*true/i.test(body),
    status: result.status,
    data: body,
    error: result.ok ? "" : result.error || "Steam sign-in verification failed."
  };
}

function normalizeRankTitle(value = "") {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function roundRankNumber(value, digits = 1) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  const m = Math.pow(10, digits);
  return Math.round(num * m) / m;
}

function compactRankNumber(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return "0";
  return Math.round(num).toLocaleString("en-US");
}

function getRankCountryLabel(country) {
  const map = {
    US: "United States",
    JP: "Japan",
    KR: "South Korea",
    GB: "United Kingdom",
    FR: "France",
    IN: "India"
  };
  return map[country] || country;
}

function normalizeRankCountry(value = "") {
  const country = String(value || "US").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : "US";
}

function normalizeRankMediaType(value = "") {
  return String(value || "tv").trim().toLowerCase() === "movie" ? "movie" : "tv";
}

async function fetchTmdbJson(env, path, params = {}, timeoutMs = 8000) {
  if (!env.TMDB_KEY) {
    return { ok: false, status: 500, data: null, error: "TMDB_KEY is not configured." };
  }
  const url = new URL(path.replace(/^\/+/, ""), TMDB_ORIGIN);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  url.searchParams.set("api_key", env.TMDB_KEY);
  return fetchJsonWithTimeout(url.toString(), { headers: { "Accept": "application/json" } }, timeoutMs);
}

function buildTraktHeaders(env) {
  const config = getTraktClientConfig(env);
  if (!config.value) return null;
  return {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": config.value
  };
}

async function fetchTraktJson(env, path, params = {}, timeoutMs = 6500) {
  const headers = buildTraktHeaders(env);
  if (!headers) {
    return {
      ok: false,
      status: 500,
      data: null,
      error: getTraktConfigError(env),
      trakt: getTraktPublicStatus(env)
    };
  }

  const url = new URL(path.replace(/^\/+/, ""), TRAKT_ORIGIN + "/");
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });

  const result = await fetchJsonWithTimeout(url.toString(), { headers }, timeoutMs);
  if (!result.ok && result.status !== 0) {
    result.error = result.status === 401 || result.status === 403
      ? `Trakt request failed with status ${result.status}. Check that the Worker secret is the Trakt Client ID, not the Client Secret.`
      : `Trakt request failed with status ${result.status}.`;
  }
  return result;
}


function simplifyTraktTrendingShows(rows = []) {
  return (Array.isArray(rows) ? rows : []).slice(0, 5).map((row, index) => {
    const show = row.show || row;
    return {
      rank: index + 1,
      watchers: Number(row.watchers || 0),
      title: show?.title || "",
      year: show?.year || null,
      traktId: show?.ids?.trakt || null,
      tmdbId: show?.ids?.tmdb || null,
      imdbId: show?.ids?.imdb || ""
    };
  });
}

async function runRankHealthCheck(env) {
  const trakt = await fetchTraktJson(env, "/shows/trending", { limit: 5 });
  return jsonResponse({
    ok: !!trakt.ok,
    sources: {
      trakt: {
        ...getTraktPublicStatus(env),
        ok: !!trakt.ok,
        status: trakt.status,
        sample: trakt.ok ? simplifyTraktTrendingShows(trakt.data) : [],
        error: trakt.error || ""
      },
      tmdb: {
        configured: !!env.TMDB_KEY
      },
      ai: {
        configured: !!env.myscreenlistAi
      }
    }
  }, trakt.ok ? 200 : 500);
}


async function fetchTraktTrendingLookup(env, type) {
  const endpoint = type === "movie" ? "/movies/trending" : "/shows/trending";
  const trakt = await fetchTraktJson(env, endpoint, { limit: 100 }, 6500);
  const lookup = new Map();
  if (trakt.ok && Array.isArray(trakt.data)) {
    trakt.data.forEach(row => {
      const media = type === "movie" ? (row.movie || row) : (row.show || row);
      const title = media?.title || "";
      const year = media?.year || null;
      const key = normalizeRankTitle(title);
      if (!key) return;
      lookup.set(key, {
        title,
        year,
        watchers: Number(row.watchers || 0),
        traktId: media?.ids?.trakt || null,
        tmdbId: media?.ids?.tmdb || null,
        imdbId: media?.ids?.imdb || ""
      });
    });
  }
  return {
    ok: !!trakt.ok,
    status: trakt.status,
    error: trakt.error || "",
    lookup
  };
}

function buildCountryRankParams(type, country) {
  if (type === "movie") {
    return {
      path: "discover/movie",
      params: {
        language: "en-US",
        include_adult: "false",
        include_video: "false",
        sort_by: "popularity.desc",
        with_origin_country: country,
        "vote_count.gte": "20",
        page: "1"
      }
    };
  }
  return {
    path: "discover/tv",
    params: {
      language: "en-US",
      include_null_first_air_dates: "false",
      sort_by: "popularity.desc",
      with_origin_country: country,
      "vote_count.gte": "10",
      page: "1"
    }
  };
}

function scoreCountryRankItem(item = {}, traktMatch = null) {
  const popularity = Number(item.popularity || 0);
  const votes = Number(item.vote_count || 0);
  const rating = Number(item.vote_average || 0);
  const watchers = Number(traktMatch?.watchers || 0);
  return popularity + Math.log10(votes + 1) * 18 + rating * 7 + Math.log10(watchers + 1) * 22;
}

function buildCountryRankSourceLabel(item = {}, traktMatch = null, countryLabel = "") {
  const parts = [];
  if (countryLabel) parts.push(`${countryLabel} origin`);
  if (item.popularity) parts.push(`TMDB popularity ${roundRankNumber(item.popularity, 1)}`);
  if (item.vote_count) parts.push(`${compactRankNumber(item.vote_count)} votes`);
  if (traktMatch?.watchers) parts.push(`${compactRankNumber(traktMatch.watchers)} Trakt watchers`);
  return parts.join(" · ");
}


function getTraktMediaFromRow(row = {}, type = "tv") {
  return type === "movie" ? (row.movie || row) : (row.show || row);
}

function getTraktRowMetric(row = {}) {
  const watchers = Number(row.watchers || row.watcher_count || 0);
  const plays = Number(row.play_count || row.plays || 0);
  const collected = Number(row.collected_count || 0);
  const lists = Number(row.list_count || row.listed_count || 0);
  return Math.max(watchers, plays * 0.7, collected * 0.45, lists * 1.25, 0);
}

function getTraktRowSourceText(row = {}) {
  if (row.watchers) return `${compactRankNumber(row.watchers)} Trakt watchers`;
  if (row.watcher_count) return `${compactRankNumber(row.watcher_count)} Trakt watchers`;
  if (row.play_count) return `${compactRankNumber(row.play_count)} Trakt plays`;
  if (row.list_count) return `${compactRankNumber(row.list_count)} Trakt list adds`;
  return "Trakt activity";
}

function getTmdbMediaPath(type, tmdbId) {
  return `${type === "movie" ? "movie" : "tv"}/${tmdbId}`;
}

function getTmdbSearchPath(type) {
  return type === "movie" ? "search/movie" : "search/tv";
}

function getTmdbDate(item = {}) {
  return item.release_date || item.first_air_date || "";
}

function getTmdbYear(item = {}) {
  return String(getTmdbDate(item)).slice(0, 4);
}

function getTmdbTitle(item = {}, type = "tv") {
  return type === "movie" ? (item.title || item.original_title || "") : (item.name || item.original_name || "");
}

function getTmdbOriginCountrySet(item = {}) {
  const set = new Set();
  (Array.isArray(item.origin_country) ? item.origin_country : []).forEach(code => code && set.add(String(code).toUpperCase()));
  (Array.isArray(item.production_countries) ? item.production_countries : []).forEach(country => {
    if (country?.iso_3166_1) set.add(String(country.iso_3166_1).toUpperCase());
  });
  return set;
}

function tmdbMatchesCountry(item = {}, country = "US") {
  return getTmdbOriginCountrySet(item).has(String(country || "").toUpperCase());
}

function tmdbHasFutureDate(item = {}) {
  const value = getTmdbDate(item);
  if (!value) return false;
  return new Date(`${value}T00:00:00`).getTime() > Date.now();
}

function tmdbHasRecentDate(item = {}, days = 7) {
  const value = getTmdbDate(item);
  if (!value) return false;
  const age = (Date.now() - new Date(`${value}T00:00:00`).getTime()) / (1000 * 60 * 60 * 24);
  return age >= 0 && age <= days;
}

async function fetchTmdbDetailForTraktMedia(env, type, media = {}, timeoutMs = 6500) {
  const tmdbId = media?.ids?.tmdb;
  if (tmdbId) {
    const details = await fetchTmdbJson(env, getTmdbMediaPath(type, tmdbId), { language: "en-US" }, timeoutMs);
    if (details.ok && details.data?.id) return details.data;
  }

  const title = media?.title || "";
  if (!title) return null;
  const search = await fetchTmdbJson(env, getTmdbSearchPath(type), {
    language: "en-US",
    query: title,
    year: type === "movie" && media?.year ? media.year : undefined,
    first_air_date_year: type !== "movie" && media?.year ? media.year : undefined
  }, timeoutMs);
  const first = search.ok && Array.isArray(search.data?.results) ? search.data.results.find(item => item.poster_path) : null;
  if (!first?.id) return null;
  const details = await fetchTmdbJson(env, getTmdbMediaPath(type, first.id), { language: "en-US" }, timeoutMs);
  return details.ok && details.data?.id ? details.data : first;
}

function mergeTraktRows(rows = [], type = "tv") {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach(row => {
    const media = getTraktMediaFromRow(row, type);
    if (!media) return;
    const tmdbId = media?.ids?.tmdb || "";
    const key = tmdbId ? `tmdb:${tmdbId}` : normalizeRankTitle(`${media.title || ""} ${media.year || ""}`);
    if (!key) return;
    const metric = getTraktRowMetric(row);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { row, media, metric, sourceTexts: [getTraktRowSourceText(row)] });
      return;
    }
    existing.metric = Math.max(existing.metric || 0, metric) + metric * 0.35;
    if (metric > getTraktRowMetric(existing.row)) existing.row = row;
    const text = getTraktRowSourceText(row);
    if (!existing.sourceTexts.includes(text)) existing.sourceTexts.push(text);
  });
  return Array.from(map.values()).sort((a, b) => Number(b.metric || 0) - Number(a.metric || 0));
}

async function fetchTraktActivityRows(env, type = "tv", mode = "trending", period = "weekly") {
  const typePath = type === "movie" ? "movies" : "shows";
  let path = `/${typePath}/trending`;
  if (mode === "watched") path = `/${typePath}/watched/${period}`;
  if (mode === "popular") path = `/${typePath}/popular`;
  if (mode === "anticipated") path = `/${typePath}/anticipated`;
  const res = await fetchTraktJson(env, path, { limit: 100 }, 6500);
  const rows = res.ok && Array.isArray(res.data) ? res.data : [];
  if (!res.ok) {
    rows.traktError = {
      mode,
      path,
      status: res.status,
      error: res.error || "Trakt request failed."
    };
  }
  return rows;
}

async function buildTraktActivityCandidates(env, type = "tv", modes = ["watched", "trending"]) {
  const rows = [];
  const errors = [];
  for (const mode of modes) {
    const period = mode === "watched" ? "weekly" : "weekly";
    const modeRows = await fetchTraktActivityRows(env, type, mode, period);
    if (modeRows.traktError) errors.push(modeRows.traktError);
    rows.push(...modeRows);
  }
  const candidates = mergeTraktRows(rows, type);
  candidates.traktErrors = errors;
  return candidates;
}

function getTraktRankFailureMessage(candidates = []) {
  const errors = Array.isArray(candidates.traktErrors) ? candidates.traktErrors : [];
  if (errors.length) return errors.map(item => item.error).filter(Boolean).join(" ") || "Trakt request failed.";
  return "Trakt returned no ranked titles.";
}

async function hydrateTraktCandidates(env, type, candidates, options = {}) {
  const limit = Number(options.limit || 10);
  const country = options.country ? normalizeRankCountry(options.country) : "";
  const filter = typeof options.filter === "function" ? options.filter : null;
  const rankings = [];
  for (const candidate of candidates.slice(0, Number(options.scanLimit || 70))) {
    if (rankings.length >= limit) break;
    const details = await fetchTmdbDetailForTraktMedia(env, type, candidate.media, 6500);
    if (!details?.id || !details.poster_path) continue;
    if (country && !tmdbMatchesCountry(details, country)) continue;
    if (filter && !filter(details, candidate)) continue;
    const rating = Number(details.vote_average || 0);
    const votes = Number(details.vote_count || 0);
    const popularity = Number(details.popularity || 0);
    const metric = Number(candidate.metric || 0);
    const title = getTmdbTitle(details, type);
    const sourceLabel = `${candidate.sourceTexts.slice(0, 2).join(" · ")} · TMDB ${rating ? rating.toFixed(1) : "N/A"}`;
    rankings.push({
      ...details,
      media_type: type,
      title: type === "movie" ? title : undefined,
      name: type !== "movie" ? title : undefined,
      sourceLabel,
      discoverContext: sourceLabel,
      traktActivity: roundRankNumber(metric, 1),
      rankScore: metric * 100 + popularity + rating * 8 + Math.log10(votes + 1) * 12
    });
  }
  return rankings.sort((a, b) => Number(b.rankScore || 0) - Number(a.rankScore || 0)).slice(0, limit);
}

async function buildTraktActivityLookup(env, type = "tv") {
  const candidates = await buildTraktActivityCandidates(env, type, ["watched", "trending", "popular"]);
  const lookup = new Map();
  candidates.forEach(candidate => {
    const media = candidate.media || {};
    const metric = Number(candidate.metric || 0);
    const tmdbId = media?.ids?.tmdb;
    if (tmdbId) lookup.set(`tmdb:${tmdbId}`, candidate);
    const titleKey = normalizeRankTitle(media.title || "");
    if (titleKey && !lookup.has(`title:${titleKey}`)) lookup.set(`title:${titleKey}`, candidate);
  });
  return lookup;
}

function findTraktActivityForTmdbItem(item = {}, type = "tv", lookup = new Map()) {
  const idKey = item.id ? `tmdb:${item.id}` : "";
  if (idKey && lookup.has(idKey)) return lookup.get(idKey);
  const titleKey = normalizeRankTitle(getTmdbTitle(item, type));
  return titleKey ? lookup.get(`title:${titleKey}`) : null;
}

async function fetchTmdbRankPages(env, type, params = {}, pageCount = 2) {
  const path = type === "movie" ? "discover/movie" : "discover/tv";
  const out = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const res = await fetchTmdbJson(env, path, { language: "en-US", include_adult: "false", ...params, page }, 7500);
    if (res.ok && Array.isArray(res.data?.results)) out.push(...res.data.results);
  }
  const seen = new Set();
  return out.filter(item => {
    if (!item?.id || !item.poster_path) return false;
    const key = `${type}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(item => ({ ...item, media_type: type }));
}

function mediaRankBaseScore(item = {}, section = "") {
  const popularity = Number(item.popularity || 0);
  const rating = Number(item.vote_average || 0);
  const votes = Number(item.vote_count || 0);
  const quality = rating * Math.sqrt(Math.max(0, votes));
  const releaseValue = getTmdbDate(item);
  const dateMs = releaseValue ? new Date(`${releaseValue}T00:00:00`).getTime() : 0;
  const daysAgo = dateMs ? (Date.now() - dateMs) / (1000 * 60 * 60 * 24) : 9999;
  const year = new Date().getFullYear();
  let score = popularity * 0.35 + quality * 0.38 + Math.log10(votes + 1) * 18;
  if (section.startsWith("new_releases")) score += Math.max(0, 40 - Math.max(0, daysAgo)) * 3;
  if (section === "years_best" && String(releaseValue).startsWith(`${year}-`)) score += 70;
  if (section === "releasing_soon") score += tmdbHasFutureDate(item) ? 90 : -100;
  if (section === "hidden_gems") score += Math.max(0, 2000 - votes) / 25 + rating * 12;
  if (section === "highly_rated_classics") score += rating * 22 + Math.log10(votes + 1) * 25;
  return score;
}

function labelRankedTmdbItem(item = {}, type = "tv", section = "", candidate = null) {
  const parts = [];
  if (candidate?.metric) parts.push(`${compactRankNumber(candidate.metric)} Trakt activity`);
  if (item.vote_average) parts.push(`TMDB ${Number(item.vote_average).toFixed(1)}`);
  if (item.vote_count) parts.push(`${compactRankNumber(item.vote_count)} votes`);
  if (section.startsWith("new_releases")) parts.unshift(`Released ${getTmdbDate(item)}`);
  if (section === "releasing_soon") parts.unshift(`Releases ${getTmdbDate(item)}`);
  return parts.filter(Boolean).join(" · ");
}


function isTmdbThisYearCandidate(item = {}, type = "tv", year = new Date().getFullYear()) {
  const date = getTmdbDate(item);
  const rating = Number(item.vote_average || 0);
  const votes = Number(item.vote_count || 0);
  return !!(
    item &&
    item.id &&
    item.poster_path &&
    getTmdbTitle(item, type) &&
    item.overview &&
    date &&
    String(date).slice(0, 4) === String(year) &&
    rating > 0 &&
    votes > 0
  );
}

function scoreThisYearBestItems(items = []) {
  const rated = items.map(item => Number(item.vote_average || 0)).filter(value => Number.isFinite(value) && value > 0);
  const categoryAverage = rated.length ? rated.reduce((sum, value) => sum + value, 0) / rated.length : 6.5;
  const maxLogVotes = Math.max(...items.map(item => Math.log10(Number(item.vote_count || 0) + 1)), 1);
  return items.map(item => {
    const type = item.media_type === "movie" ? "movie" : "tv";
    const rating = Number(item.vote_average || 0);
    const votes = Number(item.vote_count || 0);
    const minVotes = type === "movie" ? 180 : 120;
    const weightedRating = (votes / (votes + minVotes)) * rating + (minVotes / (votes + minVotes)) * categoryAverage;
    const normalizedVotes = Math.log10(votes + 1) / maxLogVotes;
    const rankScore = (weightedRating * 0.65) + (normalizedVotes * 10 * 0.35);
    const sourceLabel = `${new Date().getFullYear()} release · TMDB ${rating ? rating.toFixed(1) : "N/A"} · ${compactRankNumber(votes)} votes`;
    return {
      ...item,
      sourceLabel,
      discoverContext: sourceLabel,
      rankScore
    };
  }).sort((a, b) => {
    const scoreCompare = Number(b.rankScore || 0) - Number(a.rankScore || 0);
    if (scoreCompare) return scoreCompare;
    const voteCompare = Number(b.vote_count || 0) - Number(a.vote_count || 0);
    if (voteCompare) return voteCompare;
    const ratingCompare = Number(b.vote_average || 0) - Number(a.vote_average || 0);
    if (ratingCompare) return ratingCompare;
    return getTmdbTitle(a, a.media_type).localeCompare(getTmdbTitle(b, b.media_type), undefined, { sensitivity: "base" });
  });
}

async function buildThisYearsBestRankings(env, year, todayIso) {
  const [movies, shows, anime] = await Promise.all([
    fetchTmdbRankPages(env, "movie", { "primary_release_date.gte": `${year}-01-01`, "primary_release_date.lte": todayIso, "vote_count.gte": "75", sort_by: "vote_count.desc", region: "US" }, 3),
    fetchTmdbRankPages(env, "tv", { "first_air_date.gte": `${year}-01-01`, "first_air_date.lte": todayIso, "vote_count.gte": "50", sort_by: "vote_count.desc" }, 3),
    fetchTmdbRankPages(env, "tv", { "first_air_date.gte": `${year}-01-01`, "first_air_date.lte": todayIso, with_genres: "16", "vote_count.gte": "30", sort_by: "vote_count.desc" }, 2)
  ]);
  const seen = new Set();
  const combined = [...movies, ...shows, ...anime].filter(item => {
    const type = item.media_type === "movie" ? "movie" : "tv";
    const key = `${type}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return isTmdbThisYearCandidate(item, type, year) && Number(item.vote_average || 0) >= 6.5;
  });
  return scoreThisYearBestItems(combined).slice(0, 10);
}

async function rankTmdbCandidatePool(env, section, movieParams, tvParams, options = {}) {
  const [movies, shows, movieLookup, showLookup] = await Promise.all([
    fetchTmdbRankPages(env, "movie", movieParams, options.moviePages || 2),
    fetchTmdbRankPages(env, "tv", tvParams, options.tvPages || 2),
    buildTraktActivityLookup(env, "movie"),
    buildTraktActivityLookup(env, "tv")
  ]);
  const combined = [...movies, ...shows];
  return combined.map(item => {
    const type = item.media_type === "movie" ? "movie" : "tv";
    const candidate = findTraktActivityForTmdbItem(item, type, type === "movie" ? movieLookup : showLookup);
    const activity = Number(candidate?.metric || 0);
    const activityBoost = activity > 0 ? Math.log10(activity + 1) * 85 : 0;
    const sourceLabel = labelRankedTmdbItem(item, type, section, candidate);
    return {
      ...item,
      sourceLabel,
      discoverContext: sourceLabel,
      traktActivity: roundRankNumber(activity, 1),
      rankScore: mediaRankBaseScore(item, section) + activityBoost
    };
  }).filter(item => {
    if (!item.poster_path) return false;
    if (section === "hidden_gems") return Number(item.vote_average || 0) >= 7 && Number(item.vote_count || 0) <= 2500;
    if (section === "highly_rated_classics") return Number(item.vote_average || 0) >= 7;
    if (section === "releasing_soon") return tmdbHasFutureDate(item);
    return true;
  }).sort((a, b) => Number(b.rankScore || 0) - Number(a.rankScore || 0)).slice(0, 10);
}


function normalizeTavilyCategorySection(value = "") {
  const raw = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const aliases = {
    trending_movies: "movie_trending",
    popular_movies: "movie_popular",
    top_rated_movies: "movie_top_rated",
    in_theaters: "movie_in_theaters",
    movie_theaters: "movie_in_theaters",
    movie_new_releases_month: "movie_new_releases_month",
    movie_new_releases_week: "movie_new_releases_week",
    tv_new_releases_month: "tv_new_releases_month",
    tv_new_releases_week: "tv_new_releases_week",
    trending_shows: "tv_trending",
    popular_shows: "tv_popular",
    top_rated_shows: "tv_top_rated",
    highly_rated_classics: "movie_top_rated",
    years_best: "movie_years_best",
    releasing_soon: "movie_releasing_soon",
    hidden_gems: "movie_hidden_gems"
  };
  const section = aliases[raw] || raw;
  const allowed = new Set([
    "movie_new_releases_week", "movie_new_releases_month", "movie_in_theaters", "movie_years_best",
    "movie_popular", "movie_top_rated", "movie_trending", "movie_releasing_soon", "movie_hidden_gems",
    "tv_new_releases_week", "tv_new_releases_month", "tv_trending", "tv_popular", "tv_releasing_soon", "tv_top_rated"
  ]);
  return allowed.has(section) ? section : "";
}

function getScreenListMonthYearLabel(date = new Date()) {
  try {
    return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  } catch (error) {
    return `${date.getFullYear()}`;
  }
}

function isTvCurrentActivityRankSection(section = "") {
  const normalized = normalizeTavilyCategorySection(section);
  return normalized === "tv_trending" || normalized === "tv_popular";
}

function getTavilyCategoryRankConfig(section = "") {
  const normalized = normalizeTavilyCategorySection(section);
  const today = new Date();
  const year = today.getFullYear();
  const monthYear = getScreenListMonthYearLabel(today);
  const tvCurrentGuidance = "Prioritize current real-world TV activity: currently airing seasons, weekly new episodes, season premieres/finales, final seasons, major streaming releases, IMDb popularity, search/news/social evidence, and recent audience momentum. Penalize static all-time legacy shows unless current evidence says they are active now. Return TV series only, not episodes.";
  const configs = {
    movie_new_releases_week: {
      type: "movie",
      label: "Movie newest releases this week",
      query: `IMDb most popular new movie releases this week ${monthYear} ranked list ratings current audience interest`,
      guidance: "Rank newly released movies from this week by current real-world relevance, IMDb/search evidence, audience activity, and release recency. Return movies only."
    },
    movie_new_releases_month: {
      type: "movie",
      label: "Movie newest releases this month",
      query: `IMDb most popular new movie releases this month ${monthYear} ranked list ratings current audience interest`,
      guidance: "Rank newly released movies from this month by current real-world relevance, IMDb/search evidence, audience activity, and release recency. Return movies only."
    },
    movie_in_theaters: {
      type: "movie",
      label: "Movies in theaters",
      query: `top movies in theaters now box office IMDb popular movies ${monthYear} ranked list currently playing`,
      guidance: "Rank movies currently in theaters by current-theater relevance, box office/search evidence, IMDb evidence, and audience activity. Avoid old movies unless they are actually in current release. Return movies only."
    },
    movie_years_best: {
      type: "movie",
      label: "Best movies this year",
      query: `best movies of ${year} IMDb ratings ranked list highest rated audience votes`,
      guidance: "Rank this year's best movies by IMDb rating, review/vote confidence, and credible year-best evidence. Return movies only."
    },
    movie_popular: {
      type: "movie",
      label: "Popular movies",
      query: `IMDb most popular movies today ${monthYear} ranked list current audience activity`,
      guidance: "Rank broadly popular movies right now by IMDb popularity/search evidence, current audience activity, and major release conversation. Return movies only."
    },
    movie_top_rated: {
      type: "movie",
      label: "Top rated movies all time",
      query: "IMDb top rated movies all time ranked list IMDb Top 250",
      guidance: "Rank all-time top rated movies using IMDb top-rated style evidence. Return movies only."
    },
    movie_trending: {
      type: "movie",
      label: "Trending movies",
      query: `IMDb trending movies today most popular movies ${monthYear} ranked list current search activity`,
      guidance: "Rank movies with the strongest current momentum, search/trending evidence, audience conversation, and current release relevance. Return movies only."
    },
    movie_releasing_soon: {
      type: "movie",
      label: "Movies releasing soon",
      query: `most anticipated upcoming movies releasing soon ${year} IMDb ranked list release dates audience anticipation`,
      guidance: "Rank upcoming movies by release proximity, anticipation, and credible search evidence. Return movies only."
    },
    movie_hidden_gems: {
      type: "movie",
      label: "Movie hidden gems",
      query: `best underrated hidden gem movies ${year} IMDb high rated list`,
      guidance: "Rank strong lesser-known movies by quality evidence while avoiding obvious all-time mainstream titles. Return movies only."
    },
    tv_new_releases_week: {
      type: "tv",
      label: "TV newest releases this week",
      query: `new TV shows released this week ${monthYear} IMDb most popular ranked current streaming premieres`,
      guidance: "Rank newly released TV series from this week by release recency, current relevance, IMDb/search evidence, and audience activity. Return TV series only, not episodes."
    },
    tv_new_releases_month: {
      type: "tv",
      label: "TV newest releases this month",
      query: `new TV shows released this month ${monthYear} IMDb most popular ranked current streaming premieres`,
      guidance: "Rank newly released TV series from this month by release recency, current relevance, IMDb/search evidence, and audience activity. Return TV series only, not episodes."
    },
    tv_trending: {
      type: "tv",
      label: "Trending TV shows",
      query: `currently airing trending TV shows ${monthYear} weekly episodes new seasons IMDb most popular ranked streaming series`,
      guidance: tvCurrentGuidance
    },
    tv_popular: {
      type: "tv",
      label: "Popular TV shows",
      query: `most popular TV shows right now ${monthYear} currently airing new episodes IMDb ranked streaming series`,
      guidance: tvCurrentGuidance
    },
    tv_releasing_soon: {
      type: "tv",
      label: "TV shows releasing soon",
      query: `most anticipated upcoming TV shows releasing soon ${year} IMDb ranked list new series new seasons`,
      guidance: "Rank upcoming TV series by release proximity, anticipation, and credible search evidence. Return TV series only, not episodes."
    },
    tv_top_rated: {
      type: "tv",
      label: "Top rated TV shows all time",
      query: "IMDb top rated TV shows all time ranked list",
      guidance: "Rank all-time top rated TV shows using IMDb top-rated style evidence. Return TV series only, not episodes."
    }
  };
  return configs[normalized] ? { key: normalized, monthYear, ...configs[normalized] } : null;
}

async function fetchTavilyCategoryRankEvidence(env, config = {}, timeoutMs = 9000) {
  const tavilyConfig = getTavilyClientConfig(env);
  if (!tavilyConfig.value) return { ok: false, error: getTavilyConfigError(env), tavily: getTavilyPublicStatus(env) };
  if (!config.query) return { ok: false, error: "Missing Tavily category ranking query.", tavily: getTavilyPublicStatus(env) };

  const result = await fetchJsonWithTimeout(new URL("search", TAVILY_ORIGIN), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${tavilyConfig.value}`
    },
    body: JSON.stringify({
      query: config.query,
      search_depth: "basic",
      topic: "general",
      include_answer: true,
      include_raw_content: false,
      max_results: 8
    })
  }, timeoutMs);

  const data = result.data && typeof result.data === "object" ? result.data : {};
  const evidence = Array.isArray(data.results) ? data.results.slice(0, 8).map((item, index) => ({
    index,
    title: String(item?.title || "").trim(),
    url: String(item?.url || "").trim(),
    content: normalizeTavilyEvidenceText(item?.content || item?.raw_content || ""),
    score: Number.isFinite(Number(item?.score)) ? Number(item.score) : null
  })).filter(item => item.title || item.url || item.content) : [];
  const answer = normalizeTavilyEvidenceText(data.answer || "");

  if (!result.ok || (!answer && !evidence.length)) {
    return {
      ok: false,
      status: result.status || 502,
      error: result.error || data.error || "Tavily category ranking search returned no usable evidence.",
      query: config.query,
      answer,
      evidence,
      tavily: getTavilyPublicStatus(env)
    };
  }

  return { ok: true, query: config.query, answer, evidence, tavily: getTavilyPublicStatus(env), responseTime: data.response_time || null };
}

function parseTavilyCategoryAiRankings(body = {}, fallbackType = "movie") {
  const rows = Array.isArray(body.rankings) ? body.rankings : Array.isArray(body.titles) ? body.titles : [];
  const seen = new Set();
  return rows.map((row, index) => {
    const title = String(row.title || row.name || "").trim();
    if (!title) return null;
    const key = normalizeRankTitle(title);
    if (!key || seen.has(key)) return null;
    seen.add(key);
    const year = String(row.year || "").match(/^(18|19|20)\d{2}$/)?.[0] || "";
    return {
      rank: Number(row.rank || index + 1),
      title,
      year,
      type: normalizeImdbMediaType(row.type || fallbackType),
      reason: String(row.reason || row.evidence || "").trim().slice(0, 220)
    };
  }).filter(Boolean).slice(0, 15);
}

async function extractCategoryRankingsFromTavilyEvidence(env, config = {}, tavilyResult = {}) {
  if (!env.myscreenlistAi || typeof env.myscreenlistAi.run !== "function") {
    return { ok: false, error: "Workers AI binding missing. Add binding name: myscreenlistAi." };
  }
  const evidence = Array.isArray(tavilyResult.evidence) ? tavilyResult.evidence : [];
  const evidenceText = evidence.map(item => [
    `Evidence ${item.index}:`,
    `title=${item.title}`,
    `url=${item.url}`,
    `snippet=${item.content}`
  ].join("\n")).join("\n\n");
  const systemPrompt = [
    "You extract a ranked media list for Shelfd from live Tavily search evidence.",
    "Return valid JSON only. No markdown.",
    "Use only the provided Tavily answer and evidence snippets; do not use model memory and do not invent titles.",
    "Prefer IMDb/current ranking/list/box-office evidence depending on the category guidance.",
    "For current TV trending/popular categories, prioritize currently airing seasons, weekly episode drops, current season premieres/finales, and major active streaming shows over static all-time legacy popularity.",
    "Return up to 15 unique titles in ranked order. Exclude people, articles, episodes, and duplicate titles unless the category explicitly needs episodes, which it does not.",
    "Every reason must explain the ranking signal, such as current airing, weekly episodes, IMDb popularity, box office, audience activity, top-rated evidence, or release recency.",
    "JSON shape: {\"ok\":true,\"confidence\":\"high\"|\"medium\"|\"low\",\"rankings\":[{\"rank\":number,\"title\":string,\"year\":string,\"type\":\"movie\"|\"tv\",\"reason\":string}]}"
  ].join(" ");
  const userPrompt = JSON.stringify({
    category: config.label || config.key || "Discover category",
    mediaType: config.type || "movie",
    guidance: config.guidance || "Extract a ranked list from the evidence.",
    tavilyQuery: tavilyResult.query || config.query || "",
    tavilyAnswer: tavilyResult.answer || "",
    evidence: evidenceText
  });
  try {
    const aiResult = await runWorkersAi(env, SCREENLIST_AI_MODEL, systemPrompt, userPrompt, 0.05, 900);
    const text = cleanAiJsonText(extractAiText(aiResult));
    let parsed = {};
    try { parsed = JSON.parse(text); }
    catch (error) { parsed = { ok: false, error: "AI returned non-JSON category rankings.", rawText: text }; }
    const rankings = parseTavilyCategoryAiRankings(parsed, config.type || "movie");
    if (!parsed.ok || !rankings.length) return { ok: false, error: parsed.error || parsed.note || "AI could not extract a ranked list from Tavily evidence.", rawText: parsed.rawText || "" };
    return { ok: true, confidence: String(parsed.confidence || "medium"), rankings };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function getTavilyTvCurrentActivityBoost(row = {}) {
  const text = `${row.title || ""} ${row.reason || ""}`.toLowerCase();
  let boost = 0;
  const reasons = [];
  const checks = [
    [/currently\s+airing|airing\s+now|weekly\s+episodes|new\s+episodes?/, 80, "current airing/new episodes"],
    [/new\s+season|season\s+premiere|season\s+finale|final\s+season/, 65, "active season momentum"],
    [/streaming\s+now|prime\s+video|netflix|hbo|max|hulu|disney\+|apple\s+tv|paramount\+|peacock/, 30, "active streaming signal"],
    [/imdb\s+popular|most\s+popular|trending|audience\s+activity|search\s+activity/, 25, "current popularity signal"]
  ];
  for (const [pattern, value, reason] of checks) {
    if (pattern.test(text)) {
      boost += value;
      reasons.push(reason);
    }
  }
  return { boost, reasons };
}

function applyTavilyCategoryCurrentActivityBoost(config = {}, rankings = []) {
  if (!isTvCurrentActivityRankSection(config.key)) return Array.isArray(rankings) ? rankings : [];
  return (Array.isArray(rankings) ? rankings : [])
    .map((row, index) => {
      const current = getTavilyTvCurrentActivityBoost(row);
      const score = (1000 - index * 10) + current.boost;
      const suffix = current.reasons.length ? `Current activity boost: ${current.reasons.join(', ')}` : '';
      const reason = [row.reason || '', suffix].filter(Boolean).join(' · ');
      return { ...row, reason, currentAiringBoost: current.boost, currentAiringSignals: current.reasons, currentActivityRankScore: score };
    })
    .sort((a, b) => Number(b.currentActivityRankScore || 0) - Number(a.currentActivityRankScore || 0))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

async function hydrateTavilyCategoryRankingToTmdb(env, config = {}, rankings = [], limit = 15) {
  const type = config.type === "movie" ? "movie" : "tv";
  const out = [];
  const seen = new Set();
  for (const ranked of rankings.slice(0, Math.max(limit * 2, limit))) {
    if (out.length >= limit) break;
    const title = String(ranked.title || "").trim();
    if (!title) continue;
    const params = {
      language: "en-US",
      query: title
    };
    if (ranked.year) {
      if (type === "movie") params.year = ranked.year;
      else params.first_air_date_year = ranked.year;
    }
    const search = await fetchTmdbJson(env, type === "movie" ? "search/movie" : "search/tv", params, 6500);
    const results = search.ok && Array.isArray(search.data?.results) ? search.data.results : [];
    let match = results.find(item => item?.id && item.poster_path && normalizeRankTitle(getTmdbTitle(item, type)) === normalizeRankTitle(title));
    if (!match) match = results.find(item => item?.id && item.poster_path);
    if (!match?.id || !match.poster_path) continue;
    const key = `${type}:${match.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const reason = ranked.reason || `${config.label || "Daily Tavily ranking"} #${out.length + 1}`;
    out.push({
      ...match,
      media_type: type,
      sourceLabel: `Daily Tavily ranking #${out.length + 1}${reason ? ` · ${reason}` : ""}`,
      discoverContext: `Daily Tavily ranking #${out.length + 1}${reason ? ` · ${reason}` : ""}`,
      tavilyCategoryRank: out.length + 1,
      tavilyCategoryReason: reason,
      currentAiringBoost: Number(ranked.currentAiringBoost || 0),
      currentAiringSignals: Array.isArray(ranked.currentAiringSignals) ? ranked.currentAiringSignals : [],
      rankDebug: {
        aiRank: Number(ranked.rank || out.length + 1),
        aiReason: reason,
        currentAiringBoost: Number(ranked.currentAiringBoost || 0),
        currentAiringSignals: Array.isArray(ranked.currentAiringSignals) ? ranked.currentAiringSignals : [],
        rankingSource: "tavily_search_ai_daily"
      },
      rankScore: Math.max(1, 1000 - out.length)
    });
  }
  return out;
}

async function buildTavilyCategoryRankings(env, section = "", limit = 15) {
  const config = getTavilyCategoryRankConfig(section);
  if (!config) return { ok: false, error: "Unsupported Tavily category ranking section." };
  const tavily = await fetchTavilyCategoryRankEvidence(env, config);
  if (!tavily.ok) return { ok: false, error: tavily.error || "Tavily category ranking search failed.", section: config.key, tavily };
  const ai = await extractCategoryRankingsFromTavilyEvidence(env, config, tavily);
  if (!ai.ok) return { ok: false, error: ai.error || "AI category ranking extraction failed.", section: config.key, tavily };
  const boostedRankings = applyTavilyCategoryCurrentActivityBoost(config, ai.rankings);
  const rankings = await hydrateTavilyCategoryRankingToTmdb(env, config, boostedRankings, limit);
  if (!rankings.length) return { ok: false, error: "Tavily category rankings could not be matched to TMDB display titles.", section: config.key, tavily, ai };
  return {
    ok: true,
    section: config.key,
    rankBasis: `${config.label}: daily Tavily live search evidence + Cloudflare AI extraction, then matched to TMDB for posters/cards.`,
    rankings,
    confidence: ai.confidence || "medium",
    query: tavily.query,
    guidance: config.guidance || "",
    tavilyAnswer: tavily.answer,
    tavily: tavily.tavily,
    evidence: tavily.evidence.slice(0, 4),
    debug: {
      rankingSource: "tavily_search_ai_daily",
      currentActivityBoostEnabled: isTvCurrentActivityRankSection(config.key),
      evidenceCount: Array.isArray(tavily.evidence) ? tavily.evidence.length : 0,
      generatedAt: new Date().toISOString()
    },
    sources: {
      tavily: tavily.tavily,
      ai: { configured: !!env.myscreenlistAi },
      tmdb: { configured: !!env.TMDB_KEY }
    }
  };
}

function buildMediaRankSectionFromTypeCategory(type = "", category = "", period = "") {
  const cleanType = String(type || "").trim().toLowerCase() === "movie" ? "movie" : "tv";
  const cleanCategory = String(category || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const range = String(period || "").trim().toLowerCase() === "month" ? "month" : "week";
  const prefix = cleanType === "movie" ? "movie" : "tv";
  const map = {
    trending: `${prefix}_trending`,
    popular: `${prefix}_popular`,
    top_rated: `${prefix}_top_rated`,
    toprated: `${prefix}_top_rated`,
    releasing_soon: `${prefix}_releasing_soon`,
    upcoming: `${prefix}_releasing_soon`,
    newest: `${prefix}_new_releases_${range}`,
    newest_releases: `${prefix}_new_releases_${range}`,
    new_releases: `${prefix}_new_releases_${range}`,
    in_theaters: cleanType === "movie" ? "movie_in_theaters" : "tv_trending",
    theaters: cleanType === "movie" ? "movie_in_theaters" : "tv_trending",
    years_best: cleanType === "movie" ? "movie_years_best" : "tv_trending",
    this_years_best: cleanType === "movie" ? "movie_years_best" : "tv_trending"
  };
  return map[cleanCategory] || "";
}

function normalizeMediaRankSection(value = "") {
  const raw = String(value || "trending_shows").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const tavilySection = normalizeTavilyCategorySection(raw);
  if (tavilySection) return tavilySection;
  const aliases = {
    trending_movies: "movie_trending",
    trending_shows: "tv_trending",
    new_releases_week: "movie_new_releases_week",
    new_releases_month: "movie_new_releases_month",
    years_best: "movie_years_best",
    releasing_soon: "movie_releasing_soon",
    hidden_gems: "movie_hidden_gems",
    highly_rated_classics: "movie_top_rated"
  };
  return aliases[raw] || "tv_trending";
}

async function runMediaRankEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  const explicitSection = url.searchParams.get("section") || "";
  const sectionFromTypeCategory = buildMediaRankSectionFromTypeCategory(url.searchParams.get("type"), url.searchParams.get("category"), url.searchParams.get("period"));
  const section = normalizeMediaRankSection(explicitSection || sectionFromTypeCategory);
  const limit = Math.min(15, Math.max(1, Number(url.searchParams.get("limit") || 15)));
  const cacheKey = new Request(`${url.origin}/__screenlist_rank_media/v244/${section}/daily-tavily/${limit}`, { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("x-screenlist-rank-cache", "HIT");
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }

  const tavilyDailyRank = await buildTavilyCategoryRankings(env, section, limit);
  if (tavilyDailyRank.ok && Array.isArray(tavilyDailyRank.rankings) && tavilyDailyRank.rankings.length) {
    const body = {
      ok: true,
      section,
      rankBasis: tavilyDailyRank.rankBasis,
      rankings: tavilyDailyRank.rankings.slice(0, limit),
      confidence: tavilyDailyRank.confidence || "medium",
      query: tavilyDailyRank.query || "",
      guidance: tavilyDailyRank.guidance || "",
      tavilyAnswer: tavilyDailyRank.tavilyAnswer || "",
      evidence: tavilyDailyRank.evidence || [],
      debug: tavilyDailyRank.debug || { rankingSource: "tavily_search_ai_daily", cacheStatus: "MISS" },
      sources: tavilyDailyRank.sources || { tavily: getTavilyPublicStatus(env), ai: { configured: !!env.myscreenlistAi }, tmdb: { configured: !!env.TMDB_KEY } }
    };
    const response = jsonResponse(body, 200, {
      "Cache-Control": `public, max-age=${SCREENLIST_RANK_CACHE_TTL_SECONDS}`,
      "x-screenlist-rank-cache": "MISS",
      "x-screenlist-rank-source": "tavily-daily"
    });
    if (ctx?.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
    return response;
  }

  if (getTavilyCategoryRankConfig(section)) {
    return jsonResponse({
      ok: false,
      section,
      error: tavilyDailyRank.error || "Daily Tavily category ranking could not load.",
      sources: { tavily: getTavilyPublicStatus(env), ai: { configured: !!env.myscreenlistAi }, tmdb: { configured: !!env.TMDB_KEY } }
    }, 502);
  }

  const today = new Date();
  const iso = d => d.toISOString().split("T")[0];
  const addDays = (d, days) => { const n = new Date(d); n.setDate(n.getDate() + days); return n; };
  const year = today.getFullYear();
  let rankings = [];
  let rankBasis = "Trakt activity data + TMDB metadata.";

  if (section === "trending_movies") {
    const candidates = await buildTraktActivityCandidates(env, "movie", ["trending"]);
    if (!candidates.length) {
      return jsonResponse({
        ok: false,
        error: getTraktRankFailureMessage(candidates),
        section,
        rankings: [],
        sources: { trakt: { ...getTraktPublicStatus(env), errors: candidates.traktErrors || [] }, tmdb: { configured: !!env.TMDB_KEY } }
      }, 502);
    }
    rankings = await hydrateTraktCandidates(env, "movie", candidates, { limit });
    rankBasis = "Trakt /movies/trending ranking, matched to TMDB for display.";
  } else if (section === "trending_shows") {
    const candidates = await buildTraktActivityCandidates(env, "tv", ["trending"]);
    if (!candidates.length) {
      return jsonResponse({
        ok: false,
        error: getTraktRankFailureMessage(candidates),
        section,
        rankings: [],
        sources: { trakt: { ...getTraktPublicStatus(env), errors: candidates.traktErrors || [] }, tmdb: { configured: !!env.TMDB_KEY } }
      }, 502);
    }
    rankings = await hydrateTraktCandidates(env, "tv", candidates, { limit });
    rankBasis = "Trakt /shows/trending ranking, matched to TMDB for display.";
  } else if (section === "releasing_soon") {
    const upcomingMovie = { "primary_release_date.gte": iso(addDays(today, 1)), "primary_release_date.lte": iso(addDays(today, 90)), sort_by: "primary_release_date.asc", region: "US" };
    const upcomingTv = { "first_air_date.gte": iso(addDays(today, 1)), "first_air_date.lte": iso(addDays(today, 90)), sort_by: "first_air_date.asc" };
    const [movies, shows] = await Promise.all([
      fetchTmdbRankPages(env, "movie", upcomingMovie, 3),
      fetchTmdbRankPages(env, "tv", upcomingTv, 3)
    ]);
    rankings = [...movies, ...shows]
      .filter(item => getTmdbDate(item) && getTmdbTitle(item, item.media_type || "tv") && item.overview && tmdbHasFutureDate(item))
      .sort((a, b) => {
        const dateCompare = new Date(`${getTmdbDate(a)}T00:00:00`).getTime() - new Date(`${getTmdbDate(b)}T00:00:00`).getTime();
        if (dateCompare) return dateCompare;
        const popularityCompare = Number(b.popularity || 0) - Number(a.popularity || 0);
        if (popularityCompare) return popularityCompare;
        return getTmdbTitle(a, a.media_type).localeCompare(getTmdbTitle(b, b.media_type), undefined, { sensitivity: "base" });
      })
      .map(item => ({ ...item, sourceLabel: `Releases ${getTmdbDate(item)}`, discoverContext: `Releases ${getTmdbDate(item)}` }))
      .slice(0, limit);
    rankBasis = "Raw TMDB upcoming release dates only; closest upcoming first, with popularity only as same-date tie-breaker.";
  } else {
    const days = section === "new_releases_month" ? 30 : 7;
    const recentStart = iso(addDays(today, -days));
    let movieParams = { sort_by: "popularity.desc" };
    let tvParams = { sort_by: "popularity.desc" };
    if (section.startsWith("new_releases")) {
      const [movies, shows] = await Promise.all([
        fetchTmdbRankPages(env, "movie", { "primary_release_date.gte": recentStart, "primary_release_date.lte": iso(today), sort_by: "primary_release_date.desc", region: "US" }, 3),
        fetchTmdbRankPages(env, "tv", { "first_air_date.gte": recentStart, "first_air_date.lte": iso(today), sort_by: "first_air_date.desc" }, 3)
      ]);
      rankings = [...movies, ...shows]
        .filter(item => getTmdbDate(item) && getTmdbTitle(item, item.media_type || "tv") && item.overview && !tmdbHasFutureDate(item))
        .sort((a, b) => {
          const dateCompare = new Date(`${getTmdbDate(b)}T00:00:00`).getTime() - new Date(`${getTmdbDate(a)}T00:00:00`).getTime();
          if (dateCompare) return dateCompare;
          const popularityCompare = Number(b.popularity || 0) - Number(a.popularity || 0);
          if (popularityCompare) return popularityCompare;
          return getTmdbTitle(a, a.media_type).localeCompare(getTmdbTitle(b, b.media_type), undefined, { sensitivity: "base" });
        })
        .map(item => ({ ...item, sourceLabel: `Released ${getTmdbDate(item)}`, discoverContext: `Released ${getTmdbDate(item)}` }))
        .slice(0, limit);
      rankBasis = "Raw TMDB release dates only; newest releases first, with popularity only as same-date tie-breaker.";
    } else if (section === "years_best") {
      rankings = await buildThisYearsBestRankings(env, year, iso(today));
      rankBasis = "Current-year TMDB titles ranked by vote-aware weighted rating: rating quality plus review/vote volume. Popularity and Trakt are not used as the main ranking.";
    } else if (section === "hidden_gems") {
      movieParams = { "vote_average.gte": "7.2", "vote_count.gte": "75", "vote_count.lte": "2500", sort_by: "vote_average.desc" };
      tvParams = { "vote_average.gte": "7.5", "vote_count.gte": "40", "vote_count.lte": "1600", sort_by: "vote_average.desc" };
    } else if (section === "highly_rated_classics") {
      movieParams = { "vote_count.gte": "1000", "vote_average.gte": "7.0", sort_by: "vote_average.desc" };
      tvParams = { "vote_count.gte": "500", "vote_average.gte": "7.5", sort_by: "vote_average.desc" };
    }
    if (!rankings.length && !section.startsWith("new_releases") && section !== "years_best") {
      rankings = await rankTmdbCandidatePool(env, section, movieParams, tvParams, { moviePages: 2, tvPages: 2, limit });
      rankBasis = "Existing ScreenList section rules, boosted by Trakt weekly watched/trending activity when matched.";
    }
  }

  if (!rankings.length) {
    return jsonResponse({ ok: false, error: "No ranked titles found.", section, rankings: [] }, 500);
  }

  const body = { ok: true, section, rankBasis, rankings: rankings.slice(0, limit), sources: { trakt: getTraktPublicStatus(env), tmdb: { configured: !!env.TMDB_KEY } } };
  const response = jsonResponse(body, 200, {
    "Cache-Control": `public, max-age=${SCREENLIST_RANK_CACHE_TTL_SECONDS}`,
    "x-screenlist-rank-cache": "MISS"
  });
  if (ctx?.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

const SCREENLIST_DISCOVERY_IMDB_REFRESH_SECTIONS = [
  "movie_new_releases_week",
  "movie_new_releases_month",
  "movie_in_theaters",
  "movie_years_best",
  "movie_popular",
  "movie_top_rated",
  "movie_trending",
  "movie_releasing_soon",
  "movie_hidden_gems",
  "tv_new_releases_week",
  "tv_new_releases_month",
  "tv_trending",
  "tv_popular",
  "tv_releasing_soon",
  "tv_top_rated"
];

function isFiveAmEastern(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(date);
    const hour = parts.find(part => part.type === "hour")?.value || "";
    const minute = parts.find(part => part.type === "minute")?.value || "";
    return hour === "05" && minute === "00";
  } catch (error) {
    return false;
  }
}

function normalizeDiscoveryImdbRefreshItem(item = {}) {
  const type = normalizeImdbMediaType(item.media_type || item.tmdbType || item.type || (item.first_air_date || item.name ? "tv" : "movie"));
  const tmdbId = String(item.tmdbId || item.id || item.tmdb_id || "").trim();
  const title = String(item.title || item.name || item.original_title || item.original_name || "").trim();
  const dateValue = String(item.release_date || item.first_air_date || item.year || "").trim();
  return {
    type,
    tmdbId,
    id: tmdbId,
    imdbId: item.imdbId || item.imdb_id || "",
    title,
    year: dateValue.slice(0, 4)
  };
}

async function refreshDiscoveryPresetImdbRatings(env, ctx, options = {}) {
  const origin = new URL(options.origin || "https://myshelfd.com");
  const sections = Array.isArray(options.sections) && options.sections.length
    ? options.sections
    : SCREENLIST_DISCOVERY_IMDB_REFRESH_SECTIONS;
  const perSectionLimit = Math.min(15, Math.max(1, Number(options.limit || 15)));
  const summary = {
    ok: true,
    startedAt: new Date().toISOString(),
    sections: [],
    refreshed: 0,
    failed: 0
  };

  for (const section of sections) {
    const cleanSection = normalizeMediaRankSection(section);
    const sectionSummary = { section: cleanSection || section, items: 0, refreshed: 0, failed: 0 };
    summary.sections.push(sectionSummary);
    if (!cleanSection) {
      sectionSummary.failed += 1;
      summary.failed += 1;
      continue;
    }
    try {
      const requestUrl = new URL("/api/rank/media", origin);
      requestUrl.searchParams.set("section", cleanSection);
      requestUrl.searchParams.set("period", "week");
      requestUrl.searchParams.set("limit", String(perSectionLimit));
      const rankResponse = await runMediaRankEndpoint(new Request(requestUrl.toString(), { method: "GET" }), env, ctx);
      const rankBody = await rankResponse.json();
      const rankings = Array.isArray(rankBody?.rankings) ? rankBody.rankings.slice(0, perSectionLimit) : [];
      sectionSummary.items = rankings.length;
      for (const row of rankings) {
        const refreshItem = normalizeDiscoveryImdbRefreshItem(row);
        if (!refreshItem.tmdbId && !refreshItem.imdbId && !refreshItem.title) {
          sectionSummary.failed += 1;
          summary.failed += 1;
          continue;
        }
        try {
          const result = await getCachedImdbRatingForItem(env, ctx, origin, refreshItem, { force: true });
          if (result?.ok) {
            sectionSummary.refreshed += 1;
            summary.refreshed += 1;
          } else {
            sectionSummary.failed += 1;
            summary.failed += 1;
          }
        } catch (error) {
          sectionSummary.failed += 1;
          summary.failed += 1;
        }
      }
    } catch (error) {
      sectionSummary.error = errorMessage(error);
      sectionSummary.failed += 1;
      summary.failed += 1;
    }
  }

  summary.finishedAt = new Date().toISOString();
  return summary;
}

async function runScheduledImdbRefresh(controller, env, ctx) {
  const scheduledAt = controller?.scheduledTime ? new Date(controller.scheduledTime) : new Date();
  if (!isFiveAmEastern(scheduledAt)) {
    return { ok: true, skipped: true, reason: "Not 5:00 AM America/New_York.", scheduledAt: scheduledAt.toISOString() };
  }
  return refreshDiscoveryPresetImdbRatings(env, ctx, { origin: "https://myshelfd.com", limit: 15 });
}

/* v10.236: manual on-demand trigger for the same discovery-rating refresh the
   5am cron runs — force-repopulates the Cloudflare rating cache so fresh-release
   cards (which now read the LIVE IMDb title page via Tavily extract) update
   immediately instead of waiting for 5am. Gated by a token secret so it can't
   be abused into runaway Tavily/OMDb cost. Accepts ?section=/&sections= to
   refresh one rail at a time (keeps each request well under subrequest limits),
   ?limit= (default 15), and ?token=. */
const DISCOVERY_REFRESH_TOKEN_ENV_NAMES = ["DISCOVERY_REFRESH_TOKEN", "IMDB_REFRESH_TOKEN", "ADMIN_REFRESH_TOKEN"];

function getDiscoveryRefreshToken(env) {
  for (const name of DISCOVERY_REFRESH_TOKEN_ENV_NAMES) {
    const value = getEnvString(env, name);
    if (value) return value;
  }
  return "";
}

async function runDiscoveryRatingRefreshEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  const configuredToken = getDiscoveryRefreshToken(env);
  if (!configuredToken) {
    return jsonResponse({ ok: false, error: `Refresh token not configured. Add a Cloudflare Worker secret named ${DISCOVERY_REFRESH_TOKEN_ENV_NAMES[0]}.` }, 503, { "Cache-Control": "no-store" });
  }
  const provided = String(url.searchParams.get("token") || request.headers.get("x-refresh-token") || "").trim();
  if (!provided || provided !== configuredToken) {
    return jsonResponse({ ok: false, error: "Unauthorized." }, 401, { "Cache-Control": "no-store" });
  }

  const sectionsParam = String(url.searchParams.get("sections") || url.searchParams.get("section") || "").trim();
  const sections = sectionsParam
    ? sectionsParam.split(",").map(s => s.trim()).filter(Boolean)
    : SCREENLIST_DISCOVERY_IMDB_REFRESH_SECTIONS;
  const limit = Math.min(15, Math.max(1, parseInt(url.searchParams.get("limit") || "15", 10) || 15));

  const summary = await refreshDiscoveryPresetImdbRatings(env, ctx, {
    origin: url.origin,
    sections,
    limit
  });
  return jsonResponse(summary, summary.ok ? 200 : 500, { "Cache-Control": "no-store" });
}

async function runCountryRankEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  const country = normalizeRankCountry(url.searchParams.get("country"));
  const type = normalizeRankMediaType(url.searchParams.get("type"));
  const period = "week";
  const countryLabel = getRankCountryLabel(country);
  const cacheKey = new Request(`${url.origin}/__screenlist_rank_country/${country}/${type}/${period}/trakt-first`, { method: "GET" });

  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("x-screenlist-rank-cache", "HIT");
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }

  const traktCandidates = await buildTraktActivityCandidates(env, type, ["watched", "trending"]);
  let rankings = await hydrateTraktCandidates(env, type, traktCandidates, { limit: 10, country, scanLimit: 90 });

  if (rankings.length < 4) {
    const tmdbConfig = buildCountryRankParams(type, country);
    const tmdb = await fetchTmdbJson(env, tmdbConfig.path, tmdbConfig.params, 8500);
    if (tmdb.ok && Array.isArray(tmdb.data?.results)) {
      const lookup = await buildTraktActivityLookup(env, type);
      const fallback = tmdb.data.results
        .filter(item => item && item.id && item.poster_path)
        .map(item => {
          const candidate = findTraktActivityForTmdbItem(item, type, lookup);
          const activity = Number(candidate?.metric || 0);
          const rating = Number(item.vote_average || 0);
          const votes = Number(item.vote_count || 0);
          const popularity = Number(item.popularity || 0);
          const sourceLabel = labelRankedTmdbItem(item, type, "country_origin", candidate) || `${countryLabel} origin · TMDB popularity`;
          return {
            ...item,
            media_type: type,
            sourceLabel,
            discoverContext: sourceLabel,
            countryOrigin: country,
            countryLabel,
            traktActivity: roundRankNumber(activity, 1),
            rankScore: activity * 100 + popularity + rating * 7 + Math.log10(votes + 1) * 12
          };
        });
      rankings = [...rankings, ...fallback]
        .filter((item, index, arr) => index === arr.findIndex(x => `${x.media_type}:${x.id}` === `${item.media_type}:${item.id}`))
        .sort((a, b) => Number(b.rankScore || 0) - Number(a.rankScore || 0))
        .slice(0, 10);
    }
  }

  if (!rankings.length) {
    return jsonResponse({
      ok: false,
      error: "Country rankings could not load.",
      country,
      countryLabel,
      type,
      period,
      sources: { trakt: { ok: false }, tmdb: { ok: !!env.TMDB_KEY } }
    }, 500);
  }

  const matchedTraktCount = rankings.filter(item => Number(item.traktActivity || 0) > 0).length;
  const body = {
    ok: true,
    country,
    countryLabel,
    type,
    period,
    rankBasis: "Trakt weekly watched/trending activity first, matched to TMDB details and filtered by country of origin. TMDB origin/popularity is only used as fallback when Trakt does not return enough country matches.",
    rankings,
    sources: {
      tmdb: { ok: true },
      trakt: { ok: true, matched: matchedTraktCount }
    }
  };

  const response = jsonResponse(body, 200, {
    "Cache-Control": `public, max-age=${SCREENLIST_RANK_CACHE_TTL_SECONDS}`,
    "x-screenlist-rank-cache": "MISS"
  });
  if (ctx?.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

async function runSteamConnectStart(request, env) {
  if (!getSteamApiConfig(env).value) {
    return buildRedirectResponse(buildSteamAppRedirectUrl(new URL(request.url), {
      steam_auth: "error",
      steam_message: getSteamConfigError(env)
    }));
  }
  const url = new URL(request.url);
  const state = crypto.randomUUID();
  const returnTo = buildSteamCallbackUrl(url, state);
  const steamAuthUrl = new URL("/openid/login", STEAM_OPENID_ORIGIN);
  steamAuthUrl.searchParams.set("openid.ns", "http://specs.openid.net/auth/2.0");
  steamAuthUrl.searchParams.set("openid.mode", "checkid_setup");
  steamAuthUrl.searchParams.set("openid.return_to", returnTo);
  steamAuthUrl.searchParams.set("openid.realm", url.origin);
  steamAuthUrl.searchParams.set("openid.identity", "http://specs.openid.net/auth/2.0/identifier_select");
  steamAuthUrl.searchParams.set("openid.claimed_id", "http://specs.openid.net/auth/2.0/identifier_select");
  return buildRedirectResponse(steamAuthUrl.toString(), buildSteamStateCookie(state));
}

async function runSteamConnectCallback(request, env) {
  const url = new URL(request.url);
  const returnedState = String(url.searchParams.get("state") || "").trim();
  const cookieState = readCookie(request, STEAM_STATE_COOKIE);
  const clearCookie = clearSteamStateCookie();
  if (!returnedState || !cookieState || returnedState !== cookieState) {
    return buildRedirectResponse(buildSteamAppRedirectUrl(url, {
      steam_auth: "error",
      steam_message: "Steam sign-in expired. Try connecting again."
    }), clearCookie);
  }
  const claimedId = String(url.searchParams.get("openid.claimed_id") || "").trim();
  const identity = String(url.searchParams.get("openid.identity") || "").trim();
  const steamId = extractSteamIdFromClaimedId(claimedId);
  if (!steamId || identity !== claimedId) {
    return buildRedirectResponse(buildSteamAppRedirectUrl(url, {
      steam_auth: "error",
      steam_message: "Steam sign-in did not return a valid SteamID."
    }), clearCookie);
  }
  const verification = await verifySteamOpenIdResponse(url);
  if (!verification.ok) {
    return buildRedirectResponse(buildSteamAppRedirectUrl(url, {
      steam_auth: "error",
      steam_message: verification.error || "Steam sign-in verification failed."
    }), clearCookie);
  }
  return buildRedirectResponse(buildSteamAppRedirectUrl(url, {
    steam_auth: "success",
    steam_id: steamId
  }), clearCookie);
}

async function runSteamProfileEndpoint(request, env) {
  const url = new URL(request.url);
  const steamId = normalizeSteamId(url.searchParams.get("steamId") || "");
  if (!steamId) {
    return jsonResponse({ ok: false, error: "Missing steamId." }, 400);
  }
  const result = await fetchSteamPlayerSummary(env, steamId);
  if (!result.ok) {
    return jsonResponse({
      ok: false,
      error: result.error || "Steam profile lookup failed.",
      steam: result.steam || getSteamPublicStatus(env)
    }, result.status || 502);
  }
  const player = result.data || {};
  return jsonResponse({
    ok: true,
    steam: result.steam || getSteamPublicStatus(env),
    player: {
      steamId,
      personaName: player.personaname || "",
      profileUrl: player.profileurl || "",
      avatar: player.avatarfull || player.avatarmedium || player.avatar || ""
    }
  });
}

async function runSteamLibraryEndpoint(request, env) {
  const url = new URL(request.url);
  const steamId = normalizeSteamId(url.searchParams.get("steamId") || "");
  if (!steamId) {
    return jsonResponse({ ok: false, error: "Missing steamId." }, 400);
  }
  const [profileResult, libraryResult] = await Promise.all([
    fetchSteamPlayerSummary(env, steamId, 8000),
    fetchSteamOwnedGames(env, steamId, 10000)
  ]);
  if (!libraryResult.ok) {
    return jsonResponse({
      ok: false,
      error: libraryResult.error || "Steam library lookup failed.",
      steam: libraryResult.steam || getSteamPublicStatus(env)
    }, libraryResult.status || 502);
  }
  const games = (libraryResult.data?.games || []).map(game => ({
    appId: String(game.appid || ""),
    name: game.name || "",
    playtimeMinutes: Number(game.playtime_forever || 0) || 0,
    playtimeWindowsMinutes: Number(game.playtime_windows_forever || 0) || 0,
    playtimeMacMinutes: Number(game.playtime_mac_forever || 0) || 0,
    playtimeLinuxMinutes: Number(game.playtime_linux_forever || 0) || 0,
    lastPlayedAt: normalizeSteamLastPlayed(game.rtime_last_played),
    iconUrl: buildSteamCommunityAssetUrl(game.appid, game.img_icon_url),
    logoUrl: buildSteamCommunityAssetUrl(game.appid, game.img_logo_url),
    storeUrl: buildSteamStoreUrl(game.appid)
  }));
  return jsonResponse({
    ok: true,
    steam: libraryResult.steam || getSteamPublicStatus(env),
    player: profileResult.ok ? {
      steamId,
      personaName: profileResult.data?.personaname || "",
      profileUrl: profileResult.data?.profileurl || "",
      avatar: profileResult.data?.avatarfull || profileResult.data?.avatarmedium || profileResult.data?.avatar || ""
    } : { steamId },
    totals: {
      owned: Number(libraryResult.data?.game_count || games.length || 0),
      played: games.filter(game => Number(game.playtimeMinutes || 0) > 0).length
    },
    games
  });
}

/* =============================================================================
   Xbox account sync (v11.486)
   -----------------------------------------------------------------------------
   Official Microsoft OAuth -> Xbox Live (XBL) -> XSTS token exchange, ALL
   server-side. The Microsoft client secret and the user's refresh/XSTS tokens
   never reach the client: the connect callback stores the refresh token in KV
   (PUSH_TOKENS_KV) under an opaque linkToken and hands the client only that
   linkToken + public profile (gamertag / gamerpic / xuid). Mirrors the Steam
   proxy shape. ENTIRELY config-gated: with no XBOX_CLIENT_ID / XBOX_CLIENT_SECRET
   secret set, every route returns a clear "not configured" error and the UI
   shows a Setup-required state — production is unaffected.
   ============================================================================= */
const XBOX_CLIENT_ID_ENV_NAMES = ["XBOX_CLIENT_ID", "MS_CLIENT_ID"];
const XBOX_CLIENT_SECRET_ENV_NAMES = ["XBOX_CLIENT_SECRET", "MS_CLIENT_SECRET"];
const XBOX_REDIRECT_URI_ENV_NAMES = ["XBOX_REDIRECT_URI", "MS_REDIRECT_URI"];
const XBOX_OAUTH_AUTHORIZE = "https://login.live.com/oauth20_authorize.srf";
const XBOX_OAUTH_TOKEN = "https://login.live.com/oauth20_token.srf";
const XBOX_OAUTH_SCOPE = "XboxLive.signin XboxLive.offline_access";
const XBOX_STATE_COOKIE = "xbox_oauth_state";
const XBOX_LINK_TTL_SECONDS = 60 * 60 * 24 * 120; // 120 days

function getXboxEnvValue(env, names) {
  for (const name of names) {
    const value = getEnvString(env, name);
    if (value) return { name, value };
  }
  return { name: "", value: "" };
}

function getXboxConfig(env) {
  return {
    clientId: getXboxEnvValue(env, XBOX_CLIENT_ID_ENV_NAMES).value,
    clientSecret: getXboxEnvValue(env, XBOX_CLIENT_SECRET_ENV_NAMES).value,
    redirectUri: getXboxEnvValue(env, XBOX_REDIRECT_URI_ENV_NAMES).value
  };
}

function getXboxPublicStatus(env) {
  const cfg = getXboxConfig(env);
  return {
    configured: !!(cfg.clientId && cfg.clientSecret),
    hasRedirectUri: !!cfg.redirectUri,
    kvBound: !!(env && env.PUSH_TOKENS_KV)
  };
}

function getXboxConfigError(env) {
  const cfg = getXboxConfig(env);
  if (!cfg.clientId || !cfg.clientSecret) {
    return "Xbox sign-in is not configured. Add Cloudflare Worker secrets XBOX_CLIENT_ID and XBOX_CLIENT_SECRET (from an Azure app registration), plus XBOX_REDIRECT_URI.";
  }
  if (!(env && env.PUSH_TOKENS_KV)) {
    return "Xbox token storage (PUSH_TOKENS_KV) is not bound. Bind the KV namespace in wrangler.jsonc.";
  }
  return "";
}

function xboxResolveRedirectUri(env, requestUrl) {
  const cfg = getXboxConfig(env);
  if (cfg.redirectUri) return cfg.redirectUri;
  return requestUrl ? new URL("/api/xbox/callback", requestUrl.origin).toString() : "";
}

function buildXboxAppRedirectUrl(originOrUrl, params = {}) {
  const origin = typeof originOrUrl === "string" ? originOrUrl : originOrUrl.origin;
  const redirectUrl = new URL("/", origin);
  redirectUrl.searchParams.set("xbox_import", "1");
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") redirectUrl.searchParams.set(key, String(value));
  });
  return redirectUrl.toString();
}

function buildXboxStateCookie(state) {
  return `${XBOX_STATE_COOKIE}=${encodeURIComponent(state)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}
function clearXboxStateCookie() {
  return `${XBOX_STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function xboxFetchJson(targetUrl, options = {}, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(targetUrl, { ...options, signal: controller.signal });
    let data = null;
    try { data = await res.json(); } catch (_) { data = null; }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: (err && err.message) || "request failed" };
  } finally {
    clearTimeout(timer);
  }
}

// MS token endpoint (auth-code or refresh_token grant). redirect_uri is only sent
// for the auth-code grant (requestUrl provided) or when explicitly configured.
async function xboxExchangeMsToken(env, params, requestUrl) {
  const cfg = getXboxConfig(env);
  const form = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params });
  const redirectUri = cfg.redirectUri || (requestUrl ? new URL("/api/xbox/callback", requestUrl.origin).toString() : "");
  if (redirectUri) form.set("redirect_uri", redirectUri);
  return xboxFetchJson(XBOX_OAUTH_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
}

async function xboxAuthenticateUser(msAccessToken) {
  return xboxFetchJson("https://user.auth.xboxlive.com/user/authenticate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json", "x-xbl-contract-version": "1" },
    body: JSON.stringify({
      RelyingParty: "http://auth.xboxlive.com",
      TokenType: "JWT",
      Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: `d=${msAccessToken}` }
    })
  });
}

async function xboxAuthorizeXsts(xblToken) {
  return xboxFetchJson("https://xsts.auth.xboxlive.com/xsts/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json", "x-xbl-contract-version": "1" },
    body: JSON.stringify({
      RelyingParty: "http://xboxlive.com",
      TokenType: "JWT",
      Properties: { UserTokens: [xblToken], SandboxId: "RETAIL" }
    })
  });
}

function xboxXblHeaders(uhs, xstsToken) {
  return {
    "Authorization": `XBL3.0 x=${uhs};${xstsToken}`,
    "x-xbl-contract-version": "2",
    "Accept": "application/json",
    "Accept-Language": "en-US"
  };
}

// MS access token -> XBL user token -> XSTS -> { xstsToken, uhs, xuid, gamertag }
async function xboxBuildSessionFromMsToken(msAccessToken) {
  const userAuth = await xboxAuthenticateUser(msAccessToken);
  const xblToken = userAuth.data && userAuth.data.Token;
  if (!userAuth.ok || !xblToken) return { ok: false, error: "Xbox Live user authentication failed." };
  const xsts = await xboxAuthorizeXsts(xblToken);
  const xstsToken = xsts.data && xsts.data.Token;
  const claims = xsts.data && xsts.data.DisplayClaims && xsts.data.DisplayClaims.xui && xsts.data.DisplayClaims.xui[0];
  if (!xsts.ok || !xstsToken || !claims) {
    const xerr = xsts.data && xsts.data.XErr;
    return { ok: false, error: xerr ? `Xbox sign-in failed (XErr ${xerr}). The account may need to finish Xbox profile setup.` : "Xbox XSTS authorization failed." };
  }
  return { ok: true, xstsToken, uhs: String(claims.uhs || ""), xuid: String(claims.xid || ""), gamertag: String(claims.gtg || "") };
}

async function xboxFetchProfile(session) {
  const settings = "Gamertag,ModernGamertag,GameDisplayPicRaw,Gamerscore";
  const res = await xboxFetchJson(
    `https://profile.xboxlive.com/users/xuid(${encodeURIComponent(session.xuid)})/profile/settings?settings=${encodeURIComponent(settings)}`,
    { headers: xboxXblHeaders(session.uhs, session.xstsToken) }
  );
  const user = res.data && res.data.profileUsers && res.data.profileUsers[0];
  const map = {};
  if (user && Array.isArray(user.settings)) user.settings.forEach(s => { if (s && s.id) map[s.id] = s.value; });
  return {
    ok: res.ok,
    status: res.status,
    profile: {
      xuid: session.xuid,
      gamertag: map.ModernGamertag || map.Gamertag || session.gamertag || "",
      gamerpic: map.GameDisplayPicRaw || "",
      gamerscore: Number(map.Gamerscore || 0) || 0
    }
  };
}

async function xboxFetchTitles(session) {
  const res = await xboxFetchJson(
    `https://titlehub.xboxlive.com/users/xuid(${encodeURIComponent(session.xuid)})/titles/titlehistory/decoration/achievement,scid`,
    { headers: xboxXblHeaders(session.uhs, session.xstsToken) }
  );
  const titles = (res.data && Array.isArray(res.data.titles)) ? res.data.titles : [];
  const games = titles.map(t => {
    const ach = t.achievement || {};
    const hist = t.titleHistory || {};
    const images = Array.isArray(t.images) ? t.images : [];
    const box = images.find(im => im && /BoxArt|Poster|Tile/i.test(String(im.type))) || images[0] || {};
    return {
      titleId: String(t.titleId || ""),
      serviceConfigId: String(t.serviceConfigId || ""),
      productId: String((t.detail && t.detail.productId) || ""),
      name: String(t.name || ""),
      displayImage: String(t.displayImage || box.url || ""),
      lastPlayedAt: String(hist.lastTimePlayed || ""),
      achievementsUnlocked: Number(ach.currentAchievements || 0) || 0,
      achievementsTotal: Number(ach.totalAchievements || 0) || 0,
      gamerscore: Number(ach.currentGamerscore || 0) || 0,
      gamerscoreTotal: Number(ach.totalGamerscore || 0) || 0,
      achievementPercent: Number(ach.progressPercentage || 0) || 0
    };
  }).filter(g => g.titleId && g.name);
  return { ok: res.ok, status: res.status, games };
}

// Load a stored Xbox link from KV and refresh it into a live XSTS session.
async function xboxLoadSession(env, linkToken) {
  const clean = String(linkToken || "").trim();
  if (!clean) return { ok: false, status: 400, error: "Missing Xbox link token." };
  const kv = env && env.PUSH_TOKENS_KV;
  if (!kv) return { ok: false, status: 500, error: getXboxConfigError(env) || "Xbox token storage unavailable." };
  let stored = null;
  try { stored = await kv.get(`xbox:link:${clean}`, { type: "json" }); } catch (_) { stored = null; }
  if (!stored || !stored.refreshToken) return { ok: false, status: 401, error: "Xbox connection expired. Reconnect Xbox." };
  const refreshed = await xboxExchangeMsToken(env, { grant_type: "refresh_token", refresh_token: stored.refreshToken, scope: XBOX_OAUTH_SCOPE });
  const msToken = refreshed.data && refreshed.data.access_token;
  if (!refreshed.ok || !msToken) return { ok: false, status: 401, error: "Xbox session refresh failed. Reconnect Xbox." };
  if (refreshed.data.refresh_token && refreshed.data.refresh_token !== stored.refreshToken) {
    try { await kv.put(`xbox:link:${clean}`, JSON.stringify({ ...stored, refreshToken: refreshed.data.refresh_token, updatedAt: new Date().toISOString() }), { expirationTtl: XBOX_LINK_TTL_SECONDS }); } catch (_) {}
  }
  const session = await xboxBuildSessionFromMsToken(msToken);
  if (!session.ok) return { ok: false, status: 502, error: session.error };
  session.xuid = session.xuid || stored.xuid || "";
  session.gamertag = session.gamertag || stored.gamertag || "";
  return { ok: true, status: 200, session, stored };
}

function runXboxConfigEndpoint(request, env) {
  return jsonResponse({ ok: true, xbox: getXboxPublicStatus(env) });
}

async function runXboxConnectStart(request, env) {
  const url = new URL(request.url);
  if (!getXboxPublicStatus(env).configured) {
    return buildRedirectResponse(buildXboxAppRedirectUrl(url, { xbox_auth: "error", xbox_message: getXboxConfigError(env) }));
  }
  const cfg = getXboxConfig(env);
  const state = crypto.randomUUID();
  /* v11.490: persist the OAuth state + the origin the user started from in KV.
     A state cookie alone is unreliable across the cross-site Microsoft redirect
     inside the iOS WKWebView, and breaks when the app origin differs from the
     fixed redirect_uri host (e.g. www vs non-www) — which is what produced
     "Xbox sign-in expired". KV is host-independent, and storing the origin lets
     the callback bounce the user back to the exact origin they started on so
     their signed-in Shelfd session stays intact. The cookie is still set as a
     same-origin fallback. */
  if (env && env.PUSH_TOKENS_KV) {
    try { await env.PUSH_TOKENS_KV.put(`xbox:state:${state}`, JSON.stringify({ origin: url.origin, at: Date.now() }), { expirationTtl: 900 }); } catch (_) {}
  }
  const authUrl = new URL(XBOX_OAUTH_AUTHORIZE);
  authUrl.searchParams.set("client_id", cfg.clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", xboxResolveRedirectUri(env, url));
  authUrl.searchParams.set("scope", XBOX_OAUTH_SCOPE);
  authUrl.searchParams.set("state", state);
  return buildRedirectResponse(authUrl.toString(), buildXboxStateCookie(state));
}

async function runXboxConnectCallback(request, env) {
  const url = new URL(request.url);
  const clearCookie = clearXboxStateCookie();
  const kv = env && env.PUSH_TOKENS_KV;
  const returnedState = String(url.searchParams.get("state") || "").trim();
  /* v11.490: validate state via KV (host-independent) OR the same-origin cookie
     fallback, and recover the origin the user started on so we bounce them back to
     the same Shelfd session instead of a different host. */
  let stateRec = null;
  if (kv && returnedState) {
    try { stateRec = await kv.get(`xbox:state:${returnedState}`, { type: "json" }); } catch (_) {}
    try { await kv.delete(`xbox:state:${returnedState}`); } catch (_) {}
  }
  const cookieState = readCookie(request, XBOX_STATE_COOKIE);
  const stateValid = !!returnedState && (!!stateRec || (!!cookieState && cookieState === returnedState));
  const appOrigin = (stateRec && stateRec.origin) || url.origin;
  const back = (params) => buildRedirectResponse(buildXboxAppRedirectUrl(appOrigin, params), clearCookie);

  const errorParam = String(url.searchParams.get("error") || "").trim();
  if (errorParam) {
    return back({ xbox_auth: "error", xbox_message: String(url.searchParams.get("error_description") || errorParam) });
  }
  const code = String(url.searchParams.get("code") || "").trim();
  if (!code || !stateValid) {
    return back({ xbox_auth: "error", xbox_message: "Xbox sign-in expired. Try connecting again." });
  }
  if (!getXboxPublicStatus(env).configured || !kv) {
    return back({ xbox_auth: "error", xbox_message: getXboxConfigError(env) });
  }
  const tokenRes = await xboxExchangeMsToken(env, { grant_type: "authorization_code", code, scope: XBOX_OAUTH_SCOPE }, url);
  const msToken = tokenRes.data && tokenRes.data.access_token;
  const refreshToken = tokenRes.data && tokenRes.data.refresh_token;
  if (!tokenRes.ok || !msToken) {
    return back({ xbox_auth: "error", xbox_message: "Microsoft sign-in could not be completed." });
  }
  const session = await xboxBuildSessionFromMsToken(msToken);
  if (!session.ok) {
    return back({ xbox_auth: "error", xbox_message: session.error });
  }
  const profileRes = await xboxFetchProfile(session);
  const profile = profileRes.profile || {};
  const linkToken = crypto.randomUUID();
  try {
    await kv.put(`xbox:link:${linkToken}`, JSON.stringify({
      xuid: session.xuid, gamertag: profile.gamertag || session.gamertag, refreshToken, createdAt: new Date().toISOString()
    }), { expirationTtl: XBOX_LINK_TTL_SECONDS });
  } catch (_) {
    return back({ xbox_auth: "error", xbox_message: "Could not save the Xbox connection. Try again." });
  }
  return back({
    xbox_auth: "success",
    xbox_link: linkToken,
    xbox_xuid: session.xuid,
    xbox_gamertag: profile.gamertag || session.gamertag,
    xbox_gamerpic: profile.gamerpic || "",
    xbox_gamerscore: String(profile.gamerscore || 0)
  });
}

async function runXboxProfileEndpoint(request, env) {
  const url = new URL(request.url);
  const loaded = await xboxLoadSession(env, url.searchParams.get("link"));
  if (!loaded.ok) return jsonResponse({ ok: false, error: loaded.error, xbox: getXboxPublicStatus(env) }, loaded.status || 502);
  const profileRes = await xboxFetchProfile(loaded.session);
  return jsonResponse({ ok: true, xbox: getXboxPublicStatus(env), player: profileRes.profile });
}

async function runXboxLibraryEndpoint(request, env) {
  const url = new URL(request.url);
  const loaded = await xboxLoadSession(env, url.searchParams.get("link"));
  if (!loaded.ok) return jsonResponse({ ok: false, error: loaded.error, xbox: getXboxPublicStatus(env) }, loaded.status || 502);
  const [profileRes, titlesRes] = await Promise.all([xboxFetchProfile(loaded.session), xboxFetchTitles(loaded.session)]);
  if (!titlesRes.ok) return jsonResponse({ ok: false, error: "Xbox title history lookup failed.", xbox: getXboxPublicStatus(env) }, titlesRes.status || 502);
  return jsonResponse({
    ok: true,
    xbox: getXboxPublicStatus(env),
    player: profileRes.profile,
    totals: { owned: titlesRes.games.length, played: titlesRes.games.filter(g => g.lastPlayedAt).length },
    games: titlesRes.games
  });
}

async function runXboxAchievementsEndpoint(request, env) {
  const url = new URL(request.url);
  const titleId = String(url.searchParams.get("titleId") || "").trim();
  if (!titleId) return jsonResponse({ ok: false, error: "Missing titleId." }, 400);
  const loaded = await xboxLoadSession(env, url.searchParams.get("link"));
  if (!loaded.ok) return jsonResponse({ ok: false, error: loaded.error, xbox: getXboxPublicStatus(env) }, loaded.status || 502);
  const res = await xboxFetchJson(
    `https://achievements.xboxlive.com/users/xuid(${encodeURIComponent(loaded.session.xuid)})/achievements?titleId=${encodeURIComponent(titleId)}&maxItems=1000`,
    { headers: xboxXblHeaders(loaded.session.uhs, loaded.session.xstsToken) }
  );
  const list = (res.data && Array.isArray(res.data.achievements)) ? res.data.achievements : [];
  const achievements = list.map(a => ({
    id: String(a.id || ""),
    name: String(a.name || ""),
    unlocked: String(a.progressState || "") === "Achieved",
    unlockedAt: String((a.progression && a.progression.timeUnlocked) || ""),
    gamerscore: Number((Array.isArray(a.rewards) ? ((a.rewards.find(r => r && r.type === "Gamerscore") || {}).value) : 0) || 0) || 0
  }));
  return jsonResponse({ ok: true, xbox: getXboxPublicStatus(env), titleId, achievements });
}

async function runXboxDisconnectEndpoint(request, env) {
  const url = new URL(request.url);
  const linkToken = String(url.searchParams.get("link") || "").trim();
  const kv = env && env.PUSH_TOKENS_KV;
  if (linkToken && kv) {
    try { await kv.delete(`xbox:link:${linkToken}`); } catch (_) {}
  }
  return jsonResponse({ ok: true });
}

/* =============================================================================
   Steam achievements (v11.385)
   -----------------------------------------------------------------------------
   GET /api/steam/achievements?appid=&steamId= merges, per Steam title:
     • ISteamUserStats/GetSchemaForGame/v2                    → names/icons/descs
     • ISteamUserStats/GetPlayerAchievements/v0001            → achieved + time
     • ISteamUserStats/GetGlobalAchievementPercentagesForApp  → rarity %
     • store appdetails (categories)                          → single-player gate
   The Steam Web API key stays server-side (STEAM_API_KEY secret); the per-user
   merge is cached briefly via the Cache API (schema/rarity/categories are
   effectively static, but caching the merged result is simplest + correct).
   ========================================================================== */
const STEAM_ACHIEVEMENTS_RESULT_TTL = 60 * 10; // seconds

async function fetchSteamGameSchema(env, appId, lang = "english", timeoutMs = 9000) {
  const cleanAppId = String(appId || "").trim();
  if (!cleanAppId) return { ok: false, achievements: [], gameName: "" };
  const result = await fetchSteamJson(env, "/ISteamUserStats/GetSchemaForGame/v2/", { appid: cleanAppId, l: lang }, timeoutMs);
  if (!result.ok) return { ok: false, achievements: [], gameName: "", error: result.error };
  const game = result.data?.game || {};
  const list = Array.isArray(game?.availableGameStats?.achievements) ? game.availableGameStats.achievements : [];
  const achievements = list.map(a => ({
    apiName: String(a.name || ""),
    name: String(a.displayName || a.name || ""),
    description: String(a.description || ""),
    hidden: Number(a.hidden || 0) === 1,
    icon: String(a.icon || ""),
    iconGray: String(a.icongray || "")
  })).filter(a => a.apiName);
  return { ok: true, achievements, gameName: String(game.gameName || "") };
}

async function fetchSteamPlayerAchievements(env, steamId, appId, lang = "english", timeoutMs = 9000) {
  const cleanSteamId = normalizeSteamId(steamId);
  const cleanAppId = String(appId || "").trim();
  if (!cleanSteamId || !cleanAppId) return { ok: false, private: false, noStats: false, achievements: [] };
  const result = await fetchSteamJson(env, "/ISteamUserStats/GetPlayerAchievements/v0001/", { steamid: cleanSteamId, appid: cleanAppId, l: lang }, timeoutMs);
  const stats = result.data?.playerstats || {};
  if (!stats.success) {
    const msg = String(stats.error || result.error || "").toLowerCase();
    const isPrivate = /not public|private|profile/.test(msg);
    const noStats = /no stats|no achievements|stats for/.test(msg);
    return { ok: false, private: isPrivate, noStats, achievements: [], error: stats.error || result.error || "" };
  }
  const achievements = (Array.isArray(stats.achievements) ? stats.achievements : []).map(a => ({
    apiName: String(a.apiname || a.name || ""),
    achieved: Number(a.achieved || 0) === 1,
    unlockTime: Number(a.unlocktime || 0) || 0
  }));
  return { ok: true, private: false, noStats: false, achievements };
}

async function fetchSteamGlobalAchievementPct(env, appId, timeoutMs = 8000) {
  const cleanAppId = String(appId || "").trim();
  if (!cleanAppId) return {};
  const result = await fetchSteamJson(env, "/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/", { gameid: cleanAppId }, timeoutMs);
  const list = Array.isArray(result.data?.achievementpercentages?.achievements) ? result.data.achievementpercentages.achievements : [];
  const map = {};
  list.forEach(a => { if (a && a.name != null) map[String(a.name)] = Number(a.percent || 0) || 0; });
  return map;
}

async function fetchSteamStoreCategories(appId, timeoutMs = 8000) {
  const cleanAppId = String(appId || "").trim();
  if (!cleanAppId) return { known: false, categoryIds: [] };
  const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(cleanAppId)}&filters=categories`;
  const result = await fetchJsonWithTimeout(url, { headers: { Accept: "application/json" } }, timeoutMs);
  const entry = result.data?.[cleanAppId];
  if (!result.ok || !entry || entry.success !== true) return { known: false, categoryIds: [] };
  const cats = Array.isArray(entry.data?.categories) ? entry.data.categories : [];
  return { known: true, categoryIds: cats.map(c => Number(c.id)).filter(Number.isFinite) };
}

async function buildSteamAchievementsResult(env, steamId, appId) {
  const cleanSteamId = normalizeSteamId(steamId);
  const cleanAppId = String(appId || "").trim();
  if (!cleanAppId) return { ok: false, status: 400, error: "Missing appid." };
  if (!cleanSteamId) return { ok: false, status: 400, error: "Missing steamId." };
  const [schema, player, globalPct, categories] = await Promise.all([
    fetchSteamGameSchema(env, cleanAppId),
    fetchSteamPlayerAchievements(env, cleanSteamId, cleanAppId),
    fetchSteamGlobalAchievementPct(env, cleanAppId),
    fetchSteamStoreCategories(cleanAppId)
  ]);

  const isSinglePlayer = categories.known ? categories.categoryIds.includes(2) : null;
  // "single-player only" gate. If the store categories are unavailable we can't
  // prove it's multiplayer-only, so we don't hide the section in that rare case.
  const eligible = categories.known ? !!isSinglePlayer : true;

  const playerMap = {};
  player.achievements.forEach(a => { playerMap[a.apiName] = a; });

  const merged = schema.achievements.map(a => {
    const p = playerMap[a.apiName] || null;
    const achieved = !!(p && p.achieved);
    const gp = globalPct[a.apiName];
    return {
      apiName: a.apiName,
      name: a.name,
      description: a.description,
      hidden: a.hidden,
      achieved,
      unlockTime: achieved ? (p.unlockTime || 0) : 0,
      iconUrl: achieved ? (a.icon || a.iconGray) : (a.iconGray || a.icon),
      globalPercent: (gp === undefined || gp === null) ? null : Math.round(gp * 10) / 10
    };
  });

  // Achieved first (most recently unlocked first), then locked (most common first).
  merged.sort((x, y) => {
    if (x.achieved !== y.achieved) return x.achieved ? -1 : 1;
    if (x.achieved) return (y.unlockTime || 0) - (x.unlockTime || 0);
    return (y.globalPercent || 0) - (x.globalPercent || 0);
  });

  const total = merged.length;
  const unlocked = merged.filter(a => a.achieved).length;
  return {
    ok: true,
    status: 200,
    appId: cleanAppId,
    steamId: cleanSteamId,
    hasAchievements: total > 0,
    singlePlayer: isSinglePlayer,
    categoriesKnown: categories.known,
    eligible,
    hasPlayerData: player.ok,
    private: !player.ok && player.private,
    gameName: schema.gameName,
    total,
    unlocked,
    percent: total > 0 ? Math.round((unlocked / total) * 1000) / 10 : 0,
    achievements: merged,
    steam: getSteamPublicStatus(env)
  };
}

async function runSteamAchievementsEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  const appId = String(url.searchParams.get("appid") || url.searchParams.get("appId") || "").trim();
  const steamId = normalizeSteamId(url.searchParams.get("steamId") || url.searchParams.get("steamid") || "");
  if (!appId) return jsonResponse({ ok: false, error: "Missing appid." }, 400);
  if (!steamId) return jsonResponse({ ok: false, error: "Missing steamId." }, 400);

  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/__steam_achievements/v1/${encodeURIComponent(appId)}/${encodeURIComponent(steamId)}`, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const result = await buildSteamAchievementsResult(env, steamId, appId);
  if (!result.ok) return jsonResponse(result, result.status || 502);
  const response = jsonResponse(result, 200, { "Cache-Control": `public, max-age=${STEAM_ACHIEVEMENTS_RESULT_TTL}` });
  ctx?.waitUntil?.(cache.put(cacheKey, response.clone()));
  return response;
}

const TRACKERGG_PUBLIC_API_ORIGIN = "https://public-api.tracker.gg/v2/";
const TRACKERGG_PUBLIC_API_GAMES = new Set(["apex", "the-division-2", "splitgate", "csgo"]);
const TRACKERGG_UNAVAILABLE_GAMES = new Set(["valorant", "marvel-rivals", "rocket-league", "fortnite", "cs2"]);

function getTrackerggPublicStatus(env) {
  return {
    configured: !!(env.TRACKERGG_API_KEY || env.TRN_API_KEY),
    supportedGames: Array.from(TRACKERGG_PUBLIC_API_GAMES),
    unavailableGames: Array.from(TRACKERGG_UNAVAILABLE_GAMES)
  };
}

function normalizeTrackerggGameKey(value = "") {
  const clean = String(value || "").trim().toLowerCase().replace(/_/g, "-");
  if (clean === "apex-legends") return "apex";
  if (clean === "division-2" || clean === "thedivision2") return "the-division-2";
  if (clean === "counter-strike" || clean === "cs2") return "csgo";
  return clean;
}

function normalizeTrackerggSegmentStats(data = {}) {
  const segments = Array.isArray(data?.data?.segments) ? data.data.segments : [];
  const overview = segments.find(segment => String(segment.type || "").toLowerCase() === "overview") || segments[0] || {};
  const stats = overview.stats || {};
  const findStat = (needles = []) => {
    const keys = Object.keys(stats || {});
    const hit = keys.find(key => {
      const clean = key.toLowerCase().replace(/[^a-z0-9]+/g, "");
      return needles.some(needle => clean.includes(needle));
    });
    const row = hit ? stats[hit] : null;
    return row?.displayValue || row?.value || "";
  };
  return {
    displayName: data?.data?.platformInfo?.platformUserHandle || data?.data?.userInfo?.username || "",
    currentRank: findStat(["rank", "rating", "tier"]),
    peakRank: findStat(["peakrank", "peakrating", "besttier"]),
    winRate: findStat(["winrate", "winpct", "winpercentage"]),
    kd: findStat(["kdratio", "kd", "killsdeaths"]),
    raw: data?.data || null
  };
}

async function runTrackerggProfileEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  const game = normalizeTrackerggGameKey(url.searchParams.get("game") || "");
  const platform = String(url.searchParams.get("platform") || "pc").trim().toLowerCase();
  const identifier = String(url.searchParams.get("identifier") || url.searchParams.get("profile") || "").trim();
  if (!game) return jsonResponse({ ok: false, error: "Missing Tracker.gg game key.", tracker: getTrackerggPublicStatus(env) }, 400);
  if (TRACKERGG_UNAVAILABLE_GAMES.has(game)) {
    return jsonResponse({
      ok: false,
      unsupported: true,
      error: "Tracker Network does not offer this title through the public developer API. Save a public profile link and stat snapshot instead.",
      tracker: getTrackerggPublicStatus(env)
    }, 200);
  }
  if (!TRACKERGG_PUBLIC_API_GAMES.has(game)) {
    return jsonResponse({ ok: false, unsupported: true, error: "Unsupported Tracker.gg public API game.", tracker: getTrackerggPublicStatus(env) }, 200);
  }
  const apiKey = env.TRACKERGG_API_KEY || env.TRN_API_KEY;
  if (!apiKey) {
    return jsonResponse({ ok: false, configured: false, error: "Tracker.gg API key is not configured.", tracker: getTrackerggPublicStatus(env) }, 200);
  }
  if (!identifier) return jsonResponse({ ok: false, error: "Missing Tracker.gg profile identifier.", tracker: getTrackerggPublicStatus(env) }, 400);

  const endpoint = new URL(`${game}/standard/profile/${encodeURIComponent(platform)}/${encodeURIComponent(identifier)}`, TRACKERGG_PUBLIC_API_ORIGIN);
  const cacheKey = new Request(`${url.origin}/__screenlist_trackergg/v945/${game}/${platform}/${encodeURIComponent(identifier.toLowerCase())}`, { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached && url.searchParams.get("force") !== "1") {
    const headers = new Headers(cached.headers);
    headers.set("x-screenlist-trackergg-cache", "HIT");
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }

  const result = await fetchJsonWithTimeout(endpoint.toString(), {
    headers: {
      "Accept": "application/json",
      "TRN-Api-Key": apiKey
    }
  }, 9000);
  if (!result.ok) {
    return jsonResponse({ ok: false, error: result.error || "Tracker.gg profile lookup failed.", tracker: getTrackerggPublicStatus(env) }, result.status || 502);
  }
  const normalized = normalizeTrackerggSegmentStats(result.data);
  const response = jsonResponse({
    ok: true,
    game,
    platform,
    profile: normalized,
    tracker: getTrackerggPublicStatus(env)
  }, 200, {
    "Cache-Control": "public, max-age=300",
    "x-screenlist-trackergg-cache": "MISS"
  });
  if (ctx?.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

async function proxyApi(request, env, options, ctx) {
  const keyValue = env[options.keyEnv];
  if (!keyValue) {
    return new Response(`${options.label} key is not configured.`, { status: 500 });
  }

  const url = new URL(request.url);
  const pathSuffix = url.pathname.slice(options.prefix.length);
  const upstreamUrl = buildUpstreamUrl(options.origin, pathSuffix, request.url, options.authParam, keyValue);
  const upstreamRequest = buildProxyRequest(request, upstreamUrl);

  if (request.method !== "GET") {
    return fetch(upstreamRequest);
  }

  const cacheKey = new Request(url.toString(), { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("x-screenlist-api-cache", "HIT");
    return new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers
    });
  }

  const upstreamResponse = await fetch(upstreamRequest);
  const headers = new Headers(upstreamResponse.headers);
  headers.set("Cache-Control", `public, max-age=${SCREENLIST_API_CACHE_TTL_SECONDS}`);
  headers.set("x-screenlist-api-cache", "MISS");
  const response = new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers
  });

  if (upstreamResponse.ok && ctx?.waitUntil) {
    ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  }

  return response;
}

function copySearchParams(sourceParams, targetUrl, blockedKeys = new Set()) {
  sourceParams.forEach((value, key) => {
    if (!blockedKeys.has(String(key).toLowerCase())) targetUrl.searchParams.set(key, value);
  });
}

async function proxyMusicBrainzGet(request, env, ctx, upstreamUrl, cacheNamespace = "musicbrainz") {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonResponse({ ok: false, error: "MusicBrainz proxy only supports GET requests." }, 405);
  }

  upstreamUrl.searchParams.set("fmt", "json");
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1" || url.searchParams.get("refresh") === "1";
  const cacheKey = new Request(`${url.origin}/__shelfd_${cacheNamespace}/v10137/${upstreamUrl.toString()}`, { method: "GET" });
  if (!force) {
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("x-shelfd-musicbrainz-cache", "HIT");
      return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
    }
  }

  const upstreamResponse = await fetch(upstreamUrl.toString(), {
    method: "GET",
    headers: buildMusicBrainzHeaders(env),
    redirect: "follow"
  });
  const headers = new Headers(upstreamResponse.headers);
  headers.set("Cache-Control", `public, max-age=${SCREENLIST_MUSICBRAINZ_CACHE_TTL_SECONDS}`);
  headers.set("x-shelfd-musicbrainz-cache", "MISS");
  const response = new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers
  });
  if (upstreamResponse.ok && ctx?.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

async function runMusicBrainzEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  const suffix = url.pathname.replace(/^\/api\/musicbrainz\/?/, "");

  if (url.pathname === "/api/musicbrainz" || url.pathname === "/api/musicbrainz/" || suffix === "health") {
    return jsonResponse({
      ok: true,
      baseUrl: MUSICBRAINZ_ORIGIN,
      coverArtArchiveBaseUrl: COVER_ART_ARCHIVE_ORIGIN,
      musicbrainz: getMusicBrainzPublicStatus(env),
      routes: {
        search: "/api/musicbrainz/search?type=artist&q=kendrick",
        lookup: "/api/musicbrainz/lookup?type=release&id={mbid}&inc=recordings+artists+genres+tags",
        rawProxy: "/api/musicbrainz/{entity-or-entity/mbid}?query=...&inc=...",
        coverArt: "/api/musicbrainz/cover-art/release/{releaseMbid}"
      }
    });
  }

  if (suffix === "search") {
    const type = normalizeMusicBrainzEntityType(url.searchParams.get("type") || url.searchParams.get("entity"));
    const query = String(url.searchParams.get("q") || url.searchParams.get("query") || "").trim();
    if (!type) return jsonResponse({ ok: false, error: "Missing or unsupported MusicBrainz search type.", supported: ["artist", "release", "release-group", "recording", "label", "work", "area", "event", "genre", "instrument", "place", "series"] }, 400);
    if (!query) return jsonResponse({ ok: false, error: "Missing search query. Use q= or query=." }, 400);
    const upstream = new URL(type, MUSICBRAINZ_ORIGIN);
    copySearchParams(url.searchParams, upstream, new Set(["type", "entity", "q", "query", "force", "refresh"]));
    upstream.searchParams.set("query", query);
    return proxyMusicBrainzGet(request, env, ctx, upstream);
  }

  if (suffix === "lookup") {
    const type = normalizeMusicBrainzEntityType(url.searchParams.get("type") || url.searchParams.get("entity"));
    const id = String(url.searchParams.get("id") || url.searchParams.get("mbid") || "").trim();
    if (!type) return jsonResponse({ ok: false, error: "Missing or unsupported MusicBrainz lookup type." }, 400);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return jsonResponse({ ok: false, error: "Missing or invalid MusicBrainz MBID." }, 400);
    }
    const upstream = new URL(`${type}/${id}`, MUSICBRAINZ_ORIGIN);
    copySearchParams(url.searchParams, upstream, new Set(["type", "entity", "id", "mbid", "force", "refresh"]));
    return proxyMusicBrainzGet(request, env, ctx, upstream);
  }

  if (suffix.startsWith("cover-art/")) {
    const coverPath = suffix.replace(/^cover-art\/+/, "");
    if (!coverPath || coverPath.includes("..")) return jsonResponse({ ok: false, error: "Invalid Cover Art Archive path." }, 400);
    const upstream = new URL(coverPath, COVER_ART_ARCHIVE_ORIGIN);
    copySearchParams(url.searchParams, upstream, new Set(["force", "refresh"]));
    return proxyMusicBrainzGet(request, env, ctx, upstream, "coverart");
  }

  const cleanSuffix = suffix.replace(/^\/+/, "");
  if (!cleanSuffix || cleanSuffix.includes("..")) return jsonResponse({ ok: false, error: "Invalid MusicBrainz path." }, 400);
  const firstSegment = cleanSuffix.split("/")[0] || "";
  if (!normalizeMusicBrainzEntityType(firstSegment)) {
    return jsonResponse({ ok: false, error: "Unsupported MusicBrainz entity path.", path: cleanSuffix }, 400);
  }
  const upstream = new URL(cleanSuffix, MUSICBRAINZ_ORIGIN);
  copySearchParams(url.searchParams, upstream, new Set(["force", "refresh"]));
  return proxyMusicBrainzGet(request, env, ctx, upstream);
}

/* v10.248: Deezer Simple API proxy. Routes:
     - /api/deezer/search?q=...                 → general search
     - /api/deezer/search/artist?q=...          → artist-only search
     - /api/deezer/search/album?q=...           → album-only search
     - /api/deezer/album/{id}                   → album + tracklist
     - /api/deezer/artist/{id}                  → artist details
     - /api/deezer/artist/{id}/albums?limit=... → artist discography
   All responses cached at the edge for 24h. */
async function runDeezerEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  const suffix = url.pathname.replace(/^\/api\/deezer\/?/, "");
  if (!suffix || suffix === "health") {
    return jsonResponse({
      ok: true,
      baseUrl: DEEZER_ORIGIN,
      cacheTtlSeconds: SCREENLIST_DEEZER_CACHE_TTL_SECONDS,
      routes: {
        search: "/api/deezer/search?q=kanye+west",
        searchArtist: "/api/deezer/search/artist?q=kanye+west",
        searchAlbum: "/api/deezer/search/album?q=yeezus",
        album: "/api/deezer/album/{id}",
        artist: "/api/deezer/artist/{id}",
        artistAlbums: "/api/deezer/artist/{id}/albums?limit=200"
      }
    });
  }
  /* Whitelist the paths we accept to avoid blind proxying. */
  const allowed = /^(search(?:\/(?:artist|album|track|playlist))?|album\/\d+(?:\/tracks)?|artist\/\d+(?:\/(?:albums|top|related))?|track\/\d+|chart(?:\/\d+)?)$/;
  if (!allowed.test(suffix)) {
    return jsonResponse({ ok: false, error: "Unsupported Deezer path.", path: suffix }, 400);
  }
  const upstream = new URL(suffix, DEEZER_ORIGIN);
  copySearchParams(url.searchParams, upstream, new Set(["force", "refresh"]));
  upstream.searchParams.set("output", "json");

  const cache = caches.default;
  const cacheKey = new Request(upstream.toString(), { method: "GET" });
  const force = url.searchParams.get("force") === "1" || url.searchParams.get("refresh") === "1";
  if (!force) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("x-shelfd-deezer-cache", "HIT");
      return new Response(cached.body, { status: cached.status, headers });
    }
  }
  let upstreamRes;
  try {
    upstreamRes = await fetch(upstream.toString(), {
      method: "GET",
      headers: { "Accept": "application/json", "User-Agent": "ShelfdMusicProxy/1.0 (+https://myshelfd.com)" }
    });
  } catch (e) {
    return jsonResponse({ ok: false, error: "Deezer fetch failed", detail: String(e?.message || e) }, 502);
  }
  const body = await upstreamRes.arrayBuffer();
  const headers = new Headers();
  headers.set("Content-Type", upstreamRes.headers.get("content-type") || "application/json");
  headers.set("Cache-Control", `public, max-age=${SCREENLIST_DEEZER_CACHE_TTL_SECONDS}`);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("x-shelfd-deezer-cache", "MISS");
  const response = new Response(body, { status: upstreamRes.status, headers });
  if (upstreamRes.ok) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
}

/* v11.067: resolve a Deezer album to its EXACT Apple Music + Spotify album
   links (and native app-open URIs) via the free song.link/Odesli resolver, so
   the music profile's export buttons open the right album inside each app.
   Results are cached 30 days (album→service links never change), which also
   keeps us comfortably under the resolver's rate limit. Input: deezerId (best),
   or artist+title (we look up the Deezer album id first). */
function deriveAppleMusicAppUri(input = "") {
  const s = String(input || "");
  if (!s) return "";
  if (/^music:\/\//i.test(s)) return s;
  if (/^itmss?:\/\//i.test(s)) return s.replace(/^itmss?:\/\//i, "music://");
  if (/^https?:\/\/(?:geo\.)?music\.apple\.com/i.test(s)) return s.replace(/^https?:\/\//i, "music://");
  return s;
}
function deriveSpotifyAppUri(input = "") {
  const s = String(input || "");
  if (!s) return "";
  let m = s.match(/spotify[:/]+(album|track|artist|playlist)[:/]+([A-Za-z0-9]+)/i);
  if (m) return `spotify:${m[1].toLowerCase()}:${m[2]}`;
  m = s.match(/open\.spotify\.com\/(?:[a-z-]{2,5}\/)?(album|track|artist|playlist)\/([A-Za-z0-9]+)/i);
  if (m) return `spotify:${m[1].toLowerCase()}:${m[2]}`;
  return s;
}
function normalizeMusicMatchText(s = "") {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function pickBestItunesAlbum(results, artist, title) {
  if (!Array.isArray(results) || !results.length) return null;
  const a = normalizeMusicMatchText(artist);
  const t = normalizeMusicMatchText(title);
  let best = null;
  let bestScore = -1;
  for (const r of results) {
    const ra = normalizeMusicMatchText(r.artistName);
    const rt = normalizeMusicMatchText(r.collectionName);
    let score = 0;
    if (a && (ra.includes(a) || a.includes(ra))) score += 2;
    if (t && rt === t) score += 3;
    else if (t && rt.includes(t)) score += 1;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best || results[0];
}
async function runMusicLinksEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  const deezerId = String(url.searchParams.get("deezerId") || "").replace(/[^0-9]/g, "");
  let artist = String(url.searchParams.get("artist") || "").trim();
  let title = String(url.searchParams.get("title") || "").trim();
  const country = (String(url.searchParams.get("country") || "US").trim().slice(0, 2).toUpperCase()) || "US";

  const cache = caches.default;
  const cacheId = (deezerId ? `dz:${deezerId}` : `q:${artist}|${title}`).toLowerCase();
  const cacheKey = new Request(`${url.origin}/__shelfd_music_links/v2/${country}/${encodeURIComponent(cacheId)}`, { method: "GET" });
  const force = url.searchParams.get("force") === "1" || url.searchParams.get("refresh") === "1";
  if (!force) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("x-shelfd-music-links-cache", "HIT");
      return new Response(cached.body, { status: cached.status, headers });
    }
  }

  // Backfill artist/title from Deezer when only a deezerId was supplied — both
  // are needed for the iTunes album search below.
  if ((!artist || !title) && deezerId) {
    try {
      const dres = await fetch(`${DEEZER_ORIGIN}album/${deezerId}?output=json`, {
        headers: { "Accept": "application/json", "User-Agent": "ShelfdMusicProxy/1.0 (+https://myshelfd.com)" }
      });
      if (dres.ok) {
        const dj = await dres.json();
        if (!title && dj?.title) title = String(dj.title);
        if (!artist && dj?.artist?.name) artist = String(dj.artist.name);
      }
    } catch (_) {}
  }
  if (!artist && !title) {
    return jsonResponse({ ok: false, error: "Need a deezerId, or artist + title." }, 400);
  }

  const deezerUrl = deezerId ? `https://www.deezer.com/album/${deezerId}` : "";
  const term = [artist, title].filter(Boolean).join(" ");

  // 1) Apple Music — exact album via the free, keyless iTunes Search API.
  let appleWeb = "";
  let appleApp = "";
  try {
    const ires = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&limit=5&country=${country}`, {
      headers: { "Accept": "application/json", "User-Agent": "ShelfdMusicProxy/1.0 (+https://myshelfd.com)" }
    });
    if (ires.ok) {
      const ij = await ires.json();
      const pick = pickBestItunesAlbum(ij?.results, artist, title);
      if (pick && pick.collectionViewUrl) {
        appleWeb = String(pick.collectionViewUrl).split("?")[0];
        appleApp = deriveAppleMusicAppUri(appleWeb);
      }
    }
  } catch (_) {}

  // 2) Spotify — exact link via song.link/Odesli when available (seed with the
  // resolved Apple Music URL first, then the Deezer URL). Apple/Deezer→Spotify
  // mapping isn't always present in the free resolver, so fall back to opening
  // the Spotify app's search for the exact album (exact IDs need Spotify's
  // official API, which is intentionally not wired up).
  let spotifyWeb = "";
  let spotifyApp = "";
  let spotifyIsSearch = false;
  for (const seed of [appleWeb, deezerUrl].filter(Boolean)) {
    try {
      const ores = await fetch(`${SONGLINK_ORIGIN}?url=${encodeURIComponent(seed)}&userCountry=${country}&songIfSingle=false`, {
        headers: { "Accept": "application/json", "User-Agent": "ShelfdMusicProxy/1.0 (+https://myshelfd.com)" }
      });
      if (ores.ok) {
        const oj = await ores.json();
        const sp = oj?.linksByPlatform?.spotify;
        if (sp && sp.url) {
          spotifyWeb = String(sp.url);
          spotifyApp = deriveSpotifyAppUri(spotifyWeb);
          break;
        }
      }
    } catch (_) {}
  }
  if (!spotifyWeb && term) {
    const q = encodeURIComponent(term);
    spotifyApp = `spotify:search:${q}`;
    spotifyWeb = `https://open.spotify.com/search/${q}`;
    spotifyIsSearch = true;
  }

  const payload = {
    ok: true,
    appleMusic: appleWeb ? { web: appleWeb, app: appleApp } : null,
    spotify: spotifyWeb ? { web: spotifyWeb, app: spotifyApp, search: spotifyIsSearch } : null
  };

  const headers = new Headers();
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", `public, max-age=${SCREENLIST_MUSIC_LINKS_CACHE_TTL_SECONDS}`);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("x-shelfd-music-links-cache", "MISS");
  const response = new Response(JSON.stringify(payload), { status: 200, headers });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

/* v10.547: Apple App Site Association — iOS Universal Links + Shared Web Credentials.
   Served at /.well-known/apple-app-site-association so that iOS can
   verify Shelfd owns myshelfd.com and:
     - applinks      → open /media/*, /album/*, /game-profile/*, /review/*,
                       /profile-card/* links directly in the installed app
                       rather than Safari.
     - webcredentials → share saved iCloud Keychain passwords between the
                       myshelfd.com website / PWA and the installed app,
                       so iOS surfaces the "Use saved password" suggestion
                       above the keyboard inside the TestFlight build, and
                       fires the "Save Password for myshelfd.com" prompt
                       on first sign-in / signup (added v10.649).

   Team ID comes from the APPLE_TEAM_ID Worker secret (already required
   for push notifications). Both applinks and webcredentials use the same
   TEAMID.com.myshelfd.app appID format.

   IMPORTANT — Xcode side also required (one-time, cannot web-deploy):
     Xcode → Signing & Capabilities → "+ Capability" → Associated Domains
     and add ALL four entries:
       applinks:myshelfd.com
       applinks:myscreenlist.com
       webcredentials:myshelfd.com
       webcredentials:myscreenlist.com
     Then bump Build number and re-archive → TestFlight.
   Without those entitlements iOS will silently ignore this AASA. */
function serveAppleAppSiteAssociation(env) {
  const teamId = (env && env.APPLE_TEAM_ID) ? String(env.APPLE_TEAM_ID).trim() : "";
  const appId = teamId ? `${teamId}.com.myshelfd.app` : "TEAM_ID.com.myshelfd.app";
  const payload = {
    applinks: {
      details: [
        {
          appIDs: [appId],
          components: [
            { "/": "/media/*",        comment: "Media share links" },
            { "/": "/album/*",        comment: "Album share links" },
            { "/": "/game-profile/*", comment: "Game profile share links" },
            { "/": "/review/*",       comment: "Review share links" },
            { "/": "/article/*",      comment: "News article share links" },
            { "/": "/auth/verify",    comment: "Email verification return link" },
            { "/": "/profile/*",      comment: "Full profile share links" },
            { "/": "/profile-card/*", comment: "Profile card share links" }
          ]
        }
      ]
    },
    /* v10.649: Shared Web Credentials. Lets iOS treat the website's
       saved passwords (iCloud Keychain entries for myshelfd.com /
       myscreenlist.com) as first-class credentials for the installed
       app, AND fire the system "Save Password" prompt on successful
       email/password sign-in or signup inside the Capacitor WKWebView.
       Pairs with navigator.credentials.store() on the JS side (v10.648). */
    webcredentials: {
      apps: [appId]
    }
  };
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=3600"
    }
  });
}

function isLegacyShelfdHost(hostname = "") {
  const host = String(hostname || "").trim().toLowerCase();
  return host === "myscreenlist.com" || host === "www.myscreenlist.com";
}

function redirectLegacyAuthVerifyToShelfd(url) {
  const target = new URL(url.toString());
  target.protocol = "https:";
  target.hostname = "myshelfd.com";
  target.port = "";
  return Response.redirect(target.toString(), 302);
}

function serveProfileOgSvg(url) {
  const handle = escapeHtmlMeta(cleanSharePreviewParam(url.searchParams.get("handle") || "", "Shelfd User"));
  const name = escapeHtmlMeta(cleanSharePreviewParam(url.searchParams.get("name") || "", handle));
  const hours = escapeHtmlMeta(cleanSharePreviewParam(url.searchParams.get("hours") || "", "0h"));
  const avg = escapeHtmlMeta(cleanSharePreviewParam(url.searchParams.get("avg") || "", "N/A"));
  const photo = url.searchParams.get("photo") || "";
  const safePhoto = /^https?:\/\//i.test(photo) ? escapeHtmlMeta(photo) : "";
  const initial = escapeHtmlMeta(String(handle || name || "S").replace(/^@+/, "").slice(0, 1).toUpperCase() || "S");
  const avatar = safePhoto
    ? `<image href="${safePhoto}" x="82" y="108" width="230" height="230" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)"/>`
    : `<circle cx="197" cy="223" r="115" fill="#2a1f5e"/><text x="197" y="262" fill="#C7B7FF" font-size="112" font-weight="500" text-anchor="middle">${initial}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#21183F"/>
      <stop offset="0.55" stop-color="#121018"/>
      <stop offset="1" stop-color="#08070C"/>
    </linearGradient>
    <radialGradient id="glow" cx="32%" cy="22%" r="70%">
      <stop offset="0" stop-color="#7C4DFF" stop-opacity="0.36"/>
      <stop offset="1" stop-color="#7C4DFF" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="avatarClip"><circle cx="197" cy="223" r="115"/></clipPath>
  </defs>
  <rect width="1200" height="630" fill="#09090D"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect x="40" y="40" width="1120" height="550" rx="48" fill="url(#bg)" stroke="#FFFFFF" stroke-opacity="0.12" stroke-width="3"/>
  <circle cx="197" cy="223" r="121" fill="none" stroke="#C7B7FF" stroke-opacity="0.45" stroke-width="4"/>
  ${avatar}
  <text x="366" y="170" fill="#FFFFFF" font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="64" font-weight="650">${handle}</text>
  <text x="368" y="223" fill="#FFFFFF" fill-opacity="0.62" font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="30" font-weight="300">${name}</text>
  <rect x="366" y="300" width="318" height="142" rx="28" fill="#FFFFFF" fill-opacity="0.07" stroke="#FFFFFF" stroke-opacity="0.10"/>
  <rect x="714" y="300" width="318" height="142" rx="28" fill="#FFFFFF" fill-opacity="0.07" stroke="#FFFFFF" stroke-opacity="0.10"/>
  <text x="408" y="362" fill="#C7B7FF" font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="26" font-weight="400">All Media</text>
  <text x="408" y="414" fill="#FFFFFF" font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="48" font-weight="650">${hours}</text>
  <text x="756" y="362" fill="#C7B7FF" font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="26" font-weight="400">Average Rating</text>
  <text x="756" y="414" fill="#FFFFFF" font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="48" font-weight="650">${avg}</text>
  <text x="82" y="532" fill="#C9A84C" font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="28" font-weight="400">Shelfd Profile</text>
</svg>`;
  return new Response(svg, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300"
    }
  });
}

function splitSvgTextLines(value = "", maxChars = 34, maxLines = 2) {
  const words = String(value || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.length && lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s+$/g, "")}...`;
  }
  return lines.length ? lines : [""];
}

function serveReviewOgSvg(url) {
  const title = cleanSharePreviewParam(url.searchParams.get("title") || "", "Shelfd Review");
  const user = cleanSharePreviewParam(url.searchParams.get("user") || "", "Shelfd User");
  const rating = cleanSharePreviewParam(url.searchParams.get("rating") || "", "");
  const section = cleanSharePreviewParam(url.searchParams.get("section") || "", "review");
  const text = cleanSharePreviewParam(url.searchParams.get("text") || "", "");
  const poster = url.searchParams.get("poster") || "";
  const safePoster = /^https?:\/\//i.test(poster) ? escapeHtmlMeta(poster) : "";
  const titleLines = splitSvgTextLines(title, 28, 2).map((line, idx) =>
    `<text x="86" y="${198 + idx * 62}" fill="#FFFFFF" font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="56" font-weight="700">${escapeHtmlMeta(line)}</text>`
  ).join("");
  const quoteLines = splitSvgTextLines(text || "Open this full review in Shelfd.", 50, 2).map((line, idx) =>
    `<text x="88" y="${420 + idx * 40}" fill="#FFFFFF" fill-opacity="0.78" font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="31" font-weight="300">${escapeHtmlMeta(line)}</text>`
  ).join("");
  const posterMarkup = safePoster
    ? `<image href="${safePoster}" x="814" y="92" width="286" height="430" preserveAspectRatio="xMidYMid slice" clip-path="url(#posterClip)"/>`
    : `<rect x="814" y="92" width="286" height="430" rx="30" fill="#241B3D"/><text x="957" y="330" fill="#C7B7FF" font-size="88" font-weight="600" text-anchor="middle">★</text>`;
  const ratingMarkup = rating
    ? `<rect x="86" y="306" width="190" height="58" rx="29" fill="#C9A84C" fill-opacity="0.20" stroke="#C9A84C" stroke-opacity="0.42"/><text x="120" y="346" fill="#F4C84B" font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="30" font-weight="650">★ ${escapeHtmlMeta(rating)}</text>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#21183F"/>
      <stop offset="0.56" stop-color="#121018"/>
      <stop offset="1" stop-color="#08070C"/>
    </linearGradient>
    <radialGradient id="glow" cx="28%" cy="20%" r="72%">
      <stop offset="0" stop-color="#7C4DFF" stop-opacity="0.32"/>
      <stop offset="1" stop-color="#7C4DFF" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="posterClip"><rect x="814" y="92" width="286" height="430" rx="30"/></clipPath>
  </defs>
  <rect width="1200" height="630" fill="#09090D"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect x="40" y="40" width="1120" height="550" rx="48" fill="url(#bg)" stroke="#FFFFFF" stroke-opacity="0.12" stroke-width="3"/>
  <text x="86" y="116" fill="#C9A84C" font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="28" font-weight="500">Shelfd Review</text>
  <text x="86" y="152" fill="#FFFFFF" fill-opacity="0.72" font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="28" font-weight="300">${escapeHtmlMeta(user)}</text>
  ${titleLines}
  ${ratingMarkup}
  <text x="86" y="394" fill="#C7B7FF" font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="25" font-weight="400">${escapeHtmlMeta(section.replace(/^\w/, c => c.toUpperCase()))}</text>
  ${quoteLines}
  <rect x="806" y="84" width="302" height="446" rx="36" fill="#FFFFFF" fill-opacity="0.05" stroke="#FFFFFF" stroke-opacity="0.14"/>
  ${posterMarkup}
</svg>`;
  return new Response(svg, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300"
    }
  });
}

/* Söhne lives in /fonts/sohne as .otf. resvg needs the raw font bytes to draw
   <text>; fetched once via the ASSETS binding and cached for the worker's life. */
async function loadShelfdOgFont(env, url) {
  if (!shelfdOgFontPromise) {
    shelfdOgFontPromise = (async () => {
      const fontUrl = new URL("/fonts/sohne/Sohne-Kraftig.otf", url.origin);
      const res = await env.ASSETS.fetch(new Request(fontUrl.toString(), { method: "GET" }));
      if (!res.ok) throw new Error("font fetch failed: " + res.status);
      return new Uint8Array(await res.arrayBuffer());
    })().catch(err => { shelfdOgFontPromise = null; throw err; });
  }
  return shelfdOgFontPromise;
}

/* v11.072: the Söhne OTF subset lacks "@", "/", and accented glyphs, which
   render as tofu boxes in resvg (loadSystemFonts is off). DM Sans is loaded as
   a fallback fontBuffer so resvg falls back per-glyph for those characters
   (album share card: "@username", "x/5", accented names). */
async function loadShelfdOgFallbackFont(env, url) {
  if (!shelfdOgFallbackFontPromise) {
    shelfdOgFallbackFontPromise = (async () => {
      const fontUrl = new URL("/fonts/google/dm-sans-v17-latin.woff2", url.origin);
      const res = await env.ASSETS.fetch(new Request(fontUrl.toString(), { method: "GET" }));
      if (!res.ok) throw new Error("fallback font fetch failed: " + res.status);
      return new Uint8Array(await res.arrayBuffer());
    })().catch(err => { shelfdOgFallbackFontPromise = null; throw err; });
  }
  return shelfdOgFallbackFontPromise;
}

/* resvg cannot fetch remote <image> hrefs, so the cover is inlined as a base64
   data URI before rasterizing. */
async function fetchImageDataUri(src = "") {
  if (!/^https?:\/\//i.test(src)) return "";
  try {
    const res = await fetch(src, { cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!res.ok) return "";
    const type = res.headers.get("content-type") || "image/jpeg";
    if (!/^image\//i.test(type)) return "";
    const bytes = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return `data:${type};base64,${btoa(binary)}`;
  } catch (_) {
    return "";
  }
}

function buildGameProfileCardSvg(url, posterDataUri = "") {
  const FF = "Sohne";
  const title = cleanSharePreviewParam(url.searchParams.get("title") || "", "Game Profile");
  const year = cleanSharePreviewParam(url.searchParams.get("year") || "", "");
  const genre = cleanSharePreviewParam(url.searchParams.get("genre") || "", "");
  const peakRank = cleanSharePreviewParam(url.searchParams.get("peakRank") || "", "-");
  const currentRank = cleanSharePreviewParam(url.searchParams.get("currentRank") || "", "-");
  const seasonKd = cleanSharePreviewParam(url.searchParams.get("seasonKd") || "", "-");
  const lifetimeKd = cleanSharePreviewParam(url.searchParams.get("lifetimeKd") || "", "-");
  const initial = escapeHtmlMeta((title.trim()[0] || "G").toUpperCase());
  const titleLines = splitSvgTextLines(title, 16, 2);
  const titleMarkup = titleLines.map((line, idx) =>
    `<text x="324" y="${224 + idx * 64}" fill="#FFFFFF" font-family="${FF}" font-size="60" font-weight="700">${escapeHtmlMeta(line)}</text>`
  ).join("");
  const metaY = 224 + titleLines.length * 64 - 12;
  const yearMarkup = year
    ? `<text x="324" y="${metaY}" fill="#FFFFFF" fill-opacity="0.55" font-family="${FF}" font-size="30">${escapeHtmlMeta(year)}</text>`
    : "";
  const genreMarkup = genre
    ? `<text x="324" y="${metaY + 44}" fill="#FFFFFF" fill-opacity="0.55" font-family="${FF}" font-size="26">${escapeHtmlMeta(genre)}</text>`
    : "";
  const posterMarkup = posterDataUri
    ? `<image href="${posterDataUri}" x="80" y="92" width="200" height="200" preserveAspectRatio="xMidYMid slice" clip-path="url(#gpCoverClip)"/>`
    : `<rect x="80" y="92" width="200" height="200" rx="28" fill="#241B3D"/><text x="180" y="222" fill="#C7B7FF" font-family="${FF}" font-size="96" font-weight="700" text-anchor="middle">${initial}</text>`;
  const statCell = (x, y, label, value, accent) => {
    const big = String(value || "-").length > 9;
    return `<rect x="${x}" y="${y}" width="500" height="118" rx="24" fill="#1C1C22" stroke="#FFFFFF" stroke-opacity="0.10"/>`
      + `<text x="${x + 34}" y="${y + 44}" fill="${accent}" font-family="${FF}" font-size="22" font-weight="600" letter-spacing="1.5">${escapeHtmlMeta(label)}</text>`
      + `<text x="${x + 34}" y="${y + 92}" fill="#FFFFFF" font-family="${FF}" font-size="${big ? 36 : 44}" font-weight="700">${escapeHtmlMeta(value || "-")}</text>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="gpbg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#1B1530"/>
      <stop offset="0.55" stop-color="#100F16"/>
      <stop offset="1" stop-color="#08070C"/>
    </linearGradient>
    <clipPath id="gpCoverClip"><rect x="80" y="92" width="200" height="200" rx="28"/></clipPath>
  </defs>
  <rect width="1200" height="630" fill="#09090D"/>
  <rect x="40" y="40" width="1120" height="550" rx="48" fill="url(#gpbg)" stroke="#FFFFFF" stroke-opacity="0.12" stroke-width="3"/>
  ${posterMarkup}
  <rect x="324" y="104" width="234" height="52" rx="26" fill="#2A2150" stroke="#A78BFA" stroke-opacity="0.42"/>
  <text x="356" y="139" fill="#C7B7FF" font-family="${FF}" font-size="24" font-weight="700" letter-spacing="2">COMPETITIVE</text>
  ${titleMarkup}
  ${yearMarkup}
  ${genreMarkup}
  ${statCell(80, 336, "PEAK RANK", peakRank, "#C7B7FF")}
  ${statCell(620, 336, "CURRENT RANK", currentRank, "#C7B7FF")}
  ${statCell(80, 470, "SEASON KD", seasonKd, "#FFFFFF")}
  ${statCell(620, 470, "LIFETIME KD", lifetimeKd, "#FFFFFF")}
</svg>`;
}

async function serveGameProfileOgPng(request, env, url) {
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  try {
    const [fontBuffer, posterDataUri] = await Promise.all([
      loadShelfdOgFont(env, url),
      fetchImageDataUri(url.searchParams.get("poster") || "")
    ]);
    const svg = buildGameProfileCardSvg(url, posterDataUri);
    const resvg = await Resvg.async(svg, {
      fitTo: { mode: "width", value: 1200 },
      font: { fontBuffers: [fontBuffer], defaultFontFamily: "Sohne", loadSystemFonts: false }
    });
    const rendered = resvg.render();
    const png = rendered.asPng();
    rendered.free?.();
    resvg.free?.();
    const response = new Response(png, {
      status: 200,
      headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" }
    });
    try { await cache.put(cacheKey, response.clone()); } catch (_) {}
    return response;
  } catch (err) {
    /* If rasterization fails (e.g. font/CPU), still hand scrapers a raster image
       so the link preview isn't blank — fall back to the cover, else default. */
    console.warn("game-profile OG png failed:", err && err.message || err);
    const poster = url.searchParams.get("poster") || "";
    const fallback = /^https?:\/\//i.test(poster) ? poster : new URL("/og-image-v216.png", url.origin).toString();
    return Response.redirect(fallback, 302);
  }
}

/* v11.072: 1200x1200 share card for the full-page album details — album cover,
   title, artist, year, then the sharer's circular avatar + @username (white,
   weight 400) + a ★ rating pill. Mirrors the in-app album page. Rendered to PNG
   (not SVG) because iMessage/LinkPresentation won't rasterize SVG. */
function buildAlbumProfileCardSvg(url, coverDataUri = "") {
  const FF = "Sohne";
  const title = cleanSharePreviewParam(url.searchParams.get("title") || "", "Album");
  const artist = cleanSharePreviewParam(url.searchParams.get("artist") || "", "");
  const year = cleanSharePreviewParam(url.searchParams.get("year") || "", "");
  const rawHandle = cleanSharePreviewParam(url.searchParams.get("username") || "", "");
  const username = rawHandle ? ("@" + rawHandle.replace(/^@+/, "")) : "";
  const ratingNum = parseFloat(cleanSharePreviewParam(url.searchParams.get("rating") || "", ""));
  const hasRating = isFinite(ratingNum) && ratingNum > 0;
  const ratingLabel = hasRating
    ? (Number.isInteger(ratingNum) ? String(ratingNum) : ratingNum.toFixed(1)) + "/5"
    : "";
  const initial = escapeHtmlMeta((title.trim()[0] || "♪").toUpperCase());

  const COVER_X = 300, COVER_Y = 96, COVER_W = 600;
  const coverMarkup = coverDataUri
    ? `<image href="${coverDataUri}" x="${COVER_X}" y="${COVER_Y}" width="${COVER_W}" height="${COVER_W}" preserveAspectRatio="xMidYMid slice" clip-path="url(#albCoverClip)"/>`
    : `<rect x="${COVER_X}" y="${COVER_Y}" width="${COVER_W}" height="${COVER_W}" rx="16" fill="#241B3D"/><text x="600" y="${COVER_Y + COVER_W / 2 + 64}" fill="#C7B7FF" font-family="${FF}" font-size="180" font-weight="700" text-anchor="middle">${initial}</text>`;

  const titleLines = splitSvgTextLines(title, 18, 2);
  const titleTop = 772;
  const titleMarkup = titleLines.map((line, i) =>
    `<text x="600" y="${titleTop + i * 78}" fill="#FFFFFF" font-family="${FF}" font-size="68" font-weight="700" text-anchor="middle">${escapeHtmlMeta(line)}</text>`
  ).join("");
  let metaY = titleTop + titleLines.length * 78 + 6;
  const artistMarkup = artist
    ? `<text x="600" y="${metaY}" fill="#FFFFFF" fill-opacity="0.62" font-family="${FF}" font-size="40" font-weight="500" text-anchor="middle">${escapeHtmlMeta(artist)}</text>`
    : "";
  if (artist) metaY += 58;
  const yearMarkup = year
    ? `<text x="600" y="${metaY}" fill="#FFFFFF" fill-opacity="0.42" font-family="${FF}" font-size="30" text-anchor="middle">${escapeHtmlMeta(year)}</text>`
    : "";

  /* v11.074: avatar removed per spec — the bottom row is just the CENTERED
     @username with the rating pill below it (the in-app photo is base64 and
     can't reach the worker, so no avatar is shown rather than a wrong one). */
  const usernameMarkup = username
    ? `<text x="600" y="${hasRating ? 1016 : 1052}" fill="#FFFFFF" font-family="${FF}" font-size="44" font-weight="400" text-anchor="middle">${escapeHtmlMeta(username)}</text>`
    : "";
  let pillMarkup = "";
  if (hasRating) {
    const pillH = 56;
    const pillW = 84 + ratingLabel.length * 19;
    const pillX = 600 - pillW / 2;
    const pillY = username ? 1046 : 1042;
    /* Star drawn as a vector path — the ★ (U+2605) glyph is in neither Söhne nor
       the DM Sans fallback, so a glyph would tofu. Unit star (24x24, point up),
       scaled to ~34px and centered at (starCx, starCy). */
    const starCx = pillX + 30, starCy = pillY + pillH / 2, starScale = 1.42;
    const starPath = "M12 1.6 L15.09 8.26 L22.4 9.1 L17 14.04 L18.42 21.3 L12 17.77 L5.58 21.3 L7 14.04 L1.6 9.1 L8.91 8.26 Z";
    pillMarkup = `<rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillH / 2}" fill="#1C1C22" stroke="#FFFFFF" stroke-opacity="0.14"/>`
      + `<g transform="translate(${starCx}, ${starCy}) scale(${starScale}) translate(-12, -12)"><path d="${starPath}" fill="#E6C36A"/></g>`
      + `<text x="${pillX + 56}" y="${pillY + 38}" fill="#FFFFFF" font-family="${FF}" font-size="30" font-weight="600">${escapeHtmlMeta(ratingLabel)}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
  <defs>
    <clipPath id="albCoverClip"><rect x="${COVER_X}" y="${COVER_Y}" width="${COVER_W}" height="${COVER_W}" rx="16"/></clipPath>
  </defs>
  <rect width="1200" height="1200" fill="#141419"/>
  <rect x="${COVER_X}" y="${COVER_Y}" width="${COVER_W}" height="${COVER_W}" rx="16" fill="#0A0A0E"/>
  ${coverMarkup}
  <rect x="${COVER_X}" y="${COVER_Y}" width="${COVER_W}" height="${COVER_W}" rx="16" fill="none" stroke="#FFFFFF" stroke-opacity="0.12" stroke-width="2"/>
  ${titleMarkup}
  ${artistMarkup}
  ${yearMarkup}
  ${usernameMarkup}
  ${pillMarkup}
</svg>`;
}

async function serveAlbumProfileOgPng(request, env, url) {
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  try {
    /* v11.073: resolve a reliable album cover. Prefer the passed http poster;
       otherwise (stored cover was base64/empty) pull a fresh cover_xl straight
       from Deezer using the deezerId. */
    let coverUrl = url.searchParams.get("poster") || "";
    const albumDeezerId = (url.searchParams.get("deezerId") || "").replace(/[^0-9]/g, "");
    if (!/^https?:\/\//i.test(coverUrl) && albumDeezerId) {
      try {
        const dres = await fetch(`${DEEZER_ORIGIN}album/${albumDeezerId}?output=json`, {
          headers: { "Accept": "application/json", "User-Agent": "ShelfdMusicProxy/1.0 (+https://myshelfd.com)" }
        });
        if (dres.ok) {
          const dj = await dres.json();
          coverUrl = dj.cover_xl || dj.cover_big || dj.cover_medium || dj.cover || "";
        }
      } catch (_) {}
    }
    const [fontBuffer, fallbackBuffer, coverDataUri] = await Promise.all([
      loadShelfdOgFont(env, url),
      loadShelfdOgFallbackFont(env, url).catch(() => null),
      fetchImageDataUri(coverUrl)
    ]);
    const fontBuffers = fallbackBuffer ? [fontBuffer, fallbackBuffer] : [fontBuffer];
    const svg = buildAlbumProfileCardSvg(url, coverDataUri);
    const resvg = await Resvg.async(svg, {
      fitTo: { mode: "width", value: 1200 },
      font: { fontBuffers, defaultFontFamily: "Sohne", loadSystemFonts: false }
    });
    const rendered = resvg.render();
    const png = rendered.asPng();
    rendered.free?.();
    resvg.free?.();
    const response = new Response(png, {
      status: 200,
      headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" }
    });
    try { await cache.put(cacheKey, response.clone()); } catch (_) {}
    return response;
  } catch (err) {
    console.warn("album OG png failed:", err && err.message || err);
    const poster = url.searchParams.get("poster") || "";
    const fallback = /^https?:\/\//i.test(poster) ? poster : new URL("/og-image-v216.png", url.origin).toString();
    return Response.redirect(fallback, 302);
  }
}

function getAppleMusicEnvConfig(env) {
  const teamIdName = APPLE_MUSIC_TEAM_ID_ENV_NAMES.find(name => getEnvString(env, name));
  const keyIdName = APPLE_MUSIC_KEY_ID_ENV_NAMES.find(name => getEnvString(env, name));
  const privateKeyName = APPLE_MUSIC_PRIVATE_KEY_ENV_NAMES.find(name => getEnvString(env, name));
  return {
    teamIdName: teamIdName || "",
    teamId: teamIdName ? getEnvString(env, teamIdName) : "",
    keyIdName: keyIdName || "",
    keyId: keyIdName ? getEnvString(env, keyIdName) : "",
    privateKeyName: privateKeyName || "",
    privateKey: privateKeyName ? getEnvString(env, privateKeyName) : ""
  };
}

function getAppleMusicPublicStatus(env) {
  const config = getAppleMusicEnvConfig(env);
  return {
    configured: !!(config.teamId && config.keyId && config.privateKey),
    teamIdEnvName: config.teamIdName || "",
    keyIdEnvName: config.keyIdName || "",
    privateKeyEnvName: config.privateKeyName || "",
    acceptedTeamIdEnvNames: APPLE_MUSIC_TEAM_ID_ENV_NAMES,
    acceptedKeyIdEnvNames: APPLE_MUSIC_KEY_ID_ENV_NAMES,
    acceptedPrivateKeyEnvNames: APPLE_MUSIC_PRIVATE_KEY_ENV_NAMES
  };
}

function getAppleMusicConfigError(env) {
  const status = getAppleMusicPublicStatus(env);
  if (status.configured) return "";
  return `Apple Music API is not configured. Add Cloudflare Worker secrets named ${APPLE_MUSIC_KEY_ID_ENV_NAMES[0]} and ${APPLE_MUSIC_PRIVATE_KEY_ENV_NAMES[0]}. Reuse ${APPLE_MUSIC_TEAM_ID_ENV_NAMES[1]} if it already exists, or add ${APPLE_MUSIC_TEAM_ID_ENV_NAMES[0]}.`;
}

// v11.942: An Apple MusicKit Key ID is exactly 10 uppercase-alphanumeric chars.
// This guard exists so a misconfigured APPLE_MUSIC_KEY_ID (e.g. accidentally set
// to the .p8 private key contents) can NEVER be signed into the JWT `kid` header
// of a publicly served developer token, which would both produce an Apple-rejected
// token AND leak the private key to anyone calling the endpoint.
function isPlausibleAppleMusicKeyId(value) {
  return /^[A-Z0-9]{10}$/.test(String(value || "").trim());
}

async function getAppleMusicDeveloperToken(env) {
  const now = Date.now();
  if (appleMusicDeveloperTokenCache.token && now < appleMusicDeveloperTokenCache.expiresAtMs) {
    return appleMusicDeveloperTokenCache;
  }

  const config = getAppleMusicEnvConfig(env);
  if (!config.teamId || !config.keyId || !config.privateKey) {
    throw new Error(getAppleMusicConfigError(env));
  }
  // v11.942: refuse to sign (and never leak) if APPLE_MUSIC_KEY_ID is not a real
  // 10-char MusicKit Key ID. Stops the private key from ever reaching the public
  // JWT `kid` header when the secret is misconfigured.
  if (!isPlausibleAppleMusicKeyId(config.keyId)) {
    throw new Error("APPLE_MUSIC_KEY_ID is misconfigured: it must be the 10-character MusicKit Key ID, not the private key. Set the correct Key ID and rotate the exposed MusicKit key.");
  }

  const issuedAtSec = Math.floor(now / 1000);
  const expSec = issuedAtSec + APPLE_MUSIC_TOKEN_TTL_SECONDS;
  const header = { alg: "ES256", kid: config.keyId, typ: "JWT" };
  const payload = { iss: config.teamId, iat: issuedAtSec, exp: expSec };
  const enc = (obj) => _b64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)));
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const privateKey = await _importApnsPrivateKey(config.privateKey);
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  const token = `${signingInput}.${_b64UrlEncode(new Uint8Array(sig))}`;
  appleMusicDeveloperTokenCache = {
    token,
    expSec,
    expiresAtMs: (expSec * 1000) - (5 * 60 * 1000)
  };
  return appleMusicDeveloperTokenCache;
}

async function runAppleMusicDeveloperTokenEndpoint(request, env) {
  if (request.method !== "GET") {
    return jsonResponse({ ok: false, error: "method-not-allowed" }, 405, {
      "cache-control": "no-store"
    });
  }
  try {
    const signed = await getAppleMusicDeveloperToken(env);
    return jsonResponse({
      ok: true,
      developerToken: signed.token,
      expiresAtMs: signed.expSec * 1000,
      expiresAt: new Date(signed.expSec * 1000).toISOString(),
      appleMusic: getAppleMusicPublicStatus(env)
    }, 200, {
      "cache-control": "no-store"
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: String(error && error.message ? error.message : error),
      appleMusic: getAppleMusicPublicStatus(env)
    }, 500, {
      "cache-control": "no-store"
    });
  }
}

/* ============================================================================
   NEWS FEED  (v11.592)  -  RSS-first entertainment news aggregator.
   ----------------------------------------------------------------------------
   A Cron job (+ on-demand refresh when stale) fetches a curated set of
   publisher RSS/Atom feeds, normalizes every item to a single card shape, and
   caches per-category lists in NEWS_KV. GET /api/news serves paginated cards.
   Source-pluggable: a non-RSS source (NewsAPI / GNews / Steam / Jikan / Tavily)
   just needs to emit the same normalized item shape and be merged in
   collectNewsItems().
   ========================================================================== */
const NEWS_KV_PREFIX = "news:v1:";
const NEWS_CATEGORIES = ["movies", "tv", "anime", "games", "music"];
const NEWS_PER_CATEGORY_CAP = 400;             // v11.650: ~30-day archive depth per category
const NEWS_ALL_CAP = 1500;                     // v11.650: the 'all' KV holds the whole rolling archive
const NEWS_RETAIN_DAYS = 30;                    // v11.650: keep articles this many days (rolling window)
const NEWS_STALE_MS = 30 * 60 * 1000;          // background-refresh if cache older than this
const NEWS_KV_TTL_SECONDS = 40 * 24 * 60 * 60; // v11.650: > retain window, so the archive survives refresh gaps
/* v11.604: in-app reader — Tavily /extract a tapped article into clean
   paragraphs, cached in NEWS_KV so repeat opens are instant. */
const NEWS_ARTICLE_CACHE_PREFIX = "news:article:v7:";
const NEWS_ARTICLE_TTL_SECONDS = 7 * 24 * 60 * 60;

/* v11.696: promo/clip ALLOW-filter for episode-DUMP anime channels — keep only a
   title that carries a trailer/PV/teaser/clip/announcement/visual signal. Excludes
   the words that appear in full-episode titles (episode, season N, [English Sub])
   so a full episode never slips through, while "official clips" (a prioritized
   type) still pass via the explicit "clip" token. 予告 = JP "trailer/preview".
   Defined HERE (above NEWS_RSS_SOURCES) so BOTH the RSS path (the Crunchyroll
   YouTube feed, which otherwise floods the Anime tab with full episodes + the
   "Anime Effect" podcast) and the Data API path (Muse Asia / Aniplex / …) can use it. */
const ANIME_PROMO_ALLOW = /\b(trailer|teaser|pv|promo|preview|clip|opening|ending|key visual|main visual|announce|announced|announcement|premieres?|reveals?|first look|coming soon|now streaming|\bcm\b)\b|予告/i;

/* v11.723: MUSIC video filters. MUSIC_PROMO_ALLOW requires a real MUSIC signal in
   the title (song / album / performance / freestyle / awards-music / "talks new
   album"…) — applied as titleAllow on the radio/TV channels (MTV, HOT 97, The
   Breakfast Club) so a politics / sports / gossip / reality segment with NO music
   word never enters Music. "interview" alone is intentionally NOT an allow signal
   (too many non-music interviews) — a music word is required. MUSIC_NONMUSIC_BLOCK
   denies clearly non-music content (politics, sports, reality TV, relationship /
   gossip, crime) — applied as titleBlock on those three PLUS the two semi-mixed
   outlets (Billboard, Rolling Stone, which post some non-music). The clean
   music-only channels (NPR Music, Genius, COLORS, Vevo, Pitchfork, XXL) carry
   NEITHER. */
const MUSIC_PROMO_ALLOW = /\b(music video|official (?:video|audio|music video|visualizer)|lyric video|visualizer|new (?:song|single|album|track|ep|mixtape|music|video)|\balbum\b|\bmixtape\b|\bsingle\b|\bsong\b|\btrack\b|performs?\b|performance|live (?:at|performance|session|set|debut)|tiny desk|colors show|\bsession\b|freestyle|cypher|\bverse\b|verzuz|acoustic|unplugged|concert|festival|tour(?:ing|s|ed)?|on (?:his|her|their|the) (?:new )?(?:album|song|single|music|mixtape|ep|verse)|breaks? down (?:the|his|her|their|a)? ?(?:song|lyrics?|verse|beat|meaning)|behind the (?:song|beat|music|lyrics)|making of|\bproducer\b|\brapper\b|\bsinger\b|songwriter|vocals?|debut album|drops? (?:new|the|a|his|her|their)? ?(?:song|single|album|video|mixtape|ep)|grammys?|\bvmas?\b|bet awards|billboard (?:music )?awards?|\brap\b|hip ?hop|\bbars\b|\bmc\b|\bemcee\b|lyrical|\br&b\b|\brnb\b|\bdrill\b|diss track|signed to|record (?:deal|label)|\bremix\b)\b/i;
const MUSIC_NONMUSIC_BLOCK = /\b(trump|biden|kamala|election|senate|congress|president|governor|politics|political|immigration|abortion|democrat|republican|\bnfl\b|\bnba\b|\bmlb\b|\bnhl\b|super ?bowl|world cup|playoffs|\bknicks\b|\blakers\b|cowboys|touchdown|reality (?:show|tv)|love (?:&|and) hip ?hop|jersey shore|teen mom|ridiculousness|catfish|are you the one|\bnet worth\b|\bdivorce\b|cheating|baby (?:mama|daddy)|relationship advice|conspiracy|psychic|horoscope|true crime|\bmurder\b|shooting|arrested|car crash|\bufo\b|aliens|\bbeer\b|brewery|brewer|distillery|whiskey|bourbon|\bwine\b|cocktail|cooking|\brecipe\b|\bchef\b|restaurant|barbecue|fashion week|runway show|gadget|smartphone)\b/i;

// Curated publisher feeds. Each item inherits its feed's category + source.
// Resilient: a feed that 404s / times out is skipped; the rest still populate.
/* v11.645: curated must-have source list. Every URL below was health-checked
   (HTTP 200 + valid RSS/Atom with items) before adding. Sources with no usable
   public feed are reinforced through the NewsAPI domain lists instead:
   Complex (403 bot-blocked), HipHopDX (410 gone), Anime Trending (no feed). */
/* v11.692: SOURCE-POOL REPAIR — every change below is backed by a live probe
   (curl + wrangler tail during a forced refresh). The refresh invocation was at
   the 50-subrequest cap (50 RSS feeds exactly), so any feed whose URL now
   REDIRECTS died with "Too many subrequests" on the redirect follow (Polygon,
   ANN, Kotaku, Stereogum — proven in tail). Those URLs now point at their final
   destinations (0 redirects). Deadline emptied both category feeds (200 + valid
   RSS + ZERO items) → replaced with the main feed, split movies/tv per item via
   splitScreen. CBR's TV feed 404s (the /news/ suffix died) → /feed/category/tv/.
   Otaku USA stopped publishing Sep 2025 → replaced by Anime Corner (fresh, 25
   items). Steam News barely updates (newest item 16 days old) → replaced by
   Rock Paper Shotgun (100 fresh items). Nintendo Life 403s from the Worker's
   datacenter IP (200 from a browser — same IP-block class as the v11.668 YouTube
   channels) → removed; Nintendo coverage stays via the Nintendo YT channel, the
   IGN feed, Gematsu, VGC and Eurogamer. The 4 IGN platform feeds (often 403,
   4 subrequests for one source) collapsed into the single ?channel=games feed.
   Net: 50 → 45 fetches per refresh = real headroom under the 50-subrequest cap. */
const NEWS_RSS_SOURCES = [
  // ---- Movies ----
  { url: "https://variety.com/v/film/feed/",                    source: "Variety",                category: "movies" },
  { url: "https://www.hollywoodreporter.com/c/movies/feed/",    source: "The Hollywood Reporter", category: "movies" },
  // v11.692: Deadline's per-category feeds are EMPTY now — main feed + per-item
  //          movies/tv split (same heuristic the providers use).
  { url: "https://deadline.com/feed/",                          source: "Deadline",               category: "movies", splitScreen: true },
  { url: "https://collider.com/feed/",                          source: "Collider",               category: "movies" },
  { url: "https://www.indiewire.com/feed/",                     source: "IndieWire",              category: "movies" },
  { url: "https://www.slashfilm.com/feed/",                     source: "SlashFilm",              category: "movies" },
  { url: "https://www.firstshowing.net/feed/",                  source: "FirstShowing",           category: "movies" },
  // ---- TV ----
  { url: "https://variety.com/v/tv/feed/",                      source: "Variety",                category: "tv" },
  { url: "https://www.hollywoodreporter.com/c/tv/feed/",        source: "The Hollywood Reporter", category: "tv" },
  { url: "https://www.tvline.com/feed/",                        source: "TVLine",                 category: "tv" },
  { url: "https://www.cbr.com/feed/category/tv/",               source: "CBR",                    category: "tv" },
  // ---- K-drama / Korean entertainment (v11.665) — Soompi RSS is reliable (~60
  //      items, imageless → og:image backfill). Korea JoongAng Daily + The Korea
  //      Herald have no working RSS (domain moved / RSS retired), so they arrive
  //      via the NewsAPI 'screen' domains below; all three get an eligibility
  //      source-pattern + strong quality weighting. Mapped to tv → screen + all. ----
  { url: "https://www.soompi.com/feed",                         source: "Soompi",                 category: "tv" },
  // ---- Anime ---- (ANN + MyAnimeList ship few/no inline images; the capped
  // og:image backfill covers what it can. Kept per the must-have source list.)
  // v11.692: ANN's bare rss.xml 301s to ?ann-edition=us — fetch the final URL
  //          directly (a redirect = an extra subrequest = death at the cap).
  { url: "https://www.animenewsnetwork.com/news/rss.xml?ann-edition=us", source: "Anime News Network", category: "anime" },
  { url: "https://feeds.feedburner.com/crunchyroll",            source: "Crunchyroll",            category: "anime" },
  { url: "https://myanimelist.net/rss/news.xml",                source: "MyAnimeList",            category: "anime" },
  { url: "https://comicbook.com/category/anime/feed/",          source: "ComicBook",              category: "anime" },
  { url: "https://gamerant.com/feed/anime/",                    source: "Game Rant",              category: "anime" },
  { url: "https://screenrant.com/feed/anime/",                  source: "Screen Rant",            category: "anime" },
  // v11.692: Otaku USA stopped publishing (newest item Sep 2025 — everything is
  //          retention-dropped) → Anime Corner, already in the quality/eligibility maps.
  //   v11.697 re-checked: Otaku USA STILL dormant (newest Sep 2025) — genuinely dead,
  //   not a moved/blocked URL, so it cannot be "repaired"; Anime Corner stays its stand-in.
  { url: "https://animecorner.me/feed/",                        source: "Anime Corner",           category: "anime" },
  /* v11.697: additional anime-news sites (all health-checked: 200 + fresh items,
     no redirects). Animehunch is clean anime news (no filter). The other three are
     noisier, so each gets a per-source titleBlock to strip the content the user
     flagged: Honey's Anime → listicles/cosplay; Tokyo Otaku Mode → figure roundups
     / cosplay / merch; Anime UK News → manga/light-novel VOLUME reviews. Anime
     Trending has NO working RSS (anitrendz 404s) — added to the NewsAPI anime
     domains below as best-effort instead. */
  { url: "https://animehunch.com/feed/",                        source: "Animehunch",             category: "anime",
    titleBlock: /\bvolumes?\s*\d|\bvol\.?\s*\d/i },
  { url: "https://animeuknews.net/feed/",                       source: "Anime UK News",          category: "anime",
    titleBlock: /\bvolumes?\s*\d|\bvol\.?\s*\d|light novel\b/i },
  { url: "https://honeysanime.com/feed/",                       source: "Honey's Anime",          category: "anime",
    titleBlock: /\btop\s*\d|\b\d+\s+(?:best|anime|reasons|things|times|characters|moments)\b|\branked\b|recommend|watch order|cosplay/i },
  /* v11.726: REMOVED Tokyo Otaku Mode — it is a FIGURE/MERCH/COSPLAY site, not an
     anime-news source (recent feed = "Weekly Figure Roundup", "Cosplaying Tips",
     "SEGA 65th shop"); the titleBlock correctly stripped ~everything, so it
     contributed ~0 news. Anime news is well covered by ANN/ComicBook/Anime
     Corner/MyAnimeList. */
  // ---- Games ----
  // v11.692: the 4 IGN platform feeds (playstation/xbox/nintendo/pc) collapsed
  //          into the single games channel — same category, 3 subrequests saved,
  //          and IGN 403s less when we hit it once instead of 4× per refresh.
  { url: "https://www.ign.com/rss/v2/articles/feed?channel=games", source: "IGN",                 category: "games" },
  { url: "https://www.gamespot.com/feeds/news/",                source: "GameSpot",               category: "games" },
  // v11.692: Polygon's index.xml now double-301s → final feed URL.
  { url: "https://www.polygon.com/feed/",                       source: "Polygon",                category: "games" },
  { url: "https://www.videogameschronicle.com/feed/",           source: "Video Games Chronicle",  category: "games" },
  { url: "https://www.pcgamer.com/rss/",                        source: "PC Gamer",               category: "games" },
  { url: "https://www.gematsu.com/feed",                        source: "Gematsu",                category: "games" },
  // v11.692: Nintendo Life 403s from the Worker's datacenter IP (works from a
  //          browser) — removed, coverage stays via Nintendo YT/IGN/Gematsu/VGC.
  { url: "https://blog.playstation.com/feed/",                  source: "PlayStation Blog",       category: "games" },
  { url: "https://news.xbox.com/en-us/feed/",                   source: "Xbox Wire",              category: "games" },
  // v11.692: Steam's global news feed barely updates (1 stale archive item) →
  //          Rock Paper Shotgun (100 fresh items, quality 0.7, already mapped).
  { url: "https://www.rockpapershotgun.com/feed",               source: "Rock Paper Shotgun",     category: "games" },
  { url: "https://www.eurogamer.net/feed",                      source: "Eurogamer",              category: "games" },
  // v11.692: kotaku.com/rss 301s → /feed (the redirect was killing it at the cap).
  { url: "https://kotaku.com/feed",                             source: "Kotaku",                 category: "games" },
  // ---- Music ----
  { url: "https://pitchfork.com/feed/feed-news/rss",            source: "Pitchfork",              category: "music" },
  { url: "https://www.billboard.com/feed/",                     source: "Billboard",              category: "music" },
  { url: "https://www.rollingstone.com/music/music-news/feed/", source: "Rolling Stone",          category: "music" },
  { url: "https://www.nme.com/news/music/feed",                 source: "NME",                    category: "music" },
  // v11.692: www.stereogum.com/feed/ 308s → apex domain, no trailing slash.
  { url: "https://stereogum.com/feed",                          source: "Stereogum",              category: "music" },
  { url: "https://consequence.net/feed/",                       source: "Consequence",            category: "music" },
  // ---- YouTube (v11.650: trailers / video news — health-checked channel IDs.
  //      Atom feeds parse via parseRssFeed; cards open the video externally. ----
  { url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCi8e0iOVk1fEOogdfu4YgfA", source: "Rotten Tomatoes", category: "movies" },
  { url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCvC4D8onUfXzvjTOM-dBfEA", source: "Marvel",          category: "movies" },
  // v11.696: Crunchyroll's YouTube uploads include FULL EPISODES (Attack on Titan
  //   dub eps, Detective Conan, MARRIAGETOXIN ep1…) + the "Anime Effect" podcast —
  //   the allow-filter keeps only its trailers/PVs/clips/announcements.
  { url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC6pGDc4bFGD1_36IKv3FnYg", source: "Crunchyroll",     category: "anime", titleAllow: ANIME_PROMO_ALLOW },
  { url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCbu2SsF-Or3Rsn3NxqODImw", source: "GameSpot",        category: "games" },
  { url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC-2Y8dQb0S6DtpxNgAKoJKA", source: "PlayStation",     category: "games" },
  { url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCGIY_O-8vW4rfX98KlMkvRg", source: "Nintendo",        category: "games" },
  // v11.664: more curated YouTube channels — surfaced as followable rows in the
  //          Tailor "YouTube" group (each health-checked: valid Atom + 15 entries).
  { url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCKy1dAqELo0zrOtPkf0eTMw", source: "IGN",             category: "games" },
  { url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCGie8GMlUo3kBKIopdvumVQ", source: "Netflix",         category: "tv" },
  { url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCJx5KP-pCUmL9eZUv-mIcNw", source: "GameTrailers",    category: "games" }
  // v11.670: VALORANT Champions Tour (@ValorantEsports = channel UCA1d3HFGFUmkKr2JIUA5Vlw)
  //   was added here with a `titleMust:"match highlights"` filter, but RE-CONFIRMED
  //   blocked: a fresh isolated full re-collect returned 0 items (YouTube refuses this
  //   channel's RSS to our datacenter IP — same block as the v11.668 batch). Removed.
  //   The generic `src.titleMust` allow-filter in collectRssItems() stays (reusable).
  // v11.668→669: Rockstar / Marvel Rivals / Valorant / Apex / PUBG were briefly
  //   added here as RSS, but YouTube blocks THOSE channels' Atom feeds from our
  //   datacenter IP (verified channel-specific — they 200 with entries from a
  //   browser + our bot UA, but return empty server-side). They're now fetched via
  //   the YouTube Data API in collectYouTubeApiItems() (NEWS_YT_API_CHANNELS).
];

function newsHashId(value = "") {
  // djb2 -> base36; stable id for dedupe + client keys (no async crypto needed)
  let h = 5381;
  const s = String(value || "");
  for (let i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) | 0; }
  return "n" + (h >>> 0).toString(36);
}

function newsCanonicalUrl(value = "") {
  let u = String(value || "").trim();
  if (!u) return "";
  u = u.split("#")[0];
  u = u.replace(/([?&])(utm_[^=&]+|cmpid|ref|fbclid|igshid|mc_[^=&]+)=[^&]*/gi, "$1");
  u = u.replace(/[?&]+$/, "").replace(/([?&])&+/g, "$1");
  return u;
}

function newsStripTags(value = "") {
  return decodeBasicHtmlEntities(
    String(value || "")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}

function newsExtractTag(xml, tag) {
  const re = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + tag + ">", "i");
  const m = String(xml || "").match(re);
  return m ? m[1] : "";
}

function newsExtractAttr(xml, tag, attr) {
  const re = new RegExp("<" + tag + "\\b[^>]*\\b" + attr + "\\s*=\\s*[\"']([^\"']+)[\"']", "i");
  const m = String(xml || "").match(re);
  return m ? m[1] : "";
}

function newsExtractIntAttr(xml, tag, attr) {
  const n = Number.parseInt(newsExtractAttr(xml, tag, attr) || "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/* v11.652: YouTube feed entries carry media:content = a VIDEO url
   (youtube.com/v/ID?version=3) which newsExtractImage was picking up as the
   "image" — the client <img> then failed and hid the media block, so trailer
   cards rendered with no thumbnail. Derive the real thumbnail from the video
   id instead (i.ytimg.com/vi/ID/hqdefault.jpg — always exists). */
function newsYouTubeVideoId(url) {
  const u = String(url || "");
  const m = u.match(/[?&]v=([a-zA-Z0-9_-]{6,})/) ||
            u.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/) ||
            u.match(/youtube(?:-nocookie)?\.com\/(?:embed|shorts|v)\/([a-zA-Z0-9_-]{6,})/);
  return m ? m[1] : "";
}
function newsYouTubeThumb(url) {
  const id = newsYouTubeVideoId(url);
  return id ? ("https://i.ytimg.com/vi/" + id + "/hqdefault.jpg") : "";
}
function newsYouTubeOarThumb(url) {
  const id = newsYouTubeVideoId(url);
  return id ? ("https://i.ytimg.com/vi/" + id + "/oar2.jpg") : "";
}

function newsIsVideoUrl(url = "") {
  const s = String(url || "");
  return /(?:\/\/|\.)(?:youtube\.com|youtu\.be|m\.youtube\.com|youtube-nocookie\.com)(?:[\/?]|$)/i.test(s) ||
    /(?:\/\/|\.)(?:tiktok\.com|vimeo\.com|streamable\.com)(?:[\/?]|$)/i.test(s) ||
    /\/videos?(?:\/|[?#]|$)/i.test(s);
}

function newsIsShortsLike(url = "", title = "") {
  const text = `${url || ""} ${title || ""}`;
  return /(?:youtube\.com\/shorts\/|youtu\.be\/shorts\/|[?#&]shorts=1\b|\b#shorts\b|\bshorts\b)/i.test(text);
}

function newsVideoLayout({ url = "", title = "", thumbnailWidth = 0, thumbnailHeight = 0 } = {}) {
  const isYoutube = !!newsYouTubeVideoId(url);
  const videoAspectProbeUrl = isYoutube ? newsYouTubeOarThumb(url) : "";
  if (newsIsShortsLike(url, title)) {
    return { mediaType: "video", videoAspectRatio: "9/16", videoOrientation: "portrait", videoAspectSource: "shorts-signal", videoAspectProbeUrl };
  }
  const w = Number(thumbnailWidth || 0);
  const h = Number(thumbnailHeight || 0);
  if (w > 0 && h > 0) {
    const r = w / h;
    if (r < 0.82) return { mediaType: "video", videoAspectRatio: `${w}/${h}`, videoOrientation: "portrait", thumbnailWidth: w, thumbnailHeight: h, videoAspectSource: "thumbnail-dimensions", videoAspectProbeUrl };
    if (r <= 1.18) return { mediaType: "video", videoAspectRatio: `${w}/${h}`, videoOrientation: "square", thumbnailWidth: w, thumbnailHeight: h, videoAspectSource: "thumbnail-dimensions", videoAspectProbeUrl };
    if (r > 1.45 && !isYoutube) return { mediaType: "video", videoAspectRatio: `${w}/${h}`, videoOrientation: "landscape", thumbnailWidth: w, thumbnailHeight: h, videoAspectSource: "thumbnail-dimensions", videoAspectProbeUrl };
    if (isYoutube) return { mediaType: "video", videoAspectRatio: "16/9", videoOrientation: "landscape", thumbnailWidth: w, thumbnailHeight: h, videoAspectSource: "youtube-thumbnail-canvas", videoAspectProbeUrl };
  }
  return { mediaType: "video", videoAspectRatio: "16/9", videoOrientation: "landscape", videoAspectSource: isYoutube ? "youtube-fallback" : "fallback", videoAspectProbeUrl };
}

function newsNormalizeVideoLayout(item = {}) {
  if (!item || typeof item !== "object") return item;
  const shouldNormalize = item.mediaType === "video" || newsIsVideoUrl(item.url) || newsIsShortsLike(item.url, item.title);
  if (!shouldNormalize) return item;
  const layout = newsVideoLayout({
    url: item.url,
    title: item.title,
    thumbnailWidth: item.thumbnailWidth,
    thumbnailHeight: item.thumbnailHeight
  });
  const forceShorts = newsIsShortsLike(item.url, item.title);
  const shortsThumb = forceShorts ? newsYouTubeThumb(item.url) : "";
  return {
    ...item,
    image: shortsThumb || item.image,
    mediaType: "video",
    videoAspectRatio: forceShorts ? layout.videoAspectRatio : (item.videoAspectRatio || layout.videoAspectRatio),
    videoOrientation: forceShorts ? layout.videoOrientation : (item.videoOrientation || layout.videoOrientation),
    videoAspectSource: forceShorts ? layout.videoAspectSource : (item.videoAspectSource || layout.videoAspectSource),
    videoAspectProbeUrl: item.videoAspectProbeUrl || layout.videoAspectProbeUrl,
    thumbnailWidth: item.thumbnailWidth || layout.thumbnailWidth,
    thumbnailHeight: item.thumbnailHeight || layout.thumbnailHeight
  };
}

function newsExtractImage(itemXml) {
  let img = newsExtractAttr(itemXml, "media:content", "url") || newsExtractAttr(itemXml, "media:thumbnail", "url");
  if (!img) {
    const enc = String(itemXml || "").match(/<enclosure\b[^>]*>/i);
    if (enc && /type\s*=\s*["']image/i.test(enc[0])) {
      const u = enc[0].match(/url\s*=\s*["']([^"']+)["']/i);
      if (u) img = u[1];
    }
  }
  if (!img) {
    const body = newsExtractTag(itemXml, "content:encoded") || newsExtractTag(itemXml, "description") || newsExtractTag(itemXml, "summary") || newsExtractTag(itemXml, "content");
    const m = String(body || "").match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
    if (m) img = m[1];
  }
  img = String(img || "").trim().replace(/&amp;/g, "&");
  return /^https?:\/\//i.test(img) ? img : "";
}

function parseRssFeed(xmlText, source, category) {
  const out = [];
  if (!xmlText) return out;
  let blocks = String(xmlText).match(/<item\b[\s\S]*?<\/item>/gi);
  const isAtom = !blocks || !blocks.length;
  if (isAtom) blocks = String(xmlText).match(/<entry\b[\s\S]*?<\/entry>/gi);
  if (!blocks) return out;
  for (const block of blocks) {
    const title = newsStripTags(newsExtractTag(block, "title"));
    if (!title) continue;
    let link = "";
    if (isAtom) {
      const alt = block.match(/<link\b[^>]*rel\s*=\s*["']alternate["'][^>]*href\s*=\s*["']([^"']+)["']/i);
      link = alt ? alt[1] : newsExtractAttr(block, "link", "href");
    } else {
      link = newsStripTags(newsExtractTag(block, "link")) || newsExtractAttr(block, "link", "href");
    }
    link = newsCanonicalUrl(link);
    if (!link) continue;
    const rawDate = newsExtractTag(block, "pubDate") || newsExtractTag(block, "published") || newsExtractTag(block, "updated") || newsExtractTag(block, "dc:date");
    let publishedAt = Date.parse(String(rawDate || "").trim());
    if (!Number.isFinite(publishedAt)) publishedAt = 0;
    const mediaContentUrl = newsExtractAttr(block, "media:content", "url");
    const mediaContentMedium = newsExtractAttr(block, "media:content", "medium");
    const mediaContentType = newsExtractAttr(block, "media:content", "type");
    const thumbW = newsExtractIntAttr(block, "media:thumbnail", "width") || newsExtractIntAttr(block, "media:content", "width");
    const thumbH = newsExtractIntAttr(block, "media:thumbnail", "height") || newsExtractIntAttr(block, "media:content", "height");
    const isVideo = newsIsVideoUrl(link) || /^video$/i.test(mediaContentMedium) || /^video\//i.test(mediaContentType || "") || newsIsVideoUrl(mediaContentUrl);
    const videoLayout = isVideo ? newsVideoLayout({ url: link, title, thumbnailWidth: thumbW, thumbnailHeight: thumbH }) : null;
    let summary = newsStripTags(newsExtractTag(block, "description") || newsExtractTag(block, "summary") || newsExtractTag(block, "content:encoded") || newsExtractTag(block, "content"));
    if (summary.length > 280) summary = summary.slice(0, 277).replace(/\s+\S*$/, "") + "…";
    out.push({
      id: newsHashId(link),
      category,
      title: title.length > 200 ? title.slice(0, 197) + "…" : title,
      summary,
      source,
      url: link,
      image: newsYouTubeThumb(link) || newsExtractImage(block),
      publishedAt,
      provider: "rss",
      quality: newsSourceQuality(source),
      ...(videoLayout || {})
    });
  }
  return out;
}

async function collectRssItems() {
  const results = await Promise.allSettled(NEWS_RSS_SOURCES.map(async (src) => {
    const res = await fetchTextWithTimeout(src.url, {
      headers: {
        "User-Agent": "ShelfdNewsBot/1.0 (+https://myshelfd.com)",
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8"
      }
    }, 9000);
    if (!res.ok || !res.data) { try { console.warn("[news] fetch failed:", src.source, res.status, res.error); } catch (_) {} return []; }
    try {
      let items = parseRssFeed(res.data, src.source, src.category);
      /* v11.670: per-source title allow-filter — keep ONLY items whose title
         contains this substring (e.g. a VCT channel where we want only the
         "MATCH HIGHLIGHTS" videos, not shorts / teasers / full-match VODs). */
      if (src.titleMust) { const need = String(src.titleMust).toLowerCase(); items = items.filter(it => String(it.title || "").toLowerCase().includes(need)); }
      /* v11.696: regex ALLOW-filter (parity with the Data API path's titleAllow) —
         keep ONLY titles matching the pattern. Used on the Crunchyroll YouTube feed
         to strip full episodes / the podcast while keeping trailers/PVs/clips. */
      if (src.titleAllow) { items = items.filter(it => src.titleAllow.test(String(it.title || ""))); }
      /* v11.697: regex DENY-filter (parity with the Data API path's titleBlock) —
         drop titles matching the pattern. Used on the noisier anime-news sites to
         strip listicles / figure roundups / cosplay / manga-volume reviews while
         keeping genuine anime news. */
      if (src.titleBlock) { items = items.filter(it => !src.titleBlock.test(String(it.title || ""))); }
      /* v11.692: per-item movies/tv split for MIXED screen feeds (Deadline's
         main feed — its per-category feeds are empty now). Same heuristic the
         providers use for their merged 'screen' group. */
      if (src.splitScreen) { items = items.map(it => ({ ...it, category: newsAssignScreenCategory(it.title, it.summary) })); }
      return items;
    } catch (e) { try { console.warn("[news] parse failed:", src.source, errorMessage(e)); } catch (_) {} return []; }
  }));
  const all = [];
  for (const r of results) { if (r.status === "fulfilled" && Array.isArray(r.value)) all.push(...r.value); }
  return all;
}

/* v11.669: first-party game YouTube channels whose RSS Atom feed YouTube refuses
   to serve to the Worker's Cloudflare datacenter IP — verified channel-specific:
   the feeds return 15 entries from a browser AND with our bot UA, yet come back
   EMPTY server-side, while every OTHER channel's RSS works in the same collect.
   We fetch their recent uploads via the YouTube Data API instead (the uploads
   playlist UU{rest}, 1 quota unit per channel — the same key the hype feature
   uses). Normalized to the standard news item shape, provider 'rss' so the client
   treats them exactly like the other YouTube video cards. Fails soft → []. v11.696:
   list now spans games + Movies/TV + Anime; the per-channel titleAllow/titleBlock
   above shape what each one contributes. */
const NEWS_YT_API_CHANNELS = [
  { channelId: "UCvZHe-SP3xC7DdOk4Ri8QBw", source: "Bethesda Softworks", category: "games" },   /* v11.726: replaced Rockstar Games (only ~monthly GTA-Online EVENT filler, all stale, never surfaced) with Bethesda — active official trailers/showcases (Gears, Fallout, Elder Scrolls, Doom) */
  { channelId: "UCWzmOSSiSPbVnVu3ZAyDx2w", source: "Marvel Rivals",  category: "games" },
  { channelId: "UCA1d3HFGFUmkKr2JIUA5Vlw", source: "Valorant",       category: "games" },
  { channelId: "UC87gHNI4LrmVhke9IE7VDOA", source: "Apex Legends",   category: "games" },
  { channelId: "UCnXDQbqIdp-HQuDyM4p12ng", source: "PUBG",           category: "games" },
  /* v11.694: TIER 1 Movies/TV studio + trailer channels. Added via the Data API
     path (NOT NEWS_RSS_SOURCES) deliberately — the RSS storm is at 45 feeds, 5
     under the 50-subrequest cap, so 7 more RSS feeds would re-break it. These
     fetch in maybeRefreshNewsSideCaches' own free-budget invocation instead.
     Mapped to "movies" → they feed the merged Movies&TV ('screen') chip + All.
     Every channel is an OFFICIAL first-party studio/aggregator account, so being
     the source IS the fake/AI/fan-trailer filter (no untrusted uploads possible);
     each is added to NEWS_CATEGORY_SOURCE_PATTERNS.movies so studio videos pass
     eligibility even when a title lacks a movie keyword. Channel IDs resolved via
     each handle's externalId + og:title and health-checked (15 fresh entries).
     Resolved-but-already-present (NOT re-added): Marvel Entertainment
     (UCvC4D8onUfXzvjTOM-dBfEA = the existing "Marvel" RSS entry) and Rotten
     Tomatoes Trailers (UCi8e0iOVk1fEOogdfu4YgfA = the existing "Rotten Tomatoes"). */
  { channelId: "UC3gNmTGu-TTbFPpfSs5kNkg", source: "Movieclips",                   category: "movies" },
  { channelId: "UCjmJDM5pRKbUlVIzDYYWb6g", source: "Warner Bros.",                 category: "movies" },
  { channelId: "UCq0OueAsdxH6b8nyAspwViw", source: "Universal Pictures",           category: "movies" },
  { channelId: "UCz97F7dMxBNOfGYu3rx8aCw", source: "Sony Pictures Entertainment",  category: "movies" },
  { channelId: "UC2-BeLxzUBSs0uSrmzWhJuQ", source: "20th Century Studios",         category: "movies" },
  { channelId: "UC9YHyj7QSkkSg2pjQ7M8Khg", source: "Paramount Movies",             category: "movies" },
  { channelId: "UCJ6nMHaJPZvsJ-HmUmj1SeA", source: "Lionsgate Movies",             category: "movies" },
  /* v11.695: TIER 2 Movies/TV — more official studios + distributors + the two
     film-coverage aggregators (IMDb, Fandango). Same Data API path + "movies"
     mapping + source-eligibility as Tier 1. Channel IDs resolved via externalId
     (NOT the page's "channelId", which grabbed FAN/wrong channels — @DisneyStudios
     was a fan acct, @DC was a gaming acct, @neon was wrong; corrected to the
     official @Disney / @DCOfficial / @neonrated) and health-checked (15 fresh
     entries each). IMDb + Fandango carry a titleBlock DENY-filter per the stricter
     ask: keep film/TV trailers/interviews/coverage, drop WWE/sports PPV "trailers",
     IMDb STARmeter filler, and obvious gossip. */
  { channelId: "UC_5niPa-d35gg88HaS7RrIw", source: "Disney",               category: "movies" },
  { channelId: "UC_IRYSp4auq7hKLvziWVH6w", source: "Pixar",                category: "movies" },
  { channelId: "UCiifkYAs_bq1pt_zbNAzYGg", source: "DC",                   category: "movies" },
  { channelId: "UCor9rW6PgxSQ9vUPWQdnaYQ", source: "Searchlight Pictures", category: "movies" },
  { channelId: "UCuPivVjnfNo4mb3Oog_frZg", source: "A24",                  category: "movies" },
  { channelId: "UCpy5dRhZd-JbZP4NsrnLt1w", source: "NEON",                 category: "movies" },
  { channelId: "UC_vz6SvmIkYs1_H3Wv2SKlg", source: "IMDb",                 category: "movies",
    titleBlock: /\b(wwe|aew|ufc|wwf|wrestlemania|royal rumble|smackdown|night of champions|starmeter|horoscope|zodiac|net worth)\b/i },
  { channelId: "UCMawOL0n6QekxpuVanT_KRA", source: "Fandango",             category: "movies",
    titleBlock: /\b(wwe|aew|ufc|wwf|wrestlemania|royal rumble|smackdown|night of champions|starmeter|horoscope|zodiac|net worth)\b/i },
  /* v11.696: TIER 1 ANIME video sources (category "anime"). Official / licensed
     platform + studio channels. Crunchyroll (UC6pGDc4bFGD1_36IKv3FnYg) is ALREADY
     in NEWS_RSS_SOURCES → not re-added. Episode-DUMP channels carry ANIME_PROMO_ALLOW
     (keep only trailer/PV/teaser/clip/announcement, drop full episodes); studio
     channels that mix in radio/OST get a small titleBlock; clean trailer channels
     (Netflix Anime, VIZ Media) get neither. Channel IDs resolved via externalId +
     og:title and health-checked. v11.726 SOURCE-HEALTH PASS: Ani-One Asia (empty
     uploads) → replaced by HIDIVE (active English licensed); Crunchyroll Dubs (dead
     since 2023) → REMOVED (main Crunchyroll covered via RSS); KADOKAWAanime → added
     titleAllow (was surfacing Japanese episode-clip Shorts, now only real PVs). */
  { channelId: "UCGbshtvS9t-8CW11W7TooQg", source: "Muse Asia",        category: "anime", titleAllow: ANIME_PROMO_ALLOW },
  { channelId: "UCeFzTMpr7ik6oU5MT_YAYzg", source: "HIDIVE",           category: "anime", titleAllow: ANIME_PROMO_ALLOW },   /* v11.726: replaced DEAD Ani-One Asia (empty uploads playlist) with HIDIVE — active English licensed anime (dub trailers/announcements) */
  { channelId: "UCDb0peSmF5rLX7BvuTcJfCw", source: "Aniplex USA",      category: "anime", titleAllow: ANIME_PROMO_ALLOW },
  /* v11.726: REMOVED Crunchyroll Dubs (dead — newest upload 2023; the main Crunchyroll channel is already covered via NEWS_RSS_SOURCES with ANIME_PROMO_ALLOW). */
  { channelId: "UC14Yc2Qv92DMuyNRlHvpo2Q", source: "TOHO animation",   category: "anime", titleBlock: /ラジオ|\bradio\b|\bost\b|character song|full album/i },
  { channelId: "UCY5fcqgSrQItPAX_Z5Frmwg", source: "KADOKAWAanime",    category: "anime", titleAllow: ANIME_PROMO_ALLOW, titleBlock: /ラジオ|\bradio\b|\bost\b|character song|full album/i },   /* v11.726: +titleAllow — channel is ACTIVE but posts Japanese episode-clip Shorts (「第N話より」) + radio; now only real PVs/trailers/announcements (予告/PV/trailer) surface, auto-flows when it posts a season PV */
  { channelId: "UCBSs9x2KzSLhyyA9IKyt4YA", source: "Netflix Anime",    category: "anime" },
  { channelId: "UCV1da9peoqEwqr45bpTJsbQ", source: "VIZ Media",        category: "anime" },
  /* v11.723: TIER 1 MUSIC video sources (category "music") — the Music tab had
     ZERO video sources (the biggest gap in the feed). Channel IDs resolved via the
     YT Data API (forHandle) + title-verified (e.g. @XXL is a fan acct "BIG WAVE
     CENTRAL" → used the official @XXLMagazine = "XXL" instead). Clean music-only
     channels carry NO filter; MTV / HOT 97 / The Breakfast Club require a MUSIC
     signal (titleAllow) AND deny non-music (titleBlock) so they can't flood Music;
     Billboard / Rolling Stone get the non-music deny only (they post some
     politics/gossip). Shorts ingest normally via the uploads playlist + portrait
     detection. Mapped to "music" → feed the Music chip + All. */
  { channelId: "UC4eYXhJI4-7wSWc8UNRwD4A", source: "NPR Music",          category: "music" },
  { channelId: "UCyFZMEnm1il5Wv3a6tPscbA", source: "Genius",             category: "music" },
  { channelId: "UC2Qw1dzXDBAZPwS7zm37g8g", source: "COLORS",             category: "music" },
  { channelId: "UC2pmfLm7iq6Ov1UwYrWYkZA", source: "Vevo",               category: "music" },
  { channelId: "UCsVcseUYbYjldc-XgcsiEbg", source: "Billboard",          category: "music", titleBlock: MUSIC_NONMUSIC_BLOCK },
  { channelId: "UC7kI8WjpCfFoMSNDuRh_4lA", source: "Pitchfork",          category: "music" },
  { channelId: "UC-JblcinswY50lrUdSaRNEg", source: "Rolling Stone",      category: "music", titleBlock: MUSIC_NONMUSIC_BLOCK },
  { channelId: "UCbg_UMjlHJg_19SZckaKajg", source: "XXL",                category: "music" },
  { channelId: "UCxAICW_LdkfFYwTqTHHE0vg", source: "MTV",                category: "music", titleAllow: MUSIC_PROMO_ALLOW, titleBlock: MUSIC_NONMUSIC_BLOCK },
  { channelId: "UC5RwNJQSINkzIazWaM-lM3Q", source: "HOT 97",             category: "music", titleAllow: MUSIC_PROMO_ALLOW, titleBlock: MUSIC_NONMUSIC_BLOCK },
  { channelId: "UChi08h4577eFsNXGd3sxYhw", source: "The Breakfast Club", category: "music", titleAllow: MUSIC_PROMO_ALLOW, titleBlock: MUSIC_NONMUSIC_BLOCK }
];
async function collectYouTubeApiChannel(key, ch) {
  try {
    const ytUrl = new URL(`${YOUTUBE_ORIGIN}playlistItems`);
    ytUrl.searchParams.set("part", "snippet");
    ytUrl.searchParams.set("playlistId", `UU${ch.channelId.slice(2)}`);   // uploads playlist for UCxxx is UUxxx
    ytUrl.searchParams.set("maxResults", "15");
    ytUrl.searchParams.set("key", key);
    let result = await fetchJsonWithTimeout(ytUrl, {}, 12000);
    /* v11.674: one retry on a connection-level failure (status 0 / abort) — covers
       a transient googleapis blip now that we no longer run inside the RSS storm. */
    if (!result.ok && (result.status === 0 || /timed out/i.test(result.error || ""))) {
      result = await fetchJsonWithTimeout(ytUrl, {}, 12000);
    }
    if (!result.ok || !result.data || !Array.isArray(result.data.items)) {
      try { console.warn("[news] yt-api non-ok:", ch.source, "status=" + result.status, (result.data && result.data.error && result.data.error.message) || result.error || ""); } catch (_) {}
      return [];
    }
    const out = [];
    for (const item of result.data.items) {
      const snip = (item && item.snippet) || {};
      const vid = (snip.resourceId && snip.resourceId.videoId) || "";
      const title = newsStripTags(snip.title || "");
      if (!vid || !title || title === "Private video" || title === "Deleted video") continue;
      /* v11.695: per-channel title DENY-filter — for source-trusted aggregator
         channels (IMDb, Fandango) that ALSO post clearly non-film content (WWE /
         sports PPV "trailers", IMDb STARmeter filler, gossip). Studio channels
         have no titleBlock (everything they post is their own film/TV). */
      if (ch.titleBlock && ch.titleBlock.test(title)) continue;
      /* v11.696: per-channel title ALLOW-filter — for episode-DUMP channels
         (Muse Asia, Ani-One Asia, Aniplex USA, Crunchyroll Dubs) that upload mostly
         FULL EPISODES. Keep ONLY items whose title carries a promo/clip signal
         (trailer / PV / teaser / clip / announcement / visual …) so full episodes,
         OST and compilations never flood the Anime tab. */
      if (ch.titleAllow && !ch.titleAllow.test(title)) continue;
      const link = newsCanonicalUrl(`https://www.youtube.com/watch?v=${vid}`);
      const thumbs = snip.thumbnails || {};
      const pickedThumb = (thumbs.maxres || thumbs.standard || thumbs.high || thumbs.medium || thumbs.default || {});
      const videoLayout = newsVideoLayout({
        url: link,
        title,
        thumbnailWidth: Number(pickedThumb.width || 0),
        thumbnailHeight: Number(pickedThumb.height || 0)
      });
      const fallbackThumb = newsYouTubeThumb(link) || "";
      const image = (videoLayout.videoOrientation === "portrait" && fallbackThumb)
        ? fallbackThumb
        : ((pickedThumb.url) || fallbackThumb);
      out.push({
        id: newsHashId(link),
        category: ch.category,
        title,
        summary: newsStripTags(snip.description || "").slice(0, 400),
        source: ch.source,
        url: link,
        image,
        publishedAt: Date.parse(snip.publishedAt || "") || 0,
        provider: "rss",
        quality: newsSourceQuality(ch.source),
        ...videoLayout
      });
    }
    return out;
  } catch (e) { try { console.warn("[news] yt-api failed:", ch.source, errorMessage(e)); } catch (_) {} return []; }
}
async function collectYouTubeApiItems(env) {
  try {
    const config = getYoutubeClientConfig(env);
    if (!config || !config.value) return [];
    const results = await Promise.all(NEWS_YT_API_CHANNELS.map(ch => collectYouTubeApiChannel(config.value, ch)));
    return results.flat();
  } catch (e) { return []; }
}

/* ============================================================================
   v11.674: YouTube Data API cache (decoupled from the RSS subrequest budget).

   A single Worker invocation is capped at 50 subrequests. collectRssItems alone
   fans out exactly 50 RSS feeds, so it consumes the WHOLE budget — every YT
   googleapis fetch in the same invocation then dies with "Too many subrequests"
   (proven: /api/youtube/diag?pipeline=2). So the YT collector CANNOT run in the
   same invocation as the RSS storm.

   Fix: refresh the YT videos in their OWN invocation (a dedicated 30-min cron,
   which gets a fresh 50-subrequest budget and uses only 5) and stash them in KV.
   The news refresh then MERGES them from KV via a plain read = 0 subrequests, so
   RSS keeps all 50 and the videos still flow in. KV TTL > cron cadence so a
   missed cron just serves slightly older videos (freshness ranking handles it);
   if the cron is down past the TTL, YT cleanly disappears rather than breaking.
   ========================================================================== */
const NEWS_YTAPI_KV_KEY = "news:ytapi:v1";
const NEWS_YTAPI_CACHE_TTL_SECONDS = 60 * 60 * 6;   // 6h KV TTL — graceful disappear if never refreshed
const NEWS_YTAPI_REFRESH_MS = 25 * 60 * 1000;       // re-fetch the videos if the cache is older than this

/* 0-subrequest read of the cached YT videos — safe to call inside the RSS storm. */
async function readYouTubeApiCacheItems(env) {
  try {
    if (!env || !env.NEWS_KV) return [];
    const raw = await env.NEWS_KV.get(NEWS_YTAPI_KV_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return (parsed && Array.isArray(parsed.items)) ? parsed.items : [];
  } catch (e) { return []; }
}

/* Refreshes the KV YT cache. MUST run in its OWN invocation (dedicated cron or
   the /api/youtube/diag?refreshcache=1 endpoint) so its 5 googleapis fetches get
   a clean subrequest budget. Never overwrites a good cache with an empty result.

   v11.703: MERGE BY SOURCE so a PARTIAL refresh never drops channels. ROOT CAUSE
   of the on-device narrow video mix: collectYouTubeApiItems is Promise.all over
   ~28 channels; each channel returns [] on a transient googleapis failure
   (timeout / quota / blip). The old code wrote that thin result verbatim, so one
   bad refresh REPLACED a full 17-source cache with e.g. 1 source for the whole
   25-min window — and clients kept catching those windows (proven on-device:
   NETWORK 17/489 vs the just-loaded CLIENT POOL with 1 studio source). Now: for
   every source MISSING from this refresh, we KEEP its previously-cached items, so
   the cache only ever gains/holds coverage, never loses it to a transient blip.
   Freshness ranking still buries genuinely old kept videos; the 6h TTL is the
   ultimate floor if refreshes stop entirely. */
async function refreshYouTubeApiCache(env) {
  try {
    if (!env || !env.NEWS_KV) return { ok: false, error: "NEWS_KV not bound", count: 0 };
    const fresh = await collectYouTubeApiItems(env);
    if (!Array.isArray(fresh) || !fresh.length) return { ok: false, error: "collector returned no items", count: 0 };
    let prevItems = [];
    try {
      const raw = await env.NEWS_KV.get(NEWS_YTAPI_KV_KEY);
      if (raw) { const p = JSON.parse(raw); if (p && Array.isArray(p.items)) prevItems = p.items; }
    } catch (_) {}
    const freshSources = new Set(fresh.map(it => it && it.source).filter(Boolean));
    /* v11.726: only PRESERVE prev items for sources STILL in the config but absent
       from THIS refresh (a transient channel failure) — NOT for de-configured /
       removed channels (else the merge would resurrect a removed source's stale
       items forever). This is what lets a channel removal actually take effect. */
    const configuredSources = new Set(NEWS_YT_API_CHANNELS.map(c => c.source));
    const merged = fresh.slice();
    let kept = 0;
    for (const it of prevItems) {
      if (it && it.source && !freshSources.has(it.source) && configuredSources.has(it.source)) { merged.push(it); kept++; }
    }
    await env.NEWS_KV.put(NEWS_YTAPI_KV_KEY, JSON.stringify({ at: Date.now(), items: merged }), { expirationTtl: NEWS_YTAPI_CACHE_TTL_SECONDS });
    return { ok: true, count: merged.length, freshCount: fresh.length, keptFromPrev: kept, sources: freshSources.size };
  } catch (e) { return { ok: false, error: errorMessage(e), count: 0 }; }
}

/* Keeps the YT cache warm WITHOUT a dedicated cron (account capped at 5 crons).
   Called from runNewsEndpoint ONLY on non-stale /api/news calls — i.e. invocations
   that are NOT also firing the 50-subrequest news refresh, so the 5 googleapis
   fetches have the full subrequest budget. No-op (one KV read) while the cache is
   fresh; re-fetches in the background once it ages past NEWS_YTAPI_REFRESH_MS. */
/* v11.696: returns TRUE when it actually refetched (i.e. it just spent this
   invocation's subrequest budget on the YT batch), FALSE when the cache was still
   fresh (a single KV read, no fetches). The caller uses that to avoid running the
   provider + image-backfill fetches in the SAME invocation as the (now up to ~28-
   channel) YT batch — see maybeRefreshNewsSideCaches. */
async function maybeRefreshYouTubeApiCache(env) {
  try {
    if (!env || !env.NEWS_KV) return false;
    const raw = await env.NEWS_KV.get(NEWS_YTAPI_KV_KEY);
    let at = 0;
    if (raw) { try { at = Number(JSON.parse(raw).at || 0); } catch (e) {} }
    if (at && (Date.now() - at) < NEWS_YTAPI_REFRESH_MS) return false;   // still fresh — nothing to do
    await refreshYouTubeApiCache(env);
    return true;
  } catch (e) { return false; }
}

/* v11.634: merge RSS + external providers (Event Registry, NewsAPI), then dedup
   aggressively across all of them and sort newest-first. Providers are ADDITIVE:
   if both fail / are unconfigured, the RSS pool alone still drives the feed. */
async function collectNewsItems(env) {
  /* RSS + external providers fire as one big concurrent batch — collectRssItems
     alone fans out ~50 feeds (~900+ items) via Promise.allSettled. */
  /* v11.692: providers are READ-ONLY here (KV cache only — see
     getProviderCategoryItems). The RSS storm owns this invocation's subrequest
     budget; provider HTTP fetches happen in maybeRefreshNewsSideCaches' own
     invocation. Before this, every provider fetch attempted here died with
     "Too many subrequests" AND re-parked the retry gate — poisoning the cache
     with failure stamps while never actually fetching. */
  const [rssItems, providerItems] = await Promise.all([
    collectRssItems(),
    collectProviderItems(env, { readOnly: true }).catch(() => [])
  ]);
  /* v11.674: the YouTube Data API videos are MERGED FROM KV (a 0-subrequest read),
     NOT fetched inline. ROOT CAUSE of "official videos never appear in the Games
     feed": one Worker invocation is capped at 50 subrequests, and collectRssItems
     alone uses all 50 (exactly 50 feeds), so every inline YT googleapis fetch died
     with "Too many subrequests" on EVERY refresh — even though the collector
     returns all 75 when run alone. Proven live via /api/youtube/diag?pipeline=2
     ("Too many subrequests by single Worker invocation"). The 5 fetches now run in
     their own invocation (the 30-min cron / refreshYouTubeApiCache) and land in KV;
     here we just read them. ADDITIVE + fail-soft → [], RSS feed never blocked. */
  const ytApiItems = await readYouTubeApiCacheItems(env);
  return dedupeNewsItems(filterNewsEligibleItems([...(rssItems || []), ...(providerItems || []), ...(ytApiItems || [])]));
}

/* v11.609: backfill missing card images via the article's og:image. Many feeds
   (notably Anime News Network) ship no <media:content>/enclosure, so their cards
   would be imageless — and the card layout puts the image front-and-centre.
   Runs in the background cron only, capped + parallel + short-timeout so it can
   never stall a refresh. Recency-first (items are already sorted newest-first)
   so the cards most likely to be seen get an image. */
async function backfillNewsImages(items, cap = 60) {
  const missing = [];
  for (const it of items) {
    if (it && it.url && !it.image) missing.push(it);
    if (missing.length >= cap) break;
  }
  if (!missing.length) return;
  await Promise.allSettled(missing.map(async (it) => {
    try {
      const res = await fetchTextWithTimeout(it.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ShelfdNewsBot/1.0; +https://myshelfd.com)",
          "Accept": "text/html,application/xhtml+xml"
        }
      }, 6000);
      if (!res.ok || !res.data) return;
      let img = newsMetaContent(res.data, "og:image") || newsMetaContent(res.data, "twitter:image");
      img = String(img || "").trim().replace(/&amp;/g, "&");
      if (/^https?:\/\//i.test(img)) it.image = img;
    } catch (e) {}
  }));
}

/* ============================================================================
   v11.634: EXTERNAL NEWS PROVIDERS — NewsAPI.org + NewsAPI.ai/Event Registry.
   Both keys are read SERVER-SIDE from Worker secrets only (never in the URL for
   NewsAPI — passed via X-Api-Key header; never client-visible; never logged).
   Each provider normalizes into the SAME Shelfd article shape and merges into
   the pool BEFORE dedup + the client's Smart Random ranking. A per-provider KV
   cache gates how often we actually hit each API (protecting the free quotas:
   NewsAPI 100 req/day; Event Registry 2,000 tokens total). On any failure we
   serve that provider's stale cache, else just the other provider + RSS. A
   missing secret disables that provider cleanly.
   ========================================================================== */
const NEWSAPI_ENV_NAMES = ["NEWSAPI_KEY", "NEWS_API_KEY"];
const NEWSAPI_AI_ENV_NAMES = ["NEWSAPI_AI_KEY", "NEWSAPI_AI", "EVENT_REGISTRY_KEY"];
const NEWS_PROVIDER_CACHE_PREFIX = "news:provider:v1:";
const NEWSAPI_MIN_INTERVAL_MS = 3 * 60 * 60 * 1000;        // newsapi.org refetch gate (quota 100/day)
const NEWSAPI_AI_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;    // event registry refetch gate — v11.637 balanced tier: 12h ⇒ 2 fetches/group/day
const NEWS_PROVIDER_FAIL_COOLDOWN_MS = 45 * 60 * 1000;     // after a provider failure, back off this long before retrying
const NEWSAPI_PAGE_SIZE = 40;                              // articles per newsapi category fetch
const NEWSAPI_AI_COUNT = 20;                               // articles per event-registry fetch (= tokens) — v11.637: 4 groups × 2/day × 20 ≈ 160 tokens/day (~12–13 day free-tier runway)
const NEWS_PROVIDER_RECENCY_DAYS = 5;                      // Event Registry dateStart window (kept tight — token quota)
const NEWSAPI_RECENCY_DAYS = 30;                           // v11.650: NewsAPI 'from' — wider, to backfill ~a month

/* Server-side source-quality (0..1). Mirrors the client's SOURCE_QUALITY map and
   ADDS the broader provider outlets, so provider articles from sources the client
   doesn't know still get a sensible quality (emitted as item.quality). */
const NEWS_SOURCE_QUALITY = {
  "Anime News Network": 0.82, "Variety": 0.82, "The Hollywood Reporter": 0.82, "Deadline": 0.8,
  "The Verge": 0.78, "Pitchfork": 0.78, "Rolling Stone": 0.78, "Billboard": 0.76, "Engadget": 0.74,
  "Polygon": 0.74, "Eurogamer": 0.74, "Collider": 0.74, "GameSpot": 0.72, "Empire": 0.72,
  "IGN": 0.7, "Kotaku": 0.7, "/Film": 0.7, "SlashFilm": 0.7, "PC Gamer": 0.7, "GamesRadar+": 0.7,
  "GamesRadar": 0.7, "Rock Paper Shotgun": 0.7, "NME": 0.7, "The Wrap": 0.68, "TheWrap": 0.68,
  "Stereogum": 0.68, "Spin": 0.66, "Otaku USA": 0.66, "Consequence": 0.66, "TVLine": 0.66,
  "Crunchyroll": 0.66, "ComicBook": 0.6, "ComicBook.com": 0.6, "Screen Rant": 0.6, "Game Rant": 0.58,
  "CBR": 0.58, "Anime Corner": 0.58, "FirstShowing": 0.62,
  // v11.697: additional anime-news sites.
  "Animehunch": 0.6, "Anime UK News": 0.6, "Honey's Anime": 0.55, "Tokyo Otaku Mode": 0.55,
  "Anime Trending": 0.58,
  // v11.645 must-have additions
  "IndieWire": 0.74, "MyAnimeList": 0.7, "Video Games Chronicle": 0.74, "Gematsu": 0.7,
  "Nintendo Life": 0.68, "PlayStation Blog": 0.66, "Xbox Wire": 0.66, "Steam News": 0.55,
  // v11.665: K-drama / Korean entertainment — strong weighting for K-drama coverage
  "Soompi": 0.8, "Korea JoongAng Daily": 0.82, "Korea Joongang Daily": 0.82, "Koreajoongangdaily.com": 0.82,
  "The Korea Herald": 0.82, "Korea Herald": 0.82, "Koreaherald.com": 0.82,
  // v11.674: first-party game channels — official source for their own game, so
  // treated as legitimate gaming content (≈ IGN/GameSpot tier), NOT low-quality
  // promotional filler. Freshness still dominates ranking; this just keeps them
  // from being out-weighted by written outlets at equal freshness. (was 0.6/0.62)
  "Rockstar Games": 0.68, "Marvel Rivals": 0.68, "Valorant": 0.68, "Apex Legends": 0.68, "PUBG": 0.68,
  // v11.694: Tier 1 Movies/TV studio + trailer channels — official first-party
  // sources (trailers/teasers/clips/interviews/promos), trusted tier ≈ studio news.
  "Warner Bros.": 0.7, "Universal Pictures": 0.7, "Sony Pictures Entertainment": 0.7,
  "20th Century Studios": 0.7, "Paramount Movies": 0.68, "Lionsgate Movies": 0.66, "Movieclips": 0.6,
  // v11.695: Tier 2 Movies/TV studios + distributors + film-coverage aggregators.
  "Disney": 0.7, "Pixar": 0.7, "DC": 0.68, "Searchlight Pictures": 0.7, "A24": 0.72,
  "NEON": 0.68, "IMDb": 0.66, "Fandango": 0.62,
  // v11.696: Tier 1 Anime video channels — official / licensed platforms + studios.
  "TOHO animation": 0.7, "KADOKAWAanime": 0.68, "Netflix Anime": 0.68, "VIZ Media": 0.68,
  "Aniplex USA": 0.68, "Muse Asia": 0.62, "Ani-One Asia": 0.62, "Crunchyroll Dubs": 0.66,
  // v11.723: Tier 1 Music video channels (Billboard 0.76 / Pitchfork 0.78 /
  // Rolling Stone 0.78 already set above — reused for their video items).
  "NPR Music": 0.78, "Genius": 0.7, "COLORS": 0.74, "Vevo": 0.64, "MTV": 0.6,
  "XXL": 0.66, "HOT 97": 0.6, "The Breakfast Club": 0.6,
  // v11.726 source-health swaps: Bethesda (games) replaces Rockstar; HIDIVE (anime) replaces Ani-One Asia.
  "Bethesda Softworks": 0.72, "HIDIVE": 0.68
};
function newsSourceQuality(source, fallback) {
  const q = NEWS_SOURCE_QUALITY[String(source || "").trim()];
  return (typeof q === "number") ? q : (typeof fallback === "number" ? fallback : 0.5);
}

const NEWS_SIG_STOP = { the:1,a:1,an:1,and:1,or:1,of:1,to:1,in:1,on:1,for:1,with:1,is:1,are:1,be:1,as:1,at:1,by:1,from:1,this:1,that:1,'new':1,has:1,have:1,will:1,its:1,it:1,you:1,your:1,how:1,why:1,what:1,who:1,all:1,out:1,now:1,get:1,gets:1,his:1,her:1,their:1,about:1,after:1,first:1,more:1,most:1,just:1,into:1,than:1,they:1,them:1,but:1,not:1,one:1,two:1,over:1,off:1,here:1,there:1,when:1,where:1,which:1,been:1,were:1,was:1,news:1,says:1,said:1,report:1,reportedly:1 };
/* A strong cross-source story signature: the longest significant title tokens,
   sorted — two articles with the same signature are almost certainly the same
   story even from different publishers / providers. */
function newsStorySignature(title) {
  const words = String(title || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
  const seen = {}, uniq = [];
  for (const w of words) { if (w.length >= 4 && !NEWS_SIG_STOP[w] && !seen[w]) { seen[w] = 1; uniq.push(w); } }
  uniq.sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  return uniq.slice(0, 6).sort().join(" ");
}

const NEWS_STORY_NUMBERS = {
  one: "1", first: "1",
  two: "2", second: "2",
  three: "3", third: "3",
  four: "4", fourth: "4",
  five: "5", fifth: "5",
  six: "6", sixth: "6",
  seven: "7", seventh: "7",
  eight: "8", eighth: "8",
  nine: "9", ninth: "9",
  ten: "10", tenth: "10"
};
const NEWS_STORY_ENTITY_STOP = {
  the:1,a:1,an:1,and:1,or:1,of:1,to:1,in:1,on:1,for:1,with:1,from:1,by:1,at:1,as:1,
  is:1,are:1,was:1,were:1,be:1,been:1,being:1,its:1,it:1,this:1,that:1,these:1,those:1,
  new:1,official:1,exclusive:1,report:1,reported:1,reportedly:1,latest:1,news:1,video:1,
  movie:1,movies:1,film:1,films:1,tv:1,show:1,series:1,anime:1,manga:1,game:1,games:1,
  album:1,song:1,single:1,music:1,season:1,episode:1,episodes:1,trailer:1,teaser:1,
  renewed:1,renews:1,renewal:1,renew:1,canceled:1,cancelled:1,cancelation:1,cancellation:1,
  getting:1,gets:1,got:1,lands:1,landed:1,scores:1,scored:1,greenlit:1,greenlight:1,
  release:1,released:1,releases:1,date:1,announced:1,announces:1,adds:1,added:1,cast:1,
  casting:1,filming:1,production:1,review:1,explained:1,explains:1,ending:1,begins:1
};

function newsNormalizeStoryText(value = "") {
  let s = String(value || "").toLowerCase();
  try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
  s = s.replace(/&amp;/g, " and ").replace(/[’‘]/g, "'").replace(/'s\b/g, "s");
  s = s.replace(/\bs\s*(\d{1,2})\b/g, " season $1 ");
  s = s.replace(/\bseason\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/g, (_, n) => "season " + NEWS_STORY_NUMBERS[n]);
  s = s.replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+season\b/g, (_, n) => "season " + NEWS_STORY_NUMBERS[n]);
  s = s.replace(/\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/g, "season $1");
  return s.replace(/[^a-z0-9+&]+/g, " ").replace(/\s+/g, " ").trim();
}

function newsStoryEventKind(item = {}) {
  const cat = String(item.category || "").toLowerCase();
  const title = newsNormalizeStoryText(item.title || "");
  const combined = newsNormalizeStoryText((item.title || "") + " " + (item.summary || ""));
  const match = (text) => {
    if (!text) return "";
    if (/\b(trailer|teaser|first look|sneak peek|featurette|opening titles|official pv|\bpv\b)\b/.test(text)) return "trailer";
    if (/\b(release date|premiere date|launch date|date announced|premieres on|premieres in|arrives on|arrives in|coming to|coming out|out now|available now|hits theaters|hits theatres)\b/.test(text)) return "release";
    if (/\b(cast|casting|casts|casted|joins the cast|join the cast|adds new cast|adds .* cast|new cast member|will play|set to star|to star as|reprises)\b/.test(text)) return "casting";
    if (/\b(begins filming|starts filming|filming begins|begins production|starts production|production begins|shooting begins|wraps filming|wraps production)\b/.test(text)) return "production";
    if (/\b(ending explained|explains .* ending|creator explains|showrunner explains|season finale explained|finale explained)\b/.test(text)) return "explainer";
    if (/\b(review|reviews|recap|first reactions|reaction|verdict|hands on|impressions)\b/.test(text)) return "review";
    if (/\b(box office|opening weekend|ticket sales|grosses|grossed|earns \$|passes \$|debuts? with)\b/.test(text)) return "boxoffice";
    if (cat === "games" && /\b(patch notes|hotfix|update|dlc|expansion|battle pass|roadmap|new mode|new map|nerf|buff|server maintenance)\b/.test(text)) return "gameupdate";
    if (cat === "music" && /\b(tour dates|world tour|on tour|concert|residency|festival|headliner|setlist)\b/.test(text)) return "tour";
    if (cat === "music" && /\b(new album|new single|new song|new track|music video|tracklist|debut album|drops album|releases album|announces album)\b/.test(text)) return "musicrelease";
    if (/\b(cancelled|canceled|cancels|cancelled after|canceled after|will end|ending after|not returning|axed|scrapped)\b/.test(text)) return "cancellation";
    if (/\b(renewed|renews|renewal|renewed for|greenlit|greenlights|ordered another season|ordered for season|gets another season|getting another season|gets (?:a )?season \d+|getting (?:a )?season \d+|lands (?:a )?season \d+|scores (?:a )?season \d+|returning for season \d+|returns for season \d+)\b/.test(text)) return "renewal";
    return "";
  };
  return match(title) || (combined !== title ? match(combined) : "");
}

function newsStorySeasonToken(text = "") {
  const s = newsNormalizeStoryText(text);
  const m = s.match(/\bseason\s+(\d{1,2})\b/);
  if (m) return "s" + m[1];
  if (/\banother season\b|\bnew season\b|\bnext season\b/.test(s)) return "next";
  return "";
}

function newsCleanStoryEntityCandidate(value = "") {
  let s = newsNormalizeStoryText(value);
  s = s.replace(/\bseason\s+\d{1,2}\b/g, " ");
  s = s.replace(/\b(?:another|new|next)\s+season\b/g, " ");
  s = s.replace(/\b(?:apple tv|apple|apples|netflix|netflixs|hbo max|hbomax|hbo|hbos|max|disney\+|disney|disneys|hulu|hulus|prime video|amazon|amazons|paramount\+|paramount|paramounts|peacock|peacocks|fx|amc|crunchyroll|sony|sonys|microsoft|microsofts|nintendo|nintendos|playstation|xbox)\b/g, " ");
  const words = s.split(/\s+/).filter(Boolean);
  const out = [];
  const seen = {};
  for (const w of words) {
    if (w.length < 2 || NEWS_STORY_ENTITY_STOP[w] || seen[w]) continue;
    seen[w] = 1;
    out.push(w);
    if (out.length >= 6) break;
  }
  if (out.length < 2 && !(out.length === 1 && out[0].length >= 5)) return "";
  return out.join(" ");
}

function newsExtractStoryEntity(item = {}, kind = "") {
  const title = newsNormalizeStoryText(item.title || "");
  const topics = Array.isArray(item.topics) ? item.topics : [];
  for (const topic of topics) {
    const cleaned = newsCleanStoryEntityCandidate(topic);
    if (cleaned) return cleaned;
  }
  const patterns = [
    /\b(?:renews?|renewed|greenlights?|greenlit|orders?|ordered|gives|hands|scores?|lands?|gets?|getting|returns?|returning)\s+(.+?)\s+(?:for\s+)?(?:a\s+|another\s+|new\s+|next\s+)?season\s+\d+\b/,
    /\b(?:renews?|renewed|greenlights?|greenlit|orders?|ordered|gives|hands|scores?|lands?|gets?|getting|returns?|returning)\s+(.+?)\s+(?:for\s+)?(?:another|new|next)\s+season\b/,
    /^(.+?)\s+(?:is\s+)?(?:renewed|gets|getting|lands|scores|returns|returning|greenlit|canceled|cancelled|will end|ending after)\b/,
    /\b(?:season\s+\d+\s+of)\s+(.+?)\b(?:gets|getting|renewed|trailer|release|adds|begins|starts|review|explained|premiere|date)\b/
  ];
  for (const re of patterns) {
    const m = title.match(re);
    if (m && m[1]) {
      const cleaned = newsCleanStoryEntityCandidate(m[1]);
      if (cleaned) return cleaned;
    }
  }
  let cut = title;
  const eventRe = kind === "renewal"
    ? /\b(?:renewed|renews|renewal|greenlit|greenlights|gets|getting|lands|scores|returns|returning)\b/
    : kind === "cancellation"
      ? /\b(?:cancelled|canceled|cancels|will end|ending after|not returning|axed|scrapped)\b/
      : /\b(?:trailer|teaser|release date|premiere date|cast|casting|joins|adds|filming|production|review|recap|explains|explained|box office|patch notes|update|dlc|tour|album|single|music video)\b/;
  const idx = cut.search(eventRe);
  if (idx > 0) cut = cut.slice(0, idx);
  const cleaned = newsCleanStoryEntityCandidate(cut);
  return cleaned || newsCleanStoryEntityCandidate(title);
}

function newsStoryEventKey(item = {}) {
  if (item.storyKey) return String(item.storyKey);
  const kind = newsStoryEventKind(item);
  if (!kind) return "";
  const entity = newsExtractStoryEntity(item, kind);
  if (!entity) return "";
  const cat = String(item.category || "_").toLowerCase();
  const season = newsStorySeasonToken((item.title || "") + " " + (item.summary || ""));
  return ["story", cat, kind, entity, season].filter(Boolean).join(":");
}

/* Per-category provider queries. 'screen' = Movies & TV (the merged chip); items
   are split back into movies/tv by a light heuristic so they feed the screen +
   all buckets correctly. Queries refined toward relevant entertainment news. */
const NEWS_PROVIDER_QUERIES = {
  screen: {
    cat: "screen",
    newsapiQ: '(movie OR film OR "box office" OR trailer OR teaser OR streaming OR Netflix OR HBO OR "Disney+" OR Hulu OR "Prime Video" OR Marvel OR DC OR A24 OR "TV series") AND (premiere OR cast OR casting OR review OR "release date" OR renewed OR canceled OR cancelled OR "first look")',
    newsapiDomains: "variety.com,hollywoodreporter.com,deadline.com,collider.com,indiewire.com,slashfilm.com,thewrap.com,empireonline.com,screenrant.com,tvline.com,ign.com,koreajoongangdaily.com,koreaherald.com",
    /* TITLE keywords only — Event Registry's broad categoryUri (dmoz/Arts/Movies
       etc.) pulls heavy noise (its categories sweep in sports/politics/business),
       so we match specific entertainment terms in the headline instead. */
    erOr: [{ keyword: "box office", keywordLoc: "title" }, { keyword: "trailer", keywordLoc: "title" }, { keyword: "Marvel", keywordLoc: "title" }, { keyword: "Star Wars", keywordLoc: "title" }, { keyword: "casting", keywordLoc: "title" }, { keyword: "new movie", keywordLoc: "title" }, { keyword: "TV series", keywordLoc: "title" }, { keyword: "Korean drama", keywordLoc: "title" }, { keyword: "K-drama", keywordLoc: "title" }]
  },
  anime: {
    cat: "anime",
    newsapiQ: '(anime OR manga OR "anime adaptation" OR Crunchyroll OR "anime season" OR shonen OR MAPPA OR "Toei Animation") AND (episode OR trailer OR announced OR season OR "release date" OR adaptation OR premiere OR "key visual")',
    newsapiDomains: "animenewsnetwork.com,crunchyroll.com,comicbook.com,otakuusamagazine.com,gamerant.com,screenrant.com,animecorner.me,animehunch.com,honeysanime.com,animeuknews.net,anitrendz.com,anitrendz.net",
    erOr: [{ keyword: "anime", keywordLoc: "title" }, { keyword: "manga", keywordLoc: "title" }, { keyword: "Crunchyroll", keywordLoc: "title" }]
  },
  games: {
    cat: "games",
    newsapiQ: '("video game" OR gaming OR PlayStation OR Xbox OR Nintendo OR Steam OR "game release" OR DLC OR "patch notes") AND (release OR review OR trailer OR update OR announced OR gameplay OR "release date")',
    newsapiDomains: "ign.com,polygon.com,eurogamer.net,gamespot.com,kotaku.com,pcgamer.com,rockpapershotgun.com,gamesradar.com",
    erOr: [{ keyword: "video game", keywordLoc: "title" }, { keyword: "Nintendo", keywordLoc: "title" }, { keyword: "PlayStation", keywordLoc: "title" }, { keyword: "Xbox", keywordLoc: "title" }, { keyword: "Game Pass", keywordLoc: "title" }]
  },
  music: {
    cat: "music",
    newsapiQ: '(music OR album OR single OR "new song" OR tour OR concert OR artist OR Billboard OR "hip hop" OR "pop music" OR "music video") AND (release OR review OR announces OR debut OR drops OR chart OR tour)',
    newsapiDomains: "pitchfork.com,rollingstone.com,billboard.com,stereogum.com,consequence.net,nme.com,spin.com,complex.com,hiphopdx.com",
    erOr: [{ keyword: "new album", keywordLoc: "title" }, { keyword: "new single", keywordLoc: "title" }, { keyword: "music video", keywordLoc: "title" }, { keyword: "new song", keywordLoc: "title" }, { keyword: "announces tour", keywordLoc: "title" }, { keyword: "Billboard", keywordLoc: "title" }]
  }
};
function newsProviderGroups() { return ["screen", "anime", "games", "music"]; }

/* Split a provider 'screen' article into movies vs tv (they both feed the merged
   chip + all bucket; the split only affects which underlying bucket they sit in). */
function newsAssignScreenCategory(title, summary) {
  const hay = (String(title || "") + " " + String(summary || "")).toLowerCase();
  if (/\b(tv series|series finale|season \d|episode|showrunner|renew(?:ed|s)?|cancel(?:led|ed|s)?|sitcom|miniseries|tv show|netflix series|hbo (?:max|series)|hulu|showtime|streaming series|premiere date|episodes?)\b/.test(hay)) return "tv";
  return "movies";
}

/* v11.656: category relevance + off-topic gate. This runs before Smart Random so
   ranking never has to rescue obvious commerce/politics/sports/lifestyle junk. */
const NEWS_RELEVANCE_PATTERNS = {
  movies: [
    /\b(movie|movies|film|films|cinema|box office|theaters?|theatres?|trailer|teaser|first look|poster|casting|cast|actor|actress|director|premiere|release date|sequel|prequel|reboot|remake|oscar|academy award|sundance|cannes|venice film festival|a24|marvel|dc|star wars)\b/i,
    /\b(netflix|hbo|max|disney\+|hulu|prime video|paramount\+|peacock|apple tv\+?|streaming)\b/i
  ],
  tv: [
    /\b(tv|television|series|season|episode|showrunner|sitcom|miniseries|finale|premiere|renewed|canceled|cancelled|streaming series|trailer|teaser|cast|casting|emmys?)\b/i,
    /\b(netflix|hbo|max|disney\+|hulu|prime video|paramount\+|peacock|apple tv\+?|showtime|fx|amc)\b/i
  ],
  anime: [
    /\b(anime|manga|crunchyroll|myanimelist|shonen|shojo|isekai|mappa|ufotable|toei animation|kyoto animation|studio bones|cour|key visual|light novel|simulcast|dubbed|subbed)\b/i,
    /\b(jujutsu kaisen|demon slayer|one piece|dragon ball|my hero academia|chainsaw man|solo leveling|naruto|bleach|attack on titan)\b/i
  ],
  games: [
    /\b(video games?|gaming|gameplay|gamer|gamescom|game awards|game pass|xbox|playstation|ps5|ps4|nintendo|nintendo switch|switch 2|steam deck|pc gaming|console|controller|dualsense|joy-con|dlc|patch notes?|esports|twitch)\b/i,
    /\b(ubisoft|electronic arts|ea sports|activision|blizzard|capcom|sega|square enix|bethesda|fromsoftware|rockstar games|take-two|sony interactive|microsoft gaming)\b/i,
    /\b(call of duty|fortnite|minecraft|roblox|poke.?mon|zelda|mario|gta|grand theft auto|final fantasy|resident evil|elden ring|valorant|league of legends|dota|counter-strike|cs2|halo|god of war|assassin'?s creed|monster hunter|silent hill|metal gear|persona|hades|doom|football manager|madden|nba 2k|ea sports fc|fifa)\b/i,
    /\b(?:best|top|upcoming|new|free|indie|open-world|multiplayer|single-player|co-op|horror|rpg|fps|shooter|strategy|pc|console)\s+games?\b/i,
    /\bgames?\s+(?:release|trailer|review|update|patch|dlc|announcement|showcase|direct)\b/i
  ],
  music: [
    /\b(music|album|single|song|track|artist|band|rapper|singer|tour|concert|festival|billboard|chart|label|record label|vinyl|music video|grammy|spotify|apple music|ep|lp|playlist)\b/i,
    /\b(hip hop|rap|pop music|rock band|country music|r&b|indie rock|k-pop|latin music|new release|tracklist)\b/i
  ]
};
const NEWS_CATEGORY_SOURCE_PATTERNS = {
  movies: /\b(variety|hollywood reporter|deadline|collider|indiewire|slashfilm|\/film|firstshowing|thewrap|empire|soompi|korea ?herald|korea ?joongang|joongang|movieclips|warner bros|universal pictures|sony pictures|20th century|paramount|lionsgate|rotten tomatoes|marvel|disney|pixar|\bdc\b|searchlight|a24|neon|imdb|fandango)\b/i,
  tv: /\b(variety|hollywood reporter|deadline|tvline|cbr|screen rant|thewrap|empire|soompi|korea ?herald|korea ?joongang|joongang)\b/i,
  anime: /\b(anime news network|crunchyroll|myanimelist|otaku usa|anime corner|comicbook|game rant|screen rant|muse asia|ani-one|hidive|toho animation|kadokawa|netflix anime|viz media|\bviz\b|aniplex|animehunch|honey'?s anime|tokyo otaku mode|anime uk news|anitrendz|anime trending)\b/i,
  games: /\b(gamespot|polygon|video games chronicle|pc gamer|gematsu|nintendo life|playstation blog|xbox wire|steam news|eurogamer|kotaku|rock paper shotgun|gamesradar|rockstar games|bethesda|marvel rivals|valorant|apex legends|pubg)\b/i,
  music: /\b(pitchfork|billboard|rolling stone|nme|stereogum|consequence|spin|complex|hiphopdx|npr music|genius|colors|vevo|mtv|xxl|hot ?97|breakfast club)\b/i
};
const NEWS_CATEGORY_URL_PATTERNS = {
  movies: /\/(movies?|film|box-office|trailer|reviews?)\b|[?&](?:channel|category|tag)=movies?\b/i,
  tv: /\/(tv|television|streaming|series)\b|[?&](?:channel|category|tag)=tv\b/i,
  anime: /\/(anime|manga)\b|[?&](?:channel|category|tag)=anime\b/i,
  games: /\/(games?|gaming|playstation|xbox|nintendo|pc|steam)\b|[?&](?:channel|category|tag)=(?:games?|gaming|playstation|xbox|nintendo|pc)\b/i,
  music: /\/(music|album|song|artists?|concerts?)\b|[?&](?:channel|category|tag)=music\b/i
};
const NEWS_COMMERCE_PATTERNS = [
  /\b(deal|deals|discount|coupon|promo code|sale|save|savings|clearance|rollback|lowest price|price drop|less than|under \$?\d|shipped|shop now|affiliate|sponsored|limited-time|limited time)\b/i,
  /\b(aliexpress|ali express|amazon deal|walmart deal|target deal|best buy deal|costco deal|temu|ebay deal|newegg deal|woot|coupon code)\b/i,
  /\/(?:deals?|coupons?|shop|shopping|commerce|affiliate)\b/i
];
const NEWS_OFFTOPIC_PATTERNS = [
  /\b(electric bike|e-bike|ebike|bicycle|scooter|motorcycle|car deal|truck deal|suv deal|vehicle deal|airline|flight deal|travel deal)\b/i,
  /\b(election|senate|congress|president|prime minister|parliament|governor|mayor|campaign|ballot|tariff|policy vote)\b/i,
  /\b(nfl|nba|mlb|nhl|soccer|football|basketball|baseball|tennis|golf|ufc|mma|olympics|world cup|super bowl|premier league)\b/i,
  /\b(stock market|crypto|bitcoin|mortgage|interest rate|banking|credit card|loan|inflation|earnings call)\b/i,
  /\b(weight loss|diet|workout|fitness|covid|vaccine|medical|healthcare|skincare|recipe|fashion|celebrity gossip)\b/i,
  /\b(police|murder|homicide|arrested|shooting|stabbing|burglary|robbery)\b/i
];

function newsEligibilityText(item = {}) {
  const topics = Array.isArray(item.topics) ? item.topics.join(" ") : "";
  return [
    item.title, item.summary, item.source, item.url, item.provider,
    item.providerCategory, item.providerTags, topics
  ].filter(Boolean).join(" ");
}
function newsPatternCount(patterns, text) {
  let count = 0;
  for (const re of patterns || []) { if (re.test(text)) count += 1; }
  return count;
}
function newsCategoryRelevance(item = {}) {
  const category = String(item.category || "").toLowerCase();
  const text = newsEligibilityText(item);
  const sourceHost = (String(item.source || "") + " " + newsHostLabel(item.url)).trim();
  const strong = newsPatternCount(NEWS_RELEVANCE_PATTERNS[category] || [], text);
  const source = NEWS_CATEGORY_SOURCE_PATTERNS[category]?.test(sourceHost) ? 1 : 0;
  const url = NEWS_CATEGORY_URL_PATTERNS[category]?.test(String(item.url || "")) ? 1 : 0;
  return { strong, source, url, score: strong + source + url };
}
/* v11.696: a FULL anime episode / episode-dump / podcast video — title says
   "Episode N" / "EP N" / "SUB/DUB" / "The Anime Effect" but carries NO promo signal
   (trailer/PV/teaser/clip/preview/announcement…). Source-agnostic + applied in the
   eligibility filter (which runs on EVERY union refresh AND on read), so it also
   purges episodes that the per-source allow-filter can't reach once they're already
   in the rolling archive — without waiting the 30-day retention out. */
const NEWS_ANIME_EPISODE_DUMP = /\bepisode\s*\d|\bep\s*\d+\b|sub\/dub|\[(?:english|eng)\s*(?:sub|dub)\]|the anime effect/i;
function newsIsAnimeEpisodeDump(item = {}) {
  if (String(item.category || "").toLowerCase() !== "anime") return false;
  if (!(item.mediaType === "video" || newsIsVideoUrl(item.url))) return false;
  const t = String(item.title || "");
  return NEWS_ANIME_EPISODE_DUMP.test(t) && !ANIME_PROMO_ALLOW.test(t);
}
/* v11.946: HARD political block. Mandate: NOTHING political — no Trump, no
   political figures of any kind — may EVER appear in the news feed, no matter how
   strong the entertainment relevance is. Unlike NEWS_OFFTOPIC_PATTERNS (a SOFT
   gate an entertainment-relevant story can override), this runs FIRST in
   newsArticleEligibility and rejects outright with NO relevance rescue. Term list
   stays unambiguously political to avoid nuking entertainment execs/titles (e.g.
   bare "president" is deliberately omitted so "President of Marvel Studios" / a
   "Republic Pictures" credit survive — named figures + clearly-political process
   words are blocked instead). Runs on both refresh AND read (filterNewsEligibleItems
   is called on GET /api/news), so this also purges already-cached political items. */
const NEWS_POLITICAL_HARD_BLOCK = [
  // ---- US political figures (current + recently prominent) ----
  /\b(donald\s+trump|\btrump\b|melania|ivanka|trump\s+jr\.?|joe\s+biden|\bbiden\b|hunter\s+biden|kamala(?:\s+harris)?|barack\s+obama|\bobama\b|michelle\s+obama|hillary\s+clinton|bill\s+clinton|\bclinton\b|mike\s+pence|\bpence\b|ron\s+desantis|\bdesantis\b|nikki\s+haley|vivek\s+ramaswamy|jd\s+vance|nancy\s+pelosi|\bpelosi\b|chuck\s+schumer|\bschumer\b|mitch\s+mcconnell|\bmcconnell\b|kevin\s+mccarthy|bernie\s+sanders|elizabeth\s+warren|ted\s+cruz|marco\s+rubio|josh\s+hawley|matt\s+gaetz|marjorie\s+taylor\s+greene|alexandria\s+ocasio[\s-]?cortez|\baoc\b)\b/i,
  // ---- World leaders / major political figures ----
  /\b(vladimir\s+putin|\bputin\b|volodymyr\s+zelensky+|\bzelensky+\b|xi\s+jinping|benjamin\s+netanyahu|\bnetanyahu\b|narendra\s+modi|emmanuel\s+macron|\bmacron\b|kim\s+jong[\s-]?un|recep\s+tayyip\s+erdo(?:g|ğ)an|\berdo(?:g|ğ)an\b|nicol[aá]s\s+maduro|\bmaduro\b|jair\s+bolsonaro|\bbolsonaro\b|javier\s+milei|keir\s+starmer|rishi\s+sunak|boris\s+johnson|justin\s+trudeau|\btrudeau\b)\b/i,
  // ---- Elections / voting process ----
  /\b(election|elections|electoral|ballot|ballots|voter|voters|voting|midterms?|primary\s+election|caucus|polling\s+(?:station|place)|swing\s+state|electorate)\b/i,
  // ---- Government institutions / process (entertainment-safe subset) ----
  /\b(presidential|presidency|president[\s-]?elect|u\.?s\.?\s+president|former\s+president|white\s+house|oval\s+office|prime\s+minister|the\s+senate|senator|senators|congress(?:ional)?|house\s+of\s+representatives|parliament(?:ary)?|attorney\s+general)\b/i,
  // ---- Parties / ideology ----
  /\b(republican\s+party|republicans|democratic\s+party|democrats\b|\bgop\b|\bmaga\b|left[\s-]?wing|right[\s-]?wing|bipartisan|partisan|far[\s-]?right|far[\s-]?left)\b/i,
  // ---- Political actions / concepts ----
  /\b(impeach(?:ment|ed)?|filibuster|executive\s+order|supreme\s+court|\bscotus\b|justice\s+department|\bdoj\b|tariffs?|economic\s+sanctions|immigration\s+policy|border\s+policy|deportations?|campaign\s+trail|running\s+mate|inauguration|capitol\s+riot|january\s+6(?:th)?)\b/i
];
function newsIsPolitical(item = {}) {
  /* Screen the headline/body/topics + source name (NOT the raw URL slug, which can
     carry false tokens). This is where political content actually lives. */
  const text = [
    item.title, item.summary, item.source,
    Array.isArray(item.topics) ? item.topics.join(" ") : ""
  ].filter(Boolean).join(" ");
  for (const re of NEWS_POLITICAL_HARD_BLOCK) { if (re.test(text)) return true; }
  return false;
}
function newsArticleEligibility(item = {}) {
  const category = String(item.category || "").toLowerCase();
  if (!NEWS_CATEGORIES.includes(category)) return { ok: false, reason: "unknown_category" };
  if (newsIsPolitical(item)) return { ok: false, reason: "political_hard_block" };
  if (newsIsAnimeEpisodeDump(item)) return { ok: false, reason: "anime_full_episode" };
  const text = newsEligibilityText(item);
  const relevance = newsCategoryRelevance(item);
  const commerce = newsPatternCount(NEWS_COMMERCE_PATTERNS, text);
  const offTopic = newsPatternCount(NEWS_OFFTOPIC_PATTERNS, text);
  const highRelevance = relevance.score >= 2 || relevance.strong >= 2;
  if ((commerce || offTopic) && relevance.strong <= 0) return { ok: false, reason: "off_topic_without_category_signal" };
  if (commerce >= 2 && !highRelevance) return { ok: false, reason: "commerce" };
  if (commerce >= 1 && relevance.score <= 0) return { ok: false, reason: "commerce_no_relevance" };
  if (offTopic >= 2 && !highRelevance) return { ok: false, reason: "off_topic" };
  if (offTopic >= 1 && relevance.score <= 0) return { ok: false, reason: "off_topic_no_relevance" };
  if (relevance.score <= 0) return { ok: false, reason: "no_category_relevance" };
  const penalty = Math.min(0.35, (commerce ? 0.18 : 0) + (offTopic ? 0.14 : 0) + (relevance.score === 1 && !relevance.source ? 0.08 : 0));
  return { ok: true, penalty, relevance: relevance.score };
}
function filterNewsEligibleItems(items = []) {
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;
    const eligibility = newsArticleEligibility(item);
    if (!eligibility.ok) continue;
    if (eligibility.penalty && typeof item.quality === "number") {
      item.quality = Math.max(0.05, Math.min(1, item.quality - eligibility.penalty));
    }
    out.push(item);
  }
  return out;
}

function newsHostLabel(url) {
  try { return new URL(url).hostname.replace(/^www\./i, ""); } catch (e) { return ""; }
}
function hasNewsApiKey(env) { return NEWSAPI_ENV_NAMES.some((n) => getEnvString(env, n)); }
function hasEventRegistryKey(env) { return NEWSAPI_AI_ENV_NAMES.some((n) => getEnvString(env, n)); }
function readEnvKey(env, names) { for (const n of names) { const v = getEnvString(env, n); if (v) return v; } return ""; }

/* NewsAPI.org /v2/everything — key in X-Api-Key header (never the URL/logs).
   Returns an array on success ([] allowed) or null on failure (→ use stale). */
async function fetchNewsApiProvider(env, groupKey, timeoutMs = 10000) {
  const apiKey = readEnvKey(env, NEWSAPI_ENV_NAMES);
  if (!apiKey) return [];
  const cfg = NEWS_PROVIDER_QUERIES[groupKey];
  if (!cfg || !cfg.newsapiQ) return [];
  const from = new Date(Date.now() - NEWSAPI_RECENCY_DAYS * 86400000).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    q: cfg.newsapiQ, language: "en", sortBy: "publishedAt",
    pageSize: String(NEWSAPI_PAGE_SIZE), searchIn: "title,description", from
  });
  if (cfg.newsapiDomains) params.set("domains", cfg.newsapiDomains);
  const res = await fetchJsonWithTimeout("https://newsapi.org/v2/everything?" + params.toString(), {
    // NewsAPI rejects anonymous requests ("userAgentMissing") — a UA is REQUIRED.
    headers: { "X-Api-Key": apiKey, "Accept": "application/json", "User-Agent": "ShelfdNewsBot/1.0 (+https://myshelfd.com)" }
  }, timeoutMs);
  if (!res.ok || !res.data || typeof res.data !== "object" || res.data.status === "error" || !Array.isArray(res.data.articles)) {
    try { console.warn("[news] newsapi failed:", groupKey, res.status, res.data && res.data.code); } catch (_) {}
    return null;
  }
  const out = [];
  for (const a of res.data.articles) {
    if (!a || !a.url || !a.title) continue;
    if (/^\[removed\]$/i.test(String(a.title).trim())) continue;
    const url = newsCanonicalUrl(a.url);
    if (!/^https?:\/\//i.test(url)) continue;
    let source = (a.source && a.source.name) ? String(a.source.name).trim() : "";
    if (/^\[removed\]$/i.test(source)) source = "";
    if (!source) source = newsHostLabel(url);
    let title = newsStripTags(String(a.title)); if (title.length > 200) title = title.slice(0, 197) + "…";
    let summary = newsStripTags(String(a.description || "")).replace(/\s*\[\+\d+\s*chars\]\s*$/i, "").trim();
    if (summary.length > 280) summary = summary.slice(0, 277).replace(/\s+\S*$/, "") + "…";
    let publishedAt = Date.parse(String(a.publishedAt || "")); if (!Number.isFinite(publishedAt)) publishedAt = 0;
    const image = /^https?:\/\//i.test(a.urlToImage || "") ? String(a.urlToImage) : "";
    const category = groupKey === "screen" ? newsAssignScreenCategory(title, summary) : cfg.cat;
    out.push({ id: newsHashId(url), category, title, summary, source, url, image, publishedAt, provider: "newsapi", quality: newsSourceQuality(source, 0.52) });
  }
  return out;
}

/* NewsAPI.ai / Event Registry getArticles — POST JSON, apiKey IN THE BODY.
   Returns an array on success ([] allowed) or null on failure (→ use stale). */
async function fetchEventRegistryProvider(env, groupKey, timeoutMs = 12000) {
  const apiKey = readEnvKey(env, NEWSAPI_AI_ENV_NAMES);
  if (!apiKey) return [];
  const cfg = NEWS_PROVIDER_QUERIES[groupKey];
  if (!cfg || !cfg.erOr) return [];
  const dateStart = new Date(Date.now() - NEWS_PROVIDER_RECENCY_DAYS * 86400000).toISOString().slice(0, 10);
  const body = {
    apiKey,
    query: { $query: { $and: [{ $or: cfg.erOr }, { lang: "eng" }, { dateStart }] } },
    resultType: "articles", articlesSortBy: "date", articlesCount: NEWSAPI_AI_COUNT, articlesPage: 1,
    includeArticleConcepts: true, includeArticleCategories: true, includeArticleImage: true,
    includeArticleEventUri: true, articleBodyLen: 300, dataType: ["news"]
    // NB: isDuplicateFilter is NOT allowed alongside the advanced `query` param
    // ("makes the search ambiguous") — we drop dups via the per-article
    // a.isDuplicate check + our own cross-provider dedup instead.
  };
  const res = await fetchJsonWithTimeout("https://eventregistry.org/api/v1/article/getArticles", {
    method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(body)
  }, timeoutMs);
  if (!res.ok || !res.data || typeof res.data !== "object" || res.data.error || res.data.info || !res.data.articles || !Array.isArray(res.data.articles.results)) {
    try { console.warn("[news] eventregistry failed:", groupKey, res.status, res.data && (res.data.error || res.data.info ? "err" : "shape")); } catch (_) {}
    return null;
  }
  const out = [];
  for (const a of res.data.articles.results) {
    if (!a || !a.url || !a.title || a.isDuplicate) continue;
    const url = newsCanonicalUrl(a.url);
    if (!/^https?:\/\//i.test(url)) continue;
    let source = (a.source && a.source.title) ? String(a.source.title).trim() : "";
    if (!source) source = newsHostLabel(url);
    let title = newsStripTags(String(a.title)); if (title.length > 200) title = title.slice(0, 197) + "…";
    let summary = newsStripTags(String(a.body || "")).trim();
    if (summary.length > 280) summary = summary.slice(0, 277).replace(/\s+\S*$/, "") + "…";
    let publishedAt = Date.parse(String(a.dateTimePub || a.dateTime || "")); if (!Number.isFinite(publishedAt)) publishedAt = 0;
    const image = /^https?:\/\//i.test(a.image || "") ? String(a.image) : "";
    const category = groupKey === "screen" ? newsAssignScreenCategory(title, summary) : cfg.cat;
    let topics = [];
    if (Array.isArray(a.concepts)) {
      for (const c of a.concepts) {
        if (!c || !c.label) continue;
        const score = Number(c.score || 0);
        if (score < 40 && !(c.type === "wiki" || c.type === "org" || c.type === "person")) continue;
        const label = String((c.label && c.label.eng) || "").trim();
        if (label && label.length <= 40) topics.push(label);
        if (topics.length >= 6) break;
      }
    }
    const eventId = (a.eventUri && typeof a.eventUri === "string") ? a.eventUri : "";
    const item = { id: newsHashId(url), category, title, summary, source, url, image, publishedAt, provider: "eventregistry", providerId: String(a.uri || ""), quality: newsSourceQuality(source, 0.58) };
    if (eventId) item.eventId = eventId;
    if (topics.length) item.topics = topics;
    out.push(item);
  }
  return out;
}

/* Provider-cache wrapper: fetch only when the cache is older than the provider's
   min-interval (protects quotas); on fetch failure serve the stale cache. */
async function getProviderCategoryItems(env, provider, groupKey, opts = {}) {
  if (!env || !env.NEWS_KV) return [];
  const hasKey = provider === "newsapi" ? hasNewsApiKey(env) : hasEventRegistryKey(env);
  if (!hasKey) return [];   // missing secret → provider disabled cleanly
  const cacheKey = NEWS_PROVIDER_CACHE_PREFIX + provider + ":" + groupKey;
  const minInterval = provider === "newsapi" ? NEWSAPI_MIN_INTERVAL_MS : NEWSAPI_AI_MIN_INTERVAL_MS;
  let cached = null;
  try { const raw = await env.NEWS_KV.get(cacheKey); if (raw) cached = JSON.parse(raw); } catch (e) {}
  /* v11.692: READ-ONLY mode — used inside the RSS-storm refresh invocation. The
     storm's ~45 feed fetches own that invocation's 50-subrequest budget, so a
     provider HTTP fetch there ALWAYS died with "Too many subrequests" (this is
     why both providers were failing across all groups and the screen cache sat
     empty). In read-only mode we serve whatever the cache holds — a KV read
     costs no subrequests — and the actual fetching happens in
     maybeRefreshNewsSideCaches, which runs in invocations with a free budget. */
  if (opts.readOnly) return (cached && Array.isArray(cached.items)) ? cached.items : [];
  if (cached && Array.isArray(cached.items) && (Date.now() - Number(cached.at || 0)) < minInterval) {
    return cached.items;   // fresh enough — reuse, no API call
  }
  let items = null;
  try {
    items = provider === "newsapi" ? await fetchNewsApiProvider(env, groupKey) : await fetchEventRegistryProvider(env, groupKey);
  } catch (e) { items = null; }
  if (Array.isArray(items)) {
    try { await env.NEWS_KV.put(cacheKey, JSON.stringify({ at: Date.now(), items }), { expirationTtl: NEWS_KV_TTL_SECONDS }); } catch (e) {}
    return items;
  }
  // fetch FAILED (down / quota-exhausted) → keep serving stale items, and write a
  // short backoff so we don't re-hammer the provider on every cron/cold-start/
  // stale refresh. We park `at` so the min-interval gate re-opens only after
  // NEWS_PROVIDER_FAIL_COOLDOWN_MS, not the full interval (so transient failures
  // still recover quickly) — protecting the daily quota / token budget.
  const staleItems = (cached && Array.isArray(cached.items)) ? cached.items : [];
  try {
    await env.NEWS_KV.put(cacheKey, JSON.stringify({
      at: Date.now() - Math.max(0, minInterval - NEWS_PROVIDER_FAIL_COOLDOWN_MS),
      items: staleItems,
      failedAt: Date.now()
    }), { expirationTtl: NEWS_KV_TTL_SECONDS });
  } catch (e) {}
  return staleItems;
}

async function collectProviderItems(env, opts = {}) {
  if (!env || !env.NEWS_KV) return [];
  if (!hasNewsApiKey(env) && !hasEventRegistryKey(env)) return [];
  const tasks = [];
  for (const g of newsProviderGroups()) {
    tasks.push(getProviderCategoryItems(env, "eventregistry", g, opts));   // smarter primary
    tasks.push(getProviderCategoryItems(env, "newsapi", g, opts));         // broad secondary
  }
  const settled = await Promise.allSettled(tasks);
  const out = [];
  for (const r of settled) { if (r.status === "fulfilled" && Array.isArray(r.value)) out.push(...r.value); }
  return out;
}

/* v11.692: ACTIVE provider refresh — runs collectProviderItems in fetch mode
   (the per-key min-interval gates + failure cooldowns still apply, so quotas
   stay protected). MUST run in an invocation that is NOT also firing the RSS
   storm: ≤8 provider fetches against a clean 50-subrequest budget. */
async function refreshProviderCaches(env) {
  try { await collectProviderItems(env); } catch (e) {}
}

/* v11.692: og:image backfill, decoupled from the refresh invocation (where it
   ran AFTER the ~45-feed storm and lost every one of its ≤60 fetches to the
   subrequest cap — ANN/MAL cards stayed imageless). Self-gated, reads the
   stored archive, heals up to NEWS_IMGFILL_CAP newest imageless items, and
   rewrites the archive + the derived per-category/screen lists so the healed
   images serve immediately. */
const NEWS_IMGFILL_KV_KEY = "news:imgfill:v1";
const NEWS_IMGFILL_MIN_MS = 20 * 60 * 1000;
/* v11.694: trimmed 25→15. maybeRefreshNewsSideCaches shares ONE 50-subrequest
   budget across YT (now 12 channels) + providers (≤8) + this backfill, so a lower
   cap keeps comfortable headroom as the YT channel list grows (Tier 2 next). The
   20-min gate fires many times/day, so 15/pass still heals the imageless backlog. */
const NEWS_IMGFILL_CAP = 15;
async function maybeBackfillNewsImages(env) {
  try {
    if (!env || !env.NEWS_KV) return;
    const stampRaw = await env.NEWS_KV.get(NEWS_IMGFILL_KV_KEY);
    if (stampRaw) {
      let at = 0; try { at = Number(JSON.parse(stampRaw).at || 0); } catch (e) {}
      if (at && (Date.now() - at) < NEWS_IMGFILL_MIN_MS) return;
    }
    const rawAll = await env.NEWS_KV.get(NEWS_KV_PREFIX + "all");
    if (!rawAll) return;
    let archive = []; try { archive = JSON.parse(rawAll) || []; } catch (e) { return; }
    if (!Array.isArray(archive) || !archive.length) return;
    await env.NEWS_KV.put(NEWS_IMGFILL_KV_KEY, JSON.stringify({ at: Date.now() }), { expirationTtl: 24 * 60 * 60 });
    const before = archive.reduce((n, it) => n + ((it && it.url && !it.image) ? 1 : 0), 0);
    if (!before) return;
    await backfillNewsImages(archive, NEWS_IMGFILL_CAP);   // archive is newest-first → most-visible cards heal first
    const after = archive.reduce((n, it) => n + ((it && it.url && !it.image) ? 1 : 0), 0);
    if (after >= before) return;                           // nothing healed — skip the KV rewrite
    const writes = [env.NEWS_KV.put(NEWS_KV_PREFIX + "all", JSON.stringify(archive), { expirationTtl: NEWS_KV_TTL_SECONDS })];
    const perCat = {};
    for (const cat of NEWS_CATEGORIES) perCat[cat] = [];
    for (const it of archive) { if (perCat[it.category]) perCat[it.category].push(it); }
    for (const cat of NEWS_CATEGORIES) {
      writes.push(env.NEWS_KV.put(NEWS_KV_PREFIX + cat, JSON.stringify(perCat[cat].slice(0, NEWS_PER_CATEGORY_CAP)), { expirationTtl: NEWS_KV_TTL_SECONDS }));
    }
    const screenList = perCat.movies.concat(perCat.tv)
      .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0))
      .slice(0, NEWS_PER_CATEGORY_CAP * 2);
    writes.push(env.NEWS_KV.put(NEWS_KV_PREFIX + "screen", JSON.stringify(screenList), { expirationTtl: NEWS_KV_TTL_SECONDS }));
    await Promise.allSettled(writes);
  } catch (e) {}
}

/* v11.692: every news side-cache that needs its OWN subrequest budget, in one
   self-gated pass: YouTube Data API videos (≤5 fetches, 25-min gate) + the two
   external providers (≤8 fetches, 3h/12h gates) + the og:image backfill (≤25
   fetches, 20-min gate). Worst case ≈ 38 fetches — under the 50 cap with room
   to spare. Runs from non-stale /api/news invocations (no RSS storm there) and
   from the non-news crons. */
async function maybeRefreshNewsSideCaches(env) {
  try {
    /* v11.696: the YT batch is now up to ~28 channels = ~28 subrequests. If it
       runs this invocation, it OWNS the budget — defer providers (≤8) + image
       backfill (≤15) to a later invocation where the YT cache is fresh (a no-op
       KV read). So any single invocation stays well under the 50-subrequest cap:
       max(≈28 YT, 8+15) = 28. The next /api/news call (or cron) runs the rest. */
    const didYt = await maybeRefreshYouTubeApiCache(env);
    if (didYt) return;
    await refreshProviderCaches(env);
    await maybeBackfillNewsImages(env);
  } catch (e) {}
}

/* When two items collapse, keep the better one: prefer an image, higher source
   quality, richer metadata (eventId/topics), then the fresher publish time. */
function pickBetterNewsItem(a, b) {
  const score = (x) => (x.image ? 2 : 0) + (typeof x.quality === "number" ? x.quality : 0.5) + (x.eventId ? 0.3 : 0) + (Array.isArray(x.topics) && x.topics.length ? 0.2 : 0);
  const sa = score(a), sb = score(b);
  if (Math.abs(sa - sb) > 0.15) return sa >= sb ? a : b;
  // similar richness → keep the one that carries provider metadata, then newer
  if (!!b.eventId !== !!a.eventId) return b.eventId ? b : a;
  return (a.publishedAt || 0) >= (b.publishedAt || 0) ? a : b;
}

/* Aggressive cross-provider dedup: (1) exact canonical-URL, then (2) story —
   grouped by Event Registry eventUri when present, else a category-scoped title
   signature. Keeps one best representative per story; genuinely different stories
   (different significant tokens) survive. */
function dedupeNewsItems(all) {
  const byUrl = new Map();
  for (const it of all) {
    if (!it || !it.id) continue;
    const prev = byUrl.get(it.id);
    byUrl.set(it.id, prev ? pickBetterNewsItem(prev, it) : it);
  }
  const byStory = new Map();
  const out = [];
  for (const it of byUrl.values()) {
    let key = "";
    const storyKey = newsStoryEventKey(it);
    if (storyKey) it.storyKey = storyKey;
    if (it.eventId) key = "ev:" + it.eventId;
    else if (storyKey) key = storyKey;
    else {
      const sig = newsStorySignature(it.title);
      // Only group by a title signature that is STRONG enough (>=3 significant
      // tokens). Weak 1–2 token signatures from short/generic headlines would
      // collapse genuinely different stories, so those stay unique.
      if (sig && sig.split(" ").length >= 3) key = (it.category || "_") + "|" + sig;
    }
    if (!key) { out.push(it); continue; }
    const prev = byStory.get(key);
    if (!prev) { byStory.set(key, it); }
    else { byStory.set(key, pickBetterNewsItem(prev, it)); }
  }
  for (const it of byStory.values()) out.push(it);
  out.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
  return out;
}

let newsRefreshInFlight = null;
async function runNewsRefresh(env) {
  if (!env || !env.NEWS_KV) return { ok: false, error: "NEWS_KV not bound" };
  if (newsRefreshInFlight) return newsRefreshInFlight;
  newsRefreshInFlight = (async () => {
    try {
      const fresh = await collectNewsItems(env);
      if (!fresh.length) return { ok: false, error: "no items fetched" };
      /* v11.692: og:image backfill moved OUT of this invocation (its fetches
         always lost to the RSS storm's subrequest usage) — it now runs in
         maybeBackfillNewsImages against the stored archive, with a free budget. */
      /* v11.650: 30-DAY ROLLING ARCHIVE. Instead of REPLACING the stored set each
         refresh, UNION the fresh items with the previously-stored 'all' archive,
         drop anything older than NEWS_RETAIN_DAYS, dedupe, keep newest-first. RSS
         feeds only expose their newest items, so the archive accumulates FORWARD
         (it fills toward a full month over time); NewsAPI's wider window backfills
         some history immediately. Per-category + screen lists are DERIVED from it. */
      let existingAll = [];
      try { const rawAll = await env.NEWS_KV.get(NEWS_KV_PREFIX + "all"); if (rawAll) existingAll = JSON.parse(rawAll) || []; } catch (e) {}
      const nowMs = Date.now();
      const retainMs = NEWS_RETAIN_DAYS * 86400000;
      let archive = dedupeNewsItems(filterNewsEligibleItems((Array.isArray(existingAll) ? existingAll : []).concat(fresh)));
      archive = archive.filter((it) => { const ts = Number((it && it.publishedAt) || 0); return !ts || (nowMs - ts) <= retainMs; });
      /* v11.652: heal archived YouTube items whose "image" is the bogus
         media:content VIDEO url (youtube.com/v/ID) — point it at the real
         ytimg thumbnail. Idempotent; runs every refresh so old KV data fixes
         itself. */
      for (const it of archive) {
        if (!it || !it.url) continue;
        const thumb = newsYouTubeThumb(it.url);
        if (thumb && (!it.image || !/(^|\.)ytimg\.com\//i.test(String(it.image)))) it.image = thumb;
        if (newsIsVideoUrl(it.url) || it.mediaType === "video") {
          const layout = newsVideoLayout({
            url: it.url,
            title: it.title,
            thumbnailWidth: it.thumbnailWidth,
            thumbnailHeight: it.thumbnailHeight
          });
          it.mediaType = layout.mediaType;
          const forcePortrait = newsIsShortsLike(it.url, it.title);
          it.videoAspectRatio = forcePortrait ? layout.videoAspectRatio : (it.videoAspectRatio || layout.videoAspectRatio);
          it.videoOrientation = forcePortrait ? layout.videoOrientation : (it.videoOrientation || layout.videoOrientation);
          it.videoAspectSource = forcePortrait ? layout.videoAspectSource : (it.videoAspectSource || layout.videoAspectSource);
          if (!it.videoAspectProbeUrl && layout.videoAspectProbeUrl) it.videoAspectProbeUrl = layout.videoAspectProbeUrl;
          if (!it.thumbnailWidth && layout.thumbnailWidth) it.thumbnailWidth = layout.thumbnailWidth;
          if (!it.thumbnailHeight && layout.thumbnailHeight) it.thumbnailHeight = layout.thumbnailHeight;
          if (forcePortrait && thumb) it.image = thumb;
        }
      }
      if (archive.length > NEWS_ALL_CAP) archive = archive.slice(0, NEWS_ALL_CAP);
      const items = archive;   // hosts / providers / meta below tally the whole archive
      const perCat = {};
      for (const cat of NEWS_CATEGORIES) perCat[cat] = [];
      for (const it of archive) { if (perCat[it.category]) perCat[it.category].push(it); }
      const counts = {};
      const writes = [];
      for (const cat of NEWS_CATEGORIES) {
        const list = perCat[cat].slice(0, NEWS_PER_CATEGORY_CAP);
        counts[cat] = list.length;
        writes.push(env.NEWS_KV.put(NEWS_KV_PREFIX + cat, JSON.stringify(list), { expirationTtl: NEWS_KV_TTL_SECONDS }));
      }
      /* v11.600: combined "Movies & TV" bucket — the merged 'screen' chip. Items
         keep their own movies/tv category for the card tag; only the chip merges. */
      const screenList = perCat.movies.concat(perCat.tv)
        .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0))
        .slice(0, NEWS_PER_CATEGORY_CAP * 2);
      counts.screen = screenList.length;
      writes.push(env.NEWS_KV.put(NEWS_KV_PREFIX + "screen", JSON.stringify(screenList), { expirationTtl: NEWS_KV_TTL_SECONDS }));
      const allList = archive;
      counts.all = allList.length;
      writes.push(env.NEWS_KV.put(NEWS_KV_PREFIX + "all", JSON.stringify(allList), { expirationTtl: NEWS_KV_TTL_SECONDS }));
      /* v11.607: accumulate the set of publisher HOSTS the feed has served
         (union across refreshes). The in-app reader (/api/news/article) only
         extracts URLs whose host is in this set — closing SSRF / open-proxy /
         Tavily-abuse (no internal IPs / arbitrary domains) while letting SHARED
         /article links resolve permanently, long after the exact article rotates
         out of the live feed. Private/loopback/IP hosts are never added. */
      let priorHosts = [];
      try { const rawHosts = await env.NEWS_KV.get(NEWS_KV_PREFIX + "articlehosts"); if (rawHosts) priorHosts = JSON.parse(rawHosts) || []; } catch (e) {}
      const hostSet = new Set(Array.isArray(priorHosts) ? priorHosts : []);
      for (const it of items) {
        let h = "";
        try { h = new URL(it.url).hostname.toLowerCase(); } catch (e) { continue; }
        if (!h) continue;
        if (/^(localhost$|\[)/.test(h)) continue;                 // ipv6 / localhost
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) continue;          // bare ipv4
        if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) continue; // private ranges
        hostSet.add(h);
      }
      const hostList = Array.from(hostSet).slice(0, 200);
      writes.push(env.NEWS_KV.put(NEWS_KV_PREFIX + "articlehosts", JSON.stringify(hostList), { expirationTtl: NEWS_KV_TTL_SECONDS }));
      const providers = {};
      for (const it of items) { const p = (it && it.provider) || "rss"; providers[p] = (providers[p] || 0) + 1; }
      const meta = { lastRefreshMs: Date.now(), counts, providers, total: items.length, articleHostCount: hostList.length };
      writes.push(env.NEWS_KV.put(NEWS_KV_PREFIX + "meta", JSON.stringify(meta), { expirationTtl: NEWS_KV_TTL_SECONDS }));
      await Promise.allSettled(writes);
      return { ok: true, counts, lastRefreshMs: meta.lastRefreshMs };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    } finally {
      newsRefreshInFlight = null;
    }
  })();
  return newsRefreshInFlight;
}

async function runNewsEndpoint(request, env, ctx) {
  if (request.method !== "GET") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405, { "Allow": "GET", "Cache-Control": "no-store" });
  }
  if (!env || !env.NEWS_KV) {
    return jsonResponse({ ok: false, error: "News is not configured.", items: [], hasMore: false, nextCursor: null }, 503, { "Cache-Control": "no-store" });
  }
  const url = new URL(request.url);
  let category = String(url.searchParams.get("category") || "all").toLowerCase().trim();
  /* v11.600: 'screen' = merged Movies & TV bucket (precomputed in runNewsRefresh). */
  if (category !== "all" && category !== "screen" && !NEWS_CATEGORIES.includes(category)) category = "all";
  let cursor = parseInt(url.searchParams.get("cursor") || "0", 10);
  if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;
  let limit = parseInt(url.searchParams.get("limit") || "20", 10);
  if (!Number.isFinite(limit)) limit = 20;
  /* v11.596: allow up to the full pool in one request — the client pulls the
     whole category pool and runs its own (non-chronological, unseen-first,
     reshuffle-every-open) feed algorithm + pagination client-side. */
  limit = Math.max(1, Math.min(1000, limit));   // v11.650: allow deeper pulls (30-day archive / Following)

  let listRaw = null, metaRaw = null;
  try { [listRaw, metaRaw] = await Promise.all([env.NEWS_KV.get(NEWS_KV_PREFIX + category), env.NEWS_KV.get(NEWS_KV_PREFIX + "meta")]); } catch (e) {}
  let meta = null; try { meta = metaRaw ? JSON.parse(metaRaw) : null; } catch (e) {}

  let warming = false;
  if (!listRaw) {
    // cold start: try to populate quickly, but NEVER hang the request. Race the
    // refresh against a short timeout; whichever wins, re-read KV. If it's still
    // empty, finish the refresh in the background and flag the client to retry.
    try {
      await Promise.race([
        runNewsRefresh(env),
        new Promise((resolve) => setTimeout(resolve, 9000))
      ]);
    } catch (e) {}
    try { listRaw = await env.NEWS_KV.get(NEWS_KV_PREFIX + category); } catch (e) {}
    try { const m = await env.NEWS_KV.get(NEWS_KV_PREFIX + "meta"); if (m) meta = JSON.parse(m); } catch (e) {}
    if (!listRaw) {
      warming = true;
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(runNewsRefresh(env).catch(() => {}));
    }
  } else {
    const age = (meta && meta.lastRefreshMs) ? (Date.now() - meta.lastRefreshMs) : Infinity;
    if (age > NEWS_STALE_MS && ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(runNewsRefresh(env).catch(() => {}));
    } else if (ctx && typeof ctx.waitUntil === "function") {
      /* v11.674: news cache is FRESH this call, so this invocation is NOT running
         the RSS-storm refresh — its subrequest budget is free. v11.692: widened
         from the YT cache alone to ALL the news side-caches (YT videos + the two
         external providers + the og:image backfill), each self-gated. This is
         how everything that can't survive inside the storm stays current. */
      ctx.waitUntil(maybeRefreshNewsSideCaches(env));
    }
  }

  let list = [];
  try { list = listRaw ? JSON.parse(listRaw) : []; } catch (e) { list = []; }
  if (!Array.isArray(list)) list = [];
  list = dedupeNewsItems(filterNewsEligibleItems(list)).map(newsNormalizeVideoLayout);

  const total = list.length;
  const slice = list.slice(cursor, cursor + limit);
  const nextCursor = (cursor + limit) < total ? (cursor + limit) : null;

  return jsonResponse({
    ok: true,
    category,
    items: slice,
    nextCursor,
    hasMore: nextCursor !== null,
    total,
    warming,
    lastRefreshMs: (meta && meta.lastRefreshMs) ? meta.lastRefreshMs : 0
  }, 200, { "Cache-Control": "no-store" });
}

/* ============================================================================
   v11.631: STRUCTURED article extraction. The reader used to keep only <p> text,
   flattening listicles/reviews into a wall of plain paragraphs — losing the
   section headers (e.g. "4. B.A. Baracus' GMC Vandura Van"), the per-item photos
   and the captions. We now walk the article scope in DOCUMENT ORDER and emit
   ordered BLOCKS: { type:'heading'|'paragraph'|'image'|'quote', ... }. Boilerplate
   (related/share/ad headings, avatar/logo/ad images) is filtered; inline images
   are de-duped (incl. vs the hero). Regex-based (Workers have no DOM) but scoped
   to <article>/<main>, same as the prior <p> pass. */
const NEWS_BOILER = /^(advertisement|sign up|subscribe|share this|share on|read more|related stories?|related:|follow us|cookie|privacy policy|terms of|©|all rights reserved|getty images|image:|photo:|credit:|loading\b|skip to|sponsored|newsletter|most popular|trending now|continue reading)/i;
const NEWS_BOILER_HEADING = /^(related|trending|recommended|more from|more in|more stories|sign up|newsletter|comments?|advertisement|share|follow|read more|you may( also)? like|sponsored|most popular|around the web|from our partners|read next|up next|also read|in this article|table of contents|popular on|editor'?s picks|watch now|listen now)/i;
const NEWS_IMG_SKIP = /(avatar|gravatar|\blogo\b|sprite|pixel|spacer|1x1|blank\.|placeholder|emoji|doubleclick|amazon-adsystem|\/ads?\/|\bad[._-]|feedburner|\/icons?\/|icon[._-]|wp-content\/(?:plugins|themes)\/|stat\?|\/beacon|\/track)/i;
const NEWS_CONTAINER_JUNK = /(?:\b(?:ad|ads)\b|\b(?:advert|advertisement|blogherads|googletag|pmc-cnx|pmccnx|related|recirc|recommend|newsletter|signup|sign-up|social-share|share-bar|outbrain|taboola|jwplayer|video-player|video-embed|comments?|promo|sponsor|tracking|analytics|byline|author-card|author-details|more-stories)\b)/i;
const NEWS_SCRIPT_JUNK = /\b(?:blogherads|googletag|pmcCnx|pmc-cnx|window\.__|document\.|function\s*\(|var\s+|const\s+|let\s+|addEventListener|createElement|script|adSlot|defineSlot|dataLayer|jwplayer|playerSetup|VideoPlaylist|outbrain|taboola)\b/i;

function newsAttr(tag, name) {
  const m = String(tag || "").match(new RegExp("\\b" + name + "\\s*=\\s*(?:[\"']([^\"']*)[\"']|([^\\s>]+))", "i"));
  return decodeBasicHtmlEntities(m ? String(m[1] || m[2] || "").trim() : "");
}

function newsEscapeHtml(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function newsEscapeAttr(value = "") {
  return newsEscapeHtml(value);
}

function newsNormalizeArticleUrl(value = "", baseUrl = "") {
  let raw = decodeBasicHtmlEntities(String(value || "").trim());
  if (!raw || /^data:|^javascript:|^mailto:|^tel:/i.test(raw)) return "";
  if (raw.startsWith("//")) raw = "https:" + raw;
  try {
    const u = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
    if (!/^https?:$/i.test(u.protocol)) return "";
    return u.href;
  } catch (e) {
    return "";
  }
}

function newsStripJunkContainers(html = "") {
  let out = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<template\b[\s\S]*?<\/template>/gi, " ")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ");
  out = out
    .replace(/<(div|section)\b[^>]*(?:class|id)\s*=\s*["'][^"']*(?:injected-related-story|related-stor|read-next|more-stories|o-tease|c-card-list|popular-on)[^"']*["'][\s\S]*?(?=<(?:p|h2|h3|h4|blockquote|figure)\b|<\/article>|<\/main>)/gi, " ")
    .replace(/<h[2-4]\b[^>]*>\s*(?:Related Stories?|Read Next|More Stories|Popular on THR)[\s\S]*?(?=<(?:p|h2|h3|h4|blockquote|figure)\b|<\/article>|<\/main>)/gi, " ");
  for (let i = 0; i < 3; i++) {
    out = out
      .replace(/<(aside|nav|form)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(div|section)\b[^>]*(?:class|id|data-module|data-testid|aria-label)\s*=\s*["'][^"']*(?:\b(?:ad|ads)\b|\b(?:advert|advertisement|blogherads|googletag|pmc-cnx|pmccnx|related|recirc|recommend|newsletter|signup|sign-up|social-share|share-bar|outbrain|taboola|comments?|promo|sponsor|tracking|analytics|byline|author-card|author-details|more-stories)\b)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, " ");
  }
  return out;
}

function cleanArticleInlineText(value = "") {
  let p = newsStripTags(value)
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  p = p.replace(/\s+([,.;:!?])/g, "$1").replace(/\s+(['’])s\b/g, "$1s").replace(/\s+([”])/g, "$1").replace(/([‘“])\s+/g, "$1").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
  return p;
}

function sanitizeArticleInlineHtml(inner = "", baseUrl = "") {
  let src = newsStripJunkContainers(inner)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|blockquote|li|h[1-6])>/gi, "</$1> ");
  src = src.replace(/<(?!\/?(?:a|em|strong|b|i|br)\b)[^>]+>/gi, " ");
  src = src.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_, attrs, body) => {
    const text = cleanArticleInlineText(body);
    if (!text) return "";
    const href = newsNormalizeArticleUrl(newsAttr(attrs, "href"), baseUrl);
    if (!href) return newsEscapeHtml(text);
    return `<a href="${newsEscapeAttr(href)}" target="_blank" rel="noopener noreferrer">${newsEscapeHtml(text)}</a>`;
  });
  src = src.replace(/<(em|strong|b|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, tag, body) => {
    const clean = sanitizeArticleInlineHtml(body, baseUrl);
    return clean ? `<${tag.toLowerCase()}>${clean}</${tag.toLowerCase()}>` : "";
  });
  src = src.replace(/<br\b[^>]*>/gi, "<br>");
  src = src
    .replace(/<(?!\/?(?:a|em|strong|b|i|br)\b)[^>]+>/gi, " ")
    .replace(/[ \t\r\n]+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s+(['’])s\b/g, "$1s")
    .replace(/\s+([”])/g, "$1")
    .replace(/([‘“])\s+/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
  return src;
}

function newsLooksLikeJunkText(text = "") {
  const t = String(text || "").trim();
  if (!t) return true;
  if (NEWS_BOILER.test(t)) return true;
  if (NEWS_SCRIPT_JUNK.test(t)) return true;
  if ((t.match(/[{}();=]/g) || []).length >= 6 && /\b(?:function|var|const|let|window|document|googletag|pmcCnx)\b/i.test(t)) return true;
  if (/^\s*(?:related|watch|read next|more stories|advertisement)\s*$/i.test(t)) return true;
  return false;
}

/* clean one block's inner HTML → tidy text (mirrors cleanArticleParagraphs). */
function cleanBlockText(inner) {
  return cleanArticleInlineText(inner);
  let p = newsStripTags(inner).replace(/^#{1,6}\s+/, "").replace(/^>\s+/, "").replace(/\s+/g, " ").trim();
  p = p.replace(/\s+([,.;:!?’'])/g, "$1").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
  return p;
}

/* best image URL out of an <img> tag (handles lazy-load attrs + srcset). */
function newsPickImageSrc(imgTag, baseUrl = "") {
  let src = newsAttr(imgTag, "src");
  if (!src || /^data:/i.test(src) || /\b(blank|spacer|placeholder|1x1|pixel)\b/i.test(src)) {
    src = newsAttr(imgTag, "data-src") || newsAttr(imgTag, "data-lazy-src") || newsAttr(imgTag, "data-original") || newsAttr(imgTag, "data-img") || "";
  }
  if (!src) {
    const ss = newsAttr(imgTag, "srcset") || newsAttr(imgTag, "data-srcset");
    if (ss) src = (ss.split(",")[0] || "").trim().split(/\s+/)[0] || "";
  }
  return newsNormalizeArticleUrl(src, baseUrl);
}

function newsPushImageBlock(blocks, seenImg, html, isFigure, baseUrl = "") {
  const imgTag = isFigure ? ((html.match(/<img\b[^>]*>/i) || [""])[0]) : html;
  if (!imgTag) return;
  const src = newsPickImageSrc(imgTag, baseUrl);
  if (!src || !/^https?:\/\//i.test(src)) return;
  if (NEWS_IMG_SKIP.test(src)) return;
  if (NEWS_CONTAINER_JUNK.test(imgTag) && !isFigure) return;
  // drop tiny declared images (icons / author avatars / share glyphs)
  const wm = imgTag.match(/\bwidth\s*=\s*["']?(\d+)/i);
  const hm = imgTag.match(/\bheight\s*=\s*["']?(\d+)/i);
  if (wm && parseInt(wm[1], 10) > 0 && parseInt(wm[1], 10) < 200 && hm && parseInt(hm[1], 10) > 0 && parseInt(hm[1], 10) < 200) return;
  const norm = src.split("#")[0];
  const normNoQ = norm.split("?")[0];
  if (seenImg.has(norm) || seenImg.has(normNoQ)) return;
  seenImg.add(norm); seenImg.add(normNoQ);
  let caption = "";
  if (isFigure) {
    const cap = html.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i);
    if (cap) { caption = cleanBlockText(cap[1]); if (caption.length > 220) caption = caption.slice(0, 217) + "…"; }
  }
  blocks.push({ type: "image", src: norm, caption, alt: cleanArticleInlineText(newsAttr(imgTag, "alt")) });
}

/* walk the article scope in document order → ordered content blocks. */
function extractArticleBlocks(scope, heroImage, baseUrl = "") {
  const blocks = [];
  const seenText = new Set();
  const seenImg = new Set();
  scope = newsStripJunkContainers(scope);
  if (heroImage) { seenImg.add(heroImage); seenImg.add(String(heroImage).split("#")[0]); seenImg.add(String(heroImage).split("?")[0]); }
  const RE = /<(h2|h3|h4|p|blockquote|figure)\b[^>]*>([\s\S]*?)<\/\1>|<img\b[^>]*>/gi;
  let m;
  while ((m = RE.exec(scope)) !== null) {
    if (blocks.length >= 140) break;
    if (!m[1]) { newsPushImageBlock(blocks, seenImg, m[0], false, baseUrl); continue; }
    const tag = m[1].toLowerCase();
    if (tag === "figure") { newsPushImageBlock(blocks, seenImg, m[0], true, baseUrl); continue; }
    const text = cleanBlockText(m[2] || "");
    if (newsLooksLikeJunkText(text)) continue;
    const inlineHtml = sanitizeArticleInlineHtml(m[2] || "", baseUrl);
    if (tag === "blockquote") {
      if (text.length < 18) continue;
      blocks.push({ type: "quote", text, html: inlineHtml || "" });
      continue;
    }
    if (tag === "p") {
      const endsSentence = /[.!?]["')\]]?$/.test(text);
      if (text.length < 45 && !endsSentence) continue;
      if (text.length < 18) continue;
      if (/\b(subscribe to (?:our )?newsletter|sign up for (?:our )?newsletter|this article was originally published|originally appeared on|enter your email)\b/i.test(text)) continue;
      const k = "p:" + text.slice(0, 90).toLowerCase();
      if (seenText.has(k)) continue; seenText.add(k);
      blocks.push({ type: "paragraph", text, html: inlineHtml || "" });
      continue;
    }
    // h2 / h3 / h4 (section headers, incl. listicle rank numbers)
    if (NEWS_BOILER_HEADING.test(text)) continue;
    if (text.length < 2 || text.length > 160) continue;
    const hk = "h:" + text.slice(0, 90).toLowerCase();
    if (seenText.has(hk)) continue; seenText.add(hk);
    blocks.push({ type: "heading", level: tag === "h2" ? 2 : (tag === "h3" ? 3 : 4), text, html: inlineHtml || "" });
  }
  // drop a dangling trailing heading (a "Related"-style header with nothing under it)
  while (blocks.length && blocks[blocks.length - 1].type === "heading") blocks.pop();
  return blocks;
}

/* v11.633: parse a listicle's declared item count from its title
   ("15 Greatest …", "Top 10 …", "The 20 Best …"). Returns 0 if not a count. */
function parseListCount(title) {
  const t = String(title || "").trim();
  let m = t.match(/^(?:the\s+|top\s+|these\s+|all\s+)?(\d{1,3})\b/i);
  if (!m) m = t.match(/\b(\d{1,3})\s+(?:greatest|best|worst|most|coolest|scariest|funniest|saddest|strongest|things|reasons|ways|times|moments|movies|films|shows|series|seasons|episodes|games|characters|villains|heroes|songs|albums|anime|sequels|remakes)\b/i);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  return (n >= 4 && n <= 100) ? n : 0;
}

/* v11.633: detect a TRUNCATED listicle — the publisher renders only the first N
   ranking items server-side and lazy-loads the rest via JS (Valnet/Screen Rant,
   etc.). We can't fetch the back half from static HTML, so we flag it so the
   reader can offer a clean "continue on the source" hand-off. Trigger: the title
   declares a count, we extracted real heading items, and we're short by ≥2. */
function detectListTruncation(title, blocks) {
  const declared = parseListCount(title);
  if (!declared) return { truncated: false, expectedItems: 0, gotItems: 0 };
  const h2 = blocks.filter((b) => b.type === "heading" && b.level === 2).length;
  const allH = blocks.filter((b) => b.type === "heading").length;
  const got = h2 >= 3 ? h2 : allH;
  if (got < 3) return { truncated: false, expectedItems: declared, gotItems: got };
  return { truncated: got < declared && (declared - got) >= 2, expectedItems: declared, gotItems: got };
}

/* v11.604: split Tavily's extracted plain-text body into clean reader
   paragraphs. Drops boilerplate (nav, share/subscribe cruft), de-dupes, and
   caps length. Robust to either blank-line- or single-newline-delimited text. */
function cleanArticleParagraphs(rawText = "") {
  rawText = newsStripJunkContainers(rawText);
  const text = String(rawText || "").replace(/\r/g, "").replace(/ /g, " ");
  if (!text) return [];
  let blocks = text.split(/\n\s*\n+/);
  if (blocks.length < 3) blocks = text.split(/\n+/);
  const out = [];
  const seen = new Set();
  const BOILER = /^(advertisement|sign up|subscribe|share this|share on|read more|related stories?|related:|follow us|cookie|privacy policy|terms of|©|all rights reserved|getty images|image:|photo:|credit:|loading\b|skip to|sponsored|newsletter|most popular|trending now|continue reading)/i;
  for (let block of blocks) {
    let p = cleanArticleInlineText(block);
    // tidy tag-stripping artifacts: drop the stray space before punctuation
    // (e.g. "Sano 's" → "Sano's", "word ," → "word,") and inside parentheses.
    p = p.replace(/\s+([,.;:!?’'])/g, "$1").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
    p = cleanArticleInlineText(block);
    if (!p) continue;
    if (BOILER.test(p) || newsLooksLikeJunkText(p)) continue;
    // drop non-leading boilerplate sentences that slip past the ^-anchored list
    if (/\b(subscribe to (?:our )?newsletter|sign up for (?:our )?newsletter|this article was originally published|originally appeared on|enter your email)\b/i.test(p)) continue;
    // keep real prose: long enough, OR a short-but-complete sentence
    const endsSentence = /[.!?]["')\]]?$/.test(p);
    if (p.length < 45 && !endsSentence) continue;
    if (p.length < 18) continue;
    const key = p.slice(0, 90).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= 60) break;
  }
  return out;
}

/* v11.604: pull an og:image / twitter:image (hero) + og:title from raw HTML. */
function newsMetaContent(html, key) {
  const re = new RegExp(
    "<meta\\b[^>]*\\b(?:property|name)\\s*=\\s*[\"']" + key.replace(/[:]/g, "\\$&") + "[\"'][^>]*>", "i"
  );
  const tag = String(html || "").match(re);
  if (!tag) return "";
  const m = tag[0].match(/\bcontent\s*=\s*["']([^"']+)["']/i);
  return m ? m[1].trim() : "";
}

/* v11.604: PRIMARY extractor — fetch the article HTML directly (no API, no
   quota) and pull clean reader paragraphs out of its <article>/<main> <p> tags.
   Works for the vast majority of publisher pages (server-rendered news). */
async function extractArticleFromHtml(url, timeoutMs = 9000) {
  let res;
  try {
    res = await fetchTextWithTimeout(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      }
    }, timeoutMs);
  } catch (e) {
    return { ok: false, paragraphs: [], image: "", title: "" };
  }
  if (!res.ok || !res.data) return { ok: false, paragraphs: [], image: "", title: "" };
  const html = String(res.data);

  // Scope to the main article container when present — drops nav/header/footer.
  let scope = html;
  const art = html.match(/<article\b[\s\S]*?<\/article>/i);
  if (art && art[0].length > 400) scope = art[0];
  else {
    const main = html.match(/<main\b[\s\S]*?<\/main>/i);
    if (main && main[0].length > 400) scope = main[0];
  }

  let image = newsNormalizeArticleUrl(newsMetaContent(html, "og:image") || newsMetaContent(html, "twitter:image"), url);
  let title = newsStripTags(newsMetaContent(html, "og:title") || newsExtractTag(html, "title"));

  // structured walk (headings + paragraphs + inline images, in order)
  let blocks = extractArticleBlocks(scope, image, url);
  let paragraphs = blocks.filter((b) => b.type === "paragraph").map((b) => b.text);
  // safety net: if the structured walk missed the prose, fall back to the old
  // <p>-join cleaner so we never regress to fewer paragraphs than before.
  if (paragraphs.length < 3) {
    const pBlocks = scope.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [];
    const legacy = cleanArticleParagraphs(pBlocks.map((b) => newsStripTags(b)).join("\n\n"));
    if (legacy.length > paragraphs.length) {
      paragraphs = legacy;
      if (blocks.length < 4 || legacy.length >= blocks.length + 3) {
        blocks = legacy.map((p) => ({ type: "paragraph", text: p }));
      }
    }
  }

  const trunc = detectListTruncation(title, blocks);
  return {
    ok: paragraphs.length >= 3 || blocks.length >= 4,
    paragraphs,
    blocks,
    image,
    title,
    truncated: trunc.truncated,
    expectedItems: trunc.expectedItems,
    gotItems: trunc.gotItems
  };
}

/* v11.604: FALLBACK extractor — Tavily /extract. Used only when the direct
   HTML pass comes up short (e.g. a JS-rendered page). Auto-recovers if Tavily
   is currently over its plan limit (HTTP 432) — direct fetch carries the load
   in the meantime. */
async function extractArticleViaTavily(env, url, timeoutMs = 12000) {
  const config = getTavilyClientConfig(env);
  if (!config.value) return { ok: false, paragraphs: [], image: "", title: "" };
  let result;
  try {
    result = await fetchJsonWithTimeout(new URL("extract", TAVILY_ORIGIN), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.value}` },
      body: JSON.stringify({ urls: [url], extract_depth: "basic", include_images: true, format: "text" })
    }, timeoutMs);
  } catch (e) {
    return { ok: false, paragraphs: [], image: "", title: "" };
  }
  const data = result.data && typeof result.data === "object" ? result.data : {};
  const first = Array.isArray(data.results) && data.results.length ? data.results[0] : null;
  const rawContent = first ? String(first.raw_content || first.content || "") : "";
  if (!result.ok || !rawContent) return { ok: false, paragraphs: [], image: "", title: "" };

  const paragraphs = cleanArticleParagraphs(rawContent);
  let image = "";
  if (first && Array.isArray(first.images) && first.images.length) {
    for (const im of first.images) {
      const cand = typeof im === "string" ? im : (im && im.url ? im.url : "");
      if (/^https?:\/\//i.test(cand)) { image = cand; break; }
    }
  }
  const title = newsStripTags((first && first.title) || data.title || "");
  // Tavily returns flat text (no positional structure), so blocks are just the
  // paragraphs — the direct-HTML pass above is what yields headings + images.
  const blocks = paragraphs.map((p) => ({ type: "paragraph", text: p }));
  return { ok: paragraphs.length > 0, paragraphs, blocks, image: /^https?:\/\//i.test(image) ? image : "", title };
}

/* v11.607: gate the reader's extraction on the article's HOST being a known
   news-publisher domain (`news:v1:articlehosts`, accumulated as a union across
   every refresh in runNewsRefresh). This keeps the SSRF / open-proxy / Tavily-
   abuse protection (only real publisher hosts are ever fetchable — never
   internal IPs or arbitrary domains) WHILE letting SHARED /article links resolve
   in the reader permanently, long after the exact article rotates out of the
   live feed (the v11.604 per-id allowlist broke shares after ~2h). Cold-start:
   if the set is missing, populate it (mirrors runNewsEndpoint) then re-check. */
async function isAllowedNewsArticleUrl(env, url) {
  if (!env || !env.NEWS_KV || !url) return false;
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch (e) { return false; }
  if (!host) return false;
  let raw = null;
  try { raw = await env.NEWS_KV.get(NEWS_KV_PREFIX + "articlehosts"); } catch (e) {}
  if (!raw) {
    try {
      await Promise.race([runNewsRefresh(env), new Promise((resolve) => setTimeout(resolve, 8000))]);
    } catch (e) {}
    try { raw = await env.NEWS_KV.get(NEWS_KV_PREFIX + "articlehosts"); } catch (e) {}
  }
  if (!raw) return false;
  try { const hosts = JSON.parse(raw); return Array.isArray(hosts) && hosts.indexOf(host) !== -1; }
  catch (e) { return false; }
}

/* v11.604: extract one article (direct HTML first, Tavily fallback), cached in
   NEWS_KV (7d). Always resolves to a plain object with an `ok` flag — callers
   should read `ok` rather than relying on a thrown error. */
async function extractNewsArticle(env, rawUrl = "", ctx = null) {
  const url = newsCanonicalUrl(rawUrl);
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: "A valid article URL is required.", url: String(rawUrl || "") };
  }
  const articleId = newsHashId(url);

  // Allowlist gate FIRST — before any cache read or outbound fetch — so a host
  // the feed never published can neither be fetched nor served from cache.
  const allowed = await isAllowedNewsArticleUrl(env, url);
  if (!allowed) {
    return { ok: false, error: "This article isn’t available in the reader.", url };
  }

  const cacheKey = NEWS_ARTICLE_CACHE_PREFIX + articleId;

  if (env && env.NEWS_KV) {
    try {
      const cached = await env.NEWS_KV.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        // verify the stored URL matches (defends against any hash collision in
        // the non-crypto key — only the exact same URL returns the cached body).
        // v11.631: require `blocks` (re-extract pre-structured paragraphs-only
        // entries). v11.633: require the `truncated` boolean too, so pre-detector
        // entries re-extract and pick up the listicle hand-off flag.
        if (parsed && parsed.ok && parsed.url === url && Array.isArray(parsed.blocks) && parsed.blocks.length && typeof parsed.truncated === "boolean") {
          return { ...parsed, cached: true };
        }
      }
    } catch (e) {}
  }

  // Keep the richest result across strategies. Richness = block count (headings
  // + images + paragraphs), so the structured direct-HTML pass wins over the
  // flat Tavily text whenever it produced real structure.
  let best = { ok: false, paragraphs: [], blocks: [], image: "", title: "" };
  const richness = (x) => (x && Array.isArray(x.blocks) && x.blocks.length) ? x.blocks.length : (x && Array.isArray(x.paragraphs) ? x.paragraphs.length : 0);
  try {
    const a = await extractArticleFromHtml(url);
    if (a && richness(a) > richness(best)) best = a;
  } catch (e) {}

  if (richness(best) < 4 && best.paragraphs.length < 3) {
    try {
      const t = await extractArticleViaTavily(env, url);
      if (t && richness(t) > richness(best)) best = t;
    } catch (e) {}
  }

  if (best.paragraphs.length || (best.blocks && best.blocks.length)) {
    const payload = {
      ok: true,
      url,
      title: best.title || "",
      image: /^https?:\/\//i.test(best.image || "") ? best.image : "",
      paragraphs: best.paragraphs || [],
      blocks: Array.isArray(best.blocks) && best.blocks.length ? best.blocks : (best.paragraphs || []).map((p) => ({ type: "paragraph", text: p })),
      truncated: !!best.truncated,
      expectedItems: best.expectedItems || 0,
      gotItems: best.gotItems || 0,
      extractedAt: Date.now()
    };
    if (env && env.NEWS_KV) {
      const writePromise = env.NEWS_KV
        .put(cacheKey, JSON.stringify(payload), { expirationTtl: NEWS_ARTICLE_TTL_SECONDS })
        .catch(() => {});
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(writePromise);
      else await writePromise;
    }
    return payload;
  }

  return { ok: false, error: "We couldn’t load a readable version of this article.", url };
}

async function runNewsArticleEndpoint(request, env, ctx) {
  if (request.method !== "GET") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405, { "Allow": "GET", "Cache-Control": "no-store" });
  }
  const url = new URL(request.url);
  const target = url.searchParams.get("url") || "";
  if (!target) {
    return jsonResponse({ ok: false, error: "Missing ?url." }, 400, { "Cache-Control": "no-store" });
  }
  let out;
  try { out = await extractNewsArticle(env, target, ctx); }
  catch (e) { out = { ok: false, error: errorMessage(e), url: target }; }
  // Always HTTP 200 so the client reads the `ok` flag (failed extraction is a
  // normal, expected outcome — not a network error to .catch()).
  return jsonResponse(out, 200, {
    "Cache-Control": (out && out.ok) ? "public, max-age=86400" : "no-store"
  });
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduledImdbRefresh(controller, env, ctx));
    /* v11.592: a dedicated every-2-hours cron drives the news cadence; IMDb
       refresh self-gates by time. v11.692: the news RSS-storm refresh (~45
       subrequests) now runs ONLY on its own 2h cron, so it never shares an
       invocation budget with the IMDb batch. The other (IMDb) crons instead
       refresh the news SIDE caches — YT videos, the external providers, the
       og:image backfill (≤38 fetches, all self-gated) — guaranteeing those get
       at least 4 fresh slots a day even with zero /api/news traffic overnight. */
    const cron = String((controller && controller.cron) || "");
    if (!cron || cron === "0 */2 * * *") {
      ctx.waitUntil(runNewsRefresh(env).catch(() => {}));
    } else {
      ctx.waitUntil(maybeRefreshNewsSideCaches(env).catch(() => {}));
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    /* v10.547: serve AASA for both domains so Universal Links work on
       both myshelfd.com and myscreenlist.com. */
    if (
      request.method === "GET" &&
      url.pathname === "/.well-known/apple-app-site-association"
    ) {
      return serveAppleAppSiteAssociation(env);
    }

    /* v10.795: canonicalize old verification return URLs. Some older
       Firebase email links were generated without an explicit continueUrl,
       so the hosted Firebase action page can still land on the legacy
       myscreenlist.com domain after the user taps Verify Email. Preserve
       the path/query, but hand the browser/iOS Universal Link system the
       Shelfd domain that the app now owns as its canonical auth return. */
    if (
      request.method === "GET" &&
      url.pathname === "/auth/verify" &&
      isLegacyShelfdHost(url.hostname)
    ) {
      return redirectLegacyAuthVerifyToShelfd(url);
    }

    if (url.pathname === "/profile-card-og.svg" && request.method === "GET") {
      return serveProfileCardOgSvg(url);
    }
    if (url.pathname === "/profile-og.svg" && request.method === "GET") {
      return serveProfileOgSvg(url);
    }
    if (url.pathname === "/game-profile-og.png" && request.method === "GET") {
      return serveGameProfileOgPng(request, env, url);
    }
    if (url.pathname === "/album-profile-og.png" && request.method === "GET") {
      return serveAlbumProfileOgPng(request, env, url);
    }
    if (url.pathname === "/review-og.svg" && request.method === "GET") {
      return serveReviewOgSvg(url);
    }

    if (isProfileCardSharePath(url) && isHtmlNavigationRequest(request, url)) {
      return serveProfileCardShareHtml(request, env, url);
    }
    if (isProfileSharePath(url) && isHtmlNavigationRequest(request, url)) {
      return serveProfileShareHtml(request, env, url);
    }

    if (isMediaSharePath(url) && isHtmlNavigationRequest(request, url)) {
      return serveMediaShareHtml(request, env, url);
    }
    if (isAlbumSharePath(url) && isHtmlNavigationRequest(request, url)) {
      return serveAlbumShareHtml(request, env, url);
    }
    if (isGameProfileSharePath(url) && isHtmlNavigationRequest(request, url)) {
      return serveGameProfileShareHtml(request, env, url);
    }
    if (isReviewSharePath(url) && isHtmlNavigationRequest(request, url)) {
      return serveReviewShareHtml(request, env, url);
    }
    if (isNewsArticleSharePath(url) && isHtmlNavigationRequest(request, url)) {
      return serveNewsArticleShareHtml(request, env, url);
    }

    if ((url.pathname === "/api/ai/import-match" || url.pathname === "/api/deepseek/import-match") && request.method === "POST") {
      return runScreenListAi(request, env, ctx);
    }

    if (url.pathname === "/api/ai/health") {
      return jsonResponse({
        ok: !!env.myscreenlistAi,
        binding: "myscreenlistAi",
        model: SCREENLIST_AI_MODEL
      }, env.myscreenlistAi ? 200 : 500);
    }

    if (url.pathname === "/api/steam/connect") {
      return runSteamConnectStart(request, env);
    }

    if (url.pathname === "/api/steam/callback") {
      return runSteamConnectCallback(request, env);
    }

    if (url.pathname === "/api/steam/profile") {
      return runSteamProfileEndpoint(request, env);
    }

    if (url.pathname === "/api/steam/library") {
      return runSteamLibraryEndpoint(request, env);
    }

    if (url.pathname === "/api/steam/achievements") {
      return runSteamAchievementsEndpoint(request, env, ctx);
    }

    if (url.pathname === "/api/xbox/config") return runXboxConfigEndpoint(request, env);
    if (url.pathname === "/api/xbox/connect") return runXboxConnectStart(request, env);
    if (url.pathname === "/api/xbox/callback") return runXboxConnectCallback(request, env);
    if (url.pathname === "/api/xbox/profile") return runXboxProfileEndpoint(request, env);
    if (url.pathname === "/api/xbox/library") return runXboxLibraryEndpoint(request, env);
    if (url.pathname === "/api/xbox/achievements") return runXboxAchievementsEndpoint(request, env);
    if (url.pathname === "/api/xbox/disconnect") return runXboxDisconnectEndpoint(request, env);

    if (url.pathname === "/api/trackergg/profile") {
      return runTrackerggProfileEndpoint(request, env, ctx);
    }

    if (url.pathname === "/api/trackergg/health") {
      return jsonResponse({ ok: true, tracker: getTrackerggPublicStatus(env) });
    }

    if (url.pathname === "/api/igdb/search") {
      return runIgdbSearchEndpoint(request, env, ctx);
    }
    if (url.pathname === "/api/igdb/game-info") {
      return runIgdbGameInfoEndpoint(request, env, ctx);
    }
    if (url.pathname === "/api/igdb/discover-games") {
      return runIgdbDiscoverGamesEndpoint(request, env);
    }
    if (url.pathname === "/api/igdb/cover") {
      return runIgdbCoverEndpoint(request, env, ctx);
    }
    if (url.pathname === "/api/igdb/covers") {
      return runIgdbCoversEndpoint(request, env, ctx);
    }
    if (url.pathname === "/api/musicbrainz" || url.pathname.startsWith("/api/musicbrainz/")) {
      return runMusicBrainzEndpoint(request, env, ctx);
    }
    if (url.pathname === "/api/apple-music/developer-token") {
      return runAppleMusicDeveloperTokenEndpoint(request, env);
    }
    if (url.pathname === "/api/deezer" || url.pathname.startsWith("/api/deezer/")) {
      return runDeezerEndpoint(request, env, ctx);
    }
    if (url.pathname === "/api/music-links") {
      return runMusicLinksEndpoint(request, env, ctx);
    }
    if (url.pathname === "/api/game/web-covers") {
      return runGameWebCoversEndpoint(request, env, ctx);
    }
    if (url.pathname === "/api/tavily/character-image-search") {
      return runTavilyCharacterImageSearchEndpoint(request, env, ctx);
    }

    if (url.pathname === "/api/site-stats") {
      return fetchVisitorStats(env);
    }

    /* v10.275: push notifications */
    if (url.pathname === "/api/push/register") {
      return runPushRegisterEndpoint(request, env);
    }
    if (url.pathname === "/api/push/active-dm-thread") {
      return runPushActiveDmThreadEndpoint(request, env);
    }
    if (url.pathname === "/api/push/send") {
      return runPushSendEndpoint(request, env, ctx);
    }
    /* v10.318: push diagnostics — used by Safari Web Inspector to surface
       which link in the pipeline (KV, secrets, stored token, JWT, APNs) is
       actually broken on a given device. */
    if (url.pathname === "/api/push/diagnose") {
      return runPushDiagnoseEndpoint(request, env);
    }
    if (url.pathname === "/api/push/test") {
      return runPushTestEndpoint(request, env, ctx);
    }

    if (url.pathname === "/api/rank/media") {
      return runMediaRankEndpoint(request, env, ctx);
    }

    if (url.pathname === "/api/rank/country") {
      return runCountryRankEndpoint(request, env, ctx);
    }

    if (url.pathname === "/api/rank/health") {
      return runRankHealthCheck(env);
    }

    if (url.pathname === "/api/rating/resolve") {
      return runRatingResolveEndpoint(request, env, ctx);
    }

    if (url.pathname === "/api/ai/rating-test") {
      return runAiRatingTestEndpoint(request, env, ctx);
    }

    if (url.pathname === "/api/ai/rating-search-test") {
      return runAiRatingSearchTestEndpoint(request, env, ctx);
    }

    if (url.pathname === "/api/imdb/rating") {
      return runImdbRatingEndpoint(request, env, ctx);
    }

    if (url.pathname === "/api/imdb/reviews") {
      return runImdbReviewsEndpoint(request, env, ctx);
    }

    if (url.pathname === "/api/imdb/rating-batch") {
      return runImdbRatingBatchEndpoint(request, env, ctx);
    }

    if (url.pathname === "/api/imdb/refresh-discovery") {
      return runDiscoveryRatingRefreshEndpoint(request, env, ctx);
    }

    /* v11.017: OMDb season → per-episode IMDb ratings (one network call
       for an entire season, used by the seasons page to replace TMDB
       vote_average with IMDb-via-OMDb ratings). */
    if (url.pathname === "/api/omdb/season") {
      return runOmdbSeasonEndpoint(request, env, ctx);
    }

    /* v11.094: per-episode synopsis + still image (anime episodes) via OMDb. */
    if (url.pathname === "/api/omdb/anime-episodes") {
      return runOmdbAnimeEpisodesEndpoint(request, env, ctx);
    }

    /* v10.152: YouTube Data API proxy routes for the Most Anticipated
       hype-score pipeline. Key never leaves the worker. */
    if (url.pathname === "/api/youtube/videos") {
      return runYoutubeVideosEndpoint(request, env, ctx);
    }

    if (url.pathname === "/api/youtube/comments") {
      return runYoutubeCommentsEndpoint(request, env, ctx);
    }

    /* v11.756: full comments sheet for News Feed inline videos (author/avatar/
       text/likes/time + pagination). Separate from the hype-score endpoint. */
    if (url.pathname === "/api/youtube/comment-sheet") {
      return runYoutubeCommentSheetEndpoint(request, env, ctx);
    }

    if (url.pathname === "/api/youtube/search") {
      return runYoutubeSearchEndpoint(request, env, ctx);
    }

    if (url.pathname === "/api/youtube/channel-uploads") {
      return runYoutubeChannelUploadsEndpoint(request, env, ctx);
    }

    /* v11.084: aggregated trailer view-count total for a Movie/TV profile. */
    if (url.pathname === "/api/youtube/trailer-views") {
      return runYoutubeTrailerViewsEndpoint(request, env, ctx);
    }

    /* v11.672: safe Worker-side YouTube Data API health check (no key exposed). */
    if (url.pathname === "/api/youtube/diag") {
      return runYoutubeDiagnosticEndpoint(request, env, ctx);
    }

    if (url.pathname.startsWith("/api/tmdb/")) {
      return proxyApi(request, env, {
        prefix: "/api/tmdb/",
        origin: TMDB_ORIGIN,
        authParam: "api_key",
        keyEnv: "TMDB_KEY",
        label: "TMDB"
      }, ctx);
    }

    if (url.pathname.startsWith("/api/rawg/")) {
      return proxyApi(request, env, {
        prefix: "/api/rawg/",
        origin: RAWG_ORIGIN,
        authParam: "key",
        keyEnv: "RAWG_KEY",
        label: "RAWG"
      }, ctx);
    }

    if (url.pathname === "/api/news/article") {
      return runNewsArticleEndpoint(request, env, ctx);
    }

    if (url.pathname === "/api/news") {
      return runNewsEndpoint(request, env, ctx);
    }

    if (url.pathname.startsWith("/api/")) {
      return jsonResponse({
        ok: false,
        error: "Unknown Shelfd API route.",
        path: url.pathname
      }, 404, {
        "x-shelfd-api-router": "worker-v366"
      });
    }

    const shouldRegister = isHtmlNavigationRequest(request, url);
    const cookieHeader = shouldRegister ? await registerVisitor(request, env) : "";
    let response = await env.ASSETS.fetch(request);
    if (shouldRegister && response.status === 404) {
      const spaUrl = new URL("/index.html", url.origin);
      response = await env.ASSETS.fetch(new Request(spaUrl.toString(), request));
    }
    if (shouldRegister) response = withHtmlNoStoreHeaders(response);
    return withAppendedCookie(response, cookieHeader);
  }
};

export class VisitorCounter {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/register") {
      const { visitorId } = await request.json();
      if (!visitorId) {
        return Response.json({ error: "Missing visitorId" }, { status: 400 });
      }

      const visitorKey = `visitor:${visitorId}`;
      const seen = await this.state.storage.get(visitorKey);
      if (!seen) {
        const totalVisitors = (await this.state.storage.get("totalVisitors")) || 0;
        await this.state.storage.put(visitorKey, Date.now());
        await this.state.storage.put("totalVisitors", totalVisitors + 1);
      }

      const totalVisitors = (await this.state.storage.get("totalVisitors")) || 0;
      return Response.json({ totalVisitors });
    }

    if (request.method === "GET" && url.pathname === "/stats") {
      const totalVisitors = (await this.state.storage.get("totalVisitors")) || 0;
      return Response.json({ totalVisitors });
    }

    return new Response("Not found", { status: 404 });
  }
}

/* ============================================================================
   v10.275 — Push notifications via APNs HTTP/2
   ----------------------------------------------------------------------------
   /api/push/register : client POSTs { uid, token, platform } after the iOS
                        Capacitor PushNotifications plugin yields a device
                        token. We dedupe per-uid by token and store in KV
                        binding PUSH_TOKENS_KV. Soft-fails if KV isn't bound
                        yet (so this endpoint is safe to deploy before the
                        operator runs `wrangler kv namespace create`).

   /api/push/send     : client POSTs { recipientUid, title, body, data,
                        notificationId } right after writing a notification
                        doc to Firestore. We look up the recipient's tokens
                        from KV and POST to api.push.apple.com for each one.

   APNs JWT is signed using the .p8 private key with ES256. The JWT is
   cached in memory for ~50 minutes (Apple allows up to 60). Uses Cloudflare
   Workers' built-in Web Crypto.

   Required secrets / bindings (operator sets these via wrangler):
     - APNS_KEY_P8     : raw contents of the .p8 file (PEM)
     - APNS_KEY_ID     : the 10-char Key ID from Apple
     - APPLE_TEAM_ID   : the 10-char Team ID from Apple
     - PUSH_TOKENS_KV  : KV namespace binding (in wrangler.jsonc)
   ============================================================================ */

const APNS_BUNDLE_ID = "com.myshelfd.app";
const APNS_HOST = "https://api.push.apple.com";
/* v10.391: APNs sandbox host. TestFlight + App Store builds use the
   production host; Xcode-installed development builds yield tokens that
   ONLY work against the sandbox host. We try production first (the
   common case) and fall back to sandbox if APNs returns BadDeviceToken.
   Successful host is then persisted on the token entry so subsequent
   sends skip the wrong host straight away. */
const APNS_SANDBOX_HOST = "https://api.sandbox.push.apple.com";
const PUSH_ACTIVE_DM_MAX_AGE_MS = 45000;
const PUSH_ACTIVE_DM_TTL_SECONDS = 90;
/* In-memory JWT cache. Survives between requests on the same Worker isolate.
   Worth: Apple rate-limits JWT generation; one fresh JWT per ~50 min suffices. */
let _apnsJwtCache = { jwt: "", expiresAtMs: 0 };

function _jsonOK(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

async function _readJsonBody(request) {
  try {
    const text = await request.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch (_) { return {}; }
}

async function runPushRegisterEndpoint(request, env) {
  if (request.method !== "POST") return _jsonOK({ ok: false, error: "method-not-allowed" }, 405);
  const body = await _readJsonBody(request);
  const uid = String(body.uid || "").trim();
  const token = String(body.token || "").trim();
  const platform = String(body.platform || "ios").trim().toLowerCase();
  if (!uid || !token) return _jsonOK({ ok: false, error: "missing-uid-or-token" }, 400);
  if (token.length < 32 || token.length > 200) return _jsonOK({ ok: false, error: "invalid-token-length" }, 400);

  const kv = env.PUSH_TOKENS_KV;
  if (!kv) {
    /* KV not bound yet — soft success so the client doesn't keep retrying.
       Operator will bind PUSH_TOKENS_KV via wrangler.jsonc + namespace
       creation, and registrations will start sticking on next deploy. */
    console.warn("[push] PUSH_TOKENS_KV not bound; skipping register");
    return _jsonOK({ ok: true, stored: false, reason: "kv-not-configured" });
  }

  try {
    const key = `tokens:${uid}`;
    const existingRaw = await kv.get(key);
    const existing = existingRaw ? JSON.parse(existingRaw) : [];
    const list = Array.isArray(existing) ? existing : [];
    /* Dedupe by token. Keep the latest registeredAtMs. */
    const filtered = list.filter(entry => entry && entry.token !== token);
    filtered.push({
      token,
      platform,
      appBundleId: String(body.appBundleId || APNS_BUNDLE_ID).trim() || APNS_BUNDLE_ID,
      registeredAtMs: Number(body.registeredAtMs) || Date.now()
    });
    /* Cap list size to last 8 devices per user. */
    while (filtered.length > 8) filtered.shift();
    await kv.put(key, JSON.stringify(filtered));
    return _jsonOK({ ok: true, stored: true, count: filtered.length });
  } catch (e) {
    console.warn("[push] register failed:", e && e.message ? e.message : e);
    return _jsonOK({ ok: false, error: "kv-write-failed" }, 502);
  }
}

function pushActiveDmKey(uid, token) {
  return `active-dm:${uid}:${token}`;
}

function getDirectMessageThreadIdFromPushPayload(data = {}, notificationId = "") {
  const type = String(data && data.type || "").trim();
  const explicitThreadId = String(data && data.threadId || "").trim();
  const explicitNotificationId = String(notificationId || (data && data.notificationId) || "").trim();
  if (type === "direct_message" && explicitThreadId) return explicitThreadId;
  if (explicitNotificationId.indexOf("direct_message:") === 0) {
    const parts = explicitNotificationId.split(":");
    return String(parts[1] || "").trim();
  }
  return "";
}

async function runPushActiveDmThreadEndpoint(request, env) {
  if (request.method !== "POST") return _jsonOK({ ok: false, error: "method-not-allowed" }, 405);
  const body = await _readJsonBody(request);
  const uid = String(body.uid || "").trim();
  const token = String(body.token || "").trim();
  const threadId = String(body.threadId || "").trim();
  const active = body.active !== false && !!threadId;
  if (!uid || !token) return _jsonOK({ ok: false, error: "missing-uid-or-token" }, 400);
  if (token.length < 32 || token.length > 200) return _jsonOK({ ok: false, error: "invalid-token-length" }, 400);

  const kv = env.PUSH_TOKENS_KV;
  if (!kv) return _jsonOK({ ok: true, stored: false, reason: "kv-not-configured" });

  const key = pushActiveDmKey(uid, token);
  try {
    if (!active) {
      await kv.delete(key);
      return _jsonOK({ ok: true, active: false, cleared: true });
    }
    await kv.put(key, JSON.stringify({
      uid,
      activeThreadId: threadId,
      tokenTail: token.slice(-6),
      serverUpdatedAtMs: Date.now(),
      clientUpdatedAtMs: Number(body.updatedAtMs || 0) || 0,
      reason: String(body.reason || "").slice(0, 80)
    }), { expirationTtl: PUSH_ACTIVE_DM_TTL_SECONDS });
    return _jsonOK({ ok: true, active: true, threadId, ttlSeconds: PUSH_ACTIVE_DM_TTL_SECONDS });
  } catch (e) {
    console.warn("[push] active-dm write failed:", e && e.message ? e.message : e);
    return _jsonOK({ ok: false, error: "kv-write-failed" }, 502);
  }
}

async function isPushTokenViewingDirectMessageThread(kv, uid, token, threadId, nowMs = Date.now()) {
  if (!kv || !uid || !token || !threadId) return false;
  try {
    const raw = await kv.get(pushActiveDmKey(uid, token));
    if (!raw) return false;
    const state = JSON.parse(raw);
    const activeThreadId = String(state && state.activeThreadId || "").trim();
    const updatedAtMs = Number(state && state.serverUpdatedAtMs || 0) || 0;
    if (!activeThreadId || activeThreadId !== threadId || !updatedAtMs) return false;
    return nowMs - updatedAtMs >= 0 && nowMs - updatedAtMs <= PUSH_ACTIVE_DM_MAX_AGE_MS;
  } catch (e) {
    console.warn("[push] active-dm read failed:", e && e.message ? e.message : e);
    return false;
  }
}

async function runPushSendEndpoint(request, env, ctx) {
  if (request.method !== "POST") return _jsonOK({ ok: false, error: "method-not-allowed" }, 405);
  const body = await _readJsonBody(request);
  const recipientUid = String(body.recipientUid || "").trim();
  if (!recipientUid) return _jsonOK({ ok: false, error: "missing-recipientUid" }, 400);

  const kv = env.PUSH_TOKENS_KV;
  if (!kv) return _jsonOK({ ok: false, error: "kv-not-configured" }, 503);

  const apnsConfigured = !!(env.APNS_KEY_P8 && env.APNS_KEY_ID && env.APPLE_TEAM_ID);
  if (!apnsConfigured) return _jsonOK({ ok: false, error: "apns-not-configured" }, 503);

  let tokens = [];
  try {
    const raw = await kv.get(`tokens:${recipientUid}`);
    tokens = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(tokens)) tokens = [];
  } catch (e) {
    return _jsonOK({ ok: false, error: "kv-read-failed" }, 502);
  }
  if (!tokens.length) return _jsonOK({ ok: true, delivered: 0, reason: "no-tokens" });

  const data = (body.data && typeof body.data === "object") ? body.data : {};
  const notificationId = String(body.notificationId || data.notificationId || "").trim();
  const directMessageThreadId = getDirectMessageThreadIdFromPushPayload(data, notificationId);
  const activeStateCheckedAtMs = Date.now();
  let activeDmSuppressed = 0;
  const tokenSendEntries = await Promise.all(tokens.map(async (entry, idx) => {
    const token = String(entry && entry.token || "").trim();
    if (directMessageThreadId && token && await isPushTokenViewingDirectMessageThread(kv, recipientUid, token, directMessageThreadId, activeStateCheckedAtMs)) {
      activeDmSuppressed += 1;
      return {
        idx,
        entry,
        suppressed: true,
        result: {
          idx,
          ok: true,
          suppressed: true,
          reason: "active-dm-thread-visible",
          threadId: directMessageThreadId,
          tokenTail: token.slice(-6)
        }
      };
    }
    return { idx, entry, suppressed: false };
  }));
  const sendTargets = tokenSendEntries.filter(item => !item.suppressed);
  if (!sendTargets.length) {
    return _jsonOK({
      ok: true,
      delivered: 0,
      total: tokens.length,
      suppressed: activeDmSuppressed,
      reason: directMessageThreadId ? "all-tokens-active-in-dm-thread" : "no-send-targets",
      results: tokenSendEntries.map(item => item.result).filter(Boolean)
    });
  }

  let jwt;
  try {
    jwt = await getApnsJwt(env);
  } catch (e) {
    console.warn("[push] APNs JWT failed:", e && e.message ? e.message : e);
    return _jsonOK({ ok: false, error: "jwt-failed", detail: String(e && e.message || e) }, 500);
  }

  const title = String(body.title || "Shelfd").trim();
  const bodyText = String(body.body || "").trim();
  const apnsPayload = JSON.stringify({
    aps: {
      alert: bodyText ? { title, body: bodyText } : { title },
      sound: "default"
    },
    ...data
  });

  /* v10.391: per-token send with sandbox-host fallback. The first attempt
     uses the host hinted by the stored entry (defaults to production). If
     APNs answers BadDeviceToken on prod, the token is probably from a
     development build — retry once against sandbox. If the retry succeeds,
     remember `apnsHost: "sandbox"` on the entry so subsequent sends skip
     production entirely for that device. */
  async function sendOne(token, bundle, host) {
    const res = await fetch(`${host}/3/device/${token}`, {
      method: "POST",
      headers: {
        "authorization": `bearer ${jwt}`,
        "apns-topic": bundle,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json"
      },
      body: apnsPayload
    });
    const status = res.status;
    let reason = "";
    if (status !== 200) {
      try { const rj = await res.json(); reason = String(rj && rj.reason || ""); } catch (_) {}
    }
    return { status, reason };
  }

  /* Fire one send per device token. Parallelizable, but each may make TWO
     network hops if production rejects with BadDeviceToken. */
  const sentResults = await Promise.all(sendTargets.map(async ({ entry, idx }) => {
    const token = String(entry && entry.token || "").trim();
    if (!token) return { idx, ok: false, reason: "empty-token" };
    const bundle = String(entry && entry.appBundleId || APNS_BUNDLE_ID).trim() || APNS_BUNDLE_ID;
    const preferred = String(entry && entry.apnsHost || "").trim().toLowerCase();
    const firstHost = preferred === "sandbox" ? APNS_SANDBOX_HOST : APNS_HOST;
    try {
      let res = await sendOne(token, bundle, firstHost);
      let usedHost = firstHost === APNS_SANDBOX_HOST ? "sandbox" : "prod";
      /* Only fall back when prod returned BadDeviceToken — that's the
         classic "this is actually a sandbox token" signal. */
      if (res.status !== 200 && firstHost === APNS_HOST && res.reason === "BadDeviceToken") {
        const retry = await sendOne(token, bundle, APNS_SANDBOX_HOST);
        if (retry.status === 200) {
          res = retry;
          usedHost = "sandbox";
        } else {
          res = retry; // surface the sandbox response too if both failed
        }
      }
      return {
        idx,
        ok: res.status === 200,
        status: res.status,
        reason: res.reason,
        host: usedHost,
        tokenTail: token.slice(-6)
      };
    } catch (e) {
      return { idx, ok: false, reason: "fetch-failed", error: String(e && e.message || e) };
    }
  }));
  const results = new Array(tokens.length);
  tokenSendEntries.forEach(item => {
    if (item.suppressed && item.result) results[item.idx] = item.result;
  });
  sentResults.forEach(result => {
    results[result.idx] = result;
  });

  /* Permanently-dead tokens get pruned. Tokens that succeeded on sandbox
     get their `apnsHost` stamped so we go straight to sandbox next time. */
  const deadReasons = new Set(["Unregistered", "BadDeviceToken", "DeviceTokenNotForTopic"]);
  let mutated = false;
  const survivors = tokens.filter((entry, idx) => {
    const r = results[idx] && results[idx].reason;
    if (r && deadReasons.has(r)) { mutated = true; return false; }
    if (results[idx] && results[idx].ok && results[idx].host === "sandbox" && entry.apnsHost !== "sandbox") {
      entry.apnsHost = "sandbox";
      mutated = true;
    }
    return true;
  });
  if (mutated) {
    try {
      await kv.put(`tokens:${recipientUid}`, JSON.stringify(survivors));
    } catch (_) {}
  }

  const delivered = results.filter(r => r && r.ok && !r.suppressed).length;
  return _jsonOK({ ok: true, delivered, total: tokens.length, suppressed: activeDmSuppressed, results });
}

/* ============================================================================
   v10.318 — Push diagnostics
   ----------------------------------------------------------------------------
   /api/push/diagnose?uid=...  Returns full pipeline state so we can tell
                               from Safari Web Inspector which link is broken:
                                 - is PUSH_TOKENS_KV bound?
                                 - are APNs secrets set?
                                 - how many tokens are stored for this uid?
                                 - can we sign a JWT right now?
                               Token values are never returned in full — only
                               the last 6 chars, so the response is safe to
                               paste into a bug report.

   /api/push/test              POST { uid } sends a real APNs push to all
                               tokens registered for that uid, with verbose
                               per-token results (status, reason, tokenTail).
                               This is the fastest way to confirm the
                               server-side half end-to-end.
   ============================================================================ */
async function runPushDiagnoseEndpoint(request, env) {
  const url = new URL(request.url);
  const uid = String(url.searchParams.get("uid") || "").trim();

  const kvBound = !!env.PUSH_TOKENS_KV;
  const apnsKeyP8Present = !!(env.APNS_KEY_P8 && String(env.APNS_KEY_P8).trim().length > 0);
  const apnsKeyIdPresent = !!(env.APNS_KEY_ID && String(env.APNS_KEY_ID).trim().length > 0);
  const appleTeamIdPresent = !!(env.APPLE_TEAM_ID && String(env.APPLE_TEAM_ID).trim().length > 0);
  const apnsConfigured = kvBound && apnsKeyP8Present && apnsKeyIdPresent && appleTeamIdPresent;

  let jwtSignable = false;
  let jwtError = "";
  if (apnsKeyP8Present && apnsKeyIdPresent && appleTeamIdPresent) {
    try {
      const jwt = await getApnsJwt(env);
      jwtSignable = !!jwt && jwt.split(".").length === 3;
    } catch (e) {
      jwtError = String(e && e.message ? e.message : e);
    }
  }

  let tokenSummaries = [];
  let kvReadError = "";
  if (kvBound && uid) {
    try {
      const raw = await env.PUSH_TOKENS_KV.get(`tokens:${uid}`);
      const list = raw ? JSON.parse(raw) : [];
      if (Array.isArray(list)) {
        tokenSummaries = list.map((entry) => ({
          tokenTail: String((entry && entry.token) || "").slice(-6),
          tokenLength: String((entry && entry.token) || "").length,
          platform: entry && entry.platform,
          appBundleId: entry && entry.appBundleId,
          /* v10.391: surfaces which APNs host has worked for this token
             (prod / sandbox). Empty = no successful send yet → next send
             will try prod first, fall back to sandbox on BadDeviceToken. */
          apnsHost: entry && entry.apnsHost,
          registeredAtMs: entry && entry.registeredAtMs,
          ageMinutes: entry && entry.registeredAtMs
            ? Math.round((Date.now() - Number(entry.registeredAtMs)) / 60000)
            : null
        }));
      }
    } catch (e) {
      kvReadError = String(e && e.message ? e.message : e);
    }
  }

  return _jsonOK({
    ok: true,
    version: "v10.318",
    uid: uid || "(not provided)",
    pipeline: {
      kvBound,
      apnsKeyP8Present,
      apnsKeyIdPresent,
      appleTeamIdPresent,
      apnsConfigured,
      jwtSignable,
      jwtError: jwtError || undefined,
      kvReadError: kvReadError || undefined,
      tokenCount: tokenSummaries.length,
      tokens: tokenSummaries
    },
    hints: {
      ifKvUnbound: "Set wrangler.jsonc kv_namespaces.PUSH_TOKENS_KV.id and redeploy.",
      ifSecretsMissing: "Run: npx wrangler secret put APNS_KEY_P8 / APNS_KEY_ID / APPLE_TEAM_ID",
      ifTokenCountZero: "iOS never returned a device token. Check: (1) AppDelegate.swift forwards didRegisterForRemoteNotifications to Capacitor, (2) Push Notifications capability added in Xcode, (3) aps-environment in App.entitlements, (4) iOS Settings -> Shelfd -> Notifications enabled, (5) re-archived after capability changes.",
      ifJwtNotSignable: "APNS_KEY_P8 is malformed. Re-paste the full .p8 file contents including the BEGIN/END lines."
    }
  });
}

async function runPushTestEndpoint(request, env, ctx) {
  if (request.method !== "POST") return _jsonOK({ ok: false, error: "method-not-allowed" }, 405);
  const body = await _readJsonBody(request);
  const uid = String(body.uid || "").trim();
  if (!uid) return _jsonOK({ ok: false, error: "missing-uid" }, 400);

  /* Reuse the production send path so any bug there shows up here too. */
  const proxied = new Request(new URL("/api/push/send", request.url).toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      recipientUid: uid,
      title: "Shelfd test push",
      body: "If you see this, APNs delivery works.",
      data: { test: true, sentAtMs: Date.now() }
    })
  });
  return runPushSendEndpoint(proxied, env, ctx);
}

/* ---------- APNs JWT signing (ES256 / P-256 / SHA-256) ---------- */
async function getApnsJwt(env) {
  const now = Date.now();
  if (_apnsJwtCache.jwt && now < _apnsJwtCache.expiresAtMs) {
    return _apnsJwtCache.jwt;
  }
  const teamId = String(env.APPLE_TEAM_ID || "").trim();
  const keyId = String(env.APNS_KEY_ID || "").trim();
  const p8 = String(env.APNS_KEY_P8 || "").trim();
  if (!teamId || !keyId || !p8) throw new Error("APNs secrets missing");

  const header = { alg: "ES256", kid: keyId, typ: "JWT" };
  const issuedAtSec = Math.floor(now / 1000);
  const payload = { iss: teamId, iat: issuedAtSec };

  const enc = (obj) => _b64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)));
  const headerB64 = enc(header);
  const payloadB64 = enc(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  const privateKey = await _importApnsPrivateKey(p8);
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  const sigB64 = _b64UrlEncode(new Uint8Array(sig));
  const jwt = `${signingInput}.${sigB64}`;
  /* Apple lets JWTs live up to 60 min; refresh slightly early to be safe. */
  _apnsJwtCache = { jwt, expiresAtMs: now + 50 * 60 * 1000 };
  return jwt;
}

async function _importApnsPrivateKey(pem) {
  /* Strip PEM header/footer + whitespace; remaining is base64 of the
     PKCS8-encoded private key. */
  const cleaned = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const der = _b64Decode(cleaned);
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
}

function _b64UrlEncode(bytes) {
  let s = "";
  if (bytes instanceof Uint8Array) {
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  } else {
    s = String(bytes);
  }
  const b64 = btoa(s);
  return b64.replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function _b64Decode(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
