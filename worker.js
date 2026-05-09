const TMDB_ORIGIN = "https://api.themoviedb.org/3/";
const RAWG_ORIGIN = "https://api.rawg.io/api/";
const TRAKT_ORIGIN = "https://api.trakt.tv";
const STEAM_API_ORIGIN = "https://api.steampowered.com";
const STEAM_OPENID_ORIGIN = "https://steamcommunity.com";
const OMDB_ORIGIN = "https://www.omdbapi.com/";
const TAVILY_ORIGIN = "https://api.tavily.com/";
const IGDB_ORIGIN = "https://api.igdb.com/v4/";
const TWITCH_TOKEN_ORIGIN = "https://id.twitch.tv/oauth2/token";
const SCREENLIST_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const SCREENLIST_AI_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
const SCREENLIST_API_CACHE_TTL_SECONDS = 60 * 60 * 6;
const SCREENLIST_RANK_CACHE_TTL_SECONDS = 60 * 60 * 24;
const SCREENLIST_IMDB_RATING_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;
const SCREENLIST_TAVILY_RATING_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
const TRAKT_ENV_NAMES = ["TRAKT_CLIENT_ID", "TRAKT_API_KEY", "TRAKT_KEY", "TRAKT_CLIENT_KEY"];
const STEAM_ENV_NAMES = ["STEAM_API_KEY", "STEAM_KEY", "STEAM_WEB_API_KEY"];
const OMDB_ENV_NAMES = ["OMDB_API_KEY", "OMDB_KEY", "IMDB_RATINGS_KEY", "IMDB_KEY"];
const TAVILY_ENV_NAMES = ["TAVILY_API_KEY", "TAVILY_KEY"];
const IGDB_CLIENT_ID_ENV_NAMES = ["IGDB_CLIENT_ID", "TWITCH_CLIENT_ID"];
const IGDB_CLIENT_SECRET_ENV_NAMES = ["IGDB_CLIENT_SECRET", "TWITCH_CLIENT_SECRET"];
let igdbAccessTokenCache = { token: "", expiresAt: 0 };

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

function buildIgdbCoverUrl(imageId = "") {
  const clean = String(imageId || "").trim();
  return clean ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${clean}.jpg` : "";
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
  const cacheKey = new Request(`${url.origin}/__screenlist_igdb_covers/v412-picker/${encodeURIComponent(String(title).trim().toLowerCase())}/${encodeURIComponent(String(steamAppId).trim())}`, { method: "GET" });
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

async function runIgdbCoverEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  const title = url.searchParams.get("title") || url.searchParams.get("name") || "";
  const steamAppId = url.searchParams.get("steamAppId") || url.searchParams.get("appId") || "";
  if (!String(title || "").trim()) return jsonResponse({ ok: false, error: "Missing title." }, 400);

  const cacheKey = new Request(`${url.origin}/__screenlist_igdb_cover/v412-fallback-safe-cover/${encodeURIComponent(String(title).trim().toLowerCase())}/${encodeURIComponent(String(steamAppId).trim())}`, { method: "GET" });
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
    source: "IMDb",
    provider: "OMDb",
    omdb: getOmdbPublicStatus(env)
  };
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

  return {
    ok: true,
    status: result.status,
    imdbId: normalizeImdbTitleId(data.imdbID || ""),
    imdbRating: rating,
    imdbVotes: data.imdbVotes || "",
    title: data.Title || cleanTitle,
    year: data.Year || cleanYear,
    source: "IMDb",
    provider: "OMDb",
    lookup: "title",
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
  if (options.preferAi && options.allowAi !== false && title) {
    triedTavilySearchAi = true;
    const tavilyAi = await fetchTavilySearchAiRating(env, { title, type, year });
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
        ratingSource: "tavily_search_ai",
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
      const tavilyAi = await fetchTavilySearchAiRating(env, { title, type, year });
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
          ratingSource: "tavily_search_ai",
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
    error: "Rating could not be resolved through Tavily search AI, TMDB/OMDb, or AI memory fallback.",
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
  const cacheKey = new Request(`${url.origin}/__screenlist_rating_resolve/v4/${preferAi ? "ai-first" : "api-first"}/${type}/${tmdbId || "no-tmdb"}/${imdbId || "no-imdb"}/${encodeURIComponent(title || "no-title")}/${year || "no-year"}`, { method: "GET" });
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
  const result = await fetchJsonWithTimeout(new URL("search", TAVILY_ORIGIN), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.value}`
    },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      topic: "general",
      include_answer: true,
      include_raw_content: false,
      max_results: 6
    })
  }, timeoutMs);

  const data = result.data && typeof result.data === "object" ? result.data : {};
  const evidence = Array.isArray(data.results) ? data.results.slice(0, 6).map((item, index) => ({
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
  if (!title) {
    return { ok: false, source: "tavily_search_ai", error: "Missing title for Tavily rating search.", title, type, year, confidence: "low" };
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

  if (!imdbId && !tmdbId) {
    return jsonResponse({ ok: false, error: "Missing tmdbId or imdbId." }, 400);
  }

  const cacheKey = new Request(`${url.origin}/__screenlist_imdb_rating/v1/${type}/${tmdbId || "no-tmdb"}/${imdbId || "lookup"}`, { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("x-screenlist-imdb-cache", "HIT");
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }

  if (!imdbId) {
    try {
      imdbId = await fetchTmdbExternalImdbId(env, type, tmdbId, 6500);
    } catch (error) {
      return jsonResponse({
        ok: false,
        error: errorMessage(error),
        tmdbId,
        type,
        sources: { tmdb: { configured: !!env.TMDB_KEY }, imdb: getOmdbPublicStatus(env) }
      }, 502);
    }
  }

  const rating = await fetchOmdbImdbRating(env, imdbId, 6500);
  const status = rating.ok ? 200 : (rating.status >= 400 && rating.status < 600 ? rating.status : 502);
  const response = jsonResponse({
    ...rating,
    type,
    tmdbId,
    sources: {
      tmdb: { configured: !!env.TMDB_KEY },
      imdb: getOmdbPublicStatus(env)
    }
  }, status, {
    "Cache-Control": `public, max-age=${SCREENLIST_IMDB_RATING_CACHE_TTL_SECONDS}`,
    "x-screenlist-imdb-cache": "MISS"
  });

  if (rating.ok && ctx?.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/profile-card-og.svg" && request.method === "GET") {
      return serveProfileCardOgSvg(url);
    }

    if (isProfileCardSharePath(url) && isHtmlNavigationRequest(request, url)) {
      return serveProfileCardShareHtml(request, env, url);
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

    if (url.pathname === "/api/igdb/cover") {
      return runIgdbCoverEndpoint(request, env, ctx);
    }
    if (url.pathname === "/api/igdb/covers") {
      return runIgdbCoversEndpoint(request, env, ctx);
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
