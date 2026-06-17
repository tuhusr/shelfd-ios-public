/*
   50-profile-showcase.js
   Extracted from 15-profile-settings.js to keep surface ownership explicit.
*/

function normalizeDatabaseFavoriteEntry(entry) {
  const empty = getEmptyDatabaseFavorite();
  if (!entry) return empty;
  if (typeof entry === 'string') return { ...empty, legacyId: entry, id: entry, source: 'library' };
  return {
    id: String(entry.id || entry.tmdbId || entry.rawgId || entry.legacyId || '').trim(),
    source: String(entry.source || entry.db || entry.provider || '').trim(),
    type: String(entry.type || entry.mediaType || entry.tmdbType || '').trim(),
    title: String(entry.title || entry.name || '').trim(),
    image: String(entry.image || entry.cover || entry.poster || entry.photo || '').trim(),
    rating: String(entry.rating || entry.userRating || entry.note || '').trim(),
    meta: String(entry.meta || entry.year || entry.detail || '').trim(),
    legacyId: String(entry.legacyId || '').trim()
  };
}

function normalizePinnedFavorites(raw) {
  const defaults = getDefaultPinnedFavorites();
  const source = raw && typeof raw === 'object' ? raw : {};
  Object.keys(defaults).forEach(section => {
    const values = Array.isArray(source[section]) ? source[section] : [];
    defaults[section] = [0,1,2].map(i => normalizeDatabaseFavoriteEntry(values[i]));
  });
  return defaults;
}

function normalizeProfileVisibility(raw) {
  const defaults = getDefaultProfileVisibility();
  if (raw && typeof raw === 'object') {
    Object.keys(defaults).forEach(key => { defaults[key] = raw[key] !== false; });
  }
  return defaults;
}

function normalizeShowcaseFavorites(raw) {
  const defaults = getDefaultShowcaseFavorites();
  const source = raw && typeof raw === 'object' ? raw : {};
  Object.keys(defaults).forEach(section => {
    const values = Array.isArray(source[section]) ? source[section] : [];
    defaults[section] = [0,1,2].map(i => {
      const entry = values[i];
      if (!entry) return getEmptyManualFavorite();
      if (typeof entry === 'string') return { name: entry, image: '', rating: '' };
      return {
        name: String(entry.name || entry.title || '').trim(),
        image: String(entry.image || entry.photo || entry.cover || '').trim(),
        rating: String(entry.rating || entry.note || '').trim()
      };
    });
  });
  return defaults;
}

function normalizeSocialLinks(raw) {
  const links = getDefaultSocialLinks();
  if (raw && typeof raw === 'object') {
    Object.keys(links).forEach(key => { links[key] = String(raw[key] || '').trim(); });
  }
  return links;
}

function normalizeUserProfile(raw = {}) {
  const useCurrentUserFallback = !raw || !Object.keys(raw).length || (raw.uid && currentUser && raw.uid === currentUser.uid);
  const baseName = raw.name || raw.customName || (useCurrentUserFallback ? (currentUser?.displayName) : '') || 'ScreenList User';
  const shelfdActivityNotes = raw.shelfdActivityNotes && typeof raw.shelfdActivityNotes === 'object' && !Array.isArray(raw.shelfdActivityNotes)
    ? raw.shelfdActivityNotes
    : {};
  return {
    name: baseName,
    photo: raw.photo || raw.customPhoto || (useCurrentUserFallback ? (currentUser?.photoURL) : '') || '',
    bio: raw.bio || raw.profileBio || '',
    /* v808 — Step 1: force-resolve every profile load into the current
       Default Theme. Anything other than 'true-dark' (default/light/cream/
       legacy/missing) becomes 'true-dark', which then flows through
       saveUserProfile back to Firestore and into applyThemeMode. */
    themeMode: resolveActiveThemeMode(raw.themeMode),
    ratingPreferences: normalizeRatingPreferences(raw.ratingPreferences),
    animeTitleDisplayMode: normalizeAnimeTitleDisplayMode(raw.animeTitleDisplayMode || raw.animeTitleDisplay),
    socialLinks: normalizeSocialLinks(raw.socialLinks),
    steamConnection: normalizeSteamConnection(raw.steamConnection || raw.steam || {}),
    xboxConnection: typeof normalizeXboxConnection === 'function' ? normalizeXboxConnection(raw.xboxConnection || {}) : (raw.xboxConnection || {}),
    appleMusicConnection: typeof normalizeAppleMusicConnection === 'function' ? normalizeAppleMusicConnection(raw.appleMusicConnection || raw.appleMusic || {}) : (raw.appleMusicConnection || {}),
    appleMusicMetadataSummary: raw.appleMusicMetadataSummary || null,
    trackerConnection: normalizeTrackerConnection(raw.trackerConnection || raw.tracker || {}),
    movieRatingTierList: raw.movieRatingTierList || null,
    tvRatingTierList: raw.tvRatingTierList || null,
    animeRatingTierList: raw.animeRatingTierList || null,
    gameRatingTierList: raw.gameRatingTierList || null,
    pinnedFavorites: normalizePinnedFavorites(raw.pinnedFavorites),
    profileVisibility: normalizeProfileVisibility(raw.profileVisibility),
    listTabVisibility: normalizeListTabVisibility(raw.listTabVisibility),
    notificationPreferences: normalizeNotificationPreferences(raw.notificationPreferences),
    showcaseFavorites: normalizeShowcaseFavorites(raw.showcaseFavorites || raw.manualFavorites),
    uid: raw.uid || currentUser?.uid || 'preview-user',
    emailLower: raw.emailLower || raw.accountEmailLower || (useCurrentUserFallback ? normalizeEmail(currentUser?.email) : ''),
    shelfdActivityNotes,
    friends: Array.isArray(raw.friends) ? raw.friends.filter(Boolean) : [],
    acceptedFollowerRequests: Array.isArray(raw.acceptedFollowerRequests) ? raw.acceptedFollowerRequests.filter(Boolean) : [],
    following: Array.isArray(raw.following) ? raw.following.filter(Boolean) : [],
    followers: Array.isArray(raw.followers) ? raw.followers.filter(Boolean) : [],
    followingIds: Array.isArray(raw.followingIds) ? raw.followingIds.filter(Boolean) : [],
    followerIds: Array.isArray(raw.followerIds) ? raw.followerIds.filter(Boolean) : [],
    follows: Array.isArray(raw.follows) ? raw.follows.filter(Boolean) : [],
    followedBy: Array.isArray(raw.followedBy) ? raw.followedBy.filter(Boolean) : [],
    incomingFollowers: Array.isArray(raw.incomingFollowers) ? raw.incomingFollowers.filter(Boolean) : [],
    outgoingFollowing: Array.isArray(raw.outgoingFollowing) ? raw.outgoingFollowing.filter(Boolean) : [],
    incomingRequests: Array.isArray(raw.incomingRequests) ? raw.incomingRequests.filter(Boolean) : [],
    outgoingRequests: Array.isArray(raw.outgoingRequests) ? raw.outgoingRequests.filter(Boolean) : [],
    /* v10.773: carry the @username + cooldown state through normalization
       so the Profile Settings page (and friend-row renderers) can read
       them off userProfile. Before this, normalizeUserProfile was an
       explicit whitelist that dropped usernameHandle / usernameHandleLower
       / usernameLastChangedAt(Ms) entirely — meaning even though Firestore
       had the correct values, the local userProfile object showed
       undefined, the cogwheel display said "@—", and the Edit input
       opened blank. Reads fall back to userHandle / username / handleLower
       for legacy doc shapes that pre-date the v816 username schema. */
    usernameHandle: String(raw.usernameHandle || raw.userHandle || raw.username || raw.handle || '').trim(),
    usernameHandleLower: String(raw.usernameHandleLower || raw.handleLower || '').trim() || String(raw.usernameHandle || raw.userHandle || raw.username || raw.handle || '').trim().toLowerCase(),
    usernameLastChangedAt: raw.usernameLastChangedAt || null,
    usernameLastChangedAtMs: typeof raw.usernameLastChangedAtMs === 'number'
      ? raw.usernameLastChangedAtMs
      : (raw.usernameLastChangedAt && typeof raw.usernameLastChangedAt.toMillis === 'function'
          ? raw.usernameLastChangedAt.toMillis()
          : 0),
    customName: raw.customName || '',
    /* v10.785: carry activity-feed metadata through normalization.
       Before this, normalizeUserProfile was a whitelist that dropped:
         - activityDeletedIds: the array of activity stable-IDs the user
           has soft-deleted from their own feed. Without it, every reopen
           re-read users/{uid}.activityDeletedIds from Firestore but the
           normalize step wiped it before isScreenListActivityDeletedForOwner
           could see it — so deleted activities resurfaced. The localStorage
           fallback existed but couldn't be the sole source of truth.
         - shelfdActivityNotes: per-activity notes already retained above,
           but mirroring activityNotes alias for older code paths.
         - blockedUids: needed by saveUserProfile to seed shelfdBlockedUids
           on every signin. Pre-v10.785 this only worked because it was
           silently spread into baseProfile before normalize wiped it.
       All three fields are simple arrays/objects, no migration risk. */
    activityDeletedIds: Array.isArray(raw.activityDeletedIds)
      ? raw.activityDeletedIds.filter(Boolean).map(String)
      : [],
    activityDeletedAt: typeof raw.activityDeletedAt === 'number' ? raw.activityDeletedAt : 0,
    blockedUids: Array.isArray(raw.blockedUids)
      ? raw.blockedUids.filter(Boolean).map(String)
      : []
  };
}

function normalizeSteamConnection(raw = {}) {
  // v429: removed `|| source.displayName` fallback — that fallback could read a
  // Shelfd display name into Steam.personaName when a corrupted record landed
  // here. Steam identity must come ONLY from explicit Steam fields.
  const source = raw && typeof raw === 'object' ? raw : {};
  const total = Number(source.lastSyncTotal || source.libraryCount || 0);
  return {
    steamId: String(source.steamId || source.id || '').trim(),
    personaName: String(source.personaName || '').trim(),
    profileUrl: String(source.profileUrl || source.url || '').trim(),
    avatar: String(source.avatar || source.avatarFull || '').trim(),
    connectedAt: String(source.connectedAt || '').trim(),
    lastSyncedAt: String(source.lastSyncedAt || '').trim(),
    lastSyncTotal: Number.isFinite(total) && total > 0 ? Math.round(total) : 0
  };
}

function normalizeTrackerConnection(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    provider: 'tracker.gg',
    gameSlug: String(source.gameSlug || source.defaultGameSlug || '').trim(),
    gameLabel: String(source.gameLabel || '').trim(),
    displayName: String(source.displayName || source.accountName || source.handle || '').trim(),
    platform: String(source.platform || 'pc').trim(),
    profileUrl: String(source.profileUrl || source.sourceUrl || source.url || '').trim(),
    connectedAt: String(source.connectedAt || '').trim(),
    updatedAt: String(source.updatedAt || '').trim()
  };
}

function getProfileDataForStats() {
  if (profileViewingData) return cloneListData(profileViewingData);
  if (!isViewingOtherProfile()) return cloneListData(ownDataCache || data || getEmptyListData());
  return cloneListData(getVisibleListData() || data || getEmptyListData());
}

function getWatchedEpisodeCount(item, section) {
  if (Array.isArray(item.episodes) && item.episodes.length) {
    const watched = item.episodes.filter(ep => ep && ep.watched).length;
    if (watched > 0) return watched;
  }
  const current = Number(item.currentEp || item.currentEpisode || 0);
  if (current > 0) return current;
  if (item.status === 'watched' || item.status === 'completed') return Number(item.totalEps || item.totalEpisodes || 0);
  return 0;
}

function calculateProfileStats() {
  const source = getProfileDataForStats();
  const movieHours = (source.movies || []).reduce((sum, item) => {
    if (item.status !== 'watched') return sum;
    const runtimeMinutes = Number(item.runtimeMinutes || item.runtime || 0);
    return sum + (runtimeMinutes > 0 ? runtimeMinutes / 60 : 2);
  }, 0);
  const tvHours = (source.shows || []).reduce((sum, item) => sum + (getWatchedEpisodeCount(item, 'shows') * 45 / 60), 0);
  const animeHours = (source.anime || []).reduce((sum, item) => sum + (getWatchedEpisodeCount(item, 'anime') * 24 / 60), 0);
  const gameHours = (source.games || []).reduce((sum, item) => {
    const explicit = Number(item.gameHoursPlayed || item.gameHours || item.hoursPlayed || item.playtimeHours || 0);
    if (explicit > 0) return sum + explicit;
    const progress = Number(item.currentHours || item.currentEp || 0);
    return sum + Math.max(0, progress);
  }, 0);
  const musicHours = (source.music || []).reduce((sum, item) => {
    /* v11.641: only count albums in the Listened category (music uses 'watched'
       = Listened, 'planned' = Planned). Exclude planned so Hours Listened sums
       the runtime of albums the user has actually listened to. */
    if (item.status === 'planned') return sum;
    return sum + getProfileMusicHours(item);
  }, 0);
  const moviesTvHours = movieHours + tvHours;
  const allMediaHours = moviesTvHours + animeHours;
  const movieAvg = formatAverageRatingForSection(source.movies || [], 'movies');
  const tvAvg = formatAverageRatingForSection(source.shows || [], 'shows');
  const moviesTvAvg = formatAverageRatingForSection([...(source.movies || []), ...(source.shows || [])], 'shows');
  const animeAvg = formatAverageRatingForSection(source.anime || [], 'anime');
  const musicAvg = formatAverageRatingForSection(source.music || [], 'music');
  const gamesAvg = formatAverageRatingForSection(source.games || [], 'games');
  const allMediaAvg = formatAverageRatingForSection([...(source.movies || []), ...(source.shows || []), ...(source.anime || [])], 'shows');
  const { mostWatchedGenre, bestRatingGenre } = calculateProfileGenreStats(source);
  return { movieHours, tvHours, moviesTvHours, allMediaHours, animeHours, musicHours, gameHours, movieAvg, tvAvg, moviesTvAvg, animeAvg, musicAvg, gamesAvg, allMediaAvg, mostWatchedGenre, bestRatingGenre };
}

/* v10.134: Genre-level stat aggregation across all watchable media
   (movies + TV + anime). Two outputs surfaced on the FPUP "All Media"
   stats block:
     - mostWatchedGenre  = the genre with the most total hours watched
     - bestRatingGenre   = the genre with the highest average user
                            rating, with a 3-rated-items minimum so a
                            single 10/10 fluke can't claim the top
   Genres are pulled off each item's `genreNames` array (preferred) or
   parsed from the legacy comma-separated `genre` string. Items with
   no genres are silently skipped. */
function calculateProfileGenreStats(source = getProfileDataForStats()) {
  const genreHours = {};
  const genreRatings = {};

  const extractGenres = (item) => {
    if (Array.isArray(item?.genreNames) && item.genreNames.length) {
      return item.genreNames.map(g => String(g || '').trim()).filter(Boolean);
    }
    return String(item?.genre || '')
      .split(',')
      .map(g => g.trim())
      .filter(Boolean);
  };

  const bumpHours = (genres, hours) => {
    if (!(hours > 0)) return;
    genres.forEach(g => {
      genreHours[g] = (genreHours[g] || 0) + hours;
    });
  };

  const bumpRating = (genres, rating) => {
    if (!(rating > 0)) return;
    genres.forEach(g => {
      if (!genreRatings[g]) genreRatings[g] = { sum: 0, count: 0 };
      genreRatings[g].sum += rating;
      genreRatings[g].count += 1;
    });
  };

  (source.movies || []).forEach(item => {
    const genres = extractGenres(item);
    if (!genres.length) return;
    if (item.status === 'watched') {
      const runtimeMinutes = Number(item.runtimeMinutes || item.runtime || 0);
      bumpHours(genres, runtimeMinutes > 0 ? runtimeMinutes / 60 : 2);
    }
    bumpRating(genres, Number(item.rating || 0));
  });

  (source.shows || []).forEach(item => {
    const genres = extractGenres(item);
    if (!genres.length) return;
    bumpHours(genres, getWatchedEpisodeCount(item, 'shows') * 45 / 60);
    bumpRating(genres, Number(item.rating || 0));
  });

  (source.anime || []).forEach(item => {
    const genres = extractGenres(item);
    if (!genres.length) return;
    bumpHours(genres, getWatchedEpisodeCount(item, 'anime') * 24 / 60);
    bumpRating(genres, Number(item.rating || 0));
  });

  let mostWatchedGenre = '—';
  let mostWatchedHours = 0;
  Object.entries(genreHours).forEach(([genre, hours]) => {
    if (hours > mostWatchedHours) {
      mostWatchedHours = hours;
      mostWatchedGenre = genre;
    }
  });

  let bestRatingGenre = '—';
  let bestAvg = 0;
  const MIN_RATED_ITEMS = 3;
  Object.entries(genreRatings).forEach(([genre, { sum, count }]) => {
    if (count < MIN_RATED_ITEMS) return;
    const avg = sum / count;
    if (avg > bestAvg) {
      bestAvg = avg;
      bestRatingGenre = genre;
    }
  });

  return { mostWatchedGenre, bestRatingGenre };
}

function formatProfileHours(value) {
  const n = Number(value || 0);
  if (n <= 0) return '0h';
  if (n < 10 && n % 1) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'h';
  }
  return Math.round(n).toLocaleString('en-US') + 'h';
}

function renderProfileStats() {
  const el = document.getElementById('profile-stats-grid');
  if (!el) return;
  const stats = calculateProfileStats();
  /* v10.134: FPUP stats simplified to a single "All Media" group of 4
     cards (Hours Watched, Average Rating, Most Watched Genre, Best
     Average Rating Genre). The per-section Movies / TV Shows / Anime /
     Games stat cards were removed since the same information is now
     surfaced inside the Top 3 favorites cards lower on the page.
     Each card carries the .profile-stat-card-flat modifier so the CSS
     can strip the rounded-rectangle "outer card" chrome (border,
     background, box-shadow, gradient pseudo-elements) and render the
     value + labels as a clean, frameless statistic block. */
  const cards = [
    { key: 'allMediaHours', tone: 'hours', value: formatProfileHours(stats.allMediaHours), labelMain: 'All Media', labelSub: 'Hours Watched' },
    { key: 'allMediaAvg', tone: 'score', value: stats.allMediaAvg, labelMain: 'All Media', labelSub: 'Average Rating' },
    { key: 'allMediaMostWatchedGenre', tone: 'genre', value: stats.mostWatchedGenre || '—', labelMain: 'All Media', labelSub: 'Most Watched Genre' },
    { key: 'allMediaBestRatingGenre', tone: 'genre', value: stats.bestRatingGenre || '—', labelMain: 'All Media', labelSub: 'Best Average Rating Genre' }
  ];
  el.innerHTML = cards.map(card => {
    const visible = true;
    return `
      <div class="profile-stat-card profile-stat-card-flat profile-stat-${escAttr(card.tone || 'default')}">
        <div class="profile-stat-value">${getProfileSummaryCardValueHTML(card, visible)}</div>
        <div class="profile-stat-label"><span class="profile-stat-label-main">${getProfileStatsMainLabelHTML(card)}</span><span class="profile-stat-label-sub">${getProfileStatSubLabelHTML(card)}</span></div>
      </div>
    `;
  }).join('');
}

function toggleProfileStatVisibility(key, checked) {
  if (isViewingOtherProfile()) return;
  if (!userProfile) userProfile = normalizeUserProfile({});
  readProfileDraftFromPage(userProfile);
  if (!userProfile.profileVisibility) userProfile.profileVisibility = getDefaultProfileVisibility();
  userProfile.profileVisibility[key] = checked !== false;
  renderProfileStats();
}

function getProfileItemById(section, id) {
  const source = getProfileDataForStats();
  return (source[section] || []).find(item => String(item.id) === String(id)) || null;
}

function getProfileMusicHours(item = {}) {
  /* v11.641: "Hours Listened" = the album's TOTAL RUNTIME (the status filter
     for the Listened category lives in calculateProfileStats). The old path
     used getMusicItemStats().timeSpentListening (= track duration × playCount),
     which stays 0 until tracks are individually played — so hours always read
     0. Pull the album total from item.runtimeMs (ms); fall back to summing the
     stored track durations. */
  const directHours = Number(
    item.hoursListened
    || item.listeningHours
    || item.timeSpentListeningHours
    || item.totalListeningHours
    || 0
  );
  if (directHours > 0) return directHours;
  let totalMs = Number(item.runtimeMs || item.durationMs || 0);
  if (!(totalMs > 0) && Array.isArray(item.tracks) && item.tracks.length) {
    totalMs = item.tracks.reduce((ms, track) => {
      const raw = Number((track && (track.durationMs || track.length || track.duration)) || 0);
      if (!(raw > 0)) return ms;
      /* length / durationMs are ms; a bare Deezer "duration" is seconds.
         Mirror normalizeMusicDurationMs: values < 10000 are treated as seconds. */
      return ms + (raw > 10000 ? raw : raw * 1000);
    }, 0);
  }
  if (totalMs > 0) return totalMs / 3600000;
  const directMinutes = Number(item.listeningMinutes || item.totalListeningMinutes || item.minutesListened || 0);
  return directMinutes > 0 ? directMinutes / 60 : 0;
}

function getProfileFavoriteConfig(key) { return PROFILE_DATABASE_FAVORITES.find(group => group.key === key) || PROFILE_MANUAL_FAVORITES.find(group => group.key === key) || null; }
function isProfileNoRatingFavoriteKey(key) {
  return ['fictionalCharacters', 'actors', 'directors', 'musicArtists'].includes(String(key || ''));
}
function getProfileSlotRankText(index, dotted = false) {
  const n = Number(index) + 1;
  return Number.isFinite(n) && n > 0 ? `${n}` : '';
}
function renderGoldStarIconHTML(extraClass = '') {
  return `<span class="screenlist-gold-star-icon ${escAttr(extraClass)}" aria-hidden="true">★</span>`;
}
function renderProfileRatingValueHTML(value) {
  const text = formatProfileFavoriteRatingDisplay(value, '');
  return text ? `${renderGoldStarIconHTML('profile-rating-star')}<span>${escHtml(text)}</span>` : '';
}
function getProfileShowcaseStatLabel(key) {
  const map = {
    movieHours: 'Hours Watched',
    tvHours: 'Hours Watched',
    animeHours: 'Hours Watched',
    musicHours: 'Hours Listened',
    gameHours: 'Hours Played',
    movieAvg: 'Avg Rating',
    tvAvg: 'Avg Rating',
    animeAvg: 'Avg Rating',
    musicAvg: 'Avg Rating',
    gamesAvg: 'Avg Rating'
  };
  return map[key] || getProfileStatLabel(key);
}
function getProfileShowcaseStatLabelHTML(key) {
  return escHtml(getProfileShowcaseStatLabel(key));
}
function formatProfileStatAverageDisplay(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === 'N/A') return raw || 'N/A';
  const normalized = raw.replace(/^★\s*/, '').replace(/^⭐\s*/, '').trim();
  /* v11.639: strip BOTH "/5" and "/10" suffixes — the profile stat card
     shows just the star glyph + the number (no "/5"). */
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(?:\/\s*(?:5|10))?$/);
  return match ? match[1] : normalized.replace(/\s*\/\s*(?:5|10)\s*$/, '');
}
function getProfileStatValueHTML(stats, key) {
  const value = getProfileStatValue(stats, key);
  const displayValue = key.endsWith('Avg') ? formatProfileStatAverageDisplay(value) : value;
  return key.endsWith('Avg') ? `${renderGoldStarIconHTML('profile-stat-value-star')}<span>${escHtml(displayValue)}</span>` : escHtml(displayValue);
}
function getProfileSummaryCardValueHTML(card, visible) {
  const value = visible ? card.value : 'Hidden';
  if (visible && card && card.tone === 'score') {
    const displayValue = formatProfileStatAverageDisplay(value);
    return `${renderGoldStarIconHTML('profile-stat-value-star')}<span>${escHtml(displayValue)}</span>`;
  }
  return escHtml(value);
}
function renderProfileFavoriteRatingHTML(key, value, placeholder = 'Tap to rate') {
  if (isProfileNoRatingFavoriteKey(key)) return '';
  const hasValue = String(value || '').trim();
  const text = formatProfileFavoriteRatingDisplay(value, placeholder);
  return `<div class="profile-fav-rating ${hasValue ? '' : 'profile-fav-empty-rating'}" data-${PROFILE_MANUAL_FAVORITES.some(group => group.key === key) ? 'manual' : 'db'}-rating-preview>${renderGoldStarIconHTML('profile-fav-rating-star')}<span>${escHtml(text)}</span></div>`;
}
function setProfileFavoriteRatingPreview(ratingPreview, key, value, placeholder = 'Tap to rate') {
  if (!ratingPreview) return;
  if (isProfileNoRatingFavoriteKey(key)) {
    ratingPreview.innerHTML = '';
    ratingPreview.classList.add('profile-fav-rating-hidden');
    return;
  }
  const hasValue = String(value || '').trim();
  ratingPreview.innerHTML = `${renderGoldStarIconHTML('profile-fav-rating-star')}<span>${escHtml(formatProfileFavoriteRatingDisplay(value, placeholder))}</span>`;
  ratingPreview.classList.toggle('profile-fav-empty-rating', !hasValue);
  ratingPreview.classList.remove('profile-fav-rating-hidden');
}
function getProfilePosterEmptyText(index) {
  return getProfileSlotRankText(index, false);
}
function getProfileCardRankHTML(index) {
  return `<div class="profile-fav-rank" aria-label="Rank ${index + 1}">${getProfileSlotRankText(index, true)}</div>`;
}
function getProfileFavoriteShareIconHTML() {
  return `<svg class="profile-fav-share-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 8 5-5 5 5"></path><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"></path></svg>`;
}
function getProfileRatingInputRequired(config) {
  return !isProfileNoRatingFavoriteKey(config?.key);
}
function getProfilePickerSubtext(config, mode = 'database') {
  if (mode === 'manual') return 'Add the name and optional image for this profile spot.';
  if (config?.source === 'library') return 'Pick a title from your library, or search within your saved music to feature it here.';
  return getProfileRatingInputRequired(config)
    ? 'Search title, select the result, then ScreenList will pull your existing library rating when it finds one.'
    : 'Search and select the person/title you want to feature.';
}
function getProfileNoRatingInputHTML(config) {
  return getProfileRatingInputRequired(config)
    ? `<input id="profile-picker-rating-input" class="profile-picker-rating-input" type="text" placeholder="Your rating" value="${escAttr(profileFavoritePickerState?.rating || '')}">`
    : '';
}
function getProfileManualRatingInputHTML(state) {
  return getProfileRatingInputRequired(state?.config)
    ? `<input id="profile-manual-picker-rating" class="profile-picker-manual-input" type="text" placeholder="${escAttr(state.config.ratingPlaceholder || 'Rating / note')}" value="${escAttr(state.card?.dataset.manualRating || '')}">`
    : '';
}
function getProfilePickerLibraryNote(state) {
  if (!getProfileRatingInputRequired(state?.config)) return '';
  return state.libraryRating
    ? `<div class="profile-picker-library-note">Pulled from your library: ${renderProfileRatingValueHTML(state.libraryRating)}</div>`
    : '<div class="profile-picker-library-note">Not found in your library — add a rating to feature it.</div>';
}
function getProfileFavoriteConfirmRating() {
  const state = profileFavoritePickerState;
  if (!getProfileRatingInputRequired(state?.config)) return '';
  return (document.getElementById('profile-picker-rating-input')?.value || state?.rating || '').trim();
}
function getProfileManualConfirmRating() {
  const state = profileFavoritePickerState;
  if (!getProfileRatingInputRequired(state?.config)) return '';
  return (document.getElementById('profile-manual-picker-rating')?.value || '').trim();
}
function getProfileImageFallbackHTML(index) {
  return `<span class="profile-empty-rank">${getProfilePosterEmptyText(index)}</span>`;
}
function getProfilePickerImageFallbackHTML() {
  return '<span class="profile-empty-rank">•</span>';
}
function getProfileTitleHtml(title, editing, manual = false) {
  return escHtml(title || (editing ? (manual ? 'Tap poster to add' : 'Tap poster to choose') : 'Empty'));
}
function getProfileRankDataAttrs(index) {
  return ` data-profile-rank="${index + 1}"`;
}
function getProfileRatingClass(key, value) {
  if (isProfileNoRatingFavoriteKey(key)) return 'profile-fav-rating profile-fav-rating-hidden';
  return `profile-fav-rating ${value ? '' : 'profile-fav-empty-rating'}`;
}
function getProfileRatingPreviewHTML(key, value, manual = false) {
  if (isProfileNoRatingFavoriteKey(key)) return '';
  return `${renderGoldStarIconHTML('profile-fav-rating-star')}<span>${escHtml(formatProfileFavoriteRatingDisplay(value, 'Tap to rate'))}</span>`;
}
function getProfileGroupTitleHTML(group) {
  return `<span>${escHtml(group.title)}</span>`;
}
function getProfileStatSubLabelHTML(card) {
  return escHtml(card.labelSub);
}
function getProfileStatsMainLabelHTML(card) {
  return escHtml(card.labelMain);
}
function getProfileFavoriteEmptyPoster(index) {
  return getProfileImageFallbackHTML(index);
}
function getProfileFavoriteSelectedFallback(state) {
  return state?.hit?.image ? '' : getProfilePickerImageFallbackHTML();
}
function getProfileFavoriteNoRatingInput(config) {
  return getProfileRatingInputRequired(config) ? '' : ' profile-no-rating-favorite';
}
function getProfileFavoriteDisplayRatingHTML(key, value, manual = false) {
  if (isProfileNoRatingFavoriteKey(key)) return '';
  const attr = manual ? 'data-manual-rating-preview' : 'data-db-rating-preview';
  const cls = getProfileRatingClass(key, value);
  return `<div class="${cls}" ${attr}>${getProfileRatingPreviewHTML(key, value, manual)}</div>`;
}
function getProfileFavoritePosterContent(image, index) {
  return image ? '' : getProfileFavoriteEmptyPoster(index);
}
function getProfileFavoritePosterAttrs(index) {
  return getProfileRankDataAttrs(index);
}
function getProfileStatLabel(key) {
  const map = {
    movieHours: 'Hours',
    tvHours: 'Hours',
    animeHours: 'Hours',
    musicHours: 'Hours Listened',
    gameHours: 'Hours Played',
    movieAvg: 'Average Rating',
    tvAvg: 'Average Rating',
    animeAvg: 'Average Score',
    musicAvg: 'Average Rating',
    gamesAvg: 'Average Score'
  };
  return map[key] || '';
}
function getProfileStatValue(stats, key) { return key.endsWith('Hours') ? formatProfileHours(stats[key]) : (stats[key] || 'N/A'); }
function getProfileItemRating(item) {
  const rating = Number(item?.rating || 0);
  const section = item?.librarySection || item?.mediaCategory || item?.section || activeSection;
  if (rating > 0) return formatRatingValueForSection(rating, section, true);
  return '';
}

function formatProfileFavoriteRatingDisplay(value, placeholder = 'Tap to rate') {
  const raw = String(value || '').trim();
  const compactMobile = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 760px)').matches;
  const compact = text => {
    const normalized = String(text || '').trim().replace(/^★\s*/, '').replace(/^⭐\s*/, '');
    /* v10.509: also strip an "/5" suffix in compact mode so the number
       alone shows on narrow mobile widths. Legacy "/10" suffix is also
       stripped for any in-flight stale labels still passing through. */
    const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(?:\/\s*(?:5|10))?$/);
    if (!match) return normalized;
    return match[1];
  };
  if (!raw) return placeholder;
  if (/^⭐/.test(raw) || /^★/.test(raw)) return compactMobile ? compact(raw) : raw.replace(/^★\s*/, '').replace(/^⭐\s*/, '');
  /* v10.509: app-wide rating scale is now 5-star with half-star steps.
     Any incoming raw number — plain ("8") or legacy "/10" suffixed
     ("8/10") — gets converted to the 5-point display ("4/5", "4.5/5").
     Already-5-scale inputs ("4/5") are passed through unchanged because
     the regex requires the legacy "/10" form or no suffix at all. */
  const tenScaleMatch = raw.match(/^(\d+(?:\.\d+)?)\s*(?:\/\s*10)?$/);
  if (tenScaleMatch) {
    const numericRaw = parseFloat(tenScaleMatch[1]);
    if (Number.isFinite(numericRaw) && numericRaw > 0) {
      const fiveValue = numericRaw / 2;
      const text = Number.isInteger(fiveValue) ? String(fiveValue) : fiveValue.toFixed(1);
      const clean = `${text}/5`;
      return compactMobile ? compact(clean) : clean;
    }
  }
  return compactMobile ? compact(raw) : raw.replace(/^★\s*/, '').replace(/^⭐\s*/, '');
}

function normalizeProfileMatchText(value) {
  return String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
}

function getProfileFavoriteCandidateSections(config, entry = {}) {
  if (config?.section) return [config.section];
  if (entry.type === 'movie') return ['movies'];
  if (entry.type === 'tv') return ['shows', 'anime'];
  if (entry.type === 'game') return ['games'];
  if (config?.key === 'overallMedia') return ['movies', 'shows', 'anime'];
  if (config?.source === 'rawg') return ['games'];
  return SCREENLIST_SECTIONS;
}

function findMatchingLibraryItemForProfileFavorite(config, rawEntry) {
  const entry = normalizeDatabaseFavoriteEntry(rawEntry);
  const source = getProfileDataForStats();
  const candidateSections = getProfileFavoriteCandidateSections(config, entry);
  const titleKey = normalizeProfileMatchText(entry.title);
  for (const section of candidateSections) {
    const list = source[section] || [];
    const idMatch = list.find(item => {
      if (entry.source === 'tmdb' && entry.id && String(item.tmdbId || '') === String(entry.id)) return true;
      if (entry.source === 'rawg' && entry.id && String(item.rawgId || item.rawg_id || '') === String(entry.id)) return true;
      return false;
    });
    if (idMatch) return idMatch;
    if (titleKey) {
      const titleMatch = list.find(item => normalizeProfileMatchText(item.title) === titleKey);
      if (titleMatch) return titleMatch;
    }
  }
  return null;
}

function getProfileLibraryRatingForFavorite(config, rawEntry) {
  const item = findMatchingLibraryItemForProfileFavorite(config, rawEntry);
  return item ? getProfileItemRating(item) : '';
}
function isProfileRowVisible(key) {
  const profile = getActiveProfile();
  const config = getProfileFavoriteConfig(key);
  if (!config?.optional) return true;
  if (!profile.profileVisibility) profile.profileVisibility = getDefaultProfileVisibility();
  return profile.profileVisibility[key] !== false;
}
function renderProfileVisibilityToggle(key) {
  if (isViewingOtherProfile()) return '';
  const config = getProfileFavoriteConfig(key);
  if (!config?.optional) return '';
  const checked = isProfileRowVisible(key) ? 'checked' : '';
  return `<label class="profile-row-toggle"><input type="checkbox" class="profile-section-toggle-input" data-profile-visible-key="${escAttr(key)}" ${checked} onchange="toggleProfileRowVisibility('${escAttr(key)}', this.checked)"> Display</label>`;
}
function toggleProfileRowVisibility(key, checked) {
  if (isViewingOtherProfile()) return;
  if (!userProfile) userProfile = normalizeUserProfile({});
  readProfileDraftFromPage(userProfile);
  if (!userProfile.profileVisibility) userProfile.profileVisibility = getDefaultProfileVisibility();
  userProfile.profileVisibility[key] = checked !== false;
  renderProfileFavorites();
  saveProfileFavoritesAuto('saved');
}

function getProfileDatabaseFavoriteDisplay(config, rawEntry) {
  const entry = normalizeDatabaseFavoriteEntry(rawEntry);
  const legacy = entry.legacyId || (entry.source === 'library' ? entry.id : '');
  if (legacy && config.section) {
    const item = getProfileItemById(config.section, legacy);
    if (item) {
      return {
        id: item.id || legacy,
        source: 'library',
        type: config.section,
        title: item.title || '',
        image: item.cover || '',
        rating: entry.rating || getProfileItemRating(item),
        meta: 'From library',
        legacyId: legacy
      };
    }
  }
  return { ...entry, rating: entry.rating || getProfileLibraryRatingForFavorite(config, entry) };
}

function getProfileDatabaseSearchLabel(config) {
  if (config?.source === 'library') return 'your music library';
  return config.source === 'rawg' ? 'RAWG' : 'TMDB';
}

function getProfileFavoriteCard(section, index) {
  return Array.from(document.querySelectorAll('.profile-db-slot')).find(card => card.dataset.profileDbSection === String(section) && card.dataset.profileDbIndex === String(index)) || null;
}

function getProfileFavoriteLibrarySections(config = {}) {
  if (config.key === 'overallMedia') return ['movies', 'shows', 'anime'];
  if (config.section) return [config.section];
  if (config.source === 'rawg') return ['games'];
  return [];
}

function getProfileFavoriteLibraryImage(item = {}) {
  return String(
    item.igdbCover ||
    item.cover ||
    item.poster ||
    item.image ||
    item.background_image ||
    item.backgroundImage ||
    item.photo ||
    ''
  ).trim();
}

function getProfileFavoriteLibraryNumericRating(item = {}) {
  const rating = Number(item?.rating || 0);
  return Number.isFinite(rating) ? rating : 0;
}

function getProfileFavoriteLibraryMeta(item = {}, section = '') {
  const year = String(item.releaseDate || item.released || item.firstAirDate || item.airDate || item.year || '').match(/(18|19|20)\d{2}/)?.[0] || '';
  const status = String(item.status || '').trim();
  const labelMap = { movies: 'Movie', shows: 'TV Show', music: 'Album', anime: 'Anime', games: 'Game' };
  return [year, status, labelMap[section] || 'Library'].filter(Boolean).join(' · ');
}

function buildProfileFavoriteHitFromLibraryItem(config = {}, item = {}, section = '') {
  const isGame = section === 'games' || config.source === 'rawg';
  const isMusic = section === 'music' || config.section === 'music';
  const tmdbId = String(item.tmdbId || item.tmdb_id || '').trim();
  const rawgId = String(item.rawgId || item.rawg_id || item.id || '').trim();
  const source = isMusic ? 'library' : (isGame ? (rawgId ? 'rawg' : 'library') : (tmdbId ? 'tmdb' : 'library'));
  const id = isMusic ? String(item.id || item.albumId || item.libraryId || '') : (isGame ? (rawgId || String(item.id || '')) : (tmdbId || String(item.id || '')));
  const type = isMusic ? 'music' : (isGame ? 'game' : (section === 'movies' ? 'movie' : 'tv'));
  return {
    id: String(id || item.id || '').trim(),
    source,
    type,
    title: String(item.title || item.name || 'Untitled').trim(),
    image: getProfileFavoriteLibraryImage(item),
    rating: getProfileItemRating({ ...item, librarySection: section, mediaCategory: section }),
    meta: getProfileFavoriteLibraryMeta(item, section) || 'From library',
    legacyId: String(item.id || '').trim(),
    _sortRating: getProfileFavoriteLibraryNumericRating(item),
    _section: section
  };
}

function getProfileFavoriteLibraryResults(config = {}) {
  const source = getProfileDataForStats();
  const sections = getProfileFavoriteLibrarySections(config);
  const results = [];
  sections.forEach(section => {
    (source[section] || []).forEach(item => {
      if (!item || !(item.title || item.name)) return;
      results.push(buildProfileFavoriteHitFromLibraryItem(config, item, section));
    });
  });
  return results.sort((a, b) => {
    const ratingDiff = Number(b._sortRating || 0) - Number(a._sortRating || 0);
    if (ratingDiff) return ratingDiff;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
}

function getProfileFavoritePickerActionLabel(config = {}) {
  if (config.key === 'overallMedia') return 'your library';
  if (config.section === 'movies') return 'your movie library';
  if (config.section === 'shows') return 'your TV library';
  if (config.section === 'music') return 'your music library';
  if (config.section === 'anime') return 'your anime library';
  if (config.section === 'games') return 'your game library';
  return 'your library';
}

function ensureProfileFavoritePickerModal() {
  let overlay = document.getElementById('profile-favorite-picker-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'profile-favorite-picker-modal';
    overlay.className = 'profile-favorite-picker-overlay';
    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeProfileFavoritePicker();
    });
    document.body.appendChild(overlay);
  }
  return overlay;
}

function closeProfileFavoritePicker() {
  const overlay = document.getElementById('profile-favorite-picker-modal');
  if (overlay) overlay.classList.remove('open');
  clearTimeout(profileFavoritePickerSearchTimer);
  profileFavoritePickerState = null;
}

/* v619: shrink any oversized data-URL image inside showcaseFavorites before
   we write to Firestore. Old saves (pre-v618) may still have 600×900 q0.85
   images sitting in memory; those keep the document over Firestore's 1 MiB
   limit even after we lowered the canvas for new uploads. We re-encode any
   image data URL that exceeds the threshold down to ~400×600 q0.65. */
const SHOWCASE_IMAGE_MAX_BYTES = 60 * 1024;        // ~60 KB per image
const SHOWCASE_TARGET_W = 400;
const SHOWCASE_TARGET_H = 600;

function approximateDataUrlBytes(dataUrl = '') {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return 0;
  const i = dataUrl.indexOf(',');
  if (i < 0) return 0;
  return Math.floor((dataUrl.length - i - 1) * 0.75);
}

function shrinkDataUrlImage(dataUrl) {
  return new Promise(resolve => {
    if (!dataUrl || !dataUrl.startsWith('data:')) { resolve(dataUrl); return; }
    if (approximateDataUrlBytes(dataUrl) <= SHOWCASE_IMAGE_MAX_BYTES) { resolve(dataUrl); return; }
    const img = new Image();
    img.onload = () => {
      try {
        const ratio = Math.min(SHOWCASE_TARGET_W / img.width, SHOWCASE_TARGET_H / img.height, 1);
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        let q = 0.65;
        let out = canvas.toDataURL('image/jpeg', q);
        // Step quality down further if still over budget
        while (approximateDataUrlBytes(out) > SHOWCASE_IMAGE_MAX_BYTES && q > 0.30) {
          q -= 0.10;
          out = canvas.toDataURL('image/jpeg', q);
        }
        resolve(out);
      } catch (e) {
        console.warn('Image shrink failed; using original:', e);
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function shrinkShowcaseImagesIfNeeded(showcase = {}) {
  const out = {};
  for (const [section, list] of Object.entries(showcase || {})) {
    if (!Array.isArray(list)) { out[section] = list; continue; }
    const next = [];
    for (const entry of list) {
      const e = entry && typeof entry === 'object' ? { ...entry } : { name: '', image: '', rating: '' };
      if (typeof e.image === 'string' && e.image.startsWith('data:') && approximateDataUrlBytes(e.image) > SHOWCASE_IMAGE_MAX_BYTES) {
        e.image = await shrinkDataUrlImage(e.image);
      }
      next.push(e);
    }
    out[section] = next;
  }
  return out;
}

/* v620: walk an arbitrary object and shrink every oversized base64 data URL
   found inside it. Used to clean a bloated Firestore document in one pass. */
async function shrinkDataUrlsDeep(value) {
  if (typeof value === 'string') {
    if (value.startsWith('data:') && approximateDataUrlBytes(value) > SHOWCASE_IMAGE_MAX_BYTES) {
      return await shrinkDataUrlImage(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) out.push(await shrinkDataUrlsDeep(item));
    return out;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = await shrinkDataUrlsDeep(v);
    }
    return out;
  }
  return value;
}

async function saveProfileFavoritesAuto(message = 'saved', options = {}) {
  if (isViewingOtherProfile()) return false;
  const debounceMs = Number(options.debounceMs || 0);
  if (debounceMs > 0) {
    const seq = ++profileFavoriteAutoSaveSeq;
    clearTimeout(profileFavoriteAutoSaveTimer);
    profileFavoriteAutoSaveTimer = setTimeout(() => {
      if (seq === profileFavoriteAutoSaveSeq) saveProfileFavoritesAuto(message, { debounceMs: 0 });
    }, debounceMs);
    return true;
  }

  if (!userProfile) userProfile = normalizeUserProfile({});
  readProfileDraftFromPage(userProfile);

  if (isPreviewMode() || !currentUser) {
    if (typeof showToast === 'function') showToast(message);
    renderProfileFavorites();
    return true;
  }

  /* v619: shrink any oversized base64 images BEFORE writing so the Firestore
     document stays well under the 1 MiB cap. */
  let safeShowcase = userProfile.showcaseFavorites || getDefaultShowcaseFavorites();
  try {
    safeShowcase = await shrinkShowcaseImagesIfNeeded(safeShowcase);
    userProfile.showcaseFavorites = safeShowcase; // keep in-memory in sync
  } catch (e) {
    console.warn('Showcase image shrink pass failed:', e);
  }

  const patch = {
    pinnedFavorites: userProfile.pinnedFavorites || getDefaultPinnedFavorites(),
    showcaseFavorites: safeShowcase,
    profileVisibility: userProfile.profileVisibility || getDefaultProfileVisibility(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  try {
    try {
      const debugSize = JSON.stringify(patch).length;
      console.log('[profile save] approx patch bytes:', debugSize);
    } catch (sizeErr) {}
    await db.collection('users').doc(currentUser.uid).set(patch, { merge: true });
    usersMap[currentUser.uid] = {
      ...(usersMap[currentUser.uid] || {}),
      uid: currentUser.uid,
      pinnedFavorites: patch.pinnedFavorites,
      showcaseFavorites: patch.showcaseFavorites,
      profileVisibility: patch.profileVisibility
    };
    if (typeof showToast === 'function') showToast(message);
    return true;
  } catch (e) {
    console.error('Profile favorites auto-save failed:', e);
    /* v620: rescue mode for the Firestore 1 MiB document-size error.
       Pull the entire existing document, shrink every base64 data URL in it,
       merge in our new patch (also shrunken), and overwrite the doc. This
       fixes accumulated bloat from old uploads that pre-date our compressed
       canvas writes. */
    const isSizeError = !!(e && (
      e.code === 'invalid-argument' ||
      String(e.message || '').toLowerCase().includes('size')
    ));
    if (isSizeError) {
      try {
        if (typeof showToast === 'function') showToast('Cleaning up oversized images…', { durationMs: 2400 });
        const docRef = db.collection('users').doc(currentUser.uid);
        const snap = await docRef.get();
        const existing = snap.exists ? snap.data() : {};
        const cleaned = await shrinkDataUrlsDeep({ ...existing, ...patch });
        cleaned.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
        try { console.log('[profile save] rescue cleaned bytes:', JSON.stringify(cleaned).length); } catch(_) {}
        await docRef.set(cleaned, { merge: false });
        usersMap[currentUser.uid] = {
          ...(usersMap[currentUser.uid] || {}),
          uid: currentUser.uid,
          pinnedFavorites: cleaned.pinnedFavorites,
          showcaseFavorites: cleaned.showcaseFavorites,
          profileVisibility: cleaned.profileVisibility,
          photo: cleaned.photo,
          customPhoto: cleaned.customPhoto
        };
        if (cleaned.showcaseFavorites) userProfile.showcaseFavorites = cleaned.showcaseFavorites;
        if (cleaned.photo) userProfile.photo = cleaned.photo;
        if (typeof showToast === 'function') showToast('saved');
        return true;
      } catch (rescueErr) {
        console.error('Profile rescue write failed:', rescueErr);
        const detail2 = (rescueErr && (rescueErr.code || rescueErr.message)) ? `: ${rescueErr.code || ''} ${rescueErr.message || ''}`.trim() : '';
        if (typeof showToast === 'function') showToast(`Save still failing${detail2}`.slice(0, 160), { durationMs: 6000 });
        return false;
      }
    }
    const detail = (e && (e.code || e.message)) ? `: ${e.code || ''} ${e.message || ''}`.trim() : '';
    if (typeof showToast === 'function') showToast(`Save failed${detail}`.slice(0, 160), { durationMs: 6000 });
    return false;
  }
}

function openProfileFavoritePicker(event, card) {
  if (isViewingOtherProfile() || !card || !profileEditModeOpen) return;
  if (event) event.stopPropagation();
  if (card.classList.contains('profile-manual-slot')) {
    if (['fictionalCharacters', 'musicArtists'].includes(card.dataset.manualSection) && typeof openProfileCharacterEditor === 'function') {
      openProfileCharacterEditor(event, card);
      return;
    }
    openProfileManualFavoritePicker(event, card);
    return;
  }
  if (card.classList.contains('profile-db-slot') && ['actors', 'directors'].includes(card.dataset.profileDbSection) && typeof openProfileCharacterEditor === 'function') {
    openProfileCharacterEditor(event, card);
    return;
  }
  const section = card.dataset.profileDbSection;
  const index = Number(card.dataset.profileDbIndex || 0);
  const config = getProfileFavoriteConfig(section);
  if (!config) return;
  const libraryResults = getProfileFavoriteLibraryResults(config);
  profileFavoritePickerState = {
    mode: 'database',
    section,
    index,
    config,
    card,
    query: '',
    results: [],
    libraryResults,
    hit: null,
    rating: card.dataset.profileDbRating || '',
    libraryRating: '',
    searchOpen: false
  };
  renderProfileFavoriteLibraryPicker();
}

function renderProfileFavoritePickerShell(inner) {
  const overlay = ensureProfileFavoritePickerModal();
  const databaseMode = profileFavoritePickerState?.mode === 'database';
  overlay.classList.toggle('profile-favorite-picker-bottom-sheet', databaseMode);
  overlay.innerHTML = `<div class="profile-favorite-picker-modal ${databaseMode ? 'profile-library-picker-modal' : ''}" role="dialog" aria-modal="true">
    <div class="profile-picker-head">
      <div><div class="profile-picker-title">${escHtml(profileFavoritePickerState?.title || 'Choose Favorite')}</div><div class="profile-picker-sub">${escHtml(profileFavoritePickerState?.sub || '')}</div></div>
      ${databaseMode ? `<button type="button" class="profile-library-search-toggle" onclick="toggleProfileFavoriteLibrarySearch()" aria-label="Search database">⌕</button>` : ''}
      <button type="button" class="profile-picker-close" onclick="closeProfileFavoritePicker()" aria-label="Close">×</button>
    </div>
    ${inner}
  </div>`;
  overlay.classList.add('open');
}


function renderProfileFavoriteTileGrid(items = [], clickFunction = 'selectProfileFavoriteLibraryPick') {
  if (!items.length) return '<div class="profile-picker-message">No titles found.</div>';
  return `<div class="profile-library-picker-grid">${items.map((hit, i) => {
    const img = hit.image ? `<img src="${escAttr(hit.image)}" alt="${escAttr(hit.title || 'Title poster')}">` : getProfilePickerImageFallbackHTML();
    return `<button type="button" class="profile-library-picker-tile" onclick="${clickFunction}(${i})">
      <span class="profile-library-picker-poster">${img}</span>
      <span class="profile-library-picker-name">${escHtml(hit.title || 'Untitled')}</span>
    </button>`;
  }).join('')}</div>`;
}

function renderProfileFavoriteLibraryPicker(message = '') {
  const state = profileFavoritePickerState;
  if (!state || state.mode !== 'database') return;
  state.title = state.config?.label || 'Choose Favorite';
  state.sub = `Choose from ${getProfileFavoritePickerActionLabel(state.config)}. Sorted highest rated first.`;
  const searchHtml = state.searchOpen ? `<div class="profile-picker-searchbar profile-library-searchbar">
    <input id="profile-picker-search-input" type="text" placeholder="Search ${escAttr(getProfileDatabaseSearchLabel(state.config))}" value="${escAttr(state.query || '')}" oninput="queueProfileFavoritePickerSearch(this)" onkeydown="if(event.key==='Enter'){event.preventDefault();profileFavoritePickerSearch();}">
  </div>` : '';
  const clearHtml = state.card?.dataset.profileDbTitle ? '<button type="button" class="profile-picker-secondary-btn profile-library-clear-btn" onclick="clearProfileFavoriteFromPicker()">Clear this spot</button>' : '';
  const body = state.searchOpen
    ? `<div id="profile-picker-results" class="profile-picker-results profile-library-search-results">${message ? `<div class="profile-picker-message">${escHtml(message)}</div>` : '<div class="profile-picker-message">Search the database for this category.</div>'}</div>`
    : `<div id="profile-picker-results" class="profile-picker-results">${renderProfileFavoriteTileGrid(state.libraryResults || [], 'selectProfileFavoriteLibraryPick')}</div>`;
  renderProfileFavoritePickerShell(`
    ${searchHtml}
    ${body}
    <div class="profile-picker-actions">${clearHtml}</div>
  `);
  if (state.searchOpen) setTimeout(() => document.getElementById('profile-picker-search-input')?.focus(), 30);
}

function toggleProfileFavoriteLibrarySearch() {
  const state = profileFavoritePickerState;
  if (!state || state.mode !== 'database') return;
  state.searchOpen = !state.searchOpen;
  state.query = '';
  state.results = [];
  renderProfileFavoriteLibraryPicker();
}

function selectProfileFavoriteLibraryPick(index) {
  const state = profileFavoritePickerState;
  if (!state || state.mode !== 'database' || !state.card) return;
  const hit = state.libraryResults?.[index];
  if (!hit) return;
  writeProfileDatabaseFavoriteToCard(state.card, hit, hit.rating || '');
  closeProfileFavoritePicker();
  saveProfileFavoritesAuto('saved');
}

function renderProfileFavoritePickerSearch(message = '') {
  const state = profileFavoritePickerState;
  if (!state) return;
  state.title = state.config?.label || 'Choose Favorite';
  state.sub = getProfilePickerSubtext(state.config, 'database');
  const resultsHtml = message ? `<div class="profile-picker-message">${escHtml(message)}</div>` : '<div class="profile-picker-message">Search for the title you want to feature.</div>';
  renderProfileFavoritePickerShell(`
    <div class="profile-picker-searchbar">
      <input id="profile-picker-search-input" type="text" placeholder="Search title" value="${escAttr(state.query || '')}" oninput="queueProfileFavoritePickerSearch(this)" onkeydown="if(event.key==='Enter'){event.preventDefault();}">
    </div>
    <div id="profile-picker-results" class="profile-picker-results">${resultsHtml}</div>
    <div class="profile-picker-actions">
      ${state.card?.dataset.profileDbTitle ? '<button type="button" class="profile-picker-secondary-btn" onclick="clearProfileFavoriteFromPicker()">Clear</button>' : ''}
    </div>
  `);
  setTimeout(() => document.getElementById('profile-picker-search-input')?.focus(), 30);
}

function queueProfileFavoritePickerSearch(input) {
  const state = profileFavoritePickerState;
  if (!state || state.mode !== 'database') return;
  state.query = (input?.value || '').trim();
  clearTimeout(profileFavoritePickerSearchTimer);
  const resultsEl = document.getElementById('profile-picker-results');
  if (!state.query) {
    state.results = [];
    if (resultsEl) resultsEl.innerHTML = '<div class="profile-picker-message">Search for the title you want to feature.</div>';
    return;
  }
  profileFavoritePickerSearchTimer = setTimeout(() => profileFavoritePickerSearch(), 320);
}

async function profileFavoritePickerSearch() {
  const state = profileFavoritePickerState;
  if (!state || state.mode !== 'database') return;
  const input = document.getElementById('profile-picker-search-input');
  const resultsEl = document.getElementById('profile-picker-results');
  const query = (input?.value || '').trim();
  state.query = query;
  if (!resultsEl) return;
  if (!query) {
    resultsEl.innerHTML = '<div class="profile-picker-message">Search for the title you want to feature.</div>';
    return;
  }
  const searchSeq = ++profileFavoritePickerSearchSeq;
  resultsEl.innerHTML = `<div class="profile-picker-message">Searching ${escHtml(getProfileDatabaseSearchLabel(state.config))}...</div>`;
  try {
    const hits = state.config.source === 'library'
      ? searchProfileLibraryFavorites(query, state.libraryResults || [])
      : (state.config.source === 'rawg' ? await searchProfileRawgFavorites(query) : await searchProfileTmdbFavorites(state.config, query));
    if (!profileFavoritePickerState || profileFavoritePickerState !== state || searchSeq !== profileFavoritePickerSearchSeq) return;
    state.results = hits.slice(0, 12);
    if (!state.results.length) {
      resultsEl.innerHTML = '<div class="profile-picker-message">No results found.</div>';
      return;
    }
    resultsEl.innerHTML = renderProfileFavoriteTileGrid(state.results, 'selectProfileFavoritePickerResult');
  } catch(e) {
    console.error('Profile favorite picker search failed:', e);
    if (!profileFavoritePickerState || profileFavoritePickerState !== state || searchSeq !== profileFavoritePickerSearchSeq) return;
    resultsEl.innerHTML = '<div class="profile-picker-message">Search failed. Try again.</div>';
  }
}

function searchProfileLibraryFavorites(query, libraryResults = []) {
  const queryKey = normalizeProfileMatchText(query);
  if (!queryKey) return [];
  return (libraryResults || []).filter(hit => {
    const titleMatch = normalizeProfileMatchText(hit.title).includes(queryKey);
    const metaMatch = normalizeProfileMatchText(hit.meta).includes(queryKey);
    return titleMatch || metaMatch;
  });
}

function selectProfileFavoritePickerResult(resultIndex) {
  const state = profileFavoritePickerState;
  if (!state || state.mode !== 'database' || !state.card) return;
  const hit = state.results?.[resultIndex];
  if (!hit) return;
  const libraryRating = getProfileLibraryRatingForFavorite(state.config, hit);
  writeProfileDatabaseFavoriteToCard(state.card, hit, libraryRating || '');
  closeProfileFavoritePicker();
  saveProfileFavoritesAuto('saved');
}

function renderProfileFavoritePickerConfirm() {
  const state = profileFavoritePickerState;
  if (!state || !state.hit) return;
  const hit = state.hit;
  const coverStyle = hit.image ? `style="background-image:url('${escAttr(hit.image)}')"` : '';
  const libraryNote = getProfilePickerLibraryNote(state);
  state.title = 'Confirm Favorite';
  state.sub = getProfileRatingInputRequired(state.config)
    ? 'ScreenList scanned your library for this title before asking for a rating.'
    : 'Confirm this profile pick.';
  renderProfileFavoritePickerShell(`
    <div class="profile-picker-selected">
      <div class="profile-picker-selected-poster" ${coverStyle}>${getProfileFavoriteSelectedFallback(state)}</div>
      <div>
        <div class="profile-picker-selected-title">${escHtml(hit.title || 'Untitled')}</div>
        <div class="profile-picker-selected-meta">${escHtml(hit.meta || getProfileDatabaseSearchLabel(state.config))}</div>
        ${libraryNote}
      </div>
    </div>
    ${getProfileNoRatingInputHTML(state.config)}
    <div class="profile-picker-actions">
      <button type="button" class="profile-picker-secondary-btn" onclick="renderProfileFavoritePickerSearch()">Back</button>
      <button type="button" class="profile-picker-confirm-btn" onclick="confirmProfileFavoritePicker()">Confirm</button>
    </div>
  `);
  if (getProfileRatingInputRequired(state.config) && !state.libraryRating) setTimeout(() => document.getElementById('profile-picker-rating-input')?.focus(), 30);
}

function writeProfileDatabaseFavoriteToCard(card, hit, rating) {
  if (!card || !hit) return;
  card.dataset.profileDbId = hit.id || '';
  card.dataset.profileDbSource = hit.source || '';
  card.dataset.profileDbType = hit.type || '';
  card.dataset.profileDbTitle = hit.title || '';
  card.dataset.profileDbImage = hit.image || '';
  card.dataset.profileDbMeta = hit.meta || '';
  card.dataset.profileDbLegacyId = hit.legacyId || '';
  card.dataset.profileDbRating = rating || '';
  updateProfileDatabaseCardPreview(card);
  if (userProfile) readProfileDraftFromPage(userProfile);
}

function confirmProfileFavoritePicker() {
  const state = profileFavoritePickerState;
  if (!state || state.mode !== 'database' || !state.hit || !state.card) return;
  const rating = getProfileFavoriteConfirmRating();
  if (getProfileRatingInputRequired(state.config) && !rating) {
    if (typeof showToast === 'function') showToast('Add a rating first');
    else alert('Add a rating first');
    return;
  }
  writeProfileDatabaseFavoriteToCard(state.card, state.hit, rating);
  closeProfileFavoritePicker();
  saveProfileFavoritesAuto('saved');
}

function clearProfileFavoriteFromPicker() {
  const state = profileFavoritePickerState;
  if (!state || state.mode !== 'database') return;
  clearProfileDatabaseFavorite(state.section, state.index, { skipAutoSave: true });
  closeProfileFavoritePicker();
  saveProfileFavoritesAuto('saved');
}

function updateProfileManualCardPreview(card) {
  if (!card) return;
  const section = card.dataset.manualSection;
  const index = Number(card.dataset.manualIndex || 0);
  const name = (card.dataset.manualName || '').trim();
  const image = (card.dataset.manualImage || '').trim();
  const rating = isProfileNoRatingFavoriteKey(section) ? '' : (card.dataset.manualRating || '').trim();
  const poster = card.querySelector('.profile-manual-preview');
  const namePreview = card.querySelector('[data-manual-name-preview]');
  const ratingPreview = card.querySelector('[data-manual-rating-preview]');
  if (poster) {
    poster.style.backgroundImage = image ? `url('${image.replace(/'/g, "%27")}')` : '';
    poster.innerHTML = getProfileFavoritePosterContent(image, index);
  }
  if (namePreview) { namePreview.textContent = name || 'Tap poster to add'; namePreview.classList.toggle('profile-fav-empty', !name); }
  setProfileFavoriteRatingPreview(ratingPreview, section, rating, 'Tap to rate');
}

function openProfileManualFavoritePicker(event, card) {
  if (isViewingOtherProfile() || !card) return;
  if (event) event.stopPropagation();
  const section = card.dataset.manualSection;
  const index = Number(card.dataset.manualIndex || 0);
  const config = getProfileFavoriteConfig(section) || { label: 'Top 3 Favorite', icon: '★', namePlaceholder: 'Name', ratingPlaceholder: 'Rating / note' };
  profileFavoritePickerState = { mode: 'manual', section, index, config, card, title: config.label, sub: getProfilePickerSubtext(config, 'manual') };
  renderProfileManualFavoritePicker();
}

function renderProfileManualFavoritePicker() {
  const state = profileFavoritePickerState;
  if (!state || state.mode !== 'manual') return;
  const card = state.card;
  renderProfileFavoritePickerShell(`
    <div class="profile-picker-manual-stack">
      <input id="profile-manual-picker-name" class="profile-picker-manual-input" type="text" placeholder="${escAttr(state.config.namePlaceholder || 'Name')}" value="${escAttr(card.dataset.manualName || '')}">
      ${getProfileManualRatingInputHTML(state)}
      <input id="profile-manual-picker-image" class="profile-picker-manual-input" type="url" placeholder="Image URL" value="${escAttr(card.dataset.manualImage || '')}">
    </div>
    <div class="profile-picker-actions">
      ${card.dataset.manualName ? '<button type="button" class="profile-picker-secondary-btn" onclick="clearProfileManualFavoriteFromPicker()">Clear</button>' : ''}
      <button type="button" class="profile-picker-confirm-btn" onclick="confirmProfileManualFavoritePicker()">Confirm</button>
    </div>
  `);
  setTimeout(() => document.getElementById('profile-manual-picker-name')?.focus(), 30);
}

function confirmProfileManualFavoritePicker() {
  const state = profileFavoritePickerState;
  if (!state || state.mode !== 'manual' || !state.card) return;
  state.card.dataset.manualName = (document.getElementById('profile-manual-picker-name')?.value || '').trim();
  state.card.dataset.manualRating = getProfileManualConfirmRating();
  state.card.dataset.manualImage = (document.getElementById('profile-manual-picker-image')?.value || '').trim();
  updateProfileManualCardPreview(state.card);
  if (userProfile) readProfileDraftFromPage(userProfile);
  closeProfileFavoritePicker();
  saveProfileFavoritesAuto('saved');
}

function clearProfileManualFavoriteFromPicker() {
  const state = profileFavoritePickerState;
  if (!state || state.mode !== 'manual' || !state.card) return;
  state.card.dataset.manualName = '';
  state.card.dataset.manualRating = '';
  state.card.dataset.manualImage = '';
  updateProfileManualCardPreview(state.card);
  if (userProfile) readProfileDraftFromPage(userProfile);
  closeProfileFavoritePicker();
  saveProfileFavoritesAuto('saved');
}

function toggleProfileFavoriteEditor(event, card) {
  openProfileFavoritePicker(event, card);
}

function updateProfileDatabaseCardPreview(card) {
  if (!card) return;
  const section = card.dataset.profileDbSection;
  const index = Number(card.dataset.profileDbIndex || 0);
  const title = (card.dataset.profileDbTitle || '').trim();
  const image = (card.dataset.profileDbImage || '').trim();
  const rating = isProfileNoRatingFavoriteKey(section) ? '' : (card.dataset.profileDbRating || card.querySelector('[data-profile-db-field="rating"]')?.value || '').trim();
  const poster = card.querySelector('.profile-fav-poster');
  const namePreview = card.querySelector('[data-db-name-preview]');
  const ratingPreview = card.querySelector('[data-db-rating-preview]');
  if (poster) {
    poster.style.backgroundImage = image ? `url('${image.replace(/'/g, "%27")}')` : '';
    poster.innerHTML = getProfileFavoritePosterContent(image, index);
  }
  if (namePreview) { namePreview.textContent = title || 'Tap poster to choose'; namePreview.classList.toggle('profile-fav-empty', !title); }
  setProfileFavoriteRatingPreview(ratingPreview, section, rating, 'Tap to rate');
}

function clearProfileDatabaseFavorite(section, index, options = {}) {
  const card = getProfileFavoriteCard(section, index);
  if (!card) return;
  ['id', 'source', 'type', 'title', 'image', 'meta', 'legacyId', 'rating'].forEach(field => { card.dataset['profileDb' + field.charAt(0).toUpperCase() + field.slice(1)] = ''; });
  const search = card.querySelector('.profile-db-search-input');
  const rating = card.querySelector('[data-profile-db-field="rating"]');
  const results = card.querySelector('.profile-db-results');
  if (search) search.value = '';
  if (rating) rating.value = '';
  if (results) results.innerHTML = '';
  updateProfileDatabaseCardPreview(card);
  if (userProfile) readProfileDraftFromPage(userProfile);
  if (!options.skipAutoSave) saveProfileFavoritesAuto('saved');
}

function queueProfileDatabaseSearch(input) {
  const card = input.closest('.profile-db-slot');
  if (!card) return;
  const key = `${card.dataset.profileDbSection}-${card.dataset.profileDbIndex}`;
  clearTimeout(profileFavoriteSearchTimers[key]);
  profileFavoriteSearchTimers[key] = setTimeout(() => profileDatabaseFavoriteSearch(card.dataset.profileDbSection, Number(card.dataset.profileDbIndex || 0)), 420);
}

async function profileDatabaseFavoriteSearch(section, index) {
  const config = getProfileFavoriteConfig(section);
  const card = getProfileFavoriteCard(section, index);
  if (!config || !card) return;
  const input = card.querySelector('.profile-db-search-input');
  const results = card.querySelector('.profile-db-results');
  const query = (input?.value || '').trim();
  if (!results) return;
  if (!query) { results.innerHTML = ''; return; }
  results.innerHTML = `<div class="profile-db-message">Searching ${escHtml(getProfileDatabaseSearchLabel(config))}...</div>`;
  try {
    let hits = [];
    if (config.source === 'rawg') hits = await searchProfileRawgFavorites(query);
    else hits = await searchProfileTmdbFavorites(config, query);
    if (!hits.length) { results.innerHTML = '<div class="profile-db-message">No results found.</div>'; return; }
    results.innerHTML = hits.slice(0, 6).map((hit, i) => {
      const resultKey = `${section}-${index}-${Date.now()}-${i}`;
      profileFavoriteSearchResults[resultKey] = hit;
      const thumb = hit.image ? `<img src="${escAttr(hit.image)}" alt="">` : getProfilePickerImageFallbackHTML();
      return `<button type="button" class="profile-db-result" onclick="selectProfileDatabaseFavorite('${escAttr(section)}', ${index}, '${escAttr(resultKey)}')">
        <div class="profile-db-result-img">${thumb}</div>
        <div class="profile-db-result-copy"><strong>${escHtml(hit.title || 'Untitled')}</strong><span>${escHtml(hit.meta || getProfileDatabaseSearchLabel(config))}</span></div>
      </button>`;
    }).join('');
  } catch(e) {
    console.error('Profile favorite search failed:', e);
    results.innerHTML = '<div class="profile-db-message">Search failed. Try again.</div>';
  }
}

async function searchProfileTmdbFavorites(config, query) {
  const type = config.tmdbType || 'movie';
  const endpointType = type === 'multi' ? 'multi' : type;
  const res = await fetchTmdbProxy(`search/${endpointType}`, { query });
  if (!res.ok) throw new Error('TMDB favorite search failed');
  const json = await res.json();
  const results = (json.results || []).filter(item => {
    if (type === 'multi') return (item.media_type === 'movie' || item.media_type === 'tv') && item.poster_path;
    return type === 'person' ? item.profile_path : item.poster_path;
  }).slice(0, 8);
  return results.map(item => {
    const mediaType = type === 'multi' ? (item.media_type || 'movie') : type;
    const title = item.title || item.name || 'Untitled';
    const date = item.release_date || item.first_air_date || '';
    const year = date ? date.slice(0, 4) : '';
    const knownFor = (item.known_for || []).map(k => k.title || k.name).filter(Boolean).slice(0, 2).join(', ');
    const imagePath = mediaType === 'person' ? item.profile_path : item.poster_path;
    const mediaLabel = mediaType === 'tv' ? 'TV / Anime' : (mediaType === 'movie' ? 'Movie' : 'TMDB');
    return {
      id: String(item.id || ''),
      source: 'tmdb',
      type: mediaType,
      title,
      image: imagePath ? `https://image.tmdb.org/t/p/w500${imagePath}` : '',
      meta: mediaType === 'person' ? (knownFor || 'TMDB person') : [year, mediaLabel].filter(Boolean).join(' · '),
      rating: ''
    };
  });
}

async function searchProfileRawgFavorites(query) {
  const res = await fetchRawgProxy('games', { search: query, page_size: 8 });
  if (!res.ok) throw new Error('RAWG favorite search failed');
  const json = await res.json();
  return (json.results || []).filter(item => item.background_image).slice(0, 8).map(item => {
    const year = (item.released || '').slice(0, 4);
    const platforms = (item.platforms || []).map(p => p.platform?.name).filter(Boolean).slice(0, 2).join(', ');
    return {
      id: String(item.id || ''),
      source: 'rawg',
      type: 'game',
      title: item.name || 'Untitled',
      image: item.background_image || '',
      meta: [year, platforms].filter(Boolean).join(' · ') || 'RAWG game',
      rating: ''
    };
  });
}

function selectProfileDatabaseFavorite(section, index, resultKey) {
  const hit = profileFavoriteSearchResults[resultKey];
  const card = getProfileFavoriteCard(section, index);
  if (!hit || !card) return;
  card.dataset.profileDbId = hit.id || '';
  card.dataset.profileDbSource = hit.source || '';
  card.dataset.profileDbType = hit.type || '';
  card.dataset.profileDbTitle = hit.title || '';
  card.dataset.profileDbImage = hit.image || '';
  card.dataset.profileDbMeta = hit.meta || '';
  card.dataset.profileDbLegacyId = '';
  const search = card.querySelector('.profile-db-search-input');
  const ratingInput = card.querySelector('[data-profile-db-field="rating"]');
  const results = card.querySelector('.profile-db-results');
  const config = getProfileFavoriteConfig(section);
  const libraryRating = config ? getProfileLibraryRatingForFavorite(config, hit) : '';
  if (search) search.value = '';
  card.dataset.profileDbRating = libraryRating || '';
  if (ratingInput) {
    ratingInput.value = libraryRating || '';
    setTimeout(() => ratingInput.focus(), 40);
  }
  if (results) results.innerHTML = '';
  updateProfileDatabaseCardPreview(card);
  if (userProfile) readProfileDraftFromPage(userProfile);
  saveProfileFavoritesAuto('saved', { debounceMs: getProfileRatingInputRequired(config) && !libraryRating ? 650 : 0 });
}


function getProfileMusicFavoriteLibraryItem(slot) {
  const legacyId = String(slot?.dataset?.profileDbLegacyId || '').trim();
  const id = String(slot?.dataset?.profileDbId || '').trim();
  return getProfileItemById('music', legacyId || id);
}

function openProfileDatabaseFavorite(event, card) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const slot = card?.closest ? card.closest('.profile-db-slot') : card;
  if (!slot) return;
  const id = String(slot.dataset.profileDbId || '').trim();
  const source = String(slot.dataset.profileDbSource || '').trim().toLowerCase();
  const type = String(slot.dataset.profileDbType || '').trim().toLowerCase();
  const title = String(slot.dataset.profileDbTitle || '').trim();
  const image = String(slot.dataset.profileDbImage || '').trim();
  const meta = String(slot.dataset.profileDbMeta || '').trim();
  if (!id || !title) return;

  if ((source === 'library' || type === 'music') && type === 'music') {
    const musicItem = getProfileMusicFavoriteLibraryItem(slot);
    if (musicItem && typeof openMusicAlbumProfile === 'function') openMusicAlbumProfile(musicItem);
    return;
  }

  if (source === 'rawg' || type === 'game') {
    setGameMediaProfileSeed(id, { id, rawgId: id, title, name: title, background_image: image, cover: image, image, meta });
    openGameMediaProfile(event, id, getGameMediaProfileSeed(id));
    return;
  }

  if (source !== 'tmdb') return;
  if (type === 'person') {
    openDiscoverPersonProfile(event, id);
    return;
  }

  if (type === 'movie' || type === 'tv') {
    setDiscoverMediaProfileSeed(type, id, { title, name: title, poster: image, backdrop: image });
    openDiscoverMediaProfile(event, type, id);
  }
}

/* v10.841: helper — renders the Pro-lock overlay that replaces the
   normal slot UI when slot index > 0 and the viewer isn't a bypass
   account. The overlay sits at the same position as the poster card so
   the row's grid still has 3 equal-width slots, just two of them are
   locked with a Pro badge. */
function canOpenProfileDatabaseFavoriteEntry(entry = {}) {
  const source = String(entry.source || '').trim().toLowerCase();
  const type = String(entry.type || '').trim().toLowerCase();
  if (!entry?.id || !entry?.title) return false;
  if (source === 'library' && type === 'music') return true;
  if (source === 'rawg' || type === 'game') return true;
  if (source === 'tmdb' && ['movie', 'tv', 'person'].includes(type)) return true;
  return false;
}

function getProfileTop3SlotLockHTML(index) {
  return `<div class="profile-fav-poster-card profile-fav-slot-locked" data-profile-slot-locked="1" data-profile-slot-index="${index}" aria-label="Locked — Pro feature">
    ${getProfileCardRankHTML(index)}
    <div class="profile-fav-poster profile-fav-slot-locked-poster" aria-hidden="true">
      <div class="profile-fav-slot-locked-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          <rect x="5" y="10" width="14" height="10" rx="2"></rect>
          <path d="M8 10V7a4 4 0 0 1 8 0v3"></path>
        </svg>
      </div>
      <div class="profile-fav-slot-locked-badge">Pro</div>
    </div>
    <div class="profile-fav-name profile-fav-slot-locked-name">Pro feature</div>
  </div>`;
}

/* v10.841: slot is locked when its index is 1 or 2 and the active profile
   is not the developer / creator-admin (kingkooom). Slot 0 always editable. */
function isProfileTop3SlotLocked(slotIndex, bypassTop3Lock) {
  return slotIndex > 0 && !bypassTop3Lock;
}

function renderDatabaseFavoriteRow(key, pins, bypassTop3Lock = true) {
  const config = getProfileFavoriteConfig(key);
  if (!config) return '';
  const visible = isProfileRowVisible(key);
  const editing = !isViewingOtherProfile() && profileEditModeOpen;
  const rowHead = `<div class="profile-fav-row-head"><div class="profile-fav-row-title">${escHtml(config.label)}</div>${renderProfileVisibilityToggle(key)}</div>`;
  if (!visible) return editing ? `<div class="profile-fav-row">${rowHead}<div class="profile-hidden-note">Hidden from profile. Toggle Display to show this row again.</div></div>` : '';
  const slots = [0,1,2].map(i => {
    /* v10.841: slots 1 + 2 are Pro-locked unless the viewer is the developer
       account. Locked slots render a static lock overlay with no click handlers
       — the user must upgrade to Pro to use them. */
    if (isProfileTop3SlotLocked(i, bypassTop3Lock)) return getProfileTop3SlotLockHTML(i);
    const entry = getProfileDatabaseFavoriteDisplay(config, pins[config.key]?.[i]);
    const title = entry.title || '';
    const image = entry.image || '';
    const rating = isProfileNoRatingFavoriteKey(config.key) ? '' : (entry.rating || '');
    const cover = image ? `style="background-image:url('${escAttr(image)}')"` : '';
    const canOpenProfile = !editing && canOpenProfileDatabaseFavoriteEntry(entry);
    const posterClick = editing
      ? `onclick="openProfileFavoritePicker(event, this.closest('.profile-fav-poster-card'))" title="Choose from your library"`
      : (canOpenProfile ? `onclick="openProfileDatabaseFavorite(event, this.closest('.profile-fav-poster-card'))" title="Open profile"` : '');
    const openClass = canOpenProfile ? ' profile-db-openable' : '';
    const nameClick = canOpenProfile ? `onclick="openProfileDatabaseFavorite(event, this.closest('.profile-fav-poster-card'))" title="Open profile"` : '';
    return `<div class="profile-fav-poster-card profile-db-slot${openClass}${getProfileFavoriteNoRatingInput(config)}" data-profile-share-section="${escAttr(config.key)}" data-profile-share-index="${i}" data-profile-db-section="${escAttr(config.key)}" data-profile-db-index="${i}" data-profile-db-id="${escAttr(entry.id)}" data-profile-db-source="${escAttr(entry.source)}" data-profile-db-type="${escAttr(entry.type)}" data-profile-db-title="${escAttr(title)}" data-profile-db-image="${escAttr(image)}" data-profile-db-meta="${escAttr(entry.meta)}" data-profile-db-legacy-id="${escAttr(entry.legacyId)}" data-profile-db-rating="${escAttr(rating)}">
      ${getProfileCardRankHTML(i)}
      <div class="profile-fav-poster ${editing ? 'profile-fav-poster-action' : ''}" ${getProfileFavoritePosterAttrs(i)} ${cover} ${posterClick}>${getProfileFavoritePosterContent(image, i)}</div>
      <div class="profile-fav-name ${title ? '' : 'profile-fav-empty'}" data-db-name-preview ${nameClick}>${getProfileTitleHtml(title, editing, false)}</div>
      ${getProfileFavoriteDisplayRatingHTML(config.key, rating, false)}
    </div>`;
  }).join('');
  return `<div class="profile-fav-row">${rowHead}<div class="profile-fav-poster-grid">${slots}</div></div>`;
}

function renderManualFavoriteRow(key, showcase, bypassTop3Lock = true) {
  const config = getProfileFavoriteConfig(key);
  if (!config) return '';
  const visible = isProfileRowVisible(key);
  const editing = !isViewingOtherProfile() && profileEditModeOpen;
  const rowHead = `<div class="profile-fav-row-head"><div class="profile-fav-row-title">${escHtml(config.label)}</div>${renderProfileVisibilityToggle(key)}</div>`;
  if (!visible) return editing ? `<div class="profile-fav-row">${rowHead}<div class="profile-hidden-note">Hidden from profile. Toggle Display to show this row again.</div></div>` : '';
  const entries = showcase[key] || [0,1,2].map(() => getEmptyManualFavorite());
  const slots = [0,1,2].map(i => {
    /* v10.841: slots 1 + 2 are Pro-locked unless the viewer is the developer. */
    if (isProfileTop3SlotLocked(i, bypassTop3Lock)) return getProfileTop3SlotLockHTML(i);
    const entry = entries[i] || getEmptyManualFavorite();
    const rating = isProfileNoRatingFavoriteKey(key) ? '' : (entry.rating || '');
    const cover = entry.image ? `style="background-image:url('${escAttr(entry.image)}')"` : '';
    const posterClick = editing ? `onclick="openProfileFavoritePicker(event, this.closest('.profile-fav-poster-card'))" title="Click to edit"` : '';
    return `<div class="profile-fav-poster-card profile-manual-slot${getProfileFavoriteNoRatingInput(config)}" data-profile-share-section="${escAttr(key)}" data-profile-share-index="${i}" data-manual-section="${escAttr(key)}" data-manual-index="${i}" data-manual-name="${escAttr(entry.name)}" data-manual-image="${escAttr(entry.image)}" data-manual-rating="${escAttr(rating)}">
      ${getProfileCardRankHTML(i)}
      <div class="profile-fav-poster ${editing ? 'profile-fav-poster-action' : ''} profile-manual-preview" ${getProfileFavoritePosterAttrs(i)} ${cover} ${posterClick}>${getProfileFavoritePosterContent(entry.image, i)}</div>
      <div class="profile-fav-name ${entry.name ? '' : 'profile-fav-empty'}" data-manual-name-preview>${getProfileTitleHtml(entry.name, editing, true)}</div>
      ${getProfileFavoriteDisplayRatingHTML(key, rating, true)}
    </div>`;
  }).join('');
  return `<div class="profile-fav-row">${rowHead}<div class="profile-fav-poster-grid">${slots}</div></div>`;
}

function renderProfileMediaGroup(group, stats, pins, showcase, bypassTop3Lock = true) {
  const editing = !isViewingOtherProfile() && profileEditModeOpen;
  /* v10.841: 'overall' row is always fully unlocked (slot 0, 1, 2 all
     editable for everyone) — the slot lock applies only to category rows. */
  const groupBypass = group.key === 'overall' ? true : bypassTop3Lock;
  const statHtml = group.statKeys.length ? `<div class="profile-group-stats profile-group-stats-showcase-labels">${group.statKeys.map(key => `<div class="profile-group-stat" data-profile-group-stat="${escAttr(key)}"><div class="profile-group-stat-value">${getProfileStatValueHTML(stats, key)}</div><div class="profile-group-stat-label">${getProfileShowcaseStatLabelHTML(key)}</div></div>`).join('')}</div>` : '';
  const rows = group.rows.map(rowKey => PROFILE_DATABASE_FAVORITES.some(item => item.key === rowKey) ? renderDatabaseFavoriteRow(rowKey, pins, groupBypass) : renderManualFavoriteRow(rowKey, showcase, groupBypass)).join('');
  const sectionShareBtn = editing ? '' : `<button type="button" class="profile-section-share-btn" onclick="shareProfileFavoriteRow(event, this)" aria-label="Share ${escAttr(group.title)}">${getProfileFavoriteShareIconHTML()}</button>`;
  return `<section class="profile-media-group ${group.wide ? 'profile-media-group-wide' : ''}" data-profile-group="${escAttr(group.key)}">${sectionShareBtn}<div class="profile-media-head"><div class="profile-media-title-wrap"><div class="profile-media-title">${getProfileGroupTitleHTML(group)}</div><div class="profile-media-sub">${escHtml(group.sub)}</div></div></div>${statHtml}${rows}</section>`;
}

function isProfileTop3ProBypassProfile(profile = getActiveProfile()) {
  const uid = String(profile?.uid || profileViewingUser?.uid || currentUser?.uid || '').trim();
  const handle = String(profile?.usernameHandleLower || profile?.usernameHandle || '').trim().replace(/^@+/, '').toLowerCase();
  const email = normalizeEmail(profile?.emailLower || profile?.accountEmailLower || currentUser?.email || '');
  if (!isViewingOtherProfile() && typeof isShelfdProMember === 'function' && isShelfdProMember()) return true;
  if (typeof isCreatorAdmin === 'function' && isCreatorAdmin({ ...profile, uid, emailLower: email })) return true;
  if (typeof CREATOR_PUBLIC_UID !== 'undefined' && uid === CREATOR_PUBLIC_UID) return true;
  if (typeof CREATOR_ADMIN_EMAIL !== 'undefined' && email === CREATOR_ADMIN_EMAIL) return true;
  return handle === 'kingkooom';
}

function renderProfileTop3ProLockedCard() {
  return `<section class="profile-top3-pro-lock-card" data-profile-group="top3-pro-lock" aria-label="Locked Top 3 category showcase">
    <div class="profile-top3-pro-lock-backdrop" aria-hidden="true">
      <span></span><span></span><span></span><span></span><span></span>
    </div>
    <div class="profile-top3-pro-lock-content">
      <div class="profile-top3-pro-lock-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          <rect x="5" y="10" width="14" height="10" rx="2"></rect>
          <path d="M8 10V7a4 4 0 0 1 8 0v3"></path>
        </svg>
      </div>
      <div class="profile-top3-pro-lock-copy">
        <div class="profile-top3-pro-lock-title">Category Top 3 Showcase</div>
        <div class="profile-top3-pro-lock-sub">Top 3 Movies, TV Shows, Anime, Games, and Albums will be a Pro feature.</div>
        <div class="profile-top3-pro-lock-badge">Pro feature</div>
      </div>
    </div>
  </section>`;
}

function readProfileDraftFromPage(target) {
  if (isViewingOtherProfile()) return target || getActiveProfile();
  const next = target || normalizeUserProfile(userProfile || {});
  next.profileVisibility = getDefaultProfileVisibility();
  document.querySelectorAll('.profile-section-toggle-input').forEach(input => {
    const key = input.dataset.profileVisibleKey;
    if (key && Object.prototype.hasOwnProperty.call(next.profileVisibility, key)) next.profileVisibility[key] = input.checked;
  });
  next.pinnedFavorites = normalizePinnedFavorites(next.pinnedFavorites);
  document.querySelectorAll('.profile-db-slot').forEach(card => {
    const section = card.dataset.profileDbSection;
    const index = Number(card.dataset.profileDbIndex || 0);
    if (!section || !next.pinnedFavorites[section] || !next.pinnedFavorites[section][index]) return;
    next.pinnedFavorites[section][index] = normalizeDatabaseFavoriteEntry({
      id: card.dataset.profileDbId || '',
      source: card.dataset.profileDbSource || '',
      type: card.dataset.profileDbType || '',
      title: card.dataset.profileDbTitle || '',
      image: card.dataset.profileDbImage || '',
      meta: card.dataset.profileDbMeta || '',
      legacyId: card.dataset.profileDbLegacyId || '',
      rating: (card.dataset.profileDbRating || card.querySelector('[data-profile-db-field="rating"]')?.value || '').trim()
    });
  });
  next.showcaseFavorites = normalizeShowcaseFavorites(next.showcaseFavorites);
  document.querySelectorAll('.profile-manual-slot').forEach(card => {
    const section = card.dataset.manualSection;
    const index = Number(card.dataset.manualIndex || 0);
    if (!section || !next.showcaseFavorites[section] || !next.showcaseFavorites[section][index]) return;
    next.showcaseFavorites[section][index] = {
      name: (card.dataset.manualName || '').trim(),
      image: (card.dataset.manualImage || '').trim(),
      rating: (card.dataset.manualRating || '').trim()
    };
  });
  return next;
}
function renderProfileFavoritesOnly() {
  if (!userProfile) userProfile = normalizeUserProfile({});
  readProfileDraftFromPage(userProfile);
  renderProfileFavorites();
}
function renderProfileFavorites() {
  const grid = document.getElementById('profile-favorites-grid');
  if (!grid) return;
  const profile = getActiveProfile();
  const pins = normalizePinnedFavorites(profile?.pinnedFavorites);
  const visibility = normalizeProfileVisibility(profile?.profileVisibility);
  const showcase = normalizeShowcaseFavorites(profile?.showcaseFavorites);
  profile.pinnedFavorites = pins; profile.profileVisibility = visibility; profile.showcaseFavorites = showcase;
  if (!isViewingOtherProfile()) userProfile = profile;
  else profileViewingProfile = profile;
  const stats = calculateProfileStats();
  const bypassTop3Lock = isProfileTop3ProBypassProfile(profile);
  /* v10.841: ALL category groups now show for everyone — the Pro lock has
     moved from "hide entire row" to "per-slot lock" (slot #1 unlocked,
     slots #2 + #3 locked unless viewer is the developer account). Removed
     the trailing renderProfileTop3ProLockedCard() — its replacement is
     the inline lock overlay rendered by getProfileTop3SlotLockHTML(). */
  const renderedGroups = PROFILE_MEDIA_GROUPS
    .filter(group => isProfileSectionVisibleFromListTabs(group.key, profile))
    .map(group => renderProfileMediaGroup(group, stats, pins, showcase, bypassTop3Lock));
  grid.innerHTML = renderedGroups.join('');
}
