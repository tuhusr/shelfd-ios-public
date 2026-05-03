const TMDB_ORIGIN = "https://api.themoviedb.org/3/";
const RAWG_ORIGIN = "https://api.rawg.io/api/";
const TRAKT_ORIGIN = "https://api.trakt.tv";
const OMDB_ORIGIN = "https://www.omdbapi.com/";
const SCREENLIST_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const SCREENLIST_AI_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
const SCREENLIST_API_CACHE_TTL_SECONDS = 60 * 60 * 6;
const SCREENLIST_RANK_CACHE_TTL_SECONDS = 60 * 60 * 24;
const SCREENLIST_IMDB_RATING_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;
const TRAKT_ENV_NAMES = ["TRAKT_CLIENT_ID", "TRAKT_API_KEY", "TRAKT_KEY", "TRAKT_CLIENT_KEY"];
const OMDB_ENV_NAMES = ["OMDB_API_KEY", "OMDB_KEY", "IMDB_RATINGS_KEY", "IMDB_KEY"];

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

function buildVisitorCookie(visitorId) {
  return `${VISITOR_COOKIE}=${visitorId}; Max-Age=${VISITOR_COOKIE_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

async function registerVisitor(request, env) {
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

function normalizeMediaRankSection(value = "") {
  const section = String(value || "trending_shows").trim().toLowerCase();
  const allowed = new Set([
    "trending_movies", "trending_shows", "new_releases_week", "new_releases_month", "years_best",
    "releasing_soon", "hidden_gems", "highly_rated_classics"
  ]);
  return allowed.has(section) ? section : "trending_shows";
}

async function runMediaRankEndpoint(request, env, ctx) {
  const url = new URL(request.url);
  const section = normalizeMediaRankSection(url.searchParams.get("section"));
  const cacheKey = new Request(`${url.origin}/__screenlist_rank_media/v135/${section}`, { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("x-screenlist-rank-cache", "HIT");
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
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
    rankings = await hydrateTraktCandidates(env, "movie", candidates, { limit: 10 });
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
    rankings = await hydrateTraktCandidates(env, "tv", candidates, { limit: 10 });
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
      .slice(0, 10);
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
        .slice(0, 10);
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
      rankings = await rankTmdbCandidatePool(env, section, movieParams, tvParams, { moviePages: 2, tvPages: 2 });
      rankBasis = "Existing ScreenList section rules, boosted by Trakt weekly watched/trending activity when matched.";
    }
  }

  if (!rankings.length) {
    return jsonResponse({ ok: false, error: "No ranked titles found.", section, rankings: [] }, 500);
  }

  const body = { ok: true, section, rankBasis, rankings: rankings.slice(0, 10), sources: { trakt: getTraktPublicStatus(env), tmdb: { configured: !!env.TMDB_KEY } } };
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
