/* =============================================================================
   v10.164: YouTube Hype Score module — accuracy-focused rebuild.

   PROBLEM v10.152 had:
     TMDB's videos.results is noisy. A single TMDB title can have 50+
     "trailers/teasers" cataloged, most of which are micro-promotional
     clips (e.g. Avengers: Doomsday has "CUCUMBER 🥒", quote-cards, theater
     countdowns, even cross-promo for other movies). Summing cumulative
     views across all of them artificially inflates titles with bloated
     marketing inventories over titles with one real official trailer
     (e.g. Spider-Man: Brand New Day's 34M-view Official Trailer).

   FIX in v10.164:
     1. Filter TMDB videos to ONLY type=Trailer|Teaser AND official=true
        AND name matches a real-trailer regex (drops "CUCUMBER 🥒" etc).
     2. After fetching YouTube stats for the filtered set, cap at the
        TOP 3 by view count per title. Real trailers always lead in
        views by 10–100× over micro-clips, so top-3 cleanly isolates
        the signal.
     3. If the TMDB pass yields 0 trailers OR all picks have <500k views
        (signal of broken TMDB data — wrong YouTube ID, like The Odyssey
        was tagged with War of the Worlds), fall back to YouTube Search
        for `"{title}" official trailer` restricted to videos uploaded
        by recognizable studio channels.
     4. The 6 sub-signals + summation logic for YouTube Score is
        unchanged (per the equation in
        memory/project_anticipation_hype_equation.md).

   Source of truth: project_anticipation_hype_equation.md
   ============================================================================= */
(function () {
  if (typeof window === 'undefined') return;

  const YT_VIDEOS_BATCH_SIZE = 50;
  const YT_FETCH_TIMEOUT_MS = 12000;
  const YT_TOP_N_TRAILERS_PER_TITLE = 3;
  const YT_BROKEN_TMDB_VIEW_THRESHOLD = 500000;

  /* Name patterns. These are the ONLY video names we trust from TMDB.
     Tested against the noisy Avengers: Doomsday catalog (52 entries):
       - "Official Trailer"        → ✓ pass
       - "Final Trailer"           → ✓ pass
       - "Teaser Trailer"          → ✓ pass
       - "Trailer #2"              → ✓ pass
       - "Trailer 2"               → ✓ pass
       - "Trailer"                 → ✓ pass (standalone)
       - "Teaser"                  → ✓ pass (standalone)
       - "CUCUMBER 🥒"             → ✗ drop
       - "Don't miss your shot!"   → ✗ drop
       - "Buy It Now on Digital"   → ✗ drop
       - "Thunderbolts* Stream …"  → ✗ drop
       - "See what everyone …"     → ✗ drop
     Case-insensitive, word-boundary safe. */
  const REAL_TRAILER_NAME_PATTERN = /\b(official\s+trailer|final\s+trailer|main\s+trailer|teaser\s+trailer|trailer\s*#?\s*\d+|teaser\s*#?\s*\d+)\b|^\s*trailer\s*$|^\s*teaser\s*$/i;

  /* Studio channel keyword whitelist for the YouTube search fallback.
     If a search result's channelTitle includes one of these substrings,
     we trust it as an official upload. Fan re-uploads and aggregator
     channels are filtered out. */
  const STUDIO_CHANNEL_KEYWORDS = [
    'marvel', 'disney', 'pixar', 'warner bros', 'wb pictures', 'sony pictures',
    'universal pictures', 'paramount', 'netflix', 'a24', 'lucasfilm',
    '20th century', '20thcentury', 'hbo', 'apple', 'amazon mgm', 'amazon prime',
    'mgm', 'lionsgate', 'searchlight', 'focus features', 'columbia pictures',
    'legendary', 'crunchyroll', 'toho', 'studio ghibli', 'blumhouse',
    'screen gems', 'illumination', 'dreamworks', 'aniplex',
    'official', 'pictures', 'studios', 'entertainment', 'films'
  ];

  function looksLikeOfficialStudioChannel(channelTitle = '') {
    const t = String(channelTitle || '').toLowerCase();
    if (!t) return false;
    return STUDIO_CHANNEL_KEYWORDS.some(kw => t.includes(kw));
  }

  function passesTrailerNameFilter(videoName = '') {
    return REAL_TRAILER_NAME_PATTERN.test(String(videoName || ''));
  }

  function getStrictTMDBTrailerKeysForItem(item = {}) {
    /* Strict filter — drops micro-clips by name. Returns YouTube
       video IDs only. */
    const videos = item && item.videos && Array.isArray(item.videos.results) ? item.videos.results : [];
    const out = [];
    const seen = new Set();
    for (const v of videos) {
      if (!v || v.site !== 'YouTube') continue;
      if (v.official === false) continue;
      const type = String(v.type || '').toLowerCase();
      if (type !== 'trailer' && type !== 'teaser') continue;
      if (!passesTrailerNameFilter(v.name)) continue;
      const key = String(v.key || '').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    return out;
  }

  function getLooseTMDBTrailerKeysForItem(item = {}) {
    /* Loose filter — same as v10.152: any trailer/teaser type. Used
       only as a final fallback when both strict + search fail. */
    const videos = item && item.videos && Array.isArray(item.videos.results) ? item.videos.results : [];
    const out = [];
    const seen = new Set();
    for (const v of videos) {
      if (!v || v.site !== 'YouTube') continue;
      if (v.official === false) continue;
      const type = String(v.type || '').toLowerCase();
      if (type !== 'trailer' && type !== 'teaser') continue;
      const key = String(v.key || '').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    return out;
  }

  function getItemTitleForSearch(item = {}) {
    const title = String(item.title || item.name || '').trim();
    const date = String(item.release_date || item.first_air_date || '').trim();
    const year = date && /^\d{4}/.test(date) ? date.slice(0, 4) : '';
    return year ? `${title} ${year}` : title;
  }

  function chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  async function fetchYoutubeVideoStatsBatch(videoIds = []) {
    if (!Array.isArray(videoIds) || !videoIds.length) return [];
    const batches = chunkArray(videoIds, YT_VIDEOS_BATCH_SIZE);
    const all = [];
    for (const batch of batches) {
      try {
        const url = `/api/youtube/videos?ids=${encodeURIComponent(batch.join(','))}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), YT_FETCH_TIMEOUT_MS);
        let json = null;
        try {
          const res = await fetch(url, { signal: controller.signal });
          if (res.ok) json = await res.json();
        } catch (e) {} finally {
          clearTimeout(timer);
        }
        if (json && Array.isArray(json.items)) all.push(...json.items);
      } catch (e) {}
    }
    return all;
  }

  /* v10.166: comment-likes pull removed.
     This used to call /api/youtube/comments?videoId=... once per trailer
     (~150 quota units per Most Anticipated load). After daily-quota-
     exhaustion incidents during testing we cut it — comment-likes was
     only 1 of 6 sub-signals, and the other 5 (views, likes, comments,
     like-ratio, velocity) already give a strong engagement signal.
     The function is intentionally a no-op stub so any existing caller
     just gets 0 and the rest of the pipeline doesn't break. */
  async function fetchYoutubeCommentLikesForVideo(/* videoId */) {
    return 0;
  }

  async function searchYoutubeForTitle(title = '') {
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) return [];
    try {
      const q = `${cleanTitle} official trailer`;
      const url = `/api/youtube/search?q=${encodeURIComponent(q)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), YT_FETCH_TIMEOUT_MS);
      let json = null;
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (res.ok) json = await res.json();
      } catch (e) {} finally {
        clearTimeout(timer);
      }
      if (json && Array.isArray(json.items)) return json.items;
      return [];
    } catch (e) { return []; }
  }

  function getTrailerPublishedMs(stats) {
    if (!stats) return 0;
    const ts = String(stats.publishedAt || '').trim();
    if (!ts) return 0;
    const parsed = Date.parse(ts);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function takeTopNByViews(statsArray, n) {
    return statsArray
      .slice()
      .sort((a, b) => Number(b.viewCount || 0) - Number(a.viewCount || 0))
      .slice(0, n);
  }

  function aggregateYoutubeStatsForItem(stats = [], commentLikesByVideoId = {}) {
    let totalViews = 0;
    let totalLikes = 0;
    let totalComments = 0;
    let totalCommentLikes = 0;
    let earliestPublishedMs = 0;
    let trailerCount = 0;
    for (const s of stats) {
      if (!s) continue;
      trailerCount += 1;
      totalViews += Number(s.viewCount || 0);
      totalLikes += Number(s.likeCount || 0);
      totalComments += Number(s.commentCount || 0);
      totalCommentLikes += Number(commentLikesByVideoId[s.videoId] || 0);
      const publishedMs = getTrailerPublishedMs(s);
      if (publishedMs && (!earliestPublishedMs || publishedMs < earliestPublishedMs)) {
        earliestPublishedMs = publishedMs;
      }
    }
    const daysSincePublished = earliestPublishedMs
      ? Math.max(1, (Date.now() - earliestPublishedMs) / (1000 * 60 * 60 * 24))
      : 1;
    return {
      trailerCount,
      totalViews,
      totalLikes,
      totalComments,
      totalCommentLikes,
      likesToViewsRatio: totalViews > 0 ? totalLikes / totalViews : 0,
      viewsPerDay: totalViews / daysSincePublished,
      earliestPublishedMs
    };
  }

  function safeLog10Plus1(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.log10(n + 1);
  }

  function normalizeAcrossBatch(rawValues = []) {
    if (!Array.isArray(rawValues) || !rawValues.length) return [];
    let max = 0;
    for (const v of rawValues) {
      const n = Number(v || 0);
      if (Number.isFinite(n) && n > max) max = n;
    }
    if (max <= 0) return rawValues.map(() => 0);
    return rawValues.map(v => (Number(v || 0) / max) * 100);
  }

  function computeYoutubeScoresForBatch(aggregates = []) {
    /* v10.166: 6 signals → 5 signals. Dropped comment-likes after
       quota-burn issues in production. Remaining signals still cover
       all three dimensions of hype: raw size (views/likes/comments),
       engagement quality (like-ratio), and recency (velocity). */
    const logViews = aggregates.map(a => safeLog10Plus1(a.totalViews));
    const logLikes = aggregates.map(a => safeLog10Plus1(a.totalLikes));
    const logComments = aggregates.map(a => safeLog10Plus1(a.totalComments));
    const likeRatios = aggregates.map(a => a.likesToViewsRatio);
    const velocities = aggregates.map(a => a.viewsPerDay);

    const nViews = normalizeAcrossBatch(logViews);
    const nLikes = normalizeAcrossBatch(logLikes);
    const nComments = normalizeAcrossBatch(logComments);
    const nRatios = normalizeAcrossBatch(likeRatios);
    const nVelocities = normalizeAcrossBatch(velocities);

    return aggregates.map((a, i) => {
      const breakdown = {
        viewsNorm: nViews[i] || 0,
        likesNorm: nLikes[i] || 0,
        commentsNorm: nComments[i] || 0,
        ratioNorm: nRatios[i] || 0,
        velocityNorm: nVelocities[i] || 0
      };
      const total = breakdown.viewsNorm + breakdown.likesNorm + breakdown.commentsNorm
                  + breakdown.ratioNorm + breakdown.velocityNorm;
      return {
        score: total,                  // max 500
        scoreNormalized: total / 5,    // 0–100 for blending
        breakdown
      };
    });
  }

  /* ========== Per-title trailer resolution (the new core logic) ========== */

  /* For one item, return an array of YouTube video stats objects that
     represent the title's REAL trailers (capped at top 3 by views).

     Resolution strategy:
       Pass 1 (TMDB strict):  filter TMDB videos by name regex, fetch
                              stats, sort by views, take top 3.
       Pass 2 (search):       if Pass 1 yielded 0 results OR top result
                              has < 500k views (broken TMDB data), call
                              YouTube Search for "{title} {year} official
                              trailer", filter to studio-channel uploads,
                              fetch stats, take top 3.
       Pass 3 (loose TMDB):   only if both above fail completely, fall
                              back to the v10.152 loose filter so we
                              have SOME signal. Returns top 3 by views.

     Returns: { stats: [...], source: 'tmdb-strict'|'youtube-search'|'tmdb-loose'|'none' } */
  async function resolveTrailerStatsForItem(item, statsByVideoId /* , searchPromiseByTitle (unused since v10.166) */) {
    /* v10.166: Removed Pass 2 (YouTube search fallback at 100 quota
       units per call). It was the dominant cause of quota exhaustion.
       Since v10.165 the candidate pool is sourced from studio-channel
       uploads which already attach the canonical trailer keys directly
       on item.videos.results, so the strict-TMDB pass below resolves
       cleanly without ever needing search.

       Resolution chain:
         Pass 1: strict TMDB (name-filtered + top-3 by views)
         Pass 2: loose TMDB (any trailer/teaser) — only if Pass 1 empty
    */
    const strictKeys = getStrictTMDBTrailerKeysForItem(item);
    let pass1Stats = strictKeys.map(k => statsByVideoId[k]).filter(Boolean);
    if (pass1Stats.length) {
      return { stats: takeTopNByViews(pass1Stats, YT_TOP_N_TRAILERS_PER_TITLE), source: 'tmdb-strict' };
    }

    const looseKeys = getLooseTMDBTrailerKeysForItem(item);
    const pass2Stats = looseKeys.map(k => statsByVideoId[k]).filter(Boolean);
    if (pass2Stats.length) {
      return { stats: takeTopNByViews(pass2Stats, YT_TOP_N_TRAILERS_PER_TITLE), source: 'tmdb-loose' };
    }

    return { stats: [], source: 'none' };
  }

  /* ========== Public API ========== */

  async function fetchYoutubeHypeForItems(items = [] /* , options removed in v10.166 */) {
    if (!Array.isArray(items) || !items.length) return [];

    /* v10.166: Simplified flow — single batched videos.list call, no
       search fallback, no comments fetch.
       Step 1: collect all candidate YouTube video IDs from each item's
               videos.results (both strict and loose filter, dedup'd).
       Step 2: one batched videos.list call to get stats.
       Step 3: per-item, pick top 3 by views (strict → loose order).
       Step 4: aggregate + score (5 signals, comment-likes is 0). */

    const allKeys = [];
    const seenKeys = new Set();
    for (const item of items) {
      const strictKeys = getStrictTMDBTrailerKeysForItem(item);
      const looseKeys = getLooseTMDBTrailerKeysForItem(item);
      for (const k of strictKeys) {
        if (!seenKeys.has(k)) { seenKeys.add(k); allKeys.push(k); }
      }
      for (const k of looseKeys) {
        if (!seenKeys.has(k)) { seenKeys.add(k); allKeys.push(k); }
      }
    }

    const allStats = await fetchYoutubeVideoStatsBatch(allKeys);
    const statsByVideoId = {};
    for (const s of allStats) {
      if (s && s.videoId) statsByVideoId[s.videoId] = s;
    }

    const resolvedPerItem = [];
    for (const item of items) {
      const resolved = await resolveTrailerStatsForItem(item, statsByVideoId);
      resolvedPerItem.push(resolved);
    }

    /* No comment-likes pull — passing empty object means each title
       gets totalCommentLikes=0 and the 5-signal score ignores it. */
    const aggregates = resolvedPerItem.map(r => aggregateYoutubeStatsForItem(r.stats, {}));
    const scored = computeYoutubeScoresForBatch(aggregates);

    return items.map((_, i) => ({
      youtubeStats: aggregates[i],
      youtubeScore: scored[i].score,
      youtubeScoreNormalized: scored[i].scoreNormalized,
      youtubeScoreBreakdown: scored[i].breakdown,
      youtubeSource: resolvedPerItem[i].source
    }));
  }

  /* ========== v10.165: Studio-channel candidate discovery ==========

     Instead of asking TMDB "what's popular?" (which is heavily biased
     against trailer-released titles and weak overall — TMDB has a tiny
     user base), we go to YouTube and ask "what have major studios
     uploaded recently that contains the word trailer?". The candidate
     pool is then the union of those uploads.

     Steps:
       1. For each whitelisted studio channel, pull the last 50 uploads
          (1 quota unit each).
       2. Filter to videos whose title contains "trailer" or "teaser".
       3. Extract the movie/show title from the YouTube video title.
       4. Match to TMDB to get release date, poster, studio metadata.
       5. Filter to titles NOT yet released (release date > today).
       6. Return as the candidate pool for fetchAndRankAnticipated.

     Studio channel IDs below are verified production channels — adding
     a new studio means appending its channelId here. */
  const STUDIO_CHANNEL_IDS = [
    'UCvC4D8onUfXzvjTOM-dBfEA',  // Marvel Entertainment
    'UCuaFvcY4MhZY3U43mMt1dYQ',  // Walt Disney Studios
    'UCz97F7dMxBNOfGYu3rx8aCw',  // Sony Pictures Entertainment
    'UCjmJDM5pRKbUlVIzDYYWb6g',  // Warner Bros. Pictures
    'UCq0OueAsdxH6b8nyAspwViw',  // Universal Pictures
    'UCF9imwPMSGz4Vq1NiTWCC7g',  // Paramount Pictures
    'UC2-BeLxzUBSs0uSrmzWhJuQ',  // 20th Century Studios
    'UCqzPxvUEXkkPNvqamPj1WoQ',  // Lucasfilm
    'UCWMpkGv8Mn80SLrqwx9irPg',  // A24
    'UCJ6nMHaJPZvsJ-HmUmj1SeA',  // Lionsgate Movies
    'UCQTpc7T1ROvvWxgQrZBHy9w',  // Searchlight Pictures
    'UCpzAU99GghOI2_xCBdSFFwQ',  // Focus Features
    'UC4ywBfPnGEsiH4tnTwLZHmw',  // MGM Studios
    'UCdh4kZ-OxLAKMl4uvOg9hyA',  // Blumhouse
    'UCsCk62yLn7v97p7CYNkadKw',  // Legendary
    'UCWOA1ZGywLbqmigxE4Qlvuw',  // Netflix
    'UCVTQuK2CaWaTgSsoNkn5AiQ',  // HBO Max
    'UC1Myj674wRVXB9I4c6Hm5zA',  // Apple TV+
    'UCQJWtTnAHhEG5w4uN0udnUQ',  // Amazon Prime Video
    'UC58SPyofXXqxg0u2nT91WeQ',  // Disney+
    'UCNN9XQv0nVfumIuLuB4Yj-A',  // Max
    'UCqqHJ1XLcgaT2nPMC6kJ-FA',  // Peacock
    'UCMmaBzfCCwZ2KqaBJjkj0fw',  // Hulu
    'UC6pGDc4bFGD1_36IKv3FnYg',  // Crunchyroll
    'UCwVgVTLNxd-S6h0LXqfhJsg',  // Aniplex of America
    'UCgF6X5wWXl1Lcb4FQRPHB6w',  // TOHO animation
  ];

  /* Title extraction from YouTube video titles. Real trailer videos
     consistently use a separator (em-dash, pipe, hyphen-with-spaces)
     between the title and the "Official Trailer" tag. Examples:
        "SPIDER-MAN: BRAND NEW DAY – Official Trailer (HD)"
        "MARVEL'S THUNDERBOLTS* | Final Trailer"
        "Dune: Part Three - Teaser"
     We split on the first long separator and keep the left side. */
  function extractTitleFromTrailerVideoTitle(rawTitle = '') {
    let t = String(rawTitle || '').trim();
    if (!t) return '';
    /* Split on " – ", " — ", " | ", or " - " (with surrounding spaces
       so we don't break hyphenated titles like Spider-Man). */
    const sepMatch = t.match(/^(.+?)\s+[-–—|]\s+/);
    if (sepMatch) t = sepMatch[1];
    /* Strip trailing parens (HD), (2026), (Official), (Trailer), etc. */
    t = t.replace(/\s*\([^)]*\)\s*$/g, '');
    /* Strip standalone trailing single-word labels. */
    t = t.replace(/\s+(Trailer|Teaser|Official|HD|4K|20\d{2})\s*$/i, '');
    return t.trim();
  }

  /* Is this video title a trailer/teaser? Filters out behind-the-
     scenes, interviews, ads, premiere coverage, etc. */
  function isTrailerVideoTitle(rawTitle = '') {
    const t = String(rawTitle || '').toLowerCase();
    if (!t) return false;
    if (!/\btrailer\b|\bteaser\b|\bfirst\s+look\b/.test(t)) return false;
    /* Exclusions — these contain "trailer" but aren't a trailer. */
    if (/reaction|breakdown|behind\s+the\s+scenes|interview|making\s+of|premiere\s+coverage|review|recap/.test(t)) return false;
    return true;
  }

  async function fetchYoutubeChannelUploads(channelId, maxResults = 50) {
    if (!channelId) return [];
    try {
      const url = `/api/youtube/channel-uploads?channelId=${encodeURIComponent(channelId)}&maxResults=${maxResults}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), YT_FETCH_TIMEOUT_MS);
      let json = null;
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (res.ok) json = await res.json();
      } catch (e) {} finally {
        clearTimeout(timer);
      }
      if (json && Array.isArray(json.items)) return json.items;
      return [];
    } catch (e) { return []; }
  }

  function normalizeTitleForMatching(title = '') {
    return String(title || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* v10.166: Smarter title→TMDB resolver. Fixes the "Nolan's Odyssey
     matched as a TV show" bug from v10.165 by:
       1. EXACT normalized title match always wins (similarity=3).
          Partial-contains is only similarity=1.
       2. Among equal-similarity candidates, prefer the one closest to
          today's date in the FUTURE (release_date or first_air_date
          > today, smallest diff). Released-in-past titles drop to 0.
       3. Only after both above tie does popularity break the tie. */
  async function resolveTmdbForExtractedTitle(extractedTitle) {
    const clean = String(extractedTitle || '').trim();
    if (!clean) return null;
    const normalizedTarget = normalizeTitleForMatching(clean);
    const tryEndpoints = ['search/movie', 'search/tv'];
    const candidates = [];
    for (const path of tryEndpoints) {
      try {
        const url = `/api/tmdb/${path}?query=${encodeURIComponent(clean)}&include_adult=false`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const json = await res.json();
        const results = Array.isArray(json.results) ? json.results : [];
        for (const r of results) {
          if (!r) continue;
          const matchTitleRaw = String(r.title || r.name || '');
          const matchTitle = normalizeTitleForMatching(matchTitleRaw);
          const matchOriginalRaw = String(r.original_title || r.original_name || '');
          const matchOriginal = normalizeTitleForMatching(matchOriginalRaw);
          let sim = 0;
          if (matchTitle === normalizedTarget || matchOriginal === normalizedTarget) {
            sim = 3;
          } else if (
            matchTitle.startsWith(normalizedTarget) || normalizedTarget.startsWith(matchTitle) ||
            matchOriginal.startsWith(normalizedTarget) || normalizedTarget.startsWith(matchOriginal)
          ) {
            sim = 2;
          } else if (matchTitle.includes(normalizedTarget) || matchOriginal.includes(normalizedTarget)) {
            sim = 1;
          }
          if (!sim) continue;
          const releaseStr = r.release_date || r.first_air_date || '';
          const releaseMs = releaseStr ? Date.parse(`${String(releaseStr).slice(0, 10)}T00:00:00`) : 0;
          const daysFromNow = releaseMs ? (releaseMs - Date.now()) / (1000 * 60 * 60 * 24) : -99999;
          candidates.push({
            ...r,
            _mediaType: path === 'search/movie' ? 'movie' : 'tv',
            _titleSimilarity: sim,
            _daysFromNow: daysFromNow,
            _isUpcoming: daysFromNow > 0
          });
        }
      } catch (e) {}
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      /* 1) Exact match always beats partial. */
      if (b._titleSimilarity !== a._titleSimilarity) return b._titleSimilarity - a._titleSimilarity;
      /* 2) Upcoming releases beat already-released. */
      if (a._isUpcoming !== b._isUpcoming) return a._isUpcoming ? -1 : 1;
      /* 3) Among upcoming: closer release date wins. */
      if (a._isUpcoming && b._isUpcoming) {
        if (a._daysFromNow !== b._daysFromNow) return a._daysFromNow - b._daysFromNow;
      }
      /* 4) Popularity is the final tiebreaker. */
      return Number(b.popularity || 0) - Number(a.popularity || 0);
    });
    return candidates[0];
  }

  /* Main entry — discover candidates by scanning all whitelisted
     studio channels for recent trailer uploads, extract titles, match
     to TMDB, return only titles NOT yet released. */
  async function fetchAnticipatedCandidatesFromStudios(options = {}) {
    const perChannelLimit = Number(options.perChannelLimit || 50);
    const maxReleaseDateMs = options.maxReleaseDateMs || (Date.now() + 4 * 365 * 24 * 60 * 60 * 1000);

    /* Pull recent uploads from all studio channels in parallel. */
    const uploadsPerChannel = await Promise.all(
      STUDIO_CHANNEL_IDS.map(channelId => fetchYoutubeChannelUploads(channelId, perChannelLimit))
    );
    const allUploads = uploadsPerChannel.flat();

    /* Filter to actual trailer/teaser videos. */
    const trailerUploads = allUploads.filter(v => v && isTrailerVideoTitle(v.title));

    /* Extract a clean title per upload. Group videos by title so we
       can attribute multiple trailers to the same movie. */
    const groupsByTitle = new Map();
    for (const up of trailerUploads) {
      const cleanTitle = extractTitleFromTrailerVideoTitle(up.title);
      if (!cleanTitle) continue;
      const key = normalizeTitleForMatching(cleanTitle);
      if (!groupsByTitle.has(key)) {
        groupsByTitle.set(key, { extractedTitle: cleanTitle, videos: [] });
      }
      groupsByTitle.get(key).videos.push(up);
    }

    /* Resolve each unique title against TMDB. Limit parallel TMDB
       searches so we don't hammer the proxy. */
    const groupArray = Array.from(groupsByTitle.values());
    const resolved = [];
    const CONCURRENCY = 8;
    for (let i = 0; i < groupArray.length; i += CONCURRENCY) {
      const chunk = groupArray.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(chunk.map(async (group) => {
        const tmdbMatch = await resolveTmdbForExtractedTitle(group.extractedTitle);
        if (!tmdbMatch) return null;
        const releaseStr = tmdbMatch.release_date || tmdbMatch.first_air_date || '';
        if (!releaseStr) return null;
        const releaseMs = Date.parse(`${String(releaseStr).slice(0, 10)}T00:00:00`);
        if (!Number.isFinite(releaseMs)) return null;
        /* Must be unreleased AND within max-window. */
        if (releaseMs <= Date.now()) return null;
        if (releaseMs > maxReleaseDateMs) return null;
        return {
          ...tmdbMatch,
          /* Seed the videos.results so the YouTube hype scorer can
             find these trailers without another TMDB videos lookup.
             Mimics the TMDB videos.results shape. */
          videos: {
            results: group.videos.map(v => ({
              key: v.videoId,
              site: 'YouTube',
              type: 'Trailer',
              official: true,
              name: v.title,
              published_at: v.publishedAt
            }))
          },
          __discoverySource: 'studio-channel-uploads',
          __extractedTitle: group.extractedTitle
        };
      }));
      for (const r of settled) {
        if (r.status === 'fulfilled' && r.value) resolved.push(r.value);
      }
    }

    /* Dedupe by TMDB ID (same movie might surface in multiple studio
       channels because of co-production credits). */
    const byId = new Map();
    for (const item of resolved) {
      const key = `${item._mediaType}:${item.id}`;
      if (!byId.has(key)) byId.set(key, item);
      else {
        /* Merge video lists if we have multiple groups pointing at
           the same TMDB record (rare but possible). */
        const existing = byId.get(key);
        const seenKeys = new Set(existing.videos.results.map(v => v.key));
        for (const v of item.videos.results) {
          if (!seenKeys.has(v.key)) {
            existing.videos.results.push(v);
            seenKeys.add(v.key);
          }
        }
      }
    }

    return Array.from(byId.values());
  }

  window.fetchYoutubeHypeForItems = fetchYoutubeHypeForItems;
  window.aggregateYoutubeStatsForItem = aggregateYoutubeStatsForItem;
  window.computeYoutubeScoresForBatch = computeYoutubeScoresForBatch;
  window.fetchAnticipatedCandidatesFromStudios = fetchAnticipatedCandidatesFromStudios;
  window.extractTitleFromTrailerVideoTitle = extractTitleFromTrailerVideoTitle;
})();
