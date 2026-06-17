/* ============================================================================
   42-news-feed.js  (v11.600)
   News — the third Activity-tab pill. A Twitter/Instagram-style, editorial-dark
   entertainment-news feed. Sub-categories: All · Movies & TV · Anime · Games ·
   Music (Movies and TV are merged into one chip; items keep their own tag).

   ALGORITHMIC + TRULY INFINITE: the client pulls the whole category pool once,
   orders it itself (unseen-first shuffle ⇒ different every open, 2-day "seen"
   memory so it never reads as a stale timeline), renders 36, and on reaching
   the bottom shows a spinner and loads 36 MORE — continuously, forever (it
   reshuffles + recycles the pool and folds in new cron items, and prunes old
   off-screen cards so the DOM never bloats). Pull-to-refresh reshuffles for a
   fresh order.
   ========================================================================== */
(function () {
  'use strict';

  /* Chips (filter bar). Movies + TV are one merged 'screen' chip. */
  var NEWS_CHIPS = [
    { key: 'following', label: 'Following' },   /* v11.646: personalized — followed outlets + topics */
    { key: 'all',    label: 'All' },
    { key: 'screen', label: 'Movies & TV' },
    { key: 'anime',  label: 'Anime' },
    { key: 'games',  label: 'Games' },
    { key: 'music',  label: 'Music' }
  ];
  /* Per-item card-tag labels (item.category stays movies/tv individually). */
  var CARD_LABELS = { all: 'News', screen: 'Movies & TV', movies: 'Movies', tv: 'TV', anime: 'Anime', games: 'Games', music: 'Music' };

  var PAGE_SIZE = 36;
  var POOL_LIMIT = 500;                          // v11.650: newest-N pool for browsing (deeper ⇒ more days)
  var FOLLOWING_POOL_LIMIT = 900;                // v11.650: Following pulls deeper so ~a month of a topic is in range
  var RELOAD_AFTER_MS = 90 * 1000;               // v11.702: re-entry refresh gate. WAS 30min — far too long: a pool captured during a thin YT-cache window stuck in memory for half an hour, so the feed kept showing a narrow Marvel/Netflix/RT video mix even though the LIVE pool had 17 sources (proven on-device: NETWORK 17/478 vs CLIENT POOL 4/285). 90s still ignores quick tab-flicks but re-pulls the live pool on a real re-entry.
  var MORE_SPINNER_MS = 430;                     // visible spinner beat on each +36
  var BG_REFRESH_MS = 60 * 1000;                 // min gap between background pool refreshes
  var MAX_DOM_CARDS = 480;                        // prune off-screen cards beyond this
  var PRUNE_BATCH = 108;                          // remove this many from the top when over cap
  var SEEN_KEY = 'screenlist-news-seen-v1';
  var SEEN_TTL_MS = 4 * 24 * 60 * 60 * 1000;     // v11.693: a merely-SEEN (scrolled-past) item stays suppressed 4 days (was 2) — stronger, but still resurfaces eventually (consumed = liked/opened/shared = the HARD-hide layer below)
  var SEEN_MAX = 4000;                           // v11.693: seen is now keyed by several precise identity keys per item, so the cap holds ~800–1000 distinct articles
  var BOOKMARK_KEY = 'screenlist-news-bookmarks-v1';  // hearted/bookmarked articles (no TTL)
  var BOOKMARK_MAX = 5000;
  /* v11.693: CONSUMED-CONTENT SUPPRESSION — a persistent (localStorage, account-
     scoped, all-tabs) layer that HARD-HIDES the exact article the user already
     engaged with from normal feed resurfacing, while the SAME engagement still
     trains taste (recordTaste is untouched). Keyed by EVERY stable identity key
     (articleHardKeys: canonical/normalized URL, worker id, provider article id,
     Event Registry story id, YouTube video id, source+title, title signature) so
     the same story can't sneak back via a different provider/URL form. Liked or
     shared ⇒ hidden ~30d; opened/read ⇒ hidden ~21d (inside the 14–30d ask). */
  var CONSUMED_KEY = 'screenlist-news-consumed-v1';
  var CONSUMED_LIKE_TTL_MS  = 30 * 24 * 60 * 60 * 1000;
  var CONSUMED_SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  var CONSUMED_OPEN_TTL_MS  = 21 * 24 * 60 * 60 * 1000;
  var CONSUMED_MAX = 8000;
  var PTR_THRESHOLD = 72;                         // pull distance to trigger refresh
  var PTR_REFRESH_OFFSET = 56;
  var PTR_SPINNER = 28;

  var state = {
    category: 'all',
    pool: [],          // full pool from the worker
    order: [],         // shuffled feed order (unseen-first)
    renderIndex: 0,    // cursor into `order`
    bgRefreshing: false,
    loadingPool: false,
    loadingMore: false,
    refreshing: false,
    poolLoadedAt: 0,
    warming: false,
    warmRetries: 0,
    builtOnce: false,
    observer: null,
    impressionObserver: null,
    poolCache: {},     // cat → pool[] (so category swipes slide in real content)
    orderCache: {},    // cat → order[] — PRESERVED so swiping categories doesn't re-shuffle
    viewCache: {},     // v11.757: cat → { nodes, y, renderIndex, exhausted, order, pool } — per-tab LIVE rendered DOM kept alive so returning is instant (no re-render)
    prefetched: false,
    renderedKeys: {}   // v11.659 (Pass 2): hard per-session dedup — every article key already on screen
  };
  var ptr = { startY: 0, startX: 0, pull: 0, armed: false, active: false, bound: false };

  /* ---------- helpers ---------- */
  function esc(s) {
    if (typeof escHtml === 'function') { try { return escHtml(s); } catch (e) {} }
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escA(s) {
    if (typeof escAttr === 'function') { try { return escAttr(s); } catch (e) {} }
    return esc(s);
  }
  function timeAgo(ms) {
    var n = Number(ms || 0);
    if (!n) return '';
    if (typeof relativeTime === 'function') { try { return relativeTime(n); } catch (e) {} }
    var diff = Math.max(0, Date.now() - n), m = 60000, h = 60 * m, d = 24 * h;
    if (diff < m) return 'now';
    if (diff < h) return Math.round(diff / m) + 'm';
    if (diff < d) return Math.round(diff / h) + 'h';
    if (diff < 7 * d) return Math.round(diff / d) + 'd';
    try { return new Date(n).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (e) { return ''; }
  }
  function getPane() { return document.getElementById('activity-news-feed'); }
  function q(sel) { var p = getPane(); return p ? p.querySelector(sel) : null; }
  function categoryLabel(key) { return CARD_LABELS[key] || key || ''; }
  function newsUserStorageId() {
    try {
      var uid = (typeof currentUser !== 'undefined' && currentUser && currentUser.uid)
        ? currentUser.uid
        : ((typeof userProfile !== 'undefined' && userProfile && userProfile.uid) ? userProfile.uid : '');
      return uid ? ('u:' + String(uid)) : 'anon';
    } catch (e) { return 'anon'; }
  }
  function scopedNewsKey(base) { return base + ':' + newsUserStorageId(); }
  function readNewsLocal(base, fallback) {
    try {
      var key = scopedNewsKey(base);
      var raw = localStorage.getItem(key);
      if (!raw && key !== base) raw = localStorage.getItem(base);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (e) { return fallback; }
  }
  function writeNewsLocal(base, value) {
    try { localStorage.setItem(scopedNewsKey(base), JSON.stringify(value)); } catch (e) {}
  }

  /* ---------- "seen" memory (localStorage) ---------- */
  function readSeen() {
    var o = readNewsLocal(SEEN_KEY, {});
    return (o && typeof o === 'object') ? o : {};
  }
  function writeSeen(map) {
    try {
      var now = Date.now(), entries = [];
      for (var k in map) { if (Object.prototype.hasOwnProperty.call(map, k) && (now - map[k]) < SEEN_TTL_MS) entries.push([k, map[k]]); }
      if (entries.length > SEEN_MAX) { entries.sort(function (a, b) { return b[1] - a[1]; }); entries = entries.slice(0, SEEN_MAX); }
      var out = {};
      for (var i = 0; i < entries.length; i++) out[entries[i][0]] = entries[i][1];
      writeNewsLocal(SEEN_KEY, out);
    } catch (e) {}
  }
  /* v11.693: the PRECISE-identity subset of an article's hard keys (exact URL /
     worker id / provider id / event id / YouTube id) — used for SEEN tracking.
     Deliberately excludes the fuzzier source+title / title-signature keys so a
     mere scroll-past never penalises a genuinely different article that happens
     to share a signature. (The CONSUMED hard-hide below DOES use the full key
     set, because an explicit like/share/open is a strong enough intent to justify
     hiding every near-identity form.) articleHardKeys is hoisted (defined later). */
  function preciseIdentityKeys(item) {
    var all = articleHardKeys(item), out = [];
    for (var i = 0; i < all.length; i++) { if (/^(u:|id:|pid:|ev:|yt:|story:)/.test(all[i])) out.push(all[i]); }
    return out;
  }
  function markSeenItem(item) {
    var keys = preciseIdentityKeys(item);
    if (!keys.length) return;
    var map = readSeen(), now = Date.now();
    for (var i = 0; i < keys.length; i++) map[keys[i]] = now;
    writeSeen(map);
  }
  function itemSeenAt(item, seenMap) {
    var keys = preciseIdentityKeys(item), latest = 0;
    for (var i = 0; i < keys.length; i++) { var t = seenMap[keys[i]]; if (t && t > latest) latest = t; }
    return latest;
  }

  /* ---------- v11.693: consumed-content suppression (liked / shared / opened) ----
     One store: hardKey -> { l:likeTs, s:shareTs, o:openTs } (only engaged fields
     present). An article is HARD-HIDDEN from normal feed resurfacing while ANY of
     its hard keys is consumed and inside that kind's TTL. Un-liking removes only
     the like stamp (a still-open/shared article stays suppressed). */
  function readConsumed() {
    var o = readNewsLocal(CONSUMED_KEY, {});
    return (o && typeof o === 'object') ? o : {};
  }
  function consumedAlive(rec, now) {
    if (!rec) return false;
    return (rec.l && (now - rec.l) < CONSUMED_LIKE_TTL_MS) ||
           (rec.s && (now - rec.s) < CONSUMED_SHARE_TTL_MS) ||
           (rec.o && (now - rec.o) < CONSUMED_OPEN_TTL_MS);
  }
  function writeConsumed(map) {
    try {
      var now = Date.now(), entries = [];
      for (var k in map) {
        if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
        var r = map[k];
        if (!consumedAlive(r, now)) continue;                 // prune fully-expired records
        entries.push([k, Math.max(r.l || 0, r.s || 0, r.o || 0), r]);
      }
      if (entries.length > CONSUMED_MAX) { entries.sort(function (a, b) { return b[1] - a[1]; }); entries = entries.slice(0, CONSUMED_MAX); }
      var out = {};
      for (var i = 0; i < entries.length; i++) out[entries[i][0]] = entries[i][2];
      writeNewsLocal(CONSUMED_KEY, out);
    } catch (e) {}
  }
  function consumeItemFrom(x) { return (x && typeof x === 'object') ? x : { url: String(x || '') }; }
  var CONSUMED_FIELD = { like: 'l', share: 's', open: 'o' };
  function recordConsumed(x, kind) {
    var field = CONSUMED_FIELD[kind]; if (!field) return;
    var item = consumeItemFrom(x);
    var keys = articleHardKeys(item); if (!keys.length) return;   // FULL key set — strongest possible identity net
    var map = readConsumed(), now = Date.now();
    for (var i = 0; i < keys.length; i++) { (map[keys[i]] || (map[keys[i]] = {}))[field] = now; }
    writeConsumed(map);
  }
  function unrecordConsumed(x, kind) {
    var field = CONSUMED_FIELD[kind]; if (!field) return;
    var item = consumeItemFrom(x);
    var keys = articleHardKeys(item); if (!keys.length) return;
    var map = readConsumed(), touched = false;
    for (var i = 0; i < keys.length; i++) {
      var r = map[keys[i]]; if (!r || r[field] === undefined) continue;
      delete r[field]; touched = true;
      if (r.l === undefined && r.s === undefined && r.o === undefined) delete map[keys[i]];
    }
    if (touched) writeConsumed(map);
  }
  function isConsumedInMap(item, map, now) {
    var keys = articleHardKeys(item); if (!keys.length) return false;
    for (var i = 0; i < keys.length; i++) { if (consumedAlive(map[keys[i]], now)) return true; }
    return false;
  }
  function isConsumedSuppressed(item) { return isConsumedInMap(item, readConsumed(), Date.now()); }
  function isSeenStoryInMap(item, seenMap, now) {
    var keys = articleHardKeys(item); if (!keys.length) return false;
    for (var i = 0; i < keys.length; i++) {
      if (!/^story:/.test(keys[i])) continue;
      var t = seenMap[keys[i]];
      if (t && (now - t) < SEEN_TTL_MS) return true;
    }
    return false;
  }

  /* ---------- bookmarks / hearts (localStorage, persistent — no TTL) ---------- */
  function readBookmarks() {
    var o = readNewsLocal(BOOKMARK_KEY, {});
    return (o && typeof o === 'object') ? o : {};
  }
  function isBookmarked(url) {
    if (!url) return false;
    return !!readBookmarks()[url];
  }
  /* Toggle and persist; returns the NEW on/off state. */
  function toggleBookmark(url) {
    if (!url) return false;
    var map = readBookmarks();
    var on = !map[url];
    if (on) {
      map[url] = Date.now();
      var keys = Object.keys(map);
      if (keys.length > BOOKMARK_MAX) {        // safety cap — drop the oldest
        keys.sort(function (a, b) { return map[a] - map[b]; });
        for (var i = 0; i < keys.length - BOOKMARK_MAX; i++) delete map[keys[i]];
      }
    } else {
      delete map[url];
    }
    writeNewsLocal(BOOKMARK_KEY, map);
    return on;
  }

  /* ---------- feed ordering (the "algorithm") ---------- */
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  /* ============================================================================
     SMART FEED RANKING (v11.621) — "smart random / fresh mix".
     Replaces the pure shuffle with a WEIGHTED-RANDOM order: fresher, unseen,
     shelf-relevant, hearted-taste, higher-quality articles get a higher CHANCE
     near the top — but the order stays randomized (Efraimidis–Spirakis weighted
     sampling) so it still feels fresh/varied, never rigid or chronological. A
     greedy diversity pass then spaces out sources, categories and near-duplicate
     stories. Scored ONCE per refresh/recycle (never per scroll frame). All
     signals are account-scoped (library + localStorage cache + compact Firestore
     taste mirror) so feed learning survives app restarts without storing every
     raw impression forever.
     ========================================================================== */
  var OPENS_KEY = 'screenlist-news-opens-v1';
  var OPENS_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // an opened article stays "read" for 30 days
  var TASTE_KEY = 'screenlist-news-taste-v1';
  var NEWS_TASTE_CLOUD_FIELD = 'newsTaste';
  var NEWS_TASTE_SYNC_DEBOUNCE_MS = 8000;
  var NEWS_TASTE_SYNC_MIN_MS = 30000;
  var tasteCloudSyncTimer = null;
  var tasteCloudLastSyncAt = 0;
  var tasteInitializedFor = '';

  /* Tuning knobs — change the FLAVOR of the mix without touching the logic.
     Sampling weight = exp(temp * score) (softmax / Gumbel sampling): the CHANCE
     one article outranks another is sigmoid(temp * scoreDiff), so a higher
     `temp` makes relevance (freshness, shelf, learned taste) bite harder while a
     lower `temp` flattens toward even-random. This replaced a linear
     wBase+wScale*score map (v11.623) which compressed every weight into a narrow
     band — a strong taste match shifted the order by only ~2%, so the feed never
     actually felt personalised. Softmax gives learned taste real, tunable pull. */
  var ALGO = {
    /* v11.637 "fresher / less repetitive" tuning. Freshness is now the strongest
       driver (1.15→1.45) so genuinely OLD items sink unless they're strongly
       relevant (shelf/taste still 0.9/0.85, so a real library/taste match can
       still lift an older story). Unseen up (1.0→1.15) + steeper seen/opened
       factors below push already-seen/read articles down hard, and a slightly
       lower discovery + higher dup penalty cut repetition — all WITHOUT going
       strictly newest-first (softmax temp stays 1.2, discovery stays in play). */
    wFresh: 1.45, wUnseen: 1.15, wShelf: 0.9, wTaste: 0.95, wQuality: 0.45, wDiscovery: 0.5, wIgnore: 0.42,
    pDup: 1.3, pOpened: 0.95, pSeen: 0.55, temp: 1.2,   // v11.693: pSeen = explicit penalty for a scrolled-past article (on top of the lowered unseen factor) — stronger than the old soft 0.3-factor-only suppression
    srcWindow: 6, catRun: 2, catDensity: 1.45, catDensityFloor: 0.06, dupWindow: 7, dupOverlap: 4, look: 14,
    typeWindow: 6, typeMax: 3   // ≤3 of the same KIND (trailer, patch…) per 7-card window
  };

  /* Source quality 0..1 (editorial reliability). Unknown → neutral 0.5. */
  var SOURCE_QUALITY = {
    'Anime News Network': 0.82, 'Variety': 0.82, 'The Hollywood Reporter': 0.82, 'Deadline': 0.8,
    'The Verge': 0.78, 'Pitchfork': 0.78, 'Polygon': 0.74, 'Eurogamer': 0.74, 'Collider': 0.74,
    'Rolling Stone': 0.74, 'IGN': 0.7, 'Kotaku': 0.7, '/Film': 0.7, 'SlashFilm': 0.7, 'Stereogum': 0.68,
    'Otaku USA': 0.66, 'Consequence': 0.66, 'TVLine': 0.66, 'ComicBook': 0.6, 'Screen Rant': 0.6,
    'Game Rant': 0.58, 'CBR': 0.58,
    /* v11.697: additional anime-news sites (mirrors worker) */
    'Animehunch': 0.6, 'Anime UK News': 0.6, "Honey's Anime": 0.55, 'Tokyo Otaku Mode': 0.55, 'Anime Corner': 0.58,
    /* v11.665: K-drama / Korean entertainment — strong weighting (mirrors worker) */
    'Soompi': 0.8, 'Korea JoongAng Daily': 0.82, 'Korea Joongang Daily': 0.82, 'The Korea Herald': 0.82, 'Korea Herald': 0.82, 'Koreaherald.com': 0.82, 'Koreajoongangdaily.com': 0.82,
    /* v11.674: first-party game channels — official source tier, not filler (mirrors worker) */
    'Rockstar Games': 0.68, 'Marvel Rivals': 0.68, 'Valorant': 0.68, 'Apex Legends': 0.68, 'PUBG': 0.68,
    /* v11.694: Tier 1 Movies/TV studio + trailer channels (mirrors worker) */
    'Warner Bros.': 0.7, 'Universal Pictures': 0.7, 'Sony Pictures Entertainment': 0.7,
    '20th Century Studios': 0.7, 'Paramount Movies': 0.68, 'Lionsgate Movies': 0.66, 'Movieclips': 0.6,
    /* v11.695: Tier 2 Movies/TV studios + distributors + aggregators (mirrors worker) */
    'Disney': 0.7, 'Pixar': 0.7, 'DC': 0.68, 'Searchlight Pictures': 0.7, 'A24': 0.72,
    'NEON': 0.68, 'IMDb': 0.66, 'Fandango': 0.62,
    /* v11.696: Tier 1 Anime video channels (mirrors worker) */
    'TOHO animation': 0.7, 'KADOKAWAanime': 0.68, 'Netflix Anime': 0.68, 'VIZ Media': 0.68,
    'Aniplex USA': 0.68, 'Muse Asia': 0.62, 'Ani-One Asia': 0.62, 'Crunchyroll Dubs': 0.66
  };
  function sourceQuality(src) {
    var q = SOURCE_QUALITY[String(src || '').trim()];
    return (typeof q === 'number') ? q : 0.5;
  }

  var NEWS_STOPWORDS = { the:1,a:1,an:1,and:1,or:1,of:1,to:1,in:1,on:1,for:1,with:1,is:1,are:1,be:1,as:1,at:1,by:1,from:1,this:1,that:1,'new':1,has:1,have:1,will:1,its:1,it:1,you:1,your:1,we:1,how:1,why:1,what:1,who:1,all:1,out:1,now:1,get:1,gets:1,his:1,her:1,their:1,about:1,after:1,first:1,more:1,most:1,just:1,into:1,than:1,they:1,them:1,but:1,not:1,one:1,two:1,up:1,so:1,no:1,'do':1,can:1,was:1,were:1,been:1,when:1,where:1,which:1,here:1,there:1,'over':1,off:1 };
  function tokenize(text) {
    var out = [], seen = {};
    var words = String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w.length < 3 || NEWS_STOPWORDS[w] || seen[w]) continue;
      seen[w] = 1; out.push(w);
    }
    return out;
  }
  function articleTokens(item) {
    if (item._toks) return item._toks;
    var base = (item.title || '') + ' ' + (item.summary || '');
    /* v11.634: fold provider topic/entity tags (Event Registry concepts) into the
       token set so taste + shelf matching can latch onto canonical entities
       (franchises, studios, artists) — not just scraped headline words. */
    if (Array.isArray(item.topics) && item.topics.length) base += ' ' + item.topics.join(' ');
    item._toks = tokenize(base);
    return item._toks;
  }

  /* ---------- article-TYPE understanding (v11.623) ----------
     Classify each story into a KIND (trailer / casting / release date / review /
     patch notes / game update / anime-season / music release / tour / box office
     / industry) so the feed (a) never shows ten of the same kind in a row and
     (b) can learn type-level taste. Cheap regex over title+summary, memoized per
     item; first match wins so pattern ORDER is the priority. Some kinds are
     gated to a category (`cats`) to avoid cross-genre false hits (a game "season
     2" ≠ an anime "season 2"). 'general' is the catch-all — never type-capped. */
  var TYPE_PATTERNS = [
    { type: 'trailer',      re: /\b(trailer|teaser|first look|sneak peek|featurette|opening titles)\b/i },
    { type: 'listicle',     re: /\b(top\s+\d+|\d+\s+(?:best|worst|greatest)|best\s+\d+|ranked|ranking|listicle|every .+ ranked|things you missed)\b/i },
    { type: 'boxoffice',    cats: ['movies', 'tv'], re: /\b(box office|opening weekend|highest[- ]grossing|ticket sales|grossed|debuts? with \$)\b/i },
    { type: 'streaming',    cats: ['movies', 'tv', 'anime'], re: /\b(streaming|netflix|hbo max|\bmax\b|disney\+|hulu|prime video|paramount\+|peacock|crunchyroll|apple tv\+?|coming to|leaving (?:netflix|hulu|streaming)|now streaming)\b/i },
    { type: 'patch',        cats: ['games'], re: /\b(patch notes?|hotfix|balance (?:changes|update|patch)|nerf|buff|bug ?fix|update \d|version \d|server (?:maintenance|status|down))\b/i },
    { type: 'gameupdate',   cats: ['games'], re: /\b(dlc|expansion|battle pass|new (?:mode|map|content|event|character)|crossover event|early access|roadmap|season \d|in[- ]game)\b/i },
    { type: 'gamerelease',  cats: ['games'], re: /\b(release date|launch(?:es|ed|ing)?|pre[- ]?orders?|collector'?s? edition|deluxe edition|physical edition|coming to (?:ps5|xbox|switch|pc|steam)|available now)\b/i },
    { type: 'hardware',     cats: ['games'], re: /\b(steam deck|switch 2|nintendo switch|xbox|playstation|ps5|console|controller|dualsense|joy-con|headset|accessory|hardware|gpu|graphics card|gaming pc|gaming laptop|game pass|playstation plus|nintendo switch online)\b/i },
    { type: 'animeseason',  cats: ['anime'], re: /\b(season \d|new season|final season|cour|episode \d|key visual|simulcast|anime adaptation|premieres?|opening theme|ending theme|\bpv\b)\b/i },
    { type: 'musicrelease', cats: ['music'], re: /\b(new (?:album|single|song|ep|track)|debut album|music video|tracklist|drops? (?:new|the|a|her|his|their)|releases? (?:new|the|a|her|his|their)|announces? (?:album|new|debut))\b/i },
    { type: 'tour',         cats: ['music'], re: /\b(tour dates?|world tour|on tour|live (?:dates|shows)|concert|residency|festival|headlin(?:e|er|ing)|setlist)\b/i },
    { type: 'casting',      re: /\b(cast(?:s|ing|ed)?|joins? the cast|in talks to|set to star|to star (?:in|as)|will play|reprises?|recast|lead role)\b/i },
    { type: 'review',       re: /\b(review|first reactions?|hands[- ]on|impressions|verdict|rated)\b/i },
    { type: 'release',      re: /\b(release date|premiere date|hits (?:theaters|theatres)|coming to|arrives? (?:on|in)|out now|streaming (?:on|now)|set for|launch(?:es|ed|ing)?|available (?:now|on)|drops? (?:on|this))\b/i },
    { type: 'breaking',     re: /\b(breaking|just announced|announces?|reveals?|confirms?|reportedly|exclusive)\b/i },
    { type: 'industry',     re: /\b(acquires?|acquisition|merger|rights to|renew(?:ed|s)?|cancel(?:led|s|ed)?|greenlit|greenlights?|in development|spin[- ]?off|reboot|remake|sequel|prequel|lawsuit|sues?|strike|layoffs?)\b/i }
  ];
  function classifyType(item) {
    if (item._type) return item._type;
    var hay = (item.title || '') + ' ' + (item.summary || '');
    var cat = String(item.category || '').toLowerCase();
    for (var i = 0; i < TYPE_PATTERNS.length; i++) {
      var p = TYPE_PATTERNS[i];
      if (p.cats && p.cats.indexOf(cat) === -1) continue;
      if (p.re.test(hay)) { item._type = p.type; return item._type; }
    }
    item._type = 'general';
    return item._type;
  }

  /* Freshness 0..1: strongest <48h, decays through the week, small evergreen floor. */
  /* v11.637: steeper decay — the last ~24h reads as "now", and anything past a
     few days falls off fast so stale items (incl. stale-cached Event Registry
     articles served while quota is down) can't sit near the top. Still a smooth
     curve with a small evergreen floor, so old-but-relevant stories aren't zeroed. */
  function freshnessScore(publishedAt) {
    var ts = Number(publishedAt || 0);
    if (!ts) return 0.3;                                          // unknown date → treat as middling-old
    var ageH = Math.max(0, (Date.now() - ts) / 3600000);
    if (ageH <= 12) return 1.0;                                  // last 12h = "what's happening now"
    if (ageH <= 24) return 1.0 - (ageH - 12) / 12 * 0.1;         // 12–24h: 1.0 → 0.90
    if (ageH <= 48) return 0.9 - (ageH - 24) / 24 * 0.18;        // 1–2d:   0.90 → 0.72
    if (ageH <= 96) return 0.72 - (ageH - 48) / 48 * 0.32;       // 2–4d:   0.72 → 0.40
    if (ageH <= 168) return 0.4 - (ageH - 96) / 72 * 0.18;       // 4–7d:   0.40 → 0.22
    if (ageH <= 336) return 0.22 - (ageH - 168) / 168 * 0.12;    // 1–2w:   0.22 → 0.10
    if (ageH <= 720) return 0.1 - (ageH - 336) / 384 * 0.04;     // 2–4w:   0.10 → 0.06
    return 0.05;
  }

  /* opens (read history) */
  function readOpens() {
    var o = readNewsLocal(OPENS_KEY, {});
    return (o && typeof o === 'object') ? o : {};
  }
  function recordOpen(x) {
    var item = consumeItemFrom(x);
    var url = item.url || '';
    if (!url) return;
    try {
      var m = readOpens(), now = Date.now(), out = {}, ks = Object.keys(m);
      for (var i = 0; i < ks.length; i++) if (now - m[ks[i]] < OPENS_TTL_MS) out[ks[i]] = m[ks[i]];
      out[url] = now;
      var keys = Object.keys(out);
      if (keys.length > 1200) { keys.sort(function (a, b) { return out[b] - out[a]; }); var t = {}; for (var j = 0; j < 1200; j++) t[keys[j]] = out[keys[j]]; out = t; }
      writeNewsLocal(OPENS_KEY, out);
    } catch (e) {}
    /* v11.693: every open path funnels through here (card tap, in-app reader,
       inline trailer play) → also stamp the consumed store so the exact article
       is hard-hidden for ~21d. URL-only keys here; card opens additionally pass
       full meta below for the richer provider/event/title keys. */
    try { recordConsumed(item, 'open'); } catch (e) {}
  }

  /* taste profile (account-scoped local cache + compact cloud mirror) */
  function cleanTasteMap(map) {
    var out = {};
    if (!map || typeof map !== 'object') return out;
    for (var k in map) {
      if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
      var key = String(k || '').trim();
      var value = Number(map[k] || 0);
      if (key && Number.isFinite(value) && value > 0) out[key] = value;
    }
    return out;
  }
  function emptyIgnoreTaste() { return { toks: {}, entities: {}, cats: {}, srcs: {}, types: {} }; }
  function normalizeTasteProfile(raw) {
    raw = (raw && typeof raw === 'object') ? raw : {};
    var ignores = (raw.ignores && typeof raw.ignores === 'object') ? raw.ignores : {};
    return {
      at: Number(raw.at || 0),
      toks: cleanTasteMap(raw.toks),
      entities: cleanTasteMap(raw.entities),
      cats: cleanTasteMap(raw.cats),
      srcs: cleanTasteMap(raw.srcs),
      types: cleanTasteMap(raw.types),
      ignores: {
        toks: cleanTasteMap(ignores.toks),
        entities: cleanTasteMap(ignores.entities),
        cats: cleanTasteMap(ignores.cats),
        srcs: cleanTasteMap(ignores.srcs),
        types: cleanTasteMap(ignores.types)
      }
    };
  }
  function capMap(map, limit) {
    var keys = Object.keys(map || {});
    if (keys.length <= limit) return map || {};
    keys.sort(function (a, b) { return Number(map[b] || 0) - Number(map[a] || 0); });
    var out = {};
    for (var i = 0; i < limit; i++) out[keys[i]] = map[keys[i]];
    return out;
  }
  function compactTasteProfile(t) {
    t = normalizeTasteProfile(t);
    t.toks = capMap(t.toks, 220);
    t.entities = capMap(t.entities, 160);
    t.cats = capMap(t.cats, 16);
    t.srcs = capMap(t.srcs, 90);
    t.types = capMap(t.types, 32);
    t.ignores.toks = capMap(t.ignores.toks, 160);
    t.ignores.entities = capMap(t.ignores.entities, 120);
    t.ignores.cats = capMap(t.ignores.cats, 16);
    t.ignores.srcs = capMap(t.ignores.srcs, 70);
    t.ignores.types = capMap(t.ignores.types, 28);
    return t;
  }
  function mergeTasteProfiles(a, b) {
    a = normalizeTasteProfile(a); b = normalizeTasteProfile(b);
    function mergeMap(x, y) {
      var out = {}, k;
      for (k in x) if (Object.prototype.hasOwnProperty.call(x, k)) out[k] = x[k];
      for (k in y) if (Object.prototype.hasOwnProperty.call(y, k)) out[k] = Math.max(Number(out[k] || 0), Number(y[k] || 0));
      return out;
    }
    return compactTasteProfile({
      at: Math.max(Number(a.at || 0), Number(b.at || 0)),
      toks: mergeMap(a.toks, b.toks),
      entities: mergeMap(a.entities, b.entities),
      cats: mergeMap(a.cats, b.cats),
      srcs: mergeMap(a.srcs, b.srcs),
      types: mergeMap(a.types, b.types),
      ignores: {
        toks: mergeMap(a.ignores.toks, b.ignores.toks),
        entities: mergeMap(a.ignores.entities, b.ignores.entities),
        cats: mergeMap(a.ignores.cats, b.ignores.cats),
        srcs: mergeMap(a.ignores.srcs, b.ignores.srcs),
        types: mergeMap(a.ignores.types, b.ignores.types)
      }
    });
  }
  function readTaste() { return normalizeTasteProfile(readNewsLocal(TASTE_KEY, {})); }
  function writeTaste(t) { writeNewsLocal(TASTE_KEY, compactTasteProfile(t)); }
  function syncTasteToCloudNow() {
    tasteCloudSyncTimer = null;
    try {
      if (typeof db === 'undefined' || !db || typeof currentUser === 'undefined' || !currentUser || !currentUser.uid) return;
      var payload = compactTasteProfile(readTaste());
      payload.updatedAtMs = Date.now();
      tasteCloudLastSyncAt = Date.now();
      if (typeof userProfile === 'object' && userProfile) userProfile[NEWS_TASTE_CLOUD_FIELD] = payload;
      var patch = {};
      patch[NEWS_TASTE_CLOUD_FIELD] = payload;
      db.collection('users').doc(currentUser.uid).set(patch, { merge: true }).catch(function () {});
    } catch (e) {}
  }
  function scheduleTasteCloudSync() {
    try {
      if (typeof db === 'undefined' || !db || typeof currentUser === 'undefined' || !currentUser || !currentUser.uid) return;
      if (tasteCloudSyncTimer) clearTimeout(tasteCloudSyncTimer);
      var wait = Math.max(NEWS_TASTE_SYNC_DEBOUNCE_MS, NEWS_TASTE_SYNC_MIN_MS - (Date.now() - tasteCloudLastSyncAt));
      tasteCloudSyncTimer = setTimeout(syncTasteToCloudNow, wait);
    } catch (e) {}
  }
  function initNewsTaste() {
    var key = newsUserStorageId();
    if (tasteInitializedFor === key) return;
    tasteInitializedFor = key;
    var local = readTaste();
    var cloud = null;
    try { cloud = (typeof userProfile !== 'undefined' && userProfile && userProfile[NEWS_TASTE_CLOUD_FIELD]) ? userProfile[NEWS_TASTE_CLOUD_FIELD] : null; } catch (e) {}
    if (cloud && typeof cloud === 'object') {
      writeTaste(mergeTasteProfiles(local, cloud));
      return;
    }
    try {
      if (typeof db !== 'undefined' && db && typeof currentUser !== 'undefined' && currentUser && currentUser.uid) {
        db.collection('users').doc(currentUser.uid).get().then(function (snap) {
          var remote = snap && snap.exists && snap.data ? snap.data()[NEWS_TASTE_CLOUD_FIELD] : null;
          if (remote && typeof remote === 'object') writeTaste(mergeTasteProfiles(readTaste(), remote));
          else if (Object.keys(local.toks).length || Object.keys(local.entities).length || Object.keys(local.cats).length) scheduleTasteCloudSync();
        }).catch(function () {});
      }
    } catch (e) {}
  }
  /* Behavioural taste, v2. Records a signal whose WEIGHT encodes how much the
     user engaged (bounce −0.8 · open ~1.0 · skim ~1.4 · deep read ~3.5 · heart 3
     · share 4 — js/43 computes the read weights from dwell + scroll). Two new
     behaviours vs v1:
       • time-decay — every write first scales all stored interest by
         0.93^daysElapsed (~10-day half-life) so stale tastes fade and the feed
         tracks what you're into NOW, not months ago.
       • signed signals with a floor at 0 — a negative weight (a quick bounce)
         SUBTRACTS, pulling that token/category/type/source back toward neutral,
         but never below zero (a dislike fades an interest; it can't invert it). */
  var TASTE_HALFLIFE = 0.93;     // 0.93^10 ≈ 0.48 ⇒ ~9.6-day half-life
  function decayMap(map, factor) {
    for (var k in map) {
      if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
      var v = map[k] * factor;
      if (v < 0.05) delete map[k]; else map[k] = v;     // prune faded-out entries
    }
  }
  function bumpTaste(map, key, weight) {
    if (!key) return;
    var v = (map[key] || 0) + weight;
    if (v <= 0.0001) delete map[key]; else map[key] = v;   // floor at 0
  }
  function bumpIgnore(map, key, weight) {
    if (!key) return;
    var v = Math.max(0, Number(map[key] || 0) + Math.max(0, Number(weight || 0)));
    if (v <= 0.0001) delete map[key]; else map[key] = v;
  }
  function decayTasteProfile(t, factor) {
    decayMap(t.toks, factor); decayMap(t.entities, factor); decayMap(t.cats, factor); decayMap(t.srcs, factor); decayMap(t.types, factor);
    if (!t.ignores) t.ignores = emptyIgnoreTaste();
    decayMap(t.ignores.toks, factor); decayMap(t.ignores.entities, factor); decayMap(t.ignores.cats, factor); decayMap(t.ignores.srcs, factor); decayMap(t.ignores.types, factor);
  }
  function normalizedEntityKey(value) {
    var n = String(value || '').toLowerCase();
    try { n = n.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
    return n.replace(/[^a-z0-9+&]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function articleEntityTokens(item) {
    item = item || {};
    if (item && item._entities) return item._entities;
    var text = String((item && item.title) || '') + ' ' + String((item && item.summary) || '') + ' ' + (Array.isArray(item && item.topics) ? item.topics.join(' ') : '');
    var out = [], seen = {};
    function add(value) {
      var key = normalizedEntityKey(value);
      if (key.length < 2 || key.length > 48 || seen[key]) return;
      if (/^(news|review|trailer|release|date|sale|deal|watch|best|top|new|latest|exclusive|report|video|official|season|episode|movie|music|games?)$/.test(key)) return;
      seen[key] = 1; out.push(key);
    }
    var known = text.match(/\b(?:Steam Deck|Nintendo Switch(?: 2)?|Switch 2|Xbox|Game Pass|PlayStation|PS5|DualSense|Marvel|DC|Star Wars|Pixar|Netflix|HBO Max|Disney\+|Crunchyroll|Spotify|Apple Music|Taylor Swift|Drake|Kendrick Lamar|Beyonce|BeyoncÃ©|Billie Eilish|Fortnite|Minecraft|Call of Duty|Grand Theft Auto|Elden Ring|Final Fantasy|Pokemon|PokÃ©mon|One Piece|Jujutsu Kaisen|Demon Slayer)\b/gi) || [];
    for (var k = 0; k < known.length; k++) add(known[k]);
    var phrases = text.match(/\b[A-Z0-9][A-Za-z0-9'&+.-]*(?:\s+[A-Z0-9][A-Za-z0-9'&+.-]*){0,4}\b/g) || [];
    for (var i = 0; i < phrases.length && out.length < 24; i++) {
      var p = phrases[i].replace(/\b(?:The|A|An|New|First|Official|Exclusive|Watch|Review|Trailer|News)\b/g, '').replace(/\s+/g, ' ').trim();
      if (p) add(p);
    }
    item._entities = out.slice(0, 24);
    return item._entities;
  }
  function articleSignalTokens(meta) {
    return tokenize(String(meta.title || '') + ' ' + String(meta.summary || '') + ' ' + (Array.isArray(meta.topics) ? meta.topics.join(' ') : '')).slice(0, 28);
  }
  function applyTasteSignal(meta, weight, ignoreOnly) {
    if (!meta || !weight) return;
    try {
      var t = readTaste();
      var now = Date.now();
      var last = Number(t.at || 0);
      if (last && now > last) {
        var days = (now - last) / 86400000;
        if (days > 0.02) {                                  // skip churn on back-to-back reads (<~29 min)
          var factor = Math.pow(TASTE_HALFLIFE, Math.min(days, 45));
          decayTasteProfile(t, factor);
        }
      }
      t.at = now;
      if (!t.ignores) t.ignores = emptyIgnoreTaste();
      var type = classifyType({ title: meta.title || '', summary: meta.summary || '', category: meta.catKey || '' });
      var toks = articleSignalTokens(meta);
      var entities = articleEntityTokens(meta);
      var cat = String(meta.catKey || '').trim();
      var src = String(meta.source || '').trim();
      if (ignoreOnly) {
        bumpIgnore(t.ignores.cats, cat, weight);
        bumpIgnore(t.ignores.srcs, src, weight);
        if (type && type !== 'general') bumpIgnore(t.ignores.types, type, weight);
        for (var ii = 0; ii < toks.length; ii++) bumpIgnore(t.ignores.toks, toks[ii], weight);
        for (var ie = 0; ie < entities.length; ie++) bumpIgnore(t.ignores.entities, entities[ie], weight);
      } else {
        bumpTaste(t.cats, cat, weight);
        bumpTaste(t.srcs, src, weight);
        if (type && type !== 'general') bumpTaste(t.types, type, weight);
        for (var i = 0; i < toks.length; i++) bumpTaste(t.toks, toks[i], weight);
        for (var e = 0; e < entities.length; e++) bumpTaste(t.entities, entities[e], weight * 1.15);
      }
      writeTaste(t);
      scheduleTasteCloudSync();
    } catch (e) {}
  }
  function recordTaste(meta, weight) { applyTasteSignal(meta, weight, false); }
  function recordIgnore(meta, weight) { applyTasteSignal(meta, Math.max(0.02, Number(weight || 0.08)), true); }
  function recordShareIntent(meta) {
    recordTaste(meta, 4);                                   // sharing stays a strong taste signal (UNCHANGED)
    try { recordConsumed(meta, 'share'); } catch (e) {}     // v11.693: shared ⇒ hard-hide the exact article ~30d
  }

  /* shelf tokens/cats from the user's library, weighted by status (in-progress >
     watchlist > loved > done). Read-only + fully feature-detected → safe when
     signed-out / empty (cold start just gets no shelf boost). */
  var SECTION_TO_NEWSCAT = { movies: 'movies', shows: 'tv', anime: 'anime', games: 'games', music: 'music' };
  function shelfStatusWeight(status, rating) {
    var s = String(status || '').toLowerCase();
    var w = (s === 'watching' || s === 'live' || s === 'competitive') ? 3.0
          : (s === 'planned' || s === 'wishlist') ? 2.2
          : (s === 'watched' || s === 'played' || s === 'paused') ? 1.0 : 1.4;
    if (Number(rating) >= 8) w += 1.0;
    return w;
  }
  var _shelfCtx = null, _shelfCtxAt = 0, SHELF_CTX_TTL = 30 * 1000;
  function buildShelfContext() {
    /* memoized ~30s so rapid recycles don't re-tokenize a big library every time
       (library changes still reflect on the next refresh or after the TTL). */
    if (_shelfCtx && (Date.now() - _shelfCtxAt) < SHELF_CTX_TTL) return _shelfCtx;
    var ctx = { tokens: {}, cats: {} };
    try {
      var lib = (typeof getVisibleListData === 'function') ? getVisibleListData()
              : (typeof data !== 'undefined' ? data : null);
      if (!lib || typeof lib !== 'object') return ctx;
      var sections = Object.keys(SECTION_TO_NEWSCAT);
      for (var s = 0; s < sections.length; s++) {
        var arr = lib[sections[s]];
        if (!Array.isArray(arr)) continue;
        var newsCat = SECTION_TO_NEWSCAT[sections[s]];
        for (var i = 0; i < arr.length; i++) {
          var it = arr[i]; if (!it) continue;
          var title = it.title || it.name || ''; if (!title) continue;
          var w = shelfStatusWeight(it.status, it.rating);
          ctx.cats[newsCat] = (ctx.cats[newsCat] || 0) + w;
          var toks = tokenize(title);
          for (var k = 0; k < toks.length; k++) ctx.tokens[toks[k]] = Math.max(ctx.tokens[toks[k]] || 0, w);
          if (it.artist) { var at = tokenize(String(it.artist)); for (var a = 0; a < at.length; a++) ctx.tokens[at[a]] = Math.max(ctx.tokens[at[a]] || 0, w); }
        }
      }
      var maxCat = 0, ck = Object.keys(ctx.cats);
      for (var c = 0; c < ck.length; c++) if (ctx.cats[ck[c]] > maxCat) maxCat = ctx.cats[ck[c]];
      if (maxCat > 0) for (var c2 = 0; c2 < ck.length; c2++) ctx.cats[ck[c2]] = ctx.cats[ck[c2]] / maxCat;
    } catch (e) {}
    _shelfCtx = ctx; _shelfCtxAt = Date.now();
    return ctx;
  }

  /* sum of weights of an article's tokens present in a weighted map (diminishing). */
  function tokenWeightMatch(atoks, wmap) {
    if (!wmap) return 0;
    var sum = 0, hits = 0;
    for (var i = 0; i < atoks.length; i++) { var w = wmap[atoks[i]]; if (w) { sum += w; hits++; } }
    return hits ? Math.min(1, sum / (sum + 1.4)) : 0;
  }

  function buildContext() {
    return { shelf: buildShelfContext(), taste: readTaste(), opens: readOpens(), seen: readSeen(), now: Date.now() };
  }

  /* duplicate signature: longest significant tokens, sorted — same story across sources. */
  function dupSignature(item) {
    if (item && item.storyKey) return item.storyKey;
    var eventKey = storyEventKey(item);
    if (eventKey) return eventKey;
    if (item._sig !== undefined) return item._sig;
    var toks = articleTokens(item).slice();
    toks.sort(function (a, b) { return b.length - a.length || (a < b ? -1 : 1); });
    item._sig = toks.slice(0, 5).sort().join(' ');
    return item._sig;
  }
  function markDuplicates(pool) {
    var groups = {};
    for (var i = 0; i < pool.length; i++) {
      pool[i]._dup = 0;
      /* v11.634: prefer the provider's authoritative story id (Event Registry
         eventUri) over the token signature when present — a stronger, exact
         same-story key for spacing related coverage in the feed. */
      var sig = pool[i].eventId ? ('ev:' + pool[i].eventId) : dupSignature(pool[i]);
      if (sig) (groups[sig] || (groups[sig] = [])).push(pool[i]);
    }
    var keys = Object.keys(groups);
    for (var g = 0; g < keys.length; g++) {
      var arr = groups[keys[g]];
      if (arr.length < 2) continue;
      arr.sort(function (a, b) { return (freshnessScore(b.publishedAt) * sourceQuality(b.source)) - (freshnessScore(a.publishedAt) * sourceQuality(a.source)); });
      for (var d = 1; d < arr.length; d++) arr[d]._dup = Math.min(1, 0.5 + 0.2 * d);
    }
  }

  function scoreArticle(item, ctx) {
    var f = freshnessScore(item.publishedAt);
    var opened = !!(item.url && ctx.opens[item.url]);
    /* v11.693: SEEN is now matched across the item's precise identity keys (exact
       URL / worker id / provider id / event id / YouTube id), not just item.id —
       so a scrolled-past story is recognised even when it returns from a different
       provider/URL form. (Liked/opened/shared items are HARD-HIDDEN upstream in
       buildFeedOrder, so this score path mainly governs merely-seen ones now.) */
    var seenTs = itemSeenAt(item, ctx.seen);
    var seenRecent = !!(seenTs && (ctx.now - seenTs) < SEEN_TTL_MS);
    /* v11.693: stronger merely-seen suppression — factor 0.30→0.14 AND an explicit
       pSeen penalty below, so a scrolled-past article sinks hard (but, unlike a
       consumed one, is not removed — it can still resurface once it ages out). */
    var u = opened ? 0.06 : (seenRecent ? 0.14 : 1.0);
    /* v11.634: prefer the backend-supplied source quality (covers provider
       outlets the client map doesn't list) and fall back to the local map. */
    var q = (typeof item.quality === 'number') ? item.quality : sourceQuality(item.source);
    var atoks = articleTokens(item);
    var ents = articleEntityTokens(item);
    var shelfTok = tokenWeightMatch(atoks, ctx.shelf.tokens);
    var shelfCat = ctx.shelf.cats[item.category] || 0;
    var tasteTok = tokenWeightMatch(atoks, ctx.taste.toks);
    var tasteEntity = tokenWeightMatch(ents, ctx.taste.entities);
    var tasteCat = ctx.taste.cats[item.category] ? Math.min(1, ctx.taste.cats[item.category] / 12) : 0;
    var tasteSrc = ctx.taste.srcs[item.source] ? Math.min(1, ctx.taste.srcs[item.source] / 12) : 0;
    var aType = classifyType(item);
    var tasteType = (aType !== 'general' && ctx.taste.types[aType]) ? Math.min(1, ctx.taste.types[aType] / 14) : 0;
    var ignores = ctx.taste.ignores || emptyIgnoreTaste();
    var ignoreTok = tokenWeightMatch(atoks, ignores.toks);
    var ignoreEntity = tokenWeightMatch(ents, ignores.entities);
    var ignoreCat = ignores.cats[item.category] ? Math.min(1, ignores.cats[item.category] / 14) : 0;
    var ignoreSrc = ignores.srcs[item.source] ? Math.min(1, ignores.srcs[item.source] / 14) : 0;
    var ignoreType = (aType !== 'general' && ignores.types[aType]) ? Math.min(1, ignores.types[aType] / 14) : 0;
    var ignoreScore = Math.min(1, ignoreTok * 0.35 + ignoreEntity * 0.35 + ignoreCat * 0.1 + ignoreSrc * 0.08 + ignoreType * 0.12);
    var disc = Math.random() * Math.random();   // skewed-low surprise; occasionally lifts a weak item
    return ALGO.wFresh * f
      + ALGO.wUnseen * u
      + ALGO.wShelf * Math.min(1, shelfTok * 0.85 + shelfCat * 0.35)
      + ALGO.wTaste * Math.min(1, tasteTok * 0.42 + tasteEntity * 0.3 + tasteCat * 0.12 + tasteSrc * 0.08 + tasteType * 0.08)
      + ALGO.wQuality * q
      + ALGO.wDiscovery * disc
      - ALGO.wIgnore * ignoreScore
      - ALGO.pDup * (item._dup || 0)
      - ALGO.pOpened * (opened ? 1 : 0)
      - ALGO.pSeen * (seenRecent && !opened ? 1 : 0);   // v11.693
  }

  /* Efraimidis–Spirakis weighted random permutation: key = u^(1/weight), with a
     SOFTMAX weight exp(temp*score) so score differences become a real, tunable
     ranking edge (P(i ranks before j) = sigmoid(temp*(score_i−score_j))). Still
     fully randomized — the same pool builds a different order every time; learned
     relevance only shifts the odds, never hard-sorts. */
  function weightedShuffle(pool, ctx) {
    var keyed = new Array(pool.length);
    for (var i = 0; i < pool.length; i++) {
      var w = Math.exp(ALGO.temp * scoreArticle(pool[i], ctx));
      if (!(w > 1e-6)) w = 1e-6;            // guard against NaN / underflow
      var u = Math.random(); if (u <= 0) u = 1e-9;
      keyed[i] = { it: pool[i], key: Math.pow(u, 1 / w) };
    }
    keyed.sort(function (a, b) { return b.key - a.key; });
    var out = new Array(keyed.length);
    for (var j = 0; j < keyed.length; j++) out[j] = keyed[j].it;
    return out;
  }

  /* Greedy diversity pass: keep the weighted ranking but avoid same-source
     clusters, long same-category runs, and near-duplicate stories close together
     — by picking the first non-violating item within a short look-ahead window. */
  function diversifyOrder(order) {
    var n = order.length;
    if (n < 4) return order;
    /* pool category shares → proportional balancing. A single-category feed
       (Games/Anime/…) has share 1.0 for its category, so the density cap is
       never hit; the 'screen' (Movies+TV) and 'All' feeds get a real mix. */
    var poolShare = {}, distinctSrc = {}, ci;
    for (ci = 0; ci < n; ci++) { var pc = order[ci].category || '_'; poolShare[pc] = (poolShare[pc] || 0) + 1; var ps = order[ci].source || ''; if (ps) distinctSrc[ps] = 1; }
    for (var pk in poolShare) poolShare[pk] = poolShare[pk] / n;
    /* adaptive source spacing: with few distinct sources keep the window small
       enough that ≥2 sources are always free (a 3-source category feed can't
       honour a window of 6) — prevents starving the look-ahead. */
    var srcWin = Math.max(1, Math.min(ALGO.srcWindow, Object.keys(distinctSrc).length - 2));
    var remaining = order.slice(), result = [], lastSourceAt = {}, recentTokenSets = [], catCount = {};
    function violates(item, pos) {
      var src = item.source || '', cat = item.category || '_';
      if (src && lastSourceAt[src] !== undefined && (pos - lastSourceAt[src]) < srcWin) return true;
      // same-category run
      if (pos >= ALGO.catRun) {
        var run = true;
        for (var r = 1; r <= ALGO.catRun; r++) { var pr = result[pos - r]; if (!pr || pr.category !== cat) { run = false; break; } }
        if (run) return true;
      }
      // proportional category density — don't let a category climb far above its pool share
      if (pos >= 6 && ((catCount[cat] || 0) + 1) / (pos + 1) > (poolShare[cat] || 0) * ALGO.catDensity + ALGO.catDensityFloor) return true;
      // near-duplicate story within the window
      var toks = articleTokens(item);
      for (var w = 0; w < recentTokenSets.length; w++) {
        var overlap = 0, set = recentTokenSets[w];
        for (var t = 0; t < toks.length; t++) if (set[toks[t]]) overlap++;
        if (overlap >= ALGO.dupOverlap) return true;
      }
      // type clustering — don't stack many of the same KIND (trailer, patch
      // notes, casting…) close together. 'general' is exempt (it's the mixed bag).
      var itype = classifyType(item);
      if (itype !== 'general' && pos >= ALGO.typeMax) {
        var tc = 0;
        for (var ty = 1; ty <= ALGO.typeWindow && (pos - ty) >= 0; ty++) {
          var pit = result[pos - ty];
          if (pit && classifyType(pit) === itype) tc++;
        }
        if (tc >= ALGO.typeMax) return true;
      }
      return false;
    }
    while (remaining.length) {
      var pos = result.length, pick = -1, limit = Math.min(ALGO.look, remaining.length);
      for (var i = 0; i < limit; i++) { if (!violates(remaining[i], pos)) { pick = i; break; } }
      if (pick < 0) {
        /* nothing in the window is fully diverse — relax to the candidate whose
           SOURCE was used longest ago (keeps sources spread even under pressure),
           preferring an as-yet-unused source. */
        pick = 0; var bestGap = -1;
        for (var j = 0; j < limit; j++) {
          var sj = remaining[j].source || '';
          var gap = (sj && lastSourceAt[sj] !== undefined) ? (pos - lastSourceAt[sj]) : 100000;
          if (gap > bestGap) { bestGap = gap; pick = j; }
        }
      }
      var item = remaining.splice(pick, 1)[0];
      result.push(item);
      catCount[item.category || '_'] = (catCount[item.category || '_'] || 0) + 1;
      if (item.source) lastSourceAt[item.source] = pos;
      var tset = {}, toks2 = articleTokens(item);
      for (var tk = 0; tk < toks2.length; tk++) tset[toks2[tk]] = 1;
      recentTokenSets.push(tset);
      if (recentTokenSets.length > ALGO.dupWindow) recentTokenSets.shift();
    }
    return result;
  }

  /* ---------- v11.674 / hardened v11.678: VIDEO MIX CONTROL ----------
     The collector + RSS feed plenty of fresh trusted-channel videos (Valorant, Apex,
     Marvel Rivals, PUBG, GameSpot, IGN, PlayStation, Nintendo, GameTrailers…), but
     the weighted-random + diversity order alone never GUARANTEES they surface — a
     user could scroll dozens of cards and hit only written articles. This pass gives
     a healthy, evenly-spaced video presence with HARD guarantees:

       • ONE video stream (fresh first → surfaces early; stale last → stays buried),
         ONE article stream — both keep their ranked order.
       • Interleave ~1 video every VIDEO_TARGET_GAP cards. Because EVERY video (fresh
         AND stale) flows through the single cadence, and a video is only placed when
         the previous card is NOT a video, two videos can NEVER land back-to-back →
         no "10 videos in a row" anywhere in the order (not just the visible top).
       • Video count is HARD-bounded to the cadence capacity (≈ articles / (GAP-1)).
         When there are more videos than slots (the games feed has ~107 videos but
         only ~73 slots), the surplus — fresh first, so the top uploads make the cut
         — is left out of THIS render and resurfaces on the next reshuffle/pull. This
         is what prevents a tail clump and keeps the feed from going video-heavy;
         videos ROTATE across renders rather than piling up.
       • No-op when a pool has < 2 fresh videos OR no articles, so article-only /
         video-less categories (e.g. music) are completely unaffected. */
  var VIDEO_TARGET_GAP = 5;     // aim for ~1 video per 5 cards (≈20% — present, not dominant)
  /* v11.698: 0.35→0.22 (≈ last 7 days, was ~4.7). Slow-cadence studio channels
     (A24 / NEON / DC / Lionsgate post ~weekly) had ALL their videos classified
     stale and buried — measured: A24 appeared in 0% of simulated sessions. A
     week-old official trailer is still feed-worthy; truly old clips (>7d) remain
     stale-tier so evergreen flooding stays impossible. */
  var VIDEO_FRESH_MIN = 0.22;
  function isVideoItem(item) {
    if (!item) return false;
    if (item._isVid !== undefined) return item._isVid;
    item._isVid = item.mediaType === 'video' || isVideoUrl(item.url || '');
    return item._isVid;
  }
  /* v11.698: SOURCE-FAIR ROTATION for the video stream. The ranked video list is
     dominated by the prolific channels (Netflix / Movieclips / Rotten Tomatoes /
     Warner upload several times a day, so their uploads own the top of the fresh
     tier) — measured on the live pool: those 4 held 52% of all visible video
     slots, Lionsgate surfaced in 17% of sessions, A24 in 0%, and on Anime TOHO
     alone held 36%. Re-deal the ranked list round-robin BY SOURCE: cycle 1 = each
     source's best-ranked video (sources ordered by their best video's rank, so
     freshness/quality/personalization still decide who leads and what each source
     shows), cycle 2 = second-best, … . The capacity slice then spans the whole
     source pool instead of one channel's upload burst, and a source can hold at
     most ~⌈slots/sources⌉ of the visible video slots — the soft per-source cap.
     Ranking, dedupe, consumed-suppression, aspect ratios, cadence (1-per-5, never
     adjacent) all run unchanged around it. */
  function rotateVideosBySource(videos) {
    var bySrc = {}, srcOrder = [], i, s;
    for (i = 0; i < videos.length; i++) {
      s = videos[i].source || '_';
      if (!bySrc[s]) { bySrc[s] = []; srcOrder.push(s); }
      bySrc[s].push(videos[i]);
    }
    if (srcOrder.length < 2) return videos;
    var out = [], round = 0, added = true;
    while (added) {
      added = false;
      for (i = 0; i < srcOrder.length; i++) {
        var arr = bySrc[srcOrder[i]];
        if (round < arr.length) { out.push(arr[round]); added = true; }
      }
      round++;
    }
    return out;
  }
  function mixVideos(order) {
    if (!Array.isArray(order) || order.length < VIDEO_TARGET_GAP * 2) return order;
    var articles = [], freshV = [], staleV = [];
    for (var i = 0; i < order.length; i++) {
      var it = order[i];
      if (isVideoItem(it)) { if (freshnessScore(it.publishedAt) >= VIDEO_FRESH_MIN) freshV.push(it); else staleV.push(it); }
      else articles.push(it);
    }
    if (freshV.length < 2 || !articles.length) return order;   // need fresh video + articles to interleave
    /* HARD cap at the cadence capacity = how many videos 1-per-GAP can hold across
       the articles. This is what guarantees NO tail clump: when (as on the games
       feed) there are MORE videos than cadence slots, the surplus is left out of
       THIS render and resurfaces on the next reshuffle/pull — videos rotate instead
       of piling up. Fresh first so the best uploads always make the cut; stale only
       fill leftover slots. */
    var capacity = Math.max(2, Math.ceil(articles.length / (VIDEO_TARGET_GAP - 1)));
    /* v11.698: rotate EACH tier by source before the capacity slice — fresh still
       strictly precedes stale (no stale flooding), but within a tier the slots now
       span every source instead of the most prolific channel's upload burst. */
    var videos = rotateVideosBySource(freshV).concat(rotateVideosBySource(staleV)).slice(0, capacity);
    var out = [], ai = 0, vi = 0, sinceVideo = 0;
    while (ai < articles.length || vi < videos.length) {
      var lastWasVideo = out.length > 0 && isVideoItem(out[out.length - 1]);
      var placeVideo = (vi < videos.length) &&
        (ai >= articles.length || (sinceVideo >= (VIDEO_TARGET_GAP - 1) && !lastWasVideo));
      if (placeVideo) { out.push(videos[vi++]); sinceVideo = 0; }
      else { out.push(articles[ai++]); sinceVideo++; }
    }
    return out;
  }

  /* Hard-hide consumed and high-confidence seen story events before ranking, so
     a story from one outlet does not re-enter through another outlet's URL for
     the same user. */
  function suppressConsumedPool(pool) {
    var keep = [], hidden = [], map = readConsumed(), seenMap = readSeen(), now = Date.now();   // read stores ONCE per order build
    for (var i = 0; i < pool.length; i++) {
      if (isConsumedInMap(pool[i], map, now) || isSeenStoryInMap(pool[i], seenMap, now)) hidden.push(pool[i]); else keep.push(pool[i]);
    }
    if (!hidden.length) return pool;
    return keep;
  }

  /* Entry — the smart order for a category's pool. */
  function buildFeedOrder(pool) {
    pool = dedupePool(pool);
    if (!pool || !pool.length) return [];
    pool = suppressConsumedPool(pool);   // v11.693: drop consumed items before ranking
    if (!pool.length) return [];
    var ctx = buildContext();
    markDuplicates(pool);
    return mixVideos(diversifyOrder(weightedShuffle(pool, ctx)));
  }

  /* Per-category feed order, CACHED so swiping between categories does NOT
     re-shuffle. (The bug: every swipe rebuilt the order via buildFeedOrder, and
     because the just-viewed cards were now "seen" they got pushed to the back →
     it looked like a full refresh.) The order is rebuilt ONLY when reshuffle is
     true — i.e. a pull-to-refresh or a cold/first load — otherwise the existing
     order for that category is returned verbatim. */
  function categoryOrder(cat, pool, reshuffle) {
    if (!reshuffle && state.orderCache[cat] && state.orderCache[cat].length) {
      return state.orderCache[cat];
    }
    var order = buildFeedOrder(pool);
    state.orderCache[cat] = order;
    return order;
  }

  /* ---------- markup ---------- */
  function normalizeNewsVideoAspect(value, orientation) {
    var s = String(value || '').trim();
    var m = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (m) {
      var w = Number(m[1]), h = Number(m[2]);
      if (w > 0 && h > 0) return { css: w + ' / ' + h, value: w + '/' + h, orientation: orientation || orientationFromRatio(w / h) };
    }
    var n = Number(value || 0);
    if (Number.isFinite(n) && n > 0) return { css: n + ' / 1', value: String(n), orientation: orientation || orientationFromRatio(n) };
    var o = String(orientation || '').toLowerCase();
    if (o === 'portrait') return { css: '9 / 16', value: '9/16', orientation: 'portrait' };
    if (o === 'square') return { css: '1 / 1', value: '1/1', orientation: 'square' };
    return { css: '16 / 9', value: '16/9', orientation: 'landscape' };
  }
  function orientationFromRatio(r) {
    if (r < 0.82) return 'portrait';
    if (r <= 1.18) return 'square';
    return 'landscape';
  }
  function youtubeThumbVideoId(url) {
    var s = String(url || '');
    var m = s.match(/(?:i\d?\.)?ytimg\.com\/vi\/([a-zA-Z0-9_-]{6,})\//i);
    return m ? m[1] : '';
  }
  var ytThumbLayoutCache = {};
  var ytOriginalAspectCache = {};
  function youtubeFallbackThumb(ytId) {
    return ytId ? ('https://i.ytimg.com/vi/' + encodeURIComponent(ytId) + '/hqdefault.jpg') : '';
  }
  function youtubeOriginalAspectThumbs(ytId) {
    if (!ytId) return [];
    var clean = encodeURIComponent(ytId);
    return [
      'https://i.ytimg.com/vi/' + clean + '/oar2.jpg',
      'https://i.ytimg.com/vi/' + clean + '/oardefault.jpg'
    ];
  }
  function applyDetectedNewsVideoAspect(media, aspect) {
    if (!media || !aspect || !aspect.css) return;
    media.style.setProperty('--news-video-aspect', aspect.css);
    media.dataset.newsVideoOrientation = aspect.orientation;
    media.dataset.newsVideoAspect = aspect.value;
    if (aspect.source) media.dataset.newsVideoAspectSource = aspect.source;
    if (aspect.probeUrl) media.dataset.newsVideoAspectProbe = aspect.probeUrl;
    if (aspect.thumbnailWidth) media.dataset.newsThumbnailWidth = String(aspect.thumbnailWidth);
    if (aspect.thumbnailHeight) media.dataset.newsThumbnailHeight = String(aspect.thumbnailHeight);
    var card = media.closest && media.closest('.news-card[data-news-url]');
    if (card) {
      card.setAttribute('data-news-video-aspect', aspect.value);
      card.setAttribute('data-news-video-orientation', aspect.orientation);
      if (aspect.source) card.setAttribute('data-news-video-aspect-source', aspect.source);
      if (aspect.probeUrl) card.setAttribute('data-news-video-aspect-probe', aspect.probeUrl);
      if (aspect.thumbnailWidth) card.setAttribute('data-news-thumbnail-width', String(aspect.thumbnailWidth));
      if (aspect.thumbnailHeight) card.setAttribute('data-news-thumbnail-height', String(aspect.thumbnailHeight));
    }
  }
  function detectYouTubeOriginalAspectLayout(ytId, done) {
    if (!ytId || typeof done !== 'function') return;
    if (ytOriginalAspectCache[ytId] !== undefined) { done(ytOriginalAspectCache[ytId]); return; }
    var candidates = youtubeOriginalAspectThumbs(ytId);
    if (!candidates.length || typeof Image === 'undefined') {
      ytOriginalAspectCache[ytId] = null;
      done(null);
      return;
    }
    var index = 0;
    function tryNext() {
      var url = candidates[index++];
      if (!url) {
        ytOriginalAspectCache[ytId] = null;
        done(null);
        return;
      }
      var img = new Image();
      img.onload = function () {
        var w = Number(img.naturalWidth || img.width || 0);
        var h = Number(img.naturalHeight || img.height || 0);
        if (w <= 0 || h <= 0) { tryNext(); return; }
        var ratio = w / h;
        if (!Number.isFinite(ratio) || ratio <= 0) { tryNext(); return; }
        var orientation = orientationFromRatio(ratio);
        /* YouTube's oar* thumbnails preserve the upload's original aspect.
           Treat portrait/square as authoritative; landscape simply means the
           standard 16:9 fallback is already appropriate. */
        if (orientation === 'portrait' || orientation === 'square') {
          var result = {
            css: w + ' / ' + h,
            value: w + '/' + h,
            orientation: orientation,
            poster: url,
            source: 'youtube-original-aspect',
            probeUrl: url,
            thumbnailWidth: w,
            thumbnailHeight: h
          };
          ytOriginalAspectCache[ytId] = result;
          done(result);
          return;
        }
        ytOriginalAspectCache[ytId] = null;
        done(null);
      };
      img.onerror = tryNext;
      img.src = url;
    }
    tryNext();
  }
  function detectYouTubeFallbackThumbLayout(ytId, done) {
    if (!ytId || typeof done !== 'function') return;
    if (ytThumbLayoutCache[ytId] !== undefined) { done(ytThumbLayoutCache[ytId]); return; }
    var url = youtubeFallbackThumb(ytId);
    if (!url || typeof Image === 'undefined' || typeof document === 'undefined') {
      ytThumbLayoutCache[ytId] = null;
      done(null);
      return;
    }
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      var result = null;
      try {
        var w = 240, h = 180;
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext && canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('no canvas');
        ctx.drawImage(img, 0, 0, w, h);
        var data = ctx.getImageData(0, 0, w, h).data;
        var diffs = [];
        for (var x = 1; x < w; x++) {
          var total = 0;
          for (var y = 0; y < h; y++) {
            var a = (y * w + x - 1) * 4;
            var b = (y * w + x) * 4;
            total += Math.abs(data[a] - data[b]) + Math.abs(data[a + 1] - data[b + 1]) + Math.abs(data[a + 2] - data[b + 2]);
          }
          diffs.push(total / (h * 3));
        }
        var sum = 0;
        for (var i = 0; i < diffs.length; i++) sum += diffs[i];
        var mean = sum / Math.max(1, diffs.length);
        var sq = 0;
        for (var j = 0; j < diffs.length; j++) sq += Math.pow(diffs[j] - mean, 2);
        var sd = Math.sqrt(sq / Math.max(1, diffs.length)) || 1;
        function peak(start, end) {
          var bestX = start, best = -1;
          for (var px = start; px < end; px++) {
            var val = diffs[px - 1] || 0;
            if (val > best) { best = val; bestX = px; }
          }
          return { x: bestX, val: best, z: (best - mean) / sd };
        }
        var left = peak(Math.floor(w * 0.20), Math.floor(w * 0.45));
        var right = peak(Math.floor(w * 0.55), Math.floor(w * 0.80));
        var contentRatio = (right.x - left.x) / h;
        var strongRails = left.z >= 3.2 && right.z >= 3.2 && right.x > left.x;
        if (strongRails && contentRatio >= 0.42 && contentRatio < 0.74) {
          result = { css: '9 / 16', value: '9/16', orientation: 'portrait', poster: url, source: 'youtube-letterbox-fallback', probeUrl: url };
        } else if (strongRails && contentRatio >= 0.82 && contentRatio <= 1.18) {
          result = { css: '1 / 1', value: '1/1', orientation: 'square', poster: url, source: 'youtube-letterbox-fallback', probeUrl: url };
        }
      } catch (e) { result = null; }
      ytThumbLayoutCache[ytId] = result;
      done(result);
    };
    img.onerror = function () { ytThumbLayoutCache[ytId] = null; done(null); };
    img.src = url;
  }
  window.shelfdNewsApplyImageAspect = function (img) {
    try {
      if (!img || !img.naturalWidth || !img.naturalHeight) return;
      var media = img.closest && img.closest('.news-card-media-video');
      if (!media) return;
      var card = media.closest && media.closest('.news-card[data-news-url]');
      var url = card ? (card.getAttribute('data-news-url') || '') : (media.getAttribute('data-news-url') || '');
      var title = card ? (card.getAttribute('data-news-title') || '') : (media.getAttribute('data-news-title') || '');
      var ytId = youtubeVideoId(url || '') || youtubeThumbVideoId(img.currentSrc || img.src || '') || media.getAttribute('data-news-video-id') || '';
      if (ytId) {
        detectYouTubeOriginalAspectLayout(ytId, function (detected) {
          if (!detected || !media.isConnected) return;
          applyDetectedNewsVideoAspect(media, detected);
          if (detected.poster && img.isConnected && img.src !== detected.poster && !img.dataset.newsPortraitPosterApplied) {
            img.dataset.newsPortraitPosterApplied = '1';
            img.src = detected.poster;
          }
        });
      }
      if (ytId && isShortsLikeUrl(url, title)) {
        var shortsFallback = { css: '9 / 16', value: '9/16', orientation: 'portrait', poster: youtubeFallbackThumb(ytId), source: 'shorts-signal', probeUrl: youtubeOriginalAspectThumbs(ytId)[0] || '' };
        applyDetectedNewsVideoAspect(media, shortsFallback);
        if (shortsFallback.poster && img.src !== shortsFallback.poster && !img.dataset.newsPortraitPosterApplied) {
          img.dataset.newsPortraitPosterApplied = '1';
          img.src = shortsFallback.poster;
        }
        return;
      }
      if (ytId) {
        detectYouTubeFallbackThumbLayout(ytId, function (detected) {
          if (!detected || !media.isConnected) return;
          var currentOrientation = media.dataset.newsVideoOrientation || '';
          if (detected.orientation === 'portrait' || currentOrientation !== 'portrait') {
            applyDetectedNewsVideoAspect(media, detected);
            if (detected.poster && img.isConnected && img.src !== detected.poster && !img.dataset.newsPortraitPosterApplied) {
              img.dataset.newsPortraitPosterApplied = '1';
              img.src = detected.poster;
            }
          }
        });
        return;
      }
      if (media.dataset.newsAspectLocked === '1') return;
      var r = img.naturalWidth / img.naturalHeight;
      if (!Number.isFinite(r) || r <= 0) return;
      applyDetectedNewsVideoAspect(media, {
        css: img.naturalWidth + ' / ' + img.naturalHeight,
        value: img.naturalWidth + '/' + img.naturalHeight,
        orientation: orientationFromRatio(r)
      });
    } catch (e) {}
  };
  function applyYouTubeOriginalAspectToMedia(media, ytId) {
    if (!media || !ytId) return;
    detectYouTubeOriginalAspectLayout(ytId, function (detected) {
      if (!detected || !media.isConnected) return;
      applyDetectedNewsVideoAspect(media, detected);
      if (detected.poster) {
        try {
          var img = media.querySelector('img');
          if (img && img.isConnected && img.src !== detected.poster && !img.dataset.newsPortraitPosterApplied) {
            img.dataset.newsPortraitPosterApplied = '1';
            img.src = detected.poster;
          }
        } catch (e) {}
        try {
          var cover = media.querySelector('[data-news-video-cover]');
          if (cover) cover.style.backgroundImage = "url('" + String(detected.poster).replace(/'/g, '%27') + "')";
        } catch (e) {}
      }
    });
  }
  function cardHtml(it) {
    if (!it || !it.url) return '';
    /* Image is the LAST element of the card — full width, under the title +
       description, at the source image's natural aspect ratio (~16:9 typical).
       v11.652: YouTube cards always show the video thumbnail (derived from the
       video id if the server image is missing/bogus) + a play badge. */
    var isVideo = isVideoItem(it);
    var img = it.image || '';
    var vid = '';
    var forceShortsPortrait = isVideo && isShortsLikeUrl(it.url, it.title);
    if (isVideo) {
      vid = youtubeVideoId(it.url);
      if (vid && (!img || !/(^|\.)ytimg\.com\//i.test(img))) img = 'https://i.ytimg.com/vi/' + vid + '/hqdefault.jpg';
      if (vid && (forceShortsPortrait || String(it.videoOrientation || '').toLowerCase() === 'portrait')) img = youtubeFallbackThumb(vid);
    }
    var playBadge = isVideo
      ? '<span class="news-card-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg></span>'
      : '';
    var rawAspect = it.videoAspectRatio || '';
    var rawOrientation = it.videoOrientation || '';
    var lockAspect = !!rawAspect;
    if (isVideo && forceShortsPortrait) {
      rawAspect = '9/16';
      rawOrientation = 'portrait';
      lockAspect = true;
    } else if (isVideo && !rawAspect && isYouTubeUrl(it.url)) {
      rawAspect = '16/9';
      rawOrientation = 'landscape';
      lockAspect = true;
    }
    var aspect = isVideo ? normalizeNewsVideoAspect(rawAspect, rawOrientation) : null;
    var mediaAttrs = isVideo
      ? ' data-news-url="' + escA(it.url || '') + '" data-news-title="' + escA(it.title || '') + '" data-news-video-id="' + escA(vid || '') + '"' +
        ' data-news-video-orientation="' + escA(aspect.orientation) + '" data-news-video-aspect="' + escA(aspect.value) + '"' +
        (it.videoAspectSource ? ' data-news-video-aspect-source="' + escA(it.videoAspectSource) + '"' : '') +
        (it.videoAspectProbeUrl ? ' data-news-video-aspect-probe="' + escA(it.videoAspectProbeUrl) + '"' : '') +
        (it.thumbnailWidth ? ' data-news-thumbnail-width="' + escA(it.thumbnailWidth) + '"' : '') +
        (it.thumbnailHeight ? ' data-news-thumbnail-height="' + escA(it.thumbnailHeight) + '"' : '') +
        ' style="--news-video-aspect:' + escA(aspect.css) + '"' + (lockAspect ? ' data-news-aspect-locked="1"' : '')
      : '';
    var media = img
      ? '<div class="news-card-media' + (isVideo ? ' news-card-media-video' : '') + '"' + mediaAttrs + '><img src="' + escA(img) + '" alt="" loading="lazy" decoding="async"' + (isVideo ? ' crossorigin="anonymous" onload="window.shelfdNewsApplyImageAspect&&window.shelfdNewsApplyImageAspect(this)"' : '') + ' onerror="this.closest(\'.news-card-media\').style.display=\'none\'">' + playBadge + '</div>'
      : '';
    var catLabel = it.category ? categoryLabel(it.category) : '';
    var timeLabel = it.publishedAt ? timeAgo(it.publishedAt) : '';
    var cat = catLabel ? '<span class="news-card-cat">' + esc(catLabel) + '</span>' : '';
    var time = timeLabel ? '<span class="news-card-dot">·</span><span class="news-card-time">' + esc(timeLabel) + '</span>' : '';
    /* v11.729: body text preview removed from the card — header/title only. */
    var summary = '';
    var topicsText = Array.isArray(it.topics) ? it.topics.slice(0, 8).join(' | ') : '';
    var booked = isBookmarked(it.url);
    var heartBtn = '<button class="news-card-heart' + (booked ? ' is-bookmarked' : '') + '" type="button" aria-label="Bookmark article" aria-pressed="' + (booked ? 'true' : 'false') + '" data-news-heart>' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>' +
    '</button>';
    /* v11.756: YouTube engagement row (likes · views + a comment button) sits
       UNDER the inline video. Stats fill in lazily after a batched fetch; the
       comment button opens the comments sheet. Only on YouTube video cards.
       v11.772: the heart moves IN here, just left of the like count (♥ 82K likes),
       and the comment button shows the glyph + number only (no "comments" word). */
    var engagement = (isVideo && vid)
      ? '<div class="news-ytc-engage" data-news-engagement data-news-video-id="' + escA(vid) + '">' +
          heartBtn +
          '<div class="news-ytc-stats" data-news-stats></div>' +
        '</div>'
      : '';
    var shareBtn = '<button class="news-card-share" type="button" aria-label="Share article" data-news-share>' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M12 3L8 7M12 3l4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/></svg>' +
    '</button>';
    /* v11.646: quick-follow the outlet straight from the card (+ ⇄ ✓). */
    var srcFollowed = isOutletFollowed(it.source);
    var followBtn = it.source
      ? '<button class="news-card-follow' + (srcFollowed ? ' is-following' : '') + '" type="button" aria-label="' + (srcFollowed ? 'Following ' : 'Follow ') + escA(it.source) + '" aria-pressed="' + (srcFollowed ? 'true' : 'false') + '" data-news-follow-src>' + (srcFollowed ? FOLLOW_CHECK_SVG : FOLLOW_PLUS_SVG) + '</button>'
      : '';
    /* v11.647: the source name is a button that opens the outlet's profile. */
    var sourceEl = it.source
      ? '<button type="button" class="news-card-source" data-news-source-link aria-label="View ' + escA(it.source) + '">' + outletAvatarHtml(it.source, 'news-avatar-xs') + '<span class="news-card-source-name">' + esc(it.source) + '</span></button>'
      : '';
    return '<article class="news-card" role="button" tabindex="0" data-news-url="' + escA(it.url) + '"' +
      ' data-news-id="' + escA(it.id || it.url || '') + '"' +
      ' data-news-provider-id="' + escA(it.providerId || it.providerArticleId || it.articleId || '') + '"' +
      ' data-news-event-id="' + escA(it.eventId || it.eventUri || it.storyId || '') + '"' +
      ' data-news-story-key="' + escA(it.storyKey || storyEventKey(it) || '') + '"' +
      ' data-news-title="' + escA(it.title || '') + '"' +
      ' data-news-source="' + escA(it.source || '') + '"' +
      ' data-news-image="' + escA(it.image || '') + '"' +
      ' data-news-media-type="' + escA(it.mediaType || (isVideo ? 'video' : '')) + '"' +
      ' data-news-video-aspect="' + escA(isVideo && aspect ? aspect.value : '') + '"' +
      ' data-news-video-orientation="' + escA(isVideo && aspect ? aspect.orientation : '') + '"' +
      ' data-news-video-aspect-source="' + escA(isVideo && it.videoAspectSource ? it.videoAspectSource : '') + '"' +
      ' data-news-video-aspect-probe="' + escA(isVideo && it.videoAspectProbeUrl ? it.videoAspectProbeUrl : '') + '"' +
      ' data-news-thumbnail-width="' + escA(isVideo && it.thumbnailWidth ? it.thumbnailWidth : '') + '"' +
      ' data-news-thumbnail-height="' + escA(isVideo && it.thumbnailHeight ? it.thumbnailHeight : '') + '"' +
      ' data-news-time="' + escA(timeLabel) + '"' +
      ' data-news-catlabel="' + escA(catLabel) + '"' +
      ' data-news-cat-key="' + escA(it.category || '') + '"' +
      ' data-news-topics="' + escA(topicsText) + '"' +
      ' data-news-summary="' + escA(it.summary || '') + '">' +
      '<div class="news-card-main">' +
        '<div class="news-card-meta">' +
          /* v11.709: category type (Movies, Music…) sits on its own line ABOVE the
             outlet's avatar + name + time. v11.721: actions wrapped so the identity
             column reliably claims the free width (no name truncation). */
          '<div class="news-card-id">' + cat + '<div class="news-card-idrow">' + sourceEl + time + '</div></div>' +
          '<div class="news-card-actions">' + followBtn + ((isVideo && vid) ? '' : heartBtn) + shareBtn + '</div>' +
        '</div>' +
        '<h3 class="news-card-title">' + esc(it.title || '') + '</h3>' +
        summary +
      '</div>' + media + engagement +
    '</article>';
  }
  function skeletonHtml() {
    var one = '<div class="news-skel"><div class="news-skel-main"><div class="news-skel-line short"></div><div class="news-skel-line"></div><div class="news-skel-line mid"></div></div><div class="news-skel-media"></div></div>';
    return one + one + one + one;
  }
  function spinnerHtml() { return '<span class="news-spinner" aria-hidden="true"></span>'; }

  /* ============================================================================
     v11.756: YouTube engagement (views / likes / comment count) + comments sheet
     for inline News Feed video cards. Stats are BATCH-fetched (≤50 ids per call,
     1 quota unit) and cached for the session; comments load lazily ONLY when the
     user opens the sheet. None of this external YouTube content is mixed into
     Shelfd's taste/ranking — it is display-only. */
  var COMMENT_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z"/></svg>';
  function formatCompactCount(n) {
    n = Number(n || 0);
    if (!isFinite(n) || n < 0) n = 0;
    if (n < 1000) return String(n);
    if (n < 1e6) { var k = n / 1e3; return (k < 10 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)) + 'K'; }
    if (n < 1e9) { var m = n / 1e6; return (m < 10 ? m.toFixed(1).replace(/\.0$/, '') : Math.round(m)) + 'M'; }
    var b = n / 1e9; return (b < 10 ? b.toFixed(1).replace(/\.0$/, '') : Math.round(b)) + 'B';
  }
  var _ytStatsCache = (typeof Map !== 'undefined') ? new Map() : null;     // videoId → {views, likes, comments}
  var _ytStatsInflight = (typeof Set !== 'undefined') ? new Set() : null;  // videoIds currently being fetched
  /* v11.773: COMMUNAL Shelfd likes. videoLikes/{videoId}.likes = [uid,…] in Firestore
     (mirrors the feed-like pattern; arrayUnion is idempotent → one like per account).
     Displayed likes = YouTube likes + Shelfd likers, recomputed at render so it
     self-corrects as YouTube's own count moves. */
  var _shelfdLikesCache = (typeof Map !== 'undefined') ? new Map() : null;   // videoId → {count, liked}
  var _shelfdLikesInflight = (typeof Set !== 'undefined') ? new Set() : null;
  function currentNewsUid() {
    try {
      if (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) return currentUser.uid;
      if (typeof userProfile !== 'undefined' && userProfile && userProfile.uid) return userProfile.uid;
    } catch (e) {}
    return '';
  }
  function shelfdVideoLikeInfo(vidId) { return (_shelfdLikesCache && _shelfdLikesCache.get(vidId)) || { count: 0, liked: false }; }
  /* Render an engagement row's numbers from BOTH caches (YouTube stats + Shelfd
     communal likes). Likes shown = YouTube + Shelfd. */
  function renderVideoEngagement(vidId) {
    var yt = (_ytStatsCache && _ytStatsCache.get(vidId)) || {};
    var shelfd = shelfdVideoLikeInfo(vidId);
    var likes = (yt.likes || 0) + (shelfd.count || 0);
    var views = yt.views || 0, comments = yt.comments || 0;
    var hasYt = !!(_ytStatsCache && _ytStatsCache.has(vidId));
    /* YouTube IDs are [A-Za-z0-9_-] only, so they're safe inside an attr selector. */
    var els = document.querySelectorAll('[data-news-engagement][data-news-video-id="' + vidId + '"]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var statsBox = el.querySelector('[data-news-stats]');
      if (statsBox) {
        /* v11.774: one inline stat row — likes · comments · views. The comment is a
           stat-styled button (glyph + number) that still opens the comment sheet;
           it's ALWAYS present (glyph-only when 0) so you can open comments anytime. */
        var parts = [];
        if (likes > 0) parts.push('<span class="news-ytc-stat">' + formatCompactCount(likes) + ' likes</span>');
        parts.push('<button type="button" class="news-ytc-stat news-ytc-commentstat" data-news-comments aria-label="View comments">' + COMMENT_SVG + (hasYt ? '<span>' + formatCompactCount(comments) + '</span>' : '') + '</button>');   // v11.775: always show the number once loaded (0 included); glyph-only until then
        if (views > 0) parts.push('<span class="news-ytc-stat">' + formatCompactCount(views) + ' views</span>');
        statsBox.innerHTML = parts.join('');
      }
      if (hasYt) el.setAttribute('data-news-stats-hydrated', '1');   // gate is for the YT fetch only
    }
  }
  /* Load communal Shelfd likes for the on-screen video cards (one Firestore read
     per uncached video; reads are public so this works logged-out too). */
  function hydrateShelfdVideoLikes() {
    if (!_shelfdLikesCache || typeof db === 'undefined' || !db) return;
    var rows = document.querySelectorAll('[data-news-engagement][data-news-video-id]');
    if (!rows.length) return;
    var uid = currentNewsUid(), seen = {};
    for (var i = 0; i < rows.length; i++) {
      var vidId = rows[i].getAttribute('data-news-video-id');
      if (!vidId || seen[vidId]) continue;
      seen[vidId] = 1;
      if (_shelfdLikesCache.has(vidId)) continue;                              // already loaded / optimistic
      if (_shelfdLikesInflight && _shelfdLikesInflight.has(vidId)) continue;
      if (_shelfdLikesInflight) _shelfdLikesInflight.add(vidId);
      (function (id) {
        db.collection('videoLikes').doc(id).get().then(function (snap) {
          var arr = (snap && snap.exists && snap.data() && Array.isArray(snap.data().likes)) ? snap.data().likes : [];
          if (!_shelfdLikesCache.has(id)) {                                    // don't clobber an optimistic tap
            _shelfdLikesCache.set(id, { count: arr.length, liked: !!(uid && arr.indexOf(uid) !== -1) });
            renderVideoEngagement(id);
          }
        }).catch(function () {}).then(function () { if (_shelfdLikesInflight) _shelfdLikesInflight.delete(id); });
      })(vidId);
    }
  }
  /* Toggle THIS user's communal like (Like + Save heart). Optimistic + persisted. */
  function toggleShelfdVideoLike(vidId, on) {
    if (!vidId) return;
    var uid = currentNewsUid();
    if (!uid || typeof db === 'undefined' || !db || typeof firebase === 'undefined' || !firebase) return;   // needs sign-in + Firestore
    var info = shelfdVideoLikeInfo(vidId);
    if (on === info.liked) return;                                            // no actual change
    if (_shelfdLikesCache) _shelfdLikesCache.set(vidId, { count: Math.max(0, (info.count || 0) + (on ? 1 : -1)), liked: on });
    renderVideoEngagement(vidId);                                            // optimistic +1 / -1 on every on-screen copy
    try {
      var FV = firebase.firestore.FieldValue;
      db.collection('videoLikes').doc(vidId).set({ likes: on ? FV.arrayUnion(uid) : FV.arrayRemove(uid) }, { merge: true }).catch(function () {});
    } catch (e) {}
  }
  function hydrateVideoEngagementStats() {
    if (!_ytStatsCache) return;
    try { hydrateShelfdVideoLikes(); } catch (e) {}   // v11.773: also load communal Shelfd likes (independent of YT stats)
    var rows = document.querySelectorAll('[data-news-engagement][data-news-video-id]:not([data-news-stats-hydrated])');
    if (!rows.length) return;
    var need = [], seen = {};
    for (var i = 0; i < rows.length; i++) {
      var vidId = rows[i].getAttribute('data-news-video-id');
      if (!vidId) { rows[i].setAttribute('data-news-stats-hydrated', '1'); continue; }
      renderVideoEngagement(vidId);   // v11.774: render now so the comment glyph is tappable immediately
      if (_ytStatsCache.has(vidId)) continue;
      if (seen[vidId] || (_ytStatsInflight && _ytStatsInflight.has(vidId))) continue;
      seen[vidId] = 1;
      need.push(vidId);
    }
    if (!need.length) return;
    /* Batch in chunks of 50 (the /api/youtube/videos limit) — one quota unit each.
       This is NOT per-card: every visible new id collapses into ≤1 request. */
    for (var c = 0; c < need.length; c += 50) {
      (function (chunk) {
        for (var j = 0; j < chunk.length; j++) { if (_ytStatsInflight) _ytStatsInflight.add(chunk[j]); }
        fetch('/api/youtube/videos?ids=' + encodeURIComponent(chunk.join(',')), { headers: { 'Accept': 'application/json' } })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            if (data && data.ok && Array.isArray(data.items)) {
              for (var k = 0; k < data.items.length; k++) {
                var it = data.items[k];
                if (!it || !it.videoId) continue;
                var stats = { views: Number(it.viewCount || 0), likes: Number(it.likeCount || 0), comments: Number(it.commentCount || 0) };
                _ytStatsCache.set(it.videoId, stats);
                renderVideoEngagement(it.videoId);
              }
            }
          })
          .catch(function () {})
          .then(function () { for (var j2 = 0; j2 < chunk.length; j2++) { if (_ytStatsInflight) _ytStatsInflight.delete(chunk[j2]); } });
      })(need.slice(c, c + 50));
    }
  }

  /* Gather a card's article meta from its data-* attributes. */
  function cardMeta(card) {
    return {
      url: card.getAttribute('data-news-url') || '',
      id: card.getAttribute('data-news-id') || '',
      providerId: card.getAttribute('data-news-provider-id') || '',
      eventId: card.getAttribute('data-news-event-id') || '',
      storyKey: card.getAttribute('data-news-story-key') || '',
      title: card.getAttribute('data-news-title') || '',
      source: card.getAttribute('data-news-source') || '',
      image: card.getAttribute('data-news-image') || '',
      mediaType: card.getAttribute('data-news-media-type') || '',
      videoAspectRatio: card.getAttribute('data-news-video-aspect') || '',
      videoOrientation: card.getAttribute('data-news-video-orientation') || '',
      videoAspectSource: card.getAttribute('data-news-video-aspect-source') || '',
      videoAspectProbeUrl: card.getAttribute('data-news-video-aspect-probe') || '',
      thumbnailWidth: card.getAttribute('data-news-thumbnail-width') || '',
      thumbnailHeight: card.getAttribute('data-news-thumbnail-height') || '',
      time: card.getAttribute('data-news-time') || '',
      category: card.getAttribute('data-news-catlabel') || '',
      catKey: card.getAttribute('data-news-cat-key') || '',
      topics: (card.getAttribute('data-news-topics') || '').split('|').map(function (s) { return s.trim(); }).filter(Boolean),
      summary: card.getAttribute('data-news-summary') || ''
    };
  }

  /* Open a tapped card. Prefer the in-app reader (js/43); if it isn't available
     for any reason, fall back to opening the source URL directly. */
  /* v11.651: YouTube trailers/videos play IN-APP in an embedded player — they do
     NOT redirect to YouTube. Other non-extractable social hosts still open at the
     source (no embeddable player). */
  function youtubeVideoId(url) {
    var u = String(url || '');
    var m = u.match(/[?&]v=([a-zA-Z0-9_-]{6,})/) ||
            u.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/) ||
            u.match(/youtube(?:-nocookie)?\.com\/(?:embed|shorts|v)\/([a-zA-Z0-9_-]{6,})/) ||
            u.match(/ytimg\.com\/vi\/([a-zA-Z0-9_-]{6,})\//);
    return m ? m[1] : '';
  }
  function isYouTubeUrl(url) { return /(?:\/\/|\.)(?:youtube\.com|youtu\.be|m\.youtube\.com)(?:[\/?]|$)/i.test(String(url || '')); }
  function isVideoUrl(url) {
    var s = String(url || '');
    return isYouTubeUrl(s) ||
      /(?:\/\/|\.)(?:tiktok\.com|vimeo\.com|streamable\.com)(?:[\/?]|$)/i.test(s) ||
      /\/videos?(?:\/|[?#]|$)/i.test(s);
  }
  function isShortsLikeUrl(url, title) { return /(?:youtube\.com\/shorts\/|youtu\.be\/shorts\/|\b#shorts\b|\bshorts\b)/i.test(String(url || '') + ' ' + String(title || '')); }
  function isExternalOnlyNewsUrl(url) {
    return /(?:\/\/|\.)(?:twitter\.com|x\.com|nitter\.|instagram\.com|reddit\.com|tiktok\.com)(?:[\/?]|$)/i.test(String(url || ''));
  }

  var _ytEl = null;
  function openNewsYouTube(id, meta) {
    if (!id) return;
    if (_ytEl) closeNewsYouTube(true);
    var title = (meta && meta.title) ? meta.title : '';
    var src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?autoplay=1&playsinline=1&rel=0&modestbranding=1';
    var root = document.createElement('div');
    root.className = 'news-yt-root';
    root.innerHTML =
      '<div class="news-yt-backdrop" data-news-yt-close></div>' +
      '<div class="news-yt-sheet" role="dialog" aria-modal="true" aria-label="' + escA(title || 'Video') + '">' +
        '<button type="button" class="news-yt-close" data-news-yt-close aria-label="Close">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button>' +
        '<div class="news-yt-frame"><iframe src="' + escA(src) + '" title="' + escA(title) + '" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen playsinline></iframe></div>' +
        (title ? '<div class="news-yt-title">' + esc(title) + '</div>' : '') +
      '</div>';
    document.body.appendChild(root);
    _ytEl = root;
    root.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('[data-news-yt-close]')) { e.preventDefault(); closeNewsYouTube(); }
    });
    root.__esc = function (e) { if (e.key === 'Escape') closeNewsYouTube(); };
    document.addEventListener('keydown', root.__esc);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { root.classList.add('is-open'); });
    else root.classList.add('is-open');
    try { document.documentElement.classList.add('news-manage-lock'); } catch (e) {}
    try { if (meta && meta.url) recordOpen(meta); } catch (e) {}        // mark watched
    try { if (meta) recordTaste(meta, 1.4); } catch (e) {}             // watching a trailer = interest
  }
  function closeNewsYouTube(immediate) {
    if (!_ytEl) return;
    var root = _ytEl; _ytEl = null;
    try { var f = root.querySelector('iframe'); if (f) f.src = 'about:blank'; } catch (e) {}   // stop playback
    root.classList.remove('is-open');
    try { if (root.__esc) document.removeEventListener('keydown', root.__esc); } catch (e) {}
    try { if (!_manageEl && !_outletEl) document.documentElement.classList.remove('news-manage-lock'); } catch (e) {}
    if (immediate) { try { if (root.parentNode) root.parentNode.removeChild(root); } catch (e) {} }
    else setTimeout(function () { try { if (root.parentNode) root.parentNode.removeChild(root); } catch (e) {} }, 280);
  }

  /* v11.654: trailers play INLINE — the card's own 16:9 media box becomes the
     player (thumbnail swaps to the embed in place, feed keeps scrolling around
     it). One inline player at a time; the ✕ restores the thumbnail. The overlay
     player is kept only as a fallback for cards with no media box. */
  /* ---------------------------------------------------------------------------
     v11.679: NEWS-FEED VIDEO PLAYBACK — unified mount + TikTok/IG-style SCROLL
     AUTOPLAY. Exactly ONE live <iframe> at a time, LAZILY created only when a card
     becomes the most-visible video and torn down the moment it leaves — so memory
     stays flat no matter how far you scroll. Autoplay is MUTED + playsinline (the
     only combo iOS allows). Tapping a card upgrades it to SOUND by mounting a fresh
     unmuted iframe (100% reliable, vs a flaky postMessage unmute). We never re-touch
     the card that is already active, so we never fight a user who paused; an ENGAGED
     (sound) card is kept until it scrolls mostly out of view, then stopped so audio
     never continues off-screen. Respects prefers-reduced-motion (tap still works). */
  var VIDEO_AUTOPLAY_IN = 0.62;    // activate when ≥62% of the 16:9 video box is in view
  var VIDEO_AUTOPLAY_OUT = 0.35;   // stop when it drops below 35% (hysteresis → no flapping)
  var SPEAKER_MUTED_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';
  var SPEAKER_ON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M16 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/></svg>';
  var videoObserver = null, videoRatios = null, videoVisBound = false;
  function videoAutoplayDisabled() {
    if (typeof IntersectionObserver === 'undefined') return true;
    try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true; } catch (e) {}
    return false;
  }
  /* ---- v11.706: TikTok-style SOUND-ON autoplay (capability-gated) ----
     WebKit blocks UNMUTED programmatic playback unless the native shell sets
     WKWebViewConfiguration.mediaTypesRequiringUserActionForPlayback = [] (one-line
     override in the iOS repo — see CustomViewController in shelfd-ios-public).
     Probe ONCE at boot with a tiny silent <audio>.play(): resolves → unmuted
     autoplay is allowed (native flag present) → feed videos autoplay WITH sound;
     rejects → browser policy active → today's muted autoplay is unchanged. The
     user keeps a STICKY device-level sound preference: muting any feed video
     turns sound-on-autoplay OFF until they unmute one again (Instagram behavior),
     persisted in localStorage. */
  var NEWS_SOUND_KEY = 'screenlist-news-sound-v1';
  var unmutedAutoplayOK = false;
  function newsSoundPrefOn() {
    try { return localStorage.getItem(NEWS_SOUND_KEY) !== '0'; } catch (e) { return true; }
  }
  function setNewsSoundPref(on) {
    try { localStorage.setItem(NEWS_SOUND_KEY, on ? '1' : '0'); } catch (e) {}
  }
  /* v11.708: reliable capability detection. Inside the Capacitor NATIVE app the
     iOS shell sets mediaTypesRequiringUserActionForPlayback = [], so unmuted
     autoplay IS permitted — that's the authoritative signal. The old silent-audio
     probe was unreliable (a data-URI decode hiccup in WKWebView read as "not
     allowed" and forced muted even with the flag set — the exact bug). The probe
     is now only a hint for NON-native contexts (desktop browser at myshelfd.com). */
  function isCapacitorNative() {
    try { return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()); }
    catch (e) { return false; }
  }
  function newsSoundCapable() { return isCapacitorNative() || unmutedAutoplayOK; }
  (function probeUnmutedAutoplay() {
    try {
      var a = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
      a.volume = 0.02;
      var p = a.play();
      if (p && typeof p.then === 'function') {
        p.then(function () { unmutedAutoplayOK = true; try { a.pause(); } catch (e) {} })
         .catch(function () { unmutedAutoplayOK = false; });
      }
    } catch (e) { unmutedAutoplayOK = false; }
  })();
  function newsVideoEmbedSrc(ytId, muted) {
    var origin = '';
    try { origin = '&origin=' + encodeURIComponent(location.origin || 'https://myshelfd.com'); } catch (e) {}
    var vid = encodeURIComponent(ytId);
    /* v11.727: CONTINUOUS LOOP — loop=1 + playlist=<same id> auto-replays the video
       the moment it finishes (single-video loop REQUIRES playlist = the video id).
       It only re-triggers on a NATURAL end, so the user hitting pause (controls=1)
       stops it = "loop until paused". A JS-API ENDED→playVideo fallback in
       bindYtMessageListener guarantees the replay even if the native loop misses. */
    return 'https://www.youtube-nocookie.com/embed/' + vid +
      '?playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&autoplay=1&loop=1&playlist=' + vid +
      '&enablejsapi=1' + origin + '&mute=' + (muted ? '1' : '0') + '&controls=1&fs=1';
  }
  function postInlineNewsVideoCommand(func) {
    try {
      var media = state.inlineVideoMedia;
      var frame = media && media.querySelector('iframe');
      if (!frame || !frame.contentWindow) return false;
      frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func: func, args: [] }), 'https://www.youtube-nocookie.com');
      return true;
    } catch (e) { return false; }
  }
  /* v11.707: hide YouTube's brief INIT CHROME flash (title / spinner / control
     bar that flickers for ~0.5s before controls=0 settles) on autoplay. We keep
     our own thumbnail as a COVER over the iframe and only fade it out once the
     player reports it is actually PLAYING — so the whole YT init happens BEHIND
     the poster, no flash. Signal = YT iframe postMessage onStateChange/infoDelivery
     playerState 1; a timeout fallback guarantees the poster never sticks. */
  var ytMsgBound = false;
  function revealActiveNewsVideo() {
    var media = state.inlineVideoMedia;
    if (!media) return;
    var cover = media.querySelector('[data-news-video-cover]');
    if (cover && !cover.classList.contains('is-hidden')) cover.classList.add('is-hidden');
  }
  /* v11.708: unmute an autoplaying video via the YT API. We ALWAYS start autoplay
     MUTED (muted autoplay is universally allowed → guaranteed to start), then —
     when sound is wanted + capable — ask the player to unMute. On the native build
     (flag set) this sticks → sound; elsewhere it's harmlessly ignored. Idempotent. */
  function applyAutoplayUnmute(media) {
    if (!media || state.inlineVideoMedia !== media) return false;
    if (!state.inlineVideoWantSound || !state.inlineVideoMuted) return false;
    if (!postInlineNewsVideoCommand('unMute')) return false;
    postInlineNewsVideoCommand('setVolume');   // best-effort restore to default volume
    state.inlineVideoMuted = false;
    updateInlineNewsVideoVolumeButton(media, false);
    return true;
  }
  /* v11.947: UNCONDITIONAL sound nudge — re-issues unMute on the active video even
     if we already believe it's unmuted. We now mount sound-on videos with mute=0
     from the first frame (see mountAutoplayVideo), so the state.inlineVideoMuted
     guard in applyAutoplayUnmute would short-circuit a real fallback. This covers
     the edge where a particular video/source ignored mute=0 at load and started
     silent anyway — every source ends up with sound, not just the fast-loading ones. */
  function nudgeActiveVideoSound(media) {
    if (!media || state.inlineVideoMedia !== media) return;
    if (!state.inlineVideoWantSound) return;
    postInlineNewsVideoCommand('unMute');
    postInlineNewsVideoCommand('playVideo');   // unmute can re-pause on some players → keep it rolling
    if (state.inlineVideoMuted) { state.inlineVideoMuted = false; updateInlineNewsVideoVolumeButton(media, false); }
  }
  function bindYtMessageListener() {
    if (ytMsgBound) return;
    ytMsgBound = true;
    window.addEventListener('message', function (e) {
      try {
        if (!/\/\/([a-z0-9.-]*\.)?youtube(?:-nocookie)?\.com$/i.test(e.origin || '')) return;
        var media = state.inlineVideoMedia;
        var frame = media && media.querySelector('iframe');
        if (!frame || e.source !== frame.contentWindow) return;
        var data = e.data;
        if (typeof data === 'string') { try { data = JSON.parse(data); } catch (_) { return; } }
        if (!data) return;
        if (data.event === 'onReady') applyAutoplayUnmute(media);   // earliest unmute point
        var st = (data.event === 'onStateChange') ? data.info
               : (data.event === 'infoDelivery' && data.info) ? data.info.playerState : undefined;
        if (st === 1) { revealActiveNewsVideo(); applyAutoplayUnmute(media); }   // 1 = PLAYING
        if (st === 0) { try { postInlineNewsVideoCommand('playVideo'); } catch (e) {} }   // v11.727: 0 = ENDED → replay (continuous loop; the user's pause is state 2, never replayed)
      } catch (_) {}
    });
  }
  function updateInlineNewsVideoVolumeButton(media, muted) {
    try {
      var btn = media && media.querySelector('[data-news-video-volume]');
      if (!btn) return;
      btn.classList.toggle('is-unmuted', !muted);
      btn.setAttribute('aria-label', muted ? 'Unmute video' : 'Mute video');
      btn.innerHTML = muted ? SPEAKER_MUTED_SVG : SPEAKER_ON_SVG;
    } catch (e) {}
  }
  function toggleInlineNewsVideoMute(card) {
    var media = card ? card.querySelector('.news-card-media-video') : state.inlineVideoMedia;
    if (!media || state.inlineVideoMedia !== media) return;
    var nextMuted = !state.inlineVideoMuted;
    if (!postInlineNewsVideoCommand(nextMuted ? 'mute' : 'unMute')) return;
    /* v11.706: STICKY sound preference (Instagram behavior) — muting any feed
       video turns sound-on-autoplay off for all future videos; unmuting any
       turns it back on. Only changes behavior when the native shell permits
       unmuted autoplay; otherwise it just remembers the choice. */
    setNewsSoundPref(!nextMuted);
    state.inlineVideoMuted = nextMuted;
    state.inlineVideoEngaged = !nextMuted;
    media.classList.toggle('is-autoplaying', nextMuted);
    updateInlineNewsVideoVolumeButton(media, nextMuted);
    if (!nextMuted) {
      postInlineNewsVideoCommand('playVideo');
      var meta = card ? cardMeta(card) : {};
      try { if (meta.url) recordOpen(meta); } catch (e) {}
      try { recordTaste(meta, 1.4); } catch (e) {}
      try { if (card) card.dataset.newsVideoEngaged = '1'; } catch (e) {}
    }
  }
  function stopInlineNewsVideo() {
    var m = state.inlineVideoMedia;
    state.inlineVideoMedia = null;
    state.inlineVideoCard = null;
    state.inlineVideoMuted = false;
    state.inlineVideoEngaged = false;
    state.inlineVideoWantSound = false;   // v11.708: clear pending auto-unmute intent
    if (!m) return;
    try { if (m.__coverTimer) { clearTimeout(m.__coverTimer); m.__coverTimer = null; } } catch (e) {}   // v11.707: cancel pending poster reveal
    try { var f = m.querySelector('iframe'); if (f) f.src = 'about:blank'; } catch (e) {}   // stop playback immediately
    try { m.classList.remove('is-playing', 'is-autoplaying'); if (m.__thumbHtml) m.innerHTML = m.__thumbHtml; } catch (e) {}
  }
  /* Mount a live player into a card's 16:9 media box. muted=true → silent scroll
     autoplay (no controls, tap-for-sound badge); muted=false → playback WITH
     sound. One player at a time.
     v11.706: `isAutoplay` separates HAS-SOUND from USER-ENGAGED. A sound-on
     AUTOPLAY (native flag + sticky pref) must still behave like an autoplay —
     hand off to the next most-visible video on scroll, and record NO taste/open
     signal (it's passive). Only the TAP path (isAutoplay=false) pins the video
     (engaged) and trains personalization. */
  function _mountNewsVideo(card, meta, ytId, muted, isAutoplay) {
    if (!card || !ytId) return;
    var media = card.querySelector('.news-card-media-video');
    if (!media) { if (!muted) openNewsYouTube(ytId, meta); return; }   // imageless card → overlay (tap only)
    applyYouTubeOriginalAspectToMedia(media, ytId);
    if (state.inlineVideoMedia === media && !!state.inlineVideoMuted === !!muted) {
      /* Tap on a video already autoplaying WITH sound → pin it (engaged) + record
         the same interest signal the unmute path uses (a real user gesture). */
      if (!isAutoplay && !muted && !state.inlineVideoEngaged) {
        state.inlineVideoEngaged = true;
        try { if (meta.url) recordOpen(meta); } catch (e) {}
        try { recordTaste(meta, 1.4); } catch (e) {}
        try { card.dataset.newsVideoEngaged = '1'; } catch (e) {}
      }
      return;
    }
    if (state.inlineVideoMedia === media) {
      toggleInlineNewsVideoMute(card);
      return;
    }
    stopInlineNewsVideo();                                             // one player at a time
    if (!media.__thumbHtml) media.__thumbHtml = media.innerHTML;       // restore the thumbnail on teardown
    /* v11.707: capture the poster image BEFORE swapping in the iframe — the cover
       reuses it so the fade is seamless (poster ≈ the video's first frame). */
    var coverImg = '';
    try { var ci0 = media.querySelector('img'); if (ci0) coverImg = ci0.currentSrc || ci0.src || ''; } catch (e) {}
    if (!coverImg) coverImg = 'https://i.ytimg.com/vi/' + encodeURIComponent(ytId) + '/hqdefault.jpg';
    media.classList.add('is-playing');
    media.classList.toggle('is-autoplaying', !!muted);
    media.innerHTML =
      '<iframe src="' + escA(newsVideoEmbedSrc(ytId, muted)) + '" title="' + escA(meta.title || '') + '" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write" allowfullscreen playsinline></iframe>' +
      '<div class="news-video-cover" data-news-video-cover aria-hidden="true"></div>' +
      '<button type="button" class="news-video-volume' + (muted ? '' : ' is-unmuted') + '" data-news-video-volume aria-label="' + (muted ? 'Unmute video' : 'Mute video') + '">' + (muted ? SPEAKER_MUTED_SVG : SPEAKER_ON_SVG) + '</button>';
    /* v11.707: poster cover + reveal-on-playing wiring. */
    try {
      var coverEl = media.querySelector('[data-news-video-cover]');
      if (coverEl) coverEl.style.backgroundImage = "url('" + String(coverImg).replace(/'/g, '%27') + "')";
      bindYtMessageListener();
      var vframe = media.querySelector('iframe');
      if (vframe) vframe.addEventListener('load', function () {
        try { vframe.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: ytId, channel: 'widget' }), '*'); } catch (e) {}
      });
      applyYouTubeOriginalAspectToMedia(media, ytId);
      if (media.__coverTimer) clearTimeout(media.__coverTimer);
      media.__coverTimer = setTimeout(function () { if (state.inlineVideoMedia === media) revealActiveNewsVideo(); }, 1400);   // fallback: never let the poster stick
    } catch (e) {}
    state.inlineVideoMedia = media;
    state.inlineVideoCard = card;
    state.inlineVideoMuted = !!muted;
    state.inlineVideoEngaged = !muted && !isAutoplay;
    if (!muted && !isAutoplay) {   // user engaged → record interest (same signal the old tap path used)
      try { if (meta.url) recordOpen(meta); } catch (e) {}
      try { recordTaste(meta, 1.4); } catch (e) {}
    }
  }
  function mountAutoplayVideo(card) {
    var meta = cardMeta(card);
    /* v11.947: mount sound-on videos UNMUTED from the first frame on any
       sound-capable build. The previous flow (v11.708) ALWAYS mounted muted and
       relied on a postMessage `unMute` after onReady — but that handshake
       intermittently missed its window for slower-loading videos/sources, leaving
       them autoplaying SILENTLY ("some sources don't autoplay with sound"). Mounting
       with mute=0 removes that dependency entirely → every source gets sound, not
       just the fast-loading ones. newsSoundCapable() is the AUTHORITATIVE signal
       (Capacitor native flag, or a confirmed audio probe on web) — NOT the old
       unreliable probe-as-gate. On a NON-capable build wantSound is false → we mount
       muted exactly as before (unmuted autoplay would be blocked there anyway).
       The nudges below are a belt-and-suspenders for any player that ignored
       mute=0 at load. */
    var wantSound = newsSoundPrefOn() && newsSoundCapable();
    _mountNewsVideo(card, meta, youtubeVideoId(meta.url), !wantSound, true);
    state.inlineVideoWantSound = wantSound;
    if (wantSound) {
      var media = state.inlineVideoMedia;
      applyAutoplayUnmute(media);                               // immediate (no-op if already unmuted at mount)
      [250, 600, 1200, 2200, 3400].forEach(function (d) {       // unconditional re-nudge: catch any source that started silent
        setTimeout(function () { nudgeActiveVideoSound(media); }, d);
      });
    }
  }
  /* Tap path (kept name + signature — called by openCardArticle) → SOUND playback. */
  function playNewsVideoInline(card, meta, ytId) {
    _mountNewsVideo(card, meta, ytId, false, false);
    try { if (card) card.dataset.newsVideoEngaged = '1'; } catch (e) {}
  }

  /* v11.710: public, narrow mount point for News Reader video pages. The reader
     supplies a media box, but the feed keeps owning the actual YouTube iframe,
     aspect handling, poster-cover reveal, and non-reloading volume toggle. */
  window.shelfdMountNewsInlineVideo = function (media, meta, opts) {
    meta = meta || {};
    opts = opts || {};
    var ytId = youtubeVideoId(meta.videoId || meta.url || '');
    if (!media || !ytId) return false;
    var attrMap = {
      'data-news-url': meta.url || '',
      'data-news-id': meta.id || '',
      'data-news-provider-id': meta.providerId || '',
      'data-news-event-id': meta.eventId || '',
      'data-news-title': meta.title || '',
      'data-news-source': meta.source || '',
      'data-news-image': meta.image || '',
      'data-news-media-type': meta.mediaType || 'video',
      'data-news-video-aspect': meta.videoAspectRatio || '',
      'data-news-video-orientation': meta.videoOrientation || '',
      'data-news-video-aspect-source': meta.videoAspectSource || '',
      'data-news-video-aspect-probe': meta.videoAspectProbeUrl || '',
      'data-news-thumbnail-width': meta.thumbnailWidth || '',
      'data-news-thumbnail-height': meta.thumbnailHeight || '',
      'data-news-time': meta.time || '',
      'data-news-catlabel': meta.category || '',
      'data-news-cat-key': meta.catKey || '',
      'data-news-topics': Array.isArray(meta.topics) ? meta.topics.join(' | ') : '',
      'data-news-summary': meta.summary || ''
    };
    var shimCard = {
      dataset: {},
      querySelector: function (sel) { return sel === '.news-card-media-video' ? media : media.querySelector(sel); },
      getAttribute: function (name) { return attrMap[name] || ''; }
    };
    media.__shelfdReaderVideoCard = shimCard;
    media.addEventListener('click', function (e) {
      var btn = e && e.target && e.target.closest ? e.target.closest('[data-news-video-volume]') : null;
      if (!btn || !media.contains(btn)) return;
      e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      toggleInlineNewsVideoMute(shimCard);
    });
    /* v11.947: same direct-unmuted mount as the feed. If the caller wants sound and
       the build is sound-capable, mount with mute=0 from frame 1 instead of mounting
       muted and chasing the unMute handshake (which silently failed for some
       sources). opts.muted===true still forces silent (explicit caller intent). */
    var readerWantSound = !!opts.wantSound && opts.muted !== false && newsSoundPrefOn() && newsSoundCapable();
    _mountNewsVideo(shimCard, meta, ytId, !readerWantSound, true);
    if (readerWantSound) {
      state.inlineVideoWantSound = true;
      applyAutoplayUnmute(media);
      [250, 600, 1200, 2200, 3400].forEach(function (d) {
        setTimeout(function () { nudgeActiveVideoSound(media); }, d);
      });
    }
    return true;
  };
  window.shelfdStopNewsInlineVideo = stopInlineNewsVideo;

  /* ---- viewport autoplay controller ---- */
  /* Debounce the MOUNT so fast scrolling doesn't spawn/kill an iframe for every
     video that flashes past — a video must stay most-visible for ~200ms before it
     autoplays (TikTok-style: flick past = nothing plays; settle = it plays). */
  var videoMountTimer = null, videoMountTarget = null;
  function cancelPendingAutoplay() {
    if (videoMountTimer) { clearTimeout(videoMountTimer); videoMountTimer = null; }
    videoMountTarget = null;
  }
  function scheduleAutoplay(media) {
    if (videoMountTarget === media && videoMountTimer) return;   // already counting down for this one
    cancelPendingAutoplay();
    videoMountTarget = media;
    videoMountTimer = setTimeout(function () {
      videoMountTimer = null; videoMountTarget = null;
      if (!media.isConnected || state.inlineVideoMedia === media) return;
      if (videoRatios && (videoRatios.get(media) || 0) < VIDEO_AUTOPLAY_IN) return;   // moved on
      var c = media.closest('.news-card[data-news-url]');
      if (!c || c.dataset.newsVideoDismissed === '1') return;
      mountAutoplayVideo(c);
    }, 200);
  }
  function pickActiveVideo() {
    if (videoAutoplayDisabled() || !videoRatios) return;
    var active = state.inlineVideoMedia;
    /* An ENGAGED (sound) video is the user's explicit choice — keep it until it
       scrolls mostly out of view, THEN stop it so audio never plays off-screen. */
    if (active && state.inlineVideoEngaged) {
      var ar = active.isConnected ? (videoRatios.get(active) || 0) : 0;
      if (ar >= VIDEO_AUTOPLAY_OUT) return;
      stopInlineNewsVideo();
      active = null;
    }
    /* Find the most-visible video the user hasn't dismissed. */
    var best = null, bestR = 0;
    videoRatios.forEach(function (r, media) {
      if (!media.isConnected || r <= bestR) return;
      var c = media.closest ? media.closest('.news-card[data-news-url]') : null;
      if (c && c.dataset.newsVideoDismissed === '1') return;   // user closed it — don't remount while in view
      bestR = r; best = media;
    });
    if (best && bestR >= VIDEO_AUTOPLAY_IN) {
      if (active === best) { cancelPendingAutoplay(); return; }   // already playing the most-visible
      scheduleAutoplay(best);                                     // debounced switch
      return;
    }
    /* Nothing is visible enough → cancel any pending mount + stop a muted autoplay
       that has dropped below OUT (engaged videos are handled above). */
    cancelPendingAutoplay();
    if (active && !state.inlineVideoEngaged) {
      var cr = active.isConnected ? (videoRatios.get(active) || 0) : 0;
      if (cr < VIDEO_AUTOPLAY_OUT) stopInlineNewsVideo();
    }
  }
  function onVideoIntersect(entries) {
    for (var i = 0; i < entries.length; i++) {
      var media = entries[i].target;
      var r = entries[i].isIntersecting ? entries[i].intersectionRatio : 0;
      if (videoRatios) videoRatios.set(media, r);
      if (r <= 0) {   // fully gone → allow autoplay again next time it returns
        var c = media.closest ? media.closest('.news-card[data-news-url]') : null;
        if (c && c.dataset.newsVideoDismissed === '1') delete c.dataset.newsVideoDismissed;
      }
    }
    pickActiveVideo();
  }
  function attachVideoAutoplayObserver() {
    try { hydrateVideoEngagementStats(); } catch (e) {}   // v11.756: fill in YT view/like/comment stats (independent of autoplay)
    if (videoAutoplayDisabled()) return;
    var list = q('[data-news-list]');
    if (!list) return;
    if (!videoRatios && typeof Map !== 'undefined') videoRatios = new Map();
    if (!videoObserver) {
      videoObserver = new IntersectionObserver(onVideoIntersect, { root: null, threshold: [0, 0.25, 0.4, 0.5, 0.62, 0.75, 0.9, 1] });
      /* v11.759: a brand-new observer (after resetVideoAutoplay on a render/switch) means
         the previous `data-news-vid-observed` stamps are stale. Clear them on the live list
         so EVERY video media gets re-observed. Without this, the v11.757 live-DOM cache
         re-attached cards still carrying their old stamp → the fresh observer found nothing
         to observe → autoplay stopped firing after a tab switch. */
      var stale = list.querySelectorAll('.news-card-media-video[data-news-vid-observed]');
      for (var s = 0; s < stale.length; s++) { try { delete stale[s].dataset.newsVidObserved; } catch (e) { try { stale[s].removeAttribute('data-news-vid-observed'); } catch (e2) {} } }
    }
    var medias = list.querySelectorAll('.news-card-media-video:not([data-news-vid-observed])');
    for (var i = 0; i < medias.length; i++) { medias[i].dataset.newsVidObserved = '1'; try { videoObserver.observe(medias[i]); } catch (e) {} }
    if (!videoVisBound) {
      videoVisBound = true;
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') { cancelPendingAutoplay(); stopInlineNewsVideo(); }   // free iframe + stop audio + cancel pending when backgrounded
        else pickActiveVideo();                                                                          // re-evaluate the most-visible on return
      });
    }
  }
  /* Full teardown for a fresh render / category switch: stop playback + forget all
     observed medias (the old card DOM is about to be discarded). */
  function resetVideoAutoplay() {
    cancelPendingAutoplay();
    stopInlineNewsVideo();
    if (videoObserver) { try { videoObserver.disconnect(); } catch (e) {} videoObserver = null; }
    if (videoRatios) { try { videoRatios.clear(); } catch (e) { videoRatios = (typeof Map !== 'undefined') ? new Map() : null; } }
  }

  function openCardArticle(card) {
    if (!card) return;
    markCardEngaged(card);
    var meta = cardMeta(card);
    if (!meta.url) return;
    /* v11.693: stamp consumed with the FULL card meta (provider/event/title keys,
       richer than recordOpen's url-only stamp) — covers every open kind below
       incl. inline trailer playback, so the exact item is hard-hidden for ~21d. */
    try { recordConsumed(meta, 'open'); } catch (e) {}
    var ytId = isYouTubeUrl(meta.url) ? youtubeVideoId(meta.url) : '';
    if (ytId) { playNewsVideoInline(card, meta, ytId); return; }        // trailers play INLINE
    if (isExternalOnlyNewsUrl(meta.url)) {
      try { recordOpen(meta); recordTaste(meta, 0.8); } catch (e) {}
      window.shelfdOpenNewsArticle(meta.url);
      return;
    }
    if (typeof window.openShelfdNewsReader === 'function') window.openShelfdNewsReader(meta);
    else {
      try { recordOpen(meta); recordTaste(meta, 0.8); } catch (e) {}
      window.shelfdOpenNewsArticle(meta.url);
    }
  }

  /* Share a card's article — opens the in-app "send to a friend" sheet (js/44),
     falling back to the native share sheet (js/43) if it isn't available. */
  function shareCardArticle(card) {
    if (!card) return;
    markCardEngaged(card);
    var meta = cardMeta(card);
    if (!meta.url) return;
    if (typeof window.openShelfdNewsShareSheet === 'function') window.openShelfdNewsShareSheet(meta);
    else if (typeof window.shelfdShareNewsArticle === 'function') window.shelfdShareNewsArticle(meta);
  }

  /* ---------- bookmark (heart) ---------- */
  function applyHeartState(btn, on) {
    if (!btn) return;
    btn.classList.toggle('is-bookmarked', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function popHeart(btn) {
    if (!btn) return;
    btn.classList.remove('heart-pop');
    void btn.offsetWidth;                 // restart the animation on rapid taps
    btn.classList.add('heart-pop');
    setTimeout(function () { btn.classList.remove('heart-pop'); }, 480);
  }
  /* Toggle a card's bookmark. Persists, updates EVERY on-screen instance of the
     same article (the feed recycles cards), and pops only the tapped heart. */
  /* v11.677: push the given heart state onto EVERY on-screen card for this article
     url (the feed recycles cards, AND the in-app reader can toggle the same
     article). Extracted from toggleCardBookmark so the reader's heart reuses the
     exact same sync via the global API below. */
  function syncCardHeartState(url, on) {
    if (!url) return;
    var list = q('[data-news-list]');
    if (!list) return;
    var cards = list.querySelectorAll('.news-card[data-news-url]');
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].getAttribute('data-news-url') === url) {
        var h = cards[i].querySelector('[data-news-heart]');
        if (h) applyHeartState(h, on);
      }
    }
  }
  function toggleCardBookmark(heartBtn) {
    if (!heartBtn) return;
    var card = heartBtn.closest('.news-card[data-news-url]');
    if (!card) return;
    markCardEngaged(card);
    var url = card.getAttribute('data-news-url');
    if (!url) return;
    var on = toggleBookmark(url);
    var meta = cardMeta(card);
    if (on) recordTaste(meta, 3);             // hearting is a STRONG taste signal (UNCHANGED — likes still train taste)
    /* v11.693: like ⇒ hard-hide the exact article ~30d; un-like ⇒ lift only the
       like stamp (a still-opened/shared copy stays suppressed). */
    try { if (on) recordConsumed(meta, 'like'); else unrecordConsumed(meta, 'like'); } catch (e) {}
    syncCardHeartState(url, on);              // updates every on-screen instance (incl. this one)
    /* v11.773: on VIDEO cards the heart is Like + Save — also toggle the communal
       like so this account adds to / removes from the count everyone sees. */
    var engEl = card.querySelector('[data-news-engagement][data-news-video-id]');
    if (engEl) { var likeVid = engEl.getAttribute('data-news-video-id'); if (likeVid) toggleShelfdVideoLike(likeVid, on); }
    if (on) popHeart(heartBtn);               // red fill + pop only when turning ON
  }

  /* Shared news-card interaction delegation — used by the feed list AND the
     outlet-profile list. v11.647: tapping the source NAME opens that outlet's
     profile; the +/✓ still quick-follows; heart/share/open unchanged. */
  function onNewsCardClick(e) {
    var t = e.target, close = t && t.closest;
    var vUnmute = close ? t.closest('[data-news-video-volume]') : null;
    if (vUnmute) {   // tap the muted-autoplay speaker → upgrade to sound (v11.679)
      e.preventDefault(); e.stopPropagation();
      toggleInlineNewsVideoMute(vUnmute.closest('.news-card[data-news-url]'));
      return;
    }
    var vClose = null;
    if (vClose) {   // close → stop + mark dismissed so scroll-autoplay doesn't immediately remount it (v11.679)
      e.preventDefault(); e.stopPropagation();
      var dc = vClose.closest('.news-card[data-news-url]');
      if (dc) dc.dataset.newsVideoDismissed = '1';
      stopInlineNewsVideo();
      return;
    }
    var followSrc = close ? t.closest('[data-news-follow-src]') : null;
    if (followSrc) { e.preventDefault(); e.stopPropagation(); toggleCardFollow(followSrc); return; }
    var srcLink = close ? t.closest('[data-news-source-link]') : null;
    if (srcLink) {
      e.preventDefault(); e.stopPropagation();
      var sc = srcLink.closest('.news-card[data-news-source]');
      if (sc) openOutletProfile(sc.getAttribute('data-news-source'));
      return;
    }
    var heartBtn = close ? t.closest('[data-news-heart]') : null;
    if (heartBtn) { e.preventDefault(); e.stopPropagation(); toggleCardBookmark(heartBtn); return; }
    var shareBtn = close ? t.closest('[data-news-share]') : null;
    if (shareBtn) { e.preventDefault(); e.stopPropagation(); shareCardArticle(shareBtn.closest('.news-card[data-news-url]')); return; }
    var commentsBtn = close ? t.closest('[data-news-comments]') : null;   // v11.756: open YouTube comments sheet
    if (commentsBtn) { e.preventDefault(); e.stopPropagation(); openCardComments(commentsBtn.closest('.news-card[data-news-url]')); return; }
    var card = close ? t.closest('.news-card[data-news-url]') : null;
    if (card) openCardArticle(card);
  }
  function onNewsCardKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var t = e.target, close = t && t.closest;
    var vUnmute = close ? t.closest('[data-news-video-volume]') : null;
    if (vUnmute) { e.preventDefault(); toggleInlineNewsVideoMute(vUnmute.closest('.news-card[data-news-url]')); return; }
    var vClose = null;
    if (vClose) { e.preventDefault(); var dc = vClose.closest('.news-card[data-news-url]'); if (dc) dc.dataset.newsVideoDismissed = '1'; stopInlineNewsVideo(); return; }
    var followSrc = close ? t.closest('[data-news-follow-src]') : null;
    if (followSrc) { e.preventDefault(); toggleCardFollow(followSrc); return; }
    var srcLink = close ? t.closest('[data-news-source-link]') : null;
    if (srcLink) { e.preventDefault(); var sc = srcLink.closest('.news-card[data-news-source]'); if (sc) openOutletProfile(sc.getAttribute('data-news-source')); return; }
    var heartBtn = close ? t.closest('[data-news-heart]') : null;
    if (heartBtn) { e.preventDefault(); toggleCardBookmark(heartBtn); return; }
    var shareBtn = close ? t.closest('[data-news-share]') : null;
    if (shareBtn) { e.preventDefault(); shareCardArticle(shareBtn.closest('.news-card[data-news-url]')); return; }
    var commentsBtn = close ? t.closest('[data-news-comments]') : null;   // v11.756
    if (commentsBtn) { e.preventDefault(); openCardComments(commentsBtn.closest('.news-card[data-news-url]')); return; }
    var card = close ? t.closest('.news-card[data-news-url]') : null;
    if (card) { e.preventDefault(); openCardArticle(card); }
  }

  /* ---------- shell ---------- */
  function buildShell() {
    var pane = getPane();
    if (!pane) return;
    var header = (typeof buildActivityFeedHeaderHTML === 'function') ? buildActivityFeedHeaderHTML('News') : '';
    var chips = NEWS_CHIPS.map(function (c) {
      return '<button type="button" class="news-chip' + (c.key === state.category ? ' active' : '') +
        '" data-news-cat="' + escA(c.key) + '" onclick="shelfdNewsSetCategory(\'' + escA(c.key) + '\')">' + esc(c.label) + '</button>';
    }).join('');
    pane.innerHTML = header +
      '<div class="news-feed">' +
        '<div class="news-ptr" data-news-ptr aria-hidden="true">' + spinnerHtml() + '</div>' +
        '<div class="news-feed-body" data-news-body>' +
          /* v11.648: the Tailor entry point now lives in the top-left header
             button (replacing the + on the News tab), so the chip row is just
             the category chips again. */
          '<div class="news-chips" data-news-chips>' + chips + '</div>' +
          '<div class="news-list" data-news-list></div>' +
          '<div class="news-sentinel" data-news-sentinel aria-hidden="true"></div>' +
          '<div class="news-foot" data-news-foot></div>' +
        '</div>' +
      '</div>';
    state.builtOnce = true;
    var listEl = q('[data-news-list]');
    if (listEl && !listEl.__newsClickBound) {
      listEl.__newsClickBound = true;
      listEl.addEventListener('click', onNewsCardClick);
      listEl.addEventListener('keydown', onNewsCardKeydown);
    }
    /* v11.700: hidden diag trigger — tap the ALREADY-ACTIVE chip 4× quickly to
       open the on-device NEWS DIAG panel. Only the active chip counts, so it never
       changes category (switchToCategory no-ops when cat===state.category). */
    var chipsEl = q('[data-news-chips]');
    if (chipsEl && !chipsEl.__newsDiagBound) {
      chipsEl.__newsDiagBound = true;
      var diagTaps = 0, diagLast = 0;
      chipsEl.addEventListener('click', function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('[data-news-cat]') : null;
        if (!btn || btn.getAttribute('data-news-cat') !== state.category) { diagTaps = 0; return; }
        var now = Date.now();
        diagTaps = (now - diagLast < 700) ? diagTaps + 1 : 1;
        diagLast = now;
        if (diagTaps >= 4) { diagTaps = 0; try { window.shelfdNewsDiag(); } catch (e) {} }
      });
    }
    attachObserver();
  }

  function setChipsActive() {
    var p = getPane(); if (!p) return;
    var chips = p.querySelectorAll('[data-news-cat]');
    for (var i = 0; i < chips.length; i++) chips[i].classList.toggle('active', chips[i].getAttribute('data-news-cat') === state.category);
  }

  /* ---------- render ---------- */
  function renderFirstPage() {
    var list = q('[data-news-list]');
    if (!list) { buildShell(); list = q('[data-news-list]'); if (!list) return; }
    resetVideoAutoplay();   // v11.679: a fresh render = new view → stop any playing video + drop stale observers
    if (!state.order.length) {
      if (state.category === 'following' && !state.loadingPool) {
        list.innerHTML = !followCount()
          ? '<div class="news-empty news-empty-following"><strong>Build your Following feed</strong><span>Follow outlets and topics — Marvel, a favourite game, IGN, Pitchfork — and only those posts show up here.</span><button type="button" class="news-empty-cta" onclick="shelfdNewsOpenManage()">Find outlets &amp; topics</button></div>'
          : '<div class="news-empty news-empty-following"><strong>Nothing new from your follows</strong><span>No recent posts matched who and what you follow. Add more, or check back soon.</span><button type="button" class="news-empty-cta" onclick="shelfdNewsOpenManage()">Manage following</button></div>';
        updateFoot();
        return;
      }
      list.innerHTML = state.loadingPool
        ? skeletonHtml()
        : (state.warming
            ? '<div class="news-empty"><strong>Fetching the latest news…</strong><span>Pulling fresh headlines — this only takes a moment.</span></div>'
            : '<div class="news-empty"><strong>No news right now</strong><span>Fresh headlines from movies, TV, anime, games and music will show up here.</span></div>');
      updateFoot();
      return;
    }
    /* Pass 2: a fresh first-page render = a NEW scrolling session view. Build the
       first page through the same hard-dedup gate used by append/load-more; slicing
       first and marking later can still render duplicates already inside the slice. */
    resetRenderedThisSession();
    var page = [];
    state.renderIndex = 0;
    while (page.length < PAGE_SIZE && state.renderIndex < state.order.length) {
      var firstIt = state.order[state.renderIndex++];
      if (!firstIt || isRenderedThisSession(firstIt)) continue;
      markRenderedThisSession(firstIt);
      page.push(firstIt);
    }
    /* v11.649: Following is finite — flag end-of-feed when the first page already
       covers the whole (small) followed set, so the foot shows "caught up". */
    state.exhausted = (state.category === 'following' && state.renderIndex >= state.order.length);
    list.innerHTML = page.map(cardHtml).join('');
    updateFoot();
    attachObserver();   // re-arm infinite scroll after a fresh render
    attachImpressionObserver();
    attachVideoAutoplayObserver();   // v11.679: arm scroll-autoplay on the new video cards
  }

  function maybeBgRefresh() {
    if (state.bgRefreshing) return;
    if (Date.now() - state.poolLoadedAt > BG_REFRESH_MS) {
      state.bgRefreshing = true;
      loadPool({ silent: true, onDone: function () { state.bgRefreshing = false; } });
    }
  }

  /* Returns up to PAGE_SIZE unique items, recycling (reshuffling) only to find
     not-yet-rendered articles. Once every hard identity in the pool has appeared
     during this scroll session, it returns short/empty instead of repeating. */
  /* Pass 2: drop exact-duplicate articles from a fetched/cached pool using the
     same hard identity keys as the rendered-session gate. The server dedupes too,
     but cached client pools, silent refreshes, and provider overlap still need a
     local pre-render guard. */
  /* v11.946: client-side HARD political mirror of the worker NEWS_POLITICAL_HARD_BLOCK.
     The server already strips political items on read, but the client keeps a ~90s
     in-memory pool (v11.702) that could otherwise briefly show pre-deploy political
     cards — and this guards any path that ever skipped the server filter. Mandate:
     NOTHING political / no Trump / no political figures EVER renders. Same
     entertainment-safe term list (bare "president" omitted so studio execs survive). */
  var NEWS_POLITICAL_HARD_BLOCK = [
    /\b(donald\s+trump|\btrump\b|melania|ivanka|trump\s+jr\.?|joe\s+biden|\bbiden\b|hunter\s+biden|kamala(?:\s+harris)?|barack\s+obama|\bobama\b|michelle\s+obama|hillary\s+clinton|bill\s+clinton|\bclinton\b|mike\s+pence|\bpence\b|ron\s+desantis|\bdesantis\b|nikki\s+haley|vivek\s+ramaswamy|jd\s+vance|nancy\s+pelosi|\bpelosi\b|chuck\s+schumer|\bschumer\b|mitch\s+mcconnell|\bmcconnell\b|kevin\s+mccarthy|bernie\s+sanders|elizabeth\s+warren|ted\s+cruz|marco\s+rubio|josh\s+hawley|matt\s+gaetz|marjorie\s+taylor\s+greene|alexandria\s+ocasio[\s-]?cortez|\baoc\b)\b/i,
    /\b(vladimir\s+putin|\bputin\b|volodymyr\s+zelensky+|\bzelensky+\b|xi\s+jinping|benjamin\s+netanyahu|\bnetanyahu\b|narendra\s+modi|emmanuel\s+macron|\bmacron\b|kim\s+jong[\s-]?un|recep\s+tayyip\s+erdo(?:g|ğ)an|\berdo(?:g|ğ)an\b|nicol[aá]s\s+maduro|\bmaduro\b|jair\s+bolsonaro|\bbolsonaro\b|javier\s+milei|keir\s+starmer|rishi\s+sunak|boris\s+johnson|justin\s+trudeau|\btrudeau\b)\b/i,
    /\b(election|elections|electoral|ballot|ballots|voter|voters|voting|midterms?|primary\s+election|caucus|polling\s+(?:station|place)|swing\s+state|electorate)\b/i,
    /\b(presidential|presidency|president[\s-]?elect|u\.?s\.?\s+president|former\s+president|white\s+house|oval\s+office|prime\s+minister|the\s+senate|senator|senators|congress(?:ional)?|house\s+of\s+representatives|parliament(?:ary)?|attorney\s+general)\b/i,
    /\b(republican\s+party|republicans|democratic\s+party|democrats\b|\bgop\b|\bmaga\b|left[\s-]?wing|right[\s-]?wing|bipartisan|partisan|far[\s-]?right|far[\s-]?left)\b/i,
    /\b(impeach(?:ment|ed)?|filibuster|executive\s+order|supreme\s+court|\bscotus\b|justice\s+department|\bdoj\b|tariffs?|economic\s+sanctions|immigration\s+policy|border\s+policy|deportations?|campaign\s+trail|running\s+mate|inauguration|capitol\s+riot|january\s+6(?:th)?)\b/i
  ];
  function newsIsPolitical(it) {
    if (!it) return false;
    var text = [it.title, it.summary, it.source, (Array.isArray(it.topics) ? it.topics.join(' ') : '')].filter(Boolean).join(' ');
    for (var p = 0; p < NEWS_POLITICAL_HARD_BLOCK.length; p++) { if (NEWS_POLITICAL_HARD_BLOCK[p].test(text)) return true; }
    return false;
  }

  function dedupePool(items) {
    if (!Array.isArray(items)) return [];
    var seen = {}, out = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i]; if (!it) continue;
      if (newsIsPolitical(it)) continue;   // v11.946: hard political block (mirror of worker)
      var keys = articleHardKeys(it);
      var duplicate = false;
      for (var k = 0; k < keys.length; k++) {
        if (seen[keys[k]]) { duplicate = true; break; }
      }
      if (duplicate) continue;
      for (var j = 0; j < keys.length; j++) seen[keys[j]] = 1;
      out.push(it);
    }
    return out;
  }

  /* ---------- v11.659 (Pass 2): HARD per-session de-duplication ---------------
     Rule: within ONE continuous scrolling session the EXACT SAME article must
     never render twice — not on a recycle/reshuffle, a "load more", or a folded-
     in background refresh. Each article carries several stable identity keys
     (canonical/normalized URL, worker id, provider article id, event/story id,
     source+title, exact title, and strong title/story signature);
     ANY shared key ⇒ the same post. Every key we place on screen is remembered
     in `state.renderedKeys`; `buildNextPage` skips anything already there BEFORE
     it is appended. This is a HARD gate, separate from the SOFT same-STORY
     spacing in markDuplicates (two genuinely different articles covering one
     story usually differ by title/signature and still get spaced naturally). The
     set resets on a fresh first-page render (cold load / pull-to-refresh /
     category switch) = a new session view. */
  function normUrlKey(u) {
    var s = String(u || '').trim();
    if (!s) return '';
    try {
      var url = new URL(s);
      var host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
      var path = decodeURIComponent(url.pathname || '/').toLowerCase();
      path = path.replace(/\/amp\/?$/i, '').replace(/\.amp$/i, '').replace(/\/index\.html?$/i, '').replace(/\/+$/, '');
      if (!path) path = '/';
      /* v11.705: YouTube watch URLs carry their IDENTITY in the query (?v=ID).
         Stripping the query collapsed EVERY youtube.com/watch URL into ONE key
         ('u:youtube.com/watch') — so dedupePool dropped all but the first video
         as a "duplicate", the rendered-session gate blocked the rest, and one
         consumed (liked/opened) video hard-hid ALL watch-URL videos for ~30 days.
         THIS was the narrow Marvel/Netflix/RT video mix. PROVEN on the live pool:
         buggy key → 311 items / 17 videos / 3 sources (the exact on-device
         CLIENT POOL); keeping ?v= → 499 / 205 / 17. */
      var vid = '';
      try { if (/(^|\.)youtube\.com$/.test(host)) vid = url.searchParams.get('v') || ''; } catch (e) {}
      if (vid) return 'u:' + host + path + '?v=' + vid.toLowerCase();
      return 'u:' + host + path;
    } catch (e) {
      var fb = s.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/^m\./, '');
      var fv = fb.match(/[?&]v=([a-z0-9_-]{6,})/);
      fb = fb.replace(/[?#].*$/, '').replace(/\/+$/, '');
      return 'u:' + fb + (fv ? '?v=' + fv[1] : '');
    }
  }
  function normalizedTitleText(value) {
    return String(value || '').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function normTitleSrcKey(item) {
    var t = normalizedTitleText((item && item.title) || '');
    if (!t || t.length < 6) return '';                 // too-short titles aren't a reliable identity
    var src = String((item && item.source) || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    return 'st:' + src + ':' + t;                      // same source + same title = the same article
  }
  /* v11.693: resolve a STABLE lowercase category key. A pool item carries the key
     ('movies'); a card's cardMeta carries the LABEL ('Movies') in .category but the
     key in .catKey. Normalising here makes the category-scoped tt:/sig: keys match
     between a liked card and its pool item (so consumed-suppression is exact). */
  function itemCatKey(item) {
    return String((item && (item.catKey || item.category)) || '_').toLowerCase();
  }
  function normTitleKey(item) {
    var t = normalizedTitleText((item && item.title) || '');
    if (!t || t.length < 16) return '';
    return 'tt:' + itemCatKey(item) + ':' + t;
  }
  function hardTitleSignature(item) {
    if (item && item._hardSig !== undefined) return item._hardSig;
    var title = normalizedTitleText((item && item.title) || '');
    if (!title) { if (item) item._hardSig = ''; return ''; }
    var words = title.split(/\s+/), seen = {}, uniq = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w.length < 4 || NEWS_STOPWORDS[w] || /^(news|report|reported|reportedly|says|said|reveals|revealed|announces|announced|exclusive|official|latest|video|watch)$/.test(w) || seen[w]) continue;
      seen[w] = 1; uniq.push(w);
    }
    uniq.sort(function (a, b) { return b.length - a.length || (a < b ? -1 : 1); });
    var sig = uniq.slice(0, 6).sort().join(' ');
    if (sig.split(' ').length < 4) sig = '';
    if (item) item._hardSig = sig;
    return sig;
  }

  var STORY_NUMBER_WORDS = {
    one: '1', first: '1',
    two: '2', second: '2',
    three: '3', third: '3',
    four: '4', fourth: '4',
    five: '5', fifth: '5',
    six: '6', sixth: '6',
    seven: '7', seventh: '7',
    eight: '8', eighth: '8',
    nine: '9', ninth: '9',
    ten: '10', tenth: '10'
  };
  var STORY_ENTITY_STOP = {
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
  function normalizeStoryText(value) {
    var s = String(value || '').toLowerCase();
    try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
    s = s.replace(/&amp;/g, ' and ').replace(/[’‘]/g, "'").replace(/'s\b/g, 's');
    s = s.replace(/\bs\s*(\d{1,2})\b/g, ' season $1 ');
    s = s.replace(/\bseason\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/g, function (_, n) { return 'season ' + STORY_NUMBER_WORDS[n]; });
    s = s.replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+season\b/g, function (_, n) { return 'season ' + STORY_NUMBER_WORDS[n]; });
    s = s.replace(/\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/g, 'season $1');
    return s.replace(/[^a-z0-9+&]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function storyEventKind(item) {
    var cat = itemCatKey(item);
    var title = normalizeStoryText(String((item && item.title) || ''));
    var combined = normalizeStoryText(String((item && item.title) || '') + ' ' + String((item && item.summary) || ''));
    function match(text) {
      if (!text) return '';
      if (/\b(trailer|teaser|first look|sneak peek|featurette|opening titles|official pv|\bpv\b)\b/.test(text)) return 'trailer';
      if (/\b(release date|premiere date|launch date|date announced|premieres on|premieres in|arrives on|arrives in|coming to|coming out|out now|available now|hits theaters|hits theatres)\b/.test(text)) return 'release';
      if (/\b(cast|casting|casts|casted|joins the cast|join the cast|adds new cast|adds .* cast|new cast member|will play|set to star|to star as|reprises)\b/.test(text)) return 'casting';
      if (/\b(begins filming|starts filming|filming begins|begins production|starts production|production begins|shooting begins|wraps filming|wraps production)\b/.test(text)) return 'production';
      if (/\b(ending explained|explains .* ending|creator explains|showrunner explains|season finale explained|finale explained)\b/.test(text)) return 'explainer';
      if (/\b(review|reviews|recap|first reactions|reaction|verdict|hands on|impressions)\b/.test(text)) return 'review';
      if (/\b(box office|opening weekend|ticket sales|grosses|grossed|earns \$|passes \$|debuts? with)\b/.test(text)) return 'boxoffice';
      if (cat === 'games' && /\b(patch notes|hotfix|update|dlc|expansion|battle pass|roadmap|new mode|new map|nerf|buff|server maintenance)\b/.test(text)) return 'gameupdate';
      if (cat === 'music' && /\b(tour dates|world tour|on tour|concert|residency|festival|headliner|setlist)\b/.test(text)) return 'tour';
      if (cat === 'music' && /\b(new album|new single|new song|new track|music video|tracklist|debut album|drops album|releases album|announces album)\b/.test(text)) return 'musicrelease';
      if (/\b(cancelled|canceled|cancels|cancelled after|canceled after|will end|ending after|not returning|axed|scrapped)\b/.test(text)) return 'cancellation';
      if (/\b(renewed|renews|renewal|renewed for|greenlit|greenlights|ordered another season|ordered for season|gets another season|getting another season|gets (?:a )?season \d+|getting (?:a )?season \d+|lands (?:a )?season \d+|scores (?:a )?season \d+|returning for season \d+|returns for season \d+)\b/.test(text)) return 'renewal';
      return '';
    }
    return match(title) || (combined !== title ? match(combined) : '');
  }
  function storySeasonToken(text) {
    var s = normalizeStoryText(text);
    var m = s.match(/\bseason\s+(\d{1,2})\b/);
    if (m) return 's' + m[1];
    if (/\banother season\b|\bnew season\b|\bnext season\b/.test(s)) return 'next';
    return '';
  }
  function cleanStoryEntityCandidate(value) {
    var s = normalizeStoryText(value);
    s = s.replace(/\bseason\s+\d{1,2}\b/g, ' ');
    s = s.replace(/\b(?:another|new|next)\s+season\b/g, ' ');
    s = s.replace(/\b(?:apple tv|apple|apples|netflix|netflixs|hbo max|hbomax|hbo|hbos|max|disney\+|disney|disneys|hulu|hulus|prime video|amazon|amazons|paramount\+|paramount|paramounts|peacock|peacocks|fx|amc|crunchyroll|sony|sonys|microsoft|microsofts|nintendo|nintendos|playstation|xbox)\b/g, ' ');
    var words = s.split(/\s+/), out = [], seen = {};
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w || w.length < 2 || STORY_ENTITY_STOP[w] || seen[w]) continue;
      seen[w] = 1; out.push(w);
      if (out.length >= 6) break;
    }
    if (out.length < 2 && !(out.length === 1 && out[0].length >= 5)) return '';
    return out.join(' ');
  }
  function extractStoryEntity(item, kind) {
    var title = normalizeStoryText((item && item.title) || '');
    var topics = Array.isArray(item && item.topics) ? item.topics : [];
    for (var t = 0; t < topics.length; t++) {
      var topic = cleanStoryEntityCandidate(topics[t]);
      if (topic) return topic;
    }
    var patterns = [
      /\b(?:renews?|renewed|greenlights?|greenlit|orders?|ordered|gives|hands|scores?|lands?|gets?|getting|returns?|returning)\s+(.+?)\s+(?:for\s+)?(?:a\s+|another\s+|new\s+|next\s+)?season\s+\d+\b/,
      /\b(?:renews?|renewed|greenlights?|greenlit|orders?|ordered|gives|hands|scores?|lands?|gets?|getting|returns?|returning)\s+(.+?)\s+(?:for\s+)?(?:another|new|next)\s+season\b/,
      /^(.+?)\s+(?:is\s+)?(?:renewed|gets|getting|lands|scores|returns|returning|greenlit|canceled|cancelled|will end|ending after)\b/,
      /\b(?:season\s+\d+\s+of)\s+(.+?)\b(?:gets|getting|renewed|trailer|release|adds|begins|starts|review|explained|premiere|date)\b/
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = title.match(patterns[i]);
      if (m && m[1]) {
        var cleaned = cleanStoryEntityCandidate(m[1]);
        if (cleaned) return cleaned;
      }
    }
    var cut = title;
    var eventRe = kind === 'renewal'
      ? /\b(?:renewed|renews|renewal|greenlit|greenlights|gets|getting|lands|scores|returns|returning)\b/
      : kind === 'cancellation'
        ? /\b(?:cancelled|canceled|cancels|will end|ending after|not returning|axed|scrapped)\b/
        : /\b(?:trailer|teaser|release date|premiere date|cast|casting|joins|adds|filming|production|review|recap|explains|explained|box office|patch notes|update|dlc|tour|album|single|music video)\b/;
    var idx = cut.search(eventRe);
    if (idx > 0) cut = cut.slice(0, idx);
    return cleanStoryEntityCandidate(cut) || cleanStoryEntityCandidate(title);
  }
  function storyEventKey(item) {
    if (!item) return '';
    if (item.storyKey) return String(item.storyKey);
    if (item._storyEventKey !== undefined) return item._storyEventKey;
    var kind = storyEventKind(item);
    if (!kind) { item._storyEventKey = ''; return ''; }
    var entity = extractStoryEntity(item, kind);
    if (!entity) { item._storyEventKey = ''; return ''; }
    var season = storySeasonToken(String(item.title || '') + ' ' + String(item.summary || ''));
    item._storyEventKey = ['story', itemCatKey(item), kind, entity, season].filter(Boolean).join(':');
    return item._storyEventKey;
  }
  function addHardKey(keys, seen, key) {
    key = String(key || '').trim();
    if (!key || seen[key]) return;
    seen[key] = 1; keys.push(key);
  }
  /* Every stable identity key for an article (memoized). */
  function articleHardKeys(item) {
    if (!item) return [];
    if (item._hkeys) return item._hkeys;
    var keys = [], seen = {};
    var urls = [item.url, item.canonicalUrl, item.canonicalURL, item.finalUrl, item.resolvedUrl, item.originalUrl, item.link];
    for (var u = 0; u < urls.length; u++) {
      var nu = normUrlKey(urls[u]); if (nu) addHardKey(keys, seen, nu);
      try { var yt = youtubeVideoId(urls[u]); if (yt) addHardKey(keys, seen, 'yt:' + yt); } catch (e) {}
    }
    if (item.id) addHardKey(keys, seen, 'id:' + item.id);
    var providerIds = [item.providerId, item.providerArticleId, item.articleId, item.uri, item.guid];
    for (var p = 0; p < providerIds.length; p++) if (providerIds[p]) addHardKey(keys, seen, 'pid:' + providerIds[p]);
    var eventIds = [item.eventId, item.eventUri, item.storyId, item.storyUri];
    for (var ev = 0; ev < eventIds.length; ev++) if (eventIds[ev]) addHardKey(keys, seen, 'ev:' + eventIds[ev]);
    var sk = storyEventKey(item); if (sk) addHardKey(keys, seen, sk);
    var st = normTitleSrcKey(item); if (st) addHardKey(keys, seen, st);
    var tt = normTitleKey(item); if (tt) addHardKey(keys, seen, tt);
    var sig = hardTitleSignature(item); if (sig) addHardKey(keys, seen, 'sig:' + itemCatKey(item) + ':' + sig);
    item._hkeys = keys;
    return keys;
  }
  function isRenderedThisSession(item) {
    var keys = articleHardKeys(item), rk = state.renderedKeys || (state.renderedKeys = {});
    for (var i = 0; i < keys.length; i++) if (rk[keys[i]]) return true;
    return false;
  }
  function markRenderedThisSession(item) {
    var keys = articleHardKeys(item), rk = state.renderedKeys || (state.renderedKeys = {});
    for (var i = 0; i < keys.length; i++) rk[keys[i]] = 1;
  }
  function resetRenderedThisSession() { state.renderedKeys = {}; }
  function seedRenderedKeysFromDom() {
    var list = q('[data-news-list]'); if (!list) return;
    var cards = list.querySelectorAll('.news-card[data-news-url]');
    for (var i = 0; i < cards.length; i++) markRenderedThisSession(cardMeta(cards[i]));
  }

  function buildNextPage() {
    var page = [], guard = 0;
    /* v11.649: the Following feed is FINITE (a curated set) — it must NEVER
       recycle, or a small followed set repeats the same few posts to fill the
       page (the "appears twice" bug). Category feeds stay endless (recycle).
       v11.659 (Pass 2): the session-level `state.renderedKeys` HARD-dedup gate
       means a recycle/reshuffle can no longer re-surface a post the user already
       scrolled past this session. A recycle now only yields not-yet-shown items;
       once the whole pool has been seen the page comes back short and the feed
       quietly waits for fresh cron items instead of repeating. */
    var recycle = state.category !== 'following';
    while (page.length < PAGE_SIZE && state.pool.length && guard < PAGE_SIZE * 6) {
      guard++;
      if (state.renderIndex >= state.order.length) {
        if (!recycle) break;                          // finite feed: stop at the end
        state.order = buildFeedOrder(state.pool);      // new shuffle each cycle
        state.renderIndex = 0;
        maybeBgRefresh();                              // fold in new cron items for later
        if (!state.order.length) break;
      }
      var it = state.order[state.renderIndex++];
      if (!it) continue;
      if (isRenderedThisSession(it)) continue;         // HARD session dedup — never repeat a post
      markRenderedThisSession(it);
      page.push(it);
    }
    return page;
  }

  /* Keep the DOM bounded during endless scroll WITHOUT any scroll shift: drop
     the oldest off-screen cards from the top and grow a top spacer by exactly
     their height, so the document height — and the user's scroll position —
     never change. (No window.scrollBy that could fight iOS momentum scrolling.)
     The spacer is wiped on every fresh render (renderFirstPage resets innerHTML),
     so it never persists across category switch / refresh. */
  function pruneTop(list) {
    var first = list.firstElementChild;
    var hasSpacer = !!(first && first.className === 'news-prune-spacer');
    var cardCount = list.children.length - (hasSpacer ? 1 : 0);
    if (cardCount <= MAX_DOM_CARDS) return;
    var toRemove = Math.min(PRUNE_BATCH, cardCount - MAX_DOM_CARDS);
    if (toRemove <= 0) return;
    var spacer = hasSpacer ? first : null;
    if (!spacer) {
      spacer = document.createElement('div');
      spacer.className = 'news-prune-spacer';
      spacer.style.height = '0px';
      list.insertBefore(spacer, list.firstElementChild);
    }
    var removedH = 0;
    for (var i = 0; i < toRemove; i++) {
      var card = spacer.nextElementSibling;
      if (!card) break;
      /* v11.679: if a pruned card holds the live/observed video, stop it + forget it. */
      var pm = card.querySelector ? card.querySelector('.news-card-media-video') : null;
      if (pm) {
        if (state.inlineVideoMedia === pm) stopInlineNewsVideo();
        if (videoObserver) { try { videoObserver.unobserve(pm); } catch (e) {} }
        if (videoRatios) { try { videoRatios.delete(pm); } catch (e) {} }
      }
      removedH += card.offsetHeight || 0;
      list.removeChild(card);
    }
    if (removedH > 0) spacer.style.height = ((parseFloat(spacer.style.height) || 0) + removedH) + 'px';
  }

  function loadMore() {
    if (state.loadingMore || state.loadingPool || !state.order.length || state.exhausted) return;
    state.loadingMore = true;
    updateFoot();                                   // bottom spinner beat
    setTimeout(function () {
      var l = q('[data-news-list]');
      if (!l) { state.loadingMore = false; return; }
      seedRenderedKeysFromDom();
      var page = buildNextPage();
      if (page.length) {
        l.insertAdjacentHTML('beforeend', page.map(cardHtml).join(''));
        attachImpressionObserver();
        attachVideoAutoplayObserver();   // v11.679: arm scroll-autoplay on appended video cards
        pruneTop(l);
      }
      /* v11.649: finite Following feed reached its end → stop + show "caught up". */
      if (state.category === 'following' && state.renderIndex >= state.order.length) state.exhausted = true;
      state.loadingMore = false;
      updateFoot();
    }, MORE_SPINNER_MS);
  }

  function updateFoot() {
    var foot = q('[data-news-foot]'); if (!foot) return;
    if (state.loadingMore) { foot.innerHTML = '<div class="news-foot-load">' + spinnerHtml() + '</div>'; return; }
    if (state.exhausted && state.category === 'following' && state.order.length) {
      foot.innerHTML = '<div class="news-foot-done">You’re all caught up</div>';
      return;
    }
    foot.innerHTML = '';
  }

  /* Warm the OTHER categories' pools in the background so a category swipe slides
     in real content (the server pools are KV-cached, so these are cheap). */
  function prefetchCategories() {
    NEWS_CHIPS.forEach(function (c) {
      if (c.key === state.category || c.key === 'following' || state.poolCache[c.key]) return;
      fetch('/api/news?category=' + encodeURIComponent(c.key) + '&cursor=0&limit=' + POOL_LIMIT + '&_=' + Date.now(), { cache: 'no-store' })   // v11.700: fresh, never NSURLCache-stale
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var items = dedupePool((data && Array.isArray(data.items)) ? data.items : []);
          if (items.length) state.poolCache[c.key] = items;
        })
        .catch(function () {});
    });
  }

  /* ---------- v11.757: per-tab LIVE-DOM memory ----------
     Each News tab keeps its actual rendered cards alive. Leaving a tab DETACHES its
     cards into a cache (with the exact window scroll + paging state); returning
     RE-ATTACHES those same nodes and sets scroll ONCE — no re-render, no image
     reload, no reflow — so you land precisely where you were with zero snap. A tab
     that was never visited renders a single fresh page at the top. This replaces the
     v11.756 re-render-on-switch approach, which caused the screen to rebuild and snap. */
  function maxScrollY() {
    var d = document.documentElement, b = document.body;
    var h = Math.max(d ? d.scrollHeight : 0, b ? b.scrollHeight : 0);
    return Math.max(0, h - (window.innerHeight || (d && d.clientHeight) || 0));
  }
  function mountNodes(list, nodes) {
    while (list.firstChild) list.removeChild(list.firstChild);
    var frag = document.createDocumentFragment();   // batch — one insertion, one layout pass
    for (var i = 0; i < nodes.length; i++) if (nodes[i]) frag.appendChild(nodes[i]);
    list.appendChild(frag);
  }
  /* v11.758: re-attached cards can lose their decoded bitmap while detached; force
     the ones around the landing viewport to decode so the reveal isn't a blank/black
     flash before the images paint. */
  function decodeVisibleCards(list) {
    if (!list) return;
    try {
      var vh = window.innerHeight || 800;
      var imgs = list.querySelectorAll('img');
      var n = 0;
      for (var i = 0; i < imgs.length && n < 18; i++) {
        var img = imgs[i];
        var r = img.getBoundingClientRect();
        if (r.bottom > -vh * 0.5 && r.top < vh * 1.5) {
          n++;
          try { img.loading = 'eager'; if (typeof img.decode === 'function') img.decode().catch(function () {}); } catch (e) {}
        }
      }
    } catch (e) {}
  }
  /* Snapshot the tab we're leaving: detach its live cards + remember scroll/paging.
     Only real rendered content is cached — an empty/skeleton/loading tab (renderIndex 0)
     is skipped so it renders fresh next time. */
  function captureCurrentView() {
    var list = q('[data-news-list]');
    if (!list || !state.category) return;
    if (!state.renderIndex || !list.children.length) { delete state.viewCache[state.category]; return; }
    state.viewCache[state.category] = {
      nodes: Array.prototype.slice.call(list.children),
      y: scrollTopY(),
      renderIndex: state.renderIndex || 0,
      exhausted: !!state.exhausted,
      order: state.order,
      pool: state.pool
    };
  }

  /* Switch category. If the tab's rendered DOM is cached (or handed in via a swipe's
     prebuiltView), re-attach those exact nodes at their saved scroll — no re-render.
     Otherwise render one fresh page at the top. */
  function switchToCategory(cat, presetOrder, prebuiltView) {
    if (!cat || cat === state.category) return;
    resetVideoAutoplay();                 // stop any inline video before we detach the current tab
    captureCurrentView();                 // v11.757: save the tab we're LEAVING
    state.category = cat;
    state.warmRetries = 0;
    state.warming = false;
    setChipsActive();
    var view = prebuiltView || state.viewCache[cat] || null;   // v11.757: the tab we're ENTERING
    var pool = state.poolCache[cat];
    var list = q('[data-news-list]');
    if (view && view.nodes && view.nodes.length && list) {
      /* RE-ATTACH the exact cards we left — instant, no rebuild. */
      state.pool = (view.pool && view.pool.length) ? view.pool : (pool ? dedupePool(pool) : []);
      state.order = (view.order && view.order.length) ? view.order : categoryOrder(cat, state.pool, false);
      state.renderIndex = view.renderIndex || view.nodes.length;
      state.exhausted = !!view.exhausted;
      mountNodes(list, view.nodes);
      delete state.viewCache[cat];        // nodes are live again; the cache is rebuilt next time we leave
      updateFoot();
      attachObserver();
      attachImpressionObserver();
      attachVideoAutoplayObserver();
      try { window.scrollTo(0, Math.min(view.y || 0, maxScrollY())); } catch (e) {}   // single instant scroll set
      decodeVisibleCards(list);           // v11.758: warm the landing images so the reveal doesn't flash
      if (!state.loadingPool) loadPool({ silent: true });   // freshen the pool in the background (no re-render)
    } else if (pool && pool.length) {
      /* First visit (no cached DOM) — render one fresh page at the top. */
      state.pool = dedupePool(pool);
      state.poolCache[cat] = state.pool;
      state.poolLoadedAt = state.poolLoadedAt || Date.now();
      state.order = (presetOrder && presetOrder.length) ? dedupePool(presetOrder) : categoryOrder(cat, state.pool, false);
      state.renderIndex = 0;
      state.exhausted = false;
      try { window.scrollTo(0, 0); } catch (e) {}
      renderFirstPage();
      if (!state.loadingPool) loadPool({ silent: true });
    } else {
      state.pool = []; state.order = []; state.renderIndex = 0; state.exhausted = false;
      try { window.scrollTo(0, 0); } catch (e) {}
      loadPool({});                                          // skeleton, then render
    }
  }

  /* ---------- pool fetch ---------- */
  function loadPool(opts) {
    opts = opts || {};
    if (state.loadingPool) { if (opts.onDone) opts.onDone(); return; }
    state.loadingPool = true;
    if (!opts.silent && !state.order.length) renderFirstPage(); // skeleton
    var cat = state.category;
    /* v11.646: 'following' has no server pool — pull the full 'all' pool and
       filter to the user's followed outlets + topics client-side. */
    var fetchCat = (cat === 'following') ? 'all' : cat;
    var poolLimit = (cat === 'following') ? FOLLOWING_POOL_LIMIT : POOL_LIMIT;
    /* v11.700: ALWAYS fetch the live pool — never let the iOS WKWebView NSURLCache
       replay a stale /api/news. ROOT CAUSE of "new app build (v11.699) but Movies&TV
       still shows the old narrow video-source mix": the cold-load fetch used cache
       'default' and the endpoint was `public, max-age=120`, so the device served an
       /api/news cached BEFORE the studio/anime channels were added → the source-fair
       mixer ran on a stale, narrow pool. A unique cache-bust param makes every pool
       fetch a fresh URL (defeats NSURLCache + any edge cache); the in-memory poolCache
       still gives instant category swipes, so UX is unchanged. */
    var url = '/api/news?category=' + encodeURIComponent(fetchCat) + '&cursor=0&limit=' + poolLimit + '&_=' + Date.now();
    fetch(url, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (cat !== state.category) { state.loadingPool = false; if (opts.onDone) opts.onDone(); return; }
        var rawItems = dedupePool((data && Array.isArray(data.items)) ? data.items : []);
        var items = rawItems;
        if (cat === 'following') {
          state.followingRaw = rawItems;
          if (rawItems.length) state.poolCache.all = rawItems;   // keep the all-pool warm too
          items = applyFollowFilter(rawItems);
        }
        state.loadingPool = false;
        state.warming = !!(data && data.warming) && !rawItems.length;
        if (items.length) {
          state.pool = items;
          state.poolCache[cat] = items;          // cache for instant category swipes
          state.poolLoadedAt = Date.now();
          if (!opts.silent) {
            // reshuffle ONLY on a pull-to-refresh; a cold/first load builds once.
            if (opts.refresh) { try { delete state.viewCache[cat]; } catch (e) {} }   // v11.757: refresh rebuilds the feed → drop the stale cached DOM (next entry renders fresh at top)
            state.order = categoryOrder(cat, items, !!opts.refresh);
            state.renderIndex = 0;
            renderFirstPage();
          }
          if (!state.prefetched) { state.prefetched = true; setTimeout(prefetchCategories, 700); }
          /* v11.704: THIN-POOL SELF-HEAL v2. The v11.703 version had a flag bug:
             heal results carried `_heal:true`, which the guard excluded, so heals
             could never CHAIN — one thin retry and the session was stuck on the
             thin pool forever (proven on-device: CLIENT POOL stayed 294/4-src
             across builds while NETWORK was 489/17 — the pool loaded in a thin
             window and nothing ever upgraded the screen). v2:
               • thin pool → retry silently with backoff (5s/15s/45s, max 3,
                 counter resets on any rich load) — heals CAN chain now;
               • the moment a SILENT load (heal, 90s re-entry, bg refresh) flips
                 the pool thin→rich and the user is at the top of the feed,
                 REBUILD + RE-RENDER so the diverse mix actually reaches the
                 screen (silent loads previously updated state.pool but never the
                 visible order — the screen could stay narrow indefinitely);
               • scrolled-in users are never disturbed: the rich pool just waits
                 for their next pull-to-refresh / re-entry. */
          try {
            var vh = (cat === 'screen' || cat === 'all' || cat === 'games' || cat === 'anime');
            if (vh) {
              var vsrc = {};
              for (var hi = 0; hi < items.length; hi++) { var hit = items[hi]; if (hit && isVideoItem(hit)) vsrc[hit.source || '_'] = 1; }
              var vsCount = Object.keys(vsrc).length;
              var wasThin = !!state.poolWasThin;
              state.poolWasThin = vsCount < 6;
              if (vsCount >= 6) {
                state.healCount = 0;
                if (opts.silent && wasThin) {
                  var atTopH = (scrollTopY() < 240) && (state.renderIndex <= PAGE_SIZE + 6);
                  if (atTopH) { state.order = categoryOrder(cat, items, true); state.renderIndex = 0; renderFirstPage(); }
                }
              } else {
                state.healCount = (state.healCount || 0) + 1;
                if (state.healCount <= 3) {
                  var healDelay = [5000, 15000, 45000][state.healCount - 1] || 45000;
                  setTimeout(function () {
                    if (cat === state.category && !state.loadingPool) loadPool({ silent: true, _heal: true });
                  }, healDelay);
                }
              }
            }
          } catch (e) {}
        } else if (!opts.silent) {
          renderFirstPage();
        }
        if (opts.onDone) opts.onDone();
        if (state.warming && state.warmRetries < 4) {
          state.warmRetries++;
          setTimeout(function () { if (!state.pool.length && cat === state.category) loadPool({ refresh: true }); }, 3500);
        } else if (state.pool.length) {
          state.warmRetries = 0;
        }
      })
      .catch(function () {
        if (cat !== state.category) { state.loadingPool = false; if (opts.onDone) opts.onDone(); return; }
        state.loadingPool = false;
        if (!state.order.length) {
          var list = q('[data-news-list]');
          if (list) list.innerHTML = '<div class="news-empty"><strong>Couldn’t load news</strong><span>Check your connection and try again in a moment.</span></div>';
        }
        if (opts.onDone) opts.onDone();
      });
  }

  /* ---------- infinite-scroll observer ---------- */
  function attachObserver() {
    var sentinel = q('[data-news-sentinel]'); if (!sentinel) return;
    if (state.observer) { try { state.observer.disconnect(); } catch (e) {} }
    if (typeof IntersectionObserver === 'undefined') return;
    state.observer = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) if (entries[i].isIntersecting) loadMore();
    }, { root: null, rootMargin: '400px 0px', threshold: 0 });
    state.observer.observe(sentinel);
  }
  function isCardMostlyVisible(card) {
    try {
      var r = card.getBoundingClientRect();
      var vh = window.innerHeight || document.documentElement.clientHeight || 0;
      var visible = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      return visible >= Math.min(220, Math.max(120, r.height * 0.45));
    } catch (e) { return false; }
  }
  function markCardEngaged(card) {
    try { if (card) card.dataset.newsEngaged = '1'; } catch (e) {}
  }
  function recordCardImpression(card) {
    if (!card || card.dataset.newsImpressed === '1') return;
    card.dataset.newsImpressed = '1';
    /* v11.693: mark SEEN by the card's full precise-identity key set (not just
       data-news-id) so a scrolled-past story is recognised across provider/URL forms. */
    try { markSeenItem(cardMeta(card)); } catch (e) {}
    if (card.__newsIgnoreTimer) clearTimeout(card.__newsIgnoreTimer);
    card.__newsIgnoreTimer = setTimeout(function () {
      try {
        if (!card.isConnected || card.dataset.newsEngaged === '1' || card.dataset.newsIgnored === '1') return;
        if (!isCardMostlyVisible(card)) return;
        card.dataset.newsIgnored = '1';
        recordIgnore(cardMeta(card), 0.08);
      } catch (e) {}
    }, 4200);
  }
  function attachImpressionObserver() {
    var list = q('[data-news-list]');
    if (!list) return;
    if (typeof IntersectionObserver === 'undefined') {
      var fallbackCards = list.querySelectorAll('.news-card[data-news-id]:not([data-news-impressed])');
      for (var f = 0; f < fallbackCards.length; f++) recordCardImpression(fallbackCards[f]);
      return;
    }
    if (!state.impressionObserver) {
      state.impressionObserver = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          if (entry.isIntersecting && entry.intersectionRatio >= 0.55) {
            recordCardImpression(entry.target);
            try { state.impressionObserver.unobserve(entry.target); } catch (e) {}
          }
        }
      }, { root: null, rootMargin: '0px 0px -8% 0px', threshold: [0.55] });
    }
    var cards = list.querySelectorAll('.news-card[data-news-id]:not([data-news-observed])');
    for (var c = 0; c < cards.length; c++) {
      cards[c].dataset.newsObserved = '1';
      try { state.impressionObserver.observe(cards[c]); } catch (e) {}
    }
  }

  /* ---------- pull-to-refresh (document scrolls; gesture at window top) ---------- */
  function scrollTopY() {
    return window.scrollY || window.pageYOffset || (document.documentElement && document.documentElement.scrollTop) || 0;
  }
  function setPtr(pull, ready, refreshing) {
    var ptrEl = q('[data-news-ptr]'), bodyEl = q('[data-news-body]');
    if (!ptrEl || !bodyEl) return;
    var shown = refreshing ? PTR_REFRESH_OFFSET : Math.max(0, pull);
    var settling = (shown === 0) || refreshing;
    var trans = settling ? 'transform .3s cubic-bezier(.2,1,.3,1)' : 'none';
    bodyEl.style.transition = trans;
    ptrEl.style.transition = settling ? (trans + ', opacity .2s ease') : 'none';
    bodyEl.style.transform = shown > 0 ? ('translate3d(0,' + shown + 'px,0)') : '';
    ptrEl.style.transform = 'translate3d(0,' + Math.max(0, shown - PTR_SPINNER - 4) + 'px,0)';
    ptrEl.style.opacity = refreshing ? '1' : String(Math.min(1, Math.max(0, pull) / PTR_THRESHOLD));
    var spin = ptrEl.querySelector('.news-spinner');
    if (spin) {
      spin.classList.toggle('is-spinning', !!refreshing);
      spin.style.transform = refreshing ? '' : ('rotate(' + (Math.max(0, pull) * 3) + 'deg)');
    }
    ptrEl.classList.toggle('is-ready', !!ready && !refreshing);
  }
  function triggerRefresh() {
    if (state.refreshing) return;
    state.refreshing = true;
    setPtr(0, false, true);
    loadPool({ refresh: true, onDone: function () { state.refreshing = false; setPtr(0, false, false); } });
  }
  function ptrStart(e) {
    if (state.refreshing || !e.touches || e.touches.length !== 1) { ptr.armed = false; return; }
    if (scrollTopY() > 0) { ptr.armed = false; return; }
    ptr.startY = e.touches[0].clientY; ptr.startX = e.touches[0].clientX;
    ptr.armed = true; ptr.active = false; ptr.pull = 0;
  }
  function ptrMove(e) {
    if (sw.active) { ptr.armed = false; ptr.active = false; return; }   // the category swipe owns this gesture
    if (!ptr.armed || state.refreshing || !e.touches || !e.touches.length) return;
    var dy = e.touches[0].clientY - ptr.startY, dx = e.touches[0].clientX - ptr.startX;
    if (!ptr.active) {
      if (dy > 8 && dy > Math.abs(dx) * 1.2 && scrollTopY() <= 0) ptr.active = true;
      else if (dy < -4 || Math.abs(dx) > Math.abs(dy)) { ptr.armed = false; return; }
      else return;
    }
    if (scrollTopY() > 1) { ptr.armed = false; ptr.active = false; setPtr(0, false); return; }
    if (dy <= 0) { ptr.pull = 0; setPtr(0, false); return; }
    if (e.cancelable) e.preventDefault();
    ptr.pull = Math.min(140, dy * 0.55);
    setPtr(ptr.pull, ptr.pull >= PTR_THRESHOLD);
  }
  function ptrEnd() {
    if (!ptr.armed || !ptr.active) { ptr.armed = false; ptr.active = false; return; }
    var fire = ptr.pull >= PTR_THRESHOLD;
    ptr.armed = false; ptr.active = false;
    if (fire && !state.refreshing) triggerRefresh();
    else setPtr(0, false);
  }
  function bindPtr() {
    var pane = getPane();
    if (!pane || ptr.bound) return;
    ptr.bound = true;
    pane.addEventListener('touchstart', ptrStart, { passive: true });
    pane.addEventListener('touchmove', ptrMove, { passive: false });
    pane.addEventListener('touchend', ptrEnd, { passive: true });
    pane.addEventListener('touchcancel', ptrEnd, { passive: true });
  }

  /* ---------- horizontal "swipe anywhere" between categories ----------
     Mirrors the discovery-hub swipe (js/36): document-level finger tracking that
     engages ONLY on a clear horizontal intent (so taps + vertical scroll + PTR
     are never hijacked). The current card list slides out while the target
     category's list (real content from poolCache, or a skeleton) slides in;
     commits past a distance/velocity threshold or snaps back. Same physics +
     easeOutQuad glide as discovery. The chips use a filled-active state, so the
     active chip just moves on commit (no sliding underline to drive). */
  var SW_INTENT = 8, SW_RATIO = 1.3, SW_COMMIT_DIST = 0.3, SW_COMMIT_VEL = 0.4;
  var SW_EDGE_RESIST = 0.32, SW_SETTLE_MS = 520, SW_SETTLE_EASE = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
  var sw = {
    bound: false, deciding: false, active: false,
    startX: 0, startY: 0, lastX: 0, prevX: 0, lastT: 0, prevT: 0,
    width: 1, dir: 0, engageOffset: 0, pendingDx: 0, raf: 0,
    listEl: null, incoming: null, targetCat: null, incomingOrder: null,
    incomingView: null,   // v11.757: borrowed cached DOM for the target tab (returned to cache if not committed)
    pendingFinish: null   // the in-flight settle's finisher (idempotent) — for supersede/recovery
  };

  function newsCatKeys() { return NEWS_CHIPS.map(function (c) { return c.key; }); }
  function newsOverlayOpen() {
    return !!document.querySelector(
      '#news-reader, .mylist-media-review-page.is-open, #feed-post-page.is-open, ' +
      '.discover-media-profile-overlay, .game-media-profile-overlay, .profile-social-page-overlay'
    );
  }
  function newsSwipeUsable() {
    var pane = getPane();
    if (!pane) return false;
    var r = pane.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;     // sub-tab not visible
    if (!pane.querySelector('[data-news-list]')) return false;
    if (newsOverlayOpen()) return false;
    if (state.refreshing) return false;
    return true;
  }
  function setChipActiveByKey(cat) {
    var p = getPane(); if (!p) return;
    var chips = p.querySelectorAll('[data-news-cat]');
    for (var i = 0; i < chips.length; i++) chips[i].classList.toggle('active', chips[i].getAttribute('data-news-cat') === cat);
  }

  function swCancelFrame() { if (sw.raf) { cancelAnimationFrame(sw.raf); sw.raf = 0; } }
  function swRenderFrame() { sw.raf = 0; if (sw.active && sw.listEl) swApplyDrag(sw.pendingDx); }
  function swScheduleFrame() { if (!sw.raf) sw.raf = requestAnimationFrame(swRenderFrame); }

  function swBuildIncoming(targetCat, listRect) {
    /* v11.757: if the target tab has CACHED LIVE DOM, BORROW those exact cards into
       the preview (no re-render) and anchor the layer where the list will sit after
       restore (listDocTop − savedY, possibly above the viewport). The card at the
       saved offset then lines up 1:1 with the post-commit re-attach, so the slide
       reveals the user's real place — zero jump, zero rebuild. If not committed, the
       borrowed nodes are returned to the cache (see swReset). First visit → fresh
       first page at the top, exactly as before. */
    var view = state.viewCache[targetCat] || null;
    var hasView = !!(view && view.nodes && view.nodes.length);
    var prevY = hasView ? Math.max(0, view.y || 0) : 0;
    var layer = document.createElement('div');
    layer.className = 'news-swipe-incoming';
    var top = prevY > 0
      ? Math.round((listRect.top + scrollTopY()) - prevY)   // listDocTop − savedY (can be negative)
      : Math.max(0, Math.round(listRect.top));
    layer.style.cssText = 'position:fixed;top:' + top + 'px;left:0;right:0;bottom:0;margin:0;overflow:hidden;' +
      'z-index:5;will-change:transform;transition:none;pointer-events:none;background:#0E0E0E;';
    var inner = document.createElement('div');
    inner.className = 'news-list news-swipe-incoming-list';
    inner.style.width = Math.round(listRect.width) + 'px';
    inner.style.marginLeft = Math.round(listRect.left) + 'px';
    inner.style.boxSizing = 'border-box';
    sw.incomingOrder = null;
    sw.incomingView = null;
    if (hasView) {
      delete state.viewCache[targetCat];   // borrow — moved into the preview now, returned on cancel
      sw.incomingView = view;
      for (var k = 0; k < view.nodes.length; k++) if (view.nodes[k]) inner.appendChild(view.nodes[k]);
      sw.incomingOrder = view.order || null;
    } else {
      var cached = state.poolCache[targetCat];
      if (cached && cached.length) {
        var order = categoryOrder(targetCat, cached, false);   // PRESERVED order — no re-shuffle on swipe
        inner.innerHTML = order.slice(0, PAGE_SIZE).map(cardHtml).join('');
        sw.incomingOrder = order;
        var imgs = inner.querySelectorAll('img');
        for (var i = 0; i < imgs.length && i < 8; i++) {
          try { imgs[i].loading = 'eager'; if (typeof imgs[i].decode === 'function') imgs[i].decode().catch(function () {}); } catch (e) {}
        }
      } else {
        inner.innerHTML = skeletonHtml();
      }
    }
    layer.appendChild(inner);
    document.body.appendChild(layer);
    return layer;
  }

  function swBegin(firstDx) {
    sw.listEl = q('[data-news-list]');
    if (!sw.listEl) return false;
    var keys = newsCatKeys();
    var idx = keys.indexOf(state.category);
    if (idx < 0) return false;
    sw.width = window.innerWidth || document.documentElement.clientWidth || 1;
    sw.dir = firstDx < 0 ? 1 : -1;             // finger left → next ; right → prev
    var targetIdx = idx + sw.dir;
    var listRect = sw.listEl.getBoundingClientRect();
    document.body.classList.add('news-feed-swiping');
    sw.listEl.style.transition = 'none';
    sw.listEl.style.willChange = 'transform';
    if (targetIdx < 0 || targetIdx >= keys.length) {
      sw.targetCat = null; sw.incoming = null;  // at an end → rubber-band only
      return true;
    }
    sw.targetCat = keys[targetIdx];
    sw.incoming = swBuildIncoming(sw.targetCat, listRect);
    sw.incoming.style.transform = 'translate3d(' + (sw.dir * sw.width) + 'px,0,0)';
    void sw.incoming.offsetHeight;             // flush layout now → first frame is a pure composite
    return true;
  }

  function swApplyDrag(dx) {
    if (!sw.targetCat || !sw.incoming) {
      sw.listEl.style.transform = 'translate3d(' + (dx * SW_EDGE_RESIST) + 'px,0,0)';
      return;
    }
    sw.listEl.style.transform = 'translate3d(' + dx + 'px,0,0)';
    sw.incoming.style.transform = 'translate3d(' + (sw.dir * sw.width + dx) + 'px,0,0)';
  }

  /* v11.757: a borrowed-but-NOT-committed target view → hand its cards back to the
     cache so that tab keeps its exact place for next time. (commit nulls incomingView
     first, so this is a no-op on a successful switch — the cards are live in the list.) */
  function swReturnBorrowed() {
    if (sw.incomingView && sw.targetCat) { try { state.viewCache[sw.targetCat] = sw.incomingView; } catch (e) {} }
    sw.incomingView = null;
  }
  /* v11.758: reset the swipe WITHOUT a black flash. The full-screen list is held on its
     compositing layer (the swipe's will-change/backface) and parked at translate 0 while
     we drop the preview; the layer hints + `news-feed-swiping` class are cleared a couple
     of frames LATER, when the content is static — so the de-promotion repaint is invisible.
     Tearing the layer down in the SAME frame as the re-attach was the split-second blackout
     on WKWebView. Used by both commit and snap-back. */
  function swReset(listRef, incRef) {
    swReturnBorrowed();
    if (listRef) { try { listRef.style.transition = 'none'; listRef.style.transform = 'translate3d(0,0,0)'; } catch (e) {} }
    if (incRef) { try { incRef.remove(); } catch (e) {} }
    if (sw.incoming === incRef) sw.incoming = null;
    if (sw.listEl === listRef) sw.listEl = null;
    sw.targetCat = null; sw.incomingOrder = null; sw.pendingFinish = null;
    var lr = listRef;
    var cleanupLayer = function () {
      if (!lr) return;
      if (sw.active || sw.deciding || sw.pendingFinish) return;   // a new gesture owns the layer now — leave its hints alone
      try { lr.style.removeProperty('transform'); lr.style.removeProperty('transition'); lr.style.removeProperty('will-change'); } catch (e) {}
      document.body.classList.remove('news-feed-swiping');
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { requestAnimationFrame(cleanupLayer); });
    else cleanupLayer();
  }

  /* Complete any in-flight settle INSTANTLY (idempotent via its `done` latch) —
     supersede a prior swipe before a new one, or recover one stranded by a dropped
     transitionend (e.g. the WKWebView backgrounded mid-settle). */
  function swForceFinish() {
    var f = sw.pendingFinish;
    if (f) { sw.pendingFinish = null; try { f(); } catch (e) {} }
  }
  /* Remove any orphaned incoming layer + stuck swiping class/transform when idle,
     so a stranded swipe can never permanently disable the gesture. */
  function swSweepGhosts() {
    if (sw.pendingFinish) return;                  // a live settle owns the layer — don't yank it
    swReturnBorrowed();                            // v11.757: rescue any borrowed cached cards before nuking layers
    var nodes = document.querySelectorAll('.news-swipe-incoming');
    for (var i = 0; i < nodes.length; i++) { try { nodes[i].remove(); } catch (e) {} }
    if (document.body.classList.contains('news-feed-swiping')) {
      document.body.classList.remove('news-feed-swiping');
      var l = q('[data-news-list]');
      if (l) { try { l.style.removeProperty('transform'); l.style.removeProperty('transition'); l.style.removeProperty('will-change'); } catch (e) {} }
    }
    sw.incoming = null; sw.targetCat = null; sw.incomingOrder = null;
  }

  function swSettle() {
    swCancelFrame();
    var dx = (sw.lastX - sw.startX) - sw.engageOffset;
    var dt = Math.max(1, sw.lastT - sw.prevT);
    var velocity = (sw.lastX - sw.prevX) / dt;
    var movingToward = (sw.dir === 1 && velocity < 0) || (sw.dir === -1 && velocity > 0);
    var commit = !!sw.targetCat && !!sw.incoming && (
      Math.abs(dx) > sw.width * SW_COMMIT_DIST ||
      (Math.abs(velocity) > SW_COMMIT_VEL && movingToward)
    );
    var ease = 'transform ' + SW_SETTLE_MS + 'ms ' + SW_SETTLE_EASE;
    var listRef = sw.listEl, incRef = sw.incoming;
    if (commit) {
      var targetCat = sw.targetCat, presetOrder = sw.incomingOrder;
      setChipActiveByKey(targetCat);           // move the active chip during the slide
      listRef.style.transition = ease;
      incRef.style.transition = ease;
      listRef.style.transform = 'translate3d(' + (-sw.dir * sw.width) + 'px,0,0)';
      incRef.style.transform = 'translate3d(0,0,0)';
      var done = false;
      var finish = function () {
        if (done) return; done = true;
        /* v11.757: hand the BORROWED cached cards straight to switchToCategory, which
           re-attaches them into the real list at their saved scroll BEFORE we drop the
           preview layer — one synchronous paint, so the reveal is seamless (no rebuild,
           no reflow, no scroll snap). First visit (no borrowed view) → fresh top. */
        var view = sw.incomingView; sw.incomingView = null;   // consume so swReset won't return it to cache
        switchToCategory(targetCat, presetOrder, view);
        swReset(listRef, incRef);   // v11.758: layer-stable reveal (de-promotes later → no black flash)
      };
      sw.pendingFinish = finish;
      incRef.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, SW_SETTLE_MS + 80);
    } else {
      listRef.style.transition = ease;
      listRef.style.transform = 'translate3d(0,0,0)';
      if (incRef) {
        incRef.style.transition = ease;
        incRef.style.transform = 'translate3d(' + (sw.dir * sw.width) + 'px,0,0)';
      }
      var done2 = false;
      var finish2 = function () { if (done2) return; done2 = true; swReset(listRef, incRef); };
      sw.pendingFinish = finish2;
      listRef.addEventListener('transitionend', finish2, { once: true });
      setTimeout(finish2, SW_SETTLE_MS + 80);
      if (Math.abs(dx) < 1) requestAnimationFrame(function () { requestAnimationFrame(finish2); });
    }
  }

  function swOnStart(e) {
    if (sw.active || sw.deciding) return;
    swForceFinish();   // land/supersede any in-flight settle so the new gesture starts clean
    swSweepGhosts();   // clear any orphaned layer/class a stranded swipe could have left
    if (e.touches && e.touches.length > 1) return;
    if (!newsSwipeUsable()) return;
    var t = e.touches ? e.touches[0] : e;
    var pane = getPane();
    if (!pane || !t.target || !pane.contains(t.target)) return;         // touch must be on the news pane
    if (t.target.closest && t.target.closest('[data-news-chips]')) return;  // chips row scrolls itself
    sw.deciding = true; sw.active = false; sw.engageOffset = 0;
    sw.startX = sw.prevX = sw.lastX = t.clientX;
    sw.startY = t.clientY;
    sw.prevT = sw.lastT = (e.timeStamp || (typeof performance !== 'undefined' ? performance.now() : 0));
  }
  function swOnMove(e) {
    if (!sw.deciding && !sw.active) return;
    if (e.touches && e.touches.length > 1) { swCancel(); return; }
    var t = e.touches ? e.touches[0] : e;
    var cx = t.clientX, cy = t.clientY;
    var now = (e.timeStamp || (typeof performance !== 'undefined' ? performance.now() : 0));
    if (sw.deciding) {
      if (ptr.active) { sw.deciding = false; return; }   // pull-to-refresh already owns this touch
      var dx0 = cx - sw.startX, dy0 = cy - sw.startY;
      if (Math.abs(dx0) < SW_INTENT && Math.abs(dy0) < SW_INTENT) return;
      sw.deciding = false;
      if (Math.abs(dx0) <= Math.abs(dy0) * SW_RATIO) return;   // vertical → let it scroll / PTR
      sw.engageOffset = dx0;
      if (!swBegin(dx0)) return;
      sw.active = true;
    }
    if (sw.active) {
      if (e.cancelable) e.preventDefault();
      sw.prevX = sw.lastX; sw.prevT = sw.lastT;
      sw.lastX = cx; sw.lastT = now;
      sw.pendingDx = (cx - sw.startX) - sw.engageOffset;
      swScheduleFrame();
    }
  }
  function swOnEnd() {
    if (sw.active) { sw.active = false; sw.deciding = false; if (sw.listEl) swSettle(); }
    else { sw.deciding = false; }
  }
  function swCancel() {
    if (!sw.active) { sw.deciding = false; return; }
    sw.active = false; sw.deciding = false; swCancelFrame();
    if (sw.listEl) { sw.lastX = sw.startX; swSettle(); }  // force snap-back
  }
  function bindNewsSwipe() {
    if (sw.bound) return;
    sw.bound = true;
    document.addEventListener('touchstart', swOnStart, { passive: true });
    document.addEventListener('touchmove', swOnMove, { passive: false });
    document.addEventListener('touchend', swOnEnd, { passive: true });
    document.addEventListener('touchcancel', swCancel, { passive: true });
    /* If the WKWebView is backgrounded mid-swipe it can drop the settle's
       transitionend; on return, finish/clean up so nothing is left stranded. */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && !sw.active && !sw.deciding) { swForceFinish(); swSweepGhosts(); }
    });
  }

  /* ---------- public ---------- */
  /* ==========================================================================
     v11.646: FOLLOWING — tailor the feed. Users follow OUTLETS (sources, like
     accounts) and TOPICS (a franchise / character / game / console). The
     "Following" chip shows ONLY followed outlets + matching topics (strict),
     ranked by the same smart algorithm. Follows persist to localStorage AND
     (best-effort) the signed-in user's Firestore doc (newsFollows) so they
     sync across devices. The existing category chips stay as the "For You"
     browse. (Topic matching is alias-aware + word-boundary, on the article's
     title + summary + Event-Registry topics.)
     ========================================================================== */
  var FOLLOWS_KEY = 'screenlist-news-follows-v1';

  /* Browseable outlet directory (the worker's RSS sources). Any OTHER outlet
     (e.g. a provider-sourced one) is still followable straight from its card —
     this list is just what the Tailor sheet shows. */
  var NEWS_OUTLETS = [
    { group: 'Movies & TV', items: ['Variety', 'The Hollywood Reporter', 'Deadline', 'Collider', 'IndieWire', 'SlashFilm', 'FirstShowing', 'TVLine', 'CBR'] },
    { group: 'Anime', items: ['Anime News Network', 'Crunchyroll', 'MyAnimeList', 'ComicBook', 'Game Rant', 'Screen Rant', 'Otaku USA'] },
    { group: 'Games', items: ['IGN', 'GameSpot', 'Polygon', 'Video Games Chronicle', 'PC Gamer', 'Gematsu', 'Nintendo Life', 'PlayStation Blog', 'Xbox Wire', 'Steam News', 'Eurogamer', 'Kotaku'] },
    { group: 'Music', items: ['Pitchfork', 'Billboard', 'Rolling Stone', 'NME', 'Stereogum', 'Consequence'] },
    /* v11.664: YouTube channels — followable like any other outlet (following
       filters the feed by `item.source`). The first 9 flow in via the worker's
       NEWS_RSS_SOURCES Atom feeds; this group surfaces them in the Tailor sheet so
       users can follow trailer/news channels directly.
       v11.675: the 5 first-party game channels (Marvel Rivals / Valorant / Apex
       Legends / PUBG / Rockstar Games) flow in via the YouTube Data API cache (their
       Atom feeds are IP-blocked from our datacenter) — they were missing from this
       list, so users couldn't follow them; now added. Logos are already mapped in
       NEWS_OUTLET_DOMAINS, and following matches their `item.source` exactly.
       (Reddit subreddits are intentionally NOT here yet — the worker is IP-blocked
       from Reddit's feeds, so there'd be no content; deferred until a real fetch
       path is wired.) */
    { group: 'YouTube', items: ['Rotten Tomatoes', 'Marvel', 'Netflix', 'IGN', 'GameTrailers', 'PlayStation', 'Nintendo', 'GameSpot', 'Crunchyroll', 'Marvel Rivals', 'Valorant', 'Apex Legends', 'PUBG', 'Rockstar Games'] }
  ];

  /* Curated topic starters (tap to follow). Matching is alias-aware below. */
  var CURATED_TOPICS = [
    { group: 'Movies & TV', items: ['Marvel', 'DC', 'Star Wars', 'Spider-Man', 'Batman', 'The Lord of the Rings', 'Harry Potter', 'Dune', 'Avatar', 'James Bond', 'Stranger Things', 'Game of Thrones', 'The Mandalorian', 'A24', 'Pixar'] },
    { group: 'Anime', items: ['One Piece', 'Jujutsu Kaisen', 'Demon Slayer', 'Dragon Ball', 'Naruto', 'My Hero Academia', 'Chainsaw Man', 'Attack on Titan', 'Studio Ghibli', 'Pokémon', 'Bleach', 'Solo Leveling'] },
    { group: 'Games', items: ['PlayStation', 'Xbox', 'Nintendo Switch', 'The Legend of Zelda', 'Super Mario', 'Pokémon', 'Call of Duty', 'Grand Theft Auto', 'Elden Ring', 'Final Fantasy', 'Fortnite', 'Minecraft', 'Steam Deck'] },
    { group: 'Music', items: ['Taylor Swift', 'Drake', 'Kendrick Lamar', 'Beyoncé', 'Billie Eilish', 'The Weeknd', 'BTS', 'Kanye West', 'Olivia Rodrigo', 'Bad Bunny', 'SZA', 'Travis Scott'] }
  ];

  /* Common-usage aliases (keyed by the NORMALIZED topic) so a followed topic
     still matches differently-worded headlines. The topic's own name is always
     a needle; these add extras. Kept conservative to avoid false positives. */
  var TOPIC_ALIASES = {
    'spider man': ['spiderman'],
    'marvel': ['mcu'],
    'grand theft auto': ['gta'],
    'call of duty': ['cod'],
    'the legend of zelda': ['zelda'],
    'super mario': ['mario'],
    'playstation': ['ps5', 'ps4'],
    'nintendo switch': ['switch 2'],
    'the lord of the rings': ['lord of the rings', 'rings of power']
  };

  var FOLLOW_PLUS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  var FOLLOW_CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';

  /* v11.656: outlet logos ("profile pictures"). Each source → its domain; the
     logo is fetched at high resolution from icon.horse (returns the outlet's
     apple-touch-icon / largest favicon — far sharper than a 16px favicon).
     <img> onerror falls back to the initials avatar, so a dead/blocked logo
     never leaves a hole. Unmapped outlets just use initials. */
  var NEWS_OUTLET_DOMAINS = {
    'Variety': 'variety.com', 'The Hollywood Reporter': 'hollywoodreporter.com', 'Hollywood Reporter': 'hollywoodreporter.com',
    'Deadline': 'deadline.com', 'Collider': 'collider.com', 'IndieWire': 'indiewire.com', 'SlashFilm': 'slashfilm.com',
    '/Film': 'slashfilm.com', 'FirstShowing': 'firstshowing.net', 'TVLine': 'tvline.com', 'CBR': 'cbr.com',
    'The Wrap': 'thewrap.com', 'TheWrap': 'thewrap.com', 'Empire': 'empireonline.com', 'Rotten Tomatoes': 'rottentomatoes.com',
    'Anime News Network': 'animenewsnetwork.com', 'Crunchyroll': 'crunchyroll.com', 'MyAnimeList': 'myanimelist.net',
    'ComicBook': 'comicbook.com', 'ComicBook.com': 'comicbook.com', 'Game Rant': 'gamerant.com', 'Screen Rant': 'screenrant.com',
    'Otaku USA': 'otakuusamagazine.com', 'Anime Corner': 'animecorner.me', 'The Fandom Post': 'fandompost.com', 'Marvel': 'marvel.com',
    'IGN': 'ign.com', 'GameSpot': 'gamespot.com', 'Polygon': 'polygon.com', 'Video Games Chronicle': 'videogameschronicle.com',
    'PC Gamer': 'pcgamer.com', 'Gematsu': 'gematsu.com', 'Nintendo Life': 'nintendolife.com', 'Nintendo': 'nintendo.com',
    'PlayStation Blog': 'playstation.com', 'PlayStation': 'playstation.com', 'Xbox Wire': 'xbox.com', 'Steam News': 'store.steampowered.com',
    'Netflix': 'netflix.com', 'GameTrailers': 'youtube.com',  /* v11.664: YouTube-channel outlets */
    'Eurogamer': 'eurogamer.net', 'Kotaku': 'kotaku.com', 'GamesRadar+': 'gamesradar.com', 'GamesRadar': 'gamesradar.com',
    'Rock Paper Shotgun': 'rockpapershotgun.com', 'Engadget': 'engadget.com', 'The Verge': 'theverge.com',
    'Pitchfork': 'pitchfork.com', 'Billboard': 'billboard.com', 'Rolling Stone': 'rollingstone.com', 'NME': 'nme.com',
    'Stereogum': 'stereogum.com', 'Consequence': 'consequence.net', 'Consequence of Sound': 'consequence.net',
    'Spin': 'spin.com', 'Complex': 'complex.com', 'HipHopDX': 'hiphopdx.com', 'BrooklynVegan': 'brooklynvegan.com',
    'Soompi': 'soompi.com', 'Korea JoongAng Daily': 'koreajoongangdaily.com', 'Koreajoongangdaily.com': 'koreajoongangdaily.com', 'The Korea Herald': 'koreaherald.com', 'Korea Herald': 'koreaherald.com', 'Koreaherald.com': 'koreaherald.com',  /* v11.665: K-drama sources */
    'Rockstar Games': 'rockstargames.com', 'Marvel Rivals': 'marvelrivals.com', 'Valorant': 'playvalorant.com', 'Apex Legends': 'ea.com', 'PUBG': 'pubg.com'  /* v11.668: first-party game channels */
  };
  /* v11.725: DIRECT high-res logo overrides = the ACTUAL channel profile pictures
     (YouTube channel avatars at s800) for the new Music video outlets — far sharper
     than a favicon, and correct where no clean brand domain exists (The Breakfast
     Club) or the favicon is weak (XXL). Checked BEFORE the icon.horse domain
     fallback. Billboard/Pitchfork/Rolling Stone keep their existing logos. */
  var NEWS_OUTLET_LOGO_URLS = {
    'NPR Music': 'https://yt3.ggpht.com/IXJZjJSYR9kfnUcHwIzAYjunIfovC2QYOOAseZxrDHBwvCKQEHBNcdC6PmNxn8EALE357U3vvhE=s800-c-k-c0x00ffffff-no-rj',
    'Genius': 'https://yt3.ggpht.com/MqakHuFktIhFCdhHVU6t5a838FSm_UZfQjbI1I826lapHOHoEmviw7ghwNZBCgNdY_lvWQSplhE=s800-c-k-c0x00ffffff-no-rj',
    'COLORS': 'https://yt3.ggpht.com/ytc/AIdro_nFe5LeXpVm-ggGY9NH3JqYvVyU1NBcXHZ827U0JtoFa0M=s800-c-k-c0x00ffffff-no-rj',
    'Vevo': 'https://yt3.ggpht.com/sNDNiX3TszpV_w-z-DTAQcxTmeqJOeHWe8GfqVosRkAfAv6gbffagSgvcsXsi9rEmhM2ji9urTo=s800-c-k-c0x00ffffff-no-rj',
    'XXL': 'https://yt3.ggpht.com/ytc/AIdro_kbdD3Y_BHc-UXPEyc0jxTyVoPoLXn8q2UuK0VJQC8Bg_8=s800-c-k-c0x00ffffff-no-rj',
    'MTV': 'https://yt3.ggpht.com/IddRuVuOf3ElbyV6BC0R4bXh9r30uDTCbZsENR6V4xF9Uj7yFxRw3cLcnssfPAHLlWqNdeO9EA=s800-c-k-c0x00ffffff-no-rj',
    'HOT 97': 'https://yt3.ggpht.com/hnYjS6dIa74r3SO8x74AF1n5esAI45PByob_JhqxC5b5spXjAqebxxql-7u5AVn3eg-Z23Sg=s800-c-k-c0x00ffffff-no-rj',
    'The Breakfast Club': 'https://yt3.ggpht.com/RBbqOo9eDutEBNxybXwTJ_aIY_gq9LNdzOlEdrbaV3xf1Zi9porxzm1XkxoI4g-U5Z_4UhmIGQ=s800-c-k-c0x00ffffff-no-rj'
  };
  function outletLogoUrl(source) {
    var s = String(source || '').trim();
    if (NEWS_OUTLET_LOGO_URLS[s]) return NEWS_OUTLET_LOGO_URLS[s];
    var d = NEWS_OUTLET_DOMAINS[s];
    return d ? ('https://icon.horse/icon/' + encodeURIComponent(d)) : '';
  }
  /* Avatar markup: logo image over the gradient+initials fallback; onerror
     removes the img and reveals the initials. `size` = 'op' (profile) or 'sm'. */
  function outletAvatarHtml(source, sizeClass) {
    var logo = outletLogoUrl(source);
    var initials = outletInitials(source);
    var inner = '<em class="news-avatar-initials">' + esc(initials) + '</em>';
    if (logo) inner += '<img class="news-avatar-img" src="' + escA(logo) + '" alt="" loading="lazy" decoding="async" onerror="this.remove()">';
    return '<span class="news-avatar ' + (sizeClass || '') + '" aria-hidden="true">' + inner + '</span>';
  }

  function countKeys(o) { return (o && typeof o === 'object') ? Object.keys(o).length : 0; }

  /* ---- follow store (localStorage + best-effort Firestore mirror) ---- */
  function readFollows() {
    var f;
    try { f = readNewsLocal(FOLLOWS_KEY, {}); } catch (e) { f = {}; }
    if (!f || typeof f !== 'object') f = {};
    f.outlets = (f.outlets && typeof f.outlets === 'object') ? f.outlets : {};
    f.topics = (f.topics && typeof f.topics === 'object') ? f.topics : {};
    return f;
  }
  function persistFollowsLocal(f) {
    writeNewsLocal(FOLLOWS_KEY, { outlets: f.outlets || {}, topics: f.topics || {} });
  }
  function syncFollowsToCloud(f) {
    try {
      if (typeof db !== 'undefined' && db && typeof currentUser !== 'undefined' && currentUser && currentUser.uid) {
        db.collection('users').doc(currentUser.uid).set({ newsFollows: { outlets: f.outlets || {}, topics: f.topics || {} } }, { merge: true });
      }
    } catch (e) {}
  }
  /* On entry, prefer the cloud copy (cross-device truth) if present; otherwise
     push the local copy up. Cheap + idempotent — safe to call on every open. */
  function initFollows() {
    try {
      var prof = (typeof userProfile !== 'undefined' && userProfile) ? userProfile : null;
      var nf = prof && prof.newsFollows;
      if (nf && typeof nf === 'object' && (countKeys(nf.outlets) || countKeys(nf.topics))) {
        var f = { outlets: nf.outlets || {}, topics: nf.topics || {} };
        persistFollowsLocal(f);
        return f;
      }
    } catch (e) {}
    var local = readFollows();
    if (countKeys(local.outlets) || countKeys(local.topics)) syncFollowsToCloud(local);
    return local;
  }
  function followCount() { var f = readFollows(); return countKeys(f.outlets) + countKeys(f.topics); }
  function isOutletFollowed(src) { var s = String(src || '').trim(); return !!(s && readFollows().outlets[s]); }

  function toggleOutletFollow(src) {
    var s = String(src || '').trim(); if (!s) return false;
    var f = readFollows(), on;
    if (f.outlets[s]) { delete f.outlets[s]; on = false; } else { f.outlets[s] = Date.now(); on = true; }
    persistFollowsLocal(f); syncFollowsToCloud(f); onFollowsChanged();
    return on;
  }
  function setTopicFollow(topic, on) {
    var t = String(topic || '').trim(); if (!t) return false;
    var f = readFollows();
    if (typeof on === 'undefined') on = !f.topics[t];
    if (on) f.topics[t] = Date.now(); else delete f.topics[t];
    persistFollowsLocal(f); syncFollowsToCloud(f); onFollowsChanged();
    return on;
  }

  /* ---- topic matching (word-boundary, accent/punct-insensitive, alias-aware) ---- */
  function normTopic(s) {
    var n = String(s == null ? '' : s).toLowerCase();
    try { n = n.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
    n = n.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    return ' ' + n + ' ';
  }
  /* v11.649: COMPACT-TOKEN-WINDOW matching — robust to spelling/spacing. A topic's
     compact form (accent/punct/space-stripped) is compared against the compact
     JOIN of every contiguous run of article tokens, by EQUALITY (not substring).
     So "spiderman", "Spider-Man" and "spider man" all share compact "spiderman"
     and match the same headline; but "marvel" still won't match "marvellous"
     (windows are compared whole, never as substrings). This fixes the old
     space-padded matcher that missed "spiderman" vs "spider man". */
  function topicTokens(s) {
    var n = String(s == null ? '' : s).toLowerCase();
    try { n = n.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
    return n.replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  }
  function topicNeedles(topic) {
    var toks = topicTokens(topic);
    if (!toks.length) return [];
    var key = toks.join(' ');                  // normalized spaced key for alias lookup
    var raw = (TOPIC_ALIASES[key] || []).slice();
    raw.push(topic);
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var c = topicTokens(raw[i]).join('');    // compact needle
      if (c.length >= 2 && out.indexOf(c) === -1) out.push(c);
    }
    return out;
  }
  function articleHayTokens(item) {
    if (item._followTok) return item._followTok;
    item._followTok = topicTokens((item.title || '') + ' ' + (item.summary || '') + ' ' + (Array.isArray(item.topics) ? item.topics.join(' ') : ''));
    return item._followTok;
  }
  /* true iff `needle` (compact) equals the compact join of SOME contiguous run of
     hay tokens — handles join/split spelling without substring false hits. */
  function compactWindowMatch(hayTokens, needle) {
    var L = needle.length;
    if (!L) return false;
    for (var i = 0; i < hayTokens.length; i++) {
      var acc = '';
      for (var j = i; j < hayTokens.length; j++) {
        acc += hayTokens[j];
        if (acc.length > L) break;
        if (acc.length === L && acc === needle) return true;
      }
    }
    return false;
  }
  function articleMatchesNeedles(item, needleSets) {
    if (!needleSets.length) return false;
    var hay = articleHayTokens(item);
    for (var i = 0; i < needleSets.length; i++) {
      var set = needleSets[i];
      for (var j = 0; j < set.length; j++) { if (compactWindowMatch(hay, set[j])) return true; }
    }
    return false;
  }
  function applyFollowFilter(items) {
    var f = readFollows();
    var outlets = f.outlets, topics = Object.keys(f.topics || {});
    var hasOutlets = countKeys(outlets) > 0;
    if (!hasOutlets && !topics.length) return [];
    var needleSets = [];
    for (var t = 0; t < topics.length; t++) needleSets.push(topicNeedles(topics[t]));
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (hasOutlets && outlets[String(it.source || '').trim()]) { out.push(it); continue; }
      if (needleSets.length && articleMatchesNeedles(it, needleSets)) out.push(it);
    }
    return out;
  }

  /* When follows change: invalidate the Following pool, refresh visible card
     follow-buttons, and — if the user is ON Following — re-filter + re-render. */
  function onFollowsChanged() {
    delete state.poolCache.following;
    delete state.orderCache.following;
    try { delete state.viewCache.following; } catch (e) {}   // v11.757: Following content changed → drop cached DOM, render fresh at top
    refreshVisibleFollowButtons();
    if (state.category === 'following') {
      var raw = state.followingRaw || state.poolCache.all || [];
      if (raw.length) {
        state.pool = applyFollowFilter(raw);
        state.poolCache.following = state.pool;
        state.order = buildFeedOrder(state.pool);
        state.orderCache.following = state.order;
        state.renderIndex = 0;
        renderFirstPage();
      } else {
        loadPool({});
      }
    }
  }
  function refreshVisibleFollowButtons() {
    var scopes = [];
    var feed = q('[data-news-list]'); if (feed) scopes.push(feed);
    if (_outletEl) scopes.push(_outletEl);   // also repaint the open outlet profile
    for (var s = 0; s < scopes.length; s++) {
      var btns = scopes[s].querySelectorAll('[data-news-follow-src]');
      for (var i = 0; i < btns.length; i++) {
        var card = btns[i].closest('.news-card[data-news-source]');
        var src = card ? (card.getAttribute('data-news-source') || '') : '';
        var on = isOutletFollowed(src);
        btns[i].classList.toggle('is-following', on);
        btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
        btns[i].setAttribute('aria-label', (on ? 'Following ' : 'Follow ') + src);
        btns[i].innerHTML = on ? FOLLOW_CHECK_SVG : FOLLOW_PLUS_SVG;
      }
    }
    if (_outletEl && _outletEl.__src) {   // sync the profile's header Follow button
      var hb = _outletEl.querySelector('[data-op-follow]');
      if (hb) {
        var hon = isOutletFollowed(_outletEl.__src);
        hb.classList.toggle('is-following', hon);
        hb.setAttribute('aria-pressed', hon ? 'true' : 'false');
        hb.textContent = hon ? 'Following' : 'Follow';
      }
    }
  }
  function toggleCardFollow(btn) {
    if (!btn) return;
    var card = btn.closest('.news-card[data-news-source]'); if (!card) return;
    var src = card.getAttribute('data-news-source'); if (!src) return;
    var on = toggleOutletFollow(src);   // onFollowsChanged() repaints every visible button
    if (typeof showToast === 'function') { try { showToast(on ? ('Following ' + src) : ('Unfollowed ' + src)); } catch (e) {} }
  }

  /* ---- shelf-derived topic suggestions (the user's library, by status weight) ---- */
  function shelfTopicSuggestions() {
    var out = [], seen = {};
    try {
      var lib = (typeof getVisibleListData === 'function') ? getVisibleListData() : (typeof data !== 'undefined' ? data : null);
      if (!lib || typeof lib !== 'object') return out;
      var sections = ['movies', 'shows', 'anime', 'games', 'music'], cand = [];
      for (var s = 0; s < sections.length; s++) {
        var arr = lib[sections[s]]; if (!Array.isArray(arr)) continue;
        for (var i = 0; i < arr.length; i++) {
          var it = arr[i]; if (!it) continue;
          var title = String(it.title || it.name || '').trim();
          if (title.length < 2 || title.length > 40) continue;
          cand.push({ title: title, w: shelfStatusWeight(it.status, it.rating) });
        }
      }
      cand.sort(function (a, b) { return b.w - a.w; });
      for (var c = 0; c < cand.length && out.length < 12; c++) {
        var key = normTopic(cand[c].title).trim();
        if (!key || seen[key]) continue;
        seen[key] = 1; out.push(cand[c].title);
      }
    } catch (e) {}
    return out;
  }

  /* ---- Tailor (manage) sheet ---- */
  var _manageEl = null;
  function manageSheetShellHtml() {
    return '<div class="news-manage-backdrop" data-news-manage-close></div>' +
      '<div class="news-manage-sheet" role="dialog" aria-modal="true" aria-label="Tailor your news">' +
        '<div class="news-manage-head">' +
          '<div class="news-manage-headtext"><span class="news-manage-kicker">Following feed</span><h2 class="news-manage-title">Tailor Your News</h2></div>' +
          '<button type="button" class="news-manage-close" data-news-manage-close aria-label="Close">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
        '</div>' +
        '<div class="news-manage-body" data-news-manage-body></div>' +
      '</div>';
  }
  function topicChipHtml(t, f) {
    var on = !!(f.topics && f.topics[t]);
    return '<button type="button" class="news-suggest-chip' + (on ? ' is-following' : '') + '" data-follow-topic="' + escA(t) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
      '<span class="news-suggest-label">' + esc(t) + '</span><span class="news-suggest-ind" aria-hidden="true">' + (on ? FOLLOW_CHECK_SVG : FOLLOW_PLUS_SVG) + '</span></button>';
  }
  function renderManageBody() {
    if (!_manageEl) return;
    var body = _manageEl.querySelector('[data-news-manage-body]'); if (!body) return;
    var f = readFollows();
    var topicTotal = countKeys(f.topics);
    var outletTotal = countKeys(f.outlets);

    var yours = Object.keys(f.topics || {});
    var yoursHtml = yours.length
      ? yours.map(function (t) {
          return '<span class="news-yourchip">' + esc(t) +
            '<button type="button" class="news-yourchip-x" data-remove-topic="' + escA(t) + '" aria-label="Remove ' + escA(t) + '">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></span>';
        }).join('')
      : '<span class="news-manage-none">No topics followed</span>';

    var suggestHtml = CURATED_TOPICS.map(function (g) {
      return '<div class="news-suggest-group"><h4 class="news-manage-subhead">' + esc(g.group) + '</h4><div class="news-suggest-chips">' +
        g.items.map(function (t) { return topicChipHtml(t, f); }).join('') + '</div></div>';
    }).join('');

    var shelf = shelfTopicSuggestions();
    var shelfHtml = shelf.length
      ? '<div class="news-suggest-group"><h4 class="news-manage-subhead">From your shelf</h4><div class="news-suggest-chips">' +
          shelf.map(function (t) { return topicChipHtml(t, f); }).join('') + '</div></div>'
      : '';

    var outletsHtml = NEWS_OUTLETS.map(function (g) {
      var rows = g.items.map(function (name) {
        var on = !!(f.outlets && f.outlets[name]);
        return '<button type="button" class="news-outlet-row' + (on ? ' is-following' : '') + '" data-follow-outlet="' + escA(name) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
          '<span class="news-outlet-id">' + outletAvatarHtml(name, 'news-avatar-sm') + '<span class="news-outlet-name">' + esc(name) + '</span></span>' +
          '<span class="news-outlet-pill">' + (on ? 'Following' : 'Follow') + '</span></button>';
      }).join('');
      return '<div class="news-outlet-group"><h4 class="news-manage-subhead">' + esc(g.group) + '</h4><div class="news-outlet-list">' + rows + '</div></div>';
    }).join('');

    body.innerHTML =
      '<div class="news-manage-summary" aria-label="Current follows">' +
        '<span><strong>' + topicTotal + '</strong><em>Topics</em></span>' +
        '<span><strong>' + outletTotal + '</strong><em>Outlets</em></span>' +
        '<span><strong>' + (topicTotal + outletTotal) + '</strong><em>Total</em></span>' +
      '</div>' +
      '<section class="news-manage-section news-manage-section-topics">' +
        '<div class="news-manage-section-head"><h3 class="news-manage-h3">Topics</h3></div>' +
        '<form class="news-topic-add" data-news-topic-form>' +
          '<input type="text" class="news-topic-input" data-news-topic-input placeholder="Add topic" autocomplete="off" autocapitalize="words" enterkeyhint="done">' +
          '<button type="submit" class="news-topic-addbtn">Add</button>' +
        '</form>' +
        '<h4 class="news-manage-subhead news-manage-subhead-first">Your topics</h4>' +
        '<div class="news-manage-yours">' + yoursHtml + '</div>' +
      '</section>' +
      '<section class="news-manage-section">' +
        '<div class="news-manage-section-head"><h3 class="news-manage-h3">Suggestions</h3></div>' +
        shelfHtml + suggestHtml +
      '</section>' +
      '<section class="news-manage-section">' +
        '<div class="news-manage-section-head"><h3 class="news-manage-h3">Outlets</h3></div>' +
        outletsHtml +
      '</section>';
  }
  function bindManageSheet(root) {
    root.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest && t.closest('[data-news-manage-close]')) { e.preventDefault(); closeManageSheet(); return; }
      var topicChip = t.closest && t.closest('[data-follow-topic]');
      if (topicChip) { e.preventDefault(); setTopicFollow(topicChip.getAttribute('data-follow-topic')); renderManageBody(); return; }
      var rm = t.closest && t.closest('[data-remove-topic]');
      if (rm) { e.preventDefault(); setTopicFollow(rm.getAttribute('data-remove-topic'), false); renderManageBody(); return; }
      var outlet = t.closest && t.closest('[data-follow-outlet]');
      if (outlet) { e.preventDefault(); toggleOutletFollow(outlet.getAttribute('data-follow-outlet')); renderManageBody(); return; }
    });
    root.addEventListener('submit', function (e) {
      if (!(e.target && e.target.closest && e.target.closest('[data-news-topic-form]'))) return;
      e.preventDefault();
      var input = root.querySelector('[data-news-topic-input]');
      var val = input ? String(input.value || '').trim() : '';
      if (val) { setTopicFollow(val, true); if (input) input.value = ''; renderManageBody(); }
      if (input) { try { input.focus(); } catch (e2) {} }
    });
    root.__esc = function (e) { if (e.key === 'Escape') closeManageSheet(); };
    document.addEventListener('keydown', root.__esc);
  }
  function openManageSheet() {
    if (_manageEl) return;
    initFollows();
    var root = document.createElement('div');
    root.className = 'news-manage-root';
    root.innerHTML = manageSheetShellHtml();
    document.body.appendChild(root);
    _manageEl = root;
    renderManageBody();
    bindManageSheet(root);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { root.classList.add('is-open'); });
    else root.classList.add('is-open');
    try { document.documentElement.classList.add('news-manage-lock'); } catch (e) {}
  }
  function closeManageSheet() {
    if (!_manageEl) return;
    var root = _manageEl; _manageEl = null;
    root.classList.remove('is-open');
    try { if (root.__esc) document.removeEventListener('keydown', root.__esc); } catch (e) {}
    try { document.documentElement.classList.remove('news-manage-lock'); } catch (e) {}
    setTimeout(function () { try { if (root.parentNode) root.parentNode.removeChild(root); } catch (e) {} }, 320);
  }
  window.shelfdNewsOpenManage = function () { openManageSheet(); };

  /* ============================================================================
     v11.756: YouTube Comments sheet — opens when the user taps the comment
     button on an inline video card. Comments are fetched lazily (ONLY on open),
     20 at a time, paginated via YouTube's nextPageToken. Disabled / empty /
     error (with retry) states handled. External content only — never written
     into Shelfd comments or the taste algorithm. */
  var _ytcEl = null;
  var _ytcState = null;
  function openCardComments(card) {
    if (!card) return;
    markCardEngaged(card);
    var vid = '';
    var eng = card.querySelector('[data-news-engagement][data-news-video-id]');
    if (eng) vid = eng.getAttribute('data-news-video-id') || '';
    if (!vid) { var meta = cardMeta(card); vid = isYouTubeUrl(meta.url) ? youtubeVideoId(meta.url) : ''; }
    if (!vid) return;
    openYouTubeCommentsSheet(vid, card.getAttribute('data-news-title') || '');
  }
  function ytcShellHtml() {
    return '<div class="news-ytc-backdrop" data-ytc-close></div>' +
      '<div class="news-ytc-sheet" role="dialog" aria-modal="true" aria-label="Comments">' +
        '<header class="news-ytc-head">' +
          '<span class="news-ytc-grab" aria-hidden="true"></span>' +
          '<h2 class="news-ytc-title">Comments</h2>' +
          '<button type="button" class="news-ytc-close" data-ytc-close aria-label="Close comments">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
        '</header>' +
        '<div class="news-ytc-body" data-ytc-body></div>' +
      '</div>';
  }
  function ytcRowHtml(c) {
    var name = esc(c.author || 'YouTube user');
    var when = c.publishedAt ? timeAgo(Date.parse(c.publishedAt)) : '';
    var avatar = (typeof c.avatar === 'string' && /^https:\/\//i.test(c.avatar)) ? c.avatar : '/default-avatar.svg';
    /* Escape first (no raw HTML/script can render), THEN turn newlines into <br>. */
    var text = esc(c.text || '').replace(/\n/g, '<br>');
    var likes = Number(c.likeCount || 0) > 0
      ? '<span class="news-ytc-rowlikes"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v11M2 12v7a2 2 0 0 0 2 2h13.5a2 2 0 0 0 2-1.6l1.3-7A2 2 0 0 0 19 10h-6V5a2.5 2.5 0 0 0-2.5-2.5L7 10z"/></svg>' + formatCompactCount(c.likeCount) + '</span>'
      : '';
    return '<div class="news-ytc-row">' +
      '<img class="news-ytc-avatar" src="' + escA(avatar) + '" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'/default-avatar.svg\'">' +
      '<div class="news-ytc-rowmain">' +
        '<div class="news-ytc-rowhead"><span class="news-ytc-author">' + name + '</span>' + (when ? '<span class="news-ytc-time">' + esc(when) + '</span>' : '') + '</div>' +
        '<div class="news-ytc-text">' + text + '</div>' +
        (likes ? '<div class="news-ytc-rowmeta">' + likes + '</div>' : '') +
      '</div>' +
    '</div>';
  }
  function renderYtcBody() {
    if (!_ytcEl || !_ytcState) return;
    var body = _ytcEl.querySelector('[data-ytc-body]');
    if (!body) return;
    var s = _ytcState;
    if (s.error && !s.items.length) {
      body.innerHTML = '<div class="news-ytc-state"><strong>Couldn’t load comments</strong>' +
        '<span>' + (s.quota ? 'YouTube is busy right now. Try again in a moment.' : 'Something went wrong fetching comments.') + '</span>' +
        '<button type="button" class="news-ytc-retry" data-ytc-retry>Try again</button></div>';
      return;
    }
    if (s.disabled) {
      body.innerHTML = '<div class="news-ytc-state"><strong>Comments are turned off</strong><span>Comments are disabled for this video.</span></div>';
      return;
    }
    if (!s.items.length && s.loading) { body.innerHTML = '<div class="news-ytc-loading">' + spinnerHtml() + '</div>'; return; }
    if (!s.items.length && !s.loading) {
      body.innerHTML = '<div class="news-ytc-state"><strong>No comments yet</strong><span>There are no comments to show for this video.</span></div>';
      return;
    }
    var rows = s.items.map(ytcRowHtml).join('');
    var foot;
    if (s.loading) foot = '<div class="news-ytc-foot">' + spinnerHtml() + '</div>';
    else if (s.nextToken) foot = '<div class="news-ytc-foot"><button type="button" class="news-ytc-loadmore" data-ytc-more>Load more comments</button></div>';
    else foot = '';   // v11.762: no "that's all" end-of-list message
    body.innerHTML = '<div class="news-ytc-list">' + rows + '</div>' + foot;
  }
  function loadYouTubeComments(more) {
    if (!_ytcState || _ytcState.loading) return;
    if (more && !_ytcState.nextToken) return;
    _ytcState.loading = true;
    _ytcState.error = false;
    renderYtcBody();
    var token = more ? _ytcState.nextToken : '';
    var vid = _ytcState.videoId;
    var qs = '/api/youtube/comment-sheet?videoId=' + encodeURIComponent(vid) + (token ? '&pageToken=' + encodeURIComponent(token) : '');
    fetch(qs, { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }, function () { return { status: r.status, body: null }; }); })
      .then(function (res) {
        if (!_ytcState || _ytcState.videoId !== vid) return;     // sheet closed / switched videos
        var data = res.body || {};
        _ytcState.loading = false;
        if (data.ok) {
          if (data.commentsDisabled) { _ytcState.disabled = true; renderYtcBody(); return; }
          var incoming = Array.isArray(data.items) ? data.items : [];
          _ytcState.items = _ytcState.items.concat(incoming);
          _ytcState.nextToken = data.nextPageToken || '';
        } else {
          _ytcState.error = true;
          _ytcState.quota = !!data.quota || res.status === 429;
        }
        renderYtcBody();
      })
      .catch(function () {
        if (!_ytcState || _ytcState.videoId !== vid) return;
        _ytcState.loading = false;
        _ytcState.error = true;
        renderYtcBody();
      });
  }
  function attachYtcSwipeDismiss(root) {
    var sheet = root.querySelector('.news-ytc-sheet');
    var head = root.querySelector('.news-ytc-head');
    if (!sheet || !head) return;
    var startY = 0, curY = 0, dragging = false;
    head.addEventListener('touchstart', function (e) {
      if (!e.touches || e.touches.length !== 1) return;
      startY = e.touches[0].clientY; curY = 0; dragging = true;
      sheet.style.transition = 'none';
    }, { passive: true });
    head.addEventListener('touchmove', function (e) {
      if (!dragging || !e.touches || !e.touches.length) return;
      curY = Math.max(0, e.touches[0].clientY - startY);
      sheet.style.transform = 'translate3d(0,' + curY + 'px,0)';
    }, { passive: true });
    head.addEventListener('touchend', function () {
      if (!dragging) return;
      dragging = false;
      sheet.style.transition = '';
      if (curY > 110) { sheet.style.transform = ''; closeYouTubeCommentsSheet(); }
      else { sheet.style.transform = ''; }
    });
  }
  function bindYtcSheet(root) {
    root.addEventListener('click', function (e) {
      var t = e.target, close = t && t.closest;
      if (close && t.closest('[data-ytc-close]')) { e.preventDefault(); closeYouTubeCommentsSheet(); return; }
      if (close && t.closest('[data-ytc-more]')) { e.preventDefault(); loadYouTubeComments(true); return; }
      if (close && t.closest('[data-ytc-retry]')) { e.preventDefault(); loadYouTubeComments(false); return; }
    });
    root.__esc = function (e) { if (e.key === 'Escape') closeYouTubeCommentsSheet(); };
    document.addEventListener('keydown', root.__esc);
    attachYtcSwipeDismiss(root);
  }
  function openYouTubeCommentsSheet(videoId, title) {
    if (!videoId) return;
    if (_ytcEl) closeYouTubeCommentsSheet();
    var root = document.createElement('div');
    root.className = 'news-ytc-root';
    root.innerHTML = ytcShellHtml();
    document.body.appendChild(root);
    _ytcEl = root;
    _ytcState = { videoId: videoId, title: title || '', items: [], nextToken: '', loading: false, disabled: false, error: false, quota: false };
    bindYtcSheet(root);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { root.classList.add('is-open'); });
    else root.classList.add('is-open');
    try { document.documentElement.classList.add('news-manage-lock'); } catch (e) {}
    loadYouTubeComments(false);   // lazy: the only comments fetch happens here, on open
  }
  function closeYouTubeCommentsSheet() {
    if (!_ytcEl) return;
    var root = _ytcEl; _ytcEl = null; _ytcState = null;
    root.classList.remove('is-open');
    try { if (root.__esc) document.removeEventListener('keydown', root.__esc); } catch (e) {}
    try { if (!_manageEl && !_outletEl) document.documentElement.classList.remove('news-manage-lock'); } catch (e) {}
    setTimeout(function () { try { if (root.parentNode) root.parentNode.removeChild(root); } catch (e) {} }, 340);
  }

  /* ---- outlet profile (tap a card's source name) — a mini account page for an
     outlet: avatar + name + a Follow toggle + its recent stories from the pool. */
  var _outletEl = null;
  function outletInitials(src) {
    var parts = String(src || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }
  function outletProfileShellHtml(src) {
    var on = isOutletFollowed(src);
    return '<div class="news-op-backdrop" data-op-close></div>' +
      '<div class="news-op-sheet" role="dialog" aria-modal="true" aria-label="' + escA(src) + '">' +
        '<header class="news-op-head">' +
          '<button type="button" class="news-op-back" data-op-close aria-label="Back">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>' +
          '<div class="news-op-id">' +
            outletAvatarHtml(src, 'news-avatar-op') +
            '<div class="news-op-idtext"><h2 class="news-op-name">' + esc(src) + '</h2>' +
            '<p class="news-op-meta" data-op-count>Recent stories</p></div>' +
          '</div>' +
          '<button type="button" class="news-op-follow' + (on ? ' is-following' : '') + '" data-op-follow aria-pressed="' + (on ? 'true' : 'false') + '">' + (on ? 'Following' : 'Follow') + '</button>' +
        '</header>' +
        '<div class="news-op-list" data-op-list></div>' +
      '</div>';
  }
  function fillOutletProfile(root, src, raw) {
    var list = root.querySelector('[data-op-list]'); if (!list) return;
    var items = [];
    for (var i = 0; i < raw.length; i++) { if (String(raw[i].source || '').trim() === src) items.push(raw[i]); }
    var countEl = root.querySelector('[data-op-count]');
    if (countEl) countEl.textContent = items.length ? (items.length + (items.length === 1 ? ' recent story' : ' recent stories')) : 'No recent stories in the feed';
    list.innerHTML = items.length
      ? items.map(cardHtml).join('')
      : '<div class="news-empty"><strong>Nothing here right now</strong><span>No recent stories from ' + esc(src) + ' are in the feed yet. Follow to catch new posts in your Following tab.</span></div>';
    try { hydrateVideoEngagementStats(); } catch (e) {}   // v11.756: fill YT stats on outlet-profile video cards too
  }
  function bindOutletProfile(root, src) {
    root.addEventListener('click', function (e) {
      var t = e.target, close = t && t.closest;
      if (close && t.closest('[data-op-close]')) { e.preventDefault(); closeOutletProfile(); return; }
      var fol = close ? t.closest('[data-op-follow]') : null;
      if (fol) {
        e.preventDefault();
        var on = toggleOutletFollow(src);
        fol.classList.toggle('is-following', on);
        fol.setAttribute('aria-pressed', on ? 'true' : 'false');
        fol.textContent = on ? 'Following' : 'Follow';
        return;
      }
      onNewsCardClick(e);   // cards inside the profile behave like feed cards
    });
    root.addEventListener('keydown', onNewsCardKeydown);
    root.__esc = function (e) { if (e.key === 'Escape') closeOutletProfile(); };
    document.addEventListener('keydown', root.__esc);
  }
  function openOutletProfile(source) {
    var src = String(source || '').trim(); if (!src) return;
    if (_outletEl && _outletEl.__src === src) return;   // already showing this outlet
    if (_outletEl) closeOutletProfile(true);
    var raw = (state.poolCache.all && state.poolCache.all.length) ? state.poolCache.all
            : (state.followingRaw && state.followingRaw.length) ? state.followingRaw
            : (state.pool && state.pool.length ? state.pool : []);
    var root = document.createElement('div');
    root.className = 'news-op-root';
    root.__src = src;
    root.innerHTML = outletProfileShellHtml(src);
    document.body.appendChild(root);
    _outletEl = root;
    bindOutletProfile(root, src);
    fillOutletProfile(root, src, raw);
    if (!raw.length) {   // pool not loaded yet — fetch the 'all' pool, then fill
      fetch('/api/news?category=all&cursor=0&limit=' + POOL_LIMIT + '&_=' + Date.now(), { cache: 'no-store' })   // v11.700: fresh, never NSURLCache-stale
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var items = (data && Array.isArray(data.items)) ? data.items : [];
          if (items.length) state.poolCache.all = items;
          if (_outletEl === root) fillOutletProfile(root, src, items);
        }).catch(function () {});
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { root.classList.add('is-open'); });
    else root.classList.add('is-open');
    try { document.documentElement.classList.add('news-manage-lock'); } catch (e) {}
  }
  function closeOutletProfile(immediate) {
    if (!_outletEl) return;
    var root = _outletEl; _outletEl = null;
    root.classList.remove('is-open');
    try { if (root.__esc) document.removeEventListener('keydown', root.__esc); } catch (e) {}
    try { if (!_manageEl) document.documentElement.classList.remove('news-manage-lock'); } catch (e) {}
    if (immediate) { try { if (root.parentNode) root.parentNode.removeChild(root); } catch (e) {} }
    else setTimeout(function () { try { if (root.parentNode) root.parentNode.removeChild(root); } catch (e) {} }, 320);
  }
  window.shelfdNewsOpenOutlet = function (src) { openOutletProfile(src); };

  window.shelfdNewsSetCategory = function (cat) {
    if (!cat || cat === state.category) return;
    switchToCategory(cat, null);   // cache-aware (instant when warmed)
  };
  window.shelfdNewsLoadMore = function () { loadMore(); };
  window.shelfdNewsRefresh = function () { triggerRefresh(); };
  /* taste/open signals — the in-app reader (js/43) calls these on open so the
     smart feed learns what the user actually reads. */
  window.shelfdNewsRecordTaste = recordTaste;
  window.shelfdNewsRecordOpen = recordOpen;
  window.shelfdNewsRecordShare = recordShareIntent;
  /* v11.677: shared HEART api — the in-app reader (js/43) toggles/reads the SAME
     per-article hearted state as the feed cards. Identity = article url (same key
     the cards use). Hearting records the SAME strong taste signal (3) into the
     personalization algorithm and syncs every on-screen card so going back shows
     the new state. ONE like system, two surfaces. */
  window.shelfdNewsIsArticleHearted = function (url) { return isBookmarked(String(url || '')); };
  window.shelfdNewsToggleArticleHeart = function (url, meta) {
    url = String(url || '');
    if (!url) return false;
    var on = toggleBookmark(url);
    var cm = (meta && typeof meta === 'object') ? meta : { url: url };
    if (on && meta) { try { recordTaste(meta, 3); } catch (e) {} }   // taste signal parity with card heart
    /* v11.693: consumed-suppression parity with the card heart (reader surface). */
    try { if (on) recordConsumed(cm, 'like'); else unrecordConsumed(cm, 'like'); } catch (e) {}
    syncCardHeartState(url, on);
    return on;
  };
  /* v11.699: LIVE on-device proof. Reads the ACTUAL rendered cards in the DOM
     (not a simulation) and reports the build version + the video-source mix that
     truly rendered after the client mixer ran. Call from the console / Safari Web
     Inspector: shelfdNewsDiag(). If `build` shows an OLD version, the app is
     running stale cached JS (the resume auto-update in 00-live-update-pwa.js
     fixes that on next foreground); if `build` is current, the source spread
     here is the real proof the source-fair rotation is live. */
  /* v11.701: 3-LAYER on-device diag. Compares the video-source spread at each
     layer so a single screenshot localizes a stale/narrow feed:
       RENDERED  = the cards on screen now (DOM)
       POOL      = state.pool the client holds in memory
       NETWORK   = a LIVE cache-busted fetch from THIS device, right now
     If NETWORK is rich but POOL/RENDERED are narrow → stale client state/mix.
     If NETWORK is also narrow → the device's network is being served a stale
     /api/news (edge/NSURLCache), even though the origin is fresh. */
  function countVideoSources(items, urlOf, srcOf) {
    var m = {};
    for (var i = 0; i < (items ? items.length : 0); i++) {
      var it = items[i]; if (!it) continue;
      var u = urlOf(it);
      if (!(/youtube\.com|youtu\.be/.test(u || ''))) continue;
      var s = srcOf(it) || '_'; m[s] = (m[s] || 0) + 1;
    }
    return m;
  }
  window.shelfdNewsDiag = function () {
    var list = q('[data-news-list]');
    var cards = list ? list.querySelectorAll('.news-card') : [];
    var rendered = {}, firstVideoAt = -1;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var isVid = (c.getAttribute('data-news-media-type') === 'video') || isVideoUrl(c.getAttribute('data-news-url') || '');
      if (!isVid) continue;
      if (firstVideoAt < 0) firstVideoAt = i;
      var s = c.getAttribute('data-news-source') || '_';
      rendered[s] = (rendered[s] || 0) + 1;
    }
    var poolSrc = countVideoSources(state.pool, function (it) { return it.url; }, function (it) { return it.source; });
    var out = {
      build: String(window.SCREENLIST_DISPLAY_VERSION || window.SCREENLIST_BUILD_VERSION || '?'),
      category: state.category,
      sound: (newsSoundCapable() ? 'SOUND-CAPABLE' : 'muted-only') + (isCapacitorNative() ? ' · native' : (unmutedAutoplayOK ? ' · probe' : '')) + ' · pref ' + (newsSoundPrefOn() ? 'on' : 'off'),
      renderedCards: cards.length,
      firstVideoAt: firstVideoAt,
      rendered: rendered,
      renderedSrc: Object.keys(rendered).length,
      poolItems: (state.pool || []).length,
      pool: poolSrc,
      poolSrc: Object.keys(poolSrc).length,
      networkSrc: '…',
      network: {}
    };
    try { showNewsDiagPanel(out); } catch (e) {}
    var fetchCat = (state.category === 'following') ? 'all' : state.category;
    var probeUrl = '/api/news?category=' + encodeURIComponent(fetchCat) + '&cursor=0&limit=500&_=' + Date.now();
    fetch(probeUrl, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      var ns = countVideoSources(d && d.items, function (it) { return it.url; }, function (it) { return it.source; });
      out.networkItems = (d && d.items ? d.items.length : 0);
      out.network = ns;
      out.networkSrc = Object.keys(ns).length;
      try { console.log('[shelfd-news-diag]\n' + JSON.stringify(out, null, 2)); } catch (e) {}
      try { showNewsDiagPanel(out); } catch (e) {}
    }).catch(function (e) {
      out.networkSrc = 'ERR'; out.networkError = String(e);
      try { showNewsDiagPanel(out); } catch (e2) {}
    });
    return out;
  };
  /* v11.701: visible 3-layer panel. Opened by tapping the ALREADY-ACTIVE chip 4×. */
  function showNewsDiagPanel(out) {
    var existing = document.getElementById('shelfd-news-diag-panel');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    function top(o) {
      var keys = Object.keys(o || {}).sort(function (a, b) { return o[b] - o[a]; });
      return keys.slice(0, 8).map(function (s) { return o[s] + ' ' + s; }).join(', ') || '(none)';
    }
    var el = document.createElement('div');
    el.id = 'shelfd-news-diag-panel';
    el.style.cssText = 'position:fixed;left:12px;right:12px;top:max(58px,env(safe-area-inset-top,0px));z-index:2147483647;background:rgba(14,14,14,0.98);color:#fff;border:1px solid rgba(200,181,255,0.45);border-radius:14px;padding:14px 16px;font:11.5px/1.5 ui-monospace,Menlo,monospace;letter-spacing:0;max-height:80vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,0.55)';
    el.innerHTML = '<div style="font-weight:600;color:#c8b5ff;margin-bottom:8px">NEWS DIAG &middot; ' + esc(out.build) + ' &middot; tab ' + esc(out.category) + '</div>' +
      '<div style="color:#f7a8ff;margin-bottom:6px">SOUND: ' + esc(out.sound || '?') + '</div>' +
      '<div style="color:#ffd166">RENDERED: <b>' + out.renderedSrc + '</b> src &middot; ' + out.renderedCards + ' cards &middot; 1st video #' + out.firstVideoAt + '</div>' +
      '<div style="margin:1px 0 8px;white-space:normal">' + esc(top(out.rendered)) + '</div>' +
      '<div style="color:#7cc7ff">CLIENT POOL: <b>' + out.poolSrc + '</b> src / ' + out.poolItems + ' items</div>' +
      '<div style="margin:1px 0 8px;white-space:normal">' + esc(top(out.pool)) + '</div>' +
      '<div style="color:#8aff8a">NETWORK NOW: <b>' + out.networkSrc + '</b> src' + (out.networkItems ? (' / ' + out.networkItems + ' items') : '') + '</div>' +
      '<div style="margin:1px 0 8px;white-space:normal">' + esc(top(out.network)) + (out.networkError ? (' &middot; ' + esc(out.networkError)) : '') + '</div>' +
      '<div style="margin-top:6px;color:rgba(255,255,255,0.5)">tap to close</div>';
    el.addEventListener('click', function () { if (el.parentNode) el.parentNode.removeChild(el); });
    document.body.appendChild(el);
  }
  window.shelfdOpenNewsArticle = function (url) {
    var u = String(url || '').trim();
    if (!u || !/^https?:\/\//i.test(u)) return;
    try { window.open(u, '_blank', 'noopener'); }
    catch (e) { try { location.href = u; } catch (e2) {} }
  };

  /* Entry — called when the News sub-tab is shown. */
  window.renderNewsActivityFeed = function () {
    var pane = getPane();
    if (!pane) return null;
    try { initFollows(); } catch (e) {}   // v11.646: sync follows from the user's doc
    try { initNewsTaste(); } catch (e) {} // v11.657: sync compact per-user taste from the user's doc
    if (!state.builtOnce || !pane.querySelector('[data-news-list]')) {
      buildShell();
      bindPtr();
      bindNewsSwipe();
      loadPool({});
      return null;
    }
    setChipsActive();
    attachObserver();
    if (!state.pool.length) {
      loadPool({});
    } else if (Date.now() - state.poolLoadedAt > RELOAD_AFTER_MS && !state.loadingPool) {
      /* v11.702: re-entry refresh. The in-memory pool is stale → re-pull the LIVE
         pool (cache-busted). If the user is at the TOP of the feed, REBUILD +
         re-render so they immediately get the fresh, fully-diverse pool. This fixes
         the bug where a pool captured during a thin YT-cache window stuck in memory
         and the feed kept showing a narrow Marvel/Netflix/RT video mix even though
         the live pool had 17 sources. If they've SCROLLED in, keep it silent so
         their scroll position isn't disrupted — the fresh pool folds in for their
         next pull-to-refresh. (Replaces the v11.620 always-silent path that let a
         stale/thin pool persist for the whole 30-min window.) */
      var atTop = (scrollTopY() < 240) && (state.renderIndex <= PAGE_SIZE + 6);
      loadPool(atTop ? { refresh: true } : { silent: true });
    }
    return null;
  };
})();
