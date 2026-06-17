/* =============================================================================
   21-discover-ranking.js  (v673)
   Central Discover ranking module.

   Goals (per spec):
   - TMDB remains the candidate source. OMDb/IMDb data is a
     quality/confidence signal — never the only signal.
   - Each category gets its own normalized formula. Raw popularity, raw
     rating, and raw vote count are NEVER mixed without normalization.
   - Helper boundaries are designed so OMDb can later be replaced by a local
     IMDb dataset without touching the ranking math:
        rankDiscoverTitles(category, candidates, options)
        getCategoryScore(category, item, ctx)
   - Fail-soft: if IMDb data is missing on some/all candidates, scoring still
     produces a ranking using TMDB-only signals.

   Public API:
        window.rankDiscoverTitles(category, candidates, { mediaType, year })
        window.scoreDiscoverCandidate(category, item, ctx)
   ========================================================================== */
(function() {
  'use strict';

  /* ---------- math + utility helpers --------------------------------------- */

  function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp01(value) {
    const n = safeNumber(value);
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
  }

  function normalize(value, min, max) {
    if (max === min) return 0;
    return clamp01((safeNumber(value) - min) / (max - min));
  }

  function parseVoteCount(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
    const clean = String(value || '').replace(/[^0-9]/g, '');
    if (!clean) return 0;
    const n = Number(clean);
    return Number.isFinite(n) ? n : 0;
  }

  function logVotes(votes) {
    const n = parseVoteCount(votes);
    return n > 0 ? Math.log10(n + 1) : 0;
  }

  /* Bayesian: pulls low-vote ratings toward the candidate-pool mean. */
  function bayesianRating(R, v, m, C) {
    const rating = safeNumber(R);
    const votes = Math.max(0, safeNumber(v));
    const minVotes = Math.max(1, safeNumber(m, 1));
    const mean = safeNumber(C, 6.5);
    return (votes / (votes + minVotes)) * rating + (minVotes / (votes + minVotes)) * mean;
  }

  /* Build a [0,1] normalizer over a pool's max value of `getter`. */
  function poolNormalize(items, getter) {
    let max = 0;
    items.forEach(it => { const v = safeNumber(getter(it)); if (v > max) max = v; });
    if (max <= 0) return () => 0;
    return it => clamp01(safeNumber(getter(it)) / max);
  }

  /* Pool average of `getter`, ignoring zeros/missing. */
  function poolAverage(items, getter, fallback = 6.5) {
    const values = [];
    items.forEach(it => { const v = safeNumber(getter(it)); if (v > 0) values.push(v); });
    if (!values.length) return fallback;
    return values.reduce((s, v) => s + v, 0) / values.length;
  }

  /* ---------- per-item field accessors ------------------------------------ */

  function getImdbRating(item) {
    return safeNumber(item && item.imdbRating);
  }
  function getImdbVotes(item) {
    return parseVoteCount(item && item.imdbVotes);
  }
  function getImdbLogVotes(item) {
    if (item && Number.isFinite(Number(item.imdbLogVotes))) return Number(item.imdbLogVotes);
    return logVotes(getImdbVotes(item));
  }
  function getTmdbPopularity(item) {
    return safeNumber(item && item.popularity);
  }
  function getTmdbRating(item) {
    /* If enrichment overwrote vote_average, the TMDB original lives in
       tmdbVoteAverage; otherwise vote_average is still TMDB. */
    if (item && Number.isFinite(Number(item.tmdbVoteAverage))) return Number(item.tmdbVoteAverage);
    return safeNumber(item && item.vote_average);
  }
  function getTmdbVotes(item) {
    if (item && Number.isFinite(Number(item.tmdbVoteCount))) return Number(item.tmdbVoteCount);
    return safeNumber(item && item.vote_count);
  }
  function getReleaseDateMs(item) {
    if (!item) return 0;
    const raw = item.release_date || item.first_air_date || '';
    const t = Date.parse(`${String(raw).slice(0, 10)}T00:00:00Z`);
    return Number.isFinite(t) ? t : 0;
  }
  function getDaysAgo(item) {
    const t = getReleaseDateMs(item);
    if (!t) return Number.POSITIVE_INFINITY;
    return Math.max(0, (Date.now() - t) / 86400000);
  }
  function getDaysUntil(item) {
    const t = getReleaseDateMs(item);
    if (!t) return Number.POSITIVE_INFINITY;
    return Math.max(0, (t - Date.now()) / 86400000);
  }
  function getDateMs(value) {
    if (!value) return 0;
    const raw = typeof value === 'object'
      ? (value.air_date || value.release_date || value.first_air_date || '')
      : value;
    const t = Date.parse(`${String(raw || '').slice(0, 10)}T00:00:00Z`);
    return Number.isFinite(t) ? t : 0;
  }
  function getDaysAgoFromDate(value) {
    const t = getDateMs(value);
    if (!t) return Number.POSITIVE_INFINITY;
    return Math.max(0, (Date.now() - t) / 86400000);
  }
  function getDaysUntilFromDate(value) {
    const t = getDateMs(value);
    if (!t) return Number.POSITIVE_INFINITY;
    return (t - Date.now()) / 86400000;
  }

  /* ---------- recency / soonness signals ---------------------------------- */

  function pastRecency(item, windowDays = 35) {
    const d = getDaysAgo(item);
    if (!Number.isFinite(d)) return 0;
    return clamp01(1 - (Math.min(d, windowDays) / Math.max(1, windowDays)));
  }
  function futureSoonness(item, windowDays = 90) {
    const d = getDaysUntil(item);
    if (!Number.isFinite(d)) return 0;
    return clamp01(1 - (Math.min(d, windowDays) / Math.max(1, windowDays)));
  }
  function freshnessWithin(item, horizonDays) {
    const d = getDaysAgo(item);
    if (!Number.isFinite(d)) return 0;
    return clamp01(1 - (Math.min(d, horizonDays) / Math.max(1, horizonDays)));
  }

  /* ---------- best-effort 0..10 rating with TMDB fallback ----------------- */

  function getEffectiveRating(item) {
    const imdb = getImdbRating(item);
    if (imdb > 0) return imdb;
    return getTmdbRating(item);
  }
  function getEffectiveVotes(item) {
    const imdb = getImdbVotes(item);
    if (imdb > 0) return imdb;
    return getTmdbVotes(item);
  }
  function getEffectiveLogVotes(item) {
    const imdb = getImdbLogVotes(item);
    if (imdb > 0) return imdb;
    const v = getTmdbVotes(item);
    return v > 0 ? Math.log10(v + 1) : 0;
  }

  /* ---------- Bayesian thresholds per media type -------------------------- */

  function bayesianMinVotes(category, mediaType) {
    const t = mediaType === 'movie' ? 'movie' : (mediaType === 'anime' ? 'anime' : 'tv');
    const map = {
      movie: { yearsBest: 10000, topRated: 25000, hiddenGems: 5000, country: 8000, popular: 8000 },
      tv:    { yearsBest: 5000,  topRated: 15000, hiddenGems: 3000, country: 4000, popular: 4000 },
      anime: { yearsBest: 1500,  topRated: 4000,  hiddenGems: 800,  country: 1200, popular: 1500 }
    };
    return safeNumber(map[t]?.[category], 5000);
  }

  /* ---------- pool context ------------------------------------------------ */

  function buildPoolContext(items, mediaType) {
    const popN = poolNormalize(items, getTmdbPopularity);
    const logVotesN = poolNormalize(items, getEffectiveLogVotes);
    const meanRating = poolAverage(items, getEffectiveRating, 6.5);
    return {
      popN,
      logVotesN,
      meanRating,
      mediaType: mediaType || 'tv',
      total: items.length
    };
  }

  /* ---------- category scorers (each returns a number; higher is better) -- */

  function scoreNewReleases(item, ctx) {
    /* Recency dominates. Older high-rated titles must NOT sneak in. */
    const recency = pastRecency(item, ctx.mediaType === 'movie' ? 28 : 35);
    return (
      recency * 0.55 +
      ctx.popN(item) * 0.30 +
      ctx.logVotesN(item) * 0.10 +
      clamp01(getEffectiveRating(item) / 10) * 0.05
    );
  }

  function scoreInTheaters(item, ctx) {
    const recency = pastRecency(item, 35);
    return (
      recency * 0.50 +
      ctx.popN(item) * 0.35 +
      ctx.logVotesN(item) * 0.10 +
      clamp01(getEffectiveRating(item) / 10) * 0.05
    );
  }

  /* v743: engagement-sum scoring — IMDb-only.
     popularity = imdbVotes
     TMDB has a much smaller user base than IMDb so its vote_count was
     adding noise without meaningfully improving ranking. TMDB is now used
     ONLY to fetch metadata (poster, title, genre, dates, overview); the
     popularity sort is driven entirely by OMDb's imdbVotes.

     Log-normalized to 0–1 so the framework's sort + ×100 calculatedScore
     stays well-formed. log10(10M) ≈ 7. Items with no IMDb data (cache
     miss / not on OMDb) score 0 and rank last — intended. */
  function getEngagementSum(item) {
    return safeNumber(item && item.imdbVotes);
  }
  function engagementScore(item) {
    const total = getEngagementSum(item);
    if (total <= 0) return 0;
    return Math.min(1, Math.log10(total + 1) / 7);
  }

  function getTrendingRankIndex(item, ctx) {
    if (Number.isFinite(Number(item && item.__tmdbTrendIndex))) return Math.max(0, Number(item.__tmdbTrendIndex));
    if (typeof ctx.indexOf === 'function') {
      const idx = Number(ctx.indexOf(item));
      if (Number.isFinite(idx) && idx >= 0) return idx;
    }
    return 0;
  }

  function getTrendingRankScore(item, ctx) {
    const total = Math.max(1, safeNumber(item && item.__tmdbTrendTotal, ctx.total || 1));
    if (total <= 1) return 1;
    const raw = clamp01(1 - (getTrendingRankIndex(item, ctx) / Math.max(1, total - 1)));
    return Math.pow(raw, 0.75);
  }

  function getMovieTrendingFreshnessScore(item) {
    const release = item && item.release_date;
    const daysUntil = getDaysUntilFromDate(release);
    if (Number.isFinite(daysUntil) && daysUntil > 0) {
      if (daysUntil <= 45) return 0.65;
      if (daysUntil <= 120) return 0.30;
      return 0.10;
    }
    const daysAgo = getDaysAgoFromDate(release);
    if (!Number.isFinite(daysAgo)) return 0.20;
    if (daysAgo <= 30) return 1.00;
    if (daysAgo <= 90) return 0.75;
    if (daysAgo <= 180) return 0.45;
    if (daysAgo <= 365) return 0.25;
    return 0.10;
  }

  function getTvTrendingFreshnessScore(item) {
    const nextEpisodeDays = getDaysUntilFromDate(item && item.next_episode_to_air);
    if (Number.isFinite(nextEpisodeDays) && nextEpisodeDays >= 0) {
      if (nextEpisodeDays <= 14) return 1.00;
      if (nextEpisodeDays <= 30) return 0.75;
    }

    const lastEpisodeDays = getDaysAgoFromDate((item && item.last_episode_to_air) || (item && item.last_air_date));
    if (Number.isFinite(lastEpisodeDays)) {
      if (lastEpisodeDays <= 14) return 1.00;
      if (lastEpisodeDays <= 30) return 0.85;
      if (lastEpisodeDays <= 60) return 0.55;
      if (lastEpisodeDays <= 90) return 0.35;
      return 0.10;
    }

    const firstAirDays = getDaysAgoFromDate(item && item.first_air_date);
    if (Number.isFinite(firstAirDays) && firstAirDays <= 30) return 0.90;
    return 0.25;
  }

  function getTrendingCurrentMomentumSupportScore(item) {
    /* TMDB popularity remains only a small provider-side momentum support.
       It is not used as audience confidence when IMDb/OMDb votes exist. */
    return clamp01(Math.log10(Math.max(0, getTmdbPopularity(item)) + 1) / 3);
  }

  function getTrendingVoteConfidenceScore(item) {
    const imdbVotes = getImdbVotes(item);
    if (imdbVotes > 0) return clamp01(Math.log10(imdbVotes + 1) / 6);
    return clamp01(Math.log10(getTmdbVotes(item) + 1) / 5);
  }

  function getTrendingRatingQualityScore(item) {
    return clamp01((getEffectiveRating(item) - 5) / 5);
  }

  function getTrendingStaleMultiplier(item, ctx) {
    if (ctx.mediaType === 'movie') {
      const daysUntil = getDaysUntilFromDate(item && item.release_date);
      if (Number.isFinite(daysUntil) && daysUntil > 120) return 0.45;
      const daysAgo = getDaysAgoFromDate(item && item.release_date);
      const outsideTopFive = getTrendingRankIndex(item, ctx) >= 5;
      if (Number.isFinite(daysAgo) && daysAgo > 365 && outsideTopFive) return 0.55;
      if (!Number.isFinite(daysAgo) && !Number.isFinite(daysUntil) && !String(item && item.overview || '').trim()) return 0.70;
      return 1;
    }

    const nextEpisodeDays = getDaysUntilFromDate(item && item.next_episode_to_air);
    const hasSoonNextEpisode = Number.isFinite(nextEpisodeDays) && nextEpisodeDays <= 30;
    const lastEpisodeDays = getDaysAgoFromDate((item && item.last_episode_to_air) || (item && item.last_air_date));
    if (!hasSoonNextEpisode && Number.isFinite(lastEpisodeDays)) {
      if (lastEpisodeDays > 365) return 0.25;
      if (lastEpisodeDays > 180) return 0.35;
      if (lastEpisodeDays > 90) return 0.55;
    }
    return 1;
  }

  function scoreTrending(item, ctx) {
    if (ctx.mediaType !== 'movie' && ctx.mediaType !== 'tv') return engagementScore(item);

    /* Trending is current momentum, not all-time popularity. TMDB weekly
       trend rank and release/airing freshness are the main drivers. IMDb
       votes now act only as confidence, with stale inactive titles
       downranked unless TMDB's weekly signal is very strong. */
    const tmdbTrendRankScore = getTrendingRankScore(item, ctx);
    const freshnessScore = ctx.mediaType === 'movie'
      ? getMovieTrendingFreshnessScore(item)
      : getTvTrendingFreshnessScore(item);
    const currentMomentumSupportScore = getTrendingCurrentMomentumSupportScore(item);
    const voteConfidenceScore = getTrendingVoteConfidenceScore(item);
    const ratingQualityScore = getTrendingRatingQualityScore(item);
    const staleMultiplier = getTrendingStaleMultiplier(item, ctx);
    const weights = ctx.mediaType === 'movie'
      ? { trend: 0.45, freshness: 0.25, momentum: 0.10, confidence: 0.12, quality: 0.08 }
      : { trend: 0.40, freshness: 0.30, momentum: 0.10, confidence: 0.12, quality: 0.08 };

    const baseScore =
      tmdbTrendRankScore * weights.trend +
      freshnessScore * weights.freshness +
      currentMomentumSupportScore * weights.momentum +
      voteConfidenceScore * weights.confidence +
      ratingQualityScore * weights.quality;

    item._trendingScoreDebug = {
      tmdbTrendRankScore,
      freshnessScore,
      currentMomentumSupportScore,
      voteConfidenceScore,
      ratingQualityScore,
      staleMultiplier
    };
    return baseScore * staleMultiplier;
  }

  function scoreAnticipated(item, ctx) {
    /* Future titles only — IMDb data tends to be missing/unstable. */
    const soon = futureSoonness(item, 365);
    return ctx.popN(item) * 0.70 + soon * 0.30;
  }

  function scorePopular(item, ctx) {
    /* v741: pure engagement-sum sort (same equation as Trending). Time
       window is enforced at fetch time — fetchDiscoverPopularMedia adds
       primary_release_date.gte / first_air_date.gte for the last 30 days. */
    return engagementScore(item);
  }

  function scoreReleasingSoon(item, ctx) {
    const soon = futureSoonness(item, 90);
    return soon * 0.60 + ctx.popN(item) * 0.40;
  }

  function scoreYearsBest(item, ctx) {
    const m = bayesianMinVotes('yearsBest', ctx.mediaType);
    const rating = getEffectiveRating(item);
    const votes = getEffectiveVotes(item);
    const bayes = bayesianRating(rating, votes, m, ctx.meanRating);
    const recencyBoost = freshnessWithin(item, 365);
    return (
      clamp01(bayes / 10) * 0.55 +
      ctx.logVotesN(item) * 0.25 +
      ctx.popN(item) * 0.15 +
      recencyBoost * 0.05
    );
  }

  function scoreTopRated(item, ctx) {
    const m = bayesianMinVotes('topRated', ctx.mediaType);
    const rating = getEffectiveRating(item);
    const votes = getEffectiveVotes(item);
    const bayes = bayesianRating(rating, votes, m, ctx.meanRating);
    return (
      clamp01(bayes / 10) * 0.75 +
      ctx.logVotesN(item) * 0.20 +
      ctx.popN(item) * 0.05
    );
  }

  function scoreHiddenGems(item, ctx) {
    const m = bayesianMinVotes('hiddenGems', ctx.mediaType);
    const rating = getEffectiveRating(item);
    const votes = getEffectiveVotes(item);
    const bayes = bayesianRating(rating, votes, m, ctx.meanRating);

    /* Sweet-spot: enough votes to be trusted, not so many it's mainstream. */
    const lv = getEffectiveLogVotes(item);
    const target = ctx.mediaType === 'movie' ? Math.log10(50000) : Math.log10(15000);
    const sweetSpot = clamp01(1 - Math.abs(lv - target) / Math.max(1, target));

    /* Penalize the top-popularity tail. */
    const inversePop = clamp01(1 - ctx.popN(item));

    return (
      clamp01(bayes / 10) * 0.55 +
      sweetSpot * 0.25 +
      inversePop * 0.20
    );
  }

  function scoreTopFromCountry(item, ctx) {
    const m = bayesianMinVotes('country', ctx.mediaType);
    const rating = getEffectiveRating(item);
    const votes = getEffectiveVotes(item);
    const bayes = bayesianRating(rating, votes, m, ctx.meanRating);
    const recency = freshnessWithin(item, 1825); /* 5-year horizon */
    return (
      clamp01(bayes / 10) * 0.50 +
      ctx.logVotesN(item) * 0.25 +
      ctx.popN(item) * 0.20 +
      recency * 0.05
    );
  }

  function scoreFriendsWatching(item, ctx) {
    /* Caller is expected to pre-attach friend signals (item._friendCount,
       item._friendRecencyMs, item._friendRatingAvg). When absent, falls back
       to a popularity-only score so we still produce a ranking. */
    const friendCount = safeNumber(item && item._friendCount);
    const maxFriends = Math.max(1, safeNumber(ctx.maxFriendCount, 1));
    const countN = clamp01(friendCount / maxFriends);

    const recencyMs = safeNumber(item && item._friendRecencyMs);
    const ageDays = recencyMs ? Math.max(0, (Date.now() - recencyMs) / 86400000) : Infinity;
    const recencyN = Number.isFinite(ageDays) ? clamp01(1 - Math.min(ageDays, 30) / 30) : 0;

    const friendRating = clamp01(safeNumber(item && item._friendRatingAvg) / 10);
    const confidence = ctx.logVotesN(item) * 0.5 + clamp01(getEffectiveRating(item) / 10) * 0.5;
    const userRelevance = clamp01(safeNumber(item && item._userRelevance));

    return (
      countN * 0.40 +
      recencyN * 0.25 +
      friendRating * 0.20 +
      confidence * 0.10 +
      userRelevance * 0.05
    );
  }

  /* Default fallback when an unknown category slips through. */
  function scoreDefault(item, ctx) {
    return (
      ctx.popN(item) * 0.50 +
      clamp01(getEffectiveRating(item) / 10) * 0.25 +
      ctx.logVotesN(item) * 0.20 +
      freshnessWithin(item, 1825) * 0.05
    );
  }

  const SCORERS = {
    new: scoreNewReleases,
    newReleases: scoreNewReleases,
    inTheaters: scoreInTheaters,
    trending: scoreTrending,
    anticipated: scoreAnticipated,
    popular: scorePopular,
    upcoming: scoreReleasingSoon,
    releasingSoon: scoreReleasingSoon,
    yearsBest: scoreYearsBest,
    topRated: scoreTopRated,
    hiddenGems: scoreHiddenGems,
    country: scoreTopFromCountry,
    topFromCountry: scoreTopFromCountry,
    friendsWatching: scoreFriendsWatching
  };

  function getCategoryScore(category, item, ctx) {
    const fn = SCORERS[category] || scoreDefault;
    return fn(item, ctx);
  }

  /* ---------- public entrypoint ------------------------------------------ */

  /* Rank candidates for the given category. Returns a NEW array sorted
     descending by score, with item.calculatedScore set on each entry.
     Does not slice — caller decides how many to keep. */
  function rankDiscoverTitles(category, candidates = [], options = {}) {
    const items = Array.isArray(candidates) ? candidates.slice() : [];
    if (!items.length) return items;

    const mediaType = options.mediaType || options.type || 'tv';
    const ctx = buildPoolContext(items, mediaType);

    /* Optional: caller supplies an indexOf for trending order signals. */
    if (typeof options.indexOf === 'function') ctx.indexOf = options.indexOf;
    /* Optional: caller supplies maxFriendCount for friendsWatching. */
    if (Number.isFinite(Number(options.maxFriendCount))) ctx.maxFriendCount = Number(options.maxFriendCount);

    items.forEach(item => {
      try {
        item.calculatedScore = getCategoryScore(category, item, ctx) * 100;
      } catch (e) {
        item.calculatedScore = 0;
      }
    });

    items.sort((a, b) => {
      const s = safeNumber(b.calculatedScore) - safeNumber(a.calculatedScore);
      if (s) return s;
      if (category === 'trending' && (mediaType === 'movie' || mediaType === 'tv')) {
        const trendRank = getTrendingRankIndex(a, ctx) - getTrendingRankIndex(b, ctx);
        if (trendRank) return trendRank;
      }
      const pop = getTmdbPopularity(b) - getTmdbPopularity(a);
      if (pop) return pop;
      if (category === 'trending' && (mediaType === 'movie' || mediaType === 'tv')) {
        const confidence = getTrendingVoteConfidenceScore(b) - getTrendingVoteConfidenceScore(a);
        if (confidence) return confidence;
      }
      const lv = getEffectiveLogVotes(b) - getEffectiveLogVotes(a);
      if (lv) return lv;
      return String(a.title || a.name || '').localeCompare(String(b.title || b.name || ''));
    });

    return items;
  }

  /* Expose globals — keep API minimal. */
  window.rankDiscoverTitles = rankDiscoverTitles;
  window.scoreDiscoverCandidate = getCategoryScore;
  window.getDiscoverRankingHelpers = function() {
    return { clamp01, safeNumber, parseVoteCount, normalize, logVotes, bayesianRating };
  };
})();
