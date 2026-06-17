let profileReturnTab = 'mylist';
let profileReturnState = null;
let landingPublicProfileActive = false;
let profileViewingUser = null;
let profileViewingProfile = null;
let profileViewingData = null;
let profileSettingsOpen = false;
let profileFavoriteSearchTimers = {};
let profileFavoriteSearchResults = {};
let profileFavoritePickerState = null;
let profileFavoritePickerSearchTimer = null;
let profileFavoritePickerSearchSeq = 0;
let profileFavoriteAutoSaveTimer = null;
let profileFavoriteAutoSaveSeq = 0;
let profileEditModeOpen = false;
let profileSharedFavoriteFocus = null;
let profileSharedFavoriteOpening = false;
let profileSettingsActiveSection = '';
let profileSettingsSubpageGestureEpoch = 0;
let profileFollowerIdsCache = {};
let profileFollowerIdsPending = {};
let profileFriendShelfReturnTopPx = 0;

const PROFILE_NOTIFICATION_PREF_CONFIG = [
  { key: 'directMessages', label: 'Direct Messages', sub: 'New one-to-one and group chat messages.', types: ['direct_message'] },
  { key: 'activityLikes', label: 'Activity Likes', sub: 'When someone likes your activity or review.', types: ['activity_like', 'feed_like'] },
  { key: 'activityComments', label: 'Activity Comments', sub: 'Comments and replies on your activity.', types: ['activity_comment', 'comment_reply', 'comment_like'] },
  { key: 'friendRequests', label: 'Friend Requests', sub: 'When someone sends you a friend request.', types: ['friend_request'] },
  { key: 'friendAccepts', label: 'Friend Request Accepted', sub: 'When someone accepts your friend request.', types: ['friend_accept'] },
  { key: 'friendReviews', label: 'Friend Reviews', sub: 'When a friend posts a full review.', types: ['friend_review_posted'] },
  { key: 'friendHighlights', label: 'Friend Highlights', sub: 'When a friend shares a new highlight reel.', types: ['friend_highlight_posted'] },
  { key: 'sharedWatchRequests', label: 'Watch Together Requests', sub: 'Planning to Watch and Watched Together requests.', types: ['shared_watch_request'] }
];

function getDefaultNotificationPreferences() {
  return PROFILE_NOTIFICATION_PREF_CONFIG.reduce((acc, item) => {
    acc[item.key] = true;
    return acc;
  }, {});
}

function normalizeNotificationPreferences(raw = {}) {
  const defaults = getDefaultNotificationPreferences();
  if (raw && typeof raw === 'object') {
    Object.keys(defaults).forEach(key => {
      if (raw[key] === false) defaults[key] = false;
    });
  }
  return defaults;
}

function getNotificationPreferenceKeyForType(type = '') {
  const clean = String(type || '').trim();
  const config = PROFILE_NOTIFICATION_PREF_CONFIG.find(item => item.types.includes(clean));
  return config ? config.key : '';
}

function isOwnCreatorSettingsAccount() {
  const uid = String(currentUser?.uid || userProfile?.uid || '').trim();
  const email = normalizeEmail(currentUser?.email || userProfile?.emailLower || userProfile?.accountEmailLower || '');
  return uid === CREATOR_PUBLIC_UID || email === CREATOR_ADMIN_EMAIL;
}

function cloneProfileReturnState(state = null) {
  if (!state || typeof state !== 'object') return null;
  const next = { ...state };
  if (state.user && typeof state.user === 'object') next.user = { ...state.user };
  if (state.returnState && typeof state.returnState === 'object') next.returnState = { ...state.returnState };
  return next;
}

function buildProfileReturnState() {
  if (viewingUser?.uid) {
    return {
      kind: 'friend-home',
      tab: 'community',
      user: {
        uid: viewingUser.uid,
        name: viewingUser.name || 'Friend',
        photo: viewingUser.photo || ''
      },
      returnState: cloneProfileReturnState(viewingReturnState) || (typeof captureCommunityReturnState === 'function'
        ? captureCommunityReturnState('friend-home')
        : null)
    };
  }

  const mainTab = getActiveMainTab ? getActiveMainTab() : 'community';
  if (mainTab === 'community' && typeof captureCommunityReturnState === 'function') {
    return captureCommunityReturnState('profile');
  }

  return { kind: 'main', tab: mainTab };
}

/* v10.133: Backloggd link entry removed permanently — no plans to bring
   it back, so the config no longer mentions it and the visibility key
   `linkBackloggd` is gone from the default visibility map below. */
const PROFILE_LINK_CONFIG = [
  { key: 'imdb', label: 'IMDb', domain: 'imdb.com', placeholder: 'https://www.imdb.com/user/...' },
  { key: 'letterboxd', label: 'Letterboxd', domain: 'letterboxd.com', placeholder: 'https://letterboxd.com/username/' },
  { key: 'instagram', label: 'Instagram', domain: 'instagram.com', placeholder: 'https://www.instagram.com/username/' },
  { key: 'twitter', label: 'Twitter / X', domain: 'x.com', placeholder: 'https://x.com/username' },
  { key: 'appleMusic', label: 'Apple Music', domain: 'music.apple.com', placeholder: 'https://music.apple.com/profile/username', optionalMobile: true, visibilityKey: 'linkAppleMusic' },
  { key: 'spotify', label: 'Spotify', domain: 'spotify.com', placeholder: 'https://open.spotify.com/user/username', optionalMobile: true, visibilityKey: 'linkSpotify' }
];

const PROFILE_MOBILE_LINK_CONFIG = [
  ...PROFILE_LINK_CONFIG
];

const PROFILE_DATABASE_FAVORITES = [
  { key: 'overallMedia', label: 'Top 3 Overall Media', shortLabel: 'Overall Media', icon: '🏆', optional: false, source: 'tmdb', tmdbType: 'multi', sourceLabel: 'TMDB', searchPlaceholder: 'Search TMDB movies, TV, or anime', ratingPlaceholder: 'Your rating' },
  { key: 'movies', section: 'movies', label: 'Top 3 Movies', shortLabel: 'Movies', icon: '🎬', optional: false, source: 'tmdb', tmdbType: 'movie', sourceLabel: 'TMDB', searchPlaceholder: 'Search TMDB movies', ratingPlaceholder: 'Your rating' },
  { key: 'shows', section: 'shows', label: 'Top 3 TV Shows', shortLabel: 'TV Shows', icon: '📺', optional: false, source: 'tmdb', tmdbType: 'tv', sourceLabel: 'TMDB', searchPlaceholder: 'Search TMDB TV shows', ratingPlaceholder: 'Your rating' },
  { key: 'music', section: 'music', label: 'Top 3 Albums', shortLabel: 'Albums', icon: '\uD83C\uDFB5', optional: false, source: 'library', sourceLabel: 'Library', searchPlaceholder: 'Search your music library', ratingPlaceholder: 'Your rating' },
  { key: 'anime', section: 'anime', label: 'Top 3 Animes', shortLabel: 'Anime', icon: '🌸', optional: true, source: 'tmdb', tmdbType: 'tv', sourceLabel: 'TMDB', searchPlaceholder: 'Search TMDB anime', ratingPlaceholder: 'Your rating' },
  { key: 'games', section: 'games', label: 'Top 3 Games', shortLabel: 'Games', icon: '🎮', optional: true, source: 'rawg', rawgType: 'game', sourceLabel: 'RAWG', searchPlaceholder: 'Search RAWG games', ratingPlaceholder: 'Your rating' },
  { key: 'singlePlayerGames', section: 'games', label: 'Top 3 Single Player Games', shortLabel: 'Single Player', icon: '🕹️', optional: true, source: 'rawg', rawgType: 'game', sourceLabel: 'RAWG', searchPlaceholder: 'Search RAWG single player games', ratingPlaceholder: 'Your rating' },
  { key: 'actors', label: 'Top 3 Actors / Actresses', shortLabel: 'Actors', icon: '🎭', optional: true, source: 'tmdb', tmdbType: 'person', sourceLabel: 'TMDB', searchPlaceholder: 'Search TMDB people', ratingPlaceholder: 'Why they rank for you' },
  { key: 'directors', label: 'Top 3 Directors', shortLabel: 'Directors', icon: '🎞️', optional: true, source: 'tmdb', tmdbType: 'person', sourceLabel: 'TMDB', searchPlaceholder: 'Search TMDB directors', ratingPlaceholder: 'Why they rank for you' }
];

const PROFILE_MANUAL_FAVORITES = [
  { key: 'fictionalCharacters', label: 'Top 3 Fictional Characters', shortLabel: 'Characters', icon: '🦸', optional: true, namePlaceholder: 'Character', ratingPlaceholder: 'Rating / note' },
  { key: 'musicArtists', label: 'Top 3 Musical Artists', shortLabel: 'Music Artists', icon: '🎵', optional: true, namePlaceholder: 'Artist', ratingPlaceholder: 'Rating / note' }
];

const PROFILE_MEDIA_GROUPS = [
  { key: 'overall', title: 'Overall Media', icon: '🏆', sub: 'Your top 3 across movies, TV shows, and anime. This row is always visible.', statKeys: [], rows: ['overallMedia'], wide: true },
  { key: 'movies', title: 'Movies', icon: '🎬', sub: 'Movie hours, average rating, and your top 3 movies.', statKeys: ['movieHours', 'movieAvg'], rows: ['movies'] },
  { key: 'shows', title: 'TV Shows', icon: '📺', sub: 'TV watch time, average rating, and your top 3 shows.', statKeys: ['tvHours', 'tvAvg'], rows: ['shows'] },
  { key: 'music', title: 'Music Albums', icon: '\uD83C\uDFB5', sub: 'Listening hours, average rating, and your top 3 albums.', statKeys: ['musicHours', 'musicAvg'], rows: ['music'] },
  { key: 'anime', title: 'Anime', icon: '🌸', sub: 'Anime watch time, rating, and optional top 3 anime.', statKeys: ['animeHours', 'animeAvg'], rows: ['anime'] },
  { key: 'games', title: 'Video Games', icon: '🎮', sub: 'Played hours, game rating, and optional top 3 games.', statKeys: ['gameHours', 'gamesAvg'], rows: ['games'] },
  { key: 'characters', title: 'Fictional Characters', icon: '🦸', sub: 'Optional top 3 characters that define your taste.', statKeys: [], rows: ['fictionalCharacters'], wide: true },
  { key: 'people', title: 'Actors & Directors', icon: '🎭', sub: 'Optional top 3 actors / actresses and directors.', statKeys: [], rows: ['actors', 'directors'], wide: true },
  { key: 'musicArtists', title: 'Music', icon: '🎵', sub: 'Optional top 3 musical artists.', statKeys: [], rows: ['musicArtists'], wide: true }
];

function getEmptyDatabaseFavorite() {
  return { id: '', source: '', type: '', title: '', image: '', rating: '', meta: '', legacyId: '' };
}

function getDefaultPinnedFavorites() {
  return PROFILE_DATABASE_FAVORITES.reduce((acc, group) => {
    acc[group.key] = [0, 1, 2].map(() => getEmptyDatabaseFavorite());
    return acc;
  }, {});
}

function getDefaultProfileVisibility() {
  return {
    anime: true,
    games: true,
    singlePlayerGames: true,
    fictionalCharacters: true,
    actors: true,
    directors: true,
    musicArtists: true,
    statsAnimeHours: true,
    statsGameHours: true,
    statsAnimeAvg: true,
    statsGamesAvg: true,
    linkAppleMusic: true,
    linkSpotify: true
  };
}


function getDefaultListTabVisibility() {
  /* v10.416: books + manga are now permanently disabled as MyList categories.
     Defaults still expose the keys for backward compat with persisted profile
     docs, but they are hard-locked to false and the cogwheel modal no longer
     renders toggles for them. Anime + Games are the only user-toggleable
     categories. TV shows / Movies / Music are always visible and have no
     toggle UI at all. */
  return { anime: true, games: true, manga: false, books: false };
}

function normalizeListTabVisibility(raw) {
  const defaults = getDefaultListTabVisibility();
  if (raw && typeof raw === 'object') {
    defaults.anime = raw.anime !== false;
    defaults.games = raw.games !== false;
  }
  /* v10.416: hard-lock books + manga to disabled even if a stored profile
     doc previously had them set to true. */
  defaults.manga = false;
  defaults.books = false;
  return defaults;
}

function getActiveListTabVisibility() {
  if (viewingUser) {
    return normalizeListTabVisibility(
      viewingUser.listTabVisibility ||
      usersMap[viewingUser.uid]?.listTabVisibility
    );
  }
  return normalizeListTabVisibility(userProfile?.listTabVisibility);
}

function isListSectionVisibleFromVisibility(section, visibility = getDefaultListTabVisibility()) {
  const safe = normalizeListTabVisibility(visibility);
  /* v10.416: books + manga are globally disabled now — always return false
     regardless of what's in the saved profile doc. */
  if (section === 'books' || section === 'manga') return false;
  if (section === 'anime') return safe.anime !== false;
  if (section === 'games') return safe.games !== false;
  return true;
}

function isSectionVisibleInMyLists(section) {
  return isListSectionVisibleFromVisibility(section, getActiveListTabVisibility());
}

function getProfileListTabVisibility(profile = getActiveProfile()) {
  return normalizeListTabVisibility(profile?.listTabVisibility);
}

function isProfileSectionVisibleFromListTabs(section, profile = getActiveProfile()) {
  return isListSectionVisibleFromVisibility(section, getProfileListTabVisibility(profile));
}

function getFirstVisibleMyListSection(preferred = 'shows') {
  /* v10.416: books + manga removed from the section order — they are
     globally disabled and isSectionVisibleInMyLists() returns false for
     them anyway, but dropping them here avoids ever landing on a hidden
     category as the fallback. */
  const order = [preferred, 'shows', 'movies', 'anime', 'games'];
  return order.find(section => section && isSectionVisibleInMyLists(section)) || 'shows';
}

function ensureActiveSectionVisible() {
  if (isSectionVisibleInMyLists(activeSection)) return;
  activeSection = getFirstVisibleMyListSection('shows');
  activeTab = getDefaultTabForSection(activeSection);
}


function calculateMyListShelfSummary(source = data) {
  const safe = source && typeof source === 'object' ? source : getEmptyListData();
  const sections = ['shows', 'movies', 'anime', 'games', 'manga', 'books'];
  const shelfTotal = sections.reduce((sum, section) => sum + (Array.isArray(safe[section]) ? safe[section].length : 0), 0);
  const movieHours = (safe.movies || []).reduce((sum, item) => {
    if (item.status !== 'watched') return sum;
    const runtimeMinutes = Number(item.runtimeMinutes || item.runtime || 0);
    return sum + (runtimeMinutes > 0 ? runtimeMinutes / 60 : 2);
  }, 0);
  const tvHours = (safe.shows || []).reduce((sum, item) => sum + (getWatchedEpisodeCount(item, 'shows') * 45 / 60), 0);
  const animeHours = (safe.anime || []).reduce((sum, item) => sum + (getWatchedEpisodeCount(item, 'anime') * 24 / 60), 0);
  const gameHours = (safe.games || []).reduce((sum, item) => {
    const explicit = Number(item.gameHoursPlayed || item.gameHours || item.hoursPlayed || item.playtimeHours || 0);
    if (explicit > 0) return sum + explicit;
    const progress = Number(item.currentHours || item.currentEp || 0);
    return sum + Math.max(0, progress);
  }, 0);
  return {
    shelfTotal,
    totalHours: movieHours + tvHours + animeHours + gameHours
  };
}

function formatMyListShelfHours(value) {
  const n = Number(value || 0);
  if (n <= 0) return '0h';
  if (n < 10 && n % 1) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'h';
  }
  return Math.round(n).toLocaleString('en-US') + 'h';
}

function getShelfSummaryDisplayParts(source = data) {
  const shelfSummary = calculateMyListShelfSummary(source || getEmptyListData());
  return {
    shelfTotalText: Number(shelfSummary.shelfTotal || 0).toLocaleString('en-US'),
    totalHoursText: formatMyListShelfHours(shelfSummary.totalHours)
  };
}

function renderShelfSummaryInlineInnerHTML(source = data, dotClass = 'mylist-own-profile-stat-dot') {
  const parts = getShelfSummaryDisplayParts(source);
  return `
    <span><strong>${escHtml(parts.totalHoursText)}</strong> Watched</span>
    <span class="${escAttr(dotClass)}" aria-hidden="true">•</span>
    <span><strong>${escHtml(parts.shelfTotalText)}</strong> Library</span>`;
}

function renderShelfSummaryInlineHTML(source = data, className = 'mylist-own-profile-stats', dotClass = 'mylist-own-profile-stat-dot') {
  return `<div class="${escAttr(className)}" aria-label="Shelf summary">${renderShelfSummaryInlineInnerHTML(source, dotClass)}</div>`;
}

let myListTabDraftVisibility = null;
let _mylistVisOutsideHandler = null;
let _mylistSettingsScrollY = 0;
/* v10.416: books + manga removed — they are globally disabled categories
   so their clear-category rows no longer surface in the cogwheel modal. */
const MYLIST_CLEAR_CATEGORY_SECTIONS = [
  { key: 'shows', label: 'TV Shows' },
  { key: 'movies', label: 'Movies' },
  { key: 'anime', label: 'Anime' },
  { key: 'games', label: 'Games' }
];

function renderMyListEditControls() {
  const editHost = document.getElementById('mylist-edit-controls');
  const profileHost = document.getElementById('mylist-profile-controls');
  if (!editHost && !profileHost) return;

  if (viewingUser || document.body.classList.contains('profile-active')) {
    if (editHost) editHost.innerHTML = '';
    if (profileHost) {
      profileHost.innerHTML = '';
      profileHost.dataset.shelfdProfileKey = '';
    }
    return;
  }

  const profileName = userProfile?.name || currentUser?.displayName || 'Me';
  const profilePhoto = userProfile?.photo || currentUser?.photoURL || ('/default-avatar.svg#' + encodeURIComponent(profileName) + '&background=1c1535&color=a78bfa');

  if (profileHost) {
    // v429: avoid avatar flicker on category switch. Only rebuild the avatar
    // shortcut when the profile name/photo (or signed-in state) actually changes.
    // Re-rendering innerHTML on every render() destroys the <img>, which made
    // the avatar momentarily blank during pager transitions.
    /* v11381: own followers/following counts replace the Tier List button.
       Computed from the OWN profile explicitly so a stale profileViewingProfile
       can never leak a friend's count onto my own shelf header. */
    const ownSocialProfile = userProfile || (typeof getActiveProfile === 'function' ? getActiveProfile() : {}) || {};
    const ownFollowersCount = (typeof getSocialIdsForProfile === 'function') ? getSocialIdsForProfile(ownSocialProfile, 'followers').length : 0;
    const ownFollowingCount = (typeof getSocialIdsForProfile === 'function') ? getSocialIdsForProfile(ownSocialProfile, 'following').length : 0;
    const stateKey = currentUser
      ? `signed:${profileName}::${profilePhoto}::${ownFollowersCount}:${ownFollowingCount}`
      : 'anon';
    if (profileHost.dataset.shelfdProfileKey !== stateKey) {
      const currentBio = (userProfile?.bio || '').trim();
      const desktopMyListNav = `
    <div class="mylist-desktop-quick-nav mobile-bottom-nav" aria-label="Shelfd navigation">
      <button type="button" class="main-nav-btn" onclick="switchMainNav('discover')">Discover</button>
      <button type="button" class="main-nav-btn" onclick="goToActivityFeed()">Activity</button>
      <button type="button" class="main-nav-btn nav-search-btn" onclick="openSearchPage()" aria-label="Search">
        <svg class="nav-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
      </button>
      <button type="button" class="main-nav-btn" onclick="goToFriendsList()">Friends</button>
      <button type="button" class="main-nav-btn active" onclick="switchMainNav('mylist')">My Lists</button>
    </div>`;
      const profileShortcut = currentUser ? `
    <div class="mylist-own-profile-center">
      <button type="button" class="mylist-own-profile-shortcut" onclick="openProfile()" aria-label="Open my profile" title="Open my profile">
        <img src="${escAttr(profilePhoto)}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='/default-avatar.svg#${encodeURIComponent(profileName).replace(/'/g, '%27')}&background=1c1535&color=a78bfa'">
      </button>
      <div class="mylist-own-profile-name" role="button" tabindex="0" onclick="openProfile()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openProfile();}" aria-label="Open my profile" title="Open my profile">${escHtml(profileName)}</div>
      <div
        class="mylist-own-profile-bio${currentBio ? '' : ' is-empty'}"
        id="mylist-own-profile-bio"
        contenteditable="true"
        spellcheck="false"
        data-placeholder="Add a bio..."
        aria-label="Bio"
        onblur="saveMyListProfileBio(this)"
        onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}"
      >${escHtml(currentBio)}</div>
      <div class="mylist-profile-action-row" aria-label="My Lists quick actions">
        <!-- v11.204: Rating Game button DISABLED per request — hidden + not
             clickable. The launcher (openMovieRatingDuelLauncher) and the whole
             rating-duel game in 24-movie-rating-duel.js are intentionally LEFT
             INTACT; to restore, remove the hidden attr + style + tabindex. -->
        <button type="button" class="mylist-profile-action-btn mylist-profile-action-btn--game" onclick="openMovieRatingDuelLauncher()" hidden style="display:none !important;" tabindex="-1" aria-hidden="true">Rating Game</button>
        <!-- v11381: Tier List button removed; replaced with tappable
             followers / following counts that open my own social page. -->
        <button type="button" class="mylist-profile-social-count" onclick="openOwnSocialPage('followers')"><strong>${ownFollowersCount.toLocaleString('en-US')}</strong> followers</button>
        <span class="mylist-profile-social-sep" aria-hidden="true">·</span>
        <button type="button" class="mylist-profile-social-count" onclick="openOwnSocialPage('following')"><strong>${ownFollowingCount.toLocaleString('en-US')}</strong> following</button>
      </div>
      ${desktopMyListNav}
    </div>` : '';
      profileHost.innerHTML = profileShortcut;
      profileHost.dataset.shelfdProfileKey = stateKey;
    }
  }
  if (editHost) editHost.innerHTML = '';
}

/* v602: save inline bio edits back to userProfile + Firestore.
   Uses saveProfileSettingsPatch which is the safe partial-update path —
   only writes the bio fields, never overwrites name/photo/etc. */
function saveMyListProfileBio(el) {
  if (!el || !currentUser || !userProfile) return;
  const text = (el.innerText || el.textContent || '').trim();
  el.classList.toggle('is-empty', !text);
  if (text === (userProfile.bio || '').trim()) return; // no change
  // Write to in-memory profile immediately so rebuilds see it
  userProfile.bio = text;
  userProfile.profileBio = text;
  // Persist to Firestore using the proper partial-patch function
  saveProfileSettingsPatch({ bio: text, profileBio: text })
    .catch(e => console.warn('Bio save failed:', e));
}
window.saveMyListProfileBio = saveMyListProfileBio;

/* =============================================================================
   v11.514 — My List LIGHT MODE pilot (DEV-ONLY).
   A scoped, dev-account-gated light theme for the Shelf/My List page. Only the
   creator/dev account (isCreatorAdmin) sees the toggle and can activate light
   mode; everyone else is always dark (the class is never added — no-op).
   Persistence: localStorage (safe for a dev pilot, no Firestore schema change).
   The `.mylist-light-mode` class is applied to #mylist-view and to the settings
   modal; all visuals live in css/22-mylist-light-pilot.css. System
   (prefers-color-scheme) mode is a documented follow-up — manual Light/Dark
   ships first to keep this pass robust.
   ============================================================================= */
const SHELFD_MYLIST_THEME_KEY = 'shelfd_mylist_theme'; // 'light' | 'dark'
function getMyListThemePref() {
  try { return localStorage.getItem(SHELFD_MYLIST_THEME_KEY) === 'light' ? 'light' : 'dark'; }
  catch (_) { return 'dark'; }
}
function isMyListLightModeDevAccount() {
  if (typeof isCreatorAdmin !== 'function') return false;
  const u = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  const p = (typeof userProfile === 'object' && userProfile) ? userProfile : {};
  return isCreatorAdmin({ uid: u && u.uid, email: u && u.email, name: p.name || p.customName });
}
function applyMyListThemePilot() {
  /* v11.515: the Shelf/My List page shell (global .header, profile block, bottom
     nav) lives OUTSIDE #mylist-view, so light mode is driven by a ROUTE-GATED
     body class instead. `shelf-light-mode` is added ONLY when: dev account +
     light pref + the My List main tab is active (body.main-tab-mylist). Leaving
     the tab (syncMainNavButtons) re-runs this and removes it, so Discover /
     Friends / Activity never go light. #mylist-view keeps the class too for any
     legacy selectors. */
  const light = isMyListLightModeDevAccount() && getMyListThemePref() === 'light';
  const onShelf = document.body.classList.contains('main-tab-mylist');
  const active = light && onShelf;
  /* v11.516: the real page background is `html, body { background-color:
     var(--screenlist-mobile-topbar) }` (css/11) over `--shelfd-page-bg` (css/00),
     both rooted on <html>. <html> is the parent of <body>, so a body-scoped var
     override never reached it and the canvas stayed #0E0E0E. Tag <html> too so
     html.shelf-light-mode can swap those page-bg vars to paper. */
  document.documentElement.classList.toggle('shelf-light-mode', active);
  document.body.classList.toggle('shelf-light-mode', active);
  const view = document.getElementById('mylist-view');
  if (view) view.classList.toggle('mylist-light-mode', active);
  const modal = document.getElementById('mylist-settings-modal');
  if (modal) modal.classList.toggle('mylist-light-mode', active);
}
function setMyListThemePref(theme) {
  try { localStorage.setItem(SHELFD_MYLIST_THEME_KEY, theme === 'light' ? 'light' : 'dark'); } catch (_) {}
  applyMyListThemePilot();
}
function toggleMyListThemePilot(btn) {
  const next = getMyListThemePref() === 'light' ? 'dark' : 'light';
  setMyListThemePref(next);
  const isLight = next === 'light';
  if (btn) {
    btn.classList.toggle('on', isLight);
    btn.classList.toggle('off', !isLight);
    btn.setAttribute('aria-pressed', isLight ? 'true' : 'false');
    const row = btn.closest('.mylist-settings-row');
    const state = row ? row.querySelector('[data-ml-theme-state]') : null;
    if (state) state.textContent = isLight ? 'Light' : 'Dark';
  }
}
function renderMyListThemeToggleRow() {
  if (!isMyListLightModeDevAccount()) return '';
  const isLight = getMyListThemePref() === 'light';
  return `
    <div class="mylist-settings-section-label">Appearance · Dev Pilot</div>
    <div class="mylist-settings-row">
      <span class="mylist-settings-row-label">My List Theme — <span data-ml-theme-state>${isLight ? 'Light' : 'Dark'}</span></span>
      <button type="button" class="mylist-vis-toggle ${isLight ? 'on' : 'off'}" aria-pressed="${isLight ? 'true' : 'false'}" onclick="event.stopPropagation();toggleMyListThemePilot(this)" aria-label="Toggle My List light mode">
        <span class="mylist-vis-knob"></span>
      </button>
    </div>
    <div class="mylist-settings-divider"></div>`;
}
window.toggleMyListThemePilot = toggleMyListThemePilot;
window.applyMyListThemePilot = applyMyListThemePilot;

function getMyListCategoryItemCount(section = '') {
  const key = String(section || '').trim();
  const list = data && Array.isArray(data[key]) ? data[key] : [];
  return list.length;
}

function renderMyListCategoryClearRows() {
  return MYLIST_CLEAR_CATEGORY_SECTIONS.map(section => {
    const count = getMyListCategoryItemCount(section.key);
    const disabled = count <= 0 ? ' disabled' : '';
    const countLabel = `${count.toLocaleString('en-US')} title${count === 1 ? '' : 's'}`;
    return `
      <div class="mylist-settings-row mylist-clear-category-row" data-clear-category="${escAttr(section.key)}">
        <span class="mylist-settings-row-main">
          <span class="mylist-settings-row-label">${escHtml(section.label)}</span>
          <span class="mylist-edit-list-count">${escHtml(countLabel)}</span>
        </span>
        <button type="button" class="mylist-delete-category-btn" data-confirm-step="0" onclick="event.stopPropagation();handleMyListCategoryDeleteClick('${escAttr(section.key)}',this)"${disabled}>Clear</button>
      </div>`;
  }).join('');
}

function renderMyListSettingsInner() {
  const vis = normalizeListTabVisibility(myListTabDraftVisibility || userProfile?.listTabVisibility);
  /* v10.416: toggle list trimmed to Anime + Games only. TV shows / Movies /
     Music are always-on and have no toggle row. Books + Manga are globally
     disabled categories and don't appear here at all. */
  const sections = [
    { key: 'games', label: 'Games' },
    { key: 'anime', label: 'Anime' },
  ];
  return `
    <div class="mylist-settings-title">My List Settings</div>
    ${renderMyListThemeToggleRow()}
    <div class="mylist-settings-section-label">Categories Visibility Toggle</div>
    ${sections.map(s => `
      <div class="mylist-settings-row">
        <span class="mylist-settings-row-label">${escHtml(s.label)}</span>
        <button type="button" class="mylist-vis-toggle ${vis[s.key] !== false ? 'on' : 'off'}" onclick="event.stopPropagation();toggleMyListDraftSection('${s.key}')" aria-label="Toggle ${escAttr(s.label)}">
          <span class="mylist-vis-knob"></span>
        </button>
      </div>`).join('')}
    <div class="mylist-settings-divider"></div>
    <div class="mylist-settings-import-box">
      <div class="mylist-settings-row">
        <span class="mylist-settings-row-label">Import Lists</span>
        <button type="button" class="mylist-settings-action-btn" onclick="event.stopPropagation();closeMyListSettingsModal();setTimeout(openImportPage,180)">Import</button>
      </div>
      <!-- v10.287: Tracker.gg row removed from MyList settings per request.
           The trackergg-linking flow stays available via the existing
           openTrackerLinkModal() if needed elsewhere; just no longer
           surfaced from this settings panel. -->
    </div>
    <div class="mylist-settings-milky-divider"></div>
    <div class="mylist-settings-section-label">Clear Category Data</div>
    <div class="mylist-settings-clear-section">
      ${renderMyListCategoryClearRows()}
    </div>`;
}

function openMyListSettingsModal(triggerEl) {
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
  if (document.getElementById('mylist-settings-modal')) {
    closeMyListSettingsModal();
    return;
  }
  myListTabDraftVisibility = normalizeListTabVisibility(userProfile?.listTabVisibility);

  const modal = document.createElement('div');
  modal.id = 'mylist-settings-modal';
  modal.className = 'mylist-settings-modal';

  const panel = document.createElement('div');
  panel.className = 'mylist-settings-panel';
  panel.innerHTML = renderMyListSettingsInner();
  modal.appendChild(panel);
  document.body.appendChild(modal);
  /* v11.514: light-mode pilot — tag the body-appended modal so its scoped
     light theme applies (it lives outside #mylist-view). No-op unless the dev
     account has light mode on. */
  if (typeof applyMyListThemePilot === 'function') applyMyListThemePilot();

  /* v11.239: anchor the panel NEAR the cogwheel (top-left) instead of the
     viewport center — it pops out from the trigger like an iOS popover. The
     panel grows from its top-left corner (transform-origin) toward the body.
     Falls back to a sensible top-left inset if the trigger rect is missing. */
  const panelW = 230;
  const maxPanelH = Math.max(160, window.innerHeight - 40);
  panel.style.width = panelW + 'px';
  panel.style.maxHeight = maxPanelH + 'px';

  const margin = 10;
  let left = 14;
  let top = 64;
  try {
    const rect = (triggerEl && triggerEl.getBoundingClientRect)
      ? triggerEl.getBoundingClientRect()
      : document.getElementById('mylist-header-cog')?.getBoundingClientRect();
    if (rect && rect.width) {
      /* left-align the panel to the cog's left edge; open just beneath it */
      left = Math.round(rect.left);
      top = Math.round(rect.bottom + 8);
    }
  } catch (_) {}
  /* clamp inside the viewport so it never spills off-screen */
  left = Math.max(margin, Math.min(left, window.innerWidth - panelW - margin));
  top = Math.max(margin, Math.min(top, window.innerHeight - 160));

  panel.style.left = left + 'px';
  panel.style.top = top + 'px';
  panel.style.transformOrigin = '0% 0%';

  lockMyListSettingsPageScroll();

  setTimeout(() => {
    _mylistVisOutsideHandler = (e) => {
      const p = document.querySelector('.mylist-settings-panel');
      const cog = document.getElementById('mylist-header-cog');
      if (p && !p.contains(e.target) && !(cog && cog.contains(e.target))) closeMyListSettingsModal();
    };
    document.addEventListener('click', _mylistVisOutsideHandler);
  }, 0);
}

function closeMyListSettingsModal() {
  if (_mylistVisOutsideHandler) {
    document.removeEventListener('click', _mylistVisOutsideHandler);
    _mylistVisOutsideHandler = null;
  }
  const panel = document.querySelector('.mylist-settings-panel');
  if (panel) {
    panel.classList.add('closing');
    setTimeout(() => {
      const modal = document.getElementById('mylist-settings-modal');
      if (modal) modal.remove();
      unlockMyListSettingsPageScroll();
    }, 150);
  } else {
    const modal = document.getElementById('mylist-settings-modal');
    if (modal) modal.remove();
    unlockMyListSettingsPageScroll();
  }
  _commitMyListVisibility();
}

function lockMyListSettingsPageScroll() {
  if (document.body.classList.contains('mylist-settings-open')) return;
  _mylistSettingsScrollY = window.scrollY || window.pageYOffset || 0;
  document.documentElement.classList.add('mylist-settings-open');
  document.body.classList.add('mylist-settings-open');
  document.body.style.position = 'fixed';
  document.body.style.top = `-${_mylistSettingsScrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.width = '100%';
  document.body.style.overflow = 'hidden';
}

function unlockMyListSettingsPageScroll() {
  if (!document.body.classList.contains('mylist-settings-open')) return;
  const y = _mylistSettingsScrollY || Math.abs(parseInt(document.body.style.top || '0', 10)) || 0;
  document.documentElement.classList.remove('mylist-settings-open');
  document.body.classList.remove('mylist-settings-open');
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.width = '';
  document.body.style.overflow = '';
  window.scrollTo(0, y);
  _mylistSettingsScrollY = 0;
}

async function _commitMyListVisibility() {
  if (!myListTabDraftVisibility) return;
  const nextVisibility = normalizeListTabVisibility(myListTabDraftVisibility);
  myListTabDraftVisibility = null;
  if (!userProfile) userProfile = normalizeUserProfile({});
  userProfile.listTabVisibility = nextVisibility;

  ensureActiveSectionVisible();
  runMyListInternalPageJump(() => render());

  if (currentUser && !isPreviewMode()) {
    try {
      await db.collection("users").doc(currentUser.uid).set({
        listTabVisibility: nextVisibility,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      usersMap[currentUser.uid] = {
        ...(usersMap[currentUser.uid] || {}),
        uid: currentUser.uid,
        listTabVisibility: nextVisibility
      };
    } catch(e) {
      console.error("List tab visibility save failed:", e);
    }
  }
}

function toggleMyListDraftSection(section) {
  myListTabDraftVisibility = normalizeListTabVisibility(myListTabDraftVisibility || userProfile?.listTabVisibility);
  myListTabDraftVisibility[section] = !myListTabDraftVisibility[section];

  if (!userProfile) userProfile = normalizeUserProfile({});
  userProfile.listTabVisibility = normalizeListTabVisibility(myListTabDraftVisibility);
  ensureActiveSectionVisible();
  runMyListInternalPageJump(() => render());

  const btn = document.querySelector(`.mylist-vis-toggle[onclick*="'${section}'"]`);
  if (btn) {
    const isOn = myListTabDraftVisibility[section] !== false;
    btn.className = 'mylist-vis-toggle ' + (isOn ? 'on' : 'off');
  }
}


function refreshMyListSettingsPanel() {
  const panel = document.querySelector('.mylist-settings-panel');
  if (!panel) return;
  panel.innerHTML = renderMyListSettingsInner();
}

function handleMyListCategoryDeleteClick(section = '', button = null) {
  const key = String(section || '').trim();
  if (!MYLIST_CLEAR_CATEGORY_SECTIONS.some(row => row.key === key)) return;
  const currentCount = getMyListCategoryItemCount(key);
  if (!currentCount) return;
  const step = Math.max(0, Math.min(2, Number(button?.dataset?.confirmStep || 0)));
  if (step === 0) {
    button.dataset.confirmStep = '1';
    button.classList.add('confirming');
    button.textContent = 'Confirm';
    return;
  }
  if (step === 1) {
    button.dataset.confirmStep = '2';
    button.classList.add('confirming');
    button.textContent = 'Clear forever';
    return;
  }
  clearMyListCategoryData(key);
}

function clearMyListCategoryData(section = '') {
  const key = String(section || '').trim();
  if (!MYLIST_CLEAR_CATEGORY_SECTIONS.some(row => row.key === key)) return;
  if (!data || typeof data !== 'object') data = getEmptyListData();
  data[key] = [];
  if (ownDataCache && typeof ownDataCache === 'object') ownDataCache[key] = [];
  if (activeSection === key) {
    activeTab = getDefaultTabForSection(activeSection);
  }
  save();
  render();
  refreshMyListSettingsPanel();
  if (typeof showToast === 'function') {
    const label = MYLIST_CLEAR_CATEGORY_SECTIONS.find(row => row.key === key)?.label || 'Category';
    showToast(`${label} cleared from your library.`);
  }
}

function toggleMyListTabsEditor() {
  openMyListSettingsModal(document.getElementById('mylist-header-cog'));
}


function getEmptyManualFavorite() { return { name: '', image: '', rating: '' }; }

function getDefaultShowcaseFavorites() {
  return PROFILE_MANUAL_FAVORITES.reduce((acc, group) => {
    acc[group.key] = [0,1,2].map(() => getEmptyManualFavorite());
    return acc;
  }, {});
}

function getDefaultSocialLinks() {
  return PROFILE_MOBILE_LINK_CONFIG.reduce((acc, link) => {
    acc[link.key] = '';
    return acc;
  }, {});
}

function isViewingOtherProfile() {
  return !!profileViewingUser;
}

function getActiveProfile() {
  return profileViewingProfile || userProfile || normalizeUserProfile({});
}

function getProfileFallbackPhotoFor(profile) {
  const name = profile?.name || currentUser?.displayName || 'ScreenList User';
  return '/default-avatar.svg#' + encodeURIComponent(name) + '&background=1c1535&color=a78bfa';
}

function getViewingProfileName() {
  const profile = getActiveProfile();
  return profile?.name || profileViewingUser?.name || 'ScreenList User';
}

/* v11434: PENDING friend requests must never surface on a PUBLIC
   followers / following / mutual list that other users view. A request the
   viewed user has SENT (`outgoingRequests` = "awaiting their accept") or one
   they've RECEIVED but not yet accepted (`incomingRequests`) is not a confirmed
   connection — it is not a real follow/follower — so it must be removed from
   both the rendered list AND the count, regardless of which legacy array it may
   have leaked into. Mutating-set helper so every social resolver shares it. */
function excludePendingSocialIds(ids, profile) {
  if (!ids || !profile) return ids;
  const drop = uid => { if (uid) ids.delete(uid); };
  /* Every "not yet a confirmed connection" bucket — outgoing/incoming friend
     requests AND the legacy directional follow arrays — gets stripped so a
     pending "requested to follow" can never surface on a public list. */
  ['outgoingRequests', 'incomingRequests', 'outgoingFollowing', 'incomingFollowers']
    .forEach(key => { if (Array.isArray(profile[key])) profile[key].forEach(drop); });
  return ids;
}

function normalizeProfileSocialUidList(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(uid => String(uid || '').trim()).filter(Boolean))];
}

function addProfileSocialIds(ids, list) {
  normalizeProfileSocialUidList(list).forEach(uid => ids.add(uid));
}

function getProfileUidForSocial(profile = {}) {
  return String(profile?.uid || (profile === userProfile ? currentUser?.uid : '') || '').trim();
}

function getCachedDerivedFollowerIds(profile = {}) {
  const uid = getProfileUidForSocial(profile);
  if (!uid) return [];
  return normalizeProfileSocialUidList(profileFollowerIdsCache[uid]);
}

function addFollowerIdsForProfile(ids, profile = {}, includeOwnLive = false) {
  addProfileSocialIds(ids, profile.acceptedFollowerRequests);
  addProfileSocialIds(ids, profile.followers);
  addProfileSocialIds(ids, profile.followerIds);
  addProfileSocialIds(ids, profile.followedBy);
  addProfileSocialIds(ids, profile.incomingFollowers);
  addProfileSocialIds(ids, getCachedDerivedFollowerIds(profile));
  if (includeOwnLive && typeof ownAcceptedFollowerRequestIds !== 'undefined') {
    addProfileSocialIds(ids, ownAcceptedFollowerRequestIds);
  }
}

function addFollowingIdsForProfile(ids, profile = {}, includeOwnLive = false) {
  addProfileSocialIds(ids, profile.friends);
  addProfileSocialIds(ids, profile.following);
  addProfileSocialIds(ids, profile.followingIds);
  addProfileSocialIds(ids, profile.follows);
  addProfileSocialIds(ids, profile.outgoingFollowing);
  if (includeOwnLive && typeof friends !== 'undefined' && Array.isArray(friends)) {
    addProfileSocialIds(ids, friends);
  }
}

async function hydrateDerivedFollowerIdsForProfile(profile = {}, options = {}) {
  const uid = getProfileUidForSocial(profile);
  if (!uid || !currentUser || typeof db === 'undefined' || !db?.collection) return [];
  if (Array.isArray(profileFollowerIdsCache[uid])) return profileFollowerIdsCache[uid];
  if (profileFollowerIdsPending[uid]) return profileFollowerIdsPending[uid];
  profileFollowerIdsPending[uid] = db.collection('users')
    .where('friends', 'array-contains', uid)
    .limit(200)
    .get()
    .then(snapshot => {
      const ids = [];
      snapshot.forEach(doc => {
        const followerUid = String(doc.id || '').trim();
        if (!followerUid || followerUid === uid) return;
        ids.push(followerUid);
        if (typeof usersMap === 'object' && usersMap) {
          usersMap[followerUid] = { ...(usersMap[followerUid] || {}), ...(doc.data() || {}), uid: followerUid };
        }
      });
      profileFollowerIdsCache[uid] = normalizeProfileSocialUidList(ids);
      return profileFollowerIdsCache[uid];
    })
    .catch(error => {
      console.warn('Derived follower lookup failed:', error);
      profileFollowerIdsCache[uid] = [];
      return [];
    })
    .finally(() => {
      delete profileFollowerIdsPending[uid];
      if (options.refresh !== false) refreshSocialFollowerDisplays(uid);
    });
  return profileFollowerIdsPending[uid];
}

function refreshSocialFollowerDisplays(uid = '') {
  const targetUid = String(uid || '').trim();
  const activeUid = getProfileUidForSocial(getActiveProfile() || {});
  const ownUid = String(currentUser?.uid || '').trim();
  if (!targetUid || targetUid === activeUid) {
    try { renderProfileSocialCounts(); } catch (e) {}
    const modal = document.getElementById('profile-social-modal');
    if (modal) {
      updateProfileSocialTabCounts(modal);
      renderAllProfileSocialPanels(modal);
    }
  }
  if (!targetUid || targetUid === ownUid) {
    const host = document.getElementById('mylist-profile-host');
    if (host) {
      try { renderMyListEditControls(); } catch (e) {}
    }
  }
  if (targetUid && typeof viewingUser === 'object' && viewingUser && String(viewingUser.uid || '') === targetUid) {
    try {
      if (typeof refreshViewingUserSocialCounts === 'function') refreshViewingUserSocialCounts();
    } catch (e) {}
  }
}


function safeProfileUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return 'https://' + url.replace(/^\/+/, '');
}

function renderProfileLinks() {
  const grid = document.getElementById('profile-links-grid');
  if (!grid) return;
  const profile = getActiveProfile();
  const links = normalizeSocialLinks(profile?.socialLinks);
  const editing = !isViewingOtherProfile() && profileEditModeOpen;
  grid.innerHTML = PROFILE_LINK_CONFIG.map(link => {
    const val = links[link.key] || '';
    const href = safeProfileUrl(val);
    const iconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(link.domain)}&sz=64`;
    if (!editing) {
      return `<div class="profile-link-row">
        <div class="profile-link-icon"><img src="${iconUrl}" alt="${escAttr(link.label)}"></div>
        <div class="profile-link-field">
          <label>${escHtml(link.label)}</label>
          <div class="profile-readonly-empty-link">${href ? 'Linked profile' : 'Not linked'}</div>
        </div>
        <a class="profile-external-link ${href ? '' : 'disabled'}" href="${escAttr(href || '#')}" target="_blank" rel="noopener" title="Open ${escAttr(link.label)}">↗</a>
      </div>`;
    }
    return `<div class="profile-link-row">
      <div class="profile-link-icon"><img src="${iconUrl}" alt="${escAttr(link.label)}"></div>
      <div class="profile-link-field">
        <label>${escHtml(link.label)}</label>
        <input type="url" id="profile-link-${link.key}" placeholder="${escAttr(link.placeholder)}" value="${escAttr(val)}" oninput="renderProfileExternalLink('${link.key}')">
      </div>
      <a id="profile-open-${link.key}" class="profile-external-link ${href ? '' : 'disabled'}" href="${escAttr(href || '#')}" target="_blank" rel="noopener" title="Open ${escAttr(link.label)}">↗</a>
    </div>`;
  }).join('');
}

function renderProfileExternalLink(key) {
  const input = document.getElementById('profile-link-' + key);
  const link = document.getElementById('profile-open-' + key);
  if (!input || !link) return;
  const href = safeProfileUrl(input.value);
  link.href = href || '#';
  link.classList.toggle('disabled', !href);
}

function getProfileLinkConfig(key) {
  return PROFILE_MOBILE_LINK_CONFIG.find(link => link.key === key) || null;
}

function getProfileLinkIconUrl(link) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(link.domain)}&sz=64`;
}

function renderProfileMobileLinks() {
  const grid = document.getElementById('profile-mobile-links-grid');
  if (!grid) return;
  const profile = getActiveProfile();
  const links = normalizeSocialLinks(profile?.socialLinks);
  const visibility = normalizeProfileVisibility(profile?.profileVisibility);
  const editing = !isViewingOtherProfile() && profileEditModeOpen;
  const visibleLinks = PROFILE_MOBILE_LINK_CONFIG.map(link => {
    const visible = editing || !link.optionalMobile || visibility[link.visibilityKey] !== false;
    if (!visible) return '';
    const href = safeProfileUrl(links[link.key] || '');
    const emptyClass = href ? '' : 'empty';
    return `<div class="profile-mobile-link-wrap">
      <button type="button" class="profile-mobile-link-badge ${emptyClass}" onclick="handleProfileMobileLinkClick(event, '${escAttr(link.key)}')" aria-label="${escAttr(link.label)} profile link" title="${escAttr(link.label)}">
        <img src="${escAttr(getProfileLinkIconUrl(link))}" alt="${escAttr(link.label)}">
      </button>
    </div>`;
  }).join('');
  const hint = editing ? '<div class="profile-mobile-links-hint">Tap an icon to edit or remove its link.</div>' : '';
  grid.innerHTML = visibleLinks + hint;
}

function handleProfileMobileLinkClick(event, key) {
  event.preventDefault();
  event.stopPropagation();
  const link = getProfileLinkConfig(key);
  if (!link) return;
  const profile = getActiveProfile();
  const href = safeProfileUrl(profile?.socialLinks?.[key] || '');

  if (!isViewingOtherProfile() && profileEditModeOpen) {
    openProfileLinkModal(event, key);
    return;
  }

  if (!href) {
    showToast(`${getViewingProfileName()} has not linked a profile for this yet`);
    return;
  }
  window.open(href, '_blank', 'noopener');
}

function openProfileLinkModal(event, key) {
  event.preventDefault();
  event.stopPropagation();
  if (isViewingOtherProfile()) return;
  const link = getProfileLinkConfig(key);
  if (!link) return;
  if (!userProfile) userProfile = normalizeUserProfile({});
  readProfileDraftFromPage(userProfile);
  userProfile.socialLinks = normalizeSocialLinks(userProfile.socialLinks);
  const current = userProfile.socialLinks[key] || '';
  const visibility = normalizeProfileVisibility(userProfile.profileVisibility);
  const isVisible = !link.optionalMobile || visibility[link.visibilityKey] !== false;

  const existing = document.getElementById('profile-link-edit-modal');
  if (existing) existing.remove();
  const toggleHtml = link.optionalMobile
    ? `<label class="plm-toggle-row"><input type="checkbox" id="plm-visibility" ${isVisible ? 'checked' : ''}> Show on profile</label>`
    : '';

  const modal = document.createElement('div');
  modal.id = 'profile-link-edit-modal';
  modal.className = 'plm-overlay';
  modal.innerHTML = `
    <div class="plm-sheet">
      <div class="plm-header">
        <img class="plm-icon" src="${escAttr(getProfileLinkIconUrl(link))}" alt="${escAttr(link.label)}">
        <span class="plm-title">${escHtml(link.label)}</span>
        <button class="plm-close" onclick="closeProfileLinkModal()">✕</button>
      </div>
      <input type="url" id="plm-url-input" class="plm-input" placeholder="${escAttr(link.placeholder)}" value="${escAttr(current)}">
      ${toggleHtml}
      <div class="plm-actions">
        <button class="plm-save-btn" onclick="saveProfileLinkModal('${escAttr(key)}')">Save</button>
        ${current ? `<button class="plm-remove-btn" onclick="removeProfileLinkModal('${escAttr(key)}')">Remove</button>` : ''}
      </div>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) closeProfileLinkModal(); });
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('plm-open'));
  setTimeout(() => document.getElementById('plm-url-input')?.focus(), 50);
}

function closeProfileLinkModal() {
  const modal = document.getElementById('profile-link-edit-modal');
  if (!modal) return;
  modal.classList.remove('plm-open');
  setTimeout(() => modal.remove(), 230);
}

function saveProfileLinkModal(key) {
  const input = document.getElementById('plm-url-input');
  const visCheck = document.getElementById('plm-visibility');
  const link = getProfileLinkConfig(key);
  if (!input || !link) return;
  if (!userProfile) userProfile = normalizeUserProfile({});
  userProfile.socialLinks[key] = input.value.trim();
  if (visCheck && link.optionalMobile) {
    if (!userProfile.profileVisibility) userProfile.profileVisibility = getDefaultProfileVisibility();
    userProfile.profileVisibility[link.visibilityKey] = visCheck.checked !== false;
  }
  closeProfileLinkModal();
  renderProfileLinks();
  renderProfileMobileLinks();
  showToast(input.value.trim() ? `${link.label} link updated` : `${link.label} link removed`);
  saveProfile({ silent: true, keepEditMode: true }).catch(() => {});
}

function removeProfileLinkModal(key) {
  const link = getProfileLinkConfig(key);
  if (!link) return;
  if (!userProfile) userProfile = normalizeUserProfile({});
  userProfile.socialLinks[key] = '';
  closeProfileLinkModal();
  renderProfileLinks();
  renderProfileMobileLinks();
  showToast(`${link.label} link removed`);
  saveProfile({ silent: true, keepEditMode: true }).catch(() => {});
}

function toggleProfileLinkVisibility(key, checked) {
  if (isViewingOtherProfile()) return;
  if (!userProfile) userProfile = normalizeUserProfile({});
  readProfileDraftFromPage(userProfile);
  if (!userProfile.profileVisibility) userProfile.profileVisibility = getDefaultProfileVisibility();
  userProfile.profileVisibility[key] = checked !== false;
  renderProfileMobileLinks();
}

function toggleProfilePhotoUrl() {
  const row = document.getElementById('profile-url-row');
  if (row) row.style.display = row.style.display === 'block' ? 'none' : 'block';
}

function getProfileFallbackPhoto() {
  return getProfileFallbackPhotoFor(getActiveProfile());
}


function syncProfileEditModeControls() {
  const page = document.getElementById('profile-page');
  if (!page || isViewingOtherProfile()) return;
  page.classList.toggle('profile-edit-mode', !!profileEditModeOpen);
  const controls = document.querySelectorAll('.profile-stat-toggle, .profile-row-toggle, .profile-mobile-link-toggle, .plm-toggle-row');
  controls.forEach(control => {
    if (!control) return;
    if (profileEditModeOpen) {
      control.hidden = false;
      control.style.visibility = 'visible';
      control.style.opacity = '1';
    } else {
      control.style.removeProperty('visibility');
      control.style.removeProperty('opacity');
    }
  });
  document.querySelectorAll('.profile-section-toggle-input').forEach(input => {
    if (!input) return;
    input.hidden = false;
    if (profileEditModeOpen) {
      input.style.visibility = 'visible';
      input.style.opacity = '1';
    } else {
      input.style.removeProperty('visibility');
      input.style.removeProperty('opacity');
    }
  });
}

function renderProfilePage() {
  if (!userProfile) userProfile = normalizeUserProfile({});
  const profile = getActiveProfile();
  const viewingOther = isViewingOtherProfile();
  const profilePage = document.getElementById('profile-page');
  const settingsPage = document.getElementById('profile-settings-page');
  const titleEl = document.querySelector('.profile-topbar-title');
  const subEl = document.querySelector('.profile-topbar-sub');
  const saveBtn = document.querySelector('.profile-save-btn');
  const viewListsBtn = document.getElementById('profile-card-lists-btn');
  const avatarActions = document.querySelector('.profile-avatar-actions');
  const nameInput = document.getElementById('profile-name');
  const photoInput = document.getElementById('profile-photo');
  const bioInput = document.getElementById('profile-bio');
  const fileInput = document.getElementById('profile-file');
  const urlRow = document.getElementById('profile-url-row');
  const preview = document.getElementById('profile-preview');
  const creatorBadge = document.getElementById('profile-creator-badge');
  let heroLogoutBtn = document.getElementById('profile-card-logout-btn');
  if (heroLogoutBtn) heroLogoutBtn.remove();
  const creativeTeamProfile = isCreativeTeamUser(profile);
  if (profilePage) {
    profilePage.classList.toggle('viewing-other-profile', viewingOther);
    profilePage.classList.toggle('own-profile-view', !viewingOther && !!currentUser);
    profilePage.classList.toggle('landing-public-profile', landingPublicProfileActive && !currentUser);
    profilePage.classList.toggle('own-creator-profile', !viewingOther && isCreatorAdmin(profile));
    profilePage.classList.toggle('creative-team-profile', creativeTeamProfile);
    profilePage.classList.toggle('settings-open', profileSettingsOpen && !viewingOther);
    profilePage.classList.toggle('profile-edit-mode', !viewingOther && profileEditModeOpen);
  }
  document.body.classList.toggle('own-profile-active', !!document.body.classList.contains('profile-active') && !viewingOther && !!currentUser);
  if (settingsPage) settingsPage.style.display = profileSettingsOpen && !viewingOther ? 'block' : 'none';
  /* v10.975: when viewing another user's profile, the topbar title shows
     their @username (centered between back / 3-dots / share) instead of
     "{Name}'s Profile". Falls back to "{Name}'s Profile" if the viewing
     profile has no username field (preserves the prior look so legacy
     data never renders an empty header). */
  if (titleEl) {
    if (viewingOther) {
      const viewingHandle = String(
        profile?.usernameHandle
        || profile?.userHandle
        || profile?.username
        || ''
      ).trim();
      /* v10.976: drop the leading "@" — username only. */
      titleEl.textContent = viewingHandle
        ? viewingHandle
        : `${getViewingProfileName()}'s Profile`;
    } else {
      titleEl.textContent = 'Profile Studio';
    }
  }
  if (subEl) subEl.textContent = viewingOther ? 'Stats, favorites, linked profiles, and personal showcase' : 'Customize your ScreenList home page';
  if (saveBtn) {
    saveBtn.style.display = viewingOther ? 'none' : '';
    saveBtn.textContent = profileEditModeOpen ? 'Save Profile' : 'Edit Profile';
    saveBtn.onclick = profileEditModeOpen ? () => saveProfile() : () => openProfileEditMode();
  }
  if (viewListsBtn) {
    viewListsBtn.textContent = viewingOther ? 'View Lists' : 'My Lists';
    viewListsBtn.style.display = (profileSettingsOpen && !viewingOther) ? 'none' : '';
  }
  if (heroLogoutBtn) heroLogoutBtn.style.display = viewingOther || isPreviewMode() ? 'none' : '';
  if (avatarActions) avatarActions.style.display = viewingOther ? 'none' : '';
  if (nameInput) {
    nameInput.value = profile.name || '';
    nameInput.readOnly = viewingOther || !profileEditModeOpen;
    nameInput.setAttribute('aria-label', viewingOther ? 'Profile name' : 'Nickname');
    nameInput.classList.toggle('creator-name-input', isCreatorAdmin(profile));
    nameInput.classList.toggle('creative-team-name-input', creativeTeamProfile);
  }
  let profileInlineShelfStats = document.getElementById('profile-inline-shelf-stats');
  if (!profileInlineShelfStats && nameInput && nameInput.parentElement) {
    nameInput.insertAdjacentHTML('afterend', '<div id="profile-inline-shelf-stats" class="profile-inline-shelf-stats" aria-label="Shelf summary"></div>');
    profileInlineShelfStats = document.getElementById('profile-inline-shelf-stats');
  }
  if (profileInlineShelfStats) {
    if (viewingOther) {
      profileInlineShelfStats.innerHTML = renderShelfSummaryInlineInnerHTML(profileViewingData || getEmptyListData(), 'profile-inline-shelf-stat-dot');
      profileInlineShelfStats.style.display = 'inline-flex';
    } else {
      profileInlineShelfStats.innerHTML = '';
      profileInlineShelfStats.style.display = 'none';
    }
  }
  let blockedNotice = document.getElementById('profile-blocked-user-notice');
  if (!blockedNotice && profileInlineShelfStats && profileInlineShelfStats.parentElement) {
    profileInlineShelfStats.insertAdjacentHTML('afterend', '<div id="profile-blocked-user-notice" class="blocked-user-notice" style="display:none;">You blocked this user.</div>');
    blockedNotice = document.getElementById('profile-blocked-user-notice');
  }
  const viewingBlockedUser = viewingOther && isShelfdUserBlocked(profileViewingUser?.uid);
  if (blockedNotice) blockedNotice.style.display = viewingBlockedUser ? 'block' : 'none';
  const profileBlockBtn = document.querySelector('#profile-more-menu .is-destructive, #profile-more-menu [data-profile-block-action]');
  if (profileBlockBtn) {
    profileBlockBtn.dataset.profileBlockAction = 'true';
    profileBlockBtn.textContent = viewingBlockedUser ? 'Unblock user' : 'Block user';
    profileBlockBtn.classList.toggle('is-destructive', !viewingBlockedUser);
  }
  syncProfileAdminUsernameAction(viewingOther);
  if (creatorBadge) {
    if (isCreatorAdmin(profile)) {
      creatorBadge.innerHTML = '<span><svg class="creator-crown-icon" viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true" style="vertical-align:-0.12em;margin-right:0.28em;"><path d="M3.2 7.4c-.65-.4-1.45.24-1.2.97l2.7 7.95c.18.54.69.9 1.26.9h12.08c.57 0 1.08-.36 1.26-.9l2.7-7.95c.25-.73-.55-1.37-1.2-.97l-4.3 2.65c-.55.34-1.27.16-1.6-.4L12.86 5.1a1 1 0 0 0-1.72 0L8.1 9.65c-.33.56-1.05.74-1.6.4L3.2 7.4Zm2.6 11.1c0 .55.45 1 1 1h10.4c.55 0 1-.45 1-1v-.5H5.8v.5Z"/></svg>Admin Account</span><span class="creator-role">(Developer And Creator)</span>';
      creatorBadge.style.display = 'inline-flex';
    } else if (creativeTeamProfile) {
      creatorBadge.innerHTML = '<span class="creative-team-profile-label">Creative Team</span>';
      creatorBadge.style.display = 'inline-flex';
    } else {
      creatorBadge.innerHTML = '';
      creatorBadge.style.display = 'none';
    }
  }
  if (photoInput) photoInput.value = profile.photo || '';
  /* v10.899: render the viewing user's @username directly beneath their
     profile picture (only when viewing someone else's profile). Hidden
     on own-profile so we don't duplicate the username card already in
     profile settings. Lookup priority matches the rest of the codebase:
     usernameHandle → userHandle → username. */
  const handleEl = document.getElementById('profile-page-handle');
  if (handleEl) {
    const handle = String(
      profile?.usernameHandle
      || profile?.userHandle
      || profile?.username
      || ''
    ).trim();
    if (viewingOther && handle) {
      handleEl.textContent = '@' + handle;
      handleEl.hidden = false;
    } else {
      handleEl.textContent = '';
      handleEl.hidden = true;
    }
  }
  if (bioInput) {
    bioInput.value = profile.bio || (viewingOther ? 'No bio yet.' : '');
    bioInput.readOnly = viewingOther || !profileEditModeOpen;
  }
  if (fileInput) fileInput.value = '';
  if (urlRow) urlRow.style.display = 'none';
  if (preview) preview.src = profile.photo || getProfileFallbackPhotoFor(profile);
  renderProfileSocialCounts();
  renderProfileStats();
  renderProfileFavorites();
  renderProfileLinks();
  renderProfileMobileLinks();
  renderProfileSettingsPage();
  syncProfileEditModeControls();
}


function readProfileRatingPreferencesFromPage() {
  if (isViewingOtherProfile()) return normalizeRatingPreferences(getActiveProfile()?.ratingPreferences);
  return normalizeRatingPreferences({
    media: document.getElementById('rating-pref-media-five')?.checked ? 'five' : 'ten',
    games: document.getElementById('rating-pref-games-five')?.checked ? 'five' : 'ten'
  });
}

function readThemeModeFromPage() {
  if (isViewingOtherProfile()) return resolveActiveThemeMode(userProfile?.themeMode);
  /* v812: only Default Theme is selectable. Whatever the page state is,
     the active theme is always 'default' under Step 1 force. */
  return getDefaultThemeMode();
}

function readAnimeTitleDisplayModeFromPage() {
  if (isViewingOtherProfile()) return getAnimeTitleDisplayMode(userProfile || {});
  if (document.getElementById('anime-title-pref-romaji')?.checked) return 'romaji';
  if (document.getElementById('anime-title-pref-japanese')?.checked) return 'japanese';
  return 'english';
}

async function saveProfileSettingsPatch(patch = {}) {
  // v429/v945 hardening: when a provider-only patch is being saved, scrub
  // root-level Shelfd identity fields out of the patch even if a caller accidentally
  // passes them. Shelfd profile name/photo/bio/customName/customPhoto must never be
  // overwritten as a side-effect of Steam or Tracker connect/sync.
  let safePatch = { ...(patch && typeof patch === 'object' ? patch : {}) };
  const providerPatchKeys = new Set(['steamConnection', 'xboxConnection', 'trackerConnection', 'appleMusicConnection', 'appleMusicMetadataSummary']);
  const looksProviderOnly = Object.keys(safePatch).every(k => providerPatchKeys.has(k));
  if (looksProviderOnly) {
    delete safePatch.name;
    delete safePatch.nameLower;
    delete safePatch.photo;
    delete safePatch.customName;
    delete safePatch.customPhoto;
    delete safePatch.bio;
    delete safePatch.profileBio;
    delete safePatch.displayName;
  }

  if (!userProfile) userProfile = normalizeUserProfile({});
  Object.assign(userProfile, safePatch);

  if (isPreviewMode() || !currentUser) return true;

  try {
    await db.collection("users").doc(currentUser.uid).set({
      ...safePatch,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    usersMap[currentUser.uid] = {
      ...(usersMap[currentUser.uid] || {}),
      uid: currentUser.uid,
      ...safePatch
    };
    return true;
  } catch (e) {
    console.error("Settings auto-save failed:", e);
    showToast("Setting changed locally, but sync failed");
    return false;
  }
}

async function handleThemeModeChange(mode) {
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
  if (isViewingOtherProfile()) return;
  /* v812/v813: applyThemeMode runs the value through resolveActiveThemeMode,
     so any legacy-handler call (e.g. a stale onclick still bound to
     'light' / 'cream' / 'default') gets coerced to 'true-dark'. */
  const normalized = applyThemeMode(mode, true);
  await saveProfileSettingsPatch({ themeMode: normalized });
  const themeDefault  = document.getElementById('theme-mode-default');
  const themeLight    = document.getElementById('theme-mode-light');
  const themeTrueDark = document.getElementById('theme-mode-true-dark');
  const themeCream    = document.getElementById('theme-mode-cream');
  if (themeDefault)  themeDefault.checked  = normalized === 'true-dark';
  if (themeLight)    themeLight.checked    = false;
  if (themeTrueDark) themeTrueDark.checked = false;
  if (themeCream)    themeCream.checked    = false;
  document.body.getBoundingClientRect();
}

async function handleAnimeTitlePreferenceChange(mode) {
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
  if (isViewingOtherProfile()) return;
  const normalized = normalizeAnimeTitleDisplayMode(mode);
  const english = document.getElementById('anime-title-pref-english');
  const romaji = document.getElementById('anime-title-pref-romaji');
  const japanese = document.getElementById('anime-title-pref-japanese');
  if (english) english.checked = normalized === 'english';
  if (romaji) romaji.checked = normalized === 'romaji';
  if (japanese) japanese.checked = normalized === 'japanese';
  await saveProfileSettingsPatch({ animeTitleDisplayMode: normalized });
  render();
}

async function handleRatingPreferenceChange(scope, mode) {
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
  if (isViewingOtherProfile()) return;
  const normalizedScope = scope === 'games' ? 'games' : 'media';
  const normalizedMode = mode === 'five' ? 'five' : 'ten';
  const nextPreferences = normalizeRatingPreferences({
    ...(userProfile?.ratingPreferences || getDefaultRatingPreferences()),
    [normalizedScope]: normalizedMode
  });

  const mediaTen = document.getElementById('rating-pref-media-ten');
  const mediaFive = document.getElementById('rating-pref-media-five');
  const gamesTen = document.getElementById('rating-pref-games-ten');
  const gamesFive = document.getElementById('rating-pref-games-five');
  if (mediaTen) mediaTen.checked = nextPreferences.media !== 'five';
  if (mediaFive) mediaFive.checked = nextPreferences.media === 'five';
  if (gamesTen) gamesTen.checked = nextPreferences.games !== 'five';
  if (gamesFive) gamesFive.checked = nextPreferences.games === 'five';

  await saveProfileSettingsPatch({ ratingPreferences: nextPreferences });
  render();
}

function readProfileFromPage() {
  if (isViewingOtherProfile()) return getActiveProfile();
  const next = normalizeUserProfile(userProfile || {});
  next.name = (document.getElementById('profile-name')?.value || '').trim() || next.name || 'ScreenList User';
  next.photo = (document.getElementById('profile-photo')?.value || '').trim();
  next.bio = (document.getElementById('profile-bio')?.value || '').trim();
  next.themeMode = readThemeModeFromPage();
  next.ratingPreferences = readProfileRatingPreferencesFromPage();
  next.animeTitleDisplayMode = readAnimeTitleDisplayModeFromPage();
  next.socialLinks = normalizeSocialLinks(next.socialLinks || userProfile?.socialLinks || {});
  PROFILE_MOBILE_LINK_CONFIG.forEach(link => {
    const input = document.getElementById('profile-link-' + link.key);
    if (input) next.socialLinks[link.key] = (input.value || '').trim();
  });
  readProfileDraftFromPage(next);
  return next;
}

// Save user profile to Firestore
async function saveUserProfile(user) {
  try {
    if (!user?.uid) return;
    const liveAuthUid = (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser?.uid) || '';
    if (liveAuthUid && liveAuthUid !== user.uid) {
      console.warn('[shelfd-auth] blocked profile save for stale auth user', {
        requestedUid: user.uid,
        liveAuthUid
      });
      return;
    }
    if (userProfile?.uid && userProfile.uid !== user.uid) {
      console.warn('[shelfd-auth] clearing stale profile before saveUserProfile', {
        staleProfileUid: userProfile.uid,
        authUid: user.uid
      });
      userProfile = null;
    }
    const accountEmailLower = normalizeEmail(user?.email);
    const creatorAccount = String(user?.uid || '').trim() === CREATOR_PUBLIC_UID || accountEmailLower === CREATOR_ADMIN_EMAIL;
    const existing = await db.collection("users").doc(user.uid).get();
    const existingData = existing.exists ? existing.data() : {};
    const isNewUser = !existing.exists;
    const baseProfile = existingData.customName ? {
      ...existingData,
      name: existingData.customName,
      photo: existingData.customPhoto || existingData.photo || '',
      uid: user.uid,
      emailLower: accountEmailLower
    } : {
      ...existingData,
      name: creatorAccount ? CREATOR_DEFAULT_NAME : (user.displayName || 'Anonymous'),
      photo: user.photoURL || existingData.photo || '',
      uid: user.uid,
      emailLower: accountEmailLower
    };
    userProfile = normalizeUserProfile(baseProfile);
    if (creatorAccount) userProfile.name = CREATOR_DEFAULT_NAME;
    /* v10.552: seed the global blocked-users set so the activity feed
       and DM list can filter instantly without extra Firestore reads. */
    window.shelfdBlockedUids = new Set(Array.isArray(userProfile.blockedUids) ? userProfile.blockedUids : []);
    /* v10.577: any successful sign-in = terms already agreed (Google/Apple/returning users) */
    try { localStorage.setItem('shelfd_terms_agreed', '1'); } catch(_) {}
    if (isNewUser) {
      try {
        await db.collection("meta").doc("userCount").set({
          count: firebase.firestore.FieldValue.increment(1)
        }, { merge: true });
      } catch(e) { console.error("Counter increment failed:", e); }
    }
    await db.collection("users").doc(user.uid).set({
      name: userProfile.name,
      nameLower: (userProfile.name || '').trim().toLowerCase(),
      photo: userProfile.photo,
      customName: userProfile.name,
      customPhoto: userProfile.photo,
      bio: userProfile.bio || '',
      profileBio: userProfile.bio || '',
      themeMode: userProfile.themeMode || getDefaultThemeMode(),
      ratingPreferences: userProfile.ratingPreferences || getDefaultRatingPreferences(),
      animeTitleDisplayMode: userProfile.animeTitleDisplayMode || getDefaultAnimeTitleDisplayMode(),
      socialLinks: userProfile.socialLinks || getDefaultSocialLinks(),
      pinnedFavorites: userProfile.pinnedFavorites || getDefaultPinnedFavorites(),
      profileVisibility: userProfile.profileVisibility || getDefaultProfileVisibility(),
      listTabVisibility: userProfile.listTabVisibility || getDefaultListTabVisibility(),
      notificationPreferences: normalizeNotificationPreferences(userProfile.notificationPreferences),
      showcaseFavorites: userProfile.showcaseFavorites || getDefaultShowcaseFavorites(),
      emailLower: accountEmailLower,
      accountEmailLower: accountEmailLower,
      isCreatorAdmin: creatorAccount,
      /* v924: was `isPublic: creatorAccount` which set isPublic:false for
         every non-creator user on every login. The friend-search filter
         skips anyone with isPublic===false, making ALL regular users
         invisible to search. Set true for everyone — actual profile
         privacy is controlled via profileVisibility settings. */
      isPublic: true,
      uid: user.uid,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    usersMap[user.uid] = {
      uid: user.uid,
      name: userProfile.name,
      photo: userProfile.photo,
      bio: userProfile.bio || '',
      themeMode: userProfile.themeMode || getDefaultThemeMode(),
      ratingPreferences: userProfile.ratingPreferences || getDefaultRatingPreferences(),
      animeTitleDisplayMode: userProfile.animeTitleDisplayMode || getDefaultAnimeTitleDisplayMode(),
      socialLinks: userProfile.socialLinks || getDefaultSocialLinks(),
      pinnedFavorites: userProfile.pinnedFavorites || getDefaultPinnedFavorites(),
      profileVisibility: userProfile.profileVisibility || getDefaultProfileVisibility(),
      listTabVisibility: userProfile.listTabVisibility || getDefaultListTabVisibility(),
      notificationPreferences: normalizeNotificationPreferences(userProfile.notificationPreferences),
      showcaseFavorites: userProfile.showcaseFavorites || getDefaultShowcaseFavorites(),
      emailLower: accountEmailLower,
      accountEmailLower: accountEmailLower,
      isCreatorAdmin: creatorAccount,
      isPublic: true
    };
    await syncCreatorPublicProfileMirror(user, userProfile, creatorAccount ? data : null);
    applyThemeMode(userProfile.themeMode || getDefaultThemeMode(), true);
    applyProfile();
  } catch(e) {
    console.error("Profile save failed:", e);
    if (user?.uid && (!userProfile || userProfile.uid !== user.uid)) {
      userProfile = normalizeUserProfile({
        uid: user.uid,
        name: user.displayName || 'Anonymous',
        photo: user.photoURL || '',
        emailLower: normalizeEmail(user.email),
        accountEmailLower: normalizeEmail(user.email)
      });
    }
  }
}

function applyProfile() {
  if (!userProfile) return;
  const avatar = document.getElementById("user-avatar");
  if (!avatar) return;
  avatar.src = userProfile.photo || getProfileFallbackPhoto();
  avatar.alt = userProfile.name || 'Profile';
  avatar.style.display = "block";
}

function buildPreviewProfileForUser(user) {
  const list = cloneListData(user?.listData || getEmptyListData());
  const firstEntry = section => (list[section] || []).filter(Boolean).slice(0, 3).map(item => normalizeDatabaseFavoriteEntry({
    id: item.tmdbId || item.rawgId || item.id || '',
    source: section === 'music' ? 'library' : (section === 'games' ? 'rawg' : 'tmdb'),
    type: section === 'music' ? 'music' : (section === 'games' ? 'game' : section === 'movies' ? 'movie' : 'tv'),
    title: item.title || '',
    image: item.cover || '',
    rating: getProfileItemRating(item),
    meta: item.genre || item.status || ''
  }));
  const fill = arr => [0, 1, 2].map(i => arr[i] || getEmptyDatabaseFavorite());
  return normalizeUserProfile({
    uid: user?.uid || 'preview-friend',
    name: user?.name || 'Preview User',
    photo: user?.photo || '',
    bio: user?.findStats || user?.stats || 'Preview community profile.',
    pinnedFavorites: {
      movies: fill(firstEntry('movies')),
      shows: fill(firstEntry('shows')),
      music: fill(firstEntry('music')),
      anime: fill(firstEntry('anime')),
      games: fill(firstEntry('games')),
      singlePlayerGames: fill(firstEntry('games')),
      actors: [0,1,2].map(() => getEmptyDatabaseFavorite()),
      directors: [0,1,2].map(() => getEmptyDatabaseFavorite())
    },
    profileVisibility: getDefaultProfileVisibility(),
    socialLinks: getDefaultSocialLinks(),
    showcaseFavorites: getDefaultShowcaseFavorites()
  });
}

function openPreviewUserProfile(uid) {
  const user = getPreviewCommunityUser(uid);
  if (!user) {
    showToast('Preview profile unavailable');
    return;
  }
  profileReturnState = buildProfileReturnState();
  profileReturnTab = profileReturnState?.tab || 'community';
  profileViewingUser = { uid: user.uid, name: user.name, photo: user.photo, preview: true };
  profileViewingProfile = buildPreviewProfileForUser(user);
  profileViewingData = cloneListData(user.listData || getEmptyListData());
  openProfilePageShell();
}

async function loadPublicProfileListData(uid, options = {}) {
  try {
    /* v10.387: section-aware fan-out replaces the legacy single-doc read.
       Reads shows/movies/anime/games/manga/books (music excluded to match
       prior behavior). */
    const listData = await loadWatchlistDataForUid(uid, {
      sections: ['shows', 'movies', 'music', 'anime', 'games', 'manga', 'books']
    });
    return await autoSortAnimeBuckets(normalizeListData(listData), false);
  } catch(e) {
    if (!options.suppressError) console.error('Failed to load profile list data:', e);
    return getEmptyListData();
  }
}

async function canViewUserProfile(uid) {
  if (!uid) return false;
  if (!currentUser && uid === CREATOR_PUBLIC_UID) return true;
  if (!currentUser) return false;
  if (uid === currentUser.uid) return true;
  /* v11344: profiles are public to every signed-in user — the private-profile
     gate (mutual-friends requirement) has been removed. We still fetch the
     user doc to warm usersMap and confirm the account exists. */
  try {
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) return false;
    const u = userDoc.data() || {};
    usersMap[uid] = { ...u, uid: u.uid || uid };
    return true;
  } catch(e) {
    console.error('Profile load check failed:', e);
    return false;
  }
}

function parseScreenListProfileRoute(urlLike = window.location) {
  try {
    const url = new URL(urlLike?.href || urlLike || window.location.href, window.location.origin);
    const pathMatch = url.pathname.match(/^\/profile-card\/([^/?#]+)\/([^/?#]+)\/([1-3])/i);
    const profilePathMatch = url.pathname.match(/^\/profile\/([^/?#]+)/i);
    const uid = pathMatch
      ? decodeURIComponent(pathMatch[1] || '')
      : profilePathMatch
        ? decodeURIComponent(profilePathMatch[1] || '')
        : (url.searchParams.get('profile') || '');
    if (!uid) return null;
    const section = pathMatch ? decodeURIComponent(pathMatch[2] || '') : (url.searchParams.get('top3') || '');
    const rankRaw = pathMatch ? pathMatch[3] : (url.searchParams.get('rank') || '1');
    const index = Math.max(0, Math.min(2, Number(rankRaw || 1) - 1));
    return {
      uid: String(uid || '').trim(),
      section: String(section || '').trim(),
      index: Number.isFinite(index) ? index : 0
    };
  } catch (error) {
    return null;
  }
}

function prepareSignedOutProfileRouteView() {
  landingPublicProfileActive = true;
  document.body.classList.remove('preview-mode');
  const login = document.getElementById('login-screen');
  const app = document.getElementById('app-container');
  if (login) login.style.display = 'none';
  if (app) app.style.display = 'block';
  setBottomNavVisibility(false);
  setMainNavVisibility('mylist');
}

function queueProfileFavoriteFocus(section, index) {
  if (!section) return;
  profileSharedFavoriteFocus = {
    section: String(section || '').trim(),
    index: Math.max(0, Math.min(2, Number(index || 0)))
  };
}

function focusProfileSharedFavoriteIfNeeded(attempt = 0) {
  const focus = profileSharedFavoriteFocus;
  if (!focus?.section) return;
  const safeSection = window.CSS?.escape ? CSS.escape(focus.section) : focus.section.replace(/"/g, '\\"');
  const selector = `.profile-fav-poster-card[data-profile-share-section="${safeSection}"][data-profile-share-index="${focus.index}"]`;
  const target = document.querySelector(selector);
  if (!target) {
    if (attempt < 8) setTimeout(() => focusProfileSharedFavoriteIfNeeded(attempt + 1), 90);
    return;
  }
  profileSharedFavoriteFocus = null;
  target.classList.add('profile-fav-shared-focus');
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => target.classList.remove('profile-fav-shared-focus'), 2800);
}

async function openProfileRouteDirect(route = parseScreenListProfileRoute()) {
  if (!route?.uid || profileSharedFavoriteOpening) return false;
  profileSharedFavoriteOpening = true;
  try {
    queueProfileFavoriteFocus(route.section, route.index);
    if (currentUser && route.uid === currentUser.uid) {
      openProfile();
      requestAnimationFrame(() => focusProfileSharedFavoriteIfNeeded());
      return true;
    }
    if (!currentUser) prepareSignedOutProfileRouteView();
    profileReturnState = currentUser ? buildProfileReturnState() : { kind: 'main', tab: 'landing' };
    profileReturnTab = profileReturnState?.tab || 'landing';
    const profileDoc = await db.collection('users').doc(route.uid).get();
    if (!profileDoc.exists) throw new Error('Profile not found');
    const raw = { ...(profileDoc.data() || {}), uid: route.uid };
    usersMap[route.uid] = raw;
    profileViewingUser = { uid: route.uid, name: raw.name || 'Friend', photo: raw.photo || '' };
    profileViewingProfile = normalizeUserProfile({ ...raw, uid: route.uid, name: raw.name || 'Friend', photo: raw.photo || '' });
    profileViewingData = await loadPublicProfileListData(route.uid, { suppressError: true });
    openProfilePageShell();
    requestAnimationFrame(() => focusProfileSharedFavoriteIfNeeded());
    return true;
  } catch (error) {
    console.error('Profile card route failed:', error);
    showToast('Could not load that profile');
    if (!currentUser) showLandingPage();
    return false;
  } finally {
    profileSharedFavoriteOpening = false;
  }
}

async function openUserProfile(uid, name = '', photo = '') {
  if (isPreviewMode()) {
    openPreviewUserProfile(uid);
    return;
  }
  if (currentUser && uid === currentUser.uid) {
    openProfile();
    return;
  }
  const allowed = await canViewUserProfile(uid);
  if (!allowed) {
    showPrivateModal();
    return;
  }
  profileReturnState = buildProfileReturnState();
  profileReturnTab = profileReturnState?.tab || 'community';
  let profileDoc = null;
  try {
    profileDoc = await db.collection('users').doc(uid).get();
  } catch(e) {
    console.error('Failed to load profile:', e);
  }
  if (!profileDoc || !profileDoc.exists) {
    showToast('Could not load that profile');
    return;
  }
  const raw = { ...(profileDoc.data() || {}), uid };
  usersMap[uid] = raw;
  profileViewingUser = { uid, name: raw.name || name || 'Friend', photo: raw.photo || photo || '' };
  profileViewingProfile = normalizeUserProfile({ ...raw, uid, name: raw.name || name || 'Friend', photo: raw.photo || photo || '' });
  profileViewingData = (viewingUser?.uid === uid && friendViewData) ? cloneListData(friendViewData) : await loadPublicProfileListData(uid);
  openProfilePageShell();
}

function openProfilePageShell() {
  const commentsPage = document.getElementById('comments-page');
  const activityPage = document.getElementById('activity-page');
  profileSettingsOpen = false;
  profileEditModeOpen = false;
  captureProfileFriendShelfReturnTop();
  document.body.classList.add('profile-active');
  if (commentsPage) commentsPage.style.display = 'none';
  if (activityPage) activityPage.classList.remove('active');
  syncActivityPageQuickActions();
  setBottomNavVisibility(false);
  renderProfilePage();
  const profilePage = document.getElementById('profile-page');
  if (profilePage) {
    /* v706: slide-from-right enter animation — remove any leftover state
       before making it visible, then add the open class on the next two
       animation frames so the CSS keyframe fires cleanly. */
    profilePage.classList.remove('profile-page-open', 'profile-page-closing');
    profilePage.style.display = 'block';
    profilePage.scrollTo({ top: 0, behavior: 'auto' });
    bindProfilePageSwipeBack(profilePage);
    requestAnimationFrame(() => requestAnimationFrame(() => profilePage.classList.add('profile-page-open')));
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
  requestAnimationFrame(() => focusProfileSharedFavoriteIfNeeded());
}

function captureProfileFriendShelfReturnTop() {
  profileFriendShelfReturnTopPx = 0;
  if (!viewingUser?.uid) return;
  try {
    const headerEl = document.querySelector('.header');
    const bottom = headerEl ? Math.round(headerEl.getBoundingClientRect().bottom) : 0;
    profileFriendShelfReturnTopPx = Math.max(0, bottom || 0);
  } catch (_) {
    profileFriendShelfReturnTopPx = 0;
  }
}

function isReturningToFriendShelfFromProfile() {
  return !!((profileReturnState?.kind === 'friend-home' && profileReturnState?.user?.uid) || viewingUser?.uid);
}

function prepareProfileFriendShelfUnderlay() {
  if (!isReturningToFriendShelfFromProfile()) return false;
  const myListView = document.getElementById('mylist-view');
  if (!myListView) return false;
  const top = Math.max(0, Math.round(profileFriendShelfReturnTopPx || 0));
  myListView.dataset.profileBackShelfUnderlay = 'true';
  myListView.style.display = 'block';
  myListView.style.position = 'fixed';
  myListView.style.top = `${top}px`;
  myListView.style.left = '0';
  myListView.style.right = '0';
  myListView.style.bottom = '0';
  myListView.style.zIndex = '1';
  myListView.style.overflowY = 'hidden';
  myListView.style.background = '#0E0E0E';
  myListView.style.transform = 'translate3d(0, 0, 0)';
  myListView.style.pointerEvents = 'none';
  myListView.style.willChange = 'auto';
  document.body.classList.add('profile-friend-shelf-underlay-active');
  return true;
}

function clearProfileFriendShelfUnderlay() {
  const myListView = document.getElementById('mylist-view');
  if (myListView?.dataset?.profileBackShelfUnderlay === 'true') {
    delete myListView.dataset.profileBackShelfUnderlay;
    [
      'position',
      'top',
      'left',
      'right',
      'bottom',
      'zIndex',
      'overflowY',
      'background',
      'transform',
      'pointerEvents',
      'willChange'
    ].forEach(prop => { myListView.style[prop] = ''; });
  }
  document.body.classList.remove('profile-friend-shelf-underlay-active');
}

function finalizeProfilePageClosed() {
  const profilePage = document.getElementById('profile-page');
  if (profilePage) {
    profilePage.classList.remove(
      'profile-page-open',
      'profile-page-closing',
      'profile-swipe-back-dragging',
      'profile-swipe-back-snapping'
    );
    profilePage.style.display = 'none';
    [
      'transition',
      'transform',
      'willChange',
      'boxShadow',
      'borderTopLeftRadius',
      'borderBottomLeftRadius',
      'touchAction',
      'animation'
    ].forEach(prop => { profilePage.style[prop] = ''; });
  }
  clearProfileFriendShelfUnderlay();
  document.body.classList.remove('profile-swipe-back-active', 'profile-back-closing-active');
}

function restoreFriendShelfAfterProfileClose(returnState = null) {
  const target = returnState?.user || null;
  if (!target?.uid) return false;
  if (!viewingUser || viewingUser.uid !== target.uid || !friendViewData) return false;

  const myListView = document.getElementById('mylist-view');
  if (myListView) {
    delete myListView.dataset.profileBackShelfUnderlay;
    myListView.style.display = 'block';
    [
      'transition',
      'transform',
      'position',
      'inset',
      'top',
      'left',
      'right',
      'bottom',
      'zIndex',
      'background',
      'overflowY',
      'overflow',
      'boxShadow',
      'willChange',
      'contain',
      'backfaceVisibility',
      'pointerEvents',
      'touchAction',
      'animation'
    ].forEach(prop => { myListView.style[prop] = ''; });
  }

  document.body.classList.add('viewing-other-user');
  document.body.classList.remove('profile-friend-shelf-underlay-active');
  if (typeof syncViewingUserHeaderBackButton === 'function') syncViewingUserHeaderBackButton(true);
  if (typeof window.updateMainHeaderPageTitle === 'function') {
    try { window.updateMainHeaderPageTitle(); } catch (e) { /* non-fatal */ }
  }
  if (typeof setBottomNavVisibility === 'function') setBottomNavVisibility(true);
  if (typeof render === 'function') render();
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (typeof persistUiState === 'function') persistUiState();
  return true;
}

function openProfile() {
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
  profileViewingUser = null;
  profileViewingProfile = null;
  profileViewingData = null;
  profileSettingsOpen = false;
  profileEditModeOpen = false;
  if (!userProfile) userProfile = normalizeUserProfile({});
  profileReturnState = { kind: 'main', tab: getActiveMainTab ? getActiveMainTab() : 'mylist' };
  profileReturnTab = getActiveMainTab ? getActiveMainTab() : 'mylist';
  openProfilePageShell();
}

function openProfileEditMode() {
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
  if (isViewingOtherProfile()) return;
  profileEditModeOpen = true;
  const profilePage = document.getElementById('profile-page');
  if (profilePage) profilePage.classList.add('profile-edit-mode');
  renderProfilePage();
  requestAnimationFrame(syncProfileEditModeControls);
  const linksCard = document.querySelector('.profile-links-card');
  const nameInput = document.getElementById('profile-name');
  const target = linksCard || nameInput || document.querySelector('.profile-hero-card');
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => {
    const firstLinkInput = document.querySelector('#profile-links-grid input');
    (firstLinkInput || nameInput)?.focus?.();
  }, 260);
}

function openProfileSettingsFocus() {
  if (typeof requireShelfdSignedInAction === 'function' && !requireShelfdSignedInAction()) return;
  /* v10.766: SELF-HEAL stale "viewing other profile" state.
     The cogwheel button is CSS-hidden on someone else's profile
     (.viewing-other-profile .profile-settings-btn { display: none }),
     so if the user managed to click it, we know we should be on OUR
     OWN profile. If profileViewingUser is set anyway, that's a stale
     state from a previous navigation — clear it so the settings page
     opens correctly instead of silently returning. Reports of "cogwheel
     does nothing" stem from exactly this state mismatch. */
  if (isViewingOtherProfile()) {
    profileViewingUser = null;
    profileViewingProfile = null;
    profileViewingData = null;
    if (document.body) {
      document.body.classList.remove('viewing-other-user', 'viewing-other-profile');
    }
  }
  profileSettingsOpen = true;
  profileSettingsActiveSection = '';
  clearProfileSettingsSubpageTransientState();
  renderProfilePage();
  const settingsPage = document.getElementById('profile-settings-page');
  settingsPage?.scrollTo({ top: 0, behavior: 'auto' });
  /* v10.765: hydrate the new Username + Display Name cards every time the
     settings page opens so they reflect the latest userProfile state. */
  if (typeof renderProfileSettingsIdentityCards === 'function') {
    try { renderProfileSettingsIdentityCards(); } catch (e) { console.warn('[v10.765] identity card render failed:', e); }
  }
}

function closeProfileSettingsPage() {
  profileSettingsOpen = false;
  profileSettingsActiveSection = '';
  clearProfileSettingsSubpageTransientState();
  renderProfilePage();
  setTimeout(() => document.querySelector('.profile-settings-btn')?.focus(), 60);
}

async function openProfileListsView() {
  profileSettingsOpen = false;

  if (!isViewingOtherProfile()) {
    profileViewingUser = null;
    profileViewingProfile = null;
    profileViewingData = null;
    document.body.classList.remove('profile-active');
    setBottomNavVisibility(true);
    syncMainNavButtons('mylist');
    setMainNavVisibility('mylist');
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }

  const targetUser = profileViewingUser ? { ...profileViewingUser } : null;
  if (!targetUser?.uid) return;

  if (landingPublicProfileActive && !currentUser && targetUser.uid === CREATOR_PUBLIC_UID) {
    await openSignedOutCreatorListsView(targetUser);
    return;
  }
  if (typeof isShelfdGuestBrowsing === 'function' && isShelfdGuestBrowsing() && !currentUser && targetUser.uid === CREATOR_PUBLIC_UID) {
    await openGuestCreatorListsView({ returnTab: profileReturnTab || 'community' });
    return;
  }

  if (viewingUser && viewingUser.uid === targetUser.uid) {
    document.body.classList.remove('profile-active');
    setBottomNavVisibility(true);
    profileViewingUser = null;
    profileViewingProfile = null;
    profileViewingData = null;
    syncMainNavButtons('mylist');
    setMainNavVisibility('mylist');
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }

  await viewUserList(targetUser.uid, targetUser.name || 'Friend', targetUser.photo || '', {
    transitionOrigin: 'profile-left'
  });
  profileViewingUser = null;
  profileViewingProfile = null;
  profileViewingData = null;
}



function bindProfilePageSwipeBack(profilePage = document.getElementById('profile-page')) {
  if (!profilePage || profilePage.dataset.profileSwipeBackBound === 'true') return;
  profilePage.dataset.profileSwipeBackBound = 'true';
  const EDGE_WIDTH = 48;
  const MIN_ARM_DISTANCE = 12;
  const DIRECTION_LOCK_RATIO = 1.45;
  const VERTICAL_CANCEL_RATIO = 1.12;
  const VELOCITY_CLOSE_PX_PER_MS = 0.75;
  const INTERACTIVE_SELECTOR = [
    'button',
    'a',
    'input',
    'textarea',
    'select',
    '[contenteditable="true"]',
    '[role="button"]',
    '.profile-favorites-grid',
    '.profile-links-grid',
    '.profile-social-counts',
    '.profile-stat-card',
    '.profile-mobile-links-zone',
    '.profile-favorite-picker-bottom-sheet',
    '.profile-character-editor-overlay',
    '.plm-overlay'
  ].join(', ');
  let startX = 0, startY = 0, lastX = 0, lastT = 0, velocityX = 0, viewportW = 0;
  let canSwipe = false, swiping = false, closing = false, pointerId = null, rafId = 0, pendingX = 0;
  const hasBlockingProfileOverlay = () => (
    !!document.getElementById('profile-social-modal') ||
    !!document.getElementById('profile-link-edit-modal') ||
    !!document.getElementById('profile-favorite-picker-modal') ||
    !!document.getElementById('profile-character-editor-overlay') ||
    document.body.classList.contains('profile-character-editor-open')
  );
  const applyFrame = () => {
    rafId = 0;
    const x = Math.max(0, Math.min(pendingX, viewportW || 390));
    profilePage.style.transform = `translate3d(${x}px, 0, 0)`;
    profilePage.style.boxShadow = '-18px 0 42px rgba(0,0,0,0.28)';
  };
  const scheduleFrame = () => { if (!rafId) rafId = requestAnimationFrame(applyFrame); };
  const clearFrame = () => { if (rafId) cancelAnimationFrame(rafId); rafId = 0; };
  const reset = () => {
    clearFrame(); canSwipe = false; swiping = false; closing = false; pointerId = null; pendingX = 0;
    profilePage.classList.remove('profile-swipe-back-dragging', 'profile-swipe-back-snapping');
    document.body.classList.remove('profile-swipe-back-active');
    clearProfileFriendShelfUnderlay();
    profilePage.style.transition = ''; profilePage.style.transform = ''; profilePage.style.willChange = ''; profilePage.style.boxShadow = '';
    profilePage.style.borderTopLeftRadius = ''; profilePage.style.borderBottomLeftRadius = ''; profilePage.style.touchAction = '';
  };
  const arm = () => {
    if (swiping || closing) return; swiping = true;
    prepareProfileFriendShelfUnderlay();
    profilePage.classList.add('profile-swipe-back-dragging'); document.body.classList.add('profile-swipe-back-active');
    profilePage.style.transition = 'none'; profilePage.style.willChange = 'transform';
    profilePage.style.borderTopLeftRadius = '18px'; profilePage.style.borderBottomLeftRadius = '18px'; profilePage.style.touchAction = 'none';
  };
  const snapBack = () => {
    clearFrame(); profilePage.classList.add('profile-swipe-back-snapping');
    profilePage.style.transition = 'transform 0.22s cubic-bezier(0.2, 1, 0.3, 1), box-shadow 0.22s ease, border-radius 0.22s ease';
    profilePage.style.transform = 'translate3d(0, 0, 0)'; profilePage.style.boxShadow = '';
    window.setTimeout(reset, 240);
  };
  const completeBack = () => {
    if (closing) return;
    closing = true;
    clearFrame(); profilePage.classList.add('profile-swipe-back-snapping');
    profilePage.style.transition = 'transform 0.36s cubic-bezier(0.18, 0.92, 0.18, 1), box-shadow 0.36s ease';
    profilePage.style.transform = 'translate3d(105vw, 0, 0)'; profilePage.style.boxShadow = '-20px 0 44px rgba(0,0,0,0.12)';
    window.setTimeout(() => {
      Promise.resolve(closeProfile()).finally(reset);
    }, 360);
  };
  const start = event => {
    const point = event.touches?.[0] || event; if (!point) return;
    if (closing || hasBlockingProfileOverlay()) return;
    if (profileSettingsOpen && profileSettingsActiveSection) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.touches && event.touches.length !== 1) return;
    if (point.clientX > EDGE_WIDTH) return;
    if (event.target?.closest?.(INTERACTIVE_SELECTOR)) return;
    startX = point.clientX; startY = point.clientY; lastX = startX; lastT = performance.now(); velocityX = 0; viewportW = window.innerWidth || 390;
    canSwipe = true; swiping = false; pointerId = event.pointerId ?? null;
  };
  const move = event => {
    if (!canSwipe) return; const point = event.touches?.[0] || event; if (!point) return;
    if (pointerId !== null && event.pointerId !== undefined && event.pointerId !== pointerId) return;
    const dx = point.clientX - startX, dy = point.clientY - startY, absDx = Math.abs(dx), absDy = Math.abs(dy);
    if (dx < 0) { reset(); return; }
    if (!swiping) {
      if (dx > MIN_ARM_DISTANCE && absDx > absDy * DIRECTION_LOCK_RATIO) { arm(); try { if (event.pointerId !== undefined) profilePage.setPointerCapture?.(event.pointerId); } catch(e) {} }
      else if (absDy > absDx * VERTICAL_CANCEL_RATIO) { reset(); return; }
      else return;
    }
    if (event.cancelable) event.preventDefault();
    const now = performance.now(); const dt = Math.max(1, now - lastT);
    velocityX = (point.clientX - lastX) / dt; lastX = point.clientX; lastT = now; pendingX = Math.max(0, Math.min(viewportW, dx)); scheduleFrame();
  };
  const end = event => {
    if (!canSwipe && !swiping) return; const point = event.changedTouches?.[0] || event; const dx = point ? point.clientX - startX : pendingX;
    try { if (pointerId !== null) profilePage.releasePointerCapture?.(pointerId); } catch(e) {}
    if (swiping) { const shouldClose = dx >= viewportW * 0.34 || (dx > 58 && velocityX > VELOCITY_CLOSE_PX_PER_MS); shouldClose ? completeBack() : snapBack(); }
    else reset();
  };
  if (window.PointerEvent) {
    profilePage.addEventListener('pointerdown', start, { passive: true });
    profilePage.addEventListener('pointermove', move, { passive: false });
    profilePage.addEventListener('pointerup', end, { passive: true });
    profilePage.addEventListener('pointercancel', reset, { passive: true });
  } else {
    profilePage.addEventListener('touchstart', start, { passive: true });
    profilePage.addEventListener('touchmove', move, { passive: false });
    profilePage.addEventListener('touchend', end, { passive: true });
    profilePage.addEventListener('touchcancel', reset, { passive: true });
  }
}

async function closeProfile() {
  let returnState = cloneProfileReturnState(profileReturnState);
  if ((!returnState || returnState.kind !== 'friend-home') && viewingUser?.uid) {
    returnState = {
      kind: 'friend-home',
      tab: 'community',
      user: {
        uid: viewingUser.uid,
        name: viewingUser.name || 'Friend',
        photo: viewingUser.photo || ''
      },
      returnState: cloneProfileReturnState(viewingReturnState)
    };
  }
  if (typeof isShelfdGuestBrowsing === 'function' && isShelfdGuestBrowsing() && !currentUser) {
    const returnTab = profileReturnTab || 'discover';
    profileSettingsOpen = false;
    profileReturnState = null;
    profileViewingUser = null;
    profileViewingProfile = null;
    profileViewingData = null;
    document.body.classList.remove('own-profile-active', 'profile-active');
    finalizeProfilePageClosed();
    setBottomNavVisibility(true);
    if (returnTab === 'mylist') {
      if (typeof openGuestCreatorListsView === 'function') openGuestCreatorListsView({ returnTab: 'discover' });
      return;
    }
    syncMainNavButtons(returnTab);
    setMainNavVisibility(returnTab);
    if (returnTab === 'community') {
      loadCommunity(true);
      loadFriendActivity();
    }
    if (returnTab === 'discover' || returnTab === 'games-discover') {
      if (returnTab === 'games-discover') activeDiscoveryHub = 'gaming';
      loadActiveDiscoveryHub();
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }
  if (landingPublicProfileActive || !currentUser) {
    profileSettingsOpen = false;
    profileReturnState = null;
    profileViewingUser = null;
    profileViewingProfile = null;
    profileViewingData = null;
    document.body.classList.remove('own-profile-active');
    finalizeProfilePageClosed();
    showLandingPage();
    return;
  }
  profileSettingsOpen = false;
  profileReturnState = null;
  profileViewingUser = null;
  profileViewingProfile = null;
  profileViewingData = null;
  if (profileReturnTab === 'games-discover') {
    activeDiscoveryHub = 'gaming';
    profileReturnTab = 'discover';
  }
  document.body.classList.remove('profile-active', 'landing-public-lists');
  finalizeProfilePageClosed();
  setBottomNavVisibility(true);
  if (returnState?.kind === 'friend-home' && returnState.user?.uid) {
    if (restoreFriendShelfAfterProfileClose(returnState)) return;
    await viewUserList(returnState.user.uid, returnState.user.name || 'Friend', returnState.user.photo || '', {
      transitionOrigin: 'profile-left'
    });
    return;
  }
  if (returnState?.kind === 'community' && typeof restoreCommunityReturnState === 'function') {
    if (typeof clearFriendHomeChrome === 'function') clearFriendHomeChrome();
    await restoreCommunityReturnState(returnState);
    window.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }
  if (typeof clearFriendHomeChrome === 'function') clearFriendHomeChrome();
  setMainNavVisibility(profileReturnTab || 'mylist');
  if (profileReturnTab === 'community') loadCommunity();
  if (profileReturnTab === 'discover') loadActiveDiscoveryHub();
  if ((profileReturnTab || 'mylist') === 'mylist') render();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

/* v10.977: rewritten from the v706 CSS-keyframe approach to use inline
   transition + transform, mirroring how the swipe-back path's
   `completeBack()` already drives the close.

   WHY: the old path swapped classes — removed `profile-page-open`
   (whose `animation: profileEnterRight ... both` was holding the page
   at translateX(0) via fill-mode), then added `profile-page-closing`
   (whose `animation: profileExitRight ... both` would slide from
   translateX(0) to translateX(100%)). The moment the open class was
   removed, the page lost its fill-mode anchor and reverted to the
   base `.profile-page { transform: translateX(100%) }` for one paint
   frame BEFORE the closing animation's from-state took over. That
   one-frame snap off-screen + the subsequent 280ms slide read as
   TWO back animations to the user.

   The inline approach below pins the current visual state with
   `transform: translateX(0)`, forces a reflow, then transitions
   to translateX(100%). Because transition is continuous from the
   current computed value, there is no possible mid-frame snap.
   Same mechanism the swipe path already uses → both back paths now
   share one animation system, no fighting cascade.

   Dead-code removal companion: the `@keyframes profileExitRight` rule
   in 16-light-mode-contrast.css is no longer referenced and is
   stripped in this version (the `.profile-page-closing` selector now
   only carries `pointer-events: none` for re-entry guarding). */
function closeProfileWithAnimation() {
  const profilePage = document.getElementById('profile-page');
  if (!profilePage ||
      profilePage.style.display === 'none' ||
      profilePage.classList.contains('profile-page-closing')) {
    closeProfile();
    return;
  }
  /* Step 1: pin the page at its current visible position with an
     inline transform. This overrides both the `profile-page-open`
     animation fill AND the base `translateX(100%)` rule, so the next
     class change cannot cause a paint snap. */
  profilePage.style.willChange = 'transform';
  profilePage.style.transition = 'none';
  profilePage.style.transform = 'translate3d(0, 0, 0)';
  profilePage.style.boxShadow = '-18px 0 42px rgba(0,0,0,0.16)';
  prepareProfileFriendShelfUnderlay();
  document.body.classList.add('profile-back-closing-active');
  /* Step 2: swap state classes. The inline transform is now holding
     the visual position so this swap is invisible. The closing class
     also flips `pointer-events: none` to block taps during the close. */
  profilePage.classList.remove('profile-page-open');
  profilePage.classList.add('profile-page-closing');
  /* Step 3: force layout so the browser commits the inline transform
     before we change it again. Without this the next transform assignment
     could collapse into the same paint as the first one and skip the
     transition entirely. */
  void profilePage.offsetWidth;
  /* Step 4: drive the slide-off with a continuous transition. Same
     curve + duration as the prior CSS keyframe so timing matches what
     users were used to before. */
  profilePage.style.transition = 'transform 0.36s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.36s ease';
  profilePage.style.transform = 'translate3d(100%, 0, 0)';
  /* Step 5: after the slide finishes, hand off to closeProfile() for
     the state restore + display:none, then clear the inline styles so
     a re-open is clean. The next openProfilePageShell() already calls
     `classList.remove('profile-page-open', 'profile-page-closing')`. */
  setTimeout(() => {
    Promise.resolve(closeProfile()).finally(() => {
      profilePage.style.transition = '';
      profilePage.style.transform = '';
      profilePage.style.willChange = '';
      profilePage.style.boxShadow = '';
      document.body.classList.remove('profile-back-closing-active');
    });
  }, 370);
}
window.closeProfileWithAnimation = closeProfileWithAnimation;

function applyThemeMode(mode, persist = true) {
  /* v812: coerce through resolveActiveThemeMode so any caller passing
     'light' / 'cream' / 'true-dark' / null / undefined / a stale value
     ends up applying the current Default Theme. The legacy body-class
     branches below are kept intact (dormant) so re-enabling other
     themes later is just a matter of swapping the resolver. */
  const normalized = resolveActiveThemeMode(mode);
  document.documentElement.classList.remove('light-mode', 'true-dark-mode', 'cream-mode');
  document.body.classList.remove('light-mode', 'true-dark-mode', 'cream-mode');
  if (normalized === 'light')     document.body.classList.add('light-mode');
  if (normalized === 'true-dark') document.body.classList.add('true-dark-mode');
  if (normalized === 'cream') {
    document.body.classList.add('light-mode', 'cream-mode');
  }
  if (persist) {
    localStorage.setItem('theme-mode', normalized);
    localStorage.setItem('theme', (normalized === 'light' || normalized === 'cream') ? 'light' : 'dark');
  }
  return normalized;
}

function toggleTheme(isLight) {
  applyThemeMode(isLight ? 'light' : 'default', true);
}

// v808/v812/v813 — Step 1: force every user into the current Default Theme
// at boot. Strips stale localStorage values + stale html/body theme classes,
// then applies the Default Theme and persists it so subsequent loads start
// clean. v813: ACTIVE is 'true-dark' — adding body.true-dark-mode produces
// the modern Shelfd UI seen in correct_default_theme.png (charcoal #0E0E0E
// base, neutral-grey cards, lavender accents). The BASE CSS (no class) is
// the OLD purple-gradient legacy seen in wrong_legacy_theme.png and is
// never applied. 'light' / 'cream' / 'default' (legacy value) / null /
// undefined / invalid all get stripped and coerced.
(function() {
  const ACTIVE = getDefaultThemeMode(); // 'true-dark' = modern Shelfd UI
  /* 1. Strip stale localStorage if it isn't the active value — covers
        users who came in with 'default' (from v812's incorrect mapping),
        'light', 'cream', 'dark', or any other legacy value. */
  try {
    const stored = localStorage.getItem('theme-mode');
    if (stored !== ACTIVE) {
      try { localStorage.removeItem('theme-mode'); } catch (e) {}
      try { localStorage.removeItem('theme'); } catch (e) {}
    }
  } catch (e) {}
  /* 2. Strip stale legacy theme classes from <html> and <body> so the
        next applyThemeMode() lands on a clean slate. */
  try {
    document.documentElement.classList.remove('light-mode', 'cream-mode', 'true-dark-mode');
    if (document.body) {
      document.body.classList.remove('light-mode', 'cream-mode', 'true-dark-mode');
    }
  } catch (e) {}
  /* 3. Apply the active Default Theme and persist it. applyThemeMode
        runs through resolveActiveThemeMode and adds body.true-dark-mode,
        which produces the modern Shelfd UI. */
  applyThemeMode(ACTIVE, true);
})();

function previewProfilePhoto(url) {
  const preview = document.getElementById("profile-preview");
  if (url.trim()) {
    preview.src = url.trim();
    preview.onerror = () => { preview.src = '/default-avatar.svg#?&background=1c1535&color=a78bfa'; };
  }
}

function handleProfileUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const size = 200;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      // Crop to square from center
      const min = Math.min(img.width, img.height);
      const sx = (img.width - min) / 2;
      const sy = (img.height - min) / 2;
      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
      const base64 = canvas.toDataURL('image/jpeg', 0.7);
      document.getElementById("profile-preview").src = base64;
      document.getElementById("profile-photo").value = base64;
      if (userProfile) userProfile.photo = base64;
      saveProfile({ silent: true, keepEditMode: true }).catch(() => {});
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function getProfileShareUid() {
  return profileViewingUser?.uid || profileViewingProfile?.uid || userProfile?.uid || currentUser?.uid || '';
}

function getProfileShareHandle(profile = getActiveProfile()) {
  const raw = (
    profile?.usernameHandleLower ||
    profile?.usernameHandle ||
    profileViewingUser?.usernameHandleLower ||
    profileViewingUser?.usernameHandle ||
    userProfile?.usernameHandleLower ||
    userProfile?.usernameHandle ||
    ''
  );
  return String(raw || '').trim().replace(/^@+/, '').toLowerCase();
}

function getProfileShareStatsParams() {
  const stats = calculateProfileStats();
  return {
    hours: formatProfileHours(stats.allMediaHours),
    avg: String(stats.allMediaAvg || 'N/A').trim()
  };
}

function getProfileFavoriteConfigByKey(key = '') {
  return [...PROFILE_DATABASE_FAVORITES, ...PROFILE_MANUAL_FAVORITES].find(item => item.key === key) || null;
}

function getProfileFavoriteSharePayload(card) {
  const slot = card?.closest?.('.profile-fav-poster-card') || card;
  if (!slot) return null;
  const databaseMode = slot.classList.contains('profile-db-slot');
  const section = databaseMode ? slot.dataset.profileDbSection : slot.dataset.manualSection;
  const index = Number(databaseMode ? slot.dataset.profileDbIndex || 0 : slot.dataset.manualIndex || 0);
  const config = getProfileFavoriteConfigByKey(section);
  const title = (databaseMode ? slot.dataset.profileDbTitle : slot.dataset.manualName || '').trim();
  const image = (databaseMode ? slot.dataset.profileDbImage : slot.dataset.manualImage || '').trim();
  const rating = (databaseMode ? slot.dataset.profileDbRating : slot.dataset.manualRating || '').trim();
  const activeProfile = getActiveProfile();
  const profileName = activeProfile?.name || profileViewingUser?.name || currentUser?.displayName || 'ScreenList User';
  return {
    uid: getProfileShareUid(),
    section,
    index: Number.isFinite(index) ? Math.max(0, Math.min(2, index)) : 0,
    title: title || `Rank ${index + 1}`,
    image,
    rating,
    profileName,
    label: config?.shortLabel || config?.label || 'Top 3',
    fullLabel: config?.label || 'Top 3'
  };
}

function getShareProfileUrl(favorite = null) {
  const uid = getProfileShareUid();
  const hasFavoriteTarget = favorite?.uid && favorite?.section;
  const shareOrigin = window.SHELFD_SHARE_ORIGIN || 'https://myshelfd.com';
  const activeProfile = getActiveProfile();
  const url = hasFavoriteTarget
    ? new URL(`/profile-card/${encodeURIComponent(favorite.uid)}/${encodeURIComponent(favorite.section)}/${Number(favorite.index || 0) + 1}`, shareOrigin)
    : uid && uid !== 'preview-user'
      ? new URL(`/profile/${encodeURIComponent(uid)}`, shareOrigin)
      : new URL(window.location.href);
  url.hash = '';
  url.searchParams.delete('preview');
  if (uid && uid !== 'preview-user') url.searchParams.set('profile', uid);
  else url.searchParams.delete('profile');
  if (hasFavoriteTarget) {
    url.searchParams.set('top3', favorite.section);
    url.searchParams.set('rank', String(Number(favorite.index || 0) + 1));
    url.searchParams.set('cardTitle', favorite.title || 'ScreenList Top 3');
    url.searchParams.set('profileName', favorite.profileName || 'ScreenList User');
    url.searchParams.set('label', favorite.label || 'Top 3');
    const image = String(favorite.image || '').trim();
    if (/^https?:\/\//i.test(image)) url.searchParams.set('cardImage', image);
  } else {
    url.searchParams.delete('top3');
    url.searchParams.delete('rank');
    url.searchParams.delete('cardTitle');
    url.searchParams.delete('profileName');
    url.searchParams.delete('label');
    url.searchParams.delete('cardImage');
    const handle = getProfileShareHandle(activeProfile);
    const displayName = activeProfile?.name || profileViewingUser?.name || currentUser?.displayName || '';
    const photo = String(activeProfile?.photo || profileViewingUser?.photo || currentUser?.photoURL || '').trim();
    const shareStats = getProfileShareStatsParams();
    if (handle) url.searchParams.set('handle', handle);
    else url.searchParams.delete('handle');
    if (displayName) url.searchParams.set('name', displayName);
    else url.searchParams.delete('name');
    if (/^https?:\/\//i.test(photo)) url.searchParams.set('photo', photo);
    else url.searchParams.delete('photo');
    if (shareStats.hours) url.searchParams.set('hours', shareStats.hours);
    if (shareStats.avg) url.searchParams.set('avg', shareStats.avg);
  }
  return url.toString();
}

async function copyProfileLink(url) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
      return true;
    }
  } catch (e) {}
  const input = document.createElement('input');
  input.value = url;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  input.style.pointerEvents = 'none';
  document.body.appendChild(input);
  input.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch (e) { copied = false; }
  input.remove();
  return copied;
}

async function shareProfile() {
  const activeProfile = isViewingOtherProfile() ? getActiveProfile() : readProfileFromPage();
  if (!isViewingOtherProfile()) userProfile = activeProfile;
  const shareUrl = getShareProfileUrl();
  const profileHandle = getProfileShareHandle(activeProfile);
  const profileName = profileHandle || activeProfile?.name || currentUser?.displayName || 'ScreenList Profile';
  const shareData = {
    title: `${profileName} on Shelfd`,
    text: `Check out ${profileName}'s Shelfd profile.`,
    url: shareUrl
  };
  try {
    if (navigator.share) {
      await navigator.share(shareData);
      showToast('Profile share opened');
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  const copied = await copyProfileLink(shareUrl);
  showToast(copied ? 'Profile link copied' : 'Could not copy profile link');
}

function drawProfileShareWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  words.forEach(word => {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  });
  if (line) lines.push(line);
  lines.slice(0, maxLines).forEach((value, i) => ctx.fillText(value, x, y + i * lineHeight));
}

function loadProfileShareImage(src) {
  return new Promise(resolve => {
    const clean = String(src || '').trim();
    if (!clean) { resolve(null); return; }
    const img = new Image();
    if (/^https?:\/\//i.test(clean)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = clean;
  });
}

async function buildProfileFavoriteShareImageFile(payload) {
  if (!payload || typeof File === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 1200;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#120d22';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const bg = ctx.createLinearGradient(0, 0, 900, 1200);
  bg.addColorStop(0, '#2a1f5e');
  bg.addColorStop(0.48, '#151025');
  bg.addColorStop(1, '#090712');
  ctx.fillStyle = bg;
  ctx.fillRect(38, 38, 824, 1124);
  ctx.strokeStyle = 'rgba(201,168,76,0.72)';
  ctx.lineWidth = 4;
  ctx.strokeRect(58, 58, 784, 1084);
  ctx.fillStyle = 'rgba(255,255,255,0.11)';
  ctx.fillRect(96, 118, 708, 760);
  const img = await loadProfileShareImage(payload.image);
  if (img) {
    const sourceRatio = img.width / img.height;
    const targetRatio = 708 / 760;
    let sw = img.width;
    let sh = img.height;
    let sx = 0;
    let sy = 0;
    if (sourceRatio > targetRatio) {
      sw = img.height * targetRatio;
      sx = (img.width - sw) / 2;
    } else {
      sh = img.width / targetRatio;
      sy = (img.height - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, 96, 118, 708, 760);
  } else {
    ctx.fillStyle = '#8f7fd0';
    ctx.font = '300 96px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(payload.index + 1), 450, 520);
    ctx.textAlign = 'left';
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = '300 28px system-ui, sans-serif';
  ctx.fillText(`${payload.profileName}'s ${payload.label}`, 96, 950);
  ctx.font = '600 52px system-ui, sans-serif';
  drawProfileShareWrappedText(ctx, `#${payload.index + 1} ${payload.title}`, 96, 1022, 708, 62, 2);
  if (payload.rating) {
    ctx.fillStyle = '#C9A84C';
    ctx.font = '300 30px system-ui, sans-serif';
    ctx.fillText(payload.rating, 96, 1132);
  }
  return new Promise(resolve => {
    try {
      canvas.toBlob(blob => {
        if (!blob) { resolve(null); return; }
        resolve(new File([blob], 'screenlist-top-three-card.png', { type: 'image/png' }));
      }, 'image/png', 0.92);
    } catch (error) {
      resolve(null);
    }
  });
}

async function shareProfileFavoriteCard(event, card) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const payload = getProfileFavoriteSharePayload(card);
  if (!payload?.uid || payload.uid === 'preview-user') {
    showToast('Save your profile before sharing this card');
    return;
  }
  const shareUrl = getShareProfileUrl(payload);
  const shareData = {
    title: `${payload.profileName}'s #${payload.index + 1} ${payload.label}`,
    text: `Check out ${payload.profileName}'s #${payload.index + 1} ${payload.label}: ${payload.title}.`,
    url: shareUrl
  };
  try {
    const file = await buildProfileFavoriteShareImageFile(payload);
    if (file && navigator.canShare?.({ files: [file] })) shareData.files = [file];
    if (navigator.share) {
      await navigator.share(shareData);
      showToast('Card share opened');
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  const copied = await copyProfileLink(shareUrl);
  showToast(copied ? 'Card link copied' : 'Could not copy card link');
}

function profileShareRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

async function buildProfileFavoriteRowShareImageFile(cardData, profileName, label, stats) {
  if (!Array.isArray(cardData) || typeof File === 'undefined') return null;
  const hasStats = Array.isArray(stats) && stats.length > 0;
  const S = 1;
  const W = 1200 * S, PAD = 48 * S, GAP = 18 * S;
  const posterW = Math.floor((W - PAD * 2 - GAP * 2) / 3);
  const posterH = Math.floor(posterW * 1.5);
  const HEADER_H = 124 * S;
  const STATS_BLOCK = hasStats ? 96 * S : 0;
  const POSTER_Y = HEADER_H + STATS_BLOCK;
  const H = POSTER_Y + posterH + 90 * S;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#2a1f5e');
  bg.addColorStop(0.5, '#151025');
  bg.addColorStop(1, '#090712');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(201,168,76,0.72)';
  ctx.lineWidth = 3 * S;
  ctx.strokeRect(22 * S, 22 * S, W - 44 * S, H - 44 * S);
  ctx.fillStyle = 'rgba(255,255,255,0.50)';
  ctx.font = `300 ${26 * S}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(`${profileName}'s`, W / 2, 62 * S);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${42 * S}px system-ui, sans-serif`;
  ctx.fillText(label, W / 2, 110 * S);
  if (hasStats) {
    const boxW = 220 * S, boxGap = 60 * S;
    const totalW = stats.length * boxW + (stats.length - 1) * boxGap;
    const startX = (W - totalW) / 2;
    stats.forEach((stat, si) => {
      const bx = startX + si * (boxW + boxGap);
      const by = HEADER_H + 8 * S;
      ctx.fillStyle = '#C9A84C';
      ctx.font = `700 ${46 * S}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(stat.value, bx + boxW / 2, by + 50 * S);
      ctx.fillStyle = 'rgba(255,255,255,0.50)';
      ctx.font = `300 ${18 * S}px system-ui, sans-serif`;
      ctx.fillText(stat.label, bx + boxW / 2, by + 76 * S);
    });
  }
  const images = await Promise.all(cardData.map(c => loadProfileShareImage(c.image)));
  for (let i = 0; i < 3; i++) {
    const x = PAD + i * (posterW + GAP);
    const y = POSTER_Y;
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    profileShareRoundRect(ctx, x, y, posterW, posterH, 12 * S);
    ctx.fill();
    const img = images[i];
    if (img) {
      try {
        ctx.save();
        profileShareRoundRect(ctx, x, y, posterW, posterH, 12 * S);
        ctx.clip();
        const sr = img.width / img.height, tr = posterW / posterH;
        let sw = img.width, sh = img.height, sx = 0, sy = 0;
        if (sr > tr) { sw = img.height * tr; sx = (img.width - sw) / 2; }
        else { sh = img.width / tr; sy = (img.height - sh) / 2; }
        ctx.drawImage(img, sx, sy, sw, sh, x, y, posterW, posterH);
        ctx.restore();
      } catch (e) { ctx.restore(); }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.beginPath();
    ctx.arc(x + 22 * S, y + 22 * S, 17 * S, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#C9A84C';
    ctx.font = `700 ${15 * S}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(['#1','#2','#3'][i] || `#${i+1}`, x + 22 * S, y + 27 * S);
    const title = String(cardData[i]?.title || '');
    ctx.fillStyle = '#f7f3ff';
    ctx.font = `600 ${20 * S}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    const maxTW = posterW - 8 * S;
    let dTitle = title;
    while (dTitle.length > 1 && ctx.measureText(dTitle).width > maxTW) dTitle = dTitle.slice(0, -1);
    if (dTitle !== title) dTitle += '…';
    ctx.fillText(dTitle, x + posterW / 2, y + posterH + 30 * S);
    if (cardData[i]?.rating) {
      ctx.fillStyle = '#f4d27a';
      ctx.font = `700 ${17 * S}px system-ui, sans-serif`;
      ctx.fillText(cardData[i].rating, x + posterW / 2, y + posterH + 58 * S);
    }
  }
  return new Promise(resolve => {
    try {
      canvas.toBlob(blob => {
        if (!blob) { resolve(null); return; }
        resolve(new File([blob], 'screenlist-top-three.png', { type: 'image/png' }));
      }, 'image/png');
    } catch (e) { resolve(null); }
  });
}

async function shareProfileFavoriteRow(event, btn) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const mediaGroup = btn.closest('.profile-media-group');
  const grid = mediaGroup?.querySelector('.profile-fav-poster-grid');
  if (!grid) return;
  const uid = getProfileShareUid();
  if (!uid || uid === 'preview-user') { showToast('Save your profile before sharing'); return; }
  const cards = [...grid.querySelectorAll('.profile-fav-poster-card')];
  const firstCard = cards[0];
  const sectionKey = firstCard?.dataset.profileDbSection || firstCard?.dataset.manualSection || '';
  const config = getProfileFavoriteConfigByKey(sectionKey);
  const groupKey = mediaGroup?.dataset.profileGroup || '';
  const groupConfig = PROFILE_MEDIA_GROUPS?.find(g => g.key === groupKey);
  const label = groupConfig?.title || config?.label || 'Top 3';
  const activeProfile = getActiveProfile();
  const profileName = activeProfile?.name || profileViewingUser?.name || currentUser?.displayName || 'ScreenList User';
  const cardData = cards.map(slot => {
    const isDb = slot.classList.contains('profile-db-slot');
    return {
      title: (isDb ? slot.dataset.profileDbTitle : slot.dataset.manualName || '').trim(),
      image: (isDb ? slot.dataset.profileDbImage : slot.dataset.manualImage || '').trim(),
      rating: (isDb ? slot.dataset.profileDbRating : slot.dataset.manualRating || '').trim(),
    };
  });
  const statEls = [...(mediaGroup?.querySelectorAll('.profile-group-stat') || [])];
  const stats = statEls.map(el => {
    const valueSpan = el.querySelector('.profile-group-stat-value span') || el.querySelector('.profile-group-stat-value');
    const value = (valueSpan?.textContent || '').trim();
    const lbl = (el.querySelector('.profile-group-stat-label')?.textContent || '').trim();
    return value && lbl ? { value, label: lbl } : null;
  }).filter(Boolean);
  const sectionPayload = { uid, section: sectionKey, index: 0, title: cardData[0]?.title || '', image: cardData[0]?.image || '', profileName, label: config?.shortLabel || label, fullLabel: label };
  let shareUrl = getShareProfileUrl(sectionPayload);
  const baseTitle = `${profileName}'s ${label}`;
  try {
    const file = await buildProfileFavoriteRowShareImageFile(cardData, profileName, label, stats);
    if (file && typeof firebase !== 'undefined' && firebase.storage) {
      try {
        const storageRef = firebase.storage().ref(`share-previews/${uid}/${encodeURIComponent(sectionKey)}.png`);
        const snapshot = await storageRef.put(file, { contentType: 'image/png' });
        const downloadUrl = await snapshot.ref.getDownloadURL();
        const urlObj = new URL(shareUrl);
        urlObj.searchParams.set('shareImg', downloadUrl);
        shareUrl = urlObj.toString();
      } catch (uploadErr) {
        // fall through — share with single-poster og:image
      }
    }
    if (navigator.share) {
      await navigator.share({ title: baseTitle, url: shareUrl });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  const copied = await copyProfileLink(shareUrl);
  showToast(copied ? 'Link copied' : 'Could not copy link');
}

async function saveProfile(options = {}) {
  if (isViewingOtherProfile()) { showToast('This is a read-only profile'); return; }
  const nextProfile = readProfileFromPage();
  userProfile = nextProfile;
  if (isPreviewMode() || !currentUser) {
    applyProfile();
    if (!options.keepEditMode) profileEditModeOpen = false;
    renderProfilePage();
    if (!options.silent) showToast("Preview profile updated");
    return;
  }
  const accountEmailLower = normalizeEmail(currentUser?.email);
  const creatorAccount = String(currentUser?.uid || '').trim() === CREATOR_PUBLIC_UID || accountEmailLower === CREATOR_ADMIN_EMAIL;
  if (creatorAccount) {
    nextProfile.name = CREATOR_DEFAULT_NAME;
    userProfile.name = CREATOR_DEFAULT_NAME;
  }
  try {
    await db.collection("users").doc(currentUser.uid).set({
      name: nextProfile.name,
      nameLower: nextProfile.name.toLowerCase(),
      photo: nextProfile.photo,
      customName: nextProfile.name,
      customPhoto: nextProfile.photo,
      bio: nextProfile.bio || '',
      profileBio: nextProfile.bio || '',
      themeMode: nextProfile.themeMode || getDefaultThemeMode(),
      ratingPreferences: nextProfile.ratingPreferences || getDefaultRatingPreferences(),
      animeTitleDisplayMode: nextProfile.animeTitleDisplayMode || getDefaultAnimeTitleDisplayMode(),
      socialLinks: nextProfile.socialLinks || getDefaultSocialLinks(),
      pinnedFavorites: nextProfile.pinnedFavorites || getDefaultPinnedFavorites(),
      profileVisibility: nextProfile.profileVisibility || getDefaultProfileVisibility(),
      listTabVisibility: nextProfile.listTabVisibility || getDefaultListTabVisibility(),
      showcaseFavorites: nextProfile.showcaseFavorites || getDefaultShowcaseFavorites(),
      emailLower: accountEmailLower,
      accountEmailLower: accountEmailLower,
      isCreatorAdmin: creatorAccount,
      isPublic: creatorAccount,
      uid: currentUser.uid,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    usersMap[currentUser.uid] = {
      uid: currentUser.uid,
      name: nextProfile.name,
      photo: nextProfile.photo,
      bio: nextProfile.bio || '',
      themeMode: nextProfile.themeMode || getDefaultThemeMode(),
      ratingPreferences: nextProfile.ratingPreferences || getDefaultRatingPreferences(),
      animeTitleDisplayMode: nextProfile.animeTitleDisplayMode || getDefaultAnimeTitleDisplayMode(),
      socialLinks: nextProfile.socialLinks || getDefaultSocialLinks(),
      pinnedFavorites: nextProfile.pinnedFavorites || getDefaultPinnedFavorites(),
      profileVisibility: nextProfile.profileVisibility || getDefaultProfileVisibility(),
      listTabVisibility: nextProfile.listTabVisibility || getDefaultListTabVisibility(),
      showcaseFavorites: nextProfile.showcaseFavorites || getDefaultShowcaseFavorites(),
      emailLower: accountEmailLower,
      accountEmailLower: accountEmailLower,
      isCreatorAdmin: creatorAccount,
      isPublic: creatorAccount
    };
    await syncCreatorPublicProfileMirror(currentUser, nextProfile, creatorAccount ? data : null);
  } catch(e) { console.error("Profile save failed:", e); }
  applyThemeMode(nextProfile.themeMode || getDefaultThemeMode(), true);
  applyProfile();
  if (!options.keepEditMode) profileEditModeOpen = false;
  renderProfilePage();
  if (!options.silent) showToast("Profile updated");
}

/* ============================================================================

/* v10.552: Profile topbar three-dot menu — only shown when viewing
   another user's profile. Opens a small dropdown with Report + Block. */
function toggleProfileMoreMenu() {
  const menu = document.getElementById('profile-more-menu');
  if (!menu) return;
  const willOpen = menu.hidden;
  menu.hidden = !willOpen;
  if (willOpen) {
    setTimeout(() => {
      const onOutside = e => {
        const wrap = document.getElementById('profile-more-wrap');
        if (wrap && !wrap.contains(e.target)) {
          menu.hidden = true;
          document.removeEventListener('click', onOutside, true);
          document.removeEventListener('touchstart', onOutside, true);
        }
      };
      document.addEventListener('click', onOutside, true);
      document.addEventListener('touchstart', onOutside, true);
    }, 0);
  }
}
window.toggleProfileMoreMenu = toggleProfileMoreMenu;

function closeProfileMoreMenu() {
  const menu = document.getElementById('profile-more-menu');
  if (menu) menu.hidden = true;
}
window.closeProfileMoreMenu = closeProfileMoreMenu;

function canCurrentUserAssignProfileUsername() {
  return !!(
    currentUser &&
    String(currentUser.uid || '').trim() === CREATOR_PUBLIC_UID &&
    isViewingOtherProfile() &&
    profileViewingUser?.uid &&
    profileViewingUser.uid !== currentUser.uid
  );
}

function syncProfileAdminUsernameAction(viewingOther = isViewingOtherProfile()) {
  const menu = document.getElementById('profile-more-menu');
  if (!menu) return;
  let btn = document.getElementById('profile-admin-username-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'profile-admin-username-btn';
    btn.className = 'profile-admin-username-menu-btn';
    btn.textContent = 'Set username';
    btn.onclick = () => {
      closeProfileMoreMenu();
      openAdminSetUsernameModal();
    };
    menu.insertBefore(btn, menu.firstChild);
  }
  btn.hidden = !(viewingOther && canCurrentUserAssignProfileUsername());
}

function getProfileAdminTargetHandle() {
  const profile = getActiveProfile() || {};
  return String(
    profile.usernameHandle ||
    profile.userHandle ||
    profile.username ||
    profile.handle ||
    profile.usernameHandleLower ||
    profileViewingUser?.usernameHandle ||
    profileViewingUser?.usernameHandleLower ||
    ''
  ).trim().replace(/^@+/, '');
}

function ensureAdminSetUsernameModal() {
  let modal = document.getElementById('profile-admin-username-modal');
  if (modal) return modal;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="profile-admin-username-modal" class="profile-admin-username-overlay" style="display:none;" onclick="closeAdminSetUsernameModal()">
      <div class="profile-admin-username-sheet" onclick="event.stopPropagation()" role="dialog" aria-modal="true" aria-labelledby="profile-admin-username-title">
        <div class="profile-admin-username-kicker">Owner tools</div>
        <h3 id="profile-admin-username-title">Set username</h3>
        <p id="profile-admin-username-sub" class="profile-admin-username-sub">Assign a public @username to this account.</p>
        <label class="profile-admin-username-label" for="profile-admin-username-input">Username</label>
        <div class="profile-admin-username-input-wrap">
          <span aria-hidden="true">@</span>
          <input id="profile-admin-username-input" type="text" maxlength="30" pattern="[a-z0-9._]{1,30}" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="username">
        </div>
        <div id="profile-admin-username-error" class="profile-admin-username-error" role="alert" hidden></div>
        <div class="profile-admin-username-actions">
          <button type="button" class="btn-secondary" onclick="closeAdminSetUsernameModal()">Cancel</button>
          <button type="button" class="btn-primary" id="profile-admin-username-save-btn" onclick="saveAdminAssignedUsername()">Save</button>
        </div>
      </div>
    </div>
  `);
  modal = document.getElementById('profile-admin-username-modal');
  const input = document.getElementById('profile-admin-username-input');
  if (input && !input.__shelfdAdminUsernameBound) {
    input.__shelfdAdminUsernameBound = true;
    input.addEventListener('input', () => {
      const cleaned = sanitizeProfileUsernameInput(input.value);
      if (input.value !== cleaned) input.value = cleaned;
      setAdminUsernameError('');
    });
  }
  return modal;
}

function setAdminUsernameError(message = '') {
  const errorEl = document.getElementById('profile-admin-username-error');
  if (!errorEl) return;
  if (message) {
    errorEl.textContent = String(message);
    errorEl.hidden = false;
  } else {
    errorEl.textContent = '';
    errorEl.hidden = true;
  }
}

function openAdminSetUsernameModal() {
  if (!canCurrentUserAssignProfileUsername()) return;
  const modal = ensureAdminSetUsernameModal();
  const input = document.getElementById('profile-admin-username-input');
  const sub = document.getElementById('profile-admin-username-sub');
  const targetName = getViewingProfileName();
  if (sub) sub.textContent = `Assign a public @username to ${targetName}.`;
  if (input) input.value = sanitizeProfileUsernameInput(getProfileAdminTargetHandle());
  setAdminUsernameError('');
  if (modal) modal.style.display = 'flex';
  setTimeout(() => { try { input?.focus(); input?.select(); } catch (_) {} }, 40);
}
window.openAdminSetUsernameModal = openAdminSetUsernameModal;

function closeAdminSetUsernameModal() {
  const modal = document.getElementById('profile-admin-username-modal');
  if (modal) modal.style.display = 'none';
  setAdminUsernameError('');
  const btn = document.getElementById('profile-admin-username-save-btn');
  if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
}
window.closeAdminSetUsernameModal = closeAdminSetUsernameModal;

function applyAdminAssignedUsernameToLocalProfile(uid, handle) {
  const cleanUid = String(uid || '').trim();
  const cleanHandle = sanitizeProfileUsernameInput(handle);
  const lower = cleanHandle.toLowerCase();
  const patch = { usernameHandle: cleanHandle, usernameHandleLower: lower };
  if (typeof usersMap === 'object' && usersMap && cleanUid) {
    usersMap[cleanUid] = { ...(usersMap[cleanUid] || {}), uid: cleanUid, ...patch };
  }
  if (profileViewingUser?.uid === cleanUid) {
    Object.assign(profileViewingUser, patch);
  }
  if (profileViewingProfile?.uid === cleanUid) {
    Object.assign(profileViewingProfile, patch);
  }
  if (viewingUser?.uid === cleanUid) {
    Object.assign(viewingUser, patch);
    viewingUser.profileData = { ...(viewingUser.profileData || {}), ...patch };
  }
  try { if (typeof window.updateMainHeaderPageTitle === 'function') window.updateMainHeaderPageTitle(); } catch (_) {}
  try { renderProfilePage(); } catch (_) {}
}

async function saveAdminAssignedUsername() {
  if (!canCurrentUserAssignProfileUsername()) return;
  const input = document.getElementById('profile-admin-username-input');
  const btn = document.getElementById('profile-admin-username-save-btn');
  const targetUid = String(profileViewingUser?.uid || '').trim();
  const newHandle = sanitizeProfileUsernameInput(input?.value || '');
  if (input && input.value !== newHandle) input.value = newHandle;
  if (!targetUid || !newHandle) {
    setAdminUsernameError('Username must be 1-30 characters and can only use letters, numbers, periods, and underscores.');
    return;
  }
  if (!PROFILE_USERNAME_RE.test(newHandle)) {
    setAdminUsernameError('Username must be 1-30 characters and can only use letters, numbers, periods, and underscores.');
    return;
  }
  if (!validateProfileUsernameModeration(newHandle).allowed) {
    setAdminUsernameError(profileUsernameModerationMessage());
    return;
  }
  const newHandleLower = newHandle.toLowerCase();
  const oldHandleLower = String(
    profileViewingProfile?.usernameHandleLower ||
    profileViewingUser?.usernameHandleLower ||
    getProfileAdminTargetHandle()
  ).trim().replace(/^@+/, '').toLowerCase();
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  setAdminUsernameError('');
  try {
    const firestore = firebase.firestore();
    const targetRef = firestore.collection('users').doc(targetUid);
    const newUsernameRef = firestore.collection('usernames').doc(newHandleLower);
    await firestore.runTransaction(async transaction => {
      const newSnap = await transaction.get(newUsernameRef);
      if (newSnap.exists && String(newSnap.data()?.uid || '') !== targetUid) {
        const err = new Error('username-taken');
        err.code = 'username-taken';
        throw err;
      }
      const targetSnap = await transaction.get(targetRef);
      if (!targetSnap.exists) {
        const err = new Error('target-user-not-found');
        err.code = 'target-user-not-found';
        throw err;
      }
      const targetData = targetSnap.data() || {};
      const currentLower = String(targetData.usernameHandleLower || oldHandleLower || '').trim().replace(/^@+/, '').toLowerCase();
      let oldUsernameRef = null;
      let oldUsernameSnap = null;
      if (currentLower && currentLower !== newHandleLower) {
        oldUsernameRef = firestore.collection('usernames').doc(currentLower);
        oldUsernameSnap = await transaction.get(oldUsernameRef);
      }
      if (!newSnap.exists) {
        transaction.set(newUsernameRef, {
          uid: targetUid,
          username: newHandle,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
      transaction.set(targetRef, {
        usernameHandle: newHandle,
        usernameHandleLower: newHandleLower,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      if (oldUsernameRef && oldUsernameSnap?.exists) {
        transaction.delete(oldUsernameRef);
      }
    });
    applyAdminAssignedUsernameToLocalProfile(targetUid, newHandle);
    closeAdminSetUsernameModal();
    if (typeof showToast === 'function') showToast(`Username set to @${newHandle}`, { durationMs: 2600 });
  } catch (error) {
    console.error('[admin-set-username]', error);
    if (error?.code === 'username-taken') {
      setAdminUsernameError('That username is already taken.');
    } else if (error?.code === 'permission-denied') {
      setAdminUsernameError('Admin username rules are not installed yet.');
    } else if (error?.code === 'target-user-not-found') {
      setAdminUsernameError('Could not find that user account.');
    } else {
      setAdminUsernameError('Could not save username. Try again.');
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
  }
}
window.saveAdminAssignedUsername = saveAdminAssignedUsername;

function reportViewingUser() {
  const user = profileViewingUser;
  if (!user?.uid || typeof window.openReportSheet !== 'function') return;
  window.openReportSheet('user', user.uid, user.uid, `${user.name || 'this user'}'s profile`);
}
window.reportViewingUser = reportViewingUser;

function blockViewingUser() {
  const user = profileViewingUser;
  if (!user?.uid) return;
  openBlockUserModal(user.uid, user.name || 'this user');
}
window.blockViewingUser = blockViewingUser;

/* v10.552: Block user modal — confirm before writing to Firestore.
   Callable from the profile three-dot menu and the DM overflow menu. */
function openBlockUserModal(uid, name) {
  if (!uid) return;
  window._shelfdPendingBlockUid = uid;
  const resolvedName = name || (typeof usersMap !== 'undefined' && usersMap[uid]?.name) || 'this user';
  window._shelfdPendingBlockName = resolvedName;
  const titleEl = document.getElementById('block-user-modal-title');
  const textEl  = document.getElementById('block-user-modal-text');
  if (titleEl) titleEl.textContent = `Block ${resolvedName}?`;
  if (textEl)  textEl.textContent  = `${resolvedName} won't appear in your activity feed or be able to send you messages. This can't be undone.`;
  const modal = document.getElementById('block-user-modal');
  if (modal) modal.style.display = 'flex';
}
window.openBlockUserModal = openBlockUserModal;

function closeBlockUserModal() {
  const modal = document.getElementById('block-user-modal');
  if (modal) modal.style.display = 'none';
  window._shelfdPendingBlockUid  = null;
  window._shelfdPendingBlockName = null;
  const btn = document.getElementById('block-user-confirm-btn');
  if (btn) { btn.disabled = false; btn.textContent = 'Block'; }
}
window.closeBlockUserModal = closeBlockUserModal;

async function confirmBlockUser() {
  const uid  = window._shelfdPendingBlockUid;
  const name = window._shelfdPendingBlockName || 'User';
  if (!uid || !currentUser) { closeBlockUserModal(); return; }

  const btn = document.getElementById('block-user-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Blocking…'; }

  try {
    /* Write to Firestore — arrayUnion is idempotent */
    await db.collection('users').doc(currentUser.uid).set(
      { blockedUids: firebase.firestore.FieldValue.arrayUnion(uid) },
      { merge: true }
    );

    /* Update local caches so the feed filters immediately */
    if (!window.shelfdBlockedUids) window.shelfdBlockedUids = new Set();
    window.shelfdBlockedUids.add(uid);
    if (userProfile) userProfile.blockedUids = [...window.shelfdBlockedUids];

    closeBlockUserModal();

    /* Close the profile page if we blocked from there */
    if (isViewingOtherProfile() && profileViewingUser?.uid === uid) {
      if (typeof closeProfileWithAnimation === 'function') closeProfileWithAnimation();
    }

    if (typeof showToast === 'function') {
      showToast(`${name} has been blocked.`, { durationMs: 3500 });
    }
  } catch (err) {
    console.error('[blockUser]', err);
    if (btn) { btn.disabled = false; btn.textContent = 'Block'; }
    if (typeof showToast === 'function') {
      showToast('Could not block user. Please try again.', { durationMs: 3500 });
    }
  }
}
window.confirmBlockUser = confirmBlockUser;

/* v10.711: Override the legacy block-only modal with a top-layer
   block/unblock flow shared by profile and Direct Messages. */
function isShelfdUserBlocked(uid) {
  const id = String(uid || '').trim();
  if (!id) return false;
  if (window.shelfdBlockedUids && window.shelfdBlockedUids.has(id)) return true;
  return Array.isArray(userProfile?.blockedUids) && userProfile.blockedUids.map(String).includes(id);
}
window.isShelfdUserBlocked = isShelfdUserBlocked;

function setBlockModalSuccess(mode, name) {
  const modal = document.getElementById('block-user-modal');
  const titleEl = document.getElementById('block-user-modal-title');
  const textEl  = document.getElementById('block-user-modal-text');
  const btn = document.getElementById('block-user-confirm-btn');
  const cancel = modal ? modal.querySelector('.btn-secondary') : null;
  if (modal) modal.classList.add('is-success');
  if (titleEl) titleEl.textContent = mode === 'unblock' ? 'User unblocked' : 'User blocked';
  if (textEl) textEl.textContent = mode === 'unblock'
    ? `${name} can appear in your activity feed and send messages again.`
    : `${name} is blocked and will be filtered from your activity feed.`;
  if (cancel) cancel.style.display = 'none';
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Done';
    btn.classList.remove('btn-danger');
    btn.classList.add('btn-primary');
    btn.onclick = closeBlockUserModal;
  }
}

function refreshBlockStateSurfaces(uid) {
  try { if (isViewingOtherProfile() && profileViewingUser?.uid === uid) renderProfilePage(); } catch (_) {}
  try { if (typeof renderDirectMessagesView === 'function') renderDirectMessagesView(); } catch (_) {}
  try { if (typeof render === 'function' && viewingUser?.uid === uid) render(); } catch (_) {}
  try { if (typeof window.updateViewingUserBlockedNotice === 'function') window.updateViewingUserBlockedNotice(); } catch (_) {}
}

function openBlockUserModal(uid, name) {
  if (!uid) return;
  const id = String(uid);
  const mode = isShelfdUserBlocked(id) ? 'unblock' : 'block';
  const resolvedName = name || (typeof usersMap !== 'undefined' && usersMap[id]?.name) || 'this user';
  window._shelfdPendingBlockUid = id;
  window._shelfdPendingBlockName = resolvedName;
  window._shelfdPendingBlockMode = mode;

  const modal = document.getElementById('block-user-modal');
  const titleEl = document.getElementById('block-user-modal-title');
  const textEl  = document.getElementById('block-user-modal-text');
  const btn = document.getElementById('block-user-confirm-btn');
  const cancel = modal ? modal.querySelector('.btn-secondary') : null;

  if (modal) modal.classList.remove('is-success');
  if (titleEl) titleEl.textContent = mode === 'unblock' ? `Unblock ${resolvedName}?` : `Block ${resolvedName}?`;
  if (textEl) textEl.textContent = mode === 'unblock'
    ? `${resolvedName} will be able to appear in your activity feed and send messages again.`
    : `${resolvedName} won't appear in your activity feed and their messages will be hidden from your view.`;
  if (cancel) cancel.style.display = '';
  if (btn) {
    btn.disabled = false;
    btn.textContent = mode === 'unblock' ? 'Unblock' : 'Block';
    btn.classList.toggle('btn-danger', mode !== 'unblock');
    btn.classList.toggle('btn-primary', mode === 'unblock');
    btn.onclick = confirmBlockUser;
  }
  if (modal) modal.style.display = 'flex';
}
window.openBlockUserModal = openBlockUserModal;

function closeBlockUserModal() {
  const modal = document.getElementById('block-user-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('is-success');
    const cancel = modal.querySelector('.btn-secondary');
    if (cancel) cancel.style.display = '';
  }
  window._shelfdPendingBlockUid = null;
  window._shelfdPendingBlockName = null;
  window._shelfdPendingBlockMode = null;
  const btn = document.getElementById('block-user-confirm-btn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Block';
    btn.classList.add('btn-danger');
    btn.classList.remove('btn-primary');
    btn.onclick = confirmBlockUser;
  }
}
window.closeBlockUserModal = closeBlockUserModal;

async function confirmBlockUser() {
  const uid = String(window._shelfdPendingBlockUid || '').trim();
  const name = window._shelfdPendingBlockName || 'User';
  const mode = window._shelfdPendingBlockMode === 'unblock' ? 'unblock' : 'block';
  if (!uid || !currentUser) { closeBlockUserModal(); return; }

  const btn = document.getElementById('block-user-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = mode === 'unblock' ? 'Unblocking...' : 'Blocking...'; }

  try {
    await db.collection('users').doc(currentUser.uid).set({
      blockedUids: mode === 'unblock'
        ? firebase.firestore.FieldValue.arrayRemove(uid)
        : firebase.firestore.FieldValue.arrayUnion(uid)
    }, { merge: true });

    if (!window.shelfdBlockedUids) window.shelfdBlockedUids = new Set();
    if (mode === 'unblock') window.shelfdBlockedUids.delete(uid);
    else window.shelfdBlockedUids.add(uid);
    if (userProfile) userProfile.blockedUids = [...window.shelfdBlockedUids];

    refreshBlockStateSurfaces(uid);
    setBlockModalSuccess(mode, name);
  } catch (err) {
    console.error('[blockUser]', err);
    if (btn) { btn.disabled = false; btn.textContent = mode === 'unblock' ? 'Unblock' : 'Block'; }
    if (typeof showToast === 'function') {
      showToast(mode === 'unblock' ? 'Could not unblock user. Please try again.' : 'Could not block user. Please try again.', { durationMs: 3500 });
    }
  }
}
window.confirmBlockUser = confirmBlockUser;
