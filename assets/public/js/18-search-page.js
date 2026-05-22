/* =============================================================================
   18-search-page.js  (v628)
   Full-page search hub: movies, TV, anime, games.
   - Debounced query (200ms)
   - Filter chips (All / Movies / TV / Anime / Games)
   - Recent searches (localStorage, last 6)
   - Trending strip on empty state (TMDB weekly)
   - Browse cards seed a query for each media type
   - Result rows match Shelfd visual language; click opens existing media
     profile via openDiscoverMediaProfile / openGameMediaProfile.
   - All animations transform+opacity only (120Hz friendly).
   ========================================================================== */
(function() {
  'use strict';

  const RECENTS_KEY = 'shelfd:search:recent:v1';
  const RECENTS_MAX = 6;
  const DEBOUNCE_MS = 220;
  const SEARCH_LIMIT = 24;
  const PRESET_RESULT_LIMIT = 30;
  const PRESET_GAME_RESULT_LIMIT = 21;
  const PRESET_PAGE_COUNT = 2;
  const PRESET_POPULAR_PAGE_COUNT = 4;

  let activeFilter = 'all';
  let activeQuery = '';
  let queryToken = 0;
  let debounceTimer = 0;
  let pageInitialized = false;
  let lastResultRows = [];
  let activePresetSurface = 'search';
  let presetPanelStacks = {
    search: [],
    discover: []
  };
  let presetResultToken = 0;

  const PRESET_RELEASE_OPTIONS = [
    { key: 'upcoming', label: 'Upcoming', subtitle: 'Unreleased titles ranked by audience activity' },
    ...[2020, 2010, 2000, 1990, 1980, 1970, 1960, 1950, 1940, 1930, 1920, 1910, 1900, 1890, 1880, 1870]
      .map(start => ({ key: `decade:${start}`, label: `${start}s`, subtitle: `${start}-${start + 9}` }))
  ];

  const PRESET_GENRE_OPTIONS = [
    { label: 'Action', id: 28 },
    { label: 'Adventure', id: 12 },
    { label: 'Animation', id: 16 },
    { label: 'Comedy', id: 35 },
    { label: 'Crime', id: 80 },
    { label: 'Documentary', id: 99 },
    { label: 'Drama', id: 18 },
    { label: 'Family', id: 10751 },
    { label: 'Fantasy', id: 14 },
    { label: 'History', id: 36 },
    { label: 'Horror', id: 27 },
    { label: 'Music', id: 10402 },
    { label: 'Mystery', id: 9648 },
    { label: 'Romance', id: 10749 },
    { label: 'Science Fiction', id: 878 },
    { label: 'TV Movie', id: 10770, mediaType: 'movie' },
    { label: 'Thriller', id: 53 },
    { label: 'War', id: 10752 },
    { label: 'Western', id: 37 }
  ];

  const PRESET_SERVICE_OPTIONS = [
    { key: 'any', label: 'Any', providerId: '' },
    { key: 'apple-tv', label: 'Apple TV', providerId: '350' },
    { key: 'crunchyroll', label: 'Crunchyroll', providerId: '283' },
    { key: 'disney-plus', label: 'Disney Plus', providerId: '337' },
    { key: 'hbo-max', label: 'HBO Max', providerId: '1899' },
    { key: 'hulu', label: 'Hulu', providerId: '15' },
    { key: 'netflix', label: 'Netflix', providerId: '8' },
    { key: 'paramount-plus', label: 'Paramount Plus', providerId: '531' },
    { key: 'peacock', label: 'Peacock', providerId: '386' },
    { key: 'prime-video', label: 'Prime Video', providerId: '9' }
  ];

  const PRESET_GAME_GENRE_OPTIONS = [
    { label: 'Action', slug: 'action', igdbGenreIds: [4, 5, 25, 31], igdbThemeIds: [1], matchAliases: ['action', 'fighting', 'shooter', 'hack and slash', 'beat em up', 'adventure'] },
    { label: 'RPG', slug: 'role-playing-games-rpg', igdbGenreIds: [12], matchAliases: ['rpg', 'role playing', 'role-playing', 'role-playing rpg'] },
    { label: 'Shooter', slug: 'shooter', igdbGenreIds: [5], matchAliases: ['shooter'] },
    { label: 'Adventure', slug: 'adventure', igdbGenreIds: [31], matchAliases: ['adventure'] },
    { label: 'Strategy', slug: 'strategy', igdbGenreIds: [11, 15, 16, 24], matchAliases: ['strategy', 'real time strategy', 'turn based strategy', 'tactical'] },
    { label: 'Horror', slug: 'horror', tag: 'horror', igdbThemeIds: [19], matchAliases: ['horror', 'survival horror'] },
    { label: 'Sports', slug: 'sports', igdbGenreIds: [14], matchAliases: ['sport', 'sports'] },
    { label: 'Fighting', slug: 'fighting', igdbGenreIds: [4], matchAliases: ['fighting'] },
    { label: 'Puzzle', slug: 'puzzle', igdbGenreIds: [9], matchAliases: ['puzzle'] },
    { label: 'Simulation', slug: 'simulation', igdbGenreIds: [13], matchAliases: ['simulator', 'simulation'] },
    { label: 'Platformer', slug: 'platformer', igdbGenreIds: [8], matchAliases: ['platform', 'platformer'] },
    { label: 'Racing', slug: 'racing', igdbGenreIds: [10], matchAliases: ['racing'] }
  ];

  const PRESET_GAME_PLATFORM_OPTIONS = [
    { label: 'Any', platformId: '', parentPlatformId: '', igdbPlatformIds: [], matchAliases: [] },
    { label: 'PC', platformId: '4', parentPlatformId: '1', igdbPlatformIds: [6, 14, 3], matchAliases: ['pc', 'windows', 'microsoft windows', 'mac', 'linux'] },
    { label: 'PlayStation', platformId: '187', parentPlatformId: '2', igdbPlatformIds: [7, 8, 9, 38, 46, 48, 167], matchAliases: ['playstation', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5', 'psp', 'vita'] },
    { label: 'Xbox', platformId: '1', parentPlatformId: '3', igdbPlatformIds: [11, 12, 49, 169], matchAliases: ['xbox'] },
    { label: 'Nintendo', platformId: '7', parentPlatformId: '7', igdbPlatformIds: [4, 5, 18, 19, 20, 21, 24, 37, 41, 130], matchAliases: ['nintendo', 'switch', 'wii', 'gamecube', 'game boy', 'gameboy', 'ds', '3ds', 'nes', 'snes'] },
    { label: 'iOS', platformId: '3', parentPlatformId: '4', igdbPlatformIds: [39], matchAliases: ['ios', 'iphone', 'ipad'] },
    { label: 'Android', platformId: '21', parentPlatformId: '8', igdbPlatformIds: [34], matchAliases: ['android'] }
  ];

  let premiumPresetNoticeTimer = 0;
  const presetGameResultSeeds = new Map();

  /* ---------- DOM helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escHtml(s) { return escAttr(s); }

  function renderPresetInlineLockIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path></svg>';
  }

  /* ---------- Recent searches ---------- */
  function loadRecents() {
    try {
      const raw = localStorage.getItem(RECENTS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.slice(0, RECENTS_MAX) : [];
    } catch (_) { return []; }
  }
  function saveRecents(list) {
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, RECENTS_MAX))); } catch (_) {}
  }
  function pushRecent(query) {
    const q = String(query || '').trim();
    if (!q) return;
    const cur = loadRecents().filter(x => x.toLowerCase() !== q.toLowerCase());
    cur.unshift(q);
    saveRecents(cur);
  }
  function clearRecents() {
    saveRecents([]);
    renderRecents();
  }
  function renderRecents() {
    const section = $('shelfd-search-recent-section');
    const list = $('shelfd-search-recent-list');
    if (!section || !list) return;
    const recents = loadRecents();
    if (!recents.length) { section.hidden = true; return; }
    section.hidden = false;
    list.innerHTML = recents.map(q => `
      <button type="button" class="shelfd-search-recent-chip" data-recent-query="${escAttr(q)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
        <span>${escHtml(q)}</span>
      </button>
    `).join('');
  }

  /* ---------- Image helpers ---------- */
  function tmdbPoster(path, size = 'w342') {
    if (!path) return '';
    /* v654: Jikan-sourced anime items store full https URLs in poster_path —
       pass those through unchanged. TMDB items still get the path prefix. */
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return `https://image.tmdb.org/t/p/${size}${path}`;
  }
  function gamePoster(item) {
    return item?.background_image || item?.cover || '';
  }

  /* ---------- Item normalizer for unified row rendering ----------
     v654: also handles Jikan-shaped items (passed in alongside TMDB items
     via runSearch). Jikan items carry `__jikan: true` and `__mal_id`.
     v736: every row now also carries `popularity` — a comparable number
     across sources used as the secondary sort key after prefix-match. */
  function normalizeTmdbItem(item) {
    const isJikan = !!item.__jikan;
    const isMovie = item.media_type === 'movie';
    const title = isMovie ? (item.title || item.original_title || '') : (item.name || item.original_name || '');
    const date = isMovie ? (item.release_date || '') : (item.first_air_date || '');
    const year = (date || '').slice(0, 4);
    const isAnime = isJikan
      || (!isMovie && (typeof window.isAnimeDiscoverCandidate === 'function' ? window.isAnimeDiscoverCandidate(item) : false));
    const kind = isAnime ? 'anime' : (isMovie ? 'movie' : 'tv');
    const displayRating = typeof window.formatDisplayTitleRating === 'function'
      ? window.formatDisplayTitleRating(item)
      : (Number(item.imdbRating || 0) > 0 ? (Number(item.imdbRating) / 2).toFixed(1) : '');
    /* v736: popularity signal.
       - Jikan: `members` (MAL trackers) is the strongest popularity proxy.
         Falls back to `favorites`, then to inverse `popularity` (which is
         a rank — lower is better, so we invert it).
       - TMDB: `popularity` reflects views + recent activity. `vote_count`
         is added as a tie-breaker so high-volume titles surface first. */
    let popularity = 0;
    if (isJikan) {
      /* Jikan / anime — untouched per user direction. */
      const members = Number(item.members || 0);
      const favorites = Number(item.favorites || 0);
      const popRank = Number(item.popularity || 0);
      popularity = members || favorites || (popRank > 0 ? 1_000_000 / popRank : 0);
    } else {
      /* v738: movies / TV popularity = pure flat sum of engagement counts.
         No multipliers, no rating values, no trending fields. Each term is
         "a person took an action" — IMDb users who rated + TMDB users who
         rated. imdbVotes is set by enrichItemsWithImdbRatings (OMDb call
         already running upstream); falls back to 0 if not enriched yet. */
      const imdbVotes = Number(item.imdbVotes || 0);
      const voteCount = Number(item.vote_count || 0);
      popularity = imdbVotes + voteCount;
    }
    /* v10.492: aliases — alternate titles the bucket scorer should also
       consider as canonical matches. For Jikan-sourced anime, the
       English / Japanese / romaji variants count; for TMDB items, the
       original (foreign-language) title counts. The bucket scorer
       awards 95 (vs 100 for canonical) on alias hits. */
    const aliases = [];
    const seenAliases = new Set();
    const pushAlias = (val) => {
      const s = String(val || '').trim();
      if (!s) return;
      const k = s.toLowerCase();
      if (k === String(title || '').toLowerCase() || seenAliases.has(k)) return;
      seenAliases.add(k);
      aliases.push(s);
    };
    if (isJikan) {
      pushAlias(item.title_english);
      pushAlias(item.title_japanese);
      pushAlias(item.original_name);
      pushAlias(item.original_title);
    } else {
      if (isMovie) pushAlias(item.original_title);
      else pushAlias(item.original_name);
    }
    return {
      key: isJikan ? `mal:${item.__mal_id || item.id}` : `tmdb:${item.media_type}:${item.id}`,
      kind,
      tmdbType: isMovie ? 'movie' : 'tv',
      id: item.id,
      title,
      aliases,
      year,
      rating: displayRating,
      popularity,
      poster: tmdbPoster(item.poster_path),
      overview: String(item.overview || '').trim(),
      isJikan,
      malId: isJikan ? (item.__mal_id || item.id) : 0,
      raw: item
    };
  }
  /* v10.232 / v10.233: MusicBrainz search with artist-first relevance ranking.
     Old behavior: a single release-group search for the raw query, which for
     "Kanye West" returned obscure albums LITERALLY titled "Kanye West"
     instead of albums BY Kanye West.
     New flow:
       1. In parallel, hit /search?type=artist and /search?type=release-group.
       2. If the top artist match is high-confidence (score ≥ 88) and its
          name is contained in the query (case/punctuation-insensitive), fetch
          that artist's albums by primary type and prepend them.
       3. Merge: artist albums first, then any release-group hits that aren't
          duplicates.
       4. Drop non-album release-types (Single / Compilation / Live / Remix /
          Demo / Mixtape) when they would dilute the list — keeps the results
          recognisable.
       5. Sort by a popularity proxy: artist-album hits get a boost, then by
          MB `score`, then by release date (newer first as a tiebreaker). */
  function _normalizeMbText(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function _isPrimaryAlbum(rg) {
    const primary = String(rg?.['primary-type'] || rg?.primaryType || '').toLowerCase();
    const secondary = (Array.isArray(rg?.['secondary-types']) ? rg['secondary-types'] : []).map(s => String(s).toLowerCase());
    if (primary !== 'album') return false;
    /* Exclude noisy compilations/live/remix/soundtrack-style releases when
       searching by artist — most users picking an album want the studio LP. */
    const blocked = ['compilation', 'live', 'remix', 'demo', 'mixtape', 'interview', 'spokenword'];
    return !secondary.some(s => blocked.includes(s));
  }
  async function _fetchMbReleaseGroupsByArtist(artistMbid, limit = 18) {
    if (!artistMbid) return [];
    try {
      const url = `/api/musicbrainz/release-group?artist=${encodeURIComponent(artistMbid)}&type=album&fmt=json&limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json().catch(() => null);
      const groups = Array.isArray(data?.['release-groups']) ? data['release-groups']
        : Array.isArray(data?.releaseGroups) ? data.releaseGroups
        : [];
      return groups.filter(_isPrimaryAlbum);
    } catch (_) { return []; }
  }
  /* v10.248: primary music search runs Deezer (no key, popularity-ranked
     results, real cover art + tracklists). Returns the SAME shape as the
     legacy MusicBrainz path so normalizeMusicItem just passes through.
     v10.466: also fetches /search/track so individual songs surface as
     first-class results. Deezer's track search is ranked by stream
     popularity, so the #1 hit for a song-title query is usually the
     canonical version — fixes the "All the Love" case where searching
     a song name returned nothing because we only had album + artist. */
  async function fetchMusicSearchResults(query) {
    const q = String(query || '').trim();
    if (!q) return [];
    try {
      const [albumRes, artistRes, trackRes] = await Promise.allSettled([
        fetch(`/api/deezer/search/album?q=${encodeURIComponent(q)}&limit=18`),
        fetch(`/api/deezer/search/artist?q=${encodeURIComponent(q)}&limit=6`),
        fetch(`/api/deezer/search/track?q=${encodeURIComponent(q)}&limit=12`)
      ]);
      const albumData = albumRes.status === 'fulfilled' && albumRes.value.ok
        ? await albumRes.value.json().catch(() => null) : null;
      const artistData = artistRes.status === 'fulfilled' && artistRes.value.ok
        ? await artistRes.value.json().catch(() => null) : null;
      const trackData = trackRes.status === 'fulfilled' && trackRes.value.ok
        ? await trackRes.value.json().catch(() => null) : null;

      const albums = Array.isArray(albumData?.data) ? albumData.data : [];
      const artists = Array.isArray(artistData?.data) ? artistData.data : [];
      const tracks = Array.isArray(trackData?.data) ? trackData.data : [];

      /* Deezer album rows already include `artist.name`, `cover_xl`, plus
         `release_date` once we expand later. Map to a synthetic MB-ish
         shape that the existing normalizeMusicItem handles. */
      const albumRows = albums.map(a => ({
        __shelfdDeezer: true,
        __shelfdDeezerType: 'album',
        id: 'deezer-album-' + String(a.id),
        deezerId: a.id,
        title: a.title || '',
        cover_xl: a.cover_xl || a.cover_big || a.cover_medium || a.cover_small || '',
        artistName: a.artist?.name || '',
        artistId: a.artist?.id || '',
        explicit: !!a.explicit_lyrics,
        nb_tracks: a.nb_tracks || 0,
        score: 100  // Deezer already returns popularity-ranked
      }));

      /* Promote a top artist row when one strongly matches the query. */
      const qLower = q.toLowerCase();
      const artistRows = artists
        .filter(a => {
          const name = String(a.name || '').toLowerCase();
          return name && (qLower === name || qLower.includes(name) || name.includes(qLower));
        })
        .slice(0, 2)
        .map(a => ({
          __shelfdDeezer: true,
          __shelfdDeezerType: 'artist',
          __shelfdEntity: 'artist',
          id: 'deezer-artist-' + String(a.id),
          deezerId: a.id,
          name: a.name,
          picture_xl: a.picture_xl || a.picture_big || a.picture_medium || '',
          nb_album: a.nb_album || 0,
          nb_fan: a.nb_fan || 0,
          score: 100
        }));

      /* v10.466: track rows. Each track carries its parent album's Deezer ID
         in `deezerId` so clicking the row opens the album profile (Shelfd
         tracks albums, not individual songs). Rows are scored against the
         query — exact / startsWith / contains — so the canonical match
         (e.g. "All the Love" → Kanye West · Bully) sits above album rows.
         Dedupe by (normalized-title + normalized-artist) so the same song
         on a reissue + original album doesn't render twice. */
      const _normSearchText = s => String(s || '').toLowerCase()
        .replace(/[^\w\s]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const qNormSearch = _normSearchText(q);
      const seenTrackKey = new Set();
      const trackRowsRaw = [];
      for (const t of tracks) {
        const trackTitleNorm = _normSearchText(t.title);
        const artistName = (t.artist && t.artist.name) || '';
        const dedupeKey = `${trackTitleNorm}|${_normSearchText(artistName)}`;
        if (!trackTitleNorm || seenTrackKey.has(dedupeKey)) continue;
        const albumId = String((t.album && t.album.id) || '').trim();
        if (!albumId) continue;
        seenTrackKey.add(dedupeKey);
        const matchScore = trackTitleNorm === qNormSearch ? 1000
          : trackTitleNorm.startsWith(qNormSearch) ? 700
          : trackTitleNorm.includes(qNormSearch) ? 500
          : 100;
        trackRowsRaw.push({
          __shelfdDeezer: true,
          __shelfdDeezerType: 'track',
          id: 'deezer-track-' + String(t.id),
          trackDeezerId: String(t.id),
          deezerId: albumId,                       // parent album → click target
          title: t.title || '',
          cover_xl: (t.album && (t.album.cover_xl || t.album.cover_big || t.album.cover_medium)) || '',
          artistName,
          artistId: (t.artist && t.artist.id) || '',
          albumName: (t.album && t.album.title) || '',
          explicit: !!t.explicit_lyrics,
          popularity: Number(t.rank || 0),
          score: matchScore,
          __queryMatchScore: matchScore
        });
      }

      /* Strong matches go ABOVE the album rows; weaker matches go after,
         capped so they don't dominate the list. */
      const promotedTracks = trackRowsRaw
        .filter(t => t.__queryMatchScore >= 500)
        .sort((a, b) => (b.__queryMatchScore - a.__queryMatchScore) || (b.popularity - a.popularity))
        .slice(0, 5);
      const promotedTrackIds = new Set(promotedTracks.map(t => t.trackDeezerId));
      const backgroundTracks = trackRowsRaw
        .filter(t => t.__queryMatchScore < 500 && !promotedTrackIds.has(t.trackDeezerId))
        .slice(0, 4);

      /* Final ordering:
           1. Strong artist hits   (when the query matches an artist name)
           2. Promoted tracks      (query matches the song title)
           3. Albums               (Deezer's popularity order)
           4. Background tracks    (weaker query matches, still useful) */
      return [...artistRows, ...promotedTracks, ...albumRows, ...backgroundTracks];
    } catch (_) { /* fall through to MusicBrainz */ }

    /* Fallback path: original MusicBrainz combo search (unchanged). */
    const qNorm = _normalizeMbText(q);
    try {
      const [artistRes, rgRes] = await Promise.allSettled([
        fetch(`/api/musicbrainz/search?type=artist&q=${encodeURIComponent(q)}&fmt=json&limit=8`),
        fetch(`/api/musicbrainz/search?type=release-group&q=${encodeURIComponent(q)}&fmt=json&limit=14`)
      ]);

      let allArtists = [];
      let topArtist = null;
      let topArtistNameNorm = '';
      if (artistRes.status === 'fulfilled' && artistRes.value.ok) {
        const aData = await artistRes.value.json().catch(() => null);
        allArtists = Array.isArray(aData?.artists) ? aData.artists : [];
        for (const a of allArtists) {
          const score = Number(a.score || 0);
          if (score < 80) break;
          const aNameNorm = _normalizeMbText(a.name);
          /* The artist name must appear in (or fully equal) the user's query
             to qualify — prevents random high-score artists from hijacking
             literal-album searches like "Yeezus". v10.243 also accepts a
             substring match in either direction so queries like "bully kanye
             west" still resolve to Kanye West with "bully" as the album term. */
          if (aNameNorm && (qNorm === aNameNorm || qNorm.includes(aNameNorm) || aNameNorm.includes(qNorm))) {
            topArtist = a;
            topArtistNameNorm = aNameNorm;
            break;
          }
        }
      }

      let rgItems = [];
      if (rgRes.status === 'fulfilled' && rgRes.value.ok) {
        const rData = await rgRes.value.json().catch(() => null);
        rgItems = Array.isArray(rData?.['release-groups']) ? rData['release-groups']
          : Array.isArray(rData?.releaseGroups) ? rData.releaseGroups
          : [];
      }

      /* v10.243: extract the album-term remainder of the query so combo
         searches like "bully kanye west" or "kanye west bully" resolve to
         the specific album, not the artist's full discography. Strip the
         common joiner word "by" too ("bully by kanye west"). */
      let albumTermNorm = '';
      if (topArtistNameNorm && qNorm !== topArtistNameNorm) {
        const stripped = (' ' + qNorm + ' ')
          .replace(' ' + topArtistNameNorm + ' ', ' ')
          .replace(/\s+by\s+/g, ' ')
          .trim();
        if (stripped && stripped !== qNorm) albumTermNorm = stripped;
      }

      let artistAlbums = [];
      if (topArtist?.id) {
        artistAlbums = await _fetchMbReleaseGroupsByArtist(topArtist.id, 50);
        /* Inject artist-credit so the normalizer can render "By {artist}". */
        artistAlbums = artistAlbums.map(rg => ({
          ...rg,
          'artist-credit': rg['artist-credit'] || [{ name: topArtist.name, artist: { id: topArtist.id } }],
          __shelfdArtistHit: true
        }));
        /* v10.243: if the user typed album terms alongside the artist
           ("bully kanye west"), filter the artist's discography to releases
           whose title contains those terms. Falls back to the full list
           when no match (no result is worse than too many). */
        if (albumTermNorm) {
          const albumWords = albumTermNorm.split(' ').filter(Boolean);
          const filtered = artistAlbums.filter(rg => {
            const titleNorm = _normalizeMbText(rg.title || '');
            return albumWords.every(w => titleNorm.includes(w));
          });
          if (filtered.length > 0) {
            artistAlbums = filtered.map(rg => ({ ...rg, __shelfdAlbumTermHit: true }));
          }
        }
      }

      /* Merge & dedupe by MBID. Artist-credited hits go first.
         v10.234: also surface high-confidence ARTIST rows alongside albums
         so users can pull up artists directly. Artists are tagged with
         __shelfdEntity = 'artist' and rendered with a distinct row layout. */
      const merged = [];
      const seen = new Set();
      const push = (rg) => {
        const id = String(rg?.id || '').trim();
        if (!id || seen.has(id)) return;
        seen.add(id);
        merged.push(rg);
      };

      /* Promote the top matching artist to slot 1 so a search like
         "Kanye West" returns the artist row first, then their discography. */
      const artistRows = [];
      const matchingArtists = allArtists
        .filter(a => Number(a.score || 0) >= 70)
        .filter(a => {
          const aNameNorm = _normalizeMbText(a.name);
          if (!aNameNorm) return false;
          return qNorm === aNameNorm
            || qNorm.includes(aNameNorm)
            || aNameNorm.includes(qNorm)
            || aNameNorm.split(' ').some(w => qNorm.split(' ').includes(w));
        })
        .slice(0, 3);
      matchingArtists.forEach(a => {
        artistRows.push({
          id: a.id,
          name: a.name,
          score: a.score,
          country: a.country || '',
          type: a.type || 'Artist',
          disambiguation: a.disambiguation || '',
          __shelfdEntity: 'artist'
        });
      });

      artistRows.forEach(a => {
        if (seen.has(a.id)) return;
        seen.add(a.id);
        merged.push(a);
      });
      artistAlbums.forEach(push);
      rgItems.forEach(push);

      /* v10.243 rank order:
         1. album-term + artist combo hits (e.g. "bully kanye west" → Bully)
         2. plain artist rows (search shortcut to artist)
         3. artist-only hits (artist's other albums)
         4. raw release-group matches
         5. MB score
         6. newer release date as tiebreaker */
      merged.sort((a, b) => {
        const aCombo = a.__shelfdAlbumTermHit ? 1 : 0;
        const bCombo = b.__shelfdAlbumTermHit ? 1 : 0;
        if (aCombo !== bCombo) return bCombo - aCombo;
        const aArtist = a.__shelfdEntity === 'artist' ? 1 : 0;
        const bArtist = b.__shelfdEntity === 'artist' ? 1 : 0;
        if (aArtist !== bArtist) return bArtist - aArtist;
        const aHit = a.__shelfdArtistHit ? 1 : 0;
        const bHit = b.__shelfdArtistHit ? 1 : 0;
        if (aHit !== bHit) return bHit - aHit;
        const aScore = Number(a.score || 0);
        const bScore = Number(b.score || 0);
        if (aScore !== bScore) return bScore - aScore;
        const aDate = String(a['first-release-date'] || '');
        const bDate = String(b['first-release-date'] || '');
        return bDate.localeCompare(aDate);
      });

      return merged.slice(0, 24);
    } catch (_) { return []; }
  }
  function normalizeMusicItem(item = {}) {
    /* v10.248: Deezer-shaped rows take precedence and produce normalized
       cards with real cover art / artist photos. The same `kind` values
       ('music' / 'artist') are emitted so renderResultRow branches cleanly. */
    if (item.__shelfdDeezer) {
      if (item.__shelfdDeezerType === 'artist') {
        const dzId = String(item.deezerId || '').trim();
        return {
          key: `artist:deezer:${dzId}`,
          kind: 'artist',
          id: dzId,
          deezerId: dzId,
          deezerSource: true,
          title: item.name || '',
          aliases: [],
          year: '',
          artist: '',
          artistType: 'Artist',
          country: '',
          disambiguation: item.nb_album ? `${item.nb_album} album${item.nb_album === 1 ? '' : 's'}` : '',
          rating: '',
          popularity: Number(item.nb_fan || 0),
          poster: item.picture_xl || '',
          overview: '',
          raw: item
        };
      }
      /* v10.466: Deezer track row. `kind` stays 'music' so the existing
         click handler + add-to-shelf paths flow through unchanged; the
         `subkind='track'` flag is what renderResultRow uses to swap the
         label ("Song" instead of "Album") and the credit line ("By
         [Artist] · [Album]"). `deezerId` already points at the parent
         album, so openMusicAlbumProfile lands on the right page. */
      if (item.__shelfdDeezerType === 'track') {
        const albumDzId = String(item.deezerId || '').trim();
        const trackDzId = String(item.trackDeezerId || '').trim();
        /* v10.492: aliases — artist + album names so a query like
           "kanye" can match a track row by its artist credit. */
        const trackAliases = [item.artistName, item.albumName].filter(Boolean);
        return {
          key: `music:track:deezer:${trackDzId}:${albumDzId}`,
          kind: 'music',
          subkind: 'track',
          id: albumDzId,
          deezerId: albumDzId,
          trackDeezerId: trackDzId,
          deezerSource: true,
          title: item.title || '',
          aliases: trackAliases,
          year: '',
          artist: item.artistName || '',
          artistDeezerId: item.artistId || '',
          albumName: item.albumName || '',
          rating: '',
          popularity: Number(item.popularity || 0),
          poster: item.cover_xl || '',
          overview: '',
          raw: item
        };
      }
      const albumDzId = String(item.deezerId || '').trim();
      /* v10.492: aliases — artist name so a query for the artist also
         catches their albums. */
      const albumAliases = item.artistName ? [item.artistName] : [];
      return {
        key: `music:deezer:${albumDzId}`,
        kind: 'music',
        id: albumDzId,
        deezerId: albumDzId,
        deezerSource: true,
        title: item.title || '',
        aliases: albumAliases,
        year: '',                  // Deezer's search/album doesn't include year; profile hydrate fills it
        artist: item.artistName || '',
        artistDeezerId: item.artistId || '',
        rating: '',
        popularity: Number(item.score || 0),
        poster: item.cover_xl || '',
        overview: '',
        raw: item
      };
    }
    /* v10.234: artist rows (tagged __shelfdEntity = 'artist') are normalized
       into the same row shape with kind='artist' so renderResultRow can
       branch on it. */
    if (item.__shelfdEntity === 'artist') {
      const aMbid = String(item.id || '').trim();
      const name = String(item.name || '').trim();
      return {
        key: `artist:${aMbid || name}`,
        kind: 'artist',
        id: aMbid,
        title: name,
        aliases: [],
        year: '',
        artist: '',
        artistType: item.type || 'Artist',
        country: item.country || '',
        disambiguation: item.disambiguation || '',
        rating: '',
        popularity: Number(item.score || 0),
        poster: '',
        overview: '',
        raw: item
      };
    }
    const mbid = String(item.id || '').trim();
    const title = String(item.title || '').trim();
    const releaseDate = String(item['first-release-date'] || item.firstReleaseDate || '').trim();
    const year = releaseDate.slice(0, 4);
    const credits = Array.isArray(item['artist-credit']) ? item['artist-credit'] : [];
    const artist = credits
      .map(c => (c?.name || c?.artist?.name || '') + (c?.joinphrase || ''))
      .join('')
      .trim();
    /* Cover Art Archive supports release-group MBIDs directly. The worker
       proxy follows the 307 redirect to the archive.org file URL. */
    const poster = mbid
      ? `/api/musicbrainz/cover-art/release-group/${encodeURIComponent(mbid)}/front-250`
      : '';
    const popularity = Number(item.score || 0); // MB search match confidence (0–100)
    return {
      key: `music:${mbid || title}`,
      kind: 'music',
      id: mbid,
      title,
      aliases: artist ? [artist] : [],
      year,
      artist,
      rating: '',
      popularity,
      poster,
      overview: '',
      raw: item
    };
  }

  function normalizeGameItem(item) {
    const year = (item.released || '').slice(0, 4);
    const rating = Number(item.rating || 0);
    /* v738: games popularity = pure flat sum of every engagement count
       RAWG returns. Each term is "a person took an action" with the game.
         - added         : users who added it to any list
         - ratings_count : users who rated it
         - reviews_count : users who wrote a review (highest-effort signal)
       No multipliers, no rating values. */
    const added = Number(item.added || 0);
    const ratingsCount = Number(item.ratings_count || 0);
    const reviewsCount = Number(item.reviews_count || 0);
    const popularity = added + ratingsCount + reviewsCount;
    const rawgId = String(item.rawgId || item.rawg_id || (item.source === 'rawg' ? item.id : '') || '').trim();
    const profileId = rawgId || String(item.id || '').trim();
    /* v10.492: optional alias list — IGDB normalized rows occasionally
       carry an `alternative_names` array; RAWG search rarely does.
       v10.494: IGDB now actually returns alternative_names (worker
       update). Plus we auto-generate safe acronym aliases for common
       franchise patterns (Grand Theft Auto V → GTA V / GTAV / GTA 5 /
       GTA5, etc.). */
    const aliases = [];
    const canonicalLower = String(item.name || '').toLowerCase();
    const seenAliases = new Set();
    const pushAlias = (raw) => {
      const s = String(raw || '').trim();
      if (!s) return;
      const k = s.toLowerCase();
      if (k === canonicalLower || seenAliases.has(k)) return;
      seenAliases.add(k);
      aliases.push(s);
    };
    const altNames = Array.isArray(item.alternative_names) ? item.alternative_names
      : Array.isArray(item.alternativeNames) ? item.alternativeNames
      : [];
    for (const alt of altNames) pushAlias(alt?.name || alt);
    /* v10.494: auto-generate acronym variants. */
    for (const acronym of shelfdGenerateGameAcronymAliases(item.name || '')) {
      pushAlias(acronym);
    }
    return {
      key: `game:${profileId || item.name}`,
      kind: 'game',
      id: profileId,
      title: item.name || '',
      aliases,
      year,
      rating: rating > 0 ? rating.toFixed(1) : '',
      popularity,
      poster: gamePoster(item),
      overview: '',
      rawgId,
      raw: item
    };
  }

  /* v732: Person row normalizer for the Actors filter chip. */
  function normalizePersonItem(item) {
    const dept = String(item?.known_for_department || '').trim();
    /* Map TMDB dept strings to a clean role label. */
    const roleLabel = dept === 'Acting' ? 'Actor'
      : dept === 'Directing' ? 'Director'
      : dept === 'Writing' ? 'Writer'
      : dept === 'Production' ? 'Producer'
      : (dept || 'Person');
    /* Known-for blurb: top 3 titles they're recognized for. */
    const known = Array.isArray(item.known_for) ? item.known_for : [];
    const knownTitles = known
      .map(k => k?.title || k?.name || '')
      .filter(Boolean)
      .slice(0, 3);
    const popularity = Number(item.popularity || 0);
    /* v10.492: aliases — `also_known_as` from TMDB is the canonical
       alternate-name list for people (stage names, nicknames). It's
       only populated on detail endpoints, but if our search response
       carries it we use it. Otherwise empty. */
    const aliases = [];
    if (Array.isArray(item.also_known_as)) {
      const canonical = String(item.name || '').toLowerCase();
      const seen = new Set();
      for (const a of item.also_known_as) {
        const s = String(a || '').trim();
        if (!s) continue;
        const k = s.toLowerCase();
        if (k === canonical || seen.has(k)) continue;
        seen.add(k);
        aliases.push(s);
      }
    }
    return {
      key: `person:${item.id}`,
      kind: 'person',
      id: item.id,
      title: item.name || '',
      aliases,
      year: '',
      rating: popularity > 0 ? popularity.toFixed(1) : '',
      popularity,
      poster: item.profile_path ? tmdbPoster(item.profile_path, 'w185') : '',
      overview: '',
      role: roleLabel,
      knownFor: knownTitles.join(', '),
      raw: item
    };
  }

  /* ---------- Preset discovery hub ---------- */
  function getPresetSurfaceStack(surface = 'search') {
    const key = surface === 'discover' ? 'discover' : 'search';
    if (!Array.isArray(presetPanelStacks[key])) presetPanelStacks[key] = [];
    return presetPanelStacks[key];
  }

  function getPresetSectionId(surface = 'search') {
    return surface === 'discover' ? 'discover-search-preset-section' : 'shelfd-search-preset-section';
  }

  function getPresetStackId(surface = 'search') {
    return surface === 'discover' ? 'discover-search-preset-stack' : 'shelfd-search-preset-stack';
  }

  function getPremiumPresetNoticeId(surface = 'search') {
    return surface === 'discover' ? 'discover-search-premium-notice' : 'shelfd-search-premium-notice';
  }

  function getPresetSurfaceHost(surface = 'search') {
    if (surface === 'discover') return document.getElementById('discover-universal-search-grid');
    return $('shelfd-search-empty');
  }

  function getPresetStackHost(surface = 'search') {
    if (surface === 'discover') return document.querySelector('#discover-universal-search-overlay .discover-universal-search-panel');
    return document.querySelector('.shelfd-search-page-inner') || $('shelfd-search-page');
  }

  function getPremiumPresetNoticeHost(surface = 'search') {
    if (surface === 'discover') return document.getElementById('discover-universal-search-overlay') || document.body;
    return $('shelfd-search-page') || document.body;
  }

  function setActivePresetSurface(surface = 'search') {
    activePresetSurface = surface === 'discover' ? 'discover' : 'search';
    return activePresetSurface;
  }

  function getPresetHubMediaType() {
    return activePresetSurface === 'discover' ? getDiscoverPresetMediaType() : 'mixed';
  }

  function buildPresetHubMarkup() {
    if (getPresetHubMediaType() === 'game') {
      return `
        <div class="shelfd-search-preset-list" aria-label="Game preset discovery paths">
          ${renderPresetHubButton('release', 'Release Date')}
          ${renderPresetHubButton('genre', 'Genre')}
          ${renderPresetHubButton('platform', 'Platform')}
          ${renderPresetHubButton('rated', 'Highest Rated')}
          ${renderPresetHubButton('anticipated', 'Most Anticipated')}
        </div>
      `;
    }
    return `
      <div class="shelfd-search-preset-list" aria-label="Preset discovery paths">
        ${renderPresetHubButton('release', 'Release Date')}
        ${renderPresetHubButton('genre', 'Genre')}
        ${renderPresetHubButton('country', 'Country')}
        ${renderPresetHubButton('language', 'Language')}
        ${renderPresetHubButton('service', 'Service')}
        ${renderPresetHubButton('popular', 'Most Popular')}
        ${renderPresetHubButton('rated', 'Highest Rated')}
        ${renderPresetHubButton('anticipated', 'Most Anticipated')}
        ${renderPresetHubButton('featured', 'Featured / Official Lists', true)}
      </div>
    `;
  }

  function mountPresetHub(surface = 'search') {
    const host = getPresetSurfaceHost(surface);
    if (!host) return null;
    const existing = document.getElementById(getPresetSectionId(surface));
    setActivePresetSurface(surface);
    if (existing) {
      existing.innerHTML = buildPresetHubMarkup();
      return existing;
    }
    const section = document.createElement('section');
    section.className = 'shelfd-search-section shelfd-search-preset-section';
    section.id = getPresetSectionId(surface);
    section.dataset.presetSurface = surface;
    section.innerHTML = buildPresetHubMarkup();
    section.addEventListener('click', handlePresetPanelClick);
    if (surface === 'discover') {
      host.classList.remove('discover-universal-search-results-list');
      host.classList.add('discover-universal-search-preset-host');
      host.innerHTML = '';
      host.appendChild(section);
    } else {
      host.insertBefore(section, host.firstChild);
    }
    return section;
  }

  function ensureSearchPresetHub() {
    return mountPresetHub('search');
  }

  function renderPresetHubButton(key, title, locked = false) {
    const titleHtml = locked
      ? `${renderPresetInlineLockIcon()}<span class="shelfd-search-preset-title-text">${escHtml(title)}</span>`
      : escHtml(title);
    return `
      <button type="button" class="shelfd-search-preset-card${locked ? ' is-locked' : ''}" data-preset-root="${escAttr(key)}">
        <span class="shelfd-search-preset-copy">
          <span class="shelfd-search-preset-title${locked ? ' is-lock-title' : ''}">${titleHtml}</span>
        </span>
        <span class="shelfd-search-preset-arrow" aria-hidden="true">&rsaquo;</span>
      </button>`;
  }

  function ensurePresetStack(surface = activePresetSurface) {
    const stackId = getPresetStackId(surface);
    let stack = $(stackId);
    if (stack) return stack;
    const inner = getPresetStackHost(surface);
    if (!inner) return null;
    stack = document.createElement('div');
    stack.id = stackId;
    stack.className = 'shelfd-search-preset-stack';
    stack.dataset.presetSurface = surface;
    stack.setAttribute('aria-hidden', 'true');
    inner.appendChild(stack);
    stack.addEventListener('click', handlePresetPanelClick);
    return stack;
  }

  function ensurePremiumPresetNotice(surface = activePresetSurface) {
    const noticeId = getPremiumPresetNoticeId(surface);
    let notice = $(noticeId);
    if (notice) return notice;
    const host = getPremiumPresetNoticeHost(surface);
    if (!host) return null;
    notice = document.createElement('div');
    notice.id = noticeId;
    notice.className = 'shelfd-search-premium-notice';
    notice.dataset.presetSurface = surface;
    notice.hidden = true;
    notice.innerHTML = `
      <button type="button" class="shelfd-search-premium-notice-backdrop" data-premium-preset-dismiss aria-label="Close premium message">
        <span class="shelfd-search-premium-notice-card" role="alertdialog" aria-modal="true" aria-label="Premium feature">
          <span class="shelfd-search-premium-notice-copy">These is a premium feature, Shelfd Pro is required</span>
        </span>
      </button>`;
    notice.addEventListener('click', (event) => {
      if (event.target.closest('[data-premium-preset-dismiss]')) hidePremiumPresetNotice();
    });
    host.appendChild(notice);
    return notice;
  }

  function hidePremiumPresetNotice(surface = activePresetSurface) {
    const notice = $(getPremiumPresetNoticeId(surface));
    if (premiumPresetNoticeTimer) {
      clearTimeout(premiumPresetNoticeTimer);
      premiumPresetNoticeTimer = 0;
    }
    if (!notice) return;
    notice.classList.remove('is-open');
    setTimeout(() => {
      if (!notice.classList.contains('is-open')) notice.hidden = true;
    }, 180);
  }

  function showPremiumPresetNotice(surface = activePresetSurface) {
    setActivePresetSurface(surface);
    const notice = ensurePremiumPresetNotice(surface);
    if (!notice) return;
    if (premiumPresetNoticeTimer) clearTimeout(premiumPresetNoticeTimer);
    notice.hidden = false;
    requestAnimationFrame(() => notice.classList.add('is-open'));
    premiumPresetNoticeTimer = setTimeout(() => hidePremiumPresetNotice(surface), 2200);
  }

  function renderPresetPanelShell({ title, eyebrow = 'Discovery', subtitle = '', body = '', className = '' } = {}) {
    return `
      <div class="shelfd-search-preset-panel-inner ${escAttr(className)}">
        <div class="shelfd-search-preset-panel-topbar">
          <button type="button" class="shelfd-search-preset-back" data-preset-back aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <div class="shelfd-search-preset-panel-heading">
            ${eyebrow ? `<span>${escHtml(eyebrow)}</span>` : ''}
            <strong>${escHtml(title)}</strong>
          </div>
          <span class="shelfd-search-preset-top-spacer" aria-hidden="true"></span>
        </div>
        ${subtitle ? `<p class="shelfd-search-preset-panel-subtitle">${escHtml(subtitle)}</p>` : ''}
        <div class="shelfd-search-preset-panel-body">${body}</div>
      </div>`;
  }

  function openPresetPanel(panel, surface = activePresetSurface) {
    setActivePresetSurface(surface);
    const stack = ensurePresetStack(surface);
    if (!stack || !panel?.id) return;
    const presetPanelStack = getPresetSurfaceStack(surface);
    const previous = presetPanelStack[presetPanelStack.length - 1];
    if (previous?.el) previous.el.classList.add('is-under');
    const el = document.createElement('div');
    el.className = 'shelfd-search-preset-panel';
    el.dataset.panelId = panel.id;
    el.dataset.presetSurface = surface;
    el.innerHTML = panel.html;
    stack.appendChild(el);
    presetPanelStack.push({ id: panel.id, el });
    stack.classList.add('is-open');
    stack.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-active')));
  }

  function closePresetPanel({ surface = activePresetSurface, immediate = false } = {}) {
    const presetPanelStack = getPresetSurfaceStack(surface);
    const stack = $(getPresetStackId(surface));
    const current = presetPanelStack.pop();
    if (!stack || !current?.el) return false;
    const previous = presetPanelStack[presetPanelStack.length - 1];
    if (previous?.el) previous.el.classList.remove('is-under');
    if (immediate) {
      current.el.remove();
    } else {
      current.el.classList.remove('is-active');
      current.el.classList.add('is-exiting');
      setTimeout(() => current.el.remove(), 310);
    }
    if (!presetPanelStack.length) {
      stack.classList.remove('is-open');
      stack.setAttribute('aria-hidden', 'true');
    }
    return true;
  }

  function closeAllPresetPanels({ surface = null, immediate = true } = {}) {
    const surfaces = surface ? [surface] : ['search', 'discover'];
    surfaces.forEach(currentSurface => {
      const presetPanelStack = getPresetSurfaceStack(currentSurface);
      while (presetPanelStack.length) closePresetPanel({ surface: currentSurface, immediate });
      const stack = $(getPresetStackId(currentSurface));
      if (stack) {
        stack.classList.remove('is-open');
        stack.setAttribute('aria-hidden', 'true');
        if (immediate) stack.innerHTML = '';
      }
      presetPanelStacks[currentSurface] = [];
    });
  }

  function removePresetHub(surface = 'search') {
    const section = document.getElementById(getPresetSectionId(surface));
    if (section) section.remove();
    if (surface === 'discover') {
      const host = getPresetSurfaceHost(surface);
      if (host) host.classList.remove('discover-universal-search-preset-host');
    }
  }

  function renderOptionList(options = [], attrs = {}) {
    const action = attrs.action || '';
    return `<div class="shelfd-search-preset-options">${
      options.map(option => `
        <button type="button" class="shelfd-search-preset-option${option.disabled ? ' is-disabled' : ''}" ${action ? `data-preset-action="${escAttr(action)}"` : ''} ${option.key ? `data-preset-key="${escAttr(option.key)}"` : ''} ${option.id ? `data-preset-id="${escAttr(option.id)}"` : ''} ${option.slug ? `data-game-genre="${escAttr(option.slug)}"` : ''} ${option.providerId !== undefined ? `data-provider-id="${escAttr(option.providerId)}"` : ''} ${option.platformId !== undefined ? `data-platform-id="${escAttr(option.platformId)}"` : ''} ${option.mediaType ? `data-media-type="${escAttr(option.mediaType)}"` : ''} ${option.disabled ? 'disabled' : ''}>
          <span>
            <strong>${escHtml(option.label)}</strong>
          </span>
          <span class="shelfd-search-preset-option-arrow" aria-hidden="true">&rsaquo;</span>
        </button>`).join('')
    }</div>`;
  }

  function getDiscoverPresetMediaType() {
    const source = typeof window.getDiscoverUniversalSearchSource === 'function'
      ? String(window.getDiscoverUniversalSearchSource() || '').trim().toLowerCase()
      : '';
    if (source === 'movie' || source === 'tv' || source === 'anime' || source === 'music') return source;
    if (source === 'rawg' || source === 'game' || source === 'games' || source === 'gaming') return 'game';
    return 'mixed';
  }

  function applyPresetSurfaceScope(config = {}, surface = activePresetSurface) {
    if (surface !== 'discover') return { ...config };
    const scopedType = getDiscoverPresetMediaType();
    return {
      ...config,
      mediaType: scopedType === 'mixed' ? (config.mediaType || 'mixed') : scopedType
    };
  }

  function openPresetRoot(key = '', surface = activePresetSurface) {
    setActivePresetSurface(surface);
    if (key === 'release') {
      const isGamePreset = getPresetHubMediaType() === 'game';
      openPresetPanel({
        id: 'release',
        html: renderPresetPanelShell({
          title: 'Release Date',
          subtitle: isGamePreset ? 'Browse upcoming game releases or jump into a decade using RAWG discovery data.' : 'Browse upcoming releases or jump into a decade. Results use TMDB discovery lists, then IMDb data is layered in where available.',
          body: renderOptionList(PRESET_RELEASE_OPTIONS, { action: 'release-option' })
        })
      }, surface);
      return;
    }
    if (key === 'genre') {
      const isGamePreset = getPresetHubMediaType() === 'game';
      openPresetPanel({
        id: 'genre',
        html: renderPresetPanelShell({
          title: 'Genre',
          body: isGamePreset
            ? renderOptionList(PRESET_GAME_GENRE_OPTIONS.map(item => ({ ...item, key: item.slug })), { action: 'game-genre-option' })
            : renderOptionList(
              PRESET_GENRE_OPTIONS.map(item => ({ ...item, key: item.label.toLowerCase().replace(/\s+/g, '-') })),
              { action: 'genre-option' }
            )
        })
      }, surface);
      return;
    }
    if (key === 'platform') {
      openPresetPanel({
        id: 'platform',
        html: renderPresetPanelShell({
          title: 'Platform',
          body: renderOptionList(PRESET_GAME_PLATFORM_OPTIONS.map(item => ({ ...item, key: item.label.toLowerCase().replace(/\s+/g, '-') })), { action: 'game-platform-option' })
        })
      }, surface);
      return;
    }
    if (key === 'country' || key === 'language') {
      const title = key === 'country' ? 'Country' : 'Language';
      openPresetPanel({
        id: key,
        html: renderPresetPanelShell({
          title,
          body: `<div class="shelfd-search-preset-flat-note"><strong>${escHtml(title)} browsing is not connected yet.</strong><span>This should reuse the existing Discovery ${escHtml(title.toLowerCase())} filter data once that list is exported to Search.</span></div>`
        })
      }, surface);
      return;
    }
    if (key === 'service') {
      openPresetPanel({
        id: 'service',
        html: renderPresetPanelShell({
          title: 'Service',
          subtitle: 'Browse by TMDB watch-provider availability in the United States. Provider data can be missing for some titles.',
          body: renderOptionList(PRESET_SERVICE_OPTIONS, { action: 'service-option' })
        })
      }, surface);
      return;
    }
    if (key === 'featured') {
      showPremiumPresetNotice(surface);
      return;
    }
    const directMap = {
      popular: { title: 'Most Popular', preset: 'popular', subtitle: 'Popular titles ranked by audience interest and engagement.' },
      rated: { title: 'Highest Rated', preset: 'rated', subtitle: 'IMDb-first ratings with vote-volume confidence.' },
      anticipated: { title: 'Most Anticipated', preset: 'anticipated', subtitle: 'Only unreleased titles ranked by hype and popularity.' }
    };
    if (directMap[key]) openPresetResultsPanel(applyPresetSurfaceScope(directMap[key], surface), surface);
  }

  function handlePresetPanelClick(event) {
    const surface = setActivePresetSurface(
      event.currentTarget?.dataset?.presetSurface
      || event.target.closest('[data-preset-surface]')?.dataset?.presetSurface
      || activePresetSurface
    );
    const back = event.target.closest('[data-preset-back]');
    if (back) {
      event.preventDefault();
      closePresetPanel({ surface });
      return;
    }
    const root = event.target.closest('[data-preset-root]');
    if (root) {
      event.preventDefault();
      openPresetRoot(root.dataset.presetRoot || '', surface);
      return;
    }
    const actionBtn = event.target.closest('[data-preset-action]');
    if (!actionBtn) return;
    event.preventDefault();
    const action = actionBtn.dataset.presetAction || '';
    if (action === 'release-option') {
      const key = actionBtn.dataset.presetKey || '';
      const option = PRESET_RELEASE_OPTIONS.find(item => item.key === key);
      if (!option) return;
      const isGamePreset = getPresetHubMediaType() === 'game';
      openPresetResultsPanel({
        title: option.label,
        preset: key === 'upcoming' ? 'upcoming' : 'decade',
        decadeStart: key.startsWith('decade:') ? Number(key.split(':')[1]) : 0,
        subtitle: key === 'upcoming'
          ? (isGamePreset ? 'Upcoming games ranked by RAWG engagement.' : 'Upcoming movies, TV, and anime-style titles.')
          : `Released from ${option.subtitle}.`
      }, surface);
    } else if (action === 'game-genre-option') {
      const slug = actionBtn.dataset.gameGenre || '';
      const genre = PRESET_GAME_GENRE_OPTIONS.find(item => item.slug === slug);
      if (!genre) return;
      openPresetResultsPanel(applyPresetSurfaceScope({
        title: genre.label,
        preset: 'game-genre',
        gameGenre: genre.slug,
        gameTag: genre.tag || '',
        mediaType: 'game',
        subtitle: `${genre.label} games ranked by RAWG engagement and quality.`
      }, surface), surface);
    } else if (action === 'game-platform-option') {
      const platformId = actionBtn.dataset.platformId || '';
      const platform = PRESET_GAME_PLATFORM_OPTIONS.find(item => String(item.platformId) === String(platformId));
      if (!platform) return;
      openPresetResultsPanel(applyPresetSurfaceScope({
        title: platform.label,
        preset: 'game-platform',
        platformId,
        mediaType: 'game',
        subtitle: platformId ? `Games available on ${platform.label}.` : 'Popular games across platforms.'
      }, surface), surface);
    } else if (action === 'genre-option') {
      const genre = PRESET_GENRE_OPTIONS.find(item => String(item.id) === String(actionBtn.dataset.presetId || ''));
      if (!genre) return;
      openPresetResultsPanel(applyPresetSurfaceScope({
        title: genre.label,
        preset: 'genre',
        genreId: genre.id,
        mediaType: genre.mediaType || 'mixed',
        subtitle: `${genre.label} titles ranked by engagement.`
      }, surface), surface);
    } else if (action === 'service-option') {
      const service = PRESET_SERVICE_OPTIONS.find(item => String(item.key) === String(actionBtn.dataset.presetKey || ''));
      if (!service) return;
      openPresetResultsPanel(applyPresetSurfaceScope({
        title: service.label,
        preset: 'service',
        providerId: service.providerId,
        subtitle: service.providerId ? `Available on ${service.label} in the United States.` : 'Popular titles across services.'
      }, surface), surface);
    }
  }

  function openPresetResultsPanel(config = {}, surface = activePresetSurface) {
    const scopedConfig = applyPresetSurfaceScope(config, surface);
    const panelId = `results:${config.preset || 'custom'}:${config.title || Date.now()}`;
    openPresetPanel({
      id: panelId,
      html: renderPresetPanelShell({
        title: config.title || 'Results',
        eyebrow: '',
        subtitle: config.subtitle || '',
        className: 'shelfd-search-preset-panel-results',
        body: `<div class="shelfd-search-preset-results" data-preset-results="${escAttr(panelId)}">${renderPresetResultSkeleton()}</div>`
      })
    }, surface);
    loadPresetResults(scopedConfig, panelId);
  }

  function renderPresetResultSkeleton() {
    return `<div class="shelfd-search-preset-grid is-loading">${
      Array.from({ length: 9 }, () => '<div class="shelfd-search-preset-card-skeleton"><span></span><i></i></div>').join('')
    }</div>`;
  }

  function getPresetDate(offsetDays = 0) {
    const date = new Date(Date.now() + offsetDays * 86400000);
    return date.toISOString().slice(0, 10);
  }

  function getPresetMonthsAgoDate(monthsAgo = 0) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setMonth(date.getMonth() - Number(monthsAgo || 0));
    return date.toISOString().slice(0, 10);
  }

  function getPresetStartOfCurrentYear() {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setMonth(0, 1);
    return date.toISOString().slice(0, 10);
  }

  function getPresetImdbMeanRating(items = []) {
    const ratings = (Array.isArray(items) ? items : [])
      .map(item => Number(item.imdbRating || 0))
      .filter(rating => rating > 0);
    if (!ratings.length) return 6.5;
    return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
  }

  function getPresetTopRatedMinVotes(item = {}) {
    const type = String(item.media_type || '').toLowerCase() === 'movie' ? 'movie' : 'tv';
    return type === 'movie' ? 25000 : 15000;
  }

  function getPresetWeightedRatingScore(item = {}, meanRating = 6.5) {
    const rating = Number(item.imdbRating || 0);
    const votes = Number(item.imdbVotes || 0);
    if (!(rating > 0) || !(votes > 0)) return 0;
    const minVotes = getPresetTopRatedMinVotes(item);
    return (votes / (votes + minVotes)) * rating + (minVotes / (votes + minVotes)) * meanRating;
  }

  function normalizePresetGenreName(value = '') {
    const clean = String(value || '').trim().toLowerCase();
    if (!clean) return '';
    if (clean === 'science fiction' || clean === 'sci-fi') return 'sci-fi';
    if (clean === 'tv movie') return 'tv movie';
    return clean;
  }

  function getPresetGenreAliases(label = '') {
    const normalized = normalizePresetGenreName(label);
    if (!normalized) return [];
    if (normalized === 'sci-fi') return ['sci-fi', 'science fiction'];
    return [normalized];
  }

  function getPresetPrimaryGenreWeight(item = {}, genreLabel = '') {
    const aliases = getPresetGenreAliases(genreLabel);
    if (!aliases.length) return 0;
    const primary = normalizePresetGenreName(item.imdbPrimaryGenre || '');
    if (aliases.includes(primary)) return 2;
    const genreList = Array.isArray(item.imdbGenres) ? item.imdbGenres.map(normalizePresetGenreName) : [];
    if (genreList.some(name => aliases.includes(name))) return 1;
    return 0;
  }

  async function fetchPresetTmdbPages(path, params = {}, pageCount = PRESET_PAGE_COUNT) {
    if (typeof window.fetchTmdbPages === 'function') return window.fetchTmdbPages(path, params, pageCount);
    if (typeof window.fetchTmdbProxy === 'function') {
      const results = [];
      for (let page = 1; page <= pageCount; page += 1) {
        const res = await window.fetchTmdbProxy(path, { ...params, page: String(page) });
        if (!res.ok) continue;
        const json = await res.json();
        results.push(...(json.results || []));
      }
      return results.filter(item => item?.id && item?.poster_path);
    }
    return [];
  }

  function markPresetMediaType(item = {}, type = 'tv') {
    return { ...item, media_type: type === 'movie' ? 'movie' : 'tv' };
  }

  function fetchPresetTypedTmdb(path, params = {}, type = 'tv') {
    return fetchPresetTmdbPages(path, params, PRESET_PAGE_COUNT)
      .then(items => items.map(item => markPresetMediaType(item, type)))
      .catch(error => {
        console.warn('Search preset TMDB request failed:', path, params, error);
        return [];
      });
  }

  function fetchPresetRawgProxy(path = 'games', params = {}) {
    if (typeof fetchRawgProxy === 'function') return fetchRawgProxy(path, params);
    const search = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      search.set(key, String(value));
    });
    return fetch(`/api/rawg/${String(path || '').replace(/^\/+/, '')}${search.toString() ? `?${search.toString()}` : ''}`);
  }

  async function fetchPresetRawgPages(params = {}, pageCount = PRESET_PAGE_COUNT, limit = PRESET_RESULT_LIMIT * 3) {
    const pages = Array.from({ length: Math.max(1, pageCount) }, (_, index) => index + 1);
    const settled = await Promise.allSettled(pages.map(async page => {
      const res = await fetchPresetRawgProxy('games', { page_size: '40', ...params, page: String(page) });
      if (!res.ok) throw new Error(`RAWG preset request failed: ${res.status}`);
      const json = await res.json();
      return Array.isArray(json?.results) ? json.results : [];
    }));
    const seen = new Set();
    return settled
      .filter(result => result.status === 'fulfilled')
      .flatMap(result => result.value)
      .filter(item => {
        const id = String(item?.id || '').trim();
        if (!id || !item?.name || !item?.background_image || seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .slice(0, limit);
  }

  function normalizePresetGameItems(items = []) {
    const seen = new Set();
    return (Array.isArray(items) ? items : [])
      .filter(item => item?.id && item?.name)
      .map(item => {
        const source = String(item.source || '').trim().toLowerCase() === 'igdb' ? 'igdb' : 'rawg';
        const rawgId = source === 'rawg' ? String(item.rawgId || item.rawg_id || item.id || '') : String(item.rawgId || item.rawg_id || '');
        const igdbId = String(item.igdbId || item.igdb_id || item.sourceId || (source === 'igdb' ? String(item.id || '').replace(/^igdb:/i, '') : '') || '').trim();
        return {
          ...item,
          source,
          kind: 'game',
          rawgId,
          igdbId,
          sourceId: item.sourceId || (source === 'igdb' ? igdbId : rawgId)
        };
      })
      .filter(item => {
        const id = String(item.rawgId || (item.igdbId ? `igdb:${item.igdbId}` : item.id) || '').trim();
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
  }

  function getPresetGameReleaseDate(item = {}) {
    return item.released || item.release_date || '';
  }

  function normalizePresetGameText(value = '') {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function getPresetGameGenreNames(item = {}) {
    return (Array.isArray(item.genres) ? item.genres : [])
      .map(genre => typeof genre === 'string' ? genre : (genre?.name || genre?.slug || ''))
      .map(name => String(name || '').trim())
      .filter(Boolean);
  }

  function getPresetGameThemeNames(item = {}) {
    return (Array.isArray(item.themes) ? item.themes : [])
      .map(theme => typeof theme === 'string' ? theme : (theme?.name || theme?.slug || ''))
      .map(name => String(name || '').trim())
      .filter(Boolean);
  }

  function getPresetGamePlatformNames(item = {}) {
    return (Array.isArray(item.platforms) ? item.platforms : [])
      .map(platform => typeof platform === 'string' ? platform : (platform?.platform?.name || platform?.name || ''))
      .map(name => String(name || '').trim())
      .filter(Boolean);
  }

  function isPresetGameInGenreTopTwo(item = {}, genre = null) {
    if (!genre) return true;
    const topGenres = getPresetGameGenreNames(item).slice(0, 2).map(normalizePresetGameText);
    if (!topGenres.length) return false;
    const accepted = [genre.label, genre.slug, ...(genre.matchAliases || [])]
      .map(normalizePresetGameText)
      .filter(Boolean);
    if (topGenres.some(name => accepted.some(alias => name === alias || name.includes(alias) || alias.includes(name)))) return true;
    const topThemes = getPresetGameThemeNames(item).slice(0, 2).map(normalizePresetGameText);
    return topThemes.some(name => accepted.some(alias => name === alias || name.includes(alias) || alias.includes(name)));
  }

  function isPresetGameOnPlatform(item = {}, platform = null) {
    if (!platform || !platform.platformId) return true;
    const names = getPresetGamePlatformNames(item).map(normalizePresetGameText);
    if (!names.length) return false;
    const accepted = [platform.label, ...(platform.matchAliases || [])]
      .map(normalizePresetGameText)
      .filter(Boolean);
    return names.some(name => accepted.some(alias => name === alias || name.includes(alias) || alias.includes(name)));
  }

  function getPresetGameRawgEngagementFields(item = {}) {
    return {
      added: Number(item.added || 0),
      ratings_count: Number(item.ratings_count || 0),
      reviews_count: Number(item.reviews_count || 0),
      suggestions_count: Number(item.suggestions_count || 0)
    };
  }

  function getPresetGameIgdbEngagementFields(item = {}) {
    return {
      hypes: Number(item.hypes || 0),
      follows: Number(item.follows || 0),
      rating_count: Number(item.rating_count || 0),
      aggregated_rating_count: Number(item.aggregated_rating_count || 0),
      total_rating_count: Number(item.total_rating_count || 0)
    };
  }

  function hasPresetGameEngagementSignal(fields = {}) {
    return Object.values(fields || {}).some(value => Number(value || 0) > 0);
  }

  function buildPresetGameProviderMax(items = [], getter = () => ({})) {
    const max = {};
    items.forEach(item => {
      const fields = getter(item);
      Object.entries(fields).forEach(([key, value]) => {
        const numeric = Number(value || 0);
        if (numeric > 0) max[key] = Math.max(max[key] || 0, Math.log1p(numeric));
      });
    });
    return max;
  }

  function scorePresetGameProviderFields(fields = {}, max = {}, weights = {}) {
    let weighted = 0;
    let weightTotal = 0;
    Object.entries(fields).forEach(([key, value]) => {
      const numeric = Number(value || 0);
      const maxLog = Number(max[key] || 0);
      if (numeric <= 0 || maxLog <= 0) return;
      const weight = Number(weights[key] || 1);
      weighted += (Math.log1p(numeric) / maxLog) * weight;
      weightTotal += weight;
    });
    return weightTotal > 0 ? weighted / weightTotal : 0;
  }

  function attachPresetGameEngagementScores(items = []) {
    const list = normalizePresetGameItems(items);
    const rawgMax = buildPresetGameProviderMax(list, getPresetGameRawgEngagementFields);
    const igdbMax = buildPresetGameProviderMax(list, getPresetGameIgdbEngagementFields);
    const rawgWeights = { added: 0.5, ratings_count: 0.25, reviews_count: 0.17, suggestions_count: 0.08 };
    const igdbWeights = { follows: 0.32, hypes: 0.22, rating_count: 0.18, total_rating_count: 0.2, aggregated_rating_count: 0.08 };
    return list.map(item => {
      const rawgFields = getPresetGameRawgEngagementFields(item);
      const igdbFields = getPresetGameIgdbEngagementFields(item);
      const rawgHas = hasPresetGameEngagementSignal(rawgFields);
      const igdbHas = hasPresetGameEngagementSignal(igdbFields);
      const rawgScore = rawgHas ? scorePresetGameProviderFields(rawgFields, rawgMax, rawgWeights) : 0;
      const igdbScore = igdbHas ? scorePresetGameProviderFields(igdbFields, igdbMax, igdbWeights) : 0;
      let engagementScore = 0;
      if (rawgHas && igdbHas) engagementScore = (Math.max(rawgScore, igdbScore) * 0.65) + (Math.min(rawgScore, igdbScore) * 0.35);
      else engagementScore = rawgHas ? rawgScore : igdbScore;
      return {
        ...item,
        _engagementScore: engagementScore,
        _engagementHasSignal: rawgHas || igdbHas,
        _rawgEngagementFields: rawgFields,
        _igdbEngagementFields: igdbFields
      };
    });
  }

  function getPresetGameQuality(item = {}) {
    const rawgRating = Number(item.rating || 0) > 0 ? Number(item.rating || 0) / 5 : 0;
    const metacritic = Number(item.metacritic || 0) > 0 ? Number(item.metacritic || 0) / 100 : 0;
    return (rawgRating * 0.62) + (metacritic * 0.38);
  }

  function rankPresetGameItems(items = [], preset = 'popular') {
    const list = attachPresetGameEngagementScores(items);
    return list.sort((a, b) => {
      const aRelease = Date.parse(`${getPresetGameReleaseDate(a)}T00:00:00`);
      const bRelease = Date.parse(`${getPresetGameReleaseDate(b)}T00:00:00`);
      const aFuture = Number.isFinite(aRelease) && aRelease > Date.now();
      const bFuture = Number.isFinite(bRelease) && bRelease > Date.now();
      if (preset === 'anticipated' || preset === 'upcoming') {
        if (aFuture !== bFuture) return bFuture ? 1 : -1;
      }

      const aHasEngagement = !!a._engagementHasSignal;
      const bHasEngagement = !!b._engagementHasSignal;
      if (aHasEngagement !== bHasEngagement) return bHasEngagement ? 1 : -1;
      const aQuality = getPresetGameQuality(a);
      const bQuality = getPresetGameQuality(b);
      const aScore = preset === 'rated'
        ? (aQuality * 1000000) + Number(a._engagementScore || 0) * 100000
        : Number(a._engagementScore || 0) * 1000000 + (aQuality * 1000);
      const bScore = preset === 'rated'
        ? (bQuality * 1000000) + Number(b._engagementScore || 0) * 100000
        : Number(b._engagementScore || 0) * 1000000 + (bQuality * 1000);
      if (bScore !== aScore) return bScore - aScore;

      if (Number.isFinite(aRelease) && Number.isFinite(bRelease) && bRelease !== aRelease) return bRelease - aRelease;
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
    }).slice(0, PRESET_GAME_RESULT_LIMIT);
  }

  function buildPresetGameMergeKey(item = {}) {
    const source = String(item.source || '').trim().toLowerCase();
    const rawgId = String(item.rawgId || item.rawg_id || (source === 'rawg' ? item.id : '') || '').trim();
    const igdbId = String(item.igdbId || item.igdb_id || item.sourceId || (source === 'igdb' ? String(item.id || '').replace(/^igdb:/i, '') : '') || '').trim();
    if (rawgId) return `rawg:${rawgId}`;
    if (igdbId) return `igdb:${igdbId}`;
    const title = normalizePresetGameText(item.name || item.title || '');
    const year = String(getPresetGameReleaseDate(item) || '').slice(0, 4);
    return title ? `title:${title}:${year}` : '';
  }

  function mergePresetGameCandidateItems(groups = []) {
    const byTitle = new Map();
    const out = [];
    (groups || []).flat().forEach(rawItem => {
      if (!rawItem?.id || !rawItem?.name) return;
      const item = { ...rawItem };
      const titleKey = `${normalizePresetGameText(item.name || item.title || '')}:${String(getPresetGameReleaseDate(item) || '').slice(0, 4)}`;
      const identityKey = buildPresetGameMergeKey(item);
      const existingIndex = byTitle.has(titleKey)
        ? byTitle.get(titleKey)
        : (identityKey && byTitle.has(identityKey) ? byTitle.get(identityKey) : -1);
      if (existingIndex >= 0) {
        const existing = out[existingIndex] || {};
        const merged = {
          ...existing,
          ...item,
          rawgId: existing.rawgId || item.rawgId || item.rawg_id || '',
          igdbId: existing.igdbId || item.igdbId || item.igdb_id || item.sourceId || '',
          source: existing.source === 'rawg' ? existing.source : (item.source || existing.source || ''),
          background_image: existing.background_image || item.background_image || item.cover || item.igdbCover || '',
          cover: existing.cover || item.cover || item.background_image || item.igdbCover || '',
          igdbCover: existing.igdbCover || item.igdbCover || '',
          genres: existing.genres?.length ? existing.genres : (item.genres || []),
          platforms: existing.platforms?.length ? existing.platforms : (item.platforms || []),
          added: Math.max(Number(existing.added || 0), Number(item.added || 0)),
          ratings_count: Math.max(Number(existing.ratings_count || 0), Number(item.ratings_count || 0)),
          reviews_count: Math.max(Number(existing.reviews_count || 0), Number(item.reviews_count || 0)),
          suggestions_count: Math.max(Number(existing.suggestions_count || 0), Number(item.suggestions_count || 0)),
          hypes: Math.max(Number(existing.hypes || 0), Number(item.hypes || 0)),
          follows: Math.max(Number(existing.follows || 0), Number(item.follows || 0)),
          rating_count: Math.max(Number(existing.rating_count || 0), Number(item.rating_count || 0)),
          aggregated_rating_count: Math.max(Number(existing.aggregated_rating_count || 0), Number(item.aggregated_rating_count || 0)),
          total_rating_count: Math.max(Number(existing.total_rating_count || 0), Number(item.total_rating_count || 0))
        };
        out[existingIndex] = merged;
        return;
      }
      const index = out.push(item) - 1;
      if (titleKey) byTitle.set(titleKey, index);
      if (identityKey) byTitle.set(identityKey, index);
    });
    return out;
  }

  async function fetchPresetIgdbGames(config = {}, limit = 80) {
    const params = new URLSearchParams();
    params.set('preset', String(config.preset || 'popular'));
    params.set('limit', String(limit));
    if (Array.isArray(config.igdbGenreIds) && config.igdbGenreIds.length) params.set('genreIds', config.igdbGenreIds.join(','));
    if (Array.isArray(config.igdbThemeIds) && config.igdbThemeIds.length) params.set('themeIds', config.igdbThemeIds.join(','));
    if (Array.isArray(config.igdbPlatformIds) && config.igdbPlatformIds.length) params.set('platformIds', config.igdbPlatformIds.join(','));
    if (config.fromDate) params.set('from', config.fromDate);
    if (config.toDate) params.set('to', config.toDate);
    const res = await fetch(`/api/igdb/discover-games?${params.toString()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`IGDB preset request failed: ${res.status}`);
    const json = await res.json();
    return Array.isArray(json?.results) ? json.results : [];
  }

  function applyPresetGameFinalFilters(items = [], config = {}) {
    const preset = String(config.preset || '').trim();
    let list = normalizePresetGameItems(items);
    if (preset === 'game-genre') {
      const genre = PRESET_GAME_GENRE_OPTIONS.find(item => item.slug === String(config.gameGenre || ''));
      list = list.filter(item => isPresetGameInGenreTopTwo(item, genre));
    }
    if (preset === 'game-platform') {
      const platform = PRESET_GAME_PLATFORM_OPTIONS.find(item => String(item.platformId) === String(config.platformId || ''));
      list = list.filter(item => isPresetGameOnPlatform(item, platform));
    }
    return list;
  }

  async function fetchGamePresetDirect(config = {}) {
    const preset = String(config.preset || '').trim();
    const baseParams = { ordering: '-added' };
    let rawgPromise = Promise.resolve([]);
    let igdbConfig = { preset };
    if (preset === 'game-genre') {
      const genre = PRESET_GAME_GENRE_OPTIONS.find(item => item.slug === String(config.gameGenre || ''));
      rawgPromise = fetchPresetRawgPages({
        ...baseParams,
        ...(genre?.tag ? { tags: genre.tag } : { genres: String(config.gameGenre || '') })
      }, PRESET_POPULAR_PAGE_COUNT).catch(error => {
        console.warn('RAWG game genre preset failed; using IGDB fallback if available.', error);
        return [];
      });
      igdbConfig = { ...igdbConfig, igdbGenreIds: genre?.igdbGenreIds || [], igdbThemeIds: (genre?.igdbGenreIds || []).length ? [] : (genre?.igdbThemeIds || []) };
    } else if (preset === 'game-platform') {
      const platform = PRESET_GAME_PLATFORM_OPTIONS.find(item => String(item.platformId) === String(config.platformId || ''));
      rawgPromise = fetchPresetRawgPages({
        ...baseParams,
        ...(platform?.parentPlatformId ? { parent_platforms: platform.parentPlatformId } : { platforms: String(config.platformId || '') })
      }, PRESET_POPULAR_PAGE_COUNT).catch(error => {
        console.warn('RAWG game platform preset failed; using IGDB fallback if available.', error);
        return [];
      });
      igdbConfig = { ...igdbConfig, igdbPlatformIds: platform?.igdbPlatformIds || [] };
    } else if (preset === 'rated') {
      rawgPromise = fetchPresetRawgPages({
        ordering: '-rating',
        metacritic: '70,100'
      }, PRESET_POPULAR_PAGE_COUNT).catch(error => {
        console.warn('RAWG rated games preset failed; using IGDB fallback if available.', error);
        return [];
      });
    } else if (preset === 'anticipated' || preset === 'upcoming') {
      const fromDate = getPresetDate(1);
      const toDate = getPresetDate(365);
      rawgPromise = fetchPresetRawgPages({
        ordering: '-added',
        dates: `${fromDate},${toDate}`
      }, PRESET_POPULAR_PAGE_COUNT).catch(error => {
        console.warn('RAWG upcoming games preset failed; using IGDB fallback if available.', error);
        return [];
      });
      igdbConfig = { ...igdbConfig, fromDate, toDate };
    } else if (preset === 'decade') {
      const start = Number(config.decadeStart || 0);
      const end = start + 9;
      rawgPromise = fetchPresetRawgPages({
        ...baseParams,
        dates: `${start}-01-01,${end}-12-31`
      }, PRESET_POPULAR_PAGE_COUNT).catch(error => {
        console.warn('RAWG decade games preset failed; using IGDB fallback if available.', error);
        return [];
      });
      igdbConfig = { ...igdbConfig, fromDate: `${start}-01-01`, toDate: `${end}-12-31` };
    } else {
      rawgPromise = fetchPresetRawgPages(baseParams, PRESET_POPULAR_PAGE_COUNT).catch(error => {
        console.warn('RAWG popular games preset failed; using IGDB fallback if available.', error);
        return [];
      });
    }
    const igdbPromise = fetchPresetIgdbGames(igdbConfig, 80).catch(error => {
      console.warn('IGDB game preset failed; using RAWG results if available.', error);
      return [];
    });
    const [rawgItems, igdbItems] = await Promise.all([rawgPromise, igdbPromise]);
    const merged = mergePresetGameCandidateItems([rawgItems, igdbItems]);
    const filtered = applyPresetGameFinalFilters(merged, config);
    return rankPresetGameItems(filtered, preset === 'rated' ? 'rated' : (preset === 'anticipated' || preset === 'upcoming' ? 'anticipated' : 'popular'));
  }

  function getPresetTitle(item = {}) {
    return item.title || item.name || item.original_title || item.original_name || '';
  }

  function getPresetReleaseDate(item = {}) {
    return item.release_date || item.first_air_date || '';
  }

  function normalizePresetMediaItems(items = [], mediaType = 'mixed') {
    const seen = new Set();
    return (Array.isArray(items) ? items : [])
      .filter(item => item?.id && item.poster_path && getPresetTitle(item))
      .map(item => {
        const type = item.media_type === 'movie' ? 'movie' : (mediaType === 'movie' ? 'movie' : 'tv');
        return { ...item, media_type: type };
      })
      .filter(item => {
        const key = `${item.media_type}:${item.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function filterPresetItemsByMediaType(items = [], mediaType = 'mixed') {
    const requested = String(mediaType || 'mixed').trim().toLowerCase();
    if (!Array.isArray(items)) return [];
    if (!requested || requested === 'mixed') return items.slice();
    if (requested === 'music') return [];
    return items.filter(item => {
      const type = String(item?.media_type || '').toLowerCase() === 'movie' ? 'movie' : 'tv';
      const isAnime = typeof window.isAnimeDiscoverCandidate === 'function' ? !!window.isAnimeDiscoverCandidate(item) : false;
      if (requested === 'movie') return type === 'movie' && !isAnime;
      if (requested === 'tv') return type === 'tv' && !isAnime;
      if (requested === 'anime') return type === 'tv' && isAnime;
      return true;
    });
  }

  async function enrichAndRankPresetItems(items = [], category = 'popular', mediaType = 'mixed') {
    const list = filterPresetItemsByMediaType(normalizePresetMediaItems(items, mediaType), mediaType).slice(0, 48);
    if (category !== 'anticipated' && category !== 'upcoming' && typeof window.enrichItemsWithImdbRatings === 'function') {
      try { await window.enrichItemsWithImdbRatings(list, mediaType); } catch (_) {}
    }
    if (typeof window.rankDiscoverTitles === 'function') {
      return window.rankDiscoverTitles(category, list, { mediaType }).slice(0, PRESET_RESULT_LIMIT);
    }
    return list.sort((a, b) => Number(b.popularity || 0) - Number(a.popularity || 0)).slice(0, PRESET_RESULT_LIMIT);
  }

  async function fetchPresetDirect(config = {}) {
    const preset = config.preset || '';
    const requestedMediaType = String(config.mediaType || 'mixed').trim().toLowerCase() || 'mixed';
    if (requestedMediaType === 'music') return [];
    if (requestedMediaType === 'game') return fetchGamePresetDirect(config);
    if (preset === 'rated') {
      let ratedCandidates = [];
      if (typeof window.fetchDiscoverTopRatedMedia === 'function') {
        const ratedType = requestedMediaType === 'anime' ? 'anime' : (requestedMediaType === 'movie' || requestedMediaType === 'tv' ? requestedMediaType : 'mixed');
        ratedCandidates = await window.fetchDiscoverTopRatedMedia(ratedType).catch(() => []);
      }
      ratedCandidates = filterPresetItemsByMediaType(normalizePresetMediaItems(ratedCandidates, requestedMediaType), requestedMediaType).slice(0, 96);

      if (ratedCandidates.length && typeof window.enrichItemsWithImdbRatings === 'function') {
        try { await window.enrichItemsWithImdbRatings(ratedCandidates, requestedMediaType); } catch (_) {}
      }

      const meanRating = getPresetImdbMeanRating(ratedCandidates);
      ratedCandidates.sort((a, b) => {
        const aScore = getPresetWeightedRatingScore(a, meanRating);
        const bScore = getPresetWeightedRatingScore(b, meanRating);
        const aHasScore = aScore > 0;
        const bHasScore = bScore > 0;
        if (aHasScore !== bHasScore) return bHasScore ? 1 : -1;
        if (bScore !== aScore) return bScore - aScore;

        const aVotes = Number(a.imdbVotes || 0);
        const bVotes = Number(b.imdbVotes || 0);
        if (bVotes !== aVotes) return bVotes - aVotes;

        const aRating = Number(a.imdbRating || 0);
        const bRating = Number(b.imdbRating || 0);
        if (bRating !== aRating) return bRating - aRating;

        return String(getPresetTitle(a)).localeCompare(String(getPresetTitle(b)));
      });

      return ratedCandidates.slice(0, PRESET_RESULT_LIMIT);
    }
    if ((preset === 'anticipated' || preset === 'upcoming') && typeof window.fetchAndRankAnticipated === 'function') {
      return window.fetchAndRankAnticipated(PRESET_RESULT_LIMIT, PRESET_PAGE_COUNT, 'mixed');
    }

    const requests = [];
    const includeMovie = requestedMediaType === 'mixed' || requestedMediaType === 'movie';
    const includeTv = requestedMediaType === 'mixed' || requestedMediaType === 'tv' || requestedMediaType === 'anime';
    const baseParams = { sort_by: 'popularity.desc', include_adult: 'false', watch_region: 'US' };

    if (preset === 'popular') {
      const releasedAfter = getPresetMonthsAgoDate(3);
      const releasedBefore = getPresetDate(0);
      if (includeMovie) requests.push(fetchPresetTmdbPages('discover/movie', {
        ...baseParams,
        'primary_release_date.gte': releasedAfter,
        'primary_release_date.lte': releasedBefore
      }, PRESET_POPULAR_PAGE_COUNT).then(items => items.map(item => markPresetMediaType(item, 'movie'))).catch(() => []));
      if (includeTv) requests.push(fetchPresetTmdbPages('discover/tv', {
        ...baseParams,
        'first_air_date.gte': releasedAfter,
        'first_air_date.lte': releasedBefore
      }, PRESET_POPULAR_PAGE_COUNT).then(items => items.map(item => markPresetMediaType(item, 'tv'))).catch(() => []));

      const popularCandidates = filterPresetItemsByMediaType(normalizePresetMediaItems((await Promise.all(requests)).flat(), requestedMediaType), requestedMediaType)
        .filter(item => {
          const releaseDate = getPresetReleaseDate(item);
          if (!releaseDate) return false;
          const releaseMs = Date.parse(`${String(releaseDate).slice(0, 10)}T00:00:00`);
          return Number.isFinite(releaseMs) && releaseMs <= Date.now();
        })
        .slice(0, 96);

      if (popularCandidates.length && typeof window.enrichItemsWithImdbRatings === 'function') {
        try { await window.enrichItemsWithImdbRatings(popularCandidates, requestedMediaType); } catch (_) {}
      }

      popularCandidates.sort((a, b) => {
        const aVotes = Number(a.imdbVotes || 0);
        const bVotes = Number(b.imdbVotes || 0);
        const aHasVotes = aVotes > 0;
        const bHasVotes = bVotes > 0;
        if (aHasVotes !== bHasVotes) return bHasVotes ? 1 : -1;
        if (bVotes !== aVotes) return bVotes - aVotes;

        const aRating = Number(a.imdbRating || 0);
        const bRating = Number(b.imdbRating || 0);
        const aHasRating = aRating > 0;
        const bHasRating = bRating > 0;
        if (aHasRating !== bHasRating) return bHasRating ? 1 : -1;
        if (bRating !== aRating) return bRating - aRating;

        const popDelta = Number(b.popularity || 0) - Number(a.popularity || 0);
        if (popDelta) return popDelta;

        const releaseDelta = Date.parse(`${getPresetReleaseDate(b)}T00:00:00`) - Date.parse(`${getPresetReleaseDate(a)}T00:00:00`);
        if (Number.isFinite(releaseDelta) && releaseDelta) return releaseDelta;

        return String(getPresetTitle(a)).localeCompare(String(getPresetTitle(b)));
      });

      return popularCandidates.slice(0, PRESET_RESULT_LIMIT);
    }

    if (preset === 'decade') {
      const start = Number(config.decadeStart || 0);
      const end = start + 9;
      if (includeMovie) requests.push(fetchPresetTypedTmdb('discover/movie', {
        ...baseParams,
        'primary_release_date.gte': `${start}-01-01`,
        'primary_release_date.lte': `${end}-12-31`
      }, 'movie'));
      if (includeTv) requests.push(fetchPresetTypedTmdb('discover/tv', {
        ...baseParams,
        'first_air_date.gte': `${start}-01-01`,
        'first_air_date.lte': `${end}-12-31`
      }, 'tv'));
      return enrichAndRankPresetItems((await Promise.all(requests)).flat(), 'popular', requestedMediaType);
    }

    if (preset === 'genre') {
      const genreId = String(config.genreId || '');
      const releasedAfter = getPresetStartOfCurrentYear();
      const releasedBefore = getPresetDate(0);
      if (includeMovie) requests.push(fetchPresetTypedTmdb('discover/movie', {
        ...baseParams,
        with_genres: genreId,
        'vote_count.gte': '20',
        'primary_release_date.gte': releasedAfter,
        'primary_release_date.lte': releasedBefore
      }, 'movie'));
      if (includeTv) requests.push(fetchPresetTypedTmdb('discover/tv', {
        ...baseParams,
        with_genres: genreId,
        'vote_count.gte': '10',
        'first_air_date.gte': releasedAfter,
        'first_air_date.lte': releasedBefore
      }, 'tv'));
      const genreCandidates = filterPresetItemsByMediaType(normalizePresetMediaItems((await Promise.all(requests)).flat(), requestedMediaType), requestedMediaType)
        .filter(item => {
          const releaseDate = getPresetReleaseDate(item);
          if (!releaseDate) return false;
          const releaseMs = Date.parse(`${String(releaseDate).slice(0, 10)}T00:00:00`);
          return Number.isFinite(releaseMs) && releaseMs <= Date.now();
        })
        .slice(0, 96);

      if (genreCandidates.length && typeof window.enrichItemsWithImdbRatings === 'function') {
        try { await window.enrichItemsWithImdbRatings(genreCandidates, requestedMediaType); } catch (_) {}
      }

      const requestedGenre = String(config.title || '').trim();
      genreCandidates.sort((a, b) => {
        const aGenreWeight = getPresetPrimaryGenreWeight(a, requestedGenre);
        const bGenreWeight = getPresetPrimaryGenreWeight(b, requestedGenre);
        if (bGenreWeight !== aGenreWeight) return bGenreWeight - aGenreWeight;

        const aVotes = Number(a.imdbVotes || 0);
        const bVotes = Number(b.imdbVotes || 0);
        const aHasVotes = aVotes > 0;
        const bHasVotes = bVotes > 0;
        if (aHasVotes !== bHasVotes) return bHasVotes ? 1 : -1;
        if (bVotes !== aVotes) return bVotes - aVotes;

        const aRating = Number(a.imdbRating || 0);
        const bRating = Number(b.imdbRating || 0);
        const aHasRating = aRating > 0;
        const bHasRating = bRating > 0;
        if (aHasRating !== bHasRating) return bHasRating ? 1 : -1;
        if (bRating !== aRating) return bRating - aRating;

        const popDelta = Number(b.popularity || 0) - Number(a.popularity || 0);
        if (popDelta) return popDelta;

        return String(getPresetTitle(a)).localeCompare(String(getPresetTitle(b)));
      });

      return genreCandidates.slice(0, PRESET_RESULT_LIMIT);
    }

    if (preset === 'service') {
      if (!config.providerId) return fetchPresetDirect({ preset: 'popular' });
      if (includeMovie) requests.push(fetchPresetTypedTmdb('discover/movie', {
        ...baseParams,
        with_watch_providers: String(config.providerId),
        with_watch_monetization_types: 'flatrate|free|ads|rent|buy'
      }, 'movie'));
      if (includeTv) requests.push(fetchPresetTypedTmdb('discover/tv', {
        ...baseParams,
        with_watch_providers: String(config.providerId),
        with_watch_monetization_types: 'flatrate|free|ads|rent|buy'
      }, 'tv'));
      return enrichAndRankPresetItems((await Promise.all(requests)).flat(), 'popular', requestedMediaType);
    }

    if (preset === 'upcoming' || preset === 'anticipated') {
      const tomorrow = getPresetDate(1);
      const oneYearOut = getPresetDate(365);
      if (includeMovie) requests.push(fetchPresetTypedTmdb('discover/movie', {
        ...baseParams,
        'primary_release_date.gte': tomorrow,
        'primary_release_date.lte': oneYearOut
      }, 'movie'));
      if (includeTv) requests.push(fetchPresetTypedTmdb('discover/tv', {
        ...baseParams,
        'first_air_date.gte': tomorrow,
        'first_air_date.lte': oneYearOut
      }, 'tv'));
      const futureItems = filterPresetItemsByMediaType(normalizePresetMediaItems((await Promise.all(requests)).flat(), requestedMediaType), requestedMediaType)
        .filter(item => Date.parse(`${getPresetReleaseDate(item)}T00:00:00`) > Date.now());
      return enrichAndRankPresetItems(futureItems, 'anticipated', requestedMediaType);
    }

    const [movies, tv] = await Promise.all([
      fetchPresetTypedTmdb('discover/movie', baseParams, 'movie'),
      fetchPresetTypedTmdb('discover/tv', baseParams, 'tv')
    ]);
    return enrichAndRankPresetItems([...movies, ...tv], preset === 'rated' ? 'topRated' : 'popular', requestedMediaType);
  }

  async function loadPresetResults(config = {}, panelId = '') {
    const token = ++presetResultToken;
    const selector = `[data-preset-results="${CSS.escape(String(panelId))}"]`;
    const target = () => document.querySelector(selector);
    try {
      const items = await fetchPresetDirect(config);
      if (token !== presetResultToken) return;
      const root = target();
      if (!root) return;
      if (!items?.length) {
        root.innerHTML = `<div class="shelfd-search-preset-empty-state">No titles found for this preset right now.</div>`;
        return;
      }
      root.innerHTML = renderPresetResultGrid(items);
    } catch (error) {
      console.error('Search preset results failed:', config, error);
      const root = target();
      if (root) root.innerHTML = `<div class="shelfd-search-preset-empty-state">This preset could not load. Try again later.</div>`;
    }
  }

  function renderPresetResultGrid(items = []) {
    return `<div class="shelfd-search-preset-grid">${
      items.map(item => renderPresetResultCard(item)).join('')
    }</div>`;
  }

  function renderPresetResultCard(item = {}) {
    if (String(item.kind || item.source || '').toLowerCase() === 'game' || String(item.source || '').toLowerCase() === 'rawg') {
      return renderPresetGameResultCard(item);
    }
    const type = item.media_type === 'movie' ? 'movie' : 'tv';
    const title = getPresetTitle(item);
    const poster = tmdbPoster(item.poster_path, 'w342');
    const year = String(getPresetReleaseDate(item) || '').slice(0, 4);
    const rating = typeof window.formatDisplayTitleRating === 'function'
      ? window.formatDisplayTitleRating(item)
      : (Number(item.imdbRating || 0) > 0 ? (Number(item.imdbRating) / 2).toFixed(1) : '');
    const meta = [year, type === 'movie' ? 'Movie' : 'TV'].filter(Boolean).join(' · ');
    return `
      <button type="button" class="shelfd-search-preset-title-card" onclick="handleSearchPresetMediaClick(event, '${escAttr(type)}', '${escAttr(item.id)}')" title="${escAttr(title)}">
        <span class="shelfd-search-preset-poster">
          ${poster ? `<img src="${escAttr(poster)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}
          ${rating ? `<span class="shelfd-search-preset-rating"><span aria-hidden="true">★</span>${escHtml(rating)}</span>` : ''}
        </span>
        <span class="shelfd-search-preset-card-title">${escHtml(title)}</span>
        ${meta ? `<span class="shelfd-search-preset-card-meta">${escHtml(meta)}</span>` : ''}
      </button>`;
  }

  function renderPresetGameResultCard(item = {}) {
    const itemSource = String(item.source || '').trim().toLowerCase() || 'rawg';
    const rawgId = itemSource === 'rawg'
      ? String(item.rawgId || item.rawg_id || item.id || '').trim()
      : String(item.rawgId || item.rawg_id || '').trim();
    const igdbId = String(item.igdbId || item.igdb_id || item.sourceId || (itemSource === 'igdb' ? String(item.id || '').replace(/^igdb:/i, '') : '') || '').trim();
    const gameKey = rawgId || (igdbId ? `igdb:${igdbId}` : String(item.id || '').trim());
    const title = item.name || item.title || '';
    const poster = gamePoster(item);
    const year = String(getPresetGameReleaseDate(item) || '').slice(0, 4);
    const rating = Number(item.rating || 0) > 0 ? Number(item.rating).toFixed(1) : '';
    const meta = [year, 'Game'].filter(Boolean).join(' · ');
    if (gameKey) {
      const seed = {
        id: gameKey,
        gameIdentityKey: gameKey,
        rawgId,
        igdbId,
        sourceId: item.sourceId || igdbId || rawgId,
        title,
        name: title,
        released: item.released || '',
        background_image: poster,
        cover: poster,
        poster,
        image: poster,
        igdbCoverUrl: item.igdbCoverUrl || item.igdbCover || '',
        rating: item.rating || '',
        metacritic: item.metacritic || '',
        genres: item.genres || [],
        themes: item.themes || [],
        platforms: item.platforms || [],
        stores: item.stores || [],
        hypes: item.hypes || 0,
        follows: item.follows || 0,
        total_rating_count: item.total_rating_count || 0,
        rating_count: item.rating_count || 0,
        aggregated_rating_count: item.aggregated_rating_count || 0,
        source: itemSource
      };
      presetGameResultSeeds.set(gameKey, seed);
      if (rawgId) presetGameResultSeeds.set(rawgId, seed);
    }
    return `
      <button type="button" class="shelfd-search-preset-title-card" onclick="handleSearchPresetGameClick(event, '${escAttr(gameKey)}')" title="${escAttr(title)}">
        <span class="shelfd-search-preset-poster">
          ${poster ? `<img src="${escAttr(poster)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}
          ${rating ? `<span class="shelfd-search-preset-rating"><span aria-hidden="true">★</span>${escHtml(rating)}</span>` : ''}
        </span>
        <span class="shelfd-search-preset-card-title">${escHtml(title)}</span>
        ${meta ? `<span class="shelfd-search-preset-card-meta">${escHtml(meta)}</span>` : ''}
      </button>`;
  }

  window.handleSearchPresetMediaClick = function(event, type, id) {
    if (typeof window.openDiscoverMediaProfile === 'function') {
      try { window.openDiscoverMediaProfile(event, type, id, event?.currentTarget || null); }
      catch (e) { console.error('Open preset media profile failed:', e); }
    }
  };

  window.handleSearchPresetGameClick = function(event, gameKey) {
    const id = String(gameKey || '').trim();
    if (!id || typeof window.openGameMediaProfile !== 'function') return;
    const seed = presetGameResultSeeds.get(id) || { id, rawgId: /^\d+$/.test(id) ? id : '', igdbId: id.match(/^igdb:(\d+)$/i)?.[1] || '', source: id.startsWith('igdb:') ? 'igdb' : 'rawg' };
    try {
      if (typeof window.setGameMediaProfileSeed === 'function') window.setGameMediaProfileSeed(id, seed);
      window.openGameMediaProfile(event, id, seed, event?.currentTarget || null);
    } catch (e) {
      console.error('Open preset game profile failed:', e);
    }
  };

  /* =========================================================================
     v10.492 — Bucket-first Universal Search ranking
     -------------------------------------------------------------------------
     PROBLEM with the previous v737–v740 scorer (replaced below): it was a
     FLAT additive model — `final = relevance_tier + log10(popularity) * 200`.
     The popularity boost (capped at +900) was wide enough to let a popular
     SUBSTRING match (tier 300 + ~700 boost = ~1000) BEAT an exact match
     with low popularity (tier 1000 + ~50 boost = ~1050) … actually winning
     by margin, BUT the gap was thin enough that ordering felt random in
     the real world. The user reported (and we confirmed) that strong
     intent matches were getting outranked by mid-quality popular results.

     NEW MODEL — every result first lands in a discrete MATCH BUCKET:
       100 = exact canonical title/name match
        95 = exact alias / alternate-title match
        90 = title/name starts with the query
        85 = all query words present in order
        80 = all query words present out of order
        70 = strong partial / word-boundary match
        60 = typo / fuzzy match (reserved — no impl yet, costly)
        40 = weak substring match
         0 = no useful match → DROPPED

     Popularity NEVER lets a weaker bucket beat a stronger bucket. Within
     a bucket we order by:
       1. intent match  (All-tab only; query words like "movie"/"actor"/etc.)
       2. text sub-score (length-of-title vs query, prefix tightness, etc.)
       3. authority signal (log10 of source-specific popularity)
       4. rating / vote confidence
       5. release year (newer wins)
       6. quality / completeness (poster + id + year + overview)
       7. title alphabetical (last resort)

     Aliases are exposed on every normalized row via `aliases: []`. The
     scorer checks canonical first, then each alias; an alias-only exact
     match downgrades 100 → 95 so a true canonical match still beats it.

     MUSIC IS PRESERVED: the music filter's existing artist→promoted-tracks
     →albums→background-tracks ordering (from fetchMusicSearchResults) is
     the best-performing music model, so for activeFilter === 'music' we
     SKIP the universal sort entirely. We still dedupe and filter zero-
     bucket items but we honor source order.
     ========================================================================= */
  const SHELFD_SEARCH_INTENT_PATTERNS = [
    { kind: 'movie',  rx: /\b(movie|movies|film|films|flick|flicks)\b/i },
    { kind: 'tv',     rx: /\b(show|shows|series|tv|episode|episodes|season|seasons|sitcom)\b/i },
    { kind: 'anime',  rx: /\b(anime|manga|otaku|shounen|shonen|seinen|isekai)\b/i },
    { kind: 'game',   rx: /\b(game|games|gaming|videogame|video\s*game)\b/i },
    { kind: 'music',  rx: /\b(song|songs|track|tracks|album|albums|artist|artists|band|bands)\b/i },
    { kind: 'person', rx: /\b(actor|actress|actors|actresses|director|cast|star|stars)\b/i }
  ];

  function shelfdSearchNormalize(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')   /* strip accents */
      .replace(/[‘’‚‛]/g, "'")        /* normalize quotes */
      .replace(/[“”„‟]/g, '"')
      .replace(/[-_:.,/'"!?&()\[\]{}|\\]/g, ' ')           /* punctuation→space */
      .replace(/\s+/g, ' ').trim();
  }

  /* v10.494: stop-word fallback. Queries like "the Batman" should still
     surface major Batman entries (Batman 1989, Batman Begins, …) even
     though those titles don't literally contain "the". The fallback
     re-scores with stop words stripped and caps the result at bucket 70
     so true exact / prefix matches still win the top slot. */
  const SHELFD_SEARCH_STOP_WORDS = new Set(['the', 'a', 'an']);
  function shelfdStripStopWords(q) {
    if (!q) return '';
    return q.split(' ').filter(w => w && !SHELFD_SEARCH_STOP_WORDS.has(w)).join(' ');
  }

  /* v10.494: bounded Levenshtein for fuzzy-bucket (60) rescue. Uses
     Wagner–Fischer with an early bail-out when the running row-min
     exceeds `maxAllowed`, so worst-case cost is bounded by the
     allowed edit budget — fast enough to run per-result at typing
     speed. Returns Infinity when the strings are too different. */
  function shelfdEditDistance(a, b, maxAllowed = 2) {
    const sA = String(a || ''); const sB = String(b || '');
    if (sA === sB) return 0;
    if (!sA || !sB) return Math.max(sA.length, sB.length);
    const m = sA.length, n = sB.length;
    if (Math.abs(m - n) > maxAllowed) return Infinity;
    const prev = new Array(n + 1);
    const curr = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      let rowMin = i;
      for (let j = 1; j <= n; j++) {
        const cost = sA.charCodeAt(i - 1) === sB.charCodeAt(j - 1) ? 0 : 1;
        const d = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        curr[j] = d;
        if (d < rowMin) rowMin = d;
      }
      if (rowMin > maxAllowed) return Infinity;
      for (let j = 0; j <= n; j++) prev[j] = curr[j];
    }
    return prev[n];
  }

  /* v10.494: bucket-60 fuzzy scoring. ONLY called when no higher
     bucket matched (the main scorer returned 0). Two strategies:
       (1) full-string edit distance against the normalized title
           — catches single-typo cases like "spder man" → "spider man"
       (2) per-word edit distance — every query word must fuzzy-match
           a title word, total edits across all words ≤ a small budget
     We require query length ≥ 4 to avoid swamping short queries with
     noise (a 2-char query would fuzzy-match almost anything). */
  function shelfdFuzzyScore(rawText, q, qWords) {
    if (!q || q.length < 4) return { bucket: 0, sub: 0 };
    const t = shelfdSearchNormalize(rawText);
    if (!t) return { bucket: 0, sub: 0 };

    /* Full-string fuzzy. Tight budget so we don't match unrelated titles. */
    const fullBudget = q.length >= 7 ? 2 : 1;
    const fullDist = shelfdEditDistance(t, q, fullBudget);
    if (fullDist <= fullBudget) {
      return { bucket: 60, sub: 200 - fullDist * 50 };  /* sub 150 or 100 */
    }

    /* Per-word fuzzy. Every query word must fuzzy-match some title
       word; total edits across words ≤ 2. Skip query words < 3 chars
       (they're too noisy under any edit budget). */
    if (qWords.length >= 1) {
      const tWords = t.split(' ').filter(Boolean);
      let totalDist = 0;
      let allMatched = true;
      for (const qw of qWords) {
        if (qw.length < 3) { allMatched = false; break; }
        const wordBudget = qw.length >= 6 ? 2 : 1;
        let bestWord = Infinity;
        for (const tw of tWords) {
          const d = shelfdEditDistance(qw, tw, wordBudget);
          if (d < bestWord) bestWord = d;
          if (bestWord === 0) break;
        }
        if (bestWord > wordBudget) { allMatched = false; break; }
        totalDist += bestWord;
        if (totalDist > 2) { allMatched = false; break; }
      }
      if (allMatched && totalDist > 0) {
        return { bucket: 60, sub: 180 - totalDist * 40 };  /* 140 / 100 */
      }
    }
    return { bucket: 0, sub: 0 };
  }

  /* v10.494: safe acronym generator. Only used by GAMES (the canonical
     abbreviation user case — players say "GTA", "RDR2", "TLOZ"). Movie
     and music acronyms aren't idiomatic and would just noise the index.
     Rules:
       • Skip titles with fewer than 3 tokens.
       • Detect a terminal roman numeral (I–X) or 1–2 digit number;
         strip it as the "suffix", build the acronym from the
         remaining tokens, and emit:
           [letters][suffix]                          (GTAV)
           [letters] [suffix]                         (GTA V)
           [letters][arabicSuffix]   (if roman)       (GTA5)
           [letters] [arabicSuffix]  (if roman)       (GTA 5)
       • No terminal suffix → only the bare acronym (GTA, RDR, COD,
         TLOZ). Require ≥ 3 chars (skip "FF", "CC", etc — too noisy).
       • Acronyms are case-preserved-uppercase; the bucket scorer
         normalizes both sides to lowercase before comparing. */
  function shelfdGenerateGameAcronymAliases(title) {
    const out = [];
    const raw = String(title || '').trim();
    if (!raw) return out;
    const tokens = raw.split(/\s+/).filter(Boolean);
    if (tokens.length < 3) return out;

    const ROMAN_NUMERALS = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
    const last = tokens[tokens.length - 1];
    const lastLow = last.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const isRoman = Object.prototype.hasOwnProperty.call(ROMAN_NUMERALS, lastLow);
    const isNumeric = /^\d{1,2}$/.test(lastLow);

    let coreTokens, suffix, arabicSuffix;
    if (isRoman || isNumeric) {
      coreTokens = tokens.slice(0, -1);
      suffix = last;
      arabicSuffix = isRoman ? String(ROMAN_NUMERALS[lastLow]) : null;
    } else {
      coreTokens = tokens;
      suffix = '';
      arabicSuffix = null;
    }
    if (coreTokens.length < 2) return out;

    /* Build letter acronym — keep stop words inside (Call of Duty → COD,
       The Legend of Zelda → TLOZ). Strip leading non-alphanumerics from
       each token so things like "(2025)" don't poison the letters. */
    const letters = coreTokens
      .map(t => String(t || '').replace(/^[^a-z0-9]+/i, '').charAt(0).toUpperCase())
      .filter(c => /[A-Z0-9]/.test(c))
      .join('');
    if (letters.length > 6) return out;  /* 7+ letter "acronyms" are noise */

    if (suffix) {
      /* Suffix variant: allow 2-letter base (FF VII → FFVII / FF7) */
      if (letters.length < 2) return out;
      out.push(`${letters}${suffix}`);
      out.push(`${letters} ${suffix}`);
      if (arabicSuffix && arabicSuffix !== suffix) {
        out.push(`${letters}${arabicSuffix}`);
        out.push(`${letters} ${arabicSuffix}`);
      }
    } else {
      /* Bare acronym: require 3+ letters to avoid noisy 2-char matches. */
      if (letters.length < 3) return out;
      out.push(letters);
    }
    return out;
  }

  function shelfdScoreCandidate(rawText, q, qNoSpace, qWords) {
    const t = shelfdSearchNormalize(rawText);
    if (!t || !q) return { bucket: 0, sub: 0 };
    const tNoSpace = t.replace(/\s+/g, '');
    const tWords = t.split(' ').filter(Boolean);

    /* 100 — exact match (space-collapsed forms compared too, so
       "spiderman" === "spider man") */
    if (t === q || tNoSpace === qNoSpace) {
      return { bucket: 100, sub: 1000 };
    }
    /* 90 — prefix match. Sub-score favors shorter titles (the closer
       the title length to the query length, the tighter the prefix). */
    if (t.startsWith(q + ' ') || tNoSpace.startsWith(qNoSpace)) {
      const lenRatio = q.length / Math.max(1, t.length);
      return { bucket: 90, sub: Math.round(500 + 500 * lenRatio) };
    }
    /* 85 — all query words present IN ORDER (each query word matches a
       title word at a later index than the previous). Multi-word
       queries only. */
    if (qWords.length > 1) {
      let pos = -1, ok = true;
      for (const qw of qWords) {
        const idx = tWords.findIndex((tw, i) => i > pos && (tw === qw || tw.startsWith(qw)));
        if (idx < 0) { ok = false; break; }
        pos = idx;
      }
      if (ok) return { bucket: 85, sub: 700 };
    }
    /* 80 — all query words present out of order. */
    if (qWords.length && qWords.every(qw => tWords.some(tw => tw === qw || tw.startsWith(qw)))) {
      return { bucket: 80, sub: 600 };
    }
    /* 70 — word-boundary substring (query as a phrase appears within
       the title with a space before or after). */
    if (t.includes(' ' + q) || t.includes(q + ' ')) {
      return { bucket: 70, sub: 500 };
    }
    /* 40 — weak substring match (query appears anywhere). */
    if (t.includes(q) || tNoSpace.includes(qNoSpace)) {
      return { bucket: 40, sub: 300 };
    }
    /* 40 (weaker) — every query word appears somewhere as substring. */
    if (qWords.length && qWords.every(qw => t.includes(qw))) {
      return { bucket: 40, sub: 100 };
    }
    return { bucket: 0, sub: 0 };
  }

  function shelfdBestBucketAcross(row, q, qNoSpace, qWords) {
    let best = { bucket: 0, sub: 0, isAlias: false };
    /* Canonical first. */
    const canon = shelfdScoreCandidate(row.title, q, qNoSpace, qWords);
    if (canon.bucket > best.bucket || (canon.bucket === best.bucket && canon.sub > best.sub)) {
      best = { bucket: canon.bucket, sub: canon.sub, isAlias: false };
    }
    /* Aliases — exact (100) downgrades to 95 to keep canonical priority. */
    const aliases = Array.isArray(row.aliases) ? row.aliases : [];
    for (const a of aliases) {
      const s = shelfdScoreCandidate(a, q, qNoSpace, qWords);
      let bucket = s.bucket;
      if (bucket === 100) bucket = 95;
      if (bucket > best.bucket || (bucket === best.bucket && s.sub > best.sub)) {
        best = { bucket, sub: s.sub, isAlias: true };
      }
    }
    /* v10.494: stop-word-tolerant fallback. If the main scorer found
       nothing (or only a weak ≤40 bucket), try again with stop words
       stripped from the query. Cap the rescued bucket at 70 so true
       exact/prefix matches still dominate (e.g. "The Batman" still
       puts The Batman (2022) #1 at bucket 100, while Batman (1989)
       gets rescued at bucket 70 instead of being dropped). */
    if (best.bucket < 70) {
      const strippedQ = shelfdStripStopWords(q);
      if (strippedQ && strippedQ !== q && strippedQ.length >= 2) {
        const sQNoSpace = strippedQ.replace(/\s+/g, '');
        const sQWords = strippedQ.split(' ').filter(Boolean);
        const trySrc = (text, isAlias) => {
          const s = shelfdScoreCandidate(text, strippedQ, sQNoSpace, sQWords);
          let bucket = s.bucket;
          /* Cap at 70 regardless of how strong the stripped match was —
             stop-word removal can never beat a true match in the
             original query. */
          if (bucket > 70) bucket = 70;
          if (bucket > best.bucket) {
            best = { bucket, sub: Math.max(0, s.sub - 200), isAlias };
          }
        };
        trySrc(row.title, false);
        for (const a of aliases) trySrc(a, true);
      }
    }
    /* v10.494: bucket-60 fuzzy fallback. Only when no stronger bucket
       matched at all — never lets fuzzy out-rank exact / prefix /
       all-word / word-boundary / stop-word-rescued / weak-substring. */
    if (best.bucket === 0) {
      const fz = shelfdFuzzyScore(row.title, q, qWords);
      if (fz.bucket > 0) {
        best = { bucket: fz.bucket, sub: fz.sub, isAlias: false };
      } else {
        for (const a of aliases) {
          const fzA = shelfdFuzzyScore(a, q, qWords);
          if (fzA.bucket > 0) {
            best = { bucket: fzA.bucket, sub: fzA.sub, isAlias: true };
            break;
          }
        }
      }
    }
    return best;
  }

  function shelfdDetectIntent(query) {
    const out = new Set();
    if (!query) return out;
    for (const p of SHELFD_SEARCH_INTENT_PATTERNS) {
      if (p.rx.test(query)) out.add(p.kind);
    }
    return out;
  }

  function shelfdKindIntent(row) {
    if (!row) return null;
    if (row.kind === 'movie' || row.kind === 'tv' || row.kind === 'anime' || row.kind === 'game' || row.kind === 'person') {
      return row.kind;
    }
    if (row.kind === 'music' || row.kind === 'artist') return 'music';
    return null;
  }

  function shelfdAuthority(row) {
    const n = Math.max(0, Number(row?.popularity) || 0);
    return n ? Math.log10(n + 1) : 0;   /* 0..~6 for our sources */
  }

  function shelfdQualityScore(row) {
    let q = 0;
    if (row?.poster) q += 2;            /* having an image matters most */
    if (row?.id) q += 1;                /* provider id present */
    if (row?.year) q += 1;
    if (row?.overview && row.overview.length > 10) q += 1;
    return q;
  }

  function shelfdIsIncomplete(row) {
    /* Rows with no poster AND no provider id are usually garbage — keep
       only when they're an exact canonical match. */
    return !row?.poster && !row?.id;
  }

  function shelfdDedupeRows(rows) {
    const seenIds = new Set();
    const seenSig = new Map();
    const out = [];
    for (const r of rows) {
      if (!r) continue;
      if (r.id) {
        const k = `${r.kind || ''}:${r.id}`;
        if (seenIds.has(k)) continue;
        seenIds.add(k);
      }
      /* Soft dedupe on (kind|normalized title|year) — catches the case
         where IGDB + RAWG both returned the same game under different
         ids. Keep the higher-quality survivor. */
      const sig = `${r.kind || ''}|${shelfdSearchNormalize(r.title)}|${r.year || ''}|${r.subkind || ''}`;
      const existing = seenSig.get(sig);
      if (existing) {
        if (shelfdQualityScore(r) > shelfdQualityScore(existing)) {
          const idx = out.indexOf(existing);
          if (idx >= 0) out.splice(idx, 1);
          seenSig.set(sig, r);
          out.push(r);
        }
        continue;
      }
      seenSig.set(sig, r);
      out.push(r);
    }
    return out;
  }

  function shelfdCompareRows(a, b) {
    /* Bucket-first. NEVER lets popularity flip a bucket. */
    if (a._bucket !== b._bucket) return b._bucket - a._bucket;
    /* Intent match within bucket. */
    if ((a._intent || 0) !== (b._intent || 0)) return (b._intent || 0) - (a._intent || 0);
    /* Text sub-score within bucket+intent. */
    if (a._sub !== b._sub) return b._sub - a._sub;
    /* Authority — log popularity. */
    const aAuth = a._authority || 0, bAuth = b._authority || 0;
    if (aAuth !== bAuth) return bAuth - aAuth;
    /* Rating confidence. */
    const ar = parseFloat(a.rating || '0') || 0;
    const br = parseFloat(b.rating || '0') || 0;
    if (ar !== br) return br - ar;
    /* Year — newer wins. */
    const ay = parseInt(a.year || '0', 10) || 0;
    const by = parseInt(b.year || '0', 10) || 0;
    if (ay !== by) return by - ay;
    /* Completeness. */
    const aq = shelfdQualityScore(a), bq = shelfdQualityScore(b);
    if (aq !== bq) return bq - aq;
    /* Alphabetical last resort. */
    return (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });
  }

  /* ---------- Search ---------- */
  async function runSearch(rawQuery) {
    const query = String(rawQuery || '').trim();
    activeQuery = query;
    const myToken = ++queryToken;

    const empty = $('shelfd-search-empty');
    const results = $('shelfd-search-results');
    const status = $('shelfd-search-status');
    if (!empty || !results || !status) return;

    if (!query) {
      results.hidden = true; results.innerHTML = '';
      status.hidden = true; status.innerHTML = '';
      empty.hidden = false;
      renderRecents();
      return;
    }

    empty.hidden = true;
    results.hidden = true;
    status.hidden = false;
    status.innerHTML = renderSkeletonRows(5);

    let tmdbItems = [];
    let gameItems = [];
    let jikanItems = [];
    let personItems = [];
    let musicItems = [];
    try {
      const tasks = [];
      /* v654: anime filter no longer pulls TMDB. Only the 'all' tab and the
         non-anime TMDB filters touch TMDB. Anime is fetched from Jikan in
         parallel for both 'all' and 'anime'.
         v10.232: music filter — MusicBrainz release-group search via the
         existing Cloudflare Worker proxy.
         v10.494: people ARE now fetched in the All tab. The v732 rule that
         excluded them was overly aggressive — the bucket-first scorer +
         flood guard (max 2 person rows in top 10) make person rows
         additive rather than dilutive. Queries like "Tom Holland" now
         surface the actor in All, and "tom holland actor" gets person
         rows boosted by intent detection. */
      const wantTmdb = activeFilter === 'all' || activeFilter === 'movie' || activeFilter === 'tv';
      const wantJikanAnime = activeFilter === 'all' || activeFilter === 'anime';
      const wantGames = activeFilter === 'all' || activeFilter === 'game';
      const wantPeople = activeFilter === 'all' || activeFilter === 'person';
      const wantMusic = activeFilter === 'all' || activeFilter === 'music';

      if (wantTmdb && typeof window.fetchTmdbSearchResults === 'function') {
        /* v739: strictPrefix:false → don't drop non-prefix-matching items.
           The page has its own normalized relevance + popularity ranker. */
        tasks.push(window.fetchTmdbSearchResults(query, { strictPrefix: false }).then(arr => { tmdbItems = Array.isArray(arr) ? arr : []; }).catch(() => {}));
      }
      if (wantJikanAnime && window.JikanAnime?.searchAnime) {
        tasks.push(window.JikanAnime.searchAnime(query, 12).then(arr => {
          jikanItems = (arr || []).map(window.JikanAnime.mapItem).filter(Boolean);
        }).catch(() => {}));
      }
      if (wantGames && typeof window.fetchRawgSearchResults === 'function') {
        /* v739: strictPrefix:false — see TMDB note above. */
        tasks.push(window.fetchRawgSearchResults(query, { strictPrefix: false }).then(arr => { gameItems = Array.isArray(arr) ? arr : []; }).catch(() => {}));
      }
      if (wantPeople && typeof window.fetchTmdbPersonSearchResults === 'function') {
        tasks.push(window.fetchTmdbPersonSearchResults(query).then(arr => { personItems = Array.isArray(arr) ? arr : []; }).catch(() => {}));
      }
      if (wantMusic) {
        tasks.push(fetchMusicSearchResults(query).then(arr => { musicItems = Array.isArray(arr) ? arr : []; }).catch(() => {}));
      }
      await Promise.all(tasks);
    } catch (_) { /* swallowed; will show no-results */ }

    if (myToken !== queryToken) return;

    /* v671: Enrich movie/TV results with IMDb rating before normalizing so
       r.rating only reflects OMDb/IMDb. Games keep RAWG's own rating. */
    if (typeof window.enrichItemsWithImdbRatings === 'function' && tmdbItems.length) {
      try { await window.enrichItemsWithImdbRatings(tmdbItems); } catch (e) { /* fail soft: leave rating blank */ }
      if (myToken !== queryToken) return;
    }

    /* v654: Filter out anime from TMDB results so we don't double-list when
       'all' is active (Jikan handles anime exclusively). */
    const dropAnimeFromTmdb = (arr) => arr.filter(x =>
      !(typeof window.isAnimeDiscoverCandidate === 'function' && window.isAnimeDiscoverCandidate(x))
    );

    /* Apply filter */
    let rows = [];
    if (activeFilter === 'all') {
      rows = [
        ...dropAnimeFromTmdb(tmdbItems).map(normalizeTmdbItem),
        ...jikanItems.map(normalizeTmdbItem),  /* same shape — just routes id/poster from Jikan */
        ...gameItems.map(normalizeGameItem),
        ...musicItems.map(normalizeMusicItem),
        /* v10.494: include people in All. Flood guard caps person rows
           at 2 in top 10 unless the query has explicit person intent
           ("actor", "actress", "director", etc.) so name-collision
           queries like "Drake" don't push 4 random Drakes to the top. */
        ...personItems.map(normalizePersonItem)
      ];
    } else if (activeFilter === 'movie') {
      rows = tmdbItems.filter(x => x.media_type === 'movie').map(normalizeTmdbItem);
    } else if (activeFilter === 'tv') {
      rows = dropAnimeFromTmdb(tmdbItems).filter(x => x.media_type === 'tv').map(normalizeTmdbItem);
    } else if (activeFilter === 'anime') {
      rows = jikanItems.map(normalizeTmdbItem);
    } else if (activeFilter === 'game') {
      rows = gameItems.map(normalizeGameItem);
    } else if (activeFilter === 'person') {
      rows = personItems.map(normalizePersonItem);
    } else if (activeFilter === 'music') {
      rows = musicItems.map(normalizeMusicItem);
    }

    /* v10.492: NEW bucket-first ranking pipeline.
       See the block-comment above this function for the full design
       rationale (replaces the v737–v740 flat additive scorer that let
       popularity overpower stronger text matches). */
    const qN = shelfdSearchNormalize(query);
    const qNoSpace = qN.replace(/\s+/g, '');
    const qWords = qN.split(' ').filter(Boolean);
    const intents = activeFilter === 'all' ? shelfdDetectIntent(query) : new Set();

    /* Music filter: PRESERVE source order from fetchMusicSearchResults
       (artists → promoted tracks → albums → background tracks). The
       existing per-source promotion model is the best music ranking
       we have — flattening it through the universal scorer makes
       results worse. We still dedupe + drop zero-bucket items. */
    if (activeFilter === 'music') {
      rows = shelfdDedupeRows(rows)
        .map(row => {
          const m = shelfdBestBucketAcross(row, qN, qNoSpace, qWords);
          row._bucket = m.bucket;
          row._sub = m.sub;
          return row;
        })
        .filter(row => row._bucket > 0)
        .slice(0, SEARCH_LIMIT);
      lastResultRows = rows;
    } else {
      /* Score every row → bucket + sub + intent + authority. */
      rows = shelfdDedupeRows(rows)
        .map(row => {
          const m = shelfdBestBucketAcross(row, qN, qNoSpace, qWords);
          row._bucket = m.bucket;
          row._sub = m.sub;
          row._intent = intents.size ? (intents.has(shelfdKindIntent(row)) ? 1 : 0) : 0;
          row._authority = shelfdAuthority(row);
          return row;
        })
        /* Drop zero-bucket garbage. */
        .filter(row => row._bucket > 0)
        /* Demote incomplete rows (no image AND no provider id) unless
           they were a canonical exact match (bucket 100). */
        .filter(row => row._bucket >= 100 || !shelfdIsIncomplete(row));

      rows.sort(shelfdCompareRows);

      /* All-tab category-flood guard: when no explicit intent, prevent
         a single kind from filling the entire top of the result list.
         We softly cap any one kind at N in the top 10 by relegating
         excess copies to after the diverse band. Kinds that match a
         detected intent are exempt (we skip the guard entirely).
         v10.494: per-kind caps — `person` is tighter (2) because name
         collisions are common (search "Drake" matches many people).
         Music/artist also tighter (3) because Drake-style alias hits
         can push many albums up. */
      if (activeFilter === 'all' && rows.length > 6 && intents.size === 0) {
        const TOP_WINDOW = 10;
        const DEFAULT_CAP = 4;
        const PER_KIND_CAP = { person: 2, music: 3, artist: 1 };
        const counts = {};
        const top = [];
        const tail = [];
        for (const r of rows) {
          if (top.length >= TOP_WINDOW) { tail.push(r); continue; }
          const k = r.kind || 'x';
          const cap = Object.prototype.hasOwnProperty.call(PER_KIND_CAP, k) ? PER_KIND_CAP[k] : DEFAULT_CAP;
          counts[k] = (counts[k] || 0) + 1;
          if (counts[k] > cap) {
            counts[k] -= 1;
            tail.push(r);
          } else {
            top.push(r);
          }
        }
        rows = top.concat(tail);
      }

      rows = rows.slice(0, SEARCH_LIMIT);
      lastResultRows = rows;
    }

    if (!rows.length) {
      status.hidden = false;
      status.innerHTML = `
        <div class="shelfd-search-noresults">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <strong>No results for &ldquo;${escHtml(query)}&rdquo;</strong>
          <p>Try a shorter title, a different spelling, or another category.</p>
        </div>`;
      results.hidden = true; results.innerHTML = '';
      return;
    }

    status.hidden = true; status.innerHTML = '';
    results.hidden = false;
    results.innerHTML = rows.map((r, i) => renderResultRow(r, i)).join('');
    /* v651: kick off the lazy credits backfill in parallel for all rows. */
    backfillResultCredits(rows, myToken);
  }

  function renderResultRow(r, index) {
    /* v651: 3-line layout —
        1. title
        2. year · media type (combined with dot separator)
        3. directed by [Name] (or "Created by" for TV/anime, "Developed by"
           for games). The credit name is fetched lazily after render
           and patched into the DOM via [data-row-cred-key].
    */
    /* v654: Jikan-sourced anime rows route to the Jikan profile path.
       v732: person rows route to the existing TMDB person profile. */
    const handler = r.kind === 'game'
      ? `handleSearchPageGameClick(event, '${escAttr(r.key)}')`
      : r.kind === 'person'
        ? `handleSearchPagePersonClick(event, '${escAttr(r.id)}')`
        : r.kind === 'music'
          ? `handleSearchPageMusicClick(event, '${escAttr(r.key)}')`
          : r.kind === 'artist'
            ? `handleSearchPageArtistClick(event, '${escAttr(r.key)}')`
            : (r.isJikan
              ? `handleSearchPageJikanClick(event, '${escAttr(r.malId)}')`
              : `handleSearchPageMediaClick(event, '${escAttr(r.tmdbType)}', '${escAttr(r.id)}')`);
    const typeLabel = r.kind === 'movie' ? 'Movie'
      : r.kind === 'tv' ? 'TV Show'
      : r.kind === 'anime' ? 'Anime'
      : r.kind === 'game' ? 'Game'
      : r.kind === 'music' ? (r.subkind === 'track' ? 'Song' : 'Album')
      : r.kind === 'artist' ? (r.artistType || 'Artist')
      : r.kind === 'person' ? (r.role || 'Actor')
      : '';
    /* People show "Actor · Known for: …" instead of "Year · Type". */
    const metaText = r.kind === 'person'
      ? typeLabel
      : [r.year, typeLabel].filter(Boolean).join(' · ');
    const yearTypeHtml = metaText
      ? `<span class="shelfd-search-row-meta">${escHtml(metaText)}</span>`
      : '';
    /* Person rows show "Known for: A, B, C" instead of the lazy credits line. */
    let credHtml = '';
    if (r.kind === 'person') {
      credHtml = r.knownFor
        ? `<span class="shelfd-search-row-credit"><span class="shelfd-search-row-credit-prefix">Known for </span><span class="shelfd-search-row-credit-name">${escHtml(r.knownFor)}</span></span>`
        : '';
    } else if (r.kind === 'music') {
      /* v10.232: music rows render the artist immediately — MusicBrainz
         returns artist-credit inline in the search response, no lazy fetch
         needed.
         v10.466: track rows append the parent album so the user knows
         where the tap will land. Reads as "By Kanye West · Bully". */
      if (r.subkind === 'track') {
        const parts = [r.artist, r.albumName].filter(Boolean).join(' · ');
        credHtml = parts
          ? `<span class="shelfd-search-row-credit"><span class="shelfd-search-row-credit-prefix">By </span><span class="shelfd-search-row-credit-name">${escHtml(parts)}</span></span>`
          : '';
      } else {
        credHtml = r.artist
          ? `<span class="shelfd-search-row-credit"><span class="shelfd-search-row-credit-prefix">By </span><span class="shelfd-search-row-credit-name">${escHtml(r.artist)}</span></span>`
          : '';
      }
    } else if (r.kind === 'artist') {
      /* v10.234: artist rows show disambiguation/country as a subtitle. */
      const sub = r.disambiguation || r.country || '';
      credHtml = sub
        ? `<span class="shelfd-search-row-credit"><span class="shelfd-search-row-credit-name">${escHtml(sub)}</span></span>`
        : '';
    } else {
      const credPrefix = r.kind === 'movie' ? 'Directed by'
        : (r.kind === 'tv' || r.kind === 'anime') ? 'Created by'
        : r.kind === 'game' ? 'Developed by'
        : '';
      credHtml = credPrefix
        ? `<span class="shelfd-search-row-credit" data-row-cred-key="${escAttr(r.key)}"><span class="shelfd-search-row-credit-prefix">${escHtml(credPrefix)} </span><span class="shelfd-search-row-credit-name">&hellip;</span></span>`
        : '';
    }
    const posterClass = r.kind === 'person'
      ? 'shelfd-search-row-poster shelfd-search-row-poster--person'
      : 'shelfd-search-row-poster';
    const posterHtml = r.poster
      ? `<img class="${posterClass}" src="${escAttr(r.poster)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
      : `<div class="${posterClass} shelfd-search-row-poster--placeholder" aria-hidden="true"></div>`;
    /* Stagger up to 8 rows. After that they appear instantly to keep scrolling responsive. */
    const delayMs = Math.min(index, 7) * 28;
    return `
      <button type="button" class="shelfd-search-row" style="--shelfd-row-delay:${delayMs}ms" onclick="${handler}" data-row-kind="${escAttr(r.kind)}">
        ${posterHtml}
        <span class="shelfd-search-row-body">
          <span class="shelfd-search-row-title">${escHtml(r.title)}</span>
          ${yearTypeHtml}
          ${credHtml}
        </span>
        <span class="shelfd-search-row-chevron" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </span>
      </button>`;
  }

  /* v651: Lazy credits fetcher — populates the "Directed by / Created by /
     Developed by [Name]" line after each result row is rendered. Cached so
     re-searching the same query doesn't refetch. */
  const creditsCache = new Map();
  async function fetchCreditFor(r) {
    if (!r || !r.key) return '';
    if (creditsCache.has(r.key)) return creditsCache.get(r.key);
    let name = '';
    try {
      /* v654: Jikan-sourced anime rows pull "Created by" from the studio
         (Jikan doesn't have a director field for most TV anime). */
      if (r.isJikan && r.malId && window.JikanAnime?.animeFull) {
        const j = await window.JikanAnime.animeFull(r.malId);
        if (j) {
          name = (Array.isArray(j.studios) ? j.studios : [])[0]?.name
              || (Array.isArray(j.producers) ? j.producers : [])[0]?.name
              || '';
        }
      } else if (r.kind === 'movie' || r.kind === 'tv' || r.kind === 'anime') {
        const tmdbType = r.tmdbType || (r.kind === 'movie' ? 'movie' : 'tv');
        const url = `/api/tmdb/${tmdbType}/${encodeURIComponent(r.id)}?append_to_response=credits`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (tmdbType === 'movie') {
            const dir = (data.credits?.crew || []).find(c => c.job === 'Director');
            name = dir?.name || '';
          } else {
            name = (data.created_by || [])[0]?.name || '';
            if (!name) {
              const dir = (data.credits?.crew || []).find(c => c.job === 'Director');
              name = dir?.name || '';
            }
          }
        }
      } else if (r.kind === 'game') {
        const res = await fetch(`/api/rawg/games/${encodeURIComponent(r.id)}`);
        if (res.ok) {
          const data = await res.json();
          name = (data.developers || [])[0]?.name
              || (data.publishers || [])[0]?.name
              || '';
        }
      }
    } catch (e) {
      /* swallow — empty name just means we won't fill the line */
    }
    creditsCache.set(r.key, name);
    return name;
  }
  function backfillResultCredits(rows = [], forToken = 0) {
    rows.forEach(r => {
      /* v732: person rows already render their own "Known for" line —
         no async credit lookup needed. */
      if (r.kind === 'person') return;
      fetchCreditFor(r).then(name => {
        /* Stop applying if a newer search has started */
        if (forToken !== queryToken) return;
        if (!name) {
          /* No data — collapse the placeholder line so the row doesn't
             show a stray dash. */
          const wrap = document.querySelector(`[data-row-cred-key="${CSS.escape(String(r.key))}"]`);
          if (wrap) wrap.style.display = 'none';
          return;
        }
        const el = document.querySelector(`[data-row-cred-key="${CSS.escape(String(r.key))}"] .shelfd-search-row-credit-name`);
        if (el) el.textContent = name;
      }).catch(() => {});
    });
  }

  function renderSkeletonRows(n) {
    return `<div class="shelfd-search-skeleton-list">${
      Array.from({ length: n }, () => `
        <div class="shelfd-search-skeleton-row">
          <div class="shelfd-search-skeleton-poster"></div>
          <div class="shelfd-search-skeleton-body">
            <div class="shelfd-search-skeleton-line shelfd-search-skeleton-line--title"></div>
            <div class="shelfd-search-skeleton-line shelfd-search-skeleton-line--meta"></div>
          </div>
        </div>`).join('')
    }</div>`;
  }

  /* ---------- Filter chips ---------- */
  function setActiveFilter(filter) {
    activeFilter = filter;
    document.querySelectorAll('.shelfd-search-chip').forEach(btn => {
      const isActive = btn.getAttribute('data-search-filter') === filter;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    if (activeQuery) runSearch(activeQuery);
  }

  /* ---------- Public click handlers (wired into onclick attrs above) ----------
     v647: We DON'T close the search overlay when opening a media profile.
     The media profile (z-index 3100) stacks above the search overlay
     (z-index 2100), so closing the media profile reveals the search results
     underneath — preserving the user's query and scroll position. */
  window.handleSearchPageMediaClick = function(event, type, id) {
    pushRecent(activeQuery);
    if (typeof window.openDiscoverMediaProfile === 'function') {
      try {
        window.openDiscoverMediaProfile(event, type, id);
      } catch (e) { console.error('Open media profile failed:', e); }
    }
  };
  function buildSearchGameProfileSeed(row = {}) {
    const item = row.raw || {};
    const poster = row.poster || gamePoster(item);
    const rawgId = String(row.rawgId || item.rawgId || item.rawg_id || (item.source === 'rawg' ? item.id : '') || '').trim();
    return {
      id: rawgId || String(item.id || row.id || ''),
      rawgId,
      rawgSlug: item.slug || '',
      backloggdSlug: item.slug || '',
      metacriticSlug: item.slug || '',
      title: row.title || item.name || '',
      name: row.title || item.name || '',
      released: item.released || '',
      background_image: poster,
      cover: poster,
      poster,
      image: poster,
      igdbId: item.igdbId || '',
      igdbSlug: item.igdbSlug || '',
      igdbCoverUrl: item.igdbCover || item.igdbCoverUrl || '',
      genres: item.genres || [],
      platforms: item.platforms || [],
      metacritic: item.metacritic || '',
      rating: item.rating || '',
      ratings_count: item.ratings_count || item.reviews_count || 0,
      source: item.source || ''
    };
  }

  window.handleSearchPageGameClick = function(event, keyOrId) {
    pushRecent(activeQuery);
    if (typeof window.openGameMediaProfile === 'function') {
      try {
        const row = lastResultRows.find(result => result.key === keyOrId || String(result.id) === String(keyOrId)) || {};
        const seed = buildSearchGameProfileSeed(row);
        const rawgId = seed.rawgId || '';
        if (rawgId && typeof window.setGameMediaProfileSeed === 'function') {
          window.setGameMediaProfileSeed(rawgId, seed);
        }
        window.openGameMediaProfile(event, rawgId, seed);
      } catch (e) { console.error('Open game profile failed:', e); }
    }
  };
  /* v654: Jikan-sourced anime row click → Jikan profile (mal_id). */
  window.handleSearchPageJikanClick = function(event, malId) {
    pushRecent(activeQuery);
    if (typeof window.openJikanAnimeProfile === 'function') {
      try {
        window.openJikanAnimeProfile(event, malId);
      } catch (e) { console.error('Open Jikan anime profile failed:', e); }
    }
  };
  /* v10.232: Music row click → add the album to the user's My Lists / Music
     section (storage status 'watched', the music tab's only status). The card
     uses item.title (album name), item.artist, item.year, item.cover. Once
     added, the user can rate/review via the + on the title card which routes
     through the existing shelf-log composer ("I Listened..."). */
  window.handleSearchPageMusicClick = function(event, key) {
    pushRecent(activeQuery);
    try {
      const row = lastResultRows.find(result => result.key === key) || null;
      if (!row || row.kind !== 'music') return;
      /* v10.233: open the Music profile page first instead of adding immediately.
         The profile mirrors the Movie/TV/Game profile flow — user reviews the
         album metadata, then taps Add to commit it to their shelf. */
      if (typeof window.openMusicAlbumProfile === 'function') {
        try { window.openMusicAlbumProfile(row); return; } catch (e) {}
      }
      /* Fallback: legacy direct-add path if the profile module hasn't loaded. */
      const data = (typeof window !== 'undefined') ? window.data : null;
      if (!data) {
        if (typeof window.showToast === 'function') window.showToast('Sign in to save albums to your shelf');
        return;
      }
      if (!Array.isArray(data.music)) data.music = [];
      const mbid = String(row.id || '').trim();
      const dedupeKey = mbid || `${row.title}::${row.artist}`.toLowerCase();
      const already = data.music.some(it => {
        const itKey = String(it?.mbid || it?.id || '').trim();
        if (itKey && itKey === dedupeKey) return true;
        return `${it?.title || ''}::${it?.artist || ''}`.toLowerCase() === `${row.title}::${row.artist}`.toLowerCase();
      });
      if (already) {
        if (typeof window.showToast === 'function') window.showToast('Already in your Music shelf');
        if (typeof window.closeSearchPage === 'function') window.closeSearchPage();
        return;
      }
      const nowIso = new Date().toISOString();
      const newItem = {
        id: (crypto && typeof crypto.randomUUID === 'function')
          ? crypto.randomUUID()
          : ('music-' + Date.now() + '-' + Math.random().toString(36).slice(2)),
        mbid,
        title: row.title || '',
        artist: row.artist || '',
        year: row.year || '',
        cover: row.poster || '',
        status: 'watched',         // music's only status maps to 'watched' storage key
        librarySection: 'music',
        mediaCategory: 'music',
        rating: 0,
        dateAdded: nowIso,
        createdAt: nowIso,
        lastEditedAt: nowIso
      };
      data.music.unshift(newItem);
      try { if (typeof window.save === 'function') window.save(); } catch (_) {}
      try { if (typeof window.markOwnItemLastEdited === 'function') window.markOwnItemLastEdited(newItem, 'music'); } catch (_) {}
      if (typeof window.showToast === 'function') window.showToast(`Added "${row.title}" to your Music shelf`);
      /* Close the search overlay and bring the user to the Music tab so they
         see the new card immediately. */
      try { if (typeof window.closeSearchPage === 'function') window.closeSearchPage(); } catch (_) {}
      try {
        if (typeof window.switchSection === 'function') window.switchSection('music');
        if (typeof window.render === 'function') window.render();
      } catch (_) {}
    } catch (e) { console.error('Add music to library failed:', e); }
  };

  /* v10.234 / v10.246: Artist row click → open the dedicated Artist Profile
     page (full-screen slide-in) showing facts + discography. Falls back to
     the old "re-run search with artist name" behavior only if the profile
     module hasn't loaded for some reason. */
  window.handleSearchPageArtistClick = function(event, key) {
    try {
      const row = lastResultRows.find(result => result.key === key) || null;
      if (!row || row.kind !== 'artist') return;
      pushRecent(activeQuery);
      if (typeof window.openMusicArtistProfile === 'function') {
        try { window.openMusicArtistProfile(row); return; } catch (_) {}
      }
      /* Legacy fallback path. */
      const input = $('shelfd-search-input');
      if (input) {
        input.value = row.title || '';
        try { input.focus({ preventScroll: true }); } catch (_) { try { input.focus(); } catch (__) {} }
      }
      const chips = document.querySelectorAll('.shelfd-search-chip');
      chips.forEach(c => {
        const isActive = c.getAttribute('data-search-filter') === 'music';
        c.classList.toggle('active', isActive);
        c.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      activeFilter = 'music';
      runSearch(row.title || '');
    } catch (e) { console.error('Artist row click failed:', e); }
  };

  /* v732: Actors filter row click → existing TMDB person profile. */
  window.handleSearchPagePersonClick = function(event, personId) {
    pushRecent(activeQuery);
    if (typeof window.openDiscoverPersonProfile === 'function') {
      try {
        window.openDiscoverPersonProfile(event, personId);
      } catch (e) { console.error('Open person profile failed:', e); }
    }
  };

  /* v647: Smart back button — sequential history-style behavior.
       State A: empty query, on the empty/browse view → close the search page
       State B: query active, results showing → clear the query (return to A)
       (State C, with media profile on top, is handled by the media profile's
        own back button — closing it reveals search underneath, in State B.) */
  window.handleSearchBack = function() {
    if (getPresetSurfaceStack('search').length) {
      closePresetPanel({ surface: 'search' });
      return;
    }
    const input = document.getElementById('shelfd-search-input');
    const clearBtn = document.getElementById('shelfd-search-clear-btn');
    const hasQuery = !!(input && input.value && input.value.trim().length);
    if (hasQuery) {
      /* State B → State A */
      if (input) input.value = '';
      if (clearBtn) clearBtn.hidden = true;
      runSearch('');
      /* Blur so the chips hide too */
      try { input && input.blur(); } catch (_) {}
      return;
    }
    /* State A → close search page */
    if (typeof window.closeSearchPage === 'function') window.closeSearchPage();
  };

  /* ---------- Initial wiring (idempotent) ---------- */
  function initSearchPage() {
    if (pageInitialized) return;
    removePresetHub('search');
    const input = $('shelfd-search-input');
    const clearBtn = $('shelfd-search-clear-btn');
    const inputWrap = document.querySelector('.shelfd-search-input-wrap');
    const recentList = $('shelfd-search-recent-list');
    const recentClear = $('shelfd-search-clear-recents');
    const chipsRow = document.querySelector('.shelfd-search-chips');
    const browseGrid = document.querySelector('.shelfd-search-browse-grid');
    if (!input) return;
    pageInitialized = true;

    /* iOS PWA fix: the wrap was previously a <label>, but iOS suppresses the
       keyboard when a <label> contains both an <input> and a <button>. We use
       a <div> now and forward taps on the icon padding directly to the input
       inside the user-gesture call stack. */
    if (inputWrap) {
      inputWrap.addEventListener('pointerdown', (e) => {
        if (e.target === input || (e.target instanceof Element && e.target.closest('.shelfd-search-clear-btn'))) return;
        /* focus synchronously inside the gesture so iOS shows the keyboard */
        try { input.focus({ preventScroll: false }); } catch (_) { input.focus(); }
      });
      /* Pointer events isn't supported on every iOS version — also catch click. */
      inputWrap.addEventListener('click', (e) => {
        if (e.target === input || (e.target instanceof Element && e.target.closest('.shelfd-search-clear-btn'))) return;
        try { input.focus({ preventScroll: false }); } catch (_) { input.focus(); }
      });
    }

    /* v646: filter chips hidden until the user focuses the search composer.
       Stays visible while there's a query in the box; disappears again once
       the box is blurred AND empty.
       v10.490: REVERSED per user spec — chips are now ALWAYS visible. The
       old conditional caused the chips to disappear when the user tapped
       a filter (because the tap blurred the empty input, which fired the
       blur listener, which removed the visible class). Locked to always-
       on so the composer can be focused AND a filter tapped in any
       order. */
    const chipsRow2 = document.querySelector('.shelfd-search-chips');
    function updateChipsVisibility() {
      if (!chipsRow2) return;
      chipsRow2.classList.add('shelfd-search-chips--visible');
    }
    updateChipsVisibility();

    const onInput = () => {
      const v = input.value;
      if (clearBtn) clearBtn.hidden = !v;
      clearTimeout(debounceTimer);
      const q = v.trim();
      if (!q) { runSearch(''); return; }
      debounceTimer = setTimeout(() => runSearch(q), DEBOUNCE_MS);
    };
    input.addEventListener('input', onInput);
    input.addEventListener('search', onInput); /* iOS clear-button event */
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(debounceTimer);
        const q = input.value.trim();
        if (q) { pushRecent(q); runSearch(q); input.blur(); }
      } else if (e.key === 'Escape') {
        if (input.value) { input.value = ''; onInput(); }
        else if (typeof window.closeSearchPage === 'function') window.closeSearchPage();
      }
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        input.value = '';
        clearBtn.hidden = true;
        runSearch('');
        /* Refocus so users can keep typing */
        requestAnimationFrame(() => input.focus());
      });
    }

    if (chipsRow) {
      /* v10.490: Prevent the chip tap from blurring the composer input.
         v10.491: REGRESSION FIX. The v10.490 version called
         `preventDefault()` on `touchstart` for chips — which on iOS
         blocks the entire synthesized click chain. Result: tapping a
         filter on TestFlight did nothing (filter stayed on All).

         The correct split:
           • Desktop (mouse): preventDefault on `mousedown` is the
             standard pattern to prevent focus loss without blocking
             the click.
           • iOS / touch: do NOT preventDefault. Let the click fire
             naturally. The keyboard may collapse momentarily, but the
             click handler below immediately refocuses the input so
             the user can keep typing. This is also how Instagram and
             Twitter handle composer filter buttons on iOS. */
      chipsRow.addEventListener('mousedown', (e) => {
        const target = e.target.closest && e.target.closest('.shelfd-search-chip');
        if (!target) return;
        try { e.preventDefault(); } catch (_) {}
      });
      chipsRow.addEventListener('click', (e) => {
        const target = e.target.closest('.shelfd-search-chip');
        if (!target) return;
        const filter = target.getAttribute('data-search-filter') || 'all';
        setActiveFilter(filter);
        /* Refocus the composer so the keyboard stays up and the user
           can keep typing right after picking a filter. Wrapped in rAF
           so it fires AFTER iOS has finished processing the click and
           any default blur. */
        requestAnimationFrame(() => {
          try { input.focus({ preventScroll: true }); } catch (_) { try { input.focus(); } catch (_) {} }
        });
      });
    }

    if (browseGrid) {
      browseGrid.addEventListener('click', (e) => {
        const target = e.target.closest('.shelfd-search-browse-card');
        if (!target) return;
        const type = target.getAttribute('data-browse-type') || '';
        const filterMap = { movie: 'movie', tv: 'tv', anime: 'anime', game: 'game' };
        const filter = filterMap[type] || 'all';
        setActiveFilter(filter);
        /* If the user hasn't typed anything, focus the input to invite typing */
        requestAnimationFrame(() => input.focus());
      });
    }

    if (recentList) {
      recentList.addEventListener('click', (e) => {
        const target = e.target.closest('[data-recent-query]');
        if (!target) return;
        const q = target.getAttribute('data-recent-query') || '';
        input.value = q;
        if (clearBtn) clearBtn.hidden = !q;
        runSearch(q);
      });
    }
    if (recentClear) recentClear.addEventListener('click', clearRecents);

    /* Initial render */
    renderRecents();
  }

  /* Auto-focus input when page opens. We hook into the existing openSearchPage. */
  function patchOpenSearchPage() {
    const original = window.openSearchPage;
    if (typeof original !== 'function' || original.__shelfdSearchPatched) return;
    const wrapped = function() {
      original.apply(this, arguments);
      initSearchPage();
      const input = $('shelfd-search-input');
      /* Focus on next-frame so the slide-up animation isn't interrupted by keyboard rise */
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (input) {
          /* Don't auto-focus on coarse-pointer devices to avoid keyboard popping unsolicited.
             Users tap the input themselves on mobile. */
          if (!matchMedia('(pointer: coarse)').matches) input.focus();
        }
      }));
    };
    wrapped.__shelfdSearchPatched = true;
    window.openSearchPage = wrapped;
  }

  function patchCloseSearchPage() {
    const original = window.closeSearchPage;
    if (typeof original !== 'function' || original.__shelfdSearchPresetPatched) return;
    const wrapped = function() {
      hidePremiumPresetNotice('search');
      closeAllPresetPanels({ surface: 'search', immediate: true });
      original.apply(this, arguments);
    };
    wrapped.__shelfdSearchPresetPatched = true;
    window.closeSearchPage = wrapped;
  }

  /* Init on DOM ready, then patch openSearchPage once it exists. */
  function start() {
    initSearchPage();
    patchOpenSearchPage();
    patchCloseSearchPage();
    /* If the patch happens before openSearchPage is defined, retry until it is. */
    let tries = 0;
    const tick = () => {
      if (typeof window.openSearchPage === 'function' && !window.openSearchPage.__shelfdSearchPatched) {
        patchOpenSearchPage();
      }
      if (typeof window.closeSearchPage === 'function' && !window.closeSearchPage.__shelfdSearchPresetPatched) {
        patchCloseSearchPage();
      }
      if (++tries < 40 && ((!window.openSearchPage || !window.openSearchPage.__shelfdSearchPatched) || (!window.closeSearchPage || !window.closeSearchPage.__shelfdSearchPresetPatched))) {
        setTimeout(tick, 100);
      }
    };
    tick();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  window.renderDiscoverSearchPresetHub = function() {
    return mountPresetHub('discover');
  };
  window.closeDiscoverSearchPresetHub = function() {
    hidePremiumPresetNotice('discover');
    closeAllPresetPanels({ surface: 'discover', immediate: true });
    removePresetHub('discover');
  };

})();
